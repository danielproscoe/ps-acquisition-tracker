// Tests for storageDemandForecast.mjs — audited component-wise storage
// demand model. Verify each coefficient flows correctly, missing-field
// fallbacks degrade confidence rather than crash, and the surplus/deficit
// signal against observed CC SPC fires correctly.

import {
  forecastStorageDemand,
  lookupLifeModeIndex,
  lookupUrbanizationIndex,
  extractRingForDemandForecast,
  US_BASELINE_SPC,
  TAPESTRY_LIFEMODE_INDEX,
  URBANIZATION_INDEX,
  STORAGE_DEMAND_COEFFICIENTS,
} from "./storageDemandForecast.mjs";

describe("lookupLifeModeIndex", () => {
  test("resolves Tapestry LifeMode code L11 → Midtown Singles · 1.40 index", () => {
    const r = lookupLifeModeIndex("L11");
    expect(r.index).toBeCloseTo(1.40, 2);
    expect(r.name).toBe("Midtown Singles");
  });

  test("resolves exact name match (case-insensitive)", () => {
    const r = lookupLifeModeIndex("midtown singles");
    expect(r.index).toBeCloseTo(1.40, 2);
  });

  test("falls back to 1.0 baseline with explanatory source when unknown", () => {
    const r = lookupLifeModeIndex("Some Unknown LifeMode");
    expect(r.index).toBe(1.0);
    expect(r.source).toMatch(/default/);
  });

  test("returns 1.0 with default flag when no input provided", () => {
    const r = lookupLifeModeIndex(null);
    expect(r.index).toBe(1.0);
    expect(r.source).toBe("default");
  });
});

describe("lookupUrbanizationIndex", () => {
  test("resolves 'Principal Urban Centers' → 1.12 (densest CBD index)", () => {
    const r = lookupUrbanizationIndex("Principal Urban Centers");
    expect(r.index).toBeCloseTo(1.12, 2);
  });

  test("resolves 'Rural' → 0.78 (lowest density)", () => {
    const r = lookupUrbanizationIndex("Rural");
    expect(r.index).toBeCloseTo(0.78, 2);
  });

  test("falls back to 1.0 suburban baseline when unknown", () => {
    const r = lookupUrbanizationIndex("Unknown Tier");
    expect(r.index).toBe(1.0);
  });
});

describe("forecastStorageDemand — fully-populated ring", () => {
  const urbanRenterRing = {
    pop: 65000,
    renterPct: 55,
    growthRatePct: 1.4,
    medianHHIncome: 82000,
    tapestryLifeMode: "Midtown Singles",        // L11 · 1.40 propensity
    tapestryUrbanization: "Urban Periphery",     // 1.06
  };

  test("produces a finite, sensible demand-per-capita above US baseline", () => {
    const r = forecastStorageDemand(urbanRenterRing);
    // Baseline 5.4 × 1.40 × 1.06 = 8.01
    // Renter uplift: max(0, 55-35) * 0.035 = 0.70
    // Growth uplift: max(0, 1.4) * 0.30 = 0.42
    // Income adj: (82000-75000)/1000 * -0.005 = -0.035
    // Total ≈ 8.01 + 0.70 + 0.42 - 0.035 ≈ 9.10 (above ceiling 12)
    expect(r.demandPerCapita).toBeGreaterThan(8.0);
    expect(r.demandPerCapita).toBeLessThan(12.0);
    expect(r.totalDemandSF).toBeGreaterThan(500_000);
    expect(r.confidence).toBe("high");
    expect(r.missingFields).toHaveLength(0);
  });

  test("renders all 4 components with formula + source", () => {
    const r = forecastStorageDemand(urbanRenterRing);
    expect(r.components).toHaveLength(4);
    const labels = r.components.map((c) => c.label);
    expect(labels).toContain("Tapestry-Adjusted Baseline");
    expect(labels).toContain("Renter Premium");
    expect(labels).toContain("Growth Premium (mover flux)");
    expect(labels).toContain("Income Adjustment");
    for (const c of r.components) {
      expect(c.formula).toBeTruthy();
      expect(c.source).toBeTruthy();
    }
  });

  test("Tapestry-adjusted baseline applies both LifeMode + Urbanization indices", () => {
    const r = forecastStorageDemand(urbanRenterRing);
    const baseline = r.components.find((c) => c.label === "Tapestry-Adjusted Baseline");
    // 5.4 × 1.40 × 1.06 ≈ 8.01
    expect(baseline.valuePerCapita).toBeCloseTo(US_BASELINE_SPC * 1.40 * 1.06, 1);
  });

  test("renter premium fires when renter share exceeds 35% baseline", () => {
    const r = forecastStorageDemand(urbanRenterRing);
    const renter = r.components.find((c) => c.label === "Renter Premium");
    expect(renter.valuePerCapita).toBeGreaterThan(0);
    // 55-35 = 20 × 0.035 = 0.70
    expect(renter.valuePerCapita).toBeCloseTo(0.70, 2);
  });

  test("growth premium fires when net growth positive", () => {
    const r = forecastStorageDemand(urbanRenterRing);
    const growth = r.components.find((c) => c.label === "Growth Premium (mover flux)");
    // 1.4 × 0.30 = 0.42
    expect(growth.valuePerCapita).toBeCloseTo(0.42, 2);
  });

  test("income adjustment is negative above $75K baseline", () => {
    const r = forecastStorageDemand(urbanRenterRing);
    const income = r.components.find((c) => c.label === "Income Adjustment");
    // (82000-75000)/1000 × -0.005 = -0.035
    expect(income.valuePerCapita).toBeCloseTo(-0.035, 3);
  });
});

