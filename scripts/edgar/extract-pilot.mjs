// extract-pilot.mjs — Day-1 pilot: pull PSA's latest 10-K from SEC EDGAR
// and see what acquisitions data is in there. Just inspection — no Claude
// extraction yet. Goal: understand the document structure so we can build
// a robust extractor in step 2.
//
// Usage: node scripts/edgar/extract-pilot.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORAGE_REITS } from "./cik-registry.mjs";
import { fetchLatestFiling, fetchFilingDocument, buildFilingURL } from "./fetch-filing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "_output");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function pilot() {
  const psa = STORAGE_REITS.PSA;
  console.log(`▸ Fetching ${psa.name} (CIK ${psa.cik}) submissions index...`);

  // 1. Find the latest 10-K filing
  const latest10K = await fetchLatestFiling(psa.cik, "10-K");
  if (!latest10K) {
    console.error("✗ No 10-K filings found");
    process.exit(1);
  }
  console.log(`▸ Latest 10-K: ${latest10K.filingDate} (report period ${latest10K.reportDate})`);
  console.log(`  Accession: ${latest10K.accessionNumber}`);
  console.log(`  Document: ${latest10K.primaryDocument}`);
  console.log(`  URL: ${buildFilingURL(psa.cik, latest10K.accessionNumber, latest10K.primaryDocument)}`);

  // 2. Fetch the filing HTML
  console.log(`▸ Fetching filing document (this may take 5-10s for a large 10-K)...`);
  const html = await fetchFilingDocument(psa.cik, latest10K.accessionNumber, latest10K.primaryDocument);
  console.log(`▸ Filing fetched: ${(html.length / 1024 / 1024).toFixed(2)} MB`);

  // Save raw filing for offline inspection
  const rawPath = path.join(OUT_DIR, `PSA-${latest10K.reportDate}-${latest10K.accessionNumber}.html`);
  fs.writeFileSync(rawPath, html, "utf8");
  console.log(`▸ Raw filing saved: ${rawPath}`);

  // 3. Strip HTML to text for easier inspection
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "—")
    .replace(/\s+/g, " ");
  console.log(`▸ Stripped text: ${(text.length / 1024).toFixed(0)} KB`);

  // 4. Find acquisitions-relevant sections
  const keywords = [
    "Real Estate Activity",
    "Acquisitions",
    "Acquired",
    "properties acquired",
    "Real Estate Acquisitions",
    "Investment Activity",
    "Acquisition Activity",
  ];
  console.log(`\n▸ Keyword scan:`);
  const hits = [];
  for (const kw of keywords) {
    const re = new RegExp(`\\b${kw}\\b`, "gi");
    let m;
    let count = 0;
    while ((m = re.exec(text)) !== null) {
      count++;
      hits.push({ keyword: kw, index: m.index });
    }
    console.log(`  "${kw}": ${count} occurrences`);
  }

  // 5. Extract the most promising section: 1500 chars around the first
  //    mention of "properties acquired" or similar.
  const anchor = hits.find((h) => /properties acquired|acquisition activity|real estate activity/i.test(h.keyword)) || hits[0];
  if (anchor) {
    const start = Math.max(0, anchor.index - 200);
    const end = Math.min(text.length, anchor.index + 4000);
    const excerpt = text.slice(start, end);
    const excerptPath = path.join(OUT_DIR, `PSA-${latest10K.reportDate}-acquisitions-excerpt.txt`);
    fs.writeFileSync(excerptPath, excerpt, "utf8");
    console.log(`\n▸ Acquisitions excerpt (4.2KB) saved: ${excerptPath}`);
    console.log(`\n--- EXCERPT (first 800 chars around anchor "${anchor.keyword}") ---\n`);
    console.log(text.slice(start, Math.min(text.length, anchor.index + 800)));
    console.log(`\n--- END EXCERPT ---`);
  }

  // 6. Save the metadata for the next step (Claude extraction)
  const meta = {
    issuer: psa.ticker,
    cik: psa.cik,
    form: latest10K.form,
    filingDate: latest10K.filingDate,
    reportDate: latest10K.reportDate,
    accessionNumber: latest10K.accessionNumber,
    primaryDocument: latest10K.primaryDocument,
    filingURL: buildFilingURL(psa.cik, latest10K.accessionNumber, latest10K.primaryDocument),
    rawSizeKB: (html.length / 1024).toFixed(0),
    textSizeKB: (text.length / 1024).toFixed(0),
    keywordHits: keywords.reduce((acc, kw) => {
      acc[kw] = (text.match(new RegExp(`\\b${kw}\\b`, "gi")) || []).length;
      return acc;
    }, {}),
  };
  const metaPath = path.join(OUT_DIR, `PSA-${latest10K.reportDate}-meta.json`);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  console.log(`\n▸ Metadata saved: ${metaPath}`);

  console.log(`\n✓ Pilot complete. Inspect the excerpt + raw HTML to design the extractor.`);
}

pilot().catch((e) => {
  console.error("✗ Pilot failed:", e.message);
  process.exit(1);
});
