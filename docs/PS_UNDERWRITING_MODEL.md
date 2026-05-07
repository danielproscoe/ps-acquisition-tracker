# Public Storage (PSA) Underwriting Model — Primary-Source Research Pack

**Compiled: May 7, 2026**
All figures sourced to FY2025 10-K, Q4 2025 / Q1 2026 earnings, and named sector reports.

This document is the source of truth for the constants encoded in
`src/buyerLensProfiles.js` (PS_LENS). When PSA reports new earnings,
update both this doc AND the code module to stay in sync.

---

## PSA SAME-STORE OPEX — FY2025 (FYE Dec 31, 2025)

**Source:** [PSA Q4/FY2025 Press Release (BusinessWire)](https://www.businesswire.com/news/home/20260212066179/en/Public-Storage-Reports-Fourth-Quarter-and-Full-Year-2025-Results)

Same-store pool: 2,565 properties / 175.3M NRSF
Same-store revenue: $3,764,833K (~flat YoY)
Same-store NOI: $2,828,915K (-0.5% YoY)

| Line item | $K | % of Revenue | YoY |
|---|---|---|---|
| Property taxes | 378,266 | **10.05%** | +5.3% |
| On-site property manager payroll | 129,254 | **3.43%** | -5.0% |
| Repairs & maintenance | 78,046 | **2.07%** | +1.4% |
| Utilities | 49,633 | **1.32%** | +1.0% |
| Marketing | 83,285 | **2.21%** | -4.4% |
| Other direct property costs | 101,889 | **2.71%** | +0.2% |
| **Total direct costs** | **820,373** | **21.79%** | **+1.2%** |
| Indirect cost of operations | 115,545 | **3.07%** | +6.0% |
| **TOTAL SAME-STORE OPEX** | **935,918** | **24.86%** | **+1.7%** |
| **SAME-STORE NOI MARGIN** | | **75.14%** | |

**Interpretation:**
- Mgmt fee = $0 (PSA is self-managed; no third-party expense)
- On-site property manager payroll just **3.43% of revenue** vs industry **5–7%** — central regional staffing model, not per-store FTEs
- Marketing **2.21%** is the brand-efficiency line — independents typically run **4–6%**
- **Q4 2025 specifically**: same-store NOI margin reported at **78.4%** (Modern Storage Media earnings transcript) — full-year is 75.1%

---

## PSA REVENUE DYNAMICS — FY2025

| Metric | FY2025 | YoY |
|---|---|---|
| Average occupancy | **92.0%** | -0.4% |
| Year-end occupancy | **91.0%** | +0.5% |
| Realized annual rent / occupied SF | **$22.54** | +0.5% |
| Realized annual rent / available SF | **$20.74** | +0.1% |
| Same-store revenue | $3.76B | flat |

### Brand premium

PSA street rates trade ~**15% above industry average** ([Move.org consumer pricing analysis](https://www.move.org/public-storage-review/)). Management has not directly quantified this in the 10-K but acknowledges algorithmic pricing and brand strength.

**Model default: 12% midpoint** (10–15% range). Flag as third-party-derived, not PSA-disclosed.

### ECRI (Existing Customer Rate Increase)

PSA does NOT disclose specific ECRI rate in 10-K filings.
- Q1 2026 transcript: management confirmed "existing customers continue paying increases without material elasticity shifts"
- Q4 2025 transcript: ECRI described as "data-driven approach considering existing customer health, price sensitivity, vacancy, replacement cost, local market dynamics"

**Industry benchmark** ([Inside Self Storage / SkyView Advisors Q4 2025](https://skyviewadvisors.com/q4-self-storage-industry-report/)): 5–8% baseline; "well-managed facilities can impose ECRI in excess of 10% per year"

**Model default: 8% annual on tenants in place 12+ months.** Flag as "PSA-specific not disclosed; industry benchmark."

### Move-in rates (FY2026 guide)
"Negative mid-single digits for the year" per PSA Q4 2025 call.

---

## PSA ACQUISITION ACTIVITY — FY2025

**Source:** [PSA Q4 2025 8-K](https://www.stocktitan.net/sec-filings/PSA/8-k-public-storage-reports-material-event-0b52a1addde1.html), [Q1 2026 transcript](https://www.fool.com/earnings/call-transcripts/2026/04/28/public-storage-psa-q1-2026-earnings-transcript/)

Organic acquisitions (excluding NSA — see separate section).

| Metric | FY2025 |
|---|---|
| Properties acquired | **87** (+ 3 under contract = 90 reported) |
| Net rentable SF | **6.1M** |
| Total purchase price | **$942.2M** |
| **Average $/SF** | **$154.46** |
| **Stabilized cap rate** | **"high 6% range" — ~6.75–6.9%** |
| Q4 2025 alone | $131M acquired |
| Underwriting funnel | $7B underwritten / $1B transacted = **14% conversion** |
| Off-market share | **75%** (Q1 2026 mgmt commentary) |

**Q1 2026 quote:** "stabilized product is trading in the 5s, getting into the 6s as we put them on our platform"

→ **PSA buys at ~5.5–6.0% market cap, then drives to ~6.0–6.75% stabilized through PSNext platform improvements.** This is the cap-rate-uplift moat: NOI grows post-integration faster than market.

---

## PSA DEVELOPMENT YIELD-ON-COST

| Metric | FY2025 / Current Pipeline |
|---|---|
| Total pipeline | **$618M** ($416M unfunded as of Q1 2026) |
| Pipeline NRSF | 3.5M SF |
| **Stabilized YOC target** | **~8%** (per management) |
| FY2025 deliveries | $409M cost / 12 facilities + expansions / 2.1M NRSF |
| Implied delivery $/SF | **~$195/SF** (development cost, fully-loaded) |
| Funding timeline | Remaining $416M to deliver in 18–24 months |

**Lease-up assumptions** (industry standard, not PSA-disclosed):
- One-story: 36–48 months to 90% occupancy
- Multi-story: 48–60 months to 90% occupancy
- Stabilized occupancy target: ~90% (PSA same-store benchmark = 92%)

---

## NSA ACQUISITION CONTEXT

**Announced:** Mar 16, 2026 — pending close Q3 2026

**Source:** [PSA-NSA Acquisition Press Release](https://investors.publicstorage.com/news-events/press-releases/news-details/2026/Public-Storage-to-Acquire-National-Storage-Affiliates-Creating-Significant-Value-for-All-Stakeholders/default.aspx), [Modern Storage Media Q&A](https://www.modernstoragemedia.com/news/public-storage-announces-10.5b-acquisition-of-nsa-qa-included)

| Metric | NSA Deal |
|---|---|
| Total deal value | **$10.5B** (all-stock; $77B pro forma EV) |
| Properties | **1,000+** / **~69M NRSF** / **~550K units** / **37 states + PR** |
| PSA wholly owned post-close | 488 properties |
| Joint venture (80% NSA OP / 20% PSA) | 313 properties / $3.3B / 19.6M NRSF |
| **Going-in cap rate (loaded)** | **mid-5%** (~5.5%) |
| **Per-SF acquisition price** | **~$180/SF** |
| Post-synergy cap rate | **low-to-mid 6%** (~6.0–6.5%) |
| Annual run-rate synergies (3–4 yr) | $110–130M |
| NOI margin gap | NSA ~880 bps below PSA → expected to close ~500 bps post-synergy |
| Market overlap | 80% existing PSA markets; 20% net-new |
| Geographic shift | Increases PSA's secondary/tertiary Sun Belt exposure |
| Closing | Expected Q3 2026 |

**Implications:**
- NSA brings **secondary/tertiary market product** PSA historically underweighted
- Post-NSA: PSA willing to pay **mid-5% cap stabilized** in core overlap markets vs. high-6% stabilized in pure organic — synergy uplift = 50–100 bps yield expansion via PSNext
- Expanded footprint to **~4,000+ wholly-owned + 313 JV facilities** post-close

---

## STORAGE REIT TRIANGULATION — FY2025

### EXR (Extra Space Storage)

**Source:** [EXR Q4/FY2025 Press Release](https://www.prnewswire.com/news-releases/extra-space-storage-inc-reports-2025-fourth-quarter-and-year-end-results-302693036.html)

| Line item | % of Revenue |
|---|---|
| Payroll & benefits | 6.2% |
| Marketing | 2.4% |
| Office expense | 3.0% |
| Property operating expense | 2.6% |
| Repairs & maintenance | 2.1% |
| Property taxes | 11.3% |
| Insurance | 1.2% |
| **Total same-store opex** | **28.8%** |
| Same-store NOI margin | **71.2%** |
| Same-store properties | 1,804 |
| Year-end occupancy | 92.6% |

### CUBE (CubeSmart)

**Source:** [CUBE Q4/FY2025 Press Release](https://www.globenewswire.com/news-release/2026/02/26/3246149/0/en/CubeSmart-Reports-Fourth-Quarter-and-Annual-2025-Results.html)

| Line item | % of Revenue |
|---|---|
| Property taxes | 11.3% |
| Personnel expense | 6.0% |
| Advertising | 2.5% |
| Repair & maintenance | 1.4% |
| Utilities | 2.4% |
| Property insurance | 1.2% |
| **Total opex** | **28.9%** |
| Same-store NOI margin | **71.1%** |
| Realized rent/occupied SF | $22.73 |

### Cross-REIT Summary

| Operator | Total Opex | NOI Margin | Notes |
|---|---|---|---|
| **PSA** | **24.86%** | **75.14%** | Best in class — central staffing + brand efficiency |
| **EXR** | 28.8% | 71.2% | Higher payroll % (6.2% vs PSA 3.4%) |
| **CUBE** | 28.9% | 71.1% | Higher payroll + utilities |
| **Industry avg** | ~32–35% | ~65–68% | Independent operators (SSA / Inland 2025) |

**PSA platform efficiency delta vs independents = ~700–1,000 bps of NOI margin.** This is the structural moat the Asset Analyzer's PS Lens captures: when valuing a target as if PSA owns it, NOI uplift produces ~50–100 bps of additional cap rate compression vs generic underwriting.

---

## INDUSTRY GUIDANCE — Q1 2026

### Cushman & Wakefield H1 2025 Self-Storage Market Report

**Source:** [Cushman & Wakefield U.S. Self Storage Trends](https://www.cushmanwakefield.com/en/united-states/insights/us-self-storage-market-trends-and-sector-outlook)

- Average cap rate: **5.8%** (rolling 6-quarter average)
- 56% of investors expect flat cap rates over next 12 months
- Transaction volume H1 2025: **$2.85B** (~flat vs H1 2023)
- Northeast PSF: $193; Pacific: $154

### Newmark 2025 Self-Storage Almanac

**Source:** [Newmark Cap Rate Page](https://www.nmrk.com/storage-nmrk/uploads/documents/2025-Self-Storage-Almanac-Capitalization-Rate.pdf)

| Asset Class / Tier | Cap Rate Range |
|---|---|
| Class A Primary | **5.0–5.5%** |
| Class A Secondary / Class B Primary | **5.5–6.0%** |
| Class B/C Tertiary | **5.8–6.8%** |

### Green Street (Q4 2025 / Q1 2026)
- Cap rates "stabilized around 5.8%"
- Class A primary: 5.0–5.5%
- Class B (secondary): 5.5–6.5%
- Asset values: peaked $174 PSF Q1 2023 → $159 PSF Q2 2025 (-9%)

---

## MSA TIER CAP RATE GUIDANCE — Model Defaults

**Triangulation across PSA / Newmark / Cushman / Green Street:**

| MSA Tier | Class A Stabilized (Market) | PSA-Specific (Stabilized after PSNext) |
|---|---|---|
| **Top-30 MSA** | 5.0–5.5% | **6.0%** (PSA pays slightly above market in core; drives NOI uplift via brand) |
| **Secondary MSA** (rank 31–125) | 5.5–6.0% | **6.25%** |
| **Tertiary MSA** (rank 126+) | 5.8–6.8% | **7.00%** (PSA historically underweighted; NSA closes this gap) |
| **NSA portfolio (loaded)** | n/a | **5.50% mid-5%** |
| **PSA organic FY2025 average** | n/a | **6.75%** ("high 6% range") |

**MSA tier deltas:** Primary → Secondary = ~50–75 bps; Secondary → Tertiary = ~75–100 bps.
**PSA delta vs market on overlap acquisitions:** +50–100 bps yield uplift via PSNext.

---

## PSA HARD GATES — Acquisition Criteria

PSA does **NOT publicly disclose hardcoded** minimum NRSF, acreage, or vintage criteria in the 10-K. Below are **observed** from FY2025 acquisition activity ($154/SF average; 87 facilities / 6.1M NRSF = average **70,115 NRSF/facility**):

| Criterion | Implied / Observed |
|---|---|
| Minimum NRSF | **~50,000 SF observed floor** (not formally disclosed) |
| Average acquisition NRSF | **~70,000 SF** |
| Acreage | 2.5–6 acres one-story / 1.5–3 acres multi-story |
| Geographic footprint | 40 states (FY2025); expands to 37+ via NSA |
| Asset class | Climate-controlled preferred; urban infill emphasis |
| Submarket density | "Markets with critical density produce ~600 bps margin advantage" — PSA targets MSAs with 5+ facilities |

**Bridge lending program:** $142.5M outstanding at 7.9% avg rate (Q1 2026); $43.9M unfunded. Functions as PSA's "look at it before we buy it" pipeline-feeder.

**Tenant Reinsurance:** ~1.5M certificates issued; $7.2B aggregate coverage. Material ancillary income — model as ~3–5% revenue uplift on PSA-owned book.

---

## OPEN QUESTIONS / GAPS — Flagged in Model

| Gap | Resolution |
|---|---|
| **PSA-specific ECRI rate** | Not disclosed. Use **8% annual on rolled tenants** (industry midpoint, Inside Self Storage). Mark as "industry benchmark" |
| **PSA brand premium quantified** | Move.org = 15%; PSA does not confirm. Use **12% midpoint** in model; flag as third-party-derived |
| **PSA acquisition cap by individual deal** | Only "high 6% range" disclosed in aggregate. Model: **6.75% stabilized post-PSNext** for organic |
| **PSA hard size criteria** | Not disclosed. Use **50K NRSF minimum / 70K average / 2.5–6 ac one-story** |
| **PSA development cost $/SF** | $409M / 2.1M NRSF FY2025 = **~$195/SF blended** |
| **PSA lease-up months** | Not disclosed. Industry: 36–48 mo one-story; 48–60 mo multi-story |
| **PSA submarket density threshold** | "600 bps margin advantage in dense submarkets" but no defined cluster size |
| **PSA G&A $/SF central** | Indirect cost of operations $115.5M / 175.3M NRSF = **$0.66/SF central G&A** for same-store pool |
| **PSA stabilized occupancy target** | Implied 90%+ (same-store benchmark 92%) |
| **Hunt County / Greenville TX submarket** | No specific intel. Default **Secondary 6.25%** PSA-stabilized cap |

---

## PSA Constants Cheat Sheet (for `buyerLensProfiles.js`)

```javascript
PSA_FY2025_CONSTANTS = {
  // SAME-STORE OPEX — % of revenue (FY2025 actual from earnings press release)
  opex: {
    propertyTaxPctRev: 0.1005,        // 10.05% (national portfolio average)
    onsitePayrollPctRev: 0.0343,       // 3.43% — central staffing model
    rmPctRev: 0.0207,                  // 2.07%
    utilitiesPctRev: 0.0132,           // 1.32%
    marketingPctRev: 0.0221,           // 2.21% — brand-efficient
    otherDirectPctRev: 0.0271,         // 2.71%
    indirectGAPctRev: 0.0307,          // 3.07% — central G&A
    totalOpexPctRev: 0.2486,           // 24.86%
    noiMargin: 0.7514,                 // 75.14% — best in class
    mgmtFeePctRev: 0.0,                // self-managed
  },

  // REVENUE DYNAMICS
  brandPremiumPct: 0.12,               // 12% midpoint of 10-15% range
  ecriPctAnnual: 0.08,                 // industry midpoint; PSA-undisclosed
  realizedRentPerOccSF: 22.54,         // FY2025 actual
  avgOccupancy: 0.920,                 // FY2025
  yeOccupancy: 0.910,

  // ACQUISITION ECONOMICS — PSA stabilized cap (after PSNext uplift)
  capByMSATier: {
    top30: 0.0600,                     // primary MSAs
    secondary: 0.0625,                 // rank 31-125
    tertiary: 0.0700,                  // rank 126+ (post-NSA expanded)
    nsaPortfolioLoaded: 0.0550,        // mid-5% loaded going-in
    psaBlendedFY2025: 0.0675,          // disclosed "high 6% range"
  },
  acqPricePSFAvg: 154,                 // FY2025 organic blended
  underwritingFunnelConversion: 0.14,  // $1B / $7B
  offMarketShare: 0.75,                // Q1 2026

  // DEVELOPMENT
  devYOCTarget: 0.08,                  // stabilized
  devCostPSFAvg: 195,                  // FY2025 deliveries blended
  devLeaseupMonthsOneStory: 42,
  devLeaseupMonthsMultiStory: 54,
  devStabilizedOccTarget: 0.90,

  // HARD GATES (observed; not disclosed)
  minNRSF: 50000,
  avgNRSF: 70000,
  minOneStoryAc: 2.5,
  maxOneStoryAc: 6,
  minMultiStoryAc: 1.5,
  maxMultiStoryAc: 3,

  // PORTFOLIO-FIT
  portfolioFitTriggerMiles: 5,
  portfolioFitCapBps: 25,              // -25 bps if within 5 mi

  // ANCILLARY
  bridgeLendingRate: 0.079,
  tenantReinsuranceRevenueBoost: 0.04,
};
```

---

## Source Quality Hierarchy

1. **PSA FY2025 10-K (Annual Report on EDGAR)** — gospel
2. **PSA Q4/FY2025 Earnings Press Release (BusinessWire, 2/12/2026)** — gospel for opex line items
3. **PSA Q4 2025 / Q1 2026 Earnings Transcripts (Motley Fool)** — high-confidence for management quotes
4. **NSA Acquisition Press Release (PSA IR, 3/16/2026)** — direct
5. **EXR FY2025 Press Release (PR Newswire)** — direct
6. **CUBE FY2025 Press Release (GlobeNewswire)** — direct
7. **Newmark 2025 Self-Storage Almanac** — sector-standard
8. **Cushman & Wakefield H1 2025 U.S. Self-Storage Trends** — sector-standard
9. **Inside Self Storage / SkyView Advisors Q4 2025 reports** — used for ECRI benchmarks
10. **Modern Storage Media Q&A** — used for NSA acquisition specifics

---

## Primary Source Links

- [PSA FY2025 Annual Report (SEC EDGAR)](https://www.sec.gov/Archives/edgar/data/1393311/000119312526129096/d49333dars.pdf)
- [PSA Q4/FY2025 Earnings Press Release (BusinessWire)](https://www.businesswire.com/news/home/20260212066179/en/Public-Storage-Reports-Fourth-Quarter-and-Full-Year-2025-Results)
- [PSA Q4 2025 Earnings Transcript (Motley Fool)](https://www.fool.com/earnings/call-transcripts/2026/04/21/public-storage-psa-q4-2025-earnings-transcript/)
- [PSA Q1 2026 Earnings Transcript (Motley Fool)](https://www.fool.com/earnings/call-transcripts/2026/04/28/public-storage-psa-q1-2026-earnings-transcript/)
- [PSA-NSA Acquisition Announcement](https://investors.publicstorage.com/news-events/press-releases/news-details/2026/Public-Storage-to-Acquire-National-Storage-Affiliates-Creating-Significant-Value-for-All-Stakeholders/default.aspx)
- [Modern Storage Media: PSA-NSA Q&A](https://www.modernstoragemedia.com/news/public-storage-announces-10.5b-acquisition-of-nsa-qa-included)
- [EXR FY2025 Press Release](https://www.prnewswire.com/news-releases/extra-space-storage-inc-reports-2025-fourth-quarter-and-year-end-results-302693036.html)
- [CUBE FY2025 Press Release](https://www.globenewswire.com/news-release/2026/02/26/3246149/0/en/CubeSmart-Reports-Fourth-Quarter-and-Annual-2025-Results.html)
- [SmartStop Q4 2025 (Modern Storage Media)](https://www.modernstoragemedia.com/news/smartstop-self-storage-reit-reports-q4-2025-results)
- [Newmark 2025 Almanac Cap Rate](https://www.nmrk.com/storage-nmrk/uploads/documents/2025-Self-Storage-Almanac-Capitalization-Rate.pdf)
- [Cushman & Wakefield U.S. Self Storage Trends](https://www.cushmanwakefield.com/en/united-states/insights/us-self-storage-market-trends-and-sector-outlook)
- [Capright Self-Storage REIT Update April 2025](https://www.capright.com/wp-content/uploads/2025/04/Self-Storage-REIT-Update-April-2025.pdf)
- [Inside Self Storage: ECRI Evolution](https://www.insideselfstorage.com/revenue-management/the-ecri-evolution-modern-self-storage-rate-management-and-its-impact-on-asset-revenue-value-and-underwriting)
- [SkyView Advisors Q4 2025 Industry Report](https://skyviewadvisors.com/q4-self-storage-industry-report/)
- [Move.org Public Storage Brand Review](https://www.move.org/public-storage-review/)
- [PSA Investor Relations SEC Filings](https://investors.publicstorage.com/financial-reports/sec-filings/default.aspx)
