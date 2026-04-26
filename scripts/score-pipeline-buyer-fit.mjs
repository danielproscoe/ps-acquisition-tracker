#!/usr/bin/env node
/**
 * score-pipeline-buyer-fit.mjs
 *
 * Phase 3 of the PS DNA + Buyer-Routing Fit benchmarking engine.
 *
 * For every site in /east/, /southwest/, and /submissions/ this script:
 *   1. Computes the PortfolioFit score (PS DNA bell-curve) using public/ps-dna-profile.json
 *   2. Computes the BuyerFit ranked list (49 operators) using public/operator-matrix.json
 *   3. Writes back to Firebase
 *   4. Updates latestNote per CLAUDE.md §6h Step 2b (idempotent)
 *   5. Emits scripts/output/buyer-fit-score-{date}.json for validation/memo
 *
 * Engine logic mirrors src/portfolioFit.js + src/buyerFit.js verbatim
 * (inlined here because Node ESM scripts can't import the React-side .js
 * files without "type": "module" in package.json — which would break CRA).
 *
 * Usage:
 *   node scripts/score-pipeline-buyer-fit.mjs               # write-back live
 *   node scripts/score-pipeline-buyer-fit.mjs --dry-run     # report only
 *   node scripts/score-pipeline-buyer-fit.mjs --path east   # one tracker
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, update } from 'firebase/database';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');
const PATH_FILTER = (() => { const i = process.argv.indexOf('--path'); return i > 0 ? process.argv[i + 1] : null; })();

const firebaseConfig = {
  apiKey: 'AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk',
  authDomain: 'ps-pipeline-engine---djr---v1.firebaseapp.com',
  databaseURL: 'https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com',
  projectId: 'ps-pipeline-engine---djr---v1',
  storageBucket: 'ps-pipeline-engine---djr---v1.firebasestorage.app',
  messagingSenderId: '863337910082',
  appId: '1:863337910082:web:4cd6c9d38093a5177202db',
};

const dna = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/ps-dna-profile.json'), 'utf8'));
const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/operator-matrix.json'), 'utf8'));

// ─── PortfolioFit logic (mirror of src/portfolioFit.js) ───────────────────────

function classifyDensity(pop) {
  const n = Number(pop) || 0;
  if (n >= 80000) return 'urban';
  if (n >= 25000) return 'suburban';
  if (n >= 5000) return 'exurban';
  return 'rural';
}
function percentileRank(value, dist) {
  if (!dist || value == null || !isFinite(value)) return 50;
  if (value <= dist.min) return 0;
  if (value >= dist.max) return 100;
  const points = [[dist.min,0],[dist.p10,10],[dist.p25,25],[dist.p50,50],[dist.p75,75],[dist.p90,90],[dist.max,100]];
  for (let i = 1; i < points.length; i++) {
    if (value <= points[i][0]) {
      const [v0, p0] = points[i - 1], [v1, p1] = points[i];
      if (v1 === v0) return p0;
      return p0 + ((value - v0) / (v1 - v0)) * (p1 - p0);
    }
  }
  return 100;
}
function attributeFitScore(p) {
  if (p == null || !isFinite(p)) return 5;
  if (p >= 25 && p <= 75) return 10;
  if (p >= 15 && p <= 85) return 8;
  if (p >= 10 && p <= 90) return 6;
  if (p >= 5 && p <= 95) return 4;
  return 2;
}
function parseNum(v) {
  if (v == null || v === '') return NaN;
  const m = String(v).match(/-?[\d,.]+/);
  if (!m) return NaN;
  const n = parseFloat(m[0].replace(/,/g, ''));
  return isNaN(n) ? NaN : n;
}
const PF_WEIGHTS = { population: 0.20, income: 0.18, growth: 0.15, households: 0.10, homeValue: 0.10, renterPct: 0.10, nearestPS: 0.17 };

function computePortfolioFit(site, dnaProfile) {
  if (!dnaProfile?.subProfiles) return { score: 0, classification: 'NO DNA', density: null, attributes: {}, percentiles: {} };
  const pop3mi = parseNum(site.pop3mi), hhi3mi = parseNum(site.income3mi);
  const hh3mi = parseNum(site.households3mi), homeVal3mi = parseNum(site.homeValue3mi);
  const growth = parseNum(site.growthRate || site.popGrowth3mi);
  const renterPct = parseNum(site.renterPct3mi);
  const nearestPS = parseNum(site.siteiqData?.nearestPS);

  if (!isFinite(pop3mi) || pop3mi === 0) return { score: 0, classification: 'NO DATA', density: null, attributes: {}, percentiles: {} };
  const density = classifyDensity(pop3mi);
  const sub = dnaProfile.subProfiles[density];
  if (!sub?.distributions) return { score: 0, classification: 'NO DNA', density, attributes: {}, percentiles: {} };
  const d = sub.distributions;

  const safe = (v, dist) => isFinite(v) && dist ? percentileRank(v, dist) : null;
  const percentiles = {
    population: safe(pop3mi, d.pop3mi),
    income:     safe(hhi3mi, d.hhi3mi),
    growth:     safe(growth, d.growth),
    households: safe(hh3mi, d.households3mi),
    homeValue:  safe(homeVal3mi, d.homeValue3mi),
    renterPct:  safe(renterPct, d.renterPct),
    nearestPS:  safe(nearestPS, d.nearestSiblingMi),
  };
  const attributes = {};
  Object.entries(percentiles).forEach(([k, p]) => { attributes[k] = p == null ? null : attributeFitScore(p); });
  let weightedSum = 0, weightTotal = 0;
  Object.entries(attributes).forEach(([k, v]) => {
    if (v == null) return;
    const w = PF_WEIGHTS[k] || 0;
    weightedSum += v * w;
    weightTotal += w;
  });
  const score = weightTotal > 0 ? weightedSum / weightTotal : 0;
  let classification;
  if (score >= 8.0) classification = 'STRONG MATCH';
  else if (score >= 6.0) classification = 'GOOD MATCH';
  else if (score >= 4.0) classification = 'OK MATCH';
  else classification = 'POOR MATCH';
  return { score: Math.round(score * 100) / 100, classification, density, attributes, percentiles, dnaSubProfileSize: sub.count };
}

// ─── BuyerFit logic (mirror of src/buyerFit.js) ───────────────────────────────

const TIER_BASE = { TIER_1_HOT_CAPITAL: 7.5, TIER_2_ACTIVE: 6.5, TIER_3_MEDIUM: 5.5, TIER_4_SELECTIVE: 4.5, TIER_5_HYPER_LOCAL: 4.0 };
const STATE_REGION = {
  TX: ['Sunbelt','SE','South','Southwest'], FL: ['Sunbelt','SE','South'], GA: ['Sunbelt','SE','South'],
  AL: ['Sunbelt','SE','South'], NC: ['Sunbelt','SE','South'], SC: ['Sunbelt','SE','South'],
  TN: ['Sunbelt','SE','South'], MS: ['Sunbelt','SE','South'], AR: ['Sunbelt','SE','South'],
  LA: ['Sunbelt','SE','South'], KY: ['Midwest','SE'],
  IL: ['Midwest'], IN: ['Midwest'], OH: ['Midwest'], MI: ['Midwest'], WI: ['Midwest'],
  MN: ['Midwest'], IA: ['Midwest'], MO: ['Midwest'], KS: ['Midwest'], NE: ['Midwest'],
  ND: ['Midwest'], SD: ['Midwest'],
  NY: ['NE','Northeast'], NJ: ['NE','Northeast'], PA: ['NE','Northeast','Mid-Atlantic'],
  MA: ['NE','Northeast'], CT: ['NE','Northeast'], RI: ['NE','Northeast'], VT: ['NE','Northeast'],
  NH: ['NE','Northeast'], ME: ['NE','Northeast'], MD: ['NE','Mid-Atlantic'], DE: ['NE','Mid-Atlantic'],
  DC: ['NE','Mid-Atlantic'], VA: ['Mid-Atlantic','SE'], WV: ['Mid-Atlantic','Midwest'],
  AZ: ['Southwest','Sunbelt','West'], NM: ['Southwest','Sunbelt'], OK: ['Southwest','South'],
  NV: ['West','Southwest'], UT: ['West','Mountain'], CO: ['West','Mountain'], WY: ['West','Mountain'],
  MT: ['West','Mountain'], ID: ['West','Mountain'], CA: ['West'],
  OR: ['West','PNW'], WA: ['West','PNW'], AK: ['West'], HI: ['West'],
};
const TOP_50_MSA_STATES = new Set(['NY','CA','TX','FL','IL','PA','OH','GA','NC','MI','VA','WA','AZ','MA','TN','IN','MO','MD','WI','CO','MN','SC','AL','LA','KY','OR','OK','CT','UT','IA','NV','AR','MS','KS','NE']);

function classifyDealType(site) {
  if (site.dealType) return site.dealType;
  const sum = ((site.summary || '') + ' ' + (site.name || '') + ' ' + (site.phase || '')).toLowerCase();
  if (/portfolio/.test(sum)) return 'PORT';
  if (/c-of-o|c\/o|lease.?up/.test(sum)) return 'CO-LU';
  if (/conversion|repurpose|big.?box/.test(sum)) return 'CONV-VAN';
  if (/stabilized/.test(sum)) return 'EX-STAB';
  if (/value.?add/.test(sum) && /existing/.test(sum)) return 'EX-VAL';
  const z = (site.zoningClassification || '').toLowerCase();
  if (z === 'by-right' || z === 'permitted') return 'GU-ENT';
  return 'GU-RAW';
}
function dealTypeMatches(siteDT, opDTs) {
  if (!opDTs?.length) return true;
  const norm = (s) => String(s).toLowerCase().replace(/[\s\-_/]/g, '');
  const a = norm(siteDT);
  const aliasMap = {
    guraw: ['groundup','rawland','land','rawlandgroundup','guraw'],
    guent: ['groundup','groundupentitled','entitled','permitready','guent'],
    colu:  ['cofo','cofolease','leaseup','cleaseup','colu'],
    exval: ['existingvalueadd','valueadd','existing','valueaddexisting','exval'],
    exstab:['existingstabilized','stabilized','existing','classastabilized','exstab'],
    convbig:['conversion','bigboxconv','bigbox'],
    convvan:['conversion','vanilla'],
    port:['portfolio','portfolios','port'],
  };
  const aliases = aliasMap[a] || [a];
  for (const dt of opDTs) {
    const b = norm(dt);
    if (b === 'all' || b === 'any') return true;
    if (aliases.some(al => b.includes(al))) return true;
  }
  return false;
}
function geographyMatches(state, city, opGeo, op) {
  if (!state) return true;
  const st = state.toUpperCase(), cityLower = (city || '').toLowerCase();
  const regions = STATE_REGION[st] || [];
  // Unified geography set: uwProfile.geography + portfolio.geography + portfolio.concentrations
  const allGeo = [
    ...(opGeo || []),
    ...(op?.portfolio?.geography ? (Array.isArray(op.portfolio.geography) ? op.portfolio.geography : [op.portfolio.geography]) : []),
    ...(op?.portfolio?.concentrations || []),
  ];
  if (allGeo.length === 0) return true;
  if (allGeo.some(g => /nationwide/i.test(String(g)))) return true;
  for (const g of allGeo) {
    const gl = String(g).toLowerCase().trim();
    if (gl.length === 2 && gl.toUpperCase() === st) return true;
    const re = new RegExp(`(^|[^a-z])${st.toLowerCase()}([^a-z]|$)`);
    if (re.test(gl)) return true;
    if (regions.some(r => gl.includes(r.toLowerCase()))) return true;
    if (cityLower && gl.includes(cityLower)) return true;
  }
  return false;
}
function isPriceGateApplicable(dealType) {
  return dealType === 'EX-STAB' || dealType === 'EX-VAL' || dealType === 'CO-LU' || dealType === 'PORT';
}
function hardNoMatches(rule, site, dealType) {
  if (!rule) return false;
  const r = String(rule).toLowerCase();
  const acreage = parseNum(site.acreage), pop3mi = parseNum(site.pop3mi);
  const sf = parseNum(site.proposedNRSF || site.buildingSF), ccShare = parseNum(site.ccSharePct);
  if (/ground.?up/.test(r) && (dealType === 'GU-RAW' || dealType === 'GU-ENT')) return true;
  if (/land.?hard.?no/.test(r) && (dealType === 'GU-RAW' || dealType === 'GU-ENT')) return true;
  if (/rural/.test(r) && isFinite(pop3mi) && pop3mi < 5000) return true;
  if (/tertiary/.test(r) && isFinite(pop3mi) && pop3mi < 25000) return true;
  if ((/sub.?500k.?pop/.test(r) || /<500k/.test(r)) && isFinite(pop3mi) && pop3mi < 35000) return true;
  if ((/non.top.?50.?msa/.test(r) || /top.?50.?msa.?only/.test(r))) {
    const st = (site.state || '').toUpperCase();
    if (st && !TOP_50_MSA_STATES.has(st)) return true;
  }
  if (/sub.?2(\b|[^.])/.test(r) && isFinite(acreage) && acreage < 2) return true;
  if (/sub.?2\.5/.test(r) && isFinite(acreage) && acreage < 2.5) return true;
  if (/sub.?3\.5/.test(r) && isFinite(acreage) && acreage < 3.5) return true;
  if (/sub.?35k.?sf/.test(r) && isFinite(sf) && sf > 0 && sf < 35000) return true;
  if (/drive.?up.*secondary/.test(r) && isFinite(ccShare) && ccShare < 25) return true;
  if (/standalone.?drive.?up/.test(r) && isFinite(ccShare) && ccShare === 0) return true;
  if (/non.?dense.?submarket/.test(r) && isFinite(pop3mi) && pop3mi < 25000) return true;
  if (/ca.?only|california.?only/.test(r) && site.state !== 'CA') return true;
  return false;
}
function scoreCandidate(name, op, site, dealType) {
  const tier = op.tier || 'TIER_3_MEDIUM';
  const uw = op.uwProfile || {}, portfolio = op.portfolio || {};
  let score = TIER_BASE[tier] != null ? TIER_BASE[tier] : 5.0;
  const pressure = String(uw.deploymentPressure || '').toUpperCase();
  if (pressure.includes('VERY HIGH')) score += 0.6;
  else if (pressure.match(/\bHIGH\b/)) score += 0.4;
  else if (pressure.includes('MEDIUM')) score += 0.15;
  else if (pressure.includes('LOW')) score -= 0.2;
  const close = op.capital?.vintageClose ? new Date(op.capital.vintageClose + '-01') : null;
  if (close && !isNaN(close.getTime())) {
    const months = (Date.now() - close.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (months < 12) score += 0.4;
    else if (months < 24) score += 0.2;
  }
  const acreage = parseNum(site.acreage), ccShare = parseNum(site.ccSharePct);
  const productMix = String(uw.productMix || '').toLowerCase();
  if (isFinite(ccShare) && productMix.includes('cc')) {
    if (ccShare >= 50) score += 0.4; else if (ccShare >= 25) score += 0.2;
  }
  if (productMix.includes('multi-story') && isFinite(acreage) && acreage >= 2.5 && acreage <= 4) score += 0.3;
  if (productMix.includes('one-story') && isFinite(acreage) && acreage >= 3.5) score += 0.2;
  if (productMix.includes('class a') && site.zoningClassification === 'by-right') score += 0.15;
  const st = (site.state || '').toUpperCase();
  const concentrations = portfolio.concentrations || [];
  if (st && concentrations.some(c => String(c).toUpperCase().includes(st))) score += 0.5;
  const newMarkets = portfolio.newMarkets2026 || portfolio.newMarkets || [];
  if (newMarkets.some(m => String(m).toUpperCase().includes(st))) score += 0.6;
  const nearPS = parseNum(site.siteiqData?.nearestPS);
  if (isFinite(nearPS) && nearPS < 5 && name !== 'Public Storage') score += 0.15;
  const listingSrc = String(site.listingSource || '').toLowerCase();
  const offMkt = String(uw.offMarketPreference || '').toLowerCase();
  if (listingSrc.includes('off-market') && offMkt.includes('off')) score += 0.2;
  const hardNos = uw.hardNos || [];
  if (hardNos.some(r => /tertiary|rural|non.?dense/.test(String(r).toLowerCase()))) {
    if (parseNum(site.pop3mi) < 30000) score -= 0.2;
  }
  return Math.max(0, Math.min(10, score));
}
function applySpecialRules(ranked, site, dealType) {
  ranked = ranked.filter(c => !/brock/i.test(c.operator));
  const phase = String(site.phase || '').toLowerCase();
  const note = String(site.latestNote || site.summary || '').toLowerCase();
  const dwPassed = /dw.?pass|dw.?reject|passed.?per.?dw|dw.?dead|dw.?too.?rich/.test(phase + ' ' + note);
  if (dwPassed) {
    const sk = ranked.find(c => /storage king/i.test(c.operator));
    if (sk) sk.score = Math.min(10, sk.score + 0.6);
  }
  const st = (site.state || '').toUpperCase(), city = String(site.city || '').toLowerCase();
  const isDFW = st === 'TX' && /(dallas|fort worth|frisco|plano|mckinney|denton|allen|arlington|irving|grand prairie)/.test(city);
  if (isDFW && (dealType === 'GU-RAW' || dealType === 'GU-ENT')) {
    const ps = ranked.find(c => /^public storage$/i.test(c.operator));
    if (ps) ps.score = Math.max(0, ps.score - 0.5);
    ['SROA Capital','Metro Self Storage','Devon Self Storage'].forEach(n => {
      const o = ranked.find(c => c.operator === n);
      if (o) o.score = Math.min(10, o.score + 0.25);
    });
  }
  ranked.sort((a, b) => Math.abs(b.score - a.score) > 0.001 ? b.score - a.score : (a.hotCapitalRank || 99) - (b.hotCapitalRank || 99));
  return ranked;
}
function computeBuyerFit(site, m) {
  if (!m?.operators) return { topBuyer: null, ranked: [], rankedAll: [], hardGateFails: [], matrixSize: 0, classification: 'NO MATRIX' };
  const dealType = classifyDealType(site);
  const state = (site.state || '').toUpperCase(), city = String(site.city || '');
  const askingPrice = parseNum(site.askingPrice);
  const candidates = [], fails = [];
  let matrixSize = 0;
  for (const [name, op] of Object.entries(m.operators)) {
    if (name.endsWith('_META') || op.tier === 'DUPLICATE' || op.tier === 'ALIAS-SEE-StorageMart') continue;
    matrixSize++;
    if (op.tier === 'DO_NOT_ROUTE') { fails.push({ operator: name, reason: 'DO_NOT_ROUTE list' }); continue; }
    const uw = op.uwProfile || {};
    if (uw.dealTypes?.length && !dealTypeMatches(dealType, uw.dealTypes)) { fails.push({ operator: name, reason: `dealType ${dealType} mismatch` }); continue; }
    if (uw.geography && !geographyMatches(state, city, uw.geography, op)) { fails.push({ operator: name, reason: `state ${state || '?'} not in geography` }); continue; }
    const hitNo = (uw.hardNos || []).find(rule => hardNoMatches(rule, site, dealType));
    if (hitNo) { fails.push({ operator: name, reason: `hardNo: ${String(hitNo).slice(0, 60)}` }); continue; }
    if (isPriceGateApplicable(dealType) && isFinite(askingPrice) && askingPrice > 0) {
      if (uw.priceLow && askingPrice < uw.priceLow * 0.7) { fails.push({ operator: name, reason: 'price below floor' }); continue; }
      if (uw.priceHigh && askingPrice > uw.priceHigh * 1.3) { fails.push({ operator: name, reason: 'price above ceiling' }); continue; }
    }
    const score = scoreCandidate(name, op, site, dealType);
    candidates.push({
      operator: name,
      score: Math.round(score * 100) / 100,
      tier: op.tier,
      hotCapitalRank: op.hotCapitalRank || 99,
      pitchHook: op.pitchHook || null,
      pressure: uw.deploymentPressure || null,
    });
  }
  const ranked = applySpecialRules(candidates, site, dealType);
  const top7 = ranked.slice(0, 7), top = top7[0] || null;
  let classification, classColor;
  if (!top) { classification = 'NO FIT'; classColor = '#EF4444'; }
  else if (top.score >= 8.0) { classification = 'STRONG FIT'; classColor = '#22C55E'; }
  else if (top.score >= 6.5) { classification = 'GOOD FIT'; classColor = '#3B82F6'; }
  else if (top.score >= 5.0) { classification = 'OK FIT'; classColor = '#F59E0B'; }
  else { classification = 'WEAK FIT'; classColor = '#EF4444'; }
  return {
    dealType, topBuyer: top?.operator || null, topBuyerScore: top?.score || 0, topBuyerTier: top?.tier || null,
    classification, classColor, ranked: top7, rankedAll: ranked,
    hardGateFails: fails, matrixSize, survivors: ranked.length,
  };
}
function formatBuyerFitBlurb(fit) {
  if (!fit?.topBuyer) return null;
  const tierLabel = ({ TIER_1_HOT_CAPITAL: 'HOT CAPITAL', TIER_2_ACTIVE: 'ACTIVE', TIER_3_MEDIUM: 'MEDIUM', TIER_4_SELECTIVE: 'SELECTIVE', TIER_5_HYPER_LOCAL: 'HYPER-LOCAL' })[fit.topBuyerTier] || '';
  return `Top buyer: ${fit.topBuyer} ${fit.topBuyerScore.toFixed(1)}/10 (${tierLabel}). ${fit.survivors}/${fit.matrixSize} operators survive hard-gates.`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const trackers = PATH_FILTER ? [PATH_FILTER] : ['east', 'southwest', 'submissions'];
const stats = { total: 0, scored: 0, written: 0, skipped: 0, failed: 0, byTracker: {}, byTopBuyer: {}, byBuyerTier: {}, byPortfolioClass: {}, byBuyerClass: {}, pickedByTier: {} };
const records = [];

for (const tracker of trackers) {
  console.log(`\n=== Tracker: ${tracker} ===`);
  const snap = await get(ref(db, tracker));
  if (!snap.exists()) { console.log('  (empty)'); continue; }
  const data = snap.val(), keys = Object.keys(data);
  console.log(`  ${keys.length} sites`);
  stats.byTracker[tracker] = { total: keys.length, written: 0 };

  for (const id of keys) {
    const site = { id, ...data[id] };
    stats.total++;
    let pf, bf;
    try { pf = computePortfolioFit(site, dna); bf = computeBuyerFit(site, matrix); }
    catch (e) { stats.failed++; console.warn(`  ✗ ${id} score failed: ${e.message}`); continue; }
    stats.scored++;
    if (pf?.classification) stats.byPortfolioClass[pf.classification] = (stats.byPortfolioClass[pf.classification] || 0) + 1;
    if (bf?.classification) stats.byBuyerClass[bf.classification] = (stats.byBuyerClass[bf.classification] || 0) + 1;
    if (bf?.topBuyer) stats.byTopBuyer[bf.topBuyer] = (stats.byTopBuyer[bf.topBuyer] || 0) + 1;
    if (bf?.topBuyerTier) {
      stats.byBuyerTier[bf.topBuyerTier] = (stats.byBuyerTier[bf.topBuyerTier] || 0) + 1;
      stats.pickedByTier[bf.topBuyerTier] = (stats.pickedByTier[bf.topBuyerTier] || 0) + 1;
    }
    records.push({
      tracker, id,
      name: site.name || '', city: site.city || '', state: site.state || '',
      phase: site.phase || '', acreage: site.acreage || '',
      pop3mi: site.pop3mi || '', income3mi: site.income3mi || '',
      portfolioFitScore: pf?.score ?? null,
      portfolioFitClassification: pf?.classification || null,
      portfolioFitDensity: pf?.density || null,
      buyerFitDealType: bf?.dealType || null,
      buyerFitTopBuyer: bf?.topBuyer || null,
      buyerFitTopBuyerScore: bf?.topBuyerScore ?? null,
      buyerFitTopBuyerTier: bf?.topBuyerTier || null,
      buyerFitClassification: bf?.classification || null,
      buyerFitSurvivors: bf?.survivors ?? null,
      buyerFitTop3: (bf?.ranked || []).slice(0, 3).map(c => `${c.operator} ${c.score.toFixed(1)}`),
      latestNote: site.latestNote || null,
    });

    if (DRY) continue;

    const updates = {};
    if (pf && pf.classification !== 'NO DATA' && pf.classification !== 'NO DNA') {
      updates.portfolioFitScore = pf.score;
      updates.portfolioFitClassification = pf.classification;
      updates.portfolioFitDensity = pf.density;
    }
    if (bf?.topBuyer) {
      updates.buyerFitTopBuyer = bf.topBuyer;
      updates.buyerFitTopBuyerScore = bf.topBuyerScore;
      updates.buyerFitTopBuyerTier = bf.topBuyerTier;
      updates.buyerFitClassification = bf.classification;
      updates.buyerFitDealType = bf.dealType;
      updates.buyerFitSurvivors = bf.survivors;
      updates.buyerFitMatrixSize = bf.matrixSize;
      updates.buyerFitRanked = (bf.ranked || []).map(c => ({ operator: c.operator, score: c.score, tier: c.tier, hotCapitalRank: c.hotCapitalRank }));
      updates.buyerFitScoredAt = new Date().toISOString();
      const existing = String(site.latestNote || '');
      if (!/buyer.?fit|top buyer|routing engine/i.test(existing)) {
        const blurb = formatBuyerFitBlurb(bf);
        if (blurb) {
          updates.latestNote = existing ? `${existing.trim()} · ${blurb}` : blurb;
          updates.latestNoteDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
      }
    }
    if (Object.keys(updates).length === 0) { stats.skipped++; continue; }
    try {
      await update(ref(db, `${tracker}/${id}`), updates);
      stats.written++;
      stats.byTracker[tracker].written++;
      const fitTxt = pf ? `PF ${pf.score.toFixed(1)}` : 'PF —';
      const buyerTxt = bf?.topBuyer ? `→ ${bf.topBuyer} ${bf.topBuyerScore.toFixed(1)}` : '→ —';
      console.log(`  ✓ ${id.padEnd(22)} ${fitTxt}  ${buyerTxt}`);
    } catch (e) {
      stats.failed++;
      console.warn(`  ✗ ${id} write failed: ${e.message}`);
    }
  }
}

const stamp = new Date().toISOString().split('T')[0];
const outDir = path.join(ROOT, 'scripts', 'output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `buyer-fit-score-${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({ stats, records, scoredAt: new Date().toISOString(), dryRun: DRY }, null, 2));
console.log(`\nWrote ${outFile}`);
console.log('\n=== Summary ===');
console.log(`Total: ${stats.total} · Scored: ${stats.scored} · Written: ${stats.written}${DRY ? ' (DRY-RUN)' : ''} · Skipped: ${stats.skipped} · Failed: ${stats.failed}`);
console.log('\nTop-Buyer pick by tier:');
Object.entries(stats.pickedByTier).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${t.padEnd(20)} ${n}`));
console.log('\nTop 10 most-routed buyers:');
Object.entries(stats.byTopBuyer).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([op, n]) => console.log(`  ${op.padEnd(40)} ${n}`));
console.log('\nBuyerFit classification:');
Object.entries(stats.byBuyerClass).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${c.padEnd(20)} ${n}`));
process.exit(0);
