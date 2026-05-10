// buyerDetection.js — auto-detect the natural buyer for an existing-stabilized
// storage deal from an OM extraction.
//
// When a user drops an OM PDF, the OM Engine extracts:
//   { name (property name + address), filename (uploaded file name),
//     listingBroker, state, city, dealType, ... }
//
// detectBuyer() scores each registered BUYER_LENS against those signals and
// returns the highest-scoring buyer. This auto-selects the dropdown to the
// most likely institutional buyer for the asset:
//
//   - "CubeSmart NNN @ Tallahassee FL" → CUBE (decisive brand match)
//   - "Public Storage Family @ Phoenix AZ" → PS
//   - "Extra Space Storage @ Long Beach CA" → EXR
//   - "U-Haul Centers @ Reno NV" → AMERCO (once lens shipped)
//   - "SmartStop Self Storage @ Tampa FL" → SMA
//   - Mom-and-pop independent brand + 3PM-managed broker → GENERIC
//
// The score is the sum of weighted signals. Highest signal wins; the score
// determines confidence (HIGH / MEDIUM / LOW). LOW confidence falls back to
// the registry default (PS_LENS) so unknowns route to the most-relevant lens.
//
// ALL signals are explicit + auditable — every detection returns the list
// of signals that contributed to the score, so the UI can render
// "AUTO-DETECTED · CUBE (high) · CubeSmart NNN brand match in property name".

import { DEFAULT_BUYER_KEY } from "./buyerLensProfiles";

// ─── Brand-name match patterns ──────────────────────────────────────────────
// Property name / filename patterns that decisively identify the buyer.
// Most weighted signal because a CubeSmart-branded asset is — by definition
// — only valuable at top dollar to CubeSmart (the brand owner). Same for
// PSA / EXR / SMA. AMERCO patterns reserved for Phase 2 (lens not yet shipped).
const BRAND_PATTERNS = [
  {
    buyer: "CUBE",
    patterns: [
      /\bcube\s*smart\b/i,
      /\bcubesmart\b/i,
      /\bcube\s+nnn\b/i,
      /\bcube[-_\s]+storage\b/i,
    ],
  },
  {
    buyer: "PS",
    patterns: [
      /\bpublic\s+storage\b/i,
      /\bps\s+nnn\b/i,
      /\bpsa\b/i,
      /\bps[-_\s]+storage\b/i,
    ],
  },
  {
    buyer: "EXR",
    patterns: [
      /\bextra\s+space\b/i,
      /\bextraspace\b/i,
      /\bexr\s+nnn\b/i,
      /\bexr[-_\s]+storage\b/i,
    ],
  },
  {
    buyer: "SMA",
    patterns: [
      /\bsmartstop\b/i,
      /\bsmart\s+stop\b/i,
      /\bsma\s+nnn\b/i,
      /\bstrategic\s+storage\b/i, // SMA's prior brand
    ],
  },
  {
    buyer: "AMERCO",
    patterns: [
      /\bu[-_\s]?haul\b/i,           // U-Haul / UHaul / U Haul
      /\buhaul\b/i,
      /\bamerco\b/i,
      /\bu[-_\s]?haul\s+center\b/i,  // U-Haul Center (their flagship format)
      /\bu[-_\s]?haul\s+self\s+storage\b/i,
    ],
  },
];

// ─── Listing-broker fingerprints ────────────────────────────────────────────
// Different broker firms specialize in different buyer types. Each broker
// pattern points to a likely buyer based on observed deal flow.
const BROKER_PATTERNS = [
  // Institutional brokers — typically PSA/EXR/CUBE/JLL Self-Storage/Cushman
  {
    buyers: ["PS", "EXR", "CUBE"], // institutional default → PS as primary
    primary: "PS",
    weight: 25,
    patterns: [
      /\bjll\s+self.storage\b/i,
      /\bjll[-_\s]+storage\b/i,
      /\bcushman.*self.storage\b/i,
      /\bcushman.*storage\b/i,
      /\bnewmark\s+self.storage\b/i,
      /\bnewmark[-_\s]+storage\b/i,
      /\beastdil\b/i,
      /\bcbre[-_\s]+self.storage\b/i,
      /\bcolliers\s+international\s+self.storage\b/i,
    ],
  },
  // Generic / 1031 / mom-and-pop brokers — mostly GENERIC (3PM-managed)
  {
    buyers: ["GENERIC"],
    primary: "GENERIC",
    weight: 20,
    patterns: [
      /\bmarcus.*millichap\b/i,
      /\bm\s*&\s*m\s+self.storage\b/i,
      /\bsvn\b/i,
      /\bsab\s+capital\b/i,
      /\bkarr.cunningham\b/i,
      /\bsperry\s+commercial\b/i,
    ],
  },
  // Mid-cap / regional brokers — can swing CUBE or SMA
  {
    buyers: ["CUBE", "SMA"],
    primary: "CUBE",
    weight: 15,
    patterns: [
      /\bbull\s+realty\b/i,
      /\bbandera\s+ventures\b/i,
      /\bargus\s+self.storage\b/i,
      /\bself.storage\s+plus\b/i,
    ],
  },
];

