// backfill-historical-msa-rents.mjs — Multi-year MSA-rent backfill from REIT
// 10-K filings. Closes the only Radius+ moat (10+ yr historical rent comps)
// by ingesting 5+ years of PSA / EXR / CUBE / NSA / LSI same-store-by-MSA
// disclosures from SEC EDGAR.
//
// Stages:
//   1. fetch  — download N most recent 10-Ks per issuer; dump primary HTML
//               + extracted text to scripts/edgar/_output/historical/
//   2. extract — run MSA rent-table parsers against each year's text;
//                emit src/data/edgar-historical-msa-rents.json with
//                per-issuer per-year per-MSA records
//   3. all    — run both stages end-to-end (default)
//
// Output schema: storvex.edgar-historical-msa-rents.v1
//   {
//     schema, generated_at, issuers: ["PSA","EXR","CUBE","NSA","LSI"],
//     yearsCovered: ["2020","2021","2022","2023","2024","2025"],
//     byIssuerYearMSA: {
//       "PSA": {
//         "2025": { "Los Angeles": { rentPerOccSF, occ, sqftM, ... }, ... },
//         "2024": { ... }
//       },
//       ...
//     },
//     timeSeries: [
//       { issuer:"PSA", msa:"Los Angeles", series:[{year:"2025",rent:35.76},...] }
//     ]
//   }
//
// Usage:
//   node scripts/edgar/backfill-historical-msa-rents.mjs                 # default — all stages, all issuers
//   node scripts/edgar/backfill-historical-msa-rents.mjs --stage=fetch
//   node scripts/edgar/backfill-historical-msa-rents.mjs --issuer=PSA
//   node scripts/edgar/backfill-historical-msa-rents.mjs --years=5       # last N 10-Ks per issuer (default 6)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORAGE_REITS } from "./cik-registry.mjs";
import { fetchSubmissionsIndex, listFilings, fetchFilingDocument, buildFilingURL } from "./fetch-filing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_HIST_DIR = path.join(__dirname, "_output", "historical");
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");
fs.mkdirSync(OUTPUT_HIST_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = { stage: "all", issuer: null, years: 6 };
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k === "stage") args.stage = v;
    else if (k === "issuer") args.issuer = v.toUpperCase();
    else if (k === "years") args.years = parseInt(v, 10);
  }
  return args;
}

// ─── HTML → Text (lifted from extract-same-store-growth.mjs) ────────────────

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&#8203;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, "—")
    .replace(/&#8212;/g, "—")
    .replace(/\s+/g, " ");
}

// ─── Stage 1 — Fetch historical 10-Ks ───────────────────────────────────────

const ISSUERS_FOR_BACKFILL = ["PSA", "EXR", "CUBE", "NSA", "LSI"];

async function fetchHistoricalForIssuer(ticker, yearsRequested) {
  const reit = STORAGE_REITS[ticker];
  if (!reit) {
    console.error(`  [${ticker}] not in cik-registry; skipping`);
    return [];
  }
  console.log(`\n[${ticker}] fetching submissions index…`);
  const idx = await fetchSubmissionsIndex(reit.cik);
  const tenKs = listFilings(idx, (f) => f.form === "10-K");
  console.log(`  found ${tenKs.length} 10-K filings`);
  if (tenKs.length === 0) return [];

  // Take the N most recent (newest first per SEC's submissions index ordering).
  const slice = tenKs.slice(0, yearsRequested);

  const records = [];
  for (const filing of slice) {
    const fyTag = (filing.reportDate || filing.filingDate).slice(0, 4);
    const dumpHtml = path.join(OUTPUT_HIST_DIR, `${ticker}-${fyTag}.html`);
    const dumpText = path.join(OUTPUT_HIST_DIR, `${ticker}-${fyTag}.txt`);

    if (fs.existsSync(dumpText)) {
      console.log(`  [${ticker} FY${fyTag}] cached (skip)`);
      records.push({ ticker, fyTag, filing, textPath: dumpText, cached: true });
      continue;
    }

    console.log(`  [${ticker} FY${fyTag}] fetching ${filing.primaryDocument}…`);
    try {
      const html = await fetchFilingDocument(reit.cik, filing.accessionNumber, filing.primaryDocument);
      const text = htmlToText(html);
      fs.writeFileSync(dumpHtml, html);
      fs.writeFileSync(dumpText, text);
      console.log(`    saved (${(html.length / 1024).toFixed(0)}KB html · ${(text.length / 1024).toFixed(0)}KB text)`);
      records.push({ ticker, fyTag, filing, textPath: dumpText, cached: false });
    } catch (e) {
      console.error(`    ERROR: ${e.message}`);
      records.push({ ticker, fyTag, filing, error: e.message });
    }
  }
  return records;
}

