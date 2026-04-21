// Vercel Serverless Function — Storvex Zoning Oracle
// Automated permitted use table lookup via Claude Haiku 4.5 web_search tool.
// Per CLAUDE.md §6c, zoning is the #1 deal-killer. Radius doesn't do this.
//
// WHY web_search (not manual scraping):
// - Municode serves code chapters via client-side JS — raw HTML fetch gets a
//   search shell, not the ordinance text. Every other code library provider
//   (ecode360, American Legal, CodePublishing) has the same SPA problem OR
//   requires authenticated session cookies.
// - Claude's web_search tool lets the model autonomously issue search queries,
//   fetch results, and extract cited answers. Single round-trip replaces a
//   fragile scraper.
// - Cost: Anthropic charges per search. Typical zoning lookup needs 1-3
//   searches = $0.02-0.05 per call. Acceptable for Dan's dealflow weapon.
//
// POST /api/zoning-lookup
//   body: { city: "Temple", state: "TX", county?, address?, zoningDistrict? }
//   returns: { ok, found, jurisdiction, storageTerm, byRightDistricts[],
//              conditionalDistricts[], ordinanceSection, sourceUrl,
//              confidence, notes, verifiedAt, elapsedMs, citations[] }

const https = require("https");

// Explicit function config — this handler does a multi-turn tool-using
// conversation with Claude which can take 20-40s for complex jurisdictions.
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

const ZONING_SYSTEM_PROMPT = `You are a zoning code researcher for a commercial real estate firm (Storvex). You have access to a web_search tool. Your job: find the permitted use table citation for self-storage in a given US jurisdiction, and return structured JSON.

Storage goes by MANY names in municipal codes — search ALL of these terms when researching:
- "self-storage" / "self storage"
- "mini-warehouse" / "mini warehouse" / "mini-storage"
- "storage warehouse"
- "self-service storage"
- "warehouse (mini/self-service)"
- "storage facility"
- "indoor storage" / "climate-controlled storage"

RESEARCH STRATEGY:
1. Start with a specific search: "{city} {state} zoning ordinance self-storage permitted use table"
2. Prefer primary sources: Municode, ecode360, American Legal, the city's official code website, or the jurisdiction's planning department page
3. Ignore forum posts, commercial real estate blog posts, or third-party summaries unless they cite the ordinance section
4. If the first search returns a landing page, do a follow-up search for the specific chapter (e.g., "{city} zoning chapter 14 permitted uses")
5. **USE web_fetch AGGRESSIVELY**: Municode and ecode360 serve code via JavaScript, so web_search only returns landing pages. When you find a PDF URL or a direct ordinance link in the search results, IMMEDIATELY call web_fetch on that URL to pull the full document contents. PDFs especially are invaluable — they contain the complete use table rendered statically. A typical workflow:
   a. web_search returns PDF URL: https://cms.city.gov/zoning.pdf
   b. web_fetch that URL to get the full PDF text
   c. Extract the permitted use table from the fetched content
6. Read the actual permitted use table — identify:
   - The exact storage term as it appears in the table
   - Which zoning districts (C-1, C-2, GC, M-1, etc.) permit it BY-RIGHT (P / Permitted)
   - Which permit it CONDITIONALLY (C / CUP / SUP / special permit)
   - Which do NOT permit it (blank / — / X)
   - The ordinance section + table reference number

OUTPUT FORMAT — after completing research, return ONLY valid JSON:
{
  "found": true | false,
  "storageTerm": "exact term as it appears in the ordinance",
  "byRightDistricts": ["C-2", "C-3", "M-1"],
  "conditionalDistricts": ["C-1"],
  "rezoneRequired": [],
  "ordinanceSection": "Section or Table reference",
  "tableName": "name of the permitted use table",
  "overlayNotes": "any overlay district requirements affecting storage",
  "supStandards": "any supplemental standards for storage (access hours, climate control, RV/boat rules)",
  "confidence": "high" | "medium" | "low",
  "sourceUrl": "primary URL where the use table was found",
  "citations": ["list of all URLs you consulted"],
  "notes": "1-2 sentence plain-English interpretation — is this a clean by-right site or will it need SUP/rezone?"
}

If you cannot find the permitted use table after 2-3 searches, return:
{
  "found": false,
  "confidence": "low",
  "citations": ["list of URLs you tried"],
  "notes": "Reason why not found — e.g., 'Municipality does not publish zoning code online' or 'Use table not indexed by search engines'"
}

STRICT RULES:
1. Never invent districts or ordinance sections. Only report what you actually read.
2. Cite the specific source URL where you found the use table.
3. If confidence is "low", say why.
4. If the jurisdiction is an unincorporated county or ETJ (no zoning), return found: true with notes explaining the site has no use-table restrictions — that is the strongest possible result.`;

