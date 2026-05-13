import fs from 'fs';
import path from 'path';

function parseCSV(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,''));
  return lines.slice(1).map(line => {
    const cells = [];
    let cur = '', inq = false;
    for (const ch of line) {
      if (ch === '"') { inq = !inq; continue; }
      if (ch === ',' && !inq) { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    const obj = {};
    headers.forEach((h, i) => obj[h] = (cells[i]||'').trim());
    return obj;
  });
}

function hav(lat1, lon1, lat2, lon2) {
  const R = 3958.8, r = Math.PI/180;
  const dLat = (lat2-lat1)*r, dLon = (lon2-lon1)*r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

const LAT = 29.540083, LON = -95.725137;
const BASE = String.raw`C:\Users\danie\OneDrive\Desktop\MASTER FOLDER - CLAUDE\#2 - PS\Reference Files`;
const allResults = [];

for (const [file, brand] of [
  ['PS_Locations_ALL.csv', 'PS'],
  ['NSA_Locations.csv', 'NSA'],
  ['PS_Locations_3rdParty.csv', 'PS-3P'],
]) {
  const full = path.join(BASE, file);
  if (!fs.existsSync(full)) { console.error('MISSING', full); continue; }
  const rows = parseCSV(full);
  if (brand === 'PS') console.error('Headers:', Object.keys(rows[0] || {}).join('|'));
  for (const r of rows) {
    const lat = parseFloat(r.LATITUDE || r.Latitude || r.LAT || r.lat || r.Lat || r.latitude);
    const lon = parseFloat(r.LONGITUDE || r.Longitude || r.LON || r.lon || r.Lng || r.Lon || r.longitude);
    if (!lat || !lon) continue;
    const d = hav(LAT, LON, lat, lon);
    allResults.push({
      brand,
      name: r.PROPERTY_NAME || r.Name || r.NAME || r.name || r.FacilityName || r.Location || 'Unknown',
      addr: r.ADDRESS || r.Address || r.Street || r.address || '',
      city: r.CITY || r.City || r.city || '',
      state: r.STATE || r.State || r.state || '',
      d
    });
  }
}

allResults.sort((a,b)=>a.d-b.d);
console.log('Top 15 nearest PS family facilities to 29.540083,-95.725137 (Benton Rd Rosenberg TX):');
allResults.slice(0, 15).forEach((r,i) => console.log(`${(i+1).toString().padStart(2)}. ${r.brand.padEnd(5)} ${r.addr}, ${r.city} ${r.state} | ${r.d.toFixed(2)} mi`));
console.log(`\nWithin 3mi: ${allResults.filter(r=>r.d<=3).length} | Within 5mi: ${allResults.filter(r=>r.d<=5).length} | Within 10mi: ${allResults.filter(r=>r.d<=10).length} | Within 25mi: ${allResults.filter(r=>r.d<=25).length}`);
