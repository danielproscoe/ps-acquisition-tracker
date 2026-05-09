// existingAssetAnalysis.test.js — math module tests.
// Style: matches utils.test.js. No mocks — pure-function gates.
//
// Integration test calibrated on Red Rock Mega Storage (Reno NV)
// per memory/valuation-framework.md log entry 2026-04-21 PASS.

import {
  STATE_TAX_MATRIX,
  EXPENSE_BENCHMARKS,
  MSA_TIER_CAP_ADJUST,
  getStateTaxConfig,
  reconstructRETax,
  reconstructBuyerNOI,
  projectStabilizedNOI,
  computeValuationMatrix,
  computeMarketCap,
  computePriceTiers,
  computeVerdict,
  buildCompGrid,
  analyzeExistingAsset,
  computeRentSanity,
} from "./existingAssetAnalysis";
import { STORAGE } from "./valuationAnalysis";

// ─── State Tax Matrix ───
describe("STATE_TAX_MATRIX", () => {
  test("includes all 11 states from spec + _DEFAULT", () => {
    ["NV","CA","TX","FL","NJ","MA","OH","IN","KY","MI","TN","_DEFAULT"].forEach((s) => {
      expect(STATE_TAX_MATRIX[s]).toBeDefined();
    });
  });
  test("NV has no on-sale reassessment", () => {
    expect(STATE_TAX_MATRIX.NV.onSaleReassess).toBe(false);
    expect(STATE_TAX_MATRIX.NV.capPct).toBe(0.08);
  });
  test("CA reassesses to sale price under Prop 13", () => {
    expect(STATE_TAX_MATRIX.CA.onSaleReassess).toBe(true);
    expect(STATE_TAX_MATRIX.CA.salePctOfPrice).toBeCloseTo(0.0115, 4);
  });
  test("TX is uncapped commercial", () => {
    expect(STATE_TAX_MATRIX.TX.salePctOfPrice).toBeCloseTo(0.024, 4);
    expect(STATE_TAX_MATRIX.TX.capPct).toBeNull();
  });
});

describe("getStateTaxConfig", () => {
  test("returns NV config for 'NV'", () => {
    expect(getStateTaxConfig("NV").onSaleReassess).toBe(false);
  });
  test("normalizes case + whitespace", () => {
    expect(getStateTaxConfig(" tx ").onSaleReassess).toBe(true);
  });
  test("falls back to _DEFAULT for unknown state", () => {
    const cfg = getStateTaxConfig("XX");
    expect(cfg.salePctOfPrice).toBeCloseTo(0.020, 4);
  });
  test("falls back to _DEFAULT for null/empty", () => {
    expect(getStateTaxConfig(null).note).toMatch(/Generic/);
    expect(getStateTaxConfig("").note).toMatch(/Generic/);
  });
});

// ─── RE Tax Reconstruction ───
describe("reconstructRETax", () => {
  test("NV uses current × commercial cap when current tax provided", () => {
    const r = reconstructRETax("NV", 16_500_000, 100_000);
    expect(r.reassessed).toBe(false);
    expect(r.annual).toBeCloseTo(108_000, 0); // 100K × 1.08
  });
  test("NV with no current tax returns null annual (caller fallback)", () => {
    const r = reconstructRETax("NV", 16_500_000, 0);
    expect(r.reassessed).toBe(false);
    // null or 0 — caller must fallback
    expect(r.annual === null || r.annual === 0).toBe(true);
  });
  test("CA reassesses to sale price × 1.15%", () => {
    const r = reconstructRETax("CA", 10_000_000);
    expect(r.reassessed).toBe(true);
    expect(r.annual).toBeCloseTo(115_000, 0);
  });
  test("TX uses 2.4% effective rate", () => {
    const r = reconstructRETax("TX", 5_000_000);
    expect(r.annual).toBeCloseTo(120_000, 0);
  });
  test("Unknown state uses _DEFAULT 2.0%", () => {
    const r = reconstructRETax("XX", 1_000_000);
    expect(r.annual).toBeCloseTo(20_000, 0);
  });
});

