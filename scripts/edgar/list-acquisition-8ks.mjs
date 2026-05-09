// list-acquisition-8ks.mjs — Day 5 pilot: list all 8-K filings for the
// storage REITs and identify which contain acquisition-related material
// events. SEC item 2.01 ("Completion of Acquisition or Disposition of
// Assets") is the standard code, but issuers also disclose acquisitions
// under 7.01 (Regulation FD) or 8.01 (Other Events).
//
// Output: scripts/edgar/_output/8k-acquisition-candidates.json — list of
// candidate filings to extract transactions from in the next pass.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORAGE_REITS } from "./cik-registry.mjs";
import { fetchSubmissionsIndex, listFilings, fetchFilingDocument, buildFilingURL } from "./fetch-filing.mjs";

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
    .replace(/&#8203;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, "—")
    .replace(/&#8212;/g, "—")
    .replace(/\s+/g, " ");
}

const ACQUISITION_KEYWORDS = [
  /acquired\s+(?:approximately\s+)?\d/i,         // "acquired 127 self-storage"
  /completion\s+of\s+acquisition/i,
  /aggregate\s+purchase\s+price/i,
  /total\s+purchase\s+price\s+of\s+\$/i,
  /entered\s+into\s+a\s+(?:definitive\s+)?(?:purchase\s+)?agreement/i,
  /portfolio\s+of\s+\d+\s+self.storage/i,
  /merger\s+agreement/i,
];

async function inspectFiling(cik, filing) {
  try {
    const html = await fetchFilingDocument(cik, filing.accessionNumber, filing.primaryDocument);
    const text = htmlToText(html);
    const lowerText = text.toLowerCase();

    // Check for acquisition keywords
    const matchedKeywords = [];
    let firstMatchExcerpt = null;
    for (const kw of ACQUISITION_KEYWORDS) {
      const m = kw.exec(text);
      if (m) {
        matchedKeywords.push(kw.source);
        if (!firstMatchExcerpt) {
          const start = Math.max(0, m.index - 80);
          const end = Math.min(text.length, m.index + 400);
          firstMatchExcerpt = text.slice(start, end);
        }
      }
    }

    // Check SEC item codes — Item 2.01 = Completion of Acquisition or Disposition
    const itemMatches = [...text.matchAll(/Item\s+(\d+\.\d+)/gi)].map((m) => m[1]);
    const uniqueItems = [...new Set(itemMatches)];

    return {
      keywordHits: matchedKeywords.length,
      matchedKeywords,
      itemCodes: uniqueItems,
      isAcquisitionRelated: matchedKeywords.length > 0 || uniqueItems.includes("2.01"),
      excerpt: firstMatchExcerpt,
      docSize: text.length,
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function listForIssuer(ticker, yearsBack = 5) {
  const issuer = STORAGE_REITS[ticker];
  if (!issuer) throw new Error(`Unknown ticker: ${ticker}`);
  console.log(`\n▶ ${issuer.name} (${ticker})`);

  const submissions = await fetchSubmissionsIndex(issuer.cik);
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - yearsBack);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  const all8Ks = listFilings(submissions, (f) => f.form === "8-K" && f.filingDate >= cutoff);
  console.log(`  ${all8Ks.length} 8-K filings since ${cutoff}`);

  // Inspect each (rate-limited politely by the fetch layer)
  const candidates = [];
  for (let i = 0; i < all8Ks.length; i++) {
    const filing = all8Ks[i];
    process.stdout.write(`  [${i + 1}/${all8Ks.length}] ${filing.filingDate} ${filing.accessionNumber} ... `);
    const insight = await inspectFiling(issuer.cik, filing);
    if (insight.error) {
      console.log(`✗ error: ${insight.error}`);
      continue;
    }
    if (insight.isAcquisitionRelated) {
      console.log(`✓ acquisition-related (kw:${insight.keywordHits}, items:${insight.itemCodes.join(",")})`);
      candidates.push({
        issuer: ticker,
        cik: issuer.cik,
        ...filing,
        ...insight,
        filingURL: buildFilingURL(issuer.cik, filing.accessionNumber, filing.primaryDocument),
      });
    } else {
      console.log(`— skip (no acq markers, items:${insight.itemCodes.join(",")})`);
    }
  }
  console.log(`  ${candidates.length} candidates identified\n`);
  return candidates;
}

async function run() {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  Day 5 — 8-K Acquisition Filing Inspector");
  console.log("════════════════════════════════════════════════════════════════════");

  const tickers = ["PSA", "EXR", "CUBE"];
  const yearsBack = 5;
  const allCandidates = [];

  for (const t of tickers) {
    try {
      const cands = await listForIssuer(t, yearsBack);
      allCandidates.push(...cands);
    } catch (e) {
      console.error(`  ✗ ${t} failed: ${e.message}`);
    }
  }

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log(`  Total acquisition-related 8-K candidates: ${allCandidates.length}`);
  console.log("════════════════════════════════════════════════════════════════════");

  // Group by issuer
  const byIssuer = {};
  for (const c of allCandidates) {
    if (!byIssuer[c.issuer]) byIssuer[c.issuer] = 0;
    byIssuer[c.issuer]++;
  }
  for (const [iss, count] of Object.entries(byIssuer)) {
    console.log(`  ${iss}: ${count} acquisition 8-Ks`);
  }

  // Most recent per issuer (sample for inspection)
  console.log("\nMost-recent acquisition 8-K per issuer (sample for extractor design):");
  for (const t of tickers) {
    const isCands = allCandidates.filter((c) => c.issuer === t);
    if (isCands.length > 0) {
      const latest = isCands[0]; // already sorted newest-first
      console.log(`\n  ${t} · ${latest.filingDate} · ${latest.accessionNumber}`);
      console.log(`    URL: ${latest.filingURL}`);
      console.log(`    Keywords matched: ${latest.matchedKeywords.length}`);
      console.log(`    Items: ${latest.itemCodes.join(", ")}`);
      if (latest.excerpt) {
        console.log(`    Excerpt: "${latest.excerpt.slice(0, 350)}..."`);
      }
    }
  }

  const outPath = path.join(OUT_DIR, "8k-acquisition-candidates.json");
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    yearsBack,
    candidates: allCandidates,
  }, null, 2), "utf8");
  console.log(`\n✓ Saved candidate list: ${path.relative(path.join(__dirname, "..", ".."), outPath)}`);
}

run().catch((e) => {
  console.error("✗ Failed:", e.message);
  process.exit(1);
});
