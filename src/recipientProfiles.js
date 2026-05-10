// recipientProfiles.js — Pitch-mode recipient registry for Storvex.
//
// Each recipient is a known institutional contact who Storvex pitches deals to.
// Selecting a recipient in the dashboard's "Pitch to..." dropdown:
//   1. Auto-applies their default underwriting lens (Reza → PS, Aaron → AMERCO,
//      Jennifer → AMERCO).
//   2. Brands the Goldman PDF cover page for them (recipient name + role +
//      firm + personalized greeting paragraph).
//   3. Surfaces in the warehouse JSON export (`pitch_target` block) so any
//      downstream consumer knows which institutional buyer this analysis was
//      tailored for.
//
// Add a new recipient = add a profile here. No analyzer refactor needed.

import { DEFAULT_BUYER_KEY } from "./buyerLensProfiles";

// ══════════════════════════════════════════════════════════════════════════
// RECIPIENT PROFILES
// ══════════════════════════════════════════════════════════════════════════

export const REZA_MAHDAVIAN = {
  key: "reza",
  recipientName: "Reza Mahdavian",
  role: "VP Finance + Real Estate Applications",
  firm: "Public Storage",
  defaultLens: "PS",
  // Personalized greeting paragraph rendered on the PDF cover. Tailored to
  // Reza's role (Finance + RE Apps) + Storvex's pitch frame (institutional
  // self-managed underwriting depth, primary-source-cited).
  greeting:
    "Reza — recommending this asset for PSA review through the institutional self-managed lens. Underwriting cites PSA's FY2025 10-K MD&A line items directly: same-store opex 24.86% of revenue, NOI margin 75.14%, MSA-disclosed in-place rent where applicable, and PSNext's +50 bps stabilized cap uplift. Cross-buyer comparison (PSA vs EXR vs CUBE vs SMA vs UHAL vs GENERIC) shows the platform-fit Δ in dollars on this asset — the dollar value PSA defensibly pays above a generic third-party-managed buyer on the identical asset.",
};

export const AARON_LIKEN = {
  key: "aaron",
  recipientName: "Aaron Liken",
  role: "Head of Real Estate Acquisitions",
  firm: "U-Haul Holding (UHAL)",
  defaultLens: "AMERCO",
  greeting:
    "Aaron — recommending this asset through the U-Haul truck-rental-cross-subsidized lens. Underwriting cites UHAL FY2025 10-K Self-Storage segment economics: storage opex ratio 21% (vs PSA 24.86%, EXR 28.84%, CUBE 28.91%) due to truck-side absorption of land tax, payroll, marketing. Stabilized NOI margin 79% (highest in registry). Within-2-mi Center adjacency triggers −50 bps cap reduction (double PSA's bonus). Cross-buyer comparison shows where UHAL's cross-subsidy advantage prices into the deal — UHAL's effective takedown $ vs every other major institutional buyer on the same asset.",
};

export const JENNIFER_SETTLES = {
  key: "jennifer",
  recipientName: "Jennifer Settles",
  role: "Director of Self-Storage Acquisitions",
  firm: "U-Haul Holding (UHAL)",
  defaultLens: "AMERCO",
  greeting:
    "Jennifer — recommending this asset through the U-Haul truck-rental-cross-subsidized lens. Storage rides on UHAL's 2,200+ Center footprint where truck rental absorbs land + staff + marketing costs. Same-store NOI margin 79% per UHAL's FY2025 10-K segment disclosure. Within-2-mi adjacency cap reduction −50 bps reflects the dual-business value of truck + storage on the same lot. Cross-buyer comparison shows UHAL's takedown $ vs PSA / EXR / CUBE / SMA / GENERIC on the same asset.",
};

// Custom recipient — when the analyst picks a one-off contact not in the
// registry. Lens stays at whatever the dropdown is set to.
export const CUSTOM_RECIPIENT = {
  key: "custom",
  recipientName: null,
  role: null,
  firm: null,
  defaultLens: null,
  greeting:
    "Recommending this asset for institutional review. Underwriting traces every constant to a specific FY2025 10-K accession # on sec.gov; cross-buyer comparison shows how each major institutional storage buyer (PSA / EXR / CUBE / SMA / UHAL / GENERIC) prices this asset at their own underwriting hurdle.",
};

// ══════════════════════════════════════════════════════════════════════════
// REGISTRY + ACCESSORS
// ══════════════════════════════════════════════════════════════════════════

export const RECIPIENTS = {
  reza: REZA_MAHDAVIAN,
  aaron: AARON_LIKEN,
  jennifer: JENNIFER_SETTLES,
  custom: CUSTOM_RECIPIENT,
};

// Display order for UI dropdown
export const RECIPIENT_ORDER = ["reza", "aaron", "jennifer", "custom"];

/**
 * Look up a recipient profile by key. Returns null for unknown keys.
 * @param {string} key
 */
export function getRecipient(key) {
  if (!key) return null;
  return RECIPIENTS[String(key).toLowerCase()] || null;
}

/**
 * Render dropdown options derived from RECIPIENT_ORDER. Each option's label
 * is the recipient's first name + role at firm so the dropdown reads as
 * "Reza Mahdavian — VP Finance + RE Apps · Public Storage".
 */
export const RECIPIENT_OPTIONS = RECIPIENT_ORDER.map((k) => {
  const r = RECIPIENTS[k];
  if (!r) return { key: k, label: k };
  if (k === "custom") return { key: k, label: "— Custom recipient (manual)" };
  return {
    key: k,
    label: `${r.recipientName} — ${r.role} · ${r.firm}`,
  };
});

/**
 * Resolve the lens key that the selected recipient should auto-apply.
 * Custom + unknown recipients fall back to the registry default (PS).
 *
 * @param {string} recipientKey
 * @returns {string} lens key from BUYER_LENSES
 */
export function resolveRecipientLens(recipientKey) {
  const r = getRecipient(recipientKey);
  return r?.defaultLens || DEFAULT_BUYER_KEY;
}
