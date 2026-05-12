// build-rent-trajectory.mjs — Cross-REIT rent time-series accumulator.
//
// Walks every dated daily-snapshot file in src/data/ (psa-facility-rents-
// YYYY-MM-DD.json, cube-facility-rents-YYYY-MM-DD.json, etc.) and rolls
// them up into a per-MSA-per-operator-per-day time-series saved to
// src/data/cross-reit-rent-trajectory.json.
//
// CRUSH RADIUS+ CC-RENT WEDGE:
//   Radius+ presumably maintains internal rent time-series but doesn't
//   expose them with primary-source URL citations per snapshot. Storvex
//   accumulates the daily scraper output into an auditable trajectory
//   — every snapshot cites the scrape source + URL, every datapoint has
//   a timestamp, and the daily refresh-rents.yml cron keeps it current.
//
// Output: src/data/cross-reit-rent-trajectory.json
// Shape:
//   {
//     schema: "storvex.cross-reit-rent-trajectory.v1",
//     generatedAt: ISO,
//     daysCovered: N,
//     operators: ["PSA", "CUBE", ...],
//     snapshots: [
//       {
//         date: "2026-05-11",
//         operator: "PSA",
//         msa: "Houston",
//         ccMedianPerSF_mo: 1.62,
//         ccLowPerSF_mo: 0.95,
//         ccHighPerSF_mo: 2.18,
//         duMedianPerSF_mo: 0.94,
//         facilitiesScraped: 24,
//         totalUnitListings: 487,
//         sourceFile: "src/data/psa-facility-rents-2026-05-11.json",
//         scrapeGeneratedAt: ISO
//       },
//       ...
//     ]
//   }
//
// Run: node scripts/edgar/build-rent-trajectory.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

const OPERATOR_FILE_PATTERNS = [
  { operator: "PSA", regex: /^psa-facility-rents-(\d{4}-\d{2}-\d{2})\.json$/ },
  { operator: "CUBE", regex: /^cube-facility-rents-(\d{4}-\d{2}-\d{2})\.json$/ },
  { operator: "EXR", regex: /^exr-facility-rents-(\d{4}-\d{2}-\d{2})\.json$/ },
  { operator: "NSA", regex: /^nsa-facility-rents-(\d{4}-\d{2}-\d{2})\.json$/ },
];

/**
 * Extract per-MSA median rent rows from a daily snapshot file. Each daily
 * file aggregates by city; we re-aggregate to MSA-level rows.
 */
function extractMSARowsFromDailyFile(filePath, operator, date) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return [];
  }

  const scrapeGeneratedAt = raw.generatedAt || null;

  // PSA + CUBE structure: { cities: [ { city, msa?, facilities: [...] } ] }
  // Build msa rollups from facilities.units rate data.
  const rows = [];

  // Helper — collapse per-facility unit listings into median CC + DU rates
  function rollupFacilities(facilities, msaKey) {
    let ccRates = [];
    let duRates = [];
    let facCount = 0;
    let unitListings = 0;
    for (const fac of facilities || []) {
      if (!Array.isArray(fac.units)) continue;
      facCount++;
      for (const u of fac.units) {
        const psf = Number(u.pricePerSF_mo ?? u.psf ?? u.psfMo);
        if (!isFinite(psf) || psf <= 0) continue;
        unitListings++;
        const isCC =
          u.climateControlled === true ||
          /^cc$/i.test(String(u.unitType || "")) ||
          /climate/i.test(String(u.type || u.unitType || ""));
        if (isCC) ccRates.push(psf);
        else duRates.push(psf);
      }
    }
    if (!facCount) return null;
    return {
      date,
      operator,
      msa: msaKey,
      facilitiesScraped: facCount,
      totalUnitListings: unitListings,
      ccMedianPerSF_mo: median(ccRates),
      ccLowPerSF_mo: ccRates.length ? Math.min(...ccRates) : null,
      ccHighPerSF_mo: ccRates.length ? Math.max(...ccRates) : null,
      ccUnitCount: ccRates.length,
      duMedianPerSF_mo: median(duRates),
      duUnitCount: duRates.length,
      sourceFile: path.relative(process.cwd(), filePath),
      scrapeGeneratedAt,
    };
  }

  // Three known shapes:
  //   (a) PSA daily: { cities: [{ msa, city, facilities: [...] }] }
  //   (b) CUBE daily: { statesGroups: [{ state, facilities: [...] }] }
  //       — facilities carry { city } but no MSA; group by city as MSA-ish key
  //   (c) Future operators may have their own shapes.

  if (Array.isArray(raw.cities)) {
    // PSA shape — group by MSA
    const byMSA = new Map();
    for (const cityEntry of raw.cities) {
      const msaKey = cityEntry.msa || cityEntry.city || "Unknown";
      if (!byMSA.has(msaKey)) byMSA.set(msaKey, []);
      const facs = cityEntry.facilities || [];
      for (const f of facs) byMSA.get(msaKey).push(f);
    }
    for (const [msaKey, facs] of byMSA.entries()) {
      const row = rollupFacilities(facs, msaKey);
      if (row) rows.push(row);
    }
  } else if (Array.isArray(raw.statesGroups)) {
    // CUBE shape — group by city across all states (collapses CUBE's flat
    // statewide listing into city-level rows so the trajectory keys
    // align with PSA's MSA rollups).
    const byCity = new Map();
    for (const stateGrp of raw.statesGroups) {
      for (const fac of stateGrp.facilities || []) {
        // CUBE may store the city in `city` or `cityFromUrl`. Normalize.
        let cityKey = (fac.city || fac.cityFromUrl || "").trim();
        if (!cityKey) cityKey = stateGrp.state || "Unknown";
        // Title-case the city to match PSA's casing (PSA uses "Los Angeles",
        // CUBE may have "los angeles" from URL parsing).
        cityKey = cityKey
          .split(/\s+/)
          .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
          .join(" ");
        if (!byCity.has(cityKey)) byCity.set(cityKey, []);
        byCity.get(cityKey).push(fac);
      }
    }
    // CUBE has 1,500+ cities — only keep cities with 3+ scraped facilities
    // to keep the trajectory snapshot reasonably sized and statistically
    // meaningful.
    const MIN_FACILITIES_PER_CITY = 3;
    for (const [cityKey, facs] of byCity.entries()) {
      if (facs.length < MIN_FACILITIES_PER_CITY) continue;
      const row = rollupFacilities(facs, cityKey);
      if (row) rows.push(row);
    }
  }

  return rows;
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function discoverDailyFiles() {
  const all = fs.readdirSync(DATA_DIR);
  const out = [];
  for (const name of all) {
    for (const pat of OPERATOR_FILE_PATTERNS) {
      const m = pat.regex.exec(name);
      if (m) out.push({ name, fullPath: path.join(DATA_DIR, name), operator: pat.operator, date: m[1] });
    }
  }
  out.sort((a, b) => (a.date === b.date ? a.operator.localeCompare(b.operator) : a.date.localeCompare(b.date)));
  return out;
}

