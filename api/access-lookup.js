// Vercel Serverless Function — Storvex Access Oracle
// Automated VPD (vehicles per day), road frontage, signalization, and
// ingress/egress intel via Claude Haiku 4.5 web_search + web_fetch.
// Per CLAUDE.md §6b-2, access is the silent deal-killer for storage —
// customers tow trailers and drive box trucks; a site with bad visibility
// or no curb cut is worth less than the same site on a signalized arterial.
//
// Flow: Claude autonomously queries state DOT traffic count viewers, reads
// published VPD data, checks aerial imagery implications, and returns
// structured JSON. TxDOT / FDOT / NYSDOT / ODOT etc. all publish interactive
// traffic count maps — Claude knows these and can cite them.
//
// POST /api/access-lookup
//   body: { city, state, county?, address?, coordinates? (lat, lon), zip? }
//   returns: { ok, found, frontageRoad, frontageRoadType, vpd, vpdYear,
//              vpdSource, medianType, nearestSignal, curbCutsLikely,
//              decelLaneRisk, drivewayGrade, visibility, landlockedRisk,
//              citations[], confidence, notes, verifiedAt, elapsedMs }

const https = require("https");

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

const ACCESS_SYSTEM_PROMPT = `You are a site access / ingress-egress researcher for a commercial real estate firm (Storvex). You have access to web_search and web_fetch tools. Your job: identify the road frontage details for a commercial self-storage site and return structured JSON.

WHY THIS MATTERS FOR STORAGE:
- Self-storage customers tow trailers, drive box trucks, haul furniture in SUVs. They need easy in/out.
- Sites on major arterials with signalized intersections lease up faster and command rent premiums.
- Sites with no left-turn access (raised median, no signal within 1/4 mile) or steep driveways fail.
- Storage operators (PSA, EXR, CUBE, SmartStop) all value drive-by signage visibility — it's literal marketing.
- DOT-required decel lanes add $50K–$150K to development cost and can kill marginal deals.

KEY DATA POINTS TO EXTRACT:
1. **Frontage road name** (e.g., "US-31", "FM 2410", "Hwy 92", "Main Street")
2. **Road type / functional class**: interstate / state highway / US highway / arterial / collector / local
3. **VPD (vehicles per day)** — the headline access metric. Check state DOT traffic count maps:
   - Texas: TxDOT Statewide Traffic Analysis and Reporting System (STARS) or CRIS
   - Florida: FDOT Traffic Information Online (FTIO), FDOT GIS
   - Indiana: INDOT Traffic Count Database (TCDS)
   - Ohio: ODOT Traffic Count Map
   - New York: NYSDOT Traffic Count
   - Generic: "{state} DOT traffic counts {road name}"
4. **Median type**: raised / TWLTL (two-way left turn lane) / painted / none
5. **Nearest signalized intersection** — distance in miles/feet. Storage customers need signal-controlled lefts.
6. **Curb cuts**: existing on aerial, or new ones needed (permitting burden)
7. **Decel lane risk**: triggered on 45+ MPH roads — costs $50K-$150K
8. **Driveway grade**: steep grades fail (trailers can't navigate). Note if visible on aerial.
9. **Visibility**: is the site visible from the road? Storage relies on drive-by signage.
10. **Landlocked risk**: interior parcels with easement-only access are a major flag.

RESEARCH STRATEGY:
1. Start with the subject address + state DOT traffic counts:
   "{state} DOT traffic count {nearest road} {city}"
2. If the site is on a state/US highway, FTIO/STARS/similar will have exact VPD data by segment
3. web_fetch the state DOT's traffic count viewer page when a direct URL is found
4. For local/city roads, VPD may only be available via MPO (metropolitan planning organization) or county engineering — note if unknowable from web search alone
5. Use aerial imagery via web_search (Google Maps results, satellite views described in results) to infer median type, curb cuts, signalization nearby

OUTPUT FORMAT — return ONLY valid JSON:
{
  "found": true | false,
  "frontageRoad": "e.g., 'US-31', 'FM 2410', 'Main Street'",
  "frontageRoadType": "interstate" | "state-highway" | "US-highway" | "arterial" | "collector" | "local" | "unknown",
  "vpd": numeric_value_or_null,
  "vpdYear": "2023" | "2024" | null,
  "vpdSource": "TxDOT STARS" | "FDOT FTIO" | "INDOT TCDS" | "Local MPO" | "Not published" | etc,
  "vpdSourceUrl": "direct URL where VPD was pulled",
  "medianType": "raised" | "TWLTL" | "painted" | "none" | "unknown",
  "nearestSignal": "0.1 mi west at Main & 5th" or null,
  "curbCutsLikely": "existing" | "new required" | "unknown",
  "decelLaneRisk": "low" | "medium" | "high",
  "drivewayGrade": "flat" | "moderate" | "steep" | "unknown",
  "visibility": "excellent" | "good" | "moderate" | "poor",
  "landlockedRisk": true | false,
  "citations": ["list of URLs consulted"],
  "confidence": "high" | "medium" | "low",
  "notes": "1-2 sentence plain-English interpretation — is this a strong storage access site, or are there cost/permit red flags?"
}

If VPD is not discoverable via web search, set vpd: null + vpdSource: "not published online — call state DOT or MPO" and still return the other fields.

STRICT RULES:
1. Never invent VPD numbers. Only report what you actually find on a DOT site or published traffic count.
2. Cite the exact source URL where VPD was pulled.
3. For road types, use the state DOT's classification when available (some states use functional class numbers 1–7; translate to the category above).
4. "Visibility" is a judgment call based on road type + median type + setback typical for the area.
5. If the subject address is on a frontage/service road next to an interstate, note that distinctly from the mainlane VPD (mainlane = visibility, frontage road = actual customer access).`;

