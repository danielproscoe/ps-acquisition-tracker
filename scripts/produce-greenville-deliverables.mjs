// produce-greenville-deliverables.mjs — regenerate the Greenville
// Sample Report HTML + Sample Payload JSON against the current Storvex
// codebase. Greenville is the locked Reza demo site (existing-stabilized
// surface). Both artifacts need to reflect today's commits:
//
//   - analyzerReport.js cross-REIT historical render section (3242c9b)
//   - warehouseExport.js historical_cross_reit_same_store block (d013b87)
//   - EXR FY2020-FY2023 parser fix (01f498c)
//
// Pattern mirrors produce-sample-payload-v2.mjs + preview-analyzer-report.mjs.
// Writes a one-shot Jest helper that calls generateAnalyzerReport +
// buildWarehousePayload, ships the outputs to both the Reza folder root
// and the Demo Sites subfolder, auto-cleans the helper.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.join(__dirname, "..", "src", "_produce-greenville.test.js");

const REZA_FOLDER = path.join(
  "C:", "Users", "danie", "OneDrive", "Desktop",
  "MASTER FOLDER - CLAUDE", "#2 - PS", "Storvex PS - Reza Mahdavian"
);
const DEMO_GREENVILLE = path.join(REZA_FOLDER, "Demo Sites - May 2026", "01 - Greenville TX (Existing Stabilized)");

// Output paths — same artifact lands in both locations so root cover-set
// + demo subfolder stay in sync.
const ROOT_REPORT = path.join(REZA_FOLDER, "Storvex_PS_Sample_Report_Preview.html");
const ROOT_PAYLOAD = path.join(REZA_FOLDER, "Storvex_PS_Sample_Payload_v1.json");
const DEMO_REPORT = path.join(DEMO_GREENVILLE, "Greenville_Sample_Report_Preview.html");
const DEMO_PAYLOAD = path.join(DEMO_GREENVILLE, "Greenville_Sample_Payload.json");

const helper = `
// Auto-generated Greenville producer. Builds the Texas Store & Go calibration
// deal against the current Storvex pipeline and writes both the institutional
// HTML report and the warehouse JSON payload to the Reza folder.

import fs from "node:fs";
import path from "node:path";
import { generateAnalyzerReport } from "./analyzerReport";
import { analyzeExistingAsset } from "./existingAssetAnalysis";
import { computeBuyerLens, PS_LENS, computeAllBuyerLenses, computePlatformFitDelta } from "./buyerLensProfiles";
import { buildWarehousePayload } from "./warehouseExport";

// Texas Store & Go Greenville TX — the locked Reza demo deal.
// Matches the existing "⤓ Greenville" calibration loader in AssetAnalyzerView.
const input = {
  name: "Texas Store & Go (Greenville TX)",
  ask: 5200000,
  nrsf: 67000,
  unitCount: 520,
  yearBuilt: 2024,
  city: "Greenville",
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

const enrichment = {
  coords: { lat: 33.1377, lng: -96.1097, score: 99.7 },
  subjectMSA: null, // Greenville TX → "All other markets" catchall
  demographics: {
    pop1mi: 3480,
    pop3mi: 22140,
    pop5mi: 36280,
    income3mi: 62450,
    homeValue3mi: 218000,
    popGrowth3mi: 0.0207,
    incomeGrowth3mi: 0.0285,
    renterPct3mi: 0.31,
    popDensity3mi: 880,
    unemploymentRate3mi: 0.038,
    storageMPI3mi: 112,
    movedMPI3mi: 108,
  },
  psFamily: {
    distanceMi: 28.4,
    brand: "PS",
    name: "Public Storage \\u2014 Rockwall TX",
    city: "Rockwall",
    state: "TX",
    count35mi: 4,
  },
  marketRents,
};

const memo = {
  recommendation: "PURSUE \\u2014 institutional bid into the $4.8-5.2M band; surface platform-integration math at LOI stage.",
  execSummary: "Co-LU 67K NRSF tertiary asset offered at $5.2M. Self-managed REIT underwrite produces Y3 stabilized NOI of $969K, Y5 $1.03M, supporting a Walk of $7.84M at 6.00% stabilized cap. Generic third-party-managed institutional buyer underwrites the same asset at $3.43M Walk \\u2014 the platform-fit \\u0394 between the two lenses is the institutional advantage in cash. Cross-REIT FY2025 same-store revenue declined -0.2% YoY and NOI declined -1.4% YoY (averaged across EXR + CUBE + NSA primary-source MD&A) \\u2014 sector headwind that elevates submarket diligence as a top risk before commit.",
  bidPosture: "Open at $4.80M with 60-day diligence + $50K hard EM at expiration. Walk-away at $5.50M unless seller agrees to 24-month seller-financing on $1M of price (post-stabilization recapture).",
  topRisks: [
    "Co-LU lease-up risk \\u2014 33% physical occupancy today, requires 24-month absorption to hit Y3 stabilized 90% occupancy. Time-value-of-money haircut already applied to Y3 NOI projection.",
    "Cross-REIT FY2025 same-store revenue -0.2% YoY and NOI -1.4% YoY \\u2014 sector contraction signal averaged across EXR + CUBE + NSA primary-source MD&A. Deal team must surface Greenville-corridor permitted and under-construction supply before committing.",
    "Operator-family proximity 28.4 mi to nearest district facility \\u2014 outside the 5-mi portfolio-fit bonus zone. Cannibalization risk low but district integration synergies muted.",
  ],
  buyerRouting: "Storvex PS \\u2014 secondary lens (institutional self-managed REIT). Strategic alignment: deal sourcing velocity (off-market tertiary), AI-driven underwriting infusion (deterministic platform-integration math), transaction cycle compression.",
};

const analysis = analyzeExistingAsset(input, { marketRents });
const psLens = computeBuyerLens(input, PS_LENS, { marketRents });
const allLenses = computeAllBuyerLenses(input, { marketRents });
const platformFitDelta = computePlatformFitDelta(allLenses);
// computeAllBuyerLenses returns the canonical row shape the renderer +
// warehouseExport both expect. Pass directly — prior .map() stripped fields
// and corrupted the multi-buyer table. Hardcoded per Dan's directive
// 2026-05-12 after the Greenville UHAUL deliverable caught the bug.
const multiLensRows = allLenses;

const reportHtml = generateAnalyzerReport({
  analysis,
  psLens,
  enrichment,
  memo,
  multiLensRows,
  platformFitDelta,
  pitchTarget: "reza",
});

const extractionMeta = {
  confidence: "high",
  notes: "Texas Store & Go calibration \\u2014 Reza demo deal. Generated via produce-greenville-deliverables.mjs.",
  model: "claude-sonnet-4-6",
  elapsedMs: 14200,
  filename: "texas-store-go-greenville-tx-calibration.json",
};

const payload = buildWarehousePayload({
  analysis,
  psLens,
  enrichment,
  extractionMeta,
  multiLensRows,
  platformFitDelta,
  pitchTarget: "reza",
});

// Write to all four target paths
const targets = ${JSON.stringify([ROOT_REPORT, ROOT_PAYLOAD, DEMO_REPORT, DEMO_PAYLOAD])};
fs.writeFileSync(targets[0], reportHtml);
fs.writeFileSync(targets[1], JSON.stringify(payload, null, 2));
fs.writeFileSync(targets[2], reportHtml);
fs.writeFileSync(targets[3], JSON.stringify(payload, null, 2));

describe("Greenville producer", () => {
  test("report HTML contains cross-REIT historical section", () => {
    expect(reportHtml).toContain("CROSS-REIT HISTORICAL SAME-STORE");
    expect(reportHtml).toContain("PRIMARY-SOURCE SEC EDGAR");
  });
  test("payload contains historical_cross_reit_same_store block", () => {
    expect(payload.historical_cross_reit_same_store).not.toBeNull();
    expect(payload.historical_cross_reit_same_store.contributing_issuers).toContain("EXR");
  });
  test("payload schema is current v1.x", () => {
    expect(payload.schema).toBe("storvex.asset-analyzer.v1");
  });
  test("Greenville is NOT in PSA per-MSA disclosure (correct fallback)", () => {
    expect(payload.historical_msa_rent).toBeNull();
  });
  test("payload contains multi-lens comparison + platform-fit delta", () => {
    expect(payload.multi_lens_comparison).toBeTruthy();
    // Warehouse schema uses snake_case at this layer
    expect(payload.multi_lens_comparison.platform_fit_delta_dollars).toBeTruthy();
  });
  test("multi-lens rows have real takedown $ (regression guard for hardcoded clean tables)", () => {
    const lenses = payload.multi_lens_comparison.lenses;
    expect(Array.isArray(lenses)).toBe(true);
    expect(lenses.length).toBeGreaterThanOrEqual(2);
    // At least one row must have a real implied_takedown_price — guards
    // against the historical .map() bug that shipped all-dash IC tables.
    expect(lenses.some(l => Number.isFinite(l.implied_takedown_price) && l.implied_takedown_price > 0)).toBe(true);
  });
});
`;

