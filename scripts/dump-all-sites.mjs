// Dump all active sites from Firebase (southwest, east, submissions)
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get } from "firebase/database";

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

function v(val) { return (val != null && val !== "") ? val : "(none)"; }
function vs(val, max) { return val ? val.substring(0, max || 300) : "(none)"; }

async function dumpAll() {
  const paths = ["southwest", "east", "submissions"];

  for (const path of paths) {
    console.log("\n" + "=".repeat(80));
    console.log("TRACKER: " + path.toUpperCase());
    console.log("=".repeat(80));

    const snap = await get(ref(db, path));
    if (!snap.exists()) {
      console.log("  (empty)");
      continue;
    }

    const data = snap.val();
    const keys = Object.keys(data);
    console.log("  Total sites: " + keys.length + "\n");

    for (const key of keys) {
      const s = data[key];
      const iq = (s.siteiqData) || {};
      console.log("--- " + key + " ---");
      console.log("  Name: " + v(s.name));
      console.log("  Address: " + v(s.address));
      console.log("  City/State: " + v(s.city) + ", " + v(s.state));
      console.log("  Market: " + v(s.market));
      console.log("  Phase: " + v(s.phase));
      console.log("  Acreage: " + v(s.acreage));
      console.log("  Asking Price: " + v(s.askingPrice));
      console.log("  Zoning: " + v(s.zoning));
      console.log("  Zoning Classification: " + v(s.zoningClassification));
      console.log("  Coordinates: " + v(s.coordinates));
      console.log("  Listing URL: " + v(s.listingUrl));
      console.log("  Pop 3mi: " + v(s.pop3mi));
      console.log("  Income 3mi: " + v(s.income3mi));
      console.log("  Households 3mi: " + v(s.households3mi));
      console.log("  Home Value 3mi: " + v(s.homeValue3mi));
      console.log("  Growth Rate: " + v(s.popGrowth3mi || s.growthRate));
      console.log("  Pop 1mi: " + v(s.pop1mi));
      console.log("  Pop 5mi: " + v(s.pop5mi));
      console.log("  Income 5mi: " + v(s.income5mi));
      console.log("  Renter %: " + v(s.renterPct3mi));
      console.log("  Seller Broker: " + v(s.sellerBroker));
      console.log("  --- SiteIQ Data ---");
      console.log("    nearestPS: " + v(iq.nearestPS));
      console.log("    competitorCount: " + v(iq.competitorCount));
      console.log("    ccSPC: " + v(iq.ccSPC));
      console.log("    projectedCCSPC: " + v(iq.projectedCCSPC));
      console.log("    marketTier: " + v(iq.marketTier));
      console.log("    brokerConfirmedZoning: " + v(iq.brokerConfirmedZoning));
      console.log("    surveyClean: " + v(iq.surveyClean));
      console.log("    growthRate: " + v(iq.growthRate));
      console.log("  --- Competition ---");
      console.log("    competitorNames: " + v(s.competitorNames));
      console.log("    competingCCSF: " + v(s.competingCCSF));
      console.log("    pipelineSF: " + v(s.pipelineSF));
      console.log("    nearestCCCompetitor: " + v(s.nearestCCCompetitor));
      console.log("  --- Zoning Detail ---");
      console.log("    zoningSource: " + v(s.zoningSource));
      console.log("    zoningOrdinanceSection: " + v(s.zoningOrdinanceSection));
      console.log("    zoningTableAccessed: " + v(s.zoningTableAccessed));
      console.log("    zoningUseTerm: " + v(s.zoningUseTerm));
      console.log("    overlayDistrict: " + v(s.overlayDistrict));
      console.log("    planningContact: " + v(s.planningContact));
      console.log("    planningPhone: " + v(s.planningPhone));
      console.log("  --- Utilities ---");
      console.log("    waterProvider: " + v(s.waterProvider));
      console.log("    waterHookupStatus: " + v(s.waterHookupStatus));
      console.log("    waterAvailable: " + v(s.waterAvailable));
      console.log("    sewerProvider: " + v(s.sewerProvider));
      console.log("    electricProvider: " + v(s.electricProvider));
      console.log("    threePhase: " + v(s.threePhase));
      console.log("    totalUtilityBudget: " + v(s.totalUtilityBudget));
      console.log("  --- Access ---");
      console.log("    roadFrontage: " + v(s.roadFrontage));
      console.log("    trafficData: " + v(s.trafficData));
      console.log("    visibility: " + v(s.visibility));
      console.log("  --- Topo/Flood ---");
      console.log("    floodZone: " + v(s.floodZone));
      console.log("    terrain: " + v(s.terrain));
      console.log("    wetlands: " + v(s.wetlands));
      console.log("  --- Summary (first 300 chars) ---");
      console.log("    " + vs(s.summary, 300));
      console.log("");
    }
  }

  // Also check config paths
  console.log("\n" + "=".repeat(80));
  console.log("CONFIG: killed_sites count");
  const killedSnap = await get(ref(db, "config/killed_sites"));
  if (killedSnap.exists()) {
    console.log("  Killed sites: " + Object.keys(killedSnap.val()).length);
  } else {
    console.log("  (none)");
  }

  process.exit(0);
}

dumpAll().catch(function(e) { console.error(e); process.exit(1); });