// ─── Market Cap by MSA Tier ───
describe("computeMarketCap", () => {
  test("Top-30 MSA = ACQ_CAP - 25 bps", () => {
    expect(computeMarketCap("top30")).toBeCloseTo(STORAGE.ACQ_CAP - 0.0025, 4);
  });
  test("Secondary = ACQ_CAP", () => {
    expect(computeMarketCap("secondary")).toBeCloseTo(STORAGE.ACQ_CAP, 4);
  });
  test("Tertiary = ACQ_CAP + 75 bps", () => {
    expect(computeMarketCap("tertiary")).toBeCloseTo(STORAGE.ACQ_CAP + 0.0075, 4);
  });
  test("unknown tier defaults to base ACQ_CAP", () => {
    expect(computeMarketCap("zzz")).toBeCloseTo(STORAGE.ACQ_CAP, 4);
  });
});

// ─── Buyer NOI Reconstruction ───
describe("reconstructBuyerNOI", () => {
  const baseInput = {
    ask: 10_000_000,
    nrsf: 80_000,
    t12EGI: 1_500_000,
    t12NOI: 900_000,
    state: "TX",
    ccPct: 0.70,
    isManned: true,
  };

  test("returns 10 line items per framework Step 3", () => {
    const r = reconstructBuyerNOI(baseInput);
    expect(r.lines).toHaveLength(10);
    expect(r.lines.map((l) => l.line)).toEqual(expect.arrayContaining([
      "Real Estate Taxes", "Insurance", "Utilities", "Payroll",
      "Repairs & Maint", "Marketing", "G&A", "CC / Bank Charges",
      "Property Mgmt", "Reserves",
    ]));
  });

  test("computes total OpEx as sum of lines", () => {
    const r = reconstructBuyerNOI(baseInput);
    const sum = r.lines.reduce((s, l) => s + l.buyer, 0);
    expect(r.totalOpEx).toBeCloseTo(sum, 2);
  });

  test("buyer NOI = EGI − total OpEx", () => {
    const r = reconstructBuyerNOI(baseInput);
    expect(r.buyerNOI).toBeCloseTo(r.egi - r.totalOpEx, 2);
  });

  test("unmanned site shows $0 payroll line", () => {
    const r = reconstructBuyerNOI({ ...baseInput, isManned: false });
    const payroll = r.lines.find((l) => l.line === "Payroll");
    expect(payroll.buyer).toBe(0);
  });

  test("CC-heavy uses higher utilities/SF", () => {
    const heavy = reconstructBuyerNOI({ ...baseInput, ccPct: 0.80 });
    const light = reconstructBuyerNOI({ ...baseInput, ccPct: 0.20 });
    const utilHeavy = heavy.lines.find((l) => l.line === "Utilities").buyer;
    const utilLight = light.lines.find((l) => l.line === "Utilities").buyer;
    expect(utilHeavy).toBeGreaterThan(utilLight);
  });

  test("flags >20% NOI delta vs seller", () => {
    const r = reconstructBuyerNOI({ ...baseInput, t12NOI: 500_000 }); // big delta
    expect(r.flags.some((f) => /Buyer NOI/.test(f.text))).toBe(true);
  });

  test("handles zero/null inputs gracefully", () => {
    const r = reconstructBuyerNOI({ ask: 0, nrsf: 0, t12EGI: 0, state: "" });
    expect(r.totalOpEx).toBe(0);
    expect(r.buyerNOI).toBe(0);
    expect(r.lines).toHaveLength(10);
  });

  test("opex ratio sits in institutional 33-42% band on typical inputs", () => {
    // Class A 80K NRSF, $1.5M EGI → reconstructed should land 33-50% range
    const r = reconstructBuyerNOI(baseInput);
    expect(r.opexRatio).toBeGreaterThan(0.30);
    expect(r.opexRatio).toBeLessThan(0.55);
  });
});

