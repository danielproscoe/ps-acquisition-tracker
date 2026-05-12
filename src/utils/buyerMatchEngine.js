// buyerMatchEngine.js — the funnel-as-product engine.
//
// THE THESIS
// ----------
// Radius+ and TractIQ sell SCREENING software — pull data, decide for
// yourself who'd want it. Storvex inverts: every site sourced through
// the daily scan is auto-scored against every buyer-spec we maintain.
// Output is the funnel — a stream of vetted, REC-packaged opportunities
// pre-routed to the buyer who actually has the spec to pursue them.
//
// "Make their software pointless because the deals come to the buyer
// before they'd think to search." That requires:
//   1. A spec model per buyer (this file)
//   2. A score per (site, buyer) pair
//   3. A ranking that surfaces the buyer best-positioned to pursue
//   4. A push delivery layer (digest emails — future sprint)
//
// SPEC MODEL
// ----------
// Each buyer-spec encodes the sourcing criteria — acreage band, demo
// floors, proximity rules, market-tier preferences, infrastructure needs.
// Distinct from the buyerLensProfiles.js underwriting math (which encodes
// HOW the buyer underwrites a given site). Together: lens = how, spec =
// whether-to-look.
//
// The 6 specs below cover the operator-end-buyers Storvex currently
// sources for. Capital partners (Vault, Madison) are flip-buyers with
// different criteria and route via the existing Storage Post / Pressure
// Sentinel pipelines — they live in a future sourceMatchEngine.js.
//
// EXTENSIBILITY
// -------------
// Add a buyer = add an entry to BUYER_SPECS. The scoring function below
// reads only the spec's declared fields, so new specs need only the
// fields they care about. Weights are normalized at scoring time.

/**
 * Per-buyer sourcing specs. Each describes the physical + demographic +
 * locational profile of a site this buyer would actively pursue.
 *
 * Calibration anchors:
 *   - PS / PSA: CLAUDE.md §6 + memory/people/daniel-wollent.md +
 *     memory/people/matthew-toussaint.md target-market tables
 *   - AMERCO / U-Haul: memory/people/aaron-liken.md (4-7 ac interstate)
 *     + memory/people/jennifer-settles.md
 *   - EXR / LSI: FY2025 10-K acquisition criteria (top-100 MSAs)
 *   - CUBE: secondary-market infill thesis (FY2025 same-store mix)
 *   - SMA: Canadian + select US small-format
 *   - GENERIC: floor profile — minimum bar to advance ANYWHERE
 */
