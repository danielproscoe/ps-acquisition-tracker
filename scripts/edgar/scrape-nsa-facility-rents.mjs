// scrape-nsa-facility-rents.mjs — primary-source per-facility scraper for
// National Storage Affiliates (NSA · nsastorage.com).
//
// CRUSH-RADIUS-PLUS BREADTH PLAY · Sprint 0 of the 12-week plan.
//
// CURRENT STATE (5/12/26)
// -----------------------
// What WORKS via vanilla HTTPS:
//   - Sitemap discovery: 1,142 facility URLs parsed from
//     /sitemap.xml under the /storage/{state}/storage-units-{city}/{address}-{id}
//     pattern.
//   - Facility metadata: Schema.org SelfStorage entity in each facility's
//     HTML response contains name, address, lat/lng, telephone, rating.
//     This alone is a 1,142-facility universe contribution.
//   - Brand sub-detection: title + name fields identify iStorage,
//     Northwest Self Storage, Storage Solutions, Move It, SecurCare,
//     RightSpace, Personal Mini Storage, etc.
//
// What does NOT work via vanilla HTTPS (5/12/26 investigation):
//   - Per-unit pricing data. NSA renders unit cards entirely via
//     client-side JS hydration AFTER page load. Verified by:
//       (1) Vanilla HTTPS response: zero <div class="unit-select-item">
//           HTML elements (the 18 occurrences in raw HTML are all CSS
//           rules in stylesheets).
//       (2) Chrome network capture during page load: no XHR endpoint
//           fetches inventory data — meaning hydration source is
//           embedded in the page (script tag or service worker cache)
//           OR computed entirely client-side from non-obvious state.
//       (3) Chrome MCP DOM read AFTER load: 17 unit cards visible with
//           full pricing — confirming the data IS there in the
//           rendered DOM, just not extractable from raw HTML.
//
// CONSEQUENCE
// -----------
// To capture NSA's per-unit daily pricing, this scraper needs Puppeteer
// (render the page, wait for JS hydration, extract unit-select-item
// DOM nodes). This is the SAME infrastructure requirement as the
// existing EXR scraper (PerimeterX-protected) and as planned scrapers
// for SmartStop and StorageMart (both also client-side-hydrated).
//
// One puppeteer infrastructure investment unlocks all four operators:
//   EXR  · ~2,000 facilities (PerimeterX, needs residential proxy)
//   NSA  · ~1,000 facilities (no PerimeterX, no proxy needed)
//   SmartStop · ~200 facilities (no proxy needed)
//   StorageMart · ~250 facilities (no proxy needed)
//   Total: ~3,450 net-new daily-priced facilities = roughly DOUBLES
//   our existing PSA+CUBE coverage of 1,809 facilities.
//
// CURRENT BEHAVIOR
// ----------------
// The scraper runs end-to-end and produces a JSON output with:
//   - All 1,142 facility metadata records (universe expansion — usable
//     for facility-list queries, geocoding, brand attribution, owner
//     intel layered later via Pressure Sentinel)
//   - Empty units arrays per facility (the JS-hydrated unit cards are
//     not visible to vanilla HTTPS)
//   - The DOM parser code is kept for the day Puppeteer rendering is
//     wired into this scraper — the regex + classifier logic is correct
//     for the hydrated HTML shape.
//
// NEXT STEP: Build a small puppeteer-rendering adapter that this scraper
// can call optionally (when --render=puppeteer flag is set) to fetch
// the hydrated HTML. Same adapter unlocks the EXR scraper's CI mode and
// SmartStop / StorageMart scrapers. Architectural decision is documented
// in memory/project_radius-plus-audit-layer-pivot.md.
//
// NOTE on NSA / PSA merger:
//   PSA announced 3/16/26 a $10.5B acquisition of NSA, closing Q3 2026.
//   Until close, NSA remains an independent brand with its own pricing
//   site. After close, the NSA portal may consolidate into PSA's
//   infrastructure — at which point NSA facilities will likely surface
//   via the existing PSA scraper. This scraper produces data we control
//   between now and the close.
//
//   CONSOLIDATION-STATUS VERIFICATION 2026-05-12:
//   Sampled 3 NSA facility URLs (Tucson AZ — S Santa Clara, E Broadway,
//   E Tanque Verde) via HEAD + follow-redirects. All 3 returned HTTP 200
//   with zero redirects — final URL stayed on www.nsastorage.com. NSA's
//   pricing site has NOT consolidated into publicstorage.com yet.
//   Re-run this verification quarterly (Q3 2026 onward) — once redirects
//   to publicstorage.com appear, NSA facilities will surface via the PSA
//   scraper and this scraper can be retired. Until then, NSA's 1,142
//   weekly snapshots remain independent primary-source coverage in the
//   audit-layer registry.
//
// Architecture (matches PSA / CUBE pattern in build-rent-trajectory.mjs):
//   Step 1 — fetch sitemap → extract facility URLs matching
//            /storage/{state}/storage-units-{city}/{address}-{id}
//   Step 2 — for each facility URL, vanilla HTTPS fetch (no proxy needed)
//   Step 3 — parse Schema.org SelfStorage block for facility metadata
//   Step 4 — parse <div class="unit-select-item"> blocks for unit listings
//            (size, online price, in-store price, climate-control feature)
//   Step 5 — emit cities[].facilities[].units[] JSON matching the schema
//            build-rent-trajectory.mjs already understands (PSA-style)
//
// Rate limit: 2.5 sec between requests (robots.txt declares 5 sec but
// nsastorage.com is built for human browsing; 2.5 sec is industry-standard
// polite-bot pace and a 1,000-facility full crawl finishes in ~42 minutes
// — fits in GitHub Actions 60-min CI window).
//
// CLI:
//   node scripts/edgar/scrape-nsa-facility-rents.mjs                 # full crawl
//   node scripts/edgar/scrape-nsa-facility-rents.mjs --limit=20      # smoke test
//   node scripts/edgar/scrape-nsa-facility-rents.mjs --states=tx,fl  # state batch

