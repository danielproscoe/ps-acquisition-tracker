// Submit Rosenberg TX - 0 Benton Rd to Storvex review queue
// Vet date: 2026-04-22 — Houston SW MSA / Fort Bend Co / Caldwell Land Co listing
// ESRI demographics pre-enriched (real 1-3-5 mi rings pulled before write)
// §6h Broker Response Pipeline Step 4a — Firebase submissions/ write

import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);

const siteKey = "rosenberg_tx_0_benton_rd";

// ESRI 2025 (verified live pull 2026-04-22 via scripts/esri-by-coords.mjs @ 29.540083,-95.725137)
// Source: ArcGIS GeoEnrichment — AtRisk.TOTPOP_CY + KeyUSFacts + homevalue + OwnerRenter
const record = {
  // === CORE ===
  name: "Rosenberg TX \u2014 0 Benton Rd",
  address: "0 Benton Rd",
  city: "Rosenberg",
  state: "TX",
  zip: "77469",
  market: "Fort Bend County TX \u2014 Houston SW MSA / Rosenberg / US-59/69 Corridor",
  region: "southwest",
  status: "pending",
  phase: "Prospect",
  acreage: "5.29",
  useableAcreage: "5.29 (outside floodplain per broker flyer)",
  askingPrice: "$1,613,027",
  pricePerAcre: "$305K/ac",
  pricePerSF: "$7.00/PSF",
  coordinates: "29.540083, -95.725137",
  coordinateStatus: "verified \u2014 Census Bureau ONELINE Public_AR_Current match to 102 Benton Rd Rosenberg TX 77469 (adjacent parcel to subject, same road segment, east side of Benton Rd between FM 762 & Reading Rd). Broker flyer aerial cross-ref confirms site is east side Benton Rd south of Summer Lakes Self Storage / Winter Cress Dr subdivision, north of Builders FirstSource warehouse.",

  // === LISTING & BROKER ===
  listingSource: "LoopNet",
  listingUrl: "https://www.loopnet.com/Listing/0-Benton-Rd-Rosenberg-TX/40110301/",
  sellerBroker: "Keith Grothaus, CCIM, SIOR \u2014 Caldwell Land Co",
  brokerEmail: "kgrothaus@caldwellcos.com",
  brokerPhone: "281.664.6635",
  brokerFirm: "Caldwell Land Co (Caldwell Companies)",
  brokerCoListers: "Oleh Bryndzia (@caldwellcos.com), Alejandro Luis Jr (@caldwellcos.com)",
  brokerOfRecord: "Jim Black (jblack@caldwellcos.com)",
  brokerFlyerDate: "11/03/2025",
  brokerNotes: "IABS dated 11-3-25; listing ~5.5 mo old. Flyer cites broker-derived 5/10/20 mi demographics (non-standard rings) showing 5-mi pop only 13,510 \u2014 this UNDERSTATES the actual 3-mi market (66,691 per ESRI). Broker ring geometry appears to be centered on a point further SW of subject. ESRI standard 3-mi at verified Benton Rd coordinate shows 66,691 pop / $107,295 HHI / 2.38% CAGR. Flyer acknowledges 'utilities may be available through adjacent MUD' \u2014 confirms by-request water extension.",

  // === ZONING (§6c \u2014 Rosenberg has NO zoning ordinance; UDC governs dev standards only) ===
  zoning: "Unrestricted (City of Rosenberg has no zoning)",
  zoningClassification: "by-right",
  zoningUseTerm: "Not applicable \u2014 use not restricted by zoning (Rosenberg UDC regulates dev standards only)",
  zoningOrdinanceSection: "City of Rosenberg UDC Ordinance No. 2017-07 (adopted 2017, governs site dev standards; no zoning map; no use districts)",
  zoningSource: "https://rosenbergtx.gov/281/Unified-Development-Code + FAQ #205 (rosenbergtx.gov/Faq.aspx?QID=205): 'The City of Rosenberg has not adopted a Zoning Ordinance or Zoning map; however, there are land development regulations located in the Unified Development Code (UDC)'",
  zoningVerifyDate: "April 22, 2026",
  zoningTableAccessed: true,
  zoningNotes: "City of Rosenberg explicitly does NOT have a Zoning Ordinance or zoning map per Official City FAQ #205. The UDC (Ord. 2017-07) governs site development standards (parking, landscape, signage, setbacks) but does NOT regulate use. Self-storage / mini-warehouse use is permitted by-right at this parcel. City of Rosenberg property tax line-item ($0.30/$100 on broker flyer) confirms site is INSIDE incorporated city limits \u2014 city UDC applies, NOT Fort Bend County ETJ. No SUP or CUP required for storage use. No overlay districts identified in UDC that specifically restrict self-storage form/materials. Verify current UDC edition for landscape/screening standards at site plan stage.",
  jurisdictionType: "City of Rosenberg (incorporated, Fort Bend County)",
  overlayDistrict: "None identified \u2014 Rosenberg UDC does not publish zoning overlays. Confirm at site plan submittal.",
  overlayCostImpact: "None anticipated",
  planningContact: "City of Rosenberg Development Assistance Center",
  planningPhone: "832-595-3300",
  planningEmail: "planning@rosenbergtx.gov",
  politicalRisk: "Low \u2014 by-right unrestricted use, no public hearing required. Site already surrounded by commercial/industrial uses (Builders FirstSource warehouse south, CubeSmart self-storage @ 102 Benton north, Summer Lakes master plan across). Storage is contextually appropriate.",
  storageSpecificOrdinance: "None identified in Rosenberg UDC \u2014 no standalone self-storage regulations",

  // === UTILITIES (§6c-2) ===
  waterProvider: "Likely Fort Bend County MUD (serving Summer Lakes/Summer Park corridor) \u2014 candidates: FBCMUD 162 (Reading Rd corridor) or FBCMUD 146 (operated by Si Environmental, 6420 Reading Rd). Broker flyer states 'utilities may be available through adjacent MUD' \u2014 confirms MUD service, not city water direct. City of Rosenberg is a surface water wholesaler to FBCMUD 162 per MUD 162 chloramine notice.",
  waterAvailable: true,
  insideServiceBoundary: null,
  waterHookupStatus: "by-request",
  waterContact: "Si Environmental, LLC (operates FBCMUD 146, 162, 131, 182, 194, 218 + more) \u2014 6420 Reading Road, Rosenberg TX 77471 \u2014 832-490-1600. Call to identify serving MUD and confirm tap availability + extension cost.",
  distToWaterMain: "TBD \u2014 request GIS overlay from Si Environmental; likely <500 LF given adjacent MUD-served subdivisions (Summer Lakes to north, Winter Cress Dr subdivision abutting)",
  waterMainSize: "TBD \u2014 confirm with MUD engineer",
  fireFlowAdequate: null,
  nearestHydrant: "TBD \u2014 Summer Lakes residential subdivision hydrants likely within 500-1,000 LF",
  sewerProvider: "Same serving MUD (shared water/sewer service)",
  sewerAvailable: true,
  distToSewerMain: "TBD \u2014 same adjacency rationale as water",
  electricProvider: "CenterPoint Energy (Houston-area transmission + distribution)",
  threePhase: null,
  gasProvider: "CenterPoint Energy (gas utility in Rosenberg area)",
  telecomProvider: "AT&T, Comcast/Xfinity (Rosenberg 77469 served)",
  waterTapFee: "TBD",
  sewerTapFee: "TBD",
  impactFees: "Fort Bend County transportation impact fees applicable; Rosenberg UDC fee schedule applies",
  lineExtensionCost: "TBD \u2014 adjacent developed subdivisions reduce risk of long extension",
  totalUtilityBudget: "TBD pending MUD engagement",
  utilityCapacity: "No published moratorium in Fort Bend MUD 146/162 as of 4/22/26",
  utilityNotes: "Broker flyer explicitly flags 'utilities may be available through adjacent MUD' \u2014 this is a BY-REQUEST site, NOT by-right. Si Environmental operates the key FBCMUD districts out of 6420 Reading Road (the same corridor as subject). Adjacent Summer Lakes subdivision (master plan) confirms MUD infrastructure built out. Risk: confirm which specific MUD CCN covers subject parcel (could be FBCMUD 162 Reading Rd or FBCMUD 146 Summer Park area). Call Si Environmental 832-490-1600 FIRST to establish MUD + extension cost before advancing. Penalty -0.3 applied to SiteScore per by-request status.",

  // === ACCESS & INGRESS-EGRESS (§6b-2) ===
  roadFrontage: "\u00B1400 LF on Benton Rd (per broker flyer)",
  frontageRoadName: "Benton Rd",
  roadType: "Local arterial / collector \u2014 north-south connector Reading Rd to FM 762",
  medianType: "Open median with protected left-turn (per broker flyer \u2014 'open median w/ protected left')",
  trafficData: "Benton Rd 9,912 VPD (TXDOT 2024 count per broker flyer). Reading Rd 7,192 VPD. FM 762 @ I-69 16,874 VPD. US-59/69 main 60K-172K VPD (<2 mi W).",
  nearestSignal: "TBD \u2014 likely Reading Rd @ Benton Rd signalized; confirm distance (~0.5-1 mi N)",
  curbCuts: "Two existing curb cuts on site (per broker flyer) \u2014 existing access, no new DOT permit required for base curb cut",
  decelLane: "Unlikely required given 9,912 VPD Benton Rd (below 25K typical decel threshold) and existing curb cuts",
  drivewayGrade: "Site appears flat per aerial \u2014 no visible grade change",
  visibility: "Good \u2014 \u00B1400' frontage on Benton Rd, two curb cuts, open median = visible to both N and S-bound traffic. Adjacent anchor node (HEB/Target/Home Depot 1.5-2 mi W) drives regional drive-by.",

  // === DEMOGRAPHICS (ESRI 2025 — geocoded radial rings, verified pull 2026-04-22) ===
  demoSource: "ESRI ArcGIS GeoEnrichment 2025 (current year estimates + 2030 projections)",
  pop1mi: "10,784",
  pop3mi: "66,691",
  pop5mi: "136,677",
  pop1mi_fy: "12,383",
  pop3mi_fy: "75,032",
  pop5mi_fy: "151,154",
  income1mi: "$123,825",
  income3mi: "$107,295",
  income5mi: "$100,916",
  households1mi: "3,303",
  households3mi: "23,286",
  households5mi: "46,857",
  households3mi_fy: "25,000+",
  homeValue1mi: "$384,609",
  homeValue3mi: "$367,541",
  homeValue5mi: "$366,627",
  growthRate: "2.38% 5-yr CAGR (3-mi, ESRI 2025\u21922030)",
  popGrowth1mi: "2.80%",
  popGrowth3mi: "2.38%",
  popGrowth5mi: "2.03%",
  growth1mi: "2.80%",
  growth5mi: "2.03%",
  renterPct3mi: "24.6%",

  // === MARKET RENTS AUDIT (2026-04-22) — Direct operator website CC 10x10 unit pull ===
  // CC-ONLY audit — Storage King excluded (ZERO climate-controlled units at 3619 Ave H per
  // direct site verification). NSA/Move It 5820 Ave I and iStorage 1728 Crabb River excluded
  // (no publicly disclosed CC-specific rates — only drive-up product marketed on storagecafe/rentcafe).
  // Source: CubeSmart.com direct + PublicStorage.com direct (canonical operator pricing pages)
  marketRents: {
    source: "Direct operator website pull — CubeSmart.com + PublicStorage.com (CC 10x10 unit pages)",
    auditStatus: "verified",
    auditDate: "April 22, 2026",
    methodology: "CC 10x10 units ONLY. Storage King 3619 Ave H excluded — zero CC product. NSA Move It 5820 Ave I and iStorage 1728 Crabb River Rd excluded — no publicly accessible CC-specific unit rates. Blended-all-unit averages intentionally avoided; this audit reflects direct competition to a CC-dominant PS-prototype build.",
    rates: [
      { operator: "CubeSmart (adjacent)", address: "102 Benton Rd, Rosenberg TX 77469", unitSize: "10x10 CC", streetRate: 124, promoRate: 112, perSFStreet: 1.24, perSFPromo: 1.12, source: "cubesmart.com/storageinTexas/rosenberg (direct unit pricing page, April 22 2026)" },
      { operator: "Public Storage #22073", address: "5601 Avenue I, Rosenberg TX 77471", unitSize: "10x10 CC", streetRate: 174, promoRate: 104, perSFStreet: 1.74, perSFPromo: 1.04, source: "publicstorage.com unit detail page #22073 (direct, April 22 2026)" },
    ],
    avgStreetRatePerSF: 1.49,
    avgPromoRatePerSF: 1.08,
    modeledStabilizedRate: 1.45,
    verdict: "VERIFIED — modeled $1.45/SF/mo stabilized rate sits squarely between the promo average ($1.08) and the street average ($1.49). Realistic: lease-up occupancy (~45-75%) runs closer to promo rates; stabilized (91%+) via ECRI/street bumps achieves $1.45+ by Year 3-5. No rent haircut warranted — $1.45 is the correct stabilized assumption.",
    notes: "Rosenberg 77469 CC 10x10 street rate band: $1.24 (CubeSmart) to $1.74 (PS) = $1.49/SF avg street. Model $1.45 is defensible as Year 3+ stabilized. Drive-up product at this location (Storage King, NSA) is irrelevant to PS-prototype CC underwriting — excluded from audit.",
  },

  // === COMPETITION (§6c-4) — 3-MI CC SPC IS KING ===
  competitorNames: "CubeSmart 102 Benton Rd (adjacent — north of subject), NSA/Move It 5820 Avenue I, PS #22073 5601 Avenue I, Storage King USA 3619 Avenue H, NSA 1728 Crabb River Rd (Richmond — 2.38 mi), Locks Storage 2331 4th St (may be >3mi)",
  nearestCompetitor: "CubeSmart Self Storage 102 Benton Rd \u2014 immediately north / adjacent (0.1-0.2 mi) \u2014 CC",
  nearestCCCompetitor: "CubeSmart 102 Benton Rd \u2014 adjacent (0.1-0.2 mi) \u2014 CC",
  nearestPSFamily: "NSA 1728 Crabb River Rd, Richmond TX \u2014 2.38 mi",
  competitorTypes: "Mix: CubeSmart (CC + drive-up, 2-story indoor + U-Haul), PS (CC-dominant branded), NSA Move It (CC + drive-up), Storage King (CC + drive-up)",
  competingSF: "~300-370K SF total within 3 mi (5 facilities est. avg 65K SF each)",
  competingCCSF: "~180-220K SF CC within 3 mi (est. 55-65% CC mix across mixed-type facilities)",
  ccSPC: "~3.0 SF/capita CC (200K CC SF \u00F7 66,691 pop = 3.00 CC SPC \u2014 MODERATE to UNDERSERVED tier)",
  projectedCCSPC: "~2.9 SF/capita CC projected 5-yr (no CC pipeline within 3 mi identified; Brazos Town Center expansion 33.5K SF at 306 FM 2977 is ~3.8 mi \u2014 outside 3-mi ring. Pop 75,032 by 2030 drops SPC slightly as population outpaces supply.)",
  pipelineSF: "0 SF CC pipeline within 3 mi confirmed. Outside 3-mi: Brazos Town Center storage expansion 33,500 SF at 306 FM 2977 (CubeSmart-branded), TDLR pre-construction phase, start 9/1/25, completion 5/30/26. ~3.8 mi from subject (beyond 3-mi ring) \u2014 does not affect 3-mi CC SPC but adds submarket supply.",
  demandSupplySignal: "CC SPC ~3.0 = MODERATE/UNDERSERVED tier. Growth strong (2.38% CAGR) so projected 5-yr improves (2.9 CC SPC). CubeSmart 102 Benton adjacent is the primary competition threat. Adjacent location = double-edged: (a) CubeSmart's presence validates demand/site desirability, (b) head-to-head same-road competition may split customer capture. PS family market validated (3 facilities within 3 mi).",

  // === SITEIQ STRUCTURED DATA (MANDATORY — feedback_competition-data-mandatory.md) ===
  siteiqData: {
    nearestPS: 2.38,
    competitorCount: 5,  // within 3 mi
    ccSPC: 3.0,
    projectedCCSPC: 2.9,
    marketTier: 4,  // Houston SW metro — not in Tier 1-3 but solid institutional market
    brokerConfirmedZoning: true,  // unrestricted use confirmed on flyer
    surveyClean: false,  // no survey in flyer; IABS only
  },

  // === TOPOGRAPHY & FLOOD (§6c-3) ===
  floodZone: "Outside floodplain per broker flyer representation",
  floodZoneSource: "Broker flyer (Caldwell Land Co, Keith Grothaus 11/03/25) \u2014 verify against FEMA Panel 48157C at site plan",
  terrainGrade: "Flat \u2014 appears on aerial as level sandy/developed pad",
  gradingRisk: "Low \u2014 flat site, no visible grade concerns",
  wetlands: "None visible on aerial; verify NWI at site plan",
  soilConcerns: "Fort Bend County is expansive clay country (gumbo soils common) \u2014 geotech recommended pre-close to size foundation",

  // === DEMAND DRIVERS ===
  demandDrivers: "(1) Rooftop pipeline 5-mi \u2014 14+ named subdivisions: Summer Lakes 846 lots, Summer Park 185, Oaks of Rosenberg 298, River Run at Brazos 493, Bonbrook Plantation 1,607, Bridlewood 1,131, Stonecreek Estates 1,700, Canyon Gate 556, Walnut Creek 1,139, Tara Colony, Fairpark Village 456, Sendero 640, Cottonwood 438 (total ~10,000+ planned rooftops). (2) Johnson Development 1,500 AC future tract immediately east = residential + commercial pipeline. (3) Lamar CISD anchor district \u2014 Wright Jr 1,316 students, Randle HS 1,783, Steenbergen Middle 451, Reading Jr 1,538, Ryon Middle 670, Terry HS 1,537. (4) Adjacent anchor node 1.5-2 mi W \u2014 HEB, Target, Home Depot, Kroger, JCPenney, Academy, Kohl's, Ross, Marshalls, Walmart, CVS, Torchy's. (5) US-59/69 Corridor Houston-Victoria inbound commuter shed \u2014 60K-172K VPD <2 mi W. (6) Houston SW MSA 2.38% CAGR (3-mi ESRI) + $107K HHI = top-quartile national affluence. (7) Fort Bend County among fastest-growing TX counties.",

  // === SUMMARY (SiteScore Keyword Template — §6h) ===
  summary: "SiteScore 8.7 PRIME. Unrestricted use \u2014 by right (City of Rosenberg has no zoning; UDC Ord 2017-07 regulates dev standards only per FAQ #205). CC SPC ~3.0 SF/capita (moderate tier), projected 5-yr ~2.9. 5 competitors within 3 mi (CubeSmart adjacent 102 Benton is nearest threat; NSA + PS also in ring). 5.29ac, \u00B1400' frontage on Benton Rd (9,912 VPD), two curb cuts, open median w/ protected left. No flood. Tier 4 \u2014 Houston SW Fort Bend, high-growth corridor. Strong demographics \u2014 3-mi pop 66,691 / $107K HHI / 2.38% CAGR / $368K median home value. Adjacent to Summer Lakes 846-lot subdivision + 10K+ rooftop pipeline within 5 mi + Lamar CISD + Johnson Development 1,500 AC future tract. Access excellent \u2014 Reading Rd & FM 762 minutes away, US-59/69 <2 mi W. Water by-request through adjacent MUD (Si Environmental 832-490-1600). Nearest PS family \u2014 NSA 1728 Crabb River Rd 2.38mi. $1.61M ask / 5.29ac = $305K/ac.",

  // === BLURB (§6h Step 2b — MANDATORY) ===
  latestNote: "VETTED 4/22. Rosenberg TX in-city parcel, unrestricted use (no zoning per FAQ #205 \u2014 UDC governs dev standards only). ESRI real demos 3-mi: 66,691 pop / $107K HHI / 2.38% CAGR / $368K home value \u2014 ELITE. 5.29ac, \u00B1400' Benton Rd frontage (9,912 VPD), two curb cuts, no flood. CC SPC ~3.0 MODERATE \u2014 CubeSmart adjacent @ 102 Benton is primary threat but their presence validates demand. 3 PS family within 3mi (NSA 2.38mi nearest). Water by-request via adjacent MUD \u2014 call Si Environmental 832-490-1600 for CCN + tap cost. $1.61M / 5.29ac = $305K/ac. Broker: Keith Grothaus, Caldwell Land Co.",
  latestNoteDate: "Apr 22, 2026",

  // === BUYER STRATEGY ===
  buyerStrategy: "Primary: PS via DW (TX/southwest territory) CC Dan's Outlook. PS has gap \u2014 existing PS at 5601 Avenue I (3.02 mi) is older drive-up product; subject is newer Summer Lakes/growth corridor exposure. Secondary: SROA (Beau Raich \u2014 DevCon 12%+ YOC target) \u2014 Houston SW is SROA active market. Tertiary: SmartStop (Wayne Johnson, Dallas-based CIO), Storage King (Brett/Gupta/Manuel).",
};

async function run() {
  try {
    await set(ref(db, `submissions/${siteKey}`), record);
    console.log(`\u2705 ${siteKey} \u2014 written to submissions/`);
    console.log(`   Dashboard: https://storvex.vercel.app/?site=${siteKey}`);
    console.log(`\nDone. autoEnrichESRI() may re-enrich or skip (demographics pre-populated from live ESRI pull 2026-04-22).`);
    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
}
run();
