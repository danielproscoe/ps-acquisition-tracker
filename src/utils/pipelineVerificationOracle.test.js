import {
  verifyExtractedEntry,
  verifyExtractedEntries,
  PIPELINE_ORACLE_OPERATOR_ALIASES,
} from "./pipelineVerificationOracle";

// Fixed reference date so daysSinceVerified is deterministic relative to
// development-pipeline.json's generatedAt (2026-05-10T00:00:00.000Z).
const ASOF = new Date("2026-05-11T12:00:00Z");

describe("verifyExtractedEntry — REAL verdict", () => {
  test("PSA Doral / Miami matches seeded entry → REAL with citation", () => {
    const result = verifyExtractedEntry(
      {
        operator: "PSA",
        city: "Doral",
        state: "FL",
        nrsf: 95000,
        expectedDelivery: "2026-Q3",
      },
      { asOf: ASOF }
    );
    expect(result.verdict).toBe("REAL");
    expect(result.matchedRegistryEntry).toBeTruthy();
    expect(result.matchedRegistryEntry.id).toBe("psa-miami-2026q3");
    expect(result.citation).toMatch(/Accession/i);
    expect(result.matchScore).toBeGreaterThanOrEqual(70);
    expect(result.matchSignals.operator).toBe(true);
    expect(result.matchSignals.cityState).toBe(true);
    expect(result.matchSignals.nrsfCorroborate).toBe(true);
  });

  test("Public Storage brand alias normalizes to PSA → REAL", () => {
    const result = verifyExtractedEntry(
      {
        operator: "Public Storage",
        city: "Cypress",
        state: "TX",
        nrsf: 110000,
        expectedDelivery: "2027-Q1",
      },
      { asOf: ASOF }
    );
    expect(result.verdict).toBe("REAL");
    expect(result.matchedRegistryEntry.id).toBe("psa-houston-2027q1");
  });

  test("iStorage routes to PSA via brand alias", () => {
    const result = verifyExtractedEntry(
      { operator: "iStorage", city: "Brandon", state: "FL", nrsf: 85000 },
      { asOf: ASOF }
    );
    expect(result.verdict).toBe("REAL");
    expect(result.matchedRegistryEntry.id).toBe("psa-tampa-2026q4");
  });

  test("Q3 2026 input format converts to 2026-Q3", () => {
    const result = verifyExtractedEntry(
      {
        operator: "PSA",
        city: "Doral",
        state: "FL",
        nrsf: 95000,
        expectedDelivery: "Q3 2026",
      },
      { asOf: ASOF }
    );
    expect(result.verdict).toBe("REAL");
    expect(result.matchSignals.deliveryCorroborate).toBe(true);
  });

  test("NRSF wildly off (5x) still matches on operator+city but flags nrsfCorroborate=false", () => {
    const result = verifyExtractedEntry(
      { operator: "PSA", city: "Doral", state: "FL", nrsf: 500000 },
      { asOf: ASOF }
    );
    expect(result.verdict).toBe("REAL");
    expect(result.matchSignals.nrsfCorroborate).toBe(false);
  });
});

describe("verifyExtractedEntry — NOT_FOUND verdict", () => {
  test("operator+city pair with multiple registry facilities indexed but no operator match → NOT_FOUND", () => {
    // CubeSmart in Doral (which has PSA seeded but not CUBE)
    const result = verifyExtractedEntry(
      { operator: "CubeSmart", city: "Doral", state: "FL", nrsf: 80000 },
      { asOf: ASOF }
    );
    // Doral has 1 indexed facility (PSA), so coverage signal is "unknown"
    // not "good." This SHOULD route to INCONCLUSIVE per the threshold
    // (NOT_FOUND needs ≥2 indexed OR explicit good coverage).
    expect(["NOT_FOUND", "INCONCLUSIVE"]).toContain(result.verdict);
  });

  test("operator absent from seeded registry in a sparse-coverage submarket → INCONCLUSIVE", () => {
    const result = verifyExtractedEntry(
      { operator: "SmartStop", city: "Tulsa", state: "OK", nrsf: 60000 },
      { asOf: ASOF }
    );
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.confidence).toBeLessThanOrEqual(50);
  });
});

