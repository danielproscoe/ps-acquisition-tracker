#!/usr/bin/env node
/**
 * update-pipeline-batch.mjs — Batch dashboard updates for broker responses
 *
 * Updates:
 * 1. Temple TX (4607 205 Loop) — Phase → "PSA Sent"
 * 2. Medford NJ (105 Rt 70) — Phase → "LOI Signed"
 * 3. Westampton NJ (598 Rancocas Rd) — Price → $3,500,000 + LOI note
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, update, set } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
  storageBucket: "ps-pipeline-engine---djr---v1.firebasestorage.app",
  messagingSenderId: "863337910082",
  appId: "1:863337910082:web:4cd6c9d38093a5177202db"
};

const PATHS = ['submissions', 'southwest', 'east'];

async function findSite(db, searchTerms) {
  for (const path of PATHS) {
    const snap = await get(ref(db, path));
    if (!snap.exists()) continue;
    const data = snap.val();
    for (const [key, site] of Object.entries(data)) {
      const name = (site.name || '').toLowerCase();
      const addr = (site.address || '').toLowerCase();
      const match = searchTerms.some(t => name.includes(t) || addr.includes(t));
      if (match) return { path, key, site };
    }
  }
  return null;
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);
  const now = new Date().toISOString().split('T')[0]; // 2026-03-24

  // 1. Temple TX — PSA Sent
  console.log('\n[1] Searching for Temple TX (4607 205 Loop)...');
  const temple = await findSite(db, ['temple', '4607', '205 loop']);
  if (temple) {
    console.log(`  Found: ${temple.path}/${temple.key} — "${temple.site.name}"`);
    const updates = {
      phase: 'PSA Sent',
      recentUpdate: `${now}: PSA sent to seller broker (9.57ac parcel). PS legal (Mark Rothenberg) drafted PSA. Seller broker: Scott Motsinger, Central Realty Partners.`,
    };
    // Add activity log entry
    const activityRef = ref(db, `${temple.path}/${temple.key}/activityLog`);
    const actSnap = await get(activityRef);
    const activityLog = actSnap.exists() ? actSnap.val() : [];
    const newLog = Array.isArray(activityLog) ? activityLog : Object.values(activityLog);
    newLog.push({
      date: now,
      action: 'PSA Sent to seller broker',
      details: 'PS legal (Mark Rothenberg, Asst. General Counsel) drafted PSA for 9.57ac parcel. Dan forwarded to seller broker Scott Motsinger (Central Realty Partners). Two LOIs submitted: 9.573ac (multi-owner) and 0.935ac (Gummelt only).'
    });
    await update(ref(db, `${temple.path}/${temple.key}`), { ...updates, activityLog: newLog });
    console.log('  ✓ Updated phase → PSA Sent');
  } else {
    console.log('  ✗ NOT FOUND — will need manual entry');
  }

  // 2. Medford NJ — LOI Signed
  console.log('\n[2] Searching for Medford NJ (105 Rt 70)...');
  const medford = await findSite(db, ['medford', '105 rt 70', 'rt 70', 'route 70']);
  if (medford) {
    console.log(`  Found: ${medford.path}/${medford.key} — "${medford.site.name}"`);
    const updates = {
      phase: 'LOI Signed',
      recentUpdate: `${now}: LOI executed. Seller (Kevin Hetzel, Redpoint WP) needs 90 days post-DD to relocate business. Seller's counsel: Clyde Donohugh, Esq.`,
    };
    const activityRef = ref(db, `${medford.path}/${medford.key}/activityLog`);
    const actSnap = await get(activityRef);
    const activityLog = actSnap.exists() ? actSnap.val() : [];
    const newLog = Array.isArray(activityLog) ? activityLog : Object.values(activityLog);
    newLog.push({
      date: now,
      action: 'LOI Executed by seller',
      details: 'Kevin Hetzel (Redpoint WP) sent executed LOI. Seller needs extra 90 days to clear out existing business operations before closing. Has suitable relocation under agreement. Timeline: DD → permitting → 90 days seller move-out → close. Seller counsel: Clyde Donohugh, Esq. (clyde@clydelaw.com).'
    });
    await update(ref(db, `${medford.path}/${medford.key}`), { ...updates, activityLog: newLog });
    console.log('  ✓ Updated phase → LOI Signed');
  } else {
    console.log('  ✗ NOT FOUND — will need manual entry');
  }

  // 3. Westampton NJ — Price update + LOI revision
  console.log('\n[3] Searching for Westampton NJ (598 Rancocas Rd)...');
  const westampton = await findSite(db, ['westampton', 'rancocas', '598']);
  if (westampton) {
    console.log(`  Found: ${westampton.path}/${westampton.key} — "${westampton.site.name}"`);
    const updates = {
      askingPrice: '$3,500,000',
      recentUpdate: `${now}: Revised LOI sent — increased to $3.5M to compensate for PS's half of 3.5% NJ mansion tax. Kevin Hetzel slow-walked competing offer. Soil clean (50-60 borings). All cash, corporate REIT.`,
    };
    const activityRef = ref(db, `${westampton.path}/${westampton.key}/activityLog`);
    const actSnap = await get(activityRef);
    const activityLog = actSnap.exists() ? actSnap.val() : [];
    const newLog = Array.isArray(activityLog) ? activityLog : Object.values(activityLog);
    newLog.push({
      date: now,
      action: 'Revised LOI sent — $3.5M (mansion tax adjustment)',
      details: 'Dan sent revised LOI increasing purchase price to $3.5M to compensate for PS\'s half of 3.5% NJ mansion tax. Extensive negotiation: started $2.8M, seller countered $3.6M, competing offer $3.5M with worse timing. Kevin Hetzel slow-walked other buyer. Soil clean (50-60 borings done 4 years ago). B1 zoning — storage by-right (only B1 parcel left in town).'
    });
    await update(ref(db, `${westampton.path}/${westampton.key}`), { ...updates, activityLog: newLog });
    console.log('  ✓ Updated price → $3,500,000 + activity log');
  } else {
    console.log('  ✗ NOT FOUND — will need manual entry');
  }

  console.log('\n[Done] Batch update complete.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
