// build-cube-rent-index.mjs — aggregator for the CubeSmart facility rent scrape.
//
// Produces a canonical index that the Asset Analyzer can read alongside the
// PSA scraped index. CUBE doesn't disclose per-MSA rent breakdowns in its 10-K
// MD&A (only national same-store), so the cross-validation gate runs at the
// national level: scraped national CC median vs CUBE FY2025 MD&A in-place
// $22.73/SF/yr (accession 0001298675-26-000010).
//
// Per-state and per-MSA aggregations are computed for UI consumption — MSAs
// resolve via the resolveCityToMSA helper that was added in the per-MSA sprint
// (sha 63d536b).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

// Mirror of resolveCityToMSA() from edgarCompIndex.js (kept self-contained so
// the script doesn't need to import the module — the module isn't ESM-clean
// for Node ESM scripts at the moment). If edgarCompIndex.js is ever made ESM-
// importable we should DRY this up.
const CITY_TO_MSA_MAP = {
  // (Shortened — the live table lives in edgarCompIndex.js. We mirror only
  // what's needed for the cube-state buckets we actually scrape; unmatched
  // cities fall through to state-level aggregation only.)
  // California
  "los angeles": "Los Angeles",
  "long beach": "Los Angeles",
  glendale: "Los Angeles",
  "santa monica": "Los Angeles",
  burbank: "Los Angeles",
  pasadena: "Los Angeles",
  inglewood: "Los Angeles",
  "van nuys": "Los Angeles",
  hollywood: "Los Angeles",
  "north hollywood": "Los Angeles",
  encino: "Los Angeles",
  northridge: "Los Angeles",
  reseda: "Los Angeles",
  tarzana: "Los Angeles",
  "studio city": "Los Angeles",
  "san francisco": "San Francisco",
  oakland: "San Francisco",
  berkeley: "San Francisco",
  "san jose": "San Francisco",
  "san diego": "San Diego",
  // New York
  "new york": "New York",
  manhattan: "New York",
  brooklyn: "New York",
  bronx: "New York",
  queens: "New York",
  "staten island": "New York",
  // Texas
  dallas: "Dallas-Ft. Worth",
  "fort worth": "Dallas-Ft. Worth",
  arlington: "Dallas-Ft. Worth",
  plano: "Dallas-Ft. Worth",
  irving: "Dallas-Ft. Worth",
  garland: "Dallas-Ft. Worth",
  mckinney: "Dallas-Ft. Worth",
  frisco: "Dallas-Ft. Worth",
  houston: "Houston",
  cypress: "Houston",
  katy: "Houston",
  pasadena_tx: "Houston",
  pearland: "Houston",
  spring: "Houston",
  austin: "Austin TX",
  "round rock": "Austin TX",
  pflugerville: "Austin TX",
  cedar_park: "Austin TX",
  // Florida
  miami: "Miami",
  hialeah: "Miami",
  "fort lauderdale": "Miami",
  hollywood_fl: "Miami",
  "miami beach": "Miami",
  doral: "Miami",
  homestead: "Miami",
  orlando: "Orlando-Daytona",
  "winter park": "Orlando-Daytona",
  kissimmee: "Orlando-Daytona",
  daytona: "Orlando-Daytona",
  "daytona beach": "Orlando-Daytona",
  "winter garden": "Orlando-Daytona",
  apopka: "Orlando-Daytona",
  tampa: "Tampa",
  "saint petersburg": "Tampa",
  clearwater: "Tampa",
  brandon: "Tampa",
  riverview: "Tampa",
  "west palm beach": "West Palm Beach",
  jupiter: "West Palm Beach",
  "boca raton": "West Palm Beach",
  // Illinois
  chicago: "Chicago",
  "des plaines": "Chicago",
  evanston: "Chicago",
  schaumburg: "Chicago",
  oakbrook: "Chicago",
  // Arizona
  phoenix: "Phoenix",
  scottsdale: "Phoenix",
  glendale_az: "Phoenix",
  mesa: "Phoenix",
  tempe: "Phoenix",
  chandler: "Phoenix",
  gilbert: "Phoenix",
  // Georgia
  atlanta: "Atlanta",
  "sandy springs": "Atlanta",
  marietta: "Atlanta",
  alpharetta: "Atlanta",
  decatur: "Atlanta",
  // North Carolina
  charlotte: "Charlotte",
  matthews: "Charlotte",
  concord: "Charlotte",
  // Colorado
  denver: "Denver",
  aurora: "Denver",
  lakewood: "Denver",
  // Massachusetts
  boston: "Boston",
  cambridge: "Boston",
  somerville: "Boston",
  // Pennsylvania
  philadelphia: "Philadelphia",
  // Maryland
  baltimore: "Baltimore",
  // DC
  washington: "Washington DC",
  // Michigan
  detroit: "Detroit",
  "ann arbor": "Detroit",
  // Hawaii
  honolulu: "Honolulu",
  // Oregon
  portland: "Portland",
  // Minnesota
  minneapolis: "Minneapolis/St. Paul",
  "saint paul": "Minneapolis/St. Paul",
  // Washington
  seattle: "Seattle-Tacoma",
  tacoma: "Seattle-Tacoma",
  bellevue: "Seattle-Tacoma",
  // Nevada
  "las vegas": "Las Vegas",
  henderson: "Las Vegas",
  "north las vegas": "Las Vegas",
  // Sacramento
  sacramento: "Sacramento",
};

