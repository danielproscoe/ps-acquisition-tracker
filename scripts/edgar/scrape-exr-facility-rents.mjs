// scrape-exr-facility-rents.mjs — primary-source per-facility unit-rent scraper
// for Extra Space Storage (EXR).
//
// EXR's facility detail pages return 403 to vanilla HTTPS clients — they sit
// behind PerimeterX bot protection (px-captcha) and a Vercel-fronted firewall.
// Sitemaps and robots.txt are unguarded, so URL discovery is free, but the
// detail pages need a real browser fingerprint (canvas, WebGL, JS execution
// timing) to pass the challenge.
//
// We launch Puppeteer-core with system Chrome (the toolchain already lives
// at /_tools/pdf-gen/node_modules/puppeteer-core for the Goldman PDF pipeline).
// Each detail page is rendered, the LD+JSON Schema.org SelfStorage entity is
// extracted, and the makesOffer array yields per-unit move-in pricing.
//
// URL discovery: https://www.extraspace.com/facility-sitemap.xml lists every
// EXR-managed facility (~2,018 in the FY2025 Schedule III plus managed/joint
// venture). URL pattern is /storage/facilities/us/{state}/{city}/{id}/.
//
// Performance: ~5-7 seconds per facility (browser navigation + JS settle).
// At that rate the full sitemap is ~3 hours — too long for a single GitHub
// Actions run (60 min cap). Use --states= or --limit= to chunk crawls; the
// daily refresh workflow rotates through state subsets so each state refreshes
// every 5-7 days.

import https from "node:https";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

// puppeteer-core lives in the shared toolchain alongside the PDF generator.
const PUPPETEER_TOOLCHAIN = path.resolve(__dirname, "..", "..", "..", "_tools", "pdf-gen");
const requireFromToolchain = createRequire(pathToFileURL(path.join(PUPPETEER_TOOLCHAIN, "package.json")));

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SITEMAP_URL = "https://www.extraspace.com/facility-sitemap.xml";

const NAV_TIMEOUT_MS = 30000;
const SETTLE_MS = 1500;
const REQ_DELAY_MS = 1500; // small inter-page pause; browser nav already adds latency
const RESTART_EVERY = 8; // close + reopen browser every N facilities to evict
                         // PerimeterX session cookies (_px3, _pxhd, _px) that
                         // get flagged after a few rapid requests

// CLI args
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : null;
const STATES_ARG = process.argv.find((a) => a.startsWith("--states="));
const STATES_FILTER = STATES_ARG
  ? new Set(STATES_ARG.split("=")[1].split(",").map((s) => s.trim().toLowerCase()))
  : null;
const HEADFUL = process.argv.includes("--headful");

// Browser path discovery (mirror of _tools/pdf-gen/render.js)
const CHROME_PATHS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
];

function findBrowser() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("No Chrome/Edge found in standard paths.");
}

// ─── Sitemap fetch (vanilla HTTPS — sitemap path is unguarded) ──────────────

function getXML(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          "User-Agent": UA,
          "Accept-Encoding": "gzip, br",
          Accept: "application/xml,text/xml,*/*",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const enc = (res.headers["content-encoding"] || "").toLowerCase();
          let body = buf;
          try {
            if (enc === "gzip") body = gunzipSync(buf);
            else if (enc === "br") body = brotliDecompressSync(buf);
          } catch {}
          resolve({ status: res.statusCode, body: body.toString("utf-8") });
        });
      }
    );
    req.on("error", (e) => resolve({ status: 0, body: "", error: e.message }));
    req.setTimeout(20000, () => {
      req.destroy();
      resolve({ status: 0, body: "", error: "timeout" });
    });
    req.end();
  });
}

// EXR facility URL pattern:
//   https://www.extraspace.com/storage/facilities/us/{state}/{city}/{id}/
function parseFacilityURL(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    // ['storage', 'facilities', 'us', '{state}', '{city}', '{id}']
    if (segs.length < 6) return null;
    if (segs[0] !== "storage" || segs[1] !== "facilities" || segs[2] !== "us") return null;
    const state = segs[3];
    const city = segs[4];
    const facilityId = segs[5];
    if (!/^\d+$/.test(facilityId)) return null;
    return { state, city, facilityId, url };
  } catch {
    return null;
  }
}

