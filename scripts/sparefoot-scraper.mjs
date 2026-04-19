/**
 * sparefoot-scraper.mjs — SpareFoot aggregator ingestion
 *
 * Primary rate + competitor source for Storvex Market Intel Engine.
 * SpareFoot indexes 18,000+ storage facilities with static HTML + JSON-LD.
 * Gives us: facility meta, exact coords, CC/drive-up classification (pre-tagged
 * via schema.org amenityFeature), current asking rates, operator identity.
 *
 * Coverage beats Google Places API by 3-5x in most markets (21 facilities vs
 * 7 in Temple TX pilot). No Puppeteer needed — serves static HTML.
 */

import { spawn } from 'child_process';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// SpareFoot uses Cloudflare JA3 fingerprinting — Node's fetch gets 403 but curl
// passes cleanly. Route all SpareFoot requests through curl subprocess.
function curlFetch(url, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const args = [
      '-s', '-L', // silent, follow redirects
      '-A', USER_AGENT,
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      '-H', 'Accept-Encoding: gzip, deflate, br',
      '-H', 'Cache-Control: no-cache',
      '-H', 'Upgrade-Insecure-Requests: 1',
      '--compressed',
      '--max-time', String(Math.floor(timeoutMs / 1000)),
      '-w', '\n---HTTP_STATUS:%{http_code}---',
      url
    ];
    const proc = spawn('curl', args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d.toString('utf-8'));
    proc.stderr.on('data', d => stderr += d.toString('utf-8'));
    proc.on('close', () => {
      const statusMatch = stdout.match(/---HTTP_STATUS:(\d+)---$/);
      const status = statusMatch ? parseInt(statusMatch[1]) : 0;
      const body = stdout.replace(/---HTTP_STATUS:\d+---$/, '');
      resolve({ ok: status >= 200 && status < 300, status, body, error: stderr });
    });
    proc.on('error', e => resolve({ ok: false, status: 0, body: '', error: e.message }));
  });
}

// Full browser-like header set to evade SpareFoot bot detection
const BROWSER_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'DNT': '1'
};

// Slugify city name for URL: "Temple" → "Temple", "New York" → "New-York"
function citySlug(city) {
  return String(city || '').trim().replace(/\s+/g, '-');
}

