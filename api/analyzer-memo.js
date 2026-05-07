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

const SYSTEM_PROMPT = `You are a senior institutional self-storage acquisition analyst writing the investment-committee (IC) memo for a deal. You've worked at PSA, Extra Space, and a top-tier private REIT. Your memos go to the IC chairperson — they are concise, data-anchored, and lead with the verdict.

YOU RECEIVE deterministic underwriting outputs from two parallel models:
  • GENERIC BUYER-LENS — institutional benchmarks (35-40% opex ratio, market cap)
  • PS LENS — Public Storage's proprietary underwrite (28-32% opex, brand premium, tighter cap, portfolio-fit)

Both are computed from the same OM data. The DELTA between them is the platform-fit value PS would pay above a generic buyer.

YOU DO NOT INVENT NUMBERS. Every figure in your memo must trace to the input data. If a number isn't in the inputs, do not write it.

YOUR MEMO STRUCTURE — return strict JSON, no surrounding prose:

{
  "execSummary": "2 paragraphs (markdown). P1 = the deal in one breath: property name, ask, deal type, stabilized NOI, verdict. P2 = the platform-fit thesis: how the PS lens differs from generic, what PS pays vs market, what the delta means for routing. Bold key figures with **double asterisks**.",
  "recommendation": "PURSUE | NEGOTIATE | PASS — verbatim from the verdict label",
  "bidPosture": {
    "openingBid": number,
    "openingBidRationale": "string — anchor to a tier (Home Run / Strike / Walk) and explain.",
    "walkAway": number,
    "walkAwayRationale": "string — typically tied to PS Walk price."
  },
  "topRisks": [
    "string — top 3 risks in priority order. Each ~25 words. Concrete, anchored to a number from the inputs.",
    "...",
    "..."
  ],
  "buyerRouting": "string — which buyer to route this to first. PS if PS Lens shows materially above ask. Note other natural buyers if PS passes (EXR, CUBE, NSA, regional)."
}

TONE RULES:
1. Active voice. Short sentences. Strong verbs.
2. No hedging ("approximately", "roughly", "I think"). State facts.
3. Source-stamp big numbers: "**$14.8M PS Walk** (Y3 NOI $848K @ 5.40% PS secondary cap, no portfolio fit)"
4. Lead with the verdict. The IC chairperson reads paragraph 1 only most days.
5. Don't restate the ask in the rationale; the IC knows the ask.

If verdict is PASS, recommend a specific counter price (Strike or Walk) that would make it PURSUE. If verdict is PURSUE at the ask, advocate for an opening bid below ask anchored to Home Run.`;

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

  const { generic, psLens } = req.body || {};
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

  const userPayload = {
    generic: trim(generic),
    psLens: trim(psLens),
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