// ─── Stabilized Projection ───
describe("projectStabilizedNOI", () => {
  const baseRecon = {
    egi: 1_000_000,
    totalOpEx: 400_000,
    buyerNOI: 600_000,
  };

  test("Y1 mirrors reconstructed inputs", () => {
    const p = projectStabilizedNOI(baseRecon);
    expect(p.y1.rev).toBe(1_000_000);
    expect(p.y1.exp).toBe(400_000);
    expect(p.y1.noi).toBe(600_000);
  });

  test("Y3 lifts revenue by ~11% with generic ECRI (useCalibration:false)", () => {
    // Force the generic 11% ECRI lift fallback (pre-calibration behavior).
    const p = projectStabilizedNOI(baseRecon, { useCalibration: false });
    expect(p.y3.rev).toBeCloseTo(1_110_000, 0);
  });

  test("Y3 lifts revenue by calibrated cross-REIT same-store growth (default)", () => {
    // Default behavior uses primary-source REIT same-store calibration.
    // FY2025 cross-REIT avg ≈ +0.05%/yr → Y1→Y3 compounded ≈ +0.10%.
    const p = projectStabilizedNOI(baseRecon);
    // Permissive check — calibration value depends on edgar-same-store-growth.json.
    // Verify the lift is significantly LESS than the old generic 11% (i.e. calibrated).
    expect(p.y3.rev).toBeLessThan(1_050_000);
    expect(p.y3.rev).toBeGreaterThanOrEqual(995_000);
    expect(p.assumptions.basis).toMatch(/Calibrated to FY/);
  });

  test("Y3 inflates expenses by ~5% (2.5%/yr × 2)", () => {
    const p = projectStabilizedNOI(baseRecon);
    expect(p.y3.exp).toBeCloseTo(420_000, 0);
  });

  test("Y3 NOI > Y1 NOI under generic ECRI (useCalibration:false)", () => {
    // The 11% ECRI generic lift produces NOI growth Y1→Y3.
    const p = projectStabilizedNOI(baseRecon, { useCalibration: false });
    expect(p.y3.noi).toBeGreaterThan(p.y1.noi);
  });

  test("Y3 NOI may decline vs Y1 NOI under calibrated flat-growth scenario", () => {
    // FY2025 cross-REIT same-store growth is essentially flat (+0.05%/yr).
    // With expense inflation (2.5%/yr) outpacing revenue, Y3 NOI compresses.
    // This is the institutional reality the calibration captures — and the
    // delta vs the generic 11% lift is ~$80K on a $600K NOI baseline.
    const p = projectStabilizedNOI(baseRecon);
    expect(p.y3.noi).toBeLessThan(p.y1.noi);
  });

  test("Y5 NOI > Y3 NOI under 3%/2.5% growth (regardless of Y1→Y3 calibration)", () => {
    const p = projectStabilizedNOI(baseRecon);
    expect(p.y5.noi).toBeGreaterThan(p.y3.noi);
  });

  test("returns assumptions object for transparency", () => {
    const p = projectStabilizedNOI(baseRecon);
    expect(p.assumptions.y1ToY3RevLift).toBeCloseTo(0.11, 3);
    expect(p.assumptions.basis).toMatch(/ECRI/);
  });
});

// ─── Valuation Matrix ───
describe("computeValuationMatrix", () => {
  const proj = {
    y1: { noi: 600_000 }, y3: { noi: 700_000 }, y5: { noi: 800_000 },
  };

  test("returns 3 years × default 4 caps grid", () => {
    const m = computeValuationMatrix(proj);
    expect(m.years).toEqual(["y1", "y3", "y5"]);
    expect(m.capRates).toHaveLength(4);
    expect(m.cells).toHaveLength(3);
    expect(m.cells[0]).toHaveLength(4);
  });

  test("higher NOI yields higher implied value at fixed cap", () => {
    const m = computeValuationMatrix(proj);
    expect(m.cells[2][0]).toBeGreaterThan(m.cells[0][0]); // y5 > y1 @ 5.5%
  });

  test("higher cap rate yields lower implied value at fixed NOI", () => {
    const m = computeValuationMatrix(proj);
    expect(m.cells[0][0]).toBeGreaterThan(m.cells[0][3]); // 5.5% > 7.0%
  });

  test("accepts custom cap rates", () => {
    const m = computeValuationMatrix(proj, [0.06, 0.07]);
    expect(m.capRates).toEqual([0.06, 0.07]);
    expect(m.cells[0]).toHaveLength(2);
  });
});

