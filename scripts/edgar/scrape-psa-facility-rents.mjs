// scrape-psa-facility-rents.mjs — primary-source per-facility unit-rent scraper
//
// PSA's facility detail pages publish Schema.org SelfStorage entities with
// embedded `makesOffer` arrays — one Offer per available unit type. Each
// Offer carries:
//   - price range ("$327 - $491")
//   - itemOffered.name (unit size like "10x15")
//   - itemOffered.description (climate, access, door type)
//
// This is current-availability move-in pricing, refreshed every time PSA
// re-renders a facility page. By crawling 24 PSA-disclosed MSAs (~1,892
// facilities of the 2,565 same-store cohort), we get per-facility primary-
// source unit rents — what Radius+ has, but with our institutional underwriting
// depth on top.
//
// This sprint: Austin TX (42 facilities) as proof-of-concept. Future sprints
// expand to all 24 MSAs.
//
// Architecture:
//   Step 1 — fetch city listing page → extract 42 facility @id URLs from LD+JSON
//   Step 2 — for each facility URL, fetch detail page → parse Offer array
//   Step 3 — emit records: { facilityId, msa, address, lat, lng, unitSize, ... }
//   Step 4 — write to src/data/psa-facility-rents-{date}.json
//
// Rate limit: 1 req/sec with browser headers. PSA is Cloudflare-fronted but
// city + facility pages return 200 unauthenticated at this rate.

import https from "node:https";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const REQ_DELAY_MS = 1100; // ~1 req/sec to stay polite + avoid Cloudflare WAF

// All 24 PSA-disclosed MSAs from the FY2025 10-K MD&A "Same Store Facilities
// Operating Trends by Market" table. Each citySlug maps to PSA's URL pattern
// `https://www.publicstorage.com/{citySlug}` for that city's listing page.
//
// Coverage: ~10 facilities returned per city (PSA city listings show top-N
// closest). Full per-MSA enumeration via state-level sitemap is a future
// expansion (gets remaining facilities beyond the top-10 per metro).
const CITIES = [
  { msa: "Los Angeles", citySlug: "self-storage-ca-los-angeles" },
  { msa: "San Francisco", citySlug: "self-storage-ca-san-francisco" },
  { msa: "New York", citySlug: "self-storage-ny-new-york" },
  { msa: "Washington DC", citySlug: "self-storage-dc-washington" },
  { msa: "Miami", citySlug: "self-storage-fl-miami" },
  { msa: "Seattle-Tacoma", citySlug: "self-storage-wa-seattle" },
  { msa: "Dallas-Ft. Worth", citySlug: "self-storage-tx-dallas" },
  { msa: "Houston", citySlug: "self-storage-tx-houston" },
  { msa: "Chicago", citySlug: "self-storage-il-chicago" },
  { msa: "Atlanta", citySlug: "self-storage-ga-atlanta" },
  { msa: "West Palm Beach", citySlug: "self-storage-fl-west-palm-beach" },
  { msa: "Orlando-Daytona", citySlug: "self-storage-fl-orlando" },
  { msa: "Philadelphia", citySlug: "self-storage-pa-philadelphia" },
  { msa: "Baltimore", citySlug: "self-storage-md-baltimore" },
  { msa: "San Diego", citySlug: "self-storage-ca-san-diego" },
  { msa: "Charlotte", citySlug: "self-storage-nc-charlotte" },
  { msa: "Denver", citySlug: "self-storage-co-denver" },
  { msa: "Tampa", citySlug: "self-storage-fl-tampa" },
  { msa: "Phoenix", citySlug: "self-storage-az-phoenix" },
  { msa: "Detroit", citySlug: "self-storage-mi-detroit" },
  { msa: "Boston", citySlug: "self-storage-ma-boston" },
  { msa: "Honolulu", citySlug: "self-storage-hi-honolulu" },
  { msa: "Portland", citySlug: "self-storage-or-portland" },
  { msa: "Minneapolis/St. Paul", citySlug: "self-storage-mn-minneapolis" },
  { msa: "Sacramento", citySlug: "self-storage-ca-sacramento" },
  { msa: "Austin TX", citySlug: "self-storage-tx-austin" },
];

