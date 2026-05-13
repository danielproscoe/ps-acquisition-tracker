// produce-sample-payload-v2.mjs — regenerate Reza-facing sample warehouse
// payload anchored to Houston (PSA-disclosed MSA) so the new
// historical_msa_rent block lands in the Reza folder.
//
// Pattern matches preview-analyzer-report.mjs: write a tiny Jest helper,
// shell out to npm test which loads it through CRA's babel pipeline (handles
// the JSON imports + module resolution that Node can't do natively for
// React-side .js files), then surface the saved payload + a brief summary.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.join(__dirname, "..", "src", "_produce-payload.test.js");
const outDir = path.join(
  "C:", "Users", "danie", "OneDrive", "Desktop",
  "MASTER FOLDER - CLAUDE", "#2 - PS", "Storvex PS - Reza Mahdavian"
);
const outFile = path.join(outDir, "Storvex_PS_Sample_Payload_v2.json");

const helper = `
// Auto-generated payload producer. Calls buildWarehousePayload on a
// Houston-anchored synthetic calibration deal so the historical_msa_rent
// block surfaces in the saved JSON. Output path is the Reza folder.
import fs from "node:fs";
import path from "node:path";
import { buildWarehousePayload } from "./warehouseExport";
import { analyzeExistingAsset } from "./existingAssetAnalysis";
import { computeBuyerLens, PS_LENS } from "./buyerLensProfiles";
import { computeAllBuyerLenses, computePlatformFitDelta } from "./buyerLensProfiles";

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

const generic = analyzeExistingAsset(input, { marketRents });
const psLens = computeBuyerLens(input, PS_LENS, { marketRents });

const enrichment = {
  coords: { lat: 29.76, lng: -95.36 },
  subjectMSA: "Houston",
  demographics: {
    pop1mi: 11400,
    pop3mi: 85200,
    pop5mi: 214500,
    income3mi: 72400,
    homeValue3mi: 285000,
    popGrowth3mi: 0.018,
    incomeGrowth3mi: 0.024,
    renterPct3mi: 0.42,
    popDensity3mi: 3040,
    unemploymentRate3mi: 0.041,
    storageMPI3mi: 108,
    movedMPI3mi: 115,
  },
  psFamily: {
    distanceMi: 3.2,
    brand: "PS",
    name: "Public Storage — Houston Westchase",
    city: "Houston",
    state: "TX",
    count35mi: 28,
  },
  marketRents,
  competitors: [],
};

const extractionMeta = {
  confidence: "high",
  notes: "Synthetic calibration deal — not a live OM. Generated as Reza-facing sample illustrating the historical_msa_rent payload block.",
  model: "claude-sonnet-4-6",
  elapsedMs: 14200,
  filename: "houston-westchase-sample-calibration.json",
};

const allLenses = computeAllBuyerLenses(input, { marketRents });
const platformFitDelta = computePlatformFitDelta(allLenses);
// computeAllBuyerLenses returns the canonical row shape the renderer +
// warehouseExport both expect. Pass directly — prior .map() stripped fields
// and corrupted the multi-buyer table. Hardcoded per Dan's directive
// 2026-05-12 after the Greenville UHAUL deliverable caught the bug.
const multiLensRows = allLenses;

const payload = buildWarehousePayload({
  analysis: generic,
  psLens,
  enrichment,
  extractionMeta,
  multiLensRows,
  platformFitDelta,
  pitchTarget: "reza",
});

const outPath = ${JSON.stringify(outFile)};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

// Summary assertions so the producer surfaces a clean signal in test output
describe("produce sample payload v2", () => {
  test("payload writes to Reza folder", () => {
    expect(fs.existsSync(outPath)).toBe(true);
  });
  test("payload contains historical_msa_rent block for Houston", () => {
    expect(payload.historical_msa_rent).not.toBeNull();
    expect(payload.historical_msa_rent.msa).toBe("Houston");
    expect(payload.historical_msa_rent.issuer).toBe("PSA");
    expect(payload.historical_msa_rent.cagr_pct).toBeGreaterThan(4);
  });
  test("payload schema name is set", () => {
    expect(payload.schema).toBe("storvex.asset-analyzer.v1");
  });
});
`;

fs.writeFileSync(helperPath, helper);

try {
  console.log(`Generating Houston-anchored sample payload → ${outFile}`);
  await new Promise((resolve, reject) => {
    const child = spawn(
      "npm",
      ["test", "--", "--testPathPattern=_produce-payload", "--watchAll=false"],
      {
        cwd: path.join(__dirname, ".."),
        stdio: "inherit",
        env: { ...process.env, CI: "true" },
        shell: true, // Windows spawn requires shell:true for .cmd shims
      }
    );
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`jest exited ${code}`))));
  });

  // Inspect the produced payload
  const raw = fs.readFileSync(outFile, "utf-8");
  const payload = JSON.parse(raw);
  const h = payload.historical_msa_rent;
  console.log(`\n──── Sample payload v2 produced ────`);
  console.log(`File: ${outFile}`);
  console.log(`Size: ${(raw.length / 1024).toFixed(1)} KB`);
  console.log(`Schema: ${payload.schema}`);
  console.log(`Subject: ${payload.subject?.name || payload.subject?.deal_name || "(unknown)"}`);
  console.log(`Historical MSA: ${h ? `${h.issuer} · ${h.msa} · FY${h.first_year}-FY${h.last_year} · CAGR ${h.cagr_pct?.toFixed(2)}%/yr` : "(null)"}`);
  if (h) {
    console.log(`  First-year rent (FY${h.first_year}): $${h.first_rent_per_occ_sf?.toFixed(2)}/SF/yr`);
    console.log(`  Last-year rent  (FY${h.last_year}): $${h.last_rent_per_occ_sf?.toFixed(2)}/SF/yr`);
    console.log(`  Series years:    ${h.years_covered}`);
    console.log(`  YoY most-recent: ${h.most_recent_yoy_change_pct?.toFixed(2)}%`);
  }
} finally {
  // Always remove the helper test file so it doesn't pollute future CI runs
  if (fs.existsSync(helperPath)) {
    fs.unlinkSync(helperPath);
  }
}
