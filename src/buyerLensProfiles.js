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
  // INTERNAL identifiers — used in code lookup, not shown to end users.
  // Display fields below are deliberately neutral institutional language so
  // the user-visible surface doesn't reference any specific REIT by name
  // (REIT-level disclosure discipline). Underlying constants stay pinned to
  // FY2025 10-K data — full citations in docs/PS_UNDERWRITING_MODEL.md.
  key: "PS",
  name: "Institutional Self-Managed REIT",
  ticker: "INST",
  description:
    "Self-managed national operator profile. Calibrated to FY2025 institutional REIT same-store opex (24.86% of revenue / 75.14% NOI margin) and disclosed acquisition activity. Buys at market cap, drives 50-100 bps yield uplift via platform integration (revenue management + cost rationalization on rolled tenants). Self-managed — no third-party mgmt fee.",

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
  // NOTE: badge + display fields are deliberately neutral. Internal
  // constants are pinned to FY2025 institutional REIT 10-K disclosures;
  // citations in docs/UNDERWRITING_MODEL.md.
  brandColor: "#3B82F6",
  badgeText: "STORVEX UNDERWRITE",
  citationFootnote: "Constants calibrated to FY2025 institutional REIT 10-K disclosures (same-store opex ratios, acquisition cap rates, brand-premium street rate dynamics) plus Newmark 2025 Self-Storage Almanac, Cushman & Wakefield H1 2025 Trends, Green Street Q1 2026 Sector. Internal source pack: docs/PS_UNDERWRITING_MODEL.md (dev only).",
};

// ══════════════════════════════════════════════════════════════════════════
// EXTRA SPACE STORAGE (EXR) — second-largest public storage REIT
//
// FY2025 10-K Annual Report — accession 0001289490-26-000011 (filed 2026-02).
// Same-store cohort: 2,084 stabilized wholly-owned facilities.
//
// EXR underwriting differs from PSA in 4 ways:
//
//   1. JOINT-VENTURE MODEL — EXR's portfolio is heavily JV-managed (3rd-party
//      managed facilities ~40% of total). Same-store ratios reflect wholly-
//      owned + bridge-managed portfolio. EXR 3PM line of business adds
//      revenue WITHOUT consuming acquisition capital (negotiated takeouts).
//
//   2. THINNER MARGINS — EXR same-store NOI margin ~71.2% (vs PSA 75.14%).
//      Driver: higher field labor cost (~6.2% of revenue vs PSA 3.4%) and
//      higher marketing spend (2.4% vs PSA 2.2%). EXR pays for breadth.
//
//   3. ECRI-DISCLOSED — EXR is the ONLY REIT publishing the in-place vs
//      move-in spread directly: in-place $19.91/SF/yr vs move-in $13.16 =
//      +51.3% ECRI premium. This is the rent-raising headroom signal.
//
//   4. NO PLATFORM UPLIFT — unlike PSA's PSNext, EXR doesn't have a
//      branded post-acquisition repricing program. Acquisitions buy at
//      market cap, hold at market cap (revenue management is continuous,
//      not a step-function).

