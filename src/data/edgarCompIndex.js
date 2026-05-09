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
  EDGAR_INDEX_METADATA,
};
