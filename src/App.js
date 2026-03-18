// src/App.js â SiteIQ Acquisition Tracker
// SiteIQ v4.1 â turbine logo update
// Â© 2026 DJR Real Estate LLC. All rights reserved.
// Proprietary and confidential. Unauthorized reproduction or distribution prohibited.
// Firebase Realtime Database â live shared data across all 3 users

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { db, storage } from "./firebase";
import { ref, onValue, set, push, remove, update } from "firebase/database";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
// xlsx is lazy-loaded on demand (Export Excel) to reduce initial bundle ~500KB
// import * as XLSX from "xlsx";  â moved to dynamic import()

// âââ CSV Parser âââ
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
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
  pending: { bg: "#FFFBEB", text: "#92700C", dot: "#C9A84C" },
  approved: { bg: "#E8F5E9", text: "#2E7D32", dot: "#4CAF50" },
  declined: { bg: "#FFEBEE", text: "#B71C1C", dot: "#EF5350" },
  tracking: { bg: "#FFF8F0", text: "#BF360C", dot: "#F37C33" },
};
const PHASES = [
  "Incoming",
  "Scored",
  "Prospect",
  "Submitted to Client",
  "Client Approved",
  "Client Revisions",
  "Client Declined",
  "LOI Sent",
  "LOI Signed",
  "PSA Sent",
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

// âââ SiteIQâ¢ Configurable Weight System v2.0 âââ
// Immutable defaults. Live config is a deep copy merged with Firebase overrides.
// Persisted at Firebase path: config/siteiq_weights
const SITE_IQ_DEFAULTS = [
  { key: "population", label: "Population", icon: "ð¥", weight: 0.20, tip: "3-mile population density", source: "ESRI / Census ACS", group: "demographics" },
  { key: "growth", label: "Growth", icon: "ð", weight: 0.25, tip: "Pop growth CAGR â 5yr projected trend", source: "ESRI 2025â2030 projections", group: "demographics" },
  { key: "income", label: "Med. Income", icon: "ð°", weight: 0.10, tip: "Median HHI within 3 miles", source: "ESRI / Census ACS", group: "demographics" },
  { key: "pricing", label: "Pricing", icon: "ð²", weight: 0.08, tip: "Price per acre vs. acquisition targets", source: "Asking price / acreage", group: "deal" },
  { key: "zoning", label: "Zoning", icon: "ð", weight: 0.15, tip: "By-right / conditional / prohibited", source: "Zoning field + summary", group: "entitlements" },
  { key: "access", label: "Site Access", icon: "ð£ï¸", weight: 0.07, tip: "Acreage, frontage, flood, access", source: "Site data + summary", group: "physical" },
  { key: "competition", label: "Competition", icon: "ð¢", weight: 0.07, tip: "Storage competitor density", source: "Competitor data / summary", group: "market" },
  { key: "marketTier", label: "Market Tier", icon: "ð", weight: 0.08, tip: "Target market priority ranking", source: "Market field / config", group: "market" },
];

// Live mutable config â starts as copy of defaults, merged with Firebase on load
let SITE_IQ_CONFIG = SITE_IQ_DEFAULTS.map(d => ({ ...d }));

// Auto-normalize so weights always sum to 1.0
const normalizeSiteIQWeights = (dims) => {
  const total = dims.reduce((s, d) => s + d.weight, 0);
  if (total > 0 && Math.abs(total - 1.0) > 0.001) {
    dims.forEach(d => { d.weight = d.weight / total; });
  }
  return dims;
};

// Get normalized weight by key
const getIQWeight = (key) => {
  const dim = SITE_IQ_CONFIG.find(d => d.key === key);
  return dim ? dim.weight : 0;
};

// âââ Helpers âââ
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
  cardBase: { background: "rgba(255,255,255,0.95)", borderRadius: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.06), 0 0 0 1px rgba(201,168,76,0.06)", overflow: "hidden", backdropFilter: "blur(8px)", transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)" },
  kpiCard: (borderColor) => ({ cursor: "pointer", background: "linear-gradient(145deg, rgba(15,15,20,0.95) 0%, rgba(30,30,40,0.92) 100%)", borderRadius: 16, padding: "22px 24px", minWidth: 140, boxShadow: `0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)`, borderLeft: `3px solid ${borderColor}`, transition: "all 0.4s cubic-bezier(0.4,0,0.2,1)", position: "relative", overflow: "hidden" }),
  labelMicro: { fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 },
  btnPrimary: { padding: "10px 20px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#C9A84C 0%,#1E2761 100%)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(201,168,76,0.35), 0 0 0 1px rgba(201,168,76,0.1)", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", position: "relative", overflow: "hidden" },
  btnGhost: { padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(201,168,76,0.2)", background: "rgba(201,168,76,0.04)", color: "#C9A84C", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)" },
  frostedHeader: { background: "linear-gradient(180deg, rgba(10,10,12,0.97) 0%, rgba(18,18,22,0.95) 100%)", backdropFilter: "blur(20px) saturate(1.5)", WebkitBackdropFilter: "blur(20px) saturate(1.5)", padding: "0 24px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 32px rgba(0,0,0,0.4), 0 1px 0 rgba(201,168,76,0.15)" },
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
  const parseNum = (v) => { if (!v) return null; const n = parseInt(String(v).replace(/[$,]/g, ""), 10); return isNaN(n) ? null : n; };
  const rings = {
    1: { pop: parseNum(site.pop1mi), hh: parseNum(site.households1mi), medIncome: parseNum(site.income1mi), homeValue: parseNum(site.homeValue1mi), renterPct: site.renterPct1mi, popGrowth: site.popGrowth1mi },
    3: { pop: parseNum(site.pop3mi), hh: parseNum(site.households3mi), medIncome: parseNum(site.income3mi), homeValue: parseNum(site.homeValue3mi), renterPct: site.renterPct3mi, popGrowth: site.popGrowth3mi },
    5: { pop: parseNum(site.pop5mi), hh: parseNum(site.households5mi), medIncome: parseNum(site.income5mi), homeValue: parseNum(site.homeValue5mi), renterPct: site.renterPct5mi, popGrowth: site.popGrowth5mi },
  };
  // 3mi projections
  const pop3mi_fy = parseNum(site.pop3mi_fy);
  const income3mi_fy = parseNum(site.income3mi_fy);
  const households3mi_fy = parseNum(site.households3mi_fy);
  // Growth metrics
  const hhGrowth3mi = site.hhGrowth3mi;
  const incomeGrowth3mi = site.incomeGrowth3mi;
  // Growth outlook based on actual ESRI pop growth
  const pg = site.popGrowth3mi ? parseFloat(site.popGrowth3mi) : 0;
  const pop3 = rings[3].pop || 0;
  let growthOutlook = "Stable";
  if (pg > 1.5) growthOutlook = "High Growth";
  else if (pg > 0.5) growthOutlook = "Growing";
  else if (pg > 0) growthOutlook = "Stable Growth";
  else if (pg < -0.5) growthOutlook = "Declining";
  else growthOutlook = "Flat";
  const hasDemoData = rings[3].pop || rings[3].medIncome;
  return hasDemoData ? {
    rings,
    pop3mi: site.pop3mi || null,
    income3mi: site.income3mi || null,
    growthOutlook,
    pop3mi_fy: site.pop3mi_fy || null,
    income3mi_fy: site.income3mi_fy || null,
    households3mi_fy: site.households3mi_fy || null,
    hhGrowth3mi,
    incomeGrowth3mi,
    popGrowth3mi: site.popGrowth3mi || null,
    source: site.demoSource || "ESRI ArcGIS GeoEnrichment 2025",
    pulledAt: site.demoPulledAt || null,
  } : null;
};
// Legacy Census fallback (only used if ESRI data not yet available)
const fetchDemographics = async (coordinates) => {
  if (!coordinates) return null;
  const parts = coordinates.split(",").map((s) => s.trim());
  if (parts.length !== 2) return null;
  const [lat, lng] = parts.map(Number);
  if (isNaN(lat) || isNaN(lng)) return null;
  try {
    const geoRes = await fetch(`https://geo.fcc.gov/api/census/block/find?latitude=${lat}&longitude=${lng}&format=json&showall=false`);
    const geoData = await geoRes.json();
    if (geoData.status !== "OK" || !geoData.Block?.FIPS) return { error: "Could not determine census tract" };
    const blockFips = geoData.Block.FIPS;
    const stFips = geoData.State?.FIPS || blockFips.substring(0, 2);
    const coFips = blockFips.substring(2, 5);
    const trFips = blockFips.substring(5, 11);
    const acsRes = await fetch(`https://api.census.gov/data/2022/acs/acs5?get=B01003_001E,B19013_001E,B11001_001E&for=tract:${trFips}&in=state:${stFips}%20county:${coFips}`);
    const acsData = await acsRes.json();
    if (!acsData || acsData.length < 2) return { error: "No ACS data for tract" };
    const row = acsData[1];
    const pop = parseInt(row[0], 10); const income = parseInt(row[1], 10); const hh = parseInt(row[2], 10);
    const tPop = isNaN(pop) ? 0 : pop; const incVal = isNaN(income) || income < 0 ? 0 : income; const tHh = isNaN(hh) ? 0 : hh;
    const rings = { 1: { pop: Math.round(tPop * 0.8), hh: Math.round(tHh * 0.8), medIncome: incVal }, 3: { pop: Math.round(tPop * 8), hh: Math.round(tHh * 8), medIncome: incVal }, 5: { pop: Math.round(tPop * 18), hh: Math.round(tHh * 18), medIncome: incVal } };
    return { rings, pop3mi: rings[3].pop ? rings[3].pop.toLocaleString() : null, income3mi: incVal ? "$" + incVal.toLocaleString() : null, growthOutlook: "Stable", source: "Census ACS 5-Year (2022) â fallback" };
  } catch (err) { console.error("Demographics fetch error:", err); return { error: "Failed to fetch demographics" }; }
};

// âââ Vetting Report Generator âââ
// stripEmoji: removes emoji/special Unicode chars that corrupt in plain-text/PDF renders
const stripEmoji = (str) => String(str || "").replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{200D}]|[\u{20E3}]|[\u{E0020}-\u{E007F}]/gu, "").trim();
const cleanPriority = (p) => { const s = stripEmoji(p); return s || "None"; };
const generateVettingReport = (site, nearestPSDistance, iqResult) => {
  const popN = parseInt(String(site.pop3mi).replace(/[^0-9]/g, ""), 10);
  const incN = parseInt(String(site.income3mi).replace(/[^0-9]/g, ""), 10);
  const acres = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
  const demoScore = (popN && incN) ? (popN >= 40000 && incN >= 60000 ? "PASS" : popN >= 20000 && incN >= 50000 ? "MARGINAL" : "BELOW THRESHOLD") : null;
  const demoColor = demoScore === "PASS" ? "#16A34A" : demoScore === "MARGINAL" ? "#F59E0B" : "#EF4444";
  let sizingText = "TBD", sizingColor = "#94A3B8", sizingTag = "PENDING";
  if (!isNaN(acres)) {
    if (acres >= 3.5 && acres <= 5) { sizingText = `${acres} ac â PRIMARY (one-story climate-controlled)`; sizingColor = "#16A34A"; sizingTag = "PASS"; }
    else if (acres >= 2.5 && acres < 3.5) { sizingText = `${acres} ac â SECONDARY (multi-story 3-4 story)`; sizingColor = "#16A34A"; sizingTag = "PASS"; }
    else if (acres < 2.5) { sizingText = `${acres} ac â Below minimum threshold`; sizingColor = "#EF4444"; sizingTag = "FAIL"; }
    else if (acres > 5 && acres <= 7) { sizingText = `${acres} ac â Viable if subdivisible`; sizingColor = "#F59E0B"; sizingTag = "CAUTION"; }
    else { sizingText = `${acres} ac â Large tract, subdivision potential`; sizingColor = "#F59E0B"; sizingTag = "CAUTION"; }
  }
  const psDistance = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : (nearestPSDistance ? nearestPSDistance : "Not checked â enter Nearest Facility in site detail");
  const psColor = site.siteiqData?.nearestPS ? (site.siteiqData.nearestPS >= 5 ? "#16A34A" : site.siteiqData.nearestPS >= 2.5 ? "#F59E0B" : "#EF4444") : "#94A3B8";
  const flags = [];
  if (!site.zoning) flags.push("Zoning not confirmed");
  if (!site.coordinates) flags.push("No coordinates â cannot verify location");
  if (!isNaN(acres) && acres < 2.5) flags.push("Below minimum acreage threshold");
  if (popN && popN < 10000) flags.push("3-mi population below 10,000 minimum");
  if (incN && incN < 60000) flags.push("3-mi median HHI below $60,000 target");
  if (!site.askingPrice || site.askingPrice === "TBD") flags.push("No confirmed asking price");
  const zoningClass = site.zoningClassification || "unknown";
  const zoningColor = zoningClass === "by-right" ? "#16A34A" : zoningClass === "conditional" ? "#F59E0B" : zoningClass === "rezone-required" ? "#EF4444" : zoningClass === "prohibited" ? "#991B1B" : "#94A3B8";
  const iq = iqResult || (typeof computeSiteIQ === "function" ? computeSiteIQ(site) : null);
  const iqScore = iq?.score || "â";
  const iqTier = iq?.tier || "gray";
  const iqLabel = iq?.label || "â";
  const iqBadgeColor = iqTier === "gold" ? "#C9A84C" : iqTier === "steel" ? "#2C3E6B" : "#94A3B8";
  const row = (label, value, opts = {}) => `<tr><td style="padding:10px 16px;font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid #F1F5F9;width:180px;vertical-align:top">${label}</td><td style="padding:10px 16px;font-size:13px;color:#1E293B;font-weight:${opts.bold ? 700 : 500};border-bottom:1px solid #F1F5F9">${opts.badge ? `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:11px;font-weight:700;background:${opts.badgeBg || '#F1F5F9'};color:${opts.badgeColor || '#64748B'}">${value}</span>` : value}</td></tr>`;
  const section = (num, title, icon) => `<div style="display:flex;align-items:center;gap:10px;margin:28px 0 14px;padding-bottom:8px;border-bottom:2px solid #1E2761"><div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#F37C33,#D45500);display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;font-weight:900;box-shadow:0 2px 8px rgba(243,124,51,0.3)">${num}</div><h2 style="margin:0;font-size:16px;font-weight:800;color:#1E2761;letter-spacing:0.02em">${icon} ${title}</h2></div>`;
  const mapsUrl = site.coordinates ? `https://www.google.com/maps?q=${site.coordinates}` : "#";
  const dom = site.dateOnMarket && site.dateOnMarket !== "N/A" ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vetting Report â ${site.name || "Site"}</title><style>@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Space+Mono:wght@700&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',sans-serif;background:#F8FAFC;color:#1E293B;padding:0}@media print{body{background:#fff}.no-print{display:none!important}.report{box-shadow:none}}.report{max-width:800px;margin:0 auto;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.08)}table{width:100%;border-collapse:collapse}.print-btn{position:fixed;bottom:28px;right:28px;display:flex;align-items:center;gap:8px;padding:14px 24px;border-radius:12px;border:none;background:linear-gradient(135deg,#F37C33,#D45500);color:#fff;font-size:14px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;box-shadow:0 4px 20px rgba(243,124,51,0.4),0 0 0 2px rgba(243,124,51,0.15);transition:all 0.2s ease;z-index:9999}.print-btn:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(243,124,51,0.5)}.print-btn:active{transform:scale(0.97)}.print-btn svg{width:18px;height:18px;fill:#fff}</style></head><body>
  <button class="print-btn no-print" onclick="window.print()"><svg viewBox="0 0 24 24"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>Print / Save PDF</button>
  <div class="report">
  <!-- HEADER -->
  <div style="background:linear-gradient(135deg,#0A0A0C 0%,#1E2761 60%,#2C3E6B 100%);padding:36px 40px;position:relative;overflow:hidden">
    <div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#F37C33,#FFB347,#F37C33,transparent)"></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
          <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#C9A84C,#1E2761);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(201,168,76,0.4)"><span style="font-size:16px;font-weight:900;color:#fff;font-family:'Space Mono'">IQ</span></div>
          <div><div style="font-size:10px;color:#94A3B8;letter-spacing:0.12em;text-transform:uppercase">Site Vetting Report</div><div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:0.01em;margin-top:2px">${site.name || "Unnamed Site"}</div></div>
        </div>
        <div style="font-size:12px;color:#94A3B8;margin-top:4px">${site.address || ""}, ${site.city || ""}, ${site.state || ""} &nbsp;|&nbsp; ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
      </div>
      <div style="text-align:right">
        <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:10px;background:${iqBadgeColor}18;border:1px solid ${iqBadgeColor}40">
          <span style="font-size:28px;font-weight:900;color:${iqBadgeColor};font-family:'Space Mono'">${typeof iqScore === "number" ? iqScore.toFixed(1) : iqScore}</span>
          <div><div style="font-size:9px;color:#94A3B8;letter-spacing:0.08em">SITEIQ</div><div style="font-size:11px;font-weight:800;color:${iqBadgeColor}">${iqLabel}</div></div>
        </div>
      </div>
    </div>
  </div>

  <!-- KEY METRICS BAR -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);background:#FAFBFC;border-bottom:1px solid #E2E8F0">
    ${[
      { l: "ACREAGE", v: site.acreage ? site.acreage + " ac" : "â" },
      { l: "ASKING PRICE", v: site.askingPrice || "â" },
      { l: "3-MI POP", v: site.pop3mi ? fmtN(site.pop3mi) : "â" },
      { l: "3-MI MED INC", v: site.income3mi ? ("$" + fmtN(site.income3mi)) : "â" },
    ].map(m => `<div style="padding:16px 12px;text-align:center;border-right:1px solid #E2E8F0"><div style="font-size:9px;font-weight:700;color:#94A3B8;letter-spacing:0.06em;margin-bottom:4px">${m.l}</div><div style="font-size:16px;font-weight:800;color:#1E293B;font-family:'Space Mono',monospace">${m.v}</div></div>`).join("")}
  </div>

  <div style="padding:24px 40px 40px">
    <!-- 1. PROPERTY OVERVIEW -->
    ${section("1", "Property Overview", "")}
    <table>${[
      row("Name", site.name || "â", { bold: true }),
      row("Address", `${site.address || "â"}, ${site.city || "â"}, ${site.state || "â"}`),
      row("Market", site.market || "â"),
      row("Acreage", site.acreage || "â"),
      row("Asking Price", site.askingPrice || "â", { bold: true }),
      row("Internal Price", site.internalPrice || "â"),
      row("Phase", site.phase || "Prospect", { badge: true, badgeBg: site.phase === "Under Contract" ? "#DCFCE7" : "#FFF7ED", badgeColor: site.phase === "Under Contract" ? "#166534" : "#9A3412" }),
      row("Priority", cleanPriority(site.priority)),
      row("Coordinates", site.coordinates ? `<a href="${mapsUrl}" target="_blank" style="color:#1565C0;text-decoration:none">${site.coordinates} â</a>` : "â"),
      row("Listing", site.listingUrl ? `<a href="${site.listingUrl}" target="_blank" style="color:#F37C33;text-decoration:none">View Listing â</a>` : "â"),
      dom !== null ? row("Days on Market", `${dom} days`, { badge: true, badgeBg: dom > 365 ? "#FEE2E2" : dom > 180 ? "#FEF3C7" : "#DCFCE7", badgeColor: dom > 365 ? "#991B1B" : dom > 180 ? "#92400E" : "#166534" }) : "",
    ].join("")}</table>

    <!-- 2. DEEP DIVE: ZONING & ENTITLEMENTS -->
    ${section("2", "Zoning & Entitlements â Deep Dive", "")}
    <div style="padding:16px 20px;border-radius:10px;background:${zoningColor}08;border:1px solid ${zoningColor}25;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:14px;font-weight:700;color:#1E293B">District: <strong>${site.zoning || "Not recorded"}</strong></span>
        <span style="padding:4px 14px;border-radius:8px;font-size:12px;font-weight:700;background:${zoningColor}15;color:${zoningColor};border:1px solid ${zoningColor}30">${zoningClass.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
      </div>
      <div style="font-size:12px;color:#64748B;line-height:1.6">${
        zoningClass === "by-right" ? "Self-storage / mini-warehouse is a <strong style='color:#16A34A'>permitted use</strong> in this zoning district. No special approvals required." :
        zoningClass === "conditional" ? "Self-storage is allowed as a <strong style='color:#F59E0B'>conditional / special use</strong>. Requires public hearing. Timeline: 2-6 months. Factor SUP costs (~$15K-$50K) into underwriting." :
        zoningClass === "rezone-required" ? "Current zoning <strong style='color:#EF4444'>does not permit</strong> storage use. Rezoning required: 4-12 month timeline, $25K-$75K+ cost." :
        zoningClass === "prohibited" ? "Storage is <strong style='color:#991B1B'>explicitly prohibited</strong>. Rezone is the only option." :
        "Zoning classification has <strong>not been confirmed</strong>. Permitted use table must be reviewed before proceeding."
      }</div>
    </div>
    <table>${[
      row("Zoning District", site.zoning || "Not confirmed", { bold: true }),
      row("Classification", zoningClass.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()), { badge: true, badgeBg: zoningColor + "18", badgeColor: zoningColor }),
      row("Storage Use Term", /(by\s*right|permitted)/i.test((site.zoning||"")+" "+(site.summary||"")) ? "Permitted (by right)" : /(conditional|sup\b|cup\b)/i.test((site.zoning||"")+" "+(site.summary||"")) ? "Conditional / SUP / CUP" : /rezone/i.test((site.zoning||"")+" "+(site.summary||"")) ? "Rezone required" : "Not determined"),
      row("Overlay Districts", /overlay/i.test((site.zoning||"")+" "+(site.summary||"")) ? "Yes â additional standards apply" : "None identified"),
      row("Ordinance Source", site.zoningSource || "<em style='color:#94A3B8'>Not yet researched</em>"),
      row("Planning Contact", site.planningContact || "<em style='color:#94A3B8'>Research needed</em>"),
    ].join("")}</table>
    ${site.zoningNotes ? `<div style="margin-top:12px;padding:14px 18px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:12px;line-height:1.7;color:#475569">${site.zoningNotes}</div>` : ""}

    <!-- 3. DEEP DIVE: UTILITIES & WATER -->
    ${section("3", "Utilities & Water â Deep Dive", "")}
    <table>${[
      row("Water Provider", site.waterProvider || "<em style='color:#94A3B8'>Research needed</em>"),
      row("Water Available", site.waterAvailable === true ? '<span style="color:#16A34A;font-weight:700">YES</span>' : site.waterAvailable === false ? '<span style="color:#EF4444;font-weight:700">NO â extension required</span>' : "<em style='color:#94A3B8'>Not confirmed</em>"),
      row("Sewer Provider", site.sewerProvider || "<em style='color:#94A3B8'>Research needed</em>"),
      row("Sewer Available", site.sewerAvailable === true ? '<span style="color:#16A34A;font-weight:700">YES</span>' : site.sewerAvailable === false ? '<span style="color:#EF4444;font-weight:700">NO</span>' : "<em style='color:#94A3B8'>Not confirmed</em>"),
      row("Electric Provider", site.electricProvider || "<em style='color:#94A3B8'>Research needed</em>"),
      row("3-Phase Power", site.threePhase === true ? '<span style="color:#16A34A;font-weight:700">Available</span>' : site.threePhase === false ? '<span style="color:#F59E0B;font-weight:700">Not available</span>' : "<em style='color:#94A3B8'>Not confirmed</em>"),
      row("Gas Provider", site.gasProvider || "<em style='color:#94A3B8'>Research needed</em>"),
      row("Tap/Impact Fees", site.tapFees || "<em style='color:#94A3B8'>Check jurisdiction fee schedule</em>"),
    ].join("")}</table>
    ${site.utilityNotes ? `<div style="margin-top:12px;padding:14px 18px;border-radius:8px;background:#F0F9FF;border:1px solid #BAE6FD;font-size:12px;line-height:1.7;color:#0C4A6E">${site.utilityNotes}</div>` : `<div style="margin-top:12px;padding:14px 18px;border-radius:8px;background:#FFFBEB;border:1px solid #FDE68A;font-size:12px;line-height:1.5;color:#92400E"><strong>Research Checklist:</strong> Water provider + service boundary | Sewer availability | Distance to mains | Tap fees | Electric (3-phase) | Gas | Capacity constraints</div>`}

    <!-- 4. TOPOGRAPHY & FLOOD -->
    ${section("4", "Topography & Flood Assessment", "")}
    <table>${[
      row("FEMA Flood Zone", site.floodZone || (/flood/i.test(site.summary||"") ? '<span style="color:#F59E0B;font-weight:700">Flood concern noted â verify FEMA panel</span>' : "<em style='color:#94A3B8'>Check msc.fema.gov</em>")),
      row("Terrain", site.terrain || "<em style='color:#94A3B8'>Review Google Earth / county contours</em>"),
      row("Wetlands", site.wetlands === true ? '<span style="color:#EF4444;font-weight:700">Present â reduces developable area</span>' : site.wetlands === false ? '<span style="color:#16A34A">None identified</span>' : "<em style='color:#94A3B8'>Check NWI mapper</em>"),
      row("Grading Risk", site.gradingRisk || "<em style='color:#94A3B8'>Assess from aerial/contours</em>"),
    ].join("")}</table>
    ${site.topoNotes ? `<div style="margin-top:12px;padding:14px 18px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:12px;line-height:1.7;color:#475569">${site.topoNotes}</div>` : ""}

    <!-- 5. DEMOGRAPHICS -->
    ${section("5", "Demographics (3-Mile Radius)", "")}
    <table>${[
      row("Population", site.pop3mi ? fmtN(site.pop3mi) : "Not available"),
      row("Median Income", site.income3mi ? ("$" + fmtN(site.income3mi)) : "Not available"),
      demoScore ? row("Demo Score", demoScore, { badge: true, badgeBg: demoColor + "18", badgeColor: demoColor }) : "",
    ].join("")}</table>

    <!-- 6. SITE SIZING -->
    ${section("6", "Site Sizing Assessment", "")}
    <div style="padding:14px 18px;border-radius:10px;background:${sizingColor}0A;border:1px solid ${sizingColor}25;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:600;color:#1E293B">${sizingText}</span>
      <span style="padding:3px 12px;border-radius:6px;font-size:11px;font-weight:800;background:${sizingColor}18;color:${sizingColor}">${sizingTag}</span>
    </div>

    <!-- 7. BROKER -->
    ${section("7", "Broker / Seller", "")}
    <table>${[
      row("Contact", site.sellerBroker || "Not listed"),
      row("Date on Market", site.dateOnMarket || "Unknown"),
    ].join("")}</table>

    <!-- 8. RED FLAGS -->
    ${section("8", "Red Flags", "")}
    ${flags.length === 0
      ? `<div style="padding:14px 18px;border-radius:10px;background:#F0FDF4;border:1px solid #BBF7D0;color:#166534;font-size:13px;font-weight:600">No red flags identified</div>`
      : `<div style="display:flex;flex-direction:column;gap:6px">${flags.map(f => `<div style="padding:10px 16px;border-radius:8px;background:#FEF2F2;border:1px solid #FECACA;font-size:12px;font-weight:600;color:#991B1B;display:flex;align-items:center;gap:8px"><span style="font-size:14px">&#9888;</span> ${f}</div>`).join("")}</div>`
    }

    <!-- 9. SUMMARY -->
    ${section("9", "Summary & Deal Notes", "")}
    <div style="padding:16px 20px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:13px;line-height:1.7;color:#475569">${site.summary || "No notes"}</div>

    ${iq && iq.scores ? (() => {
      const dims = [
        { key: "population", label: "Population", weight: 0.20 },
        { key: "growth", label: "Growth", weight: 0.25 },
        { key: "income", label: "Income", weight: 0.10 },
        { key: "pricing", label: "Pricing", weight: 0.08 },
        { key: "zoning", label: "Zoning", weight: 0.15 },
        { key: "access", label: "Site Access", weight: 0.07 },
        { key: "competition", label: "Competition", weight: 0.07 },
        { key: "marketTier", label: "Market Tier", weight: 0.08 },
      ];
      return `
    <!-- SITEIQ SCORECARD -->
    ${section("IQ", "SiteIQ Scorecard", "")}
    <!-- Visual Bar Chart -->
    <div style="display:flex;gap:8px;align-items:flex-end;height:140px;padding:20px 0 0;margin-bottom:16px">
      ${dims.map(d => {
        const v = iq.scores[d.key] || 0;
        const pct = Math.max(5, (v / 10) * 100);
        const c = v >= 8 ? "#F37C33" : v >= 6 ? "#3B82F6" : v >= 4 ? "#F59E0B" : "#EF4444";
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="font-size:14px;font-weight:900;color:${c};font-family:'Space Mono',monospace">${v.toFixed ? v.toFixed(1) : v}</div>
          <div style="width:100%;height:80px;border-radius:6px;background:#F1F5F9;position:relative;overflow:hidden">
            <div style="position:absolute;bottom:0;left:0;right:0;height:${pct}%;border-radius:6px;background:linear-gradient(180deg,${c},${c}88);transition:height 0.5s"></div>
          </div>
          <div style="font-size:8px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.02em;text-align:center;line-height:1.2">${d.label}</div>
        </div>`;
      }).join("")}
    </div>
    <!-- Detail Table -->
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">
      <thead><tr style="background:#FAFBFC">${["Dimension", "Score", "Weight", "Weighted"].map(h => `<th style="padding:8px 12px;font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.04em;text-align:left;border-bottom:2px solid #E2E8F0">${h}</th>`).join("")}</tr></thead>
      <tbody>${dims.map((d, i) => { const v = iq.scores[d.key] || 0; return `<tr style="background:${i % 2 ? "#FAFBFC" : "#fff"}"><td style="padding:8px 12px;font-size:12px;font-weight:600;color:#1E293B">${d.label}</td><td style="padding:8px 12px;font-size:13px;font-weight:800;color:${v >= 7 ? "#16A34A" : v >= 4 ? "#F59E0B" : "#EF4444"};font-family:'Space Mono',monospace">${typeof v === "number" ? v.toFixed(1) : "â"}</td><td style="padding:8px 12px;font-size:11px;color:#94A3B8">${(d.weight * 100).toFixed(0)}%</td><td style="padding:8px 12px;font-size:12px;font-weight:700;color:#475569">${(v * d.weight).toFixed(2)}</td></tr>`; }).join("")}
      <tr style="background:#1E2761"><td colspan="3" style="padding:10px 12px;font-size:12px;font-weight:800;color:#fff;text-transform:uppercase;letter-spacing:0.04em">Composite Score</td><td style="padding:10px 12px;font-size:18px;font-weight:900;color:#F37C33;font-family:'Space Mono',monospace">${typeof iqScore === "number" ? iqScore.toFixed(1) : iqScore}</td></tr>
      </tbody></table>`;
    })() : ""}
  </div>

  <!-- FOOTER -->
  <div style="background:#0A0A0C;padding:20px 40px;display:flex;justify-content:space-between;align-items:center">
    <div style="font-size:11px;color:#64748B">Report generated by <span style="color:#C9A84C;font-weight:700">SiteIQ Acquisition Pipeline 4.0</span></div>
    <div style="font-size:11px;color:#64748B"><span style="color:#C9A84C;font-weight:700">DJR Real Estate LLC</span> &nbsp;|&nbsp; Confidential</div>
  </div>
</div></body></html>`;
};

