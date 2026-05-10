// buyerLensProfiles.test.js — PS Lens + buyer-profile pipeline tests.

import {
  PS_LENS,
  EXR_LENS,
  CUBE_LENS,
  SMA_LENS,
  GENERIC_LENS,
  BUYER_LENSES,
  BUYER_LENS_ORDER,
  DEFAULT_BUYER_KEY,
  getBuyerLens,
  computeLensMarketCap,
  computeBuyerLens,
} from "./buyerLensProfiles";
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
    // Display ticker is neutralized for REIT-level disclosure discipline.
    // Internal key stays "PS" so code paths still resolve.
    expect(PS_LENS.ticker).toBe("INST");
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
    expect(psLens.lens.ticker).toBe("INST");
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
    // capBasis is rendered to user — neutralized to "Institutional" language
    expect(psLens.lens.capBasis).toContain("Institutional");
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

// ══════════════════════════════════════════════════════════════════════════
// Multi-buyer lens registry — EXR + CUBE + SMA + GENERIC profiles
// ══════════════════════════════════════════════════════════════════════════

describe("BUYER_LENSES registry — multi-buyer activation", () => {
  test("registry contains all 5 active lenses (PS + EXR + CUBE + SMA + GENERIC)", () => {
    expect(BUYER_LENSES.PS).toBe(PS_LENS);
    expect(BUYER_LENSES.EXR).toBe(EXR_LENS);
    expect(BUYER_LENSES.CUBE).toBe(CUBE_LENS);
    expect(BUYER_LENSES.SMA).toBe(SMA_LENS);
    expect(BUYER_LENSES.GENERIC).toBe(GENERIC_LENS);
  });

  test("BUYER_LENS_ORDER lists keys in display order", () => {
    expect(BUYER_LENS_ORDER).toEqual(["PS", "EXR", "CUBE", "SMA", "GENERIC"]);
  });

  test("DEFAULT_BUYER_KEY is PS (Reza pitch flagship)", () => {
    expect(DEFAULT_BUYER_KEY).toBe("PS");
  });

  test("getBuyerLens returns correct lens for each key", () => {
    expect(getBuyerLens("PS")).toBe(PS_LENS);
    expect(getBuyerLens("EXR")).toBe(EXR_LENS);
    expect(getBuyerLens("CUBE")).toBe(CUBE_LENS);
    expect(getBuyerLens("SMA")).toBe(SMA_LENS);
    expect(getBuyerLens("GENERIC")).toBe(GENERIC_LENS);
  });

  test("getBuyerLens falls back to PS_LENS for unknown keys", () => {
    expect(getBuyerLens("UNKNOWN")).toBe(PS_LENS);
    expect(getBuyerLens(null)).toBe(PS_LENS);
    expect(getBuyerLens(undefined)).toBe(PS_LENS);
    expect(getBuyerLens("")).toBe(PS_LENS);
  });
});

describe("EXR_LENS profile constants", () => {
  test("calibrated to FY2025 10-K disclosed metrics", () => {
    expect(EXR_LENS.benchmarks.realizedRentPerOccSF).toBe(19.91);
    expect(EXR_LENS.benchmarks.moveInRatePerOccSF).toBe(13.16);
    expect(EXR_LENS.benchmarks.ecriPremium).toBe(0.513);
    expect(EXR_LENS.benchmarks.discountPctOfRevenue).toBe(0.021);
    expect(EXR_LENS.benchmarks.avgOccupancy).toBe(0.926);
  });

  test("NOI margin lower than PSA (71.2% vs 75.14%)", () => {
    expect(EXR_LENS.benchmarks.sameStoreNOIMargin).toBeLessThan(PS_LENS.benchmarks.sameStoreNOIMargin);
    expect(EXR_LENS.benchmarks.sameStoreNOIMargin).toBeCloseTo(0.7120, 3);
  });

  test("brand premium lower than PSA (5% vs 12%)", () => {
    expect(EXR_LENS.revenueAdjustment).toBe(1.05);
    expect(EXR_LENS.revenueAdjustment).toBeLessThan(PS_LENS.revenueAdjustment);
  });

  test("self-managed (no third-party mgmt fee)", () => {
    expect(EXR_LENS.expenseOverrides.mgmtFeePctEGI).toBe(0);
  });

  test("higher payroll cost than PSA (6.2% vs 3.4%)", () => {
    expect(EXR_LENS.expenseOverrides.payrollPctRev).toBeGreaterThan(PS_LENS.expenseOverrides.payrollPctRev);
  });

  test("acquisition caps wider than PSA on tertiary (7.25% vs 7.0%)", () => {
    expect(EXR_LENS.capByMSATier.tertiary).toBeCloseTo(0.0725, 4);
    expect(EXR_LENS.capByMSATier.tertiary).toBeGreaterThan(PS_LENS.capByMSATier.tertiary);
  });
});