export const BUYER_SPECS = {
  PS: {
    name: "PSA — Public Storage",
    recipient: "Reza Mahdavian / DW / MT",
    routeTo: { east: "MT", southwest: "DW" },
    sweetSpotAcres: { min: 3.5, max: 5.0, ideal: 4.0 },
    secondaryAcres: { min: 2.5, max: 3.5, note: "multi-story product" },
    overAcres: { min: 5.0, max: 7.0, note: "viable if subdivisible" },
    minPop3mi: 25000,
    floorPop3mi: 15000,
    minHHI3mi: 65000,
    floorHHI3mi: 55000,
    minHouseholds3mi: 8000,
    maxProxToPSFamilyMi: 25,
    excludeProxToPSFamilyMi: 35,
    maxCCSPC: 5.0,
    floorCCSPC: 7.0,
    targetMSATiers: [1, 2, 3, 4],
    excludeStates: ["CA", "WY", "OR", "WA"],
    needsInterstateAccess: false,
    needsTruckStaging: false,
    needsClimateControlBuildViable: true,
    weights: {
      acreage: 0.18,
      pop3mi: 0.14,
      hhi3mi: 0.10,
      proximityPSFamily: 0.15,
      ccSPC: 0.15,
      zoningPath: 0.12,
      marketTier: 0.06,
      access: 0.05,
      growth: 0.05,
    },
  },

  AMERCO: {
    name: "AMERCO — U-Haul",
    recipient: "Aaron Liken / Jennifer Settles",
    routeTo: { default: "buyer-rep" },
    sweetSpotAcres: { min: 4.0, max: 7.0, ideal: 5.5 },
    secondaryAcres: { min: 3.0, max: 4.0, note: "tight but viable on visible corner" },
    overAcres: { min: 7.0, max: 12.0, note: "AMERCO welcomes larger sites — truck staging + RV/boat" },
    minPop3mi: 30000,
    floorPop3mi: 18000,
    minHHI3mi: 55000,
    floorHHI3mi: 45000,
    minHouseholds3mi: 10000,
    maxProxToPSFamilyMi: null,  // AMERCO doesn't care about PS proximity
    targetMSATiers: [1, 2, 3, 4, 5],
    excludeStates: ["CA", "WY", "OR", "WA"],
    needsInterstateAccess: true,        // truck rental requires highway access
    needsTruckStaging: true,            // ≥4 ac for truck staging area
    needsHighVPD: true,                  // 25K+ VPD on adjacent road
    needsClimateControlBuildViable: false,  // AMERCO product mix flexes
    needsTruckCrossSubsidy: true,        // dual-use viability is the moat vs PSA
    weights: {
      acreage: 0.18,
      pop3mi: 0.10,
      hhi3mi: 0.05,
      interstateAccess: 0.16,
      truckStaging: 0.12,
      access: 0.14,
      visibility: 0.10,
      zoningPath: 0.10,
      growth: 0.05,
    },
  },

  EXR: {
    name: "EXR — Extra Space Storage",
    recipient: "EXR acquisitions team (no direct contact yet)",
    routeTo: { default: "pending-EXR-relationship" },
    sweetSpotAcres: { min: 3.5, max: 5.5, ideal: 4.5 },
    minPop3mi: 25000,
    floorPop3mi: 18000,
    minHHI3mi: 65000,
    floorHHI3mi: 55000,
    minHouseholds3mi: 8500,
    maxProxToExistingFacilityMi: 30,
    targetMSATiers: [1, 2, 3],
    excludeStates: ["CA", "WY", "OR", "WA"],
    needsInterstateAccess: false,
    needsClimateControlBuildViable: true,
    maxCCSPC: 5.5,
    weights: {
      acreage: 0.18,
      pop3mi: 0.16,
      hhi3mi: 0.12,
      proximityExistingFacility: 0.12,
      ccSPC: 0.15,
      zoningPath: 0.12,
      marketTier: 0.08,
      growth: 0.07,
    },
  },

  CUBE: {
    name: "CUBE — CubeSmart",
    recipient: "CUBE acquisitions team (no direct contact yet)",
    routeTo: { default: "pending-CUBE-relationship" },
    sweetSpotAcres: { min: 3.0, max: 5.0, ideal: 4.0 },
    minPop3mi: 15000,  // CUBE leans secondary metros
    floorPop3mi: 10000,
    minHHI3mi: 55000,
    floorHHI3mi: 45000,
    minHouseholds3mi: 5500,
    targetMSATiers: [3, 4, 5],  // CUBE's wedge: secondary + tertiary infill
    excludeStates: ["CA", "WY", "OR", "WA"],
    needsClimateControlBuildViable: true,
    maxCCSPC: 4.5,
    weights: {
      acreage: 0.16,
      pop3mi: 0.14,
      hhi3mi: 0.10,
      ccSPC: 0.16,
      zoningPath: 0.14,
      marketTier: 0.14,  // CUBE's wedge — they over-index on T3/T4
      growth: 0.08,
      access: 0.08,
    },
  },

  SMA: {
    name: "SMA — SmartStop Self Storage",
    recipient: "SmartStop dev team (no direct contact yet)",
    routeTo: { default: "pending-SMA-relationship" },
    sweetSpotAcres: { min: 2.5, max: 4.5, ideal: 3.5 },
    minPop3mi: 15000,
    floorPop3mi: 8000,
    minHHI3mi: 55000,
    floorHHI3mi: 45000,
    targetMSATiers: [2, 3, 4, 5],
    excludeStates: ["CA", "WY", "OR", "WA"],
    needsClimateControlBuildViable: true,
    maxCCSPC: 5.0,
    weights: {
      acreage: 0.18,
      pop3mi: 0.14,
      hhi3mi: 0.10,
      ccSPC: 0.15,
      zoningPath: 0.13,
      marketTier: 0.12,
      growth: 0.10,
      access: 0.08,
    },
  },

  GENERIC: {
    name: "GENERIC institutional storage buyer",
    recipient: "Capital partner / undeclared buyer-rep position",
    routeTo: { default: "capital-partner-rotation" },
    // GENERIC is the fallback lens — only the recommended route when NO
    // specific buyer (PSA/AMERCO/EXR/CUBE/SMA) scores VIABLE or better.
    // The match engine demotes fallback specs in rankBuyerFits() when any
    // non-fallback spec scores >= 5.5. Without this guard, GENERIC's wide
    // criteria + uniform weights make it the top score on ideal sites that
    // a specific buyer would actually pursue.
    isFallback: true,
    sweetSpotAcres: { min: 2.5, max: 6.0, ideal: 4.0 },
    minPop3mi: 12000,
    floorPop3mi: 5000,
    minHHI3mi: 55000,
    floorHHI3mi: 45000,
    targetMSATiers: [1, 2, 3, 4, 5],
    excludeStates: ["CA", "WY", "OR", "WA"],
    needsClimateControlBuildViable: false,
    weights: {
      acreage: 0.20,
      pop3mi: 0.18,
      hhi3mi: 0.15,
      zoningPath: 0.18,
      access: 0.10,
      ccSPC: 0.10,
      growth: 0.09,
    },
  },
};

