// src/components/DiscoverMap.js — Market Discovery & Whitespace Analysis
// © 2026 DJR Real Estate LLC. All rights reserved.
// IPO-grade national PS footprint visualization, coverage gap analysis, market leaderboard

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Rectangle, useMapEvents, useMap, Tooltip } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import { haversine } from "../haversine";

// ─── Brand Constants ───
const NAVY = "#1E2761";
const GOLD = "#C9A84C";
const ICE = "#D6E4F7";
const STEEL = "#2C3E6B";
const FIRE = "#E87A2E";
const DARK_BG = "rgba(13,17,38,0.95)";
const GLASS = "rgba(20,24,50,0.88)";

// ─── Coverage Gap Color Scheme ───
const gapColor = (dist) => {
  if (dist <= 10) return "rgba(232,122,46,0.30)";     // Dense PS coverage (orange)
  if (dist <= 20) return "rgba(201,168,76,0.22)";     // Moderate (gold)
  if (dist <= 35) return "rgba(30,39,97,0.28)";       // Expansion sweet spot (navy) — THE MONEY ZONE
  return "rgba(100,100,100,0.10)";                     // Outside footprint (gray)
};
const gapBorder = (dist) => {
  if (dist <= 10) return "rgba(232,122,46,0.08)";
  if (dist <= 20) return "rgba(201,168,76,0.06)";
  if (dist <= 35) return "rgba(30,39,97,0.10)";
  return "rgba(100,100,100,0.04)";
};