// ─── HTTP client ────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
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
    }, (res) => {
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
    });
    req.on("error", (e) => resolve({ status: 0, body: "", error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, body: "", error: "timeout" }); });
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ─── City listing → facility URLs ──────────────────────────────────────────

function extractFacilityURLs(cityListingHTML) {
  const blocks = extractLDJSON(cityListingHTML);
  // Find the array of SelfStorage entities (typically Block 0).
  // PSA's LD+JSON lists each facility with multiple anchor variants
  // (#website, #units, #agg-offers) — dedupe by canonical URL.
  for (const block of blocks) {
    if (Array.isArray(block) && block[0]?.["@type"] === "SelfStorage") {
      const seen = new Set();
      const out = [];
      for (const f of block) {
        if (!f["@id"] || typeof f["@id"] !== "string") continue;
        // Strip # fragment + query string
        const canonical = f["@id"].split("#")[0].split("?")[0];
        // Only keep .html paths — anchor variants without .html are aliases
        if (!canonical.endsWith(".html")) continue;
        if (seen.has(canonical)) continue;
        seen.add(canonical);

        // Extract facility ID from URL pattern: /self-storage-tx-austin/809.html
        const idMatch = canonical.match(/\/(\d+)\.html$/);
        const facilityId = idMatch ? idMatch[1] : null;

        out.push({
          url: canonical,
          facilityId,
          name: f.name,
          telephone: f.telephone || null,
          address: f.address || null,
          geo: f.geo || null,
          ratingCount: parseInt(f.aggregateRating?.ratingCount, 10) || null,
          rating: parseFloat(f.aggregateRating?.ratingValue) || null,
        });
      }
      return out;
    }
  }
  return [];
}

// ─── Facility detail → unit pricing records ────────────────────────────────

// Parse "10x15" → { width: 10, length: 15, sqft: 150 }
function parseUnitDimensions(sizeName) {
  const m = String(sizeName).match(/(\d{1,2})\s*[x×]\s*(\d{1,2})/i);
  if (!m) return { width: null, length: null, sqft: null };
  const w = parseInt(m[1], 10);
  const l = parseInt(m[2], 10);
  return { width: w, length: l, sqft: w * l };
}

// Parse "$327 - $491" or "$409" → { low, high, mid }
function parsePriceRange(priceText) {
  if (!priceText) return { low: null, high: null, mid: null };
  const matches = String(priceText).match(/\$\s*(\d+(?:\.\d{2})?)/g);
  if (!matches) return { low: null, high: null, mid: null };
  const nums = matches.map((s) => parseFloat(s.replace(/[$\s,]/g, "")));
  const low = Math.min(...nums);
  const high = Math.max(...nums);
  return { low, high, mid: (low + high) / 2 };
}

// Classify unit type from description: CC | DU | OUTDOOR | UNKNOWN
function classifyUnitType(description) {
  const desc = String(description || "").toLowerCase();
  if (/climate.controlled/.test(desc)) return "CC";
  if (/drive.?up|outside/.test(desc)) return "DU";
  if (/outdoor|outdoor.parking|vehicle/.test(desc)) return "OUTDOOR";
  // Default for indoor units without explicit climate-controlled flag
  if (/inside\s+unit|inside_unit|elevator|hallway|interior/.test(desc)) return "INDOOR_NOTCC";
  return "UNKNOWN";
}