export const EXR_LENS = {
  key: "EXR",
  name: "Self-Managed Coastal-Concentrated REIT",
  ticker: "EXR",
  description:
    "Second-largest public storage REIT — heavy 3rd-party-managed portfolio (~40%) + JV expansion model. Same-store NOI margin 71.2% (vs PSA 75.14%) due to higher field labor + marketing spend. ECRI-disclosed: in-place rent +51.3% above move-in. No PSNext-equivalent platform uplift — acquisitions buy at market cap, hold at market cap.",

  // ── Opex overrides — EXR FY2025 10-K MD&A same-store ratios ─────────────
  // Source: EXR FY2025 10-K MD&A — 0001289490-26-000011
  // Same-store revenue: $2,648,814K · NOI: $1,884,797K · Opex: $764,017K (28.84%)
  // Disclosed line items (FY2025 vs FY2024):
  //   Payroll & benefits: $164,241K (6.20% of rev) — significantly higher than PSA's 3.43%
  //   Marketing: $63,166K (2.38% — vs PSA 2.21%)
  //   Office expense: $80,381K (3.04%)
  //   Property operating: $69,649K (2.63%)
  //   Repairs & maintenance: ~$70K (2.64% est — line truncated in extraction)
  expenseOverrides: {
    propertyTaxPctRev: 0.105,           // coastal weight (CA/NY/FL)
    insurancePctRev: 0.014,              // higher than PSA — coastal exposure
    ccChargesPctEGI: 0.012,              // EXR runs more aggressive CC programs
    reservesPctRev: 0.008,
    payrollPctRev: 0.062,                // FY2025 10-K disclosed
    rmPctRev: 0.026,                     // FY2025 10-K disclosed (est)
    utilitiesPctRev: 0.018,              // higher than PSA — coastal HVAC load
    marketingPctRev: 0.024,              // FY2025 10-K disclosed
    gaPctRev: 0.030,
    mgmtFeePctEGI: 0,                    // self-managed
  },

  // EXR brand premium — Move.org / Storage Almanac suggests 4-6% above
  // independents. Lower than PSA's 12% (less ECRI execution; broader
  // portfolio dilutes the premium).
  revenueAdjustment: 1.05,

  // EXR FY2025 acquisition activity averaged 6.5-7.0% caps (Newmark 2025
  // Self-Storage Almanac + EXR Q4 FY2025 earnings transcript). EXR pays a
  // tier above PSA on tertiary because their JV-managed model accepts more
  // exposure outside the top-30.
  capByMSATier: {
    top30: 0.0625,
    secondary: 0.0650,
    tertiary: 0.0725,
  },

  portfolioFitBonus: {
    triggerWithinMiles: 5,
    capReductionBps: 15,
  },

  hardGates: {
    minNRSF: 50000,
    avgNRSF: 70000,
    minOneStoryAcres: 2.5,
    maxOneStoryAcres: 6,
    minMultiStoryAcres: 1.5,
    maxMultiStoryAcres: 3,
    maxDistanceToPSFamilyMiles: 35,
  },

  benchmarks: {
    sameStoreNOIMargin: 0.7120,
    sameStoreOpexPctRev: 0.2880,
    avgOccupancy: 0.926,
    yeOccupancy: 0.926,
    realizedRentPerOccSF: 19.91,         // FY2025 disclosed
    moveInRatePerOccSF: 13.16,           // FY2025 disclosed
    ecriPremium: 0.513,                  // +51.3% disclosed
    discountPctOfRevenue: 0.021,         // FY2025 disclosed
    fy2025BlendedAcqCap: 0.068,
    fy2025AcqPricePSF: 175,
    devYOCTarget: 0.0775,                // EXR FY2025 dev pipeline target
    devCostPSF: 210,
    industryECRI: 0.08,
  },

  brandColor: "#10B981",
  badgeText: "STORVEX UNDERWRITE · EXR LENS",
  citationFootnote: "Constants calibrated to EXR FY2025 10-K MD&A (accession 0001289490-26-000011): same-store rent $19.91/SF/yr, move-in rate $13.16 (+51.3% ECRI premium directly disclosed), opex 28.84% of revenue, occupancy 92.6%. Acquisition cap rates triangulated from Newmark 2025 Self-Storage Almanac + EXR Q4 FY2025 earnings transcript.",
};