export const BUYER_SPEC_ORDER = ["PS", "AMERCO", "EXR", "CUBE", "SMA", "GENERIC"];

// ─── Scoring helpers ────────────────────────────────────────────────────────

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function scoreAcreage(acreage, spec) {
  if (!Number.isFinite(acreage) || acreage <= 0) return 0;
  const sweet = spec.sweetSpotAcres;
  const secondary = spec.secondaryAcres;
  const over = spec.overAcres;
  if (sweet && acreage >= sweet.min && acreage <= sweet.max) {
    // Peaks at ideal acreage; tapers to 0.85 at sweet-spot edges.
    if (sweet.ideal && Number.isFinite(sweet.ideal)) {
      const range = (sweet.max - sweet.min) / 2;
      const dist = Math.abs(acreage - sweet.ideal);
      return clamp01(1 - 0.15 * (dist / range));
    }
    return 1;
  }
  if (secondary && acreage >= secondary.min && acreage <= secondary.max) return 0.65;
  if (over && acreage >= over.min && acreage <= over.max) return 0.55;
  return 0;
}

function scoreLinearFloor(value, floor, target) {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(floor)) return 0.5;
  if (value < floor) return 0;
  if (!Number.isFinite(target) || target <= floor) return value >= floor ? 1 : 0;
  return clamp01((value - floor) / (target - floor));
}

function scoreProximity(distMi, maxOk, hardCutoff) {
  if (!Number.isFinite(distMi)) return 0.5;
  if (Number.isFinite(hardCutoff) && distMi > hardCutoff) return 0;
  if (!Number.isFinite(maxOk)) return 0.5;
  if (distMi <= 2) return 0.9;       // very close — slight over-saturation risk
  if (distMi <= maxOk) return 1;     // sweet zone — within district network
  if (Number.isFinite(hardCutoff)) {
    return clamp01(1 - (distMi - maxOk) / Math.max(1, hardCutoff - maxOk));
  }
  return 0.6;
}

function scoreCCSPC(ccSPC, idealCeiling, hardCeiling) {
  if (!Number.isFinite(ccSPC)) return 0.5;
  if (Number.isFinite(hardCeiling) && ccSPC > hardCeiling) return 0;
  if (!Number.isFinite(idealCeiling)) return ccSPC < 5 ? 1 : 0.5;
  if (ccSPC < 1.5) return 1;
  if (ccSPC <= idealCeiling) return clamp01(1 - 0.25 * ((ccSPC - 1.5) / (idealCeiling - 1.5)));
  if (Number.isFinite(hardCeiling)) {
    return clamp01(0.5 * (1 - (ccSPC - idealCeiling) / Math.max(0.5, hardCeiling - idealCeiling)));
  }
  return 0.3;
}

function scoreMarketTier(tier, targetTiers) {
  if (!Number.isFinite(tier)) return 0.5;
  if (!Array.isArray(targetTiers) || !targetTiers.length) return 0.5;
  if (targetTiers.includes(tier)) {
    // Score higher for tiers closer to the buyer's preferred core.
    const idx = targetTiers.indexOf(tier);
    return clamp01(1 - 0.1 * idx);
  }
  return 0.2;
}

function scoreZoningPath(zoningPath) {
  if (!zoningPath) return 0.5;
  const p = String(zoningPath).toLowerCase();
  if (/by[-_ ]?right|permitted|industrial|commercial|etj|unincorporated/.test(p)) return 1;
  if (/conditional|sup|cup/.test(p)) return 0.7;
  if (/unknown/.test(p)) return 0.4;
  if (/rezone/.test(p)) return 0.3;
  if (/prohibit/.test(p)) return 0;
  return 0.5;
}

function scoreGrowth(growthPct) {
  if (!Number.isFinite(growthPct)) return 0.5;
  if (growthPct >= 2.5) return 1;
  if (growthPct >= 1.5) return 0.85;
  if (growthPct >= 0.5) return 0.6;
  if (growthPct >= 0) return 0.4;
  return 0.1;
}

