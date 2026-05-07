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
export function reconstructBuyerNOI(input) {
  const ask = Number(input.ask) || 0;
  const nrsf = Number(input.nrsf) || 0;
  const t12EGI = Number(input.t12EGI) || 0;
  const t12NOI = Number(input.t12NOI) || 0;
  const ccPct = input.ccPct != null ? Number(input.ccPct) : 0.70;
  const isManned = input.isManned !== false; // default true
  const currentTax = Number(input.currentTaxAnnual) || 0;

  const tax = reconstructRETax(input.state, ask, currentTax);
  // Tax fallback — if no-reassess state with no current tax, use 0.6% of ask as
  // generic NV-style estimate (NV depreciated assessed × ~6% effective)
  const reTaxAnnual = tax.annual != null && tax.annual > 0
    ? tax.annual
    : ask * 0.006;

  const utilitiesPerSF = ccPct >= 0.5
    ? EXPENSE_BENCHMARKS.utilitiesPerSF_ccHeavy
    : EXPENSE_BENCHMARKS.utilitiesPerSF_driveup;
  const payrollPerSF = isManned
    ? EXPENSE_BENCHMARKS.payrollPerSF_manned
    : EXPENSE_BENCHMARKS.payrollPerSF_unmanned;

  const lines = [
    { line: "Real Estate Taxes",  buyer: reTaxAnnual,                                          basis: tax.method,           note: tax.note },
    { line: "Insurance",          buyer: nrsf * EXPENSE_BENCHMARKS.insurancePerSF,             basis: `$${EXPENSE_BENCHMARKS.insurancePerSF.toFixed(3)}/SF`, note: "Higher in CA wildfire / FL wind / TX hail corridors — adjust if applicable" },
    { line: "Utilities",          buyer: nrsf * utilitiesPerSF,                                basis: `$${utilitiesPerSF.toFixed(2)}/SF (${ccPct >= 0.5 ? "CC-weighted" : "drive-up"})`, note: "" },
    { line: "Payroll",            buyer: nrsf * payrollPerSF,                                  basis: isManned ? `$${payrollPerSF.toFixed(2)}/SF (manned)` : "$0/SF (unmanned)", note: "" },
    { line: "Repairs & Maint",    buyer: nrsf * EXPENSE_BENCHMARKS.rmPerSF,                    basis: `$${EXPENSE_BENCHMARKS.rmPerSF.toFixed(2)}/SF`, note: "" },
    { line: "Marketing",          buyer: nrsf * EXPENSE_BENCHMARKS.marketingPerSF,             basis: `$${EXPENSE_BENCHMARKS.marketingPerSF.toFixed(3)}/SF`, note: "Revenue-managed book requires aggressive spend" },
    { line: "G&A",                buyer: nrsf * EXPENSE_BENCHMARKS.gaPerSF,                    basis: `$${EXPENSE_BENCHMARKS.gaPerSF.toFixed(3)}/SF`, note: "" },
    { line: "CC / Bank Charges",  buyer: t12EGI * EXPENSE_BENCHMARKS.ccChargesPctEGI,          basis: `${(EXPENSE_BENCHMARKS.ccChargesPctEGI*100).toFixed(2)}% of EGI`, note: "" },
    { line: "Property Mgmt",      buyer: t12EGI * EXPENSE_BENCHMARKS.mgmtFeePctEGI,            basis: `${(EXPENSE_BENCHMARKS.mgmtFeePctEGI*100).toFixed(1)}% of EGI`, note: "Third-party standard; self-managed REITs run lower" },
    { line: "Reserves",           buyer: nrsf * EXPENSE_BENCHMARKS.reservesPerSF,              basis: `$${EXPENSE_BENCHMARKS.reservesPerSF.toFixed(3)}/SF`, note: "" },
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
// ══════════════════════════════════════════════════════════════════════════

export function projectStabilizedNOI(reconstructed) {
  const y1Rev = reconstructed.egi || 0;
  const y1Exp = reconstructed.totalOpEx || 0;
  const y1NOI = reconstructed.buyerNOI || 0;

  const y3Rev = y1Rev * (1 + Y1_TO_Y3_REV_LIFT);
  const y3Exp = y1Exp * (1 + Y1_TO_Y3_EXP_INFLATION);
  const y3NOI = y3Rev - y3Exp;

  const y5Rev = y3Rev * (1 + Y3_TO_Y5_REV_GROWTH);
  const y5Exp = y3Exp * (1 + Y3_TO_Y5_EXP_GROWTH);
  const y5NOI = y5Rev - y5Exp;

  return {
    y1: { rev: y1Rev, exp: y1Exp, noi: y1NOI },
    y3: { rev: y3Rev, exp: y3Exp, noi: y3NOI },
    y5: { rev: y5Rev, exp: y5Exp, noi: y5NOI },
    assumptions: {
      y1ToY3RevLift: Y1_TO_Y3_REV_LIFT,
      y1ToY3ExpInflation: Y1_TO_Y3_EXP_INFLATION,
      y3ToY5RevGrowth: Y3_TO_Y5_REV_GROWTH,
      y3ToY5ExpGrowth: Y3_TO_Y5_EXP_GROWTH,
      basis: "Y1→Y3: ECRI 8%/yr on rolled share + concession recovery (Class A freezer-book yields 10-12% over 24 mo per framework). Y3→Y5: 3% rev / 2.5% exp growth.",
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
// Home Run = T3 NOI @ (market cap + 50 bps) — aggressive bid
// Strike   = T5 NOI @ market cap            — most likely clear price
// Walk     = T5 NOI @ (market cap - 25 bps) — above this, yield story breaks
// ══════════════════════════════════════════════════════════════════════════

export function computePriceTiers(projection, marketCap) {
  const cap = Number(marketCap) || STORAGE.ACQ_CAP;
  const homeRunCap = cap + 0.0050;
  const strikeCap = cap;
  const walkCap = cap - 0.0025;

  const homeRun = homeRunCap > 0 ? (projection.y3.noi / homeRunCap) : 0;
  const strike = strikeCap > 0 ? (projection.y5.noi / strikeCap) : 0;
  const walk = walkCap > 0 ? (projection.y5.noi / walkCap) : 0;

  return {
    homeRun: { price: homeRun, cap: homeRunCap, basis: "Y3 NOI @ market cap + 50 bps" },
    strike:  { price: strike,  cap: strikeCap,  basis: "Y5 NOI @ market cap" },
    walk:    { price: walk,    cap: walkCap,    basis: "Y5 NOI @ market cap − 25 bps" },
    marketCap: cap,
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
      gap$: strike - a,
      gapPct: strike > 0 ? (strike - a) / strike : 0,
      color: "#22C55E",
    };
  }
  if (a <= walk) {
    return {
      label: "NEGOTIATE",
      rationale: `Ask between Strike and Walk — push back $${Math.round(a - strike).toLocaleString()} to land at Strike.`,
      gap$: a - strike,
      gapPct: strike > 0 ? (a - strike) / strike : 0,
      color: "#F59E0B",
    };
  }
  const overWalk = a - walk;
  return {
    label: "PASS",
    rationale: `Ask exceeds Walk by $${Math.round(overWalk).toLocaleString()} (${walk > 0 ? ((overWalk/walk)*100).toFixed(1) : "—"}% premium). Yield story breaks.`,
    gap$: overWalk,
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
// TOP-LEVEL ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════════════

export function analyzeExistingAsset(input) {
  const ask = Number(input.ask) || 0;
  const nrsf = Number(input.nrsf) || 0;
  const t12NOI = Number(input.t12NOI) || 0;
  const unitCount = Number(input.unitCount) || 0;
  const physOcc = Number(input.physicalOcc) || 0;
  const econOcc = Number(input.economicOcc) || physOcc;
  const msaTier = input.msaTier || "secondary";

  const capOnAsk = ask > 0 ? t12NOI / ask : 0;
  const doaFlag = capOnAsk > 0 && capOnAsk < 0.05;

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
  };

  const reconstructed = reconstructBuyerNOI(input);
  const projection = projectStabilizedNOI(reconstructed);
  const matrix = computeValuationMatrix(projection);
  const marketCap = computeMarketCap(msaTier);
  const tiers = computePriceTiers(projection, marketCap);
  const verdict = computeVerdict(ask, tiers);
  const comps = buildCompGrid(input.state, ask, nrsf);

  return {
    snapshot,
    reconstructed,
    projection,
    matrix,
    marketCap,
    msaTier,
    tiers,
    verdict,
    comps,
    generatedAt: new Date().toISOString(),
  };
}