describe("forecastStorageDemand — sparse / suburban / rural rings", () => {
  test("suburban owner-heavy ring produces demand near US baseline", () => {
    const r = forecastStorageDemand({
      pop: 35000,
      renterPct: 22,
      growthRatePct: 0.5,
      medianHHIncome: 95000,
      tapestryLifeMode: "Affluent Estates",       // L1 · 0.65
      tapestryUrbanization: "Suburban Periphery",  // 1.00
    });
    // 5.4 × 0.65 × 1.00 = 3.51 (floor 2.5 applied if needed)
    // Renter uplift: 0 (renterPct < 35)
    // Growth uplift: 0.15
    // Income adj: (95000-75000)/1000 × -0.005 = -0.10
    // Total ≈ 3.56
    expect(r.demandPerCapita).toBeGreaterThan(3.0);
    expect(r.demandPerCapita).toBeLessThan(5.0);
    expect(r.confidence).toBe("high");
  });

  test("rural ring with extreme low demand hits the floor", () => {
    const r = forecastStorageDemand({
      pop: 12000,
      renterPct: 18,
      growthRatePct: -0.5,
      medianHHIncome: 120000,
      tapestryLifeMode: "Rustic Outposts",         // L10 · 0.55
      tapestryUrbanization: "Rural",                // 0.78
    });
    // 5.4 × 0.55 × 0.78 = 2.32 (below floor 2.5)
    expect(r.demandPerCapita).toBeCloseTo(STORAGE_DEMAND_COEFFICIENTS.DEMAND_FLOOR_SPC, 2);
  });

  test("missing fields degrade confidence + populate missingFields array", () => {
    const r = forecastStorageDemand({ pop: 40000 });
    expect(r.confidence).toBe("low");
    expect(r.missingFields).toContain("renterPct");
    expect(r.missingFields).toContain("growthRatePct");
    expect(r.missingFields).toContain("medianHHIncome");
    expect(r.missingFields).toContain("tapestryLifeMode");
    expect(r.missingFields).toContain("tapestryUrbanization");
    // Still produces a finite demand-per-capita (uses baselines)
    expect(r.demandPerCapita).toBeGreaterThan(0);
  });

  test("empty ring still returns a valid object with low confidence", () => {
    const r = forecastStorageDemand({});
    expect(r.confidence).toBe("low");
    expect(r.totalDemandSF).toBeNull();
    expect(r.demandPerCapita).toBeGreaterThan(0);
  });
});

describe("forecastStorageDemand — surplus/deficit vs observed CC SPC", () => {
  const ring = {
    pop: 50000,
    renterPct: 45,
    growthRatePct: 1.0,
    medianHHIncome: 75000,
    tapestryLifeMode: "Midtown Singles",
    tapestryUrbanization: "Metro Cities",
  };

  test("flags UNDER-SUPPLIED when forecast demand exceeds observed CC SPC", () => {
    const r = forecastStorageDemand(ring, { currentCCSPC: 2.0 });
    expect(r.surplus).not.toBeNull();
    expect(r.surplus.signal).toMatch(/UNDER-SUPPLIED/);
    expect(r.surplus.deltaPerCapita).toBeGreaterThan(0);
  });

  test("flags OVER-SUPPLIED when forecast demand below observed CC SPC", () => {
    const r = forecastStorageDemand(ring, { currentCCSPC: 12.0 });
    expect(r.surplus).not.toBeNull();
    expect(r.surplus.signal).toMatch(/OVER-SUPPLIED/);
    expect(r.surplus.deltaPerCapita).toBeLessThan(0);
  });

  test("flags BALANCED when forecast within ±0.5 SF/capita of observed CC", () => {
    const r = forecastStorageDemand(ring);
    // Use the computed demand as the observed CC to force a balanced signal
    const r2 = forecastStorageDemand(ring, { currentCCSPC: r.demandPerCapita });
    expect(r2.surplus.signal).toMatch(/BALANCED/);
  });

  test("surplus delta SF scales with population", () => {
    const r = forecastStorageDemand(ring, { currentCCSPC: 3.0 });
    expect(typeof r.surplus.deltaSF).toBe("number");
    expect(r.surplus.deltaSF).toBeGreaterThan(0);
    // Should be roughly deltaPerCapita × pop
    expect(r.surplus.deltaSF).toBeCloseTo(r.surplus.deltaPerCapita * ring.pop, -2);
  });
});

