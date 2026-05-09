// extract-schedule-iii.mjs — Parses PSA Schedule III "Real Estate and
// Accumulated Depreciation" tables from the latest 10-K filing.
//
// Schedule III is the SEC-mandated REIT property-portfolio disclosure.
// PSA reports it MSA-aggregated (not property-by-property), giving us:
//   - # of facilities per MSA
//   - Net Rentable Square Feet (in thousands)
//   - Initial cost (Land + Buildings & Improvements)
//   - Costs Subsequent to Acquisition
//   - Gross Carrying Amount (Land / Buildings / Total)
//   - Accumulated Depreciation
//
// Derived metrics (computed below):
//   - Implied $/SF cost basis = Total gross / NRSF
//   - Implied $/facility = Total gross / # facilities
//   - Depreciation ratio (vintage proxy)
//
// All amounts in thousands of dollars per SEC convention; NRSF in thousands of SF.
// Output: src/data/edgar-schedule-iii.json — primary-source comp database.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORAGE_REITS } from "./cik-registry.mjs";
import { fetchLatestFiling, fetchFilingDocument, buildFilingURL } from "./fetch-filing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "_output");
fs.mkdirSync(OUT_DIR, { recursive: true });

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "—")
    .replace(/&#8212;/g, "—") // em-dash, used in PSA filings as "no value"
    .replace(/\s+/g, " ");
}

// Schedule III row format (PSA convention, observed in FY2025 10-K):
//   {MSA name (1-3 words, possibly /-separated)} {# facilities} {NRSF (\d+,?\d+)}
//   {2025 encumbrances $|—} {Land $} {Buildings $} {Costs subsequent $}
//   {Land gross $} {Buildings gross $} {Total $} {Accum. depreciation $}
//
// Numbers can include commas. "—" means zero/none. The $ sign is sometimes
// omitted on subsequent columns. Numbers wrapped in parens are negative.
//
// Strategy: locate the Schedule III section, then iterate row-by-row using
// a numeric-column-anchor approach.

function parseDollar(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/[$,]/g, "").trim();
  if (cleaned === "—" || cleaned === "" || cleaned === "-") return 0;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function extractScheduleIIIRows(text, issuer) {
  // Find the Schedule III start marker
  const startMarker = new RegExp(`${issuer}\\s+SCHEDULE III`, "i");
  const startMatch = startMarker.exec(text);
  if (!startMatch) return { rows: [], scheduleStart: -1 };

  // Schedule III runs until "TOTAL" or "Notes" or end of doc.
  // Schedule III spans MULTIPLE pages — page-footer markers (F-37, F-38) are
  // internal noise, NOT terminators. Only stop at the actual schedule total
  // or the start of the Notes section.
  const scheduleStart = startMatch.index;
  const endRegexes = [
    /Total\s+\(a\)/i,            // PSA's footer pattern
    /\bNotes to Schedule III\b/i,
    /\bSchedule IV\b/i,
  ];
  let scheduleEnd = text.length;
  for (const re of endRegexes) {
    const m = re.exec(text.slice(scheduleStart + 100));
    if (m && (scheduleStart + 100 + m.index) < scheduleEnd) {
      scheduleEnd = scheduleStart + 100 + m.index;
    }
  }
  // Strip embedded page footers + repeated table headers so they don't break row matching
  let section = text.slice(scheduleStart, scheduleEnd);
  section = section
    .replace(/\bF-\d{2,3}\b\s+(?:PUBLIC STORAGE\s+)?SCHEDULE III[^A-Z]*?Description\s+No\. of Facilities[^A-Z]+?(?=[A-Z])/gi, " ")
    .replace(/\bF-\d{2,3}\b/g, " ")
    .replace(/\s+/g, " ");

  // Row pattern: MSA name followed by 10 numeric columns.
  // We anchor on: at least 8 dollar/numeric columns in a row.
  // Column tokens: \$?\s*\d{1,3}(?:,\d{3})*  OR  —
  //
  // Use a permissive matcher: find sequences of (text)(num)(num)(num)... with
  // 9-11 numeric columns trailing.
  const rowRe = /([A-Z][A-Za-z./\- ]+?)\s+(\d{1,3})\s+([\d,]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)/g;

  const rows = [];
  let m;
  while ((m = rowRe.exec(section)) !== null) {
    const [, rawMSA, numFac, nrsfThousands, encumbrances, landInitial, bldgInitial, costsSubsequent, landGross, bldgGross, totalGross, accumDep] = m;

    // Filter out junk matches (e.g., the table header row, page footers).
    const msa = rawMSA.trim();
    if (msa.length < 3 || msa.length > 60) continue;
    if (/^(Description|Initial|Gross|Total|Net|Page|Real Estate|Schedule)/i.test(msa)) continue;

    const numFacInt = parseInt(numFac, 10);
    const nrsfThou = parseDollar(nrsfThousands);
    if (nrsfThou == null || nrsfThou < 50) continue; // sanity floor — real markets > 50K SF

    const totalGrossThou = parseDollar(totalGross);
    if (!totalGrossThou || totalGrossThou < 1000) continue;

    rows.push({
      msa,
      numFacilities: numFacInt,
      nrsfThousands: nrsfThou,
      encumbrancesThou: parseDollar(encumbrances),
      landInitialThou: parseDollar(landInitial),
      bldgInitialThou: parseDollar(bldgInitial),
      costsSubsequentThou: parseDollar(costsSubsequent),
      landGrossThou: parseDollar(landGross),
      bldgGrossThou: parseDollar(bldgGross),
      totalGrossThou,
      accumDepThou: parseDollar(accumDep),
      // Derived metrics
      impliedPSF: nrsfThou > 0 ? Math.round((totalGrossThou * 1000) / (nrsfThou * 1000)) : null,
      impliedPerFacilityM: numFacInt > 0 ? Math.round((totalGrossThou * 1000) / numFacInt / 100000) / 10 : null,
      depreciationRatio: totalGrossThou > 0 ? Math.round((parseDollar(accumDep) / totalGrossThou) * 1000) / 1000 : null,
    });
  }

  return { rows, scheduleStart, scheduleEnd, sectionLength: section.length };
}

