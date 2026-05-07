// buyerLensProfiles.test.js — PS Lens + buyer-profile pipeline tests.

import { PS_LENS, BUYER_LENSES, computeLensMarketCap, computeBuyerLens } from "./buyerLensProfiles";
import { analyzeExistingAsset, DEAL_TYPES } from "./existingAssetAnalysis";

// Standard test deal — Class A stabilized in TX secondary MSA
const baseInput = {
  name: "Test Stabilized",
  state: "TX",
  msaTier: "secondary",
  ask: 12_000_000,
  nrsf: 80_000,
  unitCount: 500,
  yearBuilt: 2018,
  physicalOcc: 0.92,
  economicOcc: 0.88,
  t12NOI: 720_000,
  t12EGI: 1_200_000,
  ccPct: 0.70,
  isManned: true,
};

describe("PS_LENS profile constants", () => {
  test("registered in BUYER_LENSES table", () => {
    expect(BUYER_LENSES.PS).toBe(PS_LENS);
    expect(PS_LENS.key).toBe("PS");
    expect(PS_LENS.ticker).toBe("PSA");
  });

  test("self-managed = $0 mgmt fee override", () => {
    expect(PS_LENS.expenseOverrides.mgmtFeePctEGI).toBe(0);
  });

  test("street rate premium midpoint of 5-15% range", () => {
    expect(PS_LENS.revenueAdjustment).toBeCloseTo(1.10, 2);
  });

  test("capByMSATier monotonic: top30 < secondary < tertiary", () => {
    const c = PS_LENS.capByMSATier;
    expect(c.top30).toBeLessThan(c.secondary);
    expect(c.secondary).toBeLessThan(c.tertiary);
  });

  test("PS caps tighter than generic STORAGE.ACQ_CAP (5.6%)", () => {
    expect(PS_LENS.capByMSATier.top30).toBeLessThan(0.056);
    expect(PS_LENS.capByMSATier.secondary).toBeLessThanOrEqual(0.056);
  });
});

describe("computeLensMarketCap", () => {
  test("returns base cap when no portfolio fit", () => {
    const r = computeLensMarketCap(PS_LENS, "secondary", null);
    expect(r.cap).toBeCloseTo(0.0540, 4);
    expect(r.portfolioFit).toBe(false);
  });

  test("applies portfolio-fit bonus when within 5 mi", () => {
    const r = computeLensMarketCap(PS_LENS, "secondary", 3);
    expect(r.portfolioFit).toBe(true);
    expect(r.cap).toBeCloseTo(0.0515, 4); // 5.40% - 25bps = 5.15%
  });

  test("no fit bonus when distance exceeds trigger", () => {
    const r = computeLensMarketCap(PS_LENS, "secondary", 8);
    expect(r.portfolioFit).toBe(false);
  });

  test("falls back to 5.6% when MSA tier unknown to lens", () => {
    const r = computeLensMarketCap(PS_LENS, "unknown-tier", null);
    expect(r.cap).toBeCloseTo(0.056, 4);
  });
});

describe("computeBuyerLens — PS vs Generic", () => {
  const generic = analyzeExistingAsset(baseInput);
  const psLens = computeBuyerLens(baseInput, PS_LENS);

  test("returns same shape as generic analysis + lens metadata", () => {
    expect(psLens.snapshot).toBeDefined();
    expect(psLens.reconstructed).toBeDefined();
    expect(psLens.projection).toBeDefined();
    expect(psLens.tiers).toBeDefined();
    expect(psLens.verdict).toBeDefined();
    expect(psLens.lens.key).toBe("PS");
    expect(psLens.lens.ticker).toBe("PSA");
  });

  test("PS opex ratio is LOWER than generic (self-managed + central)", () => {
    expect(psLens.reconstructed.opexRatio).toBeLessThan(generic.reconstructed.opexRatio);
  });

  test("PS buyer NOI is HIGHER than generic on same EGI input", () => {
    // Both lower opex AND higher revenue (10% premium) lift NOI substantially.
    expect(psLens.reconstructed.buyerNOI).toBeGreaterThan(generic.reconstructed.buyerNOI);
  });

  test("PS revenue ~10% higher than generic", () => {
    const ratio = psLens.reconstructed.egi / generic.reconstructed.egi;
    expect(ratio).toBeCloseTo(1.10, 2);
  });

  test("PS market cap is LOWER than generic for same MSA tier", () => {
    expect(psLens.marketCap).toBeLessThan(generic.marketCap);
  });

  test("PS Walk price is HIGHER than generic Walk (tighter cap × bigger NOI)", () => {
    expect(psLens.tiers.walk.price).toBeGreaterThan(generic.tiers.walk.price);
  });

  test("PS lens metadata exposes capBasis describing how cap was derived", () => {
    expect(psLens.lens.capBasis).toContain("PS");
    expect(psLens.lens.capBasis).toContain("secondary");
  });
});

