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
import developmentPipeline from "./development-pipeline.json";

// Historical MSA-level same-store rent disclosures, FY2021-FY2025 PSA primary-
// source from SEC EDGAR. Closes the historical-rent-comp gap vs Radius+. Loaded
// optionally — absent on fresh checkouts where backfill-historical-msa-rents.mjs
// hasn't run.
let historicalMSARents = null;
try {
  // eslint-disable-next-line global-require
  historicalMSARents = require("./edgar-historical-msa-rents.json");
} catch {
  // Optional asset; run scripts/edgar/backfill-historical-msa-rents.mjs to generate.
}

// Multi-year portfolio-aggregate same-store performance for EXR / CUBE / NSA /
// LSI / SMA, ingested from cached historical 10-Ks. Distinct from the PSA per-
// MSA series (above) — these issuers do NOT disclose per-MSA same-store rent,
// so this is the closest possible primary-source backfill for non-PSA buyer
// lenses. Loaded optionally.
let historicalSameStore = null;
try {
  // eslint-disable-next-line global-require
  historicalSameStore = require("./edgar-historical-same-store.json");
} catch {
  // Optional asset; run scripts/edgar/backfill-historical-same-store.mjs to generate.
}

// Move 2 — primary-source pipeline disclosures extracted from each storage
// REIT's most recent 10-Q + 10-K on SEC EDGAR. Per-issuer aggregate metrics
// (PSA remaining-spend, EXR balance-sheet under-development) + named per-
// property entries (CUBE NY JV, SMA Canadian JVs). Loaded optionally —
// absent on fresh checkouts where extract-pipeline-disclosures.mjs hasn't
// run. Records carry verifiedSource: "EDGAR-<form>-<accession>" which
// pipelineConfidence.js classifies as VERIFIED.
let edgarPipelineDisclosures = null;
try {
  // eslint-disable-next-line global-require
  edgarPipelineDisclosures = require("./edgar-pipeline-disclosures.json");
} catch {
  // Optional asset; run scripts/edgar/extract-pipeline-disclosures.mjs to generate.
}

// Cross-REIT rent trajectory — daily-refresh time-series of per-MSA median
// CC + DU rates across PSA + CUBE (+ EXR / NSA when their scrapers wire in).
// Built by scripts/edgar/build-rent-trajectory.mjs walking the dated
// daily snapshot files. Loaded optionally — absent on fresh checkouts.
let rentTrajectory = null;
try {
  // eslint-disable-next-line global-require
  rentTrajectory = require("./cross-reit-rent-trajectory.json");
} catch {
  // Optional asset; run scripts/edgar/build-rent-trajectory.mjs to generate.
}

// Scraped per-facility rents — primary-source unit pricing pulled from each
// REIT's facility detail pages. Optional — availability depends on whether
// the scraper has run for the subject MSA.
//
// PSA: Schema.org SelfStorage with makesOffer arrays, vanilla HTTPS works.
// CUBE: HTML parser (csStorageSizeDimension widget), vanilla HTTPS works.
// EXR: Schema.org with makesOffer arrays, requires Puppeteer + stealth plugin
//      to bypass PerimeterX bot challenge.
let scrapedRentIndex = null;
let cubeScrapedRentIndex = null;
let exrScrapedRentIndex = null;
try {
  // eslint-disable-next-line global-require
  scrapedRentIndex = require("./psa-scraped-rent-index.json");
} catch {
  // Optional asset; absent on fresh checkouts where scraper hasn't run.
}
try {
  // eslint-disable-next-line global-require
  cubeScrapedRentIndex = require("./cube-scraped-rent-index.json");
} catch {}
try {
  // eslint-disable-next-line global-require
  exrScrapedRentIndex = require("./exr-scraped-rent-index.json");
} catch {}

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
 * Cross-REIT ECRI premium index — quantifies the gap between in-place
 * same-store rents and current move-in (new-lease) rates. This is the rent-
 * raising-headroom signal that drives stabilized acquisition projections.
 *
 * EXR's FY2025 10-K MD&A uniquely discloses both metrics directly:
 *   - In-place same-store rent: $19.91/SF/yr
 *   - New-lease (move-in) rent:  $13.16/SF/yr
 *   - ECRI Premium = (in-place - new) / new = 51.3% above move-in
 *
 * Interpretation:
 *   - The ECRI premium represents the cumulative effect of years of annual
 *     existing-customer rate increases (ECRIs) on the tenant book
 *   - Higher premium = stronger pricing power AND larger downside if churn
 *     accelerates (tenants leave at $19.91, get replaced at $13.16)
 *   - For a stabilized acquisition, retention quality + ECRI program
 *     execution determine whether the in-place rent persists
 *
 * Returns null if no issuer in the calibration database discloses the
 * new-lease rate (currently EXR is the only one).
 *
 * @returns {Object|null} {
 *   issuersDisclosed: ["EXR"],
 *   crossREITAvgInPlaceRent: 19.91,
 *   crossREITAvgMoveInRate: 13.16,
 *   crossREITAvgECRIPremium: 0.513,  // 51.3% above move-in
 *   issuerDetails: [{ issuer, inPlace, moveIn, ecriPremium, citation }],
 *   institutionalImplication: string,
 *   citationRule: string,
 * }
 */