function scoreAccess(siteSummary) {
  // Look for road-frontage / signalized-intersection / VPD signals in the
  // summary string. The site spec captures these into structured fields
  // eventually but the keyword heuristic is the fallback.
  const s = String(siteSummary || "").toLowerCase();
  if (/landlocked|easement[- ]only|no\s+road\s+access/.test(s)) return 0;
  let score = 0.5;
  if (/frontage|hard\s+corner|signal/.test(s)) score += 0.25;
  if (/interstate|highway|exit|on[- ]?ramp/.test(s)) score += 0.15;
  if (/[1-9]\d{4,}\s*vpd|high\s+traffic/.test(s)) score += 0.15;
  if (/visibility/.test(s)) score += 0.10;
  return clamp01(score);
}

function scoreInterstateAccess(site) {
  const s = String(site.summary || "").toLowerCase() + " " + String(site.frontageRoadName || "").toLowerCase() + " " + String(site.access || "").toLowerCase();
  if (/interstate|i[-_ ]?\d{1,3}|highway|exit|on[- ]?ramp|us[- ]?\d/.test(s)) return 1;
  if (/state\s+route|sh[- ]?\d|fm[- ]?\d/.test(s)) return 0.5;
  return 0.1;
}

function scoreTruckStaging(acreage, summary) {
  if (!Number.isFinite(acreage)) return 0.3;
  if (acreage < 3.0) return 0;
  if (acreage < 4.0) return 0.4;
  if (acreage < 5.5) return 0.85;
  return 1;
}

function scoreVisibility(summary) {
  const s = String(summary || "").toLowerCase();
  if (/hard\s+corner|hardcorner|prominent/.test(s)) return 1;
  if (/visibility|visible|frontage/.test(s)) return 0.75;
  if (/interior|tucked|set\s+back/.test(s)) return 0.3;
  return 0.6;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Score a single site against a single buyer-spec.
 *
 * @param {object} site — must include at minimum: acreage, pop3mi, hhi3mi,
 *                        state. Optional: nearestPSFamilyMi, ccSPC,
 *                        marketTier, growth3mi, zoningPath, summary.
 * @param {object} spec — entry from BUYER_SPECS.
 * @returns {{ score: number, breakdown: object, flagged: string[], hardFails: string[] }}
 */
export function scoreBuyerFit(site, spec) {
  if (!site || !spec) return { score: 0, breakdown: {}, flagged: ["missing-input"], hardFails: ["missing-input"] };

  const hardFails = [];
  const flagged = [];

  // Hard-exclusion gates
  if (Array.isArray(spec.excludeStates) && site.state && spec.excludeStates.includes(String(site.state).toUpperCase())) {
    hardFails.push(`state-${site.state}-excluded`);
  }
  if (Number.isFinite(spec.floorPop3mi) && Number.isFinite(site.pop3mi) && site.pop3mi < spec.floorPop3mi) {
    hardFails.push(`pop3mi-${site.pop3mi}-below-floor-${spec.floorPop3mi}`);
  }
  if (Number.isFinite(spec.floorHHI3mi) && Number.isFinite(site.hhi3mi) && site.hhi3mi < spec.floorHHI3mi) {
    hardFails.push(`hhi3mi-${site.hhi3mi}-below-floor-${spec.floorHHI3mi}`);
  }
  if (
    Number.isFinite(spec.excludeProxToPSFamilyMi) &&
    Number.isFinite(site.nearestPSFamilyMi) &&
    site.nearestPSFamilyMi > spec.excludeProxToPSFamilyMi
  ) {
    hardFails.push(`ps-family-${site.nearestPSFamilyMi}mi-beyond-${spec.excludeProxToPSFamilyMi}`);
  }

  // Dimension scores (each in [0, 1])
  const breakdown = {};
  breakdown.acreage = scoreAcreage(site.acreage, spec);
  breakdown.pop3mi = scoreLinearFloor(site.pop3mi, spec.floorPop3mi, spec.minPop3mi);
  breakdown.hhi3mi = scoreLinearFloor(site.hhi3mi, spec.floorHHI3mi, spec.minHHI3mi);
  breakdown.proximityPSFamily = spec.maxProxToPSFamilyMi
    ? scoreProximity(site.nearestPSFamilyMi, spec.maxProxToPSFamilyMi, spec.excludeProxToPSFamilyMi)
    : 0.5;
  breakdown.proximityExistingFacility = spec.maxProxToExistingFacilityMi
    ? scoreProximity(site.nearestExistingMi || site.nearestPSFamilyMi, spec.maxProxToExistingFacilityMi)
    : 0.5;
  breakdown.ccSPC = scoreCCSPC(site.ccSPC, spec.maxCCSPC, spec.floorCCSPC);
  breakdown.marketTier = scoreMarketTier(site.marketTier, spec.targetMSATiers);
  breakdown.zoningPath = scoreZoningPath(site.zoningPath || site.zoningClassification);
  breakdown.growth = scoreGrowth(site.growth3mi);
  breakdown.access = scoreAccess(site.summary || "");
  breakdown.interstateAccess = scoreInterstateAccess(site);
  breakdown.truckStaging = scoreTruckStaging(site.acreage, site.summary);
  breakdown.visibility = scoreVisibility(site.summary);

  // Apply normalized weights
  const w = spec.weights || {};
  const weightSum = Object.values(w).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  if (weightSum <= 0) {
    return { score: 0, breakdown, flagged: ["spec-weights-zero"], hardFails };
  }

  let score = 0;
  for (const [dim, weight] of Object.entries(w)) {
    const dimScore = breakdown[dim];
    if (Number.isFinite(dimScore)) {
      score += (dimScore * weight) / weightSum;
    }
  }
  // Scale to 0-10 to match SiteScore convention
  score = Math.round(score * 10 * 100) / 100;

  // Soft flags — not killers but worth surfacing
  if (Number.isFinite(spec.minPop3mi) && Number.isFinite(site.pop3mi) && site.pop3mi < spec.minPop3mi) {
    flagged.push(`pop3mi-${site.pop3mi}-below-target-${spec.minPop3mi}`);
  }
  if (Number.isFinite(spec.minHHI3mi) && Number.isFinite(site.hhi3mi) && site.hhi3mi < spec.minHHI3mi) {
    flagged.push(`hhi3mi-${site.hhi3mi}-below-target-${spec.minHHI3mi}`);
  }
  if (spec.needsInterstateAccess && breakdown.interstateAccess < 0.4) {
    flagged.push("interstate-access-thin");
  }
  if (spec.needsTruckStaging && breakdown.truckStaging < 0.5) {
    flagged.push("acreage-tight-for-truck-staging");
  }

  // Hard-fail zeros the score
  if (hardFails.length) score = 0;

  return { score, breakdown, flagged, hardFails };
}

/**
 * Rank a site against every buyer-spec. Returns an array sorted by score
 * descending, with the top fit at index 0.
 *
 * @param {object} site
 * @returns {Array<{ key, name, recipient, routeTo, score, breakdown, flagged, hardFails }>}
 */
export function rankBuyerFits(site) {
  const out = [];
  for (const key of BUYER_SPEC_ORDER) {
    const spec = BUYER_SPECS[key];
    if (!spec) continue;
    const result = scoreBuyerFit(site, spec);
    out.push({
      key,
      name: spec.name,
      recipient: spec.recipient,
      routeTo: spec.routeTo,
      isFallback: !!spec.isFallback,
      score: result.score,
      breakdown: result.breakdown,
      flagged: result.flagged,
      hardFails: result.hardFails,
    });
  }
  // Sort by score descending — but DEMOTE fallback specs (GENERIC) below
  // any non-fallback spec scoring VIABLE+ (>=5.5). This makes GENERIC the
  // last resort for sites no specific buyer would pursue, not the auto-
  // winner on ideal-fit sites just because its weights are uniform.
  const hasViableSpecific = out.some((r) => !r.isFallback && r.score >= 5.5);
  return out.sort((a, b) => {
    if (hasViableSpecific) {
      if (a.isFallback && !b.isFallback) return 1;
      if (!a.isFallback && b.isFallback) return -1;
    }
    return b.score - a.score;
  });
}

/**
 * Convenience — returns the single best-fit buyer for this site, or null
 * if every buyer hard-fails.
 *
 * @param {object} site
 * @returns {object|null}
 */
export function topBuyerFit(site) {
  const ranked = rankBuyerFits(site);
  if (!ranked.length || ranked[0].score === 0) return null;
  return ranked[0];
}

/**
 * Classifier — given a ranked list, classify each as STRONG / VIABLE /
 * MARGINAL / PASS so the UI can color-code the buyer-fit table.
 *
 * @param {number} score
 * @returns {"STRONG" | "VIABLE" | "MARGINAL" | "PASS"}
 */
export function classifyBuyerFit(score) {
  if (!Number.isFinite(score)) return "PASS";
  if (score >= 7.5) return "STRONG";
  if (score >= 5.5) return "VIABLE";
  if (score >= 3.5) return "MARGINAL";
  return "PASS";
}
