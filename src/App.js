// src/App.js â Public Storage Acquisition Tracker
// Â© 2026 DJR Real Estate LLC. All rights reserved.
// Proprietary and confidential. Unauthorized reproduction or distribution prohibited.
// Firebase Realtime Database â live shared data across all 3 users

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { db, storage, auth } from "./firebase";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, push, remove, update } from "firebase/database";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import "./responsive.css";
// xlsx is lazy-loaded on demand (Export Excel) to reduce initial bundle ~500KB
// import * as XLSX from "xlsx";  â moved to dynamic import()

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// SITE IQ CONFIGURATION â Single source of truth for scoring weights & display
// Executives can adjust weights via the in-app Settings panel (writes to Firebase)
// or by editing this default config directly. Weights auto-normalize to 1.0.
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const SITE_IQ_DEFAULTS = [
  { key: "population", label: "Population", icon: "👥", weight: 0.20, tip: "3-mile population density", source: "ESRI / Census ACS", group: "demographics" },
  { key: "growth", label: "Growth", icon: "📈", weight: 0.15, tip: "Pop growth CAGR — 5yr projected trend", source: "ESRI 2025→2030 projections", group: "demographics" },
  { key: "income", label: "Med. Income", icon: "💰", weight: 0.10, tip: "Median HHI within 3 miles", source: "ESRI / Census ACS", group: "demographics" },
  { key: "spacing", label: "PS Spacing", icon: "📏", weight: 0.20, tip: "Distance to nearest PS facility", source: "PS_Locations_ALL.csv", group: "proximity" },
  { key: "zoning", label: "Zoning", icon: "📋", weight: 0.15, tip: "By-right / conditional / prohibited", source: "Zoning field + summary", group: "entitlements" },
  { key: "access", label: "Site Access", icon: "🛣️", weight: 0.07, tip: "Acreage, frontage, flood, access", source: "Site data + summary", group: "physical" },
  { key: "competition", label: "Competition", icon: "🏢", weight: 0.05, tip: "Storage competitor density", source: "Competitor data / summary", group: "market" },
  { key: "marketTier", label: "Market Tier", icon: "📍", weight: 0.08, tip: "PS market priority ranking", source: "Market field / config", group: "market" },
];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const vals = [];
    let cur = "",
      inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === "," && !inQ) {
        vals.push(cur.trim());
        cur = "";
      } else cur += c;
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] || "";
    });
    return obj;
  });
}

// âââ Constants âââ
const REGIONS = {
  southwest: { label: "Daniel Wollent", color: "#1565C0", accent: "#42A5F5" },
  east: { label: "Matthew Toussaint", color: "#2D5F2D", accent: "#4CAF50" },
};
const STATUS_COLORS = {
  pending: { bg: "#FFF3E0", text: "#E65100", dot: "#F37C33" },
  approved: { bg: "#E8F5E9", text: "#2E7D32", dot: "#4CAF50" },
  declined: { bg: "#FFEBEE", text: "#B71C1C", dot: "#EF5350" },
  tracking: { bg: "#FFF8F0", text: "#BF360C", dot: "#F37C33" },
};
const PHASES = [
  "Incoming",
  "Scored",
  "Prospect",
  "Submitted to PS",
  "PS Approved",
  "PS Revisions",
  "PS Declined",
  "LOI Sent",
  "LOI Signed",
  "Under Contract",
  "Due Diligence",
  "Closed",
  "Dead",
];
const PRIORITIES = ["ð¥ Hot", "ð¡ Warm", "ðµ Cold", "âª None"];
const PRIORITY_COLORS = {
  "ð¥ Hot": "#EF4444",
  "ð¡ Warm": "#F59E0B",
  "ðµ Cold": "#3B82F6",
  "âª None": "#CBD5E1",
};
const MSG_COLORS = {
  "Dan R": { bg: "#FFF3E0", border: "#F37C33", text: "#E65100" },
  "Daniel Wollent": { bg: "#EFF6FF", border: "#42A5F5", text: "#1565C0" },
  "Matthew Toussaint": { bg: "#F0FDF4", border: "#4CAF50", text: "#2D5F2D" },
};
const DOC_TYPES = [
  "Flyer",
  "Survey",
  "Geotech",
  "PSA",
  "LOI",
  "Appraisal",
  "Environmental",
  "Title",
  "Plat",
  "Other",
];

// âââ Helpers âââ
const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const fmt$ = (v) => {
  if (!v) return "";
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? v : "$" + n.toLocaleString();
};
const fmtN = (v) => {
  if (!v) return "";
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? v : n.toLocaleString();
};
const fmtPrice = (v) => {
  if (!v || v === "TBD" || v === "â") return v || "â";
  // Already has $X.XXM format with parenthetical â extract just the leading price
  const mMatch = String(v).match(/^\$?([\d,.]+)\s*[Mm]/);
  if (mMatch) return "$" + parseFloat(mMatch[1].replace(/,/g, "")).toFixed(2).replace(/\.?0+$/, "") + "M";
  // Raw number like $1,300,000 or 1300000
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  if (isNaN(n) || n === 0) return v;
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1000) return "$" + Math.round(n / 1000) + "K";
  return "$" + n.toLocaleString();
};
const mapsLink = (c) =>
  c ? `https://www.google.com/maps?q=${encodeURIComponent(c)}` : "";
const earthLink = (c) =>
  c ? `https://earth.google.com/web/search/${encodeURIComponent(c)}` : "";

// âââ Shared Style Constants âââ
const STYLES = {
  cardBase: { background: "#fff", borderRadius: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", overflow: "hidden" },
  kpiCard: (borderColor) => ({ cursor: "pointer", background: "linear-gradient(135deg, #fff 0%, #FAFBFC 100%)", borderRadius: 14, padding: "20px 24px", minWidth: 130, boxShadow: "0 2px 8px rgba(0,0,0,0.04)", borderLeft: `4px solid ${borderColor}`, transition: "all 0.25s ease" }),
  labelMicro: { fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 },
  btnPrimary: { padding: "8px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#F37C33,#E8650A)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 6px rgba(243,124,51,0.25)", transition: "all 0.2s" },
  btnGhost: { padding: "6px 14px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" },
  frostedHeader: { background: "rgba(44,44,44,0.92)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", padding: "0 20px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(0,0,0,0.2)" },
};

// âââ Debounce Helper âââ
const debounce = (fn, ms) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

// âââ Demographics Helper â reads ESRI GeoEnrichment data from Firebase âââ
// Data: 2025 current-year estimates + 2030 five-year projections (ESRI paid)
// Radii: 1-mile, 3-mile, 5-mile (written by refresh-demos-esri.mjs scheduled task)
const buildDemoReport = (site) => {
  if (!site) return null;
  const parseNum = (v) => { if (!v) return null; const n = parseInt(String(v).replace(/[\$,]/g, ""), 10); return isNaN(n) ? null : n; };
  const rings = {
    1: { pop: parseNum(site.pop1mi), hh: parseNum(site.households1mi), medIncome: parseNum(site.income1mi), homeValue: parseNum(site.homeValue1mi), renterPct: site.renterPct1mi, popGrowth: site.popGrowth1mi },
    3: { pop: parseNum(site.pop3mi), hh: parseNum(site.households3mi), medIncome: parseNum(site.income3mi), homeValue: parseNum(site.homeValue3mi), renterPct: site.renterPct3mi, popGrowth: site.popGrowth3mi },
    5: { pop: parseNum(site.pop5mi), hh: parseNum(site.households5mi), medIncome: parseNum(site.income5mi), homeValue: parseNum(site.homeValue5mi), renterPct: site.renterPct5mi, popGrowth: site.popGrowth5mi },
  };
  const pop3mi_fy = parseNum(site.pop3mi_fy);
  const income3mi_fy = parseNum(site.income3mi_fy);
  const households3mi_fy = parseNum(site.households3mi_fy);
  const hhGrowth3mi = site.hhGrowth3mi;
  const incomeGrowth3mi = site.incomeGrowth3mi;
  const pg = site.popGrowth3mi ? parseFloat(site.popGrowth3mi) : 0;
  let growthOutlook = "Stable";
  if (pg > 1.5) growthOutlook = "High Growth";
  else if (pg > 0.5) growthOutlook = "Growing";
  else if (pg > 0) growthOutlook = "Stable Growth";
  else if (pg < -0.5) growthOutlook = "Declining";
  else growthOutlook = "Flat";
  const hasDemoData = rings[3].pop || rings[3].medIncome;
  return hasDemoData ? { rings, pop3mi: site.pop3mi || null, income3mi: site.income3mi || null, growthOutlook, pop3mi_fy: site.pop3mi_fy || null, income3mi_fy: site.income3mi_fy || null, households3mi_fy: site.households3mi_fy || null, hhGrowth3mi, incomeGrowth3mi, popGrowth3mi: site.popGrowth3mi || null, source: site.demoSource || "ESRI ArcGIS GeoEnrichment 2025", pulledAt: site.demoPulledAt || null } : null;
};
// Legacy Census fallback (only used if ESRI data not yet available)
const fetchDemographics = async (coordinates) => {
  if (!coordinates) return { error: "No coordinates provided" };
  const [latStr, lngStr] = coordinates.split(",").map(s => s.trim());
  const lat = parseFloat(latStr), lng = parseFloat(lngStr);
  if (isNaN(lat) || isNaN(lng)) return { error: "Invalid coordinates" };
  const haversine = (lat1, lon1, lat2, lon2) => {
    const R = 3958.8, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };
  try {
    const fccResp = await fetch(`https://geo.fcc.gov/api/census/block/find?latitude=${lat}&longitude=${lng}&format=json`);
    const fccData = await fccResp.json();
    if (!fccData.Block || !fccData.Block.FIPS) return { error: "Could not determine census location" };
    const fips = fccData.Block.FIPS;
    const stFips = fips.substring(0, 2), coFips = fips.substring(2, 5);
    // Get tract centroids via TIGERweb
    const tigerUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/8/query?where=STATE%3D'${stFips}'+AND+COUNTY%3D'${coFips}'&outFields=GEOID,CENTLAT,CENTLON,STATE,COUNTY,TRACT&f=json&resultRecordCount=9999`;
    const tigerResp = await fetch(tigerUrl);
    const tigerData = await tigerResp.json();
    const tracts = (tigerData.features || []).map(f => ({
      geoid: f.attributes.GEOID, lat: parseFloat(f.attributes.CENTLAT), lon: parseFloat(f.attributes.CENTLON),
      stFips: f.attributes.STATE, coFips: f.attributes.COUNTY, trFips: f.attributes.TRACT
    }));
    // Check adjacent counties
    const offset = 0.072;
    const cardinals = [[lat+offset,lng],[lat-offset,lng],[lat,lng+offset],[lat,lng-offset]];
    const adjCounties = new Set([stFips + coFips]);
    for (const [cl, cn] of cardinals) {
      try { const r = await fetch(`https://geo.fcc.gov/api/census/block/find?latitude=${cl}&longitude=${cn}&format=json`); const dd = await r.json();
        if (dd.Block && dd.Block.FIPS) adjCounties.add(dd.Block.FIPS.substring(0,5));
      } catch(e) {}
    }
    let allTracts = [...tracts];
    for (const key of adjCounties) {
      if (key === stFips + coFips) continue;
      try { const r = await fetch(`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/8/query?where=STATE%3D'${key.substring(0,2)}'+AND+COUNTY%3D'${key.substring(2,5)}'&outFields=GEOID,CENTLAT,CENTLON,STATE,COUNTY,TRACT&f=json&resultRecordCount=9999`);
        const dd = await r.json();
        allTracts = allTracts.concat((dd.features||[]).map(f => ({ geoid: f.attributes.GEOID, lat: parseFloat(f.attributes.CENTLAT), lon: parseFloat(f.attributes.CENTLON), stFips: f.attributes.STATE, coFips: f.attributes.COUNTY, trFips: f.attributes.TRACT })));
      } catch(e) {}
    }
    // Bucket tracts by ring distance
    const buckets = { 1: [], 3: [], 5: [] };
    for (const t of allTracts) { const dd = haversine(lat, lng, t.lat, t.lon); if (dd <= 1) buckets[1].push(t); if (dd <= 3) buckets[3].push(t); if (dd <= 5) buckets[5].push(t); }
    // Get ACS data for all relevant counties
    const countyKeys = new Set();
    for (const t of allTracts) { if (haversine(lat, lng, t.lat, t.lon) <= 5) countyKeys.add(t.stFips + "|" + t.coFips); }
    const acsData = {};
    for (const key of countyKeys) {
      const [st, co] = key.split("|");
      try { const r = await fetch(`https://api.census.gov/data/2022/acs/acs5?get=B01003_001E,B19013_001E,B11001_001E,B25077_001E,B25003_002E,B25003_001E&for=tract:*&in=state:${st}+county:${co}`);
        const rows = await r.json(); const hdr = rows[0];
        for (let i = 1; i < rows.length; i++) { const row = rows[i];
          const geoid = row[hdr.indexOf("state")] + row[hdr.indexOf("county")] + row[hdr.indexOf("tract")];
          acsData[geoid] = { pop: parseInt(row[0])||0, income: parseInt(row[1])||0, hh: parseInt(row[2])||0, homeVal: parseInt(row[3])||0, renters: parseInt(row[4])||0, totalTenure: parseInt(row[5])||0 };
        }
      } catch(e) {}
    }
    // Also fetch 2020 Decennial for pop growth calculation
    const decennialData = {};
    for (const key of countyKeys) {
      const [st, co] = key.split("|");
      try { const r = await fetch(`https://api.census.gov/data/2020/dec/pl?get=P1_001N&for=tract:*&in=state:${st}+county:${co}`);
        const rows = await r.json(); const hdr = rows[0];
        for (let i = 1; i < rows.length; i++) { const row = rows[i];
          const geoid = row[hdr.indexOf("state")] + row[hdr.indexOf("county")] + row[hdr.indexOf("tract")];
          decennialData[geoid] = { pop2020: parseInt(row[0])||0 };
        }
      } catch(e) {}
    }
    // Aggregate per ring
    const rings = {};
    for (const radius of [1, 3, 5]) {
      const rt = buckets[radius]; let totalPop = 0, totalHH = 0, wInc = 0, wHV = 0, pInc = 0, pHV = 0, totalRenters = 0, totalTenure = 0, pop2020 = 0;
      for (const t of rt) { const a = acsData[t.geoid]; if (!a) continue;
        totalPop += a.pop; totalHH += a.hh; totalRenters += a.renters; totalTenure += a.totalTenure;
        if (a.income > 0 && a.pop > 0) { wInc += a.income * a.pop; pInc += a.pop; }
        if (a.homeVal > 0 && a.pop > 0) { wHV += a.homeVal * a.pop; pHV += a.pop; }
        const dec = decennialData[t.geoid]; if (dec) pop2020 += dec.pop2020;
      }
      const popGrowthPct = pop2020 > 0 ? ((totalPop - pop2020) / pop2020 * 100) : null;
      const renterPct = totalTenure > 0 ? (totalRenters / totalTenure * 100) : null;
      rings[radius] = { pop: totalPop, income: pInc > 0 ? Math.round(wInc/pInc) : 0, hh: totalHH,
        homeVal: pHV > 0 ? Math.round(wHV/pHV) : 0, tractCount: rt.length,
        popGrowthPct: popGrowthPct !== null ? Math.round(popGrowthPct * 10) / 10 : null,
        renterPct: renterPct !== null ? Math.round(renterPct * 10) / 10 : null, pop2020: pop2020 };
    }
    if (rings[1].pop === 0 && rings[3].pop > 0) {
      const nearest = allTracts.reduce((b, t) => { const dd = haversine(lat, lng, t.lat, t.lon); return dd < b.d ? { t, d: dd } : b; }, { t: null, d: Infinity });
      if (nearest.t && acsData[nearest.t.geoid]) { const a = acsData[nearest.t.geoid]; rings[1] = { pop: a.pop, income: a.income, hh: a.hh, homeVal: a.homeVal, tractCount: 1, popGrowthPct: null, renterPct: a.totalTenure > 0 ? Math.round(a.renters/a.totalTenure*1000)/10 : null, pop2020: 0 }; }
    }
    return {
      pop1mi: rings[1].pop.toLocaleString(), pop3mi: rings[3].pop.toLocaleString(), pop5mi: rings[5].pop.toLocaleString(),
      income1mi: rings[1].income > 0 ? "$" + rings[1].income.toLocaleString() : "", income3mi: rings[3].income > 0 ? "$" + rings[3].income.toLocaleString() : "", income5mi: rings[5].income > 0 ? "$" + rings[5].income.toLocaleString() : "",
      households1mi: rings[1].hh.toLocaleString(), households3mi: rings[3].hh.toLocaleString(), households5mi: rings[5].hh.toLocaleString(),
      homeValue1mi: rings[1].homeVal > 0 ? "$" + rings[1].homeVal.toLocaleString() : "", homeValue3mi: rings[3].homeVal > 0 ? "$" + rings[3].homeVal.toLocaleString() : "", homeValue5mi: rings[5].homeVal > 0 ? "$" + rings[5].homeVal.toLocaleString() : "",
      popGrowth3mi: rings[3].popGrowthPct, renterPct3mi: rings[3].renterPct,
      popGrowth1mi: rings[1].popGrowthPct, popGrowth5mi: rings[5].popGrowthPct,
      renterPct1mi: rings[1].renterPct, renterPct5mi: rings[5].renterPct,
      fips: fips, source: "Census ACS 5-Year (2022) multi-tract ring aggregation",
      tractCounts: { "1mi": rings[1].tractCount, "3mi": rings[3].tractCount, "5mi": rings[5].tractCount }, rings: rings
    };
  } catch (err) { console.error("fetchDemographics error:", err); return { error: "Demographics fetch failed: " + err.message }; }
};

