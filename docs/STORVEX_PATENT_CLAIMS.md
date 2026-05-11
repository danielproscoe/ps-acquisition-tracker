# Storvex Patent Claims Index

> **Single source of truth for the patent attorney filing today (and CIPs to follow).**
> Every claim below is co-located with a `patentClaims` block in the apparatus
> data file or a JSDoc patent-claim header on the apparatus function, so the
> IP capture is unambiguous and the attorney can cite either the data file,
> the JSDoc, or this index — whichever fits the filing format best.

**Patent application reference:** US Provisional App. No. 64/009,393
**Filing scope:** This index covers all claim-eligible methods and systems
shipped through commit `945dd98` (the Radius+ displacement layer) plus the
four additional claim blocks added in the immediately following commit
(this document, the family-proximity JSDoc, the orchestration JSDoc, and the
DealFlow Oracle ranking patentClaims block in `public/operator-matrix.json`).

**Public deployment:** https://storvex.vercel.app — live since 2026-05-10
**Repository:** github.com/danielproscoe/ps-acquisition-tracker (public)

---

## Claim 1 — Pipeline-aware Climate-Controlled Supply-Per-Capita (CC SPC) Method

**Apparatus reference:**
- Data: `src/data/submarketPipelineSupply.json` (registry + claim text)
- Logic: `src/utils/pipelineSupplyLookup.js` (`computeProjectedCCSPC`)
- Render: `src/QuickLookupPanel.js` MARKET INTEL band's COMPETITION card

**System claim:** Method for computing forward-looking climate-controlled
self-storage supply-per-capita metric (CC SPC · 5-yr projected) comprising:
(1) aggregating per-submarket pipeline CC SF from primary-source disclosures
including REIT 10-Q / 8-K filings, building permits, and planning commission
records; (2) normalizing pipeline facility square footage with status-
weighted confidence (under_construction = 1.0, permitted = 0.85,
announced = 0.50); (3) computing projected CC SPC as (current CC SF +
status-weighted pipeline CC SF) divided by projected 5-yr population;
(4) surfacing both the pipeline-aware projection and the flat-supply
fallback in a unified market intelligence display with source citation
per pipeline facility.

---

## Claim 2 — Audited-vs-Computed CC SPC Overlay with Calibration Feedback Loop

**Apparatus reference:**
- Data: `src/data/auditedSubmarketSPC.json` (registry + claim text)
- Logic: `src/utils/auditedSPCLookup.js` (`lookupAuditedCCSPC` + `calibrationDelta`)
- Render: `src/QuickLookupPanel.js` MARKET INTEL band's COMPETITION card (audited chip)

**System claim:** System for surfacing audited and computed climate-controlled
supply-per-capita metrics side-by-side comprising: (1) a registry of per-
submarket audited CC SF values timestamped by audit year and source;
(2) a lookup function returning audited values keyed by submarket
coordinates; (3) a render layer overlaying audited-vs-computed delta in the
market intelligence display with confidence band rendered as a colored chip;
(4) a calibration feedback loop that adjusts the computed estimator's brand-
weighting constants based on residual error vs the audited value, persisted
across submarkets so the platform converges toward licensed-third-party-
audit-equivalent accuracy without licensing third-party audit data.

---

## Claim 3 — DealFlow Oracle Ranked Buyer Shortlist

**Apparatus reference:**
- Data: `public/operator-matrix.json` (49-operator registry + tier + deployment-pressure + geography + claim text)
- Logic: `src/QuickLookupPanel.js` — `listMatrixOperators()` + `matrixShortlist` computation in `runLookup()`
- Render: DealFlow Oracle Shortlist Panel in `QuickLookupPanel.js`

**System claim:** System for ranking institutional self-storage acquisition
buyers against a subject site, comprising: (1) a buyer-routing matrix
indexed by operator identity and storing per-operator firmographics,
capital-deployment-pressure classification, geographic underwriting bounds,
and historical acquisition cadence; (2) a tier-classification engine
assigning each operator to one of N tiers based on disclosed capital events,
fund vintage, transaction history, and product fit; (3) a composite ranking
function combining a tier-weight value with a deployment-pressure bonus and
a geographic-fit coefficient to produce a numerical buyer score per site;
(4) a render layer surfacing the top-K ranked operators as a ranked
shortlist with pitch-angle template, exec contact roster, and a one-click
pitch-email generator.

