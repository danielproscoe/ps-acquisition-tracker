// Vercel Serverless Function — Storvex Zoning Oracle
// Looks up the permitted use table for self-storage in a given jurisdiction.
// Per CLAUDE.md §6c, zoning is the #1 deal-killer. Radius doesn't do this.
//
// Flow (V1 — optimized for <30s worst case):
//   1. Race Municode (library.municode.com) + ecode360 (ecode360.com) in parallel
//   2. Use the first source that returns usable HTML
//   3. Call Claude Haiku 4.5 to find the permitted use table row for
//      self-storage / mini-warehouse / storage warehouse terms
//   4. Return structured JSON with source URL + section citation
//
// Cost: ~$0.01-0.02 per call (Claude Haiku). Firebase-cacheable client-side.
//
// POST /api/zoning-lookup
//   body: { city: "Temple", state: "TX", county?: "Bell", address?, zoningDistrict? }
//   returns:
//     { ok: true, jurisdiction, storageTerm, byRightDistricts[], conditionalDistricts[],
//       ordinanceSection, source: "municode" | "ecode360" | "manual-required",
//       sourceUrl, verifiedAt, confidence, notes }

const https = require("https");

// Explicit function config — Pro tier allows up to 300s, default 60s.
// Worst case for this handler: 6s HTTP + 20s Claude ≈ 26s. 45s is safe.
module.exports.config = { maxDuration: 45 };

function httpsGet(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; StorvexOracle/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    };
    const req = https.request(opts, (res) => {
      // Handle one level of redirect (don't chain further to keep within timeout)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = res.headers.location.startsWith("http")
          ? res.headers.location
          : `https://${u.hostname}${res.headers.location}`;
        return httpsGet(nextUrl, timeoutMs).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data, url }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`GET timeout ${timeoutMs}ms: ${url}`)));
    req.end();
  });
}

