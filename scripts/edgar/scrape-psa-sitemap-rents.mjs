// scrape-psa-sitemap-rents.mjs — sitemap-driven full-portfolio PSA rent scraper
//
// Companion to scrape-psa-facility-rents.mjs (city-listing approach, 24 MSAs,
// ~260 facilities). This scraper enumerates EVERY public PSA facility URL via
// the official product sitemap — closing the coverage gap from 260 → ~3,483
// facilities (full PSA portfolio).
//
// Why sitemap-driven matters:
//   - Per the PSA FY2025 10-K, PSA operates 3,143 same-store + new acquisitions
//     ≈ 3,500 actual branded facilities. The MSA city-listing scraper returns
//     only the top-N per metro (~10/city × 24 cities ≈ 260) — a 13× under-count.
//   - When Storvex pitches PS lens to Reza or any institutional buyer, "we have
//     260 PSA facilities of 3,500" is a credibility gap. Full coverage closes it.
//   - PSA Family per CLAUDE.md §6b includes iStorage + NSA post-2023 merger.
//     This scraper covers PSA-branded only; iStorage + NSA covered by
//     scrape-nsa-locations.mjs (sitemap-driven, 1,142 facilities).
//
// Architecture:
//   Step 1 — fetch sitemap_0-product.xml (~21K lines, ~3,483 facility URLs)
//   Step 2 — filter URLs matching /self-storage-{state}-{city}/{id}.html
//   Step 3 — group by state slug for progress reporting + state-bounded testing
//   Step 4 — for each URL, fetch detail page → parse SelfStorage Schema.org
//   Step 5 — extract makesOffer array → unit-level rent records
//   Step 6 — write psa-facility-rents-sitemap-{date}.json + -fresh.json
//
// Rate limit: 1.1 req/sec (matches existing PSA scraper). Cloudflare-fronted
// but tolerates this rate at 3,483 requests = ~64 minutes for full crawl.
//
// Flags:
//   --limit=N        cap requests for smoke testing (default: no cap)
//   --state=tx       only crawl facilities in given state slug
//   --start=N        skip first N facilities (for resumed crawls)
//   --dryrun         enumerate URLs only, do not fetch detail pages

import https from "node:https";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REQ_DELAY_MS = 1100;
const SITEMAP_URL = "https://www.publicstorage.com/sitemap_0-product.xml";
const FACILITY_URL_RE = /^https:\/\/www\.publicstorage\.com\/self-storage-([a-z]{2})-([a-z-]+)\/(\d+)\.html$/;

// ─── CLI args ──────────────────────────────────────────────────────────────

function parseFlags() {
  const args = process.argv.slice(2);
  const flags = { limit: null, state: null, start: 0, dryrun: false };
  for (const a of args) {
    if (a === "--dryrun") flags.dryrun = true;
    else if (a.startsWith("--limit=")) flags.limit = parseInt(a.slice(8), 10) || null;
    else if (a.startsWith("--state=")) flags.state = a.slice(8).toLowerCase();
    else if (a.startsWith("--start=")) flags.start = parseInt(a.slice(8), 10) || 0;
  }
  return flags;
}

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

// ─── Sitemap enumeration ───────────────────────────────────────────────────

function extractFacilityURLsFromSitemap(xml) {
  const out = [];
  const seen = new Set();
  const locRe = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = locRe.exec(xml))) {
    const url = m[1].trim();
    const fm = url.match(FACILITY_URL_RE);
    if (!fm) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      stateSlug: fm[1],
      citySlug: fm[2],
      facilityId: fm[3],
    });
  }
  return out;
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

function parseUnitDimensions(sizeName) {
  const m = String(sizeName).match(/(\d{1,2})\s*[x×]\s*(\d{1,2})/i);
  if (!m) return { width: null, length: null, sqft: null };
  const w = parseInt(m[1], 10);
  const l = parseInt(m[2], 10);
  return { width: w, length: l, sqft: w * l };
}

function parsePriceRange(priceText) {
  if (!priceText) return { low: null, high: null, mid: null };
  const matches = String(priceText).match(/\$?\s*(\d+(?:\.\d{2})?)/g);
  if (!matches) return { low: null, high: null, mid: null };
  const nums = matches.map((s) => parseFloat(s.replace(/[$\s,]/g, "")));
  const low = Math.min(...nums);
  const high = Math.max(...nums);
  return { low, high, mid: (low + high) / 2 };
}

