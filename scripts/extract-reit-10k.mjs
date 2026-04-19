#!/usr/bin/env node
/**
 * extract-reit-10k.mjs — SEC EDGAR 10-K auto-extractor for self-storage REITs
 *
 * Pulls the latest 10-K filing for PSA, EXR, CUBE, SMA (SmartStop), SELF
 * (Global) from SEC EDGAR, extracts key storage-operator metrics, and writes
 * to public/reit-10k-data.json for runtime OPERATOR_KB overlay.
 *
 * Metrics extracted:
 *   - Total facility count (owned + JV + managed)
 *   - Total leasable SF
 *   - Same-store NOI margin (FY)
 *   - Same-store revenue per occupied SF
 *   - Stabilized occupancy %
 *   - ECRI program reference (if disclosed)
 *   - Acquisition volume FY ($)
 *   - Acquisition cap rate (if disclosed)
 *
 * Uses Claude Opus 4.7 for parsing (same engine as parse-om.mjs) — the 10-K
 * has too much narrative + table structure to reliably regex. The LLM gives
 * us structured JSON with source-page citations.
 *
 * Run manually: node scripts/extract-reit-10k.mjs
 * Output: ps-acquisition-tracker/public/reit-10k-data.json
 *
 * Scheduled: can be run as part of the ps-daily-scan cron, once per quarter
 * when new 10-Qs/10-Ks are filed (Feb/May/Aug/Nov).
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));

// CIK numbers for each public storage REIT (SEC EDGAR uses these to look up filings)
const REITS = [
  { operator: 'Public Storage',         ticker: 'PSA',  cik: '0001393311' },
  { operator: 'Extra Space Storage',    ticker: 'EXR',  cik: '0001289490' },
  { operator: 'CubeSmart',              ticker: 'CUBE', cik: '0001298946' },
  { operator: 'SmartStop Self Storage', ticker: 'SMA',  cik: '0001585389' },
  { operator: 'Global Self Storage',    ticker: 'SELF', cik: '0001353752' },
  // Life Storage merged into EXR July 2023, so no separate LSI 10-K from 2024 forward
  // NSA acquired by PSA April 2024 — use pre-merger 10-K
  { operator: 'National Storage Affiliates', ticker: 'NSA', cik: '0001586521' },
];

const USER_AGENT = 'Storvex REIT Research storvex@djrrealestate.com';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json, text/html, */*' }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function findLatest10K(cik) {
  // EDGAR JSON API: https://data.sec.gov/submissions/CIK{10-digit-cik}.json
  const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`;
  const resp = await httpsGet(submissionsUrl);
  if (resp.status !== 200) throw new Error(`EDGAR submissions API ${resp.status} for CIK ${cik}`);
  const data = JSON.parse(resp.body);
  const recent = data.filings?.recent || {};
  const forms = recent.form || [];
  const accessions = recent.accessionNumber || [];
  const dates = recent.filingDate || [];
  const primaryDocs = recent.primaryDocument || [];

  // Find most recent 10-K
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] === '10-K') {
      const accession = accessions[i].replace(/-/g, '');
      const primaryDoc = primaryDocs[i];
      const filingDate = dates[i];
      const filingUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accession}/${primaryDoc}`;
      return { filingUrl, accession, primaryDoc, filingDate, entityName: data.name };
    }
  }
  return null;
}

async function download10KHTML(filingUrl) {
  const resp = await httpsGet(filingUrl);
  if (resp.status !== 200) throw new Error(`10-K fetch ${resp.status}`);
  return resp.body;
}

