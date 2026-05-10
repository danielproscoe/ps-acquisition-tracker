// scrape-nsa-locations.mjs — refresh the iStorage / NSA facility location index.
//
// CLAUDE.md §6b defines the "PS Family" as PSA + iStorage + NSA per the
// 2023 PSA-NSA merger. iStorage was already part of NSA pre-merger, and
// post-acquisition all NSA-managed facilities surface on a single rebranded
// site at nsastorage.com (istorage.com 301-redirects to it).
//
// We need an up-to-date index of NSA/iStorage facility lat/lng so the PS
// family proximity check (§6b) covers the full footprint, not just PSA.
// The legacy NSA_Locations.csv has ~1,134 records (Mar 2026); the live
// sitemap exposes ~1,724 facility URLs. This scraper closes the gap.
//
// Per-unit RENT extraction is a separate sprint — NSA loads pricing via a
// JS API call rather than inline HTML, so a Puppeteer-based rent scraper
// is required. This scraper is metadata-only: name, address, lat/lng,
// city, state, zip, MSA-resolved if possible.
//
// Output: src/data/nsa-locations-{date}.json + a refreshed
// src/data/nsa-locations-fresh.csv (for proximity index ingestion).

import https from "node:https";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// robots.txt requests Crawl-delay: 5 — respect it
const REQ_DELAY_MS = 5100;

const SITEMAP_URL = "https://www.nsastorage.com/sitemap.xml";

// Optional CLI: --limit=N for smoke tests
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : null;

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

// Facility URL pattern: /storage/{state}/storage-units-{city}/{address}-{id}
// Filter sitemap entries to only those that match — exclude /, /contact-us,
// /privacy, /storage (state index pages), etc.
function isFacilityURL(url) {
  return /\/storage\/[a-z-]+\/storage-units-[a-z-]+\/[\w.-]+-\d+/.test(url);
}

async function fetchSitemap() {
  console.log(`Fetching NSA sitemap: ${SITEMAP_URL}`);
  const r = await get(SITEMAP_URL);
  if (r.status !== 200) {
    throw new Error(`Sitemap fetch failed: ${r.status}`);
  }
  const allUrls = [...r.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const facilityUrls = allUrls.filter(isFacilityURL);
  console.log(`  ${allUrls.length} total sitemap entries → ${facilityUrls.length} facility URLs`);
  return facilityUrls;
}

// ─── Detail page parsing ────────────────────────────────────────────────────

// Extract LD+JSON SelfStorage entity. NSA's pages publish:
//   - WebSite (block 0)
//   - Organization (block 1)
//   - SelfStorage (block 2) — has name, address, telephone, openingHours
//   - BreadcrumbList (block 3)
function extractSelfStorageMeta(html) {
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : parsed["@graph"] || [parsed];
      for (const it of items) {
        if (it && it["@type"] === "SelfStorage") return it;
      }
    } catch {}
  }
  return null;
}