// âââ Zoning & Utility Report Generator âââ
const generateZoningUtilityReport = (site, iqResult) => {
  const iq = iqResult || {};
  const iqScore = typeof iq.composite === "number" ? iq.composite : (iq.score || "â");
  const zoningClass = site.zoningClassification || "unknown";
  const zoningLabel = { "by-right": "BY-RIGHT (Permitted)", "conditional": "CONDITIONAL (SUP/CUP Required)", "rezone-required": "REZONE REQUIRED", "prohibited": "PROHIBITED", "unknown": "UNKNOWN â Research Required" }[zoningClass] || zoningClass.toUpperCase();
  const zoningColor = zoningClass === "by-right" ? "#16A34A" : zoningClass === "conditional" ? "#F59E0B" : zoningClass === "rezone-required" ? "#EF4444" : zoningClass === "prohibited" ? "#991B1B" : "#94A3B8";
  const zoningBadgeBg = zoningClass === "by-right" ? "#F0FDF4" : zoningClass === "conditional" ? "#FFFBEB" : zoningClass === "rezone-required" ? "#FEF2F2" : zoningClass === "prohibited" ? "#FEF2F2" : "#F8FAFC";
  const summary = (site.summary || "").toLowerCase();
  const zoning = (site.zoning || "").toLowerCase();
  const combined = zoning + " " + summary;

  // Parse zoning intel from summary
  const hasByRight = /(by\s*right|permitted|storage\s*(?:by|permitted))/i.test(combined);
  const hasSUP = /(conditional|sup\b|cup\b|special\s*use)/i.test(combined);
  const hasRezone = /rezone/i.test(combined);
  const hasOverlay = /overlay/i.test(combined);
  const hasFlood = /flood/i.test(combined);
  const hasUtilities = /(utilit|water|sewer|electric|gas\b)/i.test(combined);
  const hasSeptic = /septic/i.test(combined);
  const hasWell = /\bwell\b/i.test(combined);

  // Zoning score from IQ
  const zoningScore = iq?.scores?.zoning;
  const zoningScoreColor = zoningScore >= 8 ? "#16A34A" : zoningScore >= 5 ? "#F59E0B" : zoningScore > 0 ? "#EF4444" : "#94A3B8";

  const row = (label, value, opts = {}) => `<tr><td style="padding:10px 16px;font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid #F1F5F9;width:200px;vertical-align:top">${label}</td><td style="padding:10px 16px;font-size:13px;color:#1E293B;font-weight:${opts.bold ? 700 : 500};border-bottom:1px solid #F1F5F9">${opts.badge ? `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:11px;font-weight:700;background:${opts.badgeBg || '#F1F5F9'};color:${opts.badgeColor || '#64748B'}">${value}</span>` : value}</td></tr>`;
  const section = (num, title) => `<div style="display:flex;align-items:center;gap:10px;margin:28px 0 14px;padding-bottom:8px;border-bottom:2px solid #1E2761"><div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#5E35B1,#7C4DFF);display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;font-weight:900;box-shadow:0 2px 8px rgba(94,53,177,0.3)">${num}</div><h2 style="margin:0;font-size:16px;font-weight:800;color:#1E2761;letter-spacing:0.02em">${title}</h2></div>`;
  const statusPill = (text, color) => `<span style="display:inline-block;padding:4px 14px;border-radius:8px;font-size:12px;font-weight:700;background:${color}15;color:${color};border:1px solid ${color}30">${text}</span>`;

  const flags = [];
  if (zoningClass === "unknown") flags.push("Zoning classification not confirmed â verify with local planning");
  if (zoningClass === "prohibited") flags.push("Storage use PROHIBITED in current zoning district");
  if (zoningClass === "rezone-required") flags.push("Rezone required â timeline and political risk apply");
  if (hasFlood) flags.push("Flood zone identified â verify FEMA panel and insurance cost");
  if (!hasUtilities && !hasSeptic) flags.push("Utility availability not confirmed â verify water, sewer, electric");
  if (hasSeptic) flags.push("Septic system noted â may limit building size / add cost");
  if (hasWell) flags.push("Well water noted â may need municipal connection for commercial use");
  if (hasOverlay) flags.push("Overlay district applies â additional standards may affect design/cost");
  if (!site.zoning) flags.push("No zoning district recorded â critical data gap");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Zoning & Utility Report â ${site.name || "Site"}</title><style>@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Space+Mono:wght@700&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',sans-serif;background:#F8FAFC;color:#1E293B;padding:0}@media print{body{background:#fff}.no-print{display:none!important}.report{box-shadow:none}}.report{max-width:800px;margin:0 auto;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.08)}table{width:100%;border-collapse:collapse}.print-btn{position:fixed;bottom:28px;right:28px;display:flex;align-items:center;gap:8px;padding:14px 24px;border-radius:12px;border:none;background:linear-gradient(135deg,#5E35B1,#7C4DFF);color:#fff;font-size:14px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;box-shadow:0 4px 20px rgba(94,53,177,0.4);transition:all 0.2s ease;z-index:9999}.print-btn:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(94,53,177,0.5)}.save-btn{position:fixed;bottom:28px;right:200px;display:flex;align-items:center;gap:8px;padding:14px 24px;border-radius:12px;border:none;background:linear-gradient(135deg,#1E2761,#2C3E6B);color:#fff;font-size:14px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;box-shadow:0 4px 20px rgba(30,39,97,0.4);transition:all 0.2s ease;z-index:9999}.save-btn:hover{transform:translateY(-2px)}</style></head><body>
  <button class="print-btn no-print" onclick="window.print()"><svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>Print / Save PDF</button>
  <div class="report">

  <!-- HEADER -->
  <div style="background:linear-gradient(135deg,#1a0a2e 0%,#2d1b69 40%,#5E35B1 100%);padding:36px 40px;position:relative;overflow:hidden">
    <div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#7C4DFF,#B388FF,#7C4DFF,transparent)"></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
          <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#7C4DFF,#B388FF);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(124,77,255,0.4)"><span style="font-size:18px;font-weight:900;color:#fff;font-family:'Space Mono'">Z&U</span></div>
          <div><div style="font-size:10px;color:#B388FF;letter-spacing:0.12em;text-transform:uppercase">Zoning & Utility Report</div><div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:0.01em;margin-top:2px">${site.name || "Unnamed Site"}</div></div>
        </div>
        <div style="font-size:12px;color:#B388FF;margin-top:4px">${site.address || ""}, ${site.city || ""}, ${site.state || ""} &nbsp;|&nbsp; ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
      </div>
      <div style="text-align:right">
        <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:10px;background:${zoningColor}18;border:1px solid ${zoningColor}40">
          <span style="font-size:11px;font-weight:800;color:${zoningColor};text-transform:uppercase">${zoningLabel}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- KEY METRICS BAR -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);background:#FAFBFC;border-bottom:1px solid #E2E8F0">
    ${[
      { label: "Zoning District", value: site.zoning || "Unknown", color: "#5E35B1" },
      { label: "Classification", value: zoningLabel.split(" (")[0], color: zoningColor },
      { label: "Acreage", value: site.acreage ? `${site.acreage} ac` : "TBD", color: "#1E293B" },
      { label: "Zoning Score", value: zoningScore != null ? `${zoningScore.toFixed(1)}/10` : "â", color: zoningScoreColor },
    ].map(m => `<div style="padding:16px 20px;text-align:center;border-right:1px solid #E2E8F0"><div style="font-size:9px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px">${m.label}</div><div style="font-size:16px;font-weight:800;color:${m.color};font-family:'Space Mono',monospace">${m.value}</div></div>`).join("")}
  </div>

  <div style="padding:32px 40px">

    <!-- 1. ZONING CLASSIFICATION -->
    ${section("1", "Zoning Classification")}
    <div style="padding:16px 20px;border-radius:10px;background:${zoningBadgeBg};border:1px solid ${zoningColor}25;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-size:15px;font-weight:700;color:#1E293B">District: <strong>${site.zoning || "Not recorded"}</strong></span>
        ${statusPill(zoningLabel, zoningColor)}
      </div>
      <div style="font-size:12px;color:#64748B;line-height:1.6">
        ${zoningClass === "by-right" ? "Self-storage / mini-warehouse is a <strong style='color:#16A34A'>permitted use</strong> in this zoning district. No special approvals required â proceed with site plan review." : ""}
        ${zoningClass === "conditional" ? "Self-storage is allowed as a <strong style='color:#F59E0B'>conditional / special use</strong>. Requires public hearing and approval. Timeline: typically 2â6 months. Factor SUP costs (~$15Kâ$50K) and uncertainty into underwriting." : ""}
        ${zoningClass === "rezone-required" ? "Current zoning <strong style='color:#EF4444'>does not permit</strong> storage use. Rezoning required â political risk, 4â12 month timeline, significant cost ($25Kâ$75K+). Evaluate carefully." : ""}
        ${zoningClass === "prohibited" ? "Storage is <strong style='color:#991B1B'>explicitly prohibited</strong> with no conditional path. Rezone is the only option and may face strong opposition." : ""}
        ${zoningClass === "unknown" ? "Zoning classification has <strong>not been confirmed</strong>. The permitted use table for this jurisdiction must be reviewed before proceeding. See Section 3 for next steps." : ""}
      </div>
    </div>
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Zoning District", site.zoning || "Not recorded", { bold: true }),
      row("Classification", zoningLabel, { badge: true, badgeBg: zoningBadgeBg, badgeColor: zoningColor }),
      row("Storage Use Term", hasByRight ? "Permitted (by right)" : hasSUP ? "Conditional / SUP / CUP" : hasRezone ? "Rezone required" : "Not determined"),
      row("Overlay Districts", hasOverlay ? "Yes â additional standards apply (check summary)" : "None identified"),
    ].join("")}</table>

    <!-- 2. SUPPLEMENTAL STANDARDS -->
    ${section("2", "Supplemental Standards & Requirements")}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px">
      ${[
        { label: "Facade / Materials", icon: "ð", text: /facade|material|masonry|brick/i.test(combined) ? "Requirements noted â see summary" : "No specific requirements identified" },
        { label: "Setbacks", icon: "ð", text: /setback/i.test(combined) ? "Setback requirements noted" : "Standard district setbacks apply" },
        { label: "Height Limits", icon: "ð", text: /height\s*limit|max.*height|story.*limit/i.test(combined) ? "Height restrictions noted" : "Standard district height limits" },
        { label: "Screening / Landscape", icon: "ð¿", text: /screen|landscape|buffer/i.test(combined) ? "Screening / landscaping required" : "Standard requirements" },
        { label: "Signage", icon: "ðª§", text: /sign/i.test(combined) ? "Signage requirements noted" : "Standard district signage rules" },
        { label: "Parking", icon: "ð¿", text: /parking/i.test(combined) ? "Parking requirements noted" : "Per district standards" },
      ].map(s => `<div style="padding:12px 16px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0"><div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:14px">${s.icon}</span><span style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.04em">${s.label}</span></div><div style="font-size:12px;color:#64748B">${s.text}</div></div>`).join("")}
    </div>

    <!-- 3. UTILITY ASSESSMENT -->
    ${section("3", "Utility Infrastructure")}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      ${[
        { label: "Water Service", icon: "ð§", available: /water|municipal|city\s*water/i.test(combined), issue: hasWell ? "Well water noted" : null, color: /water|municipal/i.test(combined) ? "#16A34A" : "#94A3B8" },
        { label: "Sanitary Sewer", icon: "ð¿", available: /sewer|sanitary/i.test(combined), issue: hasSeptic ? "Septic system" : null, color: /sewer/i.test(combined) ? "#16A34A" : hasSeptic ? "#F59E0B" : "#94A3B8" },
        { label: "Electric Service", icon: "â¡", available: /electric|power/i.test(combined), issue: null, color: /electric|power/i.test(combined) ? "#16A34A" : "#94A3B8" },
        { label: "Natural Gas", icon: "ð¥", available: /\bgas\b|natural\s*gas/i.test(combined), issue: null, color: /\bgas\b/i.test(combined) ? "#16A34A" : "#94A3B8" },
        { label: "Stormwater", icon: "ð§", available: /storm|drainage|detention/i.test(combined), issue: hasFlood ? "Flood zone concern" : null, color: hasFlood ? "#EF4444" : /storm|drainage/i.test(combined) ? "#16A34A" : "#94A3B8" },
        { label: "Telecom / Fiber", icon: "ð¡", available: /fiber|telecom|internet|broadband/i.test(combined), issue: null, color: /fiber|telecom/i.test(combined) ? "#16A34A" : "#94A3B8" },
      ].map(u => `<div style="padding:14px 16px;border-radius:10px;background:${u.color}08;border:1px solid ${u.color}20"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div style="display:flex;align-items:center;gap:6px"><span style="font-size:16px">${u.icon}</span><span style="font-size:12px;font-weight:700;color:#1E293B">${u.label}</span></div>${statusPill(u.available ? "Confirmed" : u.issue ? u.issue : "Not Confirmed", u.color)}</div><div style="font-size:11px;color:#64748B;margin-top:4px">${u.available ? "Available per listing/summary data" : u.issue ? u.issue + " â verify capacity for commercial use" : "Not mentioned in listing data â verify with jurisdiction or utility provider"}</div></div>`).join("")}
    </div>

    <!-- 4. FLOOD ZONE -->
    ${section("4", "Flood Zone & Environmental")}
    <div style="padding:14px 18px;border-radius:10px;background:${hasFlood ? "#FEF2F2" : "#F0FDF4"};border:1px solid ${hasFlood ? "#FECACA" : "#BBF7D0"};display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <span style="font-size:13px;font-weight:600;color:#1E293B">${hasFlood ? "Flood zone concern identified in site data" : "No flood zone issues identified"}</span>
      ${statusPill(hasFlood ? "FLOOD RISK" : "CLEAR", hasFlood ? "#EF4444" : "#16A34A")}
    </div>
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("FEMA Flood Zone", hasFlood ? "Flood zone identified â verify FEMA panel" : "Not identified (verify FEMA map)"),
      row("Environmental Concerns", /environmental|contamina|brownfield|phase\s*[12i]/i.test(combined) ? "Environmental issues noted â see summary" : "None identified"),
      row("Wetlands", /wetland/i.test(combined) ? "Wetlands noted â may affect buildable area" : "None identified"),
      row("Topography", /slope|grade|topo|steep|flat/i.test(combined) ? "Topography notes in summary" : "Not assessed â review aerial imagery"),
    ].join("")}</table>

    <!-- 5. ACCESS & INFRASTRUCTURE -->
    ${section("5", "Site Access & Infrastructure")}
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Road Frontage", /frontage|\d+['']?\s*(?:ft|feet|linear)/i.test(combined) ? "Frontage noted â see summary" : "Not confirmed"),
      row("Curb Cuts", /curb\s*cut|driveway|ingress|egress/i.test(combined) ? "Access points noted" : "Not confirmed â verify on aerial"),
      row("Road Type", /highway|arterial|collector|divided|two.?lane/i.test(combined) ? "Road classification noted" : "Not assessed"),
      row("Visibility", /visib/i.test(combined) ? "Visibility noted" : "Not assessed"),
      row("Landlocked", /landlocked|no\s*(?:road|access)|easement\s*only/i.test(combined) ? `<span style="color:#EF4444;font-weight:700">ACCESS CONCERN</span>` : "No landlocked concerns identified"),
    ].join("")}</table>

    <!-- 6. NEXT STEPS -->
    ${section("6", "Recommended Next Steps")}
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
      ${[
        zoningClass === "unknown" ? { pri: "HIGH", color: "#EF4444", text: "Locate permitted use table for this jurisdiction and verify storage permissibility" } : null,
        zoningClass === "conditional" ? { pri: "MED", color: "#F59E0B", text: "Research SUP/CUP process â timeline, cost, hearing requirements, and precedent" } : null,
        zoningClass === "rezone-required" ? { pri: "HIGH", color: "#EF4444", text: "Evaluate rezone feasibility â comp plan alignment, political climate, timeline" } : null,
        !hasUtilities ? { pri: "MED", color: "#F59E0B", text: "Confirm utility availability â contact water/sewer provider and electric utility" } : null,
        hasFlood ? { pri: "HIGH", color: "#EF4444", text: "Order FEMA flood certification and evaluate flood insurance cost impact" } : null,
        hasSeptic ? { pri: "MED", color: "#F59E0B", text: "Verify sewer extension feasibility â septic may not support commercial climate-controlled storage" } : null,
        hasOverlay ? { pri: "LOW", color: "#3B82F6", text: "Review overlay district standards â may impose facade, signage, or landscaping requirements" } : null,
        { pri: "LOW", color: "#3B82F6", text: "Verify all utility tap fees and connection costs for budget modeling" },
      ].filter(Boolean).map(s => `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-radius:8px;background:${s.color}08;border:1px solid ${s.color}18"><span style="font-size:10px;font-weight:800;color:${s.color};background:${s.color}15;padding:2px 8px;border-radius:4px;white-space:nowrap;margin-top:1px">${s.pri}</span><span style="font-size:12px;color:#1E293B;line-height:1.5">${s.text}</span></div>`).join("")}
    </div>

    <!-- 7. RED FLAGS -->
    ${section("7", "Red Flags & Action Items")}
    ${flags.length === 0
      ? `<div style="padding:14px 18px;border-radius:10px;background:#F0FDF4;border:1px solid #BBF7D0;color:#166534;font-size:13px;font-weight:600">No red flags identified</div>`
      : `<div style="display:flex;flex-direction:column;gap:6px">${flags.map(f => `<div style="padding:10px 16px;border-radius:8px;background:#FEF2F2;border:1px solid #FECACA;font-size:12px;font-weight:600;color:#991B1B;display:flex;align-items:center;gap:8px"><span style="font-size:14px">&#9888;</span> ${f}</div>`).join("")}</div>`
    }

    <!-- 8. DEAL NOTES -->
    ${section("8", "Zoning & Utility Notes")}
    <div style="padding:16px 20px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:13px;line-height:1.7;color:#475569">${site.summary || "No notes"}</div>

  </div>

  <!-- FOOTER -->
  <div style="background:#1a0a2e;padding:20px 40px;display:flex;justify-content:space-between;align-items:center">
    <div style="font-size:11px;color:#7C4DFF">Report generated by <span style="color:#B388FF;font-weight:700">SiteIQ Acquisition Pipeline 4.0</span></div>
    <div style="font-size:11px;color:#7C4DFF"><span style="color:#C9A84C;font-weight:700">DJR Real Estate LLC</span> &nbsp;|&nbsp; Confidential</div>
  </div>
