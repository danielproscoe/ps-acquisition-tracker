// verify-ic-memo-cross-reit-fallback.mjs — verifies TONE RULE 14 fallback
// path: when subject MSA is NOT in PSA's disclosed set (Las Vegas), the
// cross-REIT FY2025 averages should appear as the historical anchor.

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Las Vegas — not in PSA's disclosed MSA set, so historicalMSARent is null
// and the cross-REIT averages become the fallback citation.
const generic = {
  snapshot: {
    name: "Las Vegas Calibration Test",
    city: "Las Vegas",
    state: "NV",
    ask: 9_500_000,
    nrsf: 65_000,
    unitCount: 540,
    yearBuilt: 2018,
    physicalOcc: 0.86,
    economicOcc: 0.83,
    pricePerSF: 146,
    pricePerUnit: 17_593,
    capOnAsk: 0.058,
    dealType: "stabilized",
    msaTier: "secondary",
  },
  reconstructed: {
    egi: 950_000,
    buyerNOI: 698_000,
    totalOpEx: 252_000,
    opexRatio: 0.265,
    buyerCap: 0.0735,
    flags: [],
  },
  projection: { y1NOI: 698_000, y3NOI: 760_000, y5NOI: 830_000 },
  marketCap: 0.062,
  msaTier: "secondary",
  dealType: "stabilized",
  tiers: { homeRun: 11_000_000, strike: 9_800_000, walk: 8_900_000 },
  verdict: { label: "PURSUE", color: "GREEN" },
  comps: { state: "NV", avgCap: 0.063, avgPPSF: 142, subjectPPSF: 146, subjectVsAvgPPSF: 0.028, compsCount: 5 },
  lens: "GENERIC",
  rentSanity: null,
  edgarComp: null,
  edgar8KTransactions: null,
};

const psLens = {
  ...generic,
  reconstructed: {
    egi: 1_010_000,
    buyerNOI: 768_000,
    totalOpEx: 232_000,
    opexRatio: 0.2297,
    buyerCap: 0.0808,
    flags: [],
  },
  tiers: { homeRun: 12_100_000, strike: 11_000_000, walk: 9_900_000 },
  verdict: { label: "PURSUE", color: "GREEN" },
  lens: "PS",
};

const enrichment = {
  coords: { lat: 36.17, lng: -115.14 },
  demographics: {
    pop1mi: 8_500, pop3mi: 92_000, pop5mi: 245_000,
    income3mi: 68_000, homeValue3mi: 295_000,
    popGrowth3mi: 0.022, incomeGrowth3mi: 0.028,
    renterPct3mi: 0.48, storageMPI3mi: 112, movedMPI3mi: 122,
  },
  psFamily: { distanceMi: 4.1, brand: "PS", name: "Public Storage — Las Vegas Sahara", city: "Las Vegas", state: "NV", count35mi: 19 },
  marketRents: { ccRentPerSF: 1.40, driveupRentPerSF: 0.78, sampleSize: 14, source: "SpareFoot" },
};

// Load the actual cross-REIT data from disk
const HISTORICAL_PATH = path.join(__dirname, "..", "src", "data", "edgar-historical-same-store.json");
const historicalAll = JSON.parse(fs.readFileSync(HISTORICAL_PATH, "utf-8"));
const historicalCrossREITSameStore = historicalAll.crossREITLatest;

// historicalMSARent is null for Las Vegas (not in PSA's disclosed set)
const body = JSON.stringify({
  generic,
  psLens,
  enrichment,
  historicalMSARent: null,
  historicalCrossREITSameStore,
});

console.log("Cross-REIT FY-latest input being sent:");
console.log(`  asOf: FY${historicalCrossREITSameStore.asOf}`);
console.log(`  avgSameStoreRentPerSF: $${historicalCrossREITSameStore.avgSameStoreRentPerSF.toFixed(2)}`);
console.log(`  avgSameStoreOccupancyEOP: ${(historicalCrossREITSameStore.avgSameStoreOccupancyEOP * 100).toFixed(2)}%`);
console.log(`  contributingIssuers: ${historicalCrossREITSameStore.contributingIssuers.join(", ")}`);

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
  console.log("\nPOST /api/analyzer-memo (Las Vegas — fallback path, ~30-60s)…");
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
    console.error("No memo:", JSON.stringify(parsed).slice(0, 500));
    process.exit(1);
  }

  const fullText = [
    memo.execSummary || "",
    ...(memo.topRisks || []),
    memo.bidPosture?.openingBidRationale || "",
    memo.bidPosture?.walkAwayRationale || "",
    memo.buyerRouting || "",
    memo.ps4Alignment || "",
  ].join("\n\n");

  const checks = [
    { name: "Cites Las Vegas by name", pass: /Las Vegas/i.test(fullText) },
    { name: "Cites cross-REIT or portfolio-aggregate language", pass: /(cross[- ]REIT|portfolio[- ]aggregate|cross-issuer|peer REIT)/i.test(fullText) },
    { name: "Cites contributing issuers (EXR/CUBE/NSA)", pass: /(EXR|CUBE|NSA)/.test(fullText) },
    { name: "Cites FY2025 anchor", pass: /FY?\s*2025/i.test(fullText) },
    {
      name: "Cites cross-REIT rent level OR YoY revenue/NOI figure (either is valid)",
      pass:
        /\$2[01]\.\d{2}\b/.test(fullText) ||
        /-?\d+\.\d+\s*%\s*YoY/i.test(fullText),
    },
    { name: "Does NOT cite a fake PSA per-MSA CAGR for Las Vegas", pass: !/PSA[- ]disclosed Las Vegas/i.test(fullText) },
  ];

  console.log("\n──── Memo content checks ────");
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}`);
    if (!c.pass) allPass = false;
  }

  console.log("\n──── Memo preview ────");
  console.log("execSummary:");
  console.log(memo.execSummary?.slice(0, 700) || "(empty)");
  console.log("\ntopRisks:");
  (memo.topRisks || []).forEach((r, i) => console.log(`  ${i + 1}. ${r}`));

  // Save full payload for audit
  const outDir = path.join("C:", "Users", "danie", "OneDrive", "Desktop", "MASTER FOLDER - CLAUDE", "#2 - PS", "Storvex PS - Reza Mahdavian");
  const outFile = path.join(outDir, "Storvex_PS_IC_Memo_LasVegas_CrossREITFallback_Verification.json");
  fs.writeFileSync(outFile, JSON.stringify({
    verifiedAt: new Date().toISOString(),
    checks,
    memo,
    model: parsed.model,
    elapsedMs: parsed.elapsedMs,
    inputs: {
      city: generic.snapshot.city,
      state: generic.snapshot.state,
      historicalMSARent: null,
      historicalCrossREITSameStore,
    },
  }, null, 2));
  console.log(`\nFull payload saved → ${outFile}`);

  if (!allPass) {
    console.error("\nVerification FAILED.");
    process.exit(1);
  }
  console.log("\n✓ All checks passed — TONE RULE 14 fallback citation working live.");
})().catch((e) => {
  console.error("\nFatal:", e.stack || e.message);
  process.exit(2);
});
