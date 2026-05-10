// extract-psa-msa-rents.mjs — Per-MSA rent disclosure extractor for PSA's
// "Same Store Facilities Operating Trends by Market" table.
//
// PSA's FY2025 10-K MD&A discloses per-MSA same-store performance for 25
// major metropolitan markets, with disclosed:
//   - Realized rent per occupied SF (year over year)
//   - Average occupancy
//   - Realized rent per available SF (occupancy-adjusted)
//   - Number of facilities
//   - Square feet (millions)
//   - Plus a parallel revenue/expense/NOI table
//
// This is the institutional moat that takes Storvex's rent calibration from
// state-level to MSA-level granularity. LA disclosed $35.76/SF/yr vs
// California state-weighted $20.82/SF/yr — that's 1.7× difference within a
// single state. Sacramento at $21.70/SF/yr disclosed separately as another
// CA MSA.
//
// Output: src/data/edgar-psa-msa-rents.json — schema:
//   storvex.edgar-psa-msa-rents.v1
// Per-MSA: { msa, facilities, sqftM, rentPerOccSF_2025, rentPerOccSF_2024,
//             changePct, occ_2025, occ_2024, rentPerAvailSF_2025,
//             revenues2025K, expenses2025K, noi2025K, source }

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");
const PSA_TEXT_PATH = path.join(__dirname, "_output", "PSA-NEW-text.txt");

// PSA same-store table source metadata (FY2025 10-K)
const PSA_SOURCE = {
  issuer: "PSA",
  issuerName: "Public Storage",
  cik: 1393311,
  accessionNumber: "0001628280-26-007696",
  filingDate: "2026-02-12",
  reportDate: "2025-12-31",
  filingURL: "https://www.sec.gov/Archives/edgar/data/1393311/000162828026007696/psa-20251231.htm",
  tableTitle: "Same Store Facilities Operating Trends by Market",
};

// Each row in the MSA table is: MSA name (multi-word) + facilities (int) +
// sqft (decimal millions) + 2025 rent (decimal $) + 2024 rent (decimal $) +
// 2025-vs-2024 pct + 2025 occ pct + 2024 occ pct + occ change pct +
// 2025 rentPerAvailSF + 2024 rentPerAvailSF + change pct.
//
// MSA names contain spaces, hyphens, dots, slashes — they end where the
// facility count integer begins. We extract via a pattern that allows the
// MSA label to be greedy up until "DDD <decimal>" pattern appears.

function extractRow(line) {
  // Pattern: <name with spaces/hyphens/dots/slashes> <facilities int> <sqftM decimal> $ <rentOcc25> $ <rentOcc24> <pct> <occ25> <occ24> <occChg> $ <rentAvail25> $ <rentAvail24> <pct>
  // Anchors: the "$ N.NN $ N.NN" pair after sqft is unambiguous.
  // Allow rent values without leading "$" (just numeric) for robustness.
  const re = /^(.+?)\s+(\d{1,4})\s+(\d+(?:\.\d+)?)\s+\$?\s*(\d+(?:\.\d+)?)\s+\$?\s*(\d+(?:\.\d+)?)\s+(-?\(?\d+(?:\.\d+)?\)?(?:\s*[—-])?)\s*%?\s+(\d+(?:\.\d+)?)\s*%\s+(\d+(?:\.\d+)?)\s*%\s+(-?\(?\d+(?:\.\d+)?\)?(?:\s*[—-])?)\s*%?\s+\$?\s*(\d+(?:\.\d+)?)\s+\$?\s*(\d+(?:\.\d+)?)\s+(-?\(?\d+(?:\.\d+)?\)?(?:\s*[—-])?)\s*%?$/;
  const m = line.match(re);
  if (!m) return null;
  const cleanPct = (s) => {
    if (!s) return null;
    const t = String(s).replace(/[—–-]\s*/, "0").replace(/\(/, "-").replace(/\)/, "");
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
  };
  return {
    msa: m[1].trim(),
    facilities: parseInt(m[2], 10),
    sqftM: parseFloat(m[3]),
    rentPerOccSF_2025: parseFloat(m[4]),
    rentPerOccSF_2024: parseFloat(m[5]),
    changePct_rent: cleanPct(m[6]),
    occ_2025: parseFloat(m[7]) / 100,
    occ_2024: parseFloat(m[8]) / 100,
    occ_changePct: cleanPct(m[9]),
    rentPerAvailSF_2025: parseFloat(m[10]),
    rentPerAvailSF_2024: parseFloat(m[11]),
    changePct_avail: cleanPct(m[12]),
  };
}

