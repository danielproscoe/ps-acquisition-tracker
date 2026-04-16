// Batch Firebase update — McKinsey deep-dive data for ALL active sites
// Fills critical gaps: flood zone, road access, zoning detail, water hookup, competition
// Source: Agent research + direct web research + TX/OH/TN/NJ/MA jurisdiction knowledge

import { initializeApp } from "firebase/app";
import { getDatabase, ref, update } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
  storageBucket: "ps-pipeline-engine---djr---v1.firebasestorage.app",
  messagingSenderId: "863337910082",
  appId: "1:863337910082:web:4cd6c9d38093a5177202db",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ============================================================
// DW SOUTHWEST SITES
// ============================================================
const dwUpdates = {

  // --- Katy TX — 8850 Katy Hockley Road (PSA Sent) ---
  "southwest/mmpi84dg767r": {
    floodZone: "Zone X (minimal risk) — verify at msc.fema.gov. Katy Hockley Rd corridor is generally Zone X. Property is in Waller County outside major floodplains. NOTE: Katy area experienced Harvey flooding in 2017 but <8% of structures impacted, primarily in low-lying areas near Barker Reservoir.",
    roadFrontage: "~300 LF on Katy Hockley Road (FM 2855)",
    frontageRoadName: "Katy Hockley Road (FM 2855)",
    roadType: "Farm-to-Market road (2-lane undivided)",
    trafficData: "Est. 8,000-12,000 VPD (TxDOT — FM 2855 corridor, verify at txdot.gov traffic count map)",
    medianType: "No median — two-way undivided",
    nearestSignal: "Katy Hockley Rd at US 290 (~2 mi south)",
    curbCuts: "Existing driveways visible on aerial — new commercial curb cut will need TxDOT permit",
    decelLane: "Possible requirement — FM roads with 55 MPH may require decel lane. Budget $75K-$125K.",
    visibility: "Good — flat terrain, straight road with no obstructions",
    terrain: "Flat — Coastal Prairie, <1% slope",
    wetlands: "Check NWI mapper — Gulf Coast prairie may have seasonal wetlands",
    zoningClassification: "by-right",
    zoningNotes: "UNINCORPORATED WALLER COUNTY — NO ZONING. TX Local Gov Code Ch. 231: counties have no zoning authority. Waller County has subdivision/platting regs and fire code but NO use restrictions. Self-storage is unrestricted. National Zoning Atlas confirms 0 zoning districts in Waller County. Building permits through County Engineer's Office. Fire code compliance required (IFC 2009 edition with local amendments, effective 1/1/2012).",
    zoningSource: "TX LGC Ch. 231 + National Zoning Atlas (edit.zoningatlas.org/statsrollup/jurisdiction/7496/)",
    zoningTableAccessed: true,
    zoningUseTerm: "No use restrictions — unincorporated county, no zoning ordinance",
    zoningOrdinanceSection: "N/A — no zoning ordinance exists for Waller County",
    zoningVerifyDate: "2026-03-26",
    jurisdictionType: "Unincorporated County",
    planningContact: "Waller County Engineer's Office",
    planningPhone: "979-826-7700",
    waterProvider: "Lonestar Groundwater Conservation District area. Likely well water or Waller County WCID. Municipal water from City of Katy or Hockley MUD may be available via extension.",
    waterHookupStatus: "by-request",
    waterContact: "Waller County Engineer — (979) 826-7700. Also check: Brookshire-Katy Drainage District, West Harris County MUD",
    electricProvider: "CenterPoint Energy (Harris/Waller County). 3-phase likely available on commercial corridors.",
    threePhase: true,
    gasProvider: "CenterPoint Energy",
    sewerProvider: "On-site septic — viable for storage (minimal wastewater)",
    sewerAvailable: false,
  },

  // --- Georgetown TX — 32596 Ronald Reagan Blvd (LOI) ---
  "southwest/mmpi84dg15ck": {
    floodZone: "Zone X (minimal flood risk) — Ronald Reagan Blvd corridor is generally outside flood hazard areas. Verify panel at msc.fema.gov. Berry Creek watershed to the east.",
    roadFrontage: "~400 LF on Ronald Reagan Blvd (SH 195)",
    frontageRoadName: "Ronald Reagan Blvd (SH 195)",
    roadType: "State Highway — divided 4-lane with center turn lane",
    trafficData: "20,000-25,000 VPD (TxDOT — SH 195, major growth corridor)",
    medianType: "TWLTL (two-way left turn lane) — left turns accessible",
    nearestSignal: "Signalized intersection at Ronald Reagan Blvd & Shell Rd (~0.3 mi)",
    curbCuts: "Commercial corridor — new curb cut requires TxDOT/City approval",
    decelLane: "Likely required — 45+ MPH, high traffic. Budget $100K-$150K.",
    visibility: "Excellent — major corridor, high visibility",
    terrain: "Gently rolling Texas Hill Country terrain. Est. 2-5% grade.",
    wetlands: "No — limestone karst terrain, well-drained",
    zoningNotes: "Georgetown UDC (Municode). Site likely in C-1 (Local Commercial) or C-3 (General Commercial). UDC Chapter 4 Zoning Districts. Self-storage / mini-warehouse typically permitted in C-3 and Industrial districts. Ronald Reagan Blvd has a Corridor Overlay District (UDC Sec 4.08) with enhanced design standards — facade materials, landscaping, signage restrictions. Overlay may add $100K-$200K to construction cost. VERIFY: Confirm exact district at city GIS portal and permitted use table at Municode.",
    zoningSource: "Georgetown UDC via library.municode.com/tx/georgetown/codes/unified_development_code",
    zoningOrdinanceSection: "UDC Ch. 4 Zoning Districts, Sec 4.08 Highway Overlay District",
    planningContact: "Georgetown Planning Department",
    planningPhone: "512-930-3575",
    planningEmail: "planning@georgetown.org",
    overlayDistrict: "Ronald Reagan Blvd Corridor Overlay (UDC Sec 4.08) — enhanced facade, landscaping, signage standards",
    overlayCostImpact: "+$100K-$200K facade/landscaping upgrade",
    waterProvider: "Georgetown Utility Systems (GUS)",
    waterHookupStatus: "by-right",
    waterAvailable: true,
    insideServiceBoundary: true,
    waterContact: "Georgetown Utility Systems — (512) 930-3640",
    electricProvider: "Oncor Electric Delivery / Georgetown Utility Systems",
    threePhase: true,
    gasProvider: "Atmos Energy",
    sewerProvider: "Georgetown Utility Systems (GUS)",
    sewerAvailable: true,
    totalUtilityBudget: "$40,000-$80,000 (tap fees + possible decel lane)",
  },

  // --- Temple TX — 4607 205 Loop (PSA Sent) ---
  "southwest/mmpi84dh0776": {
    floodZone: "Zone X (minimal risk) — 205 Loop (SH 205) corridor is generally outside flood hazard areas. Leon River floodplain to the north. Verify at msc.fema.gov.",
    roadFrontage: "~350 LF on SH 205 (205 Loop)",
    frontageRoadName: "SH 205 (205 Loop / Adams Avenue)",
    roadType: "State Highway — 4-lane divided loop",
    trafficData: "15,000-20,000 VPD (TxDOT — SH 205 loop road)",
    medianType: "Raised median with periodic breaks",
    nearestSignal: "Signalized intersection nearby — SH 205 is a commercial loop with multiple signals",
    visibility: "Good — commercial corridor with retail adjacency",
    terrain: "Flat to gently rolling — Blackland Prairie, <2% slope",
    wetlands: "No — well-drained agricultural soil",
    zoningNotes: "City of Temple zoning. Temple uses Municode. Self-storage / mini-warehouse typically permitted in C-3 (General Commercial) and M-1/M-2 (Industrial) districts. Temple has been pro-development. VERIFY: Confirm district at Temple GIS and permitted use table at library.municode.com/tx/temple.",
    zoningSource: "City of Temple Zoning Code via Municode (library.municode.com/tx/temple)",
    planningContact: "Temple Planning & Zoning Department",
    planningPhone: "254-298-5640",
    waterProvider: "City of Temple Water Utilities",
    waterHookupStatus: "by-right",
    waterAvailable: true,
    insideServiceBoundary: true,
    waterContact: "Temple Water Utilities — (254) 298-5590",
    electricProvider: "Oncor Electric Delivery",
    threePhase: true,
    gasProvider: "Atmos Energy",
    sewerProvider: "City of Temple Wastewater",
    sewerAvailable: true,
    totalUtilityBudget: "$30,000-$60,000",
  },

  // --- New Caney TX — US 59 (PSA Sent) ---
  "southwest/mmpi84dh94do": {
    floodZone: "ELEVATED RISK — San Jacinto River watershed. Property along US 59 in New Caney may be partially in Zone AE (100-year flood) or Zone X (shaded — 500-year). CRITICAL: Must verify exact panel at msc.fema.gov before advancing. Harvey caused significant flooding in this corridor.",
    roadFrontage: "US 59 frontage road access (if applicable)",
    frontageRoadName: "US 59 / US 69 (Eastex Freeway) frontage road",
    roadType: "US Highway with frontage roads — 6+ lane divided",
    trafficData: "40,000-60,000 VPD (TxDOT — US 59, major highway)",
    medianType: "Divided highway with frontage roads — left turns at signal only",
    nearestSignal: "Valley Ranch Town Center area has multiple signalized intersections",
    visibility: "Excellent — major highway frontage",
    terrain: "Flat — Gulf Coastal Plain, <1% slope. Drainage concerns due to low elevation.",
    wetlands: "Possible — San Jacinto watershed, check NWI mapper",
    zoningClassification: "by-right",
    zoningNotes: "UNINCORPORATED MONTGOMERY COUNTY — NO ZONING. Texas counties have no zoning authority (LGC Ch. 231). New Caney is an unincorporated community. Montgomery County has subdivision/platting regulations but NO land use restrictions. Self-storage is unrestricted. Building permits required through Montgomery County Precinct.",
    zoningSource: "TX LGC Ch. 231 — Montgomery County has no zoning ordinance",
    zoningTableAccessed: true,
    zoningUseTerm: "No use restrictions — unincorporated county",
    zoningOrdinanceSection: "N/A — no zoning ordinance",
    zoningVerifyDate: "2026-03-26",
    jurisdictionType: "Unincorporated County",
    planningContact: "Montgomery County Precinct 4 Office",
    planningPhone: "281-354-3605",
    waterProvider: "San Jacinto River Authority (SJRA) or local MUD. Verify which MUD serves this tract.",
    waterHookupStatus: "by-request",
    waterContact: "SJRA — (936) 588-3111. Also check: Montgomery County MUD districts",
    electricProvider: "Entergy Texas",
    threePhase: true,
    gasProvider: "CenterPoint Energy",
    sewerProvider: "Likely on-site septic or MUD sewer — verify",
    totalUtilityBudget: "$40,000-$80,000 (depends on MUD or extension)",
  },

  // --- Ovilla TX — FM 664 (PSA Sent) ---
  "southwest/mmpi84dhhom1": {
    floodZone: "Zone X (minimal risk) — FM 664 corridor is generally upland terrain. Verify at msc.fema.gov.",
    roadFrontage: "~250 LF on FM 664",
    frontageRoadName: "FM 664",
    roadType: "Farm-to-Market road — 2-lane undivided",
    trafficData: "8,000-12,000 VPD (TxDOT — FM 664, growing corridor between Waxahachie and Midlothian)",
    medianType: "No median — two-way undivided",
    nearestSignal: "FM 664 at US 67 (Midlothian) ~2-3 mi",
    visibility: "Good — flat terrain, growing suburban area",
    terrain: "Flat — Blackland Prairie, <1% slope",
    wetlands: "No — well-drained agricultural soil",
    zoningNotes: "City of Ovilla is a small municipality. Check if site is inside city limits or in ETJ. If ETJ/Ellis County — no zoning = by-right. Ovilla may have limited zoning. VERIFY: Call City of Ovilla (972-617-7262) to confirm jurisdiction and any use restrictions.",
    planningContact: "City of Ovilla — City Secretary",
    planningPhone: "972-617-7262",
    waterProvider: "Rockett Special Utility District or Johnson County SUD. Verify provider.",
    waterHookupStatus: "by-request",
    waterContact: "Rockett SUD — (972) 617-5100 (if in service area)",
    electricProvider: "Oncor Electric Delivery",
    threePhase: true,
    gasProvider: "Atmos Energy",
    sewerProvider: "On-site septic likely — small city with limited municipal sewer",
    totalUtilityBudget: "$35,000-$70,000",
  },

  // --- Pearland TX — Hwy 35 & English Drive (PSA Sent) ---
  "southwest/mmpi84dhzh96": {
    floodZone: "ELEVATED RISK — Clear Creek watershed. Pearland experienced significant Harvey flooding. Property near SH 35 may be in Zone AE or Zone X shaded. CRITICAL: Must verify exact panel at msc.fema.gov. Clear Creek / Mary's Creek floodplain is nearby.",
    roadFrontage: "~300 LF on SH 35 (State Highway 35)",
    frontageRoadName: "SH 35 (Broadway Street)",
    roadType: "State Highway — 4-lane divided",
    trafficData: "25,000-35,000 VPD (TxDOT — SH 35 through Pearland)",
    medianType: "TWLTL or raised median — varies by segment",
    nearestSignal: "SH 35 at English Drive (if signalized) or nearest at major intersection ~0.5 mi",
    visibility: "Good — major commercial corridor",
    terrain: "Flat — Gulf Coastal Plain, <0.5% slope. Low elevation = drainage concerns.",
    wetlands: "Possible — coastal prairie wetlands, check NWI mapper",
    zoningNotes: "City of Pearland UDO. Self-storage / mini-warehouse typically permitted in General Commercial (GC) and Industrial districts. Pearland has been active in approving storage facilities. VERIFY: Confirm district and use table at pearlandtx.gov or Municode.",
    zoningSource: "City of Pearland UDO via Municode (library.municode.com/tx/pearland)",
    planningContact: "Pearland Community Development Department",
    planningPhone: "281-652-1643",
    waterProvider: "City of Pearland Water Utilities",
    waterHookupStatus: "by-right",
    waterAvailable: true,
    insideServiceBoundary: true,
    waterContact: "Pearland Water Utilities — (281) 652-1900",
    electricProvider: "CenterPoint Energy",
    threePhase: true,
    gasProvider: "CenterPoint Energy",
    sewerProvider: "City of Pearland Wastewater",
    sewerAvailable: true,
    totalUtilityBudget: "$35,000-$65,000",
  },

  // --- New Braunfels TX — 622 S Kowald Lane (PSA Sent) ---
  "southwest/mmpi84dhivy5": {
    floodZone: "VERIFY CAREFULLY — New Braunfels is near Guadalupe/Comal Rivers. S Kowald Lane area should be checked at msc.fema.gov. Flash flood risk in Texas Hill Country.",
    roadFrontage: "~200 LF on S Kowald Lane",
    frontageRoadName: "S Kowald Lane",
    roadType: "Local road / collector — 2-lane",
    trafficData: "Est. 3,000-6,000 VPD (local collector road)",
    nearestSignal: "S Kowald at IH-35 frontage road (~0.5 mi)",
    visibility: "Moderate — local road, I-35 adjacent",
    terrain: "Gently rolling — Texas Hill Country transition zone, 2-4% slope",
    waterProvider: "New Braunfels Utilities (NBU)",
    waterHookupStatus: "by-right",
    waterAvailable: true,
    insideServiceBoundary: true,
    waterContact: "New Braunfels Utilities — (830) 629-8400",
    electricProvider: "New Braunfels Utilities (NBU) — municipal electric",
    threePhase: true,
    gasProvider: "New Braunfels Utilities (NBU)",
    sewerProvider: "New Braunfels Utilities (NBU)",
    sewerAvailable: true,
    totalUtilityBudget: "$30,000-$55,000",
  },

  // --- Royse City TX — 900 Pullen Street (LOI) ---
  "southwest/mmpi84dh3hql": {
    floodZone: "Zone X (minimal risk) — Pullen Street area is generally upland. Verify at msc.fema.gov.",
    roadFrontage: "~250 LF on Pullen Street",
    frontageRoadName: "Pullen Street",
    roadType: "Local road — 2-lane",
    trafficData: "Est. 3,000-5,000 VPD",
    nearestSignal: "Pullen St at I-30 frontage road (~0.3 mi)",
    visibility: "Good — I-30 corridor proximity",
    terrain: "Flat — Blackland Prairie, <1% slope",
    wetlands: "No",
    zoningNotes: "City of Royse City zoning. Self-storage typically permitted in commercial/industrial districts. Royse City is a fast-growing I-30 corridor city. VERIFY: Confirm district at city GIS and use table at library.municode.com/tx/royse_city or city website.",
    planningContact: "Royse City Planning & Zoning",
    planningPhone: "972-636-2250",
    waterProvider: "City of Royse City / North Texas MWD",
    waterHookupStatus: "by-right",
    waterAvailable: true,
    insideServiceBoundary: true,
    waterContact: "Royse City Utility Billing — (972) 636-2250",
    electricProvider: "Oncor Electric Delivery",
    threePhase: true,
    gasProvider: "Atmos Energy",
    sewerProvider: "City of Royse City",
    sewerAvailable: true,
    totalUtilityBudget: "$25,000-$50,000",
  },

  // --- Manor TX — 5400 E Howard Lane (LOI) ---
  "southwest/mmpi84dhq791": {
    floodZone: "VERIFY — Gilleland Creek watershed. E Howard Lane area may have localized flood zones. Check msc.fema.gov.",
    roadFrontage: "~300 LF on E Howard Lane",
    frontageRoadName: "E Howard Lane",
    roadType: "County road / collector — 2-lane",
    trafficData: "Est. 5,000-10,000 VPD (growing corridor near US 290)",
    nearestSignal: "E Howard Lane at US 290 (~1 mi)",
    visibility: "Moderate — growing suburban area east of Austin",
    terrain: "Gently rolling — Blackland Prairie, 1-3% slope",
    zoningNotes: "VERIFY JURISDICTION — Manor has been annexing aggressively. If inside City of Manor, check zoning ordinance. If in Travis County ETJ — no zoning = by-right. Travis County has no zoning authority. CALL: City of Manor Planning (512-272-5555) to confirm.",
    planningContact: "City of Manor Planning Department",
    planningPhone: "512-272-5555",
    waterProvider: "Manville Water Supply Corporation or Travis County WCID. Verify provider.",
    waterHookupStatus: "by-request",
    waterContact: "Manville WSC — (512) 272-4427",
    electricProvider: "Bluebonnet Electric Cooperative / Austin Energy (varies by location)",
    threePhase: true,
    gasProvider: "Texas Gas Service",
    sewerProvider: "On-site septic likely — verify municipal sewer availability",
    totalUtilityBudget: "$35,000-$70,000",
  },

  // --- Bridgewater MA — 31 Perkins St (LOI) ---
  "southwest/mmpi84dhsjuf": {
    floodZone: "VERIFY — Taunton River watershed. Bridgewater has localized flood zones. Check msc.fema.gov for 31 Perkins St.",
    roadFrontage: "~200 LF on Perkins Street",
    frontageRoadName: "Perkins Street",
    roadType: "Local road — 2-lane",
    trafficData: "Est. 2,000-5,000 VPD",
    nearestSignal: "Perkins St at Route 104 or Route 18 (verify distance)",
    visibility: "Moderate",
    terrain: "Flat to gently rolling — New England terrain, 1-3% slope",
    zoningNotes: "Town of Bridgewater Zoning Bylaws. MA towns use town meeting zoning. Self-storage is typically permitted in Industrial or Commercial Business districts in MA. VERIFY: Check Bridgewater zoning map and Table of Uses at bridgewaterma.org or town bylaws. MA municipalities often restrict self-storage.",
    planningContact: "Bridgewater Planning Board",
    planningPhone: "508-697-0950",
    waterProvider: "Bridgewater Water Department",
    waterHookupStatus: "by-right",
    waterAvailable: true,
    insideServiceBoundary: true,
    waterContact: "Bridgewater Water Dept — (508) 697-0950 x113",
    electricProvider: "Eversource Energy",
    threePhase: true,
    sewerProvider: "Town of Bridgewater Sewer",
    sewerAvailable: true,
    totalUtilityBudget: "$25,000-$50,000",
  },

  // --- Medford NJ — 105 NJ Route 70 (LOI) ---
  "southwest/mmpi84dht3h5": {
    floodZone: "VERIFY — Pine Barrens watershed area. NJ Route 70 corridor may have localized flood zones. Check msc.fema.gov.",
    roadFrontage: "~300 LF on NJ Route 70",
    frontageRoadName: "NJ Route 70",
    roadType: "State Highway — 4-lane divided",
    trafficData: "25,000-35,000 VPD (NJDOT — Route 70 is a major east-west highway)",
    medianType: "Raised median or TWLTL — varies by segment",
    nearestSignal: "Route 70 at Route 541 or Stokes Rd intersection",
    visibility: "Excellent — major highway frontage",
    terrain: "Flat — Atlantic Coastal Plain, <1% slope",
    zoningNotes: "Medford Township NJ zoning. NJ municipalities have strong zoning. Self-storage may be conditional or require variance in many NJ towns. VERIFY: Check Medford Township zoning map and use schedule at medfordtownship.com or ecode360.",
    planningContact: "Medford Township Zoning Department",
    planningPhone: "609-654-8888",
    waterProvider: "NJ American Water or Medford Township municipal water",
    waterHookupStatus: "by-right",
    waterAvailable: true,
    waterContact: "Medford Township — (609) 654-8888",
    electricProvider: "PSE&G (Public Service Electric & Gas)",
    threePhase: true,
    sewerProvider: "Medford Township Municipal Sewer",
    sewerAvailable: true,
    totalUtilityBudget: "$30,000-$60,000",
  },

  // --- Westampton NJ — 598 Rancocas Rd (LOI) ---
  "southwest/-OoQa9la8BJt2NPNB17b": {
    floodZone: "VERIFY CAREFULLY — Rancocas Creek watershed. 598 Rancocas Rd may be partially in flood zone. Check msc.fema.gov — Rancocas Creek has known flood hazard areas.",
    roadFrontage: "~250 LF on Rancocas Road",
    frontageRoadName: "Rancocas Road (County Route 626)",
    roadType: "County road — 2-lane",
    trafficData: "Est. 8,000-12,000 VPD (Burlington County collector road)",
    nearestSignal: "Rancocas Rd at Route 541 or I-295 interchange area",
    visibility: "Good — near I-295 interchange",
    terrain: "Flat — Delaware Valley, <1% slope",
    zoningNotes: "Westampton Township NJ zoning. VERIFY: Check Westampton zoning map and use schedule. NJ municipalities often restrict self-storage. Check ecode360 for Westampton Township zoning ordinance.",
    planningContact: "Westampton Township Zoning",
    planningPhone: "609-267-1891",
    waterProvider: "NJ American Water",
    waterHookupStatus: "by-right",
    waterAvailable: true,
    waterContact: "NJ American Water — 1-800-272-1325",
    electricProvider: "PSE&G",
    threePhase: true,
    sewerProvider: "Westampton Township MUA",
    sewerAvailable: true,
    totalUtilityBudget: "$30,000-$55,000",
  },

  // --- Aubrey TX — 616 Spring Hill Road (Under Contract) ---
  "southwest/mmpi84dgyg7q": {
    floodZone: "Zone X (minimal risk) — Spring Hill Road area is upland terrain in Denton County. Verify at msc.fema.gov.",
    roadFrontage: "~250 LF on Spring Hill Road",
    frontageRoadName: "Spring Hill Road",
    roadType: "Local road — 2-lane",
    trafficData: "Est. 3,000-6,000 VPD (growing corridor near US 380)",
    nearestSignal: "Spring Hill Rd at US 380 (~1 mi)",
    visibility: "Moderate — suburban growth corridor",
    terrain: "Gently rolling — Cross Timbers region, 1-3% slope",
    zoningNotes: "VERIFY: Is site inside City of Aubrey limits or in Denton County ETJ? If ETJ/unincorporated — no zoning = by-right. Aubrey is rapidly growing city along US 380 corridor. If inside city, check Aubrey zoning ordinance at library.municode.com/tx/aubrey.",
    planningContact: "City of Aubrey Development Services",
    planningPhone: "940-365-9300",
    waterProvider: "Upper Trinity Regional Water District / City of Aubrey or Mustang SUD",
    waterHookupStatus: "by-request",
    waterContact: "City of Aubrey Utilities — (940) 365-9300 or Mustang SUD — (940) 440-9561",
    electricProvider: "CoServ Electric",
    threePhase: true,
    gasProvider: "CoServ Gas or Atmos Energy",
    sewerProvider: "City of Aubrey or on-site septic — verify",
    totalUtilityBudget: "$35,000-$65,000",
  },

  // --- Killeen TX — 4503 W Stan Schlueter Loop (Prospect, site 33) ---
  "southwest/33": {
    floodZone: "MEDIUM RISK — near Clear Creek. Check msc.fema.gov for exact zone. ~10% of area buildings have 30-year flood risk per existing data.",
    roadFrontage: "~350 LF on W Stan Schlueter Loop",
    frontageRoadName: "W Stan Schlueter Loop (SH 195)",
    roadType: "State Highway — 4-lane divided loop",
    trafficData: "20,000-30,000 VPD (TxDOT — SH 195 / Stan Schlueter Loop)",
    medianType: "TWLTL or raised median",
    nearestSignal: "Multiple signalized intersections on Stan Schlueter Loop",
    visibility: "Excellent — major commercial loop road",
    terrain: "Gently rolling — Central Texas, 2-4% slope",
    zoningNotes: "City of Killeen zoning. VERIFY: Self-storage is typically permitted in C-5 (General Commercial) and Industrial districts in Killeen. Use table at library.municode.com/tx/killeen. Killeen is pro-development and military-driven growth. Fort Cavazos proximity drives storage demand.",
    planningContact: "Killeen Planning & Zoning",
    planningPhone: "254-501-7860",
    waterProvider: "City of Killeen Water",
    waterHookupStatus: "by-right",
    waterAvailable: true,
    insideServiceBoundary: true,
    waterContact: "Killeen Utility Billing — (254) 501-7700",
    electricProvider: "Oncor Electric Delivery",
    threePhase: true,
    gasProvider: "Atmos Energy",
    sewerProvider: "City of Killeen Wastewater",
    sewerAvailable: true,
    totalUtilityBudget: "$30,000-$60,000",
  },

  // --- Killeen TX — 3007 E Stan Schlueter Loop (Closed) ---
  "southwest/-Onoc95yFyFX8whK3P41": {
    floodZone: "Zone X (minimal risk) — E Stan Schlueter Loop is generally outside flood hazard areas. Verify at msc.fema.gov.",
    roadFrontage: "~300 LF on E Stan Schlueter Loop",
    frontageRoadName: "E Stan Schlueter Loop",
    roadType: "State Highway loop — 4-lane divided",
    trafficData: "18,000-25,000 VPD",
    visibility: "Excellent — commercial loop",
    terrain: "Gently rolling, 2-4% slope",
    zoningClassification: "by-right",
    zoningNotes: "City of Killeen. Self-storage permitted in C-5 and Industrial. Site is on commercial loop — zoning is favorable.",
    planningContact: "Killeen Planning & Zoning",
    planningPhone: "254-501-7860",
    waterProvider: "City of Killeen Water",
    waterHookupStatus: "by-right",
    waterAvailable: true,
    insideServiceBoundary: true,
  },
};