function classifyUnitType(description) {
  const desc = String(description || "").toLowerCase();
  if (/climate.controlled/.test(desc)) return "CC";
  if (/drive.?up|outside/.test(desc)) return "DU";
  if (/outdoor|outdoor.parking|vehicle/.test(desc)) return "OUTDOOR";
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

async function main() {
  const flags = parseFlags();
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  PSA Sitemap-Driven Facility Rent Scraper");
  console.log("  (full-portfolio coverage — companion to MSA-keyed scraper)");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  Flags: limit=${flags.limit ?? "(none)"} · state=${flags.state ?? "(all)"} · start=${flags.start} · dryrun=${flags.dryrun}`);
  console.log("");

  // Step 1: fetch sitemap
  console.log(`Fetching sitemap: ${SITEMAP_URL}`);
  const smResp = await get(SITEMAP_URL);
  if (smResp.status !== 200) {
    console.error(`  ✗ sitemap fetch failed: status ${smResp.status}`);
    process.exit(1);
  }
  let urls = extractFacilityURLsFromSitemap(smResp.body);
  console.log(`  → ${urls.length} facility URLs in sitemap`);

  // State filter
  if (flags.state) {
    const before = urls.length;
    urls = urls.filter((u) => u.stateSlug === flags.state);
    console.log(`  → ${urls.length} after state=${flags.state} filter (was ${before})`);
  }

  // Start offset
  if (flags.start > 0) {
    urls = urls.slice(flags.start);
    console.log(`  → skipping first ${flags.start}, ${urls.length} remaining`);
  }

  // Limit cap (smoke testing)
  if (flags.limit && flags.limit < urls.length) {
    urls = urls.slice(0, flags.limit);
    console.log(`  → capped to ${urls.length} facilities for smoke test`);
  }

  // Group preview
  const stateBuckets = {};
  for (const u of urls) {
    stateBuckets[u.stateSlug] = (stateBuckets[u.stateSlug] || 0) + 1;
  }
  const stateList = Object.entries(stateBuckets).sort((a, b) => b[1] - a[1]);
  console.log("\n  State distribution (top 10):");
  for (const [st, n] of stateList.slice(0, 10)) {
    console.log(`    ${st.toUpperCase()}: ${n}`);
  }
  if (stateList.length > 10) console.log(`    ... +${stateList.length - 10} more states`);

  if (flags.dryrun) {
    console.log("\n  (--dryrun) skipping detail crawl");
    return;
  }

  // Step 2: crawl detail pages
  console.log(`\nCrawling ${urls.length} facility pages at ${REQ_DELAY_MS}ms/req (~${Math.ceil(urls.length * REQ_DELAY_MS / 60000)}min)`);
  const records = [];
  let okCount = 0;
  let failCount = 0;
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    process.stdout.write(`  [${i + 1}/${urls.length}] ${u.stateSlug.toUpperCase()}/${u.facilityId} ... `);
    const detailResp = await get(u.url);
    if (detailResp.status !== 200) {
      console.log(`✗ ${detailResp.status}`);
      failCount++;
      await sleep(REQ_DELAY_MS);
      continue;
    }
    const parsed = parseFacilityDetail(detailResp.body, u.url);
    if (parsed) {
      parsed.facilityId = u.facilityId;
      parsed.stateSlug = u.stateSlug;
      parsed.citySlug = u.citySlug;
      records.push(parsed);
      console.log(`✓ ${parsed.units.length} units`);
      okCount++;
    } else {
      console.log("✗ no SelfStorage LD+JSON");
      failCount++;
    }
    await sleep(REQ_DELAY_MS);
  }

  // Step 3: write output
  const output = {
    schema: "storvex.psa-facility-rents-sitemap.v1",
    generatedAt: new Date().toISOString(),
    methodology: "Sitemap-driven full-portfolio PSA scrape. Reads sitemap_0-product.xml, enumerates every /self-storage-{state}-{city}/{id}.html URL, fetches each detail page, parses Schema.org SelfStorage entity + makesOffer array. 1.1 req/sec rate limit. Records the AVAILABLE inventory at scrape time. Companion to scrape-psa-facility-rents.mjs (MSA city-listing approach, ~260 facilities).",
    citationRule: "Each facility record cites its source URL on publicstorage.com. Schema.org SelfStorage entities are PSA's authoritative primary source.",
    flags,
    sitemapUrl: SITEMAP_URL,
    totalsURLs: urls.length,
    okCount,
    failCount,
    facilities: records,
    totals: {
      facilities: records.length,
      unitListings: records.reduce((s, f) => s + f.units.length, 0),
      states: new Set(records.map((f) => f.stateSlug)).size,
    },
  };

  const outDate = new Date().toISOString().slice(0, 10);
  const stateTag = flags.state ? `-${flags.state}` : "";
  const outPath = path.join(DATA_DIR, `psa-facility-rents-sitemap${stateTag}-${outDate}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  // Also write/refresh the "fresh" pointer for downstream consumers
  if (!flags.state && !flags.limit) {
    const freshPath = path.join(DATA_DIR, "psa-facility-rents-sitemap-fresh.json");
    fs.writeFileSync(freshPath, JSON.stringify(output, null, 2));
    console.log(`\n  → wrote ${freshPath}`);
  }

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("  Crawl complete");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  Facilities scraped:  ${records.length} / ${urls.length} attempted`);
  console.log(`  Unit listings:       ${output.totals.unitListings}`);
  console.log(`  States covered:      ${output.totals.states}`);
  console.log(`  Failures:            ${failCount}`);
  console.log(`  → wrote ${outPath}`);
  console.log(`  → ${(JSON.stringify(output).length / 1024).toFixed(1)} KB on disk`);
}

main().catch((e) => {
  console.error("✗ Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