function parseRevenueRow(line) {
  // Revenue/Expense/NOI row format per MSA:
  //   <name> $ <rev25> $ <rev24> <pct> $ <directExp25> $ <directExp24> <pct> $ <indirectExp25> $ <indirectExp24> <pct> $ <noi25> $ <noi24> <pct>
  // Numbers are in $000s with comma separators.
  const re = /^(.+?)\s+\$?\s*([\d,]+)\s+\$?\s*([\d,]+)\s+(-?\(?\d+(?:\.\d+)?\)?(?:\s*[—-])?)\s*%?\s+\$?\s*([\d,]+)\s+\$?\s*([\d,]+)\s+(-?\(?\d+(?:\.\d+)?\)?(?:\s*[—-])?)\s*%?\s+\$?\s*([\d,]+)\s+\$?\s*([\d,]+)\s+(-?\(?\d+(?:\.\d+)?\)?(?:\s*[—-])?)\s*%?\s+\$?\s*([\d,]+)\s+\$?\s*([\d,]+)\s+(-?\(?\d+(?:\.\d+)?\)?(?:\s*[—-])?)\s*%?$/;
  const m = line.match(re);
  if (!m) return null;
  const num = (s) => parseInt(String(s).replace(/,/g, ""), 10);
  const cleanPct = (s) => {
    if (!s) return null;
    const t = String(s).replace(/[—–-]\s*/, "0").replace(/\(/, "-").replace(/\)/, "");
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
  };
  return {
    msa: m[1].trim(),
    revenues_2025_K: num(m[2]),
    revenues_2024_K: num(m[3]),
    revenuesChangePct: cleanPct(m[4]),
    directExp_2025_K: num(m[5]),
    directExp_2024_K: num(m[6]),
    directChangePct: cleanPct(m[7]),
    indirectExp_2025_K: num(m[8]),
    indirectExp_2024_K: num(m[9]),
    indirectChangePct: cleanPct(m[10]),
    noi_2025_K: num(m[11]),
    noi_2024_K: num(m[12]),
    noiChangePct: cleanPct(m[13]),
  };
}

// PSA's MD&A is collapsed to one giant string. Tokenize by recognized MSA
// names + the parsing pattern. We split the big text by introducing a newline
// before each known MSA to make per-row parsing tractable.
const KNOWN_MSAS = [
  "Los Angeles", "San Francisco", "New York", "Washington DC", "Miami",
  "Seattle-Tacoma", "Dallas-Ft. Worth", "Houston", "Chicago", "Atlanta",
  "West Palm Beach", "Orlando-Daytona", "Philadelphia", "Baltimore", "San Diego",
  "Charlotte", "Denver", "Tampa", "Phoenix", "Detroit", "Boston", "Honolulu",
  "Portland", "Minneapolis/St. Paul", "Sacramento", "All other markets", "Totals",
];

function splitToRows(text, msas) {
  // Insert a newline before each MSA name occurrence (except those already
  // preceded by a newline). Then split by newlines and trim.
  let work = text;
  for (const m of msas) {
    // Escape regex special chars
    const escaped = m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    work = work.replace(new RegExp("(?<![\\n])\\b" + escaped + "\\b", "g"), "\n" + m);
  }
  return work.split("\n").map((s) => s.trim()).filter(Boolean);
}

// ─── Build ──────────────────────────────────────────────────────────────────

