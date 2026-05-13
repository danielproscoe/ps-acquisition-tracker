// Submit Hockley TX — 19250 Becker Rd — 4.5008 AC unincorporated Harris County
// Vet date: 2026-04-28
// DW/southwest territory — Houston metro / NW Harris County
// Broker: Wendy Cline (Wendy Cline Properties Group) — direct listing email 4/24/26 at $1.2M
// Survey + Wendy email attached at intake

import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);

const key = "hockley_tx_19250_becker";

const record = {
  name: "Hockley TX — 19250 Becker Rd",
  address: "19250 Becker Road",
  city: "Hockley",
  state: "TX",
  zip: "77447",
  market: "Houston / NW Harris County",
  region: "southwest",
  status: "pending",
  phase: "Prospect",
  acreage: "4.5008",
  useableAcreage: "~3.0-3.5 AC net buildable after avoiding eastern transmission ROW (back corner per Dan visual review). Building plate fits western/center; easement consumes eastern third.",
  askingPrice: "$1,200,000",
  pricePerAcre: "$266,621/ac",
  coordinates: "30.0569, -95.7985",
  coordinateStatus: "verified — Census Geocoder Public_AR_Current benchmark, exact match returned for 19250 BECKER RD HOCKLEY TX 77447",
  parcelLegal: "TR 12A-2 ABST 333 HARRIS CO SCH LDS 30",

  listingSource: "Off-market — Wendy Cline direct email 4/24/26",
  listingUrl: "https://www.har.com/homedetail/19250-becker-rd-hockley-tx-77447/8096758",
  sellerBroker: "Wendy Cline (Broker/Owner)",
  brokerFirm: "Wendy Cline Properties Group",
  brokerEmail: "wendy@wendyclineproperties.com",
  brokerPhone: "281-460-9360 (cell) | 281-858-3451 (office)",
  brokerNotes: "Existing relationship — prior Hockley deals (Hopfe Rd 2025, Margerstadt 2026 saved searches via Crexi). Wendy emailed Dan directly 4/24/26: 'I am listing this property today for $1.2M.' Survey attached. Off-market first-look. No public Crexi/LoopNet listing yet.",
  daysOnMarket: "Listed 4/24/26 — fresh",

  zoning: "Unincorporated Harris County (NO ZONING)",
  zoningClassification: "by-right",
  zoningUseTerm: "N/A — TX Local Government Code Ch. 231: Texas counties have NO zoning authority. ETJ grants platting control only, not use restrictions. Storage permitted with no use restriction.",
  zoningOrdinanceSection: "TX Local Government Code Ch. 231 (county zoning preemption)",
  zoningSource: "Census Geographies API (jurisdiction confirmed) + memory hardcode 4/28/26 (TX unincorporated = PREFERRED zoning state for PS, score 8-10 NOT Unknown)",
  zoningVerifyDate: "April 28, 2026",
  zoningTableAccessed: false,
  jurisdictionType: "Unincorporated County (Harris County) — Northwest Harris CCD GEOID 4820192845. OUTSIDE City of Houston ETJ band (~36mi NW of Houston city limits, well past ETJ extending to Cypress/Mueschke).",
  zoningNotes: "Hockley has NO incorporated municipal government. Unincorporated Harris County. TX Ch. 231 LGC preempts county zoning authority — so storage is by-right with no use restriction, no SUP/CUP required. Per memory hardcode 4/28/26 (feedback_etj-unrestricted-35pct-impervious.md): TX ETJ/unincorporated = PREFERRED zoning state for PS recs. Score 10. Harris County 35% impervious cover restraint is a design constraint (not a kill) — favor multi-story under 4ac, but on 4.5ac net (~3.0ac after easement) one-story plate ~46K SF achievable within 35% IC. Comparable parcel 19247 Becker (across street) explicitly listed as 'unrestricted land' on LoopNet — strong indicator subject is also deed-unrestricted. CONFIRM via title commitment.",
  planningContact: "Harris County Engineering / Permits",
  planningPhone: "713-274-3700",
  politicalRisk: "Low — unincorporated county, no zoning hearings, no SUP/CUP risk. Existing storage adjacent (My Garage at 18800 Becker) confirms area accepts the use.",

  waterProvider: "Northwest Freeway MUD",
  waterAvailable: true,
  insideServiceBoundary: true,
  waterHookupStatus: "by-right",
  waterContact: "Lonnie Lee, Regional Water Corporation (District Manager) — 281-897-9100 — billing@regionalwater.net. District legal: Schwartz Page & Harding LLP, info@sphllp.com, 713-623-4531. Office: 1300 Post Oak Blvd Ste 2500, Houston TX 77056.",
  waterNotes: "Northwest Freeway MUD service area is described as 'immediately north and west of the intersection of U.S. Highway 290 and Becker Road, in northwest Harris County' (~400ac district). Subject at 19250 Becker is at the heart of this MUD. PRECEDENT: My Garage Self Storage at 18800 Becker (0.3 mi south of subject) is operating storage — proves MUD will issue commercial tap for storage use. Confirm tap fee + meter sizing on inquiry.",
  fireFlowAdequate: true,
  fireFlowSource: "MUD-served commercial tap; My Garage Self Storage (next door) operating storage on same MUD = fire flow adequate for institutional CC build",
  sewerProvider: "Septic (typical for 4.5ac outparcel — viable for storage per §6c-2)",
  sewerAvailable: true,
  sewerNotes: "Northwest Freeway MUD provides wastewater within core but septic is standard on 4.5ac outparcels and cheaper. Storage ~50 GPD restroom-only handled easily by septic.",
  electricProvider: "CenterPoint Energy",
  threePhase: true,
  gasProvider: "CenterPoint Energy (Houston metro electric+gas dual provider)",
  telecomProvider: "Comcast/Xfinity + AT&T fiber",
  utilityNotes: "WATER BY-RIGHT (Northwest Freeway MUD), septic for sewer, CenterPoint 3-phase electric + gas, fiber telecom. No utility extension cost expected. Confirm tap fees + meter sizing with Lonnie Lee on inquiry.",
  totalUtilityBudget: "Standard commercial tap fees only — water tap + septic permit + electric service drop. No line extension required.",

  roadFrontage: "311 LF on Becker Rd (west boundary)",
  frontageRoadName: "Becker Road",
  roadType: "County-maintained 2-lane rural collector (Harris County, NOT TxDOT)",
  trafficData: "Becker Rd ~2,500-5,000 VPD (Harris County 2014 traffic counts; rural collector). PROXY for visibility/access: US-290 at Becker Rd interchange ~70-85K AADT (TxDOT 2023 STARS II — Cypress-Hockley segment). Subject is ~0.5-0.8 mi north of US-290 / Becker interchange.",
  nearestSignal: "Becker Rd / US-290 frontage road (~0.5-0.8 mi south)",
  visibility: "Rural Becker Rd low local VPD; US-290 corridor visibility limited (subject set back 0.5-0.8mi from highway). Pole/monument signage at Becker frontage; will rely on web/wayfinding marketing more than drive-by",
  curbCuts: "Existing driveway visible at Becker Rd frontage per survey — confirm county will permit commercial curb cut",
  decelLane: "Not required — county road, low VPD, 45-55 MPH",
  drivewayGrade: "Flat — typical Houston coastal plain",
  accessNotes: "Single public road access on Becker Rd west boundary, 311 LF frontage. Storage destination use — no 4-way directional test required. NOT landlocked. ~0.5-0.8 mi to US-290 interchange = strong regional access for catchment beyond local 3-mi ring.",

  femaFloodZone: "Zone AE (100-year floodplain)",
  femaPanel: "48201C 0185 H, rev 11/15/2019",
  floodNotes: "Zone AE per survey + FEMA. BFE estimated ~140-145 ft NAVD88 (Cypress Creek tributary headwaters near Hockley) — VERIFY exact via FEMA MSC viewer. Cost adders for storage on AE: slab elevation +1-2 ft above BFE ($200-400K on 65K SF plate), drainage detention ($50-150K post-Harvey Atlas 14 standards), builders flood insurance during construction ($30-60K). Total AE adder ~$300-600K vs non-flood site (~$5-9/SF). Multiple PS, EXR, CubeSmart facilities in NW Harris County built on AE-edge land — workable, NOT a kill.",
  topography: "Flat — Houston coastal plain. No grade challenges.",
  topoNotes: "Existing house + outbuildings on SW corner per survey (minor demo cost). Open pasture remainder. Subsurface investigation noted as 'beyond scope of survey' — geotech recommended at LOI.",
  gradingCostRisk: "Medium — AE flood requires pad raise (1-2 ft fill across building footprint, $3-5/SF of building)",

  competitorNames: "My Garage Self Storage (independent — boat/RV mix at 18800 Becker, 0.3mi); AAA Self-Storage Hockley (independent at 20555 FM 2920, ~2.5mi); Hockley Storage Center (Diehl Investments, drive-up on FM 2920, ~2.8mi)",
  nearestCompetitor: "My Garage Self Storage 18800 Becker Rd (0.3 mi) — primarily boat/RV with limited indoor",
  nearestCCCompetitor: "PS #29250 Cypress / US290 & Mueschke (~6.84 mi) — institutional CC. iStorage Tomball (~6.99 mi). NO institutional CC within 3 mi.",
  competitorTypes: "Within 3 mi: 0 institutional CC. My Garage = boat/RV + minor indoor; AAA = drive-up + limited CC; Hockley Storage = drive-up only.",
  competingSF: "~10-15K total within 3 mi (rural mix)",
  competingCCSF: "~10K CC within 3 mi (severely underserved — no institutional product)",
  ccSPC: 0.85,
  projectedCCSPC: 1.6,
  pipelineSF: "No new CC under construction or permitted within 5 mi (Houston Chronicle / Community Impact Cy-Fair searches). Bridgeland/Sunterra growth corridor west of Grand Parkway generating storage demand faster than supply.",
  demandSupplySignal: "CC SEVERELY UNDERSERVED — 0.85 CC SF/cap (3-mi 19,168 pop, ~10K CC SF). Per §6c-4 benchmarks: <1.5 = severely underserved (score 10). Projected 5-yr CC SPC ~1.6 — still underserved benchmark. NO institutional CC product within 3 mi — first-mover opportunity for PS.",

  psFamilyNearest: "5.74 mi (PS #22084 Cypress / Mueschke Rd, 15814 Mueschke Rd)",
  psFamilyWithin5mi: 0,
  psFamilyWithin10mi: 5,
  psFamilyWithin25mi: "150+",
  psFamilyNotes: "5.74 mi to nearest PS family facility (PS #22084 Cypress/Mueschke). 8 PS family facilities within 11 mi — strong submarket validation, plenty of breathing room (no cannibalization risk). NOT a zero-PS market — this is densification + spacing-gap play. The Mueschke Rd corridor anchors PS NW Houston portfolio pulling from Bridgeland/Towne Lake; Becker fills the western gap toward Daikin/Waller.",

  demoSource: "ESRI ArcGIS GeoEnrichment 2025 (current year estimates + 2030 projections)",
  pop1mi: "2,038",
  pop3mi: "19,168",
  pop5mi: "52,666",
  income1mi: "$86,082",
  income3mi: "$101,340",
  income5mi: "$122,674",
  households1mi: "523",
  households3mi: "6,271",
  households5mi: "17,105",
  homeValue1mi: "$293,345",
  homeValue3mi: "$307,097",
  homeValue5mi: "$372,538",
  growthRate: "3-mi 3.76% / 5-mi 4.81% / 1-mi 0.93% — accelerating outward (classic Houston exurb growth signal)",
  popGrowth3mi: "+3.76%",
  popGrowth5mi: "+4.81%",
  hhGrowth3mi: "to confirm",
  incomeGrowth3mi: "to confirm",
  renterPct1mi: "5.9%",
  renterPct3mi: "10.7%",
  renterPct5mi: "11.0%",
  pop3mi_fy: "23,053",
  pop5mi_fy: "66,614",

  demandDrivers: "Bridgeland MPC (~8 mi SE — 11,500 ac, 20K planned homes, 65K planned residents). Sunterra MPC (~12 mi SW Katy — 2,303 ac). Daikin Texas Technology Park (~10 mi NE in Waller — 4M SF AC manufacturing, 10K+ employees). Towne Lake (~10 mi SE — established affluent). Cy-Fair ISD vs Waller ISD (subject likely Waller ISD). Johnson 1,000-home Hockley project announced 2026. Per Community Impact Cy-Fair Feb 2026: 'spiked population growth near Grand Parkway.' Renter % only 10.7% in 3-mi = homeownership-heavy = strong storage demand from large-home owners with toys/seasonal goods.",

  siteiqData: {
    nearestPS: 5.74,
    competitorCount: 3,
    ccSPC: 0.85,
    projectedCCSPC: 1.6,
    marketTier: 4,
    brokerConfirmedZoning: false,
    surveyClean: false,
    waterHookupPenalty: false,
  },

  surveyScrubbed: true,
  surveyScrubDate: "Apr 28, 2026",
  surveyEasementSummary: "Diagonal easement crosses eastern third of parcel — likely existing CenterPoint Energy 138/345 kV electric transmission ROW (matches NW Harris CenterPoint infrastructure pattern; pipelines in Hockley area run further west toward Waller-Hempstead). Width estimated 80-200 ft typical for transmission. Survey shows no labeled easement type — TITLE COMMITMENT REQUIRED to identify grantor/width/restrictions. Dan visual review confirms back-corner placement — building plate fits western/center, easement does NOT bisect buildable middle. Net buildable ~3.0-3.5 AC after easement. Existing house + outbuildings on SW corner (minor demo). NEW CenterPoint 'Becker 345 kV' project is in early planning (route NOT selected) — distinct from existing diagonal easement.",
  surveyAccessSummary: "311 LF frontage on Becker Rd west side. Single public road access — fine for storage destination use (no PECO 4-way directional test required). Existing driveway visible. NOT landlocked.",
  surveyVerdict: "FLAGGED",
  surveyVerdictNotes: "FLAGGED on (1) unidentified easement scope — title commitment needed; (2) Zone AE flood — cost adder, not kill. Per §6h Step 2c: classification CAPPED AT YELLOW until title commitment confirms easement type/width. Dan visually pre-cleared easement as back-corner. Once title clears, upgrade to GREEN.",

  summary: "Hockley TX — 19250 Becker Road. 4.5008 AC at $1.2M ($266K/AC). UNINCORPORATED HARRIS COUNTY — NO ZONING — by-right per TX LGC Ch. 231 (counties have no zoning authority). Northwest Freeway MUD water by-right (Lonnie Lee, 281-897-9100). 311' frontage on Becker Rd, ~0.5-0.8 mi to US-290 (~75K AADT). 5.74 mi to nearest PS family (#22084 Cypress/Mueschke), 8 PS within 11 mi — strong submarket validation, no cannibalization. CC SPC 0.85 SF/cap (SEVERELY UNDERSERVED — benchmark <1.5), projected 5-yr 1.6, no CC pipeline within 5 mi. Bridgeland/Sunterra/Daikin demand pull. ESRI 2025: 19,168 3-mi pop, $101K HHI, 3.76% CAGR. Zone AE flood ($300-600K cost adder, common in NW Harris). Diagonal easement on eastern third (likely CenterPoint electric ROW per Dan visual; back-corner, building plate fits — title commitment required). Wendy Cline direct off-market listing 4/24/26. PRIME fundamentals capped at YELLOW pending title commitment. Routes to DW (TX southwest territory).",

  latestNote: "Wendy Cline direct off-market listing received 4/24/26 at $1.2M. Survey scrubbed 4/28 — verdict FLAGGED on title-pending easement (back-corner per Dan visual) + AE flood (workable cost adder). Tier 1 fundamentals: NO ZONING (TX unincorporated), by-right MUD water (Northwest Freeway), severely underserved CC market (0.85 SPC vs 1.5 benchmark), 5.74mi to nearest PS — strong densification gap. ESRI 2025 real: 19K 3-mi pop, $101K HHI, 3.76% growth, 5-mi $123K HHI. Diligence email queued to Wendy (title commitment, MUD confirm, BFE, deed restrictions, existing house disposition). Rec email drafted to DW. Pricing intentionally NOT raised with broker yet per Dan.",
  latestNoteDate: "Apr 28, 2026",

  buyerStrategy: "PRIMARY: PS via DW (southwest region). TX = DW territory per §6f and per Dan-correction memory. Storvex deep-link: https://storvex.vercel.app/?site=hockley_tx_19250_becker. SECONDARY (if DW passes): Storage King (Andover) per §6h DW-rejects-to-SK rule. TERTIARY: SROA Capital (Beau Raich braich@sroa.com — TX ground-up active, Fund IX deploying $1.15B, no DFW yet so Houston is open market). Per memory project_ps-tx-broker-redistribution.md: PS giving more TX to other brokers — diversify to SROA/Metro/Devon and hammer U-Haul (PS-proof dual-use moat) on TX ground-ups going forward. NOT-A-FIT: Brock Wollent (DW son, DFW competitor — NEVER route).",

  dealType: "Ground-Up Land Acquisition (Existing house = minor demo). Off-market — direct broker listing.",

  redFlags: "(1) ZONE AE 100-yr FLOOD — $300-600K cost adder for slab elevation + detention + builders flood (workable per NW Harris precedent, NOT kill). (2) DIAGONAL EASEMENT on eastern third — likely CenterPoint electric ROW, title commitment required to confirm type/width/restrictions. Dan pre-cleared as back-corner placement, building plate fits western/center. (3) Set back from US-290 (~0.5-0.8mi) — local VPD on Becker Rd modest, web/wayfinding marketing more important than drive-by. (4) Existing house + outbuildings on SW corner — minor demo cost or possibly excluded from sale (clarify with Wendy).",

  keyStrengths: "(1) NO ZONING — unincorporated Harris County, TX Ch. 231 LGC preempts county zoning authority. By-right with zero entitlement risk. (2) WATER BY-RIGHT — Northwest Freeway MUD, contact named (Lonnie Lee). (3) CC SPC 0.85 — SEVERELY UNDERSERVED, no institutional CC product within 3 mi, first-mover opportunity. (4) 5.74 mi to nearest PS family — strong submarket validation, densification gap (NOT cannibalization). (5) ESRI 2025 STRONG: 19K pop / $101K HHI / 3.76% growth in 3-mi; 5-mi accelerates to $123K HHI / 4.81% — classic Houston exurb growth signal. (6) Bridgeland MPC + Sunterra + Daikin Texas Tech Park = embedded demand drivers. (7) Wendy direct off-market relationship — first-look priority. (8) Survey already in hand — saves DD time. (9) 0.3mi storage operator (My Garage) confirms Hockley accepts the use AND MUD will issue commercial tap.",
};

async function run() {
  try {
    await set(ref(db, `submissions/${key}`), record);
    console.log(`SUCCESS: ${key} written to submissions/`);
    console.log(`Storvex deep-link: https://storvex.vercel.app/?site=${key}`);
    console.log(`Region suggested: southwest (DW). Dan routes via dashboard 'Approve & Route'.`);
    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
}
run();