export function getECRIPremiumIndex() {
  const ss = sameStoreGrowth;
  if (!ss?.issuers) return null;
  const disclosing = ss.issuers.filter(
    (i) => i.metrics?.sameStoreRentPerSF != null && i.metrics?.newLeaseRentPerSF != null
  );
  if (disclosing.length === 0) return null;

  const issuerDetails = disclosing.map((i) => {
    const inPlace = i.metrics.sameStoreRentPerSF;
    const moveIn = i.metrics.newLeaseRentPerSF;
    const ecriPremium = inPlace > 0 && moveIn > 0 ? (inPlace - moveIn) / moveIn : null;
    return {
      issuer: i.issuer,
      issuerName: i.issuerName,
      inPlaceRentPerSF: inPlace,
      moveInRentPerSF: moveIn,
      moveInRentPerSF_PriorYear: i.metrics.newLeaseRentPerSF_PriorYear,
      moveInRentChangeYoY: i.metrics.newLeaseRentPerSF_PriorYear
        ? (moveIn - i.metrics.newLeaseRentPerSF_PriorYear) / i.metrics.newLeaseRentPerSF_PriorYear
        : null,
      ecriPremium,
      ecriPremiumPct: ecriPremium != null ? Math.round(ecriPremium * 1000) / 10 : null,
      discountPctOfRevenue: i.metrics.discountPctOfRevenue,
      accessionNumber: i.accessionNumber,
      filingURL: i.filingURL,
      reportDate: i.reportDate,
    };
  });

  const totalInPlace = issuerDetails.reduce((s, d) => s + d.inPlaceRentPerSF, 0);
  const totalMoveIn = issuerDetails.reduce((s, d) => s + d.moveInRentPerSF, 0);
  const avgInPlace = totalInPlace / issuerDetails.length;
  const avgMoveIn = totalMoveIn / issuerDetails.length;
  const avgECRIPremium = avgMoveIn > 0 ? (avgInPlace - avgMoveIn) / avgMoveIn : null;

  return {
    issuersDisclosed: disclosing.map((i) => i.issuer),
    crossREITAvgInPlaceRent: Math.round(avgInPlace * 100) / 100,
    crossREITAvgMoveInRate: Math.round(avgMoveIn * 100) / 100,
    crossREITAvgECRIPremium: avgECRIPremium != null ? Math.round(avgECRIPremium * 1000) / 1000 : null,
    crossREITAvgECRIPremiumPct: avgECRIPremium != null ? Math.round(avgECRIPremium * 1000) / 10 : null,
    issuerDetails,
    institutionalImplication: avgECRIPremium != null
      ? `Existing-customer book sits ${(avgECRIPremium * 100).toFixed(1)}% above current move-in rate. For a stabilized acquisition: rent-raising headroom on retained tenants is the cumulative ECRI execution; downside on churn is the gap (tenant leaves at in-place rate, replaced at move-in rate).`
      : "ECRI premium not computable — only one disclosing issuer.",
    citationRule: "Each issuer's in-place + move-in rates trace to the SEC EDGAR 10-K MD&A disclosure. EXR uniquely discloses 'New leases average annual rent per square foot' alongside same-store in-place rent. PSA + CUBE + SMA do not directly disclose move-in rate (their MD&A discusses ECRI dynamics qualitatively).",
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

/**
 * EDGAR-disclosed MSA-level rent band. Highest fidelity: PSA's FY2025 10-K
 * MD&A "Same Store Facilities Operating Trends by Market" table directly
 * discloses realized annual rent per occupied SF for 25 named major
 * metropolitan markets, plus average occupancy and YoY change.
 *
 * Returns null when the MSA is not disclosed (caller should fall back to
 * getStateRentBand for state-weighted calibration).
 *
 * @param {string} msaName — MSA name; aliases resolved (e.g. "Dallas/Ft.
 *                            Worth" → "Dallas-Ft. Worth", "DFW" → ditto,
 *                            "NYC" → "New York", "DC" → "Washington DC")
 * @returns {Object|null} { msa, stateCode, ccRent, duRent, weightedAnnualPerSF,
 *                          occupancy_2025, rentChangeYoY, facilities,
 *                          sqftMillions, noi_2025_K, confidence: "MSA_DISCLOSED_PSA",
 *                          source, accessionNumber, filingURL, citations }
 */
export function getMSARentBand(msaName) {
  if (!msaName) return null;
  const aliases = rentCalibration.msaAliasIndex || {};
  const trimmed = String(msaName).trim();
  const canonical = aliases[trimmed] || aliases[trimmed.replace(/\s+/g, " ")] || trimmed;
  const band = (rentCalibration.msaBands || []).find((b) => b.msa === canonical);
  if (!band) return null;
  return {
    msa: band.msa,
    stateCode: band.stateCode,
    ccRent: band.ccRent,
    duRent: band.duRent,
    weightedAnnualPerSF: band.weightedAnnualPerSF,
    rentPerAvailSF_2025: band.rentPerAvailSF_2025,
    occupancy_2025: band.occupancy_2025,
    rentChangeYoY: band.rentChangeYoY,
    facilities: band.facilities,
    sqftMillions: band.sqftMillions,
    noi_2025_K: band.noi_2025_K,
    confidence: band.confidence,
    source: band.source,
    accessionNumber: band.accessionNumber,
    filingURL: band.filingURL,
    reportDate: band.reportDate,
    derivation: band.derivation,
    citations: [{
      issuer: "PSA",
      facilities: band.facilities,
      portfolioAnnualRentPerSF: band.weightedAnnualPerSF,
      accessionNumber: band.accessionNumber,
      filingURL: band.filingURL,
      reportDate: band.reportDate,
      isImputed: false,
      sourceTable: "Same Store Facilities Operating Trends by Market",
    }],
  };
}

/**
 * Best-available rent band — tries MSA first, falls back to state, falls
 * back to national. Use this when you have lat/lng + city/state and want
 * the highest-fidelity rent calibration available.
 *
 * @param {Object} loc — { msa, state, options }
 * @returns rent band record
 */
export function getBestRentBand({ msa, state, options = {} } = {}) {
  if (msa) {
    const msaBand = getMSARentBand(msa);
    if (msaBand) {
      return { ...msaBand, source: msaBand.source + " (MSA-disclosed; highest fidelity)" };
    }
  }
  if (state) {
    return getStateRentBand(state, options);
  }
  return _nationalRentBand();
}

/**
 * Buyer-specific rent anchor — routes Y0 in-place rent to the selected
 * buyer's 10-K-disclosed rent + Storvex scrape, NOT the cross-REIT
 * weighted fallback. This is what makes the analyzer's underwriting
 * "speak each buyer's voice" — when buyer = CUBE, the rent anchor cites
 * CUBE's actual scraped state-weighted median rather than a generic cross-
 * REIT band.
 *
 * Routing per buyer:
 *   - PS:      PSA per-MSA disclosed rent if MSA matches one of the 24
 *              same-store markets; falls back to PSA national $22.54/SF/yr
 *   - EXR:     EXR scraped MSA if available (data not yet ingested — IP
 *              rotation pending); falls back to EXR national $19.91/SF/yr
 *   - CUBE:    CUBE scraped MSA if available; CUBE scraped state-weighted
 *              if state matches; falls back to CUBE national $22.73/SF/yr
 *   - SMA:     SMA national $20.03/SF/yr (no per-MSA disclosure)
 *   - AMERCO:  UHAL value-tier $16.50/SF/yr (truck-adjacent storage cohort)
 *   - GENERIC: cross-REIT national average $20.92/SF/yr
 *
 * @param {Object} args
 * @param {string} args.buyerKey — "PS" | "EXR" | "CUBE" | "SMA" | "AMERCO" | "GENERIC"
 * @param {string} [args.msa]   — MSA name (e.g. "Houston")
 * @param {string} [args.state] — 2-letter state code or full slug (e.g. "TX" or "texas")
 * @returns {Object|null} {
 *   annualPerSF, monthlyPerSF, source, citation, basis, sampleN,
 *   buyerKey, buyerTicker
 * }
 */
export function getBuyerSpecificRentAnchor({ buyerKey, msa, state } = {}) {
  if (!buyerKey) return null;
  const k = String(buyerKey).toUpperCase();

  // ── PSA — per-MSA from FY2025 10-K MD&A (24 markets) ──
  // PS lens encompasses the FULL "PS Family" per CLAUDE.md §6b: PSA + iStorage
  // + NSA (the latter two were merged into PSA in 2023). All three brands
  // operate as one institutional portfolio post-merger; same-store ratios in
  // the FY2025 10-K reflect the integrated portfolio. iStorage/NSA proximity
  // index lives in NSA_Locations.csv (1,134+ facilities) — refreshed from
  // nsastorage.com sitemap via scripts/edgar/scrape-nsa-locations.mjs.
  if (k === "PS" || k === "PSA") {
    if (msa) {
      const msaBand = getMSARentBand(msa);
      // PSA per-MSA disclosure surfaces realized rent per OCCUPIED SF — that's
      // the in-place rent we want as Y0 anchor. msaBand.weightedAnnualPerSF
      // is the same MSA-level band; rentPerAvailSF_2025 is the available-SF
      // variant. Prefer weightedAnnualPerSF for in-place underwriting.
      const annual = msaBand?.weightedAnnualPerSF || null;
      if (annual) {
        return {
          annualPerSF: annual,
          monthlyPerSF: annual / 12,
          source: "PSA FY2025 10-K MD&A · Same Store Facilities Operating Trends by Market (PS Family — PSA + iStorage + NSA post-2023 merger)",
          citation: msaBand.accessionNumber || "Accession 0001628280-26-007696",
          basis: "PSA MSA-disclosed (PS Family)",
          sampleN: msaBand.facilities || null,
          buyerKey: "PS",
          buyerTicker: "INST",
        };
      }
    }
    return {
      annualPerSF: 22.54,
      monthlyPerSF: 22.54 / 12,
      source: "PSA FY2025 10-K MD&A · realized annual rent per occupied SF (national same-store; PS Family = PSA + iStorage + NSA)",
      citation: "Accession 0001628280-26-007696",
      basis: "PSA national (PS Family)",
      sampleN: 2565,
      buyerKey: "PS",
      buyerTicker: "INST",
    };
  }

  // ── EXR — scraped MSA when available, fallback to EXR national disclosure ──
  if (k === "EXR") {
    const scraped = exrScrapedRentIndex && msa
      ? (exrScrapedRentIndex.msaAggregations || []).find((m) => m.msa === msa)
      : null;
    if (scraped && scraped.ccMedianPerSF_mo) {
      // Convert CC monthly median to annual estimate; CC is ~73% of EXR mix,
      // and CC carries ~80% premium over DU. Reverse-derive the all-in annual.
      const monthlyPortfolio = scraped.ccMedianPerSF_mo / 1.8 * (0.73 * 1.8 + 0.27);
      return {
        annualPerSF: monthlyPortfolio * 12,
        monthlyPerSF: monthlyPortfolio,
        source: "EXR Storvex per-facility scrape · MSA-aggregated CC median (move-in pricing)",
        citation: `Storvex direct scrape · ${scraped.facilitiesScraped} facilities`,
        basis: "EXR scraped MSA",
        sampleN: scraped.facilitiesScraped,
        buyerKey: "EXR",
        buyerTicker: "EXR",
      };
    }
    return {
      annualPerSF: 19.91,
      monthlyPerSF: 19.91 / 12,
      source: "EXR FY2025 10-K MD&A · same-store realized rent per occupied SF (national)",
      citation: "Accession 0001289490-26-000011",
      basis: "EXR national",
      sampleN: 2084,
      buyerKey: "EXR",
      buyerTicker: "EXR",
    };
  }

  // ── CUBE — scraped MSA, then state, then CUBE national disclosure ──
  if (k === "CUBE") {
    if (cubeScrapedRentIndex && msa) {
      const msaScrape = (cubeScrapedRentIndex.msaAggregations || []).find((m) => m.msa === msa);
      if (msaScrape && msaScrape.ccMedianPerSF_mo) {
        // CUBE captures BOTH discount + standard. Use discount price for in-place
        // anchor (it's what CUBE's same-store cohort actually pays).
        const monthlyPortfolio = msaScrape.ccMedianPerSF_mo / 1.8 * (0.73 * 1.8 + 0.27);
        return {
          annualPerSF: monthlyPortfolio * 12,
          monthlyPerSF: monthlyPortfolio,
          source: "CUBE Storvex per-facility scrape · MSA-aggregated CC median (move-in pricing)",
          citation: `Storvex direct scrape · ${msaScrape.facilitiesScraped} facilities`,
          basis: "CUBE scraped MSA",
          sampleN: msaScrape.facilitiesScraped,
          buyerKey: "CUBE",
          buyerTicker: "CUBE",
        };
      }
    }
    if (cubeScrapedRentIndex && state) {
      const stateAgg = getCubeStateRentMedian(state);
      if (stateAgg && stateAgg.ccMedianPerSF_mo) {
        const monthlyPortfolio = stateAgg.ccMedianPerSF_mo / 1.8 * (0.73 * 1.8 + 0.27);
        return {
          annualPerSF: monthlyPortfolio * 12,
          monthlyPerSF: monthlyPortfolio,
          source: "CUBE Storvex per-facility scrape · state-weighted CC median (move-in pricing)",
          citation: `Storvex direct scrape · ${stateAgg.facilitiesScraped} facilities`,
          basis: "CUBE scraped state-weighted",
          sampleN: stateAgg.facilitiesScraped,
          buyerKey: "CUBE",
          buyerTicker: "CUBE",
        };
      }
    }
    return {
      annualPerSF: 22.73,
      monthlyPerSF: 22.73 / 12,
      source: "CUBE FY2025 10-K MD&A · same-store realized rent per occupied SF (national)",
      citation: "Accession 0001298675-26-000010",
      basis: "CUBE national",
      sampleN: 657,
      buyerKey: "CUBE",
      buyerTicker: "CUBE",
    };
  }

  // ── SMA — national same-store disclosure (no per-MSA) ──
  if (k === "SMA") {
    return {
      annualPerSF: 20.03,
      monthlyPerSF: 20.03 / 12,
      source: "SMA FY2025 10-K MD&A · annualized rent per occupied SF (national)",
      citation: "Accession 0001193125-26-082573",
      basis: "SMA national",
      sampleN: 149,
      buyerKey: "SMA",
      buyerTicker: "SMA",
    };
  }

  // ── AMERCO/UHAL — value-tier truck-adjacent storage cohort ──
  if (k === "AMERCO" || k === "UHAL") {
    return {
      annualPerSF: 16.50,
      monthlyPerSF: 16.50 / 12,
      source: "U-Haul Holding (UHAL) FY2025 10-K · Self-Storage segment · value-tier truck-adjacent rent",
      citation: "UHAL FY2025 10-K (FY ending March 31, 2025) + Inside Self-Storage 2025 Industry Survey (truck-adjacent cohort)",
      basis: "UHAL value-tier",
      sampleN: null,
      buyerKey: "AMERCO",
      buyerTicker: "UHAL",
    };
  }

  // ── GENERIC — cross-REIT national average ──
  if (k === "GENERIC" || k === "GEN") {
    return {
      annualPerSF: 20.92,
      monthlyPerSF: 20.92 / 12,
      source: "Cross-REIT FY2025 10-K average (PSA + EXR + CUBE + SMA + UHAL national same-store)",
      citation: "Storvex EDGAR Rent Calibration Index v1 (cross-REIT weighted)",
      basis: "Cross-REIT national",
      sampleN: 5818,
      buyerKey: "GENERIC",
      buyerTicker: "GEN",
    };
  }

  return null;
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

// ══════════════════════════════════════════════════════════════════════════
// PER-FACILITY COMPETITOR ENRICHMENT
// ══════════════════════════════════════════════════════════════════════════
//
// PSA's Schedule III discloses per-MSA aggregate gross carrying value + NRSF
// + facility count. From this we derive an implied $/SF cost basis per MSA
// (or fall back to state-level when MSA is undisclosed). Combined with the
// EDGAR-calibrated rent bands, we produce a primary-source competitor
// estimate: each PS family facility carries an estimated cost basis ($/SF)
// and rent (CC + DU monthly) traceable to specific 10-K accession numbers.

// City → MSA disambiguation for cities clearly inside a PSA-disclosed MSA.
// We don't try to match every suburb (would need MSA polygons). This is a
// curated list of high-confidence matches that lets the analyzer upgrade
// from state-level to MSA-level rents for ~50% of major-metro competitors.
// Returns null when the city doesn't unambiguously map.
const CITY_TO_MSA = {
  // Los Angeles MSA
  "Los Angeles": "Los Angeles", "Long Beach": "Los Angeles", "Anaheim": "Los Angeles",
  "Pasadena": "Los Angeles", "Burbank": "Los Angeles", "Glendale": "Los Angeles",
  "Inglewood": "Los Angeles", "Torrance": "Los Angeles", "Costa Mesa": "Los Angeles",
  "Van Nuys": "Los Angeles", "Pico Rivera": "Los Angeles", "Whittier": "Los Angeles",
  "Norwalk": "Los Angeles", "Downey": "Los Angeles", "Compton": "Los Angeles",
  "Santa Monica": "Los Angeles", "Culver City": "Los Angeles", "Pomona": "Los Angeles",
  "Ontario": "Los Angeles", "Riverside": "Los Angeles", "San Bernardino": "Los Angeles",
  "Orange": "Los Angeles", "Irvine": "Los Angeles", "Santa Ana": "Los Angeles",
  "Fullerton": "Los Angeles", "Garden Grove": "Los Angeles", "Huntington Beach": "Los Angeles",
  // San Francisco MSA
  "San Francisco": "San Francisco", "Oakland": "San Francisco", "San Jose": "San Francisco",
  "Berkeley": "San Francisco", "Fremont": "San Francisco", "Hayward": "San Francisco",
  "Sunnyvale": "San Francisco", "Santa Clara": "San Francisco", "San Mateo": "San Francisco",
  "Daly City": "San Francisco", "Concord": "San Francisco", "Vallejo": "San Francisco",
  "Richmond": "San Francisco", "Walnut Creek": "San Francisco",
  // San Diego MSA
  "San Diego": "San Diego", "Chula Vista": "San Diego", "Escondido": "San Diego",
  "Oceanside": "San Diego", "Carlsbad": "San Diego", "El Cajon": "San Diego",
  "La Mesa": "San Diego", "Vista": "San Diego",
  // Sacramento MSA
  "Sacramento": "Sacramento", "Roseville": "Sacramento", "Elk Grove": "Sacramento",
  "Folsom": "Sacramento",
  // New York MSA
  "New York": "New York", "Brooklyn": "New York", "Queens": "New York", "Bronx": "New York",
  "Staten Island": "New York", "Yonkers": "New York", "Mount Vernon": "New York",
  "New Rochelle": "New York", "White Plains": "New York", "Newark": "New York",
  "Jersey City": "New York", "Paterson": "New York", "Elizabeth": "New York",
  "Hoboken": "New York", "Bayonne": "New York", "Long Island City": "New York",
  // Washington DC MSA
  "Washington": "Washington DC", "Alexandria": "Washington DC", "Arlington": "Washington DC",
  "Fairfax": "Washington DC", "Reston": "Washington DC", "McLean": "Washington DC",
  "Bethesda": "Washington DC", "Silver Spring": "Washington DC", "Rockville": "Washington DC",
  "Gaithersburg": "Washington DC", "Frederick": "Washington DC",
  // Miami MSA
  "Miami": "Miami", "Hialeah": "Miami", "Coral Gables": "Miami", "Hollywood": "Miami",
  "Pembroke Pines": "Miami", "Fort Lauderdale": "Miami", "Pompano Beach": "Miami",
  "Deerfield Beach": "Miami", "Miramar": "Miami", "Plantation": "Miami",
  "Davie": "Miami", "Sunrise": "Miami", "Doral": "Miami",
  // Tampa MSA
  "Tampa": "Tampa", "St. Petersburg": "Tampa", "Clearwater": "Tampa", "Brandon": "Tampa",
  "Lakeland": "Tampa",
  // Orlando MSA
  "Orlando": "Orlando-Daytona", "Kissimmee": "Orlando-Daytona", "Daytona Beach": "Orlando-Daytona",
  "Sanford": "Orlando-Daytona", "Altamonte Springs": "Orlando-Daytona",
  // West Palm Beach MSA
  "West Palm Beach": "West Palm Beach", "Boca Raton": "West Palm Beach",
  "Boynton Beach": "West Palm Beach", "Delray Beach": "West Palm Beach",
  // Seattle MSA
  "Seattle": "Seattle-Tacoma", "Tacoma": "Seattle-Tacoma", "Bellevue": "Seattle-Tacoma",
  "Everett": "Seattle-Tacoma", "Renton": "Seattle-Tacoma", "Kent": "Seattle-Tacoma",
  // Portland MSA
  "Portland": "Portland", "Beaverton": "Portland", "Gresham": "Portland", "Hillsboro": "Portland",
  // Dallas-Ft. Worth MSA
  "Dallas": "Dallas-Ft. Worth", "Fort Worth": "Dallas-Ft. Worth", "Plano": "Dallas-Ft. Worth",
  "Arlington": "Dallas-Ft. Worth", "Garland": "Dallas-Ft. Worth", "Irving": "Dallas-Ft. Worth",
  "Mesquite": "Dallas-Ft. Worth", "Carrollton": "Dallas-Ft. Worth",
  "Frisco": "Dallas-Ft. Worth", "McKinney": "Dallas-Ft. Worth",
  "Grand Prairie": "Dallas-Ft. Worth", "Denton": "Dallas-Ft. Worth", "Lewisville": "Dallas-Ft. Worth",
  // Houston MSA
  "Houston": "Houston", "Pasadena (TX)": "Houston", "Sugar Land": "Houston",
  "Pearland": "Houston", "Katy": "Houston", "The Woodlands": "Houston",
  "Spring": "Houston", "Cypress": "Houston", "Humble": "Houston", "Conroe": "Houston",
  // Chicago MSA
  "Chicago": "Chicago", "Naperville": "Chicago", "Schaumburg": "Chicago",
  "Evanston": "Chicago", "Aurora": "Chicago", "Elgin": "Chicago", "Joliet": "Chicago",
  "Skokie": "Chicago", "Oak Park": "Chicago",
  // Atlanta MSA
  "Atlanta": "Atlanta", "Marietta": "Atlanta", "Roswell": "Atlanta", "Sandy Springs": "Atlanta",
  "Alpharetta": "Atlanta", "Decatur": "Atlanta", "Smyrna": "Atlanta", "Kennesaw": "Atlanta",
  // Philadelphia MSA
  "Philadelphia": "Philadelphia", "Wilmington": "Philadelphia", "Camden": "Philadelphia",
  // Baltimore MSA
  "Baltimore": "Baltimore", "Towson": "Baltimore", "Columbia": "Baltimore",
  // Charlotte MSA
  "Charlotte": "Charlotte", "Concord (NC)": "Charlotte", "Gastonia": "Charlotte",
  "Huntersville": "Charlotte",
  // Denver MSA
  "Denver": "Denver", "Aurora (CO)": "Denver", "Lakewood": "Denver", "Thornton": "Denver",
  "Westminster": "Denver", "Centennial": "Denver", "Englewood": "Denver",
  // Phoenix MSA
  "Phoenix": "Phoenix", "Scottsdale": "Phoenix", "Mesa": "Phoenix", "Chandler": "Phoenix",
  "Glendale (AZ)": "Phoenix", "Tempe": "Phoenix", "Gilbert": "Phoenix", "Peoria": "Phoenix",
  // Detroit MSA
  "Detroit": "Detroit", "Warren": "Detroit", "Sterling Heights": "Detroit",
  "Dearborn": "Detroit", "Livonia": "Detroit", "Troy": "Detroit",
  // Boston MSA
  "Boston": "Boston", "Cambridge": "Boston", "Quincy": "Boston", "Brockton": "Boston",
  "Lynn": "Boston", "Newton": "Boston", "Somerville": "Boston",
  // Honolulu MSA
  "Honolulu": "Honolulu", "Pearl City": "Honolulu", "Waipahu": "Honolulu",
  "Kailua": "Honolulu", "Kaneohe": "Honolulu",
  // Minneapolis MSA
  "Minneapolis": "Minneapolis/St. Paul", "St. Paul": "Minneapolis/St. Paul",
  "Bloomington": "Minneapolis/St. Paul", "Plymouth": "Minneapolis/St. Paul",
};

/**
 * Resolve a city name to a PSA-disclosed MSA, or null. Returns the canonical
 * MSA name as it appears in PSA's same-store-by-market table.
 */
export function resolveCityToMSA(cityName, stateCode = null) {
  if (!cityName) return null;
  const trimmed = String(cityName).trim();
  // Try exact match first
  let msa = CITY_TO_MSA[trimmed];
  if (msa) return msa;
  // For cities that exist in multiple states (Aurora CO/IL, Concord NC/CA),
  // try state-disambiguated key
  if (stateCode) {
    const stateKey = `${trimmed} (${stateCode})`;
    msa = CITY_TO_MSA[stateKey];
    if (msa) return msa;
  }
  return null;
}

/**
 * Look up scraped per-facility unit rents from the PSA facility scraper.
 *
 * The scraper crawls PSA's Schema.org SelfStorage entities on facility
 * detail pages and extracts current move-in pricing per unit type. Coverage
 * depends on which MSAs have been crawled; check the scraper output's
 * msaAggregations array.
 *
 * @param {string} facilityId — PSA facility ID (e.g., "809" from URL
 *                              `/self-storage-tx-austin/809.html`)
 * @returns {Object|null} {
 *     facilityId, address, city, state, zip, lat, lng, msa,
 *     ccMedianPerSF_mo, ccLowPerSF_mo, ccHighPerSF_mo,
 *     duMedianPerSF_mo, duLowPerSF_mo, duHighPerSF_mo,
 *     unitListings, ccUnitsAvailable, duUnitsAvailable,
 *     scrapedAt, units: [...] (full per-unit detail)
 *   } or null if no scrape data exists for this facility.
 */
export function getScrapedFacilityRents(facilityId) {
  if (!scrapedRentIndex || !facilityId) return null;
  return scrapedRentIndex.facilityIndex?.[String(facilityId)] || null;
}

/**
 * Get the scraped MSA-level median CC + DU rent + cross-validation result
 * (scraped median vs PSA MD&A-disclosed in-place rent).
 *
 * @param {string} msaName — MSA name as labeled by the scraper
 *                          (e.g., "Austin TX", "Los Angeles")
 * @returns {Object|null} {
 *     msa, facilitiesScraped, totalUnitListings,
 *     ccMedianPerSF_mo, ccLowPerSF_mo, ccHighPerSF_mo, duMedianPerSF_mo,
 *     crossValidation: {
 *       psaDisclosedAnnualPerSF, psaImpliedMonthlyCC, psaImpliedMonthlyDU,
 *       scrapedMedianCC, scrapedMedianDU, ccDeltaPct,
 *       sanityGatePassed, basis, interpretation
 *     }
 *   } or null if MSA not scraped.
 */
export function getScrapedMSARentMedian(msaName) {
  if (!scrapedRentIndex || !msaName) return null;
  return (scrapedRentIndex.msaAggregations || []).find((m) => m.msa === msaName) || null;
}

/**
 * Returns metadata about the scraped rent index — what's been scraped,
 * when, and from how many facilities.
 */
export function getScrapedRentIndexMetadata() {
  if (!scrapedRentIndex) return null;
  return {
    schema: scrapedRentIndex.schema,
    generatedAt: scrapedRentIndex.generatedAt,
    sourceScrapeFile: scrapedRentIndex.sourceScrapeFile,
    scrapeGeneratedAt: scrapedRentIndex.scrapeGeneratedAt,
    citationRule: scrapedRentIndex.citationRule,
    methodology: scrapedRentIndex.methodology,
    totals: scrapedRentIndex.totals,
    msasScraped: (scrapedRentIndex.msaAggregations || []).map((m) => m.msa),
  };
}

// ─── CUBE scraped rent index accessors ─────────────────────────────────────

/**
 * Look up the scraped rent record for a CUBE facility by ID.
 * @param {string|number} facilityId
 */
export function getCubeFacilityRents(facilityId) {
  if (!cubeScrapedRentIndex || !facilityId) return null;
  return cubeScrapedRentIndex.facilityIndex?.[String(facilityId)] || null;
}

/**
 * Get CUBE state-level scraped rent aggregation. CUBE doesn't disclose
 * per-MSA breakdowns in its 10-K MD&A — state-keyed buckets are the
 * primary geographic grouping.
 * @param {string} stateCodeOrSlug — state slug ("california") or 2-letter ("CA")
 */
export function getCubeStateRentMedian(stateCodeOrSlug) {
  if (!cubeScrapedRentIndex || !stateCodeOrSlug) return null;
  const needle = String(stateCodeOrSlug).toLowerCase().trim();
  // Match by state slug (e.g. "california") OR by 2-letter code (we look up
  // any facility in the state group with stateCode set to the requested code)
  const groups = cubeScrapedRentIndex.stateAggregations || [];
  let group = groups.find((g) => String(g.state).toLowerCase() === needle);
  if (group) return group;
  // Try 2-letter mapping (we need to scan facility records for stateCode match)
  const idx = cubeScrapedRentIndex.facilityIndex || {};
  const matchingFacs = Object.values(idx).filter(
    (f) => String(f.state || "").toLowerCase() === needle
  );
  if (!matchingFacs.length) return null;
  // Find the state slug that maps to these matching facs
  if (matchingFacs[0].stateSlug) {
    group = groups.find((g) => String(g.state).toLowerCase() === matchingFacs[0].stateSlug);
    if (group) return group;
  }
  return null;
}

/**
 * Get CUBE MSA-level scraped rent aggregation. MSAs are computed at build
 * time via the city → MSA resolver; only cities present in the resolver
 * map will surface here.
 * @param {string} msaName
 */
export function getCubeMSARentMedian(msaName) {
  if (!cubeScrapedRentIndex || !msaName) return null;
  return (cubeScrapedRentIndex.msaAggregations || []).find((m) => m.msa === msaName) || null;
}

/**
 * Returns metadata about the CUBE scraped rent index.
 */
export function getCubeScrapedRentIndexMetadata() {
  if (!cubeScrapedRentIndex) return null;
  return {
    schema: cubeScrapedRentIndex.schema,
    operator: cubeScrapedRentIndex.operator,
    generatedAt: cubeScrapedRentIndex.generatedAt,
    sourceScrapeFile: cubeScrapedRentIndex.sourceScrapeFile,
    scrapeGeneratedAt: cubeScrapedRentIndex.scrapeGeneratedAt,
    citationRule: cubeScrapedRentIndex.citationRule,
    methodology: cubeScrapedRentIndex.methodology,
    totals: cubeScrapedRentIndex.totals,
    nationalValidation: cubeScrapedRentIndex.nationalValidation,
    statesScraped: (cubeScrapedRentIndex.stateAggregations || []).map((s) => s.state),
    msasResolved: (cubeScrapedRentIndex.msaAggregations || []).map((m) => m.msa),
  };
}

// ─── EXR scraped rent index accessors ──────────────────────────────────────

/**
 * Look up the scraped rent record for an EXR facility by ID.
 * @param {string|number} facilityId
 */
export function getExrFacilityRents(facilityId) {
  if (!exrScrapedRentIndex || !facilityId) return null;
  return exrScrapedRentIndex.facilityIndex?.[String(facilityId)] || null;
}

/**
 * Get EXR state-level scraped rent aggregation.
 * @param {string} stateCode — 2-letter state code
 */
export function getExrStateRentMedian(stateCode) {
  if (!exrScrapedRentIndex || !stateCode) return null;
  const code = String(stateCode).toUpperCase().trim();
  return (exrScrapedRentIndex.stateAggregations || []).find(
    (g) => String(g.state).toUpperCase() === code
  ) || null;
}

/**
 * Get EXR MSA-level scraped rent aggregation.
 * @param {string} msaName
 */
export function getExrMSARentMedian(msaName) {
  if (!exrScrapedRentIndex || !msaName) return null;
  return (exrScrapedRentIndex.msaAggregations || []).find((m) => m.msa === msaName) || null;
}

/**
 * Returns metadata about the EXR scraped rent index.
 */
export function getExrScrapedRentIndexMetadata() {
  if (!exrScrapedRentIndex) return null;
  return {
    schema: exrScrapedRentIndex.schema,
    operator: exrScrapedRentIndex.operator,
    generatedAt: exrScrapedRentIndex.generatedAt,
    sourceScrapeFile: exrScrapedRentIndex.sourceScrapeFile,
    scrapeGeneratedAt: exrScrapedRentIndex.scrapeGeneratedAt,
    citationRule: exrScrapedRentIndex.citationRule,
    methodology: exrScrapedRentIndex.methodology,
    totals: exrScrapedRentIndex.totals,
    nationalValidation: exrScrapedRentIndex.nationalValidation,
    statesScraped: (exrScrapedRentIndex.stateAggregations || []).map((s) => s.state),
    msasResolved: (exrScrapedRentIndex.msaAggregations || []).map((m) => m.msa),
  };
}

// ─── Cross-REIT scraped rent matrix ─────────────────────────────────────────

/**
 * Get a cross-REIT matrix of scraped move-in rates for a given MSA. Returns
 * one row per operator (PSA + CUBE + EXR) where rent data is available.
 * Useful for the Asset Analyzer's "MOVE-IN RATES" panel that shows how each
 * REIT's per-facility move-in median compares within the same MSA.
 *
 * @param {string} msaName — exact MSA label as used in scraper config
 * @returns {Array<Object>} array of { operator, ccMedian, duMedian, sample, ... }
 */
export function getMSAMoveInRatesByOperator(msaName) {
  if (!msaName) return [];
  const out = [];
  const psaAgg = getScrapedMSARentMedian(msaName);
  if (psaAgg && (psaAgg.ccMedianPerSF_mo != null || psaAgg.duMedianPerSF_mo != null)) {
    out.push({
      operator: "PSA",
      operatorName: "Public Storage",
      ccMedianPerSF_mo: psaAgg.ccMedianPerSF_mo,
      ccLowPerSF_mo: psaAgg.ccLowPerSF_mo,
      ccHighPerSF_mo: psaAgg.ccHighPerSF_mo,
      duMedianPerSF_mo: psaAgg.duMedianPerSF_mo,
      facilitiesScraped: psaAgg.facilitiesScraped,
      totalUnitListings: psaAgg.totalUnitListings,
      crossValidation: psaAgg.crossValidation || null,
    });
  }
  const cubeAgg = getCubeMSARentMedian(msaName);
  if (cubeAgg && (cubeAgg.ccMedianPerSF_mo != null || cubeAgg.duMedianPerSF_mo != null)) {
    out.push({
      operator: "CUBE",
      operatorName: "CubeSmart",
      ccMedianPerSF_mo: cubeAgg.ccMedianPerSF_mo,
      ccLowPerSF_mo: cubeAgg.ccLowPerSF_mo,
      ccHighPerSF_mo: cubeAgg.ccHighPerSF_mo,
      duMedianPerSF_mo: cubeAgg.duMedianPerSF_mo,
      ccStandardMedianPerSF_mo: cubeAgg.ccStandardMedianPerSF_mo,
      duStandardMedianPerSF_mo: cubeAgg.duStandardMedianPerSF_mo,
      impliedDiscountPct: cubeAgg.impliedDiscountPct,
      facilitiesScraped: cubeAgg.facilitiesScraped,
      totalUnitListings: cubeAgg.totalUnitListings,
    });
  }
  const exrAgg = getExrMSARentMedian(msaName);
  if (exrAgg && (exrAgg.ccMedianPerSF_mo != null || exrAgg.duMedianPerSF_mo != null)) {
    out.push({
      operator: "EXR",
      operatorName: "Extra Space Storage",
      ccMedianPerSF_mo: exrAgg.ccMedianPerSF_mo,
      ccLowPerSF_mo: exrAgg.ccLowPerSF_mo,
      ccHighPerSF_mo: exrAgg.ccHighPerSF_mo,
      duMedianPerSF_mo: exrAgg.duMedianPerSF_mo,
      facilitiesScraped: exrAgg.facilitiesScraped,
      totalUnitListings: exrAgg.totalUnitListings,
    });
  }
  return out;
}

// ─── Development pipeline accessors ────────────────────────────────────────
//
// Powers the "NEW-SUPPLY PIPELINE" card on the Asset Analyzer dashboard and
// the matching section in the Goldman PDF. Each row is a disclosed pipeline
// facility (PSA/EXR/CUBE/SMA/AMERCO/UHAL) sourced from FY2025 10-K MD&A
// 'Properties Under Development' sections + Q1 2026 earnings transcripts.
//
// Used by Y3 NOI projection: when ≥100K SF of new CC opens within 3 mi
// during Y1-Y3, that's a saturation signal — Y3 occupancy should compress
// 1pp and rent growth should compress 1pp. Storvex flags this for the
// analyst rather than auto-adjusting the math; the analyst makes the call.

/**
 * Haversine distance in miles between two lat/lng points.
 * (Inline copy — avoids importing src/haversine.js into this data module.)
 */
function _haversineMi(lat1, lon1, lat2, lon2) {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
    return null;
  }
  const R = 3958.8; // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Get pipeline facilities within a radius of a subject site, sorted by
 * distance (nearest first). Each result includes the disclosed delivery
 * quarter, NRSF, status, and citation.
 *
 * @param {Object} args
 * @param {number} args.lat
 * @param {number} args.lng
 * @param {number} [args.radiusMi=3]  — proximity radius in miles (default 3 mi)
 * @returns {Array<Object>} pipeline records with `distanceMi` field added,
 *                          sorted ASC by distance, or empty array if no
 *                          subject lat/lng provided.
 */
export function getNearbyPipeline({ lat, lng, radiusMi = 3 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const all = developmentPipeline.facilities || [];
  const out = [];
  for (const f of all) {
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) continue;
    const dist = _haversineMi(lat, lng, f.lat, f.lng);
    if (dist == null || dist > radiusMi) continue;
    out.push({ ...f, distanceMi: Math.round(dist * 100) / 100 });
  }
  out.sort((a, b) => a.distanceMi - b.distanceMi);
  return out;
}

/**
 * Compute saturation impact from nearby pipeline. Aggregates total NRSF +
 * CC NRSF + delivery year buckets, applies a flag-or-no-flag verdict
 * for the analyst's Y3 NOI projection.
 *
 * Flag thresholds (LOCKED — institutional rules of thumb):
 *   - ≥100K SF of new CC NRSF within 3 mi delivering Y1-Y3 → MATERIAL
 *     saturation flag. Suggested impact: Y3 occupancy −1pp, rent growth −1pp.
 *   - 50-100K SF → MODERATE flag. Watch for execution.
 *   - <50K SF or all delivering Y4+ → MINIMAL impact.
 *   - 0 SF → no flag.
 *
 * @param {Array<Object>} pipelineRows — output of getNearbyPipeline()
 * @param {number} [horizonYears=3]    — Y1-YN consideration window
 * @returns {Object} { flag, severity, totalNRSF, ccNRSF, deliveringInHorizon, verdict, narrative }
 */
export function assessPipelineSaturation(pipelineRows, horizonYears = 3) {
  if (!Array.isArray(pipelineRows) || pipelineRows.length === 0) {
    return {
      flag: false,
      severity: "NONE",
      totalNRSF: 0,
      ccNRSF: 0,
      deliveringInHorizon: 0,
      facilitiesInHorizon: 0,
      verdict: "no nearby pipeline",
      narrative: "No disclosed institutional REIT pipeline within proximity radius.",
    };
  }

  const currentYear = new Date().getFullYear();
  const horizonCutoff = currentYear + horizonYears;

  let totalNRSF = 0;
  let ccNRSF = 0;
  let deliveringInHorizon = 0;
  let facilitiesInHorizon = 0;
  for (const f of pipelineRows) {
    const deliveryYear = parseInt(String(f.expectedDelivery || "").slice(0, 4), 10);
    const inHorizon = Number.isFinite(deliveryYear) && deliveryYear <= horizonCutoff;
    const ccShare = (f.ccPct ?? 100) / 100;
    const ccSF = (f.nrsf || 0) * ccShare;
    totalNRSF += f.nrsf || 0;
    ccNRSF += ccSF;
    if (inHorizon) {
      deliveringInHorizon += f.nrsf || 0;
      facilitiesInHorizon += 1;
    }
  }

  const ccInHorizon = pipelineRows
    .filter((f) => {
      const dy = parseInt(String(f.expectedDelivery || "").slice(0, 4), 10);
      return Number.isFinite(dy) && dy <= horizonCutoff;
    })
    .reduce((s, f) => s + (f.nrsf || 0) * ((f.ccPct ?? 100) / 100), 0);

  let severity = "NONE";
  let verdict = "no nearby pipeline";
  let narrative = "No disclosed institutional REIT pipeline within proximity radius.";
  let flag = false;

  if (ccInHorizon >= 100000) {
    severity = "MATERIAL";
    flag = true;
    verdict = "MATERIAL pipeline saturation in Y1-Y3";
    narrative = `${facilitiesInHorizon} institutional REIT facilities (~${Math.round(ccInHorizon / 1000)}K SF CC) delivering within ${horizonYears} years and within proximity radius. Material new-supply pressure: Y3 occupancy is likely to compress ~1pp and rent growth ~1pp vs the unconstrained projection. Recommend explicit haircut on Y3 NOI assumption OR tighter buyer-lens cap.`;
  } else if (ccInHorizon >= 50000) {
    severity = "MODERATE";
    flag = true;
    verdict = "MODERATE pipeline saturation in Y1-Y3";
    narrative = `${facilitiesInHorizon} institutional REIT facilities (~${Math.round(ccInHorizon / 1000)}K SF CC) delivering within ${horizonYears} years and within proximity radius. Moderate new-supply pressure — Y3 occupancy may compress 0-0.5pp depending on absorption. Watch trade-area rent trends in 2026-2027.`;
  } else if (ccInHorizon > 0) {
    severity = "MINIMAL";
    flag = false;
    verdict = "minimal pipeline impact";
    narrative = `Limited disclosed REIT pipeline (~${Math.round(ccInHorizon / 1000)}K SF CC delivering in horizon). Below institutional saturation thresholds; no material adjustment to Y3 NOI projection recommended.`;
  } else if (totalNRSF > 0) {
    severity = "OUT_OF_HORIZON";
    flag = false;
    verdict = "pipeline outside horizon";
    narrative = `${pipelineRows.length} disclosed REIT facilities within proximity but all delivering after Y${horizonYears}. No material impact on Y1-Y${horizonYears} NOI projection.`;
  }

  return {
    flag,
    severity,
    totalNRSF,
    ccNRSF: Math.round(ccNRSF),
    ccNRSFInHorizon: Math.round(ccInHorizon),
    deliveringInHorizon,
    facilitiesInHorizon,
    facilityCount: pipelineRows.length,
    verdict,
    narrative,
  };
}

/**
 * Returns metadata about the development pipeline dataset — Phase, source,
 * total facility count, totals by operator / delivery year / status.
 */
export function getDevelopmentPipelineMetadata() {
  return {
    schema: developmentPipeline.schema,
    phase: developmentPipeline.phase,
    generatedAt: developmentPipeline.generatedAt,
    citationRule: developmentPipeline.citationRule,
    methodology: developmentPipeline.methodology,
    totalFacilities: developmentPipeline.totalFacilities,
    totalsByOperator: developmentPipeline.totalsByOperator,
    totalsByDeliveryYear: developmentPipeline.totalsByDeliveryYear,
    totalsByStatus: developmentPipeline.totalsByStatus,
  };
}

/**
 * Cross-REIT consolidated metadata — useful for the dashboard's coverage
 * banner and the Radius+ comparison card.
 */
export function getCrossREITScrapedRentMetadata() {
  const psa = getScrapedRentIndexMetadata();
  const cube = getCubeScrapedRentIndexMetadata();
  const exr = getExrScrapedRentIndexMetadata();
  const operators = [];
  let totalFacilities = 0;
  let totalUnitListings = 0;
  if (psa) {
    operators.push({ operator: "PSA", ...psa });
    totalFacilities += psa.totals?.facilities || 0;
    totalUnitListings += psa.totals?.unitListings || 0;
  }
  if (cube) {
    operators.push({ operator: "CUBE", ...cube });
    totalFacilities += cube.totals?.facilities || 0;
    totalUnitListings += cube.totals?.unitListings || 0;
  }
  if (exr) {
    operators.push({ operator: "EXR", ...exr });
    totalFacilities += exr.totals?.facilities || 0;
    totalUnitListings += exr.totals?.unitListings || 0;
  }
  return {
    operatorCount: operators.length,
    totalFacilities,
    totalUnitListings,
    operators,
  };
}

/**
 * Compute per-facility cost basis allocation for a single PS family facility,
 * using PSA's Schedule III MSA aggregate when available, falling back to
 * state-weighted PSF.
 *
 * @param {Object} facility — { brand, city, state, lat, lng }
 * @returns {Object|null} { estimatedGrossPSF, source, citation, basis: 'msa-aggregate' | 'state-weighted' | 'no-data' }
 */
export function estimateFacilityCostBasis(facility) {
  if (!facility?.state) return null;
  const stateCode = String(facility.state).toUpperCase().trim();
  const stateData = getEDGARStateData(stateCode);
  if (!stateData) return null;

  // Try MSA-level allocation first
  const msa = resolveCityToMSA(facility.city, stateCode);
  if (msa) {
    // PSA's Schedule III lists per-MSA aggregates. Find the matching record
    // (PSA's MSA names use slashes; the per-MSA same-store table uses hyphens).
    const psaMSALabels = {
      "Dallas-Ft. Worth": "Dallas/Ft. Worth",
      "Orlando-Daytona": "Orlando/Daytona",
      "Seattle-Tacoma": "Seattle/Tacoma",
    };
    const sched3Label = psaMSALabels[msa] || msa;
    const psaContrib = (stateData.perIssuer || []).find(
      (c) => c.issuer === "PSA" && c.sourceLabel && c.sourceLabel.includes(sched3Label.split("/")[0])
    );
    if (psaContrib?.impliedPSF) {
      const sources = edgarIndex.sources;
      return {
        estimatedGrossPSF: psaContrib.impliedPSF,
        msa,
        msaLabel: psaContrib.sourceLabel,
        basis: "msa-aggregate",
        facilities: psaContrib.facilities,
        nrsfThousands: psaContrib.nrsfThousands,
        totalGrossThou: psaContrib.totalGrossThou,
        source: `PSA Schedule III MSA aggregate for ${psaContrib.sourceLabel} (${psaContrib.facilities} facilities, ${(psaContrib.nrsfThousands / 1000).toFixed(1)}M SF, $${psaContrib.impliedPSF}/SF gross carrying basis).`,
        accessionNumber: sources?.PSA?.accessionNumber,
        filingURL: sources?.PSA?.filingURL,
      };
    }
  }

  // State-weighted fallback
  if (stateData.weightedPSF) {
    return {
      estimatedGrossPSF: stateData.weightedPSF,
      basis: "state-weighted",
      facilities: stateData.totalFacilities,
      nrsfThousands: stateData.totalNRSFThousands,
      totalGrossThou: stateData.totalGrossCarryingThou,
      numIssuers: stateData.numIssuersContributing,
      source: `Cross-REIT state weighted gross carrying $/SF for ${stateData.stateName} (${stateData.totalFacilities} facilities across ${stateData.numIssuersContributing} REITs, $${stateData.weightedPSF}/SF).`,
      accessionNumbers: (stateData.perIssuer || []).map((c) => edgarIndex.sources?.[c.issuer]?.accessionNumber).filter(Boolean),
    };
  }

  return null;
}

/**
 * Build the full enrichment for a single competitor facility — distance to
 * subject, cost-basis estimate from Schedule III, rent estimate from the
 * EDGAR rent calibration, AND scraped per-facility unit rents when available.
 * Pure function — caller supplies subject coords.
 */
export function enrichCompetitor(facility, subjectLat, subjectLng, haversineFn, options = {}) {
  if (!facility?.lat || !facility?.lng || typeof haversineFn !== "function") return null;
  const distanceMi = haversineFn(subjectLat, subjectLng, facility.lat, facility.lng);
  const stateCode = String(facility.state || "").toUpperCase().trim();
  const costBasis = estimateFacilityCostBasis(facility);

  // Rent estimate: try MSA first, fall back to state, then national.
  const msa = resolveCityToMSA(facility.city, stateCode);
  let rent = null;
  if (msa) {
    rent = getMSARentBand(msa);
  }
  if (!rent && stateCode) {
    rent = getStateRentBand(stateCode, { fallbackToNational: true });
  }

  // Scraped per-facility rents — primary-source unit-level pricing from PSA's
  // Schema.org SelfStorage entities. Match by facilityId when caller supplies
  // it (PS-branded facilities can be matched via name parsing or external
  // ID join). For NSA / iStorage / non-PS family facilities, scraped data is
  // not yet available — future sprints expand to those operators.
  const scraped = facility.facilityId ? getScrapedFacilityRents(facility.facilityId) : null;

  return {
    brand: facility.brand,
    name: facility.name,
    city: facility.city,
    state: facility.state,
    lat: facility.lat,
    lng: facility.lng,
    distanceMi: Math.round(distanceMi * 100) / 100,
    msa: msa || null,
    estimatedGrossPSF: costBasis?.estimatedGrossPSF ?? null,
    costBasisSource: costBasis?.source ?? null,
    costBasisBasis: costBasis?.basis ?? null,
    costBasisAccession: costBasis?.accessionNumber ?? null,
    estimatedRentPerOccSF_yr: rent?.weightedAnnualPerSF ?? null,
    estimatedCCRentPerSF_mo: rent?.ccRent ?? null,
    estimatedDURentPerSF_mo: rent?.duRent ?? null,
    rentSource: rent?.source ?? null,
    rentConfidence: rent?.confidence ?? null,
    rentCitations: rent?.citations ?? [],
    // Scraped per-facility data (when available) — overrides estimated rent
    // with primary-source move-in pricing
    scrapedRents: scraped ? {
      ccMedianPerSF_mo: scraped.ccMedianPerSF_mo,
      ccLowPerSF_mo: scraped.ccLowPerSF_mo,
      ccHighPerSF_mo: scraped.ccHighPerSF_mo,
      duMedianPerSF_mo: scraped.duMedianPerSF_mo,
      ccUnitsAvailable: scraped.ccUnitsAvailable,
      duUnitsAvailable: scraped.duUnitsAvailable,
      unitListings: scraped.unitListings,
      facilityUrl: scraped.facilityUrl,
      scrapedAt: scraped.scrapedAt,
      source: "PSA facility detail page (Schema.org SelfStorage entity)",
    } : null,
    hasScrapedData: !!scraped,
  };
}

/**
 * Compute the N nearest competitors within radiusMi of subject coords from
 * a pre-loaded facility list. Pure function — caller manages the facility
 * source (CSV load lives in analyzerEnrich.js for browser-side, or test
 * fixtures for unit tests).
 */
export function enrichNearbyCompetitors(facilities, subjectLat, subjectLng, options = {}) {
  const { radiusMi = 5, limit = 10, haversineFn } = options;
  if (!Array.isArray(facilities) || typeof haversineFn !== "function") return [];
  if (typeof subjectLat !== "number" || typeof subjectLng !== "number") return [];

  const enriched = [];
  for (const f of facilities) {
    const e = enrichCompetitor(f, subjectLat, subjectLng, haversineFn);
    if (e && e.distanceMi <= radiusMi) enriched.push(e);
  }
  // Sort by distance ascending
  enriched.sort((a, b) => a.distanceMi - b.distanceMi);
  return enriched.slice(0, limit);
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

/**
 * Historical per-MSA same-store rent time series for an issuer × MSA pair.
 * Sourced from PSA's "Same Store Facilities Operating Trends by Market" MD&A
 * disclosure across FY2021-FY2025 (and continuing as new 10-Ks file). Returns
 * the year-by-year series, plus first/last rent and computed CAGR.
 *
 * EXR + CUBE + NSA do not disclose per-MSA same-store rent in their MD&A
 * (they disclose portfolio-aggregate metrics only) — this accessor returns
 * null for those issuers. Use the per-facility scraped rent indices for
 * EXR/CUBE/NSA MSA-level rent.
 *
 * @param {string} msa — exact MSA label (e.g. "Los Angeles", "Houston")
 * @param {string} issuer — issuer ticker, default "PSA"
 * @returns {Object|null} { issuer, msa, series:[{year,rentPerOccSF,occupancy,facilities,sqftMillions}],
 *                          firstYear, lastYear, firstRent, lastRent, totalChangePct, cagrPct }
 */
export function getHistoricalMSARentSeries(msa, issuer = "PSA") {
  if (!historicalMSARents || !msa) return null;
  const upperIssuer = String(issuer).toUpperCase();
  const match = (historicalMSARents.timeSeries || []).find(
    (t) => t.issuer === upperIssuer && t.msa === msa
  );
  return match || null;
}

/**
 * Convenience: just the multi-year CAGR for a given issuer × MSA pair.
 * Returns null if no time series available or fewer than 2 datapoints.
 *
 * @param {string} msa
 * @param {string} issuer — default "PSA"
 * @returns {number|null} CAGR as decimal (e.g. 0.0681 for 6.81%/yr)
 */
export function getHistoricalMSACAGR(msa, issuer = "PSA") {
  const series = getHistoricalMSARentSeries(msa, issuer);
  if (!series || series.cagrPct == null) return null;
  return series.cagrPct / 100;
}

/**
 * List all MSAs covered by the historical rent backfill for a given issuer.
 * Used by the rent-anchor pipeline to detect when an MSA-keyed historical
 * series is available vs. when only state/portfolio fallbacks apply.
 *
 * @param {string} issuer — default "PSA"
 * @returns {Array<string>} list of MSA labels
 */
export function listHistoricalMSACoverage(issuer = "PSA") {
  if (!historicalMSARents) return [];
  const upperIssuer = String(issuer).toUpperCase();
  return (historicalMSARents.timeSeries || [])
    .filter((t) => t.issuer === upperIssuer)
    .map((t) => t.msa);
}

/**
 * Multi-year portfolio-aggregate same-store time series for an issuer × metric.
 * Sourced from each issuer's 10-K MD&A across FY2020-FY2025 (or earlier when
 * cached). Returned shape mirrors getHistoricalMSARentSeries but for portfolio-
 * level metrics that EXR / CUBE / NSA disclose without MSA breakouts.
 *
 * Available metrics: sameStoreRevenueGrowthYoY, sameStoreNOIGrowthYoY,
 *   sameStoreOccupancyEOP, sameStoreOccupancyAvg, sameStoreRentPerSF,
 *   newLeaseRentPerSF
 *
 * @param {string} issuer — issuer ticker (EXR, CUBE, NSA, LSI, SMA)
 * @param {string} metric — one of TIME_SERIES_METRICS above
 * @returns {Object|null} series + endpoints + CAGR (when level-metric)
 */
export function getHistoricalSameStoreSeries(issuer, metric) {
  if (!historicalSameStore || !issuer || !metric) return null;
  const upperIssuer = String(issuer).toUpperCase();
  const match = (historicalSameStore.timeSeries || []).find(
    (t) => t.issuer === upperIssuer && t.metric === metric
  );
  return match || null;
}

/**
 * Cross-REIT FY-latest portfolio-aggregate averages. Used by the IC memo
 * prompt + warehouseExport when the subject is a non-PSA buyer (or when a
 * cross-REIT comparison adds context to the institutional underwrite).
 *
 * @returns {Object|null} { asOf, avgSameStoreRentPerSF, avgSameStoreOccupancyEOP, ...}
 */
export function getCrossREITHistoricalLatest() {
  if (!historicalSameStore || !historicalSameStore.crossREITLatest) return null;
  return historicalSameStore.crossREITLatest;
}

/**
 * Metadata about the multi-year same-store backfill — issuers covered, years,
 * total time-series row count, generation timestamp.
 */
export function getHistoricalSameStoreMetadata() {
  if (!historicalSameStore) return null;
  return {
    schema: historicalSameStore.schema,
    generatedAt: historicalSameStore.generated_at,
    issuers: historicalSameStore.issuers,
    yearsCovered: historicalSameStore.yearsCovered,
    timeSeriesRows: (historicalSameStore.timeSeries || []).length,
    crossREITLatest: historicalSameStore.crossREITLatest,
  };
}

/**
 * Metadata about the historical-rent backfill (schema version, generation
 * timestamp, issuers + years covered). Used for audit/provenance display.
 */
export function getHistoricalRentMetadata() {
  if (!historicalMSARents) return null;
  return {
    schema: historicalMSARents.schema,
    generatedAt: historicalMSARents.generated_at,
    issuers: historicalMSARents.issuers,
    yearsCovered: historicalMSARents.yearsCovered,
    timeSeriesRows: (historicalMSARents.timeSeries || []).length,
    extractionLog: historicalMSARents.extractionLog,
  };
}

// ─── Move 2 · EDGAR Pipeline Disclosure accessors ────────────────────────────

/**
 * Per-issuer pipeline disclosure record (aggregate + per-property facilities)
 * extracted from each REIT's most recent 10-Q + 10-K. Returns null when the
 * disclosure file hasn't been generated yet or when the issuer key is unknown.
 */
export function getEdgarPipelineDisclosures(operatorKey) {
  if (!edgarPipelineDisclosures || !operatorKey) return null;
  return edgarPipelineDisclosures.issuers?.[String(operatorKey).toUpperCase()] || null;
}

/**
 * All per-property pipeline facility entries (CUBE + SMA today). Each carries
 * verifiedSource = "EDGAR-<form>-<accession>" which pipelineConfidence.js
 * automatically classifies as VERIFIED.
 */
export function getAllEdgarPipelineFacilities() {
  if (!edgarPipelineDisclosures || !edgarPipelineDisclosures.issuers) return [];
  const out = [];
  for (const r of Object.values(edgarPipelineDisclosures.issuers)) {
    for (const f of r.allFacilities || []) out.push(f);
  }
  return out;
}

/**
 * Cross-issuer aggregate pipeline disclosures (PSA remaining-spend, EXR
 * balance-sheet, NSA narrative). Useful for the report-level "REIT pipeline
 * footprint" summary strip.
 */
export function getAllEdgarPipelineDisclosures() {
  if (!edgarPipelineDisclosures || !edgarPipelineDisclosures.issuers) return [];
  const out = [];
  for (const r of Object.values(edgarPipelineDisclosures.issuers)) {
    for (const d of r.allDisclosures || []) out.push(d);
  }
  return out;
}

/**
 * Top-level meta + counts about the pipeline disclosures ingest run.
 */
export function getEdgarPipelineMetadata() {
  if (!edgarPipelineDisclosures) return null;
  return {
    schema: edgarPipelineDisclosures.schema,
    generatedAt: edgarPipelineDisclosures.generatedAt,
    totalIssuers: edgarPipelineDisclosures.totalIssuers,
    totalFilings: edgarPipelineDisclosures.totalFilings,
    totalDisclosures: edgarPipelineDisclosures.totalDisclosures,
    totalFacilities: edgarPipelineDisclosures.totalFacilities,
    issuers: Object.keys(edgarPipelineDisclosures.issuers || {}),
  };
}

// ─── Crush Radius+ CC RENT wedge — rent trajectory accessors ─────────────────

/**
 * Top-level metadata for the cross-REIT rent trajectory file.
 */
export function getRentTrajectoryMetadata() {
  if (!rentTrajectory) return null;
  return {
    schema: rentTrajectory.schema,
    generatedAt: rentTrajectory.generatedAt,
    daysCovered: rentTrajectory.daysCovered,
    earliestDate: rentTrajectory.earliestDate,
    latestDate: rentTrajectory.latestDate,
    operators: rentTrajectory.operators,
    msasCovered: rentTrajectory.msasCovered,
    totalSnapshots: rentTrajectory.totalSnapshots,
  };
}

/**
 * Per-MSA-per-operator trajectory series. Returns an array of snapshots
 * ordered by date ascending — each snapshot has date, ccMedianPerSF_mo,
 * duMedianPerSF_mo, facility count, unit listings count. Returns empty
 * array when no series available.
 */
export function getRentTrajectorySeries(msa, operator) {
  if (!rentTrajectory || !rentTrajectory.snapshots) return [];
  const m = String(msa || "").trim().toLowerCase();
  const op = String(operator || "").trim().toUpperCase();
  return rentTrajectory.snapshots
    .filter((s) => s.operator === op && String(s.msa || "").trim().toLowerCase() === m)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * All operators that have at least one snapshot in the named MSA.
 */
export function listOperatorsForMSA(msa) {
  if (!rentTrajectory || !rentTrajectory.snapshots) return [];
  const m = String(msa || "").trim().toLowerCase();
  const set = new Set();
  for (const s of rentTrajectory.snapshots) {
    if (String(s.msa || "").trim().toLowerCase() === m) set.add(s.operator);
  }
  return Array.from(set).sort();
}

/**
 * Compute trajectory summary stats for one operator/MSA pair — first / last
 * rent + N-day delta + % change.
 */
export function summarizeRentTrajectory(msa, operator) {
  const series = getRentTrajectorySeries(msa, operator);
  if (series.length === 0) return null;
  const first = series[0];
  const last = series[series.length - 1];
  const ccDelta = first.ccMedianPerSF_mo != null && last.ccMedianPerSF_mo != null
    ? last.ccMedianPerSF_mo - first.ccMedianPerSF_mo
    : null;
  const ccPctChange = first.ccMedianPerSF_mo && ccDelta != null
    ? (ccDelta / first.ccMedianPerSF_mo) * 100
    : null;
  return {
    operator: last.operator,
    msa: last.msa,
    snapshots: series.length,
    earliestDate: first.date,
    latestDate: last.date,
    ccMedianFirst: first.ccMedianPerSF_mo,
    ccMedianLatest: last.ccMedianPerSF_mo,
    ccDelta,
    ccPctChange,
    duMedianFirst: first.duMedianPerSF_mo,
    duMedianLatest: last.duMedianPerSF_mo,
    facilitiesLatest: last.facilitiesScraped,
    unitListingsLatest: last.totalUnitListings,
    series,
  };
}

/**
 * Convenience: total dollar value of REIT-disclosed forward pipeline activity.
 * Sums PSA's "remaining-spend" aggregate, EXR's balance-sheet under-development
 * line item (current-year), CUBE's named-JV expected investment, and SMA's
 * per-property CIP totals. Numbers in dollars (not millions / thousands).
 */
export function getEdgarPipelineTotalDollars() {
  if (!edgarPipelineDisclosures || !edgarPipelineDisclosures.issuers) return null;
  let total = 0;
  let contributingIssuers = [];
  for (const [issuerKey, r] of Object.entries(edgarPipelineDisclosures.issuers)) {
    let issuerSum = 0;
    for (const d of r.allDisclosures || []) {
      if (d.kind === "aggregate-remaining-spend" && d.remainingSpendMillion != null) {
        // Prefer latest filing (10-Q), de-dupe vs 10-K by skipping the older one
        // when we've already seen a more recent disclosure for this issuer.
        if (d.form === "10-Q" || issuerSum === 0) {
          issuerSum = d.remainingSpendMillion * 1_000_000;
        }
      } else if (d.kind === "balance-sheet-under-development" && d.currentYearThousands != null) {
        // Same: prefer 10-Q over 10-K when both populate
        if (d.form === "10-Q" || issuerSum === 0) {
          issuerSum = d.currentYearThousands * 1000;
        }
      } else if (d.kind === "named-jv-under-construction" && d.expectedMillion != null) {
        issuerSum += d.expectedMillion * 1_000_000;
      }
    }
    // Add per-property facility CIP for SMA
    for (const f of r.allFacilities || []) {
      if (f.ciInProgress != null && issuerKey === "SMA") {
        issuerSum += f.ciInProgress;
      }
    }
    if (issuerSum > 0) {
      total += issuerSum;
      contributingIssuers.push({ operator: issuerKey, dollars: issuerSum });
    }
  }
  return { total, byIssuer: contributingIssuers };
}

export default {
  getEDGARStateData,
  formatEDGARCitation,
  getCalibratedSameStoreGrowth,
  getECRIPremiumIndex,
  getHistoricalMSARentSeries,
  getHistoricalMSACAGR,
  listHistoricalMSACoverage,
  getHistoricalRentMetadata,
  getHistoricalSameStoreSeries,
  getCrossREITHistoricalLatest,
  getHistoricalSameStoreMetadata,
  // Move 2 · pipeline disclosures
  getEdgarPipelineDisclosures,
  getAllEdgarPipelineFacilities,
  getAllEdgarPipelineDisclosures,
  getEdgarPipelineMetadata,
  getEdgarPipelineTotalDollars,
  // Crush Radius+ CC RENT · trajectory accessors
  getRentTrajectoryMetadata,
  getRentTrajectorySeries,
  listOperatorsForMSA,
  summarizeRentTrajectory,
  getEDGAR8KTransactions,
  getRelevant8KTransactions,
  getStateRentBand,
  getMSARentBand,
  getBestRentBand,
  getBuyerSpecificRentAnchor,
  getNearbyPipeline,
  assessPipelineSaturation,
  getDevelopmentPipelineMetadata,
  resolveCityToMSA,
  estimateFacilityCostBasis,
  enrichCompetitor,
  enrichNearbyCompetitors,
  // PSA scraped rent accessors (legacy, retained for backwards compat)
  getScrapedFacilityRents,
  getScrapedMSARentMedian,
  getScrapedRentIndexMetadata,
  // CUBE scraped rent accessors
  getCubeFacilityRents,
  getCubeStateRentMedian,
  getCubeMSARentMedian,
  getCubeScrapedRentIndexMetadata,
  // EXR scraped rent accessors
  getExrFacilityRents,
  getExrStateRentMedian,
  getExrMSARentMedian,
  getExrScrapedRentIndexMetadata,
  // Cross-REIT consolidated accessors
  getMSAMoveInRatesByOperator,
  getCrossREITScrapedRentMetadata,
  EDGAR_INDEX_METADATA,
  EDGAR_RENT_CALIBRATION_METADATA,
};
