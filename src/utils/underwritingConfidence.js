// ═══════════════════════════════════════════════════════════════════════════
// UNDERWRITING CONFIDENCE SCORE (URC)
//
// The single composite grade every storage operator wants: should I bid
// here? Storvex rolls every primary-source-attributed forecast we ship —
// the Forward Supply Forecast (CLAIM 7), the Supply-Demand Equilibrium
// Index (CLAIM 8), the Forward Rent Trajectory (CLAIM 9), the audited
// Tapestry-anchored demand model, the multi-source Verification Oracle
// (CLAIM 1), the multi-source coverage signal, and audit-trail completeness
// — into ONE 0-100 score that maps to an A+ → F underwrite-confidence
// letter grade per submarket.
//
// One letter. Full decomposition one click away. Every digit traceable to
// a primary source. The operator's go/no-go signal.
//
// NO INCUMBENT CRE-INTEL PLATFORM SHIPS THIS. Radius+ ships scattered
// metrics across multiple panels. TractIQ ships submarket benchmarks
// without confidence-graded composites. StorTrack ships occupancy alone.
// Yardi ships rent comps alone. None of them roll the entire underwrite
// surface into a single audit-traceable letter grade.
//
// SYSTEM CLAIM (patent) — Method for computing a primary-source-attributed
// underwriting confidence score per commercial-real-estate submarket from
// a plurality of independent forecast engines, comprising:
//
//   (a) ingesting outputs from a plurality of primary-source-attributed
//       forecast engines — each engine implementing a distinct method
//       claimed independently — including but not limited to:
//         (i)   a multi-source forward supply forecast (CLAIM 7);
//         (ii)  a supply-demand equilibrium index (CLAIM 8);
//         (iii) a forward rent trajectory engine (CLAIM 9);
//         (iv)  an audited per-capita demand model;
//         (v)   a multi-source verification oracle coverage signal (CLAIM 1);
//         (vi)  primary-source-registry coverage density metrics (CLAIMS 4, 7);
//
//   (b) for each input engine, deriving a normalized 0-100 sub-score with
//       a method-specific scoring rubric that respects the engine's native
//       tier classification (e.g., equilibrium tier ↔ supply-demand
//       sub-score; rent trajectory effective CAGR ↔ rent sub-score;
//       forecast confidence tier ↔ source-confidence sub-score);
//
//   (c) computing a weighted composite score = Σ (weight_i × sub_score_i)
//       where weights are configurable, default emphasizing forward
//       supply (20%), supply-demand equilibrium (25%), forward rent
//       trajectory (20%), demand confidence (15%), source diversity
//       (10%), audit-trail completeness (10%);
//
//   (d) mapping the composite score to an underwriting-grade letter using
//       configurable threshold bands (default A+ ≥ 90, A ≥ 85, A- ≥ 80,
//       B+ ≥ 75, B ≥ 70, B- ≥ 65, C+ ≥ 60, C ≥ 55, C- ≥ 50, D ≥ 40, F < 40);
//
//   (e) computing per-sub-score confidence flags (high/medium/low) based
//       on the underlying engine's confidence tier, propagating to the
//       composite a final "grade confidence" indicator;
//
//   (f) emitting a per-engine + per-sub-score audit-trail object that
//       exposes the upstream contribution from each forecast engine and
//       its primary-source citation, enabling a downstream consumer to
//       re-derive the composite grade from listed public sources; and
//
//   (g) identifying specific deficiencies in the audit trail (missing
//       sub-scores, low-confidence inputs, fallback paths used) and
//       surfacing them as actionable diligence items the underwriter
//       can address before committing capital.
//
// CLAIMS 1, 4, 7, 8, 9 are integrated as upstream methods. The composite
// is novel and non-obvious — no incumbent platform produces a single
// audit-graded underwriting confidence score from independent primary-
// source-attributed forecast engines. Design-around would require
// independently implementing every upstream engine PLUS the synthesis.
//
// Filed under DJR Real Estate LLC. Drafted 5/12/26 PM as part of the
// supplemental provisional addendum to USPTO #64/062,607.
// ═══════════════════════════════════════════════════════════════════════════

import { computeForwardSupplyForecast } from "./forwardSupplyForecast";
import { computeSupplyDemandEquilibrium } from "./supplyDemandEquilibrium";
import { computeForwardRentTrajectory } from "./forwardRentTrajectory";
import {
  forecastStorageDemand,
  extractRingForDemandForecast,
} from "./storageDemandForecast.mjs";

