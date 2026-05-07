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
// PUBLIC STORAGE (PSA) — flagship lens
//
// All constants traceable to primary sources. See full citation block at
// docs/PS_UNDERWRITING_MODEL.md. Updated 2026-05-07 with PSA FY2025 10-K data.
//
// PSA's underwriting differs from a generic institutional buyer in 5 ways:
//
//   1. SELF-MANAGED — no third-party mgmt fee. PSA does NOT pay 5.5% of EGI
//      to a third-party manager because the operating company IS PSA.
//
//   2. PLATFORM EFFICIENCY — PSA same-store opex 24.86% of revenue (FY2025
//      10-K), vs ~28-29% for EXR/CUBE and 32-35% for independents. Driver:
//      central regional staffing (payroll just 3.43% of revenue vs 6%+ at
//      EXR/CUBE) + brand-efficient marketing (2.21% vs 4-6% independents).
//
//   3. BRAND PREMIUM — PSA street rates trade ~10-15% above comp set
//      (Move.org consumer pricing analysis; PSA does not directly disclose).
//      Model uses 12% midpoint as revenue lift on subject EGI.
//
//   4. PSNext UPLIFT — PSA buys at MARKET cap (~5.5-6.0% stabilized Class A)
//      then drives stabilized cap to 6.0-6.75% post-integration via revenue
//      management + cost rationalization. Q1 2026 mgmt: "stabilized product
//      is trading in the 5s, getting into the 6s as we put them on our
//      platform." Translation: PSA's UNDERWRITTEN cap (what they SOLVE for)
//      is HIGHER than market cap. Model encodes the underwritten cap.
//
//   5. PORTFOLIO-FIT — sites within district network (5 mi of existing PS
//      family facility = PS + iStorage + NSA per CLAUDE.md §6b) get -25 bps
//      cap for cross-marketing + customer overflow value.