async function runAccessResearch(apiKey, city, state, county, address, coordinates, zip) {
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const countyClean = (county || "").toString().replace(/\s*County$/i, "").trim();
  const jurisdictionLabel = `${city}, ${state}${countyClean ? ` (${countyClean} County)` : ""}${zip ? ` ${zip}` : ""}`;
  const coordStr = coordinates && coordinates.lat && coordinates.lon
    ? `(${coordinates.lat.toFixed(5)}, ${coordinates.lon.toFixed(5)})` : "";

  const userPrompt = [
    `Research road access / ingress-egress for a commercial self-storage site at:`,
    `Address: ${address || "(see jurisdiction)"}`,
    `Jurisdiction: ${jurisdictionLabel}`,
    coordStr && `Coordinates: ${coordStr}`,
    "",
    "Focus on: frontage road name + type, VPD from state DOT, median type, signalization, curb cuts, decel lane risk, visibility. Pull VPD from state DOT traffic count sites when findable.",
    "Use web_search + web_fetch. Return structured JSON per the output schema.",
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
      system: [{ type: "text", text: ACCESS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
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

  const { city, state, county, address, coordinates, zip } = req.body || {};
  if (!city || !state) return res.status(400).json({ error: "city and state required" });

  const t0 = Date.now();

  try {
    const result = await runAccessResearch(apiKey, city, state, county, address, coordinates, zip);
    return res.status(200).json({
      ok: true,
      jurisdiction: result._jurisdictionLabel,
      subjectAddress: address || null,
      coordinates: coordinates || null,
      ...result,
      source: "claude-web-search",
      verifiedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0,
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      found: false,
      jurisdiction: `${city}, ${state}`,
      subjectAddress: address || null,
      notes: `Automated access lookup failed: ${err.message}. Check state DOT traffic counts manually.`,
      searchHints: [
        `https://www.google.com/search?q=${encodeURIComponent(city + " " + state + " DOT traffic count " + (address || ""))}`,
      ],
      confidence: "low",
      source: "error",
      verifiedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0,
      error: err.message,
    });
  }
};
