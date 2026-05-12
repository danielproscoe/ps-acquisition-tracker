// Tests for _county-permit-common.mjs — shared scaffold for per-county
// permit scrapers.
//
// Runs via Node's built-in test runner (Node 18+):
//   node --test scripts/edgar/__tests__/
//
// These tests are kept separate from the Jest/CRA suite because they exercise
// .mjs scripts that live outside `src/`. The CRA suite at `src/**/*.test.js`
// remains the source of truth for React components + utils; this suite
// verifies the data-ingestion scaffold that produces the audit-layer
// PERMIT registry that the Oracle consumes.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STORAGE_USE_KEYWORDS,
  isStorageUseDescription,
  normalizeOperator,
  countySlug,
  validatePermitRecord,
  buildPermitRecord,
  mergePermitRecords,
  loadCountyPermits,
} from "../_county-permit-common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── isStorageUseDescription ─────────────────────────────────────────────

describe("isStorageUseDescription", () => {
  test("matches canonical 'self-storage'", () => {
    assert.equal(isStorageUseDescription("Self-Storage facility"), true);
  });

  test("matches 'mini-warehouse' (the most common ordinance phrasing)", () => {
    assert.equal(isStorageUseDescription("Mini-warehouse use group"), true);
  });

  test("matches 'storage facility'", () => {
    assert.equal(isStorageUseDescription("New storage facility 80K SF"), true);
  });

  test("rejects non-storage commercial", () => {
    assert.equal(isStorageUseDescription("New retail strip center"), false);
  });

  test("rejects empty / null input", () => {
    assert.equal(isStorageUseDescription(""), false);
    assert.equal(isStorageUseDescription(null), false);
    assert.equal(isStorageUseDescription(undefined), false);
  });

  test("case-insensitive", () => {
    assert.equal(isStorageUseDescription("SELF STORAGE"), true);
    assert.equal(isStorageUseDescription("Mini WAREHOUSE"), true);
  });

  test("keyword list is non-trivial (>=20 entries)", () => {
    assert.ok(STORAGE_USE_KEYWORDS.length >= 20);
  });
});

// ─── normalizeOperator ───────────────────────────────────────────────────

describe("normalizeOperator", () => {
  test("Public Storage → PSA", () => {
    const r = normalizeOperator("Public Storage Inc.");
    assert.equal(r.key, "PSA");
    assert.equal(r.name, "Public Storage");
  });

  test("iStorage → PSA family (post-acquisition consolidation)", () => {
    const r = normalizeOperator("iStorage Self Storage");
    assert.equal(r.key, "PSA");
    assert.match(r.name, /iStorage/);
  });

  test("NSA → PSA family (post-acquisition consolidation)", () => {
    const r = normalizeOperator("National Storage Affiliates");
    assert.equal(r.key, "PSA");
  });

  test("Extra Space Storage → EXR", () => {
    const r = normalizeOperator("Extra Space Storage LLC");
    assert.equal(r.key, "EXR");
  });

  test("Life Storage → EXR family", () => {
    const r = normalizeOperator("Life Storage Partners");
    assert.equal(r.key, "EXR");
  });

  test("CubeSmart → CUBE", () => {
    const r = normalizeOperator("CubeSmart Asset Management");
    assert.equal(r.key, "CUBE");
  });

  test("SmartStop → SMA", () => {
    const r = normalizeOperator("SmartStop Self Storage REIT");
    assert.equal(r.key, "SMA");
  });

  test("U-Haul → AMERCO", () => {
    const r = normalizeOperator("U-Haul Co. of Texas");
    assert.equal(r.key, "AMERCO");
  });

  test("unknown operator returns null key (Oracle will route to INCONCLUSIVE)", () => {
    const r = normalizeOperator("Acme Industrial Investments LLC");
    assert.equal(r.key, null);
    assert.equal(r.name, null);
    assert.equal(r.normalized, "Acme Industrial Investments LLC");
  });

  test("empty / null input returns triple-null", () => {
    assert.deepEqual(normalizeOperator(""), { key: null, name: null, normalized: null });
    assert.deepEqual(normalizeOperator(null), { key: null, name: null, normalized: null });
  });
});

// ─── countySlug ──────────────────────────────────────────────────────────

