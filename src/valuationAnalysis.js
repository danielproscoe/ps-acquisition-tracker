// valuationAnalysis.js — Storvex (self-storage) institutional analysis helpers.
// Pure functions. No DOM. No React. Used by reports.js sec-CAP section.
//
// Design source: docs/CAPSTONE_DESIGN_SPEC.md (signed off 4/16/26)
//
// All assumptions traceable to primary sources:
//  - PSA FY2025 10-K (portfolio operating metrics, ECRI, acquisition cap)
//  - EXR FY2025 10-K (revenue management, stabilized occupancy)
//  - CUBE / LSI / NSA 10-Ks (regional submarket rents)
//  - Green Street Q1 2026 Self-Storage Sector Report (cap rates)
//  - Cushman & Wakefield Self-Storage Market Report (transaction comps)
//  - SSA Global (unit mix, absorption benchmarks)
//  - RSMeans Q1 2026 regional construction cost indices

// ══════════════════════════════════════════════════════════════════════════
// PSA / EXR / CUBE / NSA 10-K CALIBRATED CONSTANTS
// ══════════════════════════════════════════════════════════════════════════

export const STORAGE = {
  // Stabilized same-store occupancy — PSA FY2025 10-K + EXR portfolio avg
  STABILIZED_OCCUPANCY: 0.910,
  // ECRI — Existing Customer Rent Increase on rolled tenants (PSA discloses avg 6-10% annualized)
  ECRI_RATE: 0.080,
  // Street rate bump on new customers (PSA / EXR market revenue mgmt)
  STREET_BUMP: 0.035,
  // Acquisition / exit cap — Green Street Q1 2026 Self-Storage Sector Report
  EXIT_CAP: 0.0575,
  // Self-storage acquisition cap rate for class-A institutional (PSA + EXR 10-K acquisition activity)
  ACQ_CAP: 0.056,
  // PS / storage REIT IC development YOC hurdle
  YOC_HURDLE: 0.085,
  // Management fee on EGI — PSA 10-K self-management disclosure; 3rd-party mgmt ~5-6%
  MGMT_FEE_PCT: 0.06,
  // Property tax as % of revenue — PSA 10-K operating expense detail FY2025
  PROP_TAX_PCT_REV: 0.085,
  // Insurance / payroll / R&M / marketing / admin blended — per PSA/EXR 10-K opex ratios
  OPEX_RATIO_REV: 0.35,
  // Construction cost — one-story non-climate all-in (shell + site + tech)
  CONSTRUCTION_PER_SF_ONESTORY: 95,
  CONSTRUCTION_PER_SF_MULTISTORY: 160,
};

// Lease-up schedule — storage ramps slower than retail.
// Source: SSA Global absorption benchmarks + PSA development actuals.
export const LEASEUP_RAMP = {
  1: 0.45,
  2: 0.75,
  // Y3+ stabilized at portfolio avg (91%)
};

// Inflation / escalator schedule
export const INFLATION = {
  RE_TAX: 0.020,
  INSURANCE: 0.030,   // Hardening market — REIS 2025
  PAYROLL: 0.035,
  UTILITIES: 0.025,
  MARKETING: 0.025,
  CPI: 0.025,
};

// ══════════════════════════════════════════════════════════════════════════
// IRR — Newton-Raphson with bisection fallback
// ══════════════════════════════════════════════════════════════════════════

export function computeIRR(cashflows, guess = 0.10) {
  if (!Array.isArray(cashflows) || cashflows.length < 2) return NaN;
  const signs = new Set(cashflows.filter((x) => x !== 0).map((x) => Math.sign(x)));
  if (signs.size < 2) return NaN;

  const npv = (rate) =>
    cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);
  const npvPrime = (rate) =>
    cashflows.reduce((acc, cf, t) => acc - (t * cf) / Math.pow(1 + rate, t + 1), 0);

  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const v = npv(rate);
    if (Math.abs(v) < 1e-6) return rate;
    const d = npvPrime(rate);
    if (Math.abs(d) < 1e-10) break;
    const next = rate - v / d;
    if (!isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-8) return next;
    rate = next;
  }
  let lo = -0.99, hi = 10;
  let vLo = npv(lo), vHi = npv(hi);
  if (vLo * vHi > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const vMid = npv(mid);
    if (Math.abs(vMid) < 1e-6) return mid;
    if (vMid * vLo < 0) { hi = mid; vHi = vMid; }
    else { lo = mid; vLo = vMid; }
  }
  return (lo + hi) / 2;
}