// ─── Custom Marker Icons ───
const psIcon = L.divIcon({
  className: "ps-marker",
  html: `<div style="width:10px;height:10px;border-radius:50%;background:${FIRE};border:2px solid #fff;box-shadow:0 0 6px rgba(232,122,46,0.6)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const pipelineIcon = (phase) => {
  const color = phase === "Under Contract" ? "#16A34A"
    : phase === "LOI" || phase === "LOI Sent" || phase === "LOI Signed" || phase === "PSA Sent" ? "#F59E0B"
    : phase === "SiteScore Approved" ? "#8B5CF6"
    : phase === "Submitted to PS" ? "#6366F1"
    : phase === "Closed" ? "#059669"
    : "#3B82F6"; // Prospect
  return L.divIcon({
    className: "pipeline-marker",
    html: `<div style="width:14px;height:14px;transform:rotate(45deg);background:${color};border:2px solid #fff;box-shadow:0 0 8px ${color}66"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
};

// ─── Cluster Icon Factory ───
const createClusterIcon = (cluster) => {
  const count = cluster.getChildCount();
  const size = count < 50 ? 36 : count < 200 ? 44 : 52;
  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:linear-gradient(135deg,${NAVY},${STEEL});
      border:2px solid ${GOLD};
      color:${GOLD};font-weight:700;font-size:${count < 50 ? 11 : 10}px;font-family:'Inter',sans-serif;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 12px rgba(30,39,97,0.5),0 0 20px rgba(201,168,76,0.2);
    ">${count}</div>`,
    className: "ps-cluster-icon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

// ─── State Population Data (2025 estimates — for leaderboard gap score) ───
const STATE_POP = {
  AL:5108468,AK:733406,AZ:7431344,AR:3067732,CA:38965193,CO:5957474,CT:3617176,
  DE:1031890,FL:23372215,GA:11029227,HI:1435138,ID:2001619,IL:12516863,IN:6862199,
  IA:3207004,KS:2940546,KY:4526154,LA:4573749,ME:1395722,MD:6180253,MA:7001399,
  MI:10037261,MN:5737915,MS:2939690,MO:6196156,MT:1132812,NE:1978379,NV:3194176,
  NH:1402054,NJ:9290841,NM:2114371,NY:19571216,NC:10835491,ND:783926,OH:11785935,
  OK:4019800,OR:4240137,PA:12961683,RI:1095962,SC:5373555,SD:909824,TN:7126489,
  TX:30503301,UT:3417734,VT:647464,VA:8683619,WA:7812880,WV:1770071,WI:5910955,
  WY:584057,DC:678972,
};

// ─── State Bounding Boxes (for zoom-on-click) ───
const STATE_BOUNDS = {
  AL:[[30.2,-88.5],[35.0,-84.9]],AK:[[51.2,-179.1],[71.4,-129.9]],AZ:[[31.3,-114.8],[37.0,-109.0]],
  AR:[[33.0,-94.6],[36.5,-89.6]],CA:[[32.5,-124.5],[42.0,-114.1]],CO:[[37.0,-109.1],[41.0,-102.0]],
  CT:[[41.0,-73.7],[42.1,-71.8]],DE:[[38.5,-75.8],[39.8,-75.0]],FL:[[24.5,-87.6],[31.0,-80.0]],
  GA:[[30.4,-85.6],[35.0,-80.8]],HI:[[18.9,-160.3],[22.2,-154.8]],ID:[[42.0,-117.2],[49.0,-111.0]],
  IL:[[37.0,-91.5],[42.5,-87.5]],IN:[[37.8,-88.1],[41.8,-84.8]],IA:[[40.4,-96.6],[43.5,-90.1]],
  KS:[[37.0,-102.1],[40.0,-94.6]],KY:[[36.5,-89.6],[39.1,-82.0]],LA:[[28.9,-94.0],[33.0,-89.0]],
  ME:[[43.1,-71.1],[47.5,-66.9]],MD:[[37.9,-79.5],[39.7,-75.0]],MA:[[41.2,-73.5],[42.9,-69.9]],
  MI:[[41.7,-90.4],[48.2,-82.4]],MN:[[43.5,-97.2],[49.4,-89.5]],MS:[[30.2,-91.7],[35.0,-88.1]],
  MO:[[36.0,-95.8],[40.6,-89.1]],MT:[[44.4,-116.0],[49.0,-104.0]],NE:[[40.0,-104.1],[43.0,-95.3]],
  NV:[[35.0,-120.0],[42.0,-114.0]],NH:[[42.7,-72.6],[45.3,-71.0]],NJ:[[38.9,-75.6],[41.4,-74.0]],
  NM:[[31.3,-109.1],[37.0,-103.0]],NY:[[40.5,-79.8],[45.0,-71.9]],NC:[[33.8,-84.3],[36.6,-75.5]],
  ND:[[45.9,-104.1],[49.0,-96.6]],OH:[[38.4,-84.8],[42.0,-80.5]],OK:[[33.6,-103.0],[37.0,-94.4]],
  OR:[[42.0,-124.6],[46.3,-116.5]],PA:[[39.7,-80.5],[42.3,-74.7]],RI:[[41.1,-71.9],[42.0,-71.1]],
  SC:[[32.0,-83.4],[35.2,-78.5]],SD:[[42.5,-104.1],[46.0,-96.4]],TN:[[35.0,-90.3],[36.7,-81.6]],
  TX:[[25.8,-106.6],[36.5,-93.5]],UT:[[37.0,-114.1],[42.0,-109.0]],VT:[[42.7,-73.4],[45.0,-71.5]],
  VA:[[36.5,-83.7],[39.5,-75.2]],WA:[[45.5,-124.8],[49.0,-116.9]],WV:[[37.2,-82.6],[40.6,-77.7]],
  WI:[[42.5,-92.9],[47.1,-86.2]],WY:[[41.0,-111.1],[45.0,-104.1]],DC:[[38.8,-77.1],[38.99,-76.9]],
};

// ─── Click Handler Component ───
function MapClickHandler({ psLocations, pipelineSites, onClickResult }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      // Find nearest PS
      let nearestPS = null, minPSDist = Infinity;
      for (const ps of psLocations) {
        const d = haversine(lat, lng, ps.lat, ps.lng);
        if (d < minPSDist) { minPSDist = d; nearestPS = ps; }
      }
      // Find nearest pipeline site
      let nearestPipe = null, minPipeDist = Infinity;
      for (const s of pipelineSites) {
        if (!s._lat) continue;
        const d = haversine(lat, lng, s._lat, s._lng);
        if (d < minPipeDist) { minPipeDist = d; nearestPipe = s; }
      }
      // Classify opportunity
      const signal = minPSDist > 35 ? "OUTSIDE FOOTPRINT"
        : minPSDist > 20 ? "PRIME"
        : minPSDist > 10 ? "STRONG"
        : "COVERED";
      const signalColor = signal === "PRIME" ? GOLD
        : signal === "STRONG" ? "#22C55E"
        : signal === "OUTSIDE FOOTPRINT" ? "#EF4444"
        : STEEL;

      onClickResult({
        lat, lng, nearestPS, minPSDist, nearestPipe, minPipeDist, signal, signalColor,
      });
    },
  });
  return null;
}

