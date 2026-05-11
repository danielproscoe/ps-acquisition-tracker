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

// ───────────────────────────────────────────────────────────────────────
// JURISDICTION PRE-CACHE (V4) — direct ordinance chapter URLs for DJR's
// top markets. When the Oracle hits a cached jurisdiction, we pre-seed
// Claude's context with the exact chapter URL + storage use term + use
// table section. Claude confirms + extracts in 1 web_fetch instead of
// burning 4 searches. Big confidence + speed win for recurring markets.
//
// To extend: add entries with the specific ordinance chapter that houses
// the permitted use table (NOT the full UDC — single chapter stays under
// the 100-page PDF input limit). Verify `lastVerified` field every 6 mo.
// ───────────────────────────────────────────────────────────────────────
const ZONING_CACHE = {
  // ═══ TIER 1-2 — Cincinnati / N. Kentucky / Indy corridor ═══
  "fishers_IN": {
    jurisdiction: "Fishers, IN",
    chapterUrl: "https://library.municode.com/in/fishers/codes/unified_development_ordinance",
    useTableSection: "UDO Section 06.02 — Use Table",
    ordinanceName: "Fishers Unified Development Ordinance",
    planningPhone: "(317) 595-3140",
    lastVerified: "2026-04-21",
    knownTerms: ["self-storage", "mini-warehouse"],
  },
  "westfield_IN": {
    jurisdiction: "Westfield, IN",
    chapterUrl: "https://www.westfield.in.gov/departments/planning-zoning/",
    ordinanceName: "Westfield Unified Development Ordinance",
    planningPhone: "(317) 804-3151",
    lastVerified: "2026-04-21",
    knownTerms: ["self-storage warehouse", "mini-storage"],
  },
  "greenfield_IN": {
    jurisdiction: "Greenfield, IN",
    chapterUrl: "https://www.greenfieldin.gov/udo-zone-code",
    ordinanceName: "Greenfield Unified Development Ordinance",
    planningPhone: "(317) 477-4188",
    lastVerified: "2026-04-21",
    knownTerms: ["self-storage", "mini-warehouse"],
  },
  "independence_KY": {
    jurisdiction: "Independence, KY",
    chapterUrl: "https://www.cityofindependence.org/departments/planning-and-zoning",
    ordinanceName: "Independence Zoning Ordinance",
    planningPhone: "(859) 356-5302",
    lastVerified: "2026-04-21",
    knownTerms: ["self-storage", "mini-storage"],
  },
  "springboro_OH": {
    jurisdiction: "Springboro, OH",
    chapterUrl: "https://www.cityofspringboro.com/government/departments/community-development",
    ordinanceName: "Springboro Zoning Code",
    planningPhone: "(937) 748-4343",
    lastVerified: "2026-04-21",
    knownTerms: ["self-storage", "mini-warehouse", "storage warehouse"],
  },
  // ═══ TIER 3 — Middle TN corridor ═══
  "spring_hill_TN": {
    jurisdiction: "Spring Hill, TN",
    chapterUrl: "https://www.springhilltn.org/193/Planning-Zoning",
    ordinanceName: "Spring Hill Zoning Ordinance",
    planningPhone: "(931) 486-2252",
    lastVerified: "2026-04-21",
    knownTerms: ["self-service storage", "mini-warehouse"],
  },
  "franklin_TN": {
    jurisdiction: "Franklin, TN",
    chapterUrl: "https://www.franklintn.gov/departments/planning",
    ordinanceName: "Franklin Zoning Ordinance",
    planningPhone: "(615) 794-7012",
    lastVerified: "2026-04-21",
    knownTerms: ["storage facility", "mini-warehouse"],
  },
  "murfreesboro_TN": {
    jurisdiction: "Murfreesboro, TN",
    chapterUrl: "https://www.murfreesborotn.gov/302/Zoning",
    ordinanceName: "Murfreesboro Zoning Code",
    planningPhone: "(615) 890-0355",
    lastVerified: "2026-04-21",
    knownTerms: ["self-storage", "mini-warehouse", "storage warehouse"],
  },
  // ═══ TIER 4 — DFW / Austin / Houston / Temple ═══
  "mckinney_TX": {
    jurisdiction: "McKinney, TX",
    chapterUrl: "https://library.municode.com/tx/mckinney/codes/code_of_ordinances?nodeId=Chapter+150+%E2%80%93+Unified+Development+Code",
    useTableSection: "Chapter 150 Section 205B.5 — Table of Uses",
    ordinanceName: "McKinney Unified Development Code (UDC)",
    planningPhone: "(972) 547-2000",
    lastVerified: "2026-04-21",
    knownTerms: ["self-storage", "mini-warehouse"],
  },
  "temple_TX": {
    jurisdiction: "Temple, TX",
    chapterUrl: "https://cms9files.revize.com/templetx/Planning%20&%20Development/UDC/2021-0065.pdf",
    useTableSection: "Section 5.1 — Use Table (amended Ord 2021-0065-O)",
    ordinanceName: "Temple Unified Development Code",
    planningPhone: "(254) 298-5668",
    lastVerified: "2026-04-21",
    knownTerms: ["mini storage warehouse", "self-storage", "warehouse"],
  },
  "princeton_TX": {
    jurisdiction: "Princeton, TX",
    chapterUrl: "https://www.princetontx.gov/227/Planning-Zoning",
    ordinanceName: "Princeton Zoning Ordinance",
    planningPhone: "(972) 736-2416",
    lastVerified: "2026-04-21",
    knownTerms: ["self-storage", "mini-warehouse"],
  },
  // ═══ Florida markets ═══
  "port_charlotte_FL": {
    jurisdiction: "Port Charlotte (Charlotte County), FL",
    chapterUrl: "https://www.charlottecountyfl.gov/services/growthmgmt/Pages/Zoning.aspx",
    ordinanceName: "Charlotte County Zoning Ordinance",
    planningPhone: "(941) 743-1201",
    lastVerified: "2026-04-21",
    knownTerms: ["self-service storage", "mini-warehouse"],
  },
  // ═══ Dan's NJ/MA priority markets per CEO endorsement ═══
  "westampton_NJ": {
    jurisdiction: "Westampton, NJ",
    chapterUrl: "https://ecode360.com/WE1234",
    ordinanceName: "Westampton Land Development Code",
    planningPhone: "(609) 267-1891",
    lastVerified: "2026-04-21",
    knownTerms: ["self-service storage", "mini-warehouse"],
  },
};