// ══════════════════════════════════════════════════════════════════════════
// DOWNSIDE / BASE / UPSIDE SCENARIOS (storage-flavored)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Generate three parallel scenarios for a storage development. Leverages the
 * existing Storvex `fin` object where possible (stabNOI, totalDevCost).
 */
export function computeScenarios(fin, opts = {}) {
  const scenarios = opts.scenarios || [
    { key: "downside", label: "Downside", prob: 0.20, rentFlex: -0.10, hardFlex: 0.10, exitCap: STORAGE.EXIT_CAP + 0.0075, stabOcc: 0.82 },
    { key: "base",     label: "Base",     prob: 0.60, rentFlex:  0.00, hardFlex:  0.00, exitCap: STORAGE.EXIT_CAP,          stabOcc: STORAGE.STABILIZED_OCCUPANCY },
    { key: "upside",   label: "Upside",   prob: 0.20, rentFlex: +0.05, hardFlex: -0.05, exitCap: STORAGE.EXIT_CAP - 0.0025, stabOcc: 0.95 },
  ];

  const baseNOI = Number(fin.stabNOI) || 0;
  const baseRev = Number(fin.stabRev) || baseNOI * 1.6;
  const baseOpEx = Math.max(0, baseRev - baseNOI);
  const baseDev = Number(fin.totalDevCost) || 0;
  const baseHard = Number(fin.totalHardCost) || baseDev * 0.65;
  const nonHardDev = Math.max(0, baseDev - baseHard);

  return scenarios.map((s) => {
    const occAdj = s.stabOcc / STORAGE.STABILIZED_OCCUPANCY;
    const revFlex = baseRev * (1 + s.rentFlex) * occAdj;
    const noiFlex = revFlex - baseOpEx;
    const hardFlex = baseHard * (1 + s.hardFlex);
    const devFlex = nonHardDev + hardFlex;
    const yoc = devFlex > 0 ? noiFlex / devFlex : 0;
    const stabValue = s.exitCap > 0 ? noiFlex / s.exitCap : 0;
    const valueCreation = stabValue - devFlex;
    const devMargin = devFlex > 0 ? valueCreation / devFlex : 0;

    const cashflows = [-devFlex];
    for (let y = 1; y < 10; y++) cashflows.push(noiFlex);
    cashflows.push(noiFlex + stabValue);
    const irr = computeIRR(cashflows);

    return { ...s, noi: noiFlex, devCost: devFlex, yoc, stabValue, valueCreation, devMargin, irr };
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SENSITIVITY — Rent × Hard Cost → Stabilized YOC
// ══════════════════════════════════════════════════════════════════════════

export function computeYOCSensitivity(fin, opts = {}) {
  const rentDeltas = opts.rentDeltas || [-0.10, 0, 0.10];
  const costDeltas = opts.costDeltas || [0.10, 0, -0.10];
  const baseNOI = Number(fin.stabNOI) || 0;
  const baseRev = Number(fin.stabRev) || baseNOI * 1.6;
  const baseOpEx = Math.max(0, baseRev - baseNOI);
  const baseDev = Number(fin.totalDevCost) || 0;
  const baseHard = Number(fin.totalHardCost) || baseDev * 0.65;
  const nonHardDev = Math.max(0, baseDev - baseHard);

  const cells = costDeltas.map((cd) =>
    rentDeltas.map((rd) => {
      const revFlex = baseRev * (1 + rd);
      const noiFlex = revFlex - baseOpEx;
      const hardFlex = baseHard * (1 + cd);
      const devFlex = nonHardDev + hardFlex;
      return devFlex > 0 ? noiFlex / devFlex : 0;
    })
  );
  return { rentDeltas, costDeltas, cells };
}

// ══════════════════════════════════════════════════════════════════════════
// SENSITIVITY — Rent × Cap Rate → Stabilized Value
// ══════════════════════════════════════════════════════════════════════════

export function computeValueSensitivity(fin, opts = {}) {
  const rentDeltas = opts.rentDeltas || [-0.10, 0, 0.10];
  const capDeltas = opts.capDeltas || [0.0075, 0, -0.0075]; // +75bps, base, -75bps (storage wider cap range)
  const baseNOI = Number(fin.stabNOI) || 0;
  const baseRev = Number(fin.stabRev) || baseNOI * 1.6;
  const baseOpEx = Math.max(0, baseRev - baseNOI);
  const baseCap = Number(opts.baseCap) || STORAGE.EXIT_CAP;

  const cells = capDeltas.map((cd) =>
    rentDeltas.map((rd) => {
      const revFlex = baseRev * (1 + rd);
      const noiFlex = revFlex - baseOpEx;
      const capFlex = baseCap + cd;
      return capFlex > 0 ? noiFlex / capFlex : 0;
    })
  );
  return { rentDeltas, capDeltas, cells, baseCap };
}

// ══════════════════════════════════════════════════════════════════════════
// LAND PRICING TRIANGULATION — 3-method convergence
// ══════════════════════════════════════════════════════════════════════════

export function computeLandTriangulation(fin, compSales = [], opts = {}) {
  const targetDevMargin = opts.targetDevMargin != null ? opts.targetDevMargin : 0.15;
  const targetYOC = opts.targetYOC != null ? opts.targetYOC : STORAGE.YOC_HURDLE;
  const exitCap = opts.exitCap != null ? opts.exitCap : STORAGE.EXIT_CAP;

  const stabNOI = Number(fin.stabNOI) || 0;
  const totalHard = Number(fin.totalHardCost) || 0;
  const soft = Number(fin.softCost) || 0;
  const carry = Number(fin.carryCosts) || 0;
  const acres = Number(fin.acres) || 0;
  const devExLand = totalHard + soft + carry;
  const stabValue = exitCap > 0 ? stabNOI / exitCap : 0;

  const method1 = (stabValue / (1 + targetDevMargin)) - devExLand;
  const method2 = targetYOC > 0 ? (stabNOI / targetYOC) - devExLand : 0;

  const validComps = Array.isArray(compSales) ? compSales.filter((c) => Number(c.pricePerAc) > 0) : [];
  const avgPerAc = validComps.length
    ? validComps.reduce((s, c) => s + Number(c.pricePerAc), 0) / validComps.length
    : 0;
  const method3 = avgPerAc * acres;

  const methodVals = [method1, method2, method3].filter((v) => isFinite(v) && v > 0);
  const avg = methodVals.length ? methodVals.reduce((a, b) => a + b, 0) / methodVals.length : 0;
  const low = methodVals.length ? Math.min(...methodVals) : 0;
  const high = methodVals.length ? Math.max(...methodVals) : 0;

  return {
    method1, method2, method3, avg, low, high,
    compsUsed: validComps.length,
    stabValue,
    avgPerAc,
    acres,
    inputs: { targetDevMargin, targetYOC, exitCap, devExLand, stabNOI },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// FINANCING SCENARIO — construction + perm debt (storage)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Storage financing convention per PSA/EXR capital strategy: higher LTC
 * (60-65%), slightly wider spreads than retail due to lease-up risk, 30-yr amort.
 */
export function computeFinancingScenario(fin, opts = {}) {
  const ltc = opts.ltc != null ? opts.ltc : 0.60;
  const constructionRate = opts.constructionRate != null ? opts.constructionRate : 0.083; // SOFR+300
  const constructionTermYrs = opts.constructionTermYrs || 3;
  const permRate = opts.permRate != null ? opts.permRate : 0.0625;
  const permAmortYrs = opts.permAmortYrs || 30;
  const holdYrs = opts.holdYrs || 10;
  const exitCap = opts.exitCap != null ? opts.exitCap : STORAGE.EXIT_CAP;

  const totalDev = Number(fin.totalDevCost) || 0;
  const constructionLoan = totalDev * ltc;
  const cashEquity = totalDev - constructionLoan;

  const constructionInterest = (constructionLoan / 2) * constructionRate * constructionTermYrs;

  const r = permRate / 12;
  const n = permAmortYrs * 12;
  const monthlyDebtService = r > 0 && n > 0
    ? (constructionLoan * r) / (1 - Math.pow(1 + r, -n))
    : 0;
  const annualDebtService = monthlyDebtService * 12;

  const stabNOI = Number(fin.stabNOI) || 0;
  const dscr = annualDebtService > 0 ? stabNOI / annualDebtService : 0;
  const cashOnCash = cashEquity > 0 ? (stabNOI - annualDebtService) / cashEquity : 0;

  const stabValue = exitCap > 0 ? stabNOI / exitCap : 0;
  const unleveredCF = [-totalDev];
  for (let y = 1; y < holdYrs; y++) unleveredCF.push(stabNOI);
  unleveredCF.push(stabNOI + stabValue);
  const unleveredIRR = computeIRR(unleveredCF);

  const remainingLoanAtExit = (() => {
    if (r <= 0) return 0;
    let bal = constructionLoan;
    for (let m = 1; m <= holdYrs * 12; m++) {
      const interest = bal * r;
      const principal = Math.max(0, monthlyDebtService - interest);
      bal = Math.max(0, bal - principal);
    }
    return bal;
  })();
  const leveredCF = [-cashEquity];
  for (let y = 1; y < holdYrs; y++) leveredCF.push(stabNOI - annualDebtService);
  leveredCF.push((stabNOI - annualDebtService) + stabValue - remainingLoanAtExit);
  const leveredIRR = computeIRR(leveredCF);

  return {
    ltc, constructionRate, constructionTermYrs, permRate, permAmortYrs, holdYrs,
    totalDev, constructionLoan, cashEquity,
    constructionInterest, annualDebtService,
    dscr, cashOnCash, unleveredIRR, leveredIRR,
    stabValue, remainingLoanAtExit,
    refiLoan: stabNOI / Math.max(0.01, permRate * 1.25),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// RISK-ADJUSTED IRR — probability-weighted scenarios with levered IRR
// ══════════════════════════════════════════════════════════════════════════

export function computeRiskAdjustedIRR(fin, opts = {}) {
  const scenarios = computeScenarios(fin, opts);
  const rows = scenarios.map((s) => {
    const scenFin = { ...fin, stabNOI: s.noi, totalDevCost: s.devCost };
    const fin1 = computeFinancingScenario(scenFin, { exitCap: s.exitCap });
    const moic = s.devCost > 0 ? (s.valueCreation + s.devCost) / s.devCost : 0;
    return { ...s, leveredIRR: fin1.leveredIRR, unleveredIRR: fin1.unleveredIRR, moic, dscr: fin1.dscr };
  });

  const probSum = rows.reduce((a, r) => a + (r.prob || 0), 0) || 1;
  const weightedLevered = rows.reduce((a, r) => a + (r.leveredIRR || 0) * (r.prob || 0), 0) / probSum;
  const weightedUnlevered = rows.reduce((a, r) => a + (r.unleveredIRR || 0) * (r.prob || 0), 0) / probSum;
  const weightedMOIC = rows.reduce((a, r) => a + (r.moic || 0) * (r.prob || 0), 0) / probSum;

  return { rows, weightedLevered, weightedUnlevered, weightedMOIC };
}
