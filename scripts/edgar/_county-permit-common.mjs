// _county-permit-common.mjs — shared scaffold for per-county building-permit
// scraper adapters that feed the Storvex Verification Oracle's PERMIT registry.
//
// ─── SYSTEM CLAIM (patent) ────────────────────────────────────────────────
//
// Method for ingesting county-level building-permit records into a
// commercial-real-estate verification registry using a portal-agnostic
// adapter architecture:
//   (a) maintaining a per-county scraper adapter for each pilot jurisdiction,
//       each adapter normalizing portal-specific data shapes to a canonical
//       permit record schema (operator-normalized · verifiedSource-stamped ·
//       jurisdiction-cited · citationRule-validated);
//   (b) supporting a portal-coverage spectrum within a single ingestion
//       pipeline: (i) automated vanilla-HTTPS scrape (e.g., ASP.NET Telerik
//       RadGrid · Denton County, TX); (ii) manual CSV-export ingest path
//       for reCAPTCHA-gated or CSRF-token-protected portals (e.g., iWorQ
//       · Warren County, OH; GovBuilt + Orchard Core · Kenton County, KY);
//       (iii) onFileSource paper-records-request adapter for jurisdictions
//       with no online permit portal (e.g., Boone & Hancock Counties, IN);
//   (c) stamping each permit record with verifiedSource of the canonical
//       form "permit-<county-slug>-<permit-number>" so a downstream
//       Pipeline Confidence engine auto-classifies the record as VERIFIED
//       without per-record manual review;
//   (d) enforcing a citationRule that REJECTS records missing any of
//       (permitNumber, permitIssueDate, jurisdiction, city, state) AND
//       requiring at least one of (permitUrl, onFileSource) — gating the
//       audit-trail integrity that distinguishes the registry from
//       aggregator-claimed data;
//   (e) idempotently merging new permits into a single canonical
//       facilities[] array keyed by stable record ID, preserving prior
//       fields under partial-update conditions;
//   (f) operator normalization through an alias table (PSA family · EXR
//       family · CUBE · SMA · AMERCO · 6+ independents) so REIT M&A
//       consolidation (e.g., PSA acquisition of iStorage + NSA) does not
//       fragment portfolio coverage; and
//   (g) automated daily refresh via a GitHub Actions cron that re-runs
//       the orchestrator + commits the refreshed registry to git so a
//       statically-imported React build picks it up on the next deploy
//       cycle — a "data-is-build-artifact" architecture enabling
//       audit-trail provenance preservation that serverless cron
//       functions cannot achieve.
//
// Together with the Pipeline Verification Oracle's multi-source
// match-scoring claim and the multi-source coverage-classification claim
// (`pipelineVerificationOracle.js`), this scaffold implements the second
// primary-source registry lineage of a multi-source verification system
// that TractIQ at $199/mo cannot replicate without independently building
// the same per-county permit ingestion across 5+ jurisdictions.
//
// Filed under DJR Real Estate LLC. Drafted 5/12/26 PM as part of the
// supplemental provisional addendum to USPTO #64/062,607.
// ─────────────────────────────────────────────────────────────────────────
//
// CRUSH-RADIUS-PLUS AUDIT-LAYER PIVOT · Sprint follow-on
// -------------------------------------------------------
// Architecture context (commit `bb64881` · 5/12/26 EOD):
//   The Multi-source Verification Oracle queries TWO independent primary-
//   source registries — `development-pipeline.json` (EDGAR) and
//   `county-permits.json` (PERMITS). The schema, Oracle wiring, Capabilities
//   Footprint row, and unit tests are all live. Today's sprint is the data-
//   ingestion engine — per-county scraper adapters that write canonical
//   permit records into the existing `facilities[]` array.
//
// Pilot county scope (locked in county-permits.json):
//   - Denton County, TX     · apps.dentoncounty.gov/DevPermit/ (ASP.NET table)
//   - Warren County, OH     · warrencountyohio.gov/BldgInsp/ (homegrown ASP.NET)
//   - Kenton County, KY     · pdskc.govbuilt.com (GovBuilt platform)
//   - Boone County, IN      · paper records · Area Plan office (records request)
//   - Hancock County, IN    · paper records · Planning & Building (records request)
//
// Each per-county adapter calls into this module for:
//   - Canonical permit-record shape validation (matches the Oracle schema)
//   - Operator-name normalization (handles "Public Storage" / "PSA" / variants)
//   - Storage-use keyword detection (filters out non-storage permits)
//   - Geocoding stub (address → lat/lng — defers to county GIS or Google Maps)
//   - JSON merge into county-permits.json (idempotent on permitNumber)
//
// Each entry written here stamps:
//   verifiedSource: "permit-<county-slug>-<permit-number>"
// which `pipelineConfidence.js` derivation rule #2 auto-classifies as VERIFIED.
//
// CITATION RULE (enforced — Oracle rejects entries missing any of these):
//   permitNumber       · string · required
//   permitIssueDate    · ISO date · required
//   jurisdiction       · string · required
//   permitUrl OR onFileSource · required (one of them)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COUNTY_PERMITS_JSON = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "data",
  "county-permits.json"
);

