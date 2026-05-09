// extract-8k-claude.mjs — Claude-assisted 8-K transaction extractor.
//
// The pure-regex extractor (extract-8k-transactions.mjs) caught 4 of 14
// candidates with substantial data. The remaining 10 have format variations
// that defeat regex (EXR Life Storage merger amendments, partial-disclosure
// filings, stock-based deals). Claude handles these gracefully.
//
// Strategy: focused excerpt + structured-output JSON prompt. Cost is ~$0.05
// per filing × 14 = ~$0.70 total. Drops cost-per-deal-comp dramatically vs
// any commercial provider.
//
// Output: src/data/edgar-8k-transactions-claude.json — Claude-extracted
// records merged with the regex output, deduplicated by accession #.

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { fetchFilingDocument } from "./fetch-filing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "_output");
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&#8203;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, "—")
    .replace(/&#8212;/g, "—")
    .replace(/\s+/g, " ");
}

const SYSTEM_PROMPT = `You are an institutional self-storage M&A analyst extracting structured deal terms from SEC 8-K filings.

You will receive an excerpt from a public REIT's 8-K filing announcing or completing an acquisition. Extract ONLY the fields that are EXPLICITLY stated in the text. Use null for any field not explicitly disclosed. NEVER infer, NEVER make up numbers, NEVER guess.

Return strict JSON, no surrounding prose, in this exact schema:

{
  "deal_type": "acquisition" | "merger" | "joint venture" | "disposition" | "other",
  "is_storage_related": true | false,
  "acquisition_date": "YYYY-MM-DD" | null,    // closing date or signing date if not closed
  "is_closed": true | false | null,             // true if "completed", false if "agreed/announced"
  "buyer": string | null,                       // typically the filing entity
  "seller": string | null,                      // named selling entity if disclosed
  "target_entity": string | null,               // the company/portfolio being acquired
  "num_facilities": number | null,              // count of self-storage facilities
  "nrsf_million": number | null,                // net rentable square feet in millions
  "aggregate_price_million": number | null,    // total deal value in $M (convert billions × 1000)
  "cap_rate_pct": number | null,                // disclosed going-in cap rate, as decimal (e.g. 0.058 for 5.8%)
  "consideration_type": "cash" | "stock" | "mixed" | null,
  "key_quote": string                            // a 1-2 sentence verbatim quote that supports the extraction
}

Rules:
1. NEVER fabricate. If a field isn't in the text, return null for that field.
2. For prices, ALWAYS convert to millions. "$2.2 billion" → 2200. "$50 million" → 50.
3. For cap rates, convert percent to decimal. "6.5% cap rate" → 0.065.
4. is_storage_related: true if the deal is for self-storage facilities or a self-storage company. False otherwise.
5. The key_quote must be a verbatim sentence from the input — do not paraphrase.

Return ONLY the JSON object. No prose before or after.`;

function findAcquisitionExcerpt(text, candidate) {
  // Find the most acquisition-relevant section. Look for keyword anchors and
  // grab ~5KB around them.
  const anchors = [
    /acquired\s+(?:approximately\s+)?\d+\s+self.storage/i,
    /aggregate\s+(?:purchase\s+)?(?:consideration|price)/i,
    /merger\s+agreement/i,
    /Item\s+2\.01/i,
    /Item\s+1\.01\s+Entry\s+into/i,
    /completion\s+of\s+acquisition/i,
    /entered\s+into.*?(?:purchase|merger|acquisition)/i,
  ];
  for (const re of anchors) {
    const m = re.exec(text);
    if (m) {
      const start = Math.max(0, m.index - 500);
      const end = Math.min(text.length, m.index + 4500);
      return text.slice(start, end);
    }
  }
  // Fallback: first 5KB
  return text.slice(0, 5000);
}

function callClaude(apiKey, excerpt, candidate) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: process.env.CLAUDE_MEMO_MODEL || "claude-sonnet-4-6",
      max_tokens: 1500,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `8-K filing context:\n  Issuer: ${candidate.issuer}\n  Filing date: ${candidate.filingDate}\n  Accession: ${candidate.accessionNumber}\n  Item codes: ${(candidate.itemCodes || []).join(", ")}\n\nExcerpt:\n${excerpt}\n\nExtract per the JSON schema in the system prompt. Return only JSON.`,
        },
      ],
    });
    const opts = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
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

