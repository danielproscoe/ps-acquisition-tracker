// ═══════════════════════════════════════════════════════════════════════════
// SUPPLY-DEMAND EQUILIBRIUM INDEX
//
// Composite metric per submarket — combines the Multi-Source Forward Supply
// Forecast (see forwardSupplyForecast.js · SYSTEM CLAIM 7) with the Audited
// Storage Demand Forecast (see storageDemandForecast.mjs · existing engine)
// into a single saturation ratio + tier classification. Operators get ONE
// number that tells them undersupplied vs balanced vs oversupplied, with
// the full audit trail showing both upstream methodology stacks.
//
// THIS IS THE NUMBER EVERY STORAGE OPERATOR WANTS. Radius+ ships neither
// upstream forecast. TractIQ ships submarket benchmarks but no audited
// demand model and no confidence-weighted forward supply. StorTrack ships
// occupancy benchmarks but no forward forecast. None of them produce a
// composite supply-demand equilibrium with audit-trail attribution.
//
// SYSTEM CLAIM (patent) — Method for computing a primary-source-attributed
// supply-demand equilibrium index per commercial-real-estate submarket:
//
//   (a) computing a forward supply forecast per submarket via the
//       multi-source forecast engine of Claim 7 — aggregating EDGAR pipeline
//       + county-permit registry + historical-trajectory extrapolation with
//       confidence-weighted classification;
//
//   (b) independently computing an audited per-capita demand forecast via
//       a component-wise demand model that combines a population-baseline
//       constant × Tapestry LifeMode propensity index × urbanization tier
//       multiplier × renter-premium adjustment × growth-premium adjustment
//       × income-slope adjustment, every coefficient citation-anchored to
//       primary sources (Self-Storage Almanac · Newmark sector reports ·
//       REIT 10-K MD&A · Census ACS migration);
//
//   (c) converting the per-capita demand to total demand square footage by
//       multiplying against the submarket's population (default 3-mi ring,
//       configurable);
//
//   (d) combining the forward supply forecast horizon's total CC SF with
//       any current observed CC SF in the submarket to derive total
//       supply-after-horizon;
//
//   (e) computing the supply-demand ratio = total supply / total demand;
//
//   (f) classifying the submarket into a tier (SEVERELY UNDERSUPPLIED /
//       UNDERSUPPLIED / BALANCED / WELL-SUPPLIED / OVERSUPPLIED / SATURATED)
//       using configurable threshold bands (default 0-0.6 / 0.6-0.85 /
//       0.85-1.10 / 1.10-1.35 / 1.35-1.75 / 1.75+);
//
//   (g) emitting a composite-audit-trail object that exposes BOTH upstream
//       inputs in full — supply attribution (per-source · per-confidence ·
//       horizon · primarySourceCount · confidenceTier) AND demand
//       attribution (components · coefficients · citations · confidence) —
//       so a downstream consumer can re-derive every digit of the
//       equilibrium index from the listed public sources.
//
// Together with the Pipeline Verification Oracle's multi-source coverage
// claim (`pipelineVerificationOracle.js`), the County-Permit Multi-Portal
// Adapter claim (`_county-permit-common.mjs`), the JDA-Pattern PRE-listed
// surfacing claim (`cluster.js`), and the Forward Supply Forecast claim
// (`forwardSupplyForecast.js`), this engine forms the FOURTH pillar of a
// "primary-source-symmetric audit-layer forecasting system" — a composite
// metric whose audit trail is unmatched by any existing CRE-intel platform.
//
// Filed under DJR Real Estate LLC. Drafted 5/12/26 PM as part of the
// supplemental provisional addendum to USPTO #64/062,607.
// ═══════════════════════════════════════════════════════════════════════════

import { computeForwardSupplyForecast } from "./forwardSupplyForecast";
import {
  forecastStorageDemand,
  extractRingForDemandForecast,
} from "./storageDemandForecast.mjs";