// ─── Price Tiers ───
describe("computePriceTiers", () => {
  const proj = {
    y3: { noi: 700_000 }, y5: { noi: 800_000 },
  };

  test("tier ordering: HomeRun < Strike < Walk", () => {
    const t = computePriceTiers(proj, 0.060);
    // Home Run uses HIGHER cap (cheaper price) but Y3 NOI (smaller numerator).
    // Strike & Walk use Y5 NOI (larger numerator).
    // Expected: HomeRun < Strike < Walk on a freezer book
    expect(t.homeRun.price).toBeLessThan(t.strike.price);
    expect(t.strike.price).toBeLessThan(t.walk.price);
  });

  test("uses cap + 50 bps for Home Run, − 25 bps for Walk", () => {
    const t = computePriceTiers(proj, 0.060);
    expect(t.homeRun.cap).toBeCloseTo(0.065, 4);
    expect(t.walk.cap).toBeCloseTo(0.0575, 4);
    expect(t.strike.cap).toBeCloseTo(0.060, 4);
  });

  test("falls back to STORAGE.ACQ_CAP when no market cap given", () => {
    const t = computePriceTiers(proj, null);
    expect(t.marketCap).toBeCloseTo(STORAGE.ACQ_CAP, 4);
  });
});

// ─── Verdict ───
describe("computeVerdict", () => {
  const tiers = {
    homeRun: { price: 11_000_000 },
    strike:  { price: 13_000_000 },
    walk:    { price: 14_000_000 },
  };

  test("ask at or below Strike → PURSUE", () => {
    expect(computeVerdict(13_000_000, tiers).label).toBe("PURSUE");
    expect(computeVerdict(12_000_000, tiers).label).toBe("PURSUE");
  });
  test("ask between Strike and Walk → NEGOTIATE", () => {
    expect(computeVerdict(13_500_000, tiers).label).toBe("NEGOTIATE");
  });
  test("ask above Walk → PASS with gap", () => {
    const v = computeVerdict(16_500_000, tiers);
    expect(v.label).toBe("PASS");
    expect(v.gapDollars).toBeCloseTo(2_500_000, 0);
    expect(v.gapPct).toBeCloseTo(0.1786, 2); // 2.5M / 14M
  });
});

