// Tests for the Phase 2 multi-page postback machinery in
// scrape-county-permits-denton-tx.mjs.
//
// Runs via Node's built-in test runner:
//   node --test scripts/edgar/__tests__/denton-tx-pagination.test.mjs
//
// The shipping Denton portal (apps.dentoncounty.gov/DevPermit/) is a Telerik
// RadGrid in an ASP.NET WebForms page. These tests cover the four building
// blocks of the multi-page state machine in isolation — no live HTTP calls.
// Smoke-testing against the live portal is a separate workflow_dispatch run.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseAspNetState,
  findNextPageButton,
  mergeCookieJar,
  parseArgs,
  parseCityFromContext,
  DENTON_COUNTY_CITIES,
  rowToRecord,
  COL,
} from "../scrape-county-permits-denton-tx.mjs";

// ─── parseAspNetState ─────────────────────────────────────────────────────

describe("parseAspNetState", () => {
  test("extracts all three hidden fields from a real RadGrid response", () => {
    const html = `
      <html><body>
        <input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="fxc4wq4fDP/LUTUd" />
        <input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="EC7C998C" />
        <input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="LuUv2m21DgnR4X1Z" />
      </body></html>
    `;
    const state = parseAspNetState(html);
    assert.equal(state.viewstate, "fxc4wq4fDP/LUTUd");
    assert.equal(state.viewstateGenerator, "EC7C998C");
    assert.equal(state.eventValidation, "LuUv2m21DgnR4X1Z");
  });

  test("returns null fields when the page is non-WebForms (error page, blank, etc.)", () => {
    const state = parseAspNetState("<html><body>Server Error</body></html>");
    assert.equal(state.viewstate, null);
    assert.equal(state.viewstateGenerator, null);
    assert.equal(state.eventValidation, null);
  });

  test("tolerates fields without the id= attribute (compact-mode WebForms)", () => {
    const html = `
      <input name="__VIEWSTATE" value="V123" />
      <input name="__VIEWSTATEGENERATOR" value="G456" />
      <input name="__EVENTVALIDATION" value="E789" />
    `;
    const state = parseAspNetState(html);
    assert.equal(state.viewstate, "V123");
    assert.equal(state.viewstateGenerator, "G456");
    assert.equal(state.eventValidation, "E789");
  });
});

// ─── findNextPageButton ───────────────────────────────────────────────────

describe("findNextPageButton", () => {
  test("locates the rgPageNext submit button name (name before class)", () => {
    const html = `
      <input type="submit" name="ctl00$MainContent$rgReport$ctl00$ctl03$ctl01$ctl28" value=" " title="Next Page" class="rgPageNext" />
    `;
    assert.equal(
      findNextPageButton(html),
      "ctl00$MainContent$rgReport$ctl00$ctl03$ctl01$ctl28",
    );
  });

  test("locates the rgPageNext submit button name (class before name)", () => {
    const html = `
      <input type="submit" class="rgPageNext" name="ctl00$X$Y$ctl42" value=" " title="Next Page" />
    `;
    assert.equal(findNextPageButton(html), "ctl00$X$Y$ctl42");
  });

  test("returns null when the rgPageNext button is disabled on last page", () => {
    const html = `
      <input type="submit" name="ctl00$X$Y$ctl28" value=" " class="rgPageNextDisabled" disabled />
    `;
    assert.equal(findNextPageButton(html), null);
  });

  test("returns null when no rgPageNext is present (single-page result)", () => {
    const html = `<table><tr class="rgRow"><td>only row</td></tr></table>`;
    assert.equal(findNextPageButton(html), null);
  });

  test("does not match rgPageLast (different button)", () => {
    const html = `
      <input type="submit" name="ctl00$X$ctl29" value=" " title="Last Page" class="rgPageLast" />
    `;
    assert.equal(findNextPageButton(html), null);
  });
});

// ─── mergeCookieJar ───────────────────────────────────────────────────────

