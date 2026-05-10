// Vercel Serverless Function — EDGAR-calibrated market rent endpoint.
//
// GET /api/sparefoot-rents?city=Temple&state=TX&zip=76501&lat=31.1&lon=-97.3
// Returns: { ok, source, ccRent, duRent, confidence, sampleFacilities,
//             citations, primarySource: true, generatedAt, ... }
//
// HISTORY: This endpoint previously scraped SpareFoot (a third-party storage
// listing site) for market rents, with a hard-coded STATE_RENT_BANDS fallback
// when SpareFoot's Cloudflare bot protection blocked the scrape (which was
// most of the time — 403 in production).
//
// 2026-05-09 sprint: replaced with EDGAR-calibrated bands derived from the
// SEC EDGAR Schedule III + same-store rent disclosures of PSA / EXR / CUBE /
// SMA. Every returned band cites specific 10-K accession numbers and filing
// URLs. No third-party scraping — primary source is sec.gov, indexed offline
// via scripts/edgar/build-rent-calibration.mjs.
//
// The endpoint URL stays /api/sparefoot-rents for backward compatibility with
// existing callers (analyzerEnrich.js + QuickLookupPanel.js + warehouseExport.js).
// Response shape kept compatible: ok / ccRent / duRent / fallback / confidence.

const calibration = require("../src/data/edgar-rent-calibration.json");

function buildStateBand(stateCode) {
  if (!stateCode) return null;
  const code = String(stateCode).toUpperCase().trim();
  const state = (calibration.states || []).find((s) => s.stateCode === code);
  if (!state || state.ccRent == null) return null;
  const cites = (state.issuerContributions || [])
    .filter((c) => c.contributionToWeight > 0 && c.accessionNumber)
    .map((c) => ({
      issuer: c.issuer,
      facilities: c.facilities,
      accessionNumber: c.accessionNumber,
      filingURL: c.filingURL,
      reportDate: c.reportDate,
    }));
  return {
    stateCode: state.stateCode,
    stateName: state.stateName,
    ccRent: state.ccRent,
    duRent: state.duRent,
    confidence: state.confidence,
    sampleFacilities: state.sampleFacilities,
    contributingIssuers: state.contributingIssuers,
    stateWeightedPSF: state.stateWeightedPSF,
    geoMultiplier: state.geoMultiplier,
    weightedAnnualPerSF: state.weightedAnnualPerSF,
    citations: cites,
  };
}

function nationalBand() {
  const nat = calibration.nationalFallback;
  return {
    stateCode: null,
    stateName: "United States (national average)",
    ccRent: nat?.ccRent ?? null,
    duRent: nat?.duRent ?? null,
    confidence: nat?.confidence ?? null,
    sampleFacilities: nat?.sampleFacilities ?? 0,
    contributingIssuers: calibration.issuerPortfolioRents
      ? Object.keys(calibration.issuerPortfolioRents)
      : [],
    citations: [],
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Accept GET query or POST body
  let q = req.query || {};
  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      q = { ...q, ...body };
    } catch {
      // ignore body parse failures, fall back to query
    }
  }

  const city = (q.city || "").trim();
  const state = String(q.state || "").trim().toUpperCase();

  const stateBand = buildStateBand(state);
  if (stateBand) {
    return res.status(200).json({
      ok: true,
      source: "EDGAR-calibrated cross-REIT primary source",
      primarySource: true,
      city,
      state,
      ccRent: stateBand.ccRent,
      duRent: stateBand.duRent,
      ccSampleCount: null, // unit-level sample count not applicable; portfolio-derived
      duSampleCount: null,
      compCount: stateBand.sampleFacilities,
      confidence: `EDGAR-calibrated · ${stateBand.contributingIssuers.join(" + ")} · ${stateBand.sampleFacilities} REIT facilities sampled in ${stateBand.stateName} (${stateBand.confidence} confidence)`,
      bands: null, // P25/P75 unit-level bands not applicable for portfolio-derived
      stateName: stateBand.stateName,
      contributingIssuers: stateBand.contributingIssuers,
      sampleFacilities: stateBand.sampleFacilities,
      stateWeightedPSF: stateBand.stateWeightedPSF,
      geoMultiplier: stateBand.geoMultiplier,
      weightedAnnualPerSF: stateBand.weightedAnnualPerSF,
      citations: stateBand.citations,
      methodology: "EDGAR Rent Calibration Index v1: per-state weighted average annual rent per SF derived from PSA/EXR/CUBE/SMA 10-K same-store disclosures, weighted by each REIT's facility footprint (Schedule III). CC mix 73%, CC premium 80% over DU. State-specific geographic adjustment via square-root damped Schedule III weighted gross carrying $/SF.",
      generatedAt: new Date().toISOString(),
    });
  }

  // No state-level data available — fall back to national EDGAR average
  const nat = nationalBand();
  return res.status(200).json({
    ok: true,
    source: "EDGAR-calibrated national average",
    primarySource: true,
    fallback: true,
    city,
    state,
    ccRent: nat.ccRent,
    duRent: nat.duRent,
    compCount: nat.sampleFacilities,
    confidence: `EDGAR-calibrated NATIONAL average · ${nat.sampleFacilities} REIT facilities aggregated across all states (${state ? "no state-specific data for " + state : "no state provided"})`,
    bands: null,
    contributingIssuers: nat.contributingIssuers,
    sampleFacilities: nat.sampleFacilities,
    methodology: "EDGAR Rent Calibration Index v1: national fallback aggregates portfolio rents across all REIT facilities (PSA + EXR + CUBE + SMA) when state-specific calibration is unavailable.",
    generatedAt: new Date().toISOString(),
  });
};
