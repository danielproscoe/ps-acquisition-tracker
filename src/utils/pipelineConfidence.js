// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Confidence — Verification Status + Freshness Engine
//
// Closes a structural gap vs Radius Plus on construction-pipeline data:
// Radius+ surfaces pipeline entries with no verification status and no
// freshness marker — institutional users (DW screenshots Dan asking "is
// this real?") have learned that Radius+ data is often stale or
// fabricated. Storvex's answer: every pipeline facility carries a
// VERIFIED / CLAIMED / STALE / UNVERIFIED status derived from its source
// citation and last-verified timestamp.
//
// SYSTEM CLAIM (patent): Method for surfacing per-facility verification
// status on a self-storage construction-pipeline registry comprising:
// (1) classifying source citations into primary-source (REIT 10-K/10-Q
//     accession # · municipal permit # · planning commission record) vs
//     aggregator-only buckets;
// (2) computing freshness as the number of days since the entry was last
//     cross-confirmed against the cited primary source;
// (3) emitting a four-state confidence label (VERIFIED · CLAIMED · STALE
//     · UNVERIFIED) with an effective confidence weight 0.0-1.0;
// (4) rendering the label as a colored chip alongside each pipeline row
//     so institutional underwriters can distinguish primary-source-
//     verified supply from aggregator-claimed supply at a glance.
//
// DERIVATION ORDER (first match wins):
//   1. facility.verificationStatus explicit → use it (manual override)
//   2. facility.verifiedSource starts with "permit-" → VERIFIED (county permit)
//   3. facility.verifiedSource starts with "EDGAR-" → VERIFIED (REIT filing)
//   4. facility.verifiedSource starts with "planning-" → VERIFIED (planning commission)
//   5. facility.verifiedSource starts with "aggregator-" → CLAIMED
//   6. facility.verifiedSource starts with "screenshot-" → CLAIMED
//   7. facility.citation starts with "Accession " → VERIFIED (legacy REIT citation)
//   8. facility.source matches /10-[KQ]/ → VERIFIED (legacy text source mentioning REIT filing)
//   9. else → UNVERIFIED
//
// FRESHNESS — applied after status derivation:
//   - effectiveDate = facility.verifiedDate || file.generatedAt || registry.generatedAt
//   - daysSinceVerified = (asOf - effectiveDate) in days
//   - if (status === VERIFIED || CLAIMED) AND daysSinceVerified > defaultStaleDays
//     → flip status to STALE (preserve original under previousStatus)
//
// CONFIDENCE WEIGHTS (applied to the pipeline CC SF projection):
//   VERIFIED → 1.0
//   CLAIMED  → 0.5  (lower weight than VERIFIED · matches default "permitted" status confidence)
//   STALE    → 0.3  (still surface but discount heavily)
//   UNVERIFIED → 0.0 (don't count toward projection at all)
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_STALE_DAYS = 90;

const CHIP_STYLES = {
  VERIFIED: {
    color: "#16A34A", // green-600
    background: "rgba(22, 163, 74, 0.10)",
    border: "#16A34A40",
    icon: "✓",
    label: "VERIFIED",
  },
  CLAIMED: {
    color: "#D97706", // amber-600
    background: "rgba(217, 119, 6, 0.10)",
    border: "#D9770640",
    icon: "⚠",
    label: "CLAIMED",
  },
  STALE: {
    color: "#EA580C", // orange-600
    background: "rgba(234, 88, 12, 0.10)",
    border: "#EA580C40",
    icon: "↻",
    label: "STALE",
  },
  UNVERIFIED: {
    color: "#64748B", // slate-500
    background: "rgba(100, 116, 139, 0.10)",
    border: "#64748B40",
    icon: "○",
    label: "UNVERIFIED",
  },
};

const STATUS_CONFIDENCE_WEIGHT = {
  VERIFIED: 1.0,
  CLAIMED: 0.5,
  STALE: 0.3,
  UNVERIFIED: 0.0,
};

/**
 * Derive raw verification status BEFORE freshness check.
 */
