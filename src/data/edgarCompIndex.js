// edgarCompIndex.js — Accessor for the cross-REIT institutional cost-basis
// index derived from SEC EDGAR Schedule III filings.
//
// Source pipeline: scripts/edgar/extract-schedule-iii.mjs pulls per-issuer
// 10-K Schedule IIIs, scripts/edgar/aggregate-comps.mjs combines them into
// the state-keyed index loaded below.
//
// Used by:
//   - existingAssetAnalysis.js → enriches analyze() output with state comp
//   - analyzerReport.js → renders the institutional cross-REIT block
//   - warehouseExport.js → stamps EDGAR comp data into the v1 schema payload
//   - api/analyzer-memo.js → IC memo prompt cites institutional cost basis

import edgarIndex from "./edgar-comp-index.json";
import sameStoreGrowth from "./edgar-same-store-growth.json";
import transactions8K from "./edgar-8k-transactions-claude.json";
import rentCalibration from "./edgar-rent-calibration.json";

/**
 * Look up the cross-REIT institutional cost basis for a US state.
 *
 * @param {string} stateCode — 2-letter state code (e.g. "TX", "CA")
 * @returns {Object|null} state record with per-issuer breakdown, or null
 *                        if no REIT data for that state
 */
export function getEDGARStateData(stateCode) {
  if (!stateCode) return null;
  const code = stateCode.toUpperCase().trim();
  return edgarIndex.states.find((s) => s.stateCode === code) || null;
}

/**
 * Format a clean citation string for the EDGAR institutional cost basis
 * — used by the report audit block and IC memo narrative.
 *
 * Returns null if no EDGAR data is available for the state.
 */
export function formatEDGARCitation(stateCode) {
  const state = getEDGARStateData(stateCode);
  if (!state) return null;

  const issuersList = state.perIssuer.map((c) => {
    const src = edgarIndex.sources[c.issuer];
    return {
      issuer: c.issuer,
      issuerName: src?.issuerName || c.issuer,
      facilities: c.facilities,
      nrsfThousands: c.nrsfThousands,
      totalGrossThou: c.totalGrossThou,
      impliedPSF: c.impliedPSF,
      depreciationRatio: c.depreciationRatio,
      sourceLabel: c.sourceLabel,
      filingDate: src?.filingDate,
      reportDate: src?.reportDate,
      accessionNumber: src?.accessionNumber,
      filingURL: src?.filingURL,
    };
  });

  return {
    stateCode: state.stateCode,
    stateName: state.stateName,
    totalFacilities: state.totalFacilities,
    totalNRSFThousands: state.totalNRSFThousands,
    totalGrossCarryingThou: state.totalGrossCarryingThou,
    weightedPSF: state.weightedPSF,
    avgPerFacilityM: state.avgPerFacilityM,
    depreciationRatio: state.depreciationRatio,
    numIssuersContributing: state.numIssuersContributing,
    issuers: issuersList,
  };
}

/**
 * Calibrated same-store revenue growth derived from the cross-REIT
 * average of latest-fiscal-year 10-K disclosures. Replaces the generic
 * 11% Y1→Y3 ECRI lift with primary-source REIT-disclosed numbers.
 *
 * Returns:
 *   {
 *     annualGrowthRate: 0.0005,   // cross-REIT avg same-store revenue growth Y/Y
 *     y1ToY3Compounded: 0.001,    // (1 + rate)^2 - 1
 *     contributingIssuers: ["PSA","EXR"],
 *     basisText: "Calibrated to FY2025 cross-REIT same-store disclosures...",
 *     citations: [{issuer, accession, filingURL, growthYoY}]
 *   }
 *
 * Returns null if no calibrated data is available.
 */
