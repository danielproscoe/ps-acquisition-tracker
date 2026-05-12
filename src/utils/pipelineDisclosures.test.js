// Tests for pipelineDisclosures.js — per-REIT primary-source pipeline
// extraction. Fixtures are condensed snippets from the actual 10-Q / 10-K
// filings observed during the Move 2 build (May 2026).

import {
  extractPSAPipelineDisclosures,
  extractEXRPipelineDisclosures,
  extractCUBEPipelineDisclosures,
  extractNSAPipelineDisclosures,
  extractSMAPipelineDisclosures,
  extractPipelineDisclosures,
  SUPPORTED_OPERATORS,
} from "./pipelineDisclosures.mjs";

const TODAY = new Date().toISOString().slice(0, 10);

// ════════════════════════════════════════════════════════════════════════════
// PSA fixtures
// ════════════════════════════════════════════════════════════════════════════

const PSA_Q1_2026_FIXTURE = `
as of March 31, 2026, our current committed cash requirements consist of
(i) $165.5 million in property acquisitions currently under contract,
(ii) $415.7 million of remaining spending on our current development pipeline,
which will be incurred primarily in the next 18 to 24 months,
(iii) unfunded loan commitments of $43.9 million ...

Real Estate Investment Activities: We continue to seek to acquire additional
self-storage facilities from third parties. Subsequent to March 31, 2026, we
acquired or were under contract to acquire 15 self-storage facilities across
four states with 1.2 million net rentable square feet for $165.5 million.
`;

const PSA_META = {
  accession: "0001628280-26-027487",
  form: "10-Q",
  filingDate: "2026-04-27",
  reportDate: "2026-03-31",
  sourceURL: "https://www.sec.gov/Archives/edgar/data/1393311/000162828026027487/psa-20260331.htm",
};