// âââ Vetting Report Generator âââ
const generateVettingReport = (site, nearestPSDistance) => {
  const lines = [];
  lines.push("âââââââââââââââââââââââââââââââââââââââââââââââââââ");
  lines.push(`SITE VETTING REPORT â ${site.name || "Unnamed"}`);
  lines.push(`Generated: ${new Date().toLocaleDateString()} by PS Acquisition Pipeline`);
  lines.push("âââââââââââââââââââââââââââââââââââââââââââââââââââ");
  lines.push("");
  lines.push("1. PROPERTY OVERVIEW");
  lines.push("âââââââââââââââââââââ");
  lines.push(`   Name:           ${site.name || "â"}`);
  lines.push(`   Address:        ${site.address || "â"}`);
  lines.push(`   City / State:   ${site.city || "â"}, ${site.state || "â"}`);
  lines.push(`   Market:         ${site.market || "â"}`);
  lines.push(`   Acreage:        ${site.acreage || "â"}`);
  lines.push(`   Asking Price:   ${site.askingPrice || "â"}`);
  lines.push(`   PS Int. Price:  ${site.internalPrice || "â"}`);
  lines.push(`   Coordinates:    ${site.coordinates || "â"}`);
  lines.push(`   Listing URL:    ${site.listingUrl || "â"}`);
  lines.push("");
  lines.push("2. ZONING & ENTITLEMENTS");
  lines.push("âââââââââââââââââââââ");
  lines.push(`   Current Zoning: ${site.zoning || "Not confirmed"}`);
  lines.push(`   Storage Use:    ${site.zoning ? "Verify with local jurisdiction" : "UNKNOWN â research required"}`);
  lines.push("");
  lines.push("3. DEMOGRAPHICS (3-Mile Radius)");
  lines.push("âââââââââââââââââââââ");
  lines.push(`   Population:     ${site.pop3mi ? fmtN(site.pop3mi) : "Not available"}`);
  lines.push(`   Median HHI:     ${site.income3mi || "Not available"}`);
  const popN = parseInt(String(site.pop3mi).replace(/[^0-9]/g, ""), 10);
  const incN = parseInt(String(site.income3mi).replace(/[^0-9]/g, ""), 10);
  if (popN && incN) {
    lines.push(`   Demo Score:     ${popN >= 40000 && incN >= 60000 ? "â PASS" : popN >= 20000 && incN >= 50000 ? "â ï¸ MARGINAL" : "â BELOW THRESHOLD"}`);
  }
  lines.push("");
  lines.push("4. SITE SIZING ASSESSMENT");
  lines.push("âââââââââââââââââââââ");
  const acres = parseFloat(String(site.acreage).replace(/[^0-9.]/g, ""));
  if (!isNaN(acres)) {
    if (acres >= 3.5 && acres <= 5) lines.push(`   ${acres} ac â PRIMARY (one-story climate-controlled) â`);
    else if (acres >= 2.5 && acres < 3.5) lines.push(`   ${acres} ac â SECONDARY (multi-story 3-4 story) â`);
    else if (acres < 2.5) lines.push(`   ${acres} ac â â BELOW MINIMUM â generally too small`);
    else if (acres > 5 && acres <= 7) lines.push(`   ${acres} ac â VIABLE if subdivisible â ï¸`);
    else lines.push(`   ${acres} ac â LARGE TRACT â subdivision potential â ï¸`);
  } else {
    lines.push("   Acreage not confirmed â sizing TBD");
  }
  lines.push("");
  lines.push("5. PS PROXIMITY CHECK");
  lines.push("âââââââââââââââââââââ");
  lines.push(`   Nearest PS:     ${nearestPSDistance || "Run proximity check with PS_Locations_ALL.csv"}`);
  lines.push("");
  lines.push("6. BROKER / SELLER");
  lines.push("âââââââââââââââââââââ");
  lines.push(`   Contact:        ${site.sellerBroker || "Not listed"}`);
  lines.push(`   Date on Market: ${site.dateOnMarket || "Unknown"}`);
  lines.push(`   Phase:          ${site.phase || "Prospect"}`);
  lines.push(`   Priority:       ${site.priority || "None"}`);
  lines.push("");
  lines.push("7. RED FLAGS / NOTES");
  lines.push("âââââââââââââââââââââ");
  const flags = [];
  if (!site.zoning) flags.push("   â  Zoning not confirmed");
  if (!site.coordinates) flags.push("   â  No coordinates â cannot verify location");
  if (acres < 2.5) flags.push("   â  Below minimum acreage threshold");
  if (popN && popN < 10000) flags.push("   â  3-mi population below 10,000 minimum");
  if (incN && incN < 60000) flags.push("   â  3-mi median HHI below $60,000 target");
  if (!site.askingPrice || site.askingPrice === "TBD") flags.push("   â  No confirmed asking price");
  if (flags.length === 0) flags.push("   None identified at this time");
  lines.push(flags.join("\n"));
  lines.push("");
  lines.push("8. SUMMARY / DEAL NOTES");
  lines.push("âââââââââââââââââââââ");
  lines.push(`   ${site.summary || "No notes"}`);
  lines.push("");
  lines.push("âââââââââââââââââââââââââââââââââââââââââââââââââââ");
  lines.push("Report generated by PS Acquisition Pipeline Â· Powered by DJR Real Estate LLC");
  lines.push("âââââââââââââââââââââââââââââââââââââââââââââââââââ");
  return lines.join("\n");
};

  // âââ PDF Vetting Report Download ââââââââââââââââââ
  const downloadVettingPDF = (site) => {
    const loadJsPDF = () => {
      return new Promise((resolve, reject) => {
        if (window.jspdf) return resolve(window.jspdf);
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
        s.onload = () => resolve(window.jspdf);
        s.onerror = reject;
        document.head.appendChild(s);
      });
    };
    loadJsPDF().then(({ jsPDF }) => {
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const W = pdf.internal.pageSize.getWidth();
      const H = pdf.internal.pageSize.getHeight();
      const margin = 50;
      let y = margin;
      const addPage = () => { pdf.addPage(); y = margin; };
      const checkPage = (need) => { if (y + need > H - margin) addPage(); };
      // Header bar
      pdf.setFillColor(17, 24, 39);
      pdf.rect(0, 0, W, 70, "F");
      pdf.setFontSize(22);
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.text("SITE VETTING REPORT", margin, 44);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(180, 190, 210);
      pdf.text("PS Acquisition Pipeline  |  DJR Real Estate LLC  |  " + new Date().toLocaleDateString(), margin, 60);
      y = 90;
      // Site title
      pdf.setFontSize(16);
      pdf.setTextColor(17, 24, 39);
      pdf.setFont("helvetica", "bold");
      pdf.text(site.name || "Unnamed Site", margin, y);
      y += 6;
      pdf.setDrawColor(59, 130, 246);
      pdf.setLineWidth(2);
      pdf.line(margin, y, W - margin, y);
      y += 18;
      pdf.setFontSize(10);
      pdf.setTextColor(100, 116, 139);
      pdf.setFont("helvetica", "normal");
      pdf.text((site.address || "") + "  |  " + (site.city || "") + ", " + (site.state || "") + "  |  " + (site.market || ""), margin, y);
      y += 24;
      // Helper: section header
      const section = (title) => {
        checkPage(30);
        pdf.setFillColor(241, 245, 249);
        pdf.roundedRect(margin, y - 2, W - margin * 2, 20, 3, 3, "F");
        pdf.setFontSize(10);
        pdf.setTextColor(30, 41, 59);
        pdf.setFont("helvetica", "bold");
        pdf.text(title, margin + 8, y + 12);
        y += 26;
      };
      // Helper: key-value row
      const row = (label, val) => {
        checkPage(16);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(100, 116, 139);
        pdf.text(label, margin + 8, y);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(30, 41, 59);
        pdf.text(String(val || "â"), margin + 140, y);
        y += 15;
      };
      const fN = (n) => { const v = parseInt(String(n).replace(/[^0-9]/g, ""), 10); return isNaN(v) ? "â" : v.toLocaleString(); };
      // 1. Property Overview
      section("1. PROPERTY OVERVIEW");
      row("Name:", site.name);
      row("Address:", site.address);
      row("City / State:", (site.city || "") + ", " + (site.state || ""));
      row("Market:", site.market);
      row("Acreage:", site.acreage);
      row("Asking Price:", site.askingPrice);
      row("PS Internal Price:", site.internalPrice);
      row("Coordinates:", site.coordinates);
      row("Phase:", site.phase);
      row("Priority:", site.priority);
      y += 6;
      // 2. Zoning
      section("2. ZONING & ENTITLEMENTS");
      row("Current Zoning:", site.zoning || "Not confirmed");
      row("Storage Use:", site.zoning ? "Verify with local jurisdiction" : "UNKNOWN");
      y += 6;
      // 3. Demographics
      section("3. DEMOGRAPHICS (3-Mile Radius)");
      row("Population:", fN(site.pop3mi));
      row("Median HHI:", site.income3mi || "â");
      const popN = parseInt(String(site.pop3mi).replace(/[^0-9]/g, ""), 10);
      const incN = parseInt(String(site.income3mi).replace(/[^0-9]/g, ""), 10);
      if (popN && incN) {
        const demoScore = popN >= 40000 && incN >= 60000 ? "PASS" : popN >= 20000 && incN >= 50000 ? "MARGINAL" : "BELOW THRESHOLD";
        row("Demo Score:", demoScore);
      }
      y += 6;
      // 4. Site Sizing
      section("4. SITE SIZING ASSESSMENT");
      const acres = parseFloat(String(site.acreage).replace(/[^0-9.]/g, ""));
      if (!isNaN(acres)) {
        let sizing = "";
        if (acres >= 3.5 && acres <= 5) sizing = acres + " ac â PRIMARY (one-story climate-controlled)";
        else if (acres >= 2.5 && acres < 3.5) sizing = acres + " ac â SECONDARY (multi-story 3-4 story)";
        else if (acres < 2.5) sizing = acres + " ac â BELOW MINIMUM";
        else if (acres <= 7) sizing = acres + " ac â VIABLE if subdivisible";
        else sizing = acres + " ac â LARGE TRACT â subdivision potential";
        row("Assessment:", sizing);
      } else { row("Assessment:", "Acreage not confirmed"); }
      y += 6;
      // 5. PS Proximity
      section("5. PS PROXIMITY CHECK");
      row("Nearest PS:", "Run proximity check with PS_Locations_ALL.csv");
      y += 6;
      // 6. Broker / Seller
      section("6. BROKER / SELLER INFO");
      row("Contact:", site.sellerBroker);
      row("Date on Market:", site.dateOnMarket);
      row("Phase:", site.phase);
      row("Priority:", site.priority);
      y += 6;
      // 7. Red Flags
      section("7. RED FLAGS / NOTES");
      const flags = [];
      if (!site.zoning) flags.push("Zoning not confirmed");
      if (!site.coordinates) flags.push("No coordinates");
      if (acres < 2.5) flags.push("Below minimum acreage");
      if (popN && popN < 10000) flags.push("3-mi pop below 10,000");
      if (incN && incN < 60000) flags.push("3-mi HHI below $60,000");
      if (flags.length === 0) flags.push("None identified");
      flags.forEach(f => { checkPage(15); row("", f); });
      y += 6;
      // 8. Summary
      section("8. SUMMARY / DEAL NOTES");
      checkPage(30);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(30, 41, 59);
      const summaryLines = pdf.splitTextToSize(site.summary || "No notes", W - margin * 2 - 16);
      summaryLines.forEach(sl => { checkPage(14); pdf.text(sl, margin + 8, y); y += 13; });
      // Footer
      y += 16;
      checkPage(20);
      pdf.setDrawColor(203, 213, 225);
      pdf.setLineWidth(0.5);
      pdf.line(margin, y, W - margin, y);
      y += 14;
      pdf.setFontSize(7);
      pdf.setTextColor(148, 163, 184);
      pdf.text("PS Acquisition Pipeline  |  DJR Real Estate LLC  |  Confidential  |  Generated " + new Date().toLocaleString(), margin, y);
      // Save
      const safeName = (site.city || "Site").replace(/[^a-zA-Z0-9]/g, "_");
      pdf.save("PS_Vetting_Report_" + safeName + "_" + (site.state || "") + ".pdf");
    }).catch(err => { console.error("PDF generation failed:", err); alert("PDF generation failed. Check console."); });
  };