async function stageFetch(args) {
  console.log("STAGE 1 — Fetching historical 10-Ks");
  const targets = args.issuer ? [args.issuer] : ISSUERS_FOR_BACKFILL;
  const allRecords = [];
  for (const ticker of targets) {
    const recs = await fetchHistoricalForIssuer(ticker, args.years);
    allRecords.push(...recs);
  }
  // Manifest of what we have on disk
  const manifestPath = path.join(OUTPUT_HIST_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(allRecords.map((r) => ({
    ticker: r.ticker,
    fyTag: r.fyTag,
    filingDate: r.filing?.filingDate,
    reportDate: r.filing?.reportDate,
    accessionNumber: r.filing?.accessionNumber,
    primaryDocument: r.filing?.primaryDocument,
    textPath: r.textPath ? path.relative(__dirname, r.textPath) : null,
    error: r.error || null,
  })), null, 2));
  console.log(`\nManifest → ${path.relative(process.cwd(), manifestPath)}`);
  return allRecords;
}

// ─── Stage 2 — Extract per-MSA rents from each year's text ──────────────────

// Known MSAs as they appear in PSA's same-store table. Older filings may
// have slight variations (e.g. "Washington, DC" vs "Washington DC") — we
// match on a lenient list.
const KNOWN_MSAS = [
  "Los Angeles", "San Francisco", "New York", "Washington DC", "Washington, DC", "Miami",
  "Seattle-Tacoma", "Seattle/Tacoma", "Dallas-Ft. Worth", "Dallas/Ft. Worth", "Houston",
  "Chicago", "Atlanta", "West Palm Beach", "Orlando-Daytona", "Orlando/Daytona",
  "Philadelphia", "Baltimore", "San Diego", "Charlotte", "Denver", "Tampa", "Phoenix",
  "Detroit", "Boston", "Honolulu", "Portland", "Minneapolis/St. Paul", "Minneapolis",
  "Sacramento", "Las Vegas", "Nashville", "Austin", "Raleigh", "All other markets",
  "Totals",
];

// Find the same-store rent table inside the 10-K text. PSA's wording has been
// stable across years: "Same Store Facilities Operating Trends by Market"
// followed by "As of December 31, YYYY". Older filings may use "as of"
// lowercased.
function findRentTableSection(text) {
  const headerPatterns = [
    /Same Store Facilities Operating Trends by Market\s+As of December 31,?\s+\d{4}/i,
    /Same[- ]?Store Facilities Operating Trends by Market/i,
    /Same Store Facilities by Market/i,
  ];
  for (const re of headerPatterns) {
    const m = text.match(re);
    if (m) {
      const start = m.index;
      // Slice next ~6KB which should comfortably contain the rent table
      // before the revenue/expense continuation. Stop at the "(Continued)"
      // header or at the next major section.
      const continuationIdx = text.indexOf("(Continued)", start + 100);
      const endIdx = continuationIdx > 0 ? continuationIdx : start + 6000;
      return text.slice(start, endIdx);
    }
  }
  return null;
}

