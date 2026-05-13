#!/usr/bin/env node
/**
 * ps-dna-enrich-esri.mjs
 *
 * Phase 2 of the PS DNA portfolio-fit benchmark system.
 * Reads PS_Portfolio_Unified.json and enriches every location with ESRI
 * GeoEnrichment 3-mile ring demographics. Resumable: writes a checkpoint
 * file after every batch, so a re-run picks up where it stopped.
 *
 * 3-mi ring only (not 1/3/5) — restricts cost to ~$46 instead of ~$139.
 * 1-mi and 5-mi can be added later by re-running with --rings=1,5 once
 * the DNA proves valuable.
 *
 * Concurrency: 5 in-flight ESRI calls. Hard cost stop at $60 (safety).
 * Output:  #2 - PS/Reference Files/PS_Portfolio_Enriched.json (final)
 *          #2 - PS/Reference Files/PS_Portfolio_Enriched.checkpoint.json (resumable)
 */

import fs from 'node:fs';
import path from 'node:path';

const REF_DIR = 'C:/Users/danie/OneDrive/Desktop/MASTER FOLDER - CLAUDE/#2 - PS/Reference Files';
const IN_PATH = path.join(REF_DIR, 'PS_Portfolio_Unified.json');
const CKPT_PATH = path.join(REF_DIR, 'PS_Portfolio_Enriched.checkpoint.json');
const OUT_PATH = path.join(REF_DIR, 'PS_Portfolio_Enriched.json');

const ESRI_KEY = 'AAPTaUYfi1SoeDufhIkJrnG_F2Q..-zBe5ghTDGTsSCeiaQYPhJmQQ5IKF7MvHv4i5LFTenLFy3ONZYOuiB9mGIPbWYgB9mHIUzNWHXEKPNz9NuuD-7U9VcXUPn28LkIy74pFEfpAdlDaXwME5Tuczq90l0hVssyMRfjXBX5rwmyHaI_8i2Nmgz4mLywQHr7VK2U1GeDyszM2nuUgrqEwUHGZGbA77YK4B7x2GvUK6dTalg0icDTtedzgihJG_CzuLsV-Wbk84LBoXHqmQM-i-0Q4HBep3LRuX-XCAT1_ZmGdGMNw';
const ENRICH_URL = 'https://geoenrich.arcgis.com/arcgis/rest/services/World/geoenrichmentserver/Geoenrichment/Enrich';

const CONCURRENCY = 5;
const RING_MI = parseInt(process.env.RING_MI || '3', 10);
const COST_PER_CALL = 0.01;
const HARD_COST_LIMIT = 60.0;
const CHECKPOINT_EVERY = 50;

const DEMO_VARS = [
  'AtRisk.TOTPOP_CY','KeyUSFacts.TOTPOP_FY','KeyUSFacts.TOTHH_CY','KeyUSFacts.TOTHH_FY',
  'KeyUSFacts.MEDHINC_CY','KeyUSFacts.MEDHINC_FY','KeyUSFacts.AVGHINC_CY',
  'homevalue.MEDVAL_CY','OwnerRenter.OWNER_CY','OwnerRenter.RENTER_CY',
];

async function enrichOne(lat, lon, attempt = 1) {
  const sa = JSON.stringify([{
    geometry: { x: lon, y: lat },
    areaType: 'RingBuffer',
    bufferUnits: 'esriMiles',
    bufferRadii: [RING_MI],
  }]);
  const params = new URLSearchParams({
    studyAreas: sa,
    analysisVariables: JSON.stringify(DEMO_VARS),
    useData: JSON.stringify({ sourceCountry: 'US' }),
    f: 'json',
    token: ESRI_KEY,
  });
  try {
    const res = await fetch(ENRICH_URL + '?' + params.toString(), { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`ESRI: ${data.error.message || JSON.stringify(data.error)}`);
    const attrs = data?.results?.[0]?.value?.FeatureSet?.[0]?.features?.[0]?.attributes;
    if (!attrs) throw new Error('No attributes in response');
    return {
      pop_cy: attrs.TOTPOP_CY ?? null,
      pop_fy: attrs.TOTPOP_FY ?? null,
      hh_cy: attrs.TOTHH_CY ?? null,
      hh_fy: attrs.TOTHH_FY ?? null,
      medhinc_cy: attrs.MEDHINC_CY ?? null,
      medhinc_fy: attrs.MEDHINC_FY ?? null,
      avghinc_cy: attrs.AVGHINC_CY ?? null,
      medval_cy: attrs.MEDVAL_CY ?? null,
      owner_cy: attrs.OWNER_CY ?? null,
      renter_cy: attrs.RENTER_CY ?? null,
    };
  } catch (e) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 1500 * attempt));
      return enrichOne(lat, lon, attempt + 1);
    }
    return { __error: String(e) };
  }
}

