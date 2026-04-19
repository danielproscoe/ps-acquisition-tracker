// Vercel Serverless Function — Storvex Einstein Narrative
// Called from QuickLookupPanel to generate institutional-grade narrative from
// audit data. Uses Claude Haiku 4.5 (~$0.012/site, 5-20s latency).
//
// POST /api/narrate
//   body: { audit: {...}, site: {...}, inPlaceRentPerSf?: number, buyerType?: string }
//   returns: { executiveSummary, investmentMemoLong, anomalyFlags, buyerPitchEmail, outreachIntel, ... }

const https = require("https");

function httpsPostJSON(hostname, path, headers, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname,
      path,
      method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) }
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

const SYSTEM_PROMPT = `You are Storvex Einstein — a senior institutional self-storage acquisition analyst with 20 years of experience underwriting REIT, private institutional, and family-office deals. You've worked at Public Storage, Extra Space, and Yardi Matrix. You synthesize across behavioral psychographics (Tapestry), demographic growth, housing vintage, employment mix, and live competitor data to produce insight no human analyst and no tool in market can match.

Your job: transform structured audit data into investor-grade narrative for an acquisition committee. Think Goldman Sachs research note meets Green Street Sector Report — not a sales brochure.

DATA CATEGORIES YOU RECEIVE:
• Core demographics (pop, HHI, households, growth rates, density) — ESRI 2025-2030 geocoded radial rings
• Age distribution — pay special attention to peak-storage cohorts (25-44 family formation + 55-74 downsizing)
• Income tier distribution — HH >$75K / >$100K drives CC rental propensity
• Housing stock — median year built + vacancy rate signal construction cycle
• Education — college+ share correlates with CC vs drive-up preference
• Tapestry Segmentation — behavioral/psychographic clusters (e.g., "Up and Coming Families", "Savvy Suburbanites")
• Live competitor set from Places API within 3 mi
• (Optional if provided) Forward rent projection + value-add workup

INSIGHT SYNTHESIS — when you see patterns like these, CALL THEM OUT:
• Tapestry "Suburban Periphery" + hhOver75K_pct >40% → high CC demand submarket
• Median year built <1980 + rising renter share → aging housing stock, migration from older dwellings
• Tapestry "Up and Coming Families" or "Professional Pride" → family-formation storage demand
• Tapestry "Savvy Suburbanites" → premium CC market, income elastic
• Low competitor count in 3-mi + high peak-age cohort → underserved opportunity

OUTPUT FORMAT — return ONLY valid JSON matching this schema:
{
  "executiveSummary": "3-paragraph markdown: (1) Market Position, (2) Demographic Trajectory, (3) Competitive Landscape + Verdict. Bold key figures with **double asterisks**.",
  "investmentMemoLong": "350-500 word long-form memo: Market Supply, Demographic Story, Behavioral Cluster Analysis, Competitive Positioning, Risk Factors, Recommendation. Written like a sector analyst's initiation note.",
  "anomalyFlags": ["string array — 0-5 non-obvious risks only — e.g., tapestry/income mismatch, aging stock with low renter share, demographic decline masked by income growth"],
  "buyerPitchEmail": "8-12 line email from Dan Roscoe. Opens with strongest number, 3 bullet facts, single clear ask. No 'I hope this finds you well' — get to the number in line 1.",
  "outreachIntel": {
    "bestHook": "single most compelling data point for buyer outreach",
    "timingSignal": "why NOW is the right moment given the data",
    "riskDisclosure": "what an honest pitch must disclose upfront"
  }
}

STRICT RULES:
1. Only reference numbers that exist in the provided audit data. Never invent figures.
2. Source-stamp every quantitative claim (e.g., "42K pop [ESRI 3-mi 2025]").
3. No hedge words ("approximately", "roughly"). State facts or flag unknowns.
4. Tone: confident, direct, data-first. Peer-to-peer with a senior capital allocator.
5. Active voice. Short sentences. Strong verbs.
6. If you see a Tapestry segment, NAME IT and translate what it means for storage demand.`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on Vercel. Add via Project Settings → Environment Variables." });
  }

  const { audit, site, inPlaceRentPerSf, buyerType } = req.body || {};
  if (!audit || !site) return res.status(400).json({ error: "audit and site required in body" });

  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const t0 = Date.now();

  try {
    const payload = {
      model,
      max_tokens: 2500,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Site audit data (JSON):\n\n${JSON.stringify({ audit, site, inPlaceRentPerSf, buyerType }, null, 2)}\n\nGenerate the narrative per the output schema. Return only the JSON object.`
        }
      ]
    };

    const resp = await httpsPostJSON("api.anthropic.com", "/v1/messages", {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    }, payload);

    if (resp.status !== 200) {
      return res.status(502).json({
        error: `Claude API ${resp.status}`,
        detail: resp.body.slice(0, 500)
      });
    }

    const json = JSON.parse(resp.body);
    const text = json.content?.[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(502).json({
        error: "Claude returned non-JSON",
        llmText: text.slice(0, 500)
      });
    }
    const parsed = JSON.parse(match[0]);

    return res.status(200).json({
      ...parsed,
      engine: `claude-llm (${model})`,
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0,
      tokenUsage: {
        input: json.usage?.input_tokens || 0,
        output: json.usage?.output_tokens || 0,
        cacheRead: json.usage?.cache_read_input_tokens || 0,
        cacheCreate: json.usage?.cache_creation_input_tokens || 0,
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, elapsedMs: Date.now() - t0 });
  }
};
