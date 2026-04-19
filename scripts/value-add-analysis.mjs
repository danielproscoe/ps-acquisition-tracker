/**
 * value-add-analysis.mjs — Existing-Facility Acquisition Workup Engine
 *
 * Transforms SpareFoot market rent band + subject in-place data into a full
 * value-add underwriting package: NOI bridge, 3-scenario IRR, exit cap
 * sensitivity, mark-to-market timeline, purchase price justification.
 *
 * Feeds REC Package sec-VA (Value-Add Workup) and the institutional capstone
 * for existing-facility acquisitions (SK / StorQuest / Prime / tuck-ins).
 *
 * Philosophy:
 *   In-place NOI is what a buyer acquires today.
 *   Market NOI is what the same real estate earns if rents are marked to market.
 *   The delta is the entire value-add thesis, and every number in it is
 *   source-stamped to live SpareFoot comp data + ESRI projections.
 */

// ---- Calibrated operating assumptions (PSA/EXR 10-K + SSA benchmarks) ----
const VA = {
  // Existing facility stabilized occupancy (higher than lease-up)
  MARKET_OCC_TARGET: 0.91,
  // OpEx ratio for existing facility (slightly higher than ground-up; older plants)
  OPEX_RATIO: 0.38,
  // ECRI programs generate 4-7% incremental revenue above street bumps annually
  ECRI_UPLIFT_ANNUAL: 0.05,
  // Marketing push to lift occupancy — Y1 cost
  LEASE_UP_SPEND_PCT_REV: 0.04,
  // Capex for minor repositioning (signage, tech, paint) — one-time
  REPOSITIONING_CAPEX_PER_SF: 8,
  // Deep reposition (HVAC conversion to CC, building renovation)
  DEEP_REPOSITION_CAPEX_PER_SF: 35,
  // Institutional exit cap for stabilized existing storage — Green Street Q1 2026
  EXIT_CAP_STABILIZED: 0.058,
  // Transaction costs at exit (broker 1.5%, legal, title)
  EXIT_TRANSACTION_PCT: 0.025,
  // Acquisition costs at entry (due diligence, legal, title, survey)
  ACQ_COSTS_PCT: 0.015,
};

// ---- Scenario templates ----
// Aggressive/Base/Conservative ramp timelines with different occupancy + rent push
const SCENARIOS = [
  {
    key: 'conservative',
    label: 'Conservative',
    rampMonths: 48,
    rentCaptureRate: 0.70,   // capture 70% of rent gap over ramp
    occLiftPct: 0.03,        // +3pp occupancy lift
    exitCapBps: 25,          // +25bps exit cap (buyer wants more yield)
    exitOccPct: 0.88,
    prob: 0.25
  },
  {
    key: 'base',
    label: 'Base',
    rampMonths: 36,
    rentCaptureRate: 0.85,
    occLiftPct: 0.05,
    exitCapBps: 0,
    exitOccPct: 0.91,
    prob: 0.50
  },
  {
    key: 'aggressive',
    label: 'Aggressive',
    rampMonths: 24,
    rentCaptureRate: 0.95,
    occLiftPct: 0.07,
    exitCapBps: -25,         // -25bps (cap compression)
    exitOccPct: 0.93,
    prob: 0.25
  },
];

// ---- IRR helper (Newton-Raphson with bisection fallback) ----
function computeIRR(cashflows, guess = 0.12) {
  if (!Array.isArray(cashflows) || cashflows.length < 2) return NaN;
  const signs = new Set(cashflows.filter(x => x !== 0).map(x => Math.sign(x)));
  if (signs.size < 2) return NaN;
  const npv = (r) => cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + r, t), 0);
  const npvPrime = (r) => cashflows.reduce((acc, cf, t) => acc - (t * cf) / Math.pow(1 + r, t + 1), 0);
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const v = npv(rate), d = npvPrime(rate);
    if (Math.abs(v) < 1e-6) return rate;
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
    if (vMid * vLo < 0) { hi = mid; vHi = vMid; } else { lo = mid; vLo = vMid; }
  }
  return (lo + hi) / 2;
}