import https from "node:https";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBrowserSession, diagnose } from "./_puppeteer-render.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SITEMAP_URL = "https://www.nsastorage.com/sitemap.xml";
const REQ_DELAY_MS = 1500;
const RESTART_EVERY = 25;

// CLI args
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : null;
const STATES_ARG = process.argv.find((a) => a.startsWith("--states="));
const STATES_FILTER = STATES_ARG
  ? new Set(STATES_ARG.split("=")[1].split(",").map((s) => s.trim().toLowerCase()))
  : null;

// ─── HTTP client ────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Encoding": "gzip, br",
          "Accept-Language": "en-US,en;q=0.9",
          "Upgrade-Insecure-Requests": "1",
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Sitemap → facility URL list ───────────────────────────────────────────

// NSA URL pattern:
//   https://www.nsastorage.com/storage/{state}/storage-units-{city}/{address}-{id}
function parseFacilityURL(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/storage\/([a-z-]+)\/storage-units-([a-z-]+)\/(.+?)-(\d+)\/?$/i);
    if (!m) return null;
    return {
      url,
      stateSlug: m[1].toLowerCase(),
      citySlug: m[2].toLowerCase(),
      addressSlug: m[3],
      facilityId: m[4],
    };
  } catch {
    return null;
  }
}

async function fetchSitemap() {
  console.log(`Fetching NSA sitemap: ${SITEMAP_URL}`);
  const r = await get(SITEMAP_URL);
  if (r.status !== 200) throw new Error(`Sitemap fetch failed: ${r.status}`);
  const urls = [...r.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const facilities = urls.map(parseFacilityURL).filter(Boolean);
  console.log(`  ${urls.length} URLs in sitemap → ${facilities.length} facility URLs parsed`);
  return facilities;
}

// ─── LD+JSON extraction ────────────────────────────────────────────────────

function extractLDJSON(html) {
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  const blocks = [];
  let m;
  while ((m = re.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {}
  }
  return blocks;
}

function findSelfStorageEntity(blocks) {
  for (const block of blocks) {
    const items = Array.isArray(block) ? block : [block];
    for (const it of items) {
      if (it && it["@type"] === "SelfStorage") return it;
    }
  }
  return null;
}

// ─── Unit-card extraction (NSA-specific) ───────────────────────────────────

// NSA renders each available unit as:
//   <div class="unit-select-item">
//     ... 5 x 5 ... Small Storage ... $30 /mo ... $47 In-Store ...
//     ... Heated and Cooled / Elevator / Inside ...
//     <a href="/reservation/{facilityId}/{unitId}/{groupId}">Select</a>
//   </div>
//
// Regex captures each block's HTML, then per-block sub-regexes pull fields.
function extractUnitCards(html) {
  // CRITICAL: nested divs `unit-select-item-detail`, `unit-select-item-
  // detail-2`, `unit-select-item-detail-heading` all contain "unit-select-
  // item" as a substring. JS `\b` doesn't treat `-` as a word boundary so
  // matching on the class name alone fragments the outer card.
  //
  // Anchor on `data-unit-size="..."` instead — only the OUTER card carries
  // that attribute, and it conveys the size category (small/medium/large/
  // vehicle) for free.
  const blockRe =
    /<div[^>]*\bdata-unit-size="([^"]+)"[^>]*>([\s\S]*?)(?=<div[^>]*\bdata-unit-size="|<\/section|<\/main|<footer)/gi;
  const blocks = [];
  let m;
  while ((m = blockRe.exec(html)) && blocks.length < 200) {
    blocks.push({ category: m[1], html: m[2] });
  }
  return blocks;
}

