// scrape-cube-facility-rents.mjs — primary-source per-facility unit-rent scraper
// for CubeSmart (CUBE).
//
// CUBE returns 200 OK on facility detail pages with vanilla HTTPS — no PerimeterX
// or Cloudflare bot challenge — but the unit-rent data is NOT in Schema.org
// makesOffer arrays the way PSA publishes. Instead, CUBE renders unit listings
// as `<li class="csStorageSizeDimension">` elements with HTML data attributes:
//
//   data-unitprice="272"       ← clean discount price (web rate, integer dollars)
//   data-encodedfeatures="CEE" ← features (Climate, Elevator, etc.)
//   data-tab-group="Small"     ← size tier
//   data-price="$272"          ← display price text
//   class="...climate-controlled-unit"  ← unit type (climate-controlled-unit | drive-up-unit | regular-unit)
//
// Inside the <li>: a `<p>` element with the size text "5'x5'* Storage Unit",
// a `ptDiscountPriceSpan` ($272.25 — promo web rate),
// a `ptOriginalPriceSpan` ($363.00 — strike-through standard rate).
//
// Storvex captures BOTH the discount and standard rate, plus the promo % —
// richer signal than PSA (which only exposes the move-in price).
//
// URL discovery: https://www.cubesmart.com/sitemap-facility.xml is unguarded
// and lists all 1,551 CUBE-managed facilities with stable IDs. The URL pattern
// is /{state}-self-storage/{city-area}-self-storage/{facilityId}.html.

import https from "node:https";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const REQ_DELAY_MS = 1100; // ~1 req/sec rate limit

const SITEMAP_URL = "https://www.cubesmart.com/sitemap-facility.xml";

// Optional CLI: pass --limit N to crawl only the first N facilities (smoke test).
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : null;

// Optional CLI: pass --states=ca,tx,az to filter to a subset.
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

// ─── Sitemap parsing ────────────────────────────────────────────────────────

// Parse facility URL → { state, city, facilityId }
//   /alabama-self-storage/auburn-self-storage/4243.html
//   → { state: "alabama", city: "auburn", facilityId: "4243" }
//
// Some metros use composite paths (e.g. nyc boroughs):
//   /new-york-self-storage/manhattan/upper-east-side-self-storage/4400.html
// — for those we keep `state` from the first segment and use the LAST
// non-numeric path segment minus "-self-storage" as the city.
function parseFacilityURL(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    if (!segments.length) return null;

    const stateSeg = segments[0];
    if (!stateSeg.endsWith("-self-storage")) return null;
    const state = stateSeg.replace(/-self-storage$/, "");

    // Last segment is "{facilityId}.html"
    const lastSeg = segments[segments.length - 1];
    const idMatch = lastSeg.match(/^(\d+)\.html$/);
    if (!idMatch) return null;
    const facilityId = idMatch[1];

    // City = second-to-last segment with -self-storage stripped
    let citySeg = segments[segments.length - 2] || "";
    citySeg = citySeg.replace(/-self-storage$/, "");

    return { state, city: citySeg, facilityId, url };
  } catch {
    return null;
  }
}

