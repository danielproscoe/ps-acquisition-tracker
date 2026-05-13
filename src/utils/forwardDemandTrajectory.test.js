import {
  computeForwardDemandTrajectory,
  describeForwardDemandTrajectory,
  DEFAULT_HORIZON_MONTHS,
  POST_5YR_CAGR_DECAY,
} from "./forwardDemandTrajectory";

const ASOF = new Date("2026-05-13T12:00:00Z");

// A "healthy growth-corridor suburb" — used as the default fixture for shape
// + sanity tests. Mirrors the kind of submarket PS / EXR / CUBE all chase.
const HEALTHY_RING = {
  pop: 80000,
  renterPct: 38,
  growthRatePct: 1.8,
  medianHHIncome: 82000,
  tapestryLifeMode: "L7", // Sprouting Explorers (1.20×)
  tapestryUrbanization: "Suburban Periphery", // 1.00×
  popGrowth3mi: 0.018, // 1.8%/yr CAGR
  incomeGrowth3mi: 0.024, // 2.4%/yr CAGR
  pop3mi_fy: 87446, // ≈ 80000 × (1.018)^5
  income3mi_fy: 92302, // ≈ 82000 × (1.024)^5
};

describe("computeForwardDemandTrajectory — top-level contract", () => {
  test("returns all expected keys", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r).toHaveProperty("submarket");
    expect(r).toHaveProperty("horizonMonths");
    expect(r).toHaveProperty("asOf");
    expect(r).toHaveProperty("baseline");
    expect(r).toHaveProperty("path");
    expect(r).toHaveProperty("summary");
    expect(r).toHaveProperty("confidence");
    expect(r).toHaveProperty("missing");
    expect(r).toHaveProperty("modelVersion");
    expect(r).toHaveProperty("citations");
  });

  test("default horizon = 60 months (5 years)", () => {
    expect(DEFAULT_HORIZON_MONTHS).toBe(60);
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.horizonMonths).toBe(60);
  });

  test("model version stamp is locked", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.modelVersion).toBe("storvex.forwardDemandTrajectory.v1");
  });

  test("submarket is preserved verbatim", () => {
    const r = computeForwardDemandTrajectory({
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
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("computeForwardDemandTrajectory — path shape", () => {
  test("path has horizonYears + 1 entries (Y0..YN inclusive)", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      horizonMonths: 60,
      asOf: ASOF,
    });
    expect(r.path).toHaveLength(6); // Y0..Y5
    expect(r.path[0].yearIndex).toBe(0);
    expect(r.path[5].yearIndex).toBe(5);
  });

  test("Y0 row has deltaSfVsY0 = 0", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.path[0].deltaSfVsY0).toBe(0);
    expect(r.path[0].deltaPctVsY0).toBe(0);
  });

  test("each path row has popY, medianHHIY, demandPerCapita, totalDemandSf", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    for (const row of r.path) {
      expect(row).toHaveProperty("popY");
      expect(row).toHaveProperty("medianHHIY");
      expect(row).toHaveProperty("demandPerCapita");
      expect(row).toHaveProperty("totalDemandSf");
      expect(row).toHaveProperty("deltaSfVsY0");
      expect(row).toHaveProperty("deltaPctVsY0");
    }
  });

  test("longer horizon produces longer path (10 yr → 11 rows)", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      horizonMonths: 120,
      asOf: ASOF,
    });
    expect(r.path).toHaveLength(11);
  });
});

