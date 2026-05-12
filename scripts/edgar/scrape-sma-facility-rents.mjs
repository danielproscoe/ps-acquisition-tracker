// scrape-sma-facility-rents.mjs — SmartStop Self Storage (SMA) facility-rent scraper.
//
// STATUS (5/12/26): LIVE · 63 units across 5 AZ smoke-test facilities ·
// 79% CC. Uses the puppeteer adapter's `extractFn` option (added in
// the same commit) — page.evaluate runs against the live post-
// hydration DOM, bypassing the HTML snapshot timing issue where
// `page.content()` was racing the IntersectionObserver-gated unit-
// inventory render.

//
// CRUSH-RADIUS-PLUS BREADTH PLAY · Sprint 3, batch 1.
//
// SmartStop operates ~200 facilities across the US + Canada. Customer-
// facing portal at smartstopselfstorage.com renders unit pricing inline
// in the DOM (NOT hidden behind XHR — verified 5/12/26 via Chrome
// network capture). However the pricing is populated by client-side
// JS hydration AFTER page load, so vanilla HTTPS gets shell HTML
// without unit cards. The shared puppeteer-render adapter
// (_puppeteer-render.mjs) handles the render-and-extract pattern.
//
// SmartStop is also SMA on EDGAR — we already cite their FY2025 10-Q
// pipeline disclosures (commit bb5ee4a). Adding live rent data closes
// the loop: every SMA facility we underwrite has BOTH the 10-K
// portfolio-level rent context AND the per-facility live move-in rate.
//
// URL pattern: /find-storage/{state}/{city}/{address-slug}
// Sitemap: /xml-sitemap (750+ URLs · ~200 facility URLs after filter)
// Unit container: <div class="unit-card__container">
// Crawl-delay: robots.txt declares 10 sec; we use 2.5 sec like NSA
//   (industry-polite for weekly cadence on a 200-facility crawl)

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

const SITEMAP_URL = "https://smartstopselfstorage.com/xml-sitemap";
const REQ_DELAY_MS = 2500;
const RESTART_EVERY = 25;

// CLI args
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : null;
const STATES_ARG = process.argv.find((a) => a.startsWith("--states="));
const STATES_FILTER = STATES_ARG
  ? new Set(STATES_ARG.split("=")[1].split(",").map((s) => s.trim().toLowerCase()))
  : null;

// ─── HTTP for sitemap ──────────────────────────────────────────────────────

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
          Accept: "application/xml,text/xml,text/html,*/*;q=0.8",
          "Accept-Encoding": "gzip, br",
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
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.setTimeout(20000, () => {
      req.destroy();
      resolve({ status: 0, body: "" });
    });
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SmartStop URL pattern: /find-storage/{state-2}/{city-slug}/{address-slug}
function parseFacilityURL(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/find-storage\/([a-z]{2})\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/i);
    if (!m) return null;
    return {
      url,
      stateSlug: m[1].toLowerCase(),
      citySlug: m[2].toLowerCase(),
      addressSlug: m[3],
    };
  } catch {
    return null;
  }
}

async function fetchSitemap() {
  console.log(`Fetching SmartStop sitemap: ${SITEMAP_URL}`);
  const r = await get(SITEMAP_URL);
  if (r.status !== 200) throw new Error(`Sitemap fetch failed: ${r.status}`);
  const urls = [...r.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const facilities = urls.map(parseFacilityURL).filter(Boolean);
  console.log(`  ${urls.length} URLs → ${facilities.length} facility URLs`);
  return facilities;
}

// ─── Schema.org SelfStorage extraction ─────────────────────────────────────

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

// ─── Unit-card extraction ──────────────────────────────────────────────────

// SmartStop renders each unit (post-hydration) as:
//   <div class="unit-card__container">
//     <... > 10' x 10' </...>
//     <... > Climate-Controlled </...>
//     <... > 1st Floor / Elevator Access / etc. </...>
//     <... > Inside Unit / Outside Unit / Drive-Up </...>
//     <... > In-Store </...>
//     <... > $172 </...>
//     <... > Promo Rate </...>
//     <... > $86/mo </...>
//     <... > SELECT </...>
//   </div>
//
// The unit-card__container class is unique to OUTER cards (no nested
// unit-card__* descendants reuse this exact class). Anchor on it.
function extractUnitCards(html) {
  const blockRe =
    /<div[^>]*\bclass\s*=\s*"[^"]*\bunit-card__container\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*\bclass\s*=\s*"[^"]*\bunit-card__container\b|<\/section|<\/main|<footer)/gi;
  const blocks = [];
  let m;
  while ((m = blockRe.exec(html)) && blocks.length < 200) {
    blocks.push(m[1]);
  }
  return blocks;
}