async function fetchSitemap() {
  console.log(`Fetching CUBE sitemap: ${SITEMAP_URL}`);
  const r = await get(SITEMAP_URL);
  if (r.status !== 200) {
    throw new Error(`Sitemap fetch failed: ${r.status}`);
  }
  const urls = [...r.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log(`  ${urls.length} URLs in sitemap`);
  const parsed = urls.map(parseFacilityURL).filter(Boolean);
  console.log(`  ${parsed.length} valid facility URLs`);
  return parsed;
}

// ─── Detail page HTML parsing ───────────────────────────────────────────────

// Decode HTML entities most likely to appear in CUBE pages
function decodeHTMLEntities(s) {
  return String(s)
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

// Parse "5'x5'*" or "5'x5' Storage Unit" or "7.5'x10'" or "10x15" → { width, length, sqft }
// Handles decimals (CUBE has 7.5'x10' on some pages).
function parseUnitDimensions(text) {
  if (!text) return { width: null, length: null, sqft: null };
  const m = decodeHTMLEntities(text).match(/(\d{1,3}(?:\.\d+)?)\s*['′]?\s*[x×]\s*(\d{1,3}(?:\.\d+)?)/i);
  if (!m) return { width: null, length: null, sqft: null };
  const w = parseFloat(m[1]);
  const l = parseFloat(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(l) || w <= 0 || l <= 0) {
    return { width: null, length: null, sqft: null };
  }
  return { width: w, length: l, sqft: w * l };
}

// Classify CUBE unit type from the row's class list.
// CUBE class patterns:
//   `climate-controlled-unit` → CC
//   `drive-up-unit` → DU
//   `regular-unit` (no climate, indoor) → INDOOR_NOTCC
//   default → UNKNOWN
function classifyUnitType(rowClasses, dataEncodedFeatures) {
  const cls = String(rowClasses || "").toLowerCase();
  if (cls.includes("climate-controlled-unit")) return "CC";
  if (cls.includes("drive-up-unit")) return "DU";
  if (cls.includes("vehicle-unit") || cls.includes("outdoor-unit")) return "OUTDOOR";
  if (cls.includes("regular-unit")) return "INDOOR_NOTCC";

  // Fallback: encoded features. CUBE uses character codes:
  //   C=Climate, E=Elevator, etc. We rely primarily on class but use this
  //   as backup when class is absent.
  const feats = String(dataEncodedFeatures || "").toUpperCase();
  if (feats.includes("C")) return "CC";
  return "UNKNOWN";
}

// Parse a single unit listing block extracted from the HTML.
// Returns null if essential fields missing.
function parseUnitBlock(blockHTML, fallbackPrice) {
  // Row classes: <div ... class="row shadow-border csUnitFacilityListing climate-controlled-unit" data-price="$272">
  const classMatch = blockHTML.match(/class="([^"]*csUnitFacilityListing[^"]*)"/);
  const rowClasses = classMatch ? classMatch[1] : "";

  const featuresMatch = blockHTML.match(/data-encodedfeatures="([^"]*)"/);
  const encodedFeatures = featuresMatch ? featuresMatch[1] : "";

  const unitType = classifyUnitType(rowClasses, encodedFeatures);

  // Discount (web) price: <span class="vdmParentText control-price ptDiscountPriceSpan">$272.25</span>
  const discountMatch = blockHTML.match(
    /class="[^"]*ptDiscountPriceSpan[^"]*"[^>]*>\s*\$?([\d,]+(?:\.\d+)?)/
  );
  const discountPrice = discountMatch ? parseFloat(discountMatch[1].replace(/,/g, "")) : null;

  // Standard (in-store) price: <span class="strikeprice ... ptOriginalPriceSpan">$363.00</span>
  const standardMatch = blockHTML.match(
    /class="[^"]*ptOriginalPriceSpan[^"]*"[^>]*>\s*\$?([\d,]+(?:\.\d+)?)/
  );
  const standardPrice = standardMatch ? parseFloat(standardMatch[1].replace(/,/g, "")) : null;

  // Size text — visually-hidden span like:
  //   <span class="visually-hidden">5 feet by 5 feet Storage Unit with: climate controlled, elevator access</span>
  // OR aria-hidden:
  //   <span aria-hidden="true">5'x5'* Storage Unit</span>
  // Extract from either path.
  let sizeText = null;
  const ariaMatch = blockHTML.match(/<span[^>]*aria-hidden="true"[^>]*>([^<]+)<\/span>/);
  if (ariaMatch) sizeText = decodeHTMLEntities(ariaMatch[1]).trim();
  if (!sizeText) {
    const hiddenMatch = blockHTML.match(/<span[^>]*class="visually-hidden"[^>]*>([^<]+)<\/span>/);
    if (hiddenMatch) {
      const hiddenText = decodeHTMLEntities(hiddenMatch[1]);
      const sizeMatch = hiddenText.match(/(\d{1,2}\s*feet\s*by\s*\d{1,2}\s*feet)/i);
      if (sizeMatch) {
        const s = sizeMatch[1].match(/(\d{1,2})\s*feet\s*by\s*(\d{1,2})\s*feet/i);
        if (s) sizeText = `${s[1]}x${s[2]}`;
      }
    }
  }

  const dims = parseUnitDimensions(sizeText);

  // Promo banner: <span class="promotions-text">25% OFF<span...
  const promoMatch = blockHTML.match(/class="promotions-text"[^>]*>\s*(\d{1,2})\s*%\s*OFF/i);
  const promoPct = promoMatch ? parseInt(promoMatch[1], 10) : null;

  // Features list: <li>Climate Controlled</li><li>Elevator Access</li>
  const featuresList = [...blockHTML.matchAll(/<li>\s*([^<]+?)\s*<\/li>/g)]
    .map((m) => decodeHTMLEntities(m[1]).trim())
    .filter((s) => s.length > 0 && s.length < 60);

  // Effective move-in price = discount if available, else standard, else fallback
  const movein = discountPrice ?? standardPrice ?? fallbackPrice;
  if (movein == null) return null;
  if (!dims.sqft) return null; // can't compute $/SF without size

  return {
    sizeName: sizeText,
    widthFt: dims.width,
    lengthFt: dims.length,
    sqft: dims.sqft,
    unitType,
    moveInPrice: movein,
    standardPrice: standardPrice ?? null,
    discountPrice: discountPrice ?? null,
    promoPct,
    pricePerSF_mo: Math.round((movein / dims.sqft) * 1000) / 1000,
    standardPricePerSF_mo: standardPrice ? Math.round((standardPrice / dims.sqft) * 1000) / 1000 : null,
    features: featuresList,
    encodedFeatures,
    rowClasses,
  };
}

// Find the SelfStorage entity (with name + address + geo) inside CUBE's @graph
function extractSelfStorageEntity(html) {
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const graph = Array.isArray(parsed) ? parsed : parsed["@graph"] || [parsed];
      for (const item of graph) {
        if (item && item["@type"] === "SelfStorage") return item;
      }
    } catch {}
  }
  return null;
}

function parseFacilityDetail(html, urlInfo) {
  const ss = extractSelfStorageEntity(html);

  // Each unit listing is a <li class="csStorageSizeDimension" id="<UUID>" ordinal="">
  // wrapping a <div data-group="panelitem" data-unitprice="..." ...> with the price
  // spans inside. The features list `<ul><li>Climate Controlled</li>...</ul>` lives
  // INSIDE each unit block — so a naive `</li>` boundary regex would close the
  // outer LI early. We use the LI's `id="<UUID>"` attribute as the discriminator
  // (features `<li>` tags don't have an id) and split between successive openings.
  const unitBlocks = [];
  const startRe = /<li[^>]+class="csStorageSizeDimension"[^>]+id="[0-9a-fA-F-]{8,}"/g;
  const matches = [];
  let sm;
  while ((sm = startRe.exec(html))) {
    matches.push({ index: sm.index });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : html.length;
    unitBlocks.push(html.slice(start, end));
  }

  const units = [];
  for (const block of unitBlocks) {
    // The data-price="$272" attribute lives on the inner div, peel it for fallback
    const fallbackPriceMatch = block.match(/data-price="\$?([\d,]+(?:\.\d+)?)/);
    const fallbackPrice = fallbackPriceMatch ? parseFloat(fallbackPriceMatch[1].replace(/,/g, "")) : null;
    const u = parseUnitBlock(block, fallbackPrice);
    if (u) units.push(u);
  }

  return {
    facilityUrl: urlInfo.url,
    facilityId: urlInfo.facilityId,
    state: urlInfo.state,
    cityFromUrl: urlInfo.city,
    name: ss?.name || null,
    telephone: ss?.telephone || null,
    address: ss?.address?.streetAddress || null,
    city: ss?.address?.addressLocality || null,
    stateCode: ss?.address?.addressRegion || null,
    zip: ss?.address?.postalCode || null,
    lat: ss?.geo?.latitude ?? null,
    lng: ss?.geo?.longitude ?? null,
    rating: parseFloat(ss?.aggregateRating?.ratingValue) || null,
    ratingCount: parseInt(ss?.aggregateRating?.ratingCount, 10) || null,
    priceRange: ss?.priceRange || null,
    units,
    scrapedAt: new Date().toISOString(),
  };
}

// ─── Main crawl orchestrator ────────────────────────────────────────────────

async function main() {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  CubeSmart Facility Unit-Rent Scraper");
  console.log("════════════════════════════════════════════════════════════════════");

  let urls = await fetchSitemap();

  if (STATES_FILTER) {
    const before = urls.length;
    urls = urls.filter((u) => STATES_FILTER.has(u.state));
    console.log(`  States filter ${[...STATES_FILTER].join(",")}: ${before} → ${urls.length} URLs`);
  }

  if (LIMIT) {
    urls = urls.slice(0, LIMIT);
    console.log(`  --limit=${LIMIT}: capped to ${urls.length} URLs`);
  }

  console.log(`  Estimated crawl time: ~${Math.round((urls.length * REQ_DELAY_MS) / 60000)} min at 1 req/sec\n`);

  const facilities = [];
  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;
  for (let i = 0; i < urls.length; i++) {
    const urlInfo = urls[i];
    const tag = `[${i + 1}/${urls.length}]`;
    process.stdout.write(`${tag} ${urlInfo.state}/${urlInfo.city}/${urlInfo.facilityId} ... `);
    const r = await get(urlInfo.url);
    if (r.status !== 200) {
      console.log(`✗ ${r.status}`);
      failCount++;
      await sleep(REQ_DELAY_MS);
      continue;
    }
    const detail = parseFacilityDetail(r.body, urlInfo);
    if (detail.units.length > 0) {
      facilities.push(detail);
      okCount++;
      console.log(`✓ ${detail.units.length} units`);
    } else {
      // No units — either the facility is full (no available inventory) OR our parser
      // missed something. Track but don't bail; some legitimate fully-occupied
      // facilities surface as 0 units on web search.
      facilities.push(detail);
      skipCount++;
      console.log(`○ 0 units (full or no avail)`);
    }
    await sleep(REQ_DELAY_MS);
  }

  // Group by state for the output structure (CUBE doesn't have an MSA listing
  // page concept like PSA — we group geographically and let the aggregator
  // resolve city → MSA via existing edgarCompIndex.resolveCityToMSA).
  const byState = {};
  for (const f of facilities) {
    const key = f.stateCode || f.state || "UNKNOWN";
    (byState[key] ||= []).push(f);
  }

  const output = {
    schema: "storvex.cube-facility-rents.v1",
    operator: "CUBE",
    source: "cubesmart.com",
    generatedAt: new Date().toISOString(),
    methodology:
      "Per-facility unit-rent scraping from CubeSmart facility detail pages via vanilla HTTPS. Sitemap-driven URL discovery (1,551 facilities listed in /sitemap-facility.xml). Each <li class=csStorageSizeDimension> renders one available unit type with HTML data attributes (data-unitprice, data-encodedfeatures), an aria-hidden size span (e.g. 5'x5' Storage Unit), and dual price spans: ptDiscountPriceSpan (web/online rate, Storvex's primary move-in signal) and ptOriginalPriceSpan (in-store standard rate). Records BOTH plus the promotional discount %.",
    citationRule:
      "Each facility record cites its source URL on cubesmart.com. CubeSmart publishes structured facility metadata as Schema.org SelfStorage entities (name, address, geo); unit-level pricing is rendered into CUBE's standard HTML widget which Storvex parses directly.",
    rateLimit: `${REQ_DELAY_MS}ms between requests (~1 req/sec)`,
    statesScraped: Object.keys(byState).sort(),
    statesGroups: Object.entries(byState)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([state, facilitiesInState]) => ({
        state,
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
  const outPath = path.join(DATA_DIR, `cube-facility-rents-${outDate}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("  Crawl complete");
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