</div></body></html>`;
};

// âââ SiteIQâ¢ v3 â Calibrated Site Scoring Engine âââ
// Matches CLAUDE.md Â§6h framework. Uses structured data fields, not regex on summary text.
// Weights: Pop 20%, Growth 25%, HHI 10%, Pricing 8%, Zoning 15%, Access 7%, Competition 7%, Market 8%
// Hard FAIL: pop <5K, HHI <$55K, landlocked
const computeSiteIQ = (site) => {
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

  // --- 2b. GROWTH (15%) â ESRI 5-year population CAGR ---
  let growthScore = 5; // default when no ESRI data
  const growthRaw = site.popGrowth3mi ? parseFloat(String(site.popGrowth3mi).replace(/[^0-9.\-+]/g, "")) : null;
  if (growthRaw !== null && !isNaN(growthRaw)) {
    if (growthRaw >= 2.0) growthScore = 10;       // booming â Sun Belt corridors
    else if (growthRaw >= 1.5) growthScore = 9;    // strong growth
    else if (growthRaw >= 1.0) growthScore = 8;    // healthy above-national
    else if (growthRaw >= 0.5) growthScore = 6;    // moderate positive
    else if (growthRaw >= 0.0) growthScore = 4;    // flat â no tailwind
    else if (growthRaw >= -0.5) growthScore = 2;   // declining â headwind
    else { growthScore = 0; flags.push("WARN: 3-mi pop declining > -0.5%/yr"); }
  }
  scores.growth = growthScore;

  // --- 2c. PRICING (8%) â Price per acre vs. acquisition targets ---
  // Thresholds: â¤$150K/ac=10, â¤$250K=8, â¤$400K=6, â¤$600K=4, >$600K=2, no data=5
  let pricingScore = 5; // default when price or acreage missing
  const priceRaw = parseFloat(String(site.askingPrice || "").replace(/[^0-9.]/g, ""));
  if (!isNaN(priceRaw) && priceRaw > 0 && !isNaN(acres) && acres > 0) {
    const ppa = priceRaw / acres; // price per acre
    if (ppa <= 150000) pricingScore = 10;
    else if (ppa <= 250000) pricingScore = 8;
    else if (ppa <= 400000) pricingScore = 6;
    else if (ppa <= 600000) pricingScore = 4;
    else pricingScore = 2;
  } else if (!isNaN(priceRaw) && priceRaw > 0 && !isNaN(acres) && acres === 0) {
    // Price exists but no acreage â can't compute PPA, leave default
  }
  scores.pricing = pricingScore;

  // --- 3. ZONING (15%) Â§6c methodology ---
  // Prefer structured zoningClassification field; fall back to regex on zoning + summary text
  let zoningScore = 3;
  const zClass = site.zoningClassification;
  if (zClass && zClass !== "unknown") {
    if (zClass === "by-right") zoningScore = 10;
    else if (zClass === "conditional") zoningScore = 6;
    else if (zClass === "rezone-required") zoningScore = 2;
    else if (zClass === "prohibited") { zoningScore = 0; flags.push("Zoning prohibits storage"); }
  } else {
    const byRight = /(by\s*right|permitted|storage\s*(?:by|permitted)|(?:^|\s)(?:cs|gb|mu|b[- ]?\d|c[- ]?\d|m[- ]?\d)\b|commercial|industrial|business|unrestricted|pud\s*allow)/i;
    const conditional = /(conditional|sup\b|cup\b|special\s*use|overlay|variance|needs?\s*sup)/i;
    const prohibited = /(prohibited|residential\s*only|(?:^|\s)ag\b|agriculture|not\s*permitted)/i;
    const rezoning = /(rezone|rezoning\s*required)/i;
    if (byRight.test(combinedText)) zoningScore = 10;
    else if (conditional.test(combinedText)) zoningScore = 6;
    else if (rezoning.test(combinedText)) zoningScore = 2;
    else if (prohibited.test(combinedText)) { zoningScore = 0; flags.push("Zoning prohibits storage"); }
    else if ((site.zoning || "").trim()) zoningScore = 5;
  }
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
  let compScore = 6;
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
  }
  scores.marketTier = tierScore;

  // --- COMPOSITE (weighted sum, 0-10 scale) â uses configurable weights ---
  const weightedSum =
    (popScore * getIQWeight("population")) + (growthScore * getIQWeight("growth")) +
    (incScore * getIQWeight("income")) + (pricingScore * getIQWeight("pricing")) +
    (zoningScore * getIQWeight("zoning")) + (scores.access * getIQWeight("access")) +
    (compScore * getIQWeight("competition")) + (tierScore * getIQWeight("marketTier"));
  let adjusted = Math.round(weightedSum * 10) / 10;

  // --- PHASE BONUS ---
  const phase = (site.phase || "").toLowerCase();
  if (/under contract|due diligence|closed/i.test(phase)) adjusted = Math.min(10, adjusted + 0.3);
  else if (/psa sent/i.test(phase)) adjusted = Math.min(10, adjusted + 0.25);
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
    score: final, scores, flags, hardFail, hasDemoData, classification, classColor,
    tier: final >= 8 ? "gold" : final >= 6 ? "steel" : "gray",
    label: final >= 9 ? "ELITE" : final >= 8 ? "PRIME" : final >= 7 ? "STRONG" : final >= 6 ? "VIABLE" : final >= 4 ? "MARGINAL" : "WEAK",
  };
};

// âââ SiteIQ Badge Component âââ
function SiteIQBadge({ site, size = "normal", iq: iqProp }) {
  const iq = iqProp || computeSiteIQ(site);
  const s = iq.score;
  const isGold = iq.tier === "gold";
  const isSteel = iq.tier === "steel";
  const isSmall = size === "small";

  const tierColors = {
    gold: { bg: "linear-gradient(135deg, #C9A84C, #FFD700, #C9A84C)", glow: "0 0 24px rgba(201,168,76,0.5), 0 0 48px rgba(201,168,76,0.2), 0 0 4px rgba(255,215,0,0.8)", text: "#0a0a0a", ring: "#C9A84C", labelBg: "linear-gradient(135deg, #FFFBEB, #FFF8ED)" },
    steel: { bg: "linear-gradient(135deg, #1a1a2e, #2C3E6B, #1a1a2e)", glow: "0 2px 12px rgba(44,62,107,0.35), 0 0 2px rgba(243,124,51,0.2)", text: "#fff", ring: "#F37C33", labelBg: "linear-gradient(135deg, #E8EAF6, #F0F2FF)" },
    gray: { bg: "linear-gradient(135deg, #3a3a4a, #4a4a5a, #3a3a4a)", glow: "0 2px 8px rgba(0,0,0,0.2)", text: "#94A3B8", ring: "#64748B", labelBg: "#F1F5F9" },
  };
  const tc = tierColors[iq.tier];

  if (isSmall) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "3px 10px", borderRadius: 8,
        background: typeof tc.labelBg === "string" && tc.labelBg.startsWith("linear") ? tc.labelBg : tc.labelBg,
        border: `1px solid ${tc.ring}28`,
        fontSize: 11, fontWeight: 700, color: iq.tier === "gold" ? "#D45500" : iq.tier === "steel" ? "#1E2761" : "#64748B",
        fontFamily: "'Space Mono', monospace",
        transition: "all 0.3s ease",
        boxShadow: iq.tier === "gold" ? "0 0 8px rgba(243,124,51,0.15)" : "none",
      }}>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.05em", opacity: 0.7 }}>IQ</span>
        {s.toFixed(1)}
        {iq.classification && <span style={{ width: 6, height: 6, borderRadius: "50%", background: iq.classColor, flexShrink: 0 }} title={iq.classification} />}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
      {/* Score Circle */}
      <div style={{
        position: "relative",
        width: 68, height: 68, borderRadius: "50%",
        background: tc.bg,
        boxShadow: tc.glow,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        ...(isGold ? { animation: "siteiq-glow 2s ease-in-out infinite alternate" } : {}),
      }}>
        {isGold && <><div style={{
          position: "absolute", inset: -4, borderRadius: "50%",
          border: "2px solid #F37C33",
          opacity: 0.6,
          animation: "siteiq-ring 2s ease-in-out infinite alternate",
        }} /><div style={{
          position: "absolute", inset: -8, borderRadius: "50%",
          border: "1px solid rgba(243,124,51,0.2)",
          opacity: 0.3,
          animation: "siteiq-ring 3s ease-in-out infinite alternate",
        }} /></>}
        <div style={{ textAlign: "center", lineHeight: 1 }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: tc.text, fontFamily: "'Space Mono', monospace", letterSpacing: "-0.02em" }}>{s.toFixed(1)}</div>
        </div>
      </div>
      {/* Label + Breakdown */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 12, fontWeight: 800, letterSpacing: "0.12em",
            color: iq.tier === "gold" ? "#D45500" : iq.tier === "steel" ? "#1E2761" : "#64748B",
            textTransform: "uppercase",
            padding: "4px 10px", borderRadius: 6,
            background: typeof tc.labelBg === "string" && tc.labelBg.startsWith("linear") ? tc.labelBg : tc.labelBg,
            boxShadow: iq.tier === "gold" ? "0 0 12px rgba(243,124,51,0.12)" : "none",
          }}>{iq.label}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8", letterSpacing: "0.08em" }}>SiteIQâ¢</span>
          {iq.classification && <span style={{ fontSize: 10, fontWeight: 800, color: iq.classColor, background: iq.classColor + "18", padding: "2px 7px", borderRadius: 4, letterSpacing: "0.06em" }}>{iq.classification}</span>}
        </div>
        {iq.flags && iq.flags.length > 0 && (
          <div style={{ display: "flex", gap: 3, marginTop: 2, flexWrap: "wrap" }}>
            {iq.flags.map((f, i) => (
              <span key={i} style={{ fontSize: 9, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", padding: "2px 6px", borderRadius: 4 }}>{f}</span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 5, marginTop: 8, alignItems: "flex-end", height: 64 }}>
          {[
            { key: "population", label: "POP" },
            { key: "growth", label: "GRO" },
            { key: "income", label: "INC" },
            { key: "pricing", label: "PPA" },
            { key: "zoning", label: "ZN" },
            { key: "access", label: "ACC" },
            { key: "competition", label: "CP" },
            { key: "marketTier", label: "MKT" },
          ].map((f) => {
            const v = iq.scores[f.key] || 0;
            const pct = Math.max(8, (v / 10) * 100);
            const c = v >= 8 ? "#F37C33" : v >= 6 ? "#3B82F6" : v >= 4 ? "#F59E0B" : "#EF4444";
            return (
              <div key={f.key} title={`${f.label}: ${v}/10`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: 32 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: c, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{v}</div>
                <div style={{ width: 20, height: 44, borderRadius: 4, background: "rgba(0,0,0,0.06)", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${pct}%`, borderRadius: 4, background: `linear-gradient(180deg, ${c}, ${c}99)`, transition: "height 0.5s cubic-bezier(0.4,0,0.2,1)", boxShadow: v >= 8 ? `0 0 8px ${c}50` : "none" }} />
                </div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.02em", lineHeight: 1 }}>{f.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// âââ Components âââ
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
export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [subs, setSubs] = useState([]);
  const [east, setEast] = useState([]);
  const [sw, setSw] = useState([]);
  const [tab, setTab] = useState("dashboard");
  const [transitioning, setTransitioning] = useState(false);
  const navigateTo = useCallback((newTab, opts = {}) => {
    if (newTab === tab && !opts.force) { if (opts.phase) setFilterPhase(opts.phase); if (opts.siteId) { setExpandedSite(opts.siteId); setTimeout(() => { const el = document.getElementById(`site-${opts.siteId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 120); } return; }
    setTransitioning(true);
    setTimeout(() => {
      setTab(newTab);
      if (opts.phase) setFilterPhase(opts.phase); else setFilterPhase("all");
      if (opts.siteId) { setExpandedSite(opts.siteId); setTimeout(() => { const el = document.getElementById(`site-${opts.siteId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 120); } else { setExpandedSite(null); }
      if (newTab === "review") setShowNewAlert(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => setTransitioning(false), 350);
    }, 280);
  }, [tab]);
  const [toast, setToast] = useState(null);
  const [expandedSite, setExpandedSite] = useState(null);
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
  const [showSiteIQDetail, setShowSiteIQDetail] = useState({});
  // vettingReport removed â auto-generates on site add
  const [showIQConfig, setShowIQConfig] = useState(false);
  const [iqWeights, setIqWeights] = useState(SITE_IQ_DEFAULTS.map(d => ({ key: d.key, label: d.label, icon: d.icon, weight: d.weight, tip: d.tip })));

  // âââ KEYBOARD NAVIGATION â Arrow keys to toggle between properties âââ
  useEffect(() => {
    const handleKeyNav = (e) => {
      // Only navigate on tracker tabs
      if (tab !== "southwest" && tab !== "east") return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Escape") return;
      // Don't intercept if user is typing in an input/textarea/select
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
    const subsRef = ref(db, "submissions");
    const eastRef = ref(db, "east");
    const swRef = ref(db, "southwest");
    const metaRef = ref(db, "meta/seeded");

    const unsubSeed = onValue(metaRef, (snap) => {
      setSeeded(!!snap.val());
    });

    // SiteIQ weight config listener â merges Firebase overrides into live config
    const iqRef = ref(db, "config/siteiq_weights");
    const unsubIQ = onValue(iqRef, (snap) => {
      const val = snap.val();
      if (val?.dimensions) {
        const merged = SITE_IQ_DEFAULTS.map(d => {
          const override = val.dimensions.find(o => o.key === d.key);
          return { ...d, weight: override ? override.weight : d.weight };
        });
        SITE_IQ_CONFIG = normalizeSiteIQWeights(merged);
        setIqWeights(merged.map(d => ({ key: d.key, label: d.label, icon: d.icon, weight: d.weight, tip: d.tip })));
      }
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
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      setSw(arr);
    });

    return () => {
      unsubSubs();
      unsubEast();
      unsubSw();
      unsubSeed();
      unsubIQ();
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
    // --- Pipeline Velocity: Track phase transitions ---
    if (field === "phase") {
      const site = [...sw, ...east].find(s => s.id === id);
      const oldPhase = site?.phase || "Unknown";
      if (oldPhase !== value) {
        fbPush(`${region}/${id}/phaseHistory`, {
          from: oldPhase,
          to: value,
          changedAt: new Date().toISOString(),
          by: "User",
        });
        fbPush(`${region}/${id}/activityLog`, {
          action: `Phase: ${oldPhase} â ${value}`,
          ts: new Date().toISOString(),
          by: "User",
        });
      }
    }
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
  const handleFetchDemos = async (region, site) => {
    if (!site.coordinates) { notify("Add coordinates first"); return; }
    setDemoLoading((prev) => ({ ...prev, [site.id]: true }));
    try {
      // Try ESRI data already in Firebase first
      const esriReport = buildDemoReport(site);
      if (esriReport) {
        setDemoReport((prev) => ({ ...prev, [site.id]: esriReport }));
        notify("ESRI 2025 demographics loaded");
      } else {
        // Fallback to Census API if ESRI data not yet available
        const result = await fetchDemographics(site.coordinates);
        if (result?.error) {
          notify(result.error);
        } else if (result) {
          const updates = {};
          if (result.income3mi && !site.income3mi) updates.income3mi = result.income3mi;
          if (result.pop3mi && !site.pop3mi) updates.pop3mi = result.pop3mi;
          if (Object.keys(updates).length > 0) {
            fbUpdate(`${region}/${site.id}`, updates);
            fbPush(`${region}/${site.id}/activityLog`, {
              action: `Demographics pulled: Pop ${result.pop3mi || "?"}, HHI ${result.income3mi || "?"} (${result.source})`,
              ts: new Date().toISOString(), by: "System",
            });
          }
          setDemoReport((prev) => ({ ...prev, [site.id]: result }));
          notify("Demographics loaded (Census fallback)");
        }
      }
    } catch (err) {
      notify("Demographics fetch failed");
      console.error(err);
    }
    setDemoLoading((prev) => ({ ...prev, [site.id]: false }));
  };

  // âââ AUTO VETTING REPORT â runs on site add, saves to Firebase Storage âââ
  const autoGenerateVettingReport = (region, siteId, site) => {
    try {
      const iqR = computeSiteIQ(site);
      const psD = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null;
      const report = generateVettingReport(site, psD, iqR);
      const docId = uid();
      const now = new Date().toISOString();
      const blob = new Blob([report], { type: "text/html;charset=utf-8" });
      const fileName = `Vetting_Report_${site.city || "Site"}_${site.state || ""}_${now.slice(0, 10)}.html`;
      const file = new File([blob], fileName, { type: "text/html;charset=utf-8" });
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
    fbUpdate(`submissions/${id}`, { status: "approved", reviewedBy: ri.reviewer || "Dan R", reviewNote: ri.note || "", routedTo: routeTo });
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
    fbUpdate(`submissions/${id}`, { status: "declined", reviewedBy: ri.reviewer || "Dan R", reviewNote: ri.note || "" });
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
      { key: "pricePerAcre", header: "Price/Acre", width: 16 },
      { key: "internalPrice", header: "Internal Price", width: 22 },
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
          if (c.key === "pricePerAcre") {
            const p = parseFloat(String(s.askingPrice || "").replace(/[^0-9.]/g, ""));
            const a = parseFloat(String(s.acreage || "").replace(/[^0-9.]/g, ""));
            return (!isNaN(p) && p > 0 && !isNaN(a) && a > 0) ? "$" + Math.round(p / a).toLocaleString() : "";
          }
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
        if (c.key === "pricePerAcre") {
          const p = parseFloat(String(s.askingPrice || "").replace(/[^0-9.]/g, ""));
          const a = parseFloat(String(s.acreage || "").replace(/[^0-9.]/g, ""));
          return (!isNaN(p) && p > 0 && !isNaN(a) && a > 0) ? "$" + Math.round(p / a).toLocaleString() : "";
        }
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
    XLSX.writeFile(wb, `SiteIQ_Acquisition_Pipeline_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
    [...sw, ...east].forEach((s) => { if (s && s.id) cache.set(s.id, computeSiteIQ(s)); });
    return cache;
  }, [sw, east]);
  const getSiteIQ = (site) => siteIQCache.get(site.id) || computeSiteIQ(site);

  const SortBar = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>Sort:</span>
      {SORT_OPTIONS.map((o) => (
        <button key={o.key} onClick={() => setSortBy(o.key)} style={{ padding: "4px 10px", borderRadius: 6, border: sortBy === o.key ? "1px solid #C9A84C" : "1px solid #E2E8F0", background: sortBy === o.key ? "#FFFBEB" : "#fff", color: sortBy === o.key ? "#92700C" : "#64748B", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans'", transition: "all 0.15s" }}>{o.label}</button>
      ))}
    </div>
  );

  // âââ STYLES âââ
  const inp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: "#fff", color: "#2C2C2C", outline: "none", boxSizing: "border-box" };
  const navBtn = (key) => ({ padding: "10px 16px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s", background: tab === key ? "rgba(201,168,76,0.12)" : "transparent", color: tab === key ? "#C9A84C" : "#64748B", whiteSpace: "nowrap", boxShadow: tab === key ? "0 0 12px rgba(201,168,76,0.08)" : "none" });
  const pendingSubsN = subs.filter((s) => s.status === "pending").length;
  const assignedReviewN = [...sw, ...east].filter(s => s.assignedTo && s.needsReview).length;
  const pendingN = pendingSubsN + assignedReviewN;

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

    return (
      <div style={{ animation: "fadeIn 0.3s ease-out" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", background: region.accent }} />
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: region.color }}>{region.label} â Master Tracker</h2>
          <span style={{ fontSize: 13, color: "#94A3B8" }}>({data.length})</span>
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

              return (
                <div key={site.id} id={`site-${site.id}`} className={`site-card${isOpen ? " site-card-open" : ""}`} style={{ ...STYLES.cardBase, borderLeft: `4px solid ${isOpen ? "#F37C33" : (PRIORITY_COLORS[site.priority] || region.accent)}`, ...(isOpen ? { boxShadow: "0 12px 48px rgba(243,124,51,0.12), 0 0 0 1px rgba(243,124,51,0.15), 0 0 40px rgba(243,124,51,0.04)", transform: "scale(1.003)", background: "rgba(255,252,248,0.97)" } : {}) }}>
                  {/* Collapsed header */}
                  <div onClick={() => { const next = isOpen ? null : site.id; setExpandedSite(next); if (next) setTimeout(() => { const el = document.getElementById(`site-${site.id}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); }} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: "#2C2C2C" }}>{site.name}</span>
                        <SiteIQBadge site={site} size="small" iq={getSiteIQ(site)} />
                        <PriorityBadge priority={site.priority} />
                        <select value={site.phase || "Prospect"} onClick={(e) => e.stopPropagation()} onChange={(e) => updateSiteField(regionKey, site.id, "phase", e.target.value)} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#475569", cursor: "pointer" }}>
                          {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <select value={site.assignedTo || ""} onClick={(e) => e.stopPropagation()} onChange={(e) => { const val = e.target.value; updateSiteField(regionKey, site.id, "assignedTo", val); if (val && !site.reviewedBy) updateSiteField(regionKey, site.id, "needsReview", true); }} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, border: site.assignedTo ? "1px solid #C9A84C" : "1px solid #E2E8F0", background: site.assignedTo ? "#FFFBEB" : "#F8FAFC", color: site.assignedTo ? "#92700C" : "#94A3B8", cursor: "pointer" }}>
                          <option value="">Assign to...</option>
                          <option value="Dan R">Dan R</option>
                          <option value="Daniel Wollent">Daniel Wollent</option>
                          <option value="Matthew Toussaint">Matthew Toussaint</option>
                        </select>
                        {site.assignedTo && site.needsReview && <span style={{ fontSize: 9, fontWeight: 700, color: "#92700C", background: "#FFFBEB", padding: "1px 6px", borderRadius: 4, border: "1px solid #C9A84C", letterSpacing: "0.04em" }}>NEEDS REVIEW</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748B" }}>{site.address}{site.city ? `, ${site.city}` : ""}{site.state ? `, ${site.state}` : ""}</div>
                      <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 11, color: "#94A3B8", flexWrap: "wrap" }}>
                        {site.askingPrice && <span>Ask: <strong style={{ color: "#2C2C2C" }}>{site.askingPrice}</strong></span>}
                        {site.internalPrice && <span>Int: <strong style={{ color: "#F37C33" }}>{site.internalPrice}</strong></span>}
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
                    <div className="card-expand" style={{ padding: "0 18px 18px", borderTop: "2px solid transparent", borderImage: "linear-gradient(90deg, transparent, #1E2761, #C9A84C, #FFD700, #C9A84C, #1E2761, transparent) 1" }}>
                      {/* ââ Nav Strip â Prev/Next + Keyboard hint ââ */}
                      {(() => {
                        const sites = sortData(regionKey === "east" ? east : sw);
                        const ids = sites.map(s => s.id);
                        const curIdx = ids.indexOf(site.id);
                        const prevId = curIdx > 0 ? ids[curIdx - 1] : null;
                        const nextId = curIdx < ids.length - 1 ? ids[curIdx + 1] : null;
                        const navBtnStyle = (disabled) => ({ padding: "5px 12px", borderRadius: 7, border: "1px solid #E2E8F0", background: disabled ? "#F8FAFC" : "#fff", color: disabled ? "#CBD5E1" : "#475569", fontSize: 11, fontWeight: 600, cursor: disabled ? "default" : "pointer", transition: "all .15s", display: "flex", alignItems: "center", gap: 4 });
                        return (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0 8px", borderBottom: "1px solid #F1F5F9", marginBottom: 10 }}>
                            <button disabled={!prevId} onClick={() => { if (prevId) { setExpandedSite(prevId); setTimeout(() => { const el = document.getElementById(`site-${prevId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); } }} style={navBtnStyle(!prevId)}>â² Prev</button>
                            <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 500, letterSpacing: "0.02em" }}>
                              <span style={{ fontWeight: 700, color: "#475569" }}>{curIdx + 1}</span> of {ids.length} Â· <span style={{ color: "#CBD5E1" }}>ââ keys Â· Esc close</span>
                            </div>
                            <button disabled={!nextId} onClick={() => { if (nextId) { setExpandedSite(nextId); setTimeout(() => { const el = document.getElementById(`site-${nextId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); } }} style={navBtnStyle(!nextId)}>Next â¼</button>
                          </div>
                        );
                      })()}

                      {/* ââ Executive Property Header â Fire Theme ââ */}
                      <div style={{ background: "linear-gradient(135deg, #0a0a0e 0%, #121218 40%, #1a1520 70%, #0f0c14 100%)", borderRadius: 16, padding: "24px 28px 20px", margin: "0 0 14px", overflow: "hidden", position: "relative", boxShadow: "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)" }}>
                        {/* Top fire accent */}
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, transparent 5%, #1E2761 20%, #C9A84C 40%, #FFD700 50%, #C9A84C 60%, #1E2761 80%, transparent 95%)", opacity: 0.8 }} />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                          {/* Left: SiteIQ Score + Bars + Key Stats */}
                          <div style={{ flex: 1, minWidth: 280 }}>
                            {/* Score + Label Row */}
                            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                              <div onClick={() => setShowSiteIQDetail(prev => ({ ...prev, [site.id]: !prev[site.id] }))} style={{ cursor: "pointer", position: "relative" }} title="Click for detailed SiteIQ breakdown">
                                <SiteIQBadge site={site} iq={getSiteIQ(site)} />
                                <div style={{ position: "absolute", bottom: -2, left: "50%", transform: "translateX(-50%)", fontSize: 7, color: "#64748B", fontWeight: 600, letterSpacing: "0.06em", whiteSpace: "nowrap", opacity: 0.7 }}>CLICK FOR DETAIL</div>
                              </div>
                              {site.market && <span style={{ background: "rgba(251,191,36,.12)", color: "#FBBF24", fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 8, border: "1px solid rgba(251,191,36,.2)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{site.market}</span>}
                            </div>
                            {/* Key Metrics Strip â Larger */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
                              {[
                                { label: "ASKING", val: fmtPrice(site.askingPrice), color: "#F1F5F9" },
                                { label: "ZONING", val: site.zoning || "â", color: site.zoning ? (/by.?right|permitted|allowed/i.test(site.summary || "") ? "#22C55E" : /SUP|conditional|special/i.test(site.zoning || "") ? "#FBBF24" : "#F1F5F9") : "#94A3B8" },
                                { label: "ACREAGE", val: site.acreage ? `${site.acreage} ac` : "â", color: "#F1F5F9" },
                                { label: "3MI POP", val: site.pop3mi ? fmtN(site.pop3mi) : "â", color: "#F1F5F9" },
                                { label: "3MI MED INC", val: site.income3mi ? (String(site.income3mi).startsWith("$") ? site.income3mi : "$" + fmtN(site.income3mi)) : "â", color: "#F1F5F9" },
                              ].map((m, idx) => (
                                <div key={idx} style={{ background: "rgba(255,255,255,.07)", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(255,255,255,.08)" }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: "#64748B", letterSpacing: "0.08em", marginBottom: 4 }}>{m.label}</div>
                                  <div style={{ fontSize: 16, fontWeight: 800, color: m.color, fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.val}</div>
                                </div>
                              ))}
                            </div>
                            {/* ââ SiteIQ Detail Panel â Click-to-expand ââ */}
                            {showSiteIQDetail[site.id] && (() => {
                              const iqD = getSiteIQ(site);
                              const dims = [
                                { key: "population", label: "Population (3-mi)", weight: getIQWeight("population"), icon: "ð¥", tip: "Census / ESRI 3-mi radius population" },
                                { key: "growth", label: "Growth (5yr CAGR)", weight: getIQWeight("growth"), icon: "ð", tip: "ESRI 2025â2030 population growth rate" },
                                { key: "income", label: "Median HHI (3-mi)", weight: getIQWeight("income"), icon: "ð°", tip: "Median household income within 3 miles" },
                                { key: "pricing", label: "Price / Acre", weight: getIQWeight("pricing"), icon: "ð·ï¸", tip: "Asking price per acre vs acquisition targets" },
                                { key: "zoning", label: "Zoning", weight: getIQWeight("zoning"), icon: "ðï¸", tip: "Storage permissibility in zoning district" },
                                { key: "access", label: "Site Access & Size", weight: getIQWeight("access"), icon: "ð£ï¸", tip: "Acreage, frontage, flood, access quality" },
                                { key: "competition", label: "Competition", weight: getIQWeight("competition"), icon: "ðª", tip: "Competing storage within 3 mi" },
                                { key: "marketTier", label: "Market Tier", weight: getIQWeight("marketTier"), icon: "ð¯", tip: "Target market alignment (MT/DW tiers)" },
                              ];
                              const scoreColor = (v) => v >= 8 ? "#22C55E" : v >= 6 ? "#3B82F6" : v >= 4 ? "#F59E0B" : "#EF4444";
                              const scoreLabel = (v) => v >= 9 ? "ELITE" : v >= 8 ? "PRIME" : v >= 7 ? "STRONG" : v >= 6 ? "VIABLE" : v >= 4 ? "MARGINAL" : "WEAK";
                              return (
                                <div style={{ marginTop: 12, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(243,124,51,.2)", boxShadow: "0 4px 20px rgba(0,0,0,.25)" }}>
                                  <div style={{ background: "linear-gradient(135deg,#1a0a00,#2a1505)", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ fontSize: 14 }}>ð¬</span>
                                      <span style={{ color: "#FFB347", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em" }}>SiteIQâ¢ DETAILED SCORECARD</span>
                                      <span style={{ color: "#64748B", fontSize: 10 }}>|</span>
                                      <span style={{ color: scoreColor(iqD.score), fontSize: 13, fontWeight: 900, fontFamily: "'Space Mono', monospace" }}>{iqD.score.toFixed(1)}</span>
                                      <span style={{ color: scoreColor(iqD.score), fontSize: 10, fontWeight: 800, background: scoreColor(iqD.score) + "18", padding: "2px 6px", borderRadius: 4 }}>{scoreLabel(iqD.score)}</span>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); setShowSiteIQDetail(prev => ({ ...prev, [site.id]: false })); }} style={{ background: "none", border: "1px solid rgba(255,255,255,.15)", borderRadius: 5, color: "#64748B", fontSize: 11, cursor: "pointer", padding: "2px 8px" }}>â</button>
                                  </div>
                                  <div style={{ background: "linear-gradient(180deg,#0F0A05,#0a0a0e)", padding: "8px 12px" }}>
                                    {dims.map((d, i) => {
                                      const v = iqD.scores[d.key] || 0;
                                      const weighted = (v * d.weight).toFixed(2);
                                      const pct = (v / 10) * 100;
                                      return (
                                        <div key={d.key} style={{ display: "grid", gridTemplateColumns: "28px 1fr 50px 80px 50px 60px", alignItems: "center", gap: 6, padding: "6px 4px", borderBottom: i < dims.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none" }} title={d.tip}>
                                          <span style={{ fontSize: 13, textAlign: "center" }}>{d.icon}</span>
                                          <div>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: "#E2E8F0" }}>{d.label}</div>
                                            <div style={{ fontSize: 8, color: "#475569", fontWeight: 600, letterSpacing: "0.04em" }}>{(d.weight * 100).toFixed(0)}% WEIGHT</div>
                                          </div>
                                          <div style={{ textAlign: "right", fontSize: 14, fontWeight: 900, color: scoreColor(v), fontFamily: "'Space Mono', monospace" }}>{v}</div>
                                          <div style={{ background: "rgba(255,255,255,.06)", borderRadius: 4, height: 10, overflow: "hidden", position: "relative" }}>
                                            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: `linear-gradient(90deg, ${scoreColor(v)}88, ${scoreColor(v)})`, borderRadius: 4, transition: "width 0.5s ease" }} />
                                          </div>
                                          <div style={{ textAlign: "right", fontSize: 10, color: "#94A3B8", fontFamily: "'Space Mono', monospace" }}>Ã{d.weight.toFixed(2)}</div>
                                          <div style={{ textAlign: "right", fontSize: 11, fontWeight: 800, color: "#FBBF24", fontFamily: "'Space Mono', monospace" }}>{weighted}</div>
                                        </div>
                                      );
                                    })}
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 4px 4px", borderTop: "2px solid rgba(243,124,51,.2)", marginTop: 4 }}>
                                      <div style={{ fontSize: 10, color: "#64748B", fontWeight: 600 }}>
                                        {iqD.flags && iqD.flags.length > 0 && iqD.flags.map((f, i) => <span key={i} style={{ display: "inline-block", fontSize: 9, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", padding: "2px 6px", borderRadius: 4, marginRight: 4 }}>{f}</span>)}
                                      </div>
                                      <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>COMPOSITE: <span style={{ color: "#FBBF24", fontWeight: 900, fontSize: 13, fontFamily: "'Space Mono'" }}>{iqD.score.toFixed(1)}</span> / 10</div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                          {/* Right: Priority + Phase controls */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
                            <select value={site.priority || "âª None"} onChange={(e) => updateSiteField(regionKey, site.id, "priority", e.target.value)} style={{ padding: "6px 10px", borderRadius: 7, border: `2px solid ${PRIORITY_COLORS[site.priority] || "rgba(255,255,255,.15)"}`, fontSize: 12, fontFamily: "'DM Sans'", background: "rgba(255,255,255,.08)", cursor: "pointer", fontWeight: 700, color: PRIORITY_COLORS[site.priority] || "#F1F5F9" }}>
                              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <select value={site.phase || "Prospect"} onChange={(e) => updateSiteField(regionKey, site.id, "phase", e.target.value)} style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,.15)", fontSize: 12, fontFamily: "'DM Sans'", background: "rgba(255,255,255,.08)", cursor: "pointer", fontWeight: 600, color: "#F1F5F9" }}>
                              {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                            {/* Assigned To */}
                            <select value={site.assignedTo || ""} onChange={(e) => { const val = e.target.value; updateSiteField(regionKey, site.id, "assignedTo", val); if (val && !site.reviewedBy) updateSiteField(regionKey, site.id, "needsReview", true); }} style={{ padding: "6px 10px", borderRadius: 7, border: site.assignedTo ? "2px solid #C9A84C" : "1px solid rgba(255,255,255,.15)", fontSize: 12, fontFamily: "'DM Sans'", background: site.assignedTo ? "rgba(201,168,76,.12)" : "rgba(255,255,255,.08)", cursor: "pointer", fontWeight: 700, color: site.assignedTo ? "#FFD700" : "#94A3B8" }}>
                              <option value="">Assign to...</option>
                              <option value="Dan R">Dan R</option>
                              <option value="Daniel Wollent">Daniel Wollent</option>
                              <option value="Matthew Toussaint">Matthew Toussaint</option>
                            </select>
                            {site.assignedTo && site.needsReview && (
                              <button onClick={() => { updateSiteField(regionKey, site.id, "needsReview", false); updateSiteField(regionKey, site.id, "reviewedBy", "Dan R"); updateSiteField(regionKey, site.id, "reviewedAt", new Date().toISOString()); notify(`Marked reviewed â ${site.name}`); }} style={{ padding: "6px 10px", borderRadius: 7, border: "none", background: "linear-gradient(135deg, #16A34A, #15803D)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: "0.02em" }}>â Mark Reviewed</button>
                            )}
                            {site.reviewedBy && !site.needsReview && (
                              <div style={{ fontSize: 9, color: "#22C55E", fontWeight: 600, textAlign: "right" }}>â Reviewed by {site.reviewedBy}</div>
                            )}
                            {/* Last Updated */}
                            {(() => {
                              const logs2 = Object.values(site.activityLog || {});
                              const lastLog2 = logs2.length > 0 ? logs2.sort((a, b) => new Date(b.ts || b.date || 0) - new Date(a.ts || a.date || 0))[0] : null;
                              const lastDate2 = lastLog2?.date || site.approvedAt;
                              const daysAgo2 = lastDate2 ? Math.floor((Date.now() - new Date(lastDate2).getTime()) / 86400000) : null;
                              return lastDate2 ? (
                                <div style={{ fontSize: 9, color: daysAgo2 > 30 ? "#EF4444" : daysAgo2 > 14 ? "#F59E0B" : "#22C55E", fontWeight: 600, textAlign: "right" }}>
                                  â {daysAgo2 === 0 ? "Today" : daysAgo2 === 1 ? "Yesterday" : daysAgo2 + "d ago"}
                                </div>
                              ) : null;
                            })()}
                          </div>
                        </div>
                        {/* Broker + Seller Row */}
                        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                          {site.sellerBroker && <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>Broker: <span style={{ color: "#F1F5F9", fontWeight: 700 }}>{site.sellerBroker}</span></span>}
                          {site.internalPrice && <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>Internal Price: <span style={{ color: "#F37C33", fontWeight: 700 }}>{site.internalPrice}</span></span>}
                          {dom !== null && <span style={{ fontSize: 12, color: dom > 365 ? "#EF4444" : dom > 180 ? "#F59E0B" : "#94A3B8", fontWeight: 600 }}>{dom}d on market</span>}
                        </div>
                      </div>

                      {/* Aerial / Satellite View */}
                      <div style={{ margin: "0 0 10px" }}>
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
                            <div onClick={() => document.getElementById(`doc-upload-flyer-${site.id}`)?.click()} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, padding: "5px 12px", borderRadius: 7, background: "#FFF3E0", border: "1px dashed #F37C33", fontSize: 11, color: "#E65100", fontWeight: 600, cursor: "pointer", transition: "all .2s" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#FFE0B2"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "#FFF3E0"; }}>
                              <input type="file" id={`doc-upload-flyer-${site.id}`} accept=".pdf,image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleDocUpload(regionKey, site.id, f, "Flyer"); e.target.value = ""; }} />
                              ð Click to upload flyer
                            </div>
                          );
                        })()}
                      </div>

                      {/* Summary */}
                      <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 14, margin: "10px 0", border: "1px solid #E2E8F0" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 6 }}>Recent Summary</div>
                        <EF multi label="" value={site.summary || ""} onSave={(v) => saveField(regionKey, site.id, "summary", v)} placeholder="Deal notes, updatesâ¦" />
                      </div>

                      {/* ââ Editable Detail Fields ââ */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
                        <EF label="Market" value={site.market || ""} onSave={(v) => saveField(regionKey, site.id, "market", v)} placeholder="DFW, Houstonâ¦" />
                        <EF label="Asking Price" value={site.askingPrice || ""} onSave={(v) => saveField(regionKey, site.id, "askingPrice", v)} placeholder="$1.5M" />
                        <EF label="Internal Price" value={site.internalPrice || ""} onSave={(v) => saveField(regionKey, site.id, "internalPrice", v)} placeholder="$1.2M" />
                        <EF label="Seller / Broker" value={site.sellerBroker || ""} onSave={(v) => saveField(regionKey, site.id, "sellerBroker", v)} placeholder="John Smith" />
                        <EF label="3-Mile Income" value={site.income3mi || ""} onSave={(v) => saveField(regionKey, site.id, "income3mi", v)} placeholder="$95,000" />
                        <EF label="3-Mile Pop" value={site.pop3mi || ""} onSave={(v) => saveField(regionKey, site.id, "pop3mi", v)} placeholder="45,000" />
                        <EF label="Acreage" value={site.acreage || ""} onSave={(v) => saveField(regionKey, site.id, "acreage", v)} placeholder="4.5 ac" />
                        <EF label="Zoning" value={site.zoning || ""} onSave={(v) => saveField(regionKey, site.id, "zoning", v)} placeholder="C-2, B3â¦" />
                      </div>

                      {/* Structured SiteIQ Fields */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Zoning Class.</div>
                          <select value={site.zoningClassification || "unknown"} onChange={(e) => { updateSiteField(regionKey, site.id, "zoningClassification", e.target.value); fbPush(`${regionKey}/${site.id}/activityLog`, { action: `Zoning class â ${e.target.value}`, ts: new Date().toISOString(), by: "User" }); }} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 11, fontFamily: "'DM Sans'", background: site.zoningClassification === "by-right" ? "#F0FDF4" : site.zoningClassification === "prohibited" ? "#FEF2F2" : "#FAFBFC", color: "#2C2C2C", cursor: "pointer" }}>
                            <option value="unknown">Unknown</option>
                            <option value="by-right">By-Right â</option>
                            <option value="conditional">Conditional (SUP/CUP)</option>
                            <option value="rezone-required">Rezone Required</option>
                            <option value="prohibited">Prohibited â</option>
                          </select>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Nearest Facility (mi)</div>
                          <input type="number" step="0.1" min="0" value={site.siteiqData?.nearestPS || ""} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) fbUpdate(`${regionKey}/${site.id}/siteiqData`, { nearestPS: v }); }} placeholder="5.2" style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12, fontFamily: "'DM Sans'", background: "#FAFBFC", color: "#2C2C2C" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Competitors</div>
                          <input type="number" step="1" min="0" value={site.siteiqData?.competitorCount ?? ""} onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) fbUpdate(`${regionKey}/${site.id}/siteiqData`, { competitorCount: v }); }} placeholder="3" style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12, fontFamily: "'DM Sans'", background: "#FAFBFC", color: "#2C2C2C" }} />
                        </div>
                      </div>

                      {/* ââ Auto Demographics Snapshot â always visible when data exists ââ */}
                      {(site.pop3mi || site.income3mi) && (() => {
                        const pN = (v) => { if (!v) return null; const n = typeof v === "number" ? v : parseInt(String(v).replace(/[$,]/g, ""), 10); return isNaN(n) ? null : n; };
                        const fP = (v, pre) => { const n = pN(v); return n != null ? (pre || "") + n.toLocaleString() : null; };
                        const gVal = site.popGrowth3mi ? (typeof site.popGrowth3mi === "number" ? site.popGrowth3mi : parseFloat(site.popGrowth3mi)) : null;
                        const gColor = gVal != null ? (gVal > 0 ? "#22C55E" : gVal < 0 ? "#EF4444" : "#94A3B8") : "#64748B";
                        const gLabel = gVal != null ? ((gVal >= 0 ? "+" : "") + gVal.toFixed(2) + "% /yr") : null;
                        const gOutlook = gVal != null ? (gVal > 1.5 ? "High Growth" : gVal > 0.5 ? "Growing" : gVal > 0 ? "Stable Growth" : gVal > -0.5 ? "Flat" : "Declining") : null;
                        const oColor = gVal != null ? (gVal > 1.5 ? "#22C55E" : gVal > 0.5 ? "#4ADE80" : gVal > 0 ? "#FBBF24" : gVal > -0.5 ? "#94A3B8" : "#EF4444") : "#64748B";
                        const rows = [
                          { label: "Population (3-mi)", val: fP(site.pop3mi), icon: "ð¥" },
                          { label: "Median HHI (3-mi)", val: fP(site.income3mi, "$"), icon: "ð°" },
                          { label: "Pop Growth (ESRI 2025â2030)", val: gLabel, icon: "ð", color: gColor },
                          { label: "Growth Outlook", val: gOutlook, icon: "ð®", color: oColor },
                          { label: "Households (3-mi)", val: fP(site.households3mi), icon: "ð " },
                          { label: "Median Home Value (3-mi)", val: fP(site.homeValue3mi, "$"), icon: "ð¡" },
                          { label: "Acreage", val: site.acreage ? site.acreage + " ac" : null, icon: "ð" },
                          { label: "Price / Acre", val: (() => { const p = parseFloat(String(site.askingPrice || "").replace(/[^0-9.]/g, "")); const a = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, "")); return (!isNaN(p) && p > 0 && !isNaN(a) && a > 0) ? "$" + Math.round(p / a).toLocaleString() + "/ac" : null; })(), icon: "ð·ï¸" },
                          { label: "Nearest Facility", val: site.siteiqData?.nearestPS ? site.siteiqData.nearestPS.toFixed(1) + " mi" : null, icon: "ð" },
                          { label: "Competitors (3-mi)", val: site.siteiqData?.competitorCount != null ? String(site.siteiqData.competitorCount) : null, icon: "ðª" },
                        ].filter(r => r.val != null);
                        return (
                          <div style={{ borderRadius: 14, marginBottom: 14, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,.12)", border: "1px solid #E8ECF0" }}>
                            <div style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E293B 50%,#1565C0 100%)", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 14 }}>ð</span>
                                <span style={{ color: "#fff", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em" }}>SITE DEMOGRAPHICS</span>
                                <span style={{ background: "linear-gradient(135deg,#FBBF24,#F59E0B)", color: "#0F172A", fontSize: 9, fontWeight: 900, padding: "2px 7px", borderRadius: 5, letterSpacing: "0.06em" }}>ESRI 2025</span>
                              </div>
                              <button onClick={() => handleFetchDemos(regionKey, site)} disabled={demoLoading[site.id]} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.08)", color: demoLoading[site.id] ? "#64748B" : "#22D3EE", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                                {demoLoading[site.id] ? "â³" : "ð"} {demoLoading[site.id] ? "Loading..." : "Full Report"}
                              </button>
                            </div>
                            <div style={{ background: "#FAFBFC", padding: "4px 0" }}>
                              {rows.map((row, i) => (
                                <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", alignItems: "center", padding: "7px 16px", borderBottom: i < rows.length - 1 ? "1px solid #F1F5F9" : "none", transition: "background .15s" }}>
                                  <span style={{ fontSize: 13, textAlign: "center" }}>{row.icon}</span>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>{row.label}</span>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: row.color || "#1E293B", fontFamily: "'Space Mono', monospace", textAlign: "right" }}>{row.val}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Pull Demographics â Full ESRI Report */}
                      {!(site.pop3mi || site.income3mi) && (
                        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                          <button onClick={() => handleFetchDemos(regionKey, site)} disabled={demoLoading[site.id] || !site.coordinates} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: demoLoading[site.id] ? "#E8F0FE" : "linear-gradient(135deg,#1565C0,#1976D2)", color: demoLoading[site.id] ? "#1565C0" : "#fff", fontSize: 11, fontWeight: 700, cursor: site.coordinates ? "pointer" : "not-allowed", opacity: site.coordinates ? 1 : 0.5, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 1px 3px rgba(21,101,192,.2)" }}>
                            {demoLoading[site.id] ? "â³ Fetchingâ¦" : "ð Pull Demographics"}
                          </button>
                        </div>
                      )}

                      {/* ESRI Demographic Report â Executive Dashboard */}
                      {demoReport[site.id] && (() => {
                        const dr = demoReport[site.id];
                        const r = dr.rings || {};
                        const fmtV = (v, prefix) => v != null ? (prefix || "") + (typeof v === "number" ? v.toLocaleString() : v) : "â";
                        const fmtGrowth = (v) => { if (v == null || v === "") return "â"; const n = typeof v === "number" ? v : parseFloat(String(v)); if (isNaN(n)) return String(v); return (n >= 0 ? "+" : "") + n.toFixed(2) + "%"; };
                        const growthColor = (s) => { if (!s && s !== 0) return "#64748B"; const n = typeof s === "number" ? s : parseFloat(String(s)); if (!isNaN(n)) return n > 0 ? "#16A34A" : n < 0 ? "#EF4444" : "#64748B"; const str = String(s); return str.includes("+") ? "#16A34A" : str.includes("-") ? "#EF4444" : "#64748B"; };
                        const hdrCell = { padding: "8px 12px", textAlign: "right", fontSize: 10, fontWeight: 800, color: "#CBD5E1", textTransform: "uppercase", letterSpacing: "0.06em" };
                        const metricCell = { padding: "7px 12px", fontWeight: 700, color: "#E2E8F0", fontSize: 11, borderBottom: "1px solid rgba(255,255,255,.08)" };
                        const valCell = { padding: "7px 12px", textAlign: "right", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', monospace", borderBottom: "1px solid rgba(255,255,255,.08)" };
                        const goldVal = { ...valCell, color: "#FBBF24" };
                        const whiteVal = { ...valCell, color: "#F1F5F9" };
                        return (
                          <div style={{ borderRadius: 14, marginBottom: 14, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,.15)" }}>
                            {/* Header */}
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
                                    <td style={{ ...whiteVal, borderBottom: "none", color: growthColor(r[1]?.popGrowth) }}>{fmtGrowth(r[1]?.popGrowth)}</td>
                                    <td style={{ ...goldVal, background: "rgba(251,191,36,.06)", borderBottom: "none", color: growthColor(r[3]?.popGrowth) }}>{fmtGrowth(r[3]?.popGrowth)}</td>
                                    <td style={{ ...whiteVal, borderBottom: "none", color: growthColor(r[5]?.popGrowth) }}>{fmtGrowth(r[5]?.popGrowth)}</td>
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
                                          {item.growth && <div style={{ fontSize: 9, fontWeight: 700, color: growthColor(item.growth), marginTop: 1 }}>{fmtGrowth(item.growth)} /yr</div>}
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
                            <a href={site.listingUrl ? (site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`) : `https://www.crexi.com/properties?query=${encodeURIComponent((site.address || "") + " " + (site.city || "") + " " + (site.state || ""))}`} target="_blank" rel="noopener noreferrer" style={{ padding: "4px 10px", borderRadius: 6, background: site.listingUrl ? "#FFF3E0" : "#F8FAFC", color: site.listingUrl ? "#E65100" : "#94A3B8", fontSize: 11, fontWeight: 600, textDecoration: "none", border: site.listingUrl ? "none" : "1px dashed #CBD5E1" }}>{site.listingUrl ? "ð Property Listing" : "ð Search Crexi"}</a>
                            <button onClick={() => {
                              const docs = site.docs ? Object.values(site.docs) : [];
                              const vr = docs.find(d => d.name && d.name.startsWith("Vetting_Report"));
                              if (vr && vr.url) { window.open(vr.url, "_blank"); }
                              else { const iqR = computeSiteIQ(site); const psD = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null; const rpt = generateVettingReport(site, psD, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); window.open(url, "_blank"); autoGenerateVettingReport(regionKey, site.id, site); }
                            }} style={{ padding: "4px 10px", borderRadius: 6, background: "#EDE7F6", color: "#5E35B1", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer" }}>ð Vetting Report</button>
                            <button type="button" onClick={() => {
                              const iqR = computeSiteIQ(site);
                              const rpt = generateZoningUtilityReport(site, iqR);
                              const blob = new Blob([rpt], { type: "text/html;charset=utf-8" });
                              const url = URL.createObjectURL(blob);
                              window.open(url, "_blank");
                            }} style={{ padding: "4px 10px", borderRadius: 6, background: "#F3E5F5", color: "#7B1FA2", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer" }}>ð Zoning & Utility</button>
                          </div>
                        )}
                      </div>

                      {/* Listing URL */}
                      <div style={{ marginBottom: 14 }}>
                        <EF label="Listing URL (Crexi / LoopNet)" value={site.listingUrl || ""} onSave={(v) => saveField(regionKey, site.id, "listingUrl", v)} placeholder="https://www.crexi.com/â¦" />
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
                          <input type="file" id={`doc-upload-${site.id}`} style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; const type = document.getElementById(`doc-type-${site.id}`)?.value || "Other"; if (f) handleDocUpload(regionKey, site.id, f, type); e.target.value = ""; }} />
                          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); document.getElementById(`doc-upload-${site.id}`)?.click(); }} style={{ padding: "5px 12px", borderRadius: 7, background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", border: "none", fontFamily: "'DM Sans'" }}>
                            + Upload
                          </button>
                        </div>
                      </div>

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
                          <input value={mi.text} onChange={(e) => setMsgInputs({ ...msgInputs, [site.id]: { ...mi, text: e.target.value } })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSendMsg(regionKey, site.id); } }} placeholder="Add messageâ¦" style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 13, outline: "none", fontFamily: "'DM Sans'" }} />
                          <button type="button" onClick={(e) => { e.preventDefault(); handleSendMsg(regionKey, site.id); }} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Send</button>
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
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #0C0C0E 0%, #111114 2%, #F0F2F5 6%, #F0F2F5 100%)", fontFamily: "'DM Sans', sans-serif" }}>
      {transitioning && <div className="tab-transition-overlay" />}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes tabSweep { 0% { transform: scaleX(0); opacity: 0; } 40% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; } }
        @keyframes tabFadeOut { 0% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(0.97) translateY(-8px); } }
        @keyframes tabFadeIn { 0% { opacity: 0; transform: scale(0.97) translateY(8px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        .tab-transition-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; pointer-events: none; }
        .tab-transition-overlay::before { content: ''; position: absolute; top: 50%; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, transparent, #F37C33, #FFB347, #F37C33, transparent); transform-origin: left; animation: tabSweep 0.6s cubic-bezier(0.4,0,0.2,1) forwards; }
        .tab-transition-overlay::after { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(243,124,51,0.06) 0%, rgba(10,10,12,0.3) 50%, rgba(10,10,12,0.5) 100%); animation: tabSweep 0.6s cubic-bezier(0.4,0,0.2,1) forwards; }
        .funnel-bar { cursor: pointer; position: relative; overflow: hidden; }
        .funnel-bar::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent); transform: translateX(-100%); transition: transform 0.4s ease; }
        .funnel-bar:hover::after { transform: translateX(100%); }
        .funnel-bar:hover { filter: brightness(1.15); box-shadow: 0 4px 16px rgba(0,0,0,0.15); transform: scale(1.02); }
        .funnel-bar:active { transform: scale(0.98); }
        @keyframes slideDown { from { max-height: 0; opacity: 0; transform: scaleY(0.95); } to { max-height: 2000px; opacity: 1; transform: scaleY(1); } }
        @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes siteiq-glow { 0% { box-shadow: 0 0 15px rgba(201,168,76,0.4), 0 0 30px rgba(201,168,76,0.15); } 100% { box-shadow: 0 0 30px rgba(201,168,76,0.6), 0 0 60px rgba(201,168,76,0.25); } }
        @keyframes siteiq-ring { 0% { opacity: 0.3; transform: scale(1); } 100% { opacity: 0.7; transform: scale(1.08); } }
        @keyframes siteiq-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes toastSlide { from { opacity: 0; transform: translateX(40px) scale(0.95); } to { opacity: 1; transform: translateX(0) scale(1); } }
        @keyframes pulseOnce { 0% { box-shadow: 0 0 0 0 rgba(201,168,76,0.5); } 70% { box-shadow: 0 0 0 14px rgba(201,168,76,0); } 100% { box-shadow: 0 0 0 0 rgba(201,168,76,0); } }
        @keyframes countUp { from { opacity: 0; transform: scale(0.3) translateY(10px); filter: blur(4px); } to { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); } }
        /* FIRE: Ember float particles */
        @keyframes emberFloat { 0% { transform: translateY(0) translateX(0) scale(1); opacity: 0.7; } 50% { transform: translateY(-20px) translateX(8px) scale(0.6); opacity: 0.4; } 100% { transform: translateY(-40px) translateX(-5px) scale(0.2); opacity: 0; } }
        @keyframes fireGlow { 0% { box-shadow: 0 0 20px rgba(201,168,76,0.15), 0 0 60px rgba(30,39,97,0.08); } 50% { box-shadow: 0 0 30px rgba(201,168,76,0.25), 0 0 80px rgba(30,39,97,0.12); } 100% { box-shadow: 0 0 20px rgba(201,168,76,0.15), 0 0 60px rgba(30,39,97,0.08); } }
        @keyframes fireEdge { 0% { border-image-source: linear-gradient(180deg, #C9A84C, #1E2761, #2C3E6B); } 50% { border-image-source: linear-gradient(180deg, #FFD700, #C9A84C, #1E2761); } 100% { border-image-source: linear-gradient(180deg, #C9A84C, #1E2761, #2C3E6B); } }
        @keyframes headerEmber { 0% { background-position: 0% 100%; } 100% { background-position: 100% 0%; } }
        @keyframes tabSlide { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes modalIn { from { opacity: 0; transform: scale(0.92) translateY(20px); backdrop-filter: blur(0); } to { opacity: 1; transform: scale(1) translateY(0); backdrop-filter: blur(4px); } }
        @keyframes kpiPulse { 0% { transform: scale(1); } 50% { transform: scale(1.02); } 100% { transform: scale(1); } }
        @keyframes cardReveal { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes glowLine { 0% { left: -40%; } 100% { left: 140%; } }
        @keyframes navUnderlineFire { 0% { background: linear-gradient(90deg, #1E2761, #C9A84C, #FFD700); background-size: 200% 100%; background-position: 0% 50%; } 100% { background: linear-gradient(90deg, #1E2761, #C9A84C, #FFD700); background-size: 200% 100%; background-position: 100% 50%; } }
        * { box-sizing: border-box; }
        input, select, textarea, button { font-family: 'DM Sans', sans-serif; }
        /* UPGRADED: Card hover with fire-edge glow */
        .site-card { transition: all 0.4s cubic-bezier(0.4,0,0.2,1); position: relative; }
        .site-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 16px; opacity: 0; transition: opacity 0.4s ease; pointer-events: none; box-shadow: 0 0 0 1px rgba(243,124,51,0.15), 0 8px 32px rgba(243,124,51,0.08); z-index: 0; }
        .site-card:hover { transform: translateY(-3px); box-shadow: 0 8px 32px rgba(0,0,0,0.1), 0 0 0 1px rgba(243,124,51,0.12) !important; }
        .site-card:hover::before { opacity: 1; }
        .site-card-open { transform: none !important; }
        .site-card-open:hover { transform: none !important; }
        /* UPGRADED: Smooth expand with fire accent */
        .card-expand { animation: slideDown 0.35s cubic-bezier(0.4,0,0.2,1); overflow: hidden; transform-origin: top; }
        /* UPGRADED: Nav underline with fire gradient */
        .nav-active::after { content: ''; position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 70%; height: 3px; background: linear-gradient(90deg, #1E2761, #C9A84C, #FFD700, #C9A84C, #1E2761); background-size: 300% 100%; animation: navUnderlineFire 2s ease infinite; border-radius: 3px; box-shadow: 0 0 12px rgba(201,168,76,0.4); }
        /* Sort pill glow */
        .sort-active { box-shadow: 0 0 0 2px rgba(243,124,51,0.25), 0 0 12px rgba(243,124,51,0.08); }
        /* UPGRADED: Scrollbar with fire accent */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(0,0,0,0.02); }
        ::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #C9A84C, #1E2761); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #FFB347, #F37C33); }
        /* UPGRADED: KPI number with fire entrance */
        .kpi-number { animation: countUp 0.6s cubic-bezier(0.4,0,0.2,1); }
        /* Tab content transition */
        .tab-content { animation: tabSlide 0.4s cubic-bezier(0.4,0,0.2,1); }
        /* Card staggered reveal */
        .card-reveal { animation: cardReveal 0.4s cubic-bezier(0.4,0,0.2,1) backwards; }
        /* Fire glow on interactive elements */
        button:active:not(:disabled) { transform: scale(0.97); transition: transform 0.1s; }
        /* Frosted glass card style */
        .glass-card { background: rgba(255,255,255,0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.18); }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 24, background: "linear-gradient(135deg, rgba(15,15,20,0.97), rgba(30,20,15,0.95))", color: "#fff", padding: "12px 22px", borderRadius: 14, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: "0 8px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(243,124,51,0.2), 0 0 30px rgba(243,124,51,0.08)", animation: "toastSlide 0.35s cubic-bezier(0.4,0,0.2,1)", borderLeft: "3px solid transparent", borderImage: "linear-gradient(180deg, #FFB347, #F37C33, #D45500) 1", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFB347, #F37C33)", boxShadow: "0 0 8px rgba(243,124,51,0.6)", animation: "siteiq-glow 1.5s ease-in-out infinite alternate", flexShrink: 0 }} />{toast}</div>
      )}

      {/* SiteIQ Weight Config Modal */}
      {showIQConfig && (() => {
        const totalW = iqWeights.reduce((s, d) => s + d.weight, 0);
        const totalPct = Math.round(totalW * 100);
        const adjustWeight = (key, delta) => {
          setIqWeights(prev => prev.map(d => d.key === key ? { ...d, weight: Math.max(0, Math.min(1, Math.round((d.weight + delta) * 100) / 100)) } : d));
        };
        const handleSaveWeights = () => {
          const normalized = iqWeights.map(d => ({ ...d, weight: d.weight / totalW }));
          SITE_IQ_CONFIG = SITE_IQ_DEFAULTS.map((def, i) => ({ ...def, weight: normalized[i].weight }));
          normalizeSiteIQWeights(SITE_IQ_CONFIG);
          fbSet("config/siteiq_weights", {
            dimensions: normalized.map(d => ({ key: d.key, weight: Math.round(d.weight * 1000) / 1000 })),
            updatedAt: new Date().toISOString(),
            updatedBy: "Dashboard",
            version: "2.0",
          });
          setShowIQConfig(false);
          notify("SiteIQ weights saved & applied");
        };
        const handleResetDefaults = () => {
          setIqWeights(SITE_IQ_DEFAULTS.map(d => ({ key: d.key, label: d.label, icon: d.icon, weight: d.weight, tip: d.tip })));
        };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "modalIn 0.35s cubic-bezier(0.4,0,0.2,1)" }} onClick={() => setShowIQConfig(false)}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, maxWidth: 500, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(243,124,51,0.1), 0 0 60px rgba(243,124,51,0.06)", overflow: "hidden", animation: "cardReveal 0.4s cubic-bezier(0.4,0,0.2,1)" }}>
              <div style={{ background: "linear-gradient(135deg, #0a0a0e 0%, #121218 50%, #1a1520 100%)", padding: "22px 26px", color: "#fff", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, #1E2761, #C9A84C, #FFD700, #C9A84C, #1E2761, transparent)", opacity: 0.6 }} />
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>âï¸ SiteIQâ¢ Weight Configuration</div>
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 5 }}>Adjust dimension weights. Changes apply to all users in real-time.</div>
              </div>
              <div style={{ padding: "16px 24px" }}>
                {iqWeights.map(dim => (
                  <div key={dim.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #F1F5F9" }}>
                    <span style={{ fontSize: 16, width: 24 }}>{dim.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1E293B" }}>{dim.label}</div>
                      <div style={{ fontSize: 10, color: "#94A3B8" }}>{dim.tip}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button onClick={() => adjustWeight(dim.key, -0.01)} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #E2E8F0", background: "#F8FAFC", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748B" }}>â</button>
                      <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Space Mono', monospace", width: 48, textAlign: "center", color: dim.weight > 0.15 ? "#F37C33" : dim.weight > 0.05 ? "#1E293B" : "#94A3B8" }}>{Math.round(dim.weight * 100)}%</div>
                      <button onClick={() => adjustWeight(dim.key, 0.01)} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #E2E8F0", background: "#F8FAFC", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748B" }}>+</button>
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, padding: "10px 0", borderTop: "2px solid #E2E8F0" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: totalPct === 100 ? "#16A34A" : totalPct > 100 ? "#DC2626" : "#D97706" }}>Total: {totalPct}% {totalPct === 100 ? "â" : totalPct > 100 ? "(will normalize)" : "(will normalize)"}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, padding: "16px 24px", borderTop: "1px solid #E2E8F0", background: "#F8FAFC" }}>
                <button onClick={handleResetDefaults} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Reset Defaults</button>
                <div style={{ flex: 1 }} />
                <button onClick={() => setShowIQConfig(false)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                <button onClick={handleSaveWeights} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#C9A84C 0%,#1E2761 100%)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(201,168,76,0.35), 0 0 0 1px rgba(201,168,76,0.1)", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 6px 24px rgba(243,124,51,0.45), 0 0 0 2px rgba(243,124,51,0.2)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(243,124,51,0.35), 0 0 0 1px rgba(243,124,51,0.1)"; e.currentTarget.style.transform = "translateY(0)"; }}
                >Apply & Save</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* New site alert */}
      {showNewAlert && (
        <div style={{ background: "linear-gradient(135deg, rgba(243,124,51,0.08), rgba(255,179,71,0.06))", borderBottom: "1px solid rgba(243,124,51,0.2)", padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, animation: "fadeIn 0.35s ease-out", backdropFilter: "blur(8px)" }}>
          <span style={{ fontSize: 13, color: "#92700C", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFD700, #C9A84C)", boxShadow: "0 0 8px rgba(201,168,76,0.5)", animation: "siteiq-glow 1.5s ease-in-out infinite alternate" }} />{newSiteCount} new site{newSiteCount > 1 ? "s" : ""} pending review</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setTab("review"); setShowNewAlert(false); }} style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Review</button>
            <button onClick={() => setShowNewAlert(false)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#fff", color: "#94A3B8", fontSize: 11, cursor: "pointer" }}>â</button>
          </div>
        </div>
      )}

      {/* Header â SiteIQ Theme */}
      <div style={STYLES.frostedHeader}>
        {/* Ambient gold line across header bottom */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent 0%, #1E2761 15%, #C9A84C 30%, #FFD700 50%, #C9A84C 70%, #1E2761 85%, transparent 100%)", opacity: 0.6 }} />
        {/* SiteIQ Banner */}
        <div style={{ padding: "12px 0 8px", borderBottom: "1px solid rgba(201,168,76,0.08)", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 46, height: 46, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg viewBox="0 0 64 64" style={{ width: 46, height: 46, filter: "drop-shadow(0 0 8px rgba(57,255,20,0.4)) drop-shadow(0 0 16px rgba(0,229,255,0.2))", animation: "siteiq-spin 12s linear infinite" }}>
                  <defs>
                    <radialGradient id="iqbg" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#1a1a2e"/><stop offset="100%" stopColor="#0a0a0c"/></radialGradient>
                    <linearGradient id="iqblade" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#39FF14" stopOpacity="0.9"/><stop offset="100%" stopColor="#00E5FF" stopOpacity="0.7"/></linearGradient>
                  </defs>
                  <rect width="64" height="64" rx="14" fill="url(#iqbg)"/>
                  <g transform="translate(32,32)">
                    {[0,60,120,180,240,300].map(r => <path key={r} d="M0,-18 Q8,-8 2,-2 Q-2,-4 0,-18Z" fill="url(#iqblade)" opacity="0.85" transform={`rotate(${r})`}/>)}
                    <circle r="8" fill="#1a1a2e" stroke="#3a3a5c" strokeWidth="1.5"/>
                    <circle r="6" fill="none" stroke="#555577" strokeWidth="0.5"/>
                  </g>
                  <text x="32" y="37" textAnchor="middle" fontFamily="system-ui,sans-serif" fontWeight="900" fontSize="12" fill="#e0e0e0" letterSpacing="-0.3">IQ</text>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.06em", background: "linear-gradient(90deg, #fff 0%, #C9A84C 25%, #FFD700 50%, #C9A84C 75%, #fff 100%)", backgroundSize: "300% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "shimmer 4s linear infinite" }}>SITEIQ</div>
                <div style={{ fontSize: 10, color: "#94A3B8", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 1 }}>Acquisition Pipeline <span style={{ color: "#C9A84C", fontWeight: 700 }}>Â·</span> <span style={{ fontWeight: 800, color: "#C9A84C" }}>4.0</span></div>
                <div style={{ fontSize: 8, color: "#64748B", letterSpacing: "0.06em", marginTop: 2, fontWeight: 600 }}>Powered by DJR Real Estate LLC</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowIQConfig(true)} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(201,168,76,0.25)", background: "rgba(201,168,76,0.06)", color: "#C9A84C", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans'", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", backdropFilter: "blur(8px)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,168,76,0.15)"; e.currentTarget.style.boxShadow = "0 0 20px rgba(201,168,76,0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(201,168,76,0.06)"; e.currentTarget.style.boxShadow = "none"; }}
              >âï¸ SiteIQ Config</button>
              <button onClick={handleExport} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(243,124,51,0.25)", background: "rgba(243,124,51,0.06)", color: "#F37C33", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans'", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", backdropFilter: "blur(8px)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(243,124,51,0.15)"; e.currentTarget.style.boxShadow = "0 0 20px rgba(243,124,51,0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(243,124,51,0.06)"; e.currentTarget.style.boxShadow = "none"; }}
              >â¬ Export Excel</button>
            </div>
          </div>
        </div>

        {/* Nav â Fire accent tabs */}
        <div style={{ display: "flex", gap: 4, overflowX: "auto", padding: "6px 0 4px", scrollbarWidth: "none" }}>
          {[
            { key: "dashboard", label: "Dashboard" },
            { key: "summary", label: "Summary" },
            { key: "southwest", label: "Daniel Wollent" },
            { key: "east", label: "Matthew Toussaint" },
            { key: "submit", label: "Submit Site" },
            { key: "review", label: pendingN > 0 ? `Review (${pendingN})` : "Review" },
          ].map((n) => (
            <button key={n.key} onClick={() => navigateTo(n.key)} style={{ ...navBtn(n.key), position: "relative", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)" }}
              onMouseEnter={(e) => { if (tab !== n.key) { e.currentTarget.style.color = "#C9A84C"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.textShadow = "0 0 12px rgba(201,168,76,0.3)"; } }}
              onMouseLeave={(e) => { if (tab !== n.key) { e.currentTarget.style.color = "#64748B"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.textShadow = "none"; } }}
            >
              {n.label}
              {n.key === "review" && pendingN > 0 && <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFD700, #C9A84C)", boxShadow: "0 0 8px rgba(201,168,76,0.5)", animation: "siteiq-glow 1.5s ease-in-out infinite alternate" }} />}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>

        {/* âââ DASHBOARD âââ */}
        {tab === "dashboard" && (
          <div style={{ animation: "fadeIn 0.3s ease-out" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Pipeline", value: sw.length + east.length, color: "#F37C33", icon: "ð", action: () => navigateTo("summary"), sub: "View summary â" },
                { label: "Pending", value: pendingN, color: "#F59E0B", icon: "â³", action: () => navigateTo("review"), sub: "Review queue â" },
                { label: "Daniel Wollent", value: sw.length, color: REGIONS.southwest.accent, icon: "ð·", action: () => navigateTo("southwest"), sub: "Open tracker â" },
                { label: "Matthew Toussaint", value: east.length, color: REGIONS.east.accent, icon: "ð¢", action: () => navigateTo("east"), sub: "Open tracker â" },
              ].map((kpi, kpiIdx) => (
                <div key={kpi.label} onClick={kpi.action} className="card-reveal" style={{ ...STYLES.kpiCard(kpi.color), animationDelay: `${kpiIdx * 0.08}s` }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px) scale(1.02)"; e.currentTarget.style.boxShadow = `0 12px 40px rgba(0,0,0,0.3), 0 0 30px ${kpi.color}25, inset 0 1px 0 rgba(255,255,255,0.08)`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0) scale(1)"; e.currentTarget.style.boxShadow = `0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)`; }}>
                  {/* Ambient glow line */}
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${kpi.color}40, transparent)`, opacity: 0.8 }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 1 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em" }}>{kpi.label}</div>
                    <span style={{ fontSize: 18, opacity: 0.4, filter: "grayscale(0.3)" }}>{kpi.icon}</span>
                  </div>
                  <div className="kpi-number" style={{ fontSize: 38, fontWeight: 900, color: "#fff", marginTop: 8, fontFamily: "'Space Mono', monospace", letterSpacing: "-0.03em", position: "relative", zIndex: 1, textShadow: `0 0 30px ${kpi.color}30` }}>{kpi.value}</div>
                  <div style={{ fontSize: 10, color: kpi.color, marginTop: 6, fontWeight: 700, letterSpacing: "0.02em", position: "relative", zIndex: 1 }}>{kpi.sub}</div>
                  {/* Bottom fire accent line */}
                  <div style={{ position: "absolute", bottom: 0, left: "10%", right: "10%", height: 2, background: `linear-gradient(90deg, transparent, ${kpi.color}50, transparent)`, borderRadius: 2 }} />
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
                      { label: "Added this week", value: addedThisWeek, color: "#3B82F6", action: () => navigateTo("summary") },
                      { label: "Under Contract", value: ucCount, color: "#16A34A", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                      { label: "LOI Active", value: loiCount, color: "#F59E0B", action: () => navigateTo("summary", { phase: "LOI Sent" }) },
                      { label: "GREEN Sites", value: greenCount, color: "#22C55E", action: () => navigateTo("summary") },
                    ].map((v, vi) => (
                      <div key={v.label} onClick={v.action} className="card-reveal funnel-bar" style={{ flex: "1 1 100px", background: "rgba(255,255,255,0.92)", borderRadius: 12, padding: "10px 14px", border: `1px solid ${v.color}18`, textAlign: "center", animationDelay: `${0.3 + vi * 0.06}s`, backdropFilter: "blur(8px)", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", position: "relative", overflow: "hidden", cursor: "pointer" }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 16px ${v.color}18`; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
                      >
                        <div style={{ fontSize: 20, fontWeight: 900, color: v.color, fontFamily: "'Space Mono', monospace", position: "relative", zIndex: 1 }}>{v.value}</div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.04em", position: "relative", zIndex: 1 }}>{v.label}</div>
                        <div style={{ position: "absolute", bottom: 0, left: "20%", right: "20%", height: 2, background: `linear-gradient(90deg, transparent, ${v.color}40, transparent)` }} />
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

            {/* âââ DEAL MOMENTUM â Executive Pulse âââ */}
            {(() => {
              const all = [...sw, ...east];
              const now = Date.now();
              const DAY = 86400000;
              const WEEK = 7 * DAY;

              // --- Recent phase advances (last 30 days) ---
              const recentMoves = [];
              all.forEach(s => {
                const history = s.phaseHistory ? Object.values(s.phaseHistory) : [];
                history.forEach(h => {
                  if (h.changedAt) {
                    const age = now - new Date(h.changedAt).getTime();
                    if (age < 30 * DAY && age >= 0) {
                      const regionKey = sw.find(x => x.id === s.id) ? "southwest" : "east";
                      recentMoves.push({ name: s.name, from: h.from, to: h.to, date: h.changedAt, daysAgo: Math.floor(age / DAY), region: regionKey === "southwest" ? "DW" : "MT", regionKey, siteId: s.id });
                    }
                  }
                });
              });
              recentMoves.sort((a, b) => a.daysAgo - b.daysAgo);

              // --- Pipeline value by stage ---
              const parsePrice = (p) => { if (!p) return 0; const s = String(p).replace(/[$,]/g, ""); const m = s.match(/([\d.]+)\s*[Mm]/); if (m) return parseFloat(m[1]) * 1000000; return parseFloat(s) || 0; };
              const loiValue = all.filter(s => s.phase === "LOI Sent" || s.phase === "LOI Signed").reduce((sum, s) => sum + parsePrice(s.askingPrice), 0);
              const ucValue = all.filter(s => s.phase === "Under Contract" || s.phase === "Due Diligence").reduce((sum, s) => sum + parsePrice(s.askingPrice), 0);
              const prospectValue = all.filter(s => s.phase === "Prospect" || s.phase === "Incoming" || s.phase === "Scored").reduce((sum, s) => sum + parsePrice(s.askingPrice), 0);
              const fmtVal = (v) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`;

              // --- Phase distribution for mini bars ---
              const phaseGroups = [
                { label: "Prospect", phases: ["Prospect", "Incoming", "Scored"], color: "#3B82F6", icon: "ð", action: () => navigateTo("summary", { phase: "Prospect" }) },
                { label: "LOI", phases: ["LOI Sent", "LOI Signed"], color: "#F37C33", icon: "ð", action: () => navigateTo("summary", { phase: "LOI Sent" }) },
                { label: "PSA", phases: ["PSA Sent"], color: "#8B5CF6", icon: "📄", action: () => navigateTo("summary", { phase: "PSA Sent" }) },
                { label: "Under Contract", phases: ["Under Contract", "Due Diligence"], color: "#16A34A", icon: "ð¤", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                { label: "Closed", phases: ["Closed"], color: "#059669", icon: "ð", action: () => navigateTo("summary", { phase: "Closed" }) },
              ];
              phaseGroups.forEach(g => { g.count = all.filter(s => g.phases.includes(s.phase)).length; });
              const maxPhaseCount = Math.max(...phaseGroups.map(g => g.count), 1);

              // --- Move type classification ---
              const advancePhases = ["LOI Sent", "LOI Signed", "PSA Sent", "Under Contract", "Due Diligence", "Closed", "Client Approved"];
              const moveIcon = (to) => advancePhases.includes(to) ? "ð¢" : to === "Dead" || to === "Client Declined" ? "ð´" : "ðµ";
              const moveLabel = (to) => advancePhases.includes(to) ? "ADVANCED" : to === "Dead" || to === "Client Declined" ? "EXITED" : "MOVED";

              const hasData = recentMoves.length > 0 || all.length > 0;
              if (!hasData) return null;

              return (
                <div className="card-reveal" style={{ background: "linear-gradient(145deg, rgba(15,15,20,0.96) 0%, rgba(25,25,32,0.94) 100%)", borderRadius: 16, padding: 0, marginBottom: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)", backdropFilter: "blur(12px)", animationDelay: "0.5s", position: "relative", overflow: "hidden" }}>
                  {/* Top ember line */}
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent 5%, #F37C33 30%, #FFB347 50%, #F37C33 70%, transparent 95%)" }} />

                  {/* Header */}
                  <div style={{ padding: "18px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #F37C33, #D45500)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, boxShadow: "0 2px 8px rgba(243,124,51,0.4)" }}>â¡</div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#F8FAFC", letterSpacing: "0.02em" }}>Deal Momentum</h3>
                        <div style={{ fontSize: 10, color: "rgba(148,163,184,0.7)", fontWeight: 500, marginTop: 1 }}>Pipeline value & recent activity</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 8, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E", animation: "fireGlow 2s ease-in-out infinite" }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#86EFAC" }}>{all.length} ACTIVE</span>
                    </div>
                  </div>

                  {/* Pipeline Value Metrics */}
                  <div style={{ padding: "16px 24px 0", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    {[
                      { label: "LOI PIPELINE", value: fmtVal(loiValue), count: all.filter(s => s.phase === "LOI Sent" || s.phase === "LOI Signed").length, color: "#F37C33", action: () => navigateTo("summary", { phase: "LOI Sent" }) },
                      { label: "UNDER CONTRACT", value: fmtVal(ucValue), count: all.filter(s => s.phase === "Under Contract" || s.phase === "Due Diligence").length, color: "#22C55E", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                      { label: "PROSPECT POOL", value: fmtVal(prospectValue), count: all.filter(s => s.phase === "Prospect" || s.phase === "Incoming" || s.phase === "Scored").length, color: "#3B82F6", action: () => navigateTo("summary", { phase: "Prospect" }) },
                    ].map(m => (
                      <div key={m.label} onClick={m.action} style={{ textAlign: "center", padding: "12px 8px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", cursor: "pointer", transition: "all 0.25s ease" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(255,255,255,0.07)`; e.currentTarget.style.borderColor = `${m.color}40`; e.currentTarget.style.transform = "translateY(-2px)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; e.currentTarget.style.transform = "translateY(0)"; }}
                      >
                        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Space Mono', monospace", color: m.color, lineHeight: 1 }}>{m.value}</div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(148,163,184,0.5)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4 }}>{m.label}</div>
                        <div style={{ fontSize: 10, color: "rgba(148,163,184,0.4)", marginTop: 2 }}>{m.count} site{m.count !== 1 ? "s" : ""}</div>
                      </div>
                    ))}
                  </div>

                  {/* Phase Distribution Mini Bars */}
                  <div style={{ padding: "14px 24px 0" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 40 }}>
                      {phaseGroups.map(g => (
                        <div key={g.label} onClick={g.count > 0 ? g.action : undefined} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: g.count > 0 ? "pointer" : "default", transition: "all 0.2s ease" }}
                          onMouseEnter={(e) => { if (g.count > 0) e.currentTarget.style.transform = "translateY(-2px)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 800, fontFamily: "'Space Mono', monospace", color: g.count > 0 ? g.color : "rgba(148,163,184,0.3)" }}>{g.count}</div>
                          <div style={{ width: "100%", height: Math.max(4, (g.count / maxPhaseCount) * 24), borderRadius: 3, background: g.count > 0 ? `linear-gradient(180deg, ${g.color}CC, ${g.color}66)` : "rgba(255,255,255,0.04)", transition: "all 0.5s ease" }} />
                          <div style={{ fontSize: 8, fontWeight: 600, color: "rgba(148,163,184,0.4)", textTransform: "uppercase" }}>{g.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recent Activity Feed */}
                  {recentMoves.length > 0 && (
                    <div style={{ padding: "16px 24px 20px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(148,163,184,0.5)", textTransform: "uppercase", letterSpacing: "0.1em" }}>RECENT ACTIVITY</div>
                        <div style={{ fontSize: 10, color: "rgba(148,163,184,0.4)" }}>Last 30 days</div>
                      </div>
                      <div style={{ maxHeight: 160, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(243,124,51,0.3) transparent" }}>
                        {recentMoves.slice(0, 10).map((m, idx) => (
                          <div key={m.name + idx + m.date} onClick={() => navigateTo(m.regionKey, { siteId: m.siteId })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer", borderRadius: 6, transition: "all 0.2s ease" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(243,124,51,0.06)"; e.currentTarget.style.paddingLeft = "8px"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.paddingLeft = "0"; }}
                          >
                            <span style={{ fontSize: 12 }}>{moveIcon(m.to)}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0" }}>{m.name} <span style={{ fontSize: 9, color: "rgba(148,163,184,0.5)" }}>({m.region})</span></div>
                              <div style={{ fontSize: 10, color: "rgba(148,163,184,0.6)" }}>{m.from} â {m.to}</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: advancePhases.includes(m.to) ? "rgba(34,197,94,0.1)" : m.to === "Dead" ? "rgba(220,38,38,0.1)" : "rgba(59,130,246,0.1)", color: advancePhases.includes(m.to) ? "#86EFAC" : m.to === "Dead" ? "#FCA5A5" : "#93C5FD", letterSpacing: "0.05em" }}>{moveLabel(m.to)}</span>
                              <div style={{ fontSize: 9, color: "rgba(148,163,184,0.35)", marginTop: 2 }}>{m.daysAgo === 0 ? "Today" : m.daysAgo === 1 ? "Yesterday" : `${m.daysAgo}d ago`}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* âââ PIPELINE FUNNEL â Interactive âââ */}
            {(() => {
              const all = [...sw, ...east];
              const pending = subs.filter(s => s.status === "pending").length;
              const funnelStages = [
                { label: "Review Queue", count: pending, color: "#F59E0B", icon: "â³", action: () => navigateTo("review") },
                { label: "Prospect", count: all.filter(s => s.phase === "Prospect" || s.phase === "Incoming" || s.phase === "Scored").length, color: "#3B82F6", icon: "ð", action: () => navigateTo("summary", { phase: "Prospect" }) },
                { label: "Submitted to Client", count: all.filter(s => s.phase === "Submitted to Client" || s.phase === "Client Revisions").length, color: "#6366F1", icon: "ð¤", action: () => navigateTo("summary", { phase: "Submitted to Client" }) },
                { label: "Client Approved", count: all.filter(s => s.phase === "Client Approved").length, color: "#8B5CF6", icon: "â", action: () => navigateTo("summary", { phase: "Client Approved" }) },
                { label: "LOI", count: all.filter(s => s.phase === "LOI Sent" || s.phase === "LOI Signed").length, color: "#F37C33", icon: "ð", action: () => navigateTo("summary", { phase: "LOI Sent" }) },
                { label: "PSA Sent", count: all.filter(s => s.phase === "PSA Sent").length, color: "#8B5CF6", icon: "📄", action: () => navigateTo("summary", { phase: "PSA Sent" }) },
                { label: "Under Contract", count: all.filter(s => s.phase === "Under Contract" || s.phase === "Due Diligence").length, color: "#16A34A", icon: "ð¤", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                { label: "Closed", count: all.filter(s => s.phase === "Closed").length, color: "#059669", icon: "ð", action: () => navigateTo("summary", { phase: "Closed" }) },
              ];
              const declined = all.filter(s => s.phase === "Client Declined" || s.phase === "Dead").length;
              return (
                <div className="card-reveal" style={{ background: "rgba(255,255,255,0.92)", borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: "0 2px 12px rgba(0,0,0,.05), 0 0 0 1px rgba(243,124,51,0.04)", backdropFilter: "blur(8px)", animationDelay: "0.6s", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, rgba(243,124,51,0.2), rgba(255,179,71,0.3), rgba(243,124,51,0.2), transparent)" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1a1a1a" }}>Pipeline Funnel</h3>
                    {declined > 0 && <span style={{ fontSize: 11, color: "#DC2626", fontWeight: 600 }}>{declined} declined/dead</span>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                    {funnelStages.map((stage, idx) => {
                      const widthPct = stage.count > 0 ? Math.max(25, 30 + (1 - idx / (funnelStages.length - 1)) * 70) : 25;
                      return (
                        <div key={stage.label} onClick={stage.count > 0 ? stage.action : undefined} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, cursor: stage.count > 0 ? "pointer" : "default" }}>
                          <div style={{ width: 90, fontSize: 10, fontWeight: 600, color: "#64748B", textAlign: "right", flexShrink: 0 }}>{stage.icon} {stage.label}</div>
                          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                            <div className={stage.count > 0 ? "funnel-bar" : ""} style={{
                              width: `${widthPct}%`,
                              background: stage.count > 0 ? `linear-gradient(135deg, ${stage.color}DD, ${stage.color}99)` : "#F1F5F9",
                              borderRadius: idx === 0 ? "10px 10px 6px 6px" : idx === funnelStages.length - 1 ? "6px 6px 10px 10px" : 6,
                              padding: "8px 12px",
                              display: "flex",
                              justifyContent: "center",
                              alignItems: "center",
                              transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)",
                              minHeight: 28,
                            }}>
                              <span style={{ fontSize: stage.count > 0 ? 16 : 12, fontWeight: 800, color: stage.count > 0 ? "#fff" : "#CBD5E1", fontFamily: "'Space Mono', monospace", position: "relative", zIndex: 1 }}>
                                {stage.count}
                              </span>
                            </div>
                          </div>
                          <div style={{ width: 50, fontSize: 10, color: "#94A3B8", flexShrink: 0 }}>
                            {stage.count > 0 ? "â" : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 10, color: "#94A3B8", textAlign: "center" }}>
                    Click any stage to navigate â sites flow left to right
                  </div>
                </div>
              );
            })()}

            {[{ label: "Daniel Wollent", data: sw, color: REGIONS.southwest.color, accent: REGIONS.southwest.accent, tabKey: "southwest" }, { label: "Matthew Toussaint", data: east, color: REGIONS.east.color, accent: REGIONS.east.accent, tabKey: "east" }].map((r) => {
              const total = r.data.length || 1;
              const phaseColors = ["#CBD5E1", "#94A3B8", "#3B82F6", "#6366F1", "#16A34A", "#D97706", "#DC2626", "#8B5CF6", "#A855F7", "#F59E0B", "#F37C33", "#16A34A", "#64748B"];
              return (
                <div key={r.label} onClick={() => navigateTo(r.tabKey)} className="site-card card-reveal funnel-bar" style={{ background: "rgba(255,255,255,0.92)", borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: "0 2px 12px rgba(0,0,0,.05), 0 0 0 1px rgba(243,124,51,0.04)", cursor: "pointer", backdropFilter: "blur(8px)", animationDelay: "0.7s", position: "relative", overflow: "hidden" }}>
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
            const PHASE_GROUPS = { "Prospect": ["Prospect", "Incoming", "Scored"], "LOI Sent": ["LOI Sent", "LOI Signed"], "PSA Sent": ["PSA Sent"], "Under Contract": ["Under Contract", "Due Diligence"], "Submitted to Client": ["Submitted to Client", "Client Revisions"] };
            const matchPhase = (sPhase) => filterPhase === "all" || sPhase === filterPhase || (PHASE_GROUPS[filterPhase] && PHASE_GROUPS[filterPhase].includes(sPhase));
            const d = raw.filter(s => (filterState === "all" || s.state === filterState) && matchPhase(s.phase));
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
                          <tr key={s.id} onClick={() => navigateTo(rk, { siteId: s.id })} style={{ background: (() => { const t = getSiteIQ(s).tier; return t === "gold" ? "#FFFDF5" : t === "steel" ? "#F8F9FE" : i % 2 ? "#FAFBFC" : "#fff"; })(), cursor: "pointer", transition: "background 0.15s", borderLeft: (() => { const t = getSiteIQ(s).tier; return t === "gold" ? "3px solid #C9A84C" : t === "steel" ? "3px solid #2C3E6B" : "3px solid transparent"; })() }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#FFF3E0")}
                            onMouseLeave={(e) => { const t = getSiteIQ(s).tier; e.currentTarget.style.background = t === "gold" ? "#FFFDF5" : t === "steel" ? "#F8F9FE" : i % 2 ? "#FAFBFC" : "#fff"; }}
                          >
                            <td style={{ ...td, textAlign: "center" }}><SiteIQBadge site={s} size="small" iq={getSiteIQ(s)} /></td>
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
                {pendingN > 0 && <button onClick={handleApproveAll} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#C9A84C,#1E2761)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(201,168,76,0.3)" }}>â Approve All ({pendingN})</button>}
                {subs.some((s) => s.status === "declined") && <button onClick={handleClearDeclined} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#991B1B", fontSize: 11, cursor: "pointer" }}>Clear Declined</button>}
              </div>
            </div>

            {/* ââ Assigned Sites Needing Review ââ */}
            {(() => {
              const allTracker = [...sw.map(s => ({ ...s, _region: "southwest" })), ...east.map(s => ({ ...s, _region: "east" }))];
              const needsReviewSites = allTracker.filter(s => s.assignedTo && s.needsReview);
              const byPerson = {};
              needsReviewSites.forEach(s => {
                if (!byPerson[s.assignedTo]) byPerson[s.assignedTo] = [];
                byPerson[s.assignedTo].push(s);
              });
              if (Object.keys(byPerson).length === 0) return null;
              return (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#92700C", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFD700, #C9A84C)", boxShadow: "0 0 8px rgba(201,168,76,0.5)", animation: "siteiq-glow 1.5s ease-in-out infinite alternate" }} />
                    Assigned for Review ({needsReviewSites.length})
                  </div>
                  {Object.entries(byPerson).map(([person, sites]) => (
                    <div key={person} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6, padding: "4px 10px", background: "#F8FAFC", borderRadius: 8, display: "inline-block", border: "1px solid #E2E8F0" }}>{person} ({sites.length})</div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {sites.map(site => (
                          <div key={site.id} style={{ background: "#fff", borderRadius: 12, padding: 14, boxShadow: "0 1px 4px rgba(0,0,0,.06)", borderLeft: "4px solid #C9A84C", transition: "all 0.3s" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: "#2C2C2C" }}>{site.name}</span>
                              <SiteIQBadge site={site} size="small" iq={getSiteIQ(site)} />
                              <span style={{ fontSize: 9, fontWeight: 700, color: "#92700C", background: "#FFFBEB", padding: "2px 8px", borderRadius: 5, border: "1px solid rgba(201,168,76,0.3)" }}>NEEDS REVIEW</span>
                            </div>
                            <div style={{ fontSize: 11, color: "#64748B", marginBottom: 4 }}>{site.address}, {site.city}, {site.state} {site.acreage ? `Â· ${site.acreage} ac` : ""} {site.askingPrice ? `Â· ${site.askingPrice}` : ""}</div>
                            <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 6 }}>Phase: {site.phase || "Prospect"} Â· Tracker: {site._region === "southwest" ? "DW" : "MT"}</div>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <button onClick={() => { updateSiteField(site._region, site.id, "needsReview", false); updateSiteField(site._region, site.id, "reviewedBy", person); updateSiteField(site._region, site.id, "reviewedAt", new Date().toISOString()); notify(`Reviewed: ${site.name}`); }} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #16A34A, #15803D)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(22,163,74,0.25)" }}>â Mark Reviewed</button>
                              <button onClick={() => navigateTo(site._region, { siteId: site.id })} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#475569", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s ease" }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "#FFF3E0"; e.currentTarget.style.borderColor = "#F37C33"; e.currentTarget.style.color = "#E65100"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#E2E8F0"; e.currentTarget.style.color = "#475569"; }}
                              >Open in Tracker â</button>
                              <button onClick={() => { updateSiteField(site._region, site.id, "assignedTo", ""); updateSiteField(site._region, site.id, "needsReview", false); notify(`Unassigned: ${site.name}`); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#991B1B", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Unassign</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <SortBar />
            {subs.length === 0 && [...sw, ...east].filter(s => s.assignedTo && s.needsReview).length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 14, padding: "40px 30px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>ð</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#475569", marginBottom: 6 }}>Review Queue Empty</div>
                <div style={{ fontSize: 12, color: "#94A3B8", maxWidth: 380, margin: "0 auto", lineHeight: 1.5 }}>Sites submitted via "Submit Site" or assigned to someone in a tracker appear here. Assign sites using the "Assign to..." dropdown on any site card.</div>
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
                        <span onClick={site.status === "approved" && site.region ? () => navigateTo(site.region, { siteId: site.id }) : undefined} style={{ fontSize: 15, fontWeight: 700, cursor: site.status === "approved" ? "pointer" : "default", transition: "color 0.2s" }}
                          onMouseEnter={(e) => { if (site.status === "approved") e.currentTarget.style.color = "#F37C33"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "inherit"; }}
                        >{site.name}</span>
                        <SiteIQBadge site={site} size="small" />
                        <Badge status={site.status} />
                        {site.status === "pending" && <button onClick={() => { const url = `${window.location.origin}${window.location.pathname}?review=${site.id}`; navigator.clipboard.writeText(url); notify("Link copied!"); }} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#64748B", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>ð Copy Link</button>}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748B", marginBottom: 2 }}>{site.address}, {site.city}, {site.state} {site.acreage ? `â¢ ${site.acreage} ac` : ""} {site.askingPrice ? `â¢ ${site.askingPrice}` : ""}</div>
                      {site.summary && <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4, lineHeight: 1.4, maxHeight: 40, overflow: "hidden" }}>{site.summary.substring(0, 200)}{site.summary.length > 200 ? "â¦" : ""}</div>}
                      {site.coordinates && <div style={{ fontSize: 10, marginBottom: 4 }}><a href={`https://www.google.com/maps?q=${site.coordinates}`} target="_blank" rel="noreferrer" style={{ color: "#3B82F6", textDecoration: "none" }}>ð Pin Drop</a></div>}
                      {site.status === "pending" ? (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F1F5F9" }}>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                            <select value={ri.routeTo || site.region || ""} onChange={(e) => setRI("routeTo", e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "2px solid #C9A84C", fontSize: 12, background: "#FFFBEB", cursor: "pointer", minWidth: 160, fontWeight: 700, color: "#92700C" }}>
                              <option value="">Route toâ¦</option>
                              <option value="southwest">â Daniel Wollent (DW)</option>
                              <option value="east">â Matthew Toussaint (MT)</option>
                            </select>
                            <select value={ri.reviewer || ""} onChange={(e) => setRI("reviewer", e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12, background: "#fff", cursor: "pointer", minWidth: 100 }}>
                              <option value="">Reviewerâ¦</option>
                              <option>Dan R</option>
                              <option>Daniel Wollent</option>
                              <option>Matthew Toussaint</option>
                            </select>
                            <input value={ri.note || ""} onChange={(e) => setRI("note", e.target.value)} placeholder="Review noteâ¦" style={{ flex: 1, minWidth: 140, padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12, outline: "none" }} />
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => { if (!ri.routeTo && !site.region) { notify("Select route (DW or MT)"); return; } handleApprove(site.id); setHighlightedSite(null); }} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#C9A84C,#1E2761)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(201,168,76,0.3)" }}>â Approve & Route</button>
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
    </div>
  );
}