async function run() {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  Cross-REIT Rent Trajectory Accumulator (Crush Radius+ CC RENT)");
  console.log("════════════════════════════════════════════════════════════════════\n");

  const daily = discoverDailyFiles();
  console.log(`Found ${daily.length} dated daily snapshot file(s)\n`);

  // Build a deduplicated trajectory keyed by (date, operator, msa)
  const byKey = new Map();
  for (const f of daily) {
    process.stdout.write(`  · ${f.operator} ${f.date} ${path.basename(f.fullPath)} → `);
    const rows = extractMSARowsFromDailyFile(f.fullPath, f.operator, f.date);
    process.stdout.write(`${rows.length} MSA rows\n`);
    for (const r of rows) {
      const k = `${r.date}|${r.operator}|${r.msa}`;
      byKey.set(k, r);
    }
  }

  const snapshots = Array.from(byKey.values()).sort((a, b) =>
    a.date === b.date
      ? a.operator === b.operator
        ? a.msa.localeCompare(b.msa)
        : a.operator.localeCompare(b.operator)
      : a.date.localeCompare(b.date)
  );

  // Compute summary stats
  const operators = Array.from(new Set(snapshots.map((s) => s.operator))).sort();
  const dates = Array.from(new Set(snapshots.map((s) => s.date))).sort();
  const msas = Array.from(new Set(snapshots.map((s) => s.msa))).sort();

  const output = {
    schema: "storvex.cross-reit-rent-trajectory.v1",
    generatedAt: new Date().toISOString(),
    methodology:
      "Daily per-MSA-per-operator median CC + DU rent rollups from each storage REIT's facility-detail-page scrape. Each snapshot is a single day's median across the operator's facilities in the named MSA. Cumulative across days produces the trajectory time-series.",
    operators,
    daysCovered: dates.length,
    earliestDate: dates[0] || null,
    latestDate: dates[dates.length - 1] || null,
    msasCovered: msas.length,
    totalSnapshots: snapshots.length,
    sourceFiles: daily.map((d) => path.basename(d.fullPath)),
    snapshots,
  };

  const outPath = path.join(DATA_DIR, "cross-reit-rent-trajectory.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log(`  ✓ Wrote ${path.relative(process.cwd(), outPath)}`);
  console.log(`    ${output.totalSnapshots} snapshot(s) · ${output.daysCovered} day(s) · ${output.operators.length} operator(s) · ${output.msasCovered} MSA(s)`);
  console.log(`    Date range: ${output.earliestDate} → ${output.latestDate}`);
  console.log("════════════════════════════════════════════════════════════════════");
}

run().catch((e) => {
  console.error("✗", e.message);
  console.error(e.stack);
  process.exit(1);
});
