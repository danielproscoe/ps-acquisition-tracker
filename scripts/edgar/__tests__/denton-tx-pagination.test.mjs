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

  test("defaults: maxPages=5, rateLimitMs=1500, dryRun=false, since≈24mo ago", () => {
    const opts = withArgv([], () => parseArgs());
    assert.equal(opts.maxPages, 5);
    assert.equal(opts.rateLimitMs, 1500);
    assert.equal(opts.dryRun, false);
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
});
