// verify-ic-memo-historical-msa.mjs — verifies the new historicalMSARent
// field is plumbed end-to-end through /api/analyzer-memo and the LLM cites
// the PSA per-MSA same-store CAGR in the generated narrative.
//
// Uses a synthetic Houston (PSA-disclosed MSA) payload + the actual
// FY2021-FY2025 series ingested by backfill-historical-msa-rents.mjs.
// Asserts the response cites the multi-year CAGR.

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORICAL_PATH = path.join(__dirname, "..", "src", "data", "edgar-historical-msa-rents.json");

if (!fs.existsSync(HISTORICAL_PATH)) {
  console.error("Missing", HISTORICAL_PATH, "— run backfill-historical-msa-rents.mjs first");
  process.exit(1);
}
const historicalAll = JSON.parse(fs.readFileSync(HISTORICAL_PATH, "utf-8"));
const houstonSeries = historicalAll.timeSeries.find((t) => t.issuer === "PSA" && t.msa === "Houston");
if (!houstonSeries) {
  console.error("Houston PSA series not found in historical data");
  process.exit(1);
}

console.log(`Houston PSA historical series loaded — FY${houstonSeries.firstYear}-FY${houstonSeries.lastYear} · CAGR ${houstonSeries.cagrPct.toFixed(2)}%/yr`);

// Synthetic Houston deal — picked to make the LLM naturally reference the
// MSA's historical performance.
const generic = {
  snapshot: {
    name: "Houston Calibration Test (Storage)",
    city: "Houston",
    state: "TX",
    ask: 12_000_000,
    nrsf: 75_000,
    unitCount: 600,
    yearBuilt: 2019,
    physicalOcc: 0.88,
    economicOcc: 0.85,
    pricePerSF: 160,
    pricePerUnit: 20_000,
    capOnAsk: 0.062,
    dealType: "stabilized",
    msaTier: "primary",
  },
  reconstructed: {
    egi: 1_120_000,
    buyerNOI: 845_000,
    totalOpEx: 275_000,
    opexRatio: 0.2455,
    buyerCap: 0.0704,
    flags: [],
  },
  projection: { y1NOI: 845_000, y3NOI: 925_000, y5NOI: 1_020_000 },
  marketCap: 0.063,
  msaTier: "primary",
  dealType: "stabilized",
  tiers: { homeRun: 13_500_000, strike: 12_400_000, walk: 11_300_000 },
  verdict: { label: "PURSUE", color: "GREEN" },
  comps: { state: "TX", avgCap: 0.064, avgPPSF: 152, subjectPPSF: 160, subjectVsAvgPPSF: 0.053, compsCount: 8 },
  lens: "GENERIC",
  rentSanity: null,
  edgarComp: null,
  edgar8KTransactions: null,
};

const psLens = {
  ...generic,
  reconstructed: {
    egi: 1_180_000, // brand premium applied
    buyerNOI: 925_000,
    totalOpEx: 255_000,
    opexRatio: 0.2161,
    buyerCap: 0.0771,
    flags: [],
  },
  tiers: { homeRun: 14_750_000, strike: 13_600_000, walk: 12_400_000 },
  verdict: { label: "PURSUE", color: "GREEN" },
  lens: "PS",
};

const enrichment = {
  coords: { lat: 29.76, lng: -95.36 },
  demographics: {
    pop1mi: 11_400, pop3mi: 85_200, pop5mi: 214_500,
    income3mi: 72_400, homeValue3mi: 285_000,
    popGrowth3mi: 0.018, incomeGrowth3mi: 0.024,
    renterPct3mi: 0.42, storageMPI3mi: 108, movedMPI3mi: 115,
  },
  psFamily: { distanceMi: 3.2, brand: "PS", name: "Public Storage — Houston Westchase", city: "Houston", state: "TX", count35mi: 28 },
  marketRents: { ccRentPerSF: 1.35, driveupRentPerSF: 0.72, sampleSize: 18, source: "SpareFoot" },
};

const historicalMSARent = houstonSeries;

const body = JSON.stringify({ generic, psLens, enrichment, historicalMSARent });

function post() {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "storvex.vercel.app",
        path: "/api/analyzer-memo",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log("POST /api/analyzer-memo (Houston test, ~30-60s for Claude Sonnet)…");
  const t0 = Date.now();
  const r = await post();
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Status: ${r.status} · ${dt}s`);
  if (r.status !== 200) {
    console.error("Body:", r.body.slice(0, 500));
    process.exit(1);
  }
  const parsed = JSON.parse(r.body);
  const memo = parsed.memo;
  if (!memo) {
    console.error("No memo in response:", JSON.stringify(parsed).slice(0, 500));
    process.exit(1);
  }

  // Validate the memo cites the historical CAGR
  const fullText = [
    memo.execSummary || "",
    ...(memo.topRisks || []),
    memo.bidPosture?.openingBidRationale || "",
    memo.bidPosture?.walkAwayRationale || "",
    memo.buyerRouting || "",
    memo.ps4Alignment || "",
  ].join("\n\n");

  const checks = [
    {
      name: "Cites Houston by name",
      pass: /Houston/i.test(fullText),
    },
    {
      name: "Cites multi-year CAGR (X.XX%/yr OR X.X%/yr OR similar)",
      pass: /(\d+(\.\d+)?%\s*\/\s*yr|\d+(\.\d+)?%\s*(?:per\s+year|annually|annualized|CAGR))/i.test(fullText),
    },
    {
      name: "References PSA / same-store / disclosed (institutional language)",
      pass: /(same[- ]store|self[- ]managed REIT|institutional|disclosed|MD&A|10-K)/i.test(fullText),
    },
    {
      name: "Mentions FY2021 or FY2025 anchor (multi-year window)",
      pass: /FY?\s*20(21|22|23|24|25)/i.test(fullText),
    },
    {
      name: "References rent levels in $/SF",
      pass: /\$\d+\.\d+\s*(?:\/\s*SF|per\s*SF|\/SF)/i.test(fullText),
    },
  ];

  console.log("\n──── Memo content checks ────");
  let allPass = true;
  for (const c of checks) {
    const mark = c.pass ? "✓" : "✗";
    console.log(`  ${mark} ${c.name}`);
    if (!c.pass) allPass = false;
  }

  console.log("\n──── Memo preview ────");
  console.log("execSummary:");
  console.log(memo.execSummary?.slice(0, 700) || "(empty)");
  console.log("\ntopRisks:");
  (memo.topRisks || []).forEach((r, i) => console.log(`  ${i + 1}. ${r}`));

  // Save full payload for audit
  const outDir = path.join("C:", "Users", "danie", "OneDrive", "Desktop", "MASTER FOLDER - CLAUDE", "#2 - PS", "Storvex PS - Reza Mahdavian");
  const outFile = path.join(outDir, "Storvex_PS_IC_Memo_Houston_HistoricalMSA_Verification.json");
  fs.writeFileSync(outFile, JSON.stringify({ verifiedAt: new Date().toISOString(), checks, memo, model: parsed.model, elapsedMs: parsed.elapsedMs }, null, 2));
  console.log(`\nFull payload saved → ${outFile}`);

  if (!allPass) {
    console.error("\nVerification FAILED — at least one assertion did not match.");
    process.exit(1);
  }
  console.log("\n✓ All checks passed — historical MSA CAGR cited in IC memo.");
})().catch((e) => {
  console.error("\nFatal:", e.stack || e.message);
  process.exit(2);
});