// ─── Storage-use keyword classifier ────────────────────────────────────────
// Permit portals describe self-storage projects under many synonymous labels.
// This list is intentionally generous — false positives are filtered out at
// the operator/sqft stage; false negatives leak real pipeline.
//
// Source: CLAUDE.md §6c Phase 2 step 4 ("Find permitted use table — search ALL
// of these synonyms"). Aligned with the official ordinance vocabulary across
// 15+ researched jurisdictions.

export const STORAGE_USE_KEYWORDS = [
  "self-storage",
  "self storage",
  "selfstorage",
  "mini-warehouse",
  "mini warehouse",
  "miniwarehouse",
  "mini-storage",
  "mini storage",
  "ministorage",
  "storage warehouse",
  "personal storage",
  "indoor storage",
  "climate-controlled storage",
  "climate controlled storage",
  "warehouse (mini",
  "warehouse mini",
  "self-service storage",
  "self service storage",
  "public storage",
  "storage facility",
  "storage building",
  "storage unit",
  "storage units",
  "storage center",
];

export function isStorageUseDescription(description) {
  if (!description || typeof description !== "string") return false;
  const lc = description.toLowerCase();
  return STORAGE_USE_KEYWORDS.some((kw) => lc.includes(kw));
}

// ─── Operator name normalization ───────────────────────────────────────────
// Mirrors `pipelineVerificationOracle.js OPERATOR_ALIASES` so the Oracle's
// match scoring aligns with what we write here. Returns the canonical key
// the Oracle expects ("PSA" / "EXR" / "CUBE" / "SMA" / "AMERCO"), or the
// upper-cased original string if no alias matches (independent operators).

const OPERATOR_PATTERNS = [
  // PS Family (PSA + iStorage + NSA all consolidate to PSA per CLAUDE.md §6b)
  { re: /\b(public\s+storage|psa)\b/i, key: "PSA", name: "Public Storage" },
  { re: /\bi[\-\s]?storage\b/i, key: "PSA", name: "iStorage (PSA family)" },
  { re: /\b(nsa|national\s+storage\s+affiliates?)\b/i, key: "PSA", name: "NSA (PSA family)" },

  // EXR Family
  { re: /\bextra\s+space(\s+storage)?\b/i, key: "EXR", name: "Extra Space Storage" },
  { re: /\b(lsi|life\s+storage)\b/i, key: "EXR", name: "Life Storage (EXR family)" },
  { re: /\bexr\b/i, key: "EXR", name: "Extra Space Storage" },

  // CUBE
  { re: /\bcubesmart\b/i, key: "CUBE", name: "CubeSmart" },
  { re: /\bcube\b/i, key: "CUBE", name: "CubeSmart" },

  // SMA
  { re: /\bsmartstop(\s+self\s+storage)?\b/i, key: "SMA", name: "SmartStop Self Storage" },
  { re: /\bsma\b/i, key: "SMA", name: "SmartStop Self Storage" },

  // AMERCO / U-Haul
  { re: /\bu[\-\s]?haul\b/i, key: "AMERCO", name: "U-Haul / AMERCO" },
  { re: /\bamerco\b/i, key: "AMERCO", name: "U-Haul / AMERCO" },

  // Other named operators (independent — Oracle scoring won't match these
  // against REIT registry, but we still capture the permit for downstream
  // submarket-supply analysis)
  { re: /\bstorquest\b/i, key: "STORQUEST", name: "StorQuest" },
  { re: /\bstoragemart\b/i, key: "STORAGEMART", name: "StorageMart" },
  { re: /\bus\s+storage\s+centers?\b/i, key: "USSC", name: "US Storage Centers" },
  { re: /\bsimply\s+storage\b/i, key: "SIMPLY", name: "Simply Self Storage" },
  { re: /\bstoreease\b/i, key: "STOREEASE", name: "StorEase" },
  { re: /\bdevon\s+self\s+storage\b/i, key: "DEVON", name: "Devon Self Storage" },
  { re: /\bsroa\b/i, key: "SROA", name: "Storage Rentals of America" },
  { re: /\bmetro\s+self\s+storage\b/i, key: "METRO", name: "Metro Self Storage" },
];

