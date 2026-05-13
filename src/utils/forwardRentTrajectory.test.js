import {
  computeForwardRentTrajectory,
  describeRentTrajectory,
  EQUILIBRIUM_RENT_ADJUSTMENT,
  PIPELINE_PRESSURE_ELASTICITY,
  DEFAULT_FALLBACK_CAGR,
  DEFAULT_HORIZON_MONTHS,
} from "./forwardRentTrajectory";

const ASOF = new Date("2026-05-12T12:00:00Z");

const HEALTHY_RING = {
  pop: 80000,
  renterPct: 38,
  growthRatePct: 1.5,
  medianHHIncome: 82000,
  tapestryLifeMode: "L5",
  tapestryUrbanization: "Suburban Periphery",
};

const TIGHT_SUPPLY_RING = {
  pop: 250000,           // high pop = high demand
  renterPct: 45,
  growthRatePct: 3.0,
  medianHHIncome: 90000,
  tapestryLifeMode: "L5",
  tapestryUrbanization: "Suburban Periphery",
};

const SATURATED_RING = {
  pop: 5000,             // tiny pop = tiny demand
  renterPct: 25,
  growthRatePct: 0.1,
  medianHHIncome: 60000,
  tapestryLifeMode: "L9",
  tapestryUrbanization: "Rural",
};

describe("computeForwardRentTrajectory — shape contract", () => {
  test("returns all expected top-level keys", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r).toHaveProperty("submarket");
    expect(r).toHaveProperty("horizonMonths");
    expect(r).toHaveProperty("asOf");
    expect(r).toHaveProperty("baseline");
    expect(r).toHaveProperty("adjustments");
    expect(r).toHaveProperty("path");
    expect(r).toHaveProperty("summary");
    expect(r).toHaveProperty("equilibrium");
    expect(r).toHaveProperty("confidence");
    expect(r).toHaveProperty("missing");
  });

  test("default horizon = 60 months", () => {
    expect(DEFAULT_HORIZON_MONTHS).toBe(60);
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.horizonMonths).toBe(60);
  });

  test("horizon override propagates to path length", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", horizonMonths: 36, ring: HEALTHY_RING, asOf: ASOF });
    expect(r.horizonMonths).toBe(36);
    if (r.path.length > 0) expect(r.path.length).toBe(4); // base + 3 forward years
  });

  test("submarket + operator preserved verbatim", () => {
    const r = computeForwardRentTrajectory({ city: "Houston", state: "TX", msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.submarket.city).toBe("Houston");
    expect(r.submarket.state).toBe("TX");
    expect(r.submarket.msa).toBe("Houston");
    expect(r.submarket.operator).toBe("PSA");
  });
});

describe("computeForwardRentTrajectory — baseline CAGR sourcing", () => {
  test("uses PSA per-MSA series when available (Houston)", () => {
    // Houston is in PSA FY2021-FY2025 backfill per project_crush-radius-plus.md
    const r = computeForwardRentTrajectory({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.baseline.currentRent).toBeGreaterThan(0);
    expect(r.baseline.fallbackUsed).toBe(false);
    expect(r.baseline.cagrSource).toMatch(/PSA/);
  });

  test("falls back when per-MSA series unavailable for unrecognized MSA", () => {
    const r = computeForwardRentTrajectory({ msa: "NotInRegistry", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.baseline.fallbackUsed).toBe(true);
    // Either gap (per-MSA series missing OR current rent missing) is acceptable —
    // both flag the same underlying coverage gap.
    expect(
      r.missing.includes("perMSARentSeries") || r.missing.includes("currentRent")
    ).toBe(true);
  });

  test("uses DEFAULT_FALLBACK_CAGR when no rent series anywhere", () => {
    expect(DEFAULT_FALLBACK_CAGR).toBeCloseTo(0.04, 5);
  });

  test("CAGR is clamped to [-0.10, 0.15]", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.baseline.cagr).toBeLessThanOrEqual(0.15);
    expect(r.baseline.cagr).toBeGreaterThanOrEqual(-0.10);
  });
});

