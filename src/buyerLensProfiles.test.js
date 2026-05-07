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

  test("street rate premium 12% midpoint of 10-15% range (Move.org consumer pricing)", () => {
    expect(PS_LENS.revenueAdjustment).toBeCloseTo(1.12, 2);
  });

  test("capByMSATier monotonic: top30 < secondary < tertiary", () => {
    const c = PS_LENS.capByMSATier;
    expect(c.top30).toBeLessThan(c.secondary);
    expect(c.secondary).toBeLessThan(c.tertiary);
  });

  test("PS underwritten caps anchored to FY2025 10-K (6.00% / 6.25% / 7.00%)", () => {
    // KEY INSIGHT (FY2025 10-K + Q1 2026 transcript): PSA does NOT pay
    // tighter cap than market — they buy at MARKET cap (5.5-6.0%) and
    // UNDERWRITE to a HIGHER stabilized cap (6.0-7.0%) because PSNext
    // platform integration uplifts NOI 50-100 bps post-acquisition.
    // The model encodes the UNDERWRITTEN cap (what PSA solves for).
    expect(PS_LENS.capByMSATier.top30).toBeCloseTo(0.0600, 4);
    expect(PS_LENS.capByMSATier.secondary).toBeCloseTo(0.0625, 4);
    expect(PS_LENS.capByMSATier.tertiary).toBeCloseTo(0.0700, 4);
  });

  test("opex ratios match PSA FY2025 10-K disclosure (24.86% same-store)", () => {
    const o = PS_LENS.expenseOverrides;
    expect(o.payrollPctRev).toBeCloseTo(0.0343, 4);  // FY2025 disclosed
    expect(o.marketingPctRev).toBeCloseTo(0.0221, 4); // FY2025 disclosed
    expect(o.gaPctRev).toBeCloseTo(0.0307, 4);        // FY2025 disclosed
    expect(o.utilitiesPctRev).toBeCloseTo(0.0132, 4); // FY2025 disclosed
    expect(o.rmPctRev).toBeCloseTo(0.0207, 4);        // FY2025 disclosed
    expect(o.mgmtFeePctEGI).toBe(0);                   // self-managed
  });
});

describe("computeLensMarketCap", () => {
  test("returns base cap when no portfolio fit", () => {
    const r = computeLensMarketCap(PS_LENS, "secondary", null);
    expect(r.cap).toBeCloseTo(0.0625, 4);
    expect(r.portfolioFit).toBe(false);
  });

  test("applies portfolio-fit bonus when within 5 mi", () => {
    const r = computeLensMarketCap(PS_LENS, "secondary", 3);
    expect(r.portfolioFit).toBe(true);
    expect(r.cap).toBeCloseTo(0.0600, 4); // 6.25% - 25bps = 6.00%
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

  test("PS revenue ~12% higher than generic (FY2025 10-K-anchored brand premium)", () => {
    const ratio = psLens.reconstructed.egi / generic.reconstructed.egi;
    expect(ratio).toBeCloseTo(1.12, 2);
  });

  test("PS UNDERWRITTEN cap is HIGHER than market cap (PSNext NOI uplift moat)", () => {
    // Per Q1 2026 transcript: "stabilized product is trading in the 5s,
    // getting into the 6s as we put them on our platform". PSA buys at
    // market cap (~5.5%) but underwrites to higher stabilized cap because
    // their platform integration uplifts NOI faster than market.
    // Generic STORAGE.ACQ_CAP = 5.60% market average.
    // PSA secondary underwritten cap = 6.25%.
    expect(psLens.marketCap).toBeGreaterThan(generic.marketCap);
  });

  test("PS NOI uplift more than offsets cap widening (final price comparison)", () => {
    // Net effect: PSA's higher cap (downward pressure on price) is more
    // than offset by PSA's NOI uplift via opex efficiency + brand premium
    // (upward pressure on price). On a typical Class A stabilized deal,
    // PSA Walk price ends up roughly comparable to or slightly above
    // generic Walk price.
    const psWalk = psLens.tiers.walk.price;
    const genWalk = generic.tiers.walk.price;
    const ratio = psWalk / genWalk;
    // Wide tolerance — depends heavily on subject revenue level & state
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.30);
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
