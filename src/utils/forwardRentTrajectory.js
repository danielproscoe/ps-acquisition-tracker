// ═══════════════════════════════════════════════════════════════════════════
// FORWARD RENT TRAJECTORY FORECAST
//
// Projects per-MSA forward CC + DU rents year-by-year over a configurable
// horizon (default 60 months / 5 years), combining:
//   • Historical CAGR baseline from SEC EDGAR REIT MD&A (PSA per-MSA · cross-
//     REIT portfolio aggregate)
//   • Supply-demand equilibrium adjustment factor (CLAIM 8) — UNDERSUPPLIED
//     markets see rent acceleration; OVERSUPPLIED markets see rent flattening
//   • Forward supply pipeline pressure factor (CLAIM 7) — confidence-weighted
//     forecast CC SF / current observed CC SF
//
// THIS IS THE SECOND METRIC EVERY STORAGE OPERATOR WANTS — paired with
// forward supply, forward rents determine the entire stabilized NOI
// projection. Radius+ ships current rent benchmarks only — no forward
// projection. TractIQ ships current + recent move-in rate trend, no
// forward forecast. StorTrack ships occupancy + rent benchmarks current.
// None adjust forward rents by primary-source pipeline pressure or
// supply-demand equilibrium.
//
// SYSTEM CLAIM (patent) — Method for forecasting forward commercial-real-
// estate rents from primary-source historical-trajectory + multi-source
// supply-demand-adjusted projection:
//
//   (a) ingesting historical per-MSA rent trajectory data from primary-
//       source SEC EDGAR REIT filings (PSA MD&A Same-Store Operating Trends
//       by Market FY2021-FY2025; cross-REIT portfolio aggregate FY2016-2025);
//
//   (b) computing a historical CAGR for the queried MSA × operator pair,
//       falling back to cross-REIT portfolio aggregate when per-MSA series
//       is unavailable;
//
//   (c) projecting a baseline forward rent path year-by-year using
//       compound-growth extrapolation: rentY = rentY-1 × (1 + CAGR);
//
//   (d) computing a supply-demand equilibrium adjustment factor from the
//       equilibrium engine of CLAIM 8 — UNDERSUPPLIED tiers map to a
//       positive rent-acceleration multiplier (1.0 + premium), OVERSUPPLIED
//       tiers map to a negative rent-deceleration multiplier (1.0 − discount);
//
//   (e) computing a forward pipeline-pressure adjustment factor from the
//       forecast engine of CLAIM 7 — ratio of confidence-weighted forecast
//       CC SF to current observed CC SF, with elasticity coefficient
//       converting supply growth pressure into rent dampening;
//
//   (f) combining the baseline CAGR path × equilibrium adjustment ×
//       pipeline-pressure adjustment to produce the adjusted forward rent
//       path year-by-year;
//
//   (g) emitting a per-year + per-adjustment-factor audit-trail object
//       exposing each component's contribution and its primary-source
//       citation so the consumer can re-derive every forecast digit from
//       the listed public sources.
//
// Together with Claims 7 (Forward Supply Forecast) and 8 (Supply-Demand
// Equilibrium Index), this engine forms the THREE-AXIS forward-state
// underwrite surface — every storage operator's NOI projection must
// rest on (i) forward rents, (ii) forward supply, (iii) demand. Storvex
// is the only platform that ships all three with primary-source audit
// trails, AND uses (ii)+(iii) to adjust (i) — closing the feedback loop
// that aggregator platforms leave open.
//
// Filed under DJR Real Estate LLC. Drafted 5/12/26 PM as part of the
// supplemental provisional addendum to USPTO #64/062,607.
// ═══════════════════════════════════════════════════════════════════════════

import {
  getHistoricalMSACAGR,
  getHistoricalMSARentSeries,
  getCrossREITHistoricalLatest,
  getHistoricalSameStoreSeries,
} from "../data/edgarCompIndex";
import { computeSupplyDemandEquilibrium } from "./supplyDemandEquilibrium";

// ─── Configurable adjustment coefficients ────────────────────────────────