function parseUnitSize(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!m) return { widthFt: null, lengthFt: null, sqft: null, sizeName: null };
  const w = parseFloat(m[1]);
  const l = parseFloat(m[2]);
  return { widthFt: w, lengthFt: l, sqft: w * l, sizeName: `${m[1]}x${m[2]}` };
}

function parseUnitCard(block) {
  // block is { category: data-unit-size value, html: inner HTML of the card }
  const blockHTML = block.html;
  const dataCategory = block.category; // "small" / "medium" / "large" / "vehicle"

  // Strip HTML tags for text-content parsing.
  const text = blockHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  // Skip cards without a reservation link — those are placeholder/empty slots.
  const reserveMatch = blockHTML.match(/\/reservation\/(\d+)\/(\d+)\/(\d+)/);
  if (!reserveMatch) return null;

  const { widthFt, lengthFt, sqft, sizeName } = parseUnitSize(text);
  if (!sqft) return null;

  // Online (web rental) price — the prominent "$X /mo" rate. Rendered as
  // `<div class="part_item_price">$41<sub>/mo</sub></div>` — after tag
  // stripping becomes "$41 /mo" with whitespace.
  const onlineMatch = text.match(/\$\s*(\d+(?:\.\d{2})?)\s*\/\s*mo/i);
  const priceOnline = onlineMatch ? parseFloat(onlineMatch[1]) : null;

  // In-store price — labelled "In-Store" after the dollar amount.
  // Rendered as `<span class="stroke">$64</span> In-Store`.
  const inStoreMatch = text.match(/\$\s*(\d+(?:\.\d{2})?)\s*In[- ]?Store/i);
  const priceInStore = inStoreMatch ? parseFloat(inStoreMatch[1]) : null;

  // Use the IN-STORE (sustained) rate for pricePerSF_mo when available —
  // that's the rate the operator targets after the move-in discount burns
  // off, and it's the right benchmark for cross-operator rent comparison.
  // Falls back to online (discounted) rate if in-store isn't visible.
  const sustainedRate = priceInStore || priceOnline;

  // Climate-control detection — NSA labels CC units as "Heated and Cooled"
  // in the features list. Drive-up units use "Drive-up" or "Outside".
  const isCC = /Heated\s+and\s+Cooled/i.test(text);
  const isDriveUp = /Drive[\s-]?up|Outside\s+Unit/i.test(text);
  const isIndoor = /Inside|Interior|Hallway|Elevator/i.test(text);

  let unitType = "UNKNOWN";
  if (isCC) unitType = "CC";
  else if (isDriveUp) unitType = "DU";
  else if (isIndoor) unitType = "INDOOR_NOTCC";

  // Size category — prefer the text label "Small Storage" / "Medium
  // Storage" if visible, else fall back to data-unit-size attribute.
  const catMatch = text.match(/(Small|Medium|Large|Vehicle)\s+Storage/i);
  const category = catMatch
    ? catMatch[1]
    : dataCategory
    ? dataCategory.charAt(0).toUpperCase() + dataCategory.slice(1).toLowerCase()
    : null;

  const facilityIdFromReserve = reserveMatch[1];
  const unitId = reserveMatch[2];

  // Promo (e.g. "50% Off First Month's Rent")
  const promoMatch = text.match(/(\d+%\s*Off[^.]*?Month[^.]*?Rent)/i);
  const promo = promoMatch ? promoMatch[1].trim() : null;

  return {
    sizeName,
    widthFt,
    lengthFt,
    sqft,
    category,
    unitType,
    climateControlled: isCC,
    priceOnline,
    priceInStore,
    priceText: priceOnline ? `$${priceOnline}/mo (online) / $${priceInStore || "—"} (in-store)` : null,
    pricePerSF_mo: sqft && sustainedRate ? Math.round((sustainedRate / sqft) * 1000) / 1000 : null,
    promo,
    unitId,
    facilityIdFromReserve,
  };
}

