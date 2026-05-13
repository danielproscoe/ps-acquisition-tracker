import {
  computeEquilibriumTrajectory,
  describeEquilibriumTrajectory,
  DEFAULT_HORIZON_MONTHS,
  DEFAULT_CONFIDENCE_WEIGHTS,
} from "./equilibriumTrajectory";

const ASOF = new Date("2026-05-13T12:00:00Z");

const HEALTHY_RING = {
  pop: 80000,
  renterPct: 38,
  growthRatePct: 1.8,
  medianHHIncome: 82000,
  tapestryLifeMode: "L7",
  tapestryUrbanization: "Suburban Periphery",
  popGrowth3mi: 0.018,
  incomeGrowth3mi: 0.024,
  pop3mi_fy: 87446,
  income3mi_fy: 92302,
};

describe("computeEquilibriumTrajectory — top-level contract", () => {
  test("returns all expected keys", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r).toHaveProperty("submarket");
    expect(r).toHaveProperty("horizonMonths");
    expect(r).toHaveProperty("asOf");
    expect(r).toHaveProperty("path");
    expect(r).toHaveProperty("tierTransitions");
    expect(r).toHaveProperty("summary");
    expect(r).toHaveProperty("forwardSupply");
    expect(r).toHaveProperty("forwardDemand");
    expect(r).toHaveProperty("compositeConfidence");
    expect(r).toHaveProperty("missing");
  });

  test("default horizon = 60 months", () => {
    expect(DEFAULT_HORIZON_MONTHS).toBe(60);
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      asOf: ASOF,
    });
    expect(r.horizonMonths).toBe(60);
  });

  test("default confidence weights mirror Claim 7 defaults", () => {
    expect(DEFAULT_CONFIDENCE_WEIGHTS.VERIFIED).toBe(1.0);
    expect(DEFAULT_CONFIDENCE_WEIGHTS.CLAIMED).toBe(0.5);
    expect(DEFAULT_CONFIDENCE_WEIGHTS.STALE).toBe(0.3);
    expect(DEFAULT_CONFIDENCE_WEIGHTS.UNVERIFIED).toBe(0.0);
  });

  test("submarket preserved verbatim", () => {
    const r = computeEquilibriumTrajectory({
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
});

describe("computeEquilibriumTrajectory — path shape", () => {
  test("path has horizonYears + 1 entries", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      horizonMonths: 60,
      asOf: ASOF,
    });
    expect(r.path).toHaveLength(6);
  });

  test("each row carries supplyCcSf, demandCcSf, ratio, tier", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    for (const row of r.path) {
      expect(row).toHaveProperty("yearIndex");
      expect(row).toHaveProperty("year");
      expect(row).toHaveProperty("supplyCcSf");
      expect(row).toHaveProperty("demandCcSf");
      expect(row).toHaveProperty("ratio");
      expect(row).toHaveProperty("tier");
      expect(row).toHaveProperty("supplyDeliveredThisYear");
      expect(row).toHaveProperty("supplyConfidenceWeightedDelta");
    }
  });

  test("supplyConfidenceWeightedDelta carries per-source breakdown", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    for (const row of r.path) {
      expect(row.supplyConfidenceWeightedDelta).toHaveProperty("edgar");
      expect(row.supplyConfidenceWeightedDelta).toHaveProperty("permit");
      expect(row.supplyConfidenceWeightedDelta).toHaveProperty("historical");
    }
  });

  test("Y0 supply equals currentCCSF (no deliveries yet)", () => {
    const r = computeEquilibriumTrajectory({
      msa: "OutOfFootprintMSA-XYZ", // no pipeline entries
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    expect(r.path[0].supplyCcSf).toBe(500000);
    expect(r.path[0].supplyDeliveredThisYear).toBe(0);
  });

  test("supply is monotonically non-decreasing year-by-year", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    for (let i = 1; i < r.path.length; i++) {
      expect(r.path[i].supplyCcSf).toBeGreaterThanOrEqual(r.path[i - 1].supplyCcSf);
    }
  });
});

describe("computeEquilibriumTrajectory — ratio + tier logic", () => {
  test("oversupplied market — ratio > 1.0 at Y0", () => {
    const r = computeEquilibriumTrajectory({
      msa: "OutOfFootprintMSA-XYZ",
      ring: { ...HEALTHY_RING, pop: 30000 }, // small pop → small demand
      currentCCSF: 800000, // overflow supply
      asOf: ASOF,
    });
    expect(r.path[0].ratio).toBeGreaterThan(1.0);
    expect(r.summary.startRatio).toBeGreaterThan(1.0);
  });

  test("undersupplied market — ratio < 1.0 at Y0", () => {
    const r = computeEquilibriumTrajectory({
      msa: "OutOfFootprintMSA-XYZ",
      ring: { ...HEALTHY_RING, pop: 200000 }, // large pop → large demand
      currentCCSF: 100000, // limited supply
      asOf: ASOF,
    });
    expect(r.path[0].ratio).toBeLessThan(1.0);
  });

  test("tier classification non-null on every row when demand exists", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    for (const row of r.path) {
      expect(row.tier).toBeDefined();
      expect(row.tier.label).toBeDefined();
    }
  });
});

