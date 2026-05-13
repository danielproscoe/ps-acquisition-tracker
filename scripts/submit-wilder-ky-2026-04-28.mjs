// Submit Wilder KY — 1310 Gloria Terrell Dr — 6.85 AC shovel-ready industrial pad
// Vet date: 2026-04-28
// MT/east territory — Cincinnati MSA / Northern Kentucky Tier 1
// Broker: Roddy MacEachen SIOR (SqFt Commercial) — back on market 4/24 after Feb sale-pending fell through
// Zoning verified by Dan personally — Wilder Ord. Article X #22 Warehousing or wholesaling = by-right

import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);

const key = "wilder_ky_1310_gloria_terrell";

const record = {
  name: "Wilder KY — 1310 Gloria Terrell Dr",
  address: "1310 Gloria Terrell Dr",
  city: "Wilder",
  state: "KY",
  zip: "41076",
  market: "Cincinnati MSA / Northern Kentucky / Newport-Wilder corridor",
  region: "east",
  status: "pending",
  phase: "Prospect",
  acreage: "6.85",
  useableAcreage: "6.85 (shovel-ready graded industrial pad, all utilities to site). CARVE-OUT OPPORTUNITY: 4-4.5ac south/SE corner aligns with PS PRIMARY one-story CC product.",
  askingPrice: "$2,895,000",
  pricePerAcre: "$422,628/ac",
  coordinates: "39.0420, -84.4795",
  coordinateStatus: "approximate — verify via Campbell County PVA / LINK-GIS for parcel 999-99-19-841.03 before final UW",
  parcelNumber: "999-99-19-841.03",

  listingSource: "Crexi (referred direct via broker email)",
  listingUrl: "https://www.crexi.com/properties/2104145/kentucky-1310-gloria-terrell-dr",
  sellerBroker: "Roddy MacEachen, SIOR (primary) | Rod MacEachen | Jared Wagoner, SIOR | Matt Schutte | Sarah Kern | Amy Castaneda",
  brokerFirm: "SqFt Commercial",
  brokerEmail: "roddy@sqftcommercial.com",
  brokerEmailAlt: "rod@sqftcommercial.com, jared@sqftcommercial.com, matt@sqftcommercial.com, sarah@sqftcommercial.com, amy@sqftcommercial.com",
  brokerPhone: "(513) 739-3985 (Roddy primary) | (513) 675-5764 (Rod) | (812) 890-1768 (Jared) | (859) 414-9169 (Matt)",
  brokerAddress: "7351 E Kemper Rd, Suite D, Cincinnati, OH 45249",
  brokerNotes: "Initial DJR inquiry 2/21/26 (Dan to Roddy/Rod/Jared). 2/23/26 Roddy replied 'sale pending'. 4/24/26 Roddy emailed back: 'This is back on market. Let us know if interest to engage here. See attached.' Flyer + survey attached. Site has been actively shopped — prior deal collapsed. Probe broker on call: when did sale fall through, financing/permitting/title? Roddy is SIOR, sophisticated industrial broker.",
  daysOnMarket: "Re-listed 4/24/26 (back on market after Feb sale-pending collapsed)",

  zoning: "I-2 (Heavy Industrial) + IP (Industrial Park)",
  zoningClassification: "by-right",
  zoningUseTerm: "Warehousing or wholesaling (with the exception of those items or products not permitted to be manufactured within this zone)",
  zoningOrdinanceSection: "Wilder Zoning Ordinance (Feb 2025), Article X — I-2 Heavy Industrial District, Permitted Use #22, page 10-40",
  zoningSource: "https://wilderky.gov/wp-content/uploads/2026/01/Zoning-Ordinance.pdf",
  zoningVerifyDate: "April 28, 2026",
  zoningTableAccessed: true,
  zoningNotes: "Dan personally opened the Wilder Zoning Ordinance (Feb 2025) PDF and confirmed Article X I-2 Permitted Use #22 'Warehousing or wholesaling' covers the proposed indoor climate-controlled storage use, by-right, no SUP/CUP required. NOTE: ordinance PDF is fully scanned (no text layer) so direct keyword extraction was not possible — Dan visually verified the use schedule. Existing CC storage facilities operating in Wilder city (Wilder Storage 91 Banklick Rd; Key Storage 206 Vine St) provide circumstantial confirmation. FOLLOW-UP: parcel 999-99-19-841.03 may include both I-2 and IP designations — verify which governs the buildable area for the carve-out portion.",
  jurisdictionType: "City of Wilder (incorporated, independent of Campbell County) — Campbell County, KY",
  planningContact: "City of Wilder Planning & Zoning Commission — Mayor Valerie Jones; Commissioners: Jim Viox, Orest Melnyk, Craig Curk, Eric Muench, Jack Becker, Richard Fowler, Nancy Lauer; Board of Adjustments Chair Herb Kenter",
  planningPhone: "City Hall main — verify (520 Licking Pike, Wilder KY 41076)",
  politicalRisk: "Low — industrial corridor along AA Hwy/Licking River explicitly zoned I-2/IP for industrial use; existing storage facilities operating in Wilder; recent zone changes (ANDIS LLC Oct 2025 19.5ac approved unanimously, 9,600 SF industrial behind Waffle House approved) show pro-industrial-development climate.",
  recentApprovals: "ANDIS LLC zone change 10/27/2025 — 19.53ac at Pooles Creek Rd / St Johns Lane to highway commercial + industrial park (unanimous Wilder P&Z approval). Industrial-type building approved behind Waffle House/McDonald's. Wilder is actively approving industrial development.",

  waterProvider: "Northern Kentucky Water District (NKWD)",
  waterAvailable: true,
  insideServiceBoundary: true,
  waterHookupStatus: "by-right",
  waterContact: "Northern Kentucky Water District — 12-inch water tap already INSTALLED at site per SqFt Commercial flyer",
  waterNotes: "12-inch water tap INSTALLED AT SITE (per SqFt Commercial flyer). Indoor climate-controlled storage fire suppression demand (1,500+ GPM at 20 PSI residual) easily satisfied. No outstanding tap fee.",
  distToWaterMain: "Connected (12in tap installed)",
  waterMainSize: "12 inch (confirmed installed)",
  fireFlowAdequate: true,
  fireFlowSource: "12in NKWD main with installed tap — ample fire flow for institutional CC storage",
  sewerProvider: "Sanitation District 1 (SD1) — Northern Kentucky regional sewer",
  sewerAvailable: true,
  distToSewerMain: "Connected",
  electricProvider: "Duke Energy Kentucky or Owens Electric (per SqFt Commercial flyer)",
  threePhase: true,
  gasProvider: "Duke Energy Kentucky",
  telecomProvider: "Cincinnati Bell / Spectrum (verify on call)",
  waterTapFee: "Tap installed — fee paid by current owner",
  utilityNotes: "BEST-IN-CLASS UTILITY POSITION. All four utilities at site. 12in water tap installed (NKWD). Sewer connected (SD1). Stormwater connection installed at NW corner — flyer states 'will handle all off-site for full useability of site'. Duke gas/electric. Industrial pad has been graded shovel-ready. Saves $400K-$1M typical for greenfield.",
  totalUtilityBudget: "Minimal — all utilities at site, taps installed; only meter/service-line fees + permits",

  roadFrontage: "Frontage on Gloria Terrell Drive (variable width R/W) on south boundary; frontage on Kentucky Route 9 (AA Hwy, variable width R/W) on east boundary per flyer survey page 3",
  frontageRoadName: "Gloria Terrell Dr (south access); KY Route 9 / AA Hwy (east frontage)",
  roadType: "Gloria Terrell Dr = local industrial side road; KY-9 / AA Hwy = primary regional artery (4-lane, 45+ MPH state highway)",
  trafficData: "AA Hwy / KY-9: high-volume regional artery (KYTC AADT pull pending — likely 15-25K VPD). Gloria Terrell Dr: industrial side road, low VPD",
  visibility: "Strong from AA Hwy / KY-9 (4-lane state highway with industrial visibility band); access via Gloria Terrell Dr off AA Hwy",
  accessNotes: "Frontage on KY-9 (AA Hwy primary regional artery) plus Gloria Terrell Dr internal access. 1.1 mi to I-275 (per flyer distance map p4). 9 mi to downtown Cincinnati (cross-river via I-471/I-275), 13 mi to CVG. Cross-river Cincy access excellent.",

  femaFloodZone: "Subject is on bluff above Licking River — likely Zone X (no flood) but confirm via FEMA panel",
  floodNotes: "Site is graded industrial pad on bluff above Licking River. Adjacent 11.99ac MDG Wilder parcel runs to river edge (where flood zone may bite). Subject 6.85ac sits well above river plane. VERIFY FEMA panel.",
  topography: "Industrial pad shovel-ready (graded). Bluff above Licking River.",
  topoNotes: "Pad already graded — minimal additional grading anticipated. Stormwater connection already installed at NW corner.",
  gradingCostRisk: "Low — pad already graded shovel-ready",

  competitorNames: "Wilder Storage (91 Banklick Rd, Wilder — CC + drive-up); Key Storage (206 Vine St, Wilder — CC + drive-up); Store Space (515 W 9th St, Newport — CC + non-CC mixed); Extra Space Storage (78 E 11th St, Newport — 76,981 NRSF, multi-story 3-bldg, fully CC); CubeSmart 3 Cincinnati facilities (8-11 mi, OUT of 3-mi ring)",
  nearestCompetitor: "Wilder Storage 91 Banklick Rd — ~1-2 mi (CC + drive-up mixed)",
  nearestCCCompetitor: "Wilder Storage or Key Storage — both ~1-2 mi from subject, both offer climate-controlled units",
  competitorTypes: "4 facilities within 3-mi ring: 2 small Wilder operators (legacy mixed) + 2 Newport operators. Modern multi-story CC = only Extra Space Newport (~77K NRSF, 3-bldg basement+1+2 story).",
  competingSF: "~180,000 SF total within 3-mi ring (Extra Space 77K + Wilder Storage est 35K + Key Storage est 30K + Store Space est 40K)",
  competingCCSF: "~125,000 SF CC estimated within 3-mi ring (Extra Space ~70K CC dominant + ~55K CC across smaller operators)",
  ccSPC: 2.05,
  projectedCCSPC: 2.5,
  pipelineSF: "No confirmed CC pipeline within 3-mi ring (verify Wilder/Newport/Bellevue building permits). Cincinnati MSA broadly ~200K SF/yr but NKY core has been quiet.",
  demandSupplySignal: "CC UNDERSERVED — 2.05 CC SF/capita (3-mi 60.8K pop, ~125K CC SF). Per §6c-4 benchmarks: 1.5–3.0 = underserved (score 8). Extra Space Newport is the only modern multi-story CC operator — the rest are legacy small operators.",

  psFamilyNearest: "2.68 mi (PS family — PS-owned/iStorage NSA-acquired/NSA legacy: brand identity verify)",
  psFamilyWithin35mi: "34 facilities within 25 mi (heavy Cincinnati MSA saturation). 1 within 5 mi, 10 within 10 mi.",
  psFamilyNotes: "Cincy MSA HEAVILY covered by PS family. Subject at 2.68 mi to nearest PS family = potential SPACING-GAP play, NOT a zero-PS market. MT priority gaps are Independence KY, Springboro OH, S. Dayton (per §6f-2). Wilder/Newport NKY core is COVERED ground. Site lives or dies on whether it fills a specific drive-time gap relative to existing PS family inventory — MT to evaluate.",

  demoSource: "ESRI ArcGIS GeoEnrichment 2025 (current year estimates + 2030 projections)",
  pop1mi: "5,066",
  pop3mi: "60,823",
  pop5mi: "153,613",
  income1mi: "$72,947",
  income3mi: "$66,078",
  income5mi: "$78,585",
  households1mi: "1,947",
  households3mi: "27,001",
  households5mi: "69,921",
  homeValue1mi: "$174,399",
  homeValue3mi: "$226,118",
  homeValue5mi: "$285,043",
  growthRate: "3-mi: -0.07% (effectively flat); 1-mi: +0.47%; 5-mi: +0.29%",
  popGrowth3mi: "-0.07%",
  hhGrowth3mi: "+0.23%",
  incomeGrowth3mi: "+1.95%",
  renterPct3mi: "41.8%",
  pop3mi_fy: "60,601",
  households3mi_fy: "27,307",
  income3mi_fy: "$72,786",

  demandDrivers: "Cincinnati MSA core (2.2M MSA pop). CVG Airport 13 mi. Downtown Cincinnati 9 mi cross-river via I-471/I-275. Northern Kentucky Convention Center / Newport on the Levee within 3 mi. Mature urban submarket — flat 3-mi pop growth (-0.07%) reflects Newport-Bellevue-Wilder mature character; 5-mi extends to Highland Heights NKU campus + Cold Spring growing suburbs (+0.29%). Industrial corridor along Licking River with Building Crafts (concrete plant), Castellini Leasing, Valley Asphalt, MDG Wilder LLC. AA Hwy / KY-9 primary regional artery.",

  siteiqData: {
    nearestPS: 2.68,
    competitorCount: 4,
    ccSPC: 2.05,
    projectedCCSPC: 2.5,
    marketTier: 1,
    brokerConfirmedZoning: true,
    surveyClean: true,
    waterHookupPenalty: false,
  },

  surveyScrubbed: true,
  surveyScrubDate: "Apr 28, 2026",
  surveyEasementSummary: "VISUAL SCRUB FROM FLYER PAGE 3 SURVEY: Subject 6.85ac parcel (298,726 SF) shows NO easements crossing buildable area. The 20ft Public Sanitary Sewer Easement runs through the ADJACENT 11.99ac parcel (MDG Wilder LLC, 1306 Gloria Terrell Dr) — NOT through subject. Existing 'Ex. Sewer Easement' also visible on adjacent 11.99ac parcel. Subject parcel bounded by Gloria Terrell Dr (south, public R/W), KY Route 9 / AA Hwy (east, public R/W), Building Crafts Inc 8.65ac parcel (north — concrete plant), MDG Wilder LLC 11.99ac parcel (south/west). Castellini Leasing Co 1.84ac east (across AA Hwy R/W). Valley Asphalt to far south. Recommend full ALTA + title commitment for definitive scrub.",
  surveyAccessSummary: "Public road frontage on TWO sides: Gloria Terrell Dr (south, internal industrial side road) + KY Route 9 / AA Hwy (east, primary regional artery). Storage standard access — no 4-way directional test required (storage = destination use). NOT landlocked. Curb cuts presumed on Gloria Terrell Dr (industrial road serving multiple parcels).",
  surveyVerdict: "CLEAN",

  summary: "SiteScore 7.93 STRONG/VIABLE (YELLOW — just under GREEN 8.0 threshold). I-2 Heavy Industrial — BY-RIGHT per Wilder Zoning Ordinance Article X #22 'Warehousing or wholesaling' (Feb 2025, page 10-40, ordinance verified by Dan personally). Plus IP (Industrial Park) on portion (verify which governs). CC SPC 2.05 SF/capita — underserved tier. Projected 5-yr 2.5 — still underserved. 4 CC competitors within 3 mi (~125K CC SF). Extra Space Newport (76,981 NRSF, multi-story) is the only modern institutional CC operator; rest are legacy mixed-format. 6.85ac shovel-ready industrial pad with 12in water tap installed (NKWD), sewer (SD1), Duke gas/electric, stormwater connected at NW corner. Best-in-class utility position. Frontage on AA Hwy / KY-9 (state highway) + Gloria Terrell Dr access. No flood expected (bluff above Licking River — verify FEMA panel). Tier 1 market — Cincy/N.KY metro per MT priority. Survey CLEAN (no easements crossing subject parcel). Strong density: 60.8K 3-mi pop, $66K HHI, 27K households. CARVE-OUT OPPORTUNITY: 4-4.5ac PS PRIMARY size (one-story CC) better fit than full 6.85ac; remainder could sell to Building Crafts (concrete plant) for expansion. KEY CONCERN: heavy industrial neighbors (Building Crafts concrete plant N, Castellini Leasing E, Valley Asphalt SW) — NOT consumer-friendly retail-feel corridor. KEY DRAG: flat 3-mi pop growth -0.07% (Newport-Bellevue-Wilder mature urban core declining; 5-mi positive +0.29% but doesn't help score). PS family 2.68 mi nearest — Cincy MSA heavily saturated (34 within 25 mi); spacing-gap play, NOT zero-PS market. Asking $2.895M ($422K/ac) — 44% above 11/9/2021 sale of $2,011,290 ($293K/ac before subdivision). Recommend offer ~$2.4M ($350K/ac) for full or carve-pro-rata. Broker SqFt Commercial Roddy MacEachen SIOR; site was sale-pending Feb 2026 then back on market 4/24/26 — prior buyer fell through, signal worth probing.",

  latestNote: "Vetted 4/28/26 for MT/east. ZONING by-right confirmed by Dan personally — Wilder Ordinance Article X I-2 #22 'Warehousing or wholesaling' (Feb 2025 PDF, p10-40). Survey CLEAN (subject 6.85ac has no easements; sewer easement is on adjacent 11.99ac MDG Wilder parcel). UTILITIES BEST-IN-CLASS: 12in water tap installed (NKWD), sewer (SD1), stormwater piped, Duke gas/electric — truly shovel-ready. CC SPC 2.05 underserved (Extra Space Newport 77K dominates 3-mi; rest legacy). PS family 2.68 mi nearest (Cincy saturated — spacing-gap play). YELLOW 7.93 — just under GREEN, dragged by flat 3-mi growth -0.07% (mature Newport-Bellevue urban core). KEY CONCERN: heavy industrial neighbors (concrete plant, asphalt, junkyard) = not consumer-friendly retail-feel corridor. CARVE OPPORTUNITY: 4-4.5ac SE corner = PS PRIMARY one-story CC size, smaller check, better neighbor distance, remainder sellable to Building Crafts for expansion. Broker Roddy MacEachen SIOR (SqFt Commercial) emailed 4/24 'back on market — engage?' after Feb sale-pending fell through. Recommend MT review.",
  latestNoteDate: "Apr 28, 2026",

  buyerStrategy: "PRIMARY: PS via MT (east region). Cincy/N.KY metro = MT Tier 1 priority. CC SPC underserved + utilities best-in-class. KEY OPEN QUESTION: is the 2.68mi nearest PS family facility close enough to make this a 'cannibalization' rather than 'spacing gap' play? MT to make the call. SECONDARY: Storage King (Andover) per §6h DW-rejects-to-SK rule. TERTIARY: Compass/Amsdell (family office, more flexible on industrial-corridor location specs); 10 Federal (tertiary-spec tolerant). NOT-A-FIT (industrial neighbors dilute brand): EXR, CubeSmart standard institutional plays.",

  dealType: "GU-FPS (Ground-Up, Fully Pad-Ready Shovel-ready) — site graded, all utilities installed, zoning by-right",

  redFlags: "(1) HEAVY INDUSTRIAL NEIGHBORS — concrete plant (Building Crafts Inc N), asphalt batching, equipment yards visible on flyer aerials pages 1+5. NOT consumer-friendly retail-feel corridor. (2) PRIOR SALE-PENDING FELL THROUGH — site under contract Feb 23, 2026 then back on market 4/24/26. Probe broker on why. (3) FLAT 3-MI POP GROWTH (-0.07%) — mature Newport-Bellevue-Wilder urban core declining. (4) FULL-RETAIL ASKING — $422K/ac is 44% above Nov 2021 sale; recommend $2.4M offer. (5) PS FAMILY DENSITY — 2.68mi nearest, 34 within 25mi; cannibalization vs spacing-gap question for MT.",

  keyStrengths: "(1) ZONING BY-RIGHT verified personally by Dan — I-2 #22 Warehousing covers our use. (2) UTILITIES BEST-IN-CLASS — 12in water tap installed, sewer connected, stormwater piped, Duke gas/electric — saves $400K-$1M typical for greenfield. (3) SHOVEL-READY graded pad. (4) CC SPC 2.05 UNDERSERVED — only 1 modern institutional CC operator (Extra Space Newport) in 3-mi ring. (5) SURVEY CLEAN — no easements crossing subject. (6) TIER 1 MARKET — Cincy/N.KY metro, MT priority. (7) STRONG DEMOGRAPHICS — 60.8K 3-mi pop, $66K HHI, $285K 5-mi home values. (8) CARVE-OUT OPTIONALITY — 4-4.5ac PS PRIMARY size achievable with seller-friendly remainder."
};

async function run() {
  try {
    await set(ref(db, `submissions/${key}`), record);
    console.log(`SUCCESS: ${key} written to submissions/`);
    console.log(`Dashboard: https://storvex.vercel.app/?site=${key}`);
    console.log(`Region suggested: east (MT). Dan routes via dashboard 'Approve & Route'.`);
    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
}
run();