describe("computeBuyerLens — portfolio-fit bonus", () => {
  test("PS Walk price higher with portfolio fit than without", () => {
    const noFit = computeBuyerLens(baseInput, PS_LENS, { nearestPortfolioMi: 12 });
    const withFit = computeBuyerLens(baseInput, PS_LENS, { nearestPortfolioMi: 2 });
    expect(withFit.tiers.walk.price).toBeGreaterThan(noFit.tiers.walk.price);
    expect(withFit.lens.portfolioFit).toBe(true);
    expect(noFit.lens.portfolioFit).toBe(false);
  });
});

describe("DEAL_TYPES — math path branching", () => {
  test("STABILIZED preserves current behavior (default)", () => {
    const stab = analyzeExistingAsset(baseInput);
    expect(stab.dealType).toBe(DEAL_TYPES.STABILIZED);
    expect(stab.tiers.homeRun.cap).toBeGreaterThan(stab.tiers.strike.cap);
  });

  test("CO-LU uses 7.0-7.5% absolute cap band (framework Step 6)", () => {
    const coluInput = {
      ...baseInput,
      dealType: DEAL_TYPES.CO_LU,
      yearBuilt: 2024,
      physicalOcc: 0.33,
      t12NOI: 200_000,
      t12EGI: 415_000,
      proFormaEGI: 733_000,
      proFormaNOI: 467_000,
    };
    const colu = analyzeExistingAsset(coluInput);
    expect(colu.dealType).toBe(DEAL_TYPES.CO_LU);
    expect(colu.tiers.walk.cap).toBeCloseTo(0.07, 4);
    expect(colu.tiers.strike.cap).toBeCloseTo(0.0725, 4);
    expect(colu.tiers.homeRun.cap).toBeCloseTo(0.075, 4);
  });

  test("CO-LU does NOT trigger DOA flag on transitional cap (3-4%)", () => {
    const coluInput = {
      ...baseInput,
      dealType: DEAL_TYPES.CO_LU,
      ask: 5_200_000,
      t12NOI: 198_000, // 3.81% cap on ask
      t12EGI: 415_000,
      proFormaEGI: 733_000,
      proFormaNOI: 467_000,
    };
    const colu = analyzeExistingAsset(coluInput);
    expect(colu.snapshot.capOnAsk).toBeLessThan(0.05);
    expect(colu.snapshot.doaFlag).toBe(false); // CO-LU exempt — Y1 is transitional
  });

  test("CO-LU Y3 NOI driven by pro forma reconstruction, not Y1 lift", () => {
    const coluInput = {
      ...baseInput,
      dealType: DEAL_TYPES.CO_LU,
      t12EGI: 415_000,
      t12NOI: 200_000,
      proFormaEGI: 733_000,
      proFormaNOI: 467_000,
    };
    const colu = analyzeExistingAsset(coluInput);
    expect(colu.proFormaReconstructed).not.toBeNull();
    // Y3 rev should match the pro forma EGI (not t12EGI × 1.11)
    expect(colu.projection.y3.rev).toBeCloseTo(colu.proFormaReconstructed.egi, 0);
  });

  test("VALUE-ADD uses wider cap band than stabilized", () => {
    const vaInput = { ...baseInput, dealType: DEAL_TYPES.VALUE_ADD, proFormaEGI: 1_400_000, proFormaNOI: 850_000 };
    const va = analyzeExistingAsset(vaInput);
    const stab = analyzeExistingAsset(baseInput);
    expect(va.tiers.homeRun.cap).toBeGreaterThan(stab.tiers.homeRun.cap);
  });
});