// ─── Geographic fingerprints ────────────────────────────────────────────────
// PSA discloses 24 MSAs in their 10-K MD&A — assets in those MSAs are
// natural PS-lens defaults. Cross-REIT footprints add nuance.
const PSA_DISCLOSED_MSA_CITIES = new Set([
  "los angeles", "san francisco", "new york", "washington", "miami",
  "seattle", "tacoma", "dallas", "fort worth", "houston", "chicago",
  "atlanta", "west palm beach", "orlando", "philadelphia", "baltimore",
  "san diego", "charlotte", "denver", "tampa", "phoenix", "detroit",
  "boston", "honolulu", "portland", "minneapolis", "saint paul",
  "sacramento", "austin",
]);

// CUBE has heaviest concentration in TX (269 fac), FL (205), NY (106), CA (91)
// per Storvex direct scrape (2026-05-10). When NOT in a PSA-disclosed MSA but
// in CUBE's heavy-footprint states, CUBE becomes the natural lens.
const CUBE_HEAVY_STATES = new Set(["TX", "FL", "NY", "CA", "IL", "AZ"]);

// SMA growth-stage profile — tertiary metros, value-add posture
const SMA_TYPICAL_DEAL_TYPES = new Set(["co-lu", "value-add"]);

// ─── Detection scoring ──────────────────────────────────────────────────────

/**
 * Detect the most-likely institutional buyer for a deal.
 *
 * @param {Object} input
 * @param {string} [input.name]           — property name + address
 * @param {string} [input.filename]       — uploaded file name (e.g. "tallahassee_OM.pdf")
 * @param {string} [input.listingBroker]  — listing broker name + firm
 * @param {string} [input.state]          — 2-letter state code
 * @param {string} [input.city]           — city name (extracted from address)
 * @param {string} [input.dealType]       — "stabilized" | "co-lu" | "value-add" | "nnn"
 * @param {string} [input.msaTier]        — "top30" | "secondary" | "tertiary"
 *
 * @returns {Object} {
 *   buyerKey: "PS" | "EXR" | "CUBE" | "SMA" | "GENERIC",
 *   confidence: "HIGH" | "MEDIUM" | "LOW",
 *   topScore: number,
 *   scores: { PS, EXR, CUBE, SMA, GENERIC },
 *   signals: [ { signal, buyer, weight, evidence } ],
 *   defaulted: boolean   // true when low confidence falls back to default
 * }
 */
