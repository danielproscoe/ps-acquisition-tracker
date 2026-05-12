# Move 2 — REIT 10-Q Properties Under Development (PUD) Scraper Architecture

**Status:** queued · 5/12/26+ pickup
**Owner:** next session
**Companion to:** `pipelineConfidence.js` (Move 1) · `pipelineVerificationOracle.js` (Move 3)

## Goal

Refresh `src/data/development-pipeline.json` quarterly from each storage REIT's most recent 10-Q "Properties Under Development" section. Each ingested facility carries an automatic verification stamp so the Pipeline Confidence chip layer turns VERIFIED on its own — no manual backfill required.

This closes the data-coverage gap behind the chip layer: today the chip works on the legacy `citation: "Accession <#>"` field for seeded entries, but the seed is 18 facilities from FY2025 10-Ks. The scraper turns this into a live registry that auto-refreshes as REITs file 10-Qs.

## Per-Facility Stamps Written by the Scraper

```json
{
  "id": "psa-houston-2027q1-q1-2026",
  "operator": "PSA",
  "operatorName": "Public Storage",
  "address": "Cypress / NW Harris County",
  "city": "Cypress",
  "state": "TX",
  "msa": "Houston",
  "nrsf": 110000,
  "ccPct": 90,
  "stories": 3,
  "expectedDelivery": "2027-Q1",
  "status": "under-construction",
  "estimatedInvestment": 21000000,
  "source": "PSA Q1 2026 10-Q · Properties Under Development",
  "citation": "Accession 0001628280-26-XXXXXX",
  "verifiedSource": "EDGAR-10Q-0001628280-26-XXXXXX",
  "verifiedDate": "2026-05-12",
  "verifierName": "storvex-scraper-edgar",
  "verificationNotes": "Extracted from PSA Q1 2026 10-Q PUD table row 7 · NRSF 110K · Investment $21M · Expected Q1 2027"
}
```

The `verifiedSource` field's `EDGAR-` prefix triggers automatic VERIFIED status via `pipelineConfidence.js` derivation rule #3. `verifiedDate` of today's date keeps the chip green for 90 days, after which it auto-flips to STALE pending the next scraper run.

## Per-REIT Parser Branches

Each REIT formats its PUD section differently. Initial implementation: PSA-only proof of concept, then expand.

### PSA (Public Storage)
- 10-Q section title: typically **"Properties Under Development"** or **"Real estate facilities under construction or development"** in MD&A
- Table columns: Location · Estimated Square Footage · Estimated Investment · Estimated Construction Period
- Most recent: search submissions index for form="10-Q" sorted by filingDate DESC, take latest
- CIK: 1393311

### EXR (Extra Space Storage)
- 10-Q section title: **"Properties Under Development"** in MD&A
- Table columns: Location · State · Sq Ft · Stories · Anticipated Opening
- CIK: 1289490

### CUBE (CubeSmart)
- 10-Q section title: **"Real Estate Facilities Under Development"**
- Table columns: Location · Approx NRSF · CC% · Anticipated Opening Date · Cost Estimate
- CIK: 1298675

### NSA (legacy, post-PSA-merger)
- May not have new pipeline disclosure post-acquisition. Check 2025-Q3 filing (last pre-merger).
- CIK: 1618563

### SMA (SmartStop)
- Non-traded REIT, files 10-Q quarterly. Smaller pipeline.
- CIK: 1585389

## Implementation Plan

### Step 1 — Extend `scripts/edgar/fetch-filing.mjs`

Already has `listFilings(idx, predicate)` — use predicate `(f) => f.form === "10-Q"` and take the most recent. The fetch helpers are reusable.

### Step 2 — Build `scripts/edgar/extract-10q-properties-under-development.mjs`

Pattern matches `extract-8k-transactions.mjs` (same htmlToText helper, same per-issuer pattern bank).