describe("computeForwardDemandTrajectory — pop compounding", () => {
  test("pop grows year-by-year per ESRI CAGR", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    // Y0 pop = 80000; Y5 pop ≈ 80000 × 1.018^5 ≈ 87446
    expect(r.path[0].popY).toBe(80000);
    expect(r.path[5].popY).toBeGreaterThan(86000);
    expect(r.path[5].popY).toBeLessThan(89000);
    // Strictly monotonic increase with positive CAGR
    for (let i = 1; i < r.path.length; i++) {
      expect(r.path[i].popY).toBeGreaterThan(r.path[i - 1].popY);
    }
  });

  test("zero growth rate yields flat pop across horizon", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: {
        ...HEALTHY_RING,
        popGrowth3mi: 0,
        pop3mi_fy: 80000,
      },
      asOf: ASOF,
    });
    for (const row of r.path) {
      expect(row.popY).toBe(80000);
    }
  });

  test("negative growth produces declining pop curve", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Detroit",
      ring: {
        ...HEALTHY_RING,
        popGrowth3mi: -0.005, // -0.5%/yr
        pop3mi_fy: 78000, // ≈ 80000 × 0.995^5
      },
      asOf: ASOF,
    });
    expect(r.path[5].popY).toBeLessThan(r.path[0].popY);
    expect(r.summary.totalDemandGainPct).toBeLessThan(0);
  });

  test("popCAGR clamped to [-5%, +10%] to prevent runaway extrapolation", () => {
    const r1 = computeForwardDemandTrajectory({
      msa: "Outlier",
      ring: { ...HEALTHY_RING, popGrowth3mi: 0.25 }, // 25%/yr
      asOf: ASOF,
    });
    expect(r1.baseline.popCAGR).toBeLessThanOrEqual(0.10);

    const r2 = computeForwardDemandTrajectory({
      msa: "Outlier",
      ring: { ...HEALTHY_RING, popGrowth3mi: -0.20 }, // -20%/yr
      asOf: ASOF,
    });
    expect(r2.baseline.popCAGR).toBeGreaterThanOrEqual(-0.05);
  });
});

describe("computeForwardDemandTrajectory — income compounding", () => {
  test("income grows year-by-year per ESRI CAGR", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    // Y0 HHI = 82000; Y5 HHI ≈ 82000 × 1.024^5 ≈ 92302
    expect(r.path[0].medianHHIY).toBe(82000);
    expect(r.path[5].medianHHIY).toBeGreaterThan(91000);
    expect(r.path[5].medianHHIY).toBeLessThan(94000);
  });

  test("income CAGR clamped to [-5%, +15%]", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Boom",
      ring: { ...HEALTHY_RING, incomeGrowth3mi: 0.30 },
      asOf: ASOF,
    });
    expect(r.baseline.incomeCAGR).toBeLessThanOrEqual(0.15);
  });
});

describe("computeForwardDemandTrajectory — CAGR derivation fallbacks", () => {
  test("derives popCAGR from pop_fy ÷ pop ^ (1/5) − 1 when popGrowth3mi missing", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: {
        ...HEALTHY_RING,
        popGrowth3mi: undefined,
        // Provide pop_fy: 87446 ≈ 80000 × 1.018^5
      },
      asOf: ASOF,
    });
    expect(r.baseline.popCAGR).toBeCloseTo(0.018, 2);
  });

  test("derives incomeCAGR from income_fy ÷ income ^ (1/5) − 1 when incomeGrowth3mi missing", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: {
        ...HEALTHY_RING,
        incomeGrowth3mi: undefined,
        // Provide income_fy: 92302 ≈ 82000 × 1.024^5
      },
      asOf: ASOF,
    });
    expect(r.baseline.incomeCAGR).toBeCloseTo(0.024, 2);
  });

  test("growthOverrides take precedence over ring fields", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      growthOverrides: { pop: 0.05, income: 0.03 },
      asOf: ASOF,
    });
    expect(r.baseline.popCAGR).toBeCloseTo(0.05, 5);
    expect(r.baseline.incomeCAGR).toBeCloseTo(0.03, 5);
  });

  test("growthRatePct on Y0 ring used when no ESRI projection", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: {
        pop: 80000,
        renterPct: 38,
        growthRatePct: 2.0, // percent
        medianHHIncome: 82000,
        tapestryLifeMode: "L7",
        tapestryUrbanization: "Suburban Periphery",
      },
      asOf: ASOF,
    });
    expect(r.baseline.popCAGR).toBeCloseTo(0.02, 4);
  });

  test("missing both popGrowth + pop_fy holds CAGR at 0 + flags missing", () => {
    const r = computeForwardDemandTrajectory({
      msa: "NoData",
      ring: {
        pop: 80000,
        renterPct: 38,
        medianHHIncome: 82000,
      },
      asOf: ASOF,
    });
    expect(r.baseline.popCAGR).toBe(0);
    expect(r.missing).toContain("popCAGR");
  });
});

