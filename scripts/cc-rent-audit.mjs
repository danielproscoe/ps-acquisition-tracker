#!/usr/bin/env node
/**
 * cc-rent-audit.mjs v1.2 — SiteScore Market Intel Engine
 *
 * McKinsey-grade CC rent ingestion + competitor verification.
 * Beats Radius by combining ESRI demographics + verified CC rates + CC-only
 * SPC filter + absorption math on a per-site basis.
 *
 * Pipeline (per site):
 *   1. Places API (New) nearbySearch: "storage" within 3 mi of site coords
 *   2. Filter non-self-storage (DCs, warehouses, freight yards)
 *   3. Classify each competitor as CC / non-CC via static + Puppeteer scrape
 *   4. Extract unit rates + count CC units per facility
 *   5. Recompute ccSPC using CC-only facilities + measured CC SF
 *   6. Compute market rent band (P25 / median / P75) for 10x10 CC
 *   7. Compute absorption metric with churn-adjusted demand
 *   8. Write ccRentData + ccSPC_verified + marketRentBand to Firebase
 *
 * v1.2 changes:
 *   - Puppeteer fallback for JS-rendered operator sites (Temple StoreMore, Creekview)
 *   - Per-facility CC SF measured from unit inventory, not assumed from market density
 *   - Churn-adjusted absorption (70% annual turnover on existing CC stock)
 *
 * Usage:
 *   node cc-rent-audit.mjs --site <firebaseKey>      # audit one site
 *   node cc-rent-audit.mjs --all                     # audit every active pipeline site
 *   node cc-rent-audit.mjs --pilot                   # Temple TX only (mmpi84dh0776)
 *   node cc-rent-audit.mjs --dry-run                 # compute but don't write Firebase
 *   node cc-rent-audit.mjs --no-puppeteer            # skip dynamic scrape (faster)
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, update } from 'firebase/database';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import puppeteer from 'puppeteer';
import { getSpareFootCompSet } from './sparefoot-scraper.mjs';
import { projectRentCurve, summarizeCurve } from './rent-projection.mjs';
import { generateIntelNarrative, generateIntelNarrativeLLM } from './intel-narrative.mjs';
import { runValueAddWorkup } from './value-add-analysis.mjs';

// ---- Firebase ----
const firebaseConfig = {
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ---- Google Places API (New) ----
const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || firebaseConfig.apiKey;
const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';

// ---- CLI args ----
const args = process.argv.slice(2);
const FLAGS = {
  site: args.includes('--site') ? args[args.indexOf('--site') + 1] : null,
  all: args.includes('--all'),
  pilot: args.includes('--pilot'),
  dryRun: args.includes('--dry-run'),
  noPuppeteer: args.includes('--no-puppeteer'),
};

const PILOT_SITE_KEY = 'mmpi84dh0776'; // Temple TX 4607 205 Loop

// ---- Constants ----
const SEARCH_RADIUS_M = 4828; // 3 miles
const NATIONAL_DEMAND_SF_PER_CAPITA = 7.5;
const CC_CHURN_RATE_ANNUAL = 0.70; // industry avg: 70% of CC units turn over annually
const CC_MARKET_SHARE = 0.50; // 50% of new storage demand goes CC in mixed markets
const AVG_UNIT_SF = 100; // when counting units, assume 100 SF avg (5x10-10x15 mix)
const CC_RATE_BAND_FALLBACK = { p25: 1.20, median: 1.50, p75: 1.80 };

const CC_FIRST_OPERATORS = [
  'public storage', 'extra space', 'cubesmart', 'life storage', 'istorage',
  'national storage affiliates', 'nsa', 'storquest', 'storage king',
  'prime storage', 'metro storage', 'u-haul moving & storage'
];
const DRIVE_UP_SIGNALS = [
  'mini storage', 'mini-storage', 'lock storage', 'all aboard', 'a-1 storage',
  'stop n store', 'secure self storage outdoor'
];
const NON_SELF_STORAGE_EXCLUSIONS = [
  // Retail/grocery distribution
  'walmart', 'h-e-b', 'heb ', 'mclane', 'costco', 'sam\'s club', 'target dc',
  'amazon', 'fedex', 'ups ', 'dhl', 'distribution center', 'fleet',
  'truck entrance', 'warehouse', 'fulfillment', 'cold storage',
  'wilsonart', 'artcobell', 'datamars', 'carpenter lp',
  // Freight / LTL / trucking
  'freight', 'r+l carriers', 'r+l ', 'carriers', 'logistics', 'trucking',
  'xpo ', 'schneider', 'estes', 'yrc ', 'old dominion', 'abf freight',
  'saia', 'con-way', 'roadrunner', 'averitt', 'forward air',
  'moving & truck', 'u-haul truck', 'penske', 'ryder',
  // Industrial / ag / other
  'grain elevator', 'silos', 'livestock', 'feed mill', 'tank farm',
  'wrecker', 'auto body', 'salvage', 'junk yard', 'scrap', 'recycling',
  'lumber yard', 'propane', 'oilfield', 'pipe yard', 'equipment rental',
  // Document / data storage (not self-storage)
  'record nations', 'iron mountain', 'access information', 'shred-it',
  'data center', 'server farm', 'colocation', 'document storage',
  'records center', 'file storage business'
];

// Positive storage brand whitelist — major self-storage operators by brand
const SELF_STORAGE_BRANDS = [
  'storage', 'self-storage', 'self storage', 'mini-storage', 'mini storage',
  'public storage', 'extra space', 'cubesmart', 'life storage', 'istorage',
  'nsa', 'national storage', 'storquest', 'storage king', 'prime storage',
  'u-haul moving & storage', 'smartstop', 'simply self', 'sparebox',
  'devon self', 'metro self', 'watson & taylor', 'sovran', 'uncle bob'
];

function isSelfStorage(name) {
  const n = (name || '').toLowerCase();
  for (const excl of NON_SELF_STORAGE_EXCLUSIONS) {
    if (n.includes(excl)) return false;
  }
  for (const brand of SELF_STORAGE_BRANDS) {
    if (n.includes(brand)) return true;
  }
  return false;
}

// ---- PS Family Registry (PS + iStorage + NSA) ----
// Per CLAUDE.md §6b: PS acquired iStorage and NSA. All three brands' locations
// count as PS-owned and are NOT competitors — they are PS portfolio. Exclude
// from competitor count; report separately as psAffiliateFamily.
const PS_FAMILY_REGISTRY = loadPSFamilyRegistry();

function loadPSFamilyRegistry() {
  const candidates = [
    resolve(process.cwd(), '../#2 - PS/Reference Files/PS_Locations_ALL.csv'),
    resolve(process.cwd(), '../../#2 - PS/Reference Files/PS_Locations_ALL.csv'),
    'C:/Users/danie/OneDrive/Desktop/MASTER FOLDER - CLAUDE/#2 - PS/Reference Files/PS_Locations_ALL.csv'
  ];
  const nsaCandidates = [
    resolve(process.cwd(), '../#2 - PS/Reference Files/NSA_Locations.csv'),
    resolve(process.cwd(), '../../#2 - PS/Reference Files/NSA_Locations.csv'),
    'C:/Users/danie/OneDrive/Desktop/MASTER FOLDER - CLAUDE/#2 - PS/Reference Files/NSA_Locations.csv'
  ];
  const locations = [];
  for (const paths of [candidates, nsaCandidates]) {
    for (const path of paths) {
      if (existsSync(path)) {
        const text = readFileSync(path, 'utf-8');
        const lines = text.split(/\r?\n/).slice(1);
        for (const line of lines) {
          if (!line.trim()) continue;
          const cols = line.split(',');
          if (cols.length < 8) continue;
          const lat = parseFloat(cols[6]);
          const lon = parseFloat(cols[7]);
          if (isNaN(lat) || isNaN(lon)) continue;
          const isNSA = path.includes('NSA');
          locations.push({
            name: cols[1],
            brand: isNSA ? (cols[1].includes('iStorage') ? 'iStorage' : 'NSA') : 'Public Storage',
            address: cols[2],
            city: cols[3],
            state: cols[4],
            lat,
            lon
          });
        }
        break;
      }
    }
  }
  return locations;
}

// Match Places result against PS family registry by coordinates (within ~150m)
function matchPSFamily(lat, lon) {
  const THRESHOLD_MI = 0.10; // ~500 ft — facilities often have multiple Places pins
  let closest = null;
  let closestDist = Infinity;
  for (const loc of PS_FAMILY_REGISTRY) {
    const d = distanceMi(lat, lon, loc.lat, loc.lon);
    if (d < THRESHOLD_MI && d < closestDist) {
      closest = loc;
      closestDist = d;
    }
  }
  return closest ? { ...closest, distanceMi: +closestDist.toFixed(3) } : null;
}

// Merge SpareFoot + Places competitor lists. SpareFoot is authoritative for
// classification + rates. Places fills gaps SpareFoot missed (unindexed operators).
function mergeCompetitorLists(spareFootList, placesList) {
  const merged = [];
  const spareFootByCoord = new Map();
  const MATCH_THRESHOLD_MI = 0.15;

  for (const sf of spareFootList) {
    merged.push({
      ...sf,
      primarySource: 'sparefoot',
      hasPlacesMatch: false
    });
    if (sf.lat && sf.lon) spareFootByCoord.set(`${sf.lat.toFixed(4)},${sf.lon.toFixed(4)}`, sf);
  }

  // Add Places facilities that SpareFoot doesn't have (matched by coord)
  for (const p of placesList) {
    let matched = false;
    for (const sf of merged) {
      if (!sf.lat || !sf.lon || !p.lat || !p.lon) continue;
      if (distanceMi(sf.lat, sf.lon, p.lat, p.lon) < MATCH_THRESHOLD_MI) {
        sf.hasPlacesMatch = true;
        sf.placesId = p.placeId;
        sf.placesName = p.name;
        matched = true;
        break;
      }
    }
    if (!matched) {
      merged.push({
        ...p,
        primarySource: 'places_only',
        rates: [],
        climateControl: null,
        driveUp: null,
        rateCount: 0,
        ccRateCount: 0
      });
    }
  }

  return merged;
}

// ---- Global Puppeteer browser (reused across facilities) ----
let _browser = null;
async function getBrowser() {
  if (_browser) return _browser;
  _browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  return _browser;
}
async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
  }
}

// ---- Places API: enumerate competitors ----
async function enumerateCompetitors(lat, lon) {
  const body = {
    includedTypes: ['storage'],
    maxResultCount: 20,
    locationRestriction: {
      circle: { center: { latitude: lat, longitude: lon }, radius: SEARCH_RADIUS_M }
    }
  };
  const res = await fetch(PLACES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.websiteUri,places.primaryType,places.types'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Places API ${res.status}: ${err}`);
  }
  const json = await res.json();
  return (json.places || []).map(p => ({
    placeId: p.id,
    name: p.displayName?.text || 'Unknown',
    address: p.formattedAddress,
    lat: p.location?.latitude,
    lon: p.location?.longitude,
    website: p.websiteUri,
    primaryType: p.primaryType,
    types: p.types || []
  }));
}

function distanceMi(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---- Parse unit rates + CC signals from rendered HTML ----
function parseRatesFromHTML(html) {
  const lower = html.toLowerCase();
  const hasCCMention = /climate[- ]controlled|climate[- ]control|temperature[- ]controlled/.test(lower);
  const hasDriveUpOnlyMention = /drive[- ]up only|outdoor only|non[- ]climate/.test(lower);

  const rates = [];
  // Pattern 1: "10' x 10' Climate Controlled $159/mo" or "10x10 CC $159"
  const patternWithType = /(\d{1,2})\s*['"]?\s*[xX×]\s*(\d{1,2})\s*['"]?\s*(?:climate[- ]controlled|climate|cc|non[- ]?cc|drive[- ]?up|outdoor|indoor)?[^\$\n]{0,120}\$\s*(\d{2,4}(?:\.\d{2})?)/gi;
  let m;
  while ((m = patternWithType.exec(html)) !== null) {
    const w = parseInt(m[1]), h = parseInt(m[2]);
    if (w < 3 || h < 3 || w > 50 || h > 50) continue;
    const sf = w * h;
    const context = m[0].toLowerCase();
    let type = 'unknown';
    if (/climate|cc|indoor/.test(context)) type = 'CC';
    else if (/drive[- ]?up|outdoor|non[- ]?cc/.test(context)) type = 'non_CC';
    const rate = parseFloat(m[3]);
    if (rate < 20 || rate > 2000) continue;
    rates.push({ size: `${w}x${h}`, sf, type, rate, ratePerSf: +(rate / sf).toFixed(3) });
  }

  return { hasCCMention, hasDriveUpOnlyMention, rates: dedupeRates(rates) };
}

function dedupeRates(rates) {
  const seen = new Map();
  for (const r of rates) {
    const key = `${r.size}|${r.type}`;
    if (!seen.has(key) || seen.get(key).rate > r.rate) seen.set(key, r);
  }
  return [...seen.values()];
}

// ---- Static fetch scrape ----
async function scrapeStatic(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    return { html, method: 'static' };
  } catch (e) {
    return null;
  }
}

// ---- Puppeteer dynamic scrape for JS-rendered sites ----
async function scrapeDynamic(url) {
  if (FLAGS.noPuppeteer) return null;
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    // Give React/Next one extra beat to hydrate + fetch rates from API
    await new Promise(r => setTimeout(r, 2500));
    // Many operator sites have a "View all sizes" tab — try to click it
    try {
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button,a,[role="tab"]')];
        for (const b of btns) {
          const t = (b.textContent || '').toLowerCase();
          if (t.includes('all sizes') || t.includes('view sizes') || t.includes('unit sizes') || t.includes('see all')) {
            b.click();
          }
        }
      });
      await new Promise(r => setTimeout(r, 1500));
    } catch {}
    const html = await page.content();
    await page.close();
    return { html, method: 'puppeteer' };
  } catch (e) {
    if (page) try { await page.close(); } catch {}
    return { error: e.message, method: 'puppeteer' };
  }
}

// ---- Unified facility scrape: static first, puppeteer fallback ----
// Fall back to Puppeteer whenever static yields fewer than 3 rates — rate count
// is the goal. CC mention alone doesn't satisfy the rate-extraction objective.
async function scrapeFacility(url) {
  const staticResult = await scrapeStatic(url);
  const staticParsed = staticResult?.html ? parseRatesFromHTML(staticResult.html) : null;

  // If static got 3+ rates, we're done
  if (staticParsed && staticParsed.rates.length >= 3) {
    return { ...staticParsed, method: 'static', url };
  }

  // Else fall back to Puppeteer — the goal is rate data, not just CC mention
  if (!FLAGS.noPuppeteer) {
    const dynResult = await scrapeDynamic(url);
    if (dynResult?.html) {
      const dynParsed = parseRatesFromHTML(dynResult.html);
      // Merge: keep CC mention from either source, prefer whichever has more rates
      const rates = dynParsed.rates.length >= (staticParsed?.rates.length || 0) ? dynParsed.rates : staticParsed?.rates || [];
      return {
        hasCCMention: dynParsed.hasCCMention || staticParsed?.hasCCMention || false,
        hasDriveUpOnlyMention: dynParsed.hasDriveUpOnlyMention || staticParsed?.hasDriveUpOnlyMention || false,
        rates,
        method: dynParsed.rates.length > 0 ? 'puppeteer' : (staticParsed?.hasCCMention ? 'static+pup-noop' : 'both-empty'),
        url
      };
    }
  }
  if (staticParsed) return { ...staticParsed, method: 'static', url };
  return { hasCCMention: false, hasDriveUpOnlyMention: false, rates: [], method: 'failed', url };
}

// ---- Classify competitor ----
async function classifyCompetitor(comp) {
  const nameLower = (comp.name || '').toLowerCase();
  const isCCOperator = CC_FIRST_OPERATORS.some(op => nameLower.includes(op));
  const isDriveUpBrand = DRIVE_UP_SIGNALS.some(sig => nameLower.includes(sig));

  let classification = 'unknown';
  let confidence = 'low';
  let ccIndicators = [];
  let rateData = null;
  let scrapeMethod = null;

  if (isCCOperator && !isDriveUpBrand) {
    classification = 'cc_likely';
    confidence = 'medium';
    ccIndicators.push('known CC-first operator brand');
  } else if (isDriveUpBrand) {
    classification = 'non_cc_likely';
    confidence = 'medium';
    ccIndicators.push('drive-up brand signal in name');
  }

  if (comp.website) {
    try {
      const scraped = await scrapeFacility(comp.website);
      scrapeMethod = scraped.method;
      if (scraped.hasCCMention) {
        classification = 'cc_confirmed';
        confidence = 'high';
        ccIndicators.push(`website mentions "climate controlled" (${scraped.method})`);
      } else if (scraped.hasDriveUpOnlyMention) {
        classification = 'non_cc_confirmed';
        confidence = 'high';
        ccIndicators.push(`website confirms drive-up only (${scraped.method})`);
      }
      if (scraped.rates?.length) rateData = scraped.rates;
    } catch (e) {
      ccIndicators.push(`scrape failed: ${e.message.slice(0, 60)}`);
    }
  }

  return {
    ...comp,
    classification,
    confidence,
    ccIndicators,
    rateData,
    scrapeMethod,
    isCC: classification === 'cc_confirmed' || classification === 'cc_likely'
  };
}

// ---- Estimate per-facility CC SF from unit inventory ----
// Scraping reveals DISTINCT SIZE TILES, not unit counts. A facility with 8
// CC size tiles does NOT have 8 × 30 × (avg SF) square feet — the mean unit SF
// is pulled up hard by a handful of 20×20 tiles. Proper approach:
//   (1) assume ~25 units per size tile (small-midsize operator average)
//   (2) cap the avg unit SF at 100 SF (the 10×10 benchmark — most storage
//       inventory by unit count is in the 5×5 to 10×10 range, with a long tail
//       of larger units at lower volume)
//   (3) bound the final facility SF at 80K (realistic max for suburban CC single-story)
function estimateFacilityCCSF(comp) {
  if (!comp.rateData || comp.rateData.length === 0) {
    return { ccSF: null, method: 'fallback', confidence: 'low' };
  }
  const ccUnits = comp.rateData.filter(r => r.type === 'CC' || comp.isCC);
  if (ccUnits.length === 0) {
    return { ccSF: 0, method: 'scraped-no-cc', confidence: 'high' };
  }
  const unitsPerSize = 25;
  const capSFPerUnit = 100;
  // Use each unit's actual SF but cap at 100 — prevents 20x20 tiles from skewing
  const cappedUnitSF = ccUnits.map(u => Math.min(u.sf, capSFPerUnit));
  const meanCappedSF = cappedUnitSF.reduce((s, v) => s + v, 0) / cappedUnitSF.length;
  const rawCCSF = ccUnits.length * unitsPerSize * meanCappedSF;
  const ccSF = Math.min(Math.round(rawCCSF), 80000);
  return {
    ccSF,
    method: 'unit-inventory-capped',
    confidence: 'medium',
    detail: `${ccUnits.length} CC sizes × ${unitsPerSize} units × ${meanCappedSF.toFixed(0)} SF capped (raw ${Math.round(rawCCSF).toLocaleString()}, capped at 80K)`
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// IN-PLACE RENT ADJUSTMENT — Converts scraped street rates into Radius/Yardi-
// equivalent market rates by applying industry-standard ECRI overlay.
// ═══════════════════════════════════════════════════════════════════════════
//
// Street rate = what a NEW customer pays today (what SpareFoot shows)
// Market rent = weighted avg of street + ECRI-bumped in-place tenants
//
// Calibrated to PSA/EXR/CUBE 10-K disclosures:
//   • Avg customer tenure: 22-24 months (SSA)
//   • ECRI events: every 6-12 mo (REIT), 18-24 mo (independent)
//   • ECRI magnitude: 8% (PSA avg), 5% (independent avg)
//
// At stabilized occupancy, rent roll mix:
//   30% at street · 30% at street×1.08 · 25% at street×1.166 · 15% at street×1.26
//   Weighted avg = 1.109 for REIT-operated
const IN_PLACE_MULTIPLIERS = {
  REIT_HEAVY: 1.11,
  MIXED: 1.09,
  INDEPENDENT_HEAVY: 1.06,
  PROMO_ADJUSTMENT: 1.03,
};

function inferOperatorMix(competitors) {
  if (!competitors?.length) return { tier: 'MIXED', reason: 'default — no comp data', reitCount: 0, total: 0 };
  const REIT_BRANDS = /public storage|extra space|cubesmart|life storage|istorage|national storage affiliates|nsa|storquest|u-haul moving/i;
  const real = competitors.filter(c => !c.isPSFamily); // exclude PS family per §6b
  const reitCount = real.filter(c => REIT_BRANDS.test(c.name || '')).length;
  const total = real.length;
  if (total === 0) return { tier: 'MIXED', reason: 'no real competitors', reitCount: 0, total: 0 };
  const reitShare = reitCount / total;
  if (reitShare >= 0.5) return { tier: 'REIT_HEAVY', reason: `${reitCount} of ${total} are REIT brands (${(reitShare*100).toFixed(0)}%)`, reitCount, total };
  if (reitShare <= 0.2) return { tier: 'INDEPENDENT_HEAVY', reason: `${reitCount} of ${total} are REIT brands (${(reitShare*100).toFixed(0)}% — indie-dominated)`, reitCount, total };
  return { tier: 'MIXED', reason: `${reitCount} of ${total} are REIT brands (${(reitShare*100).toFixed(0)}% — mixed)`, reitCount, total };
}

function detectPromoSample(competitors) {
  const rates = (competitors || []).flatMap(c => c.rateData || []).filter(r => r && (r.discountPct || r.salePct));
  if (rates.length < 3) return { promoHeavy: false, avgDiscount: 0 };
  const avgDiscount = rates.reduce((s, r) => s + (r.discountPct || r.salePct || 0), 0) / rates.length;
  return { promoHeavy: avgDiscount > 10, avgDiscount: +avgDiscount.toFixed(1) };
}

function applyInPlaceAdjustment(streetBand, competitors) {
  if (!streetBand || streetBand.p25 == null) return null;
  const mix = inferOperatorMix(competitors);
  const promo = detectPromoSample(competitors);
  let multiplier = IN_PLACE_MULTIPLIERS[mix.tier];
  if (promo.promoHeavy) multiplier *= IN_PLACE_MULTIPLIERS.PROMO_ADJUSTMENT;
  return {
    p25: +(streetBand.p25 * multiplier).toFixed(3),
    median: +(streetBand.median * multiplier).toFixed(3),
    p75: +(streetBand.p75 * multiplier).toFixed(3),
    sampleSize: streetBand.sampleSize,
    methodology: {
      multiplier: +multiplier.toFixed(3),
      operatorMix: mix.tier,
      operatorMixReason: mix.reason,
      promoHeavy: promo.promoHeavy,
      avgPromoDiscount: promo.avgDiscount,
      source: `Street-rate median × ${multiplier.toFixed(3)} ECRI overlay (${mix.tier.toLowerCase().replace('_', '-')} operator mix${promo.promoHeavy ? ', promo-adjusted' : ''})`
    },
    description: `Radius/Yardi-equivalent market rent — street rate adjusted for in-place ECRI-bumped tenants at stabilized ${mix.tier.toLowerCase().replace('_', '-')} occupancy mix.`
  };
}

// ---- Market rent band — returns both CC-specific and market-wide bands ----
// Accepts optional wideRateSource (SpareFoot 5mi) for bigger sample
function computeMarketRentBand(competitors, wideRates = []) {
  const ccRatesTenByTen = [];
  const ccRatesAllSizes = [];
  const nonCCRatesTenByTen = [];
  const nonCCRatesAllSizes = [];
  const allRatesAllSizes = [];

  const collectFrom = (rates, facilityIsCC) => {
    for (const r of rates) {
      if (!r.ratePerSf || !r.sf) continue;
      const isCC = r.type === 'CC' || (r.type !== 'non_CC' && facilityIsCC === true);
      const isNonCC = r.type === 'non_CC' || (r.type !== 'CC' && facilityIsCC === false);
      const isTenByTen = r.size === '10x10';
      const isCoreSize = r.sf >= 50 && r.sf <= 200;
      if (isCC && isTenByTen) ccRatesTenByTen.push(r.ratePerSf);
      if (isCC && isCoreSize) ccRatesAllSizes.push(r.ratePerSf);
      if (isNonCC && isTenByTen) nonCCRatesTenByTen.push(r.ratePerSf);
      if (isNonCC && isCoreSize) nonCCRatesAllSizes.push(r.ratePerSf);
      if (isCoreSize) allRatesAllSizes.push(r.ratePerSf);
    }
  };

  for (const c of competitors) {
    collectFrom(c.rateData || [], c.isCC);
  }
  for (const r of wideRates) {
    collectFrom([r], r.facilityIsCC);
  }

  const pct = (arr, p) => arr.length === 0 ? null : arr.sort((a, b) => a - b)[Math.max(0, Math.min(arr.length - 1, Math.floor(arr.length * p)))];

  // CC band: prefer 10x10 sample ≥3, fall back to all core sizes
  const ccSample = ccRatesTenByTen.length >= 3 ? ccRatesTenByTen
    : ccRatesAllSizes.length >= 3 ? ccRatesAllSizes
    : null;
  const nonCCSample = nonCCRatesTenByTen.length >= 3 ? nonCCRatesTenByTen
    : nonCCRatesAllSizes.length >= 3 ? nonCCRatesAllSizes
    : null;

  const ccBand = ccSample ? {
    p25: +pct(ccSample, 0.25).toFixed(3),
    median: +pct(ccSample, 0.5).toFixed(3),
    p75: +pct(ccSample, 0.75).toFixed(3),
    sampleSize: ccSample.length,
    tenByTenCount: ccRatesTenByTen.length,
    source: `${ccSample.length} CC rates (50-200 SF)`
  } : null;

  const nonCCBand = nonCCSample ? {
    p25: +pct(nonCCSample, 0.25).toFixed(3),
    median: +pct(nonCCSample, 0.5).toFixed(3),
    p75: +pct(nonCCSample, 0.75).toFixed(3),
    sampleSize: nonCCSample.length,
    source: `${nonCCSample.length} non-CC rates (50-200 SF)`
  } : null;

  const marketBand = allRatesAllSizes.length >= 3 ? {
    p25: +pct(allRatesAllSizes, 0.25).toFixed(3),
    median: +pct(allRatesAllSizes, 0.5).toFixed(3),
    p75: +pct(allRatesAllSizes, 0.75).toFixed(3),
    sampleSize: allRatesAllSizes.length,
    source: `${allRatesAllSizes.length} market rates (all types, 50-200 SF)`
  } : null;

  // Radius/Yardi-equivalent market rent bands — street rate + ECRI overlay
  const ccMarketEquivalentBand = applyInPlaceAdjustment(ccBand, competitors);
  const nonCCMarketEquivalentBand = applyInPlaceAdjustment(nonCCBand, competitors);

  return {
    // Primary: CC band (preferred for subject site underwriting)
    ...(ccBand || marketBand || CC_RATE_BAND_FALLBACK),
    sampleSize: (ccBand || marketBand)?.sampleSize || 0,
    source: ccBand?.source || marketBand?.source || 'fallback (insufficient rates)',
    // Extras for disclosure
    ccBand,                         // STREET rate band (what a new customer pays today — SpareFoot raw)
    ccMarketEquivalentBand,         // RADIUS/YARDI-equivalent rate band (street + ECRI overlay)
    nonCCBand,
    nonCCMarketEquivalentBand,
    marketBand,
    samples: {
      ccTenByTen: ccRatesTenByTen.length,
      ccAllSizes: ccRatesAllSizes.length,
      nonCCTenByTen: nonCCRatesTenByTen.length,
      nonCCAllSizes: nonCCRatesAllSizes.length,
      allSizes: allRatesAllSizes.length
    }
  };
}

// ---- Churn-adjusted absorption ----
function computeAbsorption(site, existingCCSF, pipelineSF) {
  const pop = parseInt(String(site.pop3mi || '0').replace(/[^0-9]/g, '')) || 0;
  const growthPct = parseFloat(String(site.growthRate || '0').replace(/[^0-9.-]/g, '')) || 0;
  if (pop === 0) return null;

  // Organic demand from population growth
  const growthDemandSF = pop * NATIONAL_DEMAND_SF_PER_CAPITA * (growthPct / 100) * CC_MARKET_SHARE;
  // Churn demand: existing CC stock turns over at ~70%/yr; new tenants create absorption
  // opportunity for new supply as rates/location competition shifts tenants
  const churnDemandSF = existingCCSF * CC_CHURN_RATE_ANNUAL * 0.15; // 15% of churned tenants are net-new to market
  const totalAnnualDemand = growthDemandSF + churnDemandSF;

  const monthsToAbsorb = pipelineSF > 0 && totalAnnualDemand > 0
    ? +((pipelineSF / totalAnnualDemand) * 12).toFixed(1)
    : null;

  return {
    growthDemandSF: Math.round(growthDemandSF),
    churnDemandSF: Math.round(churnDemandSF),
    totalAnnualDemandSF: Math.round(totalAnnualDemand),
    pipelineSF,
    monthsToAbsorb,
    verdict: monthsToAbsorb == null ? 'no pipeline'
      : monthsToAbsorb < 18 ? 'healthy — pipeline absorbs in <18 mo'
      : monthsToAbsorb < 36 ? 'watch — 18-36 mo absorption'
      : 'flood risk — >36 mo to absorb pipeline'
  };
}

// ---- Load / parse site ----
async function loadSite(firebaseKey) {
  for (const tracker of ['southwest', 'east', 'submissions']) {
    const snap = await get(ref(db, `${tracker}/${firebaseKey}`));
    if (snap.exists()) return { tracker, key: firebaseKey, data: snap.val() };
  }
  return null;
}

function parseCoords(coordStr) {
  if (!coordStr) return null;
  const m = String(coordStr).match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
}

function parsePipelineSF(field) {
  if (!field) return 0;
  const s = String(field);
  const sfMatch = s.match(/([\d,]+)\s*(?:SF|sqft|sf|square feet)/i);
  if (sfMatch) return parseInt(sfMatch[1].replace(/,/g, '')) || 0;
  const kMatch = s.match(/(\d+(?:\.\d+)?)\s*K\s*(?:SF|sqft|sf)?/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  return 0;
}

// ---- Per-site audit ----
async function auditSite(firebaseKey) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`AUDIT: ${firebaseKey}`);
  console.log('='.repeat(80));

  const record = await loadSite(firebaseKey);
  if (!record) { console.log('  SKIP: not found'); return null; }
  const { tracker, data: site } = record;
  console.log(`  Site: ${site.name}`);
  console.log(`  Tracker: ${tracker}`);

  const coords = parseCoords(site.coordinates);
  if (!coords) { console.log('  SKIP: no valid coordinates'); return null; }
  console.log(`  Coords: ${coords.lat}, ${coords.lon}`);

  // 1a. SpareFoot comp set — 5mi radius for rate band (wider sample), 3mi for competition
  console.log(`\n  [1/7] SpareFoot comp set (primary source — rates + per-unit CC)...`);
  const city = site.city || '';
  const state = site.state || '';
  const zip = (site.address || '').match(/\b\d{5}\b/)?.[0] || '';
  let spareFoot = { facilities: [], marketSummary: {} };
  let spareFootWide = { facilities: [], marketSummary: {} };
  try {
    // 3mi for competition count + CC SPC
    spareFoot = await getSpareFootCompSet({ city, state, zip, lat: coords.lat, lon: coords.lon, radiusMi: 3 });
    // 5mi for rent band sample (submarket-wide)
    spareFootWide = await getSpareFootCompSet({ city, state, zip, lat: coords.lat, lon: coords.lon, radiusMi: 5 });
    console.log(`    SpareFoot 3mi: ${spareFoot.facilities.length} facilities, ${spareFoot.marketSummary.totalRateCount || 0} rates`);
    console.log(`    SpareFoot 5mi (wider rent-band sample): ${spareFootWide.facilities.length} facilities, ${spareFootWide.marketSummary.totalRateCount || 0} rates`);
  } catch (e) {
    console.log(`    SpareFoot error: ${e.message.slice(0, 120)}`);
  }

  // 1b. Places API (secondary — catch facilities SpareFoot missed)
  console.log(`  [1b/7] Places API (secondary — gap filler)...`);
  let placesResults = [];
  try {
    placesResults = await enumerateCompetitors(coords.lat, coords.lon);
    placesResults = placesResults
      .map(c => ({ ...c, distanceMi: +distanceMi(coords.lat, coords.lon, c.lat, c.lon).toFixed(2) }))
      .filter(c => c.distanceMi <= 3.0)
      .filter(c => isSelfStorage(c.name));
  } catch (e) {
    console.log(`    Places error: ${e.message.slice(0, 120)}`);
  }

  // Merge — SpareFoot authoritative, Places fills gaps
  let competitors = mergeCompetitorLists(spareFoot.facilities, placesResults);
  console.log(`    Merged comp set: ${competitors.length} (${spareFoot.facilities.length} from SpareFoot, ${competitors.filter(c => c.primarySource === 'places_only').length} Places-only)`);

  // 2. PS Family tag via coord match
  console.log(`\n  [2/7] PS Family (PS + iStorage + NSA) coord match...`);
  for (const c of competitors) {
    if (!c.lat || !c.lon) continue;
    const psMatch = matchPSFamily(c.lat, c.lon);
    if (psMatch) {
      c.isPSFamily = true;
      c.psFamilyBrand = psMatch.brand;
      c.psFamilyDist = psMatch.distanceMi;
      console.log(`    PS FAMILY: ${c.name} ↔ ${psMatch.brand} (${psMatch.distanceMi} mi)`);
    }
  }
  const psFamily = competitors.filter(c => c.isPSFamily);
  const realCompetitors = competitors.filter(c => !c.isPSFamily);
  console.log(`    PS family (excluded): ${psFamily.length}`);
  console.log(`    Real competitors: ${realCompetitors.length}`);

  // 3. Classification — SpareFoot data is authoritative when explicit.
  // For facilities where SpareFoot is "unknown" (no CC flag, no DU flag) AND
  // for Places-only facilities, fall back to the Puppeteer website scrape.
  console.log(`\n  [3/7] Classification (SpareFoot authoritative, Puppeteer fallback for unknowns)...`);
  const classified = [];
  for (const c of realCompetitors) {
    const sfFac = c.primarySource === 'sparefoot';
    const sfHasExplicitClassification = sfFac && (c.climateControl === true || c.driveUp === true);

    if (sfHasExplicitClassification) {
      const hasCC = c.climateControl === true;
      const hasDU = c.driveUp === true;
      classified.push({
        ...c,
        classification: hasCC && hasDU ? 'cc_mixed_confirmed'
          : hasCC ? 'cc_confirmed' : 'non_cc_confirmed',
        confidence: 'high',
        isCC: hasCC,
        classificationSource: 'sparefoot',
        rateData: (c.rates || []).map(r => ({
          size: r.sizeBucket, sf: r.sf, type: r.type,
          rate: r.currentPrice, regularRate: r.regularPrice,
          discountPct: r.salePct, ratePerSf: r.ratePerSf
        }))
      });
      console.log(`    - ${c.name.slice(0, 40).padEnd(40)} [${hasCC ? 'cc' : 'non_cc'}_confirmed, sparefoot, ${c.rates?.length || 0} rates]`);
    } else {
      // Need classification — try Puppeteer scrape on website
      process.stdout.write(`    - ${c.name.slice(0, 40).padEnd(40)} `);
      const enriched = await classifyCompetitor(c);
      // Keep SpareFoot rates if we have them
      const sfRates = (c.rates || []).map(r => ({
        size: r.sizeBucket, sf: r.sf, type: r.type,
        rate: r.currentPrice, regularRate: r.regularPrice,
        discountPct: r.salePct, ratePerSf: r.ratePerSf
      }));
      const mergedRates = sfRates.length >= (enriched.rateData?.length || 0) ? sfRates : (enriched.rateData || []);
      // If enrichment confirms CC, re-tag any "unknown" rates as CC
      const finalRates = enriched.isCC
        ? mergedRates.map(r => ({ ...r, type: r.type === 'unknown' ? 'CC' : r.type }))
        : mergedRates;
      classified.push({
        ...c,
        ...enriched,
        rateData: finalRates,
        classificationSource: enriched.isCC ? 'puppeteer_scrape' : (sfFac ? 'sparefoot_unknown' : 'none')
      });
      console.log(`[${enriched.classification}, ${enriched.scrapeMethod || 'no-web'}, ${finalRates.length} rates (${sfRates.length} from sparefoot)]`);
      await new Promise(r => setTimeout(r, 250));
    }
  }

  const ccFacilities = classified.filter(c => c.isCC);
  const nonCCFacilities = classified.filter(c => !c.isCC && c.classification !== 'unknown');
  console.log(`    CC facilities: ${ccFacilities.length}`);
  console.log(`    Non-CC facilities: ${nonCCFacilities.length}`);
  console.log(`    Unknown: ${competitors.filter(c => !c.isPSFamily && c.classification === 'unknown').length}`);
  const totalRates = classified.reduce((s, c) => s + (c.rateData?.length || 0), 0);
  const ccRates = classified.reduce((s, c) => s + (c.rateData || []).filter(r => r.type === 'CC').length, 0);
  console.log(`    Total scraped rates: ${totalRates} (${ccRates} CC)`);

  // 4. Per-facility CC SF — ONLY count facilities classified as CC
  // (cc_confirmed or cc_likely). Unknown facilities do not contribute fallback
  // CC SF — otherwise false-positives inflate the SPC.
  console.log(`\n  [4/7] Measuring per-facility CC SF from unit inventory...`);
  let measuredCCSF = 0;
  let facilitiesWithMeasuredSF = 0;
  let facilitiesWithFallbackSF = 0;
  for (const c of ccFacilities) {
    const est = estimateFacilityCCSF(c);
    c.ccSFEstimate = est;
    if (est.method === 'unit-inventory-capped') {
      measuredCCSF += est.ccSF;
      facilitiesWithMeasuredSF++;
      console.log(`    ${c.name.slice(0, 35).padEnd(35)} ${est.ccSF.toLocaleString().padStart(8)} SF  [${est.detail}]`);
    } else {
      // Only CC-classified facilities (confirmed/likely) with no scraped rates
      // get the fallback. Unknown-classification facilities contribute 0.
      facilitiesWithFallbackSF++;
    }
  }
  // Fallback for facilities with no rate data — density-based × CC mix discount
  // Small-mid operators with CC mention on their site typically have only 40-60%
  // of their total SF as CC space. Applying a 50% discount to the density fallback
  // corrects for our over-attribution of CC SF to facilities that mention CC
  // but are actually majority drive-up.
  const pop3mi = parseInt(String(site.pop3mi || '0').replace(/[^0-9]/g, '')) || 0;
  const totalFacilitySF = pop3mi > 100000 ? 65000 : pop3mi > 30000 ? 45000 : 30000;
  const CC_MIX_DISCOUNT = 0.50; // 50% of total SF = CC for unmeasured facilities
  const fallbackSFPerFacility = Math.round(totalFacilitySF * CC_MIX_DISCOUNT);
  const fallbackCCSF = facilitiesWithFallbackSF * fallbackSFPerFacility;
  if (fallbackCCSF > 0) {
    console.log(`    ${facilitiesWithFallbackSF} facilities w/o rate data → ${totalFacilitySF.toLocaleString()} total SF × ${CC_MIX_DISCOUNT * 100}% CC mix = ${fallbackSFPerFacility.toLocaleString()} CC SF each`);
  }
  const totalCCSF = measuredCCSF + fallbackCCSF;
  console.log(`    Measured CC SF: ${measuredCCSF.toLocaleString()} from ${facilitiesWithMeasuredSF} facilities`);
  console.log(`    Fallback CC SF: ${fallbackCCSF.toLocaleString()} from ${facilitiesWithFallbackSF} facilities`);
  console.log(`    Total estimated CC SF: ${totalCCSF.toLocaleString()}`);

  const ccSPC_verified = pop3mi > 0 ? +(totalCCSF / pop3mi).toFixed(2) : null;
  const ccSPC_old = site.siteiqData?.ccSPC ?? null;
  const delta = ccSPC_old != null && ccSPC_verified != null
    ? +((ccSPC_verified - ccSPC_old) / ccSPC_old * 100).toFixed(1) : null;
  console.log(`    ccSPC_verified: ${ccSPC_verified} (was ${ccSPC_old}, delta: ${delta}%)`);

  // 5. Market rent band (subject 3mi comp set + SpareFoot 5mi wider sample)
  console.log(`\n  [5/7] Computing market rent band...`);
  const wideSampleRates = [];
  for (const f of spareFootWide.facilities || []) {
    // Don't double-count facilities already in the 3mi set
    if (classified.some(c => c.name === f.name)) continue;
    for (const r of f.rates || []) {
      if (!r.ratePerSf || !r.sf) continue;
      wideSampleRates.push({
        size: r.sizeBucket, sf: r.sf, type: r.type,
        ratePerSf: r.ratePerSf,
        facilityIsCC: f.climateControl === true && !f.driveUp,
        facilityName: f.name,
        distanceMi: f.distanceMi
      });
    }
  }
  console.log(`    Wide SpareFoot sample (5mi, outside 3mi core): ${wideSampleRates.length} additional rates`);
  const rentBand = computeMarketRentBand(classified, wideSampleRates);
  console.log(`    Primary band: P25 $${rentBand.p25} / median $${rentBand.median} / P75 $${rentBand.p75}/SF/mo (10x10: $${Math.round(rentBand.p25*100)}/$${Math.round(rentBand.median*100)}/$${Math.round(rentBand.p75*100)})`);
  console.log(`    Source: ${rentBand.source}`);
  if (rentBand.ccBand) console.log(`    CC band: P25 $${rentBand.ccBand.p25} / median $${rentBand.ccBand.median} / P75 $${rentBand.ccBand.p75}/SF (n=${rentBand.ccBand.sampleSize})`);
  if (rentBand.nonCCBand) console.log(`    Non-CC band: P25 $${rentBand.nonCCBand.p25} / median $${rentBand.nonCCBand.median} / P75 $${rentBand.nonCCBand.p75}/SF (n=${rentBand.nonCCBand.sampleSize})`);
  if (rentBand.marketBand) console.log(`    Market-wide: P25 $${rentBand.marketBand.p25} / median $${rentBand.marketBand.median} / P75 $${rentBand.marketBand.p75}/SF (n=${rentBand.marketBand.sampleSize})`);

  // 5b. Rent Projection Curve (ESRI × current rents → Y1-Y10 forward trajectories)
  console.log(`\n  [5b/7] Projecting forward rent curve (Y1-Y10)...`);
  function parseNum(v) { return parseFloat(String(v || '0').replace(/[$,%]/g, '').replace(/[^0-9.-]/g, '')) || 0; }
  const pipelineSF_early = parsePipelineSF(site.pipelineSF);
  const pop_cy = parseNum(site.pop3mi);
  const pop_fy = parseNum(site.pop3mi_fy);
  const income_cy = parseNum(site.income3mi);
  const income_fy = parseNum(site.income3mi_fy);
  const projection = projectRentCurve({
    currentCCRentPerSf: rentBand.ccBand?.median || rentBand.median,
    demographics: { pop_cy, pop_fy, income_cy, income_fy, horizonYears: 5 },
    supply: { existingCCSF: totalCCSF, pipelineSF: pipelineSF_early },
    market: {
      reitDominated: ccFacilities.length > 0 && ccFacilities.some(c => /public storage|extra space|cubesmart|life storage|istorage|nsa|storquest/i.test(c.name)),
      isCCFacility: true
    }
  });
  const curveSummary = summarizeCurve(projection);
  if (curveSummary) {
    console.log(`    Y1: $${curveSummary.y1_10x10}/mo  Y3: $${curveSummary.y3_10x10}/mo  Y5: $${curveSummary.y5_10x10}/mo  Y10: $${curveSummary.y10_10x10}/mo`);
    console.log(`    Growth: ${curveSummary.y1_to_y5_cagr} (Y1-Y5 CAGR) / ${curveSummary.y1_to_y10_cagr} (Y1-Y10 CAGR)`);
    console.log(`    Drivers: pop CAGR ${projection.assumptions.popCagr}%, HHI CAGR ${projection.assumptions.hhiCagr}%, pipeline/existing ${projection.assumptions.pipelineRatio}%, REIT ${projection.assumptions.reitDominated}`);
  } else {
    console.log(`    (skipped — insufficient rent band or demographic data)`);
  }

  // 6. Churn-adjusted absorption
  console.log(`\n  [6/7] Computing churn-adjusted absorption...`);
  const pipelineSF = parsePipelineSF(site.pipelineSF);
  const absorption = computeAbsorption(site, totalCCSF, pipelineSF);
  if (absorption) {
    console.log(`    Organic growth demand: ${absorption.growthDemandSF.toLocaleString()} SF/yr`);
    console.log(`    Churn-driven demand: ${absorption.churnDemandSF.toLocaleString()} SF/yr`);
    console.log(`    Total annual demand: ${absorption.totalAnnualDemandSF.toLocaleString()} SF/yr`);
    console.log(`    Pipeline: ${pipelineSF.toLocaleString()} SF`);
    console.log(`    Months to absorb: ${absorption.monthsToAbsorb}`);
    console.log(`    Verdict: ${absorption.verdict}`);
  }

  // 7. Confidence tier + build payload
  console.log(`\n  [7/7] Computing audit confidence + building payload...`);
  const highConfidenceCount = ccFacilities.filter(c => c.ccSFEstimate?.method === 'unit-inventory-capped').length;
  const highConfidenceRatio = ccFacilities.length > 0 ? highConfidenceCount / ccFacilities.length : 0;
  const auditConfidence = highConfidenceRatio >= 0.5 ? 'HIGH'
                        : highConfidenceRatio >= 0.2 ? 'MEDIUM' : 'LOW';
  const confidenceReason = `${highConfidenceCount} of ${ccFacilities.length} CC facilities measured from live rate inventory (${(highConfidenceRatio * 100).toFixed(0)}%)`;
  console.log(`    Audit confidence: ${auditConfidence} — ${confidenceReason}`);

  const ccRentData = {
    lastAudited: new Date().toISOString(),
    auditVersion: 'v2.0-sparefoot',
    totalPlacesResults: competitors.length,
    psFamilyCount: psFamily.length,
    psFamilyDetail: psFamily.map(p => ({
      name: p.name, brand: p.psFamilyBrand, distanceMi: p.distanceMi, psFamilyDistanceMi: p.psFamilyDist
    })),
    totalCompetitorsFound: classified.length,
    ccFacilityCount: ccFacilities.length,
    nonCCFacilityCount: nonCCFacilities.length,
    unknownClassificationCount: classified.filter(c => c.classification === 'unknown').length,
    totalCCSF,
    ccSFMeasuredFromInventory: measuredCCSF,
    ccSFFromFallback: fallbackCCSF,
    ccSPC_verified,
    ccSPC_previousFirebase: ccSPC_old,
    ccSPC_deltaPct: delta,
    marketRentBand: rentBand,
    rentProjection: projection,
    rentCurveSummary: curveSummary,
    // Narrative computed after all fields populated — see below
    absorption: absorption || null,
    auditConfidence,
    confidenceReason,
    highConfidenceFacilityCount: highConfidenceCount,
    competitorSet: classified.map(c => ({
      name: c.name,
      address: c.address,
      distanceMi: c.distanceMi,
      classification: c.classification,
      confidence: c.confidence,
      indicators: c.ccIndicators,
      website: c.website || null,
      scrapeMethod: c.scrapeMethod || null,
      rateDataCount: c.rateData?.length || 0,
      rates: c.rateData || [],
      ccSFEstimate: c.ccSFEstimate || null
    }))
  };

  // Attach narrative — prefer Claude LLM when ANTHROPIC_API_KEY is set
  const useLLM = process.env.ANTHROPIC_API_KEY && !process.env.NARRATIVE_DETERMINISTIC_ONLY;
  if (useLLM) {
    console.log(`\n  Generating LLM narrative (Claude ${process.env.CLAUDE_MODEL || 'claude-haiku-4-5'})...`);
  }
  ccRentData.narrative = useLLM
    ? await generateIntelNarrativeLLM({
        audit: ccRentData,
        site,
        inPlaceRentPerSf: site.existingFacility?.inPlaceCCRent || null,
        buyerType: site.existingFacility ? 'value_add_acquirer' : 'storage_reit',
      })
    : generateIntelNarrative({
        audit: ccRentData,
        site,
        inPlaceRentPerSf: site.existingFacility?.inPlaceCCRent || null,
        buyerType: site.existingFacility ? 'value_add_acquirer' : 'storage_reit',
      });
  const flagCount = ccRentData.narrative.anomalyFlags?.length || 0;
  const tok = ccRentData.narrative.tokenUsage;
  console.log(`  Narrative: ${ccRentData.narrative.engine}${tok ? ` · ${tok.input}in/${tok.output}out tokens` : ''}${flagCount ? ` · ${flagCount} anomaly flag(s)` : ''}`);

  // Value-Add Workup — only for existing-facility deals (SK / StorQuest / Prime tuck-ins)
  if (site.existingFacility?.inPlaceCCRent) {
    console.log(`  Running Value-Add Workup for existing facility...`);
    try {
      const siteWithData = { ...site, ccRentData };
      const workup = runValueAddWorkup({
        site: siteWithData,
        inPlace: {
          ccRent: parseFloat(site.existingFacility.inPlaceCCRent),
          driveRent: parseFloat(site.existingFacility.inPlaceDriveRent || 0),
          occupancy: parseFloat(site.existingFacility.occupancy || 0.85),
          ccSF: parseFloat(site.existingFacility.ccSF || 0),
          driveSF: parseFloat(site.existingFacility.driveSF || 0),
          acquisitionPrice: parseFloat(site.existingFacility.askingPrice || site.askingPrice || 0),
        },
        targetIRR: parseFloat(site.existingFacility.targetIRR) || 0.14,
        repositioningLevel: site.existingFacility.repositioningLevel || 'light',
        holdYears: parseInt(site.existingFacility.holdYears) || 7,
      });
      if (workup.error) {
        console.log(`  Value-Add skipped: ${workup.error}`);
      } else {
        ccRentData.valueAddWorkup = workup;
        console.log(`  Value-Add Workup: ${workup.verdict.verdict} (${workup.verdict.rentGapPct}% rent gap, prob-weighted IRR ${workup.scenarioIRRs.weightedIRR}%)`);
      }
    } catch (e) {
      console.log(`  Value-Add FAILED: ${e.message.slice(0, 150)}`);
    }
  }

  // Deep-sanitize: Firebase rejects undefined. Convert to null.
  function deepSanitize(obj) {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(deepSanitize);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = v === undefined ? null : deepSanitize(v);
    }
    return out;
  }
  const sanitizedCCRentData = deepSanitize(ccRentData);

  if (!FLAGS.dryRun) {
    console.log(`  Writing ccRentData to Firebase: ${tracker}/${firebaseKey}...`);
    await update(ref(db, `${tracker}/${firebaseKey}`), {
      ccRentData: sanitizedCCRentData,
      'siteiqData/ccSPC_verified': ccSPC_verified == null ? null : ccSPC_verified,
      'siteiqData/ccFacilityCount': ccFacilities.length,
      'siteiqData/psFamilyCount': psFamily.length,
      'siteiqData/marketRentMedian': rentBand.median == null ? null : rentBand.median,
      'siteiqData/auditConfidence': auditConfidence || null
    });
    console.log(`  WROTE.`);
  } else {
    console.log(`  [DRY RUN — no Firebase write]`);
  }

  return ccRentData;
}

// ---- Main ----
async function main() {
  console.log('\n=== SiteScore Market Intel Engine — cc-rent-audit v2.0 (SpareFoot primary + PS Family + confidence) ===');
  console.log(`PS Family Registry loaded: ${PS_FAMILY_REGISTRY.length} locations (PS + iStorage + NSA)`);
  console.log(`Flags: ${JSON.stringify(FLAGS)}\n`);

  let targets = [];
  if (FLAGS.pilot) targets = [PILOT_SITE_KEY];
  else if (FLAGS.site) targets = [FLAGS.site];
  else if (FLAGS.all) {
    for (const tracker of ['southwest', 'east']) {
      const snap = await get(ref(db, tracker));
      if (snap.exists()) {
        for (const [k, v] of Object.entries(snap.val())) {
          if (!v || typeof v !== 'object') continue;
          const phase = (v.phase || '').toLowerCase();
          if (['dead', 'passed', 'rejected'].includes(phase)) continue;
          targets.push(k);
        }
      }
    }
    console.log(`Auditing ${targets.length} active pipeline sites\n`);
  } else {
    console.log('Usage: node cc-rent-audit.mjs [--pilot | --site <key> | --all] [--dry-run] [--no-puppeteer]');
    process.exit(1);
  }

  const results = {};
  for (const key of targets) {
    try {
      results[key] = await auditSite(key);
    } catch (e) {
      console.error(`  FATAL for ${key}: ${e.message}`);
      results[key] = { error: e.message };
    }
  }

  await closeBrowser();

  const logPath = `cc-rent-audit-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  writeFileSync(logPath, JSON.stringify(results, null, 2));
  console.log(`\nAudit log saved: ${logPath}`);
  process.exit(0);
}

main().catch(async (e) => {
  console.error('FATAL:', e);
  await closeBrowser();
  process.exit(1);
});