// ══════════════════════════════════════════════════════════════════════════
// CUBESMART (CUBE) — third-largest public storage REIT
//
// FY2025 10-K Annual Report — accession 0001298675-26-000010 (filed 2026-02).
// Same-store cohort: 657 wholly-owned facilities (per Schedule III).
//
// CUBE underwriting differs from PSA + EXR in 3 ways:
//
//   1. PROMOTIONAL DISCOUNT — CUBE web rate consistently runs 32-40% below
//      in-store standard rate (verified via Storvex per-facility scrape of
//      1,549 facilities, 2026-05-10). Aggressive promo posture means more
//      move-in churn, harder to ratchet existing tenants like PSA does.
//
//   2. SAME-STORE COMPRESSION — FY2025 same-store revenue −0.5%, NOI −1.1%
//      (only major REIT with both metrics negative). Driver: lease-up class
//      moving into same-store cohort at lower rates while legacy tenants
//      cap out.
//
//   3. NEUTRAL CAP STANCE — CUBE buys at market cap, holds at market cap.
//      No distinct platform-integration program comparable to PSNext.

export const CUBE_LENS = {
  key: "CUBE",
  name: "Self-Managed Mid-Cap Pure-Play Storage REIT",
  ticker: "CUBE",
  description:
    "Third-largest public storage REIT — pure-play self-storage with 1,551 sitemap-discoverable facilities. Same-store NOI margin 71.0% (similar to EXR). Aggressive promotional posture: web rate runs 32-40% below in-store standard rate (per Storvex direct scrape, 2026-05-10). FY2025 same-store revenue −0.5% / NOI −1.1% — only major REIT with both metrics negative.",

  expenseOverrides: {
    propertyTaxPctRev: 0.102,
    insurancePctRev: 0.013,
    ccChargesPctEGI: 0.011,
    reservesPctRev: 0.008,
    payrollPctRev: 0.060,
    rmPctRev: 0.025,
    utilitiesPctRev: 0.015,
    marketingPctRev: 0.028,              // higher — promo intensity
    gaPctRev: 0.027,
    mgmtFeePctEGI: 0,                    // self-managed
  },

  // CUBE brand premium — narrower than PSA/EXR. Move.org consumer pricing
  // shows CUBE 3-5% above independents. Aggressive promo posture truncates
  // realized premium.
  revenueAdjustment: 1.04,

  capByMSATier: {
    top30: 0.0625,
    secondary: 0.0675,
    tertiary: 0.0750,
  },

  portfolioFitBonus: {
    triggerWithinMiles: 5,
    capReductionBps: 15,
  },

  hardGates: {
    minNRSF: 50000,
    avgNRSF: 65000,
    minOneStoryAcres: 2.5,
    maxOneStoryAcres: 6,
    minMultiStoryAcres: 1.5,
    maxMultiStoryAcres: 3,
    maxDistanceToPSFamilyMiles: 35,
  },

  benchmarks: {
    sameStoreNOIMargin: 0.7100,
    sameStoreOpexPctRev: 0.2891,
    avgOccupancy: 0.886,                 // FY2025 disclosed (lower than PSA/EXR)
    yeOccupancy: 0.886,
    realizedRentPerOccSF: 22.73,         // FY2025 disclosed
    impliedDiscountPct: 0.36,            // 36% promo (Storvex 2026-05-10 scrape)
    fy2025BlendedAcqCap: 0.065,
    fy2025AcqPricePSF: 165,
    devYOCTarget: 0.0775,
    devCostPSF: 200,
    industryECRI: 0.08,
  },

  brandColor: "#F59E0B",
  badgeText: "STORVEX UNDERWRITE · CUBE LENS",
  citationFootnote: "Constants calibrated to CUBE FY2025 10-K MD&A (accession 0001298675-26-000010): same-store rent $22.73/SF/yr, opex 28.91% of revenue, occupancy 88.6%, revenue growth −0.5% / NOI growth −1.1%. Promotional discount 36% derived from Storvex direct per-facility scrape (1,549 facilities, 19,988 unit listings, 2026-05-10).",
};

// ══════════════════════════════════════════════════════════════════════════
// SMARTSTOP (SMA) — small-cap growth-stage REIT
//
// FY2025 10-K — accession 0001193125-26-082573. ~149 properties Schedule III.
// Only major REIT with positive same-store growth in FY2025 (+1.6% rev,
// +0.6% NOI). Higher cost of capital drives 8.0%+ YOC hurdles.

