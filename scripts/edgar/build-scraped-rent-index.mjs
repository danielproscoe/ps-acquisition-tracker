// build-scraped-rent-index.mjs — aggregator for the PSA facility rent scrape.
//
// Combines all psa-facility-rents-{date}.json files into a single canonical
// index that the Asset Analyzer can read. Per-facility CC + DU medians,
// per-MSA medians, cross-validation against PSA's MD&A-disclosed MSA rent.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function aggregateFacility(facility) {
  const ccRates = [];
  const duRates = [];
  for (const u of facility.units) {
    if (u.pricePerSF_mo == null) continue;
    if (u.unitType === "CC") ccRates.push(u.pricePerSF_mo);
    else if (u.unitType === "DU" || u.unitType === "INDOOR_NOTCC") duRates.push(u.pricePerSF_mo);
  }
  return {
    facilityId: facility.facilityId,
    address: facility.address,
    city: facility.city,
    state: facility.state,
    zip: facility.zip,
    lat: facility.lat,
    lng: facility.lng,
    rating: facility.rating,
    ratingCount: facility.cityListingRatingCount || facility.ratingCount,
    msa: facility.msa,
    facilityUrl: facility.facilityUrl,
    unitListings: facility.units.length,
    ccUnitsAvailable: ccRates.length,
    duUnitsAvailable: duRates.length,
    ccMedianPerSF_mo: ccRates.length ? Math.round(median(ccRates) * 1000) / 1000 : null,
    ccLowPerSF_mo: ccRates.length ? Math.round(Math.min(...ccRates) * 1000) / 1000 : null,
    ccHighPerSF_mo: ccRates.length ? Math.round(Math.max(...ccRates) * 1000) / 1000 : null,
    duMedianPerSF_mo: duRates.length ? Math.round(median(duRates) * 1000) / 1000 : null,
    duLowPerSF_mo: duRates.length ? Math.round(Math.min(...duRates) * 1000) / 1000 : null,
    duHighPerSF_mo: duRates.length ? Math.round(Math.max(...duRates) * 1000) / 1000 : null,
    scrapedAt: facility.scrapedAt,
    units: facility.units, // preserve raw unit detail
  };
}

function aggregateMSA(msaName, facilities) {
  // Aggregate every CC + DU rate across all facilities (cross-facility median)
  const allCC = [];
  const allDU = [];
  for (const f of facilities) {
    if (f.ccMedianPerSF_mo != null) allCC.push(f.ccMedianPerSF_mo);
    if (f.duMedianPerSF_mo != null) allDU.push(f.duMedianPerSF_mo);
  }
  return {
    msa: msaName,
    facilitiesScraped: facilities.length,
    totalUnitListings: facilities.reduce((s, f) => s + f.unitListings, 0),
    facilitiesWithCC: allCC.length,
    facilitiesWithDU: allDU.length,
    ccMedianPerSF_mo: allCC.length ? Math.round(median(allCC) * 1000) / 1000 : null,
    ccLowPerSF_mo: allCC.length ? Math.round(Math.min(...allCC) * 1000) / 1000 : null,
    ccHighPerSF_mo: allCC.length ? Math.round(Math.max(...allCC) * 1000) / 1000 : null,
    duMedianPerSF_mo: allDU.length ? Math.round(median(allDU) * 1000) / 1000 : null,
  };
}