// Equilibrium-tier rent adjustment per year. Positive = rent acceleration;
// negative = deceleration. Coefficients calibrated to Newmark + Marcus &
// Millichap submarket reports showing typical rent-growth deltas across
// supply regimes. Each row is per-year-applied (cumulative over horizon).
export const EQUILIBRIUM_RENT_ADJUSTMENT = {
  "SEVERELY UNDERSUPPLIED": 0.020, // +200 bps/yr rent acceleration above baseline CAGR
  "UNDERSUPPLIED":          0.010, // +100 bps/yr
  "BALANCED":               0.000, // baseline CAGR unmodified
  "WELL-SUPPLIED":         -0.005, // -50 bps/yr
  "OVERSUPPLIED":          -0.010, // -100 bps/yr
  "SATURATED":             -0.020, // -200 bps/yr
  "UNKNOWN":                0.000,
};

// Pipeline-pressure elasticity. ratio = forecastCcSf / currentCcSf.
// Higher ratio = bigger supply pulse coming = stronger downward rent pressure.
// Coefficient says: 100% supply pulse (ratio = 1.0) dampens rent by 80bps/yr.
export const PIPELINE_PRESSURE_ELASTICITY = -0.008; // -80bps/yr per 100% supply pulse

// Fallback CAGR when no historical data exists (US industry baseline).
// Cross-REIT FY2020-FY2025 portfolio-aggregate mean rent CAGR is ~4.0%/yr.
export const DEFAULT_FALLBACK_CAGR = 0.040;

export const DEFAULT_HORIZON_MONTHS = 60;

// ─── Helpers ─────────────────────────────────────────────────────────────

function clampCAGR(cagr) {
  if (!Number.isFinite(cagr)) return DEFAULT_FALLBACK_CAGR;
  if (cagr > 0.15) return 0.15;
  if (cagr < -0.10) return -0.10;
  return cagr;
}

/**
 * Pull the most recent observed rent for an MSA × operator from the
 * historical trajectory data. The series uses `rentPerOccSF` (PSA MD&A
 * "Same Store Facilities Operating Trends by Market" field name). Returns
 * the final year's rent or null when no time series exists.
 */
function getCurrentRent(msa, operator) {
  const series = getHistoricalMSARentSeries(msa, operator);
  if (!series || !Array.isArray(series.series) || series.series.length === 0) return null;
  const last = series.series[series.series.length - 1];
  // PSA per-MSA backfill uses `rentPerOccSF`; defensive on alt naming
  const rent = last.rentPerOccSF != null ? last.rentPerOccSF
             : last.rentPerSf != null ? last.rentPerSf
             : last.value != null ? last.value
             : null;
  if (rent == null) return null;
  return {
    rentPerSf: Number(rent),
    asOfYear: last.year,
    issuer: operator,
    seriesLength: series.series.length,
  };
}

/**
 * Cross-REIT fallback when per-MSA series is unavailable. Uses the
 * portfolio-aggregate latest rent + CAGR from `cross-reit-rent-trajectory`.
 */