export const SMA_LENS = {
  key: "SMA",
  name: "Growth-Stage Small-Cap Storage REIT",
  ticker: "SMA",
  description:
    "Growth-stage small-cap storage REIT — only major REIT with positive same-store growth in FY2025 (+1.6% revenue, +0.6% NOI). Higher cost of capital drives 8.0%+ YOC hurdles. Lean operations: NOI margin 66.9% (lowest of the four — small portfolio absorbs proportionally more central G&A). Aggressive 1031-buyer / non-traded REIT capital base.",

  expenseOverrides: {
    propertyTaxPctRev: 0.108,
    insurancePctRev: 0.018,
    ccChargesPctEGI: 0.014,
    reservesPctRev: 0.009,
    payrollPctRev: 0.075,
    rmPctRev: 0.030,
    utilitiesPctRev: 0.020,
    marketingPctRev: 0.030,
    gaPctRev: 0.035,                     // small-cap G&A overhead
    mgmtFeePctEGI: 0,                    // self-managed
  },

  revenueAdjustment: 1.02,               // smaller brand, less premium

  capByMSATier: {
    top30: 0.0700,
    secondary: 0.0725,
    tertiary: 0.0800,
  },

  portfolioFitBonus: {
    triggerWithinMiles: 5,
    capReductionBps: 10,
  },

  hardGates: {
    minNRSF: 40000,
    avgNRSF: 55000,
    minOneStoryAcres: 2.0,
    maxOneStoryAcres: 6,
    minMultiStoryAcres: 1.5,
    maxMultiStoryAcres: 3,
    maxDistanceToPSFamilyMiles: 35,
  },

  benchmarks: {
    sameStoreNOIMargin: 0.6690,
    sameStoreOpexPctRev: 0.3310,
    avgOccupancy: 0.925,
    yeOccupancy: 0.925,
    realizedRentPerOccSF: 20.03,
    fy2025BlendedAcqCap: 0.072,
    fy2025AcqPricePSF: 145,
    devYOCTarget: 0.085,                 // higher hurdle — higher cost of capital
    devCostPSF: 175,
    industryECRI: 0.08,
  },

  brandColor: "#A855F7",
  badgeText: "STORVEX UNDERWRITE · SMA LENS",
  citationFootnote: "Constants calibrated to SmartStop Self Storage FY2025 10-K (accession 0001193125-26-082573): same-store rent $20.03/SF/yr (+0.3% YoY), revenue growth +1.6%, NOI growth +0.6%, NOI margin 66.9%. Higher acquisition caps reflect small-cap cost of capital.",
};

// ══════════════════════════════════════════════════════════════════════════
// GENERIC INSTITUTIONAL — third-party-managed buyer (PE / non-REIT capital)
//
// Cross-REIT average baseline. Used for "generic institutional" comparison
// vs the operator-specific lenses. No platform uplift, no branded ECRI
// program, third-party-managed (5.5% mgmt fee — the GENERIC differentiator).