fs.writeFileSync(helperPath, helper);

try {
  console.log("Generating Greenville deliverables (HTML report + JSON payload)...");
  await new Promise((resolve, reject) => {
    const child = spawn(
      "npm",
      ["test", "--", "--testPathPattern=_produce-greenville", "--watchAll=false"],
      {
        cwd: path.join(__dirname, ".."),
        stdio: "inherit",
        env: { ...process.env, CI: "true" },
        shell: true,
      }
    );
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`jest exited ${code}`))));
  });

  console.log("\n==== Greenville Deliverables ====");
  for (const target of [ROOT_REPORT, ROOT_PAYLOAD, DEMO_REPORT, DEMO_PAYLOAD]) {
    if (fs.existsSync(target)) {
      const size = fs.statSync(target).size;
      console.log(`  ${(size / 1024).toFixed(1)} KB - ${target.replace(process.env.HOME || "", "~")}`);
    }
  }

  // Spot-check the payload
  const payload = JSON.parse(fs.readFileSync(ROOT_PAYLOAD, "utf-8"));
  const h = payload.historical_cross_reit_same_store;
  console.log("\nPayload spot-check:");
  console.log(`  Schema: ${payload.schema}`);
  console.log(`  historical_msa_rent: ${payload.historical_msa_rent === null ? "null (correct - Greenville not in PSA per-MSA)" : "POPULATED (unexpected)"}`);
  console.log(`  historical_cross_reit_same_store: ${h ? `EXR + CUBE + NSA · FY${h.as_of} · rent $${h.cross_reit_avg_rent_per_sf}/SF` : "MISSING"}`);
  console.log(`  multi_lens_comparison: ${payload.multi_lens_comparison ? `✓ ${(payload.multi_lens_comparison.rows || []).length} buyer rows + platform-fit Δ` : "MISSING"}`);
  console.log(`  edgar_cross_reit: ${payload.edgar_cross_reit ? "✓ populated" : "null"}`);
} finally {
  if (fs.existsSync(helperPath)) fs.unlinkSync(helperPath);
}
