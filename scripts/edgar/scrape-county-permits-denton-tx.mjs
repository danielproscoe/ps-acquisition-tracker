// scrape-county-permits-denton-tx.mjs — Denton County, TX permit scraper.
//
// PORTAL
// ------
// apps.dentoncounty.gov/DevPermit/ · ASP.NET WebForms · Telerik RadGrid
// 56,691+ permit records (1,134 pages × 50 default · selectable up to 1,000/pg)
//
// Each row exposes (column order, 0-indexed):
//   0  PermitID           e.g. "20232531"
//   1  ApplicantName      e.g. "MATTHEW HILES"
//   2  ApplicantCompany   e.g. "4600 GANZER INVESTMENTS, LLC"
//   3  PropertySitusAddress  e.g. "3272 Ganzer Rd #1220"
//   4  PropertyLegalDescription  e.g. "LUXE ADDITION BLK A LOT 1"
//   5  PermitType         e.g. "DUPLEX" / "WAREHOUSE" / "COMMERCIAL"
//   6  DateApproved       e.g. "06/20/2023" (MM/DD/YYYY)
//   7  PropertyAccount    DCAD account #
//   8  Comments           free-text
//   9  PermitStatus       e.g. "Approved"
//   10 DateReceived       e.g. "05/10/2023"
//   11 PropertyOwner      e.g. "4000 GANZER INVESTMENTS LLC"
//   12+ misc culvert / driveway / inspection flags (ignored)
//
// STRATEGY
// --------
// Denton County's RadGrid doesn't expose a use-code column with a "storage"
// option, but storage-related projects surface in:
//   - PermitType   "WAREHOUSE" / "COMMERCIAL" / "OTHER"
//   - ApplicantCompany / PropertyOwner  contains operator brand name
//   - Comments                          contains "storage" / "mini-warehouse"
//
// The scraper walks pages of recent permits and applies a multi-signal
// classifier:
//   STORAGE_FLAG = (operator pattern match) OR (storage keyword in comments
//                  / legal description / applicant company)
//   AND PermitStatus === "Approved"
//
// CLI
// ---
//   node scrape-county-permits-denton-tx.mjs [--max-pages=N] [--page-size=N]
//                                            [--since=YYYY-MM-DD] [--dryrun]
//
//   --max-pages   default 5 (covers ~5,000 permits at page-size 1000 — full
//                 recent-12-month inventory for a county this size)
//   --page-size   default 200 (50/100/200/1000 valid — server enforces)
//   --since       only keep permits where DateApproved >= since (default
//                 24 months ago, matching the typical pipeline horizon)
//   --dryrun      print results, do not write to county-permits.json
//
// MULTI-STEP POSTBACK — Phase 2 IMPLEMENTED 5/12/26
// -------------------
// ASP.NET WebForms RadGrid pagination requires preserving form state +
// session cookies across requests. Confirmed live mechanism:
//
//   1. GET / → capture __VIEWSTATE, __VIEWSTATEGENERATOR, __EVENTVALIDATION,
//              and ASP.NET_SessionId cookie. Returns page 1.
//   2. To advance to page 2+: POST / with the application/x-www-form-urlencoded
//      body containing:
//        __EVENTTARGET     = "" (empty — submit button activates server event)
//        __EVENTARGUMENT   = ""
//        __VIEWSTATE       = (latest captured value — changes each response)
//        __VIEWSTATEGENERATOR = (latest captured)
//        __EVENTVALIDATION = (latest captured)
//        <NextPageBtnName> = " "  (the rgPageNext input's name + space value)
//      with Cookie header carrying ASP.NET_SessionId.
//   3. Parse the response, re-extract form state + the new rgPageNext button
//      name (the ctlNN suffix shifts when the pager set rolls forward), and
//      repeat until the rgPageNext button disappears (last page) or
//      --max-pages reached.
//
// Daily cron mode (default --max-pages=1): scrapes page 1 only — covers the
// daily delta of ~50 permits. Backfill mode (--max-pages=1134) walks the full
// 56,691-permit history at ~1.5s per page (~28 min total).
//
// Page-size change postback (PageSizeComboBox) is a separate sprint — adds
// throughput but doubles state-machine complexity. Daily ROI is fine at 50/page.

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPermitRecord,
  countySlug,
  httpGet,
  isStorageUseDescription,
  mergePermitRecords,
  normalizeOperator,
  printSummary,
} from "./_county-permit-common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORTAL_URL = "https://apps.dentoncounty.gov/DevPermit/";
const COUNTY_NAME = "Denton County, TX";
const STATE = "TX";
const SLUG = countySlug(COUNTY_NAME, STATE);
const NAME = "denton-tx";