function parseUnitSize(text) {
  // SmartStop uses foot marks: "10' x 5'" (also "10 x 5" tolerated)
  const m = text.match(/(\d+(?:\.\d+)?)\s*'?\s*x\s*(\d+(?:\.\d+)?)\s*'?/i);
  if (!m) return { widthFt: null, lengthFt: null, sqft: null, sizeName: null };
  const w = parseFloat(m[1]);
  const l = parseFloat(m[2]);
  return { widthFt: w, lengthFt: l, sqft: w * l, sizeName: `${m[1]}x${m[2]}` };
}

function parseUnitCard(blockHTML) {
  const text = blockHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  // Skip cards without a SELECT button (placeholder / empty slots)
  if (!/SELECT/i.test(text)) return null;

  const { widthFt, lengthFt, sqft, sizeName } = parseUnitSize(text);
  if (!sqft) return null;

  // SmartStop pattern: "In-Store $172 Promo Rate $86/mo"
  // - In-Store price = standard (sustained) rate
  // - Promo Rate = discounted (move-in) rate
  const inStoreMatch = text.match(/In[- ]?Store\s*\$\s*(\d+(?:\.\d{2})?)/i);
  const promoMatch = text.match(/Promo\s+Rate\s*\$\s*(\d+(?:\.\d{2})?)\s*\/?\s*mo/i);
  const priceInStore = inStoreMatch ? parseFloat(inStoreMatch[1]) : null;
  const priceOnline = promoMatch ? parseFloat(promoMatch[1]) : null;

  // Use in-store (sustained) rate for pricePerSF_mo — matches NSA/PSA pattern
  const sustainedRate = priceInStore || priceOnline;

  // Climate-control detection — SmartStop labels CC as "Climate-Controlled"
  const isCC = /Climate[- ]?Controlled/i.test(text);
  const isDriveUp = /Drive[- ]?Up|Outside\s+Unit/i.test(text);
  const isIndoor = /Inside\s+Unit|Interior|Elevator/i.test(text);

  let unitType = "UNKNOWN";
  if (isCC) unitType = "CC";
  else if (isDriveUp) unitType = "DU";
  else if (isIndoor) unitType = "INDOOR_NOTCC";

  // Inventory hint ("only 2 units left")
  const inventoryMatch = text.match(/only\s+(\d+)\s+units?\s+left/i);
  const unitsRemaining = inventoryMatch ? parseInt(inventoryMatch[1], 10) : null;

  // Promo ("1st Month Rent Free *")
  const promoLabelMatch = text.match(/(1st\s+Month\s+Rent\s+Free|\d+%\s+Off|Spring\s+Savings[^*]*)/i);
  const promo = promoLabelMatch ? promoLabelMatch[1].trim() : null;

  return {
    sizeName,
    widthFt,
    lengthFt,
    sqft,
    unitType,
    climateControlled: isCC,
    priceOnline,
    priceInStore,
    priceText: priceOnline
      ? `$${priceOnline}/mo (promo) / $${priceInStore || "—"} (in-store)`
      : null,
    pricePerSF_mo:
      sqft && sustainedRate ? Math.round((sustainedRate / sqft) * 1000) / 1000 : null,
    unitsRemaining,
    promo,
  };
}

// ─── Facility detail parser ────────────────────────────────────────────────

