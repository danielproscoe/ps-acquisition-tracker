#!/usr/bin/env node
/**
 * ps-dna-build-profile.mjs
 *
 * Phase 3 of the PS DNA portfolio-fit benchmark system.
 * Reads PS_Portfolio_Enriched.json (ESRI-enriched location data) and
 * computes percentile distributions for each numeric attribute, segmented
 * by submarket density (urban / suburban / exurban / rural).
 *
 * Outputs:
 *   #2 - PS/Reference Files/PS_Portfolio_DNA_Profile.json  (canonical archive)
 *   ps-acquisition-tracker/public/ps-dna-profile.json      (runtime fetch)
 *
 * Density bins (from 3-mi pop):
 *   urban:    pop >= 80,000
 *   suburban: pop  25,000 – 80,000
 *   exurban:  pop   5,000 – 25,000
 *   rural:    pop <   5,000
 */

import fs from 'node:fs';
import path from 'node:path';

const REF_DIR = 'C:/Users/danie/OneDrive/Desktop/MASTER FOLDER - CLAUDE/#2 - PS/Reference Files';
const REPO_PUBLIC = 'C:/Users/danie/OneDrive/Desktop/MASTER FOLDER - CLAUDE/ps-acquisition-tracker/public';
const IN_PATH = path.join(REF_DIR, 'PS_Portfolio_Enriched.json');
const OUT_ARCHIVE = path.join(REF_DIR, 'PS_Portfolio_DNA_Profile.json');
const OUT_RUNTIME = path.join(REPO_PUBLIC, 'ps-dna-profile.json');

function classifyDensity(pop3mi) {
  const n = Number(pop3mi) || 0;
  if (n >= 80000) return 'urban';
  if (n >= 25000) return 'suburban';
  if (n >= 5000)  return 'exurban';
  return 'rural';
}

function pct(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function distOf(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    p10: pct(sorted, 10),
    p25: pct(sorted, 25),
    p50: pct(sorted, 50),
    p75: pct(sorted, 75),
    p90: pct(sorted, 90),
  };
}

function buildSubProfile(records) {
  const pop = [], hhi = [], growth = [], hh = [], home = [], renter = [], nearestSib = [];
  for (const r of records) {
    const d = r.demo3mi;
    if (!d || d.__error) continue;
    if (typeof d.pop_cy === 'number') pop.push(d.pop_cy);
    if (typeof d.medhinc_cy === 'number') hhi.push(d.medhinc_cy);
    if (typeof d.hh_cy === 'number') hh.push(d.hh_cy);
    if (typeof d.medval_cy === 'number' && d.medval_cy > 0) home.push(d.medval_cy);
    // 5-yr CAGR from CY → FY
    if (typeof d.pop_cy === 'number' && d.pop_cy > 0 && typeof d.pop_fy === 'number' && d.pop_fy > 0) {
      const cagr = (Math.pow(d.pop_fy / d.pop_cy, 1 / 5) - 1) * 100;
      if (isFinite(cagr) && Math.abs(cagr) < 20) growth.push(cagr);
    }
    if (typeof d.owner_cy === 'number' && typeof d.renter_cy === 'number') {
      const total = d.owner_cy + d.renter_cy;
      if (total > 0) renter.push((d.renter_cy / total) * 100);
    }
    if (typeof r.nearestSiblingMi === 'number') nearestSib.push(r.nearestSiblingMi);
  }
  return {
    count: records.length,
    distributions: {
      pop3mi:        distOf(pop),
      hhi3mi:        distOf(hhi),
      growth:        distOf(growth),
      households3mi: distOf(hh),
      homeValue3mi:  distOf(home),
      renterPct:     distOf(renter),
      nearestSiblingMi: distOf(nearestSib),
    },
  };
}

