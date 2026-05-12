import {
  computeSupplyDemandEquilibrium,
  describeEquilibrium,
  DEFAULT_EQUILIBRIUM_TIERS,
  DEFAULT_HORIZON_MONTHS,
} from "./supplyDemandEquilibrium";

const ASOF = new Date("2026-05-12T12:00:00Z");

const HEALTHY_RING = {
  pop: 80000,
  renterPct: 38,
  growthRatePct: 1.5,
  medianHHIncome: 82000,
  tapestryLifeMode: "L5",
  tapestryUrbanization: "Suburban Periphery",
};

describe("computeSupplyDemandEquilibrium — top-level shape contract", () => {
  test("returns all expected keys", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r).toHaveProperty("submarket");
    expect(r).toHaveProperty("horizonMonths");
    expect(r).toHaveProperty("asOf");
    expect(r).toHaveProperty("supplyForecast");
    expect(r).toHaveProperty("demandForecast");
    expect(r).toHaveProperty("currentCcSf");
    expect(r).toHaveProperty("totalSupplyCcSf");
    expect(r).toHaveProperty("totalDemandCcSf");
    expect(r).toHaveProperty("equilibriumRatio");
    expect(r).toHaveProperty("tier");
    expect(r).toHaveProperty("compositeConfidence");
    expect(r).toHaveProperty("missing");
  });

  test("default horizon = 24 months", () => {
    expect(DEFAULT_HORIZON_MONTHS).toBe(24);
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.horizonMonths).toBe(24);
  });

  test("explicit horizon overrides default", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      horizonMonths: 36,
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.horizonMonths).toBe(36);
  });

  test("submarket is preserved verbatim", () => {
    const r = computeSupplyDemandEquilibrium({
      city: "Houston",
      state: "TX",
      msa: "Houston",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.submarket.city).toBe("Houston");
    expect(r.submarket.state).toBe("TX");
    expect(r.submarket.msa).toBe("Houston");
  });

  test("asOf normalized to ISO string", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("computeSupplyDemandEquilibrium — upstream integration", () => {
  test("supplyForecast object always returned for valid submarket", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.supplyForecast).toBeTruthy();
    expect(r.supplyForecast).toHaveProperty("totals");
    expect(r.supplyForecast).toHaveProperty("sources");
  });

  test("demandForecast computed when ring is supplied", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.demandForecast).toBeTruthy();
    expect(r.demandForecast.totalDemandSF).toBeGreaterThan(0);
  });

  test("demandForecast null when ring is omitted", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      asOf: ASOF,
    });
    expect(r.demandForecast).toBeNull();
    expect(r.missing).toContain("ring");
  });

  test("totalSupplyCcSf = currentCcSf + forecast horizon supply", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      currentCCSF: 100000,
      asOf: ASOF,
    });
    expect(r.currentCcSf).toBe(100000);
    expect(r.totalSupplyCcSf).toBeCloseTo(
      r.currentCcSf + (r.supplyForecast?.totals?.totalForecastCcSf || 0),
      0
    );
  });

  test("currentCcSf=0 when not supplied", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.currentCcSf).toBe(0);
    expect(r.missing).toContain("currentCCSF");
  });
});

describe("computeSupplyDemandEquilibrium — equilibrium ratio", () => {
  test("ratio = supply / demand when both present", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      currentCCSF: 200000,
      asOf: ASOF,
    });
    if (r.totalDemandCcSf > 0) {
      expect(r.equilibriumRatio).toBeCloseTo(
        r.totalSupplyCcSf / r.totalDemandCcSf,
        4
      );
    }
  });

  test("ratio null when demand is null", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      asOf: ASOF,
    });
    expect(r.equilibriumRatio).toBeNull();
  });

  test("higher current supply → higher ratio (monotonic)", () => {
    const low = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      currentCCSF: 100000,
      asOf: ASOF,
    });
    const high = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      currentCCSF: 1000000,
      asOf: ASOF,
    });
    if (low.equilibriumRatio != null && high.equilibriumRatio != null) {
      expect(high.equilibriumRatio).toBeGreaterThan(low.equilibriumRatio);
    }
  });

  test("higher population (demand) → lower ratio for same supply (monotonic)", () => {
    const smallPop = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: { ...HEALTHY_RING, pop: 20000 },
      currentCCSF: 500000,
      asOf: ASOF,
    });
    const bigPop = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: { ...HEALTHY_RING, pop: 200000 },
      currentCCSF: 500000,
      asOf: ASOF,
    });
    if (smallPop.equilibriumRatio != null && bigPop.equilibriumRatio != null) {
      expect(smallPop.equilibriumRatio).toBeGreaterThan(bigPop.equilibriumRatio);
    }
  });
});