export const PS_LENS = {
  key: "PS",
  name: "Public Storage",
  ticker: "PSA",
  description:
    "Self-managed national REIT. FY2025: 3,171 facilities / 229M NRSF / 40 states. NSA acquisition pending Q3 2026 close ($10.5B / 1,000+ properties). Acquires Class A stabilized at market cap, drives 50-100 bps yield uplift via PSNext platform integration. 75% off-market sourcing.",

  // ── Opex overrides — PSA FY2025 10-K same-store ratios ──────────────────
  // Source: PSA Q4/FY2025 Press Release (BusinessWire 2/12/2026)
  //   https://www.businesswire.com/news/home/20260212066179/en/
  //
  // Same-store pool: 2,565 properties / 175.3M NRSF
  // Same-store revenue: $3,764,833K
  // Total opex: $935,918K = 24.86% of revenue (NOI margin 75.14%)
  //
  // The %-of-revenue mode (pctRev fields) is required to apply PSA's
  // ratios correctly to subject deals at any rent level. $/SF benchmarks
  // calibrated to PSA portfolio rents ($21.48/SF revenue) would overstate
  // opex on lower-rent assets (RV mega, drive-up heavy).
  expenseOverrides: {
    // Property tax: PSA national portfolio average = 10.05% of revenue.
    // For PURCHASE deals in reassessment states (TX/CA/FL/etc.), the
    // STATE_TAX_MATRIX overrides this with state-specific rates anchored
    // to the SALE price, not portfolio average.
    propertyTaxPctRev: 0.1005,

    // PSA's "Insurance + CC + Reserves + Misc" lumped as "Other direct" 2.71%.
    // EXR/CUBE breakdowns suggest split: Insurance ~1.2%, CC ~0.8%, Reserves ~0.7%
    insurancePctRev: 0.012,    // EXR/CUBE 1.2%
    ccChargesPctEGI: 0.0080,   // override generic 2.25% with PSA-style 0.8%
    reservesPctRev: 0.007,     // EXR/CUBE imputed share

    // Direct disclosed line items
    payrollPctRev: 0.0343,     // FY2025 10-K — central regional staffing
    rmPctRev: 0.0207,          // FY2025 10-K — repairs & maintenance
    utilitiesPctRev: 0.0132,   // FY2025 10-K — utilities (low for storage)
    marketingPctRev: 0.0221,   // FY2025 10-K — brand-efficient
    gaPctRev: 0.0307,          // FY2025 10-K — indirect cost of operations (central G&A)

    // Self-managed — no third-party fee
    mgmtFeePctEGI: 0,
  },

  // ── Revenue adjustment ────────────────────────────────────────────────
  // PSA brand premium vs comp set: 10-15% range (Move.org consumer pricing
  // analysis). Midpoint 12% applied as revenue lift on subject EGI.
  // Flagged in IC memo as "third-party-derived, PSA does not directly
  // disclose."
  revenueAdjustment: 1.12,

  // ── Acquisition cap rate by MSA tier ──────────────────────────────────
  // Source: triangulated from PSA Q4 2025 disclosure ("high 6% range"
  // FY2025 average), Q1 2026 transcript ("trading in 5s, getting into 6s
  // as we put them on our platform"), Newmark 2025 Almanac, Cushman 2025
  // Self-Storage Trends.
  //
  // These are PSA UNDERWRITTEN caps (stabilized post-PSNext uplift), NOT
  // market going-in caps. The difference (50-100 bps) IS the platform-fit
  // moat captured by the model.
  capByMSATier: {
    top30: 0.0600,        // PSA Class A primary stabilized
    secondary: 0.0625,    // PSA Class A secondary (rank 31-125)
    tertiary: 0.0700,     // PSA Class A tertiary (rank 126+; post-NSA expanded)
  },

  // ── Portfolio-fit bonus ───────────────────────────────────────────────
  // Within 5 mi of PS family (PS + iStorage + NSA per CLAUDE.md §6b) = -25 bps cap.
  // Captures cross-marketing + customer overflow + district density advantage
  // (PSA Q4 2025 mgmt: "critical density produces ~600 bps margin advantage").
  portfolioFitBonus: {
    triggerWithinMiles: 5,
    capReductionBps: 25,
  },

  // ── Hard gates ────────────────────────────────────────────────────────
  // PSA does NOT publicly disclose minimum NRSF / acreage. Numbers below
  // are observed from FY2025 acquisition activity ($154/SF avg; 87
  // facilities / 6.1M NRSF = 70K NRSF average).
  hardGates: {
    minNRSF: 50000,                  // observed floor
    avgNRSF: 70000,                  // FY2025 acquisition math
    minOneStoryAcres: 2.5,
    maxOneStoryAcres: 6,
    minMultiStoryAcres: 1.5,
    maxMultiStoryAcres: 3,
    maxDistanceToPSFamilyMiles: 35,  // out-of-district = excluded
  },

  // ── Reference — PSA FY2025 portfolio benchmarks (for IC memo context) ──
  benchmarks: {
    sameStoreNOIMargin: 0.7514,        // FY2025 best-in-class
    sameStoreOpexPctRev: 0.2486,
    avgOccupancy: 0.920,
    yeOccupancy: 0.910,
    realizedRentPerOccSF: 22.54,
    fy2025BlendedAcqCap: 0.0675,        // disclosed "high 6% range"
    fy2025AcqPricePSF: 154,
    underwritingFunnelConversion: 0.14, // $1B / $7B = 14%
    offMarketShare: 0.75,                // Q1 2026
    devYOCTarget: 0.08,
    devCostPSF: 195,                     // FY2025 deliveries blended
    industryECRI: 0.08,                  // industry midpoint; not PSA-disclosed
  },

  // ── Display ───────────────────────────────────────────────────────────
  brandColor: "#1E40AF", // PS blue
  badgeText: "PSA UNDERWRITE",
  citationFootnote: "Sources: PSA FY2025 10-K (filed Feb 2026), PSA Q4 2025 + Q1 2026 earnings transcripts, NSA acquisition press release (Mar 2026), Newmark 2025 Self-Storage Almanac, Cushman & Wakefield H1 2025 Trends. Full pack: docs/PS_UNDERWRITING_MODEL.md.",
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