describe("PSA pipeline disclosure extractor", () => {
  test("extracts aggregate remaining-spend disclosure", () => {
    const result = extractPSAPipelineDisclosures(PSA_Q1_2026_FIXTURE, PSA_META);
    expect(result.operator).toBe("PSA");
    expect(result.disclosures.length).toBeGreaterThanOrEqual(2);
    const remaining = result.disclosures.find((d) => d.kind === "aggregate-remaining-spend");
    expect(remaining).toBeDefined();
    expect(remaining.remainingSpendMillion).toBeCloseTo(415.7, 1);
    expect(remaining.deliveryWindow).toMatch(/18 to 24 months/i);
    expect(remaining.verifiedSource).toBe("EDGAR-10Q-0001628280-26-027487");
    expect(remaining.verifiedDate).toBe(TODAY);
    expect(remaining.operatorName).toBe("Public Storage");
  });

  test("extracts subsequent-event acquisitions disclosure", () => {
    const result = extractPSAPipelineDisclosures(PSA_Q1_2026_FIXTURE, PSA_META);
    const activity = result.disclosures.find((d) => d.kind === "subsequent-event-acquisitions");
    expect(activity).toBeDefined();
    expect(activity.numFacilities).toBe(15);
    expect(activity.numStates).toBe(4);
    expect(activity.nrsfMillion).toBeCloseTo(1.2, 1);
    expect(activity.aggregatePriceMillion).toBeCloseTo(165.5, 1);
  });

  test("returns empty disclosures when text has no pipeline content", () => {
    const result = extractPSAPipelineDisclosures("just some unrelated text", PSA_META);
    expect(result.disclosures).toHaveLength(0);
    expect(result.facilities).toHaveLength(0);
  });

  test("verifiedSource carries EDGAR- prefix that pipelineConfidence will VERIFY", () => {
    const result = extractPSAPipelineDisclosures(PSA_Q1_2026_FIXTURE, PSA_META);
    for (const d of result.disclosures) {
      expect(d.verifiedSource).toMatch(/^EDGAR-/);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// EXR fixtures
// ════════════════════════════════════════════════════════════════════════════

const EXR_2025_10K_FIXTURE = `
The Company's consolidated balance sheet includes the following line items
(in thousands): Real estate assets, gross 24,901,261 24,486,334 Real estate
under development/redevelopment 103,089 101,293 Real estate assets, net
$ 25,004,350 $ 24,587,627.

In September 2024, the Company amended existing triple-net lease agreements
for land and buildings related to 27 stores that had initially been entered
into in connection with prior joint ventures. Five of these 27 stores are
currently under development.
`;

const EXR_META = {
  accession: "0001289490-26-000010",
  form: "10-K",
  filingDate: "2026-02-25",
  reportDate: "2025-12-31",
};

describe("EXR pipeline disclosure extractor", () => {
  test("extracts balance-sheet under-development line item", () => {
    const result = extractEXRPipelineDisclosures(EXR_2025_10K_FIXTURE, EXR_META);
    expect(result.operator).toBe("EXR");
    const bs = result.disclosures.find((d) => d.kind === "balance-sheet-under-development");
    expect(bs).toBeDefined();
    expect(bs.currentYearThousands).toBe(103089);
    expect(bs.priorYearThousands).toBe(101293);
    expect(bs.currentYearMillion).toBeCloseTo(103.089, 2);
    expect(bs.verifiedSource).toBe("EDGAR-10K-0001289490-26-000010");
  });

  test("extracts JV under-development property count", () => {
    const result = extractEXRPipelineDisclosures(EXR_2025_10K_FIXTURE, EXR_META);
    const jv = result.disclosures.find((d) => d.kind === "jv-under-development");
    expect(jv).toBeDefined();
    expect(jv.numProperties).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CUBE fixtures
// ════════════════════════════════════════════════════════════════════════════

const CUBE_2025_10K_FIXTURE = `
The Company has one joint venture development property under construction,
also in New York, which is expected to be completed during the first quarter
of 2026. As of December 31, 2025, we had invested $17.2 million of the
expected $19.0 million related to this project.
`;

const CUBE_META = {
  accession: "0001298675-26-000010",
  form: "10-K",
  filingDate: "2026-02-25",
  reportDate: "2025-12-31",
};

describe("CUBE pipeline disclosure extractor", () => {
  test("extracts named JV under-construction project with invested + expected $", () => {
    const result = extractCUBEPipelineDisclosures(CUBE_2025_10K_FIXTURE, CUBE_META);
    expect(result.operator).toBe("CUBE");
    const jv = result.disclosures.find((d) => d.kind === "named-jv-under-construction");
    expect(jv).toBeDefined();
    expect(jv.city).toMatch(/New York/i);
    expect(jv.completion).toMatch(/first quarter of 2026/i);
    expect(jv.investedMillion).toBeCloseTo(17.2, 1);
    expect(jv.expectedMillion).toBeCloseTo(19.0, 1);
    expect(jv.remainingMillion).toBeCloseTo(1.8, 1);
    expect(jv.verifiedSource).toBe("EDGAR-10K-0001298675-26-000010");
  });

  test("emits a facility entry for the named JV project (per-property anchor)", () => {
    const result = extractCUBEPipelineDisclosures(CUBE_2025_10K_FIXTURE, CUBE_META);
    expect(result.facilities.length).toBeGreaterThanOrEqual(1);
    const facility = result.facilities[0];
    expect(facility.id).toMatch(/^cube-/);
    expect(facility.name).toMatch(/JV/i);
    expect(facility.status).toBe("under-construction");
    expect(facility.verifiedSource).toMatch(/^EDGAR-10K-/);
    // estimatedInvestment is dollars (not millions) for consistency with the seed
    // schema in development-pipeline.json
    expect(facility.estimatedInvestment).toBe(19_000_000);
    expect(facility.investedToDate).toBe(17_200_000);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SMA fixtures — the richest per-property pipeline disclosure on EDGAR
// ════════════════════════════════════════════════════════════════════════════

const SMA_2025_10K_FIXTURE = `
The following table summarizes our 50% ownership interests in unconsolidated
real estate ventures in Canada (the "Canadian JV Properties") (in thousands):
Date Real Estate Carrying Value of Investment
Venture Became
as of December 31,
Canadian JV Property Operational 2025 2024
Dupont (1) October 2019 $ 583 $ 3,358
East York (1) June 2020 5,209 4,945
Markham (1) May 2024 3,155 2,470
Regent (2) Under Development 3,839 2,655
Allard (3) Under Development 1,270 —
Finch (4) Under Development 3,033 —
$ 29,668 $ 32,782
(1) As of December 31, 2025, these operating properties were encumbered by
first mortgages pursuant to the RBC JV Term Loan III.
(2) The property is currently under development to become a self storage facility.
(3) On August 12, 2025, we acquired this joint venture parcel of land in
Edmonton, Alberta, Canada, with SmartCentres, and have initiated the process
to develop this property into a self storage property.
(4) On December 19, 2025, we acquired this joint venture parcel of land in
Toronto, Canada, with SmartCentres, and have initiated the process to develop
this property into a self storage property.
`;

const SMA_META = {
  accession: "0001585389-26-000003",
  form: "10-K",
  filingDate: "2026-02-19",
  reportDate: "2025-12-31",
};

describe("SMA pipeline disclosure extractor", () => {
  test("extracts three under-development Canadian JV properties (Regent / Allard / Finch)", () => {
    const result = extractSMAPipelineDisclosures(SMA_2025_10K_FIXTURE, SMA_META);
    expect(result.operator).toBe("SMA");
    expect(result.disclosures.length).toBe(3);
    expect(result.facilities.length).toBe(3);
    const names = result.disclosures.map((d) => d.propertyName).sort();
    expect(names).toEqual(["Allard", "Finch", "Regent"].sort());
  });

  test("Regent disclosure carries CIP $$ + footnote text", () => {
    const result = extractSMAPipelineDisclosures(SMA_2025_10K_FIXTURE, SMA_META);
    const regent = result.disclosures.find((d) => d.propertyName === "Regent");
    expect(regent).toBeDefined();
    expect(regent.cipCurrentThousands).toBe(3839);
    expect(regent.cipPriorThousands).toBe(2655);
    expect(regent.cipDeltaThousands).toBe(1184);
    expect(regent.kind).toBe("named-property-under-development");
    expect(regent.verifiedSource).toBe("EDGAR-10K-0001585389-26-000003");
  });

  test("Allard footnote parsed: Edmonton, Alberta + acquisition date Aug 12 2025", () => {
    const result = extractSMAPipelineDisclosures(SMA_2025_10K_FIXTURE, SMA_META);
    const allard = result.disclosures.find((d) => d.propertyName === "Allard");
    expect(allard).toBeDefined();
    expect(allard.cipCurrentThousands).toBe(1270);
    expect(allard.cipPriorThousands).toBe(0); // — parses to 0
    expect(allard.acquisitionDate).toMatch(/August\s+12,\s+2025/i);
    expect(allard.city).toMatch(/Edmonton/i);
    expect(allard.province).toMatch(/Alberta/i);
    expect(allard.country).toBe("Canada");
  });

  test("Finch footnote parsed: Toronto + acquisition date Dec 19 2025", () => {
    const result = extractSMAPipelineDisclosures(SMA_2025_10K_FIXTURE, SMA_META);
    const finch = result.disclosures.find((d) => d.propertyName === "Finch");
    expect(finch).toBeDefined();
    expect(finch.cipCurrentThousands).toBe(3033);
    expect(finch.acquisitionDate).toMatch(/December\s+19,\s+2025/i);
    expect(finch.city).toMatch(/Toronto/i);
    expect(finch.country).toBe("Canada");
  });

  test("emits facility entries with id + name + status + verifiedSource", () => {
    const result = extractSMAPipelineDisclosures(SMA_2025_10K_FIXTURE, SMA_META);
    for (const f of result.facilities) {
      expect(f.id).toMatch(/^sma-/);
      expect(f.name).toMatch(/\(SMA JV\)$/);
      expect(f.status).toBe("under-development");
      expect(f.verifiedSource).toMatch(/^EDGAR-10K-/);
      expect(f.country).toBe("Canada");
      expect(f.ciInProgress).toBeGreaterThan(0);
    }
  });

  test("operating properties (Dupont / East York / Markham) are NOT extracted as pipeline", () => {
    const result = extractSMAPipelineDisclosures(SMA_2025_10K_FIXTURE, SMA_META);
    const names = result.disclosures.map((d) => d.propertyName);
    expect(names).not.toContain("Dupont");
    expect(names).not.toContain("East York");
    expect(names).not.toContain("Markham");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// NSA — sparse, best-effort
// ════════════════════════════════════════════════════════════════════════════

describe("NSA pipeline disclosure extractor", () => {
  test("returns empty when no pipeline language present", () => {
    const result = extractNSAPipelineDisclosures("post-merger wind-down narrative", { accession: "x", form: "10-Q" });
    expect(result.disclosures).toHaveLength(0);
  });

  test("extracts under-construction count if present", () => {
    const fixture = "We currently have 4 self-storage facilities under construction across our pipeline.";
    const result = extractNSAPipelineDisclosures(fixture, { accession: "abc-123", form: "10-Q" });
    expect(result.disclosures.length).toBeGreaterThan(0);
    expect(result.disclosures[0].numFacilities).toBe(4);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Router + supported-operators
// ════════════════════════════════════════════════════════════════════════════

describe("extractPipelineDisclosures router", () => {
  test("SUPPORTED_OPERATORS lists all 5 storage REIT keys", () => {
    expect(SUPPORTED_OPERATORS.sort()).toEqual(["CUBE", "EXR", "NSA", "PSA", "SMA"]);
  });

  test("dispatches to PSA extractor when operator is psa (case-insensitive)", () => {
    const result = extractPipelineDisclosures("psa", PSA_Q1_2026_FIXTURE, PSA_META);
    expect(result.operator).toBe("PSA");
    expect(result.disclosures.length).toBeGreaterThan(0);
  });

  test("flags unsupported operator without throwing", () => {
    const result = extractPipelineDisclosures("UNKNOWN", "anything", {});
    expect(result.unsupported).toBe(true);
    expect(result.disclosures).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Cross-cutting: every disclosure + facility carries a citation tuple that
// pipelineConfidence.js will auto-classify as VERIFIED.
// ════════════════════════════════════════════════════════════════════════════

describe("verification stamp shape (Move 2 contract)", () => {
  test("every extracted disclosure carries verifiedSource + verifiedDate + verifierName", () => {
    const psa = extractPSAPipelineDisclosures(PSA_Q1_2026_FIXTURE, PSA_META);
    const exr = extractEXRPipelineDisclosures(EXR_2025_10K_FIXTURE, EXR_META);
    const cube = extractCUBEPipelineDisclosures(CUBE_2025_10K_FIXTURE, CUBE_META);
    const sma = extractSMAPipelineDisclosures(SMA_2025_10K_FIXTURE, SMA_META);
    const all = [...psa.disclosures, ...exr.disclosures, ...cube.disclosures, ...sma.disclosures];
    expect(all.length).toBeGreaterThan(5);
    for (const d of all) {
      expect(d.verifiedSource).toBeTruthy();
      expect(d.verifiedSource).toMatch(/^EDGAR-/);
      expect(d.verifiedDate).toBe(TODAY);
      expect(d.verifierName).toBe("storvex-edgar-pipeline-extractor");
      expect(d.citation).toMatch(/^Accession /);
    }
  });
});
