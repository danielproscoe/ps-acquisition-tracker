import {
  computeUnderwritingConfidence,
  describeUnderwritingConfidence,
  DEFAULT_URC_WEIGHTS,
  DEFAULT_URC_GRADES,
} from "./underwritingConfidence";

const ASOF = new Date("2026-05-12T12:00:00Z");

const HEALTHY_RING = {
  pop: 80000,
  renterPct: 38,
  growthRatePct: 1.5,
  medianHHIncome: 82000,
  tapestryLifeMode: "L5",
  tapestryUrbanization: "Suburban Periphery",
};

const STRONG_GROWTH_RING = {
  pop: 200000,
  renterPct: 45,
  growthRatePct: 3.5,
  medianHHIncome: 95000,
  tapestryLifeMode: "L5",
  tapestryUrbanization: "Suburban Periphery",
};

describe("computeUnderwritingConfidence — shape contract", () => {
  test("returns all expected top-level keys", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r).toHaveProperty("submarket");
    expect(r).toHaveProperty("horizonMonths");
    expect(r).toHaveProperty("asOf");
    expect(r).toHaveProperty("compositeScore");
    expect(r).toHaveProperty("grade");
    expect(r).toHaveProperty("gradeConfidence");
    expect(r).toHaveProperty("subScores");
    expect(r).toHaveProperty("upstream");
    expect(r).toHaveProperty("diligenceItems");
    expect(r).toHaveProperty("weights");
    expect(r).toHaveProperty("missing");
  });

  test("subScores has all 6 sub-score keys", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.subScores).toHaveProperty("forwardSupply");
    expect(r.subScores).toHaveProperty("equilibrium");
    expect(r.subScores).toHaveProperty("forwardRent");
    expect(r.subScores).toHaveProperty("demand");
    expect(r.subScores).toHaveProperty("sourceDiversity");
    expect(r.subScores).toHaveProperty("auditCompleteness");
  });

  test("each sub-score has score + confidence + note + weight + weighted", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    for (const ss of Object.values(r.subScores)) {
      expect(ss).toHaveProperty("score");
      expect(ss).toHaveProperty("confidence");
      expect(ss).toHaveProperty("note");
      expect(ss).toHaveProperty("weight");
      expect(ss).toHaveProperty("weighted");
    }
  });
});

describe("computeUnderwritingConfidence — weights and grades", () => {
  test("DEFAULT_URC_WEIGHTS sum to 1.0", () => {
    const sum = Object.values(DEFAULT_URC_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  test("DEFAULT_URC_GRADES are monotonic-descending and cover full 0-100 range", () => {
    let lastMin = 100;
    for (const g of DEFAULT_URC_GRADES) {
      expect(g.min).toBeLessThanOrEqual(lastMin);
      lastMin = g.min;
    }
    expect(DEFAULT_URC_GRADES[DEFAULT_URC_GRADES.length - 1].min).toBe(0);
  });

  test("DEFAULT_URC_GRADES include A+ through F", () => {
    const labels = DEFAULT_URC_GRADES.map(g => g.label);
    expect(labels).toContain("A+");
    expect(labels).toContain("A");
    expect(labels).toContain("B");
    expect(labels).toContain("C");
    expect(labels).toContain("D");
    expect(labels).toContain("F");
  });

  test("each grade has color and note", () => {
    for (const g of DEFAULT_URC_GRADES) {
      expect(g).toHaveProperty("color");
      expect(g).toHaveProperty("note");
      expect(typeof g.color).toBe("string");
      expect(typeof g.note).toBe("string");
    }
  });

  test("custom weights override defaults", () => {
    const r = computeUnderwritingConfidence({
      msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF,
      weights: { forwardSupply: 1.0, equilibrium: 0, forwardRent: 0, demand: 0, sourceDiversity: 0, auditCompleteness: 0 },
    });
    expect(r.weights.forwardSupply).toBe(1.0);
  });

  test("custom grades override defaults", () => {
    const custom = [
      { min: 50, label: "PASS", color: "#fff", note: "ok" },
      { min: 0, label: "FAIL", color: "#000", note: "no" },
    ];
    const r = computeUnderwritingConfidence({
      msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF, grades: custom,
    });
    if (r.compositeScore != null) {
      expect(["PASS", "FAIL"]).toContain(r.grade.label);
    }
  });
});

describe("computeUnderwritingConfidence — composite score math", () => {
  test("composite = weighted average of sub-scores", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    if (r.compositeScore != null) {
      const weightSum = Object.values(r.weights).reduce((s, w) => s + w, 0);
      const expected = Object.values(r.subScores).reduce((s, ss) => s + ss.weighted, 0) / weightSum;
      expect(r.compositeScore).toBeCloseTo(expected, 4);
    }
  });

  test("composite score in 0-100 range", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    if (r.compositeScore != null) {
      expect(r.compositeScore).toBeGreaterThanOrEqual(0);
      expect(r.compositeScore).toBeLessThanOrEqual(100);
    }
  });

  test("grade.label matches the band for the composite score", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    if (r.compositeScore != null) {
      const expectedGrade = DEFAULT_URC_GRADES.find(g => r.compositeScore >= g.min);
      expect(r.grade.label).toBe(expectedGrade.label);
    }
  });

  test("stronger market inputs → higher composite", () => {
    const weak = computeUnderwritingConfidence({
      msa: "Houston", operator: "PSA",
      ring: { ...HEALTHY_RING, pop: 5000, growthRatePct: 0.1 },
      currentCCSF: 5000000,
      asOf: ASOF,
    });
    const strong = computeUnderwritingConfidence({
      msa: "Houston", operator: "PSA",
      ring: STRONG_GROWTH_RING,
      currentCCSF: 100000,
      asOf: ASOF,
    });
    if (weak.compositeScore != null && strong.compositeScore != null) {
      expect(strong.compositeScore).toBeGreaterThan(weak.compositeScore);
    }
  });
});