// ─── Default composite weights ──────────────────────────────────────────

export const DEFAULT_URC_WEIGHTS = {
  forwardSupply: 0.20,        // CLAIM 7
  equilibrium: 0.25,          // CLAIM 8
  forwardRent: 0.20,          // CLAIM 9
  demand: 0.15,               // audited Tapestry demand
  sourceDiversity: 0.10,      // # of primary-source registries contributing
  auditCompleteness: 0.10,    // % of upstream engines with non-fallback inputs
};

// ─── Default grade bands ────────────────────────────────────────────────

export const DEFAULT_URC_GRADES = [
  { min: 90, label: "A+", color: "#15803D", note: "Elite underwrite confidence — institutional bid posture justified" },
  { min: 85, label: "A",  color: "#16A34A", note: "Strong underwrite confidence — recommend pursuing" },
  { min: 80, label: "A-", color: "#22C55E", note: "Above-average underwrite confidence" },
  { min: 75, label: "B+", color: "#84CC16", note: "Solid underwrite — diligence-pass favorable" },
  { min: 70, label: "B",  color: "#A3E635", note: "Acceptable underwrite — proceed with standard diligence" },
  { min: 65, label: "B-", color: "#C9A84C", note: "Borderline — pricing must reflect lower-confidence inputs" },
  { min: 60, label: "C+", color: "#EAB308", note: "Caution — multiple sub-scores below target" },
  { min: 55, label: "C",  color: "#F59E0B", note: "Caution — equilibrium or supply risk material" },
  { min: 50, label: "C-", color: "#EA580C", note: "Significant concerns — re-stress assumptions before bidding" },
  { min: 40, label: "D",  color: "#DC2626", note: "Weak underwrite — recommend pass unless rate-driven anomaly" },
  { min: 0,  label: "F",  color: "#7F1D1D", note: "Fail — recommend pass" },
];

// ─── Sub-score scoring rubrics ──────────────────────────────────────────

/**
 * Forward Supply Forecast (CLAIM 7) — score 0-100 derived from the forecast
 * confidence tier + primary-source count.
 *
 * Higher score = more credible forecast (more primary sources, higher
 * confidence). Note: this scores the QUALITY of the forecast, not whether
 * the supply level is good or bad — that's the equilibrium engine's job.
 */
function scoreForwardSupply(supplyForecast) {
  if (!supplyForecast) return { score: 0, confidence: "low", note: "Forecast unavailable" };
  const tierScore = supplyForecast.confidenceTier === "high" ? 90
    : supplyForecast.confidenceTier === "medium" ? 70
    : 50;
  // Primary-source diversity bonus
  const diversityBonus = Math.min(10, (supplyForecast.primarySourceCount || 0) * 4);
  return {
    score: Math.min(100, tierScore + diversityBonus),
    confidence: supplyForecast.confidenceTier || "low",
    note: `${supplyForecast.primarySourceCount} primary-source registry contributions · forecast tier ${supplyForecast.confidenceTier}`,
  };
}

/**
 * Supply-Demand Equilibrium Index (CLAIM 8) — score 0-100 derived from
 * the equilibrium tier. BALANCED maps to 70 (target); UNDERSUPPLIED tiers
 * boost above target; OVERSUPPLIED tiers discount below.
 */
function scoreEquilibrium(equilibrium) {
  if (!equilibrium || equilibrium.equilibriumRatio == null) {
    return { score: 0, confidence: "low", note: "Equilibrium unavailable" };
  }
  const TIER_SCORES = {
    "SEVERELY UNDERSUPPLIED": 95,
    "UNDERSUPPLIED": 85,
    "BALANCED": 70,
    "WELL-SUPPLIED": 55,
    "OVERSUPPLIED": 40,
    "SATURATED": 20,
    "UNKNOWN": 50,
  };
  const score = TIER_SCORES[equilibrium.tier?.label] ?? 50;
  return {
    score,
    confidence: equilibrium.compositeConfidence || "low",
    note: `Equilibrium tier ${equilibrium.tier?.label || "UNKNOWN"} · ratio ${equilibrium.equilibriumRatio.toFixed(2)}`,
  };
}

/**
 * Forward Rent Trajectory (CLAIM 9) — score 0-100 derived from the
 * effective CAGR. Higher rent growth → higher sub-score.
 */
