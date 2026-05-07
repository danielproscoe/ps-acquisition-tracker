// buyerLensProfiles.js — Per-buyer underwriting profiles for the Asset Analyzer.
//
// Encodes how each institutional buyer underwrites a stabilized facility.
// Asset Analyzer's "PS Lens" / "AMERCO Lens" / etc. cards re-run the same
// math via analyzeExistingAsset() with these profile overrides applied.
//
// Add a new buyer = add a profile here. No analyzer refactor needed.
//
// All constants traceable to public sources:
//   - PSA / EXR / CUBE / NSA FY2025 10-K disclosures
//   - U-Haul Holding (UHAL) FY2025 10-K (AMERCO succeeded by UHAL post-2022 reorg)
//   - Green Street Self-Storage Sector Reports
//   - Cushman & Wakefield Self-Storage Market Reports
//   - SSA Global operator benchmarks

import { analyzeExistingAsset } from "./existingAssetAnalysis";

// ══════════════════════════════════════════════════════════════════════════
// PUBLIC STORAGE (PSA) — flagship lens (ships first, presented to Reza)
// ══════════════════════════════════════════════════════════════════════════
//
// PSA's underwriting differs from a generic institutional buyer in 5 ways:
//
//   1. SELF-MANAGED — no third-party 5.5% mgmt fee on EGI
//   2. CENTRAL OPERATIONS — payroll, marketing, G&A all run lighter than
//      independents because of national scale + tech stack
//   3. BRAND PREMIUM — discloses 5-15% rate premium vs comp set in market
//      revenue management; midpoint 10% applied to EGI
//   4. TIGHTER ACQUISITION CAPS — FY2025 10-K acquisition activity disclosed
//      caps at 5.0-5.6% range vs 5.6-6.4% market
//   5. PORTFOLIO-FIT — sites within district network (5-mi of existing PS
//      family facility) earn cross-marketing premium worth ~25 bps cap

export const PS_LENS = {
  key: "PS",
  name: "Public Storage",
  ticker: "PSA",
  description:
    "Self-managed national REIT. Tightest cap, lightest opex, brand street-rate premium. Acquires Class A stabilized + select CO-LU + portfolio buys (NSA acquisition closed FY2025).",

  // ── Opex line overrides (vs generic EXPENSE_BENCHMARKS midpoints) ────
  // Numbers below are PSA-specific institutional benchmarks anchored to
  // FY2025 10-K opex disclosures (G&A as % of revenue, payroll efficiency
  // post-PSA tech stack rollout).
  expenseOverrides: {
    payrollPerSF_manned: 0.65,   // central regional staffing model vs $1.00 generic
    payrollPerSF_unmanned: 0,    // PS has very few unmanned facilities
    marketingPerSF: 0.18,        // national brand reduces per-store ad spend ~45%
    gaPerSF: 0.04,               // central G&A vs $0.075 third-party
    mgmtFeePctEGI: 0,            // self-managed — no 5.5% third-party fee
    reservesPerSF: 0.15,         // similar to generic (10-K disclosed)
    // Insurance, utilities, R&M, CC charges = same as generic
  },

  // ── Revenue adjustment ────────────────────────────────────────────────
  // PSA's 10-K discloses 5-15% rate premium vs comp set on stabilized
  // assets due to brand + tech stack (revenue management). Midpoint 10%.
  revenueAdjustment: 1.10,

  // ── Acquisition cap rate by MSA tier ──────────────────────────────────
  // Reflects FY2025 PSA acquisition activity per 10-K. Tighter than
  // generic STORAGE.ACQ_CAP (5.6%) because of cost-of-capital advantage.
  capByMSATier: {
    top30: 0.0500,
    secondary: 0.0540,
    tertiary: 0.0560,
  },

  // ── Portfolio-fit bonus ───────────────────────────────────────────────
  // If subject site is within 5 mi of an existing PS family facility
  // (PS + iStorage + NSA per memory CLAUDE.md §6b), apply -25 bps to cap.
  // This captures cross-marketing + customer overflow value.
  portfolioFitBonus: {
    triggerWithinMiles: 5,
    capReductionBps: 25,
  },

  // ── Hard gates (NOT applied yet — informational for now) ──────────────
  hardGates: {
    minNRSF: 50000,
    maxDistanceToPSFamilyMiles: 35,
  },

  // ── Display ───────────────────────────────────────────────────────────
  brandColor: "#1E40AF", // PS blue
  badgeText: "PS LENS",
};