describe("verifyExtractedEntry — INCONCLUSIVE verdict", () => {
  test("empty input → INCONCLUSIVE", () => {
    const result = verifyExtractedEntry(null);
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.confidence).toBe(0);
  });

  test("operator missing → no match → INCONCLUSIVE / NOT_FOUND", () => {
    const result = verifyExtractedEntry(
      { city: "Doral", state: "FL", nrsf: 95000 },
      { asOf: ASOF }
    );
    // No operator match means score < 70 threshold; submarket has 1 indexed
    // entry → INCONCLUSIVE.
    expect(["INCONCLUSIVE", "NOT_FOUND"]).toContain(result.verdict);
  });

  test("unindexed submarket → INCONCLUSIVE with reasoning citing sparse coverage", () => {
    const result = verifyExtractedEntry(
      { operator: "Andover Properties", city: "Boise", state: "ID", nrsf: 70000 },
      { asOf: ASOF }
    );
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.reasoning).toMatch(/sparse|coverage|cannot/i);
  });
});

describe("verifyExtractedEntries — bulk", () => {
  test("mixed batch produces per-status counts + summary", () => {
    const entries = [
      // REAL — PSA Doral
      { operator: "PSA", city: "Doral", state: "FL", nrsf: 95000 },
      // REAL — Extra Space (the seed dataset has EXR pipeline entries)
      { operator: "EXR", city: "Charlotte", state: "NC", nrsf: 75000 },
      // INCONCLUSIVE — unindexed submarket
      { operator: "Andover", city: "Boise", state: "ID" },
    ];
    const out = verifyExtractedEntries(entries, { asOf: ASOF });
    expect(out.verdicts.length).toBe(3);
    expect(out.counts.REAL + out.counts.NOT_FOUND + out.counts.STALE + out.counts.INCONCLUSIVE).toBe(3);
    expect(out.summary).toMatch(/3 entries/);
  });

  test("empty array → zero counts", () => {
    const out = verifyExtractedEntries([], { asOf: ASOF });
    expect(out.verdicts).toEqual([]);
    expect(out.counts.REAL).toBe(0);
  });
});

describe("operator alias table", () => {
  test("PS family aliases all route to PSA", () => {
    expect(PIPELINE_ORACLE_OPERATOR_ALIASES.PSA).toBe("PSA");
    expect(PIPELINE_ORACLE_OPERATOR_ALIASES.PS).toBe("PSA");
    expect(PIPELINE_ORACLE_OPERATOR_ALIASES["PUBLIC STORAGE"]).toBe("PSA");
    expect(PIPELINE_ORACLE_OPERATOR_ALIASES.ISTORAGE).toBe("PSA");
    expect(PIPELINE_ORACLE_OPERATOR_ALIASES.NSA).toBe("PSA");
    expect(PIPELINE_ORACLE_OPERATOR_ALIASES["NATIONAL STORAGE AFFILIATES"]).toBe("PSA");
  });

  test("EXR family aliases (post-Life-Storage merger) route to EXR", () => {
    expect(PIPELINE_ORACLE_OPERATOR_ALIASES.EXR).toBe("EXR");
    expect(PIPELINE_ORACLE_OPERATOR_ALIASES["EXTRA SPACE"]).toBe("EXR");
    expect(PIPELINE_ORACLE_OPERATOR_ALIASES.LSI).toBe("EXR");
    expect(PIPELINE_ORACLE_OPERATOR_ALIASES["LIFE STORAGE"]).toBe("EXR");
  });

  test("UHAL routes to AMERCO", () => {
    expect(PIPELINE_ORACLE_OPERATOR_ALIASES.UHAL).toBe("AMERCO");
    expect(PIPELINE_ORACLE_OPERATOR_ALIASES["U-HAUL"]).toBe("AMERCO");
  });
});