describe("computeUnderwritingConfidence — grade confidence", () => {
  test("composite confidence is one of high/medium/low", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(["high", "medium", "low"]).toContain(r.gradeConfidence);
  });

  test("no ring → many low sub-scores → cannot be high", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", asOf: ASOF });
    expect(r.gradeConfidence).not.toBe("high");
  });
});

describe("computeUnderwritingConfidence — diligence items", () => {
  test("missing ring surfaces as a diligence item", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", asOf: ASOF });
    expect(r.missing).toContain("ring");
    expect(r.diligenceItems.some(d => /Demographic ring not supplied/.test(d))).toBe(true);
  });

  test("rent fallback surfaces as diligence item", () => {
    const r = computeUnderwritingConfidence({
      msa: "NotInRegistry", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF,
    });
    if (r.upstream.rentForecast?.baseline?.fallbackUsed) {
      expect(r.diligenceItems.some(d => /Rent baseline fell back/.test(d))).toBe(true);
    }
  });

  test("audit-completeness gaps surface in diligence items", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", asOf: ASOF });
    expect(r.diligenceItems.length).toBeGreaterThan(0);
  });
});

describe("computeUnderwritingConfidence — upstream forecast integration", () => {
  test("supplyForecast computed when submarket specified", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.upstream.supplyForecast).toBeTruthy();
  });

  test("equilibrium computed when ring supplied", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.upstream.equilibrium).toBeTruthy();
  });

  test("rentForecast computed when msa supplied", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.upstream.rentForecast).toBeTruthy();
  });

  test("demandForecast computed when ring supplied", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.upstream.demandForecast).toBeTruthy();
  });
});

describe("describeUnderwritingConfidence — English summary", () => {
  test("describes grade + composite + sub-scores when all present", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    const desc = describeUnderwritingConfidence(r);
    if (r.compositeScore != null) {
      expect(desc).toMatch(/Underwriting Confidence/);
      expect(desc).toMatch(/Grade /);
      expect(desc).toMatch(/Sub-scores/);
      expect(desc).toMatch(/Houston/);
    }
  });

  test("graceful when composite is null", () => {
    const r = computeUnderwritingConfidence({ asOf: ASOF });
    const desc = describeUnderwritingConfidence(r);
    expect(typeof desc).toBe("string");
  });

  test("handles null input gracefully", () => {
    expect(describeUnderwritingConfidence(null)).toMatch(/unavailable/i);
  });
});