describe("mergeCookieJar", () => {
  test("builds a fresh jar from a single Set-Cookie header", () => {
    const result = mergeCookieJar(
      "",
      "ASP.NET_SessionId=abc123; path=/; HttpOnly",
    );
    assert.equal(result, "ASP.NET_SessionId=abc123");
  });

  test("strips Path/HttpOnly/Domain/SameSite attributes", () => {
    const result = mergeCookieJar(
      "",
      "FOO=bar; Domain=.dentoncounty.gov; Path=/; Secure; HttpOnly; SameSite=Lax",
    );
    assert.equal(result, "FOO=bar");
  });

  test("merges multiple comma-joined cookies into one jar", () => {
    // node-fetch / undici fold multiple Set-Cookie headers into a single
    // comma-separated string on .get('set-cookie')
    const result = mergeCookieJar(
      "",
      "ASP.NET_SessionId=abc123; path=/, RadGridState=foo; path=/",
    );
    assert.match(result, /ASP\.NET_SessionId=abc123/);
    assert.match(result, /RadGridState=foo/);
  });

  test("newer cookies overwrite same-name entries in existing jar", () => {
    const result = mergeCookieJar(
      "ASP.NET_SessionId=OLD; FOO=keep",
      "ASP.NET_SessionId=NEW; path=/",
    );
    assert.match(result, /ASP\.NET_SessionId=NEW/);
    assert.doesNotMatch(result, /ASP\.NET_SessionId=OLD/);
    assert.match(result, /FOO=keep/);
  });

  test("returns existing jar unchanged when Set-Cookie is null/undefined", () => {
    assert.equal(mergeCookieJar("FOO=bar", null), "FOO=bar");
    assert.equal(mergeCookieJar("FOO=bar", undefined), "FOO=bar");
    assert.equal(mergeCookieJar("FOO=bar", ""), "FOO=bar");
  });

  test("returns empty string when both inputs are empty", () => {
    assert.equal(mergeCookieJar("", ""), "");
    assert.equal(mergeCookieJar("", null), "");
  });

  test("handles cookies whose Expires attribute contains a comma", () => {
    // Cookies of the form "FOO=bar; Expires=Wed, 14 Jun 2026 ..." contain
    // an embedded comma that the splitter MUST NOT treat as a cookie
    // boundary. We split only on `,` followed by `name=` pattern.
    const result = mergeCookieJar(
      "",
      "FOO=bar; Expires=Wed, 14 Jun 2026 12:00:00 GMT; Path=/, BAZ=qux; Path=/",
    );
    assert.match(result, /FOO=bar/);
    assert.match(result, /BAZ=qux/);
    // Must NOT include the date-fragment as a cookie name
    assert.doesNotMatch(result, /14 Jun 2026/);
  });
});

// ─── parseArgs ────────────────────────────────────────────────────────────

describe("parseArgs", () => {
  // parseArgs reads from process.argv directly. We swap argv in/out around
  // each test to control inputs.

  function withArgv(args, fn) {
    const original = process.argv;
    process.argv = ["node", "scrape-county-permits-denton-tx.mjs", ...args];
    try {
      return fn();
    } finally {
      process.argv = original;
    }
  }

  test("defaults: maxPages=5, rateLimitMs=1500, dryRun=false, defaultCity=Denton, since≈24mo ago", () => {
    const opts = withArgv([], () => parseArgs());
    assert.equal(opts.maxPages, 5);
    assert.equal(opts.rateLimitMs, 1500);
    assert.equal(opts.dryRun, false);
    assert.equal(opts.defaultCity, "Denton");
    // since should be a YYYY-MM-DD string
    assert.match(opts.since, /^\d{4}-\d{2}-\d{2}$/);
    // and roughly 24 months in the past — allow 23-25 month tolerance to
    // dodge calendar-arithmetic edge cases on leap days etc.
    const sinceMs = new Date(opts.since).getTime();
    const monthsAgo = (Date.now() - sinceMs) / (1000 * 60 * 60 * 24 * 30);
    assert.ok(monthsAgo >= 23 && monthsAgo <= 25, `expected ~24mo ago, got ${monthsAgo.toFixed(1)} months`);
  });

  test("--max-pages=N parses to integer", () => {
    const opts = withArgv(["--max-pages=23"], () => parseArgs());
    assert.equal(opts.maxPages, 23);
  });

  test("--max-pages clamps to floor of 1", () => {
    const opts = withArgv(["--max-pages=0"], () => parseArgs());
    assert.equal(opts.maxPages, 1);
    const opts2 = withArgv(["--max-pages=-5"], () => parseArgs());
    assert.equal(opts2.maxPages, 1);
  });

  test("--max-pages clamps to ceiling of 2000", () => {
    const opts = withArgv(["--max-pages=999999"], () => parseArgs());
    assert.equal(opts.maxPages, 2000);
  });

  test("--rate-limit-ms=0 disables delays (for tests)", () => {
    const opts = withArgv(["--rate-limit-ms=0"], () => parseArgs());
    assert.equal(opts.rateLimitMs, 0);
  });

  test("--dryrun and --dry-run both set dryRun=true", () => {
    const a = withArgv(["--dryrun"], () => parseArgs());
    const b = withArgv(["--dry-run"], () => parseArgs());
    assert.equal(a.dryRun, true);
    assert.equal(b.dryRun, true);
  });

  test("--since=YYYY-MM-DD passes through", () => {
    const opts = withArgv(["--since=2025-01-01"], () => parseArgs());
    assert.equal(opts.since, "2025-01-01");
  });

  test("combination of flags parses cleanly", () => {
    const opts = withArgv(
      ["--max-pages=10", "--rate-limit-ms=500", "--since=2024-06-01", "--dryrun"],
      () => parseArgs(),
    );
    assert.equal(opts.maxPages, 10);
    assert.equal(opts.rateLimitMs, 500);
    assert.equal(opts.since, "2024-06-01");
    assert.equal(opts.dryRun, true);
  });

  test("--default-city=Frisco overrides the Denton county-seat fallback", () => {
    const opts = withArgv(["--default-city=Frisco"], () => parseArgs());
    assert.equal(opts.defaultCity, "Frisco");
  });
});

