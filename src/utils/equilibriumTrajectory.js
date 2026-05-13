// ═══════════════════════════════════════════════════════════════════════════
// EQUILIBRIUM TRAJECTORY ENGINE — CLAIM 12
//
// Composes the Forward Supply Forecast (CLAIM 7) with the Forward Demand
// Trajectory (CLAIM 11) into a YEAR-BY-YEAR supply-demand equilibrium path.
// Today's supplyDemandEquilibrium.js (CLAIM 8) ships a single composite
// snapshot at the horizon endpoint — answering "where will we land in 24
// months?". This engine answers the question every storage operator asks
// next: "show me the PATH year-by-year, and tell me what year the market
// transitions from undersupplied to balanced (or balanced to oversupplied)".
//
// SYSTEM CLAIM (patent) — Method for forecasting a year-by-year supply-
// demand equilibrium trajectory per commercial-real-estate submarket:
//
//   (a) computing a forward demand trajectory per CLAIM 11 — applying
//       primary-source 5-year demographic projection data through the
//       audited component-wise demand model year-by-year over a
//       configurable horizon;
//
//   (b) computing a forward supply forecast per CLAIM 7 — aggregating
//       per-facility primary-source pipeline disclosures (SEC EDGAR REIT
//       filings + county-permit registries + historical-trajectory
//       extrapolation) with confidence-weighted classification;
//
//   (c) bucketing each forecast facility entry by its expected-delivery
//       year, deriving a cumulative supply curve where supply at year Y
//       equals current observed CC SF + Σ (confidence-weighted facility
//       CC SF for all entries with expectedDelivery ≤ year Y) +
//       Σ (historical-trajectory extrapolation × Y/horizonYears);
//
//   (d) for each integer year Y in [0, horizonYears]:
//          supplyY     = cumulative supply at year Y (per step (c))
//          demandY     = total demand SF from CLAIM 11 path at year Y
//          ratioY      = supplyY / demandY
//          tierY       = classifyTier(ratioY) (six-tier band per CLAIM 8)
//
//   (e) detecting tier transitions — pairs of adjacent years (Y, Y+1)
//       whose tier classification differs — and reporting them as
//       structured events with from/to tier labels, delta ratio, and the
//       year of transition;
//
//   (f) computing summary statistics including start tier, end tier,
//       year-of-balance-crossing (if applicable), peak supply pulse year,
//       net supply added, net demand added, and a composite confidence
//       tier;
//
//   (g) emitting an audit-trail object exposing BOTH upstream trajectory
//       outputs in full (Y0→horizon paths, per-facility breakdown,
//       primary-source citations) so a downstream consumer can re-derive
//       every digit from the listed public sources.
//
// Together with CLAIMS 7 / 8 / 9 / 10 / 11, this engine completes the
// FOUR-PILLAR FORWARD-STATE UNDERWRITE SURFACE — forward supply (Claim 7),
// supply-demand equilibrium snapshot (Claim 8), forward rent trajectory
// (Claim 9), underwriting confidence (Claim 10), forward demand trajectory
// (Claim 11), and now forward equilibrium trajectory year-by-year (Claim 12).
// No aggregator platform (Radius+, TractIQ, StorTrack, Yardi Matrix) ships
// any one of these axes; Storvex ships all four with primary-source audit
// trails and inter-axis composition.
//
// Filed under DJR Real Estate LLC. Drafted 5/13/26 AM as part of the
// supplemental provisional addendum to USPTO #64/062,607.
// ═══════════════════════════════════════════════════════════════════════════

import { computeForwardSupplyForecast } from "./forwardSupplyForecast";
import { computeForwardDemandTrajectory } from "./forwardDemandTrajectory";
import { DEFAULT_EQUILIBRIUM_TIERS } from "./supplyDemandEquilibrium";

// ─── Configurable defaults ───────────────────────────────────────────────

export const DEFAULT_HORIZON_MONTHS = 60;

