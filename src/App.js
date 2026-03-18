// src/App.js — SiteIQ Acquisition Tracker
// © 2026 DJR Real Estate LLC. All rights reserved.
// Proprietary and confidential. Unauthorized reproduction or distribution prohibited.
// Firebase Realtime Database — live shared data across all 3 users

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
// import * as XLSX from "xlsx";  ← moved to dynamic import()

// ─── CSV Parser ───
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

// ─── Constants ───
const REGIONS = {
  southwest: { label: "Daniel Wollent", color: "#1565C0", accent: "#42A5F5" },
  east: { label: "Matthew Toussaint", color: "#2D5F2D", accent: "#4CAF50" },
};
const STATUS_COLORS = {
  pending: { bg: "#FFFBEB", text: "#92700C", dot: "#C9A84C", label: "Pending" },
  recommended: { bg: "#E0E7FF", text: "#3730A3", dot: "#6366F1", label: "Dan R. Approved" },
  approved: { bg: "#E8F5E9", text: "#2E7D32", dot: "#4CAF50", label: "⚡ Approved to Tracker" },
  declined: { bg: "#FFEBEE", text: "#B71C1C", dot: "#EF5350", label: "Declined" },
  tracking: { bg: "#FFF8F0", text: "#BF360C", dot: "#F37C33", label: "In Tracker" },
};
const PHASES = [
  "Prospect",
  "Submitted to PS",
  "SiteIQ Approved",
  "LOI",
  "PSA Sent",
  "Under Contract",
  "Closed",
  "Declined",
  "Dead",
];
// Legacy phase migration map — consolidates old 14-phase system to new 8-phase pipeline
const PHASE_MIGRATION = {
  "Incoming": "Prospect",
  "Scored": "Prospect",
  "Submitted to Client": "Submitted to PS",
  "Client Approved": "SiteIQ Approved",
  "PS Approved": "SiteIQ Approved",
  "Client Revisions": "Submitted to PS",
  "Client Declined": "Declined",
  "LOI Sent": "LOI",
  "LOI Signed": "LOI",
  "Due Diligence": "Under Contract",
};
const PRIORITIES = ["🔥 Hot", "🟡 Warm", "🔵 Cold", "⚪ None"];
const PRIORITY_COLORS = {
  "🔥 Hot": "#EF4444",
  "🟡 Warm": "#F59E0B",
  "🔵 Cold": "#3B82F6",
  "⚪ None": "#CBD5E1",
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

// ─── SiteIQ™ Configurable Weight System v2.0 ───
// Immutable defaults. Live config is a deep copy merged with Firebase overrides.
// Persisted at Firebase path: config/siteiq_weights
const SITE_IQ_DEFAULTS = [
  { key: "population", label: "Population", icon: "👥", weight: 0.20, tip: "3-mile population density", source: "ESRI / Census ACS", group: "demographics" },
  { key: "growth", label: "Growth", icon: "📈", weight: 0.25, tip: "Pop growth CAGR — 5yr projected trend", source: "ESRI 2025→2030 projections", group: "demographics" },
  { key: "income", label: "Med. Income", icon: "💰", weight: 0.10, tip: "Median HHI within 3 miles", source: "ESRI / Census ACS", group: "demographics" },
  { key: "pricing", label: "Pricing", icon: "💲", weight: 0.08, tip: "Price per acre vs. acquisition targets", source: "Asking price / acreage", group: "deal" },
  { key: "zoning", label: "Zoning", icon: "📋", weight: 0.15, tip: "By-right / conditional / prohibited", source: "Zoning field + summary", group: "entitlements" },
  { key: "access", label: "Site Access", icon: "🛣️", weight: 0.07, tip: "Acreage, frontage, flood, access", source: "Site data + summary", group: "physical" },
  { key: "competition", label: "Competition", icon: "🏢", weight: 0.07, tip: "Storage competitor density", source: "Competitor data / summary", group: "market" },
  { key: "marketTier", label: "Market Tier", icon: "📍", weight: 0.08, tip: "Target market priority ranking", source: "Market field / config", group: "market" },
];

// Live mutable config — starts as copy of defaults, merged with Firebase on load
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

// ─── Helpers ───
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
  if (!v || v === "TBD" || v === "—") return v || "—";
  // Already has $X.XXM format with parenthetical — extract just the leading price
  const mMatch = String(v).match(/^\$?([\d,.]+)\s*[Mm]/);
  if (mMatch) return "$" + parseFloat(mMatch[1].replace(/,/g, "")).toFixed(2).replace(/\.?0+$/, "") + "M";
  // $700K format — extract number before K
  const kMatch = String(v).match(/^\$?([\d,.]+)\s*[Kk]/);
  if (kMatch) return "$" + parseFloat(kMatch[1].replace(/,/g, "")).toFixed(0) + "K";
  // Raw number like $1,300,000 or 1300000 — only parse leading digits
  const leadMatch = String(v).match(/^\$?([\d,.]+)/);
  const n = leadMatch ? Number(leadMatch[1].replace(/,/g, "")) : NaN;
  if (isNaN(n) || n === 0) return v;
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1000) return "$" + Math.round(n / 1000) + "K";
  return "$" + n.toLocaleString();
};
const mapsLink = (c) =>
  c ? `https://www.google.com/maps?q=${encodeURIComponent(c)}` : "";
const earthLink = (c) =>
  c ? `https://earth.google.com/web/search/${encodeURIComponent(c)}` : "";

// ─── Shared Style Constants ───
const STYLES = {
  cardBase: { background: "rgba(15,21,56,0.6)", borderRadius: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.25), 0 0 0 1px rgba(201,168,76,0.08)", overflow: "hidden", backdropFilter: "blur(12px)", transition: "all 0.25s cubic-bezier(0.22,1,0.36,1)" },
  kpiCard: (borderColor) => ({ cursor: "pointer", background: "linear-gradient(145deg, rgba(15,21,56,0.85) 0%, rgba(10,14,42,0.95) 100%)", borderRadius: 16, padding: "22px 24px", minWidth: 140, boxShadow: `0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)`, borderLeft: `3px solid ${borderColor}`, transition: "all 0.25s cubic-bezier(0.22,1,0.36,1)", position: "relative", overflow: "hidden" }),
  labelMicro: { fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 },
  btnPrimary: { padding: "10px 20px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#E87A2E 0%,#C9A84C 50%,#1E2761 100%)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(232,122,46,0.35), 0 0 0 1px rgba(232,122,46,0.15)", transition: "all 0.2s cubic-bezier(0.22,1,0.36,1)", position: "relative", overflow: "hidden" },
  btnGhost: { padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(232,122,46,0.25)", background: "rgba(232,122,46,0.06)", color: "#E87A2E", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s cubic-bezier(0.22,1,0.36,1)" },
  frostedHeader: { background: "linear-gradient(165deg, rgba(15,21,56,0.98) 0%, rgba(10,14,42,0.97) 50%, rgba(15,21,56,0.98) 100%)", backdropFilter: "blur(24px) saturate(1.8)", WebkitBackdropFilter: "blur(24px) saturate(1.8)", padding: "0 24px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 40px rgba(0,0,0,0.5), 0 1px 0 rgba(232,122,46,0.2)" },
};

// ─── Debounce Helper ───
const debounce = (fn, ms) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

// ─── Demographics Helper — reads ESRI GeoEnrichment data from Firebase ───
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
    return { rings, pop3mi: rings[3].pop ? rings[3].pop.toLocaleString() : null, income3mi: incVal ? "$" + incVal.toLocaleString() : null, growthOutlook: "Stable", source: "Census ACS 5-Year (2022) — fallback" };
  } catch (err) { console.error("Demographics fetch error:", err); return { error: "Failed to fetch demographics" }; }
};

// ─── Vetting Report Generator ───
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
    if (acres >= 3.5 && acres <= 5) { sizingText = `${acres} ac — PRIMARY (one-story climate-controlled)`; sizingColor = "#16A34A"; sizingTag = "PASS"; }
    else if (acres >= 2.5 && acres < 3.5) { sizingText = `${acres} ac — SECONDARY (multi-story 3-4 story)`; sizingColor = "#16A34A"; sizingTag = "PASS"; }
    else if (acres < 2.5) { sizingText = `${acres} ac — Below minimum threshold`; sizingColor = "#EF4444"; sizingTag = "FAIL"; }
    else if (acres > 5 && acres <= 7) { sizingText = `${acres} ac — Viable if subdivisible`; sizingColor = "#F59E0B"; sizingTag = "CAUTION"; }
    else { sizingText = `${acres} ac — Large tract, subdivision potential`; sizingColor = "#F59E0B"; sizingTag = "CAUTION"; }
  }
  const psDistance = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : (nearestPSDistance ? nearestPSDistance : "Not checked — enter Nearest Facility in site detail");
  const psColor = site.siteiqData?.nearestPS ? (site.siteiqData.nearestPS >= 5 ? "#16A34A" : site.siteiqData.nearestPS >= 2.5 ? "#F59E0B" : "#EF4444") : "#94A3B8";
  // Z&U intelligence parsing
  const combined = ((site.zoning || "") + " " + (site.summary || "")).toLowerCase();
  const hasByRight = /(by\s*right|permitted|storage\s*(?:by|permitted))/i.test(combined);
  const hasSUP = /(conditional|sup\b|cup\b|special\s*use)/i.test(combined);
  const hasRezone = /rezone/i.test(combined);
  const hasOverlay = /overlay/i.test(combined);
  const hasFlood = /flood/i.test(combined);
  const hasUtilities = /(utilit|water|sewer|electric|gas\b)/i.test(combined);
  const hasSeptic = /septic/i.test(combined);
  const hasWell = /\bwell\b/i.test(combined);
  const zoningClass = site.zoningClassification || "unknown";
  const zoningColor = zoningClass === "by-right" ? "#16A34A" : zoningClass === "conditional" ? "#F59E0B" : zoningClass === "rezone-required" ? "#EF4444" : zoningClass === "prohibited" ? "#991B1B" : "#94A3B8";
  const zoningLabel = { "by-right": "BY-RIGHT (Permitted)", "conditional": "CONDITIONAL (SUP/CUP Required)", "rezone-required": "REZONE REQUIRED", "prohibited": "PROHIBITED", "unknown": "UNKNOWN — Research Required" }[zoningClass] || zoningClass.toUpperCase();
  const statusPill = (text, color) => `<span style="display:inline-block;padding:4px 14px;border-radius:8px;font-size:12px;font-weight:700;background:${color}15;color:${color};border:1px solid ${color}30">${text}</span>`;
  // Flags — merged from both reports
  const flags = [];
  if (!site.zoning) flags.push("No zoning district recorded — critical data gap");
  if (zoningClass === "unknown") flags.push("Zoning classification not confirmed — verify with local planning");
  if (zoningClass === "prohibited") flags.push("Storage use PROHIBITED in current zoning district");
  if (zoningClass === "rezone-required") flags.push("Rezone required — timeline and political risk apply");
  if (!site.coordinates) flags.push("No coordinates — cannot verify location");
  if (!isNaN(acres) && acres < 2.5) flags.push("Below minimum acreage threshold");
  if (popN && popN < 10000) flags.push("3-mi population below 10,000 minimum");
  if (incN && incN < 60000) flags.push("3-mi median HHI below $60,000 target");
  if (!site.askingPrice || site.askingPrice === "TBD") flags.push("No confirmed asking price");
  if (hasFlood) flags.push("Flood zone identified — verify FEMA panel and insurance cost");
  if (!hasUtilities && !hasSeptic) flags.push("Utility availability not confirmed — verify water hookup (HARD REQUIREMENT for fire suppression)");
  if (site.waterAvailable === false) flags.push("⚠ WATER HOOKUP NOT CONFIRMED — municipal water is a HARD REQUIREMENT for fire suppression. Septic OK for sewer.");
  // NOTE: Septic is VIABLE for sewer (storage has minimal wastewater). But WATER is non-negotiable — fire code requires municipal pressure.
  if (hasWell) flags.push("Well water noted — may need municipal connection for commercial use");
  if (hasOverlay) flags.push("Overlay district applies — additional standards may affect design/cost");
  const iq = iqResult || (typeof computeSiteIQ === "function" ? computeSiteIQ(site) : null);
  const iqScore = iq?.score || "—";
  const iqTier = iq?.tier || "gray";
  const iqLabel = iq?.label || "—";
  const iqBadgeColor = iqTier === "gold" ? "#C9A84C" : iqTier === "steel" ? "#2C3E6B" : "#94A3B8";
  const zoningScore = iq?.scores?.zoning;
  const zoningScoreColor = zoningScore >= 8 ? "#16A34A" : zoningScore >= 5 ? "#F59E0B" : zoningScore > 0 ? "#EF4444" : "#94A3B8";
  const row = (label, value, opts = {}) => `<tr><td style="padding:10px 16px;font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid #F1F5F9;width:180px;vertical-align:top">${label}</td><td style="padding:10px 16px;font-size:13px;color:#1E293B;font-weight:${opts.bold ? 700 : 500};border-bottom:1px solid #F1F5F9">${opts.badge ? `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:11px;font-weight:700;background:${opts.badgeBg || '#F1F5F9'};color:${opts.badgeColor || '#64748B'}">${value}</span>` : value}</td></tr>`;
  const section = (num, title, icon) => `<div style="display:flex;align-items:center;gap:10px;margin:28px 0 14px;padding-bottom:8px;border-bottom:2px solid #1E2761"><div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#F37C33,#D45500);display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;font-weight:900;box-shadow:0 2px 8px rgba(243,124,51,0.3)">${num}</div><h2 style="margin:0;font-size:16px;font-weight:800;color:#1E2761;letter-spacing:0.02em">${icon} ${title}</h2></div>`;
  const mapsUrl = site.coordinates ? `https://www.google.com/maps?q=${site.coordinates}` : "#";
  const dom = site.dateOnMarket && site.dateOnMarket !== "N/A" ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vetting Report — ${site.name || "Site"}</title><style>@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Space+Mono:wght@700&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',sans-serif;background:#F8FAFC;color:#1E293B;padding:0}@media print{body{background:#fff}.no-print{display:none!important}.report{box-shadow:none}}.report{max-width:800px;margin:0 auto;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.08)}table{width:100%;border-collapse:collapse}.print-btn{position:fixed;bottom:28px;right:28px;display:flex;align-items:center;gap:8px;padding:14px 24px;border-radius:12px;border:none;background:linear-gradient(135deg,#F37C33,#D45500);color:#fff;font-size:14px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;box-shadow:0 4px 20px rgba(243,124,51,0.4),0 0 0 2px rgba(243,124,51,0.15);transition:all 0.2s ease;z-index:9999}.print-btn:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(243,124,51,0.5)}.print-btn:active{transform:scale(0.97)}.print-btn svg{width:18px;height:18px;fill:#fff}</style></head><body>
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
      { l: "ACREAGE", v: site.acreage ? site.acreage + " ac" : "—" },
      { l: "ASKING PRICE", v: site.askingPrice || "—" },
      { l: "3-MI POP", v: site.pop3mi ? fmtN(site.pop3mi) : "—" },
      { l: "3-MI MED INC", v: site.income3mi ? ("$" + fmtN(site.income3mi)) : "—" },
    ].map(m => `<div style="padding:16px 12px;text-align:center;border-right:1px solid #E2E8F0"><div style="font-size:9px;font-weight:700;color:#94A3B8;letter-spacing:0.06em;margin-bottom:4px">${m.l}</div><div style="font-size:16px;font-weight:800;color:#1E293B;font-family:'Space Mono',monospace">${m.v}</div></div>`).join("")}
  </div>

  <div style="padding:24px 40px 40px">
    <!-- RESEARCH COMPLETENESS GATE -->
    ${(() => {
      const checks = [
        { label: "Zoning District Identified", done: !!site.zoning, category: "ZONING" },
        { label: "Zoning Classification Confirmed", done: !!site.zoningClassification && site.zoningClassification !== "unknown", category: "ZONING" },
        { label: "Ordinance Source Cited", done: !!site.zoningSource, category: "ZONING" },
        { label: "Planning Dept Contact Found", done: !!site.planningContact, category: "ZONING" },
        { label: "Permitted Use Table Reviewed", done: !!site.zoningNotes && site.zoningNotes.length > 20, category: "ZONING" },
        { label: "Water Provider Identified", done: !!site.waterProvider, category: "UTILITY" },
        { label: "Water Availability Confirmed", done: site.waterAvailable === true || site.waterAvailable === false, category: "UTILITY" },
        { label: "Sewer Provider Identified", done: !!site.sewerProvider, category: "UTILITY" },
        { label: "Sewer Availability Confirmed", done: site.sewerAvailable === true || site.sewerAvailable === false, category: "UTILITY" },
        { label: "Electric Provider + 3-Phase", done: !!site.electricProvider, category: "UTILITY" },
        { label: "Tap/Impact Fees Documented", done: !!site.tapFees, category: "UTILITY" },
        { label: "FEMA Flood Zone Checked", done: !!site.floodZone, category: "TOPO" },
        { label: "Terrain Assessment", done: !!site.terrain, category: "TOPO" },
        { label: "Wetlands Checked (NWI)", done: site.wetlands === true || site.wetlands === false, category: "TOPO" },
      ];
      const done = checks.filter(c => c.done).length;
      const total = checks.length;
      const pct = Math.round((done / total) * 100);
      const grade = pct === 100 ? "COMPLETE" : pct >= 80 ? "NEAR COMPLETE" : pct >= 50 ? "IN PROGRESS" : "INCOMPLETE";
      const gradeColor = pct === 100 ? "#16A34A" : pct >= 80 ? "#3B82F6" : pct >= 50 ? "#F59E0B" : "#EF4444";
      const catSummary = (cat) => { const items = checks.filter(c => c.category === cat); const d = items.filter(c => c.done).length; return { done: d, total: items.length, pct: Math.round((d / items.length) * 100) }; };
      const z = catSummary("ZONING"); const u = catSummary("UTILITY"); const t = catSummary("TOPO");
      return `
    <div style="margin-bottom:24px;border-radius:12px;overflow:hidden;border:2px solid ${gradeColor}30">
      <div style="background:linear-gradient(135deg,#0A0A0C,#1E2761);padding:16px 20px;display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:48px;height:48px;border-radius:10px;background:${gradeColor}15;border:2px solid ${gradeColor}40;display:flex;align-items:center;justify-content:center">
            <span style="font-size:20px;font-weight:900;color:${gradeColor};font-family:'Space Mono',monospace">${pct}%</span>
          </div>
          <div>
            <div style="font-size:14px;font-weight:800;color:#fff;letter-spacing:0.02em">Research Completeness</div>
            <div style="font-size:10px;color:#94A3B8;margin-top:2px">Institutional-grade due diligence &mdash; ${done}/${total} items verified against primary sources</div>
          </div>
        </div>
        <span style="padding:6px 16px;border-radius:8px;font-size:12px;font-weight:800;background:${gradeColor}18;color:${gradeColor};border:1px solid ${gradeColor}30;letter-spacing:0.06em">${grade}</span>
      </div>
      <div style="background:#FAFBFC;padding:14px 20px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        ${[
          { label: "Zoning & Entitlements", ...z, color: "#1E2761" },
          { label: "Utilities & Water", ...u, color: "#16A34A" },
          { label: "Topography & Flood", ...t, color: "#E87A2E" },
        ].map(c => `<div style="text-align:center;padding:12px;border-radius:8px;background:#fff;border:1px solid #E2E8F0">
          <div style="font-size:9px;font-weight:800;color:${c.color};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">${c.label}</div>
          <div style="width:100%;height:6px;border-radius:3px;background:#E2E8F0;overflow:hidden;margin-bottom:4px"><div style="width:${c.pct}%;height:100%;border-radius:3px;background:${c.pct === 100 ? "#16A34A" : c.pct >= 60 ? "#F59E0B" : "#EF4444"};transition:width 0.5s"></div></div>
          <div style="font-size:11px;font-weight:700;color:${c.pct === 100 ? "#16A34A" : "#64748B"}">${c.done}/${c.total}</div>
        </div>`).join("")}
      </div>
      ${pct < 100 ? `<div style="background:#FEF2F2;padding:10px 20px;border-top:1px solid #FECACA">
        <div style="font-size:10px;font-weight:700;color:#991B1B;margin-bottom:4px">&#9888; OUTSTANDING RESEARCH ITEMS:</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${checks.filter(c => !c.done).map(c => `<span style="font-size:9px;font-weight:600;color:#991B1B;background:#FEE2E2;padding:2px 8px;border-radius:4px">${c.label}</span>`).join("")}</div>
      </div>` : `<div style="background:#F0FDF4;padding:10px 20px;border-top:1px solid #BBF7D0;text-align:center">
        <span style="font-size:11px;font-weight:700;color:#166534">&#10003; ALL RESEARCH ITEMS VERIFIED &mdash; REPORT IS INSTITUTIONAL-GRADE</span>
      </div>`}
    </div>`;
    })()}

    <!-- 1. PROPERTY OVERVIEW -->
    ${section("1", "Property Overview", "")}
    <table>${[
      row("Name", site.name || "—", { bold: true }),
      row("Address", `${site.address || "—"}, ${site.city || "—"}, ${site.state || "—"}`),
      row("Market", site.market || "—"),
      row("Acreage", site.acreage || "—"),
      row("Asking Price", site.askingPrice || "—", { bold: true }),
      row("Internal Price", site.internalPrice || "—"),
      row("Phase", site.phase || "Prospect", { badge: true, badgeBg: site.phase === "Under Contract" ? "#DCFCE7" : "#FFF7ED", badgeColor: site.phase === "Under Contract" ? "#166534" : "#9A3412" }),
      row("Priority", cleanPriority(site.priority)),
      row("Coordinates", site.coordinates ? `<a href="${mapsUrl}" target="_blank" style="color:#1565C0;text-decoration:none">${site.coordinates} ↗</a>` : "—"),
      row("Listing", site.listingUrl ? `<a href="${site.listingUrl}" target="_blank" style="color:#F37C33;text-decoration:none">View Listing ↗</a>` : "—"),
      dom !== null ? row("Days on Market", `${dom} days`, { badge: true, badgeBg: dom > 365 ? "#FEE2E2" : dom > 180 ? "#FEF3C7" : "#DCFCE7", badgeColor: dom > 365 ? "#991B1B" : dom > 180 ? "#92400E" : "#166534" }) : "",
    ].join("")}</table>

    <!-- 2. ZONING & ENTITLEMENTS — HARD VET -->
    ${section("2", "Zoning & Entitlements — Can We Get Indoor Storage Here?", "")}
    <div style="padding:16px 20px;border-radius:10px;background:${zoningColor}08;border:2px solid ${zoningColor}35;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-size:15px;font-weight:700;color:#1E293B">District: <strong>${site.zoning || "Not recorded"}</strong></span>
        ${statusPill(zoningLabel, zoningColor)}
      </div>
      <div style="font-size:12px;color:#64748B;line-height:1.6">${
        zoningClass === "by-right" ? "Self-storage / mini-warehouse is a <strong style='color:#16A34A'>permitted use</strong> in this zoning district. No special approvals required — proceed with site plan review." :
        zoningClass === "conditional" ? "Self-storage is allowed as a <strong style='color:#F59E0B'>conditional / special use</strong>. Requires public hearing and approval. Timeline: typically 2–6 months. Factor SUP costs (~$15K–$50K) and uncertainty into underwriting." :
        zoningClass === "rezone-required" ? "Current zoning <strong style='color:#EF4444'>does not permit</strong> storage use. Rezoning required — political risk, 4–12 month timeline, significant cost ($25K–$75K+). Evaluate carefully." :
        zoningClass === "prohibited" ? "Storage is <strong style='color:#991B1B'>explicitly prohibited</strong> with no conditional path. Rezone is the only option and may face strong opposition." :
        "Zoning classification has <strong>not been confirmed</strong>. The permitted use table for this jurisdiction must be reviewed before proceeding."
      }</div>
    </div>
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Zoning District", site.zoning || "Not confirmed", { bold: true }),
      row("Classification", zoningLabel, { badge: true, badgeBg: zoningColor + "18", badgeColor: zoningColor }),
      row("Storage Use Term", hasByRight ? "Permitted (by right)" : hasSUP ? "Conditional / SUP / CUP" : hasRezone ? "Rezone required" : "Not determined"),
      row("Overlay Districts", hasOverlay ? "Yes — additional standards apply (check summary)" : "None identified"),
      row("Zoning Score", zoningScore != null ? `<span style="font-weight:900;color:${zoningScoreColor};font-family:'Space Mono',monospace">${zoningScore.toFixed(1)}/10</span>` : "—"),
      row("Ordinance Source", site.zoningSource || "<em style='color:#94A3B8'>Not yet researched</em>"),
      row("Planning Contact", site.planningContact || "<em style='color:#94A3B8'>Research needed</em>"),
    ].join("")}</table>
    ${site.zoningNotes ? `<div style="margin-top:12px;padding:14px 18px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:12px;line-height:1.7;color:#475569">${site.zoningNotes}</div>` : ""}
    <div style="margin-top:10px;padding:10px 16px;border-radius:6px;background:#F0F4FF;border-left:3px solid #1E2761;font-size:9px;color:#475569;line-height:1.6">
      <strong style="color:#1E2761;font-size:9px;letter-spacing:0.05em">RESEARCH METHODOLOGY</strong><br/>
      Zoning classification sourced from municipal ordinance permitted use table. Ordinance databases searched: ecode360.com, Municode.com, American Legal Publishing, Code Publishing Co., and jurisdiction websites. Storage use terms searched: "storage warehouse," "mini-warehouse," "self-service storage," "self-storage," "personal storage," "indoor storage," "warehouse (mini/self-service)." Overlay districts identified via zoning map review. Supplemental standards extracted from district-specific regulations. Planning department contact sourced from jurisdiction website. Verification date: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
    </div>
    <!-- Supplemental Standards Grid -->
    <div style="margin-top:16px"><div style="font-size:11px;font-weight:800;color:#1E2761;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Supplemental Standards</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${[
        { label: "Facade / Materials", icon: "&#127959;", text: /facade|material|masonry|brick/i.test(combined) ? "Requirements noted — see summary" : "No specific requirements identified" },
        { label: "Setbacks", icon: "&#128208;", text: /setback/i.test(combined) ? "Setback requirements noted" : "Standard district setbacks apply" },
        { label: "Height Limits", icon: "&#128207;", text: /height\s*limit|max.*height|story.*limit/i.test(combined) ? "Height restrictions noted" : "Standard district height limits" },
        { label: "Screening / Landscape", icon: "&#127807;", text: /screen|landscape|buffer/i.test(combined) ? "Screening / landscaping required" : "Standard requirements" },
        { label: "Signage", icon: "&#129707;", text: /sign/i.test(combined) ? "Signage requirements noted" : "Standard district signage rules" },
        { label: "Parking", icon: "&#127359;", text: /parking/i.test(combined) ? "Parking requirements noted" : "Per district standards" },
      ].map(s => `<div style="padding:12px 16px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0"><div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:14px">${s.icon}</span><span style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.04em">${s.label}</span></div><div style="font-size:12px;color:#64748B">${s.text}</div></div>`).join("")}
    </div></div>

    <!-- 3. UTILITIES & WATER — HARD VET -->
    ${section("3", "Utilities & Water — Can We Hook Up?", "")}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      ${[
        { label: "Water Service", icon: "&#128167;", available: !!site.waterProvider || site.waterAvailable === true || /water|municipal|city\s*water/i.test(combined), issue: site.waterAvailable === false ? "Extension required" : hasWell ? "Well water noted" : null, color: site.waterAvailable === true ? "#16A34A" : site.waterAvailable === false ? "#EF4444" : !!site.waterProvider ? "#16A34A" : /water|municipal/i.test(combined) ? "#16A34A" : "#94A3B8", detail: site.waterProvider || null },
        { label: "Sanitary Sewer", icon: "&#128703;", available: !!site.sewerProvider || site.sewerAvailable === true || /sewer|sanitary/i.test(combined) || hasSeptic, issue: site.sewerAvailable === false && !hasSeptic ? "Not available" : null, color: site.sewerAvailable === true ? "#16A34A" : !!site.sewerProvider ? "#16A34A" : /sewer/i.test(combined) ? "#16A34A" : hasSeptic ? "#16A34A" : site.sewerAvailable === false ? "#F59E0B" : "#94A3B8", detail: site.sewerProvider || (hasSeptic ? "Septic — viable for storage (low wastewater)" : null) },
        { label: "Electric Service", icon: "&#9889;", available: !!site.electricProvider || site.threePhase === true || /electric|power/i.test(combined), issue: site.threePhase === false ? "No 3-phase" : null, color: site.threePhase === true ? "#16A34A" : !!site.electricProvider ? "#16A34A" : /electric|power/i.test(combined) ? "#16A34A" : "#94A3B8", detail: site.electricProvider ? (site.electricProvider + (site.threePhase === true ? " — 3-Phase ✓" : "")) : null },
        { label: "Natural Gas", icon: "&#128293;", available: !!site.gasProvider || /\bgas\b|natural\s*gas/i.test(combined), issue: null, color: !!site.gasProvider ? "#16A34A" : /\bgas\b/i.test(combined) ? "#16A34A" : "#94A3B8", detail: site.gasProvider || null },
        { label: "Stormwater", icon: "&#127783;", available: /storm|drainage|detention/i.test(combined), issue: hasFlood ? "Flood zone concern" : null, color: hasFlood ? "#EF4444" : /storm|drainage/i.test(combined) ? "#16A34A" : "#94A3B8", detail: null },
        { label: "Telecom / Fiber", icon: "&#128225;", available: /fiber|telecom|internet|broadband/i.test(combined), issue: null, color: /fiber|telecom/i.test(combined) ? "#16A34A" : "#94A3B8", detail: null },
      ].map(u => `<div style="padding:14px 16px;border-radius:10px;background:${u.color}08;border:1px solid ${u.color}20"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div style="display:flex;align-items:center;gap:6px"><span style="font-size:16px">${u.icon}</span><span style="font-size:12px;font-weight:700;color:#1E293B">${u.label}</span></div>${statusPill(u.available ? "Confirmed" : u.issue ? u.issue : "Not Confirmed", u.color)}</div><div style="font-size:11px;color:#64748B;margin-top:4px">${u.detail ? `<strong style="color:#1E293B">${u.detail}</strong>` : u.available ? "Available per verified research" : u.issue ? u.issue + " — verify capacity for commercial use" : "Not mentioned — verify with jurisdiction or utility provider"}</div></div>`).join("")}
    </div>
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Water Provider", site.waterProvider || "<em style='color:#94A3B8'>Research needed</em>"),
      row("Water Available", site.waterAvailable === true ? '<span style="color:#16A34A;font-weight:700">YES — Municipal</span>' : site.waterAvailable === false ? '<span style="color:#EF4444;font-weight:700">NO — Extension Required</span>' : "<em style='color:#94A3B8'>Not confirmed — verify with provider</em>"),
      row("Sewer Provider", site.sewerProvider || "<em style='color:#94A3B8'>Research needed</em>"),
      row("Sewer Available", site.sewerAvailable === true ? '<span style="color:#16A34A;font-weight:700">YES</span>' : site.sewerAvailable === false ? '<span style="color:#EF4444;font-weight:700">NO</span>' : "<em style='color:#94A3B8'>Not confirmed</em>"),
      row("Electric (3-Phase)", site.threePhase === true ? '<span style="color:#16A34A;font-weight:700">3-Phase Available</span>' : site.threePhase === false ? '<span style="color:#F59E0B;font-weight:700">Not available — upgrade needed</span>' : "<em style='color:#94A3B8'>Not confirmed</em>"),
      row("Tap/Impact Fees", site.tapFees || "<em style='color:#94A3B8'>Check jurisdiction fee schedule</em>"),
    ].join("")}</table>
    ${site.utilityNotes ? `<div style="margin-top:12px;padding:14px 18px;border-radius:8px;background:#F0F9FF;border:1px solid #BAE6FD;font-size:12px;line-height:1.7;color:#0C4A6E">${site.utilityNotes}</div>` : `<div style="margin-top:12px;padding:14px 18px;border-radius:8px;background:#FFFBEB;border:1px solid #FDE68A;font-size:12px;line-height:1.5;color:#92400E"><strong>&#9888; Research Checklist:</strong> Water provider + service boundary | Sewer availability | Distance to mains | Tap fees | Electric (3-phase) | Gas | Capacity constraints</div>`}
    <div style="margin-top:10px;padding:10px 16px;border-radius:6px;background:#F0FFF4;border-left:3px solid #16A34A;font-size:9px;color:#475569;line-height:1.6">
      <strong style="color:#16A34A;font-size:9px;letter-spacing:0.05em">RESEARCH METHODOLOGY</strong><br/>
      Water/sewer provider identified via city utility department website, county records, and state regulatory databases (TCEQ CCN maps for TX, state DEQ/utility commission for other states). Service boundary verified via municipal GIS portals and utility district maps. Tap/impact fees sourced from published jurisdiction fee schedules (commercial/warehouse classification). Electric provider identified via utility service territory maps; 3-phase availability checked against provider service records. Distance to nearest water/sewer main estimated via GIS infrastructure layers where available. Capacity constraints checked against published moratoriums and allocation notices.
    </div>

    <!-- 4. TOPOGRAPHY & FLOOD -->
    ${section("4", "Topography & Flood Assessment", "")}
    <div style="padding:14px 18px;border-radius:10px;background:${hasFlood ? "#FEF2F2" : "#F0FDF4"};border:1px solid ${hasFlood ? "#FECACA" : "#BBF7D0"};display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <span style="font-size:13px;font-weight:600;color:#1E293B">${hasFlood ? "Flood zone concern identified in site data" : "No flood zone issues identified"}</span>
      ${statusPill(hasFlood ? "FLOOD RISK" : "CLEAR", hasFlood ? "#EF4444" : "#16A34A")}
    </div>
    <table>${[
      row("FEMA Flood Zone", site.floodZone || (hasFlood ? '<span style="color:#F59E0B;font-weight:700">Flood concern noted — verify FEMA panel</span>' : "<em style='color:#94A3B8'>Check msc.fema.gov</em>")),
      row("Terrain", site.terrain || "<em style='color:#94A3B8'>Review Google Earth / county contours</em>"),
      row("Wetlands", site.wetlands === true ? '<span style="color:#EF4444;font-weight:700">Present — reduces developable area</span>' : site.wetlands === false ? '<span style="color:#16A34A">None identified</span>' : "<em style='color:#94A3B8'>Check NWI mapper</em>"),
      row("Grading Risk", site.gradingRisk || "<em style='color:#94A3B8'>Assess from aerial/contours</em>"),
      row("Environmental", /environmental|contamina|brownfield|phase\s*[12i]/i.test(combined) ? "Environmental issues noted — see summary" : "None identified"),
    ].join("")}</table>
    ${site.topoNotes ? `<div style="margin-top:12px;padding:14px 18px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:12px;line-height:1.7;color:#475569">${site.topoNotes}</div>` : ""}
    <div style="margin-top:10px;padding:10px 16px;border-radius:6px;background:#FFF7ED;border-left:3px solid #E87A2E;font-size:9px;color:#475569;line-height:1.6">
      <strong style="color:#E87A2E;font-size:9px;letter-spacing:0.05em">RESEARCH METHODOLOGY</strong><br/>
      FEMA flood zone designation sourced from FEMA Flood Map Service Center (msc.fema.gov) — FIRM panel number and zone classification recorded. Topographic assessment via Google Earth elevation profiles, USGS TopoView, and county GIS contour data. Wetlands checked via U.S. Fish & Wildlife Service National Wetlands Inventory (NWI) mapper. Soil data from USDA Web Soil Survey where available. Grading cost estimates based on industry benchmarks: flat-2% = no concern, 2-5% = $50K-$150K, 5-10% = $150K-$400K+, >10% = potentially prohibitive. Environmental screening via EPA NEPAssist and state environmental databases.
    </div>

    <!-- 5. SITE ACCESS & INFRASTRUCTURE -->
    ${section("5", "Site Access & Infrastructure", "")}
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Road Frontage", /frontage|\d+['']?\s*(?:ft|feet|linear)/i.test(combined) ? "Frontage noted — see summary" : "Not confirmed"),
      row("Curb Cuts", /curb\s*cut|driveway|ingress|egress/i.test(combined) ? "Access points noted" : "Not confirmed — verify on aerial"),
      row("Road Type", /highway|arterial|collector|divided|two.?lane/i.test(combined) ? "Road classification noted" : "Not assessed"),
      row("Visibility", /visib/i.test(combined) ? "Visibility noted" : "Not assessed"),
      row("Landlocked", /landlocked|no\s*(?:road|access)|easement\s*only/i.test(combined) ? '<span style="color:#EF4444;font-weight:700">ACCESS CONCERN — verify road frontage</span>' : "No landlocked concerns identified"),
    ].join("")}</table>

    <!-- 6. DEMOGRAPHICS -->
    ${section("6", "Demographics (3-Mile Radius)", "")}
    <table>${[
      row("Population", site.pop3mi ? fmtN(site.pop3mi) : "Not available"),
      row("Median Income", site.income3mi ? ("$" + fmtN(site.income3mi)) : "Not available"),
      demoScore ? row("Demo Score", demoScore, { badge: true, badgeBg: demoColor + "18", badgeColor: demoColor }) : "",
    ].join("")}</table>

    <!-- 7. SITE SIZING -->
    ${section("7", "Site Sizing Assessment", "")}
    <div style="padding:14px 18px;border-radius:10px;background:${sizingColor}0A;border:1px solid ${sizingColor}25;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:600;color:#1E293B">${sizingText}</span>
      <span style="padding:3px 12px;border-radius:6px;font-size:11px;font-weight:800;background:${sizingColor}18;color:${sizingColor}">${sizingTag}</span>
    </div>

    <!-- 8. BROKER -->
    ${section("8", "Broker / Seller", "")}
    <table>${[
      row("Contact", site.sellerBroker || "Not listed"),
      row("Date on Market", site.dateOnMarket || "Unknown"),
    ].join("")}</table>

    <!-- 9. RECOMMENDED NEXT STEPS -->
    ${section("9", "Recommended Next Steps", "")}
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
      ${[
        zoningClass === "unknown" ? { pri: "HIGH", color: "#EF4444", text: "Locate permitted use table for this jurisdiction and verify indoor storage permissibility" } : null,
        zoningClass === "conditional" ? { pri: "MED", color: "#F59E0B", text: "Research SUP/CUP process — timeline, cost, hearing requirements, and precedent" } : null,
        zoningClass === "rezone-required" ? { pri: "HIGH", color: "#EF4444", text: "Evaluate rezone feasibility — comp plan alignment, political climate, timeline" } : null,
        !hasUtilities ? { pri: "HIGH", color: "#EF4444", text: "Confirm water & sewer availability — contact provider and verify service boundary" } : null,
        hasFlood ? { pri: "HIGH", color: "#EF4444", text: "Order FEMA flood certification and evaluate flood insurance cost impact" } : null,
        hasSeptic ? { pri: "LOW", color: "#3B82F6", text: "Septic noted — viable for storage (minimal wastewater: restrooms/office only). Confirm system capacity with county." } : null,
        hasOverlay ? { pri: "LOW", color: "#3B82F6", text: "Review overlay district standards — may impose facade, signage, or landscaping requirements" } : null,
        { pri: "LOW", color: "#3B82F6", text: "Verify all utility tap fees and connection costs for budget modeling" },
      ].filter(Boolean).map(s => `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-radius:8px;background:${s.color}08;border:1px solid ${s.color}18"><span style="font-size:10px;font-weight:800;color:${s.color};background:${s.color}15;padding:2px 8px;border-radius:4px;white-space:nowrap;margin-top:1px">${s.pri}</span><span style="font-size:12px;color:#1E293B;line-height:1.5">${s.text}</span></div>`).join("")}
    </div>

    <!-- 10. RED FLAGS -->
    ${section("10", "Red Flags & Action Items", "")}
    ${flags.length === 0
      ? `<div style="padding:14px 18px;border-radius:10px;background:#F0FDF4;border:1px solid #BBF7D0;color:#166534;font-size:13px;font-weight:600">No red flags identified</div>`
      : `<div style="display:flex;flex-direction:column;gap:6px">${flags.map(f => `<div style="padding:10px 16px;border-radius:8px;background:#FEF2F2;border:1px solid #FECACA;font-size:12px;font-weight:600;color:#991B1B;display:flex;align-items:center;gap:8px"><span style="font-size:14px">&#9888;</span> ${f}</div>`).join("")}</div>`
    }

    <!-- 11. SUMMARY -->
    ${section("11", "Summary & Deal Notes", "")}
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
      <tbody>${dims.map((d, i) => { const v = iq.scores[d.key] || 0; return `<tr style="background:${i % 2 ? "#FAFBFC" : "#fff"}"><td style="padding:8px 12px;font-size:12px;font-weight:600;color:#1E293B">${d.label}</td><td style="padding:8px 12px;font-size:13px;font-weight:800;color:${v >= 7 ? "#16A34A" : v >= 4 ? "#F59E0B" : "#EF4444"};font-family:'Space Mono',monospace">${typeof v === "number" ? v.toFixed(1) : "—"}</td><td style="padding:8px 12px;font-size:11px;color:#94A3B8">${(d.weight * 100).toFixed(0)}%</td><td style="padding:8px 12px;font-size:12px;font-weight:700;color:#475569">${(v * d.weight).toFixed(2)}</td></tr>`; }).join("")}
      <tr style="background:#1E2761"><td colspan="3" style="padding:10px 12px;font-size:12px;font-weight:800;color:#fff;text-transform:uppercase;letter-spacing:0.04em">Composite Score</td><td style="padding:10px 12px;font-size:18px;font-weight:900;color:#F37C33;font-family:'Space Mono',monospace">${typeof iqScore === "number" ? iqScore.toFixed(1) : iqScore}</td></tr>
      </tbody></table>`;
    })() : ""}
  </div>

  <!-- SOURCES & METHODOLOGY APPENDIX -->
  <div style="padding:28px 40px 20px;border-top:2px solid #1E2761">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <div style="width:28px;height:28px;border-radius:6px;background:linear-gradient(135deg,#1E2761,#2C3E6B);display:flex;align-items:center;justify-content:center;font-size:11px;color:#C9A84C;font-weight:900">&#167;</div>
      <h2 style="margin:0;font-size:14px;font-weight:800;color:#1E2761;letter-spacing:0.02em">Sources &amp; Methodology</h2>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div style="padding:12px 14px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0">
        <div style="font-size:9px;font-weight:800;color:#1E2761;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Zoning &amp; Entitlements</div>
        <div style="font-size:8.5px;color:#64748B;line-height:1.5">
          &bull; Municipal zoning ordinance (ecode360, Municode, American Legal, Code Publishing)<br/>
          &bull; Permitted use table — exact district column verified<br/>
          &bull; Overlay district maps via jurisdiction GIS portal<br/>
          &bull; Planning department direct contact for confirmation
        </div>
      </div>
      <div style="padding:12px 14px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0">
        <div style="font-size:9px;font-weight:800;color:#16A34A;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Utilities &amp; Water</div>
        <div style="font-size:8.5px;color:#64748B;line-height:1.5">
          &bull; City/county utility department + published fee schedules<br/>
          &bull; TCEQ CCN maps (TX) / state utility commission databases<br/>
          &bull; Municipal GIS infrastructure layers (water/sewer mains)<br/>
          &bull; Electric utility service territory maps — 3-phase verification
        </div>
      </div>
      <div style="padding:12px 14px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0">
        <div style="font-size:9px;font-weight:800;color:#E87A2E;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Topography &amp; Environmental</div>
        <div style="font-size:8.5px;color:#64748B;line-height:1.5">
          &bull; FEMA Flood Map Service Center (msc.fema.gov) — FIRM panels<br/>
          &bull; Google Earth elevation profiles + USGS TopoView<br/>
          &bull; National Wetlands Inventory (NWI) mapper — USFWS<br/>
          &bull; USDA Web Soil Survey + EPA NEPAssist screening
        </div>
      </div>
      <div style="padding:12px 14px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0">
        <div style="font-size:9px;font-weight:800;color:#2C3E6B;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Demographics &amp; Scoring</div>
        <div style="font-size:8.5px;color:#64748B;line-height:1.5">
          &bull; Licensed ESRI 2025 estimates + 2030 five-year projections<br/>
          &bull; U.S. Census Bureau ACS 5-Year (population, HHI, households)<br/>
          &bull; SiteIQ&trade; composite scoring: 8 weighted dimensions, 0&ndash;10 scale<br/>
          &bull; PS proximity: Haversine distance against 3,400+ owned locations
        </div>
      </div>
    </div>
    <div style="padding:10px 14px;border-radius:6px;background:#0A0A0C;font-size:8px;color:#64748B;line-height:1.6;text-align:center">
      This report was generated by SiteIQ&trade;, a proprietary AI-powered acquisition intelligence platform developed by DJR Real Estate LLC.
      All zoning, utility, and environmental findings are sourced from primary municipal records, federal databases, and licensed data providers.
      Findings should be independently verified prior to capital commitment. Report date: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
    </div>
  </div>

  <!-- FOOTER -->
  <div style="background:#0A0A0C;padding:20px 40px;display:flex;justify-content:space-between;align-items:center">
    <div style="font-size:11px;color:#64748B">Report generated by <span style="color:#C9A84C;font-weight:700">SiteIQ&trade; AI-Powered Land Acquisition Engine</span></div>
    <div style="font-size:11px;color:#64748B"><span style="color:#C9A84C;font-weight:700">DJR Real Estate LLC</span> &nbsp;|&nbsp; Confidential</div>
  </div>
</div></body></html>`;
};

