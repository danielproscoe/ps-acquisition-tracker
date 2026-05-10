// backfill-historical-same-store.mjs — Multi-year portfolio-aggregate
// same-store backfill for EXR / CUBE / NSA / SMA. Companion to
// backfill-historical-msa-rents.mjs (which is PSA-only, MSA-granular).
//
// Why this exists: PSA's MD&A discloses per-MSA same-store rent — that's
// uniquely granular among institutional storage REITs. EXR / CUBE / NSA /
// SMA disclose only PORTFOLIO-AGGREGATE same-store metrics (revenue
// growth, NOI growth, occupancy, rent per occupied SF). At MSA level they
// are silent; at portfolio level they discloses 5+ years of same-store
// performance which we can ingest as a time series.
//
// Together with the PSA per-MSA series this gives Storvex 5-year
// same-store coverage across all four institutional storage issuers — the
// closest possible primary-source backfill of what Radius+ historically
// owned via proprietary submarket benchmarks.
//
// Output: src/data/edgar-historical-same-store.json
//   { schema: "storvex.edgar-historical-same-store.v1", generated_at,
//     issuers: ["EXR","CUBE","NSA","SMA"],
//     yearsCovered: ["2020", ..., "2025"],
//     byIssuerYear: {
//       "EXR": { "2025": { sameStoreRevenueGrowthYoY, ... }, ... },
//       ...
//     },
//     timeSeries: [
//       { issuer:"EXR", metric:"sameStoreRentPerSF", series:[{year, value}] }
//     ]
//   }
//
// Usage:
//   node scripts/edgar/backfill-historical-same-store.mjs
//   node scripts/edgar/backfill-historical-same-store.mjs --issuer=EXR

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractSameStoreMetrics } from "./extract-same-store-growth.mjs";
import { STORAGE_REITS } from "./cik-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HIST_DIR = path.join(__dirname, "_output", "historical");
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

function parseArgs() {
  const args = { issuer: null };
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k === "issuer") args.issuer = v.toUpperCase();
  }
  return args;
}

// Issuers to backfill — exclude PSA (handled by per-MSA backfill) and LSI
// (acquired by EXR 2023; pre-merger filings cached but treated as historical
// only — included for completeness).
const ISSUERS_PORTFOLIO_AGGREGATE = ["EXR", "CUBE", "NSA", "LSI", "SMA"];

// Metrics from extractSameStoreMetrics that have meaningful multi-year
// time-series interpretation.
const TIME_SERIES_METRICS = [
  "sameStoreRevenueGrowthYoY",
  "sameStoreNOIGrowthYoY",
  "sameStoreOccupancyEOP",
  "sameStoreOccupancyAvg",
  "sameStoreRentPerSF",
  "newLeaseRentPerSF",
];