// Claude Messages API with web_search tool — multi-turn until model returns final text.
async function runZoningResearch(apiKey, city, state, county, address, zoningDistrict) {
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const jurisdictionLabel = `${city}, ${state}${county ? ` (${county} County)` : ""}`;

  const userPrompt = [
    `Research the zoning for self-storage in ${jurisdictionLabel}.`,
    address ? `Subject site address: ${address}` : "",
    zoningDistrict ? `Subject site's zoning district (if known): ${zoningDistrict}` : "",
    "",
    "Use web_search to find the permitted use table. Cite the exact ordinance section and source URL. Return the structured JSON per the output schema.",
  ].filter(Boolean).join("\n");

  // Start with a single message. The tool loop runs inside Claude's execution
  // when the web_search tool is configured as a server tool (Anthropic hosts
  // the search execution, so we don't loop client-side).
  const payload = {
    model,
    max_tokens: 3000,
    system: [{ type: "text", text: ZONING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 4,
      },
      {
        type: "web_fetch_20250910",
        name: "web_fetch",
        max_uses: 4,
      },
    ],
    messages: [
      { role: "user", content: userPrompt },
    ],
  };

  const resp = await httpsPostJSON("api.anthropic.com", "/v1/messages", {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    // Both beta flags: web_search (search snippets) + web_fetch (full page/PDF content)
    "anthropic-beta": "web-search-2025-03-05,web-fetch-2025-09-10",
    "content-type": "application/json",
  }, payload);

  if (resp.status !== 200) {
    throw new Error(`Claude API ${resp.status}: ${resp.body.slice(0, 500)}`);
  }

  const json = JSON.parse(resp.body);
  // Content array may contain tool_use blocks, tool_result blocks (from web_search
  // server tool), and text blocks. The final text block holds the JSON answer.
  const textBlocks = (json.content || []).filter(b => b.type === "text").map(b => b.text);
  const fullText = textBlocks.join("\n");
  const match = fullText.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Claude returned non-JSON after research: ${fullText.slice(0, 300)}`);
  }
  const parsed = JSON.parse(match[0]);

  // Harvest all search result URLs from server-tool invocations for audit trail
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

  const { city, state, county, address, zoningDistrict } = req.body || {};
  if (!city || !state) return res.status(400).json({ error: "city and state required" });

  const t0 = Date.now();
  const jurisdictionLabel = `${city}, ${state}${county ? ` (${county} County)` : ""}`;

  try {
    const result = await runZoningResearch(apiKey, city, state, county, address, zoningDistrict);
    return res.status(200).json({
      ok: true,
      jurisdiction: jurisdictionLabel,
      subjectZoning: zoningDistrict || null,
      subjectAddress: address || null,
      ...result,
      source: "claude-web-search",
      verifiedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0,
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      found: false,
      jurisdiction: jurisdictionLabel,
      subjectZoning: zoningDistrict || null,
      subjectAddress: address || null,
      notes: `Automated lookup failed: ${err.message}. Try manual sources below.`,
      searchHints: [
        `https://www.google.com/search?q=${encodeURIComponent(city + " " + state + " zoning ordinance permitted uses self-storage")}`,
        `https://library.municode.com/${(state || "").toLowerCase().replace(/\s+/g, "-")}/${(city || "").toLowerCase().replace(/\s+/g, "-")}`,
        `https://ecode360.com/${(city || "").toUpperCase().replace(/\s+/g, "")}`,
      ],
      confidence: "low",
      source: "error",
      verifiedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0,
      error: err.message,
    });
  }
};