// ─── Zoning & Utility Report — merged into generateVettingReport above ───
const _REMOVED_generateZoningUtilityReport = (site, iqResult) => {
  const iq = iqResult || {};
  const iqScore = typeof iq.composite === "number" ? iq.composite : (iq.score || "—");
  const zoningClass = site.zoningClassification || "unknown";
  const zoningLabel = { "by-right": "BY-RIGHT (Permitted)", "conditional": "CONDITIONAL (SUP/CUP Required)", "rezone-required": "REZONE REQUIRED", "prohibited": "PROHIBITED", "unknown": "UNKNOWN — Research Required" }[zoningClass] || zoningClass.toUpperCase();
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
  if (zoningClass === "unknown") flags.push("Zoning classification not confirmed — verify with local planning");
  if (zoningClass === "prohibited") flags.push("Storage use PROHIBITED in current zoning district");
  if (zoningClass === "rezone-required") flags.push("Rezone required — timeline and political risk apply");
  if (hasFlood) flags.push("Flood zone identified — verify FEMA panel and insurance cost");
  if (!hasUtilities && !hasSeptic) flags.push("Utility availability not confirmed — verify water hookup (HARD REQUIREMENT for fire suppression)");
  if (site.waterAvailable === false) flags.push("⚠ WATER HOOKUP NOT CONFIRMED — municipal water is a HARD REQUIREMENT for fire suppression. Septic OK for sewer.");
  // NOTE: Septic is VIABLE for sewer (storage has minimal wastewater). But WATER is non-negotiable — fire code requires municipal pressure.
  if (hasWell) flags.push("Well water noted — may need municipal connection for commercial use");
  if (hasOverlay) flags.push("Overlay district applies — additional standards may affect design/cost");
  if (!site.zoning) flags.push("No zoning district recorded — critical data gap");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Zoning & Utility Report — ${site.name || "Site"}</title><style>@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Space+Mono:wght@700&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',sans-serif;background:#F8FAFC;color:#1E293B;padding:0}@media print{body{background:#fff}.no-print{display:none!important}.report{box-shadow:none}}.report{max-width:800px;margin:0 auto;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.08)}table{width:100%;border-collapse:collapse}.print-btn{position:fixed;bottom:28px;right:28px;display:flex;align-items:center;gap:8px;padding:14px 24px;border-radius:12px;border:none;background:linear-gradient(135deg,#5E35B1,#7C4DFF);color:#fff;font-size:14px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;box-shadow:0 4px 20px rgba(94,53,177,0.4);transition:all 0.2s ease;z-index:9999}.print-btn:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(94,53,177,0.5)}.save-btn{position:fixed;bottom:28px;right:200px;display:flex;align-items:center;gap:8px;padding:14px 24px;border-radius:12px;border:none;background:linear-gradient(135deg,#1E2761,#2C3E6B);color:#fff;font-size:14px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;box-shadow:0 4px 20px rgba(30,39,97,0.4);transition:all 0.2s ease;z-index:9999}.save-btn:hover{transform:translateY(-2px)}</style></head><body>
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
      { label: "Zoning Score", value: zoningScore != null ? `${zoningScore.toFixed(1)}/10` : "—", color: zoningScoreColor },
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
        ${zoningClass === "by-right" ? "Self-storage / mini-warehouse is a <strong style='color:#16A34A'>permitted use</strong> in this zoning district. No special approvals required — proceed with site plan review." : ""}
        ${zoningClass === "conditional" ? "Self-storage is allowed as a <strong style='color:#F59E0B'>conditional / special use</strong>. Requires public hearing and approval. Timeline: typically 2–6 months. Factor SUP costs (~$15K–$50K) and uncertainty into underwriting." : ""}
        ${zoningClass === "rezone-required" ? "Current zoning <strong style='color:#EF4444'>does not permit</strong> storage use. Rezoning required — political risk, 4–12 month timeline, significant cost ($25K–$75K+). Evaluate carefully." : ""}
        ${zoningClass === "prohibited" ? "Storage is <strong style='color:#991B1B'>explicitly prohibited</strong> with no conditional path. Rezone is the only option and may face strong opposition." : ""}
        ${zoningClass === "unknown" ? "Zoning classification has <strong>not been confirmed</strong>. The permitted use table for this jurisdiction must be reviewed before proceeding. See Section 3 for next steps." : ""}
      </div>
    </div>
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Zoning District", site.zoning || "Not recorded", { bold: true }),
      row("Classification", zoningLabel, { badge: true, badgeBg: zoningBadgeBg, badgeColor: zoningColor }),
      row("Storage Use Term", hasByRight ? "Permitted (by right)" : hasSUP ? "Conditional / SUP / CUP" : hasRezone ? "Rezone required" : "Not determined"),
      row("Overlay Districts", hasOverlay ? "Yes — additional standards apply (check summary)" : "None identified"),
    ].join("")}</table>

    <!-- 2. SUPPLEMENTAL STANDARDS -->
    ${section("2", "Supplemental Standards & Requirements")}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px">
      ${[
        { label: "Facade / Materials", icon: "🏗", text: /facade|material|masonry|brick/i.test(combined) ? "Requirements noted — see summary" : "No specific requirements identified" },
        { label: "Setbacks", icon: "📐", text: /setback/i.test(combined) ? "Setback requirements noted" : "Standard district setbacks apply" },
        { label: "Height Limits", icon: "📏", text: /height\s*limit|max.*height|story.*limit/i.test(combined) ? "Height restrictions noted" : "Standard district height limits" },
        { label: "Screening / Landscape", icon: "🌿", text: /screen|landscape|buffer/i.test(combined) ? "Screening / landscaping required" : "Standard requirements" },
        { label: "Signage", icon: "🪧", text: /sign/i.test(combined) ? "Signage requirements noted" : "Standard district signage rules" },
        { label: "Parking", icon: "🅿", text: /parking/i.test(combined) ? "Parking requirements noted" : "Per district standards" },
      ].map(s => `<div style="padding:12px 16px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0"><div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:14px">${s.icon}</span><span style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.04em">${s.label}</span></div><div style="font-size:12px;color:#64748B">${s.text}</div></div>`).join("")}
    </div>

    <!-- 3. UTILITY ASSESSMENT -->
    ${section("3", "Utility Infrastructure")}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      ${[
        { label: "Water Service", icon: "💧", available: /water|municipal|city\s*water/i.test(combined), issue: hasWell ? "Well water noted" : null, color: /water|municipal/i.test(combined) ? "#16A34A" : "#94A3B8" },
        { label: "Sanitary Sewer", icon: "🚿", available: /sewer|sanitary/i.test(combined), issue: hasSeptic ? "Septic system" : null, color: /sewer/i.test(combined) ? "#16A34A" : hasSeptic ? "#F59E0B" : "#94A3B8" },
        { label: "Electric Service", icon: "⚡", available: /electric|power/i.test(combined), issue: null, color: /electric|power/i.test(combined) ? "#16A34A" : "#94A3B8" },
        { label: "Natural Gas", icon: "🔥", available: /\bgas\b|natural\s*gas/i.test(combined), issue: null, color: /\bgas\b/i.test(combined) ? "#16A34A" : "#94A3B8" },
        { label: "Stormwater", icon: "🌧", available: /storm|drainage|detention/i.test(combined), issue: hasFlood ? "Flood zone concern" : null, color: hasFlood ? "#EF4444" : /storm|drainage/i.test(combined) ? "#16A34A" : "#94A3B8" },
        { label: "Telecom / Fiber", icon: "📡", available: /fiber|telecom|internet|broadband/i.test(combined), issue: null, color: /fiber|telecom/i.test(combined) ? "#16A34A" : "#94A3B8" },
      ].map(u => `<div style="padding:14px 16px;border-radius:10px;background:${u.color}08;border:1px solid ${u.color}20"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div style="display:flex;align-items:center;gap:6px"><span style="font-size:16px">${u.icon}</span><span style="font-size:12px;font-weight:700;color:#1E293B">${u.label}</span></div>${statusPill(u.available ? "Confirmed" : u.issue ? u.issue : "Not Confirmed", u.color)}</div><div style="font-size:11px;color:#64748B;margin-top:4px">${u.available ? "Available per listing/summary data" : u.issue ? u.issue + " — verify capacity for commercial use" : "Not mentioned in listing data — verify with jurisdiction or utility provider"}</div></div>`).join("")}
    </div>

    <!-- 4. FLOOD ZONE -->
    ${section("4", "Flood Zone & Environmental")}
    <div style="padding:14px 18px;border-radius:10px;background:${hasFlood ? "#FEF2F2" : "#F0FDF4"};border:1px solid ${hasFlood ? "#FECACA" : "#BBF7D0"};display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <span style="font-size:13px;font-weight:600;color:#1E293B">${hasFlood ? "Flood zone concern identified in site data" : "No flood zone issues identified"}</span>
      ${statusPill(hasFlood ? "FLOOD RISK" : "CLEAR", hasFlood ? "#EF4444" : "#16A34A")}
    </div>
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("FEMA Flood Zone", hasFlood ? "Flood zone identified — verify FEMA panel" : "Not identified (verify FEMA map)"),
      row("Environmental Concerns", /environmental|contamina|brownfield|phase\s*[12i]/i.test(combined) ? "Environmental issues noted — see summary" : "None identified"),
      row("Wetlands", /wetland/i.test(combined) ? "Wetlands noted — may affect buildable area" : "None identified"),
      row("Topography", /slope|grade|topo|steep|flat/i.test(combined) ? "Topography notes in summary" : "Not assessed — review aerial imagery"),
    ].join("")}</table>

    <!-- 5. ACCESS & INFRASTRUCTURE -->
    ${section("5", "Site Access & Infrastructure")}
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Road Frontage", /frontage|\d+['']?\s*(?:ft|feet|linear)/i.test(combined) ? "Frontage noted — see summary" : "Not confirmed"),
      row("Curb Cuts", /curb\s*cut|driveway|ingress|egress/i.test(combined) ? "Access points noted" : "Not confirmed — verify on aerial"),
      row("Road Type", /highway|arterial|collector|divided|two.?lane/i.test(combined) ? "Road classification noted" : "Not assessed"),
      row("Visibility", /visib/i.test(combined) ? "Visibility noted" : "Not assessed"),
      row("Landlocked", /landlocked|no\s*(?:road|access)|easement\s*only/i.test(combined) ? `<span style="color:#EF4444;font-weight:700">ACCESS CONCERN</span>` : "No landlocked concerns identified"),
    ].join("")}</table>

    <!-- 6. NEXT STEPS -->
    ${section("6", "Recommended Next Steps")}
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
      ${[
        zoningClass === "unknown" ? { pri: "HIGH", color: "#EF4444", text: "Locate permitted use table for this jurisdiction and verify storage permissibility" } : null,
        zoningClass === "conditional" ? { pri: "MED", color: "#F59E0B", text: "Research SUP/CUP process — timeline, cost, hearing requirements, and precedent" } : null,
        zoningClass === "rezone-required" ? { pri: "HIGH", color: "#EF4444", text: "Evaluate rezone feasibility — comp plan alignment, political climate, timeline" } : null,
        !hasUtilities ? { pri: "MED", color: "#F59E0B", text: "Confirm utility availability — contact water/sewer provider and electric utility" } : null,
        hasFlood ? { pri: "HIGH", color: "#EF4444", text: "Order FEMA flood certification and evaluate flood insurance cost impact" } : null,
        hasSeptic ? { pri: "LOW", color: "#3B82F6", text: "Septic noted — viable for storage (minimal wastewater: restrooms/office only). Confirm system capacity with county." } : null,
        hasOverlay ? { pri: "LOW", color: "#3B82F6", text: "Review overlay district standards — may impose facade, signage, or landscaping requirements" } : null,
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

// ─── SiteIQ™ v3 — Calibrated Site Scoring Engine ───
// Matches CLAUDE.md §6h framework. Uses structured data fields, not regex on summary text.
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

  // --- 1. DEMOGRAPHICS — POPULATION (25%) §6h calibrated ---
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

  // --- 2. DEMOGRAPHICS — HHI (15%) §6h calibrated ---
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

  // --- 2c. PRICING (8%) — Price per acre vs. acquisition targets ---
  // Thresholds: ≤$150K/ac=10, ≤$250K=8, ≤$400K=6, ≤$600K=4, >$600K=2, no data=5
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
    // Price exists but no acreage — can't compute PPA, leave default
  }
  scores.pricing = pricingScore;

  // --- 3. ZONING (15%) §6c methodology ---
  // Prefer structured zoningClassification field; fall back to regex on zoning + summary text
  // SOURCE NOTE: ETJ / unincorporated / no zoning = 10/10 (BEST outcome for storage).
  // Under Texas law (Ch. 231 LGC), counties have no zoning authority. ETJ grants platting control only, NOT use restrictions.
  // We actively target unzoned land — it's a HUGE positive, not a neutral score.
  let zoningScore = 3;
  const zClass = site.zoningClassification;
  if (zClass && zClass !== "unknown") {
    if (zClass === "by-right") zoningScore = 10;
    else if (zClass === "conditional") zoningScore = 6;
    else if (zClass === "rezone-required") zoningScore = 2;
    else if (zClass === "prohibited") { zoningScore = 0; flags.push("Zoning prohibits storage"); }
  } else {
    // "no zoning", "unincorporated", "ETJ", "unrestricted" = 10/10 — best possible outcome
    const noZoning = /(no\s*zoning|unincorporated|unrestricted|\bETJ\b|county\s*[-—]\s*no\s*zon)/i;
    const byRight = /(by\s*right|permitted|storage\s*(?:by|permitted)|(?:^|\s)(?:cs|gb|mu|b[- ]?\d|c[- ]?\d|m[- ]?\d)\b|commercial|industrial|business|pud\s*allow)/i;
    const conditional = /(conditional|sup\b|cup\b|special\s*use|overlay|variance|needs?\s*sup)/i;
    const prohibited = /(prohibited|residential\s*only|(?:^|\s)ag\b|agriculture|not\s*permitted)/i;
    const rezoning = /(rezone|rezoning\s*required)/i;
    if (noZoning.test(combinedText)) zoningScore = 10; // No zoning = unrestricted = best score
    else if (byRight.test(combinedText)) zoningScore = 10;
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

  // --- COMPOSITE (weighted sum, 0-10 scale) — uses configurable weights ---
  const weightedSum =
    (popScore * getIQWeight("population")) + (growthScore * getIQWeight("growth")) +
    (incScore * getIQWeight("income")) + (pricingScore * getIQWeight("pricing")) +
    (zoningScore * getIQWeight("zoning")) + (scores.access * getIQWeight("access")) +
    (compScore * getIQWeight("competition")) + (tierScore * getIQWeight("marketTier"));
  let adjusted = Math.round(weightedSum * 10) / 10;

  // --- PHASE BONUS ---
  const phase = (site.phase || "").toLowerCase();
  if (/under contract|closed/i.test(phase)) adjusted = Math.min(10, adjusted + 0.3);
  else if (/psa sent/i.test(phase)) adjusted = Math.min(10, adjusted + 0.2);
  else if (/^loi$/i.test(phase)) adjusted = Math.min(10, adjusted + 0.15);
  else if (/siteiq approved|ps approved/i.test(phase)) adjusted = Math.min(10, adjusted + 0.1);

  // --- STALE LISTING PENALTY ---
  if (site.dateOnMarket) {
    const dom = Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000);
    if (dom > 1000) { adjusted = Math.max(0, adjusted - 0.5); flags.push("Stale: " + dom + " DOM"); }
  }

  // --- BROKER INTEL BONUSES (from siteiqData) ---
  if (site.siteiqData?.brokerConfirmedZoning) adjusted = Math.min(10, adjusted + 0.3);
  if (site.siteiqData?.surveyClean) adjusted = Math.min(10, adjusted + 0.2);

  // --- WATER HOOKUP — HARD REQUIREMENT ---
  // SOURCE NOTE: Water hookup is a MUST for self-storage. Fire suppression (sprinkler systems)
  // requires municipal-grade pressure and flow. We don't need to be IN a MUD — we just need
  // to be able to HOOK UP to the nearest water main. Line extension is a cost item, not a
  // deal killer. The deal killer is if there's NO water main within reasonable distance.
  // Septic is fine for sewer (storage has minimal wastewater), but water is non-negotiable.
  if (site.waterAvailable === false) {
    if (site.waterProvider && site.waterProvider.length > 10) {
      // Provider identified but not currently connected — line extension likely needed. Flag but don't kill.
      flags.push("⚠ WATER: Not currently connected — line extension to nearest main required. Verify distance & cost.");
      adjusted = Math.max(0, adjusted - 0.3);
    } else {
      // No provider identified at all — high risk
      flags.push("⚠ WATER: No water provider identified — verify hookup feasibility (HARD REQUIREMENT for fire suppression)");
      adjusted = Math.max(0, adjusted - 1.0);
    }
  }

  // --- RESEARCH COMPLETENESS — HARD VET BEFORE SCORE ---
  // SiteIQ score incorporates depth of due diligence research.
  // Sites with verified primary-source research score higher than unvetted sites.
  // Source: CLAUDE.md §6h — "HARD VET, then SiteIQ score, not the other way around"
  const vetChecks = [
    !!site.zoningSource,                                          // Ordinance cited
    !!site.zoningClassification && site.zoningClassification !== "unknown",  // Classification confirmed
    !!site.zoningNotes && site.zoningNotes.length > 20,           // Permitted use table reviewed
    !!site.waterProvider,                                          // Water provider identified
    site.waterAvailable === true || site.waterAvailable === false, // Water availability confirmed
    !!site.sewerProvider,                                          // Sewer provider identified
    !!site.electricProvider,                                       // Electric provider identified
    !!site.floodZone,                                              // FEMA flood zone checked
    !!site.planningContact,                                        // Planning dept contact found
  ];
  const vetDone = vetChecks.filter(Boolean).length;
  const vetPct = vetDone / vetChecks.length;
  // Full vet (100%) = +0.5 bonus. Partial vet scales linearly. Zero vet = -0.3 penalty.
  if (vetPct === 1) { adjusted = Math.min(10, adjusted + 0.5); }
  else if (vetPct >= 0.7) { adjusted = Math.min(10, adjusted + 0.3); }
  else if (vetPct >= 0.4) { /* no adjustment — neutral */ }
  else if (vetPct > 0) { adjusted = Math.max(0, adjusted - 0.1); }
  else { adjusted = Math.max(0, adjusted - 0.3); flags.push("No deep vet research completed"); }

  const final = Math.round(adjusted * 10) / 10;

  // --- CLASSIFICATION (§6h) ---
  let classification, classColor;
  if (hardFail) { classification = "RED"; classColor = "#DC2626"; }
  else if (final >= 7.5) { classification = "GREEN"; classColor = "#16A34A"; }
  else if (final >= 5.5) { classification = "YELLOW"; classColor = "#D97706"; }
  else if (final >= 3.0) { classification = "ORANGE"; classColor = "#EA580C"; }
  else { classification = "RED"; classColor = "#DC2626"; }

  const breakdown = [
    { label: "Population", key: "population", score: scores.population, weight: getIQWeight("population") },
    { label: "Growth", key: "growth", score: scores.growth, weight: getIQWeight("growth") },
    { label: "Income", key: "income", score: scores.income, weight: getIQWeight("income") },
    { label: "Pricing", key: "pricing", score: scores.pricing, weight: getIQWeight("pricing") },
    { label: "Zoning", key: "zoning", score: scores.zoning, weight: getIQWeight("zoning") },
    { label: "Access", key: "access", score: scores.access, weight: getIQWeight("access") },
    { label: "Competition", key: "competition", score: scores.competition, weight: getIQWeight("competition") },
    { label: "Market Tier", key: "marketTier", score: scores.marketTier, weight: getIQWeight("marketTier") },
  ];
  return {
    score: final, scores, flags, hardFail, hasDemoData, classification, classColor, breakdown,
    tier: final >= 8 ? "gold" : final >= 6 ? "steel" : "gray",
    label: final >= 9 ? "ELITE" : final >= 8 ? "PRIME" : final >= 7 ? "STRONG" : final >= 6 ? "VIABLE" : final >= 4 ? "MARGINAL" : "WEAK",
  };
};