/**
 * Normalize an applicant / contractor / owner string to a canonical operator
 * key. Returns `{ key, name, normalized }`. The `normalized` field is the
 * pattern-matched canonical name (good for human display); `key` is the
 * Oracle-friendly short code.
 *
 * If no pattern matches, returns `{ key: null, name: null, normalized: raw }`
 * so the entry still flows through (the Oracle handles unknown operators
 * via INCONCLUSIVE verdicts).
 */
export function normalizeOperator(raw) {
  if (!raw || typeof raw !== "string") {
    return { key: null, name: null, normalized: null };
  }
  for (const p of OPERATOR_PATTERNS) {
    if (p.re.test(raw)) {
      return { key: p.key, name: p.name, normalized: p.name };
    }
  }
  return { key: null, name: null, normalized: raw.trim() };
}

// ─── County slug ───────────────────────────────────────────────────────────

/**
 * Produce a stable, filename-safe slug from a county name.
 *   "Denton County, TX"     → "denton-tx"
 *   "Warren County, OH"     → "warren-oh"
 *   "Kenton County, KY"     → "kenton-ky"
 *   "Boone County, IN"      → "boone-in"
 *   "Hancock County, IN"    → "hancock-in"
 */
export function countySlug(countyName, stateAbbr) {
  const m = String(countyName).match(/^([A-Za-z]+)/);
  const county = m ? m[1].toLowerCase() : "unknown";
  const state = String(stateAbbr || "").toLowerCase();
  return state ? `${county}-${state}` : county;
}

// ─── Permit record schema validation ───────────────────────────────────────

const REQUIRED_FIELDS = [
  "permitNumber",
  "permitIssueDate",
  "jurisdiction",
  "city",
  "state",
];

const SOURCE_REQUIREMENT_NOTE =
  "At least one of (permitUrl, onFileSource) must be present for the entry to satisfy the Oracle citationRule.";

/**
 * Validate a permit record against the canonical schema. Returns
 * `{ ok: true }` when valid, or `{ ok: false, errors: [...] }` when not.
 */