export const GENERIC_LENS = {
  key: "GENERIC",
  name: "Third-Party-Managed Generic Institutional",
  ticker: "GEN",
  description:
    "Third-party-managed generic institutional buyer (PE fund, non-REIT capital, 1031 buyer). No operating platform — pays 5.5% of EGI to Extra Space / CubeSmart / Storage Asset Management for 3PM services. No brand premium, no ECRI program, no platform uplift. Wider cap range to accept higher operational risk.",

  expenseOverrides: {
    propertyTaxPctRev: 0.105,
    insurancePctRev: 0.015,
    ccChargesPctEGI: 0.0225,             // industry standard 2.25%
    reservesPctRev: 0.010,
    payrollPctRev: 0.060,
    rmPctRev: 0.030,
    utilitiesPctRev: 0.020,
    marketingPctRev: 0.040,              // 3PM marketing spend higher
    gaPctRev: 0.020,
    mgmtFeePctEGI: 0.055,                // 3PM management fee — the GENERIC differentiator
  },

  revenueAdjustment: 1.0,                // no brand premium

  capByMSATier: {
    top30: 0.0700,
    secondary: 0.0725,
    tertiary: 0.0800,
  },

  portfolioFitBonus: {
    triggerWithinMiles: 5,
    capReductionBps: 0,                  // no platform — no portfolio-fit bonus
  },

  hardGates: {
    minNRSF: 40000,
    avgNRSF: 60000,
    minOneStoryAcres: 2.0,
    maxOneStoryAcres: 7,
    minMultiStoryAcres: 1.0,
    maxMultiStoryAcres: 4,
    maxDistanceToPSFamilyMiles: null,    // no portfolio constraint
  },

  benchmarks: {
    sameStoreNOIMargin: 0.640,           // 3PM-managed — fee dilutes margin
    sameStoreOpexPctRev: 0.360,
    avgOccupancy: 0.880,
    yeOccupancy: 0.880,
    realizedRentPerOccSF: 18.50,         // industry independent average
    fy2025BlendedAcqCap: 0.0725,
    fy2025AcqPricePSF: 130,
    devYOCTarget: 0.090,                 // higher hurdle — third-party capital cost
    devCostPSF: 165,
    industryECRI: 0.06,                  // less aggressive ECRI (3PM-managed)
  },

  brandColor: "#94A3B8",
  badgeText: "STORVEX UNDERWRITE · GENERIC LENS",
  citationFootnote: "Generic third-party-managed institutional underwriting profile. Constants triangulated from cross-REIT 10-K averages, Inside Self-Storage Industry Survey 2025 (third-party-managed cohort), and Newmark 2025 Self-Storage Almanac.",
};

// ══════════════════════════════════════════════════════════════════════════
// REGISTRY — all buyer lenses
// Add new lenses here. Display order = sort order on the analyzer card.
// ══════════════════════════════════════════════════════════════════════════

export const BUYER_LENSES = {
  PS: PS_LENS,
  EXR: EXR_LENS,
  CUBE: CUBE_LENS,
  SMA: SMA_LENS,
  GENERIC: GENERIC_LENS,
  // AMERCO: AMERCO_LENS,   // Phase 2 — U-Haul (UHAL) FY2025 10-K
  // NSA: NSA_LENS,          // Phase 2 — National Storage Affiliates (PSA-acquired)
  // SROA: SROA_LENS,        // Phase 2 — Storage Asset Management (3PM giant)
};

// Display order for UI dropdowns — most-relevant first.
export const BUYER_LENS_ORDER = ["PS", "EXR", "CUBE", "SMA", "GENERIC"];

// Default lens — Storvex's flagship pitch lens to PS VP Reza Mahdavian.
export const DEFAULT_BUYER_KEY = "PS";

/**
 * Look up a buyer lens by key. Falls back to PS_LENS if the key is unknown.
 */
export function getBuyerLens(key) {
  return BUYER_LENSES[key] || BUYER_LENSES[DEFAULT_BUYER_KEY] || PS_LENS;
}

// ══════════════════════════════════════════════════════════════════════════
// MULTI-LENS COMPARISON — runs every registered buyer lens against one deal
// ══════════════════════════════════════════════════════════════════════════
//
// Powers the side-by-side buyer comparison view. For one OM input, returns
// an array with one entry per registered lens — each carrying:
//
//   - lens metadata (key, ticker, name, brandColor, badgeText)
//   - dealStabCap (Y3 NOI / ask) — same for every lens (input-driven)
//   - lensTargetCap (lens.marketCap with portfolio-fit applied)
//   - bpsDelta (deal cap minus lens cap, positive = above hurdle = better)
//   - verdict: "HURDLE_CLEARED" | "AT_HURDLE" | "MISSES_HURDLE"
//   - impliedTakedownPrice = Y3 NOI / lens target cap (what THAT buyer would
//     pay at THEIR hurdle — the institutional "willingness to pay" number)
//   - reconstructedNOI (each lens applies its own opex ratios)
//
// Sorted by impliedTakedownPrice DESC so the strongest buyer is first.
// The top-row buyer is the natural takeout — they'd pay the most at their
// own hurdle. The price spread between row 1 and row N IS the platform-fit Δ.