// âââ SiteIQâ¢ v3 â Calibrated PS Site Scoring Engine âââ
// Matches CLAUDE.md Â§6h framework exactly. Uses structured data fields, not regex on summary text.
// Weights: Demographics 25% (pop) + 15% (HHI), PS Proximity 20%, Zoning 15%, Access 10%, Competition 5%, Market Tier 10%
// Hard FAIL: pop <5K, HHI <$55K, PS <2.5mi, landlocked
const computeSiteIQ = (site, targetMarkets = []) => {
  const scores = {};
  const flags = [];
  let hardFail = false;
  const summary = (site.summary || "").toLowerCase();
  const combinedText = ((site.zoning || "") + " " + (site.summary || "")).toLowerCase();

  // --- HELPERS ---
  const parseNum = (v) => { const n = parseInt(String(v || "").replace(/[^0-9]/g, ""), 10); return isNaN(n) ? 0 : n; };
  let acres = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
  if (isNaN(acres) || acres === 0) {
    const acMatch = (site.askingPrice || "").match(/([\d,.]+)\s*(?:\+\/-)?\s*(?:acres?|ac\b)/i);
    if (acMatch) acres = parseFloat(acMatch[1].replace(/,/g, ""));
  }
  const popRaw = parseNum(site.pop3mi);
  const incRaw = parseNum(site.income3mi);
  const hasDemoData = popRaw > 0 || incRaw > 0;

  // --- 1. DEMOGRAPHICS â POPULATION (25%) Â§6h calibrated ---
  let popScore = 5;
  if (popRaw > 0) {
    if (popRaw >= 40000) popScore = 10;
    else if (popRaw >= 25000) popScore = 8;
    else if (popRaw >= 15000) popScore = 6;
    else if (popRaw >= 10000) popScore = 5;
    else if (popRaw >= 5000) popScore = 3;
    else { popScore = 0; hardFail = true; flags.push("FAIL: 3-mi pop under 5,000"); }
  }
  scores.population = popScore;

  // --- 2. DEMOGRAPHICS â HHI (15%) Â§6h calibrated ---
  let incScore = 5;
  if (incRaw > 0) {
    if (incRaw >= 90000) incScore = 10;
    else if (incRaw >= 75000) incScore = 8;
    else if (incRaw >= 65000) incScore = 6;
    else if (incRaw >= 55000) incScore = 4;
    else { incScore = 0; hardFail = true; flags.push("FAIL: 3-mi HHI under $55K"); }
  }
  scores.income = incScore;

  // --- 2b. GROWTH (15%) — ESRI 5-year population CAGR ---
  let growthScore = 5; // default when no ESRI data
  const growthRaw = site.popGrowth3mi ? parseFloat(String(site.popGrowth3mi).replace(/[^0-9.\-+]/g, "")) : null;
  if (growthRaw !== null && !isNaN(growthRaw)) {
    if (growthRaw >= 2.0) growthScore = 10;       // booming — Sun Belt corridors
    else if (growthRaw >= 1.5) growthScore = 9;    // strong growth
    else if (growthRaw >= 1.0) growthScore = 8;    // healthy above-national
    else if (growthRaw >= 0.5) growthScore = 6;    // moderate positive
    else if (growthRaw >= 0.0) growthScore = 4;    // flat — no tailwind
    else if (growthRaw >= -0.5) growthScore = 2;   // declining — headwind
    else { growthScore = 0; flags.push("WARN: 3-mi pop declining > -0.5%/yr"); }
  }
  scores.growth = growthScore;

  // --- 3. PS PROXIMITY (20%) ---
  let spacingScore = 4;
  const nearestPS = parseFloat(site.siteiqData?.nearestPS || 0);
  if (nearestPS > 0) {
    if (nearestPS >= 5) spacingScore = 10;
    else if (nearestPS >= 3) spacingScore = 8;
    else if (nearestPS >= 2.5) spacingScore = 5;
    else { spacingScore = 0; hardFail = true; flags.push("FAIL: PS within 2.5 mi (" + nearestPS.toFixed(1) + " mi)"); }
  } else {
    if (/bullseye/i.test(summary) || /\b([5-9]|1\d)\+?\s*mi/i.test(summary) || /no\s*(?:nearby|close)\s*ps/i.test(summary)) spacingScore = 9;
    else if (/\b[34]\s*mi/i.test(summary) || /good\s*spacing/i.test(summary)) spacingScore = 7;
    else if (/\b[12]\.?\d?\s*mi\b/i.test(summary) || /close\s*to\s*ps/i.test(summary) || /spacing.*tight/i.test(summary)) spacingScore = 3;
  }
  scores.spacing = spacingScore;

  // --- 4. ZONING (15%) Â§6c methodology ---
  const byRight = /(by\s*right|permitted|storage\s*(?:by|permitted)|(?:^|\s)(?:cs|gb|mu|b[- ]?\d|c[- ]?\d|m[- ]?\d)\b|commercial|industrial|business|unrestricted|pud\s*allow)/i;
  const conditional = /(conditional|sup\b|cup\b|special\s*use|overlay|variance|needs?\s*sup)/i;
  const prohibited = /(prohibited|residential\s*only|(?:^|\s)ag\b|agriculture|not\s*permitted)/i;
  const rezoning = /(rezone|rezoning\s*required)/i;
  let zoningScore = 3;
  if (byRight.test(combinedText)) zoningScore = 10;
  else if (conditional.test(combinedText)) zoningScore = 6;
  else if (rezoning.test(combinedText)) zoningScore = 2;
  else if (prohibited.test(combinedText)) { zoningScore = 0; flags.push("Zoning prohibits storage"); }
  else if ((site.zoning || "").trim()) zoningScore = 5;
  scores.zoning = zoningScore;

  // --- 5. ACCESS & VISIBILITY (10%) ---
  let accessScore = 5;
  if (!isNaN(acres) && acres > 0) {
    if (acres >= 3.5 && acres <= 5) accessScore = 8;
    else if (acres >= 2.5 && acres < 3.5) accessScore = 6;
    else if (acres > 5 && acres <= 7) accessScore = 7;
    else if (acres > 7) accessScore = 5;
    else if (acres >= 2) accessScore = 4;
    else accessScore = 2;
  }
  if (/\d+['\s]*(?:frontage|front|linear)/i.test(summary) || /frontage/i.test(summary)) accessScore = Math.min(10, accessScore + 2);
  if (/landlocked|no\s*access|easement\s*only/i.test(summary)) { accessScore = 0; hardFail = true; flags.push("FAIL: Landlocked / no road access"); }
  if (/flood/i.test(summary)) accessScore = Math.max(1, accessScore - 2);
  if (/take\s*half|subdivis|split/i.test(summary) && !isNaN(acres) && acres > 5) accessScore = Math.min(10, accessScore + 2);
  scores.access = Math.min(10, Math.max(0, accessScore));

  // --- 6. COMPETITION (5%) ---
  let compScore = 4;
  const compCount = site.siteiqData?.competitorCount;
  if (compCount !== undefined && compCount !== null) {
    if (compCount <= 1) compScore = 10;
    else if (compCount <= 3) compScore = 6;
    else compScore = 3;
  } else {
    if (/no\s*(?:nearby|existing)\s*(?:storage|competition|competitor)/i.test(summary) || /low\s*competition/i.test(summary)) compScore = 9;
    else if (/storage\s*(?:next\s*door|adjacent|nearby)/i.test(summary) || /high\s*competition/i.test(summary) || /saturated/i.test(summary)) compScore = 3;
    else if (/competitor/i.test(summary)) compScore = 5;
  }
  scores.competition = compScore;

  // --- 7. MARKET TIER (10%) ---
  let tierScore = 2;
  const tier = site.siteiqData?.marketTier;
  if (tier === 1) tierScore = 10;
  else if (tier === 2) tierScore = 8;
  else if (tier === 3) tierScore = 6;
  else if (tier === 4) tierScore = 4;
  else {
    const mkt = (site.market || "").toLowerCase();
    if (/cinc|nky|n\.?\s*ky|northern\s*kent/i.test(mkt)) tierScore = 10;
    else if (/ind|indy/i.test(mkt)) tierScore = 10;
    else if (/independence|springboro|s\.?\s*dayton/i.test(mkt)) tierScore = 8;
    else if (/tn|tenn|nashville|murfreesboro|clarksville|lebanon/i.test(mkt)) tierScore = 6;
    else if (/dfw|dallas|austin|houston|san\s*ant/i.test(mkt)) tierScore = 4;
    else if (/boston|mass|worcester|springfield|new\s*jersey|nj|conn|hartford|stamford/i.test(mkt)) tierScore = 4;
    else if (/michigan|detroit|grand\s*rapids|ann\s*arbor|lansing/i.test(mkt)) tierScore = 4;
  }
  scores.marketTier = tierScore;

  // --- COMPOSITE (weighted sum, 0-10 scale) ---
    const weightedSum =
    (popScore * getIQWeight("population")) + (growthScore * getIQWeight("growth")) +
    (incScore * getIQWeight("income")) + (spacingScore * getIQWeight("spacing")) +
    (zoningScore * getIQWeight("zoning")) + (scores.access * getIQWeight("access")) +
    (compScore * getIQWeight("competition")) + (tierScore * getIQWeight("marketTier"));
  let adjusted = Math.round(weightedSum * 10) / 10;

    // --- TARGET MARKET TIER BONUS (additive) ---
    if (targetMarkets && targetMarkets.length > 0) {
      const siteMarket = (site.market || "").toLowerCase().trim();
      const siteCity = (site.city || "").toLowerCase().trim();
      const siteState = (site.state || "").toUpperCase().trim();
      let bestBonus = 0;
      for (const tm of targetMarkets) {
        if (!tm.active) continue;
        const tmName = (tm.name || "").toLowerCase().trim();
        const tmStates = (tm.states || "").toUpperCase().split(",").map(s => s.trim()).filter(Boolean);
        const nameMatch = tmName && (siteMarket.includes(tmName) || tmName.includes(siteMarket) || siteCity.includes(tmName) || tmName.includes(siteCity));
        const stateMatch = tmStates.length > 0 && tmStates.includes(siteState);
        if (nameMatch || stateMatch) {
          const tierBonus = Number(tm.tier) === 1 ? 1.0 : Number(tm.tier) === 2 ? 0.6 : Number(tm.tier) === 3 ? 0.3 : 0.1;
          bestBonus = Math.max(bestBonus, tierBonus);
        }
      }
      if (bestBonus > 0) adjusted = Math.min(10, adjusted + bestBonus);
    }

  // --- PHASE BONUS ---
  const phase = (site.phase || "").toLowerCase();
  if (/under contract|due diligence|closed/i.test(phase)) adjusted = Math.min(10, adjusted + 0.3);
  else if (/loi signed/i.test(phase)) adjusted = Math.min(10, adjusted + 0.2);
  else if (/loi sent/i.test(phase)) adjusted = Math.min(10, adjusted + 0.1);

  // --- STALE LISTING PENALTY ---
  if (site.dateOnMarket) {
    const dom = Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000);
    if (dom > 1000) { adjusted = Math.max(0, adjusted - 0.5); flags.push("Stale: " + dom + " DOM"); }
  }

  // --- BROKER INTEL BONUSES (from siteiqData) ---
  if (site.siteiqData?.brokerConfirmedZoning) adjusted = Math.min(10, adjusted + 0.3);
  if (site.siteiqData?.surveyClean) adjusted = Math.min(10, adjusted + 0.2);

  const final = Math.round(adjusted * 10) / 10;

  // --- CLASSIFICATION (Â§6h) ---
  let classification, classColor;
  if (hardFail) { classification = "RED"; classColor = "#DC2626"; }
  else if (final >= 7.5) { classification = "GREEN"; classColor = "#16A34A"; }
  else if (final >= 5.5) { classification = "YELLOW"; classColor = "#D97706"; }
  else if (final >= 3.0) { classification = "ORANGE"; classColor = "#EA580C"; }
  else { classification = "RED"; classColor = "#DC2626"; }

  return {
    _iq: { zoning: zoningScore, spacing: spacingScore, demographics: (popScore + incScore) / 2, competition: compScore, pricing: tierScore, access: accessScore },
      marketBonus: (() => { if (!targetMarkets || !targetMarkets.length) return null; const sm = (site.market || "").toLowerCase(); const sc = (site.city || "").toLowerCase(); const ss = (site.state || "").toUpperCase(); for (const tm of targetMarkets) { if (!tm.active) continue; const tn = (tm.name || "").toLowerCase(); const ts = (tm.states || "").toUpperCase().split(",").map(s=>s.trim()); if ((tn && (sm.includes(tn) || tn.includes(sm) || sc.includes(tn) || tn.includes(sc))) || (ts.length && ts.includes(ss))) return { name: tm.name, tier: tm.tier, bonus: tm.tier===1?1.0:tm.tier===2?0.6:tm.tier===3?0.3:0.1 }; } return null; })(),
    score: final, scores, flags, hardFail, hasDemoData, classification, classColor,
    tier: final >= 8 ? "gold" : final >= 6 ? "steel" : "gray",
    label: final >= 9 ? "ELITE" : final >= 8 ? "PRIME" : final >= 7 ? "STRONG" : final >= 6 ? "VIABLE" : final >= 4 ? "MARGINAL" : "WEAK",
  };
};

// âââ SiteIQ Badge Component âââ
function SiteIQBadge({ site, size = "normal" }) {
  const [hoveredMetric, setHoveredMetric] = useState(null);
  const iq = computeSiteIQ(site);
  const s = iq.score;
  const isGold = iq.tier === "gold";
  const isSteel = iq.tier === "steel";
  const isSmall = size === "small";

  const tierColors = {
    gold: { bg: "linear-gradient(135deg, #C9A84C, #E8C84A, #C9A84C)", glow: "0 0 20px rgba(201,168,76,0.5), 0 0 40px rgba(201,168,76,0.2)", text: "#1E2761", ring: "#C9A84C", labelBg: "#FFF8E1" },
    steel: { bg: "linear-gradient(135deg, #2C3E6B, #3D5A99, #2C3E6B)", glow: "0 2px 8px rgba(44,62,107,0.3)", text: "#fff", ring: "#2C3E6B", labelBg: "#E8EAF6" },
    gray: { bg: "linear-gradient(135deg, #94A3B8, #B0BEC5, #94A3B8)", glow: "0 2px 6px rgba(148,163,184,0.2)", text: "#fff", ring: "#94A3B8", labelBg: "#F1F5F9" },
  };
  const tc = tierColors[iq.tier];

  // Small badge style variables
    const smallColor = isGold ? "#C9A84C" : isSteel ? "#2C3E6B" : "#64748B";
    const smallBg = isGold ? "linear-gradient(135deg, #1a1a2e, #16213e)" : isSteel ? "linear-gradient(135deg, #0f172a, #1e293b)" : tc.labelBg;
    const smallTextColor = isGold ? "#C9A84C" : isSteel ? "#8BACD4" : "#64748B";
  // Small inline badge (collapsed card header)
  if (isSmall) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "2px 8px 2px 6px", borderRadius: 6,
        background: tierColors[iq.tier]?.bg || tierColors.gray.bg,
        border: "1px solid " + (tierColors[iq.tier]?.border || tierColors.gray.border),
        fontSize: 12, fontWeight: 700, color: tierColors[iq.tier]?.text || tierColors.gray.text,
        fontFamily: "'Space Mono', monospace",
        boxShadow: isGold ? "0 0 8px rgba(201,168,76,0.3)" : "none"
      }}>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, opacity: 0.7 }}>IQ</span>
        {s.toFixed(1)}
      </span>
    );
  }

  // Full-width executive badge (expanded property view)
  const radius = 52;
  const stroke = 6;
  const circ = 2 * Math.PI * radius;
  const pctFill = Math.min(s / 10, 1);
  const ringColor = isGold ? '#c9a84c' : isSteel ? '#7b9bb5' : '#6b7280';
  const glowColor = isGold ? 'rgba(201,168,76,0.4)' : isSteel ? 'rgba(123,155,181,0.3)' : 'none';


  const demoWeight = (SITE_IQ_CONFIG.dimensions.find(d => d.key === 'population')?.weight || 0) + (SITE_IQ_CONFIG.dimensions.find(d => d.key === 'income')?.weight || 0);
  const metrics = [
    { key: 'zoning', label: 'Zoning', weight: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'zoning')?.weight || 15, icon: 'âï¸', score: iq._iq?.zoning ?? 0, tip: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'zoning')?.tip || '', source: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'zoning')?.source || '' },
    { key: 'demographics', label: 'Demographics', weight: demoWeight, icon: 'ð¥', score: iq._iq?.demographics ?? 0, tip: 'Combined population density + median household income within 3-mile radius', source: 'Census ACS / ESRI' },
    { key: 'spacing', label: 'PS Spacing', weight: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'spacing')?.weight || 15, icon: 'ð¡', score: iq._iq?.spacing ?? 0, tip: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'spacing')?.tip || '', source: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'spacing')?.source || '' },
    { key: 'competition', label: 'Competition', weight: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'competition')?.weight || 10, icon: 'ð¢', score: iq._iq?.competition ?? 0, tip: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'competition')?.tip || '', source: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'competition')?.source || '' },
    { key: 'access', label: 'Site Access', weight: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'access')?.weight || 5, icon: 'ð£ï¸', score: iq._iq?.access ?? 0, tip: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'access')?.tip || '', source: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'access')?.source || '' },
    { key: 'pricing', label: 'Pricing', weight: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'pricing')?.weight || 10, icon: 'ð²', score: iq._iq?.pricing ?? 0, tip: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'pricing')?.tip || '', source: SITE_IQ_CONFIG.dimensions.find(d => d.key === 'pricing')?.source || '' }
  ];

  return (
    <div style={{ width: '100%' }}>
      {/* Top row: Score ring + tier label + data source */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 20 }}>
        {/* Score Ring */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <svg width={radius * 2 + stroke * 2} height={radius * 2 + stroke * 2} style={{ filter: glowColor !== 'none' ? 'drop-shadow(0 0 6px ' + glowColor + ')' : 'none' }}>
            <circle cx={radius + stroke} cy={radius + stroke} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
            <circle cx={radius + stroke} cy={radius + stroke} r={radius} fill="none" stroke={ringColor} strokeWidth={stroke}
              strokeDasharray={circ} strokeDashoffset={circ * (1 - pctFill)} strokeLinecap="round"
              style={{ transform: 'rotate(-90deg)', transformOrigin: 'center', transition: 'stroke-dashoffset 0.8s ease' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 32, fontWeight: 800, color: '#e0e7ff', lineHeight: 1 }}>{Math.floor(s)}<span style={{ fontSize: 18, fontWeight: 600 }}>.{((s % 1) * 10).toFixed(0)}</span></span>
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1.5, color: '#64748b', marginTop: 2 }}>SITE IQ</span>
          </div>
        </div>

        {/* Tier + Label */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 2, color: isGold ? '#c9a84c' : isSteel ? '#7b9bb5' : '#9ca3af', fontStyle: 'italic' }}>{iq.label}</span>
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', letterSpacing: 0.5 }}>SiteIQâ¢</span>
          </div>
          <span style={{ fontSize: 11, color: '#64748b' }}>Census + field data</span>
        </div>
      </div>

      {/* Full-width metric bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {metrics.map((m, i) => {
          const pct = Math.min(Math.max(m.score / 10, 0), 1);
          const isHigh = m.score >= 7;
          const isMed = m.score >= 4 && m.score < 7;
          const barGrad = isHigh ? 'linear-gradient(90deg, #059669, #34d399)' : isMed ? 'linear-gradient(90deg, #d97706, #fbbf24)' : 'linear-gradient(90deg, #dc2626, #f87171)';
          const scoreColor = isHigh ? '#34d399' : isMed ? '#fbbf24' : '#f87171';

          return (
            <div key={m.key}
              onMouseEnter={() => setHoveredMetric(m.key)}
              onMouseLeave={() => setHoveredMetric(null)}
              style={{ position: 'relative', cursor: 'pointer' }}>
              {/* Label row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>{m.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: '#cbd5e1', textTransform: 'uppercase' }}>{m.label}</span>
                  <span style={{ fontSize: 10, color: '#475569', fontWeight: 500 }}>{m.weight}%</span>
                </div>
                <span style={{ fontSize: 16, fontWeight: 800, color: scoreColor, fontFamily: "'Space Mono', monospace" }}>{m.score.toFixed(1)}</span>
              </div>
              {/* Bar track â FULL WIDTH */}
              <div style={{ height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 5,
                  width: (pct * 100) + '%',
                  background: barGrad,
                  boxShadow: isHigh ? '0 0 8px rgba(52,211,153,0.3)' : 'none',
                  transition: 'width 0.6s ease'
                }} />
              </div>

              {/* Hover tooltip */}
              {hoveredMetric === m.key && (
                <div style={{
                  position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                  marginTop: 8, padding: '10px 14px', borderRadius: 10, zIndex: 50,
                  background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(99,102,241,0.3)',
                  backdropFilter: 'blur(12px)', maxWidth: 320, minWidth: 200,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e0e7ff', marginBottom: 4 }}>{m.icon} {m.label} ({m.weight}%)</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>{m.tip}</div>
                  {m.source && <div style={{ fontSize: 10, color: '#475569', marginTop: 6, fontStyle: 'italic' }}>Source: {m.source}</div>}
                  <div style={{ position: 'absolute', top: -5, left: '50%', transform: 'translateX(-50%) rotate(45deg)', width: 10, height: 10, background: 'rgba(15,23,42,0.95)', borderTop: '1px solid rgba(99,102,241,0.3)', borderLeft: '1px solid rgba(99,102,241,0.3)' }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
function Badge({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.pending;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: s.bg,
        color: s.text,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: s.dot,
        }}
      />
      {status}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const c = PRIORITY_COLORS[priority] || "#CBD5E1";
  return priority && priority !== "âª None" ? (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: c,
        background: c + "18",
        padding: "2px 8px",
        borderRadius: 6,
      }}
    >
      {priority}
    </span>
  ) : null;
}

function EF({ label, value, onSave, placeholder, multi }) {
  const [local, setLocal] = useState(value || "");
  const prevValue = useRef(value);
  useEffect(() => {
    if (value !== prevValue.current) {
      setLocal(value || "");
      prevValue.current = value;
    }
  }, [value]);
  const st = {
    width: "100%",
    padding: multi ? "8px 10px" : "6px 10px",
    borderRadius: 8,
    border: "1px solid #E2E8F0",
    fontSize: 13,
    fontFamily: "'DM Sans', sans-serif",
    background: "#FAFBFC",
    color: "#2C2C2C",
    outline: "none",
    boxSizing: "border-box",
    resize: multi ? "vertical" : "none",
  };
  const debouncedSave = useCallback(debounce((v) => onSave(v), 400), [onSave]);
  const handleBlur = () => {
    if (local !== (value || "")) debouncedSave(local);
  };
  return (
    <div>
      {label && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#94A3B8",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 3,
          }}
        >
          {label}
        </div>
      )}
      {multi ? (
        <textarea
          style={{ ...st, minHeight: 60 }}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
        />
      ) : (
        <input
          style={st}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

// âââ Seed Data REMOVED (v3) âââ
// All 47 sites (33 DW + 14 MT) are in Firebase with verified data.
// Seed data was stale (missing coordinates, demographics, acreage) and risked overwriting live data.
// New sites are added via Submit Site form, Bulk Import, or Claude's Â§6h broker response pipeline.
const DW_SEED = [];
const MT_SEED = [];

// âââ MAIN APP âââ
// --- Error Boundary (UX-04) ---
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return React.createElement('div', {
        style: { padding: 40, textAlign: 'center', fontFamily: 'system-ui' }
      },
        React.createElement('h2', { style: { color: '#dc2626' } }, 'Something went wrong'),
        React.createElement('p', { style: { color: '#666', marginTop: 8 } },
          this.state.error ? this.state.error.message : 'Unknown error'),
        React.createElement('button', {
          onClick: () => window.location.reload(),
          style: { marginTop: 16, padding: '8px 24px', cursor: 'pointer',
            background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6 }
        }, 'Reload Page')
      );
    }
    return this.props.children;
  }
}

