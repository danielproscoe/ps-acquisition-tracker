// ═══════════════════════════════════════════════════════════════════════════
// Audited Submarket CC SPC Lookup
//
// Returns submarket-level audited climate-controlled supply-per-capita
// values for use in the MARKET INTEL band's COMPETITION card. The audited
// number renders side-by-side with the Storvex-computed estimate, with the
// delta surfacing the calibration loop residual. Closes over time as the
// Welltower-calibration partnership generates more datapoints.
//
// SYSTEM CLAIM (patent): A system for surfacing audited and computed
// climate-controlled supply-per-capita metrics side-by-side, comprising
// a per-submarket audited-CC-SPC registry keyed by submarket and a render
// layer that overlays audited-vs-computed delta with confidence band, plus
// a feedback loop that periodically adjusts the computed estimator's
// brand-weighting constants based on residual error vs the audited value.
//
// LOOKUP STRATEGY:
//   1. Exact submarket key match: "<City>, <State>"
//   2. Returns null on miss → caller renders computed value alone
// ═══════════════════════════════════════════════════════════════════════════

import auditedData from "../data/auditedSubmarketSPC.json";

/**
 * Look up audited CC SPC for a submarket.
 *
 * @param {string} city
 * @param {string} state
 * @returns {{
 *   auditedCCSPC: number,
 *   auditedCCSF: number,
 *   auditYear: number,
 *   auditSource: string,
 *   facilityCount: number,
 *   confidence: 'high' | 'medium' | 'low',
 *   notes: string,
 *   matched: true,
 *   key: string
 * } | { matched: false, fallback: 'computed-only' }}
 */
export function lookupAuditedCCSPC(city, state) {
  if (!city || !state) return { matched: false, fallback: "computed-only" };
  const key = `${city.trim()}, ${state.trim().toUpperCase()}`;
  const entry = auditedData.submarkets?.[key];
  if (!entry || typeof entry !== "object") {
    return { matched: false, fallback: "computed-only", key };
  }
  return { ...entry, matched: true, key };
}

/**
 * Compute calibration delta between audited and computed CC SPC.
 * Used downstream to tune the brand-weighting constants in the estimator.
 *
 * @param {number} auditedCCSPC
 * @param {number} computedCCSPC
 * @returns {{ deltaAbsolute: number, deltaPct: number, withinTolerance: boolean }}
 *   withinTolerance = |deltaPct| <= 25% (the calibration target stated in
 *   QuickLookupPanel's brand-weighting comment block).
 */
export function calibrationDelta(auditedCCSPC, computedCCSPC) {
  if (
    auditedCCSPC == null ||
    computedCCSPC == null ||
    !isFinite(auditedCCSPC) ||
    !isFinite(computedCCSPC) ||
    auditedCCSPC === 0
  ) {
    return { deltaAbsolute: null, deltaPct: null, withinTolerance: null };
  }
  const deltaAbsolute = computedCCSPC - auditedCCSPC;
  const deltaPct = (deltaAbsolute / auditedCCSPC) * 100;
  return {
    deltaAbsolute,
    deltaPct,
    withinTolerance: Math.abs(deltaPct) <= 25,
  };
}

export const AUDIT_REGISTRY_VERSION = auditedData.version;
export const AUDIT_REGISTRY_GENERATED_AT = auditedData.generatedAt;