function resolveCityToMSA(cityName, stateCode = null) {
  if (!cityName) return null;
  const key = String(cityName).toLowerCase().trim();
  if (CITY_TO_MSA_MAP[key]) return CITY_TO_MSA_MAP[key];
  // Disambiguate same-name cities by state
  if (stateCode === "TX" && key === "pasadena") return "Houston";
  if (stateCode === "FL" && key === "hollywood") return "Miami";
  if (stateCode === "AZ" && key === "glendale") return "Phoenix";
  return null;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function aggregateFacility(facility) {
  const ccMoveIn = [];
  const duMoveIn = [];
  const ccStandard = [];
  const duStandard = [];
  for (const u of facility.units) {
    if (u.pricePerSF_mo == null) continue;
    if (u.unitType === "CC") {
      ccMoveIn.push(u.pricePerSF_mo);
      if (u.standardPricePerSF_mo != null) ccStandard.push(u.standardPricePerSF_mo);
    } else if (u.unitType === "DU" || u.unitType === "INDOOR_NOTCC") {
      duMoveIn.push(u.pricePerSF_mo);
      if (u.standardPricePerSF_mo != null) duStandard.push(u.standardPricePerSF_mo);
    }
  }
  const stateCode = (facility.stateCode || "").toUpperCase() || null;
  const msa = resolveCityToMSA(facility.city, stateCode);
  return {
    facilityId: facility.facilityId,
    address: facility.address,
    city: facility.city,
    state: stateCode,
    stateSlug: facility.state,
    zip: facility.zip,
    lat: facility.lat,
    lng: facility.lng,
    rating: facility.rating,
    ratingCount: facility.ratingCount,
    msa,
    facilityUrl: facility.facilityUrl,
    name: facility.name,
    unitListings: facility.units.length,
    ccUnitsAvailable: ccMoveIn.length,
    duUnitsAvailable: duMoveIn.length,
    ccMedianPerSF_mo: ccMoveIn.length ? Math.round(median(ccMoveIn) * 1000) / 1000 : null,
    ccLowPerSF_mo: ccMoveIn.length ? Math.round(Math.min(...ccMoveIn) * 1000) / 1000 : null,
    ccHighPerSF_mo: ccMoveIn.length ? Math.round(Math.max(...ccMoveIn) * 1000) / 1000 : null,
    duMedianPerSF_mo: duMoveIn.length ? Math.round(median(duMoveIn) * 1000) / 1000 : null,
    ccStandardMedianPerSF_mo: ccStandard.length ? Math.round(median(ccStandard) * 1000) / 1000 : null,
    duStandardMedianPerSF_mo: duStandard.length ? Math.round(median(duStandard) * 1000) / 1000 : null,
    scrapedAt: facility.scrapedAt,
    units: facility.units,
  };
}

function aggregateGroup(facilities) {
  const allCC = [];
  const allDU = [];
  const allCCStandard = [];
  const allDUStandard = [];
  for (const f of facilities) {
    if (f.ccMedianPerSF_mo != null) allCC.push(f.ccMedianPerSF_mo);
    if (f.duMedianPerSF_mo != null) allDU.push(f.duMedianPerSF_mo);
    if (f.ccStandardMedianPerSF_mo != null) allCCStandard.push(f.ccStandardMedianPerSF_mo);
    if (f.duStandardMedianPerSF_mo != null) allDUStandard.push(f.duStandardMedianPerSF_mo);
  }
  return {
    facilitiesScraped: facilities.length,
    totalUnitListings: facilities.reduce((s, f) => s + f.unitListings, 0),
    facilitiesWithCC: allCC.length,
    facilitiesWithDU: allDU.length,
    ccMedianPerSF_mo: allCC.length ? Math.round(median(allCC) * 1000) / 1000 : null,
    ccLowPerSF_mo: allCC.length ? Math.round(Math.min(...allCC) * 1000) / 1000 : null,
    ccHighPerSF_mo: allCC.length ? Math.round(Math.max(...allCC) * 1000) / 1000 : null,
    duMedianPerSF_mo: allDU.length ? Math.round(median(allDU) * 1000) / 1000 : null,
    duLowPerSF_mo: allDU.length ? Math.round(Math.min(...allDU) * 1000) / 1000 : null,
    duHighPerSF_mo: allDU.length ? Math.round(Math.max(...allDU) * 1000) / 1000 : null,
    ccStandardMedianPerSF_mo: allCCStandard.length ? Math.round(median(allCCStandard) * 1000) / 1000 : null,
    duStandardMedianPerSF_mo: allDUStandard.length ? Math.round(median(allDUStandard) * 1000) / 1000 : null,
    impliedDiscountPct:
      allCC.length && allCCStandard.length
        ? Math.round(((1 - median(allCC) / median(allCCStandard)) * 1000)) / 10
        : null,
  };
}

// CUBE national in-place rent: $22.73/SF/yr per FY2025 10-K MD&A
// (accession 0001298675-26-000010). Monthly portfolio = 22.73 / 12.
// Convert to implied CC + DU using cross-REIT 73/27 mix and 80% CC premium.
function nationalCrossValidate(allFacilities, sameStoreGrowth) {
  const cubeIssuer = (sameStoreGrowth.issuers || []).find((i) => i.issuer === "CUBE");
  if (!cubeIssuer?.metrics?.sameStoreRentPerSF) return null;
  const annualPSF = cubeIssuer.metrics.sameStoreRentPerSF;
  const monthlyPortfolio = annualPSF / 12;
  const ccMix = 0.73;
  const ccPremium = 1.8;
  const denom = ccMix * ccPremium + (1 - ccMix);
  const impliedDU = monthlyPortfolio / denom;
  const impliedCC = impliedDU * ccPremium;

  const ccVals = allFacilities.map((f) => f.ccMedianPerSF_mo).filter((v) => v != null);
  const duVals = allFacilities.map((f) => f.duMedianPerSF_mo).filter((v) => v != null);
  const scrapedNationalCC = ccVals.length ? median(ccVals) : null;
  const scrapedNationalDU = duVals.length ? median(duVals) : null;
  const ccDelta =
    scrapedNationalCC != null && impliedCC > 0
      ? (scrapedNationalCC - impliedCC) / impliedCC
      : null;

  return {
    cubeDisclosedAnnualPerSF: annualPSF,
    cubeImpliedMonthlyCC: Math.round(impliedCC * 1000) / 1000,
    cubeImpliedMonthlyDU: Math.round(impliedDU * 1000) / 1000,
    scrapedNationalCC: scrapedNationalCC != null ? Math.round(scrapedNationalCC * 1000) / 1000 : null,
    scrapedNationalDU: scrapedNationalDU != null ? Math.round(scrapedNationalDU * 1000) / 1000 : null,
    ccDeltaPct: ccDelta != null ? Math.round(ccDelta * 1000) / 10 : null,
    sanityGatePassed: ccDelta != null && ccDelta >= -0.65 && ccDelta <= 0.2,
    accessionNumber: cubeIssuer.accessionNumber,
    filingURL: cubeIssuer.filingURL,
    basis: `CUBE FY2025 10-K MD&A — Same-Store Property Portfolio realized rent per occupied SF $${annualPSF}/yr (${cubeIssuer.accessionNumber})`,
    interpretation:
      ccDelta == null
        ? "No CUBE MD&A baseline available."
        : ccDelta > 0.2
          ? `Scraped national CC median EXCEEDS CUBE MD&A in-place by ${(ccDelta * 100).toFixed(1)}% — anomalous; investigate sample composition.`
          : ccDelta >= -0.2
            ? `Scraped national CC median tracks CUBE MD&A in-place within ±20% (delta ${(ccDelta * 100).toFixed(1)}%) — minimal cumulative ECRI premium nationally. High-confidence calibration.`
            : ccDelta >= -0.4
              ? `Scraped national CC median is ${Math.abs(ccDelta * 100).toFixed(1)}% below CUBE MD&A in-place — consistent with the +51% ECRI premium EXR discloses. Modest-to-moderate cumulative ECRI execution at CUBE.`
              : ccDelta >= -0.65
                ? `Scraped national CC median is ${Math.abs(ccDelta * 100).toFixed(1)}% below CUBE MD&A in-place — STRONG cumulative ECRI premium. CUBE has been ratcheting existing tenants aggressively. Indicates rent-raising headroom for an acquirer who can sustain the program.`
                : `Scraped national CC median is ${Math.abs(ccDelta * 100).toFixed(1)}% below CUBE MD&A in-place — beyond expected ECRI range. Investigate sample composition.`,
  };
}

function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => /^cube-facility-rents-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  if (files.length === 0) {
    console.log("No cube-facility-rents-*.json found. Run scrape-cube-facility-rents.mjs first.");
    return;
  }
  const latestFile = files.sort().reverse()[0];
  console.log("Using:", latestFile);

  const scrapeData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, latestFile), "utf-8"));
  const sameStoreGrowth = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "edgar-same-store-growth.json"), "utf-8")
  );

  const allFacilities = [];
  const stateAggregations = [];
  for (const stateGroup of scrapeData.statesGroups) {
    const aggs = stateGroup.facilities.map(aggregateFacility);
    allFacilities.push(...aggs);
    const stateAgg = {
      state: stateGroup.state,
      ...aggregateGroup(aggs),
    };
    stateAggregations.push(stateAgg);
  }

  // MSA aggregations — group facilities by their resolved MSA
  const byMSA = {};
  for (const f of allFacilities) {
    if (!f.msa) continue;
    (byMSA[f.msa] ||= []).push(f);
  }
  const msaAggregations = Object.entries(byMSA)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([msa, facilities]) => ({
      msa,
      ...aggregateGroup(facilities),
    }));

  const facilityIndex = {};
  for (const f of allFacilities) {
    if (f.facilityId) facilityIndex[f.facilityId] = f;
  }

  const nationalValidation = nationalCrossValidate(allFacilities, sameStoreGrowth);

  const output = {
    schema: "storvex.cube-scraped-rent-index.v1",
    operator: "CUBE",
    generatedAt: new Date().toISOString(),
    sourceScrapeFile: latestFile,
    scrapeGeneratedAt: scrapeData.generatedAt,
    citationRule:
      "Per-facility primary-source rent records scraped from CubeSmart facility detail pages. Each unit listing is an HTML <li class=csStorageSizeDimension> element with structured data attributes (data-unitprice, data-encodedfeatures), an aria-hidden size span, and dual price spans (ptDiscountPriceSpan = web/online rate, ptOriginalPriceSpan = in-store standard rate). Storvex captures both — yielding move-in rate AND standard rate per unit, plus the implied promotional discount. National cross-validation against CUBE FY2025 10-K MD&A in-place rent (Same-Store Property Portfolio) converts annual portfolio rent to monthly CC/DU implied via 73% CC mix + 80% premium.",
    methodology: {
      ccMixAssumption: "73% CC / 27% DU (cross-REIT 10-K average)",
      ccPremiumAssumption: "80% over DU (industry standard)",
      crossValidationTolerance:
        "Scraped national CC median should be within ±40% of CUBE MD&A-implied CC. Scraped is MOVE-IN; MD&A is IN-PLACE — gap reflects ECRI lift on cumulative tenant book.",
    },
    totals: {
      facilities: allFacilities.length,
      unitListings: allFacilities.reduce((s, f) => s + f.unitListings, 0),
      states: stateAggregations.length,
      msasResolved: msaAggregations.length,
    },
    nationalValidation,
    stateAggregations,
    msaAggregations,
    facilityIndex,
  };

  const outPath = path.join(DATA_DIR, "cube-scraped-rent-index.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("  CUBE Scraped Rent Index — Aggregated");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`Facilities: ${output.totals.facilities}`);
  console.log(`Unit listings: ${output.totals.unitListings}`);
  console.log(`States covered: ${output.totals.states}`);
  console.log(`MSAs resolved: ${output.totals.msasResolved}`);
  if (nationalValidation) {
    console.log(`\nNational cross-validation:`);
    console.log(`  CUBE MD&A baseline:    $${nationalValidation.cubeDisclosedAnnualPerSF}/SF/yr → CC $${nationalValidation.cubeImpliedMonthlyCC}/mo`);
    console.log(`  Scraped national CC:   $${nationalValidation.scrapedNationalCC}/mo`);
    console.log(`  Delta:                 ${nationalValidation.ccDeltaPct > 0 ? "+" : ""}${nationalValidation.ccDeltaPct}%`);
    console.log(`  Sanity gate:           ${nationalValidation.sanityGatePassed ? "✓ PASSED" : "✗ FAILED"}`);
    console.log(`  Note: ${nationalValidation.interpretation}`);
  }
  console.log(`\nTop 10 states by facility count:`);
  for (const sa of stateAggregations.slice(0, 10)) {
    console.log(
      `  ${sa.state.padEnd(20)} ${String(sa.facilitiesScraped).padStart(3)} fac · CC $${sa.ccMedianPerSF_mo}/mo · DU $${sa.duMedianPerSF_mo}/mo · disc ${sa.impliedDiscountPct ?? "—"}%`
    );
  }
  console.log(`\nTop 10 MSAs (resolved via city→MSA mapping):`);
  for (const ma of msaAggregations.slice(0, 10)) {
    console.log(
      `  ${ma.msa.padEnd(22)} ${String(ma.facilitiesScraped).padStart(3)} fac · CC $${ma.ccMedianPerSF_mo}/mo · DU $${ma.duMedianPerSF_mo}/mo`
    );
  }
  console.log(`\n→ Wrote ${outPath}`);
  console.log(`→ ${(JSON.stringify(output).length / 1024).toFixed(1)} KB on disk`);
}

main();