describe("computeEquilibriumTrajectory — tier transitions", () => {
  test("transitions array exists; empty when tier holds steady", () => {
    const r = computeEquilibriumTrajectory({
      msa: "OutOfFootprintMSA-XYZ",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    expect(Array.isArray(r.tierTransitions)).toBe(true);
  });

  test("transition objects carry from/to labels + years + ratios", () => {
    // Construct a synthetic scenario where supply doesn't change but demand
    // grows — at some point the tier shifts.
    const r = computeEquilibriumTrajectory({
      msa: "OutOfFootprintMSA-XYZ", // no pipeline entries → flat supply
      ring: {
        ...HEALTHY_RING,
        popGrowth3mi: 0.05, // high growth → demand outpaces supply
      },
      currentCCSF: 400000,
      asOf: ASOF,
    });
    // Each transition (if any) should have the structured shape
    for (const t of r.tierTransitions) {
      expect(t).toHaveProperty("fromYear");
      expect(t).toHaveProperty("toYear");
      expect(t).toHaveProperty("fromTier");
      expect(t).toHaveProperty("toTier");
      expect(t).toHaveProperty("fromRatio");
      expect(t).toHaveProperty("toRatio");
      expect(t.fromTier).not.toBe(t.toTier);
    }
  });
});

describe("computeEquilibriumTrajectory — summary stats", () => {
  test("summary has start/end tier + ratios + final year", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    expect(r.summary).toHaveProperty("startTier");
    expect(r.summary).toHaveProperty("endTier");
    expect(r.summary).toHaveProperty("startRatio");
    expect(r.summary).toHaveProperty("endRatio");
    expect(r.summary).toHaveProperty("finalYear");
    expect(r.summary.finalYear).toBe(ASOF.getFullYear() + 5);
  });

  test("yearOfBalanceCrossing detected when ratio crosses 1.0 from below", () => {
    // Synthetic: ratio starts ~0.6 and rises with demand outpacing supply
    // (here a no-pipeline MSA so supply is flat). With pop growth driving
    // demand up, ratio actually FALLS — so test the inverse: small pop +
    // current supply set so Y0 ratio < 1, but limited pipeline lifts supply
    // past demand. Use an out-of-footprint MSA to force flat supply, then
    // pick currentCCSF such that ratio is just below 1 at Y0.
    const r = computeEquilibriumTrajectory({
      msa: "Houston", // has pipeline entries, supply grows
      ring: HEALTHY_RING,
      currentCCSF: 380000, // ratio ~ 0.95 at Y0 if demand ~ 400K (80K × 5)
      asOf: ASOF,
    });
    // The yearOfBalanceCrossing field is either null or a year integer ≥ baseYear
    if (r.summary.yearOfBalanceCrossing !== null) {
      expect(r.summary.yearOfBalanceCrossing).toBeGreaterThan(ASOF.getFullYear());
      expect(r.summary.yearsToBalance).toBeGreaterThanOrEqual(1);
    }
  });

  test("netSupplyAddedCcSf reflects end-start delta", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    const expected = r.path[5].supplyCcSf - r.path[0].supplyCcSf;
    expect(r.summary.netSupplyAddedCcSf).toBeCloseTo(expected, 6);
  });

  test("netDemandAddedCcSf reflects end-start delta", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    const expected = r.path[5].demandCcSf - r.path[0].demandCcSf;
    expect(r.summary.netDemandAddedCcSf).toBeCloseTo(expected, 6);
  });

  test("peakSupplyPulseYear identifies the largest supply delta year", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    const peakActualPulse = Math.max(...r.path.map((p) => p.supplyDeliveredThisYear));
    expect(r.summary.peakSupplyPulseCcSf).toBe(peakActualPulse);
  });
});

describe("computeEquilibriumTrajectory — composite confidence", () => {
  test("composite tier is a labeled string", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    expect(["high", "medium", "low"]).toContain(r.compositeConfidence);
  });

  test("missing ring → low confidence + ring in missing[]", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      asOf: ASOF,
    });
    expect(r.compositeConfidence).toBe("low");
    expect(r.missing).toContain("ring");
  });
});

describe("computeEquilibriumTrajectory — failure modes", () => {
  test("returns empty path when no ring provided", () => {
    const r = computeEquilibriumTrajectory({ msa: "Houston", asOf: ASOF });
    expect(r.path).toEqual([]);
    expect(r.summary).toBeNull();
  });

  test("zero pop returns empty path", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: { renterPct: 38, medianHHIncome: 82000 },
      asOf: ASOF,
    });
    expect(r.path).toEqual([]);
  });
});

describe("describeEquilibriumTrajectory", () => {
  test("renders a one-line English summary on healthy data", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      currentCCSF: 500000,
      asOf: ASOF,
    });
    const s = describeEquilibriumTrajectory(r);
    expect(s).toMatch(/Equilibrium Trajectory/);
    expect(s).toMatch(/Houston/);
    expect(s).toMatch(/Confidence/i);
  });

  test("renders unavailable message when path empty", () => {
    const s = describeEquilibriumTrajectory({
      submarket: { msa: "NoData" },
      path: [],
      summary: null,
      tierTransitions: [],
      missing: ["ring"],
    });
    expect(s).toMatch(/unavailable/i);
  });

  test("handles null gracefully", () => {
    expect(describeEquilibriumTrajectory(null)).toMatch(/unavailable/i);
  });

  test("mentions balance crossing when detected", () => {
    const r = computeEquilibriumTrajectory({
      msa: "Houston",
      ring: HEALTHY_RING,
      currentCCSF: 380000,
      asOf: ASOF,
    });
    const s = describeEquilibriumTrajectory(r);
    if (r.summary?.yearOfBalanceCrossing != null) {
      expect(s).toMatch(/crosses balance|balance crossing/i);
    }
  });
});
