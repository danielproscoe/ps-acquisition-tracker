# DJR DealFlow Oracle™ — Institutional Architecture & Patent Framework

**Version:** v1.0 · **Date:** 2026-04-20 · **Status:** Pre-patent draft · **Classification:** Proprietary

---

## 1. Product Identity

**Name:** DJR DealFlow Oracle™ (working title) · component of **Storvex** platform
**Category:** AI-native institutional real-estate routing intelligence
**Tagline:** *"Address in. Ranked buyer shortlist, calibrated underwriting, and pre-loaded pitch drafts out. In ten seconds."*

**Positioning:**
- **NOT** a CRM (Rolodex-style contact database)
- **NOT** a comp database (Radius+ / CoStar / Yardi)
- **NOT** a generalist AI chat interface (ChatGPT / Claude.ai)
- **IS** a proprietary **multi-dimensional site-to-buyer matching engine** fed by continuously-compounded institutional intelligence

---

## 2. Patent Framework

### 2.1 Inventive Claims (drafting shell — attorney refines)

**Primary Claim: Method for Deterministic Routing of Commercial Real-Estate Acquisition Opportunities to Institutional Buyers**

An automated system comprising:

1. A **structured operator profile database** wherein each entry comprises machine-readable underwriting fields including but not limited to: deal type enumeration, geographic boundary set, size floor/ceiling, price range, product mix specification, deployment pressure tier, hard-exclusion array, unique moat descriptor, and capital source specification;

2. A **site classification engine** that ingests an unstructured real-estate opportunity (address, OM, listing, or free-text description) and extracts a structured site specification comprising deal type code, geographic coordinate, MSA classification, size vector, and price point;

3. A **deterministic routing algorithm** that performs set-intersection operations between the site specification and each operator profile, eliminating operators whose hard-exclusion array contains any matched attribute, and ranking surviving operators by composite score incorporating deployment pressure tier and product-fit weighting;

4. A **pitch-context enrichment module** that retrieves per-operator narrative hooks, executive pedigree edges, and recent capital events, generating operator-specific pitch drafts pre-populated with site economics and institutional framing;

5. A **compounding learning feedback loop** wherein each pitch response (YES/NO/COUNTER/SILENT) updates the originating operator profile, refining future routing decisions; and

6. A **primary-source provenance layer** wherein each factual claim within the operator profile database maintains a verifiable URL reference plus verification timestamp, enabling audit of routing decisions.

### 2.2 Dependent Claims (scope expansion)

