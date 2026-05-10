// analyzerEnrich.js — Auto-pull data layer for Storvex Asset Analyzer.
//
// What a PSA underwriter pulls manually before underwriting a deal:
//   1. Geocode the address → lat/lng
//   2. ESRI 1-3-5 mile demographics (pop, HHI, growth, renter mix)
//   3. PS family proximity (PS + iStorage + NSA) — distance to nearest
//   4. SpareFoot market rents — verify seller's stated rents vs comp
//
// We do all four in parallel after OM extraction completes. ~3-5 sec total.
//
// All exports are pure async functions returning structured data —
// no Firebase writes, no DOM, no React.

import { haversine } from "./haversine";
import { enrichNearbyCompetitors, getMSARentBand, getBestRentBand, resolveCityToMSA, getECRIPremiumIndex, getScrapedMSARentMedian, getScrapedRentIndexMetadata, getMSAMoveInRatesByOperator, getCrossREITScrapedRentMetadata, getBuyerSpecificRentAnchor } from "./data/edgarCompIndex";
import { getRentForecast } from "./data/rentForecast";

const ESRI_KEY = "AAPTaUYfi1SoeDufhIkJrnG_F2Q..-zBe5ghTDGTsSCeiaQYPhJmQQ5IKF7MvHv4i5LFTenLFy3ONZYOuiB9mGIPbWYgB9mHIUzNWHXEKPNz9NuuD-7U9VcXUPn28LkIy74pFEfpAdlDaXwME5Tuczq90l0hVssyMRfjXBX5rwmyHaI_8i2Nmgz4mLywQHr7VK2U1GeDyszM2nuUgrqEwUHGZGbA77YK4B7x2GvUK6dTalg0icDTtedzgihJG_CzuLsV-Wbk84LBoXHqmQM-i-0Q4HBep3LRuX-XCAT1_ZmGdGMNw";

// ══════════════════════════════════════════════════════════════════════════
// 1) GEOCODE ADDRESS — ESRI World Geocoder
// ══════════════════════════════════════════════════════════════════════════

