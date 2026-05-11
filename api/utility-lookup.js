// Vercel Serverless Function — Storvex Utility Oracle
// Automated water/sewer/electric provider lookup via Claude Haiku 4.5 web_search
// + web_fetch. Per CLAUDE.md §6c-2, water is the #2 deal-killer after zoning —
// commercial storage fire suppression requires municipal water (wells can't hit
// 1,500 GPM @ 20 PSI). Radius doesn't do this at all.
//
// Flow: Claude autonomously issues targeted searches for water/sewer/electric
// providers covering the site's city/county, identifies service boundary
// status, extracts tap fees if published, and returns structured JSON.
//
// POST /api/utility-lookup
//   body: { city, state, county?, address?, zip? }
//   returns: { ok, found, jurisdiction, waterProvider, waterHookupStatus,
//              waterContact: { name, phone, email, dept },
//              sewerProvider, sewerAvailable, electricProvider, threePhase,
//              gasProvider, fireFlowNotes, tapFees, citations[], confidence,
//              notes, verifiedAt, elapsedMs }

const https = require("https");

// Worst case: 4 searches + 4 fetches + 3K-token answer ≈ 35-45s
module.exports.config = { maxDuration: 60 };

function httpsPostJSON(hostname, path, headers, payload, timeoutMs = 55000) {
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
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`POST timeout ${timeoutMs}ms`)));
    req.write(body);
    req.end();
  });
}

const UTILITY_SYSTEM_PROMPT = `You are a utility infrastructure researcher for a commercial real estate firm (Storvex). You have access to web_search and web_fetch tools. Your job: identify the water, sewer, and electric providers for a commercial self-storage site, determine hookup status, and return structured JSON.

WHY THIS MATTERS FOR STORAGE:
- Self-storage is one of the LOWEST-demand commercial uses (restrooms only, ~50 GPD wastewater, minimal electricity unless climate-controlled)
- BUT: commercial fire code requires municipal water for sprinkler systems — 1,500+ GPM at 20 PSI. Wells CANNOT provide this. Water access = hard requirement.
- Septic is fine for sewer (storage wastewater is minimal)
- Climate-controlled storage needs 3-phase power for HVAC
- The KEY question: is the site inside the water provider's service boundary (by-right hookup) or outside (by-request, requires extension)?

RESEARCH STRATEGY:
1. Start with the city + state + "water provider" or "water utility":
   - "{city} {state} water department" / "{city} water utility service area"
   - In Texas especially, check for MUDs (Municipal Utility Districts), SUDs (Special Utility Districts), WSCs (Water Supply Corporations) at TCEQ CCN maps
2. For unincorporated areas: check county water districts, rural co-ops, SUDs
3. Verify service boundary: look for CCN maps (Texas), service area maps, or published service boundary shapefiles
4. Sewer: same jurisdictional research. If no municipal sewer, note septic is viable for storage
5. Electric: identify IOU (investor-owned utility) or co-op serving the area. Confirm 3-phase availability — this is standard for commercial zones
6. Fire flow: if published, note nearest hydrant and main size. For V1 this is often unknowable without calling utility engineering
7. Tap fees / impact fees: check for published fee schedules (city utility rates page, county development fees)

**USE web_fetch AGGRESSIVELY**: Water utility websites often have service boundary maps, rate schedules, and new connection procedures on HTML pages. Prefer HTML over large PDFs (input limit is 100 PDF pages). For Texas specifically, TCEQ's CCN viewer is gold for service boundary verification.

OUTPUT FORMAT — return ONLY valid JSON:
{
  "found": true | false,
  "waterProvider": "Name of water utility (e.g., 'City of Temple', 'Bell County WCID #3', 'Georgetown WSC')",
  "waterHookupStatus": "by-right" | "by-request" | "no-provider" | "unknown",
  "waterContact": {
    "name": "Person or department (e.g., 'Engineering Department')",
    "phone": "(XXX) XXX-XXXX",
    "email": "dept@city.gov",
    "website": "https://..."
  },
  "sewerProvider": "Name of sewer utility, or 'N/A (septic viable)' for rural sites",
  "sewerAvailable": true | false,
  "electricProvider": "Name of electric utility (e.g., 'Oncor', 'CenterPoint', 'Rural co-op name')",
  "threePhase": true | false | "likely-available" | "verify-with-utility",
  "gasProvider": "Name of natural gas utility, or 'N/A' if not available",
  "fireFlowNotes": "Any published fire flow / hydrant / main size info",
  "tapFees": "Summary of tap/impact fees if published (e.g., 'Water $4,500 · Sewer $3,200 · Impact TBD')",
  "serviceBoundaryUrl": "Link to the utility's service area map (if found)",
  "citations": ["list of URLs consulted"],
  "confidence": "high" | "medium" | "low",
  "notes": "1-2 sentence plain-English interpretation — is water hookup clean (inside service area) or will it require extension? Any red flags (moratoriums, capacity issues, annexation required)?"
}

If you CANNOT identify the water provider after 2-3 searches, return:
{
  "found": false,
  "waterHookupStatus": "unknown",
  "confidence": "low",
  "citations": ["URLs tried"],
  "notes": "Recommend Dan contact the jurisdiction's planning/development services office for water utility routing. Often private well + septic for truly rural sites — flag as a hard constraint for commercial storage (fire flow)."
}

STRICT RULES:
1. Never invent provider names. Only report what you actually verify.
2. Cite the specific source URL for each piece of info.
3. If the site is in an ETJ or unincorporated area, be explicit about it — the city may or may not serve water there depending on annexation agreements.
4. For Texas: if you find a TCEQ CCN map or ruling, cite the CCN number.
5. "by-right" requires affirmative evidence site is inside service boundary. Default to "by-request" or "unknown" if boundaries aren't verifiable.`;

