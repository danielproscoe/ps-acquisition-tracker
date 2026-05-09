// extract-8k-transactions.mjs — Day 5: extract structured transaction data
// from the 14 acquisition-related 8-K filings identified by
// list-acquisition-8ks.mjs.
//
// Per-filing pattern targets:
//   - acquisition_date   (close date or signing date)
//   - buyer              (the filer)
//   - seller             (when named)
//   - num_facilities     (when disclosed)
//   - aggregate_price    ($ amount)
//   - target_entity      (named portfolio/company being acquired)
//   - facility_type      (self-storage / mixed / etc.)
//
// Output: src/data/edgar-8k-transactions.json — per-deal records with
// SEC EDGAR accession # citations.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFilingDocument } from "./fetch-filing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "_output");
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

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

// ── Pattern bank — multiple variants per field, keep first match ──
const PRICE_PATTERNS = [
  // "aggregate purchase price of $XX million / billion"
  /aggregate\s+(?:purchase\s+)?(?:consideration|price)\s+(?:of\s+)?(?:approximately\s+)?\$\s*([\d,.]+)\s*(million|billion)/i,
  // "total purchase price of $XX million"
  /total\s+(?:purchase\s+)?(?:consideration|price)\s+(?:of\s+)?(?:approximately\s+)?\$\s*([\d,.]+)\s*(million|billion)/i,
  // "for $X.X billion in cash"
  /for\s+(?:approximately\s+)?\$\s*([\d,.]+)\s*(million|billion)\s+in\s+cash/i,
  // "consideration of approximately $XX"
  /paid\s+(?:aggregate\s+)?(?:consideration\s+)?(?:of\s+)?(?:approximately\s+)?\$\s*([\d,.]+)\s*(million|billion)/i,
  // "purchase price equal to / consisting of $X"
  /purchase\s+price\s+(?:equal to|consisting of|of)\s+(?:approximately\s+)?\$\s*([\d,.]+)\s*(million|billion)/i,
  // BREIT-style: "for a purchase price of $X.X billion"
  /for\s+a\s+(?:purchase\s+|aggregate\s+)?price\s+of\s+(?:approximately\s+)?\$\s*([\d,.]+)\s*(million|billion)/i,
  // Stock-based: "in a transaction valued at approximately $X billion"
  /(?:transaction|merger)\s+valued?\s+at\s+(?:approximately\s+)?\$\s*([\d,.]+)\s*(million|billion)/i,
  // "with an enterprise value of $X"
  /(?:enterprise|equity|deal)\s+value\s+of\s+(?:approximately\s+)?\$\s*([\d,.]+)\s*(million|billion)/i,
];