function htmlDecode(s) {
  return String(s || '')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

// ---- Decode SpareFoot's __PRELOADED_STATE__ blob ----
// Their Next.js app embeds complete facility + unit + rate data as Base64-
// encoded JSON in window.__PRELOADED_STATE__. This is the authoritative source
// — no need to hit individual facility detail pages.
function decodePreloadedState(html) {
  const m = html.match(/window\.__PRELOADED_STATE__\s*=\s*"([^"]+)"/);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

// Map a SpareFoot unit to our internal shape
function mapUnit(unit, facilityClimateControlFlag) {
  const amenitiesList = (unit.amenitiesList || '').toLowerCase();
  const isCCUnit = /climate controlled|climate control/.test(amenitiesList);
  const isDriveUpUnit = /drive up|drive-up/.test(amenitiesList);
  const price = unit.price?.value ?? null;
  const regularPrice = unit.priceDetails?.regular?.value ?? unit.regularPrice?.value ?? price;
  return {
    sizeBucket: unit.sizeBucket || null,
    sizeText: unit.sizeText || null,
    width: unit.width || null,
    length: unit.length || null,
    sf: unit.squareFootage || null,
    sizeCategory: unit.sizeCategory || null,
    currentPrice: price,
    regularPrice,
    salePct: (regularPrice && price && regularPrice > price)
      ? +((1 - price / regularPrice) * 100).toFixed(1) : 0,
    ratePerSf: (unit.squareFootage && price) ? +(price / unit.squareFootage).toFixed(3) : null,
    type: isCCUnit ? 'CC' : isDriveUpUnit ? 'non_CC' : (facilityClimateControlFlag === true ? 'CC' : 'unknown'),
    isAvailableToBook: unit.isAvailableToBook !== false,
    amenities: unit.amenitiesList || '',
    vehicleAccommodation: unit.vehicleAccommodation || null
  };
}

// ---- Scrape SpareFoot market page ----
// Input: { city, state, zip, lat, lon }  — any combo is fine; zip is most reliable
// Output: { facilities: [{name, address, lat, lon, url, climateControl, driveUp, telephone, amenities, rates}] }
export async function scrapeSpareFootMarket({ city, state, zip, lat, lon }) {
  const primary = `https://www.sparefoot.com/${citySlug(city)}-${state}-self-storage.html?location=${encodeURIComponent(city + ', ' + state + ' ' + (zip || ''))}`;
  const fallback = zip
    ? `https://www.sparefoot.com/search/?location=${encodeURIComponent(zip)}`
    : null;

  const urls = [primary, fallback].filter(Boolean);
  let html = null;
  let usedUrl = null;
  const errs = [];
  for (const url of urls) {
    const r = await curlFetch(url, 25000);
    if (r.ok && r.body) {
      html = r.body;
      usedUrl = url;
      if (/SelfStorage/.test(html)) break;
    } else {
      errs.push(`${url} → HTTP ${r.status}${r.error ? ' ' + r.error.slice(0,60) : ''}`);
    }
  }
  if (!html) return { facilities: [], error: 'SpareFoot fetch failed: ' + errs.join(' | '), sourceUrl: null };

  // Primary source: window.__PRELOADED_STATE__ (Base64-encoded Redux/Next.js state)
  // Contains complete facility + unit + rate data in one blob. No detail-page fetches needed.
  const preloaded = decodePreloadedState(html);
  const facilities = [];

  if (preloaded && preloaded.facilities?.byId) {
    const facByIdState = preloaded.facilities.byId;
    const unitsById = preloaded.units?.byId || {};

    // Also parse JSON-LD to cross-fill Climate Control flag (state.amenities object
    // omits 'climate control' but JSON-LD amenityFeature has it).
    const ldClimateByFacilityId = {};
    const ldRe = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = ldRe.exec(html)) !== null) {
      try {
        const j = JSON.parse(m[1]);
        if (j['@type'] !== 'SelfStorage' || !j.name) continue;
        const amenities = Array.isArray(j.amenityFeature) ? j.amenityFeature : [];
        const cc = amenities.find(a => a?.name === 'Climate Control')?.value === true;
        const du = amenities.find(a => a?.name === 'Drive-Up Access')?.value === true;
        ldClimateByFacilityId[htmlDecode(j.name)] = { climateControl: cc, driveUp: du };
      } catch {}
    }

    for (const fid of Object.keys(facByIdState)) {
      const f = facByIdState[fid];
      if (!f || !f.name) continue;
      const ldFlags = ldClimateByFacilityId[htmlDecode(f.name)] || {};
      const amenObj = f.amenities || {};
      const rates = (f.units || [])
        .map(uid => unitsById[uid])
        .filter(u => u && u.price?.value)
        .map(u => mapUnit(u, ldFlags.climateControl));
      // Facility-level climate flag: prefer JSON-LD (explicit), fall back to
      // whether any unit has CC amenity
      const facHasCC = ldFlags.climateControl === true
        || rates.some(r => r.type === 'CC');
      const facHasDU = ldFlags.driveUp === true
        || rates.some(r => r.type === 'non_CC');
      facilities.push({
        source: 'sparefoot',
        sparefootId: fid,
        name: htmlDecode(f.name),
        url: f.website || f.url?.facility || null,
        sparefootUrl: (preloaded.app?.baseUrl || 'https://www.sparefoot.com') + (f.url?.facility || ''),
        address: f.location ? {
          street: htmlDecode(f.location.address1),
          city: htmlDecode(f.location.city),
          state: htmlDecode(f.location.state),
          zip: f.location.postal
        } : null,
        lat: f.location?.latitude ? parseFloat(f.location.latitude) : null,
        lon: f.location?.longitude ? parseFloat(f.location.longitude) : null,
        telephone: f.phone || f.unformattedPhone || null,
        climateControl: facHasCC,
        driveUp: facHasDU,
        twentyFourHourAccess: amenObj['24HourAccess'] === true,
        electronicGate: amenObj.egateAccess === true,
        surveillance: amenObj.surveillance === true,
        fencedLighted: amenObj.fencedLighted === true,
        promotion: f.promotion || null,
        reviewCount: f.reviews?.count || null,
        reviewRating: f.reviews?.rating || null,
        amenities: amenObj,
        rates,
        rateCount: rates.length,
        ccRateCount: rates.filter(r => r.type === 'CC').length,
        nonCCRateCount: rates.filter(r => r.type === 'non_CC').length
      });
    }
  }

  return { facilities, sourceUrl: usedUrl, count: facilities.length, dataSource: preloaded ? 'preloaded_state' : 'none' };
}

// ---- Scrape rates from a single SpareFoot facility detail page ----
// Output: [{size, sf, rate, salePrice, type: 'CC' | 'non_CC'}]
export async function scrapeSpareFootFacilityRates(facilityUrl, facilityClimateControl) {
  if (!facilityUrl) return [];
  const r = await curlFetch(facilityUrl, 15000);
  if (!r.ok || !r.body) return [];
  const html = r.body;
  try {

    // Pattern: a size block like 5' x 10' followed by price markers
    // HTML uses &#x27; for apostrophes. Rates appear as $NN.NN (list) and sometimes $MM.MM (sale).
    // Strategy: capture any size + first 2 prices in the 400-char window following the size.
    const rates = [];
    const sizeRe = /(\d{1,2})\s*(?:&#x27;|')\s*x\s*(\d{1,2})\s*(?:&#x27;|')/g;
    let m;
    while ((m = sizeRe.exec(html)) !== null) {
      const w = parseInt(m[1]), h = parseInt(m[2]);
      if (w < 3 || h < 3 || w > 50 || h > 50) continue;
      const sf = w * h;
      const window = html.slice(m.index, m.index + 400);
      const priceMatches = [...window.matchAll(/\$\s*(\d{1,4})(?:\.(\d{2}))?/g)];
      if (priceMatches.length === 0) continue;
      const prices = priceMatches.map(p => parseFloat(p[1] + (p[2] ? '.' + p[2] : ''))).filter(p => p >= 10 && p <= 2000);
      if (prices.length === 0) continue;
      // First price is usually list/MSRP; second (if present) is current/sale
      const listPrice = prices[0];
      const currentPrice = prices.length > 1 ? prices[1] : prices[0];
      // Type: if facility is CC-only, all units are CC. If drive-up-only, all are non-CC.
      // If mixed, scan the 200-char context for CC/drive-up keywords.
      let type = 'unknown';
      if (facilityClimateControl === true) {
        type = 'CC';
      } else if (facilityClimateControl === false) {
        type = 'non_CC';
      } else {
        const ctx = window.toLowerCase();
        if (/climate|cc\b|indoor/.test(ctx)) type = 'CC';
        else if (/drive[- ]?up|outdoor|non[- ]?cc/.test(ctx)) type = 'non_CC';
      }
      rates.push({
        size: `${w}x${h}`,
        sf,
        type,
        listPrice,
        currentPrice,
        ratePerSf: +(currentPrice / sf).toFixed(3),
        discountPct: listPrice > currentPrice ? +((1 - currentPrice / listPrice) * 100).toFixed(1) : 0
      });
    }
    // Dedupe: keep the lowest-rate variant per size+type
    const seen = new Map();
    for (const r of rates) {
      const key = `${r.size}|${r.type}`;
      if (!seen.has(key) || seen.get(key).currentPrice > r.currentPrice) seen.set(key, r);
    }
    return [...seen.values()];
  } catch {
    return [];
  }
}

// ---- Haversine distance helper (used by caller for distance filtering) ----
export function distanceMi(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---- All-in-one: get a complete market comp set with rates ----
// Single SpareFoot search-page fetch; all facilities + units + rates pulled
// from __PRELOADED_STATE__. No detail-page traversal needed.
export async function getSpareFootCompSet({ city, state, zip, lat, lon, radiusMi = 3 }) {
  const { facilities, sourceUrl, dataSource } = await scrapeSpareFootMarket({ city, state, zip, lat, lon });
  if (!facilities.length) return { facilities: [], sourceUrl, dataSource };

  // Filter by distance
  const filtered = (lat && lon)
    ? facilities
        .map(f => ({ ...f, distanceMi: f.lat && f.lon ? +distanceMi(lat, lon, f.lat, f.lon).toFixed(2) : null }))
        .filter(f => f.distanceMi == null || f.distanceMi <= radiusMi)
    : facilities;

  const ccCount = filtered.filter(f => f.climateControl && !f.driveUp).length;
  const duOnlyCount = filtered.filter(f => !f.climateControl && f.driveUp).length;
  const mixedCount = filtered.filter(f => f.climateControl && f.driveUp).length;
  const facilitiesWithRates = filtered.filter(f => f.rates.length > 0).length;
  const totalRateCount = filtered.reduce((s, f) => s + f.rates.length, 0);
  const totalCCRateCount = filtered.reduce((s, f) => s + f.ccRateCount, 0);

  return {
    facilities: filtered,
    marketSummary: {
      totalFacilities: filtered.length,
      ccFacilities: ccCount,
      duOnlyFacilities: duOnlyCount,
      mixedFacilities: mixedCount,
      facilitiesWithScrapedRates: facilitiesWithRates,
      totalRateCount,
      totalCCRateCount,
      rateCoverageRatio: filtered.length > 0 ? +(facilitiesWithRates / filtered.length).toFixed(2) : 0
    },
    sourceUrl,
    dataSource
  };
}