function getCrossREITFallbackRent(operator) {
  // Try the operator's portfolio aggregate same-store series first
  const series = getHistoricalSameStoreSeries(operator, "rent");
  if (series && Array.isArray(series.series) && series.series.length >= 2) {
    const last = series.series[series.series.length - 1];
    const first = series.series[0];
    const years = (last.year - first.year) || 1;
    const cagr = Math.pow(last.value / first.value, 1 / years) - 1;
    return {
      rentPerSf: last.value,
      asOfYear: last.year,
      issuer: operator,
      cagr,
      source: `portfolio-aggregate ${operator} FY${first.year}-FY${last.year}`,
    };
  }
  // Final fallback — cross-REIT FY2025 mean from getCrossREITHistoricalLatest
  const latest = getCrossREITHistoricalLatest();
  if (latest && latest.avgRentPerSf) {
    return {
      rentPerSf: latest.avgRentPerSf,
      asOfYear: latest.asOf,
      issuer: "CROSS-REIT-AVG",
      cagr: DEFAULT_FALLBACK_CAGR,
      source: `Cross-REIT FY${latest.asOf} average across ${(latest.contributingIssuers || []).join(" + ")}`,
    };
  }
  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Compute the forward rent trajectory for a submarket × operator.
 *
 * @param {Object} query
 * @param {string} [query.city]         e.g., "Houston"
 * @param {string} [query.state]        e.g., "TX"
 * @param {string} [query.msa]          preferred when known
 * @param {string} [query.operator="PSA"] — issuer for the historical CAGR baseline
 * @param {number} [query.horizonMonths=60] — default 5 years
 * @param {Object} [query.ring]         demographic ring for equilibrium input
 * @param {number} [query.currentCCSF]  current observed CC SF (for equilibrium)
 * @param {Date}   [query.asOf=now]
 * @param {Object} [query.adjustments]  override default coefficients
 *
 * @returns {{
 *   submarket: { city, state, msa, operator },
 *   horizonMonths: number,
 *   asOf: string,
 *   baseline: { currentRent, asOfYear, cagr, cagrSource, fallbackUsed },
 *   adjustments: { equilibriumTier, equilibriumAdj, pipelinePressureRatio,
 *                   pipelinePressureAdj, totalAnnualAdj },
 *   path: Array<{ yearIndex, year, baseline, withAdjustment, deltaPct }>,
 *   summary: { finalYearRent, finalYearVsBaselinePct, totalRentGainPct, effectiveCAGR },
 *   confidence: 'high' | 'medium' | 'low',
 *   missing: string[]
 * }}
 */
export function computeForwardRentTrajectory(query = {}) {
  const {
    city = null,
    state = null,
    msa = null,
    operator = "PSA",
    horizonMonths = DEFAULT_HORIZON_MONTHS,
    ring = null,
    currentCCSF = null,
    asOf = new Date(),
    adjustments = {},
  } = query;

  const missing = [];
  const horizonYears = Math.max(1, Math.round(horizonMonths / 12));

  // ── Baseline — historical CAGR + current rent ────────────────────────
  let currentRentInfo = msa ? getCurrentRent(msa, operator) : null;
  let cagr = msa ? getHistoricalMSACAGR(msa, operator) : null;
  let cagrSource = null;
  let fallbackUsed = false;

  if (currentRentInfo && cagr != null) {
    cagrSource = `PSA FY${currentRentInfo.asOfYear} Same-Store Operating Trends by Market — MSA-keyed historical series`;
  } else {
    // Fall back to cross-REIT portfolio aggregate
    const xrFallback = getCrossREITFallbackRent(operator);
    if (xrFallback) {
      currentRentInfo = {
        rentPerSf: xrFallback.rentPerSf,
        asOfYear: xrFallback.asOfYear,
        issuer: xrFallback.issuer,
        seriesLength: 1,
      };
      cagr = xrFallback.cagr;
      cagrSource = xrFallback.source;
      fallbackUsed = true;
      if (msa) missing.push("perMSARentSeries");
    } else {
      cagr = DEFAULT_FALLBACK_CAGR;
      cagrSource = `Industry baseline ${(DEFAULT_FALLBACK_CAGR * 100).toFixed(2)}%/yr (cross-REIT mean)`;
      fallbackUsed = true;
      missing.push("currentRent");
    }
  }

  cagr = clampCAGR(cagr);
  const currentRent = currentRentInfo ? currentRentInfo.rentPerSf : null;

  // ── Equilibrium adjustment (CLAIM 8) ──────────────────────────────────
  let equilibrium = null;
  let equilibriumTier = "UNKNOWN";
  let equilibriumAdj = 0;
  if (ring) {
    try {
      equilibrium = computeSupplyDemandEquilibrium({
        city, state, msa, ring,
        currentCCSF: currentCCSF || undefined,
        horizonMonths,
        asOf,
      });
      equilibriumTier = (equilibrium?.tier?.label || "UNKNOWN");
      const adjMap = { ...EQUILIBRIUM_RENT_ADJUSTMENT, ...(adjustments.equilibrium || {}) };
      equilibriumAdj = adjMap[equilibriumTier] != null ? adjMap[equilibriumTier] : 0;
    } catch (err) {
      missing.push("equilibrium");
    }
  } else {
    missing.push("ring");
  }

  // ── Pipeline-pressure adjustment (CLAIM 7) ────────────────────────────
  let pipelinePressureRatio = null;
  let pipelinePressureAdj = 0;
  const elasticity = adjustments.pipelineElasticity != null
    ? adjustments.pipelineElasticity
    : PIPELINE_PRESSURE_ELASTICITY;
  if (equilibrium && equilibrium.supplyForecast) {
    const forecastCcSf = equilibrium.supplyForecast.totals.totalForecastCcSf || 0;
    const currentCcSf = equilibrium.currentCcSf || 0;
    if (currentCcSf > 0) {
      pipelinePressureRatio = forecastCcSf / currentCcSf;
      // Apply elasticity — ratio of 1.0 (100% supply pulse) yields PIPELINE_PRESSURE_ELASTICITY
      pipelinePressureAdj = pipelinePressureRatio * elasticity;
    }
  }

  // ── Combined annual adjustment ───────────────────────────────────────
  const totalAnnualAdj = equilibriumAdj + pipelinePressureAdj;
  const adjustedCAGR = clampCAGR(cagr + totalAnnualAdj);

  // ── Build year-by-year path ──────────────────────────────────────────
  const path = [];
  const baseYear = currentRentInfo?.asOfYear || new Date(asOf).getFullYear();
  let baselineRent = currentRent;
  let adjustedRent = currentRent;
  if (baselineRent != null) {
    path.push({
      yearIndex: 0,
      year: baseYear,
      baseline: baselineRent,
      withAdjustment: adjustedRent,
      deltaPct: 0,
    });
    for (let i = 1; i <= horizonYears; i++) {
      baselineRent = baselineRent * (1 + cagr);
      adjustedRent = adjustedRent * (1 + adjustedCAGR);
      path.push({
        yearIndex: i,
        year: baseYear + i,
        baseline: baselineRent,
        withAdjustment: adjustedRent,
        deltaPct: (adjustedRent / baselineRent - 1) * 100,
      });
    }
  }

  // ── Summary stats ─────────────────────────────────────────────────────
  const finalRow = path.length > 0 ? path[path.length - 1] : null;
  const summary = finalRow && currentRent
    ? {
        finalYearRent: finalRow.withAdjustment,
        finalYearBaseline: finalRow.baseline,
        finalYearVsBaselinePct: finalRow.deltaPct,
        totalRentGainPct: (finalRow.withAdjustment / currentRent - 1) * 100,
        effectiveCAGR: adjustedCAGR,
        baselineCAGR: cagr,
      }
    : null;

  // ── Composite confidence ──────────────────────────────────────────────
  let confidence = "low";
  if (!fallbackUsed && equilibrium && equilibrium.compositeConfidence === "high") confidence = "high";
  else if ((!fallbackUsed && equilibrium) || (fallbackUsed && equilibrium && equilibrium.compositeConfidence !== "low")) confidence = "medium";

  return {
    submarket: { city, state, msa, operator },
    horizonMonths,
    asOf: asOf instanceof Date ? asOf.toISOString() : new Date(asOf).toISOString(),
    baseline: {
      currentRent,
      asOfYear: currentRentInfo?.asOfYear || null,
      cagr,
      cagrSource,
      fallbackUsed,
    },
    adjustments: {
      equilibriumTier,
      equilibriumAdj,
      pipelinePressureRatio,
      pipelinePressureAdj,
      pipelineElasticity: elasticity,
      totalAnnualAdj,
      adjustedCAGR,
    },
    path,
    summary,
    equilibrium,
    confidence,
    missing,
  };
}

/**
 * Render a one-paragraph English summary.
 */
export function describeRentTrajectory(result) {
  if (!result) return "Rent trajectory unavailable — insufficient input data.";

  const sm = result.submarket;
  const smLabel = sm.msa || `${sm.city || "?"}, ${sm.state || "?"}`;
  const op = sm.operator || "PSA";

  if (!result.summary) {
    return (
      `Forward Rent Trajectory for ${smLabel} (${op}) — cannot compute (` +
      `${result.missing.join(", ") || "no current rent data"}).`
    );
  }

  const s = result.summary;
  const a = result.adjustments;
  const finalYear = result.path[result.path.length - 1].year;
  const dollar = (v) => `$${v.toFixed(2)}`;
  const pct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

  return (
    `Forward Rent Trajectory for ${smLabel} (${op}) — by FY${finalYear} ` +
    `(${result.horizonMonths}-month horizon): ` +
    `${dollar(s.finalYearRent)}/SF/yr forecast vs ${dollar(s.finalYearBaseline)}/SF/yr baseline ` +
    `(delta ${pct(s.finalYearVsBaselinePct)}). ` +
    `Effective CAGR: ${pct(s.effectiveCAGR * 100)}/yr (baseline ${pct(s.baselineCAGR * 100)}/yr ` +
    `+ equilibrium ${pct(a.equilibriumAdj * 100)}/yr [${a.equilibriumTier}] ` +
    `+ pipeline pressure ${pct(a.pipelinePressureAdj * 100)}/yr). ` +
    `Confidence: ${result.confidence.toUpperCase()}.`
  );
}

export default computeForwardRentTrajectory;
