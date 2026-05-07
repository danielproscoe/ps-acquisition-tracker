// Vercel Serverless Function — Asset Analyzer OM Extraction
//
// Drop an Offering Memorandum PDF, get structured analyzer-ready JSON back.
// Powers the drop-zone on the Asset Analyzer (Storvex). Companion to the
// Zoning / Utility / Access oracles for ground-up SiteScore.
//
// POST /api/analyze-om
//   body: ONE OF:
//     { pdfText: "<plaintext extracted client-side via pdfjs>", filename?: "...", pageCount?: number }
//     { pdfBase64: "<base64-encoded PDF, no data:URI prefix>", filename?: "..." }
//   returns: {
//     ok, fields: { name, state, ask, nrsf, unitCount, yearBuilt,
//                   physicalOcc, economicOcc, t12NOI, t12EGI,
//                   proFormaEGI, proFormaNOI, ccPct, isManned,
//                   listingBroker, listingSource, dealType, currentTaxAnnual,
//                   address, city, msaTier },
//     confidence: 0..1, model, elapsedMs, tokenUsage
//   }
//
// pdfText is the preferred path — Vercel serverless functions cap request
// body at ~4.5 MB, so large OMs (5-10 MB PDFs) cannot send raw base64.
// Client extracts text via pdfjs-dist and sends ~50 KB instead.
// pdfBase64 is supported for small OMs (<3 MB) where richer document
// parsing (with charts/images) is preferred.
//
// Calibrated against Texas Store & Go OM (M&M Greenville TX, 2026-05).

const https = require("https");

// PDF can be 70+ pages, Sonnet extraction takes 15-45s.
module.exports.config = { maxDuration: 90 };

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