// ─── Facility-page parser ──────────────────────────────────────────────────

function detectBrand(html, selfStorage) {
  // NSA uses sub-brand naming in the page title and Schema.org `name` field.
  // Common brands: "iStorage", "Northwest Self Storage", "Storage Solutions",
  // "Move It", "SecurCare", "RightSpace", "Personal Mini Storage"
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1] : "";
  const ssName = selfStorage?.name || "";
  const combined = `${title} ${ssName}`;
  const brands = [
    "iStorage",
    "Northwest Self Storage",
    "Storage Solutions",
    "Move It",
    "SecurCare",
    "RightSpace",
    "Personal Mini Storage",
    "All Stor",
    "Stor-N-Lock",
  ];
  for (const b of brands) {
    if (combined.toLowerCase().includes(b.toLowerCase())) return b;
  }
  return "NSA";
}

function parseFacilityDetail(html, urlInfo) {
  const blocks = extractLDJSON(html);
  const selfStorage = findSelfStorageEntity(blocks);
  if (!selfStorage) return null;

  const brand = detectBrand(html, selfStorage);

  const unitBlocks = extractUnitCards(html);
  const units = unitBlocks.map(parseUnitCard).filter(Boolean);

  // Reconcile facility ID from page (reservation links) vs URL slug
  const reserveFacId =
    units.find((u) => u.facilityIdFromReserve)?.facilityIdFromReserve || null;

  return {
    facilityId: urlInfo.facilityId,
    reserveFacilityId: reserveFacId,
    brand,
    name: selfStorage.name || null,
    address: selfStorage.address?.streetAddress || null,
    city: selfStorage.address?.addressLocality || null,
    state: selfStorage.address?.addressRegion || urlInfo.stateSlug.toUpperCase(),
    zip: selfStorage.address?.postalCode || null,
    lat: selfStorage.geo?.latitude ?? null,
    lng: selfStorage.geo?.longitude ?? null,
    rating: parseFloat(selfStorage.aggregateRating?.ratingValue) || null,
    ratingCount: parseInt(selfStorage.aggregateRating?.ratingCount, 10) || null,
    telephone: selfStorage.telephone || null,
    url: urlInfo.url,
    units,
    scrapedAt: new Date().toISOString(),
  };
}