describe("computeForwardDemandTrajectory — summary stats", () => {
  test("effectiveDemandCAGR equals computed Y0 → final geometric mean", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    const expected =
      Math.pow(r.summary.finalYearTotalDemandSf / r.summary.y0TotalDemandSf, 1 / 5) - 1;
    expect(r.summary.effectiveDemandCAGR).toBeCloseTo(expected, 6);
  });

  test("totalDemandGainPct matches final-year delta computed from path", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.summary.totalDemandGainPct).toBeCloseTo(r.path[5].deltaPctVsY0, 6);
  });

  test("finalYear equals asOf year + horizonYears", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      horizonMonths: 60,
      asOf: ASOF,
    });
    expect(r.summary.finalYear).toBe(ASOF.getFullYear() + 5);
  });
});

describe("computeForwardDemandTrajectory — confidence tiers", () => {
  test("high confidence when ESRI CAGRs + Tapestry both populated", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.confidence).toBe("high");
  });

  test("medium confidence when one ESRI CAGR + Tapestry", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: {
        ...HEALTHY_RING,
        incomeGrowth3mi: undefined,
        income3mi_fy: undefined,
      },
      asOf: ASOF,
    });
    expect(["medium", "high"]).toContain(r.confidence);
  });

  test("low confidence when no ESRI projection on record", () => {
    const r = computeForwardDemandTrajectory({
      msa: "NoData",
      ring: {
        pop: 80000,
        renterPct: 38,
        medianHHIncome: 82000,
      },
      asOf: ASOF,
    });
    expect(r.confidence).toBe("low");
  });
});

describe("computeForwardDemandTrajectory — failure modes", () => {
  test("missing ring returns empty path + low confidence", () => {
    const r = computeForwardDemandTrajectory({ msa: "NoData", asOf: ASOF });
    expect(r.path).toEqual([]);
    expect(r.summary).toBeNull();
    expect(r.confidence).toBe("low");
    expect(r.missing).toContain("ring");
  });

  test("missing pop returns empty path + low confidence", () => {
    const r = computeForwardDemandTrajectory({
      msa: "NoData",
      ring: { renterPct: 38, medianHHIncome: 82000 },
      asOf: ASOF,
    });
    expect(r.path).toEqual([]);
    expect(r.summary).toBeNull();
    expect(r.missing).toContain("pop");
  });
});

describe("computeForwardDemandTrajectory — coefficients pass-through", () => {
  test("custom coefficients propagate to forecastStorageDemand each year", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      coefficients: {
        RENTER_PREMIUM_PER_PCT: 0.10, // amplified
        RENTER_BASELINE_PCT: 35,
        GROWTH_PREMIUM_PER_PCT: 0.50, // amplified
        INCOME_SLOPE_PER_K: -0.005,
        INCOME_BASELINE_HHI: 75000,
        DEMAND_FLOOR_SPC: 2.5,
        DEMAND_CEILING_SPC: 12.0,
      },
      asOf: ASOF,
    });
    // With amplified renter premium, demand-per-capita should be higher
    expect(r.path[0].demandPerCapita).toBeGreaterThan(5.4);
  });
});

describe("compoundedScalar via 10-yr horizon — POST_5YR_CAGR_DECAY behavior", () => {
  test("POST_5YR_CAGR_DECAY = 0.5 — beyond Y5, CAGR halves", () => {
    expect(POST_5YR_CAGR_DECAY).toBe(0.5);
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      horizonMonths: 120,
      asOf: ASOF,
    });
    // Y10 pop should be less than full-CAGR extrapolation 80000 × 1.018^10
    const fullCagrY10 = 80000 * Math.pow(1.018, 10);
    expect(r.path[10].popY).toBeLessThan(fullCagrY10);
    // But still greater than Y5 (decay is partial, not zero)
    expect(r.path[10].popY).toBeGreaterThan(r.path[5].popY);
  });
});

describe("describeForwardDemandTrajectory", () => {
  test("renders a one-line English summary on healthy data", () => {
    const r = computeForwardDemandTrajectory({
      msa: "Indianapolis",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    const s = describeForwardDemandTrajectory(r);
    expect(s).toMatch(/Forward Demand Trajectory/);
    expect(s).toMatch(/Indianapolis/);
    expect(s).toMatch(/Confidence/i);
    expect(s).toMatch(/CAGR/);
  });

  test("renders unavailable message when summary missing", () => {
    const s = describeForwardDemandTrajectory({
      submarket: { msa: "NoData" },
      summary: null,
      missing: ["ring"],
    });
    expect(s).toMatch(/unavailable/i);
    expect(s).toMatch(/ring/);
  });

  test("handles null gracefully", () => {
    expect(describeForwardDemandTrajectory(null)).toMatch(/unavailable/i);
  });
});
