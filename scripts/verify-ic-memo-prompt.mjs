// verify-ic-memo-prompt.mjs — verifies the live /api/analyzer-memo endpoint
// emits IC memos with the new platform-fit Δ + rent sanity language.
//
// Strategy: build the same trim payload AssetAnalyzerView would send
// (Texas Store & Go calibration deal — verdicts diverge, marketRents
// present), POST to production, capture the IC memo response, write to
// the Reza folder for visual review.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const renderTestPath = path.join(__dirname, "..", "src", "_verify-memo.test.js");
const outDir = path.join(
  "C:", "Users", "danie", "OneDrive", "Desktop",
  "MASTER FOLDER - CLAUDE", "#2 - PS", "Storvex PS - Reza Mahdavian"
);
const outJson = path.join(outDir, "Storvex_PS_IC_Memo_Verification.json");
const outMd = path.join(outDir, "Storvex_PS_IC_Memo_Verification.md");

const renderTest = `
// Auto-generated verification of /api/analyzer-memo prompt update.
// Builds Texas Store & Go calibration payload, POSTs to production, writes
// response to disk for visual review. NOT a real test — leverages CRA
// jest-Babel pipeline only to import ES modules.

import fs from "node:fs";
import https from "node:https";
import { analyzeExistingAsset } from "./existingAssetAnalysis";
import { computeBuyerLens, PS_LENS } from "./buyerLensProfiles";

const input = {
  name: "Texas Store & Go (Greenville TX)",
  ask: 5200000,
  nrsf: 67000,
  unitCount: 520,
  yearBuilt: 2024,
  state: "TX",
  msaTier: "tertiary",
  dealType: "co-lu",
  physicalOcc: 0.33,
  economicOcc: 0.28,
  ccPct: 0.70,
  isManned: false,
  t12EGI: 612000,
  t12NOI: 197974,
  proFormaEGI: 935000,
  proFormaNOI: 612000,
};

const marketRents = {
  ccRentPerSF: 1.42,
  driveupRentPerSF: 0.78,
  sampleSize: 14,
  source: "SpareFoot",
};

const generic = analyzeExistingAsset(input, { marketRents });
const psLens = computeBuyerLens(input, PS_LENS, { marketRents });

const enrichment = {
  coords: { lat: 33.1377, lng: -96.1097 },
  demographics: {
    pop1mi: 3480, pop3mi: 22140, pop5mi: 36280,
    income3mi: 62450, homeValue3mi: 218000,
    popGrowth3mi: 0.0207, incomeGrowth3mi: 0.0285,
    renterPct3mi: 0.31, storageMPI3mi: 112, movedMPI3mi: 108,
  },
  psFamily: {
    distanceMi: 28.4, brand: "PS", name: "Public Storage — Rockwall TX",
    city: "Rockwall", state: "TX", count35mi: 4,
  },
  marketRents,
};

const body = JSON.stringify({ generic, psLens, enrichment });

function post() {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "storvex.vercel.app",
      path: "/api/analyzer-memo",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
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

const outJson = process.env.STORVEX_MEMO_OUT_JSON;
const outMd = process.env.STORVEX_MEMO_OUT_MD;

test("hit /api/analyzer-memo and write response to disk", async () => {
  const t0 = Date.now();
  const resp = await post();
  const elapsed = Date.now() - t0;

  fs.writeFileSync(outJson, JSON.stringify({ status: resp.status, elapsedMs: elapsed, raw: resp.body }, null, 2), "utf8");

  expect(resp.status).toBe(200);
  const parsed = JSON.parse(resp.body);
  expect(parsed.ok).toBe(true);
  expect(parsed.memo).toBeTruthy();

  // Pretty-print for human review
  const m = parsed.memo;
  const md = [
    "# Storvex PS — IC Memo Verification (Live Production Endpoint)",
    "",
    "_Generated against \`/api/analyzer-memo\` on storvex.vercel.app to verify the platform-fit Δ + rent sanity prompt update (commit a9745c3)._",
    "",
    "**Calibration deal:** Texas Store & Go (Greenville TX) · CO-LU · $5.2M ask",
    "",
    \`**Generated:** \${new Date().toISOString()} · \${elapsed}ms · model \${parsed.model}\`,
    "",
    "---",
    "",
    \`## Recommendation\\n\\n**\${m.recommendation || "—"}**\\n\\n---\\n\`,
    "",
    "## Executive Summary",
    "",
    m.execSummary || "—",
    "",
    "---",
    "",
    "## Bid Posture",
    "",
    \`**Opening Bid:** $\${(m.bidPosture?.openingBid || 0).toLocaleString()}\`,
    "",
    \`**Rationale:** \${m.bidPosture?.openingBidRationale || "—"}\`,
    "",
    \`**Walk-Away:** $\${(m.bidPosture?.walkAway || 0).toLocaleString()}\`,
    "",
    \`**Rationale:** \${m.bidPosture?.walkAwayRationale || "—"}\`,
    "",
    "---",
    "",
    "## Top Risks",
    "",
    ...(m.topRisks || []).map((r, i) => \`\${i + 1}. \${r}\`),
    "",
    "---",
    "",
    "## Buyer Routing",
    "",
    m.buyerRouting || "—",
    "",
    "---",
    "",
    "## Strategic Alignment",
    "",
    m.ps4Alignment || "—",
    "",
    "---",
    "",
    "## Verification Checks (manual eyeball)",
    "",
    \`- [ ] Platform-fit Δ cited in execSummary P1: \${(m.execSummary || "").match(/platform-fit/i) ? "✓ found" : "✗ missing"}\`,
    \`- [ ] Platform-fit Δ in dollars (e.g. "$X.XM"): \${(m.execSummary || "").match(/\\\$[\\d.]+M/) ? "✓ found" : "✗ missing"}\`,
    \`- [ ] Rent sanity cited (SpareFoot or submarket rate): \${(m.execSummary + " " + (m.topRisks || []).join(" ")).match(/SpareFoot|submarket|implied rent/i) ? "✓ found" : "✗ missing"}\`,
    \`- [ ] No specific REIT operator named (PSA / EXR / CUBE / NSA / Welltower): \${!/PSA|Public Storage|Extra Space|CubeSmart|Welltower|Storage Inc|National Storage/i.test(JSON.stringify(m)) ? "✓ clean" : "✗ violation"}\`,
    "",
    "---",
    "",
    "## Raw JSON",
    "",
    "\\\`\\\`\\\`json",
    JSON.stringify(m, null, 2),
    "\\\`\\\`\\\`",
  ].join("\\n");
  fs.writeFileSync(outMd, md, "utf8");
}, 90000);
`;

fs.writeFileSync(renderTestPath, renderTest, "utf8");

const env = { ...process.env, STORVEX_MEMO_OUT_JSON: outJson, STORVEX_MEMO_OUT_MD: outMd, CI: "true" };
const child = spawn("npx", ["react-scripts", "test", "--testPathPattern=_verify-memo", "--watchAll=false", "--testTimeout=90000"], {
  stdio: "inherit",
  cwd: path.join(__dirname, ".."),
  env,
  shell: true,
});

child.on("exit", (code) => {
  try { fs.unlinkSync(renderTestPath); } catch {}
  if (code === 0) {
    console.log("\n✓ IC memo verification complete:");
    console.log("  Markdown: " + outMd);
    console.log("  Raw JSON: " + outJson);
  } else {
    console.error("\n✗ Verification failed — see output above.");
    process.exit(1);
  }
});
