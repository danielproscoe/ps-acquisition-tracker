# REC Package Capstone — "Institutional Investment Analysis"

**Sign-off:** Dan Roscoe, 2026-04-16
**Author:** Claude (Opus 4) in concert with Dan
**Repos affected:** `sitescore-peco` (retail/PECO) + `ps-acquisition-tracker` (storage/Storvex)
**Insert location:** After `sec-RA` (Rent Analysis Workup) in `src/reports.js`
**Section anchor:** `sec-CAP` (Institutional Investment Analysis)
**Status:** APPROVED — Ship all 10 sub-sections as designed

---

## Purpose
Make a PECO / PS analyst's 3-day workpaper obsolete. Every number sourced to a primary reference (10-Ks, ICSC, Boulder Group, Green Street, RSMeans, REIS, CoStar, ESRI), every assumption triangulated. When an analyst opens this they should wonder "how did they already know the CC rents would be that, how did they know the Kroger and pad YOC would be this — they didn't even have a model." That's the bar.

## Deployment plan (chunked)
**Chunk 1 — PECO foundation**
- New helper: `src/valuationAnalysis.js` — pure functions for IRR, sensitivity matrix, 10-yr pro forma, land triangulation, comp-sales lookup by state
- `reports.js`: insert `sec-CAP` section (4a + 4c + 4j only in Chunk 1)
- Wire `anchorIntel` / `targetAnchor` / `anchorIntelSource` fields into exec summary header
- Commit + push + Vercel READY + Chrome QC on Manvel

**Chunk 2 — PECO complete**
- Add remaining sub-sections 4b, 4d, 4e, 4f, 4g, 4h, 4i to `sec-CAP`
- Hardcoded comp-sales DB for TX, OH, IN, TN, KY, FL, GA (densest PECO pipeline states). Placeholder for other states.
- Commit + push + QC

**Chunk 3 — Storvex mirror**
- Parallel `valuationAnalysis.js` in ps-acquisition-tracker with storage calibration
- Storage anchor DB (PSA/EXR/CUBE/LSI/NSA 10-K CC rents by MSA, drive-up rates, cap rates)
- Comp sales by state (self-storage REIT transactions)
- Commit + push + QC

---

## Section 4 — Institutional Investment Analysis (`sec-CAP`)

### 4a. 10-Year Pro Forma — Year-by-Year Cash Flows
Table: Year 1 → Year 10.

**Rows:**
- Occupancy % (ramp Y1 70% → Y2 85% → Y3 97.3% stabilized per PECO 10-K, hold thereafter)
- Gross Potential Rent (base × 1.027^year for rent bumps)
- Vacancy Loss
- EGI
- RE Tax ($2.57/SF × GLA × 1.02^year inflation)
- Insurance ($0.50/SF × GLA × 1.03^year)
- Management Fee (4% of EGI)
- Repairs & Maintenance ($0.75/SF × GLA × 1.03^year)
- CAM Gross ($3.69/SF × GLA × 1.025^year)
- Total OpEx
- CAM Recovery (88.8% × CAM Gross per PECO 10-K)
- Pad GL Income (flat, 10% bump every 5 yrs per QSR lease standard)
- **NOI**
- NOI Growth %

**Storage variant:** CC rent/SF (e.g. $1.45/SF/mo base) × CC SF + drive-up rent × drive-up SF. Y1 occupancy 50% lease-up → Y3 stabilized 91% per PSA 10-K. ECRI 5-8%/yr on stabilized tenants (PSA disclosure).

### 4b. Rent Escalation Schedule
Per-tenant Year 1 → Year 10 rent PSF with bumps. Grocery anchor typically 10% every 5 years (PECO 10-K avg), inline 2.7%/yr, pad GL CPI-capped 10% every 5 yrs (Boulder Group net lease standard). Storage: ECRI 6%/yr base (PSA/EXR).

### 4c. Sensitivity Matrix — 3×3 headline YOC
| | Rent −10% | Base | Rent +10% |
|---|---|---|---|
| Cap rate +50bps | YOC% | YOC% | YOC% |
| Base (6.3%) | YOC% | **headline YOC%** | YOC% |
| Cap rate −50bps | YOC% | YOC% | YOC% |

Second matrix: Land ±10/20% × Hard Cost ±5/10%. Cells colored green/amber/navy by YOC relative to hurdle.

### 4d. Downside / Base / Upside Scenarios
Three side-by-side mini pro formas:
- **Downside:** −10% rent, +10% hard cost, 7.0% exit cap, 85% stab occupancy → YOC, Stab Value, Value Creation, Unlevered IRR
- **Base:** Current sec-VW numbers
- **Upside:** +5% rent, comp anchor lands early, 6.0% exit cap, 98% stab

### 4e. Land Pricing Triangulation — Three Methods
1. **Residual Land Value** = (Stab Value at 6.3% cap) − (Net Dev Cost excluding land) − (Target Dev Profit 15%)
2. **Income Approach** = (NOI ÷ target dev yield 8%) − (Hard + Soft Costs)
3. **Comp Sales** = Average of 5–8 nearby land sales ($/AC adjusted for subject)

Bar chart showing subject asking, triangulated range (low/mid/high), recommended offer.