async function run() {
  const psa = STORAGE_REITS.PSA;
  console.log(`▸ Pulling latest 10-K for ${psa.name}...`);

  const filing = await fetchLatestFiling(psa.cik, "10-K");
  if (!filing) throw new Error("No 10-K found");
  console.log(`▸ Filing: ${filing.filingDate} · accession ${filing.accessionNumber}`);

  console.log(`▸ Fetching document (${filing.primaryDocument})...`);
  const html = await fetchFilingDocument(psa.cik, filing.accessionNumber, filing.primaryDocument);
  const text = htmlToText(html);
  console.log(`▸ Stripped to ${(text.length / 1024).toFixed(0)} KB text`);

  console.log(`▸ Parsing Schedule III...`);
  const { rows, scheduleStart, sectionLength } = extractScheduleIIIRows(text, "PUBLIC STORAGE");
  console.log(`▸ Schedule III section starts at idx ${scheduleStart} (${sectionLength} chars)`);
  console.log(`▸ Extracted ${rows.length} MSA rows\n`);

  // Sample top 10 by # facilities
  const top10 = [...rows].sort((a, b) => b.numFacilities - a.numFacilities).slice(0, 10);
  console.log("Top 10 MSAs by facility count:");
  console.log("─".repeat(110));
  console.log("MSA".padEnd(36) + " #Fac".padStart(6) + " NRSF(K)".padStart(10) + " Total $K".padStart(13) + " $/SF".padStart(8) + " $M/Fac".padStart(10) + " Dep%".padStart(8));
  console.log("─".repeat(110));
  for (const r of top10) {
    console.log(
      r.msa.slice(0, 35).padEnd(36) +
      String(r.numFacilities).padStart(6) +
      String(r.nrsfThousands.toLocaleString()).padStart(10) +
      String("$" + r.totalGrossThou.toLocaleString()).padStart(13) +
      String("$" + r.impliedPSF).padStart(8) +
      String("$" + r.impliedPerFacilityM + "M").padStart(10) +
      String(((r.depreciationRatio || 0) * 100).toFixed(1) + "%").padStart(8)
    );
  }

  // Save the structured output
  const out = {
    issuer: psa.ticker,
    cik: psa.cik,
    issuerName: psa.name,
    form: filing.form,
    filingDate: filing.filingDate,
    reportDate: filing.reportDate,
    accessionNumber: filing.accessionNumber,
    filingURL: buildFilingURL(psa.cik, filing.accessionNumber, filing.primaryDocument),
    extractedAt: new Date().toISOString(),
    extractionMethod: "Schedule III regex parser v1",
    msaCount: rows.length,
    totals: {
      facilities: rows.reduce((s, r) => s + r.numFacilities, 0),
      nrsfThousands: rows.reduce((s, r) => s + r.nrsfThousands, 0),
      totalGrossThou: rows.reduce((s, r) => s + r.totalGrossThou, 0),
    },
    rows,
  };

  const dataDir = path.join(__dirname, "..", "..", "src", "data");
  const outPath = path.join(dataDir, `edgar-schedule-iii-${psa.ticker.toLowerCase()}-${filing.reportDate}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n✓ Saved: ${outPath}`);
  console.log(`  Issuer-wide: ${out.totals.facilities} facilities · ${(out.totals.nrsfThousands / 1000).toFixed(1)}M NRSF · $${(out.totals.totalGrossThou / 1000000).toFixed(1)}B gross carrying`);
}

run().catch((e) => {
  console.error("✗ Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