describe("computeUnderwritingConfidence — edge cases", () => {
  test("empty query returns valid zero-state shape", () => {
    const r = computeUnderwritingConfidence({});
    expect(r).toHaveProperty("compositeScore");
    expect(r).toHaveProperty("grade");
  });

  test("asOf normalized to ISO string", () => {
    const r = computeUnderwritingConfidence({ msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("submarket preserved verbatim", () => {
    const r = computeUnderwritingConfidence({ city: "Houston", state: "TX", msa: "Houston", operator: "PSA", ring: HEALTHY_RING, asOf: ASOF });
    expect(r.submarket.city).toBe("Houston");
    expect(r.submarket.state).toBe("TX");
    expect(r.submarket.msa).toBe("Houston");
    expect(r.submarket.operator).toBe("PSA");
  });
});

// ─── CAUSAL CHAIN INTEGRATION — Claims 11 + 12 wired into URC ────────────

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

describe("computeUnderwritingConfidence — Claims 11 + 12 trajectory integration", () => {
  test("upstream now exposes forwardDemandTrajectory + equilibriumTrajectory", () => {
    const r = computeUnderwritingConfidence({
      city: "Houston", state: "TX", msa: "Houston",
      operator: "PSA", ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000, asOf: ASOF,
    });
    expect(r.upstream).toHaveProperty("forwardDemandTrajectory");
    expect(r.upstream).toHaveProperty("equilibriumTrajectory");
    expect(r.upstream.forwardDemandTrajectory).toBeTruthy();
    expect(r.upstream.equilibriumTrajectory).toBeTruthy();
  });

  test("rent forecast is invoked with useTrajectory=true (causal chain on)", () => {
    const r = computeUnderwritingConfidence({
      city: "Houston", state: "TX", msa: "Houston",
      operator: "PSA", ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000, asOf: ASOF,
    });
    expect(r.upstream.rentForecast).toBeTruthy();
    expect(r.upstream.rentForecast.adjustments.useTrajectory).toBe(true);
  });

  test("audit-completeness check ingests new Claim 11/12 + causal-chain rows (7 total)", () => {
    const r = computeUnderwritingConfidence({
      city: "Houston", state: "TX", msa: "Houston",
      operator: "PSA", ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000, asOf: ASOF,
    });
    // Audit completeness now checks 7 engines (was 4)
    expect(r.subScores.auditCompleteness.note).toMatch(/\/7/);
  });

  test("scoreEquilibrium includes stability note when trajectory available", () => {
    const r = computeUnderwritingConfidence({
      city: "Houston", state: "TX", msa: "Houston",
      operator: "PSA", ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000, asOf: ASOF,
    });
    // Note should mention trajectory direction (degrades / improves / holds)
    expect(r.subScores.equilibrium.note).toMatch(/trajectory (degrades|improves|holds)/);
  });

  test("scoreDemand includes forward-trajectory growth note", () => {
    const r = computeUnderwritingConfidence({
      city: "Houston", state: "TX", msa: "Houston",
      operator: "PSA", ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000, asOf: ASOF,
    });
    expect(r.subScores.demand.note).toMatch(/forward demand/);
  });

  test("verifiedOnly query option propagates to rent forecast + appears in diligence when low", () => {
    const r = computeUnderwritingConfidence({
      city: "Houston", state: "TX", msa: "Houston",
      operator: "PSA", ring: HOUSTON_CHAIN_RING,
      currentCCSF: 500000, asOf: ASOF,
      verifiedOnly: true,
    });
    expect(r.upstream.rentForecast.adjustments.verifiedOnly).toBe(true);
    // If verifiedPctOfPulse < 0.5, a diligence item must surface
    if (r.upstream.rentForecast.adjustments.verifiedPctOfPulse != null
        && r.upstream.rentForecast.adjustments.verifiedPctOfPulse < 0.5) {
      const hits = r.diligenceItems.filter((d) => /verified-only filter active/i.test(d));
      expect(hits.length).toBeGreaterThanOrEqual(1);
    }
  });
});
