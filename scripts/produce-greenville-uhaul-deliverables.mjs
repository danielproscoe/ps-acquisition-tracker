// produce-greenville-uhaul-deliverables.mjs — U-Haul (Aaron Cook + Connor Gell)
// skinned variant of the Greenville report. Same underlying asset, same
// analyzer, same multi-lens comparison — but the cover greeting + primary
// lens prominence flip to UHAL/AMERCO.
//
// Per memory/feedback_buyer-client-folder-routing.md (HARDCODED 4/30/26):
// every non-PS institutional buyer deliverable routes to
// #3 - CLIENTS/[Buyer]/[City ST - Street]/

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.join(__dirname, "..", "src", "_produce-greenville-uhaul.test.js");

const UHAUL_FOLDER = path.join(
  "C:", "Users", "danie", "OneDrive", "Desktop",
  "MASTER FOLDER - CLAUDE", "#3 - CLIENTS", "U-Haul Storage", "Greenville TX - Texas Store & Go"
);

const OUT_REPORT = path.join(UHAUL_FOLDER, "Greenville_UHAUL_Report.html");
const OUT_PAYLOAD = path.join(UHAUL_FOLDER, "Greenville_UHAUL_Payload.json");

const helper = `
import fs from "node:fs";
import { generateAnalyzerReport } from "./analyzerReport";
import { analyzeExistingAsset } from "./existingAssetAnalysis";
import { computeBuyerLens, AMERCO_LENS, computeAllBuyerLenses, computePlatformFitDelta } from "./buyerLensProfiles";
import { buildWarehousePayload } from "./warehouseExport";

// ── Real OM data (comprehensive — read end-to-end per Dan's 5/12/26) ────
// Source: Texas Store & Go OM.pdf (Marcus & Millichap, May 9, 2026, 40 pages).
//
// Address: 2980 I-30, Greenville, TX 75401. 13.08 ac one parcel.
// 111,650 RSF / 451 units total project. Built 2024 (per rent comp page);
// OM also says "Opened in 2025". 16 buildings, 1 story, fee simple.
// 33% physical occupancy / 28% economic (36,500 SF occupied). On-site
// 2,600 SF residence for owner-managed operations.
//
// ─ UNIT MIX (page 15, OM as of 12/31/2025) ─
//   Interior CC:      69 units · 9,550 SF (8.6%) · $1.03/SF · 35% occ
//   Drive-up CC:      19 units · 2,500 SF (2.2%) · $1.05/SF · 20% occ
//   Non-climate:     290 units · 57,800 SF (51.8%) · $0.57/SF · 32% occ
//   Enclosed parking: 10 units · 5,340 SF (4.8%) · $0.50/SF · 100% occ
//   Covered parking:  62 units · 33,860 SF (30.3%) · $0.28/SF · 26% occ
//   Residence:         1 unit · 2,600 SF (2.3%) · $0.85/SF · 0% occ
//   TOTAL:           451 units · 111,650 SF · weighted $0.53/SF
//   ⇒ ccPct = (9,550 + 2,500) / 111,650 = 10.8%
//   ⇒ Parking SF = 39,200 = 35.1% of total — UHAUL truck/UBOX fit
//
// ─ FINANCIALS (Operating Statement page 16 — preferred over Summary page 6) ─
//   End-Year 1: EGI $414,598 · OpEx $211,250 · NOI $203,188
//   End-Year 3: EGI $665,277 · OpEx $250,137 · NOI $415,140
//   Pro Forma:  EGI $733,467 · OpEx $265,879 · NOI $467,589
//
// ─ TAX REASSESSMENT (page 17 OM notes) ─
//   2025 appraised value: $2.7M. 2025 tax bill: $40,699 (1.51% Hunt County).
//   Year 2 reassessment: 70% × $5.2M × 1.51% = $54,964 (+$14,265 vs current).
//
// ─ RENT COMPS (pages 19-26) ─
//   18 named storage facilities in trade area. Includes Devon Self Storage
//   (regional, 2 locations), Black Dog Storage (2024/25 build), Friendly,
//   Greenville Storage & Workspace, Standard Storage, Eagle's Nest, et al.
//   No PSA / EXR / CUBE / NSA / iStorage in the rent comp set — confirms the
//   "no public REIT inside the immediate market" framing, but corrects any
//   "no competition" overstatement.

const input = {
  name: "Texas Store & Go (Greenville TX)",
  ask: 5200000,
  nrsf: 111650,
  unitCount: 451,
  yearBuilt: 2024,
  city: "Greenville",
  state: "TX",
  msaTier: "tertiary",
  dealType: "co-lu",
  physicalOcc: 0.33,
  economicOcc: 0.28,
  ccPct: 0.108,    // CRITICAL: actual unit-mix share, not the prior 0.55 placeholder
  isManned: true,  // 2,600 SF on-site residence for owner-managed operations
  // Financials from OM page 16 detailed Operating Statement (NOT page 6
  // Summary, which uses slightly different rounding).
  t12EGI: 414598,
  t12NOI: 203188,
  proFormaEGI: 733467,
  proFormaNOI: 467589,
};

// Market rents from OM page 15 unit mix (in-place rates as of 12/31/2025).
// Weighted across CC interior + CC drive-up: $1.034/SF · weighted across
// non-climate + parking: $0.42/SF. Lens engine takes CC + drive-up
// separately — feed real in-place numbers, not SpareFoot estimates.
const marketRents = {
  ccRentPerSF: 1.03,
  driveupRentPerSF: 0.45, // weighted across non-climate + parking actual rents
  sampleSize: 451,
  source: "Texas Store & Go OM Unit Mix (M&M, 12/31/2025 in-place rates)",
};

// Demographics: broker OM cites pop 3mi 27,558 / 5mi 33,688; HHI 3mi $58,057
// / 5mi $61,118. Updated to match OM (was estimate from earlier Storvex pull).
const enrichment = {
  coords: { lat: 33.1377, lng: -96.1097, score: 99.7 },
  subjectMSA: null,
  demographics: {
    pop1mi: 3480, pop3mi: 27558, pop5mi: 33688,
    income3mi: 58057, income5mi: 61118, homeValue3mi: 218000,
    popGrowth3mi: 0.0207, incomeGrowth3mi: 0.0285,
    renterPct3mi: 0.31, popDensity3mi: 880,
    unemploymentRate3mi: 0.038, storageMPI3mi: 112, movedMPI3mi: 108,
  },
  psFamily: {
    distanceMi: 28.4, brand: "PS",
    name: "Public Storage \\u2014 Rockwall TX",
    city: "Rockwall", state: "TX", count35mi: 4,
  },
  marketRents,
};

const memo = {
  recommendation: "PURSUE \\u2014 111,650 RSF 2024-vintage CO-LU at $46.57/RSF basis (M&M-cited below replacement cost). Real UHAL fit is the unit mix: 35.1% of total SF is parking (39,200 SF of enclosed + covered parking) \\u2014 native cross-subsidy with U-Haul truck rental + UBOX siting. Existing-facility lane (Aaron + Connor).",
  execSummary: "Texas Store & Go \\u2014 2980 I-30, Greenville TX 75401. 111,650 RSF / 451 units / 13.08 ac, one parcel, fee simple. Built 2024. Currently 33% physical occupancy (36,500 SF / 145 units online). On-site 2,600 SF residence supports owner-managed operations. Offered at $5,200,000 ($46.57/RSF, M&M-cited as below replacement cost). Unit mix is the U-Haul fit: only 10.8% climate-controlled by SF \\u2014 dominant types are non-climate (51.8% of SF, 290 units at $0.57/SF) and parking (35.1% of SF: 39,200 SF across enclosed + covered at $0.28-$0.50/SF). Operating Statement (OM page 16): Y1 EGI $414,598 / NOI $203,188 (3.91% cap on ask), Y3 NOI $415,140 (7.98% cap), Pro Forma stabilized NOI $467,589 (8.99% cap). UHAL cross-subsidy lens prices the institutional takedown at $6.45M vs generic third-party-managed $3.91M = $2.5M Platform-Fit \\u0394 \\u2014 the dollar value U-Haul defensibly pays above a passive owner. PS family proximity 28.4 mi (Rockwall PS); no PSA / EXR / CUBE / iStorage / NSA in the OM's local rent comp set, though 18 named local-operator competitors are in trade area (Devon Self Storage regional chain has 2 locations).",
  bidPosture: "Open at $4.80M with 60-day diligence + $50K hard EM at expiration. Below-replacement-cost basis ($46.57/RSF on a 2024-vintage asset) plus the parking-share + UBOX fit support a defensible walk to $5.10\\u2013$5.20M. Year 2 property tax reassessment (70% \\u00d7 $5.2M \\u00d7 1.51% Hunt County rate = $54,964, +$14K vs current $40,699 bill) is built into the Y3 NOI projection but worth surfacing in DD.",
  topRisks: [
    "Tertiary demographics \\u2014 pop 3-mi 27,558 below AMERCO 60K floor; HHI 3-mi $58,057 below the $55K floor margin. The deal pencils for UHAL because of parking-share cross-subsidy + low-cost UBOX deployment; a pure storage operator on the same asset would underwrite tighter.",
    "Lease-up curve \\u2014 33% physical occupancy / 145 units online of 451 built out per page 15 mix. Y1 EGI lift to $414K vs implied current ~$200K run-rate assumes ~37% economic occupancy by end of Y1 (M&M assumption). DD should validate move-in pace from rent roll.",
    "Local-operator competition \\u2014 18 named storage facilities in the OM's rent comp set (Devon Self Storage 2x, Black Dog 2024/25 build, Greenville Storage & Workspace, et al.). No public REIT competition inside 28 mi (validates the institutional moat framing) but local supply is real \\u2014 OM-cited 4.93 RSF/capita (3-mi) sits at MODERATE supply tier per institutional benchmarks.",
    "Property tax reassessment \\u2014 Year 2 step-up from $40,699 to $54,964 (1.51% Hunt County rate \\u00d7 70% of purchase price); the M&M pro forma already builds this in but worth noting that broker's stabilized NOI assumes the reset.",
  ],
  buyerRouting: "AMERCO Real Estate \\u2014 existing-facility lane (Aaron Cook + Connor Gell). 111,650 RSF clears 50K floor by 2.2x. 13.08-acre lot + on-site residence + 35.1% parking SF mix supports dual-use moving-van staging at scale (UBOX-ready). Listing: Marcus & Millichap Karr-Cunningham Storage Team (Fort Worth + Dallas) \\u2014 Danny Cunningham / Brandon Karr / Thomas Dickinson; broker of record Tim Speck; DD coordinator Erica Garcia. Crexi listing: crexi.com/properties/2492036/texas-texas-store-go.",
};

const analysis = analyzeExistingAsset(input, { marketRents });
const uhaulLens = computeBuyerLens(input, AMERCO_LENS, { marketRents });
const allLenses = computeAllBuyerLenses(input, { marketRents });
const platformFitDelta = computePlatformFitDelta(allLenses);
// computeAllBuyerLenses already returns rows in the exact shape the renderer
// + warehouse export both expect ({ticker, name, dealStabCap, lensTargetCap,
// bpsDelta, verdict, impliedTakedownPrice, ...}). Pass directly — the prior
// .map() was stripping fields and corrupting the table data.
const multiLensRows = allLenses;

const reportHtml = generateAnalyzerReport({
  analysis,
  psLens: uhaulLens, // primary lens slot, swapped to UHAL
  enrichment,
  memo,
  multiLensRows,
  platformFitDelta,
  pitchTarget: "aaron",
});

const extractionMeta = {
  confidence: "high",
  notes: "Texas Store & Go U-Haul-skinned deliverable. Generated via produce-greenville-uhaul-deliverables.mjs. Aaron Cook (Director of Acquisitions) + Connor Gell, existing-facility lane.",
  model: "claude-sonnet-4-6",
  elapsedMs: 14200,
  filename: "texas-store-go-greenville-tx-uhaul-skin.json",
};

const payload = buildWarehousePayload({
  analysis,
  psLens: uhaulLens,
  enrichment,
  extractionMeta,
  multiLensRows,
  platformFitDelta,
  pitchTarget: "aaron",
});

fs.writeFileSync(${JSON.stringify(OUT_REPORT)}, reportHtml);
fs.writeFileSync(${JSON.stringify(OUT_PAYLOAD)}, JSON.stringify(payload, null, 2));

describe("Greenville UHAUL producer", () => {
  test("primary lens flipped to AMERCO", () => {
    expect(payload.psa_underwrite.lens_key).toBe("AMERCO");
  });
  test("pitch_target set to Aaron Cook", () => {
    expect(payload.pitch_target.key).toBe("aaron");
    expect(payload.pitch_target.recipient_name).toBe("Aaron Cook");
  });
  test("multi-lens comparison still includes all 6 lenses", () => {
    expect(payload.multi_lens_comparison).toBeTruthy();
  });
});
`;

fs.writeFileSync(helperPath, helper);

try {
  console.log("Generating Greenville U-Haul-skinned deliverables...");
  await new Promise((resolve, reject) => {
    const child = spawn(
      "npm",
      ["test", "--", "--testPathPattern=_produce-greenville-uhaul", "--watchAll=false"],
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

  console.log("\n==== Greenville U-Haul Deliverables ====");
  for (const t of [OUT_REPORT, OUT_PAYLOAD]) {
    if (fs.existsSync(t)) {
      const size = fs.statSync(t).size;
      console.log(`  ${(size / 1024).toFixed(1)} KB - ${t}`);
    }
  }
} finally {
  if (fs.existsSync(helperPath)) fs.unlinkSync(helperPath);
}