// ─── Column index map ──────────────────────────────────────────────────────

const COL = {
  PermitID: 0,
  ApplicantName: 1,
  ApplicantCompany: 2,
  PropertySitusAddress: 3,
  PropertyLegalDescription: 4,
  PermitType: 5,
  DateApproved: 6,
  PropertyAccount: 7,
  Comments: 8,
  PermitStatus: 9,
  DateReceived: 10,
  PropertyOwner: 11,
};

// ─── ASP.NET form-state extraction ─────────────────────────────────────────

function extractHidden(html, name) {
  const re = new RegExp(`name="${name}"\\s+id="${name}"\\s+value="([^"]*)"`, "i");
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`name="${name}"\\s+value="([^"]*)"`, "i");
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

/**
 * Extract the full ASP.NET WebForms postback state from a response HTML.
 * Returns the three hidden fields needed to issue a valid follow-up POST.
 * Returns null fields when the page is non-WebForms (e.g., an error page);
 * the caller should treat that as the end of pagination.
 */
function parseAspNetState(html) {
  return {
    viewstate: extractHidden(html, "__VIEWSTATE"),
    viewstateGenerator: extractHidden(html, "__VIEWSTATEGENERATOR"),
    eventValidation: extractHidden(html, "__EVENTVALIDATION"),
  };
}

/**
 * Locate the "Next Page" submit button name in the rendered pager. RadGrid
 * emits `<input type="submit" name="ctl00$...$ctlNN" class="rgPageNext" />`
 * but the ctlNN suffix shifts as the pager set rolls forward (page 1 → ctl28,
 * page 11 → some other ctl), so we re-parse after every response. Returns
 * null when the button isn't present, signaling the last page.
 *
 * Returns null if the rgPageNext button is disabled — Telerik adds the
 * disabled rgPageNextDisabled class instead of removing the element on the
 * last page. Treat both shapes as "no next page."
 */
function findNextPageButton(html) {
  if (/class="rgPageNextDisabled/i.test(html)) return null;
  const order1 = html.match(
    /<input[^>]*type="submit"[^>]*name="([^"]+)"[^>]*class="rgPageNext"/i,
  );
  if (order1) return order1[1];
  const order2 = html.match(
    /<input[^>]*class="rgPageNext"[^>]*name="([^"]+)"/i,
  );
  return order2 ? order2[1] : null;
}

/**
 * Parse a Set-Cookie response header into a `name=value` cookie jar string
 * suitable for the Cookie request header. node-fetch (and undici) folds
 * multiple Set-Cookie headers into one comma-joined string; this splitter
 * handles that and strips Path / HttpOnly / Domain / SameSite attributes.
 *
 * Merges with an existing jar — newer cookies overwrite same-name entries.
 */
