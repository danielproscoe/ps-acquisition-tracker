// warehouseExport.test.js — verifies historical MSA rent series flows into
// the storvex.asset-analyzer.v1 warehouse payload. Other fields are covered
// by integration in AssetAnalyzerView; this suite focuses on the new
// historical_msa_rent block added by the Crush Radius Plus sprint.

import { buildWarehousePayload } from "./warehouseExport";
import { analyzeExistingAsset } from "./existingAssetAnalysis";
import { computeBuyerLens, PS_LENS } from "./buyerLensProfiles";

const houstonInput = {
  name: "Houston Calibration (warehouse export test)",
  ask: 12_000_000,
  nrsf: 75_000,
  unitCount: 600,
  yearBuilt: 2019,
  city: "Houston",
  state: "TX",
  msaTier: "primary",
  dealType: "stabilized",
  physicalOcc: 0.88,
  economicOcc: 0.85,
  ccPct: 0.70,
  isManned: false,
  t12EGI: 1_120_000,
  t12NOI: 845_000,
  proFormaEGI: 0,
  proFormaNOI: 0,
};

const generalInput = {
  ...houstonInput,
  name: "Greenville Calibration (no MSA match)",
  city: "Greenville",
  state: "TX",
};

describe("buildWarehousePayload — historical MSA rent (Crush Radius Plus)", () => {
  test("includes historical_msa_rent when subject city maps to a PSA-disclosed MSA", () => {
    const analysis = analyzeExistingAsset(houstonInput);
    const psLens = computeBuyerLens(houstonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    expect(payload.historical_msa_rent).not.toBeNull();
    expect(payload.historical_msa_rent.issuer).toBe("PSA");
    expect(payload.historical_msa_rent.msa).toBe("Houston");
    expect(payload.historical_msa_rent.first_year).toBe("2021");
    expect(payload.historical_msa_rent.last_year).toBe("2025");
    expect(payload.historical_msa_rent.cagr_pct).toBeGreaterThan(4);
    expect(payload.historical_msa_rent.cagr_pct).toBeLessThan(7);
    expect(payload.historical_msa_rent.years_covered).toBeGreaterThanOrEqual(5);
    expect(Array.isArray(payload.historical_msa_rent.series)).toBe(true);
    expect(payload.historical_msa_rent.series.length).toBeGreaterThanOrEqual(5);
  });

  test("series entries carry fiscal_year + rent_per_occ_sf + occupancy + facilities", () => {
    const analysis = analyzeExistingAsset(houstonInput);
    const psLens = computeBuyerLens(houstonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    const first = payload.historical_msa_rent.series[0];
    expect(first.fiscal_year).toBeTruthy();
    expect(typeof first.rent_per_occ_sf).toBe("number");
    expect(first.rent_per_occ_sf).toBeGreaterThan(10);
    expect(typeof first.occupancy).toBe("number");
    expect(first.occupancy).toBeGreaterThan(0.7);
    expect(typeof first.facilities).toBe("number");
  });

  test("source citation references SEC EDGAR + PSA MD&A", () => {
    const analysis = analyzeExistingAsset(houstonInput);
    const psLens = computeBuyerLens(houstonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    expect(payload.historical_msa_rent.source).toContain("PSA");
    expect(payload.historical_msa_rent.source).toContain("10-K");
    expect(payload.historical_msa_rent.source).toContain("MD&A");
    expect(payload.historical_msa_rent.source_provider).toBe("SEC EDGAR");
    expect(payload.historical_msa_rent.schema_version).toContain("storvex.edgar-historical-msa-rents");
  });

  test("most_recent_yoy_change_pct computed from last two series years", () => {
    const analysis = analyzeExistingAsset(houstonInput);
    const psLens = computeBuyerLens(houstonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    expect(payload.historical_msa_rent.most_recent_year_rent).toBeGreaterThan(0);
    expect(payload.historical_msa_rent.prior_year_rent).toBeGreaterThan(0);
    // Houston FY24→FY25 was effectively flat (0.06% per the live verify run)
    expect(payload.historical_msa_rent.most_recent_yoy_change_pct).not.toBeNull();
  });

  test("historical_msa_rent is null when subject city is not a PSA-disclosed MSA", () => {
    const analysis = analyzeExistingAsset(generalInput);
    const psLens = computeBuyerLens(generalInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    expect(payload.historical_msa_rent).toBeNull();
  });
});