function deriveRawStatus(facility) {
  if (!facility || typeof facility !== "object") return "UNVERIFIED";

  // 1. Explicit override
  if (facility.verificationStatus && CHIP_STYLES[facility.verificationStatus]) {
    return facility.verificationStatus;
  }

  const vs = String(facility.verifiedSource || "").toLowerCase();
  // 2-6. Prefix-based classification of explicit verifiedSource
  if (vs.startsWith("permit-")) return "VERIFIED";
  if (vs.startsWith("edgar-")) return "VERIFIED";
  if (vs.startsWith("planning-")) return "VERIFIED";
  if (vs.startsWith("aggregator-")) return "CLAIMED";
  if (vs.startsWith("screenshot-")) return "CLAIMED";

  // 7. Legacy citation field — REIT EDGAR accession # → VERIFIED
  if (typeof facility.citation === "string" && /^Accession\s+\d/i.test(facility.citation)) {
    return "VERIFIED";
  }

  // 8. Legacy source field mentioning a REIT filing → VERIFIED
  if (typeof facility.source === "string" && /\b10-[KQ]\b/i.test(facility.source)) {
    return "VERIFIED";
  }

  // 9. Default
  return "UNVERIFIED";
}

/**
 * Parse a date that could be ISO (2026-05-08), Y-Q (2026-Q2), or year ("2026").
 * Returns a Date or null.
 */
function parseFlexibleDate(input) {
  if (!input) return null;
  if (input instanceof Date) return isFinite(input.getTime()) ? input : null;
  const s = String(input).trim();
  // Y-Q form → start of quarter
  const yq = /^(\d{4})-Q([1-4])$/i.exec(s);
  if (yq) {
    const y = parseInt(yq[1], 10);
    const q = parseInt(yq[2], 10);
    const m = (q - 1) * 3;
    return new Date(Date.UTC(y, m, 1));
  }
  // ISO date
  const d = new Date(s);
  return isFinite(d.getTime()) ? d : null;
}

/**
 * Compute the pipeline confidence record for a single facility.
 *
 * @param {Object} facility - Single facility entry (from development-pipeline.json
 *   or submarketPipelineSupply.json facilities array). Required fields are flexible:
 *   any combo of citation, source, verifiedSource, verifiedDate, verificationStatus,
 *   staleAfterDate, verificationNotes works.
 * @param {Object} [opts]
 * @param {Date|string} [opts.asOf=new Date()] - Date to compute freshness against.
 * @param {Date|string} [opts.fileGeneratedAt] - Fall-back date if facility has no
 *   explicit verifiedDate (typically the parent file's generatedAt).
 * @param {number} [opts.defaultStaleDays=90] - Days after which a VERIFIED/CLAIMED
 *   entry flips to STALE if not re-verified.
 * @returns {{
 *   status: 'VERIFIED' | 'CLAIMED' | 'STALE' | 'UNVERIFIED',
 *   previousStatus: string | null,
 *   confidence: number,
 *   daysSinceVerified: number | null,
 *   isStale: boolean,
 *   verifiedDate: string | null,
 *   verifiedSource: string | null,
 *   verifierName: string | null,
 *   verificationNotes: string | null,
 *   chip: { text: string, color: string, background: string, border: string, icon: string, label: string },
 *   sourceCitation: string | null
 * }}
 */
