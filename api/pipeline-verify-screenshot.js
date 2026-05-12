// Vercel Serverless Function — Pipeline Verification Screenshot Intake
//
// Closes the active wedge that DW exposed: institutional users have learned
// Radius Plus pipeline entries are often stale or fabricated, but the
// platform itself provides no verification status. DW would screenshot
// a Radius+ entry and ask "is this real?" Storvex's structural answer:
// drop the screenshot here → Claude Vision parses the visible pipeline
// entries → cross-references each against Storvex's primary-source
// registries (development-pipeline.json from REIT 10-K filings,
// submarketPipelineSupply.json from county permits) → returns a verdict
// card per entry: REAL · NOT FOUND · STALE · INCONCLUSIVE with the
// supporting citation.
//
// Each verification cycle is logged append-only to the audit ledger so
// Storvex's track record of Radius+ accuracy errors becomes a public-by-
// default moat over the engagement window.
//
// POST /api/pipeline-verify-screenshot
//   body: {
//     image:    string — data URL "data:image/png;base64,..." OR raw base64
//     filename: string — optional, for audit log
//     context:  string — optional caller-provided context ("DW Houston Westchase view")
//     uploader: string — optional uploader identifier (defaults to "anonymous")
//   }
//   returns: {
//     ok:                  boolean,
//     notPipelineScreenshot: boolean,
//     rationale:           string,
//     screenshotInsight:   string,
//     extractedEntries:    Array<ExtractedFacility>,
//     model:               string,
//     elapsedMs:           number,
//     tokenUsage:          { input_tokens, output_tokens, cache_*_tokens }
//   }

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

const SYSTEM_PROMPT = `You are an institutional self-storage analyst examining a screenshot from a competitor's market-intelligence platform (most commonly Radius Plus / Union Realtime, but also could be a CoStar Storage view, SpareFoot data, REIT 10-Q exhibit, or SSA New-Supply Quarterly report). Your job is to extract every self-storage construction pipeline entry visible in the screenshot — facilities that are under construction, permitted, planned, or recently announced. Do NOT extract operating facilities (already open) or sale comps (already sold).

You must NOT invent data. If a field is not visible in the screenshot, leave it null.

Return strict JSON. The structure:

{
  "notPipelineScreenshot": boolean,
  "rationale": "string — 1-2 sentences explaining what's in the image. If notPipelineScreenshot=true, briefly say why (e.g., 'screenshot shows operating-facility roster, not pipeline').",
  "screenshotInsight": "string — what platform appears to be the source, and how many entries are visible.",
  "extractedEntries": [
    {
      "operator": "string — REIT ticker (PSA/EXR/CUBE/NSA/LSI/SMA) when clearly a REIT-branded facility, or operator name (e.g., 'Andover Properties', 'Storage King', 'StorageMart', 'Andover', 'Devon Self Storage', 'SROA', 'Metro Self Storage', independent operator name). Null if unbranded.",
      "operatorName": "string — full disambiguated operator name when visible (e.g., 'Public Storage', 'Extra Space Storage', 'CubeSmart')",
      "address": "string — street address or named location as shown (e.g., '1850 W Sam Houston Pkwy N', 'Westchase / Houston', 'Cypress / NW Harris County'). Null if not shown.",
      "city": "string — city name. Null if not shown.",
      "state": "string — 2-letter state code. Null if not shown.",
      "msa": "string — MSA / metro name when shown (e.g., 'Houston', 'Dallas-Ft. Worth', 'Atlanta'). Null if not shown.",
      "nrsf": "number or null — net rentable square footage if shown (no commas, no units)",
      "ccPct": "number or null — climate-controlled percentage (e.g., 95 means 95%)",
      "stories": "number or null — number of stories",
      "expectedDelivery": "string or null — quarter/year (e.g., '2026-Q3', '2027-Q1'). Convert formats: 'Q3 2026' → '2026-Q3', 'Sept 2026' → '2026-Q3', 'mid-2027' → '2027-Q2'.",
      "status": "string — one of: 'under-construction' | 'permitted' | 'planned' | 'announced' | 'unknown'. Map vague terms: 'breaking ground' → 'under-construction', 'site control' → 'announced', 'approved' → 'permitted'.",
      "estimatedInvestment": "number or null — total investment $ if shown",
      "sourceInScreenshot": "string — describe what the screenshot itself cites as the data source for THIS entry. Common values: 'Radius+ aggregator entry — no primary citation visible', 'Cites REIT 10-Q', 'Cites local building permit', 'Source field blank', 'Source: Newmark 2025 Almanac'. This is critical context: aggregator-only citations get classified as CLAIMED downstream; primary-source citations get classified as VERIFIED.",
      "exactScreenshotText": "string — the verbatim text snippet from the screenshot that grounds this row, exactly as visible. Used for audit/dispute. Keep under 200 chars."
    }
  ]
}

Common screenshot platforms + how to parse them:
- Radius Plus pipeline-list view: table with columns Operator, Address, NRSF, CC%, Stories, Status, Expected Open. Source field is often blank or shows 'aggregated'.
- CoStar Storage subleased view: similar table, lower coverage.
- REIT 10-Q "Properties Under Development" table: 4-column shape (Location, Sq Ft, Anticipated Opening, Total Investment). Always primary-source — sourceInScreenshot should say "Cites REIT 10-Q exhibit".
- Newmark or Cushman quarterly market report: usually shows a top-10 pipeline list with operator+location+SF+delivery. Source citation usually visible.
- SSA New-Supply Quarterly: similar to Newmark but paid-service. Often shows status confidence flag (high/med/low).

If the image shows ANYTHING other than a pipeline / development / construction view, return notPipelineScreenshot=true and an empty extractedEntries array. Don't try to force a fit.`;

