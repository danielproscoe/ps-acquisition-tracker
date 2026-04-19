#!/usr/bin/env node
/**
 * seed-demo-site.mjs — Synthetic "Example City TX" site with full v2.0 data
 * for prospect walkthroughs. Writes to Firebase at /demo/example-city-tx.
 */
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set } from 'firebase/database';

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);

const demo = {
  name: "DEMO — Example City TX (Prospect Walkthrough)",
  address: "1000 Demo Parkway",
  city: "Example",
  state: "TX",
  coordinates: "30.2672, -97.7431",
  region: "southwest",
  phase: "Prospect",
  acreage: "4.25",
  askingPrice: "$6,800,000",
  zoning: "C-3 Commercial",
  zoningClassification: "by-right",
  pop1mi: "8,420",
  pop3mi: "52,180",
  pop5mi: "124,750",
  income1mi: "$78,200",
  income3mi: "$92,400",
  income5mi: "$87,100",
  households1mi: "3,180",
  households3mi: "19,800",
  households5mi: "47,200",
  homeValue3mi: "$385,000",
  growthRate: "2.4%",
  popGrowth3mi: "2.4%",
  listingSource: "DEMO DATA — not a real site",
  latestNote: "DEMO MODE — synthetic site for prospect walkthrough. Full SpareFoot comp set, forward rent curve, value-add workup all populated. Click REC Package to see the full output.",
  latestNoteDate: "Apr 18, 2026",
  siteiqData: {
    nearestPS: 4.2, competitorCount: 6, ccSPC: 2.1, projectedCCSPC: 2.4, marketTier: 1
  },
  ccRentData: {
    lastAudited: new Date().toISOString(),
    auditVersion: "v2.0-sparefoot",
    totalPlacesResults: 12, totalCompetitorsFound: 8,
    ccFacilityCount: 5, nonCCFacilityCount: 3, psFamilyCount: 1, unknownClassificationCount: 0,
    ccSPC_verified: 2.15, ccSPC_previousFirebase: 2.1, ccSPC_deltaPct: 2.4,
    totalCCSF: 112200, ccSFMeasuredFromInventory: 66250, ccSFFromFallback: 45950,
    auditConfidence: "HIGH",
    confidenceReason: "3 of 5 CC facilities measured from live rate inventory (60%)",
    highConfidenceFacilityCount: 3,
    marketRentBand: {
      p25: 1.12, median: 1.28, p75: 1.48, sampleSize: 14, source: "14 CC rates (50-200 SF)",
      ccBand: { p25: 1.12, median: 1.28, p75: 1.48, sampleSize: 14, tenByTenCount: 4, source: "14 CC rates" },
      nonCCBand: { p25: 0.68, median: 0.82, p75: 0.95, sampleSize: 9, source: "9 non-CC rates" },
      marketBand: { p25: 0.85, median: 1.15, p75: 1.40, sampleSize: 23, source: "23 market rates" },
      samples: { ccTenByTen: 4, ccAllSizes: 14, nonCCTenByTen: 3, nonCCAllSizes: 9, allSizes: 23 }
    },
    rentCurveSummary: {
      y1_10x10: 129, y3_10x10: 143, y5_10x10: 158, y10_10x10: 198,
      y1_to_y5_cagr: "5.2%", y1_to_y10_cagr: "4.4%"
    },
    rentProjection: {
      currentCCRentPerSf: 1.28,
      curve: [
        { year: 1, streetRentPerSf: 1.29, streetRent10x10Monthly: 129, streetRent5x10Monthly: 65, streetRent10x15Monthly: 194, growthRate: 5.20 },
        { year: 2, streetRentPerSf: 1.36, streetRent10x10Monthly: 136, streetRent5x10Monthly: 68, streetRent10x15Monthly: 204, growthRate: 5.20 },
        { year: 3, streetRentPerSf: 1.43, streetRent10x10Monthly: 143, streetRent5x10Monthly: 72, streetRent10x15Monthly: 215, growthRate: 5.20 },
        { year: 4, streetRentPerSf: 1.51, streetRent10x10Monthly: 151, streetRent5x10Monthly: 75, streetRent10x15Monthly: 226, growthRate: 5.20 },
        { year: 5, streetRentPerSf: 1.58, streetRent10x10Monthly: 158, streetRent5x10Monthly: 79, streetRent10x15Monthly: 238, growthRate: 5.20 },
        { year: 6, streetRentPerSf: 1.65, streetRent10x10Monthly: 165, streetRent5x10Monthly: 82, streetRent10x15Monthly: 247, growthRate: 4.20 },
        { year: 7, streetRentPerSf: 1.71, streetRent10x10Monthly: 171, streetRent5x10Monthly: 86, streetRent10x15Monthly: 257, growthRate: 3.90 },
        { year: 8, streetRentPerSf: 1.78, streetRent10x10Monthly: 178, streetRent5x10Monthly: 89, streetRent10x15Monthly: 267, growthRate: 3.70 },
        { year: 9, streetRentPerSf: 1.85, streetRent10x10Monthly: 185, streetRent5x10Monthly: 92, streetRent10x15Monthly: 277, growthRate: 3.60 },
        { year: 10, streetRentPerSf: 1.98, streetRent10x10Monthly: 198, streetRent5x10Monthly: 99, streetRent10x15Monthly: 297, growthRate: 3.55 }
      ],
      ecriCurve: [
        { year: 1, effectiveRentPerSf: 1.34, effectiveRent10x10Monthly: 134, ecriPremiumVsStreet: "3.8%" },
        { year: 2, effectiveRentPerSf: 1.44, effectiveRent10x10Monthly: 144, ecriPremiumVsStreet: "5.2%" },
        { year: 3, effectiveRentPerSf: 1.54, effectiveRent10x10Monthly: 154, ecriPremiumVsStreet: "7.1%" },
        { year: 4, effectiveRentPerSf: 1.66, effectiveRent10x10Monthly: 166, ecriPremiumVsStreet: "9.4%" },
        { year: 5, effectiveRentPerSf: 1.79, effectiveRent10x10Monthly: 179, ecriPremiumVsStreet: "11.8%" }
      ],
      assumptions: {
        popCagr: 2.40, hhiCagr: 3.10, pipelineRatio: 8.5,
        near_term_growth_annual_pct: 5.20, long_term_growth_annual_pct: 3.00,
        reitDominated: true, isCCFacility: true,
        method: "Storvex Market Intel Projection v1.0 — elasticities calibrated from Yardi Matrix + PSA/EXR/CUBE 10-K same-store disclosures"
      }
    },
    absorption: {
      growthDemandSF: 3760, churnDemandSF: 11775, totalAnnualDemandSF: 15535,
      pipelineSF: 8500, monthsToAbsorb: 6.6,
      verdict: "healthy — pipeline absorbs in <18 mo"
    },
    competitorSet: [
      { name: "Extra Space Storage - Example", distanceMi: 1.2, classification: "cc_confirmed", confidence: "high", primarySource: "sparefoot", rateDataCount: 6, address: { street: "500 Oak Ln", city: "Example", state: "TX" } },
      { name: "CubeSmart Example", distanceMi: 1.8, classification: "cc_confirmed", confidence: "high", primarySource: "sparefoot", rateDataCount: 5, address: { street: "1200 Main St", city: "Example", state: "TX" } },
      { name: "Life Storage - North Example", distanceMi: 2.4, classification: "cc_confirmed", confidence: "high", primarySource: "sparefoot", rateDataCount: 3, address: { street: "3300 Commerce Blvd", city: "Example", state: "TX" } },
      { name: "My Garage Storage", distanceMi: 2.7, classification: "non_cc_confirmed", confidence: "high", primarySource: "sparefoot", rateDataCount: 4, address: { street: "800 Industrial Dr", city: "Example", state: "TX" } },
      { name: "Smart Stop Storage", distanceMi: 2.9, classification: "cc_confirmed", confidence: "medium", primarySource: "sparefoot", rateDataCount: 2, address: { street: "150 Park Ave", city: "Example", state: "TX" } },
      { name: "Gold Lock Self Storage", distanceMi: 2.95, classification: "non_cc_confirmed", confidence: "high", primarySource: "sparefoot", rateDataCount: 3, address: { street: "2100 Elm St", city: "Example", state: "TX" } },
      { name: "Stor-A-Way Mini Storage", distanceMi: 2.2, classification: "non_cc_confirmed", confidence: "medium", primarySource: "places_only", rateDataCount: 0, address: { street: "400 1st Ave", city: "Example", state: "TX" } },
      { name: "Public Storage - Example South", distanceMi: 3.8, classification: "cc_confirmed", confidence: "high", primarySource: "sparefoot", rateDataCount: 4, psFamilyBrand: "Public Storage", address: { street: "5000 South Rd", city: "Example", state: "TX" } }
    ],
    narrative: {
      executiveSummary: "**Market Supply.** 5 CC-classified competitors within 3 mi (1 non-CC + 1 PS-family facilities excluded). Verified CC SPC: 2.15 — underserved for CC product.\n\n**Current Rents.** Current market CC rents range $1.12–$1.48/mo for 10×10 (median $1.28) across 14 competitor rate observations.\n\n**Forward Trajectory.** Forward rent trajectory projects $129/mo (Y1) → $158/mo (Y5) → $198/mo (Y10), implying a 5.2% 5-yr CAGR and 4.4% 10-yr CAGR for 10×10 CC units. Pipeline absorption: healthy — pipeline absorbs in <18 mo.\n\n**Confidence.** HIGH-confidence audit (3 of 5 CC facilities measured from live rate inventory (60%)).",
      anomalyFlags: [],
      valueAddThesis: null,
      buyerPitchEmail: "Putting a market intel audit in front of you on DEMO — Example City TX — 4.25 AC, C-3 Commercial by-right in Example TX — the fundamentals warrant a hard look.\n\nThree numbers that matter:\n  • CC SPC: 2.15 SF/capita (underserved)\n  • Market CC rent: $128/mo 10×10 median (P25 $112, P75 $148) from 14 comp observations\n  • Projected Y5 rent: $158/mo 10×10 (5.2% CAGR)\n  • Absorption: healthy — pipeline absorbs in <18 mo\n\nFull audit deck attached — comp set, rate histogram, projection curve, absorption math, all source-stamped.",
      generatedAt: new Date().toISOString(),
      engine: "deterministic-v1"
    }
  }
};

demo.demo = true; // flag for UI filtering
await set(ref(db, 'southwest/demo-example-city-tx'), demo);
console.log('✓ Demo site seeded at /southwest/demo-example-city-tx (demo: true)');
console.log('  Name:', demo.name);
console.log('  ccSPC:', demo.ccRentData.ccSPC_verified, '(HIGH conf)');
console.log('  CC rent:', '$' + demo.ccRentData.marketRentBand.ccBand.median + '/SF');
console.log('  Y5:', '$' + demo.ccRentData.rentCurveSummary.y5_10x10 + '/mo');
process.exit(0);
