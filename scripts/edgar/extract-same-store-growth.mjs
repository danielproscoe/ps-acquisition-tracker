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
    sameStoreRentPerSF_PriorYear: null,
    // NEW EXR-disclosed metric: avg new-lease rent per SF.
    // EXR's 10-K MD&A explicitly discloses this alongside in-place rent.
    // The gap between new-lease and in-place rent = ECRI lift opportunity:
    // existing customers pay above-market because of cumulative annual rate
    // increases, while new tenants get the current move-in rate. The
    // spread is the rent-raising headroom for a stabilized acquisition.
    newLeaseRentPerSF: null,
    newLeaseRentPerSF_PriorYear: null,
    // SMA-disclosed: avg discount as % of rental revenue.
    // Industry-wide promotional discount level — directly disclosed by EXR.
    discountPctOfRevenue: null,
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

  // ── Tabular format (EXR — 3-column: current / prior / pct) ──
  //   "Total same-store rental revenues 2,648,814 2,645,534 0.1%"
  //   "Same-store net operating income $1,884,797 $1,917,206 (1.7)%"
  // ── Tabular format (CUBE — 4-column: current / prior / $change / pct) ──
  //   "Total revenues 938,048 942,457 (4,409) (0.5) %"
  // Both variants captured below.
  if (metrics.sameStoreRevenueGrowthYoY == null) {
    // EXR-style (3-col): label + 2 amounts + pct
    const exrRevRe = /Total\s+same[ -]store\s+(?:rental\s+)?revenues?\s+\$?\s*([\d,]+)\s+\$?\s*([\d,]+)\s+(\(?-?[\d.]+\)?)\s*%/i;
    const tm = exrRevRe.exec(text);
    if (tm) {
      let pctStr = tm[3].replace(/[()]/g, "");
      const isNeg = /\(/.test(tm[3]);
      let pct = parseFloat(pctStr) / 100;
      if (isNeg && pct > 0) pct = -pct;
      metrics.sameStoreRevenueGrowthYoY = pct;
      metrics.revenueGrowthBasis = `tabular (3-col) — same-store revenue table (current period $${tm[1]}K vs prior period $${tm[2]}K)`;
      const start = Math.max(0, tm.index - 80);
      const end = Math.min(text.length, tm.index + 250);
      metrics.sourceExcerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
    } else {
      // CUBE-style (4-col): "Same-Store ... Total revenues C P (D) (P)%"
      // Anchor on a "Same-Store" header followed by "Total revenues" with 4 numeric columns
      const cubeRevRe = /(?:Same.Store(?:\s+Property\s+Portfolio)?[\s\S]{0,800})Total\s+revenues\s+([\d,]+)\s+([\d,]+)\s+\(?(-?[\d,]+)\)?\s+\(?(-?[\d.]+)\)?\s*%/i;
      const cm = cubeRevRe.exec(text);
      if (cm) {
        let pctStr = cm[4];
        // For CUBE we look at the 4th capture (pct change). Negatives wrapped in parens
        // Detect negative by seeing if the original pct was wrapped in parens
        const fullMatch = cm[0];
        const pctIdx = fullMatch.lastIndexOf(pctStr);
        const wasWrapped = pctIdx > 0 && fullMatch[pctIdx - 1] === "(";
        let pct = parseFloat(pctStr.replace(/-/g, "")) / 100;
        if (wasWrapped) pct = -pct;
        metrics.sameStoreRevenueGrowthYoY = pct;
        metrics.revenueGrowthBasis = `tabular (4-col) — Same-Store Property Portfolio total revenues table (current $${cm[1]}K vs prior $${cm[2]}K, change $${cm[3]}K)`;
        const start = Math.max(0, cm.index - 80);
        const end = Math.min(text.length, cm.index + 350);
        metrics.sourceExcerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
      }
    }
  }

  // ── Tabular NOI ──
  if (metrics.sameStoreNOIGrowthYoY == null) {
    // EXR (3-col)
    const exrNOIRe = /Same[ -]store\s+(?:net operating income|NOI)\s+\$?\s*([\d,]+)\s+\$?\s*([\d,]+)\s+(\(?-?[\d.]+\)?)\s*%/i;
    const tn = exrNOIRe.exec(text);
    if (tn) {
      let pctStr = tn[3].replace(/[()]/g, "");
      const isNeg = /\(/.test(tn[3]);
      let pct = parseFloat(pctStr) / 100;
      if (isNeg && pct > 0) pct = -pct;
      metrics.sameStoreNOIGrowthYoY = pct;
      metrics.noiGrowthBasis = `tabular (3-col) — same-store NOI table (current $${tn[1]}K vs prior $${tn[2]}K)`;
    } else {
      // CUBE (4-col): "NET OPERATING INCOME: ... C P ($change) (Pct)%"
      const cubeNOIRe = /NET\s+OPERATING\s+INCOME:?\s+([\d,]+)\s+([\d,]+)\s+\(?(-?[\d,]+)\)?\s+\(?(-?[\d.]+)\)?\s*%/i;
      const cn = cubeNOIRe.exec(text);
      if (cn) {
        let pctStr = cn[4];
        const fullMatch = cn[0];
        const pctIdx = fullMatch.lastIndexOf(pctStr);
        const wasWrapped = pctIdx > 0 && fullMatch[pctIdx - 1] === "(";
        let pct = parseFloat(pctStr.replace(/-/g, "")) / 100;
        if (wasWrapped) pct = -pct;
        metrics.sameStoreNOIGrowthYoY = pct;
        metrics.noiGrowthBasis = `tabular (4-col) — Same-Store Property Portfolio NOI line (current $${cn[1]}K vs prior $${cn[2]}K)`;
      }
    }
  }

  // ── Tabular occupancy (EOP) ──
  if (metrics.sameStoreOccupancyEOP == null) {
    const occRe = /Same[ -]store\s+square\s+foot\s+occupancy[^.]+?(\d{2}\.\d)\s*%/i;
    const oc = occRe.exec(text);
    if (oc) {
      metrics.sameStoreOccupancyEOP = parseFloat(oc[1]) / 100;
    } else {
      // CUBE format: "Period end occupancy 88.6% 89.3% ... " (after Same-Store anchor)
      const cubeOccRe = /(?:Same.Store[\s\S]{0,1500})Period\s+end\s+occupancy\s+(\d{2}\.\d)\s*%/i;
      const co = cubeOccRe.exec(text);
      if (co) metrics.sameStoreOccupancyEOP = parseFloat(co[1]) / 100;
    }
  }

  // ── Average rent per occupied SF (tabular form) ──
  if (metrics.sameStoreRentPerSF == null) {
    const rentTabRe = /Average\s+annual\s+rent\s+per\s+occupied\s+square\s+foot[^$]*?\$\s*(\d+\.\d{2})/i;
    const rt = rentTabRe.exec(text);
    if (rt) {
      metrics.sameStoreRentPerSF = parseFloat(rt[1]);
    } else {
      // CUBE format: "Realized annual rent per occupied sq. ft. (1) $ 22.73 $ 22.71"
      const cubeRentRe = /Realized\s+annual\s+rent\s+per\s+occupied\s+sq\.?\s*ft\.?[^$]*?\$\s*(\d+\.\d{2})/i;
      const cr = cubeRentRe.exec(text);
      if (cr) metrics.sameStoreRentPerSF = parseFloat(cr[1]);
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
  // Three patterns to handle the variety of disclosure formats:
  //
  //   (1) Narrative form (legacy):
  //       "average annualized realized rent per occupied square foot of $XX.XX"
  //
  //   (2) PSA tabular form (FY2025 10-K — the actual form PSA uses):
  //       "Realized annual rental income per (c): Occupied square foot $ 22.54 $ 22.43 0.5%"
  //       The disclosure is the FIRST dollar amount after the "Occupied square
  //       foot" sub-row label, which is the current-period value.
  //
  //   (3) SMA tabular form (FY2025 10-K):
  //       "Annualized rent per occupied square foot (5) $ 20.03 $ 19.98 0.3%"
  //       Same pattern but with a footnote marker before the dollar values.
  //
  //   (4) PSA "Annual contract rent" form (a parallel disclosure):
  //       "Annual contract rent per occupied square foot (d) $ 22.55 $ 22.72 (0.7)%"
  //
  // Critical: Pattern (2)/(3)/(4) MUST come BEFORE the narrative pattern (1)
  // because the tabular form is the authoritative disclosure when present.
  // The narrative pattern was previously matching qualitative descriptions
  // that lacked the dollar amount.
  const rentPatterns = [
    // PSA tabular: "Occupied square foot $ XX.XX $ XX.XX <pct>"
    /Occupied\s+square\s+foot\s+\$\s*(\d+\.\d{2})\s+\$\s*(\d+\.\d{2})/i,
    // SMA tabular: "Annualized rent per occupied square foot (N) $ XX.XX $ XX.XX"
    /[Aa]nnualized\s+rent\s+per\s+occupied\s+square\s+foot\s*(?:\(\d+\))?\s*\$\s*(\d+\.\d{2})\s+\$\s*(\d+\.\d{2})/,
    // PSA "Annual contract" form
    /Annual\s+contract\s+rent\s+per\s+occupied\s+square\s+foot\s*(?:\([a-z]\))?\s*\$\s*(\d+\.\d{2})\s+\$\s*(\d+\.\d{2})/i,
    // Narrative form (legacy)
    /(?:average\s+)?(?:annualized\s+)?(?:realized\s+)?rent\s+per\s+occupied\s+square\s+foot\s+(?:of\s+)?\$(\d+\.\d{2})/i,
    /rent\s+per\s+occupied\s+square\s+foot\s+(?:was\s+)?\$(\d+\.\d{2})/i,
  ];
  for (const re of rentPatterns) {
    const m = re.exec(text);
    if (m) {
      // Pattern (2)/(3)/(4) capture both current + prior period; current is
      // the first ($XX.XX). Pattern (1)/(5) capture only one value.
      metrics.sameStoreRentPerSF = parseFloat(m[1]);
      if (m[2]) metrics.sameStoreRentPerSF_PriorYear = parseFloat(m[2]);
      break;
    }
  }

  // ── New-lease rent per SF (EXR MD&A) ──
  // EXR uniquely discloses: "New leases average annual rent per square
  // foot $ 13.16 $ 12.60". The gap between this (move-in rate) and the
  // same-store rent ($19.91) is the ECRI lift opportunity.
  const newLeasePatterns = [
    /[Nn]ew\s+leases?\s+(?:average\s+)?annual\s+rent\s+per\s+square\s+foot\s*\$\s*(\d+\.\d{2})\s+\$\s*(\d+\.\d{2})/,
    /[Nn]ew\s+leases?\s+(?:average\s+)?annual\s+rent\s+per\s+square\s+foot\s*\$\s*(\d+\.\d{2})/,
  ];
  for (const re of newLeasePatterns) {
    const m = re.exec(text);
    if (m) {
      metrics.newLeaseRentPerSF = parseFloat(m[1]);
      if (m[2]) metrics.newLeaseRentPerSF_PriorYear = parseFloat(m[2]);
      break;
    }
  }

  // ── Promotional discount as % of revenue (EXR + others) ──
  // EXR discloses: "Average discounts as a percentage of rental revenues 2.1%"
  // This is the level of promotional discounting in the same-store pool —
  // an institutional lever for new-lease pricing.
  const discountPatterns = [
    /(?:Average\s+)?[Dd]iscounts?\s+as\s+a\s+percentage\s+of\s+rental\s+revenues?\s+(\d+\.?\d*)\s*%/,
  ];
  for (const re of discountPatterns) {
    const m = re.exec(text);
    if (m) {
      metrics.discountPctOfRevenue = parseFloat(m[1]) / 100;
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

  const tickers = ["PSA", "EXR", "CUBE", "SMA"];
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
