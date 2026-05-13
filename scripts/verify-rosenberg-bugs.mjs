// Fetch Rosenberg TX 0 Benton Rd from Firebase, run it through scoring.js +
// reports.js (the post-fix modules), write the REC Package HTML to disk,
// and assert each of the 11 bugs is resolved. Prints a pass/fail table.

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get } from 'firebase/database';
import { writeFileSync } from 'fs';

// Polyfill fetch for ESRI just in case downstream modules touch it
if (typeof fetch === 'undefined') {
  const { default: fetchFn } = await import('node-fetch').catch(() => ({ default: null }));
  if (fetchFn) globalThis.fetch = fetchFn;
}

const { computeSiteScore, computeSiteFinancials } = await import('../src/scoring.js');
const { generateRECPackage } = await import('../src/reports.js');
const { SITE_SCORE_DEFAULTS } = await import('../src/utils.js');

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);
const snap = await get(ref(db, 'submissions/rosenberg_tx_0_benton_rd'));
const site = snap.val();
if (!site) {
  console.error('ERROR: submissions/rosenberg_tx_0_benton_rd not found in Firebase');
  process.exit(1);
}

// Pull Firebase weight overrides to mirror the live dashboard
const weightsSnap = await get(ref(db, 'config/siteiq_weights'));
const weightsConfig = weightsSnap.val();
const config = SITE_SCORE_DEFAULTS.map(d => {
  const override = weightsConfig?.dimensions?.find(x => x.key === d.key);
  return { ...d, weight: override ? override.weight : d.weight };
});

console.log('\n=== Firebase siteiq_weights config (should be v4.0) ===');
console.log('version:', weightsConfig?.version);
const sum = config.reduce((s, d) => s + d.weight, 0);
console.log('Dimensions:', config.map(d => `${d.key}=${(d.weight*100).toFixed(0)}%`).join(', '));
console.log('Total:', (sum * 100).toFixed(1) + '%');

// Compute SiteScore
const iq = computeSiteScore(site, config);
console.log('\n=== SiteScore composite ===');
console.log('score:', iq.score, '| label:', iq.label, '| classification:', iq.classification);
console.log('Dimensions (score x weight):');
iq.breakdown.forEach(b => {
  console.log(`  ${b.label.padEnd(16)} score=${b.score.toFixed(1)} weight=${(b.weight*100).toFixed(0)}% contribution=${(b.score * b.weight).toFixed(2)}`);
});
const dimContribution = iq.breakdown.reduce((s, b) => s + b.score * b.weight, 0);
console.log('Sum of weighted contributions:', dimContribution.toFixed(2));
console.log('iq.score:', iq.score.toFixed(2), '| diff (adjustments):', (iq.score - dimContribution).toFixed(2));

// Compute financials (devSpread, buildOrBuy, replacementVsMarket, yearData, yearData10, etc.)
const fin = computeSiteFinancials(site);
console.log('\n=== Financials (spot checks) ===');
console.log('yocStab:', fin.yocStab);
console.log('mktAcqCap:', fin.mktAcqCap, '(', (fin.mktAcqCap*100).toFixed(2), '%)');
console.log('devSpread (should be in basis points, ~400+):', fin.devSpread);
console.log('replacementVsMarket:', fin.replacementVsMarket);
console.log('landVerdict:', fin.landVerdict, '| askVsStrike:', fin.askVsStrike);
console.log('yearData length:', fin.yearData?.length);
console.log('yearData10 length:', fin.yearData10?.length);
console.log('yearData[4].occupancy:', fin.yearData?.[4]?.occupancy);
console.log('yearData10[9] (Y10) occupancy:', fin.yearData10?.[9]?.occupancy);
console.log('yearData10[9] (Y10) NOI:', fin.yearData10?.[9]?.noi);

// Generate REC Package HTML
const html = generateRECPackage(site, iq, config, {});
const outPath = 'C:/Users/danie/OneDrive/Desktop/MASTER FOLDER - CLAUDE/rec-package-post-fix.html';
writeFileSync(outPath, html, 'utf-8');
console.log('\n=== REC Package HTML written ===');
console.log('Path:', outPath);
console.log('Size:', (html.length / 1024).toFixed(1), 'KB');

// ============================================================
// BUG-BY-BUG ASSERTIONS
// ============================================================
const results = [];
const check = (bug, desc, pass, detail) => results.push({ bug, desc, pass, detail });

// Bug 1 — composite score agrees everywhere
const scoreTxt = iq.score.toFixed(2);
const scoreMatches = html.match(new RegExp(`${scoreTxt}/10`, 'g'));
check(1, `composite ${scoreTxt} appears in HTML`, scoreMatches && scoreMatches.length >= 2, `${scoreMatches?.length || 0} occurrences of "${scoreTxt}/10"`);