// Loose row extractor — older PSA filings disclose 8-9 columns (rent +
// occupancy) without the rent-per-available-SF block. We try multiple
// patterns and take the first that matches.
function extractRowMultiPattern(line) {
  // Pattern A — full FY2025 format (12+ numeric fields)
  const pA = /^(.+?)\s+(\d{1,4})\s+(\d+(?:\.\d+)?)\s+\$?\s*(\d+(?:\.\d+)?)\s+\$?\s*(\d+(?:\.\d+)?)\s+(-?\(?\d+(?:\.\d+)?\)?(?:\s*[—-])?)\s*%?\s+(\d+(?:\.\d+)?)\s*%\s+(\d+(?:\.\d+)?)\s*%/;
  const mA = line.match(pA);
  if (mA) {
    return {
      msa: mA[1].trim(),
      facilities: parseInt(mA[2], 10),
      sqftMillions: parseFloat(mA[3]),
      rentPerOccSF: parseFloat(mA[4]),
      rentPerOccSF_PriorYear: parseFloat(mA[5]),
      rentChangeYoY: parseFloat(String(mA[6]).replace(/[—–-]\s*/, "0").replace(/[()]/g, "")),
      occupancy: parseFloat(mA[7]) / 100,
      occupancy_PriorYear: parseFloat(mA[8]) / 100,
    };
  }
  // Pattern B — older format (rent only, no rentPerAvailSF block)
  const pB = /^(.+?)\s+(\d{1,4})\s+(\d+(?:\.\d+)?)\s+\$?\s*(\d+(?:\.\d+)?)\s+\$?\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*%\s+(\d+(?:\.\d+)?)\s*%/;
  const mB = line.match(pB);
  if (mB) {
    return {
      msa: mB[1].trim(),
      facilities: parseInt(mB[2], 10),
      sqftMillions: parseFloat(mB[3]),
      rentPerOccSF: parseFloat(mB[4]),
      rentPerOccSF_PriorYear: parseFloat(mB[5]),
      occupancy: parseFloat(mB[6]) / 100,
      occupancy_PriorYear: parseFloat(mB[7]) / 100,
    };
  }
  return null;
}

function splitToRows(text, msas) {
  let work = text;
  for (const m of msas) {
    const escaped = m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    work = work.replace(new RegExp("(?<![\\n])\\b" + escaped + "\\b", "g"), "\n" + m);
  }
  return work.split("\n").map((s) => s.trim()).filter(Boolean);
}

function normalizeMSA(name) {
  return name
    .replace(/Washington,\s*DC/i, "Washington DC")
    .replace(/Seattle\/Tacoma/i, "Seattle-Tacoma")
    .replace(/Dallas\/Ft\.?\s*Worth/i, "Dallas-Ft. Worth")
    .replace(/Orlando\/Daytona/i, "Orlando-Daytona");
}

function extractYearFromText(text, fyTag) {
  // Try to confirm the fiscal-year tag by matching "December 31, YYYY"
  // near the rent table header.
  const m = text.match(/Same Store Facilities Operating Trends by Market\s+As of December 31,?\s+(\d{4})/i);
  return m ? m[1] : fyTag;
}

function extractMSARentsFromText(text, fyTag) {
  const section = findRentTableSection(text);
  if (!section) return { msaRecords: {}, year: fyTag, sectionFound: false };
  const year = extractYearFromText(text, fyTag);
  const rows = splitToRows(section, KNOWN_MSAS);
  const msaRecords = {};
  for (const row of rows) {
    const parsed = extractRowMultiPattern(row);
    if (!parsed) continue;
    const normalized = normalizeMSA(parsed.msa);
    // Only accept MSAs in the known set (filters noise)
    const knownNorm = KNOWN_MSAS.map(normalizeMSA);
    if (!knownNorm.includes(normalized)) continue;
    if (normalized === "Totals") continue;
    msaRecords[normalized] = { ...parsed, msa: normalized };
  }
  return { msaRecords, year, sectionFound: true, section: section.slice(0, 200) };
}