// ─── Fit Bounds Helper ───
function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
  }, [bounds, map]);
  return null;
}

// ─── Coverage Grid Component (renders only visible cells) ───
function CoverageGrid({ grid, map }) {
  const [visibleCells, setVisibleCells] = useState([]);
  const updateVisible = useCallback(() => {
    if (!map || !grid.length) return;
    const b = map.getBounds();
    const z = map.getZoom();
    // At very high zoom, grid cells are too big to be useful
    if (z > 10) { setVisibleCells([]); return; }
    const filtered = grid.filter(c =>
      c.lat + 0.25 >= b.getSouth() && c.lat <= b.getNorth() &&
      c.lng + 0.25 >= b.getWest() && c.lng <= b.getEast()
    );
    setVisibleCells(filtered);
  }, [grid, map]);

  useEffect(() => { updateVisible(); }, [updateVisible]);

  useMapEvents({ moveend: updateVisible, zoomend: updateVisible });

  return visibleCells.map((c, i) => (
    <Rectangle
      key={`${c.lat}-${c.lng}`}
      bounds={[[c.lat, c.lng], [c.lat + 0.25, c.lng + 0.25]]}
      pathOptions={{ fillColor: gapColor(c.dist), fillOpacity: 1, color: gapBorder(c.dist), weight: 0.5 }}
    />
  ));
}

// ─── CoverageGridWrapper (bridges useMap into CoverageGrid) ───
function CoverageGridWrapper({ grid }) {
  const map = useMap();
  return <CoverageGrid grid={grid} map={map} />;
}

