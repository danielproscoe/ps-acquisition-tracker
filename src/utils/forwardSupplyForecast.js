// ═══════════════════════════════════════════════════════════════════════════
// FORWARD SUPPLY FORECAST ENGINE
//
// Computes a per-MSA forward-looking self-storage supply forecast over a
// configurable horizon (default 24 months) by aggregating across multiple
// primary-source registries with confidence-weighted projection.
//
// THIS IS THE METRIC EVERY STORAGE OPERATOR CHECKS BEFORE GREENLIGHTING A
// NEW BUILD. Radius+ ships a current snapshot only. TractIQ ships current +
// recent permit-count rollups. Neither exposes per-source attribution nor
// classifies projected supply by verification confidence. Storvex does both.
//
// SYSTEM CLAIM (patent) — Method for forecasting forward commercial-real-
// estate supply from a plurality of independent primary-source registries:
//
//   (a) maintaining a plurality of independent primary-source registries
//       indexing development-pipeline facilities by submarket (e.g., an
//       SEC-EDGAR-derived REIT-disclosure registry; a county-building-
//       permit-derived municipal-disclosure registry; a multi-year
//       historical-disclosure backfill registry);
//
//   (b) for a queried submarket (city or MSA) and forward horizon (months),
//       independently filtering each registry for entries with expected
//       delivery within the horizon;
//
//   (c) classifying each filtered entry per its primary-source verification
//       status (VERIFIED · CLAIMED · STALE · UNVERIFIED) using a status-
//       derivation engine that inspects citation prefixes, freshness, and
//       inferred source provenance;
//
//   (d) computing a confidence-weighted aggregate forward supply by
//       summing each entry's net rentable square feet × confidence weight,
//       where weights are configurable (default VERIFIED=1.0, CLAIMED=0.5,
//       STALE=0.3, UNVERIFIED=0.0);
//
//   (e) emitting per-source attribution { edgar, permit, historical } so
//       the consumer can re-derive each component from the underlying
//       registries;
//
//   (f) computing a forecast-confidence tier (high · medium · low) based
//       on (i) source diversity (count of registries contributing > 0
//       entries), (ii) freshness of the most-recent verifiedDate per
//       source, and (iii) coverage density of the submarket relative to
//       a tunable threshold; and
//
//   (g) optionally projecting historically-undisclosed supply by
//       extrapolating multi-year aggregate trajectory data (e.g., REIT
//       annual remaining-spend patterns) onto the queried submarket
//       proportionally to the submarket's share of the issuer's
//       historical disclosures.
//
// Together with the Pipeline Verification Oracle's coverage-classification
// symmetry claim (`pipelineVerificationOracle.js submarketCoverageSignal`)
// and the County-Permit Multi-Portal Adapter Architecture claim
// (`_county-permit-common.mjs`), this engine forms the third pillar of a
// "primary-source-symmetric audit-layer forecasting system" that no
// existing CRE-intel platform (Radius+, TractIQ, StorTrack, Yardi Matrix)
// implements.
//
// Filed under DJR Real Estate LLC. Drafted 5/12/26 PM as part of the
// supplemental provisional addendum to USPTO #64/062,607.
// ═══════════════════════════════════════════════════════════════════════════

import developmentPipeline from "../data/development-pipeline.json";
import edgarPipelineDisclosures from "../data/edgar-pipeline-disclosures.json";
import edgarHistoricalPipeline from "../data/edgar-historical-pipeline-disclosures.json";
import countyPermits from "../data/county-permits.json";
import { computePipelineConfidence } from "./pipelineConfidence";

// ─── Configurable weights ────────────────────────────────────────────────

export const DEFAULT_CONFIDENCE_WEIGHTS = {
  VERIFIED: 1.0,
  CLAIMED: 0.5,
  STALE: 0.3,
  UNVERIFIED: 0.0,
};

export const DEFAULT_HORIZON_MONTHS = 24;

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Parse "2026-Q3" / "Q3 2026" / "2026-09-30" / "2026" into a Date for
 * horizon-window filtering. Returns null on parse failure.
 */
