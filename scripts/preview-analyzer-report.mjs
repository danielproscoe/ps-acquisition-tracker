// preview-analyzer-report.mjs — render a sample Storvex PS Asset Analyzer
// report against realistic Texas Store & Go calibration data, write to disk,
// and open in the system browser. Visual QC tool, not for production.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CRA's default Babel config compiles ES modules — for a node-side import
// of the React app's modules, easiest path is to copy minimal stubs and
// inline the report function. Instead, use a build helper: shell out to a
// jest-driven render so we use the same compile pipeline.

const renderTestPath = path.join(__dirname, "..", "src", "_preview-render.test.js");

const renderTest = `
// Auto-generated visual-QC render. NOT a real test — just leverages CRA's
// jest-Babel pipeline to invoke the report with sample data and write HTML
// to disk via process.env.STORVEX_REPORT_OUT.
import fs from "node:fs";
import { generateAnalyzerReport } from "./analyzerReport";
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

const enrichment = { coords: { lat: 33.1377, lng: -96.1097, score: 99.7 }, marketRents };
const memo = {
  recommendation: "PURSUE — bid into the $4.8–5.2M band; surface platform-integration math at LOI stage.",
  execSummary: "Co-LU 67K NRSF tertiary asset with $2.64M of platform-fit upside vs ask. Self-managed opex floor (24.86% of revenue per FY2025 10-K), 12% brand-premium revenue lift, and 24-month lease-up yield a Y3 stabilized NOI of $969K → Y5 $1.03M, supporting a $7.84M Walk at 6.00% stabilized cap. Generic third-party-managed institutional buyer underwrites the same asset at $3.43M Walk — the $4.41M Δ is the platform-fit moat.",
  bidPosture: "Open at $4.80M with 60-day diligence + $50K hard EM at expiration. Walk-away at $5.50M unless seller agrees to 24-month seller-financing on $1M of price (post-stabilization recapture).",
  topRisks: [
    "Co-LU lease-up risk — 33% occ today, requires 24-month absorption to hit Y3. Time-value-of-money haircut already applied.",
    "Tertiary-MSA storage MPI 112 (modestly above 100) — strong but not exceptional demand index.",
    "Operator-family proximity 28.4 mi to nearest district facility — outside the 5-mi portfolio-fit bonus zone.",
    "TX uncapped commercial reassessment is a known $105K/yr cost vs seller's understated tax line.",
  ],
  buyerRouting: "Storvex PS — secondary lens (institutional self-managed REIT). Strategic Alignment: deal sourcing velocity (off-market tertiary), AI-driven underwriting infusion (deterministic platform-integration math), transaction cycle compression.",
};

const analysis = analyzeExistingAsset(input, { marketRents });
const psLens = computeBuyerLens(input, PS_LENS, { marketRents });
const html = generateAnalyzerReport({ analysis, psLens, enrichment, memo });

const out = process.env.STORVEX_REPORT_OUT || "/tmp/storvex-report-preview.html";
fs.writeFileSync(out, html, "utf8");

test("render-only · wrote " + out, () => {
  expect(html.length).toBeGreaterThan(5000);
});
`;

fs.writeFileSync(renderTestPath, renderTest, "utf8");

const outPath = path.join(
  "C:",
  "Users",
  "danie",
  "OneDrive",
  "Desktop",
  "MASTER FOLDER - CLAUDE",
  "#2 - PS",
  "Storvex PS - Reza Mahdavian",
  "Storvex_PS_Sample_Report_Preview.html"
);

const env = { ...process.env, STORVEX_REPORT_OUT: outPath, CI: "true" };
// react-scripts wires up CRA's Babel preset (jsx + import/export). npx jest
// alone can't parse the ES modules.
const child = spawn("npx", ["react-scripts", "test", "--testPathPattern=_preview-render", "--watchAll=false"], {
  stdio: "inherit",
  cwd: path.join(__dirname, ".."),
  env,
  shell: true,
});

child.on("exit", (code) => {
  // Cleanup the auto-generated test file
  try { fs.unlinkSync(renderTestPath); } catch {}
  if (code === 0) {
    console.log("\n✓ Sample report written to:");
    console.log("  " + outPath);
    console.log("\nOpening in default browser...");
    const open = process.platform === "win32" ? spawn("cmd", ["/c", "start", "", outPath], { stdio: "inherit", shell: true })
      : process.platform === "darwin" ? spawn("open", [outPath])
      : spawn("xdg-open", [outPath]);
    open.on("exit", () => process.exit(0));
  } else {
    console.error("\n✗ Render failed — see jest output above.");
    process.exit(1);
  }
});
