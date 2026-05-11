// QuickLookupPanel.js — Radius-style instant market report from an address
// Phase 1 MVP: browser-side ESRI + Places + PS Family. SpareFoot + Einstein
// narrative happen via scheduled audit after "Save to Pipeline" click.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { computeProjectedCCSPC } from './utils/pipelineSupplyLookup';
import { lookupAuditedCCSPC, calibrationDelta } from './utils/auditedSPCLookup';
import { RadiusPlusComparisonCard } from './components/AssetAnalyzerView';

// ═══════════════════════════════════════════════════════════════════════════
// Operator classification — universal 3-tier model for any buyer persona.
//
//   Tier 1 — PUBLIC REIT:      PSA, ESS, CubeSmart, Life Storage, iStorage, NSA, SmartStop
//                              (These are the institutional operators — REIT-traded)
//   Tier 2 — REGIONAL/CHAIN:   StorageMart, Prime, StorQuest, Simply Self, U-Haul, Metro
//                              (Multi-market but not public-REIT scale)
//   Tier 3 — LOCAL/INDEPENDENT: Everyone else (the long tail of mom-and-pop operators)
//
// Sub-flag: PS Family (PS + iStorage + NSA) for PS-specific users. Any other
// buyer persona can derive their own "family" list from the tier + brand.
// ═══════════════════════════════════════════════════════════════════════════
const PUBLIC_REIT = /\b(public\s+storage|extra\s+space|cubesmart|life\s+storage|istorage|national\s+storage\s+affiliates?|NSA\b|PS\s*#|SmartStop\s+Self\s+Storage|LSI\b)/i;
const REGIONAL_CHAIN = /\b(storagemart|storage\s+mart|prime\s+storage|storquest|simply\s+self|u-?haul\s+moving|metro\s+self|red\s+dot|compass\s+self|sovran|uncle\s+bob|snapbox|stor[- ]all|devon\s+self)/i;
const PS_FAMILY_REGEX = /\b(public\s+storage|istorage|national\s+storage\s+affiliates?|NSA\b|PS\s*#)/i;

function classifyOperator(name) {
  const n = name || '';
  const psFamily = PS_FAMILY_REGEX.test(n);
  if (PUBLIC_REIT.test(n)) return { tier: 'reit', tierLabel: 'Public REIT', psFamily };
  if (REGIONAL_CHAIN.test(n)) return { tier: 'regional', tierLabel: 'Regional Chain', psFamily };
  return { tier: 'independent', tierLabel: 'Local/Independent', psFamily };
}

// Backwards-compat shim for code still calling tagPSFamily
function tagPSFamily(name) {
  return classifyOperator(name).psFamily ? 'ps-family' : 'competitor';
}

// ═══════════════════════════════════════════════════════════════════════════
// Leaflet icons — custom markers per facility type
// ═══════════════════════════════════════════════════════════════════════════
const iconHTML = (color, size = 18, pulse = false) => `
  <div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4),0 0 0 ${Math.round(size/4)}px ${color}40;${pulse ? 'animation:mapPulse 2s ease-in-out infinite;' : ''}"></div>
`;
const makeIcon = (color, size = 18, pulse = false) => L.divIcon({
  html: iconHTML(color, size, pulse),
  iconSize: [size + 10, size + 10],
  iconAnchor: [(size + 10) / 2, (size + 10) / 2],
  popupAnchor: [0, -(size / 2)],
  className: 'storvex-marker'
});
const SUBJECT_ICON = makeIcon('#C9A84C', 24, true);
const REIT_ICON = makeIcon('#F97316', 16);        // Public REIT (orange)
const REGIONAL_ICON = makeIcon('#8B5CF6', 15);    // Regional/chain (purple)
const INDEPENDENT_ICON = makeIcon('#3B82F6', 14); // Local/independent (blue)
// Backwards compat
const COMP_ICON = INDEPENDENT_ICON;
const PS_FAMILY_ICON = REIT_ICON;
function iconForOperator(tier) {
  if (tier === 'reit') return REIT_ICON;
  if (tier === 'regional') return REGIONAL_ICON;
  return INDEPENDENT_ICON;
}

// Map auto-fit helper
function FitBounds({ subject, points }) {
  const map = useMap();
  useEffect(() => {
    if (!subject) return;
    const latlngs = [[subject.lat, subject.lng], ...points.filter(p => p.lat && p.lng).map(p => [p.lat, p.lng])];
    if (latlngs.length > 1) {
      map.fitBounds(latlngs, { padding: [40, 40] });
    } else {
      map.setView([subject.lat, subject.lng], 13);
    }
  }, [subject, points, map]);
  return null;
}


const ESRI_KEY = "AAPTaUYfi1SoeDufhIkJrnG_F2Q..-zBe5ghTDGTsSCeiaQYPhJmQQ5IKF7MvHv4i5LFTenLFy3ONZYOuiB9mGIPbWYgB9mHIUzNWHXEKPNz9NuuD-7U9VcXUPn28LkIy74pFEfpAdlDaXwME5Tuczq90l0hVssyMRfjXBX5rwmyHaI_8i2Nmgz4mLywQHr7VK2U1GeDyszM2nuUgrqEwUHGZGbA77YK4B7x2GvUK6dTalg0icDTtedzgihJG_CzuLsV-Wbk84LBoXHqmQM-i-0Q4HBep3LRuX-XCAT1_ZmGdGMNw";
const PLACES_KEY = process.env.REACT_APP_GOOGLE_PLACES_API_KEY || "AIzaSyBh0Rf14IRebQr7gzPuNQXWyLRFk9--hB8";

// ═══════════════════════════════════════════════════════════════════════════
// Geocoding via ESRI World Geocoder (same key as our enrichment — no extra API)
// ═══════════════════════════════════════════════════════════════════════════
// ESRI suggest endpoint — fast autocomplete (same API key, ~100ms per call).
// Returns up to 5 US candidates as user types. Caller passes text + optional
// anchor lat/lng for local bias (not used here but available).
async function esriSuggest(text, signal) {
  if (!text || text.trim().length < 3) return [];
  const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest?text=${encodeURIComponent(text)}&maxSuggestions=6&countryCode=USA&f=json&token=${ESRI_KEY}`;
  try {
    const res = await fetch(url, { signal });
    const j = await res.json();
    return (j.suggestions || []).filter(s => !s.isCollection).slice(0, 6);
  } catch (e) {
    if (e.name === 'AbortError') return null;
    return [];
  }
}

async function geocodeAddress(address) {
  const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(address)}&outFields=*&maxLocations=1&countryCode=USA&f=json&token=${ESRI_KEY}`;
  const res = await fetch(url);
  const j = await res.json();
  if (j.error) throw new Error(`Geocoding: ${j.error.message}`);
  if (!j.candidates?.length) throw new Error('No address match found');
  const c = j.candidates[0];
  const attr = c.attributes || {};
  return {
    formatted: attr.LongLabel || attr.Match_addr || c.address,
    lat: c.location.y,
    lng: c.location.x,
    streetNumber: attr.AddNum || '',
    route: attr.StName || attr.Address?.split(' ').slice(1).join(' ') || '',
    city: attr.City || '',
    state: attr.RegionAbbr || attr.Region || '',
    zip: attr.Postal || '',
    county: attr.Subregion || '',
    matchScore: c.score,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ESRI v3 enrichment (demos + Tapestry, 3 rings)
// ═══════════════════════════════════════════════════════════════════════════
const DEMO_VARS = [
  "AtRisk.TOTPOP_CY","KeyUSFacts.TOTPOP_FY","KeyUSFacts.TOTHH_CY","KeyUSFacts.TOTHH_FY",
  "KeyUSFacts.MEDHINC_CY","KeyUSFacts.MEDHINC_FY","KeyUSFacts.PCI_CY","KeyUSFacts.AVGHINC_CY",
  "KeyUSFacts.DIVINDX_CY","KeyUSFacts.DPOP_CY","KeyUSFacts.TOTHU_CY","KeyUSFacts.VACANT_CY",
  "homevalue.MEDVAL_CY","homevalue.AVGVAL_CY","OwnerRenter.OWNER_CY","OwnerRenter.RENTER_CY",
  "5yearincrements.POP25_CY","5yearincrements.POP30_CY","5yearincrements.POP35_CY","5yearincrements.POP40_CY",
  "5yearincrements.POP55_CY","5yearincrements.POP60_CY","5yearincrements.POP65_CY","5yearincrements.POP70_CY",
  "HouseholdIncome.HINC75_CY","HouseholdIncome.HINC100_CY","HouseholdIncome.HINC150_CY","HouseholdIncome.HINC200_CY",
  "educationalattainment.BACHDEG_CY","educationalattainment.GRADDEG_CY"
];
const TAPESTRY_VARS = ["tapestryhouseholdsNEW.TSEGNAME"];

async function esriCall(lat, lng, radiusMi, vars) {
  const url = "https://geoenrich.arcgis.com/arcgis/rest/services/World/geoenrichmentserver/Geoenrichment/Enrich";
  const sa = JSON.stringify([{ geometry: { x: lng, y: lat }, areaType: 'RingBuffer', bufferUnits: 'esriMiles', bufferRadii: [radiusMi] }]);
  const params = new URLSearchParams({ studyAreas: sa, analysisVariables: JSON.stringify(vars), useData: JSON.stringify({ sourceCountry: 'US' }), f: 'json', token: ESRI_KEY });
  const res = await fetch(url + '?' + params.toString());
  const j = await res.json();
  if (j.error) throw new Error(`ESRI ${j.error.code}: ${j.error.message}`);
  return j?.results?.[0]?.value?.FeatureSet?.[0]?.features?.[0]?.attributes || null;
}

async function fetchESRIEnrichment(lat, lng) {
  const [[d1, t1], [d3, t3], [d5, t5]] = await Promise.all([
    Promise.all([esriCall(lat, lng, 1, DEMO_VARS), esriCall(lat, lng, 1, TAPESTRY_VARS)]),
    Promise.all([esriCall(lat, lng, 3, DEMO_VARS), esriCall(lat, lng, 3, TAPESTRY_VARS)]),
    Promise.all([esriCall(lat, lng, 5, DEMO_VARS), esriCall(lat, lng, 5, TAPESTRY_VARS)]),
  ]);
  const merge = (a, b) => ({ ...(a || {}), ...(b || {}) });
  return { ring1: merge(d1, t1), ring3: merge(d3, t3), ring5: merge(d5, t5) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Places API — nearby storage facilities
// ═══════════════════════════════════════════════════════════════════════════
async function fetchPlacesCompetitors(lat, lng, radiusMi = 3) {
  const body = {
    includedTypes: ['storage'],
    maxResultCount: 20,
    locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMi * 1609.34 } }
  };
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.websiteUri'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Places API ${res.status}: ${err.slice(0, 200)}`);
  }
  const j = await res.json();
  // Filter non-self-storage
  const EXCL = /walmart|h-e-b|heb |mclane|costco|amazon|fedex|ups|dhl|distribution center|fleet|truck entrance|warehouse|fulfillment|cold storage|wilsonart|carpenter lp|freight|carriers|logistics|trucking|schneider|penske|ryder|wrecker|auto body|salvage|junk yard|scrap|recycling|lumber yard|propane|livestock|record nations|iron mountain|data center|moving & truck/i;
  const STORAGE_BRANDS = /storage|self[- ]storage|mini[- ]storage|public storage|extra space|cubesmart|life storage|istorage|nsa|storquest|u-haul moving/i;
  return (j.places || [])
    .filter(p => !EXCL.test(p.displayName?.text || ''))
    .filter(p => STORAGE_BRANDS.test(p.displayName?.text || ''))
    .map(p => ({
      id: p.id,
      name: p.displayName?.text || '',
      address: p.formattedAddress,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      website: p.websiteUri,
      distanceMi: +haversine(lat, lng, p.location?.latitude, p.location?.longitude).toFixed(2)
    }))
    .filter(p => p.distanceMi <= radiusMi)
    .sort((a, b) => a.distanceMi - b.distanceMi);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ═══════════════════════════════════════════════════════════════════════════
// REIT REGISTRY — authoritative 4,238-location database (PS + iStorage + NSA)
// Loaded lazily, cached at module scope. Not "fetched" — ALREADY INDEXED.
// ═══════════════════════════════════════════════════════════════════════════
let _reitRegistryCache = null;
async function loadREITRegistry() {
  if (_reitRegistryCache) return _reitRegistryCache;
  try {
    const res = await fetch('/reit-registry.json');
    if (!res.ok) throw new Error(`${res.status}`);
    const j = await res.json();
    _reitRegistryCache = j;
    return j;
  } catch (e) {
    console.warn('[REIT Registry] load failed:', e.message);
    return null;
  }
}

// Find REIT facilities within radius of subject coords
function findREITFacilitiesNearby(registry, lat, lng, radiusMi) {
  if (!registry?.locations) return [];
  const hits = [];
  for (const loc of registry.locations) {
    const d = haversine(lat, lng, loc.lat, loc.lon);
    if (d <= radiusMi) hits.push({ ...loc, distanceMi: +d.toFixed(2) });
  }
  return hits.sort((a, b) => a.distanceMi - b.distanceMi);
}

// ═══════════════════════════════════════════════════════════════════════════
// CC SPC — Climate-Controlled Storage SF Per Capita (the competition headline)
// ─────────────────────────────────────────────────────────────────────────
// PSA/EXR/CUBE build climate-controlled product. Drive-up-only facilities
// compete for a different customer and don't cannibalize CC lease-up.
// CC SPC is the single most important competition metric for storage
// investment. Radius publishes raw SPC; we publish CC SPC with tier verdicts.
// Benchmarks per CLAUDE.md §6c-4.
// ═══════════════════════════════════════════════════════════════════════════
function estimateFacilityCCSF(competitor) {
  // Calibrated facility CC SF estimate. Uses classifyCompetitor() (same classifier
  // and same SF-per-facility constants as StorvexVerdictHero — single source of
  // truth for CC SPC estimation across every widget on the page).
  //
  // Constants calibrated against verified SpareFoot audits across the DJR
  // pipeline (target ±25% of audit value):
  //   cc_confident (REIT / known CC operator, excl. PS Family): ~28K CC SF
  //   mixed (suburban "self storage", drive-up-dominant): ~6K CC SF
  //     (20K raw × 0.30 weighting — most suburban facilities are drive-up)
  //   PS-family / excluded: 0 (caller filters these out)
  const cls = classifyCompetitor(competitor);
  if (cls === 'cc_confident') return 28000;
  if (cls === 'mixed')        return 6000;  // 20K × 0.30 weight, matches Verdict Hero
  return 0; // ps_family or exclude — filtered out upstream
}

function ccSPCVerdict(spc) {
  if (spc == null) return { label: '—', tier: 'unknown', color: '#64748B', score: null };
  if (spc < 1.5)  return { label: 'SEVERELY UNDERSERVED', tier: 'elite',    color: '#10B981', score: 10 };
  if (spc < 3.0)  return { label: 'UNDERSERVED',          tier: 'strong',   color: '#22C55E', score: 8  };
  if (spc < 5.0)  return { label: 'MODERATE',             tier: 'moderate', color: '#F59E0B', score: 6  };
  if (spc < 7.0)  return { label: 'WELL-SUPPLIED',        tier: 'weak',     color: '#F97316', score: 5  };
  if (spc < 10.0) return { label: 'OVERSUPPLIED',         tier: 'poor',     color: '#EF4444', score: 4  };
  if (spc < 15.0) return { label: 'HEAVILY OVERSUPPLIED', tier: 'bad',      color: '#DC2626', score: 3  };
  return             { label: 'SATURATED',                 tier: 'dead',     color: '#991B1B', score: 0  };
}

function computeCCSPC(competitors, pop3miCY, pop3miFY) {
  const arr = Array.isArray(competitors) ? competitors : [];
  // Only competitors within 3 mi drive the CC supply metric.
  const comp3mi = arr.filter(c => {
    const d = parseFloat(c.distanceMi);
    return Number.isFinite(d) && d <= 3;
  });
  // Classify every facility (same classifier StorvexVerdictHero uses — single
  // source of truth so CC SPC Headline agrees with the Verdict Hero).
  const classified = comp3mi.map(c => ({ ...c, _class: classifyCompetitor(c) }));
  // PS family: Public Storage + iStorage + NSA. For PS-as-buyer these are NOT
  // competition; for non-PS buyers they ARE. We compute both views.
  const psFam      = classified.filter(c => c._class === 'ps_family');
  const excluded   = classified.filter(c => c._class === 'exclude');
  const ccConfident = classified.filter(c => c._class === 'cc_confident');
  const mixed       = classified.filter(c => c._class === 'mixed');
  // "Non-PS view" excludes PS family + RV/non-storage. "All view" includes PS
  // family (treat them as competition for non-PS buyers) but still excludes RV.
  const validForCCAll    = classified.filter(c => c._class !== 'exclude');
  const validForCCNonPS  = classified.filter(c => c._class !== 'exclude' && c._class !== 'ps_family');
  const ccSFAll   = validForCCAll.reduce((s, c) => s + estimateFacilityCCSF(c), 0);
  const ccSFNonPS = validForCCNonPS.reduce((s, c) => s + estimateFacilityCCSF(c), 0);
  const current   = pop3miCY > 0 ? ccSFAll / pop3miCY : null;
  const projected = pop3miFY > 0 ? ccSFAll / pop3miFY : null;
  const currentNonPS   = pop3miCY > 0 ? ccSFNonPS / pop3miCY : null;
  const projectedNonPS = pop3miFY > 0 ? ccSFNonPS / pop3miFY : null;
  return {
    current, projected, currentNonPS, projectedNonPS,
    totalCCSF: ccSFAll,
    totalCCSFNonPS: ccSFNonPS,
    competitorCount: validForCCAll.length,
    psFamilyCount: psFam.length,
    nonPSFamilyCount: validForCCNonPS.length,
    ccConfidentCount: ccConfident.length,
    mixedCount: mixed.length,
    excludedCount: excluded.length,
    verdict: ccSPCVerdict(current),
    projectedVerdict: ccSPCVerdict(projected),
    verdictNonPS: ccSPCVerdict(currentNonPS),
    // Pipeline flood flag: projected 2+ tiers worse than current = red flag
    pipelineFlood: (ccSPCVerdict(current).score != null && ccSPCVerdict(projected).score != null)
      ? (ccSPCVerdict(current).score - ccSPCVerdict(projected).score >= 4)
      : false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILDABLE ENVELOPE MODELER — the Radius-structural-beat feature
// ─────────────────────────────────────────────────────────────────────────
// Given acres + setbacks + wetlands, computes the realistic building envelope
// and picks optimal product type (1-story wide / 1-story / 2-story / 3-story).
// Replaces the naive buildablePct × 85% heuristic with setback-aware geometry.
// Radius hands you raw demographics; we hand you the actual building that
// fits with 50' front, 10' side, 25' rear setbacks, and a 5% wetlands haircut.
// ═══════════════════════════════════════════════════════════════════════════
const BUILD_SCENARIOS = {
  aggressive: {
    key: 'aggressive',
    label: 'AGGRESSIVE',
    frontSB: 25, sideSB: 10, rearSB: 15,
    wetlandsPct: 0,
    siteUtilization: 0.62,  // Rural/ETJ — can spread out, less code-driven landscaping
    desc: 'Rural/ETJ/unincorporated · minimal setbacks · clean pad',
    color: '#10B981',
  },
  base: {
    key: 'base',
    label: 'BASE CASE',
    frontSB: 50, sideSB: 10, rearSB: 25,
    wetlandsPct: 5,
    siteUtilization: 0.55,  // Typical suburban C-3 / M-1 with standard parking + detention
    desc: 'Standard commercial C-3 / M-1 · slight unusable area',
    color: '#C9A84C',
  },
  conservative: {
    key: 'conservative',
    label: 'CONSERVATIVE',
    frontSB: 75, sideSB: 25, rearSB: 35,
    wetlandsPct: 15,
    siteUtilization: 0.48,  // Overlay with heavy landscape buffers + enhanced parking
    desc: 'Overlay district · buffer setbacks · meaningful wetlands',
    color: '#F59E0B',
  },
};

function computeBuildableEnvelope(acres, scenario, overrides = {}) {
  const s = { ...scenario, ...overrides };
  const grossSF = (acres || 0) * 43560;
  const usableSF = grossSF * (1 - (s.wetlandsPct || 0) / 100);
  // Approximate parcel as square — good proxy for typical storage pads
  // (most PS sites are rectangular with ~1.5:1 aspect ratio; square is conservative).
  const sideLength = Math.sqrt(Math.max(0, usableSF));
  const buildableLength = Math.max(0, sideLength - (s.frontSB || 0) - (s.rearSB || 0));
  const buildableWidth  = Math.max(0, sideLength - ((s.sideSB || 0) * 2));
  const postSetbackEnvelope = buildableLength * buildableWidth;

  // Site-utilization factor — the post-setback envelope isn't 100% buildable.
  // Real storage sites lose area to: customer drive aisles (20-30' wide perimeter),
  // interior drive aisles, office parking, detention pond, landscape buffers.
  // Industry-standard FAR for 1-story storage is 0.30-0.40 of GROSS parcel.
  // That works out to roughly 0.55 of the post-setback envelope on typical pads.
  // This is the factor that converts "geometric max building envelope" into
  // "realistic 1-story footprint we could actually build and permit".
  const siteUtilization = s.siteUtilization != null ? s.siteUtilization : 0.55;
  const footprint = postSetbackEnvelope * siteUtilization;

  // Product auto-selection based on footprint size (empirical from PS/EXR dev standards).
  // Each tier has its own story count, CC/DU mix, and typical build $/SF cost basis.
  let stories, ccMixPct, buildPerSF, label, notes;
  if (footprint >= 55000) {
    stories = 1; ccMixPct = 65; buildPerSF = 62;
    label = '1-STORY WIDE PLATE';
    notes = 'Full 1-story plate · drive-up perimeter · class-B single story';
  } else if (footprint >= 40000) {
    stories = 1; ccMixPct = 70; buildPerSF = 68;
    label = '1-STORY';
    notes = 'Standard 1-story CC-dominant plate · front office + drive-up';
  } else if (footprint >= 25000) {
    stories = 2; ccMixPct = 82; buildPerSF = 88;
    label = '2-STORY';
    notes = '2-story climate-controlled · interior corridor · steel frame';
  } else if (footprint >= 15000) {
    stories = 3; ccMixPct = 92; buildPerSF = 108;
    label = '3-STORY';
    notes = '3-story CC stack · elevator served · urban/infill product';
  } else if (footprint >= 8000) {
    stories = 4; ccMixPct = 95; buildPerSF = 135;
    label = '4-STORY URBAN';
    notes = 'Infill only · high cost/SF · requires urban CC rent premium';
  } else {
    stories = 0; ccMixPct = 0; buildPerSF = 0;
    label = 'UNBUILDABLE';
    notes = 'Envelope too small after setbacks — reconsider parcel or setback assumptions';
  }

  const grossBuildingSF = footprint * stories;
  const netRentableSF = grossBuildingSF * 0.85;
  const ccSF = netRentableSF * (ccMixPct / 100);
  const duSF = netRentableSF * (1 - ccMixPct / 100);

  return {
    scenario: s,
    grossSF, usableSF,
    postSetbackEnvelope,          // max geometric envelope after setbacks
    siteUtilization,              // factor applied to get realistic footprint
    footprint,                    // realistic building footprint (what we'll actually build)
    stories, label, notes,
    grossBuildingSF, netRentableSF,
    ccSF, duSF, ccMixPct,
    buildPerSF,
    siteCoveragePct:    grossSF > 0 ? (footprint / grossSF) * 100 : 0,
    envelopeCoveragePct: grossSF > 0 ? (postSetbackEnvelope / grossSF) * 100 : 0,
    // For display: side length and post-setback dimensions in feet
    sideLength: Math.round(sideLength),
    buildableLength: Math.round(buildableLength),
    buildableWidth: Math.round(buildableWidth),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OPERATOR MATRIX — DJR DealFlow Oracle (v6)
// ─────────────────────────────────────────────────────────────────────────
// 49+ storage operators with machine-readable UW profiles, Hot Capital
// deployment ranking, pitch hooks, exec pedigree, primary sources.
// Built from memory/buyer-routing-matrix.md (Parts 0/4/4B/4C/4D/4E/12/13/15/17).
// Loaded lazily, cached at module scope. Merges INTO the hardcoded
// OPERATOR_KB/ECONOMICS/CONTACT_ROUTING at runtime so existing Stack-Rank,
// YOC calibration, and Pitch-this-site flows automatically pick up the
// expanded operator universe.
// ═══════════════════════════════════════════════════════════════════════════
let _operatorMatrixCache = null;
async function loadOperatorMatrix() {
  if (_operatorMatrixCache) return _operatorMatrixCache;
  try {
    const res = await fetch('/operator-matrix.json');
    if (!res.ok) throw new Error(`${res.status}`);
    const j = await res.json();
    _operatorMatrixCache = j;
    console.log(`[Operator Matrix] loaded ${j.version} · ${Object.keys(j.operators).length} entries`);
    return j;
  } catch (e) {
    console.warn('[Operator Matrix] load failed:', e.message);
    return null;
  }
}

// Given a brand name or free-text reference, find the matching matrix entry.
// Matches by exact operator key, alias, or case-insensitive substring.
function findMatrixOperator(matrix, brand) {
  if (!matrix?.operators || !brand) return null;
  const ops = matrix.operators;
  if (ops[brand]) return { key: brand, ...ops[brand] };
  const lower = brand.toLowerCase();
  for (const [k, v] of Object.entries(ops)) {
    if (!v || typeof v !== 'object') continue;
    if (k.toLowerCase() === lower) return { key: k, ...v };
    if (Array.isArray(v.aliases) && v.aliases.some(a => (a || '').toLowerCase() === lower)) return { key: k, ...v };
  }
  for (const [k, v] of Object.entries(ops)) {
    if (!v || typeof v !== 'object') continue;
    if (k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())) return { key: k, ...v };
  }
  return null;
}

// Return the full operator list (excluding meta keys like TIER_META, DO_NOT_ROUTE_META)
// as an array suitable for stack-rank rendering.
function listMatrixOperators(matrix) {
  if (!matrix?.operators) return [];
  return Object.entries(matrix.operators)
    .filter(([k, v]) => v && typeof v === 'object' && !k.endsWith('_META') && v.tier !== 'DUPLICATE' && v.tier !== 'ALIAS-SEE-StorageMart')
    .map(([k, v]) => ({ key: k, ...v }));
}

// Tier → numeric weight for Stack-Rank compositional scoring.
// Higher = pitch-first. Tier_1_Hot_Capital dominates when capital is deploying.
function matrixTierWeight(tier) {
  const w = {
    TIER_1_HOT_CAPITAL: 100,
    TIER_2_ACTIVE: 75,
    TIER_3_MEDIUM: 50,
    TIER_4_SELECTIVE: 35,
    TIER_5_HYPER_LOCAL: 25,
    DEVELOPER_ONLY: 15,
    DO_NOT_ROUTE: 0
  };
  return w[tier] || 40;
}

// Resolve a contact from the matrix (fallback for operators not in hardcoded CONTACT_ROUTING).
// Returns { name, title, email, phone, emailConfidence, cc, note, warning } shape
// matching the existing resolver.
function resolveMatrixContact(matrix, brand, state) {
  const op = findMatrixOperator(matrix, brand);
  if (!op?.contacts) return null;
  // PS has territory routing baked into the matrix
  if (op.key === 'Public Storage' && op.contacts.eastRouting && op.contacts.swRouting) {
    const psEast = matrix.operators.CONTACT_ROUTING_META?.psEastStates || [];
    const isEast = psEast.includes(String(state || '').toUpperCase());
    const route = isEast ? op.contacts.eastRouting : op.contacts.swRouting;
    return {
      name: route.name,
      title: route.title,
      email: route.email,
      cc: route.cc || [],
      note: isEast ? 'East territory — Madeleine + Jose + Dan auto-CC' : 'SW/NE/MI/NJ territory — Dan auto-CC',
      isPSFamily: true
    };
  }
  const primary = op.contacts.primary;
  if (!primary) return null;
  return {
    name: primary.name,
    title: primary.title,
    email: primary.email,
    phone: primary.phone,
    emailConfidence: primary.emailConfidence,
    cc: op.contacts.cc || ['Droscoe@DJRrealestate.com'],
    note: op.pitchHook,
    warning: op.operationalFlag || op.friction || (op.tier === 'DO_NOT_ROUTE' ? 'DO NOT ROUTE per matrix' : null),
    matrixSource: true
  };
}

// Build an enriched KB entry by merging hardcoded OPERATOR_KB with matrix data.
// Hardcoded wins for economics (10-K-sourced), matrix wins for pitch hook + tier + capital signals.
function enrichKBWithMatrix(kbEntry, matrix, brand) {
  const matrixOp = findMatrixOperator(matrix, brand);
  if (!matrixOp) return kbEntry;
  return {
    ...(kbEntry || {}),
    matrixTier: matrixOp.tier,
    hotCapitalRank: matrixOp.hotCapitalRank,
    pitchHook: matrixOp.pitchHook || kbEntry?.pitchHook,
    deploymentPressure: matrixOp.uwProfile?.deploymentPressure || matrixOp.capital?.deploymentPressure,
    capitalSignals: matrixOp.capital?.signals || [],
    activeFund: matrixOp.capital?.activeFund || matrixOp.capital?.activeFunds,
    fundSize: matrixOp.capital?.fundSize,
    percentDeployed: matrixOp.capital?.percentDeployed,
    execPedigree: matrixOp.execPedigree || [],
    hardNos: matrixOp.uwProfile?.hardNos || [],
    uniqueMoats: matrixOp.uwProfile?.uniqueMoats,
    primarySources: matrixOp.primarySources || [],
    operationalFlag: matrixOp.operationalFlag,
    matrixSource: true
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OPERATOR KNOWLEDGE BASE — institutional intel on top 12 storage operators.
// Source-stamped from 10-K/10-Q disclosures + public press. "We already know
// them." When any of these brands appear nearby, we surface the profile
// inline — the user sees operator intel without asking.
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// LEASE-UP PLAYBOOK — "We know the secret sauce."
// ═══════════════════════════════════════════════════════════════════════════
// Storvex institutional playbook: start low in Y1 (occ build), ease rents up
// in Y2-Y3 (stabilization ramp), jack via ECRI in Y4-Y6 (harvest). Per-brand
// premiums sourced from 10-K segment disclosures. This is the rent curve that
// institutional operators ACTUALLY execute — we surface it inline so the user
// sees the playbook for every REIT/regional near their subject site.
// ═══════════════════════════════════════════════════════════════════════════
const LEASE_UP_PLAYBOOK = {
  // Tier 1 — Top-shelf REITs (PSA/EXR execution template, 78% NOI target)
  'tier1': {
    label: 'TIER 1 · TOP-SHELF REIT',
    rentCurve: [
      { year: 'Y1', occ: '45%', rentIndex: 0.75, phase: 'LEASE-UP', note: 'Street rate discount 20-25% · 1-mo free concessions · occ build priority' },
      { year: 'Y2', occ: '75%', rentIndex: 0.88, phase: 'RAMP', note: 'Concessions burn off · street rates rising 5% · first ECRI on Y1 cohort (+6%)' },
      { year: 'Y3', occ: '91%', rentIndex: 1.00, phase: 'STABILIZED', note: 'Street rates at market · ECRI on rolled tenants (+8% avg) · NOI margin 65-70%' },
      { year: 'Y4', occ: '92%', rentIndex: 1.10, phase: 'HARVEST', note: 'ECRI program running at full cadence · rate lift compounding on sticky tenants' },
      { year: 'Y5', occ: '93%', rentIndex: 1.22, phase: 'HARVEST', note: 'PEAK ECRI — institutional comp sales validate stabilized NOI · 75%+ margin' },
      { year: 'Y6', occ: '93%', rentIndex: 1.35, phase: 'HARVEST', note: 'Sticky customer stock · 30+ month ALOS · price-inelastic · 78% NOI margin' }
    ],
    ecriRate: '8%/yr avg on rolled · 6-12mo cadence',
    occupancyTarget: '91-93%',
    noiMarginMature: '76-78%',
    stabilizationMonths: 30
  },
  'tier2': {
    label: 'TIER 2 · SECOND-TIER REIT / INSTITUTIONAL',
    rentCurve: [
      { year: 'Y1', occ: '42%', rentIndex: 0.78, phase: 'LEASE-UP', note: 'Street rate discount 18-22% · aggressive promo · occ priority' },
      { year: 'Y2', occ: '72%', rentIndex: 0.89, phase: 'RAMP', note: 'Ramp phase · first ECRI cohort · concessions rolling off' },
      { year: 'Y3', occ: '88%', rentIndex: 1.00, phase: 'STABILIZED', note: 'Market street rates · ECRI +6-7% · NOI 60-65%' },
      { year: 'Y4', occ: '90%', rentIndex: 1.08, phase: 'HARVEST', note: 'Rate lift compounding · stabilized cap rate validation' },
      { year: 'Y5', occ: '91%', rentIndex: 1.18, phase: 'HARVEST', note: 'Mature lease-up · 68-72% NOI margin' },
      { year: 'Y6', occ: '91%', rentIndex: 1.28, phase: 'HARVEST', note: 'Peak NOI · institutional comp sale candidate' }
    ],
    ecriRate: '6-7%/yr · 12mo cadence',
    occupancyTarget: '88-91%',
    noiMarginMature: '68-72%',
    stabilizationMonths: 34
  },
  'tier3': {
    label: 'TIER 3 · REGIONAL / PRIVATE CHAIN',
    rentCurve: [
      { year: 'Y1', occ: '40%', rentIndex: 0.80, phase: 'LEASE-UP', note: 'Local street discount 15-20% · basic promo · slow occ build' },
      { year: 'Y2', occ: '68%', rentIndex: 0.92, phase: 'RAMP', note: 'Ramp · first rate bumps on stickiest tenants (+4-5%)' },
      { year: 'Y3', occ: '85%', rentIndex: 1.00, phase: 'STABILIZED', note: 'Market rates · ECRI +4-5% (less aggressive vs REIT)' },
      { year: 'Y4', occ: '87%', rentIndex: 1.06, phase: 'HARVEST', note: 'Modest rate lift · NOI margin 55-60%' },
      { year: 'Y5', occ: '88%', rentIndex: 1.14, phase: 'HARVEST', note: 'Mature · attractive REIT acquisition target' },
      { year: 'Y6', occ: '88%', rentIndex: 1.22, phase: 'HARVEST', note: 'Peak pre-exit · often sold to REIT at this phase' }
    ],
    ecriRate: '4-5%/yr · 12-18mo cadence',
    occupancyTarget: '85-88%',
    noiMarginMature: '58-62%',
    stabilizationMonths: 36
  }
};

const OPERATOR_KB = {
  'Public Storage': {
    ticker: 'PSA', type: 'Public REIT', parent: 'Public Storage Inc.', hq: 'Glendale, CA',
    portfolioSize: '3,171 owned facilities · 48 joint-venture · 344 third-party managed',
    nationalSF: '~229M SF',
    noiMargin: '78.4% (same-store 2025 FY, PSA 10-K filed 2026-02-12)',
    revenuePerSF: '$18.50 (portfolio avg, 2025 10-K)',
    stabilizedRevPerSF: '$21.40',
    acquisitionVolume2024: '~$1.4B',
    stabilizedOccupancy: '91.0% (same-store) / 85.3% (total portfolio, 2025 10-K)',
    ecriProgram: '8%/yr avg on rolled tenants',
    acquisitionCap: '5.6% institutional (PSA 10-K disclosures)',
    playbookTier: 'tier1',
    expansionFocus: 'SW (TX/FL/AZ), Mid-Atlantic, Southeast — 3.5-5ac pads for 1-story CC, 2.5-3.5ac for multi-story',
    keyContacts: 'Daniel Wollent (SW/NE/MI Acquisitions Mgr), Matthew Toussaint (East), Brian Karis (Construction Head)',
    source10K: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001393311'
  },
  'iStorage': {
    ticker: 'via PSA', type: 'Public REIT (PS acquisition)', parent: 'Public Storage (2022 acquisition via NSA)', hq: 'Jupiter, FL',
    portfolioSize: '~500 facilities (within NSA portfolio, PS-controlled)',
    nationalSF: '~30M SF',
    noiMargin: 'blended with PSA portfolio',
    playbookTier: 'tier1',
    expansionFocus: 'Absorbed into PS acquisition funnel — no independent expansion signals',
    note: 'Part of PS family per §6b — do NOT count as independent competitor in CC SPC calc.'
  },
  'NSA': {
    ticker: 'NSA (delisted 2024 acquisition)', type: 'Acquired by Public Storage April 2024', parent: 'Public Storage', hq: 'Greenwood Village, CO',
    portfolioSize: '1,100+ facilities pre-merger',
    acquisitionPremium: '$11B all-cash PSA deal (April 2024)',
    playbookTier: 'tier1',
    note: 'Post-merger integration ongoing. Facilities operate under iStorage, Northwest, SecurCare, Storage Solutions, Guardian, Move It, Red Nova + PS brands.'
  },
  'Extra Space Storage': {
    ticker: 'EXR', type: 'Public REIT', parent: 'Extra Space Storage Inc.', hq: 'Salt Lake City, UT',
    portfolioSize: '3,700+ facilities post-Life Storage merger (July 2023 · ~$12B deal)',
    nationalSF: '~280M SF',
    noiMargin: '72-74% (EXR 10-K 2024)',
    revenuePerSF: '$17.20 (portfolio avg, 2024 10-K)',
    stabilizedRevPerSF: '$19.80',
    acquisitionCap: '5.8-6.2% institutional',
    stabilizedOccupancy: '93-94%',
    ecriProgram: '7-9%/yr on rolled · digital-first rate optimization engine',
    playbookTier: 'tier1',
    expansionFocus: 'Post-merger integration through 2025, then resuming acquisitions',
    note: 'Largest storage operator by facility count post-LSI merger. Direct PSA competitor on most deals.',
    source10K: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001289490'
  },
  'Life Storage': {
    ticker: 'LSI (merged into EXR 2023)', type: 'Public REIT (merged)', parent: 'Extra Space Storage (post-July 2023)', hq: 'Buffalo, NY',
    portfolioSize: '~1,200 facilities pre-merger',
    note: 'Merged into EXR 2023 — all new signage is Extra Space. Legacy LSI sites still in rebrand pipeline.',
    playbookTier: 'tier1'
  },
  'CubeSmart': {
    ticker: 'CUBE', type: 'Public REIT', parent: 'CubeSmart LP', hq: 'Malvern, PA',
    portfolioSize: '~1,500 facilities owned/managed',
    nationalSF: '~100M SF',
    noiMargin: '68-70% (CUBE 10-K 2024)',
    revenuePerSF: '$15.80 (portfolio avg)',
    stabilizedRevPerSF: '$17.90',
    acquisitionCap: '5.9-6.3% institutional',
    stabilizedOccupancy: '90.5-91.5%',
    ecriProgram: '7%/yr on rolled · 12-mo cadence',
    playbookTier: 'tier1',
    expansionFocus: 'Sun Belt + Northeast urban. Strong in NY/NJ/CT metros.',
    source10K: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001298946'
  },
  'SmartStop Self Storage': {
    ticker: 'SMA', type: 'Public (April 2025 NYSE IPO)', parent: 'SmartStop Self Storage REIT', hq: 'Ladera Ranch, CA',
    portfolioSize: '~220 facilities (US + Canada)',
    nationalSF: '~16M SF',
    noiMargin: '62-64% (maturing portfolio)',
    stabilizedOccupancy: '89-91%',
    ecriProgram: '6-8%/yr',
    acquisitionCap: '6.0-6.5%',
    playbookTier: 'tier2',
    expansionFocus: 'Aggressive Sun Belt + Canada expansion post-IPO · opportunistic on institutional pipeline',
    note: 'Newer public entrant — often more flexible on private deals than PSA/EXR. IPO capital raise funding 2026 pipeline.'
  },
  'Prime Storage Group': {
    type: 'Private Institutional', parent: 'Prime Group Holdings', hq: 'Denver, CO',
    portfolioSize: '~300+ facilities',
    nationalSF: '~22M SF',
    acquisitionCap: '6.0-6.5% (private institutional)',
    ecriProgram: '6-7%/yr',
    playbookTier: 'tier2',
    acquisitionFocus: 'OFF-MARKET ONLY per Dan Bierbach EVP Acquisitions policy',
    keyContacts: 'Dan Bierbach (EVP Acquisitions · dan.bierbach@goprimegroup.com · 303-915-7345)',
    note: 'Never pitch on-market Crexi/LoopNet deals — off-market only per explicit policy.'
  },
  'Simply Self Storage': {
    type: 'Private (Blackstone REIT)', parent: 'Blackstone Real Estate Income Trust (BREIT)', hq: 'Orlando, FL',
    portfolioSize: '~275 facilities',
    nationalSF: '~22M SF',
    acquisitionCap: '5.5-6.0% (Blackstone institutional)',
    ecriProgram: '7-8%/yr',
    playbookTier: 'tier1',
    expansionFocus: 'Metro growth markets — aggressive bid book',
    note: 'Blackstone paid $1.2B in 2023 for Simply Self Storage portfolio.'
  },
  'Morningstar Properties': {
    type: 'Private REIT', parent: 'Morningstar Storage Centers LLC', hq: 'Charlotte, NC',
    portfolioSize: '~150 facilities',
    nationalSF: '~10M SF',
    acquisitionCap: '6.0-6.5%',
    playbookTier: 'tier2',
    expansionFocus: 'Southeast · Mid-Atlantic · Texas · Top 50 MSAs',
    note: 'Large institutional private operator · focused acquisition program.'
  },
  'Baranof Holdings': {
    type: 'Private', parent: 'Baranof Holdings LLC', hq: 'Dallas, TX',
    portfolioSize: '~80 facilities',
    playbookTier: 'tier2',
    expansionFocus: 'Texas · Oklahoma · Southeast — fund-backed roll-up',
    note: 'Texas-HQ aggressive acquisition fund · active buyer in DFW/Houston/Austin.'
  },
  'Compass Self Storage': {
    type: 'Private', parent: 'Amsdell Companies', hq: 'Cleveland, OH',
    portfolioSize: '~120 facilities',
    nationalSF: '~8M SF',
    playbookTier: 'tier2',
    expansionFocus: 'Midwest · Southeast · Growing nationally',
    note: 'Amsdell family operator · 50+ years in storage · mix of owned + third-party managed.'
  },
  'Red Dot Storage': {
    type: 'Private', parent: 'Red Dot Storage LLC', hq: 'Chicago, IL',
    portfolioSize: '~120 facilities',
    playbookTier: 'tier3',
    expansionFocus: 'Midwest · Mid-South — drive-up + CC mix',
    note: 'Regional operator with steady acquisition cadence.'
  },
  'Metro Storage': {
    type: 'Private', parent: 'Metro Storage LLC', hq: 'Lake Forest, IL',
    portfolioSize: '~140 facilities',
    nationalSF: '~10M SF',
    playbookTier: 'tier2',
    expansionFocus: 'Chicago metro · Midwest · TX · FL'
  },
  'Snapbox Self Storage': {
    type: 'Private', parent: 'Snapbox LLC', hq: 'Southlake, TX',
    portfolioSize: '~60 facilities',
    playbookTier: 'tier3',
    expansionFocus: 'Texas · Sun Belt'
  },
  'West Coast Self Storage': {
    type: 'Private', parent: 'WCSS Holdings', hq: 'Everett, WA',
    portfolioSize: '~70 facilities',
    playbookTier: 'tier2',
    expansionFocus: 'WA · OR · CA · Pacific Northwest'
  },
  'Merit Hill Capital': {
    type: 'Private Institutional Fund', parent: 'Merit Hill Capital LP', hq: 'New York, NY',
    portfolioSize: '~120 facilities',
    nationalSF: '~9M SF',
    acquisitionCap: '5.8-6.3%',
    playbookTier: 'tier2',
    expansionFocus: 'Fund-backed institutional acquisitions · all markets'
  },
  'Moove In Self Storage': {
    type: 'Private', parent: 'Investment Real Estate Group (IREM)', hq: 'Harrisburg, PA',
    portfolioSize: '~80 facilities',
    playbookTier: 'tier3',
    expansionFocus: 'Mid-Atlantic · PA · MD · VA'
  },
  'Devon Self Storage': {
    type: 'Private', parent: 'Devon Self Storage Holdings', hq: 'Emeryville, CA',
    portfolioSize: '~55 facilities',
    playbookTier: 'tier3',
    expansionFocus: 'West · Sun Belt'
  },
  'Global Self Storage': {
    ticker: 'SELF', type: 'Public REIT (Micro-cap)', parent: 'Global Self Storage Inc.', hq: 'Millbrook, NY',
    portfolioSize: '13 facilities',
    playbookTier: 'tier3',
    note: 'Publicly traded but very small — not an institutional competitor for most markets.'
  },
  'StorageMart': {
    type: 'Private', parent: 'Storage Mart Partners', hq: 'Columbia, MO',
    portfolioSize: '~275 facilities',
    nationalSF: '~16M SF',
    playbookTier: 'tier2',
    ecriProgram: '6-7%/yr',
    expansionFocus: 'Midwest + select metros · US + Canada + UK'
  },
  'StorQuest': {
    type: 'Private', parent: 'The William Warren Group', hq: 'Santa Monica, CA',
    portfolioSize: '~225 facilities',
    nationalSF: '~14M SF',
    playbookTier: 'tier2',
    acquisitionFocus: 'OC CA, LA County CA, DC MSA (per Max Burch WWG 2026-04-08 confirmation)',
    keyContacts: 'Max Burch (Acquisitions)',
    rateTargets: '$1.80-2.00/SF/mo minimum · SF/cap <8.0 general'
  },
  'U-Haul Moving & Storage': {
    ticker: 'UHAL', type: 'Public (AMERCO)', parent: 'AMERCO', hq: 'Phoenix, AZ',
    portfolioSize: '~1,500 sites (mixed storage + truck rental)',
    nationalSF: '96.5M SF',
    playbookTier: 'tier3',
    expansionFocus: '50-70 new locations/yr — opportunistic acquisition of conversions',
    keyContacts: 'Aaron Cook (Dir Acquisitions), Jennifer Sawyer (RE Rep II)',
    note: 'Storage + truck rental hybrid · different unit economics vs pure-play REITs.'
  },
  'Storage King USA': {
    type: 'Private', parent: 'Andover Properties', hq: 'New York, NY',
    portfolioSize: '~200 facilities',
    playbookTier: 'tier2',
    keyContacts: 'Eric Brett, Karan Gupta, Van Manuel (andoverprop.com)',
    note: 'Secondary PS routing target after DW/MT pass per Dan R. 2026-03 policy.'
  },
  'All Storage': {
    type: 'Private', parent: 'All Storage LLC', hq: 'Dallas, TX',
    portfolioSize: '~70 facilities',
    playbookTier: 'tier2',
    expansionFocus: 'DFW · Texas dominant'
  },
  'Great Value Storage': {
    type: 'Private', parent: 'World Class Capital Group', hq: 'Austin, TX',
    portfolioSize: '~65 facilities',
    playbookTier: 'tier3',
    expansionFocus: 'Texas · Sun Belt'
  },
  'Janus International': {
    ticker: 'JBI', type: 'Public (storage infrastructure)', parent: 'Janus International Group', hq: 'Temple, GA',
    portfolioSize: 'N/A — supplier not operator',
    note: 'Dominant supplier of roll-up doors, hallway systems, SmartEntry access. Everyone buys from them. Not an acquirer.'
  }
};

function getOperatorIntel(brand) {
  // Match exact or partial
  if (OPERATOR_KB[brand]) return OPERATOR_KB[brand];
  const lower = (brand || '').toLowerCase();
  for (const [k, v] of Object.entries(OPERATOR_KB)) {
    if (lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)) return v;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Stream Einstein narrative via SSE (/api/narrate-stream)
// Browser parses incoming "data: {...}" events and dispatches to callbacks.
// ═══════════════════════════════════════════════════════════════════════════
async function streamNarrative(url, body, { onDelta, onSectionEnd, onDone, onError, onUsage } = {}) {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      onError?.(`${resp.status}: ${errText.slice(0, 300) || 'Streaming endpoint unavailable'}`);
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nlIdx;
      while ((nlIdx = buf.indexOf('\n\n')) >= 0) {
        const rawEvent = buf.slice(0, nlIdx);
        buf = buf.slice(nlIdx + 2);
        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.type === 'delta') onDelta?.(evt.section, evt.text);
            else if (evt.type === 'section_end') onSectionEnd?.(evt.section);
            else if (evt.type === 'done') onDone?.(evt.elapsedMs);
            else if (evt.type === 'error') onError?.(evt.error + (evt.detail ? ': ' + evt.detail : ''));
            else if (evt.type === 'usage') onUsage?.(evt.usage);
          } catch { /* ignore malformed */ }
        }
      }
    }
  } catch (err) {
    onError?.(err.message || String(err));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function QuickLookupPanel({ autoEnrichESRI, fbSet, fbPush, notify, navigateTo, setTab }) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [phase, setPhase] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestIdx, setActiveSuggestIdx] = useState(-1);

  const autoRunRef = useRef(false);

  // Persist lookup result to localStorage cache as oracles resolve. Writes
  // debounce naturally via the result state — every oracle resolution
  // triggers one write with the latest enriched state. Skip writes when
  // this IS a cache read (prevents loop) or before any oracle has finished.
  React.useEffect(() => {
    if (!result || !address) return;
    if (result._fromCache) return;
    if (!result.zoningIntel && !result.utilityIntel && !result.accessIntel) return;
    writeLookupCache(address, result);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, address]);
  const suggestTimerRef = useRef(null);
  const suggestAbortRef = useRef(null);
  const suggestBoxRef = useRef(null);

  // Clear stale error banner the moment address changes (typing, suggestion
  // click, chip click, or URL prefill). Prior bug: user typed an unrecognized
  // address, got "No address match found" banner, then selected a real
  // suggestion — the banner persisted below the input until the next runLookup
  // started, making it look like the platform was still failing when the user
  // had already corrected the input. Clearing on every address change kills
  // that confusion at the source.
  useEffect(() => {
    if (address) setError(null);
  }, [address]);

  // Debounced address suggestions (ESRI suggest — 220ms after last keypress)
  useEffect(() => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    if (suggestAbortRef.current) suggestAbortRef.current.abort();
    const text = address.trim();
    if (text.length < 3) { setSuggestions([]); return; }
    suggestTimerRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      suggestAbortRef.current = ctrl;
      const sugs = await esriSuggest(text, ctrl.signal);
      if (sugs === null) return; // aborted
      setSuggestions(sugs);
      setActiveSuggestIdx(-1);
    }, 220);
    return () => clearTimeout(suggestTimerRef.current);
  }, [address]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e) => {
      if (suggestBoxRef.current && !suggestBoxRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Auto-run from ?addr= query param (shareable link)
  useEffect(() => {
    if (autoRunRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get('addr');
    if (prefill && prefill.length > 3) {
      autoRunRef.current = true;
      setAddress(prefill);
      // Defer one tick so address state is set before runLookup reads it
      setTimeout(() => {
        const btn = document.querySelector('button[data-role="run-lookup"]');
        if (btn) btn.click();
      }, 300);
    }
  }, []);

  // ─── localStorage address-result cache ─────────────────────────────
  // Stores the complete lookup result (demographics + competitors + all 3
  // oracles + matrix) keyed by normalized address, TTL 24h. Eliminates
  // rate-limit burn on repeat lookups of the same address (Dan's common
  // pattern: look up site, get broker response 2-3 days later, look it up
  // again). Keep size bounded by evicting oldest on 5MB cap.
  //
  // Cache is client-side only (per-user) — appropriate for single-tenant
  // weapon usage. When Tier 2 SaaS layer launches, move to Firebase-backed
  // shared cache with per-org namespace.
  const CACHE_VERSION = 'v1';
  const CACHE_PREFIX = `storvex-lookup-cache-${CACHE_VERSION}:`;
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  const normalizeAddressKey = (addr) => (addr || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

  const readLookupCache = (addr) => {
    try {
      const key = CACHE_PREFIX + normalizeAddressKey(addr);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL_MS) {
        localStorage.removeItem(key);
        return null;
      }
      return { data, cachedAt: new Date(ts), ageMs: Date.now() - ts };
    } catch (e) { return null; }
  };

  const writeLookupCache = (addr, data) => {
    try {
      const key = CACHE_PREFIX + normalizeAddressKey(addr);
      const payload = JSON.stringify({ data, ts: Date.now() });
      try {
        localStorage.setItem(key, payload);
      } catch (quotaErr) {
        // QuotaExceeded — evict oldest entries and retry once
        const entries = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(CACHE_PREFIX)) {
            try { entries.push({ k, ts: JSON.parse(localStorage.getItem(k)).ts }); } catch (e) { /* skip */ }
          }
        }
        entries.sort((a, b) => a.ts - b.ts).slice(0, Math.max(1, Math.floor(entries.length / 2))).forEach(e => localStorage.removeItem(e.k));
        try { localStorage.setItem(key, payload); } catch (e2) { /* give up */ }
      }
    } catch (e) { /* cache write best-effort — never blocks lookup */ }
  };

  const runLookup = useCallback(async () => {
    if (!address.trim()) { setError('Enter an address'); return; }
    setLoading(true); setError(null); setResult(null);
    const started = Date.now();
    try {
      // Check cache first — serve instant if < 24h old. Skip via Shift-click
      // Run button (future enhancement) or clear localStorage to force fresh.
      const cacheHit = readLookupCache(address);
      if (cacheHit) {
        setPhase('');
        const hours = (cacheHit.ageMs / (60*60*1000)).toFixed(1);
        setResult({ ...cacheHit.data, _fromCache: true, _cacheAgeHours: hours });
        setLoading(false);
        return;
      }

      setPhase('Geocoding address...');
      const geo = await geocodeAddress(address);
      setPhase('Pulling ESRI demographics + Tapestry (1/3/5 mi rings)...');
      const esriP = fetchESRIEnrichment(geo.lat, geo.lng);
      setPhase('Enumerating competitors via Places API + REIT Registry + DealFlow Oracle matrix...');
      const placesP = fetchPlacesCompetitors(geo.lat, geo.lng, 3);
      const registryP = loadREITRegistry();
      const matrixP = loadOperatorMatrix();
      // SpareFoot live market rents (CC + drive-up $/SF/mo) — parallel fetch so
      // the MARKET INTEL band can render with primary-source rent data, not
      // benchmark constants. Failure is silent (returns null) so a SpareFoot
      // outage doesn't break the rest of the report — the band gracefully
      // degrades to REIT-benchmark fallback.
      const rentsP = fetch(`/api/sparefoot-rents?city=${encodeURIComponent(geo.city || '')}&state=${encodeURIComponent(geo.state || '')}&zip=${encodeURIComponent(geo.zip || '')}&lat=${geo.lat}&lon=${geo.lng}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);
      const [esri, competitors, registry, matrix, marketRents] = await Promise.all([esriP, placesP, registryP, matrixP, rentsP]);

      // Authoritative REIT match — finds PS/iStorage/NSA locations even if Places missed them
      const reit3mi = registry ? findREITFacilitiesNearby(registry, geo.lat, geo.lng, 3) : [];
      const reit5mi = registry ? findREITFacilitiesNearby(registry, geo.lat, geo.lng, 5) : [];
      // Merge REIT registry hits into competitor list (avoid coord dupes with Places)
      const mergedCompetitors = [...competitors];
      for (const r of reit3mi) {
        const dup = mergedCompetitors.find(c => c.lat && Math.abs(c.lat - r.lat) < 0.001 && Math.abs(c.lng - r.lon) < 0.001);
        if (dup) {
          dup.reitRegistry = { brand: r.brand, id: r.id };
        } else {
          mergedCompetitors.push({
            id: `reit_${r.id}`,
            name: `${r.brand} — ${r.name}`,
            address: `${r.address}, ${r.city}, ${r.state} ${r.zip}`,
            lat: r.lat,
            lng: r.lon,
            distanceMi: r.distanceMi,
            source: 'reit-registry',
            reitRegistry: { brand: r.brand, id: r.id }
          });
        }
      }
      mergedCompetitors.sort((a, b) => (a.distanceMi || 99) - (b.distanceMi || 99));
      setPhase('Synthesizing report...');

      // Derive key metrics from ring3
      const r3 = esri.ring3 || {};
      const r1 = esri.ring1 || {};
      const r5 = esri.ring5 || {};
      const popGrowth = r3.TOTPOP_CY > 0 && r3.TOTPOP_FY > 0 ? (Math.pow(r3.TOTPOP_FY / r3.TOTPOP_CY, 1/5) - 1) * 100 : null;
      const hhiGrowth = r3.MEDHINC_CY > 0 && r3.MEDHINC_FY > 0 ? (Math.pow(r3.MEDHINC_FY / r3.MEDHINC_CY, 1/5) - 1) * 100 : null;
      const renterPct = (r3.OWNER_CY + r3.RENTER_CY) > 0 ? r3.RENTER_CY / (r3.OWNER_CY + r3.RENTER_CY) * 100 : null;
      const peakAge = (r3.POP25_CY||0)+(r3.POP30_CY||0)+(r3.POP35_CY||0)+(r3.POP40_CY||0)+(r3.POP55_CY||0)+(r3.POP60_CY||0)+(r3.POP65_CY||0)+(r3.POP70_CY||0);
      const peakPct = r3.TOTPOP_CY > 0 ? peakAge / r3.TOTPOP_CY * 100 : null;
      const hhOver75 = (r3.HINC75_CY||0)+(r3.HINC100_CY||0)+(r3.HINC150_CY||0)+(r3.HINC200_CY||0);
      const hhOver75Pct = r3.TOTHH_CY > 0 ? hhOver75 / r3.TOTHH_CY * 100 : null;
      const collegeEd = (r3.BACHDEG_CY||0)+(r3.GRADDEG_CY||0);
      const collegePct = r3.TOTPOP_CY > 0 ? collegeEd / r3.TOTPOP_CY * 100 : null;
      const vacancyPct = r3.TOTHU_CY > 0 ? r3.VACANT_CY / r3.TOTHU_CY * 100 : null;

      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      // DealFlow Oracle matrix — expose to downstream Stack-Rank, Pitch, PDF consumers.
      // Computes Top-7 buyer shortlist ranked by tier + deployment pressure + geography fit.
      const matrixOperators = listMatrixOperators(matrix);
      const siteState = (geo?.state || '').toUpperCase();
      const matrixShortlist = matrixOperators
        .filter(op => op.tier !== 'DO_NOT_ROUTE' && op.tier !== 'DEVELOPER_ONLY')
        .map(op => {
          const geoFit = !op.uwProfile?.geography?.length ? 0.5
            : op.uwProfile.geography.some(g => (g || '').toUpperCase().includes(siteState) || siteState.length === 0 ? true : false) ? 1.0
            : 0.3;
          const tierScore = matrixTierWeight(op.tier);
          const pressureBonus = op.uwProfile?.deploymentPressure === 'HIGH' || op.uwProfile?.deploymentPressure === 'VERY HIGH' ? 20 : op.uwProfile?.deploymentPressure === 'MEDIUM-HIGH' ? 15 : op.uwProfile?.deploymentPressure === 'MEDIUM' ? 10 : 0;
          return { ...op, score: tierScore + pressureBonus + (geoFit * 10), geoFit };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 7);
      const baseResult = {
        geo, esri, r1, r3, r5,
        competitors: mergedCompetitors,
        placesCount: competitors.length,
        reit3mi, reit5mi,
        registryRecordCount: registry?.recordCount || 0,
        metrics: { popGrowth, hhiGrowth, renterPct, peakPct, hhOver75Pct, collegePct, vacancyPct },
        // Live SpareFoot market rents (CC + drive-up $/SF/mo). Source-stamped
        // on the MARKET INTEL band. Null when SpareFoot endpoint errors or has
        // no coverage in submarket — band falls back to REIT-benchmark midpoint.
        marketRents,
        elapsed,
        generatedAt: new Date().toISOString(),
        narrative: null,
        narrativeStatus: 'pending',
        // DealFlow Oracle matrix data
        matrix,
        matrixVersion: matrix?.version || null,
        matrixOperatorCount: matrixOperators.length,
        matrixShortlist
      };
      setResult(baseResult);
      setPhase('');

      // Kick off Einstein narrative via /api/narrate (Vercel serverless)
      // Fires in the background — result updates as soon as narrative lands.
      const auditPayload = {
        ccSPC_verified: null, // not computed in Phase 1 (no SpareFoot scrape)
        ccFacilityCount: competitors.length,
        totalCompetitorsFound: competitors.length,
        competitorSet: competitors.slice(0, 10),
        auditConfidence: 'QUICK_LOOKUP',
      };
      const sitePayload = {
        name: `${geo.city || ''} ${geo.state || ''}`.trim(),
        address: geo.formatted,
        city: geo.city, state: geo.state,
        coordinates: `${geo.lat}, ${geo.lng}`,
        pop3mi: r3?.TOTPOP_CY?.toLocaleString(),
        pop5mi: r5?.TOTPOP_CY?.toLocaleString(),
        income3mi: r3?.MEDHINC_CY ? '$' + Math.round(r3.MEDHINC_CY).toLocaleString() : null,
        avgIncome3mi: r3?.AVGHINC_CY ? '$' + Math.round(r3.AVGHINC_CY).toLocaleString() : null,
        households3mi: r3?.TOTHH_CY?.toLocaleString(),
        homeValue3mi: r3?.MEDVAL_CY ? '$' + Math.round(r3.MEDVAL_CY).toLocaleString() : null,
        avgHomeValue3mi: r3?.AVGVAL_CY ? '$' + Math.round(r3.AVGVAL_CY).toLocaleString() : null,
        growthRate: popGrowth != null ? popGrowth.toFixed(2) + '%' : null,
        renterPct3mi: renterPct != null ? Math.round(renterPct) + '%' : null,
        tapestrySegment3mi: r3?.TSEGNAME || null,
        peakStorageAgePct3mi: peakPct != null ? peakPct.toFixed(1) + '%' : null,
        hhOver75K_pct3mi: hhOver75Pct != null ? hhOver75Pct.toFixed(1) + '%' : null,
        collegeEdPct3mi: collegePct != null ? collegePct.toFixed(1) + '%' : null,
        vacancyRate3mi: vacancyPct != null ? vacancyPct.toFixed(1) + '%' : null,
      };
      // Fire Zoning + Utility + Access Oracles in parallel with the narrative
      // stream. Each lands async as r.zoningIntel / r.utilityIntel / r.accessIntel.
      //
      // RATE-LIMIT RETRY WRAPPER: Anthropic Haiku enforces 50K tokens/min sliding
      // window. Each Oracle burns ~15-20K tokens, so 3 parallel oracles for one
      // address = 45-60K tokens in a ~30s burst — right at the ceiling. If Dan
      // runs a 2nd address within 60s, the next batch 429s. This wrapper detects
      // the rate-limit error string and retries once after 60s (plenty of time
      // for the sliding window to clear). Status updates reflect the wait.
      setResult(r => r ? {
        ...r,
        zoningIntel: null, zoningStatus: 'pending',
        utilityIntel: null, utilityStatus: 'pending',
        accessIntel: null, accessStatus: 'pending',
      } : r);

      const isRateLimitError = (j) => {
        if (!j) return false;
        const body = JSON.stringify(j).toLowerCase();
        return body.includes('rate_limit') || body.includes('429') || body.includes('rate limit');
      };

      const fetchOracleWithRetry = async (url, body, setIntel, setStatus, statusKey) => {
        const attempt = async (attemptNum) => {
          try {
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`${r.status}`);
            const j = await r.json();
            if (isRateLimitError(j) && attemptNum < 2) {
              // Rate-limit hit on first attempt — surface retry-pending status + wait 60s
              setStatus('retrying');
              await new Promise(res => setTimeout(res, 60000));
              return attempt(attemptNum + 1);
            }
            setIntel(j);
            setStatus(j.ok === false || j.found === false ? 'not-found' : 'done');
          } catch (e) {
            setIntel({ ok: false, error: e.message });
            setStatus('error');
          }
        };
        return attempt(1);
      };

      if (geo.city && geo.state) {
        fetchOracleWithRetry('/api/zoning-lookup',
          { city: geo.city, state: geo.state, county: geo.county || null, address: geo.formatted, zoningDistrict: null },
          (j) => setResult(r => r ? { ...r, zoningIntel: j } : r),
          (s) => setResult(r => r ? { ...r, zoningStatus: s } : r),
          'zoning'
        );
        fetchOracleWithRetry('/api/utility-lookup',
          { city: geo.city, state: geo.state, county: geo.county || null, address: geo.formatted, zip: geo.zip || null },
          (j) => setResult(r => r ? { ...r, utilityIntel: j } : r),
          (s) => setResult(r => r ? { ...r, utilityStatus: s } : r),
          'utility'
        );
        fetchOracleWithRetry('/api/access-lookup',
          { city: geo.city, state: geo.state, county: geo.county || null, address: geo.formatted, zip: geo.zip || null, coordinates: { lat: geo.lat, lon: geo.lng } },
          (j) => setResult(r => r ? { ...r, accessIntel: j } : r),
          (s) => setResult(r => r ? { ...r, accessStatus: s } : r),
          'access'
        );
      }

      setPhase('Streaming Einstein narrative (Claude Haiku 4.5)...');
      streamNarrative('/api/narrate-stream', { audit: auditPayload, site: sitePayload, buyerType: 'storage_reit' }, {
        onDelta: (section, text) => {
          setResult(r => {
            if (!r) return r;
            const narrative = r.narrative || { executiveSummary: '', investmentMemoLong: '', anomalyFlagsRaw: '', buyerPitchEmail: '', outreachIntelRaw: '' };
            if (section === 'EXECUTIVE_SUMMARY') narrative.executiveSummary = (narrative.executiveSummary || '') + text;
            else if (section === 'INVESTMENT_MEMO_LONG') narrative.investmentMemoLong = (narrative.investmentMemoLong || '') + text;
            else if (section === 'ANOMALY_FLAGS') narrative.anomalyFlagsRaw = (narrative.anomalyFlagsRaw || '') + text;
            else if (section === 'BUYER_PITCH_EMAIL') narrative.buyerPitchEmail = (narrative.buyerPitchEmail || '') + text;
            else if (section === 'OUTREACH_INTEL') narrative.outreachIntelRaw = (narrative.outreachIntelRaw || '') + text;
            return { ...r, narrative, narrativeStatus: 'streaming' };
          });
        },
        onSectionEnd: (section) => {
          setResult(r => {
            if (!r || !r.narrative) return r;
            const n = { ...r.narrative };
            // Parse anomaly flags from lines starting with "• " or "- "
            if (section === 'ANOMALY_FLAGS' && n.anomalyFlagsRaw) {
              n.anomalyFlags = n.anomalyFlagsRaw.split('\n').map(l => l.replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean);
            }
            // Parse outreach intel into structured object
            if (section === 'OUTREACH_INTEL' && n.outreachIntelRaw) {
              const intel = {};
              const bh = n.outreachIntelRaw.match(/BEST_HOOK:\s*(.*)/i); if (bh) intel.bestHook = bh[1].trim();
              const ts = n.outreachIntelRaw.match(/TIMING_SIGNAL:\s*(.*)/i); if (ts) intel.timingSignal = ts[1].trim();
              const rd = n.outreachIntelRaw.match(/RISK_DISCLOSURE:\s*(.*)/i); if (rd) intel.riskDisclosure = rd[1].trim();
              n.outreachIntel = intel;
            }
            return { ...r, narrative: n };
          });
        },
        onDone: (elapsedMs) => {
          setResult(r => r ? { ...r, narrative: { ...r.narrative, elapsedMs }, narrativeStatus: 'done' } : r);
          setPhase('');
        },
        onError: (err) => {
          setResult(r => r ? { ...r, narrativeStatus: 'error', narrativeError: err + ' (note: streaming endpoint requires Vercel deployment — localhost dev server does not serve /api/*)' } : r);
          setPhase('');
        }
      });
    } catch (e) {
      setError(e.message || String(e));
    }
    setLoading(false);
  }, [address]);

  const saveToFirebase = useCallback(async () => {
    if (!result) return;
    const id = `lookup_${Date.now().toString(36)}`;
    const g = result.geo;
    const r3 = result.r3;
    const site = {
      name: `${g.city} ${g.state} — ${g.streetNumber} ${g.route}`.trim(),
      address: `${g.streetNumber} ${g.route}, ${g.city}, ${g.state} ${g.zip}`.trim(),
      city: g.city, state: g.state,
      coordinates: `${g.lat}, ${g.lng}`,
      region: /^(TX|FL|CA|AZ|NV|CO|UT|NM|NE|MI|OK)$/.test(g.state) ? 'southwest' : 'east',
      phase: 'Prospect',
      status: 'pending',
      listingSource: 'Storvex Quick Lookup',
      pop1mi: result.r1?.TOTPOP_CY?.toLocaleString(),
      pop3mi: r3?.TOTPOP_CY?.toLocaleString(),
      pop5mi: result.r5?.TOTPOP_CY?.toLocaleString(),
      income3mi: r3?.MEDHINC_CY ? '$' + Math.round(r3.MEDHINC_CY).toLocaleString() : null,
      homeValue3mi: r3?.MEDVAL_CY ? '$' + Math.round(r3.MEDVAL_CY).toLocaleString() : null,
      households3mi: r3?.TOTHH_CY?.toLocaleString(),
      growthRate: result.metrics.popGrowth ? result.metrics.popGrowth.toFixed(2) + '%' : null,
      popGrowth3mi: result.metrics.popGrowth ? result.metrics.popGrowth.toFixed(2) + '%' : null,
      renterPct3mi: result.metrics.renterPct ? Math.round(result.metrics.renterPct) + '%' : null,
      tapestrySegment3mi: r3?.TSEGNAME || null,
      latestNote: `Quick Lookup ${new Date().toLocaleDateString()} — awaiting SpareFoot + Einstein narrative from next scheduled audit.`,
      latestNoteDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      demoSource: 'ESRI GeoEnrichment v3 via Quick Lookup',
      demoPulledAt: new Date().toISOString(),
    };
    // Strip null
    for (const k of Object.keys(site)) if (site[k] == null) delete site[k];
    fbSet(`submissions/${id}`, site);
    fbPush(`submissions/${id}/activityLog`, { action: 'Site created via Quick Lookup', ts: new Date().toISOString(), by: 'Dan R.' });
    notify(`Saved to Pipeline. Scheduled audit will populate SpareFoot + Einstein narrative within 5 min.`);
    setTab('review');
  }, [result, fbSet, fbPush, notify, setTab]);

  // ─── Styles ───
  const pageBg = { minHeight: '100vh', padding: '24px 16px' };
  const card = { background: 'rgba(15,21,56,0.6)', border: '1px solid rgba(201,168,76,0.12)', borderRadius: 14, padding: 24, marginBottom: 16 };
  const label = { fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(201,168,76,0.85)', marginBottom: 6 };
  const bigNum = { fontSize: 22, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace" };
  const subNum = { fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 3 };
  const metricBox = { background: 'rgba(0,0,0,0.25)', padding: '14px 16px', borderRadius: 10, borderLeft: '3px solid #C9A84C' };

  return (
    <div style={pageBg}>
      {/* HEADER */}
      <div style={{ ...card, background: 'linear-gradient(135deg, #0F1538 0%, #1E2761 55%, #0A1127 100%)', border: '1px solid rgba(201,168,76,0.25)', position: 'relative' }}>
        <style>{`
          @keyframes storvexAuraSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          @keyframes storvexAuraPulse { 0%,100% { opacity: 0.55; transform: scale(1); } 50% { opacity: 0.95; transform: scale(1.08); } }
          @keyframes storvexInputGlow { 0%,100% { box-shadow: 0 0 0 1px rgba(201,168,76,0.35), 0 0 28px rgba(201,168,76,0.18); } 50% { box-shadow: 0 0 0 1px rgba(201,168,76,0.55), 0 0 42px rgba(201,168,76,0.32); } }
          @keyframes storvexCaret { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
          @keyframes storvexShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
          @keyframes storvexChipIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
          .storvex-chip { animation: storvexChipIn 320ms ease-out backwards; }
          .storvex-chip:hover { background: linear-gradient(90deg, rgba(201,168,76,0.22), rgba(201,168,76,0.08)) !important; border-color: rgba(201,168,76,0.55) !important; color: #fff !important; transform: translateY(-1px); }
          .storvex-chip { transition: all 160ms ease; }
          .storvex-input-wrap:focus-within { animation: storvexInputGlow 2.4s ease-in-out infinite; }
          .storvex-tagline { background: linear-gradient(90deg, rgba(255,255,255,0.55) 0%, #C9A84C 35%, rgba(255,255,255,0.55) 70%, #C9A84C 100%); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: storvexShimmer 6s linear infinite; }
        `}</style>
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'inherit', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: -30, right: -30, width: 180, height: 180, background: 'radial-gradient(circle, rgba(201,168,76,0.18), transparent 70%)' }} />
          <div style={{ position: 'absolute', bottom: -60, left: -40, width: 240, height: 240, background: 'radial-gradient(circle, rgba(76,201,130,0.10), transparent 65%)' }} />
        </div>

        {/* Status row: live badge + AI orb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'linear-gradient(90deg, rgba(76,201,130,0.18), rgba(76,201,130,0.06))', padding: '4px 12px', borderRadius: 20, border: '1px solid rgba(76,201,130,0.35)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4CC982', boxShadow: '0 0 12px #4CC982', animation: 'storvexAuraPulse 1.6s ease-in-out infinite' }} />
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: '#4CC982' }}>QUICK LOOKUP · LIVE</span>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)' }}>
            <span style={{ position: 'relative', width: 8, height: 8 }}>
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'conic-gradient(from 0deg,#C9A84C,#E4CB7C,#4CC982,#C9A84C)', animation: 'storvexAuraSpin 2.8s linear infinite' }} />
              <span style={{ position: 'absolute', inset: 2, borderRadius: '50%', background: '#0F1538' }} />
            </span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: '#E4CB7C' }}>EINSTEIN AI · ARMED</span>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.6)' }}>4,238 REIT PINS · 12 OPERATOR PROFILES INDEXED</span>
          </div>
        </div>

        <h2 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: '#fff', letterSpacing: '-0.025em', lineHeight: 1.15 }}>
          <span style={{ background: 'linear-gradient(90deg,#C9A84C,#E4CB7C,#C9A84C)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Storvex</span> knows the answer.
          <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 700 }}> Ask any address.</span>
        </h2>
        <div className="storvex-tagline" style={{ fontSize: 12, marginTop: 10, fontWeight: 600, letterSpacing: '0.02em' }}>
          ESRI demographics · Tapestry segmentation · 4,238 REIT facility pins · Places competitor sweep · PS family exclusion · CC SPC · Einstein narrative — all in ten seconds.
        </div>

        {/* Search Input with ESRI autocomplete */}
        <div style={{ marginTop: 20, display: 'flex', gap: 10, position: 'relative' }} ref={suggestBoxRef}>
          <div className="storvex-input-wrap" style={{ flex: 1, position: 'relative', borderRadius: 10 }}>
            <input
              value={address}
              onChange={e => { setAddress(e.target.value); setShowSuggestions(true); }}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setShowSuggestions(true);
                  setActiveSuggestIdx(i => Math.min(i + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveSuggestIdx(i => Math.max(i - 1, -1));
                } else if (e.key === 'Enter') {
                  if (showSuggestions && activeSuggestIdx >= 0 && suggestions[activeSuggestIdx]) {
                    setAddress(suggestions[activeSuggestIdx].text);
                    setShowSuggestions(false);
                    setTimeout(() => runLookup(), 50);
                  } else if (!loading) {
                    setShowSuggestions(false);
                    runLookup();
                  }
                } else if (e.key === 'Escape') {
                  setShowSuggestions(false);
                }
              }}
              placeholder="Start typing an address — e.g., 1402 S 5th Street, Temple, TX"
              disabled={loading}
              autoComplete="off"
              spellCheck="false"
              style={{ width: '100%', padding: '14px 18px', borderRadius: 10, border: '1px solid rgba(201,168,76,0.3)', background: 'rgba(0,0,0,0.4)', color: '#fff', fontSize: 14, fontFamily: "'Inter', sans-serif", outline: 'none', boxSizing: 'border-box' }}
            />
            {showSuggestions && suggestions.length > 0 && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: 'linear-gradient(180deg, rgba(15,21,56,0.98) 0%, rgba(10,17,39,0.98) 100%)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(201,168,76,0.35)', borderRadius: 12, boxShadow: '0 24px 48px rgba(0,0,0,0.55), 0 2px 0 rgba(201,168,76,0.08) inset', zIndex: 100, overflow: 'hidden', animation: 'storvexDropIn 140ms ease-out' }}>
                <style>{`@keyframes storvexDropIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                {suggestions.map((s, i) => {
                  const active = activeSuggestIdx === i;
                  return (
                    <div
                      key={s.magicKey || i}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setAddress(s.text);
                        setShowSuggestions(false);
                        setTimeout(() => runLookup(), 50);
                      }}
                      onMouseEnter={() => setActiveSuggestIdx(i)}
                      style={{ position: 'relative', padding: '14px 18px 14px 22px', cursor: 'pointer', fontSize: 13, color: active ? '#fff' : 'rgba(255,255,255,0.88)', background: active ? 'linear-gradient(90deg, rgba(201,168,76,0.14), rgba(201,168,76,0.04))' : 'transparent', borderBottom: i < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 120ms ease, color 120ms ease', fontFamily: "'Inter', sans-serif", letterSpacing: '-0.005em' }}
                    >
                      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: active ? '#C9A84C' : 'transparent', transition: 'background 120ms ease' }} />
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={active ? '#E4CB7C' : 'rgba(201,168,76,0.65)'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'stroke 120ms ease' }}>
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.text}</span>
                    </div>
                  );
                })}
                <div style={{ padding: '8px 16px', fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.42)', background: 'rgba(0,0,0,0.4)', letterSpacing: '0.12em', textAlign: 'right', borderTop: '1px solid rgba(201,168,76,0.12)', textTransform: 'uppercase' }}>
                  <span style={{ color: 'rgba(255,255,255,0.55)' }}>↑↓</span> Navigate &nbsp;·&nbsp; <span style={{ color: 'rgba(255,255,255,0.55)' }}>↵</span> Select &nbsp;·&nbsp; <span style={{ color: 'rgba(255,255,255,0.55)' }}>esc</span> Close &nbsp;·&nbsp; <span style={{ color: '#C9A84C' }}>ESRI World Geocoder</span>
                </div>
              </div>
            )}
          </div>
          <button
            data-role="run-lookup"
            onClick={() => { setShowSuggestions(false); runLookup(); }}
            disabled={loading || !address.trim()}
            style={{ padding: '14px 24px', borderRadius: 10, border: 'none', background: loading ? 'rgba(201,168,76,0.3)' : 'linear-gradient(135deg, #C9A84C, #E4CB7C)', color: '#1E2761', fontSize: 13, fontWeight: 900, letterSpacing: '0.06em', cursor: loading ? 'wait' : 'pointer', textTransform: 'uppercase' }}
          >
            {loading ? 'Running...' : '⚡ Run Market Report'}
          </button>
        </div>
        {/* Example query chips — "ask anything" prompts */}
        {!loading && !result && (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginRight: 4 }}>Try:</span>
            {[
              { label: '1402 S 5th St, Temple TX', q: '1402 S 5th Street, Temple, TX' },
              { label: '222 W Mission Ave, Escondido CA', q: '222 W Mission Ave, Escondido, CA 92025' },
              { label: '7352 W 300 N, Greenfield IN', q: '7352 W 300 N, Greenfield, IN' },
              { label: '3303 N McDonald, McKinney TX', q: '3303 N McDonald St, McKinney, TX' },
            ].map((chip, i) => (
              <button
                key={chip.q}
                className="storvex-chip"
                onClick={() => { setAddress(chip.q); setShowSuggestions(false); setTimeout(() => runLookup(), 50); }}
                style={{ padding: '6px 12px', borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(201,168,76,0.22)', color: 'rgba(255,255,255,0.78)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif", letterSpacing: '-0.005em', animationDelay: `${i * 60}ms` }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
        {loading && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'linear-gradient(90deg, rgba(201,168,76,0.10), rgba(201,168,76,0.02))', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ position: 'relative', width: 14, height: 14, flexShrink: 0 }}>
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'conic-gradient(from 0deg,#C9A84C,#E4CB7C,transparent 75%,#C9A84C)', animation: 'storvexAuraSpin 1s linear infinite' }} />
              <span style={{ position: 'absolute', inset: 3, borderRadius: '50%', background: '#0F1538' }} />
            </span>
            <div style={{ flex: 1, fontSize: 12, color: '#E4CB7C', fontWeight: 600, letterSpacing: '0.01em', fontFamily: "'JetBrains Mono', 'Menlo', monospace" }}>
              {phase || 'Thinking…'}
              <span style={{ display: 'inline-block', width: 7, height: 13, background: '#C9A84C', marginLeft: 4, verticalAlign: 'middle', animation: 'storvexCaret 1s steps(2) infinite' }} />
            </div>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: 'rgba(228,203,124,0.7)' }}>EINSTEIN ENGAGED</span>
          </div>
        )}
        {error && <div style={{ marginTop: 12, padding: 10, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 11, color: '#FCA5A5' }}>⚠ {error}</div>}
      </div>

      {/* RESULTS */}
      {result && <ResultsView result={result} saveToFirebase={saveToFirebase} fbPush={fbPush} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF Export — institutional-grade printable report with all Quick Lookup
// sections: Best-Fit Buyer, National Percentiles, Operator Stack-Rank,
// 10-yr Pro Forma preview, plus the original demographics / Tapestry /
// ring comparison / competitors.
// ═══════════════════════════════════════════════════════════════════════════
function downloadPDF(result, opts = {}) {
  const { geo, r1, r3, r5, competitors, metrics, generatedAt } = result;
  const fileLabel = `${(geo.city || 'Site').replace(/[^A-Za-z0-9]+/g, '_')}_${geo.state}_StorvexReport_${new Date().toISOString().slice(0, 10)}`;
  const esriViewerUrl = `https://www.arcgis.com/apps/mapviewer/index.html?center=${geo.lng},${geo.lat}&level=13`;
  const googleMapsUrl = `https://www.google.com/maps/@${geo.lat},${geo.lng},15z`;
  const fmt = (n) => n == null ? '—' : Number(n).toLocaleString();
  const pct = (n, d = 1) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(d) + '%';

  // ─── Compute underwriting stack-rank using default assumptions ───
  // (opts overrides let PercentileAndYOCCard pass current calculator state)
  const acres = opts.acres || 4.0;
  const landPerAc = opts.landPerAc || 400000;
  const buildPerSF = opts.buildPerSF || 95;
  const ccPremium = opts.ccPremium ?? 70;
  const liveCC = opts.liveCC || null;
  const liveDU = opts.liveDU || null;
  // Envelope takes precedence if passed by caller (new Buildable Scenario Modeler).
  // Falls back to naive heuristic for back-compat with callers that don't pass envelope.
  const env = opts.envelope || null;
  const buildablePct = env ? env.siteCoveragePct / 100 : (acres >= 3.5 ? 0.35 : 0.45);
  const totalSF = env ? env.grossBuildingSF : acres * 43560 * buildablePct;
  const netRentableSF = env ? env.netRentableSF : totalSF * 0.85;
  const ccSF = netRentableSF * (ccPremium / 100);
  const duSF = netRentableSF * (1 - ccPremium / 100);
  const landCost = acres * landPerAc;
  const buildCost = totalSF * buildPerSF;
  const totalCost = landCost + buildCost;
  const benchCC = OPERATOR_ECONOMICS['STORVEX BENCHMARK'].ccRent;
  const benchDU = OPERATOR_ECONOMICS['STORVEX BENCHMARK'].duRent;
  const mktCC = liveCC || benchCC;
  const mktDU = liveDU || benchDU;

  const stackRows = Object.entries(OPERATOR_ECONOMICS).map(([name, e]) => {
    const ccR = mktCC * (e.ccRent / benchCC);
    const duR = mktDU * (e.duRent / benchDU);
    const gross = ((ccSF * ccR) + (duSF * duR)) * 12;
    const rev = gross * (e.stabOcc / 100);
    const noi = rev * (1 - e.expRatio / 100);
    const yoc = totalCost > 0 ? (noi / totalCost) * 100 : 0;
    const stabValue = noi / e.cap;
    const valueCreation = stabValue - totalCost;
    const fit = yoc >= e.hurdle + 1 ? 'HOME RUN' : yoc >= e.hurdle ? 'STRIKE' : yoc >= e.hurdle - 1 ? 'MARGINAL' : 'BELOW';
    return { name, economics: e, ccRent: ccR, duRent: duR, noi, yoc, stabValue, valueCreation, fit };
  }).sort((a, b) => b.yoc - a.yoc);
  const topFit = stackRows[0];
  const topFitContact = resolveContact(topFit.name, geo?.state);
  const fitColor = (fit) => fit === 'HOME RUN' ? '#10B981' : fit === 'STRIKE' ? '#22C55E' : fit === 'MARGINAL' ? '#F59E0B' : '#EF4444';

  // ─── National percentile ranks ───
  const popP = computePercentile(r3?.TOTPOP_CY, NATIONAL_BENCHMARKS_3MI.population);
  const hhiP = computePercentile(r3?.MEDHINC_CY, NATIONAL_BENCHMARKS_3MI.medianHHI);
  const homeValP = computePercentile(r3?.MEDVAL_CY, NATIONAL_BENCHMARKS_3MI.medianHomeValue);
  const growthP = computePercentile(metrics?.popGrowth, NATIONAL_BENCHMARKS_3MI.popGrowthCAGR);
  const hh75P = computePercentile(metrics?.hhOver75Pct, NATIONAL_BENCHMARKS_3MI.householdsOver75K);
  const percentileRows = [
    { label: 'Population (3-mi)', value: fmt(r3?.TOTPOP_CY), pct: popP },
    { label: 'Median HHI', value: '$' + fmt(r3?.MEDHINC_CY), pct: hhiP },
    { label: 'Median Home Value', value: '$' + fmt(r3?.MEDVAL_CY), pct: homeValP },
    { label: '5-yr Pop Growth CAGR', value: pct(metrics?.popGrowth, 2), pct: growthP },
    { label: 'HH $75K+ Share', value: metrics?.hhOver75Pct != null ? metrics.hhOver75Pct.toFixed(1) + '%' : '—', pct: hh75P },
  ];
  const tierForP = (p) => p == null ? { label: 'N/A', color: '#64748B' } : p >= 85 ? { label: 'ELITE', color: '#10B981' } : p >= 70 ? { label: 'STRONG', color: '#22C55E' } : p >= 50 ? { label: 'ABOVE AVG', color: '#3B82F6' } : p >= 30 ? { label: 'MODERATE', color: '#F59E0B' } : p >= 15 ? { label: 'BELOW AVG', color: '#F97316' } : { label: 'WEAK', color: '#EF4444' };
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${fileLabel}</title>
<style>
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 30px; color: #1E2761; background: #fff; }
.hero { background: linear-gradient(135deg, #0F1538 0%, #1E2761 55%, #0A1127 100%); color: #fff; padding: 30px; border-radius: 12px; margin-bottom: 20px; position: relative; overflow: hidden; }
.hero h1 { margin: 0; font-size: 28px; font-weight: 900; letter-spacing: -0.02em; }
.hero h1 .gold { background: linear-gradient(90deg,#C9A84C,#E4CB7C,#C9A84C); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.hero .sub { font-size: 12px; color: rgba(255,255,255,0.65); margin-top: 8px; }
.section { background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 20px; margin-bottom: 16px; }
.label { font-size: 9px; font-weight: 800; letter-spacing: 0.14em; color: #C9A84C; margin-bottom: 8px; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.stat { padding: 14px; background: #F8FAFC; border-radius: 8px; border-left: 3px solid #C9A84C; }
.stat .big { font-size: 22px; font-weight: 900; font-family: 'Courier New', monospace; color: #1E2761; }
.stat .sub { font-size: 10px; color: #64748B; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
thead tr { background: #1E2761; color: #fff; }
th { text-align: left; padding: 10px 8px; font-size: 10px; letter-spacing: 0.06em; }
td { padding: 8px; border-bottom: 1px solid #F1F5F9; }
tr:nth-child(even) td { background: #FAFBFC; }
a { color: #C9A84C; text-decoration: none; font-size: 9px; }
.tapestry { background: linear-gradient(135deg, #C9A84C, #E4CB7C); color: #1E2761; padding: 10px 16px; border-radius: 8px; font-size: 16px; font-weight: 900; display: inline-block; }
.footer { padding: 16px; background: #F8FAFC; border-radius: 10px; font-size: 10px; color: #64748B; line-height: 1.7; }
.footer a { color: #1E2761; text-decoration: underline; }
@media print {
  *,*::before,*::after { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  *{ transition: none !important; animation: none !important; }
  body { padding: 0; margin: 0; }
  .section, .stat, .grid4 > div, .grid3 > div { break-inside: avoid !important; page-break-inside: avoid !important; }
  table { break-inside: auto !important; }
  thead { display: table-header-group; }
  tr, td, th { break-inside: avoid !important; page-break-inside: avoid !important; }
  h1, h2, h3, .label { break-after: avoid-page !important; page-break-after: avoid !important; }
  /* Force major sections to start on fresh pages */
  .pdf-section-buyer, .pdf-section-stackrank, .pdf-section-demos, .pdf-section-comp { break-before: page !important; page-break-before: always !important; }
  /* Print-only cover memo — hidden on screen */
  .pdf-cover { display: block !important; break-after: page !important; page-break-after: always !important; padding: 48px 56px; height: 9.4in; position: relative; background: #fff; color: #1E293B; }
  .pdf-cover .cm-mark { display: flex; align-items: center; justify-content: space-between; padding-bottom: 18px; border-bottom: 3px solid #1E2761; }
  .pdf-cover .cm-rec-badge { width: 44px; height: 44px; border-radius: 10px; background: linear-gradient(135deg,#C9A84C,#E87A2E); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 900; font-size: 13px; font-family: 'Courier New', monospace; }
  .pdf-cover .cm-rec-text { font-size: 11px; letter-spacing: 0.16em; color: #1E2761; font-weight: 800; }
  .pdf-cover .cm-id { font-size: 9px; letter-spacing: 0.14em; color: #94A3B8; font-weight: 700; font-family: 'Courier New', monospace; }
  .pdf-cover h1 { font-size: 32px; font-weight: 900; color: #0A0A0C; letter-spacing: -0.02em; margin: 30px 0 6px; line-height: 1.1; }
  .pdf-cover .cm-sub { font-size: 14px; color: #475569; margin-bottom: 28px; }
  .pdf-cover .cm-meta { display: grid; grid-template-columns: 90px 1fr; row-gap: 6px; column-gap: 14px; font-size: 11px; margin-bottom: 24px; padding-bottom: 18px; border-bottom: 1px solid #E2E8F0; }
  .pdf-cover .cm-meta dt { color: #94A3B8; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 9px; padding-top: 2px; }
  .pdf-cover .cm-meta dd { color: #1E293B; font-weight: 600; margin: 0; }
  .pdf-cover .cm-verdict { display: flex; align-items: center; gap: 16px; padding: 18px 22px; border-radius: 12px; border: 2px solid; margin-bottom: 22px; }
  .pdf-cover .cm-score { font-size: 48px; font-weight: 900; font-family: 'Courier New', monospace; line-height: 1; }
  .pdf-cover .cm-vlabel { font-size: 18px; font-weight: 900; letter-spacing: 0.04em; }
  .pdf-cover .cm-vsub { font-size: 11px; color: #64748B; margin-top: 3px; }
  .pdf-cover h3 { font-size: 11px; letter-spacing: 0.14em; color: #1E2761; font-weight: 800; text-transform: uppercase; margin: 0 0 10px; }
  .pdf-cover .cm-bullets { list-style: none; padding: 0; margin: 0 0 20px; }
  .pdf-cover .cm-bullets li { display: grid; grid-template-columns: 22px 1fr; gap: 10px; padding: 8px 0; border-bottom: 1px solid #F1F5F9; font-size: 11.5px; color: #1E293B; line-height: 1.55; }
  .pdf-cover .cm-bullets li:last-child { border-bottom: none; }
  .pdf-cover .cm-bnum { color: #C9A84C; font-weight: 900; font-family: 'Courier New', monospace; font-size: 11px; }
  .pdf-cover .cm-attest { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 22px; }
  .pdf-cover .cm-pill { padding: 8px 6px; border-radius: 8px; background: #F8FAFC; border: 1px solid #E2E8F0; font-size: 9px; text-align: center; line-height: 1.35; }
  .pdf-cover .cm-pill-label { font-weight: 800; color: #1E2761; letter-spacing: 0.06em; }
  .pdf-cover .cm-pill-val { color: #16A34A; font-weight: 700; margin-top: 2px; font-size: 8px; }
  .pdf-cover .cm-sig { position: absolute; bottom: 48px; left: 56px; right: 56px; padding-top: 16px; border-top: 2px solid #1E2761; display: flex; justify-content: space-between; align-items: flex-end; font-size: 10px; color: #64748B; }
  .pdf-cover .cm-sig-line { font-style: italic; color: #1E2761; font-weight: 700; font-size: 13px; margin-bottom: 2px; }
  /* Page setup with running audit footer */
  @page {
    size: letter;
    margin: 0.65in 0.5in;
    @bottom-left { content: "Storvex Acquisition Engine v4.0 · CONFIDENTIAL"; font-family: 'Inter', sans-serif; font-size: 8px; color: #94A3B8; letter-spacing: 0.08em; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font-family: 'Courier New', monospace; font-size: 8px; color: #1E2761; font-weight: 700; }
  }
  @page :first { margin-top: 0.4in; @top-left { content: ""; } @top-right { content: ""; } }
}
@media screen { .pdf-cover { display: none !important; } }
@page { size: letter; margin: 0.4in; }
</style></head><body>

<!-- ═══════════════════════════════════════════════════════════════════
     PRINT-ONLY COVER MEMO — McKinsey-style executive summary
     Hidden on screen, lands as page 1 in PDF export
     ═══════════════════════════════════════════════════════════════════ -->
${(() => {
  const today = new Date();
  const dateLong = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '');
  const slug = `${(geo.city || 'SITE').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6)}${(geo.state || 'XX').toUpperCase()}`;
  const reportId = `STORVEX-${yyyymmdd}-${slug}`;
  // Recompute verdict for cover (mirrors StorvexVerdictHero math)
  const pop = r3?.TOTPOP_CY || 0;
  const hhi = r3?.MEDHINC_CY || 0;
  const growth = metrics?.popGrowth ?? 0;
  const peakPct = metrics?.peakPct ?? 0;
  const compCount = (competitors || []).length;
  const popScore = pop >= 40000 ? 10 : pop >= 25000 ? 8 : pop >= 15000 ? 6 : pop >= 10000 ? 5 : pop >= 5000 ? 3 : 0;
  const incScore = hhi >= 90000 ? 10 : hhi >= 75000 ? 8 : hhi >= 65000 ? 6 : hhi >= 55000 ? 4 : 0;
  const growthScore = growth >= 2 ? 10 : growth >= 1.5 ? 9 : growth >= 1 ? 8 : growth >= 0.5 ? 6 : growth >= 0 ? 4 : 0;
  const compScore = compCount <= 2 ? 10 : compCount <= 4 ? 7 : compCount <= 7 ? 5 : 3;
  const peakScore = peakPct >= 50 ? 10 : peakPct >= 45 ? 8 : peakPct >= 40 ? 6 : 4;
  const composite = popScore * 0.22 + incScore * 0.18 + growthScore * 0.25 + compScore * 0.20 + peakScore * 0.15;
  const v = composite >= 8 ? { label: 'PRIME', color: '#16A34A', action: 'ACQUIRE' }
          : composite >= 6.5 ? { label: 'STRONG', color: '#3B82F6', action: 'ADVANCE WITH CONDITIONS' }
          : composite >= 5 ? { label: 'MODERATE', color: '#F59E0B', action: 'HOLD — DILIGENCE REQUIRED' }
          : { label: 'WEAK', color: '#EF4444', action: 'PASS' };
  const ccFacEst = compCount * 0.4;
  const estCCSF = ccFacEst * 35000;
  const ccSPCEst = pop > 0 ? estCCSF / pop : null;
  const ccTone = ccSPCEst == null ? 'awaiting verification' : ccSPCEst < 1.5 ? 'severely underserved' : ccSPCEst < 3 ? 'underserved' : ccSPCEst < 5 ? 'moderate' : 'well-supplied';
  const reit5 = result.reit5mi || [];
  const psFamily = reit5.find(loc => /(public storage|^ps$|istorage|national storage|nsa)/i.test(loc.brand || ''));
  const nearestPS = psFamily ? psFamily.distanceMi : null;
  const cityState = `${geo.city || ''}${geo.state ? ', ' + geo.state : ''}`.replace(/^, /, '');
  return `<div class="pdf-cover">
    <div class="cm-mark">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="cm-rec-badge">SVX</div>
        <div>
          <div class="cm-rec-text">STORVEX MARKET INTELLIGENCE MEMORANDUM</div>
          <div style="font-size:9px;color:#94A3B8;letter-spacing:0.1em;margin-top:2px">PRE-AUDIT SITE OPINION · QUICK LOOKUP</div>
        </div>
      </div>
      <div style="text-align:right">
        <div class="cm-id">${reportId}</div>
        <div style="font-size:9px;color:#64748B;margin-top:3px">${dateLong}</div>
      </div>
    </div>
    <h1>${geo.city || 'Subject Site'}, ${geo.state || ''}</h1>
    <div class="cm-sub">${geo.formatted}</div>
    <dl class="cm-meta">
      <dt>To</dt><dd>Acquisition Decision Owner</dd>
      <dt>From</dt><dd>Storvex Acquisition Engine v4.0 — DJR Real Estate LLC</dd>
      <dt>Re</dt><dd>${v.action} — ${cityState}</dd>
      <dt>Method</dt><dd>ESRI 2025–2030 demographics · Tapestry segmentation · Google Places competitor sweep · 4,238-pin REIT facility registry · 15-operator 10-K-calibrated underwriting · Storvex SiteScore™ composite</dd>
      <dt>Runtime</dt><dd>${result.elapsed || '—'}s end-to-end · API-parallel · zero analyst time</dd>
    </dl>
    <div class="cm-verdict" style="border-color:${v.color};background:${v.color}0D">
      <div class="cm-score" style="color:${v.color}">${composite.toFixed(1)}</div>
      <div style="flex:1">
        <div class="cm-vlabel" style="color:${v.color}">${v.action}</div>
        <div class="cm-vsub">SiteScore™ ${composite.toFixed(2)}/10 · ${v.label} · 5-dimension composite from live data</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:9px;color:#94A3B8;letter-spacing:0.1em;font-weight:800">EST. CC SPC · 3-MI</div>
        <div style="font-size:18px;font-weight:900;color:#1E293B;font-family:'Courier New',monospace;margin-top:2px">${ccSPCEst != null ? ccSPCEst.toFixed(1) : '—'} <span style="font-size:10px;font-weight:600;color:#64748B">${ccTone}</span></div>
      </div>
    </div>
    <h3>The Story</h3>
    <ol class="cm-bullets">
      <li><span class="cm-bnum">01</span><span><strong>The Subject.</strong> Located in ${cityState || 'the submarket'}, with a 3-mile trade area of ${pop.toLocaleString()} residents and ${(r3?.TOTHH_CY || 0).toLocaleString()} households.</span></li>
      <li><span class="cm-bnum">02</span><span><strong>The Market.</strong> ${growth >= 1 ? 'Growth corridor' : growth >= 0 ? 'Stable demographics' : 'Declining trade area'} at ${(growth >= 0 ? '+' : '') + growth.toFixed(2)}% 5-yr CAGR. Median HHI $${hhi.toLocaleString()}${r3?.MEDVAL_CY ? `, median home $${Math.round(r3.MEDVAL_CY/1000)}K` : ''}. Peak-storage-age cohort ${peakPct.toFixed(1)}%.</span></li>
      <li><span class="cm-bnum">03</span><span><strong>The Competition.</strong> ${compCount} self-storage ${compCount === 1 ? 'facility' : 'facilities'} within 3 mi (Places API pre-audit). Estimated CC SPC ~${ccSPCEst != null ? ccSPCEst.toFixed(1) : '—'} SF/capita — ${ccTone}.${nearestPS != null ? ` Nearest PS family: ${nearestPS.toFixed(1)} mi.` : ' No PS family within 5 mi.'}</span></li>
      <li><span class="cm-bnum">04</span><span><strong>The Verdict.</strong> Storvex composite ${composite.toFixed(2)}/10 — <strong style="color:${v.color}">${v.label}</strong>. Best-fit buyer match and stack-ranked operator economics in §1.</span></li>
      <li><span class="cm-bnum">05</span><span><strong>The Recommendation.</strong> ${composite >= 7 ? 'Submit Save + Full Audit to populate verified SpareFoot rents, CC SPC, REC Package, and pricing model.' : composite >= 5 ? 'Verify zoning + utilities and re-run with annotated assumptions before advancing.' : 'Pass on storage thesis. Consider alternate buyer pool or non-storage use.'}</span></li>
    </ol>
    <h3>How We Know — Engine Receipts</h3>
    <div class="cm-attest">
      <div class="cm-pill"><div class="cm-pill-label">DEMOGRAPHICS</div><div class="cm-pill-val">ESRI 2025 ✓</div></div>
      <div class="cm-pill"><div class="cm-pill-label">SEGMENTATION</div><div class="cm-pill-val">${r3?.TSEGNAME ? 'Tapestry ✓' : 'Pending'}</div></div>
      <div class="cm-pill"><div class="cm-pill-label">COMPETITORS</div><div class="cm-pill-val">Places · ${compCount} ✓</div></div>
      <div class="cm-pill"><div class="cm-pill-label">UNDERWRITING</div><div class="cm-pill-val">PSA·EXR·CUBE 10-K ✓</div></div>
      <div class="cm-pill"><div class="cm-pill-label">PROXIMITY</div><div class="cm-pill-val">PS Family · 4,238 ✓</div></div>
    </div>
    <div class="cm-sig">
      <div>
        <div class="cm-sig-line">/s/ Storvex Acquisition Engine v4.0</div>
        <div>Issued ${dateLong} · Continuous ESRI/Places revalidation · ${result.elapsed || '—'}s runtime</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:800;color:#1E2761">${reportId}</div>
        <div style="margin-top:2px">CONFIDENTIAL — INTERNAL USE ONLY</div>
      </div>
    </div>
  </div>`;
})()}

<div class="hero">
  <div style="font-size:9px;font-weight:800;letter-spacing:0.14em;color:#4CC982;margin-bottom:10px">⚡ STORVEX INSTITUTIONAL REPORT · OPERATOR-CALIBRATED UNDERWRITING</div>
  <h1><span class="gold">Storvex</span> Report — ${geo.city || 'Subject'}, ${geo.state || ''}</h1>
  <div class="sub">${geo.formatted}</div>
  <div class="sub">Generated ${new Date(generatedAt).toLocaleString()} · Report runtime ${result.elapsed}s · Underwritten @ ${acres}ac · $${(landPerAc/1000).toFixed(0)}K/ac land · $${buildPerSF}/SF build</div>
</div>

<div class="section pdf-section-buyer" style="background:linear-gradient(135deg,rgba(16,185,129,0.08),#F8FAFC);border:2px solid #10B981">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
    <span style="background:#10B981;color:#fff;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:900;letter-spacing:0.1em">🏆 BEST-FIT BUYER</span>
    <span style="font-size:22px;font-weight:900;color:${topFit.economics.color}">${topFit.name}</span>
    <span style="font-size:18px;font-weight:800;color:#10B981;font-family:'Courier New',monospace">${topFit.yoc.toFixed(2)}% YOC</span>
    <span style="background:${fitColor(topFit.fit)};color:#fff;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:900">${topFit.fit}</span>
  </div>
  <div class="grid4" style="margin-top:10px">
    <div class="stat"><div class="big">$${(topFit.stabValue/1e6).toFixed(2)}M</div><div class="sub">Stabilized Value @ ${(topFit.economics.cap*100).toFixed(1)}% cap</div></div>
    <div class="stat"><div class="big">$${(topFit.noi/1e3).toFixed(0)}K</div><div class="sub">Stabilized NOI · ${topFit.economics.stabOcc}% occ</div></div>
    <div class="stat"><div class="big" style="color:${topFit.valueCreation>0?'#10B981':'#EF4444'}">${topFit.valueCreation>=0?'+':'-'}$${Math.abs(topFit.valueCreation/1e6).toFixed(2)}M</div><div class="sub">Value Creation (Stab Value − Cost)</div></div>
    <div class="stat"><div class="big">$${(totalCost/1e6).toFixed(2)}M</div><div class="sub">Total Cost · Land $${(landCost/1e6).toFixed(2)}M + Build $${(buildCost/1e6).toFixed(2)}M</div></div>
  </div>
  ${topFitContact ? `<div style="margin-top:14px;padding:12px;background:#fff;border-radius:8px;border-left:4px solid ${topFitContact.isPSFamily?'#0052A3':topFit.economics.color}">
    <div class="label">SEND THIS SITE TO</div>
    <div style="font-size:14px;font-weight:800;color:#1E2761">${topFitContact.name}</div>
    <div style="font-size:11px;color:#64748B">${topFitContact.title}</div>
    <div style="font-size:11px;color:#1E2761;margin-top:4px">📧 <a href="mailto:${topFitContact.email}" style="color:#1E2761;text-decoration:underline">${topFitContact.email}</a></div>
    ${Array.isArray(topFitContact.cc) && topFitContact.cc.length ? `<div style="font-size:10px;color:#64748B;margin-top:2px">CC: ${topFitContact.cc.join(', ')}</div>` : ''}
    ${topFitContact.warning ? `<div style="margin-top:6px;padding:6px;background:#FEF3C7;border-radius:4px;font-size:10px;color:#92400E">⚠ ${topFitContact.warning}</div>` : ''}
    ${topFitContact.note && !topFitContact.warning ? `<div style="font-size:10px;color:#64748B;margin-top:2px;font-style:italic">${topFitContact.note}</div>` : ''}
  </div>` : ''}
</div>

<div class="section">
  <div class="label">NATIONAL PERCENTILE BENCHMARK · VS US STORAGE-ELIGIBLE 3-MI MEDIAN</div>
  <table>
    <thead><tr><th>Metric</th><th style="text-align:right">Value</th><th style="text-align:center">Percentile</th><th style="text-align:right" colspan="2">Visual · 50th = US median</th></tr></thead>
    <tbody>
      ${percentileRows.map(r => { const t = tierForP(r.pct); return `<tr>
        <td>${r.label}</td>
        <td style="text-align:right;font-family:'Courier New';font-weight:700">${r.value}</td>
        <td style="text-align:center"><span style="background:${t.color};color:#fff;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:900">${t.label}</span> <span style="color:#64748B;font-size:10px">${r.pct != null ? Math.round(r.pct) + 'th' : '—'}</span></td>
        <td colspan="2" style="padding:6px"><div style="height:10px;background:#E2E8F0;border-radius:5px;position:relative;overflow:hidden"><div style="position:absolute;left:0;top:0;height:100%;width:${r.pct||0}%;background:${t.color}"></div><div style="position:absolute;left:50%;top:0;height:100%;width:1px;background:rgba(30,39,97,0.5)"></div></div></td>
      </tr>`; }).join('')}
    </tbody>
  </table>
</div>

<div class="section pdf-section-stackrank">
  <div class="label">OPERATOR STACK-RANK · WHO SHOULD OWN THIS SITE?</div>
  <div style="font-size:10px;color:#64748B;margin-bottom:10px">All 15 operators underwritten on IDENTICAL cost stack (${acres}ac × $${landPerAc.toLocaleString()}/ac + $${buildPerSF}/SF build) and IDENTICAL ${liveCC ? 'LIVE submarket' : 'state market band'} CC base rent. Only operator-specific 10-K economics (rent premium, occ, expense ratio, cap rate, hurdle) vary.</div>
  <table>
    <thead><tr><th>Rank</th><th>Operator</th><th style="text-align:right">CC $/SF</th><th style="text-align:right">Occ</th><th style="text-align:right">Exp</th><th style="text-align:right">Cap</th><th style="text-align:right">NOI</th><th style="text-align:right">YOC</th><th style="text-align:right">Stab Value</th><th style="text-align:center">Fit</th></tr></thead>
    <tbody>
      ${stackRows.map((r, idx) => `<tr>
        <td style="font-weight:900;color:${idx===0?'#10B981':'#64748B'}">#${idx+1}</td>
        <td style="font-weight:700;color:${r.economics.color}">${r.name}</td>
        <td style="text-align:right;font-family:'Courier New'">$${r.ccRent.toFixed(2)}</td>
        <td style="text-align:right;font-family:'Courier New'">${r.economics.stabOcc}%</td>
        <td style="text-align:right;font-family:'Courier New'">${r.economics.expRatio}%</td>
        <td style="text-align:right;font-family:'Courier New'">${(r.economics.cap*100).toFixed(1)}%</td>
        <td style="text-align:right;font-family:'Courier New';color:#059669">$${(r.noi/1e3).toFixed(0)}K</td>
        <td style="text-align:right;font-family:'Courier New';font-weight:900;color:${fitColor(r.fit)}">${r.yoc.toFixed(2)}%</td>
        <td style="text-align:right;font-family:'Courier New';color:${r.economics.color}">$${(r.stabValue/1e6).toFixed(2)}M</td>
        <td style="text-align:center"><span style="background:${fitColor(r.fit)};color:#fff;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:900">${r.fit}</span></td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<!-- ═══════════════════════════════════════════════════════════════════
     5-ORACLE INTEL STACK — CC SPC · BUILDABLE · ZONING · UTILITY · ACCESS
     All five Radius-structural-beat panels inlined into the PDF.
     Each section renders from result.*Intel fields populated live by Oracle
     endpoints. Graceful degradation when a panel has no data.
     ═══════════════════════════════════════════════════════════════════ -->
${(() => {
  // ─── CC SPC (client-side compute, matches CCSPCHeadline component) ───
  const ccSPC = computeCCSPC(competitors, r3?.TOTPOP_CY, r3?.TOTPOP_FY);
  const v = ccSPC?.verdict;
  const pv = ccSPC?.projectedVerdict;
  const ccSPCHtml = ccSPC && (ccSPC.current != null || ccSPC.projected != null) ? `
<div class="section" style="background:linear-gradient(135deg,${v.color}15,#F8FAFC);border:2px solid ${v.color}">
  <div class="label" style="color:${v.color}">CC SPC · CLIMATE-CONTROLLED SF PER CAPITA · THE #1 COMPETITION METRIC</div>
  <div class="grid4">
    <div class="stat" style="border-left:4px solid ${v.color}">
      <div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">CURRENT (2025)</div>
      <div style="font-size:28px;font-weight:900;color:${v.color};font-family:'Courier New',monospace;line-height:1.1">${ccSPC.current != null ? ccSPC.current.toFixed(2) : '—'}</div>
      <div style="font-size:9px;color:#64748B;margin-top:2px">CC SF / capita · 3-mi</div>
      <div style="margin-top:6px;display:inline-block;background:${v.color};color:#fff;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:900">${v.label}</div>
    </div>
    <div class="stat" style="border-left:4px solid ${pv.color}">
      <div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">PROJECTED (2030)</div>
      <div style="font-size:28px;font-weight:900;color:${pv.color};font-family:'Courier New',monospace;line-height:1.1">${ccSPC.projected != null ? ccSPC.projected.toFixed(2) : '—'}</div>
      <div style="font-size:9px;color:#64748B;margin-top:2px">CC SF / capita · 5-yr forward</div>
      <div style="margin-top:6px;display:inline-block;background:${pv.color};color:#fff;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:900">${pv.label}</div>
    </div>
    <div class="stat">
      <div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">3-MI CC SUPPLY</div>
      <div style="font-size:22px;font-weight:900;color:#1E2761;font-family:'Courier New',monospace">~${Math.round(ccSPC.totalCCSF/1000).toLocaleString()}K SF</div>
      <div style="font-size:10px;color:#64748B;margin-top:4px">${ccSPC.competitorCount} facilit${ccSPC.competitorCount === 1 ? 'y' : 'ies'} · ${ccSPC.ccConfidentCount || 0} CC-confident · ${ccSPC.mixedCount || 0} mixed</div>
    </div>
    <div class="stat">
      <div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">TRADE AREA</div>
      <div style="font-size:22px;font-weight:900;color:#1E2761;font-family:'Courier New',monospace">${fmt(r3?.TOTPOP_CY)}</div>
      <div style="font-size:10px;color:#64748B;margin-top:4px">3-mi pop (2025) → ${fmt(r3?.TOTPOP_FY)} by 2030</div>
    </div>
  </div>
  ${ccSPC.pipelineFlood ? `<div style="margin-top:10px;padding:8px 10px;background:#FEE2E2;border-left:3px solid #EF4444;border-radius:4px;font-size:11px;color:#991B1B"><b>⚠ PIPELINE FLOOD RISK:</b> projected CC SPC tier drops materially — new supply outpacing population growth over 5-yr.</div>` : ''}
</div>` : '';

  // ─── BUILDABLE SCENARIO (from opts.envelope) ───
  const envelopeHtml = env ? `
<div class="section" style="background:linear-gradient(135deg,rgba(139,92,246,0.08),#F8FAFC);border:2px solid #8B5CF6">
  <div class="label" style="color:#8B5CF6">🏗 BUILDABLE SCENARIO · SETBACK-AWARE ENVELOPE · PATENT-PENDING</div>
  <div style="font-size:10px;color:#64748B;margin-bottom:10px">Real building envelope after ${env.scenario?.label || 'BASE CASE'} setbacks (${env.scenario?.frontSB || 0}'/${env.scenario?.sideSB || 0}'/${env.scenario?.rearSB || 0}'), ${env.scenario?.wetlandsPct || 0}% wetlands haircut, and ${((env.siteUtilization || 0.55) * 100).toFixed(0)}% site-utilization factor (drive aisles + parking + detention + landscape). Radius doesn't do this.</div>
  <div class="grid4">
    <div class="stat" style="border-left:4px solid #8B5CF6">
      <div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">AUTO-SELECTED PRODUCT</div>
      <div style="font-size:16px;font-weight:900;color:#8B5CF6;margin-top:2px">${env.label}</div>
      <div style="font-size:9px;color:#64748B;margin-top:4px">${env.stories}-story · ${env.ccMixPct}% CC · $${env.buildPerSF}/SF base</div>
    </div>
    <div class="stat">
      <div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">REALISTIC FOOTPRINT</div>
      <div class="big">${Math.round(env.footprint).toLocaleString()} SF</div>
      <div style="font-size:9px;color:#64748B;margin-top:2px">${(env.siteCoveragePct || 0).toFixed(1)}% site coverage</div>
    </div>
    <div class="stat">
      <div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">GROSS BUILDING SF</div>
      <div class="big">${Math.round(env.grossBuildingSF).toLocaleString()} SF</div>
      <div style="font-size:9px;color:#64748B;margin-top:2px">${env.stories}× footprint stacked</div>
    </div>
    <div class="stat">
      <div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">NET RENTABLE SF</div>
      <div class="big" style="color:#10B981">${Math.round(env.netRentableSF).toLocaleString()} SF</div>
      <div style="font-size:9px;color:#64748B;margin-top:2px">${Math.round(env.ccSF).toLocaleString()} CC · ${Math.round(env.duSF).toLocaleString()} DU</div>
    </div>
  </div>
  ${env.stories === 0 ? `<div style="margin-top:10px;padding:8px 10px;background:#FEE2E2;border-left:3px solid #EF4444;border-radius:4px;font-size:11px;color:#991B1B"><b>⚠ UNBUILDABLE:</b> envelope too small after setbacks. Try AGGRESSIVE scenario or reconsider parcel size.</div>` : ''}
</div>` : '';

  // ─── ZONING ORACLE (from result.zoningIntel) ───
  const zi = result.zoningIntel;
  const ziFound = zi && zi.found && zi.ok !== false;
  const zConf = zi?.confidence || 'low';
  const zConfColor = zConf === 'high' ? '#10B981' : zConf === 'medium' ? '#F59E0B' : '#EF4444';
  const zoningHtml = zi ? `
<div class="section" style="background:linear-gradient(135deg,rgba(139,92,246,0.06),#F8FAFC);border:2px solid #8B5CF6">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
    <span style="background:#8B5CF6;color:#fff;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:900;letter-spacing:0.1em">⚖ ZONING ORACLE · PATENT-PENDING</span>
    <span style="font-size:10px;color:#64748B">The #1 deal-killer. Radius doesn't cite the ordinance.</span>
    <span style="margin-left:auto;background:${zConfColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:900">${zConf.toUpperCase()} CONFIDENCE</span>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:10px">
    <div>
      <div class="label" style="color:#64748B">JURISDICTION</div>
      <div style="font-size:14px;font-weight:800;color:#1E2761">${zi.jurisdiction || '—'}</div>
      ${zi.sourceUrl && zi.source !== 'manual-required' ? `<div style="font-size:10px;color:#64748B;margin-top:3px">Source: <a href="${zi.sourceUrl}">${zi.source}</a>${zi.ordinanceSection ? ' · ' + zi.ordinanceSection : ''}</div>` : ''}
    </div>
    ${ziFound && zi.storageTerm ? `<div>
      <div class="label" style="color:#64748B">STORAGE USE CATEGORY</div>
      <div style="font-size:14px;font-weight:800;color:#C9A84C;font-style:italic">"${zi.storageTerm}"</div>
      ${zi.tableName ? `<div style="font-size:10px;color:#64748B;margin-top:3px">Table: ${zi.tableName}</div>` : ''}
    </div>` : ''}
  </div>
  ${ziFound && (Array.isArray(zi.byRightDistricts) && zi.byRightDistricts.length > 0 || Array.isArray(zi.conditionalDistricts) && zi.conditionalDistricts.length > 0 || Array.isArray(zi.rezoneRequired) && zi.rezoneRequired.length > 0) ? `
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">
    ${Array.isArray(zi.byRightDistricts) && zi.byRightDistricts.length > 0 ? `<div style="background:#ECFDF5;padding:8px;border-radius:6px;border-left:3px solid #10B981">
      <div style="font-size:9px;color:#10B981;letter-spacing:0.1em;font-weight:800">BY-RIGHT (PERMITTED)</div>
      <div style="margin-top:6px">${zi.byRightDistricts.map(d => `<span style="background:#10B981;color:#fff;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700;font-family:'Courier New',monospace;margin:2px">${d}</span>`).join('')}</div>
    </div>` : ''}
    ${Array.isArray(zi.conditionalDistricts) && zi.conditionalDistricts.length > 0 ? `<div style="background:#FEF3C7;padding:8px;border-radius:6px;border-left:3px solid #F59E0B">
      <div style="font-size:9px;color:#F59E0B;letter-spacing:0.1em;font-weight:800">CONDITIONAL (SUP/CUP)</div>
      <div style="margin-top:6px">${zi.conditionalDistricts.map(d => `<span style="background:#F59E0B;color:#fff;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700;font-family:'Courier New',monospace;margin:2px">${d}</span>`).join('')}</div>
    </div>` : ''}
    ${Array.isArray(zi.rezoneRequired) && zi.rezoneRequired.length > 0 ? `<div style="background:#FEE2E2;padding:8px;border-radius:6px;border-left:3px solid #EF4444">
      <div style="font-size:9px;color:#EF4444;letter-spacing:0.1em;font-weight:800">REZONE REQUIRED</div>
      <div style="margin-top:6px">${zi.rezoneRequired.map(d => `<span style="background:#EF4444;color:#fff;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700;font-family:'Courier New',monospace;margin:2px">${d}</span>`).join('')}</div>
    </div>` : ''}
  </div>` : ''}
  ${zi.overlayNotes || zi.supStandards ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
    ${zi.overlayNotes ? `<div style="background:#F8FAFC;padding:8px;border-radius:6px"><div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:800">OVERLAY REQUIREMENTS</div><div style="font-size:11px;color:#1E293B;margin-top:4px;line-height:1.5">${zi.overlayNotes}</div></div>` : ''}
    ${zi.supStandards ? `<div style="background:#F8FAFC;padding:8px;border-radius:6px"><div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:800">SUPPLEMENTAL STANDARDS</div><div style="font-size:11px;color:#1E293B;margin-top:4px;line-height:1.5">${zi.supStandards}</div></div>` : ''}
  </div>` : ''}
  ${ziFound && zi.notes ? `<div style="padding:10px;background:#F1F5F9;border-radius:6px;font-size:11px;line-height:1.5;color:#1E293B"><b style="color:#8B5CF6">INTERPRETATION:</b> ${zi.notes}</div>` : ''}
</div>` : '';

  // ─── UTILITY ORACLE (from result.utilityIntel) ───
  const ui = result.utilityIntel;
  const uiFound = ui && ui.found !== false && ui.ok !== false;
  const uConf = ui?.confidence || 'low';
  const uConfColor = uConf === 'high' ? '#10B981' : uConf === 'medium' ? '#F59E0B' : '#EF4444';
  const hookup = ui?.waterHookupStatus || 'unknown';
  const hookupColor = hookup === 'by-right' ? '#10B981' : hookup === 'by-request' ? '#F59E0B' : hookup === 'no-provider' ? '#EF4444' : '#64748B';
  const hookupLabel = hookup === 'by-right' ? 'BY-RIGHT (inside boundary)' : hookup === 'by-request' ? 'BY-REQUEST (extension)' : hookup === 'no-provider' ? 'NO PROVIDER' : 'UNKNOWN';
  const utilityHtml = ui ? `
<div class="section" style="background:linear-gradient(135deg,rgba(14,165,233,0.08),#F8FAFC);border:2px solid #0EA5E9">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
    <span style="background:#0EA5E9;color:#fff;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:900;letter-spacing:0.1em">💧 UTILITY ORACLE · PATENT-PENDING</span>
    <span style="font-size:10px;color:#64748B">The #2 deal-killer. Who do we call for the tap?</span>
    <span style="margin-left:auto;background:${uConfColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:900">${uConf.toUpperCase()} CONFIDENCE</span>
  </div>
  ${uiFound && (ui.waterProvider || hookup !== 'unknown') ? `
  <div style="background:#F0F9FF;padding:12px;border-radius:8px;margin-bottom:10px;border-left:4px solid ${hookupColor}">
    <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px">
      <div>
        <div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">WATER PROVIDER</div>
        <div style="font-size:16px;font-weight:800;color:#1E2761">${ui.waterProvider || '—'}</div>
      </div>
      <span style="margin-left:auto;background:${hookupColor};color:#fff;padding:4px 10px;border-radius:4px;font-size:10px;font-weight:900;font-family:'Courier New',monospace">${hookupLabel}</span>
    </div>
    ${ui.waterContact && (ui.waterContact.phone || ui.waterContact.email || ui.waterContact.name) ? `<div style="font-size:11px;line-height:1.6;padding:8px;background:#E0F2FE;border-radius:6px;color:#0C4A6E">
      <b style="color:#0EA5E9">⚡ WHO TO CALL FOR HOOKUP:</b>
      ${ui.waterContact.name ? `<b>${ui.waterContact.name}</b> · ` : ''}
      ${ui.waterContact.dept ? ui.waterContact.dept + ' · ' : ''}
      ${ui.waterContact.phone ? `<span style="font-family:'Courier New',monospace;color:#059669">${ui.waterContact.phone}</span> · ` : ''}
      ${ui.waterContact.email ? `<a href="mailto:${ui.waterContact.email}" style="color:#059669">${ui.waterContact.email}</a>` : ''}
      ${ui.waterContact.website ? ` · <a href="${ui.waterContact.website}" style="color:#059669">↗ website</a>` : ''}
    </div>` : ''}
    ${ui.fireFlowNotes ? `<div style="margin-top:8px;font-size:11px;color:#475569"><b style="color:#F97316">🔥 FIRE FLOW:</b> ${ui.fireFlowNotes}</div>` : ''}
  </div>` : ''}
  ${uiFound ? `<div class="grid4">
    ${ui.sewerProvider ? `<div class="stat"><div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">SEWER</div><div style="font-size:13px;font-weight:700;color:#1E2761;margin-top:4px">${ui.sewerProvider}</div><div style="font-size:9px;color:${ui.sewerAvailable ? '#10B981' : '#64748B'};margin-top:4px">${ui.sewerAvailable ? '✓ municipal available' : 'septic viable for storage'}</div></div>` : ''}
    ${ui.electricProvider ? `<div class="stat"><div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">ELECTRIC</div><div style="font-size:13px;font-weight:700;color:#1E2761;margin-top:4px">${ui.electricProvider}</div><div style="font-size:9px;margin-top:4px;color:${ui.threePhase === true ? '#10B981' : ui.threePhase === false ? '#EF4444' : '#F59E0B'}">3-phase: ${ui.threePhase === true ? '✓ confirmed' : ui.threePhase === false ? '✗ not available' : (ui.threePhase || 'verify').toString().replace('-', ' ')}</div></div>` : ''}
    ${ui.gasProvider && ui.gasProvider !== 'N/A' ? `<div class="stat"><div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">NATURAL GAS</div><div style="font-size:13px;font-weight:700;color:#1E2761;margin-top:4px">${ui.gasProvider}</div></div>` : ''}
    ${ui.tapFees ? `<div class="stat" style="border-left:3px solid #C9A84C"><div style="font-size:9px;color:#C9A84C;letter-spacing:0.1em;font-weight:700">TAP / IMPACT FEES</div><div style="font-size:11px;font-weight:700;color:#1E2761;margin-top:4px;line-height:1.5">${ui.tapFees}</div></div>` : ''}
  </div>` : ''}
  ${uiFound && ui.notes ? `<div style="margin-top:10px;padding:10px;background:#F1F5F9;border-radius:6px;font-size:11px;line-height:1.5;color:#1E293B"><b style="color:#0EA5E9">INTERPRETATION:</b> ${ui.notes}</div>` : ''}
</div>` : '';

  // ─── ACCESS ORACLE (from result.accessIntel) ───
  const ai = result.accessIntel;
  const aiFound = ai && ai.found !== false && ai.ok !== false;
  const aConf = ai?.confidence || 'low';
  const aConfColor = aConf === 'high' ? '#10B981' : aConf === 'medium' ? '#F59E0B' : '#EF4444';
  const vpd = ai?.vpd;
  const vpdTier = vpd == null ? null
    : vpd >= 30000 ? { label: 'ELITE', color: '#10B981' }
    : vpd >= 20000 ? { label: 'STRONG', color: '#22C55E' }
    : vpd >= 12000 ? { label: 'GOOD', color: '#3B82F6' }
    : vpd >= 6000  ? { label: 'VIABLE', color: '#F59E0B' }
    : vpd >= 3000  ? { label: 'WEAK', color: '#F97316' }
    : { label: 'LOW', color: '#EF4444' };
  const decelRisk = ai?.decelLaneRisk;
  const decelColor = decelRisk === 'low' ? '#10B981' : decelRisk === 'medium' ? '#F59E0B' : decelRisk === 'high' ? '#EF4444' : '#64748B';
  const accessHtml = ai ? `
<div class="section" style="background:linear-gradient(135deg,rgba(245,158,11,0.08),#F8FAFC);border:2px solid #F59E0B">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
    <span style="background:#F59E0B;color:#fff;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:900;letter-spacing:0.1em">🚧 ACCESS ORACLE · PATENT-PENDING</span>
    <span style="font-size:10px;color:#64748B">VPD from state DOT · Radius shows the road, we underwrite the turn</span>
    <span style="margin-left:auto;background:${aConfColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:900">${aConf.toUpperCase()} CONFIDENCE</span>
  </div>
  ${aiFound ? `<div style="background:#FFFBEB;padding:12px;border-radius:8px;margin-bottom:10px;border-left:4px solid ${vpdTier?.color || '#64748B'}">
    <div style="display:flex;align-items:baseline;gap:16px;flex-wrap:wrap">
      <div>
        <div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">VPD · ${ai.vpdYear || ''}</div>
        <div style="font-size:32px;font-weight:900;color:${vpdTier?.color || '#1E2761'};font-family:'Courier New',monospace;line-height:1">${vpd != null ? vpd.toLocaleString() : '—'}</div>
        <div style="font-size:10px;color:#64748B;margin-top:4px">vehicles/day${ai.vpdSource ? ` · <a href="${ai.vpdSourceUrl || '#'}">↗ ${ai.vpdSource}</a>` : ''}</div>
      </div>
      ${vpdTier ? `<span style="background:${vpdTier.color};color:#fff;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:900;letter-spacing:0.1em">${vpdTier.label} VISIBILITY</span>` : ''}
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">FRONTAGE ROAD</div>
        <div style="font-size:16px;font-weight:800;color:#C9A84C;font-family:'Courier New',monospace">${ai.frontageRoad || '—'}</div>
        <div style="font-size:10px;color:#64748B">${(ai.frontageRoadType || 'unknown').replace(/-/g, ' ')}</div>
      </div>
    </div>
  </div>` : ''}
  ${aiFound ? `<div class="grid4">
    <div class="stat"><div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">MEDIAN</div><div style="font-size:12px;font-weight:700;color:#1E2761;margin-top:4px;text-transform:capitalize">${(ai.medianType || 'unknown').replace(/_/g, ' ')}</div></div>
    <div class="stat"><div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">NEAREST SIGNAL</div><div style="font-size:11px;font-weight:700;color:#1E2761;margin-top:4px;line-height:1.4">${ai.nearestSignal || '—'}</div></div>
    <div class="stat" style="border-left:3px solid ${decelColor}"><div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">DECEL LANE RISK</div><div style="font-size:12px;font-weight:700;color:${decelColor};margin-top:4px;text-transform:uppercase">${decelRisk || 'unknown'}</div><div style="font-size:9px;color:#64748B;margin-top:2px">${decelRisk === 'high' ? '$50K-$150K' : decelRisk === 'medium' ? 'possible ask' : decelRisk === 'low' ? '✓ unlikely' : ''}</div></div>
    <div class="stat"><div style="font-size:9px;color:#64748B;letter-spacing:0.1em;font-weight:700">VISIBILITY · DRIVEWAY GRADE</div><div style="font-size:12px;font-weight:700;color:#1E2761;margin-top:4px;text-transform:capitalize">${ai.visibility || 'unknown'} · ${ai.drivewayGrade || 'unknown'}</div></div>
  </div>` : ''}
  ${ai.landlockedRisk ? `<div style="margin-top:10px;padding:10px;background:#FEE2E2;border-left:3px solid #EF4444;border-radius:4px;font-size:11px;color:#991B1B"><b>🚨 LANDLOCKED RISK:</b> Interior parcel or easement-only access — major deal flag. Verify platted frontage before advancing.</div>` : ''}
  ${aiFound && ai.notes ? `<div style="margin-top:10px;padding:10px;background:#F1F5F9;border-radius:6px;font-size:11px;line-height:1.5;color:#1E293B"><b style="color:#F59E0B">INTERPRETATION:</b> ${ai.notes}</div>` : ''}
</div>` : '';

  return ccSPCHtml + envelopeHtml + zoningHtml + utilityHtml + accessHtml;
})()}

<div class="section pdf-section-demos">
  <div class="label">DEMOGRAPHICS · ESRI 2025–2030 · 3-MI RADIAL RING</div>
  <div class="grid4">
    <div class="stat"><div class="big">${fmt(r3?.TOTPOP_CY)}</div><div class="sub">Population · ${pct(metrics.popGrowth, 2)} 5-yr CAGR</div></div>
    <div class="stat"><div class="big">$${fmt(r3?.MEDHINC_CY)}</div><div class="sub">Median HHI · ${pct(metrics.hhiGrowth, 2)} CAGR</div></div>
    <div class="stat"><div class="big">${fmt(r3?.TOTHH_CY)}</div><div class="sub">Households · ${metrics.renterPct?.toFixed(0) || '—'}% renter</div></div>
    <div class="stat"><div class="big">$${fmt(r3?.MEDVAL_CY)}</div><div class="sub">Median Home Value · Avg $${fmt(r3?.AVGVAL_CY)}</div></div>
  </div>
  <div class="grid3" style="margin-top:14px">
    <div class="stat"><div class="big" style="font-size:18px">${metrics.peakPct?.toFixed(1) || '—'}%</div><div class="sub">Peak Storage Age (25-44 + 55-74)</div></div>
    <div class="stat"><div class="big" style="font-size:18px">${metrics.hhOver75Pct?.toFixed(1) || '—'}%</div><div class="sub">HH $75K+ (CC affordability)</div></div>
    <div class="stat"><div class="big" style="font-size:18px">${metrics.collegePct?.toFixed(1) || '—'}%</div><div class="sub">College Educated</div></div>
  </div>
</div>

${r3?.TSEGNAME ? `<div class="section">
  <div class="label">TAPESTRY SEGMENTATION · BEHAVIORAL CLUSTER</div>
  <div class="tapestry">${r3.TSEGNAME}</div>
  <div style="font-size:11px;color:#64748B;margin-top:10px;line-height:1.5">Dominant psychographic cluster in this submarket. Drives storage demand profile — family-formation cohorts lean drive-up, empty-nester/downsizer cohorts lean CC, professional cohorts lean premium CC.</div>
</div>` : ''}

<div class="section">
  <div class="label">1-MI · 3-MI · 5-MI RING COMPARISON</div>
  <table>
    <thead><tr><th>Metric</th><th style="text-align:right">1-Mile</th><th style="text-align:right">3-Mile</th><th style="text-align:right">5-Mile</th></tr></thead>
    <tbody>
      <tr><td>Population</td><td style="text-align:right">${fmt(r1?.TOTPOP_CY)}</td><td style="text-align:right"><b>${fmt(r3?.TOTPOP_CY)}</b></td><td style="text-align:right">${fmt(r5?.TOTPOP_CY)}</td></tr>
      <tr><td>Households</td><td style="text-align:right">${fmt(r1?.TOTHH_CY)}</td><td style="text-align:right"><b>${fmt(r3?.TOTHH_CY)}</b></td><td style="text-align:right">${fmt(r5?.TOTHH_CY)}</td></tr>
      <tr><td>Median HHI</td><td style="text-align:right">$${fmt(r1?.MEDHINC_CY)}</td><td style="text-align:right"><b>$${fmt(r3?.MEDHINC_CY)}</b></td><td style="text-align:right">$${fmt(r5?.MEDHINC_CY)}</td></tr>
      <tr><td>Median Home Value</td><td style="text-align:right">$${fmt(r1?.MEDVAL_CY)}</td><td style="text-align:right"><b>$${fmt(r3?.MEDVAL_CY)}</b></td><td style="text-align:right">$${fmt(r5?.MEDVAL_CY)}</td></tr>
    </tbody>
  </table>
</div>

<div class="section pdf-section-comp">
  <div class="label">COMPETITORS WITHIN 3 MI · ${competitors.length} FACILITIES</div>
  <table>
    <thead><tr><th>Facility</th><th style="text-align:right">Distance</th><th>Address</th></tr></thead>
    <tbody>
      ${competitors.map(c => `<tr><td style="font-weight:700">${c.name}</td><td style="text-align:right">${c.distanceMi} mi</td><td style="font-size:10px;color:#64748B">${c.address || '—'}</td></tr>`).join('')}
    </tbody>
  </table>
</div>

<div class="footer">
  <b>Data Sources — Click to Verify:</b><br>
  • Demographics: <a href="${esriViewerUrl}">ESRI ArcGIS GeoEnrichment 2025</a> (30+ variables, 1/3/5-mi rings, 2025 + 2030 projections)<br>
  • Behavioral segmentation: <a href="https://www.esri.com/en-us/arcgis/products/data/data-portfolio/tapestry-segmentation">ESRI Tapestry Segmentation</a><br>
  • Competitor enumeration: <a href="https://developers.google.com/maps/documentation/places/web-service/overview">Google Places API (New)</a><br>
  • Geocoding: <a href="https://developers.arcgis.com/rest/geocode/api-reference/overview-world-geocoding-service.htm">ESRI World Geocoder</a><br>
  • Location: <a href="${googleMapsUrl}">Google Maps</a> · <a href="${esriViewerUrl}">ESRI Viewer</a><br>
  <br>
  <i>SpareFoot comp rates, PS Family Registry exclusion, forward rent curve, and Einstein LLM narrative populate via full audit after Save to Pipeline. Report generated ${new Date(generatedAt).toLocaleString()}.</i><br>
  <br>
  <b>Powered by Storvex™ — AI-Powered Storage Intelligence · Patent Pending (App. No. 64/009,393)</b>
</div>

<script>
  document.title = ${JSON.stringify(fileLabel)};
  // Preview mode — no auto-print. Print button in parent modal triggers window.print()
  // via postMessage; or user can print manually from the modal.
  window.addEventListener('message', (e) => {
    if (e.data === 'storvex-print') window.print();
  });
</script>
</body></html>`;
  return { html, fileLabel };
}

// Helper: open preview modal with iframe rendering the PDF HTML
function openPDFPreview(result, opts = {}) {
  const { html, fileLabel } = downloadPDF(result, opts);
  // If a previous modal exists, remove
  const existing = document.getElementById('storvex-pdf-preview-modal');
  if (existing) existing.remove();

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const modal = document.createElement('div');
  modal.id = 'storvex-pdf-preview-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.88);z-index:99999;display:flex;flex-direction:column;padding:20px;box-sizing:border-box';

  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 16px;background:linear-gradient(135deg,#1E2761,#0F1538);border-radius:10px 10px 0 0;border-bottom:1px solid rgba(201,168,76,0.3);flex-wrap:wrap';
  toolbar.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span style="background:linear-gradient(135deg,#C9A84C,#E4CB7C);color:#1E2761;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:900;letter-spacing:0.12em">📄 STORVEX PDF PREVIEW</span>
      <span style="color:rgba(255,255,255,0.65);font-size:11px">${fileLabel}</span>
    </div>
    <div style="margin-left:auto;display:flex;gap:8px">
      <button id="storvex-pdf-print" style="padding:8px 16px;border-radius:6px;border:none;background:linear-gradient(135deg,#DC2626,#991B1B);color:#fff;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:0.04em">🖨 Print / Save as PDF</button>
      <button id="storvex-pdf-download" style="padding:8px 16px;border-radius:6px;border:none;background:linear-gradient(135deg,#3B82F6,#1E3A8A);color:#fff;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:0.04em">⬇ Download HTML</button>
      <button id="storvex-pdf-newtab" style="padding:8px 16px;border-radius:6px;border:none;background:linear-gradient(135deg,#22C55E,#16A34A);color:#fff;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:0.04em">↗ Open in New Tab</button>
      <button id="storvex-pdf-close" style="padding:8px 16px;border-radius:6px;border:1px solid rgba(255,255,255,0.25);background:transparent;color:#fff;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:0.04em">✕ Close</button>
    </div>`;
  modal.appendChild(toolbar);

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.style.cssText = 'flex:1;width:100%;border:none;border-radius:0 0 10px 10px;background:#fff';
  iframe.setAttribute('title', 'Storvex Report Preview');
  modal.appendChild(iframe);

  document.body.appendChild(modal);
  // Disable body scroll while modal open
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const cleanup = () => {
    URL.revokeObjectURL(url);
    document.body.style.overflow = prevOverflow;
    modal.remove();
  };

  toolbar.querySelector('#storvex-pdf-close').onclick = cleanup;
  toolbar.querySelector('#storvex-pdf-print').onclick = () => {
    try { iframe.contentWindow.postMessage('storvex-print', '*'); } catch { iframe.contentWindow?.print?.(); }
  };
  toolbar.querySelector('#storvex-pdf-newtab').onclick = () => {
    window.open(url, '_blank');
  };
  toolbar.querySelector('#storvex-pdf-download').onclick = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileLabel + '.html';
    a.click();
  };
  // Esc closes
  const onEsc = (e) => { if (e.key === 'Escape') { cleanup(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);
}

// ═══════════════════════════════════════════════════════════════════════════
// Shareable URL — encode address into ?addr= query param
// ═══════════════════════════════════════════════════════════════════════════
function shareURL(result) {
  const url = new URL(window.location.href);
  url.hash = '';
  url.searchParams.set('addr', result.geo.formatted);
  const fullURL = url.toString();
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(fullURL);
    alert(`Link copied!\n\n${fullURL}\n\nPaste anywhere — opens directly to this report.`);
  } else {
    prompt('Copy this shareable URL:', fullURL);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Competitor brand classifier — Places API returns ALL "storage" hits
// (CC, drive-up, RV, boat, U-Haul rentals). This filter isolates the
// CC-confident subset to keep the CC SPC estimate honest pre-audit.
// ═══════════════════════════════════════════════════════════════════════════
function classifyCompetitor(c) {
  const name = (c.name || '').toLowerCase();
  // PS FAMILY — Public Storage, iStorage (PS-acquired), NSA (PS-acquired). Per §6b
  // these are the buyer's portfolio, NOT competitors. Excluded from CC SPC math.
  if (/\b(public storage|^ps$|istorage|i-storage|national storage affiliates|nsa storage)\b/i.test(name)) return 'ps_family';
  // RV / boat / vehicle storage — exclude entirely from CC SPC math
  if (/\b(rv|boat|vehicle|car|truck|trailer)\b/.test(name)) return 'exclude';
  // U-Haul moving rentals (not storage facilities) — exclude
  if (/u-?haul.*(moving|rental|truck)/i.test(name) && !/storage center/i.test(name)) return 'exclude';
  // Confirmed CC operators (REIT-tier excl. PS Family, or known multi-story CC)
  const ccBrands = /\b(extra space|cubesmart|life storage|storage king|smart stop|simply self storage|compass self storage|metro storage|storquest|storage post|prime storage|stax up|stor-?all|safeguard self storage)\b/i;
  if (ccBrands.test(name)) return 'cc_confident';
  // U-Haul storage centers (large multistory, mostly CC)
  if (/u-?haul.*storage/i.test(name)) return 'cc_confident';
  // Generic / mixed — could be CC or drive-up, lean drive-up for rural/suburban
  return 'mixed';
}

// ═══════════════════════════════════════════════════════════════════════════
// STORVEX VERDICT HERO — institutional one-glance verdict at top of result
// Synthesizes ESRI demos + Places competitors + REIT proximity into a
// SiteScore, headline verdict, CC SPC estimate, best-fit buyer, and 5-bullet
// story arc — same skeleton as the REC Package cover memo, compressed.
// ═══════════════════════════════════════════════════════════════════════════
// ZONING ORACLE PANEL — Radius-structural-beat feature #3
// ─────────────────────────────────────────────────────────────────────────
// Surfaces the permitted use table citation on every address lookup.
// Per CLAUDE.md §6c, zoning is the #1 deal-killer. Brokers spend 30 min on
// this; we do it in 10s via Claude Haiku 4.5 extraction from Municode/ecode360.
// ═══════════════════════════════════════════════════════════════════════════
function ZoningOraclePanel({ zoningIntel, zoningStatus, jurisdiction }) {
  if (zoningStatus === 'pending' || zoningStatus === 'retrying') {
    const isRetry = zoningStatus === 'retrying';
    return (
      <div style={{
        background: `linear-gradient(135deg, rgba(139,92,246,${isRetry ? 0.12 : 0.06}), rgba(15,21,56,0.6))`,
        border: `1px solid rgba(139,92,246,${isRetry ? 0.5 : 0.25})`,
        borderRadius: 14, padding: 16, marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>⚖ ZONING ORACLE</div>
          {isRetry ? (
            <div style={{ fontSize: 11, color: '#F59E0B', fontStyle: 'italic' }}>
              ⏸ Rate-limit cooldown — retrying in 60s (Anthropic 50K tpm sliding window)
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'rgba(201,168,76,0.75)', fontStyle: 'italic' }}>⏳ Searching Municode + ecode360 for {jurisdiction || 'jurisdiction'} ordinance...</div>
          )}
        </div>
      </div>
    );
  }
  if (!zoningIntel) return null;

  const found = zoningIntel.found && zoningIntel.ok !== false;
  const confidence = zoningIntel.confidence || 'low';
  const confColor = confidence === 'high' ? '#10B981' : confidence === 'medium' ? '#F59E0B' : '#EF4444';
  const byRight = Array.isArray(zoningIntel.byRightDistricts) ? zoningIntel.byRightDistricts : [];
  const conditional = Array.isArray(zoningIntel.conditionalDistricts) ? zoningIntel.conditionalDistricts : [];
  const rezone = Array.isArray(zoningIntel.rezoneRequired) ? zoningIntel.rezoneRequired : [];

  return (
    <div style={{
      background: `linear-gradient(135deg, ${found ? 'rgba(139,92,246,0.08)' : 'rgba(239,68,68,0.06)'}, rgba(15,21,56,0.65))`,
      border: `1px solid ${found ? 'rgba(139,92,246,0.35)' : 'rgba(239,68,68,0.3)'}`,
      borderRadius: 14, padding: 18, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>⚖ ZONING ORACLE · PATENT-PENDING</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>The #1 deal-killer. Radius doesn't cite the ordinance.</div>
        {zoningIntel.cacheHit && (
          <span title={`Cached ${zoningIntel.cacheHit.lastVerified} — ${zoningIntel.cacheHit.ordinanceName}`} style={{ background: 'linear-gradient(135deg, #C9A84C, #E4CB7C)', color: '#1E2761', padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 900, letterSpacing: '0.08em' }}>
            🎯 STORVEX CURATED
          </span>
        )}
        <span style={{ marginLeft: 'auto', background: confColor, color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 900, letterSpacing: '0.1em' }}>
          {confidence.toUpperCase()} CONFIDENCE
        </span>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: '1 1 280px' }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>JURISDICTION</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginTop: 2 }}>{zoningIntel.jurisdiction || jurisdiction}</div>
          {zoningIntel.source && zoningIntel.source !== 'manual-required' && (
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
              Source: <a href={zoningIntel.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#4CC982' }}>↗ {zoningIntel.source}</a>
              {zoningIntel.ordinanceSection && <> · {zoningIntel.ordinanceSection}</>}
            </div>
          )}
        </div>
        {found && zoningIntel.storageTerm && (
          <div style={{ flex: '1 1 280px' }}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>STORAGE USE CATEGORY</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#C9A84C', marginTop: 2, fontStyle: 'italic' }}>"{zoningIntel.storageTerm}"</div>
            {zoningIntel.tableName && <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>From: {zoningIntel.tableName}</div>}
          </div>
        )}
      </div>

      {found && (byRight.length > 0 || conditional.length > 0 || rezone.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 10 }}>
          {byRight.length > 0 && (
            <div style={{ background: 'rgba(16,185,129,0.08)', padding: 10, borderRadius: 8, borderLeft: '3px solid #10B981' }}>
              <div style={{ fontSize: 8, color: '#10B981', letterSpacing: '0.14em', fontWeight: 800 }}>BY-RIGHT (PERMITTED)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {byRight.map((d, i) => (
                  <span key={i} style={{ background: '#10B981', color: '#fff', padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 800, fontFamily: "'Space Mono', monospace" }}>{d}</span>
                ))}
              </div>
            </div>
          )}
          {conditional.length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.08)', padding: 10, borderRadius: 8, borderLeft: '3px solid #F59E0B' }}>
              <div style={{ fontSize: 8, color: '#F59E0B', letterSpacing: '0.14em', fontWeight: 800 }}>CONDITIONAL (SUP/CUP)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {conditional.map((d, i) => (
                  <span key={i} style={{ background: '#F59E0B', color: '#fff', padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 800, fontFamily: "'Space Mono', monospace" }}>{d}</span>
                ))}
              </div>
            </div>
          )}
          {rezone.length > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.08)', padding: 10, borderRadius: 8, borderLeft: '3px solid #EF4444' }}>
              <div style={{ fontSize: 8, color: '#EF4444', letterSpacing: '0.14em', fontWeight: 800 }}>REZONE REQUIRED</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {rezone.map((d, i) => (
                  <span key={i} style={{ background: '#EF4444', color: '#fff', padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 800, fontFamily: "'Space Mono', monospace" }}>{d}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {(zoningIntel.overlayNotes || zoningIntel.supStandards) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginBottom: 10 }}>
          {zoningIntel.overlayNotes && (
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6 }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>OVERLAY REQUIREMENTS</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 4, lineHeight: 1.5 }}>{zoningIntel.overlayNotes}</div>
            </div>
          )}
          {zoningIntel.supStandards && (
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6 }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>SUPPLEMENTAL STANDARDS</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 4, lineHeight: 1.5 }}>{zoningIntel.supStandards}</div>
            </div>
          )}
        </div>
      )}

      {/* INTERPRETATION only on successful lookups — failed lookups show
          the "AUTOMATED LOOKUP FAILED" footer instead so raw API errors
          can't leak into the user-facing narrative. */}
      {found && zoningIntel.notes && (
        <div style={{ padding: 10, background: 'rgba(0,0,0,0.35)', borderRadius: 8, fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 }}>
          <b style={{ color: '#8B5CF6', letterSpacing: '0.08em', marginRight: 8 }}>INTERPRETATION:</b>
          {zoningIntel.notes}
        </div>
      )}

      {!found && zoningIntel.searchHints && (
        <div style={{ padding: 10, background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.25)' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginBottom: 6 }}>
            <b style={{ color: '#EF4444' }}>⚠ AUTOMATED LOOKUP FAILED</b> — ordinance not retrievable via Municode or ecode360. Try these manual sources:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 10 }}>
            {zoningIntel.searchHints.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{
                background: 'rgba(139,92,246,0.15)', color: '#C9A84C', padding: '4px 10px',
                borderRadius: 4, textDecoration: 'none', fontWeight: 700,
              }}>
                {i === 0 ? '↗ Google Search' : i === 1 ? '↗ Municode Direct' : '↗ ecode360 Direct'}
              </a>
            ))}
          </div>
        </div>
      )}

      {zoningIntel.elapsedMs && (
        <div style={{ marginTop: 8, fontSize: 9, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' }}>
          Oracle lookup: {(zoningIntel.elapsedMs / 1000).toFixed(1)}s · extraction via Claude Haiku 4.5
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY ORACLE PANEL — Radius-structural-beat feature #4
// ─────────────────────────────────────────────────────────────────────────
// Surfaces water/sewer/electric providers + hookup status on every lookup.
// Per CLAUDE.md §6c-2, water is the #2 deal-killer — commercial storage fire
// suppression requires municipal water (wells can't hit 1,500 GPM @ 20 PSI).
// Claude web_search + web_fetch, ~20-30s per lookup.
// ═══════════════════════════════════════════════════════════════════════════
function UtilityOraclePanel({ utilityIntel, utilityStatus, jurisdiction }) {
  if (utilityStatus === 'pending' || utilityStatus === 'retrying') {
    const isRetry = utilityStatus === 'retrying';
    return (
      <div style={{
        background: `linear-gradient(135deg, rgba(14,165,233,${isRetry ? 0.12 : 0.06}), rgba(15,21,56,0.6))`,
        border: `1px solid rgba(14,165,233,${isRetry ? 0.5 : 0.25})`,
        borderRadius: 14, padding: 16, marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ background: 'linear-gradient(135deg, #0EA5E9, #0369A1)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>💧 UTILITY ORACLE</div>
          {isRetry ? (
            <div style={{ fontSize: 11, color: '#F59E0B', fontStyle: 'italic' }}>
              ⏸ Rate-limit cooldown — retrying in 60s
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'rgba(14,165,233,0.8)', fontStyle: 'italic' }}>⏳ Identifying water/sewer/electric providers for {jurisdiction || 'jurisdiction'}...</div>
          )}
        </div>
      </div>
    );
  }
  if (!utilityIntel) return null;

  const found = utilityIntel.found !== false && utilityIntel.ok !== false;
  const confidence = utilityIntel.confidence || 'low';
  const confColor = confidence === 'high' ? '#10B981' : confidence === 'medium' ? '#F59E0B' : '#EF4444';
  const hookup = utilityIntel.waterHookupStatus || 'unknown';
  const hookupColor = hookup === 'by-right' ? '#10B981' : hookup === 'by-request' ? '#F59E0B' : hookup === 'no-provider' ? '#EF4444' : '#64748B';
  const hookupLabel = hookup === 'by-right' ? 'BY-RIGHT (inside boundary)' : hookup === 'by-request' ? 'BY-REQUEST (extension)' : hookup === 'no-provider' ? 'NO PROVIDER' : 'UNKNOWN';

  return (
    <div style={{
      background: `linear-gradient(135deg, ${found ? 'rgba(14,165,233,0.08)' : 'rgba(239,68,68,0.06)'}, rgba(15,21,56,0.65))`,
      border: `1px solid ${found ? 'rgba(14,165,233,0.35)' : 'rgba(239,68,68,0.3)'}`,
      borderRadius: 14, padding: 18, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ background: 'linear-gradient(135deg, #0EA5E9, #0369A1)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>💧 UTILITY ORACLE · PATENT-PENDING</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>Water is the #2 deal-killer. Who do we call for the tap?</div>
        <span style={{ marginLeft: 'auto', background: confColor, color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 900, letterSpacing: '0.1em' }}>
          {confidence.toUpperCase()} CONFIDENCE
        </span>
      </div>

      {/* WATER — the headline */}
      {found && (utilityIntel.waterProvider || hookup !== 'unknown') && (
        <div style={{ background: 'rgba(0,0,0,0.35)', padding: 14, borderRadius: 10, marginBottom: 10, borderLeft: `4px solid ${hookupColor}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>WATER PROVIDER</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 2 }}>{utilityIntel.waterProvider || '—'}</div>
            </div>
            <span style={{ marginLeft: 'auto', background: hookupColor, color: '#fff', padding: '4px 10px', borderRadius: 4, fontSize: 10, fontWeight: 900, letterSpacing: '0.1em', fontFamily: "'Space Mono', monospace" }}>
              {hookupLabel}
            </span>
          </div>
          {utilityIntel.waterContact && (utilityIntel.waterContact.phone || utilityIntel.waterContact.email || utilityIntel.waterContact.name) && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.6, padding: 8, background: 'rgba(14,165,233,0.08)', borderRadius: 6, marginTop: 6 }}>
              <b style={{ color: '#0EA5E9', letterSpacing: '0.05em' }}>⚡ WHO TO CALL FOR HOOKUP: </b>
              {utilityIntel.waterContact.name && <><b>{utilityIntel.waterContact.name}</b> · </>}
              {utilityIntel.waterContact.dept && <>{utilityIntel.waterContact.dept} · </>}
              {utilityIntel.waterContact.phone && <><a href={`tel:${utilityIntel.waterContact.phone}`} style={{ color: '#4CC982', textDecoration: 'none', fontFamily: "'Space Mono', monospace" }}>{utilityIntel.waterContact.phone}</a> · </>}
              {utilityIntel.waterContact.email && <><a href={`mailto:${utilityIntel.waterContact.email}`} style={{ color: '#4CC982', textDecoration: 'none' }}>{utilityIntel.waterContact.email}</a> · </>}
              {utilityIntel.waterContact.website && <a href={utilityIntel.waterContact.website} target="_blank" rel="noopener noreferrer" style={{ color: '#4CC982', textDecoration: 'none' }}>↗ website</a>}
            </div>
          )}
          {utilityIntel.fireFlowNotes && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
              <b style={{ color: '#F97316' }}>🔥 FIRE FLOW:</b> {utilityIntel.fireFlowNotes}
            </div>
          )}
        </div>
      )}

      {/* SEWER + ELECTRIC + GAS grid */}
      {found && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 10 }}>
          {utilityIntel.sewerProvider && (
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6 }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>SEWER</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 4 }}>{utilityIntel.sewerProvider}</div>
              <div style={{ fontSize: 9, color: utilityIntel.sewerAvailable ? '#4CC982' : 'rgba(255,255,255,0.5)', marginTop: 4 }}>
                {utilityIntel.sewerAvailable ? '✓ municipal available' : 'septic — storage uses minimal wastewater'}
              </div>
            </div>
          )}
          {utilityIntel.electricProvider && (
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6 }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>ELECTRIC</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 4 }}>{utilityIntel.electricProvider}</div>
              <div style={{ fontSize: 9, marginTop: 4, color: utilityIntel.threePhase === true ? '#4CC982' : utilityIntel.threePhase === false ? '#EF4444' : '#F59E0B' }}>
                3-phase: {utilityIntel.threePhase === true ? '✓ confirmed' : utilityIntel.threePhase === false ? '✗ not available' : (utilityIntel.threePhase || 'verify').toString().replace('-', ' ')}
              </div>
            </div>
          )}
          {utilityIntel.gasProvider && utilityIntel.gasProvider !== 'N/A' && (
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6 }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>NATURAL GAS</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 4 }}>{utilityIntel.gasProvider}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>nice-to-have for climate control</div>
            </div>
          )}
          {utilityIntel.tapFees && (
            <div style={{ background: 'rgba(201,168,76,0.08)', padding: 10, borderRadius: 6, borderLeft: '3px solid #C9A84C' }}>
              <div style={{ fontSize: 8, color: '#C9A84C', letterSpacing: '0.14em', fontWeight: 800 }}>TAP / IMPACT FEES</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginTop: 4 }}>{utilityIntel.tapFees}</div>
            </div>
          )}
        </div>
      )}

      {utilityIntel.serviceBoundaryUrl && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginBottom: 8 }}>
          Service boundary: <a href={utilityIntel.serviceBoundaryUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#4CC982' }}>↗ verify map</a>
        </div>
      )}

      {/* INTERPRETATION rendered only on successful lookups — when the API
          falls back to error mode, the "AUTOMATED LOOKUP FAILED" footer
          conveys the failed state instead. Belt-and-suspenders defense
          against raw API errors leaking through into the user-facing text. */}
      {found && utilityIntel.notes && (
        <div style={{ padding: 10, background: 'rgba(0,0,0,0.35)', borderRadius: 8, fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 }}>
          <b style={{ color: '#0EA5E9', letterSpacing: '0.08em', marginRight: 8 }}>INTERPRETATION:</b>
          {utilityIntel.notes}
        </div>
      )}

      {!found && utilityIntel.searchHints && (
        <div style={{ padding: 10, background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.25)' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginBottom: 6 }}>
            <b style={{ color: '#EF4444' }}>⚠ AUTOMATED UTILITY LOOKUP FAILED</b> — try manual sources:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 10 }}>
            {utilityIntel.searchHints.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ background: 'rgba(14,165,233,0.15)', color: '#C9A84C', padding: '4px 10px', borderRadius: 4, textDecoration: 'none', fontWeight: 700 }}>
                ↗ {url.includes('google') ? 'Google Search' : url.includes('tceq') ? 'TCEQ CCN Map (TX)' : 'Manual source'}
              </a>
            ))}
          </div>
        </div>
      )}

      {utilityIntel.elapsedMs && (
        <div style={{ marginTop: 8, fontSize: 9, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' }}>
          Oracle lookup: {(utilityIntel.elapsedMs / 1000).toFixed(1)}s · extraction via Claude Haiku 4.5
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ACCESS ORACLE PANEL — Radius-structural-beat feature #5
// ─────────────────────────────────────────────────────────────────────────
// VPD (vehicles per day) + road frontage + signalization + decel lane risk.
// Per CLAUDE.md §6b-2, storage customers tow trailers and drive box trucks.
// Radius shows road name; we pull the state DOT traffic count + underwrite
// the turn via Claude Haiku web_search + web_fetch.
// ═══════════════════════════════════════════════════════════════════════════
function AccessOraclePanel({ accessIntel, accessStatus, jurisdiction }) {
  if (accessStatus === 'pending' || accessStatus === 'retrying') {
    const isRetry = accessStatus === 'retrying';
    return (
      <div style={{
        background: `linear-gradient(135deg, rgba(245,158,11,${isRetry ? 0.12 : 0.06}), rgba(15,21,56,0.6))`,
        border: `1px solid rgba(245,158,11,${isRetry ? 0.5 : 0.25})`,
        borderRadius: 14, padding: 16, marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ background: 'linear-gradient(135deg, #F59E0B, #B45309)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>🚧 ACCESS ORACLE</div>
          {isRetry ? (
            <div style={{ fontSize: 11, color: '#F59E0B', fontStyle: 'italic' }}>
              ⏸ Rate-limit cooldown — retrying in 60s
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'rgba(245,158,11,0.85)', fontStyle: 'italic' }}>⏳ Pulling VPD + frontage + signalization from state DOT...</div>
          )}
        </div>
      </div>
    );
  }
  if (!accessIntel) return null;

  const found = accessIntel.found !== false && accessIntel.ok !== false;
  const confidence = accessIntel.confidence || 'low';
  const confColor = confidence === 'high' ? '#10B981' : confidence === 'medium' ? '#F59E0B' : '#EF4444';
  const vpd = accessIntel.vpd;
  // VPD tier for storage: >20K elite, >12K strong, >8K good, >4K viable, <4K weak
  const vpdTier = vpd == null ? null
    : vpd >= 30000 ? { label: 'ELITE', color: '#10B981' }
    : vpd >= 20000 ? { label: 'STRONG', color: '#22C55E' }
    : vpd >= 12000 ? { label: 'GOOD', color: '#3B82F6' }
    : vpd >= 6000  ? { label: 'VIABLE', color: '#F59E0B' }
    : vpd >= 3000  ? { label: 'WEAK', color: '#F97316' }
    : { label: 'LOW', color: '#EF4444' };

  const decelRisk = accessIntel.decelLaneRisk;
  const decelColor = decelRisk === 'low' ? '#4CC982' : decelRisk === 'medium' ? '#F59E0B' : decelRisk === 'high' ? '#EF4444' : '#64748B';
  const vizColor = accessIntel.visibility === 'excellent' ? '#10B981' : accessIntel.visibility === 'good' ? '#22C55E' : accessIntel.visibility === 'moderate' ? '#F59E0B' : accessIntel.visibility === 'poor' ? '#EF4444' : '#64748B';

  return (
    <div style={{
      background: `linear-gradient(135deg, ${found ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.06)'}, rgba(15,21,56,0.65))`,
      border: `1px solid ${found ? 'rgba(245,158,11,0.35)' : 'rgba(239,68,68,0.3)'}`,
      borderRadius: 14, padding: 18, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ background: 'linear-gradient(135deg, #F59E0B, #B45309)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>🚧 ACCESS ORACLE · PATENT-PENDING</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>VPD from state DOT · Radius shows the road, we underwrite the turn</div>
        <span style={{ marginLeft: 'auto', background: confColor, color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 900, letterSpacing: '0.1em' }}>
          {confidence.toUpperCase()} CONFIDENCE
        </span>
      </div>

      {/* VPD HEADLINE */}
      {found && (
        <div style={{ background: 'rgba(0,0,0,0.4)', padding: 14, borderRadius: 10, marginBottom: 10, borderLeft: `4px solid ${vpdTier?.color || '#64748B'}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>VPD · {accessIntel.vpdYear || ''}</div>
              <div style={{ fontSize: 36, fontWeight: 900, color: vpdTier?.color || '#fff', fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>
                {vpd != null ? vpd.toLocaleString() : '—'}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
                vehicles/day
                {accessIntel.vpdSource && <> · <a href={accessIntel.vpdSourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#4CC982', textDecoration: 'none' }}>↗ {accessIntel.vpdSource}</a></>}
              </div>
            </div>
            {vpdTier && (
              <span style={{ background: vpdTier.color, color: '#fff', padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 900, letterSpacing: '0.12em' }}>
                {vpdTier.label} VISIBILITY
              </span>
            )}
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>FRONTAGE ROAD</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#C9A84C', fontFamily: "'Space Mono', monospace", marginTop: 2 }}>{accessIntel.frontageRoad || '—'}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{(accessIntel.frontageRoadType || 'unknown').replace('-', ' ')}</div>
            </div>
          </div>
        </div>
      )}

      {/* ACCESS DETAIL GRID */}
      {found && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 10 }}>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6 }}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>MEDIAN</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginTop: 4, textTransform: 'capitalize' }}>{(accessIntel.medianType || 'unknown').replace(/_/g, ' ')}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
              {accessIntel.medianType === 'raised' ? '⚠ restricts L-turn access' : accessIntel.medianType === 'TWLTL' ? '✓ L-turn friendly' : accessIntel.medianType === 'none' ? '✓ no restriction' : ''}
            </div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6 }}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>NEAREST SIGNAL</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginTop: 4 }}>{accessIntel.nearestSignal || '—'}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>storage customers need signaled L-turns</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6 }}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>CURB CUTS</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginTop: 4, textTransform: 'capitalize' }}>{(accessIntel.curbCutsLikely || 'unknown').replace(/_/g, ' ')}</div>
            <div style={{ fontSize: 9, color: accessIntel.curbCutsLikely === 'existing' ? '#4CC982' : accessIntel.curbCutsLikely === 'new required' ? '#F59E0B' : 'rgba(255,255,255,0.5)', marginTop: 2 }}>
              {accessIntel.curbCutsLikely === 'existing' ? '✓ no permit needed' : accessIntel.curbCutsLikely === 'new required' ? '⚠ DOT permit' : ''}
            </div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6, borderLeft: `3px solid ${decelColor}` }}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>DECEL LANE RISK</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: decelColor, marginTop: 4, textTransform: 'uppercase' }}>{decelRisk || 'unknown'}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
              {decelRisk === 'high' ? '$50K-$150K' : decelRisk === 'medium' ? 'possible ask' : decelRisk === 'low' ? '✓ unlikely' : ''}
            </div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6 }}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>VISIBILITY</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: vizColor, marginTop: 4, textTransform: 'uppercase' }}>{accessIntel.visibility || 'unknown'}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>drive-by signage value</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 6 }}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800 }}>DRIVEWAY GRADE</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginTop: 4, textTransform: 'capitalize' }}>{accessIntel.drivewayGrade || 'unknown'}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{accessIntel.drivewayGrade === 'steep' ? '⚠ trailers struggle' : ''}</div>
          </div>
          {accessIntel.landlockedRisk && (
            <div style={{ background: 'rgba(239,68,68,0.15)', padding: 10, borderRadius: 6, borderLeft: '3px solid #EF4444', gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 10, color: '#EF4444', fontWeight: 900, letterSpacing: '0.1em' }}>🚨 LANDLOCKED RISK</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>Interior parcel or easement-only access — major deal flag. Verify platted frontage before advancing.</div>
            </div>
          )}
        </div>
      )}

      {/* INTERPRETATION only on successful lookups — failed lookups show
          the "AUTOMATED ACCESS LOOKUP FAILED" footer instead. */}
      {found && accessIntel.notes && (
        <div style={{ padding: 10, background: 'rgba(0,0,0,0.35)', borderRadius: 8, fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 }}>
          <b style={{ color: '#F59E0B', letterSpacing: '0.08em', marginRight: 8 }}>INTERPRETATION:</b>
          {accessIntel.notes}
        </div>
      )}

      {!found && accessIntel.searchHints && (
        <div style={{ padding: 10, background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.25)' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginBottom: 6 }}>
            <b style={{ color: '#EF4444' }}>⚠ AUTOMATED ACCESS LOOKUP FAILED</b> — try state DOT manually:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 10 }}>
            {accessIntel.searchHints.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ background: 'rgba(245,158,11,0.15)', color: '#C9A84C', padding: '4px 10px', borderRadius: 4, textDecoration: 'none', fontWeight: 700 }}>
                ↗ Google Search
              </a>
            ))}
          </div>
        </div>
      )}

      {accessIntel.elapsedMs && (
        <div style={{ marginTop: 8, fontSize: 9, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' }}>
          Oracle lookup: {(accessIntel.elapsedMs / 1000).toFixed(1)}s · extraction via Claude Haiku 4.5
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CC SPC Headline — surfaces climate-controlled SF per capita as the #1
// competition metric. Radius publishes raw SPC, we publish CC SPC with tier
// verdict + 5-yr projected. This is the deal-killer / deal-maker metric PS,
// EXR, CUBE, SROA, Merit Hill, Devon all underwrite off of.
// ═══════════════════════════════════════════════════════════════════════════
function CCSPCHeadline({ ccSPC, r3, competitors }) {
  if (!ccSPC || (ccSPC.current == null && ccSPC.projected == null)) return null;
  const v = ccSPC.verdict;
  const pv = ccSPC.projectedVerdict;
  const pop = r3?.TOTPOP_CY;
  const popFY = r3?.TOTPOP_FY;
  const cur = ccSPC.current;
  const proj = ccSPC.projected;
  const flood = ccSPC.pipelineFlood;

  return (
    <div style={{
      background: `linear-gradient(135deg, ${v.color}22, rgba(15,21,56,0.75))`,
      border: `1px solid ${v.color}66`,
      borderRadius: 14,
      padding: 20,
      marginBottom: 14,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ background: `linear-gradient(135deg, ${v.color}, ${v.color}CC)`, color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>
          CC SPC · CLIMATE-CONTROLLED SF PER CAPITA
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>
          The #1 storage competition metric · Radius doesn't publish this
        </div>
        {flood && (
          <span style={{ background: '#EF4444', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 900, letterSpacing: '0.1em' }}>
            ⚠ PIPELINE FLOOD RISK
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        {/* CURRENT CC SPC */}
        <div style={{ background: 'rgba(0,0,0,0.4)', padding: 14, borderRadius: 10, borderLeft: `4px solid ${v.color}` }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800, marginBottom: 4 }}>CURRENT (2025)</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: v.color, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>
            {cur != null ? cur.toFixed(2) : '—'}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>CC SF / capita · 3-mi ring</div>
          <div style={{ marginTop: 8, display: 'inline-block', background: v.color, color: '#fff', padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 900, letterSpacing: '0.1em' }}>
            {v.label}
          </div>
        </div>

        {/* PROJECTED 5-YR CC SPC */}
        <div style={{ background: 'rgba(0,0,0,0.4)', padding: 14, borderRadius: 10, borderLeft: `4px solid ${pv.color}` }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800, marginBottom: 4 }}>PROJECTED (2030)</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: pv.color, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>
            {proj != null ? proj.toFixed(2) : '—'}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
            CC SF / capita · 5-yr forward
          </div>
          <div style={{ marginTop: 8, display: 'inline-block', background: pv.color, color: '#fff', padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 900, letterSpacing: '0.1em' }}>
            {pv.label}
          </div>
        </div>

        {/* SUPPLY SUMMARY */}
        <div style={{ background: 'rgba(0,0,0,0.4)', padding: 14, borderRadius: 10 }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800, marginBottom: 4 }}>3-MI CC SUPPLY</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>
            ~{Math.round(ccSPC.totalCCSF / 1000).toLocaleString()}K SF
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 6, lineHeight: 1.4 }}>
            {ccSPC.competitorCount} storage facilit{ccSPC.competitorCount === 1 ? 'y' : 'ies'} in 3 mi
            {ccSPC.psFamilyCount > 0 && <span style={{ color: '#F97316' }}> · {ccSPC.psFamilyCount} PS family</span>}
          </div>
          <div style={{ marginTop: 4, fontSize: 9, color: 'rgba(255,255,255,0.55)' }}>
            {ccSPC.ccConfidentCount || 0} CC-confident · {ccSPC.mixedCount || 0} mixed
          </div>
          <div style={{ marginTop: 6, fontSize: 9, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
            Calibrated vs SpareFoot audits · CC brand 28K · mixed 6K CC SF each
          </div>
        </div>

        {/* POPULATION BASE */}
        <div style={{ background: 'rgba(0,0,0,0.4)', padding: 14, borderRadius: 10 }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.14em', fontWeight: 800, marginBottom: 4 }}>TRADE AREA</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>
            {pop ? pop.toLocaleString() : '—'}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>
            3-mi pop (2025)
          </div>
          {popFY && pop && (
            <div style={{ marginTop: 6, fontSize: 9, color: popFY > pop ? '#4CC982' : '#F59E0B' }}>
              → {popFY.toLocaleString()} by 2030 ({popFY > pop ? '+' : ''}{(((popFY - pop) / pop) * 100).toFixed(1)}%)
            </div>
          )}
        </div>
      </div>

      {/* VERDICT RIBBON */}
      <div style={{ marginTop: 14, padding: 10, background: 'rgba(0,0,0,0.35)', borderRadius: 8, fontSize: 11, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6 }}>
        <b style={{ color: v.color, letterSpacing: '0.08em', marginRight: 8 }}>VERDICT:</b>
        {cur != null && cur < 3.0 && <>Undersupplied trade area — strong demand-side signal for new CC product.</>}
        {cur != null && cur >= 3.0 && cur < 5.0 && <>Moderate supply — viable but watch pipeline for new entrants.</>}
        {cur != null && cur >= 5.0 && cur < 7.0 && <>Well-supplied market — new entrant needs differentiation (location, product tier, operator brand).</>}
        {cur != null && cur >= 7.0 && <>Oversupplied — new CC development faces meaningful lease-up risk absent demographic tailwind.</>}
        {flood && <span style={{ color: '#EF4444', marginLeft: 6 }}>Pipeline flood projected — new CC supply outpacing population growth over 5-yr.</span>}
        {cur == null && <>Unable to estimate CC SPC — competitor or demographic data missing.</>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
function StorvexVerdictHero({ result }) {
  const { geo, r3, competitors, metrics } = result;
  const pop = r3?.TOTPOP_CY || 0;
  const hhi = r3?.MEDHINC_CY || 0;
  const homeVal = r3?.MEDVAL_CY || 0;
  const growth = metrics?.popGrowth ?? 0;
  const peakPct = metrics?.peakPct ?? 0;

  // Classify Places hits — exclude PS Family (buyer portfolio), RV/non-storage; isolate CC-confident
  const classified = (competitors || []).map(c => ({ ...c, _class: classifyCompetitor(c) }));
  const validCompetitors = classified.filter(c => c._class !== 'exclude' && c._class !== 'ps_family');
  const ccConfident = classified.filter(c => c._class === 'cc_confident');
  const mixed = classified.filter(c => c._class === 'mixed');
  const psFamilyHits = classified.filter(c => c._class === 'ps_family');
  const compCount = validCompetitors.length;

  // Quick SiteScore — 5 weighted dimensions from data we already pull
  const popScore = pop >= 40000 ? 10 : pop >= 25000 ? 8 : pop >= 15000 ? 6 : pop >= 10000 ? 5 : pop >= 5000 ? 3 : 0;
  const incScore = hhi >= 90000 ? 10 : hhi >= 75000 ? 8 : hhi >= 65000 ? 6 : hhi >= 55000 ? 4 : 0;
  const growthScore = growth >= 2 ? 10 : growth >= 1.5 ? 9 : growth >= 1 ? 8 : growth >= 0.5 ? 6 : growth >= 0 ? 4 : 0;
  const compScore = compCount <= 2 ? 10 : compCount <= 4 ? 7 : compCount <= 7 ? 5 : 3;
  const peakScore = peakPct >= 50 ? 10 : peakPct >= 45 ? 8 : peakPct >= 40 ? 6 : 4;
  const composite = popScore * 0.22 + incScore * 0.18 + growthScore * 0.25 + compScore * 0.20 + peakScore * 0.15;

  const verdict = composite >= 8 ? { label: 'PRIME', color: '#22C55E', glow: 'rgba(34,197,94,0.35)' }
                : composite >= 6.5 ? { label: 'STRONG', color: '#3B82F6', glow: 'rgba(59,130,246,0.35)' }
                : composite >= 5 ? { label: 'MODERATE', color: '#F59E0B', glow: 'rgba(245,158,11,0.35)' }
                : { label: 'WEAK', color: '#EF4444', glow: 'rgba(239,68,68,0.35)' };

  // Estimated CC SPC — pre-audit pass. PS Family excluded per §6b. Brand-weighted SF:
  //   cc_confident = 1.0 facility (REIT/known CC operator excl. PS Family) at ~28K CC SF avg
  //   mixed        = 0.30 facility (most suburban "self storage" is drive-up-dominant) at ~20K CC SF
  // Calibrated against verified SpareFoot audits across the pipeline (target ±25% of audit value).
  const ccFacilityEquiv = ccConfident.length * 1.0 + mixed.length * 0.30;
  const estCCSF = ccConfident.length * 28000 + mixed.length * 0.30 * 20000;
  const ccSPCEst = pop > 0 ? estCCSF / pop : null;
  const ccBand = ccSPCEst == null ? { label: 'TBD', color: '#94A3B8', tone: 'awaiting verification' }
              : ccSPCEst < 1.5 ? { label: 'Severely Underserved', color: '#22C55E', tone: 'strong CC demand signal' }
              : ccSPCEst < 3 ? { label: 'Underserved', color: '#22C55E', tone: 'good CC opportunity' }
              : ccSPCEst < 5 ? { label: 'Moderate', color: '#F59E0B', tone: 'viable, watch pipeline' }
              : ccSPCEst < 7 ? { label: 'Well-Supplied', color: '#F59E0B', tone: 'competitive market' }
              : { label: 'Oversupplied', color: '#EF4444', tone: 'saturation risk' };

  // PS Family proximity (any PS / iStorage / NSA brand counts)
  const reit5 = result.reit5mi || [];
  const psFamily = reit5.find(loc => /(public storage|^ps$|istorage|national storage|nsa)/i.test(loc.brand || ''));
  const nearestPS = psFamily ? psFamily.distanceMi : null;

  // Best-fit buyer match — proximity tiers reflect cannibalization vs coverage-gap thesis
  // PS underwriting pattern: <2mi = cannibalization risk, 2-5mi = mixed (validate coverage gap),
  // 5-15mi = clean infill, 15-25mi = exurban thesis, >25mi = no PS validation.
  const psNear = nearestPS != null && nearestPS < 2;
  const psSweet = nearestPS != null && nearestPS >= 2 && nearestPS <= 15;
  const psFar = nearestPS != null && nearestPS > 15 && nearestPS <= 25;
  const bestBuyer =
      composite >= 7.5 && psSweet
        ? { name: 'Public Storage (PS Family)', why: nearestPS <= 5 ? `${nearestPS.toFixed(1)} mi to PS family — verify cannibalization vs. coverage-gap thesis before LOI` : `${nearestPS.toFixed(1)} mi to PS family — clean infill distance, submarket validated` }
    : composite >= 7.5 && psFar
        ? { name: 'Public Storage (PS Family)', why: `${nearestPS.toFixed(1)} mi to PS family — exurban expansion thesis` }
    : composite >= 7.5 && nearestPS == null
        // PSA coverage-gap thesis. No PS family within 5 mi but composite is
        // institution-tier — that's a submarket PSA hasn't entered yet, not a
        // strike against PSA. Aligns the hero tile with the operator stack-rank
        // body content (which calibrates PSA economics regardless of proximity)
        // so we don't say "Storage King is best fit" up top and "PSA is the
        // home run" below. Previous bug: this case fell through to the
        // composite ≥ 6 && hhi ≥ 70K Storage King default.
        ? { name: 'Public Storage (PS Family)', why: 'no PS family within 5 mi — coverage-gap thesis with PS-tier demographics' }
    : composite >= 7.5 && psNear
        ? { name: 'Storage King / Andover (PS too close)', why: `PS only ${nearestPS.toFixed(1)} mi away — too tight for PS, but SK tolerates overlap` }
    : composite >= 6 && hhi >= 70000
        ? { name: 'Storage King / Andover Properties', why: 'affluent submarket fits SK overlap-tolerant acquisition model' }
    : composite >= 6.5
        ? { name: 'Extra Space Storage', why: 'demos align with EXR national CC expansion criteria' }
    : composite >= 5
        ? { name: 'Local operator or private capital', why: 'solid fundamentals; REIT may pass on scale' }
        : { name: 'Pass — re-route', why: 'fundamentals do not support a storage acquisition here' };

  // Hard gate flags (binary pass/fail)
  const gates = [
    { label: '3-mi pop ≥ 5K', pass: pop >= 5000, val: pop.toLocaleString() },
    { label: '3-mi HHI ≥ $55K', pass: hhi >= 55000, val: '$' + hhi.toLocaleString() },
    { label: 'Pop growth ≥ 0%', pass: growth >= 0, val: (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%' },
  ];
  const allGatesPass = gates.every(g => g.pass);

  // Story bullets — narrative arc mirrors the REC Package cover memo
  const cityState = `${geo.city || ''}${geo.state ? ', ' + geo.state : ''}`.replace(/^, /, '');
  const story = [
    { n: '01', title: 'The Subject', text: `${geo.formatted || 'Subject site'} — sits in ${cityState || 'this submarket'} with a 3-mile trade area of ${pop.toLocaleString()} residents and ${(r3?.TOTHH_CY || 0).toLocaleString()} households.` },
    { n: '02', title: 'The Market', text: `${growth >= 1 ? 'Growth corridor' : growth >= 0 ? 'Stable demographics' : 'Declining trade area'} at ${(growth >= 0 ? '+' : '') + growth.toFixed(1)}% 5-yr CAGR. Median HHI ${hhi.toLocaleString() ? '$' + hhi.toLocaleString() : '—'}${homeVal ? `, median home $${Math.round(homeVal/1000)}K` : ''}. ${peakPct >= 45 ? 'Strong peak-storage-age cohort.' : 'Mixed peak-storage demographics.'}` },
    { n: '03', title: 'The Competition', text: `${compCount} valid storage ${compCount === 1 ? 'facility' : 'facilities'} within 3 miles (${ccConfident.length} CC-confident · ${mixed.length} mixed${psFamilyHits.length > 0 ? ` · ${psFamilyHits.length} PS family excluded` : ''}; RV/non-storage filtered)${ccSPCEst != null ? `. Estimated CC SPC ~${ccSPCEst.toFixed(1)} SF/capita — ${ccBand.tone}` : ''}.${nearestPS != null ? ` Nearest PS family: ${nearestPS.toFixed(1)} mi.` : ' No PS family within 5 mi.'} <span style="color:rgba(201,168,76,0.7);font-size:10px">Save + audit for verified SpareFoot CC SPC.</span>` },
    { n: '04', title: 'The Verdict', text: `Storvex composite: ${composite.toFixed(2)}/10 — <strong style="color:${verdict.color}">${verdict.label}</strong>. ${allGatesPass ? 'All hard gates pass.' : `${gates.filter(g => !g.pass).length} hard gate(s) fail.`} ${ccSPCEst != null && ccSPCEst >= 5 ? `<strong style="color:#F59E0B">CC SPC ~${ccSPCEst.toFixed(1)} flags ${ccBand.label.toLowerCase()} — verify with full SpareFoot audit before LOI.</strong>` : ccSPCEst != null && ccSPCEst < 3 ? `CC underservice supports a strong rent thesis.` : `Competition profile within tolerance.`}` },
    { n: '05', title: 'The Recommendation', text: `Best-fit buyer: <strong style="color:${verdict.color}">${bestBuyer.name}</strong>. ${bestBuyer.why}. ${composite >= 7 ? 'Recommend full audit + pipeline submission.' : composite >= 5 ? 'Verify zoning + utilities before advancing.' : 'Pass — re-route to non-storage use or alternate buyer pool.'}` },
  ];

  return (
    <div style={{ background: 'linear-gradient(135deg, #0F1538 0%, #1E2761 55%, #0A1127 100%)', border: `1px solid ${verdict.color}40`, borderRadius: 16, padding: 0, marginBottom: 14, position: 'relative', overflow: 'hidden', boxShadow: `0 0 0 1px ${verdict.glow}, 0 24px 60px rgba(0,0,0,0.4)` }}>
      <style>{`
        @keyframes svxHeroIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes svxScorePulse { 0%,100% { transform: scale(1); filter: drop-shadow(0 0 12px ${verdict.glow}) } 50% { transform: scale(1.02); filter: drop-shadow(0 0 22px ${verdict.glow}) } }
        @keyframes svxRing { 0% { stroke-dashoffset: 314 } 100% { stroke-dashoffset: ${314 - (composite / 10) * 314} } }
        .svx-hero-fade { animation: svxHeroIn 320ms ease-out backwards }
        .svx-score-pulse { animation: svxScorePulse 2.8s ease-in-out infinite }
        .svx-bullet { animation: svxHeroIn 360ms ease-out backwards }
      `}</style>

      {/* Ambient glow */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'inherit', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: -80, right: -80, width: 320, height: 320, background: `radial-gradient(circle, ${verdict.glow}, transparent 70%)` }} />
        <div style={{ position: 'absolute', bottom: -60, left: -40, width: 240, height: 240, background: 'radial-gradient(circle, rgba(201,168,76,0.10), transparent 65%)' }} />
      </div>

      {/* Memo strip header */}
      <div className="svx-hero-fade" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid rgba(201,168,76,0.18)', background: 'rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #C9A84C, #E87A2E)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 11, fontFamily: "'Space Mono', monospace" }}>SVX</div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: '#C9A84C' }}>STORVEX VERDICT</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em' }}>EINSTEIN ENGINE · INSTITUTIONAL OPINION · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 16, background: allGatesPass ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)', border: `1px solid ${allGatesPass ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.35)'}` }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: allGatesPass ? '#22C55E' : '#F59E0B', boxShadow: `0 0 8px ${allGatesPass ? '#22C55E' : '#F59E0B'}` }} />
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: allGatesPass ? '#22C55E' : '#F59E0B' }}>{allGatesPass ? 'ALL HARD GATES PASS' : 'GATE REVIEW REQUIRED'}</span>
        </div>
      </div>

      {/* Score + verdict + best buyer */}
      <div className="svx-hero-fade" style={{ position: 'relative', display: 'grid', gridTemplateColumns: '180px 1fr 1fr', gap: 24, padding: '24px 28px', alignItems: 'center', animationDelay: '60ms' }}>
        {/* Score ring */}
        <div className="svx-score-pulse" style={{ position: 'relative', width: 140, height: 140, margin: '0 auto' }}>
          <svg width="140" height="140" viewBox="0 0 120 120" style={{ position: 'absolute', inset: 0 }}>
            <circle cx="60" cy="60" r="50" stroke="rgba(255,255,255,0.08)" strokeWidth="8" fill="none" />
            <circle cx="60" cy="60" r="50" stroke={verdict.color} strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray="314" style={{ strokeDashoffset: 314 - (composite / 10) * 314, transform: 'rotate(-90deg)', transformOrigin: '60px 60px', transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 900, color: verdict.color, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{composite.toFixed(1)}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.1em', marginTop: 2 }}>/ 10</div>
          </div>
        </div>

        {/* Verdict label + CC SPC */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.5)' }}>STORAGE SITE VERDICT</div>
          <div style={{ fontSize: 32, fontWeight: 900, color: verdict.color, letterSpacing: '-0.02em', marginTop: 4, lineHeight: 1.1 }}>{verdict.label}</div>
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(0,0,0,0.25)', borderRadius: 10, borderLeft: `3px solid ${ccBand.color}` }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.5)' }}>EST. CC SPC · 3-MI</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: ccBand.color, fontFamily: "'Space Mono', monospace" }}>{ccSPCEst != null ? ccSPCEst.toFixed(1) : '—'}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>SF / capita · {ccBand.label}</span>
            </div>
          </div>
        </div>

        {/* Best-fit buyer */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: 'rgba(255,255,255,0.5)' }}>BEST-FIT BUYER</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginTop: 4, lineHeight: 1.25 }}>{bestBuyer.name}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4, lineHeight: 1.5 }}>{bestBuyer.why}</div>
          <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {gates.map(g => (
              <span key={g.label} style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: g.pass ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: g.pass ? '#4CC982' : '#FCA5A5', border: `1px solid ${g.pass ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, letterSpacing: '0.04em' }}>{g.pass ? '✓' : '✕'} {g.label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* MARKET INTEL BAND — three institutional-RE money slots: rents (CC + DU
          + 5-yr forward), demographics (with CAGRs), competition (CC SPC now +
          2030 + mix). Each card source-stamped. This is the answer to "what
          does Radius+ show?" — same numbers, primary-source citations, plus
          a 5-yr CC rent projection Radius+ doesn't surface. Glance summary
          above the 5-beat thesis; the deeper CCSPCHeadline + Demographics
          panels still render below for the analyst-grade drill-down. */}
      <div className="svx-hero-fade" style={{ position: 'relative', padding: '0 28px 18px', animationDelay: '90ms' }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: '#C9A84C', marginBottom: 10, paddingTop: 18, borderTop: '1px solid rgba(201,168,76,0.18)' }}>MARKET INTEL · RENTS · DEMOGRAPHICS · COMPETITION</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {/* CARD 1 — MARKET RENTS */}
          {(() => {
            const liveCC = result.marketRents?.ccRent;
            const liveDU = result.marketRents?.duRent;
            const ccRent = liveCC != null ? liveCC : 1.45;
            const duRent = liveDU != null ? liveDU : 0.85;
            const ccProj5yr = ccRent * Math.pow(1.07, 5); // 7%/yr ECRI compound — institutional benchmark
            const rentSrc = liveCC != null ? 'SpareFoot live · 2026' : 'REIT-benchmark midpoint (no SpareFoot coverage)';
            return (
              <div style={{ background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(201,168,76,0.28)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: '#C9A84C', marginBottom: 8 }}>MARKET RENTS · CC + DRIVE-UP</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>CC ($/SF/MO)</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace", lineHeight: 1.1 }}>${ccRent.toFixed(2)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>DRIVE-UP</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: 'rgba(255,255,255,0.82)', fontFamily: "'Space Mono', monospace", lineHeight: 1.1 }}>${duRent.toFixed(2)}</div>
                  </div>
                </div>
                <div style={{ background: 'rgba(201,168,76,0.10)', borderRadius: 6, padding: '6px 10px', marginBottom: 6, border: '1px solid rgba(201,168,76,0.15)' }}>
                  <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.1em', fontWeight: 700 }}>CC 5-YR FORWARD · 7%/YR ECRI</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#E4CB7C', fontFamily: "'Space Mono', monospace", lineHeight: 1.2, marginTop: 2 }}>${ccProj5yr.toFixed(2)}/SF · +{(((ccProj5yr/ccRent) - 1) * 100).toFixed(0)}%</div>
                </div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic', letterSpacing: '0.04em' }}>Source: {rentSrc}</div>
              </div>
            );
          })()}

          {/* CARD 2 — DEMOGRAPHICS · ESRI 2025 */}
          {(() => {
            const hhiCAGR = metrics?.hhiGrowth ?? 0;
            const hh = r3?.TOTHH_CY || 0;
            return (
              <div style={{ background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(59,130,246,0.28)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: '#60A5FA', marginBottom: 8 }}>DEMOGRAPHICS · ESRI 2025 · 3-MI</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>POPULATION</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace", lineHeight: 1.1 }}>{pop.toLocaleString()}</div>
                    <div style={{ fontSize: 9, color: growth >= 1 ? '#4CC982' : growth >= 0 ? 'rgba(255,255,255,0.6)' : '#FCA5A5', marginTop: 2, fontWeight: 700 }}>{(growth >= 0 ? '+' : '') + growth.toFixed(1)}% CAGR</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>MEDIAN HHI</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace", lineHeight: 1.1 }}>${(hhi/1000).toFixed(0)}K</div>
                    <div style={{ fontSize: 9, color: hhiCAGR >= 1.5 ? '#4CC982' : 'rgba(255,255,255,0.6)', marginTop: 2, fontWeight: 700 }}>{(hhiCAGR >= 0 ? '+' : '') + hhiCAGR.toFixed(1)}% CAGR</div>
                  </div>
                </div>
                <div style={{ background: 'rgba(59,130,246,0.10)', borderRadius: 6, padding: '6px 10px', marginBottom: 6, border: '1px solid rgba(59,130,246,0.15)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.1em', fontWeight: 700 }}>HOUSEHOLDS</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#93BBFD', fontFamily: "'Space Mono', monospace" }}>{hh.toLocaleString()}</span>
                  </div>
                </div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic', letterSpacing: '0.04em' }}>Source: ESRI GeoEnrichment 2025 → 2030 projection</div>
              </div>
            );
          })()}

          {/* CARD 3 — COMPETITION · CC SPC
              Pipeline-aware 2030 projection: lookupPipelineSupply() returns
              status-weighted CC SF from the per-submarket registry (REIT
              10-Q / 8-K + permits). Falls through to flat-supply when the
              submarket has no pipeline disclosure yet. Audited-vs-computed
              row surfaces the calibration delta when an audited datapoint
              exists in the registry. */}
          {(() => {
            const popFY = r3?.TOTPOP_FY || pop;
            const proj = computeProjectedCCSPC(estCCSF, popFY, geo?.city, geo?.state);
            const cur = ccSPCEst;
            const projSPC = proj.projectedCCSPC;
            const projBand = projSPC == null ? ccBand
                          : projSPC < 1.5 ? { label: 'Severely Underserved', color: '#22C55E' }
                          : projSPC < 3 ? { label: 'Underserved', color: '#22C55E' }
                          : projSPC < 5 ? { label: 'Moderate', color: '#F59E0B' }
                          : projSPC < 7 ? { label: 'Well-Supplied', color: '#F59E0B' }
                          : { label: 'Oversupplied', color: '#EF4444' };
            const audit = lookupAuditedCCSPC(geo?.city, geo?.state);
            const cal = audit.matched ? calibrationDelta(audit.auditedCCSPC, cur) : null;
            const projMethod = proj.methodology === 'pipeline-aware'
              ? `pipeline-aware · ${Math.round(proj.pipelineCCSF / 1000)}K CC SF in-pipeline · ${proj.asOf}`
              : 'flat-supply default · submarket pending pipeline backfill';
            return (
              <div style={{ background: 'rgba(0,0,0,0.32)', border: `1px solid ${ccBand.color}55`, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: ccBand.color, marginBottom: 8 }}>COMPETITION · CC SPC · #1 METRIC</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>NOW (2025)</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace", lineHeight: 1.1 }}>{cur != null ? cur.toFixed(2) : '—'}</div>
                    <div style={{ fontSize: 9, color: ccBand.color, marginTop: 2, fontWeight: 700 }}>{ccBand.label}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>2030 PROJ</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: 'rgba(255,255,255,0.92)', fontFamily: "'Space Mono', monospace", lineHeight: 1.1 }}>{projSPC != null ? projSPC.toFixed(2) : '—'}</div>
                    <div style={{ fontSize: 9, color: projBand.color, marginTop: 2, fontWeight: 700 }}>{projBand.label}</div>
                  </div>
                </div>
                {/* Audited overlay — renders when registry has a non-null entry */}
                {audit.matched && audit.auditedCCSPC != null && (
                  <div style={{ background: 'rgba(34,197,94,0.10)', borderRadius: 6, padding: '6px 10px', marginBottom: 6, border: '1px solid rgba(34,197,94,0.25)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.65)', letterSpacing: '0.1em', fontWeight: 700 }}>AUDITED · {audit.auditYear} · {audit.auditSource}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#4CC982', fontFamily: "'Space Mono', monospace" }}>{audit.auditedCCSPC.toFixed(2)}{cal && cal.deltaPct != null ? ` · Δ ${(cal.deltaPct >= 0 ? '+' : '') + cal.deltaPct.toFixed(0)}%` : ''}</span>
                    </div>
                  </div>
                )}
                <div style={{ background: `${ccBand.color}14`, borderRadius: 6, padding: '6px 10px', marginBottom: 6, border: `1px solid ${ccBand.color}26` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.1em', fontWeight: 700 }}>3-MI MIX</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', fontFamily: "'Space Mono', monospace" }}>{ccConfident.length} CC · {mixed.length} mixed{psFamilyHits.length > 0 ? ` · ${psFamilyHits.length} PS` : ''}</span>
                  </div>
                </div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic', letterSpacing: '0.04em' }}>Source: Places + SpareFoot calibration · 2030 {projMethod}</div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* The Story — 5-bullet narrative arc */}
      <div className="svx-hero-fade" style={{ position: 'relative', padding: '0 28px 24px', animationDelay: '120ms' }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', color: '#C9A84C', marginBottom: 10, paddingTop: 18, borderTop: '1px solid rgba(201,168,76,0.18)' }}>THE STORY · STORAGE THESIS IN 5 BEATS</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {story.map((s, i) => (
            <div key={s.n} className="svx-bullet" style={{ display: 'grid', gridTemplateColumns: '32px 90px 1fr', gap: 12, padding: '8px 0', borderBottom: i < 4 ? '1px solid rgba(255,255,255,0.04)' : 'none', alignItems: 'baseline', animationDelay: `${180 + i * 50}ms` }}>
              <span style={{ fontSize: 11, fontWeight: 900, color: '#C9A84C', fontFamily: "'Space Mono', monospace" }}>{s.n}</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{s.title}</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.82)', lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: s.text }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DealFlow Oracle Shortlist Panel
// ─────────────────────────────────────────────────────────────────────────
// Renders the Top-7 matrix-ranked buyer shortlist with tier badge, deployment
// pressure, primary contact, pitch hook, and copy-to-clipboard. Surfaces the
// matrix data alongside the standard Quick Lookup output so address-in →
// ranked buyer shortlist is a single-screen experience.
// ═══════════════════════════════════════════════════════════════════════════
function MatrixShortlistPanel({ shortlist, matrixVersion, matrixOperatorCount, geo, fbPush }) {
  const card = { background: 'rgba(15,21,56,0.5)', border: '1px solid rgba(201,168,76,0.35)', borderRadius: 14, padding: 20, marginBottom: 14, borderLeft: '3px solid #C9A84C' };
  const label = { fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(201,168,76,0.85)', marginBottom: 6 };
  const tierColors = {
    TIER_1_HOT_CAPITAL: { bg: 'linear-gradient(90deg, #DC2626, #991B1B)', label: '🔴 TIER 1 · HOT CAPITAL' },
    TIER_2_ACTIVE: { bg: 'linear-gradient(90deg, #EA580C, #9A3412)', label: '🟠 TIER 2 · ACTIVE' },
    TIER_3_MEDIUM: { bg: 'linear-gradient(90deg, #CA8A04, #854D0E)', label: '🟡 TIER 3 · MEDIUM' },
    TIER_4_SELECTIVE: { bg: 'linear-gradient(90deg, #059669, #064E3B)', label: '🟢 TIER 4 · SELECTIVE' },
    TIER_5_HYPER_LOCAL: { bg: 'linear-gradient(90deg, #2563EB, #1E3A8A)', label: '🔵 TIER 5 · LOCAL' }
  };
  const copyHook = (text) => {
    if (!text) return;
    try { navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };

  // Log every matrix pitch click to Firebase /pitchLog/ — compound learning loop.
  // Every response (YES/NO/COUNTER/SILENT) becomes a training datum that sharpens
  // the matrix's tier + deployment pressure + hard_nos fields over time.
  const logMatrixPitch = (op, contact) => {
    if (!fbPush) return;
    try {
      fbPush('pitchLog', {
        siteAddress: geo?.formatted || '',
        city: geo?.city || '',
        state: geo?.state || '',
        lat: geo?.lat,
        lon: geo?.lng,
        operator: op.key,
        operatorTier: op.tier,
        matrixRank: op.hotCapitalRank,
        deploymentPressure: op.uwProfile?.deploymentPressure || null,
        matrixScore: Math.round(op.score || 0),
        contactName: contact?.name || '',
        contactEmail: contact?.email || '',
        contactPhone: contact?.phone || null,
        cc: Array.isArray(contact?.cc) ? contact.cc : [],
        pitchHookPreview: (op.pitchHook || '').slice(0, 200),
        matrixVersion: matrixVersion || 'unknown',
        pitchedAt: new Date().toISOString(),
        source: 'dealflow-oracle-shortlist'
      });
    } catch { /* silent — log shouldn't block pitch */ }
  };

  // Build Gmail compose URL with matrix contact + matrix-specific pitch hook.
  // Top-of-funnel pitch — institutional framing + Storvex deep-link + operator
  // pitch hook from Part 13. No cost stack (YOC calculator downstream handles that).
  const buildMatrixPitch = (op) => {
    const primary = op.contacts?.primary;
    if (!primary?.email) return null;
    const firstName = (primary.name || 'Team').split(' ')[0];
    const cityState = `${geo?.city || 'Site'}, ${geo?.state || ''}`.trim();
    const subject = `Off-market opportunity — ${cityState}${op.tier === 'TIER_1_HOT_CAPITAL' ? ' · institutional-grade pad site' : ''}`;
    const pitchHookLine = op.pitchHook ? op.pitchHook.replace(/\[specific site\]|\[site\]|\[matching site\]/gi, cityState).replace(/\[([^\]]+)\]/g, '$1') : '';
    const pin = geo?.lat && geo?.lng ? `https://www.google.com/maps?q=${geo.lat},${geo.lng}` : '';
    const storvexLink = geo?.formatted ? `https://storvex.vercel.app/?addr=${encodeURIComponent(geo.formatted)}` : 'https://storvex.vercel.app';
    const body = [
      `${firstName},`,
      ``,
      pitchHookLine,
      ``,
      `${geo?.formatted || 'Site address'}`,
      pin ? `Pin: ${pin}` : '',
      ``,
      `Full institutional report (ESRI demographics · REIT proximity · CC SPC · operator-calibrated YOC):`,
      storvexLink,
      ``,
      `Available to discuss — please advise interest.`,
      ``,
      `Best,`,
      `Daniel P. Roscoe`,
      `E: Droscoe@DJRrealestate.com`,
      `C: 312-805-5996`
    ].filter(Boolean).join('\n');
    const url = buildGmailComposeUrl({ to: primary.email, cc: op.contacts?.cc || [], subject, body });
    return { url, contact: primary, log: () => logMatrixPitch(op, primary) };
  };

  const firePitch = (op) => {
    const p = buildMatrixPitch(op);
    if (!p) return;
    p.log();
    window.open(p.url, '_blank');
  };
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={label}>⚡ DEALFLOW ORACLE · RANKED BUYER SHORTLIST</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Top {shortlist.length} of {matrixOperatorCount} operators · ranked by tier + deployment pressure + geography</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>Matrix {matrixVersion || '—'} · proprietary routing intelligence · primary-source verified</div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {shortlist.map((op, i) => {
          const tc = tierColors[op.tier] || { bg: 'linear-gradient(90deg, #374151, #1F2937)', label: op.tier };
          const primary = op.contacts?.primary;
          const deployment = op.uwProfile?.deploymentPressure || op.capital?.deploymentPressure;
          return (
            <div key={op.key} style={{ background: 'rgba(0,0,0,0.3)', padding: 14, borderRadius: 10, border: '1px solid rgba(201,168,76,0.12)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 900, color: '#C9A84C', minWidth: 24 }}>#{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{op.key}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
                      {op.firmographics?.type || '—'} · {op.firmographics?.hq || '—'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ background: tc.bg, color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 800, letterSpacing: '0.08em' }}>{tc.label}</span>
                  {deployment && <span style={{ background: 'rgba(201,168,76,0.18)', color: '#C9A84C', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 700 }}>{deployment}</span>}
                  <span style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 700 }}>score {Math.round(op.score)}</span>
                </div>
              </div>
              {primary && (
                <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>
                  <span style={{ color: 'rgba(201,168,76,0.9)', fontWeight: 700 }}>Primary:</span> {primary.name}{primary.title ? ` · ${primary.title}` : ''}
                  {primary.email && <span style={{ color: '#4CC982', marginLeft: 6 }}>{primary.email}</span>}
                  {primary.phone && <span style={{ color: 'rgba(255,255,255,0.55)', marginLeft: 6 }}>· {primary.phone}</span>}
                  {primary.emailConfidence && <span style={{ marginLeft: 6, fontSize: 9, padding: '2px 6px', borderRadius: 4, background: primary.emailConfidence.includes('HIGH') ? 'rgba(34,197,94,0.2)' : primary.emailConfidence.includes('MEDIUM') ? 'rgba(234,179,8,0.2)' : 'rgba(239,68,68,0.2)', color: primary.emailConfidence.includes('HIGH') ? '#4CC982' : primary.emailConfidence.includes('MEDIUM') ? '#FBBF24' : '#F87171' }}>{primary.emailConfidence}</span>}
                </div>
              )}
              {op.pitchHook && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5, fontStyle: 'italic', paddingLeft: 10, borderLeft: '2px solid rgba(201,168,76,0.3)' }}>
                  "{op.pitchHook}"
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', fontStyle: 'normal' }}>
                    {primary?.email && (
                      <button onClick={() => firePitch(op)} style={{ padding: '6px 14px', fontSize: 10, fontWeight: 800, background: 'linear-gradient(135deg, #C9A84C, #A88A3A)', color: '#0B0D1E', border: 'none', borderRadius: 6, cursor: 'pointer', letterSpacing: '0.06em' }}>📧 PITCH THIS SITE</button>
                    )}
                    <button onClick={() => copyHook(op.pitchHook)} style={{ padding: '6px 12px', fontSize: 9, fontWeight: 700, background: 'rgba(201,168,76,0.18)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 6, cursor: 'pointer' }}>COPY HOOK</button>
                  </div>
                </div>
              )}
              {op.operationalFlag && (
                <div style={{ marginTop: 8, fontSize: 10, color: '#FBBF24', background: 'rgba(234,179,8,0.1)', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(234,179,8,0.3)' }}>⚠️ {op.operationalFlag}</div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12, fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', textAlign: 'right' }}>
        PATENT-PENDING · DJR DealFlow Oracle™ · compounding learning from every pitch response
      </div>
    </div>
  );
}

function ResultsView({ result, saveToFirebase, fbPush }) {
  const { geo, r3, r1, r5, competitors, metrics, elapsed } = result;
  const label = { fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(201,168,76,0.85)', marginBottom: 6 };
  const card = { background: 'rgba(15,21,56,0.5)', border: '1px solid rgba(201,168,76,0.12)', borderRadius: 14, padding: 20, marginBottom: 14 };
  const sourceLink = { fontSize: 9, color: '#4CC982', textDecoration: 'none', marginLeft: 6 };
  const linkBtn = (url, txt) => <a href={url} target="_blank" rel="noopener noreferrer" style={sourceLink}>↗ {txt}</a>;
  const esriViewerUrl = `https://www.arcgis.com/apps/mapviewer/index.html?center=${geo.lng},${geo.lat}&level=13`;
  const googleMapsUrl = `https://www.google.com/maps/@${geo.lat},${geo.lng},15z`;

  // ─── CC SPC (the competition headline — Radius doesn't publish this) ───
  const ccSPC = computeCCSPC(competitors, r3?.TOTPOP_CY, r3?.TOTPOP_FY);

  return (
    <>
      {/* STORVEX VERDICT HERO — institutional one-glance opinion */}
      <StorvexVerdictHero result={result} />

      {/* CC SPC HEADLINE — climate-controlled SF per capita, current + 5-yr projected */}
      <CCSPCHeadline ccSPC={ccSPC} r3={r3} competitors={competitors} />

      {/* ZONING ORACLE — Municode/ecode360 permitted use table extraction via Claude Haiku */}
      {(result.zoningStatus === 'pending' || result.zoningStatus === 'retrying' || result.zoningIntel) && (
        <ZoningOraclePanel
          zoningIntel={result.zoningIntel}
          zoningStatus={result.zoningStatus}
          jurisdiction={`${geo.city || ''}, ${geo.state || ''}`.replace(/^, /, '')}
        />
      )}

      {/* UTILITY ORACLE — water/sewer/electric provider + hookup status via Claude Haiku */}
      {(result.utilityStatus === 'pending' || result.utilityStatus === 'retrying' || result.utilityIntel) && (
        <UtilityOraclePanel
          utilityIntel={result.utilityIntel}
          utilityStatus={result.utilityStatus}
          jurisdiction={`${geo.city || ''}, ${geo.state || ''}`.replace(/^, /, '')}
        />
      )}

      {/* ACCESS ORACLE — VPD + frontage + signalization + decel lane risk via Claude Haiku */}
      {(result.accessStatus === 'pending' || result.accessStatus === 'retrying' || result.accessIntel) && (
        <AccessOraclePanel
          accessIntel={result.accessIntel}
          accessStatus={result.accessStatus}
          jurisdiction={`${geo.city || ''}, ${geo.state || ''}`.replace(/^, /, '')}
        />
      )}

      {/* LOCATION + PERFORMANCE */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={label}>SUBJECT LOCATION</div>
              {result._fromCache && (
                <span
                  title={`Served from localStorage cache · ${result._cacheAgeHours}h old · TTL 24h · click Run Market Report again or wait for cache to expire for fresh data`}
                  style={{ background: 'linear-gradient(135deg, #10B981, #059669)', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 8, fontWeight: 900, letterSpacing: '0.1em' }}
                >
                  🔋 CACHED · {result._cacheAgeHours}h
                </span>
              )}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{geo.formatted}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
              📍 {geo.lat.toFixed(4)}, {geo.lng.toFixed(4)} · {geo.county || '—'}
              {linkBtn(googleMapsUrl, 'Google Maps')}
              {linkBtn(esriViewerUrl, 'ESRI Viewer')}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={label}>REPORT RUNTIME</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#4CC982', fontFamily: "'Space Mono', monospace" }}>{parseFloat(elapsed) < 1 ? '<1s' : `${elapsed}s`}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{parseFloat(elapsed) < 1 ? 'cached · ESRI + Places + geocode' : 'ESRI + Places + geocode (parallel)'}</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => openPDFPreview(result)} style={{ padding: '12px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #DC2626, #991B1B)', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.05em' }}>
              📄 PREVIEW PDF
            </button>
            <button onClick={() => shareURL(result)} style={{ padding: '12px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #3B82F6, #1E3A8A)', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.05em' }}>
              🔗 COPY LINK
            </button>
            <button onClick={saveToFirebase} style={{ padding: '12px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #22C55E, #16A34A)', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.05em' }}>
              💾 SAVE + FULL AUDIT
            </button>
          </div>
        </div>
      </div>

      {/* DEMOGRAPHICS BIG NUMBERS */}
      <div style={card}>
        <div style={label}>DEMOGRAPHICS · ESRI 2025–2030 · 3-MI RADIAL RING {linkBtn(esriViewerUrl, 'ESRI GeoEnrichment Source')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 10 }}>
          <div><div style={label}>POPULATION</div><div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{r3?.TOTPOP_CY?.toLocaleString() || '—'}</div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>{metrics.popGrowth != null ? `${metrics.popGrowth >= 0 ? '+' : ''}${metrics.popGrowth.toFixed(2)}% 5-yr CAGR` : '—'}</div></div>
          <div><div style={label}>MEDIAN HHI</div><div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>${r3?.MEDHINC_CY?.toLocaleString() || '—'}</div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>{metrics.hhiGrowth != null ? `${metrics.hhiGrowth.toFixed(2)}% CAGR` : '—'}</div></div>
          <div><div style={label}>HOUSEHOLDS</div><div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{r3?.TOTHH_CY?.toLocaleString() || '—'}</div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>Renter {metrics.renterPct?.toFixed(0) || '—'}% · Vacancy {metrics.vacancyPct?.toFixed(1) || '—'}%</div></div>
          <div><div style={label}>MEDIAN HOME VALUE</div><div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>${r3?.MEDVAL_CY?.toLocaleString() || '—'}</div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>Avg ${r3?.AVGVAL_CY?.toLocaleString() || '—'}</div></div>
        </div>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8 }}>
            <div style={label}>PEAK STORAGE AGE (25-44 + 55-74)</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#C9A84C' }}>{metrics.peakPct?.toFixed(1) || '—'}%</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>family formation + downsizers</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8 }}>
            <div style={label}>HH $75K+</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#C9A84C' }}>{metrics.hhOver75Pct?.toFixed(1) || '—'}%</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>CC storage affordability</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8 }}>
            <div style={label}>COLLEGE EDUCATED</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#C9A84C' }}>{metrics.collegePct?.toFixed(1) || '—'}%</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>correlates with CC propensity</div>
          </div>
        </div>
      </div>

      {/* DEALFLOW ORACLE — MATRIX-RANKED BUYER SHORTLIST */}
      {Array.isArray(result.matrixShortlist) && result.matrixShortlist.length > 0 && (
        <MatrixShortlistPanel
          shortlist={result.matrixShortlist}
          matrixVersion={result.matrixVersion}
          matrixOperatorCount={result.matrixOperatorCount}
          geo={geo}
          fbPush={fbPush}
        />
      )}

      {/* NATIONAL PERCENTILE BENCHMARKS + YIELD-ON-COST CALCULATOR */}
      <PercentileAndYOCCard r3={r3} competitors={competitors} geo={geo} result={result} fbPush={fbPush} />

      {/* TAPESTRY */}
      {r3?.TSEGNAME && (
        <div style={card}>
          <div style={label}>TAPESTRY SEGMENTATION · BEHAVIORAL CLUSTER · 3-MI {linkBtn('https://www.esri.com/en-us/arcgis/products/data/data-portfolio/tapestry-segmentation', 'ESRI Tapestry')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <div style={{ background: 'linear-gradient(135deg, #C9A84C, #E4CB7C)', color: '#1E2761', padding: '10px 18px', borderRadius: 8, fontSize: 16, fontWeight: 900, letterSpacing: '0.02em' }}>
              {r3.TSEGNAME}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
              Dominant psychographic cluster in this submarket. Shapes storage demand profile — family formation cohorts lean drive-up, empty-nester/downsizer cohorts lean CC, professional cohorts lean CC premium.
            </div>
          </div>
        </div>
      )}

      {/* MULTI-RING DEMOGRAPHICS */}
      <div style={card}>
        <div style={label}>1-MI · 3-MI · 5-MI RING COMPARISON</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 10 }}>
          <thead>
            <tr style={{ color: 'rgba(201,168,76,0.85)', fontSize: 10, letterSpacing: '0.08em' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>METRIC</th>
              <th style={{ textAlign: 'right', padding: 8 }}>1-MILE</th>
              <th style={{ textAlign: 'right', padding: 8 }}>3-MILE</th>
              <th style={{ textAlign: 'right', padding: 8 }}>5-MILE</th>
            </tr>
          </thead>
          <tbody style={{ color: '#fff' }}>
            <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}><td style={{ padding: 8 }}>Population</td><td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>{r1?.TOTPOP_CY?.toLocaleString() || '—'}</td><td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>{r3?.TOTPOP_CY?.toLocaleString() || '—'}</td><td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>{r5?.TOTPOP_CY?.toLocaleString() || '—'}</td></tr>
            <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}><td style={{ padding: 8 }}>Households</td><td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>{r1?.TOTHH_CY?.toLocaleString() || '—'}</td><td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>{r3?.TOTHH_CY?.toLocaleString() || '—'}</td><td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>{r5?.TOTHH_CY?.toLocaleString() || '—'}</td></tr>
            <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}><td style={{ padding: 8 }}>Median HHI</td><td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>${r1?.MEDHINC_CY?.toLocaleString() || '—'}</td><td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>${r3?.MEDHINC_CY?.toLocaleString() || '—'}</td><td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>${r5?.MEDHINC_CY?.toLocaleString() || '—'}</td></tr>
            <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}><td style={{ padding: 8 }}>Median Home Value</td><td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>${r1?.MEDVAL_CY?.toLocaleString() || '—'}</td><td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>${r3?.MEDVAL_CY?.toLocaleString() || '—'}</td><td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>${r5?.MEDVAL_CY?.toLocaleString() || '—'}</td></tr>
          </tbody>
        </table>
      </div>

      {/* REIT PRESENCE — "We Already Know Them" institutional knowledge panel */}
      {(result.reit5mi || []).length > 0 && (() => {
        const byBrand = {};
        for (const loc of result.reit5mi) {
          if (!byBrand[loc.brand]) byBrand[loc.brand] = { count: 0, nearest: Infinity, facilities: [] };
          byBrand[loc.brand].count++;
          byBrand[loc.brand].nearest = Math.min(byBrand[loc.brand].nearest, loc.distanceMi);
          byBrand[loc.brand].facilities.push(loc);
        }
        const reit3Count = (result.reit3mi || []).length;
        return (
          <div style={{ ...card, background: 'linear-gradient(135deg, rgba(249,115,22,0.08), rgba(30,39,97,0.6))', border: '1px solid rgba(249,115,22,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ background: 'linear-gradient(135deg, #F97316, #EA580C)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>REIT PRESENCE · WE ALREADY KNOW THEM</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>
                {result.reit5mi.length} facilities within 5 mi · {reit3Count} within 3 mi · source: Storvex Authoritative Registry ({result.registryRecordCount.toLocaleString()} indexed locations)
              </div>
            </div>
            {Object.entries(byBrand).map(([brand, info]) => {
              const intel = getOperatorIntel(brand);
              return (
                <div key={brand} style={{ background: 'rgba(0,0,0,0.28)', borderRadius: 10, padding: 16, marginBottom: 10, borderLeft: '3px solid #F97316' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: '#F97316' }}>
                      {brand}
                      {intel?.ticker && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginLeft: 8, fontWeight: 600 }}>({intel.ticker})</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#fff' }}>
                      <b style={{ color: '#C9A84C' }}>{info.count}</b> facility{info.count !== 1 ? 'ies' : ''} · nearest <b>{info.nearest} mi</b>
                    </div>
                  </div>
                  {intel ? (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>
                        {intel.type && <div><b style={{ color: '#C9A84C' }}>Type:</b> {intel.type}</div>}
                        {intel.portfolioSize && <div><b style={{ color: '#C9A84C' }}>Portfolio:</b> {intel.portfolioSize}</div>}
                        {intel.nationalSF && <div><b style={{ color: '#C9A84C' }}>National SF:</b> {intel.nationalSF}</div>}
                        {intel.noiMargin && <div><b style={{ color: '#C9A84C' }}>NOI Margin:</b> {intel.noiMargin}</div>}
                        {intel.revenuePerSF && <div><b style={{ color: '#C9A84C' }}>Rev/SF:</b> {intel.revenuePerSF}</div>}
                        {intel.stabilizedRevPerSF && <div><b style={{ color: '#C9A84C' }}>Stab. Rev/SF:</b> {intel.stabilizedRevPerSF}</div>}
                        {intel.acquisitionCap && <div><b style={{ color: '#C9A84C' }}>Acq. Cap:</b> {intel.acquisitionCap}</div>}
                        {intel.stabilizedOccupancy && <div><b style={{ color: '#C9A84C' }}>Stab. Occ.:</b> {intel.stabilizedOccupancy}</div>}
                        {intel.ecriProgram && <div><b style={{ color: '#C9A84C' }}>ECRI:</b> {intel.ecriProgram}</div>}
                        {intel.acquisitionVolume2024 && <div><b style={{ color: '#C9A84C' }}>'24 Volume:</b> {intel.acquisitionVolume2024}</div>}
                        {intel.rateTargets && <div style={{ gridColumn: '1 / -1' }}><b style={{ color: '#C9A84C' }}>Rate Targets:</b> {intel.rateTargets}</div>}
                        {intel.expansionFocus && <div style={{ gridColumn: '1 / -1' }}><b style={{ color: '#C9A84C' }}>Expansion:</b> {intel.expansionFocus}</div>}
                        {intel.keyContacts && <div style={{ gridColumn: '1 / -1' }}><b style={{ color: '#C9A84C' }}>Contacts:</b> {intel.keyContacts}</div>}
                        {intel.source10K && <div style={{ gridColumn: '1 / -1', fontSize: 9 }}><a href={intel.source10K} target="_blank" rel="noopener noreferrer" style={{ color: '#4CC982' }}>↗ SEC 10-K filings ({intel.ticker})</a></div>}
                        {intel.note && <div style={{ gridColumn: '1 / -1', marginTop: 4, padding: 8, background: 'rgba(249,115,22,0.1)', borderRadius: 6, fontSize: 10, color: '#FED7AA' }}>⚠ {intel.note}</div>}
                      </div>
                      {/* LEASE-UP PLAYBOOK — "We know the secret sauce." */}
                      {intel.playbookTier && LEASE_UP_PLAYBOOK[intel.playbookTier] && (() => {
                        const pb = LEASE_UP_PLAYBOOK[intel.playbookTier];
                        return (
                          <div style={{ marginTop: 14, padding: 12, background: 'linear-gradient(135deg, rgba(201,168,76,0.08), rgba(30,39,97,0.45))', borderRadius: 8, border: '1px solid rgba(201,168,76,0.25)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                              <span style={{ background: 'linear-gradient(135deg, #C9A84C, #E8C974)', color: '#1E2761', padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 900, letterSpacing: '0.12em' }}>LEASE-UP PLAYBOOK</span>
                              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', letterSpacing: '0.08em' }}>{pb.label}</span>
                              <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(201,168,76,0.85)', fontStyle: 'italic' }}>"Start low, ease up, jack in Y5 via ECRI"</span>
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, color: 'rgba(255,255,255,0.82)' }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid rgba(201,168,76,0.3)' }}>
                                    <th style={{ padding: 6, textAlign: 'left', color: '#C9A84C', fontWeight: 700 }}>YEAR</th>
                                    <th style={{ padding: 6, textAlign: 'center', color: '#C9A84C', fontWeight: 700 }}>OCC</th>
                                    <th style={{ padding: 6, textAlign: 'center', color: '#C9A84C', fontWeight: 700 }}>RENT IDX</th>
                                    <th style={{ padding: 6, textAlign: 'center', color: '#C9A84C', fontWeight: 700 }}>PHASE</th>
                                    <th style={{ padding: 6, textAlign: 'left', color: '#C9A84C', fontWeight: 700 }}>EXECUTION</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pb.rentCurve.map((y, idx) => {
                                    const phaseColor = y.phase === 'LEASE-UP' ? '#EF4444' : y.phase === 'RAMP' ? '#F59E0B' : y.phase === 'STABILIZED' ? '#3B82F6' : '#10B981';
                                    return (
                                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        <td style={{ padding: 6, fontWeight: 800, color: '#C9A84C' }}>{y.year}</td>
                                        <td style={{ padding: 6, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{y.occ}</td>
                                        <td style={{ padding: 6, textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                                          <span style={{ background: 'rgba(201,168,76,0.15)', padding: '1px 6px', borderRadius: 3 }}>{y.rentIndex.toFixed(2)}x</span>
                                        </td>
                                        <td style={{ padding: 6, textAlign: 'center' }}>
                                          <span style={{ background: phaseColor, color: '#fff', padding: '1px 6px', borderRadius: 3, fontSize: 8, fontWeight: 900, letterSpacing: '0.08em' }}>{y.phase}</span>
                                        </td>
                                        <td style={{ padding: 6, fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>{y.note}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, fontSize: 10 }}>
                              <div style={{ background: 'rgba(0,0,0,0.25)', padding: 6, borderRadius: 4 }}>
                                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>ECRI CADENCE</div>
                                <div style={{ color: '#fff', fontWeight: 700 }}>{pb.ecriRate}</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.25)', padding: 6, borderRadius: 4 }}>
                                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>OCC TARGET</div>
                                <div style={{ color: '#fff', fontWeight: 700 }}>{pb.occupancyTarget}</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.25)', padding: 6, borderRadius: 4 }}>
                                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>MATURE NOI</div>
                                <div style={{ color: '#4CC982', fontWeight: 700 }}>{pb.noiMarginMature}</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.25)', padding: 6, borderRadius: 4 }}>
                                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>STAB. MONTHS</div>
                                <div style={{ color: '#fff', fontWeight: 700 }}>{pb.stabilizationMonths} mo</div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  ) : (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>No institutional profile indexed for this brand yet.</div>
                  )}
                  <div style={{ marginTop: 10, fontSize: 9, color: 'rgba(255,255,255,0.45)' }}>
                    Nearest facility: <a href={`https://www.google.com/maps/search/${encodeURIComponent(info.facilities[0].name + ' ' + info.facilities[0].address)}`} target="_blank" rel="noopener noreferrer" style={{ color: '#4CC982' }}>{info.facilities[0].name}</a> — {info.facilities[0].address}, {info.facilities[0].city}, {info.facilities[0].state}
                  </div>
                </div>
              );
            })}
            <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
              Intelligence surfaced from: PSA/EXR/CUBE/NSA 10-K + 10-Q SEC filings · industry press · Dan R. direct operator relationships · Storvex location registry (updated quarterly).
            </div>
          </div>
        );
      })()}

      {/* INTERACTIVE MAP */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={label}>INTERACTIVE MAP · SUBJECT + COMPETITORS + PS FAMILY · 3-MI + 5-MI RINGS</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 10, color: 'rgba(255,255,255,0.65)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: '50%', background: '#C9A84C', boxShadow: '0 0 8px #C9A84C' }}/>Subject</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#F97316' }}/>Public REIT</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#8B5CF6' }}/>Regional Chain</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#3B82F6' }}/>Local/Independent</div>
          </div>
        </div>
        <div style={{ height: 420, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(201,168,76,0.25)' }}>
          <MapContainer center={[geo.lat, geo.lng]} zoom={13} scrollWheelZoom={true} style={{ width: '100%', height: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com">Carto</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            {/* 3-mi + 5-mi circles */}
            <Circle center={[geo.lat, geo.lng]} radius={3 * 1609.34} pathOptions={{ color: '#C9A84C', weight: 2, opacity: 0.6, fillOpacity: 0.04, fillColor: '#C9A84C', dashArray: '5,5' }} />
            <Circle center={[geo.lat, geo.lng]} radius={5 * 1609.34} pathOptions={{ color: '#64748B', weight: 1, opacity: 0.35, fillOpacity: 0, dashArray: '3,6' }} />
            {/* Subject marker */}
            <Marker position={[geo.lat, geo.lng]} icon={SUBJECT_ICON}>
              <Popup>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#1E2761' }}>Subject Site</div>
                <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>{geo.formatted}</div>
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 6 }}>{geo.lat.toFixed(4)}, {geo.lng.toFixed(4)}</div>
              </Popup>
            </Marker>
            {/* Competitor + PS Family markers */}
            {competitors.filter(c => c.lat && c.lng).map((c, i) => {
              const op = classifyOperator(c.name);
              const tierColor = op.tier === 'reit' ? '#9A3412' : op.tier === 'regional' ? '#6D28D9' : '#1E2761';
              return (
                <Marker key={c.id || i} position={[c.lat, c.lng]} icon={iconForOperator(op.tier)}>
                  <Popup>
                    <div style={{ fontWeight: 700, fontSize: 13, color: tierColor }}>
                      <span style={{ background: op.tier === 'reit' ? '#F97316' : op.tier === 'regional' ? '#8B5CF6' : '#3B82F6', color: '#fff', padding: '1px 6px', borderRadius: 3, fontSize: 9, marginRight: 6, letterSpacing: '0.08em', fontWeight: 900 }}>{op.tierLabel.toUpperCase()}</span>
                      {op.psFamily && <span style={{ background: '#1E2761', color: '#C9A84C', padding: '1px 6px', borderRadius: 3, fontSize: 9, marginRight: 6, letterSpacing: '0.08em', fontWeight: 900 }}>PS FAM</span>}
                      {c.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>{c.address || ''}</div>
                    <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 4 }}>Distance: <b>{c.distanceMi} mi</b></div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, fontSize: 10 }}>
                      {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" style={{ color: '#3B82F6' }}>↗ Website</a>}
                      <a href={`https://www.google.com/maps/search/${encodeURIComponent(c.name + ' ' + (c.address || ''))}`} target="_blank" rel="noopener noreferrer" style={{ color: '#3B82F6' }}>↗ Google Maps</a>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
            <FitBounds subject={{ lat: geo.lat, lng: geo.lng }} points={competitors.filter(c => c.lat && c.lng)} />
          </MapContainer>
        </div>
        {(() => {
          const psFam = competitors.filter(c => tagPSFamily(c.name) === 'ps-family').length;
          const realComp = competitors.length - psFam;
          return (
            <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.65)', display: 'flex', gap: 16 }}>
              <div><b style={{ color: '#fff' }}>{realComp}</b> competitors within 3 mi</div>
              {psFam > 0 && <div><b style={{ color: '#F97316' }}>{psFam}</b> PS Family facility{psFam !== 1 ? 'ies' : ''} (excluded per §6b)</div>}
            </div>
          );
        })()}
      </div>

      {/* COMPETITORS */}
      <div style={card}>
        <div style={label}>COMPETITORS WITHIN 3 MI · PLACES API · {competitors.length} FACILITIES {linkBtn('https://developers.google.com/maps/documentation/places/web-service/overview', 'Places API Source')}</div>
        {competitors.length === 0 ? (
          <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>No self-storage facilities found within 3 mi (or filter rejected all results).</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 10 }}>
            <thead>
              <tr style={{ color: 'rgba(201,168,76,0.85)', fontSize: 10, letterSpacing: '0.08em' }}>
                <th style={{ textAlign: 'left', padding: 8 }}>FACILITY</th>
                <th style={{ textAlign: 'right', padding: 8 }}>DISTANCE</th>
                <th style={{ textAlign: 'left', padding: 8 }}>ADDRESS</th>
                <th style={{ textAlign: 'left', padding: 8 }}>LINKS</th>
              </tr>
            </thead>
            <tbody style={{ color: '#fff' }}>
              {competitors.map((c, i) => {
                const isPS = tagPSFamily(c.name) === 'ps-family';
                return (
                  <tr key={c.id} style={{ background: isPS ? 'rgba(249,115,22,0.08)' : (i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent'), borderLeft: isPS ? '3px solid #F97316' : 'none' }}>
                    <td style={{ padding: 8, fontWeight: 700 }}>
                      {isPS && <span style={{ background: '#F97316', color: '#fff', padding: '1px 6px', borderRadius: 3, fontSize: 8, marginRight: 6, letterSpacing: '0.08em', fontWeight: 900 }}>PS FAM</span>}
                      {c.name}
                    </td>
                    <td style={{ textAlign: 'right', padding: 8, fontFamily: "'Space Mono'" }}>{c.distanceMi} mi</td>
                    <td style={{ padding: 8, fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>{c.address}</td>
                    <td style={{ padding: 8, fontSize: 10 }}>
                      <a href={`https://www.google.com/maps/search/${encodeURIComponent(c.name)}`} target="_blank" rel="noopener noreferrer" style={{ color: '#4CC982', marginRight: 8, textDecoration: 'none' }}>↗ Maps</a>
                      {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" style={{ color: '#4CC982', textDecoration: 'none' }}>↗ Site</a>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* EINSTEIN NARRATIVE */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ background: 'linear-gradient(135deg, #C9A84C, #E4CB7C)', color: '#1E2761', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>STORVEX EINSTEIN</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>
            {result.narrativeStatus === 'pending' && '⏳ Connecting to Claude Haiku 4.5 SSE stream...'}
            {result.narrativeStatus === 'streaming' && <span style={{ color: '#4CC982' }}>🔴 LIVE · streaming tokens from Claude Haiku 4.5 <span style={{ animation: 'blink 1s infinite', display: 'inline-block' }}>▊</span></span>}
            {result.narrativeStatus === 'done' && result.narrative?.elapsedMs && `✓ Streamed in ${(result.narrative.elapsedMs/1000).toFixed(1)}s`}
            {result.narrativeStatus === 'error' && '⚠ Narrative unavailable'}
          </div>
        </div>
        {result.narrativeStatus === 'pending' && (
          <div style={{ padding: 20, background: 'rgba(201,168,76,0.08)', border: '1px dashed rgba(201,168,76,0.3)', borderRadius: 10, color: 'rgba(255,255,255,0.6)', fontSize: 12, fontStyle: 'italic' }}>
            Einstein is synthesizing across Tapestry segment + demographics + competitor set + income distribution → institutional-grade investment memo + anomaly flags + buyer pitch email. Streaming word-by-word...
          </div>
        )}
        {result.narrativeStatus === 'error' && (
          <div style={{ padding: 14, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, fontSize: 11, color: '#FCA5A5' }}>
            {result.narrativeError || 'Narrative endpoint error. See console for details.'}
          </div>
        )}
        {(result.narrativeStatus === 'done' || result.narrativeStatus === 'streaming') && result.narrative && (
          <>
            {result.narrative.executiveSummary && (
              <div style={{ marginBottom: 16 }}>
                <div style={label}>EXECUTIVE SUMMARY</div>
                <div style={{ fontSize: 12, lineHeight: 1.8, color: 'rgba(255,255,255,0.88)', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: result.narrative.executiveSummary.replace(/\*\*(.*?)\*\*/g, '<b style="color:#C9A84C">$1</b>') }} />
              </div>
            )}
            {result.narrative.investmentMemoLong && (
              <div style={{ marginBottom: 16 }}>
                <div style={label}>INVESTMENT MEMO · LONG-FORM</div>
                <div style={{ fontSize: 11.5, lineHeight: 1.7, color: 'rgba(255,255,255,0.82)', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: result.narrative.investmentMemoLong.replace(/\*\*(.*?)\*\*/g, '<b style="color:#C9A84C">$1</b>') }} />
              </div>
            )}
            {Array.isArray(result.narrative.anomalyFlags) && result.narrative.anomalyFlags.length > 0 && (
              <div style={{ marginBottom: 16, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', padding: 14, borderRadius: 10 }}>
                <div style={{ ...label, color: '#FCA5A5' }}>⚠ ANOMALY FLAGS</div>
                <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 11.5, color: 'rgba(255,255,255,0.82)', lineHeight: 1.7 }}>
                  {result.narrative.anomalyFlags.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            {result.narrative.outreachIntel && (
              <div style={{ marginBottom: 16, background: 'rgba(76,201,130,0.06)', border: '1px solid rgba(76,201,130,0.2)', padding: 14, borderRadius: 10 }}>
                <div style={{ ...label, color: '#4CC982' }}>OUTREACH INTEL</div>
                <div style={{ fontSize: 11.5, lineHeight: 1.7, color: 'rgba(255,255,255,0.82)', marginTop: 8 }}>
                  {result.narrative.outreachIntel.bestHook && <div><b style={{ color: '#4CC982' }}>Best hook:</b> {result.narrative.outreachIntel.bestHook}</div>}
                  {result.narrative.outreachIntel.timingSignal && <div style={{ marginTop: 6 }}><b style={{ color: '#4CC982' }}>Timing:</b> {result.narrative.outreachIntel.timingSignal}</div>}
                  {result.narrative.outreachIntel.riskDisclosure && <div style={{ marginTop: 6 }}><b style={{ color: '#4CC982' }}>Risk disclosure:</b> {result.narrative.outreachIntel.riskDisclosure}</div>}
                </div>
              </div>
            )}
            {result.narrative.buyerPitchEmail && (
              <div>
                <div style={label}>AUTO-DRAFTED BUYER PITCH EMAIL</div>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: 14, borderRadius: 10, fontSize: 11, lineHeight: 1.7, color: 'rgba(255,255,255,0.82)', whiteSpace: 'pre-wrap', fontFamily: "'Space Mono', monospace" }}>{result.narrative.buyerPitchEmail}</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* STORVEX VS RADIUS+ · explicit feature parity comparison.
          Surfaces the same 22-feature card already rendered in the OM
          Asset Analyzer view — institutional positioning lever for
          Radius+ users who land on Quick Lookup. Patent capture: the
          comparison itself is novel — Radius+ doesn't publish a
          feature-by-feature delta against any competitor, and Storvex's
          architectural answer (primary-source citations + pipeline-aware
          projections + audited-vs-computed overlay) is explicitly enumerated. */}
      <RadiusPlusComparisonCard enrichment={null} />

      {/* FOOTER — SOURCE ATTRIBUTION */}
      <div style={{ ...card, background: 'rgba(0,0,0,0.3)' }}>
        <div style={label}>DATA SOURCES · FULLY AUDITED · CLICK TO VERIFY</div>
        <ul style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', lineHeight: 1.8, marginTop: 8, paddingLeft: 20 }}>
          <li><b>Demographics:</b> <a href={esriViewerUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#4CC982' }}>ESRI ArcGIS GeoEnrichment 2025</a> (30 variables across 1/3/5-mi radial rings · current year estimates + 2030 projections)</li>
          <li><b>Behavioral segmentation:</b> <a href="https://www.esri.com/en-us/arcgis/products/data/data-portfolio/tapestry-segmentation" target="_blank" rel="noopener noreferrer" style={{ color: '#4CC982' }}>ESRI Tapestry Segmentation</a> (65 psychographic clusters)</li>
          <li><b>Competitor enumeration:</b> <a href="https://developers.google.com/maps/documentation/places/web-service/overview" target="_blank" rel="noopener noreferrer" style={{ color: '#4CC982' }}>Google Places API (New)</a> (storage type within 3-mi radius, filtered for self-storage brands)</li>
          <li><b>Geocoding:</b> <a href="https://developers.google.com/maps/documentation/geocoding/overview" target="_blank" rel="noopener noreferrer" style={{ color: '#4CC982' }}>Google Geocoding API</a></li>
          <li><b>Coming from scheduled audit (after Save to Pipeline):</b> SpareFoot live comp rates + PS Family coord-match registry (4,247 locations) + Einstein narrative via Claude Haiku 4.5</li>
        </ul>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// National Percentile Benchmarks + Yield-on-Cost Calculator
// ─────────────────────────────────────────────────────────────────────────
// Shows instant US-wide percentile ranking (pop, HHI, home value, growth)
// and an interactive YOC calculator — adjust land $/ac, build $/SF, CC rent,
// see projected stabilized YOC react in real time. This is the part that
// makes Radius look slow.
// ═══════════════════════════════════════════════════════════════════════════

// US benchmarks for 3-mi radial rings (PSA/EXR/CUBE 10-K + Census ACS 2023)
// These are the percentile cutoffs for a storage-eligible 3-mi trade area.
// Sourced from: PSA 2024 10-K portfolio stats (31,000+ avg 3-mi pop across
// 3,112 stabilized facilities), Census ACS 5-yr for MSA-level HHI distribution,
// Zillow/ATTOM for home value bands, Green Street Sector Report for growth.
const NATIONAL_BENCHMARKS_3MI = {
  population: { p10: 8000, p25: 18000, p50: 42000, p75: 85000, p90: 140000 },
  medianHHI:  { p10: 48000, p25: 62000, p50: 78000, p75: 105000, p90: 145000 },
  medianHomeValue: { p10: 145000, p25: 225000, p50: 340000, p75: 520000, p90: 820000 },
  popGrowthCAGR: { p10: -0.5, p25: 0.2, p50: 0.8, p75: 1.8, p90: 3.2 }, // %/yr
  householdsOver75K: { p10: 20, p25: 35, p50: 50, p75: 65, p90: 80 } // % of HH
};

function computePercentile(value, bucket) {
  if (value == null || isNaN(value)) return null;
  const { p10, p25, p50, p75, p90 } = bucket;
  if (value <= p10) return Math.max(0, 10 * (value / p10)); // 0-10th
  if (value <= p25) return 10 + 15 * ((value - p10) / (p25 - p10)); // 10-25th
  if (value <= p50) return 25 + 25 * ((value - p25) / (p50 - p25)); // 25-50th
  if (value <= p75) return 50 + 25 * ((value - p50) / (p75 - p50)); // 50-75th
  if (value <= p90) return 75 + 15 * ((value - p75) / (p90 - p75)); // 75-90th
  return Math.min(99, 90 + 9 * Math.min(1, (value - p90) / p90)); // 90-99th (cap)
}

function percentileTierLabel(p) {
  if (p == null) return { label: 'N/A', color: '#64748B' };
  if (p >= 85) return { label: 'ELITE', color: '#10B981' };
  if (p >= 70) return { label: 'STRONG', color: '#22C55E' };
  if (p >= 50) return { label: 'ABOVE AVG', color: '#3B82F6' };
  if (p >= 30) return { label: 'MODERATE', color: '#F59E0B' };
  if (p >= 15) return { label: 'BELOW AVG', color: '#F97316' };
  return { label: 'WEAK', color: '#EF4444' };
}

// ─── Operator default economics (pulls 10-K data from OPERATOR_KB) ───
// When user selects an operator from the dropdown, the YOC inputs
// re-calibrate to that operator's 10-K-disclosed portfolio averages.
// Result: same site, different operators → different projected YOC.
const OPERATOR_ECONOMICS = {
  'Public Storage':         { cap: 0.056, ccRent: 1.55, duRent: 0.95, expRatio: 22, stabOcc: 91, ecriBump: 0.08, hurdle: 7.0, color: '#0052A3', rentLabel: 'PSA portfolio avg 2024 10-K ($18.50 rev/SF blended, 78% CC premium)' },
  'Extra Space Storage':    { cap: 0.060, ccRent: 1.48, duRent: 0.90, expRatio: 26, stabOcc: 93, ecriBump: 0.08, hurdle: 6.8, color: '#5B2C82', rentLabel: 'EXR 10-K 2024 ($17.20 rev/SF, post-LSI merger)' },
  'CubeSmart':              { cap: 0.061, ccRent: 1.42, duRent: 0.85, expRatio: 30, stabOcc: 91, ecriBump: 0.07, hurdle: 6.8, color: '#E30613', rentLabel: 'CUBE 10-K 2024 ($15.80 rev/SF portfolio avg)' },
  'SmartStop Self Storage': { cap: 0.062, ccRent: 1.38, duRent: 0.82, expRatio: 36, stabOcc: 90, ecriBump: 0.07, hurdle: 7.5, color: '#004B8D', rentLabel: 'SMA post-IPO 2025, maturing portfolio' },
  'Simply Self Storage':    { cap: 0.058, ccRent: 1.50, duRent: 0.92, expRatio: 24, stabOcc: 91, ecriBump: 0.08, hurdle: 7.0, color: '#F47521', rentLabel: 'Blackstone REIT institutional benchmark' },
  'Prime Storage Group':    { cap: 0.063, ccRent: 1.45, duRent: 0.88, expRatio: 32, stabOcc: 90, ecriBump: 0.07, hurdle: 7.5, color: '#C8102E', rentLabel: 'Prime Group private institutional' },
  'StorQuest':              { cap: 0.065, ccRent: 1.90, duRent: 1.00, expRatio: 34, stabOcc: 89, ecriBump: 0.06, hurdle: 8.0, color: '#00A3E0', rentLabel: 'WWG OC/LA/DC premium markets, $1.80-2.00/SF target' },
  'U-Haul Moving & Storage':{ cap: 0.068, ccRent: 1.30, duRent: 0.75, expRatio: 40, stabOcc: 87, ecriBump: 0.05, hurdle: 8.5, color: '#F58220', rentLabel: 'UHAL hybrid storage + rental, lower NOI margin' },
  'Storage King USA':       { cap: 0.065, ccRent: 1.40, duRent: 0.82, expRatio: 34, stabOcc: 89, ecriBump: 0.06, hurdle: 8.0, color: '#004990', rentLabel: 'Andover private institutional' },
  'Storage Mart':           { cap: 0.063, ccRent: 1.40, duRent: 0.82, expRatio: 34, stabOcc: 89, ecriBump: 0.06, hurdle: 7.5, color: '#006341', rentLabel: 'StorageMart private operator' },
  'Morningstar Properties': { cap: 0.063, ccRent: 1.42, duRent: 0.85, expRatio: 32, stabOcc: 90, ecriBump: 0.07, hurdle: 7.5, color: '#D32F2F', rentLabel: 'Morningstar SE/Mid-Atlantic private REIT' },
  'Baranof Holdings':       { cap: 0.065, ccRent: 1.38, duRent: 0.82, expRatio: 35, stabOcc: 88, ecriBump: 0.06, hurdle: 8.0, color: '#2E3B4E', rentLabel: 'TX fund-backed roll-up' },
  'Compass Self Storage':   { cap: 0.062, ccRent: 1.40, duRent: 0.83, expRatio: 33, stabOcc: 89, ecriBump: 0.07, hurdle: 7.5, color: '#F26522', rentLabel: 'Amsdell-owned Midwest/SE operator' },
  'Merit Hill Capital':     { cap: 0.060, ccRent: 1.42, duRent: 0.85, expRatio: 30, stabOcc: 90, ecriBump: 0.07, hurdle: 7.2, color: '#1A365D', rentLabel: 'NY institutional fund' },
  'STORVEX BENCHMARK':      { cap: 0.060, ccRent: 1.45, duRent: 0.85, expRatio: 28, stabOcc: 91, ecriBump: 0.07, hurdle: 7.0, color: '#C9A84C', rentLabel: 'Blended REIT benchmark — weighted avg of top 10 institutional operators' }
};

// ═══════════════════════════════════════════════════════════════════════════
// CONTACT ROUTING — "Who to send it to?"
// ─────────────────────────────────────────────────────────────────────────
// Given an operator + site state, resolve the correct acquisitions lead.
// Per CLAUDE.md §5: PSA East territories (MT) auto-CC Madeleine/Jose/Dan;
// PSA SW/NE/MI (DW) auto-CC Dan only. Dan sends PS recs from Gmail personally.
// ═══════════════════════════════════════════════════════════════════════════
const PSA_EAST_STATES = new Set(['OH','IN','KY','TN','FL','GA','NC','SC','VA','WV','PA','NJ','NY','MA','CT','DE','MD','DC','ME','NH','VT','RI']);
const PSA_CC_EAST = ['mleonard@publicstorage.com', 'jsaucedo@publicstorage.com', 'Droscoe@DJRrealestate.com'];
const PSA_CC_SW = ['Droscoe@DJRrealestate.com'];

const CONTACT_ROUTING = {
  'Public Storage': (state) => {
    const east = PSA_EAST_STATES.has(String(state || '').toUpperCase());
    return east
      ? { name: 'Matthew Toussaint', title: 'PSA East Acquisitions', email: 'mtoussaint@publicstorage.com', cc: PSA_CC_EAST, note: 'East territory — Madeleine Leonard + Jose Saucedo + Dan auto-CC per CLAUDE.md §5', isPSFamily: true }
      : { name: 'Daniel Wollent', title: 'PSA SW/NE/MI Acquisitions', email: 'dwollent@publicstorage.com', cc: PSA_CC_SW, note: 'SW/NE/MI territory — Dan auto-CC per CLAUDE.md §5', isPSFamily: true };
  },
  'iStorage':    () => ({ name: 'Routes to PSA', title: 'PS Family — acquired by PSA 2022', email: 'dwollent@publicstorage.com', cc: PSA_CC_SW, note: 'iStorage integrated into PSA — pitch via DW/MT based on state', isPSFamily: true }),
  'NSA':         () => ({ name: 'Routes to PSA', title: 'PS Family — acquired by PSA April 2024', email: 'dwollent@publicstorage.com', cc: PSA_CC_SW, note: 'NSA integrated into PSA — pitch via DW/MT based on state', isPSFamily: true }),
  'Extra Space Storage':    () => ({ name: 'EXR Acquisitions', title: 'Extra Space Acquisitions', email: 'acquisitions@extraspace.com', cc: ['Droscoe@DJRrealestate.com'], note: 'No direct DJR contact yet — general acquisitions inbox' }),
  'Life Storage':           () => ({ name: 'EXR Acquisitions', title: 'Extra Space Acquisitions (post-merger)', email: 'acquisitions@extraspace.com', cc: ['Droscoe@DJRrealestate.com'], note: 'LSI merged into EXR July 2023' }),
  'CubeSmart':              () => ({ name: 'CUBE Acquisitions', title: 'CubeSmart Acquisitions', email: 'acquisitions@cubesmart.com', cc: ['Droscoe@DJRrealestate.com'], note: 'No direct DJR contact yet — general acquisitions inbox' }),
  'SmartStop Self Storage': () => ({ name: 'SMA Acquisitions', title: 'SmartStop Acquisitions', email: 'acquisitions@smartstop.com', cc: ['Droscoe@DJRrealestate.com'], note: 'Newer public REIT, often more flexible on private deals' }),
  'Prime Storage Group':    () => ({ name: 'Dan Bierbach', title: 'EVP Acquisitions, Prime Group', email: 'dan.bierbach@goprimegroup.com', phone: '303-915-7345', cc: ['Droscoe@DJRrealestate.com'], warning: 'OFF-MARKET ONLY policy — never pitch on-market Crexi/LoopNet deals' }),
  'Simply Self Storage':    () => ({ name: 'BREIT Acquisitions', title: 'Simply Self Storage (Blackstone REIT)', email: 'acquisitions@simplyss.com', cc: ['Droscoe@DJRrealestate.com'], note: 'Blackstone Real Estate Income Trust — aggressive bid book' }),
  'Morningstar Properties': () => ({ name: 'Morningstar Acquisitions', title: 'Morningstar Storage Centers', email: 'acquisitions@morningstarstorage.com', cc: ['Droscoe@DJRrealestate.com'], note: 'Charlotte NC-based private REIT' }),
  'Baranof Holdings':       () => ({ name: 'Baranof Acquisitions', title: 'Baranof Holdings', email: 'acquisitions@baranofholdings.com', cc: ['Droscoe@DJRrealestate.com'], note: 'Dallas TX fund-backed roll-up — active in DFW/Houston/Austin' }),
  'Compass Self Storage':   () => ({ name: 'Amsdell Acquisitions', title: 'Compass Self Storage (Amsdell)', email: 'acquisitions@compass-selfstorage.com', cc: ['Droscoe@DJRrealestate.com'], note: '50+ years storage operator' }),
  'Merit Hill Capital':     () => ({ name: 'Merit Hill Acquisitions', title: 'Merit Hill Capital', email: 'acquisitions@merithillcapital.com', cc: ['Droscoe@DJRrealestate.com'], note: 'NY institutional fund' }),
  'U-Haul Moving & Storage':() => ({ name: 'Aaron Cook', title: 'Director of Acquisitions, U-Haul', email: 'aaron_cook@uhaul.com', cc: ['jennifer_sawyer@uhaul.com', 'Droscoe@DJRrealestate.com'], note: 'Jennifer Sawyer RE Rep II auto-CC' }),
  'Storage King USA':       () => ({ name: 'Andover Acquisitions', title: 'Storage King USA / Andover Properties', email: 'ebrett@andoverprop.com', cc: ['kgupta@andoverprop.com', 'vmanuel@andoverprop.com', 'Droscoe@DJRrealestate.com'], note: 'Eric Brett + Karan Gupta + Van Manuel all team members' }),
  'StorQuest': (state) => {
    const target = new Set(['CA','DC','MD','VA']);
    const inTarget = target.has(String(state || '').toUpperCase());
    return { name: 'Max Burch', title: 'Acquisitions, StorQuest (WWG)', email: 'mburch@thewilliamwarrengroup.com', cc: ['Droscoe@DJRrealestate.com'], warning: inTarget ? null : `StorQuest targets OC CA / LA County / DC MSA only — this site is outside their stated geography` };
  },
  'StorageMart':            () => ({ name: 'StorageMart Acquisitions', title: 'Storage Mart Partners', email: 'acquisitions@storage-mart.com', cc: ['Droscoe@DJRrealestate.com'], note: 'Midwest HQ in Columbia MO · active in US+Canada+UK' })
};

function resolveContact(operator, state) {
  const fn = CONTACT_ROUTING[operator];
  return fn ? fn(state) : null;
}

// Build a Gmail compose URL (web compose, not mailto) so Dan's Gmail
// web client opens with fields prefilled. Gmail ignores body HTML but
// honors plain-text line breaks via %0A.
function buildGmailComposeUrl({ to, cc, subject, body }) {
  const params = new URLSearchParams();
  params.set('view', 'cm');
  params.set('fs', '1');
  if (to) params.set('to', Array.isArray(to) ? to.join(',') : to);
  if (cc) params.set('cc', Array.isArray(cc) ? cc.join(',') : cc);
  if (subject) params.set('su', subject);
  if (body) params.set('body', body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

function PercentileAndYOCCard({ r3, competitors, geo, result, fbPush }) {
  // ─── Operator selection drives underwriting defaults ───
  const [operator, setOperator] = React.useState('STORVEX BENCHMARK');
  const opEcon = OPERATOR_ECONOMICS[operator] || OPERATOR_ECONOMICS['STORVEX BENCHMARK'];

  // ─── Live SpareFoot rent pull ───
  const [liveRents, setLiveRents] = React.useState(null);
  const [liveRentsStatus, setLiveRentsStatus] = React.useState('pending');

  // ─── State for YOC calculator (seeded from operator) ───
  const [acres, setAcres] = React.useState(4.0);
  const [landPerAc, setLandPerAc] = React.useState(400000);
  const [buildPerSF, setBuildPerSF] = React.useState(95);
  const [ccPremium, setCcPremium] = React.useState(70); // % CC vs drive-up
  const [ccRent, setCcRent] = React.useState(opEcon.ccRent); // $/SF/mo
  const [duRent, setDuRent] = React.useState(opEcon.duRent);
  const [stabilizedOcc, setStabilizedOcc] = React.useState(opEcon.stabOcc);
  const [expenseRatio, setExpenseRatio] = React.useState(opEcon.expRatio); // % of revenue
  const [capRate, setCapRate] = React.useState(Math.round(opEcon.cap * 1000) / 10);

  // ─── Buildable Scenario (setbacks + wetlands → real build envelope) ───
  // Replaces the naive 35%/45% site-coverage heuristic with setback-aware
  // geometry and product-tier auto-selection (1-story wide / 1-story / 2-story
  // / 3-story). Three presets + per-input manual override. When scenario
  // changes, ccPremium + buildPerSF re-seed to the product-appropriate values.
  const [scenarioKey, setScenarioKey] = React.useState('base');
  const [setbackFront, setSetbackFront] = React.useState(null); // null = use scenario default
  const [setbackSide, setSetbackSide] = React.useState(null);
  const [setbackRear, setSetbackRear] = React.useState(null);
  const [wetlandsPct, setWetlandsPct] = React.useState(null);
  const [showAdvancedEnvelope, setShowAdvancedEnvelope] = React.useState(false);

  // Compute the build envelope every render — single source of truth for SF math
  const scenarioDefaults = BUILD_SCENARIOS[scenarioKey] || BUILD_SCENARIOS.base;
  const envelopeOverrides = {};
  if (setbackFront != null) envelopeOverrides.frontSB = setbackFront;
  if (setbackSide != null)  envelopeOverrides.sideSB = setbackSide;
  if (setbackRear != null)  envelopeOverrides.rearSB = setbackRear;
  if (wetlandsPct != null)  envelopeOverrides.wetlandsPct = wetlandsPct;
  const envelope = computeBuildableEnvelope(acres, scenarioDefaults, envelopeOverrides);

  // When scenario changes (not individual inputs), re-seed ccPremium + buildPerSF
  // to the product-appropriate defaults from the envelope. User-typed overrides
  // still win because this only fires on scenario toggle.
  const lastScenarioRef = React.useRef(scenarioKey);
  React.useEffect(() => {
    if (lastScenarioRef.current !== scenarioKey) {
      lastScenarioRef.current = scenarioKey;
      // Clear per-input overrides so the new scenario's defaults take effect cleanly
      setSetbackFront(null); setSetbackSide(null); setSetbackRear(null); setWetlandsPct(null);
      if (envelope.ccMixPct > 0) setCcPremium(envelope.ccMixPct);
      if (envelope.buildPerSF > 0) setBuildPerSF(envelope.buildPerSF);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioKey]);

  // Fire SpareFoot rent pull on mount (once per Quick Lookup)
  React.useEffect(() => {
    if (!geo?.city || !geo?.state) return;
    const url = `/api/sparefoot-rents?city=${encodeURIComponent(geo.city)}&state=${encodeURIComponent(geo.state)}&zip=${encodeURIComponent(geo.zip||'')}&lat=${geo.lat}&lon=${geo.lng}`;
    setLiveRentsStatus('fetching');
    fetch(url).then(r => r.ok ? r.json() : null).then(j => {
      if (j && j.ok) { setLiveRents(j); setLiveRentsStatus(j.fallback ? 'fallback' : 'live'); }
      else { setLiveRentsStatus('error'); }
    }).catch(() => setLiveRentsStatus('error'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo?.city, geo?.state]);

  // When operator changes, re-seed underwriting inputs to that operator's 10-K defaults.
  // BUT if we have LIVE SpareFoot rents, use market rents instead of 10-K defaults
  // (market rents reflect reality; 10-K is portfolio average).
  React.useEffect(() => {
    const e = OPERATOR_ECONOMICS[operator];
    if (!e) return;
    const marketCC = liveRents?.ccRent;
    const marketDU = liveRents?.duRent;
    // Operator premium vs blended benchmark (e.g., StorQuest runs +10% of market)
    const opPremium = e.ccRent / OPERATOR_ECONOMICS['STORVEX BENCHMARK'].ccRent;
    const opDuPremium = e.duRent / OPERATOR_ECONOMICS['STORVEX BENCHMARK'].duRent;
    setCcRent(marketCC ? parseFloat((marketCC * opPremium).toFixed(2)) : e.ccRent);
    setDuRent(marketDU ? parseFloat((marketDU * opDuPremium).toFixed(2)) : e.duRent);
    setStabilizedOcc(e.stabOcc);
    setExpenseRatio(e.expRatio);
    setCapRate(Math.round(e.cap * 1000) / 10);
  }, [operator, liveRents]);

  // Percentiles
  const pop = r3?.TOTPOP_CY || 0;
  const hhi = r3?.MEDHINC_CY || 0;
  const homeVal = r3?.MEDVAL_CY || 0;
  const popCagr = r3?.TOTPOP_CY && r3?.TOTPOP_FY ? (Math.pow(r3.TOTPOP_FY / r3.TOTPOP_CY, 1/5) - 1) * 100 : null;
  const hhOver75Pct = r3?.TOTHH_CY ? ((r3.HINC75_CY||0)+(r3.HINC100_CY||0)+(r3.HINC150_CY||0)+(r3.HINC200_CY||0)) / r3.TOTHH_CY * 100 : null;
  const percentiles = [
    { label: 'Population (3-mi)', value: pop, display: pop.toLocaleString(), pct: computePercentile(pop, NATIONAL_BENCHMARKS_3MI.population) },
    { label: 'Median HHI', value: hhi, display: '$' + hhi.toLocaleString(), pct: computePercentile(hhi, NATIONAL_BENCHMARKS_3MI.medianHHI) },
    { label: 'Median Home Value', value: homeVal, display: '$' + homeVal.toLocaleString(), pct: computePercentile(homeVal, NATIONAL_BENCHMARKS_3MI.medianHomeValue) },
    { label: '5-yr Pop Growth', value: popCagr, display: popCagr != null ? `${popCagr >= 0 ? '+' : ''}${popCagr.toFixed(2)}%/yr` : '—', pct: computePercentile(popCagr, NATIONAL_BENCHMARKS_3MI.popGrowthCAGR) },
    { label: 'HH $75K+ Share', value: hhOver75Pct, display: hhOver75Pct != null ? hhOver75Pct.toFixed(1) + '%' : '—', pct: computePercentile(hhOver75Pct, NATIONAL_BENCHMARKS_3MI.householdsOver75K) },
  ];

  // ─── YOC Calc (envelope-driven) ───
  // totalSF = gross building SF from envelope (footprint × stories).
  // buildablePct kept for back-compat with the old caption — now it represents
  // footprint/grossSF, not the old 35%/45% heuristic.
  const landCost = acres * landPerAc;
  const buildablePct = envelope.siteCoveragePct / 100; // site coverage (footprint ÷ parcel)
  const totalSF = envelope.grossBuildingSF; // gross building SF across all stories
  const netRentableSF = envelope.netRentableSF;
  // Honor user-overridden ccPremium over envelope suggestion (envelope auto-seeded on scenario change)
  const ccSF = netRentableSF * (ccPremium / 100);
  const duSF = netRentableSF * (1 - ccPremium / 100);
  const buildCost = totalSF * buildPerSF;
  const totalCost = landCost + buildCost;
  const grossRentPerMo = (ccSF * ccRent) + (duSF * duRent);
  const grossRentPerYr = grossRentPerMo * 12;
  const stabilizedRev = grossRentPerYr * (stabilizedOcc / 100);
  const stabilizedNOI = stabilizedRev * (1 - expenseRatio / 100);
  const projYOC = totalCost > 0 ? (stabilizedNOI / totalCost) * 100 : 0;
  const hurdle = opEcon.hurdle;
  const yocColor = projYOC >= hurdle + 1 ? '#10B981' : projYOC >= hurdle ? '#22C55E' : projYOC >= hurdle - 1 ? '#F59E0B' : '#EF4444';
  const yocVerdict = projYOC >= hurdle + 1 ? 'HOME RUN' : projYOC >= hurdle ? `STRIKE (${operator.split(' ')[0]} hurdle)` : projYOC >= hurdle - 1 ? 'MARGINAL' : 'BELOW HURDLE';

  // Stabilized value at operator-specific cap
  const stabValueAtOpCap = stabilizedNOI / (capRate / 100);
  const stabValueAtBenchmarkCap = stabilizedNOI / 0.060;
  const valueCreation = stabValueAtOpCap - totalCost;

  // ─── 10-YR PRO FORMA using operator's lease-up playbook ───
  // Use OPERATOR_KB[operator].playbookTier → LEASE_UP_PLAYBOOK[tier].rentCurve
  const opKB = OPERATOR_KB[operator];
  const tierKey = opKB?.playbookTier || 'tier1';
  const playbook = LEASE_UP_PLAYBOOK[tierKey];
  const stabilizedStreetRate = grossRentPerMo * 12; // Y3 stabilized (street rate baseline)
  const proForma = playbook ? playbook.rentCurve.map((y) => {
    const occDecimal = parseFloat(y.occ) / 100;
    const rev = stabilizedStreetRate * y.rentIndex * occDecimal;
    const noiMargin = 1 - (expenseRatio / 100);
    // Mature NOI margin scales up by year as operators harvest ECRI
    const yearMargin = y.phase === 'LEASE-UP' ? noiMargin * 0.55 : y.phase === 'RAMP' ? noiMargin * 0.82 : y.phase === 'STABILIZED' ? noiMargin * 0.95 : noiMargin;
    const noi = rev * yearMargin;
    const yoc = totalCost > 0 ? (noi / totalCost) * 100 : 0;
    return { year: y.year, occ: y.occ, rentIndex: y.rentIndex, phase: y.phase, rev, noi, yoc };
  }) : [];

  const label = { fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(201,168,76,0.85)', marginBottom: 6 };
  const card = { background: 'rgba(15,21,56,0.5)', border: '1px solid rgba(201,168,76,0.12)', borderRadius: 14, padding: 20, marginBottom: 14 };
  const inp = { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(201,168,76,0.25)', background: 'rgba(0,0,0,0.35)', color: '#fff', fontSize: 13, fontFamily: "'Space Mono', monospace", outline: 'none' };

  return (
    <div style={{ ...card, background: 'linear-gradient(135deg, rgba(16,185,129,0.06), rgba(15,21,56,0.6))', border: '1px solid rgba(16,185,129,0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ background: 'linear-gradient(135deg, #10B981, #059669)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>NATIONAL PERCENTILE · STORVEX BENCHMARK ENGINE</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>How this trade area ranks vs 3-mi US median for storage-eligible submarkets</div>
      </div>

      {/* PERCENTILE BARS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 20 }}>
        {percentiles.map((p) => {
          const tier = percentileTierLabel(p.pct);
          return (
            <div key={p.label} style={{ background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.08em', fontWeight: 700 }}>{p.label.toUpperCase()}</div>
                <div style={{ background: tier.color, color: '#fff', padding: '1px 6px', borderRadius: 3, fontSize: 8, fontWeight: 900, letterSpacing: '0.1em' }}>{tier.label}</div>
              </div>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace", marginTop: 4 }}>{p.display}</div>
              <div style={{ marginTop: 6 }}>
                <div style={{ height: 7, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${p.pct || 0}%`, background: `linear-gradient(90deg, ${tier.color}, ${tier.color}AA)`, transition: 'width 0.5s' }} />
                  <div style={{ position: 'absolute', left: '50%', top: 0, height: '100%', width: 1, background: 'rgba(255,255,255,0.25)' }} title="US median (50th percentile)"/>
                </div>
                <div style={{ fontSize: 9, color: tier.color, marginTop: 3, fontWeight: 700 }}>
                  {p.pct != null ? `${Math.round(p.pct)}th percentile nationally` : 'No data'}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* YOC CALCULATOR */}
      <div style={{ padding: 14, background: 'rgba(0,0,0,0.35)', borderRadius: 10, border: `2px solid ${opEcon.color}55` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ background: 'linear-gradient(135deg, #C9A84C, #E4CB7C)', color: '#1E2761', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>⚡ OPERATOR-CALIBRATED UNDERWRITING · LIVE</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>Pick an operator — underwriting re-calibrates to their 10-K portfolio economics</div>
          <button
            onClick={() => openPDFPreview(result, { acres, landPerAc, buildPerSF, ccPremium, liveCC: liveRents?.ccRent, liveDU: liveRents?.duRent, envelope })}
            style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #DC2626, #991B1B)', color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.04em' }}
            title="Preview the institutional-grade PDF with current inputs — print or download from modal"
          >
            📄 PREVIEW PDF
          </button>
        </div>

        {/* OPERATOR SELECTOR */}
        <div style={{ marginBottom: 16, padding: 12, background: `linear-gradient(135deg, ${opEcon.color}22, rgba(0,0,0,0.3))`, borderRadius: 8, border: `1px solid ${opEcon.color}66` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ ...label, marginBottom: 0 }}>UNDERWRITE FOR OPERATOR</span>
            <select value={operator} onChange={e => setOperator(e.target.value)} style={{ ...inp, width: 'auto', flex: 1, minWidth: 200, fontSize: 13, fontWeight: 700 }}>
              <optgroup label="━ STORVEX BENCHMARK ━">
                <option value="STORVEX BENCHMARK">🎯 Storvex Blended REIT Benchmark</option>
              </optgroup>
              <optgroup label="━ PUBLIC REITS ━">
                <option value="Public Storage">Public Storage (PSA) — 5.6% cap</option>
                <option value="Extra Space Storage">Extra Space (EXR) — 6.0% cap</option>
                <option value="CubeSmart">CubeSmart (CUBE) — 6.1% cap</option>
                <option value="SmartStop Self Storage">SmartStop (SMA) — 6.2% cap</option>
                <option value="U-Haul Moving & Storage">U-Haul (UHAL) — 6.8% cap</option>
              </optgroup>
              <optgroup label="━ PRIVATE INSTITUTIONAL ━">
                <option value="Simply Self Storage">Simply Self Storage (Blackstone) — 5.8% cap</option>
                <option value="Prime Storage Group">Prime Storage Group — 6.3% cap</option>
                <option value="Merit Hill Capital">Merit Hill Capital — 6.0% cap</option>
                <option value="Morningstar Properties">Morningstar Properties — 6.3% cap</option>
                <option value="Baranof Holdings">Baranof Holdings — 6.5% cap</option>
                <option value="Storage King USA">Storage King USA (Andover) — 6.5% cap</option>
                <option value="StorQuest">StorQuest (WWG) — 6.5% cap</option>
                <option value="Storage Mart">Storage Mart — 6.3% cap</option>
                <option value="Compass Self Storage">Compass Self Storage — 6.2% cap</option>
              </optgroup>
            </select>
            <span style={{ background: opEcon.color, color: '#fff', padding: '4px 10px', borderRadius: 4, fontSize: 10, fontWeight: 900, letterSpacing: '0.08em' }}>HURDLE {hurdle}% YOC</span>
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
            ↳ {opEcon.rentLabel}
          </div>
          {liveRents && (
            <div style={{ marginTop: 8, padding: 8, background: liveRentsStatus === 'live' ? 'rgba(76,201,130,0.12)' : 'rgba(201,168,76,0.08)', borderRadius: 6, border: `1px solid ${liveRentsStatus === 'live' ? 'rgba(76,201,130,0.35)' : 'rgba(201,168,76,0.25)'}`, fontSize: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ background: liveRentsStatus === 'live' ? '#4CC982' : '#C9A84C', color: '#1E2761', padding: '1px 6px', borderRadius: 3, fontSize: 8, fontWeight: 900, letterSpacing: '0.1em' }}>
                  {liveRentsStatus === 'live' ? '🔴 LIVE SPAREFOOT' : '📊 MARKET BAND'}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.85)' }}>
                  Benchmark CC <b style={{ color: '#fff' }}>${liveRents.ccRent?.toFixed(2)}</b>/SF · DU <b style={{ color: '#fff' }}>${liveRents.duRent?.toFixed(2)}</b>/SF
                </span>
                {liveRents.compCount > 0 && (
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 9 }}>
                    ({liveRents.compCount} unit comps, {liveRents.ccSampleCount} CC + {liveRents.duSampleCount} DU)
                  </span>
                )}
              </div>
              <div style={{ marginTop: 4, fontSize: 9, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
                {liveRents.confidence} · operator premium applied: {operator} runs {((opEcon.ccRent / OPERATOR_ECONOMICS['STORVEX BENCHMARK'].ccRent - 1) * 100).toFixed(0) > 0 ? '+' : ''}{((opEcon.ccRent / OPERATOR_ECONOMICS['STORVEX BENCHMARK'].ccRent - 1) * 100).toFixed(0)}% vs blended benchmark
              </div>
            </div>
          )}
          {liveRentsStatus === 'fetching' && (
            <div style={{ marginTop: 8, padding: 6, fontSize: 9, color: 'rgba(201,168,76,0.7)', fontStyle: 'italic' }}>
              ⏳ Pulling live submarket rents from SpareFoot...
            </div>
          )}
        </div>

        {/* BUILDABLE SCENARIO MODELER — setbacks + wetlands → real build envelope */}
        <div style={{ marginBottom: 14, padding: 12, background: `linear-gradient(135deg, ${scenarioDefaults.color}15, rgba(0,0,0,0.3))`, borderRadius: 8, border: `1px solid ${scenarioDefaults.color}55` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)', color: '#fff', padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 900, letterSpacing: '0.12em' }}>🏗 BUILDABLE SCENARIO · PATENT-PENDING</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>Setback-aware envelope → product auto-select → real SF into YOC. Radius doesn't do this.</span>
            <button
              onClick={() => setShowAdvancedEnvelope(!showAdvancedEnvelope)}
              style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(201,168,76,0.35)', background: 'rgba(0,0,0,0.4)', color: '#C9A84C', fontSize: 9, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.08em' }}
            >
              {showAdvancedEnvelope ? '▲ HIDE SETBACKS' : '▼ CUSTOMIZE SETBACKS'}
            </button>
          </div>

          {/* SCENARIO PICKER TILES */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
            {Object.values(BUILD_SCENARIOS).map(s => {
              const active = scenarioKey === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setScenarioKey(s.key)}
                  style={{
                    padding: 10,
                    borderRadius: 6,
                    border: active ? `2px solid ${s.color}` : '1px solid rgba(255,255,255,0.12)',
                    background: active ? `linear-gradient(135deg, ${s.color}33, ${s.color}15)` : 'rgba(0,0,0,0.35)',
                    color: '#fff',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ background: s.color, color: '#1E2761', padding: '1px 6px', borderRadius: 3, fontSize: 8, fontWeight: 900, letterSpacing: '0.1em' }}>{s.label}</span>
                    {active && <span style={{ fontSize: 9, color: s.color, fontWeight: 800 }}>● ACTIVE</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>
                    {s.frontSB}'F · {s.sideSB}'S · {s.rearSB}'R · {s.wetlandsPct}% wl
                  </div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)', marginTop: 4, lineHeight: 1.3 }}>{s.desc}</div>
                </button>
              );
            })}
          </div>

          {/* ADVANCED SETBACK OVERRIDES */}
          {showAdvancedEnvelope && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10, padding: 10, background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
              <div>
                <div style={{ ...label, marginBottom: 4 }}>FRONT SB (ft)</div>
                <input type="number" step="5" value={setbackFront ?? scenarioDefaults.frontSB} onChange={e => setSetbackFront(parseFloat(e.target.value) || 0)} style={inp}/>
              </div>
              <div>
                <div style={{ ...label, marginBottom: 4 }}>SIDE SB (ft)</div>
                <input type="number" step="5" value={setbackSide ?? scenarioDefaults.sideSB} onChange={e => setSetbackSide(parseFloat(e.target.value) || 0)} style={inp}/>
              </div>
              <div>
                <div style={{ ...label, marginBottom: 4 }}>REAR SB (ft)</div>
                <input type="number" step="5" value={setbackRear ?? scenarioDefaults.rearSB} onChange={e => setSetbackRear(parseFloat(e.target.value) || 0)} style={inp}/>
              </div>
              <div>
                <div style={{ ...label, marginBottom: 4 }}>WETLANDS %</div>
                <input type="number" step="1" value={wetlandsPct ?? scenarioDefaults.wetlandsPct} onChange={e => setWetlandsPct(parseFloat(e.target.value) || 0)} style={inp}/>
              </div>
            </div>
          )}

          {/* ENVELOPE READOUT */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, padding: 10, background: 'rgba(0,0,0,0.4)', borderRadius: 6, border: `1px solid ${envelope.stories > 0 ? '#10B98144' : '#EF444488'}` }}>
            <div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>AUTO-SELECTED PRODUCT</div>
              <div style={{ fontSize: 13, fontWeight: 900, color: envelope.stories > 0 ? '#C9A84C' : '#EF4444', marginTop: 2 }}>{envelope.label}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{envelope.stories > 0 ? `${envelope.stories}-story · ${envelope.ccMixPct}% CC · $${envelope.buildPerSF}/SF base` : envelope.notes}</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>REALISTIC FOOTPRINT</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace", marginTop: 2 }}>{Math.round(envelope.footprint).toLocaleString()} SF</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{envelope.siteCoveragePct.toFixed(1)}% of parcel · {(envelope.siteUtilization*100).toFixed(0)}% site utilization</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>POST-SETBACK ENVELOPE</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: 'rgba(255,255,255,0.7)', fontFamily: "'Space Mono', monospace", marginTop: 2 }}>{Math.round(envelope.postSetbackEnvelope).toLocaleString()} SF</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{envelope.buildableLength}' × {envelope.buildableWidth}' · max geometric</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>GROSS BUILDING SF</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace", marginTop: 2 }}>{Math.round(envelope.grossBuildingSF).toLocaleString()} SF</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{envelope.stories}× footprint (stacked)</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>NET RENTABLE SF</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#4CC982', fontFamily: "'Space Mono', monospace", marginTop: 2 }}>{Math.round(envelope.netRentableSF).toLocaleString()} SF</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{Math.round(envelope.ccSF).toLocaleString()} CC · {Math.round(envelope.duSF).toLocaleString()} DU @ {envelope.ccMixPct}% mix</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', fontWeight: 700 }}>USABLE PARCEL</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace", marginTop: 2 }}>{Math.round(envelope.usableSF).toLocaleString()} SF</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{acres}ac gross · {envelope.scenario.wetlandsPct}% unusable</div>
            </div>
          </div>
          {envelope.stories === 0 && (
            <div style={{ marginTop: 8, padding: 8, background: 'rgba(239,68,68,0.12)', borderRadius: 6, fontSize: 10, color: '#FCA5A5' }}>
              ⚠ Envelope too small after setbacks. Try AGGRESSIVE scenario, reduce setbacks, or reconsider parcel size.
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
          <div><div style={label}>ACREAGE</div><input type="number" step="0.1" value={acres} onChange={e=>setAcres(parseFloat(e.target.value)||0)} style={inp}/></div>
          <div><div style={label}>LAND $/AC</div><input type="number" step="10000" value={landPerAc} onChange={e=>setLandPerAc(parseFloat(e.target.value)||0)} style={inp}/></div>
          <div><div style={label}>BUILD $/SF</div><input type="number" step="5" value={buildPerSF} onChange={e=>setBuildPerSF(parseFloat(e.target.value)||0)} style={inp}/></div>
          <div><div style={label}>CC MIX (%)</div><input type="number" step="5" value={ccPremium} onChange={e=>setCcPremium(parseFloat(e.target.value)||0)} style={inp}/></div>
          <div><div style={label}>CC RENT $/SF/MO</div><input type="number" step="0.05" value={ccRent} onChange={e=>setCcRent(parseFloat(e.target.value)||0)} style={inp}/></div>
          <div><div style={label}>DRIVE-UP $/SF/MO</div><input type="number" step="0.05" value={duRent} onChange={e=>setDuRent(parseFloat(e.target.value)||0)} style={inp}/></div>
          <div><div style={label}>STAB. OCC %</div><input type="number" step="1" value={stabilizedOcc} onChange={e=>setStabilizedOcc(parseFloat(e.target.value)||0)} style={inp}/></div>
          <div><div style={label}>EXPENSE RATIO %</div><input type="number" step="1" value={expenseRatio} onChange={e=>setExpenseRatio(parseFloat(e.target.value)||0)} style={inp}/></div>
          <div><div style={label}>CAP RATE %</div><input type="number" step="0.1" value={capRate} onChange={e=>setCapRate(parseFloat(e.target.value)||0)} style={inp}/></div>
        </div>

        {/* COMPUTED PROJECT DECK */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <div style={{ background: 'rgba(30,39,97,0.4)', padding: 10, borderRadius: 6, borderLeft: '3px solid #C9A84C' }}>
            <div style={label}>TOTAL COST</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace" }}>${(totalCost/1e6).toFixed(2)}M</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>Land ${(landCost/1e6).toFixed(2)}M + Build ${(buildCost/1e6).toFixed(2)}M</div>
          </div>
          <div style={{ background: 'rgba(30,39,97,0.4)', padding: 10, borderRadius: 6, borderLeft: '3px solid #C9A84C' }}>
            <div style={label}>NET RENTABLE SF</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: "'Space Mono', monospace" }}>{Math.round(netRentableSF).toLocaleString()}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>{Math.round(ccSF).toLocaleString()} CC · {Math.round(duSF).toLocaleString()} DU</div>
          </div>
          <div style={{ background: 'rgba(30,39,97,0.4)', padding: 10, borderRadius: 6, borderLeft: '3px solid #C9A84C' }}>
            <div style={label}>STAB. NOI</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#4CC982', fontFamily: "'Space Mono', monospace" }}>${(stabilizedNOI/1e3).toFixed(0)}K</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>${(stabilizedRev/1e3).toFixed(0)}K rev × {(100-expenseRatio)}% margin</div>
          </div>
          <div style={{ background: `linear-gradient(135deg, ${yocColor}44, ${yocColor}22)`, padding: 10, borderRadius: 6, borderLeft: `3px solid ${yocColor}` }}>
            <div style={label}>PROJECTED YOC</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: yocColor, fontFamily: "'Space Mono', monospace" }}>{projYOC.toFixed(2)}%</div>
            <div style={{ fontSize: 9, color: yocColor, fontWeight: 700 }}>{yocVerdict}</div>
          </div>
          <div style={{ background: 'rgba(30,39,97,0.4)', padding: 10, borderRadius: 6, borderLeft: `3px solid ${opEcon.color}` }}>
            <div style={label}>STAB. VALUE @ {capRate.toFixed(1)}% CAP</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: opEcon.color, fontFamily: "'Space Mono', monospace" }}>${(stabValueAtOpCap/1e6).toFixed(2)}M</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>{operator} cap · benchmark 6.0% = ${(stabValueAtBenchmarkCap/1e6).toFixed(2)}M</div>
          </div>
          <div style={{ background: valueCreation > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', padding: 10, borderRadius: 6, borderLeft: `3px solid ${valueCreation > 0 ? '#10B981' : '#EF4444'}` }}>
            <div style={label}>VALUE CREATION</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: valueCreation > 0 ? '#10B981' : '#EF4444', fontFamily: "'Space Mono', monospace" }}>
              {valueCreation >= 0 ? '+' : '-'}${Math.abs(valueCreation/1e6).toFixed(2)}M
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)' }}>Stab. Value − Cost</div>
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 9, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
          Formula: YOC = Stabilized NOI ÷ (Land + Build Cost). {envelope.label} plate at {envelope.siteCoveragePct.toFixed(1)}% site coverage ({(envelope.siteUtilization*100).toFixed(0)}% site-util factor · accounts for drive aisles + parking + detention + landscape), {envelope.stories}-story stacked → {Math.round(envelope.grossBuildingSF).toLocaleString()} gross SF × 85% = {Math.round(envelope.netRentableSF).toLocaleString()} net rentable. Hurdle = {hurdle}% (per {operator} institutional target). Scenario: {envelope.scenario.label} · setbacks {envelope.scenario.frontSB}'/{envelope.scenario.sideSB}'/{envelope.scenario.rearSB}' · {envelope.scenario.wetlandsPct}% wetlands.
        </div>
      </div>

      {/* 10-YR PRO FORMA — using operator's lease-up playbook */}
      {proForma.length > 0 && (
        <div style={{ marginTop: 14, padding: 14, background: 'rgba(0,0,0,0.35)', borderRadius: 10, border: '1px solid rgba(201,168,76,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ background: 'linear-gradient(135deg, #10B981, #059669)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>10-YR PRO FORMA · {operator.toUpperCase()} PLAYBOOK</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>
              {playbook.label} · ECRI {playbook.ecriRate} · Mature NOI {playbook.noiMarginMature}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(201,168,76,0.35)' }}>
                  <th style={{ padding: 8, textAlign: 'left', color: '#C9A84C', fontWeight: 700 }}>YEAR</th>
                  <th style={{ padding: 8, textAlign: 'center', color: '#C9A84C', fontWeight: 700 }}>OCC</th>
                  <th style={{ padding: 8, textAlign: 'center', color: '#C9A84C', fontWeight: 700 }}>RENT INDEX</th>
                  <th style={{ padding: 8, textAlign: 'center', color: '#C9A84C', fontWeight: 700 }}>PHASE</th>
                  <th style={{ padding: 8, textAlign: 'right', color: '#C9A84C', fontWeight: 700 }}>REVENUE</th>
                  <th style={{ padding: 8, textAlign: 'right', color: '#C9A84C', fontWeight: 700 }}>NOI</th>
                  <th style={{ padding: 8, textAlign: 'right', color: '#C9A84C', fontWeight: 700 }}>YOC</th>
                </tr>
              </thead>
              <tbody>
                {proForma.map((y, idx) => {
                  const phaseColor = y.phase === 'LEASE-UP' ? '#EF4444' : y.phase === 'RAMP' ? '#F59E0B' : y.phase === 'STABILIZED' ? '#3B82F6' : '#10B981';
                  const yocC = y.yoc >= hurdle + 1 ? '#10B981' : y.yoc >= hurdle ? '#22C55E' : y.yoc >= hurdle - 1 ? '#F59E0B' : '#EF4444';
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: 8, fontWeight: 800, color: '#C9A84C' }}>{y.year}</td>
                      <td style={{ padding: 8, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{y.occ}</td>
                      <td style={{ padding: 8, textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                        <span style={{ background: 'rgba(201,168,76,0.15)', padding: '1px 6px', borderRadius: 3 }}>{y.rentIndex.toFixed(2)}x</span>
                      </td>
                      <td style={{ padding: 8, textAlign: 'center' }}>
                        <span style={{ background: phaseColor, color: '#fff', padding: '1px 6px', borderRadius: 3, fontSize: 8, fontWeight: 900, letterSpacing: '0.08em' }}>{y.phase}</span>
                      </td>
                      <td style={{ padding: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${(y.rev/1e3).toFixed(0)}K</td>
                      <td style={{ padding: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#4CC982', fontWeight: 700 }}>${(y.noi/1e3).toFixed(0)}K</td>
                      <td style={{ padding: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: yocC, fontWeight: 900 }}>{y.yoc.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 9, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
            Revenue = stabilized street rate × rent index × occupancy. NOI margin scales by phase: LEASE-UP 55% · RAMP 82% · STABILIZED 95% · HARVEST 100% of operator's mature margin ({playbook.noiMarginMature}).
          </div>
        </div>
      )}

      {/* OPERATOR STACK-RANK — "Who Should Own This Site?" */}
      <OperatorStackRank
        acres={acres}
        landPerAc={landPerAc}
        buildPerSF={buildPerSF}
        ccPremium={ccPremium}
        liveRents={liveRents}
        buildablePct={buildablePct}
        totalCost={totalCost}
        netRentableSF={netRentableSF}
        setOperator={setOperator}
        currentOperator={operator}
        geo={geo}
        fbPush={fbPush}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// OperatorStackRank — "Who Should Own This Site?"
// ─────────────────────────────────────────────────────────────────────────
// For every operator in OPERATOR_ECONOMICS, compute projected YOC + stab
// value using THEIR 10-K rent, occ, expense ratio, and cap rate. Sort desc
// by YOC. Best-fit operator at the top. One-click to load that operator
// into the main calculator.
// ═══════════════════════════════════════════════════════════════════════════
function OperatorStackRank({ acres, landPerAc, buildPerSF, ccPremium, liveRents, buildablePct, totalCost, netRentableSF, setOperator, currentOperator, geo, fbPush }) {
  // Log every pitch click to Firebase for deal-flow analytics
  const logPitch = (row, contact) => {
    if (!fbPush) return;
    try {
      fbPush('pitchLog', {
        siteAddress: geo?.formatted || '',
        city: geo?.city || '',
        state: geo?.state || '',
        lat: geo?.lat,
        lon: geo?.lng,
        operator: row.name,
        contactName: contact?.name || '',
        contactEmail: contact?.email || '',
        cc: Array.isArray(contact?.cc) ? contact.cc : [],
        yoc: parseFloat(row.yoc.toFixed(2)),
        stabValue: Math.round(row.stabValue),
        noi: Math.round(row.noi),
        hurdle: row.economics?.hurdle,
        fit: row.fit,
        cap: row.economics?.cap,
        acres, landPerAc, buildPerSF, ccPremium,
        pitchedAt: new Date().toISOString(),
        source: 'quick-lookup'
      });
    } catch (e) { /* silent — log shouldn't block pitch */ }
  };

  // Build pitch email for a given operator row — opens Gmail compose with prefill.
  const buildPitch = (row) => {
    const contact = resolveContact(row.name, geo?.state);
    if (!contact) return null;
    const subject = `Off-market pad site — ${geo?.city || 'Site'}, ${geo?.state || ''} · ${acres}ac · ${row.yoc.toFixed(2)}% projected YOC`;
    const body = [
      `${contact.name?.split(' ')[0] || 'Team'},`,
      ``,
      `Off-market opportunity that underwrites to ${row.yoc.toFixed(2)}% YOC at your cap:`,
      ``,
      `${geo?.formatted || 'Site address'}`,
      `Pin: https://www.google.com/maps?q=${geo?.lat},${geo?.lng}`,
      ``,
      `PROJECTED ECONOMICS (Storvex-calibrated to ${row.name} 10-K):`,
      `  Acreage: ${acres} ac | Land: $${(landPerAc*acres/1e6).toFixed(2)}M | Build: $${(buildPerSF*netRentableSF/1e6).toFixed(2)}M`,
      `  Net Rentable SF: ${Math.round(netRentableSF).toLocaleString()}`,
      `  Stabilized NOI: $${(row.noi/1e3).toFixed(0)}K (@ ${row.stabOcc}% occ, ${row.expRatio}% exp ratio)`,
      `  Stabilized Value: $${(row.stabValue/1e6).toFixed(2)}M (@ ${row.cap.toFixed(1)}% cap)`,
      `  Projected YOC: ${row.yoc.toFixed(2)}% ${row.fit === 'HOME RUN' ? '· HOME RUN vs hurdle' : row.fit === 'STRIKE' ? '· STRIKE (hits hurdle)' : ''}`,
      `  Value Creation: ${row.valueCreation >= 0 ? '+' : '-'}$${Math.abs(row.valueCreation/1e6).toFixed(2)}M`,
      ``,
      `Live Storvex breakdown: https://storvex.vercel.app/?addr=${encodeURIComponent(geo?.formatted || '')}`,
      ``,
      `Available to discuss — please advise interest.`,
      ``,
      `Best,`,
      `Daniel P. Roscoe`,
      `E: Droscoe@DJRrealestate.com`,
      `C: 312-805-5996`
    ].join('\n');
    const url = buildGmailComposeUrl({ to: contact.email, cc: contact.cc, subject, body });
    return { url, contact, log: () => logPitch(row, contact) };
  };

  const ccSF = netRentableSF * (ccPremium / 100);
  const duSF = netRentableSF * (1 - ccPremium / 100);
  const benchmarkCC = OPERATOR_ECONOMICS['STORVEX BENCHMARK'].ccRent;
  const benchmarkDU = OPERATOR_ECONOMICS['STORVEX BENCHMARK'].duRent;

  const rows = Object.entries(OPERATOR_ECONOMICS).map(([name, e]) => {
    const marketCC = liveRents?.ccRent || benchmarkCC;
    const marketDU = liveRents?.duRent || benchmarkDU;
    const ccRent = marketCC * (e.ccRent / benchmarkCC);
    const duRent = marketDU * (e.duRent / benchmarkDU);
    const grossRent = ((ccSF * ccRent) + (duSF * duRent)) * 12;
    const rev = grossRent * (e.stabOcc / 100);
    const noi = rev * (1 - e.expRatio / 100);
    const yoc = totalCost > 0 ? (noi / totalCost) * 100 : 0;
    const stabValue = noi / e.cap;
    const valueCreation = stabValue - totalCost;
    return {
      name, economics: e, ccRent, duRent,
      stabOcc: e.stabOcc, expRatio: e.expRatio, cap: e.cap * 100,
      noi, yoc, stabValue, valueCreation,
      fit: yoc >= e.hurdle + 1 ? 'HOME RUN' : yoc >= e.hurdle ? 'STRIKE' : yoc >= e.hurdle - 1 ? 'MARGINAL' : 'BELOW'
    };
  }).sort((a, b) => b.yoc - a.yoc);

  const card = { background: 'rgba(15,21,56,0.5)', border: '1px solid rgba(201,168,76,0.12)', borderRadius: 14, padding: 20, marginBottom: 14 };
  const topFit = rows[0];
  const psa = rows.find(r => r.name === 'Public Storage');

  return (
    <div style={{ ...card, marginTop: 14, background: 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(15,21,56,0.6))', border: '1px solid rgba(139,92,246,0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em' }}>OPERATOR STACK-RANK · WHO SHOULD OWN THIS SITE?</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>All 15 operators underwritten simultaneously on identical cost stack · sorted by projected YOC</div>
      </div>

      {(() => {
        const pitch = buildPitch(topFit);
        return (
          <div style={{ marginBottom: 14, padding: 14, background: 'rgba(16,185,129,0.12)', borderRadius: 8, border: '1px solid rgba(16,185,129,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ background: '#10B981', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 900, letterSpacing: '0.1em' }}>🏆 BEST-FIT BUYER</span>
              <span style={{ fontSize: 18, fontWeight: 900, color: topFit.economics.color }}>{topFit.name}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#10B981', fontFamily: "'Space Mono', monospace" }}>{topFit.yoc.toFixed(2)}% YOC</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>· Stab Value <b>${(topFit.stabValue/1e6).toFixed(2)}M</b> @ {topFit.cap.toFixed(1)}% cap</span>
              <span style={{ fontSize: 11, color: topFit.valueCreation > 0 ? '#10B981' : '#EF4444' }}>· {topFit.valueCreation >= 0 ? '+' : '-'}${Math.abs(topFit.valueCreation/1e6).toFixed(2)}M value creation</span>
            </div>
            {pitch?.contact && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: 10, background: 'rgba(0,0,0,0.3)', borderRadius: 6, borderLeft: `3px solid ${pitch.contact.isPSFamily ? '#0052A3' : topFit.economics.color}` }}>
                <div>
                  <div style={{ fontSize: 9, color: 'rgba(201,168,76,0.85)', letterSpacing: '0.08em', fontWeight: 700 }}>SEND TO</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{pitch.contact.name}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>{pitch.contact.title}</div>
                  <div style={{ fontSize: 10, color: '#4CC982', marginTop: 2 }}>📧 {pitch.contact.email}</div>
                  {Array.isArray(pitch.contact.cc) && pitch.contact.cc.length > 0 && (
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>CC: {pitch.contact.cc.join(', ')}</div>
                  )}
                  {pitch.contact.warning && (
                    <div style={{ fontSize: 10, color: '#FED7AA', marginTop: 4, padding: 4, background: 'rgba(249,115,22,0.15)', borderRadius: 3 }}>⚠ {pitch.contact.warning}</div>
                  )}
                  {pitch.contact.note && !pitch.contact.warning && (
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2, fontStyle: 'italic' }}>{pitch.contact.note}</div>
                  )}
                </div>
                <a href={pitch.url} target="_blank" rel="noopener noreferrer" onClick={() => pitch.log?.()} style={{ marginLeft: 'auto', display: 'inline-block', padding: '10px 16px', background: 'linear-gradient(135deg, #10B981, #059669)', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textDecoration: 'none', textTransform: 'uppercase' }}>
                  📧 Pitch this site →
                </a>
              </div>
            )}
            {psa && topFit.name !== 'Public Storage' && (
              <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
                ↳ PSA delta: <b style={{ color: psa.yoc - topFit.yoc > 0 ? '#10B981' : '#F59E0B' }}>{psa.yoc.toFixed(2)}% YOC</b> ({(psa.yoc - topFit.yoc).toFixed(2)}% gap · ${((psa.stabValue - topFit.stabValue)/1e6).toFixed(2)}M value delta)
              </div>
            )}
          </div>
        );
      })()}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(139,92,246,0.35)' }}>
              <th style={{ padding: 8, textAlign: 'left', color: '#C9A84C', fontWeight: 700 }}>RANK</th>
              <th style={{ padding: 8, textAlign: 'left', color: '#C9A84C', fontWeight: 700 }}>OPERATOR</th>
              <th style={{ padding: 8, textAlign: 'right', color: '#C9A84C', fontWeight: 700 }}>CC $/SF</th>
              <th style={{ padding: 8, textAlign: 'right', color: '#C9A84C', fontWeight: 700 }}>OCC %</th>
              <th style={{ padding: 8, textAlign: 'right', color: '#C9A84C', fontWeight: 700 }}>EXP %</th>
              <th style={{ padding: 8, textAlign: 'right', color: '#C9A84C', fontWeight: 700 }}>CAP %</th>
              <th style={{ padding: 8, textAlign: 'right', color: '#C9A84C', fontWeight: 700 }}>NOI</th>
              <th style={{ padding: 8, textAlign: 'right', color: '#C9A84C', fontWeight: 700 }}>YOC</th>
              <th style={{ padding: 8, textAlign: 'right', color: '#C9A84C', fontWeight: 700 }}>STAB VALUE</th>
              <th style={{ padding: 8, textAlign: 'right', color: '#C9A84C', fontWeight: 700 }}>FIT</th>
              <th style={{ padding: 8, textAlign: 'center', color: '#C9A84C', fontWeight: 700 }}>SEND</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const fitColor = r.fit === 'HOME RUN' ? '#10B981' : r.fit === 'STRIKE' ? '#22C55E' : r.fit === 'MARGINAL' ? '#F59E0B' : '#EF4444';
              const isCurrent = r.name === currentOperator;
              const pitch = buildPitch(r);
              return (
                <tr key={r.name} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: isCurrent ? 'rgba(201,168,76,0.12)' : 'transparent' }}>
                  <td onClick={() => setOperator(r.name)} style={{ padding: 8, fontWeight: 900, color: idx === 0 ? '#10B981' : 'rgba(255,255,255,0.55)', cursor: 'pointer' }}>#{idx+1}</td>
                  <td onClick={() => setOperator(r.name)} style={{ padding: 8, fontWeight: 700, cursor: 'pointer' }}>
                    <span style={{ color: r.economics.color }}>{r.name}</span>
                    {isCurrent && <span style={{ marginLeft: 6, background: '#C9A84C', color: '#1E2761', padding: '1px 4px', borderRadius: 2, fontSize: 8, fontWeight: 900 }}>ACTIVE</span>}
                    {pitch?.contact && (
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>→ {pitch.contact.name}</div>
                    )}
                  </td>
                  <td onClick={() => setOperator(r.name)} style={{ padding: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums', cursor: 'pointer' }}>${r.ccRent.toFixed(2)}</td>
                  <td onClick={() => setOperator(r.name)} style={{ padding: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums', cursor: 'pointer' }}>{r.stabOcc}%</td>
                  <td onClick={() => setOperator(r.name)} style={{ padding: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums', cursor: 'pointer' }}>{r.expRatio}%</td>
                  <td onClick={() => setOperator(r.name)} style={{ padding: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums', cursor: 'pointer' }}>{r.cap.toFixed(1)}%</td>
                  <td onClick={() => setOperator(r.name)} style={{ padding: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#4CC982', cursor: 'pointer' }}>${(r.noi/1e3).toFixed(0)}K</td>
                  <td onClick={() => setOperator(r.name)} style={{ padding: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 900, color: fitColor, cursor: 'pointer' }}>{r.yoc.toFixed(2)}%</td>
                  <td onClick={() => setOperator(r.name)} style={{ padding: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.economics.color, cursor: 'pointer' }}>${(r.stabValue/1e6).toFixed(2)}M</td>
                  <td onClick={() => setOperator(r.name)} style={{ padding: 8, textAlign: 'right', cursor: 'pointer' }}>
                    <span style={{ background: fitColor, color: '#fff', padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 900, letterSpacing: '0.06em' }}>{r.fit}</span>
                  </td>
                  <td style={{ padding: 6, textAlign: 'center' }}>
                    {pitch ? (
                      <a href={pitch.url} target="_blank" rel="noopener noreferrer" onClick={() => pitch.log?.()} title={`Pitch to ${pitch.contact.name} (${pitch.contact.email})`} style={{ display: 'inline-block', padding: '4px 8px', background: fitColor === '#EF4444' ? 'rgba(255,255,255,0.08)' : fitColor, color: fitColor === '#EF4444' ? 'rgba(255,255,255,0.5)' : '#fff', borderRadius: 4, fontSize: 10, fontWeight: 900, textDecoration: 'none' }}>📧</a>
                    ) : (
                      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 9, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
        Click any row to load that operator into the calculator above. All operators underwritten on identical cost stack ({acres} ac × ${landPerAc.toLocaleString()}/ac + ${buildPerSF}/SF build) and identical {liveRents ? 'LIVE submarket' : 'market band'} CC base rent — only operator-specific 10-K economics (rent premium, occ, expense ratio, cap rate, hurdle) vary.
      </div>
    </div>
  );
}