/**
 * Run every registered buyer lens against one deal. Used by the side-by-side
 * comparison view to surface the institutional "who would pay most for this"
 * spread in a single screen.
 *
 * @param {Object} input    — same shape as analyzeExistingAsset() input
 * @param {Object} [extras]
 * @param {number} [extras.nearestPortfolioMi]
 * @param {Object} [extras.marketRents]
 * @returns {Array<Object>} sorted DESC by impliedTakedownPrice
 */
export function computeAllBuyerLenses(input, extras = {}) {
  const ask = Number(input?.ask) || 0;
  const rows = BUYER_LENS_ORDER.map((key) => {
    const lens = BUYER_LENSES[key];
    if (!lens) return null;
    const r = computeBuyerLens(input, lens, extras);
    const y3NOI = r?.projection?.y3?.noi;
    const lensTargetCap = r?.marketCap;
    if (!Number.isFinite(y3NOI) || !Number.isFinite(lensTargetCap) || y3NOI <= 0 || lensTargetCap <= 0) {
      return {
        key,
        ticker: lens.ticker,
        name: lens.name,
        badgeText: lens.badgeText,
        brandColor: lens.brandColor,
        dealStabCap: null,
        lensTargetCap: null,
        bpsDelta: null,
        verdict: "INSUFFICIENT_DATA",
        impliedTakedownPrice: null,
        reconstructedNOI: r?.reconstructed?.buyerNOI ?? null,
        revenuePremiumPct: r?.lens?.revenuePremium ?? 0,
        portfolioFit: !!r?.lens?.portfolioFit,
        capBasis: r?.lens?.capBasis || null,
        devYOCTarget: lens.benchmarks?.devYOCTarget ?? null,
      };
    }
    const dealStabCap = ask > 0 ? y3NOI / ask : null;
    const bpsDelta = dealStabCap != null ? Math.round((dealStabCap - lensTargetCap) * 10000) : null;
    const verdict =
      bpsDelta == null ? "INSUFFICIENT_DATA" :
      bpsDelta >= 50 ? "HURDLE_CLEARED" :
      bpsDelta >= -25 ? "AT_HURDLE" :
      "MISSES_HURDLE";
    const impliedTakedownPrice = y3NOI / lensTargetCap;
    return {
      key,
      ticker: lens.ticker,
      name: lens.name,
      badgeText: lens.badgeText,
      brandColor: lens.brandColor,
      dealStabCap,
      lensTargetCap,
      bpsDelta,
      verdict,
      impliedTakedownPrice,
      reconstructedNOI: r.reconstructed?.buyerNOI ?? null,
      revenuePremiumPct: r.lens?.revenuePremium ?? 0,
      portfolioFit: !!r.lens?.portfolioFit,
      capBasis: r.lens?.capBasis || null,
      devYOCTarget: lens.benchmarks?.devYOCTarget ?? null,
    };
  }).filter(Boolean);

  // Sort by implied takedown price DESC — winner first. Buyers who would
  // pay more at their own hurdle ARE the natural takeout for the asset.
  rows.sort((a, b) => {
    const pa = a.impliedTakedownPrice ?? -Infinity;
    const pb = b.impliedTakedownPrice ?? -Infinity;
    return pb - pa;
  });

  return rows;
}

