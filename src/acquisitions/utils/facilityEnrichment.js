// ─── Facility Enrichment Pipeline ───
// Takes a raw Crexi extraction and enriches it with:
// 1. ESRI GeoEnrichment (3-mi demographics)
// 2. PS/REIT proximity (haversine against location CSVs)
// 3. MSA CC rent intelligence (from DiscoverMap MSA_DATA)
// 4. Google Reviews analysis (sentiment keywords)
//
// This runs AFTER crexiParser.parseCrexiExtraction() and BEFORE
// acquisitionScoring.computeAcquisitionScore().

import { safeNum } from "../../utils";

// ─── MSA_DATA subset — CC rent intelligence for cap rate benchmarking ───
// Sourced from DiscoverMap.js MSA_DATA array (REIT 10-K filings).
// Only the fields needed for acquisition scoring.
export const MSA_RENT_DATA = {
  "New York": { ccRent: 24.60, ccGrowth: 2.8, marketCap: 4.75 },
  "Los Angeles": { ccRent: 21.50, ccGrowth: 2.2, marketCap: 4.50 },
  "San Francisco": { ccRent: 23.80, ccGrowth: 1.8, marketCap: 4.50 },
  "Miami": { ccRent: 20.40, ccGrowth: 4.2, marketCap: 5.00 },
  "Dallas": { ccRent: 15.20, ccGrowth: 3.5, marketCap: 5.25 },
  "Houston": { ccRent: 14.80, ccGrowth: 3.8, marketCap: 5.25 },
  "Atlanta": { ccRent: 14.20, ccGrowth: 3.2, marketCap: 5.50 },
  "Chicago": { ccRent: 15.60, ccGrowth: 1.5, marketCap: 5.25 },
  "Phoenix": { ccRent: 16.80, ccGrowth: 4.5, marketCap: 5.00 },
  "Denver": { ccRent: 17.20, ccGrowth: 3.0, marketCap: 5.00 },
  "Nashville": { ccRent: 15.40, ccGrowth: 4.8, marketCap: 5.50 },
  "Charlotte": { ccRent: 14.60, ccGrowth: 3.8, marketCap: 5.50 },
  "Austin": { ccRent: 16.40, ccGrowth: 5.2, marketCap: 5.25 },
  "Tampa": { ccRent: 16.20, ccGrowth: 4.0, marketCap: 5.25 },
  "Orlando": { ccRent: 15.80, ccGrowth: 3.5, marketCap: 5.50 },
  "Raleigh": { ccRent: 14.80, ccGrowth: 4.2, marketCap: 5.50 },
  "Indianapolis": { ccRent: 12.80, ccGrowth: 2.5, marketCap: 6.00 },
  "Cincinnati": { ccRent: 12.40, ccGrowth: 2.0, marketCap: 6.00 },
  "Columbus": { ccRent: 13.20, ccGrowth: 2.8, marketCap: 5.75 },
  "San Antonio": { ccRent: 13.60, ccGrowth: 3.2, marketCap: 5.50 },
  "Jacksonville": { ccRent: 14.20, ccGrowth: 3.5, marketCap: 5.75 },
  "Salt Lake City": { ccRent: 14.80, ccGrowth: 3.5, marketCap: 5.25 },
  "Las Vegas": { ccRent: 15.60, ccGrowth: 4.0, marketCap: 5.25 },
  "Portland": { ccRent: 16.20, ccGrowth: 1.5, marketCap: 5.00 },
  "Seattle": { ccRent: 19.80, ccGrowth: 2.5, marketCap: 4.75 },
  "Washington DC": { ccRent: 18.40, ccGrowth: 2.0, marketCap: 5.00 },
  "Boston": { ccRent: 20.20, ccGrowth: 2.2, marketCap: 4.75 },
  "Philadelphia": { ccRent: 15.80, ccGrowth: 1.8, marketCap: 5.25 },
  "Minneapolis": { ccRent: 14.40, ccGrowth: 1.5, marketCap: 5.50 },
  "Detroit": { ccRent: 12.20, ccGrowth: 1.0, marketCap: 6.25 },
  "Kansas City": { ccRent: 12.60, ccGrowth: 2.0, marketCap: 6.00 },
  "St. Louis": { ccRent: 12.00, ccGrowth: 1.2, marketCap: 6.25 },
  "Pittsburgh": { ccRent: 12.40, ccGrowth: 0.8, marketCap: 6.25 },
  "Cleveland": { ccRent: 11.80, ccGrowth: 0.5, marketCap: 6.50 },
  "Memphis": { ccRent: 11.60, ccGrowth: 1.5, marketCap: 6.50 },
  "Oklahoma City": { ccRent: 11.40, ccGrowth: 2.0, marketCap: 6.25 },
  "Louisville": { ccRent: 12.00, ccGrowth: 1.8, marketCap: 6.00 },
  "Richmond": { ccRent: 13.40, ccGrowth: 2.5, marketCap: 5.75 },
  "Birmingham": { ccRent: 11.20, ccGrowth: 1.5, marketCap: 6.50 },
  "Boise": { ccRent: 14.20, ccGrowth: 4.5, marketCap: 5.50 },
};