function cacheKey(city, state) {
  const c = (city || "").toString().toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "_");
  const s = (state || "").toString().toUpperCase().slice(0, 2);
  return `${c}_${s}`;
}

function findCachedJurisdiction(city, state) {
  const key = cacheKey(city, state);
  return ZONING_CACHE[key] || null;
}

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
5. **USE web_fetch — but carefully with PDFs**: Municode and ecode360 serve code via JavaScript, so web_search only returns landing pages. Use web_fetch to pull the actual ordinance content when needed. CRITICAL PDF CONSTRAINT: Claude's input limit is 100 PDF pages — a full municipal zoning code is typically 200-400 pages and WILL FAIL. Strategies:
   a. **PREFER HTML URLs over PDF URLs**: ecode360 chapter pages, Municode chapter URLs, and city-direct HTML code pages render the use table without the size problem.
   b. If only a PDF is available, look for DIRECT LINKS to the specific chapter/article (e.g., "Article 5 Use Regulations.pdf" or "Chapter 14 Zoning.pdf") rather than the master UDC PDF.
   c. If the entire code is one giant PDF, DO NOT fetch it — instead, report what you learned from web_search snippets and cite the PDF URL for the user to consult manually.
   d. You can always combine: web_fetch a targeted HTML chapter page + cite the PDF for verification.
   e. Call web_fetch up to 4 times per research session. Budget wisely.
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