export const DEFAULT_CONFIDENCE_WEIGHTS = {
  VERIFIED: 1.0,
  CLAIMED: 0.5,
  STALE: 0.3,
  UNVERIFIED: 0.0,
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function classifyTier(ratio, tiers = DEFAULT_EQUILIBRIUM_TIERS) {
  if (ratio == null || !Number.isFinite(ratio)) {
    return { label: "UNKNOWN", color: "#64748B", note: "Insufficient data to classify", maxRatio: null };
  }
  for (const t of tiers) {
    if (ratio <= t.maxRatio) return t;
  }
  return tiers[tiers.length - 1];
}

/**
 * Bucket forecast entries by delivery year. Each entry contributes its
 * (ccSf × confidenceWeight) to its delivery year. Returns a Map keyed by
 * year integer. Entries with no parseable delivery date are dropped (they
 * fall into the historical-projection bucket instead).
 */
function bucketEntriesByDeliveryYear(entries, weights, baseYear) {
  const byYear = new Map();
  for (const e of entries || []) {
    const d = e.expectedDeliveryDate;
    if (!d) continue;
    const year = d instanceof Date ? d.getFullYear() : new Date(d).getFullYear();
    if (!Number.isFinite(year)) continue;
    const w = weights[e.confidence] != null ? weights[e.confidence] : 0;
    const weighted = (Number(e.ccSf) || 0) * w;
    const yearOffset = year - baseYear;
    const key = Math.max(0, yearOffset);
    byYear.set(key, (byYear.get(key) || 0) + weighted);
  }
  return byYear;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Compute the year-by-year equilibrium trajectory for a submarket.
 *
 * @param {Object} query
 * @param {string} [query.city]
 * @param {string} [query.state]
 * @param {string} [query.msa]
 * @param {Object} query.ring                Y0 demographic ring (per CLAIM 11)
 * @param {number} [query.currentCCSF]       Currently observed CC SF (anchor for supply)
 * @param {number} [query.horizonMonths=60]
 * @param {Date}   [query.asOf=now]
 * @param {Object} [query.confidenceWeights]
 * @param {Array}  [query.tiers]             override DEFAULT_EQUILIBRIUM_TIERS
 *
 * @returns {{
 *   submarket: { city, state, msa },
 *   horizonMonths: number,
 *   asOf: string,
 *   path: Array<{
 *     yearIndex, year, supplyCcSf, supplyDeliveredThisYear,
 *     demandCcSf, ratio, tier, supplyConfidenceWeightedDelta
 *   }>,
 *   tierTransitions: Array<{
 *     fromYearIndex, fromYear, toYearIndex, toYear,
 *     fromTier, toTier, fromRatio, toRatio
 *   }>,
 *   summary: {
 *     startTier, endTier, startRatio, endRatio,
 *     yearOfBalanceCrossing, yearsToBalance,
 *     peakSupplyPulseYear, peakSupplyPulseCcSf,
 *     netSupplyAddedCcSf, netDemandAddedCcSf,
 *     finalYear
 *   } | null,
 *   forwardSupply: Object,
 *   forwardDemand: Object,
 *   compositeConfidence: 'high' | 'medium' | 'low',
 *   missing: string[]
 * }}
 */
export function computeEquilibriumTrajectory(query = {}) {
  const {
    city = null,
    state = null,
    msa = null,
    ring = null,
    currentCCSF = null,
    horizonMonths = DEFAULT_HORIZON_MONTHS,
    asOf = new Date(),
    confidenceWeights = DEFAULT_CONFIDENCE_WEIGHTS,
    tiers = DEFAULT_EQUILIBRIUM_TIERS,
  } = query;

  const missing = [];
  const horizonYears = Math.max(1, Math.round(horizonMonths / 12));
  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf);
  const baseYear = asOfDate.getFullYear();

  // ── Upstream 1 — Forward Supply Forecast (CLAIM 7) ────────────────────
  let forwardSupply = null;
  try {
    forwardSupply = computeForwardSupplyForecast({
      city, state, msa,
      horizonMonths,
      asOf: asOfDate,
      confidenceWeights,
      includeHistoricalProjection: true,
    });
  } catch (err) {
    missing.push("forwardSupply");
  }

  // ── Upstream 2 — Forward Demand Trajectory (CLAIM 11) ─────────────────
  let forwardDemand = null;
  if (ring) {
    try {
      forwardDemand = computeForwardDemandTrajectory({
        city, state, msa, ring, horizonMonths, asOf: asOfDate,
      });
    } catch (err) {
      missing.push("forwardDemand");
    }
  } else {
    missing.push("ring");
  }

  if (!forwardSupply || !forwardDemand || !forwardDemand.path || forwardDemand.path.length === 0) {
    return {
      submarket: { city, state, msa },
      horizonMonths,
      asOf: asOfDate.toISOString(),
      path: [],
      tierTransitions: [],
      summary: null,
      forwardSupply,
      forwardDemand,
      compositeConfidence: "low",
      missing,
    };
  }

  // ── Bucket primary-source supply entries by delivery year ─────────────
  const edgarByYear = bucketEntriesByDeliveryYear(
    forwardSupply.sources?.edgar?.breakdown,
    confidenceWeights,
    baseYear
  );
  const permitByYear = bucketEntriesByDeliveryYear(
    forwardSupply.sources?.permit?.breakdown,
    confidenceWeights,
    baseYear
  );

  // Historical projection — distribute linearly across the horizon. The
  // projection represents an annual pace already; CLAIM 7 multiplies by
  // horizonYears to get the total. To bucket year-by-year, divide that
  // total back by horizonYears and apply that annual increment Y1..YN.
  const historicalAnnualCcSf =
    horizonYears > 0
      ? (forwardSupply.sources?.historical?.projectedCcSf || 0) / horizonYears
      : 0;

  const currentCcSf =
    Number.isFinite(currentCCSF) && currentCCSF > 0 ? Number(currentCCSF) : 0;
  if (currentCcSf === 0) missing.push("currentCCSF");

  // ── Build year-by-year path ───────────────────────────────────────────
  const path = [];
  let cumSupply = currentCcSf;
  for (let y = 0; y <= horizonYears; y++) {
    const edgarDelta = edgarByYear.get(y) || 0;
    const permitDelta = permitByYear.get(y) || 0;
    // Historical projection starts contributing Y1 onward (Y0 is the
    // current snapshot — no historical-projected deliveries yet).
    const historicalDelta = y === 0 ? 0 : historicalAnnualCcSf;
    const supplyDeliveredThisYear = edgarDelta + permitDelta + historicalDelta;
    cumSupply += supplyDeliveredThisYear;

    const demandRow = forwardDemand.path.find((r) => r.yearIndex === y) || forwardDemand.path[y] || null;
    const demandCcSf = demandRow ? demandRow.totalDemandSf : null;
    const ratio = demandCcSf && demandCcSf > 0 ? cumSupply / demandCcSf : null;
    const tier = classifyTier(ratio, tiers);

    path.push({
      yearIndex: y,
      year: baseYear + y,
      supplyCcSf: cumSupply,
      supplyDeliveredThisYear,
      supplyConfidenceWeightedDelta: {
        edgar: edgarDelta,
        permit: permitDelta,
        historical: historicalDelta,
      },
      demandCcSf,
      ratio,
      tier,
    });
  }

  // ── Detect tier transitions ───────────────────────────────────────────
  const tierTransitions = [];
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const cur = path[i];
    if (prev.tier?.label && cur.tier?.label && prev.tier.label !== cur.tier.label) {
      tierTransitions.push({
        fromYearIndex: prev.yearIndex,
        fromYear: prev.year,
        toYearIndex: cur.yearIndex,
        toYear: cur.year,
        fromTier: prev.tier.label,
        toTier: cur.tier.label,
        fromRatio: prev.ratio,
        toRatio: cur.ratio,
        deltaRatio: prev.ratio != null && cur.ratio != null ? cur.ratio - prev.ratio : null,
      });
    }
  }

  // ── Summary stats ─────────────────────────────────────────────────────
  const y0 = path[0];
  const yN = path[path.length - 1];

  // Year where the ratio first crosses 1.0 from below (undersupplied → balanced)
  let yearOfBalanceCrossing = null;
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const cur = path[i];
    if (prev.ratio != null && cur.ratio != null && prev.ratio < 1.0 && cur.ratio >= 1.0) {
      yearOfBalanceCrossing = cur.year;
      break;
    }
  }

  // Peak supply pulse — year with the largest delta vs prior year
  let peakSupplyPulseYear = null;
  let peakSupplyPulseCcSf = 0;
  for (let i = 0; i < path.length; i++) {
    const row = path[i];
    if (row.supplyDeliveredThisYear > peakSupplyPulseCcSf) {
      peakSupplyPulseCcSf = row.supplyDeliveredThisYear;
      peakSupplyPulseYear = row.year;
    }
  }

  const summary = {
    startTier: y0.tier?.label || null,
    endTier: yN.tier?.label || null,
    startRatio: y0.ratio,
    endRatio: yN.ratio,
    yearOfBalanceCrossing,
    yearsToBalance: yearOfBalanceCrossing != null ? yearOfBalanceCrossing - baseYear : null,
    peakSupplyPulseYear,
    peakSupplyPulseCcSf,
    netSupplyAddedCcSf: yN.supplyCcSf - y0.supplyCcSf,
    netDemandAddedCcSf: (yN.demandCcSf || 0) - (y0.demandCcSf || 0),
    finalYear: yN.year,
  };

  // ── Composite confidence ──────────────────────────────────────────────
  // high   — supply confidenceTier "high" AND demand confidence "high"
  // medium — at least one upstream "high" OR both "medium"
  // low    — either upstream "low" or missing
  let compositeConfidence = "low";
  const supplyTier = forwardSupply.confidenceTier || "low";
  const demandTier = forwardDemand.confidence || "low";
  if (supplyTier === "high" && demandTier === "high") compositeConfidence = "high";
  else if (supplyTier === "high" || demandTier === "high") compositeConfidence = "medium";
  else if (supplyTier === "medium" && demandTier === "medium") compositeConfidence = "medium";

  return {
    submarket: { city, state, msa },
    horizonMonths,
    asOf: asOfDate.toISOString(),
    path,
    tierTransitions,
    summary,
    forwardSupply,
    forwardDemand,
    currentCcSf,
    compositeConfidence,
    missing,
  };
}

