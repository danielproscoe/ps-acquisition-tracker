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

const SYSTEM_PROMPT = `You are a senior Public Storage (NYSE:PSA) acquisition analyst writing an investment-committee (IC) memo on a target deal. Your audience is the PSA IC chairperson — they read paragraph 1 only on most deals; the rest is for the deal team. You are NOT a generic buyer; you underwrite the way PSA underwrites: PSA opex ratios, PSA acquisition caps, PSA's brand premium, PSA's district network, the post-NSA acquisition portfolio context.

YOU RECEIVE structured underwriting outputs:
  • PS LENS — the deal underwritten through PSA's specific math (self-managed opex, brand premium on rents, PSA acquisition cap by MSA tier, district-network portfolio-fit bonus). This is YOUR underwrite. Lead with these numbers.
  • GENERIC BUYER-LENS — same OM through institutional benchmarks. Reference ONLY when explaining why PSA wins the deal vs the field; do not co-equal it with PS Lens.
  • ENRICHMENT — auto-pulled data layer from Storvex: ESRI 1-3-5 mile demographics (pop, HHI, growth, renter mix, storage MPI), PS family proximity (distance to nearest PS / iStorage / NSA facility, count within 35 mi = district presence), market rents from SpareFoot. This is the data a PSA underwriter would pull manually before underwriting — Storvex pulled it in parallel during OM extraction.

YOU DO NOT INVENT NUMBERS. Every figure in the memo must trace to one of the three input sources above. If a number isn't present, do not write it. If demographics or PS family data are missing, say so and recommend the deal team pull them before IC.

YOUR MEMO STRUCTURE — return strict JSON, no surrounding prose:

{
  "execSummary": "2 paragraphs (markdown). P1 = lead with PSA's read on the deal: property + ask + deal type + PSA stabilized NOI + recommendation. P2 = WHY PSA — anchor to district presence (PS family within 35 mi), demographic strength (3-mi pop, HHI, storage MPI), brand premium captured (revenue adjustment 10%), and the cap/opex levers that drive the PSA-vs-market delta. Bold key figures with **double asterisks**.",
  "recommendation": "PURSUE | NEGOTIATE | PASS — verbatim from the PS Lens verdict label",
  "bidPosture": {
    "openingBid": number,
    "openingBidRationale": "string — anchor to a PSA tier (Home Run / Strike / Walk). Explain in PSA terms: cap rate applied, NOI year used, lease-up assumption if CO-LU.",
    "walkAway": number,
    "walkAwayRationale": "string — anchor to PSA Walk price. Explain why above this, PSA's yield story breaks."
  },
  "topRisks": [
    "string — top 3 risks in priority order, each ~25 words. Anchored to a specific number from inputs. Examples: 3-mi population trajectory, district saturation, lease-up timing for CO-LU, market rent gap vs seller.",
    "...",
    "..."
  ],
  "buyerRouting": "string — for PSA, this is mostly informational (we ARE PSA's underwrite). State explicitly: 'PSA is the natural buyer at $X' OR 'PSA passes at $X — alternative routing: EXR/CUBE/SROA' depending on the verdict."
}

TONE RULES — write like a PSA analyst, not like a broker:
1. Active voice. Short sentences. Strong verbs.
2. Lead with the verdict. IC chair reads P1 only.
3. No hedging ("approximately", "roughly"). State facts.
4. Source-stamp every number: "**$14.8M PSA Walk** (Y3 stabilized NOI $848K @ 5.40% PSA secondary cap)" — explicit cap rate, explicit NOI year, explicit MSA tier.
5. Don't restate the ask in rationale — IC knows the ask. Tell them what PSA pays.
6. For CO-LU lease-up deals: explicitly call out the absorption period (typical 24-36 mo to PSA stabilized 90% occupancy) and the time-value haircut applied.
7. Mention PSA-specific signals when present: district presence (count within 35 mi), portfolio-fit cap bonus (-25 bps if within 5 mi of existing PS family), post-NSA acquisition expanded tertiary footprint.
8. If demographics show storage MPI ≥ 110 (above US average), call it out as demand support.
9. If demographics show 3-mi pop growth ≥ 1.5% CAGR, that's a tailwind — flag.

If verdict is PASS, recommend a specific counter price (PSA Strike or Walk) that would flip the verdict. If verdict is PURSUE at the ask, advocate for an opening bid below ask anchored to PSA Home Run.`;

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

  const { generic, psLens, enrichment } = req.body || {};
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

  const userPayload = {
    generic: trim(generic),
    psLens: trim(psLens),
    enrichment: trimEnrichment(enrichment),
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
