// Submit Spencer MA — 369 East Main St fully permitted storage dev site
// Vet date: 2026-04-21
// ⚠️ CRITICAL FINDING: No municipal water/sewer. Well + septic + 2 fire cisterns (Fire Chief req).
// Kills institutional REIT fit (PS/EXR/CUBE/SmartStop all need municipal fire flow).

import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);

const key = "spencer_ma_369_east_main_st";

const record = {
  name: "Spencer MA \u2014 369 East Main Street",
  address: "369 East Main Street",
  city: "Spencer",
  state: "MA",
  zip: "01562",
  market: "Worcester MSA \u2014 exurban Central MA / Route 9 corridor",
  region: "east",
  status: "pending",
  phase: "Prospect",
  acreage: "15.89 net / 16.48 gross",
  useableAcreage: "15.89 (development footprint per approved plans; 16.48 total incl. Phase II Building B land)",
  askingPrice: "$2,500,000",
  pricePerAcre: "$151K/ac",
  coordinates: "42.2448, -71.9595",
  coordinateStatus: "approximate \u2014 E Main St \u00d7 Donnelly Rd intersection estimate; verify via Spencer MapGeo (spencerma.mapgeo.io) parcel R35-1-3 before final underwrite",
  parcelNumber: "R35-1-3",

  // Listing & broker
  listingSource: "LoopNet + Crexi (Argus / NAI Norwood)",
  listingUrl: "https://www.loopnet.com/Listing/Fully-Permitted-Development-Site-Spencer-MA/40133140/",
  listingUrlAlt: "https://www.crexi.com/properties/2456508/massachusetts-spencer-ma-self-storage-development-site",
  sellerBroker: "Jessie Gilton + Nathan Beliveau-Robinson (NAI Norwood Group / Argus Self Storage Advisors NE Division)",
  brokerFirm: "NAI Norwood Group | Argus Self Storage Advisors",
  brokerEmail: "jessie@nainorwoodgroup.com, nathan@nainorwoodgroup.com",
  brokerPhone: "617-820-8443 (Jessie cell) | 603-431-3001 x228 (Jessie direct) | 603-668-7000 (Nathan)",
  brokerAddress: "2 Greenleaf Woods Dr, Suite 301, Portsmouth NH 03801",
  maBrokerOfRecord: "Judy Niles-Simmons (License #126356)",
  brokerNotes: "Dan emailed Jessie 4/14/26 \u2014 she replied 4/15 with OM + direct answers to survey/utilities/expansion/permits. Permits FULLY TRANSFERABLE to new owner (confirmed). Seller only sells full 16.48ac package (development parcel + Phase II land). Jessie offered site visit. Listed by Argus = sophisticated seller, likely already shopped to PS/EXR/CUBE/SmartStop institutional REITs.",

  // Product program (fully permitted)
  permitStatus: "FULLY PERMITTED \u2014 7 buildings, 87,500 GSF, 670 units total. Transferable. Planning Board Decision + Site Plan Approval pending formal request.",
  proposedRSF: "87,500 GSF total (60,550 Phase I + 26,950 Phase II)",
  proposedUnits: "670 total \u2014 Phase I 445u (225 CC + 220 drive-up) + Phase II 225 CC (7 CC buildings)",
  buildingDesign: "Multi-story CC interior + ground-floor drive-up DU. Gated, electronic keypad, 24-hr cameras.",

  // Zoning (§6c) \u2014 fully permitted = score 10 on zoning, but ordinance row not yet cited
  zoning: "Commercial / Highway Business (pending ordinance verification)",
  zoningClassification: "fully-permitted",
  zoningUseTerm: "Self-storage \u2014 fully permitted via site-specific Planning Board approval",
  zoningOrdinanceSection: "Spencer Zoning Bylaw (adopted 11/16/2006, amended 11/7/2024) \u2014 permitted use table row not yet directly cited; permit is site-specific so district-level by-right vs SUP distinction is moot given existing approval",
  zoningSource: "https://www.spencerma.gov/DocumentCenter/View/254/Town-of-Spencer-Zoning-Bylaw-as-of-November-7-2024",
  zoningVerifyDate: "April 21, 2026",
  zoningTableAccessed: false,
  zoningNotes: "Per Jessie 4/15/26 reply: 'permits are fully transferable to a new owner.' Site-specific approval supersedes district-level research for transferability purposes. Still need: Planning Board Decision PDF + Site Plan Approval PDF to document approval chain.",
  jurisdictionType: "Town of Spencer (incorporated \u2014 Worcester County)",
  planningContact: "Spencer Planning Board",
  planningPhone: "(508) 885-7500",

  // UTILITIES (§6c-2) \u2014 ⚠️ THE CRITICAL FINDING
  waterProvider: "NONE \u2014 no municipal water available at site",
  waterAvailable: false,
  waterHookupStatus: "no-provider",
  waterContact: "N/A \u2014 site uses private well",
  waterNotes: "\u26a0\ufe0f NO MUNICIPAL WATER. Approved plan calls for private well in rear of property. Fire Chief required TWO on-site cisterns: (1) direct connection to Building A sprinkler room, (2) service for drive-up units. Confirmed via Jessie Gilton reply 4/15/26.",
  fireFlowAdequate: true,
  fireFlowSource: "2 on-site cisterns (Fire Chief mandated) \u2014 non-municipal fire suppression solution",
  sewerProvider: "NONE \u2014 no municipal sewer available",
  sewerAvailable: false,
  sewerNotes: "Small septic system sized for employee bathroom only (facility is unmanned storage, minimal wastewater).",
  electricProvider: "National Grid (verify)",
  threePhase: null,
  gasProvider: null,
  utilityNotes: "\u26a0\ufe0f CRITICAL: No municipal water or sewer. Well + septic + 2 fire cisterns. Per CLAUDE.md \u00a76c-2, municipal water is a HARD REQUIREMENT for institutional storage fire suppression. Cistern workaround is non-standard and adds ~$300K-$800K to build cost. This is likely WHY the site prices at $151K/ac (cheap for MA commercial) \u2014 market has priced in utility constraint. KILLS PS/EXR/CUBE/SmartStop/SROA institutional fit. Viable for non-standard operators (Compass/Amsdell family office, Banner regional NE, 10 Federal tertiary-spec tolerant).",
  totalUtilityBudget: "$400K\u2013$800K cistern + well + septic (non-standard)",

  // Access & site
  roadFrontage: "Direct frontage on East Main Street (Route 9) at Donnelly Rd intersection",
  frontageRoadName: "East Main St (MA Route 9)",
  roadType: "State highway \u2014 primary east-west corridor",
  trafficData: "13,588 VPD (MassDOT)",
  visibility: "Strong \u2014 Route 9 primary commercial corridor; approved signage",
  accessNotes: "Site is fully permitted = access, curb cuts, signage all approved through Spencer Planning Board. 15 mi west of Worcester via Route 9; I-90 / Mass Pike access within 15-20 min.",

  // Topo & Flood (§6c-3)
  femaFloodZone: "Pending FEMA panel verification",
  floodNotes: "Permitted project = flood zone cleared in entitlement. Verify panel current.",

  // Competition (§6c-4)
  competitorNames: "CubeSmart Spencer (CC + DU) \u00b7 Letendres Supply 64 Main St Spencer (CC + DU indoor) \u00b7 GiGi's Self Storage Leicester (confirm in 5-mi ring)",
  nearestCompetitor: "CubeSmart Spencer \u2014 in-town, ~2 mi (CC)",
  nearestCCCompetitor: "CubeSmart Spencer (climate-controlled)",
  competitorTypes: "Mix CC + drive-up \u2014 flyer cites 2 facilities, 55,686 SF total within 5 mi",
  competingSF: "~55,686 SF total within 5 mi (per Argus flyer)",
  competingCCSF: "~35,000 SF CC estimated within 5 mi",
  ccSPC: 1.4,
  projectedCCSPC: 4.5,
  pipelineSF: "Subject site IS the pipeline (670u / 87,500 GSF). No other CC pipeline identified in 5 mi via web search.",
  demandSupplySignal: "CURRENT: Severely underserved \u2014 1.4 CC SPC (score 10). PROJECTED with subject online: 4.5 CC SPC \u2014 moderate (score 6). Subject transitions market from underserved to moderate equilibrium.",

  // PS FAMILY PROXIMITY \u2014 Haversine run 4/21/26 vs PS_Locations_ALL + NSA CSVs
  psFamilyNearest: "iStorage Boston Turnpike, Shrewsbury MA \u2014 14.34 mi (NSA)",
  psFamilyWithin35mi: "7 total: iStorage Shrewsbury (14.34) \u00b7 PS South Grafton (17.12) \u00b7 NSA RightSpace Upton (20.80) \u00b7 PS Springfield Parker St (28.12) \u00b7 PS Chicopee (31.61) \u00b7 iStorage Springfield (33.30) \u00b7 PS Westford (34.26)",

  // Demographics \u2014 placeholder; autoEnrichESRI will pull real 1-3-5 mi rings
  demoSource: "PENDING ESRI auto-enrichment on submission",
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

  demandDrivers: "Worcester MSA overflow (Spencer is ~15 mi west of Worcester). Major Worcester employers: UMass Chan Medical School, Hanover Insurance, Saint Vincent Hospital. Town HHI ~$79K, surrounding towns Leicester ~$89K, E Brookfield ~$78K. Rural/exurban Central MA \u2014 pop growth flat. 13,588 VPD on Route 9 provides visibility.",

  // SiteIQ structured data \u2014 dashboard scoring
  siteiqData: {
    nearestPS: 14.34,
    competitorCount: 2,
    ccSPC: 1.4,
    projectedCCSPC: 4.5,
    marketTier: 4,
    brokerConfirmedZoning: true,
    surveyClean: false,
    waterHookupPenalty: true,
  },

  summary: "SiteScore ~6.0 STRONG (water penalty drags \u22121.0). Fully permitted 670-unit / 87,500 GSF 7-building project. Permits FULLY TRANSFERABLE (confirmed by Jessie Gilton 4/15/26). 15.89 net / 16.48 gross AC. Route 9 @ Donnelly Rd, 13,588 VPD. Worcester MSA exurban. \u26a0\ufe0f NO MUNICIPAL WATER/SEWER \u2014 well + septic + 2 Fire Chief-mandated cisterns. Kills PS/EXR/CUBE/SmartStop/SROA institutional fit (municipal fire flow required). Viable for non-standard operators: Compass/Amsdell (MA footprint), Banner (Lynn MA precedent), Storage Post, 10 Federal. CC SPC 1.4 current \u2192 4.5 projected with subject online. Nearest PS family iStorage Shrewsbury 14.34 mi; 7 within 35 mi. 3-mi pop estimated 13\u201315K marginal, 5-mi ~25K. $2.5M ($151K/ac) reflects utility constraint \u2014 market priced-in discount. Listed by Argus / NAI Norwood (Jessie Gilton). Dan emailed Jessie 4/14/26; reply with OM + answers 4/15/26. Follow-up needed for survey + permit docs.",

  latestNote: "MATRIX VET 4/21. \u26a0\ufe0f DEALBREAKER FOR INSTITUTIONAL: no municipal water/sewer \u2014 well+septic+2 cisterns (Fire Chief req). Kills PS/REIT fit. Permits fully transferable. CC SPC 1.4 underserved but market small (5-mi ~25K pop). Matrix route FLIPS from PS-first to Compass/Amsdell (MA footprint, family office, flexible spec), Banner (Lynn MA precedent, $500M+ pipeline), Storage Post, 10 Federal. Dan already corresponded with Jessie Gilton 4/14\u20134/15 \u2014 OM received, utilities confirmed. Follow-up drafted for survey + Planning Board Decision documents.",
  latestNoteDate: "Apr 21, 2026",

  buyerStrategy: "PIVOTED post-utility-finding. PRIMARY: Compass Self Storage / Amsdell (Steve Hryszko \u00b7 Todd Amsdell tca@amsdellcompanies.com \u2014 MA in footprint, 40\u2013100K NRSF band matches 87,500 GSF, family office fast close, less rigid on utility specs). SECONDARY: Banner Real Estate Group (Lynn MA 106K SF conversion precedent, $500M+ 2025 pipeline = most active in 35-yr history). TERTIARY: Storage Post (NE active, institutional private), 10 Federal (tertiary drive-up, spec-flexible). DO-NOT-ROUTE: PS (no municipal fire flow = hard fail), EXR, CubeSmart, SmartStop, SROA \u2014 all require municipal water.",

  dealType: "GU-PMT (Ground-Up, Fully Permitted) \u2014 premium to GU-ENT bucket",
};

async function run() {
  try {
    await set(ref(db, `submissions/${key}`), record);
    console.log(`\u2705 ${key} \u2014 written to submissions/`);
    console.log(`   Dashboard: https://storvex.vercel.app/?site=${key}`);
    console.log(`\nDone. autoEnrichESRI() will run on dashboard load for 1-3-5 mi ring demographics.`);
    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
}
run();