async function runUtilityResearch(apiKey, city, state, county, address, zip) {
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const countyClean = (county || "").toString().replace(/\s*County$/i, "").trim();
  const jurisdictionLabel = `${city}, ${state}${countyClean ? ` (${countyClean} County)` : ""}${zip ? ` ${zip}` : ""}`;

  const userPrompt = [
    `Research water, sewer, and electric utilities for a commercial self-storage site in ${jurisdictionLabel}.`,
    address ? `Subject site address: ${address}` : "",
    "",
    "Focus on: water provider + hookup status (by-right vs by-request), who to call, sewer, electric with 3-phase, fire flow notes, tap fees if published.",
    "Use web_search to find utility providers; use web_fetch on utility service-area maps or rate schedules when found. Return structured JSON per the output schema.",
  ].filter(Boolean).join("\n");

  function buildPayload(includeFetch) {
    const tools = [
      { type: "web_search_20250305", name: "web_search", max_uses: 4 },
    ];
    if (includeFetch) {
      tools.push({ type: "web_fetch_20250910", name: "web_fetch", max_uses: 4 });
    }
    return {
      model,
      max_tokens: 3000,
      system: [{ type: "text", text: UTILITY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools,
      messages: [{ role: "user", content: userPrompt }],
    };
  }

  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "web-search-2025-03-05,web-fetch-2025-09-10",
    "content-type": "application/json",
  };

  let resp = await httpsPostJSON("api.anthropic.com", "/v1/messages", headers, buildPayload(true));
  if (resp.status === 400 && /pdf|100 PDF pages|page limit/i.test(resp.body)) {
    resp = await httpsPostJSON("api.anthropic.com", "/v1/messages", headers, buildPayload(false));
  }

  if (resp.status !== 200) {
    throw new Error(`Claude API ${resp.status}: ${resp.body.slice(0, 500)}`);
  }

  const json = JSON.parse(resp.body);
  const textBlocks = (json.content || []).filter(b => b.type === "text").map(b => b.text);
  const fullText = textBlocks.join("\n");
  const match = fullText.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Claude returned non-JSON: ${fullText.slice(0, 300)}`);
  }
  const parsed = JSON.parse(match[0]);

  const serverToolUses = (json.content || []).filter(b => b.type === "server_tool_use" && b.name === "web_search");
  const searchQueries = serverToolUses.map(s => s.input?.query).filter(Boolean);

  return {
    ...parsed,
    _tokenUsage: {
      input: json.usage?.input_tokens || 0,
      output: json.usage?.output_tokens || 0,
      cacheRead: json.usage?.cache_read_input_tokens || 0,
      serverToolUse: json.usage?.server_tool_use || null,
    },
    _searchQueries: searchQueries,
    _jurisdictionLabel: jurisdictionLabel,
  };
}

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

  const { city, state, county, address, zip } = req.body || {};
  if (!city || !state) return res.status(400).json({ error: "city and state required" });

  const t0 = Date.now();

  try {
    const result = await runUtilityResearch(apiKey, city, state, county, address, zip);
    return res.status(200).json({
      ok: true,
      jurisdiction: result._jurisdictionLabel,
      subjectAddress: address || null,
      ...result,
      source: "claude-web-search",
      verifiedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0,
    });
  } catch (err) {
    // Map error to a clean user-facing message — never leak raw API bodies,
    // org IDs, doc URLs, or JSON wrappers into the rendered "INTERPRETATION:"
    // line. Raw err.message is preserved in `error` for diagnostics only.
    const userNote = userFacingErrorNote(err.message, "utility");
    return res.status(200).json({
      ok: false,
      found: false,
      jurisdiction: `${city}, ${state}`,
      subjectAddress: address || null,
      notes: userNote,
      searchHints: [
        `https://www.google.com/search?q=${encodeURIComponent(city + " " + state + " water utility service area storage")}`,
        `https://www14.tceq.texas.gov/iwud/ccn` /* TX only — fallback still useful to flag the tool */,
      ],
      confidence: "low",
      source: "error",
      verifiedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0,
      error: err.message, // diagnostic field — frontend should NOT render
    });
  }
};

