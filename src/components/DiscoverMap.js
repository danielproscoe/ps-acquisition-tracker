// src/components/DiscoverMap.js — Market Discovery & Whitespace Analysis
// © 2026 DJR Real Estate LLC. All rights reserved.
// IPO-grade: hardened per 25-issue Bain/FBI audit — all P0/P1 resolved

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Rectangle, GeoJSON, useMapEvents, useMap, Tooltip } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import { haversine } from "../haversine";

// ─── Brand ───
const NAVY = "#1E2761", GOLD = "#C9A84C", STEEL = "#2C3E6B", FIRE = "#E87A2E";
const DARK_BG = "rgba(13,17,38,0.95)", GLASS = "rgba(20,24,50,0.88)";

// ─── Coverage Gap Colors ───
const gapColor = (d) => d <= 10 ? "rgba(232,122,46,0.30)" : d <= 20 ? "rgba(201,168,76,0.22)" : d <= 35 ? "rgba(30,39,97,0.28)" : "rgba(100,100,100,0.10)";
const gapBorder = (d) => d <= 10 ? "rgba(232,122,46,0.08)" : d <= 20 ? "rgba(201,168,76,0.06)" : d <= 35 ? "rgba(30,39,97,0.10)" : "rgba(100,100,100,0.04)";

// ─── Cached Marker Icons (P0 fix #1 — icons created once, never re-created) ───
const psIcon = L.divIcon({ className: "ps-marker", html: `<div style="width:10px;height:10px;border-radius:50%;background:${FIRE};border:2px solid #fff;box-shadow:0 0 6px rgba(232,122,46,0.6)"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
const aiTargetIcon = L.divIcon({ className: "ai-target-marker", html: `<div style="width:20px;height:20px;border-radius:50%;background:linear-gradient(135deg,${GOLD},${FIRE});border:3px solid #fff;box-shadow:0 0 16px ${GOLD}88,0 0 32px ${FIRE}44;animation:sitescore-glow 1.5s ease-in-out infinite alternate"></div>`, iconSize: [26, 26], iconAnchor: [13, 13] });

// P0 fix #1: Pre-built icon cache — one per phase, never re-created
const PHASE_COLORS = { "Under Contract": "#16A34A", "LOI": "#F59E0B", "LOI Sent": "#F59E0B", "LOI Signed": "#F59E0B", "PSA Sent": "#F59E0B", "SiteScore Approved": "#8B5CF6", "Submitted to PS": "#6366F1", "Closed": "#059669", "Prospect": "#3B82F6" };
const PIPELINE_ICONS = {};
Object.entries(PHASE_COLORS).forEach(([phase, color]) => {
  PIPELINE_ICONS[phase] = L.divIcon({ className: "pipeline-marker", html: `<div style="width:14px;height:14px;transform:rotate(45deg);background:${color};border:2px solid #fff;box-shadow:0 0 8px ${color}66"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
});