export async function geocodeAddress(address) {
  if (!address || typeof address !== "string") throw new Error("address required");
  const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(address)}&outFields=*&maxLocations=1&countryCode=USA&f=json&token=${ESRI_KEY}`;
  const res = await fetch(url);
  const j = await res.json();
  if (j.error) throw new Error(`Geocoding: ${j.error.message}`);
  if (!j.candidates?.length) throw new Error("No address match found");
  const c = j.candidates[0];
  return {
    formatted: c.attributes?.LongLabel || c.attributes?.Match_addr || c.address,
    lat: c.location.y,
    lng: c.location.x,
    score: c.score, // 0-100 confidence
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 2) ESRI DEMOGRAPHICS — 1-3-5 mile radial rings
// ══════════════════════════════════════════════════════════════════════════

const ENRICH_URL = "https://geoenrich.arcgis.com/arcgis/rest/services/World/geoenrichmentserver/Geoenrichment/Enrich";

// Compact variable list — only what the Asset Analyzer + IC memo need.
// (App.js autoEnrichESRI pulls 80+ vars for SiteScore land sites; we want
// a tighter pull for stabilized acquisition speed + token efficiency.)
const ANALYZER_VARS = [
  "AtRisk.TOTPOP_CY", "KeyUSFacts.TOTPOP_FY",
  "KeyUSFacts.TOTHH_CY", "KeyUSFacts.TOTHH_FY",
  "KeyUSFacts.MEDHINC_CY", "KeyUSFacts.MEDHINC_FY",
  "KeyUSFacts.PCI_CY", "KeyUSFacts.MEDAGE_CY", "KeyUSFacts.POPDENS_CY",
  "homevalue.MEDVAL_CY",
  "OwnerRenter.OWNER_CY", "OwnerRenter.RENTER_CY",
  "AtRisk.LF_CY", "AtRisk.UNEMP_CY",
  // Market Potential Index — storage demand signal (the killer layer)
  "MarketPotential.MP09111a_I", // Rented storage space MPI (100=US avg)
  "MarketPotential.MP19013a_I", // Moved last 12mo MPI
];

async function enrichRadius(lat, lng, miles) {
  const studyAreas = JSON.stringify([{
    geometry: { x: lng, y: lat },
    areaType: "RingBuffer",
    bufferUnits: "esriMiles",
    bufferRadii: [miles],
  }]);
  const params = new URLSearchParams({
    studyAreas,
    analysisVariables: JSON.stringify(ANALYZER_VARS),
    useData: JSON.stringify({ sourceCountry: "US" }),
    f: "json",
    token: ESRI_KEY,
  });
  const res = await fetch(ENRICH_URL + "?" + params.toString());
  const data = await res.json();
  return data.results?.[0]?.value?.FeatureSet?.[0]?.features?.[0]?.attributes || null;
}

export async function enrichDemographics(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") throw new Error("lat/lng required");
  const [r1, r3, r5] = await Promise.all([
    enrichRadius(lat, lng, 1),
    enrichRadius(lat, lng, 3),
    enrichRadius(lat, lng, 5),
  ]);

  const cagr5 = (cy, fy) => (cy > 0 && fy > 0) ? (Math.pow(fy / cy, 1 / 5) - 1) : null;

  const renterPct = (r) => {
    const tot = (r?.OWNER_CY || 0) + (r?.RENTER_CY || 0);
    return tot > 0 ? (r.RENTER_CY / tot) : null;
  };

  return {
    pop1mi: r1?.TOTPOP_CY ?? null,
    pop3mi: r3?.TOTPOP_CY ?? null,
    pop5mi: r5?.TOTPOP_CY ?? null,
    pop3mi_fy: r3?.TOTPOP_FY ?? null,

    households1mi: r1?.TOTHH_CY ?? null,
    households3mi: r3?.TOTHH_CY ?? null,
    households5mi: r5?.TOTHH_CY ?? null,

    income1mi: r1?.MEDHINC_CY ?? null,
    income3mi: r3?.MEDHINC_CY ?? null,
    income5mi: r5?.MEDHINC_CY ?? null,
    income3mi_fy: r3?.MEDHINC_FY ?? null,
    pci3mi: r3?.PCI_CY ?? null,

    homeValue1mi: r1?.MEDVAL_CY ?? null,
    homeValue3mi: r3?.MEDVAL_CY ?? null,
    homeValue5mi: r5?.MEDVAL_CY ?? null,

    medianAge3mi: r3?.MEDAGE_CY ?? null,
    popDensity3mi: r3?.POPDENS_CY ?? null,

    popGrowth3mi: cagr5(r3?.TOTPOP_CY, r3?.TOTPOP_FY),
    hhGrowth3mi: cagr5(r3?.TOTHH_CY, r3?.TOTHH_FY),
    incomeGrowth3mi: cagr5(r3?.MEDHINC_CY, r3?.MEDHINC_FY),

    renterPct1mi: renterPct(r1),
    renterPct3mi: renterPct(r3),
    renterPct5mi: renterPct(r5),

    laborForce3mi: r3?.LF_CY ?? null,
    unemploymentRate3mi: (r3?.LF_CY > 0 && r3?.UNEMP_CY != null) ? (r3.UNEMP_CY / r3.LF_CY) : null,

    storageMPI3mi: r3?.MP09111a_I ?? null,  // 100 = US avg; >110 strong
    movedMPI3mi: r3?.MP19013a_I ?? null,    // 100 = US avg; movers = storage demand

    source: "ESRI ArcGIS GeoEnrichment 2025 (current year + 2030 projection)",
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 3) PS FAMILY PROXIMITY — Haversine vs ps-locations CSV
// ══════════════════════════════════════════════════════════════════════════

let cachedFacilities = null;

/**
 * Load PS family facilities (PS + iStorage + NSA per memory CLAUDE.md §6b).
 * Fetches the combined CSV from /public, parses lat/lng, caches in-memory
 * for the session.
 */
export async function loadPSFamilyFacilities() {
  if (cachedFacilities) return cachedFacilities;

  // Load PS-owned + NSA in parallel; combined CSV is a deduped pre-merge
  const [psResp, nsaResp] = await Promise.all([
    fetch("/ps-locations.csv"),
    fetch("/nsa-locations.csv").catch(() => null),
  ]);
  const psCsv = await psResp.text();
  const nsaCsv = nsaResp ? await nsaResp.text().catch(() => "") : "";

  const facilities = [];
  const parseCsv = (csv, brand) => {
    const lines = csv.split(/\r?\n/);
    if (lines.length < 2) return;
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
    const latIdx = header.findIndex((h) => /^lat(itude)?$/.test(h));
    const lngIdx = header.findIndex((h) => /^(lng|long|longitude)$/.test(h));
    const nameIdx = header.findIndex((h) => /^(name|facility|location)/.test(h));
    const cityIdx = header.findIndex((h) => /^city$/.test(h));
    const stateIdx = header.findIndex((h) => /^state$/.test(h));
    const numIdx = header.findIndex((h) => /^num$/.test(h));
    if (latIdx < 0 || lngIdx < 0) return;
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const lat = parseFloat(cells[latIdx]);
      const lng = parseFloat(cells[lngIdx]);
      if (isNaN(lat) || isNaN(lng)) continue;
      // PSA "num" format: "PS #00809" → extract numeric ID "809" for joining
      // with scraped facility records keyed by facilityId.
      const numStr = numIdx >= 0 ? cells[numIdx] : "";
      const idMatch = String(numStr).match(/(\d+)\s*$/);
      const facilityId = idMatch ? String(parseInt(idMatch[1], 10)) : null;
      facilities.push({
        brand,
        name: nameIdx >= 0 ? cells[nameIdx] : "",
        city: cityIdx >= 0 ? cells[cityIdx] : "",
        state: stateIdx >= 0 ? cells[stateIdx] : "",
        facilityId,
        lat,
        lng,
      });
    }
  };
  parseCsv(psCsv, "PS");
  parseCsv(nsaCsv, "NSA");

  cachedFacilities = facilities;
  return facilities;
}

/**
 * Compute the N nearest PS family facilities within radius, with each
 * enriched with EDGAR-derived cost basis ($/SF gross carrying) and rent
 * estimate (CC + DU monthly $/SF). Every estimate cites a SEC EDGAR
 * accession number.
 *
 * This is the primary-source competitor analysis Asset Analyzer surfaces
 * in its enrichment block. Cost basis pulls from PSA's Schedule III MSA
 * aggregate (when the city is matched to a PSA-disclosed MSA) or state-
 * weighted PSF (fallback). Rent estimate uses MSA-disclosed rent when the
 * MSA is named in PSA's same-store-by-market table, otherwise EDGAR-
 * calibrated state-weighted rent.
 *
 * @param {number} lat — subject site latitude
 * @param {number} lng — subject site longitude
 * @param {Object} options — { radiusMi: 5, limit: 10 }
 * @returns {Array} enriched competitor records sorted by distance ascending
 */
export async function nearbyCompetitorsEnriched(lat, lng, options = {}) {
  if (typeof lat !== "number" || typeof lng !== "number") return [];
  const facilities = await loadPSFamilyFacilities();
  if (!facilities.length) return [];
  return enrichNearbyCompetitors(facilities, lat, lng, {
    radiusMi: options.radiusMi ?? 5,
    limit: options.limit ?? 10,
    haversineFn: haversine,
  });
}

/**
 * Find nearest PS family facility to a given lat/lng.
 * Returns { distanceMi, brand, name, city, state, count35mi } — the latter
 * counts all PS family facilities within 35 mi (PSA market presence signal).
 */
export async function nearestPSFamily(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const facilities = await loadPSFamilyFacilities();
  if (!facilities.length) return null;

  let nearest = null;
  let nearestMi = Infinity;
  let count35 = 0;

  for (const f of facilities) {
    const d = haversine(lat, lng, f.lat, f.lng);
    if (d <= 35) count35++;
    if (d < nearestMi) {
      nearestMi = d;
      nearest = f;
    }
  }

  return {
    distanceMi: nearestMi,
    brand: nearest?.brand || null,
    name: nearest?.name || null,
    city: nearest?.city || null,
    state: nearest?.state || null,
    count35mi: count35,
    totalFacilitiesIndexed: facilities.length,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 4) SPAREFOOT MARKET RENTS — verify seller's stated rates vs comp set
// ══════════════════════════════════════════════════════════════════════════

/**
 * Calls the existing /api/sparefoot-rents endpoint to get market rent data
 * for the subject city. Returns { ccRentPerSF, driveupRentPerSF, sampleSize,
 * source } or null if the endpoint isn't usable.
 */
export async function fetchMarketRents(city, state) {
  if (!city || !state) return null;
  try {
    const resp = await fetch("/api/sparefoot-rents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city, state }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data;
  } catch (e) {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// FULL ENRICHMENT — orchestrates 1-4 in parallel
// ══════════════════════════════════════════════════════════════════════════

/**
 * Pulls everything a PSA underwriter would pull manually, in parallel.
 *
 * @param {Object} input — extracted OM fields
 * @param {string} input.address
 * @param {string} input.city
 * @param {string} input.state
 * @returns {Object} { coords, demographics, psFamily, marketRents, errors[] }
 */
export async function enrichAssetAnalysis(input) {
  const errors = [];
  const fullAddress = [input.address, input.city, input.state].filter(Boolean).join(", ");

  // Step 1: geocode (everything else depends on lat/lng)
  let coords = null;
  if (fullAddress) {
    try {
      coords = await geocodeAddress(fullAddress);
    } catch (e) {
      errors.push({ step: "geocode", error: e.message });
    }
  }

  // Step 2/3/4/5: parallel pulls — adds primary-source competitor analysis
  // (top 10 within 5 mi, each enriched with EDGAR cost basis + rent estimate)
  // and MSA-resolved rent band (highest-fidelity rent calibration when the
  // subject city maps to a PSA-disclosed MSA).
  const [demographics, psFamily, marketRents, competitors] = await Promise.all([
    coords ? enrichDemographics(coords.lat, coords.lng).catch((e) => {
      errors.push({ step: "demographics", error: e.message });
      return null;
    }) : Promise.resolve(null),
    coords ? nearestPSFamily(coords.lat, coords.lng).catch((e) => {
      errors.push({ step: "psFamily", error: e.message });
      return null;
    }) : Promise.resolve(null),
    fetchMarketRents(input.city, input.state).catch((e) => {
      errors.push({ step: "marketRents", error: e.message });
      return null;
    }),
    coords ? nearbyCompetitorsEnriched(coords.lat, coords.lng, { radiusMi: 5, limit: 10 }).catch((e) => {
      errors.push({ step: "competitors", error: e.message });
      return [];
    }) : Promise.resolve([]),
  ]);

  // Resolve MSA from subject city + state, then surface the MSA-disclosed
  // rent band (or null if not in PSA's per-MSA disclosure)
  const subjectMSA = resolveCityToMSA(input.city, input.state);
  const msaRentBand = subjectMSA ? getMSARentBand(subjectMSA) : null;
  // Best-available rent: MSA > state > national
  const bestRentBand = getBestRentBand({ msa: subjectMSA, state: input.state });
  // Cross-REIT ECRI premium signal — rent-raising headroom from disclosed
  // in-place vs move-in rates. EXR is currently the only direct discloser.
  const ecriIndex = getECRIPremiumIndex();

  // Rent forecast — projects in-place + move-in trajectories over Y0/Y1/Y3/Y5
  // for the chosen buyer lens (PSA / EXR / CUBE / SMA / GENERIC) under three
  // scenarios (base / upside / downside). Reads REIT-specific dynamics from
  // each issuer's FY2025 10-K MD&A.
  const buyerLens = (input.buyerLens || "PSA").toUpperCase();
  const rentForecast = getRentForecast({
    msa: subjectMSA,
    state: input.state,
    buyerLens,
    horizons: [0, 1, 3, 5],
  });

  // Scraped MSA rent — primary-source per-facility unit pricing from PSA
  // Schema.org SelfStorage entities. Available where the scraper has run.
  // The scraper labels MSAs slightly differently than PSA's MD&A taxonomy
  // ("Austin TX" vs "Austin"), so try a few variants when matching.
  let scrapedMSARent = null;
  if (input.state) {
    const candidates = subjectMSA
      ? [subjectMSA, `${subjectMSA} ${input.state}`, `${input.city || ""} ${input.state}`.trim()]
      : [`${input.city || ""} ${input.state}`.trim()];
    for (const candidate of candidates) {
      scrapedMSARent = getScrapedMSARentMedian(candidate);
      if (scrapedMSARent) break;
    }
  }
  const scrapedRentMetadata = getScrapedRentIndexMetadata();

  // Cross-REIT MSA move-in rate matrix — surfaces PSA + CUBE + EXR median
  // move-in rates side-by-side for the subject MSA. Each operator's row is
  // independent (no per-REIT join required), so even partial coverage shows
  // up. Empty array if no operator has scraped data for this MSA.
  let crossREITMSARates = [];
  if (subjectMSA) {
    const candidates = [subjectMSA, `${subjectMSA} ${input.state || ""}`.trim()];
    for (const candidate of candidates) {
      const rates = getMSAMoveInRatesByOperator(candidate);
      if (rates && rates.length > 0) {
        crossREITMSARates = rates;
        break;
      }
    }
  }
  const crossREITScrapedMetadata = getCrossREITScrapedRentMetadata();

  // Buyer-specific Y0 rent anchor — routes the selected buyer's lens through
  // their own 10-K-disclosed rent + Storvex scrape. PSA gets per-MSA disclosed
  // rent; CUBE gets scraped state-weighted; EXR/SMA/AMERCO get national or
  // segment-level disclosure; GENERIC gets cross-REIT weighted average.
  // The buyerLens is passed in via input (set from the dashboard dropdown).
  const buyerSpecificRentAnchor = getBuyerSpecificRentAnchor({
    buyerKey: input.buyerLens || "PS",
    msa: subjectMSA,
    state: input.state,
  });

  return {
    coords, demographics, psFamily, marketRents, competitors,
    subjectMSA, msaRentBand, bestRentBand, ecriIndex,
    rentForecast, scrapedMSARent, scrapedRentMetadata,
    crossREITMSARates, crossREITScrapedMetadata,
    buyerSpecificRentAnchor,
    errors, generatedAt: new Date().toISOString(),
  };
}