describe("forecastStorageDemand — citations + model version", () => {
  test("emits modelVersion stamp", () => {
    const r = forecastStorageDemand({ pop: 50000, renterPct: 45 });
    expect(r.modelVersion).toBe("storvex.storageDemandForecast.v1");
  });

  test("emits at least 5 citations covering the four primary sources", () => {
    const r = forecastStorageDemand({ pop: 50000, renterPct: 45 });
    expect(Array.isArray(r.citations)).toBe(true);
    expect(r.citations.length).toBeGreaterThanOrEqual(5);
    const cite = r.citations.join(" | ");
    expect(cite).toMatch(/Self-Storage Almanac/);
    expect(cite).toMatch(/Newmark/);
    expect(cite).toMatch(/Census ACS/);
    expect(cite).toMatch(/ESRI Tapestry/);
  });

  test("coefficients sub-object echoes the active model configuration", () => {
    const r = forecastStorageDemand({ pop: 50000, renterPct: 45 });
    expect(r.coefficients.RENTER_PREMIUM_PER_PCT).toBeCloseTo(0.035);
    expect(r.coefficients.GROWTH_PREMIUM_PER_PCT).toBeCloseTo(0.30);
    expect(r.coefficients.INCOME_SLOPE_PER_K).toBeCloseTo(-0.005);
    expect(r.coefficients.RENTER_PREMIUM_SOURCE).toBeTruthy();
    expect(r.coefficients.GROWTH_PREMIUM_SOURCE).toBeTruthy();
  });
});

describe("forecastStorageDemand — coefficient override (tunability)", () => {
  test("user-supplied coefficients override defaults for sensitivity testing", () => {
    const baseline = forecastStorageDemand({
      pop: 50000, renterPct: 50, growthRatePct: 1.0, medianHHIncome: 75000,
      tapestryLifeMode: "Hometown", tapestryUrbanization: "Suburban Periphery",
    });
    const tweaked = forecastStorageDemand(
      { pop: 50000, renterPct: 50, growthRatePct: 1.0, medianHHIncome: 75000,
        tapestryLifeMode: "Hometown", tapestryUrbanization: "Suburban Periphery" },
      { coefficients: { RENTER_PREMIUM_PER_PCT: 0.08 } } // 2.3× the default
    );
    expect(tweaked.demandPerCapita).toBeGreaterThan(baseline.demandPerCapita);
  });
});

describe("extractRingForDemandForecast — site-record adapter", () => {
  test("pulls the canonical fields off a Storvex site record", () => {
    const site = {
      pop3mi: "65,000",
      renterPct3mi: "45",
      growthRate: 0.013, // 1.3% as decimal
      income3mi: "82,000",
      tapestryLifeMode3mi: "Midtown Singles",
      tapestryUrbanization3mi: "Urban Periphery",
    };
    const ring = extractRingForDemandForecast(site);
    expect(ring.pop).toBe(65000);
    expect(ring.renterPct).toBe(45);
    expect(ring.growthRatePct).toBeCloseTo(1.3, 1);
    expect(ring.medianHHIncome).toBe(82000);
    expect(ring.tapestryLifeMode).toBe("Midtown Singles");
    expect(ring.tapestryUrbanization).toBe("Urban Periphery");
  });

  test("returns null when no site object provided", () => {
    expect(extractRingForDemandForecast(null)).toBeNull();
    expect(extractRingForDemandForecast(undefined)).toBeNull();
  });
});

describe("LifeMode index completeness", () => {
  test("all 14 standard LifeMode codes present (L1-L14)", () => {
    for (let i = 1; i <= 14; i++) {
      expect(TAPESTRY_LIFEMODE_INDEX[`L${i}`]).toBeDefined();
      expect(TAPESTRY_LIFEMODE_INDEX[`L${i}`].index).toBeGreaterThan(0);
      expect(TAPESTRY_LIFEMODE_INDEX[`L${i}`].rationale).toBeTruthy();
    }
  });

  test("all 6 urbanization tiers present with explanatory rationale", () => {
    const expectedTiers = [
      "Principal Urban Centers",
      "Urban Periphery",
      "Metro Cities",
      "Suburban Periphery",
      "Semirural",
      "Rural",
    ];
    for (const tier of expectedTiers) {
      expect(URBANIZATION_INDEX[tier]).toBeDefined();
      expect(URBANIZATION_INDEX[tier].rationale).toBeTruthy();
    }
  });
});