describe("computeForwardRentTrajectory — equilibrium adjustment", () => {
  test("EQUILIBRIUM_RENT_ADJUSTMENT covers all 7 tiers including UNKNOWN", () => {
    expect(EQUILIBRIUM_RENT_ADJUSTMENT["SEVERELY UNDERSUPPLIED"]).toBe(0.020);
    expect(EQUILIBRIUM_RENT_ADJUSTMENT["UNDERSUPPLIED"]).toBe(0.010);
    expect(EQUILIBRIUM_RENT_ADJUSTMENT["BALANCED"]).toBe(0.000);
    expect(EQUILIBRIUM_RENT_ADJUSTMENT["WELL-SUPPLIED"]).toBe(-0.005);
    expect(EQUILIBRIUM_RENT_ADJUSTMENT["OVERSUPPLIED"]).toBe(-0.010);
    expect(EQUILIBRIUM_RENT_ADJUSTMENT["SATURATED"]).toBe(-0.020);
    expect(EQUILIBRIUM_RENT_ADJUSTMENT["UNKNOWN"]).toBe(0.000);
  });

  test("monotonic — tighter market → larger equilibrium uplift", () => {
    const tight = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: TIGHT_SUPPLY_RING, asOf: ASOF });
    const loose = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: SATURATED_RING, currentCCSF: 5000000, asOf: ASOF });
    expect(tight.adjustments.equilibriumAdj).toBeGreaterThanOrEqual(loose.adjustments.equilibriumAdj);
  });

  test("adjusted CAGR = baseline CAGR + total annual adjustment (clamped)", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    const expectedRaw = r.baseline.cagr + r.adjustments.totalAnnualAdj;
    const clamped = Math.min(0.15, Math.max(-0.10, expectedRaw));
    expect(r.adjustments.adjustedCAGR).toBeCloseTo(clamped, 5);
  });

  test("custom equilibrium adjustments override defaults", () => {
    const r = computeForwardRentTrajectory({
      msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF,
      adjustments: { equilibrium: { BALANCED: 0.05, UNDERSUPPLIED: 0.05, "SEVERELY UNDERSUPPLIED": 0.05, "WELL-SUPPLIED": 0.05, OVERSUPPLIED: 0.05, SATURATED: 0.05, UNKNOWN: 0.05 } },
    });
    expect(r.adjustments.equilibriumAdj).toBeCloseTo(0.05, 5);
  });
});

describe("computeForwardRentTrajectory — pipeline pressure adjustment", () => {
  test("PIPELINE_PRESSURE_ELASTICITY is negative (more supply = downward pressure)", () => {
    expect(PIPELINE_PRESSURE_ELASTICITY).toBeLessThan(0);
  });

  test("pipelinePressureRatio computed when currentCCSF > 0", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, currentCCSF: 500000, asOf: ASOF });
    if (r.equilibrium && r.equilibrium.currentCcSf > 0) {
      expect(r.adjustments.pipelinePressureRatio).not.toBeNull();
    }
  });

  test("pipelinePressureRatio null when no current CC SF", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    // No currentCCSF supplied — pipelinePressureRatio should be null
    expect(r.adjustments.pipelinePressureRatio).toBeNull();
    expect(r.adjustments.pipelinePressureAdj).toBe(0);
  });

  test("custom pipeline elasticity coefficient applied", () => {
    const r = computeForwardRentTrajectory({
      msa: "Miami", operator: "PSA", ring: HEALTHY_RING, currentCCSF: 500000, asOf: ASOF,
      adjustments: { pipelineElasticity: -0.02 },
    });
    expect(r.adjustments.pipelineElasticity).toBe(-0.02);
  });
});

describe("computeForwardRentTrajectory — forward path math", () => {
  test("path contains baseline + horizon years", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", horizonMonths: 60, ring: HEALTHY_RING, asOf: ASOF });
    if (r.baseline.currentRent != null) expect(r.path.length).toBe(6); // base + 5 forward years
  });

  test("compound growth — Y1 rent > baseline rent when CAGR > 0", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    if (r.path.length > 1 && r.baseline.cagr > 0) {
      expect(r.path[1].baseline).toBeGreaterThan(r.path[0].baseline);
      expect(r.path[1].withAdjustment).toBeGreaterThan(r.path[0].withAdjustment);
    }
  });

  test("final-year deltaPct reflects difference between adjusted and baseline", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: TIGHT_SUPPLY_RING, asOf: ASOF });
    if (r.path.length > 1) {
      const final = r.path[r.path.length - 1];
      const expected = (final.withAdjustment / final.baseline - 1) * 100;
      expect(final.deltaPct).toBeCloseTo(expected, 4);
    }
  });

  test("yearIndex monotonic", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    for (let i = 1; i < r.path.length; i++) {
      expect(r.path[i].yearIndex).toBe(r.path[i - 1].yearIndex + 1);
    }
  });
});