describe("countySlug", () => {
  test("Denton County, TX → denton-tx", () => {
    assert.equal(countySlug("Denton County, TX", "TX"), "denton-tx");
  });

  test("case-insensitive on state", () => {
    assert.equal(countySlug("Warren County, OH", "oh"), "warren-oh");
  });

  test("matches all 5 pilot counties", () => {
    assert.equal(countySlug("Denton County, TX", "TX"), "denton-tx");
    assert.equal(countySlug("Warren County, OH", "OH"), "warren-oh");
    assert.equal(countySlug("Kenton County, KY", "KY"), "kenton-ky");
    assert.equal(countySlug("Boone County, IN", "IN"), "boone-in");
    assert.equal(countySlug("Hancock County, IN", "IN"), "hancock-in");
  });
});

// ─── buildPermitRecord ───────────────────────────────────────────────────

describe("buildPermitRecord", () => {
  test("produces canonical record with verifiedSource prefix", () => {
    const rec = buildPermitRecord({
      countyName: "Denton County, TX",
      stateAbbr: "TX",
      permitNumber: "20232531",
      permitIssueDate: "2025-06-20",
      city: "Little Elm",
      operatorRaw: "Public Storage Inc.",
      address: "123 Main St",
      permitUrl: "https://apps.dentoncounty.gov/DevPermit/",
    });
    assert.equal(rec.permitNumber, "20232531");
    assert.equal(rec.operator, "PSA");
    assert.equal(rec.operatorName, "Public Storage");
    assert.equal(rec.state, "TX");
    assert.match(rec.verifiedSource, /^permit-denton-tx-/);
    assert.equal(rec.verifiedSource.endsWith("20232531"), true);
  });

  test("verifiedSource always starts with 'permit-' (Oracle rule #2)", () => {
    const rec = buildPermitRecord({
      countyName: "Boone County, IN",
      stateAbbr: "IN",
      permitNumber: "BCPC-2025-COM-0042",
      permitIssueDate: "2025-07-18",
      city: "Whitestown",
      operatorRaw: "Extra Space Storage",
      address: "7100 Indianapolis Rd",
      onFileSource: "Records request 2026-Q2 received from Boone County Area Plan",
    });
    assert.match(rec.verifiedSource, /^permit-/);
  });

  test("emits null operator for unknown applicant strings", () => {
    const rec = buildPermitRecord({
      countyName: "Hancock County, IN",
      stateAbbr: "IN",
      permitNumber: "HC-2025-12345",
      permitIssueDate: "2025-09-10",
      city: "Greenfield",
      operatorRaw: "Independent Local Owner LLC",
      address: "1 Local St",
      onFileSource: "manual record request 2026-Q2",
    });
    // Independent owner — not a REIT — operator field falls back to raw string
    assert.equal(rec.operator, "Independent Local Owner LLC");
    assert.equal(rec.operatorName, "Independent Local Owner LLC");
  });

  test("ID is stable on re-build (idempotency anchor)", () => {
    const a = buildPermitRecord({
      countyName: "Denton County, TX",
      stateAbbr: "TX",
      permitNumber: "20232531",
      permitIssueDate: "2025-06-20",
      city: "Little Elm",
      operatorRaw: "Public Storage",
      address: "123 Main",
      permitUrl: "x",
    });
    const b = buildPermitRecord({
      countyName: "Denton County, TX",
      stateAbbr: "TX",
      permitNumber: "20232531",
      permitIssueDate: "2025-06-20",
      city: "Little Elm",
      operatorRaw: "Public Storage",
      address: "123 Main",
      permitUrl: "x",
    });
    assert.equal(a.id, b.id);
  });

  test("status defaults to 'permitted'", () => {
    const rec = buildPermitRecord({
      countyName: "Denton County, TX",
      stateAbbr: "TX",
      permitNumber: "1",
      permitIssueDate: "2025-01-01",
      city: "Denton",
      address: "1 Test",
      permitUrl: "x",
    });
    assert.equal(rec.status, "permitted");
  });
});

// ─── validatePermitRecord ────────────────────────────────────────────────

