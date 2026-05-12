// scrape-county-permits-warren-oh.mjs — Warren County, OH permit scraper.
//
// PORTAL
// ------
// warrencountyohio.gov/BldgInsp/Search/PermitSearch/Index redirects to
// iWorQ Systems hosted portal:
//   https://warrencountyoh.portal.iworq.net/warrencountyoh/permits/600
//
// iWorQ is a municipal software platform serving 100+ Ohio jurisdictions.
// The public permits view is reCAPTCHA v3 invisible-gated AND records
// are loaded via XHR after captcha pass — verified via direct HTTP probe
// (5/12/26):
//   - Initial page returns 594KB HTML w/ data-sitekey="6Les_AYkAAAAACw..."
//   - <tbody> is empty in the initial HTML; records hydrate post-captcha
//   - data-dsn="warrencountyoh" identifies the tenant for the AJAX endpoint
//
// STRATEGY
// --------
// Phase 1 (today): Manual quarterly records pull from the iWorQ portal,
//   ingested via --ingest=<csv> flag. The portal does allow human users
//   to apply filters and export results. Dan or a researcher pulls a
//   CSV every 90 days; this script normalizes the CSV into county-permits
//   records.
//
// Phase 2 (follow-up): Puppeteer-rendered scraper that solves the
//   invisible reCAPTCHA via 2captcha.com or similar service. Cost ~$0.003
//   per captcha; viable for daily refresh. Deferred until manual pull
//   confirms the data IS valuable (e.g., catches new pipeline that EDGAR
//   doesn't disclose).
//
// MANUAL PULL WORKFLOW (Phase 1):
//   1. Visit https://warrencountyoh.portal.iworq.net/warrencountyoh/permits/600
//   2. Solve the reCAPTCHA (one-time per session)
//   3. Apply filter: Permit Type contains "WAREHOUSE" / "STORAGE" /
//      "COMMERCIAL"
//   4. Apply filter: Date Issued >= 24 months ago
//   5. Export results as CSV
//   6. Run: node scrape-county-permits-warren-oh.mjs --ingest=warren-permits.csv
//
// CSV SHAPE EXPECTED (iWorQ default export):
//   permitNum,propertyAddress,propertyCity,propertyState,propertyOwner,
//   permitType,issuedDate,status,description,parcelNumber
//
// CLI
// ---
//   node scrape-county-permits-warren-oh.mjs [--ingest=path.csv] [--dryrun]

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

const PORTAL_URL =
  "https://warrencountyoh.portal.iworq.net/warrencountyoh/permits/600";
const COUNTY_NAME = "Warren County, OH";
const STATE = "OH";
const SLUG = countySlug(COUNTY_NAME, STATE);
const NAME = "warren-oh";

// ─── CSV parser (minimal — handles iWorQ export format) ────────────────────

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
  // iWorQ default format: "MM/DD/YYYY"
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) {
    const [, mm, dd, yyyy] = m1;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  // ISO format pass-through
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

// ─── Storage classifier ────────────────────────────────────────────────────

function isLikelyStorage(row) {
  const permitType = (row.permitType || row.PermitType || "").toLowerCase();
  const description = row.description || row.Description || "";
  const owner = row.propertyOwner || row.PropertyOwner || row.owner || "";

  // Permit type hints
  if (/warehouse|storage|self-storage|mini.warehouse/i.test(permitType)) return true;

  // Keyword in description / owner / address
  if (
    isStorageUseDescription(description) ||
    isStorageUseDescription(owner) ||
    isStorageUseDescription(row.propertyAddress || row.PropertyAddress || "")
  )
    return true;

  // Operator brand match
  const op = normalizeOperator(owner);
  if (op.key) return true;

  return false;
}

// ─── CSV row → permit record ───────────────────────────────────────────────

function csvRowToRecord(row) {
  const permitNumber =
    row.permitNum || row.PermitNum || row.permitNumber || row.PermitNumber || row["Permit #"];
  const dateIssued = normalizeDate(
    row.issuedDate || row.IssuedDate || row.dateIssued || row["Issued Date"]
  );
  const address =
    row.propertyAddress || row.PropertyAddress || row.address || row["Parcel Address"];
  const city = row.propertyCity || row.PropertyCity || row.city || null;
  const owner =
    row.propertyOwner || row.PropertyOwner || row.owner || row["Property Owner"] || "";
  const permitType = row.permitType || row.PermitType || row["Permit Type"] || "";
  const description = row.description || row.Description || row["Description"] || "";
  const status = row.status || row.Status || "";
  const parcel = row.parcelNumber || row.ParcelNumber || row["Parcel #"] || "";

  if (!permitNumber || !dateIssued || !address) return null;
  if (!isLikelyStorage(row)) return null;

  return buildPermitRecord({
    countyName: COUNTY_NAME,
    stateAbbr: STATE,
    permitNumber,
    permitIssueDate: dateIssued,
    jurisdiction: "Warren County, OH (Building Inspection Dept)",
    operatorRaw: owner,
    address,
    city,
    description: [permitType, description].filter(Boolean).join(" · "),
    status: /issued|approved|active/i.test(status) ? "permitted" : "announced",
    permitUrl: PORTAL_URL,
    notes: `Parcel ${parcel || "?"} · iWorQ DSN warrencountyoh.`,
  });
}

// ─── Portal probe (Phase 1 diagnostic) ─────────────────────────────────────

async function probePortal() {
  console.log(`[${NAME}] probing portal — ${PORTAL_URL}`);
  try {
    const res = await httpGet(PORTAL_URL);
    if (res.status !== 200) {
      console.log(`[${NAME}] portal returned HTTP ${res.status}`);
      return false;
    }
    const sitekeyMatch = res.body.match(/data-sitekey="([^"]+)"/);
    const dsnMatch = res.body.match(/data-dsn="([^"]+)"/);
    const captchaPresent = !!sitekeyMatch;
    console.log(
      `[${NAME}] portal OK · captcha=${captchaPresent} (${sitekeyMatch ? sitekeyMatch[1].slice(0, 20) + "..." : "none"}) · dsn=${dsnMatch?.[1] || "?"}`
    );
    if (captchaPresent) {
      console.log(
        `[${NAME}] portal is reCAPTCHA-gated — manual --ingest=<csv> path required for Phase 1.`
      );
    }
    return true;
  } catch (e) {
    console.log(`[${NAME}] portal probe failed: ${e.message}`);
    return false;
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { ingest: null, dryRun: false, probeOnly: false };
  for (const a of args) {
    if (a === "--dryrun" || a === "--dry-run") opts.dryRun = true;
    else if (a === "--probe") opts.probeOnly = true;
    else if (a.startsWith("--ingest=")) opts.ingest = a.split("=")[1];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  console.log(`[${NAME}] starting · county=${COUNTY_NAME}`);

  if (opts.probeOnly) {
    await probePortal();
    return;
  }

  if (!opts.ingest) {
    console.log(`[${NAME}] no --ingest=<csv> provided · running portal probe + exit`);
    console.log(
      `[${NAME}] To ingest a batch of permits, export CSV from the iWorQ portal and run with --ingest=<path>`
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
  process.argv[1]?.endsWith("scrape-county-permits-warren-oh.mjs");

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
};