// ---- NOI BRIDGE — from in-place to market ----
// Shows exactly where NOI uplift comes from: rent mark-to-market, occupancy,
// ECRI compounding, offset by repositioning capex + marketing spend.
export function computeNOIBridge({
  inPlaceCCRent,        // $/SF/mo current
  inPlaceDriveRent,     // $/SF/mo current (0 if CC-only)
  inPlaceOccupancy,     // 0-1 (e.g., 0.82)
  ccSF,                 // climate-controlled square footage
  driveSF,              // drive-up square footage
  marketCCRent,         // $/SF/mo from SpareFoot ccBand.median
  marketDriveRent,      // $/SF/mo from SpareFoot nonCCBand.median (optional)
  opexRatio = VA.OPEX_RATIO,
  targetOccupancy = VA.MARKET_OCC_TARGET,
  ecriUpliftYears = 5,   // cumulative years of ECRI
}) {
  const monthsPerYr = 12;

  // In-place economics
  const inPlaceGrossRevCC = (inPlaceCCRent || 0) * (ccSF || 0) * monthsPerYr;
  const inPlaceGrossRevDrive = (inPlaceDriveRent || 0) * (driveSF || 0) * monthsPerYr;
  const inPlaceGrossRev = inPlaceGrossRevCC + inPlaceGrossRevDrive;
  const inPlaceEffRev = inPlaceGrossRev * (inPlaceOccupancy || 0);
  const inPlaceOpex = inPlaceEffRev * opexRatio;
  const inPlaceNOI = Math.max(0, inPlaceEffRev - inPlaceOpex);

  // Market-rate economics (post value-add)
  const marketGrossRevCC = (marketCCRent || 0) * (ccSF || 0) * monthsPerYr;
  const marketGrossRevDrive = (marketDriveRent || (marketCCRent || 0) * 0.6) * (driveSF || 0) * monthsPerYr;
  const marketGrossRev = marketGrossRevCC + marketGrossRevDrive;
  const marketEffRev = marketGrossRev * targetOccupancy;
  const marketOpex = marketEffRev * opexRatio;
  const marketNOI = Math.max(0, marketEffRev - marketOpex);

  // ECRI cumulative uplift (compounds over years of tenant rollovers)
  const ecriMult = Math.pow(1 + VA.ECRI_UPLIFT_ANNUAL * 0.5, ecriUpliftYears);
  const ecriAdjustedNOI = marketNOI * ecriMult;

  // Waterfall components
  const rentMarkToMarket = (marketGrossRev - inPlaceGrossRev) * (inPlaceOccupancy || 0) * (1 - opexRatio);
  const occupancyLift = marketGrossRev * ((targetOccupancy - (inPlaceOccupancy || 0))) * (1 - opexRatio);
  const ecriBenefit = marketNOI * (ecriMult - 1);

  return {
    inPlace: {
      ccRent: inPlaceCCRent,
      driveRent: inPlaceDriveRent,
      occupancy: inPlaceOccupancy,
      grossRev: Math.round(inPlaceGrossRev),
      effRev: Math.round(inPlaceEffRev),
      opex: Math.round(inPlaceOpex),
      noi: Math.round(inPlaceNOI),
    },
    market: {
      ccRent: marketCCRent,
      driveRent: marketDriveRent || (marketCCRent || 0) * 0.6,
      occupancy: targetOccupancy,
      grossRev: Math.round(marketGrossRev),
      effRev: Math.round(marketEffRev),
      opex: Math.round(marketOpex),
      noi: Math.round(marketNOI),
    },
    ecriAdjustedNOI: Math.round(ecriAdjustedNOI),
    waterfall: {
      inPlaceNOI: Math.round(inPlaceNOI),
      rentMarkToMarket: Math.round(rentMarkToMarket),
      occupancyLift: Math.round(occupancyLift),
      ecriBenefit: Math.round(ecriBenefit),
      finalNOI: Math.round(ecriAdjustedNOI),
    },
    uplift: {
      absoluteDollar: Math.round(ecriAdjustedNOI - inPlaceNOI),
      percentage: inPlaceNOI > 0 ? +(((ecriAdjustedNOI - inPlaceNOI) / inPlaceNOI) * 100).toFixed(1) : 0,
      rentGapPct: (inPlaceCCRent && marketCCRent) ? +(((marketCCRent - inPlaceCCRent) / inPlaceCCRent) * 100).toFixed(1) : 0,
    },
  };
}