// Lat/lng — NSA's Schema.org doesn't include geo directly, but the page
// embeds Google Maps URLs we can parse. Pattern: maps?q=LAT,LNG or
// maps/place/.../@LAT,LNG,...
function extractLatLng(html) {
  // Google Maps query URLs (most reliable)
  const qMatch = html.match(/maps[^"']*[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };

  // /place/...@LAT,LNG,zoom (placement style)
  const atMatch = html.match(/maps\/[^"']*@(-?\d+\.\d+),(-?\d+\.\d+),/);
  if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };

  // ll= URL param
  const llMatch = html.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (llMatch) return { lat: parseFloat(llMatch[1]), lng: parseFloat(llMatch[2]) };

  // Fallback: data-lat / data-lng attributes
  const latAttr = html.match(/data-lat(?:itude)?="(-?\d+\.\d+)"/);
  const lngAttr = html.match(/data-l(?:ng|on|ongitude)="(-?\d+\.\d+)"/);
  if (latAttr && lngAttr) {
    return { lat: parseFloat(latAttr[1]), lng: parseFloat(lngAttr[1]) };
  }

  return { lat: null, lng: null };
}

// Extract facility ID from the URL (last segment is `{address-slug}-{id}`)
function extractFacilityId(url) {
  const m = url.match(/-(\d+)\/?$/);
  return m ? m[1] : null;
}

// State + city from URL (already canonicalized in the path)
function extractUrlSegments(url) {
  const m = url.match(/\/storage\/([a-z-]+)\/storage-units-([a-z-]+)\//);
  return m
    ? { stateSlug: m[1], citySlug: m[2] }
    : { stateSlug: null, citySlug: null };
}

function parseFacility(html, url) {
  const ss = extractSelfStorageMeta(html);
  const { lat, lng } = extractLatLng(html);
  const facilityId = extractFacilityId(url);
  const { stateSlug, citySlug } = extractUrlSegments(url);
  return {
    facilityId,
    url,
    name: ss?.name || null,
    telephone: ss?.telephone || null,
    address: ss?.address?.streetAddress || null,
    city: ss?.address?.addressLocality || null,
    state: ss?.address?.addressRegion || null,
    zip: ss?.address?.postalCode || null,
    stateSlug,
    citySlug,
    lat,
    lng,
    image: ss?.image || null,
    openingHours: ss?.openingHoursSpecification || null,
    scrapedAt: new Date().toISOString(),
  };
}

// ─── Main crawl orchestrator ────────────────────────────────────────────────

async function main() {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  NSA / iStorage Location Refresh");
  console.log("════════════════════════════════════════════════════════════════════");

  let urls = await fetchSitemap();
  if (LIMIT) {
    urls = urls.slice(0, LIMIT);
    console.log(`  --limit=${LIMIT}: capped to ${urls.length}`);
  }
  console.log(`  Estimated crawl time: ~${Math.round((urls.length * REQ_DELAY_MS) / 60000)} min at 1/${REQ_DELAY_MS / 1000}s pace (robots.txt Crawl-delay)\n`);

  const facilities = [];
  let okCount = 0;
  let withCoords = 0;
  let failCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const tag = `[${i + 1}/${urls.length}]`;
    process.stdout.write(`${tag} ${url.replace("https://www.nsastorage.com", "")} ... `);
    const r = await get(url);
    if (r.status !== 200) {
      console.log(`✗ ${r.status}`);
      failCount++;
      await sleep(REQ_DELAY_MS);
      continue;
    }
    const facility = parseFacility(r.body, url);
    facilities.push(facility);
    okCount++;
    if (facility.lat != null && facility.lng != null) withCoords++;
    console.log(`✓ ${facility.name?.split("|")[0]?.trim() || "?"}${facility.lat ? ` · ${facility.lat.toFixed(3)},${facility.lng.toFixed(3)}` : ""}`);
    await sleep(REQ_DELAY_MS);
  }

  // Group by state
  const byState = {};
  for (const f of facilities) {
    const key = (f.state || f.stateSlug || "UNKNOWN").toUpperCase();
    (byState[key] ||= []).push(f);
  }

  const output = {
    schema: "storvex.nsa-locations.v1",
    operator: "NSA",
    operatorBrand: "iStorage (PSA-acquired Sept 2023)",
    source: "nsastorage.com",
    generatedAt: new Date().toISOString(),
    methodology:
      "Vanilla HTTPS crawl of NSA/iStorage sitemap-listed facility detail pages. Sitemap exposes ~1,724 facility URLs. Each detail page publishes Schema.org SelfStorage metadata (name, address, telephone, opening hours); lat/lng extracted from embedded Google Maps URL. Per-unit pricing is JS-loaded and not captured here — see Phase 2 Puppeteer-based rent scraper. Robots.txt Crawl-delay: 5 sec respected.",
    citationRule:
      "Each facility cites its source URL on nsastorage.com. NSA / iStorage facilities are post-PSA-acquisition (Sept 2023 NSA merger; iStorage was already merged into NSA pre-acquisition). Storvex treats all NSA-managed facilities as part of the PS Family per CLAUDE.md §6b.",
    rateLimit: `${REQ_DELAY_MS}ms between requests (~${REQ_DELAY_MS / 1000}s — robots.txt Crawl-delay compliance)`,
    statesGroups: Object.entries(byState)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([state, items]) => ({ state, facilities: items })),
    totals: {
      facilitiesAttempted: urls.length,
      facilitiesScraped: okCount,
      facilitiesWithCoords: withCoords,
      facilitiesFailed: failCount,
      states: Object.keys(byState).length,
    },
  };

  const outDate = new Date().toISOString().slice(0, 10);
  const outPathJson = path.join(DATA_DIR, `nsa-locations-${outDate}.json`);
  fs.writeFileSync(outPathJson, JSON.stringify(output, null, 2));

  // Also write a CSV that mirrors the legacy NSA_Locations.csv schema so the
  // PS family proximity index can ingest it directly.
  const csvHeader = "PROPERTY_NUM,PROPERTY_NAME,ADDRESS,CITY,STATE,ZIP,LATITUDE,LONGITUDE";
  const csvRows = facilities
    .filter((f) => f.lat != null && f.lng != null && f.state)
    .map((f) => [
      `NSA #${(f.facilityId || "").padStart(5, "0")}`,
      `"${(f.name || "").replace(/"/g, '""')}"`,
      `"${(f.address || "").replace(/"/g, '""')}"`,
      `"${(f.city || "").replace(/"/g, '""')}"`,
      f.state || "",
      f.zip || "",
      f.lat,
      f.lng,
    ].join(","));
  const csv = [csvHeader, ...csvRows].join("\n");
  const outPathCsv = path.join(DATA_DIR, "nsa-locations-fresh.csv");
  fs.writeFileSync(outPathCsv, csv);

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("  Crawl complete");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  Facilities tried:     ${output.totals.facilitiesAttempted}`);
  console.log(`  Facilities scraped:   ${output.totals.facilitiesScraped}`);
  console.log(`  With lat/lng coords:  ${output.totals.facilitiesWithCoords}`);
  console.log(`  Failed:               ${output.totals.facilitiesFailed}`);
  console.log(`  States covered:       ${output.totals.states}`);
  console.log(`  → wrote ${outPathJson}`);
  console.log(`  → wrote ${outPathCsv} (CSV for PS family proximity ingest)`);
  console.log(`  → ${(JSON.stringify(output).length / 1024).toFixed(1)} KB JSON, ${(csv.length / 1024).toFixed(1)} KB CSV`);
}

main().catch((e) => {
  console.error("\n✗ Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