function mergeCookieJar(existing, setCookieHeader) {
  const jar = new Map();
  if (existing) {
    for (const pair of existing.split(/;\s*/)) {
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
  if (setCookieHeader) {
    // Cookies are comma-separated at the top level but date values may also
    // contain commas (e.g. "Expires=Wed, 14 Jun 2026 ...") — split on /, \s*\w+=/
    // boundaries which works for the simple ASP.NET cookies we see in practice.
    const cookies = setCookieHeader.split(/,(?=\s*[A-Za-z0-9_\-.]+=)/);
    for (const c of cookies) {
      const firstPair = c.split(";")[0].trim();
      const eq = firstPair.indexOf("=");
      if (eq > 0) jar.set(firstPair.slice(0, eq), firstPair.slice(eq + 1));
    }
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

// ─── Row extraction ────────────────────────────────────────────────────────

function extractRows(html) {
  // Telerik RadGrid emits <tr class="rgRow"> and <tr class="rgAltRow">
  // with <td>cell</td> children. We parse them with a focused regex —
  // <tr> is wrapped on its own line and rows do not nest.
  const trRe = /<tr class="(?:rgRow|rgAltRow)"\s+id="[^"]*">([\s\S]*?)<\/tr>/g;
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  const rows = [];
  let trMatch;
  while ((trMatch = trRe.exec(html))) {
    const trInner = trMatch[1];
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRe.exec(trInner))) {
      cells.push(stripHtml(tdMatch[1]).trim());
    }
    if (cells.length >= 12) rows.push(cells);
  }
  return rows;
}

function stripHtml(s) {
  return String(s)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Date conversion ───────────────────────────────────────────────────────

function parseMDY(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

// ─── Storage classifier ────────────────────────────────────────────────────

const PERMIT_TYPE_STORAGE_HINTS = [
  "WAREHOUSE",
  "STORAGE",
  "COMMERCIAL",
];

function isLikelyStorage(row) {
  const permitType = (row[COL.PermitType] || "").toUpperCase();
  const applicantCo = row[COL.ApplicantCompany] || "";
  const propertyOwner = row[COL.PropertyOwner] || "";
  const comments = row[COL.Comments] || "";
  const legalDesc = row[COL.PropertyLegalDescription] || "";
  const address = row[COL.PropertySitusAddress] || "";

  // Permit type hint
  const typeHinted = PERMIT_TYPE_STORAGE_HINTS.some((kw) => permitType.includes(kw));

  // Operator brand name in applicant/owner
  const op1 = normalizeOperator(applicantCo);
  const op2 = normalizeOperator(propertyOwner);
  const operatorHit = !!(op1.key || op2.key);

  // Keyword in free-text fields
  const keywordHit =
    isStorageUseDescription(comments) ||
    isStorageUseDescription(legalDesc) ||
    isStorageUseDescription(address) ||
    isStorageUseDescription(applicantCo) ||
    isStorageUseDescription(propertyOwner);

  return operatorHit || keywordHit || (typeHinted && keywordHit);
}

// ─── Address parsing ───────────────────────────────────────────────────────

function parseCityFromLegal(legalDesc) {
  // Many TX legal descriptions reference subdivision name only — city is
  // captured separately during geocoding. For Denton County, ~50% of permits
  // are in the unincorporated county; the rest distribute across Denton,
  // Lewisville, Flower Mound, Frisco, Little Elm, etc. The scraper writes
  // city: null when unclear; the orchestrator runs a follow-up geocode
  // pass that fills city from coordinates.
  return null;
}

// ─── Page fetching with WebForms state persistence ─────────────────────────

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Initial GET against the Denton portal. Returns the parsed page-1 HTML,
 * extracted ASP.NET form state, and the cookie jar (ASP.NET_SessionId etc).
 * Throws on non-200 status — caller treats that as a hard failure.
 */
async function fetchInitial(url = PORTAL_URL) {
  const res = await httpGet(url);
  if (res.status !== 200) {
    throw new Error(`Denton portal returned HTTP ${res.status}`);
  }
  const cookies = mergeCookieJar("", res.headers["set-cookie"]);
  return {
    html: res.body,
    state: parseAspNetState(res.body),
    cookies,
  };
}

/**
 * Submit the "Next Page" pager button. Returns the same shape as fetchInitial
 * — { html, state, cookies } — with cookies merged forward and form state
 * re-extracted from the new response. Returns null when:
 *   - buttonName is null (last page reached)
 *   - response is non-200 (treat as end of pagination, log + continue)
 *   - resulting HTML lacks rgRow markers (server rejected the postback)
 */
async function fetchNextPage(url, prevState, prevCookies, buttonName) {
  if (!buttonName) return null;
  if (!prevState.viewstate) {
    throw new Error("missing __VIEWSTATE — cannot post pagination request");
  }

  const params = new URLSearchParams();
  params.append("__EVENTTARGET", "");
  params.append("__EVENTARGUMENT", "");
  params.append("__VIEWSTATE", prevState.viewstate);
  if (prevState.viewstateGenerator) {
    params.append("__VIEWSTATEGENERATOR", prevState.viewstateGenerator);
  }
  if (prevState.eventValidation) {
    params.append("__EVENTVALIDATION", prevState.eventValidation);
  }
  // The submit button itself goes in the form data — its `name=value` pair
  // is what ASP.NET reads to fire the right server-side event handler. The
  // rendered value is a single space (RadGrid uses CSS background image for
  // the arrow icon).
  params.append(buttonName, " ");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": DEFAULT_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: new URL(url).origin,
      Referer: url,
      Cookie: prevCookies,
    },
    body: params.toString(),
  });

  if (res.status !== 200) {
    return { html: null, state: prevState, cookies: prevCookies, status: res.status };
  }

  const html = await res.text();
  const setCookie = res.headers.get("set-cookie");
  const cookies = mergeCookieJar(prevCookies, setCookie);
  return {
    html,
    state: parseAspNetState(html),
    cookies,
    status: 200,
  };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Page → records ────────────────────────────────────────────────────────

function rowToRecord(row, opts = {}) {
  const { minSince } = opts;

  const dateApproved = parseMDY(row[COL.DateApproved]);
  const dateReceived = parseMDY(row[COL.DateReceived]);
  const permitIssueDate = dateApproved || dateReceived;
  const status = (row[COL.PermitStatus] || "").trim();

  if (!permitIssueDate) return null;
  if (minSince && permitIssueDate < minSince) return null;
  // Only consider approved permits — pending/withdrawn aren't in the
  // VERIFIED pipeline.
  if (status && !/approved/i.test(status)) return null;

  if (!isLikelyStorage(row)) return null;

  const applicantCo = row[COL.ApplicantCompany] || "";
  const propertyOwner = row[COL.PropertyOwner] || "";
  const operatorRaw = applicantCo || propertyOwner;

  const rec = buildPermitRecord({
    countyName: COUNTY_NAME,
    stateAbbr: STATE,
    permitNumber: row[COL.PermitID],
    permitIssueDate,
    jurisdiction: "Denton County, TX (unincorporated + ETJ municipalities)",
    operatorRaw,
    address: row[COL.PropertySitusAddress] || null,
    city: parseCityFromLegal(row[COL.PropertyLegalDescription]) || null,
    description: [
      row[COL.PermitType],
      row[COL.PropertyLegalDescription],
      row[COL.Comments],
    ]
      .filter(Boolean)
      .join(" · "),
    permitUrl: PORTAL_URL,
    status: status.toLowerCase().includes("approved") ? "permitted" : "announced",
    notes: `DCAD account ${row[COL.PropertyAccount] || "?"}. Applicant: ${row[COL.ApplicantName] || "?"}.`,
  });

  return rec;
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    maxPages: 5,
    pageSize: 200,
    since: null,
    dryRun: false,
    rateLimitMs: 1500,
  };
  for (const a of args) {
    if (a === "--dryrun" || a === "--dry-run") opts.dryRun = true;
    else if (a.startsWith("--max-pages=")) opts.maxPages = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--page-size=")) opts.pageSize = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--since=")) opts.since = a.split("=")[1];
    else if (a.startsWith("--rate-limit-ms=")) opts.rateLimitMs = parseInt(a.split("=")[1], 10);
  }
  // Default since = 24 months ago
  if (!opts.since) {
    const d = new Date();
    d.setMonth(d.getMonth() - 24);
    opts.since = d.toISOString().slice(0, 10);
  }
  // Floor max-pages at 1, ceiling at 2000 (defensive — 1134 is the real cap
  // at default page-size; 2000 covers larger page-size requests if/when the
  // PageSizeComboBox postback ships).
  if (!Number.isFinite(opts.maxPages) || opts.maxPages < 1) opts.maxPages = 1;
  if (opts.maxPages > 2000) opts.maxPages = 2000;
  if (!Number.isFinite(opts.rateLimitMs) || opts.rateLimitMs < 0) opts.rateLimitMs = 1500;
  return opts;
}

