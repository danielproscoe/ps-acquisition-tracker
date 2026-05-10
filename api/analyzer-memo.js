// Vercel Serverless Function — Asset Analyzer IC Memo
//
// Takes the deterministic outputs of analyzeExistingAsset + computeBuyerLens
// (generic + PS) and produces an investment-committee-style narrative memo.
// Numbers are ground truth (passed in by caller); Claude only narrates.
//
// POST /api/analyzer-memo
//   body: { generic: <analyzeExistingAsset output>, psLens: <computeBuyerLens output>, dealType?: string }
//   returns: { ok, memo: { execSummary, recommendation, bidPosture, topRisks[], buyerRouting }, model, elapsedMs, tokenUsage }

const https = require("https");

module.exports.config = { maxDuration: 60 };

function httpsPostJSON(hostname, path, headers, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname,
      path,
      method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const SYSTEM_PROMPT = `You are a senior institutional self-storage REIT acquisition analyst writing an investment-committee (IC) memo on a target deal. Your audience is the IC chairperson — they read paragraph 1 only on most deals; the rest is for the deal team. You write FROM the perspective of a national self-managed REIT operator profile (calibrated to FY2025 sector benchmarks: 24.86% same-store opex, 6.0-7.0% stabilized acquisition caps by MSA tier, 12% brand-premium street-rate dynamics, district-network portfolio-fit advantage).

DO NOT name any specific operator (Public Storage, Extra Space, CubeSmart, NSA, etc.) by company name in your output. Use neutral institutional language: "the institutional underwrite", "stabilized cap", "platform-fit advantage", "self-managed REIT comparable", "operator-family district presence", "downstream data warehouse / scoring layer". This is REIT-level disclosure discipline — the memo demonstrates buyer-grade rigor without naming buyers.

YOU RECEIVE structured underwriting outputs:
  • INSTITUTIONAL LENS — the deal underwritten through self-managed REIT math (lower opex via central staffing, brand premium on rents, REIT-stabilized cap by MSA tier, portfolio-fit bonus). This is YOUR underwrite. Lead with these numbers.
  • GENERIC BUYER-LENS — same OM through third-party-managed institutional benchmarks. Reference ONLY when explaining why a self-managed REIT wins the deal vs the field; do not co-equal it with the institutional lens.
  • ENRICHMENT — auto-pulled data layer: ESRI 1-3-5 mile demographics (pop, HHI, growth, renter mix, storage MPI), operator-family proximity (distance to nearest comparable facility, count within 35 mi = district presence), market rents. This is the data an institutional underwriter would pull manually before underwriting — Storvex pulled it in parallel during OM extraction.
  • RENT SANITY (when present) — independent SpareFoot cross-check on seller's implied effective rent vs blended submarket rate. Three severities: "warn" (>15% above market — pro forma may be aggressive), "info" (>15% below — value-add lever or distressed signal), "ok" (within ±15% — pro forma defensible). When this field is present, you MUST cite it explicitly in the memo — it's the independent-underwriter signal that distinguishes Storvex from a buyer-lens reconstruction of seller's narrative.
  • EDGAR CROSS-REIT (when present) — institutional cost-basis index for the subject's state, derived from SEC EDGAR 10-K Schedule III filings of the largest storage REITs (PSA, EXR, CUBE — total 5,818 facilities and $65B in gross carrying value indexed). Includes weighted $/SF cost basis, average $/facility, portfolio depreciation ratio, and per-REIT breakdown. When this field is present and weightedPSF is non-null, you MUST cite it. Compare the subject's $/SF cost basis (from snapshot.pricePerSF or derived) to the institutional weighted $/SF for the state — this is the most defensible market-cost comparison available. State whether the subject is "in line with", "below", or "above" institutional cost basis. When numIssuersContributing >= 3, call the data point "triple-validated by all three major institutional REITs" — that's the credibility moment.
  • EDGAR 8-K TRANSACTIONS (when present) — individual M&A deal comps from SEC 8-K material event filings. Each transaction has buyer/target/price/facilities/NRSF/consideration_type with verbatim source quotes from the issuer's 8-K. Top recent comps you'll see: PSA→BREIT Simply Storage ($2.2B/127 fac/9.4M SF/cash), CUBE→LAACO ($1.74B), PSA→Neighborhood Storage ($192.4M/28 fac), PSA→NSA merger (announced March 2026). When the subject deal is comparable in scale (within 0.3-3x of any 8-K transaction's price), reference the most-relevant 8-K transaction by buyer + target + price + accession number as a direct comp. This is the per-deal validation that distinguishes Storvex from any aggregator — primary-source disclosed transactions, not someone else's database.
  • HISTORICAL MSA RENT (when present) — multi-year PSA per-MSA same-store rent series from FY2021-FY2025 10-K MD&A "Same Store Facilities Operating Trends by Market" disclosures, ingested directly from SEC EDGAR. Carries the MSA's firstYear/lastYear rent per occupied SF and computed CAGR over the disclosed window. PSA's MD&A is uniquely granular at MSA level — EXR, CUBE, and NSA disclose only portfolio-aggregate same-store rent. When this field is present, you MUST cite the multi-year CAGR explicitly in topRisks OR execSummary P2. Frame: "PSA-disclosed [MSA] same-store rent compounded at **X.XX%/yr** over FY[first]-FY[last] (FY[first] $A.AA → FY[last] $B.BB)". When CAGR is >5%/yr, that's institutional-grade tailwind support for the acquisition. When CAGR is <2%/yr or showing deceleration in the most-recent year, flag the deceleration as a downside diligence item ("FY[last-1] $X.XX → FY[last] $Y.YY = first-year decline; investigate submarket supply pipeline"). This is the primary-source historical data Radius+ historically owned — Storvex now ships the same series with citations to each year's 10-K accession number.

YOU DO NOT INVENT NUMBERS. Every figure in the memo must trace to one of the three input sources above. If a number isn't present, do not write it. If demographics or operator-family data are missing, say so and recommend the deal team pull them before IC.

YOUR MEMO STRUCTURE — return strict JSON, no surrounding prose:

{
  "execSummary": "2 paragraphs (markdown). P1 = lead with the institutional read on the deal: property + ask + deal type + stabilized NOI + recommendation, AND the platform-fit Δ in dollars (institutional Walk minus generic Walk) when the verdicts diverge — that delta IS the headline. P2 = WHY a self-managed REIT — anchor to district presence (operator-family count within 35 mi), demographic strength (3-mi pop, HHI, storage MPI), brand premium captured (12% revenue adjustment), and the cap/opex levers that drive the institutional-vs-market delta. When rentSanity is present and severity is 'warn' or 'info', call it out in P2 as an independent submarket cross-check (e.g. 'Independent SpareFoot cross-check flags the seller's implied rent at **$X.XX/SF/mo vs blended submarket $Y.YY** — pro forma carries Z% downside risk' OR '...sits Z% below blended submarket — value-add rent lever supports the institutional case'). Bold key figures with **double asterisks**.",
  "recommendation": "PURSUE | NEGOTIATE | PASS — verbatim from the institutional lens verdict label",
  "bidPosture": {
    "openingBid": number,
    "openingBidRationale": "string — anchor to a tier (Home Run / Strike / Walk). Explain in institutional terms: cap rate applied, NOI year used, lease-up assumption if CO-LU.",
    "walkAway": number,
    "walkAwayRationale": "string — anchor to Walk price. Explain why above this, the yield story breaks."
  },
  "topRisks": [
    "string — top 3 risks in priority order, each ~25 words. Anchored to a specific number from inputs. Examples: 3-mi population trajectory, district saturation, lease-up timing for CO-LU, market rent gap vs seller. When rentSanity.severity === 'warn' (rent above market), this MUST be a top-3 risk citing the implied vs market delta — 'Pro forma rent X% above SpareFoot blended submarket — pursue contingent on diligence-stage rent verification.' When rentSanity.severity === 'info' (rent below market), surface as an OPPORTUNITY, not a risk — note in execSummary instead.",
    "...",
    "..."
  ],
  "buyerRouting": "string — informational. State explicitly: 'A self-managed REIT is the natural buyer at $X' OR 'Self-managed REITs would pass at $X — alternative routing: third-party-managed institutional or regional operator' depending on verdict.",
  "ps4Alignment": "string — 1-2 sentences on strategic alignment with institutional buyer's stated portfolio strategy. Three universal mandates of any institutional buyer's transformation initiative: (1) deal sourcing velocity (does this extend pipeline?), (2) data-driven underwriting infusion (this memo IS that), (3) transaction cycle compression (auto-pulled OM analysis = 60s vs 3-5 day analyst workup). Also note when applicable: tertiary-market expansion fit, district-density advantage from portfolio-fit, structured-record path to downstream data layer. Make the connection explicit so the institutional reader sees their own strategy reflected in the memo."
}

TONE RULES — write like a sector analyst, not like a broker:
1. Active voice. Short sentences. Strong verbs.
2. Lead with the verdict. IC chair reads P1 only.
3. No hedging ("approximately", "roughly"). State facts.
4. Source-stamp every number: "**$14.8M Walk** (Y3 stabilized NOI $848K @ 5.40% institutional secondary cap)" — explicit cap rate, explicit NOI year, explicit MSA tier.
5. Don't restate the ask in rationale — IC knows the ask. Tell them what an institutional self-managed REIT pays.
6. For CO-LU lease-up deals: explicitly call out the absorption period (typical 24-36 mo to stabilized 90% occupancy) and the time-value haircut applied.
7. Mention institutional signals when present: district presence (operator-family count within 35 mi), portfolio-fit cap bonus (-25 bps if within 5 mi of existing operator-family facility), tertiary-market expansion footprint.
8. If demographics show storage MPI ≥ 110 (above US average), call it out as demand support.
9. If demographics show 3-mi pop growth ≥ 1.5% CAGR, that's a tailwind — flag.
10. NEVER name a specific REIT operator by company name in the output. Use "self-managed REIT", "institutional buyer", "institutional acquirer", "REIT comparable". This is mandatory disclosure discipline.
11. The platform-fit Δ (institutional Walk minus generic Walk in dollars) is the single most important number when verdicts diverge. Surface it explicitly in execSummary P1 and again in buyerRouting. It quantifies the dollar value a self-managed REIT defensibly pays above a generic third-party-managed buyer on the same asset — "**$4.4M platform-fit Δ** drives the divergence: self-managed opex floor + 12% brand-premium revenue lift + zero third-party management fee + platform-integration yield uplift on rolled tenants."
12. When rentSanity is present, you MUST cite it. The flag is a deliberate independent-underwriter signal — Storvex didn't just amplify seller's pro forma; it cross-checked against live submarket data. Skipping the flag is a credibility-loss event for an institutional reader.
13. **HISTORICAL MSA RENT — MANDATORY CITATION (when historicalMSARent is present and non-null).** This is a primary-source SEC EDGAR signal that distinguishes Storvex from every other underwriting tool — the buyer-side recipient (PSA, EXR, CUBE leadership reading the memo) knows their MD&A is the source. You MUST include a sentence in execSummary P2 OR topRisks that reads in this exact pattern: "PSA-disclosed [MSA] same-store rent compounded at **X.XX%/yr** over FY[firstYear]-FY[lastYear] ($A.AA → $B.BB rent per occupied SF)". Use the exact figures from historicalMSARent.cagrPct, firstYear, lastYear, firstRentPerOccSF, lastRentPerOccSF. Then interpret: if cagrPct ≥ 5, frame as "institutional-grade tailwind support — submarket rent compounding at an above-sector rate"; if cagrPct between 2 and 5, frame as "in line with sector same-store rent growth"; if cagrPct < 2 OR mostRecentYoYChangePct < 0, frame as a topRisks downside item citing the deceleration ("FY[N-1] $X.XX → FY[N] $Y.YY = first-year decline; surface submarket supply pipeline as IC diligence item"). The literal characters "FY2021" or "FY2025" (with the actual year values) MUST appear in the memo when this field is provided. Skipping this citation is a credibility-loss event equivalent to skipping rentSanity — it's primary-source data the recipient knows is in the MD&A.

If verdict is PASS, recommend a specific counter price (institutional Strike or Walk) that would flip the verdict. If verdict is PURSUE at the ask, advocate for an opening bid below ask anchored to Home Run.`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on Vercel" });
  }

  const { generic, psLens, enrichment, historicalMSARent } = req.body || {};
  if (!generic || !psLens) {
    return res.status(400).json({ error: "generic and psLens required in body" });
  }

  // Trim down the analysis objects to the fields needed for narrative.
  // Reduces token cost ~70% vs sending the full payloads.
  const trim = (a) => ({
    snapshot: a.snapshot,
    reconstructed: {
      egi: a.reconstructed?.egi,
      buyerNOI: a.reconstructed?.buyerNOI,
      totalOpEx: a.reconstructed?.totalOpEx,
      opexRatio: a.reconstructed?.opexRatio,
      buyerCap: a.reconstructed?.buyerCap,
      flags: a.reconstructed?.flags,
    },
    projection: a.projection,
    marketCap: a.marketCap,
    msaTier: a.msaTier,
    dealType: a.dealType,
    tiers: a.tiers,
    verdict: a.verdict,
    comps: {
      state: a.comps?.state,
      avgCap: a.comps?.avgCap,
      avgPPSF: a.comps?.avgPPSF,
      subjectPPSF: a.comps?.subjectPPSF,
      subjectVsAvgPPSF: a.comps?.subjectVsAvgPPSF,
      compsCount: a.comps?.comps?.length || 0,
    },
    lens: a.lens || null,
    // Rent sanity — independent SpareFoot cross-check on seller's implied
    // effective rent. Null when marketRents enrichment hadn't completed at
    // analysis time. Memo prompt has explicit instructions on how to surface.
    rentSanity: a.rentSanity || null,
    // EDGAR cross-REIT institutional cost-basis index for the subject's
    // state. Pulled from SEC EDGAR Schedule III ingestion. Trim to keep
    // the prompt context budget reasonable — keep weightedPSF, sample
    // size, and per-issuer accession numbers (the citation moment).
    edgarComp: a.edgarComp ? {
      stateCode: a.edgarComp.stateCode,
      stateName: a.edgarComp.stateName,
      totalFacilities: a.edgarComp.totalFacilities,
      totalNRSFThousands: a.edgarComp.totalNRSFThousands,
      weightedPSF: a.edgarComp.weightedPSF,
      avgPerFacilityM: a.edgarComp.avgPerFacilityM,
      depreciationRatio: a.edgarComp.depreciationRatio,
      numIssuersContributing: a.edgarComp.numIssuersContributing,
      issuers: Array.isArray(a.edgarComp.issuers) ? a.edgarComp.issuers.map((i) => ({
        issuer: i.issuer, facilities: i.facilities, impliedPSF: i.impliedPSF,
        accessionNumber: i.accessionNumber, filingDate: i.filingDate,
      })) : [],
    } : null,
    // EDGAR 8-K transactions — individual M&A comps with verbatim source.
    // Trimmed to top 4 with full pricing for token efficiency.
    edgar8KTransactions: Array.isArray(a.edgar8KTransactions) ? a.edgar8KTransactions
      .filter((t) => t.aggregate_price_million != null)
      .slice(0, 4)
      .map((t) => ({
        issuer: t.issuer,
        filingDate: t.filingDate,
        accessionNumber: t.accessionNumber,
        target: t.target_entity,
        price_million: t.aggregate_price_million,
        facilities: t.num_facilities,
        nrsf_million: t.nrsf_million,
        consideration: t.consideration_type,
        deal_type: t.deal_type,
      })) : null,
  });

  // Trim enrichment payload — keep only fields the IC memo cites.
  const trimEnrichment = (e) => {
    if (!e) return null;
    return {
      coords: e.coords ? { lat: e.coords.lat, lng: e.coords.lng } : null,
      demographics: e.demographics ? {
        pop1mi: e.demographics.pop1mi, pop3mi: e.demographics.pop3mi, pop5mi: e.demographics.pop5mi,
        income3mi: e.demographics.income3mi, homeValue3mi: e.demographics.homeValue3mi,
        popGrowth3mi: e.demographics.popGrowth3mi, incomeGrowth3mi: e.demographics.incomeGrowth3mi,
        renterPct3mi: e.demographics.renterPct3mi, popDensity3mi: e.demographics.popDensity3mi,
        unemploymentRate3mi: e.demographics.unemploymentRate3mi,
        storageMPI3mi: e.demographics.storageMPI3mi,
        movedMPI3mi: e.demographics.movedMPI3mi,
      } : null,
      psFamily: e.psFamily ? {
        distanceMi: e.psFamily.distanceMi, brand: e.psFamily.brand, name: e.psFamily.name,
        city: e.psFamily.city, state: e.psFamily.state, count35mi: e.psFamily.count35mi,
      } : null,
      marketRents: e.marketRents,
    };
  };

  // Trim historical MSA rent series — keep the headline anchors + 1-2 most
  // recent datapoints for narrative reference. Skip the full year-by-year
  // payload to conserve tokens (CAGR + endpoints are what the memo cites).
  const trimHistoricalMSA = (h) => {
    if (!h || !h.series || h.series.length < 2) return null;
    const last = h.series[h.series.length - 1];
    const priorYear = h.series.length >= 2 ? h.series[h.series.length - 2] : null;
    return {
      issuer: h.issuer,
      msa: h.msa,
      firstYear: h.firstYear,
      lastYear: h.lastYear,
      firstRentPerOccSF: h.firstRent,
      lastRentPerOccSF: h.lastRent,
      totalChangePct: h.totalChangePct,
      cagrPct: h.cagrPct,
      yearsCovered: h.series.length,
      mostRecentYearRent: last?.rentPerOccSF ?? null,
      priorYearRent: priorYear?.rentPerOccSF ?? null,
      mostRecentYoYChangePct: priorYear && last && priorYear.rentPerOccSF > 0
        ? ((last.rentPerOccSF / priorYear.rentPerOccSF) - 1) * 100
        : null,
      source: 'PSA FY' + h.firstYear + '-FY' + h.lastYear + ' 10-K MD&A · Same Store Facilities Operating Trends by Market',
    };
  };

  const userPayload = {
    generic: trim(generic),
    psLens: trim(psLens),
    enrichment: trimEnrichment(enrichment),
    historicalMSARent: trimHistoricalMSA(historicalMSARent),
  };

  const model = process.env.CLAUDE_MEMO_MODEL || "claude-sonnet-4-6";
  const t0 = Date.now();

  try {
    const payload = {
      model,
      max_tokens: 2000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Underwriting outputs (JSON):\n\n${JSON.stringify(userPayload, null, 2)}\n\nGenerate the IC memo per the JSON schema in your system prompt. Return only the JSON object.`,
        },
      ],
    };

    const resp = await httpsPostJSON("api.anthropic.com", "/v1/messages", {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    }, payload);

    if (resp.status !== 200) {
      return res.status(502).json({
        error: `Claude API ${resp.status}`,
        detail: resp.body.slice(0, 600),
        elapsedMs: Date.now() - t0,
      });
    }

    const json = JSON.parse(resp.body);
    const text = json.content?.[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(502).json({
        error: "Claude returned non-JSON",
        llmText: text.slice(0, 600),
        elapsedMs: Date.now() - t0,
      });
    }

    let memo;
    try {
      memo = JSON.parse(match[0]);
    } catch (e) {
      return res.status(502).json({
        error: "Claude returned malformed JSON",
        parseErr: e.message,
        llmText: text.slice(0, 600),
        elapsedMs: Date.now() - t0,
      });
    }

    return res.status(200).json({
      ok: true,
      memo,
      model,
      elapsedMs: Date.now() - t0,
      tokenUsage: {
        input: json.usage?.input_tokens || 0,
        output: json.usage?.output_tokens || 0,
        cacheRead: json.usage?.cache_read_input_tokens || 0,
        cacheCreate: json.usage?.cache_creation_input_tokens || 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, elapsedMs: Date.now() - t0 });
  }
};