**Method claim:** See `public/operator-matrix.json` → `patentClaims.method`.

---

## Claim 4 — Cross-REIT Family Proximity with Brand-Acquisition Consolidation

**Apparatus reference:**
- Data: `public/ps-locations.csv` + `public/nsa-locations.csv` + `public/ps-locations-3rdparty.csv` + `public/ps-locations-combined.csv`
- Logic: `src/QuickLookupPanel.js` — `findREITFacilitiesNearby()` with JSDoc patent header

**System claim:** A system for institutional self-storage facility proximity
computation accounting for cross-brand portfolio acquisitions, comprising:
(1) an authoritative storage facility registry containing per-facility
coordinates and a normalized brand identifier; (2) a brand-consolidation
table mapping acquired brands to their acquiring parent (e.g., iStorage → PSA,
NSA → PSA, Life Storage → EXR); (3) a haversine distance computation between
subject coordinates and every registry facility; (4) a render layer
surfacing the nearest facility of the consolidated REIT family rather than
the nearest facility of any single legacy brand — preventing the underwriter
from mis-classifying a coverage-gap submarket as a cannibalization-risk
submarket when the nearest facility was already acquired by the target
REIT family.

**Method claim:** See JSDoc on `findREITFacilitiesNearby` in `QuickLookupPanel.js`.

---

## Claim 5 — Agentic Orchestration Pipeline (Single Address → Multi-Layer Site Intelligence)

**Apparatus reference:**
- Logic: `src/QuickLookupPanel.js` — `runLookup` (extensive JSDoc patent header)
- Oracles: `src/QuickLookupPanel.js` — `ZoningOraclePanel` / `UtilityOraclePanel` / `AccessOraclePanel`
- API: `api/zoning-lookup.js` + `api/utility-lookup.js` + `api/access-lookup.js` (Claude-backed oracle services)
- Synthesis: `StorvexVerdictHero` + MARKET INTEL band + `CCSPCHeadline` in `QuickLookupPanel.js`

**System claim:** A system for institutional self-storage site intelligence
orchestrated from a single address input, comprising: (1) an address
geocoder producing latitude / longitude / canonical address from free-text
input; (2) a parallel-fetch dispatcher concurrently issuing requests to a
demographics enrichment service, a competitor-discovery service, an
authoritative REIT-family facility registry, a buyer-routing matrix, and a
market-rents service; (3) a synchronization barrier collecting all parallel
fetches before proceeding; (4) an oracle layer dispatching three
asynchronous LLM agents in parallel — a zoning oracle, a utility oracle,
and an access oracle — each invoking primary-source retrieval tools
(web_search + web_fetch) and returning structured JSON with source
citations and confidence classification; (5) a synthesis layer producing a
multi-section institutional site intelligence memorandum including a
verdict score, a best-fit-buyer determination, a five-beat narrative
thesis, a market-intelligence band, and a ranked buyer shortlist;
(6) a client-side cache keyed by normalized address with TTL of at least
one calendar day so repeat lookups are returned in under one second from
local storage without re-issuing the parallel fetches.

**Method claim:** See JSDoc on `runLookup` in `QuickLookupPanel.js`.

---

## Claim 6 — Multi-Buyer-Lens Underwriting (Side-by-Side Operator Economics)

**Apparatus reference:**
- Data: `src/buyerLensProfiles.js` (six lens profiles: PSA / EXR / CUBE / UHAL / SMA / GEN)
- Logic: `src/buyerLensProfiles.js` — `computeBuyerLens()`
- Render: `src/components/AssetAnalyzerView.js` multi-lens comparison table

