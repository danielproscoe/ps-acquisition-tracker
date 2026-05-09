// extract-same-store-growth.mjs — Day 6: same-store rent growth ingester.
//
// Pulls each REIT's latest 10-K (and optionally recent 10-Qs) and extracts
// same-store performance disclosures:
//   - Same-store revenue growth (Y/Y)
//   - Same-store NOI growth (Y/Y)
//   - Same-store occupancy
//   - Same-store rent per occupied SF (when disclosed)
//
// These are calibrated, primary-source growth signals that replace the
// generic 11% Y1→Y3 ECRI lift in projectStabilizedNOI(). For institutional
// readers, this is the "more accurate forward projections" delivery — every
// growth assumption traces to a specific REIT's quarterly disclosure rather
// than a generic industry benchmark.
//
// Output: src/data/edgar-same-store-growth.json — per-REIT, per-period
// disclosed performance with full audit citations.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORAGE_REITS } from "./cik-registry.mjs";
import { fetchLatestFiling, fetchFilingDocument, buildFilingURL } from "./fetch-filing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

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

function parsePct(s) {
  if (!s) return null;
  const m = String(s).match(/(-?[\d.]+)\s*%/);
  return m ? parseFloat(m[1]) / 100 : null;
}

function parseNumber(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/[$,]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// Extract same-store performance metrics from REIT 10-K text.
// Each issuer phrases the disclosure differently — we use multiple candidate
// patterns and keep the first non-null match per metric.
function extractSameStoreMetrics(text, ticker) {
  const metrics = {
    sameStoreRevenueGrowthYoY: null,
    sameStoreNOIGrowthYoY: null,
    sameStoreOccupancyEOP: null,  // end-of-period occupancy
    sameStoreOccupancyAvg: null,
    sameStoreRentPerSF: null,
    sourceExcerpt: null,
  };

  // ── Revenue growth Y/Y patterns ──
  // CRITICAL: check "remained relatively unchanged" FIRST. PSA's 2025 10-K
  // describes 2025 as "unchanged" while the prior-year-comparison section
  // describes 2024 as "decreased 0.6%". If we run numeric patterns first
  // we capture the wrong year (2024 instead of 2025).
  const unchangedRe = /revenues?\s+(?:for\s+(?:the\s+)?)?(?:Same[ -]Store|same[ -]store)\s+(?:Facilit\w+|properties?|portfolio)\s+remained\s+(?:relatively\s+)?unchanged/i;
  const um = unchangedRe.exec(text);
  if (um) {
    metrics.sameStoreRevenueGrowthYoY = 0.0;
    const start = Math.max(0, um.index - 50);
    const end = Math.min(text.length, um.index + 250);
    metrics.sourceExcerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
    metrics.revenueGrowthBasis = "qualitative — disclosure states revenues 'remained relatively unchanged'";
  }
  // PSA: "decreased 0.6% or $22.7 million in 2024" (signed)
  // EXR: "Same-store revenues increased $X million, or X.X%, compared to..."
  // CUBE: "increased $X million, or X.X%, due to..."
  const revPatterns = [
    // Match: "(Same Store|Same-store) (revenues|revenue) (...) (increased|grew|rose|decreased|declined) (...) X.X%"
    /(?:same[ -]store)\s+(?:facilit\w+\s+)?(?:total\s+)?revenues?\s*(?:of\s+\$[\d,.]+\s+million\s+)?(?:in\s+\d{4}\s+)?(increased|grew|rose|decreased|declined|decreased\s+by|declined\s+by)\s*(?:(?:by\s+)?\$?[\d,.]+\s+million,?\s*(?:or\s+|by\s+)?)?(-?[\d.]+)\s*%/i,
    // Match: "Revenues for the Same Store Facilities (increased|decreased) X.X%"
    /revenues?\s+(?:for\s+(?:the\s+)?(?:Same[ -]Store|same[ -]store)\s+(?:Facilit\w+|properties?|portfolio|stores?)[\s\S]{0,80})(increased|decreased|declined|grew)\s*(?:by\s+)?(?:\$[\d,.]+\s+million,?\s*(?:or\s+)?)?(-?[\d.]+)\s*%/i,
    // Generic "same store revenue growth of X.X%"
    /same[ -]store(?:\s+pool)?\s+revenue\s+growth\s+of\s+(-?[\d.]+)\s*%/i,
  ];
  // Only run numeric patterns if "unchanged" wasn't matched
  if (metrics.sameStoreRevenueGrowthYoY == null) {
    for (const re of revPatterns) {
      const m = re.exec(text);
      if (m) {
        let direction, pctStr;
        if (m.length >= 3 && m[2] && /^-?[\d.]+$/.test(m[2])) {
          direction = m[1];
          pctStr = m[2];
        } else {
          direction = "increased";
          pctStr = m[1];
        }
        let pct = parseFloat(pctStr) / 100;
        if (/declined|decreased/i.test(direction) && pct > 0) pct = -pct;
        metrics.sameStoreRevenueGrowthYoY = pct;
        const start = Math.max(0, m.index - 100);
        const end = Math.min(text.length, m.index + 250);
        metrics.sourceExcerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
        metrics.revenueGrowthBasis = "numeric — extracted from explicit YoY % disclosure";
        break;
      }
    }
  }

  // ── NOI growth Y/Y patterns ──
  const noiPatterns = [
    /same[ -]store(?:\s+pool)?\s+(?:net operating income|NOI)\s+(?:for\s+\d{4}\s+)?(?:increased|grew|rose)(?:\s+\$[\d.]+\s+million,?)?\s+(?:by\s+)?(-?[\d.]+)\s*%/i,
    /same[ -]store(?:\s+pool)?\s+(?:net operating income|NOI)\s+growth\s+of\s+(-?[\d.]+)\s*%/i,
    /same[ -]store(?:\s+pool)?\s+(?:net operating income|NOI)\s+(?:declined|decreased)(?:\s+\$[\d.]+\s+million,?)?\s+(?:by\s+)?(-?[\d.]+)\s*%/i,
  ];
  for (const re of noiPatterns) {
    const m = re.exec(text);
    if (m) {
      let pct = parseFloat(m[1]) / 100;
      if (/declined|decreased/i.test(m[0]) && pct > 0) pct = -pct;
      metrics.sameStoreNOIGrowthYoY = pct;
      break;
    }
  }

  // ── Same-store occupancy ──
  // PSA: "weighted average square foot occupancy ... was XX.X%"
  // Generic: "average occupancy of XX.X%"
  const occPatterns = [
    /same[ -]store(?:[^.]+?)(?:weighted average\s+)?(?:square\s+foot\s+)?occupancy[^.]*?(\d{2}\.\d)\s*%/i,
    /(?:weighted average|average)\s+(?:square\s+foot\s+)?occupancy\s+(?:of\s+)?same[ -]store[^.]*?(\d{2}\.\d)\s*%/i,
  ];
  for (const re of occPatterns) {
    const m = re.exec(text);
    if (m) {
      metrics.sameStoreOccupancyAvg = parseFloat(m[1]) / 100;
      break;
    }
  }

  // ── Rent per occupied SF ──
  // PSA: "average annualized realized rent per occupied square foot of $XX.XX"
  const rentPatterns = [
    /(?:average\s+)?(?:annualized\s+)?(?:realized\s+)?rent\s+per\s+occupied\s+square\s+foot\s+(?:of\s+)?\$(\d+\.\d{2})/i,
    /rent\s+per\s+occupied\s+square\s+foot\s+(?:was\s+)?\$(\d+\.\d{2})/i,
  ];
  for (const re of rentPatterns) {
    const m = re.exec(text);
    if (m) {
      metrics.sameStoreRentPerSF = parseFloat(m[1]);
      break;
    }
  }

  return metrics;
}

async function extractIssuer(ticker) {
  const issuer = STORAGE_REITS[ticker];
  if (!issuer) throw new Error(`Unknown ticker: ${ticker}`);

  console.log(`\n▶ ${issuer.name} (${ticker})`);
  console.log(`  Pulling latest 10-K...`);
  const filing = await fetchLatestFiling(issuer.cik, "10-K");
  if (!filing) {
    console.log(`  ✗ No 10-K found`);
    return null;
  }
  console.log(`  Filing: ${filing.filingDate} (period ${filing.reportDate})`);
  console.log(`  Accession: ${filing.accessionNumber}`);

  const html = await fetchFilingDocument(issuer.cik, filing.accessionNumber, filing.primaryDocument);
  const text = htmlToText(html);

  const metrics = extractSameStoreMetrics(text, ticker);
  console.log(`  Same-store revenue growth Y/Y: ${metrics.sameStoreRevenueGrowthYoY != null ? (metrics.sameStoreRevenueGrowthYoY * 100).toFixed(2) + "%" : "NOT FOUND"}`);
  console.log(`  Same-store NOI growth Y/Y:     ${metrics.sameStoreNOIGrowthYoY != null ? (metrics.sameStoreNOIGrowthYoY * 100).toFixed(2) + "%" : "NOT FOUND"}`);
  console.log(`  Same-store avg occupancy:      ${metrics.sameStoreOccupancyAvg != null ? (metrics.sameStoreOccupancyAvg * 100).toFixed(1) + "%" : "NOT FOUND"}`);
  console.log(`  Rent / occupied SF:            ${metrics.sameStoreRentPerSF != null ? "$" + metrics.sameStoreRentPerSF.toFixed(2) : "NOT FOUND"}`);
  if (metrics.sourceExcerpt) {
    console.log(`  Excerpt: "${metrics.sourceExcerpt.slice(0, 200)}..."`);
  }

  return {
    issuer: issuer.ticker,
    cik: issuer.cik,
    issuerName: issuer.name,
    form: filing.form,
    filingDate: filing.filingDate,
    reportDate: filing.reportDate,
    accessionNumber: filing.accessionNumber,
    filingURL: buildFilingURL(issuer.cik, filing.accessionNumber, filing.primaryDocument),
    extractedAt: new Date().toISOString(),
    metrics,
  };
}

async function run() {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  Day 6 — Same-Store Rent Growth Ingester");
  console.log("════════════════════════════════════════════════════════════════════");

  const tickers = ["PSA", "EXR", "CUBE"];
  const results = [];
  for (const t of tickers) {
    try {
      const r = await extractIssuer(t);
      if (r) results.push(r);
    } catch (e) {
      console.error(`  ✗ ${t} failed: ${e.message}`);
    }
  }

  // Compute cross-REIT averages where data is available
  const validRev = results.filter((r) => r.metrics.sameStoreRevenueGrowthYoY != null);
  const validNOI = results.filter((r) => r.metrics.sameStoreNOIGrowthYoY != null);
  const validOcc = results.filter((r) => r.metrics.sameStoreOccupancyAvg != null);

  const crossREITAvg = {
    avgSameStoreRevenueGrowthYoY: validRev.length > 0 ? validRev.reduce((s, r) => s + r.metrics.sameStoreRevenueGrowthYoY, 0) / validRev.length : null,
    avgSameStoreNOIGrowthYoY: validNOI.length > 0 ? validNOI.reduce((s, r) => s + r.metrics.sameStoreNOIGrowthYoY, 0) / validNOI.length : null,
    avgSameStoreOccupancy: validOcc.length > 0 ? validOcc.reduce((s, r) => s + r.metrics.sameStoreOccupancyAvg, 0) / validOcc.length : null,
    contributingIssuers: validRev.map((r) => r.issuer),
  };

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("  Cross-REIT Same-Store Performance (FY2025)");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  Avg same-store revenue growth Y/Y: ${crossREITAvg.avgSameStoreRevenueGrowthYoY != null ? (crossREITAvg.avgSameStoreRevenueGrowthYoY * 100).toFixed(2) + "%" : "—"}`);
  console.log(`  Avg same-store NOI growth Y/Y:     ${crossREITAvg.avgSameStoreNOIGrowthYoY != null ? (crossREITAvg.avgSameStoreNOIGrowthYoY * 100).toFixed(2) + "%" : "—"}`);
  console.log(`  Avg same-store occupancy:          ${crossREITAvg.avgSameStoreOccupancy != null ? (crossREITAvg.avgSameStoreOccupancy * 100).toFixed(1) + "%" : "—"}`);
  console.log(`  Contributing issuers:              ${crossREITAvg.contributingIssuers.join(", ") || "none"}`);

  const out = {
    schema: "storvex.edgar-same-store-growth.v1",
    generatedAt: new Date().toISOString(),
    issuers: results,
    crossREITAvg,
    citationRule: "Each per-issuer record cites the SEC EDGAR accession number + URL of the 10-K from which the metrics were extracted. Cross-REIT averages reflect the average of contributing issuers' disclosed values.",
  };

  const outPath = path.join(DATA_DIR, "edgar-same-store-growth.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n✓ Saved: src/data/edgar-same-store-growth.json`);
}

run().catch((e) => {
  console.error("✗ Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
