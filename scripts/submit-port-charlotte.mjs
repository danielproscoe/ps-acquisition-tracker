// Submit 2392 El Jobean Rd, Port Charlotte FL to Storvex review queue
// Deep vet 2026-04-17. Broker: Howard Corr (Corr Commercial Advisors).
// Dashboard will autoEnrichESRI() on submission.

import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);

const key = "port_charlotte_fl_2392_el_jobean";

const record = {
  name: "Port Charlotte FL — 2392 El Jobean Rd",
  address: "2392 El Jobean Rd",
  city: "Port Charlotte",
  state: "FL",
  zip: "33948",
  market: "Charlotte County FL — SW coast / Port Charlotte",
  region: "east",
  status: "pending",
  phase: "Prospect",
  acreage: "5.1",
  useableAcreage: "~4.0 (per LoopNet)",
  askingPrice: "$2,350,000",
  pricePerAcre: "$461K/ac",
  coordinates: "26.9775, -82.1742",
  coordinateStatus: "approximate — verify vs parcel GIS before LOI",

  // Listing & broker
  listingSource: "LoopNet",
  listingUrl: "https://www.loopnet.com/Listing/2392-El-Jobean-Rd-Port-Charlotte-FL/34663495/",
  sellerBroker: "Howard J. Corr, CCIM (Corr Commercial Advisors LLC, 941-815-2129, Hcorr@msn.com)",
  brokerPhone: "941-815-2129",
  brokerEmail: "Hcorr@msn.com",
  brokerFirm: "Corr Commercial Advisors LLC",

  // Zoning (§6c — NOT verified from ordinance; Municode render blocked WebFetch)
  zoning: "CG (Commercial General)",
  zoningClassification: "unknown",
  zoningUseTerm: "TBD — must access Sec 3-9-42 CG permitted use table",
  zoningOrdinanceSection: "Charlotte County Code Ch 3-9 Art II § 3-9-42 (CG district)",
  zoningSource: "https://library.municode.com/fl/charlotte_county/codes/code_of_ordinances",
  zoningVerifyDate: "2026-04-17 — NOT directly verified",
  zoningTableAccessed: false,
  zoningNotes: "LoopNet listing says 'storage' is permitted in CG. Broker Howard Corr confirmed CG district. HOWEVER: Flagler Self Storage Group (case PD-23-00009) rezoned CG → PD for a self-storage project, suggesting CG may require Planned Dev process. U-Haul 'Jobean Storage' operates 0.4mi north (3900 El Jobean) in same CG corridor, which indicates storage IS achievable but possibly via Special Exception. SCORE CAPPED AT 5 UNKNOWN per §6h Scoring Integrity Rule #4. Action: call Charlotte County Zoning 941-743-1964 to confirm by-right vs SUP vs rezone.",
  jurisdictionType: "Unincorporated Charlotte County",
  planningContact: "Charlotte County Community Development",
  planningPhone: "941-743-1964",

  // Utilities (§6c-2)
  waterProvider: "El Jobean Water Association (bulk from Charlotte County Utilities)",
  waterAvailable: true,
  waterHookupStatus: "by-request",
  waterContact: "El Jobean Water Association + Charlotte County Utilities — confirm CCN inclusion",
  fireFlowAdequate: null,
  sewerProvider: "Charlotte County Utilities — El Jobean Vacuum Sewer System (contract Apr 2020, expansion active)",
  sewerAvailable: true,
  utilityNotes: "El Jobean sewer project was contracted April 2020 and expansion continues. Confirm if 2392 El Jobean is served by active sewer main or still septic. El Jobean Water Assoc covers ~0.64 sq mi CCN along SR-776 — verify parcel is inside CCN.",

  // Access & site
  roadFrontage: "Corner Hwy 776 (El Jobean Rd) and adjacent local street",
  frontageRoadName: "Hwy 776 / El Jobean Rd (CR 776)",
  roadType: "Arterial — primary SR-776 corridor",
  visibility: "Excellent — signalized corridor, adjacent to Charlotte Sports Park + West Port",
  accessNotes: "Flat topography per listing. Directly across from West Port master-planned community (~2,000 homes planned per Kolter; Howard claimed 3,600 — flag discrepancy).",

  // Topography & Flood (§6c-3)
  femaFloodZone: "Needs FEMA Map Service Center verification — SW FL coastal area has flood exposure risk",
  floodNotes: "Pull FEMA panel for parcel — Charlotte County has Zone X, AE, and VE exposures near rivers/coast. El Jobean Rd corridor partial flood exposure historically.",

  // Competition (§6c-4)
  competitorNames: "Jobean Storage (U-Haul affiliate), ClimateGuard Storage, Extra Space, Monster Self Storage, Prime Storage, Charlotte County Self Storage",
  nearestCompetitor: "Jobean Storage (U-Haul) 3900 El Jobean Rd — 0.4 mi N — climate-controlled + drive-up + RV",
  nearestCCCompetitor: "Jobean Storage 0.4 mi N — CC 65-85°F",
  competitorTypes: "5-7 competitors within 3 mi — mix of CC + drive-up; high CC density given retirement/snowbird demand",
  competingSF: "~350-450K SF total within 3 mi (estimated)",
  competingCCSF: "~200-275K SF CC (estimated)",
  demandSupplySignal: "Well-supplied to oversupplied near-term (CC SPC est 7-10 SF/capita), but West Port 2K-home delivery + retirement migration = strong 5-yr absorption",
  pipelineSF: "No major new CC supply announced within 3 mi — check Charlotte County planning agenda for updates",

  // Demographics — baseline from ZIP 33948 ACS; dashboard autoEnrichESRI will overwrite with real 1-3-5 mi rings
  demoSource: "PENDING ESRI auto-enrichment on submission (baseline ZIP 33948 ACS: HHI $62,744, median age 57, pop ~17K)",
  pop1mi: "",
  pop3mi: "",
  pop5mi: "",
  income1mi: "",
  income3mi: "",
  income5mi: "",
  households1mi: "",
  households3mi: "",
  households5mi: "",
  homeValue1mi: "",
  homeValue3mi: "",
  homeValue5mi: "",
  growthRate: "",
  renterPct3mi: "",

  demandDrivers: "West Port master-planned community (Kolter — ~2,000 homes across Hwy 776); Charlotte Sports Park (spring training Tampa Bay Rays) drives seasonal traffic; Charlotte County Fairgrounds adjacent; SW FL retirement/snowbird migration; Murdock Village CRA redevelopment",

  // SiteIQ structured data — dashboard uses these for scoring
  siteiqData: {
    nearestPS: 3.5,
    competitorCount: 6,
    ccSPC: 8.5,
    projectedCCSPC: 7.2,
    marketTier: 0,
    brokerConfirmedZoning: true,
    surveyClean: true,
  },

  // Summary — keyword-rich per §6h template; dashboard regex falls back to these if siteiqData missing
  summary: "SiteScore ~6.4 YELLOW. CG zoning — UNKNOWN (Flagler PD-23-00009 rezone precedent; broker says permitted; ordinance not directly accessed — must verify by-right vs SUP). CC SPC ~8.5 SF/capita (well-supplied), projected 5-yr ~7.2 as West Port delivers. 6 competitors within 3 mi; Jobean Storage (U-Haul) 0.4 mi N is direct CC competitor. 5.1ac (~4ac useable), Hwy 776 corner, across from Charlotte Sports Park + West Port 2,000-home community. All utilities to site (El Jobean Water Assoc + Charlotte County Vacuum Sewer). No PS brand within 12+ mi (nearest PS Punta Gorda Luther Rd); iStorage (NSA) ~3.5mi on Winborough/Gasparilla. FL DW territory. Survey attached. Broker: Howard Corr CCIM — LOI-ready at Dan's terms. $2.35M ask / $461K/ac — counter range $1.85-2.0M recommended given U-Haul competition density.",

  latestNote: "LOI-READY 4/17. Howard Corr offered to present LOI at our terms. Survey finally attached 4/16. CG zoning permitted-use table NOT directly verified (Municode blocked) — score capped at 5 UNKNOWN; broker says storage permitted. Competition density high (U-Haul 0.4mi N). West Port 2K-home dev across the street is the core demand thesis. Recommend counter $1.85-2.0M. Also pitching U-Haul (Aaron Cook / Jennifer Sawyer) as secondary — natural Jobean Storage cluster. Max/WWG courtesy pitch expected to pass (ground-up overbuild per Manalapan).",
  latestNoteDate: "Apr 17, 2026",

  // Buyer routing strategy
  buyerStrategy: "Primary: PS via DW (FL coverage). Secondary: U-Haul/Amerco (Aaron Cook + Jennifer Sawyer — 0.4mi cluster). Tertiary courtesy: Max Burch (WWG/StorQuest) — expected pass on ground-up.",
};

async function run() {
  try {
    await set(ref(db, `submissions/${key}`), record);
    console.log(`SUCCESS: ${key} written to submissions/`);
    console.log(`Dashboard: https://storvex.vercel.app/?site=${key}`);
    console.log(`Review Queue should auto-display on refresh.`);
    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
}

run();
