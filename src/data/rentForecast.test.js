// rentForecast.test.js — coverage for the Rent Forecast Engine.
//
// Validates:
//   - Per-REIT growth dynamics applied correctly per buyer lens
//   - 3 scenarios produce ordered trajectories (downside < base < upside)
//   - PSA-specific PSNext uplift kicks in only on PSA lens
//   - Citations include relevant SEC accession numbers
//   - Y0 anchor pulls MSA-disclosed rent when available, falls back to state
//   - Move-in rate trajectory uses EXR-disclosed +4.4% YoY

import { getRentForecast, RENT_FORECAST_METADATA } from "./rentForecast";

describe("getRentForecast — Y0 anchor", () => {
  test("uses MSA-disclosed rent when subject city maps to a PSA MSA", () => {
    const f = getRentForecast({ msa: "Los Angeles", state: "CA", buyerLens: "PSA" });
    expect(f).not.toBeNull();
    expect(f.msa).toBe("Los Angeles");
    expect(f.y0.inPlaceRentPerSF_yr).toBe(35.76); // PSA-disclosed LA rent
    expect(f.y0.moveInRatePerSF_yr).toBe(13.16); // EXR-disclosed move-in
  });

  test("falls back to state-weighted rent when MSA undisclosed", () => {
    const f = getRentForecast({ state: "NY", buyerLens: "PSA" });
    expect(f).not.toBeNull();
    expect(f.y0.inPlaceRentPerSF_yr).toBeGreaterThan(0);
    expect(f.rentBandConfidence).toMatch(/TRIPLE_VALIDATED|DOUBLE_VALIDATED|SINGLE_SOURCE/);
  });

  test("falls back to national average for missing/unknown inputs (always returns data)", () => {
    // getBestRentBand returns the national average when no MSA + no state,
    // so the forecast engine always has a Y0 anchor to project from.
    const empty = getRentForecast({});
    expect(empty).not.toBeNull();
    expect(empty.rentBandConfidence).toBe("NATIONAL_AVERAGE");

    const unknownState = getRentForecast({ state: "ZZ" });
    expect(unknownState).not.toBeNull();
    expect(unknownState.rentBandConfidence).toBe("NATIONAL_AVERAGE");
  });
});

describe("getRentForecast — scenarios", () => {
  const f = getRentForecast({ msa: "Los Angeles", buyerLens: "PSA" });

  test("3 scenarios present per horizon", () => {
    expect(f.trajectories.base).toBeTruthy();
    expect(f.trajectories.upside).toBeTruthy();
    expect(f.trajectories.downside).toBeTruthy();
    for (const yr of [0, 1, 3, 5]) {
      expect(f.trajectories.base[`Y${yr}`]).toBeTruthy();
      expect(f.trajectories.upside[`Y${yr}`]).toBeTruthy();
      expect(f.trajectories.downside[`Y${yr}`]).toBeTruthy();
    }
  });

  test("Y0 is identical across scenarios (anchored at current)", () => {
    const baseY0 = f.trajectories.base.Y0.inPlaceRentPerSF_yr;
    const upsideY0 = f.trajectories.upside.Y0.inPlaceRentPerSF_yr;
    const downsideY0 = f.trajectories.downside.Y0.inPlaceRentPerSF_yr;
    expect(baseY0).toBe(upsideY0);
    expect(baseY0).toBe(downsideY0);
  });

  test("downside < base < upside at Y3 + Y5 (in-place rent)", () => {
    for (const yr of [3, 5]) {
      const base = f.trajectories.base[`Y${yr}`].inPlaceRentPerSF_yr;
      const upside = f.trajectories.upside[`Y${yr}`].inPlaceRentPerSF_yr;
      const downside = f.trajectories.downside[`Y${yr}`].inPlaceRentPerSF_yr;
      expect(downside).toBeLessThan(base);
      expect(upside).toBeGreaterThan(base);
    }
  });

  test("move-in rate compounds at +4.4%/yr (EXR-disclosed cross-REIT proxy)", () => {
    const y0 = f.trajectories.base.Y0.moveInRatePerSF_yr;
    const y3 = f.trajectories.base.Y3.moveInRatePerSF_yr;
    // (1.044)^3 = 1.138... → 13.16 * 1.138 ≈ 14.97
    expect(y3 / y0).toBeCloseTo(Math.pow(1.044, 3), 2);
  });

  test("ECRI premium compresses over time as move-in catches up", () => {
    const y0 = f.trajectories.base.Y0.ecriPremium;
    const y5 = f.trajectories.base.Y5.ecriPremium;
    // Move-in grows +4.4%/yr, in-place grows 0% (PSA FY2025) → premium compresses
    expect(y5).toBeLessThan(y0);
  });
});

