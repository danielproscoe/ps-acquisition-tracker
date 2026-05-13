#!/usr/bin/env node
/**
 * esri-by-coords.mjs — Standalone ESRI lookup by lat/lon (no Firebase write)
 * Usage: node scripts/esri-by-coords.mjs <lat> <lon> [<label>]
 */

const ESRI_KEY = "AAPTaUYfi1SoeDufhIkJrnG_F2Q..-zBe5ghTDGTsSCeiaQYPhJmQQ5IKF7MvHv4i5LFTenLFy3ONZYOuiB9mGIPbWYgB9mHIUzNWHXEKPNz9NuuD-7U9VcXUPn28LkIy74pFEfpAdlDaXwME5Tuczq90l0hVssyMRfjXBX5rwmyHaI_8i2Nmgz4mLywQHr7VK2U1GeDyszM2nuUgrqEwUHGZGbA77YK4B7x2GvUK6dTalg0icDTtedzgihJG_CzuLsV-Wbk84LBoXHqmQM-i-0Q4HBep3LRuX-XCAT1_ZmGdGMNw";
const ENRICH_URL = "https://geoenrich.arcgis.com/arcgis/rest/services/World/geoenrichmentserver/Geoenrichment/Enrich";

const DEMO_VARS = [
  "AtRisk.TOTPOP_CY","KeyUSFacts.TOTPOP_FY","KeyUSFacts.TOTHH_CY","KeyUSFacts.TOTHH_FY",
  "KeyUSFacts.MEDHINC_CY","KeyUSFacts.MEDHINC_FY","KeyUSFacts.AVGHINC_CY",
  "homevalue.MEDVAL_CY","OwnerRenter.OWNER_CY","OwnerRenter.RENTER_CY",
  "KeyUSFacts.TOTHU_CY"
];

async function enrich(lat, lon, radiusMi) {
  const sa = JSON.stringify([{ geometry: { x: lon, y: lat }, areaType: 'RingBuffer', bufferUnits: 'esriMiles', bufferRadii: [radiusMi] }]);
  const params = new URLSearchParams({
    studyAreas: sa,
    analysisVariables: JSON.stringify(DEMO_VARS),
    useData: JSON.stringify({ sourceCountry: 'US' }),
    f: 'json',
    token: ESRI_KEY,
  });
  const res = await fetch(ENRICH_URL + '?' + params.toString());
  if (!res.ok) return null;
  const data = await res.json();
  if (data.error) { console.error('ESRI error:', data.error); return null; }
  return data?.results?.[0]?.value?.FeatureSet?.[0]?.features?.[0]?.attributes || null;
}

const [lat, lon, label] = [parseFloat(process.argv[2]), parseFloat(process.argv[3]), process.argv[4] || ''];
if (!lat || !lon) { console.error('Usage: node esri-by-coords.mjs <lat> <lon> [label]'); process.exit(1); }

console.log(`\n=== ESRI 1/3/5-mi Demographics for ${label || `${lat},${lon}`} ===\n`);
const [r1, r3, r5] = await Promise.all([enrich(lat, lon, 1), enrich(lat, lon, 3), enrich(lat, lon, 5)]);

const ringFmt = (r, label) => {
  if (!r) return `${label}: NO DATA`;
  const popCY = r.TOTPOP_CY || 0, popFY = r.TOTPOP_FY || 0;
  const cagr = popCY > 0 ? (Math.pow(popFY / popCY, 1/5) - 1) * 100 : 0;
  return [
    `${label}-mile ring:`,
    `  Population (2025): ${popCY.toLocaleString()}`,
    `  Population (2030): ${popFY.toLocaleString()}`,
    `  Pop 5-yr CAGR:    ${cagr.toFixed(2)}%`,
    `  Households (2025): ${(r.TOTHH_CY||0).toLocaleString()}`,
    `  Median HHI (2025): $${(r.MEDHINC_CY||0).toLocaleString()}`,
    `  Avg HHI (2025):    $${(r.AVGHINC_CY||0).toLocaleString()}`,
    `  Median Home Value: $${(r.MEDVAL_CY||0).toLocaleString()}`,
    `  Owner units:      ${(r.OWNER_CY||0).toLocaleString()}`,
    `  Renter units:     ${(r.RENTER_CY||0).toLocaleString()}`,
    `  Renter %:         ${r.OWNER_CY+r.RENTER_CY > 0 ? ((r.RENTER_CY/(r.OWNER_CY+r.RENTER_CY))*100).toFixed(1) : 'N/A'}%`,
  ].join('\n');
};

console.log(ringFmt(r1, '1'));
console.log('');
console.log(ringFmt(r3, '3'));
console.log('');
console.log(ringFmt(r5, '5'));
console.log('');