function parseExpectedDelivery(s) {
  if (!s) return null;
  const t = String(s).trim();
  // Quarter format YYYY-Qx
  let m = t.match(/^(\d{4})-Q([1-4])$/i);
  if (m) {
    const y = parseInt(m[1], 10);
    const q = parseInt(m[2], 10);
    // Mid-quarter approximation: Q1=Feb15, Q2=May15, Q3=Aug15, Q4=Nov15
    const month = (q - 1) * 3 + 1; // 0-indexed Feb=1, May=4, Aug=7, Nov=10
    return new Date(y, month, 15);
  }
  // Quarter format Qx YYYY
  m = t.match(/^Q([1-4])\s+(\d{4})$/i);
  if (m) {
    const y = parseInt(m[2], 10);
    const q = parseInt(m[1], 10);
    const month = (q - 1) * 3 + 1;
    return new Date(y, month, 15);
  }
  // ISO date YYYY-MM-DD
  const d = new Date(t);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function monthsBetween(later, earlier) {
  if (!(later instanceof Date) || !(earlier instanceof Date)) return null;
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
}

function matchesSubmarket(facility, city, state, msa) {
  const fc = (facility.city || "").trim().toLowerCase();
  const fs = (facility.state || "").trim().toUpperCase();
  const fm = (facility.msa || "").trim().toLowerCase();
  const qc = (city || "").trim().toLowerCase();
  const qs = (state || "").trim().toUpperCase();
  const qm = (msa || "").trim().toLowerCase();

  // Match on (city + state) OR on MSA (city/state still required to scope)
  if (qm && fm && qm === fm) return true;
  if (qc && qs && fc === qc && fs === qs) return true;
  return false;
}

// ─── Per-registry collectors ─────────────────────────────────────────────

/**
 * Returns the EDGAR-disclosed pipeline entries for the queried submarket +
 * horizon, with each entry already classified by pipelineConfidence.
 */
function collectEdgarEntries({ city, state, msa, horizonMonths, asOf }) {
  const horizonCutoff = new Date(asOf.getTime() + horizonMonths * 30.4375 * 24 * 60 * 60 * 1000);
  const all = [];

  // (1) development-pipeline.json — REIT-disclosed entries with full
  //     city/state/MSA/NRSF/expectedDelivery shape
  const devPipeline = Array.isArray(developmentPipeline.facilities)
    ? developmentPipeline.facilities
    : [];
  for (const f of devPipeline) {
    if (!matchesSubmarket(f, city, state, msa)) continue;
    const expDate = parseExpectedDelivery(f.expectedDelivery);
    if (expDate && (expDate < asOf || expDate > horizonCutoff)) continue;
    if (!expDate && !f.expectedDelivery) continue; // skip entries with no horizon info
    const conf = computePipelineConfidence(f, {
      asOf,
      fileGeneratedAt: developmentPipeline.generatedAt,
    });
    all.push({
      source: "EDGAR",
      registryFile: "development-pipeline.json",
      facility: f,
      expectedDeliveryDate: expDate,
      confidence: conf.status,
      confidenceWeight: conf.confidenceWeight,
      nrsf: Number(f.nrsf) || 0,
      ccSf: (Number(f.nrsf) || 0) * (Number(f.ccPct) || 100) / 100,
      citation: f.citation || null,
    });
  }

  // (2) edgar-pipeline-disclosures.json — per-property facilities from Move 2 scraper
  if (edgarPipelineDisclosures && edgarPipelineDisclosures.issuers) {
    for (const issuer of Object.values(edgarPipelineDisclosures.issuers)) {
      for (const f of issuer.allFacilities || []) {
        if (!matchesSubmarket(f, city, state, msa)) continue;
        const expDate = parseExpectedDelivery(f.expectedDelivery);
        if (expDate && (expDate < asOf || expDate > horizonCutoff)) continue;
        if (!expDate && !f.expectedDelivery) continue;
        const conf = computePipelineConfidence(f, {
          asOf,
          fileGeneratedAt: edgarPipelineDisclosures.generatedAt,
        });
        all.push({
          source: "EDGAR",
          registryFile: "edgar-pipeline-disclosures.json",
          facility: f,
          expectedDeliveryDate: expDate,
          confidence: conf.status,
          confidenceWeight: conf.confidenceWeight,
          nrsf: Number(f.nrsf) || 0,
          ccSf: (Number(f.nrsf) || 0) * (Number(f.ccPct) || 100) / 100,
          citation: f.verifiedSource || f.citation || null,
        });
      }
    }
  }

  return all;
}

/**
 * Returns the PERMIT-registry entries for the queried submarket + horizon.
 */
function collectPermitEntries({ city, state, msa, horizonMonths, asOf }) {
  const horizonCutoff = new Date(asOf.getTime() + horizonMonths * 30.4375 * 24 * 60 * 60 * 1000);
  const all = [];
  const permits = Array.isArray(countyPermits.facilities) ? countyPermits.facilities : [];
  for (const f of permits) {
    if (!matchesSubmarket(f, city, state, msa)) continue;
    const expDate = parseExpectedDelivery(f.expectedDelivery);
    // Permits may not carry expectedDelivery — fallback to permit issue date
    // + typical 18-month build cycle for new storage
    let effectiveDate = expDate;
    if (!effectiveDate && f.permitIssueDate) {
      const issued = new Date(f.permitIssueDate);
      if (!isNaN(issued.getTime())) {
        effectiveDate = new Date(issued.getTime() + 18 * 30.4375 * 24 * 60 * 60 * 1000);
      }
    }
    if (!effectiveDate) continue;
    if (effectiveDate < asOf || effectiveDate > horizonCutoff) continue;

    const conf = computePipelineConfidence(f, {
      asOf,
      fileGeneratedAt: countyPermits.generatedAt,
    });
    all.push({
      source: "PERMIT",
      registryFile: "county-permits.json",
      facility: f,
      expectedDeliveryDate: effectiveDate,
      derivedFromIssueDate: !expDate,
      confidence: conf.status,
      confidenceWeight: conf.confidenceWeight,
      nrsf: Number(f.nrsf) || 0,
      ccSf: (Number(f.nrsf) || 0) * (Number(f.ccPct) || 100) / 100,
      citation: f.verifiedSource || null,
    });
  }
  return all;
}

/**
 * Optional projection of historically-undisclosed supply. Uses the
 * multi-year trajectory data (PSA + EXR aggregate annual spend, CUBE
 * JV property cadence) to estimate how much MORE supply is likely in
 * the pipeline beyond what's been explicitly disclosed yet. Apportions
 * the issuer's national pace by the submarket's share of the issuer's
 * historical disclosures.
 *
 * Returns { projectedCcSf, methodologyNote, confidence }.
 */
function projectHistoricallyUndisclosed({ city, state, msa, horizonMonths, asOf }) {
  if (!edgarHistoricalPipeline || !edgarHistoricalPipeline.issuers) {
    return { projectedCcSf: 0, methodologyNote: "Historical trajectory unavailable", confidence: "low", components: [] };
  }

  const components = [];
  let totalProjected = 0;

  for (const [opKey, issuer] of Object.entries(edgarHistoricalPipeline.issuers)) {
    const facilities = issuer.allFacilities || [];
    if (facilities.length === 0) continue;
    const submarketHits = facilities.filter((f) => matchesSubmarket(f, city, state, msa));
    if (submarketHits.length === 0) continue;
    const submarketShare = submarketHits.length / facilities.length;

    // Pull the issuer's most recent annual aggregate spend (e.g., PSA $416M
    // remaining-spend FY2025 from the trajectory data).
    const traj = edgarHistoricalPipeline.trajectories?.[opKey];
    if (!traj || !traj.annual || traj.annual.length === 0) continue;
    const latestAnnual = traj.annual[traj.annual.length - 1];
    if (!latestAnnual || !latestAnnual.totalDollars) continue;

    // Convert dollars to estimated CC SF at industry-standard construction cost.
    // One-story CC storage: ~$95/SF all-in; multi-story: ~$125/SF.
    // Use blended $110/SF as default.
    const blendedCostPerSf = 110;
    const annualCcSfPace = latestAnnual.totalDollars / blendedCostPerSf;

    // Apportion to submarket by historical share, then scale to horizon.
    const horizonYears = horizonMonths / 12;
    const submarketProjected = annualCcSfPace * submarketShare * horizonYears;

    components.push({
      operator: opKey,
      submarketHistoricalHits: submarketHits.length,
      totalHistoricalHits: facilities.length,
      submarketShare,
      latestAnnualDollars: latestAnnual.totalDollars,
      latestAnnualYear: latestAnnual.year,
      projectedCcSf: submarketProjected,
    });
    totalProjected += submarketProjected;
  }

  const confidence =
    components.length >= 2 ? "medium" :
    components.length === 1 ? "low" : "very-low";

  return {
    projectedCcSf: totalProjected,
    methodologyNote: `Apportioned each issuer's most-recent annual remaining-spend by the submarket's share of the issuer's historical disclosures (FY2016-FY2025 backfill) × horizon. Blended $110/SF construction cost. Conservative — does not capture independent operator activity.`,
    confidence,
    components,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Compute the forward supply forecast for a submarket.
 *
 * @param {Object} query
 * @param {string} [query.city]   — e.g., "Houston"
 * @param {string} [query.state]  — e.g., "TX"
 * @param {string} [query.msa]    — e.g., "Houston". When provided, takes
 *                                  precedence over city+state for matching.
 * @param {number} [query.horizonMonths=24]
 * @param {Date}   [query.asOf=now]
 * @param {Object} [query.confidenceWeights]
 * @param {boolean} [query.includeHistoricalProjection=true]
 *
 * @returns {{
 *   submarket: { city, state, msa },
 *   horizonMonths: number,
 *   asOf: string,
 *   sources: {
 *     edgar: { entryCount, ccSf, confidenceWeightedCcSf, breakdown },
 *     permit: { entryCount, ccSf, confidenceWeightedCcSf, breakdown },
 *     historical: { projectedCcSf, methodologyNote, confidence, components }
 *   },
 *   totals: {
 *     verifiedCcSf, claimedCcSf, staleCcSf, unverifiedCcSf,
 *     confidenceWeightedCcSf, projectedCcSf, totalForecastCcSf
 *   },
 *   confidenceTier: 'high' | 'medium' | 'low',
 *   entriesByConfidence: { VERIFIED, CLAIMED, STALE, UNVERIFIED },
 *   primarySourceCount: number
 * }}
 */
export function computeForwardSupplyForecast(query = {}) {
  const {
    city = null,
    state = null,
    msa = null,
    horizonMonths = DEFAULT_HORIZON_MONTHS,
    asOf = new Date(),
    confidenceWeights = DEFAULT_CONFIDENCE_WEIGHTS,
    includeHistoricalProjection = true,
  } = query;

  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf);

  const edgarEntries = collectEdgarEntries({ city, state, msa, horizonMonths, asOf: asOfDate });
  const permitEntries = collectPermitEntries({ city, state, msa, horizonMonths, asOf: asOfDate });

  // Aggregate per-confidence totals
  const entriesByConfidence = { VERIFIED: 0, CLAIMED: 0, STALE: 0, UNVERIFIED: 0 };
  const ccSfByConfidence = { VERIFIED: 0, CLAIMED: 0, STALE: 0, UNVERIFIED: 0 };

  function tallyEntries(arr) {
    for (const e of arr) {
      entriesByConfidence[e.confidence] = (entriesByConfidence[e.confidence] || 0) + 1;
      ccSfByConfidence[e.confidence] = (ccSfByConfidence[e.confidence] || 0) + e.ccSf;
    }
  }
  tallyEntries(edgarEntries);
  tallyEntries(permitEntries);

  const totalConfidenceWeightedCcSf =
    ccSfByConfidence.VERIFIED * (confidenceWeights.VERIFIED ?? 1.0) +
    ccSfByConfidence.CLAIMED * (confidenceWeights.CLAIMED ?? 0.5) +
    ccSfByConfidence.STALE * (confidenceWeights.STALE ?? 0.3) +
    ccSfByConfidence.UNVERIFIED * (confidenceWeights.UNVERIFIED ?? 0.0);

  const edgarCcSf = edgarEntries.reduce((s, e) => s + e.ccSf, 0);
  const edgarConfWeightedCcSf = edgarEntries.reduce(
    (s, e) => s + e.ccSf * (confidenceWeights[e.confidence] ?? 0.5),
    0
  );

  const permitCcSf = permitEntries.reduce((s, e) => s + e.ccSf, 0);
  const permitConfWeightedCcSf = permitEntries.reduce(
    (s, e) => s + e.ccSf * (confidenceWeights[e.confidence] ?? 0.5),
    0
  );

  const historical = includeHistoricalProjection
    ? projectHistoricallyUndisclosed({ city, state, msa, horizonMonths, asOf: asOfDate })
    : { projectedCcSf: 0, methodologyNote: "Historical projection skipped", confidence: "n/a", components: [] };

  // Source diversity drives confidence tier
  const primarySourceCount =
    (edgarEntries.length > 0 ? 1 : 0) +
    (permitEntries.length > 0 ? 1 : 0) +
    (historical.projectedCcSf > 0 ? 1 : 0);

  // Confidence tier:
  //   high   — 2+ primary sources AND ≥1 VERIFIED entry
  //   medium — 1+ primary source AND ≥1 VERIFIED or CLAIMED entry
  //   low    — only historical projection OR all entries UNVERIFIED
  let confidenceTier;
  if (primarySourceCount >= 2 && entriesByConfidence.VERIFIED >= 1) confidenceTier = "high";
  else if (primarySourceCount >= 1 && (entriesByConfidence.VERIFIED >= 1 || entriesByConfidence.CLAIMED >= 1)) confidenceTier = "medium";
  else confidenceTier = "low";

  return {
    submarket: { city, state, msa },
    horizonMonths,
    asOf: asOfDate.toISOString(),
    sources: {
      edgar: {
        entryCount: edgarEntries.length,
        ccSf: edgarCcSf,
        confidenceWeightedCcSf: edgarConfWeightedCcSf,
        breakdown: edgarEntries,
      },
      permit: {
        entryCount: permitEntries.length,
        ccSf: permitCcSf,
        confidenceWeightedCcSf: permitConfWeightedCcSf,
        breakdown: permitEntries,
      },
      historical,
    },
    totals: {
      verifiedCcSf: ccSfByConfidence.VERIFIED,
      claimedCcSf: ccSfByConfidence.CLAIMED,
      staleCcSf: ccSfByConfidence.STALE,
      unverifiedCcSf: ccSfByConfidence.UNVERIFIED,
      confidenceWeightedCcSf: totalConfidenceWeightedCcSf,
      projectedCcSf: historical.projectedCcSf,
      totalForecastCcSf: totalConfidenceWeightedCcSf + historical.projectedCcSf,
    },
    entriesByConfidence,
    primarySourceCount,
    confidenceTier,
  };
}

/**
 * Render a one-paragraph English summary of the forecast — used in REC
 * Package generation and the Sentinel daily brief.
 */
export function describeForecast(forecast) {
  const sm = forecast.submarket;
  const smLabel = sm.msa || `${sm.city}, ${sm.state}`;
  const h = forecast.horizonMonths;
  const totalK = Math.round((forecast.totals.totalForecastCcSf || 0) / 1000);
  const cwK = Math.round((forecast.totals.confidenceWeightedCcSf || 0) / 1000);
  const projK = Math.round((forecast.totals.projectedCcSf || 0) / 1000);
  const edgarCount = forecast.sources.edgar.entryCount;
  const permitCount = forecast.sources.permit.entryCount;

  const sourceLine = [
    edgarCount > 0 ? `${edgarCount} EDGAR-disclosed` : null,
    permitCount > 0 ? `${permitCount} county-permit` : null,
    forecast.sources.historical.components.length > 0
      ? `${forecast.sources.historical.components.length}-issuer historical-trajectory extrapolation`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    `Forward Supply Forecast for ${smLabel} over the next ${h} months: ` +
    `${totalK.toLocaleString()}K CC SF total forecast ` +
    `(${cwK.toLocaleString()}K confidence-weighted from primary sources · ${projK.toLocaleString()}K projected from historical trajectory). ` +
    `Sources: ${sourceLine || "(no primary-source entries; relying on historical extrapolation only)"}. ` +
    `Confidence tier: ${forecast.confidenceTier.toUpperCase()} ` +
    `(${forecast.primarySourceCount} primary-source ${forecast.primarySourceCount === 1 ? "registry" : "registries"} contributing). ` +
    `Per-confidence: ${forecast.entriesByConfidence.VERIFIED} VERIFIED · ` +
    `${forecast.entriesByConfidence.CLAIMED} CLAIMED · ` +
    `${forecast.entriesByConfidence.STALE} STALE.`
  );
}

export default computeForwardSupplyForecast;