function loadCachedText(ticker, fyTag) {
  const file = path.join(HIST_DIR, `${ticker}-${fyTag}.txt`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf-8");
}

function detectAvailableYears(ticker) {
  if (!fs.existsSync(HIST_DIR)) return [];
  const files = fs.readdirSync(HIST_DIR);
  const years = new Set();
  const re = new RegExp(`^${ticker}-(\\d{4})\\.txt$`);
  for (const f of files) {
    const m = re.exec(f);
    if (m) years.add(m[1]);
  }
  return Array.from(years).sort();
}

async function main() {
  const args = parseArgs();
  const targets = args.issuer ? [args.issuer] : ISSUERS_PORTFOLIO_AGGREGATE;

  console.log(`backfill-historical-same-store · issuers=${targets.join(",")}`);

  const byIssuerYear = {};
  const log = [];

  for (const ticker of targets) {
    if (!STORAGE_REITS[ticker]) {
      console.warn(`[${ticker}] not in cik-registry; skipping`);
      continue;
    }
    const years = detectAvailableYears(ticker);
    if (years.length === 0) {
      console.warn(`[${ticker}] no cached 10-K texts in ${HIST_DIR} — run backfill-historical-msa-rents.mjs --stage=fetch --issuer=${ticker} first`);
      continue;
    }
    console.log(`\n[${ticker}] ${years.length} years cached: ${years.join(", ")}`);
    byIssuerYear[ticker] = {};

    for (const fyTag of years) {
      const text = loadCachedText(ticker, fyTag);
      if (!text) {
        log.push({ ticker, fyTag, error: "text missing" });
        continue;
      }
      const metrics = extractSameStoreMetrics(text, ticker);
      const populated = Object.entries(metrics).filter(
        ([k, v]) => v != null && k !== "sourceExcerpt" && k !== "revenueGrowthBasis" && k !== "noiGrowthBasis"
      );
      console.log(`  [${ticker} FY${fyTag}] ${populated.length} metrics extracted`);
      if (populated.length > 0) {
        // Show key metrics inline
        const keyVals = TIME_SERIES_METRICS
          .filter((k) => metrics[k] != null)
          .map((k) => {
            const v = metrics[k];
            if (k.includes("Pct") || k.includes("Growth") || k.includes("Occupancy")) {
              return `${k}=${(v * 100).toFixed(2)}%`;
            }
            if (k.includes("Rent")) {
              return `${k}=$${v.toFixed(2)}`;
            }
            return `${k}=${v}`;
          });
        if (keyVals.length > 0) {
          console.log(`    → ${keyVals.join(" · ")}`);
        }
      }
      byIssuerYear[ticker][fyTag] = {
        sameStoreRevenueGrowthYoY: metrics.sameStoreRevenueGrowthYoY,
        sameStoreNOIGrowthYoY: metrics.sameStoreNOIGrowthYoY,
        sameStoreOccupancyEOP: metrics.sameStoreOccupancyEOP,
        sameStoreOccupancyAvg: metrics.sameStoreOccupancyAvg,
        sameStoreRentPerSF: metrics.sameStoreRentPerSF,
        sameStoreRentPerSF_PriorYear: metrics.sameStoreRentPerSF_PriorYear,
        newLeaseRentPerSF: metrics.newLeaseRentPerSF,
        newLeaseRentPerSF_PriorYear: metrics.newLeaseRentPerSF_PriorYear,
        discountPctOfRevenue: metrics.discountPctOfRevenue,
      };
      log.push({
        ticker,
        fyTag,
        metricsExtracted: populated.length,
        revenueGrowthBasis: metrics.revenueGrowthBasis,
        noiGrowthBasis: metrics.noiGrowthBasis,
      });
    }
  }

  // Build time-series view
  const timeSeries = [];
  for (const ticker of Object.keys(byIssuerYear)) {
    const yearMap = byIssuerYear[ticker];
    const yrs = Object.keys(yearMap).sort();
    for (const metric of TIME_SERIES_METRICS) {
      const series = yrs
        .map((y) => ({ year: y, value: yearMap[y][metric] }))
        .filter((p) => p.value != null);
      if (series.length >= 2) {
        const first = series[0];
        const last = series[series.length - 1];
        const numYears = parseInt(last.year, 10) - parseInt(first.year, 10);
        let cagrPct = null;
        // CAGR only meaningful for level metrics (rent, occupancy) not yoy growth metrics
        const isLevelMetric =
          metric === "sameStoreRentPerSF" ||
          metric === "newLeaseRentPerSF" ||
          metric.includes("Occupancy");
        if (isLevelMetric && numYears > 0 && first.value > 0 && last.value > 0) {
          cagrPct = (Math.pow(last.value / first.value, 1 / numYears) - 1) * 100;
        }
        timeSeries.push({
          issuer: ticker,
          metric,
          firstYear: first.year,
          lastYear: last.year,
          firstValue: first.value,
          lastValue: last.value,
          cagrPct,
          dataPoints: series.length,
          series,
        });
      }
    }
  }

  // Cross-REIT averages — same-store rent per SF + occupancy (FY2025)
  const lastYear = Math.max(
    ...Object.values(byIssuerYear)
      .flatMap((m) => Object.keys(m).map((y) => parseInt(y, 10)))
      .filter((y) => !isNaN(y))
  );
  const lastYearStr = String(lastYear);
  const crossREITLatest = {
    asOf: lastYearStr,
    avgSameStoreRentPerSF: null,
    avgSameStoreOccupancyEOP: null,
    avgSameStoreRevenueGrowthYoY: null,
    avgSameStoreNOIGrowthYoY: null,
    contributingIssuers: [],
  };
  const issuersInLast = Object.keys(byIssuerYear).filter(
    (t) => byIssuerYear[t][lastYearStr]
  );
  if (issuersInLast.length >= 2) {
    crossREITLatest.contributingIssuers = issuersInLast;
    const avgOf = (key) => {
      const vals = issuersInLast
        .map((t) => byIssuerYear[t][lastYearStr]?.[key])
        .filter((v) => v != null);
      return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };
    crossREITLatest.avgSameStoreRentPerSF = avgOf("sameStoreRentPerSF");
    crossREITLatest.avgSameStoreOccupancyEOP = avgOf("sameStoreOccupancyEOP");
    crossREITLatest.avgSameStoreRevenueGrowthYoY = avgOf("sameStoreRevenueGrowthYoY");
    crossREITLatest.avgSameStoreNOIGrowthYoY = avgOf("sameStoreNOIGrowthYoY");
  }

  const out = {
    schema: "storvex.edgar-historical-same-store.v1",
    generated_at: new Date().toISOString(),
    issuers: Object.keys(byIssuerYear),
    yearsCovered: Array.from(
      new Set(
        Object.values(byIssuerYear).flatMap((m) => Object.keys(m))
      )
    ).sort(),
    extractionLog: log,
    crossREITLatest,
    byIssuerYear,
    timeSeries,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outPath = path.join(DATA_DIR, "edgar-historical-same-store.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(`\nOutput → ${path.relative(process.cwd(), outPath)}`);
  console.log(`  Issuers: ${out.issuers.join(", ")}`);
  console.log(`  Years covered: ${out.yearsCovered.join(", ")}`);
  console.log(`  Time series rows: ${timeSeries.length}`);
  if (crossREITLatest.contributingIssuers.length > 0) {
    console.log(`\n  Cross-REIT FY${lastYearStr} portfolio averages:`);
    if (crossREITLatest.avgSameStoreRentPerSF != null) {
      console.log(`    rent per occupied SF: $${crossREITLatest.avgSameStoreRentPerSF.toFixed(2)} (${crossREITLatest.contributingIssuers.join("+")})`);
    }
    if (crossREITLatest.avgSameStoreOccupancyEOP != null) {
      console.log(`    occupancy EOP: ${(crossREITLatest.avgSameStoreOccupancyEOP * 100).toFixed(2)}%`);
    }
    if (crossREITLatest.avgSameStoreRevenueGrowthYoY != null) {
      console.log(`    revenue growth YoY: ${(crossREITLatest.avgSameStoreRevenueGrowthYoY * 100).toFixed(2)}%`);
    }
    if (crossREITLatest.avgSameStoreNOIGrowthYoY != null) {
      console.log(`    NOI growth YoY: ${(crossREITLatest.avgSameStoreNOIGrowthYoY * 100).toFixed(2)}%`);
    }
  }
}

main().catch((e) => {
  console.error("Fatal:", e.stack || e.message);
  process.exit(1);
});