// Parse a base64 data URL or raw base64 into { mediaType, data }
function parseImageInput(raw) {
  if (!raw || typeof raw !== "string") return null;
  // data:image/png;base64,iVBOR...
  const m = /^data:(image\/(png|jpeg|jpg|gif|webp));base64,(.+)$/i.exec(raw);
  if (m) {
    let mediaType = m[1].toLowerCase();
    // Normalize jpg → jpeg for Anthropic API
    if (mediaType === "image/jpg") mediaType = "image/jpeg";
    return { mediaType, data: m[3].replace(/\s+/g, "") };
  }
  // Bare base64 — guess PNG
  if (/^[A-Za-z0-9+/=\s]+$/.test(raw) && raw.length > 100) {
    return { mediaType: "image/png", data: raw.replace(/\s+/g, "") };
  }
  return null;
}

function extractAndRepairJSON(raw) {
  if (!raw || typeof raw !== "string") return { ok: false, err: "empty LLM text" };
  let s = raw.replace(/```(?:json)?\s*\n?/gi, "").replace(/```\s*$/g, "");
  const start = s.indexOf("{");
  if (start < 0) return { ok: false, err: "no opening brace" };
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return { ok: false, err: "no matching close brace" };
  const candidate = s.slice(start, end + 1);
  try { return { ok: true, json: JSON.parse(candidate) }; }
  catch (e) {
    // Repair pass: remove trailing commas
    try { return { ok: true, json: JSON.parse(candidate.replace(/,\s*([}\]])/g, "$1")) }; }
    catch (e2) { return { ok: false, err: "json parse failed: " + e2.message }; }
  }
}

module.exports = async function handler(req, res) {
  // CORS — same pattern as analyzer-memo.js
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const { image, filename, context, uploader } = req.body || {};
  const parsed = parseImageInput(image);
  if (!parsed) {
    return res.status(400).json({
      error: "missing or invalid image — expected data URL 'data:image/png;base64,...' or raw base64",
    });
  }

  // Vercel Hobby/Pro body limit is 4.5MB. Image base64 inflates ~33% over raw.
  // We allow up to ~6MB base64 (≈ 4.5MB raw image). Larger should be rejected
  // with a clear error so the UI can offer a downscale path.
  if (parsed.data.length > 6 * 1024 * 1024) {
    return res.status(413).json({
      error: "image too large — max 4.5MB after base64 decode. Downscale and retry.",
    });
  }

  const model = process.env.CLAUDE_VISION_MODEL || "claude-sonnet-4-6";
  const t0 = Date.now();

  const userText = [
    "Screenshot to analyze.",
    context ? `\n\nCaller context: ${context}` : "",
    filename ? `\n\nFilename: ${filename}` : "",
    "\n\nExtract every pipeline entry visible per the JSON schema in your system prompt. Return only the JSON object.",
  ].join("");

  try {
    const payload = {
      model,
      max_tokens: 4000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: parsed.mediaType,
                data: parsed.data,
              },
            },
            { type: "text", text: userText },
          ],
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
    const extraction = extractAndRepairJSON(text);

    if (!extraction.ok) {
      return res.status(502).json({
        error: "extraction parse failed",
        detail: extraction.err,
        rawTextPreview: text.slice(0, 400),
        elapsedMs: Date.now() - t0,
      });
    }

    const result = extraction.json || {};
    // Normalize the response
    const entries = Array.isArray(result.extractedEntries) ? result.extractedEntries : [];

    return res.status(200).json({
      ok: true,
      notPipelineScreenshot: !!result.notPipelineScreenshot,
      rationale: result.rationale || null,
      screenshotInsight: result.screenshotInsight || null,
      extractedEntries: entries,
      uploader: uploader || "anonymous",
      filename: filename || null,
      context: context || null,
      model,
      elapsedMs: Date.now() - t0,
      tokenUsage: json.usage || null,
    });
  } catch (err) {
    return res.status(500).json({
      error: "internal error",
      detail: err.message || String(err),
      elapsedMs: Date.now() - t0,
    });
  }
};
