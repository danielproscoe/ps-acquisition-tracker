// scrape-county-permits-kenton-ky.mjs — Kenton County, KY permit scraper.
//
// PORTAL
// ------
// Planning and Development Services of Kenton County (PDSKC) operates the
// only public permit search for all 20 Kenton County municipalities + the
// unincorporated county. PDSKC is a city-county agency created to provide
// services to Kenton County's 20 local governments.
//
//   Search: https://pdskc.govbuilt.com/ActivitySearchTool
//   Platform: GovBuilt (built on Orchard Core CMS)
//   Public API base: /PublicReport/PublicReport/...
//
// Case types (verified live 5/12/26 via API probe):
//   - Building Permit  · id=4a5m0sjxckzd426k0j8q42cnmz
//   - Commercial       · id=4xykjp8nrseaw7pbv444brawnp  ← storage permits route here
//   - Residential      · id=4p9z31t8g67ye7e0ze5wkbcgw3
//
// STRATEGY
// --------
// Phase 1 (today): API-driven probe + manual --ingest=<csv> fallback.
//   - GovBuilt exposes case-type metadata via open API endpoints (no auth)
//   - The actual case-search GET returns sparse data unless a session is
//     established via the form (Orchard Core CSRF anti-forgery token)
//   - Manual CSV export from the Activity Search Tool UI is the reliable
//     Phase 1 path. Operator runs filtered query in browser, exports CSV,
//     this script ingests + normalizes.
//
// Phase 2 (follow-up): Reverse-engineer the anti-forgery token flow OR
//   use puppeteer to drive the search UI and capture XHR responses.
//   Deferred until Phase 1 confirms data is high-value (e.g., catches new
//   pipeline that EDGAR doesn't disclose).
//
// MANUAL PULL WORKFLOW (Phase 1):
//   1. Visit https://pdskc.govbuilt.com/ActivitySearchTool
//   2. Set Case Type = "Commercial"
//   3. Set Sub-Type or keyword filter as available (e.g., "warehouse",
//      "storage")
//   4. Set Date Range to last 24 months
//   5. Click Search → Export to CSV (CSV export button in the report toolbar)
//   6. Run: node scrape-county-permits-kenton-ky.mjs --ingest=kenton-permits.csv
//
// CLI
// ---
//   node scrape-county-permits-kenton-ky.mjs [--ingest=path.csv]
//                                            [--probe-api] [--dryrun]

import fs from "node:fs";
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

const PORTAL_BASE = "https://pdskc.govbuilt.com";
const PORTAL_URL = `${PORTAL_BASE}/ActivitySearchTool`;
const API_CASE_TYPES = `${PORTAL_BASE}/PublicReport/PublicReport/GetAllowedCaseType?contentType=CaseType`;

const COUNTY_NAME = "Kenton County, KY";
const STATE = "KY";
const SLUG = countySlug(COUNTY_NAME, STATE);
const NAME = "kenton-ky";

// ─── CSV parser ────────────────────────────────────────────────────────────

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] || "").trim();
    });
    return obj;
  });
  return { headers, rows };
}

function splitCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuote = true;
    } else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

// ─── Date normalization ────────────────────────────────────────────────────

