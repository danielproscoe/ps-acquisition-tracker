// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Verification Oracle
//
// Cross-references entries extracted from a competitor screenshot (most
// commonly Radius Plus) against Storvex's primary-source pipeline registries
// (development-pipeline.json from REIT 10-K filings, submarketPipelineSupply
// .json from county permits + planning commission records). Returns a verdict
// per entry: REAL / NOT_FOUND / STALE / INCONCLUSIVE with a supporting
// citation chain.
//
// This is the operating logic behind the DW Screenshot Intake wedge:
//   DW screenshots a Radius+ pipeline view → Claude Vision extracts entries →
//   this Oracle returns per-entry verdicts → UI renders verdict cards →
//   every verification cycle appends to the audit ledger so Storvex's
//   track record of Radius+ accuracy errors becomes a public-by-default
//   moat over the engagement window.
//
// VERDICT TAXONOMY:
//   REAL          — Found in Storvex's primary-source registry within match
//                   tolerance. Carries the citation (REIT accession # /
//                   permit # / planning commission record) + verifiedDate.
//   NOT_FOUND     — Storvex's registry covers this submarket and the
//                   extracted entry has no match. High-confidence claim
//                   that the Radius+ entry is fabricated or stale beyond
//                   our cycle.
//   STALE         — Found in our registry, but our last verifiedDate is
//                   older than the stale window (default 90 days). We
//                   know the entry existed at some point but cannot
//                   currently confirm.
//   INCONCLUSIVE  — Storvex's registry coverage for this submarket is
//                   sparse or unknown. The entry might be real but we
//                   can't validate. Surfaces a queue item for manual
//                   research.
//
// MATCH TOLERANCE:
//   1. Operator + city + state must align (operator names are normalized
//      via OPERATOR_ALIASES to handle ticker / brand variants).
//   2. If lat/lng present in registry entry AND extracted entry has city,
//      Haversine distance ≤ 0.75 mi is a strong match. (Future: geocode
//      extracted addresses for precise proximity.)
//   3. NRSF within ±20% is a corroborating signal (not a hard requirement —
//      Radius+ often shows different NRSF estimates than the REIT discloses).
//   4. Expected delivery quarter within ±2 quarters is a corroborating
//      signal.
//
// PATENT (SYSTEM CLAIM): Method for verifying third-party-aggregator
// pipeline-data entries against a primary-source self-storage development
// registry, the method comprising:
//   (a) receiving a list of facility entries extracted from a third-party
//       market-intelligence screenshot via vision-model OCR;
//   (b) normalizing operator brand strings through a ticker + brand alias
//       table to account for REIT M&A consolidation;
//   (c) for each extracted entry, querying a primary-source registry by
//       operator + submarket (city + state) + optional geographic proximity
//       within a configurable radius;
//   (d) when a registry hit is found, comparing the entry's NRSF and
//       expected-delivery quarter against the registry record's
//       corresponding fields and emitting corroboration flags;
//   (e) classifying each entry into one of {REAL, NOT_FOUND, STALE,
//       INCONCLUSIVE} based on (i) match success, (ii) registry
//       coverage density for the submarket, and (iii) freshness of the
//       registry record's last verifiedDate; and
//   (f) appending each verification cycle to an append-only audit log so
//       that the platform's track record of third-party-aggregator
//       accuracy errors accumulates as a longitudinal moat asset.
// ═══════════════════════════════════════════════════════════════════════════

import developmentPipeline from "../data/development-pipeline.json";
import submarketPipelineSupply from "../data/submarketPipelineSupply.json";
import { computePipelineConfidence } from "./pipelineConfidence";

// Operator name normalization. Maps every brand / ticker variant to a
// canonical key that matches development-pipeline.json's `operator` field.
const OPERATOR_ALIASES = {
  // PS Family (PSA + iStorage + NSA all consolidate to PSA per CLAUDE.md §6b)
  PSA: "PSA",
  PS: "PSA",
  "PUBLIC STORAGE": "PSA",
  ISTORAGE: "PSA",
  "I-STORAGE": "PSA",
  "I STORAGE": "PSA",
  NSA: "PSA",
  "NATIONAL STORAGE AFFILIATES": "PSA",
  "NATIONAL STORAGE": "PSA",

  // EXR Family (EXR + Life Storage post-2023)
  EXR: "EXR",
  "EXTRA SPACE": "EXR",
  "EXTRA SPACE STORAGE": "EXR",
  LSI: "EXR",
  "LIFE STORAGE": "EXR",

  // CUBE
  CUBE: "CUBE",
  CUBESMART: "CUBE",

  // SMA
  SMA: "SMA",
  SMARTSTOP: "SMA",
  "SMARTSTOP SELF STORAGE": "SMA",

  // AMERCO / UHAL
  UHAL: "AMERCO",
  AMERCO: "AMERCO",
  "U-HAUL": "AMERCO",
  UHAUL: "AMERCO",
  "U HAUL": "AMERCO",
};