/**
 * Compute the platform-fit Δ from a multi-lens comparison: how much MORE the
 * top-paying lens would pay vs. the GENERIC lens (third-party-managed buyer).
 * This is the dollar value the institutional self-managed REIT defensibly
 * pays above a generic institutional buyer on the identical asset.
 *
 * @param {Array<Object>} lensRows — output of computeAllBuyerLenses()
 * @returns {Object} {
 *   topLensKey, topPrice, genericPrice, deltaDollars, deltaPct
 * } | null
 */
export function computePlatformFitDelta(lensRows) {
  if (!Array.isArray(lensRows) || !lensRows.length) return null;
  const top = lensRows[0];
  const generic = lensRows.find((r) => r.key === "GENERIC");
  if (!top || !generic || top.impliedTakedownPrice == null || generic.impliedTakedownPrice == null) {
    return null;
  }
  const deltaDollars = top.impliedTakedownPrice - generic.impliedTakedownPrice;
  const deltaPct = generic.impliedTakedownPrice > 0
    ? deltaDollars / generic.impliedTakedownPrice
    : null;
  return {
    topLensKey: top.key,
    topLensTicker: top.ticker,
    topPrice: top.impliedTakedownPrice,
    genericPrice: generic.impliedTakedownPrice,
    deltaDollars,
    deltaPct,
  };
}

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
  // capBasis is rendered to the user — neutral institutional language.
  const basis = portfolioFit
    ? `Institutional ${msaTier} cap (${(baseCap * 100).toFixed(2)}%) − ${fitBps} bps portfolio-fit (within ${fitTrigger} mi of operator-family facility)`
    : `Institutional ${msaTier} cap (${(baseCap * 100).toFixed(2)}%)`;
  return { cap, portfolioFit, basis, baseCap, fitBps };
}

/**
 * Run the full Asset Analyzer pipeline through a buyer lens.
 *
 * @param {Object} input              — same input shape as analyzeExistingAsset()
 * @param {Object} lens               — a profile from BUYER_LENSES (default PS_LENS)
 * @param {Object} [extra]
 * @param {number} [extra.nearestPortfolioMi]  — distance to nearest buyer family facility
 * @param {Object} [extra.marketRents]         — SpareFoot { ccRentPerSF, driveupRentPerSF, sampleSize, source }
 *                                               for the rent sanity cross-check
 * @returns {Object} analysis result — same shape as analyzeExistingAsset() plus lens metadata
 */
export function computeBuyerLens(input, lens = PS_LENS, extra = {}) {
  const msaTier = input.msaTier || "secondary";
  const fit = computeLensMarketCap(lens, msaTier, extra.nearestPortfolioMi);

  const analysis = analyzeExistingAsset(input, {
    expenseOverrides: lens.expenseOverrides || null,
    revenueAdjustment: lens.revenueAdjustment || 1.0,
    customMarketCap: fit.cap,
    marketRents: extra.marketRents || null,
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
      // YOC + benchmark fields surfaced to the UI for the verdict card.
      devYOCTarget: lens.benchmarks?.devYOCTarget ?? null,
      acqCapByMSATier: lens.capByMSATier || null,
      sameStoreNOIMargin: lens.benchmarks?.sameStoreNOIMargin ?? null,
      sameStoreOpexPctRev: lens.benchmarks?.sameStoreOpexPctRev ?? null,
      avgOccupancy: lens.benchmarks?.avgOccupancy ?? null,
      ecriPremium: lens.benchmarks?.ecriPremium ?? null,
      realizedRentPerOccSF: lens.benchmarks?.realizedRentPerOccSF ?? null,
      moveInRatePerOccSF: lens.benchmarks?.moveInRatePerOccSF ?? null,
      portfolioFitTriggerMi: lens.portfolioFitBonus?.triggerWithinMiles ?? null,
      portfolioFitBps: lens.portfolioFitBonus?.capReductionBps ?? null,
      citationFootnote: lens.citationFootnote || null,
    },
  };
}
