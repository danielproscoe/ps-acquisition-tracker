// scrape-county-permits-boone-in.mjs — Boone County, IN permit scraper.
//
// PORTAL STATUS (probed 5/12/26)
// -------------------------------
// Boone County, Indiana has NO online searchable permit portal as of
// today. The county Area Plan Commission (Lebanon, IN — county seat)
// administers commercial permits via paper records held at the
// Courthouse Annex. Highway Department issues right-of-way + driveway
// permits separately.
//
// Live offices:
//   - Area Plan Commission   · https://boonecounty.in.gov/Offices/Area-Plan
//   - Building Inspections   · embedded under Area Plan
//   - Highway Permits        · https://boonecounty.in.gov/Offices/Highway/Permits
//
// Probe result: no `permits/search`, no `permits/index`, no inline portal.
// Online resources are application forms only — submission via fax or in-person.
//
// STRATEGY
// --------
// onFileSource records-request adapter. Quarterly cycle:
//   1. Email Area Plan Commission requesting commercial permit records
//      for self-storage / mini-warehouse / warehouse uses, last 24 months
//   2. Receive paper or PDF response
//   3. Hand-curate JSON entries into a batch file
//   4. Run: node scrape-county-permits-boone-in.mjs --ingest=boone-batch.json
//
// Each entry uses `onFileSource` (not `permitUrl`) to satisfy the Oracle
// citationRule. onFileSource value documents the records request reference
// + date received.
//
// BATCH JSON SHAPE
// ----------------
// {
//   "batchId": "boone-2026-q2-records-request",
//   "requestedDate": "2026-05-15",
//   "receivedDate": "2026-05-22",
//   "responseFormat": "PDF letter from Area Plan Commission",
//   "receivedBy": "Daniel Roscoe",
//   "permits": [
//     {
//       "permitNumber": "BCPC-2025-COM-0042",
//       "permitIssueDate": "2025-07-18",
//       "city": "Whitestown",
//       "address": "7100 Indianapolis Rd",
//       "operator": "Extra Space Storage",
//       "description": "Mini-warehouse · 84,000 SF · 3 stories",
//       "status": "permitted",
//       "nrsf": 84000,
//       "stories": 3,
//       "estimatedInvestment": 7500000
//     }
//   ]
// }
//
// CLI
// ---
//   node scrape-county-permits-boone-in.mjs [--ingest=batch.json] [--dryrun]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPermitRecord,
  countySlug,
  isStorageUseDescription,
  mergePermitRecords,
  normalizeOperator,
  printSummary,
} from "./_county-permit-common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COUNTY_NAME = "Boone County, IN";
const STATE = "IN";
const SLUG = countySlug(COUNTY_NAME, STATE);
const NAME = "boone-in";

const RECORDS_CONTACT = {
  office: "Boone County Area Plan Commission",
  address: "116 Washington St, Lebanon, IN 46052",
  phone: "765-482-1820",
  emailGuess: "areaplan@boonecounty.in.gov",
  url: "https://boonecounty.in.gov/Offices/Area-Plan",
  followUp: "Boone County Highway Dept · permits-related to driveway access",
  followUpUrl: "https://boonecounty.in.gov/Offices/Highway/Permits",
};

// ─── Batch ingestor ────────────────────────────────────────────────────────

function batchToRecords(batch) {
  if (!batch || !Array.isArray(batch.permits)) {
    throw new Error("batch JSON must contain `permits: []` array");
  }

  const onFileRef = batch.batchId
    ? `Records request "${batch.batchId}" · received ${batch.receivedDate || "?"} from ${RECORDS_CONTACT.office}`
    : `Records request received from ${RECORDS_CONTACT.office}`;

  const records = [];
  for (const p of batch.permits) {
    if (!p.permitNumber || !p.permitIssueDate || !p.address || !p.city) continue;

    // Storage classifier — operator brand OR keyword
    const op = normalizeOperator(p.operator || p.operatorName || "");
    const isStorage =
      op.key ||
      isStorageUseDescription(p.description || "") ||
      isStorageUseDescription(p.operator || "");
    if (!isStorage) continue;

    const rec = buildPermitRecord({
      countyName: COUNTY_NAME,
      stateAbbr: STATE,
      permitNumber: p.permitNumber,
      permitIssueDate: p.permitIssueDate,
      jurisdiction: RECORDS_CONTACT.office,
      operatorRaw: p.operator || p.operatorName,
      address: p.address,
      city: p.city,
      msa: "Indianapolis",
      lat: p.lat || null,
      lng: p.lng || null,
      nrsf: p.nrsf || null,
      ccPct: p.ccPct || null,
      stories: p.stories || null,
      expectedDelivery: p.expectedDelivery || null,
      status: p.status || "permitted",
      estimatedInvestment: p.estimatedInvestment || null,
      description: p.description,
      verifiedDate: batch.receivedDate || null,
      onFileSource: onFileRef,
      notes: p.notes || null,
    });

    records.push(rec);
  }

  return records;
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { ingest: null, dryRun: false, contact: false };
  for (const a of args) {
    if (a === "--dryrun" || a === "--dry-run") opts.dryRun = true;
    else if (a === "--contact") opts.contact = true;
    else if (a.startsWith("--ingest=")) opts.ingest = a.split("=")[1];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  console.log(`[${NAME}] starting · county=${COUNTY_NAME}`);

  if (opts.contact) {
    console.log(`[${NAME}] Records request contact:`);
    Object.entries(RECORDS_CONTACT).forEach(([k, v]) => {
      console.log(`  ${k}: ${v}`);
    });
    return;
  }

  if (!opts.ingest) {
    console.log(`[${NAME}] no --ingest=<json> provided · printing contact + exit`);
    console.log(
      `[${NAME}] Boone County has NO online permit portal — records-request adapter`
    );
    console.log(
      `[${NAME}] To ingest, prepare batch JSON (see header docstring) and run with --ingest=<path>`
    );
    return;
  }

  const batchPath = path.resolve(opts.ingest);
  if (!fs.existsSync(batchPath)) {
    console.error(`[${NAME}] ERROR: batch JSON not found at ${batchPath}`);
    process.exit(2);
  }

  let batch;
  try {
    batch = JSON.parse(fs.readFileSync(batchPath, "utf-8"));
  } catch (e) {
    console.error(`[${NAME}] ERROR parsing batch JSON: ${e.message}`);
    process.exit(2);
  }

  console.log(
    `[${NAME}] ingesting batchId=${batch.batchId || "(unset)"} · ${(batch.permits || []).length} permits in batch`
  );

  const records = batchToRecords(batch);
  console.log(
    `[${NAME}] storage-classified ${records.length} of ${(batch.permits || []).length} batch entries`
  );

  const result = mergePermitRecords(records, { dryRun: opts.dryRun });
  printSummary(NAME, result);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("scrape-county-permits-boone-in.mjs");

if (isMain) {
  main().catch((e) => {
    console.error(`[${NAME}] FATAL: ${e.stack || e.message}`);
    process.exit(1);
  });
}

// ─── Exports for tests ─────────────────────────────────────────────────────

export {
  batchToRecords,
  RECORDS_CONTACT,
  NAME,
  COUNTY_NAME,
  STATE,
  SLUG,
};