function httpsPostJSON(hostname, path, headers, payload, timeoutMs = 20000) {
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

function slugify(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|th|td|li|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}

// Municode — searches for "self-storage" directly on the code search URL
function municodeTry(state, city) {
  const stateSlug = slugify(state);
  const citySlug = slugify(city);
  const landingUrl = `https://library.municode.com/${stateSlug}/${citySlug}`;
  const searchUrl = `https://library.municode.com/${stateSlug}/${citySlug}/codes/code_of_ordinances?searchRequest=%7B%22searchText%22%3A%22self-storage%22%7D`;
  return Promise.race([
    httpsGet(searchUrl).then(r => (r.status === 200 && r.body.length > 500
      ? { ok: true, source: "municode", sourceUrl: searchUrl, landingUrl, html: r.body }
      : { ok: false, source: "municode", reason: `search ${r.status}` }
    )),
    httpsGet(landingUrl).then(r => (r.status === 200 && r.body.length > 500
      ? { ok: true, source: "municode", sourceUrl: landingUrl, landingUrl, html: r.body }
      : { ok: false, source: "municode", reason: `landing ${r.status}` }
    )),
  ]).catch(e => ({ ok: false, source: "municode", reason: e.message }));
}

// ecode360 — alt provider covering TX + Northeast
function ecode360Try(state, city) {
  const citySlug = slugify(city).toUpperCase();
  const stateAbbr = (state || "").toString().toUpperCase().slice(0, 2);
  const urls = [
    `https://ecode360.com/${citySlug}`,
    `https://ecode360.com/${stateAbbr}/${slugify(city)}`,
  ];
  return Promise.any(urls.map(u => httpsGet(u).then(r => (r.status === 200 && r.body.length > 500
    ? { ok: true, source: "ecode360", sourceUrl: u, landingUrl: u, html: r.body }
    : Promise.reject(new Error(`${u}: ${r.status}`))
  ))))
  .catch(e => ({ ok: false, source: "ecode360", reason: e?.errors ? e.errors.map(x => x.message).join(" | ") : e?.message || "no ecode360 match" }));
}

const ZONING_EXTRACTION_PROMPT = `You are a zoning code researcher for a commercial real estate firm. You've been given HTML extract from a municipal code / zoning ordinance. Your job: find the permitted use table (sometimes called "Table of Permitted Uses", "Land Use Matrix", "Schedule of Permissible Uses", "Use Regulations") and extract the row for self-storage.

Storage goes by MANY names — search ALL of these terms:
- "self-storage" / "self storage"
- "mini-warehouse" / "mini warehouse" / "mini-storage"
- "storage warehouse"
- "self-service storage"
- "personal storage"
- "indoor storage" / "climate-controlled storage"
- "warehouse (mini/self-service)"
- "storage facility"

Zoning districts are typically coded: C-1, C-2, C-3, GC (General Commercial), HC (Highway Commercial), M-1 (Light Industrial), I-1 (Industrial), PUD (Planned Unit Development), B-3, etc.

Cell results in permitted use tables use these notations:
- P / "Permitted" = by-right
- C / CUP / SUP = Conditional / Special Use Permit required
- blank / "—" / "X" = NOT permitted
- A = Accessory only

OUTPUT FORMAT — return ONLY valid JSON:
{
  "found": true | false,
  "storageTerm": "exact term as it appears in the ordinance (e.g., 'Storage Warehouse (Includes Mini-Warehouse)')",
  "byRightDistricts": ["C-2", "C-3", "M-1"],
  "conditionalDistricts": ["C-1"],
  "rezoneRequired": ["any district where storage is explicitly prohibited"],
  "ordinanceSection": "Section or Article reference (e.g., 'Article 4, Table 4.2-1')",
  "tableName": "name of the permitted use table",
  "overlayNotes": "any overlay district requirements that affect storage (facade, setback, signage)",
  "supStandards": "any supplemental standards for storage (access hours, climate control, RV/boat rules)",
  "confidence": "high" | "medium" | "low",
  "notes": "1-2 sentence interpretation — is this a clean by-right site or will it need SUP/rezone?"
}

If you CANNOT find a permitted use table in the HTML (e.g., the HTML is a landing page, search form, or non-zoning chapter), return:
{
  "found": false,
  "confidence": "low",
  "notes": "Reason why not found — e.g., 'HTML appears to be a landing page, not the zoning chapter'"
}

STRICT RULES:
1. Never invent districts or ordinance sections. Only report what appears in the HTML.
2. If a district appears in multiple rows (e.g., mini-warehouse AND storage warehouse), list all matches in byRightDistricts.
3. If the HTML is truncated mid-table, flag in notes but report what you can see.
4. Confidence "high" = full use table visible with clear P/C/blank cells. "medium" = partial or inferred. "low" = best-effort extraction from incomplete content.`;

async function extractWithClaude(apiKey, jurisdictionLabel, sourceUrl, html) {
  const text = htmlToText(html).slice(0, 120000);
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";

  const payload = {
    model,
    max_tokens: 1800,
    system: [{ type: "text", text: ZONING_EXTRACTION_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Jurisdiction: ${jurisdictionLabel}\nSource: ${sourceUrl}\n\nExtracted ordinance text:\n\n${text}\n\nReturn the JSON object per the output schema.`,
    }],
  };

  const resp = await httpsPostJSON("api.anthropic.com", "/v1/messages", {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  }, payload);

  if (resp.status !== 200) {
    throw new Error(`Claude API ${resp.status}: ${resp.body.slice(0, 300)}`);
  }
  const json = JSON.parse(resp.body);
  const llmText = json.content?.[0]?.text || "";
  const match = llmText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Claude returned non-JSON: ${llmText.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]);
  parsed._tokenUsage = {
    input: json.usage?.input_tokens || 0,
    output: json.usage?.output_tokens || 0,
  };
  return parsed;
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
    // Race Municode + ecode360 in parallel — keep only the first source that
    // returns usable HTML. This caps the fetch phase at ~6s regardless of
    // which providers respond. Both fail → graceful "not found" response.
    const [muni, eco] = await Promise.all([municodeTry(state, city), ecode360Try(state, city)]);
    const sources = [muni, eco].filter(s => s.ok);

    if (sources.length === 0) {
      return res.status(200).json({
        ok: false,
        found: false,
        jurisdiction: jurisdictionLabel,
        subjectZoning: zoningDistrict || null,
        subjectAddress: address || null,
        notes: `Ordinance not automatically retrievable from Municode or ecode360. Call planning dept or Google: "${city} ${state} zoning ordinance permitted uses"`,
        searchHints: [
          `https://www.google.com/search?q=${encodeURIComponent(city + " " + state + " zoning ordinance permitted uses self-storage")}`,
          `https://library.municode.com/${slugify(state)}/${slugify(city)}`,
          `https://ecode360.com/${slugify(city).toUpperCase()}`,
        ],
        confidence: "low",
        source: "manual-required",
        verifiedAt: new Date().toISOString(),
        elapsedMs: Date.now() - t0,
        attempts: [muni, eco],
      });
    }

    // Prefer Municode if both return. Extract with Claude.
    const primary = sources[0];
    try {
      const extracted = await extractWithClaude(apiKey, jurisdictionLabel, primary.sourceUrl, primary.html);
      return res.status(200).json({
        ok: true,
        jurisdiction: jurisdictionLabel,
        subjectZoning: zoningDistrict || null,
        subjectAddress: address || null,
        ...extracted,
        source: primary.source,
        sourceUrl: primary.sourceUrl,
        landingUrl: primary.landingUrl,
        verifiedAt: new Date().toISOString(),
        elapsedMs: Date.now() - t0,
      });
    } catch (e) {
      return res.status(200).json({
        ok: false,
        found: false,
        jurisdiction: jurisdictionLabel,
        subjectZoning: zoningDistrict || null,
        notes: `Fetched ordinance from ${primary.source} but Claude extraction failed: ${e.message}`,
        source: primary.source,
        sourceUrl: primary.sourceUrl,
        confidence: "low",
        verifiedAt: new Date().toISOString(),
        elapsedMs: Date.now() - t0,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message, elapsedMs: Date.now() - t0 });
  }
};