```js
import { STORAGE_REITS } from "./cik-registry.mjs";
import { fetchSubmissionsIndex, listFilings, fetchFilingDocument } from "./fetch-filing.mjs";

const PUD_SECTION_PATTERNS = {
  PSA: [
    /Properties\s+Under\s+Development[\s\S]{0,200}?(?:Location|Submarket)/i,
    /Real\s+estate\s+facilities\s+under\s+construction\s+or\s+development/i,
  ],
  EXR: [/Properties\s+Under\s+Development[\s\S]{0,200}?Location/i],
  CUBE: [/Real\s+Estate\s+Facilities\s+Under\s+Development/i],
};

// Per-issuer row extractor — each REIT has a different column count + order.
const PUD_ROW_EXTRACTORS = {
  PSA: extractPSARow,
  EXR: extractEXRRow,
  CUBE: extractCUBERow,
};
```

### Step 3 — Merge with existing `development-pipeline.json`

The existing 18 seeded entries should be preserved. Append new entries from the scraper run. Deduplicate by `id` (constructed as `{operator-lowercase}-{city-slug}-{deliveryQuarter}-{filingFY}-Q{filingQuarter}`).

```js
function mergeDevelopmentPipeline(existing, scraped) {
  const byId = Object.fromEntries(existing.facilities.map((f) => [f.id, f]));
  for (const newFacility of scraped) {
    byId[newFacility.id] = newFacility; // overwrites stale entries
  }
  return { ...existing, facilities: Object.values(byId), generatedAt: new Date().toISOString() };
}
```

### Step 4 — Schedule

Vercel cron in `vercel.json` running daily at 06:00 UTC:

```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-pud-pipeline",
      "schedule": "0 6 * * *"
    }
  ]
}
```

API route triggers the scraper script via child process, writes to a Vercel KV store or commits back to GitHub via the existing daily-rents-bot commit pattern.

Alternative (simpler): GitHub Actions cron that runs the scraper script + commits + pushes. Same pattern as the existing daily rent refresh (`6f7ab16` daily-refresh commit).

## Building-Permit Scraper Template

Second layer of Move 2. Each county GIS portal has its own API/format — start with one and template:

- **Denton County, TX** (Aubrey submarket): https://gis.dentoncounty.gov/
- **Warren County, OH** (Springboro submarket): https://www.co.warren.oh.us/
- **Kenton County, KY** (Independence submarket): https://www.kentoncounty.org/

Permit data writes `verifiedSource: "permit-{county}-{permit-number}"` so the chip layer auto-classifies as VERIFIED for permit-cited entries.

## Test Plan

- **PSA parser**: snapshot test against a real Q4 2025 10-Q. Assert ≥3 facilities extracted with all required fields populated.
- **Merge logic**: existing seed entries preserved; new entries appended; duplicate IDs overwrite stale.
- **Verification stamp**: `verifiedSource` starts with `EDGAR-10Q-`; `verifiedDate` is today; chip status derives to VERIFIED.

## Estimated Effort

- PSA parser + merge + tests: ~3 hours
- EXR + CUBE parsers: ~2 hours each
- GitHub Actions cron wiring: ~1 hour
- Building-permit scraper template (one county): ~2 hours
- **Total Move 2 first pass: ~10 hours** (one focused session if continuous)

## Dependencies / Risks

- 10-Q PUD table layouts change occasionally — parsers will need periodic maintenance
- SEC EDGAR rate limit: 10 req/sec; we're well below
- County permit portals have ad-hoc rate limits + occasional CAPTCHA — start with the most permissive (state DOT-style GIS, not Cloudflare-fronted)

## Hand-off Notes

When picking this up next session:
1. Read this doc + the existing `extract-8k-transactions.mjs` + `extract-same-store-growth.mjs` patterns
2. Start with PSA-only — get the PSA parser shipping before expanding to other REITs
3. Verify the chip layer auto-turns VERIFIED via the EDGAR- prefix derivation (no UI changes required)
4. Wedge PDF v2 should call out the live data refresh as a 7th-or-8th moat dimension