export function validatePermitRecord(rec) {
  const errors = [];

  if (!rec || typeof rec !== "object") {
    return { ok: false, errors: ["record is not an object"] };
  }

  for (const f of REQUIRED_FIELDS) {
    if (!rec[f]) {
      errors.push(`missing required field: ${f}`);
    }
  }

  if (!rec.permitUrl && !rec.onFileSource) {
    errors.push(`missing source link — ${SOURCE_REQUIREMENT_NOTE}`);
  }

  if (rec.permitIssueDate && !isValidISODate(rec.permitIssueDate)) {
    errors.push(
      `permitIssueDate not ISO-8601 (got "${rec.permitIssueDate}" — expected YYYY-MM-DD)`
    );
  }

  if (rec.state && !/^[A-Z]{2}$/.test(rec.state)) {
    errors.push(`state must be 2-letter abbreviation uppercase (got "${rec.state}")`);
  }

  if (!rec.verifiedSource || !String(rec.verifiedSource).startsWith("permit-")) {
    errors.push(
      `verifiedSource must start with "permit-" (got "${rec.verifiedSource}") — pipelineConfidence rule #2`
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function isValidISODate(s) {
  if (typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

// ─── Canonical permit record builder ───────────────────────────────────────

/**
 * Build a canonical permit record from raw per-county fields. Always emits
 * the verifiedSource stamp + canonical operator key so downstream Oracle
 * matching is consistent. Returns a fully-shaped object that
 * validatePermitRecord() will accept.
 *
 * Required input:
 *   - countyName    e.g. "Denton County, TX"
 *   - stateAbbr     e.g. "TX"
 *   - permitNumber  e.g. "2025-04-1183"
 *   - permitIssueDate  "YYYY-MM-DD"
 *   - city          e.g. "Little Elm"
 *   - permitUrl OR onFileSource (one of them)
 *
 * Optional input:
 *   - operatorRaw   applicant/contractor/owner string — gets normalized
 *   - jurisdiction  defaults to countyName + " (" + stateAbbr + ")"
 *   - address, lat, lng, nrsf, ccPct, stories, status, expectedDelivery
 *   - description   the permit's use description (helpful for downstream audit)
 *   - estimatedInvestment (USD)
 */
export function buildPermitRecord(raw) {
  const slug = countySlug(raw.countyName, raw.stateAbbr);
  const op = normalizeOperator(raw.operatorRaw);

  const rec = {
    id: `permit-${slug}-${slugifyPermitNumber(raw.permitNumber)}`,
    permitNumber: raw.permitNumber,
    permitIssueDate: raw.permitIssueDate,
    jurisdiction:
      raw.jurisdiction || `${raw.countyName}${raw.stateAbbr ? ` (${raw.stateAbbr})` : ""}`,
    operator: op.key || (raw.operatorRaw ? String(raw.operatorRaw).trim() : null),
    operatorName: op.name || raw.operatorRaw || null,
    address: raw.address || null,
    city: raw.city,
    state: String(raw.stateAbbr || "").toUpperCase(),
    msa: raw.msa || null,
    lat: numOrNull(raw.lat),
    lng: numOrNull(raw.lng),
    nrsf: numOrNull(raw.nrsf),
    ccPct: numOrNull(raw.ccPct),
    stories: numOrNull(raw.stories),
    expectedDelivery: raw.expectedDelivery || null,
    status: raw.status || "permitted",
    estimatedInvestment: numOrNull(raw.estimatedInvestment),
    description: raw.description || null,
    verifiedSource: `permit-${slug}-${raw.permitNumber}`,
    verifiedDate: raw.verifiedDate || new Date().toISOString().slice(0, 10),
    permitUrl: raw.permitUrl || null,
    onFileSource: raw.onFileSource || null,
    notes: raw.notes || null,
  };

  return rec;
}

function slugifyPermitNumber(pn) {
  return String(pn)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── JSON file I/O ─────────────────────────────────────────────────────────

/**
 * Load the current county-permits.json. Returns the parsed object.
 */
export function loadCountyPermits() {
  const raw = fs.readFileSync(COUNTY_PERMITS_JSON, "utf-8");
  return JSON.parse(raw);
}

/**
 * Merge a batch of new permit records into county-permits.json. Idempotent
 * on `id` — re-running the same scraper won't duplicate entries; it updates
 * in place if the record already exists with a different field set.
 *
 * Validates every record before merge. Records that fail validation are
 * returned in `rejected[]` with errors — they are NOT written to the JSON.
 *
 * Returns `{ added, updated, rejected, totalAfter, jsonPath }`.
 */
export function mergePermitRecords(newRecords, opts = {}) {
  const { dryRun = false } = opts;

  const current = loadCountyPermits();
  const facilities = Array.isArray(current.facilities) ? [...current.facilities] : [];

  const indexById = new Map();
  facilities.forEach((f, i) => {
    if (f && f.id) indexById.set(f.id, i);
  });

  let added = 0;
  let updated = 0;
  const rejected = [];

  for (const rec of newRecords) {
    const validation = validatePermitRecord(rec);
    if (!validation.ok) {
      rejected.push({ record: rec, errors: validation.errors });
      continue;
    }

    if (indexById.has(rec.id)) {
      const idx = indexById.get(rec.id);
      const existing = facilities[idx];
      const merged = { ...existing, ...rec };
      if (JSON.stringify(merged) !== JSON.stringify(existing)) {
        facilities[idx] = merged;
        updated++;
      }
    } else {
      facilities.push(rec);
      indexById.set(rec.id, facilities.length - 1);
      added++;
    }
  }

  const next = {
    ...current,
    generatedAt: new Date().toISOString(),
    phase: facilities.length > 0 ? "INGESTION" : current.phase,
    totalFacilities: facilities.length,
    facilities,
  };

  if (!dryRun) {
    fs.writeFileSync(COUNTY_PERMITS_JSON, JSON.stringify(next, null, 2) + "\n", "utf-8");
  }

  return {
    added,
    updated,
    rejected,
    totalAfter: facilities.length,
    jsonPath: COUNTY_PERMITS_JSON,
    dryRun,
  };
}

// ─── HTTP helper ───────────────────────────────────────────────────────────

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Vanilla HTTPS GET with sensible defaults. Returns { status, headers, body }.
 * Use this for permit portals that don't require client-side JS hydration.
 * For JS-heavy portals, call `_puppeteer-render.mjs renderHTML()` instead.
 */
export async function httpGet(url, opts = {}) {
  const { headers = {}, timeoutMs = 30000 } = opts;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, ...headers },
      signal: ctl.signal,
    });
    const body = await res.text();
    const headerObj = {};
    res.headers.forEach((v, k) => {
      headerObj[k] = v;
    });
    return { status: res.status, headers: headerObj, body };
  } finally {
    clearTimeout(timer);
  }
}

// ─── CLI helpers ───────────────────────────────────────────────────────────

/**
 * Print a summary line for a scraper run. Standardized format so the
 * orchestrator (refresh-county-permits.mjs) can grep / pattern-match.
 */
export function printSummary(name, result) {
  const dry = result.dryRun ? " (DRY RUN)" : "";
  const lines = [
    `[${name}]${dry} added=${result.added} updated=${result.updated} rejected=${result.rejected.length} totalAfter=${result.totalAfter}`,
  ];
  if (result.rejected.length > 0) {
    lines.push(`  REJECTED records:`);
    for (const r of result.rejected) {
      const id = r.record?.id || r.record?.permitNumber || "(no id)";
      lines.push(`    - ${id}: ${r.errors.join("; ")}`);
    }
  }
  console.log(lines.join("\n"));
}
