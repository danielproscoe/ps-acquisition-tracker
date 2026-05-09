// existingAssetAnalysis.js — Storvex Asset Analyzer math module.
// Pure functions. No DOM. No React. Used by AssetAnalyzerView.
//
// Implements the 8-step institutional framework from
// memory/valuation-framework.md (calibrated on Red Rock Mega Storage,
// Reno NV, 4/21/26 PASS).
//
// Companion to ground-up SiteScore vetting. Where SiteScore answers
// "what should we pay for this dirt to develop", Asset Analyzer answers
// "what should we pay for this stabilized facility on a buyer-lens
// reconstructed NOI".
//
// All buyer-lens benchmarks traceable to:
//   - PSA / EXR / CUBE / LSI / NSA FY2025 10-K opex disclosures
//   - SSA Global stabilized operator benchmarks
//   - valuation-framework.md Step 3 institutional ranges
//   - memory/project_storvex-asset-analyzer.md state tax matrix

import { STORAGE } from "./valuationAnalysis.js";
import {
  getSaleCompsForState,
  avgCapRateForState,
  avgPPSFForState,
} from "./data/storageCompSales.js";

// ══════════════════════════════════════════════════════════════════════════
// STATE TAX REASSESSMENT MATRIX (Step 4 — the hidden line item)
// Source: memory/project_storvex-asset-analyzer.md
// ══════════════════════════════════════════════════════════════════════════

export const STATE_TAX_MATRIX = {
  NV: { onSaleReassess: false, fallbackRevPct: 0.040, capPct: 0.08, note: "Depreciated replacement cost basis; 8% commercial cap. Buyer-friendly — budget Y1 taxes at current × 1.08." },
  CA: { onSaleReassess: true, salePctOfPrice: 0.0115, capPct: 0.02, note: "Prop 13 reassess to sale price. Buyer-hostile — Y1 taxes ~1.1-1.2% of purchase price." },
  TX: { onSaleReassess: true, salePctOfPrice: 0.024, capPct: null, note: "Annual market value; uncapped commercial. Budget 2.0-2.8% of purchase price." },
  FL: { onSaleReassess: true, salePctOfPrice: 0.0175, capPct: 0.10, note: "Just Value annually; 10% non-homestead SOH cap." },
  NJ: { onSaleReassess: true, salePctOfPrice: 0.022, capPct: null, note: "Assessment ratio × equalization; sale triggers review." },
  MA: { onSaleReassess: true, salePctOfPrice: 0.020, capPct: null, note: "FMV at sale; Prop 2½ municipal cap on total levy." },
  OH: { onSaleReassess: true, salePctOfPrice: 0.020, capPct: null, note: "Triennial reappraisal cycle." },
  IN: { onSaleReassess: true, salePctOfPrice: 0.022, capPct: null, note: "Annual market reassessment." },
  KY: { onSaleReassess: true, salePctOfPrice: 0.018, capPct: null, note: "Annual reassessment commercial." },
  MI: { onSaleReassess: true, salePctOfPrice: 0.022, capPct: null, note: "Headlee + Proposal A; uncap on transfer." },
  TN: { onSaleReassess: true, salePctOfPrice: 0.020, capPct: null, note: "Quadrennial reappraisal; sale triggers review." },
  _DEFAULT: { onSaleReassess: true, salePctOfPrice: 0.020, capPct: null, note: "Generic post-sale reassessment assumption — confirm with county assessor." },
};

export function getStateTaxConfig(state) {
  const key = (state || "").toUpperCase().trim();
  return STATE_TAX_MATRIX[key] || STATE_TAX_MATRIX._DEFAULT;
}

// ══════════════════════════════════════════════════════════════════════════
// INSTITUTIONAL EXPENSE BENCHMARKS (Step 3 — buyer-lens reconstruction)
// Midpoints of valuation-framework.md ranges. Class A/B stabilized 60-100K NRSF.
// ══════════════════════════════════════════════════════════════════════════

export const EXPENSE_BENCHMARKS = {
  insurancePerSF: 0.225,           // $0.15-0.30/SF
  utilitiesPerSF_ccHeavy: 0.35,    // $0.20-0.40/SF — CC product = higher elec
  utilitiesPerSF_driveup: 0.22,
  payrollPerSF_manned: 1.00,       // $0.80-1.20/SF
  payrollPerSF_unmanned: 0,
  rmPerSF: 0.25,                   // $0.20-0.30/SF
  marketingPerSF: 0.325,           // $0.25-0.40/SF
  gaPerSF: 0.075,                  // $0.05-0.10/SF
  ccChargesPctEGI: 0.0225,         // 2.0-2.5% of EGI
  mgmtFeePctEGI: 0.055,            // 5.0-6.0% of EGI (third-party standard)
  reservesPerSF: 0.175,            // $0.15-0.20/SF
};