function App() {
  // AUTH GATE (Finding 2.3)
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [weightEditorOpen, setWeightEditorOpen] = useState(false);
  const [editWeights, setEditWeights] = useState(() => SITE_IQ_CONFIG.dimensions.map(d => ({ key: d.key, label: d.label, weight: d.weight })));
  const [configLoaded, setConfigLoaded] = useState(false);

  // Load SiteIQ weights from Firebase (allows exec overrides without code changes)
  useEffect(() => {
    const configRef = ref(db, 'config/siteiq_weights');
    const unsub = onValue(configRef, (snap) => {
      const saved = snap.val();
      if (saved && saved.dimensions) {
        // Merge saved weights into config
        saved.dimensions.forEach(sd => {
          const dim = SITE_IQ_CONFIG.dimensions.find(d => d.key === sd.key);
          if (dim) dim.weight = sd.weight;
        });
        SITE_IQ_CONFIG = normalizeSiteIQWeights(SITE_IQ_CONFIG);
        setEditWeights(SITE_IQ_CONFIG.dimensions.map(d => ({ key: d.key, label: d.label, weight: d.weight })));
      }
      setConfigLoaded(true);
    });
    return () => unsub();
  }, []);


  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
    return unsub;
  }, []);

  const handleLogin = async () => {
    setLoginError("");
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPass);
    } catch (e) {
      setLoginError(e.code === "auth/wrong-password" || e.code === "auth/invalid-credential" ? "Invalid email or password." : e.code === "auth/user-not-found" ? "No account found." : "Login failed: " + e.message);
    }
  };


  const [loaded, setLoaded] = useState(false);
  const [subs, setSubs] = useState([]);
  const [east, setEast] = useState([]);
  const [sw, setSw] = useState([]);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [expandedSite, setExpandedSite] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [showNewAlert, setShowNewAlert] = useState(false);
  const [newSiteCount, setNewSiteCount] = useState(0);
  const emptyForm = { name: "", address: "", city: "", state: "", notes: "", region: "southwest", acreage: "", askingPrice: "", zoning: "", sellerBroker: "", coordinates: "", listingUrl: "" };
  const [form, setForm] = useState(emptyForm);
  const [submitMode, setSubmitMode] = useState("direct");
  const [flyerFile, setFlyerFile] = useState(null);
  const [flyerParsing, setFlyerParsing] = useState(false);
  const [flyerPreview, setFlyerPreview] = useState(null);
  const flyerRef = useRef();
  const [attachments, setAttachments] = useState([]); // [{file, type, id}]
  const attachRef = useRef();
  const [reviewInputs, setReviewInputs] = useState({});
  const [msgInputs, setMsgInputs] = useState({});
  const [sortBy, setSortBy] = useState("city");
  const [filterState, setFilterState] = useState("all");
  const [filterPhase, setFilterPhase] = useState("all");
  const [highlightedSite, setHighlightedSite] = useState(null);
  const [shareLink, setShareLink] = useState(null);
  const [seeded, setSeeded] = useState(false);
  const [demoLoading, setDemoLoading] = useState({});
  const [demoReport, setDemoReport] = useState({});
  const [targetMarkets, setTargetMarkets] = useState([]);
  const [showAddMarket, setShowAddMarket] = useState(false);
  const [newMarketForm, setNewMarketForm] = useState({ name: "", tier: 1, states: "", assignedTo: "MT", active: true });
  const [marketsOpen, setMarketsOpen] = useState(false);
  // vettingReport removed â auto-generates on site add

  // âââ KEYBOARD NAVIGATION â Arrow keys to toggle between properties âââ
  useEffect(() => {
    const handleKeyNav = (e) => {
      if (tab !== "southwest" && tab !== "east") return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Escape") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      const sites = sortData(tab === "east" ? east : sw);
      if (!sites.length) return;
      const ids = sites.map(s => s.id);
      if (e.key === "Escape") { setExpandedSite(null); return; }
      const curIdx = expandedSite ? ids.indexOf(expandedSite) : -1;
      let nextIdx;
      if (e.key === "ArrowDown") {
        nextIdx = curIdx < ids.length - 1 ? curIdx + 1 : 0;
      } else {
        nextIdx = curIdx > 0 ? curIdx - 1 : ids.length - 1;
      }
      const nextId = ids[nextIdx];
      setExpandedSite(nextId);
      setTimeout(() => {
        const el = document.getElementById(`site-${nextId}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    };
    window.addEventListener("keydown", handleKeyNav);
    return () => window.removeEventListener("keydown", handleKeyNav);
  }, [tab, expandedSite, sw, east, sortBy]);


  // âââ FONT LOADER âââ
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap";
    document.head.appendChild(link);
  }, []);

  // âââ FIREBASE REAL-TIME LISTENERS âââ
  useEffect(() => {
    let unsubMarkets;
    const subsRef = ref(db, "submissions");
    const eastRef = ref(db, "east");
    const swRef = ref(db, "southwest");
    const metaRef = ref(db, "meta/seeded");

    const unsubSeed = onValue(metaRef, (snap) => {
      setSeeded(!!snap.val());
    });

    const unsubSubs = onValue(subsRef, (snap) => {
      const val = snap.val();
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      setSubs(arr);
    });
    const unsubEast = onValue(eastRef, (snap) => {
      const val = snap.val();
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      setEast(arr);
      setLoaded(true);
    });
    const unsubSw = onValue(swRef, (snap) => {
      const val = snap.val();
    const marketsRef = ref(db, "targetMarkets");
    unsubMarkets = onValue(marketsRef, (snap) => {
      const val = snap.val();
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      setTargetMarkets(arr);
    });
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      setSw(arr);
    });

    return () => {
      unsubSubs();
      unsubEast();
      unsubSw();
      unsubSeed();
          if (typeof unsubMarkets === "function") unsubMarkets();
    };
  }, []);

  // âââ SEED ON FIRST LOAD âââ
  useEffect(() => {
    if (!loaded || seeded) return;
    const now = new Date().toISOString();
    const make = (d, reg) => ({
      ...d,
      region: reg,
      id: uid(),
      status: "tracking",
      submittedAt: now,
      approvedAt: now,
      phase: "Prospect",
      acreage: d.acreage || "",
      zoning: d.zoning || "",
      askingPrice: d.askingPrice || "",
      internalPrice: d.internalPrice || "",
      income3mi: d.income3mi || "",
      pop3mi: d.pop3mi || "",
      sellerBroker: d.sellerBroker || "",
      summary: d.summary || "",
      coordinates: d.coordinates || "",
      market: d.market || "",
      priority: "âª None",
      messages: {},
      activityLog: {},
      docs: {},
    });
    const dwSites = DW_SEED.map((d) => make(d, "southwest"));
    const mtSites = MT_SEED.map((d) => make(d, "east"));
    const updates = {};
    dwSites.forEach((s) => {
      updates[`southwest/${s.id}`] = s;
    });
    mtSites.forEach((s) => {
      updates[`east/${s.id}`] = s;
    });
    updates["meta/seeded"] = true;
    import("firebase/database").then(({ ref: fbRef, update: fbUpdate }) => {
      fbUpdate(ref(db, "/"), updates).catch(console.error);
    });
  }, [loaded, seeded]);

  // âââ ALERT for pending sites âââ
  useEffect(() => {
    if (!loaded) return;
    const pending = subs.filter((s) => s.status === "pending");
    const lastSeen = localStorage.getItem("ps-last-seen");
    const seenTs = lastSeen ? new Date(lastSeen).getTime() : 0;
    const newOnes = pending.filter(
      (x) => new Date(x.submittedAt).getTime() > seenTs
    );
    if (newOnes.length > 0) {
      setNewSiteCount(newOnes.length);
      setShowNewAlert(true);
    }
    localStorage.setItem("ps-last-seen", new Date().toISOString());
    // Deep link review
    try {
      const params = new URLSearchParams(window.location.search);
      const reviewId = params.get("review");
      if (reviewId && subs.find((s) => s.id === reviewId)) {
        setTab("review");
        setHighlightedSite(reviewId);
        setShowNewAlert(false);
        setTimeout(() => {
          const el = document.getElementById(`review-${reviewId}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 500);
      }
    } catch {}
  }, [loaded, subs]);

  const notify = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 2800);
  };

  // âââ FIREBASE WRITE HELPERS âââ
  const fbSet = (path, value) => set(ref(db, path), value);
  const fbUpdate = (path, value) => update(ref(db, path), value);
  const fbPush = (path, value) => push(ref(db, path), value);
  const fbRemove = (path) => remove(ref(db, path));

  const updateSiteField = (region, id, field, value) => {
    fbUpdate(`${region}/${id}`, { [field]: value });
  };

  const saveField = (region, id, field, value) => {
    const logEntry = {
      action: `${field} updated`,
      ts: new Date().toISOString(),
      by: "User",
    };
    fbUpdate(`${region}/${id}`, { [field]: value });
    fbPush(`${region}/${id}/activityLog`, logEntry);
  };

  const handleSendMsg = (region, id) => {
    const mi = msgInputs[id] || { from: "Dan R", text: "" };
    if (!mi.text.trim()) return;
    const msg = {
      from: mi.from,
      text: mi.text.trim(),
      ts: new Date().toISOString(),
    };
    fbPush(`${region}/${id}/messages`, msg);
    setMsgInputs({ ...msgInputs, [id]: { from: mi.from, text: "" } });
    notify(`Sent from ${mi.from}`);
  };

  const handleRemove = (region, id) => {
    fbRemove(`${region}/${id}`);
    notify("Removed.");
    setExpandedSite(null);
  };

  // âââ GEOCODE & DEMOGRAPHICS âââ
  
  const handleAddMarket = () => {
    if (!newMarketForm.name.trim()) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const mkt = { ...newMarketForm, name: newMarketForm.name.trim(), states: newMarketForm.states.trim(), tier: Number(newMarketForm.tier) || 1, createdAt: new Date().toISOString() };
    set(ref(db, "targetMarkets/" + id), mkt);
    setNewMarketForm({ name: "", tier: 1, states: "", assignedTo: "MT", active: true });
    setShowAddMarket(false);
    setToast("Market added: " + mkt.name); setTimeout(() => setToast(null), 3000);
  };
  const handleRemoveMarket = (id) => {
    remove(ref(db, "targetMarkets/" + id));
    setToast("Market removed"); setTimeout(() => setToast(null), 3000);
  };
  const handleToggleMarket = (id, currentActive) => {
    update(ref(db, "targetMarkets/" + id), { active: !currentActive });
  };

