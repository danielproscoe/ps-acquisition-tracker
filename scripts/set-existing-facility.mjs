#!/usr/bin/env node
/**
 * set-existing-facility.mjs — Flag a site as an existing facility for Value-Add Workup
 *
 * MVP helper — use until full UI lands on Submit Site form.
 *
 * Usage:
 *   node scripts/set-existing-facility.mjs <siteKey> [--tracker southwest|east|submissions]
 *
 * Then edit the patch object below, or pass fields via env vars:
 *   IP_CC=0.85 IP_DRIVE=0.55 OCC=0.82 CC_SF=60000 DRIVE_SF=20000 ASK=8500000 \
 *     node scripts/set-existing-facility.mjs <siteKey>
 *
 * After running, trigger an audit to populate the Value-Add Workup:
 *   node scripts/cc-rent-audit.mjs --site <siteKey>
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, update, get } from 'firebase/database';

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);

const args = process.argv.slice(2);
const siteKey = args.find(a => !a.startsWith('--'));
if (!siteKey) {
  console.log('Usage: node set-existing-facility.mjs <siteKey>');
  process.exit(1);
}
const trackerFlag = args.includes('--tracker') ? args[args.indexOf('--tracker') + 1] : null;

const existingFacility = {
  inPlaceCCRent: parseFloat(process.env.IP_CC || '0'),
  inPlaceDriveRent: parseFloat(process.env.IP_DRIVE || '0'),
  occupancy: parseFloat(process.env.OCC || '0.85'),
  ccSF: parseFloat(process.env.CC_SF || '0'),
  driveSF: parseFloat(process.env.DRIVE_SF || '0'),
  askingPrice: parseFloat(process.env.ASK || '0'),
  targetIRR: parseFloat(process.env.TARGET_IRR || '0.14'),
  repositioningLevel: process.env.REPOSITION || 'light',
  holdYears: parseInt(process.env.HOLD || '7'),
  flaggedAt: new Date().toISOString(),
  flaggedBy: 'set-existing-facility.mjs'
};

if (!existingFacility.inPlaceCCRent || !existingFacility.ccSF || !existingFacility.askingPrice) {
  console.log('ERROR: Set IP_CC, CC_SF, ASK (env vars) or pass via prompt');
  console.log('Example:');
  console.log('  IP_CC=0.85 IP_DRIVE=0.55 OCC=0.82 CC_SF=60000 DRIVE_SF=20000 ASK=8500000 node scripts/set-existing-facility.mjs <siteKey>');
  process.exit(1);
}

async function main() {
  let tracker = trackerFlag;
  if (!tracker) {
    for (const t of ['southwest', 'east', 'submissions']) {
      const snap = await get(ref(db, `${t}/${siteKey}`));
      if (snap.exists()) { tracker = t; break; }
    }
  }
  if (!tracker) { console.log(`Site ${siteKey} not found in any tracker`); process.exit(1); }

  const snap = await get(ref(db, `${tracker}/${siteKey}`));
  const site = snap.val();
  console.log(`Site: ${site.name} (${tracker})`);
  console.log(`Writing existingFacility:`, existingFacility);

  await update(ref(db, `${tracker}/${siteKey}`), { existingFacility });
  console.log(`\n✓ Written. Next step:`);
  console.log(`  GOOGLE_PLACES_API_KEY='<key>' node scripts/cc-rent-audit.mjs --site ${siteKey}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