- Integration with SiteScore scoring engine (covered by Dan's prior patent App #64/009,393)
- Graph representation of executive pedigree edges as first-class routing signal
- Capital deployment urgency tier inferred from fund vintage + transaction velocity
- 1031-exchange capital source matching (DST program detection for NexPoint-style routing)
- Territory-aware contact resolver with rule-based CC chain composition
- Automatic pitch-log-to-operator-profile writeback for compound learning

### 2.3 Novelty & Non-Obviousness

**Prior art survey:**
- CBRE / JLL / Marcus & Millichap Rolodexes — static, not routing engines
- Radius+ / Yardi Matrix / CoStar — comp databases, no buyer routing
- Generic LLM chat interfaces — no verified operator data, no deterministic filtering
- Buyer-matching platforms (CrediQuest, etc. in commercial mortgage) — different asset class

**Novel combination:**
1. Multi-dimensional UW-filterable operator profiles derived from primary-source institutional research
2. Deterministic routing (not statistical matching) with full auditability
3. Compounding learning loop from tracked pitch responses
4. Integration with address-input 3-second institutional report (Quick Lookup fusion)
5. Operator-calibrated financial underwriting applied per routing result

### 2.4 Prior Art Defense (for Examiner)

Document chain-of-custody for each operator profile:
- Git commit history on `memory/buyer-routing-matrix.md` (version v1 to v6)
- Transaction log on `public/operator-matrix.json` (JSON versioning)
- Primary-source URL timestamp per claim (verification audit trail)
- Pitch-response log on Firebase `/pitchLog/` (compound learning evidence)

All preserved from 2026-04-20 onward — establishes Dan's priority date.

---

## 3. Semantic Schema (Ontology)

### 3.1 Entity Types

```
Operator
  - Firmographics { ticker, type, hq, founded, parent, ownership }
  - Portfolio { facilityCount, totalSF, states, concentrations, brands, occupancy }
  - UW_Profile { dealTypes, geography, sizeFloor, sizeCeiling, priceLow, priceHigh, productMix, deploymentPressure, decisionSpeedDays, offMarketPreference, hardNos, uniqueMoats, capitalSource }
  - Economics { cap, ccRent, duRent, expRatio, stabOcc, ecriBump, hurdle, color, rentLabel }
  - Capital { activeFund(s), fundSize, vintageClose, percentDeployed, remainingRunway, deploymentPace, signals }
  - Contacts { primary, secondary, emailPattern, cc }
  - PitchHook (narrative string pre-loaded for pitch drafts)
  - ExecPedigree (edges to prior employers / industry connections)
  - Friction (hard exclusion rules with source reasoning)
  - PrimarySources (URL + timestamp pairs)
  - Sig (branded signature spec for pitch emails)

Site (input to router)
  - DealTypeCode (EX-STAB, EX-VAL, CO-LU, GU-ENT, GU-RAW, CONV-BIG, CONV-VAN, PORT)
  - Geography { lat, lng, state, msa, county, zip }
  - Size { acreage, proposedGSF, proposedNRSF, units }
  - Pricing { askingPrice, bracketLow, bracketMid, bracketHigh }
  - Physical { ccSharePct, driveUpPct, floors, frontage, roadType, vpd }
  - Metadata { listingSource, onMarket, dom, brokerContact }

Edge Types
  - OPERATED_BY (Site to Operator, for existing facilities)
  - PREVIOUSLY_AT (Executive to Operator, for pedigree)
  - PITCHED_TO (Site to Operator, with response outcome)
  - SOLD_TO (Operator A to Operator B, for disposition history)
  - JV_WITH (Operator to Capital_Partner)
  - REPRESENTED_BY (Operator to Broker, sell-side relationship)
```

### 3.2 Tier Taxonomy (scoring output)

```
TIER_1_HOT_CAPITAL       -> peak deployment pressure, pitch FIRST
TIER_2_ACTIVE            -> active buyer, selective but responsive
TIER_3_MEDIUM            -> growing but disciplined
TIER_4_SELECTIVE         -> disciplined cherry-picker OR tight box
TIER_5_HYPER_LOCAL       -> family or single-state
DEVELOPER_ONLY           -> builds for self, not acquirer
DO_NOT_ROUTE             -> non-buyer, absorbed, defunct, or unverified
JV_CAPITAL_PASS_THROUGH  -> route via operator partner, not capital
```

---

## 4. Routing Algorithm (Patent-Central)

### 4.1 Formal Specification

```
ALGORITHM: DealFlowRoute(site, matrix)

INPUT:  site (Site entity)
        matrix (Operator array: length N >= 49)

OUTPUT: rankedBuyers (Operator array with score and hook) ordered by score descending

STEP 1 - CLASSIFY
  siteSpec := extractSiteSpecification(site)

STEP 2 - FILTER
  candidates := []
  FOR EACH operator IN matrix:
    IF deal_type NOT IN operator.uw_profile.dealTypes: CONTINUE
    IF geography_state NOT IN operator.uw_profile.geography: CONTINUE
    IF size_metric < operator.uw_profile.sizeFloor: CONTINUE
    IF size_metric > operator.uw_profile.sizeCeiling: CONTINUE
    IF price_point < operator.uw_profile.priceLow: CONTINUE
    IF price_point > operator.uw_profile.priceHigh: CONTINUE
    IF ANY(matchHardNo(siteSpec, rule) FOR rule IN operator.uw_profile.hardNos): CONTINUE
    candidates.push(operator)

STEP 3 - SCORE
  FOR EACH candidate IN candidates:
    base_score := tierWeight(candidate.tier)
    pressure_bonus := pressureWeight(candidate.capital.deploymentPressure)
    fit_bonus := calculateProductFit(siteSpec, candidate.uw_profile.productMix)
    pedigree_bonus := calculatePedigreeBonus(siteSpec, candidate.execPedigree)
    recency_bonus := capitalEventRecency(candidate.capital.signals)
    candidate.score := base_score + pressure_bonus + fit_bonus + pedigree_bonus + recency_bonus

STEP 4 - ENRICH
  FOR EACH candidate IN candidates:
    candidate.pitchDraft := generatePitchHook(siteSpec, candidate.pitchHook, site.economics)
    candidate.gmailUrl := buildGmailComposeUrl(candidate.contacts, siteSpec, candidate.sig)
    candidate.riskFlags := candidate.friction + candidate.operationalFlag

STEP 5 - RANK
  candidates.sortBy(score, DESC)
  rankedBuyers := candidates.slice(0, 7)

RETURN rankedBuyers
```

### 4.2 Complexity

- **Time:** O(N) where N = matrix size (currently 49, designed to scale to 1,000+)
- **Space:** O(N) per query
- **Deterministic:** Same site input = same ranked output (auditable)

### 4.3 Contrast with Statistical Matching

Generic AI chat interfaces use **probabilistic similarity** (transformer embedding distance). Our algorithm uses **deterministic set-intersection + weighted scoring** — every routing decision is traceable to specific field matches. **This is what makes it defensible under patent examination AND auditable under SEC scrutiny.**

---

## 5. Compounding Learning Loop (Data Moat)

### 5.1 Mechanics

```
SITE IN -> ROUTER FIRES -> PITCH DRAFTS -> DAN SENDS
                                  |
                                  v
                         OPERATOR RESPONDS (YES/NO/COUNTER/SILENT)
                                  |
                                  v
                         Firebase /pitchLog/{autoId}
                                  |
                                  v
                    ENRICHMENT JOB (daily cron, patent-pending)
                    - Update operator.capital.signals
                    - Update operator.uw_profile.hardNos (if NO with reason)
                    - Update operator.pitchHook (if YES, what worked)
                    - Update operator.economics (if counter, re-calibrate)
                                  |
                                  v
                         NEXT ROUTING QUERY IS SHARPER
```

### 5.2 Quantifiable Moat Metrics

| Metric | v1 (4/20/26) | 6-mo Target | 12-mo Target |
|--------|--------------|-------------|--------------|
| Operators in matrix | 49 | 100 | 250 |
| Primary-source URLs | ~350 | 1,000+ | 2,500+ |
| Verified contact emails | ~20 | 150+ | 400+ |
| Logged pitch responses | 1 (DW 142 Amboy) | 200+ | 1,000+ |
| Operator-specific learning entries | ~60 seeds | 500+ | 2,000+ |
| Response rate compounding (vs baseline cold) | N/A | +30% | +60% |
| Address-to-shortlist latency | ~10s | ~3s | ~1s |

### 5.3 Defensibility

**Question for the patent examiner:** "Why can't a competitor replicate this?"

**Answer:**
1. Primary-source research is reproducible but takes 200+ hours per wave — 12+ months to match current state
2. Verified contacts require RocketReach subscriptions + manual outreach — pay-gated and rate-limited
3. Compound learning requires actual pitch flow through the system — a 12-month lag we don't have
4. Integration with SiteScore patent (operator-calibrated UW) is separately IP-protected
5. Multi-state broker licensing (NJ/OH/TX/FL) is regulatory moat layered on top

**Net:** Any new entrant faces >=18-month catch-up window AND must match regulatory moat AND must not infringe SiteScore patent.

---

## 6. Market-Out Strategy (No Advertising)

### 6.1 Core Thesis

*Dan's directive: "build the brand from the market out, not via advertising."*

The product becomes the advertising. Every interaction with DealFlow Oracle generates proof of quality that operators, brokers, and sellers encounter organically.

### 6.2 Viral Loop Architecture

1. Dan receives a Crexi alert / broker inbound / off-market lead
2. Types address into Quick Lookup
3. Oracle fires: 3s institutional report + ranked 7-buyer shortlist + per-operator pitch drafts
4. Dan reviews, fires best pitch in 90 seconds
5. Operator receives email — pitch references THEIR recent capital event, uses THEIR preferred framing, cites primary source
6. Operator replies fast ("most polished pitch we've seen this quarter")
7. Dan logs response in Pitch Log -> matrix sharpens for next operator
8. Operator references DJR to peers ("that broker with the institutional-grade pitches")
9. Operators start INBOUND requesting to be added to Oracle ("what's your process?")
10. Storvex becomes the de-facto deal-flow infrastructure layer for the sector

### 6.3 Market-Out Proof Points (accumulating now)

- **DW 17-min turnaround** on 142 Amboy (4/20/26) — proves operators respond FAST to institutional-quality pitches
- **Jessie Smith CubeSmart direct stated buy-box** (Jan 27, 2025) — proves operators engage when pitches are specific to their box
- **Max Burch WWG Storvex pilot** running OC/LA/DC — first operator ASKED for platform access
- **Brian Karis (PS engineering head) onboarded to Storvex** — PS acquired platform access before we advertised it

### 6.4 Public Market Narrative (S-1 thesis)

```
TAM:
- US self-storage transaction volume 2024: ~$15B
- Number of institutional storage operators: ~80-100
- Annual transactions per operator: 5-50
- Brokerage fee at 1-2% = ~$150M-$300M annual broker wallet

Storvex position:
- Only AI-native institutional routing platform with verified operator data
- Every transaction routed through the platform = data enrichment
- Cross-asset expansion: retail (PECO/Sprouts), QSR (7 Brew/Scooter's), industrial
- SaaS-style licensing to operators (SiteScore licensing track)

Moat:
- Patent (SiteScore App #64/009,393 + DealFlow Oracle pending)
- Multi-state broker licensing
- Compounding primary-source data (replication cost: $2M+, 18-mo lag)
- Network effects: more pitches -> sharper routing -> better responses -> more operators opt in
```

---

## 7. Governance & Audit Trail

### 7.1 Data Provenance

Every field in `operator-matrix.json` has or will have:
- `source` — primary URL or direct-thread reference
- `verifiedAt` — ISO timestamp of last verification
- `confidence` — HIGH / MEDIUM / LOW / UNVERIFIED
- `verifier` — human or automated system that verified

### 7.2 Refresh Discipline

Quarterly automatic refresh:
- SEC EDGAR 10-K parser (already built - `scripts/extract-reit-10k.mjs`)
- News API scrape (to be built)
- RocketReach contact verification (rate-limited)
- Fund mandate calendar (Part 15) manual review with calendar reminder

### 7.3 Change Log

All changes to `operator-matrix.json` committed to git. Version semantics:
- **Major** (v1 -> v2): schema change requiring QuickLookupPanel re-integration
- **Minor** (v1.0 -> v1.1): new operators added, schema unchanged
- **Patch** (v1.0.0 -> v1.0.1): field-level updates, flag corrections, data refresh

---

## 8. Roadmap to Public Market Readiness

### Phase 1 - COMPLETE (2026-04-20)
- [x] Matrix v6 baseline (49 operators, 17 parts, Hot Capital Ranking)
- [x] Unified `operator-matrix.json` schema
- [x] Architecture + patent framework documented
- [x] Market-out viral loop proven (DW 17-min, Brian Karis onboarded, Max Burch pilot)

### Phase 2 - Next 30 days
- [ ] Wire `operator-matrix.json` into `QuickLookupPanel.js` (merge with OPERATOR_KB/ECONOMICS/CONTACT_ROUTING)
- [ ] RocketReach-verify all TIER_1 + TIER_2 email patterns (~25 contacts)
- [ ] Ship Pitch Log -> operator-profile writeback (compound learning live)
- [ ] File provisional patent application for DealFlow Oracle methodology

### Phase 3 - Next 90 days
- [ ] Automated SEC 10-K refresh pipeline (quarterly Feb/May/Aug/Nov)
- [ ] News API scraper for capital events + executive moves
- [ ] DST/1031 exchange capital source auto-tagging (NexPoint-style)
- [ ] Expand to 100 operators with full UW profiles
- [ ] First operator inbound request for Storvex platform licensing

### Phase 4 - Next 6-12 months
- [ ] 1,000+ logged pitch responses (compounding proven statistically)
- [ ] Cross-asset expansion (retail / QSR / industrial routing)
- [ ] SaaS licensing deals with 3+ operators
- [ ] Full patent grant
- [ ] S-1 prep

### Phase 5 - 12-24 months
- [ ] IPO readiness: audited financials, revenue run rate, defensible moat narrative
- [ ] Public listing OR strategic acquisition

---

## 9. Why This Is Genuinely Futuristic

**The bet:** AI is about to commoditize generic knowledge retrieval. Every broker will have ChatGPT. Most will use it for generic pitches that operators ignore.

**The differentiator:** PROPRIETARY VERIFIED DATA fed into a DETERMINISTIC ROUTING ENGINE operated by LICENSED BROKERS under COMPOUNDING LEARNING.

Generic AI loses. Specialized AI with unique data wins. Storvex DealFlow Oracle is the latter in commercial real estate self-storage — and the architecture generalizes to any institutional asset class.

**What Claude-era AI makes possible that wasn't possible before:**
1. Primary-source research at scale (Wave agents pull verified data in minutes, not weeks)
2. Machine-readable narrative fields (pitch hooks, exec pedigrees) that humans write but AI queries
3. Deterministic filtering on semi-structured UW profiles
4. Conversation-based pitch drafting that preserves institutional tone
5. Compounding learning from unstructured pitch responses (response parsing via LLM)

**The product is what Claude-era AI looks like when applied to a specific institutional domain with proprietary data.** That's the IPO story. That's the patent story. That's the moat story.

---

*DJR Real Estate LLC · Storvex platform · 2026-04-20*
*This document is a Working Draft. Patent counsel required before public disclosure.*
