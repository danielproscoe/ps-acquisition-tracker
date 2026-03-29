// Haversine distance between two lat/lng points in miles
// Shared utility — used by DiscoverMap, App.js detail maps, scoring
// IPO-grade: validated inputs, documented precision
const R = 3958.8; // Earth radius in miles (WGS-84 mean)

export function haversine(lat1, lon1, lat2, lon2) {
  // Coerce strings to numbers (Firebase sometimes stores coords as strings)
  lat1 = +lat1; lon1 = +lon1; lat2 = +lat2; lon2 = +lon2;
  if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return Infinity;
  if (Math.abs(lat1) > 90 || Math.abs(lat2) > 90) return Infinity;
  if (Math.abs(lon1) > 180 || Math.abs(lon2) > 180) return Infinity;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