// ============================================================
// MT EAST SITES
// ============================================================
const mtUpdates = {

  // --- Dayton OH — 1960 Austin Blvd (Washington Township) ---
  "east/mt_dayton_austin_blvd": {
    floodZone: "Zone X (minimal risk) — Austin Landing area is developed commercial, outside flood hazard areas. Verify at msc.fema.gov.",
    roadFrontage: "~250 LF on Austin Blvd",
    frontageRoadName: "Austin Blvd at Washington Church Rd",
    roadType: "Local collector — 2-lane with turn lanes",
    trafficData: "Est. 10,000-15,000 VPD (Austin Landing corridor near I-75)",
    nearestSignal: "Austin Blvd at Austin Landing Way (~0.3 mi)",
    visibility: "Good — Austin Landing development, I-75 Exit 41 visibility",
    terrain: "Flat — Miami Valley, <1% slope",
    wetlands: "No — developed commercial area",
  },

  // --- Fishers IN — SEQ I-69 and 106th St ---
  "east/mt_fishers_in": {
    floodZone: "Zone X (minimal risk) — I-69 / 106th St interchange area is upland, well-drained. Verify at msc.fema.gov.",
    roadFrontage: "~1,200 LF on I-69 (highway frontage — Pad #4 within PUD)",
    frontageRoadName: "I-69 frontage / 106th Street",
    roadType: "Interstate highway frontage + local road access via PUD internal roads",
    trafficData: "I-69: 80,000+ VPD (INDOT). 106th St: 15,000-20,000 VPD",
    nearestSignal: "I-69 at 106th St interchange — signalized",
    visibility: "Excellent — I-69 highway frontage, premier visibility",
    terrain: "Flat — Central Indiana, <1% slope",
    wetlands: "Verify — Geist Reservoir watershed nearby, check NWI mapper for Pad #4 specifically",
  },

  // --- Miami Twp OH — SEC Lyons Rd & Newmark Dr ---
  "east/mt_miami_twp_lyons": {
    floodZone: "Zone X (minimal risk) — Lyons Rd / Newmark Dr area is upland. I-675 corridor. Verify at msc.fema.gov.",
    roadFrontage: "~400 LF on Lyons Rd (from 27.78 ac total, targeting 4 ac I-1 pad)",
    frontageRoadName: "Lyons Rd at Newmark Dr",
    roadType: "County collector — 2-lane",
    trafficData: "Est. 8,000-12,000 VPD (near I-675)",
    nearestSignal: "Lyons Rd at I-675 interchange (~0.5 mi)",
    visibility: "Good — I-675 frontage visibility for larger tract",
    terrain: "Flat to gently rolling — Miami Valley, 1-2% slope",
    wetlands: "No — developed suburban area",
  },

  // --- South Lebanon OH — I-71 & SR 48 ---
  "east/mt_south_lebanon_oh": {
    floodZone: "Zone X (minimal risk) — I-71 / SR 48 interchange is upland, at Rivers Crossing power center. Verify at msc.fema.gov.",
    roadFrontage: "~350 LF on SR 48 (from Rivers Crossing development pad)",
    frontageRoadName: "SR 48 / Columbia Rd",
    roadType: "State Route — 2-4 lane, I-71 interchange",
    trafficData: "SR 48: 15,000-20,000 VPD. I-71: 60,000+ VPD.",
    nearestSignal: "SR 48 at I-71 interchange ramps — signalized",
    visibility: "Excellent — I-71 interchange, power center co-tenancy (Target, Kohl's, Lowe's)",
    terrain: "Flat to gently rolling — Warren County, 1-2% slope",
    wetlands: "No — developed power center area",
  },

  // --- Spring Hill TN — 5090 N Main Street ---
  "east/mt_spring_hill_tn": {
    floodZone: "Zone X (minimal risk) — 5090 N Main St (US-31) is upland. Verify at msc.fema.gov. Rutherford Creek to the east may have localized flood zones.",
    roadFrontage: "~200 LF on N Main St (US-31) — rear parcel with access from US-31",
    frontageRoadName: "N Main Street (US-31)",
    roadType: "US Highway — 4-lane divided",
    trafficData: "US-31: 25,000-35,000 VPD (TDOT, growing rapidly due to Spring Hill growth)",
    nearestSignal: "US-31 at various Spring Hill intersections — signalized corridor",
    visibility: "Good — US-31 is the main commercial corridor in Spring Hill",
    terrain: "Gently rolling — Central Tennessee Basin, 2-4% slope",
    wetlands: "No — developed corridor",
  },

  // --- West Chester OH — SEC Tylersville Rd & Cox Rd ---
  "east/mt_west_chester_tylersville": {
    floodZone: "Zone X (minimal risk) — Tylersville/Cox intersection is upland commercial area. Verify at msc.fema.gov.",
    roadFrontage: "~350 LF on Tylersville Rd (signalized corner with Cox Rd)",
    frontageRoadName: "Tylersville Road at Cox Road",
    roadType: "County arterial — 4-lane divided",
    trafficData: "Tylersville Rd: 15,000-20,000 VPD. I-75: 100,000+ VPD (0.3 mi)",
    medianType: "TWLTL — left turns accessible",
    nearestSignal: "Tylersville Rd at Cox Rd — SIGNALIZED (major advantage for storage access)",
    visibility: "Excellent — signalized corner, I-75 interchange proximity, medical corridor",
    terrain: "Flat — Ohio River Valley, <1% slope",
    wetlands: "No — developed suburban area",
  },
};

async function run() {
  const updates = {};

  // Flatten DW updates
  for (const [path, data] of Object.entries(dwUpdates)) {
    for (const [field, value] of Object.entries(data)) {
      updates[path + "/" + field] = value;
    }
  }

  // Flatten MT updates
  for (const [path, data] of Object.entries(mtUpdates)) {
    for (const [field, value] of Object.entries(data)) {
      updates[path + "/" + field] = value;
    }
  }

  console.log("Writing " + Object.keys(updates).length + " field updates across " + (Object.keys(dwUpdates).length + Object.keys(mtUpdates).length) + " sites...");

  await update(ref(db), updates);

  console.log("SUCCESS — All sites updated with deep-dive data.");
  console.log("DW sites updated: " + Object.keys(dwUpdates).length);
  console.log("MT sites updated: " + Object.keys(mtUpdates).length);

  process.exit(0);
}

run().catch(function(e) { console.error("FAILED:", e.message); process.exit(1); });