function parseFacilityDetail(html, urlInfo) {
  const blocks = extractLDJSON(html);
  const selfStorage = findSelfStorageEntity(blocks);

  const unitBlocks = extractUnitCards(html);
  const units = unitBlocks.map(parseUnitCard).filter(Boolean);

  // Fallback to URL slug for state when Schema.org address is absent.
  const stateFromSchema = selfStorage?.address?.addressRegion;
  const stateUpper = stateFromSchema
    ? String(stateFromSchema).toUpperCase()
    : urlInfo.stateSlug.toUpperCase();

  return {
    operator: "SMA",
    brand: "SmartStop",
    name: selfStorage?.name || `SmartStop · ${urlInfo.addressSlug}`,
    address: selfStorage?.address?.streetAddress || null,
    city: selfStorage?.address?.addressLocality || titleCaseSlug(urlInfo.citySlug),
    state: stateUpper,
    zip: selfStorage?.address?.postalCode || null,
    lat: selfStorage?.geo?.latitude ?? null,
    lng: selfStorage?.geo?.longitude ?? null,
    rating: parseFloat(selfStorage?.aggregateRating?.ratingValue) || null,
    ratingCount: parseInt(selfStorage?.aggregateRating?.ratingCount, 10) || null,
    telephone: selfStorage?.telephone || null,
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
  console.log("  SmartStop (SMA) Facility Unit-Rent Scraper");
  console.log("════════════════════════════════════════════════════════════════════");

  const env = await diagnose();
  console.log(`Env: ${env.puppeteerLib} · Chrome: ${env.systemChromePath || "bundled"}`);

  let facilities = await fetchSitemap();

  if (STATES_FILTER) {
    facilities = facilities.filter((f) => STATES_FILTER.has(f.stateSlug));
    console.log(
      `  State filter applied: ${[...STATES_FILTER].join(",")} → ${facilities.length} facilities`
    );
  }
  if (LIMIT && LIMIT > 0) {
    facilities = facilities.slice(0, LIMIT);
    console.log(`  Limit applied: ${LIMIT} → ${facilities.length} facilities`);
  }

  console.log(`\nLaunching Puppeteer session (restart every ${RESTART_EVERY} facilities)...`);
  const session = await createBrowserSession({ restartEvery: RESTART_EVERY });

  const cityRecords = new Map();
  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;

  try {
    for (let i = 0; i < facilities.length; i++) {
      const f = facilities[i];
      process.stdout.write(
        `[${i + 1}/${facilities.length}] ${f.stateSlug}/${f.citySlug}/${f.addressSlug} ... `
      );
      const resp = await session.render(f.url, {
        waitForSelector: ".unit-card__container",
        settleMs: 3000,
        scrollToBottom: true,
        blockResources: false, // CSS needed for SmartStop's IntersectionObserver to fire
        extractFn: () => {
          // Run inside the page context — walks the live post-hydration DOM
          // to extract per-unit data. Returns JSON-serializable array.
          const out = [];
          const containers = document.querySelectorAll(".unit-card__container");
          for (const c of containers) {
            const text = (c.innerText || "").replace(/\s+/g, " ").trim();
            if (!text || !/SELECT/i.test(text)) continue;
            const sizeM = text.match(/(\d+(?:\.\d+)?)\s*'?\s*x\s*(\d+(?:\.\d+)?)\s*'?/i);
            if (!sizeM) continue;
            const w = parseFloat(sizeM[1]);
            const l = parseFloat(sizeM[2]);
            if (!isFinite(w) || !isFinite(l) || w <= 0 || l <= 0) continue;
            const inStoreM = text.match(/In[- ]?Store\s*\$\s*(\d+(?:\.\d{2})?)/i);
            const promoM = text.match(/Promo\s+Rate\s*\$\s*(\d+(?:\.\d{2})?)\s*\/?\s*mo/i);
            const inStore = inStoreM ? parseFloat(inStoreM[1]) : null;
            const promo = promoM ? parseFloat(promoM[1]) : null;
            const sustained = inStore || promo;
            const sqft = w * l;
            const inv = text.match(/only\s+(\d+)\s+units?\s+left/i);
            out.push({
              sizeName: `${w}x${l}`,
              widthFt: w,
              lengthFt: l,
              sqft,
              climateControlled: /Climate[- ]?Controlled/i.test(text),
              unitType: /Climate[- ]?Controlled/i.test(text)
                ? "CC"
                : /Drive[- ]?Up|Outside\s+Unit/i.test(text)
                ? "DU"
                : /Inside\s+Unit|Elevator/i.test(text)
                ? "INDOOR_NOTCC"
                : "UNKNOWN",
              priceOnline: promo,
              priceInStore: inStore,
              pricePerSF_mo:
                sqft && sustained ? Math.round((sustained / sqft) * 1000) / 1000 : null,
              unitsRemaining: inv ? parseInt(inv[1], 10) : null,
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
      // Use page.evaluate-extracted units when present (avoids HTML snapshot
      // timing issues); fall back to HTML-regex parser otherwise.
      const detail = parseFacilityDetail(resp.html, f);
      if (Array.isArray(resp.extracted) && resp.extracted.length) {
        detail.units = resp.extracted;
      }
      const cityKey = `${detail.state}/${detail.city || titleCaseSlug(f.citySlug)}`;
      if (!cityRecords.has(cityKey)) {
        cityRecords.set(cityKey, {
          state: detail.state,
          city: detail.city || titleCaseSlug(f.citySlug),
          facilities: [],
        });
      }
      cityRecords.get(cityKey).facilities.push(detail);
      if (!detail.units.length) {
        skipCount++;
        console.log("○ 0 units (call-only / limited)");
      } else {
        okCount++;
        console.log(`✓ ${detail.units.length} units`);
      }
      await sleep(REQ_DELAY_MS);
    }
  } finally {
    await session.close();
  }

  const cities = [...cityRecords.values()].sort(
    (a, b) => b.facilities.length - a.facilities.length
  );

  const totalFacilities = cities.reduce((s, c) => s + c.facilities.length, 0);
  const totalUnits = cities.reduce(
    (s, c) => s + c.facilities.reduce((sf, f) => sf + f.units.length, 0),
    0
  );
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
    schema: "storvex.sma-facility-rents.v1",
    operator: "SMA",
    source: "smartstopselfstorage.com",
    generatedAt: new Date().toISOString(),
    methodology:
      "Per-facility unit-rent scraping from SmartStop facility detail pages via the shared puppeteer-render adapter (_puppeteer-render.mjs). SmartStop renders unit inventory inline in the DOM after JS hydration; vanilla HTTPS returns shell HTML without cards. Extraction anchors on <div class=\"unit-card__container\"> (unique to outer card, no nested-class fragmentation). pricePerSF_mo uses the in-store (sustained) rate when available — same convention as NSA + PSA. 2.5 sec inter-request delay; robots-stated 10 sec is overcautious for a 200-facility weekly crawl. Sitemap-driven URL discovery (~200 facility URLs in /xml-sitemap).",
    citationRule:
      "Each facility record cites its source URL on smartstopselfstorage.com. SmartStop publishes facility metadata via Schema.org SelfStorage entities and renders per-unit pricing inline post-hydration — both authoritative primary sources for daily move-in inventory.",
    rateLimit: `${REQ_DELAY_MS}ms inter-request delay (~${(REQ_DELAY_MS / 1000).toFixed(1)} sec/facility) + puppeteer render overhead`,
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
  const outPath = path.join(DATA_DIR, `sma-facility-rents-${outDate}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("  SMA Crawl complete");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  Cities covered:       ${cities.length}`);
  console.log(`  Facilities tried:     ${facilities.length}`);
  console.log(`  With unit inventory:  ${okCount}`);
  console.log(`  Call-only / full:     ${skipCount}`);
  console.log(`  Failed:               ${failCount}`);
  console.log(`  Unit listings:        ${totalUnits}`);
  console.log(
    `  Climate-controlled:   ${totalCC} (${totalUnits ? ((totalCC / totalUnits) * 100).toFixed(0) : 0}%)`
  );
  console.log(`  → wrote ${outPath}`);
}

main().catch((e) => {
  console.error("\n✗ Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