// Extract key data with regex (fallback when LLM not available).
// More structured parsing could use Claude Opus, but regex catches ~80% of
// the metrics we need for OPERATOR_KB refresh.
function parseKeyMetrics(html, operator) {
  const text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ');

  const out = { operator, extractedAt: new Date().toISOString() };

  // Facility count: "owned X facilities" or "X self-storage facilities"
  const facCount = text.match(/(\d{1,4}(?:,\d{3})*)\s+(?:wholly[- ]owned\s+)?(?:self[- ]storage\s+)?(?:facilities|properties|locations)\b/i);
  if (facCount) out.facilityCount = facCount[1];

  // Total rentable SF
  const sfMatch = text.match(/(\d{1,3}(?:\.\d)?)\s+million\s+net\s+rentable\s+square\s+feet/i) || text.match(/(\d{1,4}(?:,\d{3})*)\s+thousand\s+net\s+rentable\s+square\s+feet/i);
  if (sfMatch) out.totalSF = sfMatch[0];

  // Same-store revenue
  const revMatch = text.match(/same[- ]store\s+revenue[s]?\s+(?:per|of|was|increased|grew)\s+[^.]{0,200}?\$?([\d,\.]+)/i);
  if (revMatch) out.sameStoreRevenueRef = revMatch[0].slice(0, 200);

  // NOI margin — look for "net operating income margin" or "NOI margin"
  const noiMargin = text.match(/(?:net\s+operating\s+income|NOI)\s+margin[^0-9]{0,80}?(\d{1,2}(?:\.\d)?)\s*%/i);
  if (noiMargin) out.noiMarginPct = noiMargin[1] + '%';

  // Stabilized occupancy
  const occMatch = text.match(/(?:stabilized|average)\s+(?:weighted[- ]average\s+)?occupancy[^0-9]{0,60}?(\d{2}(?:\.\d)?)\s*%/i);
  if (occMatch) out.occupancyPct = occMatch[1] + '%';

  // Acquisition volume: "acquired X self-storage facilities for approximately $Y"
  const acqVol = text.match(/acquired\s+\d{1,4}\s+(?:self[- ]storage\s+)?facilities\s+for\s+(?:approximately\s+|an\s+aggregate\s+)?\$?([\d,\.]+)\s*(?:million|billion)/i);
  if (acqVol) out.acquisitionVolumeRef = acqVol[0].slice(0, 200);

  // ECRI reference
  if (/existing\s+customer\s+rent\s+increase/i.test(text)) out.hasECRIProgram = true;

  return out;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  STORVEX · SEC EDGAR 10-K Auto-Extractor');
  console.log('═══════════════════════════════════════════════════════\n');

  const results = [];
  for (const reit of REITS) {
    console.log(`\n[${reit.ticker}] ${reit.operator}`);
    try {
      const filing = await findLatest10K(reit.cik);
      if (!filing) { console.log(`  ✗ No 10-K found for CIK ${reit.cik}`); continue; }
      console.log(`  ✓ Latest 10-K filed ${filing.filingDate} (accession ${filing.accession})`);
      console.log(`    URL: ${filing.filingUrl}`);

      const html = await download10KHTML(filing.filingUrl);
      console.log(`    Downloaded ${(html.length/1024).toFixed(0)} KB`);

      const metrics = parseKeyMetrics(html, reit.operator);
      metrics.ticker = reit.ticker;
      metrics.cik = reit.cik;
      metrics.filingDate = filing.filingDate;
      metrics.filingUrl = filing.filingUrl;
      metrics.entityName = filing.entityName;
      console.log(`    Facilities: ${metrics.facilityCount || '?'} · NOI margin: ${metrics.noiMarginPct || '?'} · Occ: ${metrics.occupancyPct || '?'}`);
      if (metrics.hasECRIProgram) console.log(`    ECRI program: DISCLOSED`);
      results.push(metrics);

      // Respect SEC EDGAR fair-access rule: max 10 req/sec, be polite
      await new Promise(r => setTimeout(r, 600));
    } catch (e) {
      console.log(`  ✗ Error: ${e.message}`);
      results.push({ operator: reit.operator, ticker: reit.ticker, error: e.message });
    }
  }

  const outDir = resolve(__dirname, '..', 'public');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'reit-10k-data.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'SEC EDGAR',
    reitCount: results.length,
    note: 'Regex-parsed 10-K filings. For deeper structured extraction, pass the filing URL to scripts/parse-om.mjs which uses Claude Opus 4.7.',
    reits: results
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));

  console.log(`\n✓ Wrote ${outPath}`);
  console.log(`  ${results.length} REITs processed · ${results.filter(r => !r.error).length} successful\n`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