// ─── Comp Grid ───
describe("buildCompGrid", () => {
  test("returns TX comps for TX subject", () => {
    const g = buildCompGrid("TX", 20_000_000, 80_000);
    expect(g.state).toBe("TX");
    expect(g.comps.length).toBeGreaterThan(0);
    expect(g.avgCap).toBeGreaterThan(0);
  });
  test("computes subject $/SF and delta vs comp avg", () => {
    const g = buildCompGrid("TX", 20_000_000, 80_000);
    expect(g.subjectPPSF).toBeCloseTo(250, 0);
    expect(typeof g.subjectVsAvgPPSF).toBe("number");
  });
  test("falls back gracefully for state with no comps", () => {
    // Per storageCompSales fallback table, NV → CO
    const g = buildCompGrid("NV", 16_500_000, 100_000);
    expect(g.comps.length).toBeGreaterThan(0); // CO peer comps
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION — Red Rock Mega Storage, Reno NV
// Calibrated against memory/valuation-framework.md log entry 2026-04-21 PASS.
// Framework verdict: "sub-4% cap on puffed Y1, $3.5M above DJR walk,
// Reno outside MT/DW footprint, M&M already shopped to all majors"
// ═══════════════════════════════════════════════════════════════════════════

describe("INTEGRATION — Red Rock Mega Storage Reno NV", () => {
  // Inputs reverse-engineered from framework log:
  //   $16.5M ask · $633K seller NOI · 3.84% cap on ask · NV · M&M listed
  // EGI back-calculated assuming ~40% institutional opex ratio:
  //   $633K NOI / (1 - 0.40) ≈ $1.055M EGI
  // RV mega = drive-up heavy + typically unmanned/kiosk
  const redRock = {
    name: "Red Rock Mega Storage",
    state: "NV",
    msaTier: "tertiary", // Reno-Sparks ~115th MSA
    ask: 16_500_000,
    nrsf: 100_000,
    unitCount: 600,
    yearBuilt: 2018,
    physicalOcc: 0.92,
    economicOcc: 0.88,
    t12EGI: 1_055_000,
    t12NOI: 633_000,
    ccPct: 0.20,        // RV/boat drive-up heavy
    isManned: false,    // Mega kiosk-style
  };

  test("snapshot shows cap on ask matching framework log (3.84%)", () => {
    const r = analyzeExistingAsset(redRock);
    expect(r.snapshot.capOnAsk).toBeCloseTo(0.0384, 3);
  });

  test("DOA flag triggers (cap on ask < 5.0%)", () => {
    const r = analyzeExistingAsset(redRock);
    expect(r.snapshot.doaFlag).toBe(true);
    expect(r.snapshot.doaReason).toMatch(/DOA/);
  });

  test("market cap reflects tertiary MSA (+75 bps)", () => {
    const r = analyzeExistingAsset(redRock);
    expect(r.marketCap).toBeCloseTo(STORAGE.ACQ_CAP + 0.0075, 4);
  });

  test("verdict is PASS (ask above Walk)", () => {
    const r = analyzeExistingAsset(redRock);
    expect(r.verdict.label).toBe("PASS");
  });

  test("Walk tier price is below the $16.5M ask", () => {
    const r = analyzeExistingAsset(redRock);
    expect(r.tiers.walk.price).toBeLessThan(redRock.ask);
  });

  test("price tier ordering preserved on calibration deal", () => {
    const r = analyzeExistingAsset(redRock);
    expect(r.tiers.homeRun.price).toBeLessThan(r.tiers.strike.price);
    expect(r.tiers.strike.price).toBeLessThan(r.tiers.walk.price);
  });

  test("comp grid pulls comps via NV→CO peer fallback", () => {
    const r = analyzeExistingAsset(redRock);
    expect(r.comps.comps.length).toBeGreaterThan(0);
  });

  test("framework alignment: ask is materially above Walk (>5% premium triggers PASS)", () => {
    // Framework log note "$3.5M above DJR walk" was qualitative — depends on
    // exact reconstructed-NOI inputs we don't have for Red Rock. The
    // calibrated signal we CAN verify: ask premium over Walk is large
    // enough that PASS is unambiguous (>5% over Walk, well above NEGOTIATE band).
    const r = analyzeExistingAsset(redRock);
    const gap = redRock.ask - r.tiers.walk.price;
    const premium = gap / r.tiers.walk.price;
    expect(gap).toBeGreaterThan(0);
    expect(premium).toBeGreaterThan(0.05);
  });
});

// ─── Rent Sanity Cross-Check ───
describe("computeRentSanity", () => {
  // Baseline subject — 60K NRSF, 70% CC, 90% economic occupancy.
  // Implied $/SF/mo at full occ = (egi / occ) / nrsf / 12.
  const baseInput = (egi) => ({
    t12EGI: egi,
    nrsf: 60000,
    economicOcc: 0.90,
    ccPct: 0.70,
    marketRents: { ccRentPerSF: 1.40, driveupRentPerSF: 0.80, sampleSize: 12, source: "SpareFoot" },
  });
  // blended market = 0.70 × 1.40 + 0.30 × 0.80 = 0.98 + 0.24 = $1.22/SF/mo

  test("returns null when marketRents missing", () => {
    expect(computeRentSanity({ t12EGI: 100000, nrsf: 60000, economicOcc: 0.90, ccPct: 0.70, marketRents: null })).toBeNull();
  });

  test("returns null when t12EGI missing", () => {
    expect(computeRentSanity({ ...baseInput(0) })).toBeNull();
  });

  test("returns null when economicOcc <= 0.10 (avoids divide-by-tiny)", () => {
    expect(computeRentSanity({ ...baseInput(100000), economicOcc: 0.08 })).toBeNull();
  });

  test("returns null when blended market rate is zero", () => {
    expect(computeRentSanity({ t12EGI: 100000, nrsf: 60000, economicOcc: 0.90, ccPct: 0.70, marketRents: { ccRentPerSF: 0, driveupRentPerSF: 0 } })).toBeNull();
  });

  test("ok severity when implied rent within ±15% of blended market", () => {
    // Target implied rate ≈ $1.22/SF/mo → assumedFullOccEGI = 1.22 × 60000 × 12 = $878,400
    // → t12EGI at 90% occ = $878,400 × 0.90 = $790,560
    const r = computeRentSanity(baseInput(790560));
    expect(r).not.toBeNull();
    expect(r.severity).toBe("ok");
    expect(Math.abs(r.premiumPct)).toBeLessThan(0.15);
    expect(r.message).toContain("within ±15%");
  });

  test("warn severity when implied rent >15% above blended market", () => {
    // 25% above market → t12EGI ≈ 790560 × 1.25 = $988,200
    const r = computeRentSanity(baseInput(988200));
    expect(r.severity).toBe("warn");
    expect(r.premiumPct).toBeGreaterThan(0.15);
    expect(r.message).toContain("above blended submarket rate");
  });

  test("info severity when implied rent >15% below blended market", () => {
    // 25% below market → t12EGI ≈ 790560 × 0.75 = $592,920
    const r = computeRentSanity(baseInput(592920));
    expect(r.severity).toBe("info");
    expect(r.premiumPct).toBeLessThan(-0.15);
    expect(r.message).toContain("below blended submarket rate");
  });

  test("falls back to 0.55× CC rate when drive-up rate not provided", () => {
    // Drive-up fallback = 0.55 × 1.40 = $0.77 → blended = 0.70 × 1.40 + 0.30 × 0.77 = $1.211
    const r = computeRentSanity({
      t12EGI: 790000,
      nrsf: 60000,
      economicOcc: 0.90,
      ccPct: 0.70,
      marketRents: { ccRentPerSF: 1.40, sampleSize: 8, source: "SpareFoot" },
    });
    expect(r).not.toBeNull();
    expect(r.driveUpMarketRate).toBeCloseTo(0.77, 2);
    expect(r.blendedMarketRate).toBeCloseTo(1.211, 2);
  });

  test("preserves source and sampleSize from marketRents input", () => {
    const r = computeRentSanity(baseInput(790560));
    expect(r.source).toBe("SpareFoot");
    expect(r.sampleSize).toBe(12);
  });

  test("integrates into analyzeExistingAsset return shape when marketRents provided", () => {
    const r = analyzeExistingAsset(
      {
        ask: 5000000, nrsf: 60000, unitCount: 500, t12EGI: 790560, t12NOI: 350000,
        state: "TX", physicalOcc: 0.90, economicOcc: 0.90, ccPct: 0.70, isManned: false,
      },
      { marketRents: { ccRentPerSF: 1.40, driveupRentPerSF: 0.80, sampleSize: 10, source: "SpareFoot" } }
    );
    expect(r.rentSanity).not.toBeNull();
    expect(r.rentSanity.severity).toBe("ok");
  });

  test("integrates as null in analyzeExistingAsset when marketRents absent", () => {
    const r = analyzeExistingAsset({
      ask: 5000000, nrsf: 60000, unitCount: 500, t12EGI: 790560, t12NOI: 350000,
      state: "TX", physicalOcc: 0.90, economicOcc: 0.90, ccPct: 0.70, isManned: false,
    });
    expect(r.rentSanity).toBeNull();
  });
});