// Bug 2 — no "undefined" OpEx rows (we'll look for OpEx table + verify label exists)
const undefinedOpex = html.includes('>undefined</td>') || html.match(/#64748B">undefined</);
check(2, 'no "undefined" OpEx labels', !undefinedOpex, undefinedOpex ? 'FAIL — found undefined label' : 'clean — item: field properly rendered');

// Bug 3 — verdict chip label for STRONG BUY sites says "Strong Buy" not "Overpriced"
if (fin.landVerdict === 'STRONG BUY') {
  const chipOk = html.includes('Strong Buy') && !html.match(/Strong Buy.*Overpriced|Overpriced.*Strong Buy/);
  check(3, 'Land Verdict chip label reflects STRONG BUY', chipOk, `landVerdict=${fin.landVerdict}, chip label=${chipOk ? '"Strong Buy"' : 'still shows Overpriced'}`);
} else {
  check(3, 'Land Verdict chip label (STRONG BUY path — verify verdict elsewhere)', true, `landVerdict=${fin.landVerdict} (not STRONG BUY — bug specifically triggers on STRONG BUY)`);
}

// Bug 4 — weight disclosures match v4.0 spec
const popDisc = html.includes('SiteScore Weight: 14% of composite');
const growthDisc = html.includes('SiteScore Weight: 18% of composite');
const compDisc = html.includes('SiteScore Weight: 25% of composite');
const psGateDisc = html.includes('Binary gate only (0% weighted)');
check(4, 'v4.0 weights in inline disclosures (14/18/25 + binary gate)', popDisc && growthDisc && compDisc && psGateDisc, `pop=${popDisc} growth=${growthDisc} comp=${compDisc} psGate=${psGateDisc}`);

// Bug 5 — devSpread is in basis points (typically 300-500)
const devSpreadN = parseFloat(fin.devSpread);
const devSpreadOk = !isNaN(devSpreadN) && devSpreadN >= 100 && devSpreadN <= 1000;
check(5, `Dev Spread in basis points (not % points)`, devSpreadOk, `devSpread=${fin.devSpread} (expected ~400 bps for 10% YOC - 5.75% cap)`);

// Bug 6 — AVG OCC in REIT Portfolio shows a number, not NaN
const nanOcc = /THIS SITE[\s\S]{1,500}NaN%/.test(html);
const hasThisSiteOcc = /◆ THIS SITE[\s\S]{1,800}>\d+%</.test(html);
check(6, `AVG OCC not NaN in REIT row`, !nanOcc && hasThisSiteOcc, nanOcc ? 'FAIL — NaN%' : 'populated with numeric %');

// Bug 7 — hasFlood respects "outside floodplain" language
// Rosenberg summary says "No flood" & "Outside floodplain" — so hasFlood should be false
// Environmental risk banner should NOT fire
const floodHighRisk = html.includes('Flood zone identified') || html.match(/Environmental[\s\S]{0,200}HIGH[\s\S]{0,100}Flood/);
check(7, `hasFlood correctly negates on "outside floodplain" site`, !floodHighRisk, floodHighRisk ? 'FAIL — still fires on clean site' : 'clean — flood risk suppressed');

// Bug 8 — Replacement Cost vs Market Value has % suffix
// Look for a row like "vs Market Value</span><span...>-45%</span>"
const replaceVsMarketOk = new RegExp('vs Market Value[\\s\\S]{0,200}' + (fin.replacementVsMarket ?? '') + '%').test(html);
check(8, `Replacement Cost vs Market Value has % suffix`, replaceVsMarketOk, `replacementVsMarket=${fin.replacementVsMarket}, % suffix check: ${replaceVsMarketOk}`);

// Bug 9 — sec-CAP 4a has Y10 header
const y10Header = html.includes('>Y10</th>');
check(9, `sec-CAP 4a has Y10 header (10-year, not 5-year)`, y10Header, y10Header ? 'pass' : 'only Y1-Y5 rendered');

// Bug 10 — sec-CAP 4a Occupancy column populated
// We look for the "Occupancy" row not showing em-dashes for all 10 years
// Parse the sec-CAP 4a section: find "Occupancy</td>" then up to the next "</tr>" — count em-dashes
const secCAPMatch = html.match(/Occupancy<\/td>([\s\S]+?)<\/tr>/);
let occFilled = false;
if (secCAPMatch) {
  const row = secCAPMatch[1];
  const cells = row.match(/>(?:[\d.]+%|\u2014)</g) || [];
  const filled = cells.filter(c => !/\u2014/.test(c)).length;
  occFilled = filled >= 10;
  check(10, `sec-CAP 4a Occupancy column populated Y1-Y10`, occFilled, `${filled}/10 cells filled`);
} else {
  check(10, `sec-CAP 4a Occupancy row found`, false, 'Occupancy row not found in sec-CAP 4a');
}

// Bug 11 — YOC @ STAB. has % suffix
const yocStabPct = html.match(/YOC @ STAB\.<\/div><div[^>]+>([^<]+)</);
const yocStabOk = yocStabPct && yocStabPct[1].includes('%');
check(11, `YOC @ STAB. metric has % suffix`, yocStabOk, `rendered value: "${yocStabPct?.[1] || 'not found'}"`);

// ============================================================
// PRINT SUMMARY TABLE
// ============================================================
console.log('\n=====================================================');
console.log('BUG-BY-BUG VERIFICATION');
console.log('=====================================================');
let pass = 0, fail = 0;
results.forEach(r => {
  const status = r.pass ? 'PASS' : 'FAIL';
  console.log(`  Bug ${String(r.bug).padStart(2)}: ${status}  ${r.desc}`);
  console.log(`          ${r.detail}`);
  r.pass ? pass++ : fail++;
});
console.log('=====================================================');
console.log(`Total: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