export function detectBuyer(input = {}) {
  const scores = { PS: 0, EXR: 0, CUBE: 0, SMA: 0, GENERIC: 0 };
  const signals = [];

  const name = String(input.name || "").trim();
  const filename = String(input.filename || "").trim();
  const broker = String(input.listingBroker || "").trim();
  const state = String(input.state || "").toUpperCase().trim();
  const city = String(input.city || "").toLowerCase().trim();
  const dealType = String(input.dealType || "").toLowerCase().trim();

  // ── Signal 1: brand-name match in property name (decisive: +100) ──
  for (const { buyer, patterns } of BRAND_PATTERNS) {
    for (const pattern of patterns) {
      if (name && pattern.test(name)) {
        scores[buyer] = (scores[buyer] || 0) + 100;
        signals.push({
          signal: "BRAND_NAME_MATCH",
          buyer,
          weight: 100,
          evidence: `Property name "${name}" matches ${buyer} brand pattern (${pattern.source})`,
        });
        break;
      }
    }
  }

  // ── Signal 2: brand-name match in filename (strong: +50) ──
  // Normalize underscores + hyphens to spaces so `\b` boundaries fire on
  // common filename separators (e.g. "cubesmart_tallahassee_OM.pdf" → matches
  // `\bcubesmart\b`).
  const filenameNormalized = filename.replace(/[_-]/g, " ");
  for (const { buyer, patterns } of BRAND_PATTERNS) {
    for (const pattern of patterns) {
      if (filename && pattern.test(filenameNormalized)) {
        scores[buyer] = (scores[buyer] || 0) + 50;
        signals.push({
          signal: "FILENAME_BRAND_MATCH",
          buyer,
          weight: 50,
          evidence: `Filename "${filename}" matches ${buyer} brand pattern`,
        });
        break;
      }
    }
  }

  // ── Signal 3: listing-broker fingerprint (medium: +15-25) ──
  if (broker) {
    for (const { primary, weight, patterns } of BROKER_PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(broker)) {
          scores[primary] = (scores[primary] || 0) + weight;
          signals.push({
            signal: "BROKER_FINGERPRINT",
            buyer: primary,
            weight,
            evidence: `Listing broker "${broker}" matches ${primary} typical broker (${pattern.source})`,
          });
          break;
        }
      }
    }
  }

  // ── Signal 4: PSA-disclosed MSA → +10 to PS ──
  if (city && PSA_DISCLOSED_MSA_CITIES.has(city)) {
    scores.PS = (scores.PS || 0) + 10;
    signals.push({
      signal: "PSA_DISCLOSED_MSA",
      buyer: "PS",
      weight: 10,
      evidence: `City "${city}" is in PSA's 24-MSA same-store disclosure (10-K MD&A)`,
    });
  }

  // ── Signal 5: CUBE heavy state → +8 to CUBE ──
  // Only fires when there's no decisive brand match yet (CUBE is the
  // natural fallback in TX/FL/NY where CUBE has 700+ facilities scraped).
  const hasBrandMatch = signals.some((s) => s.signal === "BRAND_NAME_MATCH" || s.signal === "FILENAME_BRAND_MATCH");
  if (!hasBrandMatch && state && CUBE_HEAVY_STATES.has(state)) {
    scores.CUBE = (scores.CUBE || 0) + 8;
    signals.push({
      signal: "CUBE_HEAVY_STATE",
      buyer: "CUBE",
      weight: 8,
      evidence: `State "${state}" is in CUBE's heavy-footprint states (TX/FL/NY/CA/IL/AZ — 700+ facilities)`,
    });
  }

  // ── Signal 6: SMA growth-stage profile (deal type heuristic) ──
  if (!hasBrandMatch && dealType && SMA_TYPICAL_DEAL_TYPES.has(dealType)) {
    scores.SMA = (scores.SMA || 0) + 5;
    signals.push({
      signal: "GROWTH_STAGE_DEAL_TYPE",
      buyer: "SMA",
      weight: 5,
      evidence: `Deal type "${dealType}" matches SMA's growth-stage acquisition profile`,
    });
  }

  // ── Signal 7: NNN deal type pulls toward the tenant-branded buyer ──
  // If we already detected a brand from the name, NNN reinforces it.
  // (NNN deals are typically credit-leased to the named tenant — only that
  // tenant pays top dollar for their own lease.)
  if (dealType === "nnn" && hasBrandMatch) {
    const brandSignal = signals.find((s) => s.signal === "BRAND_NAME_MATCH");
    if (brandSignal) {
      scores[brandSignal.buyer] = (scores[brandSignal.buyer] || 0) + 25;
      signals.push({
        signal: "NNN_REINFORCES_BRAND",
        buyer: brandSignal.buyer,
        weight: 25,
        evidence: `NNN deal type reinforces ${brandSignal.buyer} brand match (NNN credit lease implies tenant-buyer)`,
      });
    }
  }

  // ── Pick winner ──
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topKey, topScore] = ranked[0];
  const [, secondScore] = ranked[1] || [null, 0];

  // Confidence tiers — score gating with a margin requirement so a tied
  // score (e.g. PS=15, EXR=15) doesn't confidently pick one over the other.
  const margin = topScore - (secondScore || 0);
  let confidence;
  let buyerKey = topKey;
  let defaulted = false;

  if (topScore >= 100) {
    confidence = "HIGH"; // brand match is decisive
  } else if (topScore >= 50 && margin >= 20) {
    confidence = "HIGH"; // strong filename match + clear margin
  } else if (topScore >= 25 && margin >= 10) {
    confidence = "MEDIUM";
  } else if (topScore >= 10 && margin >= 5) {
    confidence = "LOW";
  } else {
    // No strong signal — fall back to registry default
    confidence = "LOW";
    buyerKey = DEFAULT_BUYER_KEY;
    defaulted = true;
    signals.push({
      signal: "DEFAULT_FALLBACK",
      buyer: DEFAULT_BUYER_KEY,
      weight: 0,
      evidence: `No decisive signals detected (top score ${topScore}); falling back to default lens (${DEFAULT_BUYER_KEY})`,
    });
  }

  return {
    buyerKey,
    confidence,
    topScore,
    scores,
    signals,
    defaulted,
  };
}

/**
 * Render a one-line human-readable badge label for the auto-detect result.
 * Used by the UI badge near the buyer dropdown.
 *
 * @param {Object} detection — output of detectBuyer()
 * @returns {string}
 */
export function formatDetectionBadge(detection) {
  if (!detection) return "";
  if (detection.defaulted) {
    return `Default lens (${detection.buyerKey}) — no decisive signals detected`;
  }
  // Prefer the highest-weight contributing signal as the human reason
  const winningSignals = (detection.signals || [])
    .filter((s) => s.buyer === detection.buyerKey && s.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const reason = winningSignals[0]?.evidence || "Multiple signals";
  return `${detection.buyerKey} (${detection.confidence}) — ${reason}`;
}
