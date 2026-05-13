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

// ════════════════════════════════════════════════════════════════════════════
// Move 2 — edgar_pipeline_disclosures warehouse block
// ════════════════════════════════════════════════════════════════════════════

describe("buildWarehousePayload — edgar_pipeline_disclosures (Move 2)", () => {
  test("includes edgar_pipeline_disclosures when extract has run", () => {
    const analysis = analyzeExistingAsset(houstonInput);
    const psLens = computeBuyerLens(houstonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    // After running scripts/edgar/extract-pipeline-disclosures.mjs the
    // edgar-pipeline-disclosures.json artifact ships; the block should
    // surface in the payload.
    expect(payload.edgar_pipeline_disclosures).toBeTruthy();
    expect(payload.edgar_pipeline_disclosures.total_issuers_disclosing).toBeGreaterThanOrEqual(1);
    expect(payload.edgar_pipeline_disclosures.total_filings_parsed).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(payload.edgar_pipeline_disclosures.aggregate_disclosures)).toBe(true);
    expect(Array.isArray(payload.edgar_pipeline_disclosures.named_facilities)).toBe(true);
  });

  test("every aggregate disclosure carries verified_source EDGAR- prefix + citation", () => {
    const analysis = analyzeExistingAsset(houstonInput);
    const psLens = computeBuyerLens(houstonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    if (!payload.edgar_pipeline_disclosures) return;
    for (const d of payload.edgar_pipeline_disclosures.aggregate_disclosures) {
      expect(d.verified_source).toMatch(/^EDGAR-/);
      expect(d.citation).toMatch(/^Accession /);
      expect(d.filing_url).toMatch(/sec\.gov/i);
    }
  });

  test("PSA aggregate disclosure carries remaining_spend_million + delivery_window", () => {
    const analysis = analyzeExistingAsset(houstonInput);
    const psLens = computeBuyerLens(houstonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    if (!payload.edgar_pipeline_disclosures) return;
    const psaRemaining = payload.edgar_pipeline_disclosures.aggregate_disclosures.find(
      (d) => d.operator === "PSA" && d.kind === "aggregate-remaining-spend"
    );
    expect(psaRemaining).toBeTruthy();
    expect(psaRemaining.remaining_spend_million).toBeGreaterThan(100);
    expect(psaRemaining.delivery_window).toBeTruthy();
  });

  test("every named facility carries verified_source EDGAR- prefix", () => {
    const analysis = analyzeExistingAsset(houstonInput);
    const psLens = computeBuyerLens(houstonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    if (!payload.edgar_pipeline_disclosures) return;
    for (const f of payload.edgar_pipeline_disclosures.named_facilities) {
      expect(f.verified_source).toMatch(/^EDGAR-/);
      expect(f.verifier_name).toBe("storvex-edgar-pipeline-extractor");
      expect(f.status).toMatch(/under-(construction|development)/);
    }
  });

  test("cumulative_disclosed_dollars sums REIT pipeline activity", () => {
    const analysis = analyzeExistingAsset(houstonInput);
    const psLens = computeBuyerLens(houstonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    if (!payload.edgar_pipeline_disclosures) return;
    expect(payload.edgar_pipeline_disclosures.cumulative_disclosed_dollars).toBeGreaterThan(100_000_000);
    expect(Array.isArray(payload.edgar_pipeline_disclosures.by_issuer_dollars)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Crush Radius+ DEMAND wedge — storage_demand_forecast warehouse block
// ════════════════════════════════════════════════════════════════════════════

describe("buildWarehousePayload — storage_demand_forecast (Crush Radius+ DEMAND)", () => {
  const enrichedHoustonInput = {
    ...houstonInput,
    name: "Houston Demand Forecast",
  };

  test("includes storage_demand_forecast when enrichment ring + tapestry are present", () => {
    const analysis = analyzeExistingAsset(enrichedHoustonInput);
    const psLens = computeBuyerLens(enrichedHoustonInput, PS_LENS);
    const enrichment = {
      ring3mi: { pop: 75000, renterPct: 48, growthRate: 1.4, medianHHIncome: 78000 },
      tapestryLifeMode3mi: "Midtown Singles",
      tapestryUrbanization3mi: "Metro Cities",
      ccSPCCurrent: 2.6,
    };
    const payload = buildWarehousePayload({ analysis, psLens, enrichment });

    expect(payload.storage_demand_forecast).toBeTruthy();
    expect(payload.storage_demand_forecast.model_version).toBe("storvex.storageDemandForecast.v1");
    expect(payload.storage_demand_forecast.demand_per_capita).toBeGreaterThan(3);
    expect(payload.storage_demand_forecast.demand_per_capita).toBeLessThan(13);
    expect(payload.storage_demand_forecast.total_demand_sf).toBeGreaterThan(100_000);
  });

  test("payload exposes all 4 components with formula + source", () => {
    const analysis = analyzeExistingAsset(enrichedHoustonInput);
    const psLens = computeBuyerLens(enrichedHoustonInput, PS_LENS);
    const enrichment = {
      ring3mi: { pop: 75000, renterPct: 48, growthRate: 1.4, medianHHIncome: 78000 },
      tapestryLifeMode3mi: "Midtown Singles",
      tapestryUrbanization3mi: "Metro Cities",
    };
    const payload = buildWarehousePayload({ analysis, psLens, enrichment });

    expect(Array.isArray(payload.storage_demand_forecast.components)).toBe(true);
    expect(payload.storage_demand_forecast.components.length).toBe(4);
    for (const c of payload.storage_demand_forecast.components) {
      expect(c.formula).toBeTruthy();
      expect(c.source).toBeTruthy();
    }
  });

  test("coefficients + citations sub-payloads ship for auditability", () => {
    const analysis = analyzeExistingAsset(enrichedHoustonInput);
    const psLens = computeBuyerLens(enrichedHoustonInput, PS_LENS);
    const enrichment = {
      ring3mi: { pop: 75000, renterPct: 48, growthRate: 1.4, medianHHIncome: 78000 },
      tapestryLifeMode3mi: "Midtown Singles",
      tapestryUrbanization3mi: "Metro Cities",
    };
    const payload = buildWarehousePayload({ analysis, psLens, enrichment });

    expect(payload.storage_demand_forecast.coefficients).toBeTruthy();
    expect(payload.storage_demand_forecast.coefficients.us_baseline_spc).toBeCloseTo(5.4);
    expect(payload.storage_demand_forecast.coefficients.renter_premium_per_pct).toBeCloseTo(0.035);
    expect(payload.storage_demand_forecast.coefficients.renter_premium_source).toMatch(/REIT|MSA/);
    expect(Array.isArray(payload.storage_demand_forecast.citations)).toBe(true);
    expect(payload.storage_demand_forecast.citations.length).toBeGreaterThan(4);
  });

  test("surplus_vs_observed_cc_spc populated when currentCCSPC provided", () => {
    const analysis = analyzeExistingAsset(enrichedHoustonInput);
    const psLens = computeBuyerLens(enrichedHoustonInput, PS_LENS);
    const enrichment = {
      ring3mi: { pop: 75000, renterPct: 48, growthRate: 1.4, medianHHIncome: 78000 },
      tapestryLifeMode3mi: "Midtown Singles",
      tapestryUrbanization3mi: "Metro Cities",
      ccSPCCurrent: 2.0,
    };
    const payload = buildWarehousePayload({ analysis, psLens, enrichment });

    expect(payload.storage_demand_forecast.surplus_vs_observed_cc_spc).toBeTruthy();
    expect(payload.storage_demand_forecast.surplus_vs_observed_cc_spc.observed_cc_spc).toBeCloseTo(2.0);
    expect(payload.storage_demand_forecast.surplus_vs_observed_cc_spc.signal).toMatch(/UNDER-SUPPLIED|OVER-SUPPLIED|BALANCED/);
  });

  test("storage_demand_forecast is null when no ring + tapestry data available", () => {
    const sparseInput = { ...houstonInput, name: "No-data Demand", city: null, state: null };
    const analysis = analyzeExistingAsset(sparseInput);
    const psLens = computeBuyerLens(sparseInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    expect(payload.storage_demand_forecast).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CLAIM 11 — forward_demand_trajectory warehouse block
// ════════════════════════════════════════════════════════════════════════════

describe("buildWarehousePayload — forward_demand_trajectory (Claim 11)", () => {
  const enrichedHoustonInput = {
    ...houstonInput,
    name: "Houston Forward Demand",
  };
  const trajEnrichment = {
    ring3mi: { pop: 75000, renterPct: 48, growthRate: 1.4, medianHHIncome: 78000 },
    tapestryLifeMode3mi: "Midtown Singles",
    tapestryUrbanization3mi: "Metro Cities",
    popGrowth3mi: 0.018,
    incomeGrowth3mi: 0.024,
    pop3mi_fy: 81986,
    income3mi_fy: 87831,
    ccSPCCurrent: 2.6,
  };

  test("payload carries forward_demand_trajectory with schema_version stamp", () => {
    const analysis = analyzeExistingAsset(enrichedHoustonInput);
    const psLens = computeBuyerLens(enrichedHoustonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens, enrichment: trajEnrichment });

    expect(payload.forward_demand_trajectory).toBeTruthy();
    expect(payload.forward_demand_trajectory.schema_version).toBe("storvex.forwardDemandTrajectory.v1");
    expect(payload.forward_demand_trajectory.horizon_months).toBe(60);
  });

  test("path is an array of 6 year rows (Y0..Y5)", () => {
    const analysis = analyzeExistingAsset(enrichedHoustonInput);
    const psLens = computeBuyerLens(enrichedHoustonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens, enrichment: trajEnrichment });

    expect(Array.isArray(payload.forward_demand_trajectory.path)).toBe(true);
    expect(payload.forward_demand_trajectory.path).toHaveLength(6);
    for (const row of payload.forward_demand_trajectory.path) {
      expect(row).toHaveProperty("year");
      expect(row).toHaveProperty("pop");
      expect(row).toHaveProperty("median_hhi");
      expect(row).toHaveProperty("demand_per_capita");
      expect(row).toHaveProperty("total_demand_sf");
    }
  });

  test("baseline carries pop + income CAGR + Tapestry tags", () => {
    const analysis = analyzeExistingAsset(enrichedHoustonInput);
    const psLens = computeBuyerLens(enrichedHoustonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens, enrichment: trajEnrichment });

    expect(payload.forward_demand_trajectory.baseline.pop_cagr).toBeCloseTo(0.018, 3);
    expect(payload.forward_demand_trajectory.baseline.income_cagr).toBeCloseTo(0.024, 3);
    expect(payload.forward_demand_trajectory.baseline.tapestry_lifemode).toBe("Midtown Singles");
    expect(payload.forward_demand_trajectory.baseline.growth_source).toMatch(/ESRI/i);
  });

  test("summary carries effective_demand_cagr + total_demand_gain_pct", () => {
    const analysis = analyzeExistingAsset(enrichedHoustonInput);
    const psLens = computeBuyerLens(enrichedHoustonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens, enrichment: trajEnrichment });

    expect(payload.forward_demand_trajectory.summary).toBeTruthy();
    expect(payload.forward_demand_trajectory.summary.effective_demand_cagr).toBeGreaterThan(0);
    expect(payload.forward_demand_trajectory.summary.total_demand_gain_pct).toBeGreaterThan(0);
  });

  test("forward_demand_trajectory is null when no ring data available", () => {
    const sparseInput = { ...houstonInput, name: "No-data forward demand", city: null, state: null };
    const analysis = analyzeExistingAsset(sparseInput);
    const psLens = computeBuyerLens(sparseInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    expect(payload.forward_demand_trajectory).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CLAIM 12 — equilibrium_trajectory warehouse block
// ════════════════════════════════════════════════════════════════════════════

describe("buildWarehousePayload — equilibrium_trajectory (Claim 12)", () => {
  const enrichedHoustonInput = {
    ...houstonInput,
    name: "Houston Equilibrium Trajectory",
  };
  const trajEnrichment = {
    ring3mi: { pop: 75000, renterPct: 48, growthRate: 1.4, medianHHIncome: 78000 },
    tapestryLifeMode3mi: "Midtown Singles",
    tapestryUrbanization3mi: "Metro Cities",
    popGrowth3mi: 0.018,
    incomeGrowth3mi: 0.024,
    pop3mi_fy: 81986,
    income3mi_fy: 87831,
    ccSPCCurrent: 2.6,
  };

  test("payload carries equilibrium_trajectory with schema_version stamp", () => {
    const analysis = analyzeExistingAsset(enrichedHoustonInput);
    const psLens = computeBuyerLens(enrichedHoustonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens, enrichment: trajEnrichment });

    expect(payload.equilibrium_trajectory).toBeTruthy();
    expect(payload.equilibrium_trajectory.schema_version).toBe("storvex.equilibriumTrajectory.v1");
    expect(payload.equilibrium_trajectory.horizon_months).toBe(60);
  });

  test("path is an array of 6 year rows with supply/demand/ratio/tier", () => {
    const analysis = analyzeExistingAsset(enrichedHoustonInput);
    const psLens = computeBuyerLens(enrichedHoustonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens, enrichment: trajEnrichment });

    expect(Array.isArray(payload.equilibrium_trajectory.path)).toBe(true);
    expect(payload.equilibrium_trajectory.path).toHaveLength(6);
    for (const row of payload.equilibrium_trajectory.path) {
      expect(row).toHaveProperty("year");
      expect(row).toHaveProperty("supply_cc_sf");
      expect(row).toHaveProperty("demand_cc_sf");
      expect(row).toHaveProperty("ratio");
      expect(row).toHaveProperty("tier_label");
      expect(row).toHaveProperty("supply_delivered_this_year");
      expect(row).toHaveProperty("supply_delta_edgar");
      expect(row).toHaveProperty("supply_delta_permit");
      expect(row).toHaveProperty("supply_delta_historical");
    }
  });

  test("tier_transitions is an array (may be empty)", () => {
    const analysis = analyzeExistingAsset(enrichedHoustonInput);
    const psLens = computeBuyerLens(enrichedHoustonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens, enrichment: trajEnrichment });

    expect(Array.isArray(payload.equilibrium_trajectory.tier_transitions)).toBe(true);
  });

  test("summary carries start/end tier + ratios + final year", () => {
    const analysis = analyzeExistingAsset(enrichedHoustonInput);
    const psLens = computeBuyerLens(enrichedHoustonInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens, enrichment: trajEnrichment });

    const summary = payload.equilibrium_trajectory.summary;
    expect(summary).toHaveProperty("start_tier");
    expect(summary).toHaveProperty("end_tier");
    expect(summary).toHaveProperty("start_ratio");
    expect(summary).toHaveProperty("end_ratio");
    expect(summary).toHaveProperty("final_year");
    expect(summary).toHaveProperty("net_supply_added_cc_sf");
    expect(summary).toHaveProperty("net_demand_added_cc_sf");
  });

  test("equilibrium_trajectory is null when no ring data available", () => {
    const sparseInput = { ...houstonInput, name: "No-data equilibrium", city: null, state: null };
    const analysis = analyzeExistingAsset(sparseInput);
    const psLens = computeBuyerLens(sparseInput, PS_LENS);
    const payload = buildWarehousePayload({ analysis, psLens });

    expect(payload.equilibrium_trajectory).toBeNull();
  });
});