### 4f. Comp Sales Grid — Grocery-Anchored Retail (or Storage)
Table of 5–8 stabilized asset sales in MSA/state, last 24 months. Columns: Address, Sale Date, Anchor / Facility Name, GLA / Net Rentable SF, $/SF, Cap Rate, Buyer type (REIT / Private / Syndicate).

**Retail sources:** PECO / Regency / Kimco IR transaction disclosures, CBRE Retail Investment Sales, RCA, SRS National.
**Storage sources:** PSA/EXR/CUBE/LSI/NSA 10-Ks + Cushman Self-Storage Market Report + SSA Global.

Computes MSA/state avg cap rate → validates the 6.3% (retail) or 5.5%–6.25% (storage) exit cap assumption.

### 4g. Financing Scenario (Base Case)
Capital stack assumption = REIT norm for the product:
- **Retail/PECO:** 55% LTC construction at SOFR+275 (~8.1% today), 3-yr IO → perm at 6.0% fixed, 25-yr amort
- **Storage/PS:** 60% LTC at SOFR+300, 3-yr IO → perm at 6.25%, 30-yr amort

Outputs: construction interest cost, cash equity required, stabilized DSCR, cash-on-cash Y5, Unlevered IRR, Levered IRR, refinance proceeds (cash-out at stabilization).

### 4h. Risk-Adjusted IRR Table
10-yr hold, exit Year 10 at entry cap +50bps. Three rows: Downside (20%), Base (60%), Upside (20%) → Levered IRR, MOIC. Probability-weighted footer row.

### 4i. Source Stack — Every Number Cited
Expandable panel listing every assumption and its citation. Format: `<metric> → <value> → <source with page/section>`.

Example rows:
- Anchor rent $10.00/SF → PECO 10-K FY2025, p. 42, Grocery ABR disclosure
- 97.3% stab occupancy → PECO 10-K, Portfolio Operating Metrics
- 88.8% CAM recovery → PECO 10-K, Same-Store Analysis
- 6.3% exit cap → PECO 10-K Acquisition Activity + Green Street Q1 2026 Grocery Cap Rate Survey
- 2.7% rent bumps → PECO 10-K New & Renewal Lease Terms
- $85 warm-shell hard cost → PECO Development Actuals + RSMeans Q1 2026 (state-indexed)
- ESRI demographics → ArcGIS GeoEnrichment 2025 (2025 current + 2030 projection)

### 4j. "How We Know" Panel (the dagger)
Callout block at top of Section 4:

> Every number in this analysis maps to a primary source. PECO 10-K, ICSC 2025 Factbook, Boulder Group Net Lease Q1 2025, RSMeans Q1 2026, REIS, CoStar, and ESRI GeoEnrichment 2025 — cross-validated across 2–3 sources per assumption. The rent we modeled for Kroger? It's Kroger's disclosed ABR from page 42 of PECO's 10-K, adjusted for this submarket's income tier and grocery-desert premium. The pad cap we used? Boulder Group Q1 2025 Net Lease Report, Table 3, CFA ground lease comps. No guesses. No markups. No model required.

## Companion: `anchorIntel` exec-summary chip
When `site.anchorIntel` exists, render a gold-bordered 1-line callout directly under the SiteScore badge in the REC package header:

> **KROGER ANCHOR INTENT** — Tony Edwards (PECO) directed sourcing · Jan 26, 2026 · target-area screenshot in thread

Clicking opens an `mi-panel` with the full `anchorIntel` text + `anchorIntelSource`.

---

## Data dependencies — what fin already exposes (PECO)
From `computeRetailFinancials`: `yocGross, yocNet, stabNOI, grossDevCost, netDevCost, totalPadSaleProceeds, totalPadGLIncome, anchorName, anchorPrototypeSF, anchorRent, juniorRent, inlineRent, padRent, totalGLA, anchorSF, juniorSF, inlineSF, padSF, padCount, salePads[], glPads[], costIdx, weightedAvgRent, grossPotentialRent, effectiveGrossIncome, propTax, insurance, mgmtFee, camGross, repairs, totalCAMReimb, totalHardCost, softCosts, tiLC, totalDevCost, stabilizedValue, valueCreation, devMargin, verdict, verdictColor, landCost`.

**New fields the helper needs:**
- `fin.padAcresTotal` (for land triangulation)
- `fin.anchorCategory` ("grocery" | "drug" | "value" | "sporting goods")
- `fin.yearBuiltProjection` (default = current year + 2)

## Comp data files to add
- `src/data/retailCompSales.js` — state-keyed grocery-anchored sale comps (TX, OH, IN, TN, KY, FL, GA first)
- `src/data/landCompSales.js` — state-keyed vacant retail land sales with $/AC
- `src/data/capRateSurveys.js` — quarterly cap rate by property subtype + state (Green Street)
- Storvex: `src/data/storageCompSales.js` + `src/data/storageCapRates.js` + `src/data/msaCCRents.js` (from REIT 10-Ks)

## QC checklist before commit
- [ ] Every `fmtD()` / `fmtM()` call has a finite number (no `NaN` / `undefined`)
- [ ] All sub-sections render when `fin.padCount === 0` (no pads variant)
- [ ] Storage variant handles drive-up-only (no CC units)
- [ ] `sec-CAP` collapses cleanly when site has insufficient data to compute
- [ ] Print preview renders full section without cutting off tables
- [ ] Hover tooltips don't overflow the container
- [ ] `anchorIntel` chip is conditional — doesn't render if field empty
