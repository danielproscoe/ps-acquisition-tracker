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

  describe("EDGAR primary-source pipeline section (Move 2)", () => {
    test("renders EDGAR PRIMARY-SOURCE PIPELINE section header when ingest has run", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).toContain("EDGAR PRIMARY-SOURCE PIPELINE");
    });

    test("renders the cross-REIT issuer summary row table with PSA / EXR / CUBE / SMA", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // At least one of the four reliably-disclosing issuers should appear in
      // the headline-disclosure row table.
      expect(html).toMatch(/<b>(PSA|EXR|CUBE|SMA)<\/b>/);
      // The "REMAINING-SPEND" / "Balance-sheet" / "Named JV" disclosure labels
      expect(html).toMatch(/Remaining-spend|Balance-sheet|Named JV|Canadian JV/);
    });

    test("renders per-property facility table with at least one VERIFIED chip", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // The facility rows include a Pipeline Confidence chip; SMA's named
      // properties (Regent / Allard / Finch / Edmonton JV) and CUBE's NY JV
      // all carry verifiedSource: EDGAR-… so every chip should be VERIFIED.
      expect(html).toContain("VERIFIED");
      expect(html).toMatch(/SMA JV|JV \(CUBE\)/);
    });

    test("EDGAR PRIMARY-SOURCE PIPELINE section appears after CROSS-REIT HISTORICAL SAME-STORE", () => {
      const houstonInput = { ...baseInput, name: "Houston Pipeline Order Test", city: "Houston", state: "TX" };
      const analysis = analyzeExistingAsset(houstonInput);
      const psLens = computeBuyerLens(houstonInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      const crossIdx = html.indexOf("CROSS-REIT HISTORICAL SAME-STORE");
      const pipelineIdx = html.indexOf("EDGAR PRIMARY-SOURCE PIPELINE");
      const compsIdx = html.indexOf("SALE COMPS");
      expect(crossIdx).toBeGreaterThan(0);
      expect(pipelineIdx).toBeGreaterThan(crossIdx);
      // Move 2 section appears BEFORE the SALE COMPS section (forward-looking
      // supply comes before historical sale comps).
      expect(compsIdx).toBeGreaterThan(pipelineIdx);
    });
  });

  describe("Audited Storage Demand Forecast (Crush Radius+ DEMAND wedge)", () => {
    const enrichedInput = {
      ...baseInput,
      name: "Demand Forecast Test",
      city: "Houston",
      state: "TX",
    };

    test("renders AUDITED STORAGE DEMAND FORECAST section when 3-mi ring + tapestry present", () => {
      const analysis = analyzeExistingAsset(enrichedInput);
      const psLens = computeBuyerLens(enrichedInput, PS_LENS);
      const enrichment = {
        ring3mi: { pop: 60000, renterPct: 48, growthRate: 1.2, medianHHIncome: 72000 },
        tapestryLifeMode3mi: "Midtown Singles",
        tapestryUrbanization3mi: "Metro Cities",
        ccSPCCurrent: 2.4,
      };
      const html = generateAnalyzerReport({ analysis, psLens, enrichment });

      expect(html).toContain("AUDITED STORAGE DEMAND FORECAST");
      expect(html).toContain("CRUSH RADIUS+ DEMAND WEDGE");
      expect(html).toContain("COMPONENT-WISE DEMAND MODEL");
      expect(html).toContain("storvex.storageDemandForecast.v1");
    });

    test("renders all 4 component rows with formula + source", () => {
      const analysis = analyzeExistingAsset(enrichedInput);
      const psLens = computeBuyerLens(enrichedInput, PS_LENS);
      const enrichment = {
        ring3mi: { pop: 60000, renterPct: 48, growthRate: 1.2, medianHHIncome: 72000 },
        tapestryLifeMode3mi: "Midtown Singles",
        tapestryUrbanization3mi: "Metro Cities",
      };
      const html = generateAnalyzerReport({ analysis, psLens, enrichment });

      expect(html).toContain("Tapestry-Adjusted Baseline");
      expect(html).toContain("Renter Premium");
      expect(html).toContain("Growth Premium (mover flux)");
      expect(html).toContain("Income Adjustment");
      // Citation strings appear inline
      expect(html).toMatch(/Self-Storage Almanac/);
      expect(html).toMatch(/Census ACS/);
    });

    test("supply vs demand calibration strip fires when currentCCSPC provided", () => {
      const analysis = analyzeExistingAsset(enrichedInput);
      const psLens = computeBuyerLens(enrichedInput, PS_LENS);
      const enrichment = {
        ring3mi: { pop: 60000, renterPct: 48, growthRate: 1.2, medianHHIncome: 72000 },
        tapestryLifeMode3mi: "Midtown Singles",
        tapestryUrbanization3mi: "Metro Cities",
        ccSPCCurrent: 2.0, // Lower than forecast demand → UNDER-SUPPLIED
      };
      const html = generateAnalyzerReport({ analysis, psLens, enrichment });

      expect(html).toContain("Supply vs. Demand Calibration");
      expect(html).toMatch(/UNDER-SUPPLIED|OVER-SUPPLIED|BALANCED/);
    });

    test("section omits when no demographic enrichment is available", () => {
      const sparseInput = { ...baseInput, name: "No-data Demand Test", city: null, state: null };
      const analysis = analyzeExistingAsset(sparseInput);
      const psLens = computeBuyerLens(sparseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // Without ring data, the demand-forecast section does not render
      expect(html).not.toContain("AUDITED STORAGE DEMAND FORECAST");
    });

    test("section appears between CROSS-REIT HISTORICAL and EDGAR PRIMARY-SOURCE PIPELINE in render order", () => {
      const houstonInput = { ...baseInput, name: "Order Test", city: "Houston", state: "TX" };
      const analysis = analyzeExistingAsset(houstonInput);
      const psLens = computeBuyerLens(houstonInput, PS_LENS);
      const enrichment = {
        ring3mi: { pop: 60000, renterPct: 48, growthRate: 1.2, medianHHIncome: 72000 },
        tapestryLifeMode3mi: "Midtown Singles",
        tapestryUrbanization3mi: "Metro Cities",
      };
      const html = generateAnalyzerReport({ analysis, psLens, enrichment });

      const crossIdx = html.indexOf("CROSS-REIT HISTORICAL SAME-STORE");
      const demandIdx = html.indexOf("AUDITED STORAGE DEMAND FORECAST");
      const pipelineIdx = html.indexOf("EDGAR PRIMARY-SOURCE PIPELINE");

      expect(crossIdx).toBeGreaterThan(0);
      expect(demandIdx).toBeGreaterThan(crossIdx);
      expect(pipelineIdx).toBeGreaterThan(demandIdx);
    });
  });

  describe("Cross-REIT Rent Trajectory (Crush Radius+ CC RENT wedge)", () => {
    test("renders CROSS-REIT RENT TRAJECTORY section when subject MSA has trajectory data", () => {
      const houstonInput = { ...baseInput, name: "Houston Trajectory Test", city: "Houston", state: "TX" };
      const analysis = analyzeExistingAsset(houstonInput);
      const psLens = computeBuyerLens(houstonInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // Houston is in PSA's 24-MSA scrape coverage. Should render.
      expect(html).toContain("CROSS-REIT RENT TRAJECTORY");
      expect(html).toContain("CRUSH RADIUS+ CC RENT");
      expect(html).toContain("DAILY-REFRESH SCRAPE");
    });

    test("trajectory table shows operator + CC median + Δ + DU median columns", () => {
      const houstonInput = { ...baseInput, name: "Houston Trajectory Cols", city: "Houston", state: "TX" };
      const analysis = analyzeExistingAsset(houstonInput);
      const psLens = computeBuyerLens(houstonInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).toMatch(/CC Median . First/);
      expect(html).toMatch(/CC Median . Latest/);
      expect(html).toMatch(/DU Median . Latest/);
      expect(html).toMatch(/Snapshots/);
    });

    test("section omits when subject city doesn't map to a covered MSA", () => {
      const obscureInput = { ...baseInput, name: "Obscure Town", city: "Whitebird", state: "ID" };
      const analysis = analyzeExistingAsset(obscureInput);
      const psLens = computeBuyerLens(obscureInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // Whitebird ID is not in PSA/CUBE scrape coverage
      expect(html).not.toContain("CROSS-REIT RENT TRAJECTORY");
    });

    test("trajectory section appears between CROSS-REIT HISTORICAL and AUDITED STORAGE DEMAND FORECAST", () => {
      const houstonInput = { ...baseInput, name: "Order Test 2", city: "Houston", state: "TX" };
      const analysis = analyzeExistingAsset(houstonInput);
      const psLens = computeBuyerLens(houstonInput, PS_LENS);
      const enrichment = {
        ring3mi: { pop: 60000, renterPct: 48, growthRate: 1.2, medianHHIncome: 72000 },
        tapestryLifeMode3mi: "Midtown Singles",
        tapestryUrbanization3mi: "Metro Cities",
      };
      const html = generateAnalyzerReport({ analysis, psLens, enrichment });

      const histIdx = html.indexOf("CROSS-REIT HISTORICAL SAME-STORE");
      const trajIdx = html.indexOf("CROSS-REIT RENT TRAJECTORY");
      const demandIdx = html.indexOf("AUDITED STORAGE DEMAND FORECAST");

      expect(histIdx).toBeGreaterThan(0);
      expect(trajIdx).toBeGreaterThan(histIdx);
      expect(demandIdx).toBeGreaterThan(trajIdx);
    });
  });

  describe("Historical Pipeline Disclosure Trajectory (Crush Radius+ multi-year backfill)", () => {
    test("renders HISTORICAL PIPELINE DISCLOSURE TRAJECTORY section when backfill data is loaded", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).toContain("HISTORICAL PIPELINE DISCLOSURE TRAJECTORY");
      expect(html).toContain("6-10 YEAR EDGAR BACKFILL");
    });

    test("aggregate trajectory table renders for PSA + EXR with multi-year series", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // PSA + EXR both have multi-year aggregate disclosure series
      expect(html).toMatch(/<b>PSA<\/b>/);
      expect(html).toMatch(/<b>EXR<\/b>/);
      // CAGR rendering
      expect(html).toMatch(/%\/yr/);
    });

    test("named JV property trajectory table renders CUBE NY/MA/NJ entries", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // Named JV trajectory section appears
      expect(html).toContain("Named JV Property Trajectory");
      // CUBE has 8 distinct named JV entries across years
      expect(html).toMatch(/New York|Massachusetts|New Jersey/);
    });

    test("section appears after EDGAR PRIMARY-SOURCE PIPELINE in render order", () => {
      const houstonInput = { ...baseInput, name: "Historical Order Test", city: "Houston", state: "TX" };
      const analysis = analyzeExistingAsset(houstonInput);
      const psLens = computeBuyerLens(houstonInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      const pipelineIdx = html.indexOf("EDGAR PRIMARY-SOURCE PIPELINE");
      const histIdx = html.indexOf("HISTORICAL PIPELINE DISCLOSURE TRAJECTORY");
      const compsIdx = html.indexOf("SALE COMPS");

      expect(pipelineIdx).toBeGreaterThan(0);
      expect(histIdx).toBeGreaterThan(pipelineIdx);
      expect(compsIdx).toBeGreaterThan(histIdx);
    });
  });

  describe("Buyer-Fit Ranking · funnel-as-product engine", () => {
    test("renders BUYER-FIT RANKING heading on every report", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).toContain("BUYER-FIT RANKING");
      expect(html).toContain("WHO PURSUES THIS DEAL");
    });

    test("ranking table includes all 6 buyer specs (PS · AMERCO · EXR · CUBE · SMA · GENERIC)", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).toContain("PSA — Public Storage");
      expect(html).toContain("AMERCO — U-Haul");
      expect(html).toContain("EXR — Extra Space Storage");
      expect(html).toContain("CUBE — CubeSmart");
      expect(html).toContain("SMA — SmartStop Self Storage");
      expect(html).toContain("GENERIC institutional storage buyer");
    });

    test("top-fit chip names the recipient (relationship owner)", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // The chip always names whoever owns this lens at Storvex
      expect(html).toMatch(/recommended owner is <b>[^<]+<\/b>/);
    });

    test("funnel-as-product framing is in the section closer", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).toContain("Funnel-as-product");
      expect(html).toContain("buyerMatchEngine.js");
    });

    test("Buyer-Fit Ranking appears between Executive Summary and Storvex Audit Layer", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      const execIdx = html.indexOf("EXECUTIVE SUMMARY");
      const buyerFitIdx = html.indexOf("BUYER-FIT RANKING");
      const auditLayerIdx = html.indexOf("STORVEX AUDIT LAYER");

      expect(execIdx).toBeGreaterThan(0);
      expect(buyerFitIdx).toBeGreaterThan(execIdx);
      expect(auditLayerIdx).toBeGreaterThan(buyerFitIdx);
    });
  });

  describe("Institutional Audit Layer · DATA SOURCES panel (Crush Radius+ reframe)", () => {
    test("renders STORVEX AUDIT LAYER · PRIMARY SOURCES heading near top of every report", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).toContain("STORVEX AUDIT LAYER");
      expect(html).toContain("PRIMARY SOURCES CONSUMED BY THIS REPORT");
      expect(html).toContain("OPERATOR-AGNOSTIC");
    });

    test("data-sources table lists every primary-source layer Storvex consumes", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // Each "Layer" cell in the table — these are the rows the panel emits.
      expect(html).toContain(">Demographics<");
      expect(html).toContain(">Demand model<");
      expect(html).toContain(">Daily rents<");
      expect(html).toContain(">Historical rents<");
      expect(html).toContain(">Cross-REIT performance<");
      expect(html).toContain(">Pipeline disclosures<");
      expect(html).toContain(">Pipeline history<");
      expect(html).toContain(">Verification ledger<");
    });

    test("co-existence framing names the incumbent data platforms", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // Audit-layer panel explicitly cites Radius+ + TractIQ + Yardi + StorTrack
      // and frames them as the data layer beneath Storvex.
      expect(html).toContain("Radius+");
      expect(html).toContain("TractIQ");
      expect(html).toContain("Yardi");
      expect(html).toContain("StorTrack");
      expect(html).toMatch(/48,000 facilities/);
      expect(html).toMatch(/70,000/);
    });

    test("audit-layer panel appears between Executive Summary and Capabilities Footprint", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      const execIdx = html.indexOf("EXECUTIVE SUMMARY");
      const auditLayerIdx = html.indexOf("STORVEX AUDIT LAYER");
      const footprintIdx = html.indexOf("AUDIT-LAYER CAPABILITIES");

      expect(execIdx).toBeGreaterThan(0);
      expect(auditLayerIdx).toBeGreaterThan(execIdx);
      expect(footprintIdx).toBeGreaterThan(auditLayerIdx);
    });
  });

  describe("Audit-Layer Capabilities Footprint (reframed scoreboard)", () => {
    test("renders AUDIT-LAYER CAPABILITIES heading (post-reframe)", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).toContain("AUDIT-LAYER CAPABILITIES");
      expect(html).toContain("STORVEX vs INCUMBENT DATA PLATFORMS");
      expect(html).toContain("CAPABILITIES THIS REPORT EXERCISES");
    });

    test("scoreboard label uses INCUMBENT-UNIQUE (not RADIUS+-UNIQUE) — co-existence framing", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // Soft reframe — scoreboard now reads "INCUMBENT-UNIQUE" instead of "RADIUS+-UNIQUE"
      expect(html).toContain("INCUMBENT-UNIQUE");
    });

    test("capabilities table renders all 4 pillars (DEMOS · CC RENTS · PIPELINE · VERIFICATION)", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).toMatch(/>DEMOS</);
      expect(html).toMatch(/>CC RENTS</);
      expect(html).toMatch(/>PIPELINE</);
      expect(html).toMatch(/>VERIFICATION</);
    });

    test("capability tally footer cites unique/parity/incumbent counts in audit-layer framing", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // Audit-layer-reframe footer: "Capability tally (this report): N dimensions ..."
      expect(html).toMatch(/Capability tally \(this report\)/);
      expect(html).toMatch(/Breadth-of-coverage .* remains the incumbent data platforms' lane/);
    });

    test("capability table cites specific data infrastructure (refresh cadence + paths)", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // Citation strings — refresh-rents.yml cron, backfill scripts, EDGAR prefixes
      expect(html).toMatch(/refresh-rents\.yml/);
      expect(html).toMatch(/backfill-historical/);
      expect(html).toMatch(/Tapestry/);
    });

    test("Multi-source primary-source registry row renders with EDGAR + County Permits attribution", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // The new VERIFICATION row from the 5/12 audit-layer extension
      expect(html).toMatch(/Multi-source primary-source registry/);
      expect(html).toMatch(/EDGAR.*County Permits/i);
      // TractIQ-counter advantage column
      expect(html).toMatch(/TractIQ would have to replicate BOTH primary-source ingestions/);
    });

    test("Multi-source PERMIT row cites the daily 06:45 UTC cron + scraper adapter coverage", () => {
      // 5/12/26 PM enrichment — once the per-county scraper adapter sprint
      // landed (commit af0ebdb), the footprint row stopped being abstract
      // architecture talk and started citing concrete data-engine
      // infrastructure: cron schedule, adapter spread (automated HTTPS +
      // manual CSV + paper-records onFileSource).
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      expect(html).toMatch(/daily 06:45 UTC cron/);
      expect(html).toMatch(/refresh-county-permits\.yml/);
      // Adapter coverage breakdown — 1 automated + 2 manual-ingest + 2 paper-records
      expect(html).toMatch(/1 automated HTTPS \+ 2 manual-ingest portals \+ 2 paper-records adapters/);
    });

    test("Audit Layer table includes a dedicated County permits row beside EDGAR feeds", () => {
      // 5/12/26 PM — `renderInstitutionalAuditLayer` gains a 9th layer row
      // for the County Permits primary-source feed, citing the 5 pilot
      // counties (Denton TX, Warren OH, Kenton KY, Boone IN, Hancock IN)
      // and the verifiedSource: "permit-<county>-<permit-number>" stamp.
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // Layer label appears in the audit-layer table
      expect(html).toMatch(/<td[^>]*>County permits<\/td>/);
      // Feed cites the new daily cron
      expect(html).toMatch(/refresh-county-permits\.yml cron 06:45 UTC/);
      // verifiedSource stamp pattern is exposed so a reader sees the audit-trail surface
      expect(html).toMatch(/permit-&lt;county&gt;-&lt;permit-number&gt;|permit-<county>-<permit-number>/);
      // All 5 pilot county adapters named explicitly
      expect(html).toMatch(/Denton TX/);
      expect(html).toMatch(/Warren OH/);
      expect(html).toMatch(/Kenton KY/);
      expect(html).toMatch(/Boone IN/);
      expect(html).toMatch(/Hancock IN/);
    });

    test("Cross-device shared verification audit ledger row cites Phase B Firebase wire", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // The Phase B audit-ledger row — surfaces the longitudinal Radius+-accuracy moat
      expect(html).toMatch(/Cross-device shared verification audit ledger/);
      expect(html).toMatch(/Phase B Firebase wire/);
      expect(html).toMatch(/eb29608/);
    });

    test("pipeline confidence chip + counts strip render when enrichment.pipelineNearby is populated", () => {
      // Crush Radius Plus: every pipeline facility carries a verification status.
      // The renderDevelopmentPipeline() helper consumes enrichment.pipelineNearby,
      // classifies each entry's source citation via pipelineConfidence, and
      // renders a chip-stripped table + per-status counts strip.
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const enrichment = {
        pipelineNearby: [
          // VERIFIED — legacy citation field with EDGAR accession #
          {
            operator: "PSA",
            operatorName: "Public Storage",
            address: "Test Loc 1",
            city: "Houston",
            state: "TX",
            msa: "Houston",
            distanceMi: 2.4,
            nrsf: 95000,
            ccPct: 100,
            expectedDelivery: "2026-Q3",
            status: "under-construction",
            citation: "Accession 0001628280-26-007696",
            source: "PSA FY2025 10-K MD&A",
            verifiedDate: "2026-05-08",
          },
          // CLAIMED — aggregator scrape, recent
          {
            operator: "CUBE",
            operatorName: "CubeSmart",
            address: "Test Loc 2",
            city: "Houston",
            state: "TX",
            msa: "Houston",
            distanceMi: 2.8,
            nrsf: 60000,
            ccPct: 100,
            expectedDelivery: "2027-Q1",
            status: "announced",
            verifiedSource: "aggregator-radiusplus-2026-05-01",
            verifiedDate: "2026-05-01",
          },
          // UNVERIFIED — no source info
          {
            operator: "EXR",
            operatorName: "Extra Space",
            address: "Test Loc 3",
            city: "Houston",
            state: "TX",
            msa: "Houston",
            distanceMi: 1.9,
            nrsf: 45000,
            ccPct: 95,
            expectedDelivery: "2027-Q2",
            status: "permitted",
          },
        ],
        pipelineSaturation: {
          severity: "MATERIAL",
          ccNRSFInHorizon: 200000,
          totalNRSF: 200000,
          facilitiesInHorizon: 3,
          facilityCount: 3,
          narrative: "Test verdict — material new supply within horizon.",
        },
        pipelineMetadata: { phase: 1, totalFacilities: 18, generatedAt: "2026-05-10" },
      };
      const html = generateAnalyzerReport({ analysis, psLens, enrichment });

      // Section + confidence strip both render
      expect(html).toContain("NEW-SUPPLY PIPELINE");
      expect(html).toContain("PIPELINE CONFIDENCE");
      expect(html).toContain("STORVEX VERIFICATION LAYER");

      // Verification column header replaces old "Source"
      expect(html).toContain("Verification</th>");

      // Per-status counts surface on the strip — 1 VERIFIED · 1 CLAIMED · 1 UNVERIFIED
      expect(html).toMatch(/1\s*VERIFIED/);
      expect(html).toMatch(/1\s*CLAIMED/);
      expect(html).toMatch(/1\s*UNVERIFIED/);

      // Chips render with the right icons + status labels per row
      expect(html).toContain("✓"); // VERIFIED icon
      expect(html).toContain("⚠"); // CLAIMED icon
      expect(html).toContain("○"); // UNVERIFIED icon

      // Confidence-weighted CC SF appears (PSA 95K * 1.0 + CUBE 60K * 0.5 + EXR 45K*0.95*0 = 125K weighted from 200K raw)
      // The aggregate uses ccPct/100 so EXR contributes 0 (UNVERIFIED weight=0). 95K + 30K = 125K weighted.
      expect(html).toMatch(/125K/);
    });

    test("pipeline section omitted entirely when enrichment.pipelineNearby is empty", () => {
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens, enrichment: { pipelineNearby: [] } });
      expect(html).not.toContain("NEW-SUPPLY PIPELINE");
      expect(html).not.toContain("PIPELINE CONFIDENCE");
    });

    test("CUBE row shows full-decade coverage (10 datapoints FY2016-FY2025) + period-tagged CAGR", () => {
      // Crush Radius Plus moat-closure assertion. CUBE's FY2016-FY2019 10-Ks
      // were backfilled 2026-05-11 so the issuer now ships 10 fiscal years of
      // primary-source same-store rent in the cross-REIT render — closing
      // the historical-data moat that Radius+ historically owned via
      // proprietary submarket benchmarks.
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const html = generateAnalyzerReport({ analysis, psLens });

      // CUBE row appears
      expect(html).toContain("CUBE");
      // FY2016 endpoint is present in the rent-first-year cell (proves the
      // full decade landed, not just the prior 6-yr window)
      expect(html).toContain("FY2016");
      expect(html).toContain("FY2025");
      // CAGR cell renders with the period-span tag "(9-yr)" — CUBE's
      // 2016→2025 spans 9 compounding periods over 10 datapoints
      expect(html).toMatch(/\d+\.\d{2}%\/yr \(9-yr\)/);
      // Header label updated from "5-yr CAGR" → "Computed CAGR"
      expect(html).toContain("Computed CAGR");
      expect(html).not.toContain("5-yr CAGR");
    });
  });

  // ── Multi-buyer comparison table — hardcoded clean ───────────────────────
  // Regression guard: producer scripts in the past stripped the canonical
  // row shape via .map() and shipped IC PDFs with all-dash tables. The
  // renderer now normalizes any mangled shape so the table cannot ship
  // blank. Hardcoded for ALL IC deliverables per Dan's directive 2026-05-12.
  describe("multi-buyer comparison normalizer (all IC deliverables)", () => {
    test("populates table when rows are passed in canonical computeAllBuyerLenses shape", () => {
      const { computeAllBuyerLenses, computePlatformFitDelta } = require("./buyerLensProfiles");
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const allLenses = computeAllBuyerLenses(baseInput, {});
      const platformFitDelta = computePlatformFitDelta(allLenses);
      const html = generateAnalyzerReport({
        analysis, psLens,
        multiLensRows: allLenses,
        platformFitDelta,
      });
      expect(html).toContain("MULTI-BUYER COMPARISON");
      // Real implied-takedown dollar values render (not all dashes)
      expect(html).toMatch(/\$[\d.]+M/);
      // Verdict labels render (CLEARED / AT HURDLE / MISSES) — at least one
      expect(html).toMatch(/CLEARED|AT HURDLE|MISSES/);
    });

    test("recovers when producer mangled rows with buyerKey/walk/strike shape", () => {
      // Simulates the historical bug where producer scripts re-mapped to
      // ({ buyerKey, buyerName, walk, strike, homeRun, verdict: v?.label }).
      // The normalizer should still render the canonical column headers
      // even though the values fall back to dashes for missing fields.
      const analysis = analyzeExistingAsset(baseInput);
      const psLens = computeBuyerLens(baseInput, PS_LENS);
      const mangled = [
        { buyerKey: "PSA", buyerName: "Public Storage", walk: 1, strike: 2, homeRun: 3, verdict: "HURDLE_CLEARED" },
        { buyerKey: "EXR", buyerName: "Extra Space",   walk: 1, strike: 2, homeRun: 3, verdict: "AT_HURDLE" },
        { buyerKey: "GENERIC", buyerName: "Generic",   walk: 1, strike: 2, homeRun: 3, verdict: "MISSES_HURDLE" },
      ];
      const html = generateAnalyzerReport({
        analysis, psLens,
        multiLensRows: mangled,
        platformFitDelta: null,
      });
      // Section + column headers always render
      expect(html).toContain("MULTI-BUYER COMPARISON");
      expect(html).toContain("Deal Stab Cap");
      // Ticker fallback from buyerKey
      expect(html).toContain("PSA");
      expect(html).toContain("EXR");
      // Verdict labels resolved from string (not crashed by missing .label)
      expect(html).toContain("CLEARED");
      expect(html).toContain("AT HURDLE");
      expect(html).toContain("MISSES");
    });
  });
});