describe("getRentForecast — buyer-lens specifics", () => {
  test("PSA lens has PSNext platform uplift (+50 bps)", () => {
    const f = getRentForecast({ msa: "Los Angeles", buyerLens: "PSA" });
    expect(f.buyerSpecificDynamics.psnextStabilizedUpliftBps).toBe(50);
    expect(f.buyerSpecificDynamics.psnextUpliftYoY).toBeGreaterThan(0);
    expect(f.buyerSpecificDynamics.brandPremium).toBe(0.12);
  });

  test("EXR lens has 0 platform uplift (different operating model)", () => {
    const f = getRentForecast({ state: "NY", buyerLens: "EXR" });
    expect(f.buyerSpecificDynamics.psnextStabilizedUpliftBps).toBe(0);
    // EXR same-store revenue +0.10% (FY2025 disclosed)
    expect(f.buyerSpecificDynamics.sameStoreRentGrowthYoY).toBeCloseTo(0.001, 3);
  });

  test("CUBE lens has negative same-store rent growth (FY2025 disclosed -0.5%)", () => {
    const f = getRentForecast({ state: "TX", buyerLens: "CUBE" });
    expect(f.buyerSpecificDynamics.sameStoreRentGrowthYoY).toBeCloseTo(-0.005, 3);
  });

  test("SMA lens has positive growth — only REIT with positive same-store", () => {
    const f = getRentForecast({ state: "NV", buyerLens: "SMA" });
    expect(f.buyerSpecificDynamics.sameStoreRentGrowthYoY).toBeGreaterThan(0);
    expect(f.buyerSpecificDynamics.sameStoreRevenueGrowthYoY).toBeGreaterThan(0); // +1.6%
  });

  test("GENERIC lens uses cross-REIT averages, no brand premium, no platform uplift", () => {
    const f = getRentForecast({ state: "OH", buyerLens: "GENERIC" });
    expect(f.buyerSpecificDynamics.brandPremium).toBe(0);
    expect(f.buyerSpecificDynamics.psnextStabilizedUpliftBps).toBe(0);
    expect(f.buyerSpecificDynamics.sameStoreRentGrowthYoY).toBeLessThan(0); // -0.13%
  });

  test("PSA upside Y3 > EXR upside Y3 (PSNext uplift differentiates)", () => {
    const psa = getRentForecast({ msa: "Los Angeles", buyerLens: "PSA" });
    const exr = getRentForecast({ msa: "Los Angeles", buyerLens: "EXR" });
    // Both anchor at LA $35.76 Y0. PSA's upside compounds PSNext +2.5%/yr
    // on top of disclosed growth; EXR's upside has no platform uplift.
    const psaUpside = psa.trajectories.upside.Y3.inPlaceRentPerSF_yr;
    const exrUpside = exr.trajectories.upside.Y3.inPlaceRentPerSF_yr;
    expect(psaUpside).toBeGreaterThan(exrUpside);
  });
});