// ─── Find closest MSA for market cap rate benchmarking ───
export function findNearestMSA(city, state) {
  // Simple keyword match — could be upgraded to geo-distance later
  const search = `${city} ${state}`.toLowerCase();

  // Direct match
  for (const [msa, data] of Object.entries(MSA_RENT_DATA)) {
    if (search.includes(msa.toLowerCase())) return { msa, ...data };
  }

  // State-level fallback — use largest MSA in state
  const stateMSA = {
    TX: "Dallas", FL: "Tampa", GA: "Atlanta", NC: "Charlotte", TN: "Nashville",
    OH: "Columbus", IN: "Indianapolis", KY: "Louisville", AZ: "Phoenix",
    CO: "Denver", NV: "Las Vegas", WA: "Seattle", OR: "Portland",
    CA: "Los Angeles", NY: "New York", PA: "Philadelphia", IL: "Chicago",
    MI: "Detroit", MO: "Kansas City", MN: "Minneapolis", AL: "Birmingham",
    SC: "Charlotte", VA: "Richmond", UT: "Salt Lake City", OK: "Oklahoma City",
    MA: "Boston", MD: "Washington DC", NJ: "Philadelphia", ID: "Boise",
  };

  const stateKey = (state || "").toUpperCase();
  if (stateMSA[stateKey]) {
    const msa = stateMSA[stateKey];
    return { msa, ...MSA_RENT_DATA[msa] };
  }

  return null;
}

// ─── Enrich facility with MSA data (market cap rate, rent growth) ───
export function enrichWithMSAData(facility) {
  const msaData = findNearestMSA(facility.city, facility.state);
  if (!msaData) return facility;

  const enriched = { ...facility };

  // Market cap rate for spread calculation
  if (!enriched.underwriting.marketCapRate) {
    enriched.underwriting.marketCapRate = msaData.marketCap;
  }

  // CC rent growth for the rentGrowth dimension
  if (!enriched.siteiqData?.msaCCGrowth) {
    enriched.siteiqData = enriched.siteiqData || {};
    enriched.siteiqData.msaCCGrowth = msaData.ccGrowth;
  }

  // Store MSA reference
  enriched._enrichment = enriched._enrichment || {};
  enriched._enrichment.msa = msaData.msa;
  enriched._enrichment.msaCCRent = msaData.ccRent;
  enriched._enrichment.msaMarketCap = msaData.marketCap;
  enriched._enrichment.msaCCGrowth = msaData.ccGrowth;

  // Recalculate cap rate spread if we now have market cap
  if (enriched.underwriting.impliedCapRate > 0 && msaData.marketCap > 0) {
    enriched.underwriting.capRateSpread =
      Math.round((enriched.underwriting.impliedCapRate - msaData.marketCap) * 100); // bps
  }

  return enriched;
}

// ─── Estimate NOI from partial data ───
// When Crexi doesn't provide NOI directly, estimate it from
// occupancy + estimated rent + SF + expense ratio.
export function estimateNOI(facility) {
  const sf = safeNum(facility.totalSF);
  const occ = safeNum(facility.operations?.occupancy || facility.occupancy) / 100;
  if (sf <= 0 || occ <= 0) return null;

  // Get MSA rent data for rent estimate
  const msaData = findNearestMSA(facility.city, facility.state);
  const annualRentPerSF = msaData ? msaData.ccRent : 14.00; // default $14/SF/yr

  // Adjust rent by facility type
  let effectiveRent = annualRentPerSF;
  const cc = safeNum(facility.climatePct) / 100;
  if (cc > 0) {
    // Weighted average: CC units at full rate, drive-up at ~60% of CC rate
    effectiveRent = annualRentPerSF * cc + (annualRentPerSF * 0.6) * (1 - cc);
  } else {
    effectiveRent = annualRentPerSF * 0.6; // All drive-up
  }

  const grossRevenue = sf * effectiveRent * occ;

  // Expense ratio by owner type
  const ownerType = facility.ownerType || "";
  let expenseRatio;
  if (ownerType === "institutional") expenseRatio = 0.34; // REIT-level ops
  else if (ownerType === "regional" || ownerType === "smallPortfolio") expenseRatio = 0.38;
  else expenseRatio = 0.42; // Mom-and-pop — higher expense ratio

  const estimatedNOI = Math.round(grossRevenue * (1 - expenseRatio));

  return {
    estimatedNOI,
    grossRevenue: Math.round(grossRevenue),
    effectiveRentPerSF: Math.round(effectiveRent * 100) / 100,
    occupancyUsed: Math.round(occ * 100),
    expenseRatio: Math.round(expenseRatio * 100),
    source: msaData ? `MSA estimate (${msaData.msa} CC rent $${annualRentPerSF}/SF/yr)` : "National average estimate",
  };
}

// ─── Full enrichment pipeline ───
// Call this after parseCrexiExtraction() and before computeAcquisitionScore()
export function enrichFacility(facility) {
  let enriched = { ...facility };

  // 1. MSA data (market cap rate + rent growth)
  enriched = enrichWithMSAData(enriched);

  // 2. Estimate NOI if not provided
  if (!enriched.underwriting.impliedCapRate && enriched.totalSF > 0) {
    const noiEstimate = estimateNOI(enriched);
    if (noiEstimate && enriched.underwriting.askingPrice > 0) {
      enriched.underwriting.estimatedNOI = noiEstimate.estimatedNOI;
      enriched.underwriting.impliedCapRate =
        Math.round((noiEstimate.estimatedNOI / enriched.underwriting.askingPrice) * 10000) / 100;
      enriched.underwriting.noiSource = noiEstimate.source;
    }
  }

  // 3. Mark enrichment status
  enriched._enriched = enriched._enriched || {};
  enriched._enriched.msaRents = !!enriched._enrichment?.msa;
  enriched._enriched.noiEstimated = !!enriched.underwriting?.estimatedNOI;

  // 4. ESRI + PS proximity + competition require external API calls
  //    These are flagged as false — Claude's pipeline calls them separately
  //    (reuses existing autoEnrichESRI and haversine logic from the PS tracker)

  return enriched;
}