// ══════════════════════════════════════════════════════════════════════════
// STABILIZATION TIMING (Step 5 — Y1 → Y3 → Y5 projection)
// Y1→Y3: ECRI burn-in (PSA 8% on rolled tenants) + concession recovery
//        Framework: "real upside on Class A freezer-book = 10-12% over 24 mo"
// Y3→Y5: 3% rev growth / 2.5% expense growth (institutional baseline)
// ══════════════════════════════════════════════════════════════════════════

const Y1_TO_Y3_REV_LIFT = 0.11;     // 11% over 2 yrs — midpoint of 10-12% framework range
const Y1_TO_Y3_EXP_INFLATION = 0.05; // 2.5%/yr × 2 = ~5%
const Y3_TO_Y5_REV_GROWTH = 0.0609;  // (1.03)^2 - 1
const Y3_TO_Y5_EXP_GROWTH = 0.0506;  // (1.025)^2 - 1

// ══════════════════════════════════════════════════════════════════════════
// DEAL TYPE TAXONOMY (Step 8 — buyer matrix routing)
// Drives the math path for projection + tier pricing.
//
//   STABILIZED  — Class A/B 85%+ occupied, run-rate T-12 reflects steady state
//   CO_LU       — Newly built (C-of-O lease-up), <70% occupied, transitional T-12
//   VALUE_ADD   — Under-managed (<85% occ AND/OR rate compression vs market)
// ══════════════════════════════════════════════════════════════════════════

export const DEAL_TYPES = {
  STABILIZED: "stabilized",
  CO_LU: "co-lu",
  VALUE_ADD: "value-add",
};

// Tier cap rate ranges per deal type, from valuation-framework.md Step 6:
//   "Newly-built C-of-O lease-up: 7.0-7.5% on stabilized NOI projection"
//   Value-add typically 50bps wider than stabilized of same MSA tier
export const DEAL_TYPE_CAP_BANDS = {
  [DEAL_TYPES.STABILIZED]: { homeRunDelta: +0.0050, strikeDelta: 0, walkDelta: -0.0025 }, // off market cap
  [DEAL_TYPES.CO_LU]:      { walkCap: 0.0700, strikeCap: 0.0725, homeRunCap: 0.0750 },     // absolute caps
  [DEAL_TYPES.VALUE_ADD]:  { homeRunDelta: +0.0100, strikeDelta: +0.0050, walkDelta: 0 },  // off market cap (wider band)
};

// ══════════════════════════════════════════════════════════════════════════
// MSA TIER → MARKET CAP RATE (Step 6)
// Adjusts STORAGE.ACQ_CAP (5.6%) per Green Street Q1 2026 Sector Report.
// ══════════════════════════════════════════════════════════════════════════

export const MSA_TIER_CAP_ADJUST = {
  top30: -0.0025,    // -25 bps — Top-30 MSA
  secondary: 0,       // base — Secondary MSA (rank 31-125)
  tertiary: +0.0075,  // +75 bps — Tertiary MSA
};

export function computeMarketCap(msaTier) {
  const adj = MSA_TIER_CAP_ADJUST[msaTier];
  const base = STORAGE.ACQ_CAP;
  return base + (typeof adj === "number" ? adj : 0);
}

// ══════════════════════════════════════════════════════════════════════════
// STEP 3 — RE TAX RECONSTRUCTION (state-aware)
// ══════════════════════════════════════════════════════════════════════════

