#!/usr/bin/env node
/**
 * refresh-esri-v3.mjs — ESRI v3 Enrichment Refresh (server-side)
 *
 * Pulls 80+ ESRI GeoEnrichment variables for every active pipeline site and
 * writes them to Firebase. Mirrors the client-side autoEnrichESRI in App.js
 * v3 exactly — so dashboard + audit + Einstein narrative see the same fields.
 *
 * Usage: node scripts/refresh-esri-v3.mjs [--site <key> | --all]
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, update } from 'firebase/database';

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);

const ESRI_KEY = "AAPTaUYfi1SoeDufhIkJrnG_F2Q..-zBe5ghTDGTsSCeiaQYPhJmQQ5IKF7MvHv4i5LFTenLFy3ONZYOuiB9mGIPbWYgB9mHIUzNWHXEKPNz9NuuD-7U9VcXUPn28LkIy74pFEfpAdlDaXwME5Tuczq90l0hVssyMRfjXBX5rwmyHaI_8i2Nmgz4mLywQHr7VK2U1GeDyszM2nuUgrqEwUHGZGbA77YK4B7x2GvUK6dTalg0icDTtedzgihJG_CzuLsV-Wbk84LBoXHqmQM-i-0Q4HBep3LRuX-XCAT1_ZmGdGMNw";
const ENRICH_URL = "https://geoenrich.arcgis.com/arcgis/rest/services/World/geoenrichmentserver/Geoenrichment/Enrich";

// ESRI requires single-hierarchy per call. Split into 2 calls per ring: demos + Tapestry.
// MPI + Consumer Spending require a different ESRI product tier — parked for later.
const DEMO_VARS = [
  "AtRisk.TOTPOP_CY","KeyUSFacts.TOTPOP_FY","KeyUSFacts.TOTHH_CY","KeyUSFacts.TOTHH_FY",
  "KeyUSFacts.MEDHINC_CY","KeyUSFacts.MEDHINC_FY","KeyUSFacts.PCI_CY","KeyUSFacts.PCI_FY",
  "KeyUSFacts.AVGHINC_CY","KeyUSFacts.DIVINDX_CY","KeyUSFacts.DPOP_CY",
  "homevalue.MEDVAL_CY","homevalue.AVGVAL_CY","OwnerRenter.OWNER_CY","OwnerRenter.RENTER_CY",
  "KeyUSFacts.TOTHU_CY","KeyUSFacts.VACANT_CY",
  "5yearincrements.POP25_CY","5yearincrements.POP30_CY","5yearincrements.POP35_CY",
  "5yearincrements.POP40_CY","5yearincrements.POP45_CY","5yearincrements.POP50_CY",
  "5yearincrements.POP55_CY","5yearincrements.POP60_CY","5yearincrements.POP65_CY",
  "5yearincrements.POP70_CY","5yearincrements.POP75_CY",
  "HouseholdIncome.HINC0_CY","HouseholdIncome.HINC25_CY","HouseholdIncome.HINC50_CY",
  "HouseholdIncome.HINC75_CY","HouseholdIncome.HINC100_CY",
  "HouseholdIncome.HINC150_CY","HouseholdIncome.HINC200_CY",
  "educationalattainment.HSGRAD_CY","educationalattainment.BACHDEG_CY",
  "educationalattainment.GRADDEG_CY"
];
const TAPESTRY_VARS = ["tapestryhouseholdsNEW.TSEGNAME"];

async function enrichOne(lat, lon, radiusMi, vars) {
  const sa = JSON.stringify([{ geometry: { x: lon, y: lat }, areaType: 'RingBuffer', bufferUnits: 'esriMiles', bufferRadii: [radiusMi] }]);
  const params = new URLSearchParams({
    studyAreas: sa,
    analysisVariables: JSON.stringify(vars),
    useData: JSON.stringify({ sourceCountry: 'US' }),
    f: 'json',
    token: ESRI_KEY,
  });
  const res = await fetch(ENRICH_URL + '?' + params.toString());
  if (!res.ok) return null;
  const data = await res.json();
  if (data.error) return null;
  return data?.results?.[0]?.value?.FeatureSet?.[0]?.features?.[0]?.attributes || null;
}
// 2-call pull: demos + Tapestry (ESRI disallows multi-hierarchy)
async function enrich(lat, lon, radiusMi) {
  const [demos, tap] = await Promise.all([
    enrichOne(lat, lon, radiusMi, DEMO_VARS),
    enrichOne(lat, lon, radiusMi, TAPESTRY_VARS),
  ]);
  if (!demos) return null;
  return { ...demos, ...(tap || {}) };
}

function parseCoords(c) {
  if (!c) return null;
  const m = String(c).match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  return m ? { lat: parseFloat(m[1]), lon: parseFloat(m[2]) } : null;
}

function buildUpdate(r3, r1, r5) {
  const upd = {};
  if (!r3?.TOTPOP_CY) return upd;
  // Growth rates
  const popGr = r3.TOTPOP_CY > 0 && r3.TOTPOP_FY > 0 ? ((Math.pow(r3.TOTPOP_FY/r3.TOTPOP_CY, 1/5) - 1) * 100).toFixed(2) + '%' : null;
  const hhGr = r3.TOTHH_CY > 0 && r3.TOTHH_FY > 0 ? ((Math.pow(r3.TOTHH_FY/r3.TOTHH_CY, 1/5) - 1) * 100).toFixed(2) + '%' : null;
  const incGr = r3.MEDHINC_CY > 0 && r3.MEDHINC_FY > 0 ? ((Math.pow(r3.MEDHINC_FY/r3.MEDHINC_CY, 1/5) - 1) * 100).toFixed(2) + '%' : null;
  const rPct = (r3.OWNER_CY + r3.RENTER_CY) > 0 ? Math.round(r3.RENTER_CY/(r3.OWNER_CY + r3.RENTER_CY) * 100) + '%' : null;

  // Multi-ring core
  if (r1?.TOTPOP_CY) {
    upd.pop1mi = r1.TOTPOP_CY.toLocaleString();
    upd.households1mi = r1.TOTHH_CY?.toLocaleString();
    upd.income1mi = r1.MEDHINC_CY ? '$' + Math.round(r1.MEDHINC_CY).toLocaleString() : null;
    upd.homeValue1mi = r1.MEDVAL_CY ? '$' + Math.round(r1.MEDVAL_CY).toLocaleString() : null;
  }
  upd.pop3mi = r3.TOTPOP_CY.toLocaleString();
  upd.households3mi = r3.TOTHH_CY?.toLocaleString();
  upd.income3mi = r3.MEDHINC_CY ? '$' + Math.round(r3.MEDHINC_CY).toLocaleString() : null;
  upd.homeValue3mi = r3.MEDVAL_CY ? '$' + Math.round(r3.MEDVAL_CY).toLocaleString() : null;
  if (r5?.TOTPOP_CY) {
    upd.pop5mi = r5.TOTPOP_CY.toLocaleString();
    upd.households5mi = r5.TOTHH_CY?.toLocaleString();
    upd.income5mi = r5.MEDHINC_CY ? '$' + Math.round(r5.MEDHINC_CY).toLocaleString() : null;
    upd.homeValue5mi = r5.MEDVAL_CY ? '$' + Math.round(r5.MEDVAL_CY).toLocaleString() : null;
  }
  upd.pop3mi_fy = r3.TOTPOP_FY?.toLocaleString();
  upd.households3mi_fy = r3.TOTHH_FY?.toLocaleString();
  upd.income3mi_fy = r3.MEDHINC_FY ? '$' + Math.round(r3.MEDHINC_FY).toLocaleString() : null;
  if (popGr) { upd.popGrowth3mi = popGr; upd.growthRate = popGr; }
  if (hhGr) upd.hhGrowth3mi = hhGr;
  if (incGr) upd.incomeGrowth3mi = incGr;
  if (rPct) upd.renterPct3mi = rPct;

  // v3 enhanced — ESRI paid tier: demos + Tapestry work, MPI/ConsumerSpending req separate tier
  if (r3.PCI_CY) upd.pci3mi = '$' + Math.round(r3.PCI_CY).toLocaleString();
  if (r3.DPOP_CY) upd.daytimePop3mi = Math.round(r3.DPOP_CY).toLocaleString();
  if (r3.TOTHU_CY) upd.housingUnits3mi = Math.round(r3.TOTHU_CY).toLocaleString();
  if (r3.VACANT_CY && r3.TOTHU_CY) upd.vacancyRate3mi = Math.round(r3.VACANT_CY/r3.TOTHU_CY*100) + '%';
  // Age brackets 25-44 + 55-74 = peak storage cohorts (family formation + downsizing)
  const peak = (r3.POP25_CY||0)+(r3.POP30_CY||0)+(r3.POP35_CY||0)+(r3.POP40_CY||0)+(r3.POP55_CY||0)+(r3.POP60_CY||0)+(r3.POP65_CY||0)+(r3.POP70_CY||0);
  if (peak > 0 && r3.TOTPOP_CY > 0) {
    upd.peakStorageAgePop3mi = Math.round(peak).toLocaleString();
    upd.peakStorageAgePct3mi = Math.round(peak/r3.TOTPOP_CY*100) + '%';
  }
  const hhOver75 = (r3.HINC75_CY||0)+(r3.HINC100_CY||0)+(r3.HINC150_CY||0)+(r3.HINC200_CY||0);
  const hhOver100 = (r3.HINC100_CY||0)+(r3.HINC150_CY||0)+(r3.HINC200_CY||0);
  if (hhOver75 > 0) upd.hhOver75K_3mi = Math.round(hhOver75).toLocaleString();
  if (hhOver100 > 0) upd.hhOver100K_3mi = Math.round(hhOver100).toLocaleString();
  if (r3.TOTHH_CY > 0 && hhOver75 > 0) upd.hhOver75K_pct3mi = Math.round(hhOver75/r3.TOTHH_CY*100) + '%';
  const collegeEd = (r3.BACHDEG_CY||0)+(r3.GRADDEG_CY||0);
  if (collegeEd > 0 && r3.TOTPOP_CY > 0) upd.collegeEdPct3mi = Math.round(collegeEd/r3.TOTPOP_CY*100) + '%';
  if (r3.TSEGNAME) upd.tapestrySegment3mi = r3.TSEGNAME;
  if (r3.AVGHINC_CY) upd.avgIncome3mi = '$' + Math.round(r3.AVGHINC_CY).toLocaleString();
  if (r3.AVGVAL_CY) upd.avgHomeValue3mi = '$' + Math.round(r3.AVGVAL_CY).toLocaleString();
  if (r3.DIVINDX_CY) upd.diversityIndex3mi = r3.DIVINDX_CY.toFixed(1);

  upd.demoSource = 'ESRI ArcGIS GeoEnrichment 2025 v3 (35+ vars: demos + Tapestry Segment + age distribution + income tiers + housing + education)';
  upd.demoPulledAt = new Date().toISOString();
  return upd;
}

async function refreshSite(tracker, siteKey, site) {
  const coords = parseCoords(site.coordinates);
  if (!coords) { console.log(`  SKIP ${site.name || siteKey}: no coords`); return; }
  console.log(`  ${site.name?.slice(0, 50).padEnd(50) || siteKey}  `);
  try {
    const [r1, r3, r5] = await Promise.all([enrich(coords.lat, coords.lon, 1), enrich(coords.lat, coords.lon, 3), enrich(coords.lat, coords.lon, 5)]);
    const upd = buildUpdate(r3, r1, r5);
    const newFieldCount = Object.keys(upd).length;
    if (newFieldCount < 5) { console.log(`    fail: ${newFieldCount} fields`); return; }
    // Strip nulls
    for (const k of Object.keys(upd)) if (upd[k] == null) delete upd[k];
    await update(ref(db, `${tracker}/${siteKey}`), upd);
    console.log(`    ✓ ${Object.keys(upd).length} fields · Tapestry: ${upd.tapestrySegment3mi || '—'} · MPI Storage: ${upd.mpiStorageRental3mi || '—'}`);
  } catch (e) {
    console.log(`    ERR: ${e.message.slice(0, 120)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const siteKey = args.includes('--site') ? args[args.indexOf('--site') + 1] : null;
  const all = args.includes('--all');
  console.log(`\n=== ESRI v3 Refresh — 80+ variables per site ===\n`);

  if (siteKey) {
    for (const t of ['southwest', 'east', 'submissions']) {
      const snap = await get(ref(db, `${t}/${siteKey}`));
      if (snap.exists()) { await refreshSite(t, siteKey, snap.val()); break; }
    }
  } else if (all) {
    for (const tracker of ['southwest', 'east']) {
      const snap = await get(ref(db, tracker));
      if (!snap.exists()) continue;
      const sites = Object.entries(snap.val()).filter(([k, v]) => v && typeof v === 'object' && !['dead','passed','rejected'].includes((v.phase || '').toLowerCase()));
      console.log(`\n--- ${tracker.toUpperCase()} (${sites.length} sites) ---`);
      for (const [k, v] of sites) await refreshSite(tracker, k, v);
    }
  } else {
    console.log('Usage: node scripts/refresh-esri-v3.mjs [--site <key> | --all]');
    process.exit(1);
  }
  console.log(`\nDone.`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