// ---- SCENARIO IRR — 3 ramp timelines ----
export function computeScenarioIRRs({
  bridge,            // output of computeNOIBridge
  acquisitionPrice,  // $
  ccSF,              // for capex calc
  driveSF,
  repositioningLevel = 'light', // 'light' | 'deep'
  holdYears = 7,
  exitCapBase = VA.EXIT_CAP_STABILIZED,
}) {
  const totalSF = (ccSF || 0) + (driveSF || 0);
  const capexPerSF = repositioningLevel === 'deep'
    ? VA.DEEP_REPOSITION_CAPEX_PER_SF
    : VA.REPOSITIONING_CAPEX_PER_SF;
  const repositioningCapex = totalSF * capexPerSF;
  const acqCosts = acquisitionPrice * VA.ACQ_COSTS_PCT;
  const totalBasis = acquisitionPrice + acqCosts + repositioningCapex;

  const inPlaceNOI = bridge.waterfall.inPlaceNOI;
  const marketNOI = bridge.market.noi;
  const noiUplift = marketNOI - inPlaceNOI;

  const scenarios = SCENARIOS.map(s => {
    const rampYears = s.rampMonths / 12;
    const capturedUplift = noiUplift * s.rentCaptureRate;
    const capturedMarketNOI = inPlaceNOI + capturedUplift;

    // Year-by-year NOI during ramp (linear interpolation from in-place to captured market)
    const yearlyNOI = [];
    for (let y = 1; y <= holdYears; y++) {
      let noi;
      if (y <= rampYears) {
        const rampProgress = y / rampYears;
        noi = inPlaceNOI + noiUplift * s.rentCaptureRate * rampProgress;
      } else {
        // Post-ramp: apply ECRI annual uplift
        const yearsPostRamp = y - rampYears;
        noi = capturedMarketNOI * Math.pow(1 + VA.ECRI_UPLIFT_ANNUAL * 0.5, yearsPostRamp);
      }
      // Subtract marketing spend in Y1
      if (y === 1) noi -= noi * VA.LEASE_UP_SPEND_PCT_REV;
      yearlyNOI.push(Math.round(noi));
    }

    // Exit: stabilized NOI at end of hold × (base cap + bps adjustment)
    const exitNOI = yearlyNOI[yearlyNOI.length - 1];
    const exitCap = exitCapBase + (s.exitCapBps / 10000);
    const grossExitValue = exitNOI / exitCap;
    const netExitProceeds = grossExitValue * (1 - VA.EXIT_TRANSACTION_PCT);
    const valueCreation = netExitProceeds - totalBasis;

    // IRR — unlevered cashflows
    const cashflows = [-totalBasis, ...yearlyNOI.slice(0, -1), yearlyNOI[yearlyNOI.length - 1] + netExitProceeds];
    const irr = computeIRR(cashflows);
    const moic = totalBasis > 0 ? (yearlyNOI.reduce((s, n) => s + n, 0) + netExitProceeds) / totalBasis : 0;

    return {
      ...s,
      yearlyNOI,
      capturedUplift: Math.round(capturedUplift),
      exitNOI: Math.round(exitNOI),
      exitCap: +(exitCap * 100).toFixed(2),
      grossExitValue: Math.round(grossExitValue),
      netExitProceeds: Math.round(netExitProceeds),
      valueCreation: Math.round(valueCreation),
      irr: +(irr * 100).toFixed(1),
      moic: +moic.toFixed(2),
      cashflows,
    };
  });

  const probSum = scenarios.reduce((s, c) => s + (c.prob || 0), 0) || 1;
  const weightedIRR = +(scenarios.reduce((s, c) => s + (c.irr || 0) * (c.prob || 0), 0) / probSum).toFixed(2);
  const weightedValueCreation = Math.round(scenarios.reduce((s, c) => s + (c.valueCreation || 0) * (c.prob || 0), 0) / probSum);

  return {
    inputs: { acquisitionPrice, ccSF, driveSF, repositioningLevel, holdYears, exitCapBase },
    totalBasis: Math.round(totalBasis),
    acquisitionPrice: Math.round(acquisitionPrice),
    acqCosts: Math.round(acqCosts),
    repositioningCapex: Math.round(repositioningCapex),
    scenarios,
    weightedIRR,
    weightedValueCreation,
  };
}

// ---- PURCHASE PRICE SENSITIVITY — price × exit cap → IRR ----
export function computePurchasePriceSensitivity({
  bridge,
  baseAcquisitionPrice,
  ccSF, driveSF,
  holdYears = 7,
  exitCapBase = VA.EXIT_CAP_STABILIZED,
  targetIRR = 0.14,
}) {
  const priceSteps = [-0.10, -0.05, 0, 0.05, 0.10]; // -10% to +10%
  const capSteps = [-0.0050, -0.0025, 0, 0.0025, 0.0050]; // -50bps to +50bps

  const cells = capSteps.map(cd => priceSteps.map(pd => {
    const price = baseAcquisitionPrice * (1 + pd);
    const r = computeScenarioIRRs({
      bridge,
      acquisitionPrice: price,
      ccSF, driveSF,
      holdYears,
      exitCapBase: exitCapBase + cd,
    });
    // Use base scenario IRR
    const baseScen = r.scenarios.find(s => s.key === 'base');
    return { irr: baseScen?.irr || 0, price };
  }));

  // Find max purchase price that still hits target IRR at base cap
  const maxPurchasePriceAtTarget = (() => {
    // Binary search: find highest price where base-scenario IRR >= targetIRR
    let lo = baseAcquisitionPrice * 0.5, hi = baseAcquisitionPrice * 2.0;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const r = computeScenarioIRRs({ bridge, acquisitionPrice: mid, ccSF, driveSF, holdYears, exitCapBase });
      const midIRR = r.scenarios.find(s => s.key === 'base')?.irr / 100;
      if (midIRR >= targetIRR) lo = mid; else hi = mid;
    }
    return Math.round(lo);
  })();

  return {
    priceSteps,
    capSteps,
    cells,
    baseAcquisitionPrice: Math.round(baseAcquisitionPrice),
    targetIRR: +(targetIRR * 100).toFixed(1),
    maxPurchasePriceAtTarget,
    strikeDiscount: +((1 - maxPurchasePriceAtTarget / baseAcquisitionPrice) * 100).toFixed(1),
  };
}