**System claim:** System for institutional self-storage acquisition under-
writing producing concurrent per-buyer-lens verdicts on a single deal input,
comprising: (1) a registry of N institutional buyer profiles each tagged
with primary-source 10-K-derived constants for same-store opex ratio, brand-
premium revenue lift, ECRI program rate, stabilized occupancy, weighted
cap rate, and yield-on-cost hurdle; (2) a parameterized underwriting engine
that, given a subject deal's ask + NRSF + units + occupancy + T-12 NOI +
T-12 EGI + deal type, computes for each buyer lens an independent buyer
NOI reconstruction, stabilization projection, Home Run / Strike / Walk
price tiers, and a PURSUE / NEGOTIATE / PASS verdict; (3) a render layer
surfacing all N lenses simultaneously sorted by implied takedown price
descending, with a platform-fit-Δ metric quantifying the dollar advantage
the highest-fit buyer enjoys over a third-party-managed generic
institutional baseline.

**Method claim:** Method comprising: (a) loading the buyer-lens registry;
(b) for each lens, applying lens-specific opex overrides + cap rate +
brand-premium adjustment to the deal inputs; (c) computing the lens-
specific stabilized NOI and applying the lens-specific cap to derive an
implied takedown price; (d) classifying the verdict by comparing the deal
stabilized cap to the lens hurdle; (e) sorting the lens results by implied
takedown price descending and computing the dollar-delta between the top
lens and the generic baseline lens; (f) rendering all lenses in a single
table with platform-fit-Δ as the headline metric.

---

## Claim 7 — Survey Scrub Gate (Easement + Access Risk Classification)

**Status:** WORKFLOW SPECIFICATION SHIPPED · CODE IMPLEMENTATION DEFERRED

**Apparatus reference:**
- Specification: `CLAUDE.md` §6h Step 2c — full classification rules + verdict gate
- Render: `<SurveyBadge>` component referenced in §6h-2 (deferred CIP)

**System claim (provisional, full implementation forthcoming):** A system for
automated classification of survey-derived easement and access risk on
institutional commercial real estate acquisition targets, comprising:
(1) ingestion of an ALTA survey or boundary survey document at intake;
(2) automated extraction of every easement (gas / pipeline / electric
transmission / drainage / sanitary / water / ingress-egress / sight-
distance) including type, width, location, and recorded reference;
(3) for grocery-anchored retail subject sites, a four-directional customer-
flow access test (north / south / east / west) producing per-direction
verdicts (DIRECT / LOOP REQUIRED / U-TURN REQUIRED); (4) for self-storage
subject sites, a standard frontage / curb-cut / signal-proximity /
landlocked access test; (5) a verdict classifier producing one of
CLEAN / FLAGGED / KILL / PENDING / NOT_ON_FILE; (6) a classification gate
preventing sites with KILL verdict from entering the acquisition pipeline
and capping FLAGGED / PENDING / NOT_ON_FILE sites at the YELLOW
classification regardless of composite SiteScore.

> **CIP note:** Code implementation of the Survey Scrub Gate is queued for
> the next sprint (next 14 days). Filing this claim as provisional in the
> current cycle locks the priority date; the code-shipped implementation
> will be added via continuation-in-part within 30 days.

---

## Claim 8 — Storvex vs Radius+ Feature-Parity Comparison Apparatus

**Apparatus reference:**
- Component: `src/components/AssetAnalyzerView.js` — `RadiusPlusComparisonCard`
- Rendered in: OM Asset Analyzer view + Quick Lookup result page

