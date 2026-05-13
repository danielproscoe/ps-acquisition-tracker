#!/usr/bin/env node
/**
 * ps-dna-build-dataset.mjs
 *
 * Phase 1 of the PS DNA portfolio-fit benchmark system.
 * Loads 4 CSVs (PS_ALL + 3rdParty + Combined + NSA/iStorage), de-dupes by
 * PROPERTY_NUM, computes intra-portfolio metrics (Haversine distance to
 * nearest sibling location), and writes a unified JSON dataset that the
 * ESRI enrichment step (next script) reads.
 *
 * Output:
 *   #2 - PS/Reference Files/PS_Portfolio_Unified.json
 *
 * No ESRI calls in this step. Pure local computation.
 */

import fs from 'node:fs';
import path from 'node:path';

const REF_DIR = 'C:/Users/danie/OneDrive/Desktop/MASTER FOLDER - CLAUDE/#2 - PS/Reference Files';
const OUT_PATH = path.join(REF_DIR, 'PS_Portfolio_Unified.json');

const SOURCES = [
  { file: 'PS_Locations_ALL.csv',       brand: 'PS',           ownership: 'owned'        },
  { file: 'PS_Locations_3rdParty.csv',  brand: 'PS',           ownership: 'third-party'  },
  { file: 'PS_Locations_Combined.csv',  brand: 'PS',           ownership: 'combined'     },
  { file: 'NSA_Locations.csv',          brand: 'NSA/iStorage', ownership: 'owned'        },
];

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] ?? '').trim(); });
    return row;
  });
}

function splitCSVLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function haversineMi(lat1, lon1, lat2, lon2) {
  const R = 3958.7613;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function detectBrandFromName(name) {
  if (!name) return null;
  const upper = name.toUpperCase();
  if (upper.includes('ISTORAGE')) return 'iStorage';
  if (upper.startsWith('NSA')) return 'NSA';
  if (upper.startsWith('PS')) return 'Public Storage';
  return null;
}

function loadAll() {
  const records = [];
  const seenIds = new Map();

  for (const src of SOURCES) {
    const filePath = path.join(REF_DIR, src.file);
    if (!fs.existsSync(filePath)) {
      console.error(`SKIP — file not found: ${filePath}`);
      continue;
    }
    const rows = parseCSV(fs.readFileSync(filePath, 'utf8'));
    let added = 0, dup = 0, badCoords = 0;
    for (const r of rows) {
      const id = r.PROPERTY_NUM || `${src.file}|${r.ADDRESS}|${r.CITY}`;
      const lat = parseFloat(r.LATITUDE);
      const lon = parseFloat(r.LONGITUDE);
      if (!isFinite(lat) || !isFinite(lon) || lat === 0 || lon === 0) {
        badCoords++;
        continue;
      }
      if (seenIds.has(id)) {
        dup++;
        const existing = records[seenIds.get(id)];
        existing.sources = Array.from(new Set([...existing.sources, src.file]));
        continue;
      }
      const brandRefined = detectBrandFromName(r.PROPERTY_NAME) || src.brand;
      const rec = {
        id,
        propertyNum: r.PROPERTY_NUM || '',
        propertyName: r.PROPERTY_NAME || '',
        address: r.ADDRESS || '',
        city: r.CITY || '',
        state: r.STATE || '',
        zip: r.ZIP || '',
        lat,
        lon,
        brand: brandRefined,
        ownership: src.ownership,
        sources: [src.file],
      };
      seenIds.set(id, records.length);
      records.push(rec);
      added++;
    }
    console.log(`  ${src.file}: rows=${rows.length}  added=${added}  dup=${dup}  badCoords=${badCoords}`);
  }
  return records;
}

function computeNearestSibling(records) {
  console.log('\nComputing nearest-sibling distance for all locations...');
  const t0 = Date.now();
  for (let i = 0; i < records.length; i++) {
    let nearest = Infinity;
    let nearestId = null;
    const a = records[i];
    for (let j = 0; j < records.length; j++) {
      if (i === j) continue;
      const b = records[j];
      const d = haversineMi(a.lat, a.lon, b.lat, b.lon);
      if (d < nearest) { nearest = d; nearestId = b.id; }
    }
    a.nearestSiblingMi = nearest;
    a.nearestSiblingId = nearestId;
    if ((i + 1) % 1000 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  ${i + 1}/${records.length}  (${elapsed}s elapsed)`);
    }
  }
  console.log(`  Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function summarize(records) {
  const byState = {};
  const byBrand = {};
  const byOwnership = {};
  let nearestSum = 0, nearestMin = Infinity, nearestMax = 0;
  for (const r of records) {
    byState[r.state] = (byState[r.state] || 0) + 1;
    byBrand[r.brand] = (byBrand[r.brand] || 0) + 1;
    byOwnership[r.ownership] = (byOwnership[r.ownership] || 0) + 1;
    nearestSum += r.nearestSiblingMi;
    if (r.nearestSiblingMi < nearestMin) nearestMin = r.nearestSiblingMi;
    if (r.nearestSiblingMi > nearestMax) nearestMax = r.nearestSiblingMi;
  }
  return {
    totalLocations: records.length,
    byBrand,
    byOwnership,
    topStates: Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 15),
    nearestSiblingMi: {
      mean: nearestSum / records.length,
      min: nearestMin,
      max: nearestMax,
    },
  };
}

function main() {
  console.log('=== PS DNA — Phase 1: Unified Dataset Build ===\n');
  const records = loadAll();
  console.log(`\nTotal unique locations after dedup: ${records.length}`);
  computeNearestSibling(records);
  const summary = summarize(records);
  const out = {
    builtAt: new Date().toISOString(),
    summary,
    records,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT_PATH}`);
  console.log('Summary:');
  console.log(JSON.stringify(summary, null, 2));
}

main();
