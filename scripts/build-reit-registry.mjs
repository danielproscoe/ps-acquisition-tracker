#!/usr/bin/env node
/**
 * build-reit-registry.mjs — Build the Storvex REIT Location Registry
 *
 * Reads canonical REIT location CSVs (PS, iStorage, NSA — public data from
 * each REIT's store-finder export) and produces a single JSON file loaded
 * by the browser for instant coord-match against any subject address.
 *
 * Output: ps-acquisition-tracker/public/reit-registry.json
 *   {
 *     generatedAt, recordCount,
 *     locations: [
 *       { id, brand, name, address, city, state, zip, lat, lon, operator }
 *     ]
 *   }
 *
 * "We already know every PS/iStorage/NSA facility in America. When a user types
 *  an address, we're not fetching — we're recalling."
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const REF_DIR = 'C:/Users/danie/OneDrive/Desktop/MASTER FOLDER - CLAUDE/#2 - PS/Reference Files';

function parseCSV(path, brand, operator) {
  if (!existsSync(path)) { console.log(`  ! skipped: ${path} not found`); return []; }
  const text = readFileSync(path, 'utf-8');
  const lines = text.split(/\r?\n/).slice(1); // skip header
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    // Handle CSV with quoted fields
    const cols = line.split(',');
    if (cols.length < 8) continue;
    const lat = parseFloat(cols[6]);
    const lon = parseFloat(cols[7]);
    if (isNaN(lat) || isNaN(lon)) continue;
    const name = cols[1]?.trim() || '';
    // For NSA rows, the name often contains the actual brand (iStorage, etc.)
    let finalBrand = brand;
    if (brand === 'NSA' && name.includes('iStorage')) finalBrand = 'iStorage';
    rows.push({
      id: cols[0]?.trim() || '',
      brand: finalBrand,
      name,
      address: cols[2]?.trim() || '',
      city: cols[3]?.trim() || '',
      state: cols[4]?.trim() || '',
      zip: cols[5]?.trim() || '',
      lat, lon,
      operator,
    });
  }
  console.log(`  ${path.split(/[\\/]/).pop().padEnd(30)} → ${rows.length} locations`);
  return rows;
}

console.log(`\n=== Storvex REIT Registry Builder ===\n`);
console.log(`Source directory: ${REF_DIR}\n`);

const all = [];
all.push(...parseCSV(resolve(REF_DIR, 'PS_Locations_ALL.csv'), 'Public Storage', 'PSA'));
all.push(...parseCSV(resolve(REF_DIR, 'NSA_Locations.csv'), 'NSA', 'NSA'));
// iStorage rows often land in NSA file; parseCSV re-tags them

// De-dupe by lat/lon (to ~5 decimals, ~1m precision)
const seen = new Set();
const unique = [];
for (const r of all) {
  const key = `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(r);
}
console.log(`\nMerged: ${all.length} → ${unique.length} unique locations after de-dup\n`);

// Summary by brand
const byBrand = {};
for (const r of unique) byBrand[r.brand] = (byBrand[r.brand] || 0) + 1;
console.log(`By brand:`);
for (const [brand, count] of Object.entries(byBrand).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${brand.padEnd(25)} ${count}`);
}

const output = {
  generatedAt: new Date().toISOString(),
  recordCount: unique.length,
  byBrand,
  schema: { id: 'string', brand: 'string', name: 'string', address: 'string', city: 'string', state: 'string', zip: 'string', lat: 'number', lon: 'number', operator: 'string' },
  locations: unique,
};

const outPath = 'C:/Users/danie/OneDrive/Desktop/MASTER FOLDER - CLAUDE/ps-acquisition-tracker/public/reit-registry.json';
writeFileSync(outPath, JSON.stringify(output));
const sizeKB = Math.round(Buffer.byteLength(JSON.stringify(output)) / 1024);
console.log(`\n✓ Wrote ${outPath} (${sizeKB} KB · ${unique.length} locations)\n`);
console.log(`Browser can now fetch at /reit-registry.json — served as static asset from public/\n`);