const handleFetchDemos = async (region, site) => {
    if (!site.coordinates) return;
    setDemoLoading(prev => ({ ...prev, [site.id]: true }));
    try {
      // Try ESRI data already in Firebase first
      const esriReport = buildDemoReport(site);
      if (esriReport) {
        setDemoReport((prev) => ({ ...prev, [site.id]: esriReport }));
        notify("ESRI 2025 demographics loaded");
      } else {
        // Fallback to Census API if ESRI data not yet available
        const result = await fetchDemographics(site.coordinates);
      if (result.error) {
        notify(result.error);
      } else if (result) {
        const updates = {};
        const demoFields = ["pop1mi","pop3mi","pop5mi","income1mi","income3mi","income5mi","households1mi","households3mi","households5mi","homeValue1mi","homeValue3mi","homeValue5mi","popGrowth1mi","popGrowth3mi","popGrowth5mi","renterPct1mi","renterPct3mi","renterPct5mi"];
        for (const f of demoFields) { if (result[f] !== undefined && result[f] !== null) updates[f] = result[f]; }
        if (result.source) updates.demoSource = result.source;
        if (result.fips) updates.demoFips = result.fips;
        updates.demoPulledAt = new Date().toISOString();
        if (result.tractCounts) updates.demoTractCounts = JSON.stringify(result.tractCounts);
        if (Object.keys(updates).length > 0) {
          fbUpdate(region, site.id, updates);
          fbPush(region, site.id, "activityLog", {
            action: "Demographics pulled â Pop " + (result.pop3mi || "N/A") + " | HHI " + (result.income3mi || "N/A") + " | Growth " + (result.popGrowth3mi !== null ? result.popGrowth3mi + "%" : "N/A") + " | Renters " + (result.renterPct3mi !== null ? result.renterPct3mi + "%" : "N/A"),
            date: new Date().toISOString(), by: "System"
          });
        }
        setDemoReport(prev => ({ ...prev, [site.id]: result }));
        notify(Object.keys(updates).length + " demographic fields saved â 1/3/5 mile rings with growth + renter data");
      }
    }
    } catch (err) { notify("Demographics fetch failed"); console.error(err); }
    setDemoLoading(prev => ({ ...prev, [site.id]: false }));
  };

  // âââ AUTO VETTING REPORT â runs on site add, saves to Firebase Storage âââ
  const autoGenerateVettingReport = (region, siteId, site) => {
    try {
      const report = generateVettingReport(site);
      const docId = uid();
      const now = new Date().toISOString();
      const blob = new Blob([report], { type: "text/plain" });
      const fileName = `Vetting_Report_${site.city || "Site"}_${site.state || ""}_${now.slice(0, 10)}.txt`;
      const file = new File([blob], fileName, { type: "text/plain" });
      const path = `docs/${siteId}/${docId}_${fileName}`;
      const sRef = storageRef(storage, path);
      uploadBytes(sRef, file).then(() => getDownloadURL(sRef)).then((url) => {
        fbPush(`${region}/${siteId}/docs`, { id: docId, name: fileName, type: "Other", url, path, uploadedAt: now });
        fbPush(`${region}/${siteId}/activityLog`, { action: "Vetting report auto-generated & saved", ts: now, by: "System" });
      }).catch((err) => console.error("Vetting report auto-save error:", err));
    } catch (err) {
      console.error("Vetting report generation error:", err);
    }
  };

  // âââ FLYER PARSING âââ
  const parseFlyer = async (file) => {
    setFlyerParsing(true);
    setFlyerFile(file);
    // Preview
    if (file.type.startsWith("image/")) {
      setFlyerPreview(URL.createObjectURL(file));
    } else {
      setFlyerPreview(null);
    }
    try {
      let text = "";
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        // Load pdf.js from CDN
        if (!window.pdfjsLib) {
          await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
          });
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }
        const buf = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          text += tc.items.map((item) => item.str).join(" ") + "\n";
        }
      }
      // Parse extracted text into form fields
      if (text.trim()) {
        const parsed = {};
        // Acreage patterns
        const acreMatch = text.match(/([\d,.]+)\s*(?:\+\/-)?\s*(?:acres?|ac\b|AC\b)/i) || text.match(/(?:acres?|acreage|ac)[:\s]*([\d,.]+)/i);
        if (acreMatch) parsed.acreage = acreMatch[1].replace(/,/g, "");
        // Price patterns
        const priceMatch = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:million|M\b)/i);
        if (priceMatch) {
          const v = parseFloat(priceMatch[1].replace(/,/g, ""));
          parsed.askingPrice = "$" + (v * (priceMatch[0].toLowerCase().includes("million") || priceMatch[0].includes("M") ? 1000000 : 1)).toLocaleString();
        } else {
          const pMatch = text.match(/(?:price|asking|list(?:ed)?)[:\s]*\$\s*([\d,]+)/i) || text.match(/\$\s*([\d,]{5,})/);
          if (pMatch) parsed.askingPrice = "$" + pMatch[1];
        }
        // Zoning
        const zoneMatch = text.match(/(?:zon(?:ing|ed?)|district)[:\s]*([A-Z0-9][\w\s-]{0,20})/i);
        if (zoneMatch) parsed.zoning = zoneMatch[1].trim();
        // Broker / contact
        const brokerMatch = text.match(/(?:broker|agent|contact|listed by|exclusive)[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)/i);
        if (brokerMatch) parsed.sellerBroker = brokerMatch[1];
        // Address patterns â look for street number + street name
        const addrMatch = text.match(/(\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Hwy|Highway|Way|Ct|Court|Pkwy|Parkway|Pl|Place|Cir|Circle)\.?)/i);
        if (addrMatch && !form.address) parsed.address = addrMatch[1];
        // City, State pattern
        const csMatch = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),?\s+([A-Z]{2})\s+\d{5}/);
        if (csMatch) {
          if (!form.city) parsed.city = csMatch[1];
          if (!form.state) parsed.state = csMatch[2];
        }
        // Apply parsed values â only fill empty fields
        setForm((prev) => {
          const updated = { ...prev };
          Object.entries(parsed).forEach(([k, v]) => {
            if (!updated[k]) updated[k] = v;
          });
          return updated;
        });
        notify(`Extracted ${Object.keys(parsed).length} field(s) from flyer`);
      } else if (file.type.startsWith("image/")) {
        notify("Flyer attached â image files can't be auto-parsed (fill fields manually)");
      } else {
        notify("Flyer attached â no text found to extract");
      }
    } catch (err) {
      console.error("Flyer parse error:", err);
      notify("Flyer attached â couldn't extract text");
    }
    setFlyerParsing(false);
  };

  // âââ SUBMIT âââ
  const handleSubmit = async () => {
    if (!form.name || !form.address || !form.city || !form.state) {
      notify("Fill name, address, city, state.");
      return;
    }
    const now = new Date().toISOString();
    const id = uid();
    const site = {
      ...form,
      id,
      submittedAt: now,
      phase: "Prospect",
      askingPrice: form.askingPrice || "",
      internalPrice: "",
      income3mi: "",
      pop3mi: "",
      sellerBroker: form.sellerBroker || "",
      summary: form.notes || "",
      coordinates: form.coordinates || "",
      listingUrl: form.listingUrl || "",
      dateOnMarket: "",
      acreage: form.acreage || "",
      zoning: form.zoning || "",
      market: "",
      priority: "âª None",
      messages: {},
      docs: {},
      activityLog: { [uid()]: { action: "Site submitted", ts: now, by: "User" } },
    };
    // Upload all attached files to Firebase Storage
    const allFiles = [];
    if (flyerFile) allFiles.push({ file: flyerFile, type: "Flyer" });
    attachments.forEach((a) => allFiles.push({ file: a.file, type: a.type }));
    if (allFiles.length > 0) {
      const docsObj = {};
      for (const { file, type } of allFiles) {
        try {
          const docId = uid();
          const path = `docs/${id}/${docId}_${file.name}`;
          const sRef = storageRef(storage, path);
          await uploadBytes(sRef, file);
          const url = await getDownloadURL(sRef);
          docsObj[docId] = { id: docId, name: file.name, type, url, path, uploadedAt: now };
        } catch (e) {
          console.error(`Upload error (${type}):`, e);
        }
      }
      site.docs = docsObj;
    }
    if (submitMode === "direct") {
      const t = { ...site, status: "tracking", approvedAt: now };
      fbSet(`${form.region}/${id}`, t);
      fbSet(`submissions/${id}`, { ...site, status: "approved" });
      notify(`Added â ${REGIONS[form.region].label}`);
      setShareLink(null);
      autoGenerateVettingReport(form.region, id, site);
    } else {
      fbSet(`submissions/${id}`, { ...site, status: "pending" });
      notify("Submitted for review!");
      setShareLink(id);
    }
    setForm(emptyForm);
    setFlyerFile(null);
    setFlyerPreview(null);
    setAttachments([]);
    if (flyerRef.current) flyerRef.current.value = "";
    if (attachRef.current) attachRef.current.value = "";
  };

  // âââ REVIEW âââ
  const handleApprove = (id) => {
    const site = subs.find((s) => s.id === id);
    if (!site) return;
    const ri = reviewInputs[id] || {};
    const routeTo = ri.routeTo || site.region || "southwest";
    const routeLabel = REGIONS[routeTo]?.label || routeTo;
    const now = new Date().toISOString();
    const t = {
      ...site,
      region: routeTo,
      status: "tracking",
      approvedAt: now,
      reviewedBy: ri.reviewer || "Dan R",
      reviewNote: ri.note || "",
      askingPrice: site.askingPrice || "",
      internalPrice: site.internalPrice || "",
      income3mi: site.income3mi || "",
      pop3mi: site.pop3mi || "",
      sellerBroker: site.sellerBroker || "",
      summary: site.summary || "",
      coordinates: site.coordinates || "",
      listingUrl: site.listingUrl || "",
      dateOnMarket: site.dateOnMarket || "",
      acreage: site.acreage || "",
      zoning: site.zoning || "",
      market: site.market || "",
      priority: "âª None",
      messages: {},
      docs: {},
      activityLog: { [uid()]: { action: `Approved â routed to ${routeLabel}`, ts: now, by: ri.reviewer || "Dan R" } },
    };
    fbSet(`${routeTo}/${id}`, t);
    fbUpdate(`submissions/${id}`, { status: "approved", reviewedBy: ri.reviewer, reviewNote: ri.note, routedTo: routeTo });
    notify(`Approved â ${routeLabel}`);
    autoGenerateVettingReport(routeTo, id, t);
  };

  const handleApproveAll = () => {
    const p = subs.filter((s) => s.status === "pending");
    if (!p.length) return;
    const now = new Date().toISOString();
    const updates = {};
    p.forEach((s) => {
      const ri = reviewInputs[s.id] || {};
      const routeTo = ri.routeTo || s.region || "southwest";
      const t = {
        ...s,
        region: routeTo,
        status: "tracking",
        approvedAt: now,
        reviewedBy: ri.reviewer || "Dan R",
        priority: "âª None",
        messages: {},
        docs: {},
        activityLog: { [uid()]: { action: `Bulk approved â ${REGIONS[routeTo]?.label || routeTo}`, ts: now, by: "Dan R" } },
      };
      updates[`${routeTo}/${s.id}`] = t;
      updates[`submissions/${s.id}/status`] = "approved";
      updates[`submissions/${s.id}/routedTo`] = routeTo;
    });
    import("firebase/database").then(({ ref: fbRef, update: fbUpd }) => {
      fbUpd(ref(db, "/"), updates);
    });
    notify(`Approved ${p.length}!`);
  };

  const handleDecline = (id) => {
    const ri = reviewInputs[id] || {};
    fbUpdate(`submissions/${id}`, { status: "declined", reviewedBy: ri.reviewer, reviewNote: ri.note });
    notify("Declined.");
  };

  const handleClearDeclined = () => {
    subs.filter((s) => s.status === "declined").forEach((s) => fbRemove(`submissions/${s.id}`));
  };

  // âââ DOCUMENT UPLOAD (Firebase Storage) âââ
  const handleDocUpload = async (region, siteId, file, docType) => {
    if (!file) return;
    if (file.size > 20e6) { notify("Max 20MB per file"); return; }
    const docId = uid();
    const path = `docs/${siteId}/${docId}_${file.name}`;
    try {
      notify("Uploadingâ¦");
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      const docEntry = { id: docId, name: file.name, type: docType, url, path, uploadedAt: new Date().toISOString() };
      fbPush(`${region}/${siteId}/docs`, docEntry);
      notify(`${docType} uploaded!`);
    } catch (e) {
      console.error(e);
      notify("Upload failed â check Firebase Storage rules");
    }
  };

  const handleDocDelete = async (region, siteId, docKey, doc) => {
    try {
      if (doc.path) {
        const sRef = storageRef(storage, doc.path);
        await deleteObject(sRef).catch(() => {});
      }
      fbRemove(`${region}/${siteId}/docs/${docKey}`);
      notify("Document removed.");
    } catch (e) {
      notify("Delete failed");
    }
  };

  // âââ EXPORT âââ
  const handleExport = async () => {
    const XLSX = await import("xlsx");
    const cols = [
      { key: "siteiq", header: "SiteIQâ¢", width: 10 },
      { key: "name", header: "Facility Name", width: 28 },
      { key: "address", header: "Address", width: 30 },
      { key: "city", header: "City", width: 16 },
      { key: "state", header: "ST", width: 6 },
      { key: "acreage", header: "Acreage", width: 12 },
      { key: "zoning", header: "Zoning", width: 20 },
      { key: "phase", header: "Phase", width: 16 },
      { key: "priority", header: "Priority", width: 12 },
      { key: "askingPrice", header: "Asking Price", width: 22 },
      { key: "internalPrice", header: "PS Internal Price", width: 22 },
      { key: "income3mi", header: "3-Mi Avg Income", width: 18 },
      { key: "pop3mi", header: "3-Mi Population", width: 16 },
      { key: "sellerBroker", header: "Seller / Broker", width: 24 },
      { key: "dateOnMarket", header: "Date on Market", width: 16 },
      { key: "dom", header: "Days on Market", width: 16 },
      { key: "summary", header: "Summary / Notes", width: 50 },
      { key: "coordinates", header: "Coordinates", width: 24 },
      { key: "listingUrl", header: "Listing URL", width: 36 },
      { key: "approvedAt", header: "Date Added", width: 14 },
    ];
    const makeSheet = (sites) => {
      const sorted = [...sites].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      const rows = sorted.map((s) =>
        cols.map((c) => {
          if (c.key === "siteiq") return getSiteIQ(s).score;
          if (c.key === "dom") return s.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000)) : "";
          if (c.key === "approvedAt") return s.approvedAt ? new Date(s.approvedAt).toLocaleDateString() : "";
          return s[c.key] || "";
        })
      );
      const ws = XLSX.utils.aoa_to_sheet([cols.map((c) => c.header), ...rows]);
      ws["!cols"] = cols.map((c) => ({ wch: c.width }));
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: cols.length - 1 } }) };
      return ws;
    };
    const wb = XLSX.utils.book_new();
    const allSorted = [
      ...sw.map((s) => ({ ...s, _region: "Daniel Wollent" })),
      ...east.map((s) => ({ ...s, _region: "Matthew Toussaint" })),
    ].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const summCols = [{ key: "_region", header: "Region", width: 18 }, ...cols];
    const summRows = allSorted.map((s) =>
      summCols.map((c) => {
        if (c.key === "siteiq") return getSiteIQ(s).score;
        if (c.key === "dom") return s.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000)) : "";
        if (c.key === "approvedAt") return s.approvedAt ? new Date(s.approvedAt).toLocaleDateString() : "";
        return s[c.key] || "";
      })
    );
    const summWs = XLSX.utils.aoa_to_sheet([summCols.map((c) => c.header), ...summRows]);
    summWs["!cols"] = summCols.map((c) => ({ wch: c.width }));
    XLSX.utils.book_append_sheet(wb, summWs, "Full Pipeline");
    XLSX.utils.book_append_sheet(wb, makeSheet(sw), "Daniel Wollent");
    XLSX.utils.book_append_sheet(wb, makeSheet(east), "Matthew Toussaint");
    XLSX.writeFile(wb, `PS_Acquisition_Pipeline_${new Date().toISOString().slice(0, 10)}.xlsx`);
    notify("Exported!");
  };

  // âââ SORT âââ
  const SORT_OPTIONS = [
    { key: "siteiq", label: "SiteIQâ¢ (Best)" },
    { key: "name", label: "Name (AâZ)" },
    { key: "city", label: "City (AâZ)" },
    { key: "recent", label: "Recently Added" },
    { key: "dom", label: "Days on Market" },
    { key: "priority", label: "Priority" },
    { key: "phase", label: "Phase" },
  ];
  const priorityOrder = { "ð¥ Hot": 0, "ð¡ Warm": 1, "ðµ Cold": 2, "âª None": 3 };
  // Phase sort: pipeline flow order (Incoming â ... â Closed, Dead last)
  const phaseOrder = Object.fromEntries(PHASES.map((p, i) => [p, i]));
  const sortData = (arr) => {
    const sorted = [...arr];
    switch (sortBy) {
      case "siteiq": return sorted.sort((a, b) => getSiteIQ(b).score - getSiteIQ(a).score);
      case "city": return sorted.sort((a, b) => (a.city || "").localeCompare(b.city || ""));
      case "recent": return sorted.sort((a, b) => new Date(b.approvedAt || b.submittedAt || 0) - new Date(a.approvedAt || a.submittedAt || 0));
      case "dom": return sorted.sort((a, b) => { const da = a.dateOnMarket ? Date.now() - new Date(a.dateOnMarket).getTime() : 0; const db2 = b.dateOnMarket ? Date.now() - new Date(b.dateOnMarket).getTime() : 0; return db2 - da; });
      case "priority": return sorted.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));
      case "phase": return sorted.sort((a, b) => (phaseOrder[a.phase] ?? 9) - (phaseOrder[b.phase] ?? 9));
      default: return sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
  };

  // âââ MEMOIZED SiteIQ CACHE âââ
  // Computes SiteIQ once per site when data changes. Eliminates ~188 redundant calls per render.
  const siteIQCache = useMemo(() => {
    const cache = new Map();
    [...sw, ...east].forEach((s) => { if (s && s.id) cache.set(s.id, computeSiteIQ(s, targetMarkets)); });
    return cache;
  }, [sw, east]);

  if (authLoading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#F1F5F9", fontFamily: "\'DM Sans\'" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 40, height: 40, border: "4px solid #E2E8F0", borderTopColor: "#F37C33", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
        <div style={{ color: "#64748B", fontSize: 14 }}>Authenticating...</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!user) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "linear-gradient(135deg, #0F172A, #1E293B)", fontFamily: "\'DM Sans\', sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "40px 36px", width: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#F37C33", letterSpacing: "-0.02em" }}>PS Tracker</div>
          <div style={{ fontSize: 13, color: "#94A3B8", marginTop: 4 }}>DJR Real Estate â Acquisition Pipeline</div>
        </div>
        {loginError && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#DC2626" }}>{loginError}</div>}
        <input value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="Email" type="email" style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 14, marginBottom: 10, boxSizing: "border-box", fontFamily: "\'DM Sans\'" }} onKeyDown={e => e.key === "Enter" && handleLogin()} />
        <input value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="Password" type="password" style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 14, marginBottom: 16, boxSizing: "border-box", fontFamily: "\'DM Sans\'" }} onKeyDown={e => e.key === "Enter" && handleLogin()} />
        <button onClick={handleLogin} style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #F37C33, #E8650A)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "\'DM Sans\'" }}>Sign In</button>
      </div>
    </div>
  );

  const getSiteIQ = (site) => siteIQCache.get(site.id) || computeSiteIQ(site, targetMarkets);

  const SortBar = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>Sort:</span>
      {SORT_OPTIONS.map((o) => (
        <button key={o.key} onClick={() => setSortBy(o.key)} style={{ padding: "4px 10px", borderRadius: 6, border: sortBy === o.key ? "1px solid #F37C33" : "1px solid #E2E8F0", background: sortBy === o.key ? "#FFF3E0" : "#fff", color: sortBy === o.key ? "#E65100" : "#64748B", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans'", transition: "all 0.15s" }}>{o.label}</button>
      ))}
    </div>
  );

  // âââ STYLES âââ
  const inp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: "#fff", color: "#2C2C2C", outline: "none", boxSizing: "border-box" };
  const navBtn = (key) => ({ padding: "10px 16px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s", background: tab === key ? "#2C2C2C" : "transparent", color: tab === key ? "#F37C33" : "#64748B", whiteSpace: "nowrap" });
  const pendingN = subs.filter((s) => s.status === "pending").length;

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#F1F5F9", fontFamily: "'DM Sans'" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 40, height: 40, border: "4px solid #E2E8F0", borderTopColor: "#F37C33", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
        <div style={{ color: "#64748B", fontSize: 14 }}>Loadingâ¦</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // âââ TRACKER CARDS âââ
  const TrackerCards = ({ regionKey }) => {
    const region = REGIONS[regionKey];
    const data = sortData(regionKey === "east" ? east : sw);
    const [focusedIdx, setFocusedIdx] = useState(-1);
    const listRef = useRef(null);

    // Keyboard navigation: arrows move between cards, Enter/Space toggle expand
    useEffect(() => {
      const container = listRef.current;
      if (!container || data.length === 0) return;
      const handleKey = (e) => {
        if (!container.contains(document.activeElement) && document.activeElement !== container) return;
        const idx = focusedIdx;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          const next = Math.min(idx + 1, data.length - 1);
          setFocusedIdx(next);
          const el = document.getElementById("site-" + data[next].id);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          const prev = Math.max(idx - 1, 0);
          setFocusedIdx(prev);
          const el = document.getElementById("site-" + data[prev].id);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (idx >= 0 && idx < data.length) {
            const siteId = data[idx].id;
            setExpandedSite(expandedSite === siteId ? null : siteId);
          }
        } else if (e.key === "ArrowRight") {
          const expandedCard = container.querySelector(".card-expand");
          if (expandedCard) { expandedCard.scrollLeft += 120; e.preventDefault(); }
        } else if (e.key === "ArrowLeft") {
          const expandedCard = container.querySelector(".card-expand");
          if (expandedCard) { expandedCard.scrollLeft -= 120; e.preventDefault(); }
        }
      };
      window.addEventListener("keydown", handleKey);
      return () => window.removeEventListener("keydown", handleKey);
    }, [focusedIdx, data, expandedSite]);

    useEffect(() => { setFocusedIdx(-1); }, [sortBy]);


    return (
      <div ref={listRef} tabIndex={0} style={{ animation: "fadeIn 0.3s ease-out", outline: "none" }}
           onFocus={() => { if (focusedIdx < 0 && data.length > 0) setFocusedIdx(0); }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", background: region.accent }} />
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: region.color }}>{region.label} â Master Tracker</h2>
          <span style={{ fontSize: 13, color: "#94A3B8" }}>({data.length})</span>
            <span style={{ fontSize: 10, color: "#CBD5E1", marginLeft: "auto" }}>â¨ ââ navigate Â· Enter toggle Â· ââ scroll</span>
        </div>
        <SortBar />
        {data.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 14, padding: 40, textAlign: "center", color: "#94A3B8" }}>No sites yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {data.map((site) => {
              const isOpen = expandedSite === site.id;
              const msgs = site.messages ? Object.values(site.messages) : [];
              const docs = site.docs ? Object.entries(site.docs) : [];
              const logs = site.activityLog ? Object.values(site.activityLog) : [];
              const mi = msgInputs[site.id] || { from: "Dan R", text: "" };
              const dom = site.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;
              const siteIdx = data.indexOf(site);
              const isFocused = siteIdx === focusedIdx;

              return (
                <div key={site.id} id={`site-${site.id}`} className={`site-card${isOpen ? " site-card-open" : ""}`} style={{ ...STYLES.cardBase, borderLeft: `4px solid ${isOpen ? "#F37C33" : (PRIORITY_COLORS[site.priority] || region.accent)}`, ...(isOpen ? { boxShadow: "0 8px 32px rgba(243,124,51,0.15), 0 0 0 2px rgba(243,124,51,0.2)", transform: "scale(1.005)", background: "#FFFCFA" } : {}) , outline: isFocused ? "2px solid #F37C33" : "none", outlineOffset: isFocused ? "1px" : 0, transition: "outline 0.15s ease"}}>
                  {/* Collapsed header */}
                  <div onClick={() => { setFocusedIdx(siteIdx); const next = isOpen ? null : site.id; setExpandedSite(next); setDetailTab('overview'); if (next) setTimeout(() => { const el = document.getElementById(`site-${site.id}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); }} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: "#2C2C2C" }}>{site.name}</span>
                        <SiteIQBadge site={site} size="small" iq={getSiteIQ(site)} targetMarkets={targetMarkets} />
                        <PriorityBadge priority={site.priority} />
                        <select value={site.phase || "Prospect"} onClick={(e) => e.stopPropagation()} onChange={(e) => updateSiteField(regionKey, site.id, "phase", e.target.value)} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#475569", cursor: "pointer" }}>
                          {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div style={{ fontSize: 12, color: "#64748B" }}>{site.address}{site.city ? `, ${site.city}` : ""}{site.state ? `, ${site.state}` : ""}</div>
                      <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 11, color: "#94A3B8", flexWrap: "wrap" }}>
                        {site.askingPrice && <span>Ask: <strong style={{ color: "#2C2C2C" }}>{site.askingPrice}</strong></span>}
                        {site.internalPrice && <span>PS: <strong style={{ color: "#F37C33" }}>{site.internalPrice}</strong></span>}
                        {site.sellerBroker && <span>Broker: <strong style={{ color: "#475569" }}>{site.sellerBroker}</strong></span>}
                        {docs.length > 0 && <span style={{ color: "#64748B" }}>ð {docs.length} doc{docs.length !== 1 ? "s" : ""}</span>}
                        {msgs.length > 0 && <span style={{ color: "#F37C33" }}>ð¬ {msgs.length}</span>}
                        {site.coordinates && <span>ð</span>}
                        {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#E65100", textDecoration: "none", fontWeight: 600 }}>ð Listing</a>}
                      </div>
                    </div>
                    <div style={{ fontSize: 16, color: "#CBD5E1", transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>â¼</div>
                  </div>

                  {/* Expanded */}
                  {isOpen && (
                    <div className="card-expand" style={{ padding: "0 18px 18px", borderTop: "2px solid #F37C33" , overflowX: "auto", scrollBehavior: "smooth"}}>
                      {/* Nav Strip */}
                      {(() => {
                        const sites = sortData(regionKey === "east" ? east : sw);
                        const ids = sites.map(s => s.id);
                        const curIdx = ids.indexOf(site.id);
                        const prevId = curIdx > 0 ? ids[curIdx - 1] : null;
                        const nextId = curIdx < ids.length - 1 ? ids[curIdx + 1] : null;
                        const navBtnStyle = (disabled) => ({ padding: "5px 12px", borderRadius: 7, border: "1px solid #E2E8F0", background: disabled ? "#F8FAFC" : "#fff", color: disabled ? "#CBD5E1" : "#475569", fontSize: 11, fontWeight: 600, cursor: disabled ? "default" : "pointer", transition: "all .15s", display: "flex", alignItems: "center", gap: 4 });
                        return (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0 8px", borderBottom: "1px solid #F1F5F9", marginBottom: 10 }}>
                            <button disabled={!prevId} onClick={() => { if (prevId) { setExpandedSite(prevId); setDetailTab('overview'); setTimeout(() => { const el = document.getElementById(`site-${prevId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); } }} style={navBtnStyle(!prevId)}>{"â² Prev"}</button>
                            <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 500, letterSpacing: "0.02em" }}>
                              <span style={{ fontWeight: 700, color: "#475569" }}>{curIdx + 1}</span> of {ids.length} Â· <span style={{ color: "#CBD5E1" }}>ââ keys Â· Esc close</span>
                            </div>
                            <button disabled={!nextId} onClick={() => { if (nextId) { setExpandedSite(nextId); setDetailTab('overview'); setTimeout(() => { const el = document.getElementById(`site-${nextId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); } }} style={navBtnStyle(!nextId)}>{"Next â¼"}</button>
                          </div>
                        );
                      })()}

                      {/* Executive Property Header */}
                      <div style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #1E3A5F 100%)", borderRadius: 12, padding: "14px 18px", margin: "0 0 12px", overflow: "hidden" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                              <SiteIQBadge site={site} iq={getSiteIQ(site)} targetMarkets={targetMarkets} />
                              {site.market && <span style={{ background: "rgba(251,191,36,.12)", color: "#FBBF24", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(251,191,36,.2)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{site.market}</span>}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 6 }}>
                              {[
                                { label: "ASKING", val: fmtPrice(site.askingPrice), color: "#F1F5F9" },
                                { label: "ZONING", val: site.zoning || "â", color: site.zoning ? (/by.?right|permitted|allowed/i.test(site.summary || "") ? "#22C55E" : /SUP|conditional|special/i.test(site.zoning || "") ? "#FBBF24" : "#F1F5F9") : "#94A3B8" },
                                { label: "ACREAGE", val: site.acreage ? site.acreage + " ac" : "â", color: "#F1F5F9" },
                                { label: "3MI POP", val: site.pop3mi ? fmtN(site.pop3mi) : "â", color: "#F1F5F9" },
                                { label: "3MI HHI", val: site.income3mi || "â", color: "#F1F5F9" },
                              ].map((m, idx) => (
                                <div key={idx} style={{ background: "rgba(255,255,255,.06)", borderRadius: 8, padding: "6px 8px", border: "1px solid rgba(255,255,255,.08)" }}>
                                  <div style={{ fontSize: 8, fontWeight: 700, color: "#64748B", letterSpacing: "0.08em", marginBottom: 2 }}>{m.label}</div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: m.color, fontFamily: "'DM Sans', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.val}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                {/* Property Detail Tabs */}
                <div style={{ display: 'flex', gap: 0, margin: '16px 0 8px', borderBottom: '2px solid rgba(255,255,255,0.08)' }}>
                  {['overview', 'details', 'documents', 'activity'].map(tab => (
                    <button key={tab} onClick={(e) => { e.stopPropagation(); setDetailTab(tab); }}
                      style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, border: 'none', cursor: 'pointer', borderRadius: '8px 8px 0 0', transition: 'all 0.2s',
                        background: detailTab === tab ? 'linear-gradient(135deg, #1E293B, #334155)' : 'transparent',
                        color: detailTab === tab ? '#F97316' : '#94A3B8',
                        borderBottom: detailTab === tab ? '2px solid #F97316' : '2px solid transparent',
                        marginBottom: '-2px'
                      }}>
                      {tab === 'overview' ? 'ð Overview' : tab === 'details' ? 'ð§ Details' : tab === 'documents' ? 'ð Documents' : 'ð¬ Activity'}
                    </button>
                  ))}
                </div>

                {detailTab === 'overview' && (<>
                      {/* Aerial / Satellite View */}
                      <div style={{ margin: "14px 0 10px" }}>
                        {site.coordinates ? (
                          <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "1px solid #E2E8F0" }}>
                            <iframe
                              title={`Aerial â ${site.name}`}
                              src={`https://maps.google.com/maps?q=${encodeURIComponent(site.coordinates)}&t=k&z=17&output=embed`}
                              style={{ width: "100%", height: 220, border: "none" }}
                              loading="lazy"
                              allowFullScreen
                            />
                            <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, letterSpacing: "0.04em" }}>AERIAL VIEW</div>
                          </div>
                        ) : (
                          <div style={{ background: "#F1F5F9", borderRadius: 10, padding: "24px 14px", textAlign: "center", border: "1px dashed #CBD5E1" }}>
                            <div style={{ fontSize: 18, marginBottom: 4 }}>ð°ï¸</div>
                            <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>Add coordinates to generate aerial view</div>
                          </div>
                        )}
                        {/* Flyer Quick Link */}
                        {(() => {
                          const flyerDoc = docs.find(([, d]) => d.type === "Flyer");
                          return flyerDoc ? (
                            <a href={flyerDoc[1].url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, padding: "6px 14px", borderRadius: 8, background: "linear-gradient(135deg,#F37C33,#E8650A)", color: "#fff", fontSize: 12, fontWeight: 700, textDecoration: "none", boxShadow: "0 2px 6px rgba(243,124,51,0.25)" }}>ð View Flyer â {flyerDoc[1].name?.length > 30 ? flyerDoc[1].name.slice(0, 30) + "â¦" : flyerDoc[1].name}</a>
                          ) : (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, padding: "5px 12px", borderRadius: 7, background: "#FFF3E0", border: "1px dashed #F37C33", fontSize: 11, color: "#E65100", fontWeight: 600 }}>
                              ð No flyer uploaded â add one below
                            </div>
                          );
                        })()}
                      </div>

                      {/* Summary */}
                      <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 14, margin: "14px 0", border: "1px solid #E2E8F0" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 6 }}>Recent Summary</div>
                        <EF multi label="" value={site.summary || ""} onSave={(v) => saveField(regionKey, site.id, "summary", v)} placeholder="Deal notes, updatesâ¦" />
                      </div>

                </>)}
                {detailTab === 'details' && (<>
                      {/* Fields grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
                        <EF label="Market" value={site.market || ""} onSave={(v) => saveField(regionKey, site.id, "market", v)} placeholder="DFW, Houstonâ¦" />
                        <EF label="Asking Price" value={site.askingPrice || ""} onSave={(v) => saveField(regionKey, site.id, "askingPrice", v)} placeholder="$1.5M" />
                        <EF label="PS Internal Price" value={site.internalPrice || ""} onSave={(v) => saveField(regionKey, site.id, "internalPrice", v)} placeholder="$1.2M" />
                        <EF label="Seller / Broker" value={site.sellerBroker || ""} onSave={(v) => saveField(regionKey, site.id, "sellerBroker", v)} placeholder="John Smith" />
                        <EF label="3-Mile Income" value={site.income3mi || ""} onSave={(v) => saveField(regionKey, site.id, "income3mi", v)} placeholder="$95,000" />
                        <EF label="3-Mile Pop" value={site.pop3mi || ""} onSave={(v) => saveField(regionKey, site.id, "pop3mi", v)} placeholder="45,000" />
                        <EF label="Acreage" value={site.acreage || ""} onSave={(v) => saveField(regionKey, site.id, "acreage", v)} placeholder="4.5 ac" />
                        <EF label="Zoning" value={site.zoning || ""} onSave={(v) => saveField(regionKey, site.id, "zoning", v)} placeholder="C-2, B3â¦" />
                      </div>

                      {/* ESRI Demographic Report */}
                      {demoReport[site.id] && (() => {
                        const dr = demoReport[site.id];
                        const r = dr.rings || {};
                        const fmtV = (v, prefix) => v != null ? (prefix || "") + v.toLocaleString() : "â";
                        const growthColor = (s) => !s ? "#64748B" : s.includes("+") ? "#16A34A" : s.includes("-") ? "#EF4444" : "#64748B";
                        const hdrCell = { padding: "8px 12px", textAlign: "right", fontSize: 10, fontWeight: 800, color: "#CBD5E1", textTransform: "uppercase", letterSpacing: "0.06em" };
                        const metricCell = { padding: "7px 12px", fontWeight: 700, color: "#E2E8F0", fontSize: 11, borderBottom: "1px solid rgba(255,255,255,.08)" };
                        const valCell = { padding: "7px 12px", textAlign: "right", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', monospace", borderBottom: "1px solid rgba(255,255,255,.08)" };
                        const goldVal = { ...valCell, color: "#FBBF24" };
                        const whiteVal = { ...valCell, color: "#F1F5F9" };
                        return (
                          <div style={{ borderRadius: 14, marginBottom: 14, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,.15)" }}>
                            <div style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E3A5F 50%,#1565C0 100%)", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 16 }}>ð</span>
                                <div>
                                  <div style={{ color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6 }}>DEMOGRAPHIC INTELLIGENCE <span style={{ background: "linear-gradient(135deg,#FBBF24,#F59E0B)", color: "#0F172A", fontSize: 11, fontWeight: 900, padding: "2px 8px", borderRadius: 5, letterSpacing: "0.06em" }}>2025</span></div>
                                  <div style={{ color: "#94A3B8", fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", marginTop: 2 }}>ESRI ArcGIS GeoEnrichment â <span style={{ color: "#22D3EE" }}>Live Geocoded</span> â Current Year + 2030 Projections</div>
                                </div>
                              </div>
                              <button onClick={() => setDemoReport((prev) => { const n = { ...prev }; delete n[site.id]; return n; })} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.05)", color: "#94A3B8", fontSize: 11, cursor: "pointer", transition: "all .2s" }}>â</button>
                            </div>
                            {/* Ring Radius Table */}
                            <div style={{ background: "linear-gradient(180deg,#1E293B,#0F172A)", padding: "2px 16px 10px" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                  <tr>
                                    <th style={{ ...hdrCell, textAlign: "left", width: "30%" }}></th>
                                    <th style={hdrCell}>1-MILE</th>
                                    <th style={{ ...hdrCell, background: "rgba(251,191,36,.08)", borderRadius: "8px 8px 0 0" }}>3-MILE</th>
                                    <th style={hdrCell}>5-MILE</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <td style={metricCell}>Population</td>
                                    <td style={whiteVal}>{fmtV(r[1]?.pop)}</td>
                                    <td style={{ ...goldVal, background: "rgba(251,191,36,.06)" }}>{fmtV(r[3]?.pop)}</td>
                                    <td style={whiteVal}>{fmtV(r[5]?.pop)}</td>
                                  </tr>
                                  <tr>
                                    <td style={metricCell}>Median HHI</td>
                                    <td style={whiteVal}>{fmtV(r[1]?.medIncome, "$")}</td>
                                    <td style={{ ...goldVal, background: "rgba(251,191,36,.06)" }}>{fmtV(r[3]?.medIncome, "$")}</td>
                                    <td style={whiteVal}>{fmtV(r[5]?.medIncome, "$")}</td>
                                  </tr>
                                  <tr>
                                    <td style={metricCell}>Households</td>
                                    <td style={whiteVal}>{fmtV(r[1]?.hh)}</td>
                                    <td style={{ ...goldVal, background: "rgba(251,191,36,.06)" }}>{fmtV(r[3]?.hh)}</td>
                                    <td style={whiteVal}>{fmtV(r[5]?.hh)}</td>
                                  </tr>
                                  <tr>
                                    <td style={metricCell}>Median Home Value</td>
                                    <td style={whiteVal}>{fmtV(r[1]?.homeValue, "$")}</td>
                                    <td style={{ ...goldVal, background: "rgba(251,191,36,.06)" }}>{fmtV(r[3]?.homeValue, "$")}</td>
                                    <td style={whiteVal}>{fmtV(r[5]?.homeValue, "$")}</td>
                                  </tr>
                                  <tr>
                                    <td style={metricCell}>Renter %</td>
                                    <td style={whiteVal}>{r[1]?.renterPct || "â"}</td>
                                    <td style={{ ...goldVal, background: "rgba(251,191,36,.06)" }}>{r[3]?.renterPct || "â"}</td>
                                    <td style={whiteVal}>{r[5]?.renterPct || "â"}</td>
                                  </tr>
                                  <tr>
                                    <td style={{ ...metricCell, borderBottom: "none" }}>Pop Growth (CAGR)</td>
                                    <td style={{ ...whiteVal, borderBottom: "none", color: growthColor(r[1]?.popGrowth) }}>{r[1]?.popGrowth || "â"}</td>
                                    <td style={{ ...goldVal, background: "rgba(251,191,36,.06)", borderBottom: "none", color: growthColor(r[3]?.popGrowth) }}>{r[3]?.popGrowth || "â"}</td>
                                    <td style={{ ...whiteVal, borderBottom: "none", color: growthColor(r[5]?.popGrowth) }}>{r[5]?.popGrowth || "â"}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                            {/* 2030 Projections Strip */}
                            {(dr.pop3mi_fy || dr.income3mi_fy) && (
                              <div style={{ background: "linear-gradient(135deg,#0F172A,#1a1a2e)", padding: "10px 16px", borderTop: "1px solid rgba(251,191,36,.15)" }}>
                                <div style={{ fontSize: 9, fontWeight: 800, color: "#FBBF24", letterSpacing: "0.1em", marginBottom: 6 }}>2030 FIVE-YEAR PROJECTIONS (3-MILE)</div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                                  {[
                                    { label: "Population", val: dr.pop3mi_fy, growth: dr.popGrowth3mi },
                                    { label: "Median HHI", val: dr.income3mi_fy, growth: dr.incomeGrowth3mi },
                                    { label: "Households", val: dr.households3mi_fy, growth: dr.hhGrowth3mi },
                                    { label: "Outlook", val: dr.growthOutlook, isOutlook: true },
                                  ].map((item, idx) => (
                                    <div key={idx} style={{ background: "rgba(255,255,255,.04)", borderRadius: 8, padding: "6px 8px", textAlign: "center", border: "1px solid rgba(255,255,255,.06)" }}>
                                      <div style={{ fontSize: 8, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{item.label}</div>
                                      {item.isOutlook ? (
                                        <div style={{ fontSize: 11, fontWeight: 800, color: item.val?.includes("High") || item.val?.includes("Growing") ? "#22C55E" : item.val?.includes("Declining") ? "#EF4444" : "#FBBF24" }}>{item.val || "â"}</div>
                                      ) : (
                                        <>
                                          <div style={{ fontSize: 12, fontWeight: 700, color: "#F1F5F9", fontFamily: "'DM Sans', monospace" }}>{item.val || "â"}</div>
                                          {item.growth && <div style={{ fontSize: 9, fontWeight: 700, color: growthColor(item.growth), marginTop: 1 }}>{item.growth} /yr</div>}
                                        </>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Footer */}
                            <div style={{ background: "#0F172A", padding: "6px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 8, color: "#475569", letterSpacing: "0.04em" }}>ESRI ArcGIS GeoEnrichment (paid)</span>
                              <span style={{ fontSize: 8, color: "#475569" }}>{dr.pulledAt ? `Updated ${new Date(dr.pulledAt).toLocaleDateString()}` : ""}</span>
                            </div>
                          </div>
                        );
                      })()}

{/* Date on Market */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Date on Market</div>
                          <input type="date" value={site.dateOnMarket || ""} onChange={(e) => updateSiteField(regionKey, site.id, "dateOnMarket", e.target.value)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 13, fontFamily: "'DM Sans'", background: "#FAFBFC", color: "#2C2C2C", outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Days on Market</div>
                          <div style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 13, background: "#F8FAFC", color: dom !== null ? "#2C2C2C" : "#CBD5E1", fontWeight: dom !== null ? 700 : 400 }}>{dom !== null ? `${dom} days` : "â"}</div>
                        </div>
                      </div>

                      {/* Coordinates */}
                      <div style={{ marginBottom: 12 }}>
                        <EF label="Coordinates (lat, lng)" value={site.coordinates || ""} onSave={(v) => saveField(regionKey, site.id, "coordinates", v)} placeholder="39.123, -84.456" />
                        {site.coordinates && (
                          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                            <a href={mapsLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "4px 10px", borderRadius: 6, background: "#E8F0FE", color: "#1565C0", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>ðº Google Maps</a>
                            <a href={earthLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "4px 10px", borderRadius: 6, background: "#E8F5E9", color: "#2E7D32", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>ð Google Earth</a>
                    {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : "https://" + site.listingUrl} target="_blank" rel="noopener noreferrer" style={{ padding: "4px 10px", borderRadius: 6, background: "#FFF3E0", color: "#E65100", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>ð Property Listing</a>}
                    <button onClick={() => downloadVettingPDF(site)} style={{ padding: "4px 10px", borderRadius: 6, background: "#EDE7F6", color: "#5E35B1", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer" }}>ð Vetting Report</button>
                          </div>
                        )}
                      </div>

                </>)}
                {detailTab === 'documents' && (<>
                      {/* Listing URL */}
                <div style={{ marginBottom: 14 }}>
                  <EF label="Listing URL" value={site.listingUrl || ""} onSave={(v) => saveField(regionKey, site.id, "listingUrl", v)} placeholder="Paste listing URL here" />
                </div>

                      {/* Documents */}
                      <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 14, marginBottom: 14, border: "1px solid #E2E8F0" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 10 }}>ð Documents</div>
                        {docs.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                            {docs.map(([docKey, doc]) => (
                              <div key={docKey} style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8, padding: "5px 10px", fontSize: 11 }}>
                                <span style={{ fontWeight: 600, color: "#475569" }}>{doc.type}: {doc.name?.length > 20 ? doc.name.slice(0, 20) + "â¦" : doc.name}</span>
                                <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ color: "#1565C0", fontWeight: 600, textDecoration: "none" }}>â View</a>
                                <button onClick={() => handleDocDelete(regionKey, site.id, docKey, doc)} style={{ border: "none", background: "none", color: "#EF4444", cursor: "pointer", fontSize: 12, padding: 0 }}>â</button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <select id={`doc-type-${site.id}`} defaultValue="Flyer" style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid #E2E8F0", fontSize: 12, background: "#fff", cursor: "pointer" }}>
                            {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
                          </select>
                          <label style={{ padding: "5px 12px", borderRadius: 7, background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            + Upload
                            <input type="file" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; const type = document.getElementById(`doc-type-${site.id}`)?.value || "Other"; if (f) handleDocUpload(regionKey, site.id, f, type); e.target.value = ""; }} />
                          </label>
                        </div>
                      </div>

                </>)}
                {detailTab === 'activity' && (<>
                      {/* Messages */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 8 }}>ð¬ Thread</div>
                        {msgs.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, maxHeight: 200, overflowY: "auto" }}>
                            {[...msgs].sort((a, b) => new Date(a.ts) - new Date(b.ts)).map((m, i) => {
                              const mc = MSG_COLORS[m.from] || { bg: "#F8FAFC", border: "#E2E8F0", text: "#475569" };
                              return (
                                <div key={i} style={{ background: mc.bg, border: `1px solid ${mc.border}`, borderRadius: 8, padding: "8px 10px" }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: mc.text, marginBottom: 2 }}>{m.from} Â· {m.ts ? new Date(m.ts).toLocaleDateString() : ""}</div>
                                  <div style={{ fontSize: 13, color: "#2C2C2C" }}>{m.text}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 6 }}>
                          <select value={mi.from} onChange={(e) => setMsgInputs({ ...msgInputs, [site.id]: { ...mi, from: e.target.value } })} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 11, background: "#fff", cursor: "pointer", minWidth: 130 }}>
                            <option>Dan R</option>
                            <option>Daniel Wollent</option>
                            <option>Matthew Toussaint</option>
                          </select>
                          <input value={mi.text} onChange={(e) => setMsgInputs({ ...msgInputs, [site.id]: { ...mi, text: e.target.value } })} onKeyDown={(e) => { if (e.key === "Enter") handleSendMsg(regionKey, site.id); }} placeholder="Add messageâ¦" style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 13, outline: "none", fontFamily: "'DM Sans'" }} />
                          <button onClick={() => handleSendMsg(regionKey, site.id)} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Send</button>
                        </div>
                      </div>

                      {/* Activity Log */}
                      {logs.length > 0 && (
                        <details style={{ marginBottom: 10 }}>
                          <summary style={{ fontSize: 11, color: "#94A3B8", cursor: "pointer", fontWeight: 600 }}>Activity Log ({logs.length})</summary>
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                            {[...logs].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 20).map((l, i) => (
                              <div key={i} style={{ fontSize: 11, color: "#94A3B8" }}>
                                <span style={{ color: "#64748B" }}>{l.ts ? new Date(l.ts).toLocaleDateString() : ""}</span> â {l.action}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                </>)}
                      {/* Remove */}
                      <button onClick={() => { if (window.confirm(`Remove "${site.name}"?`)) handleRemove(regionKey, site.id); }} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#991B1B", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans'" }}>ð Remove Site</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // âââ RENDER âââ
  return (
    <div style={{ minHeight: "100vh", background: "#F1F5F9", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideDown { from { max-height: 0; opacity: 0; } to { max-height: 2000px; opacity: 1; } }
        @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes siteiq-glow { 0% { box-shadow: 0 0 15px rgba(201,168,76,0.4), 0 0 30px rgba(201,168,76,0.15); } 100% { box-shadow: 0 0 25px rgba(201,168,76,0.6), 0 0 50px rgba(201,168,76,0.25); } }
        @keyframes siteiq-ring { 0% { opacity: 0.3; transform: scale(1); } 100% { opacity: 0.7; transform: scale(1.05); } }
        @keyframes toastSlide { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes pulseOnce { 0% { box-shadow: 0 0 0 0 rgba(243,124,51,0.4); } 70% { box-shadow: 0 0 0 10px rgba(243,124,51,0); } 100% { box-shadow: 0 0 0 0 rgba(243,124,51,0); } }
        @keyframes countUp { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
        * { box-sizing: border-box; }
        input, select, textarea, button { font-family: 'DM Sans', sans-serif; }
        /* Cosmetic: Card hover glow */
        .site-card { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .site-card:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(0,0,0,0.08) !important; }
        .site-card-open { transform: none !important; }
        .site-card-open:hover { transform: none !important; }
        /* Cosmetic: Smooth expand */
        .card-expand { animation: slideDown 0.3s ease-out; overflow: hidden; }
        /* Cosmetic: Nav button underline */
        .nav-active::after { content: ''; position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 60%; height: 2px; background: #F37C33; border-radius: 2px; }
        /* Cosmetic: Sort pill active glow */
        .sort-active { box-shadow: 0 0 0 2px rgba(243,124,51,0.2); }
        /* Code: Scrollbar styling */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #94A3B8; }
        /* Cosmetic: KPI card number animation */
        .kpi-number { animation: countUp 0.5s ease-out; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, background: "linear-gradient(135deg, #2C2C2C, #1a1a2e)", color: "#fff", padding: "10px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: "0 4px 24px rgba(0,0,0,0.25), 0 0 0 1px rgba(243,124,51,0.15)", animation: "toastSlide 0.3s ease-out", borderLeft: "3px solid #F37C33" }}>{toast}</div>
      )}

      {/* New site alert */}
      {showNewAlert && (
        <div style={{ background: "#FFF3E0", borderBottom: "1px solid #F37C33", padding: "8px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#E65100", fontWeight: 600 }}>ð {newSiteCount} new site{newSiteCount > 1 ? "s" : ""} pending review</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setTab("review"); setShowNewAlert(false); }} style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Review</button>
            <button onClick={() => setShowNewAlert(false)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#fff", color: "#94A3B8", fontSize: 11, cursor: "pointer" }}>â</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={STYLES.frostedHeader}>
        {/* PS Banner */}
        <div style={{ padding: "10px 0 6px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "#F37C33", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 18, fontWeight: 900, color: "#fff", fontFamily: "'Space Mono'" }}>PS</span>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: "0.02em", background: "linear-gradient(90deg, #fff 0%, #F37C33 40%, #fff 60%, #fff 100%)", backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "shimmer 3s linear infinite" }}>PUBLIC STORAGE</div>
                <div style={{ fontSize: 10, color: "#94A3B8", letterSpacing: "0.1em", textTransform: "uppercase" }}>Acquisition Pipeline Â· 2026</div>
                <div style={{ fontSize: 8, color: "#64748B", letterSpacing: "0.06em", marginTop: 1, opacity: 0.7 }}>Powered by DJR Real Estate LLC</div>
              </div>
            </div>
              <button onClick={() => setWeightEditorOpen(true)} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }} title="SiteIQ Weight Configuration">âï¸ SiteIQ Config</button>
            <button onClick={handleExport} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#F37C33", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans'" }}>â¬ Export Excel</button>
            <button onClick={() => signOut(auth)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #475569", background: "transparent", color: "#94A3B8", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans'" }} title={user?.email}>Sign Out</button>
          </div>
        </div>

        {/* Nav */}
        <div style={{ display: "flex", gap: 2, overflowX: "auto", padding: "4px 0", scrollbarWidth: "none" }}>
          {[
            { key: "dashboard", label: "Dashboard" },
            { key: "summary", label: "Summary" },
            { key: "southwest", label: "Daniel Wollent" },
            { key: "east", label: "Matthew Toussaint" },
            { key: "submit", label: "Submit Site" },
            { key: "review", label: pendingN > 0 ? `Review (${pendingN})` : "Review" },
          ].map((n) => (
            <button key={n.key} onClick={() => { setTab(n.key); if (n.key !== "review") setShowNewAlert(false); }} style={{ ...navBtn(n.key), position: "relative" }}
              onMouseEnter={(e) => { if (tab !== n.key) { e.currentTarget.style.color = "#F37C33"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
              onMouseLeave={(e) => { if (tab !== n.key) { e.currentTarget.style.color = "#64748B"; e.currentTarget.style.transform = "translateY(0)"; } }}
            >
              {n.label}
              {n.key === "review" && pendingN > 0 && <span style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: "50%", background: "#F37C33" }} />}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>

        {/* âââ DASHBOARD âââ */}
        {tab === "dashboard" && (
          <div style={{ animation: "fadeIn 0.3s ease-out" }}>
{/* Target Markets â Collapsible Strip */}
      <div style={{ maxWidth: 1100, margin: "0 auto 12px", background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.15)" }}>
        <div onClick={() => setMarketsOpen(!marketsOpen)} style={{ display: "flex", alignItems: "center", padding: "10px 18px", cursor: "pointer", userSelect: "none" }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "#F37C33", textTransform: "uppercase" }}>Target Markets</span>
          <span style={{ fontSize: 11, color: "#64748B", marginLeft: 10 }}>{targetMarkets.length} active</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {!marketsOpen && targetMarkets.slice(0, 5).map((m, i) => (
              <span key={i} style={{ fontSize: 10, color: "#94A3B8", background: "rgba(255,255,255,.06)", padding: "2px 8px", borderRadius: 20 }}>{m.name || m.city || "Market"}</span>
            ))}
            {!marketsOpen && targetMarkets.length > 5 && <span style={{ fontSize: 10, color: "#64748B" }}>+{targetMarkets.length - 5}</span>}
            <span style={{ color: "#64748B", fontSize: 14, transition: "transform 0.2s", transform: marketsOpen ? "rotate(180deg)" : "rotate(0deg)" }}>â¾</span>
          </span>
        </div>
        {marketsOpen && (
          <div style={{ padding: "0 18px 14px", animation: "fadeIn 0.2s ease-out" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {targetMarkets.map((m, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, padding: "6px 12px" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0" }}>{m.name || m.city || "Unnamed"}</span>
                  {m.state && <span style={{ fontSize: 10, color: "#64748B" }}>{m.state}</span>}
                  {m.radius && <span style={{ fontSize: 9, color: "#475569", background: "rgba(255,255,255,.06)", padding: "1px 6px", borderRadius: 10 }}>{m.radius}mi</span>}
                  <button onClick={() => setTargetMarkets(targetMarkets.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>Ã</button>
                </div>
              ))}
            </div>
            {showAddMarket ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <input value={newMarketForm.name || ""} onChange={(e) => setNewMarketForm({ ...newMarketForm, name: e.target.value })} placeholder="Market name" style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.06)", color: "#E2E8F0", fontSize: 11, width: 130, outline: "none" }} />
                <input value={newMarketForm.state || ""} onChange={(e) => setNewMarketForm({ ...newMarketForm, state: e.target.value })} placeholder="State" style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.06)", color: "#E2E8F0", fontSize: 11, width: 50, outline: "none" }} />
                <input value={newMarketForm.radius || ""} onChange={(e) => setNewMarketForm({ ...newMarketForm, radius: e.target.value })} placeholder="Radius" style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.06)", color: "#E2E8F0", fontSize: 11, width: 55, outline: "none" }} />
                <button onClick={() => { if (newMarketForm.name) { setTargetMarkets([...targetMarkets, { ...newMarketForm }]); setNewMarketForm({}); setShowAddMarket(false); } }} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#F37C33", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>â Add</button>
                <button onClick={() => { setShowAddMarket(false); setNewMarketForm({}); }} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,.1)", background: "transparent", color: "#64748B", fontSize: 10, cursor: "pointer" }}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setShowAddMarket(true)} style={{ padding: "4px 12px", borderRadius: 6, border: "1px dashed rgba(255,255,255,.15)", background: "transparent", color: "#64748B", fontSize: 10, cursor: "pointer" }}>+ Add Market</button>
            )}
          </div>
        )}
      </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Pipeline", value: sw.length + east.length, color: "#F37C33", icon: "ð", action: () => setTab("summary"), sub: "View summary â" },
                { label: "Pending", value: pendingN, color: "#F59E0B", icon: "â³", action: () => { setTab("review"); setShowNewAlert(false); }, sub: "Review queue â" },
                { label: "Daniel Wollent", value: sw.length, color: REGIONS.southwest.accent, icon: "ð·", action: () => { setTab("southwest"); setExpandedSite(null); }, sub: "Open tracker â" },
                { label: "Matthew Toussaint", value: east.length, color: REGIONS.east.accent, icon: "ð¢", action: () => { setTab("east"); setExpandedSite(null); }, sub: "Open tracker â" },
              ].map((kpi) => (
                <div key={kpi.label} onClick={kpi.action} style={STYLES.kpiCard(kpi.color)}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = `0 6px 20px ${kpi.color}22`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)"; }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>{kpi.label}</div>
                    <span style={{ fontSize: 16, opacity: 0.6 }}>{kpi.icon}</span>
                  </div>
                  <div className="kpi-number" style={{ fontSize: 34, fontWeight: 800, color: "#2C2C2C", marginTop: 6, fontFamily: "'Space Mono', monospace", letterSpacing: "-0.02em" }}>{kpi.value}</div>
                  <div style={{ fontSize: 10, color: kpi.color, marginTop: 4, fontWeight: 600 }}>{kpi.sub}</div>
                </div>
              ))}
            </div>

            {/* Velocity Stats + Last Updated */}
            {(() => {
              const all = [...sw, ...east];
              const now = Date.now();
              const week = 7 * 86400000;
              const addedThisWeek = all.filter(s => s.approvedAt && (now - new Date(s.approvedAt).getTime()) < week).length;
              const ucCount = all.filter(s => s.phase === "Under Contract" || s.phase === "Due Diligence").length;
              const loiCount = all.filter(s => s.phase === "LOI Sent" || s.phase === "LOI Signed").length;
              const greenCount = all.filter(s => getSiteIQ(s).score >= 7.5).length;
              return (
                <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 10, flex: 1, flexWrap: "wrap" }}>
                    {[
                      { label: "Added this week", value: addedThisWeek, color: "#3B82F6" },
                      { label: "Under Contract", value: ucCount, color: "#16A34A" },
                      { label: "LOI Active", value: loiCount, color: "#F59E0B" },
                      { label: "GREEN Sites", value: greenCount, color: "#22C55E" },
                    ].map(v => (
                      <div key={v.label} style={{ flex: "1 1 100px", background: "#fff", borderRadius: 10, padding: "8px 12px", border: `1px solid ${v.color}22`, textAlign: "center" }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: v.color, fontFamily: "'Space Mono', monospace" }}>{v.value}</div>
                        <div style={{ fontSize: 9, fontWeight: 600, color: "#94A3B8", textTransform: "uppercase" }}>{v.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: "#94A3B8", textAlign: "right", whiteSpace: "nowrap" }}>
                    Data as of {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}<br />
                    <span style={{ fontWeight: 600 }}>{all.length} active sites</span>
                  </div>
                </div>
              );
            })()}

            {/* âââ PIPELINE FUNNEL âââ */}
            {(() => {
              const all = [...sw, ...east];
              const pending = subs.filter(s => s.status === "pending").length;
              const funnelStages = [
                { label: "Review Queue", count: pending, color: "#F59E0B", icon: "â³" },
                { label: "Prospect", count: all.filter(s => s.phase === "Prospect" || s.phase === "Incoming" || s.phase === "Scored").length, color: "#3B82F6", icon: "ð" },
                { label: "Submitted to PS", count: all.filter(s => s.phase === "Submitted to PS" || s.phase === "PS Revisions").length, color: "#6366F1", icon: "ð¤" },
                { label: "PS Approved", count: all.filter(s => s.phase === "PS Approved").length, color: "#8B5CF6", icon: "â" },
                { label: "LOI", count: all.filter(s => s.phase === "LOI Sent" || s.phase === "LOI Signed").length, color: "#F37C33", icon: "ð" },
                { label: "Under Contract", count: all.filter(s => s.phase === "Under Contract" || s.phase === "Due Diligence").length, color: "#16A34A", icon: "ð¤" },
                { label: "Closed", count: all.filter(s => s.phase === "Closed").length, color: "#059669", icon: "ð" },
              ];
              const maxCount = Math.max(...funnelStages.map(s => s.count), 1);
              const declined = all.filter(s => s.phase === "PS Declined" || s.phase === "Dead").length;
              return (
                <div style={{ background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#2C2C2C" }}>Pipeline Funnel</h3>
                    {declined > 0 && <span style={{ fontSize: 11, color: "#DC2626", fontWeight: 600 }}>{declined} declined/dead</span>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                    {funnelStages.map((stage, idx) => {
                      const widthPct = stage.count > 0 ? Math.max(25, 30 + (1 - idx / (funnelStages.length - 1)) * 70) : 25;
                      return (
                        <div key={stage.label} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 90, fontSize: 10, fontWeight: 600, color: "#64748B", textAlign: "right", flexShrink: 0 }}>{stage.icon} {stage.label}</div>
                          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                            <div style={{
                              width: `${widthPct}%`,
                              background: stage.count > 0 ? `linear-gradient(135deg, ${stage.color}DD, ${stage.color}99)` : "#F1F5F9",
                              borderRadius: idx === 0 ? "10px 10px 6px 6px" : idx === funnelStages.length - 1 ? "6px 6px 10px 10px" : 6,
                              padding: "8px 12px",
                              display: "flex",
                              justifyContent: "center",
                              alignItems: "center",
                              transition: "all 0.4s ease",
                              minHeight: 28,
                            }}>
                              <span style={{ fontSize: stage.count > 0 ? 16 : 12, fontWeight: 800, color: stage.count > 0 ? "#fff" : "#CBD5E1", fontFamily: "'Space Mono', monospace" }}>
                                {stage.count}
                              </span>
                            </div>
                          </div>
                          <div style={{ width: 50, fontSize: 10, color: "#94A3B8", flexShrink: 0 }}>
                            {idx > 0 && funnelStages[idx - 1].count > 0 ? `${Math.round((stage.count / funnelStages[idx - 1].count) * 100) || 0}%` : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 10, color: "#94A3B8", textAlign: "center" }}>
                    Sites flow: Review Queue â Prospect â PS Submission â LOI â Under Contract â Closed
                  </div>
                </div>
              );
            })()}

            {[{ label: "Daniel Wollent", data: sw, color: REGIONS.southwest.color, accent: REGIONS.southwest.accent, tabKey: "southwest" }, { label: "Matthew Toussaint", data: east, color: REGIONS.east.color, accent: REGIONS.east.accent, tabKey: "east" }].map((r) => {
              const total = r.data.length || 1;
              const phaseColors = ["#CBD5E1", "#94A3B8", "#3B82F6", "#6366F1", "#16A34A", "#D97706", "#DC2626", "#8B5CF6", "#A855F7", "#F59E0B", "#F37C33", "#16A34A", "#64748B"];
              return (
                <div key={r.label} onClick={() => { setTab(r.tabKey); setExpandedSite(null); }} className="site-card" style={{ background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,.06)", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: r.color }}>{r.label} â 2026 Pipeline</h3>
                    <span style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600 }}>{r.data.length} sites</span>
                  </div>
                  {/* Visual pipeline bar */}
                  <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", marginBottom: 10, background: "#F1F5F9" }}>
                    {PHASES.map((p, idx) => {
                      const c = r.data.filter((s) => s.phase === p).length;
                      return c > 0 ? <div key={p} title={`${p}: ${c}`} style={{ width: `${(c / total) * 100}%`, background: phaseColors[idx] || r.accent, transition: "width 0.5s ease" }} /> : null;
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {PHASES.map((p, idx) => { const c = r.data.filter((s) => s.phase === p).length; return (
                      <div key={p} style={{ flex: "1 1 80px", textAlign: "center", padding: "10px 6px", borderRadius: 10, background: c > 0 ? `${phaseColors[idx]}11` : "#F8FAFC", border: c > 0 ? `1px solid ${phaseColors[idx]}33` : "1px solid #E2E8F0", transition: "all 0.2s" }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: c > 0 ? phaseColors[idx] : "#CBD5E1" }}>{c}</div>
                        <div style={{ fontSize: 9, fontWeight: 600, color: "#94A3B8", textTransform: "uppercase" }}>{p}</div>
                      </div>
                    ); })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* âââ SUMMARY âââ */}
        {tab === "summary" && (() => {
          const th = { padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase", borderBottom: "2px solid #E2E8F0", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#F8FAFC", zIndex: 1 };
          const td = { padding: "8px 10px", fontSize: 11, color: "#475569", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" };
          const tdW = { ...td, whiteSpace: "normal", maxWidth: 200, minWidth: 120 };
          const allStates = [...new Set([...sw, ...east].map(s => s.state).filter(Boolean))].sort();
          const SumTable = ({ rk }) => {
            const r = REGIONS[rk];
            const raw = sortData(rk === "east" ? east : sw);
            const d = raw.filter(s => (filterState === "all" || s.state === filterState) && (filterPhase === "all" || s.phase === filterPhase));
            return (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: r.accent }} />
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: r.color }}>{r.label}</h3>
                  <span style={{ fontSize: 12, color: "#94A3B8" }}>({d.length}{d.length !== raw.length ? ` of ${raw.length}` : ""})</span>
                </div>
                {d.length === 0 ? <div style={{ background: "#fff", borderRadius: 10, padding: 20, textAlign: "center", color: "#94A3B8" }}>No sites.</div> : (
                  <div style={{ overflow: "auto", borderRadius: 10, border: "1px solid #E2E8F0", maxHeight: 420 }}>
                    <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse", background: "#fff" }}>
                      <thead>
                        <tr>{["SiteIQ", "Name", "City", "ST", "Phase", "Ask", "Acres", "3mi Pop", "Broker", "DOM", "Added"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {d.map((s, i) => (
                          <tr key={s.id} onClick={() => { setTab(rk); setExpandedSite(s.id); setTimeout(() => { const el = document.getElementById(`site-${s.id}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 350); }} style={{ background: (() => { const t = getSiteIQ(s).tier; return t === "gold" ? "#FFFDF5" : t === "steel" ? "#F8F9FE" : i % 2 ? "#FAFBFC" : "#fff"; })(), cursor: "pointer", transition: "background 0.15s", borderLeft: (() => { const t = getSiteIQ(s).tier; return t === "gold" ? "3px solid #C9A84C" : t === "steel" ? "3px solid #2C3E6B" : "3px solid transparent"; })() }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#FFF3E0")}
                            onMouseLeave={(e) => { const t = getSiteIQ(s).tier; e.currentTarget.style.background = t === "gold" ? "#FFFDF5" : t === "steel" ? "#F8F9FE" : i % 2 ? "#FAFBFC" : "#fff"; }}
                          >
                            <td style={{ ...td, textAlign: "center" }}><SiteIQBadge site={s} size="small" iq={getSiteIQ(s)} targetMarkets={targetMarkets} /></td>
                            <td style={{ ...td, fontWeight: 600, color: "#2C2C2C" }}>{s.name}</td>
                            <td style={{ ...td, fontWeight: 600 }}>{s.city || "â"}</td>
                            <td style={td}>{s.state || "â"}</td>
                            <td style={{ ...td, fontSize: 11 }}><span style={{ padding: "2px 8px", borderRadius: 6, background: s.phase === "Under Contract" ? "#DCFCE7" : s.phase === "LOI Signed" ? "#FEF3C7" : s.phase === "LOI Sent" ? "#DBEAFE" : "#F1F5F9", color: s.phase === "Under Contract" ? "#166534" : s.phase === "LOI Signed" ? "#92400E" : s.phase === "LOI Sent" ? "#1E40AF" : "#64748B", fontWeight: 600 }}>{s.phase || "â"}</span></td>
                            <td style={{ ...td, fontWeight: 600 }} title={s.askingPrice || ""}>{fmtPrice(s.askingPrice)}</td>
                            <td style={td}>{s.acreage || "â"}</td>
                            <td style={td}>{s.pop3mi ? fmtN(s.pop3mi) : "â"}</td>
                            <td style={td}>{s.sellerBroker || "â"}</td>
                            <td style={{ ...td, textAlign: "center", fontSize: 12, color: s.dateOnMarket && s.dateOnMarket !== "N/A" ? (Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000) > 365 ? "#EF4444" : Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000) > 180 ? "#F59E0B" : "#22C55E") : "#94A3B8" }}>{s.dateOnMarket && s.dateOnMarket !== "N/A" ? Math.max(0, Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000)) + "d" : "â"}</td>
                            <td style={td}>{s.approvedAt ? new Date(s.approvedAt).toLocaleDateString() : "â"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          };
          return (
            <div style={{ animation: "fadeIn .3s ease-out" }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#2C2C2C" }}>ð Summary</h2>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#94A3B8" }}>All tracked sites by region. Click any row to open.</p>
              <SortBar />
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>Filter:</span>
                  <select value={filterState} onChange={(e) => setFilterState(e.target.value)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", color: "#475569", background: filterState !== "all" ? "#FFF7ED" : "#fff" }}>
                    <option value="all">All States</option>
                    {allStates.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <select value={filterPhase} onChange={(e) => setFilterPhase(e.target.value)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", color: "#475569", background: filterPhase !== "all" ? "#FFF7ED" : "#fff" }}>
                    <option value="all">All Phases</option>
                    {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {(filterState !== "all" || filterPhase !== "all") && <button onClick={() => { setFilterState("all"); setFilterPhase("all"); }} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#fff", color: "#94A3B8", cursor: "pointer" }}>â Clear</button>}
              </div>
              <SumTable rk="southwest" />
              <SumTable rk="east" />
            </div>
          );
        })()}

        {/* âââ SUBMIT âââ */}
        {tab === "submit" && (
          <div style={{ animation: "fadeIn .3s ease-out", maxWidth: 600 }}>
            <div style={{ background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700 }}>Submit Site</h2>
              <div style={{ display: "flex", gap: 6, marginBottom: 16, background: "#F1F5F9", borderRadius: 10, padding: 3 }}>
                {[["direct", "â¡ Direct to Tracker"], ["review", "ð Send to Review"]].map(([k, l]) => (
                  <button key={k} onClick={() => setSubmitMode(k)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans'", background: submitMode === k ? "#fff" : "transparent", color: submitMode === k ? "#2C2C2C" : "#94A3B8", boxShadow: submitMode === k ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}>{l}</button>
                ))}
              </div>
              {/* ââ Flyer Upload Zone ââ */}
              <div style={{ fontSize: 12, fontWeight: 700, color: "#2C2C2C", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>ð Flyer <span style={{ fontSize: 10, fontWeight: 500, color: "#94A3B8" }}>â auto-extracts acreage, price, zoning & broker</span></div>
              <div style={{ border: flyerFile ? "2px solid #F37C33" : "2px dashed #E2E8F0", borderRadius: 12, padding: flyerFile ? 14 : 20, textAlign: "center", background: flyerFile ? "#FFF8F3" : "#F8FAFC", marginBottom: 16, cursor: "pointer", transition: "all .2s" }} onClick={() => !flyerParsing && flyerRef.current?.click()} onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#F37C33"; }} onDragLeave={(e) => { e.currentTarget.style.borderColor = flyerFile ? "#F37C33" : "#E2E8F0"; }} onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = flyerFile ? "#F37C33" : "#E2E8F0"; const f = e.dataTransfer.files?.[0]; if (f) parseFlyer(f); }}>
                <input ref={flyerRef} type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFlyer(f); }} />
                {flyerParsing ? (
                  <div><div style={{ fontSize: 22, marginBottom: 4 }}>â³</div><div style={{ fontSize: 12, color: "#64748B", fontWeight: 600 }}>Extracting info from flyerâ¦</div></div>
                ) : flyerFile ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {flyerPreview && <img src={flyerPreview} alt="Flyer preview" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid #E2E8F0" }} />}
                    {!flyerPreview && <div style={{ width: 48, height: 48, borderRadius: 6, background: "#FFF3E0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>ð</div>}
                    <div style={{ textAlign: "left", flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#2C2C2C" }}>{flyerFile.name}</div>
                      <div style={{ fontSize: 11, color: "#64748B" }}>{(flyerFile.size / 1024).toFixed(0)} KB â fields auto-populated</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setFlyerFile(null); setFlyerPreview(null); if (flyerRef.current) flyerRef.current.value = ""; }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#fff", color: "#94A3B8", fontSize: 11, cursor: "pointer" }}>â</button>
                  </div>
                ) : (
                  <div><div style={{ fontSize: 22, marginBottom: 4 }}>ð</div><div style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Drop a flyer here or click to upload</div><div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>PDF or image â we'll extract acreage, price, zoning, broker & more</div></div>
                )}
              </div>
              {/* ââ Additional Attachments ââ */}
              <div style={{ marginBottom: 16, background: "#F8FAFC", borderRadius: 10, padding: 14, border: "1px solid #E2E8F0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#2C2C2C", display: "flex", alignItems: "center", gap: 6 }}>ð More Documents <span style={{ fontSize: 10, fontWeight: 500, color: "#94A3B8" }}>â survey, PSA, environmental, etc.</span></div>
                  <button onClick={() => attachRef.current?.click()} style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#2C2C2C", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ Add File</button>
                  <input ref={attachRef} type="file" accept=".pdf,image/*,.doc,.docx,.xlsx,.xls,.csv" multiple style={{ display: "none" }} onChange={(e) => { const files = Array.from(e.target.files || []); const newA = files.map((f) => ({ file: f, type: "Other", id: uid() })); setAttachments((prev) => [...prev, ...newA]); e.target.value = ""; }} />
                </div>
                {attachments.length > 0 && (
                  <div style={{ display: "grid", gap: 6 }}>
                    {attachments.map((a) => (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#FAFAFA" }}>
                        <div style={{ fontSize: 16 }}>{a.file.name.match(/\.pdf$/i) ? "ð" : a.file.type?.startsWith("image/") ? "ð¼ï¸" : "ð"}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#2C2C2C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.file.name}</div>
                          <div style={{ fontSize: 10, color: "#94A3B8" }}>{(a.file.size / 1024).toFixed(0)} KB</div>
                        </div>
                        <select value={a.type} onChange={(e) => setAttachments((prev) => prev.map((x) => x.id === a.id ? { ...x, type: e.target.value } : x))} style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #E2E8F0", fontSize: 11, background: "#fff", cursor: "pointer", color: "#475569" }}>
                          {DOC_TYPES.filter((t) => t !== "Flyer").map((t) => <option key={t}>{t}</option>)}
                        </select>
                        <button onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))} style={{ padding: "2px 6px", borderRadius: 4, border: "none", background: "transparent", color: "#94A3B8", fontSize: 14, cursor: "pointer", lineHeight: 1 }}>â</button>
                      </div>
                    ))}
                  </div>
                )}
                {attachments.length === 0 && <div style={{ fontSize: 11, color: "#CBD5E1" }}>Survey, demographics, PSA, environmental, etc.</div>}
              </div>
              {/* ââ Form Fields ââ */}
              <div style={{ display: "grid", gap: 12 }}>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>Name *</label><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Facility / site name" /></div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>Address *</label><input style={inp} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street address" /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>City *</label><input style={inp} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>State *</label><input style={inp} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>Acreage</label><input style={inp} value={form.acreage} onChange={(e) => setForm({ ...form, acreage: e.target.value })} placeholder="e.g. 3.5" /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>Asking Price</label><input style={inp} value={form.askingPrice} onChange={(e) => setForm({ ...form, askingPrice: e.target.value })} placeholder="e.g. $1,200,000" /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>Zoning</label><input style={inp} value={form.zoning} onChange={(e) => setForm({ ...form, zoning: e.target.value })} placeholder="e.g. C-2, Commercial" /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>Seller / Broker</label><input style={inp} value={form.sellerBroker} onChange={(e) => setForm({ ...form, sellerBroker: e.target.value })} placeholder="Broker name" /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>Coordinates</label><input style={inp} value={form.coordinates} onChange={(e) => setForm({ ...form, coordinates: e.target.value })} placeholder="lat, lng" /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>Listing URL</label><input style={inp} value={form.listingUrl} onChange={(e) => setForm({ ...form, listingUrl: e.target.value })} placeholder="Crexi / LoopNet link" /></div>
                </div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>Region *</label><select style={{ ...inp, cursor: "pointer" }} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}><option value="southwest">Daniel Wollent</option><option value="east">Matthew Toussaint</option></select></div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>Notes</label><textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any additional notesâ¦" /></div>
                <button onClick={handleSubmit} style={{ padding: "12px 20px", borderRadius: 10, border: "none", cursor: "pointer", background: submitMode === "direct" ? "linear-gradient(135deg,#F37C33,#E8650A)" : "linear-gradient(135deg,#2C2C2C,#3D3D3D)", color: "#fff", fontSize: 14, fontWeight: 700 }}>
                  {submitMode === "direct" ? "â¡ Add Now" : "ð Submit for Review"}
                </button>
              </div>
              {shareLink && (
                <div style={{ background: "#FFF3E0", border: "1px solid #F37C33", borderRadius: 10, padding: 14, marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#E65100", marginBottom: 6 }}>â Submitted! Share this review link:</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input readOnly value={`${window.location.origin}${window.location.pathname}?review=${shareLink}`} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12, background: "#fff", outline: "none" }} onClick={(e) => e.target.select()} />
                    <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?review=${shareLink}`); notify("Copied!"); }} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>ð Copy</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* âââ REVIEW âââ */}
        {tab === "review" && (
          <div style={{ animation: "fadeIn .3s ease-out" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 6 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Review Queue</h2>
              <div style={{ display: "flex", gap: 6 }}>
                {pendingN > 0 && <button onClick={handleApproveAll} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>â Approve All ({pendingN})</button>}
                {subs.some((s) => s.status === "declined") && <button onClick={handleClearDeclined} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#991B1B", fontSize: 11, cursor: "pointer" }}>Clear Declined</button>}
              </div>
            </div>
            <SortBar />
            {subs.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 14, padding: "40px 30px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>ð</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#475569", marginBottom: 6 }}>Review Queue Empty</div>
                <div style={{ fontSize: 12, color: "#94A3B8", maxWidth: 380, margin: "0 auto", lineHeight: 1.5 }}>Sites submitted via the "Submit Site" tab appear here for review and approval before being added to a tracker. Use <strong>Submit Site â Send to Review</strong> to queue a new site.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {sortData(subs).map((site) => {
                  const ri = reviewInputs[site.id] || { reviewer: "", note: "" };
                  const setRI = (f, v) => setReviewInputs({ ...reviewInputs, [site.id]: { ...ri, [f]: v } });
                  const isHL = highlightedSite === site.id;
                  return (
                    <div key={site.id} id={`review-${site.id}`} style={{ background: isHL ? "#FFF3E0" : "#fff", borderRadius: 12, padding: 16, boxShadow: isHL ? "0 0 0 2px #F37C33" : "0 1px 3px rgba(0,0,0,.06)", opacity: site.status === "declined" ? 0.5 : 1, borderLeft: `4px solid ${REGIONS[site.region]?.accent || "#94A3B8"}`, transition: "all 0.3s" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 700 }}>{site.name}</span>
                        <Badge status={site.status} />
                        {site.status === "pending" && <button onClick={() => { const url = `${window.location.origin}${window.location.pathname}?review=${site.id}`; navigator.clipboard.writeText(url); notify("Link copied!"); }} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#64748B", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>ð Copy Link</button>}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748B", marginBottom: 2 }}>{site.address}, {site.city}, {site.state} {site.acreage ? `â¢ ${site.acreage} ac` : ""} {site.askingPrice ? `â¢ ${site.askingPrice}` : ""}</div>
                      {site.summary && <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4, lineHeight: 1.4, maxHeight: 40, overflow: "hidden" }}>{site.summary.substring(0, 200)}{site.summary.length > 200 ? "â¦" : ""}</div>}
                      {site.coordinates && <div style={{ fontSize: 10, marginBottom: 4 }}><a href={`https://www.google.com/maps?q=${site.coordinates}`} target="_blank" rel="noreferrer" style={{ color: "#3B82F6", textDecoration: "none" }}>ð Pin Drop</a></div>}
                      {site.status === "pending" ? (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F1F5F9" }}>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                            <select value={ri.reviewer} onChange={(e) => setRI("reviewer", e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12, background: "#fff", cursor: "pointer", minWidth: 120 }}>
                              <option value="">Reviewerâ¦</option>
                              <option>Daniel Wollent</option>
                              <option>Matthew Toussaint</option>
                              <option>Dan R</option>
                            </select>
                            <input value={ri.note} onChange={(e) => setRI("note", e.target.value)} placeholder="Review noteâ¦" style={{ flex: 1, minWidth: 180, padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12, outline: "none" }} />
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => { if (!ri.routeTo && !site.region) { notify("Select route (DW or MT)"); return; } handleApprove(site.id); setHighlightedSite(null); }} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>â Approve & Route</button>
                            <button onClick={() => { handleDecline(site.id); setHighlightedSite(null); }} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>â Decline</button>
                          </div>
                        </div>
                      ) : (site.reviewedBy || site.reviewNote) && (
                        <div style={{ marginTop: 8, fontSize: 11, color: "#94A3B8" }}>
                          {site.reviewedBy && <span>By: <strong>{site.reviewedBy}</strong></span>}
                          {site.reviewNote && <span style={{ marginLeft: 8, fontStyle: "italic" }}>"{site.reviewNote}"</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* âââ TRACKERS âââ */}
        {tab === "southwest" && <TrackerCards regionKey="southwest" />}
        {tab === "east" && <TrackerCards regionKey="east" />}
      </div>

            {/* âââ COPYRIGHT FOOTER âââ */}
                  <div style={{ textAlign: "center", padding: "18px 0 14px", borderTop: "1px solid #E2E8F0", marginTop: 24, color: "#94A3B8", fontSize: 11, letterSpacing: 0.3 }}>
                          Â© {new Date().getFullYear()} DJR Real Estate LLC. All rights reserved. Proprietary software â unauthorized reproduction prohibited.
                                </div>

      {/* âââ SiteIQ Weight Configuration Modal âââ */}
      {weightEditorOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }} onClick={() => setWeightEditorOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)', borderRadius: 16, border: '1px solid rgba(99,102,241,0.3)', padding: 32, width: 520, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 25px 50px rgba(0,0,0,0.5), 0 0 40px rgba(99,102,241,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div>
                <h2 style={{ margin: 0, color: '#e0e7ff', fontSize: 20, fontWeight: 700 }}>âï¸ SiteIQ Weight Configuration</h2>
                <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 12 }}>Adjust dimension weights. Changes apply to all site scores in real-time.</p>
              </div>
              <button onClick={() => setWeightEditorOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer', padding: 4 }}>â</button>
            </div>

            {/* Weight Total Indicator */}
            <div style={{ background: 'rgba(99,102,241,0.1)', borderRadius: 10, padding: '10px 16px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(99,102,241,0.2)' }}>
              <span style={{ color: '#a5b4fc', fontSize: 13, fontWeight: 600 }}>Total Weight</span>
              <span style={{ color: editWeights.reduce((s, w) => s + w.weight, 0) === 100 ? '#4ade80' : '#f87171', fontSize: 18, fontWeight: 700 }}>{editWeights.reduce((s, w) => s + w.weight, 0)}%</span>
            </div>

            {/* Dimension Sliders */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {editWeights.map((dim, idx) => {
                const cfgDim = SITE_IQ_CONFIG.dimensions.find(d => d.key === dim.key);
                const icon = cfgDim ? String.fromCodePoint(...[...cfgDim.icon].map(c => c.codePointAt(0))) : '';
                return (
                  <div key={dim.key} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '12px 16px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ color: '#e0e7ff', fontSize: 14, fontWeight: 600 }}>{icon} {dim.label || dim.key}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => { const nw = [...editWeights]; nw[idx] = { ...nw[idx], weight: Math.max(0, nw[idx].weight - 1) }; setEditWeights(nw); }} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#a5b4fc', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>-</button>
                        <input type="number" value={dim.weight} min={0} max={100} onChange={e => { const nw = [...editWeights]; nw[idx] = { ...nw[idx], weight: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) }; setEditWeights(nw); }} style={{ width: 48, textAlign: 'center', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, color: '#e0e7ff', fontSize: 15, fontWeight: 700, padding: '2px 4px' }} />
                        <span style={{ color: '#64748b', fontSize: 13 }}>%</span>
                        <button onClick={() => { const nw = [...editWeights]; nw[idx] = { ...nw[idx], weight: Math.min(100, nw[idx].weight + 1) }; setEditWeights(nw); }} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#a5b4fc', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                      </div>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 3, width: dim.weight + '%', background: dim.weight > 20 ? 'linear-gradient(90deg, #6366f1, #818cf8)' : dim.weight > 10 ? 'linear-gradient(90deg, #3b82f6, #60a5fa)' : 'linear-gradient(90deg, #64748b, #94a3b8)', transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={() => { setEditWeights(SITE_IQ_DEFAULTS.dimensions.map(d => ({ key: d.key, label: d.label, weight: d.weight }))); }} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}>Reset Defaults</button>
              <button onClick={() => {
                const total = editWeights.reduce((s, w) => s + w.weight, 0);
                if (total <= 0) return;
                // Update live config
                editWeights.forEach(ew => {
                  const dim = SITE_IQ_CONFIG.dimensions.find(d => d.key === ew.key);
                  if (dim) dim.weight = ew.weight;
                });
                SITE_IQ_CONFIG = normalizeSiteIQWeights(SITE_IQ_CONFIG);
                // Save to Firebase
                set(ref(db, 'config/siteiq_weights'), {
                  dimensions: editWeights.map(w => ({ key: w.key, weight: w.weight })),
                  updatedAt: new Date().toISOString(),
                  version: SITE_IQ_CONFIG.version
                });
                setWeightEditorOpen(false);
              }} style={{ padding: '8px 24px', borderRadius: 8, border: 'none', background: editWeights.reduce((s, w) => s + w.weight, 0) === 100 ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : '#991b1b', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, boxShadow: '0 2px 8px rgba(99,102,241,0.3)' }}>{editWeights.reduce((s, w) => s + w.weight, 0) === 100 ? 'Apply & Save' : 'Weights must = 100%'}</button>
            </div>

            <p style={{ margin: '16px 0 0', color: '#475569', fontSize: 11, textAlign: 'center' }}>Weights auto-normalize internally. Saved to Firebase for all users. v{SITE_IQ_CONFIG.version}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppWithErrorBoundary() {
  return React.createElement(ErrorBoundary, null, React.createElement(App));
}

