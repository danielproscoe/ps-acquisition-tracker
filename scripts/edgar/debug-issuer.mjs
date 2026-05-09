// debug-issuer.mjs — fetches an issuer's latest 10-K and dumps the
// Schedule III section text for inspection. Used to diagnose why row
// extraction isn't matching for a new issuer.
//
// Usage: node scripts/edgar/debug-issuer.mjs EXR

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORAGE_REITS } from "./cik-registry.mjs";
import { fetchLatestFiling, fetchFilingDocument } from "./fetch-filing.mjs";

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
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "—")
    .replace(/&#8212;/g, "—")
    .replace(/\s+/g, " ");
}

const ticker = (process.argv[2] || "EXR").toUpperCase();
const issuer = STORAGE_REITS[ticker];
if (!issuer) { console.error("Unknown ticker"); process.exit(1); }

const filing = await fetchLatestFiling(issuer.cik, "10-K");
console.log(`▸ ${ticker} 10-K: ${filing.filingDate} · ${filing.accessionNumber}`);
console.log(`▸ Doc: ${filing.primaryDocument}`);

const html = await fetchFilingDocument(issuer.cik, filing.accessionNumber, filing.primaryDocument);
const text = htmlToText(html);
fs.writeFileSync(path.join(OUT_DIR, `${ticker}-${filing.reportDate}-text.txt`), text, "utf8");

// Find Schedule III with several patterns
const patterns = [
  /SCHEDULE III/i,
  /Real Estate and Accumulated Depreciation/i,
];
for (const p of patterns) {
  const m = p.exec(text);
  if (m) {
    console.log(`\n▸ "${p.source}" found at idx ${m.index}`);
    // Dump 2000 chars starting from match
    const start = Math.max(0, m.index - 50);
    const end = Math.min(text.length, m.index + 2500);
    console.log("\n--- EXCERPT (2.5KB) ---");
    console.log(text.slice(start, end));
    console.log("\n--- END ---");
    break;
  }
}