// ─── Tier classification thresholds (configurable) ──────────────────────

export const DEFAULT_EQUILIBRIUM_TIERS = [
  { label: "SEVERELY UNDERSUPPLIED", maxRatio: 0.60, color: "#16A34A", note: "Strong undersupply — high greenfield opportunity" },
  { label: "UNDERSUPPLIED",          maxRatio: 0.85, color: "#22C55E", note: "Below equilibrium — favorable underwrite signal" },
  { label: "BALANCED",               maxRatio: 1.10, color: "#C9A84C", note: "Equilibrium — neutral underwrite signal" },
  { label: "WELL-SUPPLIED",          maxRatio: 1.35, color: "#EA580C", note: "Above equilibrium — caution on rent assumptions" },
  { label: "OVERSUPPLIED",           maxRatio: 1.75, color: "#DC2626", note: "Saturation risk — re-stress underwrite assumptions" },
  { label: "SATURATED",              maxRatio: Infinity, color: "#7F1D1D", note: "High saturation — generally pass unless rate-driven anomaly" },
];

export const DEFAULT_HORIZON_MONTHS = 24;
export const DEFAULT_CURRENT_CC_SPC = null; // optionally supplied by caller

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Tier-lookup against the bands array. Returns the matching tier entry.
 */
function classifyTier(ratio, tiers = DEFAULT_EQUILIBRIUM_TIERS) {
  if (ratio == null || !Number.isFinite(ratio)) {
    return { label: "UNKNOWN", color: "#64748B", note: "Insufficient data to classify" };
  }
  for (const t of tiers) {
    if (ratio <= t.maxRatio) return t;
  }
  return tiers[tiers.length - 1];
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Compute the supply-demand equilibrium index for a submarket.
 *
 * @param {Object} query
 * @param {string} [query.city]            e.g., "Houston"
 * @param {string} [query.state]           e.g., "TX"
 * @param {string} [query.msa]             e.g., "Houston" — preferred when present
 * @param {number} [query.horizonMonths=24]
 * @param {Object} query.ring              Demographic ring (3-mi by default) used by demand forecast.
 *                                         Should include pop, renterPct, growthRatePct,
 *                                         medianHHIncome, tapestryLifeMode, tapestryUrbanization.
 * @param {number} [query.currentCCSF]     Currently observed CC SF in the submarket.
 *                                         When supplied, total supply = current + forecast.
 * @param {Date}   [query.asOf=now]
 *
 * @returns {{
 *   submarket: { city, state, msa },
 *   horizonMonths: number,
 *   asOf: string,
 *   supplyForecast: Object,           // full forwardSupplyForecast output
 *   demandForecast: Object | null,    // full forecastStorageDemand output
 *   totalSupplyCcSf: number,          // current + horizon-forecast
 *   totalDemandCcSf: number | null,
 *   equilibriumRatio: number | null,
 *   tier: { label, color, note, maxRatio },
 *   compositeConfidence: 'high' | 'medium' | 'low',
 *   missing: string[]
 * }}
 */
export function computeSupplyDemandEquilibrium(query = {}) {
  const {
    city = null,
    state = null,
    msa = null,
    horizonMonths = DEFAULT_HORIZON_MONTHS,
    ring = null,
    currentCCSF = null,
    asOf = new Date(),
    tiers = DEFAULT_EQUILIBRIUM_TIERS,
  } = query;

  const missing = [];

  // ── Upstream 1 — Forward Supply Forecast ──────────────────────────────
  let supplyForecast;
  try {
    supplyForecast = computeForwardSupplyForecast({
      city, state, msa, horizonMonths, asOf,
      includeHistoricalProjection: true,
    });
  } catch (err) {
    supplyForecast = null;
    missing.push("supplyForecast");
  }

  const horizonForecastCcSf = supplyForecast?.totals?.totalForecastCcSf || 0;
  const currentCcSf = Number.isFinite(currentCCSF) && currentCCSF > 0 ? Number(currentCCSF) : 0;
  if (currentCcSf === 0 && supplyForecast != null) missing.push("currentCCSF");
  const totalSupplyCcSf = currentCcSf + horizonForecastCcSf;

  // ── Upstream 2 — Audited Storage Demand Forecast ──────────────────────
  let demandForecast = null;
  let totalDemandCcSf = null;
  if (ring && typeof ring === "object") {
    try {
      const normalizedRing = ring.pop != null ? ring : extractRingForDemandForecast(ring);
      demandForecast = forecastStorageDemand(normalizedRing, {});
      totalDemandCcSf = demandForecast?.totalDemandSF != null
        ? Number(demandForecast.totalDemandSF)
        : null;
    } catch (err) {
      demandForecast = null;
      missing.push("demandForecast");
    }
  } else {
    missing.push("ring");
  }

  // ── Composite — Equilibrium Ratio ──────────────────────────────────────
  let equilibriumRatio = null;
  if (totalDemandCcSf != null && totalDemandCcSf > 0) {
    equilibriumRatio = totalSupplyCcSf / totalDemandCcSf;
  }

  const tier = classifyTier(equilibriumRatio, tiers);

  // ── Composite confidence ──────────────────────────────────────────────
  // high   — both supply forecast (primarySourceCount ≥ 2) AND demand
  //          forecast (confidence "high")
  // medium — at least one upstream is "high" OR both are "medium"
  // low    — either upstream missing OR both upstream "low"
  let compositeConfidence = "low";
  const supplyTier = supplyForecast?.confidenceTier || "low";
  const demandTier = demandForecast?.confidence || "low";
  if (supplyTier === "high" && demandTier === "high") compositeConfidence = "high";
  else if (supplyTier === "high" || demandTier === "high") compositeConfidence = "medium";
  else if (supplyTier === "medium" && demandTier === "medium") compositeConfidence = "medium";

  return {
    submarket: { city, state, msa },
    horizonMonths,
    asOf: asOf instanceof Date ? asOf.toISOString() : new Date(asOf).toISOString(),
    supplyForecast,
    demandForecast,
    currentCcSf,
    totalSupplyCcSf,
    totalDemandCcSf,
    equilibriumRatio,
    tier,
    compositeConfidence,
    missing,
  };
}

/**
 * Render a one-paragraph English summary of the equilibrium result. Used in
 * REC Package generation, IC Memo TONE rules, and Sentinel daily briefs.
 */
export function describeEquilibrium(result) {
  if (!result) return "Equilibrium index unavailable — insufficient input data.";

  const sm = result.submarket;
  const smLabel = sm.msa || `${sm.city || "?"}, ${sm.state || "?"}`;
  const totalK = (n) => Math.round((n || 0) / 1000).toLocaleString();

  if (result.equilibriumRatio == null) {
    return (
      `Supply-Demand Equilibrium for ${smLabel} — cannot compute (` +
      `${result.missing.join(", ")}). ` +
      `Forward supply over the next ${result.horizonMonths} months: ` +
      `${totalK(result.totalSupplyCcSf)}K CC SF.`
    );
  }

  return (
    `Supply-Demand Equilibrium for ${smLabel} (${result.horizonMonths}-month horizon): ` +
    `total supply ${totalK(result.totalSupplyCcSf)}K CC SF ÷ ` +
    `total demand ${totalK(result.totalDemandCcSf)}K CC SF = ` +
    `ratio ${result.equilibriumRatio.toFixed(2)} → ${result.tier.label}. ` +
    `${result.tier.note}. ` +
    `Composite confidence: ${result.compositeConfidence.toUpperCase()} ` +
    `(supply ${result.supplyForecast?.confidenceTier || "n/a"} · ` +
    `demand ${result.demandForecast?.confidence || "n/a"}).`
  );
}

export default computeSupplyDemandEquilibrium;
