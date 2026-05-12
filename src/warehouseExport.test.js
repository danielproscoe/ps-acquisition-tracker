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