// ─── parseCityFromContext ─────────────────────────────────────────────────

describe("parseCityFromContext", () => {
  test("extracts a single-word city from legal description", () => {
    assert.equal(
      parseCityFromContext("ABCD ADDITION TO FRISCO BLK A LOT 1", ""),
      "Frisco",
    );
  });

  test("extracts a multi-word city (Flower Mound)", () => {
    assert.equal(
      parseCityFromContext("PEMBERTON HILL FLOWER MOUND BLK 3 LOT 7", ""),
      "Flower Mound",
    );
  });

  test("longest match wins — Highland Village beats Village", () => {
    assert.equal(
      parseCityFromContext("HIGHLAND VILLAGE SHORES BLK 2 LOT 4", ""),
      "Highland Village",
    );
  });

  test("falls back to address when legal description is empty", () => {
    assert.equal(parseCityFromContext("", "100 MAIN ST LITTLE ELM TX"), "Little Elm");
  });

  test("returns null when no Denton County city is named in either field", () => {
    // McKinney (Collin Co city) is NOT in DENTON_COUNTY_CITIES, so the
    // S&K MINI WAREHOUSES rows fall through to defaultCity in rowToRecord.
    assert.equal(
      parseCityFromContext(
        "EAST MCKINNEY STREET STORAGE ADDITION BLK A LOT 1",
        "8126 E MCKINNEY ST BLDG F1-F11",
      ),
      null,
    );
  });

  test("returns null on empty inputs", () => {
    assert.equal(parseCityFromContext("", ""), null);
    assert.equal(parseCityFromContext(null, null), null);
    assert.equal(parseCityFromContext(undefined, undefined), null);
  });

  test("whole-word matching — no partial-word false positives", () => {
    // "PRIVATEPLANTATIONS" should NOT match the city "PLANO"
    assert.equal(
      parseCityFromContext("PRIVATEPLANTATIONS SUBDIVISION", ""),
      null,
    );
  });

  test("case-insensitive — handles legal descriptions in lowercase or mixed case", () => {
    assert.equal(parseCityFromContext("subdivision in aubrey", ""), "Aubrey");
    assert.equal(parseCityFromContext("Pilot Point Heights", ""), "Pilot Point");
  });

  test("DENTON_COUNTY_CITIES is sorted longest-first to enable longest-match wins", () => {
    // Sanity check that the data list maintains its ordering invariant
    for (let i = 1; i < DENTON_COUNTY_CITIES.length; i++) {
      const prev = DENTON_COUNTY_CITIES[i - 1].length;
      const cur = DENTON_COUNTY_CITIES[i].length;
      assert.ok(
        prev >= cur,
        `DENTON_COUNTY_CITIES not longest-first at index ${i}: "${DENTON_COUNTY_CITIES[i - 1]}" (${prev}) precedes "${DENTON_COUNTY_CITIES[i]}" (${cur})`,
      );
    }
  });

  test("covers ≥30 Denton County municipalities (real coverage check)", () => {
    assert.ok(DENTON_COUNTY_CITIES.length >= 30);
  });
});

// ─── rowToRecord city resolution ──────────────────────────────────────────