const createClusterIcon = (cluster) => {
  const count = cluster.getChildCount();
  const size = count < 50 ? 36 : count < 200 ? 44 : 52;
  return L.divIcon({ html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,${NAVY},${STEEL});border:2px solid ${GOLD};color:${GOLD};font-weight:700;font-size:${count < 50 ? 11 : 10}px;font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(30,39,97,0.5),0 0 20px rgba(201,168,76,0.2)">${count}</div>`, className: "ps-cluster-icon", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
};

// ─── 2025 State Populations (Census Bureau 2025 estimates) ───
const STATE_POP = { AL:5143014,AK:740339,AZ:7695017,AR:3089820,CA:39128162,CO:6048543,CT:3639500,DE:1042420,FL:23676880,GA:11235970,HI:1437483,ID:2060439,IL:12437176,IN:6933226,IA:3224890,KS:2962640,KY:4558600,LA:4573270,ME:1406120,MD:6233280,MA:7080360,MI:10070060,MN:5797490,MS:2935210,MO:6227170,MT:1160640,NE:2003400,NV:3297210,NH:1418300,NJ:9395320,NM:2135620,NY:19500000,NC:11047560,ND:806670,OH:11840180,OK:4053430,OR:4318490,PA:12981560,RI:1107540,SC:5493570,SD:930680,TN:7262490,TX:31290830,UT:3530270,VT:649700,VA:8777580,WA:8040010,WV:1748560,WI:5960270,WY:589700,DC:695300 };

const STATE_BOUNDS = { AL:[[30.2,-88.5],[35.0,-84.9]],AK:[[51.2,-179.1],[71.4,-129.9]],AZ:[[31.3,-114.8],[37.0,-109.0]],AR:[[33.0,-94.6],[36.5,-89.6]],CA:[[32.5,-124.5],[42.0,-114.1]],CO:[[37.0,-109.1],[41.0,-102.0]],CT:[[41.0,-73.7],[42.1,-71.8]],DE:[[38.5,-75.8],[39.8,-75.0]],FL:[[24.5,-87.6],[31.0,-80.0]],GA:[[30.4,-85.6],[35.0,-80.8]],HI:[[18.9,-160.3],[22.2,-154.8]],ID:[[42.0,-117.2],[49.0,-111.0]],IL:[[37.0,-91.5],[42.5,-87.5]],IN:[[37.8,-88.1],[41.8,-84.8]],IA:[[40.4,-96.6],[43.5,-90.1]],KS:[[37.0,-102.1],[40.0,-94.6]],KY:[[36.5,-89.6],[39.1,-82.0]],LA:[[28.9,-94.0],[33.0,-89.0]],ME:[[43.1,-71.1],[47.5,-66.9]],MD:[[37.9,-79.5],[39.7,-75.0]],MA:[[41.2,-73.5],[42.9,-69.9]],MI:[[41.7,-90.4],[48.2,-82.4]],MN:[[43.5,-97.2],[49.4,-89.5]],MS:[[30.2,-91.7],[35.0,-88.1]],MO:[[36.0,-95.8],[40.6,-89.1]],MT:[[44.4,-116.0],[49.0,-104.0]],NE:[[40.0,-104.1],[43.0,-95.3]],NV:[[35.0,-120.0],[42.0,-114.0]],NH:[[42.7,-72.6],[45.3,-71.0]],NJ:[[38.9,-75.6],[41.4,-74.0]],NM:[[31.3,-109.1],[37.0,-103.0]],NY:[[40.5,-79.8],[45.0,-71.9]],NC:[[33.8,-84.3],[36.6,-75.5]],ND:[[45.9,-104.1],[49.0,-96.6]],OH:[[38.4,-84.8],[42.0,-80.5]],OK:[[33.6,-103.0],[37.0,-94.4]],OR:[[42.0,-124.6],[46.3,-116.5]],PA:[[39.7,-80.5],[42.3,-74.7]],RI:[[41.1,-71.9],[42.0,-71.1]],SC:[[32.0,-83.4],[35.2,-78.5]],SD:[[42.5,-104.1],[46.0,-96.4]],TN:[[35.0,-90.3],[36.7,-81.6]],TX:[[25.8,-106.6],[36.5,-93.5]],UT:[[37.0,-114.1],[42.0,-109.0]],VT:[[42.7,-73.4],[45.0,-71.5]],VA:[[36.5,-83.7],[39.5,-75.2]],WA:[[45.5,-124.8],[49.0,-116.9]],WV:[[37.2,-82.6],[40.6,-77.7]],WI:[[42.5,-92.9],[47.1,-86.2]],WY:[[41.0,-111.1],[45.0,-104.1]],DC:[[38.8,-77.1],[38.99,-76.9]] };

// ─── Top 50 MSAs (2025 Census Bureau estimates) ───
const MSA_DATA = [
  { name: "New York-Newark", pop: 20200000, states: ["NY","NJ","CT","PA"], lat: 40.71, lng: -74.01 },
  { name: "Los Angeles-Long Beach", pop: 13100000, states: ["CA"], lat: 34.05, lng: -118.24 },
  { name: "Chicago-Naperville", pop: 9500000, states: ["IL","IN","WI"], lat: 41.88, lng: -87.63 },
  { name: "Dallas-Fort Worth", pop: 8100000, states: ["TX"], lat: 32.78, lng: -96.80 },
  { name: "Houston-Woodlands", pop: 7500000, states: ["TX"], lat: 29.76, lng: -95.37 },
  { name: "Washington-Arlington", pop: 6400000, states: ["DC","VA","MD","WV"], lat: 38.91, lng: -77.04 },
  { name: "Philadelphia-Camden", pop: 6300000, states: ["PA","NJ","DE","MD"], lat: 39.95, lng: -75.17 },
  { name: "Atlanta-Sandy Springs", pop: 6300000, states: ["GA"], lat: 33.75, lng: -84.39 },
  { name: "Miami-Fort Lauderdale", pop: 6200000, states: ["FL"], lat: 25.76, lng: -80.19 },
  { name: "Phoenix-Mesa", pop: 5200000, states: ["AZ"], lat: 33.45, lng: -112.07 },
  { name: "Boston-Cambridge", pop: 4950000, states: ["MA","NH"], lat: 42.36, lng: -71.06 },
  { name: "Riverside-San Bernardino", pop: 4800000, states: ["CA"], lat: 33.95, lng: -117.40 },
  { name: "San Francisco-Oakland", pop: 4600000, states: ["CA"], lat: 37.77, lng: -122.42 },
  { name: "Detroit-Warren", pop: 4350000, states: ["MI"], lat: 42.33, lng: -83.05 },
  { name: "Seattle-Tacoma", pop: 4200000, states: ["WA"], lat: 47.61, lng: -122.33 },
  { name: "Minneapolis-St. Paul", pop: 3750000, states: ["MN","WI"], lat: 44.98, lng: -93.27 },
  { name: "Tampa-St. Petersburg", pop: 3400000, states: ["FL"], lat: 27.95, lng: -82.46 },
  { name: "San Diego-Chula Vista", pop: 3350000, states: ["CA"], lat: 32.72, lng: -117.16 },
  { name: "Denver-Aurora", pop: 3100000, states: ["CO"], lat: 39.74, lng: -104.99 },
  { name: "St. Louis", pop: 2820000, states: ["MO","IL"], lat: 38.63, lng: -90.20 },
  { name: "Orlando-Kissimmee", pop: 2850000, states: ["FL"], lat: 28.54, lng: -81.38 },
  { name: "Charlotte-Concord", pop: 2850000, states: ["NC","SC"], lat: 35.23, lng: -80.84 },
  { name: "San Antonio-New Braunfels", pop: 2700000, states: ["TX"], lat: 29.42, lng: -98.49 },
  { name: "Portland-Vancouver", pop: 2550000, states: ["OR","WA"], lat: 45.51, lng: -122.68 },
  { name: "Sacramento-Roseville", pop: 2500000, states: ["CA"], lat: 38.58, lng: -121.49 },
  { name: "Pittsburgh", pop: 2360000, states: ["PA"], lat: 40.44, lng: -80.00 },
  { name: "Austin-Round Rock", pop: 2550000, states: ["TX"], lat: 30.27, lng: -97.74 },
  { name: "Las Vegas-Henderson", pop: 2500000, states: ["NV"], lat: 36.17, lng: -115.14 },
  { name: "Cincinnati", pop: 2280000, states: ["OH","KY","IN"], lat: 39.10, lng: -84.51 },
  { name: "Kansas City", pop: 2220000, states: ["MO","KS"], lat: 39.10, lng: -94.58 },
  { name: "Columbus OH", pop: 2200000, states: ["OH"], lat: 39.96, lng: -82.99 },
  { name: "Indianapolis", pop: 2170000, states: ["IN"], lat: 39.77, lng: -86.16 },
  { name: "Cleveland-Elyria", pop: 2060000, states: ["OH"], lat: 41.50, lng: -81.69 },
  { name: "Nashville-Davidson", pop: 2080000, states: ["TN"], lat: 36.16, lng: -86.78 },
  { name: "San Jose-Sunnyvale", pop: 1980000, states: ["CA"], lat: 37.34, lng: -121.89 },
  { name: "Virginia Beach-Norfolk", pop: 1810000, states: ["VA","NC"], lat: 36.85, lng: -75.98 },
  { name: "Jacksonville FL", pop: 1700000, states: ["FL"], lat: 30.33, lng: -81.66 },
  { name: "Providence-Warwick", pop: 1640000, states: ["RI","MA"], lat: 41.82, lng: -71.41 },
  { name: "Milwaukee-Waukesha", pop: 1580000, states: ["WI"], lat: 43.04, lng: -87.91 },
  { name: "Raleigh-Cary", pop: 1550000, states: ["NC"], lat: 35.78, lng: -78.64 },
  { name: "Memphis", pop: 1340000, states: ["TN","MS","AR"], lat: 35.15, lng: -90.05 },
  { name: "Oklahoma City", pop: 1470000, states: ["OK"], lat: 35.47, lng: -97.52 },
  { name: "Louisville-Jefferson", pop: 1310000, states: ["KY","IN"], lat: 38.25, lng: -85.76 },
  { name: "Richmond VA", pop: 1340000, states: ["VA"], lat: 37.54, lng: -77.44 },
  { name: "Salt Lake City", pop: 1300000, states: ["UT"], lat: 40.76, lng: -111.89 },
  { name: "Hartford-East Hartford", pop: 1220000, states: ["CT"], lat: 41.76, lng: -72.68 },
  { name: "Birmingham-Hoover", pop: 1130000, states: ["AL"], lat: 33.52, lng: -86.80 },
  { name: "Buffalo-Cheektowaga", pop: 1120000, states: ["NY"], lat: 42.89, lng: -78.88 },
  { name: "Rochester NY", pop: 1090000, states: ["NY"], lat: 43.16, lng: -77.61 },
  { name: "Grand Rapids MI", pop: 1100000, states: ["MI"], lat: 42.96, lng: -85.66 },
];

const USA_CENTER = [39.82, -98.58]; // USGS geographic center

// ─── Sub-components ───
function MapClickHandler({ psLocations, pipelineSites, onClickResult }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      let nearestPS = null, minPSDist = Infinity;
      for (const ps of psLocations) { const d = haversine(lat, lng, ps.lat, ps.lng); if (d < minPSDist) { minPSDist = d; nearestPS = ps; } }
      let nearestPipe = null, minPipeDist = Infinity;
      for (const s of pipelineSites) { if (!s._lat) continue; const d = haversine(lat, lng, s._lat, s._lng); if (d < minPipeDist) { minPipeDist = d; nearestPipe = s; } }
      const signal = minPSDist > 35 ? "OUTSIDE FOOTPRINT" : minPSDist > 20 ? "PRIME" : minPSDist > 10 ? "STRONG" : "COVERED";
      const signalColor = signal === "PRIME" ? GOLD : signal === "STRONG" ? "#22C55E" : signal === "OUTSIDE FOOTPRINT" ? "#EF4444" : STEEL;
      onClickResult({ lat, lng, nearestPS, minPSDist, nearestPipe, minPipeDist, signal, signalColor });
    },
  });
  return null;
}

