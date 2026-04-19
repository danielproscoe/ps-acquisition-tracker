// Vercel Serverless Function — Storvex Einstein Streaming Narrative
// Streams Claude Haiku 4.5 output as Server-Sent Events (SSE) so the
// browser can render the narrative word-by-word like ChatGPT. Sections
// arrive in order: EXECUTIVE_SUMMARY → INVESTMENT_MEMO_LONG → ANOMALY_FLAGS
// → BUYER_PITCH_EMAIL → OUTREACH_INTEL.
//
// POST /api/narrate-stream
//   body: { audit, site, inPlaceRentPerSf?, buyerType? }
//   returns: text/event-stream with events:
//     data: {"type":"delta","section":"EXECUTIVE_SUMMARY","text":"..."}
//     data: {"type":"section_end","section":"..."}
//     data: {"type":"done","elapsedMs":12345}
//     data: {"type":"error","error":"..."}

const https = require("https");

const STREAMING_SYSTEM_PROMPT = `You are Storvex Einstein — a senior institutional self-storage acquisition analyst with 20 years of experience underwriting REIT, private institutional, and family-office deals. You've worked at Public Storage, Extra Space, and Yardi Matrix. You synthesize across behavioral psychographics (Tapestry), demographic growth, housing vintage, employment mix, and live competitor data to produce insight no human analyst and no tool in market can match.

Your job: transform structured audit data into investor-grade narrative for an acquisition committee. Think Goldman Sachs research note meets Green Street Sector Report — not a sales brochure.

DATA CATEGORIES YOU RECEIVE:
• Core demographics (pop, HHI, households, growth rates, density) — ESRI 2025-2030 geocoded radial rings
• Age distribution — pay special attention to peak-storage cohorts (25-44 family formation + 55-74 downsizing)
• Income tier distribution — HH >$75K / >$100K drives CC rental propensity
• Housing stock — median year built + vacancy rate signal construction cycle
• Education — college+ share correlates with CC vs drive-up preference
• Tapestry Segmentation — behavioral/psychographic clusters
• Live competitor set from Places API within 3 mi

INSIGHT SYNTHESIS — when you see patterns like these, CALL THEM OUT:
• Tapestry "Suburban Periphery" + hhOver75K_pct >40% → high CC demand submarket
• Median year built <1980 + rising renter share → aging housing stock, migration from older dwellings
• Tapestry "Up and Coming Families" or "Professional Pride" → family-formation storage demand
• Tapestry "Savvy Suburbanites" → premium CC market, income elastic
• Low competitor count in 3-mi + high peak-age cohort → underserved opportunity

OUTPUT FORMAT — emit EXACTLY these five section blocks, in this order, using these exact delimiters:

<<SECTION:EXECUTIVE_SUMMARY>>
3-paragraph markdown: (1) Market Position, (2) Demographic Trajectory, (3) Competitive Landscape + Verdict. Bold key figures with **double asterisks**.
<<END>>

<<SECTION:INVESTMENT_MEMO_LONG>>
350-500 word long-form memo: Market Supply, Demographic Story, Behavioral Cluster Analysis, Competitive Positioning, Risk Factors, Recommendation. Written like a sector analyst's initiation note.
<<END>>

<<SECTION:ANOMALY_FLAGS>>
0-5 non-obvious risks, one per line, prefixed with "• ". Skip if nothing anomalous.
<<END>>

<<SECTION:BUYER_PITCH_EMAIL>>
8-12 line email from Dan Roscoe. Opens with strongest number, 3 bullet facts, single clear ask. No "I hope this finds you well" — get to the number in line 1.
<<END>>

<<SECTION:OUTREACH_INTEL>>
Three labeled lines:
BEST_HOOK: [single most compelling data point for buyer outreach]
TIMING_SIGNAL: [why NOW is the right moment given the data]
RISK_DISCLOSURE: [what an honest pitch must disclose upfront]
<<END>>

STRICT RULES:
1. Only reference numbers that exist in the provided audit data. Never invent figures.
2. Source-stamp every quantitative claim (e.g., "42K pop [ESRI 3-mi 2025]").
3. No hedge words ("approximately", "roughly"). State facts or flag unknowns.
4. Tone: confident, direct, data-first. Peer-to-peer with a senior capital allocator.
5. Active voice. Short sentences. Strong verbs.
6. If you see a Tapestry segment, NAME IT and translate what it means for storage demand.
7. Emit ONLY the five section blocks with <<SECTION:...>>...<<END>> delimiters. No preamble, no postamble, no JSON.`;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on Vercel." });
  }

  const { audit, site, inPlaceRentPerSf, buyerType } = req.body || {};
  if (!audit || !site) return res.status(400).json({ error: "audit and site required in body" });

  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const t0 = Date.now();

  // Set up SSE response
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable Nginx buffering

  const send = (obj) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
  };

  const payload = {
    model,
    max_tokens: 3000,
    stream: true,
    system: [{ type: "text", text: STREAMING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Site audit data (JSON):\n\n${JSON.stringify({ audit, site, inPlaceRentPerSf, buyerType }, null, 2)}\n\nEmit the five section blocks per the output format.`
      }
    ]
  };

  const body = JSON.stringify(payload);

  const upstreamReq = https.request({
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    }
  }, (upstream) => {
    if (upstream.statusCode !== 200) {
      let errBody = "";
      upstream.on("data", c => errBody += c);
      upstream.on("end", () => {
        send({ type: "error", error: `Anthropic ${upstream.statusCode}`, detail: errBody.slice(0, 500) });
        res.end();
      });
      return;
    }

    let buffer = "";       // raw SSE buffer from Anthropic
    let fullText = "";     // accumulated text across all deltas
    let currentSection = null;
    let sectionBuffer = "";  // text accumulated for current section (to detect <<END>>)

    const processToken = (chunk) => {
      fullText += chunk;

      // Look for section start / end markers in the accumulated buffer
      let searchFrom = 0;
      while (true) {
        if (!currentSection) {
          const openMatch = fullText.slice(searchFrom).match(/<<SECTION:([A-Z_]+)>>/);
          if (!openMatch) break;
          currentSection = openMatch[1];
          // advance past the marker
          searchFrom = searchFrom + openMatch.index + openMatch[0].length;
          sectionBuffer = fullText.slice(searchFrom);
          // immediately emit any text already accumulated past the marker
          if (sectionBuffer) {
            const endIdx = sectionBuffer.indexOf("<<END>>");
            if (endIdx >= 0) {
              const beforeEnd = sectionBuffer.slice(0, endIdx).trim();
              if (beforeEnd) send({ type: "delta", section: currentSection, text: beforeEnd });
              send({ type: "section_end", section: currentSection });
              searchFrom += endIdx + 7;
              currentSection = null;
              sectionBuffer = "";
              continue;
            } else {
              // partial section content already in buffer, emit it
              send({ type: "delta", section: currentSection, text: sectionBuffer });
              searchFrom += sectionBuffer.length;
              sectionBuffer = "";
            }
          }
        } else {
          // We are inside a section — look for <<END>>
          const tail = fullText.slice(searchFrom);
          const endIdx = tail.indexOf("<<END>>");
          if (endIdx >= 0) {
            const delta = tail.slice(0, endIdx);
            if (delta) send({ type: "delta", section: currentSection, text: delta });
            send({ type: "section_end", section: currentSection });
            searchFrom += endIdx + 7;
            currentSection = null;
            sectionBuffer = "";
          } else {
            // No end yet — emit the tail (minus possible partial <<END>> suffix)
            // Keep a 7-char buffer to avoid emitting partial "<<END>>"
            if (tail.length > 7) {
              const emit = tail.slice(0, tail.length - 7);
              send({ type: "delta", section: currentSection, text: emit });
              searchFrom += emit.length;
            }
            break;
          }
        }
      }
      // Truncate fullText to the unprocessed tail to avoid unbounded growth
      fullText = fullText.slice(searchFrom);
    };

    upstream.on("data", (chunk) => {
      buffer += chunk.toString("utf-8");
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6);
        if (json === "[DONE]") continue;
        try {
          const evt = JSON.parse(json);
          if (evt.type === "content_block_delta" && evt.delta?.text) {
            processToken(evt.delta.text);
          } else if (evt.type === "message_stop") {
            // flush any remaining buffer
            if (currentSection && fullText) {
              send({ type: "delta", section: currentSection, text: fullText });
              send({ type: "section_end", section: currentSection });
            }
            send({ type: "done", elapsedMs: Date.now() - t0 });
            res.end();
          } else if (evt.type === "message_delta" && evt.usage) {
            send({ type: "usage", usage: evt.usage });
          }
        } catch (e) { /* swallow parse errors on malformed SSE */ }
      }
    });

    upstream.on("end", () => {
      if (currentSection) send({ type: "section_end", section: currentSection });
      send({ type: "done", elapsedMs: Date.now() - t0 });
      res.end();
    });

    upstream.on("error", (e) => {
      send({ type: "error", error: e.message });
      res.end();
    });
  });

  upstreamReq.on("error", (e) => {
    send({ type: "error", error: e.message });
    res.end();
  });

  upstreamReq.write(body);
  upstreamReq.end();
};