function parseFacilityDetail(html, fallbackUrl) {
  const blocks = extractLDJSON(html);

  let selfStorage = null;
  let aggregateOffer = null;
  for (const block of blocks) {
    const items = Array.isArray(block) ? block : [block];
    for (const it of items) {
      if (it?.["@type"] === "SelfStorage" && !selfStorage) selfStorage = it;
      if (it?.["@type"] === "AggregateOffer" && !aggregateOffer) aggregateOffer = it;
    }
  }

  if (!selfStorage) return null;

  const offers = Array.isArray(selfStorage.makesOffer) ? selfStorage.makesOffer : [];
  const records = offers.map((offer) => {
    const item = offer.itemOffered || {};
    const sizeName = item.name || "";
    const desc = item.description || "";
    const { width, length, sqft } = parseUnitDimensions(sizeName);
    const { low, high, mid } = parsePriceRange(offer.price);
    const unitType = classifyUnitType(desc);
    return {
      sku: item.sku || null,
      sizeName,
      widthFt: width,
      lengthFt: length,
      sqft,
      unitType,
      priceLow: low,
      priceHigh: high,
      priceMid: mid,
      pricePerSF_mo: sqft && low ? Math.round((low / sqft) * 1000) / 1000 : null,
      description: desc,
      availability: offer.availability || null,
      priceText: offer.price || null,
    };
  });

  return {
    facilityUrl: selfStorage["@id"] || fallbackUrl,
    name: selfStorage.name,
    telephone: selfStorage.telephone || null,
    address: selfStorage.address?.streetAddress || null,
    city: selfStorage.address?.addressLocality || null,
    state: selfStorage.address?.addressRegion || null,
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

// ─── Main crawl orchestrator ────────────────────────────────────────────────

async function crawlCity(cityConfig) {
  const cityUrl = `https://www.publicstorage.com/${cityConfig.citySlug}`;
  console.log(`\n─── ${cityConfig.msa} (${cityUrl}) ───`);
  const cityResp = await get(cityUrl);
  if (cityResp.status !== 200) {
    console.log(`  ✗ city page failed: status ${cityResp.status}`);
    return null;
  }

  const facilities = extractFacilityURLs(cityResp.body);
  console.log(`  Found ${facilities.length} facilities in ${cityConfig.msa}`);

  const detailRecords = [];
  for (let i = 0; i < facilities.length; i++) {
    const f = facilities[i];
    process.stdout.write(`  [${i + 1}/${facilities.length}] ${f.url} ... `);
    const detailResp = await get(f.url);
    if (detailResp.status !== 200) {
      console.log(`✗ ${detailResp.status}`);
      continue;
    }
    const parsed = parseFacilityDetail(detailResp.body, f.url);
    if (parsed) {
      // Augment with city listing data (rating count from city page is more
      // reliable than detail page's local cohort rating)
      parsed.facilityId = f.facilityId;
      parsed.msa = cityConfig.msa;
      parsed.cityListingRatingCount = f.ratingCount;
      detailRecords.push(parsed);
      console.log(`✓ ${parsed.units.length} units`);
    } else {
      console.log("✗ no SelfStorage LD+JSON");
    }
    await sleep(REQ_DELAY_MS);
  }

  console.log(`  ${cityConfig.msa}: ${detailRecords.length} facilities · ${detailRecords.reduce((s, f) => s + f.units.length, 0)} unit listings`);
  return { msa: cityConfig.msa, facilities: detailRecords };
}

async function main() {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  PSA Facility Unit-Rent Scraper");
  console.log("════════════════════════════════════════════════════════════════════");

  const allCityRecords = [];
  for (const city of CITIES) {
    const cityResult = await crawlCity(city);
    if (cityResult) allCityRecords.push(cityResult);
  }

  const output = {
    schema: "storvex.psa-facility-rents.v1",
    generatedAt: new Date().toISOString(),
    methodology: "Per-facility unit-rent scraping from PSA Schema.org SelfStorage detail pages. Each `makesOffer` Offer element provides a unit type's current move-in price range with description (climate-controlled / drive-up / indoor classification). 1 req/sec rate limit. Records the AVAILABLE inventory at scrape time — facilities that are full or have limited availability return fewer Offer entries.",
    citationRule: "Each facility record cites its source URL on publicstorage.com. The structured data is published by PSA as Schema.org-compliant Schema.org SelfStorage entities — an authoritative primary source.",
    cities: allCityRecords,
    totals: {
      cities: allCityRecords.length,
      facilities: allCityRecords.reduce((s, c) => s + c.facilities.length, 0),
      unitListings: allCityRecords.reduce((s, c) => s + c.facilities.reduce((sf, f) => sf + f.units.length, 0), 0),
    },
  };

  const outDate = new Date().toISOString().slice(0, 10);
  const outPath = path.join(DATA_DIR, `psa-facility-rents-${outDate}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("  Crawl complete");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  Cities crawled:  ${output.totals.cities}`);
  console.log(`  Facilities:      ${output.totals.facilities}`);
  console.log(`  Unit listings:   ${output.totals.unitListings}`);
  console.log(`  → wrote ${outPath}`);
  console.log(`  → ${(JSON.stringify(output).length / 1024).toFixed(1)} KB on disk`);
}

main().catch((e) => {
  console.error("✗ Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