// ══════════════════════════════════════════════════════════════════════════
// REGISTRY — all buyer lenses
// Add new lenses here. Display order = sort order on the analyzer card.
// ══════════════════════════════════════════════════════════════════════════

export const BUYER_LENSES = {
  PS: PS_LENS,
  // AMERCO: AMERCO_LENS,   // Phase 2
  // EXR: EXR_LENS,
  // CUBE: CUBE_LENS,
  // NSA: NSA_LENS,
  // SROA: SROA_LENS,
};

// ══════════════════════════════════════════════════════════════════════════
// COMPUTE LENS — runs full Asset Analyzer pipeline against a buyer profile
// Returns the same shape as analyzeExistingAsset() so the UI can render
// generic buyer-lens and PS-lens side-by-side without special-casing.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Get the effective acquisition cap for a buyer lens given an MSA tier and
 * optional portfolio-fit signal (e.g. nearestPSFamilyMiles from siteiqData).
 *
 * @param {Object} lens             — a profile from BUYER_LENSES
 * @param {string} msaTier          — "top30" | "secondary" | "tertiary"
 * @param {number|null} nearestMi   — distance to nearest portfolio facility
 * @returns {{cap: number, portfolioFit: boolean, basis: string}}
 */
export function computeLensMarketCap(lens, msaTier, nearestMi = null) {
  const baseCap = (lens.capByMSATier && lens.capByMSATier[msaTier]) || 0.056;
  const fitTrigger = lens.portfolioFitBonus?.triggerWithinMiles;
  const fitBps = lens.portfolioFitBonus?.capReductionBps || 0;
  const portfolioFit =
    fitTrigger != null && nearestMi != null && nearestMi <= fitTrigger;
  const cap = portfolioFit ? baseCap - fitBps / 10000 : baseCap;
  const basis = portfolioFit
    ? `${lens.key} ${msaTier} cap (${(baseCap * 100).toFixed(2)}%) − ${fitBps} bps portfolio-fit (within ${fitTrigger} mi of ${lens.key} family facility)`
    : `${lens.key} ${msaTier} cap (${(baseCap * 100).toFixed(2)}%)`;
  return { cap, portfolioFit, basis, baseCap, fitBps };
}

/**
 * Run the full Asset Analyzer pipeline through a buyer lens.
 *
 * @param {Object} input              — same input shape as analyzeExistingAsset()
 * @param {Object} lens               — a profile from BUYER_LENSES (default PS_LENS)
 * @param {Object} [extra]
 * @param {number} [extra.nearestPortfolioMi]  — distance to nearest buyer family facility
 * @returns {Object} analysis result — same shape as analyzeExistingAsset() plus lens metadata
 */
export function computeBuyerLens(input, lens = PS_LENS, extra = {}) {
  const msaTier = input.msaTier || "secondary";
  const fit = computeLensMarketCap(lens, msaTier, extra.nearestPortfolioMi);

  const analysis = analyzeExistingAsset(input, {
    expenseOverrides: lens.expenseOverrides || null,
    revenueAdjustment: lens.revenueAdjustment || 1.0,
    customMarketCap: fit.cap,
  });

  return {
    ...analysis,
    lens: {
      key: lens.key,
      name: lens.name,
      ticker: lens.ticker,
      description: lens.description,
      brandColor: lens.brandColor,
      badgeText: lens.badgeText,
      capBasis: fit.basis,
      portfolioFit: fit.portfolioFit,
      baseCap: fit.baseCap,
      revenuePremium: ((lens.revenueAdjustment || 1.0) - 1.0),
    },
  };
}