async function stageExtract() {
  console.log("\nSTAGE 2 — Extracting per-MSA rents from cached 10-K texts");
  const manifestPath = path.join(OUTPUT_HIST_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error("  No manifest at " + manifestPath + " — run stage=fetch first.");
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  const byIssuerYearMSA = {};
  const extractionLog = [];

  for (const entry of manifest) {
    if (!entry.textPath || entry.error) continue;
    const fullPath = path.join(__dirname, entry.textPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`  [${entry.ticker} FY${entry.fyTag}] text missing on disk — skipping`);
      continue;
    }
    const text = fs.readFileSync(fullPath, "utf-8");
    const { msaRecords, year, sectionFound } = extractMSARentsFromText(text, entry.fyTag);
    const msaCount = Object.keys(msaRecords).length;
    console.log(`  [${entry.ticker} FY${year}] ${sectionFound ? "✓" : "✗"} section, ${msaCount} MSAs extracted`);
    extractionLog.push({
      ticker: entry.ticker,
      fyTag: entry.fyTag,
      yearDetected: year,
      sectionFound,
      msaCount,
      filingDate: entry.filingDate,
      accessionNumber: entry.accessionNumber,
    });
    if (msaCount > 0) {
      if (!byIssuerYearMSA[entry.ticker]) byIssuerYearMSA[entry.ticker] = {};
      byIssuerYearMSA[entry.ticker][year] = msaRecords;
    }
  }

  // Build time series view: per issuer, per MSA, ordered by year
  const timeSeries = [];
  for (const ticker of Object.keys(byIssuerYearMSA)) {
    const yearMap = byIssuerYearMSA[ticker];
    const allMSAs = new Set();
    for (const year of Object.keys(yearMap)) {
      for (const msa of Object.keys(yearMap[year])) allMSAs.add(msa);
    }
    for (const msa of allMSAs) {
      const series = Object.keys(yearMap)
        .sort()
        .map((year) => ({
          year,
          rentPerOccSF: yearMap[year][msa]?.rentPerOccSF ?? null,
          occupancy: yearMap[year][msa]?.occupancy ?? null,
          facilities: yearMap[year][msa]?.facilities ?? null,
          sqftMillions: yearMap[year][msa]?.sqftMillions ?? null,
        }))
        .filter((p) => p.rentPerOccSF !== null);
      if (series.length >= 2) {
        // Compute multi-year CAGR if we have at least 2 datapoints
        const first = series[0];
        const last = series[series.length - 1];
        const years = parseInt(last.year, 10) - parseInt(first.year, 10);
        const cagrPct = years > 0
          ? (Math.pow(last.rentPerOccSF / first.rentPerOccSF, 1 / years) - 1) * 100
          : null;
        timeSeries.push({
          issuer: ticker,
          msa,
          series,
          firstYear: first.year,
          lastYear: last.year,
          firstRent: first.rentPerOccSF,
          lastRent: last.rentPerOccSF,
          totalChangePct: ((last.rentPerOccSF / first.rentPerOccSF) - 1) * 100,
          cagrPct,
        });
      }
    }
  }

  const out = {
    schema: "storvex.edgar-historical-msa-rents.v1",
    generated_at: new Date().toISOString(),
    issuers: Object.keys(byIssuerYearMSA),
    yearsCovered: Array.from(
      new Set(
        Object.values(byIssuerYearMSA).flatMap((m) => Object.keys(m))
      )
    ).sort(),
    extractionLog,
    byIssuerYearMSA,
    timeSeries,
  };

  const outPath = path.join(DATA_DIR, "edgar-historical-msa-rents.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nOutput → ${path.relative(process.cwd(), outPath)}`);
  console.log(`  Issuers: ${out.issuers.join(", ")}`);
  console.log(`  Years covered: ${out.yearsCovered.join(", ")}`);
  console.log(`  Time series rows (issuer × MSA): ${out.timeSeries.length}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  const args = parseArgs();
  console.log(`backfill-historical-msa-rents · stage=${args.stage} · issuer=${args.issuer || "all"} · years=${args.years}`);
  if (args.stage === "fetch" || args.stage === "all") {
    await stageFetch(args);
  }
  if (args.stage === "extract" || args.stage === "all") {
    await stageExtract();
  }
  console.log("\nDone.");
})().catch((e) => {
  console.error("\nFatal:", e.stack || e.message);
  process.exit(1);
});