const FACILITY_COUNT_PATTERNS = [
  /(?:acquired|acquiring|acquire)\s+(?:approximately\s+)?(\d{1,4})\s+self.storage\s+(?:facilit\w+|properties|stores)/i,
  /portfolio\s+of\s+(\d{1,4})\s+self.storage\s+(?:facilit\w+|properties|stores)/i,
  /(\d{1,4})\s+self.storage\s+(?:facilit\w+|properties|stores)\s+\((?:[\d,.]+)\s+million\s+(?:net rentable\s+)?square\s+feet/i,
];

const NRSF_PATTERNS = [
  /\((?:approximately\s+)?([\d,.]+)\s+million\s+(?:net rentable\s+)?square\s+feet\)/i,
  /([\d,.]+)\s+million\s+(?:net rentable\s+)?square\s+feet/i,
];

const TARGET_ENTITY_PATTERNS = [
  // Named entity acquisitions: "We acquired XYZ, LLC" or "merger with ABC Storage"
  /(?:acquired|acquire|merger\s+(?:with|of))\s+([A-Z][A-Za-z&'.,\- ]{2,60}?)\s+(?:\(|,|"|for|in\s+a\s+(?:cash|stock|merger))/,
  // "our acquisition of <Entity>"
  /(?:our|the)\s+acquisition\s+of\s+([A-Z][A-Za-z&'.,\- ]{2,60}?)\s+(?:\(|,|for|by|on)/,
];

const SELLER_PATTERNS = [
  /from\s+([A-Z][A-Za-z&'.,\- ]{2,80}?)\s+(?:\(|,|"|for|on|in\s+exchange)/,
  /sold\s+by\s+([A-Z][A-Za-z&'.,\- ]{2,80}?)\s+(?:\(|,|on|to)/,
];

const DATE_PATTERNS = [
  /On\s+([A-Z][a-z]+\s+\d{1,2},\s+20\d{2})/,
  /(?:closed|completed|consummated)(?:\s+on)?\s+([A-Z][a-z]+\s+\d{1,2},\s+20\d{2})/i,
];

function extractFirst(patterns, text) {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return { match: m, source: p };
  }
  return null;
}

function parsePriceMillion(value, unit) {
  const v = parseFloat(String(value).replace(/,/g, ""));
  if (isNaN(v)) return null;
  return /billion/i.test(unit) ? v * 1000 : v;
}

function parseNumber(s) {
  const v = parseFloat(String(s).replace(/,/g, ""));
  return isNaN(v) ? null : v;
}

function cleanEntityName(s) {
  if (!s) return null;
  return s.replace(/\s+/g, " ").trim().replace(/[",.]+$/, "");
}

async function extractFromCandidate(candidate) {
  const html = await fetchFilingDocument(candidate.cik, candidate.accessionNumber, candidate.primaryDocument);
  const text = htmlToText(html);

  const out = {
    issuer: candidate.issuer,
    cik: candidate.cik,
    issuerName: candidate.issuer === "PSA" ? "Public Storage" : candidate.issuer === "EXR" ? "Extra Space Storage Inc" : candidate.issuer === "CUBE" ? "CubeSmart" : candidate.issuer,
    filingDate: candidate.filingDate,
    accessionNumber: candidate.accessionNumber,
    filingURL: candidate.filingURL,
    itemCodes: candidate.itemCodes,
    extractedAt: new Date().toISOString(),
  };

  // Price
  const priceHit = extractFirst(PRICE_PATTERNS, text);
  if (priceHit) {
    out.aggregatePriceMillion = parsePriceMillion(priceHit.match[1], priceHit.match[2]);
    out.priceSourceText = text.slice(Math.max(0, priceHit.match.index - 60), Math.min(text.length, priceHit.match.index + 200)).trim();
  }

  // # facilities
  const facHit = extractFirst(FACILITY_COUNT_PATTERNS, text);
  if (facHit) {
    out.numFacilities = parseInt(facHit.match[1], 10);
  }

  // NRSF — only count when it appears within 200 chars of the facility-count match.
  // Otherwise it's likely the issuer's full portfolio NRSF mentioned elsewhere
  // in the filing (which is misleading when attributed to this transaction).
  if (facHit) {
    const facIdx = facHit.match.index;
    const window = text.slice(facIdx, Math.min(text.length, facIdx + 400));
    const nrsfInWindow = extractFirst(NRSF_PATTERNS, window);
    if (nrsfInWindow) {
      const nrsfVal = parseNumber(nrsfInWindow.match[1]);
      // Sanity floor: reject if implies > 500K SF/facility (real institutional max ~120K SF/facility)
      if (nrsfVal != null && out.numFacilities && (nrsfVal * 1_000_000 / out.numFacilities) < 500_000) {
        out.nrsfMillion = nrsfVal;
      }
    }
  }

  // Target entity
  const targetHit = extractFirst(TARGET_ENTITY_PATTERNS, text);
  if (targetHit) {
    out.targetEntity = cleanEntityName(targetHit.match[1]);
  }

  // Seller (when named separately from target)
  const sellerHit = extractFirst(SELLER_PATTERNS, text);
  if (sellerHit) {
    out.seller = cleanEntityName(sellerHit.match[1]);
  }

  // Acquisition date
  const dateHit = extractFirst(DATE_PATTERNS, text);
  if (dateHit) {
    out.acquisitionDate = dateHit.match[1];
  }

  // Derived metric: $/facility
  if (out.aggregatePriceMillion && out.numFacilities) {
    out.dollarsPerFacilityM = Math.round((out.aggregatePriceMillion / out.numFacilities) * 100) / 100;
  }

  // Derived metric: $/SF
  if (out.aggregatePriceMillion && out.nrsfMillion) {
    out.impliedPSF = Math.round((out.aggregatePriceMillion * 1_000_000) / (out.nrsfMillion * 1_000_000));
  }

  return out;
}

async function run() {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  Day 5 — 8-K Transaction Extractor");
  console.log("════════════════════════════════════════════════════════════════════\n");

  const candPath = path.join(OUT_DIR, "8k-acquisition-candidates.json");
  if (!fs.existsSync(candPath)) {
    console.error("✗ candidate list not found — run list-acquisition-8ks.mjs first");
    process.exit(1);
  }
  const candList = JSON.parse(fs.readFileSync(candPath, "utf8"));
  const candidates = candList.candidates || [];
  console.log(`Loaded ${candidates.length} candidates from ${candList.generatedAt}\n`);

  const transactions = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    process.stdout.write(`[${i + 1}/${candidates.length}] ${c.issuer} ${c.filingDate} ${c.accessionNumber} ... `);
    try {
      const tx = await extractFromCandidate(c);
      transactions.push(tx);
      const summary = [
        tx.aggregatePriceMillion ? `$${tx.aggregatePriceMillion.toFixed(0)}M` : "$?",
        tx.numFacilities ? `${tx.numFacilities} fac` : "? fac",
        tx.nrsfMillion ? `${tx.nrsfMillion}M SF` : "?",
        tx.targetEntity || "no target",
      ].join(" · ");
      console.log("✓ " + summary);
    } catch (e) {
      console.log("✗ " + e.message);
    }
  }

  // Sort by filing date desc + group by issuer
  transactions.sort((a, b) => b.filingDate.localeCompare(a.filingDate));

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("  Extracted Transactions Summary");
  console.log("════════════════════════════════════════════════════════════════════\n");

  for (const tx of transactions) {
    console.log(`▸ ${tx.issuer} · ${tx.filingDate} · ${tx.accessionNumber}`);
    if (tx.targetEntity) console.log(`  Target: ${tx.targetEntity}`);
    if (tx.aggregatePriceMillion) console.log(`  Price: $${tx.aggregatePriceMillion.toFixed(0)}M${tx.aggregatePriceMillion >= 1000 ? ` ($${(tx.aggregatePriceMillion / 1000).toFixed(2)}B)` : ""}`);
    if (tx.numFacilities) console.log(`  Facilities: ${tx.numFacilities}`);
    if (tx.nrsfMillion) console.log(`  NRSF: ${tx.nrsfMillion}M SF`);
    if (tx.dollarsPerFacilityM) console.log(`  Per Facility: $${tx.dollarsPerFacilityM}M`);
    if (tx.impliedPSF) console.log(`  Implied $/SF: $${tx.impliedPSF}`);
    if (tx.seller) console.log(`  Seller: ${tx.seller}`);
    console.log();
  }

  const out = {
    schema: "storvex.edgar-8k-transactions.v1",
    generatedAt: new Date().toISOString(),
    totalTransactions: transactions.length,
    transactionsWithPrice: transactions.filter((t) => t.aggregatePriceMillion).length,
    aggregatePriceTotalM: transactions.reduce((s, t) => s + (t.aggregatePriceMillion || 0), 0),
    transactions,
  };

  const outPath = path.join(DATA_DIR, "edgar-8k-transactions.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`✓ Saved: src/data/edgar-8k-transactions.json`);
  console.log(`  ${out.transactionsWithPrice} of ${out.totalTransactions} transactions had extractable price`);
  console.log(`  Aggregate disclosed deal volume: $${(out.aggregatePriceTotalM / 1000).toFixed(2)}B`);
}

run().catch((e) => {
  console.error("✗ Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
