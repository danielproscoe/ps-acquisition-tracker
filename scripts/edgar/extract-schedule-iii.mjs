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
    .replace(/&#8203;/g, " ")  // zero-width space — CUBE filings are riddled with these
    .replace(/​/g, " ")   // raw zero-width-space char
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')  // smart-quote left
    .replace(/&#8221;/g, '"')  // smart-quote right
    .replace(/&#8211;/g, "—")
    .replace(/&#8212;/g, "—")  // em-dash, used as "no value" placeholder
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
  // Terminators must appear AFTER substantial row data. CUBE puts "Total (A)"
  // in the column header (~250 chars from start) — skip those by requiring
  // at least 1500 chars between schedule start and the terminator match.
  const TERMINATOR_MIN_OFFSET = 1500;
  let scheduleEnd = text.length;
  for (const re of endRegexes) {
    const m = re.exec(text.slice(scheduleStart + TERMINATOR_MIN_OFFSET));
    if (m && (scheduleStart + TERMINATOR_MIN_OFFSET + m.index) < scheduleEnd) {
      scheduleEnd = scheduleStart + TERMINATOR_MIN_OFFSET + m.index;
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

// Issuer-name patterns observed in Schedule III headers. Each REIT formats
// the page header slightly differently — capture the variants we've seen.
const SCHEDULE_HEADER_PATTERNS = {
  PSA: /PUBLIC STORAGE\s+SCHEDULE III/i,
  EXR: /EXTRA SPACE STORAGE\s+INC\.?\s+SCHEDULE III|EXTRA SPACE STORAGE\s+SCHEDULE III/i,
  CUBE: /CUBESMART\s+SCHEDULE III|CubeSmart\s+SCHEDULE III/i,
  LSI: /LIFE STORAGE\s+(?:INC\.?\s+)?SCHEDULE III/i,
  NSA: /NATIONAL STORAGE AFFILIATES\s+(?:TRUST\s+)?SCHEDULE III/i,
  SMA: /SMARTSTOP\s+SELF STORAGE REIT\s+(?:INC\.?\s+)?SCHEDULE III|SMARTSTOP\s+SCHEDULE III/i,
};

async function extractIssuer(ticker, options = {}) {
  const issuer = STORAGE_REITS[ticker];
  if (!issuer) throw new Error(`Unknown issuer ticker: ${ticker}`);

  console.log(`\n▶ ${issuer.name} (${ticker} · CIK ${issuer.cik})`);
  console.log(`  Pulling latest 10-K...`);
  const filing = await fetchLatestFiling(issuer.cik, "10-K");
  if (!filing) {
    console.log(`  ✗ No 10-K found`);
    return null;
  }
  console.log(`  Filing: ${filing.filingDate} (period ${filing.reportDate}) · accession ${filing.accessionNumber}`);

  console.log(`  Fetching ${filing.primaryDocument}...`);
  const html = await fetchFilingDocument(issuer.cik, filing.accessionNumber, filing.primaryDocument);
  const text = htmlToText(html);
  console.log(`  Document size: ${(text.length / 1024).toFixed(0)} KB stripped text`);

  // Strategy: scan ALL "SCHEDULE III" occurrences and pick the one that
  // looks like the actual schedule, not a TOC / auditor-letter reference.
  // Heuristic: "REAL ESTATE" follows within 200 chars AND a row-data anchor
  // ("Initial Cost" / "Gross carrying" / "Land") within 1500 chars after.
  const allHits = [...text.matchAll(/SCHEDULE III/gi)];
  if (allHits.length === 0) {
    console.log(`  ✗ "Schedule III" not found anywhere in filing`);
    return null;
  }

  let bestHit = null;
  for (const hit of allHits) {
    const tail = text.slice(hit.index, hit.index + 1500);
    const realEstateMatch = /REAL\s+ESTATE/i.test(text.slice(hit.index, hit.index + 200));
    // Row-anchor terms must be HIGHLY SPECIFIC to a Schedule III table.
    // "Accumulated Depreciation" and "Buildings and Improvements" appear in
    // many balance-sheet contexts — not unique enough.
    const hasRowAnchor = /(Initial Cost\s+(Adjustments|Costs)|Gross Carrying Amount|Self.?Storage Facilities by (State|Market)|Description\s+No\. of Facilities|Number of Stores\s+Rentable Square Feet)/i.test(tail);
    if (realEstateMatch && hasRowAnchor) {
      bestHit = hit;
      break;
    }
  }
  if (!bestHit) {
    console.log(`  ✗ No "real" Schedule III header found among ${allHits.length} matches (all may be TOC references)`);
    return null;
  }
  console.log(`  Schedule III header located at idx ${bestHit.index} (of ${allHits.length} total mentions)`);

  const { rows, scheduleStart, sectionLength } = extractScheduleIIIRowsFromIndex(text, bestHit.index, ticker);
  console.log(`  Section: idx ${scheduleStart} · ${sectionLength} chars`);
  console.log(`  Extracted ${rows.length} MSA rows`);

  if (rows.length > 0) {
    const top5 = [...rows].sort((a, b) => b.numFacilities - a.numFacilities).slice(0, 5);
    const aggLabel = rows[0].aggregationLevel || "MSA";
    console.log(`  Top 5 ${aggLabel}s:`);
    for (const r of top5) {
      const nrsfStr = r.nrsfThousands != null ? `${r.nrsfThousands.toLocaleString().padStart(7)}K NRSF` : `   ?  K NRSF`;
      const psfStr = r.impliedPSF != null ? `$${r.impliedPSF}/SF` : `$?/SF (no NRSF)`;
      const perFacStr = r.impliedPerFacilityM != null ? `$${r.impliedPerFacilityM}M/fac` : `?/fac`;
      console.log(`    ${r.msa.padEnd(34)}  ${String(r.numFacilities).padStart(4)} fac · ${nrsfStr} · ${psfStr.padEnd(15)} · ${perFacStr.padEnd(10)} · ${((r.depreciationRatio || 0) * 100).toFixed(1)}% dep`);
    }
  }

  const out = {
    issuer: issuer.ticker,
    cik: issuer.cik,
    issuerName: issuer.name,
    form: filing.form,
    filingDate: filing.filingDate,
    reportDate: filing.reportDate,
    accessionNumber: filing.accessionNumber,
    filingURL: buildFilingURL(issuer.cik, filing.accessionNumber, filing.primaryDocument),
    extractedAt: new Date().toISOString(),
    extractionMethod: "Schedule III regex parser v2 (issuer-agnostic)",
    msaCount: rows.length,
    totals: {
      facilities: rows.reduce((s, r) => s + r.numFacilities, 0),
      nrsfThousands: rows.reduce((s, r) => s + r.nrsfThousands, 0),
      totalGrossThou: rows.reduce((s, r) => s + r.totalGrossThou, 0),
    },
    rows,
  };

  if (!options.skipWrite) {
    const dataDir = path.join(__dirname, "..", "..", "src", "data");
    const outPath = path.join(dataDir, `edgar-schedule-iii-${issuer.ticker.toLowerCase()}-${filing.reportDate}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
    console.log(`  ✓ Saved: ${path.relative(path.join(__dirname, "..", ".."), outPath)}`);
  }
  console.log(`  Totals: ${out.totals.facilities} facilities · ${(out.totals.nrsfThousands / 1000).toFixed(1)}M NRSF · $${(out.totals.totalGrossThou / 1000000).toFixed(2)}B gross carrying`);

  return out;
}

// Issuer-specific Schedule III row parsers.
//
// PSA: 11 columns · MSA-aggregated · includes NRSF (thousands)
//   {MSA name} {#fac} {NRSF} {encumbrances} {Land init} {Bldg init} {Costs sub} {Land gross} {Bldg gross} {Total gross} {Accum dep}
//
// EXR: 10 columns · STATE-aggregated · NO NRSF per state in Schedule III
//   {State} {#fac} {Debt} {Land init} {Bldg init} {Costs sub} {Land gross} {Bldg gross} {Total gross} {Accum dep}

const ISSUER_PARSER_HINTS = {
  PSA:  { aggLevel: "MSA",          columnCount: 11, hasNRSF: true,  nrsfUnit: "thousands", terminators: [/Total\s+\(a\)/i] },
  EXR:  { aggLevel: "STATE_2LETTER", columnCount: 10, hasNRSF: false, terminators: [/Totals?\s+\([\da-z]\)/i] },
  CUBE: { aggLevel: "STATE_NAME",    columnCount: 11, hasNRSF: true,  nrsfUnit: "raw",       terminators: [/Totals?\s+\([\da-z]\)/i] },
  SMA:  { aggLevel: "PROPERTY",      columnCount: 10, hasNRSF: false, terminators: [/Totals?\s+\([\da-z]\)/i] },
  SELF: { aggLevel: "PROPERTY",      columnCount: 10, hasNRSF: false, terminators: [/Totals?\s+\([\da-z]\)/i] },
  SGST: { aggLevel: "PROPERTY",      columnCount: 10, hasNRSF: false, terminators: [/Totals?\s+\([\da-z]\)/i] },
};

function extractScheduleIIIRowsFromIndex(text, scheduleStart, ticker) {
  const hints = ISSUER_PARSER_HINTS[ticker] || ISSUER_PARSER_HINTS.PSA;
  const endRegexes = [
    ...hints.terminators,
    /\bNotes to Schedule III\b/i,
    /\bSchedule IV\b/i,
  ];
  // Terminators must appear AFTER substantial row data. CUBE puts "Total (A)"
  // in the column header (~250 chars from start) — skip those by requiring
  // at least 1500 chars between schedule start and the terminator match.
  const TERMINATOR_MIN_OFFSET = 1500;
  let scheduleEnd = text.length;
  for (const re of endRegexes) {
    const m = re.exec(text.slice(scheduleStart + TERMINATOR_MIN_OFFSET));
    if (m && (scheduleStart + TERMINATOR_MIN_OFFSET + m.index) < scheduleEnd) {
      scheduleEnd = scheduleStart + TERMINATOR_MIN_OFFSET + m.index;
    }
  }
  let section = text.slice(scheduleStart, scheduleEnd);
  section = section
    .replace(/\bF-\d{2,3}\b\s+(?:[A-Z][A-Z. ]+?\s+)?SCHEDULE III[^A-Z]*?Description\s+No\. of Facilities[^A-Z]+?(?=[A-Z])/gi, " ")
    .replace(/\bF-\d{2,3}\b/g, " ")
    .replace(/\s+/g, " ");

  if (hints.aggLevel === "MSA") {
    return parsePSAMSAFormat(section, scheduleStart, scheduleEnd);
  }
  if (hints.aggLevel === "STATE_2LETTER") {
    return parseStateFormat(section, scheduleStart, scheduleEnd);
  }
  if (hints.aggLevel === "STATE_NAME") {
    return parseStateNameFormat(section, scheduleStart, scheduleEnd);
  }
  // PROPERTY-level: try state format first, fall back to property-name pattern
  return parseStateFormat(section, scheduleStart, scheduleEnd);
}

// CUBE state-name-aggregated format — 11 columns, NRSF as raw SF (not thousands).
//   {Full state name} {#stores} {raw NRSF with commas} {encumbrances} {Land init} {Bldg init} {Costs sub} {Land gross} {Bldg gross} {Total} {Accum dep}
function parseStateNameFormat(section, scheduleStart, scheduleEnd) {
  // Use full US state names (case-insensitive). District of Columbia handled separately.
  const STATE_NAMES = [
    "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware",
    "Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky",
    "Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi",
    "Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico",
    "New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania",
    "Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
    "Virginia","Washington","West Virginia","Wisconsin","Wyoming","District of Columbia",
  ];
  const stateAlt = STATE_NAMES.map((s) => s.replace(/\s/g, "\\s+")).join("|");
  // Anchor: state name, then 10 numeric columns. NRSF here is raw SF (e.g. 3,319,447).
  const rowRe = new RegExp(
    `\\b(${stateAlt})\\s+(\\d{1,4})\\s+([\\d,]+)\\s+(\\$?\\s*[\\d,—-]+)\\s+(\\$?\\s*[\\d,—-]+)\\s+(\\$?\\s*[\\d,—-]+)\\s+(\\$?\\s*[\\d,—-]+)\\s+(\\$?\\s*[\\d,—-]+)\\s+(\\$?\\s*[\\d,—-]+)\\s+(\\$?\\s*[\\d,—-]+)\\s+(\\$?\\s*[\\d,—-]+)`,
    "gi"
  );
  const rows = [];
  const seenStates = new Set();
  let m;
  while ((m = rowRe.exec(section)) !== null) {
    const [, rawState, numFac, nrsfRaw, encumbrances, landInitial, bldgInitial, costsSubsequent, landGross, bldgGross, totalGross, accumDep] = m;
    const state = rawState.replace(/\s+/g, " ").trim();
    if (seenStates.has(state)) continue; // dedupe — sometimes the totals row triggers
    const numFacInt = parseInt(numFac, 10);
    const nrsfRawSF = parseDollar(nrsfRaw);
    const totalGrossThou = parseDollar(totalGross);
    if (!totalGrossThou || totalGrossThou < 1000) continue;
    if (!nrsfRawSF || nrsfRawSF < 50000) continue; // sanity floor (50K SF = ~1 small store)
    seenStates.add(state);

    // Convert raw SF to thousands for consistency with PSA format
    const nrsfThou = Math.round(nrsfRawSF / 1000);

    rows.push({
      msa: state,
      aggregationLevel: "STATE_NAME",
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
      impliedPSF: nrsfThou > 0 ? Math.round((totalGrossThou * 1000) / (nrsfThou * 1000)) : null,
      impliedPerFacilityM: numFacInt > 0 ? Math.round((totalGrossThou * 1000) / numFacInt / 100000) / 10 : null,
      depreciationRatio: totalGrossThou > 0 ? Math.round((parseDollar(accumDep) / totalGrossThou) * 1000) / 1000 : null,
    });
  }
  return { rows, scheduleStart, scheduleEnd, sectionLength: section.length };
}

// PSA MSA-aggregated format — 11 columns including NRSF.
function parsePSAMSAFormat(section, scheduleStart, scheduleEnd) {
  const rowRe = /([A-Z][A-Za-z./\- ]+?)\s+(\d{1,3})\s+([\d,]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)/g;
  const rows = [];
  let m;
  while ((m = rowRe.exec(section)) !== null) {
    const [, rawName, numFac, nrsfThousands, encumbrances, landInitial, bldgInitial, costsSubsequent, landGross, bldgGross, totalGross, accumDep] = m;
    const name = rawName.trim();
    if (!isValidLocationName(name)) continue;
    const numFacInt = parseInt(numFac, 10);
    const nrsfThou = parseDollar(nrsfThousands);
    if (nrsfThou == null || nrsfThou < 50) continue;
    const totalGrossThou = parseDollar(totalGross);
    if (!totalGrossThou || totalGrossThou < 1000) continue;

    rows.push({
      msa: name,
      aggregationLevel: "MSA",
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
      impliedPSF: nrsfThou > 0 ? Math.round((totalGrossThou * 1000) / (nrsfThou * 1000)) : null,
      impliedPerFacilityM: numFacInt > 0 ? Math.round((totalGrossThou * 1000) / numFacInt / 100000) / 10 : null,
      depreciationRatio: totalGrossThou > 0 ? Math.round((parseDollar(accumDep) / totalGrossThou) * 1000) / 1000 : null,
    });
  }
  return { rows, scheduleStart, scheduleEnd, sectionLength: section.length };
}

// EXR/CUBE state-aggregated format — 10 columns, no NRSF disclosure.
//   {State 2-letter} {#fac} {Debt} {Land init} {Bldg init} {Costs sub} {Land gross} {Bldg gross} {Total} {Accum dep}
function parseStateFormat(section, scheduleStart, scheduleEnd) {
  // State codes are 2 uppercase letters (AL, AK, AZ, ... DC). Anchor on that
  // pattern + 9 numeric columns following.
  const rowRe = /\b([A-Z]{2})\s+(\d{1,4})\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)\s+(\$?\s*[\d,—-]+)/g;
  const rows = [];
  let m;
  const VALID_STATES = new Set([
    "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
    "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
    "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
    "VT","VA","WA","WV","WI","WY","PR",
  ]);
  while ((m = rowRe.exec(section)) !== null) {
    const [, state, numFac, debt, landInitial, bldgInitial, costsSubsequent, landGross, bldgGross, totalGross, accumDep] = m;
    if (!VALID_STATES.has(state)) continue;
    const numFacInt = parseInt(numFac, 10);
    const totalGrossThou = parseDollar(totalGross);
    if (!totalGrossThou || totalGrossThou < 100) continue;

    rows.push({
      msa: state,                           // store state in same field for downstream consistency
      aggregationLevel: "STATE",
      numFacilities: numFacInt,
      nrsfThousands: null,                  // Not disclosed by state-aggregating REITs
      encumbrancesThou: parseDollar(debt),
      landInitialThou: parseDollar(landInitial),
      bldgInitialThou: parseDollar(bldgInitial),
      costsSubsequentThou: parseDollar(costsSubsequent),
      landGrossThou: parseDollar(landGross),
      bldgGrossThou: parseDollar(bldgGross),
      totalGrossThou,
      accumDepThou: parseDollar(accumDep),
      impliedPSF: null,                     // requires NRSF — not available
      impliedPerFacilityM: numFacInt > 0 ? Math.round((totalGrossThou * 1000) / numFacInt / 100000) / 10 : null,
      depreciationRatio: totalGrossThou > 0 ? Math.round((parseDollar(accumDep) / totalGrossThou) * 1000) / 1000 : null,
    });
  }
  return { rows, scheduleStart, scheduleEnd, sectionLength: section.length };
}

function isValidLocationName(name) {
  if (name.length < 3 || name.length > 60) return false;
  if (/^(Description|Initial|Gross|Total|Net|Page|Real Estate|Schedule|Land|Buildings|Inc|Self|Storage)/i.test(name)) return false;
  // Filter PSA's non-MSA aggregation rows (development pipeline, corporate assets, etc.)
  if (/Expansions?\s+in\s+process/i.test(name)) return false;
  if (/Construction\s+(in\s+progress|underway)/i.test(name)) return false;
  if (/Other\s+corporate\s+assets/i.test(name)) return false;
  if (/Intangible\s+(tenant\s+)?(relationship|lease)/i.test(name)) return false;
  if (/Right.?of.?use/i.test(name)) return false;
  if (/Undeveloped\s+land/i.test(name)) return false;
  return true;
}

async function run() {
  // Default to all active issuers if no CLI arg, else the specific ticker.
  const arg = process.argv[2];
  const tickers = arg
    ? [arg.toUpperCase()]
    : ["PSA", "EXR", "CUBE", "SMA"];

  console.log(`════════════════════════════════════════════════════════════════════`);
  console.log(`  SEC EDGAR Schedule III Extractor v2 — multi-issuer institutional`);
  console.log(`  storage REIT comp ingestion. Tickers: ${tickers.join(", ")}`);
  console.log(`════════════════════════════════════════════════════════════════════`);

  const results = [];
  for (const ticker of tickers) {
    try {
      const r = await extractIssuer(ticker);
      if (r) results.push(r);
    } catch (e) {
      console.error(`  ✗ ${ticker} extraction failed: ${e.message}`);
    }
  }

  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`  Extraction summary`);
  console.log(`════════════════════════════════════════════════════════════════════`);
  for (const r of results) {
    console.log(`  ${r.issuer.padEnd(6)} ${r.reportDate}  ${String(r.totals.facilities).padStart(5)} fac  ${(r.totals.nrsfThousands / 1000).toFixed(1).padStart(6)}M NRSF  $${(r.totals.totalGrossThou / 1000000).toFixed(2).padStart(6)}B  (${r.msaCount} MSAs)`);
  }
  const allFac = results.reduce((s, r) => s + r.totals.facilities, 0);
  const allNRSF = results.reduce((s, r) => s + r.totals.nrsfThousands, 0);
  const allGross = results.reduce((s, r) => s + r.totals.totalGrossThou, 0);
  console.log(`  ${"TOTAL".padEnd(6)} ${"".padEnd(10)}  ${String(allFac).padStart(5)} fac  ${(allNRSF / 1000).toFixed(1).padStart(6)}M NRSF  $${(allGross / 1000000).toFixed(2).padStart(6)}B  (across ${results.length} issuers)`);
}

run().catch((e) => {
  console.error("✗ Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