function loadCheckpoint() {
  if (fs.existsSync(CKPT_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CKPT_PATH, 'utf8'));
    } catch { /* ignore */ }
  }
  return null;
}

function saveCheckpoint(records, idx, callsSpent, errors) {
  fs.writeFileSync(CKPT_PATH, JSON.stringify({
    savedAt: new Date().toISOString(),
    index: idx,
    callsSpent,
    errors,
    records,
  }, null, 0));
}

async function main() {
  console.log('=== PS DNA — Phase 2: ESRI Enrichment ===');
  console.log(`Ring: ${RING_MI}-mile  Concurrency: ${CONCURRENCY}  Hard limit: $${HARD_COST_LIMIT.toFixed(2)}`);

  const unified = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));
  let records = unified.records;
  const limit = parseInt(process.env.TEST_LIMIT || '0', 10);
  if (limit > 0) {
    records = records.slice(0, limit);
    console.log(`TEST MODE: limited to first ${limit} records`);
  }
  console.log(`Loaded ${records.length} locations from ${IN_PATH}\n`);

  const ckpt = loadCheckpoint();
  let startIdx = 0, callsSpent = 0, errors = 0;
  if (ckpt && ckpt.records?.length === records.length) {
    for (let i = 0; i < records.length; i++) {
      if (ckpt.records[i].demo3mi) records[i].demo3mi = ckpt.records[i].demo3mi;
    }
    startIdx = ckpt.index || 0;
    callsSpent = ckpt.callsSpent || 0;
    errors = ckpt.errors || 0;
    console.log(`Resumed from checkpoint at idx=${startIdx}, calls=${callsSpent}, errors=${errors}\n`);
  }

  const t0 = Date.now();
  let done = startIdx;
  const queue = [];
  for (let i = startIdx; i < records.length; i++) {
    if (records[i].demo3mi && !records[i].demo3mi.__error) { done++; continue; }
    queue.push(i);
  }
  console.log(`Calls remaining: ${queue.length}  (already enriched: ${done})\n`);

  let qIdx = 0;
  async function worker(workerId) {
    while (qIdx < queue.length) {
      const myIdx = qIdx++;
      const recIdx = queue[myIdx];
      const rec = records[recIdx];
      const projected = (callsSpent + 1) * COST_PER_CALL;
      if (projected > HARD_COST_LIMIT) {
        console.error(`HARD COST LIMIT $${HARD_COST_LIMIT} reached. Stopping.`);
        return;
      }
      const result = await enrichOne(rec.lat, rec.lon);
      callsSpent++;
      if (result.__error) {
        errors++;
        rec.demo3mi = { __error: result.__error };
      } else {
        rec.demo3mi = result;
      }
      done++;
      if (done % CHECKPOINT_EVERY === 0) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = (done - startIdx) / Math.max(elapsed, 1);
        const remaining = queue.length - (qIdx);
        const etaSec = remaining / Math.max(rate, 0.1);
        console.log(`  ${done}/${records.length}  spend=$${(callsSpent * COST_PER_CALL).toFixed(2)}  rate=${rate.toFixed(1)}/s  ETA=${(etaSec / 60).toFixed(1)}min  errors=${errors}`);
        saveCheckpoint(records, recIdx + 1, callsSpent, errors);
      }
    }
  }

  const workers = [];
  for (let w = 0; w < CONCURRENCY; w++) workers.push(worker(w));
  await Promise.all(workers);

  // Final write
  const out = {
    builtAt: new Date().toISOString(),
    ringMi: RING_MI,
    callsSpent,
    cost: callsSpent * COST_PER_CALL,
    errors,
    summary: unified.summary,
    records,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\nDONE.  Total: ${records.length}  Calls: ${callsSpent}  Cost: $${(callsSpent * COST_PER_CALL).toFixed(2)}  Errors: ${errors}`);
  console.log(`Wrote ${OUT_PATH}`);
  if (fs.existsSync(CKPT_PATH)) fs.unlinkSync(CKPT_PATH);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