describe("computeSupplyDemandEquilibrium — tier classification", () => {
  test("tier always set (defaults to UNKNOWN when ratio is null)", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      asOf: ASOF,
    });
    expect(r.tier).toBeTruthy();
    expect(r.tier.label).toBeTruthy();
  });

  test("very low ratio classifies as SEVERELY UNDERSUPPLIED", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Nowheresville",
      state: "ZZ",
      ring: { ...HEALTHY_RING, pop: 500000 },
      currentCCSF: 0,
      asOf: ASOF,
    });
    if (r.equilibriumRatio != null && r.equilibriumRatio < 0.6) {
      expect(r.tier.label).toBe("SEVERELY UNDERSUPPLIED");
    }
  });

  test("very high ratio classifies as SATURATED", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Nowheresville",
      state: "ZZ",
      ring: { ...HEALTHY_RING, pop: 1000 },
      currentCCSF: 5000000,
      asOf: ASOF,
    });
    if (r.equilibriumRatio != null && r.equilibriumRatio > 1.75) {
      expect(r.tier.label).toBe("SATURATED");
    }
  });

  test("tier band thresholds are monotonic", () => {
    let lastMax = 0;
    for (let i = 0; i < DEFAULT_EQUILIBRIUM_TIERS.length - 1; i++) {
      expect(DEFAULT_EQUILIBRIUM_TIERS[i].maxRatio).toBeGreaterThan(lastMax);
      lastMax = DEFAULT_EQUILIBRIUM_TIERS[i].maxRatio;
    }
    expect(DEFAULT_EQUILIBRIUM_TIERS[DEFAULT_EQUILIBRIUM_TIERS.length - 1].maxRatio).toBe(Infinity);
  });

  test("custom tiers override default", () => {
    const custom = [
      { label: "TIGHT", maxRatio: 1.0, color: "#000", note: "tight" },
      { label: "LOOSE", maxRatio: Infinity, color: "#fff", note: "loose" },
    ];
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      currentCCSF: 50000,
      asOf: ASOF,
      tiers: custom,
    });
    if (r.equilibriumRatio != null) {
      expect(["TIGHT", "LOOSE"]).toContain(r.tier.label);
    }
  });
});

describe("computeSupplyDemandEquilibrium — composite confidence", () => {
  test("compositeConfidence is one of high/medium/low", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(["high", "medium", "low"]).toContain(r.compositeConfidence);
  });

  test("missing demandForecast → cannot be high", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      asOf: ASOF,
    });
    expect(r.compositeConfidence).not.toBe("high");
  });
});

describe("describeEquilibrium — English summary", () => {
  test("describes ratio + tier when both forecasts present", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      currentCCSF: 300000,
      asOf: ASOF,
    });
    const desc = describeEquilibrium(r);
    expect(desc).toMatch(/Equilibrium/);
    expect(desc).toMatch(/Miami/);
    expect(desc).toMatch(/24-month/);
    if (r.equilibriumRatio != null) {
      expect(desc).toMatch(/ratio/);
    }
  });

  test("graceful when ratio is null", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      asOf: ASOF,
    });
    const desc = describeEquilibrium(r);
    expect(typeof desc).toBe("string");
    expect(desc).toMatch(/cannot compute/i);
  });

  test("includes tier label when ratio classifiable", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      currentCCSF: 200000,
      asOf: ASOF,
    });
    const desc = describeEquilibrium(r);
    if (r.equilibriumRatio != null) {
      expect(desc).toMatch(r.tier.label);
    }
  });

  test("includes composite confidence", () => {
    const r = computeSupplyDemandEquilibrium({
      msa: "Miami",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    const desc = describeEquilibrium(r);
    if (r.equilibriumRatio != null) {
      expect(desc).toMatch(/Composite confidence/);
    }
  });

  test("handles null input gracefully", () => {
    expect(describeEquilibrium(null)).toMatch(/unavailable/i);
  });
});

describe("DEFAULT_EQUILIBRIUM_TIERS — band integrity", () => {
  test("exactly 6 tiers covering the full ratio space", () => {
    expect(DEFAULT_EQUILIBRIUM_TIERS.length).toBe(6);
  });

  test("every tier has label / color / note / maxRatio", () => {
    for (const t of DEFAULT_EQUILIBRIUM_TIERS) {
      expect(t).toHaveProperty("label");
      expect(t).toHaveProperty("color");
      expect(t).toHaveProperty("note");
      expect(t).toHaveProperty("maxRatio");
    }
  });
});