**System claim:** Apparatus for explicit feature-by-feature comparison
between an institutional self-storage acquisition intelligence platform
and a third-party storage data platform, comprising: (1) a feature
registry enumerating N distinct platform capabilities grouped by
category (rent data, forecasting, cost basis + comps, underwriting,
coverage breadth, forward-looking supply intelligence); (2) per-feature
status fields for each platform (yes / partial / no) with primary-source
or roadmap citations per row; (3) a totals computation producing the
covered-feature counts and a "unique to platform A" count; (4) a render
layer surfacing the comparison both as a collapsed-summary strip
("Platform A covers N/M · Platform B covers K/M · Platform A unique
features: U") and as an expandable feature-by-feature table.

**Method claim:** Method comprising: (a) maintaining the feature registry
synchronized with platform capability ship dates; (b) on every result
render, recomputing the totals; (c) when a feature ships, flipping its
status from `no` to `partial` (architecture-shipped) or `yes` (data-
populated) with explicit architecture or roadmap citation text rendered
inline beneath the status indicator.

---

## Claim 9 — Verbatim-Anchored Institutional Site Intelligence Memorandum Generation

**Apparatus reference:**
- API: `api/analyzer-memo.js` — Claude-backed IC memo generation with structured JSON output schema + tone rules
- Render: `MemoView` component in `AssetAnalyzerView.js`

**System claim:** Pre-existing — covered in App. No. 64/009,393 baseline.
Mentioned here for cross-reference to the agentic orchestration claim
above (Claim 5), of which this is a subsystem.

---

## 4-Layer IP Stack — Meta-Claim

**System claim (meta):** A four-layer institutional real estate site
intelligence apparatus, comprising in vertical integration:
1. **Data schema layer** — versioned JSON registries with embedded
   `patentClaims` blocks co-located with apparatus references (e.g.
   `submarketPipelineSupply.json`, `auditedSubmarketSPC.json`,
   `operator-matrix.json`).
2. **Lookup utility layer** — pure functions keyed by submarket /
   operator / facility coordinates returning structured results with
   `matched: true | false` discriminator and fallback metadata.
3. **Composite scorer layer** — weighted-dimension scorers (SiteScore,
   buyer-lens NOI reconstruction, CC SPC verdict) producing audit-
   traceable numerical outputs every step of which traces to a
   primary-source citation.
4. **Render layer** — institutional-grade React surface that surfaces
   data + lookup + scorer outputs in a unified site-intelligence
   memorandum with per-number source citation, audited-vs-computed
   overlay where applicable, and a single-click export to structured
   JSON payload ready for ingestion into downstream REIT data lakes.

The combination of all four layers in a single co-located repository,
with each layer's apparatus referenced in the next layer's claim text,
is itself the patent-eligible system — distinct from any individual
layer's claim above.

---

## Cross-References

| Claim | Apparatus File | Render Location |
|---|---|---|
| 1 — Pipeline CC SPC | `src/data/submarketPipelineSupply.json` + `src/utils/pipelineSupplyLookup.js` | QuickLookupPanel MARKET INTEL band |
| 2 — Audited CC SPC | `src/data/auditedSubmarketSPC.json` + `src/utils/auditedSPCLookup.js` | QuickLookupPanel MARKET INTEL band (audited chip) |
| 3 — DealFlow Oracle | `public/operator-matrix.json` (patentClaims) | QuickLookupPanel DealFlow shortlist panel |
| 4 — Family Proximity | `findREITFacilitiesNearby` JSDoc in `QuickLookupPanel.js` | StorvexVerdictHero best-fit-buyer decision tree |
| 5 — Agentic Orchestration | `runLookup` JSDoc in `QuickLookupPanel.js` | Whole Quick Lookup result page |
| 6 — Multi-Buyer Lens | `src/buyerLensProfiles.js` | AssetAnalyzerView multi-lens table |
| 7 — Survey Scrub Gate | `CLAUDE.md` §6h Step 2c (spec) — code CIP forthcoming | `<SurveyBadge>` component (deferred) |
| 8 — Feature Parity Card | `RadiusPlusComparisonCard` in `AssetAnalyzerView.js` | OM Analyzer + Quick Lookup result page |
| 9 — IC Memo Generation | `api/analyzer-memo.js` | AssetAnalyzerView MemoView |

---

*Patent claims index last updated: 2026-05-11 · commit immediately following `945dd98`.*
*This file is intended as a single reference document for the patent
attorney filing the current update to App. No. 64/009,393. Each claim
above is supported by a corresponding `patentClaims` block in the
apparatus data file or a JSDoc patent-claim header on the apparatus
function — whichever co-location format the attorney prefers to cite.*