// Cross-validate against PSA's MD&A-disclosed MSA rent
function crossValidate(msaAgg, psaMSARents) {
  // PSA's MD&A discloses 24 MSAs by name. Some scraped MSAs map directly,
  // others fall under "All other markets" (Austin is one).
  const psaMSAMap = {
    "Los Angeles": "Los Angeles",
    "San Francisco": "San Francisco",
    "New York": "New York",
    "Washington DC": "Washington DC",
    "Miami": "Miami",
    "Dallas-Ft. Worth": "Dallas-Ft. Worth",
    "Houston": "Houston",
    "Atlanta": "Atlanta",
    "Chicago": "Chicago",
    // ... etc — all 24 named MSAs
  };
  const psaMSAName = psaMSAMap[msaAgg.msa] || null;
  const psaRecord = psaMSARents?.records?.find((r) => r.msa === psaMSAName);
  const fallback = psaMSARents?.allOtherMarkets;

  let psaDisclosedAnnualPerSF;
  let basis;
  if (psaRecord) {
    psaDisclosedAnnualPerSF = psaRecord.rentPerOccSF_2025;
    basis = `PSA FY2025 MD&A — ${psaRecord.msa} same-store realized annual rent per occupied SF`;
  } else if (fallback) {
    psaDisclosedAnnualPerSF = fallback.rentPerOccSF_2025;
    basis = `PSA FY2025 MD&A — "All other markets" same-store rent per occupied SF (${fallback.facilities} facilities, ${fallback.sqftMillions}M SF)`;
  } else {
    return null;
  }

  // Convert annual portfolio rent → monthly portfolio → CC + DU split
  // Using 73% CC mix + 80% premium (cross-REIT 10-K standard).
  const monthlyPortfolio = psaDisclosedAnnualPerSF / 12;
  const ccMix = 0.73;
  const ccPremium = 1.80;
  const denom = ccMix * ccPremium + (1 - ccMix);
  const psaImpliedDU = monthlyPortfolio / denom;
  const psaImpliedCC = psaImpliedDU * ccPremium;

  // Compare scraped CC median to MD&A-implied CC
  const ccDelta = msaAgg.ccMedianPerSF_mo != null && psaImpliedCC > 0
    ? (msaAgg.ccMedianPerSF_mo - psaImpliedCC) / psaImpliedCC
    : null;

  return {
    psaDisclosedAnnualPerSF,
    psaImpliedMonthlyCC: Math.round(psaImpliedCC * 1000) / 1000,
    psaImpliedMonthlyDU: Math.round(psaImpliedDU * 1000) / 1000,
    scrapedMedianCC: msaAgg.ccMedianPerSF_mo,
    scrapedMedianDU: msaAgg.duMedianPerSF_mo,
    ccDeltaPct: ccDelta != null ? Math.round(ccDelta * 1000) / 10 : null,
    sanityGatePassed: ccDelta != null && Math.abs(ccDelta) < 0.40, // within ±40%
    basis,
    interpretation: ccDelta == null
      ? "No PSA MD&A baseline available."
      : Math.abs(ccDelta) < 0.20
        ? "Scraped median tracks PSA MD&A within ±20% — high confidence."
        : Math.abs(ccDelta) < 0.40
          ? "Scraped median within ±40% of MD&A baseline — acceptable for current-availability move-in pricing (in-place rents include cumulative ECRI lift; scraped rates are MOVE-IN, which is structurally lower)."
          : "Scraped median deviates >40% from MD&A — investigate sample size and unit-type classification.",
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  // Find all psa-facility-rents-*.json files
  const files = fs.readdirSync(DATA_DIR).filter((f) => /^psa-facility-rents-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  if (files.length === 0) {
    console.log("No psa-facility-rents-*.json found. Run scrape-psa-facility-rents.mjs first.");
    return;
  }
  console.log("Found", files.length, "scrape file(s):", files.join(", "));

  // Use the most recent scrape
  const latestFile = files.sort().reverse()[0];
  const scrapeData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, latestFile), "utf-8"));
  console.log("Using:", latestFile);

  // Load PSA MSA disclosed rents for cross-validation
  let psaMSARents = null;
  try {
    psaMSARents = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "edgar-psa-msa-rents.json"), "utf-8"));
  } catch {}

  // Aggregate per facility, then per MSA
  const allFacilities = [];
  const msaAggregations = [];
  for (const city of scrapeData.cities) {
    const aggregatedFacilities = city.facilities.map(aggregateFacility);
    allFacilities.push(...aggregatedFacilities);
    const msaAgg = aggregateMSA(city.msa, aggregatedFacilities);
    msaAgg.crossValidation = crossValidate(msaAgg, psaMSARents);
    msaAggregations.push(msaAgg);
  }

  // Build facility lookup index keyed by facilityId for analyzer accessor
  const facilityIndex = {};
  for (const f of allFacilities) {
    if (f.facilityId) facilityIndex[f.facilityId] = f;
  }

  const output = {
    schema: "storvex.psa-scraped-rent-index.v1",
    generatedAt: new Date().toISOString(),
    sourceScrapeFile: latestFile,
    scrapeGeneratedAt: scrapeData.generatedAt,
    citationRule: "Per-facility primary-source rent records scraped from PSA's Schema.org SelfStorage entities on publicstorage.com facility detail pages. Each Offer (price + size + type) is current move-in availability at scrape time. Cross-validation against PSA's FY2025 10-K MD&A 'Same Store Facilities Operating Trends by Market' converts annual in-place rent → monthly portfolio → CC/DU split (73% mix, 80% premium); scraped median should track within ±20-40% (move-in rates are structurally lower than in-place due to cumulative ECRI on existing tenants).",
    methodology: {
      ccMixAssumption: "73% CC / 27% DU (cross-REIT 10-K average)",
      ccPremiumAssumption: "80% over DU (industry standard)",
      crossValidationTolerance: "Scraped CC median should be within ±40% of MD&A-implied CC. Scraped is MOVE-IN; MD&A is IN-PLACE — gap reflects ECRI lift on cumulative tenant book.",
    },
    totals: {
      facilities: allFacilities.length,
      unitListings: allFacilities.reduce((s, f) => s + f.unitListings, 0),
      msas: msaAggregations.length,
    },
    msaAggregations,
    facilityIndex,
  };

  const outPath = path.join(DATA_DIR, "psa-scraped-rent-index.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  // Console summary
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("  Scraped Rent Index — Aggregated");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`Facilities: ${output.totals.facilities}`);
  console.log(`Unit listings: ${output.totals.unitListings}`);
  console.log(`\nPer-MSA breakdown:`);
  for (const msa of msaAggregations) {
    console.log(`\n  ${msa.msa}`);
    console.log(`    Facilities scraped: ${msa.facilitiesScraped} (${msa.totalUnitListings} unit listings)`);
    console.log(`    CC median: $${msa.ccMedianPerSF_mo}/SF/mo · range $${msa.ccLowPerSF_mo} - $${msa.ccHighPerSF_mo}`);
    console.log(`    DU median: $${msa.duMedianPerSF_mo}/SF/mo`);
    if (msa.crossValidation) {
      const cv = msa.crossValidation;
      console.log(`    Cross-validation:`);
      console.log(`      PSA MD&A baseline: $${cv.psaDisclosedAnnualPerSF}/SF/yr → CC $${cv.psaImpliedMonthlyCC}/mo`);
      console.log(`      Scraped CC median: $${cv.scrapedMedianCC}/mo`);
      console.log(`      Delta: ${cv.ccDeltaPct > 0 ? "+" : ""}${cv.ccDeltaPct}%`);
      console.log(`      Sanity gate: ${cv.sanityGatePassed ? "✓ PASSED" : "✗ FAILED"}`);
      console.log(`      Note: ${cv.interpretation}`);
    }
  }
  console.log(`\n→ Wrote ${outPath}`);
  console.log(`→ ${(JSON.stringify(output).length / 1024).toFixed(1)} KB on disk`);
}

main();