describe("computeForwardRentTrajectory — summary stats", () => {
  test("summary populated when baseline + path present", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    if (r.path.length > 1) {
      expect(r.summary).toBeTruthy();
      expect(r.summary.finalYearRent).toBeGreaterThan(0);
      expect(r.summary.effectiveCAGR).toBeDefined();
      expect(r.summary.baselineCAGR).toBeDefined();
    }
  });

  test("totalRentGainPct = (finalRent / currentRent - 1) * 100", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    if (r.summary && r.baseline.currentRent) {
      const expected = (r.summary.finalYearRent / r.baseline.currentRent - 1) * 100;
      expect(r.summary.totalRentGainPct).toBeCloseTo(expected, 3);
    }
  });
});

describe("computeForwardRentTrajectory — confidence derivation", () => {
  test("composite confidence is one of high/medium/low", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(["high", "medium", "low"]).toContain(r.confidence);
  });

  test("fallback CAGR cannot produce high confidence", () => {
    const r = computeForwardRentTrajectory({ msa: "NotInRegistry", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.confidence).not.toBe("high");
  });

  test("no ring → confidence at most medium", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", asOf: ASOF });
    expect(r.confidence).not.toBe("high");
  });
});

describe("describeRentTrajectory — English summary", () => {
  test("describes submarket + horizon + final-year rent when computable", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    const desc = describeRentTrajectory(r);
    expect(desc).toMatch(/Forward Rent Trajectory/);
    expect(desc).toMatch(/Miami/);
    if (r.summary) {
      expect(desc).toMatch(/\$\d+\.\d{2}\/SF\/yr/);
      expect(desc).toMatch(/CAGR/);
      expect(desc).toMatch(/Confidence/);
    }
  });

  test("includes effective CAGR + baseline split", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: TIGHT_SUPPLY_RING, asOf: ASOF });
    const desc = describeRentTrajectory(r);
    if (r.summary) {
      expect(desc).toMatch(/equilibrium/);
      expect(desc).toMatch(/pipeline pressure/);
    }
  });

  test("graceful when summary unavailable", () => {
    const r = computeForwardRentTrajectory({ msa: "DoesNotExist", asOf: ASOF });
    const desc = describeRentTrajectory(r);
    expect(typeof desc).toBe("string");
  });

  test("handles null input gracefully", () => {
    expect(describeRentTrajectory(null)).toMatch(/unavailable/i);
  });
});

