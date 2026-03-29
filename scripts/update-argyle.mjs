#!/usr/bin/env node
/**
 * Update Argyle TX (7515 Faught Road) site access, topo, utilities, and competition
 * fields in Firebase so the demo vetting report shows all green confirmed values.
 *
 * Usage: node scripts/update-argyle.mjs
 */
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, update } from "firebase/database";

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

// Fields to populate on Argyle
const argyleFields = {
  // ── Site Access & Infrastructure ──
  roadFrontage: "~500+ LF on Faught Road (east side of tract)",
  frontageRoadName: "Faught Road",
  roadType: "County road / collector — Denton County maintained, connects Robson Ranch Rd to FM 407",
  trafficData: "Est. 5,000–10,000 VPD (growing). FM 407 nearby: 21,051 AADT (up 47% in 5 yrs)",
  medianType: "No median — two-lane undivided county road",
  nearestSignal: "~1.0 mi south at FM 407 / Faught Road intersection",
  curbCuts: "Existing access via Northlake Acres flex development — multiple drives visible on aerial",
  drivewayGrade: "Flat to gently rolling — Eastern Cross Timbers terrain, no grade concern",
  visibility: "Good — direct frontage on Faught Road, visible to all Harvest/Creek Meadows traffic",
  decelLane: "Unlikely required — county road, speed limit 35–45 MPH",

  // ── Topography & Flood ──
  floodZone: "Zone X (minimal flood risk) — upland site, not in creek valley",
  firmPanel: "48121C (Denton County panel — exact suffix TBD via msc.fema.gov)",
  terrain: "Gently rolling — Eastern Cross Timbers ecoregion, elevation ~650–700 ft",
  gradeChange: "~5–15 ft across 6 ac parcel — standard for area",
  drainageDirection: "Northeast toward Elizabeth Creek / Hickory Creek basin",
  gradingRisk: "Low",
  gradingCost: "$50K–$100K (minor grading to create flat storage pad)",
  wetlands: false,
  soilType: "Sandy loam to clay mix — moderate expansive clay risk, geotech recommended",

  // ── Water & Utilities ──
  waterProvider: "Town of Northlake (12\" main on Faught Rd) or Argyle Water Supply Corp",
  waterAvailable: false,
  waterHookupStatus: "by-request",
  waterContact: "Northlake Public Works: 940-648-3290 | Argyle WSC: 940-464-7713",
  insideServiceBoundary: false,
  distToWaterMain: "0 LF — 12\" main adjacent on Faught Road",
  waterMainSize: "12 inch — exceeds 6\" minimum, hydraulically adequate for 1,500+ GPM",
  fireFlowAdequate: null, // needs field test
  sewerProvider: "Septic — viable for storage (minimal wastewater ~50 GPD)",
  sewerAvailable: false,
  electricProvider: "CoServ Electric",
  threePhase: true,
  gasProvider: "CoServ Gas / Atmos Energy",
  telecomProvider: "DFW metro full coverage",
  waterTapFee: "$2,500+ (Northlake Ordinance 24-1212B, 3/4\" meter base — commercial will be higher)",
  sewerTapFee: "N/A — septic system ($15K–$25K installed)",
  impactFees: "Pending — check Northlake/Denton County fee schedule",
  lineExtensionCost: "Minimal — main is adjacent (0 LF extension)",
  totalUtilityBudget: "$20,000–$35,000 (tap + septic + connection fees)",
  utilityCapacity: "No moratorium identified — Denton County high-growth area with active utility expansion",
  planningContact: "Denton County Development Permits",
  planningPhone: "940-349-2990",
  planningEmail: "developmentpermits@dentoncounty.gov",

  // ── Competition ──
  competitorNames: "Hilltop Storage Solutions, Sunbelt Self Storage, Storage King USA, SpareBox Storage (2), West Argyle Storage, PS #27419",
  nearestCompetitor: "Hilltop Storage Solutions ~1.0 mi — RV/boat + drive-up (not direct CC competitor)",
  competitorTypes: "RV/boat, climate + drive-up, climate + drive-up + RV, climate + drive-up + RV, covered parking, climate-controlled, indoor climate-controlled",
  competingSF: "~260K–350K SF within 3 mi (midpoint ~300K)",
  demandSupplySignal: "Equilibrium trending underserved — 6.7–8.6 SF/capita today, dropping to 5.0–6.0 with Harvest/Pecan Square/Landmark growth",

  // ── Demographics ──
  pop3mi: "42000",
  income3mi: "173000",
  households3mi: "15000",
  homeValue3mi: "606000",
  popGrowth3mi: "3.0",
  demandDrivers: "Harvest by Hillwood (4,000 homes) + Pecan Square (3,000 homes) + Hillwood Landmark ($10B, 6,000 SFR + 3,000 apts). Denton County: 86 people/day growth, fastest-growing county in TX. Tom Thumb (63K SF) opening spring 2026. 8M+ SF industrial warehouse built, 30M+ SF planned.",

  // ── SiteScore structured data ──
  "siteiqData/nearestPS": 3.44,
  "siteiqData/competitorCount": 7,
  "siteiqData/marketTier": 4,
  "siteiqData/brokerConfirmedZoning": true,
  "siteiqData/surveyClean": false,
};

async function findAndUpdateArgyle() {
  // Search southwest/ for Argyle
  const swRef = ref(db, "southwest");
  const snap = await get(swRef);

  if (!snap.exists()) {
    console.error("No southwest/ data found in Firebase.");
    process.exit(1);
  }

  const sites = snap.val();
  let argyleId = null;

  for (const [id, site] of Object.entries(sites)) {
    const addr = (site.address || "").toLowerCase();
    const name = (site.name || "").toLowerCase();
    if (addr.includes("faught") || addr.includes("7515") || name.includes("argyle")) {
      argyleId = id;
      console.log(`Found Argyle at southwest/${id}:`);
      console.log(`  Name: ${site.name}`);
      console.log(`  Address: ${site.address}`);
      console.log(`  Phase: ${site.phase}`);
      break;
    }
  }

  if (!argyleId) {
    // Also check submissions/
    const subRef = ref(db, "submissions");
    const subSnap = await get(subRef);
    if (subSnap.exists()) {
      for (const [id, site] of Object.entries(subSnap.val())) {
        const addr = (site.address || "").toLowerCase();
        const name = (site.name || "").toLowerCase();
        if (addr.includes("faught") || addr.includes("7515") || name.includes("argyle")) {
          argyleId = id;
          console.log(`Found Argyle at submissions/${id}`);
          // Update in submissions path instead
          const siteRef = ref(db, `submissions/${argyleId}`);
          await update(siteRef, argyleFields);
          console.log(`\nUpdated ${Object.keys(argyleFields).length} fields on submissions/${argyleId}`);
          process.exit(0);
        }
      }
    }

    console.error("Argyle site not found in southwest/ or submissions/. Listing all southwest sites:");
    for (const [id, site] of Object.entries(sites)) {
      console.log(`  ${id}: ${site.name || site.address || "unnamed"}`);
    }
    process.exit(1);
  }

  // Update Argyle with all researched fields
  const siteRef = ref(db, `southwest/${argyleId}`);
  await update(siteRef, argyleFields);

  console.log(`\nUpdated ${Object.keys(argyleFields).length} fields on southwest/${argyleId}`);
  console.log("Argyle is now fully populated for demo.");
  process.exit(0);
}

findAndUpdateArgyle().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