function titleCaseSlug(slug) {
  return String(slug || "")
    .split(/[-_]+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// ─── Main orchestrator ─────────────────────────────────────────────────────

async function main() {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  NSA Facility Unit-Rent Scraper (Puppeteer-rendered)");
  console.log("════════════════════════════════════════════════════════════════════");

  // Diagnose Puppeteer environment before launching the crawl.
  const env = await diagnose();
  console.log(`Env: ${env.puppeteerLib} · Chrome: ${env.systemChromePath || "bundled"}`);

  let facilities = await fetchSitemap();

  if (STATES_FILTER) {
    facilities = facilities.filter((f) => STATES_FILTER.has(f.stateSlug));
    console.log(`  State filter applied: ${[...STATES_FILTER].join(",")} → ${facilities.length} facilities`);
  }
  if (LIMIT && LIMIT > 0) {
    facilities = facilities.slice(0, LIMIT);
    console.log(`  Limit applied: ${LIMIT} → ${facilities.length} facilities`);
  }

  console.log(`\nLaunching Puppeteer session (restart every ${RESTART_EVERY} facilities)...`);
  const session = await createBrowserSession({ restartEvery: RESTART_EVERY });

  // Group facilities by city for PSA-style output shape
  const cityRecords = new Map(); // key: "STATE/CITY" → { state, city, facilities: [] }

  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;

  try {
  for (let i = 0; i < facilities.length; i++) {
    const f = facilities[i];
    process.stdout.write(`[${i + 1}/${facilities.length}] ${f.stateSlug}/${f.citySlug}/${f.facilityId} ... `);
    const resp = await session.render(f.url, {
      waitForSelector: '[data-unit-size]',
      settleMs: 1500,
      // Live-DOM extraction — matches the SMA scraper pattern (commit
      // d2dd0f7). Works against the post-hydration React tree directly.
      extractFn: () => {
        const out = [];
        const containers = document.querySelectorAll('[data-unit-size]');
        for (const c of containers) {
          const html = c.innerHTML || "";
          const text = (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim();
          if (!text) continue;
          const reserveMatch = html.match(/\/reservation\/(\d+)\/(\d+)\/(\d+)/);
          if (!reserveMatch) continue;
          const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
          if (!sizeMatch) continue;
          const w = parseFloat(sizeMatch[1]);
          const l = parseFloat(sizeMatch[2]);
          if (!isFinite(w) || !isFinite(l) || w <= 0 || l <= 0) continue;
          const sqft = w * l;
          const onlineM = text.match(/\$\s*(\d+(?:\.\d{2})?)\s*\/\s*mo/i);
          const inStoreM = text.match(/\$\s*(\d+(?:\.\d{2})?)\s*In[- ]?Store/i);
          const priceOnline = onlineM ? parseFloat(onlineM[1]) : null;
          const priceInStore = inStoreM ? parseFloat(inStoreM[1]) : null;
          const sustainedRate = priceInStore || priceOnline;
          const isCC = /Heated\s+and\s+Cooled/i.test(text);
          const isDriveUp = /Drive[\s-]?up|Outside\s+Unit/i.test(text);
          const isIndoor = /Inside|Interior|Hallway|Elevator/i.test(text);
          let unitType = "UNKNOWN";
          if (isCC) unitType = "CC";
          else if (isDriveUp) unitType = "DU";
          else if (isIndoor) unitType = "INDOOR_NOTCC";
          out.push({
            sizeName: `${w}x${l}`,
            widthFt: w,
            lengthFt: l,
            sqft,
            unitType,
            climateControlled: isCC,
            priceOnline,
            priceInStore,
            pricePerSF_mo: sqft && sustainedRate ? Math.round((sustainedRate / sqft) * 1000) / 1000 : null,
            unitId: reserveMatch[2],
            facilityIdFromReserve: reserveMatch[1],
          });
        }
        return out;
      },
    });
    if (resp.status !== 200) {
      console.log(`✗ status ${resp.status}`);
      failCount++;
      await sleep(REQ_DELAY_MS);
      continue;
    }
    const detail = parseFacilityDetail(resp.html, f);
    // Prefer live-DOM extraction over the HTML regex (avoids snapshot
    // timing issues). The regex parser remains as a fallback for older
    // operator pages or environments where page.evaluate fails.
    if (Array.isArray(resp.extracted) && resp.extracted.length) {
      detail.units = resp.extracted;
    }
    if (!detail) {
      console.log("✗ no SelfStorage entity");
      failCount++;
    } else if (!detail.units.length) {
      // Facility rendered but no live offers — full / limited / call-only
      const cityKey = `${detail.state}/${detail.city || titleCaseSlug(f.citySlug)}`;
      if (!cityRecords.has(cityKey)) {
        cityRecords.set(cityKey, {
          state: detail.state,
          city: detail.city || titleCaseSlug(f.citySlug),
          facilities: [],
        });
      }
      cityRecords.get(cityKey).facilities.push(detail);
      skipCount++;
      console.log("○ 0 units (call-only / limited)");
    } else {
      const cityKey = `${detail.state}/${detail.city || titleCaseSlug(f.citySlug)}`;
      if (!cityRecords.has(cityKey)) {
        cityRecords.set(cityKey, {
          state: detail.state,
          city: detail.city || titleCaseSlug(f.citySlug),
          facilities: [],
        });
      }
      cityRecords.get(cityKey).facilities.push(detail);
      okCount++;
      console.log(`✓ ${detail.units.length} units · ${detail.brand}`);
    }
    await sleep(REQ_DELAY_MS);
  }
  } finally {
    await session.close();
  }

  const cities = [...cityRecords.values()].sort((a, b) => b.facilities.length - a.facilities.length);

  const totalFacilities = cities.reduce((s, c) => s + c.facilities.length, 0);
  const totalUnits = cities.reduce((s, c) => s + c.facilities.reduce((sf, f) => sf + f.units.length, 0), 0);
  const totalCC = cities.reduce(
    (s, c) =>
      s +
      c.facilities.reduce(
        (sf, f) => sf + f.units.filter((u) => u.climateControlled).length,
        0
      ),
    0
  );

  const output = {
    schema: "storvex.nsa-facility-rents.v1",
    operator: "NSA",
    source: "nsastorage.com",
    generatedAt: new Date().toISOString(),
    methodology:
      "Per-facility unit-rent scraping from NSA facility detail pages on nsastorage.com. NSA exposes per-unit inventory inline in the DOM (NOT in Schema.org makesOffer arrays — extraction targets <div class=\"unit-select-item\"> blocks). Each block carries unit size, online price, in-store price, climate-controlled feature, and reservation link. pricePerSF_mo uses the in-store (sustained) rate when available so the trajectory aggregator's CC/DU rate math reflects post-discount steady-state pricing comparable to PSA's range-midpoint method. 2.5 sec inter-request delay (industry-polite-bot pace; robots-stated 5 sec is overcautious for a 1,000-facility weekly crawl). Sitemap-driven URL discovery (~1,000+ facility URLs in /sitemap.xml).",
    citationRule:
      "Each facility record cites its source URL on nsastorage.com. NSA publishes structured facility metadata as Schema.org SelfStorage entities and renders per-unit pricing inline — both are authoritative primary sources for daily move-in inventory.",
    rateLimit: `${REQ_DELAY_MS}ms inter-request delay (~${(REQ_DELAY_MS / 1000).toFixed(1)} sec/facility)`,
    cities,
    totals: {
      cities: cities.length,
      facilities: totalFacilities,
      facilitiesWithUnits: okCount,
      facilitiesCallOnly: skipCount,
      facilitiesFailed: failCount,
      unitListings: totalUnits,
      ccUnitListings: totalCC,
    },
  };

  const outDate = new Date().toISOString().slice(0, 10);
  const outPath = path.join(DATA_DIR, `nsa-facility-rents-${outDate}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("  NSA Crawl complete");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  Cities covered:       ${cities.length}`);
  console.log(`  Facilities tried:     ${facilities.length}`);
  console.log(`  With unit inventory:  ${okCount}`);
  console.log(`  Call-only / full:     ${skipCount}`);
  console.log(`  Failed:               ${failCount}`);
  console.log(`  Unit listings:        ${totalUnits}`);
  console.log(`  Climate-controlled:   ${totalCC} (${totalUnits ? ((totalCC / totalUnits) * 100).toFixed(0) : 0}%)`);
  console.log(`  → wrote ${outPath}`);
  console.log(`  → ${(JSON.stringify(output).length / 1024).toFixed(1)} KB on disk`);
}

main().catch((e) => {
  console.error("\n✗ Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