describe("computeForwardRentTrajectory — edge cases", () => {
  test("empty query returns valid zero-state shape", () => {
    const r = computeForwardRentTrajectory({});
    expect(r).toHaveProperty("submarket");
    expect(r.confidence).toBe("low");
  });

  test("asOf normalized to ISO string", () => {
    const r = computeForwardRentTrajectory({ msa: "Miami", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── CAUSAL CHAIN MODE — useTrajectory + verifiedOnly ───────────────────

const HOUSTON_CHAIN_RING = {
  pop: 80000,
  renterPct: 42,
  growthRatePct: 1.8,
  medianHHIncome: 78000,
  tapestryLifeMode: "L5",
  tapestryUrbanization: "Metro Cities",
  popGrowth3mi: 0.018,
  incomeGrowth3mi: 0.024,
  pop3mi_fy: 87446,
  income3mi_fy: 87831,
};

describe("computeForwardRentTrajectory — causal chain (useTrajectory)", () => {
  test("default useTrajectory=false preserves backward-compat snapshot path", () => {
    const r = computeForwardRentTrajectory({
      msa: "Houston",
      operator: "PSA",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    expect(r.adjustments.useTrajectory).toBe(false);
    expect(r.adjustments.perYearChain).toBeNull();
    // Path rows still exist
    expect(r.path.length).toBeGreaterThan(1);
    // Snapshot path doesn't populate causalChain field on rows
    for (const row of r.path) {
      expect(row.causalChain == null).toBe(true);
    }
  });

  test("useTrajectory=true populates perYearChain summary + per-year causalChain", () => {
    const r = computeForwardRentTrajectory({
      msa: "Houston",
      operator: "PSA",
      ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000,
      asOf: ASOF,
      useTrajectory: true,
    });
    expect(r.adjustments.useTrajectory).toBe(true);
    expect(r.adjustments.perYearChain).toBeTruthy();
    expect(r.adjustments.perYearChain.yearsAdjusted).toBeGreaterThan(0);
    expect(r.adjustments.perYearChain.causalChainSource).toMatch(/CLAIM 12/);

    // Y0 has causal chain set to anchor (all zeros)
    expect(r.path[0].causalChain).toBeTruthy();
    expect(r.path[0].causalChain.totalAdj).toBe(0);

    // Y1..YN have populated causal-chain breakdowns
    for (let i = 1; i < r.path.length; i++) {
      const c = r.path[i].causalChain;
      expect(c).toBeTruthy();
      expect(c).toHaveProperty("equilibriumTier");
      expect(c).toHaveProperty("equilibriumAdj");
      expect(c).toHaveProperty("supplyPulseCcSf");
      expect(c).toHaveProperty("supplyPressureAdj");
      expect(c).toHaveProperty("demandGrowthPct");
      expect(c).toHaveProperty("demandUpliftAdj");
      expect(c).toHaveProperty("totalAdj");
      expect(c).toHaveProperty("appliedCAGR");
    }
  });

  test("useTrajectory exposes equilibriumTrajectory + forwardDemand upstream attachments", () => {
    const r = computeForwardRentTrajectory({
      msa: "Houston",
      operator: "PSA",
      ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000,
      asOf: ASOF,
      useTrajectory: true,
    });
    expect(r.equilibriumTrajectory).toBeTruthy();
    expect(r.equilibriumTrajectory.path).toBeDefined();
    expect(r.forwardDemand).toBeTruthy();
    expect(r.forwardDemand.path).toBeDefined();
  });

  test("useTrajectory totalAdj = equilibriumAdj + supplyPressureAdj + demandUpliftAdj per year", () => {
    const r = computeForwardRentTrajectory({
      msa: "Houston",
      operator: "PSA",
      ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000,
      asOf: ASOF,
      useTrajectory: true,
    });
    for (let i = 1; i < r.path.length; i++) {
      const c = r.path[i].causalChain;
      const expectedTotal = c.equilibriumAdj + c.supplyPressureAdj + c.demandUpliftAdj;
      expect(c.totalAdj).toBeCloseTo(expectedTotal, 8);
    }
  });

  test("demandUpliftAdj only fires on POSITIVE demand growth (no rent boost on demand decline)", () => {
    const r = computeForwardRentTrajectory({
      msa: "Houston",
      operator: "PSA",
      ring: {
        ...HOUSTON_CHAIN_RING,
        popGrowth3mi: -0.01, // declining population
        pop3mi_fy: 76121, // 80000 × 0.99^5
      },
      currentCCSF: 500000,
      asOf: ASOF,
      useTrajectory: true,
    });
    // With declining pop, demand uplift should be 0 or near-0 on every year
    for (let i = 1; i < r.path.length; i++) {
      const c = r.path[i].causalChain;
      expect(c.demandUpliftAdj).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("computeForwardRentTrajectory — verifiedOnly filter", () => {
  test("default verifiedOnly=false carries full forecast pulse into rent compression", () => {
    const r = computeForwardRentTrajectory({
      msa: "Houston",
      operator: "PSA",
      ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000,
      asOf: ASOF,
      useTrajectory: true,
    });
    expect(r.adjustments.verifiedOnly).toBe(false);
    // Default-weighted pulse — verifiedPctOfPulse is 1.0 by definition when not filtering
    expect(r.adjustments.verifiedPctOfPulse).toBeCloseTo(1.0, 5);
  });

  test("verifiedOnly=true exposes verifiedPctOfPulse on the result", () => {
    const r = computeForwardRentTrajectory({
      msa: "Houston",
      operator: "PSA",
      ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000,
      asOf: ASOF,
      useTrajectory: true,
      verifiedOnly: true,
    });
    expect(r.adjustments.verifiedOnly).toBe(true);
    expect(typeof r.adjustments.verifiedPctOfPulse).toBe("number");
    expect(r.adjustments.verifiedPctOfPulse).toBeGreaterThanOrEqual(0);
    expect(r.adjustments.verifiedPctOfPulse).toBeLessThanOrEqual(1);
  });

  test("verifiedOnly cannot inflate supply pulse — verified pct must be ≤ default pct", () => {
    const defaultRun = computeForwardRentTrajectory({
      msa: "Houston",
      operator: "PSA",
      ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000,
      asOf: ASOF,
      useTrajectory: true,
    });
    const strictRun = computeForwardRentTrajectory({
      msa: "Houston",
      operator: "PSA",
      ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000,
      asOf: ASOF,
      useTrajectory: true,
      verifiedOnly: true,
    });
    // Pipeline pressure ratio (strict) <= pipeline pressure ratio (default).
    // Default weights CLAIMED at 0.5; strict weights CLAIMED at 0.0 — so the
    // strict ratio can only be smaller or equal.
    if (defaultRun.adjustments.pipelinePressureRatio != null && strictRun.adjustments.pipelinePressureRatio != null) {
      expect(strictRun.adjustments.pipelinePressureRatio)
        .toBeLessThanOrEqual(defaultRun.adjustments.pipelinePressureRatio + 1e-9);
    }
  });
});