function main() {
  console.log('=== PS DNA — Phase 3: Profile Distribution Build ===\n');

  const enriched = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));
  const records = enriched.records || [];
  console.log(`Loaded ${records.length} enriched locations`);

  // Bucket by density
  const buckets = { urban: [], suburban: [], exurban: [], rural: [], errored: [] };
  for (const r of records) {
    const d = r.demo3mi;
    if (!d || d.__error) { buckets.errored.push(r); continue; }
    const bucket = classifyDensity(d.pop_cy);
    buckets[bucket].push(r);
  }
  console.log('Density distribution:');
  Object.entries(buckets).forEach(([k, v]) => console.log(`  ${k.padEnd(10)} ${v.length}`));

  // State frequency (across all enriched, regardless of density)
  const stateFreq = {};
  const brandFreq = {};
  const ownershipFreq = {};
  for (const r of records) {
    if (!r.demo3mi || r.demo3mi.__error) continue;
    stateFreq[r.state] = (stateFreq[r.state] || 0) + 1;
    brandFreq[r.brand] = (brandFreq[r.brand] || 0) + 1;
    ownershipFreq[r.ownership] = (ownershipFreq[r.ownership] || 0) + 1;
  }

  // Build sub-profiles
  const subProfiles = {
    urban:    buildSubProfile(buckets.urban),
    suburban: buildSubProfile(buckets.suburban),
    exurban:  buildSubProfile(buckets.exurban),
    rural:    buildSubProfile(buckets.rural),
  };

  // Global profile (all density tiers combined)
  const globalProfile = buildSubProfile(records.filter(r => r.demo3mi && !r.demo3mi.__error));

  const dna = {
    builtAt: new Date().toISOString(),
    sourceFile: 'PS_Portfolio_Enriched.json',
    ringMi: enriched.ringMi || 3,
    recordsTotal: records.length,
    recordsEnriched: records.length - buckets.errored.length,
    densityBins: {
      urban:    'pop3mi >= 80,000',
      suburban: 'pop3mi 25,000 - 80,000',
      exurban:  'pop3mi 5,000 - 25,000',
      rural:    'pop3mi < 5,000',
    },
    densityCounts: {
      urban:    buckets.urban.length,
      suburban: buckets.suburban.length,
      exurban:  buckets.exurban.length,
      rural:    buckets.rural.length,
      errored:  buckets.errored.length,
    },
    stateFreq,
    brandFreq,
    ownershipFreq,
    topStates: Object.entries(stateFreq).sort((a, b) => b[1] - a[1]).slice(0, 20),
    global: globalProfile,
    subProfiles,
  };

  fs.writeFileSync(OUT_ARCHIVE, JSON.stringify(dna, null, 2));
  fs.writeFileSync(OUT_RUNTIME, JSON.stringify(dna));
  console.log(`\nWrote ${OUT_ARCHIVE}`);
  console.log(`Wrote ${OUT_RUNTIME} (runtime fetch target)`);

  console.log('\n--- DNA HIGHLIGHTS ---');
  ['urban', 'suburban', 'exurban', 'rural'].forEach(b => {
    const sp = subProfiles[b];
    if (!sp.distributions.pop3mi) { console.log(`${b}: NO DATA`); return; }
    const p = sp.distributions.pop3mi;
    const i = sp.distributions.hhi3mi;
    const g = sp.distributions.growth;
    const ns = sp.distributions.nearestSiblingMi;
    console.log(`\n${b.toUpperCase()} (${sp.count} sites)`);
    console.log(`  3-mi pop:       P10=${p.p10.toLocaleString(undefined,{maximumFractionDigits:0})}  P50=${p.p50.toLocaleString(undefined,{maximumFractionDigits:0})}  P90=${p.p90.toLocaleString(undefined,{maximumFractionDigits:0})}`);
    if (i) console.log(`  Median HHI:     P10=$${i.p10.toLocaleString(undefined,{maximumFractionDigits:0})}  P50=$${i.p50.toLocaleString(undefined,{maximumFractionDigits:0})}  P90=$${i.p90.toLocaleString(undefined,{maximumFractionDigits:0})}`);
    if (g) console.log(`  Pop growth %:   P10=${g.p10.toFixed(2)}  P50=${g.p50.toFixed(2)}  P90=${g.p90.toFixed(2)}`);
    if (ns) console.log(`  Nearest sib mi: P10=${ns.p10.toFixed(2)}  P50=${ns.p50.toFixed(2)}  P90=${ns.p90.toFixed(2)}`);
  });
}

main();