export function getCalibratedSameStoreGrowth() {
  const ss = sameStoreGrowth;
  if (!ss?.crossREITAvg?.avgSameStoreRevenueGrowthYoY == null) return null;
  const annual = ss.crossREITAvg.avgSameStoreRevenueGrowthYoY;
  if (annual == null) return null;
  const y1ToY3 = Math.pow(1 + annual, 2) - 1;
  const citations = (ss.issuers || [])
    .filter((i) => i.metrics?.sameStoreRevenueGrowthYoY != null)
    .map((i) => ({
      issuer: i.issuer,
      issuerName: i.issuerName,
      accessionNumber: i.accessionNumber,
      filingURL: i.filingURL,
      reportDate: i.reportDate,
      growthYoY: i.metrics.sameStoreRevenueGrowthYoY,
      growthBasis: i.metrics.revenueGrowthBasis,
    }));
  return {
    annualGrowthRate: annual,
    y1ToY3Compounded: y1ToY3,
    contributingIssuers: ss.crossREITAvg.contributingIssuers || [],
    sampleSize: citations.length,
    basisText: `Calibrated to FY${citations[0]?.reportDate?.slice(0, 4) || ""} cross-REIT same-store revenue growth disclosures from ${citations.map((c) => c.issuer).join(" + ")}. Cross-REIT average ${(annual * 100).toFixed(2)}%/yr · compounded over Y1→Y3 = ${(y1ToY3 * 100).toFixed(2)}% lift. Replaces the generic 11% ECRI lift assumption with primary-source REIT-disclosed numbers.`,
    citations,
  };
}

/**
 * Returns the storage-related per-deal transactions from SEC 8-K filings,
 * sorted newest-first. Each record has buyer / seller / price / facilities /
 * NRSF / consideration type / cap rate (when disclosed) / source quote +
 * accession number.
 *
 * Transactions with aggregate_price_million populated are the most useful
 * for comp purposes. Storage-related is filtered via the is_storage_related
 * flag set by Claude during extraction.
 */
export function getEDGAR8KTransactions(opts = {}) {
  const minPriceM = opts.minPriceM != null ? opts.minPriceM : 0;
  const requirePrice = !!opts.requirePrice;
  const all = (transactions8K?.transactions || []).map((tx) => ({
    issuer: tx.issuer,
    issuerName: tx.issuerName,
    filingDate: tx.filingDate,
    accessionNumber: tx.accessionNumber,
    filingURL: tx.filingURL,
    ...(tx.extracted || {}),
    keyQuote: tx.extracted?.key_quote || null,
  }));
  const filtered = all.filter((tx) => {
    if (tx.is_storage_related === false) return false;
    if (requirePrice && (tx.aggregate_price_million == null)) return false;
    if (minPriceM > 0 && (tx.aggregate_price_million || 0) < minPriceM) return false;
    return true;
  });
  // Sort by filing date descending
  filtered.sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || ""));
  return filtered;
}

/**
 * Returns 8-K transactions involving a specific state (when disclosed in
 * the target/portfolio description). Used to surface deal comps relevant
 * to a subject asset's market in the IC memo + Goldman report.
 *
 * Note: 8-K disclosures rarely include state breakdown — this returns
 * top-N most relevant transactions ordered by recency + dollar size.
 */
export function getRelevant8KTransactions(stateCode, limit = 5) {
  const all = getEDGAR8KTransactions({ requirePrice: true });
  // For now, return the top N storage transactions by (recency + size)
  // since most 8-Ks don't break out state-level detail. State-specific
  // filtering would require additional extraction.
  return all.slice(0, limit);
}

/**
 * EDGAR-calibrated rent band for a US state. Replaces the hard-coded
 * SpareFoot fallback bands with a primary-source-derived calibration:
 *   - Per-state weighted average annual rent per SF, weighted by each REIT's
 *     facility footprint in the state (Schedule III). Issuer portfolio rents
 *     come from FY2025 10-K MD&A same-store disclosures.
 *   - Split into CC + DU monthly bands using cross-REIT 73% CC mix and
 *     industry-standard 80% CC premium over DU.
 *   - Geographic adjustment via square-root damped Schedule III weighted PSF
 *     (high-carry states like NY/HI get higher rents; low-carry like KS/NM
 *     get lower).
 *
 * @param {string} stateCode — 2-letter state code (e.g. "TX", "CA")
 * @returns {Object|null} { ccRent, duRent, confidence, sampleFacilities,
 *                          contributingIssuers, weightedAnnualPerSF,
 *                          stateWeightedPSF, geoMultiplier, citations,
 *                          source }
 *                          or null if no REIT data for that state. Falls back
 *                          to national average if explicit fallback requested.
 */