/**
 * Render a one-paragraph English summary.
 */
export function describeEquilibriumTrajectory(result) {
  if (!result || !result.summary || !result.path || result.path.length === 0) {
    return (
      `Equilibrium Trajectory unavailable — insufficient input data` +
      (result?.missing?.length ? ` (${result.missing.join(", ")})` : "") +
      "."
    );
  }
  const sm = result.submarket;
  const smLabel = sm.msa || `${sm.city || "?"}, ${sm.state || "?"}`;
  const s = result.summary;
  const k = (v) => Math.round((v || 0) / 1000).toLocaleString();
  const ratio = (v) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(2));

  const balanceLine =
    s.yearOfBalanceCrossing != null
      ? ` Market crosses balance (ratio ≥ 1.0) in ${s.yearOfBalanceCrossing}.`
      : s.startRatio != null && s.startRatio >= 1.0
        ? ` Market starts at or above balance (ratio ${ratio(s.startRatio)}).`
        : "";

  const transitionLine =
    result.tierTransitions.length > 0
      ? ` Tier transitions: ${result.tierTransitions
          .map((t) => `${t.fromTier} → ${t.toTier} in ${t.toYear}`)
          .join("; ")}.`
      : "";

  return (
    `Equilibrium Trajectory for ${smLabel} (Y0→FY${s.finalYear}, ${result.horizonMonths}-month horizon): ` +
    `start ${s.startTier} (ratio ${ratio(s.startRatio)}) → end ${s.endTier} (ratio ${ratio(s.endRatio)}). ` +
    `Net supply added: ${k(s.netSupplyAddedCcSf)}K CC SF. Net demand added: ${k(s.netDemandAddedCcSf)}K CC SF.` +
    balanceLine +
    transitionLine +
    ` Composite confidence: ${result.compositeConfidence.toUpperCase()}.`
  );
}

export default computeEquilibriumTrajectory;
