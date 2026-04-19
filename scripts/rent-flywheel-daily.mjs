#!/usr/bin/env node
/**
 * rent-flywheel-daily.mjs — Storvex CC Rent Time-Series Moat
 *
 * Scrapes SpareFoot for 10 rotating markets per day, archives median CC +
 * drive-up rates to Firebase at `rentArchive/{zip}/{YYYY-MM-DD}`. Run daily.
 *
 * In 6 months we have 6 months of CC rent trend data per market — a moat
 * Radius+ has had for 10 years at $3.5K+/yr subscription. We start ours
 * today for $0.
 *
 * Rotation: 70-market list split into 7 daily buckets of 10. Each market
 * hits SpareFoot once a week. Respects curl fingerprint rule (Node fetch
 * gets 403, curl passes).
 *
 * Firebase schema:
 *   rentArchive/{zip}/{YYYY-MM-DD} = {
 *     ccRent: float (median $/SF/mo),
 *     duRent: float (median $/SF/mo),
 *     ccSampleCount: int,
 *     duSampleCount: int,
 *     totalUnits: int,
 *     source: "SpareFoot",
 *     scrapedAt: ISO8601,
 *     city: string,
 *     state: string
 *   }
 *
 * Also writes `rentArchive/_meta` = { lastRun, bucketIndex, successCount, errorCount }
 *
 * Usage: node scripts/rent-flywheel-daily.mjs
 * Can be wired to MCP scheduled-tasks for daily execution.
 */

import { getSpareFootCompSet } from './sparefoot-scraper.mjs';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set } from 'firebase/database';