export function reconstructRETax(state, ask, currentTaxAnnual = 0) {
  const cfg = getStateTaxConfig(state);
  if (!cfg.onSaleReassess) {
    // No-reassess state (NV) — Y1 = current × cap rate
    const cap = (cfg.capPct != null ? cfg.capPct : 0.08);
    const fromCurrent = currentTaxAnnual > 0 ? currentTaxAnnual * (1 + cap) : 0;
    // Fallback: if no current tax provided, use revenue-based estimate
    const fallback = cfg.fallbackRevPct ? null : 0; // signal to caller
    return {
      annual: fromCurrent || fallback,
      method: fromCurrent > 0 ? "current × commercial cap" : "fallback (no current tax provided)",
      note: cfg.note,
      reassessed: false,
    };
  }
  // Reassess state — Y1 = ask × salePctOfPrice
  const annual = (ask || 0) * (cfg.salePctOfPrice || 0.020);
  return {
    annual,
    method: `ask × ${(cfg.salePctOfPrice * 100).toFixed(2)}% effective rate`,
    note: cfg.note,
    reassessed: true,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// STEP 3 — FULL BUYER-LENS NOI RECONSTRUCTION
// ══════════════════════════════════════════════════════════════════════════

/**
 * @param {Object} input
 * @param {number} input.ask                 Ask price ($)
 * @param {number} input.nrsf                Net rentable SF
 * @param {number} input.t12EGI              Seller T12 EGI ($)
 * @param {number} [input.t12NOI]            Seller T12 NOI ($) — for delta
 * @param {string} input.state               2-letter US state
 * @param {number} [input.ccPct=0.70]        Climate-controlled share (0-1)
 * @param {boolean} [input.isManned=true]    Onsite manager vs unmanned/kiosk
 * @param {number} [input.currentTaxAnnual]  Current annual property tax ($)
 *                                           — used for no-reassess states (NV)
 */
export function reconstructBuyerNOI(input, opts = {}) {
  const ask = Number(input.ask) || 0;
  const nrsf = Number(input.nrsf) || 0;
  const ccPct = input.ccPct != null ? Number(input.ccPct) : 0.70;
  const isManned = input.isManned !== false; // default true
  const currentTax = Number(input.currentTaxAnnual) || 0;

  // Buyer lens overrides — merge profile constants over institutional defaults.
  // Used by buyerLensProfiles.js to re-run the reconstruction with PS / AMERCO /
  // EXR / NSA underwriting constants. Empty by default = generic buyer-lens.
  const bm = { ...EXPENSE_BENCHMARKS, ...(opts.expenseOverrides || {}) };
  // Revenue adjustment — applied to t12EGI to capture brand-specific street rate
  // premium (PSA discloses +5-15% rate premium over comp set, per FY2025 10-K).
  const revAdjust = Number(opts.revenueAdjustment) || 1.0;
  const t12EGI = (Number(input.t12EGI) || 0) * revAdjust;
  const t12NOI = Number(input.t12NOI) || 0;

  const tax = reconstructRETax(input.state, ask, currentTax);
  const reTaxAnnual = tax.annual != null && tax.annual > 0
    ? tax.annual
    : ask * 0.006;

  const utilitiesPerSF = ccPct >= 0.5 ? bm.utilitiesPerSF_ccHeavy : bm.utilitiesPerSF_driveup;
  const payrollPerSF = isManned ? bm.payrollPerSF_manned : bm.payrollPerSF_unmanned;

  // Per-line opex computation. Each line accepts EITHER a $/SF benchmark
  // (institutional generic mode) OR a %-of-revenue override (REIT-specific
  // mode, e.g. PSA's 10-K-disclosed ratios). The %-of-rev mode is required
  // for low-rent assets (RV mega, drive-up heavy) where $/SF benchmarks
  // calibrated to typical Class A revenue overstate opex. Override fields:
  //   - insurancePctRev, utilitiesPctRev, payrollPctRev, rmPctRev,
  //     marketingPctRev, gaPctRev, reservesPctRev, otherDirectPctRev
  //   - propertyTaxPctRev — applies as fallback when state-tax-matrix
  //     can't determine a state-specific reassessment number
  const lineByPct = (pct, perSF, useSF) => useSF ? nrsf * perSF : t12EGI * pct;
  const fmtBasis = (pct, perSF, useSF) => useSF
    ? `$${perSF.toFixed(3)}/SF`
    : `${(pct * 100).toFixed(2)}% of EGI`;

  const lines = [
    {
      line: "Real Estate Taxes",
      buyer: reTaxAnnual,
      basis: tax.method,
      note: tax.note,
    },
    {
      line: "Insurance",
      buyer: bm.insurancePctRev != null ? t12EGI * bm.insurancePctRev : nrsf * bm.insurancePerSF,
      basis: bm.insurancePctRev != null ? `${(bm.insurancePctRev * 100).toFixed(2)}% of EGI` : `$${bm.insurancePerSF.toFixed(3)}/SF`,
      note: "Higher in CA wildfire / FL wind / TX hail corridors — adjust if applicable",
    },
    {
      line: "Utilities",
      buyer: bm.utilitiesPctRev != null ? t12EGI * bm.utilitiesPctRev : nrsf * utilitiesPerSF,
      basis: bm.utilitiesPctRev != null ? `${(bm.utilitiesPctRev * 100).toFixed(2)}% of EGI` : `$${utilitiesPerSF.toFixed(2)}/SF (${ccPct >= 0.5 ? "CC-weighted" : "drive-up"})`,
      note: "",
    },
    {
      line: "Payroll",
      buyer: bm.payrollPctRev != null ? t12EGI * bm.payrollPctRev : nrsf * payrollPerSF,
      basis: bm.payrollPctRev != null ? `${(bm.payrollPctRev * 100).toFixed(2)}% of EGI (central staffing)` : (isManned ? `$${payrollPerSF.toFixed(2)}/SF (manned)` : "$0/SF (unmanned)"),
      note: "",
    },
    {
      line: "Repairs & Maint",
      buyer: bm.rmPctRev != null ? t12EGI * bm.rmPctRev : nrsf * bm.rmPerSF,
      basis: bm.rmPctRev != null ? `${(bm.rmPctRev * 100).toFixed(2)}% of EGI` : `$${bm.rmPerSF.toFixed(2)}/SF`,
      note: "",
    },
    {
      line: "Marketing",
      buyer: bm.marketingPctRev != null ? t12EGI * bm.marketingPctRev : nrsf * bm.marketingPerSF,
      basis: bm.marketingPctRev != null ? `${(bm.marketingPctRev * 100).toFixed(2)}% of EGI` : `$${bm.marketingPerSF.toFixed(3)}/SF`,
      note: "Revenue-managed book requires aggressive spend",
    },
    {
      line: "G&A",
      buyer: bm.gaPctRev != null ? t12EGI * bm.gaPctRev : nrsf * bm.gaPerSF,
      basis: bm.gaPctRev != null ? `${(bm.gaPctRev * 100).toFixed(2)}% of EGI (central)` : `$${bm.gaPerSF.toFixed(3)}/SF`,
      note: "",
    },
    {
      line: "CC / Bank Charges",
      buyer: t12EGI * bm.ccChargesPctEGI,
      basis: `${(bm.ccChargesPctEGI * 100).toFixed(2)}% of EGI`,
      note: "",
    },
    {
      line: "Property Mgmt",
      buyer: t12EGI * bm.mgmtFeePctEGI,
      basis: `${(bm.mgmtFeePctEGI * 100).toFixed(1)}% of EGI`,
      note: bm.mgmtFeePctEGI === 0 ? "Self-managed (PSA / EXR / CUBE) — no third-party fee" : "Third-party standard; self-managed REITs run lower",
    },
    {
      line: "Reserves",
      buyer: bm.reservesPctRev != null ? t12EGI * bm.reservesPctRev : nrsf * bm.reservesPerSF,
      basis: bm.reservesPctRev != null ? `${(bm.reservesPctRev * 100).toFixed(2)}% of EGI` : `$${bm.reservesPerSF.toFixed(3)}/SF`,
      note: "",
    },
  ];

  const totalOpEx = lines.reduce((s, l) => s + l.buyer, 0);
  const buyerNOI = t12EGI - totalOpEx;
  const opexRatio = t12EGI > 0 ? totalOpEx / t12EGI : 0;
  const buyerCap = ask > 0 ? buyerNOI / ask : 0;

  // Delta vs seller pro forma
  const sellerOpEx = t12EGI - t12NOI;
  const deltaOpEx = totalOpEx - sellerOpEx;
  const deltaNOI = buyerNOI - t12NOI;
  const deltaPct = t12NOI > 0 ? deltaNOI / t12NOI : 0;

  // Flags — institutional norms 35-40% opex ratio
  const flags = [];
  if (opexRatio < 0.33) flags.push({ severity: "warn", text: "Reconstructed opex ratio <33% — verify benchmarks aren't clipping reality" });
  if (opexRatio > 0.42) flags.push({ severity: "info", text: "Reconstructed opex ratio >42% — operational drag or value-add lever opportunity" });
  if (Math.abs(deltaPct) > 0.20) flags.push({ severity: "warn", text: `Buyer NOI ${deltaPct > 0 ? "above" : "below"} seller by ${(Math.abs(deltaPct)*100).toFixed(1)}% — investigate which lines drive the gap` });

  return {
    lines,
    totalOpEx,
    sellerOpEx,
    deltaOpEx,
    egi: t12EGI,
    sellerNOI: t12NOI,
    buyerNOI,
    buyerCap,
    opexRatio,
    deltaNOI,
    deltaPct,
    flags,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// STEP 5 — STABILIZED NOI PROJECTION (Y1 → Y3 → Y5)
//
// Math path branches by dealType:
//
//   STABILIZED — Y1 = reconstructed T-12; Y3 = Y1 × (1 + 11% ECRI lift),
//                opex × 1.05; Y5 = Y3 + 3% rev / 2.5% exp growth.
//
//   CO_LU      — Y1 = transitional (informational only, low occ).
//                Y3 = stabilized projection from proFormaReconstructed
//                (buyer-lens reconstruction run against seller's pro forma EGI).
//                Y5 = Y3 + 3% rev / 2.5% exp growth.
//                Pricing happens at lease-up cap (7.0-7.5%) per framework Step 6.
//
//   VALUE_ADD  — Y1 = under-managed T-12. Y3 = stabilized after value-add
//                execution (uses proFormaReconstructed if provided, else
//                applies 15% revenue lift + market opex). Y5 = Y3 + growth.
//                Pricing wider band (market cap + 50-100 bps).
// ══════════════════════════════════════════════════════════════════════════

export function projectStabilizedNOI(reconstructed, opts = {}) {
  const dealType = opts.dealType || DEAL_TYPES.STABILIZED;
  const proFormaReconstructed = opts.proFormaReconstructed || null;

  const y1Rev = reconstructed.egi || 0;
  const y1Exp = reconstructed.totalOpEx || 0;
  const y1NOI = reconstructed.buyerNOI || 0;

  let y3Rev, y3Exp, y3NOI, basis;

  if (dealType === DEAL_TYPES.CO_LU || dealType === DEAL_TYPES.VALUE_ADD) {
    if (proFormaReconstructed) {
      // Y3 = stabilized from buyer-lens reconstruction of pro forma EGI
      y3Rev = proFormaReconstructed.egi;
      y3Exp = proFormaReconstructed.totalOpEx;
      y3NOI = proFormaReconstructed.buyerNOI;
      basis = dealType === DEAL_TYPES.CO_LU
        ? "CO-LU: Y1 transitional (lease-up). Y3 = stabilized projection — buyer-lens reconstruction of seller pro forma EGI at institutional opex benchmarks. Y5 = 3% rev / 2.5% exp growth."
        : "VALUE-ADD: Y1 under-managed T-12. Y3 = stabilized projection after value-add execution — buyer-lens reconstruction of pro forma EGI. Y5 = 3% rev / 2.5% exp growth.";
    } else {
      // Fallback: no pro forma EGI provided — use 15% lift on T-12 for value-add,
      // 25% for CO-LU (more aggressive ramp from transitional state)
      const lift = dealType === DEAL_TYPES.CO_LU ? 0.25 : 0.15;
      y3Rev = y1Rev * (1 + lift);
      y3Exp = y1Exp * (1 + Y1_TO_Y3_EXP_INFLATION);
      y3NOI = y3Rev - y3Exp;
      basis = `${dealType.toUpperCase()}: No pro forma EGI provided — applied ${(lift*100).toFixed(0)}% Y1→Y3 revenue lift fallback. Pass proFormaEGI for tighter projection.`;
    }
  } else {
    // STABILIZED — calibrated to cross-REIT same-store growth from latest
    // 10-K disclosures (replaces generic 11% Y1→Y3 ECRI lift). Falls back
    // to generic if calibration data unavailable OR opts.useCalibration === false.
    const useCalibration = opts.useCalibration !== false; // default true
    let calibratedLift = null;
    let calibratedBasis = null;
    if (useCalibration) {
      try {
        // eslint-disable-next-line global-require
        const { getCalibratedSameStoreGrowth } = require("./data/edgarCompIndex");
        const cal = getCalibratedSameStoreGrowth();
        if (cal && cal.y1ToY3Compounded != null) {
          calibratedLift = cal.y1ToY3Compounded;
          calibratedBasis = cal.basisText;
        }
      } catch (e) { /* graceful fallback */ }
    }

    if (calibratedLift != null) {
      y3Rev = y1Rev * (1 + calibratedLift);
      y3Exp = y1Exp * (1 + Y1_TO_Y3_EXP_INFLATION);
      y3NOI = y3Rev - y3Exp;
      basis = `Y1→Y3: ${calibratedBasis} Y3→Y5: 3% rev / 2.5% exp growth.`;
    } else {
      // Fallback: generic 11% ECRI lift
      y3Rev = y1Rev * (1 + Y1_TO_Y3_REV_LIFT);
      y3Exp = y1Exp * (1 + Y1_TO_Y3_EXP_INFLATION);
      y3NOI = y3Rev - y3Exp;
      basis = "Y1→Y3: ECRI 8%/yr on rolled share + concession recovery (Class A freezer-book yields 10-12% over 24 mo per framework — generic fallback when REIT calibration data is unavailable). Y3→Y5: 3% rev / 2.5% exp growth.";
    }
  }

  const y5Rev = y3Rev * (1 + Y3_TO_Y5_REV_GROWTH);
  const y5Exp = y3Exp * (1 + Y3_TO_Y5_EXP_GROWTH);
  const y5NOI = y5Rev - y5Exp;

  return {
    y1: { rev: y1Rev, exp: y1Exp, noi: y1NOI },
    y3: { rev: y3Rev, exp: y3Exp, noi: y3NOI },
    y5: { rev: y5Rev, exp: y5Exp, noi: y5NOI },
    dealType,
    assumptions: {
      y1ToY3RevLift: Y1_TO_Y3_REV_LIFT,
      y1ToY3ExpInflation: Y1_TO_Y3_EXP_INFLATION,
      y3ToY5RevGrowth: Y3_TO_Y5_REV_GROWTH,
      y3ToY5ExpGrowth: Y3_TO_Y5_EXP_GROWTH,
      basis,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// STEP 5 — VALUATION MATRIX (Y1/Y3/Y5 × cap rate grid)
// ══════════════════════════════════════════════════════════════════════════

export function computeValuationMatrix(projection, capRates = [0.055, 0.060, 0.065, 0.070]) {
  const years = ["y1", "y3", "y5"];
  const cells = years.map((y) => {
    const noi = projection[y].noi;
    return capRates.map((cap) => (cap > 0 ? noi / cap : 0));
  });
  return { years, capRates, cells };
}

// ══════════════════════════════════════════════════════════════════════════
// STEP 6 — DJR PRICE TIERS (Home Run / Strike / Walk)
//
// Tier formulas branch by dealType per valuation-framework.md Step 6:
//
//   STABILIZED — Home Run = Y3 NOI @ (mkt + 50 bps)
//                Strike   = Y5 NOI @ mkt cap
//                Walk     = Y5 NOI @ (mkt - 25 bps)
//
//   CO_LU      — All tiers use Y3 stabilized NOI (Y1 transitional, no signal):
//                Home Run @ 7.50%, Strike @ 7.25%, Walk @ 7.00%
//                ("Newly-built C-of-O lease-up: 7.0-7.5% on stabilized NOI projection")
//
//   VALUE_ADD  — Wider band reflecting execution risk:
//                Home Run = Y3 NOI @ (mkt + 100 bps)
//                Strike   = Y5 NOI @ (mkt + 50 bps)
//                Walk     = Y5 NOI @ mkt cap
// ══════════════════════════════════════════════════════════════════════════

export function computePriceTiers(projection, marketCap, dealType = DEAL_TYPES.STABILIZED) {
  const cap = Number(marketCap) || STORAGE.ACQ_CAP;

  let homeRunCap, strikeCap, walkCap;
  let homeRunNumerator, strikeNumerator, walkNumerator;
  let homeRunBasis, strikeBasis, walkBasis;

  if (dealType === DEAL_TYPES.CO_LU) {
    const band = DEAL_TYPE_CAP_BANDS[DEAL_TYPES.CO_LU];
    homeRunCap = band.homeRunCap;
    strikeCap = band.strikeCap;
    walkCap = band.walkCap;
    homeRunNumerator = projection.y3.noi;
    strikeNumerator = projection.y3.noi;
    walkNumerator = projection.y3.noi;
    homeRunBasis = "Y3 stabilized NOI @ 7.50% (CO-LU lease-up cap ceiling)";
    strikeBasis = "Y3 stabilized NOI @ 7.25% (CO-LU lease-up cap midpoint)";
    walkBasis = "Y3 stabilized NOI @ 7.00% (CO-LU lease-up cap floor)";
  } else if (dealType === DEAL_TYPES.VALUE_ADD) {
    homeRunCap = cap + 0.0100;
    strikeCap = cap + 0.0050;
    walkCap = cap;
    homeRunNumerator = projection.y3.noi;
    strikeNumerator = projection.y5.noi;
    walkNumerator = projection.y5.noi;
    homeRunBasis = "Y3 NOI @ market cap + 100 bps (value-add execution risk premium)";
    strikeBasis = "Y5 NOI @ market cap + 50 bps";
    walkBasis = "Y5 NOI @ market cap (no execution-risk premium — ceiling)";
  } else {
    // STABILIZED (default)
    homeRunCap = cap + 0.0050;
    strikeCap = cap;
    walkCap = cap - 0.0025;
    homeRunNumerator = projection.y3.noi;
    strikeNumerator = projection.y5.noi;
    walkNumerator = projection.y5.noi;
    homeRunBasis = "Y3 NOI @ market cap + 50 bps";
    strikeBasis = "Y5 NOI @ market cap";
    walkBasis = "Y5 NOI @ market cap − 25 bps";
  }

  const homeRun = homeRunCap > 0 ? (homeRunNumerator / homeRunCap) : 0;
  const strike = strikeCap > 0 ? (strikeNumerator / strikeCap) : 0;
  const walk = walkCap > 0 ? (walkNumerator / walkCap) : 0;

  return {
    homeRun: { price: homeRun, cap: homeRunCap, basis: homeRunBasis },
    strike:  { price: strike,  cap: strikeCap,  basis: strikeBasis },
    walk:    { price: walk,    cap: walkCap,    basis: walkBasis },
    marketCap: cap,
    dealType,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// VERDICT — PURSUE / NEGOTIATE / PASS
// ══════════════════════════════════════════════════════════════════════════

export function computeVerdict(ask, tiers) {
  const a = Number(ask) || 0;
  const strike = tiers.strike.price;
  const walk = tiers.walk.price;

  if (a <= strike) {
    return {
      label: "PURSUE",
      rationale: "Ask at or below Strike — yield story holds at market cap.",
      gapDollars: strike - a,
      gapPct: strike > 0 ? (strike - a) / strike : 0,
      color: "#22C55E",
    };
  }
  if (a <= walk) {
    return {
      label: "NEGOTIATE",
      rationale: `Ask between Strike and Walk — push back $${Math.round(a - strike).toLocaleString()} to land at Strike.`,
      gapDollars: a - strike,
      gapPct: strike > 0 ? (a - strike) / strike : 0,
      color: "#F59E0B",
    };
  }
  const overWalk = a - walk;
  return {
    label: "PASS",
    rationale: `Ask exceeds Walk by $${Math.round(overWalk).toLocaleString()} (${walk > 0 ? ((overWalk/walk)*100).toFixed(1) : "—"}% premium). Yield story breaks.`,
    gapDollars: overWalk,
    gapPct: walk > 0 ? overWalk / walk : 0,
    color: "#EF4444",
  };
}

// ══════════════════════════════════════════════════════════════════════════
// COMP GRID (Step 8 — sale comp benchmark)
// ══════════════════════════════════════════════════════════════════════════

export function buildCompGrid(state, ask, nrsf) {
  const comps = getSaleCompsForState(state) || [];
  const avgCap = avgCapRateForState(state);
  const avgPPSF = avgPPSFForState(state);
  const subjPPSF = nrsf > 0 ? ask / nrsf : 0;
  return {
    state: (state || "").toUpperCase().trim(),
    comps,
    avgCap,
    avgPPSF,
    subjectPPSF: subjPPSF,
    subjectVsAvgPPSF: avgPPSF > 0 ? (subjPPSF - avgPPSF) / avgPPSF : 0,
    fellbackToPeer: comps.length > 0 && !STATE_TAX_MATRIX[state?.toUpperCase()],
  };
}

// ══════════════════════════════════════════════════════════════════════════
// RENT SANITY CHECK — implied effective rent vs SpareFoot submarket
//
// Independent cross-check on the seller's reported EGI. Computes the implied
// effective rent per SF/mo at full occupancy from seller's T-12 EGI, then
// compares to the SpareFoot blended market rate (CC% weighted). Flags if
// seller's implied rent sits >15% above market — meaning the pro forma may
// be aggressive — or >15% below, meaning a rent-lever value-add signal.
//
// This is the v0 sanity floor. The v1 triangulation tier will add an
// explicit market-rate revenue path so users can see Walk/Strike/Home Run
// computed against market rents alongside seller's pro forma.
//
// Pure function — no API calls, no external state. Returns null if any
// required input is missing (graceful degrade for partial enrichment).
// ══════════════════════════════════════════════════════════════════════════

export function computeRentSanity({ t12EGI, nrsf, economicOcc, ccPct, marketRents }) {
  if (!marketRents || marketRents.ccRentPerSF == null) return null;
  if (!t12EGI || !nrsf || !economicOcc || economicOcc <= 0.10) return null;

  const ccRate = Number(marketRents.ccRentPerSF) || 0;
  // Drive-up typically prices at 50-60% of CC rate; use 0.55 fallback when
  // SpareFoot doesn't return an explicit drive-up rate for the submarket.
  const driveUpRate = Number(marketRents.driveupRentPerSF) || ccRate * 0.55;
  const cc = ccPct != null ? Number(ccPct) : 0.70;
  const blendedMarketRate = cc * ccRate + (1 - cc) * driveUpRate;

  if (blendedMarketRate <= 0) return null;

  // Project seller's T-12 EGI to full-occupancy equivalent so it's
  // comparable to SpareFoot's market rate (which is per occupied SF).
  const assumedFullOccEGI = t12EGI / economicOcc;
  const impliedRatePerSF = assumedFullOccEGI / nrsf / 12;

  const premiumPct = (impliedRatePerSF - blendedMarketRate) / blendedMarketRate;

  let severity, message;
  if (premiumPct > 0.15) {
    severity = "warn";
    message = `Seller's implied effective rent of $${impliedRatePerSF.toFixed(2)}/SF/mo sits ${(premiumPct * 100).toFixed(1)}% above blended submarket rate of $${blendedMarketRate.toFixed(2)}/SF/mo — pro forma may be aggressive. Verify achievability before underwriting.`;
  } else if (premiumPct < -0.15) {
    severity = "info";
    message = `Seller's implied effective rent of $${impliedRatePerSF.toFixed(2)}/SF/mo sits ${(Math.abs(premiumPct) * 100).toFixed(1)}% below blended submarket rate of $${blendedMarketRate.toFixed(2)}/SF/mo — value-add rent lever or distressed pricing signal.`;
  } else {
    severity = "ok";
    message = `Seller's implied effective rent of $${impliedRatePerSF.toFixed(2)}/SF/mo within ±15% of blended submarket rate of $${blendedMarketRate.toFixed(2)}/SF/mo — pro forma defensible against market.`;
  }

  return {
    impliedRatePerSF,
    blendedMarketRate,
    ccMarketRate: ccRate,
    driveUpMarketRate: driveUpRate,
    premiumPct,
    severity,
    message,
    sampleSize: marketRents.sampleSize || null,
    source: marketRents.source || "SpareFoot",
  };
}

// ══════════════════════════════════════════════════════════════════════════
// TOP-LEVEL ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════════════

export function analyzeExistingAsset(input, opts = {}) {
  // opts:
  //   expenseOverrides   — partial EXPENSE_BENCHMARKS override (per buyer lens)
  //   revenueAdjustment  — multiplier on EGI for street rate premium (default 1.0)
  //   customMarketCap    — overrides MSA-tier-derived market cap (per buyer lens)
  //   marketRents        — { ccRentPerSF, driveupRentPerSF, sampleSize, source }
  //                        from SpareFoot enrichment; enables rent sanity check
  const expenseOverrides = opts.expenseOverrides || null;
  const revenueAdjustment = Number(opts.revenueAdjustment) || 1.0;
  const customMarketCap = opts.customMarketCap;
  const marketRents = opts.marketRents || null;
  const reconOpts = (expenseOverrides || revenueAdjustment !== 1.0)
    ? { expenseOverrides, revenueAdjustment }
    : {};

  const ask = Number(input.ask) || 0;
  const nrsf = Number(input.nrsf) || 0;
  const t12NOI = Number(input.t12NOI) || 0;
  const unitCount = Number(input.unitCount) || 0;
  const physOcc = Number(input.physicalOcc) || 0;
  const econOcc = Number(input.economicOcc) || physOcc;
  const msaTier = input.msaTier || "secondary";
  const dealType = input.dealType || DEAL_TYPES.STABILIZED;
  const proFormaEGI = Number(input.proFormaEGI) || 0;
  const proFormaNOI = Number(input.proFormaNOI) || 0;

  const capOnAsk = ask > 0 ? t12NOI / ask : 0;
  // DOA flag only meaningful for stabilized — CO-LU/value-add seller cap is
  // expected to be low because T-12 is transitional, not a steady-state read.
  const doaFlag = dealType === DEAL_TYPES.STABILIZED && capOnAsk > 0 && capOnAsk < 0.05;

  const snapshot = {
    name: input.name || "",
    state: (input.state || "").toUpperCase().trim(),
    ask,
    nrsf,
    unitCount,
    yearBuilt: input.yearBuilt || null,
    physicalOcc: physOcc,
    economicOcc: econOcc,
    occGap: physOcc - econOcc,
    sellerNOI: t12NOI,
    sellerEGI: Number(input.t12EGI) || 0,
    pricePerSF: nrsf > 0 ? ask / nrsf : 0,
    pricePerUnit: unitCount > 0 ? ask / unitCount : 0,
    capOnAsk,
    doaFlag,
    doaReason: doaFlag
      ? "Cap on ask <5.0% on seller pro forma — DOA on current-rate-environment underwriting unless 1031 / strategic / foreign buyer in play."
      : null,
    dealType,
    proFormaEGI,
    proFormaNOI,
  };

  const reconstructed = reconstructBuyerNOI(input, reconOpts);

  // For CO-LU / Value-Add: run a second buyer-lens reconstruction against
  // the pro forma EGI to derive the stabilized Y3 NOI baseline.
  let proFormaReconstructed = null;
  if ((dealType === DEAL_TYPES.CO_LU || dealType === DEAL_TYPES.VALUE_ADD) && proFormaEGI > 0) {
    proFormaReconstructed = reconstructBuyerNOI({
      ...input,
      t12EGI: proFormaEGI,
      t12NOI: proFormaNOI || (proFormaEGI * 0.65), // rough fallback if NOI not provided
    }, reconOpts);
  }

  const projection = projectStabilizedNOI(reconstructed, { dealType, proFormaReconstructed });
  const matrix = computeValuationMatrix(projection);
  const marketCap = customMarketCap != null ? Number(customMarketCap) : computeMarketCap(msaTier);
  const tiers = computePriceTiers(projection, marketCap, dealType);
  const verdict = computeVerdict(ask, tiers);
  const comps = buildCompGrid(input.state, ask, nrsf);

  // Rent sanity — independent cross-check of seller's implied effective
  // rent vs SpareFoot blended submarket rate. Returns null if marketRents
  // not provided (e.g., enrichment hasn't completed yet on first render).
  const rentSanity = computeRentSanity({
    t12EGI: Number(input.t12EGI) || 0,
    nrsf,
    economicOcc: econOcc,
    ccPct: input.ccPct != null ? Number(input.ccPct) : 0.70,
    marketRents,
  });

  // EDGAR cross-REIT institutional cost-basis index for the subject's state.
  // Pulled from src/data/edgar-comp-index.json (derived from PSA + EXR + CUBE
  // 10-K Schedule III filings). Returns null if no REIT data for the state.
  // Accessor is dynamically required to avoid pulling the JSON when the
  // module is imported in environments without it (e.g. some test paths).
  let edgarComp = null;
  let edgar8KTransactions = null;
  try {
    // eslint-disable-next-line global-require
    const { formatEDGARCitation, getRelevant8KTransactions } = require("./data/edgarCompIndex");
    edgarComp = formatEDGARCitation(snapshot.state);
    edgar8KTransactions = getRelevant8KTransactions(snapshot.state, 6);
  } catch (e) {
    edgarComp = null;
    edgar8KTransactions = null;
  }

  return {
    snapshot,
    reconstructed,
    proFormaReconstructed,
    projection,
    matrix,
    marketCap,
    msaTier,
    dealType,
    tiers,
    verdict,
    comps,
    rentSanity,
    edgarComp,
    edgar8KTransactions,
    generatedAt: new Date().toISOString(),
  };
}