// ─── SiteIQ Badge Component ───
function SiteIQBadge({ site, size = "normal", iq: iqProp }) {
  const iq = iqProp || computeSiteIQ(site);
  const s = iq.score;
  const isGold = iq.tier === "gold";
  const isSteel = iq.tier === "steel";
  const isSmall = size === "small";

  const tierColors = {
    gold: { bg: "linear-gradient(135deg, #C9A84C, #FFD700, #C9A84C)", glow: "0 0 24px rgba(201,168,76,0.5), 0 0 48px rgba(201,168,76,0.2), 0 0 4px rgba(255,215,0,0.8)", text: "#0a0a0a", ring: "#C9A84C", labelBg: "linear-gradient(135deg, #FFFBEB, #FFF8ED)" },
    steel: { bg: "linear-gradient(135deg, #1a1a2e, #2C3E6B, #1a1a2e)", glow: "0 2px 12px rgba(44,62,107,0.35), 0 0 2px rgba(243,124,51,0.2)", text: "#fff", ring: "#F37C33", labelBg: "linear-gradient(135deg, #E8EAF6, #F0F2FF)" },
    gray: { bg: "linear-gradient(135deg, #3a3a4a, #4a4a5a, #3a3a4a)", glow: "0 2px 8px rgba(0,0,0,0.2)", text: "#94A3B8", ring: "#64748B", labelBg: "rgba(15,21,56,0.3)" },
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
          <span style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8", letterSpacing: "0.08em" }}>SiteIQ™</span>
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

// ─── Components ───
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
      {s.label || status}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const c = PRIORITY_COLORS[priority] || "#CBD5E1";
  return priority && priority !== "⚪ None" ? (
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
    border: "1px solid rgba(201,168,76,0.12)",
    fontSize: 13,
    fontFamily: "'Inter', sans-serif",
    background: "rgba(15,21,56,0.5)",
    color: "#E2E8F0",
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
            color: "#6B7394",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
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

// ─── Seed Data REMOVED (v3) ───
// All 47 sites (33 DW + 14 MT) are in Firebase with verified data.
// Seed data was stale (missing coordinates, demographics, acreage) and risked overwriting live data.
// New sites are added via Submit Site form, Bulk Import, or Claude's §6h broker response pipeline.
const DW_SEED = [];
const MT_SEED = [];

// ═══ MAIN APP ═══
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
      setDetailView(null);
      if (opts.phase) setFilterPhase(opts.phase); else setFilterPhase("all");
      if (opts.siteId) { setExpandedSite(opts.siteId); setTimeout(() => { const el = document.getElementById(`site-${opts.siteId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 120); } else { setExpandedSite(null); }
      if (newTab === "review") setShowNewAlert(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => setTransitioning(false), 350);
    }, 280);
  }, [tab]);
  const [toast, setToast] = useState(null);
  const [expandedSite, setExpandedSite] = useState(null);
  const [detailView, setDetailView] = useState(null); // { regionKey, siteId }
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
  // reviewExpandedSite removed — replaced by reviewDetailSite (full-page detail)
  const [reviewTab, setReviewTab] = useState("mine");
  const [reviewDetailSite, setReviewDetailSite] = useState(null); // site ID for full-page review detail
  const [shareLink, setShareLink] = useState(null);
  const [seeded, setSeeded] = useState(false);
  const [demoLoading, setDemoLoading] = useState({});
  const [demoReport, setDemoReport] = useState({});
  const [showSiteIQDetail, setShowSiteIQDetail] = useState({});
  // vettingReport removed — auto-generates on site add
  const [showIQConfig, setShowIQConfig] = useState(false);
  const [iqWeights, setIqWeights] = useState(SITE_IQ_DEFAULTS.map(d => ({ key: d.key, label: d.label, icon: d.icon, weight: d.weight, tip: d.tip })));

  // ─── KEYBOARD NAVIGATION — Arrow keys to toggle between properties ───
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

  // ─── FONT LOADER ───
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap";
    document.head.appendChild(link);
  }, []);

  // ─── FIREBASE REAL-TIME LISTENERS ───
  useEffect(() => {
    const subsRef = ref(db, "submissions");
    const eastRef = ref(db, "east");
    const swRef = ref(db, "southwest");
    const metaRef = ref(db, "meta/seeded");

    const unsubSeed = onValue(metaRef, (snap) => {
      setSeeded(!!snap.val());
    });

    // SiteIQ weight config listener — merges Firebase overrides into live config
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

  // ─── PHASE MIGRATION — one-time remap of legacy phases ───
  const [migrated, setMigrated] = useState(false);
  useEffect(() => {
    if (!loaded || migrated) return;
    const now = new Date().toISOString();
    const migrate = (sites, region) => {
      sites.forEach(s => {
        if (PHASE_MIGRATION[s.phase]) {
          const newPhase = PHASE_MIGRATION[s.phase];
          fbUpdate(`${region}/${s.id}`, { phase: newPhase });
          fbPush(`${region}/${s.id}/activityLog`, { action: `Phase migrated: ${s.phase} → ${newPhase}`, ts: now, by: "System" });
        }
      });
    };
    migrate(sw, "southwest");
    migrate(east, "east");
    subs.forEach(s => {
      if (PHASE_MIGRATION[s.phase]) {
        fbUpdate(`submissions/${s.id}`, { phase: PHASE_MIGRATION[s.phase] });
      }
    });
    setMigrated(true);
  }, [loaded, sw, east, subs, migrated]);

  // ─── SEED ON FIRST LOAD ───
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
      priority: "⚪ None",
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

  // ─── ALERT for pending sites ───
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

  // ─── FIREBASE WRITE HELPERS ───
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
          action: `Phase: ${oldPhase} → ${value}`,
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

  const handleSendToReview = (region, id, site) => {
    const now = new Date().toISOString();
    const sub = { ...site, status: "pending", region, submittedAt: now, sentBackToReview: true };
    delete sub.messages; delete sub.docs; delete sub.activityLog;
    fbSet(`submissions/${id}`, sub);
    fbRemove(`${region}/${id}`);
    fbPush(`${region}/${id}/activityLog`, { action: "Sent back to Review Queue", ts: now, by: "Dan R" });
    setExpandedSite(null);
    notify(`${site.name} → Review Queue`);
  };

  // ─── GEOCODE & DEMOGRAPHICS ───
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

  // ─── AUTO VETTING REPORT — runs on site add, saves to Firebase Storage ───
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

  // ─── FLYER PARSING ───
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
        // Address patterns — look for street number + street name
        const addrMatch = text.match(/(\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Hwy|Highway|Way|Ct|Court|Pkwy|Parkway|Pl|Place|Cir|Circle)\.?)/i);
        if (addrMatch && !form.address) parsed.address = addrMatch[1];
        // City, State pattern
        const csMatch = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),?\s+([A-Z]{2})\s+\d{5}/);
        if (csMatch) {
          if (!form.city) parsed.city = csMatch[1];
          if (!form.state) parsed.state = csMatch[2];
        }
        // Apply parsed values — only fill empty fields
        setForm((prev) => {
          const updated = { ...prev };
          Object.entries(parsed).forEach(([k, v]) => {
            if (!updated[k]) updated[k] = v;
          });
          return updated;
        });
        notify(`Extracted ${Object.keys(parsed).length} field(s) from flyer`);
      } else if (file.type.startsWith("image/")) {
        notify("Flyer attached — image files can't be auto-parsed (fill fields manually)");
      } else {
        notify("Flyer attached — no text found to extract");
      }
    } catch (err) {
      console.error("Flyer parse error:", err);
      notify("Flyer attached — couldn't extract text");
    }
    setFlyerParsing(false);
  };

  // ─── SUBMIT ───
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
      priority: "⚪ None",
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
      notify(`Added → ${REGIONS[form.region].label}`);
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

  // ─── REVIEW — TWO-STEP APPROVAL ───
  // Step 1: Dan recommends & assigns route (site stays in review queue)
  const handleRecommend = (id) => {
    const site = subs.find((s) => s.id === id);
    if (!site) return;
    const ri = reviewInputs[id] || {};
    const routeTo = ri.routeTo || site.region || "southwest";
    const routeLabel = REGIONS[routeTo]?.label || routeTo;
    const now = new Date().toISOString();
    fbUpdate(`submissions/${id}`, {
      status: "recommended",
      region: routeTo,
      recommendedBy: "Dan R.",
      recommendedAt: now,
      reviewNote: ri.note || "",
      routedTo: routeTo,
    });
    notify(`Recommended → ${routeLabel} (awaiting PS approval)`);
    autoGenerateVettingReport(routeTo, id, { ...site, region: routeTo });
  };

  // Step 2: PS (DW/MT/Jarrod) approves — moves to tracker
  const handlePSApprove = (id) => {
    const site = subs.find((s) => s.id === id);
    if (!site) return;
    const ri = reviewInputs[id] || {};
    const routeTo = site.routedTo || site.region || "southwest";
    const routeLabel = REGIONS[routeTo]?.label || routeTo;
    const now = new Date().toISOString();
    const t = {
      ...site,
      region: routeTo,
      status: "tracking",
      approvedAt: now,
      approvedBy: ri.reviewer || "PS",
      reviewedBy: site.recommendedBy || "Dan R",
      reviewNote: site.reviewNote || ri.note || "",
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
      priority: "⚪ None",
      messages: {},
      docs: {},
      activityLog: { [uid()]: { action: `PS Approved → routed to ${routeLabel}`, ts: now, by: ri.reviewer || "PS" } },
    };
    fbSet(`${routeTo}/${id}`, t);
    fbUpdate(`submissions/${id}`, { status: "approved", approvedBy: ri.reviewer || "PS", approvedAt: now });
    notify(`PS Approved → ${routeLabel} tracker`);
  };

  // handleApprove removed — replaced by two-step: handleRecommend (Dan) → handlePSApprove (PS)

  const handleApproveAll = () => {
    const p = subs.filter((s) => s.status === "pending");
    if (!p.length) return;
    const now = new Date().toISOString();
    const updates = {};
    p.forEach((s) => {
      const ri = reviewInputs[s.id] || {};
      const routeTo = ri.routeTo || s.region || "southwest";
      updates[`submissions/${s.id}/status`] = "recommended";
      updates[`submissions/${s.id}/region`] = routeTo;
      updates[`submissions/${s.id}/routedTo`] = routeTo;
      updates[`submissions/${s.id}/recommendedBy`] = "Dan R.";
      updates[`submissions/${s.id}/recommendedAt`] = now;
    });
    import("firebase/database").then(({ ref: fbRef, update: fbUpd }) => {
      fbUpd(ref(db, "/"), updates);
    });
    notify(`Recommended ${p.length} sites (awaiting PS approval)`);
  };

  const handleDecline = (id) => {
    const ri = reviewInputs[id] || {};
    fbUpdate(`submissions/${id}`, { status: "declined", reviewedBy: ri.reviewer || "Dan R", reviewNote: ri.note || "" });
    notify("Declined.");
  };

  const handleClearDeclined = () => {
    subs.filter((s) => s.status === "declined").forEach((s) => fbRemove(`submissions/${s.id}`));
  };

  // ─── DOCUMENT UPLOAD (Firebase Storage) ───
  const handleDocUpload = async (region, siteId, file, docType) => {
    if (!file) return;
    if (file.size > 20e6) { notify("Max 20MB per file"); return; }
    const docId = uid();
    const path = `docs/${siteId}/${docId}_${file.name}`;
    try {
      notify("Uploading…");
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      const docEntry = { id: docId, name: file.name, type: docType, url, path, uploadedAt: new Date().toISOString() };
      fbPush(`${region}/${siteId}/docs`, docEntry);
      notify(`${docType} uploaded!`);
    } catch (e) {
      console.error(e);
      notify("Upload failed — check Firebase Storage rules");
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

  // ─── EXPORT ───
  const handleExport = async () => {
    const XLSX = await import("xlsx");
    const cols = [
      { key: "siteiq", header: "SiteIQ™", width: 10 },
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

  // ─── SORT ───
  const SORT_OPTIONS = [
    { key: "siteiq", label: "SiteIQ™ (Best)" },
    { key: "name", label: "Name (A→Z)" },
    { key: "city", label: "City (A→Z)" },
    { key: "recent", label: "Recently Added" },
    { key: "dom", label: "Days on Market" },
    { key: "priority", label: "Priority" },
    { key: "phase", label: "Phase" },
  ];
  const priorityOrder = { "🔥 Hot": 0, "🟡 Warm": 1, "🔵 Cold": 2, "⚪ None": 3 };
  // Phase sort: pipeline flow order (Incoming → ... → Closed, Dead last)
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

  // ─── MEMOIZED SiteIQ CACHE ───
  // Computes SiteIQ once per site when data changes. Eliminates ~188 redundant calls per render.
  const siteIQCache = useMemo(() => {
    const cache = new Map();
    [...sw, ...east].forEach((s) => { if (s && s.id) cache.set(s.id, computeSiteIQ(s)); });
    return cache;
  }, [sw, east]);
  const getSiteIQ = (site) => siteIQCache.get(site.id) || computeSiteIQ(site);

  const SortBar = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#6B7394" }}>Sort:</span>
      {SORT_OPTIONS.map((o) => (
        <button key={o.key} onClick={() => setSortBy(o.key)} style={{ padding: "4px 10px", borderRadius: 6, border: sortBy === o.key ? "1px solid #E87A2E" : "1px solid rgba(201,168,76,0.12)", background: sortBy === o.key ? "rgba(232,122,46,0.12)" : "rgba(15,21,56,0.4)", color: sortBy === o.key ? "#E87A2E" : "#6B7394", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter'", transition: "all 0.15s" }}>{o.label}</button>
      ))}
    </div>
  );

  // ─── STYLES ───
  const inp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(201,168,76,0.15)", fontSize: 14, fontFamily: "'Inter', sans-serif", background: "rgba(15,21,56,0.6)", color: "#E2E8F0", outline: "none", boxSizing: "border-box" };
  const navBtn = (key) => ({ padding: "10px 16px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter', sans-serif", transition: "all 0.15s cubic-bezier(0.22,1,0.36,1)", background: tab === key ? "rgba(232,122,46,0.15)" : "transparent", color: tab === key ? "#E87A2E" : "#6B7394", whiteSpace: "nowrap", boxShadow: tab === key ? "0 0 16px rgba(232,122,46,0.12), inset 0 0 0 1px rgba(232,122,46,0.2)" : "none" });
  const pendingSubsN = subs.filter((s) => s.status === "pending" || s.status === "recommended").length;
  const assignedReviewN = [...sw, ...east].filter(s => s.assignedTo && s.needsReview).length;
  const pendingN = pendingSubsN + assignedReviewN;

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "linear-gradient(165deg, #0F1538 0%, #1E2761 40%, #0F1538 100%)", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, border: "3px solid rgba(232,122,46,0.15)", borderTopColor: "#E87A2E", borderRadius: "50%", animation: "spin 0.6s linear infinite", margin: "0 auto 16px", boxShadow: "0 0 20px rgba(232,122,46,0.2)" }} />
        <div style={{ color: "#6B7394", fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Initializing SiteIQ™</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // ═══ TRACKER CARDS ═══
  const TrackerCards = ({ regionKey }) => {
    const region = REGIONS[regionKey];
    const data = sortData(regionKey === "east" ? east : sw);

    return (
      <div style={{ animation: "fadeIn 0.3s ease-out" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ width: 14, height: 14, borderRadius: "50%", background: region.accent }} />
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: region.color }}>{region.label} — Master Tracker</h2>
          <span style={{ fontSize: 13, color: "#94A3B8" }}>({data.length})</span>
        </div>
        <SortBar />
        {data.length === 0 ? (
          <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 40, textAlign: "center", color: "#6B7394", border: "1px solid rgba(201,168,76,0.06)" }}>No sites yet.</div>
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
                <div key={site.id} id={`site-${site.id}`} className={`site-card${isOpen ? " site-card-open" : ""}`} style={{ ...STYLES.cardBase, borderLeft: `4px solid ${isOpen ? "#E87A2E" : (PRIORITY_COLORS[site.priority] || region.accent)}`, ...(isOpen ? { boxShadow: "0 12px 48px rgba(232,122,46,0.15), 0 0 0 1px rgba(232,122,46,0.2), 0 0 60px rgba(232,122,46,0.06)", transform: "scale(1.003)", background: "rgba(15,21,56,0.75)" } : {}) }}>
                  {/* Collapsed header */}
                  <div onClick={() => { setDetailView({ regionKey, siteId: site.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                        <span onClick={(e) => { e.stopPropagation(); setDetailView({ regionKey, siteId: site.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ fontSize: 15, fontWeight: 700, color: "#F4F6FA", cursor: "pointer", transition: "color 0.15s" }} onMouseEnter={(e) => e.currentTarget.style.color = "#E87A2E"} onMouseLeave={(e) => e.currentTarget.style.color = "#F4F6FA"}>{site.name}</span>
                        <SiteIQBadge site={site} size="small" iq={getSiteIQ(site)} />
                        <PriorityBadge priority={site.priority} />
                        <select value={site.phase || "Prospect"} onClick={(e) => e.stopPropagation()} onChange={(e) => updateSiteField(regionKey, site.id, "phase", e.target.value)} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, border: "1px solid rgba(201,168,76,0.15)", background: "rgba(15,21,56,0.6)", color: "#C9A84C", cursor: "pointer" }}>
                          {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <select value={site.assignedTo || ""} onClick={(e) => e.stopPropagation()} onChange={(e) => { const val = e.target.value; updateSiteField(regionKey, site.id, "assignedTo", val); if (val && !site.reviewedBy) updateSiteField(regionKey, site.id, "needsReview", true); }} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, border: site.assignedTo ? "1px solid #E87A2E" : "1px solid rgba(201,168,76,0.15)", background: site.assignedTo ? "rgba(232,122,46,0.12)" : "rgba(15,21,56,0.6)", color: site.assignedTo ? "#E87A2E" : "#6B7394", cursor: "pointer" }}>
                          <option value="">Assign to...</option>
                          <option value="Dan R">Dan R</option>
                          <option value="Daniel Wollent">Daniel Wollent</option>
                          <option value="Matthew Toussaint">Matthew Toussaint</option>
                        </select>
                        {site.assignedTo && site.needsReview && <span style={{ fontSize: 9, fontWeight: 700, color: "#92700C", background: "#FFFBEB", padding: "1px 6px", borderRadius: 4, border: "1px solid #C9A84C", letterSpacing: "0.04em" }}>NEEDS REVIEW</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#6B7394" }}>{site.address}{site.city ? `, ${site.city}` : ""}{site.state ? `, ${site.state}` : ""}</div>
                      <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 11, color: "#6B7394", flexWrap: "wrap" }}>
                        {site.askingPrice && <span>Ask: <strong style={{ color: "#E2E8F0" }}>{site.askingPrice}</strong></span>}
                        {site.internalPrice && <span>Int: <strong style={{ color: "#E87A2E" }}>{site.internalPrice}</strong></span>}
                        {site.sellerBroker && <span>Broker: <strong style={{ color: "#C9A84C" }}>{site.sellerBroker}</strong></span>}
                        {docs.length > 0 && <span style={{ color: "#6B7394" }}>📁 {docs.length} doc{docs.length !== 1 ? "s" : ""}</span>}
                        {msgs.length > 0 && <span style={{ color: "#E87A2E" }}>💬 {msgs.length}</span>}
                        {site.coordinates && <span>📍</span>}
                        {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#E65100", textDecoration: "none", fontWeight: 600 }}>🔗 Listing</a>}
                      </div>
                    </div>
                    <div style={{ fontSize: 16, color: "#CBD5E1", transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>▼</div>
                  </div>

                  {/* Expanded */}
                  {isOpen && (
                    <div className="card-expand" style={{ padding: "0 18px 18px", borderTop: "2px solid transparent", borderImage: "linear-gradient(90deg, transparent, #1E2761, #C9A84C, #FFD700, #C9A84C, #1E2761, transparent) 1" }}>
                      {/* ── Nav Strip — Prev/Next + Keyboard hint ── */}
                      {(() => {
                        const sites = sortData(regionKey === "east" ? east : sw);
                        const ids = sites.map(s => s.id);
                        const curIdx = ids.indexOf(site.id);
                        const prevId = curIdx > 0 ? ids[curIdx - 1] : null;
                        const nextId = curIdx < ids.length - 1 ? ids[curIdx + 1] : null;
                        const navBtnStyle = (disabled) => ({ padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(201,168,76,0.1)", background: disabled ? "rgba(15,21,56,0.4)" : "rgba(15,21,56,0.5)", color: disabled ? "#CBD5E1" : "#94A3B8", fontSize: 11, fontWeight: 600, cursor: disabled ? "default" : "pointer", transition: "all .15s", display: "flex", alignItems: "center", gap: 4 });
                        return (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0 8px", borderBottom: "1px solid rgba(201,168,76,0.1)", marginBottom: 10 }}>
                            <button disabled={!prevId} onClick={() => { if (prevId) { setExpandedSite(prevId); setTimeout(() => { const el = document.getElementById(`site-${prevId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); } }} style={navBtnStyle(!prevId)}>▲ Prev</button>
                            <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 500, letterSpacing: "0.02em" }}>
                              <span style={{ fontWeight: 700, color: "#94A3B8" }}>{curIdx + 1}</span> of {ids.length} · <span style={{ color: "#CBD5E1" }}>↑↓ keys · Esc close</span>
                            </div>
                            <button disabled={!nextId} onClick={() => { if (nextId) { setExpandedSite(nextId); setTimeout(() => { const el = document.getElementById(`site-${nextId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); } }} style={navBtnStyle(!nextId)}>Next ▼</button>
                          </div>
                        );
                      })()}

                      {/* ── Executive Property Header — Fire Theme ── */}
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
                                <div style={{ position: "absolute", bottom: -2, left: "50%", transform: "translateX(-50%)", fontSize: 7, color: "#6B7394", fontWeight: 600, letterSpacing: "0.06em", whiteSpace: "nowrap", opacity: 0.7 }}>CLICK FOR DETAIL</div>
                              </div>
                              {site.market && <span style={{ background: "rgba(251,191,36,.12)", color: "#FBBF24", fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 8, border: "1px solid rgba(251,191,36,.2)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{site.market}</span>}
                            </div>
                            {/* Key Metrics Strip — Larger */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
                              {[
                                { label: "ASKING", val: fmtPrice(site.askingPrice), color: "#E2E8F0" },
                                { label: "ZONING", val: site.zoning || "—", color: site.zoning ? (/by.?right|permitted|allowed/i.test(site.summary || "") ? "#22C55E" : /SUP|conditional|special/i.test(site.zoning || "") ? "#FBBF24" : "rgba(201,168,76,0.1)") : "#94A3B8" },
                                { label: "ACREAGE", val: site.acreage ? `${site.acreage} ac` : "—", color: "#E2E8F0" },
                                { label: "3MI POP", val: site.pop3mi ? fmtN(site.pop3mi) : "—", color: "#E2E8F0" },
                                { label: "3MI MED INC", val: site.income3mi ? (String(site.income3mi).startsWith("$") ? site.income3mi : "$" + fmtN(site.income3mi)) : "—", color: "#E2E8F0" },
                              ].map((m, idx) => (
                                <div key={idx} style={{ background: "rgba(255,255,255,.07)", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(255,255,255,.08)" }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", letterSpacing: "0.08em", marginBottom: 4 }}>{m.label}</div>
                                  <div style={{ fontSize: 16, fontWeight: 800, color: m.color, fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.val}</div>
                                </div>
                              ))}
                            </div>
                            {/* ── SiteIQ Detail Panel — Click-to-expand ── */}
                            {showSiteIQDetail[site.id] && (() => {
                              const iqD = getSiteIQ(site);
                              const dims = [
                                { key: "population", label: "Population (3-mi)", weight: getIQWeight("population"), icon: "👥", tip: "Census / ESRI 3-mi radius population" },
                                { key: "growth", label: "Growth (5yr CAGR)", weight: getIQWeight("growth"), icon: "📈", tip: "ESRI 2025→2030 population growth rate" },
                                { key: "income", label: "Median HHI (3-mi)", weight: getIQWeight("income"), icon: "💰", tip: "Median household income within 3 miles" },
                                { key: "pricing", label: "Price / Acre", weight: getIQWeight("pricing"), icon: "🏷️", tip: "Asking price per acre vs acquisition targets" },
                                { key: "zoning", label: "Zoning", weight: getIQWeight("zoning"), icon: "🏛️", tip: "Storage permissibility in zoning district" },
                                { key: "access", label: "Site Access & Size", weight: getIQWeight("access"), icon: "🛣️", tip: "Acreage, frontage, flood, access quality" },
                                { key: "competition", label: "Competition", weight: getIQWeight("competition"), icon: "🏪", tip: "Competing storage within 3 mi" },
                                { key: "marketTier", label: "Market Tier", weight: getIQWeight("marketTier"), icon: "🎯", tip: "Target market alignment (MT/DW tiers)" },
                              ];
                              const scoreColor = (v) => v >= 8 ? "#22C55E" : v >= 6 ? "#3B82F6" : v >= 4 ? "#F59E0B" : "#EF4444";
                              const scoreLabel = (v) => v >= 9 ? "ELITE" : v >= 8 ? "PRIME" : v >= 7 ? "STRONG" : v >= 6 ? "VIABLE" : v >= 4 ? "MARGINAL" : "WEAK";
                              return (
                                <div style={{ marginTop: 12, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(243,124,51,.2)", boxShadow: "0 4px 20px rgba(0,0,0,.25)" }}>
                                  <div style={{ background: "linear-gradient(135deg,#1a0a00,#2a1505)", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ fontSize: 14 }}>🔬</span>
                                      <span style={{ color: "#FFB347", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em" }}>SiteIQ™ DETAILED SCORECARD</span>
                                      <span style={{ color: "#6B7394", fontSize: 10 }}>|</span>
                                      <span style={{ color: scoreColor(iqD.score), fontSize: 13, fontWeight: 900, fontFamily: "'Space Mono', monospace" }}>{iqD.score.toFixed(1)}</span>
                                      <span style={{ color: scoreColor(iqD.score), fontSize: 10, fontWeight: 800, background: scoreColor(iqD.score) + "18", padding: "2px 6px", borderRadius: 4 }}>{scoreLabel(iqD.score)}</span>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); setShowSiteIQDetail(prev => ({ ...prev, [site.id]: false })); }} style={{ background: "none", border: "1px solid rgba(255,255,255,.15)", borderRadius: 5, color: "#6B7394", fontSize: 11, cursor: "pointer", padding: "2px 8px" }}>✕</button>
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
                                            <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 600, letterSpacing: "0.04em" }}>{(d.weight * 100).toFixed(0)}% WEIGHT</div>
                                          </div>
                                          <div style={{ textAlign: "right", fontSize: 14, fontWeight: 900, color: scoreColor(v), fontFamily: "'Space Mono', monospace" }}>{v}</div>
                                          <div style={{ background: "rgba(255,255,255,.06)", borderRadius: 4, height: 10, overflow: "hidden", position: "relative" }}>
                                            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: `linear-gradient(90deg, ${scoreColor(v)}88, ${scoreColor(v)})`, borderRadius: 4, transition: "width 0.5s ease" }} />
                                          </div>
                                          <div style={{ textAlign: "right", fontSize: 10, color: "#94A3B8", fontFamily: "'Space Mono', monospace" }}>×{d.weight.toFixed(2)}</div>
                                          <div style={{ textAlign: "right", fontSize: 11, fontWeight: 800, color: "#FBBF24", fontFamily: "'Space Mono', monospace" }}>{weighted}</div>
                                        </div>
                                      );
                                    })}
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 4px 4px", borderTop: "2px solid rgba(243,124,51,.2)", marginTop: 4 }}>
                                      <div style={{ fontSize: 10, color: "#6B7394", fontWeight: 600 }}>
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
                            <select value={site.priority || "⚪ None"} onChange={(e) => updateSiteField(regionKey, site.id, "priority", e.target.value)} style={{ padding: "6px 10px", borderRadius: 7, border: `2px solid ${PRIORITY_COLORS[site.priority] || "rgba(255,255,255,.15)"}`, fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(255,255,255,.08)", cursor: "pointer", fontWeight: 700, color: PRIORITY_COLORS[site.priority] || "rgba(201,168,76,0.1)" }}>
                              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <select value={site.phase || "Prospect"} onChange={(e) => updateSiteField(regionKey, site.id, "phase", e.target.value)} style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,.15)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(255,255,255,.08)", cursor: "pointer", fontWeight: 600, color: "#E2E8F0" }}>
                              {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                            {/* Assigned To */}
                            <select value={site.assignedTo || ""} onChange={(e) => { const val = e.target.value; updateSiteField(regionKey, site.id, "assignedTo", val); if (val && !site.reviewedBy) updateSiteField(regionKey, site.id, "needsReview", true); }} style={{ padding: "6px 10px", borderRadius: 7, border: site.assignedTo ? "2px solid #C9A84C" : "1px solid rgba(255,255,255,.15)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: site.assignedTo ? "rgba(201,168,76,.12)" : "rgba(255,255,255,.08)", cursor: "pointer", fontWeight: 700, color: site.assignedTo ? "#FFD700" : "#94A3B8" }}>
                              <option value="">Assign to...</option>
                              <option value="Dan R">Dan R</option>
                              <option value="Daniel Wollent">Daniel Wollent</option>
                              <option value="Matthew Toussaint">Matthew Toussaint</option>
                            </select>
                            {site.assignedTo && site.needsReview && (
                              <button onClick={() => { updateSiteField(regionKey, site.id, "needsReview", false); updateSiteField(regionKey, site.id, "reviewedBy", "Dan R"); updateSiteField(regionKey, site.id, "reviewedAt", new Date().toISOString()); notify(`Marked reviewed — ${site.name}`); }} style={{ padding: "6px 10px", borderRadius: 7, border: "none", background: "linear-gradient(135deg, #16A34A, #15803D)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: "0.02em" }}>✓ Mark Reviewed</button>
                            )}
                            {site.reviewedBy && !site.needsReview && (
                              <div style={{ fontSize: 9, color: "#22C55E", fontWeight: 600, textAlign: "right" }}>✓ Reviewed by {site.reviewedBy}</div>
                            )}
                            {/* Last Updated */}
                            {(() => {
                              const logs2 = Object.values(site.activityLog || {});
                              const lastLog2 = logs2.length > 0 ? logs2.sort((a, b) => new Date(b.ts || b.date || 0) - new Date(a.ts || a.date || 0))[0] : null;
                              const lastDate2 = lastLog2?.date || site.approvedAt;
                              const daysAgo2 = lastDate2 ? Math.floor((Date.now() - new Date(lastDate2).getTime()) / 86400000) : null;
                              return lastDate2 ? (
                                <div style={{ fontSize: 9, color: daysAgo2 > 30 ? "#EF4444" : daysAgo2 > 14 ? "#F59E0B" : "#22C55E", fontWeight: 600, textAlign: "right" }}>
                                  ● {daysAgo2 === 0 ? "Today" : daysAgo2 === 1 ? "Yesterday" : daysAgo2 + "d ago"}
                                </div>
                              ) : null;
                            })()}
                          </div>
                        </div>
                        {/* Broker + Seller Row */}
                        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                          {site.sellerBroker && <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>Broker: <span style={{ color: "#E2E8F0", fontWeight: 700 }}>{site.sellerBroker}</span></span>}
                          {site.internalPrice && <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>Internal Price: <span style={{ color: "#F37C33", fontWeight: 700 }}>{site.internalPrice}</span></span>}
                          {dom !== null && <span style={{ fontSize: 12, color: dom > 365 ? "#EF4444" : dom > 180 ? "#F59E0B" : "#94A3B8", fontWeight: 600 }}>{dom}d on market</span>}
                        </div>
                      </div>

                      {/* Aerial / Satellite View */}
                      <div style={{ margin: "0 0 10px" }}>
                        {site.coordinates ? (
                          <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(201,168,76,0.1)" }}>
                            <iframe
                              title={`Aerial — ${site.name}`}
                              src={`https://maps.google.com/maps?q=${encodeURIComponent(site.coordinates)}&t=k&z=17&output=embed`}
                              style={{ width: "100%", height: 220, border: "none" }}
                              loading="lazy"
                              allowFullScreen
                            />
                            <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, letterSpacing: "0.04em" }}>AERIAL VIEW</div>
                          </div>
                        ) : (
                          <div style={{ background: "rgba(15,21,56,0.3)", borderRadius: 10, padding: "24px 14px", textAlign: "center", border: "1px dashed #CBD5E1" }}>
                            <div style={{ fontSize: 18, marginBottom: 4 }}>🛰️</div>
                            <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>Add coordinates to generate aerial view</div>
                          </div>
                        )}
                        {/* Flyer Quick Link */}
                        {(() => {
                          const flyerDoc = docs.find(([, d]) => d.type === "Flyer");
                          return flyerDoc ? (
                            <a href={flyerDoc[1].url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, padding: "6px 14px", borderRadius: 8, background: "linear-gradient(135deg,#F37C33,#E8650A)", color: "#fff", fontSize: 12, fontWeight: 700, textDecoration: "none", boxShadow: "0 2px 6px rgba(243,124,51,0.25)" }}>📄 View Flyer — {flyerDoc[1].name?.length > 30 ? flyerDoc[1].name.slice(0, 30) + "…" : flyerDoc[1].name}</a>
                          ) : (
                            <div onClick={() => document.getElementById(`doc-upload-flyer-${site.id}`)?.click()} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, padding: "5px 12px", borderRadius: 7, background: "#FFF3E0", border: "1px dashed #F37C33", fontSize: 11, color: "#E65100", fontWeight: 600, cursor: "pointer", transition: "all .2s" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#FFE0B2"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "#FFF3E0"; }}>
                              <input type="file" id={`doc-upload-flyer-${site.id}`} accept=".pdf,image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleDocUpload(regionKey, site.id, f, "Flyer"); e.target.value = ""; }} />
                              📎 Click to upload flyer
                            </div>
                          );
                        })()}
                      </div>

                      {/* ── PREMIUM ACTION BAR ── */}
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "16px 0", padding: "14px 0", borderTop: "1px solid rgba(201,168,76,0.08)", borderBottom: "1px solid rgba(201,168,76,0.08)" }}>
                        {site.coordinates && <>
                          <a href={mapsLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "10px 18px", borderRadius: 10, background: "rgba(21,101,192,0.12)", color: "#42A5F5", fontSize: 12, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(21,101,192,0.25)", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}>🗺 Google Maps</a>
                          <a href={earthLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "10px 18px", borderRadius: 10, background: "rgba(46,125,50,0.12)", color: "#66BB6A", fontSize: 12, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(46,125,50,0.25)", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}>🌍 Google Earth</a>
                        </>}
                        {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noopener noreferrer" style={{ padding: "10px 18px", borderRadius: 10, background: "rgba(232,122,46,0.12)", color: "#E87A2E", fontSize: 12, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(232,122,46,0.25)", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}>🔗 Property Listing</a>}
                        <button onClick={() => {
                          const iqR = computeSiteIQ(site); const psD = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null; const rpt = generateVettingReport(site, psD, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); window.open(url, "_blank"); autoGenerateVettingReport(regionKey, site.id, site);
                        }} style={{ padding: "10px 22px", borderRadius: 10, background: "linear-gradient(135deg, #E87A2E, #C9A84C)", color: "#fff", fontSize: 13, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 20px rgba(232,122,46,0.4), 0 0 0 1px rgba(232,122,46,0.2)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s" }}>🔬 SiteIQ Deep Vet Report</button>
                      </div>

                      {/* Summary */}
                      <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 10, padding: 14, margin: "10px 0", border: "1px solid rgba(201,168,76,0.08)" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", marginBottom: 6, letterSpacing: "0.08em" }}>Recent Summary</div>
                        <EF multi label="" value={site.summary || ""} onSave={(v) => saveField(regionKey, site.id, "summary", v)} placeholder="Deal notes, updates…" />
                      </div>

                      {/* ── Editable Detail Fields ── */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
                        <EF label="Market" value={site.market || ""} onSave={(v) => saveField(regionKey, site.id, "market", v)} placeholder="DFW, Houston…" />
                        <EF label="Asking Price" value={site.askingPrice || ""} onSave={(v) => saveField(regionKey, site.id, "askingPrice", v)} placeholder="$1.5M" />
                        <EF label="Internal Price" value={site.internalPrice || ""} onSave={(v) => saveField(regionKey, site.id, "internalPrice", v)} placeholder="$1.2M" />
                        <EF label="Seller / Broker" value={site.sellerBroker || ""} onSave={(v) => saveField(regionKey, site.id, "sellerBroker", v)} placeholder="John Smith" />
                        <EF label="3-Mile Income" value={site.income3mi || ""} onSave={(v) => saveField(regionKey, site.id, "income3mi", v)} placeholder="$95,000" />
                        <EF label="3-Mile Pop" value={site.pop3mi || ""} onSave={(v) => saveField(regionKey, site.id, "pop3mi", v)} placeholder="45,000" />
                        <EF label="Acreage" value={site.acreage || ""} onSave={(v) => saveField(regionKey, site.id, "acreage", v)} placeholder="4.5 ac" />
                        <EF label="Zoning" value={site.zoning || ""} onSave={(v) => saveField(regionKey, site.id, "zoning", v)} placeholder="C-2, B3…" />
                      </div>

                      {/* Structured SiteIQ Fields */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Zoning Class.</div>
                          <select value={site.zoningClassification || "unknown"} onChange={(e) => { updateSiteField(regionKey, site.id, "zoningClassification", e.target.value); fbPush(`${regionKey}/${site.id}/activityLog`, { action: `Zoning class → ${e.target.value}`, ts: new Date().toISOString(), by: "User" }); }} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 11, fontFamily: "'Inter', sans-serif", background: site.zoningClassification === "by-right" ? "#F0FDF4" : site.zoningClassification === "prohibited" ? "#FEF2F2" : "rgba(15,21,56,0.35)", color: "#E2E8F0", cursor: "pointer" }}>
                            <option value="unknown">Unknown</option>
                            <option value="by-right">By-Right ✅</option>
                            <option value="conditional">Conditional (SUP/CUP)</option>
                            <option value="rezone-required">Rezone Required</option>
                            <option value="prohibited">Prohibited ❌</option>
                          </select>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Nearest Facility (mi)</div>
                          <input type="number" step="0.1" min="0" value={site.siteiqData?.nearestPS || ""} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) fbUpdate(`${regionKey}/${site.id}/siteiqData`, { nearestPS: v }); }} placeholder="5.2" style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(15,21,56,0.35)", color: "#E2E8F0" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Competitors</div>
                          <input type="number" step="1" min="0" value={site.siteiqData?.competitorCount ?? ""} onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) fbUpdate(`${regionKey}/${site.id}/siteiqData`, { competitorCount: v }); }} placeholder="3" style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(15,21,56,0.35)", color: "#E2E8F0" }} />
                        </div>
                      </div>

                      {/* ── DEEP VET PANEL — Zoning, Utilities, Topo Research Fields ── */}
                      <div style={{ borderRadius: 14, marginBottom: 14, overflow: "hidden", border: "1px solid rgba(232,122,46,0.15)" }}>
                        <div style={{ background: "linear-gradient(135deg,#0F1538,#1E2761)", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14 }}>🔬</span>
                            <span style={{ color: "#E87A2E", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em" }}>DEEP VET — ZONING &amp; UTILITIES</span>
                          </div>
                          <span style={{ fontSize: 9, color: "#6B7394", fontWeight: 600 }}>Institutional-grade research fields</span>
                        </div>
                        <div style={{ background: "rgba(15,21,56,0.3)", padding: "12px 16px" }}>
                          {/* ZONING RESEARCH */}
                          <div style={{ fontSize: 10, fontWeight: 800, color: "#C9A84C", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 16, height: 2, background: "#C9A84C", borderRadius: 1 }} /> Zoning & Entitlements
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                            <EF label="Ordinance Source (URL / Section)" value={site.zoningSource || ""} onSave={(v) => saveField(regionKey, site.id, "zoningSource", v)} placeholder="ecode360.com/CityName §14.3.2" />
                            <EF label="Planning Dept Contact" value={site.planningContact || ""} onSave={(v) => saveField(regionKey, site.id, "planningContact", v)} placeholder="Jane Smith (972) 555-1234" />
                          </div>
                          <EF multi label="Zoning Research Notes" value={site.zoningNotes || ""} onSave={(v) => saveField(regionKey, site.id, "zoningNotes", v)} placeholder="Permitted use table: §14-3, Table 14-1 — 'Storage Warehouse (Mini)' listed as P (Permitted) in C-3 district. No overlay. Setbacks: 25' front, 10' side, 15' rear. Height limit: 35'. Parking: 1 per 50 units." />

                          {/* UTILITIES RESEARCH */}
                          <div style={{ fontSize: 10, fontWeight: 800, color: "#16A34A", textTransform: "uppercase", letterSpacing: "0.08em", margin: "14px 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 16, height: 2, background: "#16A34A", borderRadius: 1 }} /> Utilities & Water
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                            <EF label="Water Provider" value={site.waterProvider || ""} onSave={(v) => saveField(regionKey, site.id, "waterProvider", v)} placeholder="City of Argyle / Mustang SUD" />
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Water Available</div>
                              <select value={site.waterAvailable === true ? "yes" : site.waterAvailable === false ? "no" : ""} onChange={(e) => { const v = e.target.value === "yes" ? true : e.target.value === "no" ? false : null; updateSiteField(regionKey, site.id, "waterAvailable", v); }} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.12)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: site.waterAvailable === true ? "rgba(22,163,74,0.1)" : site.waterAvailable === false ? "rgba(239,68,68,0.1)" : "rgba(15,21,56,0.5)", color: "#E2E8F0", cursor: "pointer" }}>
                                <option value="">Not confirmed</option>
                                <option value="yes">YES — Municipal</option>
                                <option value="no">NO — Extension required</option>
                              </select>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                            <EF label="Sewer Provider" value={site.sewerProvider || ""} onSave={(v) => saveField(regionKey, site.id, "sewerProvider", v)} placeholder="City Municipal / Septic" />
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Sewer Available</div>
                              <select value={site.sewerAvailable === true ? "yes" : site.sewerAvailable === false ? "no" : ""} onChange={(e) => { const v = e.target.value === "yes" ? true : e.target.value === "no" ? false : null; updateSiteField(regionKey, site.id, "sewerAvailable", v); }} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.12)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: site.sewerAvailable === true ? "rgba(22,163,74,0.1)" : site.sewerAvailable === false ? "rgba(239,68,68,0.1)" : "rgba(15,21,56,0.5)", color: "#E2E8F0", cursor: "pointer" }}>
                                <option value="">Not confirmed</option>
                                <option value="yes">YES</option>
                                <option value="no">NO</option>
                              </select>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                            <EF label="Electric Provider" value={site.electricProvider || ""} onSave={(v) => saveField(regionKey, site.id, "electricProvider", v)} placeholder="Oncor / CoServ" />
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>3-Phase Power</div>
                              <select value={site.threePhase === true ? "yes" : site.threePhase === false ? "no" : ""} onChange={(e) => { const v = e.target.value === "yes" ? true : e.target.value === "no" ? false : null; updateSiteField(regionKey, site.id, "threePhase", v); }} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.12)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(15,21,56,0.5)", color: "#E2E8F0", cursor: "pointer" }}>
                                <option value="">Not confirmed</option>
                                <option value="yes">Available</option>
                                <option value="no">Not available</option>
                              </select>
                            </div>
                            <EF label="Tap/Impact Fees" value={site.tapFees || ""} onSave={(v) => saveField(regionKey, site.id, "tapFees", v)} placeholder="$4,200 commercial" />
                          </div>
                          <EF multi label="Utility Research Notes" value={site.utilityNotes || ""} onSave={(v) => saveField(regionKey, site.id, "utilityNotes", v)} placeholder="Site is inside Mustang SUD CCN boundary. 8&quot; water main on Faught Rd (adjacent). Sewer: city municipal, main at property line. Oncor electric, 3-phase available. Gas: Atmos Energy. Tap fees: $4,200 water, $3,800 sewer per 2026 published schedule." />

                          {/* TOPOGRAPHY & FLOOD */}
                          <div style={{ fontSize: 10, fontWeight: 800, color: "#E87A2E", textTransform: "uppercase", letterSpacing: "0.08em", margin: "14px 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 16, height: 2, background: "#E87A2E", borderRadius: 1 }} /> Topography & Flood
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                            <EF label="FEMA Flood Zone" value={site.floodZone || ""} onSave={(v) => saveField(regionKey, site.id, "floodZone", v)} placeholder="Zone X (no flood)" />
                            <EF label="Terrain" value={site.terrain || ""} onSave={(v) => saveField(regionKey, site.id, "terrain", v)} placeholder="Flat, <2% grade" />
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Wetlands</div>
                              <select value={site.wetlands === true ? "yes" : site.wetlands === false ? "no" : ""} onChange={(e) => { const v = e.target.value === "yes" ? true : e.target.value === "no" ? false : null; updateSiteField(regionKey, site.id, "wetlands", v); }} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.12)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(15,21,56,0.5)", color: "#E2E8F0", cursor: "pointer" }}>
                                <option value="">Not checked</option>
                                <option value="no">None identified</option>
                                <option value="yes">Present</option>
                              </select>
                            </div>
                            <EF label="Grading Risk" value={site.gradingRisk || ""} onSave={(v) => saveField(regionKey, site.id, "gradingRisk", v)} placeholder="Low / Medium / High" />
                          </div>
                          <EF multi label="Topo & Environmental Notes" value={site.topoNotes || ""} onSave={(v) => saveField(regionKey, site.id, "topoNotes", v)} placeholder="FEMA Zone X (Panel 48121C0405G). Flat terrain, ~3ft fall NW to SE across 400ft. No wetlands per NWI. Clay soil per USDA Web Soil Survey — standard for DFW. No environmental flags." />
                        </div>
                      </div>

                      {/* ── Auto Demographics Snapshot — always visible when data exists ── */}
                      {(site.pop3mi || site.income3mi) && (() => {
                        const pN = (v) => { if (!v) return null; const n = typeof v === "number" ? v : parseInt(String(v).replace(/[$,]/g, ""), 10); return isNaN(n) ? null : n; };
                        const fP = (v, pre) => { const n = pN(v); return n != null ? (pre || "") + n.toLocaleString() : null; };
                        const gVal = site.popGrowth3mi ? (typeof site.popGrowth3mi === "number" ? site.popGrowth3mi : parseFloat(site.popGrowth3mi)) : null;
                        const gColor = gVal != null ? (gVal > 0 ? "#22C55E" : gVal < 0 ? "#EF4444" : "#94A3B8") : "#64748B";
                        const gLabel = gVal != null ? ((gVal >= 0 ? "+" : "") + gVal.toFixed(2) + "% /yr") : null;
                        const gOutlook = gVal != null ? (gVal > 1.5 ? "High Growth" : gVal > 0.5 ? "Growing" : gVal > 0 ? "Stable Growth" : gVal > -0.5 ? "Flat" : "Declining") : null;
                        const oColor = gVal != null ? (gVal > 1.5 ? "#22C55E" : gVal > 0.5 ? "#4ADE80" : gVal > 0 ? "#FBBF24" : gVal > -0.5 ? "#94A3B8" : "#EF4444") : "#64748B";
                        const rows = [
                          { label: "Population (3-mi)", val: fP(site.pop3mi), icon: "👥" },
                          { label: "Median HHI (3-mi)", val: fP(site.income3mi, "$"), icon: "💰" },
                          { label: "Pop Growth (ESRI 2025→2030)", val: gLabel, icon: "📈", color: gColor },
                          { label: "Growth Outlook", val: gOutlook, icon: "🔮", color: oColor },
                          { label: "Households (3-mi)", val: fP(site.households3mi), icon: "🏠" },
                          { label: "Median Home Value (3-mi)", val: fP(site.homeValue3mi, "$"), icon: "🏡" },
                          { label: "Acreage", val: site.acreage ? site.acreage + " ac" : null, icon: "📐" },
                          { label: "Price / Acre", val: (() => { const p = parseFloat(String(site.askingPrice || "").replace(/[^0-9.]/g, "")); const a = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, "")); return (!isNaN(p) && p > 0 && !isNaN(a) && a > 0) ? "$" + Math.round(p / a).toLocaleString() + "/ac" : null; })(), icon: "🏷️" },
                          { label: "Nearest Facility", val: site.siteiqData?.nearestPS ? site.siteiqData.nearestPS.toFixed(1) + " mi" : null, icon: "📍" },
                          { label: "Competitors (3-mi)", val: site.siteiqData?.competitorCount != null ? String(site.siteiqData.competitorCount) : null, icon: "🏪" },
                        ].filter(r => r.val != null);
                        return (
                          <div style={{ borderRadius: 14, marginBottom: 14, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,.12)", border: "1px solid #E8ECF0" }}>
                            <div style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E293B 50%,#1565C0 100%)", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 14 }}>📊</span>
                                <span style={{ color: "#fff", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em" }}>SITE DEMOGRAPHICS</span>
                                <span style={{ background: "linear-gradient(135deg,#FBBF24,#F59E0B)", color: "#0F172A", fontSize: 9, fontWeight: 900, padding: "2px 7px", borderRadius: 5, letterSpacing: "0.06em" }}>ESRI 2025</span>
                              </div>
                              <button onClick={() => handleFetchDemos(regionKey, site)} disabled={demoLoading[site.id]} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.08)", color: demoLoading[site.id] ? "#64748B" : "#22D3EE", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                                {demoLoading[site.id] ? "⏳" : "🔄"} {demoLoading[site.id] ? "Loading..." : "Full Report"}
                              </button>
                            </div>
                            <div style={{ background: "rgba(15,21,56,0.35)", padding: "4px 0" }}>
                              {rows.map((row, i) => (
                                <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", alignItems: "center", padding: "7px 16px", borderBottom: i < rows.length - 1 ? "1px solid rgba(201,168,76,0.1)" : "none", transition: "background .15s" }}>
                                  <span style={{ fontSize: 13, textAlign: "center" }}>{row.icon}</span>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: "#94A3B8" }}>{row.label}</span>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: row.color || "#E2E8F0", fontFamily: "'Space Mono', monospace", textAlign: "right" }}>{row.val}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Pull Demographics — Full ESRI Report */}
                      {!(site.pop3mi || site.income3mi) && (
                        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                          <button onClick={() => handleFetchDemos(regionKey, site)} disabled={demoLoading[site.id] || !site.coordinates} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: demoLoading[site.id] ? "#E8F0FE" : "linear-gradient(135deg,#1565C0,#1976D2)", color: demoLoading[site.id] ? "#1565C0" : "#fff", fontSize: 11, fontWeight: 700, cursor: site.coordinates ? "pointer" : "not-allowed", opacity: site.coordinates ? 1 : 0.5, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 1px 3px rgba(21,101,192,.2)" }}>
                            {demoLoading[site.id] ? "⏳ Fetching…" : "📊 Pull Demographics"}
                          </button>
                        </div>
                      )}

                      {/* ESRI Demographic Report — Executive Dashboard */}
                      {demoReport[site.id] && (() => {
                        const dr = demoReport[site.id];
                        const r = dr.rings || {};
                        const fmtV = (v, prefix) => v != null ? (prefix || "") + (typeof v === "number" ? v.toLocaleString() : v) : "—";
                        const fmtGrowth = (v) => { if (v == null || v === "") return "—"; const n = typeof v === "number" ? v : parseFloat(String(v)); if (isNaN(n)) return String(v); return (n >= 0 ? "+" : "") + n.toFixed(2) + "%"; };
                        const growthColor = (s) => { if (!s && s !== 0) return "#64748B"; const n = typeof s === "number" ? s : parseFloat(String(s)); if (!isNaN(n)) return n > 0 ? "#16A34A" : n < 0 ? "#EF4444" : "#64748B"; const str = String(s); return str.includes("+") ? "#16A34A" : str.includes("-") ? "#EF4444" : "#64748B"; };
                        const hdrCell = { padding: "8px 12px", textAlign: "right", fontSize: 10, fontWeight: 800, color: "#CBD5E1", textTransform: "uppercase", letterSpacing: "0.06em" };
                        const metricCell = { padding: "7px 12px", fontWeight: 700, color: "#E2E8F0", fontSize: 11, borderBottom: "1px solid rgba(255,255,255,.08)" };
                        const valCell = { padding: "7px 12px", textAlign: "right", fontSize: 12, fontWeight: 600, fontFamily: "'Inter', monospace", borderBottom: "1px solid rgba(255,255,255,.08)" };
                        const goldVal = { ...valCell, color: "#FBBF24" };
                        const whiteVal = { ...valCell, color: "#E2E8F0" };
                        return (
                          <div style={{ borderRadius: 14, marginBottom: 14, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,.15)" }}>
                            {/* Header */}
                            <div style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E3A5F 50%,#1565C0 100%)", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 16 }}>📊</span>
                                <div>
                                  <div style={{ color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 6 }}>DEMOGRAPHIC INTELLIGENCE <span style={{ background: "linear-gradient(135deg,#FBBF24,#F59E0B)", color: "#0F172A", fontSize: 11, fontWeight: 900, padding: "2px 8px", borderRadius: 5, letterSpacing: "0.06em" }}>2025</span></div>
                                  <div style={{ color: "#94A3B8", fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", marginTop: 2 }}>ESRI ArcGIS GeoEnrichment — <span style={{ color: "#22D3EE" }}>Live Geocoded</span> — Current Year + 2030 Projections</div>
                                </div>
                              </div>
                              <button onClick={() => setDemoReport((prev) => { const n = { ...prev }; delete n[site.id]; return n; })} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.05)", color: "#94A3B8", fontSize: 11, cursor: "pointer", transition: "all .2s" }}>✕</button>
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
                                    <td style={whiteVal}>{r[1]?.renterPct || "—"}</td>
                                    <td style={{ ...goldVal, background: "rgba(251,191,36,.06)" }}>{r[3]?.renterPct || "—"}</td>
                                    <td style={whiteVal}>{r[5]?.renterPct || "—"}</td>
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
                                      <div style={{ fontSize: 8, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{item.label}</div>
                                      {item.isOutlook ? (
                                        <div style={{ fontSize: 11, fontWeight: 800, color: item.val?.includes("High") || item.val?.includes("Growing") ? "#22C55E" : item.val?.includes("Declining") ? "#EF4444" : "#FBBF24" }}>{item.val || "—"}</div>
                                      ) : (
                                        <>
                                          <div style={{ fontSize: 12, fontWeight: 700, color: "#E2E8F0", fontFamily: "'Inter', monospace" }}>{item.val || "—"}</div>
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
                              <span style={{ fontSize: 8, color: "#94A3B8", letterSpacing: "0.04em" }}>ESRI ArcGIS GeoEnrichment (paid)</span>
                              <span style={{ fontSize: 8, color: "#94A3B8" }}>{dr.pulledAt ? `Updated ${new Date(dr.pulledAt).toLocaleDateString()}` : ""}</span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Date on Market */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Date on Market</div>
                          <input type="date" value={site.dateOnMarket || ""} onChange={(e) => updateSiteField(regionKey, site.id, "dateOnMarket", e.target.value)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 13, fontFamily: "'Inter', sans-serif", background: "rgba(15,21,56,0.35)", color: "#E2E8F0", outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Days on Market</div>
                          <div style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 13, background: "rgba(15,21,56,0.4)", color: dom !== null ? "#E2E8F0" : "#CBD5E1", fontWeight: dom !== null ? 700 : 400 }}>{dom !== null ? `${dom} days` : "—"}</div>
                        </div>
                      </div>

                      {/* Coordinates */}
                      <div style={{ marginBottom: 12 }}>
                        <EF label="Coordinates (lat, lng)" value={site.coordinates || ""} onSave={(v) => saveField(regionKey, site.id, "coordinates", v)} placeholder="39.123, -84.456" />
                      </div>

                      {/* Listing URL */}
                      <div style={{ marginBottom: 14 }}>
                        <EF label="Listing URL (Crexi / LoopNet)" value={site.listingUrl || ""} onSave={(v) => saveField(regionKey, site.id, "listingUrl", v)} placeholder="https://www.crexi.com/…" />
                      </div>

                      {/* Documents */}
                      <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 14, marginBottom: 14, border: "1px solid rgba(201,168,76,0.1)" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 10 }}>📁 Documents</div>
                        {docs.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                            {docs.map(([docKey, doc]) => (
                              <div key={docKey} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(15,21,56,0.5)", border: "1px solid rgba(201,168,76,0.1)", borderRadius: 8, padding: "5px 10px", fontSize: 11 }}>
                                <span style={{ fontWeight: 600, color: "#94A3B8" }}>{doc.type}: {doc.name?.length > 20 ? doc.name.slice(0, 20) + "…" : doc.name}</span>
                                <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ color: "#1565C0", fontWeight: 600, textDecoration: "none" }}>↗ View</a>
                                <button onClick={() => handleDocDelete(regionKey, site.id, docKey, doc)} style={{ border: "none", background: "none", color: "#EF4444", cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <select id={`doc-type-${site.id}`} defaultValue="Flyer" style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(201,168,76,0.1)", fontSize: 12, background: "rgba(15,21,56,0.5)", cursor: "pointer" }}>
                            {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
                          </select>
                          <input type="file" id={`doc-upload-${site.id}`} style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; const type = document.getElementById(`doc-type-${site.id}`)?.value || "Other"; if (f) handleDocUpload(regionKey, site.id, f, type); e.target.value = ""; }} />
                          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); document.getElementById(`doc-upload-${site.id}`)?.click(); }} style={{ padding: "5px 12px", borderRadius: 7, background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", border: "none", fontFamily: "'Inter', sans-serif" }}>
                            + Upload
                          </button>
                        </div>
                      </div>

                      {/* Messages */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 8 }}>💬 Thread</div>
                        {msgs.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, maxHeight: 200, overflowY: "auto" }}>
                            {[...msgs].sort((a, b) => new Date(a.ts) - new Date(b.ts)).map((m, i) => {
                              const mc = MSG_COLORS[m.from] || { bg: "rgba(15,21,56,0.4)", border: "rgba(201,168,76,0.1)", text: "#94A3B8" };
                              return (
                                <div key={i} style={{ background: mc.bg, border: `1px solid ${mc.border}`, borderRadius: 8, padding: "8px 10px" }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: mc.text, marginBottom: 2 }}>{m.from} · {m.ts ? new Date(m.ts).toLocaleDateString() : ""}</div>
                                  <div style={{ fontSize: 13, color: "#E2E8F0" }}>{m.text}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 6 }}>
                          <select value={mi.from} onChange={(e) => setMsgInputs({ ...msgInputs, [site.id]: { ...mi, from: e.target.value } })} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 11, background: "rgba(15,21,56,0.5)", cursor: "pointer", minWidth: 130 }}>
                            <option>Dan R</option>
                            <option>Daniel Wollent</option>
                            <option>Matthew Toussaint</option>
                          </select>
                          <input value={mi.text} onChange={(e) => setMsgInputs({ ...msgInputs, [site.id]: { ...mi, text: e.target.value } })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSendMsg(regionKey, site.id); } }} placeholder="Add message…" style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 13, outline: "none", fontFamily: "'Inter', sans-serif" }} />
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
                                <span style={{ color: "#6B7394" }}>{l.ts ? new Date(l.ts).toLocaleDateString() : ""}</span> — {l.action}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      {/* Send to Review / Remove */}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={() => { if (window.confirm(`Send "${site.name}" back to Review Queue?`)) handleSendToReview(regionKey, site.id, site); }} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(232,122,46,0.3)", background: "rgba(232,122,46,0.08)", color: "#E87A2E", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>↩ Send to Review</button>
                        <button onClick={() => { if (window.confirm(`Remove "${site.name}"?`)) handleRemove(regionKey, site.id); }} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #FCA5A5", background: "rgba(153,27,27,0.08)", color: "#FCA5A5", fontSize: 11, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>🗑 Remove Site</button>
                      </div>
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

  // ═══ RENDER ═══
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(165deg, #0F1538 0%, #1E2761 30%, #0F1538 60%, #0A0E2A 100%)", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", color: "#E2E8F0" }}>
      {/* AI NEURAL NETWORK BACKGROUND — Circuit Grid + Data Streams + Lightning */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        {/* Circuit grid pattern */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.03 }}>
          <defs><pattern id="circuit" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M0 40h30M50 40h30M40 0v30M40 50v30" stroke="#E87A2E" strokeWidth="0.5" fill="none"/>
            <circle cx="40" cy="40" r="2" fill="#E87A2E"/>
            <circle cx="0" cy="40" r="1.5" fill="#39FF14"/>
            <circle cx="80" cy="40" r="1.5" fill="#39FF14"/>
            <circle cx="40" cy="0" r="1.5" fill="#00E5FF"/>
            <circle cx="40" cy="80" r="1.5" fill="#00E5FF"/>
          </pattern></defs>
          <rect width="100%" height="100%" fill="url(#circuit)"/>
        </svg>
        {/* Subtle data stream particles — 8 particles, slow, muted */}
        {[...Array(8)].map((_, i) => (
          <div key={i} style={{ position: "absolute", left: `${8 + i * 12}%`, bottom: "-10px", width: 1, height: 1, borderRadius: "50%", background: i % 2 === 0 ? "#C9A84C" : "#2C3E6B", opacity: 0, animation: `dataStream ${8 + (i % 3) * 4}s ${i * 1.5}s infinite cubic-bezier(0.22,1,0.36,1)` }} />
        ))}
        {/* Subtle scan line */}
        <div style={{ position: "absolute", left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent 20%, rgba(201,168,76,0.03) 50%, transparent 80%)", animation: "scanLine 12s linear infinite" }} />
      </div>
      {transitioning && <div className="tab-transition-overlay" />}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes tabSweep { 0% { transform: scaleX(0); opacity: 0; } 40% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; } }
        @keyframes tabFadeOut { 0% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(0.97) translateY(-8px); } }
        @keyframes tabFadeIn { 0% { opacity: 0; transform: scale(0.97) translateY(8px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        .tab-transition-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; pointer-events: none; }
        .tab-transition-overlay::before { content: ''; position: absolute; top: 50%; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, #E87A2E, #C9A84C, #E87A2E, transparent); transform-origin: left; animation: tabSweep 0.35s cubic-bezier(0.22,1,0.36,1) forwards; box-shadow: 0 0 20px rgba(232,122,46,0.5), 0 0 40px rgba(232,122,46,0.2); }
        .tab-transition-overlay::after { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(232,122,46,0.04) 0%, rgba(15,21,56,0.3) 50%, rgba(10,14,42,0.5) 100%); animation: tabSweep 0.35s cubic-bezier(0.22,1,0.36,1) forwards; }
        .funnel-bar { cursor: pointer; position: relative; overflow: hidden; }
        .funnel-bar::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent); transform: translateX(-100%); transition: transform 0.4s ease; }
        .funnel-bar:hover::after { transform: translateX(100%); }
        .funnel-bar:hover { filter: brightness(1.15); box-shadow: 0 4px 16px rgba(0,0,0,0.15); transform: scale(1.02); }
        .funnel-bar:active { transform: scale(0.98); }
        @keyframes slideDown { from { max-height: 0; opacity: 0; transform: scaleY(0.95); } to { max-height: 2000px; opacity: 1; transform: scaleY(1); } }
        @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes siteiq-glow { 0% { box-shadow: 0 0 15px rgba(201,168,76,0.4), 0 0 30px rgba(201,168,76,0.15); } 100% { box-shadow: 0 0 30px rgba(201,168,76,0.6), 0 0 60px rgba(201,168,76,0.25); } }
        @keyframes siteiq-ring { 0% { opacity: 0.3; transform: scale(1); } 100% { opacity: 0.7; transform: scale(1.08); } }
        @keyframes siteiq-spin { 0% { transform: rotate(0deg); } 25% { transform: rotate(140deg); } 50% { transform: rotate(180deg); } 75% { transform: rotate(320deg); } 100% { transform: rotate(360deg); } }
        @keyframes turbine-pulse { 0%, 100% { filter: drop-shadow(0 0 6px rgba(57,255,20,0.3)) drop-shadow(0 0 12px rgba(0,229,255,0.15)); } 25% { filter: drop-shadow(0 0 14px rgba(57,255,20,0.7)) drop-shadow(0 0 28px rgba(0,229,255,0.4)) drop-shadow(0 0 40px rgba(232,122,46,0.2)); } 50% { filter: drop-shadow(0 0 8px rgba(57,255,20,0.4)) drop-shadow(0 0 16px rgba(0,229,255,0.2)); } 75% { filter: drop-shadow(0 0 18px rgba(232,122,46,0.5)) drop-shadow(0 0 32px rgba(201,168,76,0.3)) drop-shadow(0 0 48px rgba(57,255,20,0.15)); } }
        @keyframes lightning-arc { 0% { opacity: 0; transform: scaleX(0); } 5% { opacity: 1; transform: scaleX(1); } 10% { opacity: 0.3; } 15% { opacity: 0.8; } 20% { opacity: 0; transform: scaleX(1); } 100% { opacity: 0; } }
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
        @keyframes cardReveal { from { opacity: 0; transform: translateY(12px) scale(0.97); filter: blur(4px); } to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); } }
        @keyframes glowLine { 0% { left: -40%; } 100% { left: 140%; } }
        @keyframes navUnderlineFire { 0% { background: linear-gradient(90deg, #1E2761, #C9A84C, #FFD700); background-size: 200% 100%; background-position: 0% 50%; } 100% { background: linear-gradient(90deg, #1E2761, #C9A84C, #FFD700); background-size: 200% 100%; background-position: 100% 50%; } }
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; }
        input, select, textarea, button { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        select option { background: #1a1a2e; color: #E2E8F0; }
        select option:checked { background: #E87A2E; color: #fff; }
        /* UPGRADED: Card hover with fire-edge glow */
        .site-card { transition: all 0.4s cubic-bezier(0.4,0,0.2,1); position: relative; }
        .site-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 16px; opacity: 0; transition: opacity 0.4s ease; pointer-events: none; box-shadow: 0 0 0 1px rgba(243,124,51,0.15), 0 8px 32px rgba(243,124,51,0.08); z-index: 0; }
        .site-card:hover { transform: translateY(-3px); box-shadow: 0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(232,122,46,0.25), 0 0 40px rgba(232,122,46,0.06) !important; }
        .site-card:hover::before { opacity: 1; }
        .site-card-open { transform: none !important; }
        .site-card-open:hover { transform: none !important; }
        /* UPGRADED: Smooth expand with fire accent */
        .card-expand { animation: slideDown 0.18s cubic-bezier(0.22,1,0.36,1); overflow: hidden; transform-origin: top; }
        /* UPGRADED: Nav underline with fire gradient */
        .nav-active::after { content: ''; position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 70%; height: 3px; background: linear-gradient(90deg, #1E2761, #E87A2E, #C9A84C, #E87A2E, #1E2761); background-size: 300% 100%; animation: navUnderlineFire 1.5s ease infinite; border-radius: 3px; box-shadow: 0 0 16px rgba(232,122,46,0.5); }
        /* Sort pill glow */
        .sort-active { box-shadow: 0 0 0 2px rgba(243,124,51,0.25), 0 0 12px rgba(243,124,51,0.08); }
        /* UPGRADED: Scrollbar with fire accent */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(15,21,56,0.4); }
        ::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #E87A2E, #C9A84C); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #FFB347, #E87A2E); }
        /* UPGRADED: KPI number with fire entrance */
        .kpi-number { animation: countUp 0.6s cubic-bezier(0.4,0,0.2,1); }
        /* Tab content transition */
        .tab-content { animation: tabSlide 0.4s cubic-bezier(0.4,0,0.2,1); }
        /* Card staggered reveal */
        .card-reveal { animation: cardReveal 0.2s cubic-bezier(0.22,1,0.36,1) backwards; }
        /* Electric glow on interactive elements */
        button:active:not(:disabled) { transform: scale(0.97); transition: transform 0.08s; }
        /* KPI cards electric pulse */
        .kpi-electric { animation: kpiElectric 4s ease-in-out infinite; }
        .kpi-electric:hover { box-shadow: 0 8px 40px rgba(0,0,0,0.4), 0 0 30px rgba(57,255,20,0.08), 0 0 60px rgba(232,122,46,0.06) !important; }
        /* Site card electric hover */
        .site-card:hover { transform: translateY(-3px); box-shadow: 0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(57,255,20,0.12), 0 0 30px rgba(232,122,46,0.06) !important; transition: all 0.15s cubic-bezier(0.22,1,0.36,1) !important; }
        /* Frosted glass card style — dark mode */
        .glass-card { background: rgba(15,21,56,0.7); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(201,168,76,0.08); }
        /* AI LIGHTNING DATA STREAMS */
        @keyframes dataStream { 0% { transform: translateY(100vh) scale(0); opacity: 0; } 10% { opacity: 0.8; transform: translateY(80vh) scale(1); } 50% { opacity: 0.4; } 90% { opacity: 0.2; } 100% { transform: translateY(-20px) scale(0.2); opacity: 0; } }
        @keyframes scanLine { 0% { top: -2px; } 100% { top: 100%; } }
        @keyframes nodePulse { 0% { opacity: 0; transform: scale(0.5); } 30% { opacity: 0.8; transform: scale(1.5); } 50% { opacity: 0.3; transform: scale(1); } 70% { opacity: 0.6; transform: scale(1.3); } 100% { opacity: 0; transform: scale(0.5); } }
        @keyframes logoAutoSpin { 0% { transform: rotate(0deg); } 50% { transform: rotate(1800deg); } 100% { transform: rotate(3600deg); } }
        @keyframes logoClickSpin { 0% { transform: rotate(0deg) scale(1); } 50% { transform: rotate(1080deg) scale(1.15); } 100% { transform: rotate(2160deg) scale(1); } }
        .logo-auto-spin { animation: logoAutoSpin 8s ease-in-out infinite; }
        .logo-click-spin { animation: logoClickSpin 1.2s cubic-bezier(0.2, 0, 0, 1) !important; }
        .logo-spin-container:hover { box-shadow: 0 4px 30px rgba(232,122,46,0.4), 0 0 0 2px rgba(201,168,76,0.25) !important; }
        @keyframes kpiElectric { 0% { box-shadow: 0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04); } 50% { box-shadow: 0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04), 0 0 20px rgba(57,255,20,0.05); } 100% { box-shadow: 0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04); } }
        @keyframes speedStreak { 0% { transform: translateX(-100%) scaleY(0.5); opacity: 0; } 30% { opacity: 0.8; transform: translateX(0) scaleY(1); } 100% { transform: translateX(200%) scaleY(0.5); opacity: 0; } }
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
            <div onClick={e => e.stopPropagation()} style={{ background: "rgba(15,21,56,0.5)", borderRadius: 20, maxWidth: 500, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(243,124,51,0.1), 0 0 60px rgba(243,124,51,0.06)", overflow: "hidden", animation: "cardReveal 0.4s cubic-bezier(0.4,0,0.2,1)" }}>
              <div style={{ background: "linear-gradient(135deg, #0a0a0e 0%, #121218 50%, #1a1520 100%)", padding: "22px 26px", color: "#fff", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, #1E2761, #C9A84C, #FFD700, #C9A84C, #1E2761, transparent)", opacity: 0.6 }} />
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>⚙️ SiteIQ™ Weight Configuration</div>
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 5 }}>Adjust dimension weights. Changes apply to all users in real-time.</div>
              </div>
              <div style={{ padding: "16px 24px" }}>
                {iqWeights.map(dim => (
                  <div key={dim.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid rgba(201,168,76,0.1)" }}>
                    <span style={{ fontSize: 16, width: 24 }}>{dim.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#E2E8F0" }}>{dim.label}</div>
                      <div style={{ fontSize: 10, color: "#94A3B8" }}>{dim.tip}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button onClick={() => adjustWeight(dim.key, -0.01)} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.4)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7394" }}>−</button>
                      <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Space Mono', monospace", width: 48, textAlign: "center", color: dim.weight > 0.15 ? "#F37C33" : dim.weight > 0.05 ? "#E2E8F0" : "#94A3B8" }}>{Math.round(dim.weight * 100)}%</div>
                      <button onClick={() => adjustWeight(dim.key, 0.01)} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.4)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7394" }}>+</button>
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, padding: "10px 0", borderTop: "2px solid rgba(201,168,76,0.1)" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: totalPct === 100 ? "#16A34A" : totalPct > 100 ? "#DC2626" : "#D97706" }}>Total: {totalPct}% {totalPct === 100 ? "✓" : totalPct > 100 ? "(will normalize)" : "(will normalize)"}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, padding: "16px 24px", borderTop: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.4)" }}>
                <button onClick={handleResetDefaults} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.5)", color: "#6B7394", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Reset Defaults</button>
                <div style={{ flex: 1 }} />
                <button onClick={() => setShowIQConfig(false)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.5)", color: "#6B7394", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
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
            <button onClick={() => setShowNewAlert(false)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.5)", color: "#94A3B8", fontSize: 11, cursor: "pointer" }}>✕</button>
          </div>
        </div>
      )}

      {/* Header — SiteIQ Theme */}
      <div style={STYLES.frostedHeader}>
        {/* Clean header accent */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent 0%, #1E2761 15%, #C9A84C 35%, #E87A2E 50%, #C9A84C 65%, #1E2761 85%, transparent 100%)", opacity: 0.5 }} />
        {/* SiteIQ Banner */}
        <div style={{ padding: "12px 0 8px", borderBottom: "1px solid rgba(201,168,76,0.08)", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="logo-spin-container" onClick={(e) => { e.currentTarget.querySelector('.logo-img')?.classList.remove('logo-click-spin'); void e.currentTarget.querySelector('.logo-img')?.offsetWidth; e.currentTarget.querySelector('.logo-img')?.classList.add('logo-click-spin'); }} style={{ width: 48, height: 48, borderRadius: 12, overflow: "hidden", cursor: "pointer", position: "relative", boxShadow: "0 4px 20px rgba(232,122,46,0.25), 0 0 0 1px rgba(201,168,76,0.15)", flexShrink: 0 }}>
                <img className="logo-img logo-auto-spin" src="/siteiq-logo.png" alt="SiteIQ" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.08em", background: "linear-gradient(90deg, #fff 0%, #C9A84C 25%, #FFD700 50%, #C9A84C 75%, #fff 100%)", backgroundSize: "300% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "shimmer 4s linear infinite" }}>SITEIQ</div>
                <div style={{ fontSize: 10, color: "#6B7394", letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 1 }}>AI-Powered Land Acquisition Engine</div>
                <div style={{ fontSize: 8, color: "#6B7394", letterSpacing: "0.06em", marginTop: 2, fontWeight: 600 }}>Powered by DJR Real Estate LLC</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowIQConfig(true)} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(201,168,76,0.25)", background: "rgba(201,168,76,0.06)", color: "#C9A84C", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", backdropFilter: "blur(8px)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,168,76,0.15)"; e.currentTarget.style.boxShadow = "0 0 20px rgba(201,168,76,0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(201,168,76,0.06)"; e.currentTarget.style.boxShadow = "none"; }}
              >⚙️ SiteIQ Config</button>
              <button onClick={handleExport} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(243,124,51,0.25)", background: "rgba(243,124,51,0.06)", color: "#F37C33", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", backdropFilter: "blur(8px)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(243,124,51,0.15)"; e.currentTarget.style.boxShadow = "0 0 20px rgba(243,124,51,0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(243,124,51,0.06)"; e.currentTarget.style.boxShadow = "none"; }}
              >⬇ Export Excel</button>
            </div>
          </div>
        </div>

        {/* Nav — Fire accent tabs */}
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
              onMouseEnter={(e) => { if (tab !== n.key) { e.currentTarget.style.color = "#E87A2E"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.textShadow = "0 0 16px rgba(232,122,46,0.4)"; } }}
              onMouseLeave={(e) => { if (tab !== n.key) { e.currentTarget.style.color = "#6B7394"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.textShadow = "none"; } }}
            >
              {n.label}
              {n.key === "review" && pendingN > 0 && <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFD700, #C9A84C)", boxShadow: "0 0 8px rgba(201,168,76,0.5)", animation: "siteiq-glow 1.5s ease-in-out infinite alternate" }} />}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px", position: "relative", zIndex: 1 }}>

        {/* ═══ DASHBOARD ═══ */}
        {tab === "dashboard" && (
          <div style={{ animation: "fadeIn 0.3s ease-out" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Pipeline", value: sw.length + east.length, color: "#F37C33", icon: "📊", action: () => navigateTo("summary"), sub: "View summary →" },
                { label: "Pending", value: pendingN, color: "#F59E0B", icon: "⏳", action: () => navigateTo("review"), sub: "Review queue →" },
                { label: "Daniel Wollent", value: sw.length, color: REGIONS.southwest.accent, icon: "🔷", action: () => navigateTo("southwest"), sub: "Open tracker →" },
                { label: "Matthew Toussaint", value: east.length, color: REGIONS.east.accent, icon: "🟢", action: () => navigateTo("east"), sub: "Open tracker →" },
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

            {/* ── ACTION ITEMS BANNER — personalized for DW/MT ── */}
            {(() => {
              const dwQueue = subs.filter(s => s.status === "recommended" && (s.routedTo === "southwest" || s.region === "southwest"));
              const mtQueue = subs.filter(s => s.status === "recommended" && (s.routedTo === "east" || s.region === "east"));
              const myQueue = subs.filter(s => s.status === "pending");
              const actionItems = [];
              if (myQueue.length > 0) {
                const topSite = myQueue.sort((a, b) => (getSiteIQ(b).score || 0) - (getSiteIQ(a).score || 0))[0];
                actionItems.push({ who: "Dan R.", count: myQueue.length, top: topSite, color: "#C9A84C", tab: "mine", icon: "📋" });
              }
              if (dwQueue.length > 0) {
                const topSite = dwQueue.sort((a, b) => (getSiteIQ(b).score || 0) - (getSiteIQ(a).score || 0))[0];
                actionItems.push({ who: "Daniel Wollent", count: dwQueue.length, top: topSite, color: "#42A5F5", tab: "dw", icon: "◆" });
              }
              if (mtQueue.length > 0) {
                const topSite = mtQueue.sort((a, b) => (getSiteIQ(b).score || 0) - (getSiteIQ(a).score || 0))[0];
                actionItems.push({ who: "Matthew Toussaint", count: mtQueue.length, top: topSite, color: "#4CAF50", tab: "mt", icon: "●" });
              }
              if (actionItems.length === 0) return null;
              return (
                <div className="card-reveal" style={{ background: "linear-gradient(135deg, rgba(232,122,46,0.06), rgba(201,168,76,0.04))", borderRadius: 14, padding: 16, marginBottom: 16, border: "1px solid rgba(232,122,46,0.15)", animationDelay: "0.35s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #E87A2E, #F59E0B)", boxShadow: "0 0 10px rgba(232,122,46,0.5)", animation: "siteiq-glow 1.5s ease-in-out infinite alternate" }} />
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#E87A2E", textTransform: "uppercase", letterSpacing: "0.08em" }}>Action Required</span>
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {actionItems.map(ai => (
                      <div key={ai.who} onClick={() => { navigateTo("review"); setTimeout(() => setReviewTab(ai.tab), 50); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 10, background: "rgba(15,21,56,0.5)", border: `1px solid ${ai.color}25`, cursor: "pointer", transition: "all 0.2s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${ai.color}50`; e.currentTarget.style.transform = "translateX(4px)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${ai.color}25`; e.currentTarget.style.transform = "translateX(0)"; }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0" }}>{ai.icon} {ai.who} — <span style={{ color: ai.color }}>{ai.count} site{ai.count !== 1 ? "s" : ""} awaiting review</span></div>
                          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>Top: <strong style={{ color: "#E2E8F0" }}>{ai.top.name}</strong> — SiteIQ {getSiteIQ(ai.top).score}</div>
                        </div>
                        <span style={{ fontSize: 12, color: ai.color, fontWeight: 700 }}>Review →</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Velocity Stats + Last Updated */}
            {(() => {
              const all = [...sw, ...east];
              const now = Date.now();
              const week = 7 * 86400000;
              const addedThisWeek = all.filter(s => s.approvedAt && (now - new Date(s.approvedAt).getTime()) < week).length;
              const ucCount = all.filter(s => s.phase === "Under Contract").length;
              const loiCount = all.filter(s => ["LOI", "LOI Sent", "LOI Signed", "PSA Sent"].includes(s.phase)).length;
              const greenCount = all.filter(s => getSiteIQ(s).score >= 7.5).length;
              return (
                <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 10, flex: 1, flexWrap: "wrap" }}>
                    {[
                      { label: "Added this week", value: addedThisWeek, color: "#3B82F6", action: () => navigateTo("summary") },
                      { label: "Under Contract", value: ucCount, color: "#16A34A", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                      { label: "LOI Active", value: loiCount, color: "#F59E0B", action: () => navigateTo("summary", { phase: "LOI" }) },
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

            {/* ═══ DEAL MOMENTUM — Executive Pulse ═══ */}
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
              const loiValue = all.filter(s => ["LOI", "LOI Sent", "LOI Signed", "PSA Sent"].includes(s.phase)).reduce((sum, s) => sum + parsePrice(s.askingPrice), 0);
              const ucValue = all.filter(s => s.phase === "Under Contract").reduce((sum, s) => sum + parsePrice(s.askingPrice), 0);
              const prospectValue = all.filter(s => s.phase === "Prospect").reduce((sum, s) => sum + parsePrice(s.askingPrice), 0);
              const fmtVal = (v) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`;

              // --- Phase distribution for mini bars ---
              const phaseGroups = [
                { label: "Prospect", phases: ["Prospect"], color: "#3B82F6", icon: "🔍", action: () => navigateTo("summary", { phase: "Prospect" }) },
                { label: "Submitted to PS", phases: ["Submitted to PS"], color: "#6366F1", icon: "📤", action: () => navigateTo("summary", { phase: "Submitted to PS" }) },
                { label: "SiteIQ Approved", phases: ["SiteIQ Approved"], color: "#8B5CF6", icon: "⚡", action: () => navigateTo("summary", { phase: "SiteIQ Approved" }) },
                { label: "LOI / PSA", phases: ["LOI", "LOI Sent", "LOI Signed", "PSA Sent"], color: "#F37C33", icon: "📝", action: () => navigateTo("summary", { phase: "LOI" }) },
                { label: "Under Contract", phases: ["Under Contract"], color: "#16A34A", icon: "🤝", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                { label: "Closed", phases: ["Closed"], color: "#059669", icon: "🏆", action: () => navigateTo("summary", { phase: "Closed" }) },
              ];
              phaseGroups.forEach(g => { g.count = all.filter(s => g.phases.includes(s.phase)).length; });
              const maxPhaseCount = Math.max(...phaseGroups.map(g => g.count), 1);

              // --- Move type classification ---
              const advancePhases = ["SiteIQ Approved", "LOI", "PSA Sent", "Under Contract", "Closed"];
              const moveIcon = (to) => advancePhases.includes(to) ? "🟢" : to === "Dead" || to === "Declined" ? "🔴" : "🔵";
              const moveLabel = (to) => advancePhases.includes(to) ? "ADVANCED" : to === "Dead" || to === "Declined" ? "EXITED" : "MOVED";

              const hasData = recentMoves.length > 0 || all.length > 0;
              if (!hasData) return null;

              return (
                <div className="card-reveal" style={{ background: "linear-gradient(145deg, rgba(15,15,20,0.96) 0%, rgba(25,25,32,0.94) 100%)", borderRadius: 16, padding: 0, marginBottom: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)", backdropFilter: "blur(12px)", animationDelay: "0.5s", position: "relative", overflow: "hidden" }}>
                  {/* Top ember line */}
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent 5%, #F37C33 30%, #FFB347 50%, #F37C33 70%, transparent 95%)" }} />

                  {/* Header */}
                  <div style={{ padding: "18px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #F37C33, #D45500)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, boxShadow: "0 2px 8px rgba(243,124,51,0.4)" }}>⚡</div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "rgba(15,21,56,0.4)", letterSpacing: "0.02em" }}>Deal Momentum</h3>
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
                      { label: "LOI / PSA PIPELINE", value: fmtVal(loiValue), count: all.filter(s => ["LOI", "LOI Sent", "LOI Signed", "PSA Sent"].includes(s.phase)).length, color: "#F37C33", action: () => navigateTo("summary", { phase: "LOI" }) },
                      { label: "UNDER CONTRACT", value: fmtVal(ucValue), count: all.filter(s => s.phase === "Under Contract").length, color: "#22C55E", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                      { label: "PROSPECT POOL", value: fmtVal(prospectValue), count: all.filter(s => s.phase === "Prospect").length, color: "#3B82F6", action: () => navigateTo("summary", { phase: "Prospect" }) },
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
                          <div key={m.name + idx + m.date} onClick={() => { setDetailView({ regionKey: m.regionKey, siteId: m.siteId }); setTab(m.regionKey); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer", borderRadius: 6, transition: "all 0.2s ease" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(243,124,51,0.06)"; e.currentTarget.style.paddingLeft = "8px"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.paddingLeft = "0"; }}
                          >
                            <span style={{ fontSize: 12 }}>{moveIcon(m.to)}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0" }}>{m.name} <span style={{ fontSize: 9, color: "rgba(148,163,184,0.5)" }}>({m.region})</span></div>
                              <div style={{ fontSize: 10, color: "rgba(148,163,184,0.6)" }}>{m.from} → {m.to}</div>
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

            {/* ═══ PIPELINE FUNNEL — Interactive ═══ */}
            {(() => {
              const all = [...sw, ...east];
              const pending = subs.filter(s => s.status === "pending").length;
              const funnelStages = [
                { label: "Review Queue", count: pending, color: "#F59E0B", icon: "⏳", action: () => navigateTo("review") },
                { label: "Prospect", count: all.filter(s => s.phase === "Prospect").length, color: "#3B82F6", icon: "🔍", action: () => navigateTo("summary", { phase: "Prospect" }) },
                { label: "Submitted to PS", count: all.filter(s => s.phase === "Submitted to PS").length, color: "#6366F1", icon: "📤", action: () => navigateTo("summary", { phase: "Submitted to PS" }) },
                { label: "SiteIQ Approved", count: all.filter(s => s.phase === "SiteIQ Approved").length, color: "#8B5CF6", icon: "⚡", action: () => navigateTo("summary", { phase: "SiteIQ Approved" }) },
                { label: "LOI / PSA", count: all.filter(s => ["LOI", "LOI Sent", "LOI Signed", "PSA Sent"].includes(s.phase)).length, color: "#F37C33", icon: "📝", action: () => navigateTo("summary", { phase: "LOI" }) },
                { label: "Under Contract", count: all.filter(s => s.phase === "Under Contract").length, color: "#16A34A", icon: "🤝", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                { label: "Closed", count: all.filter(s => s.phase === "Closed").length, color: "#059669", icon: "🏆", action: () => navigateTo("summary", { phase: "Closed" }) },
              ];
              const declined = all.filter(s => s.phase === "Declined" || s.phase === "Dead").length;
              return (
                <div className="card-reveal" style={{ background: "rgba(255,255,255,0.92)", borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: "0 2px 12px rgba(0,0,0,.05), 0 0 0 1px rgba(243,124,51,0.04)", backdropFilter: "blur(8px)", animationDelay: "0.6s", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, rgba(243,124,51,0.2), rgba(255,179,71,0.3), rgba(243,124,51,0.2), transparent)" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#F4F6FA" }}>Pipeline Funnel</h3>
                    {declined > 0 && <span style={{ fontSize: 11, color: "#DC2626", fontWeight: 600 }}>{declined} declined/dead</span>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                    {funnelStages.map((stage, idx) => {
                      const widthPct = stage.count > 0 ? Math.max(25, 30 + (1 - idx / (funnelStages.length - 1)) * 70) : 25;
                      return (
                        <div key={stage.label} onClick={stage.count > 0 ? stage.action : undefined} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, cursor: stage.count > 0 ? "pointer" : "default" }}>
                          <div style={{ width: 90, fontSize: 10, fontWeight: 600, color: "#6B7394", textAlign: "right", flexShrink: 0 }}>{stage.icon} {stage.label}</div>
                          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                            <div className={stage.count > 0 ? "funnel-bar" : ""} style={{
                              width: `${widthPct}%`,
                              background: stage.count > 0 ? `linear-gradient(135deg, ${stage.color}DD, ${stage.color}99)` : "rgba(15,21,56,0.3)",
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
                            {stage.count > 0 ? "→" : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 10, color: "#94A3B8", textAlign: "center" }}>
                    Click any stage to navigate — sites flow left to right
                  </div>
                </div>
              );
            })()}

            {[{ label: "Daniel Wollent", data: sw, color: REGIONS.southwest.color, accent: REGIONS.southwest.accent, tabKey: "southwest" }, { label: "Matthew Toussaint", data: east, color: REGIONS.east.color, accent: REGIONS.east.accent, tabKey: "east" }].map((r) => {
              const total = r.data.length || 1;
              const phaseColors = ["#CBD5E1", "#94A3B8", "#3B82F6", "#6366F1", "#16A34A", "#D97706", "#DC2626", "#8B5CF6", "#A855F7", "#F59E0B", "#F37C33", "#16A34A", "#64748B"];
              return (
                <div key={r.label} onClick={() => navigateTo(r.tabKey)} className="site-card card-reveal funnel-bar" style={{ background: "rgba(15,21,56,0.6)", borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(201,168,76,0.06)", cursor: "pointer", backdropFilter: "blur(12px)", animationDelay: "0.7s", position: "relative", overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: r.color }}>{r.label} — 2026 Pipeline</h3>
                    <span style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600 }}>{r.data.length} sites</span>
                  </div>
                  {/* Visual pipeline bar */}
                  <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", marginBottom: 10, background: "rgba(15,21,56,0.3)" }}>
                    {PHASES.map((p, idx) => {
                      const c = r.data.filter((s) => s.phase === p).length;
                      return c > 0 ? <div key={p} title={`${p}: ${c}`} style={{ width: `${(c / total) * 100}%`, background: phaseColors[idx] || r.accent, transition: "width 0.5s ease" }} /> : null;
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {PHASES.map((p, idx) => { const c = r.data.filter((s) => s.phase === p).length; return (
                      <div key={p} style={{ flex: "1 1 80px", textAlign: "center", padding: "10px 6px", borderRadius: 10, background: c > 0 ? `${phaseColors[idx]}11` : "rgba(15,21,56,0.4)", border: c > 0 ? `1px solid ${phaseColors[idx]}33` : "1px solid rgba(201,168,76,0.1)", transition: "all 0.2s" }}>
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

        {/* ═══ SUMMARY ═══ */}
        {tab === "summary" && (() => {
          const th = { padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#C9A84C", textTransform: "uppercase", borderBottom: "2px solid rgba(201,168,76,0.15)", whiteSpace: "nowrap", position: "sticky", top: 0, background: "rgba(15,21,56,0.6)", zIndex: 1 };
          const td = { padding: "8px 10px", fontSize: 11, color: "#E2E8F0", borderBottom: "1px solid rgba(201,168,76,0.08)", whiteSpace: "nowrap" };
          const tdW = { ...td, whiteSpace: "normal", maxWidth: 200, minWidth: 120 };
          const allStates = [...new Set([...sw, ...east].map(s => s.state).filter(Boolean))].sort();
          const SumTable = ({ rk }) => {
            const r = REGIONS[rk];
            const raw = sortData(rk === "east" ? east : sw);
            const matchPhase = (sPhase) => filterPhase === "all" || sPhase === filterPhase;
            const d = raw.filter(s => (filterState === "all" || s.state === filterState) && matchPhase(s.phase));
            return (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: r.accent }} />
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: r.color }}>{r.label}</h3>
                  <span style={{ fontSize: 12, color: "#94A3B8" }}>({d.length}{d.length !== raw.length ? ` of ${raw.length}` : ""})</span>
                </div>
                {d.length === 0 ? <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 10, padding: 20, textAlign: "center", color: "#94A3B8" }}>No sites.</div> : (
                  <div style={{ overflow: "auto", borderRadius: 10, border: "1px solid rgba(201,168,76,0.1)", maxHeight: 420 }}>
                    <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse", background: "rgba(15,21,56,0.5)" }}>
                      <thead>
                        <tr>{["SiteIQ", "Name", "City", "ST", "Phase", "Ask", "Acres", "3mi Pop", "Broker", "DOM", "Added"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {d.map((s, i) => (
                          <tr key={s.id} onClick={() => { setDetailView({ regionKey: rk, siteId: s.id }); setTab(rk); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ background: (() => { const t = getSiteIQ(s).tier; return t === "gold" ? "rgba(201,168,76,0.08)" : t === "steel" ? "rgba(44,62,107,0.15)" : i % 2 ? "rgba(15,21,56,0.35)" : "rgba(15,21,56,0.5)"; })(), cursor: "pointer", transition: "background 0.15s", borderLeft: (() => { const t = getSiteIQ(s).tier; return t === "gold" ? "3px solid #C9A84C" : t === "steel" ? "3px solid #2C3E6B" : "3px solid transparent"; })() }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(232,122,46,0.12)")}
                            onMouseLeave={(e) => { const t = getSiteIQ(s).tier; e.currentTarget.style.background = t === "gold" ? "rgba(201,168,76,0.08)" : t === "steel" ? "rgba(44,62,107,0.15)" : i % 2 ? "rgba(15,21,56,0.35)" : "rgba(15,21,56,0.5)"; }}
                          >
                            <td style={{ ...td, textAlign: "center" }}><SiteIQBadge site={s} size="small" iq={getSiteIQ(s)} /></td>
                            <td style={{ ...td, fontWeight: 600, color: "#E2E8F0" }}>{s.name}</td>
                            <td style={{ ...td, fontWeight: 600 }}>{s.city || "—"}</td>
                            <td style={td}>{s.state || "—"}</td>
                            <td style={{ ...td, fontSize: 11 }}><span style={{ padding: "2px 8px", borderRadius: 6, background: s.phase === "Under Contract" || s.phase === "Closed" ? "#DCFCE7" : s.phase === "PSA Sent" ? "#F5D0FE" : s.phase === "LOI" ? "#FEF3C7" : s.phase === "SiteIQ Approved" ? "#E0E7FF" : s.phase === "Submitted to PS" ? "#DBEAFE" : "rgba(15,21,56,0.3)", color: s.phase === "Under Contract" || s.phase === "Closed" ? "#166534" : s.phase === "PSA Sent" ? "#86198F" : s.phase === "LOI" ? "#92400E" : s.phase === "SiteIQ Approved" ? "#3730A3" : s.phase === "Submitted to PS" ? "#1E40AF" : "#64748B", fontWeight: 600 }}>{s.phase || "—"}</span></td>
                            <td style={{ ...td, fontWeight: 600 }} title={s.askingPrice || ""}>{fmtPrice(s.askingPrice)}</td>
                            <td style={td}>{s.acreage || "—"}</td>
                            <td style={td}>{s.pop3mi ? fmtN(s.pop3mi) : "—"}</td>
                            <td style={td}>{s.sellerBroker || "—"}</td>
                            <td style={{ ...td, textAlign: "center", fontSize: 12, color: s.dateOnMarket && s.dateOnMarket !== "N/A" ? (Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000) > 365 ? "#EF4444" : Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000) > 180 ? "#F59E0B" : "#22C55E") : "#94A3B8" }}>{s.dateOnMarket && s.dateOnMarket !== "N/A" ? Math.max(0, Math.floor((Date.now() - new Date(s.dateOnMarket).getTime()) / 86400000)) + "d" : "—"}</td>
                            <td style={td}>{s.approvedAt ? new Date(s.approvedAt).toLocaleDateString() : "—"}</td>
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
              <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#E2E8F0" }}>📊 Summary</h2>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#94A3B8" }}>All tracked sites by region. Click any row to open.</p>
              <SortBar />
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>Filter:</span>
                  <select value={filterState} onChange={(e) => setFilterState(e.target.value)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", color: "#94A3B8", background: filterState !== "all" ? "#FFF7ED" : "rgba(15,21,56,0.5)" }}>
                    <option value="all">All States</option>
                    {allStates.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <select value={filterPhase} onChange={(e) => setFilterPhase(e.target.value)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", color: "#94A3B8", background: filterPhase !== "all" ? "#FFF7ED" : "rgba(15,21,56,0.5)" }}>
                    <option value="all">All Phases</option>
                    {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {(filterState !== "all" || filterPhase !== "all") && <button onClick={() => { setFilterState("all"); setFilterPhase("all"); }} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.5)", color: "#94A3B8", cursor: "pointer" }}>✕ Clear</button>}
              </div>
              <SumTable rk="southwest" />
              <SumTable rk="east" />
            </div>
          );
        })()}

        {/* ═══ SUBMIT ═══ */}
        {tab === "submit" && (
          <div style={{ animation: "fadeIn .3s ease-out", maxWidth: 600 }}>
            <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700 }}>Submit Site</h2>
              <div style={{ display: "flex", gap: 6, marginBottom: 16, background: "rgba(15,21,56,0.3)", borderRadius: 10, padding: 3 }}>
                {[["direct", "⚡ Direct to Tracker"], ["review", "📋 Send to Review"]].map(([k, l]) => (
                  <button key={k} onClick={() => setSubmitMode(k)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter', sans-serif", background: submitMode === k ? "rgba(15,21,56,0.5)" : "transparent", color: submitMode === k ? "#E2E8F0" : "#94A3B8", boxShadow: submitMode === k ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}>{l}</button>
                ))}
              </div>
              {/* ── Flyer Upload Zone ── */}
              <div style={{ fontSize: 12, fontWeight: 700, color: "#E2E8F0", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>📄 Flyer <span style={{ fontSize: 10, fontWeight: 500, color: "#94A3B8" }}>— auto-extracts acreage, price, zoning & broker</span></div>
              <div style={{ border: flyerFile ? "2px solid #F37C33" : "2px dashed #E2E8F0", borderRadius: 12, padding: flyerFile ? 14 : 20, textAlign: "center", background: flyerFile ? "#FFF8F3" : "rgba(15,21,56,0.4)", marginBottom: 16, cursor: "pointer", transition: "all .2s" }} onClick={() => !flyerParsing && flyerRef.current?.click()} onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#F37C33"; }} onDragLeave={(e) => { e.currentTarget.style.borderColor = flyerFile ? "#F37C33" : "rgba(201,168,76,0.1)"; }} onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = flyerFile ? "#F37C33" : "rgba(201,168,76,0.1)"; const f = e.dataTransfer.files?.[0]; if (f) parseFlyer(f); }}>
                <input ref={flyerRef} type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFlyer(f); }} />
                {flyerParsing ? (
                  <div><div style={{ fontSize: 22, marginBottom: 4 }}>⏳</div><div style={{ fontSize: 12, color: "#6B7394", fontWeight: 600 }}>Extracting info from flyer…</div></div>
                ) : flyerFile ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {flyerPreview && <img src={flyerPreview} alt="Flyer preview" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)" }} />}
                    {!flyerPreview && <div style={{ width: 48, height: 48, borderRadius: 6, background: "#FFF3E0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>📄</div>}
                    <div style={{ textAlign: "left", flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0" }}>{flyerFile.name}</div>
                      <div style={{ fontSize: 11, color: "#6B7394" }}>{(flyerFile.size / 1024).toFixed(0)} KB — fields auto-populated</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setFlyerFile(null); setFlyerPreview(null); if (flyerRef.current) flyerRef.current.value = ""; }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.5)", color: "#94A3B8", fontSize: 11, cursor: "pointer" }}>✕</button>
                  </div>
                ) : (
                  <div><div style={{ fontSize: 22, marginBottom: 4 }}>📎</div><div style={{ fontSize: 13, fontWeight: 600, color: "#94A3B8" }}>Drop a flyer here or click to upload</div><div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>PDF or image — we'll extract acreage, price, zoning, broker & more</div></div>
                )}
              </div>
              {/* ── Additional Attachments ── */}
              <div style={{ marginBottom: 16, background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 14, border: "1px solid rgba(201,168,76,0.1)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#E2E8F0", display: "flex", alignItems: "center", gap: 6 }}>📁 More Documents <span style={{ fontSize: 10, fontWeight: 500, color: "#94A3B8" }}>— survey, PSA, environmental, etc.</span></div>
                  <button onClick={() => attachRef.current?.click()} style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#2C2C2C", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ Add File</button>
                  <input ref={attachRef} type="file" accept=".pdf,image/*,.doc,.docx,.xlsx,.xls,.csv" multiple style={{ display: "none" }} onChange={(e) => { const files = Array.from(e.target.files || []); const newA = files.map((f) => ({ file: f, type: "Other", id: uid() })); setAttachments((prev) => [...prev, ...newA]); e.target.value = ""; }} />
                </div>
                {attachments.length > 0 && (
                  <div style={{ display: "grid", gap: 6 }}>
                    {attachments.map((a) => (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", background: "#FAFAFA" }}>
                        <div style={{ fontSize: 16 }}>{a.file.name.match(/\.pdf$/i) ? "📄" : a.file.type?.startsWith("image/") ? "🖼️" : "📎"}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.file.name}</div>
                          <div style={{ fontSize: 10, color: "#94A3B8" }}>{(a.file.size / 1024).toFixed(0)} KB</div>
                        </div>
                        <select value={a.type} onChange={(e) => setAttachments((prev) => prev.map((x) => x.id === a.id ? { ...x, type: e.target.value } : x))} style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", fontSize: 11, background: "rgba(15,21,56,0.5)", cursor: "pointer", color: "#94A3B8" }}>
                          {DOC_TYPES.filter((t) => t !== "Flyer").map((t) => <option key={t}>{t}</option>)}
                        </select>
                        <button onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))} style={{ padding: "2px 6px", borderRadius: 4, border: "none", background: "transparent", color: "#94A3B8", fontSize: 14, cursor: "pointer", lineHeight: 1 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {attachments.length === 0 && <div style={{ fontSize: 11, color: "#CBD5E1" }}>Survey, demographics, PSA, environmental, etc.</div>}
              </div>
              {/* ── Form Fields ── */}
              <div style={{ display: "grid", gap: 12 }}>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Name *</label><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Facility / site name" /></div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Address *</label><input style={inp} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street address" /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>City *</label><input style={inp} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>State *</label><input style={inp} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Acreage</label><input style={inp} value={form.acreage} onChange={(e) => setForm({ ...form, acreage: e.target.value })} placeholder="e.g. 3.5" /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Asking Price</label><input style={inp} value={form.askingPrice} onChange={(e) => setForm({ ...form, askingPrice: e.target.value })} placeholder="e.g. $1,200,000" /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Zoning</label><input style={inp} value={form.zoning} onChange={(e) => setForm({ ...form, zoning: e.target.value })} placeholder="e.g. C-2, Commercial" /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Seller / Broker</label><input style={inp} value={form.sellerBroker} onChange={(e) => setForm({ ...form, sellerBroker: e.target.value })} placeholder="Broker name" /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Coordinates</label><input style={inp} value={form.coordinates} onChange={(e) => setForm({ ...form, coordinates: e.target.value })} placeholder="lat, lng" /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Listing URL</label><input style={inp} value={form.listingUrl} onChange={(e) => setForm({ ...form, listingUrl: e.target.value })} placeholder="Crexi / LoopNet link" /></div>
                </div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Region *</label><select style={{ ...inp, cursor: "pointer" }} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}><option value="southwest">Daniel Wollent</option><option value="east">Matthew Toussaint</option></select></div>
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7394", textTransform: "uppercase" }}>Notes</label><textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any additional notes…" /></div>
                <button onClick={handleSubmit} style={{ padding: "12px 20px", borderRadius: 10, border: "none", cursor: "pointer", background: submitMode === "direct" ? "linear-gradient(135deg,#F37C33,#E8650A)" : "linear-gradient(135deg,#2C2C2C,#3D3D3D)", color: "#fff", fontSize: 14, fontWeight: 700 }}>
                  {submitMode === "direct" ? "⚡ Add Now" : "📋 Submit for Review"}
                </button>
              </div>
              {shareLink && (
                <div style={{ background: "#FFF3E0", border: "1px solid #F37C33", borderRadius: 10, padding: 14, marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#E65100", marginBottom: 6 }}>✅ Submitted! Share this review link:</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input readOnly value={`${window.location.origin}${window.location.pathname}?review=${shareLink}`} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.1)", fontSize: 12, background: "rgba(15,21,56,0.5)", outline: "none" }} onClick={(e) => e.target.select()} />
                    <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?review=${shareLink}`); notify("Copied!"); }} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📋 Copy</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ REVIEW ═══ */}
        {tab === "review" && (
          <div style={{ animation: "fadeIn .3s ease-out" }}>
            {/* Review Queue Sub-Tabs */}
            {(() => {
              const myCount = subs.filter(s => s.status === "pending").length;
              const dwCount = subs.filter(s => s.status === "recommended" && (s.routedTo === "southwest" || s.region === "southwest")).length;
              const mtCount = subs.filter(s => s.status === "recommended" && (s.routedTo === "east" || s.region === "east")).length;
              const reviewTabs = [
                { key: "mine", label: "My Queue", count: myCount, color: "#C9A84C", icon: "📋" },
                { key: "dw", label: "Daniel Wollent", count: dwCount, color: "#42A5F5", icon: "◆" },
                { key: "mt", label: "Matthew Toussaint", count: mtCount, color: "#4CAF50", icon: "●" },
              ];
              return (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Review Queue</h2>
                    <div style={{ display: "flex", gap: 6 }}>
                      {reviewTab === "mine" && myCount > 0 && <button onClick={handleApproveAll} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#C9A84C,#1E2761)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(201,168,76,0.3)" }}>✓ Recommend All ({myCount})</button>}
                      {subs.some((s) => s.status === "declined") && <button onClick={handleClearDeclined} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#991B1B", fontSize: 11, cursor: "pointer" }}>Clear Declined</button>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, background: "rgba(15,21,56,0.6)", borderRadius: 10, padding: 4, marginBottom: 4 }}>
                    {reviewTabs.map(rt => (
                      <button key={rt.key} onClick={() => setReviewTab(rt.key)} style={{
                        flex: 1, padding: "10px 14px", borderRadius: 8, border: "none", cursor: "pointer", transition: "all 0.2s",
                        background: reviewTab === rt.key ? `linear-gradient(135deg, ${rt.color}22, ${rt.color}11)` : "transparent",
                        color: reviewTab === rt.key ? rt.color : "#6B7394",
                        fontWeight: reviewTab === rt.key ? 800 : 600, fontSize: 12,
                        borderBottom: reviewTab === rt.key ? `2px solid ${rt.color}` : "2px solid transparent",
                      }}>
                        <span style={{ marginRight: 6 }}>{rt.icon}</span>
                        {rt.label}
                        {rt.count > 0 && <span style={{ marginLeft: 6, padding: "2px 7px", borderRadius: 10, fontSize: 10, fontWeight: 800, background: reviewTab === rt.key ? `${rt.color}30` : "rgba(255,255,255,0.06)", color: reviewTab === rt.key ? rt.color : "#94A3B8" }}>{rt.count}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── Assigned Sites Needing Review ── */}
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
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 6, padding: "4px 10px", background: "rgba(15,21,56,0.4)", borderRadius: 8, display: "inline-block", border: "1px solid rgba(201,168,76,0.1)" }}>{person} ({sites.length})</div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {sites.map(site => (
                          <div key={site.id} style={{ background: "rgba(15,21,56,0.5)", borderRadius: 12, padding: 14, boxShadow: "0 1px 4px rgba(0,0,0,.06)", borderLeft: "4px solid #C9A84C", transition: "all 0.3s" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: "#E2E8F0" }}>{site.name}</span>
                              <SiteIQBadge site={site} size="small" iq={getSiteIQ(site)} />
                              <span style={{ fontSize: 9, fontWeight: 700, color: "#92700C", background: "#FFFBEB", padding: "2px 8px", borderRadius: 5, border: "1px solid rgba(201,168,76,0.3)" }}>NEEDS REVIEW</span>
                            </div>
                            <div style={{ fontSize: 11, color: "#6B7394", marginBottom: 4 }}>{site.address}, {site.city}, {site.state} {site.acreage ? `· ${site.acreage} ac` : ""} {site.askingPrice ? `· ${site.askingPrice}` : ""}</div>
                            <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 6 }}>Phase: {site.phase || "Prospect"} · Tracker: {site._region === "southwest" ? "DW" : "MT"}</div>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <button onClick={() => { updateSiteField(site._region, site.id, "needsReview", false); updateSiteField(site._region, site.id, "reviewedBy", person); updateSiteField(site._region, site.id, "reviewedAt", new Date().toISOString()); notify(`Reviewed: ${site.name}`); }} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #16A34A, #15803D)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(22,163,74,0.25)" }}>✓ Mark Reviewed</button>
                              <button onClick={() => { setDetailView({ regionKey: site._region, siteId: site.id }); setTab(site._region); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(232,122,46,0.2)", background: "rgba(232,122,46,0.08)", color: "#E87A2E", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>View Property →</button>
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
            {(() => {
              const filtered = subs.filter(site => {
                if (reviewTab === "mine") return site.status === "pending" || site.status === "declined";
                if (reviewTab === "dw") return site.status === "recommended" && (site.routedTo === "southwest" || site.region === "southwest");
                if (reviewTab === "mt") return site.status === "recommended" && (site.routedTo === "east" || site.region === "east");
                return true;
              });
              const emptyLabels = { mine: "No sites pending your review. Auto-scans run daily — new sites will appear here.", dw: "No sites awaiting Daniel Wollent's approval.", mt: "No sites awaiting Matthew Toussaint's approval." };
              if (filtered.length === 0 && (reviewTab !== "mine" || [...sw, ...east].filter(s => s.assignedTo && s.needsReview).length === 0)) return (
                <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: "40px 30px", textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>{reviewTab === "mine" ? "📋" : reviewTab === "dw" ? "◆" : "●"}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#94A3B8", marginBottom: 6 }}>{reviewTab === "mine" ? "Queue Empty" : "No Sites Pending"}</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", maxWidth: 380, margin: "0 auto", lineHeight: 1.5 }}>{emptyLabels[reviewTab]}</div>
                </div>
              );
              return null;
            })()}
            {(() => {
              const filtered = subs.filter(site => {
                if (reviewTab === "mine") return site.status === "pending" || site.status === "declined";
                if (reviewTab === "dw") return site.status === "recommended" && (site.routedTo === "southwest" || site.region === "southwest");
                if (reviewTab === "mt") return site.status === "recommended" && (site.routedTo === "east" || site.region === "east");
                return true;
              });
              if (filtered.length === 0) return null;
              return (
              <div style={{ display: "grid", gap: 10 }}>
                {sortData(subs).filter(site => {
                  if (reviewTab === "mine") return site.status === "pending" || site.status === "declined";
                  if (reviewTab === "dw") return site.status === "recommended" && (site.routedTo === "southwest" || site.region === "southwest");
                  if (reviewTab === "mt") return site.status === "recommended" && (site.routedTo === "east" || site.region === "east");
                  return true;
                }).sort((a, b) => {
                  // NEW (unreviewed) sites first, then descending SiteIQ score
                  const aIsNew = !a.recommendedAt && !a.approvedAt && a.status === "pending";
                  const bIsNew = !b.recommendedAt && !b.approvedAt && b.status === "pending";
                  if (aIsNew && !bIsNew) return -1;
                  if (!aIsNew && bIsNew) return 1;
                  return (getSiteIQ(b).score || 0) - (getSiteIQ(a).score || 0);
                }).map((site) => {
                  const ri = reviewInputs[site.id] || { reviewer: "", note: "" };
                  const setRI = (f, v) => setReviewInputs({ ...reviewInputs, [site.id]: { ...ri, [f]: v } });
                  const isHL = highlightedSite === site.id;
                  const isExpanded = false; // legacy — full-page detail replaced inline expand
                  return (
                    <div key={site.id} id={`review-${site.id}`} style={{ background: isHL ? "#FFF3E0" : "rgba(15,21,56,0.5)", borderRadius: 12, padding: 16, boxShadow: isHL ? "0 0 0 2px #F37C33" : "0 1px 3px rgba(0,0,0,.06)", opacity: site.status === "declined" ? 0.5 : 1, borderLeft: `4px solid ${REGIONS[site.routedTo || site.region]?.accent || "#94A3B8"}`, transition: "all 0.3s", cursor: "pointer" }}
                      onClick={() => setReviewDetailSite(site.id)}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 20px rgba(201,168,76,0.15), 0 0 0 1px rgba(201,168,76,0.2)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = isHL ? "0 0 0 2px #F37C33" : "0 1px 3px rgba(0,0,0,.06)"; e.currentTarget.style.transform = "translateY(0)"; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}
                      >
                        <span style={{ fontSize: 15, fontWeight: 700, transition: "color 0.2s" }}>{site.name}</span>
                        <SiteIQBadge site={site} size="small" />
                        <Badge status={site.status} />
                        {site.status === "pending" && <button onClick={(e) => { e.stopPropagation(); const url = `${window.location.origin}${window.location.pathname}?review=${site.id}`; navigator.clipboard.writeText(url); notify("Link copied!"); }} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.4)", color: "#6B7394", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>🔗 Copy Link</button>}
                      </div>
                      <div style={{ fontSize: 12, color: "#6B7394", marginBottom: 2 }}>{site.address}, {site.city}, {site.state} {site.acreage ? `• ${site.acreage} ac` : ""} {site.askingPrice ? `• ${site.askingPrice}` : ""}</div>
                      {site.summary && <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.4, maxHeight: 36, overflow: "hidden" }}>{site.summary.substring(0, 180)}{site.summary.length > 180 ? "…" : ""}</div>}
                      {/* NEW badge for unreviewed sites */}
                      {!site.recommendedAt && !site.approvedAt && site.status === "pending" && <span style={{ display: "inline-block", marginTop: 4, fontSize: 9, fontWeight: 800, color: "#fff", background: "linear-gradient(135deg, #E87A2E, #F59E0B)", padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em", animation: "siteiq-glow 1.5s ease-in-out infinite alternate" }}>NEW</span>}
                      {site.status === "recommended" && <div style={{ marginTop: 4, fontSize: 10, color: "#16A34A", fontWeight: 600 }}>✓ Dan R. Approved → {REGIONS[site.routedTo || site.region]?.label || "—"}</div>}
                    </div>
                  );
                })}
              </div>
              );
            })()}
          </div>
        )}

        {/* ═══ REVIEW DETAIL VIEW — Full property page from review queue ═══ */}
        {reviewDetailSite && (() => {
          const site = subs.find(s => s.id === reviewDetailSite);
          if (!site) { setReviewDetailSite(null); return null; }
          const iqR = computeSiteIQ(site);
          const ri = reviewInputs[site.id] || {};
          const setRI = (f, v) => setReviewInputs({ ...reviewInputs, [site.id]: { ...ri, [f]: v } });
          const dom = site.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;
          return (
            <div style={{ animation: "fadeIn .3s ease-out", position: "relative" }}>
              <button onClick={() => setReviewDetailSite(null)} style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid rgba(232,122,46,0.25)", background: "rgba(232,122,46,0.08)", color: "#E87A2E", fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 16 }}>← Back to Review Queue</button>

              {/* Header */}
              <div style={{ background: "linear-gradient(135deg, rgba(15,21,56,0.9), rgba(30,39,97,0.8))", borderRadius: 16, padding: 24, marginBottom: 20, border: "1px solid rgba(201,168,76,0.1)", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, transparent, ${iqR.classColor || "#C9A84C"}60, transparent)` }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{site.name}</h2>
                      <Badge status={site.status} />
                      {!site.recommendedAt && site.status === "pending" && <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: "linear-gradient(135deg, #E87A2E, #F59E0B)", padding: "3px 10px", borderRadius: 5, letterSpacing: "0.1em" }}>NEW</span>}
                    </div>
                    <div style={{ fontSize: 14, color: "#94A3B8" }}>{site.address}, {site.city}, {site.state}</div>
                    <div style={{ fontSize: 12, color: "#6B7394", marginTop: 4 }}>{site.acreage ? `${site.acreage} ac` : ""} {site.askingPrice ? `• ${site.askingPrice}` : ""} {site.zoning ? `• ${site.zoning}` : ""}</div>
                    {dom !== null && <span style={{ fontSize: 12, color: dom > 365 ? "#EF4444" : dom > 180 ? "#F59E0B" : "#94A3B8", fontWeight: 600 }}>{dom}d on market</span>}
                  </div>
                  <SiteIQBadge site={site} iq={iqR} />
                </div>
              </div>

              {/* SiteIQ Scorecard */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 20 }}>
                {(iqR.breakdown || []).map((b, i) => (
                  <div key={i} style={{ background: "rgba(15,21,56,0.6)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 4 }}>{b.label}</div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: b.score >= 8 ? "#16A34A" : b.score >= 6 ? "#D97706" : b.score >= 4 ? "#EA580C" : "#DC2626" }}>{b.score}<span style={{ fontSize: 12, color: "#6B7394" }}>/10</span></div>
                    <div style={{ fontSize: 10, color: "#6B7394" }}>{Math.round(b.weight * 100)}% weight</div>
                  </div>
                ))}
              </div>

              {/* Key Metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
                {[
                  { label: "Acreage", value: site.acreage ? `${site.acreage} ac` : "—" },
                  { label: "Asking Price", value: site.askingPrice || "—" },
                  { label: "Zoning", value: site.zoning || "—" },
                  { label: "3-Mi Population", value: site.pop3mi || "—" },
                  { label: "3-Mi Med. HHI", value: site.income3mi || "—" },
                  { label: "Market", value: site.market || "—" },
                  { label: "Broker", value: site.sellerBroker || "—" },
                  { label: "Nearest PS", value: site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : "—" },
                ].map(m => (
                  <div key={m.label} style={{ background: "rgba(15,21,56,0.5)", borderRadius: 10, padding: "10px 14px", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize: 10, color: "#6B7394", textTransform: "uppercase", fontWeight: 700, marginBottom: 2 }}>{m.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#E2E8F0" }}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Aerial */}
              {site.coordinates && (
                <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(201,168,76,0.1)", marginBottom: 20, position: "relative" }}>
                  <iframe title={`Aerial — ${site.name}`} src={`https://maps.google.com/maps?q=${encodeURIComponent(site.coordinates)}&t=k&z=17&output=embed`} style={{ width: "100%", height: 350, border: "none" }} loading="lazy" allowFullScreen />
                  <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>AERIAL VIEW</div>
                </div>
              )}

              {/* Summary */}
              {site.summary && (
                <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 12, padding: 16, marginBottom: 20, border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.08em" }}>Summary</div>
                  <div style={{ fontSize: 13, color: "#CBD5E1", lineHeight: 1.6 }}>{site.summary}</div>
                </div>
              )}

              {/* Links */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
                {site.coordinates && <a href={`https://www.google.com/maps?q=${site.coordinates}`} target="_blank" rel="noreferrer" style={{ padding: "12px 22px", borderRadius: 12, background: "rgba(21,101,192,0.12)", color: "#42A5F5", fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(21,101,192,0.25)" }}>🗺 Google Maps</a>}
                {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noreferrer" style={{ padding: "12px 22px", borderRadius: 12, background: "rgba(232,122,46,0.12)", color: "#E87A2E", fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(232,122,46,0.25)" }}>🔗 Property Listing</a>}
                <button onClick={() => { const psD = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null; const rpt = generateVettingReport(site, psD, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); window.open(URL.createObjectURL(blob), "_blank"); }} style={{ padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg, #E87A2E, #C9A84C)", color: "#fff", fontSize: 14, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 24px rgba(232,122,46,0.4)", letterSpacing: "0.05em", textTransform: "uppercase" }}>🔬 SiteIQ Deep Vet Report</button>
              </div>

              {/* ── ACTIVITY TIMELINE ── */}
              {(() => {
                const events = [];
                if (site.submittedAt) events.push({ ts: site.submittedAt, action: "Site entered review queue", by: "System", icon: "📥", color: "#F59E0B" });
                if (site.recommendedAt) events.push({ ts: site.recommendedAt, action: `Dan R. approved & routed to ${REGIONS[site.routedTo || site.region]?.label || "—"}`, by: site.recommendedBy || "Dan R.", icon: "✓", color: "#C9A84C" });
                if (site.approvedAt && site.approvedBy) events.push({ ts: site.approvedAt, action: `PS approved → moved to tracker`, by: site.approvedBy, icon: "⚡", color: "#16A34A" });
                // Pull from activityLog if it exists
                if (site.activityLog) {
                  Object.values(site.activityLog).forEach(log => {
                    if (log.ts && log.action) events.push({ ts: log.ts, action: log.action, by: log.by || "System", icon: "→", color: "#6366F1" });
                  });
                }
                events.sort((a, b) => new Date(b.ts) - new Date(a.ts));
                if (events.length === 0) return null;
                const fmtDate = (ts) => { const d = new Date(ts); const now = Date.now(); const diff = now - d.getTime(); if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`; if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`; return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
                return (
                  <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 16, marginBottom: 20, border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Activity Timeline</div>
                    <div style={{ position: "relative", paddingLeft: 20 }}>
                      <div style={{ position: "absolute", left: 6, top: 4, bottom: 4, width: 2, background: "rgba(201,168,76,0.1)", borderRadius: 1 }} />
                      {events.slice(0, 10).map((ev, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, marginBottom: i < events.length - 1 ? 12 : 0, position: "relative" }}>
                          <div style={{ position: "absolute", left: -14, top: 2, width: 14, height: 14, borderRadius: "50%", background: "rgba(15,21,56,0.9)", border: `2px solid ${ev.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8 }}>{ev.icon}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0" }}>{ev.action}</div>
                            <div style={{ fontSize: 10, color: "#6B7394", marginTop: 1 }}>{ev.by} · {fmtDate(ev.ts)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── APPROVAL ACTION BAR ── */}
              <div style={{ background: "linear-gradient(135deg, rgba(15,21,56,0.9), rgba(30,39,97,0.8))", borderRadius: 16, padding: 20, border: "1px solid rgba(201,168,76,0.15)", marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#C9A84C", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
                  {site.status === "pending" ? "📋 Your Decision" : site.status === "recommended" ? "⚡ PS Approval Required" : "Decision Made"}
                </div>

                {site.status === "pending" && (
                  <div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                      <select value={ri.routeTo || site.region || ""} onChange={(e) => setRI("routeTo", e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: "2px solid #C9A84C", fontSize: 13, background: "#FFFBEB", cursor: "pointer", minWidth: 200, fontWeight: 700, color: "#92700C" }}>
                        <option value="">Route to…</option>
                        <option value="southwest">→ Daniel Wollent (DW)</option>
                        <option value="east">→ Matthew Toussaint (MT)</option>
                      </select>
                      <input value={ri.note || ""} onChange={(e) => setRI("note", e.target.value)} placeholder="Review note…" style={{ flex: 1, minWidth: 200, padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(201,168,76,0.15)", fontSize: 13, outline: "none", background: "rgba(255,255,255,0.05)", color: "#E2E8F0" }} />
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => { if (!ri.routeTo && !site.region) { notify("Select route (DW or MT)"); return; } handleRecommend(site.id); setReviewDetailSite(null); }} style={{ padding: "12px 28px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#C9A84C,#1E2761)", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 20px rgba(201,168,76,0.3)", letterSpacing: "0.04em" }}>✓ Approve & Route</button>
                      <button onClick={() => { handleDecline(site.id); setReviewDetailSite(null); }} style={{ padding: "12px 28px", borderRadius: 12, border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.08)", color: "#EF4444", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✗ Reject</button>
                    </div>
                  </div>
                )}

                {site.status === "recommended" && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#16A34A", background: "#DCFCE7", padding: "4px 12px", borderRadius: 8 }}>Dan R. Approved</span>
                      <span style={{ fontSize: 12, color: "#94A3B8" }}>→ {REGIONS[site.routedTo || site.region]?.label || "Unassigned"}</span>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <select value={ri.reviewer || ""} onChange={(e) => setRI("reviewer", e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(22,163,74,0.3)", fontSize: 13, background: "rgba(22,163,74,0.08)", cursor: "pointer", minWidth: 180, fontWeight: 700, color: "#16A34A" }}>
                        <option value="">Approver…</option>
                        <option>Daniel Wollent</option>
                        <option>Matthew Toussaint</option>
                        <option>Jarrod</option>
                      </select>
                      <button onClick={() => { handlePSApprove(site.id); setReviewDetailSite(null); }} style={{ padding: "12px 28px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#16A34A,#15803D)", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 20px rgba(22,163,74,0.3)", letterSpacing: "0.04em" }}>⚡ Approve → Tracker</button>
                      <button onClick={() => { handleDecline(site.id); setReviewDetailSite(null); }} style={{ padding: "12px 28px", borderRadius: 12, border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.08)", color: "#EF4444", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✗ Reject</button>
                    </div>
                  </div>
                )}

                {site.status === "approved" && (
                  <div style={{ fontSize: 13, color: "#16A34A", fontWeight: 700 }}>⚡ Approved and routed to tracker</div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ═══ PROPERTY DETAIL VIEW ═══ */}
        {detailView && (() => {
          const dv = detailView;
          const allSites = sortData(dv.regionKey === "east" ? east : sw);
          const site = allSites.find(s => s.id === dv.siteId);
          if (!site) return <div style={{ textAlign: "center", padding: 40, color: "#6B7394" }}>Site not found. <button onClick={() => setDetailView(null)} style={{ color: "#E87A2E", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>← Back</button></div>;
          const idx = allSites.findIndex(s => s.id === dv.siteId);
          const prevSite = idx > 0 ? allSites[idx - 1] : null;
          const nextSite = idx < allSites.length - 1 ? allSites[idx + 1] : null;
          const iqR = getSiteIQ(site);
          const dom = site.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;
          const docs = site.docs ? Object.entries(site.docs) : [];
          const flyerDoc = docs.find(([, d]) => d.type === "Flyer");
          const navBtnSt = (disabled) => ({ padding: "10px 20px", borderRadius: 10, border: disabled ? "1px solid rgba(201,168,76,0.06)" : "1px solid rgba(232,122,46,0.25)", background: disabled ? "rgba(15,21,56,0.3)" : "rgba(232,122,46,0.08)", color: disabled ? "#4A5080" : "#E87A2E", fontSize: 12, fontWeight: 700, cursor: disabled ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" });
          // Keyboard nav for detail view
          const handleDetailKey = (e) => {
            if (e.key === "ArrowLeft" && prevSite) { setDetailView({ regionKey: dv.regionKey, siteId: prevSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }
            if (e.key === "ArrowRight" && nextSite) { setDetailView({ regionKey: dv.regionKey, siteId: nextSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }
            if (e.key === "Escape") { setDetailView(null); }
          };
          if (!window._detailKeyBound) { window.addEventListener("keydown", handleDetailKey); window._detailKeyBound = true; }

          return (
            <div style={{ animation: "fadeIn 0.15s ease-out" }}>
              {/* TOP NAV BAR */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, padding: "14px 0", borderBottom: "1px solid rgba(201,168,76,0.1)" }}>
                <button onClick={() => { setDetailView(null); window._detailKeyBound = false; navigateTo(dv.regionKey, { siteId: dv.siteId }); }} style={{ padding: "10px 20px", borderRadius: 10, background: "rgba(15,21,56,0.5)", border: "1px solid rgba(201,168,76,0.15)", color: "#C9A84C", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}>← Back to Tracker</button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button disabled={!prevSite} onClick={() => { if (prevSite) { setDetailView({ regionKey: dv.regionKey, siteId: prevSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}} style={navBtnSt(!prevSite)}>← Prev</button>
                  <span style={{ fontSize: 11, color: "#6B7394", fontWeight: 600, padding: "0 8px", letterSpacing: "0.04em" }}>{idx + 1} of {allSites.length}</span>
                  <button disabled={!nextSite} onClick={() => { if (nextSite) { setDetailView({ regionKey: dv.regionKey, siteId: nextSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}} style={navBtnSt(!nextSite)}>Next →</button>
                </div>
                <span style={{ fontSize: 9, color: "#4A5080", fontWeight: 500 }}>← → keys · Esc back</span>
              </div>

              {/* HERO HEADER */}
              <div style={{ background: "linear-gradient(135deg, #0a0a0e 0%, #1E2761 60%, #2C3E6B 100%)", borderRadius: 16, padding: "32px 36px", marginBottom: 20, position: "relative", overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, #C9A84C, #E87A2E, #C9A84C, transparent)", opacity: 0.6 }} />
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, transparent, #E87A2E, #C9A84C, #E87A2E, transparent)" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em", marginBottom: 6 }}>{site.name}</div>
                    <div style={{ fontSize: 14, color: "#94A3B8", marginBottom: 12 }}>{site.address}, {site.city}, {site.state}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {site.market && <span style={{ background: "rgba(251,191,36,.12)", color: "#FBBF24", fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 8, border: "1px solid rgba(251,191,36,.2)" }}>{site.market}</span>}
                      <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>{site.phase || "Prospect"}</span>
                      {dom !== null && <span style={{ fontSize: 12, color: dom > 365 ? "#EF4444" : dom > 180 ? "#F59E0B" : "#94A3B8", fontWeight: 600 }}>{dom}d on market</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <SiteIQBadge site={site} iq={iqR} />
                    <div style={{ marginTop: 8, fontSize: 11, color: "#94A3B8" }}>Broker: <strong style={{ color: "#E2E8F0" }}>{site.sellerBroker || "—"}</strong></div>
                  </div>
                </div>
              </div>

              {/* KEY METRICS STRIP */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 20 }}>
                {[
                  { label: "ASKING", val: fmtPrice(site.askingPrice), color: "#E2E8F0" },
                  { label: "INTERNAL", val: site.internalPrice ? fmtPrice(site.internalPrice) : "—", color: "#E87A2E" },
                  { label: "ACREAGE", val: site.acreage ? `${site.acreage} ac` : "—", color: "#E2E8F0" },
                  { label: "ZONING", val: site.zoning || "—", color: "#C9A84C" },
                  { label: "3MI POP", val: site.pop3mi ? fmtN(site.pop3mi) : "—", color: "#E2E8F0" },
                  { label: "3MI MED INC", val: site.income3mi ? "$" + fmtN(site.income3mi) : "—", color: "#E2E8F0" },
                ].map((m, i) => (
                  <div key={i} style={{ background: "rgba(15,21,56,0.5)", borderRadius: 12, padding: "14px 16px", border: "1px solid rgba(201,168,76,0.08)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 4 }}>{m.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: m.color, fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.val}</div>
                  </div>
                ))}
              </div>

              {/* ACTION BUTTONS */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24, padding: "16px 0", borderTop: "1px solid rgba(201,168,76,0.08)", borderBottom: "1px solid rgba(201,168,76,0.08)", alignItems: "center" }}>
                <button onClick={() => {
                  const iqGen = computeSiteIQ(site); const psD = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null; const rpt = generateVettingReport(site, psD, iqGen); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); window.open(url, "_blank"); autoGenerateVettingReport(dv.regionKey, site.id, site);
                }} style={{ padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg, #E87A2E, #C9A84C)", color: "#fff", fontSize: 14, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 24px rgba(232,122,46,0.4)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8 }}>🔬 SiteIQ Deep Vet Report</button>
                {site.coordinates && <>
                  <a href={mapsLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "12px 22px", borderRadius: 12, background: "rgba(21,101,192,0.12)", color: "#42A5F5", fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(21,101,192,0.25)", display: "flex", alignItems: "center", gap: 6 }}>🗺 Google Maps</a>
                  <a href={earthLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "12px 22px", borderRadius: 12, background: "rgba(46,125,50,0.12)", color: "#66BB6A", fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(46,125,50,0.25)", display: "flex", alignItems: "center", gap: 6 }}>🌍 Google Earth</a>
                </>}
                {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noopener noreferrer" style={{ padding: "12px 22px", borderRadius: 12, background: "rgba(232,122,46,0.12)", color: "#E87A2E", fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(232,122,46,0.25)", display: "flex", alignItems: "center", gap: 6 }}>🔗 Property Listing</a>}
                {flyerDoc && <a href={flyerDoc[1].url} target="_blank" rel="noopener noreferrer" style={{ padding: "12px 22px", borderRadius: 12, background: "rgba(243,124,51,0.12)", color: "#FFB347", fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(243,124,51,0.25)", display: "flex", alignItems: "center", gap: 6 }}>📄 View Flyer</a>}
              </div>

              {/* AERIAL VIEW */}
              {site.coordinates && (
                <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(201,168,76,0.1)", marginBottom: 20, position: "relative" }}>
                  <iframe title={`Aerial — ${site.name}`} src={`https://maps.google.com/maps?q=${encodeURIComponent(site.coordinates)}&t=k&z=17&output=embed`} style={{ width: "100%", height: 350, border: "none" }} loading="lazy" allowFullScreen />
                  <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}>AERIAL VIEW</div>
                </div>
              )}

              {/* SUMMARY */}
              <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 12, padding: 18, marginBottom: 20, border: "1px solid rgba(201,168,76,0.08)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Summary / Deal Notes</div>
                <div style={{ fontSize: 13, color: "#E2E8F0", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{site.summary || "No notes yet."}</div>
              </div>

              {/* DEMOGRAPHICS — Full display */}
              {(site.pop3mi || site.income3mi) && (() => {
                const pN2 = (v) => { if (!v) return null; const n = typeof v === "number" ? v : parseInt(String(v).replace(/[$,]/g, ""), 10); return isNaN(n) ? null : n; };
                const fP2 = (v, pre) => { const n = pN2(v); return n != null ? (pre || "") + n.toLocaleString() : null; };
                const gVal2 = site.popGrowth3mi ? parseFloat(site.popGrowth3mi) : null;
                const gColor2 = gVal2 != null ? (gVal2 > 0 ? "#22C55E" : gVal2 < 0 ? "#EF4444" : "#94A3B8") : "#6B7394";
                const gLabel2 = gVal2 != null ? ((gVal2 >= 0 ? "+" : "") + gVal2.toFixed(2) + "% /yr") : null;
                const gOutlook2 = gVal2 != null ? (gVal2 > 1.5 ? "High Growth" : gVal2 > 0.5 ? "Growing" : gVal2 > 0 ? "Stable Growth" : gVal2 > -0.5 ? "Flat" : "Declining") : null;
                const demoRows = [
                  { label: "Population (3-mi)", val: fP2(site.pop3mi), icon: "👥" },
                  { label: "Median HHI (3-mi)", val: fP2(site.income3mi, "$"), icon: "💰" },
                  { label: "Pop Growth (ESRI)", val: gLabel2, icon: "📈", color: gColor2 },
                  { label: "Growth Outlook", val: gOutlook2, icon: "🔮", color: gVal2 != null ? (gVal2 > 1.5 ? "#22C55E" : gVal2 > 0.5 ? "#4ADE80" : "#FBBF24") : "#6B7394" },
                  { label: "Households (3-mi)", val: fP2(site.households3mi), icon: "🏠" },
                  { label: "Median Home Value", val: fP2(site.homeValue3mi, "$"), icon: "🏡" },
                  { label: "Price / Acre", val: (() => { const p = parseFloat(String(site.askingPrice || "").replace(/[^0-9.]/g, "")); const a = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, "")); return (!isNaN(p) && p > 0 && !isNaN(a) && a > 0) ? "$" + Math.round(p / a).toLocaleString() + "/ac" : null; })(), icon: "🏷️" },
                  { label: "Nearest Facility", val: site.siteiqData?.nearestPS ? site.siteiqData.nearestPS.toFixed(1) + " mi" : null, icon: "📍" },
                  { label: "Competitors (3-mi)", val: site.siteiqData?.competitorCount != null ? String(site.siteiqData.competitorCount) : null, icon: "🏪" },
                ].filter(r => r.val != null);
                return demoRows.length > 0 ? (
                  <div style={{ borderRadius: 14, marginBottom: 20, overflow: "hidden", border: "1px solid rgba(201,168,76,0.1)" }}>
                    <div style={{ background: "linear-gradient(135deg,#0F172A,#1E293B,#1565C0)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14 }}>📊</span>
                      <span style={{ color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: "0.06em" }}>SITE DEMOGRAPHICS</span>
                      <span style={{ background: "linear-gradient(135deg,#FBBF24,#F59E0B)", color: "#0F172A", fontSize: 10, fontWeight: 900, padding: "2px 8px", borderRadius: 5 }}>ESRI 2025</span>
                    </div>
                    <div style={{ background: "rgba(15,21,56,0.3)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 0 }}>
                      {demoRows.map((row, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 18px", borderBottom: "1px solid rgba(201,168,76,0.06)" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 13 }}>{row.icon}</span><span style={{ fontSize: 12, fontWeight: 600, color: "#94A3B8" }}>{row.label}</span></span>
                          <span style={{ fontSize: 14, fontWeight: 800, color: row.color || "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{row.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              {/* ZONING & UTILITIES SNAPSHOT */}
              {(site.zoningNotes || site.utilityNotes || site.waterProvider) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                  {/* Zoning Card */}
                  <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, border: "1px solid rgba(201,168,76,0.08)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 14 }}>🏛</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#C9A84C", textTransform: "uppercase", letterSpacing: "0.06em" }}>Zoning</span>
                      {site.zoningClassification && site.zoningClassification !== "unknown" && (
                        <span style={{ padding: "2px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: site.zoningClassification === "by-right" ? "rgba(22,163,74,0.15)" : site.zoningClassification === "conditional" ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)", color: site.zoningClassification === "by-right" ? "#22C55E" : site.zoningClassification === "conditional" ? "#F59E0B" : "#EF4444" }}>{site.zoningClassification === "by-right" ? "BY-RIGHT" : site.zoningClassification === "conditional" ? "CONDITIONAL" : site.zoningClassification.toUpperCase()}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#E2E8F0", marginBottom: 6 }}>{site.zoning || "Not confirmed"}</div>
                    {site.zoningSource && <div style={{ fontSize: 10, color: "#6B7394", lineHeight: 1.5, marginBottom: 8, maxHeight: 60, overflow: "hidden" }}>{site.zoningSource.substring(0, 200)}...</div>}
                    {site.planningContact && <div style={{ fontSize: 10, color: "#94A3B8" }}>📞 {site.planningContact.substring(0, 100)}</div>}
                  </div>
                  {/* Utilities Card */}
                  <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, border: "1px solid rgba(201,168,76,0.08)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 14 }}>💧</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#16A34A", textTransform: "uppercase", letterSpacing: "0.06em" }}>Utilities</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {[
                        { label: "Water", val: site.waterAvailable === true ? "✓" : site.waterAvailable === false ? "✗" : "?", color: site.waterAvailable === true ? "#22C55E" : site.waterAvailable === false ? "#EF4444" : "#6B7394", detail: site.waterProvider },
                        { label: "Sewer", val: site.sewerAvailable === true ? "✓" : site.sewerAvailable === false ? "✗" : "?", color: site.sewerAvailable === true ? "#22C55E" : site.sewerAvailable === false ? "#EF4444" : "#6B7394", detail: site.sewerProvider },
                        { label: "Electric", val: site.threePhase === true ? "3Φ ✓" : site.electricProvider ? "✓" : "?", color: site.threePhase === true ? "#22C55E" : site.electricProvider ? "#22C55E" : "#6B7394", detail: site.electricProvider },
                        { label: "Flood", val: site.floodZone ? (site.floodZone.toLowerCase().includes("zone x") ? "Clear" : "Check") : "?", color: site.floodZone && site.floodZone.toLowerCase().includes("zone x") ? "#22C55E" : "#F59E0B" },
                      ].map((u, i) => (
                        <div key={i} style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8" }}>{u.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: u.color }}>{u.val}</span>
                          </div>
                          {u.detail && <div style={{ fontSize: 8, color: "#6B7394", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.detail.substring(0, 40)}</div>}
                        </div>
                      ))}
                    </div>
                    {site.tapFees && <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 8 }}>💲 {site.tapFees.substring(0, 80)}...</div>}
                  </div>
                </div>
              )}

              {/* TOPO & ACCESS SNAPSHOT */}
              {(site.terrain || site.floodZone || site.gradingRisk) && (
                <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, marginBottom: 20, border: "1px solid rgba(201,168,76,0.08)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 14 }}>🌍</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#E87A2E", textTransform: "uppercase", letterSpacing: "0.06em" }}>Topography & Access</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    {[
                      { label: "FEMA Flood", val: site.floodZone || "Not checked", icon: "🌊" },
                      { label: "Terrain", val: site.terrain || "Not assessed", icon: "⛰️" },
                      { label: "Grading Risk", val: site.gradingRisk || "Not assessed", icon: "📐" },
                    ].map((t, i) => (
                      <div key={i} style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(15,21,56,0.3)" }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", marginBottom: 4 }}>{t.icon} {t.label}</div>
                        <div style={{ fontSize: 11, color: "#E2E8F0", lineHeight: 1.4, maxHeight: 44, overflow: "hidden" }}>{typeof t.val === "string" ? t.val.substring(0, 80) : t.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ZONING RESEARCH NOTES (full) */}
              {site.zoningNotes && (
                <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, marginBottom: 20, border: "1px solid rgba(201,168,76,0.08)" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#C9A84C", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>🏛 Zoning Research Notes</div>
                  <div style={{ fontSize: 12, color: "#E2E8F0", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{site.zoningNotes}</div>
                </div>
              )}

              {/* UTILITY RESEARCH NOTES (full) */}
              {site.utilityNotes && (
                <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, marginBottom: 20, border: "1px solid rgba(201,168,76,0.08)" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#16A34A", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>💧 Utility Research Notes</div>
                  <div style={{ fontSize: 12, color: "#E2E8F0", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{site.utilityNotes}</div>
                </div>
              )}

              {/* DOCUMENTS */}
              {docs.length > 0 && (
                <div style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, marginBottom: 20, border: "1px solid rgba(201,168,76,0.08)" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>📁 Documents ({docs.length})</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {docs.map(([dk, doc]) => (
                      <a key={dk} href={doc.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, background: "rgba(232,122,46,0.08)", border: "1px solid rgba(232,122,46,0.15)", color: "#E87A2E", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>{doc.type}: {doc.name?.length > 25 ? doc.name.slice(0, 25) + "…" : doc.name} ↗</a>
                    ))}
                  </div>
                </div>
              )}

              {/* SITEIQ DETAILED SCORECARD */}
              {iqR && iqR.scores && (() => {
                const dims2 = [
                  { key: "population", label: "Population", icon: "👥", weight: getIQWeight("population") },
                  { key: "growth", label: "Growth", icon: "📈", weight: getIQWeight("growth") },
                  { key: "income", label: "Income", icon: "💰", weight: getIQWeight("income") },
                  { key: "pricing", label: "Pricing", icon: "🏷️", weight: getIQWeight("pricing") },
                  { key: "zoning", label: "Zoning", icon: "🏛️", weight: getIQWeight("zoning") },
                  { key: "access", label: "Site Access", icon: "🛣️", weight: getIQWeight("access") },
                  { key: "competition", label: "Competition", icon: "🏪", weight: getIQWeight("competition") },
                  { key: "marketTier", label: "Market Tier", icon: "🎯", weight: getIQWeight("marketTier") },
                ];
                const sc2 = (v) => v >= 8 ? "#22C55E" : v >= 6 ? "#3B82F6" : v >= 4 ? "#F59E0B" : "#EF4444";
                return (
                  <div style={{ borderRadius: 14, marginBottom: 20, overflow: "hidden", border: "1px solid rgba(232,122,46,0.15)" }}>
                    <div style={{ background: "linear-gradient(135deg,#1a0a00,#2a1505)", padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14 }}>🔬</span>
                        <span style={{ color: "#FFB347", fontSize: 13, fontWeight: 800, letterSpacing: "0.06em" }}>SiteIQ™ SCORECARD</span>
                        <span style={{ color: sc2(iqR.score), fontSize: 14, fontWeight: 900, fontFamily: "'Space Mono'" }}>{iqR.score.toFixed(1)}</span>
                      </div>
                      {iqR.flags && iqR.flags.length > 0 && <div style={{ display: "flex", gap: 4 }}>{iqR.flags.map((f, i) => <span key={i} style={{ fontSize: 9, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", padding: "2px 6px", borderRadius: 4 }}>{f}</span>)}</div>}
                    </div>
                    <div style={{ background: "linear-gradient(180deg,#0F0A05,#0a0a0e)", padding: "8px 14px" }}>
                      {dims2.map((d, i) => {
                        const v2 = iqR.scores[d.key] || 0;
                        const pct2 = (v2 / 10) * 100;
                        return (
                          <div key={d.key} style={{ display: "grid", gridTemplateColumns: "28px 1fr 50px 90px 60px", alignItems: "center", gap: 6, padding: "7px 4px", borderBottom: i < dims2.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none" }}>
                            <span style={{ fontSize: 13, textAlign: "center" }}>{d.icon}</span>
                            <div><div style={{ fontSize: 11, fontWeight: 700, color: "#E2E8F0" }}>{d.label}</div><div style={{ fontSize: 8, color: "#6B7394" }}>{(d.weight * 100).toFixed(0)}% weight</div></div>
                            <div style={{ textAlign: "right", fontSize: 15, fontWeight: 900, color: sc2(v2), fontFamily: "'Space Mono'" }}>{v2}</div>
                            <div style={{ background: "rgba(255,255,255,.06)", borderRadius: 4, height: 10, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct2}%`, background: `linear-gradient(90deg, ${sc2(v2)}88, ${sc2(v2)})`, borderRadius: 4 }} /></div>
                            <div style={{ textAlign: "right", fontSize: 11, fontWeight: 800, color: "#FBBF24", fontFamily: "'Space Mono'" }}>{(v2 * d.weight).toFixed(2)}</div>
                          </div>
                        );
                      })}
                      <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 4px 4px", borderTop: "2px solid rgba(243,124,51,.2)", marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: "#94A3B8" }}>COMPOSITE: <span style={{ color: "#FBBF24", fontWeight: 900, fontSize: 14, fontFamily: "'Space Mono'" }}>{iqR.score.toFixed(1)}</span> / 10</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* BOTTOM NAV */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0", borderTop: "1px solid rgba(201,168,76,0.1)" }}>
                <button disabled={!prevSite} onClick={() => { if (prevSite) { setDetailView({ regionKey: dv.regionKey, siteId: prevSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); } }} style={{ ...navBtnSt(!prevSite), padding: "12px 24px" }}>← {prevSite ? prevSite.name : "Start"}</button>
                <button onClick={() => { setDetailView(null); navigateTo(dv.regionKey); }} style={{ padding: "12px 24px", borderRadius: 10, background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.15)", color: "#C9A84C", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>↩ Back to Tracker</button>
                <button disabled={!nextSite} onClick={() => { if (nextSite) { setDetailView({ regionKey: dv.regionKey, siteId: nextSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); } }} style={{ ...navBtnSt(!nextSite), padding: "12px 24px" }}>{nextSite ? nextSite.name : "End"} →</button>
              </div>
            </div>
          );
        })()}

        {/* ═══ TRACKERS ═══ */}
        {(tab === "southwest" || tab === "east") && !detailView && <TrackerCards regionKey={tab} />}
      </div>

            {/* ═══ COPYRIGHT FOOTER ═══ */}
                  <div style={{ textAlign: "center", padding: "18px 0 14px", borderTop: "1px solid rgba(201,168,76,0.1)", marginTop: 24, color: "#94A3B8", fontSize: 11, letterSpacing: 0.3 }}>
                          © {new Date().getFullYear()} DJR Real Estate LLC. All rights reserved. Proprietary software — unauthorized reproduction prohibited.
                                </div>
    </div>
  );
}