function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => { if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 }); }, [bounds, map]);
  return null;
}

// P1 fix: memoized path options per distance tier (not per cell)
const PATH_TIERS = [
  { max: 10, opts: { fillColor: gapColor(5), fillOpacity: 1, color: gapBorder(5), weight: 0.5 } },
  { max: 20, opts: { fillColor: gapColor(15), fillOpacity: 1, color: gapBorder(15), weight: 0.5 } },
  { max: 35, opts: { fillColor: gapColor(25), fillOpacity: 1, color: gapBorder(25), weight: 0.5 } },
  { max: Infinity, opts: { fillColor: gapColor(40), fillOpacity: 1, color: gapBorder(40), weight: 0.5 } },
];
const getPathOpts = (dist) => { for (const t of PATH_TIERS) if (dist <= t.max) return t.opts; return PATH_TIERS[3].opts; };

function CoverageGrid({ grid }) {
  const map = useMap();
  const [visibleCells, setVisibleCells] = useState([]);
  const update = useCallback(() => {
    if (!map || !grid.length) return;
    const b = map.getBounds(); const z = map.getZoom();
    if (z > 10) { setVisibleCells([]); return; }
    setVisibleCells(grid.filter(c => !(c.lat + 0.25 < b.getSouth() || c.lat > b.getNorth() || c.lng + 0.25 < b.getWest() || c.lng > b.getEast())));
  }, [grid, map]);
  useEffect(() => { update(); }, [update]);
  useMapEvents({ moveend: update, zoomend: update });
  return visibleCells.map(c => <Rectangle key={`${c.lat}-${c.lng}`} bounds={[[c.lat, c.lng], [c.lat + 0.25, c.lng + 0.25]]} pathOptions={getPathOpts(c.dist)} />);
}

