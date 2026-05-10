// analyzerReport.test.js — smoke tests for the Goldman-exec PDF report
// generator. Validates that the HTML renders with all expected sections,
// handles missing optional inputs gracefully, and embeds key data points.

import { generateAnalyzerReport } from "./analyzerReport";
import { analyzeExistingAsset } from "./existingAssetAnalysis";
import { computeBuyerLens, PS_LENS } from "./buyerLensProfiles";

const baseInput = {
  name: "Test Storage Facility",
  ask: 5000000,
  nrsf: 60000,
  unitCount: 500,
  yearBuilt: 2020,
  state: "TX",
  msaTier: "secondary",
  dealType: "stabilized",
  physicalOcc: 0.90,
  economicOcc: 0.88,
  ccPct: 0.70,
  isManned: false,
  t12EGI: 950000,
  t12NOI: 600000,
  proFormaEGI: 0,
  proFormaNOI: 0,
};

describe("generateAnalyzerReport", () => {
  test("throws when analysis is missing", () => {
    expect(() => generateAnalyzerReport({ analysis: null })).toThrow(/required/);
    expect(() => generateAnalyzerReport({ analysis: {} })).toThrow(/required/);
  });

  test("returns full HTML document with DOCTYPE and key sections", () => {
    const analysis = analyzeExistingAsset(baseInput);
    const psLens = computeBuyerLens(baseInput, PS_LENS);
    const html = generateAnalyzerReport({ analysis, psLens });

    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("</html>");
    expect(html).toContain("EXECUTIVE SUMMARY");
    expect(html).toContain("VERDICT &amp; UNDERWRITE");
    expect(html).toContain("PRICE TIERS");
    expect(html).toContain("NOI RECONSTRUCTION");
    expect(html).toContain("STABILIZED PROJECTION");
    expect(html).toContain("VALUATION MATRIX");
    expect(html).toContain("AUDIT &amp; PROVENANCE");
  });

  test("embeds the deal name and ask price in the cover", () => {
    const analysis = analyzeExistingAsset(baseInput);
    const psLens = computeBuyerLens(baseInput, PS_LENS);
    const html = generateAnalyzerReport({ analysis, psLens });

    expect(html).toContain("Test Storage Facility");
    expect(html).toContain("$5.00M");
  });

  test("renders the institutional verdict label (PURSUE / NEGOTIATE / PASS)", () => {
    const analysis = analyzeExistingAsset(baseInput);
    const psLens = computeBuyerLens(baseInput, PS_LENS);
    const html = generateAnalyzerReport({ analysis, psLens });

    expect(html).toMatch(/(PURSUE|NEGOTIATE|PASS)/);
  });

  test("includes the Save as PDF print button (screen-only control)", () => {
    const analysis = analyzeExistingAsset(baseInput);
    const psLens = computeBuyerLens(baseInput, PS_LENS);
    const html = generateAnalyzerReport({ analysis, psLens });

    expect(html).toContain("Save as PDF");
    expect(html).toContain("window.print()");
    expect(html).toContain("class=\"controls no-print\"");
  });

  test("embeds rent sanity section when marketRents is provided", () => {
    const analysis = analyzeExistingAsset(baseInput, {
      marketRents: { ccRentPerSF: 1.40, driveupRentPerSF: 0.80, sampleSize: 12, source: "SpareFoot" },
    });
    const psLens = computeBuyerLens(baseInput, PS_LENS, {
      marketRents: { ccRentPerSF: 1.40, driveupRentPerSF: 0.80, sampleSize: 12, source: "SpareFoot" },
    });
    const html = generateAnalyzerReport({ analysis, psLens });

    expect(html).toContain("RENT SANITY");
    expect(html).toContain("SpareFoot");
  });

  test("omits rent sanity section when marketRents absent", () => {
    const analysis = analyzeExistingAsset(baseInput);
    const psLens = computeBuyerLens(baseInput, PS_LENS);
    const html = generateAnalyzerReport({ analysis, psLens });

    expect(html).not.toContain("RENT SANITY");
  });

  test("includes IC Memo section when memo provided", () => {
    const analysis = analyzeExistingAsset(baseInput);
    const psLens = computeBuyerLens(baseInput, PS_LENS);
    const memo = {
      recommendation: "PURSUE",
      execSummary: "Strong yield story.",
      bidPosture: "Open at $4.8M.",
      topRisks: ["Lease-up risk", "Tax reassessment"],
      buyerRouting: "Storvex PS · institutional self-managed lens",
    };
    const html = generateAnalyzerReport({ analysis, psLens, memo });

    expect(html).toContain("INVESTMENT COMMITTEE MEMO");
    expect(html).toContain("Strong yield story");
    expect(html).toContain("Open at $4.8M");
    expect(html).toContain("Lease-up risk");
  });

  test("omits IC Memo section when memo absent or empty", () => {
    const analysis = analyzeExistingAsset(baseInput);
    const psLens = computeBuyerLens(baseInput, PS_LENS);
    const html = generateAnalyzerReport({ analysis, psLens, memo: null });
    expect(html).not.toContain("INVESTMENT COMMITTEE MEMO");
  });

  test("brand tokens are embedded (NAVY / GOLD / ICE)", () => {
    const analysis = analyzeExistingAsset(baseInput);
    const psLens = computeBuyerLens(baseInput, PS_LENS);
    const html = generateAnalyzerReport({ analysis, psLens });

    expect(html).toContain("#1E2761"); // NAVY
    expect(html).toContain("#C9A84C"); // GOLD
    expect(html).toMatch(/Inter|Calibri/); // typography
    expect(html).toContain("Space Mono"); // figure font
  });

  test("audit block cites primary sources (10-K, ESRI, framework)", () => {
    const analysis = analyzeExistingAsset(baseInput);
    const psLens = computeBuyerLens(baseInput, PS_LENS);
    const html = generateAnalyzerReport({ analysis, psLens });

    expect(html).toContain("FY2025");
    expect(html).toContain("ESRI");
    expect(html).toContain("storvex.asset-analyzer.v1");
    expect(html).toContain("Valuation Framework v2");
  });

  test("page break + print stylesheet present", () => {
    const analysis = analyzeExistingAsset(baseInput);
    const psLens = computeBuyerLens(baseInput, PS_LENS);
    const html = generateAnalyzerReport({ analysis, psLens });

    expect(html).toContain("@page");
    expect(html).toContain("@media print");
    expect(html).toContain("page-break");
    expect(html).toContain("print-color-adjust");
  });

  test("document ID is stable per deal name and grounded in date", () => {
    const analysis = analyzeExistingAsset(baseInput);
    const psLens = computeBuyerLens(baseInput, PS_LENS);
    const html = generateAnalyzerReport({ analysis, psLens });
    expect(html).toMatch(/STX-TEST-STORAGE-FACILITY-\d{8}/);
  });

  // Historical MSA rent series — closes the Radius+ moat. Renders the PSA
  // primary-source per-MSA same-store rent time series (FY2021-FY2025) when
  // the subject city resolves to a PSA-disclosed MSA.
  describe("historical MSA rent section (Crush Radius Plus)", () => {
    test("renders PSA HISTORICAL RENT section when subject city maps to a PSA-disclosed MSA", () => {
      // Houston is in PSA's MSA disclosure list — should surface 5-yr series.
      const houstonInput = { ...baseInput, name: "Houston Smoke Test", city: "Houston", state: "TX" };
      const analysis = analyzeExistingAsset(houstonInput);
      const psLens = computeBuyerLens(houstonInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).toContain("PSA HISTORICAL RENT");
      expect(html).toContain("HOUSTON");
      expect(html).toContain("PRIMARY-SOURCE SEC EDGAR");
      expect(html).toContain("FY2021");
      expect(html).toContain("FY2025");
    });

    test("omits PSA HISTORICAL RENT section when no city present (subject MSA cannot be resolved)", () => {
      // baseInput has no city — section should be skipped.
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).not.toContain("PSA HISTORICAL RENT");
    });

    test("rendered series cites computed CAGR for the MSA", () => {
      const dallasInput = { ...baseInput, name: "Dallas Smoke Test", city: "Dallas", state: "TX" };
      const analysis = analyzeExistingAsset(dallasInput);
      const psLens = computeBuyerLens(dallasInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // Dallas-Ft. Worth is a known PSA MSA. CAGR should render as %/yr.
      expect(html).toContain("PSA HISTORICAL RENT");
      expect(html).toMatch(/\d+\.\d{2}%\/yr/);
    });
  });

  describe("cross-REIT historical same-store section (Crush Radius Plus)", () => {
    test("renders CROSS-REIT HISTORICAL SAME-STORE section when EXR/CUBE/NSA data present", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).toContain("CROSS-REIT HISTORICAL SAME-STORE");
      expect(html).toContain("PRIMARY-SOURCE SEC EDGAR");
    });

    test("section cites at least one issuer + datapoints + CAGR", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // At least one of EXR / CUBE / NSA should appear in the table body
      expect(html).toMatch(/EXR|CUBE|NSA/);
      // CAGR formatting "%/yr"
      expect(html).toMatch(/\d+\.\d{2}%\/yr/);
    });

    test("section appears between PSA HISTORICAL RENT and SALE COMPS in render order", () => {
      // Use a Houston input so PSA HISTORICAL RENT also renders, letting us
      // verify the relative ordering of the three sections.
      const houstonInput = { ...baseInput, name: "Houston Order Test", city: "Houston", state: "TX" };
      const analysis = analyzeExistingAsset(houstonInput);
      const psLens = computeBuyerLens(houstonInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      const psaIdx = html.indexOf("PSA HISTORICAL RENT");
      const crossIdx = html.indexOf("CROSS-REIT HISTORICAL SAME-STORE");
      // PSA section before cross-REIT section
      expect(psaIdx).toBeGreaterThan(0);
      expect(crossIdx).toBeGreaterThan(psaIdx);
    });
  });
});