async function main() {
  const opts = parseArgs();
  console.log(`[${NAME}] starting · portal=${PORTAL_URL}`);
  console.log(
    `[${NAME}] options: maxPages=${opts.maxPages} pageSize=${opts.pageSize} since=${opts.since} rateLimitMs=${opts.rateLimitMs} dryRun=${opts.dryRun}`
  );

  let totalRows = 0;
  let totalStorage = 0;
  const records = [];

  try {
    // ── Page 1 (GET) ──────────────────────────────────────────────────────
    let page = await fetchInitial(PORTAL_URL);
    let pageIndex = 1;
    let html = page.html;
    let state = page.state;
    let cookies = page.cookies;

    while (true) {
      const rows = extractRows(html);
      totalRows += rows.length;

      let pageStorageCount = 0;
      for (const r of rows) {
        const rec = rowToRecord(r, { minSince: opts.since });
        if (rec) {
          pageStorageCount++;
          records.push(rec);
        }
      }
      totalStorage += pageStorageCount;

      console.log(
        `[${NAME}] page ${pageIndex} scraped — ${rows.length} rows · ${pageStorageCount} storage-classified · running storage total ${totalStorage}`
      );

      if (pageIndex >= opts.maxPages) {
        console.log(`[${NAME}] reached --max-pages=${opts.maxPages} · stopping pagination`);
        break;
      }

      const nextBtn = findNextPageButton(html);
      if (!nextBtn) {
        console.log(`[${NAME}] no rgPageNext button in page ${pageIndex} response · last page reached`);
        break;
      }

      if (opts.rateLimitMs > 0) await delay(opts.rateLimitMs);

      const next = await fetchNextPage(PORTAL_URL, state, cookies, nextBtn);
      if (!next || !next.html) {
        console.log(
          `[${NAME}] postback to page ${pageIndex + 1} returned HTTP ${next?.status || "?"} · stopping pagination`
        );
        break;
      }

      // Sanity check: if the new HTML has no row markers, the server likely
      // returned an error page or a partial UpdatePanel response. Bail out
      // rather than spin.
      if (!/<tr class="(?:rgRow|rgAltRow)"/i.test(next.html)) {
        console.log(
          `[${NAME}] page ${pageIndex + 1} response has no rgRow markers · bailing`
        );
        break;
      }

      html = next.html;
      state = next.state;
      cookies = next.cookies;
      pageIndex++;
    }
  } catch (e) {
    console.error(`[${NAME}] ERROR: ${e.message}`);
    process.exit(2);
  }

  console.log(
    `[${NAME}] scan complete — totalRows=${totalRows} storageClassified=${totalStorage}`
  );

  const result = mergePermitRecords(records, { dryRun: opts.dryRun });
  printSummary(NAME, result);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("scrape-county-permits-denton-tx.mjs");

if (isMain) {
  main().catch((e) => {
    console.error(`[${NAME}] FATAL: ${e.stack || e.message}`);
    process.exit(1);
  });
}

// ─── Exports for tests ─────────────────────────────────────────────────────

export {
  extractRows,
  rowToRecord,
  isLikelyStorage,
  parseMDY,
  stripHtml,
  parseAspNetState,
  findNextPageButton,
  mergeCookieJar,
  parseArgs,
  COL,
  NAME,
  COUNTY_NAME,
  STATE,
  SLUG,
};