/**
 * Map a raw error message into a clean user-facing note. Filters out:
 *   - Anthropic API rate-limit error JSON (org IDs, token counts, doc URLs)
 *   - HTTP body snippets (URLs, status codes, JSON braces)
 *   - Stack traces
 * Returns a short, professional sentence keyed to error category.
 */
function userFacingErrorNote(rawMsg, oracleKind) {
  const msg = String(rawMsg || "").toLowerCase();
  const kind = oracleKind === "utility" ? "utility lookup" :
               oracleKind === "access" ? "access lookup" :
               oracleKind === "zoning" ? "zoning lookup" :
               "automated lookup";
  // Rate limit
  if (/429|rate[- ]limit|exceed.*tokens.*per.*minute|too many requests/i.test(msg)) {
    return `Automated ${kind} temporarily over capacity. Manual sources linked below.`;
  }
  // Server errors
  if (/5\d{2}|server error|overloaded|service unavailable|internal error/i.test(msg)) {
    return `Automated ${kind} service is temporarily unavailable. Manual sources linked below.`;
  }
  // Auth / configuration
  if (/401|403|unauthorized|forbidden|invalid.*api.*key|not.*configured/i.test(msg)) {
    return `Automated ${kind} unavailable due to a service configuration issue. Manual sources linked below.`;
  }
  // Timeout
  if (/timeout|timed out|aborted|etimedout/i.test(msg)) {
    return `Automated ${kind} timed out. Manual sources linked below.`;
  }
  // Malformed response
  if (/non-json|malformed|parseerror|unexpected token/i.test(msg)) {
    return `Automated ${kind} returned an unexpected response. Manual sources linked below.`;
  }
  // Default — generic without leaking the raw message
  return `Automated ${kind} unavailable. Manual sources linked below.`;
}

module.exports.userFacingErrorNote = userFacingErrorNote;