// ─── Main Component ───
export function DiscoverMap({ psLocations, pipelineSites, onSiteClick }) {
  const [showCoverage, setShowCoverage] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(true);
  const [showSatellite, setShowSatellite] = useState(false);
  const [clickResult, setClickResult] = useState(null);
  const [leaderboardSort, setLeaderboardSort] = useState("gap");
  const [leaderboardSearch, setLeaderboardSearch] = useState("");
  const [fitBounds, setFitBounds] = useState(null);
  const [coverageGrid, setCoverageGrid] = useState([]);
  const [gridComputing, setGridComputing] = useState(false);
  const mapRef = useRef(null);

  // Parse pipeline coordinates once
  const pipeSites = useMemo(() => {
    return pipelineSites.filter(s => s.coordinates).map(s => {
      const parts = s.coordinates.split(",").map(v => parseFloat(v.trim()));
      if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
      return { ...s, _lat: parts[0], _lng: parts[1] };
    }).filter(Boolean);
  }, [pipelineSites]);

  // Compute coverage grid with spatial indexing (runs once when coverage toggled on)
  useEffect(() => {
    if (!showCoverage || coverageGrid.length > 0 || gridComputing || psLocations.length === 0) return;
    setGridComputing(true);

    // Build spatial index: bin PS locations into 1-degree cells
    const bins = {};
    for (const ps of psLocations) {
      const key = `${Math.floor(ps.lat)},${Math.floor(ps.lng)}`;
      if (!bins[key]) bins[key] = [];
      bins[key].push(ps);
    }

    const grid = [];
    const step = 0.25;
    for (let lat = 24.5; lat <= 49.5; lat += step) {
      for (let lng = -125; lng <= -66.5; lng += step) {
        let minDist = Infinity;
        const cLat = Math.floor(lat), cLng = Math.floor(lng);
        // Check nearby bins (2-degree radius covers ~140mi which is well beyond our 35mi cutoff)
        for (let dLat = -2; dLat <= 2; dLat++) {
          for (let dLng = -2; dLng <= 2; dLng++) {
            const bin = bins[`${cLat + dLat},${cLng + dLng}`];
            if (!bin) continue;
            for (const ps of bin) {
              const d = haversine(lat + step / 2, lng + step / 2, ps.lat, ps.lng);
              if (d < minDist) minDist = d;
            }
          }
        }
        grid.push({ lat, lng, dist: minDist });
      }
    }
    setCoverageGrid(grid);
    setGridComputing(false);
  }, [showCoverage, psLocations, coverageGrid.length, gridComputing]);

  // Market Leaderboard: state-level aggregation
  const stateStats = useMemo(() => {
    const stats = {};
    // PS locations by state
    for (const ps of psLocations) {
      const st = ps.state?.trim().toUpperCase();
      if (!st) continue;
      if (!stats[st]) stats[st] = { state: st, psCount: 0, pipelineCount: 0, pipelinePhases: {} };
      stats[st].psCount++;
    }
    // Pipeline sites by state
    for (const s of pipeSites) {
      const st = s.state?.trim().toUpperCase();
      if (!st) continue;
      if (!stats[st]) stats[st] = { state: st, psCount: 0, pipelineCount: 0, pipelinePhases: {} };
      stats[st].pipelineCount++;
      const phase = s.phase || "Prospect";
      stats[st].pipelinePhases[phase] = (stats[st].pipelinePhases[phase] || 0) + 1;
    }
    // Compute gap score: higher = more underserved
    return Object.values(stats).map(s => {
      const pop = STATE_POP[s.state] || 0;
      const ratio = s.psCount > 0 ? pop / s.psCount : pop > 0 ? 999 : 0;
      // Gap score: population per PS location, normalized to 0-10 scale
      // 500K+ per location = severely underserved (10), 50K per location = saturated (1)
      s.gapScore = s.psCount === 0 && pop > 0 ? 10
        : ratio >= 500000 ? 10
        : ratio >= 300000 ? 9
        : ratio >= 200000 ? 8
        : ratio >= 150000 ? 7
        : ratio >= 100000 ? 6
        : ratio >= 75000 ? 5
        : ratio >= 50000 ? 4
        : ratio >= 30000 ? 3
        : 2;
      s.pop = pop;
      s.ratio = ratio;
      return s;
    });
  }, [psLocations, pipeSites]);

  const sortedStats = useMemo(() => {
    let filtered = stateStats;
    if (leaderboardSearch) {
      const q = leaderboardSearch.toUpperCase();
      filtered = filtered.filter(s => s.state.includes(q));
    }
    const sorted = [...filtered];
    if (leaderboardSort === "gap") sorted.sort((a, b) => b.gapScore - a.gapScore);
    else if (leaderboardSort === "ps") sorted.sort((a, b) => b.psCount - a.psCount);
    else if (leaderboardSort === "pipeline") sorted.sort((a, b) => b.pipelineCount - a.pipelineCount);
    else if (leaderboardSort === "pop") sorted.sort((a, b) => b.pop - a.pop);
    else if (leaderboardSort === "state") sorted.sort((a, b) => a.state.localeCompare(b.state));
    return sorted;
  }, [stateStats, leaderboardSort, leaderboardSearch]);

  // Summary stats
  const totalPipeline = pipeSites.length;
  const statesWithPS = new Set(psLocations.map(p => p.state?.trim().toUpperCase())).size;
  const coverageGapCells = coverageGrid.filter(c => c.dist >= 20 && c.dist <= 35).length;
  const totalGridCells = coverageGrid.length || 1;
  const sweetSpotPct = ((coverageGapCells / totalGridCells) * 100).toFixed(1);

  // ─── Render ───
  return (
    <div style={{ display: "flex", height: "calc(100vh - 140px)", position: "relative", fontFamily: "'Inter', sans-serif" }}>
      {/* Map Container */}
      <div style={{ flex: 1, position: "relative" }}>
        <MapContainer
          center={[39.5, -98.5]}
          zoom={4}
          style={{ height: "100%", width: "100%", borderRadius: 12, overflow: "hidden" }}
          zoomControl={false}
          ref={mapRef}
        >
          {/* Tile Layers */}
          {showSatellite ? (
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri"
              maxZoom={19}
            />
          ) : (
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              maxZoom={19}
            />
          )}

          {/* Coverage Gap Grid */}
          {showCoverage && coverageGrid.length > 0 && (
            <CoverageGridWrapper grid={coverageGrid} />
          )}

          {/* PS Location Clusters */}
          <MarkerClusterGroup
            chunkedLoading
            maxClusterRadius={50}
            spiderfyOnMaxZoom
            showCoverageOnHover={false}
            iconCreateFunction={createClusterIcon}
          >
            {psLocations.map((ps, i) => (
              <Marker key={`ps-${i}`} position={[ps.lat, ps.lng]} icon={psIcon}>
                <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11 }}>
                    <strong style={{ color: FIRE }}>{ps.name || ps.num}</strong><br />
                    {ps.address}, {ps.city} {ps.state}
                  </div>
                </Tooltip>
              </Marker>
            ))}
          </MarkerClusterGroup>

          {/* Pipeline Site Markers */}
          {pipeSites.map((s, i) => (
            <Marker
              key={`pipe-${i}`}
              position={[s._lat, s._lng]}
              icon={pipelineIcon(s.phase)}
              eventHandlers={{ click: () => onSiteClick && onSiteClick(s) }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, maxWidth: 220 }}>
                  <strong style={{ color: "#3B82F6" }}>{s.name || s.address || "Pipeline Site"}</strong><br />
                  <span style={{ color: "#9CA3AF" }}>{s.phase || "Prospect"} | {s.acreage ? s.acreage + " ac" : ""} {s.askingPrice ? "| " + s.askingPrice : ""}</span><br />
                  <span style={{ color: GOLD }}>{s._source === "DW" ? "Daniel Wollent" : s._source === "MT" ? "Matthew Toussaint" : "Review Queue"}</span>
                </div>
              </Tooltip>
            </Marker>
          ))}

          {/* Click-to-Explore Handler */}
          <MapClickHandler psLocations={psLocations} pipelineSites={pipeSites} onClickResult={setClickResult} />

          {/* Fit Bounds (for leaderboard state zoom) */}
          {fitBounds && <FitBounds bounds={fitBounds} />}

          {/* Click Result Popup */}
          {clickResult && (
            <Popup position={[clickResult.lat, clickResult.lng]} onClose={() => setClickResult(null)}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, minWidth: 240 }}>
                <div style={{
                  background: clickResult.signalColor, color: "#fff", padding: "4px 10px",
                  borderRadius: 6, fontSize: 11, fontWeight: 700, marginBottom: 8,
                  textAlign: "center", letterSpacing: 1,
                }}>
                  {clickResult.signal}
                </div>
                <div style={{ marginBottom: 6 }}>
                  <strong>Nearest PS:</strong> {clickResult.nearestPS?.name || "—"}<br />
                  <span style={{ color: "#6B7394" }}>{clickResult.nearestPS?.city} {clickResult.nearestPS?.state} — <strong style={{ color: FIRE }}>{clickResult.minPSDist.toFixed(1)} mi</strong></span>
                </div>
                {clickResult.nearestPipe && (
                  <div style={{ marginBottom: 6 }}>
                    <strong>Nearest Pipeline:</strong> {clickResult.nearestPipe.name || clickResult.nearestPipe.address || "—"}<br />
                    <span style={{ color: "#6B7394" }}>{clickResult.minPipeDist.toFixed(1)} mi — {clickResult.nearestPipe.phase}</span>
                  </div>
                )}
                <div style={{ marginBottom: 6, color: "#6B7394", fontSize: 11 }}>
                  {clickResult.lat.toFixed(4)}, {clickResult.lng.toFixed(4)}
                </div>
                <a
                  href={`https://www.crexi.com/properties/Land?bounds=${(clickResult.lat - 0.15).toFixed(4)},${(clickResult.lng - 0.2).toFixed(4)},${(clickResult.lat + 0.15).toFixed(4)},${(clickResult.lng + 0.2).toFixed(4)}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    display: "block", textAlign: "center", background: FIRE, color: "#fff",
                    padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                    textDecoration: "none", marginTop: 6,
                  }}
                >
                  Search Crexi for Land
                </a>
              </div>
            </Popup>
          )}
        </MapContainer>

        {/* Layer Controls (floating top-right) */}
        <div style={{
          position: "absolute", top: 16, right: showLeaderboard ? "calc(30% + 20px)" : 16,
          zIndex: 1000, display: "flex", flexDirection: "column", gap: 6, transition: "right 0.3s ease",
        }}>
          <button
            onClick={() => setShowCoverage(!showCoverage)}
            style={{
              background: showCoverage ? FIRE : GLASS, color: showCoverage ? "#fff" : "#9CA3AF",
              border: `1px solid ${showCoverage ? FIRE : "rgba(255,255,255,0.1)"}`,
              padding: "8px 14px", borderRadius: 8, fontSize: 11, fontWeight: 600,
              cursor: "pointer", fontFamily: "'Inter', sans-serif", backdropFilter: "blur(12px)",
              transition: "all 0.2s ease",
            }}
          >
            {gridComputing ? "Computing..." : showCoverage ? "Coverage Gaps ON" : "Coverage Gaps"}
          </button>
          <button
            onClick={() => setShowSatellite(!showSatellite)}
            style={{
              background: showSatellite ? STEEL : GLASS, color: showSatellite ? GOLD : "#9CA3AF",
              border: `1px solid ${showSatellite ? GOLD : "rgba(255,255,255,0.1)"}`,
              padding: "8px 14px", borderRadius: 8, fontSize: 11, fontWeight: 600,
              cursor: "pointer", fontFamily: "'Inter', sans-serif", backdropFilter: "blur(12px)",
              transition: "all 0.2s ease",
            }}
          >
            {showSatellite ? "Satellite ON" : "Satellite"}
          </button>
          <button
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            style={{
              background: showLeaderboard ? NAVY : GLASS, color: showLeaderboard ? GOLD : "#9CA3AF",
              border: `1px solid ${showLeaderboard ? GOLD : "rgba(255,255,255,0.1)"}`,
              padding: "8px 14px", borderRadius: 8, fontSize: 11, fontWeight: 600,
              cursor: "pointer", fontFamily: "'Inter', sans-serif", backdropFilter: "blur(12px)",
              transition: "all 0.2s ease",
            }}
          >
            Leaderboard
          </button>
        </div>

        {/* Coverage Legend (bottom-left) */}
        {showCoverage && (
          <div style={{
            position: "absolute", bottom: 56, left: 16, zIndex: 1000,
            background: GLASS, backdropFilter: "blur(12px)", borderRadius: 10,
            padding: "10px 14px", border: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: GOLD, marginBottom: 6, letterSpacing: 1 }}>COVERAGE LEGEND</div>
            {[
              { color: "rgba(232,122,46,0.50)", label: "0-10 mi — Dense PS Coverage" },
              { color: "rgba(201,168,76,0.45)", label: "10-20 mi — Moderate" },
              { color: "rgba(30,39,97,0.55)", label: "20-35 mi — Expansion Sweet Spot" },
              { color: "rgba(100,100,100,0.30)", label: ">35 mi — Outside Footprint" },
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: item.color }} />
                <span style={{ fontSize: 10, color: "#9CA3AF" }}>{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Stats Bar (bottom) */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: showLeaderboard ? "30%" : 0,
          zIndex: 1000, background: DARK_BG, backdropFilter: "blur(12px)",
          borderTop: `1px solid rgba(201,168,76,0.15)`,
          padding: "8px 20px", display: "flex", justifyContent: "space-between", alignItems: "center",
          transition: "right 0.3s ease",
        }}>
          <div style={{ display: "flex", gap: 24 }}>
            <StatChip label="PS Locations" value={psLocations.length.toLocaleString()} color={FIRE} />
            <StatChip label="Pipeline Sites" value={totalPipeline} color="#3B82F6" />
            <StatChip label="States w/ PS" value={statesWithPS} color={GOLD} />
          </div>
          {showCoverage && coverageGrid.length > 0 && (
            <div style={{ display: "flex", gap: 24 }}>
              <StatChip label="Sweet Spot Cells" value={coverageGapCells.toLocaleString()} color={NAVY} />
              <StatChip label="Sweet Spot %" value={sweetSpotPct + "%"} color={STEEL} />
            </div>
          )}
        </div>
      </div>

      {/* Market Leaderboard Side Panel */}
      {showLeaderboard && (
        <div style={{
          width: "30%", minWidth: 280, maxWidth: 400, background: DARK_BG,
          borderLeft: `1px solid rgba(201,168,76,0.15)`,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            padding: "16px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", letterSpacing: 0.5 }}>MARKET LEADERBOARD</div>
                <div style={{ fontSize: 10, color: "#6B7394", marginTop: 2 }}>Expansion Opportunity by State</div>
              </div>
              <button onClick={() => setShowLeaderboard(false)} style={{
                background: "none", border: "none", color: "#6B7394", cursor: "pointer", fontSize: 16, padding: 4,
              }}>x</button>
            </div>
            <input
              type="text"
              placeholder="Search state..."
              value={leaderboardSearch}
              onChange={(e) => setLeaderboardSearch(e.target.value)}
              style={{
                width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6, padding: "6px 10px", color: "#fff", fontSize: 11, fontFamily: "'Inter', sans-serif",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Sort Controls */}
          <div style={{
            display: "flex", gap: 2, padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}>
            {[
              { key: "gap", label: "Gap Score" },
              { key: "ps", label: "PS Locs" },
              { key: "pipeline", label: "Pipeline" },
              { key: "pop", label: "Population" },
              { key: "state", label: "State" },
            ].map(s => (
              <button key={s.key} onClick={() => setLeaderboardSort(s.key)} style={{
                background: leaderboardSort === s.key ? "rgba(232,122,46,0.15)" : "transparent",
                color: leaderboardSort === s.key ? FIRE : "#6B7394",
                border: "none", borderRadius: 4, padding: "3px 6px", fontSize: 9, fontWeight: 600,
                cursor: "pointer", fontFamily: "'Inter', sans-serif",
              }}>{s.label}</button>
            ))}
          </div>

          {/* State Rows */}
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
            {sortedStats.map((s, i) => (
              <div
                key={s.state}
                onClick={() => {
                  const bounds = STATE_BOUNDS[s.state];
                  if (bounds) setFitBounds(bounds);
                }}
                style={{
                  display: "grid", gridTemplateColumns: "28px 42px 1fr 48px 48px 44px",
                  alignItems: "center", padding: "8px 16px", cursor: "pointer",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(232,122,46,0.08)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontSize: 10, color: "#4B5563", fontWeight: 600 }}>#{i + 1}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{s.state}</span>
                <div>
                  <GapBar score={s.gapScore} />
                </div>
                <span style={{ fontSize: 10, color: FIRE, fontWeight: 600, textAlign: "right" }}>{s.psCount}</span>
                <span style={{ fontSize: 10, color: "#3B82F6", fontWeight: 600, textAlign: "right" }}>{s.pipelineCount || "—"}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, textAlign: "right",
                  color: s.gapScore >= 8 ? GOLD : s.gapScore >= 6 ? "#22C55E" : "#6B7394",
                }}>{s.gapScore.toFixed(1)}</span>
              </div>
            ))}
          </div>

          {/* Column Headers */}
          <div style={{
            display: "grid", gridTemplateColumns: "28px 42px 1fr 48px 48px 44px",
            padding: "6px 16px", borderTop: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(0,0,0,0.3)",
          }}>
            <span style={{ fontSize: 8, color: "#4B5563" }}>#</span>
            <span style={{ fontSize: 8, color: "#4B5563" }}>ST</span>
            <span style={{ fontSize: 8, color: "#4B5563" }}>GAP</span>
            <span style={{ fontSize: 8, color: "#4B5563", textAlign: "right" }}>PS</span>
            <span style={{ fontSize: 8, color: "#4B5563", textAlign: "right" }}>PIPE</span>
            <span style={{ fontSize: 8, color: "#4B5563", textAlign: "right" }}>SCORE</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-Components ───
function StatChip({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}44` }} />
      <span style={{ fontSize: 10, color: "#6B7394" }}>{label}:</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{value}</span>
    </div>
  );
}

function GapBar({ score }) {
  const pct = (score / 10) * 100;
  const color = score >= 8 ? GOLD : score >= 6 ? "#22C55E" : score >= 4 ? "#6B7394" : "#374151";
  return (
    <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden", width: "100%" }}>
      <div style={{
        height: "100%", width: `${pct}%`, borderRadius: 3,
        background: `linear-gradient(90deg, ${color}, ${color}88)`,
        transition: "width 0.3s ease",
      }} />
    </div>
  );
}

export default DiscoverMap;