async function extractWithClaude(candidate, apiKey) {
  const html = await fetchFilingDocument(candidate.cik, candidate.accessionNumber, candidate.primaryDocument);
  const text = htmlToText(html);
  const excerpt = findAcquisitionExcerpt(text, candidate);

  const t0 = Date.now();
  const resp = await callClaude(apiKey, excerpt, candidate);
  const elapsed = Date.now() - t0;

  if (resp.status !== 200) {
    return { error: `Claude API ${resp.status}: ${resp.body.slice(0, 300)}`, elapsedMs: elapsed };
  }

  const json = JSON.parse(resp.body);
  const responseText = json.content?.[0]?.text || "";
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { error: "Claude returned non-JSON", llmText: responseText.slice(0, 300), elapsedMs: elapsed };
  }
  let extracted;
  try {
    extracted = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return { error: `Malformed JSON: ${e.message}`, llmText: responseText.slice(0, 300), elapsedMs: elapsed };
  }

  return {
    issuer: candidate.issuer,
    cik: candidate.cik,
    issuerName: candidate.issuer === "PSA" ? "Public Storage" : candidate.issuer === "EXR" ? "Extra Space Storage Inc" : candidate.issuer === "CUBE" ? "CubeSmart" : candidate.issuer,
    filingDate: candidate.filingDate,
    accessionNumber: candidate.accessionNumber,
    filingURL: candidate.filingURL,
    itemCodes: candidate.itemCodes,
    extractedAt: new Date().toISOString(),
    extractionMethod: "Claude Sonnet 4.6 + structured-output prompt",
    elapsedMs: elapsed,
    tokenUsage: {
      input: json.usage?.input_tokens || 0,
      output: json.usage?.output_tokens || 0,
      cacheRead: json.usage?.cache_read_input_tokens || 0,
    },
    extracted,
  };
}

async function run() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("✗ ANTHROPIC_API_KEY not set in environment");
    process.exit(1);
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  Day 5b — Claude-assisted 8-K extraction");
  console.log("════════════════════════════════════════════════════════════════════\n");

  const candPath = path.join(OUT_DIR, "8k-acquisition-candidates.json");
  const candList = JSON.parse(fs.readFileSync(candPath, "utf8"));
  const candidates = candList.candidates || [];
  console.log(`Loaded ${candidates.length} candidates\n`);

  const results = [];
  let totalInput = 0, totalOutput = 0, totalElapsed = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    process.stdout.write(`[${i + 1}/${candidates.length}] ${c.issuer} ${c.filingDate} ${c.accessionNumber} ... `);
    try {
      const r = await extractWithClaude(c, apiKey);
      if (r.error) {
        console.log("✗ " + r.error.slice(0, 100));
        results.push({ ...c, claudeError: r.error });
        continue;
      }
      const e = r.extracted;
      const summary = [
        e.deal_type || "?",
        e.aggregate_price_million ? `$${e.aggregate_price_million}M` : "$?",
        e.num_facilities ? `${e.num_facilities} fac` : "? fac",
        e.target_entity ? `→ ${e.target_entity.slice(0, 30)}` : "no target",
        `(${r.elapsedMs}ms)`,
      ].join(" · ");
      console.log("✓ " + summary);
      results.push(r);
      totalInput += r.tokenUsage.input;
      totalOutput += r.tokenUsage.output;
      totalElapsed += r.elapsedMs;
    } catch (e) {
      console.log("✗ " + e.message);
      results.push({ ...c, claudeError: e.message });
    }
  }

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("  Claude Extraction Summary");
  console.log("════════════════════════════════════════════════════════════════════\n");

  for (const r of results) {
    if (r.claudeError) continue;
    const e = r.extracted;
    console.log(`▸ ${r.issuer} · ${r.filingDate} · ${r.accessionNumber}`);
    if (e.target_entity) console.log(`  Target: ${e.target_entity}`);
    if (e.seller && e.seller !== e.target_entity) console.log(`  Seller: ${e.seller}`);
    if (e.aggregate_price_million) console.log(`  Price: $${e.aggregate_price_million}M${e.aggregate_price_million >= 1000 ? ` ($${(e.aggregate_price_million / 1000).toFixed(2)}B)` : ""}`);
    if (e.num_facilities) console.log(`  Facilities: ${e.num_facilities}${e.nrsf_million ? ` · ${e.nrsf_million}M SF` : ""}`);
    if (e.cap_rate_pct) console.log(`  Cap rate: ${(e.cap_rate_pct * 100).toFixed(2)}%`);
    if (e.consideration_type) console.log(`  Consideration: ${e.consideration_type}`);
    if (e.deal_type) console.log(`  Deal type: ${e.deal_type}${e.is_closed === false ? " (announced, not closed)" : ""}`);
    if (e.key_quote) console.log(`  Quote: "${e.key_quote.slice(0, 200)}..."`);
    console.log();
  }

  console.log(`Token usage: ${totalInput} in / ${totalOutput} out · ~$${((totalInput * 3 + totalOutput * 15) / 1_000_000).toFixed(3)} approx cost`);
  console.log(`Total wall time: ${(totalElapsed / 1000).toFixed(1)}s`);

  const out = {
    schema: "storvex.edgar-8k-transactions-claude.v1",
    generatedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
    successfulExtractions: results.filter((r) => !r.claudeError).length,
    transactions: results.filter((r) => !r.claudeError),
    errors: results.filter((r) => r.claudeError).map((r) => ({ issuer: r.issuer, accessionNumber: r.accessionNumber, error: r.claudeError })),
    tokenUsage: { input: totalInput, output: totalOutput, costApproxUSD: (totalInput * 3 + totalOutput * 15) / 1_000_000 },
  };
  const outPath = path.join(DATA_DIR, "edgar-8k-transactions-claude.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n✓ Saved: src/data/edgar-8k-transactions-claude.json`);
}

run().catch((e) => {
  console.error("✗ Failed:", e.message);
  console.error(e.stack);
  process.exit(1);
});