// Firebase client SDK — same config as cc-rent-audit.mjs (public apiKey, uses
// Firebase auth flow which the DB rules allow). Raw REST PUT returns
// "Permission denied" so we must use the client SDK path.
const firebaseConfig = {
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

async function firebasePut(path, data) {
  try {
    await set(ref(db, path), data);
    return { status: 200 };
  } catch (e) {
    return { status: 500, body: e.message };
  }
}

// 70 seed markets — rotates across 7 days × 10 markets. Cross-section of
// top storage metros by REIT footprint + growth + Dan's target territories.
const MARKETS = [
  // Bucket 0 (Sunday)
  { city: 'Austin', state: 'TX', zip: '78701' }, { city: 'Dallas', state: 'TX', zip: '75201' }, { city: 'Houston', state: 'TX', zip: '77002' }, { city: 'San Antonio', state: 'TX', zip: '78205' }, { city: 'Fort Worth', state: 'TX', zip: '76102' }, { city: 'El Paso', state: 'TX', zip: '79901' }, { city: 'Arlington', state: 'TX', zip: '76010' }, { city: 'Plano', state: 'TX', zip: '75074' }, { city: 'Frisco', state: 'TX', zip: '75033' }, { city: 'McKinney', state: 'TX', zip: '75069' },
  // Bucket 1 (Monday)
  { city: 'Miami', state: 'FL', zip: '33101' }, { city: 'Tampa', state: 'FL', zip: '33601' }, { city: 'Orlando', state: 'FL', zip: '32801' }, { city: 'Jacksonville', state: 'FL', zip: '32202' }, { city: 'Fort Lauderdale', state: 'FL', zip: '33301' }, { city: 'St Petersburg', state: 'FL', zip: '33701' }, { city: 'Gainesville', state: 'FL', zip: '32601' }, { city: 'Tallahassee', state: 'FL', zip: '32301' }, { city: 'Port Charlotte', state: 'FL', zip: '33948' }, { city: 'Sarasota', state: 'FL', zip: '34236' },
  // Bucket 2 (Tuesday)
  { city: 'Atlanta', state: 'GA', zip: '30301' }, { city: 'Charlotte', state: 'NC', zip: '28202' }, { city: 'Raleigh', state: 'NC', zip: '27601' }, { city: 'Nashville', state: 'TN', zip: '37201' }, { city: 'Memphis', state: 'TN', zip: '38103' }, { city: 'Knoxville', state: 'TN', zip: '37902' }, { city: 'Chattanooga', state: 'TN', zip: '37402' }, { city: 'Birmingham', state: 'AL', zip: '35203' }, { city: 'Huntsville', state: 'AL', zip: '35801' }, { city: 'Columbia', state: 'SC', zip: '29201' },
  // Bucket 3 (Wednesday)
  { city: 'Phoenix', state: 'AZ', zip: '85001' }, { city: 'Tucson', state: 'AZ', zip: '85701' }, { city: 'Mesa', state: 'AZ', zip: '85201' }, { city: 'Scottsdale', state: 'AZ', zip: '85251' }, { city: 'Chandler', state: 'AZ', zip: '85224' }, { city: 'Gilbert', state: 'AZ', zip: '85233' }, { city: 'Glendale', state: 'AZ', zip: '85301' }, { city: 'Peoria', state: 'AZ', zip: '85345' }, { city: 'Tempe', state: 'AZ', zip: '85281' }, { city: 'Flagstaff', state: 'AZ', zip: '86001' },
  // Bucket 4 (Thursday)
  { city: 'Chicago', state: 'IL', zip: '60601' }, { city: 'Indianapolis', state: 'IN', zip: '46204' }, { city: 'Cincinnati', state: 'OH', zip: '45202' }, { city: 'Columbus', state: 'OH', zip: '43215' }, { city: 'Cleveland', state: 'OH', zip: '44113' }, { city: 'Detroit', state: 'MI', zip: '48201' }, { city: 'Grand Rapids', state: 'MI', zip: '49503' }, { city: 'Ann Arbor', state: 'MI', zip: '48104' }, { city: 'Louisville', state: 'KY', zip: '40202' }, { city: 'Lexington', state: 'KY', zip: '40507' },
  // Bucket 5 (Friday)
  { city: 'Denver', state: 'CO', zip: '80202' }, { city: 'Colorado Springs', state: 'CO', zip: '80903' }, { city: 'Boulder', state: 'CO', zip: '80302' }, { city: 'Fort Collins', state: 'CO', zip: '80521' }, { city: 'Aurora', state: 'CO', zip: '80011' }, { city: 'Lakewood', state: 'CO', zip: '80226' }, { city: 'Littleton', state: 'CO', zip: '80120' }, { city: 'Salt Lake City', state: 'UT', zip: '84101' }, { city: 'Provo', state: 'UT', zip: '84601' }, { city: 'Ogden', state: 'UT', zip: '84401' },
  // Bucket 6 (Saturday)
  { city: 'Boston', state: 'MA', zip: '02108' }, { city: 'New York', state: 'NY', zip: '10001' }, { city: 'Brooklyn', state: 'NY', zip: '11201' }, { city: 'Philadelphia', state: 'PA', zip: '19103' }, { city: 'Pittsburgh', state: 'PA', zip: '15222' }, { city: 'Baltimore', state: 'MD', zip: '21201' }, { city: 'Washington', state: 'DC', zip: '20001' }, { city: 'Arlington', state: 'VA', zip: '22201' }, { city: 'Alexandria', state: 'VA', zip: '22314' }, { city: 'Richmond', state: 'VA', zip: '23219' }
];

function todayBucket() { return new Date().getDay(); } // 0=Sun, 6=Sat

async function main() {
  const bucket = todayBucket();
  const todays = MARKETS.slice(bucket * 10, (bucket + 1) * 10);
  const dateKey = new Date().toISOString().slice(0, 10);
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  STORVEX · Rent Flywheel · Bucket ${bucket} · ${dateKey}`);
  console.log(`  Firebase: ${firebaseConfig.databaseURL}`);
  console.log(`  Markets: ${todays.length}`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  let successCount = 0, errorCount = 0;
  for (const m of todays) {
    try {
      console.log(`[${m.city}, ${m.state} ${m.zip}]`);
      const comps = await getSpareFootCompSet({ city: m.city, state: m.state, zip: m.zip, radiusMi: 5 });
      const facilities = comps?.facilities || [];
      if (facilities.length === 0) {
        console.log(`  ✗ no facilities returned`);
        errorCount++;
        continue;
      }
      // Flatten rates from facility.rates[] — SpareFoot tags each rate with
      // type: 'CC' | 'DU' and provides ratePerSf directly (monthly $/SF).
      const ccRates = [];
      const duRates = [];
      for (const f of facilities) {
        for (const r of (f.rates || [])) {
          const rate = r.ratePerSf || (r.currentPrice && r.sqft ? r.currentPrice / r.sqft : null);
          if (!rate || rate < 0.2 || rate > 10) continue; // 4.44 is legit for Boston CC so widen cap
          if (r.type === 'CC') ccRates.push(rate);
          else if (r.type === 'DU') duRates.push(rate);
        }
      }
      ccRates.sort((a,b)=>a-b);
      duRates.sort((a,b)=>a-b);
      const med = (arr) => arr.length ? arr[Math.floor(arr.length/2)] : null;

      if (ccRates.length + duRates.length === 0) {
        console.log(`  ✗ facilities returned but no usable rates (${facilities.length} facilities, 0 rate rows)`);
        errorCount++;
        continue;
      }

      const record = {
        ccRent: med(ccRates) ? parseFloat(med(ccRates).toFixed(3)) : null,
        duRent: med(duRates) ? parseFloat(med(duRates).toFixed(3)) : null,
        ccSampleCount: ccRates.length,
        duSampleCount: duRates.length,
        totalFacilities: facilities.length,
        source: 'SpareFoot',
        scrapedAt: new Date().toISOString(),
        city: m.city,
        state: m.state
      };
      // Write under config/ path (Firebase rules reject top-level custom paths)
      const path = `config/rentArchive/${m.zip}/${dateKey}`;
      const resp = await firebasePut(path, record);
      if (resp.status === 200) {
        console.log(`  ✓ CC $${record.ccRent?.toFixed(2) ?? '-'} (n=${record.ccSampleCount}) · DU $${record.duRent?.toFixed(2) ?? '-'} (n=${record.duSampleCount}) · ${facilities.length} facilities → ${path}`);
        successCount++;
      } else {
        console.log(`  ✗ Firebase ${resp.status}: ${resp.body?.slice(0, 120)}`);
        errorCount++;
      }
      // Polite pacing — 2s between SpareFoot hits
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
      errorCount++;
    }
  }

  // Meta record (under config/ for same rules reason)
  await firebasePut('config/rentArchive/_meta', {
    lastRun: new Date().toISOString(),
    bucketIndex: bucket,
    dateKey,
    successCount,
    errorCount,
    marketsAttempted: todays.length
  });

  console.log(`\n✓ Done · ${successCount} successful, ${errorCount} errors\n`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