export function computePipelineConfidence(facility, opts = {}) {
  const {
    asOf = new Date(),
    fileGeneratedAt = null,
    defaultStaleDays = DEFAULT_STALE_DAYS,
  } = opts;

  const asOfDate = parseFlexibleDate(asOf) || new Date();
  const rawStatus = deriveRawStatus(facility);
  let status = rawStatus;
  let previousStatus = null;

  // Resolve effective verification date
  const verifiedDate =
    parseFlexibleDate(facility?.verifiedDate) ||
    parseFlexibleDate(fileGeneratedAt) ||
    null;

  // Compute freshness
  let daysSinceVerified = null;
  if (verifiedDate) {
    const msPerDay = 86400 * 1000;
    daysSinceVerified = Math.max(0, Math.floor((asOfDate.getTime() - verifiedDate.getTime()) / msPerDay));
  }

  // Hard staleAfterDate override
  const staleAfter = parseFlexibleDate(facility?.staleAfterDate);
  const beyondStaleAfter = staleAfter && asOfDate.getTime() > staleAfter.getTime();

  // Auto-flip to STALE
  const wouldBeStale =
    (status === "VERIFIED" || status === "CLAIMED") &&
    ((daysSinceVerified != null && daysSinceVerified > defaultStaleDays) || beyondStaleAfter);

  if (wouldBeStale) {
    previousStatus = status;
    status = "STALE";
  }

  const style = CHIP_STYLES[status] || CHIP_STYLES.UNVERIFIED;

  // Build chip text — short, scannable, includes source detail when present
  const chipParts = [`${style.icon} ${style.label}`];
  if (facility?.verifiedSource) {
    chipParts.push(String(facility.verifiedSource));
  } else if (facility?.citation) {
    // Use truncated citation (e.g. "Accession 0001628280-26-007696" → "Accession 0001628280-26")
    const cit = String(facility.citation);
    const truncated = cit.length > 28 ? cit.slice(0, 28) + "…" : cit;
    chipParts.push(truncated);
  }
  if (daysSinceVerified != null) {
    chipParts.push(`${daysSinceVerified}d`);
  }

  return {
    status,
    previousStatus,
    confidence: STATUS_CONFIDENCE_WEIGHT[status] ?? 0,
    daysSinceVerified,
    isStale: status === "STALE",
    verifiedDate: verifiedDate ? verifiedDate.toISOString().slice(0, 10) : null,
    verifiedSource: facility?.verifiedSource || null,
    verifierName: facility?.verifierName || null,
    verificationNotes: facility?.verificationNotes || null,
    sourceCitation: facility?.citation || null,
    chip: {
      text: chipParts.join(" · "),
      color: style.color,
      background: style.background,
      border: style.border,
      icon: style.icon,
      label: style.label,
    },
  };
}

/**
 * Minimal HTML-escape — chip text can include user-sourced strings
 * (verifiedSource, citation) from future intake paths (DW screenshot ingestion,
 * permit-scraper output). Keep the chip render safe even if those strings
 * carry special characters.
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the confidence chip as inline HTML (for PDF reports + dashboard).
 * Returns a span tag with brand-aligned styling. Chip text is HTML-escaped
 * so the renderer is safe with externally-sourced citation strings.
 */
export function renderConfidenceChip(facility, opts = {}) {
  const conf = computePipelineConfidence(facility, opts);
  const c = conf.chip;
  return (
    `<span style="display:inline-block;padding:2px 8px;border-radius:4px;` +
    `background:${c.background};color:${c.color};border:1px solid ${c.border};` +
    `font-size:8.5pt;font-weight:600;letter-spacing:0.2px;line-height:1.3;` +
    `white-space:nowrap;">${escapeHtml(c.text)}</span>`
  );
}

/**
 * Bulk classify an array of facilities — useful for warehouse export and
 * dashboard aggregations.
 *
 * @returns {{
 *   counts: { VERIFIED: number, CLAIMED: number, STALE: number, UNVERIFIED: number },
 *   weightedTotalCCSF: number,
 *   rawTotalCCSF: number,
 *   facilities: Array<{ facility, confidence }>
 * }}
 */
export function aggregatePipelineConfidence(facilities, opts = {}) {
  if (!Array.isArray(facilities)) {
    return {
      counts: { VERIFIED: 0, CLAIMED: 0, STALE: 0, UNVERIFIED: 0 },
      weightedTotalCCSF: 0,
      rawTotalCCSF: 0,
      facilities: [],
    };
  }
  const counts = { VERIFIED: 0, CLAIMED: 0, STALE: 0, UNVERIFIED: 0 };
  let weightedTotalCCSF = 0;
  let rawTotalCCSF = 0;
  const enriched = facilities.map((f) => {
    const conf = computePipelineConfidence(f, opts);
    counts[conf.status] = (counts[conf.status] || 0) + 1;
    // CC SF = nrsf * (ccPct/100) when ccPct present; else nrsf or sf field
    const totalSF = Number(f?.nrsf || f?.sf || 0);
    const ccPct = f?.ccPct != null ? Number(f.ccPct) / 100 : 1;
    const ccSF = totalSF * ccPct;
    rawTotalCCSF += ccSF;
    weightedTotalCCSF += ccSF * conf.confidence;
    return { facility: f, confidence: conf };
  });
  return { counts, weightedTotalCCSF, rawTotalCCSF, facilities: enriched };
}

export const PIPELINE_CONFIDENCE_DEFAULT_STALE_DAYS = DEFAULT_STALE_DAYS;
export const PIPELINE_CONFIDENCE_CHIP_STYLES = CHIP_STYLES;