const SYSTEM_PROMPT = `You are an institutional self-storage acquisition analyst extracting structured underwriting data from a broker's Offering Memorandum (OM). You've underwritten 500+ self-storage deals from Marcus & Millichap, CBRE, JLL, Colliers, and direct off-market sources.

Your job: read the OM and return a strict JSON schema with the exact fields needed for buyer-lens NOI reconstruction. Skip the marketing fluff — pull only the numbers a buyer would underwrite.

EXTRACTION RULES — non-negotiable:
1. Numbers only. No "$1.5M-$2M" ranges — pick the seller's stated figure or the midpoint.
2. Source-stamp every figure mentally. Where the OM shows multiple columns (Y1 / Y3 / Pro Forma), pick the EARLIEST stabilized column for proFormaEGI/NOI, and the YEAR ONE column for t12EGI/NOI.
3. If a field is genuinely absent from the OM (not just hard to find) — return null. Do NOT fabricate.
4. dealType inference: if Year Built >= 2022 AND physical occupancy < 70%, classify "co-lu" (lease-up). If physical occ < 80% AND year built < 2022, classify "value-add". Otherwise "stabilized".
5. ccPct: estimate from unit mix table — sum of CC unit SF / total NRSF. If not separable, use 0.7 (institutional default).
6. isManned: TRUE if On-Site Payroll line on operating statement > $0. FALSE if line is $0 or absent (kiosk/unmanned).
7. msaTier: classify the asset's MSA. Top-30 metro = "top30". Rank 31-125 = "secondary". Rural / micro / sub-50K MSA = "tertiary".
8. listingSource: detect from broker firm — "M&M" for Marcus & Millichap, "CBRE", "JLL", "Colliers". If not a major brokerage, use "Other".

OUTPUT — return ONLY this JSON object, no surrounding prose:

{
  "fields": {
    "name": "string — Property name + address combined per Storvex convention 'City ST — Address'",
    "address": "string — street address",
    "city": "string",
    "state": "string — 2-letter US",
    "msaTier": "top30 | secondary | tertiary",
    "ask": number,
    "nrsf": number,
    "unitCount": number,
    "yearBuilt": number | null,
    "physicalOcc": number,        // decimal 0..1
    "economicOcc": number | null, // decimal 0..1
    "t12NOI": number,             // Year One NOI
    "t12EGI": number,             // Year One EGI
    "proFormaEGI": number | null, // stabilized projection (Y3 or Pro Forma column)
    "proFormaNOI": number | null,
    "ccPct": number,              // decimal 0..1
    "isManned": boolean,
    "listingBroker": "string — primary broker name",
    "listingSource": "Crexi | LoopNet | M&M | CBRE | JLL | Colliers | Off-market | Other",
    "dealType": "stabilized | co-lu | value-add",
    "currentTaxAnnual": number | null
  },
  "confidence": "0..1 — your confidence the extraction reflects the OM accurately",
  "extractionNotes": "string — 1-2 sentence summary of what you found and any ambiguity flags"
}

If a critical field (ask, nrsf, unitCount, t12EGI, t12NOI, state) is missing, set ok=false equivalent — return that field as null and flag in extractionNotes. Never guess.`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY not configured on Vercel. Add via Project Settings → Environment Variables.",
    });
  }

  // Parse body — accept either pdfText (preferred, client-extracted) or pdfBase64.
  const body = req.body || {};
  const pdfText = typeof body.pdfText === "string" ? body.pdfText : null;
  const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : null;
  const filename = body.filename || "om.pdf";
  const pageCount = body.pageCount || null;

  if (!pdfText && !pdfBase64) {
    return res.status(400).json({ error: "pdfText (client-extracted) or pdfBase64 required in body" });
  }

  // Sonnet 4.6 = best price/accuracy for structured extraction.
  const model = process.env.CLAUDE_OM_MODEL || "claude-sonnet-4-6";
  const t0 = Date.now();

  // Build user content: either text (preferred) or document (base64).
  let userContent;
  if (pdfText) {
    if (pdfText.length > 1_500_000) {
      return res.status(400).json({ error: `pdfText too large (${(pdfText.length / 1024).toFixed(0)} KB). Likely a parsing issue — split or simplify.` });
    }
    userContent = [
      {
        type: "text",
        text: `Offering Memorandum extracted text (filename: ${filename}${pageCount ? `, ${pageCount} pages` : ""}). Page boundaries marked with "=== Page N ===" headers.\n\nEXTRACT the underwriting data per the JSON schema in your system prompt. Return only the JSON object, no surrounding prose.\n\n────────── BEGIN OM TEXT ──────────\n\n${pdfText}\n\n────────── END OM TEXT ──────────`,
      },
    ];
  } else {
    const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, "").trim();
    const pdfBytes = Buffer.byteLength(cleanBase64, "base64");
    if (pdfBytes > 30 * 1024 * 1024) {
      return res.status(400).json({ error: `PDF too large (${(pdfBytes / 1024 / 1024).toFixed(1)} MB). Anthropic limit is 32 MB.` });
    }
    userContent = [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: cleanBase64 },
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: `Extract the underwriting data from this Offering Memorandum (filename: ${filename}). Return only the JSON object per the schema in your system prompt. No surrounding prose.`,
      },
    ];
  }

  try {
    const payload = {
      model,
      max_tokens: 3000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    };

    const resp = await httpsPostJSON("api.anthropic.com", "/v1/messages", {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    }, payload);

    if (resp.status !== 200) {
      return res.status(502).json({
        error: `Claude API ${resp.status}`,
        detail: resp.body.slice(0, 800),
        elapsedMs: Date.now() - t0,
      });
    }

    const json = JSON.parse(resp.body);
    const text = json.content?.[0]?.text || "";

    // Extract JSON object from response (model may wrap in code fences)
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(502).json({
        error: "Claude returned non-JSON",
        llmText: text.slice(0, 800),
        elapsedMs: Date.now() - t0,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch (parseErr) {
      return res.status(502).json({
        error: "Claude returned malformed JSON",
        parseErr: parseErr.message,
        llmText: text.slice(0, 800),
        elapsedMs: Date.now() - t0,
      });
    }

    return res.status(200).json({
      ok: true,
      fields: parsed.fields || {},
      confidence: parsed.confidence ?? null,
      extractionNotes: parsed.extractionNotes || "",
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