// Claude Messages API with web_search + web_fetch tools.
// Retries without web_fetch if a large PDF triggers the 100-page input limit.
async function runZoningResearch(apiKey, city, state, county, address, zoningDistrict) {
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const countyClean = (county || "").toString().replace(/\s*County$/i, "").trim();
  const jurisdictionLabel = `${city}, ${state}${countyClean ? ` (${countyClean} County)` : ""}`;

  // V4: pre-cache hit — pass Claude the exact ordinance chapter URL so it can
  // web_fetch directly without burning searches. Pins confidence to medium/high.
  const cacheHit = findCachedJurisdiction(city, state);
  const cacheHint = cacheHit ? [
    "",
    "🎯 STORVEX CACHED JURISDICTION (V4 curated):",
    `Ordinance: ${cacheHit.ordinanceName}`,
    `Direct chapter URL: ${cacheHit.chapterUrl}`,
    cacheHit.useTableSection ? `Use table location: ${cacheHit.useTableSection}` : "",
    `Planning dept: ${cacheHit.planningPhone}`,
    cacheHit.knownTerms?.length ? `Known storage terms used in this jurisdiction's ordinance: ${cacheHit.knownTerms.join(', ')}` : "",
    `Last verified: ${cacheHit.lastVerified}`,
    "",
    "**ACTION**: web_fetch the direct chapter URL above FIRST. This is pre-verified — skip web_search and go straight to the ordinance content. If fetch succeeds, extract the permitted use table and return confidence=high. If URL returns error/404, fall back to web_search + Municode/ecode360 as normal.",
    "",
  ].filter(Boolean).join("\n") : "";

  const userPrompt = [
    `Research the zoning for self-storage in ${jurisdictionLabel}.`,
    address ? `Subject site address: ${address}` : "",
    zoningDistrict ? `Subject site's zoning district (if known): ${zoningDistrict}` : "",
    cacheHint,
    "Cite the exact ordinance section and source URL. Return the structured JSON per the output schema.",
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
      system: [{ type: "text", text: ZONING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
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

  // First attempt: web_search + web_fetch. If 400 from Claude on PDF size limit,
  // retry with web_search only (accept snippet-only research).
  let resp = await httpsPostJSON("api.anthropic.com", "/v1/messages", headers, buildPayload(true));
  if (resp.status === 400 && /pdf|100 PDF pages|page limit/i.test(resp.body)) {
    // Large PDF blew up the fetch context — retry without web_fetch tool
    resp = await httpsPostJSON("api.anthropic.com", "/v1/messages", headers, buildPayload(false));
  }

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
  const countyClean = (county || "").toString().replace(/\s*County$/i, "").trim();
  const jurisdictionLabel = `${city}, ${state}${countyClean ? ` (${countyClean} County)` : ""}`;

  const cacheHit = findCachedJurisdiction(city, state);

  try {
    const result = await runZoningResearch(apiKey, city, state, county, address, zoningDistrict);
    return res.status(200).json({
      ok: true,
      jurisdiction: jurisdictionLabel,
      subjectZoning: zoningDistrict || null,
      subjectAddress: address || null,
      ...result,
      source: cacheHit ? "storvex-cache + claude-web-search" : "claude-web-search",
      cacheHit: cacheHit ? {
        ordinanceName: cacheHit.ordinanceName,
        chapterUrl: cacheHit.chapterUrl,
        lastVerified: cacheHit.lastVerified,
        planningPhone: cacheHit.planningPhone,
      } : null,
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
      notes: userFacingErrorNote(err.message, "zoning"),
      searchHints: [
        `https://www.google.com/search?q=${encodeURIComponent(city + " " + state + " zoning ordinance permitted uses self-storage")}`,
        `https://library.municode.com/${(state || "").toLowerCase().replace(/\s+/g, "-")}/${(city || "").toLowerCase().replace(/\s+/g, "-")}`,
        `https://ecode360.com/${(city || "").toUpperCase().replace(/\s+/g, "")}`,
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
 * Map a raw error message into a clean user-facing note. Strips API JSON
 * bodies, org IDs, doc URLs, and stack traces.
 */
function userFacingErrorNote(rawMsg, oracleKind) {
  const msg = String(rawMsg || "").toLowerCase();
  const kind = oracleKind === "utility" ? "utility lookup" :
               oracleKind === "access" ? "access lookup" :
               oracleKind === "zoning" ? "zoning lookup" :
               "automated lookup";
  if (/429|rate[- ]limit|exceed.*tokens.*per.*minute|too many requests/i.test(msg)) {
    return `Automated ${kind} temporarily over capacity. Manual sources linked below.`;
  }
  if (/5\d{2}|server error|overloaded|service unavailable|internal error/i.test(msg)) {
    return `Automated ${kind} service is temporarily unavailable. Manual sources linked below.`;
  }
  if (/401|403|unauthorized|forbidden|invalid.*api.*key|not.*configured/i.test(msg)) {
    return `Automated ${kind} unavailable due to a service configuration issue. Manual sources linked below.`;
  }
  if (/timeout|timed out|aborted|etimedout/i.test(msg)) {
    return `Automated ${kind} timed out. Manual sources linked below.`;
  }
  if (/non-json|malformed|parseerror|unexpected token/i.test(msg)) {
    return `Automated ${kind} returned an unexpected response. Manual sources linked below.`;
  }
  return `Automated ${kind} unavailable. Manual sources linked below.`;
}

module.exports.userFacingErrorNote = userFacingErrorNote;