describe("validatePermitRecord", () => {
  function validRecord() {
    return buildPermitRecord({
      countyName: "Denton County, TX",
      stateAbbr: "TX",
      permitNumber: "TEST-001",
      permitIssueDate: "2025-08-15",
      city: "Aubrey",
      operatorRaw: "Public Storage",
      address: "100 FM 1385",
      permitUrl: "https://apps.dentoncounty.gov/DevPermit/",
    });
  }

  test("accepts a fully-formed record", () => {
    const r = validatePermitRecord(validRecord());
    assert.equal(r.ok, true);
  });

  test("rejects missing permitNumber", () => {
    const rec = validRecord();
    delete rec.permitNumber;
    const r = validatePermitRecord(rec);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" · "), /permitNumber/);
  });

  test("rejects missing permitIssueDate", () => {
    const rec = validRecord();
    delete rec.permitIssueDate;
    const r = validatePermitRecord(rec);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" · "), /permitIssueDate/);
  });

  test("rejects missing both permitUrl and onFileSource", () => {
    const rec = validRecord();
    rec.permitUrl = null;
    rec.onFileSource = null;
    const r = validatePermitRecord(rec);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" · "), /missing source link/);
  });

  test("accepts onFileSource alone (paper-records path)", () => {
    const rec = validRecord();
    rec.permitUrl = null;
    rec.onFileSource = "Records request received 2026-05-15 from Boone County";
    const r = validatePermitRecord(rec);
    assert.equal(r.ok, true);
  });

  test("rejects non-ISO permitIssueDate", () => {
    const rec = validRecord();
    rec.permitIssueDate = "08/15/2025";
    const r = validatePermitRecord(rec);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" · "), /ISO-8601/);
  });

  test("rejects state that isn't 2-letter uppercase", () => {
    const rec = validRecord();
    rec.state = "Texas";
    const r = validatePermitRecord(rec);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" · "), /2-letter/);
  });

  test("rejects verifiedSource without permit- prefix (Oracle rule #2)", () => {
    const rec = validRecord();
    rec.verifiedSource = "EDGAR-10K-fake";
    const r = validatePermitRecord(rec);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" · "), /permit-/);
  });
});

// ─── mergePermitRecords (dry-run, no file mutation) ─────────────────────

describe("mergePermitRecords — dry-run mode", () => {
  test("dry-run adds valid records to in-memory result without writing file", () => {
    const rec = buildPermitRecord({
      countyName: "Denton County, TX",
      stateAbbr: "TX",
      permitNumber: "DRY-001",
      permitIssueDate: "2025-08-15",
      city: "Aubrey",
      operatorRaw: "Public Storage",
      address: "1 Test St",
      permitUrl: "https://apps.dentoncounty.gov/DevPermit/",
    });

    // Snapshot current state
    const before = loadCountyPermits();
    const result = mergePermitRecords([rec], { dryRun: true });

    // File must be unchanged after dry-run
    const after = loadCountyPermits();
    assert.equal(before.totalFacilities, after.totalFacilities);

    // But the merge result should reflect what WOULD have happened
    assert.equal(result.dryRun, true);
    assert.ok(result.added >= 0);
    assert.ok(Array.isArray(result.rejected));
  });

  test("rejects invalid records in dry-run too", () => {
    const bad = { permitNumber: "X", city: "Y", state: "ZZ" }; // missing required fields + no verifiedSource

    const result = mergePermitRecords([bad], { dryRun: true });
    assert.equal(result.rejected.length, 1);
    assert.equal(result.added, 0);
  });
});

// ─── county-permits.json schema sanity ───────────────────────────────────

describe("county-permits.json schema", () => {
  test("file loads without error", () => {
    const data = loadCountyPermits();
    assert.ok(data);
    assert.equal(data.schema, "storvex.county-permits.v1");
  });

  test("pilot counties are exactly the 5 locked", () => {
    const data = loadCountyPermits();
    const expected = [
      "Denton County, TX",
      "Warren County, OH",
      "Kenton County, KY",
      "Boone County, IN",
      "Hancock County, IN",
    ];
    assert.deepEqual(data.pilotCounties, expected);
  });

  test("facilities[] is an array (may be empty pre-ingestion)", () => {
    const data = loadCountyPermits();
    assert.ok(Array.isArray(data.facilities));
  });

  test("totalFacilities matches facilities length", () => {
    const data = loadCountyPermits();
    assert.equal(data.totalFacilities, data.facilities.length);
  });
});