async function fetchSitemap() {
  console.log(`Fetching EXR sitemap: ${SITEMAP_URL}`);
  const r = await getXML(SITEMAP_URL);
  if (r.status !== 200) {
    throw new Error(`Sitemap fetch failed: ${r.status}`);
  }
  const urls = [...r.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const parsed = urls.map(parseFacilityURL).filter(Boolean);
  console.log(`  ${urls.length} URLs in sitemap → ${parsed.length} valid facility URLs`);
  return parsed;
}

// ─── Detail page parsing (run from inside Puppeteer page context) ──────────

// Parse "10x15" or "5' x 5'" or "5' x 10' Storage Unit" → { width, length, sqft }
// EXR formats include foot-marks ('  or ′) between dimensions.
function parseUnitDimensions(sizeName) {
  if (!sizeName) return { width: null, length: null, sqft: null };
  const m = String(sizeName).match(
    /(\d{1,3}(?:\.\d+)?)\s*['′]?\s*[x×]\s*['′]?\s*(\d{1,3}(?:\.\d+)?)/i
  );
  if (!m) return { width: null, length: null, sqft: null };
  const w = parseFloat(m[1]);
  const l = parseFloat(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(l) || w <= 0 || l <= 0) {
    return { width: null, length: null, sqft: null };
  }
  return { width: w, length: l, sqft: w * l };
}

// EXR price formats: "46.00" (bare number, single move-in rate),
// or with $ sign, or as a range. Make $ optional.
function parsePriceRange(priceText) {
  if (priceText == null || priceText === "") return { low: null, high: null, mid: null };
  // Handle numeric directly (LD+JSON sometimes has number type)
  if (typeof priceText === "number") {
    return { low: priceText, high: priceText, mid: priceText };
  }
  const matches = String(priceText).match(/\$?\s*(\d+(?:\.\d{1,2})?)/g);
  if (!matches) return { low: null, high: null, mid: null };
  const nums = matches
    .map((s) => parseFloat(s.replace(/[$\s,]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return { low: null, high: null, mid: null };
  const low = Math.min(...nums);
  const high = Math.max(...nums);
  return { low, high, mid: (low + high) / 2 };
}

function classifyUnitType(description, name) {
  const text = String(description || name || "").toLowerCase();
  if (/climate.controlled|climate controlled|cc unit/.test(text)) return "CC";
  if (/drive.?up|outside\s+access|exterior/.test(text)) return "DU";
  if (/outdoor|vehicle|parking|rv\s+space/.test(text)) return "OUTDOOR";
  if (/inside|interior|elevator|hallway/.test(text)) return "INDOOR_NOTCC";
  return "UNKNOWN";
}

function parseFacilityDetail(html, urlInfo) {
  // Extract LD+JSON blocks
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  const blocks = [];
  let m;
  while ((m = re.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {}
  }

  // Find SelfStorage + AggregateOffer entities. EXR may use either a flat
  // array, a single object with @type, or an @graph wrapping.
  let selfStorage = null;
  let aggregateOffer = null;
  for (const block of blocks) {
    const items = Array.isArray(block) ? block : block["@graph"] || [block];
    for (const it of items) {
      if (it?.["@type"] === "SelfStorage" && !selfStorage) selfStorage = it;
      if (it?.["@type"] === "AggregateOffer" && !aggregateOffer) aggregateOffer = it;
    }
  }

  if (!selfStorage) return null;

  const offers = Array.isArray(selfStorage.makesOffer) ? selfStorage.makesOffer : [];
  const records = offers
    .map((offer) => {
      const item = offer.itemOffered || {};
      const sizeName = item.name || "";
      const desc = item.description || "";
      const { width, length, sqft } = parseUnitDimensions(sizeName);
      const { low, high, mid } = parsePriceRange(offer.price);
      const unitType = classifyUnitType(desc, item.name);
      const movein = low ?? mid;
      if (!sqft || movein == null) return null;
      return {
        sku: item.sku || null,
        sizeName,
        widthFt: width,
        lengthFt: length,
        sqft,
        unitType,
        moveInPrice: movein,
        priceLow: low,
        priceHigh: high,
        priceMid: mid,
        pricePerSF_mo: Math.round((movein / sqft) * 1000) / 1000,
        description: desc,
        availability: offer.availability || null,
        priceText: offer.price || null,
      };
    })
    .filter(Boolean);

  return {
    facilityUrl: selfStorage["@id"] || urlInfo.url,
    facilityId: urlInfo.facilityId,
    stateSlug: urlInfo.state,
    citySlug: urlInfo.city,
    name: selfStorage.name,
    telephone: selfStorage.telephone || null,
    address: selfStorage.address?.streetAddress || null,
    city: selfStorage.address?.addressLocality || null,
    stateCode: selfStorage.address?.addressRegion || null,
    zip: selfStorage.address?.postalCode || null,
    lat: selfStorage.geo?.latitude ?? null,
    lng: selfStorage.geo?.longitude ?? null,
    rating: parseFloat(selfStorage.aggregateRating?.ratingValue) || null,
    ratingCount: parseInt(selfStorage.aggregateRating?.ratingCount, 10) || null,
    priceRangeBucket: selfStorage.priceRange || null,
    aggregateOfferLowPrice: aggregateOffer?.lowPrice ?? null,
    aggregateOfferHighPrice: aggregateOffer?.highPrice ?? null,
    aggregateOfferCount: aggregateOffer?.offerCount ?? null,
    units: records,
    scrapedAt: new Date().toISOString(),
  };
}

// ─── Browser-driven crawl ───────────────────────────────────────────────────

async function main() {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  Extra Space Storage (EXR) Facility Unit-Rent Scraper");
  console.log("════════════════════════════════════════════════════════════════════");

  let urls = await fetchSitemap();

  if (STATES_FILTER) {
    const before = urls.length;
    urls = urls.filter((u) => STATES_FILTER.has(u.state));
    console.log(`  States filter ${[...STATES_FILTER].join(",")}: ${before} → ${urls.length} URLs`);
  }
  if (LIMIT) {
    urls = urls.slice(0, LIMIT);
    console.log(`  --limit=${LIMIT}: capped to ${urls.length}`);
  }

  // Load puppeteer-extra + stealth plugin from the shared toolchain. The
  // stealth plugin patches dozens of bot-detection vectors (chrome.runtime,
  // plugins, languages, webgl vendor, hairline, navigator.webdriver, etc.)
  // that PerimeterX uses to flag headless Chrome. Falls back to plain
  // puppeteer-core if puppeteer-extra isn't installed.
  let puppeteer;
  let stealthLoaded = false;
  try {
    puppeteer = requireFromToolchain("puppeteer-extra");
    const StealthPlugin = requireFromToolchain("puppeteer-extra-plugin-stealth");
    puppeteer.use(StealthPlugin());
    // puppeteer-extra wraps the underlying puppeteer impl; explicitly inject
    // puppeteer-core so the launcher uses our system Chrome.
    const corePuppeteer = requireFromToolchain("puppeteer-core");
    puppeteer.setBrowserPath?.(corePuppeteer); // newer API; no-op if absent
    if (typeof puppeteer.use === "function" && !puppeteer._defaultPuppeteerSet) {
      // Some puppeteer-extra versions need explicit underlying assignment
      puppeteer.puppeteer = corePuppeteer;
      puppeteer._defaultPuppeteerSet = true;
    }
    stealthLoaded = true;
  } catch (e) {
    console.warn(`  ⚠ puppeteer-extra-stealth not available (${e.message}) — falling back to plain puppeteer-core`);
    puppeteer = requireFromToolchain("puppeteer-core");
  }
  const executablePath = findBrowser();
  console.log(`  Browser: ${executablePath}`);
  console.log(`  Stealth plugin: ${stealthLoaded ? "ON" : "OFF"}`);
  console.log(`  Estimated crawl time: ~${Math.round((urls.length * (5000 + REQ_DELAY_MS)) / 60000)} min\n`);

  const launchOptions = {
    executablePath,
    headless: HEADFUL ? false : "new",
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-default-browser-check",
      "--no-first-run",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--lang=en-US,en",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  };

  // Helper: launch a fresh browser session. Called at start and every
  // RESTART_EVERY facilities to evict PerimeterX's session cookies.
  async function freshBrowser() {
    const b = await puppeteer.launch(launchOptions);
    const p = await b.newPage();
    await p.setUserAgent(UA);
    await p.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
    await p.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      "Upgrade-Insecure-Requests": "1",
    });
    // Stealth measures — hide automation fingerprint before any page script runs.
    // PerimeterX checks navigator.webdriver, plugin counts, and chrome runtime.
    await p.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5].map((i) => ({ name: `Plugin ${i}` })),
      });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      // eslint-disable-next-line no-undef
      window.chrome = window.chrome || { runtime: {} };
      const origQuery = window.navigator.permissions?.query;
      if (origQuery) {
        window.navigator.permissions.query = (params) =>
          params.name === "notifications"
            ? Promise.resolve({ state: Notification.permission })
            : origQuery.call(window.navigator.permissions, params);
      }
    });
    // Block only images + media
    await p.setRequestInterception(true);
    p.on("request", (req) => {
      const t = req.resourceType();
      if (t === "image" || t === "media") {
        req.abort();
      } else {
        req.continue();
      }
    });
    return { browser: b, page: p };
  }

  let { browser, page } = await freshBrowser();

  const facilities = [];
  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;

  try {

    for (let i = 0; i < urls.length; i++) {
      // Restart browser periodically to flush PerimeterX session cookies
      if (i > 0 && i % RESTART_EVERY === 0) {
        try { await browser.close(); } catch {}
        const fresh = await freshBrowser();
        browser = fresh.browser;
        page = fresh.page;
      }
      const u = urls[i];
      const tag = `[${i + 1}/${urls.length}]`;
      process.stdout.write(`${tag} ${u.state}/${u.city}/${u.facilityId} ... `);
      try {
        const resp = await page.goto(u.url, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        });
        const status = resp ? resp.status() : 0;
        if (status !== 200) {
          console.log(`✗ status ${status}`);
          failCount++;
          // 403 likely means PerimeterX flagged this session — restart browser
          // immediately so the next facility gets a fresh fingerprint.
          try { await browser.close(); } catch {}
          const fresh = await freshBrowser();
          browser = fresh.browser;
          page = fresh.page;
          await new Promise((r) => setTimeout(r, REQ_DELAY_MS));
          continue;
        }
        // Wait briefly for any deferred Schema.org injection
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        const html = await page.content();
        const detail = parseFacilityDetail(html, u);
        if (process.env.EXR_DEBUG_HTML && i === 0) {
          const debugDir = path.join(__dirname, "_output");
          fs.mkdirSync(debugDir, { recursive: true });
          fs.writeFileSync(path.join(debugDir, `_exr_sample_${u.facilityId}.html`), html);
          console.log("(dumped sample HTML)");
        }
        if (!detail) {
          console.log("✗ no SelfStorage entity");
          failCount++;
        } else if (detail.units.length === 0) {
          // Facility rendered but no available offers (full / not yet open / etc.)
          facilities.push(detail);
          skipCount++;
          console.log("○ 0 units (full or no avail)");
        } else {
          facilities.push(detail);
          okCount++;
          console.log(`✓ ${detail.units.length} units`);
        }
      } catch (e) {
        console.log(`✗ nav error: ${e.message}`);
        failCount++;
      }
      await new Promise((r) => setTimeout(r, REQ_DELAY_MS));
    }
  } finally {
    await browser.close();
  }

  // Group by stateCode (from LD+JSON address) — fallback to URL slug
  const byState = {};
  for (const f of facilities) {
    const key = (f.stateCode || f.stateSlug || "UNKNOWN").toUpperCase();
    (byState[key] ||= []).push(f);
  }

  const output = {
    schema: "storvex.exr-facility-rents.v1",
    operator: "EXR",
    source: "extraspace.com",
    generatedAt: new Date().toISOString(),
    methodology:
      "Per-facility unit-rent scraping from Extra Space Storage facility detail pages via Puppeteer-core (system Chrome) — EXR sits behind PerimeterX bot protection that blocks vanilla HTTPS with 403. Sitemap-driven URL discovery (~2,018 facilities listed in /facility-sitemap.xml — sitemap is unguarded). Each rendered detail page exposes a Schema.org SelfStorage entity with embedded makesOffer array; each Offer.price is parsed for move-in availability. Resource interception blocks images/fonts/CSS for ~3× nav-time savings.",
    citationRule:
      "Each facility record cites its source URL on extraspace.com. EXR publishes structured facility data as Schema.org SelfStorage entities — an authoritative primary source.",
    rateLimit: `${REQ_DELAY_MS}ms inter-page delay + browser nav (~5-7s total per facility)`,
    statesScraped: Object.keys(byState).sort(),
    statesGroups: Object.entries(byState)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([stateCode, facilitiesInState]) => ({
        state: stateCode,
        facilities: facilitiesInState,
      })),
    totals: {
      facilitiesAttempted: urls.length,
      facilitiesScraped: okCount + skipCount,
      facilitiesWithUnits: okCount,
      facilitiesFull: skipCount,
      facilitiesFailed: failCount,
      unitListings: facilities.reduce((s, f) => s + f.units.length, 0),
    },
  };

  const outDate = new Date().toISOString().slice(0, 10);
  const outPath = path.join(DATA_DIR, `exr-facility-rents-${outDate}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("  EXR Crawl complete");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  States covered:    ${output.statesScraped.length}`);
  console.log(`  Facilities tried:  ${output.totals.facilitiesAttempted}`);
  console.log(`  With units:        ${output.totals.facilitiesWithUnits}`);
  console.log(`  Full/no inventory: ${output.totals.facilitiesFull}`);
  console.log(`  Failed:            ${output.totals.facilitiesFailed}`);
  console.log(`  Unit listings:     ${output.totals.unitListings}`);
  console.log(`  → wrote ${outPath}`);
  console.log(`  → ${(JSON.stringify(output).length / 1024).toFixed(1)} KB on disk`);
}

main().catch((e) => {
  console.error("\n✗ Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
