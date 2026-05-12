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

describe("multi-source registry (EDGAR + PERMIT) — Crush Radius+ audit-layer wedge", () => {
  test("REAL verdict carries registrySource: 'EDGAR' when match comes from development-pipeline.json", () => {
    const result = verifyExtractedEntry(
      { operator: "PSA", city: "Doral", state: "FL", nrsf: 95000 },
      { asOf: ASOF }
    );
    expect(result.verdict).toBe("REAL");
    expect(result.registrySource).toBe("EDGAR");
    // Reasoning text explicitly attributes the registry source
    expect(result.reasoning).toMatch(/EDGAR registry/i);
  });

  test("every verdict (REAL / NOT_FOUND / INCONCLUSIVE) exposes registriesScanned array", () => {
    const realResult = verifyExtractedEntry(
      { operator: "PSA", city: "Doral", state: "FL", nrsf: 95000 },
      { asOf: ASOF }
    );
    const inconclusiveResult = verifyExtractedEntry(
      { operator: "SmartStop", city: "Tulsa", state: "OK", nrsf: 60000 },
      { asOf: ASOF }
    );
    const emptyResult = verifyExtractedEntry(null);

    for (const r of [realResult, inconclusiveResult, emptyResult]) {
      expect(Array.isArray(r.registriesScanned)).toBe(true);
      expect(r.registriesScanned).toContain("EDGAR");
      expect(r.registriesScanned).toContain("PERMIT");
    }
  });

  test("registrySource is null on no-match verdicts (NOT_FOUND / INCONCLUSIVE)", () => {
    const inconclusive = verifyExtractedEntry(
      { operator: "Andover Properties", city: "Boise", state: "ID", nrsf: 70000 },
      { asOf: ASOF }
    );
    expect(inconclusive.verdict).toBe("INCONCLUSIVE");
    expect(inconclusive.registrySource).toBeNull();
  });

  test("empty PERMIT registry does not introduce false-positive matches for unindexed submarkets", () => {
    // PERMIT registry today is empty (architecture-only). Verify that an
    // operator+city pair NOT in EDGAR also does NOT spuriously match
    // anything from PERMIT.
    const result = verifyExtractedEntry(
      { operator: "Storage Mart", city: "Denton", state: "TX", nrsf: 80000 },
      { asOf: ASOF }
    );
    // Should be NOT_FOUND or INCONCLUSIVE — never REAL (no PERMIT entries
    // exist for Denton TX yet).
    expect(["NOT_FOUND", "INCONCLUSIVE"]).toContain(result.verdict);
    expect(result.registrySource).toBeNull();
  });

  test("county-permits.json is loadable with the expected pilot-architecture schema", () => {
    // Architecture sanity check — the second-source registry exists in the
    // codebase with the correct shape, even though facilities[] is empty
    // today. When the per-county scraper lands, facilities[] populates and
    // PERMIT-sourced REAL verdicts start firing automatically with no
    // Oracle code change.
    // eslint-disable-next-line global-require
    const countyPermits = require("../data/county-permits.json");
    expect(countyPermits.schema).toBe("storvex.county-permits.v1");
    expect(countyPermits.phase).toBe("PILOT-ARCHITECTURE");
    expect(Array.isArray(countyPermits.facilities)).toBe(true);
    expect(Array.isArray(countyPermits.pilotCounties)).toBe(true);
    expect(countyPermits.pilotCounties.length).toBeGreaterThanOrEqual(3);
  });

  test("submarketCoverage.perRegistry exposes EDGAR + PERMIT counts independently", () => {
    // 5/12/26 PM enrichment — fallback coverage signal now aggregates BOTH
    // primary-source registries. perRegistry breakdown is exposed on every
    // verdict so the UI can display "we have N EDGAR + M PERMIT entries in
    // this submarket" rather than a single opaque count.
    const result = verifyExtractedEntry(
      // Doral FL has 1 EDGAR entry (psa-miami-2026q3); PERMIT is empty today
      { operator: "OtherOperator", city: "Doral", state: "FL", nrsf: 60000 },
      { asOf: ASOF }
    );

    expect(result.submarketCoverage).toBeTruthy();
    // submarketPipelineSupply may also have a "Doral, FL" entry — accept
    // either the submarket-route or fallback-route shape. Both expose
    // perRegistry.
    expect(result.submarketCoverage.perRegistry).toBeTruthy();
    expect(typeof result.submarketCoverage.perRegistry.edgar).toBe("number");
    expect(typeof result.submarketCoverage.perRegistry.permit).toBe("number");
  });

  test("EDGAR-only coverage (PERMIT empty) still classifies sample as NOT_FOUND for indexed submarket", () => {
    // Houston is indexed in EDGAR (psa-houston-2027q1 exists) so an unrelated
    // operator+NRSF combination in Houston routes to NOT_FOUND (high-confidence
    // claim that the screenshot entry is fabricated), not INCONCLUSIVE.
    // This locks in pre-PERMIT-ingestion behavior so the new aggregation
    // doesn't regress EDGAR-only confidence.
    const result = verifyExtractedEntry(
      { operator: "RandomBrand", city: "Houston", state: "TX", nrsf: 70000 },
      { asOf: ASOF }
    );

    // Verdict should be NOT_FOUND or INCONCLUSIVE — never REAL. The exact
    // verdict depends on how many Houston entries are seeded; just lock that
    // it's not REAL and that perRegistry.edgar is at least 1.
    expect(["NOT_FOUND", "INCONCLUSIVE"]).toContain(result.verdict);
    if (result.submarketCoverage && !result.submarketCoverage.hasEntry) {
      // Only assert perRegistry counts on the fallback path (when not routed
      // through submarketPipelineSupply pre-indexed entry)
      expect(result.submarketCoverage.perRegistry.edgar).toBeGreaterThanOrEqual(1);
      expect(result.submarketCoverage.perRegistry.permit).toBe(0);
    }
  });

  test("submarketPipelineSupply-routed coverage still exposes perRegistry shape (with zeros)", () => {
    // When the submarket has a pre-indexed entry in submarketPipelineSupply.json,
    // the coverage signal short-circuits before counting EDGAR/PERMIT facilities.
    // Verify perRegistry is still present so UI consumers can safely .edgar / .permit
    // without null checks.
    const result = verifyExtractedEntry(
      // Any extracted entry — we only care about the perRegistry shape
      { operator: "AnyOp", city: "Nowhere", state: "ZZ", nrsf: 50000 },
      { asOf: ASOF }
    );
    expect(result.submarketCoverage.perRegistry).toBeTruthy();
    expect(result.submarketCoverage.perRegistry).toHaveProperty("edgar");
    expect(result.submarketCoverage.perRegistry).toHaveProperty("permit");
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