function scoreForwardRent(rentForecast) {
  if (!rentForecast || !rentForecast.summary) {
    return { score: 0, confidence: "low", note: "Rent trajectory unavailable" };
  }
  const eff = rentForecast.summary.effectiveCAGR;
  // CAGR-to-score mapping:
  //   ≥ 6%/yr → 95 · 5% → 85 · 4% → 75 · 3% → 65 · 2% → 55 · 1% → 45 · 0% → 35 · <0 → 25
  let score;
  if (eff >= 0.06) score = 95;
  else if (eff >= 0.05) score = 85;
  else if (eff >= 0.04) score = 75;
  else if (eff >= 0.03) score = 65;
  else if (eff >= 0.02) score = 55;
  else if (eff >= 0.01) score = 45;
  else if (eff >= 0)    score = 35;
  else                  score = 25;
  return {
    score,
    confidence: rentForecast.confidence || "low",
    note: `Effective CAGR ${(eff * 100).toFixed(2)}%/yr · baseline ${(rentForecast.baseline.cagr * 100).toFixed(2)}%/yr`,
  };
}

/**
 * Audited Tapestry Demand Forecast — score from the demand-forecast
 * confidence tier + the per-capita demand level. High per-capita + high
 * confidence = high score.
 */
function scoreDemand(demandForecast) {
  if (!demandForecast) return { score: 0, confidence: "low", note: "Demand forecast unavailable" };
  const confScore = demandForecast.confidence === "high" ? 85
    : demandForecast.confidence === "medium" ? 70
    : 50;
  // Per-capita demand uplift: above 6.0 SF/cap = +10; 5.0-6.0 = +5; below 4.5 = -5
  const dpc = Number(demandForecast.demandPerCapita) || 0;
  const dpcAdj = dpc >= 6.0 ? 10 : dpc >= 5.0 ? 5 : dpc < 4.5 ? -5 : 0;
  return {
    score: Math.max(0, Math.min(100, confScore + dpcAdj)),
    confidence: demandForecast.confidence || "low",
    note: `${dpc.toFixed(2)} SF/capita · confidence ${demandForecast.confidence}`,
  };
}

/**
 * Source diversity — how many independent primary-source registries
 * contributed to this submarket's forecasts. More sources = more robust.
 */
function scoreSourceDiversity(equilibrium, rentForecast) {
  const supplyPrimary = equilibrium?.supplyForecast?.primarySourceCount || 0;
  const demandPrimary = equilibrium?.demandForecast ? 1 : 0;
  const rentPrimary = rentForecast?.baseline?.fallbackUsed === false ? 1 : 0;
  const total = supplyPrimary + demandPrimary + rentPrimary;
  // Map 0-5+ total sources to 30-95
  let score;
  if (total >= 5) score = 95;
  else if (total === 4) score = 85;
  else if (total === 3) score = 75;
  else if (total === 2) score = 60;
  else if (total === 1) score = 45;
  else                   score = 30;
  return {
    score,
    confidence: total >= 3 ? "high" : total >= 2 ? "medium" : "low",
    note: `${total} primary-source contribution${total !== 1 ? "s" : ""} (supply ${supplyPrimary} · demand ${demandPrimary} · rent ${rentPrimary})`,
  };
}

/**
 * Audit-trail completeness — % of upstream engines with non-fallback,
 * non-missing inputs. Penalizes when the underlying forecasts had to fall
 * back to coarser data.
 */
function scoreAuditCompleteness(supplyForecast, equilibrium, rentForecast, demandForecast) {
  const checks = [
    { passed: !!supplyForecast && supplyForecast.confidenceTier !== "low", label: "supply forecast" },
    { passed: !!equilibrium && equilibrium.compositeConfidence !== "low", label: "equilibrium" },
    { passed: !!rentForecast && rentForecast.confidence !== "low" && !rentForecast.baseline.fallbackUsed, label: "rent baseline" },
    { passed: !!demandForecast && demandForecast.confidence !== "low" && (demandForecast.missingFields || []).length === 0, label: "demand forecast" },
  ];
  const pass = checks.filter(c => c.passed).length;
  const total = checks.length;
  const pct = pass / total;
  // Map pct to score 35-95
  const score = Math.round(35 + pct * 60);
  return {
    score,
    confidence: pct >= 0.75 ? "high" : pct >= 0.50 ? "medium" : "low",
    note: `${pass}/${total} upstream engines fully populated · ${(pct * 100).toFixed(0)}%`,
    failedChecks: checks.filter(c => !c.passed).map(c => c.label),
  };
}

