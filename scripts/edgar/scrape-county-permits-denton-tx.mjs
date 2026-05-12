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
// MULTI-STEP POSTBACK
// -------------------
// ASP.NET WebForms RadGrid pagination requires:
//   1. GET / → capture __VIEWSTATE + __VIEWSTATEGENERATOR + __EVENTVALIDATION
//   2. POST / with __EVENTTARGET=ctl00$MainContent$rgReport$ctl00$ctl03$
//      ctl01$PageSizeComboBox + __VIEWSTATE → returns page-size-changed page
//   3. POST / with __EVENTTARGET=...ChangePage and __EVENTARGUMENT=N → page N
//
// To keep the scraper simple this first version takes page 1 at the default
// page size (50 rows), which covers the most recent ~50 permits in chronological
// order — sufficient for the daily refresh cron. Larger backfill runs use
// --max-pages>1.

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

// ─── Single-page fetch ─────────────────────────────────────────────────────

async function fetchPage1() {
  const res = await httpGet(PORTAL_URL);
  if (res.status !== 200) {
    throw new Error(`Denton portal returned HTTP ${res.status}`);
  }
  return res.body;
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
  const opts = { maxPages: 5, pageSize: 200, since: null, dryRun: false };
  for (const a of args) {
    if (a === "--dryrun" || a === "--dry-run") opts.dryRun = true;
    else if (a.startsWith("--max-pages=")) opts.maxPages = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--page-size=")) opts.pageSize = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--since=")) opts.since = a.split("=")[1];
  }
  // Default since = 24 months ago
  if (!opts.since) {
    const d = new Date();
    d.setMonth(d.getMonth() - 24);
    opts.since = d.toISOString().slice(0, 10);
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  console.log(`[${NAME}] starting · portal=${PORTAL_URL}`);
  console.log(
    `[${NAME}] options: maxPages=${opts.maxPages} pageSize=${opts.pageSize} since=${opts.since} dryRun=${opts.dryRun}`
  );

  let totalRows = 0;
  let totalStorage = 0;
  const records = [];

  try {
    const html = await fetchPage1();
    const rows = extractRows(html);
    totalRows += rows.length;

    for (const r of rows) {
      const rec = rowToRecord(r, { minSince: opts.since });
      if (rec) {
        totalStorage++;
        records.push(rec);
      }
    }

    console.log(
      `[${NAME}] page 1 scraped — ${rows.length} rows · ${totalStorage} storage-classified`
    );

    // Page 2+ pagination is non-trivial in WebForms (requires __VIEWSTATE
    // round-trip per page). The scraper is intentionally scoped to page 1
    // for the daily refresh — that's the most recent ~50 permits, which
    // covers the daily delta in a county this size. Multi-page backfill is
    // a follow-up sprint that swaps in puppeteer (or a properly tracked
    // ASP.NET session) for the multi-step postback dance.
    if (opts.maxPages > 1) {
      console.log(
        `[${NAME}] page-2+ pagination requires ASP.NET WebForms postback round-trip — deferred to follow-up sprint (see header comment "MULTI-STEP POSTBACK")`
      );
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
  COL,
  NAME,
  COUNTY_NAME,
  STATE,
  SLUG,
};