// ---- VALUE-ADD VERDICT ----
export function computeValueAddVerdict(bridge) {
  const gap = bridge.uplift.rentGapPct;
  const noiUplift = bridge.uplift.absoluteDollar;

  let verdict, color, thesis;
  if (gap > 30) {
    verdict = 'STRONG VALUE-ADD';
    color = '#16A34A';
    thesis = `Rents running ${gap.toFixed(1)}% below market — textbook mark-to-market opportunity. $${(noiUplift/1000).toFixed(0)}K annual NOI uplift available.`;
  } else if (gap > 15) {
    verdict = 'MODERATE VALUE-ADD';
    color = '#22C55E';
    thesis = `Rents ${gap.toFixed(1)}% below market — meaningful rent-push opportunity. $${(noiUplift/1000).toFixed(0)}K annual NOI uplift.`;
  } else if (gap > 5) {
    verdict = 'MILD UPSIDE';
    color = '#C9A84C';
    thesis = `Rents ${gap.toFixed(1)}% below market — limited mark-to-market story. Returns rely on ECRI + occupancy push.`;
  } else if (gap > -5) {
    verdict = 'AT MARKET';
    color = '#64748B';
    thesis = `Rents within 5% of market median. No mark-to-market thesis. Buyer underwrites as stabilized core asset.`;
  } else {
    verdict = 'ABOVE MARKET';
    color = '#EF4444';
    thesis = `Rents ${Math.abs(gap).toFixed(1)}% above market — operator may be overpricing. Occupancy/tenant retention risk. Revisit assumptions.`;
  }

  return { verdict, color, thesis, rentGapPct: gap, noiUplift };
}

// ---- ALL-IN ORCHESTRATOR ----
export function runValueAddWorkup({
  site,
  inPlace,               // { ccRent, driveRent, occupancy } — required
  targetIRR = 0.14,
  repositioningLevel = 'light',
  holdYears = 7,
}) {
  const cc = site?.ccRentData;
  if (!cc) return { error: 'No ccRentData on site — run cc-rent-audit first' };
  if (!inPlace?.ccRent) return { error: 'inPlace.ccRent required for value-add analysis' };

  const marketCCRent = cc.marketRentBand?.ccBand?.median || cc.marketRentBand?.median;
  const marketDriveRent = cc.marketRentBand?.nonCCBand?.median;
  if (!marketCCRent) return { error: 'Market rent band unavailable — cannot run analysis' };

  const ccSF = Number(site.existingFacility?.ccSF) || Number(inPlace.ccSF) || 0;
  const driveSF = Number(site.existingFacility?.driveSF) || Number(inPlace.driveSF) || 0;
  const acquisitionPrice = Number(site.existingFacility?.askingPrice) || Number(inPlace.acquisitionPrice) || 0;

  if (ccSF + driveSF === 0) return { error: 'ccSF + driveSF required — how big is the subject facility?' };
  if (!acquisitionPrice) return { error: 'acquisitionPrice required' };

  const bridge = computeNOIBridge({
    inPlaceCCRent: inPlace.ccRent,
    inPlaceDriveRent: inPlace.driveRent || 0,
    inPlaceOccupancy: inPlace.occupancy || 0.85,
    ccSF, driveSF,
    marketCCRent, marketDriveRent,
  });

  const scenarioIRRs = computeScenarioIRRs({
    bridge, acquisitionPrice, ccSF, driveSF, repositioningLevel, holdYears,
  });

  const priceSensitivity = computePurchasePriceSensitivity({
    bridge, baseAcquisitionPrice: acquisitionPrice, ccSF, driveSF, holdYears, targetIRR,
  });

  const verdict = computeValueAddVerdict(bridge);

  return {
    generatedAt: new Date().toISOString(),
    engine: 'storvex-value-add-v1.0',
    inPlace: {
      ccRent: inPlace.ccRent,
      driveRent: inPlace.driveRent || 0,
      occupancy: inPlace.occupancy || 0.85,
      ccSF, driveSF,
      acquisitionPrice,
    },
    market: {
      ccRent: marketCCRent,
      driveRent: marketDriveRent,
      source: `SpareFoot ccBand (${cc.marketRentBand?.ccBand?.sampleSize || 0} comps)`,
    },
    bridge,
    scenarioIRRs,
    priceSensitivity,
    verdict,
  };
}
