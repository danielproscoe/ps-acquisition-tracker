// preview-analyzer-report-houston.mjs — Houston Westchase Sample Report
// (the second Reza-folder lead artifact). Mirrors preview-analyzer-report.mjs
// but anchored to a PSA-disclosed MSA so the new PSA HISTORICAL RENT section
// renders inline. Outputs `Storvex_PS_Sample_Report_Houston_v2.html` to the
// Reza folder.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const renderTestPath = path.join(__dirname, "..", "src", "_preview-render-houston.test.js");

const renderTest = `
// Auto-generated Houston Sample Report render. Uses Houston Westchase
// synthetic stabilized calibration so the historical MSA rent section
// (FY2021-FY2025 PSA same-store CAGR) lands inline.

import fs from "node:fs";
import { generateAnalyzerReport } from "./analyzerReport";
import { analyzeExistingAsset } from "./existingAssetAnalysis";
import { computeBuyerLens, PS_LENS } from "./buyerLensProfiles";

const input = {
  name: "Houston Westchase — Sample Stabilized Calibration",
  ask: 12500000,
  nrsf: 78000,
  unitCount: 620,
  yearBuilt: 2019,
  city: "Houston",
  state: "TX",
  msaTier: "primary",
  dealType: "stabilized",
  physicalOcc: 0.88,
  economicOcc: 0.85,
  ccPct: 0.72,
  isManned: false,
  t12EGI: 1180000,
  t12NOI: 891000,
  proFormaEGI: 0,
  proFormaNOI: 0,
};

const marketRents = {
  ccRentPerSF: 1.35,
  driveupRentPerSF: 0.72,
  sampleSize: 18,
  source: "SpareFoot",
};

const enrichment = {
  coords: { lat: 29.76, lng: -95.36, score: 100 },
  subjectMSA: "Houston",
  demographics: {
    pop1mi: 11400, pop3mi: 85200, pop5mi: 214500,
    income3mi: 72400, homeValue3mi: 285000,
    popGrowth3mi: 0.018, incomeGrowth3mi: 0.024,
    renterPct3mi: 0.42, popDensity3mi: 3040,
    unemploymentRate3mi: 0.041, storageMPI3mi: 108, movedMPI3mi: 115,
  },
  psFamily: {
    distanceMi: 3.2, brand: "PS",
    name: "Public Storage — Houston Westchase",
    city: "Houston", state: "TX", count35mi: 28,
  },
  marketRents,
};

const memo = {
  recommendation: "PURSUE — open at Strike ($13.6M), do not cross Walk ($12.4M institutional / $11.3M generic).",
  execSummary: "**Houston Westchase Sample** — 78,000 NRSF / 620 units / 2019-vintage stabilized asset in Houston primary MSA at **$12.5M ($160/SF)**. Institutional underwrite yields **Y1 NOI $891K @ 7.13% buyer cap** (opex floored at 21.6% via central-staffing platform + 12% brand-premium revenue lift). Institutional Walk **$12.4M**; generic third-party-managed buyer Walk **$11.3M** → **$1.1M platform-fit Δ**. PSA-disclosed Houston same-store rent compounded at **5.52%/yr** over FY2021-FY2025 (FY2021 $13.69 → FY2025 $16.97 per occupied SF) — institutional-grade tailwind support. **PURSUE** at Strike ($13.6M).",
  bidPosture: "Open at $13.6M (Strike — 6.55% Y3 cap). Walk hard at $12.4M (Y3 NOI / 7.46% institutional entry). Asset is 2019-vintage, 88% physical / 85% economic occupancy — no lease-up haircut required.",
  topRisks: [
    "**PSA-disclosed Houston same-store deceleration:** FY2024 $16.96 → FY2025 $16.97 per occupied SF = 0.06% YoY after a 5.52%/yr CAGR from FY2021. Deceleration at high-base rent in a primary-MSA Texas market is a classic pre-saturation signal — IC deal team must surface Westchase-area permitted + under-construction supply pipeline before committing.",
    "Operator-family district density: 28 facilities within 35 mi, nearest comparable 3.2 mi — portfolio-fit cap bonus is triggered, but submarket competition is mature.",
    "Economic occupancy gap: physical 88% vs economic 85% implies ~300 bps bad-debt/concession drag (~$36K/yr at $1.18M institutional EGI). Verify seller's concession schedule and bad-debt reserve in diligence.",
  ],
  buyerRouting: "A self-managed REIT is the natural buyer at $12.4M or below — the $1.1M platform-fit Δ (institutional Walk minus generic Walk) is exclusively accessible to a platform with centralized staffing, brand-premium revenue execution, and 28-facility district presence enabling overhead consolidation.",
};

const analysis = analyzeExistingAsset(input, { marketRents });
const psLens = computeBuyerLens(input, PS_LENS, { marketRents });
const html = generateAnalyzerReport({ analysis, psLens, enrichment, memo });

const out = process.env.STORVEX_REPORT_OUT || "/tmp/storvex-report-houston.html";
fs.writeFileSync(out, html, "utf8");

test("render-only · wrote " + out, () => {
  expect(html.length).toBeGreaterThan(5000);
  expect(html).toContain("PSA HISTORICAL RENT");
  expect(html).toContain("HOUSTON");
  expect(html).toContain("FY2021");
  expect(html).toContain("FY2025");
});
`;

fs.writeFileSync(renderTestPath, renderTest, "utf8");

const outPath = path.join(
  "C:", "Users", "danie", "OneDrive", "Desktop",
  "MASTER FOLDER - CLAUDE", "#2 - PS", "Storvex PS - Reza Mahdavian",
  "Storvex_PS_Sample_Report_Houston_v2.html"
);

const env = { ...process.env, STORVEX_REPORT_OUT: outPath, CI: "true" };
const child = spawn(
  "npx",
  ["react-scripts", "test", "--testPathPattern=_preview-render-houston", "--watchAll=false"],
  {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
    env,
    shell: true,
  }
);

child.on("exit", (code) => {
  try { fs.unlinkSync(renderTestPath); } catch {}
  if (code === 0) {
    console.log("\n✓ Houston Sample Report written to:");
    console.log("  " + outPath);
    const size = fs.statSync(outPath).size;
    console.log(`  Size: ${(size / 1024).toFixed(1)} KB`);
    process.exit(0);
  } else {
    console.error("\n✗ Render failed — see jest output above.");
    process.exit(1);
  }
});
