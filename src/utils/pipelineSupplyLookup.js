// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Supply Lookup
//
// Returns submarket-level new-supply pipeline data (CC SF + facility detail)
// for use in the projected CC SPC computation. Replaces the flat-supply
// approximation in the MARKET INTEL band's COMPETITION card with empirically
// grounded ingestion from primary sources.
//
// SYSTEM CLAIM (patent): A method for computing forward-looking
// climate-controlled self-storage supply-per-capita metric comprising
// aggregating per-submarket pipeline CC SF from primary-source disclosures,
// normalizing with status-weighted confidence
// (under_construction=1.0, permitted=0.85, announced=0.50), and computing
// projected CC SPC as (current + status-weighted pipeline) / projected pop.
//
// LOOKUP STRATEGY:
//   1. Exact submarket key match: "<City>, <State>"
//   2. Returns null on miss → caller falls through to flat-supply default
//
// FUTURE EXTENSION:
//   - Haversine fuzzy lookup against facility lat/lng for unmatched submarkets
//   - Periodic backfill from scripts/backfill-pipeline-supply.mjs (planned)
// ═══════════════════════════════════════════════════════════════════════════

import pipelineData from "../data/submarketPipelineSupply.json";

const STATUS_CONFIDENCE = {
  under_construction: 1.0,
  permitted: 0.85,
  announced: 0.50,
};

/**
 * Look up pipeline supply data for a submarket.
 *
 * @param {string} city  - City name (e.g. "Aubrey")
 * @param {string} state - 2-letter state code (e.g. "TX")
 * @returns {{
 *   pipelineCCSF: number,
 *   facilities: Array<{operator, sf, status, expectedDelivery, source}>,
 *   asOf: string,
 *   confidence: 'high' | 'medium' | 'low',
 *   notes: string,
 *   matched: true
 * } | { matched: false, fallback: 'flat-supply' }}
 */
export function lookupPipelineSupply(city, state) {
  if (!city || !state) return { matched: false, fallback: "flat-supply" };
  const key = `${city.trim()}, ${state.trim().toUpperCase()}`;
  const entry = pipelineData.submarkets?.[key];
  if (!entry || typeof entry !== "object" || entry === pipelineData.submarkets._README) {
    return { matched: false, fallback: "flat-supply" };
  }
  return { ...entry, matched: true, key };
}

/**
 * Compute status-weighted pipeline CC SF from a facilities array.
 * Used when the precomputed `pipelineCCSF` field needs verification or when
 * facilities are added/removed and the sum needs recomputing.
 */
export function computeWeightedPipelineCCSF(facilities) {
  if (!Array.isArray(facilities) || facilities.length === 0) return 0;
  return facilities.reduce((sum, f) => {
    const weight = STATUS_CONFIDENCE[f.status] ?? 0.5;
    return sum + (Number(f.sf) || 0) * weight;
  }, 0);
}

/**
 * Compute projected 5-yr CC SPC with pipeline supply ingestion.
 *
 * @param {number} currentCCSF       - Existing CC SF within 3-mi (sum)
 * @param {number} projectedPopFY    - ESRI 2030 projected population
 * @param {string} city              - For pipeline lookup
 * @param {string} state             - For pipeline lookup
 * @returns {{
 *   projectedCCSPC: number | null,
 *   pipelineCCSF: number,
 *   methodology: 'pipeline-aware' | 'flat-supply',
 *   submarketMatched: boolean,
 *   submarketKey: string | null,
 *   asOf: string | null
 * }}
 */
export function computeProjectedCCSPC(currentCCSF, projectedPopFY, city, state) {
  if (!projectedPopFY || projectedPopFY <= 0) {
    return {
      projectedCCSPC: null,
      pipelineCCSF: 0,
      methodology: "flat-supply",
      submarketMatched: false,
      submarketKey: null,
      asOf: null,
    };
  }
  const lookup = lookupPipelineSupply(city, state);
  if (lookup.matched) {
    return {
      projectedCCSPC: (currentCCSF + lookup.pipelineCCSF) / projectedPopFY,
      pipelineCCSF: lookup.pipelineCCSF,
      methodology: "pipeline-aware",
      submarketMatched: true,
      submarketKey: lookup.key,
      asOf: lookup.asOf,
    };
  }
  return {
    projectedCCSPC: currentCCSF / projectedPopFY,
    pipelineCCSF: 0,
    methodology: "flat-supply",
    submarketMatched: false,
    submarketKey: null,
    asOf: null,
  };
}

export const PIPELINE_REGISTRY_VERSION = pipelineData.version;
export const PIPELINE_REGISTRY_GENERATED_AT = pipelineData.generatedAt;
