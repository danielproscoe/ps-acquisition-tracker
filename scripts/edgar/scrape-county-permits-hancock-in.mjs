// scrape-county-permits-hancock-in.mjs — Hancock County, IN permit scraper.
//
// PORTAL STATUS (probed 5/12/26)
// -------------------------------
// Hancock County, Indiana has NO online searchable permit portal. The
// Planning and Building Department (Greenfield, IN — county seat) handles
// commercial permits in person and over phone:
//
//   Office: Hancock County Annex, 111 American Legion Place, Suite 146,
//           Greenfield, IN 46140
//   Phone:  317-477-1133 (Building) · 317-477-1134 (Planning)
//   Hours:  Mon-Fri 8:00 AM - 4:00 PM
//   URL:    https://www.hancockin.gov/247/Planning-Building
//
// Available permit types per the county website: electrical, pool, sign,
// building permits, change of uses, and Commercial Projects. Storage
// projects would route through "Commercial Projects" + "change of uses"
// when re-purposing existing structures.
//
// STRATEGY
// --------
// onFileSource records-request adapter, identical pattern to Boone IN.
// Quarterly cycle:
//   1. Call or email Hancock County Planning & Building requesting commercial
//      permit records for self-storage / mini-warehouse / warehouse last
//      24 months
//   2. Receive paper or PDF response
//   3. Hand-curate JSON entries into a batch file
//   4. Run: node scrape-county-permits-hancock-in.mjs --ingest=hancock-batch.json
//
// Batch JSON shape matches Boone IN — see scrape-county-permits-boone-in.mjs
// header for the canonical template.
//
// CLI
// ---
//   node scrape-county-permits-hancock-in.mjs [--ingest=batch.json] [--dryrun]

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

const COUNTY_NAME = "Hancock County, IN";
const STATE = "IN";
const SLUG = countySlug(COUNTY_NAME, STATE);
const NAME = "hancock-in";

const RECORDS_CONTACT = {
  office: "Hancock County Planning and Building Department",
  address: "111 American Legion Place, Suite 146, Greenfield, IN 46140",
  phoneBuilding: "317-477-1133",
  phonePlanning: "317-477-1134",
  hours: "Mon-Fri 8:00 AM - 4:00 PM ET",
  url: "https://www.hancockin.gov/247/Planning-Building",
  permitsListing: "https://www.hancockin.gov/371/Permits",
  notes: "Greenfield is the county seat. McCordsville (NE-corner) is also in Hancock County and a Tier-4 PS target market per memory/people/matthew-toussaint.md.",
};

// ─── Batch ingestor (same shape as Boone) ──────────────────────────────────

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
      `[${NAME}] Hancock County has NO online permit portal — records-request adapter`
    );
    console.log(
      `[${NAME}] To ingest, prepare batch JSON (see Boone IN template) and run with --ingest=<path>`
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
  process.argv[1]?.endsWith("scrape-county-permits-hancock-in.mjs");

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