function normalizeDate(s) {
  if (!s) return null;
  s = String(s).trim();
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) {
    const [, mm, dd, yyyy] = m1;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

// ─── Storage classifier ────────────────────────────────────────────────────

function isLikelyStorage(row) {
  const caseType = (row.caseType || row.CaseType || row["Case Type"] || "").toLowerCase();
  const subType = (row.subType || row.SubType || row["Sub Type"] || "").toLowerCase();
  const description =
    row.description || row.Description || row["Project Description"] || "";
  const businessName =
    row.businessName || row.BusinessName || row["Business Name"] || "";
  const applicant = row.applicant || row.Applicant || row.name || row.Name || "";

  // SubType is the most useful signal in PDSKC's case taxonomy
  if (/warehouse|storage|mini.warehouse|self.storage/i.test(subType)) return true;

  // Description / business name / applicant keyword match
  if (
    isStorageUseDescription(description) ||
    isStorageUseDescription(businessName) ||
    isStorageUseDescription(applicant)
  )
    return true;

  // Operator brand match
  const op1 = normalizeOperator(businessName);
  const op2 = normalizeOperator(applicant);
  if (op1.key || op2.key) return true;

  // Commercial case type with storage hints in subType
  if (caseType.includes("commercial") && /warehouse|storage/i.test(subType)) return true;

  return false;
}

// ─── CSV row → permit record ───────────────────────────────────────────────

function csvRowToRecord(row) {
  const permitNumber =
    row.caseNumber ||
    row.CaseNumber ||
    row.referenceNumber ||
    row.ReferenceNumber ||
    row["Reference Number"] ||
    row["Case #"] ||
    row.permitNumber;
  const dateOpened = normalizeDate(
    row.dateOpened || row.DateOpened || row["Date Opened"] || row.created || row.Created
  );
  const dateClosed = normalizeDate(
    row.dateClosed || row.DateClosed || row["Date Closed"] || row.dateIssued
  );
  const issueDate = dateClosed || dateOpened;
  const address = row.address || row.Address || row["Project Address"] || "";
  const city = row.city || row.City || row["Project City"] || null;
  const businessName =
    row.businessName || row.BusinessName || row["Business Name"] || "";
  const applicant = row.applicant || row.Applicant || row.name || row.Name || "";
  const caseType = row.caseType || row.CaseType || row["Case Type"] || "";
  const subType = row.subType || row.SubType || row["Sub Type"] || "";
  const description = row.description || row.Description || "";
  const status = row.status || row.Status || "";

  if (!permitNumber || !issueDate || !address) return null;
  if (!isLikelyStorage(row)) return null;

  return buildPermitRecord({
    countyName: COUNTY_NAME,
    stateAbbr: STATE,
    permitNumber,
    permitIssueDate: issueDate,
    jurisdiction: "Planning and Development Services of Kenton County (PDSKC)",
    operatorRaw: businessName || applicant,
    address,
    city,
    description: [caseType, subType, description].filter(Boolean).join(" · "),
    status: /closed|approved|issued|active/i.test(status) ? "permitted" : "announced",
    permitUrl: PORTAL_URL,
    notes: `Applicant: ${applicant || "?"}. Case Type: ${caseType}. Sub Type: ${subType}.`,
  });
}

// ─── API probe ─────────────────────────────────────────────────────────────

async function probePortal() {
  console.log(`[${NAME}] probing GovBuilt API — ${API_CASE_TYPES}`);
  try {
    const res = await httpGet(API_CASE_TYPES);
    if (res.status !== 200) {
      console.log(`[${NAME}] case-types API returned HTTP ${res.status}`);
      return false;
    }
    const data = JSON.parse(res.body);
    if (Array.isArray(data) && data.length > 0) {
      console.log(`[${NAME}] case-types live · ${data.length} types`);
      data.forEach((t) => {
        console.log(`  - ${t.title} · id=${t.contentItemId}`);
      });
      console.log(
        `[${NAME}] note: case-search XHR requires Orchard Core anti-forgery token · manual CSV export is Phase 1`
      );
      return true;
    }
    console.log(`[${NAME}] case-types API returned unexpected shape`);
    return false;
  } catch (e) {
    console.log(`[${NAME}] API probe failed: ${e.message}`);
    return false;
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { ingest: null, dryRun: false, probeApi: false };
  for (const a of args) {
    if (a === "--dryrun" || a === "--dry-run") opts.dryRun = true;
    else if (a === "--probe-api") opts.probeApi = true;
    else if (a.startsWith("--ingest=")) opts.ingest = a.split("=")[1];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  console.log(`[${NAME}] starting · county=${COUNTY_NAME}`);

  if (opts.probeApi) {
    await probePortal();
    return;
  }

  if (!opts.ingest) {
    console.log(`[${NAME}] no --ingest=<csv> provided · running API probe + exit`);
    console.log(
      `[${NAME}] To ingest, export CSV from ${PORTAL_URL} and run with --ingest=<path>`
    );
    await probePortal();
    return;
  }

  const csvPath = path.resolve(opts.ingest);
  if (!fs.existsSync(csvPath)) {
    console.error(`[${NAME}] ERROR: CSV not found at ${csvPath}`);
    process.exit(2);
  }

  const csvText = fs.readFileSync(csvPath, "utf-8");
  const { headers, rows } = parseCsv(csvText);
  console.log(
    `[${NAME}] ingesting ${csvPath} · ${rows.length} rows · headers=[${headers.join(", ")}]`
  );

  const records = [];
  for (const row of rows) {
    const rec = csvRowToRecord(row);
    if (rec) records.push(rec);
  }

  console.log(
    `[${NAME}] storage-classified ${records.length} of ${rows.length} ingested rows`
  );

  const result = mergePermitRecords(records, { dryRun: opts.dryRun });
  printSummary(NAME, result);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("scrape-county-permits-kenton-ky.mjs");

if (isMain) {
  main().catch((e) => {
    console.error(`[${NAME}] FATAL: ${e.stack || e.message}`);
    process.exit(1);
  });
}

// ─── Exports for tests ─────────────────────────────────────────────────────

export {
  parseCsv,
  csvRowToRecord,
  isLikelyStorage,
  normalizeDate,
  NAME,
  COUNTY_NAME,
  STATE,
  SLUG,
  PORTAL_URL,
  API_CASE_TYPES,
};