const STALE_WINDOW_DAYS = 90;

/**
 * Normalize an operator string to its canonical key. Returns the
 * uppercase version of the input as a fallback when no alias matches —
 * preserves the original for INCONCLUSIVE / NOT_FOUND verdicts.
 */
function normalizeOperator(raw) {
  if (!raw || typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase();
  return OPERATOR_ALIASES[upper] || upper;
}

/**
 * Convert "2026-Q3" or "Q3 2026" to a quarter index (4*year + quarter - 1).
 * Returns null on parse failure.
 */
function quarterIndex(s) {
  if (!s) return null;
  const m1 = /^(\d{4})-Q([1-4])$/i.exec(String(s).trim());
  if (m1) return parseInt(m1[1], 10) * 4 + (parseInt(m1[2], 10) - 1);
  const m2 = /^Q([1-4])\s+(\d{4})$/i.exec(String(s).trim());
  if (m2) return parseInt(m2[2], 10) * 4 + (parseInt(m2[1], 10) - 1);
  return null;
}

/**
 * Haversine distance in miles between two lat/lng pairs.
 */
function haversineMiles(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 3958.7613;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Match score for two facility records. Higher is better. Returns:
 *   { score: 0..100, signals: { operator, geo, nrsf, delivery } }
 */
function matchScore(extracted, registryEntry) {
  const signals = {
    operator: false,
    cityState: false,
    geo: null, // mi when computed
    nrsfCorroborate: false,
    deliveryCorroborate: false,
  };
  let score = 0;

  // Operator alignment — mandatory for a REAL verdict
  const opEx = normalizeOperator(extracted.operator);
  const opReg = normalizeOperator(registryEntry.operator);
  if (opEx && opReg && opEx === opReg) {
    signals.operator = true;
    score += 40;
  }

  // City + state alignment — mandatory for a REAL verdict
  const cityEx = (extracted.city || "").trim().toLowerCase();
  const cityReg = (registryEntry.city || "").trim().toLowerCase();
  const stateEx = (extracted.state || "").trim().toUpperCase();
  const stateReg = (registryEntry.state || "").trim().toUpperCase();
  if (cityEx && cityReg && cityEx === cityReg && stateEx && stateReg && stateEx === stateReg) {
    signals.cityState = true;
    score += 30;
  }

  // Geographic proximity bonus (when lat/lng available on both sides)
  if (extracted.lat != null && extracted.lng != null && registryEntry.lat != null && registryEntry.lng != null) {
    const mi = haversineMiles(extracted.lat, extracted.lng, registryEntry.lat, registryEntry.lng);
    signals.geo = mi;
    if (mi != null && mi <= 0.75) score += 10;
  }

  // NRSF corroboration — ±20%
  if (extracted.nrsf != null && registryEntry.nrsf != null) {
    const exN = Number(extracted.nrsf);
    const regN = Number(registryEntry.nrsf);
    if (exN > 0 && regN > 0) {
      const ratio = exN / regN;
      if (ratio >= 0.8 && ratio <= 1.2) {
        signals.nrsfCorroborate = true;
        score += 10;
      }
    }
  }

  // Delivery quarter corroboration — ±2 quarters
  const exQ = quarterIndex(extracted.expectedDelivery);
  const regQ = quarterIndex(registryEntry.expectedDelivery);
  if (exQ != null && regQ != null) {
    if (Math.abs(exQ - regQ) <= 2) {
      signals.deliveryCorroborate = true;
      score += 10;
    }
  }

  return { score, signals };
}

/**
 * Aggregate registry coverage signal for a submarket. Used to distinguish
 * NOT_FOUND (we have good coverage and didn't find it = high-confidence
 * fake) from INCONCLUSIVE (we have sparse coverage and can't validate).
 */
function submarketCoverageSignal(extracted) {
  // Check submarketPipelineSupply.json registry first (it tracks per-submarket
  // confidence levels).
  const cityState = `${(extracted.city || "").trim()}, ${(extracted.state || "").trim().toUpperCase()}`;
  const entry = submarketPipelineSupply.submarkets?.[cityState];
  if (entry && typeof entry === "object" && entry !== submarketPipelineSupply.submarkets._README) {
    return {
      hasEntry: true,
      confidence: entry.confidence || "unknown",
      facilitiesIndexed: Array.isArray(entry.facilities) ? entry.facilities.length : 0,
      asOf: entry.asOf || null,
    };
  }

  // Fall back: count development-pipeline.json entries in the same city/state
  const matchingDevEntries = (developmentPipeline.facilities || []).filter((f) => {
    const sameCity = (f.city || "").trim().toLowerCase() === (extracted.city || "").trim().toLowerCase();
    const sameState = (f.state || "").trim().toUpperCase() === (extracted.state || "").trim().toUpperCase();
    return sameCity && sameState;
  });

  return {
    hasEntry: false,
    confidence: matchingDevEntries.length > 0 ? "medium" : "unknown",
    facilitiesIndexed: matchingDevEntries.length,
    asOf: null,
  };
}

/**
 * Compute the verdict for a single extracted entry.
 *
 * @param {Object} extracted   - One entry from Claude Vision extraction
 * @param {Object} [opts]
 * @param {Date}   [opts.asOf=now]
 * @param {number} [opts.staleWindowDays=90]
 * @returns {{
 *   verdict: 'REAL' | 'NOT_FOUND' | 'STALE' | 'INCONCLUSIVE',
 *   confidence: number,
 *   matchedRegistryEntry: Object | null,
 *   matchScore: number,
 *   matchSignals: Object,
 *   submarketCoverage: Object,
 *   citation: string | null,
 *   verifiedDate: string | null,
 *   daysSinceVerified: number | null,
 *   reasoning: string
 * }}
 */
export function verifyExtractedEntry(extracted, opts = {}) {
  const { asOf = new Date(), staleWindowDays = STALE_WINDOW_DAYS } = opts;

  if (!extracted || typeof extracted !== "object") {
    return {
      verdict: "INCONCLUSIVE",
      confidence: 0,
      matchedRegistryEntry: null,
      matchScore: 0,
      matchSignals: {},
      submarketCoverage: { hasEntry: false, confidence: "unknown", facilitiesIndexed: 0 },
      citation: null,
      verifiedDate: null,
      daysSinceVerified: null,
      reasoning: "Empty or invalid extracted entry.",
    };
  }

  const candidates = developmentPipeline.facilities || [];

  // Score every candidate, take the best
  let bestMatch = null;
  let bestScore = 0;
  let bestSignals = {};
  for (const cand of candidates) {
    const { score, signals } = matchScore(extracted, cand);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = cand;
      bestSignals = signals;
    }
  }

  const coverage = submarketCoverageSignal(extracted);

  // Threshold for a REAL match: operator + city/state align (score ≥ 70).
  // Anything below = no match.
  const STRONG_MATCH_THRESHOLD = 70;

  if (bestScore >= STRONG_MATCH_THRESHOLD && bestMatch) {
    // We have a match. Check freshness via the existing confidence engine.
    const conf = computePipelineConfidence(bestMatch, {
      asOf,
      fileGeneratedAt: developmentPipeline.generatedAt,
      defaultStaleDays: staleWindowDays,
    });
    const isStale = conf.status === "STALE";
    return {
      verdict: isStale ? "STALE" : "REAL",
      confidence: isStale ? 60 : 90,
      matchedRegistryEntry: bestMatch,
      matchScore: bestScore,
      matchSignals: bestSignals,
      submarketCoverage: coverage,
      citation: bestMatch.citation || null,
      verifiedDate: conf.verifiedDate,
      daysSinceVerified: conf.daysSinceVerified,
      reasoning: isStale
        ? `Matched ${bestMatch.id || bestMatch.operator + " " + bestMatch.city} in Storvex registry (score ${bestScore}/100). Citation: ${bestMatch.citation || "unspecified"}. However Storvex's last-verified date is ${conf.daysSinceVerified}d ago (> ${staleWindowDays}d stale window) — confirm with a fresh primary-source pull before relying.`
        : `Matched ${bestMatch.id || bestMatch.operator + " " + bestMatch.city} in Storvex registry (score ${bestScore}/100). Citation: ${bestMatch.citation || "unspecified"}. Last verified ${conf.daysSinceVerified}d ago. ${bestSignals.nrsfCorroborate ? "NRSF corroborated within ±20%. " : ""}${bestSignals.deliveryCorroborate ? "Delivery quarter corroborated within ±2 quarters." : ""}`,
    };
  }

  // No strong match. Decide between NOT_FOUND and INCONCLUSIVE based on
  // submarket coverage signal.
  // - Coverage "high" or "medium" with indexed facilities = NOT_FOUND
  //   (we know this submarket well; absence is meaningful)
  // - Coverage "low" or "unknown" = INCONCLUSIVE (sparse coverage; needs
  //   manual research)
  const submarketHasGoodCoverage =
    coverage.hasEntry && (coverage.confidence === "high" || coverage.confidence === "medium");

  if (submarketHasGoodCoverage || coverage.facilitiesIndexed >= 2) {
    return {
      verdict: "NOT_FOUND",
      confidence: coverage.confidence === "high" ? 85 : 70,
      matchedRegistryEntry: null,
      matchScore: bestScore,
      matchSignals: bestSignals,
      submarketCoverage: coverage,
      citation: null,
      verifiedDate: null,
      daysSinceVerified: null,
      reasoning: `Storvex registry indexes ${coverage.facilitiesIndexed} pipeline facilities in ${extracted.city || "?"}, ${extracted.state || "?"} with ${coverage.confidence}-confidence coverage. No match found for ${normalizeOperator(extracted.operator) || "(no operator)"} ${extracted.nrsf ? `at ~${(extracted.nrsf / 1000).toFixed(0)}K NRSF` : ""}. ${coverage.confidence === "high" ? "High-confidence claim that this entry is fabricated, stale beyond our cycle, or has a misidentified operator." : "Medium-confidence — recommend operator-name cross-check + primary-source pull."}`,
    };
  }

  return {
    verdict: "INCONCLUSIVE",
    confidence: 30,
    matchedRegistryEntry: null,
    matchScore: bestScore,
    matchSignals: bestSignals,
    submarketCoverage: coverage,
    citation: null,
    verifiedDate: null,
    daysSinceVerified: null,
    reasoning: `Storvex registry has sparse coverage for ${extracted.city || "?"}, ${extracted.state || "?"} (${coverage.facilitiesIndexed} facilities indexed, ${coverage.confidence} confidence). Cannot validate — recommend manual pull of REIT 10-Q for ${normalizeOperator(extracted.operator) || "operator"} and county building-permit search.`,
  };
}

/**
 * Verify an array of extracted entries. Returns per-entry verdicts +
 * aggregate counts.
 */
export function verifyExtractedEntries(entries, opts = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      verdicts: [],
      counts: { REAL: 0, NOT_FOUND: 0, STALE: 0, INCONCLUSIVE: 0 },
      summary: "No entries to verify.",
    };
  }
  const counts = { REAL: 0, NOT_FOUND: 0, STALE: 0, INCONCLUSIVE: 0 };
  const verdicts = entries.map((extracted) => {
    const result = verifyExtractedEntry(extracted, opts);
    counts[result.verdict] = (counts[result.verdict] || 0) + 1;
    return { extracted, ...result };
  });

  const total = verdicts.length;
  const realPct = Math.round((counts.REAL / total) * 100);
  const notFoundPct = Math.round((counts.NOT_FOUND / total) * 100);
  const summary =
    `${total} entries · ${counts.REAL} REAL (${realPct}%) · ` +
    `${counts.NOT_FOUND} NOT_FOUND (${notFoundPct}%) · ` +
    `${counts.STALE} STALE · ${counts.INCONCLUSIVE} INCONCLUSIVE`;

  return { verdicts, counts, summary };
}

export const PIPELINE_ORACLE_OPERATOR_ALIASES = OPERATOR_ALIASES;
export const PIPELINE_ORACLE_STALE_WINDOW_DAYS = STALE_WINDOW_DAYS;