export function getStateRentBand(stateCode, options = {}) {
  const code = String(stateCode || "").toUpperCase().trim();
  if (!code) {
    if (options.fallbackToNational !== false) return _nationalRentBand();
    return null;
  }
  const state = (rentCalibration.states || []).find((s) => s.stateCode === code);
  if (!state || state.ccRent == null) {
    if (options.fallbackToNational !== false) return _nationalRentBand();
    return null;
  }

  const citations = (state.issuerContributions || [])
    .filter((c) => c.contributionToWeight > 0 && c.accessionNumber)
    .map((c) => ({
      issuer: c.issuer,
      facilities: c.facilities,
      portfolioAnnualRentPerSF: c.portfolioAnnualRentPerSF,
      accessionNumber: c.accessionNumber,
      filingURL: c.filingURL,
      reportDate: c.reportDate,
      isImputed: c.isImputed,
      source: c.source,
    }));

  return {
    stateCode: state.stateCode,
    stateName: state.stateName,
    ccRent: state.ccRent,
    duRent: state.duRent,
    confidence: state.confidence,
    sampleFacilities: state.sampleFacilities,
    contributingIssuers: state.contributingIssuers,
    weightedAnnualPerSF: state.weightedAnnualPerSF,
    monthlyPortfolioRentPerSF: state.monthlyPortfolioRentPerSF,
    stateWeightedPSF: state.stateWeightedPSF,
    geoMultiplier: state.geoMultiplier,
    geoBasis: state.geoBasis,
    derivation: state.derivation,
    citations,
    source: `EDGAR-calibrated (${state.contributingIssuers.join(" + ")} weighted by ${state.sampleFacilities} facilities; geographic adjustment via Schedule III $/SF)`,
  };
}

function _nationalRentBand() {
  const nat = rentCalibration.nationalFallback;
  if (!nat) return null;
  return {
    stateCode: null,
    stateName: "United States (national average)",
    ccRent: nat.ccRent,
    duRent: nat.duRent,
    confidence: nat.confidence,
    sampleFacilities: nat.sampleFacilities,
    contributingIssuers: rentCalibration.issuerPortfolioRents ? Object.keys(rentCalibration.issuerPortfolioRents) : [],
    weightedAnnualPerSF: nat.annualPerSF,
    geoMultiplier: 1.0,
    citations: [],
    source: `EDGAR-calibrated national average (${nat.sampleFacilities} REIT facilities across all states)`,
  };
}

/**
 * Top-level metadata for the rent calibration: methodology, source provenance,
 * and per-issuer portfolio rent breakdown. Used by audit blocks.
 */
export const EDGAR_RENT_CALIBRATION_METADATA = {
  schema: rentCalibration.schema,
  generatedAt: rentCalibration.generatedAt,
  methodology: rentCalibration.methodology,
  issuerPortfolioRents: rentCalibration.issuerPortfolioRents,
  nationalWeightedPSF: rentCalibration.nationalWeightedPSF,
  nationalFallback: rentCalibration.nationalFallback,
  citationRule: rentCalibration.citationRule,
};

/**
 * Top-level metadata for audit blocks: how the index was built, when, what
 * issuers were ingested.
 */
export const EDGAR_INDEX_METADATA = {
  schema: edgarIndex.schema,
  generatedAt: edgarIndex.generatedAt,
  issuersIngested: edgarIndex.issuersIngested,
  totalFacilities: edgarIndex.totals.facilities,
  totalNRSFMillions: Math.round(edgarIndex.totals.nrsfThousandsDisclosed / 1000),
  totalGrossCarryingBillions: Math.round(edgarIndex.totals.grossCarryingThou / 1000000 * 100) / 100,
  states: edgarIndex.totals.states,
  crossValidatedStates: edgarIndex.totals.crossValidatedStates,
  tripleValidatedStates: edgarIndex.totals.tripleValidatedStates,
  citationRule: edgarIndex.citationRule,
  // Sources block — issuer→{filingDate, accessionNumber, filingURL}
  sources: edgarIndex.sources,
};

export default {
  getEDGARStateData,
  formatEDGARCitation,
  getCalibratedSameStoreGrowth,
  getEDGAR8KTransactions,
  getRelevant8KTransactions,
  getStateRentBand,
  EDGAR_INDEX_METADATA,
  EDGAR_RENT_CALIBRATION_METADATA,
};