describe("rowToRecord city resolution", () => {
  // Helper to build a fake RadGrid row with the right column positions.
  function makeRow({
    permitId = "20999999",
    applicantName = "TEST APPLICANT",
    applicantCompany = "PUBLIC STORAGE INC",
    address = "100 MAIN ST",
    legal = "TEST SUBDIVISION BLK A LOT 1",
    permitType = "COMMERCIAL BUILDING",
    dateApproved = "01/15/2025",
    propertyAccount = "12345",
    comments = "self-storage facility",
    permitStatus = "Approved",
    dateReceived = "01/01/2025",
    propertyOwner = "PUBLIC STORAGE LP",
  } = {}) {
    const row = new Array(13).fill("");
    row[COL.PermitID] = permitId;
    row[COL.ApplicantName] = applicantName;
    row[COL.ApplicantCompany] = applicantCompany;
    row[COL.PropertySitusAddress] = address;
    row[COL.PropertyLegalDescription] = legal;
    row[COL.PermitType] = permitType;
    row[COL.DateApproved] = dateApproved;
    row[COL.PropertyAccount] = propertyAccount;
    row[COL.Comments] = comments;
    row[COL.PermitStatus] = permitStatus;
    row[COL.DateReceived] = dateReceived;
    row[COL.PropertyOwner] = propertyOwner;
    return row;
  }

  test("uses extracted city when legal description contains a recognized name", () => {
    const row = makeRow({ legal: "FRISCO BOAT STORAGE ADDN BLK 1 LOT 1" });
    const rec = rowToRecord(row, { minSince: "2020-01-01" });
    assert.equal(rec.city, "Frisco");
    assert.match(rec.notes, /City resolution: extracted/);
  });

  test("falls back to defaultCity when no city name appears in row text", () => {
    const row = makeRow({
      legal: "EAST MCKINNEY STREET STORAGE ADDITION BLK A LOT 1",
      address: "8126 E MCKINNEY ST",
    });
    const rec = rowToRecord(row, { minSince: "2020-01-01", defaultCity: "Denton" });
    assert.equal(rec.city, "Denton");
    assert.match(rec.notes, /City resolution: default \(fallback to Denton\)/);
  });

  test("defaultCity is overridable per-call (Frisco backfill scenario)", () => {
    const row = makeRow({
      legal: "ANONYMOUS SUBDIVISION BLK A LOT 1",
      address: "100 NAMELESS ST",
    });
    const rec = rowToRecord(row, { minSince: "2020-01-01", defaultCity: "Frisco" });
    assert.equal(rec.city, "Frisco");
    assert.match(rec.notes, /fallback to Frisco/);
  });

  test("when defaultCity is omitted entirely, falls back to 'Denton'", () => {
    const row = makeRow({
      legal: "ANONYMOUS SUBDIVISION BLK A LOT 1",
      address: "100 NAMELESS ST",
    });
    const rec = rowToRecord(row, { minSince: "2020-01-01" });
    assert.equal(rec.city, "Denton");
  });

  test("extracted city wins over defaultCity (extraction is preferred)", () => {
    const row = makeRow({ legal: "TROPHY CLUB SUBDIVISION BLK A LOT 1" });
    const rec = rowToRecord(row, {
      minSince: "2020-01-01",
      defaultCity: "Anyplace",
    });
    assert.equal(rec.city, "Trophy Club");
  });

  test("S&K MINI WAREHOUSES batch (the smoke-test repro) now validates", () => {
    // This row mirrors the 7 S&K MINI WAREHOUSES permits that smoke-test
    // detected on page 13 but rejected for missing city. With Denton fallback
    // the records now flow through.
    const row = makeRow({
      permitId: "20231929",
      applicantName: "S&K MINI WAREHOUSES",
      applicantCompany: "S&K MINI WREHOUSES TX LLC",
      address: "8126 E MCKINNEY ST BLDG F1-F11",
      legal: "EAST MCKINNEY STREET STORAGE ADDITION BLK A LOT 1",
      permitType: "COMMERCIAL RETAIL",
      comments: "EXISTING MIXED USE COMMERCIAL BLDG",
    });
    const rec = rowToRecord(row, { minSince: "2020-01-01" });
    assert.ok(rec, "record should not be null");
    assert.equal(rec.city, "Denton");
    assert.equal(rec.state, "TX");
    assert.match(rec.verifiedSource, /^permit-denton-tx-20231929$/);
  });
});