function buildPSAMSA() {
  const text = fs.readFileSync(PSA_TEXT_PATH, "utf-8");

  // First MSA table: occupancy + rent
  const rentTableStart = text.indexOf("Same Store Facilities Operating Trends by Market As of December 31, 2025");
  if (rentTableStart < 0) throw new Error("Could not find PSA same-store-by-market rent table header");
  const rentTableEnd = text.indexOf("Same Store Facilities Operating Trends by Market (Continued)", rentTableStart + 100);
  const rentSection = text.slice(rentTableStart, rentTableEnd > 0 ? rentTableEnd : rentTableStart + 4000);

  const rentRows = splitToRows(rentSection, KNOWN_MSAS);
  const rentByMSA = {};
  for (const row of rentRows) {
    const parsed = extractRow(row);
    if (parsed && KNOWN_MSAS.includes(parsed.msa)) {
      rentByMSA[parsed.msa] = parsed;
    }
  }

  // Second MSA table: revenues + expenses + NOI (year ended Dec 31, 2025)
  const revTableStart = text.indexOf("Same Store Facilities Operating Trends by Market (Continued)", rentTableStart + 100);
  const revHeaderEnd = text.indexOf("Net Operating Income ($000's)", revTableStart);
  const revTableEnd = text.indexOf("Same Store Facilities Operating Trends by Market (Continued)", revHeaderEnd + 100);
  const revSection = text.slice(revHeaderEnd, revTableEnd > 0 ? revTableEnd : revHeaderEnd + 4000);

  const revRows = splitToRows(revSection, KNOWN_MSAS);
  const revByMSA = {};
  for (const row of revRows) {
    const parsed = parseRevenueRow(row);
    if (parsed && KNOWN_MSAS.includes(parsed.msa)) {
      revByMSA[parsed.msa] = parsed;
    }
  }

  // Build combined per-MSA records
  const records = [];
  for (const msa of KNOWN_MSAS) {
    if (msa === "Totals" || msa === "All other markets") continue; // handle separately
    const r = rentByMSA[msa];
    const rev = revByMSA[msa];
    if (!r) continue;
    records.push({
      msa,
      facilities: r.facilities,
      sqftMillions: r.sqftM,
      rentPerOccSF_2025: r.rentPerOccSF_2025,
      rentPerOccSF_2024: r.rentPerOccSF_2024,
      rentChangeYoY: r.changePct_rent,
      occupancy_2025: r.occ_2025,
      occupancy_2024: r.occ_2024,
      occupancyChangePP: r.occ_changePct,
      rentPerAvailSF_2025: r.rentPerAvailSF_2025,
      rentPerAvailSF_2024: r.rentPerAvailSF_2024,
      revenues_2025_K: rev?.revenues_2025_K ?? null,
      revenues_2024_K: rev?.revenues_2024_K ?? null,
      directExp_2025_K: rev?.directExp_2025_K ?? null,
      indirectExp_2025_K: rev?.indirectExp_2025_K ?? null,
      noi_2025_K: rev?.noi_2025_K ?? null,
      noiChangeYoY: rev?.noiChangePct ?? null,
    });
  }

  const totals = rentByMSA["Totals"] ? {
    facilities: rentByMSA["Totals"].facilities,
    sqftMillions: rentByMSA["Totals"].sqftM,
    rentPerOccSF_2025: rentByMSA["Totals"].rentPerOccSF_2025,
    rentPerOccSF_2024: rentByMSA["Totals"].rentPerOccSF_2024,
    occupancy_2025: rentByMSA["Totals"].occ_2025,
    occupancy_2024: rentByMSA["Totals"].occ_2024,
    revenues_2025_K: revByMSA["Totals"]?.revenues_2025_K ?? null,
    noi_2025_K: revByMSA["Totals"]?.noi_2025_K ?? null,
  } : null;

  const allOther = rentByMSA["All other markets"] ? {
    facilities: rentByMSA["All other markets"].facilities,
    sqftMillions: rentByMSA["All other markets"].sqftM,
    rentPerOccSF_2025: rentByMSA["All other markets"].rentPerOccSF_2025,
    rentPerOccSF_2024: rentByMSA["All other markets"].rentPerOccSF_2024,
    occupancy_2025: rentByMSA["All other markets"].occ_2025,
  } : null;

  return {
    schema: "storvex.edgar-psa-msa-rents.v1",
    generatedAt: new Date().toISOString(),
    source: PSA_SOURCE,
    explainerNote: "Per-MSA same-store performance disclosed in PSA's FY2025 10-K MD&A 'Same Store Facilities Operating Trends by Market' table. Realized annual rent per occupied square foot is computed by PSA as rental income (excluding late charges + admin fees) ÷ weighted average occupied SF. 25 major metropolitan markets named, plus 'All other markets' covering the remaining 673 same-store facilities outside the named MSAs.",
    records,
    totals,
    allOtherMarkets: allOther,
  };
}

const result = buildPSAMSA();
const outPath = path.join(DATA_DIR, "edgar-psa-msa-rents.json");
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

// ─── Console summary ───────────────────────────────────────────────────────
console.log("\n=== PSA Per-MSA Same-Store Rent Index ===\n");
console.log(`Source: PSA FY2025 10-K · accession ${result.source.accessionNumber}`);
console.log(`Records: ${result.records.length} named MSAs · totals + all-other-markets present`);
console.log("\nMSA RENT DISCLOSURES (FY2025, sorted by realized rent per occupied SF desc):");
const sorted = [...result.records].sort((a, b) => b.rentPerOccSF_2025 - a.rentPerOccSF_2025);
console.log("MSA                       Fac  SqftM  Rent/Occ  Occ%   NOI ($K)");
for (const r of sorted) {
  console.log(
    `${r.msa.padEnd(24)} ${String(r.facilities).padStart(4)}  ${(r.sqftMillions || 0).toFixed(1).padStart(5)}  $${r.rentPerOccSF_2025.toFixed(2).padStart(6)}  ${(r.occupancy_2025 * 100).toFixed(1).padStart(4)}%  ${r.noi_2025_K != null ? "$" + r.noi_2025_K.toLocaleString() : "—"}`
  );
}
console.log(`\nTotals: ${result.totals?.facilities} facilities · ${result.totals?.sqftMillions}M SF · $${result.totals?.rentPerOccSF_2025}/SF · ${(result.totals?.occupancy_2025 * 100).toFixed(1)}% occ · NOI $${result.totals?.noi_2025_K?.toLocaleString()}K`);
console.log(`All other markets: ${result.allOtherMarkets?.facilities} facilities · ${result.allOtherMarkets?.sqftMillions}M SF · $${result.allOtherMarkets?.rentPerOccSF_2025}/SF`);
console.log(`\n→ Wrote ${outPath}`);
console.log(`→ ${(JSON.stringify(result).length / 1024).toFixed(1)} KB on disk\n`);
