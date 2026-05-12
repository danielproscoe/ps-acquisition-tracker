// extract-pipeline-disclosures.mjs — Move 2 orchestrator. Pulls the latest
// 10-Q and 10-K for each storage REIT, runs each through its per-issuer
// extractor (src/utils/pipelineDisclosures.js), and writes the consolidated
// primary-source disclosures + per-property facility entries to
// src/data/edgar-pipeline-disclosures.json.
//
// The output file is consumed by:
//   - src/data/edgarCompIndex.js  (planned accessor functions)
//   - src/warehouseExport.js     (new `edgar_pipeline_disclosures` block)
//   - src/analyzerReport.js      (new section between PSA HISTORICAL RENT and
//                                  CROSS-REIT HISTORICAL SAME-STORE)
//
// Every disclosure + facility carries `verifiedSource: "EDGAR-10Q-<accn>"`
// or `EDGAR-10K-<accn>` which pipelineConfidence.js classifies as VERIFIED.
//
// Run: node scripts/edgar/extract-pipeline-disclosures.mjs
// Run a single issuer: node scripts/edgar/extract-pipeline-disclosures.mjs PSA

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORAGE_REITS } from "./cik-registry.mjs";
import { fetchLatestFiling, fetchFilingDocument, buildFilingURL } from "./fetch-filing.mjs";
import {
  extractPipelineDisclosures,
  SUPPORTED_OPERATORS,
} from "../../src/utils/pipelineDisclosures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "_output");
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");
fs.mkdirSync(OUT_DIR, { recursive: true });

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#8203;/g, " ")
    .replace(/​|‌|‍/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&#x2019;|’/g, "'")
    .replace(/&#8220;|&#8221;|“|”/g, '"')
    .replace(/&#8211;|&#8212;|–|—/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

// Pull 10-K first (annual baseline, deeper context, footnote-rich), then 10-Q
// (most-recent quarterly update). When the orchestrator dedupes per-property
// facility entries across the two filings, the 10-Q wins so the freshest
// CIP $$ + filing date are surfaced. The 10-K stays useful because it often
// carries footnote context (city / province / acquisition date) that the 10-Q
// abbreviates.
const FORM_PRIORITY = ["10-K", "10-Q"];

/**
 * Reduce per-property facility entries across multiple filings to one
 * canonical entry per (operator, propertyName). The most recent filing
 * (by filingDate) wins for the headline numbers, but city / province /
 * acquisitionDate / msa / lat / lng / notes fall back to whatever earlier
 * filing had them.
 */
function dedupeFacilitiesByPropertyName(facilities) {
  const byKey = new Map();
  for (const f of facilities) {
    const key = `${f.operator || ""}|${(f.propertyName || f.name || f.id || "").toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, f);
      continue;
    }
    // Prefer the newer filing (filingDate descending) for headline values.
    const fDate = f.filingDate || "";
    const pDate = prev.filingDate || "";
    const newest = fDate > pDate ? f : prev;
    const oldest = fDate > pDate ? prev : f;
    // Merge: newest wins for CIP / status / accession / verifiedSource, oldest
    // contributes missing context fields when newest is silent.
    const merged = {
      ...oldest,
      ...newest,
      city: newest.city || oldest.city || null,
      state: newest.state || oldest.state || null,
      province: newest.province || oldest.province || null,
      country: newest.country || oldest.country || null,
      msa: newest.msa || oldest.msa || null,
      lat: newest.lat || oldest.lat || null,
      lng: newest.lng || oldest.lng || null,
      acquisitionDate: newest.acquisitionDate || oldest.acquisitionDate || null,
      notes: newest.notes && newest.notes.length > 30 ? newest.notes : oldest.notes || newest.notes,
    };
    byKey.set(key, merged);
  }
  return Array.from(byKey.values());
}

/**
 * Pull the latest filing of a given form for an issuer + extract pipeline
 * disclosures. Returns { found, form, accession, filingDate, sourceURL,
 * disclosures, facilities }.
 */
async function processIssuerForm(issuerKey, issuerInfo, formType) {
  try {
    const filing = await fetchLatestFiling(issuerInfo.cik, formType);
    if (!filing) {
      return { found: false, reason: `no ${formType} on file` };
    }
    const sourceURL = buildFilingURL(issuerInfo.cik, filing.accessionNumber, filing.primaryDocument);
    const html = await fetchFilingDocument(issuerInfo.cik, filing.accessionNumber, filing.primaryDocument);
    const text = htmlToText(html);

    const meta = {
      operator: issuerKey,
      operatorName: issuerInfo.name,
      accession: filing.accessionNumber,
      form: formType,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      sourceURL,
    };

    const result = extractPipelineDisclosures(issuerKey, text, meta);

    // Cache raw text for audit + repeat runs
    const cachePath = path.join(OUT_DIR, `pipeline-${issuerKey}-${formType.toLowerCase().replace(/[^a-z0-9]/g, "")}-${filing.accessionNumber}.txt`);
    fs.writeFileSync(cachePath, text, "utf8");

    return {
      found: true,
      form: formType,
      accession: filing.accessionNumber,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      sourceURL,
      disclosures: result.disclosures,
      facilities: result.facilities,
      cachePath: path.relative(process.cwd(), cachePath),
    };
  } catch (e) {
    return { found: false, reason: e.message };
  }
}

async function run() {
  const targetIssuer = process.argv[2] ? process.argv[2].toUpperCase() : null;
  const issuersToProcess = targetIssuer ? [targetIssuer] : SUPPORTED_OPERATORS;

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  Move 2 — Pipeline Disclosure Orchestrator");
  console.log("  Pulls latest 10-Q + 10-K for each storage REIT, extracts primary-");
  console.log("  source pipeline disclosures. Output stamps every record with");
  console.log("  verifiedSource: EDGAR-<form>-<accession> for auto-VERIFIED chip");
  console.log("  classification via src/utils/pipelineConfidence.js.");
  console.log("════════════════════════════════════════════════════════════════════\n");

  const issuersOut = {};

  for (const issuerKey of issuersToProcess) {
    const issuerInfo = STORAGE_REITS[issuerKey];
    if (!issuerInfo) {
      console.log(`✗ ${issuerKey}: not in cik-registry, skipping`);
      continue;
    }
    console.log(`━━━━━━━━━ ${issuerKey} (${issuerInfo.name}) ━━━━━━━━━`);
    if (issuerInfo.historicalOnly) {
      console.log(`  (historical-only — last filing expected ${issuerInfo.lastFilingExpected})`);
    }

    const issuerRecord = {
      operator: issuerKey,
      operatorName: issuerInfo.name,
      cik: issuerInfo.cik,
      ticker: issuerInfo.ticker,
      historicalOnly: issuerInfo.historicalOnly || false,
      filings: [],
      allDisclosures: [],
      allFacilities: [],
    };

    for (const formType of FORM_PRIORITY) {
      process.stdout.write(`  ${formType.padEnd(5)} ... `);
      const r = await processIssuerForm(issuerKey, issuerInfo, formType);
      if (!r.found) {
        console.log(`✗ ${r.reason}`);
        issuerRecord.filings.push({ form: formType, found: false, reason: r.reason });
        continue;
      }
      console.log(`✓ ${r.filingDate} ${r.accession} · ${r.disclosures.length} disclosure(s) · ${r.facilities.length} facility(s)`);
      issuerRecord.filings.push({
        form: r.form,
        accession: r.accession,
        filingDate: r.filingDate,
        reportDate: r.reportDate,
        sourceURL: r.sourceURL,
        disclosureCount: r.disclosures.length,
        facilityCount: r.facilities.length,
        cachePath: r.cachePath,
      });
      for (const d of r.disclosures) issuerRecord.allDisclosures.push(d);
      for (const f of r.facilities) issuerRecord.allFacilities.push(f);
    }
    // Per-issuer cross-form dedupe of facility entries (Regent / Allard /
    // Finch / Edmonton JV / etc. — each property appears in both 10-Q + 10-K).
    issuerRecord.allFacilities = dedupeFacilitiesByPropertyName(issuerRecord.allFacilities);
    issuersOut[issuerKey] = issuerRecord;
    console.log(`  → after cross-form dedupe: ${issuerRecord.allDisclosures.length} disclosure(s) · ${issuerRecord.allFacilities.length} facility(s)`);
    console.log();
  }

  // Aggregate counters
  const totals = Object.values(issuersOut).reduce(
    (acc, r) => {
      acc.disclosures += r.allDisclosures.length;
      acc.facilities += r.allFacilities.length;
      acc.filings += r.filings.filter((f) => f.accession).length;
      return acc;
    },
    { disclosures: 0, facilities: 0, filings: 0 }
  );

  const output = {
    schema: "storvex.edgar-pipeline-disclosures.v1",
    generatedAt: new Date().toISOString(),
    methodology:
      "Per-issuer regex extraction of pipeline disclosures from each storage REIT's most recent 10-Q + 10-K on SEC EDGAR. " +
      "PSA: aggregate remaining-spend + subsequent-event acquisitions. " +
      "EXR: balance-sheet under-development line item + JV under-dev count. " +
      "CUBE: named JV under-construction projects (city + completion + invested$). " +
      "NSA: narrative under-construction count (post-PSA-merger; sparse). " +
      "SMA: per-property Canadian JV table with CIP$ + footnote acquisition context. " +
      "Every record carries verifiedSource = EDGAR-<form>-<accession> for auto-VERIFIED " +
      "chip classification via src/utils/pipelineConfidence.js derivation rule #3.",
    totalIssuers: Object.keys(issuersOut).length,
    totalFilings: totals.filings,
    totalDisclosures: totals.disclosures,
    totalFacilities: totals.facilities,
    issuers: issuersOut,
  };

  const outPath = path.join(DATA_DIR, "edgar-pipeline-disclosures.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  ✓ Wrote ${path.relative(process.cwd(), outPath)}`);
  console.log(`    ${totals.filings} filing(s) parsed across ${output.totalIssuers} issuer(s)`);
  console.log(`    ${totals.disclosures} disclosure(s) + ${totals.facilities} per-property facility entries`);
  console.log("════════════════════════════════════════════════════════════════════");
}

run().catch((e) => {
  console.error("✗ Orchestrator failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