// ─── Grade derivation ───────────────────────────────────────────────────

function classifyGrade(score, grades = DEFAULT_URC_GRADES) {
  if (score == null || !Number.isFinite(score)) {
    return { label: "?", color: "#64748B", note: "Insufficient data", min: null };
  }
  for (const g of grades) {
    if (score >= g.min) return g;
  }
  return grades[grades.length - 1];
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Compute the Underwriting Confidence Score for a submarket.
 *
 * @param {Object} query
 * @param {string} [query.city]
 * @param {string} [query.state]
 * @param {string} [query.msa]
 * @param {string} [query.operator="PSA"]
 * @param {number} [query.horizonMonths=24]
 * @param {Object} [query.ring]      demographic ring (for equilibrium + demand)
 * @param {number} [query.currentCCSF]
 * @param {Date}   [query.asOf=now]
 * @param {Object} [query.weights]   override DEFAULT_URC_WEIGHTS
 * @param {Array}  [query.grades]    override DEFAULT_URC_GRADES
 *
 * @returns {{
 *   submarket: { city, state, msa, operator },
 *   horizonMonths: number,
 *   asOf: string,
 *   compositeScore: number | null,
 *   grade: { label, color, note, min },
 *   gradeConfidence: 'high' | 'medium' | 'low',
 *   subScores: {
 *     forwardSupply: {score, confidence, note, weight, weighted},
 *     equilibrium:   {...},
 *     forwardRent:   {...},
 *     demand:        {...},
 *     sourceDiversity: {...},
 *     auditCompleteness: {...}
 *   },
 *   upstream: { supplyForecast, equilibrium, rentForecast, demandForecast },
 *   diligenceItems: string[],
 *   weights: Object,
 *   missing: string[]
 * }}
 */
export function computeUnderwritingConfidence(query = {}) {
  const {
    city = null,
    state = null,
    msa = null,
    operator = "PSA",
    horizonMonths = 24,
    ring = null,
    currentCCSF = null,
    asOf = new Date(),
    weights = DEFAULT_URC_WEIGHTS,
    grades = DEFAULT_URC_GRADES,
  } = query;

  const missing = [];
  const W = { ...DEFAULT_URC_WEIGHTS, ...weights };

  // ── Upstream forecasts ────────────────────────────────────────────────
  let supplyForecast = null;
  try {
    supplyForecast = computeForwardSupplyForecast({
      city, state, msa, horizonMonths, asOf, includeHistoricalProjection: true,
    });
  } catch (err) { missing.push("supplyForecast"); }

  let equilibrium = null;
  if (ring) {
    try {
      equilibrium = computeSupplyDemandEquilibrium({
        city, state, msa, horizonMonths, ring,
        currentCCSF: currentCCSF || undefined, asOf,
      });
    } catch (err) { missing.push("equilibrium"); }
  } else {
    missing.push("ring");
  }

  let rentForecast = null;
  if (msa || city) {
    try {
      rentForecast = computeForwardRentTrajectory({
        city, state, msa, operator,
        horizonMonths: Math.max(60, horizonMonths),
        ring, currentCCSF: currentCCSF || undefined, asOf,
      });
    } catch (err) { missing.push("rentForecast"); }
  }

  let demandForecast = null;
  if (ring) {
    try {
      const normalizedRing = ring.pop != null ? ring : extractRingForDemandForecast(ring);
      demandForecast = forecastStorageDemand(normalizedRing, {});
    } catch (err) { missing.push("demandForecast"); }
  }

  // ── Sub-scores ────────────────────────────────────────────────────────
  const fs = scoreForwardSupply(supplyForecast);
  const eq = scoreEquilibrium(equilibrium);
  const fr = scoreForwardRent(rentForecast);
  const dm = scoreDemand(demandForecast);
  const sd = scoreSourceDiversity(equilibrium, rentForecast);
  const ac = scoreAuditCompleteness(supplyForecast, equilibrium, rentForecast, demandForecast);

  const subScores = {
    forwardSupply:     { ...fs, weight: W.forwardSupply,     weighted: fs.score * W.forwardSupply },
    equilibrium:       { ...eq, weight: W.equilibrium,       weighted: eq.score * W.equilibrium },
    forwardRent:       { ...fr, weight: W.forwardRent,       weighted: fr.score * W.forwardRent },
    demand:            { ...dm, weight: W.demand,            weighted: dm.score * W.demand },
    sourceDiversity:   { ...sd, weight: W.sourceDiversity,   weighted: sd.score * W.sourceDiversity },
    auditCompleteness: { ...ac, weight: W.auditCompleteness, weighted: ac.score * W.auditCompleteness },
  };

  // Composite score = Σ (sub × weight). Weights sum to 1.0 by default.
  const weightSum = Object.values(W).reduce((s, w) => s + w, 0);
  const rawComposite = Object.values(subScores).reduce((s, ss) => s + ss.weighted, 0);
  const compositeScore = weightSum > 0 ? rawComposite / weightSum : null;

  const grade = classifyGrade(compositeScore, grades);

  // Grade confidence — minimum confidence across non-zero-weight sub-scores
  const confidences = Object.values(subScores).filter(s => s.weight > 0).map(s => s.confidence);
  const lowCount = confidences.filter(c => c === "low").length;
  const highCount = confidences.filter(c => c === "high").length;
  let gradeConfidence;
  if (highCount >= 4 && lowCount === 0) gradeConfidence = "high";
  else if (lowCount <= 1) gradeConfidence = "medium";
  else gradeConfidence = "low";

  // Diligence items — actionable items the underwriter should address
  const diligenceItems = [];
  if (ac.failedChecks && ac.failedChecks.length > 0) {
    for (const f of ac.failedChecks) {
      diligenceItems.push(`Upstream ${f} is missing or low-confidence — refresh primary-source registry before committing capital`);
    }
  }
  if (rentForecast?.baseline?.fallbackUsed) {
    diligenceItems.push(`Rent baseline fell back to ${rentForecast.baseline.cagrSource} — per-MSA series unavailable for this submarket`);
  }
  if (equilibrium && equilibrium.equilibriumRatio == null) {
    diligenceItems.push("Equilibrium ratio could not be computed — verify demographic ring inputs (pop, renterPct, growthRate)");
  }
  if (supplyForecast && supplyForecast.primarySourceCount < 2) {
    diligenceItems.push("Forward supply forecast has fewer than 2 primary-source contributions — coverage gap; consider county-permit ingest for this market");
  }
  if (missing.includes("ring")) {
    diligenceItems.push("Demographic ring not supplied — equilibrium + demand sub-scores defaulted to 0. Provide a Tapestry-enriched 3-mi ring.");
  }

  return {
    submarket: { city, state, msa, operator },
    horizonMonths,
    asOf: asOf instanceof Date ? asOf.toISOString() : new Date(asOf).toISOString(),
    compositeScore,
    grade,
    gradeConfidence,
    subScores,
    upstream: { supplyForecast, equilibrium, rentForecast, demandForecast },
    diligenceItems,
    weights: W,
    missing,
  };
}

/**
 * Render a one-paragraph English summary of the URC result.
 */
export function describeUnderwritingConfidence(result) {
  if (!result) return "Underwriting confidence unavailable — insufficient input data.";

  const sm = result.submarket;
  const smLabel = sm.msa || `${sm.city || "?"}, ${sm.state || "?"}`;
  if (result.compositeScore == null) {
    return `Underwriting Confidence Score for ${smLabel} — cannot compute (${result.missing.join(", ") || "no upstream data"}).`;
  }

  const subs = result.subScores;
  return (
    `Underwriting Confidence Score for ${smLabel} (${sm.operator}, ${result.horizonMonths}-month horizon): ` +
    `Grade ${result.grade.label} · composite ${result.compositeScore.toFixed(1)}/100 · ` +
    `grade confidence ${result.gradeConfidence.toUpperCase()}. ` +
    `Sub-scores: supply ${subs.forwardSupply.score.toFixed(0)} · ` +
    `equilibrium ${subs.equilibrium.score.toFixed(0)} · ` +
    `rent ${subs.forwardRent.score.toFixed(0)} · ` +
    `demand ${subs.demand.score.toFixed(0)} · ` +
    `source diversity ${subs.sourceDiversity.score.toFixed(0)} · ` +
    `audit completeness ${subs.auditCompleteness.score.toFixed(0)}. ` +
    `${result.grade.note}.` +
    (result.diligenceItems.length > 0
      ? ` Diligence items: ${result.diligenceItems.length}.`
      : "")
  );
}

export default computeUnderwritingConfidence;
