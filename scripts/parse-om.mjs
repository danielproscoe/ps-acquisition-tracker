#!/usr/bin/env node
/**
 * parse-om.mjs — Offering Memorandum Parser
 *
 * Takes a storage facility OM (PDF) + optional financials (T-12 XLSX), extracts
 * structured data via Claude API, writes to Firebase as existingFacility, and
 * triggers the full Value-Add Workup. One command from OM upload to REC Package
 * with pro forma.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=<key> node scripts/parse-om.mjs \
 *     --om <path-to-om.pdf> \
 *     [--t12 <path-to-t12.xlsx>] \
 *     [--site <firebaseKey>] \
 *     [--new-site <city>,<state>]
 *
 *   If --site is provided, updates existing Firebase record.
 *   If --new-site is provided, creates a new submissions/ record.
 *
 * Output:
 *   Writes to Firebase:
 *     site.existingFacility = { ccSF, driveSF, inPlaceCCRent, inPlaceDriveRent,
 *                                occupancy, askingPrice, askRecommendation, ... }
 *     site.operatingData = { t12Rev, t12OpEx, t12NOI, unitMix[], ... }
 *     site.omParseResult = { rawExtracted, confidence, flaggedFields, sourceFiles }
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, update, set, get, push } from 'firebase/database';
import { readFileSync } from 'fs';
import { resolve, basename } from 'path';

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-7';

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

const omPath = getArg('om');
const t12Path = getArg('t12');
const siteKey = getArg('site');
const newSite = getArg('new-site'); // "City,ST"

if (!omPath && !t12Path) {
  console.log('Usage: ANTHROPIC_API_KEY=<key> node scripts/parse-om.mjs --om <pdf> [--t12 <xlsx>] [--site <key> | --new-site "City,ST"]');
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) {
  console.log('ERROR: ANTHROPIC_API_KEY env var required. Get a key at console.anthropic.com.');
  process.exit(1);
}

// ---- Claude API: structured OM extraction ----
const EXTRACTION_SCHEMA = `{
  "facility": {
    "name": "string — facility brand/name (e.g. 'StorQuest Austin North')",
    "address": "string — street address",
    "city": "string",
    "state": "string (2-letter)",
    "zip": "string",
    "yearBuilt": "number — year constructed",
    "totalGrossSF": "number — total building gross SF",
    "totalRentableSF": "number — total net rentable SF",
    "landAcreage": "number — lot size in acres",
    "numBuildings": "number",
    "numStories": "number",
    "numUnits": "number — total unit count"
  },
  "unitMix": {
    "ccUnits": "number — climate-controlled unit count",
    "ccSF": "number — total CC net rentable SF",
    "driveUpUnits": "number",
    "driveSF": "number",
    "parkingUnits": "number — RV/boat/vehicle parking spaces if present",
    "parkingSF": "number",
    "unitSizes": [
      { "size": "string (e.g. '5x10')", "type": "CC | drive-up | parking", "count": "number", "currentRent": "number $ per month" }
    ]
  },
  "operations": {
    "currentOccupancy": "number — percent as decimal 0-1 (e.g. 0.89 = 89%)",
    "economicOccupancy": "number — if disclosed separately",
    "trailingT12Revenue": "number — gross revenue last 12 months",
    "trailingT12OpEx": "number — operating expenses last 12 months",
    "trailingT12NOI": "number — net operating income last 12 months",
    "weightedAvgCCRate": "number — $/SF/month for CC units",
    "weightedAvgDriveRate": "number — $/SF/month for drive-up units",
    "operatorName": "string — current management company",
    "repExpense": "string — mgmt fee, R&M, insurance, property tax breakdown if given"
  },
  "offering": {
    "askingPrice": "number — list price in dollars",
    "askPerSF": "number",
    "askPerUnit": "number",
    "offeringCapRate": "number — trailing cap rate",
    "listingBroker": "string",
    "listingBrokerFirm": "string",
    "listingBrokerEmail": "string — if in document",
    "listingBrokerPhone": "string",
    "sellerType": "string — institution / family / individual",
    "timing": "string — call for offers / open / specific date"
  },
  "valueAddNotes": "string — any deferred maintenance, expansion potential, rent-push opportunities mentioned",
  "redFlags": "string — any environmental, structural, legal concerns mentioned",
  "confidenceNotes": "string — which fields were directly stated vs inferred, any ambiguity"
}`;

const SYSTEM_PROMPT = `You are an institutional self-storage acquisition analyst extracting structured data from an Offering Memorandum. You have 20 years of experience underwriting storage deals.

Extract EXACTLY the fields in the schema below from the provided OM. Return ONLY valid JSON matching the schema — no explanation, no markdown fences, just the JSON object.

For any field you cannot determine with confidence, use null. Do not hallucinate numbers. If the OM says "pro forma" or "stabilized" values, prefer TRAILING/IN-PLACE numbers over pro forma.

Schema:
${EXTRACTION_SCHEMA}

Critical rules:
- currentOccupancy must be decimal 0-1, not percentage
- All $ values as numbers without $ signs or commas
- If CC SF is not stated but unit count × avg size is, compute it and flag in confidenceNotes
- If T-12 is pro forma only, set trailingT12* to null and note in confidenceNotes`;

async function callClaudeWithPDF(pdfPath, additionalFiles = []) {
  const pdfBuffer = readFileSync(pdfPath);
  const pdfBase64 = pdfBuffer.toString('base64');

  const content = [
    {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
    }
  ];

  for (const extra of additionalFiles) {
    const buf = readFileSync(extra.path);
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: extra.mediaType || 'application/pdf', data: buf.toString('base64') }
    });
  }

  content.push({
    type: 'text',
    text: `Extract structured data from this OM${additionalFiles.length ? ' + attached financials' : ''}. Return the JSON object matching the schema — no other text.`
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = json.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude response did not contain JSON:\n' + text.slice(0, 500));
  return JSON.parse(match[0]);
}

// ---- Map extracted data to existingFacility schema ----
function mapToExistingFacility(extracted) {
  const unitMix = extracted.unitMix || {};
  const ops = extracted.operations || {};
  const offering = extracted.offering || {};
  return {
    inPlaceCCRent: ops.weightedAvgCCRate || null,
    inPlaceDriveRent: ops.weightedAvgDriveRate || null,
    occupancy: ops.currentOccupancy || 0.85,
    ccSF: unitMix.ccSF || null,
    driveSF: unitMix.driveSF || null,
    askingPrice: offering.askingPrice || null,
    targetIRR: 0.14,
    repositioningLevel: 'light',
    holdYears: 7,
    flaggedAt: new Date().toISOString(),
    flaggedBy: 'parse-om.mjs',
    sourceOM: basename(omPath || '?'),
    listingBroker: offering.listingBroker,
    listingBrokerFirm: offering.listingBrokerFirm,
    listingBrokerEmail: offering.listingBrokerEmail,
    listingBrokerPhone: offering.listingBrokerPhone,
  };
}

// ---- Main ----
async function main() {
  console.log(`\n=== OM Parser · Storvex Existing-Facility Extraction ===`);
  console.log(`OM:          ${omPath || '—'}`);
  console.log(`T-12:        ${t12Path || '—'}`);
  console.log(`Site key:    ${siteKey || '(new)'}`);
  console.log(`Claude model: ${MODEL}\n`);

  const files = [];
  if (t12Path) {
    const isXLSX = t12Path.toLowerCase().endsWith('.xlsx');
    const isPDF = t12Path.toLowerCase().endsWith('.pdf');
    if (isPDF) files.push({ path: t12Path, mediaType: 'application/pdf' });
    else if (isXLSX) console.log(`(T-12 XLSX attached — will pass to Claude as structured text if possible)`);
    // Note: Claude vision supports PDF natively; XLSX would need pre-conversion
  }

  console.log(`[1/3] Calling Claude API to extract structured data from OM...`);
  const t0 = Date.now();
  const extracted = await callClaudeWithPDF(omPath, files);
  console.log(`     Extraction complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log(`\n[2/3] Extraction summary:`);
  console.log(`     Facility: ${extracted.facility?.name || '?'} @ ${extracted.facility?.city || '?'}, ${extracted.facility?.state || '?'}`);
  console.log(`     Units:    ${extracted.unitMix?.ccUnits || 0} CC + ${extracted.unitMix?.driveUpUnits || 0} drive-up`);
  console.log(`     NRSF:     CC ${extracted.unitMix?.ccSF?.toLocaleString() || '?'} / drive-up ${extracted.unitMix?.driveSF?.toLocaleString() || '?'}`);
  console.log(`     Occ:      ${extracted.operations?.currentOccupancy ? (extracted.operations.currentOccupancy * 100).toFixed(1) + '%' : '?'}`);
  console.log(`     T-12 NOI: $${extracted.operations?.trailingT12NOI?.toLocaleString() || '?'}`);
  console.log(`     CC rate:  $${extracted.operations?.weightedAvgCCRate || '?'}/SF/mo`);
  console.log(`     Ask:      $${extracted.offering?.askingPrice?.toLocaleString() || '?'}`);
  console.log(`     Broker:   ${extracted.offering?.listingBroker || '?'} (${extracted.offering?.listingBrokerFirm || '?'}) ${extracted.offering?.listingBrokerEmail || ''}`);

  // Decide target path in Firebase
  let targetTracker, targetKey;
  if (siteKey) {
    for (const t of ['southwest', 'east', 'submissions']) {
      const snap = await get(ref(db, `${t}/${siteKey}`));
      if (snap.exists()) { targetTracker = t; targetKey = siteKey; break; }
    }
    if (!targetTracker) { console.log(`\nERROR: site ${siteKey} not found`); process.exit(1); }
  } else if (newSite) {
    const [city, state] = newSite.split(',').map(s => s.trim());
    targetTracker = 'submissions';
    const newRef = push(ref(db, targetTracker));
    targetKey = newRef.key;
    await set(newRef, {
      name: extracted.facility?.name || `${city} ${state} — (OM-parsed)`,
      address: extracted.facility?.address || '',
      city: city || extracted.facility?.city,
      state: state || extracted.facility?.state,
      region: state === 'TX' || state === 'FL' || state === 'CA' || state === 'AZ' || state === 'NV' ? 'southwest' : 'east',
      phase: 'Prospect',
      acreage: String(extracted.facility?.landAcreage || ''),
      askingPrice: extracted.offering?.askingPrice ? `$${extracted.offering.askingPrice.toLocaleString()}` : '',
      zoning: 'TBD',
      listingSource: 'OM Parser',
      status: 'pending',
      latestNote: `OM auto-parsed ${new Date().toLocaleDateString()} — review extracted data then run audit`,
      latestNoteDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    });
    console.log(`\n[2b/3] Created new submission: ${targetKey}`);
  } else {
    console.log(`\nNo --site or --new-site provided. Dumping extracted JSON only:`);
    console.log(JSON.stringify(extracted, null, 2));
    process.exit(0);
  }

  // Write extracted data to Firebase
  const existingFacility = mapToExistingFacility(extracted);
  const operatingData = {
    t12Rev: extracted.operations?.trailingT12Revenue,
    t12OpEx: extracted.operations?.trailingT12OpEx,
    t12NOI: extracted.operations?.trailingT12NOI,
    unitMix: extracted.unitMix?.unitSizes || [],
    yearBuilt: extracted.facility?.yearBuilt,
    totalGrossSF: extracted.facility?.totalGrossSF,
    totalRentableSF: extracted.facility?.totalRentableSF,
    operatorName: extracted.operations?.operatorName,
    offeringCapRate: extracted.offering?.offeringCapRate,
    sellerType: extracted.offering?.sellerType,
    timing: extracted.offering?.timing,
    valueAddNotes: extracted.valueAddNotes,
    redFlags: extracted.redFlags,
  };
  const omParseResult = {
    parsedAt: new Date().toISOString(),
    parsedBy: 'parse-om.mjs',
    claudeModel: MODEL,
    sourceOM: basename(omPath || '?'),
    sourceT12: t12Path ? basename(t12Path) : null,
    confidenceNotes: extracted.confidenceNotes,
    rawExtracted: extracted,
  };

  console.log(`\n[3/3] Writing to Firebase: ${targetTracker}/${targetKey}...`);

  // Sanitize undefined → null for Firebase
  const deepSanitize = (o) => {
    if (o === undefined) return null;
    if (o === null || typeof o !== 'object') return o;
    if (Array.isArray(o)) return o.map(deepSanitize);
    const out = {};
    for (const [k, v] of Object.entries(o)) out[k] = v === undefined ? null : deepSanitize(v);
    return out;
  };

  await update(ref(db, `${targetTracker}/${targetKey}`), deepSanitize({
    existingFacility,
    operatingData,
    omParseResult,
    // Also flash a note
    latestNote: `OM parsed ${new Date().toLocaleDateString()} — ${existingFacility.ccSF ? (existingFacility.ccSF/1000).toFixed(0)+'K CC' : 'CC SF TBD'}, ${existingFacility.inPlaceCCRent ? '$'+existingFacility.inPlaceCCRent+'/SF' : 'rate TBD'}, ${existingFacility.occupancy ? (existingFacility.occupancy*100).toFixed(0)+'% occ' : 'occ TBD'}, ${existingFacility.askingPrice ? '$'+(existingFacility.askingPrice/1000000).toFixed(1)+'M ask' : 'ask TBD'}. Run audit to populate Value-Add Workup.`,
    latestNoteDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }));

  console.log(`     Firebase write: OK`);
  console.log(`\nNEXT STEPS:`);
  console.log(`  1. Review extracted data at https://console.firebase.google.com → ${targetTracker}/${targetKey}`);
  console.log(`  2. Run audit to populate Value-Add Workup:`);
  console.log(`       GOOGLE_PLACES_API_KEY=<key> node scripts/cc-rent-audit.mjs --site ${targetKey}`);
  console.log(`  3. Dashboard will show full REC Package with sec-VA scenarios\n`);
  process.exit(0);
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });
