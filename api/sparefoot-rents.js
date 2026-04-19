// Vercel Serverless Function — SpareFoot live rent pull for Quick Lookup
// GET /api/sparefoot-rents?city=Temple&state=TX&zip=76501&lat=31.1&lon=-97.3
// Returns: { ok, ccRent, duRent, compCount, confidence, bands, comps, fallback }
//
// SpareFoot uses Cloudflare JA3 fingerprinting — native fetch often gets 403.
// Strategy: try fetch with browser-like headers. If 403, return market-band
// defaults calibrated by state (PSA/EXR 10-K regional averages).

const https = require("https");
const { gunzipSync, brotliDecompressSync, inflateSync } = require("zlib");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// State-level market bands from PSA/EXR/CUBE 10-K regional disclosures + Yardi
// Matrix segment data. Used as fallback when SpareFoot is blocked.
const STATE_RENT_BANDS = {
  'CA': { ccRent: 2.15, duRent: 1.15, confidence: 'CA premium metros' },
  'NY': { ccRent: 2.20, duRent: 1.10, confidence: 'NY premium metros' },
  'FL': { ccRent: 1.55, duRent: 0.90, confidence: 'FL sun-belt' },
  'TX': { ccRent: 1.45, duRent: 0.85, confidence: 'TX sun-belt' },
  'AZ': { ccRent: 1.40, duRent: 0.80, confidence: 'AZ sun-belt' },
  'NV': { ccRent: 1.55, duRent: 0.90, confidence: 'NV sun-belt' },
  'CO': { ccRent: 1.55, duRent: 0.90, confidence: 'CO mountain west' },
  'GA': { ccRent: 1.35, duRent: 0.78, confidence: 'GA southeast' },
  'NC': { ccRent: 1.30, duRent: 0.75, confidence: 'NC southeast' },
  'SC': { ccRent: 1.25, duRent: 0.72, confidence: 'SC southeast' },
  'VA': { ccRent: 1.40, duRent: 0.82, confidence: 'VA mid-atlantic' },
  'MD': { ccRent: 1.55, duRent: 0.90, confidence: 'MD DMV' },
  'WA': { ccRent: 1.70, duRent: 0.98, confidence: 'WA pacific-nw' },
  'OR': { ccRent: 1.55, duRent: 0.88, confidence: 'OR pacific-nw' },
  'IL': { ccRent: 1.40, duRent: 0.82, confidence: 'IL great-lakes' },
  'OH': { ccRent: 1.20, duRent: 0.70, confidence: 'OH midwest' },
  'MI': { ccRent: 1.25, duRent: 0.72, confidence: 'MI great-lakes' },
  'IN': { ccRent: 1.25, duRent: 0.72, confidence: 'IN midwest' },
  'TN': { ccRent: 1.30, duRent: 0.75, confidence: 'TN mid-south' },
  'KY': { ccRent: 1.22, duRent: 0.70, confidence: 'KY mid-south' },
  'MO': { ccRent: 1.20, duRent: 0.70, confidence: 'MO midwest' },
  'PA': { ccRent: 1.35, duRent: 0.78, confidence: 'PA northeast' },
  'NJ': { ccRent: 1.75, duRent: 1.00, confidence: 'NJ northeast' },
  'MA': { ccRent: 1.85, duRent: 1.05, confidence: 'MA northeast' },
  'CT': { ccRent: 1.65, duRent: 0.95, confidence: 'CT northeast' },
  // default
  '__DEFAULT__': { ccRent: 1.40, duRent: 0.82, confidence: 'US national median' }
};

function httpsGetWithHeaders(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "DNT": "1",
      }
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let body = buf;
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') body = gunzipSync(buf);
          else if (enc === 'br') body = brotliDecompressSync(buf);
          else if (enc === 'deflate') body = inflateSync(buf);
        } catch { /* leave raw */ }
        resolve({ status: res.statusCode, body: body.toString("utf-8") });
      });
    });
    req.on("error", (e) => resolve({ status: 0, body: "", error: e.message }));
    // Keep well under Vercel Hobby's 10s function limit — single fetch, no polling.
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, body: "", error: "timeout" }); });
    req.end();
  });
}

function parsePreloadedState(html) {
  // SpareFoot embeds Redux state as Base64'd JSON in window.__PRELOADED_STATE__
  const m = html.match(/window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\(atob\("([^"]+)"\)\)/);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch { return null; }
}

function extractRatesFromState(state) {
  // SpareFoot state has locations + rates. Shape varies by endpoint.
  const locs = state?.search?.locations || state?.locations || state?.marketListings?.locations || [];
  const rates = [];
  for (const loc of locs) {
    const facilityCC = !!(loc.amenities?.some?.(a => /climate/i.test(a)) || loc.climateControlled);
    const units = loc.units || loc.unitTypes || [];
    for (const u of units) {
      const price = u.price || u.rate || u.monthlyPrice;
      const sqft = u.squareFeet || u.sqft || u.size;
      if (!price || !sqft || sqft <= 0) continue;
      const perSF = price / sqft;
      if (perSF < 0.2 || perSF > 5) continue; // sanity filter
      const isCC = u.climateControlled === true || u.climateControlled === 'true' || facilityCC;
      rates.push({ rate: perSF, sf: sqft, facility: loc.name || '', isCC });
    }
  }
  return rates;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const q = req.query || {};
  const city = (q.city || '').trim();
  const state = String(q.state || '').trim().toUpperCase();
  const zip = (q.zip || '').trim();
  const lat = parseFloat(q.lat || '');
  const lon = parseFloat(q.lon || '');

  const fallback = STATE_RENT_BANDS[state] || STATE_RENT_BANDS['__DEFAULT__'];

  // Attempt SpareFoot market page
  if (city && state) {
    const citySlug = city.replace(/\s+/g, '-');
    const url = `https://www.sparefoot.com/storage-${citySlug}-${state}-${zip || ''}.html`.replace(/-\.html$/, '.html');
    const resp = await httpsGetWithHeaders(url);

    if (resp.status === 200 && resp.body && resp.body.length > 1000) {
      const state = parsePreloadedState(resp.body);
      const rates = extractRatesFromState(state) || [];
      const ccRates = rates.filter(r => r.isCC).map(r => r.rate);
      const duRates = rates.filter(r => !r.isCC).map(r => r.rate);
      if (ccRates.length >= 3 || duRates.length >= 3) {
        return res.status(200).json({
          ok: true,
          source: 'SpareFoot live pull',
          url,
          compCount: rates.length,
          ccRent: median(ccRates) ? parseFloat(median(ccRates).toFixed(3)) : null,
          duRent: median(duRates) ? parseFloat(median(duRates).toFixed(3)) : null,
          ccSampleCount: ccRates.length,
          duSampleCount: duRates.length,
          confidence: `LIVE — ${rates.length} unit comps from ${city}, ${state} (SpareFoot)`,
          bands: {
            ccP25: median([...ccRates].sort((a,b)=>a-b).slice(0, Math.ceil(ccRates.length/2))),
            ccP75: median([...ccRates].sort((a,b)=>a-b).slice(Math.floor(ccRates.length/2))),
          },
          generatedAt: new Date().toISOString()
        });
      }
    }
    // Fallback
    return res.status(200).json({
      ok: true,
      source: 'State market band',
      fallback: true,
      url: url,
      upstreamStatus: resp.status,
      ccRent: fallback.ccRent,
      duRent: fallback.duRent,
      confidence: `FALLBACK — ${fallback.confidence} (SpareFoot upstream ${resp.status === 200 ? 'no rate data parsed' : `returned ${resp.status}`})`,
      bands: null,
      generatedAt: new Date().toISOString()
    });
  }

  return res.status(200).json({
    ok: true,
    source: 'Default band',
    fallback: true,
    ccRent: fallback.ccRent,
    duRent: fallback.duRent,
    confidence: fallback.confidence,
    generatedAt: new Date().toISOString()
  });
};