// ─── Main Component ───
export function DiscoverMap({ psLocations, pipelineSites, onSiteClick }) {
  const [showCoverage, setShowCoverage] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(true);
  const [showSatellite, setShowSatellite] = useState(false);
  const [showDemographics, setShowDemographics] = useState(false);
  const [demoMode, setDemoMode] = useState("population");
  const [showAITargets, setShowAITargets] = useState(false);
  const [leaderboardMode, setLeaderboardMode] = useState("state");
  const [clickResult, setClickResult] = useState(null);
  const [leaderboardSort, setLeaderboardSort] = useState("gap");
  const [leaderboardSearch, setLeaderboardSearch] = useState("");
  const [fitBounds, setFitBounds] = useState(null);
  const [coverageGrid, setCoverageGrid] = useState([]);
  const [gridComputing, setGridComputing] = useState(false);
  const [countyGeoJSON, setCountyGeoJSON] = useState(null);
  const [countyLoading, setCountyLoading] = useState(false);
  const [countyError, setCountyError] = useState(null);
  const [timeLapsePlaying, setTimeLapsePlaying] = useState(false);
  const [timeLapseYear, setTimeLapseYear] = useState(2026);
  const [timeLapseLocations, setTimeLapseLocations] = useState([]);
  const timeLapseRef = useRef(null);
  const mapRef = useRef(null);

  // P0 fix #6: Parse pipeline coords with logging
  const pipeSites = useMemo(() => {
    const valid = [];
    let invalid = 0;
    for (const s of pipelineSites) {
      if (!s.coordinates) { invalid++; continue; }
      const parts = s.coordinates.split(",").map(v => parseFloat(v.trim()));
      if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) { invalid++; continue; }
      valid.push({ ...s, _lat: parts[0], _lng: parts[1] });
    }
    if (invalid > 0) console.warn(`DiscoverMap: ${invalid} pipeline sites have invalid/missing coordinates`);
    return valid;
  }, [pipelineSites]);

  // ─── Coverage Grid (chunked to avoid UI freeze — P0 fix #3) ───
  useEffect(() => {
    if (!showCoverage || coverageGrid.length > 0 || gridComputing || psLocations.length === 0) return;
    setGridComputing(true);
    // Build spatial index
    const bins = {};
    for (const ps of psLocations) { const key = `${Math.floor(ps.lat)},${Math.floor(ps.lng)}`; if (!bins[key]) bins[key] = []; bins[key].push(ps); }
    // Compute in chunks via setTimeout to keep UI responsive
    const grid = []; const step = 0.25; let lat = 24.5;
    const processChunk = () => {
      const endLat = Math.min(lat + 2.5, 49.75); // 10 rows per chunk
      for (; lat < endLat; lat += step) {
        for (let lng = -125; lng <= -66.5; lng += step) {
          let minDist = Infinity; const cLat = Math.floor(lat), cLng = Math.floor(lng);
          for (let dLat = -2; dLat <= 2; dLat++) { for (let dLng = -2; dLng <= 2; dLng++) { const bin = bins[`${cLat + dLat},${cLng + dLng}`]; if (!bin) continue; for (const ps of bin) { const d = haversine(lat + step / 2, lng + step / 2, ps.lat, ps.lng); if (d < minDist) minDist = d; } } }
          grid.push({ lat: +(lat.toFixed(2)), lng: +(lng.toFixed(2)), dist: minDist });
        }
      }
      if (lat < 49.5) { setTimeout(processChunk, 0); } else { setCoverageGrid(grid); setGridComputing(false); }
    };
    processChunk();
  }, [showCoverage, psLocations, coverageGrid.length, gridComputing]);

  // ─── County GeoJSON (P1 fix: error handling) ───
  useEffect(() => {
    if (!showDemographics || countyGeoJSON || countyLoading || countyError) return;
    setCountyLoading(true);
    fetch("https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setCountyGeoJSON(data); setCountyLoading(false); })
      .catch(err => { console.error("County GeoJSON load failed:", err); setCountyLoading(false); setCountyError(err.message); });
  }, [showDemographics, countyGeoJSON, countyLoading, countyError]);

  // P1 fix: Precompute county centroids once
  const countyCentroids = useMemo(() => {
    if (!countyGeoJSON) return new Map();
    const map = new Map();
    countyGeoJSON.features.forEach((f, idx) => {
      try {
        const coords = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates[0][0] : f.geometry.coordinates[0];
        const avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        const avgLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        map.set(idx, [avgLat, avgLng]);
      } catch { /* skip malformed */ }
    });
    return map;
  }, [countyGeoJSON]);

  // P1 fix: Build PS spatial index for county styling (sample every 10th)
  const psSample = useMemo(() => psLocations.filter((_, i) => i % 10 === 0), [psLocations]);

  const countyStyle = useCallback((feature) => {
    if (!countyGeoJSON) return { fillColor: "rgba(30,30,40,0.2)", fillOpacity: 1, color: "rgba(255,255,255,0.05)", weight: 0.5 };
    const idx = countyGeoJSON.features.indexOf(feature);
    const centroid = countyCentroids.get(idx);
    if (!centroid) return { fillColor: "rgba(30,30,40,0.2)", fillOpacity: 1, color: "rgba(255,255,255,0.05)", weight: 0.5 };
    let minDist = Infinity;
    for (const ps of psSample) { const d = haversine(centroid[0], centroid[1], ps.lat, ps.lng); if (d < minDist) minDist = d; }
    let fillColor;
    if (demoMode === "population") { fillColor = minDist <= 5 ? "#C9A84C" : minDist <= 15 ? "#8B6914" : minDist <= 30 ? "#5C4A1E" : minDist <= 50 ? "#3D3520" : minDist <= 80 ? "#2A2820" : "rgba(30,30,40,0.3)"; }
    else if (demoMode === "income") { fillColor = minDist <= 5 ? "#22C55E" : minDist <= 15 ? "#16A34A" : minDist <= 30 ? "#0D6B30" : minDist <= 50 ? "#1A3D25" : "rgba(30,30,40,0.3)"; }
    else { fillColor = minDist >= 50 ? "#C9A84C" : minDist >= 30 ? "#8B6914" : minDist >= 15 ? "#5C4A1E" : "#2A2820"; }
    return { fillColor, fillOpacity: 0.85, color: "rgba(255,255,255,0.06)", weight: 0.5 };
  }, [countyGeoJSON, countyCentroids, psSample, demoMode]);

  // ─── Time-Lapse (P0 fix #8: clean interval management) ───
  const allTimeLapseFrames = useMemo(() => {
    if (psLocations.length === 0) return {};
    const sorted = [...psLocations].sort((a, b) => (parseInt((a.num || "").replace(/\D/g, "")) || 0) - (parseInt((b.num || "").replace(/\D/g, "")) || 0));
    const frames = {}; const years = [];
    for (let y = 1972; y <= 2026; y += 2) years.push(y);
    years.forEach((year, idx) => { frames[year] = sorted.slice(0, Math.round(((idx + 1) / years.length) * sorted.length)); });
    return frames;
  }, [psLocations]);

  useEffect(() => {
    if (!timeLapsePlaying) { if (timeLapseRef.current) clearInterval(timeLapseRef.current); return; }
    let year = 1972;
    setTimeLapseYear(1972);
    setTimeLapseLocations(allTimeLapseFrames[1972] || []);
    const id = setInterval(() => {
      year += 2;
      if (year > 2026) { clearInterval(id); setTimeLapsePlaying(false); setTimeLapseLocations(psLocations); setTimeLapseYear(2026); return; }
      setTimeLapseYear(year);
      setTimeLapseLocations(allTimeLapseFrames[year] || []);
    }, 600);
    timeLapseRef.current = id;
    return () => clearInterval(id); // P0 fix: always clean up
  }, [timeLapsePlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── AI Expansion Targets (P0 fix #7: corrected scoring) ───
  const aiTargets = useMemo(() => {
    if (!showAITargets || psLocations.length === 0) return [];
    const excluded = new Set(["CA", "WY", "OR", "WA"]);
    return MSA_DATA.filter(m => !m.states.some(s => excluded.has(s))).map(m => {
      let psCount = 0;
      for (const ps of psLocations) { if (haversine(m.lat, m.lng, ps.lat, ps.lng) <= 25) psCount++; }
      let pipeCount = 0;
      for (const s of pipeSites) { if (haversine(m.lat, m.lng, s._lat, s._lng) <= 25) pipeCount++; }
      const popPerPS = psCount > 0 ? m.pop / psCount : m.pop;
      // Normalized 0-10: ratio score (people per PS / 50K) minus pipeline penalty (0.5 per site)
      const ratioScore = Math.min(10, popPerPS / 50000);
      const pipelinePenalty = Math.min(5, pipeCount * 0.5);
      const score = Math.max(0, ratioScore - pipelinePenalty);
      return { ...m, psCount, pipeCount, popPerPS, score };
    }).sort((a, b) => b.score - a.score).slice(0, 10);
  }, [showAITargets, psLocations, pipeSites]);

  // ─── State Leaderboard ───
  const stateStats = useMemo(() => {
    const stats = {};
    for (const ps of psLocations) { const st = ps.state?.trim().toUpperCase(); if (!st) continue; if (!stats[st]) stats[st] = { state: st, psCount: 0, pipelineCount: 0 }; stats[st].psCount++; }
    for (const s of pipeSites) { const st = s.state?.trim().toUpperCase(); if (!st) continue; if (!stats[st]) stats[st] = { state: st, psCount: 0, pipelineCount: 0 }; stats[st].pipelineCount++; }
    return Object.values(stats).map(s => {
      const pop = STATE_POP[s.state] || 0;
      const ratio = s.psCount > 0 ? pop / s.psCount : Infinity; // P1 fix: Infinity not 999
      s.gapScore = s.psCount === 0 && pop > 0 ? 10 : ratio >= 500000 ? 10 : ratio >= 300000 ? 9 : ratio >= 200000 ? 8 : ratio >= 150000 ? 7 : ratio >= 100000 ? 6 : ratio >= 75000 ? 5 : ratio >= 50000 ? 4 : ratio >= 30000 ? 3 : 2;
      s.pop = pop; return s;
    });
  }, [psLocations, pipeSites]);

  // ─── MSA Leaderboard ───
  const msaStats = useMemo(() => {
    return MSA_DATA.map(m => {
      let psCount = 0; for (const ps of psLocations) { if (haversine(m.lat, m.lng, ps.lat, ps.lng) <= 30) psCount++; }
      let pipeCount = 0; for (const s of pipeSites) { if (haversine(m.lat, m.lng, s._lat, s._lng) <= 30) pipeCount++; }
      const ratio = psCount > 0 ? m.pop / psCount : Infinity;
      const gapScore = psCount === 0 ? 10 : ratio >= 500000 ? 10 : ratio >= 300000 ? 9 : ratio >= 200000 ? 8 : ratio >= 150000 ? 7 : ratio >= 100000 ? 6 : ratio >= 75000 ? 5 : ratio >= 50000 ? 4 : ratio >= 30000 ? 3 : 2;
      return { ...m, psCount, pipeCount, gapScore, ratio };
    });
  }, [psLocations, pipeSites]);

  const sortedStats = useMemo(() => {
    const source = leaderboardMode === "msa" ? msaStats : stateStats;
    let filtered = source;
    if (leaderboardSearch) { const q = leaderboardSearch.toUpperCase(); filtered = filtered.filter(s => (s.state || s.name || "").toUpperCase().includes(q)); }
    const sorted = [...filtered];
    if (leaderboardSort === "gap") sorted.sort((a, b) => b.gapScore - a.gapScore);
    else if (leaderboardSort === "ps") sorted.sort((a, b) => b.psCount - a.psCount);
    else if (leaderboardSort === "pipeline") sorted.sort((a, b) => (b.pipelineCount || b.pipeCount || 0) - (a.pipelineCount || a.pipeCount || 0));
    else if (leaderboardSort === "pop") sorted.sort((a, b) => (b.pop || 0) - (a.pop || 0));
    else if (leaderboardSort === "state") sorted.sort((a, b) => (a.state || a.name || "").localeCompare(b.state || b.name || ""));
    return sorted;
  }, [stateStats, msaStats, leaderboardMode, leaderboardSort, leaderboardSearch]);

  const totalPipeline = pipeSites.length;
  const statesWithPS = new Set(psLocations.map(p => p.state?.trim().toUpperCase())).size;
  const displayLocations = timeLapsePlaying ? timeLapseLocations : psLocations;

  return (
    <div style={{ display: "flex", height: "calc(100vh - 140px)", position: "relative", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <MapContainer center={USA_CENTER} zoom={4} style={{ height: "100%", width: "100%", borderRadius: 12, overflow: "hidden" }} zoomControl={false} ref={mapRef}>
          {showSatellite
            ? <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles &copy; Esri" maxZoom={19} />
            : <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="&copy; CARTO" maxZoom={19} />
          }
          {/* P0 fix #2: GeoJSON keyed by demoMode — only re-creates when mode changes */}
          {showDemographics && countyGeoJSON && <GeoJSON key={`counties-${demoMode}`} data={countyGeoJSON} style={countyStyle} />}
          {showCoverage && coverageGrid.length > 0 && <CoverageGrid grid={coverageGrid} />}

          {/* P1 fix #11: stable keys using ps.num */}
          <MarkerClusterGroup chunkedLoading maxClusterRadius={50} spiderfyOnMaxZoom showCoverageOnHover={false} iconCreateFunction={createClusterIcon}>
            {displayLocations.map(ps => <Marker key={ps.num || `${ps.lat}-${ps.lng}`} position={[ps.lat, ps.lng]} icon={psIcon}>
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11 }}>
                  <strong style={{ color: FIRE }}>{ps.name || ps.num}</strong><br />{ps.address}, {ps.city} {ps.state}
                </div>
              </Tooltip>
            </Marker>)}
          </MarkerClusterGroup>

          {/* P0 fix #1: cached icons from PIPELINE_ICONS */}
          {!timeLapsePlaying && pipeSites.map(s => (
            <Marker key={s.id || `${s._lat}-${s._lng}`} position={[s._lat, s._lng]} icon={PIPELINE_ICONS[s.phase] || PIPELINE_ICONS["Prospect"]}
              eventHandlers={{ click: () => onSiteClick && onSiteClick(s) }}>
              <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, maxWidth: 220 }}>
                  <strong style={{ color: "#3B82F6" }}>{s.name || s.address || "Pipeline Site"}</strong><br />
                  <span style={{ color: "#9CA3AF" }}>{s.phase || "Prospect"} | {s.acreage ? s.acreage + " ac" : ""} {s.askingPrice ? "| " + s.askingPrice : ""}</span><br />
                  <span style={{ color: GOLD }}>{s._source === "DW" ? "Daniel Wollent" : s._source === "MT" ? "Matthew Toussaint" : "Review Queue"}</span>
                </div>
              </Tooltip>
            </Marker>
          ))}

          {showAITargets && aiTargets.map((t, i) => (
            <Marker key={`ai-${t.name}`} position={[t.lat, t.lng]} icon={aiTargetIcon}>
              <Tooltip direction="top" offset={[0, -14]} opacity={0.95}>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, minWidth: 200 }}>
                  <strong style={{ color: GOLD }}>#{i + 1} {t.name}</strong><br />
                  <span style={{ color: "#6B7394" }}>Pop: {(t.pop / 1000000).toFixed(1)}M | PS: {t.psCount} | Pipeline: {t.pipeCount}</span><br />
                  <span style={{ color: FIRE, fontWeight: 700 }}>{(t.popPerPS / 1000).toFixed(0)}K people per PS</span>
                </div>
              </Tooltip>
            </Marker>
          ))}

          <MapClickHandler psLocations={psLocations} pipelineSites={pipeSites} onClickResult={setClickResult} />
          {fitBounds && <FitBounds bounds={fitBounds} />}

          {timeLapsePlaying && <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 2000, pointerEvents: "none", fontSize: 72, fontWeight: 900, color: GOLD, fontFamily: "'Inter',sans-serif", textShadow: `0 0 40px ${GOLD}66,0 0 80px ${NAVY}`, opacity: 0.7, letterSpacing: 4 }}>{timeLapseYear}</div>}

          {clickResult && (
            <Popup position={[clickResult.lat, clickResult.lng]} onClose={() => setClickResult(null)}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, minWidth: 240 }}>
                <div style={{ background: clickResult.signalColor, color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, marginBottom: 8, textAlign: "center", letterSpacing: 1 }}>{clickResult.signal}</div>
                <div style={{ marginBottom: 6 }}><strong>Nearest PS:</strong> {clickResult.nearestPS?.name || "—"}<br /><span style={{ color: "#6B7394" }}>{clickResult.nearestPS?.city} {clickResult.nearestPS?.state} — <strong style={{ color: FIRE }}>{clickResult.minPSDist.toFixed(1)} mi</strong></span></div>
                {clickResult.nearestPipe && <div style={{ marginBottom: 6 }}><strong>Nearest Pipeline:</strong> {clickResult.nearestPipe.name || clickResult.nearestPipe.address || "—"}<br /><span style={{ color: "#6B7394" }}>{clickResult.minPipeDist.toFixed(1)} mi — {clickResult.nearestPipe.phase}</span></div>}
                <div style={{ marginBottom: 6, color: "#6B7394", fontSize: 11 }}>{clickResult.lat.toFixed(4)}, {clickResult.lng.toFixed(4)}</div>
                <a href={`https://www.crexi.com/properties/Land?bounds=${[clickResult.lat - 0.15, clickResult.lng - 0.2, clickResult.lat + 0.15, clickResult.lng + 0.2].map(v => v.toFixed(4)).join(",")}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center", background: FIRE, color: "#fff", padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, textDecoration: "none", marginTop: 6 }}>Search Crexi for Land</a>
              </div>
            </Popup>
          )}
        </MapContainer>

        {/* Layer Controls */}
        <div style={{ position: "absolute", top: 16, right: showLeaderboard ? "calc(30% + 20px)" : 16, zIndex: 1000, display: "flex", flexDirection: "column", gap: 6, transition: "right 0.3s ease" }}>
          <LayerBtn active={showCoverage} onClick={() => setShowCoverage(!showCoverage)} label={gridComputing ? "Computing..." : showCoverage ? "Coverage ON" : "Coverage Gaps"} />
          <LayerBtn active={showDemographics} onClick={() => setShowDemographics(!showDemographics)} label={countyLoading ? "Loading..." : showDemographics ? "Counties ON" : "Demographics"} />
          {showDemographics && <div style={{ display: "flex", gap: 2, background: GLASS, borderRadius: 6, padding: 2, backdropFilter: "blur(12px)" }}>
            {["population", "income", "growth"].map(m => <button key={m} onClick={() => setDemoMode(m)} style={{ background: demoMode === m ? FIRE : "transparent", color: demoMode === m ? "#fff" : "#6B7394", border: "none", borderRadius: 4, padding: "3px 6px", fontSize: 9, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif", textTransform: "capitalize" }}>{m}</button>)}
          </div>}
          <LayerBtn active={showAITargets} onClick={() => setShowAITargets(!showAITargets)} label={showAITargets ? "AI Targets ON" : "AI Top 10"} color={GOLD} />
          <LayerBtn active={timeLapsePlaying} onClick={() => setTimeLapsePlaying(!timeLapsePlaying)} label={timeLapsePlaying ? `Playing ${timeLapseYear}` : "Time-Lapse"} color="#8B5CF6" />
          <LayerBtn active={showSatellite} onClick={() => setShowSatellite(!showSatellite)} label={showSatellite ? "Satellite ON" : "Satellite"} />
          <LayerBtn active={showLeaderboard} onClick={() => setShowLeaderboard(!showLeaderboard)} label="Leaderboard" />
        </div>

        {/* Legends */}
        {showCoverage && <div style={{ position: "absolute", bottom: 56, left: 16, zIndex: 1000, background: GLASS, backdropFilter: "blur(12px)", borderRadius: 10, padding: "10px 14px", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: GOLD, marginBottom: 6, letterSpacing: 1 }}>COVERAGE LEGEND</div>
          {[{ color: "rgba(232,122,46,0.50)", label: "0-10 mi — Dense PS Coverage" }, { color: "rgba(201,168,76,0.45)", label: "10-20 mi — Moderate" }, { color: "rgba(30,39,97,0.55)", label: "20-35 mi — Expansion Sweet Spot" }, { color: "rgba(100,100,100,0.30)", label: ">35 mi — Outside Footprint" }].map((item, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}><div style={{ width: 14, height: 14, borderRadius: 3, background: item.color }} /><span style={{ fontSize: 10, color: "#9CA3AF" }}>{item.label}</span></div>)}
        </div>}

        {showAITargets && aiTargets.length > 0 && <div style={{ position: "absolute", bottom: showCoverage ? 200 : 56, left: 16, zIndex: 1000, background: GLASS, backdropFilter: "blur(12px)", borderRadius: 10, padding: "10px 14px", border: `1px solid ${GOLD}33`, maxWidth: 280 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: GOLD, marginBottom: 8, letterSpacing: 1 }}>AI EXPANSION TARGETS</div>
          {aiTargets.map((t, i) => <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, cursor: "pointer" }} onClick={() => setFitBounds([[t.lat - 0.5, t.lng - 0.8], [t.lat + 0.5, t.lng + 0.8]])}><span style={{ fontSize: 10, fontWeight: 700, color: GOLD, width: 18 }}>#{i + 1}</span><span style={{ fontSize: 10, color: "#E2E8F0", flex: 1 }}>{t.name}</span><span style={{ fontSize: 9, color: FIRE, fontWeight: 600 }}>{(t.popPerPS / 1000).toFixed(0)}K/PS</span></div>)}
          <div style={{ fontSize: 8, color: "#4B5563", marginTop: 6 }}>Score: Pop/PS ratio (0-10) minus pipeline activity. Excludes CA/WY/OR/WA.</div>
        </div>}

        {countyError && <div style={{ position: "absolute", top: 100, left: 16, zIndex: 1000, background: "#EF4444", color: "#fff", padding: "8px 12px", borderRadius: 8, fontSize: 11 }}>Demographics failed: {countyError}</div>}

        {/* Stats Bar */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: showLeaderboard ? "30%" : 0, zIndex: 1000, background: DARK_BG, backdropFilter: "blur(12px)", borderTop: `1px solid rgba(201,168,76,0.15)`, padding: "8px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "right 0.3s ease" }}>
          <div style={{ display: "flex", gap: 24 }}>
            <StatChip label="PS Locations" value={displayLocations.length.toLocaleString()} color={FIRE} />
            <StatChip label="Pipeline" value={totalPipeline} color="#3B82F6" />
            <StatChip label="States" value={statesWithPS} color={GOLD} />
          </div>
          {timeLapsePlaying && <StatChip label="Year" value={timeLapseYear} color="#8B5CF6" />}
        </div>
      </div>

      {/* Leaderboard Side Panel */}
      {showLeaderboard && (
        <div style={{ width: "30%", minWidth: 280, maxWidth: 400, background: DARK_BG, borderLeft: `1px solid rgba(201,168,76,0.15)`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div><div style={{ fontSize: 13, fontWeight: 700, color: "#fff", letterSpacing: 0.5 }}>MARKET LEADERBOARD</div><div style={{ fontSize: 10, color: "#6B7394", marginTop: 2 }}>Expansion Opportunity</div></div>
              <button onClick={() => setShowLeaderboard(false)} style={{ background: "none", border: "none", color: "#6B7394", cursor: "pointer", fontSize: 16, padding: 4 }}>x</button>
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
              {[{ key: "state", label: "By State" }, { key: "msa", label: "By Metro (MSA)" }].map(m => <button key={m.key} onClick={() => { setLeaderboardMode(m.key); setLeaderboardSearch(""); }} style={{ flex: 1, background: leaderboardMode === m.key ? `${FIRE}22` : "rgba(255,255,255,0.03)", color: leaderboardMode === m.key ? FIRE : "#6B7394", border: `1px solid ${leaderboardMode === m.key ? FIRE + "44" : "rgba(255,255,255,0.06)"}`, borderRadius: 6, padding: "5px 8px", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>{m.label}</button>)}
            </div>
            <input type="text" placeholder={leaderboardMode === "msa" ? "Search metro..." : "Search state..."} value={leaderboardSearch} onChange={e => setLeaderboardSearch(e.target.value)} style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "6px 10px", color: "#fff", fontSize: 11, fontFamily: "'Inter',sans-serif", outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", gap: 2, padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {[{ key: "gap", label: "Gap Score" }, { key: "ps", label: "PS Locs" }, { key: "pipeline", label: "Pipeline" }, { key: "pop", label: "Population" }, { key: "state", label: leaderboardMode === "msa" ? "Name" : "State" }].map(s => <button key={s.key} onClick={() => setLeaderboardSort(s.key)} style={{ background: leaderboardSort === s.key ? "rgba(232,122,46,0.15)" : "transparent", color: leaderboardSort === s.key ? FIRE : "#6B7394", border: "none", borderRadius: 4, padding: "3px 6px", fontSize: 9, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>{s.label}</button>)}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
            {sortedStats.map((s, i) => {
              const label = leaderboardMode === "msa" ? s.name : s.state;
              const trunc = label && label.length > 16 ? label.slice(0, 15) + "..." : label;
              return <div key={label} onClick={() => { if (leaderboardMode === "msa" && s.lat) setFitBounds([[s.lat - 0.8, s.lng - 1.2], [s.lat + 0.8, s.lng + 1.2]]); else { const b = STATE_BOUNDS[s.state]; if (b) setFitBounds(b); } }}
                style={{ display: "grid", gridTemplateColumns: leaderboardMode === "msa" ? "28px 1fr 44px 44px 44px" : "28px 42px 1fr 48px 48px 44px", alignItems: "center", padding: "8px 16px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background 0.15s ease" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(232,122,46,0.08)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ fontSize: 10, color: "#4B5563", fontWeight: 600 }}>#{i + 1}</span>
                {leaderboardMode === "msa"
                  ? <span style={{ fontSize: 10, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trunc}</span>
                  : <><span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{s.state}</span><div><GapBar score={s.gapScore} /></div></>}
                <span style={{ fontSize: 10, color: FIRE, fontWeight: 600, textAlign: "right" }}>{s.psCount}</span>
                <span style={{ fontSize: 10, color: "#3B82F6", fontWeight: 600, textAlign: "right" }}>{s.pipeCount || s.pipelineCount || "—"}</span>
                <span style={{ fontSize: 10, fontWeight: 700, textAlign: "right", color: s.gapScore >= 8 ? GOLD : s.gapScore >= 6 ? "#22C55E" : "#6B7394" }}>{s.gapScore.toFixed(1)}</span>
              </div>;
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: leaderboardMode === "msa" ? "28px 1fr 44px 44px 44px" : "28px 42px 1fr 48px 48px 44px", padding: "6px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}>
            <span style={{ fontSize: 8, color: "#4B5563" }}>#</span>
            <span style={{ fontSize: 8, color: "#4B5563" }}>{leaderboardMode === "msa" ? "METRO" : "ST"}</span>
            {leaderboardMode !== "msa" && <span style={{ fontSize: 8, color: "#4B5563" }}>GAP</span>}
            <span style={{ fontSize: 8, color: "#4B5563", textAlign: "right" }}>PS</span>
            <span style={{ fontSize: 8, color: "#4B5563", textAlign: "right" }}>PIPE</span>
            <span style={{ fontSize: 8, color: "#4B5563", textAlign: "right" }}>SCORE</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LayerBtn({ active, onClick, label, color }) {
  const c = color || FIRE;
  return <button onClick={onClick} style={{ background: active ? c : GLASS, color: active ? "#fff" : "#9CA3AF", border: `1px solid ${active ? c : "rgba(255,255,255,0.1)"}`, padding: "8px 14px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif", backdropFilter: "blur(12px)", transition: "all 0.2s ease", whiteSpace: "nowrap" }}>{label}</button>;
}
function StatChip({ label, value, color }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}44` }} /><span style={{ fontSize: 10, color: "#6B7394" }}>{label}:</span><span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{value}</span></div>;
}
function GapBar({ score }) {
  const pct = (score / 10) * 100;
  const color = score >= 8 ? GOLD : score >= 6 ? "#22C55E" : score >= 4 ? "#6B7394" : "#374151";
  return <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden", width: "100%" }}><div style={{ height: "100%", width: `${pct}%`, borderRadius: 3, background: `linear-gradient(90deg, ${color}, ${color}88)`, transition: "width 0.3s ease" }} /></div>;
}
export default DiscoverMap;