describe("CUBE_LENS profile constants", () => {
  test("calibrated to FY2025 10-K disclosed metrics", () => {
    expect(CUBE_LENS.benchmarks.realizedRentPerOccSF).toBe(22.73);
    expect(CUBE_LENS.benchmarks.avgOccupancy).toBe(0.886);
    expect(CUBE_LENS.benchmarks.impliedDiscountPct).toBe(0.36);
  });

  test("NOI margin similar to EXR (71.0%)", () => {
    expect(CUBE_LENS.benchmarks.sameStoreNOIMargin).toBeCloseTo(0.7100, 3);
  });

  test("brand premium narrowest among self-managed REITs (4%)", () => {
    expect(CUBE_LENS.revenueAdjustment).toBe(1.04);
    expect(CUBE_LENS.revenueAdjustment).toBeLessThan(EXR_LENS.revenueAdjustment);
  });

  test("higher marketing spend than PSA + EXR (promo intensity)", () => {
    expect(CUBE_LENS.expenseOverrides.marketingPctRev).toBeGreaterThan(PS_LENS.expenseOverrides.marketingPctRev);
    expect(CUBE_LENS.expenseOverrides.marketingPctRev).toBeGreaterThan(EXR_LENS.expenseOverrides.marketingPctRev);
  });
});

describe("SMA_LENS profile constants", () => {
  test("smallest NOI margin among major REITs (66.9%)", () => {
    expect(SMA_LENS.benchmarks.sameStoreNOIMargin).toBeCloseTo(0.669, 3);
    expect(SMA_LENS.benchmarks.sameStoreNOIMargin).toBeLessThan(CUBE_LENS.benchmarks.sameStoreNOIMargin);
  });

  test("highest dev YOC target (8.5% — small-cap cost of capital)", () => {
    expect(SMA_LENS.benchmarks.devYOCTarget).toBe(0.085);
    expect(SMA_LENS.benchmarks.devYOCTarget).toBeGreaterThan(PS_LENS.benchmarks.devYOCTarget);
  });

  test("higher G&A overhead than larger REITs", () => {
    expect(SMA_LENS.expenseOverrides.gaPctRev).toBeGreaterThan(PS_LENS.expenseOverrides.gaPctRev);
    expect(SMA_LENS.expenseOverrides.gaPctRev).toBeGreaterThan(EXR_LENS.expenseOverrides.gaPctRev);
  });
});

describe("GENERIC_LENS profile constants", () => {
  test("third-party-managed — pays 5.5% mgmt fee", () => {
    expect(GENERIC_LENS.expenseOverrides.mgmtFeePctEGI).toBe(0.055);
  });

  test("no brand premium", () => {
    expect(GENERIC_LENS.revenueAdjustment).toBe(1.0);
  });

  test("no portfolio-fit bonus (no operating platform)", () => {
    expect(GENERIC_LENS.portfolioFitBonus.capReductionBps).toBe(0);
  });

  test("highest dev YOC target among non-small-cap (9.0% — third-party capital cost)", () => {
    expect(GENERIC_LENS.benchmarks.devYOCTarget).toBe(0.09);
  });

  test("no max distance constraint (no portfolio coverage requirement)", () => {
    expect(GENERIC_LENS.hardGates.maxDistanceToPSFamilyMiles).toBeNull();
  });
});

describe("computeBuyerLens — multi-lens routing", () => {
  test("each lens produces a distinct stabilized cap on the same input", () => {
    const ps = computeBuyerLens(baseInput, PS_LENS);
    const exr = computeBuyerLens(baseInput, EXR_LENS);
    const cube = computeBuyerLens(baseInput, CUBE_LENS);
    const sma = computeBuyerLens(baseInput, SMA_LENS);
    const generic = computeBuyerLens(baseInput, GENERIC_LENS);

    // PSA has lowest target cap (most aggressive on Class A secondary)
    expect(ps.marketCap).toBeLessThanOrEqual(exr.marketCap);
    expect(ps.marketCap).toBeLessThanOrEqual(cube.marketCap);
    // SMA + GENERIC have widest target caps (highest cost of capital)
    expect(sma.marketCap).toBeGreaterThanOrEqual(ps.marketCap);
    expect(generic.marketCap).toBeGreaterThanOrEqual(ps.marketCap);
  });

  test("lens metadata exposes devYOCTarget for YOC verdict card", () => {
    const ps = computeBuyerLens(baseInput, PS_LENS);
    const sma = computeBuyerLens(baseInput, SMA_LENS);
    expect(ps.lens.devYOCTarget).toBe(0.08);
    expect(sma.lens.devYOCTarget).toBe(0.085);
    // Lens block also surfaces benchmarks for the dashboard YOC card
    expect(ps.lens.sameStoreNOIMargin).toBe(0.7514);
    expect(ps.lens.acqCapByMSATier.top30).toBe(0.06);
  });

  test("lens metadata includes citation footnote for audit trail", () => {
    const exr = computeBuyerLens(baseInput, EXR_LENS);
    expect(exr.lens.citationFootnote).toMatch(/0001289490-26-000011/);
    const cube = computeBuyerLens(baseInput, CUBE_LENS);
    expect(cube.lens.citationFootnote).toMatch(/0001298675-26-000010/);
  });

  test("GENERIC lens applies 5.5% mgmt fee (compresses NOI margin)", () => {
    const ps = computeBuyerLens(baseInput, PS_LENS);
    const generic = computeBuyerLens(baseInput, GENERIC_LENS);
    // Generic lens should reconstruct LOWER NOI than PS lens on same input
    // (mgmt fee 5.5% of EGI is real cost PS doesn't pay)
    expect(generic.reconstructed.buyerNOI).toBeLessThan(ps.reconstructed.buyerNOI);
  });
});