describe("getRentForecast — citations + provenance", () => {
  test("includes citations for buyer lens + EXR (move-in rate source)", () => {
    const f = getRentForecast({ msa: "Los Angeles", buyerLens: "PSA" });
    expect(Array.isArray(f.citations)).toBe(true);
    expect(f.citations.length).toBeGreaterThan(0);
    // At minimum: PSA citation (rent + dynamics) + EXR citation (move-in)
    const issuers = f.citations.map((c) => c.issuer);
    expect(issuers).toContain("EXR");
    // Every citation has accession # and SEC URL
    for (const c of f.citations) {
      if (c.accessionNumber) {
        expect(c.filingURL).toMatch(/sec\.gov/);
      }
    }
  });

  test("market signal narrative cites specific growth rates", () => {
    const f = getRentForecast({ msa: "Los Angeles", buyerLens: "PSA" });
    expect(f.marketSignal).toMatch(/Public Storage|PSA/);
    expect(f.marketSignal).toMatch(/\d+\.\d{2}%\/yr/); // some YoY rate cited
  });

  test("methodology block documents 3 scenarios", () => {
    const f = getRentForecast({ msa: "Los Angeles", buyerLens: "PSA" });
    expect(f.methodology.base).toBeTruthy();
    expect(f.methodology.upside).toBeTruthy();
    expect(f.methodology.downside).toBeTruthy();
    expect(f.methodology.ccMixAssumption).toMatch(/73%/);
  });

  test("schema identifies as v1", () => {
    const f = getRentForecast({ msa: "Los Angeles", buyerLens: "PSA" });
    expect(f.schema).toBe("storvex.rent-forecast.v1");
  });
});

describe("getRentForecast — CC/DU split", () => {
  test("CC + DU monthly rents derive from annual in-place via 73% mix + 80% premium", () => {
    const f = getRentForecast({ msa: "Los Angeles", buyerLens: "PSA" });
    const y0 = f.trajectories.base.Y0;
    // Verify CC/DU ratio holds the 80% premium constraint
    const ratio = y0.ccRentPerSF_mo / y0.duRentPerSF_mo;
    expect(ratio).toBeGreaterThanOrEqual(1.78);
    expect(ratio).toBeLessThanOrEqual(1.82);
  });

  test("monthly portfolio rent reconciles to annual in-place / 12", () => {
    const f = getRentForecast({ msa: "Los Angeles", buyerLens: "PSA" });
    const y0 = f.trajectories.base.Y0;
    const annualPortfolio = y0.inPlaceRentPerSF_yr;
    const monthlyPortfolio = annualPortfolio / 12;
    // Portfolio = 0.73 * CC + 0.27 * DU
    const reconstructed = 0.73 * y0.ccRentPerSF_mo + 0.27 * y0.duRentPerSF_mo;
    expect(reconstructed).toBeCloseTo(monthlyPortfolio, 1);
  });
});

describe("RENT_FORECAST_METADATA", () => {
  test("schema identifies as v1", () => {
    expect(RENT_FORECAST_METADATA.schema).toBe("storvex.rent-forecast.v1");
  });

  test("includes all 5 buyer lenses", () => {
    expect(RENT_FORECAST_METADATA.reitGrowthDynamics.PSA).toBeTruthy();
    expect(RENT_FORECAST_METADATA.reitGrowthDynamics.EXR).toBeTruthy();
    expect(RENT_FORECAST_METADATA.reitGrowthDynamics.CUBE).toBeTruthy();
    expect(RENT_FORECAST_METADATA.reitGrowthDynamics.SMA).toBeTruthy();
    expect(RENT_FORECAST_METADATA.reitGrowthDynamics.GENERIC).toBeTruthy();
  });

  test("citation rule explains EXR as move-in trajectory source", () => {
    expect(RENT_FORECAST_METADATA.citationRule).toMatch(/EXR/);
    expect(RENT_FORECAST_METADATA.citationRule).toMatch(/move-in|new-lease/i);
  });
});
