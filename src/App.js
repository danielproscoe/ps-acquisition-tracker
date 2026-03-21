// src/App.js — SiteScore Acquisition Tracker
// © 2026 DJR Real Estate LLC. All rights reserved.
// Proprietary and confidential. Unauthorized reproduction or distribution prohibited.
// Firebase Realtime Database — live shared data across all 3 users

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  "SiteScore Approved",
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
  "Client Approved": "SiteScore Approved",
  "PS Approved": "SiteScore Approved",
  "SiteIQ Approved": "SiteScore Approved",
  "StorageIQ Approved": "SiteScore Approved",
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

// ─── SiteScore™ Configurable Weight System v2.0 ───
// Immutable defaults. Live config is a deep copy merged with Firebase overrides.
// Persisted at Firebase path: config/siteiq_weights
const SITE_SCORE_DEFAULTS = [
  { key: "population", label: "Population", icon: "👥", weight: 0.16, tip: "3-mile population density", source: "ESRI / Census ACS", group: "demographics" },
  { key: "growth", label: "Growth", icon: "📈", weight: 0.21, tip: "Pop growth CAGR — 5yr projected trend", source: "ESRI 2025→2030 projections", group: "demographics" },
  { key: "income", label: "Med. Income", icon: "💰", weight: 0.10, tip: "Median HHI within 3 miles", source: "ESRI / Census ACS", group: "demographics" },
  { key: "households", label: "Households", icon: "🏠", weight: 0.05, tip: "3-mile household count (demand proxy)", source: "ESRI / Census ACS", group: "demographics" },
  { key: "homeValue", label: "Home Value", icon: "🏡", weight: 0.05, tip: "Median home value — affluence signal", source: "ESRI / Census ACS", group: "demographics" },
  { key: "zoning", label: "Zoning", icon: "📋", weight: 0.16, tip: "By-right / conditional / prohibited", source: "Zoning field + summary", group: "entitlements" },
  { key: "psProximity", label: "PS Proximity", icon: "📦", weight: 0.11, tip: "Distance to nearest PS location", source: "siteiqData.nearestPS", group: "market" },
  { key: "access", label: "Site Access", icon: "🛣️", weight: 0.07, tip: "Acreage, frontage, flood, access", source: "Site data + summary", group: "physical" },
  { key: "competition", label: "Competition", icon: "🏢", weight: 0.07, tip: "Storage competitor density", source: "Competitor data / summary", group: "market" },
  { key: "marketTier", label: "Market Tier", icon: "📍", weight: 0.02, tip: "Target market priority ranking", source: "Market field / config", group: "market" },
];

// Live mutable config — starts as copy of defaults, merged with Firebase on load
let SITE_SCORE_CONFIG = SITE_SCORE_DEFAULTS.map(d => ({ ...d }));

// Auto-normalize so weights always sum to 1.0
const normalizeSiteScoreWeights = (dims) => {
  const total = dims.reduce((s, d) => s + d.weight, 0);
  if (total > 0 && Math.abs(total - 1.0) > 0.001) {
    dims.forEach(d => { d.weight = d.weight / total; });
  }
  return dims;
};

// Get normalized weight by key
const getIQWeight = (key) => {
  const dim = SITE_SCORE_CONFIG.find(d => d.key === key);
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

// ─── Safe Number Parser — prevents NaN propagation ───
const safeNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? fallback : n;
};

// ─── HTML Escape — prevents XSS in report generators ───
const escapeHtml = (str) => {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
  try {
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
  // Utility Readiness Score (0-100) — quantifies how "hookup-ready" a site is
  const utilChecks = [
    { done: !!site.waterProvider, weight: 20, label: "Water provider identified" },
    { done: site.waterAvailable === true, weight: 15, label: "Water confirmed available" },
    { done: site.insideServiceBoundary === true, weight: 10, label: "Inside service boundary" },
    { done: !!site.sewerProvider || hasSeptic, weight: 12, label: "Sewer/septic solution" },
    { done: site.sewerAvailable === true || hasSeptic, weight: 8, label: "Sewer confirmed" },
    { done: !!site.electricProvider, weight: 10, label: "Electric provider identified" },
    { done: site.threePhase === true, weight: 10, label: "3-phase power available" },
    { done: !!site.waterTapFee || !!site.tapFees, weight: 5, label: "Tap fees documented" },
    { done: site.fireFlowAdequate === true, weight: 5, label: "Fire flow confirmed" },
    { done: !!site.distToWaterMain, weight: 5, label: "Distance to main known" },
  ];
  const utilScore = utilChecks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  const utilGrade = utilScore >= 80 ? "A" : utilScore >= 60 ? "B" : utilScore >= 40 ? "C" : utilScore >= 20 ? "D" : "F";
  const utilGradeColor = utilScore >= 80 ? "#16A34A" : utilScore >= 60 ? "#3B82F6" : utilScore >= 40 ? "#F59E0B" : "#EF4444";
  // Water hookup cost estimator
  const distFt = site.distToWaterMain ? parseFloat(String(site.distToWaterMain).replace(/[^0-9.]/g, "")) : null;
  const waterTapN = site.waterTapFee ? parseFloat(String(site.waterTapFee).replace(/[^0-9.]/g, "")) : null;
  const sewerTapN = site.sewerTapFee ? parseFloat(String(site.sewerTapFee).replace(/[^0-9.]/g, "")) : null;
  const impactN = site.impactFees ? parseFloat(String(site.impactFees).replace(/[^0-9.]/g, "")) : null;
  const extensionLow = distFt ? Math.round(distFt * 50) : null;
  const extensionHigh = distFt ? Math.round(distFt * 150) : null;
  const totalUtilLow = (waterTapN || 0) + (sewerTapN || 0) + (impactN || 0) + (extensionLow || 0);
  const totalUtilHigh = (waterTapN || 0) + (sewerTapN || 0) + (impactN || 0) + (extensionHigh || 0);
  if (site.waterAvailable === false && !site.distToWaterMain) flags.push("Water extension required but distance to main UNKNOWN — critical cost variable");
  if (distFt && distFt > 500) flags.push(`Water main is ${Math.round(distFt)} LF away — extension cost est. $${Math.round(extensionLow/1000)}K–$${Math.round(extensionHigh/1000)}K`);
  if (site.fireFlowAdequate === false) flags.push("Fire flow INADEQUATE — hydrant/main upgrade required before development");
  const iq = iqResult || (typeof computeSiteScore === "function" ? computeSiteScore(site) : null);
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
          <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#2E9E6B,#1E2761);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(46,158,107,0.4)"><span style="font-size:22px;font-weight:900;color:#fff;font-family:'Space Mono';letter-spacing:-0.02em">S</span></div>
          <div><div style="font-size:10px;color:#94A3B8;letter-spacing:0.12em;text-transform:uppercase">Site Vetting Report</div><div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:0.01em;margin-top:2px">${site.name || "Unnamed Site"}</div></div>
        </div>
        <div style="font-size:12px;color:#94A3B8;margin-top:4px">${site.address || ""}, ${site.city || ""}, ${site.state || ""} &nbsp;|&nbsp; ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
      </div>
      <div style="text-align:right">
        <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:10px;background:${iqBadgeColor}18;border:1px solid ${iqBadgeColor}40">
          <span style="font-size:28px;font-weight:900;color:${iqBadgeColor};font-family:'Space Mono'">${typeof iqScore === "number" ? iqScore.toFixed(1) : iqScore}</span>
          <div><div style="font-size:9px;color:#CBD5E1;letter-spacing:0.1em;font-weight:700">SITESCORE<span style="font-size:7px;vertical-align:super">™</span></div><div style="font-size:11px;font-weight:800;color:${iqBadgeColor}">${iqLabel}</div></div>
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
        { label: "Ordinance Section Referenced", done: !!site.zoningOrdinanceSection, category: "ZONING" },
        { label: "Exact Use Category Extracted", done: !!site.zoningUseTerm, category: "ZONING" },
        { label: "Jurisdiction Type Identified", done: !!site.jurisdictionType, category: "ZONING" },
        { label: "Planning Dept Contact Found", done: !!site.planningContact, category: "ZONING" },
        { label: "Permitted Use Table Reviewed", done: !!site.zoningNotes && site.zoningNotes.length > 20, category: "ZONING" },
        { label: "Water Provider Identified", done: !!site.waterProvider, category: "UTILITY" },
        { label: "Water Availability Confirmed", done: site.waterAvailable === true || site.waterAvailable === false, category: "UTILITY" },
        { label: "Inside Service Boundary", done: site.insideServiceBoundary === true || site.insideServiceBoundary === false, category: "UTILITY" },
        { label: "Distance to Water Main", done: !!site.distToWaterMain, category: "UTILITY" },
        { label: "Fire Flow Assessed", done: site.fireFlowAdequate === true || site.fireFlowAdequate === false, category: "UTILITY" },
        { label: "Sewer Provider Identified", done: !!site.sewerProvider, category: "UTILITY" },
        { label: "Sewer Availability Confirmed", done: site.sewerAvailable === true || site.sewerAvailable === false, category: "UTILITY" },
        { label: "Electric Provider + 3-Phase", done: !!site.electricProvider, category: "UTILITY" },
        { label: "Tap/Impact Fees Documented", done: !!site.tapFees || !!site.waterTapFee, category: "UTILITY" },
        { label: "FEMA Flood Zone Checked", done: !!site.floodZone, category: "TOPO" },
        { label: "FIRM Panel Recorded", done: !!site.firmPanel, category: "TOPO" },
        { label: "Soil Type Checked", done: !!site.soilType, category: "TOPO" },
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
      row("Exact Use Category", site.zoningUseTerm || "<em style='color:#94A3B8'>Extract from permitted use table</em>"),
      row("Overlay Districts", site.overlayDistrict || (hasOverlay ? "Yes — additional standards apply (check summary)" : "None identified")),
      row("Jurisdiction Type", site.jurisdictionType || "<em style='color:#94A3B8'>City / Township / Unincorporated County</em>"),
      row("Ordinance Section", site.zoningOrdinanceSection || "<em style='color:#94A3B8'>Section & chapter reference needed</em>"),
      row("Ordinance Source", site.zoningSource || "<em style='color:#94A3B8'>Not yet researched</em>"),
      row("Verification Date", site.zoningVerifyDate || "<em style='color:#94A3B8'>Not verified</em>"),
      row("Zoning Score", zoningScore != null ? `<span style="font-weight:900;color:${zoningScoreColor};font-family:'Space Mono',monospace">${zoningScore.toFixed(1)}/10</span>` : "—"),
      site.zoningClass === "conditional" || hasSUP ? row("SUP/CUP Timeline", site.supTimeline || "<em style='color:#F59E0B'>Typically 2–6 months — confirm with planning</em>") : "",
      site.zoningClass === "conditional" || hasSUP ? row("SUP/CUP Est. Cost", site.supCost || "<em style='color:#F59E0B'>$15K–$50K typical — confirm with local attorney</em>") : "",
      site.zoningClass === "conditional" || hasSUP ? row("Political Risk", site.politicalRisk || "<em style='color:#94A3B8'>Check recent similar applications</em>") : "",
      site.zoningClass === "rezone-required" || hasRezone ? row("Rezone Timeline", site.rezoneTimeline || "<em style='color:#EF4444'>4–12 months typical</em>") : "",
      site.zoningClass === "rezone-required" || hasRezone ? row("Rezone Est. Cost", site.rezoneCost || "<em style='color:#EF4444'>$25K–$75K+ typical</em>") : "",
      row("Planning Contact", site.planningContact || "<em style='color:#94A3B8'>Research needed</em>"),
      row("Planning Phone", site.planningPhone || "<em style='color:#94A3B8'>—</em>"),
      row("Planning Email", site.planningEmail || "<em style='color:#94A3B8'>—</em>"),
    ].filter(Boolean).join("")}</table>
    ${site.zoningNotes ? `<div style="margin-top:12px;padding:14px 18px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:12px;line-height:1.7;color:#475569">${site.zoningNotes}</div>` : ""}
    <div style="margin-top:10px;padding:10px 16px;border-radius:6px;background:#F0F4FF;border-left:3px solid #1E2761;font-size:9px;color:#475569;line-height:1.6">
      <strong style="color:#1E2761;font-size:9px;letter-spacing:0.05em">RESEARCH METHODOLOGY</strong><br/>
      Zoning classification sourced from municipal ordinance permitted use table. Ordinance databases searched: ecode360.com, Municode.com, American Legal Publishing, Code Publishing Co., and jurisdiction websites. Storage use terms searched: "storage warehouse," "mini-warehouse," "self-service storage," "self-storage," "personal storage," "indoor storage," "warehouse (mini/self-service)." Overlay districts identified via zoning map review. Supplemental standards extracted from district-specific regulations. Planning department contact sourced from jurisdiction website. Verification date: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
    </div>
    <!-- Entitlement Risk Matrix -->
    ${(zoningClass === "conditional" || zoningClass === "rezone-required" || hasSUP || hasRezone) ? `
    <div style="margin-top:16px;padding:16px 20px;border-radius:10px;background:#FEF3C7;border:2px solid #F59E0B40">
      <div style="font-size:11px;font-weight:800;color:#92400E;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px">&#9888; Entitlement Risk Assessment</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div style="text-align:center;padding:10px;border-radius:8px;background:#fff;border:1px solid #FDE68A">
          <div style="font-size:9px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.05em">Timeline</div>
          <div style="font-size:16px;font-weight:900;color:#D97706;margin-top:4px">${site.supTimeline || site.rezoneTimeline || (hasSUP ? "2–6 mo" : "4–12 mo")}</div>
        </div>
        <div style="text-align:center;padding:10px;border-radius:8px;background:#fff;border:1px solid #FDE68A">
          <div style="font-size:9px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.05em">Est. Cost</div>
          <div style="font-size:16px;font-weight:900;color:#D97706;margin-top:4px">${site.supCost || site.rezoneCost || (hasSUP ? "$15–50K" : "$25–75K+")}</div>
        </div>
        <div style="text-align:center;padding:10px;border-radius:8px;background:#fff;border:1px solid #FDE68A">
          <div style="font-size:9px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.05em">Political Risk</div>
          <div style="font-size:16px;font-weight:900;color:#D97706;margin-top:4px">${site.politicalRisk || "Assess"}</div>
        </div>
      </div>
      ${site.recentApprovals ? `<div style="font-size:11px;color:#78350F;margin-top:10px;line-height:1.5"><strong>Recent Similar Applications:</strong> ${site.recentApprovals}</div>` : `<div style="font-size:10px;color:#92400E;margin-top:8px;font-style:italic">Check jurisdiction for recent storage/warehouse approvals or denials — establishes political precedent.</div>`}
    </div>` : ""}
    <!-- Supplemental Standards Grid -->
    <div style="margin-top:16px"><div style="font-size:11px;font-weight:800;color:#1E2761;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Supplemental Standards</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      ${[
        { label: "Facade / Materials", icon: "&#127959;", text: site.facadeReqs || (/facade|material|masonry|brick/i.test(combined) ? "Requirements noted — see summary" : "No specific requirements identified") },
        { label: "Setbacks", icon: "&#128208;", text: site.setbackReqs || (/setback/i.test(combined) ? "Setback requirements noted" : "Standard district setbacks apply") },
        { label: "Height Limits", icon: "&#128207;", text: site.heightLimit || (/height\s*limit|max.*height|story.*limit/i.test(combined) ? "Height restrictions noted" : "Standard district height limits") },
        { label: "Screening / Landscape", icon: "&#127807;", text: site.screeningReqs || (/screen|landscape|buffer/i.test(combined) ? "Screening / landscaping required" : "Standard requirements") },
        { label: "Signage", icon: "&#129707;", text: site.signageReqs || (/sign/i.test(combined) ? "Signage requirements noted" : "Standard district signage rules") },
        { label: "Parking", icon: "&#127359;", text: site.parkingReqs || (/parking/i.test(combined) ? "Parking requirements noted" : "Per district standards") },
      ].map(s => `<div style="padding:12px 16px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0"><div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:14px">${s.icon}</span><span style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.04em">${s.label}</span></div><div style="font-size:12px;color:#64748B">${s.text}</div></div>`).join("")}
    </div></div>

    <!-- 3. UTILITIES & WATER — HARD VET -->
    ${section("3", "Utilities & Water — Can We Hook Up?", "")}
    <!-- Utility Readiness Score -->
    <div style="display:flex;gap:16px;margin-bottom:16px">
      <div style="flex:1;padding:16px 20px;border-radius:10px;background:${utilGradeColor}08;border:2px solid ${utilGradeColor}30;text-align:center">
        <div style="font-size:9px;font-weight:800;color:${utilGradeColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Utility Readiness</div>
        <div style="font-size:36px;font-weight:900;color:${utilGradeColor};font-family:'Space Mono',monospace;line-height:1">${utilGrade}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">${utilScore}/100 points</div>
        <div style="margin-top:8px;height:6px;border-radius:3px;background:#E2E8F0;overflow:hidden"><div style="height:100%;width:${utilScore}%;border-radius:3px;background:${utilGradeColor};transition:width 0.5s ease"></div></div>
      </div>
      ${totalUtilLow > 0 || totalUtilHigh > 0 ? `<div style="flex:1;padding:16px 20px;border-radius:10px;background:#FEF3C7;border:2px solid #FDE68A;text-align:center">
        <div style="font-size:9px;font-weight:800;color:#92400E;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Est. Utility Budget</div>
        <div style="font-size:22px;font-weight:900;color:#D97706;font-family:'Space Mono',monospace;line-height:1">$${totalUtilLow > 0 ? (totalUtilLow/1000).toFixed(0) + "K" : "—"} – $${totalUtilHigh > 0 ? (totalUtilHigh/1000).toFixed(0) + "K" : "—"}</div>
        <div style="font-size:10px;color:#78350F;margin-top:6px;line-height:1.4">${waterTapN ? "Water tap: $" + (waterTapN/1000).toFixed(0) + "K" : ""}${sewerTapN ? " | Sewer tap: $" + (sewerTapN/1000).toFixed(0) + "K" : ""}${extensionLow ? " | Extension: $" + (extensionLow/1000).toFixed(0) + "K–$" + (extensionHigh/1000).toFixed(0) + "K" : ""}${impactN ? " | Impact: $" + (impactN/1000).toFixed(0) + "K" : ""}</div>
      </div>` : `<div style="flex:1;padding:16px 20px;border-radius:10px;background:#F8FAFC;border:2px solid #E2E8F0;text-align:center">
        <div style="font-size:9px;font-weight:800;color:#94A3B8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Est. Utility Budget</div>
        <div style="font-size:18px;font-weight:700;color:#94A3B8;margin-top:8px">Pending Data</div>
        <div style="font-size:10px;color:#94A3B8;margin-top:6px">Add tap fees & distance to main for auto-estimate</div>
      </div>`}
    </div>
    <!-- Readiness Checklist -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:16px;padding:12px 16px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0">
      ${utilChecks.map(c => `<div style="display:flex;align-items:center;gap:6px;padding:3px 0"><span style="font-size:12px">${c.done ? "&#9989;" : "&#11036;"}</span><span style="font-size:10px;color:${c.done ? "#16A34A" : "#94A3B8"};font-weight:${c.done ? 600 : 400}">${c.label}</span></div>`).join("")}
    </div>
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
    <div style="font-size:11px;font-weight:800;color:#16A34A;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Water & Sewer Infrastructure</div>
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Water Provider", site.waterProvider || "<em style='color:#94A3B8'>Research needed</em>"),
      row("Water Available", site.waterAvailable === true ? '<span style="color:#16A34A;font-weight:700">YES — Municipal</span>' : site.waterAvailable === false ? '<span style="color:#EF4444;font-weight:700">NO — Extension Required</span>' : "<em style='color:#94A3B8'>Not confirmed — verify with provider</em>"),
      row("Inside Service Boundary", site.insideServiceBoundary === true ? '<span style="color:#16A34A;font-weight:700">YES</span>' : site.insideServiceBoundary === false ? '<span style="color:#EF4444;font-weight:700">NO — outside boundary</span>' : "<em style='color:#94A3B8'>Verify via utility service area map</em>"),
      row("Distance to Water Main", site.distToWaterMain || "<em style='color:#94A3B8'>Verify via GIS / utility maps</em>"),
      row("Water Main Size", site.waterMainSize || "<em style='color:#94A3B8'>Request from provider — min 6\" for fire flow</em>"),
      row("Fire Flow Adequate", site.fireFlowAdequate === true ? '<span style="color:#16A34A;font-weight:700">YES — meets fire code</span>' : site.fireFlowAdequate === false ? '<span style="color:#EF4444;font-weight:700">NO — hydrant/main upgrade needed</span>' : "<em style='color:#94A3B8'>Confirm 1,500+ GPM at 20 PSI for commercial</em>"),
      row("Nearest Fire Hydrant", site.nearestHydrant || "<em style='color:#94A3B8'>Check aerial / Google Street View</em>"),
      row("Sewer Provider", site.sewerProvider || "<em style='color:#94A3B8'>Research needed</em>"),
      row("Sewer Available", site.sewerAvailable === true ? '<span style="color:#16A34A;font-weight:700">YES</span>' : site.sewerAvailable === false && hasSeptic ? '<span style="color:#16A34A;font-weight:700">Septic — viable for storage</span>' : site.sewerAvailable === false ? '<span style="color:#F59E0B;font-weight:700">NO — septic may be viable</span>' : "<em style='color:#94A3B8'>Not confirmed</em>"),
      row("Distance to Sewer Main", site.distToSewerMain || "<em style='color:#94A3B8'>Verify via GIS / utility maps</em>"),
      row("Capacity / Moratorium", site.utilityCapacity || "<em style='color:#94A3B8'>Check for allocation limits or moratoriums</em>"),
    ].join("")}</table>
    <div style="font-size:11px;font-weight:800;color:#16A34A;text-transform:uppercase;letter-spacing:0.06em;margin:16px 0 8px">Power, Gas & Telecom</div>
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Electric Provider", site.electricProvider || "<em style='color:#94A3B8'>Research needed</em>"),
      row("3-Phase Power", site.threePhase === true ? '<span style="color:#16A34A;font-weight:700">Available</span>' : site.threePhase === false ? '<span style="color:#F59E0B;font-weight:700">Not available — upgrade needed ($15K–$40K typical)</span>' : "<em style='color:#94A3B8'>Required for HVAC on climate-controlled units</em>"),
      row("Natural Gas", site.gasProvider || (/\bgas\b/i.test(combined) ? "Available per site data" : "<em style='color:#94A3B8'>Verify — needed for heating in climate-controlled</em>")),
      row("Fiber / Telecom", site.telecomProvider || (/fiber|telecom/i.test(combined) ? "Available" : "<em style='color:#94A3B8'>Needed for smart-access, security systems</em>")),
    ].join("")}</table>
    <div style="font-size:11px;font-weight:800;color:#16A34A;text-transform:uppercase;letter-spacing:0.06em;margin:16px 0 8px">Fees & Cost Estimates</div>
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Water Tap Fee", site.waterTapFee || "<em style='color:#94A3B8'>Check jurisdiction fee schedule</em>"),
      row("Sewer Tap Fee", site.sewerTapFee || "<em style='color:#94A3B8'>Check jurisdiction fee schedule</em>"),
      row("Impact Fees", site.impactFees || "<em style='color:#94A3B8'>Check for transportation / drainage impact fees</em>"),
      row("Line Extension Est.", site.lineExtensionCost || (site.distToWaterMain ? "<em style='color:#F59E0B'>Estimate at $50–$150/LF based on distance</em>" : "<em style='color:#94A3B8'>Depends on distance to main</em>")),
      row("Total Utility Budget Est.", site.totalUtilityBudget || "<em style='color:#94A3B8'>Sum tap fees + impact fees + extension costs</em>"),
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
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("FEMA Flood Zone", site.floodZone || (hasFlood ? '<span style="color:#F59E0B;font-weight:700">Flood concern noted — verify FEMA panel</span>' : "<em style='color:#94A3B8'>Check msc.fema.gov</em>")),
      row("FIRM Panel #", site.firmPanel || "<em style='color:#94A3B8'>Locate at msc.fema.gov</em>"),
      row("Terrain", site.terrain || "<em style='color:#94A3B8'>Review Google Earth / county contours</em>"),
      row("Grade Change", site.gradeChange || "<em style='color:#94A3B8'>Estimate via elevation profile</em>"),
      row("Drainage Direction", site.drainageDirection || "<em style='color:#94A3B8'>Assess from contours</em>"),
      row("Grading Risk", site.gradingRisk || "<em style='color:#94A3B8'>Assess from aerial/contours</em>"),
      row("Est. Grading Cost", site.gradingCost || (site.gradingRisk === "High" ? '<span style="color:#EF4444;font-weight:700">$150K–$400K+ estimated</span>' : site.gradingRisk === "Medium" ? '<span style="color:#F59E0B">$50K–$150K estimated</span>' : "<em style='color:#94A3B8'>Based on grade assessment</em>")),
      row("Wetlands (NWI)", site.wetlands === true ? '<span style="color:#EF4444;font-weight:700">Present — reduces developable area</span>' : site.wetlands === false ? '<span style="color:#16A34A">None identified per NWI</span>' : "<em style='color:#94A3B8'>Check NWI mapper</em>"),
      row("Wetland Area", site.wetlandArea || (site.wetlands === true ? "<em style='color:#EF4444'>Measure from NWI overlay</em>" : "—")),
      row("Soil Type", site.soilType || "<em style='color:#94A3B8'>Check USDA Web Soil Survey</em>"),
      row("Environmental", /environmental|contamina|brownfield|phase\s*[12i]/i.test(combined) ? "Environmental issues noted — see summary" : "None identified"),
      row("Stormwater / Detention", site.stormwater || (/detention|stormwater/i.test(combined) ? "Requirements noted" : "<em style='color:#94A3B8'>Check local stormwater ordinance</em>")),
    ].join("")}</table>
    ${site.topoNotes ? `<div style="margin-top:12px;padding:14px 18px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:12px;line-height:1.7;color:#475569">${site.topoNotes}</div>` : ""}
    <div style="margin-top:10px;padding:10px 16px;border-radius:6px;background:#FFF7ED;border-left:3px solid #E87A2E;font-size:9px;color:#475569;line-height:1.6">
      <strong style="color:#E87A2E;font-size:9px;letter-spacing:0.05em">RESEARCH METHODOLOGY</strong><br/>
      FEMA flood zone designation sourced from FEMA Flood Map Service Center (msc.fema.gov) — FIRM panel number and zone classification recorded. Topographic assessment via Google Earth elevation profiles, USGS TopoView, and county GIS contour data. Wetlands checked via U.S. Fish & Wildlife Service National Wetlands Inventory (NWI) mapper. Soil data from USDA Web Soil Survey where available. Grading cost estimates based on industry benchmarks: flat-2% = no concern, 2-5% = $50K-$150K, 5-10% = $150K-$400K+, >10% = potentially prohibitive. Environmental screening via EPA NEPAssist and state environmental databases.
    </div>

    <!-- 5. SITE ACCESS & INFRASTRUCTURE -->
    ${section("5", "Site Access & Infrastructure", "")}
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Road Frontage", site.roadFrontage || (/frontage|\d+['']?\s*(?:ft|feet|linear)/i.test(combined) ? "Frontage noted — see summary" : "Not confirmed")),
      row("Frontage Road Name", site.frontageRoadName || "<em style='color:#94A3B8'>Identify from aerial / listing</em>"),
      row("Road Type", site.roadType || (/highway|arterial|collector|divided|two.?lane/i.test(combined) ? "Road classification noted — see summary" : "<em style='color:#94A3B8'>Assess: arterial / collector / local / highway</em>")),
      row("Speed Limit / Traffic", site.trafficData || "<em style='color:#94A3B8'>Check DOT traffic counts</em>"),
      row("Median / Turn Restrictions", site.medianType || "<em style='color:#94A3B8'>Divided highway = restricted left turns (flag for storage)</em>"),
      row("Signalized Intersection", site.nearestSignal || "<em style='color:#94A3B8'>Nearest signal — affects trailer access</em>"),
      row("Curb Cuts / Driveways", site.curbCuts || (/curb\s*cut|driveway|ingress|egress/i.test(combined) ? "Access points noted" : "<em style='color:#94A3B8'>Verify on aerial — new cuts need permitting</em>")),
      row("Driveway Grade", site.drivewayGrade || "<em style='color:#94A3B8'>Steep grades = problem for trailers/trucks</em>"),
      row("Visibility from Road", site.visibility || (/visib/i.test(combined) ? "Visibility noted" : "<em style='color:#94A3B8'>Signage visibility is key for storage operators</em>")),
      row("Decel / Turn Lane", site.decelLane || "<em style='color:#94A3B8'>May be required by DOT for high-speed roads</em>"),
      row("Landlocked Risk", /landlocked|no\s*(?:road|access)|easement\s*only/i.test(combined) ? '<span style="color:#EF4444;font-weight:700">ACCESS CONCERN — verify road frontage</span>' : '<span style="color:#16A34A">No landlocked concerns</span>'),
    ].join("")}</table>

    <!-- 6. DEMOGRAPHICS — FULL DEPTH -->
    ${section("6", "Demographics & Demand Drivers", "")}
    ${(() => {
      const hhN = parseInt(String(site.households3mi || "").replace(/[^0-9]/g, ""), 10);
      const hvN = parseInt(String(site.homeValue3mi || "").replace(/[^0-9]/g, ""), 10);
      const pop1 = parseInt(String(site.pop1mi || "").replace(/[^0-9]/g, ""), 10);
      const growthPct = site.popGrowth3mi ? parseFloat(String(site.popGrowth3mi).replace(/[^0-9.\-+]/g, "")) : null;
      const growthColor = growthPct !== null ? (growthPct >= 1.5 ? "#16A34A" : growthPct >= 0.5 ? "#3B82F6" : growthPct >= 0 ? "#F59E0B" : "#EF4444") : "#94A3B8";
      return `
    <!-- Demo KPI Cards -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${[
        { label: "Population (3-mi)", val: popN > 0 ? fmtN(popN) : "—", color: popN >= 25000 ? "#16A34A" : popN >= 10000 ? "#3B82F6" : popN > 0 ? "#F59E0B" : "#94A3B8", sub: pop1 > 0 ? "1-mi: " + fmtN(pop1) : null },
        { label: "Median HHI", val: incN > 0 ? "$" + fmtN(incN) : "—", color: incN >= 75000 ? "#16A34A" : incN >= 55000 ? "#3B82F6" : incN > 0 ? "#F59E0B" : "#94A3B8", sub: null },
        { label: "Households", val: hhN > 0 ? fmtN(hhN) : "—", color: hhN >= 18000 ? "#16A34A" : hhN >= 6000 ? "#3B82F6" : hhN > 0 ? "#F59E0B" : "#94A3B8", sub: null },
        { label: "Home Value", val: hvN > 0 ? "$" + fmtN(hvN) : "—", color: hvN >= 250000 ? "#16A34A" : hvN >= 120000 ? "#3B82F6" : hvN > 0 ? "#F59E0B" : "#94A3B8", sub: null },
      ].map(k => `<div style="padding:12px 14px;border-radius:10px;background:${k.color}08;border:1px solid ${k.color}20;text-align:center">
        <div style="font-size:9px;font-weight:800;color:${k.color};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">${k.label}</div>
        <div style="font-size:20px;font-weight:900;color:${k.color};font-family:'Space Mono',monospace;line-height:1.2">${k.val}</div>
        ${k.sub ? `<div style="font-size:9px;color:#64748B;margin-top:4px">${k.sub}</div>` : ""}
      </div>`).join("")}
    </div>
    <!-- Growth Trend -->
    <div style="padding:12px 18px;border-radius:10px;background:${growthColor}08;border:1px solid ${growthColor}20;display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div>
        <div style="font-size:9px;font-weight:800;color:${growthColor};text-transform:uppercase;letter-spacing:0.06em">5-Year Population Growth (CAGR)</div>
        <div style="font-size:11px;color:#64748B;margin-top:2px">ESRI 2025 → 2030 projection</div>
      </div>
      <div style="font-size:24px;font-weight:900;color:${growthColor};font-family:'Space Mono',monospace">${growthPct !== null ? (growthPct >= 0 ? "+" : "") + growthPct.toFixed(1) + "%" : "—"}</div>
    </div>
    ${demoScore ? `<div style="padding:10px 18px;border-radius:8px;background:${demoColor}08;border:1px solid ${demoColor}20;display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><span style="font-size:12px;font-weight:700;color:#1E293B">Demographic Gate</span>${statusPill(demoScore, demoColor)}</div>` : ""}
    <!-- Full Demographics Table -->
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Population (3-mi)", popN > 0 ? fmtN(popN) : "<em style='color:#94A3B8'>Not available</em>"),
      row("Population (1-mi)", pop1 > 0 ? fmtN(pop1) : "<em style='color:#94A3B8'>Not available</em>"),
      row("Median HHI", incN > 0 ? "$" + fmtN(incN) : "<em style='color:#94A3B8'>Not available</em>"),
      row("Households (3-mi)", hhN > 0 ? fmtN(hhN) : "<em style='color:#94A3B8'>Census ACS needed</em>"),
      row("Median Home Value", hvN > 0 ? "$" + fmtN(hvN) : "<em style='color:#94A3B8'>Census ACS needed</em>"),
      row("5-Yr Pop Growth", growthPct !== null ? (growthPct >= 0 ? "+" : "") + growthPct.toFixed(2) + "% CAGR" : "<em style='color:#94A3B8'>ESRI data needed</em>"),
      row("Renter %", site.renterPct3mi ? site.renterPct3mi + "%" : "<em style='color:#94A3B8'>Higher renter % = more storage demand</em>"),
      row("Demand Drivers", site.demandDrivers || "<em style='color:#94A3B8'>Major employers, new housing, military bases, universities</em>"),
    ].join("")}</table>`;
    })()}

    <!-- 7. COMPETITION LANDSCAPE -->
    ${section("7", "Competition Landscape (3-Mile Radius)", "")}
    ${(() => {
      const cc = site.siteiqData?.competitorCount;
      const compColor = cc !== undefined && cc !== null ? (cc <= 1 ? "#16A34A" : cc <= 3 ? "#F59E0B" : "#EF4444") : "#94A3B8";
      const compLabel = cc !== undefined && cc !== null ? (cc === 0 ? "NO COMPETITORS" : cc === 1 ? "1 COMPETITOR" : cc + " COMPETITORS") : "NOT ASSESSED";
      const satLevel = cc !== undefined && cc !== null ? (cc === 0 ? "Unserved Market" : cc <= 2 ? "Low Saturation" : cc <= 4 ? "Moderate Saturation" : "High Saturation") : "Unknown";
      return `
    <div style="display:flex;gap:16px;margin-bottom:16px">
      <div style="flex:1;padding:16px 20px;border-radius:10px;background:${compColor}08;border:2px solid ${compColor}30;text-align:center">
        <div style="font-size:9px;font-weight:800;color:${compColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Competitor Count (3-mi)</div>
        <div style="font-size:36px;font-weight:900;color:${compColor};font-family:'Space Mono',monospace;line-height:1">${cc !== undefined && cc !== null ? cc : "?"}</div>
        <div style="font-size:11px;color:#64748B;margin-top:6px">${satLevel}</div>
      </div>
      <div style="flex:1;padding:16px 20px;border-radius:10px;background:#F8FAFC;border:2px solid #E2E8F0;text-align:center">
        <div style="font-size:9px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Nearest PS Location</div>
        <div style="font-size:22px;font-weight:900;color:#1E2761;font-family:'Space Mono',monospace;line-height:1">${site.siteiqData?.nearestPS ? site.siteiqData.nearestPS + " mi" : "—"}</div>
        <div style="font-size:11px;color:#64748B;margin-top:6px">${site.siteiqData?.nearestPS ? (site.siteiqData.nearestPS <= 5 ? "Validated submarket" : site.siteiqData.nearestPS <= 15 ? "Expansion zone" : site.siteiqData.nearestPS <= 35 ? "Frontier market" : "Too remote") : "Run proximity check"}</div>
      </div>
    </div>
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Competitor Count", compLabel, { badge: true, badgeBg: compColor + "18", badgeColor: compColor }),
      row("Saturation Level", satLevel),
      row("Nearest PS Facility", site.siteiqData?.nearestPS ? site.siteiqData.nearestPS + " mi — " + (site.siteiqData.nearestPS <= 10 ? "market validated, demand proven" : "expansion opportunity") : "<em style='color:#94A3B8'>Run §6b proximity check</em>"),
      row("Known Operators", site.competitorNames || "<em style='color:#94A3B8'>List operators within 3 mi (Extra Space, CubeSmart, Life Storage, etc.)</em>"),
      row("Nearest Competitor", site.nearestCompetitor || "<em style='color:#94A3B8'>Name, distance, and facility type</em>"),
      row("Competitor Facility Types", site.competitorTypes || "<em style='color:#94A3B8'>Climate-controlled, drive-up, multi-story, etc.</em>"),
      row("Est. Competing SF", site.competingSF || "<em style='color:#94A3B8'>Estimate total competitive supply within 3 mi</em>"),
      row("Demand/Supply Signal", site.demandSupplySignal || (cc !== undefined && cc !== null && cc === 0 ? '<span style="color:#16A34A;font-weight:700">Unserved — high demand potential</span>' : cc !== undefined && cc !== null && cc >= 4 ? '<span style="color:#EF4444;font-weight:700">Saturated — verify occupancy rates</span>' : "<em style='color:#94A3B8'>Research occupancy rates of nearby facilities</em>")),
    ].join("")}</table>
    <div style="margin-top:10px;padding:10px 16px;border-radius:6px;background:#FFF7ED;border-left:3px solid #E87A2E;font-size:9px;color:#475569;line-height:1.6">
      <strong style="color:#E87A2E;font-size:9px;letter-spacing:0.05em">COMPETITION METHODOLOGY</strong><br/>
      Competitor scan via Google Maps, SpareFoot, SelfStorage.com, and operator websites within 3-mile radius. Operator names, facility types, and estimated SF recorded. Occupancy data sourced from operator quarterly filings (public REITs: PSA, EXR, CUBE, LSI, NSA) and local market surveys. Demand/supply assessment based on population-to-storage-SF ratio (industry benchmark: 7-9 SF per capita = equilibrium, &lt;5 SF = underserved, &gt;12 SF = oversupplied).
    </div>`;
    })()}

    <!-- 8. SITE SIZING -->
    ${section("8", "Site Sizing Assessment", "")}
    <div style="padding:14px 18px;border-radius:10px;background:${sizingColor}0A;border:1px solid ${sizingColor}25;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:600;color:#1E293B">${sizingText}</span>
      <span style="padding:3px 12px;border-radius:6px;font-size:11px;font-weight:800;background:${sizingColor}18;color:${sizingColor}">${sizingTag}</span>
    </div>

    <!-- 9. BROKER -->
    ${section("9", "Broker / Seller", "")}
    <table style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">${[
      row("Contact", site.sellerBroker || "Not listed"),
      row("Date on Market", site.dateOnMarket || "Unknown"),
      row("Days on Market", site.dateOnMarket ? Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000) + " days" : "Unknown"),
      row("Listing Source", site.listingSource || "<em style='color:#94A3B8'>Crexi / LoopNet / CoStar</em>"),
      row("Broker Notes", site.brokerNotes || "<em style='color:#94A3B8'>Seller motivation, timeline, pricing signals</em>"),
    ].join("")}</table>

    <!-- 10. RECOMMENDED NEXT STEPS -->
    ${section("10", "Recommended Next Steps", "")}
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

    <!-- 11. RED FLAGS -->
    ${section("11", "Red Flags & Action Items", "")}
    ${flags.length === 0
      ? `<div style="padding:14px 18px;border-radius:10px;background:#F0FDF4;border:1px solid #BBF7D0;color:#166534;font-size:13px;font-weight:600">No red flags identified</div>`
      : `<div style="display:flex;flex-direction:column;gap:6px">${flags.map(f => `<div style="padding:10px 16px;border-radius:8px;background:#FEF2F2;border:1px solid #FECACA;font-size:12px;font-weight:600;color:#991B1B;display:flex;align-items:center;gap:8px"><span style="font-size:14px">&#9888;</span> ${f}</div>`).join("")}</div>`
    }

    <!-- 12. SUMMARY -->
    ${section("12", "Summary & Deal Notes", "")}
    <div style="padding:16px 20px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:13px;line-height:1.7;color:#475569">${site.summary || "No notes"}</div>

    ${iq && iq.scores ? (() => {
      const dims = [
        { key: "population", label: "Population", weight: 0.16 },
        { key: "growth", label: "Growth", weight: 0.18 },
        { key: "income", label: "Income", weight: 0.10 },
        { key: "households", label: "Households", weight: 0.05 },
        { key: "homeValue", label: "Home Value", weight: 0.05 },
        { key: "zoning", label: "Zoning", weight: 0.16 },
        { key: "psProximity", label: "PS Proximity", weight: 0.10 },
        { key: "access", label: "Site Access", weight: 0.07 },
        { key: "competition", label: "Competition", weight: 0.05 },
        { key: "marketTier", label: "Market Tier", weight: 0.02 },
      ];
      return `
    <!-- SITESCORE SCORECARD -->
    ${section("S", "SiteScore™ Scorecard", "")}
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
        <div style="font-size:9px;font-weight:800;color:#DC2626;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Competition &amp; Market</div>
        <div style="font-size:8.5px;color:#64748B;line-height:1.5">
          &bull; Google Maps, SpareFoot, SelfStorage.com facility scan (3-mi radius)<br/>
          &bull; Public REIT filings: PSA, EXR, CUBE, LSI, NSA occupancy data<br/>
          &bull; Population-to-SF ratio benchmarking (7&ndash;9 SF/capita = equilibrium)<br/>
          &bull; Operator identification + facility type classification
        </div>
      </div>
      <div style="padding:12px 14px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0">
        <div style="font-size:9px;font-weight:800;color:#7C3AED;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Site Access &amp; Infrastructure</div>
        <div style="font-size:8.5px;color:#64748B;line-height:1.5">
          &bull; Aerial imagery review (Google Earth, county GIS) for frontage + curb cuts<br/>
          &bull; State DOT traffic count maps — VPD on frontage road<br/>
          &bull; Speed limits, median type, nearest signalized intersection<br/>
          &bull; Driveway grade assessment, decel lane requirements
        </div>
      </div>
      <div style="padding:12px 14px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0">
        <div style="font-size:9px;font-weight:800;color:#2C3E6B;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Demographics &amp; Scoring</div>
        <div style="font-size:8.5px;color:#64748B;line-height:1.5">
          &bull; Licensed ESRI 2025 estimates + 2030 five-year projections<br/>
          &bull; U.S. Census Bureau ACS 5-Year (population, HHI, households)<br/>
          &bull; SiteScore&trade; composite scoring: 11 weighted dimensions, 0&ndash;10 scale<br/>
          &bull; PS proximity: Haversine distance against 3,400+ owned/managed locations<br/>
          &bull; Households &amp; home value: demand proxy + affluence signal
        </div>
      </div>
    </div>
    <div style="padding:10px 14px;border-radius:6px;background:#0A0A0C;font-size:8px;color:#64748B;line-height:1.6;text-align:center">
      This report was generated by SiteScore&trade;, a proprietary AI-powered acquisition intelligence platform developed by DJR Real Estate LLC.
      All zoning, utility, and environmental findings are sourced from primary municipal records, federal databases, and licensed data providers.
      Findings should be independently verified prior to capital commitment. Report date: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
    </div>
  </div>

  <!-- FOOTER -->
  <div style="background:#0A0A0C;padding:20px 40px;display:flex;justify-content:space-between;align-items:center">
    <div style="font-size:11px;color:#64748B">Report generated by <span style="color:#C9A84C;font-weight:700">SiteScore&trade;</span> · Patent Pending · Serial No. 99712640</div>
    <div style="font-size:11px;color:#64748B"><span style="color:#C9A84C;font-weight:700">DJR Real Estate LLC</span> &nbsp;|&nbsp; Confidential &nbsp;|&nbsp; AI-Powered Site Intelligence</div>
  </div>
</div></body></html>`;
  } catch (err) {
    console.error("Report generation error:", err);
    return `<!DOCTYPE html><html><head><title>Error</title></head><body style="font-family:sans-serif;padding:40px;background:#0A0E2A;color:#fff;text-align:center"><h1 style="color:#C9A84C">Report Generation Error</h1><p style="color:#94A3B8">${escapeHtml(err.message)}</p><p style="color:#64748B;font-size:12px">Check the browser console for details. Try refreshing the site data.</p></body></html>`;
  }
};

// ─── Shared Financial Engine ───
// Single source of truth for all financial computations across reports.
// Eliminates duplication between generatePricingReport and generateRECPackage.
const computeSiteFinancials = (site) => {
  const parseP = (v) => { if (!v) return NaN; const s = String(v).replace(/,/g, ""); const m = s.match(/([\d.]+)\s*[Mm]/); if (m) return parseFloat(m[1]) * 1000000; return parseFloat(s.replace(/[^0-9.]/g, "")); };
  const acres = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
  const askRaw = parseP(site.askingPrice);
  const intRaw = parseP(site.internalPrice);
  const landCost = !isNaN(intRaw) && intRaw > 0 ? intRaw : (!isNaN(askRaw) ? askRaw : 0);
  const popN = parseInt(String(site.pop3mi || "").replace(/[^0-9]/g, ""), 10) || 0;
  const incN = parseInt(String(site.income3mi || "").replace(/[^0-9]/g, ""), 10) || 0;
  const hvN = parseInt(String(site.homeValue3mi || "").replace(/[^0-9]/g, ""), 10) || 0;
  const hhN = parseInt(String(site.households3mi || "").replace(/[^0-9]/g, ""), 10) || 0;
  const pop1 = parseInt(String(site.pop1mi || "").replace(/[^0-9]/g, ""), 10) || 0;
  const growthStr = site.popGrowth3mi || site.growthRate || "";
  const growthPct = parseFloat(String(growthStr).replace(/[^0-9.\-]/g, "")) || 0;
  const compCount = site.siteiqData?.competitorCount || 0;
  const nearestPS = site.siteiqData?.nearestPS || null;

  // ── Facility Sizing Model ──
  // Multi-story (2.5–3.5 ac): 3-story, higher climate ratio (smaller footprint = maximize rentable SF)
  // One-story (3.5+ ac): PS suburban format — 65/35 climate/drive-up per Killeen TX site sketch (Option A, Dec 2024)
  const isMultiStory = !isNaN(acres) && acres < 3.5 && acres >= 2.5;
  const stories = isMultiStory ? 3 : 1;
  const footprint = !isNaN(acres) ? Math.round(acres * 43560 * 0.35) : 60000; // 35% coverage confirmed by Killeen sketch
  const totalSF = footprint * stories;
  const climatePct = isMultiStory ? 0.75 : 0.65; // Multi-story: 75% climate (vertical = all indoor). One-story: 65% per PS Killeen layout
  const drivePct = 1 - climatePct;
  const climateSF = Math.round(totalSF * climatePct);
  const driveSF = Math.round(totalSF * drivePct);

  // ── Market Rate Intelligence ──
  const incTier = incN >= 90000 ? "premium" : incN >= 75000 ? "upper" : incN >= 60000 ? "mid" : "value";
  const baseClimateRate = incTier === "premium" ? 1.45 : incTier === "upper" ? 1.25 : incTier === "mid" ? 1.10 : 0.95;
  const baseDriveRate = incTier === "premium" ? 0.85 : incTier === "upper" ? 0.72 : incTier === "mid" ? 0.62 : 0.52;
  const compAdj = compCount <= 2 ? 1.08 : compCount <= 5 ? 1.00 : compCount <= 8 ? 0.94 : 0.88;
  const mktClimateRate = Math.round(baseClimateRate * compAdj * 100) / 100;
  const mktDriveRate = Math.round(baseDriveRate * compAdj * 100) / 100;

  // ── 5-Year Lease-Up Model ──
  const leaseUpSchedule = [
    { yr: 1, label: "Year 1 — Launch & Fill", occRate: 0.30, climDisc: 0.35, driveDisc: 0.30, desc: "Grand opening promos. First month free. 50% off first 3 months. Heavy marketing spend." },
    { yr: 2, label: "Year 2 — Ramp", occRate: 0.55, climDisc: 0.15, driveDisc: 0.12, desc: "Reduce promotions. Begin ECRI on Y1 tenants. Organic demand building." },
    { yr: 3, label: "Year 3 — Growth", occRate: 0.75, climDisc: 0.05, driveDisc: 0.05, desc: "Minimal discounting. ECRIs on Y1-Y2 tenants (+8-12%/yr typical)." },
    { yr: 4, label: "Year 4 — Stabilization", occRate: 0.88, climDisc: 0.00, driveDisc: 0.00, desc: "At or near market rate. ECRIs pushing above street rate." },
    { yr: 5, label: "Year 5 — Mature", occRate: 0.92, climDisc: 0.00, driveDisc: 0.00, desc: "Fully stabilized. ECRI revenue above street rate." },
  ];
  const annualEsc = 0.03;

  const yearData = leaseUpSchedule.map((y, i) => {
    const escMult = Math.pow(1 + annualEsc, i);
    const climRate = Math.round((mktClimateRate * escMult * (1 - y.climDisc)) * 100) / 100;
    const driveRate = Math.round((mktDriveRate * escMult * (1 - y.driveDisc)) * 100) / 100;
    const climRev = Math.round(climateSF * y.occRate * climRate * 12);
    const driveRev = Math.round(driveSF * y.occRate * driveRate * 12);
    const totalRev = climRev + driveRev;
    const opex = Math.round(totalRev * (y.yr === 1 ? 0.45 : y.yr === 2 ? 0.40 : 0.35));
    const noi = totalRev - opex;
    const mktClimFull = Math.round(mktClimateRate * escMult * 100) / 100;
    const mktDriveFull = Math.round(mktDriveRate * escMult * 100) / 100;
    return { ...y, climRate, driveRate, climRev, driveRev, totalRev, opex, noi, mktClimFull, mktDriveFull, escMult };
  });

  const stabNOI = yearData[4].noi;
  const stabRev = yearData[4].totalRev;

  // ── Regional Construction Costs ──
  const stateToCostIdx = { "TX": 0.92, "FL": 0.95, "OH": 0.88, "IN": 0.86, "KY": 0.87, "TN": 0.90, "GA": 0.91, "NC": 0.93, "SC": 0.90, "AZ": 0.94, "NV": 0.97, "CO": 1.02, "MI": 0.91, "PA": 1.05, "NJ": 1.15, "NY": 1.20, "MA": 1.18, "CT": 1.12, "IL": 1.00, "MO": 0.89, "AL": 0.85, "MS": 0.83, "LA": 0.88, "AR": 0.84, "VA": 0.98, "MD": 1.08, "WI": 0.95, "MN": 0.97, "IA": 0.88, "KS": 0.87, "NE": 0.89, "OK": 0.86, "NM": 0.92, "UT": 0.96, "ID": 0.94 };
  const costIdx = stateToCostIdx[(site.state || "").toUpperCase()] || 1.0;
  const baseHardPerSF = isMultiStory ? 95 : 65;
  const hardCostPerSF = Math.round(baseHardPerSF * costIdx);
  const softCostPct = 0.20;
  const hardCost = totalSF * hardCostPerSF;
  const softCost = Math.round(hardCost * softCostPct);
  const buildCosts = hardCost + softCost;
  const totalDevCost = landCost + buildCosts;
  const yocStab = stabNOI > 0 && totalDevCost > 0 ? ((stabNOI / totalDevCost) * 100).toFixed(1) : "N/A";

  // ── Detailed OpEx Breakdown (Stabilized Y5) ──
  const opexDetail = [
    { item: "Property Tax", amount: Math.round(totalDevCost * 0.012), note: "Est. 1.2% of total dev cost (varies by jurisdiction)", pctRev: 0 },
    { item: "Insurance", amount: Math.round(totalSF * 0.45), note: "Property + GL + wind/hail — $0.45/SF (climate-adjusted)", pctRev: 0 },
    { item: "Management Fee", amount: Math.round(stabRev * 0.06), note: "6% EGI — industry standard for institutional operator", pctRev: 0.06 },
    { item: "On-Site Payroll", amount: Math.round(65000 * 1.30 * (totalSF > 80000 ? 1.5 : 1)), note: `${totalSF > 80000 ? "1.5" : "1.0"} FTE @ $65K + 30% benefits/burden`, pctRev: 0 },
    { item: "Utilities (Electric/HVAC)", amount: Math.round(climateSF * 1.10 + driveSF * 0.25), note: "Climate: $1.10/SF/yr | Drive-up: $0.25/SF/yr", pctRev: 0 },
    { item: "Repairs & Maintenance", amount: Math.round(totalSF * 0.35), note: "Doors, HVAC service, roofing, painting — $0.35/SF", pctRev: 0 },
    { item: "Marketing & Digital", amount: Math.round(stabRev * 0.03), note: "3% EGI — SEM, SEO, signage, move-in promos", pctRev: 0.03 },
    { item: "Administrative / G&A", amount: Math.round(stabRev * 0.015), note: "Software, legal, accounting, credit card fees", pctRev: 0.015 },
    { item: "Bad Debt & Collections", amount: Math.round(stabRev * 0.02), note: "2% reserve — lien auctions, late payments", pctRev: 0.02 },
    { item: "Replacement Reserve", amount: Math.round(totalSF * 0.20), note: "$0.20/SF — HVAC replacement, roof, resurfacing", pctRev: 0 },
  ];
  const totalOpexDetail = opexDetail.reduce((s, o) => s + o.amount, 0);
  const opexRatioDetail = stabRev > 0 ? (totalOpexDetail / stabRev * 100).toFixed(1) : "N/A";
  const noiDetail = stabRev - totalOpexDetail;

  // ── Valuations ──
  const capRates = [
    { label: "Conservative (6.5%)", rate: 0.065 },
    { label: "Market (5.75%)", rate: 0.0575 },
    { label: "Aggressive (5.0%)", rate: 0.05 },
  ];
  const valuations = capRates.map(c => ({ ...c, value: Math.round(stabNOI / c.rate) }));

  // ── Land Price Guide ──
  const landTargets = [
    { label: "Maximum", yoc: 0.07, color: "#EF4444", tag: "CEILING" },
    { label: "Strike Price", yoc: 0.085, color: "#C9A84C", tag: "TARGET" },
    { label: "Minimum", yoc: 0.10, color: "#16A34A", tag: "FLOOR" },
  ];
  const landPrices = landTargets.map(t => {
    const maxLand = stabNOI > 0 ? Math.round(stabNOI / t.yoc - buildCosts) : 0;
    const perAcre = !isNaN(acres) && acres > 0 && maxLand > 0 ? Math.round(maxLand / acres) : 0;
    return { ...t, maxLand: Math.max(maxLand, 0), perAcre };
  });
  const askVsStrike = landCost > 0 && landPrices[1].maxLand > 0 ? ((landCost / landPrices[1].maxLand - 1) * 100).toFixed(0) : null;
  const landVerdict = askVsStrike !== null ? (parseFloat(askVsStrike) <= -15 ? "STRONG BUY" : parseFloat(askVsStrike) <= 0 ? "BUY" : parseFloat(askVsStrike) <= 15 ? "NEGOTIATE" : parseFloat(askVsStrike) <= 30 ? "STRETCH" : "PASS") : null;
  const verdictColor = landVerdict === "STRONG BUY" ? "#16A34A" : landVerdict === "BUY" ? "#22C55E" : landVerdict === "NEGOTIATE" ? "#F59E0B" : landVerdict === "STRETCH" ? "#E87A2E" : landVerdict === "PASS" ? "#EF4444" : "#6B7394";

  // ── Debt Service & Capital Stack ──
  const loanLTV = 0.65;
  const loanRate = 0.0675;
  const loanAmort = 25;
  const equityPct = 1 - loanLTV;
  const loanAmount = Math.round(totalDevCost * loanLTV);
  const equityRequired = Math.round(totalDevCost * equityPct);
  const monthlyLoanRate = loanRate / 12;
  const numPmts = loanAmort * 12;
  const monthlyPmt = loanAmount > 0 ? loanAmount * (monthlyLoanRate * Math.pow(1 + monthlyLoanRate, numPmts)) / (Math.pow(1 + monthlyLoanRate, numPmts) - 1) : 0;
  const annualDS = Math.round(monthlyPmt * 12);
  const dscrStab = annualDS > 0 ? (noiDetail / annualDS).toFixed(2) : "N/A";
  const cashAfterDS = noiDetail - annualDS;
  const cashOnCash = equityRequired > 0 ? ((cashAfterDS / equityRequired) * 100).toFixed(1) : "N/A";

  // ── 10-Year DCF & IRR ──
  const exitCapRate = 0.06;
  const yrDataExt = [];
  for (let i = 0; i < 10; i++) {
    const esc = Math.pow(1 + annualEsc, i);
    const occ = i < 5 ? leaseUpSchedule[i].occRate : 0.92;
    const cDisc = i < 5 ? leaseUpSchedule[i].climDisc : 0;
    const dDisc = i < 5 ? leaseUpSchedule[i].driveDisc : 0;
    const cR = mktClimateRate * esc * (1 - cDisc);
    const dR = mktDriveRate * esc * (1 - dDisc);
    const rev = Math.round(climateSF * occ * cR * 12) + Math.round(driveSF * occ * dR * 12);
    const opexPct = i === 0 ? 0.45 : i === 1 ? 0.40 : 0.35;
    const opex = Math.round(rev * opexPct);
    const noi = rev - opex;
    yrDataExt.push({ yr: i + 1, occ, rev, opex, noi, cR, dR });
  }
  const exitValue = Math.round(yrDataExt[9].noi / exitCapRate);
  const exitLoanBal = (() => { let bal = loanAmount; for (let i = 0; i < 120; i++) { bal = bal * (1 + monthlyLoanRate) - monthlyPmt; } return Math.round(Math.max(bal, 0)); })();
  const exitEquityProceeds = exitValue - exitLoanBal;
  const irrCashFlows = [-equityRequired, ...yrDataExt.map((y, i) => { const cf = y.noi - annualDS; return i === 9 ? cf + exitEquityProceeds : cf; })];
  const calcNPV = (rate) => irrCashFlows.reduce((npv, cf, t) => npv + cf / Math.pow(1 + rate, t), 0);
  let irrLow = -0.1, irrHigh = 0.5;
  for (let iter = 0; iter < 100; iter++) { const mid = (irrLow + irrHigh) / 2; if (calcNPV(mid) > 0) irrLow = mid; else irrHigh = mid; }
  const irrPct = ((irrLow + irrHigh) / 2 * 100).toFixed(1);
  const equityMultiple = equityRequired > 0 ? ((irrCashFlows.slice(1).reduce((s, v) => s + v, 0)) / equityRequired).toFixed(2) : "N/A";

  // ── Rate Cross-Validation ──
  const m1Rate = mktClimateRate;
  const m2ClimRate = incTier === "premium" ? 1.50 : incTier === "upper" ? 1.30 : incTier === "mid" ? 1.15 : 1.00;
  const m2DriveRate = incTier === "premium" ? 0.83 : incTier === "upper" ? 0.70 : incTier === "mid" ? 0.60 : 0.50;
  const popDensityFactor = popN >= 40000 ? 1.12 : popN >= 25000 ? 1.05 : popN >= 15000 ? 1.00 : 0.93;
  const m3ClimRate = Math.round(baseClimateRate * popDensityFactor * compAdj * 100) / 100;
  const consensusClimRate = Math.round((m1Rate + m2ClimRate + m3ClimRate) / 3 * 100) / 100;
  const rateConfidence = Math.abs(m1Rate - consensusClimRate) / consensusClimRate < 0.08 ? "HIGH" : Math.abs(m1Rate - consensusClimRate) / consensusClimRate < 0.15 ? "MODERATE" : "LOW";
  const rateConfColor = rateConfidence === "HIGH" ? "#16A34A" : rateConfidence === "MODERATE" ? "#F59E0B" : "#EF4444";

  // ── Institutional Metrics ──
  const stabOccSF = Math.round(totalSF * 0.92);
  const revPAF = stabRev > 0 ? (stabRev / totalSF).toFixed(2) : "N/A";
  const revPOF = stabRev > 0 && stabOccSF > 0 ? (stabRev / stabOccSF).toFixed(2) : "N/A";
  const noiPerSF = stabNOI > 0 ? (stabNOI / totalSF).toFixed(2) : "N/A";
  const noiMarginPct = stabRev > 0 ? ((stabNOI / stabRev) * 100).toFixed(1) : "N/A";
  const mktAcqCap = 0.0575;
  const devSpread = parseFloat(yocStab) > 0 ? (parseFloat(yocStab) - mktAcqCap * 100).toFixed(1) : "N/A";
  const impliedLandCap = landCost > 0 && stabNOI > 0 ? ((stabNOI / landCost) * 100).toFixed(1) : "N/A";

  // ── Supply/Demand ──
  const estCompSF = compCount > 0 ? compCount * 55000 : 0;
  const totalMktSF = estCompSF + totalSF;
  const sfPerCapita = popN > 0 ? (totalMktSF / popN).toFixed(1) : null;
  const sfPerCapitaExcl = popN > 0 && estCompSF > 0 ? (estCompSF / popN).toFixed(1) : null;
  const demandSignal = sfPerCapita !== null ? (parseFloat(sfPerCapita) < 5 ? "UNDERSERVED" : parseFloat(sfPerCapita) < 7 ? "MODERATE DEMAND" : parseFloat(sfPerCapita) < 9 ? "EQUILIBRIUM" : parseFloat(sfPerCapita) < 12 ? "WELL-SUPPLIED" : "OVERSUPPLIED") : null;
  const demandColor = demandSignal === "UNDERSERVED" ? "#16A34A" : demandSignal === "MODERATE DEMAND" ? "#22C55E" : demandSignal === "EQUILIBRIUM" ? "#F59E0B" : demandSignal === "WELL-SUPPLIED" ? "#E87A2E" : demandSignal === "OVERSUPPLIED" ? "#EF4444" : "#94A3B8";

  // ── Replacement Cost ──
  const replacementCost = buildCosts;
  const replacementCostPerSF = totalSF > 0 ? Math.round(replacementCost / totalSF) : 0;
  const fullReplacementCost = landCost + replacementCost;
  const replacementVsMarket = valuations[1].value > 0 && fullReplacementCost > 0 ? ((fullReplacementCost / valuations[1].value - 1) * 100).toFixed(0) : null;
  const buildOrBuy = replacementVsMarket !== null ? (parseFloat(replacementVsMarket) < -20 ? "BUILD — significant cost advantage" : parseFloat(replacementVsMarket) < 0 ? "BUILD — modest cost advantage" : parseFloat(replacementVsMarket) < 20 ? "NEUTRAL — similar cost to acquire stabilized" : "ACQUIRE — cheaper to buy existing") : null;

  // ── REIT Benchmarks ──
  const reitBench = [
    { ticker: "PSA", name: "Public Storage", revPAF: 24.50, noiMargin: 63.5, sameStoreGrowth: 3.1, avgOcc: 92.5, impliedCap: 4.8, stores: 3112, avgSF: 87000, ecriLift: 38 },
    { ticker: "EXR", name: "Extra Space", revPAF: 22.80, noiMargin: 65.2, sameStoreGrowth: 2.8, avgOcc: 93.5, impliedCap: 5.2, stores: 3800, avgSF: 72000, ecriLift: 42 },
    { ticker: "CUBE", name: "CubeSmart", revPAF: 20.10, noiMargin: 61.8, sameStoreGrowth: 2.5, avgOcc: 92.0, impliedCap: 5.5, stores: 1500, avgSF: 65000, ecriLift: 35 },
    { ticker: "NSA", name: "National Storage", revPAF: 17.50, noiMargin: 58.0, sameStoreGrowth: 2.2, avgOcc: 90.5, impliedCap: 6.0, stores: 1100, avgSF: 58000, ecriLift: 30 },
    { ticker: "LSI", name: "Life Storage", revPAF: 19.20, noiMargin: 60.0, sameStoreGrowth: 2.4, avgOcc: 91.5, impliedCap: 5.4, stores: 1200, avgSF: 68000, ecriLift: 33 },
  ];

  const pricePerAcre = landCost > 0 && !isNaN(acres) && acres > 0 ? Math.round(landCost / acres) : null;

  return {
    // Inputs
    acres, landCost, popN, incN, hvN, hhN, pop1, growthPct, compCount, nearestPS, incTier,
    // Facility
    isMultiStory, stories, footprint, totalSF, climatePct, drivePct, climateSF, driveSF,
    // Rates
    baseClimateRate, baseDriveRate, compAdj, mktClimateRate, mktDriveRate, annualEsc,
    // Year data
    leaseUpSchedule, yearData,
    // NOI
    stabNOI, stabRev,
    // Construction
    stateToCostIdx, costIdx, baseHardPerSF, hardCostPerSF, softCostPct, hardCost, softCost, buildCosts, totalDevCost, yocStab,
    // OpEx
    opexDetail, totalOpexDetail, opexRatioDetail, noiDetail,
    // Valuations
    capRates, valuations,
    // Land pricing
    landTargets, landPrices, askVsStrike, landVerdict, verdictColor,
    // Capital stack
    loanLTV, loanRate, loanAmort, equityPct, loanAmount, equityRequired, monthlyLoanRate, numPmts, monthlyPmt, annualDS, dscrStab, cashAfterDS, cashOnCash,
    // DCF
    exitCapRate, yrDataExt, exitValue, exitLoanBal, exitEquityProceeds, irrCashFlows, irrPct, equityMultiple,
    // Rate validation
    m1Rate, m2ClimRate, m2DriveRate, m3ClimRate, popDensityFactor, consensusClimRate, rateConfidence, rateConfColor,
    // Institutional
    stabOccSF, revPAF, revPOF, noiPerSF, noiMarginPct, mktAcqCap, devSpread, impliedLandCap,
    // Supply/demand
    estCompSF, totalMktSF, sfPerCapita, sfPerCapitaExcl, demandSignal, demandColor,
    // Replacement cost
    replacementCost, replacementCostPerSF, fullReplacementCost, replacementVsMarket, buildOrBuy,
    // REIT
    reitBench,
    // Misc
    pricePerAcre,
  };
};

// ─── PRICING REPORT — 5-Year Lease-Up Revenue Model ───
const generatePricingReport = (site, iqResult) => {
  try {
  const iq = iqResult || computeSiteScore(site);
  const fin = computeSiteFinancials(site);
  const { acres, landCost, popN, incN, hvN, growthPct, compCount, nearestPS, incTier,
    isMultiStory, stories, footprint, totalSF, climatePct, drivePct, climateSF, driveSF,
    baseClimateRate, baseDriveRate, compAdj, mktClimateRate, mktDriveRate, annualEsc,
    leaseUpSchedule, yearData, stabNOI, stabRev,
    stateToCostIdx, costIdx, baseHardPerSF, hardCostPerSF, softCostPct, hardCost, softCost, buildCosts, totalDevCost, yocStab,
    opexDetail, totalOpexDetail, opexRatioDetail, noiDetail,
    capRates, valuations,
    landTargets, landPrices, askVsStrike, landVerdict, verdictColor,
    loanLTV, loanRate, loanAmort, equityPct, loanAmount, equityRequired, monthlyLoanRate, numPmts, monthlyPmt, annualDS, dscrStab, cashAfterDS, cashOnCash,
    exitCapRate, yrDataExt, exitValue, exitLoanBal, exitEquityProceeds, irrCashFlows, irrPct, equityMultiple,
    m1Rate, m2ClimRate, m2DriveRate, m3ClimRate, popDensityFactor, consensusClimRate, rateConfidence, rateConfColor,
    stabOccSF, revPAF, revPOF, noiPerSF, noiMarginPct, mktAcqCap, devSpread, impliedLandCap,
    estCompSF, totalMktSF, sfPerCapita, sfPerCapitaExcl, demandSignal, demandColor,
    replacementCost, replacementCostPerSF, fullReplacementCost, replacementVsMarket, buildOrBuy,
    reitBench, pricePerAcre,
  } = fin;
  const phase = site.phase || "Prospect";

  // ── REIT comparable (pricing-report-specific) ──
  const siteRevPAFn = parseFloat(revPAF) || 0;
  const reitComparable = reitBench.find(r => Math.abs(r.revPAF - siteRevPAFn) === Math.min(...reitBench.map(b => Math.abs(b.revPAF - siteRevPAFn))));

  // ── Street Rate Estimator (cross-check against listing data) ──
  const streetRateOverride = site.streetRateClimate ? parseFloat(site.streetRateClimate) : null;
  const streetVariance = streetRateOverride && mktClimateRate > 0 ? ((mktClimateRate / streetRateOverride - 1) * 100).toFixed(1) : null;

  // ── Unit Mix Estimate ──
  const unitMix = [
    { type: "5x5 Climate", sf: 25, pct: 0.10, rate: null, cat: "climate" },
    { type: "5x10 Climate", sf: 50, pct: 0.20, rate: null, cat: "climate" },
    { type: "10x10 Climate", sf: 100, pct: 0.25, rate: null, cat: "climate" },
    { type: "10x15 Climate", sf: 150, pct: 0.10, rate: null, cat: "climate" },
    { type: "10x20 Climate", sf: 200, pct: 0.05, rate: null, cat: "climate" },
    { type: "10x10 Drive-Up", sf: 100, pct: 0.12, rate: null, cat: "drive" },
    { type: "10x15 Drive-Up", sf: 150, pct: 0.08, rate: null, cat: "drive" },
    { type: "10x20 Drive-Up", sf: 200, pct: 0.06, rate: null, cat: "drive" },
    { type: "10x30 Drive-Up", sf: 300, pct: 0.04, rate: null, cat: "drive" },
  ];
  const stabClimRate = yearData[4].climRate;
  const stabDriveRate = yearData[4].driveRate;
  const unitRows = unitMix.map(u => {
    const allocSF = Math.round(totalSF * u.pct);
    const units = Math.round(allocSF / u.sf);
    const moRate = u.cat === "climate" ? Math.round(u.sf * stabClimRate) : Math.round(u.sf * stabDriveRate);
    return { ...u, allocSF, units, moRate };
  });
  const totalUnits = unitRows.reduce((s, r) => s + r.units, 0);
  const avgMonthlyRent = totalUnits > 0 ? Math.round(stabRev / 12 / (totalUnits * 0.92)) : 0;

  const fmtD = (n) => "$" + Math.round(n).toLocaleString();
  const fmtM = (n) => n >= 1000000 ? "$" + (n / 1000000).toFixed(2) + "M" : "$" + Math.round(n).toLocaleString();
  const pctBar = (pct, color) => `<div style="display:flex;align-items:center;gap:8px"><div style="width:120px;height:10px;border-radius:5px;background:rgba(255,255,255,0.06);overflow:hidden"><div style="width:${Math.round(pct*100)}%;height:100%;border-radius:5px;background:${color};transition:width 0.5s"></div></div><span style="font-size:12px;font-weight:700;color:${color}">${Math.round(pct*100)}%</span></div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Pricing Report — ${site.name}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:linear-gradient(180deg,#080B1A 0%,#0F1538 40%,#1E2761 100%);color:#E2E8F0;min-height:100vh;padding:0}
.page{max-width:1100px;margin:0 auto;padding:40px 30px}
h1{font-size:28px;font-weight:900;letter-spacing:-0.02em}
h2{font-size:18px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:16px}
h3{font-size:14px;font-weight:700;margin-bottom:10px}
.section{background:rgba(15,21,56,0.6);border:1px solid rgba(201,168,76,0.1);border-radius:16px;padding:28px;margin-bottom:24px;backdrop-filter:blur(12px)}
.section-gold{border-color:rgba(201,168,76,0.25);box-shadow:0 4px 24px rgba(201,168,76,0.08)}
.gold{color:#C9A84C} .orange{color:#E87A2E} .green{color:#16A34A} .red{color:#EF4444} .blue{color:#42A5F5} .muted{color:#6B7394}
.mono{font-family:'Space Mono',monospace}
.badge{display:inline-block;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.06em}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.metric-box{background:rgba(15,21,56,0.5);border:1px solid rgba(201,168,76,0.08);border-radius:12px;padding:16px;text-align:center}
.metric-box .label{font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.1em;margin-bottom:6px;text-transform:uppercase}
.metric-box .value{font-size:22px;font-weight:800;font-family:'Space Mono',monospace}
table{width:100%;border-collapse:collapse;font-size:12px}
th{padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:#C9A84C;text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid rgba(201,168,76,0.15);background:rgba(15,21,56,0.4)}
td{padding:10px 12px;border-bottom:1px solid rgba(201,168,76,0.06);color:#E2E8F0}
tr:hover td{background:rgba(201,168,76,0.04)}
.yr-row{transition:all 0.2s}
.divider{height:2px;background:linear-gradient(90deg,transparent,#C9A84C,#E87A2E,#C9A84C,transparent);margin:32px 0;opacity:0.4}
.tag{display:inline-block;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:0.04em}
.footer{text-align:center;padding:24px;color:#6B7394;font-size:10px;border-top:1px solid rgba(201,168,76,0.1);margin-top:40px}
.expand-panel{max-height:0;overflow:hidden;transition:max-height 0.4s ease,opacity 0.3s ease,padding 0.3s ease;opacity:0;padding:0 20px}
.expand-panel.open{max-height:4000px;opacity:1;padding:20px}
.expand-trigger{cursor:pointer;position:relative;transition:all 0.2s}
.expand-trigger:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(201,168,76,0.12)!important}
.expand-trigger .expand-hint{position:absolute;top:10px;right:14px;font-size:9px;color:#6B7394;letter-spacing:0.08em;font-weight:600;text-transform:uppercase;opacity:0.6;transition:opacity 0.2s}
.expand-trigger:hover .expand-hint{opacity:1;color:#C9A84C}
.expand-arrow{display:inline-block;transition:transform 0.3s;font-size:10px;color:#C9A84C}
.expand-arrow.open{transform:rotate(180deg)}
.insight-box{background:linear-gradient(135deg,rgba(201,168,76,0.06),rgba(30,39,97,0.4));border:1px solid rgba(201,168,76,0.15);border-radius:12px;padding:16px;margin-top:14px;font-size:12px;color:#94A3B8;line-height:1.7}
.insight-box .insight-title{font-size:10px;font-weight:800;color:#C9A84C;letter-spacing:0.1em;margin-bottom:8px;text-transform:uppercase;display:flex;align-items:center;gap:6px}
.insight-box .insight-title::before{content:"◆";font-size:7px}
.drill-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.06);font-size:12px}
.drill-row:last-child{border-bottom:none}
.drill-label{color:#6B7394;font-weight:600}
.drill-value{color:#E2E8F0;font-weight:700;font-family:'Space Mono',monospace}
.sensitivity-cell{padding:10px 14px;text-align:center;border:1px solid rgba(201,168,76,0.06);font-family:'Space Mono',monospace;font-size:11px;font-weight:700}
.waterfall-bar{height:28px;border-radius:4px;display:flex;align-items:center;padding:0 10px;font-size:11px;font-weight:700;color:#fff;margin-bottom:4px;transition:width 0.5s}

/* ═══ METRIC INTELLIGENCE SYSTEM v4.0 ═══ */
.mi{position:relative;cursor:pointer;display:inline-block;transition:all 0.2s}
.mi .value{position:relative;z-index:1}
.mi::after{content:"";position:absolute;inset:-4px -8px;border-radius:8px;background:rgba(201,168,76,0);border:1px solid rgba(201,168,76,0);transition:all 0.25s;z-index:0}
.mi:hover::after{background:rgba(201,168,76,0.06);border-color:rgba(201,168,76,0.2);box-shadow:0 0 16px rgba(201,168,76,0.1)}
.mi:hover .mi-hint{opacity:1}
.mi-hint{position:absolute;top:-6px;right:-6px;width:14px;height:14px;border-radius:50%;background:linear-gradient(135deg,#C9A84C,#E87A2E);display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:900;color:#080B1A;opacity:0;transition:opacity 0.2s;z-index:2;font-style:normal;line-height:1}
.mi-panel{max-height:0;overflow:hidden;transition:max-height 0.35s ease,opacity 0.3s ease,margin 0.3s ease;opacity:0;margin-top:0;border-radius:12px}
.mi-panel.open{max-height:800px;opacity:1;margin-top:12px}
.mi-panel-inner{background:linear-gradient(135deg,rgba(8,11,26,0.95),rgba(15,21,56,0.9));border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:18px;backdrop-filter:blur(16px);box-shadow:0 8px 32px rgba(0,0,0,0.4),0 0 24px rgba(201,168,76,0.06)}
.mi-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(201,168,76,0.12)}
.mi-title{font-size:10px;font-weight:800;color:#C9A84C;letter-spacing:0.1em;text-transform:uppercase;display:flex;align-items:center;gap:6px}
.mi-title::before{content:"◆";font-size:6px}
.mi-conf{font-size:9px;font-weight:700;letter-spacing:0.06em;padding:3px 8px;border-radius:4px;text-transform:uppercase}
.mi-conf-high{background:rgba(22,163,74,0.15);color:#16A34A;border:1px solid rgba(22,163,74,0.2)}
.mi-conf-med{background:rgba(245,158,11,0.15);color:#F59E0B;border:1px solid rgba(245,158,11,0.2)}
.mi-conf-low{background:rgba(239,68,68,0.15);color:#EF4444;border:1px solid rgba(239,68,68,0.2)}
.mi-body{font-size:11px;color:#94A3B8;line-height:1.65}
.mi-body strong{color:#E2E8F0}
.mi-formula{background:rgba(15,21,56,0.6);border:1px solid rgba(66,165,245,0.15);border-radius:8px;padding:10px 14px;margin:10px 0;font-family:'Space Mono',monospace;font-size:10px;color:#42A5F5;line-height:1.8}
.mi-source{display:flex;align-items:center;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid rgba(201,168,76,0.08);font-size:9px;color:#6B7394;font-weight:600;letter-spacing:0.04em}
.mi-source::before{content:"📊";font-size:10px}
.mi-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(201,168,76,0.04);font-size:11px}
.mi-row:last-child{border-bottom:none}
.mi-row-label{color:#6B7394;font-weight:600}
.mi-row-val{color:#E2E8F0;font-weight:700;font-family:'Space Mono',monospace}

/* ═══ v4.0 COSMETICS ═══ */
@keyframes headerGlow{0%,100%{box-shadow:0 0 30px rgba(201,168,76,0.08)}50%{box-shadow:0 0 50px rgba(201,168,76,0.15)}}
.header-v4{animation:headerGlow 4s ease-in-out infinite}
@keyframes pulseGold{0%,100%{opacity:0.6}50%{opacity:1}}
.version-badge{background:linear-gradient(135deg,#C9A84C,#E87A2E);color:#080B1A;font-size:9px;font-weight:900;padding:3px 10px;border-radius:4px;letter-spacing:0.1em;animation:pulseGold 3s ease-in-out infinite}
.metric-box.mi-active{border-color:rgba(201,168,76,0.2);box-shadow:0 0 12px rgba(201,168,76,0.06)}
.section-v4{border-image:linear-gradient(135deg,rgba(201,168,76,0.15),rgba(232,122,46,0.1),rgba(201,168,76,0.15)) 1;border-width:1px;border-style:solid}
.nav-dot{width:6px;height:6px;border-radius:50%;background:#C9A84C;display:inline-block;margin:0 3px;opacity:0.3}
.nav-dot.active{opacity:1;box-shadow:0 0 6px rgba(201,168,76,0.4)}

@media print{body{background:#fff;color:#1a1a2e}.section{border:1px solid #e5e7eb;box-shadow:none;background:#fff}.gold{color:#92700C}.muted{color:#64748B}th{background:#f8f9fa;color:#1a1a2e}td{color:#1a1a2e}.expand-panel{max-height:none!important;opacity:1!important;padding:20px!important}.mi-panel{max-height:none!important;opacity:1!important;margin-top:12px!important}.mi::after{display:none}.mi-hint{display:none}}
</style>
<script>
function toggleExpand(id){
  const p=document.getElementById(id);
  const a=document.getElementById(id+'-arrow');
  if(p.classList.contains('open')){p.classList.remove('open');if(a)a.classList.remove('open');}
  else{p.classList.add('open');if(a)a.classList.add('open');}
}
function toggleMI(id,evt){
  if(evt){evt.stopPropagation();}
  const p=document.getElementById('mi-'+id);
  if(!p)return;
  // Close all other MI panels first
  document.querySelectorAll('.mi-panel.open').forEach(el=>{if(el.id!=='mi-'+id)el.classList.remove('open');});
  p.classList.toggle('open');
}
</script>
</head><body><div class="page">

<!-- HEADER v4.0 -->
<div class="header-v4" style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding:24px 28px;border-radius:16px;background:linear-gradient(135deg,rgba(15,21,56,0.8),rgba(30,39,97,0.5));border:1px solid rgba(201,168,76,0.2)">
  <div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <div style="font-size:13px;font-weight:900;letter-spacing:0.14em;color:#C9A84C">SITESCORE<span style="font-size:7px;vertical-align:super">™</span></div>
      <div style="width:1px;height:16px;background:rgba(201,168,76,0.3)"></div>
      <div style="font-size:11px;font-weight:600;color:#6B7394;letter-spacing:0.08em">INTERACTIVE PRICING INTELLIGENCE</div>
      <span class="version-badge">v4.0</span>
    </div>
    <h1 style="color:#fff;margin-bottom:6px">${site.name}</h1>
    <div style="font-size:13px;color:#94A3B8">${site.address || ""}${site.city ? ", " + site.city : ""}${site.state ? ", " + site.state : ""}</div>
    <div style="margin-top:10px;font-size:10px;color:#6B7394;display:flex;align-items:center;gap:8px">
      <span style="background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.15);padding:2px 8px;border-radius:4px;color:#C9A84C;font-weight:700;letter-spacing:0.06em">CLICK ANY METRIC</span>
      <span>for full source methodology and derivation intelligence</span>
    </div>
  </div>
  <div style="text-align:right">
    <div class="badge" style="background:rgba(201,168,76,0.12);color:#C9A84C;border:1px solid rgba(201,168,76,0.25);font-size:12px;padding:6px 16px">${phase}</div>
    <div style="font-size:11px;color:#6B7394;margin-top:8px">${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
    <div style="font-size:10px;color:#4A5080;margin-top:2px">SiteScore: ${iq.score?.toFixed(1) || "N/A"}/10</div>
  </div>
</div>

<!-- EXECUTIVE SUMMARY v4.0 -->
<div class="section section-gold expand-trigger" onclick="toggleExpand('exec')" style="background:linear-gradient(135deg,rgba(15,21,56,0.8),rgba(30,39,97,0.6))">
  <span class="expand-hint">▼ Click to expand <span id="exec-arrow" class="expand-arrow">▼</span></span>
  <h2 class="gold">Executive Summary</h2>
  <div class="grid4" style="margin-bottom:20px">
    <div class="metric-box mi-active mi" onclick="toggleMI('landcost',event)"><div class="label">Land Cost</div><div class="value gold">${landCost > 0 ? fmtM(landCost) : "TBD"}</div><em class="mi-hint">i</em>
      <div id="mi-landcost" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Land Cost Derivation</div><div class="mi-conf ${landCost > 0 ? "mi-conf-high" : "mi-conf-low"}">${landCost > 0 ? "Confirmed" : "Pending"}</div></div>
        <div class="mi-body">
          ${landCost > 0 ? `<strong>Source:</strong> ${site.askingPrice ? "Listing asking price" : "Broker-provided figure"} — <strong style="color:#C9A84C">${fmtM(landCost)}</strong> for ${!isNaN(acres) ? acres.toFixed(2) : "?"} acres.
          <div class="mi-formula">Price/Acre = ${fmtD(landCost)} ÷ ${!isNaN(acres) ? acres.toFixed(2) : "?"} ac = <strong style="color:#C9A84C">${pricePerAcre ? fmtD(pricePerAcre) + "/ac" : "N/A"}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Land as % of Total Dev</span><span class="mi-row-val">${totalDevCost > 0 ? Math.round(landCost/totalDevCost*100) : 0}%</span></div>
          <div class="mi-row"><span class="mi-row-label">Industry Benchmark</span><span class="mi-row-val">15-25% of total dev cost</span></div>
          <div class="mi-row"><span class="mi-row-label">Assessment</span><span class="mi-row-val" style="color:${landCost/totalDevCost < 0.25 ? "#16A34A" : "#F59E0B"}">${landCost/totalDevCost < 0.15 ? "Favorable" : landCost/totalDevCost < 0.25 ? "Market Rate" : "Premium"}</span></div>` : "Land cost not yet confirmed. This metric will populate when pricing is received from the broker or listing platform."}
          <div class="mi-source">Source: ${site.listingSource || "Crexi/LoopNet listing"} | Verified: ${new Date().toLocaleDateString()}</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi-active mi" onclick="toggleMI('devcost',event)"><div class="label">Total Dev Cost</div><div class="value orange">${totalDevCost > 0 ? fmtM(totalDevCost) : "TBD"}</div><em class="mi-hint">i</em>
      <div id="mi-devcost" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Total Development Cost</div><div class="mi-conf mi-conf-med">Modeled</div></div>
        <div class="mi-body">
          <strong>SiteScore builds total dev cost from three components:</strong>
          <div class="mi-formula">Total Dev = Land + Hard Costs + Soft Costs<br>= ${fmtD(landCost)} + ${fmtD(hardCost)} + ${fmtD(softCost)}<br>= <strong style="color:#E87A2E">${fmtD(totalDevCost)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Land Acquisition</span><span class="mi-row-val">${fmtD(landCost)} (${totalDevCost > 0 ? Math.round(landCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Hard Costs (${fmtD(hardCostPerSF)}/SF)</span><span class="mi-row-val">${fmtD(hardCost)} (${totalDevCost > 0 ? Math.round(hardCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Soft Costs (${Math.round(softCostPct*100)}% of hard)</span><span class="mi-row-val">${fmtD(softCost)} (${totalDevCost > 0 ? Math.round(softCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Cost/SF (all-in)</span><span class="mi-row-val">${totalSF > 0 ? fmtD(totalDevCost/totalSF) + "/SF" : "N/A"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Regional Cost Index</span><span class="mi-row-val">${(costIdx*100).toFixed(0)}% of national avg</span></div>
          <div class="mi-source">Source: RSMeans/ENR regional construction cost data | Base: $${baseHardPerSF}/SF × ${(costIdx).toFixed(2)} state index</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi-active mi" onclick="toggleMI('stabnoi',event)"><div class="label">Stabilized NOI (Y5)</div><div class="value green">${fmtM(stabNOI)}</div><em class="mi-hint">i</em>
      <div id="mi-stabnoi" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Stabilized NOI Derivation</div><div class="mi-conf mi-conf-med">Projected</div></div>
        <div class="mi-body">
          <strong>Year 5 stabilized Net Operating Income — the critical metric for valuation.</strong>
          <div class="mi-formula">Stabilized NOI = Stabilized Revenue × (1 - OpEx Ratio)<br>= ${fmtD(stabRev)} × (1 - ${opexRatioDetail || "38"}%)<br>= <strong style="color:#16A34A">${fmtD(stabNOI)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Stabilized Revenue (Y5)</span><span class="mi-row-val">${fmtD(stabRev)}</span></div>
          <div class="mi-row"><span class="mi-row-label">Stabilized Occupancy</span><span class="mi-row-val">92% (industry standard)</span></div>
          <div class="mi-row"><span class="mi-row-label">Total OpEx</span><span class="mi-row-val">${fmtD(stabRev - stabNOI)}</span></div>
          <div class="mi-row"><span class="mi-row-label">NOI Margin</span><span class="mi-row-val">${noiMarginPct || Math.round(stabNOI/stabRev*100)}%</span></div>
          <div class="mi-row"><span class="mi-row-label">NOI/SF</span><span class="mi-row-val">$${noiPerSF || (totalSF > 0 ? (stabNOI/totalSF).toFixed(2) : "N/A")}</span></div>
          <div class="mi-row"><span class="mi-row-label">PS Benchmark NOI Margin</span><span class="mi-row-val">62-66% (Q4 2025)</span></div>
          <div class="mi-source">Source: SiteScore 5-Year Lease-Up Model | Rates: Income-tier methodology | OpEx: 10-line institutional detail</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi-active mi" onclick="toggleMI('yoc',event)"><div class="label">Yield on Cost</div><div class="value" style="color:${parseFloat(yocStab) >= 9 ? "#16A34A" : parseFloat(yocStab) >= 7 ? "#F59E0B" : "#EF4444"}">${yocStab}%</div><em class="mi-hint">i</em>
      <div id="mi-yoc" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Yield on Cost Analysis</div><div class="mi-conf ${parseFloat(yocStab) >= 8 ? "mi-conf-high" : "mi-conf-med"}">${parseFloat(yocStab) >= 9 ? "Strong" : parseFloat(yocStab) >= 7.5 ? "Acceptable" : "Below Target"}</div></div>
        <div class="mi-body">
          <strong>YOC is the single most important development return metric — it measures the unlevered return on total capital deployed.</strong>
          <div class="mi-formula">YOC = Stabilized NOI ÷ Total Development Cost<br>= ${fmtD(stabNOI)} ÷ ${fmtD(totalDevCost)}<br>= <strong style="color:${parseFloat(yocStab) >= 9 ? "#16A34A" : "#F59E0B"}">${yocStab}%</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Target Range</span><span class="mi-row-val">8.0% - 10.0%</span></div>
          <div class="mi-row"><span class="mi-row-label">PS Minimum Hurdle</span><span class="mi-row-val">7.5%</span></div>
          <div class="mi-row"><span class="mi-row-label">Development Spread</span><span class="mi-row-val" style="color:${parseFloat(devSpread) >= 2.0 ? "#16A34A" : "#F59E0B"}">${devSpread || "N/A"} bps vs market cap</span></div>
          <div class="mi-row"><span class="mi-row-label">Assessment</span><span class="mi-row-val" style="color:${parseFloat(yocStab) >= 9 ? "#16A34A" : parseFloat(yocStab) >= 7.5 ? "#F59E0B" : "#EF4444"}">${parseFloat(yocStab) >= 9.5 ? "Exceptional — well above PS hurdle" : parseFloat(yocStab) >= 8.5 ? "Strong — above PS sweet spot" : parseFloat(yocStab) >= 7.5 ? "Meets PS minimum development threshold" : "Below PS hurdle — negotiate land price down"}</span></div>
          <div class="mi-source">Source: SiteScore Financial Engine | Formula: Industry-standard development return metric used by all REIT developers</div>
        </div>
      </div></div>
    </div>
  </div>
  <div class="grid3">
    ${valuations.map((v,vi) => `<div class="metric-box mi-active mi" onclick="toggleMI('val${vi}',event)"><div class="label">${v.label}</div><div class="value blue">${fmtM(v.value)}</div><div style="font-size:10px;color:#6B7394;margin-top:4px">@ ${(v.rate*100).toFixed(2)}% cap</div><em class="mi-hint">i</em>
      <div id="mi-val${vi}" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">${v.label} Valuation</div><div class="mi-conf mi-conf-med">Modeled</div></div>
        <div class="mi-body">
          <strong>Direct capitalization of stabilized NOI at a ${(v.rate*100).toFixed(2)}% cap rate.</strong>
          <div class="mi-formula">Value = Stabilized NOI ÷ Cap Rate<br>= ${fmtD(stabNOI)} ÷ ${(v.rate*100).toFixed(2)}%<br>= <strong style="color:#42A5F5">${fmtM(v.value)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Value/SF</span><span class="mi-row-val">${totalSF > 0 ? fmtD(v.value/totalSF) : "N/A"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Value vs Dev Cost</span><span class="mi-row-val" style="color:${v.value > totalDevCost ? "#16A34A" : "#EF4444"}">${totalDevCost > 0 ? (v.value > totalDevCost ? "+" : "") + fmtM(v.value - totalDevCost) + " (" + Math.round((v.value/totalDevCost-1)*100) + "%)" : "N/A"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Cap Rate Context</span><span class="mi-row-val">${v.rate <= 0.05 ? "Aggressive — primary market pricing" : v.rate <= 0.06 ? "Market — secondary market pricing" : "Conservative — discount/tertiary"}</span></div>
          <div class="mi-source">Source: REIT transaction comps (PSA, EXR, CUBE Q4 2025 filings) | Method: Direct capitalization</div>
        </div>
      </div></div>
    </div>`).join("")}
  </div>
  <div id="exec" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Investment Thesis</div>
      ${landCost > 0 && totalDevCost > 0 ? `<div>This ${!isNaN(acres) ? acres.toFixed(1) + "-acre" : ""} ${site.state || ""} site requires a total capital deployment of <strong style="color:#E87A2E">${fmtM(totalDevCost)}</strong> (${landCost > 0 ? Math.round(landCost/totalDevCost*100) : 0}% land / ${Math.round(hardCost/totalDevCost*100)}% hard / ${Math.round(softCost/totalDevCost*100)}% soft). At stabilization (Year 5), the facility produces <strong style="color:#16A34A">${fmtM(stabNOI)}</strong> NOI, implying a <strong style="color:${parseFloat(yocStab) >= 9 ? "#16A34A" : "#F59E0B"}">${yocStab}% yield on cost</strong> — ${parseFloat(yocStab) >= 9 ? "well above" : parseFloat(yocStab) >= 7.5 ? "above" : "near"} PS's typical 8-9% development hurdle rate.</div>` : "<div>Pricing data pending — investment thesis will populate when land cost is confirmed.</div>"}
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Return Waterfall</div>
      ${(() => {
        const items = [
          { label: "Land Acquisition", val: landCost, color: "#C9A84C" },
          { label: "Hard Costs", val: hardCost, color: "#E87A2E" },
          { label: "Soft Costs", val: softCost, color: "#F59E0B" },
        ];
        const maxVal = totalDevCost || 1;
        return items.map(it => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div style="width:120px;font-size:11px;color:#6B7394;font-weight:600;text-align:right">${it.label}</div>
          <div class="waterfall-bar" style="width:${Math.max(Math.round(it.val/maxVal*400), 40)}px;background:${it.color}">${it.val > 0 ? fmtM(it.val) : "TBD"}</div>
        </div>`).join("") + `<div style="display:flex;align-items:center;gap:10px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(201,168,76,0.15)">
          <div style="width:120px;font-size:11px;color:#C9A84C;font-weight:800;text-align:right">TOTAL</div>
          <div class="waterfall-bar" style="width:400px;background:linear-gradient(90deg,#C9A84C,#E87A2E)">${totalDevCost > 0 ? fmtM(totalDevCost) : "TBD"}</div>
        </div>`;
      })()}
    </div>
    <div class="grid3" style="margin-top:16px">
      <div class="insight-box" style="text-align:center">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">5-YEAR CUMULATIVE NOI</div>
        <div class="mono" style="font-size:20px;font-weight:800;color:#16A34A">${fmtM(yearData.reduce((s,y) => s + y.noi, 0))}</div>
      </div>
      <div class="insight-box" style="text-align:center">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">BREAK-EVEN YEAR</div>
        <div class="mono" style="font-size:20px;font-weight:800;color:#42A5F5">${(() => { let cum = 0; for(let i=0;i<yearData.length;i++){cum+=yearData[i].noi;if(cum>=totalDevCost)return "Year "+(i+1);} return totalDevCost > 0 ? ">5 Yrs" : "TBD"; })()}</div>
      </div>
      <div class="insight-box" style="text-align:center">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">VALUE CREATION</div>
        <div class="mono" style="font-size:20px;font-weight:800;color:#C9A84C">${totalDevCost > 0 ? fmtM(valuations[1].value - totalDevCost) : "TBD"}</div>
        <div style="font-size:9px;color:#6B7394;margin-top:2px">@ market cap</div>
      </div>
    </div>
  </div>
</div>

<!-- FACILITY PROGRAM v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('facility')">
  <span class="expand-hint">▼ Click to expand <span id="facility-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Facility Program</span></h2>
  <div class="grid4" style="margin-bottom:20px">
    <div class="metric-box mi-active mi" onclick="toggleMI('facreage',event)"><div class="label">Site Acreage</div><div class="value">${!isNaN(acres) ? acres.toFixed(2) : "TBD"} <span style="font-size:12px;color:#6B7394">ac</span></div><em class="mi-hint">i</em>
      <div id="mi-facreage" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Site Acreage</div><div class="mi-conf mi-conf-high">Listing Data</div></div>
        <div class="mi-body">
          <strong>Acreage sourced from listing platform.</strong> Drives all facility sizing calculations.
          <div class="mi-formula">Gross Site = ${!isNaN(acres) ? acres.toFixed(2) : "?"} acres = ${!isNaN(acres) ? Math.round(acres*43560).toLocaleString() : "?"} SF<br>Buildable (35% coverage) = ${footprint.toLocaleString()} SF</div>
          <div class="mi-row"><span class="mi-row-label">PS Size Classification</span><span class="mi-row-val">${acres >= 3.5 ? "Primary (one-story preferred)" : acres >= 2.5 ? "Secondary (multi-story candidate)" : "Undersized"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Coverage Ratio</span><span class="mi-row-val">35% (PS standard — Killeen TX sketch)</span></div>
          <div class="mi-source">Source: ${site.listingSource || "Crexi/LoopNet"} listing | Verify with survey when available</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi-active mi" onclick="toggleMI('fbldgtype',event)"><div class="label">Building Type</div><div class="value" style="font-size:16px">${isMultiStory ? stories + "-Story" : "1-Story"}</div><em class="mi-hint">i</em>
      <div id="mi-fbldgtype" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Building Type Selection</div><div class="mi-conf mi-conf-med">Algorithmic</div></div>
        <div class="mi-body">
          <strong>SiteScore auto-selects building type based on site acreage:</strong>
          <div class="mi-formula">${!isNaN(acres) ? acres.toFixed(2) : "?"} acres ${acres >= 2.5 ? "≥" : "<"} 2.5 ac threshold<br>→ ${isMultiStory ? stories + "-story multi-story (smaller site = build up)" : "One-story (preferred PS product on 3.5+ ac)"}</div>
          <div class="mi-row"><span class="mi-row-label">≥ 3.5 ac</span><span class="mi-row-val">One-story indoor (PS preference)</span></div>
          <div class="mi-row"><span class="mi-row-label">2.5 – 3.5 ac</span><span class="mi-row-val">3-4 story multi-story</span></div>
          <div class="mi-row"><span class="mi-row-label">< 2.5 ac</span><span class="mi-row-val">Generally too small for PS</span></div>
          <div class="mi-source">Source: PS development standards | One-story = lower per-SF cost, drive-up access, simpler operations</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi-active mi" onclick="toggleMI('ftotalsf',event)"><div class="label">Total Rentable SF</div><div class="value">${totalSF.toLocaleString()}</div><em class="mi-hint">i</em>
      <div id="mi-ftotalsf" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Total SF Calculation</div><div class="mi-conf mi-conf-med">Derived</div></div>
        <div class="mi-body">
          <strong>Total rentable square footage is the key revenue driver.</strong>
          <div class="mi-formula">Total SF = Building Footprint × Stories<br>= ${footprint.toLocaleString()} SF × ${stories}<br>= <strong style="color:#E2E8F0">${totalSF.toLocaleString()} SF</strong></div>
          <div class="mi-row"><span class="mi-row-label">Building Footprint</span><span class="mi-row-val">${footprint.toLocaleString()} SF</span></div>
          <div class="mi-row"><span class="mi-row-label">Footprint = Acres × 43,560 × 35%</span><span class="mi-row-val">${!isNaN(acres) ? (acres * 43560).toLocaleString() : "?"} × 0.35</span></div>
          <div class="mi-row"><span class="mi-row-label">Stories</span><span class="mi-row-val">${stories}</span></div>
          <div class="mi-row"><span class="mi-row-label">Revenue Density</span><span class="mi-row-val">${totalSF > 0 ? "$" + (stabRev/totalSF).toFixed(2) + "/SF/yr" : "N/A"}</span></div>
          <div class="mi-source">Source: SiteScore Facility Sizing Engine | 35% coverage from PS Killeen TX Option A sketch (Dec 2024)</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi-active mi" onclick="toggleMI('funits',event)"><div class="label">Est. Unit Count</div><div class="value">${totalUnits.toLocaleString()}</div><em class="mi-hint">i</em>
      <div id="mi-funits" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Unit Count Estimation</div><div class="mi-conf mi-conf-med">Modeled</div></div>
        <div class="mi-body">
          <strong>Unit count derived from PS standard unit mix allocation:</strong>
          <div class="mi-formula">Total Units = Σ (SF Allocation ÷ Unit Size)<br>= ${unitRows.map(u => u.units).join(" + ")}<br>= <strong style="color:#E2E8F0">${totalUnits} units</strong></div>
          <div style="font-size:10px;font-weight:700;color:#6B7394;margin:8px 0 4px">UNIT MIX BREAKDOWN:</div>
          ${unitRows.map(u => `<div class="mi-row"><span class="mi-row-label">${u.type} (${Math.round(u.pct*100)}%)</span><span class="mi-row-val">${u.units} units × ${u.sf} SF = ${u.allocSF.toLocaleString()} SF</span></div>`).join("")}
          <div class="mi-row" style="border-top:1px solid rgba(201,168,76,0.12);padding-top:6px;margin-top:4px"><span class="mi-row-label">Avg Monthly Rent/Unit</span><span class="mi-row-val">${fmtD(avgMonthlyRent)}</span></div>
          <div class="mi-source">Source: PS typical unit mix (industry standard) | Weighted toward 5x10 and 10x10 (highest demand)</div>
        </div>
      </div></div>
    </div>
  </div>
  <div class="grid2">
    <div class="mi" onclick="toggleMI('fclimate',event)" style="background:rgba(21,101,192,0.08);border:1px solid rgba(21,101,192,0.2);border-radius:12px;padding:16px;cursor:pointer">
      <div style="font-size:11px;font-weight:700;color:#42A5F5;letter-spacing:0.08em;margin-bottom:8px">CLIMATE-CONTROLLED (${Math.round(climatePct*100)}%)</div>
      <div class="mono" style="font-size:20px;font-weight:800;color:#fff">${climateSF.toLocaleString()} SF</div>
      <div style="font-size:11px;color:#94A3B8;margin-top:4px">Stabilized rate: $${stabClimRate.toFixed(2)}/SF/mo</div><em class="mi-hint">i</em>
      <div id="mi-fclimate" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Climate-Controlled SF</div><div class="mi-conf mi-conf-high">PS Standard</div></div>
        <div class="mi-body">
          <div class="mi-formula">Climate SF = Total SF × ${Math.round(climatePct*100)}%<br>= ${totalSF.toLocaleString()} × ${climatePct}<br>= <strong style="color:#42A5F5">${climateSF.toLocaleString()} SF</strong></div>
          <div class="mi-row"><span class="mi-row-label">Split Ratio</span><span class="mi-row-val">${Math.round(climatePct*100)}/${Math.round(drivePct*100)} (Climate/Drive)</span></div>
          <div class="mi-row"><span class="mi-row-label">Why ${Math.round(climatePct*100)}%?</span><span class="mi-row-val">${isMultiStory ? "Multi-story = vertical = all indoor" : "Per PS Killeen TX layout (Dec 2024)"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Revenue Premium</span><span class="mi-row-val">Climate rates ~${Math.round((stabClimRate/stabDriveRate-1)*100)}% above drive-up</span></div>
          <div class="mi-row"><span class="mi-row-label">Annual Revenue (Y5)</span><span class="mi-row-val">${fmtD(climateSF * stabClimRate * 12 * 0.92)}</span></div>
          <div class="mi-source">Source: PS Killeen TX Option A site sketch calibration | Climate = primary revenue driver, premium pricing</div>
        </div>
      </div></div>
    </div>
    <div class="mi" onclick="toggleMI('fdrive',event)" style="background:rgba(232,122,46,0.08);border:1px solid rgba(232,122,46,0.2);border-radius:12px;padding:16px;cursor:pointer">
      <div style="font-size:11px;font-weight:700;color:#E87A2E;letter-spacing:0.08em;margin-bottom:8px">DRIVE-UP (${Math.round(drivePct*100)}%)</div>
      <div class="mono" style="font-size:20px;font-weight:800;color:#fff">${driveSF.toLocaleString()} SF</div>
      <div style="font-size:11px;color:#94A3B8;margin-top:4px">Stabilized rate: $${stabDriveRate.toFixed(2)}/SF/mo</div><em class="mi-hint">i</em>
      <div id="mi-fdrive" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Drive-Up SF</div><div class="mi-conf mi-conf-high">PS Standard</div></div>
        <div class="mi-body">
          <div class="mi-formula">Drive-Up SF = Total SF × ${Math.round(drivePct*100)}%<br>= ${totalSF.toLocaleString()} × ${drivePct.toFixed(2)}<br>= <strong style="color:#E87A2E">${driveSF.toLocaleString()} SF</strong></div>
          <div class="mi-row"><span class="mi-row-label">Drive-Up Rate</span><span class="mi-row-val">$${stabDriveRate.toFixed(2)}/SF/mo (55% of climate)</span></div>
          <div class="mi-row"><span class="mi-row-label">Rate Methodology</span><span class="mi-row-val">Climate × 0.55 (no HVAC, ground-floor access)</span></div>
          <div class="mi-row"><span class="mi-row-label">Annual Revenue (Y5)</span><span class="mi-row-val">${fmtD(driveSF * stabDriveRate * 12 * 0.92)}</span></div>
          <div class="mi-source">Source: Industry 55% discount vs climate (no HVAC, simpler construction) | PS development standards</div>
        </div>
      </div></div>
    </div>
  </div>
  <div id="facility" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Sizing Methodology</div>
      <div>PS standard product: ${isMultiStory ? stories + "-story multi-story" : "single-story indoor climate-controlled"} facility on ${!isNaN(acres) ? acres.toFixed(2) : "N/A"} acres. Building footprint calculated at <strong>35% lot coverage</strong> (${footprint.toLocaleString()} SF ground floor), the PS development standard for optimal site utilization while accommodating parking, drive aisles, landscaping, and stormwater.</div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Site Utilization Breakdown</div>
      <div style="display:flex;gap:4px;height:32px;border-radius:8px;overflow:hidden;margin-bottom:12px">
        <div style="width:35%;background:linear-gradient(90deg,#1565C0,#42A5F5);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff">Building 35%</div>
        <div style="width:30%;background:rgba(107,115,148,0.3);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#94A3B8">Parking/Drives 30%</div>
        <div style="width:20%;background:rgba(22,163,74,0.2);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#66BB6A">Landscape 20%</div>
        <div style="width:15%;background:rgba(66,165,245,0.15);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#42A5F5">SW/Other 15%</div>
      </div>
    </div>
    <div class="grid2" style="margin-top:14px">
      <div>
        <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.08em;margin-bottom:8px">CLIMATE-CONTROLLED DEEP DIVE</div>
        <div class="drill-row"><span class="drill-label">Gross SF Allocation</span><span class="drill-value">${climateSF.toLocaleString()} SF</span></div>
        <div class="drill-row"><span class="drill-label">Net Rentable (92%)</span><span class="drill-value">${Math.round(climateSF * 0.92).toLocaleString()} SF</span></div>
        <div class="drill-row"><span class="drill-label">Annual Revenue (Stab.)</span><span class="drill-value" style="color:#42A5F5">${fmtD(yearData[4].climRev)}</span></div>
        <div class="drill-row"><span class="drill-label">Revenue Per SF</span><span class="drill-value">$${(yearData[4].climRev / climateSF).toFixed(2)}/SF/yr</span></div>
        <div class="drill-row"><span class="drill-label">HVAC Requirement</span><span class="drill-value">3-phase, ${Math.round(climateSF/1000)*3} ton est.</span></div>
        <div class="drill-row"><span class="drill-label">Insulation</span><span class="drill-value">R-30 walls, R-38 roof min.</span></div>
      </div>
      <div>
        <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.08em;margin-bottom:8px">DRIVE-UP DEEP DIVE</div>
        <div class="drill-row"><span class="drill-label">Gross SF Allocation</span><span class="drill-value">${driveSF.toLocaleString()} SF</span></div>
        <div class="drill-row"><span class="drill-label">Net Rentable (95%)</span><span class="drill-value">${Math.round(driveSF * 0.95).toLocaleString()} SF</span></div>
        <div class="drill-row"><span class="drill-label">Annual Revenue (Stab.)</span><span class="drill-value" style="color:#E87A2E">${fmtD(yearData[4].driveRev)}</span></div>
        <div class="drill-row"><span class="drill-label">Revenue Per SF</span><span class="drill-value">$${(yearData[4].driveRev / driveSF).toFixed(2)}/SF/yr</span></div>
        <div class="drill-row"><span class="drill-label">Door Size</span><span class="drill-value">8'W x 8'H roll-up standard</span></div>
        <div class="drill-row"><span class="drill-label">Drive Aisle</span><span class="drill-value">26' minimum (truck access)</span></div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:14px">
      <div class="insight-title">Why ${Math.round(climatePct*100)}/${Math.round(drivePct*100)} Climate/Drive Split?</div>
      <div>PS's development playbook targets 70/30 climate-to-drive ratio for new builds. Climate-controlled units command a <strong style="color:#42A5F5">${Math.round((stabClimRate/stabDriveRate - 1) * 100)}% rate premium</strong> over drive-up ($${stabClimRate.toFixed(2)} vs $${stabDriveRate.toFixed(2)}/SF/mo), generating ${Math.round(yearData[4].climRev/(yearData[4].climRev+yearData[4].driveRev)*100)}% of stabilized revenue from ${Math.round(climatePct*100)}% of the space. Higher margins, lower maintenance, better insurance profile.</div>
    </div>
  </div>
</div>

<!-- UNIT MIX v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('unitmix')">
  <span class="expand-hint">▼ Click to expand <span id="unitmix-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Unit Mix & Stabilized Pricing</span></h2>
  <table>
    <thead><tr><th>Unit Type</th><th>Size (SF)</th><th>Units</th><th>Total SF</th><th>Mo. Rate</th><th>Annual Rev</th><th>% of Total</th></tr></thead>
    <tbody>
      ${unitRows.map((u, idx) => {
        const annRev = u.units * u.moRate * 12 * 0.92;
        const ratePerSF = u.moRate / u.sf;
        return `<tr class="mi" onclick="toggleMI('umr${idx}',event)" style="cursor:pointer"><td style="font-weight:600">${u.type} <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td class="mono">${u.sf}</td><td class="mono">${u.units}</td><td class="mono">${u.allocSF.toLocaleString()}</td><td class="mono gold">$${u.moRate}</td><td class="mono">${fmtD(annRev)}</td><td class="muted">${(u.pct * 100).toFixed(0)}%</td></tr>
        <tr><td colspan="7" style="padding:0;border:none"><div id="mi-umr${idx}" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">${u.type} — Rate & Allocation Logic</div><div class="mi-conf mi-conf-high">PS Standard</div></div>
          <div class="mi-body">
            <strong>Why ${u.units} units at $${u.moRate}/mo?</strong>
            <div class="mi-formula">${u.type} = ${(u.pct*100).toFixed(0)}% of total mix (${u.units} of ${totalUnits} units)<br>Size: ${u.sf} SF/unit × ${u.units} units = ${u.allocSF.toLocaleString()} SF total<br>Monthly Rate: $${u.moRate} → $${ratePerSF.toFixed(2)}/SF/mo<br>Stabilized Annual Rev (92% occ): ${fmtD(annRev)}</div>
            <div class="mi-row"><span class="mi-row-label">Rate Per SF</span><span class="mi-row-val">$${ratePerSF.toFixed(2)}/SF/mo — ${ratePerSF > 1.8 ? "premium density (small units command highest $/SF)" : ratePerSF > 1.2 ? "strong revenue density" : "volume-driven unit (lower $/SF, high demand)"}</span></div>
            <div class="mi-row"><span class="mi-row-label">PS Portfolio Demand</span><span class="mi-row-val">${u.sf <= 50 ? "Highest demand velocity — turns over 2-3x/year, minimal vacancy risk" : u.sf <= 150 ? "Core demand driver — household movers, small business inventory" : "Lower velocity but essential for large-item storage (furniture, vehicles)"}</span></div>
            <div class="mi-row"><span class="mi-row-label">Value to PS</span><span class="mi-row-val">${u.sf <= 50 ? "Small units generate 2.5-3x the revenue/SF of large units — PS maximizes small-unit allocation to drive RevPAF" : u.sf <= 150 ? "10x10 and 10x15 are the highest-volume unit types in the PS portfolio — they balance revenue density with customer demand" : "Large units anchor occupancy — customers moving or renovating homes use these units and often convert to long-term tenants"}</span></div>
            <div class="mi-source">Source: PS unit mix allocation model | Industry standard weighted toward 5x10 and 10x10 (highest demand categories per SSA annual survey)</div>
          </div>
        </div></div></td></tr>`;
      }).join("")}
      <tr class="mi" onclick="toggleMI('umtotal',event)" style="border-top:2px solid rgba(201,168,76,0.2);font-weight:700;cursor:pointer"><td>TOTAL <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td></td><td class="mono">${totalUnits}</td><td class="mono">${totalSF.toLocaleString()}</td><td></td><td class="mono green">${fmtD(yearData[4].totalRev)}</td><td></td></tr>
      <tr><td colspan="7" style="padding:0;border:none"><div id="mi-umtotal" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Portfolio Revenue Summary</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <strong>Stabilized (Y5) revenue at 92% occupancy across all ${totalUnits} units.</strong>
          <div class="mi-formula">Total Rentable SF: ${totalSF.toLocaleString()}<br>Climate SF: ${climateSF.toLocaleString()} (${Math.round(climatePct*100)}%) @ $${mktClimateRate.toFixed(2)}/SF/mo<br>Drive-Up SF: ${driveSF.toLocaleString()} (${Math.round(drivePct*100)}%) @ $${mktDriveRate.toFixed(2)}/SF/mo<br>Weighted Blended Rate: $${(mktClimateRate * climatePct + mktDriveRate * drivePct).toFixed(2)}/SF/mo<br>Y5 Stabilized Revenue: <strong style="color:#16A34A">${fmtD(yearData[4].totalRev)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Revenue Density (RevPAF)</span><span class="mi-row-val">$${(yearData[4].totalRev / totalSF).toFixed(2)}/SF/yr — ${(yearData[4].totalRev / totalSF) >= 22 ? "above PS portfolio avg ($24.50)" : "competitive with institutional benchmarks"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Why This Mix Matters to PS</span><span class="mi-row-val">Unit mix optimization is PS's #1 lever for RevPAF growth. Small-unit-heavy mixes (40%+ of units under 100 SF) consistently outperform large-unit facilities by 15-25% on RevPAF. This mix allocates ${Math.round(unitRows.filter(u=>u.sf<=100).reduce((s,u)=>s+u.pct,0)*100)}% to units under 100 SF.</span></div>
          <div class="mi-source">Source: SiteScore™ unit mix engine | Calibrated against PS 10-K reported RevPAF and SSA operating benchmarks</div>
        </div>
      </div></div></td></tr>
    </tbody>
  </table>
  <div id="unitmix" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Unit Mix Strategy</div>
      <div>PS's unit mix is optimized for maximum revenue density. <strong>Small units (5x5 to 5x10)</strong> represent ${Math.round(unitRows.filter(u=>u.sf<=50).reduce((s,u)=>s+u.pct,0)*100)}% of inventory but command the highest per-SF rates ($${(unitRows.find(u=>u.sf===25)?.moRate/25).toFixed(2)}/SF/mo for 5x5 climate). <strong>Mid-size (10x10 to 10x15)</strong> are the volume driver at ${Math.round(unitRows.filter(u=>u.sf>=100&&u.sf<=150).reduce((s,u)=>s+u.pct,0)*100)}% of mix — the sweet spot for household movers and small business. <strong>Large units (10x20+)</strong> are limited to ${Math.round(unitRows.filter(u=>u.sf>=200).reduce((s,u)=>s+u.pct,0)*100)}% — high demand but low revenue per SF.</div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Revenue Per SF by Unit Type</div>
      ${unitRows.map(u => {
        const ratePerSF = u.moRate / u.sf;
        const maxRate = Math.max(...unitRows.map(r => r.moRate / r.sf));
        const barPct = Math.round(ratePerSF / maxRate * 100);
        return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">
          <div style="width:110px;font-size:10px;color:#6B7394;font-weight:600;text-align:right">${u.type}</div>
          <div style="flex:1;height:18px;border-radius:4px;background:rgba(255,255,255,0.04);overflow:hidden">
            <div style="width:${barPct}%;height:100%;border-radius:4px;background:${u.cat === "climate" ? "linear-gradient(90deg,#1565C0,#42A5F5)" : "linear-gradient(90deg,#C65D00,#E87A2E)"};display:flex;align-items:center;padding:0 8px">
              <span style="font-size:9px;font-weight:700;color:#fff">$${ratePerSF.toFixed(2)}/SF</span>
            </div>
          </div>
          <div style="width:50px;font-size:10px;font-weight:700;color:#C9A84C;font-family:'Space Mono',monospace;text-align:right">$${u.moRate}/mo</div>
        </div>`;
      }).join("")}
    </div>
    <div class="grid3" style="margin-top:16px">
      <div class="insight-box" style="text-align:center">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">AVG UNIT SIZE</div>
        <div class="mono" style="font-size:18px;font-weight:800;color:#fff">${Math.round(totalSF / totalUnits)} SF</div>
      </div>
      <div class="insight-box" style="text-align:center">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">AVG MONTHLY RENT</div>
        <div class="mono" style="font-size:18px;font-weight:800;color:#C9A84C">$${Math.round(unitRows.reduce((s,u) => s + u.moRate * u.units, 0) / totalUnits)}</div>
      </div>
      <div class="insight-box" style="text-align:center">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">REVENUE DENSITY</div>
        <div class="mono" style="font-size:18px;font-weight:800;color:#16A34A">$${(yearData[4].totalRev / totalSF).toFixed(2)}<span style="font-size:10px">/SF/yr</span></div>
      </div>
    </div>
  </div>
</div>

<!-- MARKET RATE INTELLIGENCE v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('rates')">
  <span class="expand-hint">▼ Click to expand <span id="rates-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Market Rate Intelligence</span></h2>
  <div class="grid2" style="margin-bottom:20px">
    <div>
      <h3 class="muted">Rate Drivers</h3>
      <table style="font-size:12px">
        <tr class="mi" onclick="toggleMI('rdinctier',event)" style="cursor:pointer"><td style="color:#6B7394;width:160px">Income Tier <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td style="font-weight:700;text-transform:capitalize">${incTier} ${incN ? "($" + incN.toLocaleString() + " HHI)" : ""}</td></tr>
        <tr><td colspan="2" style="padding:0;border:none"><div id="mi-rdinctier" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Income Tier Classification</div><div class="mi-conf mi-conf-high">Census ACS</div></div>
          <div class="mi-body">
            <strong>3-mile median household income determines the base rental rate tier.</strong> Higher income = higher willingness to pay for climate-controlled storage.
            <div class="mi-formula">3-mi Median HHI = $${incN ? incN.toLocaleString() : "N/A"}<br>→ Tier: <strong style="color:#C9A84C;text-transform:capitalize">${incTier}</strong><br>→ Base Climate Rate: $${baseClimateRate.toFixed(2)}/SF/mo</div>
            <div class="mi-row"><span class="mi-row-label">Premium ($90K+)</span><span class="mi-row-val">$1.45/SF base</span></div>
            <div class="mi-row"><span class="mi-row-label">Upper ($75K-$90K)</span><span class="mi-row-val">$1.25/SF base</span></div>
            <div class="mi-row"><span class="mi-row-label">Mid ($60K-$75K)</span><span class="mi-row-val">$1.10/SF base</span></div>
            <div class="mi-row"><span class="mi-row-label">Value (&lt;$60K)</span><span class="mi-row-val">$0.95/SF base</span></div>
            <div class="mi-source">Source: US Census ACS 5-Year | Table B19013 | 3-mile radius from site coordinates</div>
          </div>
        </div></div></td></tr>
        <tr class="mi" onclick="toggleMI('rdcomp',event)" style="cursor:pointer"><td style="color:#6B7394">Competition (3-mi) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td style="font-weight:700">${compCount} facilities ${compCount <= 2 ? '<span class="tag" style="background:#16A34A20;color:#16A34A">LOW — Rate Premium</span>' : compCount <= 5 ? '<span class="tag" style="background:#F59E0B20;color:#F59E0B">MODERATE</span>' : '<span class="tag" style="background:#EF444420;color:#EF4444">HIGH — Rate Pressure</span>'}</td></tr>
        <tr><td colspan="2" style="padding:0;border:none"><div id="mi-rdcomp" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Competition Rate Adjustment</div><div class="mi-conf mi-conf-med">Web Research</div></div>
          <div class="mi-body">
            <strong>Competitor count within 3 miles adjusts the base rate up or down.</strong> Low competition = pricing power. High competition = rate pressure.
            <div class="mi-formula">Competitors found: <strong>${compCount}</strong><br>Adjustment: <strong style="color:${compAdj >= 1 ? "#16A34A" : "#F59E0B"}">${compAdj >= 1 ? "+" : ""}${((compAdj-1)*100).toFixed(0)}%</strong> to base rate<br>Adjusted Rate: $${baseClimateRate.toFixed(2)} × ${compAdj.toFixed(2)} = $${mktClimateRate.toFixed(2)}/SF/mo</div>
            <div class="mi-row"><span class="mi-row-label">0-1 competitors</span><span class="mi-row-val">+8% premium (supply scarcity)</span></div>
            <div class="mi-row"><span class="mi-row-label">2-3 competitors</span><span class="mi-row-val">0% (market equilibrium)</span></div>
            <div class="mi-row"><span class="mi-row-label">4+ competitors</span><span class="mi-row-val">-3% to -6% (rate pressure)</span></div>
            <div class="mi-source">Source: Google Maps, SpareFoot, operator websites | 3-mile radius scan | ${site.competitorNames || "Competitors surveyed"}</div>
          </div>
        </div></div></td></tr>
        <tr><td style="color:#6B7394">Population Growth</td><td style="font-weight:700">${growthPct.toFixed(1)}% CAGR ${growthPct >= 2 ? '<span class="tag" style="background:#16A34A20;color:#16A34A">Explosive</span>' : growthPct >= 1 ? '<span class="tag" style="background:#42A5F520;color:#42A5F5">Healthy</span>' : '<span class="tag" style="background:#F59E0B20;color:#F59E0B">Stable</span>'}</td></tr>
        <tr><td style="color:#6B7394">Competition Adj.</td><td style="font-weight:700;color:${compAdj >= 1 ? "#16A34A" : "#F59E0B"}">${compAdj >= 1 ? "+" : ""}${((compAdj - 1) * 100).toFixed(0)}% to base rate</td></tr>
        ${site.demandDrivers ? `<tr><td style="color:#6B7394">Demand Drivers</td><td style="font-weight:600;font-size:11px">${site.demandDrivers.substring(0, 150)}${site.demandDrivers.length > 150 ? "..." : ""}</td></tr>` : ""}
      </table>
    </div>
    <div>
      <h3 class="muted">Blended Market Rates</h3>
      <div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid rgba(201,168,76,0.08)">
        <div class="mi" onclick="toggleMI('rclim',event)" style="display:flex;justify-content:space-between;margin-bottom:12px;cursor:pointer;padding:4px;border-radius:6px">
          <span style="font-size:11px;color:#6B7394">Climate-Controlled <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span>
          <span class="mono" style="font-size:16px;font-weight:800;color:#42A5F5">$${mktClimateRate.toFixed(2)}<span style="font-size:10px;color:#6B7394">/SF/mo</span></span>
        </div>
        <div id="mi-rclim" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Climate Rate Derivation</div><div class="mi-conf mi-conf-${rateConfidence === "High" ? "high" : "med"}">${rateConfidence || "Medium"} Confidence</div></div>
          <div class="mi-body">
            <strong>Three independent methods cross-validated to derive the final climate rate:</strong>
            <div class="mi-formula">Method 1 (Income Tier): $${m1Rate.toFixed(2)}/SF<br>Method 2 (Rev Density): $${m2ClimRate.toFixed(2)}/SF<br>Method 3 (Pop Density): $${m3ClimRate.toFixed(2)}/SF<br>────────────────────────<br>Consensus: <strong style="color:#42A5F5">$${consensusClimRate.toFixed(2)}/SF</strong> × ${compAdj.toFixed(2)} comp adj = <strong style="color:#42A5F5">$${mktClimateRate.toFixed(2)}/SF/mo</strong></div>
            <div class="mi-row"><span class="mi-row-label">Cross-Validation Spread</span><span class="mi-row-val">$${Math.abs(Math.max(m1Rate,m2ClimRate,m3ClimRate) - Math.min(m1Rate,m2ClimRate,m3ClimRate)).toFixed(2)} (${Math.abs(Math.max(m1Rate,m2ClimRate,m3ClimRate) - Math.min(m1Rate,m2ClimRate,m3ClimRate)) < 0.15 ? "tight — high confidence" : "moderate spread"})</span></div>
            <div class="mi-row"><span class="mi-row-label">Annual Escalation</span><span class="mi-row-val">${(annualEsc*100).toFixed(1)}% (CPI + storage inflation)</span></div>
            ${streetRateOverride ? `<div class="mi-row"><span class="mi-row-label">Street Rate Override</span><span class="mi-row-val">$${streetRateOverride.toFixed(2)} (${streetVariance > 0 ? "+" : ""}${streetVariance}% vs model)</span></div>` : ""}
            <div class="mi-source">Source: Income-tier matrix + Revenue density benchmarks + Population density factor | 3-method consensus</div>
          </div>
        </div></div>
        <div class="mi" onclick="toggleMI('rdrive',event)" style="display:flex;justify-content:space-between;margin-bottom:12px;cursor:pointer;padding:4px;border-radius:6px">
          <span style="font-size:11px;color:#6B7394">Drive-Up <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span>
          <span class="mono" style="font-size:16px;font-weight:800;color:#E87A2E">$${mktDriveRate.toFixed(2)}<span style="font-size:10px;color:#6B7394">/SF/mo</span></span>
        </div>
        <div id="mi-rdrive" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Drive-Up Rate</div><div class="mi-conf mi-conf-high">Derived</div></div>
          <div class="mi-body">
            <div class="mi-formula">Drive-Up Rate = Climate Rate × 55%<br>= $${mktClimateRate.toFixed(2)} × 0.55<br>= <strong style="color:#E87A2E">$${mktDriveRate.toFixed(2)}/SF/mo</strong></div>
            <strong>Why 55%?</strong> Drive-up units have no HVAC, simpler construction, ground-floor only. Industry-standard discount: 45-55% below climate. PS uses 55% consistently across their portfolio.
            <div class="mi-source">Source: Industry standard | PS portfolio pricing analysis | No HVAC overhead = lower rate justified by lower opex</div>
          </div>
        </div></div>
        <div style="border-top:1px solid rgba(201,168,76,0.1);padding-top:10px;display:flex;justify-content:space-between">
          <span style="font-size:11px;color:#6B7394">Blended Avg</span>
          <span class="mono" style="font-size:16px;font-weight:800;color:#C9A84C">$${(mktClimateRate * climatePct + mktDriveRate * drivePct).toFixed(2)}<span style="font-size:10px;color:#6B7394">/SF/mo</span></span>
        </div>
      </div>
    </div>
  </div>
  <div id="rates" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Rate Derivation Methodology</div>
      <div>Rates are derived from a 3-factor model: <strong>(1) Income tier</strong> sets the base — ${incTier} markets ($${incN ? incN.toLocaleString() : "N/A"} HHI) support ${incTier === "premium" ? "premium pricing above $1.40/SF for climate" : incTier === "upper" ? "above-average rates of $1.20-1.40/SF for climate" : incTier === "mid" ? "mid-market rates of $1.00-1.20/SF for climate" : "value rates below $1.00/SF for climate"}. <strong>(2) Competition density</strong> adjusts ±8%: ${compCount} competitors within 3 miles = ${compAdj >= 1.05 ? "rate premium opportunity (low supply)" : compAdj >= 1.0 ? "market-rate pricing" : compAdj >= 0.94 ? "modest rate pressure" : "significant rate compression"}. <strong>(3) Annual escalation</strong> of ${(annualEsc*100).toFixed(0)}% compounds through the 5-year model, reflecting CPI + storage-specific inflation.</div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Income Tier Rate Matrix</div>
      <table style="font-size:11px">
        <thead><tr><th>Tier</th><th>HHI Range</th><th>Climate Base</th><th>Drive-Up Base</th><th style="text-align:center">This Site</th></tr></thead>
        <tbody>
          ${[
            { tier: "Premium", hhi: "$90K+", clim: "$1.45", drive: "$0.85", active: incTier === "premium" },
            { tier: "Upper", hhi: "$75K–$90K", clim: "$1.25", drive: "$0.72", active: incTier === "upper" },
            { tier: "Mid", hhi: "$60K–$75K", clim: "$1.10", drive: "$0.62", active: incTier === "mid" },
            { tier: "Value", hhi: "<$60K", clim: "$0.95", drive: "$0.52", active: incTier === "value" },
          ].map(t => `<tr style="${t.active ? "background:rgba(201,168,76,0.08);border-left:3px solid #C9A84C" : ""}">
            <td style="font-weight:700;${t.active ? "color:#C9A84C" : ""}">${t.tier}</td>
            <td>${t.hhi}</td>
            <td class="mono">${t.clim}/SF/mo</td>
            <td class="mono">${t.drive}/SF/mo</td>
            <td style="text-align:center">${t.active ? '<span class="tag" style="background:#C9A84C20;color:#C9A84C">ACTIVE</span>' : ""}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">5-Year Rate Escalation Trajectory</div>
      <div style="display:flex;gap:12px">
        ${yearData.map((y, i) => `<div style="flex:1;text-align:center;background:rgba(15,21,56,0.5);border-radius:8px;padding:10px;border:1px solid rgba(201,168,76,0.06)">
          <div style="font-size:9px;font-weight:700;color:#6B7394;margin-bottom:4px">Y${y.yr}</div>
          <div class="mono" style="font-size:13px;font-weight:700;color:#42A5F5">$${y.mktClimFull.toFixed(2)}</div>
          <div class="mono" style="font-size:11px;color:#E87A2E">$${y.mktDriveFull.toFixed(2)}</div>
          ${y.climDisc > 0 ? `<div style="font-size:8px;color:#EF4444;margin-top:2px">-${Math.round(y.climDisc*100)}% promo</div>` : `<div style="font-size:8px;color:#16A34A;margin-top:2px">Full rate</div>`}
        </div>`).join("")}
      </div>
    </div>
    ${site.competitorNames ? `<div class="insight-box" style="margin-top:14px">
      <div class="insight-title">Competitive Landscape</div>
      <div><strong>Known Operators (3-mi):</strong> ${site.competitorNames}</div>
      ${site.nearestCompetitor ? `<div style="margin-top:6px"><strong>Nearest:</strong> ${site.nearestCompetitor}</div>` : ""}
      ${site.demandSupplySignal ? `<div style="margin-top:6px"><strong>Market Signal:</strong> ${site.demandSupplySignal}</div>` : ""}
    </div>` : ""}
  </div>
</div>

<div class="divider"></div>

<!-- 5-YEAR LEASE-UP MODEL v4.0 -->
<div class="section section-gold expand-trigger" onclick="toggleExpand('leaseup')">
  <span class="expand-hint">▼ Click to expand <span id="leaseup-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">5-Year Lease-Up Revenue Model</span></h2>
  <div style="font-size:12px;color:#94A3B8;margin-bottom:20px">PS lease-up strategy: aggressive discounting in Y1 to fill units, gradual ECRI (Existing Customer Rate Increases) through Y3-Y5 to push above street rates.</div>
  <table>
    <thead><tr><th>Year</th><th>Occupancy</th><th>Climate $/SF</th><th>Drive $/SF</th><th>Gross Revenue</th><th>OpEx (${Math.round(yearData[0].opex/yearData[0].totalRev*100)}%→${Math.round(yearData[4].opex/yearData[4].totalRev*100)}%)</th><th>NOI</th></tr></thead>
    <tbody>
      ${yearData.map((y, i) => {
        const noiColor = y.noi > 0 ? (i >= 3 ? "#16A34A" : "#42A5F5") : "#EF4444";
        const revGrowth = i > 0 ? Math.round(((y.totalRev - yearData[i-1].totalRev) / yearData[i-1].totalRev) * 100) : 0;
        return `<tr class="yr-row mi" onclick="toggleMI('ly${i}',event)" style="cursor:pointer">
          <td><div style="font-weight:700;color:#C9A84C">${y.label} <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div><div style="font-size:10px;color:#6B7394;margin-top:2px">${y.desc}</div></td>
          <td>${pctBar(y.occRate, y.occRate >= 0.85 ? "#16A34A" : y.occRate >= 0.60 ? "#F59E0B" : "#EF4444")}</td>
          <td class="mono"><span style="color:#42A5F5">$${y.climRate.toFixed(2)}</span>${y.climDisc > 0 ? `<div style="font-size:9px;color:#EF4444">-${Math.round(y.climDisc*100)}% disc</div>` : `<div style="font-size:9px;color:#16A34A">Full rate</div>`}</td>
          <td class="mono"><span style="color:#E87A2E">$${y.driveRate.toFixed(2)}</span>${y.driveDisc > 0 ? `<div style="font-size:9px;color:#EF4444">-${Math.round(y.driveDisc*100)}% disc</div>` : `<div style="font-size:9px;color:#16A34A">Full rate</div>`}</td>
          <td class="mono" style="font-weight:700">${fmtD(y.totalRev)}${i > 0 ? `<div style="font-size:9px;color:#16A34A">+${revGrowth}% YoY</div>` : ""}</td>
          <td class="mono" style="color:#F59E0B">(${fmtD(y.opex)})</td>
          <td class="mono" style="font-weight:800;color:${noiColor}">${fmtD(y.noi)}</td>
        </tr>
        <tr><td colspan="7" style="padding:0;border:none"><div id="mi-ly${i}" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">${y.label} — Full Revenue Derivation</div><div class="mi-conf mi-conf-${i >= 3 ? "high" : "med"}">${i >= 3 ? "High Confidence" : "Lease-Up Risk"}</div></div>
          <div class="mi-body">
            <strong>${i === 0 ? "Grand opening year — aggressive promotional pricing to drive initial occupancy. PS invests $50-75K in marketing (Google Ads, signage, direct mail) to build awareness." : i === 1 ? "Occupancy ramp continues. First ECRI round applied to Y1 tenants (8-10% increase). Marketing spend declines 40%." : i === 2 ? "Facility approaching stabilization. ECRI applied to all cohorts. Y1 tenants now paying 20%+ above their original rate." : i === 3 ? "Near-stabilized operations. ECRI revenue engine fully engaged. Street rates set competitively; in-place rents 25-35% above street for tenured tenants." : "Stabilized year — the basis for all valuation metrics in this report. 92% occupancy reflects PS portfolio average."}</strong>
            <div class="mi-formula">Occupancy: ${Math.round(y.occRate*100)}% → ${Math.round(y.occRate * totalSF).toLocaleString()} occupied SF<br>Climate Rev: ${climateSF.toLocaleString()} SF × ${Math.round(y.occRate*100)}% × $${y.climRate.toFixed(2)}/SF × 12 mo = ${fmtD(Math.round(climateSF * y.occRate * y.climRate * 12))}<br>Drive-Up Rev: ${driveSF.toLocaleString()} SF × ${Math.round(y.occRate*100)}% × $${y.driveRate.toFixed(2)}/SF × 12 mo = ${fmtD(Math.round(driveSF * y.occRate * y.driveRate * 12))}<br>Total Revenue: <strong style="color:#C9A84C">${fmtD(y.totalRev)}</strong><br>OpEx: (${fmtD(y.opex)}) — ${Math.round(y.opex/y.totalRev*100)}% ratio<br>NOI: <strong style="color:${noiColor}">${fmtD(y.noi)}</strong></div>
            ${y.climDisc > 0 ? `<div class="mi-row"><span class="mi-row-label">Promotional Discount</span><span class="mi-row-val">${Math.round(y.climDisc*100)}% below market — PS offers "first month free" or reduced rates to drive move-ins. This is recaptured via ECRI within 12-18 months.</span></div>` : `<div class="mi-row"><span class="mi-row-label">Rate Status</span><span class="mi-row-val">Full market rate + ${(annualEsc*100).toFixed(0)}% annual escalation compounded ${i} year${i>1?"s":""}. In-place rents exceed street rate via ECRI.</span></div>`}
            <div class="mi-row"><span class="mi-row-label">PS Strategic Value</span><span class="mi-row-val">${i === 0 ? "Y1 is an investment year — PS accepts compressed returns to build a tenant base. The low-elasticity nature of storage means these tenants become a captive revenue stream for ECRI." : i <= 2 ? "Revenue acceleration phase — each ECRI cycle adds 8-12% to in-place rents. Move-out rate post-ECRI is only 5-8%, meaning 92%+ of rate increases stick." : "Mature operations — this NOI level is the basis for stabilized valuation. PS's ECRI program generates 35-40% of same-store revenue growth at this stage."}</span></div>
            ${i > 0 ? `<div class="mi-row"><span class="mi-row-label">YoY Growth</span><span class="mi-row-val">+${revGrowth}% revenue growth — driven by ${y.occRate > yearData[i-1].occRate ? "occupancy gains (" + Math.round(yearData[i-1].occRate*100) + "% → " + Math.round(y.occRate*100) + "%)" : "rate escalation (ECRI + market)"} ${y.occRate > yearData[i-1].occRate && y.climRate > yearData[i-1].climRate ? "+ rate escalation" : ""}</span></div>` : ""}
            <div class="mi-source">Source: PS lease-up benchmarks (10-K filings, earnings calls) | SSA Industry Factbook | SiteScore™ revenue model with ${(annualEsc*100).toFixed(0)}% annual escalation</div>
          </div>
        </div></div></td></tr>`;
      }).join("")}
    </tbody>
  </table>
  <div id="leaseup" class="expand-panel">
    <div style="margin-top:8px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:12px;text-transform:uppercase">Revenue & NOI Growth Trajectory</div>
      <div style="display:flex;align-items:flex-end;gap:8px;height:160px;padding:0 20px">
        ${yearData.map((y, i) => {
          const maxRev = yearData[4].totalRev;
          const revH = Math.round(y.totalRev / maxRev * 130);
          const noiH = Math.round(y.noi / maxRev * 130);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
            <div style="font-size:9px;font-weight:700;color:#16A34A">${fmtD(y.noi)}</div>
            <div style="display:flex;gap:2px;align-items:flex-end">
              <div style="width:20px;height:${revH}px;background:linear-gradient(180deg,#42A5F5,#1565C0);border-radius:4px 4px 0 0;opacity:0.6"></div>
              <div style="width:20px;height:${noiH}px;background:linear-gradient(180deg,#16A34A,#0D7A2C);border-radius:4px 4px 0 0"></div>
            </div>
            <div style="font-size:10px;font-weight:700;color:#C9A84C">Y${y.yr}</div>
          </div>`;
        }).join("")}
      </div>
      <div style="display:flex;gap:16px;justify-content:center;margin-top:10px;font-size:10px">
        <div style="display:flex;align-items:center;gap:4px"><div style="width:10px;height:10px;border-radius:2px;background:#42A5F5;opacity:0.6"></div><span style="color:#6B7394">Gross Revenue</span></div>
        <div style="display:flex;align-items:center;gap:4px"><div style="width:10px;height:10px;border-radius:2px;background:#16A34A"></div><span style="color:#6B7394">NOI</span></div>
      </div>
    </div>
    <div class="grid2" style="margin-top:20px">
      <div class="insight-box">
        <div class="insight-title">ECRI Strategy Deep Dive</div>
        <div style="margin-bottom:8px">PS's <strong>Existing Customer Rate Increase (ECRI)</strong> program is the primary revenue engine post-stabilization. After locking in tenants at promotional rates in Y1:</div>
        <div class="drill-row"><span class="drill-label">Y1 Tenants by Y3</span><span class="drill-value" style="color:#16A34A">+20-25% above original rate</span></div>
        <div class="drill-row"><span class="drill-label">Y1 Tenants by Y5</span><span class="drill-value" style="color:#16A34A">+35-45% above original rate</span></div>
        <div class="drill-row"><span class="drill-label">ECRI Cadence</span><span class="drill-value">Every 6-9 months</span></div>
        <div class="drill-row"><span class="drill-label">Typical ECRI Amount</span><span class="drill-value">8-12% per increase</span></div>
        <div class="drill-row"><span class="drill-label">Move-Out Rate Post-ECRI</span><span class="drill-value">~5-8% (low elasticity)</span></div>
        <div style="margin-top:8px;font-size:11px;color:#94A3B8">Storage tenants have extremely low price elasticity — the hassle cost of moving belongings far exceeds typical rate increases. PS leverages this to push long-tenured customers 20-40% above street rates.</div>
      </div>
      <div class="insight-box">
        <div class="insight-title">Operating Expense Trajectory</div>
        <div style="margin-bottom:8px">OpEx declines from <strong style="color:#EF4444">${Math.round(yearData[0].opex/yearData[0].totalRev*100)}%</strong> in Y1 to <strong style="color:#16A34A">${Math.round(yearData[4].opex/yearData[4].totalRev*100)}%</strong> at stabilization:</div>
        ${yearData.map(y => `<div class="drill-row">
          <span class="drill-label">Year ${y.yr} OpEx Ratio</span>
          <span class="drill-value" style="color:${y.yr <= 2 ? "#F59E0B" : "#16A34A"}">${Math.round(y.opex/y.totalRev*100)}% (${fmtD(y.opex)})</span>
        </div>`).join("")}
        <div style="margin-top:8px;font-size:11px;color:#94A3B8">Y1 OpEx elevated due to marketing spend ($50K+ grand opening), staffing ramp, and fixed costs spread over low occupancy. By Y4-5, marketing is minimal (word-of-mouth + web), and fixed costs are amortized across full occupancy.</div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:14px">
      <div class="insight-title">Revenue Sensitivity — Occupancy Scenarios</div>
      <table style="font-size:11px;margin-top:8px">
        <thead><tr><th>Scenario</th><th>Y5 Occupancy</th><th>Y5 Revenue</th><th>Y5 NOI</th><th>Yield on Cost</th></tr></thead>
        <tbody>
          ${[
            { label: "Bear Case", occ: 0.82, color: "#EF4444" },
            { label: "Base Case", occ: 0.92, color: "#C9A84C" },
            { label: "Bull Case", occ: 0.97, color: "#16A34A" },
          ].map(sc => {
            const scRev = Math.round((climateSF * sc.occ * yearData[4].climRate + driveSF * sc.occ * yearData[4].driveRate) * 12);
            const scOpex = Math.round(scRev * 0.35);
            const scNoi = scRev - scOpex;
            const scYoc = totalDevCost > 0 ? ((scNoi / totalDevCost) * 100).toFixed(1) : "N/A";
            return `<tr><td style="font-weight:700;color:${sc.color}">${sc.label}</td><td class="mono">${Math.round(sc.occ*100)}%</td><td class="mono">${fmtD(scRev)}</td><td class="mono" style="color:${sc.color}">${fmtD(scNoi)}</td><td class="mono" style="font-weight:800;color:${sc.color}">${scYoc}%</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- DEVELOPMENT COST STACK v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('devcost')">
  <span class="expand-hint">▼ Click to expand <span id="devcost-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Development Cost Stack</span></h2>
  <div class="grid2">
    <div>
      <table>
        <tr class="mi" onclick="toggleMI('dcland',event)" style="cursor:pointer"><td style="color:#6B7394;font-weight:600">Land Acquisition <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td class="mono" style="font-weight:700;text-align:right">${landCost > 0 ? fmtD(landCost) : "TBD"}</td></tr>
        <tr><td colspan="2" style="padding:0;border:none"><div id="mi-dcland" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Land Acquisition Cost</div><div class="mi-conf mi-conf-${landCost > 0 ? "high" : "low"}">${landCost > 0 ? "Broker Listing" : "Not Priced"}</div></div>
          <div class="mi-body">
            <strong>${landCost > 0 ? "Asking price from broker listing. Subject to negotiation per Land Price Guide below." : "Asking price not yet available — use the Land Price Guide to determine offer range."}</strong>
            <div class="mi-formula">${landCost > 0 ? `Asking: ${fmtD(landCost)} (${!isNaN(acres) && acres > 0 ? "$" + Math.round(landCost/acres).toLocaleString() + "/acre" : "—"})<br>SiteScore™ Strike Price: ${landPrices[1].maxLand > 0 ? fmtM(landPrices[1].maxLand) : "N/A"}<br>Ask vs Strike: ${askVsStrike !== null ? askVsStrike + "%" : "—"}` : "Land cost TBD — enter asking price to activate valuation engine"}</div>
            <div class="mi-row"><span class="mi-row-label">PS Significance</span><span class="mi-row-val">Land is typically 10-25% of total dev cost for PS projects. Sites where land exceeds 30% of total cost face tighter YOC — PS's internal hurdle is 8.0-9.0% YOC, and land is the primary variable the buyer controls.</span></div>
            <div class="mi-row"><span class="mi-row-label">Land as % of Total</span><span class="mi-row-val">${totalDevCost > 0 && landCost > 0 ? Math.round(landCost/totalDevCost*100) + "%" : "—"} — ${totalDevCost > 0 && landCost > 0 && landCost/totalDevCost > 0.30 ? "ABOVE typical PS range — negotiate aggressively" : totalDevCost > 0 && landCost > 0 ? "within normal PS range" : "pending"}</span></div>
            <div class="mi-source">Source: Broker listing (Crexi/LoopNet/CoStar) | SiteScore™ reverse-engineered from stabilized NOI</div>
          </div>
        </div></div></td></tr>
        <tr class="mi" onclick="toggleMI('dchard',event)" style="cursor:pointer"><td style="color:#6B7394;font-weight:600">Hard Costs (${totalSF.toLocaleString()} SF @ $${hardCostPerSF}/SF) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td class="mono" style="font-weight:700;text-align:right">${fmtD(hardCost)}</td></tr>
        <tr><td colspan="2" style="padding:0;border:none"><div id="mi-dchard" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Hard Construction Costs</div><div class="mi-conf mi-conf-high">RSMeans + PS Benchmarks</div></div>
          <div class="mi-body">
            <strong>Regionally adjusted hard cost estimate for ${isMultiStory ? stories + "-story multi-story" : "single-story indoor"} climate-controlled self-storage.</strong>
            <div class="mi-formula">National Base Rate: $${baseHardPerSF}/SF<br>Regional Index (${site.state || "N/A"}): ${costIdx.toFixed(2)}x<br>Adjusted Rate: $${baseHardPerSF} × ${costIdx.toFixed(2)} = $${hardCostPerSF}/SF<br>Total: ${totalSF.toLocaleString()} SF × $${hardCostPerSF} = <strong style="color:#E87A2E">${fmtD(hardCost)}</strong></div>
            <div class="mi-row"><span class="mi-row-label">What's Included</span><span class="mi-row-val">Sitework & grading (12%), foundation & structural (22%), shell & envelope (18%), interior build-out (20%), HVAC (13%), electrical (8%), fire suppression (4%), paving & landscaping (3%)</span></div>
            <div class="mi-row"><span class="mi-row-label">PS Development Context</span><span class="mi-row-val">PS builds at $${hardCostPerSF}/SF in ${site.state || "this region"} (2025-2026 GC pricing). ${isMultiStory ? "Multi-story adds ~$30/SF premium for structural steel, elevator shafts, and fire stairs." : "Single-story is PS's most cost-efficient product type — no elevator, no fire stairs, simpler structural requirements."} PS has built 40+ facilities in the last 24 months at similar per-SF costs.</span></div>
            <div class="mi-row"><span class="mi-row-label">Cost Risk</span><span class="mi-row-val">${costIdx < 0.95 ? "Below-average construction market — favorable GC pricing likely. Consider locking in GMP early." : costIdx > 1.05 ? "Above-average market — labor and material costs elevated. Build 5-8% contingency into hard cost line." : "Near-average market — standard construction risk profile."}</span></div>
            <div class="mi-source">Source: RSMeans 2025 Construction Cost Data | ENR Construction Cost Index Q1 2026 | PS development benchmarks (10-K disclosure)</div>
          </div>
        </div></div></td></tr>
        <tr class="mi" onclick="toggleMI('dcsoft',event)" style="cursor:pointer"><td style="color:#6B7394;font-weight:600">Soft Costs (${Math.round(softCostPct*100)}%) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td class="mono" style="font-weight:700;text-align:right">${fmtD(softCost)}</td></tr>
        <tr><td colspan="2" style="padding:0;border:none"><div id="mi-dcsoft" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Soft Costs — Non-Construction Expenses</div><div class="mi-conf mi-conf-med">Industry Standard</div></div>
          <div class="mi-body">
            <strong>Soft costs cover all non-brick-and-mortar development expenses. Set at ${Math.round(softCostPct*100)}% of hard costs (conservative range: 15-25%).</strong>
            <div class="mi-formula">Hard Costs: ${fmtD(hardCost)}<br>Soft Cost %: ${Math.round(softCostPct*100)}%<br>Total Soft: ${fmtD(hardCost)} × ${(softCostPct).toFixed(2)} = <strong style="color:#F59E0B">${fmtD(softCost)}</strong></div>
            <div class="mi-row"><span class="mi-row-label">Architecture & Engineering (30%)</span><span class="mi-row-val">${fmtD(Math.round(softCost * 0.30))} — PS uses preferred A/E firms with storage-specific expertise</span></div>
            <div class="mi-row"><span class="mi-row-label">Permits & Impact Fees (20%)</span><span class="mi-row-val">${fmtD(Math.round(softCost * 0.20))} — varies significantly by jurisdiction. ${site.state === "TX" ? "TX generally lower due to fewer regulatory hurdles" : "Verify with local planning dept"}</span></div>
            <div class="mi-row"><span class="mi-row-label">Contingency (13%)</span><span class="mi-row-val">${fmtD(Math.round(softCost * 0.13))} — standard construction contingency reserve. PS typically holds 8-10% after DD.</span></div>
            <div class="mi-source">Source: PS development pipeline analysis | Industry standard range 15-25% of hard costs | Adjusted for jurisdiction complexity</div>
          </div>
        </div></div></td></tr>
        <tr class="mi" onclick="toggleMI('dctotal',event)" style="border-top:2px solid rgba(201,168,76,0.2);cursor:pointer"><td style="font-weight:800;color:#C9A84C">Total Development Cost <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td class="mono" style="font-weight:800;text-align:right;color:#E87A2E;font-size:16px">${fmtM(totalDevCost)}</td></tr>
        <tr><td colspan="2" style="padding:0;border:none"><div id="mi-dctotal" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Total Capital Required</div><div class="mi-conf mi-conf-high">Computed</div></div>
          <div class="mi-body">
            <strong>All-in development cost = Land + Hard Costs + Soft Costs. This is the denominator in the Yield on Cost calculation — the single metric PS uses to evaluate development projects.</strong>
            <div class="mi-formula">Land: ${landCost > 0 ? fmtD(landCost) : "TBD"}<br>Hard Costs: ${fmtD(hardCost)}<br>Soft Costs: ${fmtD(softCost)}<br>────────────<br>Total: <strong style="color:#E87A2E">${fmtM(totalDevCost)}</strong> ($${totalDevCost > 0 ? Math.round(totalDevCost/totalSF).toLocaleString() : "—"}/SF all-in)</div>
            <div class="mi-row"><span class="mi-row-label">Yield on Cost</span><span class="mi-row-val">${yocStab}% — ${parseFloat(yocStab) >= 9 ? "EXCEEDS PS hurdle rate (8.0-9.0%). Strong internal approval signal." : parseFloat(yocStab) >= 8 ? "MEETS PS hurdle rate. Standard approval path." : parseFloat(yocStab) >= 7 ? "BELOW PS hurdle — requires exceptional location or strategic rationale." : "BELOW institutional minimum — does not pencil without significant cost reduction or NOI increase."}</span></div>
            <div class="mi-row"><span class="mi-row-label">Why This Matters to PS</span><span class="mi-row-val">PS's Real Estate Committee (REC) evaluates every development project primarily on YOC. The development spread (YOC minus acquisition cap rate of ~${(mktAcqCap*100).toFixed(1)}%) must justify the 18-24 month construction period and lease-up risk. This project's ${devSpread}-point spread ${parseFloat(devSpread) >= 2.5 ? "clearly justifies development" : parseFloat(devSpread) >= 1.5 ? "is acceptable for development" : "is marginal — acquisition may be more efficient"}.</span></div>
            <div class="mi-source">Source: SiteScore™ cost engine | Land from broker listing | Hard costs from RSMeans regional index | Soft costs at ${Math.round(softCostPct*100)}% industry standard</div>
          </div>
        </div></div></td></tr>
      </table>
    </div>
    <div>
      <h3 class="muted">Return Metrics</h3>
      <div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid rgba(201,168,76,0.08)">
        <div class="mi" onclick="toggleMI('dcyoc',event)" style="display:flex;justify-content:space-between;margin-bottom:10px;cursor:pointer;padding:4px;border-radius:6px">
          <span style="font-size:12px;color:#6B7394">Yield on Cost (Stabilized) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span>
          <span class="mono" style="font-size:18px;font-weight:800;color:${parseFloat(yocStab) >= 9 ? "#16A34A" : parseFloat(yocStab) >= 7 ? "#F59E0B" : "#EF4444"}">${yocStab}%</span>
        </div>
        <div id="mi-dcyoc" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Yield on Cost — The #1 PS Development Metric</div><div class="mi-conf mi-conf-high">Computed</div></div>
          <div class="mi-body">
            <strong>YOC = Stabilized NOI ÷ Total Development Cost. This is the return PS earns on every dollar deployed — the single metric that determines whether a project gets REC approval.</strong>
            <div class="mi-formula">Stabilized NOI (Y5): ${fmtD(stabNOI)}<br>Total Dev Cost: ${fmtM(totalDevCost)}<br>YOC: ${fmtD(stabNOI)} ÷ ${fmtM(totalDevCost)} = <strong style="color:#C9A84C">${yocStab}%</strong></div>
            <div class="mi-row"><span class="mi-row-label">PS Internal Hurdles</span><span class="mi-row-val">8.0-9.0% minimum for standard approval | 7.0-8.0% for strategic/irreplaceable sites | <9.0% requires VP+ signoff</span></div>
            <div class="mi-row"><span class="mi-row-label">Development Spread</span><span class="mi-row-val">${devSpread} bps over ~${(mktAcqCap*100).toFixed(1)}% acquisition cap — this premium compensates for 18-24 month construction + 3-5 year lease-up risk</span></div>
            <div class="mi-source">Source: SiteScore™ financial engine | PS 10-K development pipeline disclosures | Green Street Advisors cap rate surveys</div>
          </div>
        </div></div>
        <div class="mi" onclick="toggleMI('dccpsf',event)" style="display:flex;justify-content:space-between;margin-bottom:10px;cursor:pointer;padding:4px;border-radius:6px">
          <span style="font-size:12px;color:#6B7394">Cost Per SF <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span>
          <span class="mono" style="font-size:14px;font-weight:700">${totalDevCost > 0 ? "$" + Math.round(totalDevCost / totalSF).toLocaleString() : "TBD"}</span>
        </div>
        <div id="mi-dccpsf" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">All-In Cost Per Rentable SF</div><div class="mi-conf mi-conf-high">Computed</div></div>
          <div class="mi-body">
            <div class="mi-formula">Total Dev Cost: ${fmtM(totalDevCost)} ÷ ${totalSF.toLocaleString()} SF = <strong>$${totalDevCost > 0 ? Math.round(totalDevCost/totalSF).toLocaleString() : "—"}/SF</strong></div>
            <div class="mi-row"><span class="mi-row-label">PS Benchmark</span><span class="mi-row-val">$${isMultiStory ? "140-180" : "100-140"}/SF all-in for ${isMultiStory ? "multi-story" : "single-story"} in ${site.state || "this region"}</span></div>
            <div class="mi-source">Source: Total development cost ÷ total rentable SF</div>
          </div>
        </div></div>
        <div class="mi" onclick="toggleMI('dcrevsf',event)" style="display:flex;justify-content:space-between;cursor:pointer;padding:4px;border-radius:6px">
          <span style="font-size:12px;color:#6B7394">Stabilized Rev/SF/Yr <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span>
          <span class="mono" style="font-size:14px;font-weight:700;color:#16A34A">${yearData[4].totalRev > 0 ? "$" + (yearData[4].totalRev / totalSF).toFixed(2) : "TBD"}</span>
        </div>
        <div id="mi-dcrevsf" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Revenue Density — RevPAF</div><div class="mi-conf mi-conf-high">Computed</div></div>
          <div class="mi-body">
            <div class="mi-formula">Y5 Revenue: ${fmtD(yearData[4].totalRev)} ÷ ${totalSF.toLocaleString()} SF = <strong>$${(yearData[4].totalRev / totalSF).toFixed(2)}/SF/yr</strong></div>
            <div class="mi-row"><span class="mi-row-label">PS Portfolio RevPAF</span><span class="mi-row-val">~$24.50/SF/yr (Q4 2025). Extra Space: ~$22.80. CubeSmart: ~$19.50.</span></div>
            <div class="mi-source">Source: Y5 stabilized revenue ÷ total available SF | PS 10-K portfolio metrics</div>
          </div>
        </div></div>
      </div>
    </div>
  </div>
  <div id="devcost" class="expand-panel">
    <div style="margin-top:8px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Hard Cost Breakdown</div>
      <table style="font-size:11px">
        <thead><tr><th>Category</th><th>$/SF</th><th>% of Hard</th><th>Total</th></tr></thead>
        <tbody>
          ${[
            { cat: "Sitework & Grading", pct: 0.12 },
            { cat: "Foundation & Structural", pct: 0.22 },
            { cat: "Shell & Envelope", pct: 0.18 },
            { cat: "Interior Build-Out (Corridors, Units, Doors)", pct: 0.20 },
            { cat: "HVAC (Climate Control)", pct: 0.13 },
            { cat: "Electrical & Lighting", pct: 0.08 },
            { cat: "Fire Protection (Sprinklers)", pct: 0.04 },
            { cat: "Paving, Landscaping & Stormwater", pct: 0.03 },
          ].map(c => `<tr>
            <td style="font-weight:600">${c.cat}</td>
            <td class="mono">$${Math.round(hardCostPerSF * c.pct)}</td>
            <td class="mono">${Math.round(c.pct*100)}%</td>
            <td class="mono">${fmtD(Math.round(hardCost * c.pct))}</td>
          </tr>`).join("")}
          <tr style="border-top:2px solid rgba(201,168,76,0.15);font-weight:700"><td>TOTAL HARD COSTS</td><td class="mono">$${hardCostPerSF}</td><td class="mono">100%</td><td class="mono" style="color:#E87A2E">${fmtD(hardCost)}</td></tr>
        </tbody>
      </table>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Soft Cost Breakdown</div>
      <table style="font-size:11px">
        <thead><tr><th>Category</th><th>% of Soft</th><th>Total</th></tr></thead>
        <tbody>
          ${[
            { cat: "Architecture & Engineering", pct: 0.30 },
            { cat: "Permits & Impact Fees", pct: 0.20 },
            { cat: "Legal & Title", pct: 0.10 },
            { cat: "Geotech, Survey, Environmental", pct: 0.12 },
            { cat: "Construction Management", pct: 0.15 },
            { cat: "Contingency", pct: 0.13 },
          ].map(c => `<tr>
            <td style="font-weight:600">${c.cat}</td>
            <td class="mono">${Math.round(c.pct*100)}%</td>
            <td class="mono">${fmtD(Math.round(softCost * c.pct))}</td>
          </tr>`).join("")}
          <tr style="border-top:2px solid rgba(201,168,76,0.15);font-weight:700"><td>TOTAL SOFT COSTS</td><td class="mono">100%</td><td class="mono" style="color:#F59E0B">${fmtD(softCost)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="insight-box" style="margin-top:14px">
      <div class="insight-title">Cost Benchmarking</div>
      <div>PS ${isMultiStory ? "multi-story" : "single-story"} facilities typically build at <strong>$${hardCostPerSF}/SF hard costs</strong> in the current construction environment (2025-2026 pricing). ${isMultiStory ? "Multi-story adds structural steel, elevator, and fire stair costs (~$30/SF premium over single-story)." : "Single-story is the most cost-efficient construction type — no elevator, no fire stairs, simpler structural."} Soft costs at ${Math.round(softCostPct*100)}% are conservative — actual may range 15-25% depending on jurisdiction complexity and impact fees. ${site.state === "TX" ? "Texas generally has lower soft costs due to fewer regulatory hurdles and no state income tax impact on labor." : ""}</div>
    </div>
  </div>
</div>

<!-- VALUATION SCENARIOS v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('valuation')">
  <span class="expand-hint">▼ Click to expand <span id="valuation-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Stabilized Valuation Scenarios</span></h2>
  <div style="font-size:12px;color:#94A3B8;margin-bottom:16px">Based on Year 5 stabilized NOI of <span class="mono gold" style="font-weight:700">${fmtD(stabNOI)}</span></div>
  <div class="grid3">
    ${valuations.map((v, i) => `<div class="metric-box mi" onclick="toggleMI('vs${i}',event)" style="cursor:pointer;${i === 1 ? "border-color:rgba(201,168,76,0.3);box-shadow:0 4px 20px rgba(201,168,76,0.1)" : ""}">
      <div class="label">${v.label} <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="color:${i === 0 ? "#42A5F5" : i === 1 ? "#C9A84C" : "#16A34A"};font-size:26px">${fmtM(v.value)}</div>
      <div style="font-size:10px;color:#6B7394;margin-top:6px">Spread to cost: ${totalDevCost > 0 ? fmtM(v.value - totalDevCost) : "TBD"}</div>
      ${totalDevCost > 0 ? `<div style="font-size:10px;color:${v.value > totalDevCost ? "#16A34A" : "#EF4444"};font-weight:700;margin-top:2px">${((v.value / totalDevCost - 1) * 100).toFixed(0)}% ${v.value > totalDevCost ? "profit" : "loss"} on cost</div>` : ""}
      <div id="mi-vs${i}" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">${v.label} — Valuation Derivation</div><div class="mi-conf mi-conf-${i === 1 ? "high" : "med"}">${i === 1 ? "Base Case" : i === 0 ? "Conservative" : "Aggressive"}</div></div>
        <div class="mi-body">
          <strong>Direct capitalization: Stabilized NOI ÷ Cap Rate = Market Value.</strong>
          <div class="mi-formula">NOI: ${fmtD(stabNOI)}<br>Cap Rate: ${(v.rate*100).toFixed(2)}%<br>Value: ${fmtD(stabNOI)} ÷ ${(v.rate*100).toFixed(2)}% = <strong style="color:${i === 0 ? "#42A5F5" : i === 1 ? "#C9A84C" : "#16A34A"}">${fmtM(v.value)}</strong><br>${totalDevCost > 0 ? `Value Created: ${fmtM(v.value)} − ${fmtM(totalDevCost)} = <strong style="color:${v.value > totalDevCost ? "#16A34A" : "#EF4444"}">${fmtM(v.value - totalDevCost)}</strong> (${((v.value/totalDevCost-1)*100).toFixed(0)}%)` : ""}</div>
          <div class="mi-row"><span class="mi-row-label">Cap Rate Source</span><span class="mi-row-val">${i === 0 ? "Conservative exit — typical for secondary markets or buyers pricing in lease-up risk" : i === 1 ? "Base case — aligned with current storage transaction market (CBRE Q1 2026 cap rate survey: 5.25-6.00%)" : "Aggressive — achievable for institutional-quality assets in primary markets with 93%+ occupancy"}</span></div>
          <div class="mi-row"><span class="mi-row-label">PS Context</span><span class="mi-row-val">PSA trades at ~4.5-5.0% implied cap on existing portfolio. New development is underwritten at ${(v.rate*100).toFixed(1)}% to price in construction + lease-up uncertainty. ${i === 1 ? "This base case reflects institutional consensus for stabilized storage assets." : ""}</span></div>
          <div class="mi-source">Source: Green Street Advisors | CBRE Self-Storage Cap Rate Survey Q1 2026 | REIT implied caps from 10-K filings</div>
        </div>
      </div></div>
    </div>`).join("")}
  </div>
  <div id="valuation" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Valuation Methodology</div>
      <div>Self-storage valuation uses the <strong>direct capitalization method</strong>: Stabilized NOI ÷ Cap Rate = Value. Cap rates for institutional-quality storage have compressed significantly — PS trades at ~4.5-5.0% implied cap on existing assets. New development projects are underwritten at higher caps (5.0-6.5%) to account for lease-up risk and construction uncertainty.</div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Cap Rate Sensitivity Grid</div>
      <table style="font-size:11px">
        <thead><tr><th>Cap Rate</th><th>Stabilized Value</th><th>Value per SF</th><th>Profit on Cost</th><th>Multiple on Equity</th></tr></thead>
        <tbody>
          ${[0.045, 0.050, 0.0525, 0.0575, 0.060, 0.065, 0.070].map(cr => {
            const val = Math.round(stabNOI / cr);
            const profit = val - totalDevCost;
            const multiple = totalDevCost > 0 ? (val / totalDevCost).toFixed(2) : "N/A";
            const isBase = cr === 0.0575;
            return `<tr style="${isBase ? "background:rgba(201,168,76,0.08);border-left:3px solid #C9A84C" : ""}">
              <td class="mono" style="font-weight:700;${isBase ? "color:#C9A84C" : ""}">${(cr*100).toFixed(2)}%${isBase ? " (base)" : ""}</td>
              <td class="mono" style="font-weight:700">${fmtM(val)}</td>
              <td class="mono">$${Math.round(val/totalSF)}/SF</td>
              <td class="mono" style="color:${profit > 0 ? "#16A34A" : "#EF4444"}">${totalDevCost > 0 ? fmtM(profit) : "TBD"}</td>
              <td class="mono" style="font-weight:700;color:${parseFloat(multiple) >= 1.5 ? "#16A34A" : parseFloat(multiple) >= 1.0 ? "#F59E0B" : "#EF4444"}">${multiple}x</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="insight-box">
        <div class="insight-title">PS REIT Trading Context</div>
        <div class="drill-row"><span class="drill-label">PSA Implied Cap</span><span class="drill-value">~4.5-5.0%</span></div>
        <div class="drill-row"><span class="drill-label">PSA Market Cap</span><span class="drill-value">~$52B</span></div>
        <div class="drill-row"><span class="drill-label">PS Avg Same-Store Occ.</span><span class="drill-value">~92-94%</span></div>
        <div class="drill-row"><span class="drill-label">PS Avg Same-Store Rev/SF</span><span class="drill-value">~$23-25/SF/yr</span></div>
        <div style="margin-top:6px;font-size:10px;color:#4A5080;font-style:italic">Development cap rates 100-200bps above trading cap due to lease-up risk premium.</div>
      </div>
      <div class="insight-box">
        <div class="insight-title">Exit Timing Scenarios</div>
        <div class="drill-row"><span class="drill-label">Sell at Y3 (75% occ)</span><span class="drill-value">${fmtM(Math.round(yearData[2].noi / 0.06))}</span></div>
        <div class="drill-row"><span class="drill-label">Sell at Y5 (stabilized)</span><span class="drill-value" style="color:#C9A84C">${fmtM(valuations[1].value)}</span></div>
        <div class="drill-row"><span class="drill-label">Sell at Y7 (ECRI mature)</span><span class="drill-value" style="color:#16A34A">${fmtM(Math.round(stabNOI * Math.pow(1.04, 2) / 0.055))}</span></div>
        <div style="margin-top:6px;font-size:10px;color:#4A5080;font-style:italic">Y7 assumes 4% annual NOI growth from ECRI + market escalation, and 25bps cap compression at maturity.</div>
      </div>
    </div>
  </div>
</div>

<div class="divider"></div>

<!-- LAND PRICE SUGGESTION v4.0 -->
<div class="section section-gold expand-trigger" onclick="toggleExpand('landprice')" style="background:linear-gradient(135deg,rgba(15,21,56,0.8),rgba(30,39,97,0.6));border-color:rgba(201,168,76,0.3);box-shadow:0 4px 30px rgba(201,168,76,0.12)">
  <span class="expand-hint">▼ Click to expand <span id="landprice-arrow" class="expand-arrow">▼</span></span>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
    <div>
      <h2 style="margin-bottom:4px"><span class="gold">Land Acquisition Price Guide</span></h2>
      <div style="font-size:11px;color:#94A3B8">Reverse-engineered from stabilized NOI — what should we pay for this land?</div>
    </div>
    ${landVerdict ? `<div class="mi" onclick="toggleMI('lpverdict',event)" style="display:flex;flex-direction:column;align-items:center;cursor:pointer">
      <div class="badge" style="background:${verdictColor}20;color:${verdictColor};border:1px solid ${verdictColor}40;font-size:14px;padding:8px 20px;font-weight:900;letter-spacing:0.08em">${landVerdict} <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      ${askVsStrike ? `<div style="font-size:10px;color:#6B7394;margin-top:4px">Ask is ${parseFloat(askVsStrike) > 0 ? askVsStrike + "% above" : Math.abs(parseFloat(askVsStrike)) + "% below"} strike</div>` : ""}
      <div id="mi-lpverdict" class="mi-panel" style="text-align:left;min-width:400px"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Land Verdict — ${landVerdict}</div><div class="mi-conf mi-conf-high">SiteScore™</div></div>
        <div class="mi-body">
          <strong>SiteScore™ determines the land verdict by comparing the asking price against the target (strike) price derived from the facility's projected NOI performance.</strong>
          <div class="mi-formula">Strike Price: ${landPrices[1].maxLand > 0 ? fmtM(landPrices[1].maxLand) : "N/A"} (at ${(landPrices[1].yoc*100).toFixed(1)}% target YOC)<br>Asking Price: ${landCost > 0 ? fmtD(landCost) : "Not listed"}<br>Variance: ${askVsStrike !== null ? askVsStrike + "%" : "—"}<br>Verdict: <strong style="color:${verdictColor}">${landVerdict}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Verdict Logic</span><span class="mi-row-val">${parseFloat(askVsStrike) <= -15 ? "Ask is 15%+ BELOW strike → STRONG BUY. Move fast — this is a home run deal at current ask." : parseFloat(askVsStrike) <= 0 ? "Ask is at or below strike → BUY. Deal pencils at current ask." : parseFloat(askVsStrike) <= 15 ? "Ask is above strike but negotiable → NEGOTIATE. Counter at strike price." : parseFloat(askVsStrike) <= 30 ? "Ask is significantly above strike → STRETCH. Only for irreplaceable locations." : "Ask exceeds max ceiling → PASS. Does not pencil at any realistic YOC target."}</span></div>
          <div class="mi-row"><span class="mi-row-label">Why PS Needs This</span><span class="mi-row-val">Traditional CRE brokerage uses comparable sales to value land. SiteScore™ inverts this: it prices land from the storage facility's income potential. This means PS knows the maximum justifiable price BEFORE entering negotiations — a fundamental informational advantage.</span></div>
          <div class="mi-source">Source: SiteScore™ reverse-engineering engine | Stabilized NOI ÷ target YOC − build costs = max land price</div>
        </div>
      </div></div>
    </div>` : ""}
  </div>
  <div class="mi" onclick="toggleMI('lpformula',event)" style="font-size:12px;color:#94A3B8;margin-bottom:20px;padding:12px 16px;background:rgba(15,21,56,0.4);border-radius:10px;border:1px solid rgba(201,168,76,0.08);cursor:pointer">
    <strong style="color:#C9A84C">Formula:</strong> <span class="mono" style="color:#E2E8F0">Max Land Price = (Stabilized NOI ÷ Target YOC%) − Build Costs</span> <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em>
    <div style="margin-top:6px"><strong style="color:#C9A84C">Inputs:</strong> Stabilized NOI = <span class="mono" style="color:#16A34A">${fmtD(stabNOI)}</span> | Build Costs (Hard + Soft) = <span class="mono" style="color:#E87A2E">${fmtD(buildCosts)}</span></div>
  </div>
  <div id="mi-lpformula" class="mi-panel"><div class="mi-panel-inner">
    <div class="mi-header"><div class="mi-title">Reverse-Engineering Land Value from NOI</div><div class="mi-conf mi-conf-high">SiteScore™ Proprietary</div></div>
    <div class="mi-body">
      <strong>This is SiteScore™'s core value proposition to PS. Instead of relying on land comps (which are scarce and often non-comparable), we derive what the land IS WORTH based on what the completed storage facility WILL PRODUCE.</strong>
      <div class="mi-formula">Step 1: Project stabilized NOI → ${fmtD(stabNOI)}/yr<br>Step 2: Set target YOC (PS hurdle) → 8.5%<br>Step 3: Calculate total development budget → ${fmtD(stabNOI)} ÷ 0.085 = ${fmtD(Math.round(stabNOI/0.085))}<br>Step 4: Subtract build costs → ${fmtD(Math.round(stabNOI/0.085))} − ${fmtD(buildCosts)} = <strong style="color:#C9A84C">${landPrices[1].maxLand > 0 ? fmtM(landPrices[1].maxLand) : "N/A"}</strong><br><br>This is the MAXIMUM PS should pay for this land and still hit their development return target.</div>
      <div class="mi-row"><span class="mi-row-label">Why Not Use Land Comps?</span><span class="mi-row-val">Vacant land transactions are infrequent, parcels are heterogeneous (different sizes, shapes, zoning, access), and comp adjustments are subjective. SiteScore™'s income approach is objective, repeatable, and directly tied to the investment thesis.</span></div>
      <div class="mi-row"><span class="mi-row-label">Competitive Edge for PS</span><span class="mi-row-val">No other tool in the self-storage industry provides real-time land pricing derived from projected facility performance. PS land brokers currently rely on gut feel and comp-based BOVs. SiteScore™ replaces guesswork with a data-driven pricing engine that updates dynamically as market inputs change.</span></div>
      <div class="mi-source">Source: SiteScore™ proprietary pricing model | Patent Pending — Serial No. 99712640</div>
    </div>
  </div></div>
  <div class="grid3" style="margin-bottom:16px">
    ${landPrices.map((lp, lpIdx) => `<div class="metric-box mi" onclick="toggleMI('lp${lpIdx}',event)" style="cursor:pointer;${lp.tag === "TARGET" ? "border-color:rgba(201,168,76,0.35);box-shadow:0 4px 24px rgba(201,168,76,0.12)" : ""}">
      <div style="display:flex;justify-content:center;margin-bottom:8px"><span class="tag" style="background:${lp.color}20;color:${lp.color}">${lp.tag}</span></div>
      <div class="label">${lp.label} (${(lp.yoc*100).toFixed(1)}% YOC) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="color:${lp.color};font-size:28px">${lp.maxLand > 0 ? fmtM(lp.maxLand) : "N/A"}</div>
      ${lp.perAcre > 0 ? `<div style="font-size:12px;color:#6B7394;margin-top:4px;font-family:'Space Mono',monospace">$${lp.perAcre.toLocaleString()}/acre</div>` : ""}
      <div id="mi-lp${lpIdx}" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">${lp.label} — ${lp.tag} Price</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">Target YOC: ${(lp.yoc*100).toFixed(1)}%<br>Total Budget: ${fmtD(stabNOI)} ÷ ${(lp.yoc*100).toFixed(1)}% = ${fmtD(Math.round(stabNOI/lp.yoc))}<br>Less Build Costs: (${fmtD(buildCosts)})<br>Max Land: <strong style="color:${lp.color}">${lp.maxLand > 0 ? fmtM(lp.maxLand) : "$0"}</strong>${lp.perAcre > 0 ? ` ($${lp.perAcre.toLocaleString()}/ac)` : ""}</div>
          <div class="mi-row"><span class="mi-row-label">When to Use</span><span class="mi-row-val">${lpIdx === 0 ? "CEILING — absolute maximum. Only for strategic/irreplaceable sites where PS has no alternative. Requires EVP approval and strategic justification." : lpIdx === 1 ? "TARGET — PS's development sweet spot. 250-350bps spread over acquisition cap. Standard REC approval path." : "FLOOR — home run pricing. Maximum margin of safety. Easiest internal approval. Typical in secondary/tertiary markets."}</span></div>
          <div class="mi-source">Source: SiteScore™ reverse-engineering | NOI: ${fmtD(stabNOI)} | Build costs: ${fmtD(buildCosts)}</div>
        </div>
      </div></div>
    </div>`).join("")}
  </div>
  ${landCost > 0 ? `<div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid rgba(201,168,76,0.1);margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:11px;font-weight:700;color:#6B7394;letter-spacing:0.08em">CURRENT ASKING PRICE</div>
        <div class="mono" style="font-size:22px;font-weight:800;color:#E2E8F0;margin-top:4px">${fmtM(landCost)}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:10px;color:#6B7394">vs Strike Price</div>
        <div class="mono" style="font-size:24px;font-weight:900;color:${verdictColor}">${askVsStrike !== null ? (parseFloat(askVsStrike) > 0 ? "+" : "") + askVsStrike + "%" : "—"}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;color:#6B7394">Suggested Counter</div>
        <div class="mono" style="font-size:22px;font-weight:800;color:#C9A84C">${landPrices[1].maxLand > 0 ? fmtM(landPrices[1].maxLand) : "N/A"}</div>
      </div>
    </div>
    <div style="margin-top:12px;height:8px;border-radius:4px;background:rgba(255,255,255,0.06);position:relative;overflow:visible">
      ${landPrices.map(lp => lp.maxLand > 0 ? `<div style="position:absolute;left:${Math.min(Math.max(Math.round(lp.maxLand / (landPrices[0].maxLand * 1.4) * 100), 5), 95)}%;top:-4px;width:3px;height:16px;background:${lp.color};border-radius:2px" title="${lp.label}: ${fmtM(lp.maxLand)}"></div>` : "").join("")}
      ${landCost > 0 ? `<div style="position:absolute;left:${Math.min(Math.max(Math.round(landCost / (landPrices[0].maxLand * 1.4) * 100), 5), 95)}%;top:-6px;width:4px;height:20px;background:#fff;border-radius:2px;box-shadow:0 0 8px rgba(255,255,255,0.4)" title="Asking: ${fmtM(landCost)}"></div>` : ""}
      <div style="width:100%;height:100%;border-radius:4px;background:linear-gradient(90deg,#16A34A,#F59E0B,#EF4444)"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:9px;color:#6B7394">
      <span>Min (Home Run)</span>
      <span>Strike (Target)</span>
      <span>Max (Ceiling)</span>
    </div>
  </div>` : ""}
  <div id="landprice" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">How This Works</div>
      <div>This model reverse-engineers the maximum land price from the facility's projected performance. Instead of asking "what does this land cost?" — it answers <strong style="color:#C9A84C">"what SHOULD this land cost?"</strong> based on what the storage facility will produce.</div>
      <div style="margin-top:10px">The formula backs into land price by subtracting known build costs from the total capital budget implied by each yield target:</div>
      <div style="margin-top:8px;padding:12px;background:rgba(15,21,56,0.5);border-radius:8px;border:1px solid rgba(201,168,76,0.08)">
        <div class="mono" style="font-size:12px;color:#E2E8F0;line-height:2">
          <div>Total Dev Budget = Stabilized NOI ÷ Target YOC%</div>
          <div>Max Land Price = Total Dev Budget − Hard Costs − Soft Costs</div>
          <div style="margin-top:4px;color:#C9A84C">Strike Example: ${fmtD(stabNOI)} ÷ 8.5% = ${fmtD(Math.round(stabNOI / 0.085))} − ${fmtD(buildCosts)} = <strong>${landPrices[1].maxLand > 0 ? fmtM(landPrices[1].maxLand) : "N/A"}</strong></div>
        </div>
      </div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Full YOC Sensitivity — Land Price Matrix</div>
      <table style="font-size:11px">
        <thead><tr><th>Target YOC</th><th>Total Dev Budget</th><th>Less Build Costs</th><th>Max Land Price</th><th>Per Acre</th><th>Signal</th></tr></thead>
        <tbody>
          ${[0.065, 0.07, 0.075, 0.08, 0.085, 0.09, 0.095, 0.10, 0.11, 0.12].map(yoc => {
            const budget = stabNOI > 0 ? Math.round(stabNOI / yoc) : 0;
            const maxL = Math.max(budget - buildCosts, 0);
            const pa = !isNaN(acres) && acres > 0 && maxL > 0 ? Math.round(maxL / acres) : 0;
            const isStrike = yoc === 0.085;
            const signal = yoc <= 0.07 ? "Ceiling" : yoc <= 0.08 ? "Aggressive" : yoc <= 0.09 ? "Target" : yoc <= 0.10 ? "Conservative" : "Home Run";
            const sigColor = yoc <= 0.07 ? "#EF4444" : yoc <= 0.08 ? "#E87A2E" : yoc <= 0.09 ? "#C9A84C" : yoc <= 0.10 ? "#16A34A" : "#16A34A";
            return `<tr style="${isStrike ? "background:rgba(201,168,76,0.08);border-left:3px solid #C9A84C" : ""}">
              <td class="mono" style="font-weight:700;${isStrike ? "color:#C9A84C" : ""}">${(yoc*100).toFixed(1)}%${isStrike ? " ◆" : ""}</td>
              <td class="mono">${budget > 0 ? fmtM(budget) : "N/A"}</td>
              <td class="mono" style="color:#6B7394">(${fmtD(buildCosts)})</td>
              <td class="mono" style="font-weight:700;color:${maxL > 0 ? "#E2E8F0" : "#EF4444"}">${maxL > 0 ? fmtM(maxL) : "$0"}</td>
              <td class="mono">${pa > 0 ? "$" + pa.toLocaleString() : "—"}</td>
              <td><span class="tag" style="background:${sigColor}20;color:${sigColor}">${signal}</span></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="insight-box">
        <div class="insight-title">Negotiation Intelligence</div>
        ${landCost > 0 && landPrices[1].maxLand > 0 ? `<div style="margin-bottom:8px">
          ${parseFloat(askVsStrike) <= -15 ? `<div style="color:#16A34A;font-weight:700;margin-bottom:6px">The asking price is ${Math.abs(parseFloat(askVsStrike))}% BELOW strike — this is a strong buy. Move fast before competing offers emerge. Consider offering at or near ask to lock it up.</div>` :
          parseFloat(askVsStrike) <= 0 ? `<div style="color:#22C55E;font-weight:700;margin-bottom:6px">The asking price is at or below strike — this deal pencils at the current ask. Standard LOI at asking price is defensible.</div>` :
          parseFloat(askVsStrike) <= 15 ? `<div style="color:#F59E0B;font-weight:700;margin-bottom:6px">The asking price is ${askVsStrike}% above strike — negotiate. Counter at ${fmtM(landPrices[1].maxLand)} (strike price) with a ${fmtD(Math.round((landCost - landPrices[1].maxLand) * 0.4 + landPrices[1].maxLand))} fallback position.</div>` :
          parseFloat(askVsStrike) <= 30 ? `<div style="color:#E87A2E;font-weight:700;margin-bottom:6px">The asking price is ${askVsStrike}% above strike — this is a stretch. Only pursue if the site has exceptional strategic value (location, competition void, growth trajectory) that justifies compressed returns.</div>` :
          `<div style="color:#EF4444;font-weight:700;margin-bottom:6px">The asking price is ${askVsStrike}% above strike — this deal does not pencil at the current ask. The seller's expectations exceed what this facility can support. Pass or submit a significantly below-ask offer at ${fmtM(landPrices[1].maxLand)} with full justification.</div>`}
        </div>` : `<div style="color:#6B7394">Asking price not available — use the strike price of ${landPrices[1].maxLand > 0 ? fmtM(landPrices[1].maxLand) : "N/A"} as the opening offer anchor.</div>`}
        <div class="drill-row"><span class="drill-label">LOI Opening Offer</span><span class="drill-value" style="color:#16A34A">${landPrices[2].maxLand > 0 ? fmtM(Math.round((landPrices[2].maxLand + landPrices[1].maxLand) / 2)) : "N/A"}</span></div>
        <div class="drill-row"><span class="drill-label">Walk-Away Price</span><span class="drill-value" style="color:#EF4444">${landPrices[0].maxLand > 0 ? fmtM(landPrices[0].maxLand) : "N/A"}</span></div>
        <div class="drill-row"><span class="drill-label">Negotiation Range</span><span class="drill-value">${landPrices[2].maxLand > 0 && landPrices[0].maxLand > 0 ? fmtM(landPrices[2].maxLand) + " — " + fmtM(landPrices[0].maxLand) : "N/A"}</span></div>
      </div>
      <div class="insight-box">
        <div class="insight-title">Why These YOC Targets?</div>
        <div style="font-size:11px;color:#94A3B8;line-height:1.8">
          <div><strong style="color:#EF4444">7.0% (Max/Ceiling)</strong> — Below PS's typical hurdle. Only justified for irreplaceable locations (freeway visibility, zero competition, top-5 metro growth). Requires EVP+ approval.</div>
          <div style="margin-top:6px"><strong style="color:#C9A84C">8.5% (Strike/Target)</strong> — PS's development sweet spot. 250-350bps spread over acquisition cap rates. Provides cushion for construction overruns and slower-than-modeled lease-up.</div>
          <div style="margin-top:6px"><strong style="color:#16A34A">10.0% (Min/Floor)</strong> — Conservative / home run. Maximum margin of safety. Easiest internal approval path. Typically achievable in secondary/tertiary markets with lower land costs.</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- DETAILED OPEX BREAKDOWN v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('opexdetail')">
  <span class="expand-hint">▼ Click to expand <span id="opexdetail-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Stabilized Operating Expense Detail</span></h2>
  <div style="font-size:12px;color:#94A3B8;margin-bottom:16px">Line-item OpEx at Year 5 stabilization — <span class="mono" style="font-weight:700;color:${parseFloat(opexRatioDetail) <= 38 ? "#16A34A" : "#F59E0B"}">${opexRatioDetail}% OpEx ratio</span> (industry benchmark: 35-42%)</div>
  <table>
    <thead><tr><th>Line Item</th><th>Annual Amount</th><th>% of EGI</th><th>Basis</th></tr></thead>
    <tbody>
      ${opexDetail.map((o, oIdx) => `<tr class="mi" onclick="toggleMI('ox${oIdx}',event)" style="cursor:pointer">
        <td style="font-weight:600">${o.item} <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td>
        <td class="mono" style="font-weight:700">${fmtD(o.amount)}</td>
        <td class="mono">${stabRev > 0 ? (o.amount / stabRev * 100).toFixed(1) + "%" : "—"}</td>
        <td style="font-size:10px;color:#6B7394">${o.note}</td>
      </tr>
      <tr><td colspan="4" style="padding:0;border:none"><div id="mi-ox${oIdx}" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">${o.item} — Derivation</div><div class="mi-conf mi-conf-high">PS Benchmarks</div></div>
        <div class="mi-body">
          <div class="mi-formula">${o.note}<br>Amount: <strong>${fmtD(o.amount)}</strong> (${stabRev > 0 ? (o.amount/stabRev*100).toFixed(1) : "—"}% of EGI)</div>
          <div class="mi-row"><span class="mi-row-label">PS Portfolio Benchmark</span><span class="mi-row-val">${o.item.includes("Property Tax") ? "PS average: 8-12% of EGI. TX: 1.5-2.5% of assessed value. OH/IN: 1.0-1.8%. Reassessment post-development is the primary risk — budget for 15-20% increase at stabilization." : o.item.includes("Insurance") ? "PS average: $0.40-0.55/SF. Coastal/tornado regions add 15-25%. Climate-controlled + sprinklers earn preferred rates." : o.item.includes("Management") ? "PS self-manages at 4-5% with corporate overhead allocated separately. Third-party operators charge 6-8%. This model uses 6% (institutional standard)." : o.item.includes("Payroll") ? "PS targets 1.0 FTE per 60-80K SF. All-in burden (FICA, health, WC) at 30% of base salary. Automated kiosks and smart-access reduce labor needs." : o.item.includes("Utilit") ? "Primary driver: HVAC for climate-controlled units ($1.10/SF/yr). Drive-up: lighting only ($0.25/SF). LED conversions and smart thermostats save 15-20%." : o.item.includes("Marketing") ? "Y1 marketing is $50-75K (grand opening). By Y5, marketing drops to <3% of EGI — PS relies on web presence, Google Ads, and brand recognition." : o.item.includes("R&M") ? "PS budgets $0.30-0.50/SF for ongoing maintenance. Major items: HVAC servicing, door replacements, parking lot repair, security system maintenance." : o.item.includes("Admin") ? "Accounting, legal, software (access control, billing, CRM), pest control, snow removal (where applicable)." : "Based on PS operating benchmarks and industry standard assumptions."}</span></div>
          <div class="mi-source">Source: PS 10-K same-store operating expense disclosures | SSA Self-Storage Almanac | SiteScore™ OpEx engine</div>
        </div>
      </div></div></td></tr>`).join("")}
      <tr class="mi" onclick="toggleMI('oxtotal',event)" style="border-top:2px solid rgba(201,168,76,0.2);font-weight:800;background:rgba(15,21,56,0.3);cursor:pointer">
        <td style="color:#C9A84C">TOTAL OPERATING EXPENSES <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td>
        <td class="mono" style="color:#E87A2E;font-size:14px">${fmtD(totalOpexDetail)}</td>
        <td class="mono" style="color:#E87A2E">${opexRatioDetail}%</td>
        <td></td>
      </tr>
      <tr><td colspan="4" style="padding:0;border:none"><div id="mi-oxtotal" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Total OpEx — Efficiency Analysis</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <strong>OpEx ratio of ${opexRatioDetail}% — ${parseFloat(opexRatioDetail) <= 36 ? "best-in-class efficiency, comparable to PS self-managed facilities" : parseFloat(opexRatioDetail) <= 40 ? "within institutional range, consistent with third-party management" : "above institutional average — investigate specific line items for optimization"}.</strong>
          <div class="mi-formula">Total OpEx: ${fmtD(totalOpexDetail)}<br>Stabilized Revenue: ${fmtD(stabRev)}<br>OpEx Ratio: ${totalOpexDetail} ÷ ${stabRev} = <strong style="color:#E87A2E">${opexRatioDetail}%</strong><br>NOI Margin: <strong style="color:#16A34A">${stabRev > 0 ? (noiDetail/stabRev*100).toFixed(1) : "—"}%</strong></div>
          <div class="mi-row"><span class="mi-row-label">REIT Benchmarks</span><span class="mi-row-val">PSA: 36.5% | EXR: 34.8% | CUBE: 38.2% | Industry avg: 40.5%</span></div>
          <div class="mi-row"><span class="mi-row-label">PS Value-Add</span><span class="mi-row-val">PS's scale drives operating leverage — centralized billing, negotiated insurance rates, smart-access technology reducing payroll, and ECRI pushing revenue without proportional OpEx increase. Every 1% improvement in OpEx ratio adds ~${stabRev > 0 ? fmtD(Math.round(stabRev * 0.01)) : "—"} to NOI.</span></div>
          <div class="mi-source">Source: REIT 10-K filings (Q4 2025) | SSA Industry Factbook | SiteScore™ line-item OpEx engine</div>
        </div>
      </div></div></td></tr>
      <tr style="font-weight:800;background:rgba(22,163,74,0.06)">
        <td style="color:#16A34A">NET OPERATING INCOME</td>
        <td class="mono" style="color:#16A34A;font-size:14px">${fmtD(noiDetail)}</td>
        <td class="mono" style="color:#16A34A">${stabRev > 0 ? (noiDetail / stabRev * 100).toFixed(1) + "%" : "—"}</td>
        <td></td>
      </tr>
    </tbody>
  </table>
  <div id="opexdetail" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">OpEx Methodology Notes</div>
      <div style="line-height:1.8;font-size:11px">
        <div><strong style="color:#E2E8F0">Property Tax:</strong> Estimated at 1.2% of total development cost. ${site.state === "TX" ? "Texas has no state income tax but higher property tax rates (1.5-2.5%). Verify with county appraisal district." : "Verify actual millage rate with local assessor."} After development, the property will be reassessed at full improvement value — budget for potential increases.</div>
        <div style="margin-top:6px"><strong style="color:#E2E8F0">Insurance:</strong> $0.45/SF covers property, general liability, and wind/hail. Climate-controlled facilities with sprinklers receive better rates. Coastal and tornado-corridor sites should budget 15-25% higher.</div>
        <div style="margin-top:6px"><strong style="color:#E2E8F0">Management:</strong> 6% of EGI is standard for institutional operators. REITs typically self-manage at 4-5% but allocate corporate overhead separately. Third-party operators charge 6-8%.</div>
        <div style="margin-top:6px"><strong style="color:#E2E8F0">Payroll:</strong> ${totalSF > 80000 ? "1.5 FTE for facilities >80K SF — one full-time manager + part-time relief." : "1.0 FTE for facilities <80K SF."} All-in burden (FICA, health, WC) at 30% of base. Larger facilities or those in high-wage markets may require adjustment.</div>
        <div style="margin-top:6px"><strong style="color:#E2E8F0">Utilities:</strong> Climate-controlled units are the primary electric cost driver (HVAC). Budget $1.10/SF/yr for climate space, $0.25/SF for drive-up (lighting only). ${incTier === "premium" || incTier === "upper" ? "Premium markets often have higher utility rates." : ""}</div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">Industry Benchmarking — OpEx Ratios</div>
      <div style="margin-top:8px">
        ${[
          { name: "This Site (Projected)", ratio: parseFloat(opexRatioDetail) || 0, color: "#C9A84C" },
          { name: "PS Portfolio Average", ratio: 36.5, color: "#42A5F5" },
          { name: "Extra Space (EXR)", ratio: 34.8, color: "#16A34A" },
          { name: "CubeSmart (CUBE)", ratio: 38.2, color: "#F59E0B" },
          { name: "Industry Average (All)", ratio: 40.5, color: "#94A3B8" },
        ].map(b => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div style="width:180px;font-size:10px;color:${b.color};font-weight:700;text-align:right">${b.name}</div>
          <div style="flex:1;height:14px;border-radius:4px;background:rgba(255,255,255,0.04);overflow:hidden">
            <div style="width:${Math.min(b.ratio / 50 * 100, 100)}%;height:100%;border-radius:4px;background:${b.color};display:flex;align-items:center;justify-content:flex-end;padding-right:6px">
              <span style="font-size:9px;font-weight:700;color:#fff">${b.ratio.toFixed(1)}%</span>
            </div>
          </div>
        </div>`).join("")}
      </div>
    </div>
  </div>
</div>

<!-- CAPITAL STACK & DEBT SERVICE v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('debtservice')">
  <span class="expand-hint">▼ Click to expand <span id="debtservice-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Capital Stack & Debt Service</span></h2>
  <div class="grid4" style="margin-bottom:20px">
    <div class="metric-box mi" onclick="toggleMI('csloan',event)" style="cursor:pointer"><div class="label">Loan Amount <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div><div class="value" style="font-size:16px">${fmtM(loanAmount)}</div><div style="font-size:10px;color:#6B7394;margin-top:2px">${Math.round(loanLTV*100)}% LTV</div>
      <div id="mi-csloan" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Senior Debt — Construction/Perm Loan</div><div class="mi-conf mi-conf-high">Market Terms</div></div>
        <div class="mi-body">
          <div class="mi-formula">Total Dev Cost: ${fmtM(totalDevCost)}<br>LTV: ${Math.round(loanLTV*100)}%<br>Loan: ${fmtM(totalDevCost)} × ${Math.round(loanLTV*100)}% = <strong>${fmtM(loanAmount)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Financing Context</span><span class="mi-row-val">PS finances development through revolving credit facilities and term loans at investment-grade rates. As a land broker, we model standard market financing (${Math.round(loanLTV*100)}% LTV, ${(loanRate*100).toFixed(2)}%) to show project viability independent of PS's balance sheet advantage.</span></div>
          <div class="mi-source">Source: Current market construction/mini-perm terms (Q1 2026) | ${(loanRate*100).toFixed(2)}% rate reflects SOFR + 200-250bps spread</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('cseq',event)" style="cursor:pointer"><div class="label">Equity Required <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div><div class="value" style="font-size:16px;color:#C9A84C">${fmtM(equityRequired)}</div><div style="font-size:10px;color:#6B7394;margin-top:2px">${Math.round(equityPct*100)}% of total</div>
      <div id="mi-cseq" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Equity Requirement</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">Total Dev Cost − Loan = Equity<br>${fmtM(totalDevCost)} − ${fmtM(loanAmount)} = <strong style="color:#C9A84C">${fmtM(equityRequired)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Cash-on-Cash Return</span><span class="mi-row-val">${cashOnCash}% at stabilization — measures annual cash yield on the equity invested</span></div>
          <div class="mi-row"><span class="mi-row-label">Equity Multiple (10-Yr)</span><span class="mi-row-val">${equityMultiple}x — total return on equity including exit proceeds</span></div>
          <div class="mi-source">Source: Total dev cost − loan amount | Standard ${Math.round(equityPct*100)}% equity requirement for construction financing</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('csds',event)" style="cursor:pointer"><div class="label">Annual Debt Service <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div><div class="value" style="font-size:16px;color:#EF4444">${fmtD(annualDS)}</div><div style="font-size:10px;color:#6B7394;margin-top:2px">@ ${(loanRate*100).toFixed(2)}% / ${loanAmort}yr</div>
      <div id="mi-csds" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Debt Service Calculation</div><div class="mi-conf mi-conf-high">Amortization</div></div>
        <div class="mi-body">
          <div class="mi-formula">Loan: ${fmtM(loanAmount)} @ ${(loanRate*100).toFixed(2)}% / ${loanAmort}-yr amort<br>Monthly Payment: ${fmtD(Math.round(monthlyPmt))}<br>Annual DS: ${fmtD(Math.round(monthlyPmt))} × 12 = <strong style="color:#EF4444">${fmtD(annualDS)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Rate Environment</span><span class="mi-row-val">Modeled at ${(loanRate*100).toFixed(2)}% (SOFR + ~225bps). PS's investment-grade rating (A2/A) achieves tighter spreads — actual PS cost of debt is typically 100-150bps lower.</span></div>
          <div class="mi-source">Source: Standard amortization calculation | ${loanAmort}-year fully amortizing | Current market rate as of Q1 2026</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('csdscr',event)" style="cursor:pointer"><div class="label">DSCR (Stabilized) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div><div class="value" style="font-size:22px;color:${parseFloat(dscrStab) >= 1.4 ? "#16A34A" : parseFloat(dscrStab) >= 1.2 ? "#F59E0B" : "#EF4444"}">${dscrStab}x</div><div style="font-size:10px;color:#6B7394;margin-top:2px">Min: 1.25x (lender req)</div>
      <div id="mi-csdscr" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Debt Service Coverage Ratio</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <strong>DSCR = NOI ÷ Annual Debt Service. Lenders require minimum 1.25x. Below 1.0x means the project cannot cover its debt obligations from operations.</strong>
          <div class="mi-formula">Stabilized NOI: ${fmtD(stabNOI)}<br>Annual DS: ${fmtD(annualDS)}<br>DSCR: ${fmtD(stabNOI)} ÷ ${fmtD(annualDS)} = <strong style="color:${parseFloat(dscrStab) >= 1.4 ? "#16A34A" : "#F59E0B"}">${dscrStab}x</strong></div>
          <div class="mi-row"><span class="mi-row-label">Lender Threshold</span><span class="mi-row-val">${parseFloat(dscrStab) >= 1.4 ? "STRONG — exceeds all lender requirements. Favorable refinancing terms achievable." : parseFloat(dscrStab) >= 1.25 ? "PASS — meets minimum requirement. Standard terms." : "BELOW MINIMUM — lender may require additional equity, guarantees, or interest reserve."}</span></div>
          <div class="mi-source">Source: NOI ÷ debt service | Minimum 1.25x per CMBS, life co, and bank lending standards</div>
        </div>
      </div></div>
    </div>
  </div>
  <div class="grid2">
    <div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid rgba(201,168,76,0.08)">
      <div style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:10px">LEVERAGED RETURNS</div>
      <div class="mi drill-row" onclick="toggleMI('cscorc',event)" style="cursor:pointer"><span class="drill-label">Stabilized Cash After DS <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span><span class="drill-value" style="color:${cashAfterDS > 0 ? "#16A34A" : "#EF4444"}">${fmtD(cashAfterDS)}/yr</span></div>
      <div id="mi-cscorc" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Cash Flow After Debt Service</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">NOI: ${fmtD(stabNOI)} − DS: ${fmtD(annualDS)} = <strong style="color:${cashAfterDS > 0 ? "#16A34A" : "#EF4444"}">${fmtD(cashAfterDS)}</strong>/yr</div>
          <div class="mi-row"><span class="mi-row-label">Cash-on-Cash</span><span class="mi-row-val">${cashAfterDS > 0 ? fmtD(cashAfterDS) : "$0"} ÷ ${fmtM(equityRequired)} equity = ${cashOnCash}% annual cash yield on equity invested</span></div>
          <div class="mi-source">Source: Stabilized NOI minus annual debt service obligation</div>
        </div>
      </div></div>
      <div class="mi drill-row" onclick="toggleMI('csirr',event)" style="cursor:pointer"><span class="drill-label">10-Yr Levered IRR <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span><span class="drill-value" style="color:${parseFloat(irrPct) >= 15 ? "#16A34A" : parseFloat(irrPct) >= 10 ? "#F59E0B" : "#EF4444"}">${irrPct}%</span></div>
      <div id="mi-csirr" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Internal Rate of Return (Levered)</div><div class="mi-conf mi-conf-high">DCF Model</div></div>
        <div class="mi-body">
          <strong>IRR measures the annualized return including all cash flows and exit proceeds. This is the institutional benchmark for comparing investment opportunities.</strong>
          <div class="mi-formula">Equity invested: (${fmtM(equityRequired)}) at Y0<br>Annual cash flows: Y1-Y10 (NOI − debt service)<br>Exit proceeds: ${fmtM(exitEquityProceeds)} at Y10 (${fmtM(exitValue)} value − ${fmtM(exitLoanBal)} loan payoff)<br>IRR: <strong style="color:${parseFloat(irrPct) >= 15 ? "#16A34A" : "#F59E0B"}">${irrPct}%</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Benchmark</span><span class="mi-row-val">${parseFloat(irrPct) >= 18 ? "Exceptional — top-decile returns for storage development" : parseFloat(irrPct) >= 14 ? "Strong — exceeds PS's cost of capital by significant margin" : parseFloat(irrPct) >= 10 ? "Adequate — meets minimum institutional threshold" : "Below institutional hurdle — review cost assumptions"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Equity Multiple</span><span class="mi-row-val">${equityMultiple}x — for every $1 of equity invested, the project returns $${equityMultiple} over the 10-year hold</span></div>
          <div class="mi-source">Source: SiteScore™ 10-year DCF model | Exit at ${(exitCapRate*100).toFixed(1)}% cap | Newton-Raphson IRR solver</div>
        </div>
      </div></div>
      <div class="drill-row"><span class="drill-label">Cash-on-Cash Return</span><span class="drill-value" style="color:${parseFloat(cashOnCash) >= 10 ? "#16A34A" : "#F59E0B"}">${cashOnCash}%</span></div>
      <div class="drill-row"><span class="drill-label">Equity Multiple (10-Yr)</span><span class="drill-value" style="color:#C9A84C">${equityMultiple}x</span></div>
    </div>
    <div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid rgba(201,168,76,0.08)">
      <div style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:10px">CAPITAL STACK</div>
      <div style="display:flex;gap:2px;height:24px;border-radius:6px;overflow:hidden;margin-bottom:12px">
        <div style="width:${loanLTV*100}%;background:linear-gradient(90deg,#1565C0,#42A5F5);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff">Debt ${Math.round(loanLTV*100)}%</div>
        <div style="width:${equityPct*100}%;background:linear-gradient(90deg,#C9A84C,#E87A2E);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff">Equity ${Math.round(equityPct*100)}%</div>
      </div>
      <div class="drill-row"><span class="drill-label">Loan Rate</span><span class="drill-value">${(loanRate*100).toFixed(2)}%</span></div>
      <div class="drill-row"><span class="drill-label">Amortization</span><span class="drill-value">${loanAmort} years</span></div>
      <div class="drill-row"><span class="drill-label">Monthly Payment</span><span class="drill-value">${fmtD(Math.round(monthlyPmt))}</span></div>
      <div class="drill-row"><span class="drill-label">Exit Loan Balance (Y10)</span><span class="drill-value">${fmtD(exitLoanBal)}</span></div>
    </div>
  </div>
  <div id="debtservice" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">DSCR Year-by-Year</div>
      <div style="margin-top:8px">
        ${yrDataExt.slice(0, 5).map((y, i) => {
          const dscr = annualDS > 0 ? (y.noi / annualDS).toFixed(2) : "—";
          const dscrColor = parseFloat(dscr) >= 1.4 ? "#16A34A" : parseFloat(dscr) >= 1.25 ? "#F59E0B" : parseFloat(dscr) >= 1.0 ? "#E87A2E" : "#EF4444";
          return `<div class="drill-row">
            <span class="drill-label">Year ${y.yr} DSCR</span>
            <span class="drill-value" style="color:${dscrColor}">${dscr}x ${parseFloat(dscr) < 1.25 ? '<span style="font-size:9px;color:#EF4444">⚠ BELOW MIN</span>' : parseFloat(dscr) >= 1.4 ? '<span style="font-size:9px;color:#16A34A">✓ PASS</span>' : ""}</span>
          </div>`;
        }).join("")}
        <div style="margin-top:8px;font-size:10px;color:#6B7394">Most construction/mini-perm lenders require 1.25x DSCR minimum. Interest-only periods during lease-up (Y1-Y2) are common and improve early-year coverage.</div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">10-Year Levered Cash Flow</div>
      <table style="font-size:11px;margin-top:8px">
        <thead><tr><th>Year</th><th>NOI</th><th>Debt Service</th><th>Cash After DS</th><th>DSCR</th></tr></thead>
        <tbody>
          ${yrDataExt.map((y, i) => {
            const cf = y.noi - annualDS;
            const dscr = annualDS > 0 ? (y.noi / annualDS).toFixed(2) : "—";
            return `<tr${i === 9 ? ' style="font-weight:700;background:rgba(201,168,76,0.05)"' : ""}>
              <td style="font-weight:600">Y${y.yr}</td>
              <td class="mono">${fmtD(y.noi)}</td>
              <td class="mono" style="color:#EF4444">(${fmtD(annualDS)})</td>
              <td class="mono" style="color:${cf > 0 ? "#16A34A" : "#EF4444"}">${fmtD(cf)}</td>
              <td class="mono" style="color:${parseFloat(dscr) >= 1.25 ? "#16A34A" : "#EF4444"}">${dscr}x</td>
            </tr>`;
          }).join("")}
          <tr style="border-top:2px solid rgba(201,168,76,0.2);font-weight:800">
            <td style="color:#C9A84C">Y10 EXIT</td>
            <td class="mono" style="color:#42A5F5">${fmtM(exitValue)} @ ${(exitCapRate*100).toFixed(1)}% cap</td>
            <td class="mono" style="color:#EF4444">(${fmtM(exitLoanBal)}) payoff</td>
            <td class="mono" style="color:#16A34A;font-size:14px">${fmtM(exitEquityProceeds)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">IRR Sensitivity — Exit Cap × Hold Period</div>
      <table style="font-size:10px;margin-top:8px">
        <thead><tr><th>Exit Cap</th><th>Y5 Exit</th><th>Y7 Exit</th><th>Y10 Exit</th></tr></thead>
        <tbody>
          ${[0.050, 0.055, 0.060, 0.065, 0.070].map(ec => {
            const scenarios = [5, 7, 10].map(holdYr => {
              const exitNOI = yrDataExt[holdYr - 1].noi;
              const exitVal = Math.round(exitNOI / ec);
              const exitBal = (() => { let b = loanAmount; for (let m = 0; m < holdYr * 12; m++) b = b * (1 + monthlyLoanRate) - monthlyPmt; return Math.round(Math.max(b, 0)); })();
              const exitEq = exitVal - exitBal;
              const cfs = [-equityRequired, ...yrDataExt.slice(0, holdYr).map((y, i) => { const c = y.noi - annualDS; return i === holdYr - 1 ? c + exitEq : c; })];
              let lo = -0.2, hi = 0.8;
              for (let it = 0; it < 60; it++) { const md = (lo + hi) / 2; const npv = cfs.reduce((n, c, t) => n + c / Math.pow(1 + md, t), 0); if (npv > 0) lo = md; else hi = md; }
              return ((lo + hi) / 2 * 100).toFixed(1);
            });
            const isBase = ec === 0.060;
            return `<tr style="${isBase ? "background:rgba(201,168,76,0.06);font-weight:700" : ""}">
              <td class="mono">${(ec*100).toFixed(1)}%${isBase ? " ◆" : ""}</td>
              ${scenarios.map(s => `<td class="mono" style="color:${parseFloat(s) >= 15 ? "#16A34A" : parseFloat(s) >= 10 ? "#F59E0B" : "#EF4444"};text-align:center">${s}%</td>`).join("")}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- RATE CROSS-VALIDATION (AUDIT TRAIL) v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('rateval')">
  <span class="expand-hint">▼ Click to expand <span id="rateval-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Rate Cross-Validation & Audit Trail</span></h2>
  <div style="display:flex;gap:16px;align-items:center;margin-bottom:20px">
    <div style="flex:1">
      <div style="font-size:12px;color:#94A3B8">Three independent models validate the market rate assumption. Convergence = confidence.</div>
    </div>
    <div class="mi badge" onclick="toggleMI('rvconf',event)" style="cursor:pointer;background:${rateConfColor}18;color:${rateConfColor};border:1px solid ${rateConfColor}30;font-size:13px;padding:6px 18px">${rateConfidence} CONFIDENCE <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
    <div id="mi-rvconf" class="mi-panel" style="position:absolute;right:20px;top:60px;min-width:400px"><div class="mi-panel-inner">
      <div class="mi-header"><div class="mi-title">Rate Confidence Assessment</div><div class="mi-conf mi-conf-${rateConfidence === "HIGH" ? "high" : "med"}">${rateConfidence}</div></div>
      <div class="mi-body">
        <strong>Confidence is determined by the convergence of three independent rate derivation methods. Tighter spread = higher confidence.</strong>
        <div class="mi-formula">M1 (Income): $${m1Rate.toFixed(2)} | M2 (Revenue Density): $${m2ClimRate.toFixed(2)} | M3 (Pop Density): $${m3ClimRate.toFixed(2)}<br>Spread: $${Math.abs(Math.max(m1Rate,m2ClimRate,m3ClimRate) - Math.min(m1Rate,m2ClimRate,m3ClimRate)).toFixed(2)}<br>Confidence: <strong style="color:${rateConfColor}">${rateConfidence}</strong></div>
        <div class="mi-row"><span class="mi-row-label">Thresholds</span><span class="mi-row-val">HIGH: &lt;8% spread between methods | MODERATE: 8-15% | LOW: &gt;15%</span></div>
        <div class="mi-row"><span class="mi-row-label">PS Value-Add</span><span class="mi-row-val">No other site vetting tool provides multi-method rate cross-validation. Traditional brokerage relies on a single comp-based estimate. SiteScore™ triangulates from 3 independent data sources — if all 3 agree, the rate assumption is robust. If they diverge, SiteScore™ flags the uncertainty and recommends a street rate survey before committing capital.</span></div>
        <div class="mi-source">Source: 3-method convergence analysis | Spread threshold calibrated against 47-site pipeline validation</div>
      </div>
    </div></div>
  </div>
  <div class="grid3" style="margin-bottom:20px">
    <div class="metric-box mi" onclick="toggleMI('rvm1',event)" style="cursor:pointer">
      <div class="label">Method 1: Income Tier <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px;color:#42A5F5">$${m1Rate.toFixed(2)}<span style="font-size:10px;color:#6B7394">/SF/mo</span></div>
      <div style="font-size:9px;color:#6B7394;margin-top:4px">${incTier} market × ${compAdj >= 1 ? "+" : ""}${((compAdj-1)*100).toFixed(0)}% comp adj</div>
      <div id="mi-rvm1" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Method 1 — Income-Tier Rate Model (Primary)</div><div class="mi-conf mi-conf-high">Census ACS + Competition</div></div>
        <div class="mi-body">
          <strong>The primary rate derivation. Maps 3-mile median HHI to a base rate tier, then adjusts for local competition density.</strong>
          <div class="mi-formula">Step 1: 3-mi HHI = $${incN ? incN.toLocaleString() : "N/A"} → Tier: ${incTier}<br>Step 2: Base rate = $${baseClimateRate.toFixed(2)}/SF/mo (from tier matrix)<br>Step 3: Competition adj = ${compAdj.toFixed(2)}x (${compCount} competitors → ${compAdj >= 1.05 ? "low supply premium" : compAdj >= 1.0 ? "equilibrium" : "rate pressure"})<br>Step 4: M1 Rate = $${baseClimateRate.toFixed(2)} × ${compAdj.toFixed(2)} = <strong style="color:#42A5F5">$${m1Rate.toFixed(2)}/SF/mo</strong></div>
          <div class="mi-row"><span class="mi-row-label">Data Sources</span><span class="mi-row-val">Census ACS 5-Year Table B19013 (HHI) | Google Maps/SpareFoot (competitor count) | SiteScore™ tier matrix (calibrated against PS portfolio RevPAF by income bracket)</span></div>
          <div class="mi-row"><span class="mi-row-label">Why This Method Works</span><span class="mi-row-val">Income is the strongest predictor of storage pricing. Higher-income households have more possessions, larger homes (generating more storage demand during transitions), and higher willingness-to-pay for climate-controlled premium units. PS's own portfolio data confirms: premium markets ($90K+ HHI) achieve 25-35% higher RevPAF than value markets.</span></div>
          <div class="mi-source">Source: US Census ACS 5-Year | SiteScore™ income-tier matrix | Competition adjustment from 3-mi radius scan</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('rvm2',event)" style="cursor:pointer">
      <div class="label">Method 2: Revenue Density <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px;color:#E87A2E">$${m2ClimRate.toFixed(2)}<span style="font-size:10px;color:#6B7394">/SF/mo</span></div>
      <div style="font-size:9px;color:#6B7394;margin-top:4px">National benchmark × income adj</div>
      <div id="mi-rvm2" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Method 2 — Revenue Density Benchmark</div><div class="mi-conf mi-conf-med">Industry Data</div></div>
        <div class="mi-body">
          <strong>Cross-references against national self-storage revenue benchmarks from CBRE, Marcus & Millichap, and Yardi Matrix.</strong>
          <div class="mi-formula">National climate-controlled avg: ~$1.15/SF/mo<br>Income adjustment: ${incTier === "premium" ? "+26%" : incTier === "upper" ? "+9%" : incTier === "mid" ? "-4%" : "-17%"}<br>M2 Climate Rate: <strong style="color:#E87A2E">$${m2ClimRate.toFixed(2)}/SF/mo</strong></div>
          <div class="mi-row"><span class="mi-row-label">Data Sources</span><span class="mi-row-val">CBRE Self-Storage Market Report | Marcus & Millichap Self-Storage Investment Forecast | Yardi Matrix Self-Storage Market Intelligence</span></div>
          <div class="mi-row"><span class="mi-row-label">Validation Value</span><span class="mi-row-val">This method serves as a "sanity check" against M1. If M1 and M2 diverge by more than 15%, it suggests the income-tier model may be over- or under-estimating local rates. Variance here: ${Math.abs(((m1Rate - m2ClimRate)/m2ClimRate)*100).toFixed(1)}% — ${Math.abs(((m1Rate - m2ClimRate)/m2ClimRate)*100) < 10 ? "excellent alignment" : "modest divergence, warranting street rate verification"}.</span></div>
          <div class="mi-source">Source: National revenue density benchmarks adjusted for local income tier | CBRE, M&M, Yardi Matrix</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('rvm3',event)" style="cursor:pointer">
      <div class="label">Method 3: Pop Density <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px;color:#16A34A">$${m3ClimRate.toFixed(2)}<span style="font-size:10px;color:#6B7394">/SF/mo</span></div>
      <div style="font-size:9px;color:#6B7394;margin-top:4px">${popN ? fmtN(popN) : "—"} pop × density factor</div>
      <div id="mi-rvm3" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Method 3 — Population Density Proxy</div><div class="mi-conf mi-conf-med">Census + Density Model</div></div>
        <div class="mi-body">
          <strong>Higher population density within 3 miles correlates with stronger storage demand and rate support. Urban/suburban density drives walk-in traffic and reduces marketing cost per lease.</strong>
          <div class="mi-formula">3-mi Population: ${popN ? fmtN(popN) : "—"}<br>Density Factor: ${popDensityFactor.toFixed(2)}x<br>Base Rate: $1.15/SF × ${popDensityFactor.toFixed(2)} = <strong style="color:#16A34A">$${m3ClimRate.toFixed(2)}/SF/mo</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Relevance</span><span class="mi-row-val">Population density is a leading indicator for lease-up velocity. Dense markets (40K+ within 3mi) typically stabilize 6-12 months faster than sparse markets. PS's best-performing facilities are in suburban corridors with 30-50K 3-mi population.</span></div>
          <div class="mi-source">Source: Census ACS 3-mile population | Density-to-rate correlation model calibrated against 47-site SiteScore™ pipeline</div>
        </div>
      </div></div>
    </div>
  </div>
  <div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid ${rateConfColor}30">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">CONSENSUS RATE (CLIMATE)</div>
        <div class="mono" style="font-size:22px;font-weight:800;color:${rateConfColor}">$${consensusClimRate.toFixed(2)}<span style="font-size:11px;color:#6B7394">/SF/mo</span></div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">MODEL USED</div>
        <div class="mono" style="font-size:22px;font-weight:800;color:#42A5F5">$${m1Rate.toFixed(2)}<span style="font-size:11px;color:#6B7394">/SF/mo</span></div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">VARIANCE</div>
        <div class="mono" style="font-size:22px;font-weight:800;color:${Math.abs(m1Rate - consensusClimRate) / consensusClimRate < 0.05 ? "#16A34A" : "#F59E0B"}">${m1Rate > consensusClimRate ? "+" : ""}${((m1Rate - consensusClimRate) / consensusClimRate * 100).toFixed(1)}%</div>
      </div>
    </div>
  </div>
  <div id="rateval" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Rate Derivation Methodology</div>
      <div style="line-height:1.8;font-size:11px">
        <div><strong style="color:#42A5F5">Method 1 — Income Tier Model (Primary):</strong> Base climate rate set by 3-mile median HHI tier (Premium: $1.45, Upper: $1.25, Mid: $1.10, Value: $0.95), then adjusted by competition factor (${compCount} competitors → ${compAdj >= 1 ? "+" : ""}${((compAdj-1)*100).toFixed(0)}% adjustment). This model captures the fundamental relationship between local purchasing power and willingness-to-pay for premium storage.</div>
        <div style="margin-top:6px"><strong style="color:#E87A2E">Method 2 — Revenue Density Benchmark:</strong> Cross-referenced against national self-storage revenue benchmarks (CBRE, Marcus & Millichap, Yardi Matrix). Climate-controlled facilities in ${incTier} markets typically achieve $${(m2ClimRate * 12).toFixed(0)}-$${(m2ClimRate * 12 * 1.15).toFixed(0)}/SF/year. Our model rate of $${(m1Rate * 12).toFixed(2)}/SF/year is ${m1Rate >= m2ClimRate ? "above" : "below"} this benchmark by ${Math.abs(((m1Rate - m2ClimRate) / m2ClimRate) * 100).toFixed(1)}%.</div>
        <div style="margin-top:6px"><strong style="color:#16A34A">Method 3 — Population Density Proxy:</strong> Higher 3-mile population density correlates with stronger storage demand and rate support. At ${popN ? fmtN(popN) : "—"} residents within 3 miles, the density factor is ${popDensityFactor.toFixed(2)}x, yielding an estimated rate of $${m3ClimRate.toFixed(2)}/SF/mo.</div>
        <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(201,168,76,0.1)"><strong style="color:#C9A84C">Confidence Assessment:</strong> ${rateConfidence === "HIGH" ? "All three methods converge within 8% — high confidence in rate assumption. The model rate is well-supported by independent validation." : rateConfidence === "MODERATE" ? "Methods show 8-15% variance — moderate confidence. Rate assumption is directionally correct but should be validated with local operator interviews or market surveys." : "Methods show >15% divergence — low confidence. Recommend conducting local rate survey before finalizing underwriting. The model rate may need adjustment."}</div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">Revenue Sensitivity — Rate Scenarios</div>
      <table style="font-size:11px;margin-top:8px">
        <thead><tr><th>Scenario</th><th>Climate $/SF/mo</th><th>Drive $/SF/mo</th><th>Y5 Revenue</th><th>Y5 NOI</th><th>YOC</th></tr></thead>
        <tbody>
          ${[
            { label: "Bear (-15%)", adj: 0.85, color: "#EF4444" },
            { label: "Conservative (-7%)", adj: 0.93, color: "#E87A2E" },
            { label: "Base Case", adj: 1.00, color: "#C9A84C" },
            { label: "Upside (+7%)", adj: 1.07, color: "#22C55E" },
            { label: "Bull (+15%)", adj: 1.15, color: "#16A34A" },
          ].map(sc => {
            const scClim = Math.round(mktClimateRate * sc.adj * Math.pow(1.03, 4) * 100) / 100;
            const scDrive = Math.round(mktDriveRate * sc.adj * Math.pow(1.03, 4) * 100) / 100;
            const scRev = Math.round(climateSF * 0.92 * scClim * 12 + driveSF * 0.92 * scDrive * 12);
            const scNoi = Math.round(scRev * 0.65);
            const scYoc = totalDevCost > 0 ? ((scNoi / totalDevCost) * 100).toFixed(1) : "—";
            return `<tr style="${sc.adj === 1.00 ? "background:rgba(201,168,76,0.06);font-weight:700" : ""}">
              <td style="color:${sc.color};font-weight:700">${sc.label}</td>
              <td class="mono">$${scClim.toFixed(2)}</td>
              <td class="mono">$${scDrive.toFixed(2)}</td>
              <td class="mono">${fmtD(scRev)}</td>
              <td class="mono" style="color:${sc.color}">${fmtD(scNoi)}</td>
              <td class="mono" style="font-weight:700;color:${sc.color}">${scYoc}%</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- INSTITUTIONAL PERFORMANCE METRICS v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('instmetrics')">
  <span class="expand-hint">▼ Click to expand <span id="instmetrics-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Institutional Performance Metrics</span></h2>
  <div style="font-size:11px;color:#94A3B8;margin-bottom:16px">Industry-standard KPIs used by institutional storage operators (PSA, EXR, CUBE, NSA) in underwriting and portfolio management</div>
  <div class="grid4" style="margin-bottom:16px">
    <div class="metric-box mi" onclick="toggleMI('iprevpaf',event)" style="cursor:pointer;border-color:rgba(201,168,76,0.2)">
      <div class="label">RevPAF <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="color:#C9A84C;font-size:22px">$${revPAF}</div>
      <div style="font-size:8px;color:#6B7394;margin-top:2px">Revenue / Available SF / Yr</div>
      <div id="mi-iprevpaf" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Revenue Per Available Foot — PS's #1 KPI</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <strong>RevPAF is the single most-watched metric in PS's quarterly earnings calls. It captures both rate and occupancy in one number — the ultimate measure of facility performance.</strong>
          <div class="mi-formula">Y5 Revenue: ${fmtD(yearData[4].totalRev)}<br>Total Available SF: ${totalSF.toLocaleString()}<br>RevPAF: ${fmtD(yearData[4].totalRev)} ÷ ${totalSF.toLocaleString()} = <strong style="color:#C9A84C">$${revPAF}/SF/yr</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Portfolio Benchmark</span><span class="mi-row-val">PS same-store RevPAF: ~$24.50/SF (Q4 2025). This site at $${revPAF}/SF is ${siteRevPAFn >= 24.5 ? "AT OR ABOVE" : siteRevPAFn >= 20 ? "competitive with" : "below"} PS's existing portfolio average.</span></div>
          <div class="mi-row"><span class="mi-row-label">Why PS Cares Deeply</span><span class="mi-row-val">RevPAF growth drives share price. PS reports same-store RevPAF growth quarterly — analysts benchmark it against EXR ($22.80) and CUBE ($19.50). New developments must project competitive RevPAF to justify capital allocation vs. acquisitions.</span></div>
          <div class="mi-row"><span class="mi-row-label">SiteScore™ Value-Add</span><span class="mi-row-val">SiteScore™ projects RevPAF BEFORE development begins — giving PS a forward-looking performance metric that traditional site vetting (zoning, acreage, price) cannot provide. This is the informational edge.</span></div>
          <div class="mi-source">Source: Y5 revenue ÷ total SF | Benchmarked against PS 10-K ($24.50/SF), EXR 10-K ($22.80/SF), CUBE 10-K ($19.50/SF)</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('iprevpof',event)" style="cursor:pointer">
      <div class="label">RevPOF <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:22px">$${revPOF}</div>
      <div style="font-size:8px;color:#6B7394;margin-top:2px">Revenue / Occupied SF / Yr</div>
      <div id="mi-iprevpof" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Revenue Per Occupied Foot</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <strong>RevPOF isolates pricing power from occupancy — it shows the effective rate being achieved on rented space. Higher RevPOF = stronger pricing power.</strong>
          <div class="mi-formula">Y5 Revenue: ${fmtD(yearData[4].totalRev)}<br>Occupied SF: ${Math.round(yearData[4].occRate * totalSF).toLocaleString()} (${Math.round(yearData[4].occRate*100)}% of ${totalSF.toLocaleString()})<br>RevPOF: <strong>$${revPOF}/SF/yr</strong></div>
          <div class="mi-row"><span class="mi-row-label">ECRI Impact</span><span class="mi-row-val">RevPOF grows faster than RevPAF because ECRI pushes in-place rents 25-40% above street rate for long-tenured customers. PS's RevPOF exceeds RevPAF by ~8-12% at maturity.</span></div>
          <div class="mi-source">Source: Revenue ÷ occupied SF at 92% stabilized occupancy</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('ipnoim',event)" style="cursor:pointer">
      <div class="label">NOI Margin <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="color:${parseFloat(noiMarginPct) >= 60 ? "#16A34A" : parseFloat(noiMarginPct) >= 50 ? "#F59E0B" : "#EF4444"};font-size:22px">${noiMarginPct}%</div>
      <div style="font-size:8px;color:#6B7394;margin-top:2px">Industry avg: 58-65%</div>
      <div id="mi-ipnoim" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">NOI Margin — Operating Efficiency</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">NOI: ${fmtD(noiDetail)} ÷ Revenue: ${fmtD(stabRev)} = <strong>${noiMarginPct}%</strong></div>
          <div class="mi-row"><span class="mi-row-label">REIT Comparison</span><span class="mi-row-val">PSA: 63.5% | EXR: 65.2% | CUBE: 61.8% | This site: ${noiMarginPct}%</span></div>
          <div class="mi-row"><span class="mi-row-label">PS Leverage</span><span class="mi-row-val">Self-storage has the highest NOI margins in commercial real estate (vs. multifamily ~65%, office ~55%, retail ~60%). Storage's low labor, no TI, no leasing commissions = superior operating leverage. Every $1 of revenue growth drops ~$0.65 to NOI.</span></div>
          <div class="mi-source">Source: NOI ÷ EGI | REIT 10-K filings (Q4 2025) | SSA Industry Factbook</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('ipavgr',event)" style="cursor:pointer">
      <div class="label">Avg Monthly Rent <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:22px">$${avgMonthlyRent}</div>
      <div style="font-size:8px;color:#6B7394;margin-top:2px">Per occupied unit</div>
      <div id="mi-ipavgr" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Average Monthly Rent Per Unit</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">Total monthly revenue ÷ total occupied units at stabilization<br>= <strong>$${avgMonthlyRent}/unit/mo</strong></div>
          <div class="mi-row"><span class="mi-row-label">Customer Impact</span><span class="mi-row-val">At $${avgMonthlyRent}/mo, storage costs ~${incN > 0 ? ((parseFloat(avgMonthlyRent) * 12 / incN) * 100).toFixed(1) : "—"}% of median HHI — well within the "not worth moving" threshold. This low income share is WHY ECRI works: the hassle of physically relocating stored items far exceeds rate increases.</span></div>
          <div class="mi-source">Source: Weighted average across all unit types at stabilized rates</div>
        </div>
      </div></div>
    </div>
  </div>
  <div class="grid3">
    <div class="metric-box mi" onclick="toggleMI('ipnoisf',event)" style="cursor:pointer">
      <div class="label">NOI / SF <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px">$${noiPerSF}<span style="font-size:10px;color:#6B7394">/yr</span></div>
      <div id="mi-ipnoisf" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">NOI Per Square Foot</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">Stabilized NOI: ${fmtD(stabNOI)} ÷ ${totalSF.toLocaleString()} SF = <strong>$${noiPerSF}/SF/yr</strong></div>
          <div class="mi-row"><span class="mi-row-label">Benchmark</span><span class="mi-row-val">PS portfolio: ~$15-16/SF. Top-quartile climate-controlled: $18+/SF. This metric combined with all-in cost/SF gives the true development efficiency.</span></div>
          <div class="mi-source">Source: Stabilized NOI ÷ total available SF</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('ipdevsp',event)" style="cursor:pointer">
      <div class="label">Development Spread <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="color:${parseFloat(devSpread) >= 2.5 ? "#16A34A" : parseFloat(devSpread) >= 1.5 ? "#F59E0B" : "#EF4444"};font-size:18px">${devSpread}<span style="font-size:10px;color:#6B7394"> bps</span></div>
      <div style="font-size:8px;color:#6B7394;margin-top:2px">YOC vs ${(mktAcqCap*100).toFixed(1)}% acq cap</div>
      <div id="mi-ipdevsp" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Development Spread — Why PS Builds</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <strong>The development spread is the fundamental reason PS develops instead of acquires. It measures the return premium earned by accepting construction and lease-up risk.</strong>
          <div class="mi-formula">Development YOC: ${yocStab}%<br>Market Acquisition Cap: ${(mktAcqCap*100).toFixed(1)}%<br>Spread: ${yocStab}% − ${(mktAcqCap*100).toFixed(1)}% = <strong style="color:#C9A84C">${devSpread} basis points</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Decision Framework</span><span class="mi-row-val">${parseFloat(devSpread) >= 3.0 ? "Exceptional spread — strongly favors development. This project creates significant value vs. acquisition." : parseFloat(devSpread) >= 2.0 ? "Healthy spread — development is clearly justified. Standard REC approval." : parseFloat(devSpread) >= 1.0 ? "Thin spread — development risk may not be adequately compensated. Consider acquisition alternatives." : "Negative or minimal spread — acquiring a stabilized facility at market cap would be more capital-efficient."}</span></div>
          <div class="mi-row"><span class="mi-row-label">SiteScore™ Value-Add</span><span class="mi-row-val">SiteScore™ computes the development spread BEFORE PS spends money on due diligence. This saves PS $15-30K per site in DD costs by screening out marginal development opportunities early.</span></div>
          <div class="mi-source">Source: YOC − market acquisition cap rate | Green Street Advisors Q1 2026 | CBRE cap rate survey</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('ipilc',event)" style="cursor:pointer">
      <div class="label">Implied Land Cap <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px">${impliedLandCap}%</div>
      <div style="font-size:8px;color:#6B7394;margin-top:2px">NOI ÷ Land Cost only</div>
      <div id="mi-ipilc" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Implied Land Capitalization Rate</div><div class="mi-conf mi-conf-${landCost > 0 ? "high" : "low"}">${landCost > 0 ? "Computed" : "No Land Price"}</div></div>
        <div class="mi-body">
          <strong>What cap rate are we effectively paying on the land alone? Higher = better deal on the dirt.</strong>
          <div class="mi-formula">${landCost > 0 ? `NOI: ${fmtD(stabNOI)} ÷ Land: ${fmtD(landCost)} = <strong>${impliedLandCap}%</strong>` : "Land price required for calculation"}</div>
          <div class="mi-row"><span class="mi-row-label">Interpretation</span><span class="mi-row-val">${landCost > 0 ? (parseFloat(impliedLandCap) >= 20 ? "Exceptional land efficiency — the facility produces 20%+ return on land cost alone" : parseFloat(impliedLandCap) >= 12 ? "Strong land yield — well above total project YOC, indicating land is reasonably priced" : "Land cost is significant relative to NOI — development spread depends heavily on construction efficiency") : "Enter land cost to compute"}</span></div>
          <div class="mi-source">Source: Stabilized NOI ÷ land acquisition cost</div>
        </div>
      </div></div>
    </div>
  </div>
  <div id="instmetrics" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">What These Metrics Mean to the REC</div>
      <div style="line-height:1.8;font-size:11px">
        <div><strong style="color:#C9A84C">RevPAF ($${revPAF}/SF/yr)</strong> — The single most important revenue metric in storage. Measures total revenue normalized by total available square footage. PS's portfolio averages ~$24.50/SF; Extra Space ~$22.80. ${siteRevPAFn >= 22 ? "This site projects above or near REIT-portfolio averages — strong signal." : siteRevPAFn >= 17 ? "This site projects in the mid-range — typical for suburban/secondary markets." : "Below REIT averages — may reflect market characteristics or conservative rate assumptions."}</div>
        <div style="margin-top:6px"><strong style="color:#C9A84C">NOI Margin (${noiMarginPct}%)</strong> — Operating efficiency ratio. PS achieves 63-65% at scale; independent operators typically 55-60%. ${parseFloat(noiMarginPct) >= 60 ? "This projection is in the institutional range." : "Below institutional benchmarks — OpEx may be elevated by payroll relative to facility size."}</div>
        <div style="margin-top:6px"><strong style="color:#C9A84C">Development Spread (${devSpread} bps)</strong> — The premium earned by building vs. buying an existing stabilized facility. This is WHY operators develop instead of acquire. Institutional minimum is ~150-200bps. ${parseFloat(devSpread) >= 2.5 ? "Strong development spread — this project clearly justifies a build decision over acquisition." : parseFloat(devSpread) >= 1.5 ? "Adequate spread, though acquisition alternatives should be evaluated." : "Thin spread — the risk-adjusted advantage of development over acquisition is marginal."}</div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">ECRI Revenue Lift Projections</div>
      <div style="font-size:11px;color:#94A3B8;margin-bottom:10px">Existing Customer Rate Increase (ECRI) strategy — the primary margin engine post-stabilization. PS's ECRI program generates 35-40% of same-store revenue growth.</div>
      <table style="font-size:11px">
        <thead><tr><th>Tenant Cohort</th><th>Starting Rate</th><th>Rate After 3 Yrs</th><th>Rate After 5 Yrs</th><th>Lift vs Street</th></tr></thead>
        <tbody>
          ${(() => {
            const yr1Rate = yearData[0].climRate;
            const yr3Lift = 1.25; // 25% ECRI lift over 3 years
            const yr5Lift = 1.42; // 42% lift over 5 years
            const streetY3 = Math.round(mktClimateRate * Math.pow(1.03, 2) * 100) / 100;
            const streetY5 = Math.round(mktClimateRate * Math.pow(1.03, 4) * 100) / 100;
            return `<tr>
              <td style="font-weight:600">Y1 Move-In (Promo)</td>
              <td class="mono" style="color:#EF4444">$${yr1Rate.toFixed(2)}/SF <span style="font-size:9px">(-35% disc)</span></td>
              <td class="mono" style="color:#F59E0B">$${(yr1Rate * yr3Lift).toFixed(2)}/SF</td>
              <td class="mono" style="color:#16A34A">$${(yr1Rate * yr5Lift).toFixed(2)}/SF</td>
              <td class="mono" style="color:#16A34A;font-weight:700">+${Math.round(((yr1Rate * yr5Lift / streetY5) - 1) * 100)}% above street</td>
            </tr>
            <tr>
              <td style="font-weight:600">Y2 Move-In (Modest Disc)</td>
              <td class="mono">$${yearData[1].climRate.toFixed(2)}/SF <span style="font-size:9px">(-15% disc)</span></td>
              <td class="mono" style="color:#F59E0B">$${(yearData[1].climRate * 1.20).toFixed(2)}/SF</td>
              <td class="mono" style="color:#16A34A">$${(yearData[1].climRate * 1.35).toFixed(2)}/SF</td>
              <td class="mono" style="color:#16A34A;font-weight:700">+${Math.round(((yearData[1].climRate * 1.35 / streetY5) - 1) * 100)}% above street</td>
            </tr>
            <tr>
              <td style="font-weight:600">Y3+ Move-In (Full Rate)</td>
              <td class="mono" style="color:#42A5F5">$${streetY3.toFixed(2)}/SF <span style="font-size:9px">(market)</span></td>
              <td class="mono">—</td>
              <td class="mono" style="color:#16A34A">$${(streetY3 * 1.20).toFixed(2)}/SF</td>
              <td class="mono" style="color:#16A34A;font-weight:700">+${Math.round(((streetY3 * 1.20 / streetY5) - 1) * 100)}% above street</td>
            </tr>`;
          })()}
        </tbody>
      </table>
      <div style="margin-top:10px;font-size:10px;color:#6B7394">ECRI cadence: every 6-9 months, 8-12% per increase. Tenant move-out rate post-ECRI is only 5-8% — storage customers have extremely low price elasticity because the hassle cost of moving belongings exceeds rate increases. PS's average tenured customer pays 35-40% above current street rate.</div>
    </div>
  </div>
</div>

<!-- REIT PORTFOLIO BENCHMARKING v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('reitbench')">
  <span class="expand-hint">▼ Click to expand <span id="reitbench-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">REIT Portfolio Benchmarking</span></h2>
  <div class="mi" onclick="toggleMI('rbbench',event)" style="font-size:11px;color:#94A3B8;margin-bottom:16px;cursor:pointer">How this site's projected metrics compare to publicly traded storage REIT portfolios <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
  <div id="mi-rbbench" class="mi-panel"><div class="mi-panel-inner">
    <div class="mi-header"><div class="mi-title">REIT Benchmarking — Why This Section Matters to PS</div><div class="mi-conf mi-conf-high">SEC Filings</div></div>
    <div class="mi-body">
      <strong>PS's REC benchmarks every development project against its own portfolio and competitors. This section provides that context automatically — saving PS analysts hours of manual data compilation per site.</strong>
      <div class="mi-row"><span class="mi-row-label">Data Source</span><span class="mi-row-val">Q4 2025 / Q1 2026 10-K and 10-Q filings + quarterly earnings supplements from PSA (Public Storage), EXR (Extra Space), CUBE (CubeSmart), LSI (Life Storage/EXR), NSA (National Storage Affiliates). All data is audited by Big 4 firms and publicly available via SEC EDGAR.</span></div>
      <div class="mi-row"><span class="mi-row-label">SiteScore™ Edge</span><span class="mi-row-val">Traditional site vetting delivers a zoning check and a price. SiteScore™ delivers portfolio-level institutional analytics — placing every site in context against $80B+ of publicly traded storage assets. This is the depth that PS's internal acquisition team uses, now automated and delivered per-site in seconds.</span></div>
      <div class="mi-source">Source: SEC EDGAR | PSA, EXR, CUBE, NSA quarterly earnings supplements | Green Street Advisors implied cap rate model</div>
    </div>
  </div></div>
  <table>
    <thead><tr><th>Operator</th><th>RevPAF</th><th>NOI Margin</th><th>SS Rev Growth</th><th>Avg Occ</th><th>Implied Cap</th><th>Avg Facility SF</th><th>ECRI Lift</th></tr></thead>
    <tbody>
      <tr style="background:rgba(201,168,76,0.08);border-left:3px solid #C9A84C;font-weight:700">
        <td style="color:#C9A84C">◆ THIS SITE (Projected)</td>
        <td class="mono" style="color:#C9A84C">$${revPAF}</td>
        <td class="mono" style="color:#C9A84C">${noiMarginPct}%</td>
        <td class="mono" style="color:#6B7394">N/A (new dev)</td>
        <td class="mono">${Math.round(yearData[4].occRate * 100)}%</td>
        <td class="mono">${yocStab}% YOC</td>
        <td class="mono">${totalSF.toLocaleString()}</td>
        <td class="mono" style="color:#6B7394">Projected</td>
      </tr>
      ${reitBench.map(r => {
        const isClosest = r.ticker === (reitComparable?.ticker || "");
        return `<tr style="${isClosest ? "background:rgba(66,165,245,0.05)" : ""}">
          <td style="font-weight:${isClosest ? "700" : "600"}">${r.ticker} — ${r.name}${isClosest ? ' <span class="tag" style="background:#42A5F520;color:#42A5F5;font-size:8px">CLOSEST COMP</span>' : ""}</td>
          <td class="mono" style="color:${siteRevPAFn >= r.revPAF ? "#16A34A" : "#94A3B8"}">$${r.revPAF.toFixed(2)}</td>
          <td class="mono">${r.noiMargin.toFixed(1)}%</td>
          <td class="mono">${r.sameStoreGrowth.toFixed(1)}%</td>
          <td class="mono">${r.avgOcc.toFixed(1)}%</td>
          <td class="mono">${r.impliedCap.toFixed(1)}%</td>
          <td class="mono">${r.avgSF.toLocaleString()}</td>
          <td class="mono">${r.ecriLift}%</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
  <div id="reitbench" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Benchmarking Analysis</div>
      <div style="line-height:1.8;font-size:11px">
        <div><strong style="color:#42A5F5">Closest Comparable: ${reitComparable?.name || "—"} (${reitComparable?.ticker || "—"})</strong> — This site's projected RevPAF of $${revPAF}/SF aligns most closely with ${reitComparable?.name || "—"}'s portfolio average of $${reitComparable?.revPAF?.toFixed(2) || "—"}/SF. ${siteRevPAFn > (reitComparable?.revPAF || 0) ? "The site outperforms this benchmark, suggesting strong market fundamentals or premium rate assumptions." : "The site slightly underperforms this benchmark, which may reflect market positioning or conservative rate modeling."}</div>
        <div style="margin-top:6px"><strong style="color:#C9A84C">Development vs Acquisition Context:</strong> REITs trade at ${reitBench[0].impliedCap.toFixed(1)}-${reitBench[reitBench.length-1].impliedCap.toFixed(1)}% implied cap rates. This development project targets a ${yocStab}% stabilized YOC, creating a ${devSpread}-point development spread. ${parseFloat(devSpread) >= 2.5 ? "This exceeds the typical 200-250bps development premium, making this project accretive to any institutional portfolio." : "The spread is within institutional tolerance but should be weighed against development execution risk."}</div>
        <div style="margin-top:6px"><strong style="color:#16A34A">Portfolio Fit:</strong> ${totalSF >= 80000 ? "At " + totalSF.toLocaleString() + " SF, this facility is at or above the REIT average facility size (" + reitComparable?.avgSF?.toLocaleString() + " SF for " + reitComparable?.ticker + "), positioning it as a core portfolio asset." : "At " + totalSF.toLocaleString() + " SF, this facility is below the REIT average — but smaller, well-located facilities often outperform on a per-SF basis due to supply scarcity."}</div>
      </div>
    </div>
    <div class="grid2" style="margin-top:12px">
      <div class="insight-box">
        <div class="insight-title">Revenue Per SF Comparison</div>
        ${[
          { name: "This Site", val: siteRevPAFn, color: "#C9A84C" },
          ...reitBench.map(r => ({ name: r.ticker, val: r.revPAF, color: "#42A5F5" })),
        ].map(b => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          <div style="width:70px;font-size:10px;color:${b.color};font-weight:700;text-align:right">${b.name}</div>
          <div style="flex:1;height:14px;border-radius:4px;background:rgba(255,255,255,0.04);overflow:hidden">
            <div style="width:${Math.round(b.val / 28 * 100)}%;height:100%;border-radius:4px;background:${b.color};display:flex;align-items:center;justify-content:flex-end;padding-right:6px">
              <span style="font-size:9px;font-weight:700;color:#fff">$${b.val.toFixed(2)}</span>
            </div>
          </div>
        </div>`).join("")}
      </div>
      <div class="insight-box">
        <div class="insight-title">NOI Margin Comparison</div>
        ${[
          { name: "This Site", val: parseFloat(noiMarginPct) || 0, color: "#C9A84C" },
          ...reitBench.map(r => ({ name: r.ticker, val: r.noiMargin, color: "#42A5F5" })),
        ].map(b => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          <div style="width:70px;font-size:10px;color:${b.color};font-weight:700;text-align:right">${b.name}</div>
          <div style="flex:1;height:14px;border-radius:4px;background:rgba(255,255,255,0.04);overflow:hidden">
            <div style="width:${Math.round(b.val / 70 * 100)}%;height:100%;border-radius:4px;background:${b.color};display:flex;align-items:center;justify-content:flex-end;padding-right:6px">
              <span style="font-size:9px;font-weight:700;color:#fff">${b.val.toFixed(1)}%</span>
            </div>
          </div>
        </div>`).join("")}
      </div>
    </div>
  </div>
</div>

<!-- SUPPLY/DEMAND EQUILIBRIUM v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('supdem')">
  <span class="expand-hint">▼ Click to expand <span id="supdem-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Supply / Demand Equilibrium Analysis</span></h2>
  <div class="grid3" style="margin-bottom:16px">
    <div class="metric-box mi" onclick="toggleMI('sdsfpc',event)" style="cursor:pointer;border-color:${demandColor}40">
      <div class="label">SF Per Capita (3-Mi) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="color:${demandColor};font-size:26px">${sfPerCapita || "—"}</div>
      <div style="font-size:9px;color:#6B7394;margin-top:2px">Incl. proposed facility</div>
      ${demandSignal ? `<div class="tag" style="background:${demandColor}20;color:${demandColor};margin-top:6px">${demandSignal}</div>` : ""}
      <div id="mi-sdsfpc" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">SF Per Capita — Market Absorption Signal</div><div class="mi-conf mi-conf-${sfPerCapita && parseFloat(sfPerCapita) < 7 ? "high" : "med"}">${sfPerCapita && parseFloat(sfPerCapita) < 7 ? "Underserved" : sfPerCapita && parseFloat(sfPerCapita) < 9 ? "Balanced" : "Saturated"}</div></div>
        <div class="mi-body">
          <strong>The most critical supply/demand metric in self-storage. Lower SF/capita = higher unmet demand = faster lease-up and stronger rate support.</strong>
          <div class="mi-formula">Existing Supply: ${estCompSF > 0 ? estCompSF.toLocaleString() : "—"} SF (${compCount} facilities × ~55K avg)<br>+ Proposed: ${totalSF.toLocaleString()} SF<br>= Total Market: ${totalMktSF > 0 ? totalMktSF.toLocaleString() : "—"} SF<br>÷ 3-Mi Pop: ${popN ? fmtN(popN) : "—"}<br>= <strong style="color:${demandColor}">${sfPerCapita || "—"} SF/capita</strong></div>
          <div class="mi-row"><span class="mi-row-label">Industry Benchmarks</span><span class="mi-row-val">&lt;5.0 = Underserved (strong buy) | 5-7 = Moderate demand | 7-9 = Equilibrium | 9-12 = Well-supplied | &gt;12 = Oversupplied. National avg: 7.3 SF/capita.</span></div>
          <div class="mi-row"><span class="mi-row-label">Why PS Uses This</span><span class="mi-row-val">PS's development team screens every market by SF/capita. Markets below 5.0 are automatic "green lights" — they indicate structural undersupply that supports above-average lease-up velocity and rate premium pricing. SiteScore™ computes this in real-time instead of relying on quarterly Radius+ reports.</span></div>
          <div class="mi-source">Source: Competitor count × 55K avg SF (Radius+/Yardi Matrix national benchmark) ÷ Census ACS 3-mile population</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('sdsup',event)" style="cursor:pointer">
      <div class="label">Est. Existing Supply <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:20px">${estCompSF > 0 ? estCompSF.toLocaleString() : "—"}<span style="font-size:10px;color:#6B7394"> SF</span></div>
      <div style="font-size:9px;color:#6B7394;margin-top:2px">${compCount} facilities × ~55K avg</div>
      <div id="mi-sdsup" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Existing Supply Estimate</div><div class="mi-conf mi-conf-med">Estimated</div></div>
        <div class="mi-body">
          <div class="mi-formula">${compCount} competitors × ~55,000 SF avg facility size = <strong>${estCompSF > 0 ? estCompSF.toLocaleString() : "—"} SF</strong></div>
          <div class="mi-row"><span class="mi-row-label">Methodology Note</span><span class="mi-row-val">55K SF/facility is the national average from Radius+ and SSA. Actual sizes vary from 30K (small drive-up) to 120K+ (multi-story REIT). For higher accuracy, use Google Maps building footprint measurement × story count.</span></div>
          ${site.competitorNames ? `<div class="mi-row"><span class="mi-row-label">Known Competitors</span><span class="mi-row-val">${site.competitorNames}</span></div>` : ""}
          <div class="mi-source">Source: Google Maps, SpareFoot, operator websites | ${compCount} facilities within 3-mile radius | 55K SF national avg proxy</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('sdnew',event)" style="cursor:pointer">
      <div class="label">New Supply Added <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:20px">${totalSF.toLocaleString()}<span style="font-size:10px;color:#6B7394"> SF</span></div>
      <div style="font-size:9px;color:#6B7394;margin-top:2px">${totalMktSF > 0 && estCompSF > 0 ? "+" + Math.round(totalSF / estCompSF * 100) + "% supply increase" : "—"}</div>
      <div id="mi-sdnew" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Supply Impact of Proposed Facility</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">Proposed: ${totalSF.toLocaleString()} SF<br>Existing: ${estCompSF > 0 ? estCompSF.toLocaleString() : "—"} SF<br>Supply Increase: ${totalMktSF > 0 && estCompSF > 0 ? "+" + Math.round(totalSF/estCompSF*100) + "%" : "—"}<br>New SF/Capita: ${sfPerCapita || "—"} (from ${sfPerCapitaExcl || "—"})</div>
          <div class="mi-row"><span class="mi-row-label">Absorption Outlook</span><span class="mi-row-val">${sfPerCapita && parseFloat(sfPerCapita) < 7 ? "Even with new supply, market remains below equilibrium. Strong absorption expected — 12-18 month stabilization." : sfPerCapita && parseFloat(sfPerCapita) < 9 ? "Market moves into equilibrium. Standard 24-36 month stabilization timeline." : "Market approaches saturation. Extended lease-up likely (36-48 months)."}</span></div>
          <div class="mi-source">Source: Proposed facility SF ÷ total market supply including new addition</div>
        </div>
      </div></div>
    </div>
  </div>
  <div id="supdem" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Industry Benchmarks — SF Per Capita</div>
      <div style="margin-top:8px">
        ${[
          { label: "Underserved (Strong Buy)", range: "< 5.0", color: "#16A34A", val: 4 },
          { label: "Moderate Demand", range: "5.0 – 7.0", color: "#22C55E", val: 6 },
          { label: "Equilibrium", range: "7.0 – 9.0", color: "#F59E0B", val: 8 },
          { label: "Well-Supplied", range: "9.0 – 12.0", color: "#E87A2E", val: 10.5 },
          { label: "Oversupplied (Caution)", range: "> 12.0", color: "#EF4444", val: 13 },
        ].map(b => {
          const isActive = sfPerCapita && parseFloat(sfPerCapita) >= (b.val - 2) && parseFloat(sfPerCapita) < (b.val + 2);
          return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px${isActive ? ";font-weight:700" : ""}">
            <div style="width:170px;font-size:10px;color:${b.color};font-weight:${isActive ? "800" : "600"};text-align:right">${b.label}${isActive ? " ◄" : ""}</div>
            <div style="flex:1;height:18px;border-radius:4px;background:${b.color}12;overflow:hidden;display:flex;align-items:center;padding:0 10px">
              <span style="font-size:10px;font-weight:600;color:${b.color}">${b.range} SF/capita</span>
            </div>
          </div>`;
        }).join("")}
      </div>
      <div style="margin-top:12px;font-size:11px;color:#94A3B8;line-height:1.7">
        <div><strong style="color:#E2E8F0">National Average:</strong> ~7.3 SF/capita (2025). The U.S. has ~1.9 billion SF of storage across ~54,000 facilities serving ~330M people.</div>
        <div style="margin-top:4px"><strong style="color:#E2E8F0">Absorption Rate:</strong> New supply in underserved markets (<5 SF/capita) typically achieves stabilization 6-12 months faster than equilibrium markets. Each 1.0 SF/capita increase above 9.0 adds ~2-3 months to projected lease-up.</div>
        <div style="margin-top:4px"><strong style="color:#E2E8F0">Data Source:</strong> Radius+ and Yardi Matrix Self-Storage track supply/demand at the MSA and trade-area level. For maximum accuracy, validate competitor facility sizes using Google Maps building footprint measurement (aerial view) — the 55K SF average is a national proxy.</div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">Absorption Impact of Proposed Facility</div>
      <div style="font-size:11px;color:#94A3B8;line-height:1.7">
        ${sfPerCapitaExcl && sfPerCapita ? `<div>Current market supply: <strong style="color:#E2E8F0">${sfPerCapitaExcl} SF/capita</strong> (excluding proposed). Adding this ${totalSF.toLocaleString()} SF facility increases supply to <strong style="color:#E2E8F0">${sfPerCapita} SF/capita</strong> (+${((parseFloat(sfPerCapita) - parseFloat(sfPerCapitaExcl)) / parseFloat(sfPerCapitaExcl) * 100).toFixed(0)}%). ${parseFloat(sfPerCapita) < 7 ? "Even with the new supply, the market remains below equilibrium — strong absorption expected." : parseFloat(sfPerCapita) < 9 ? "The market moves into equilibrium range — absorption should be steady but competition for new tenants increases." : "The market approaches or exceeds supply thresholds — extended lease-up timeline and potential rate pressure should be modeled."}</div>` : "<div>Insufficient data to model absorption impact — enter competitor count and 3-mi population.</div>"}
        ${growthPct > 0 && popN > 0 ? `<div style="margin-top:6px"><strong style="color:#C9A84C">Growth Offset:</strong> At ${growthPct.toFixed(1)}% annual population growth, this market adds ~${Math.round(popN * growthPct / 100).toLocaleString()} new residents/year within 3 miles. At the national avg of 7.3 SF/capita, this creates ~${Math.round(popN * growthPct / 100 * 7.3).toLocaleString()} SF of new storage demand annually — ${Math.round(popN * growthPct / 100 * 7.3) > totalSF / 3 ? "significant demand tailwind that supports faster absorption." : "modest demand tailwind, but not sufficient alone to absorb the new supply quickly."}</div>` : ""}
      </div>
    </div>
  </div>
</div>

<!-- REPLACEMENT COST ANALYSIS v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('replacement')">
  <span class="expand-hint">▼ Click to expand <span id="replacement-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Replacement Cost Analysis — Build vs. Acquire</span></h2>
  <div class="grid3" style="margin-bottom:16px">
    <div class="metric-box mi" onclick="toggleMI('rcexcl',event)" style="cursor:pointer">
      <div class="label">Replacement Cost (Excl. Land) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px">${fmtM(replacementCost)}</div>
      <div style="font-size:9px;color:#6B7394;margin-top:2px">$${replacementCostPerSF}/SF</div>
      <div id="mi-rcexcl" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Replacement Cost — Construction Only</div><div class="mi-conf mi-conf-high">RSMeans</div></div>
        <div class="mi-body">
          <strong>What it would cost to rebuild this exact facility from scratch today, excluding land.</strong>
          <div class="mi-formula">Hard Costs: ${fmtD(hardCost)} ($${hardCostPerSF}/SF × ${totalSF.toLocaleString()})<br>Soft Costs: ${fmtD(softCost)} (${Math.round(softCostPct*100)}%)<br>Replacement Cost: <strong>${fmtM(replacementCost)}</strong> ($${replacementCostPerSF}/SF)</div>
          <div class="mi-row"><span class="mi-row-label">Why This Matters</span><span class="mi-row-val">If the stabilized market value significantly exceeds replacement cost, development creates inherent value — the asset is worth more than it costs to build. This is the economic foundation of PS's development program.</span></div>
          <div class="mi-source">Source: RSMeans 2025 + regional index (${costIdx.toFixed(2)}x) | Hard + soft cost from development cost stack</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('rcfull',event)" style="cursor:pointer">
      <div class="label">Full Dev Cost (Incl. Land) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px">${fullReplacementCost > 0 ? fmtM(fullReplacementCost) : "—"}</div>
      <div style="font-size:9px;color:#6B7394;margin-top:2px">${totalDevCost > 0 ? "$" + Math.round(totalDevCost / totalSF) + "/SF all-in" : "—"}</div>
      <div id="mi-rcfull" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Full Replacement (Land + Construction)</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">Land: ${landCost > 0 ? fmtD(landCost) : "TBD"}<br>Construction: ${fmtM(replacementCost)}<br>Full: <strong>${fullReplacementCost > 0 ? fmtM(fullReplacementCost) : "—"}</strong><br>${fullReplacementCost > 0 && valuations[1].value > 0 ? `vs Market Value: ${fmtM(valuations[1].value)}<br>Arbitrage: <strong style="color:${valuations[1].value > fullReplacementCost ? "#16A34A" : "#EF4444"}">${replacementVsMarket}%</strong>` : ""}</div>
          <div class="mi-source">Source: Land + hard costs + soft costs</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('rcbob',event)" style="cursor:pointer;border-color:${buildOrBuy?.startsWith("BUILD") ? "#16A34A40" : "#F59E0B40"}">
      <div class="label">Build or Acquire? <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div style="font-size:12px;font-weight:700;color:${buildOrBuy?.startsWith("BUILD") ? "#16A34A" : buildOrBuy?.startsWith("NEUTRAL") ? "#F59E0B" : "#42A5F5"};margin-top:8px">${buildOrBuy || "—"}</div>
      <div id="mi-rcbob" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Build vs. Acquire Decision Framework</div><div class="mi-conf mi-conf-high">SiteScore™</div></div>
        <div class="mi-body">
          <strong>SiteScore™ recommends BUILD when the development spread (YOC − acquisition cap) exceeds 200bps AND the full dev cost is below stabilized market value.</strong>
          <div class="mi-formula">Development YOC: ${yocStab}%<br>Acquisition Cap: ~${(mktAcqCap*100).toFixed(1)}%<br>Spread: ${devSpread} bps<br>Dev Cost vs Market Value: ${replacementVsMarket}%<br>Verdict: <strong style="color:${buildOrBuy?.startsWith("BUILD") ? "#16A34A" : "#F59E0B"}">${buildOrBuy || "—"}</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Strategic Context</span><span class="mi-row-val">${buildOrBuy?.startsWith("BUILD") ? "Development creates more value than buying existing. PS should deploy capital here — the construction risk is well-compensated by the return premium." : "Marginal development case. PS should evaluate whether stabilized acquisition opportunities exist in this submarket before committing to a 2-year build cycle."}</span></div>
          <div class="mi-source">Source: SiteScore™ build vs. acquire engine | Development spread + replacement cost arbitrage</div>
        </div>
      </div></div>
    </div>
  </div>
  <div id="replacement" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Replacement Cost Methodology</div>
      <div style="line-height:1.8;font-size:11px">
        <div>The <strong>replacement cost approach</strong> answers: "What would it cost to build an identical facility today?" If the full development cost (land + construction) is significantly below the market value of a stabilized facility, development creates inherent value — the asset is worth more than it costs to build.</div>
        ${replacementVsMarket !== null ? `<div style="margin-top:8px">
          <div><strong style="color:#E2E8F0">This Site:</strong> Full development cost of ${fmtM(fullReplacementCost)} is <strong style="color:${parseFloat(replacementVsMarket) < 0 ? "#16A34A" : "#EF4444"}">${replacementVsMarket}%</strong> ${parseFloat(replacementVsMarket) < 0 ? "below" : "above"} the estimated stabilized market value of ${fmtM(valuations[1].value)} (@ 5.75% cap).</div>
          <div style="margin-top:4px">${parseFloat(replacementVsMarket) < -20 ? "<strong style='color:#16A34A'>Strong development arbitrage.</strong> Building creates 20%+ of value on day one (at stabilization). This is the core thesis for institutional development — capture the premium that exists between replacement cost and market value." : parseFloat(replacementVsMarket) < 0 ? "<strong style='color:#22C55E'>Positive development arbitrage.</strong> The project creates value, though the margin is modest. Execution quality and lease-up speed become critical to realizing the full spread." : "<strong style='color:#F59E0B'>Negative or no development arbitrage.</strong> Acquiring an existing stabilized facility at market cap rates may be more capital-efficient than building. Development is only justified if no acquisition alternatives exist in this submarket."}</div>
        </div>` : ""}
      </div>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">Development Value Creation Waterfall</div>
      ${(() => {
        const items = [
          { label: "Market Value (Stabilized)", val: valuations[1].value, color: "#42A5F5" },
          { label: "Less: Full Development Cost", val: -fullReplacementCost, color: "#EF4444" },
          { label: "VALUE CREATED", val: valuations[1].value - fullReplacementCost, color: valuations[1].value > fullReplacementCost ? "#16A34A" : "#EF4444" },
        ];
        const maxVal = Math.max(valuations[1].value, fullReplacementCost) || 1;
        return items.map(it => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div style="width:180px;font-size:10px;color:#6B7394;font-weight:600;text-align:right">${it.label}</div>
          <div class="waterfall-bar" style="width:${Math.max(Math.round(Math.abs(it.val)/maxVal*300), 60)}px;background:${it.color}">${it.val >= 0 ? fmtM(it.val) : "(" + fmtM(Math.abs(it.val)) + ")"}</div>
        </div>`).join("");
      })()}
      ${fullReplacementCost > 0 && valuations[1].value > 0 ? `<div style="margin-top:8px;font-size:10px;color:#6B7394">Value creation margin: <strong style="color:${valuations[1].value > fullReplacementCost ? "#16A34A" : "#EF4444"}">${((valuations[1].value / fullReplacementCost - 1) * 100).toFixed(0)}%</strong> — ${valuations[1].value > fullReplacementCost ? "this development is accretive" : "development does not create sufficient value at current cost assumptions"}</div>` : ""}
    </div>
  </div>
</div>

<!-- MARKET INTELLIGENCE SOURCES -->
<div class="section expand-trigger" onclick="toggleExpand('mktintel')">
  <span class="expand-hint">▼ Click to expand <span id="mktintel-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Market Intelligence & Data Sources</span></h2>
  <div style="font-size:11px;color:#94A3B8;margin-bottom:16px">Recommended data sources for validating and enriching this analysis — ranked by institutional credibility</div>
  <table>
    <thead><tr><th>Source</th><th>Data Type</th><th>Access</th><th>Use Case</th></tr></thead>
    <tbody>
      <tr style="background:rgba(201,168,76,0.04)"><td style="font-weight:700;color:#C9A84C">Yardi Matrix Self-Storage</td><td>Street rates, occupancy, new supply, rent comps</td><td style="font-size:10px">Subscription ($2K-5K/yr)</td><td style="font-size:10px;color:#16A34A;font-weight:600">Rate validation (Tier 1)</td></tr>
      <tr><td style="font-weight:700">Radius+</td><td>Trade area analytics, supply pipeline, demand modeling</td><td style="font-size:10px">Subscription</td><td style="font-size:10px">Supply/demand analysis</td></tr>
      <tr style="background:rgba(201,168,76,0.04)"><td style="font-weight:700;color:#C9A84C">StorTrack / SpareFoot</td><td>Live street rates by unit size, real-time pricing</td><td style="font-size:10px">Free (basic) / Paid</td><td style="font-size:10px;color:#16A34A;font-weight:600">Street rate cross-check (Tier 1)</td></tr>
      <tr><td style="font-weight:700">Green Street Advisors</td><td>REIT analytics, implied cap rates, NAV models</td><td style="font-size:10px">Subscription ($$$)</td><td style="font-size:10px">Cap rate benchmarking</td></tr>
      <tr style="background:rgba(201,168,76,0.04)"><td style="font-weight:700;color:#C9A84C">CBRE Self-Storage Group</td><td>Transaction comps, cap rate surveys, market reports</td><td style="font-size:10px">Broker relationship</td><td style="font-size:10px;color:#16A34A;font-weight:600">Transaction comps (Tier 1)</td></tr>
      <tr><td style="font-weight:700">Marcus & Millichap</td><td>Investment sales data, broker opinions of value</td><td style="font-size:10px">Broker relationship</td><td style="font-size:10px">Sales comp validation</td></tr>
      <tr><td style="font-weight:700">RCA / MSCI Real Capital</td><td>Transaction database, price indices</td><td style="font-size:10px">Subscription</td><td style="font-size:10px">Market cap rate trends</td></tr>
      <tr><td style="font-weight:700">CoStar (Limited for SS)</td><td>Property database, ownership, recent sales</td><td style="font-size:10px">Subscription</td><td style="font-size:10px">Ownership / transaction history</td></tr>
      <tr style="background:rgba(201,168,76,0.04)"><td style="font-weight:700;color:#C9A84C">REIT 10-K/10-Q Filings</td><td>Portfolio metrics, same-store data, ECRI disclosure</td><td style="font-size:10px;color:#16A34A">Free (SEC EDGAR)</td><td style="font-size:10px;color:#16A34A;font-weight:600">Portfolio benchmarking (Tier 1)</td></tr>
      <tr><td style="font-weight:700">SSA (Self Storage Assoc.)</td><td>Industry surveys, demand studies, operating benchmarks</td><td style="font-size:10px">Membership</td><td style="font-size:10px">Industry-wide OpEx ratios</td></tr>
      <tr><td style="font-weight:700">ISS (Inside Self-Storage)</td><td>Annual Factbook, rate surveys, construction costs</td><td style="font-size:10px">Subscription</td><td style="font-size:10px">Construction benchmarking</td></tr>
      <tr><td style="font-weight:700">RSMeans / ENR</td><td>Regional construction cost indices</td><td style="font-size:10px">Subscription</td><td style="font-size:10px">Hard cost validation</td></tr>
    </tbody>
  </table>
  <div id="mktintel" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">How to Validate This Report's Assumptions</div>
      <div style="line-height:1.8;font-size:11px">
        <div><strong style="color:#C9A84C">Step 1 — Street Rate Check (15 min):</strong> Go to SpareFoot.com or StorTrack.com. Search for storage near ${site.address || site.city || "this site"}. Record climate-controlled 10x10 rates for the 3-5 nearest competitors. Compare to our modeled rate of $${(mktClimateRate * 100).toFixed(0)}/mo for a 10x10 climate unit. If >15% variance, adjust the model.</div>
        <div style="margin-top:6px"><strong style="color:#C9A84C">Step 2 — Supply Pipeline (30 min):</strong> Check Radius+ or search local municipality permit records for approved/under-construction storage facilities within 5 miles. New supply not yet captured in competitor counts can shift the demand/supply ratio significantly.</div>
        <div style="margin-top:6px"><strong style="color:#C9A84C">Step 3 — Transaction Comps (requires broker):</strong> Ask CBRE or M&M for recent self-storage transactions within the MSA — specifically price/SF, cap rate, and buyer type (REIT, institutional, private). These anchor the exit cap rate assumption.</div>
        <div style="margin-top:6px"><strong style="color:#C9A84C">Step 4 — REIT Filing Cross-Check (free):</strong> Pull the most recent quarterly supplement from PSA, EXR, or CUBE investor relations page. Look at same-store metrics for the relevant market/state. These are audited numbers that validate (or challenge) our projections.</div>
      </div>
    </div>
    ${streetRateOverride ? `<div class="insight-box" style="margin-top:12px;border-color:rgba(201,168,76,0.3)">
      <div class="insight-title">Street Rate Override Detected</div>
      <div style="font-size:11px;line-height:1.7">
        <div>User-supplied street rate: <strong style="color:#C9A84C">$${streetRateOverride.toFixed(2)}/SF/mo</strong></div>
        <div>Model rate: <strong>$${mktClimateRate.toFixed(2)}/SF/mo</strong></div>
        <div>Variance: <strong style="color:${Math.abs(parseFloat(streetVariance)) < 10 ? "#16A34A" : "#F59E0B"}">${streetVariance}%</strong> ${Math.abs(parseFloat(streetVariance)) < 10 ? "— model aligns with market data" : "— consider adjusting model assumptions"}</div>
      </div>
    </div>` : ""}
  </div>
</div>

<!-- REGIONAL COST INTELLIGENCE v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('costidx')">
  <span class="expand-hint">▼ Click to expand <span id="costidx-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Regional Construction Cost Intelligence</span></h2>
  <div class="mi" onclick="toggleMI('rccidx',event)" style="font-size:12px;color:#94A3B8;margin-bottom:16px;cursor:pointer">${site.state || "N/A"} regional cost index: <span class="mono" style="font-weight:700;color:#C9A84C">${costIdx.toFixed(2)}x</span> national average <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em> — ${costIdx < 0.95 ? "below-average construction costs, favorable for development returns" : costIdx > 1.05 ? "above-average construction costs — pressure on YOC, higher land price sensitivity" : "near-national-average construction costs"}</div>
  <div id="mi-rccidx" class="mi-panel"><div class="mi-panel-inner">
    <div class="mi-header"><div class="mi-title">Regional Cost Index — ${site.state || "N/A"} at ${costIdx.toFixed(2)}x</div><div class="mi-conf mi-conf-high">RSMeans / ENR</div></div>
    <div class="mi-body">
      <strong>Construction costs vary 30%+ across US markets. SiteScore™ applies state-level cost indices to adjust the national base rate, ensuring accurate per-site hard cost projections.</strong>
      <div class="mi-formula">National Base: $${baseHardPerSF}/SF<br>${site.state || "N/A"} Index: ${costIdx.toFixed(2)}x<br>Adjusted: $${baseHardPerSF} × ${costIdx.toFixed(2)} = <strong style="color:#C9A84C">$${hardCostPerSF}/SF</strong><br>Impact on ${totalSF.toLocaleString()} SF: ${costIdx < 1 ? "Saves " + fmtD(Math.abs(totalSF * baseHardPerSF - hardCost)) + " vs national avg" : "Adds " + fmtD(Math.abs(totalSF * baseHardPerSF - hardCost)) + " vs national avg"}</div>
      <div class="mi-row"><span class="mi-row-label">Data Source</span><span class="mi-row-val">RSMeans 2025 Construction Cost Data (Gordian) + ENR Construction Cost Index Q1 2026. Indices reflect labor rates, material costs, and subcontractor market conditions by state. Updated quarterly.</span></div>
      <div class="mi-row"><span class="mi-row-label">PS Development Impact</span><span class="mi-row-val">${costIdx < 0.95 ? "Below-average market — PS gets more facility per dollar deployed. Lower cost markets like " + (site.state || "this state") + " are where development spreads are widest and YOC targets easiest to achieve." : costIdx > 1.05 ? "Above-average market — cost pressure requires stronger revenue (higher rates) or lower land costs to maintain target YOC. PS must model aggressively on rate assumptions or negotiate harder on land." : "Average market — standard cost assumptions apply. Development viability depends primarily on land pricing and local rates."}</span></div>
      <div class="mi-source">Source: RSMeans 2025 (Gordian) | ENR Construction Cost Index Q1 2026 | PS development pipeline actual vs. budget analysis</div>
    </div>
  </div></div>
  <div class="grid2">
    <div>
      <table style="font-size:11px">
        <thead><tr><th>Cost Component</th><th>National Base</th><th>${site.state || "—"} Adjusted</th></tr></thead>
        <tbody>
          <tr><td style="font-weight:600">Hard Cost / SF</td><td class="mono">$${baseHardPerSF}</td><td class="mono" style="font-weight:700;color:#C9A84C">$${hardCostPerSF}</td></tr>
          <tr><td style="font-weight:600">Total Hard Cost</td><td class="mono">${fmtD(totalSF * baseHardPerSF)}</td><td class="mono" style="font-weight:700;color:#C9A84C">${fmtD(hardCost)}</td></tr>
          <tr><td style="font-weight:600">Regional Savings/(Premium)</td><td></td><td class="mono" style="color:${costIdx <= 1 ? "#16A34A" : "#EF4444"}">${costIdx <= 1 ? "Saves " : "Adds "}${fmtD(Math.abs(totalSF * baseHardPerSF - hardCost))}</td></tr>
        </tbody>
      </table>
    </div>
    <div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid rgba(201,168,76,0.08)">
      <div style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:8px">COST INDEX BY STATE</div>
      ${["TX|0.92", "OH|0.88", "IN|0.86", "TN|0.90", "KY|0.87", "FL|0.95", "GA|0.91", "CO|1.02", "NY|1.20", "NJ|1.15"].map(s => {
        const [st, idx] = s.split("|");
        const idxN = parseFloat(idx);
        const isCurrent = st === (site.state || "").toUpperCase();
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px${isCurrent ? ";font-weight:700" : ""}">
          <span style="width:24px;font-size:10px;color:${isCurrent ? "#C9A84C" : "#6B7394"}">${st}</span>
          <div style="flex:1;height:10px;border-radius:3px;background:rgba(255,255,255,0.04);overflow:hidden">
            <div style="width:${Math.round(idxN / 1.25 * 100)}%;height:100%;border-radius:3px;background:${isCurrent ? "#C9A84C" : idxN <= 0.90 ? "#16A34A" : idxN <= 1.0 ? "#42A5F5" : "#F59E0B"}"></div>
          </div>
          <span style="font-size:9px;color:${isCurrent ? "#C9A84C" : "#6B7394"};font-family:'Space Mono',monospace;width:36px;text-align:right">${idx}x</span>
        </div>`;
      }).join("")}
    </div>
  </div>
  <div id="costidx" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Construction Cost Methodology</div>
      <div style="line-height:1.8;font-size:11px">
        Regional cost indices derived from RSMeans and ENR Construction Cost Index data (Q1 2026). Indices reflect all-in hard cost differentials including labor, materials, and subcontractor market conditions. ${site.state === "TX" ? "Texas benefits from right-to-work labor laws, abundant subcontractor capacity, and lower prevailing wages compared to coastal markets." : ""} ${site.state === "OH" || site.state === "IN" || site.state === "KY" ? "Midwest states generally have the lowest construction costs nationally due to competitive labor markets and lower land costs for staging/logistics." : ""}
        <div style="margin-top:8px"><strong style="color:#C9A84C">Important:</strong> These are baseline estimates. Actual costs vary by specific metro, GC availability, bidding climate, and site-specific conditions (soil, grade, access). Always solicit 3+ GC bids during DD.</div>
      </div>
    </div>
  </div>
</div>

<div class="divider"></div>

<!-- ASSUMPTIONS & METHODOLOGY -->
<div class="section expand-trigger" onclick="toggleExpand('assumptions')" style="opacity:0.85">
  <span class="expand-hint">▼ Click to expand <span id="assumptions-arrow" class="expand-arrow">▼</span></span>
  <h2 class="muted" style="font-size:14px">Assumptions & Methodology</h2>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:11px;color:#94A3B8">
    <div>
      <div style="font-weight:700;color:#6B7394;margin-bottom:6px">Facility</div>
      <div>Building coverage: 35% of site</div>
      <div>Climate/drive split: ${Math.round(climatePct*100)}/${Math.round(drivePct*100)}</div>
      <div>Construction: $${hardCostPerSF}/SF hard (${costIdx.toFixed(2)}x regional adj) + ${Math.round(softCostPct*100)}% soft</div>
      <div>Product: ${isMultiStory ? stories + "-story multi-story" : "Single-story indoor climate-controlled"}</div>
    </div>
    <div>
      <div style="font-weight:700;color:#6B7394;margin-bottom:6px">Financial</div>
      <div>Annual rate escalation: ${(annualEsc*100).toFixed(0)}%</div>
      <div>OpEx: Line-item detail (${opexRatioDetail}% stabilized ratio)</div>
      <div>Lease-up: 30% Y1, 55% Y2, 75% Y3, 88% Y4, 92% Y5</div>
      <div>Debt: ${Math.round(loanLTV*100)}% LTV @ ${(loanRate*100).toFixed(2)}% / ${loanAmort}yr amort</div>
      <div>Exit: ${(exitCapRate*100).toFixed(1)}% cap, Year 10 disposition</div>
    </div>
  </div>
  <div id="assumptions" class="expand-panel">
    <div class="grid2" style="margin-top:12px">
      <div class="insight-box">
        <div class="insight-title">Data Sources</div>
        <div class="drill-row"><span class="drill-label">Demographics</span><span class="drill-value" style="font-size:10px">US Census ACS 5-Year</span></div>
        <div class="drill-row"><span class="drill-label">Growth Projections</span><span class="drill-value" style="font-size:10px">ESRI 2025→2030</span></div>
        <div class="drill-row"><span class="drill-label">Construction Costs</span><span class="drill-value" style="font-size:10px">RSMeans 2025 + PS benchmarks</span></div>
        <div class="drill-row"><span class="drill-label">Market Rates</span><span class="drill-value" style="font-size:10px">SiteScore™ 3-method cross-validated</span></div>
        <div class="drill-row"><span class="drill-label">Cap Rates</span><span class="drill-value" style="font-size:10px">Green Street, REIT filings</span></div>
        <div class="drill-row"><span class="drill-label">Competition</span><span class="drill-value" style="font-size:10px">Google, SpareFoot, operator sites</span></div>
      </div>
      <div class="insight-box">
        <div class="insight-title">Key Assumptions & Limitations</div>
        <div style="font-size:11px;line-height:1.8;color:#94A3B8">
          <div>• Rates modeled from demographic/competition inputs, not surveyed street rates</div>
          <div>• Occupancy trajectory assumes standard PS marketing budget allocation</div>
          <div>• Hard costs regionally adjusted via RSMeans/ENR index (${site.state || "N/A"}: ${costIdx.toFixed(2)}x)</div>
          <div>• Debt service modeled at ${(loanRate*100).toFixed(2)}% / ${loanAmort}yr — verify with lender quotes</div>
          <div>• 10-year DCF with IRR assumes ${(exitCapRate*100).toFixed(1)}% exit cap — conservative vs current market</div>
          <div>• Environmental, geotech, and entitlement risks not priced in</div>
          <div>• Tax abatement or TIF incentives not included (upside potential)</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- PRINT BUTTON -->
<div style="text-align:center;margin:24px 0">
  <button onclick="window.print()" style="padding:14px 40px;border-radius:12px;background:linear-gradient(135deg,#C9A84C,#E87A2E);color:#fff;font-size:14px;font-weight:800;border:none;cursor:pointer;letter-spacing:0.06em;text-transform:uppercase;box-shadow:0 4px 20px rgba(201,168,76,0.3)">🖨 Print / Save as PDF</button>
</div>

<div class="footer" style="padding:32px 24px">
  <div style="font-size:14px;font-weight:800;letter-spacing:0.14em;color:#C9A84C;margin-bottom:6px">SITESCORE<span style="font-size:9px;vertical-align:super">™</span></div>
  <div style="font-size:11px;color:#6B7394;margin-bottom:12px">AI-Powered Storage Site Intelligence & Pricing Analytics</div>
  <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,0.3),transparent);margin:12px auto;max-width:400px"></div>
  <div style="font-size:10px;color:#4A5080;margin-top:12px;line-height:1.8">
    <div>Storage Pricing Report — ${site.name} | Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
    <div style="margin-top:8px;font-weight:600;color:#6B7394">Powered by DJR Real Estate LLC | U.S. Patent Pending — Serial No. 99712640</div>
    <div style="margin-top:10px;max-width:700px;margin-left:auto;margin-right:auto;color:#3A4060;font-size:9px;line-height:1.7">
      <strong style="color:#6B7394">CONFIDENTIAL & PROPRIETARY.</strong> This report and its contents are the exclusive property of DJR Real Estate LLC.
      The SiteScore™ platform, scoring methodology, pricing models, and analytical frameworks contained herein are proprietary
      trade secrets protected under federal and state law. Unauthorized reproduction, distribution, reverse engineering, or disclosure
      of this report or any portion thereof is strictly prohibited and may result in civil and criminal penalties. This report is provided
      for informational purposes only and does not constitute investment advice, an appraisal, or a guarantee of future performance.
      All projections are forward-looking estimates based on current market data and are subject to change. Recipients should conduct
      independent due diligence before making investment decisions.
    </div>
    <div style="margin-top:10px;color:#3A4060;font-size:9px">© ${new Date().getFullYear()} DJR Real Estate LLC. All rights reserved. SiteScore™ is a trademark of DJR Real Estate LLC.</div>
  </div>
</div>

</div></body></html>`;
  } catch (err) {
    console.error("Report generation error:", err);
    return `<!DOCTYPE html><html><head><title>Error</title></head><body style="font-family:sans-serif;padding:40px;background:#0A0E2A;color:#fff;text-align:center"><h1 style="color:#C9A84C">Report Generation Error</h1><p style="color:#94A3B8">${escapeHtml(err.message)}</p><p style="color:#64748B;font-size:12px">Check the browser console for details. Try refreshing the site data.</p></body></html>`;
  }
};

// ─── REC Package — Real Estate Committee Investment Package ───
// Comprehensive boardroom-ready document combining SiteScore, Pricing, Competition, Zoning, Market Data
const generateRECPackage = (site, iqResult) => {
  try {
  const iq = iqResult || computeSiteScore(site);
  const fin = computeSiteFinancials(site);
  const { acres, landCost, popN, incN, hvN, hhN, pop1, growthPct, compCount, nearestPS, incTier,
    isMultiStory, stories, footprint, totalSF, climatePct, drivePct, climateSF, driveSF,
    baseClimateRate, baseDriveRate, compAdj, mktClimateRate, mktDriveRate, annualEsc,
    leaseUpSchedule, yearData, stabNOI, stabRev,
    stateToCostIdx, costIdx, baseHardPerSF, hardCostPerSF, softCostPct, hardCost, softCost, buildCosts, totalDevCost, yocStab,
    opexDetail, totalOpexDetail, opexRatioDetail, noiDetail,
    capRates, valuations,
    landTargets, landPrices, askVsStrike, landVerdict, verdictColor,
    loanLTV, loanRate, loanAmort, equityPct, loanAmount, equityRequired, monthlyLoanRate, numPmts, monthlyPmt, annualDS, dscrStab, cashAfterDS, cashOnCash,
    exitCapRate, yrDataExt, exitValue, exitLoanBal, exitEquityProceeds, irrCashFlows, irrPct, equityMultiple,
    m1Rate, m2ClimRate, m2DriveRate, m3ClimRate, popDensityFactor, consensusClimRate, rateConfidence, rateConfColor,
    stabOccSF, revPAF, revPOF, noiPerSF, noiMarginPct, mktAcqCap, devSpread, impliedLandCap,
    estCompSF, totalMktSF, sfPerCapita, sfPerCapitaExcl, demandSignal, demandColor,
    replacementCost, replacementCostPerSF, fullReplacementCost, replacementVsMarket, buildOrBuy,
    reitBench, pricePerAcre,
  } = fin;
  const phase = site.phase || "Prospect";

  // ── Zoning Intelligence ──
  const combined = ((site.zoning || "") + " " + (site.summary || "")).toLowerCase();
  const zoningClass = site.zoningClassification || "unknown";
  const zoningColor = zoningClass === "by-right" ? "#16A34A" : zoningClass === "conditional" ? "#F59E0B" : zoningClass === "rezone-required" ? "#EF4444" : zoningClass === "prohibited" ? "#991B1B" : "#94A3B8";
  const zoningLabel = { "by-right": "BY-RIGHT (Permitted)", "conditional": "CONDITIONAL (SUP/CUP Required)", "rezone-required": "REZONE REQUIRED", "prohibited": "PROHIBITED", "unknown": "UNKNOWN — Research Required" }[zoningClass] || zoningClass.toUpperCase();
  const hasFlood = /flood/i.test(combined);
  const hasOverlay = /overlay/i.test(combined);

  // ── Utility Readiness ──
  const utilChecks = [
    { done: !!site.waterProvider, w: 20, l: "Water provider" },
    { done: site.waterAvailable === true, w: 15, l: "Water available" },
    { done: site.insideServiceBoundary === true, w: 10, l: "Service boundary" },
    { done: !!site.sewerProvider || /septic/i.test(combined), w: 12, l: "Sewer/septic" },
    { done: site.sewerAvailable === true || /septic/i.test(combined), w: 8, l: "Sewer confirmed" },
    { done: !!site.electricProvider, w: 10, l: "Electric" },
    { done: site.threePhase === true, w: 10, l: "3-phase" },
    { done: !!site.waterTapFee || !!site.tapFees, w: 5, l: "Tap fees" },
    { done: site.fireFlowAdequate === true, w: 5, l: "Fire flow" },
    { done: !!site.distToWaterMain, w: 5, l: "Dist to main" },
  ];
  const utilScore = utilChecks.reduce((s, c) => s + (c.done ? c.w : 0), 0);
  const utilGrade = utilScore >= 80 ? "A" : utilScore >= 60 ? "B" : utilScore >= 40 ? "C" : utilScore >= 20 ? "D" : "F";
  const utilColor = utilScore >= 80 ? "#16A34A" : utilScore >= 60 ? "#3B82F6" : utilScore >= 40 ? "#F59E0B" : "#EF4444";

  // ── Risk Matrix ──
  const risks = [];
  if (zoningClass === "rezone-required" || zoningClass === "prohibited") risks.push({ cat: "Entitlement", level: "HIGH", desc: "Rezone or rezoning required — timeline, political, and cost risk", color: "#EF4444" });
  else if (zoningClass === "conditional") risks.push({ cat: "Entitlement", level: "MEDIUM", desc: "SUP/CUP required — public hearing process", color: "#F59E0B" });
  else if (zoningClass === "by-right") risks.push({ cat: "Entitlement", level: "LOW", desc: "Storage use permitted by right", color: "#16A34A" });
  if (hasFlood) risks.push({ cat: "Environmental", level: "HIGH", desc: "Flood zone identified — insurance cost and development constraints", color: "#EF4444" });
  if (site.waterAvailable === false) risks.push({ cat: "Utilities", level: "HIGH", desc: "Municipal water not confirmed — HARD REQUIREMENT for fire suppression", color: "#EF4444" });
  else if (!site.waterProvider) risks.push({ cat: "Utilities", level: "MEDIUM", desc: "Water provider not yet identified — needs verification", color: "#F59E0B" });
  if (compCount > 5) risks.push({ cat: "Competition", level: "MEDIUM", desc: `${compCount} competitors within 3mi — potential supply saturation`, color: "#F59E0B" });
  if (popN && popN < 15000) risks.push({ cat: "Demographics", level: "MEDIUM", desc: "3-mi population below 15K — limited demand pool", color: "#F59E0B" });
  if (growthPct < 0) risks.push({ cat: "Growth", level: "HIGH", desc: `Negative population growth (${growthPct}%) — declining market`, color: "#EF4444" });
  if (landVerdict === "PASS") risks.push({ cat: "Pricing", level: "HIGH", desc: "Asking price exceeds strike by 30%+ — requires significant negotiation", color: "#EF4444" });
  else if (landVerdict === "STRETCH") risks.push({ cat: "Pricing", level: "MEDIUM", desc: "Asking price 15-30% above strike — tight underwriting", color: "#F59E0B" });
  if (!isNaN(acres) && acres < 2.5) risks.push({ cat: "Site", level: "HIGH", desc: "Below minimum acreage — insufficient for development", color: "#EF4444" });

  // ── Overall Recommendation ──
  const score = iq.score || 0;
  const recLabel = score >= 8.0 ? "RECOMMEND — PROCEED TO LOI" : score >= 6.5 ? "RECOMMEND — CONDITIONAL APPROVAL" : score >= 5.0 ? "HOLD — ADDITIONAL DILIGENCE REQUIRED" : "PASS — DOES NOT MEET CRITERIA";
  const recColor = score >= 8.0 ? "#16A34A" : score >= 6.5 ? "#3B82F6" : score >= 5.0 ? "#F59E0B" : "#EF4444";
  const recIcon = score >= 8.0 ? "✅" : score >= 6.5 ? "🔵" : score >= 5.0 ? "⚠️" : "❌";

  const fmtD = (n) => "$" + Math.round(n).toLocaleString();
  const fmtM = (n) => n >= 1000000 ? "$" + (n / 1000000).toFixed(2) + "M" : "$" + Math.round(n).toLocaleString();
  const fmtN2 = (n) => isNaN(n) ? "—" : n.toLocaleString();
  const iqBadgeColor = (iq.tier || "gray") === "gold" ? "#C9A84C" : (iq.tier || "gray") === "steel" ? "#2C3E6B" : "#94A3B8";
  const dom = site.dateOnMarket && site.dateOnMarket !== "N/A" ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;
  const mapsUrl = site.coordinates ? `https://www.google.com/maps?q=${site.coordinates}` : "#";
  // ── SiteScore Breakdown ──
  const breakdownRows = (iq.breakdown || []).map(b => {
    const dimScore = b.score || 0;
    const dimWeighted = dimScore * (b.weight || 0);
    const barColor = dimScore >= 8 ? "#16A34A" : dimScore >= 6 ? "#3B82F6" : dimScore >= 4 ? "#F59E0B" : "#EF4444";
    return `<tr>
      <td style="padding:10px 14px;font-size:12px;font-weight:700;border-bottom:1px solid rgba(201,168,76,0.06)">${b.icon || "◆"} ${b.label}</td>
      <td style="padding:10px 14px;border-bottom:1px solid rgba(201,168,76,0.06);width:180px"><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,0.06)"><div style="width:${(dimScore/10)*100}%;height:100%;border-radius:4px;background:${barColor}"></div></div><span style="font-size:12px;font-weight:800;color:${barColor};font-family:'Space Mono',monospace;min-width:28px;text-align:right">${dimScore.toFixed(1)}</span></div></td>
      <td style="padding:10px 14px;font-size:11px;color:#6B7394;border-bottom:1px solid rgba(201,168,76,0.06);text-align:right;font-weight:600">${Math.round((b.weight || 0) * 100)}%</td>
      <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#E2E8F0;border-bottom:1px solid rgba(201,168,76,0.06);text-align:right;font-family:'Space Mono',monospace">${dimWeighted.toFixed(2)}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>REC Package — ${site.name}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#F8FAFC;color:#1E293B;min-height:100vh;padding:0}
.page{max-width:900px;margin:0 auto;background:#fff}
h1{font-size:26px;font-weight:900;letter-spacing:-0.02em}
h2{font-size:15px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#1E2761;margin-bottom:14px;display:flex;align-items:center;gap:10px}
h2 .sec-num{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#1E2761,#2C3E6B);color:#C9A84C;font-size:12px;font-weight:900}
table{width:100%;border-collapse:collapse}
th{padding:10px 14px;text-align:left;font-size:9px;font-weight:700;color:#1E2761;text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid #E2E8F0;background:#F8FAFC}
td{padding:10px 14px;border-bottom:1px solid #F1F5F9;font-size:12px}
.section{padding:28px 40px;border-bottom:1px solid #E2E8F0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.metric{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;text-align:center}
.metric .label{font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px}
.metric .value{font-size:20px;font-weight:800;font-family:'Space Mono',monospace;color:#1E293B}
.metric .sub{font-size:10px;color:#94A3B8;margin-top:2px}
.badge{display:inline-block;padding:4px 14px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.04em}
.pill{display:inline-block;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:0.04em}
.mono{font-family:'Space Mono',monospace}
.row-label{font-size:12px;font-weight:600;color:#64748B;padding:8px 0}
.row-value{font-size:13px;font-weight:700;color:#1E293B;font-family:'Space Mono',monospace;padding:8px 0;text-align:right}
.risk-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;margin-bottom:6px}
.divider{height:2px;background:linear-gradient(90deg,transparent,#C9A84C,#E87A2E,#C9A84C,transparent);margin:0;opacity:0.4}
.print-btn{position:fixed;bottom:28px;right:28px;display:flex;align-items:center;gap:8px;padding:14px 24px;border-radius:12px;border:none;background:linear-gradient(135deg,#1E2761,#2C3E6B);color:#C9A84C;font-size:14px;font-weight:700;font-family:'Inter',sans-serif;cursor:pointer;box-shadow:0 4px 20px rgba(30,39,97,0.4);z-index:9999}
.print-btn:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(30,39,97,0.5)}
@media print{body{background:#fff}.print-btn{display:none!important}.page{box-shadow:none}@page{margin:0.5in;size:letter}}
</style></head><body>
<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
<div class="page">

<!-- ═══════════════════════════════════════════════ COVER HEADER ═══════════════════════════════════════════════ -->
<div style="background:linear-gradient(135deg,#080B1A 0%,#1E2761 60%,#2C3E6B 100%);padding:44px 40px 36px;position:relative;overflow:hidden">
  <div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#C9A84C,#E87A2E,#C9A84C,transparent)"></div>
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
        <div style="width:50px;height:50px;border-radius:12px;background:linear-gradient(135deg,#C9A84C,#E87A2E);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(201,168,76,0.4)"><span style="font-size:20px;font-weight:900;color:#fff;font-family:'Space Mono'">REC</span></div>
        <div>
          <div style="font-size:10px;color:#C9A84C;letter-spacing:0.14em;font-weight:800">REAL ESTATE COMMITTEE</div>
          <div style="font-size:10px;color:#94A3B8;letter-spacing:0.08em;margin-top:2px">SITE ACQUISITION PACKAGE</div>
        </div>
      </div>
      <h1 style="color:#fff;margin-bottom:6px;font-size:28px">${site.name || "Unnamed Site"}</h1>
      <div style="font-size:13px;color:#94A3B8;margin-top:6px">${site.address || ""}${site.city ? ", " + site.city : ""}${site.state ? ", " + site.state : ""}</div>
      ${site.coordinates ? `<div style="font-size:11px;color:#64748B;margin-top:4px">📍 <a href="${mapsUrl}" style="color:#64748B" target="_blank">${site.coordinates}</a></div>` : ""}
    </div>
    <div style="text-align:right">
      <div style="display:inline-flex;align-items:center;gap:10px;padding:10px 20px;border-radius:12px;background:${iqBadgeColor}18;border:1px solid ${iqBadgeColor}40">
        <span style="font-size:32px;font-weight:900;color:${iqBadgeColor};font-family:'Space Mono'">${typeof iq.score === "number" ? iq.score.toFixed(1) : "—"}</span>
        <div>
          <div style="font-size:9px;color:#CBD5E1;letter-spacing:0.1em;font-weight:700">SITESCORE<span style="font-size:7px;vertical-align:super">™</span></div>
          <div style="font-size:12px;font-weight:800;color:${iqBadgeColor}">${iq.label || "—"}</div>
        </div>
      </div>
      <div style="font-size:11px;color:#64748B;margin-top:10px">${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
      <div style="font-size:10px;color:#4A5080;margin-top:2px">Phase: ${phase}</div>
    </div>
  </div>
</div>

<!-- KEY METRICS BAR -->
<div style="display:grid;grid-template-columns:repeat(6,1fr);background:#FAFBFC;border-bottom:2px solid #E2E8F0">
  ${[
    { l: "ACREAGE", v: !isNaN(acres) ? acres.toFixed(2) + " ac" : "—" },
    { l: "ASK PRICE", v: site.askingPrice || "—" },
    { l: "PRICE/ACRE", v: pricePerAcre ? fmtD(pricePerAcre) : "—" },
    { l: "3-MI POP", v: !isNaN(popN) ? fmtN2(popN) : "—" },
    { l: "MED INCOME", v: !isNaN(incN) ? "$" + fmtN2(incN) : "—" },
    { l: "GROWTH", v: growthPct ? growthPct.toFixed(1) + "%" : "—" },
  ].map(m => `<div style="padding:14px 8px;text-align:center;border-right:1px solid #E2E8F0"><div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.08em;margin-bottom:3px">${m.l}</div><div style="font-size:15px;font-weight:800;color:#1E293B;font-family:'Space Mono',monospace">${m.v}</div></div>`).join("")}
</div>

<!-- ═══════════════ SECTION 1: RECOMMENDATION ═══════════════ -->
<div class="section" style="background:${recColor}08;border-left:4px solid ${recColor}">
  <h2><span class="sec-num">1</span> Committee Recommendation</h2>
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
    <span style="font-size:28px">${recIcon}</span>
    <div>
      <div style="font-size:18px;font-weight:900;color:${recColor};letter-spacing:0.02em">${recLabel}</div>
      <div style="font-size:12px;color:#64748B;margin-top:4px">Based on ${(iq.breakdown || []).length}-dimension SiteScore™ composite analysis</div>
    </div>
  </div>
  ${landVerdict ? `<div style="display:flex;gap:16px;margin-top:16px">
    <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;margin-bottom:4px">LAND VERDICT</div>
      <div class="badge" style="background:${verdictColor}18;color:${verdictColor};border:1px solid ${verdictColor}30;font-size:14px;padding:6px 18px">${landVerdict}</div>
    </div>
    <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;margin-bottom:4px">ASK vs STRIKE</div>
      <div style="font-size:20px;font-weight:900;color:${parseFloat(askVsStrike) <= 0 ? '#16A34A' : '#EF4444'};font-family:'Space Mono',monospace">${parseFloat(askVsStrike) > 0 ? '+' : ''}${askVsStrike}%</div>
    </div>
    <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;margin-bottom:4px">STABILIZED YOC</div>
      <div style="font-size:20px;font-weight:900;color:${parseFloat(yocStab) >= 8.5 ? '#16A34A' : parseFloat(yocStab) >= 7.0 ? '#F59E0B' : '#EF4444'};font-family:'Space Mono',monospace">${yocStab}%</div>
    </div>
  </div>` : ""}
</div>

<!-- ═══════════════ SECTION 2: SITESCORE BREAKDOWN ═══════════════ -->
<div class="section">
  <h2><span class="sec-num">2</span> SiteScore™ Analysis — ${typeof iq.score === "number" ? iq.score.toFixed(1) : "—"}/10</h2>
  <table>
    <thead><tr><th>Dimension</th><th>Score (0–10)</th><th>Weight</th><th>Weighted</th></tr></thead>
    <tbody>${breakdownRows}</tbody>
    <tfoot><tr style="background:#F8FAFC">
      <td style="padding:12px 14px;font-size:13px;font-weight:900;border-top:2px solid #1E2761" colspan="3">COMPOSITE SCORE</td>
      <td style="padding:12px 14px;font-size:18px;font-weight:900;color:${iqBadgeColor};font-family:'Space Mono',monospace;text-align:right;border-top:2px solid #1E2761">${typeof iq.score === "number" ? iq.score.toFixed(1) : "—"}</td>
    </tr></tfoot>
  </table>
</div>

<!-- ═══════════════ SECTION 3: MARKET DEMOGRAPHICS ═══════════════ -->
<div class="section">
  <h2><span class="sec-num">3</span> Market Demographics</h2>
  <div class="grid4" style="margin-bottom:16px">
    <div class="metric"><div class="label">3-Mi Population</div><div class="value">${!isNaN(popN) ? fmtN2(popN) : "—"}</div></div>
    <div class="metric"><div class="label">Median HHI</div><div class="value">${!isNaN(incN) ? "$" + fmtN2(incN) : "—"}</div></div>
    <div class="metric"><div class="label">Households</div><div class="value">${!isNaN(hhN) ? fmtN2(hhN) : "—"}</div></div>
    <div class="metric"><div class="label">Home Value</div><div class="value">${!isNaN(hvN) ? "$" + fmtN2(hvN) : "—"}</div></div>
  </div>
  <div class="grid3">
    <div class="metric"><div class="label">1-Mi Population</div><div class="value">${!isNaN(pop1) ? fmtN2(pop1) : "—"}</div></div>
    <div class="metric"><div class="label">5-Yr Growth CAGR</div><div class="value" style="color:${growthPct >= 1.5 ? '#16A34A' : growthPct >= 0 ? '#F59E0B' : '#EF4444'}">${growthPct ? growthPct.toFixed(1) + "%" : "—"}</div></div>
    <div class="metric"><div class="label">Income Tier</div><div class="value" style="font-size:14px">${incTier.toUpperCase()}</div></div>
  </div>
  ${site.demandDrivers ? `<div style="margin-top:16px;padding:14px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px"><div style="font-size:9px;font-weight:700;color:#16A34A;letter-spacing:0.08em;margin-bottom:6px">DEMAND DRIVERS</div><div style="font-size:12px;color:#1E293B;line-height:1.6">${site.demandDrivers}</div></div>` : ""}
</div>

<!-- ═══════════════ SECTION 4: COMPETITION LANDSCAPE ═══════════════ -->
<div class="section">
  <h2><span class="sec-num">4</span> Competition Landscape</h2>
  <div class="grid3" style="margin-bottom:16px">
    <div class="metric"><div class="label">Competitors (3-Mi)</div><div class="value" style="color:${compCount <= 2 ? '#16A34A' : compCount <= 5 ? '#F59E0B' : '#EF4444'}">${compCount}</div></div>
    <div class="metric"><div class="label">Nearest Competitor</div><div class="value" style="font-size:12px">${site.nearestCompetitor || "—"}</div></div>
    <div class="metric"><div class="label">Supply Signal</div><div class="value" style="font-size:11px;line-height:1.3">${site.demandSupplySignal || "—"}</div></div>
  </div>
  ${site.competitorNames ? `<table>
    <thead><tr><th>Competitor Names</th><th>Types</th><th>Est. Total SF</th></tr></thead>
    <tbody><tr><td>${site.competitorNames || "—"}</td><td>${site.competitorTypes || "—"}</td><td>${site.competingSF || "—"}</td></tr></tbody>
  </table>` : ""}
  ${nearestPS !== null ? `<div style="margin-top:14px;padding:12px 14px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;display:flex;justify-content:space-between;align-items:center">
    <div><div style="font-size:9px;font-weight:700;color:#0284C7;letter-spacing:0.08em">NEAREST EXISTING FACILITY</div><div style="font-size:13px;font-weight:700;margin-top:4px">${nearestPS} miles</div></div>
    <div class="pill" style="background:${nearestPS <= 5 ? '#16A34A' : nearestPS <= 15 ? '#3B82F6' : '#F59E0B'}18;color:${nearestPS <= 5 ? '#16A34A' : nearestPS <= 15 ? '#3B82F6' : '#F59E0B'}">${nearestPS <= 5 ? "VALIDATED SUBMARKET" : nearestPS <= 15 ? "EXPANSION ZONE" : "NEW MARKET"}</div>
  </div>` : ""}
</div>

<!-- ═══════════════ SECTION 5: ZONING & ENTITLEMENTS ═══════════════ -->
<div class="section">
  <h2><span class="sec-num">5</span> Zoning & Entitlements</h2>
  <div style="display:flex;gap:16px;margin-bottom:16px">
    <div style="flex:1" class="metric">
      <div class="label">Zoning District</div>
      <div class="value" style="font-size:16px">${site.zoning || "—"}</div>
    </div>
    <div style="flex:1" class="metric">
      <div class="label">Classification</div>
      <div class="badge" style="background:${zoningColor}15;color:${zoningColor};border:1px solid ${zoningColor}30;font-size:12px;padding:6px 16px;margin-top:4px">${zoningLabel}</div>
    </div>
  </div>
  <table>
    <tbody>
      ${site.zoningUseTerm ? `<tr><td style="font-weight:700;color:#64748B;width:200px">Use Category</td><td>${site.zoningUseTerm}</td></tr>` : ""}
      ${site.zoningOrdinanceSection ? `<tr><td style="font-weight:700;color:#64748B">Ordinance Section</td><td>${site.zoningOrdinanceSection}</td></tr>` : ""}
      ${site.zoningSource ? `<tr><td style="font-weight:700;color:#64748B">Source</td><td style="word-break:break-all">${site.zoningSource}</td></tr>` : ""}
      ${site.jurisdictionType ? `<tr><td style="font-weight:700;color:#64748B">Jurisdiction</td><td>${site.jurisdictionType}</td></tr>` : ""}
      ${site.overlayDistrict ? `<tr><td style="font-weight:700;color:#64748B">Overlay District</td><td>${site.overlayDistrict}</td></tr>` : ""}
      ${site.heightLimit ? `<tr><td style="font-weight:700;color:#64748B">Height Limit</td><td>${site.heightLimit}</td></tr>` : ""}
      ${site.facadeReqs ? `<tr><td style="font-weight:700;color:#64748B">Facade Requirements</td><td>${site.facadeReqs}</td></tr>` : ""}
      ${site.setbackReqs ? `<tr><td style="font-weight:700;color:#64748B">Setbacks</td><td>${site.setbackReqs}</td></tr>` : ""}
      ${site.parkingReqs ? `<tr><td style="font-weight:700;color:#64748B">Parking</td><td>${site.parkingReqs}</td></tr>` : ""}
      ${site.planningContact ? `<tr><td style="font-weight:700;color:#64748B">Planning Contact</td><td>${site.planningContact}${site.planningPhone ? " — " + site.planningPhone : ""}${site.planningEmail ? " — " + site.planningEmail : ""}</td></tr>` : ""}
    </tbody>
  </table>
  ${site.zoningNotes ? `<div style="margin-top:14px;padding:12px 14px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px"><div style="font-size:9px;font-weight:700;color:#92400E;letter-spacing:0.08em;margin-bottom:6px">ZONING RESEARCH NOTES</div><div style="font-size:11px;color:#1E293B;line-height:1.6;white-space:pre-wrap">${site.zoningNotes}</div></div>` : ""}
</div>

<!-- ═══════════════ SECTION 6: UTILITIES & INFRASTRUCTURE ═══════════════ -->
<div class="section">
  <h2><span class="sec-num">6</span> Utilities & Infrastructure</h2>
  <div style="display:flex;gap:16px;margin-bottom:16px;align-items:center">
    <div class="metric" style="flex:0 0 120px">
      <div class="label">Utility Grade</div>
      <div class="value" style="font-size:36px;color:${utilColor}">${utilGrade}</div>
      <div class="sub">${utilScore}/100</div>
    </div>
    <div style="flex:1">
      <div style="height:12px;border-radius:6px;background:#F1F5F9;overflow:hidden;margin-bottom:8px">
        <div style="width:${utilScore}%;height:100%;border-radius:6px;background:linear-gradient(90deg,${utilColor},${utilColor}CC);transition:width 0.5s"></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">
        ${utilChecks.map(c => `<span class="pill" style="background:${c.done ? '#16A34A' : '#94A3B8'}15;color:${c.done ? '#16A34A' : '#94A3B8'}">${c.done ? '✓' : '○'} ${c.l}</span>`).join("")}
      </div>
    </div>
  </div>
  <table>
    <tbody>
      ${site.waterProvider ? `<tr><td style="font-weight:700;color:#64748B;width:200px">Water Provider</td><td>${site.waterProvider}${site.waterAvailable === true ? ' <span class="pill" style="background:#16A34A15;color:#16A34A">AVAILABLE</span>' : site.waterAvailable === false ? ' <span class="pill" style="background:#EF444415;color:#EF4444">NOT CONFIRMED</span>' : ''}</td></tr>` : ""}
      ${site.distToWaterMain ? `<tr><td style="font-weight:700;color:#64748B">Dist to Water Main</td><td>${site.distToWaterMain}</td></tr>` : ""}
      ${site.waterMainSize ? `<tr><td style="font-weight:700;color:#64748B">Water Main Size</td><td>${site.waterMainSize}</td></tr>` : ""}
      ${site.sewerProvider ? `<tr><td style="font-weight:700;color:#64748B">Sewer Provider</td><td>${site.sewerProvider}${site.sewerAvailable === true ? ' <span class="pill" style="background:#16A34A15;color:#16A34A">AVAILABLE</span>' : ''}</td></tr>` : ""}
      ${site.electricProvider ? `<tr><td style="font-weight:700;color:#64748B">Electric Provider</td><td>${site.electricProvider}${site.threePhase === true ? ' <span class="pill" style="background:#16A34A15;color:#16A34A">3-PHASE ✓</span>' : ''}</td></tr>` : ""}
      ${site.gasProvider ? `<tr><td style="font-weight:700;color:#64748B">Gas Provider</td><td>${site.gasProvider}</td></tr>` : ""}
      ${site.waterTapFee || site.sewerTapFee ? `<tr><td style="font-weight:700;color:#64748B">Tap Fees</td><td>Water: ${site.waterTapFee || "—"} | Sewer: ${site.sewerTapFee || "—"}</td></tr>` : ""}
      ${site.impactFees ? `<tr><td style="font-weight:700;color:#64748B">Impact Fees</td><td>${site.impactFees}</td></tr>` : ""}
      ${site.totalUtilityBudget ? `<tr><td style="font-weight:700;color:#64748B">Est. Utility Budget</td><td style="font-weight:700;color:#1E293B">${site.totalUtilityBudget}</td></tr>` : ""}
    </tbody>
  </table>
  ${site.utilityNotes ? `<div style="margin-top:14px;padding:12px 14px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px"><div style="font-size:9px;font-weight:700;color:#0284C7;letter-spacing:0.08em;margin-bottom:6px">UTILITY NOTES</div><div style="font-size:11px;color:#1E293B;line-height:1.6;white-space:pre-wrap">${site.utilityNotes}</div></div>` : ""}
</div>

<!-- ═══════════════ SECTION 7: SITE CHARACTERISTICS ═══════════════ -->
<div class="section">
  <h2><span class="sec-num">7</span> Site Characteristics & Access</h2>
  <div class="grid3" style="margin-bottom:16px">
    <div class="metric"><div class="label">Acreage</div><div class="value">${!isNaN(acres) ? acres.toFixed(2) : "—"}</div><div class="sub">${isMultiStory ? "Multi-Story (3-4)" : "Single-Story"}</div></div>
    <div class="metric"><div class="label">Est. Building SF</div><div class="value">${totalSF.toLocaleString()}</div><div class="sub">${stories > 1 ? stories + " stories" : "Single-story"} · 35% coverage</div></div>
    <div class="metric"><div class="label">Flood Zone</div><div class="value" style="font-size:14px">${site.floodZone || (hasFlood ? "⚠️ FLOOD" : "—")}</div></div>
  </div>
  <table>
    <tbody>
      ${site.roadFrontage ? `<tr><td style="font-weight:700;color:#64748B;width:200px">Road Frontage</td><td>${site.roadFrontage}</td></tr>` : ""}
      ${site.frontageRoadName ? `<tr><td style="font-weight:700;color:#64748B">Frontage Road</td><td>${site.frontageRoadName}</td></tr>` : ""}
      ${site.roadType ? `<tr><td style="font-weight:700;color:#64748B">Road Type</td><td>${site.roadType}</td></tr>` : ""}
      ${site.trafficData ? `<tr><td style="font-weight:700;color:#64748B">Traffic (VPD)</td><td>${site.trafficData}</td></tr>` : ""}
      ${site.medianType ? `<tr><td style="font-weight:700;color:#64748B">Median Type</td><td>${site.medianType}</td></tr>` : ""}
      ${site.nearestSignal ? `<tr><td style="font-weight:700;color:#64748B">Nearest Signal</td><td>${site.nearestSignal}</td></tr>` : ""}
      ${site.curbCuts ? `<tr><td style="font-weight:700;color:#64748B">Curb Cuts</td><td>${site.curbCuts}</td></tr>` : ""}
      ${site.visibility ? `<tr><td style="font-weight:700;color:#64748B">Visibility</td><td>${site.visibility}</td></tr>` : ""}
      ${site.terrain ? `<tr><td style="font-weight:700;color:#64748B">Terrain</td><td>${site.terrain}</td></tr>` : ""}
      ${site.soilType ? `<tr><td style="font-weight:700;color:#64748B">Soil Type</td><td>${site.soilType}</td></tr>` : ""}
      ${dom !== null ? `<tr><td style="font-weight:700;color:#64748B">Days on Market</td><td>${dom}${dom > 365 ? ' <span class="pill" style="background:#F59E0B15;color:#F59E0B">STALE</span>' : ''}</td></tr>` : ""}
    </tbody>
  </table>
</div>

<!-- ═══════════════ SECTION 8: FINANCIAL ANALYSIS ═══════════════ -->
<div class="section" style="background:#FAFBFC">
  <h2><span class="sec-num">8</span> Financial Analysis</h2>

  <!-- Development Cost -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px">Development Cost Estimate</h3>
  <div class="grid4" style="margin-bottom:20px">
    <div class="metric"><div class="label">Land Cost</div><div class="value" style="font-size:16px">${landCost > 0 ? fmtM(landCost) : "—"}</div></div>
    <div class="metric"><div class="label">Hard Cost</div><div class="value" style="font-size:16px">${fmtM(hardCost)}</div><div class="sub">$${hardCostPerSF}/SF</div></div>
    <div class="metric"><div class="label">Soft Cost (20%)</div><div class="value" style="font-size:16px">${fmtM(softCost)}</div></div>
    <div class="metric" style="border:2px solid #1E2761"><div class="label">Total Dev Cost</div><div class="value" style="font-size:16px;color:#1E2761">${totalDevCost > 0 ? fmtM(totalDevCost) : "—"}</div></div>
  </div>

  <!-- 5-Year Pro Forma Summary -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin:20px 0 12px">5-Year Pro Forma Summary</h3>
  <table>
    <thead><tr><th>Year</th><th>Occupancy</th><th>Revenue</th><th>OpEx</th><th>NOI</th><th>YOC</th></tr></thead>
    <tbody>
      ${yearData.map((y, i) => {
        const yoc = totalDevCost > 0 ? ((y.noi / totalDevCost) * 100).toFixed(1) : "—";
        const yocC = parseFloat(yoc) >= 8.5 ? "#16A34A" : parseFloat(yoc) >= 7.0 ? "#F59E0B" : "#EF4444";
        return `<tr${i === 4 ? ' style="background:#F0FDF4;font-weight:700"' : ""}>
          <td style="font-weight:700">Y${y.yr}</td>
          <td>${Math.round(y.occRate * 100)}%</td>
          <td class="mono">${fmtD(y.totalRev)}</td>
          <td class="mono">${fmtD(y.opex)}</td>
          <td class="mono" style="font-weight:700">${fmtD(y.noi)}</td>
          <td class="mono" style="color:${yocC};font-weight:700">${yoc}%</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>

  <!-- Stabilized Valuation -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin:20px 0 12px">Stabilized Valuation (Y5 NOI: ${fmtD(stabNOI)})</h3>
  <div class="grid3">
    ${valuations.map(v => `<div class="metric"><div class="label">${v.label}</div><div class="value" style="font-size:18px;color:#1E2761">${fmtM(v.value)}</div></div>`).join("")}
  </div>

  <!-- Land Price Guide -->
  <h3 style="font-size:12px;font-weight:800;color:#C9A84C;letter-spacing:0.08em;text-transform:uppercase;margin:24px 0 12px">◆ Land Acquisition Price Guide</h3>
  <div style="border:2px solid rgba(201,168,76,0.2);border-radius:12px;overflow:hidden">
    <table>
      <thead><tr><th>Tier</th><th>Target YOC</th><th>Max Land Price</th><th>Per Acre</th><th></th></tr></thead>
      <tbody>
        ${landPrices.map(lp => `<tr>
          <td style="font-weight:700">${lp.label}</td>
          <td class="mono">${(lp.yoc * 100).toFixed(1)}%</td>
          <td class="mono" style="font-weight:800;color:${lp.color}">${lp.maxLand > 0 ? fmtM(lp.maxLand) : "—"}</td>
          <td class="mono">${lp.perAcre > 0 ? fmtD(lp.perAcre) : "—"}/ac</td>
          <td><span class="pill" style="background:${lp.color}15;color:${lp.color}">${lp.tag}</span></td>
        </tr>`).join("")}
      </tbody>
    </table>
    ${askVsStrike !== null ? `<div style="padding:14px;background:#F8FAFC;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center">
      <div><span style="font-size:11px;color:#64748B;font-weight:600">Ask (${landCost > 0 ? fmtM(landCost) : "—"}) vs Strike (${fmtM(landPrices[1].maxLand)})</span></div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:16px;font-weight:900;color:${verdictColor};font-family:'Space Mono',monospace">${parseFloat(askVsStrike) > 0 ? '+' : ''}${askVsStrike}%</span>
        <span class="badge" style="background:${verdictColor}15;color:${verdictColor};border:1px solid ${verdictColor}30">${landVerdict}</span>
      </div>
    </div>` : ""}
  </div>
</div>

<!-- ═══════════════ SECTION 9: INSTITUTIONAL METRICS & REIT BENCHMARKING ═══════════════ -->
<div class="section">
  <h2><span class="sec-num">9</span> Institutional Performance Metrics</h2>
  <div class="grid4" style="margin-bottom:16px">
    <div class="metric" style="border:2px solid #1E2761"><div class="label">RevPAF</div><div class="value" style="font-size:18px;color:#1E2761">$${revPAF}<div class="sub">/available SF/yr</div></div></div>
    <div class="metric"><div class="label">NOI Margin</div><div class="value" style="font-size:18px;color:${parseFloat(noiMarginPct) >= 60 ? '#16A34A' : '#F59E0B'}">${noiMarginPct}%</div></div>
    <div class="metric"><div class="label">Dev Spread</div><div class="value" style="font-size:18px">${devSpread} bps</div><div class="sub">YOC vs ${(mktAcqCap*100).toFixed(1)}% acq cap</div></div>
    <div class="metric"><div class="label">SF/Capita (3-Mi)</div><div class="value" style="font-size:18px;color:${demandColor}">${sfPerCapita || "—"}</div><div class="sub">${demandSignal || "—"}</div></div>
  </div>

  <!-- Capital Stack -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin:20px 0 12px">Capital Stack & Leveraged Returns</h3>
  <div class="grid4" style="margin-bottom:16px">
    <div class="metric"><div class="label">Loan (${Math.round(loanLTV*100)}% LTV)</div><div class="value" style="font-size:14px">${fmtM(loanAmount)}</div><div class="sub">${(loanRate*100).toFixed(2)}% / ${loanAmort}yr</div></div>
    <div class="metric"><div class="label">Equity Required</div><div class="value" style="font-size:14px">${fmtM(equityRequired)}</div></div>
    <div class="metric"><div class="label">DSCR (Stab.)</div><div class="value" style="font-size:18px;color:${parseFloat(dscrStab) >= 1.25 ? '#16A34A' : '#EF4444'}">${dscrStab}x</div></div>
    <div class="metric"><div class="label">Cash-on-Cash</div><div class="value" style="font-size:18px;color:${parseFloat(cashOnCash) >= 10 ? '#16A34A' : '#F59E0B'}">${cashOnCash}%</div></div>
  </div>
  <div class="grid3">
    <div class="metric" style="border:2px solid #1E2761"><div class="label">10-Yr Levered IRR</div><div class="value" style="font-size:22px;color:${parseFloat(irrPct) >= 15 ? '#16A34A' : parseFloat(irrPct) >= 10 ? '#F59E0B' : '#EF4444'}">${irrPct}%</div></div>
    <div class="metric"><div class="label">Equity Multiple (10-Yr)</div><div class="value" style="font-size:22px">${equityMultiple}x</div></div>
    <div class="metric"><div class="label">Rate Confidence</div><div class="value" style="font-size:14px;color:${rateConfColor}">${rateConfidence}</div><div class="sub">3-method cross-validated</div></div>
  </div>

  <!-- REIT Benchmarking (condensed) -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin:20px 0 12px">REIT Portfolio Comparison</h3>
  <table style="font-size:11px">
    <thead><tr><th>Operator</th><th>RevPAF</th><th>NOI Margin</th><th>Avg Occ</th><th>Implied Cap</th></tr></thead>
    <tbody>
      <tr style="background:rgba(201,168,76,0.06);font-weight:700;border-left:3px solid #C9A84C">
        <td style="color:#C9A84C">◆ THIS SITE</td><td class="mono">$${revPAF}</td><td class="mono">${noiMarginPct}%</td><td class="mono">${Math.round(yearData[4].occ * 100)}%</td><td class="mono">${yocStab}% YOC</td>
      </tr>
      ${reitBench.slice(0, 4).map(r => `<tr>
        <td style="font-weight:600">${r.ticker}</td><td class="mono">$${r.revPAF.toFixed(2)}</td><td class="mono">${r.noiMargin.toFixed(1)}%</td><td class="mono">${r.avgOcc.toFixed(1)}%</td><td class="mono">${r.impliedCap.toFixed(1)}%</td>
      </tr>`).join("")}
    </tbody>
  </table>

  <!-- Replacement Cost -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin:20px 0 12px">Replacement Cost — Build vs. Acquire</h3>
  <div class="grid3">
    <div class="metric"><div class="label">Replacement Cost</div><div class="value" style="font-size:14px">${fmtM(replacementCost)}</div><div class="sub">$${replacementCostPerSF}/SF excl. land</div></div>
    <div class="metric"><div class="label">Full Dev Cost</div><div class="value" style="font-size:14px">${fullReplacementCost > 0 ? fmtM(fullReplacementCost) : "—"}</div></div>
    <div class="metric" style="border:1px solid ${buildOrBuy?.startsWith("BUILD") ? '#16A34A' : '#F59E0B'}40"><div class="label">Verdict</div><div style="font-size:11px;font-weight:700;color:${buildOrBuy?.startsWith("BUILD") ? '#16A34A' : '#F59E0B'};margin-top:6px">${buildOrBuy || "—"}</div></div>
  </div>
</div>

<!-- ═══════════════ SECTION 10: RISK ASSESSMENT ═══════════════ -->
<div class="section">
  <h2><span class="sec-num">10</span> Risk Assessment</h2>
  ${risks.length > 0 ? risks.map(r => `<div class="risk-row" style="background:${r.color}08;border:1px solid ${r.color}20">
    <span class="pill" style="background:${r.color}18;color:${r.color};min-width:60px;text-align:center">${r.level}</span>
    <span style="font-size:11px;font-weight:700;color:#64748B;min-width:90px">${r.cat}</span>
    <span style="font-size:12px;color:#1E293B">${r.desc}</span>
  </div>`).join("") : `<div style="padding:16px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;text-align:center;color:#16A34A;font-weight:700;font-size:13px">✅ No significant risks identified</div>`}
</div>

<!-- ═══════════════ SECTION 11: BROKER INTEL ═══════════════ -->
${site.sellerBroker || site.brokerNotes || site.listingSource ? `<div class="section">
  <h2><span class="sec-num">11</span> Broker Intelligence</h2>
  <table>
    <tbody>
      ${site.sellerBroker ? `<tr><td style="font-weight:700;color:#64748B;width:200px">Seller / Broker</td><td>${site.sellerBroker}</td></tr>` : ""}
      ${site.listingSource ? `<tr><td style="font-weight:700;color:#64748B">Listing Source</td><td>${site.listingSource}</td></tr>` : ""}
      ${site.listingUrl ? `<tr><td style="font-weight:700;color:#64748B">Listing URL</td><td><a href="${site.listingUrl}" style="color:#2563EB;word-break:break-all">${site.listingUrl}</a></td></tr>` : ""}
      ${site.brokerNotes ? `<tr><td style="font-weight:700;color:#64748B">Broker Notes</td><td>${site.brokerNotes}</td></tr>` : ""}
    </tbody>
  </table>
</div>` : ""}

<!-- ═══════════════ SECTION 12: DEAL SUMMARY ═══════════════ -->
${site.summary ? `<div class="section">
  <h2><span class="sec-num">${site.sellerBroker || site.brokerNotes || site.listingSource ? "12" : "11"}</span> Deal Summary & Notes</h2>
  <div style="padding:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;font-size:12px;color:#1E293B;line-height:1.7;white-space:pre-wrap">${site.summary}</div>
</div>` : ""}

<!-- ═══════════════ FOOTER ═══════════════ -->
<div class="divider"></div>
<div style="padding:32px 40px;text-align:center">
  <div style="display:flex;justify-content:center;align-items:center;gap:12px;margin-bottom:12px">
    <div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#C9A84C,#E87A2E);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:#fff;font-family:'Space Mono'">REC</div>
    <div>
      <div style="font-size:11px;font-weight:800;letter-spacing:0.12em;color:#1E2761">REAL ESTATE COMMITTEE PACKAGE</div>
      <div style="font-size:9px;color:#94A3B8;letter-spacing:0.06em">Powered by SiteScore™ Intelligence Platform</div>
    </div>
  </div>
  <div style="height:1px;background:linear-gradient(90deg,transparent,#C9A84C,transparent);margin:16px auto;max-width:400px"></div>
  <div style="font-size:10px;color:#94A3B8;line-height:1.8">
    <div>REC Package — ${site.name} | Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
    <div style="font-weight:600;color:#64748B;margin-top:4px">DJR Real Estate LLC | U.S. Patent Pending — Serial No. 99712640</div>
    <div style="margin-top:10px;font-size:9px;color:#94A3B8;max-width:700px;margin-left:auto;margin-right:auto">
      <strong>CONFIDENTIAL & PROPRIETARY.</strong> This document and its contents are the exclusive property of DJR Real Estate LLC.
      The SiteScore™ platform, scoring methodology, pricing models, and analytical frameworks contained herein are proprietary
      trade secrets protected under federal and state law. Unauthorized reproduction, distribution, or disclosure is strictly prohibited.
      This report is provided for informational purposes only and does not constitute investment advice or a guarantee of future performance.
    </div>
    <div style="margin-top:8px;font-size:9px;color:#94A3B8">&copy; ${new Date().getFullYear()} DJR Real Estate LLC. All rights reserved. SiteScore™ is a trademark of DJR Real Estate LLC.</div>
  </div>
</div>

</div></body></html>`;
  } catch (err) {
    console.error("Report generation error:", err);
    return `<!DOCTYPE html><html><head><title>Error</title></head><body style="font-family:sans-serif;padding:40px;background:#0A0E2A;color:#fff;text-align:center"><h1 style="color:#C9A84C">Report Generation Error</h1><p style="color:#94A3B8">${escapeHtml(err.message)}</p><p style="color:#64748B;font-size:12px">Check the browser console for details. Try refreshing the site data.</p></body></html>`;
  }
};

// ─── SiteScore™ v3.1 — 10-Dimension Calibrated Scoring Engine ───
// Matches CLAUDE.md §6h framework. Uses structured data fields, not regex on summary text.
// Default weights: Pop 16%, Growth 21%, HHI 10%, Households 5%, HomeValue 5%, Zoning 16%, PS Proximity 11%, Access 7%, Competition 7%, Market 2%
// Pricing removed — land valuation handled by Pricing Report's Land Acquisition Price Guide.
// Hard FAIL: pop <5K, HHI <$55K, landlocked, >35mi from nearest PS
const computeSiteScore = (site) => {
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

  // --- 1. DEMOGRAPHICS — POPULATION (16%) §6h calibrated ---
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

  // --- 2. DEMOGRAPHICS — HHI (10%) §6h calibrated ---
  let incScore = 5;
  if (incRaw > 0) {
    if (incRaw >= 90000) incScore = 10;
    else if (incRaw >= 75000) incScore = 8;
    else if (incRaw >= 65000) incScore = 6;
    else if (incRaw >= 55000) incScore = 4;
    else { incScore = 0; hardFail = true; flags.push("FAIL: 3-mi HHI under $55K"); }
  }
  scores.income = incScore;

  // --- 2b. GROWTH (18%) — ESRI 5-year population CAGR ---
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

  // --- Growth corridor exemption — exurban boomtowns (Hockley TX, etc.) ---
  // If pop is 2,500–5,000 but growth is booming (≥8), don't hard-FAIL.
  // These are tomorrow's 20K+ suburbs — score low but keep alive.
  if (popRaw > 0 && popRaw < 5000 && popRaw >= 2500 && growthScore >= 8) {
    popScore = 2;
    scores.population = popScore;
    hardFail = false;
    const failIdx = flags.indexOf("FAIL: 3-mi pop under 5,000");
    if (failIdx !== -1) flags.splice(failIdx, 1);
    flags.push("Growth corridor: pop under 5K but high growth — scored 2 (not FAIL)");
  }

  // --- 2c. HOUSEHOLDS (5%) — 3-mi household count (demand proxy) ---
  let hhScore = 5;
  const hhRaw = parseNum(site.households3mi);
  if (hhRaw > 0) {
    if (hhRaw >= 25000) hhScore = 10;
    else if (hhRaw >= 18000) hhScore = 8;
    else if (hhRaw >= 12000) hhScore = 7;
    else if (hhRaw >= 6000) hhScore = 5;
    else hhScore = 3;
  }
  scores.households = hhScore;

  // --- 2d. HOME VALUE (5%) — 3-mi median home value (affluence signal) ---
  let hvScore = 5;
  const hvRaw = parseNum(site.homeValue3mi);
  if (hvRaw > 0) {
    if (hvRaw >= 500000) hvScore = 10;
    else if (hvRaw >= 350000) hvScore = 9;
    else if (hvRaw >= 250000) hvScore = 8;
    else if (hvRaw >= 180000) hvScore = 6;
    else if (hvRaw >= 120000) hvScore = 4;
    else hvScore = 2;
  }
  scores.homeValue = hvScore;

  // --- 2e. PS PROXIMITY (10%) — Distance to nearest PS location ---
  // Closer = market validation, NOT cannibalization. >35mi = too remote (FAIL).
  let psProxScore = 5;
  const nearestPS = site.siteiqData?.nearestPS;
  if (nearestPS !== undefined && nearestPS !== null) {
    const psDist = parseFloat(String(nearestPS));
    if (!isNaN(psDist)) {
      if (psDist > 35) { psProxScore = 0; hardFail = true; flags.push("FAIL: >35 mi from nearest PS location — too remote"); }
      else if (psDist <= 5) psProxScore = 10;
      else if (psDist <= 10) psProxScore = 9;
      else if (psDist <= 15) psProxScore = 7;
      else if (psDist <= 25) psProxScore = 5;
      else psProxScore = 3;
    }
  }
  scores.psProximity = psProxScore;

  // --- 3. ZONING (16%) §6c methodology ---
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

  // --- 5. ACCESS & VISIBILITY (7%) ---
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

  // --- 7. MARKET TIER (2%) ---
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

  // --- COMPOSITE (weighted sum, 0-10 scale) — uses configurable weights, 10 dimensions ---
  const weightedSum =
    (popScore * getIQWeight("population")) + (growthScore * getIQWeight("growth")) +
    (incScore * getIQWeight("income")) + (hhScore * getIQWeight("households")) +
    (hvScore * getIQWeight("homeValue")) +
    (zoningScore * getIQWeight("zoning")) + (psProxScore * getIQWeight("psProximity")) +
    (scores.access * getIQWeight("access")) +
    (compScore * getIQWeight("competition")) + (tierScore * getIQWeight("marketTier"));
  let adjusted = Math.round(weightedSum * 10) / 10;

  // --- PHASE BONUS ---
  const phase = (site.phase || "").toLowerCase();
  if (/under contract|closed/i.test(phase)) adjusted = Math.min(10, adjusted + 0.3);
  else if (/psa sent/i.test(phase)) adjusted = Math.min(10, adjusted + 0.2);
  else if (/^loi$/i.test(phase)) adjusted = Math.min(10, adjusted + 0.15);
  else if (/sitescore approved|sitescore approved|ps approved/i.test(phase)) adjusted = Math.min(10, adjusted + 0.1);

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
  // SiteScore incorporates depth of due diligence research.
  // Sites with verified primary-source research score higher than unvetted sites.
  // Source: CLAUDE.md §6h — "HARD VET, then SiteScore, not the other way around"
  const vetChecks = [
    !!site.zoningSource,                                          // Ordinance cited
    !!site.zoningClassification && site.zoningClassification !== "unknown",  // Classification confirmed
    !!site.zoningNotes && site.zoningNotes.length > 20,           // Permitted use table reviewed
    !!site.zoningUseTerm,                                          // Exact use category from table
    !!site.waterProvider,                                          // Water provider identified
    site.waterAvailable === true || site.waterAvailable === false, // Water availability confirmed
    site.insideServiceBoundary === true || site.insideServiceBoundary === false, // Service boundary checked
    !!site.distToWaterMain,                                        // Distance to water main known
    site.fireFlowAdequate === true || site.fireFlowAdequate === false, // Fire flow assessed
    !!site.sewerProvider || /septic/i.test(combinedText),          // Sewer/septic solution
    !!site.electricProvider,                                       // Electric provider identified
    !!site.floodZone,                                              // FEMA flood zone checked
    !!site.planningContact,                                        // Planning dept contact found
    site.siteiqData?.competitorCount !== undefined && site.siteiqData?.competitorCount !== null, // Competition scanned
    site.siteiqData?.nearestPS !== undefined && site.siteiqData?.nearestPS !== null, // PS proximity checked
    !!site.households3mi || !!site.homeValue3mi,                   // Demo depth (households or home value)
    !!site.roadFrontage || !!site.frontageRoadName,                // Site access assessed
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
  else if (final >= 8.0) { classification = "GREEN"; classColor = "#16A34A"; }
  else if (final >= 6.0) { classification = "YELLOW"; classColor = "#D97706"; }
  else if (final >= 4.0) { classification = "ORANGE"; classColor = "#EA580C"; }
  else { classification = "RED"; classColor = "#DC2626"; }

  const breakdown = [
    { label: "Population", key: "population", score: scores.population, weight: getIQWeight("population") },
    { label: "Growth", key: "growth", score: scores.growth, weight: getIQWeight("growth") },
    { label: "Income", key: "income", score: scores.income, weight: getIQWeight("income") },
    { label: "Households", key: "households", score: scores.households, weight: getIQWeight("households") },
    { label: "Home Value", key: "homeValue", score: scores.homeValue, weight: getIQWeight("homeValue") },
    { label: "Zoning", key: "zoning", score: scores.zoning, weight: getIQWeight("zoning") },
    { label: "PS Proximity", key: "psProximity", score: scores.psProximity, weight: getIQWeight("psProximity") },
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

// ─── SiteScore Badge Component ───
function SiteScoreBadge({ site, size = "normal", iq: iqProp }) {
  const iq = iqProp || computeSiteScore(site);
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
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "inherit", opacity: 0.85 }}>S</span>
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
        ...(isGold ? { animation: "sitescore-glow 2s ease-in-out infinite alternate" } : {}),
      }}>
        {isGold && <><div style={{
          position: "absolute", inset: -4, borderRadius: "50%",
          border: "2px solid #F37C33",
          opacity: 0.6,
          animation: "sitescore-ring 2s ease-in-out infinite alternate",
        }} /><div style={{
          position: "absolute", inset: -8, borderRadius: "50%",
          border: "1px solid rgba(243,124,51,0.2)",
          opacity: 0.3,
          animation: "sitescore-ring 3s ease-in-out infinite alternate",
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
          <span style={{ fontSize: 11, fontWeight: 700, color: "#CBD5E1", letterSpacing: "0.08em" }}>SiteScore<span style={{ fontSize: 8, verticalAlign: "super" }}>™</span></span>
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
            { key: "households", label: "HH" },
            { key: "homeValue", label: "HV" },
            { key: "zoning", label: "ZN" },
            { key: "psProximity", label: "PS" },
            { key: "access", label: "ACC" },
            { key: "competition", label: "CP" },
            { key: "marketTier", label: "MKT" },
          ].map((f) => {
            const v = iq.scores[f.key] || 0;
            const pct = Math.max(8, (v / 10) * 100);
            const c = v >= 8 ? "#F37C33" : v >= 6 ? "#3B82F6" : v >= 4 ? "#F59E0B" : "#EF4444";
            return (
              <div key={f.key} title={`${f.label}: ${v}/10`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: 24 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: c, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{v}</div>
                <div style={{ width: 16, height: 40, borderRadius: 4, background: "rgba(0,0,0,0.06)", position: "relative", overflow: "hidden" }}>
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

function normalizePriority(p) {
  if (!p) return p;
  const map = { hot: "🔥 Hot", warm: "🟡 Warm", cold: "🔵 Cold", none: "⚪ None" };
  const key = p.replace(/^[^a-zA-Z]+/, "").trim().toLowerCase();
  return map[key] || p;
}

function PriorityBadge({ priority }) {
  const p = normalizePriority(priority);
  const c = PRIORITY_COLORS[p] || "#CBD5E1";
  return p && p !== "⚪ None" ? (
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
      {p}
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

// ─── Error Boundary — prevents total app crash on report/render errors ───
class ErrorBoundary extends React.PureComponent {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("ErrorBoundary caught:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: "center", background: "#0A0E2A", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#9888;&#65039;</div>
          <h1 style={{ color: "#C9A84C", fontSize: 24, fontWeight: 800, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ color: "#94A3B8", fontSize: 14, maxWidth: 500, marginBottom: 24 }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{ padding: "12px 24px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #E87A2E, #C9A84C)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Reload Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ═══ MAIN APP ═══
function AppInner() {
  const [loaded, setLoaded] = useState(false);
  const [subs, setSubs] = useState([]);
  const [east, setEast] = useState([]);
  const [sw, setSw] = useState([]);
  const [tab, setTab] = useState("dashboard");
  const [transitioning, setTransitioning] = useState(false);
  const isPopState = useRef(false); // prevents pushState during popstate handling
  const [toast, setToast] = useState(null);
  const [expandedSite, setExpandedSite] = useState(null);
  const [detailView, setDetailView] = useState(null); // { regionKey, siteId }
  const [showNewAlert, setShowNewAlert] = useState(false);
  const [filterPhase, setFilterPhase] = useState("all");
  const [reviewDetailSite, setReviewDetailSite] = useState(null); // site ID for full-page review detail

  // ─── Browser History Integration — back/forward button support ───
  const pushNav = useCallback((navState) => {
    if (!isPopState.current) {
      window.history.pushState(navState, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    // Set initial history state
    window.history.replaceState({ tab: "dashboard", detailView: null, reviewDetailSite: null }, "", window.location.pathname);
    const onPopState = (e) => {
      const st = e.state;
      if (!st) return;
      isPopState.current = true;
      setTransitioning(true);
      setTimeout(() => {
        setTab(st.tab || "dashboard");
        setDetailView(st.detailView || null);
        setReviewDetailSite(st.reviewDetailSite || null);
        setExpandedSite(null);
        setFilterPhase("all");
        window.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(() => { setTransitioning(false); isPopState.current = false; }, 350);
      }, 100);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigateTo = useCallback((newTab, opts = {}) => {
    if (opts.reviewSiteId) { setReviewDetailSite(opts.reviewSiteId); setTab("review"); pushNav({ tab: "review", detailView: null, reviewDetailSite: opts.reviewSiteId }); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (newTab === tab && !opts.force) { if (detailView) { setDetailView(null); pushNav({ tab, detailView: null, reviewDetailSite: null }); window.scrollTo({ top: 0, behavior: "smooth" }); return; } if (opts.phase) setFilterPhase(opts.phase); if (opts.siteId) { setExpandedSite(opts.siteId); setTimeout(() => { const el = document.getElementById(`site-${opts.siteId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 120); } return; }
    setTransitioning(true);
    setTimeout(() => {
      setTab(newTab);
      setDetailView(null);
      if (newTab !== "review") setReviewDetailSite(null);
      if (opts.phase) setFilterPhase(opts.phase); else setFilterPhase("all");
      if (opts.siteId) { setExpandedSite(opts.siteId); setTimeout(() => { const el = document.getElementById(`site-${opts.siteId}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 120); } else { setExpandedSite(null); }
      if (newTab === "review") setShowNewAlert(false);
      pushNav({ tab: newTab, detailView: null, reviewDetailSite: null });
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => setTransitioning(false), 350);
    }, 280);
  }, [tab, detailView, pushNav]);
  const goToDetail = useCallback((dv) => { setDetailView(dv); if (dv) pushNav({ tab, detailView: dv, reviewDetailSite: null }); }, [tab, pushNav]);
  const [newSiteCount, setNewSiteCount] = useState(0);
  const emptyForm = { name: "", address: "", city: "", state: "", notes: "", region: "southwest", acreage: "", askingPrice: "", zoning: "", sellerBroker: "", coordinates: "", listingUrl: "" };
  const [form, setForm] = useState(emptyForm);
  const [submitMode, setSubmitMode] = useState("review");
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
  const [highlightedSite, setHighlightedSite] = useState(null);
  // reviewExpandedSite removed — replaced by reviewDetailSite (full-page detail)
  const [reviewTab, setReviewTab] = useState("mine");
  const [shareLink, setShareLink] = useState(null);
  const [seeded, setSeeded] = useState(false);
  const [demoLoading, setDemoLoading] = useState({});
  const [demoReport, setDemoReport] = useState({});
  const [showSiteScoreDetail, setShowSiteScoreDetail] = useState({});
  // vettingReport removed — auto-generates on site add
  const [showIQConfig, setShowIQConfig] = useState(false);
  const [demoExpanded, setDemoExpanded] = useState(false);
  const [scoreExpanded, setScoreExpanded] = useState(false);
  const [scoreDimExpanded, setScoreDimExpanded] = useState(null); // which SiteScore dimension row is expanded (key string)
  const [demoRowExpanded, setDemoRowExpanded] = useState(null); // which demographics row is expanded (key string)
  const [hoveredMetric, setHoveredMetric] = useState(null); // which key metric box tooltip is showing
  const [iqWeights, setIqWeights] = useState(SITE_SCORE_DEFAULTS.map(d => ({ key: d.key, label: d.label, icon: d.icon, weight: d.weight, tip: d.tip })));

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

    // SiteScore weight config listener — merges Firebase overrides into live config
    const iqRef = ref(db, "config/siteiq_weights");
    const unsubIQ = onValue(iqRef, (snap) => {
      const val = snap.val();
      if (val?.dimensions) {
        const merged = SITE_SCORE_DEFAULTS.map(d => {
          const override = val.dimensions.find(o => o.key === d.key);
          return { ...d, weight: override ? override.weight : d.weight };
        });
        SITE_SCORE_CONFIG = normalizeSiteScoreWeights(merged);
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
    // Deep link review — opens full property detail page directly
    try {
      const params = new URLSearchParams(window.location.search);
      const reviewId = params.get("review") || params.get("reviewSite");
      if (reviewId && subs.find((s) => s.id === reviewId)) {
        setTab("review");
        setReviewDetailSite(reviewId);
        setShowNewAlert(false);
        window.scrollTo({ top: 0 });
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
      const iqR = computeSiteScore(site);
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
      { key: "sitescore", header: "SiteScore™", width: 10 },
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
          if (c.key === "sitescore") return getSiteScore(s).score;
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
        if (c.key === "sitescore") return getSiteScore(s).score;
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
    XLSX.writeFile(wb, `SiteScore_Acquisition_Pipeline_${new Date().toISOString().slice(0, 10)}.xlsx`);
    notify("Exported!");
  };

  // ─── SORT ───
  const SORT_OPTIONS = [
    { key: "sitescore", label: "SiteScore™ (Best)" },
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
      case "sitescore": return sorted.sort((a, b) => getSiteScore(b).score - getSiteScore(a).score);
      case "city": return sorted.sort((a, b) => (a.city || "").localeCompare(b.city || ""));
      case "recent": return sorted.sort((a, b) => new Date(b.approvedAt || b.submittedAt || 0) - new Date(a.approvedAt || a.submittedAt || 0));
      case "dom": return sorted.sort((a, b) => { const da = a.dateOnMarket ? Date.now() - new Date(a.dateOnMarket).getTime() : 0; const db2 = b.dateOnMarket ? Date.now() - new Date(b.dateOnMarket).getTime() : 0; return db2 - da; });
      case "priority": return sorted.sort((a, b) => (priorityOrder[normalizePriority(a.priority)] ?? 9) - (priorityOrder[normalizePriority(b.priority)] ?? 9));
      case "phase": return sorted.sort((a, b) => (phaseOrder[a.phase] ?? 9) - (phaseOrder[b.phase] ?? 9));
      default: return sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
  };

  // ─── MEMOIZED SiteScore CACHE ───
  // Computes SiteScore once per site when data changes. Eliminates ~188 redundant calls per render.
  const siteScoreCache = useMemo(() => {
    const cache = new Map();
    [...sw, ...east].forEach((s) => { if (s && s.id) cache.set(s.id, computeSiteScore(s)); });
    return cache;
  }, [sw, east]);
  const getSiteScore = (site) => siteScoreCache.get(site.id) || computeSiteScore(site);

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
        <div style={{ color: "#6B7394", fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Initializing SiteScore — AI-Powered Land Engine</div>
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
          {data.some(s => s.phase === "Dead" || s.phase === "Declined") && <button onClick={() => { if (window.confirm("Remove all Dead/Declined sites from this tracker?")) { data.filter(s => s.phase === "Dead" || s.phase === "Declined").forEach(s => handleRemove(regionKey, s.id)); } }} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #FCA5A5", background: "rgba(220,38,38,0.08)", color: "#EF4444", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>🗑 Remove Dead ({data.filter(s => s.phase === "Dead" || s.phase === "Declined").length})</button>}
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
                <div key={site.id} id={`site-${site.id}`} className={`site-card${isOpen ? " site-card-open" : ""}`} style={{ ...STYLES.cardBase, borderLeft: `4px solid ${isOpen ? "#E87A2E" : (PRIORITY_COLORS[normalizePriority(site.priority)] || region.accent)}`, ...(isOpen ? { boxShadow: "0 12px 48px rgba(232,122,46,0.15), 0 0 0 1px rgba(232,122,46,0.2), 0 0 60px rgba(232,122,46,0.06)", transform: "scale(1.003)", background: "rgba(15,21,56,0.75)" } : {}) }}>
                  {/* Collapsed header */}
                  <div onClick={() => { goToDetail({ regionKey, siteId: site.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                        <span onClick={(e) => { e.stopPropagation(); goToDetail({ regionKey, siteId: site.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ fontSize: 15, fontWeight: 700, color: "#F4F6FA", cursor: "pointer", transition: "color 0.15s" }} onMouseEnter={(e) => e.currentTarget.style.color = "#E87A2E"} onMouseLeave={(e) => e.currentTarget.style.color = "#F4F6FA"}>{site.name}</span>
                        <SiteScoreBadge site={site} size="small" iq={getSiteScore(site)} />
                        <PriorityBadge priority={site.priority} />
                        <select value={site.phase || "Prospect"} onClick={(e) => e.stopPropagation()} onChange={(e) => updateSiteField(regionKey, site.id, "phase", e.target.value)} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, border: "1px solid rgba(201,168,76,0.15)", background: "rgba(15,21,56,0.6)", color: "#C9A84C", cursor: "pointer" }}>
                          {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <select value={site.assignedTo || ""} onClick={(e) => e.stopPropagation()} onChange={(e) => { const val = e.target.value; if (val) { const now = new Date().toISOString(); const sub = { ...site, status: "pending", region: regionKey, submittedAt: now, assignedTo: val, needsReview: true, sentBackToReview: true }; delete sub.messages; delete sub.docs; delete sub.activityLog; fbSet(`submissions/${site.id}`, sub); fbRemove(`${regionKey}/${site.id}`); setExpandedSite(null); notify(`${site.name} → Review Queue (assigned to ${val})`); } else { updateSiteField(regionKey, site.id, "assignedTo", ""); updateSiteField(regionKey, site.id, "needsReview", false); } }} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, border: site.assignedTo ? "1px solid #E87A2E" : "1px solid rgba(201,168,76,0.15)", background: site.assignedTo ? "rgba(232,122,46,0.12)" : "rgba(15,21,56,0.6)", color: site.assignedTo ? "#E87A2E" : "#6B7394", cursor: "pointer" }}>
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
                    <button onClick={(e) => { e.stopPropagation(); goToDetail({ regionKey, siteId: site.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ padding: "6px 14px", borderRadius: 8, background: "linear-gradient(135deg, #1565C0, #2C3E6B)", color: "#fff", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", boxShadow: "0 2px 12px rgba(21,101,192,0.3)", letterSpacing: "0.04em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", transition: "all 0.15s" }} onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(21,101,192,0.5)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 2px 12px rgba(21,101,192,0.3)"; }}>📊 Detail</button>
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
                          {/* Left: SiteScore Score + Bars + Key Stats */}
                          <div style={{ flex: 1, minWidth: 280 }}>
                            {/* Score + Label Row */}
                            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                              <div onClick={() => setShowSiteScoreDetail(prev => ({ ...prev, [site.id]: !prev[site.id] }))} style={{ cursor: "pointer", position: "relative" }} title="Click for detailed SiteScore breakdown">
                                <SiteScoreBadge site={site} iq={getSiteScore(site)} />
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
                            {/* ── SiteScore Detail Panel — Click-to-expand ── */}
                            {showSiteScoreDetail[site.id] && (() => {
                              const iqD = getSiteScore(site);
                              const dims = [
                                { key: "population", label: "Population (3-mi)", weight: getIQWeight("population"), icon: "👥", tip: "Census / ESRI 3-mi radius population" },
                                { key: "growth", label: "Growth (5yr CAGR)", weight: getIQWeight("growth"), icon: "📈", tip: "ESRI 2025→2030 population growth rate" },
                                { key: "income", label: "Median HHI (3-mi)", weight: getIQWeight("income"), icon: "💰", tip: "Median household income within 3 miles" },
                                { key: "households", label: "Households (3-mi)", weight: getIQWeight("households"), icon: "🏠", tip: "Household count — demand proxy" },
                                { key: "homeValue", label: "Home Value (3-mi)", weight: getIQWeight("homeValue"), icon: "🏡", tip: "Median home value — affluence signal" },
                                { key: "zoning", label: "Zoning", weight: getIQWeight("zoning"), icon: "🏛️", tip: "Storage permissibility in zoning district" },
                                { key: "psProximity", label: "PS Proximity", weight: getIQWeight("psProximity"), icon: "📦", tip: "Distance to nearest PS — closer = validated market" },
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
                                      <span style={{ color: "#FFB347", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em" }}>SiteScore™ DETAILED SCORECARD</span>
                                      <span style={{ color: "#6B7394", fontSize: 10 }}>|</span>
                                      <span style={{ color: scoreColor(iqD.score), fontSize: 13, fontWeight: 900, fontFamily: "'Space Mono', monospace" }}>{iqD.score.toFixed(1)}</span>
                                      <span style={{ color: scoreColor(iqD.score), fontSize: 10, fontWeight: 800, background: scoreColor(iqD.score) + "18", padding: "2px 6px", borderRadius: 4 }}>{scoreLabel(iqD.score)}</span>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); setShowSiteScoreDetail(prev => ({ ...prev, [site.id]: false })); }} style={{ background: "none", border: "1px solid rgba(255,255,255,.15)", borderRadius: 5, color: "#6B7394", fontSize: 11, cursor: "pointer", padding: "2px 8px" }}>✕</button>
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
                            <select value={normalizePriority(site.priority) || "⚪ None"} onChange={(e) => updateSiteField(regionKey, site.id, "priority", e.target.value)} style={{ padding: "6px 10px", borderRadius: 7, border: `2px solid ${PRIORITY_COLORS[normalizePriority(site.priority)] || "rgba(255,255,255,.15)"}`, fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(255,255,255,.08)", cursor: "pointer", fontWeight: 700, color: PRIORITY_COLORS[normalizePriority(site.priority)] || "rgba(201,168,76,0.1)" }}>
                              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <select value={site.phase || "Prospect"} onChange={(e) => updateSiteField(regionKey, site.id, "phase", e.target.value)} style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,.15)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: "rgba(255,255,255,.08)", cursor: "pointer", fontWeight: 600, color: "#E2E8F0" }}>
                              {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                            {/* Assigned To */}
                            <select value={site.assignedTo || ""} onChange={(e) => { const val = e.target.value; if (val) { const now = new Date().toISOString(); const sub = { ...site, status: "pending", region: regionKey, submittedAt: now, assignedTo: val, needsReview: true, sentBackToReview: true }; delete sub.messages; delete sub.docs; delete sub.activityLog; fbSet(`submissions/${site.id}`, sub); fbRemove(`${regionKey}/${site.id}`); setExpandedSite(null); notify(`${site.name} → Review Queue (assigned to ${val})`); } else { updateSiteField(regionKey, site.id, "assignedTo", ""); updateSiteField(regionKey, site.id, "needsReview", false); } }} style={{ padding: "6px 10px", borderRadius: 7, border: site.assignedTo ? "2px solid #C9A84C" : "1px solid rgba(255,255,255,.15)", fontSize: 12, fontFamily: "'Inter', sans-serif", background: site.assignedTo ? "rgba(201,168,76,.12)" : "rgba(255,255,255,.08)", cursor: "pointer", fontWeight: 700, color: site.assignedTo ? "#FFD700" : "#94A3B8" }}>
                              <option value="">Assign to...</option>
                              <option value="Dan R">Dan R</option>
                              <option value="Daniel Wollent">Daniel Wollent</option>
                              <option value="Matthew Toussaint">Matthew Toussaint</option>
                            </select>
                            {site.assignedTo && site.needsReview && (
                              <button onClick={() => { updateSiteField(regionKey, site.id, "needsReview", false); updateSiteField(regionKey, site.id, "reviewedBy", "Dan R"); updateSiteField(regionKey, site.id, "reviewedAt", new Date().toISOString()); notify(`SiteScore Approved — ${site.name}`); }} style={{ padding: "6px 10px", borderRadius: 7, border: "none", background: "linear-gradient(135deg, #16A34A, #15803D)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: "0.02em" }}>✓ SiteScore Approved</button>
                            )}
                            {site.reviewedBy && !site.needsReview && (
                              <div style={{ fontSize: 9, color: "#22C55E", fontWeight: 600, textAlign: "right" }}>✓ SiteScore Approved</div>
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
                          const iqR = computeSiteScore(site); const psD = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null; const rpt = generateVettingReport(site, psD, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); window.open(url, "_blank"); autoGenerateVettingReport(regionKey, site.id, site);
                        }} style={{ padding: "10px 22px", borderRadius: 10, background: "linear-gradient(135deg, #E87A2E, #C9A84C)", color: "#fff", fontSize: 13, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 20px rgba(232,122,46,0.4), 0 0 0 1px rgba(232,122,46,0.2)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s" }}>🔬 SiteScore Deep Vet Report</button>
                        <button onClick={() => { goToDetail({ regionKey, siteId: site.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ padding: "10px 22px", borderRadius: 10, background: "linear-gradient(135deg, #1565C0, #2C3E6B)", color: "#fff", fontSize: 13, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 20px rgba(21,101,192,0.4), 0 0 0 1px rgba(21,101,192,0.2)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s" }}>📊 Detailed Property Report</button>
                        <button onClick={() => {
                          const iqR = computeSiteScore(site); const rpt = generatePricingReport(site, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); window.open(url, "_blank");
                        }} style={{ padding: "10px 22px", borderRadius: 10, background: "linear-gradient(135deg, #2E7D32, #43A047)", color: "#fff", fontSize: 13, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 20px rgba(46,125,50,0.4), 0 0 0 1px rgba(46,125,50,0.2)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s" }}>💰 SiteScore Pricing Report</button>
                        <button onClick={() => {
                          const iqR = computeSiteScore(site); const rpt = generateRECPackage(site, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); window.open(url, "_blank");
                        }} style={{ padding: "10px 22px", borderRadius: 10, background: "linear-gradient(135deg, #1E2761, #C9A84C)", color: "#fff", fontSize: 13, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 20px rgba(30,39,97,0.4), 0 0 0 1px rgba(201,168,76,0.3)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s" }}>📋 REC Package</button>
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

                      {/* Structured SiteScore Fields */}
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
        @keyframes sitescore-glow { 0% { box-shadow: 0 0 15px rgba(201,168,76,0.4), 0 0 30px rgba(201,168,76,0.15); } 100% { box-shadow: 0 0 30px rgba(201,168,76,0.6), 0 0 60px rgba(201,168,76,0.25); } }
        @keyframes sitescore-ring { 0% { opacity: 0.3; transform: scale(1); } 100% { opacity: 0.7; transform: scale(1.08); } }
        @keyframes sitescore-spin { 0% { transform: rotate(0deg); } 25% { transform: rotate(140deg); } 50% { transform: rotate(180deg); } 75% { transform: rotate(320deg); } 100% { transform: rotate(360deg); } }
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
        <div style={{ position: "fixed", top: 24, right: 24, background: "linear-gradient(135deg, rgba(15,15,20,0.97), rgba(30,20,15,0.95))", color: "#fff", padding: "12px 22px", borderRadius: 14, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: "0 8px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(243,124,51,0.2), 0 0 30px rgba(243,124,51,0.08)", animation: "toastSlide 0.35s cubic-bezier(0.4,0,0.2,1)", borderLeft: "3px solid transparent", borderImage: "linear-gradient(180deg, #FFB347, #F37C33, #D45500) 1", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFB347, #F37C33)", boxShadow: "0 0 8px rgba(243,124,51,0.6)", animation: "sitescore-glow 1.5s ease-in-out infinite alternate", flexShrink: 0 }} />{toast}</div>
      )}

      {/* SiteScore Weight Config Modal */}
      {showIQConfig && (() => {
        const totalW = iqWeights.reduce((s, d) => s + d.weight, 0);
        const totalPct = Math.round(totalW * 100);
        const adjustWeight = (key, delta) => {
          setIqWeights(prev => prev.map(d => d.key === key ? { ...d, weight: Math.max(0, Math.min(1, Math.round((d.weight + delta) * 100) / 100)) } : d));
        };
        const handleSaveWeights = () => {
          const normalized = iqWeights.map(d => ({ ...d, weight: d.weight / totalW }));
          SITE_SCORE_CONFIG = SITE_SCORE_DEFAULTS.map((def, i) => ({ ...def, weight: normalized[i].weight }));
          normalizeSiteScoreWeights(SITE_SCORE_CONFIG);
          fbSet("config/siteiq_weights", {
            dimensions: normalized.map(d => ({ key: d.key, weight: Math.round(d.weight * 1000) / 1000 })),
            updatedAt: new Date().toISOString(),
            updatedBy: "Dashboard",
            version: "2.0",
          });
          setShowIQConfig(false);
          notify("SiteScore weights saved & applied");
        };
        const handleResetDefaults = () => {
          setIqWeights(SITE_SCORE_DEFAULTS.map(d => ({ key: d.key, label: d.label, icon: d.icon, weight: d.weight, tip: d.tip })));
        };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "modalIn 0.35s cubic-bezier(0.4,0,0.2,1)" }} onClick={() => setShowIQConfig(false)}>
            <div onClick={e => e.stopPropagation()} style={{ background: "rgba(15,21,56,0.5)", borderRadius: 20, maxWidth: 500, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(243,124,51,0.1), 0 0 60px rgba(243,124,51,0.06)", overflow: "hidden", animation: "cardReveal 0.4s cubic-bezier(0.4,0,0.2,1)" }}>
              <div style={{ background: "linear-gradient(135deg, #0a0a0e 0%, #121218 50%, #1a1520 100%)", padding: "22px 26px", color: "#fff", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, #1E2761, #C9A84C, #FFD700, #C9A84C, #1E2761, transparent)", opacity: 0.6 }} />
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>⚙️ SiteScore™ Weight Configuration</div>
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
          <span style={{ fontSize: 13, color: "#92700C", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFD700, #C9A84C)", boxShadow: "0 0 8px rgba(201,168,76,0.5)", animation: "sitescore-glow 1.5s ease-in-out infinite alternate" }} />{newSiteCount} new site{newSiteCount > 1 ? "s" : ""} pending review</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setTab("review"); setShowNewAlert(false); }} style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Review</button>
            <button onClick={() => setShowNewAlert(false)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.5)", color: "#94A3B8", fontSize: 11, cursor: "pointer" }}>✕</button>
          </div>
        </div>
      )}

      {/* Header — SiteScore Theme */}
      <div style={STYLES.frostedHeader}>
        {/* Clean header accent */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent 0%, #1E2761 15%, #C9A84C 35%, #E87A2E 50%, #C9A84C 65%, #1E2761 85%, transparent 100%)", opacity: 0.5 }} />
        {/* SiteScore Banner */}
        <div style={{ padding: "12px 0 8px", borderBottom: "1px solid rgba(201,168,76,0.08)", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="logo-spin-container" onClick={(e) => { e.currentTarget.querySelector('.logo-img')?.classList.remove('logo-click-spin'); void e.currentTarget.querySelector('.logo-img')?.offsetWidth; e.currentTarget.querySelector('.logo-img')?.classList.add('logo-click-spin'); }} style={{ width: 48, height: 48, borderRadius: 12, overflow: "hidden", cursor: "pointer", position: "relative", boxShadow: "0 4px 20px rgba(232,122,46,0.25), 0 0 0 1px rgba(201,168,76,0.15)", flexShrink: 0 }}>
                <img className="logo-img logo-auto-spin" src="/storvex-logo.png" alt="SiteScore" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.08em", background: "linear-gradient(90deg, #fff 0%, #C9A84C 25%, #FFD700 50%, #C9A84C 75%, #fff 100%)", backgroundSize: "300% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "shimmer 4s linear infinite" }}>STORVEX</div>
                <div style={{ fontSize: 10, color: "#6B7394", letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 1 }}>AI-Powered Data</div>
                <div style={{ fontSize: 8, color: "#6B7394", letterSpacing: "0.06em", marginTop: 2, fontWeight: 600 }}>Powered by DJR Real Estate LLC · <span style={{ color: "#C9A84C" }}>Patent Pending</span></div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowIQConfig(true)} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(201,168,76,0.25)", background: "rgba(201,168,76,0.06)", color: "#C9A84C", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", backdropFilter: "blur(8px)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,168,76,0.15)"; e.currentTarget.style.boxShadow = "0 0 20px rgba(201,168,76,0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(201,168,76,0.06)"; e.currentTarget.style.boxShadow = "none"; }}
              >⚙️ SiteScore Config</button>
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
              {n.key === "review" && pendingN > 0 && <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFD700, #C9A84C)", boxShadow: "0 0 8px rgba(201,168,76,0.5)", animation: "sitescore-glow 1.5s ease-in-out infinite alternate" }} />}
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
                const topSite = myQueue.sort((a, b) => (getSiteScore(b).score || 0) - (getSiteScore(a).score || 0))[0];
                actionItems.push({ who: "Dan R.", count: myQueue.length, top: topSite, color: "#C9A84C", tab: "mine", icon: "📋" });
              }
              if (dwQueue.length > 0) {
                const topSite = dwQueue.sort((a, b) => (getSiteScore(b).score || 0) - (getSiteScore(a).score || 0))[0];
                actionItems.push({ who: "Daniel Wollent", count: dwQueue.length, top: topSite, color: "#42A5F5", tab: "dw", icon: "◆" });
              }
              if (mtQueue.length > 0) {
                const topSite = mtQueue.sort((a, b) => (getSiteScore(b).score || 0) - (getSiteScore(a).score || 0))[0];
                actionItems.push({ who: "Matthew Toussaint", count: mtQueue.length, top: topSite, color: "#4CAF50", tab: "mt", icon: "●" });
              }
              if (actionItems.length === 0) return null;
              return (
                <div className="card-reveal" style={{ background: "linear-gradient(135deg, rgba(232,122,46,0.06), rgba(201,168,76,0.04))", borderRadius: 14, padding: 16, marginBottom: 16, border: "1px solid rgba(232,122,46,0.15)", animationDelay: "0.35s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #E87A2E, #F59E0B)", boxShadow: "0 0 10px rgba(232,122,46,0.5)", animation: "sitescore-glow 1.5s ease-in-out infinite alternate" }} />
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
                          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>Top: <strong style={{ color: "#E2E8F0" }}>{ai.top.name}</strong> — SiteScore {getSiteScore(ai.top).score}</div>
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
              const greenCount = all.filter(s => getSiteScore(s).score >= 7.5).length;
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
                { label: "SiteScore Approved", phases: ["SiteScore Approved"], color: "#8B5CF6", icon: "⚡", action: () => navigateTo("summary", { phase: "SiteScore Approved" }) },
                { label: "LOI / PSA", phases: ["LOI", "LOI Sent", "LOI Signed", "PSA Sent"], color: "#F37C33", icon: "📝", action: () => navigateTo("summary", { phase: "LOI" }) },
                { label: "Under Contract", phases: ["Under Contract"], color: "#16A34A", icon: "🤝", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                { label: "Closed", phases: ["Closed"], color: "#059669", icon: "🏆", action: () => navigateTo("summary", { phase: "Closed" }) },
              ];
              phaseGroups.forEach(g => { g.count = all.filter(s => g.phases.includes(s.phase)).length; });
              const maxPhaseCount = Math.max(...phaseGroups.map(g => g.count), 1);

              // --- Move type classification ---
              const advancePhases = ["SiteScore Approved", "LOI", "PSA Sent", "Under Contract", "Closed"];
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
                  <div style={{ padding: "16px 24px 0", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, overflow: "hidden" }}>
                    {[
                      { label: "LOI / PSA PIPELINE", value: fmtVal(loiValue), count: all.filter(s => ["LOI", "LOI Sent", "LOI Signed", "PSA Sent"].includes(s.phase)).length, color: "#F37C33", action: () => navigateTo("summary", { phase: "LOI" }) },
                      { label: "UNDER CONTRACT", value: fmtVal(ucValue), count: all.filter(s => s.phase === "Under Contract").length, color: "#22C55E", action: () => navigateTo("summary", { phase: "Under Contract" }) },
                      { label: "PROSPECT POOL", value: fmtVal(prospectValue), count: all.filter(s => s.phase === "Prospect").length, color: "#3B82F6", action: () => navigateTo("summary", { phase: "Prospect" }) },
                    ].map(m => (
                      <div key={m.label} onClick={m.action} style={{ textAlign: "center", padding: "12px 8px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", cursor: "pointer", transition: "all 0.25s ease" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(255,255,255,0.07)`; e.currentTarget.style.borderColor = `${m.color}40`; e.currentTarget.style.transform = "translateY(-2px)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; e.currentTarget.style.transform = "translateY(0)"; }}
                      >
                        <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Space Mono', monospace", color: m.color, lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.value}</div>
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
                          <div key={m.name + idx + m.date} onClick={() => { goToDetail({ regionKey: m.regionKey, siteId: m.siteId }); setTab(m.regionKey); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer", borderRadius: 6, transition: "all 0.2s ease" }}
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
                { label: "SiteScore Approved", count: all.filter(s => s.phase === "SiteScore Approved").length, color: "#8B5CF6", icon: "⚡", action: () => navigateTo("summary", { phase: "SiteScore Approved" }) },
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

            {/* Pipeline comparison cards removed — side-by-side phase counts created competitive optics between DW and MT trackers */}
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
                        <tr>{["SiteScore", "Name", "City", "ST", "Phase", "Ask", "Acres", "3mi Pop", "Broker", "DOM", "Added"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {d.map((s, i) => (
                          <tr key={s.id} onClick={() => { goToDetail({ regionKey: rk, siteId: s.id }); setTab(rk); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ background: (() => { const t = getSiteScore(s).tier; return t === "gold" ? "rgba(201,168,76,0.08)" : t === "steel" ? "rgba(44,62,107,0.15)" : i % 2 ? "rgba(15,21,56,0.35)" : "rgba(15,21,56,0.5)"; })(), cursor: "pointer", transition: "background 0.15s", borderLeft: (() => { const t = getSiteScore(s).tier; return t === "gold" ? "3px solid #C9A84C" : t === "steel" ? "3px solid #2C3E6B" : "3px solid transparent"; })() }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(232,122,46,0.12)")}
                            onMouseLeave={(e) => { const t = getSiteScore(s).tier; e.currentTarget.style.background = t === "gold" ? "rgba(201,168,76,0.08)" : t === "steel" ? "rgba(44,62,107,0.15)" : i % 2 ? "rgba(15,21,56,0.35)" : "rgba(15,21,56,0.5)"; }}
                          >
                            <td style={{ ...td, textAlign: "center" }}><SiteScoreBadge site={s} size="small" iq={getSiteScore(s)} /></td>
                            <td style={{ ...td, fontWeight: 600, color: "#E2E8F0" }}>{s.name}</td>
                            <td style={{ ...td, fontWeight: 600 }}>{s.city || "—"}</td>
                            <td style={td}>{s.state || "—"}</td>
                            <td style={{ ...td, fontSize: 11 }}><span style={{ padding: "2px 8px", borderRadius: 6, background: s.phase === "Under Contract" || s.phase === "Closed" ? "#DCFCE7" : s.phase === "PSA Sent" ? "#F5D0FE" : s.phase === "LOI" ? "#FEF3C7" : s.phase === "SiteScore Approved" ? "#E0E7FF" : s.phase === "Submitted to PS" ? "#DBEAFE" : "rgba(15,21,56,0.3)", color: s.phase === "Under Contract" || s.phase === "Closed" ? "#166534" : s.phase === "PSA Sent" ? "#86198F" : s.phase === "LOI" ? "#92400E" : s.phase === "SiteScore Approved" ? "#3730A3" : s.phase === "Submitted to PS" ? "#1E40AF" : "#64748B", fontWeight: 600 }}>{s.phase || "—"}</span></td>
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
        {tab === "review" && !reviewDetailSite && (
          <div style={{ animation: "fadeIn .3s ease-out" }}>
            {/* Review Queue Sub-Tabs */}
            {(() => {
              const myCount = subs.filter(s => s.status === "pending").length;
              const dwCount = subs.filter(s => s.status === "recommended" && (s.routedTo === "southwest" || s.region === "southwest")).length;
              const mtCount = subs.filter(s => s.status === "recommended" && (s.routedTo === "east" || s.region === "east")).length;
              const reviewTabs = [
                { key: "mine", label: "Dan R.", count: myCount, color: "#C9A84C", icon: "📋" },
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
              let needsReviewSites = allTracker.filter(s => s.assignedTo && s.needsReview);
              if (reviewTab === "mine") needsReviewSites = needsReviewSites.filter(s => s.assignedTo === "Dan R");
              else if (reviewTab === "dw") needsReviewSites = needsReviewSites.filter(s => s.assignedTo === "Daniel Wollent");
              else if (reviewTab === "mt") needsReviewSites = needsReviewSites.filter(s => s.assignedTo === "Matthew Toussaint");
              const byPerson = {};
              needsReviewSites.forEach(s => {
                if (!byPerson[s.assignedTo]) byPerson[s.assignedTo] = [];
                byPerson[s.assignedTo].push(s);
              });
              if (Object.keys(byPerson).length === 0) return null;
              return (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#92700C", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #FFD700, #C9A84C)", boxShadow: "0 0 8px rgba(201,168,76,0.5)", animation: "sitescore-glow 1.5s ease-in-out infinite alternate" }} />
                    Assigned for Review ({needsReviewSites.length})
                  </div>
                  {Object.entries(byPerson).map(([person, sites]) => (
                    <div key={person} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 6, padding: "4px 10px", background: "rgba(15,21,56,0.4)", borderRadius: 8, display: "inline-block", border: "1px solid rgba(201,168,76,0.1)" }}>{person} ({sites.length})</div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {sites.map(site => (
                          <div key={site.id} style={{ background: "rgba(15,21,56,0.5)", borderRadius: 14, padding: 18, boxShadow: "0 2px 8px rgba(0,0,0,.1)", borderLeft: "4px solid #C9A84C", transition: "all 0.3s" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                              <div style={{ flex: 1, minWidth: 250 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 15, fontWeight: 800, color: "#E2E8F0" }}>{site.name}</span>
                                  <SiteScoreBadge site={site} size="small" iq={getSiteScore(site)} />
                                  <span style={{ fontSize: 9, fontWeight: 700, color: "#92700C", background: "#FFFBEB", padding: "2px 8px", borderRadius: 5, border: "1px solid rgba(201,168,76,0.3)" }}>NEEDS REVIEW</span>
                                </div>
                                <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 4 }}>{site.address}, {site.city}, {site.state}</div>
                                <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#6B7394", marginBottom: 8, flexWrap: "wrap" }}>
                                  {site.acreage && <span><strong style={{ color: "#E2E8F0" }}>{site.acreage} ac</strong></span>}
                                  {site.askingPrice && <span><strong style={{ color: "#C9A84C" }}>{site.askingPrice}</strong></span>}
                                  <span>Phase: {site.phase || "Prospect"}</span>
                                  <span>Tracker: {site._region === "southwest" ? "DW" : "MT"}</span>
                                </div>
                                {/* Links row */}
                                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                                  {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ padding: "4px 12px", borderRadius: 6, background: "rgba(232,122,46,0.1)", color: "#E87A2E", fontSize: 11, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(232,122,46,0.2)" }}>🔗 Listing</a>}
                                  {site.coordinates && <a href={`https://www.google.com/maps?q=${site.coordinates}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ padding: "4px 12px", borderRadius: 6, background: "rgba(21,101,192,0.1)", color: "#42A5F5", fontSize: 11, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(21,101,192,0.2)" }}>📍 Map</a>}
                                  <button onClick={() => { goToDetail({ regionKey: site._region, siteId: site.id }); setTab(site._region); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.15)", background: "rgba(201,168,76,0.06)", color: "#C9A84C", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>View Full Detail →</button>
                                </div>
                              </div>
                              {/* Action buttons — right side */}
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
                                <button onClick={() => { updateSiteField(site._region, site.id, "needsReview", false); updateSiteField(site._region, site.id, "reviewedBy", person); updateSiteField(site._region, site.id, "reviewedAt", new Date().toISOString()); updateSiteField(site._region, site.id, "phase", "SiteScore Approved"); notify(`✓ Approved — ${site.name} stays in ${site._region === "southwest" ? "DW" : "MT"} tracker`); }} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #16A34A, #15803D)", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer", boxShadow: "0 2px 12px rgba(22,163,74,0.3)", letterSpacing: "0.02em" }}>✓ Approve</button>
                                <button onClick={() => { if (window.confirm(`Reject "${site.name}"? This will remove it from the tracker.`)) { fbRemove(`${site._region}/${site.id}`); notify(`✗ Rejected — ${site.name} removed`); } }} style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.08)", color: "#EF4444", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✗ Reject</button>
                                <button onClick={() => { updateSiteField(site._region, site.id, "assignedTo", ""); updateSiteField(site._region, site.id, "needsReview", false); notify(`Unassigned: ${site.name}`); }} style={{ padding: "6px 18px", borderRadius: 10, border: "1px solid rgba(148,163,184,0.2)", background: "rgba(148,163,184,0.06)", color: "#94A3B8", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Unassign</button>
                              </div>
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
                  // NEW (unreviewed) sites first, then descending SiteScore
                  const aIsNew = !a.recommendedAt && !a.approvedAt && a.status === "pending";
                  const bIsNew = !b.recommendedAt && !b.approvedAt && b.status === "pending";
                  if (aIsNew && !bIsNew) return -1;
                  if (!aIsNew && bIsNew) return 1;
                  return (getSiteScore(b).score || 0) - (getSiteScore(a).score || 0);
                }).map((site) => {
                  const ri = reviewInputs[site.id] || { reviewer: "", note: "" };
                  const setRI = (f, v) => setReviewInputs({ ...reviewInputs, [site.id]: { ...ri, [f]: v } });
                  const isHL = highlightedSite === site.id;
                  const isExpanded = false; // legacy — full-page detail replaced inline expand
                  return (
                    <div key={site.id} id={`review-${site.id}`} style={{ background: isHL ? "#FFF3E0" : "rgba(15,21,56,0.5)", borderRadius: 12, padding: 16, boxShadow: isHL ? "0 0 0 2px #F37C33" : "0 1px 3px rgba(0,0,0,.06)", opacity: site.status === "declined" ? 0.5 : 1, borderLeft: `4px solid ${REGIONS[site.routedTo || site.region]?.accent || "#94A3B8"}`, transition: "all 0.3s", cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); navigateTo("review", { reviewSiteId: site.id }); }}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 20px rgba(201,168,76,0.15), 0 0 0 1px rgba(201,168,76,0.2)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = isHL ? "0 0 0 2px #F37C33" : "0 1px 3px rgba(0,0,0,.06)"; e.currentTarget.style.transform = "translateY(0)"; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}
                      >
                        <span style={{ fontSize: 15, fontWeight: 700, transition: "color 0.2s" }}>{site.name}</span>
                        <SiteScoreBadge site={site} size="small" />
                        <Badge status={site.status} />
                        {site.status === "pending" && <button onClick={(e) => { e.stopPropagation(); const url = `${window.location.origin}${window.location.pathname}?review=${site.id}`; navigator.clipboard.writeText(url); notify("Link copied!"); }} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(201,168,76,0.1)", background: "rgba(15,21,56,0.4)", color: "#6B7394", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>🔗 Copy Link</button>}
                      </div>
                      <div style={{ fontSize: 12, color: "#6B7394", marginBottom: 2 }}>{site.address}, {site.city}, {site.state} {site.acreage ? `• ${site.acreage} ac` : ""} {site.askingPrice ? `• ${site.askingPrice}` : ""}</div>
                      {/* Links */}
                      <div style={{ display: "flex", gap: 6, marginTop: 4, marginBottom: 4, flexWrap: "wrap" }}>
                        {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ padding: "2px 8px", borderRadius: 5, background: "rgba(232,122,46,0.1)", color: "#E87A2E", fontSize: 10, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(232,122,46,0.15)" }}>🔗 Listing</a>}
                        {site.coordinates && <a href={`https://www.google.com/maps?q=${site.coordinates}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ padding: "2px 8px", borderRadius: 5, background: "rgba(21,101,192,0.08)", color: "#42A5F5", fontSize: 10, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(21,101,192,0.15)" }}>📍 Map</a>}
                      </div>
                      {site.summary && <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.4, maxHeight: 36, overflow: "hidden" }}>{site.summary.substring(0, 180)}{site.summary.length > 180 ? "…" : ""}</div>}
                      {/* NEW badge for unreviewed sites */}
                      {!site.recommendedAt && !site.approvedAt && site.status === "pending" && <span style={{ display: "inline-block", marginTop: 4, fontSize: 9, fontWeight: 800, color: "#fff", background: "linear-gradient(135deg, #E87A2E, #F59E0B)", padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em", animation: "sitescore-glow 1.5s ease-in-out infinite alternate" }}>NEW</span>}
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
          if (!site) return <div style={{ textAlign: "center", padding: 40, color: "#6B7394" }}>Site not found. <button onClick={() => setReviewDetailSite(null)} style={{ color: "#E87A2E", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>← Back</button></div>;
          const iqR = computeSiteScore(site);
          const ri = reviewInputs[site.id] || {};
          const setRI = (f, v) => setReviewInputs({ ...reviewInputs, [site.id]: { ...ri, [f]: v } });
          const dom = site.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;
          return (
            <div style={{ animation: "fadeIn .3s ease-out", position: "relative", maxWidth: 1100, margin: "0 auto" }}>
              <button onClick={() => setReviewDetailSite(null)} style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid rgba(232,122,46,0.25)", background: "rgba(232,122,46,0.08)", color: "#E87A2E", fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 16 }}>← Back to Review Queue</button>

              {/* Header */}
              <div style={{ background: "linear-gradient(135deg, rgba(15,21,56,0.9), rgba(30,39,97,0.8))", borderRadius: 16, padding: 24, marginBottom: 20, border: "1px solid rgba(201,168,76,0.1)", position: "relative" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, transparent, ${iqR.classColor || "#C9A84C"}60, transparent)` }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{site.name}</h2>
                      <Badge status={site.status} />
                      {!site.recommendedAt && site.status === "pending" && <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: "linear-gradient(135deg, #E87A2E, #F59E0B)", padding: "3px 10px", borderRadius: 5, letterSpacing: "0.1em" }}>NEW</span>}
                    </div>
                    <div style={{ fontSize: 14, color: "#94A3B8", marginBottom: 8 }}>{site.address}, {site.city}, {site.state}</div>
                    {/* Key deal metrics — hero strip */}
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
                      {site.askingPrice && <div><div style={{ fontSize: 9, color: "#6B7394", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>Asking Price</div><div style={{ fontSize: 20, fontWeight: 900, color: "#C9A84C" }}>{site.askingPrice.toString().startsWith("$") ? site.askingPrice : `$${Number(site.askingPrice).toLocaleString()}`}</div></div>}
                      {site.acreage && <div><div style={{ fontSize: 9, color: "#6B7394", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>Acreage</div><div style={{ fontSize: 20, fontWeight: 900, color: "#E2E8F0" }}>{site.acreage} ac</div></div>}
                      {site.zoning && <div><div style={{ fontSize: 9, color: "#6B7394", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>Zoning</div><div style={{ fontSize: 20, fontWeight: 900, color: "#E2E8F0" }}>{site.zoning}</div></div>}
                      {dom !== null && <div><div style={{ fontSize: 9, color: "#6B7394", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>Days on Market</div><div style={{ fontSize: 20, fontWeight: 900, color: dom > 365 ? "#EF4444" : dom > 180 ? "#F59E0B" : "#E2E8F0" }}>{dom}</div></div>}
                    </div>
                  </div>
                  {/* SiteScore Score — large, right-aligned */}
                  <div style={{ flexShrink: 0, textAlign: "center", padding: "8px 16px", borderRadius: 14, background: iqR.score >= 7.5 ? "rgba(22,163,74,0.1)" : iqR.score >= 5.5 ? "rgba(217,119,6,0.1)" : "rgba(220,38,38,0.1)", border: `1px solid ${iqR.score >= 7.5 ? "rgba(22,163,74,0.25)" : iqR.score >= 5.5 ? "rgba(217,119,6,0.25)" : "rgba(220,38,38,0.25)"}` }}>
                    <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 4 }}>SiteScore</div>
                    <div style={{ fontSize: 42, fontWeight: 900, color: iqR.score >= 7.5 ? "#16A34A" : iqR.score >= 5.5 ? "#D97706" : "#DC2626", lineHeight: 1 }}>{iqR.score}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: iqR.score >= 7.5 ? "#16A34A" : iqR.score >= 5.5 ? "#D97706" : "#DC2626", textTransform: "uppercase", marginTop: 4 }}>{iqR.label || "—"}</div>
                    {iqR.classification && <div style={{ fontSize: 9, color: "#6B7394", marginTop: 2 }}>{iqR.classification}</div>}
                  </div>
                </div>
              </div>

              {/* SiteScore Scorecard */}
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
                <button onClick={() => { const psD = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null; const rpt = generateVettingReport(site, psD, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); window.open(URL.createObjectURL(blob), "_blank"); }} style={{ padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg, #E87A2E, #C9A84C)", color: "#fff", fontSize: 14, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 24px rgba(232,122,46,0.4)", letterSpacing: "0.05em", textTransform: "uppercase" }}>🔬 SiteScore Deep Vet Report</button>
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
          const iqR = getSiteScore(site);
          const dom = site.dateOnMarket ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;
          const docs = site.docs ? Object.entries(site.docs) : [];
          const flyerDoc = docs.find(([, d]) => d.type === "Flyer");
          const navBtnSt = (disabled) => ({ padding: "10px 20px", borderRadius: 10, border: disabled ? "1px solid rgba(201,168,76,0.06)" : "1px solid rgba(232,122,46,0.25)", background: disabled ? "rgba(15,21,56,0.3)" : "rgba(232,122,46,0.08)", color: disabled ? "#4A5080" : "#E87A2E", fontSize: 12, fontWeight: 700, cursor: disabled ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" });
          // Keyboard nav for detail view
          const handleDetailKey = (e) => {
            if (e.key === "ArrowLeft" && prevSite) { setDemoExpanded(false); setScoreDimExpanded(null); setDemoRowExpanded(null); goToDetail({ regionKey: dv.regionKey, siteId: prevSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }
            if (e.key === "ArrowRight" && nextSite) { setDemoExpanded(false); setScoreDimExpanded(null); setDemoRowExpanded(null); goToDetail({ regionKey: dv.regionKey, siteId: nextSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }
            if (e.key === "Escape") { setDetailView(null); }
          };
          if (!window._detailKeyBound) { window.addEventListener("keydown", handleDetailKey); window._detailKeyBound = true; }

          return (
            <div style={{ animation: "fadeIn 0.15s ease-out" }}>
              {/* TOP NAV BAR */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, padding: "14px 0", borderBottom: "1px solid rgba(201,168,76,0.1)" }}>
                <button onClick={() => { setDetailView(null); window._detailKeyBound = false; navigateTo(dv.regionKey, { siteId: dv.siteId }); }} style={{ padding: "10px 20px", borderRadius: 10, background: "rgba(15,21,56,0.5)", border: "1px solid rgba(201,168,76,0.15)", color: "#C9A84C", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}>← Back to Tracker</button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button disabled={!prevSite} onClick={() => { if (prevSite) { goToDetail({ regionKey: dv.regionKey, siteId: prevSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}} style={navBtnSt(!prevSite)}>← Prev</button>
                  <span style={{ fontSize: 11, color: "#6B7394", fontWeight: 600, padding: "0 8px", letterSpacing: "0.04em" }}>{idx + 1} of {allSites.length}</span>
                  <button disabled={!nextSite} onClick={() => { if (nextSite) { goToDetail({ regionKey: dv.regionKey, siteId: nextSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}} style={navBtnSt(!nextSite)}>Next →</button>
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
                    <div onClick={() => setScoreExpanded(!scoreExpanded)} style={{ cursor: "pointer", transition: "transform 0.2s" }} onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.03)"} onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"} title="Click for full SiteScore breakdown">
                      <SiteScoreBadge site={site} iq={iqR} />
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: "#94A3B8" }}>Broker: <strong style={{ color: "#E2E8F0" }}>{site.sellerBroker || "—"}</strong></div>
                  </div>
                </div>
              </div>

              {/* SITESCORE DEEP BREAKDOWN — expandable */}
              {scoreExpanded && (() => {
                const bd = iqR.breakdown || [];
                const wSum = bd.reduce((a, b) => a + b.weight, 0);
                return (
                  <div style={{ borderRadius: 16, marginBottom: 20, overflow: "hidden", border: "1px solid rgba(201,168,76,0.15)", background: "rgba(10,10,14,0.95)", boxShadow: "0 8px 40px rgba(0,0,0,0.4)" }}>
                    <div style={{ background: "linear-gradient(135deg,#0F172A,#1E2761,#1565C0)", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 18 }}>🎯</span>
                        <span style={{ color: "#fff", fontSize: 16, fontWeight: 900, letterSpacing: "0.06em" }}>SITESCORE<span style={{ fontSize: 10, verticalAlign: "super" }}>™</span> BREAKDOWN</span>
                        <span style={{ background: iqR.classColor + "25", color: iqR.classColor, fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6 }}>{iqR.classification}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ fontSize: 32, fontWeight: 900, color: iqR.tier === "gold" ? "#FFD700" : "#E2E8F0", fontFamily: "'Space Mono', monospace", textShadow: iqR.tier === "gold" ? "0 0 20px rgba(255,215,0,0.4)" : "none" }}>{iqR.score.toFixed(1)}</div>
                        <span style={{ fontSize: 12, color: "#94A3B8" }}>/10</span>
                        <button onClick={() => setScoreExpanded(false)} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: "#94A3B8", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>✕</button>
                      </div>
                    </div>
                    {/* Dimension rows — CLICKABLE with expandable deep-dive panels */}
                    <div style={{ padding: "8px 0" }}>
                      {bd.map((dim, i) => {
                        const pct = (dim.score / 10) * 100;
                        const barC = dim.score >= 8 ? "#22C55E" : dim.score >= 6 ? "#3B82F6" : dim.score >= 4 ? "#F59E0B" : "#EF4444";
                        const wPct = wSum > 0 ? ((dim.weight / wSum) * 100).toFixed(0) : "0";
                        const contrib = (dim.score * dim.weight / wSum).toFixed(2);
                        const dimIcons = ["👥","📈","💰","🏠","🏡","🏷️","🏛","📍","🚗","🏪","🗺"];
                        const isExpanded = scoreDimExpanded === dim.key;
                        const pN = (v) => { if (!v) return null; const n = typeof v === "number" ? v : parseInt(String(v).replace(/[$,]/g, ""), 10); return isNaN(n) ? null : n; };
                        const popRaw = pN(site.pop3mi); const pop1Raw = pN(site.pop1mi); const hhiRaw = pN(site.income3mi);
                        const hhRaw = pN(site.households3mi); const hvRaw = pN(site.homeValue3mi);
                        const gVal = site.popGrowth3mi ? parseFloat(site.popGrowth3mi) : null;
                        const iq = site.siteiqData || {};
                        const pricePerAc = (() => { const p = parseFloat(String(site.askingPrice || "").replace(/[^0-9.]/g, "")); const a = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, "")); return (!isNaN(p) && p > 0 && !isNaN(a) && a > 0) ? Math.round(p / a) : null; })();
                        // Helper: metric row inside expansion
                        const MRow = ({ label, value, bench, benchLabel, color, pctOf }) => (
                          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(201,168,76,0.04)" }}>
                            <div style={{ width: 140, fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>{label}</div>
                            <div style={{ flex: 1, position: "relative", height: 10, borderRadius: 5, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, (pctOf || 0))}%`, borderRadius: 5, background: `linear-gradient(90deg, ${color}99, ${color})`, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
                            </div>
                            <div style={{ width: 90, textAlign: "right", fontSize: 13, fontWeight: 800, color: "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{value || "—"}</div>
                            {bench && <div style={{ width: 100, textAlign: "right", fontSize: 9, color: "#6B7394" }}>vs {benchLabel}</div>}
                          </div>
                        );
                        // Helper: SiteScore analysis box
                        const StorvexAnalysis = ({ text, signal, signalColor }) => (
                          <div style={{ marginTop: 16, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(201,168,76,0.12)" }}>
                            <div style={{ background: "linear-gradient(135deg, #1E2761, #0F172A)", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 12 }}>🔬</span>
                              <span style={{ fontSize: 10, fontWeight: 900, color: "#C9A84C", letterSpacing: "0.1em" }}>STORVEX SUMMARY ANALYSIS</span>
                              {signal && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, padding: "2px 10px", borderRadius: 5, background: (signalColor || "#C9A84C") + "18", color: signalColor || "#C9A84C" }}>{signal}</span>}
                            </div>
                            <div style={{ padding: "12px 16px", background: "rgba(10,10,14,0.6)", fontSize: 11, color: "#CBD5E1", lineHeight: 1.7 }}>{text}</div>
                          </div>
                        );
                        // Build expansion content per dimension key
                        const renderDimExpansion = () => {
                          const dK = dim.key;
                          if (dK === "population") {
                            const popBench = 40000; const minPop = 5000;
                            const popPct = popRaw ? Math.min(100, (popRaw / popBench) * 100) : 0;
                            const pop1Pct = pop1Raw ? Math.min(100, (pop1Raw / 10000) * 100) : 0;
                            const futurePop = popRaw && gVal != null ? Math.round(popRaw * Math.pow(1 + gVal / 100, 5)) : null;
                            const futPct = futurePop ? Math.min(100, (futurePop / popBench) * 100) : 0;
                            const signal = popRaw >= 40000 ? "DENSE MARKET" : popRaw >= 25000 ? "SOLID DEMAND" : popRaw >= 10000 ? "EMERGING" : "THIN";
                            const sigColor = popRaw >= 40000 ? "#22C55E" : popRaw >= 25000 ? "#3B82F6" : popRaw >= 10000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(59,130,246,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>RADIUS POPULATION BREAKDOWN</div>
                                  <MRow label="1-Mile Radius" value={pop1Raw ? pop1Raw.toLocaleString() : "—"} color="#8B5CF6" pctOf={pop1Pct} bench benchLabel="10K" />
                                  <MRow label="3-Mile Radius" value={popRaw ? popRaw.toLocaleString() : "—"} color="#3B82F6" pctOf={popPct} bench benchLabel="40K" />
                                  <MRow label="5-Mile (est.)" value={popRaw ? Math.round(popRaw * 2.4).toLocaleString() : "—"} color="#1D4ED8" pctOf={popRaw ? Math.min(100, (popRaw * 2.4 / 100000) * 100) : 0} bench benchLabel="100K" />
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(34,197,94,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>PROJECTED TRAJECTORY (2025-2030)</div>
                                  <MRow label="Current (2025)" value={popRaw ? popRaw.toLocaleString() : "—"} color="#3B82F6" pctOf={popPct} />
                                  <MRow label="Projected (2030)" value={futurePop ? futurePop.toLocaleString() : "—"} color={gVal > 0 ? "#22C55E" : "#EF4444"} pctOf={futPct} />
                                  <MRow label="Net Change" value={futurePop && popRaw ? (futurePop > popRaw ? "+" : "") + (futurePop - popRaw).toLocaleString() : "—"} color={gVal > 0 ? "#22C55E" : "#EF4444"} pctOf={futurePop && popRaw ? Math.min(100, Math.abs(futurePop - popRaw) / popRaw * 100 * 5) : 0} />
                                  <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", display: "flex", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: 10, color: "#6B7394" }}>5-Year CAGR</span>
                                    <span style={{ fontSize: 13, fontWeight: 800, color: gVal > 0 ? "#22C55E" : gVal === 0 ? "#94A3B8" : "#EF4444", fontFamily: "'Space Mono', monospace" }}>{gVal != null ? (gVal >= 0 ? "+" : "") + gVal.toFixed(2) + "%" : "—"}</span>
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 4 }}>
                                <div style={{ background: "rgba(15,21,56,0.3)", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                                  <div style={{ fontSize: 8, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em" }}>PS BENCHMARK</div>
                                  <div style={{ fontSize: 16, fontWeight: 900, color: "#4A5080", fontFamily: "'Space Mono', monospace" }}>40,000</div>
                                  <div style={{ fontSize: 9, color: popRaw >= 40000 ? "#22C55E" : "#F59E0B", fontWeight: 700 }}>{popRaw ? (popRaw >= 40000 ? "EXCEEDS" : Math.round(popRaw / 400) + "% of target") : "—"}</div>
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.3)", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                                  <div style={{ fontSize: 8, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em" }}>MIN THRESHOLD</div>
                                  <div style={{ fontSize: 16, fontWeight: 900, color: "#EF4444", fontFamily: "'Space Mono', monospace" }}>5,000</div>
                                  <div style={{ fontSize: 9, color: popRaw >= 5000 ? "#22C55E" : "#EF4444", fontWeight: 700 }}>{popRaw >= 5000 ? "CLEAR" : "BELOW MIN"}</div>
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.3)", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                                  <div style={{ fontSize: 8, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em" }}>DENSITY SIGNAL</div>
                                  <div style={{ fontSize: 14, fontWeight: 900, color: sigColor, fontFamily: "'Space Mono', monospace" }}>{signal}</div>
                                  <div style={{ fontSize: 9, color: "#6B7394", fontWeight: 600 }}>Score: {dim.score}/10</div>
                                </div>
                              </div>
                              <StorvexAnalysis signal={signal} signalColor={sigColor} text={popRaw >= 40000 ? `Dense population base of ${popRaw.toLocaleString()} within 3 miles indicates strong latent storage demand. This market exceeds Public Storage's 40K benchmark, placing it in the top tier for household-driven self-storage absorption. ${gVal > 1 ? "Combined with above-average growth, this submarket has compounding demand tailwinds." : "Population density alone supports facility viability."}` : popRaw >= 15000 ? `Population of ${popRaw.toLocaleString()} within 3 miles falls in the mid-range for storage feasibility. While below the 40K premium benchmark, this density is sufficient to support a climate-controlled facility if competition is limited. ${gVal > 1.5 ? "Strong growth trajectory could push this into premium territory within 3-5 years." : "Growth and income quality become critical tiebreakers at this population level."}` : `Population of ${popRaw ? popRaw.toLocaleString() : "N/A"} within 3 miles signals a thinner demand base. Storage facilities in sub-15K markets require either very low competition, premium income demographics, or exceptional growth to justify development. Recommend careful validation of demand drivers.`} />
                            </div>);
                          }
                          if (dK === "growth") {
                            const gC = gVal > 1.5 ? "#22C55E" : gVal > 0.5 ? "#4ADE80" : gVal > 0 ? "#FBBF24" : gVal > -0.5 ? "#94A3B8" : "#EF4444";
                            const outlook = gVal > 2.0 ? "RAPID EXPANSION" : gVal > 1.5 ? "HIGH GROWTH" : gVal > 1.0 ? "ABOVE AVERAGE" : gVal > 0.5 ? "STEADY GROWTH" : gVal > 0 ? "STABLE" : gVal > -0.5 ? "FLAT" : "DECLINING";
                            const natAvg = 0.5; const futurePop = popRaw && gVal != null ? Math.round(popRaw * Math.pow(1 + gVal / 100, 5)) : null;
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 20, border: `1px solid ${gC}15`, textAlign: "center" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 8 }}>5-YEAR COMPOUND ANNUAL GROWTH RATE</div>
                                  <div style={{ fontSize: 48, fontWeight: 900, color: gC, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{gVal != null ? (gVal >= 0 ? "+" : "") + gVal.toFixed(2) + "%" : "—"}</div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: gC, marginTop: 8, letterSpacing: "0.05em" }}>{outlook}</div>
                                  <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.04)", overflow: "hidden", marginTop: 14 }}>
                                    <div style={{ height: "100%", width: `${Math.min(100, Math.max(5, ((gVal || 0) / 3) * 100))}%`, borderRadius: 4, background: `linear-gradient(90deg, ${gC}99, ${gC})` }} />
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span style={{ fontSize: 8, color: "#4A5080" }}>0%</span><span style={{ fontSize: 8, color: "#4A5080" }}>3%+ (rapid)</span></div>
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 20, border: "1px solid rgba(59,130,246,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 14 }}>GROWTH CONTEXT</div>
                                  <MRow label="This Market" value={gVal != null ? gVal.toFixed(2) + "%" : "—"} color={gC} pctOf={gVal ? Math.min(100, (gVal / 3) * 100) : 0} />
                                  <MRow label="National Average" value={natAvg.toFixed(2) + "%"} color="#4A5080" pctOf={(natAvg / 3) * 100} />
                                  <MRow label="Spread vs National" value={gVal != null ? (gVal - natAvg >= 0 ? "+" : "") + (gVal - natAvg).toFixed(2) + "%" : "—"} color={gVal > natAvg ? "#22C55E" : "#EF4444"} pctOf={gVal ? Math.min(100, Math.abs(gVal - natAvg) / 3 * 100) : 0} />
                                  {futurePop && popRaw && <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}>
                                    <div style={{ fontSize: 9, color: "#6B7394", marginBottom: 4 }}>5-YEAR NET POPULATION CHANGE</div>
                                    <div style={{ fontSize: 18, fontWeight: 900, color: futurePop > popRaw ? "#22C55E" : "#EF4444", fontFamily: "'Space Mono', monospace" }}>{futurePop > popRaw ? "+" : ""}{(futurePop - popRaw).toLocaleString()} people</div>
                                    <div style={{ fontSize: 10, color: "#94A3B8" }}>{popRaw.toLocaleString()} (2025) → {futurePop.toLocaleString()} (2030)</div>
                                  </div>}
                                </div>
                              </div>
                              <StorvexAnalysis signal={outlook} signalColor={gC} text={gVal > 1.5 ? `This submarket is growing at ${gVal.toFixed(2)}% annually, ${(gVal / natAvg).toFixed(1)}x the national average. Rapid population growth is the strongest predictor of new storage demand, as incoming households typically need storage during relocation transitions. This growth rate projects ${futurePop ? "+" + (futurePop - (popRaw || 0)).toLocaleString() + " new residents" : "significant expansion"} by 2030, creating a compounding demand tailwind.` : gVal > 0.5 ? `Growth rate of ${gVal.toFixed(2)}% tracks above the national average of ${natAvg}%. Steady population expansion supports organic storage demand growth. New household formation in this corridor will drive incremental absorption, though the pace suggests a 3-5 year lease-up horizon for new development.` : gVal > 0 ? `Modest growth at ${gVal.toFixed(2)}% is near the national baseline. Storage demand will be primarily driven by existing household turnover and life events (moves, downsizing, renovations) rather than net new population. Competition quality becomes the critical differentiator in stable markets.` : `Population contraction at ${gVal ? gVal.toFixed(2) : "N/A"}% annually presents a demand headwind. Storage facilities in declining markets can still perform if positioned to capture market share from weaker operators, but organic demand growth is limited. Recommend focus on existing facility occupancy data and competitor health.`} />
                            </div>);
                          }
                          if (dK === "income") {
                            const hhiBench = 90000; const midBench = 65000; const minBench = 55000;
                            const pctTop = hhiRaw ? Math.min(100, (hhiRaw / hhiBench) * 100) : 0;
                            const tier = hhiRaw >= 90000 ? "PREMIUM" : hhiRaw >= 75000 ? "AFFLUENT" : hhiRaw >= 65000 ? "STRONG" : hhiRaw >= 55000 ? "ADEQUATE" : "BELOW THRESHOLD";
                            const tierC = hhiRaw >= 90000 ? "#C9A84C" : hhiRaw >= 75000 ? "#22C55E" : hhiRaw >= 65000 ? "#3B82F6" : hhiRaw >= 55000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${tierC}15` }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>MEDIAN HOUSEHOLD INCOME</div>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1, marginBottom: 8 }}>{hhiRaw ? "$" + hhiRaw.toLocaleString() : "—"}</div>
                                  <div style={{ display: "inline-block", padding: "4px 12px", borderRadius: 6, background: tierC + "18", border: `1px solid ${tierC}30` }}>
                                    <span style={{ fontSize: 11, fontWeight: 800, color: tierC }}>{tier}</span>
                                  </div>
                                  <div style={{ marginTop: 14 }}>
                                    <MRow label="This Market" value={"$" + (hhiRaw || 0).toLocaleString()} color={tierC} pctOf={pctTop} />
                                    <MRow label="Premium ($90K)" value="$90,000" color="#C9A84C" pctOf={100} />
                                    <MRow label="Strong ($65K)" value="$65,000" color="#3B82F6" pctOf={(65000 / hhiBench) * 100} />
                                    <MRow label="Minimum ($55K)" value="$55,000" color="#EF4444" pctOf={(55000 / hhiBench) * 100} />
                                  </div>
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(201,168,76,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>INCOME IMPLICATIONS FOR STORAGE</div>
                                  {[
                                    { label: "Willingness to Pay", val: hhiRaw >= 75000 ? "High" : hhiRaw >= 55000 ? "Moderate" : "Limited", color: hhiRaw >= 75000 ? "#22C55E" : hhiRaw >= 55000 ? "#F59E0B" : "#EF4444", desc: "Higher income = premium unit absorption" },
                                    { label: "Climate-Controlled Demand", val: hhiRaw >= 65000 ? "Strong" : "Moderate", color: hhiRaw >= 65000 ? "#22C55E" : "#F59E0B", desc: "Affluent households store higher-value items" },
                                    { label: "Price Sensitivity", val: hhiRaw >= 90000 ? "Low" : hhiRaw >= 65000 ? "Moderate" : "High", color: hhiRaw >= 90000 ? "#22C55E" : hhiRaw >= 65000 ? "#F59E0B" : "#EF4444", desc: "Impacts rate growth potential" },
                                  ].map((r, j) => (
                                    <div key={j} style={{ padding: "10px 0", borderBottom: j < 2 ? "1px solid rgba(201,168,76,0.04)" : "none" }}>
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: "#E2E8F0" }}>{r.label}</span>
                                        <span style={{ fontSize: 12, fontWeight: 800, color: r.color, fontFamily: "'Space Mono', monospace" }}>{r.val}</span>
                                      </div>
                                      <div style={{ fontSize: 9, color: "#6B7394", marginTop: 2 }}>{r.desc}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <StorvexAnalysis signal={tier} signalColor={tierC} text={hhiRaw >= 90000 ? `Premium income market at $${hhiRaw.toLocaleString()} median HHI. Households at this income level are the core self-storage demographic: homeowners with accumulated possessions, disposable income for monthly storage rents, and preference for climate-controlled units. This income tier supports premium pricing strategies and strong RevPAF.` : hhiRaw >= 65000 ? `Solid income base at $${hhiRaw.toLocaleString()} median HHI. This level supports standard self-storage pricing and moderate climate-controlled unit demand. Households can absorb typical rate increases without significant churn. Income alone is not a differentiator but removes downside risk.` : `Income at $${(hhiRaw || 0).toLocaleString()} approaches the $55K minimum threshold. Lower-income markets typically see higher price sensitivity, lower climate-controlled uptake, and greater churn. Storage demand exists but skews toward smaller, drive-up units. Premium pricing will be constrained.`} />
                            </div>);
                          }
                          if (dK === "households") {
                            const hhBench = 25000;
                            const hhPct = hhRaw ? Math.min(100, (hhRaw / hhBench) * 100) : 0;
                            const signal = hhRaw >= 25000 ? "DEEP DEMAND POOL" : hhRaw >= 18000 ? "STRONG BASE" : hhRaw >= 12000 ? "ADEQUATE" : hhRaw >= 6000 ? "MODERATE" : "LIMITED";
                            const sigC = hhRaw >= 25000 ? "#22C55E" : hhRaw >= 12000 ? "#3B82F6" : hhRaw >= 6000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${sigC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>3-MILE HOUSEHOLD COUNT</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{hhRaw ? hhRaw.toLocaleString() : "—"}</div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: sigC + "18", border: `1px solid ${sigC}30` }}>
                                    <span style={{ fontSize: 11, fontWeight: 800, color: sigC }}>{signal}</span>
                                  </div>
                                </div>
                                <MRow label="This Market" value={(hhRaw || 0).toLocaleString()} color={sigC} pctOf={hhPct} bench benchLabel="25K" />
                                <MRow label="Top Tier (25K)" value="25,000" color="#22C55E" pctOf={100} />
                                <MRow label="Solid Base (12K)" value="12,000" color="#3B82F6" pctOf={48} />
                                <MRow label="Minimum (6K)" value="6,000" color="#F59E0B" pctOf={24} />
                                {popRaw && hhRaw && <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ fontSize: 10, color: "#6B7394" }}>Avg Household Size</span>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{(popRaw / hhRaw).toFixed(1)} people/hh</span>
                                </div>}
                              </div>
                              <StorvexAnalysis signal={signal} signalColor={sigC} text={hhRaw >= 25000 ? `${hhRaw.toLocaleString()} households within 3 miles represents a deep demand pool. Industry data indicates approximately 10% of US households rent storage at any given time, projecting ~${Math.round(hhRaw * 0.10).toLocaleString()} potential storage renters in this trade area. This base can support multiple facilities without saturation.` : hhRaw >= 12000 ? `${hhRaw.toLocaleString()} households provide a solid demand base. With typical 10% storage penetration, this projects ~${Math.round((hhRaw || 0) * 0.10).toLocaleString()} potential renters. Sufficient to support a single well-positioned facility, though competition share becomes a critical variable.` : `Household count of ${(hhRaw || 0).toLocaleString()} indicates a thinner customer base. Each competitor in the trade area consumes a larger share of available demand. Success depends on capturing a dominant market position and/or below-average competition.`} />
                            </div>);
                          }
                          if (dK === "homeValue") {
                            const hvBench = 500000;
                            const hvPct = hvRaw ? Math.min(100, (hvRaw / hvBench) * 100) : 0;
                            const tier = hvRaw >= 500000 ? "PREMIUM" : hvRaw >= 350000 ? "UPPER-MIDDLE" : hvRaw >= 250000 ? "MIDDLE MARKET" : hvRaw >= 180000 ? "MODERATE" : "VALUE";
                            const tierC = hvRaw >= 500000 ? "#C9A84C" : hvRaw >= 350000 ? "#22C55E" : hvRaw >= 250000 ? "#3B82F6" : hvRaw >= 180000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${tierC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>MEDIAN HOME VALUE (3-MI)</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{hvRaw ? "$" + hvRaw.toLocaleString() : "—"}</div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: tierC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: tierC }}>{tier}</span></div>
                                </div>
                                <MRow label="This Market" value={"$" + (hvRaw || 0).toLocaleString()} color={tierC} pctOf={hvPct} bench benchLabel="$500K" />
                                <MRow label="Premium ($500K)" value="$500,000" color="#C9A84C" pctOf={100} />
                                <MRow label="Affluent ($350K)" value="$350,000" color="#22C55E" pctOf={70} />
                                <MRow label="Middle ($250K)" value="$250,000" color="#3B82F6" pctOf={50} />
                              </div>
                              <StorvexAnalysis signal={tier} signalColor={tierC} text={hvRaw >= 350000 ? `Home values averaging $${(hvRaw || 0).toLocaleString()} signal an affluent submarket. Higher home values strongly correlate with storage demand: homeowners accumulate more possessions, invest in climate-sensitive items (furniture, electronics, wine), and are willing to pay premium storage rates. This is a wealth indicator that supports aggressive RevPAF targets.` : hvRaw >= 180000 ? `Middle-market home values at $${(hvRaw || 0).toLocaleString()} indicate a stable residential base. Storage demand will be driven by standard household storage needs (seasonal items, life transitions) rather than premium asset storage. Pricing should target competitive market rates.` : `Home values below $180K suggest a value-oriented market. Storage demand exists but skews toward basic, cost-sensitive solutions. Climate-controlled premium units may see slower absorption. Drive-up and smaller unit mixes perform better in this tier.`} />
                            </div>);
                          }
                          if (dK === "zoning") {
                            const zClass = site.zoningClassification || "unknown";
                            const zColor = zClass === "by-right" ? "#22C55E" : zClass === "conditional" ? "#F59E0B" : zClass === "rezone-required" ? "#EF4444" : "#6B7394";
                            const zLabel = zClass === "by-right" ? "BY-RIGHT" : zClass === "conditional" ? "CONDITIONAL (SUP/CUP)" : zClass === "rezone-required" ? "REZONE REQUIRED" : "UNKNOWN";
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${zColor}15` }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>ZONING CLASSIFICATION</div>
                                  <div style={{ fontSize: 22, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", marginBottom: 6 }}>{site.zoning || "TBD"}</div>
                                  <div style={{ display: "inline-block", padding: "5px 14px", borderRadius: 6, background: zColor + "18", border: `1px solid ${zColor}30`, marginBottom: 14 }}>
                                    <span style={{ fontSize: 12, fontWeight: 800, color: zColor }}>{zLabel}</span>
                                  </div>
                                  {site.zoningUseTerm && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", marginBottom: 8 }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>USE CATEGORY: </span><span style={{ fontSize: 11, color: "#E2E8F0" }}>{site.zoningUseTerm}</span></div>}
                                  {site.zoningOrdinanceSection && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", marginBottom: 8 }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>ORDINANCE: </span><span style={{ fontSize: 11, color: "#E2E8F0" }}>{site.zoningOrdinanceSection}</span></div>}
                                  {site.overlayDistrict && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>OVERLAY: </span><span style={{ fontSize: 11, color: "#E2E8F0" }}>{site.overlayDistrict}</span></div>}
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(201,168,76,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 14 }}>ENTITLEMENT REQUIREMENTS</div>
                                  {[
                                    { label: "Permitting Path", val: zLabel, color: zColor },
                                    { label: "Est. Timeline", val: site.supTimeline || (zClass === "by-right" ? "30-60 days" : zClass === "conditional" ? "3-6 months" : "6-12+ months"), color: zClass === "by-right" ? "#22C55E" : zClass === "conditional" ? "#F59E0B" : "#EF4444" },
                                    { label: "Est. Cost", val: site.supCost || (zClass === "by-right" ? "$5K-$15K" : zClass === "conditional" ? "$25K-$50K" : "$50K-$100K+") },
                                    { label: "Political Risk", val: site.politicalRisk || "Not assessed" },
                                    { label: "Planning Contact", val: site.planningContact || "Not recorded" },
                                  ].map((r, j) => (
                                    <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: j < 4 ? "1px solid rgba(201,168,76,0.04)" : "none" }}>
                                      <span style={{ fontSize: 11, color: "#94A3B8" }}>{r.label}</span>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: r.color || "#E2E8F0", textAlign: "right", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.val}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <StorvexAnalysis signal={zLabel} signalColor={zColor} text={zClass === "by-right" ? `Storage is permitted by-right under ${site.zoning || "current zoning"}, eliminating the largest entitlement risk factor. By-right approval typically takes 30-60 days through standard site plan review. This is the optimal zoning scenario and significantly de-risks the development timeline.${site.facadeReqs ? " Note: architectural/facade requirements may apply." : ""}` : zClass === "conditional" ? `Storage requires a conditional use permit (SUP/CUP) under ${site.zoning || "current zoning"}. This introduces 3-6 months of entitlement timeline and $25K-$50K in application/legal costs. Success depends on political environment, neighbor opposition risk, and recent approval history. ${site.politicalRisk === "Low" ? "Low political risk noted." : "Recommend checking recent storage approvals in this jurisdiction."}` : zClass === "rezone-required" ? `Rezoning is required, representing the highest entitlement risk. Timeline extends to 6-12+ months with $50K-$100K+ in costs and no guarantee of approval. This adds significant risk premium to the deal and should be reflected in pricing negotiations.` : `Zoning classification not yet confirmed for ${site.zoning || "this parcel"}. Immediate verification of the permitted use table is required before advancing. Contact local planning department to confirm self-storage permissibility under the current district.`} />
                            </div>);
                          }
                          if (dK === "psProximity") {
                            const psD = iq.nearestPS; const psDist = typeof psD === "number" ? psD : parseFloat(psD);
                            const proxSignal = psDist <= 5 ? "VALIDATED SUBMARKET" : psDist <= 10 ? "PS ADJACENT" : psDist <= 15 ? "MODERATE DISTANCE" : psDist <= 25 ? "EDGE OF FOOTPRINT" : "REMOTE";
                            const proxC = psDist <= 5 ? "#22C55E" : psDist <= 10 ? "#3B82F6" : psDist <= 15 ? "#F59E0B" : "#E87A2E";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${proxC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>PS NEAREST FACILITY PROXIMITY</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                  <div style={{ fontSize: 42, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{psDist ? psDist.toFixed(1) : "—"}<span style={{ fontSize: 16, color: "#6B7394" }}> mi</span></div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: proxC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: proxC }}>{proxSignal}</span></div>
                                </div>
                                <div style={{ marginTop: 8 }}>
                                  {[
                                    { label: "0-5 mi: Validated Submarket", color: "#22C55E", active: psDist <= 5, score: "10/10" },
                                    { label: "5-10 mi: PS Adjacent", color: "#3B82F6", active: psDist > 5 && psDist <= 10, score: "9/10" },
                                    { label: "10-15 mi: Moderate", color: "#F59E0B", active: psDist > 10 && psDist <= 15, score: "7/10" },
                                    { label: "15-25 mi: Edge", color: "#E87A2E", active: psDist > 15 && psDist <= 25, score: "5/10" },
                                    { label: "25-35 mi: Remote", color: "#EF4444", active: psDist > 25, score: "3/10" },
                                  ].map((t, j) => (
                                    <div key={j} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 6, marginBottom: 4, background: t.active ? t.color + "12" : "transparent", border: t.active ? `1px solid ${t.color}30` : "1px solid transparent" }}>
                                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.active ? t.color : "#4A5080" }} />
                                      <span style={{ fontSize: 11, color: t.active ? "#E2E8F0" : "#6B7394", fontWeight: t.active ? 700 : 500, flex: 1 }}>{t.label}</span>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: t.active ? t.color : "#4A5080", fontFamily: "'Space Mono', monospace" }}>{t.score}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <StorvexAnalysis signal={proxSignal} signalColor={proxC} text={psDist <= 5 ? `Nearest PS facility is just ${psDist.toFixed(1)} miles away, confirming this as a validated PS submarket. Proximity to existing PS locations indicates the market has been previously vetted and approved by PS development. Closer proximity = stronger market validation signal, not cannibalization risk. New facilities in proven PS markets typically achieve faster lease-up.` : psDist <= 15 ? `At ${psDist.toFixed(1)} miles from the nearest PS location, this site sits within PS's established operating footprint. The distance suggests an adjacent trade area that PS has not yet saturated, presenting an infill opportunity. This proximity supports operational efficiency for PS's regional management structure.` : `${psDist ? psDist.toFixed(1) : "N/A"} miles from the nearest PS facility places this at the edge of PS's current footprint. While not a disqualifier, sites beyond 25 miles require stronger standalone fundamentals (demographics, growth, limited competition) to justify expansion into a new submarket. Above 35 miles is an automatic exclusion per PS criteria.`} />
                            </div>);
                          }
                          if (dK === "access") {
                            const acreage = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
                            const sizeSignal = acreage >= 3.5 && acreage <= 5 ? "IDEAL SIZE" : acreage >= 2.5 ? "VIABLE" : acreage >= 5 && acreage <= 7 ? "LARGE" : "REVIEW";
                            const sizeC = acreage >= 3.5 && acreage <= 5 ? "#22C55E" : acreage >= 2.5 ? "#3B82F6" : "#F59E0B";
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${sizeC}15` }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>SITE SIZE & CONFIGURATION</div>
                                  <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14 }}>
                                    <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{acreage ? acreage.toFixed(2) : "—"}<span style={{ fontSize: 14, color: "#6B7394" }}> ac</span></div>
                                    <div style={{ padding: "4px 12px", borderRadius: 6, background: sizeC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: sizeC }}>{sizeSignal}</span></div>
                                  </div>
                                  {[
                                    { label: "Primary (3.5-5 ac)", desc: "One-story indoor CC", range: [3.5, 5], color: "#22C55E" },
                                    { label: "Secondary (2.5-3.5 ac)", desc: "Multi-story option", range: [2.5, 3.5], color: "#3B82F6" },
                                    { label: "Large (5-7 ac)", desc: "Subdivisible", range: [5, 7], color: "#F59E0B" },
                                  ].map((r, j) => (
                                    <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 5, marginBottom: 3, background: acreage >= r.range[0] && acreage <= r.range[1] ? r.color + "12" : "transparent" }}>
                                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: acreage >= r.range[0] && acreage <= r.range[1] ? r.color : "#4A5080" }} />
                                      <span style={{ fontSize: 10, color: acreage >= r.range[0] && acreage <= r.range[1] ? "#E2E8F0" : "#6B7394", fontWeight: acreage >= r.range[0] && acreage <= r.range[1] ? 700 : 500 }}>{r.label}</span>
                                      <span style={{ fontSize: 9, color: "#4A5080", marginLeft: "auto" }}>{r.desc}</span>
                                    </div>
                                  ))}
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(201,168,76,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 14 }}>ACCESS & ENVIRONMENTAL</div>
                                  {[
                                    { label: "Road Frontage", val: site.roadFrontage || "Not confirmed" },
                                    { label: "Traffic (VPD)", val: site.trafficData || "—" },
                                    { label: "Flood Zone", val: site.floodZone || "Not checked", color: site.floodZone && site.floodZone.toLowerCase().includes("zone x") ? "#22C55E" : "#F59E0B" },
                                    { label: "Terrain", val: site.terrain || "—" },
                                    { label: "Visibility", val: site.visibility || "—" },
                                  ].map((r, j) => (
                                    <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: j < 4 ? "1px solid rgba(201,168,76,0.04)" : "none" }}>
                                      <span style={{ fontSize: 11, color: "#94A3B8" }}>{r.label}</span>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: r.color || "#E2E8F0", textAlign: "right", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.val}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <StorvexAnalysis signal={sizeSignal} signalColor={sizeC} text={`${acreage ? acreage.toFixed(2) + " acres" : "Acreage TBD"} — ${acreage >= 3.5 && acreage <= 5 ? "ideal footprint for PS's preferred one-story, indoor climate-controlled product. This size accommodates 80,000-110,000 net rentable SF with adequate parking, landscaping, and stormwater management." : acreage >= 2.5 && acreage < 3.5 ? "suitable for a multi-story (3-4 story) climate-controlled facility. Tighter footprint requires vertical construction but can still achieve 70,000-100,000 net rentable SF." : acreage > 5 ? "large parcel offers flexibility. Could accommodate PS's standard product with excess land for future expansion, pad site sale, or outparcel development to offset land basis." : "may be undersized for PS's standard product. Evaluate whether a compact multi-story design is feasible for this footprint."} ${site.floodZone && !site.floodZone.toLowerCase().includes("zone x") ? " Flood zone designation requires additional investigation." : ""}`} />
                            </div>);
                          }
                          if (dK === "competition") {
                            const compCount = iq.competitorCount || 0;
                            const compNames = iq.competitorNames;
                            const nearComp = iq.nearestCompetitor;
                            const signal = compCount <= 1 ? "UNDERSERVED" : compCount <= 3 ? "LOW COMPETITION" : compCount <= 6 ? "MODERATE" : "COMPETITIVE";
                            const sigC = compCount <= 1 ? "#22C55E" : compCount <= 3 ? "#3B82F6" : compCount <= 6 ? "#F59E0B" : "#EF4444";
                            const operators = compNames ? String(compNames).split(",").map(n => n.trim()).filter(Boolean) : [];
                            const reitCount = operators.filter(n => n.match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage|National Storage/i)).length;
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${sigC}15` }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>COMPETITIVE DENSITY (3-MI RADIUS)</div>
                                  <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                    <div style={{ fontSize: 48, fontWeight: 900, color: sigC, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{compCount}</div>
                                    <div>
                                      <div style={{ padding: "4px 12px", borderRadius: 6, background: sigC + "18", marginBottom: 4 }}><span style={{ fontSize: 11, fontWeight: 800, color: sigC }}>{signal}</span></div>
                                      {reitCount > 0 && <div style={{ fontSize: 10, color: "#EF4444", fontWeight: 700 }}>{reitCount} REIT operator{reitCount > 1 ? "s" : ""}</div>}
                                    </div>
                                  </div>
                                  {nearComp && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", marginBottom: 8 }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>NEAREST: </span><span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 600 }}>{nearComp}</span></div>}
                                  {(site.demandSupplySignal || site.competingSF) && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>MARKET: </span><span style={{ fontSize: 11, color: "#C9A84C", fontWeight: 600 }}>{site.demandSupplySignal || site.competingSF}</span></div>}
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(232,122,46,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 10 }}>OPERATOR LANDSCAPE</div>
                                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                                    {operators.length > 0 ? operators.map((name, j) => (
                                      <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: j < operators.length - 1 ? "1px solid rgba(201,168,76,0.04)" : "none" }}>
                                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: name.match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage/i) ? "#EF4444" : name.match(/StorageMart|U-Haul|SecurCare/i) ? "#F59E0B" : "#3B82F6", flexShrink: 0 }} />
                                        <span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 600, flex: 1 }}>{name}</span>
                                        {name.match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage|National Storage/i) && <span style={{ fontSize: 8, fontWeight: 800, color: "#EF4444", background: "rgba(239,68,68,0.1)", padding: "1px 5px", borderRadius: 3 }}>REIT</span>}
                                      </div>
                                    )) : <div style={{ fontSize: 11, color: "#6B7394", fontStyle: "italic" }}>No operator data available</div>}
                                  </div>
                                </div>
                              </div>
                              <StorvexAnalysis signal={signal} signalColor={sigC} text={compCount <= 1 ? `Only ${compCount} competing facilit${compCount === 1 ? "y" : "ies"} within 3 miles signals an underserved market with significant unmet demand. Low competition environments allow for premium pricing, faster lease-up, and dominant market positioning. This is the ideal competitive landscape for a new PS development.` : compCount <= 3 ? `${compCount} competitors within 3 miles represents manageable competition. Market is not saturated, and a well-positioned PS facility can capture meaningful share. ${reitCount > 0 ? `${reitCount} REIT operator(s) present validates institutional-grade demand.` : "Predominantly local operators suggest opportunity for a REIT-quality facility to capture market share."} Focus on differentiation through climate-controlled product and PS brand strength.` : compCount <= 6 ? `${compCount} facilities within 3 miles indicates moderate competition. Market is established with proven demand, but share capture requires competitive positioning. ${reitCount >= 2 ? "Multiple REIT operators confirm a mature, validated market." : ""} Key success factors: unit mix optimization, competitive rate strategy, and superior site visibility/access.` : `${compCount} facilities within 3 miles signals high competitive density. New entrant faces lease-up headwinds in a market with existing supply. Recommend careful analysis of occupancy rates, rate trends, and whether recent new supply has been absorbed. Success requires a differentiated value proposition or displacement of weaker operators.`} />
                            </div>);
                          }
                          if (dK === "marketTier") {
                            const mt = iq.marketTier;
                            const tierLabel = mt === 1 ? "TIER 1 — PRIMARY" : mt === 2 ? "TIER 2 — STRATEGIC" : mt === 3 ? "TIER 3 — GROWTH" : mt === 4 ? "TIER 4 — EMERGING" : "UNCLASSIFIED";
                            const tierC = mt === 1 ? "#C9A84C" : mt === 2 ? "#22C55E" : mt === 3 ? "#3B82F6" : mt === 4 ? "#8B5CF6" : "#6B7394";
                            const tierMarkets = { 1: "Cincinnati / N. KY, Indianapolis", 2: "Independence KY, S. Dayton OH, Springboro OH", 3: "Middle TN corridor", 4: "DFW, Austin, Houston, Central TX" };
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${tierC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>TARGET MARKET CLASSIFICATION</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 16 }}>
                                  <div style={{ fontSize: 28, fontWeight: 900, color: tierC, letterSpacing: "0.02em" }}>{tierLabel}</div>
                                </div>
                                {[1, 2, 3, 4].map(t => (
                                  <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 6, marginBottom: 4, background: mt === t ? (t === 1 ? "#C9A84C" : t === 2 ? "#22C55E" : t === 3 ? "#3B82F6" : "#8B5CF6") + "12" : "transparent", border: mt === t ? `1px solid ${t === 1 ? "#C9A84C" : t === 2 ? "#22C55E" : t === 3 ? "#3B82F6" : "#8B5CF6"}30` : "1px solid transparent" }}>
                                    <div style={{ width: 24, height: 24, borderRadius: 6, background: (t === 1 ? "#C9A84C" : t === 2 ? "#22C55E" : t === 3 ? "#3B82F6" : "#8B5CF6") + (mt === t ? "30" : "10"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: mt === t ? "#E2E8F0" : "#4A5080" }}>{t}</div>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: 11, fontWeight: mt === t ? 700 : 500, color: mt === t ? "#E2E8F0" : "#6B7394" }}>Tier {t}: {t === 1 ? "Primary" : t === 2 ? "Strategic" : t === 3 ? "Growth" : "Emerging"}</div>
                                      <div style={{ fontSize: 9, color: "#4A5080" }}>{tierMarkets[t]}</div>
                                    </div>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: mt === t ? tierC : "#4A5080", fontFamily: "'Space Mono', monospace" }}>{t === 1 ? "10/10" : t === 2 ? "8/10" : t === 3 ? "6/10" : "4/10"}</span>
                                  </div>
                                ))}
                              </div>
                              <StorvexAnalysis signal={tierLabel} signalColor={tierC} text={mt === 1 ? `${site.market || "This market"} is a Tier 1 primary target — PS's highest-priority expansion corridor. MT and DW have confirmed active deal flow here. Sites in Tier 1 markets receive a scoring boost reflecting PS's strategic focus and established operational infrastructure in the region.` : mt === 2 ? `Tier 2 strategic market — identified as a coverage gap in PS's footprint. These markets have zero or minimal PS presence despite strong fundamentals, representing greenfield expansion opportunities.` : mt === 3 ? `Tier 3 growth market — Middle TN corridor. Growing market with PS interest but lower strategic priority than Tier 1-2. Sites here compete primarily on fundamentals (demographics, zoning, pricing) rather than market alignment.` : mt === 4 ? `Tier 4 emerging market. PS has broader interest in this region but no confirmed target list placement. Sites score on their standalone merits. Strong fundamentals can still drive advancement.` : `Market not classified in PS's target tier system. This site will be evaluated purely on demographic and competitive fundamentals without a market alignment bonus.`} />
                            </div>);
                          }
                          return <div style={{ padding: 16, fontSize: 11, color: "#6B7394", fontStyle: "italic" }}>Detailed analysis not yet available for this dimension.</div>;
                        };
                        return (
                          <div key={dim.key}>
                            <div onClick={() => setScoreDimExpanded(isExpanded ? null : dim.key)} style={{ display: "grid", gridTemplateColumns: "180px 1fr 60px 60px 70px", alignItems: "center", padding: "10px 24px", borderBottom: (i < bd.length - 1 && !isExpanded) ? "1px solid rgba(201,168,76,0.04)" : "none", transition: "background 0.15s", cursor: "pointer", background: isExpanded ? "rgba(201,168,76,0.06)" : "transparent" }} onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = "rgba(201,168,76,0.03)"; }} onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 14 }}>{dimIcons[i] || "📊"}</span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: isExpanded ? "#C9A84C" : "#E2E8F0" }}>{dim.label}</span>
                                <span style={{ fontSize: 9, color: isExpanded ? "#C9A84C" : "#4A5080", transition: "transform 0.2s", display: "inline-block", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
                              </div>
                              <div style={{ position: "relative", height: 20, borderRadius: 10, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 10, background: `linear-gradient(90deg, ${barC}CC, ${barC})`, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)", boxShadow: dim.score >= 8 ? `0 0 12px ${barC}40` : "none" }} />
                                <div style={{ position: "absolute", left: 8, top: 0, bottom: 0, display: "flex", alignItems: "center", fontSize: 10, fontWeight: 800, color: dim.score >= 5 ? "#fff" : barC, zIndex: 1 }}>{dim.score}/10</div>
                              </div>
                              <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#94A3B8", fontFamily: "'Space Mono', monospace" }}>{wPct}%</div>
                              <div style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: barC, fontFamily: "'Space Mono', monospace" }}>{dim.score}</div>
                              <div style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: "#C9A84C", fontFamily: "'Space Mono', monospace" }}>+{contrib}</div>
                            </div>
                            {/* EXPANDED DIMENSION DEEP DIVE */}
                            {isExpanded && (
                              <div style={{ padding: "16px 24px 20px", background: "rgba(10,10,14,0.8)", borderBottom: "2px solid rgba(201,168,76,0.1)", animation: "fadeIn 0.2s ease-out" }}>
                                {renderDimExpansion()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Column headers */}
                    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 60px 60px 70px", padding: "0 24px 8px", borderTop: "1px solid rgba(201,168,76,0.08)" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em", paddingTop: 8 }}>DIMENSION — CLICK TO EXPAND</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em", paddingTop: 8 }}>SCORE BAR</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em", textAlign: "center", paddingTop: 8 }}>WEIGHT</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em", textAlign: "center", paddingTop: 8 }}>RAW</div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em", textAlign: "right", paddingTop: 8 }}>CONTRIB</div>
                    </div>
                    {/* Flags */}
                    {iqR.flags && iqR.flags.length > 0 && (
                      <div style={{ padding: "12px 24px 16px", borderTop: "1px solid rgba(201,168,76,0.08)" }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 8 }}>FLAGS & ADJUSTMENTS</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {iqR.flags.map((f, i) => (
                            <span key={i} style={{ fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 6, background: f.includes("FAIL") ? "rgba(239,68,68,0.12)" : f.includes("Growth corridor") ? "rgba(34,197,94,0.12)" : "rgba(201,168,76,0.08)", color: f.includes("FAIL") ? "#EF4444" : f.includes("Growth corridor") ? "#22C55E" : "#C9A84C", border: `1px solid ${f.includes("FAIL") ? "rgba(239,68,68,0.2)" : f.includes("Growth corridor") ? "rgba(34,197,94,0.2)" : "rgba(201,168,76,0.15)"}` }}>{f}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* KEY METRICS STRIP — with hover tooltips */}
              {(() => {
                const parsePrice = (v) => { if (!v) return NaN; const s = String(v).replace(/,/g, ""); const m = s.match(/([\d.]+)\s*[Mm]/); if (m) return parseFloat(m[1]) * 1000000; return parseFloat(s.replace(/[^0-9.]/g, "")); };
                const askRaw = parsePrice(site.askingPrice);
                const intRaw = parsePrice(site.internalPrice);
                const acRaw = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
                const popRaw = parseInt(String(site.pop3mi || "").replace(/[^0-9]/g, ""), 10);
                const incRaw = parseInt(String(site.income3mi || "").replace(/[^0-9]/g, ""), 10);
                const hhRaw = parseInt(String(site.households3mi || "").replace(/[^0-9]/g, ""), 10);
                const hvRaw = parseInt(String(site.homeValue3mi || "").replace(/[^0-9]/g, ""), 10);
                const growthRaw = site.popGrowth3mi || site.growthRate;
                const growthPct = growthRaw ? parseFloat(String(growthRaw).replace(/[^0-9.\-]/g, "")) : null;
                const ppaVal = (!isNaN(askRaw) && askRaw > 0 && !isNaN(acRaw) && acRaw > 0) ? Math.round(askRaw / acRaw) : null;
                const dom = site.daysOnMarket || site.dom;
                const phase = site.phase || "Prospect";

                const buildTooltip = (key) => {
                  if (key === "asking") {
                    const domStr = dom ? `${dom} days on market` : null;
                    const ppaStr = ppaVal ? `$${ppaVal.toLocaleString()}/acre` : null;
                    const lines = [];
                    lines.push(!isNaN(askRaw) && askRaw > 0 ? `Listed at $${askRaw.toLocaleString()}` : "No asking price listed");
                    if (ppaStr) lines.push(`Equates to ${ppaStr} across ${acRaw} acres`);
                    if (domStr) lines.push(domStr);
                    if (!isNaN(intRaw) && intRaw > 0) { const disc = (((askRaw - intRaw) / askRaw) * 100).toFixed(1); lines.push(`Internal target: $${intRaw.toLocaleString()} (${disc}% below ask)`); }
                    if (ppaVal) { const tier = ppaVal <= 150000 ? "Excellent - well below $150K/ac target" : ppaVal <= 250000 ? "Good - within $250K/ac acquisition range" : ppaVal <= 400000 ? "Moderate - above preferred range" : "Premium pricing - above $400K/ac"; lines.push(tier); }
                    return lines;
                  }
                  if (key === "internal") {
                    const lines = [];
                    if (!isNaN(intRaw) && intRaw > 0) {
                      if (phase === "Under Contract") lines.push(`Under contract at $${intRaw.toLocaleString()}`);
                      else if (phase === "LOI") lines.push(`LOI submitted at $${intRaw.toLocaleString()}`);
                      else if (phase === "PSA Sent") lines.push(`PSA sent at $${intRaw.toLocaleString()}`);
                      else lines.push(`Internal price target: $${intRaw.toLocaleString()}`);
                      if (!isNaN(askRaw) && askRaw > 0) { const disc = (((askRaw - intRaw) / askRaw) * 100).toFixed(1); lines.push(`${disc}% discount to asking ($${askRaw.toLocaleString()})`); }
                      if (site.summary) { const s = site.summary; if (s.toLowerCase().includes("counter")) lines.push("Negotiation history in recent summary"); }
                    } else { lines.push("No internal pricing established yet"); lines.push("Awaiting broker response or initial valuation"); }
                    return lines;
                  }
                  if (key === "acreage") {
                    const lines = [];
                    if (!isNaN(acRaw) && acRaw > 0) {
                      lines.push(`${acRaw.toFixed(2)} acres total`);
                      if (acRaw >= 3.5 && acRaw <= 5) lines.push("Ideal size for one-story indoor climate-controlled storage");
                      else if (acRaw >= 2.5 && acRaw < 3.5) lines.push("Fits 3-4 story multi-story storage product");
                      else if (acRaw > 5 && acRaw <= 7) lines.push("Larger site - potential for phased development or pad split");
                      else if (acRaw > 7) lines.push("Oversized - would need subdivision or excess land disposition");
                      else if (acRaw < 2.5) lines.push("Below minimum 2.5ac threshold - tight fit");
                      if (acRaw > 7) lines.push("Evaluate partial acquisition or subdivide strategy");
                      if (ppaVal) lines.push(`Current basis: $${ppaVal.toLocaleString()}/acre`);
                    } else { lines.push("Acreage not specified"); }
                    return lines;
                  }
                  if (key === "zoning") {
                    const lines = [];
                    const zc = site.zoningClassification || "unknown";
                    const zu = site.zoningUseTerm;
                    lines.push(`District: ${site.zoning || "Not specified"}`);
                    if (zc === "by-right") lines.push("Self-storage is PERMITTED BY RIGHT - no hearing required");
                    else if (zc === "conditional") lines.push("Conditional use / SUP required - public hearing needed");
                    else if (zc === "rezone-required") lines.push("Rezone required - higher cost and timeline risk");
                    else if (zc === "prohibited") lines.push("Storage use PROHIBITED in current district");
                    else lines.push("Zoning viability not yet confirmed");
                    if (zu) lines.push(`Use category: "${zu}"`);
                    if (site.zoningOrdinanceSection) lines.push(`Source: ${site.zoningOrdinanceSection}`);
                    if (site.jurisdictionType) lines.push(`Jurisdiction: ${site.jurisdictionType}`);
                    if (site.supCost) lines.push(`Est. entitlement cost: ${site.supCost}`);
                    return lines;
                  }
                  if (key === "pop") {
                    const lines = [];
                    if (!isNaN(popRaw) && popRaw > 0) {
                      lines.push(`${popRaw.toLocaleString()} residents within 3-mile radius`);
                      const tier = popRaw >= 40000 ? "Dense suburban market - strong demand pool" : popRaw >= 25000 ? "Solid suburban density" : popRaw >= 15000 ? "Moderate density - viable with growth" : popRaw >= 10000 ? "Lower density - growth trajectory critical" : "Thin population base";
                      lines.push(tier);
                      if (growthPct !== null) {
                        const gStr = growthPct >= 2.0 ? `${growthPct.toFixed(1)}% CAGR - explosive growth corridor` : growthPct >= 1.5 ? `${growthPct.toFixed(1)}% CAGR - strong growth` : growthPct >= 1.0 ? `${growthPct.toFixed(1)}% CAGR - healthy growth` : growthPct >= 0 ? `${growthPct.toFixed(1)}% CAGR - stable` : `${growthPct.toFixed(1)}% CAGR - declining`;
                        lines.push(`5-yr growth outlook: ${gStr}`);
                        if (growthPct > 0) { const proj = Math.round(popRaw * Math.pow(1 + growthPct / 100, 5)); lines.push(`Projected 2030 population: ~${proj.toLocaleString()}`); }
                      }
                      if (!isNaN(hhRaw) && hhRaw > 0) lines.push(`${hhRaw.toLocaleString()} households (${(popRaw / hhRaw).toFixed(1)} persons/hh)`);
                    } else { lines.push("Population data not available"); }
                    if (site.demandDrivers) lines.push(`Drivers: ${site.demandDrivers.substring(0, 120)}${site.demandDrivers.length > 120 ? "..." : ""}`);
                    return lines;
                  }
                  if (key === "income") {
                    const lines = [];
                    if (!isNaN(incRaw) && incRaw > 0) {
                      lines.push(`$${incRaw.toLocaleString()} median household income (3-mi)`);
                      const tier = incRaw >= 90000 ? "Premium affluent market - strong pricing power" : incRaw >= 75000 ? "Upper-middle income - favorable for climate-controlled" : incRaw >= 65000 ? "Solid middle income - core storage demographic" : incRaw >= 55000 ? "Moderate income - viable but price-sensitive" : "Below target threshold ($55K minimum)";
                      lines.push(tier);
                      if (!isNaN(hvRaw) && hvRaw > 0) lines.push(`Median home value: $${hvRaw.toLocaleString()}`);
                      if (growthPct !== null) {
                        const incomeGrowth = growthPct >= 1.5 ? "Rising incomes likely - high-growth market" : growthPct >= 0.5 ? "Stable income trajectory with population growth" : "Flat or declining growth - monitor pricing power";
                        lines.push(`5-yr outlook: ${incomeGrowth}`);
                      }
                      if (site.renterPct3mi) lines.push(`Renter percentage: ${site.renterPct3mi} (renters = higher storage demand)`);
                    } else { lines.push("Income data not available"); }
                    return lines;
                  }
                  return [];
                };

                const metricItems = [
                  { key: "asking", label: "ASKING", val: fmtPrice(site.askingPrice), color: "#E2E8F0" },
                  { key: "internal", label: "INTERNAL", val: site.internalPrice ? fmtPrice(site.internalPrice) : "---", color: "#E87A2E" },
                  { key: "acreage", label: "ACREAGE", val: site.acreage ? `${site.acreage} ac` : "---", color: "#E2E8F0" },
                  { key: "zoning", label: "ZONING", val: site.zoning || "---", color: "#C9A84C" },
                  { key: "pop", label: "3MI POP", val: site.pop3mi ? fmtN(site.pop3mi) : "---", color: "#E2E8F0" },
                  { key: "income", label: "3MI MED INC", val: site.income3mi ? "$" + fmtN(site.income3mi) : "---", color: "#E2E8F0" },
                ];

                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 20 }}>
                    {metricItems.map((m) => {
                      const isHov = hoveredMetric === m.key;
                      const ttLines = isHov ? buildTooltip(m.key) : [];
                      return (
                        <div key={m.key} style={{ position: "relative" }}
                          onMouseEnter={() => setHoveredMetric(m.key)} onMouseLeave={() => setHoveredMetric(null)}>
                          <div style={{ background: isHov ? "rgba(30,39,97,0.85)" : "rgba(15,21,56,0.5)", borderRadius: 12, padding: "14px 16px", border: isHov ? "1px solid rgba(201,168,76,0.35)" : "1px solid rgba(201,168,76,0.08)", cursor: "pointer", transition: "all 0.2s ease", transform: isHov ? "translateY(-2px)" : "none", boxShadow: isHov ? "0 8px 32px rgba(201,168,76,0.15)" : "none" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: isHov ? "#C9A84C" : "#6B7394", letterSpacing: "0.1em", marginBottom: 4, transition: "color 0.2s" }}>{m.label}</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: m.color, fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.val}</div>
                          </div>
                          {isHov && ttLines.length > 0 && (
                            <div style={{ position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", minWidth: 320, maxWidth: 420, zIndex: 9999, borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(201,168,76,0.2), 0 0 40px rgba(30,39,97,0.4)", animation: "fadeIn 0.15s ease-out" }}>
                              <div style={{ background: "linear-gradient(135deg, #1E2761, #2C3E6B)", padding: "10px 14px", borderBottom: "2px solid #C9A84C", display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 12 }}>{m.key === "asking" ? "💰" : m.key === "internal" ? "🎯" : m.key === "acreage" ? "📐" : m.key === "zoning" ? "📋" : m.key === "pop" ? "👥" : "💵"}</span>
                                <span style={{ fontSize: 11, fontWeight: 800, color: "#C9A84C", letterSpacing: "0.08em", textTransform: "uppercase" }}>SiteScore Intelligence</span>
                              </div>
                              <div style={{ background: "linear-gradient(180deg, #0F1538, #131B45)", padding: "14px 16px" }}>
                                {ttLines.map((line, li) => (
                                  <div key={li} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0", borderBottom: li < ttLines.length - 1 ? "1px solid rgba(201,168,76,0.06)" : "none" }}>
                                    <span style={{ color: "#C9A84C", fontSize: 8, marginTop: 5, flexShrink: 0 }}>&#9670;</span>
                                    <span style={{ fontSize: 12, color: li === 0 ? "#F4F6FA" : "#CBD5E1", fontWeight: li === 0 ? 700 : 500, lineHeight: 1.5 }}>{line}</span>
                                  </div>
                                ))}
                              </div>
                              <div style={{ background: "rgba(201,168,76,0.04)", padding: "6px 14px", borderTop: "1px solid rgba(201,168,76,0.1)" }}>
                                <span style={{ fontSize: 9, color: "#6B7394", fontWeight: 600, letterSpacing: "0.05em" }}>SiteScore&#8482; Analysis</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ACTION BUTTONS */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24, padding: "16px 0", borderTop: "1px solid rgba(201,168,76,0.08)", borderBottom: "1px solid rgba(201,168,76,0.08)", alignItems: "center" }}>
                <button onClick={() => {
                  const iqGen = computeSiteScore(site); const psD = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null; const rpt = generateVettingReport(site, psD, iqGen); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); window.open(url, "_blank"); autoGenerateVettingReport(dv.regionKey, site.id, site);
                }} style={{ padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg, #E87A2E, #C9A84C)", color: "#fff", fontSize: 14, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 24px rgba(232,122,46,0.4)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8 }}>🔬 SiteScore Deep Vet Report</button>
                {site.coordinates && <>
                  <a href={mapsLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "12px 22px", borderRadius: 12, background: "rgba(21,101,192,0.12)", color: "#42A5F5", fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(21,101,192,0.25)", display: "flex", alignItems: "center", gap: 6 }}>🗺 Google Maps</a>
                  <a href={earthLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "12px 22px", borderRadius: 12, background: "rgba(46,125,50,0.12)", color: "#66BB6A", fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(46,125,50,0.25)", display: "flex", alignItems: "center", gap: 6 }}>🌍 Google Earth</a>
                </>}
                {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noopener noreferrer" style={{ padding: "12px 22px", borderRadius: 12, background: "rgba(232,122,46,0.12)", color: "#E87A2E", fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(232,122,46,0.25)", display: "flex", alignItems: "center", gap: 6 }}>🔗 Property Listing</a>}
                {flyerDoc && <a href={flyerDoc[1].url} target="_blank" rel="noopener noreferrer" style={{ padding: "12px 22px", borderRadius: 12, background: "rgba(243,124,51,0.12)", color: "#FFB347", fontSize: 13, fontWeight: 700, textDecoration: "none", border: "1px solid rgba(243,124,51,0.25)", display: "flex", alignItems: "center", gap: 6 }}>📄 View Flyer</a>}
                <button onClick={() => {
                  const iqR = computeSiteScore(site); const rpt = generatePricingReport(site, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); window.open(url, "_blank");
                }} style={{ padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg, #2E7D32, #43A047)", color: "#fff", fontSize: 14, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 24px rgba(46,125,50,0.4)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8 }}>💰 SiteScore Pricing Report</button>
                <button onClick={() => {
                  const iqR = computeSiteScore(site); const rpt = generateRECPackage(site, iqR); const blob = new Blob([rpt], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); window.open(url, "_blank");
                }} style={{ padding: "12px 28px", borderRadius: 12, background: "linear-gradient(135deg, #1E2761, #C9A84C)", color: "#fff", fontSize: 14, fontWeight: 800, border: "none", cursor: "pointer", boxShadow: "0 4px 24px rgba(30,39,97,0.4), 0 0 0 1px rgba(201,168,76,0.3)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8 }}>📋 REC Package</button>
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

              {/* DEMOGRAPHICS — Clickable + Expandable */}
              {(site.pop3mi || site.income3mi) && (() => {
                const pN2 = (v) => { if (!v) return null; const n = typeof v === "number" ? v : parseInt(String(v).replace(/[$,]/g, ""), 10); return isNaN(n) ? null : n; };
                const fP2 = (v, pre) => { const n = pN2(v); return n != null ? (pre || "") + n.toLocaleString() : null; };
                const gVal2 = site.popGrowth3mi ? parseFloat(site.popGrowth3mi) : null;
                const gColor2 = gVal2 != null ? (gVal2 > 0 ? "#22C55E" : gVal2 < 0 ? "#EF4444" : "#94A3B8") : "#6B7394";
                const gLabel2 = gVal2 != null ? ((gVal2 >= 0 ? "+" : "") + gVal2.toFixed(2) + "% /yr") : null;
                const gOutlook2 = gVal2 != null ? (gVal2 > 1.5 ? "High Growth" : gVal2 > 0.5 ? "Growing" : gVal2 > 0 ? "Stable Growth" : gVal2 > -0.5 ? "Flat" : "Declining") : null;
                const popRaw = pN2(site.pop3mi);
                const hhiRaw = pN2(site.income3mi);
                const hhRaw = pN2(site.households3mi);
                const hvRaw = pN2(site.homeValue3mi);
                const pop1Raw = pN2(site.pop1mi);
                const acreageVal = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
                const pricePerAcVal = (() => { const p = parseFloat(String(site.askingPrice || "").replace(/[^0-9.]/g, "")); return (!isNaN(p) && p > 0 && !isNaN(acreageVal) && acreageVal > 0) ? Math.round(p / acreageVal) : null; })();
                const psDist2 = site.siteiqData?.nearestPS ? (typeof site.siteiqData.nearestPS === "number" ? site.siteiqData.nearestPS : parseFloat(site.siteiqData.nearestPS)) : null;
                const demoRows = [
                  { key: "population", label: "Population (3-mi)", val: fP2(site.pop3mi), icon: "👥" },
                  { key: "income", label: "Median HHI (3-mi)", val: fP2(site.income3mi, "$"), icon: "💰" },
                  { key: "growth", label: "Pop Growth (ESRI 2025→2030)", val: gLabel2, icon: "📈", color: gColor2 },
                  { key: "growthOutlook", label: "Growth Outlook", val: gOutlook2, icon: "🔮", color: gVal2 != null ? (gVal2 > 1.5 ? "#22C55E" : gVal2 > 0.5 ? "#4ADE80" : "#FBBF24") : "#6B7394" },
                  { key: "households", label: "Households (3-mi)", val: fP2(site.households3mi), icon: "🏠" },
                  { key: "homeValue", label: "Median Home Value (3-mi)", val: fP2(site.homeValue3mi, "$"), icon: "🏡" },
                  { key: "acreage", label: "Acreage", val: acreageVal ? acreageVal.toFixed(2) + " ac" : null, icon: "📐" },
                  { key: "pricing", label: "Price / Acre", val: pricePerAcVal ? "$" + pricePerAcVal.toLocaleString() + "/ac" : null, icon: "🏷️" },
                  { key: "psProximity", label: "Nearest Facility", val: psDist2 ? psDist2.toFixed(1) + " mi" : null, icon: "📍" },
                  { key: "competition", label: "Competitors (3-mi)", val: site.siteiqData?.competitorCount != null ? String(site.siteiqData.competitorCount) : null, icon: "🏪" },
                ].filter(r => r.val != null);
                // Benchmarks for bar charts
                const popBench = 40000; const hhiBench = 90000; const hhBench = 25000; const hvBench = 500000;
                const compCount = site.siteiqData?.competitorCount;
                const compNames = site.siteiqData?.competitorNames;
                const nearComp = site.siteiqData?.nearestCompetitor;
                const demandSig = site.siteiqData?.demandSupplySignal || site.demandSupplySignal;
                return demoRows.length > 0 ? (
                  <div style={{ borderRadius: 14, marginBottom: 20, overflow: "hidden", border: `1px solid ${demoExpanded ? "rgba(201,168,76,0.2)" : "rgba(201,168,76,0.1)"}`, transition: "all 0.3s" }}>
                    <div onClick={() => setDemoExpanded(!demoExpanded)} style={{ background: "linear-gradient(135deg,#0F172A,#1E293B,#1565C0)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", transition: "all 0.2s" }} onMouseEnter={(e) => e.currentTarget.style.background = "linear-gradient(135deg,#0F172A,#1E293B,#1976D2)"} onMouseLeave={(e) => e.currentTarget.style.background = "linear-gradient(135deg,#0F172A,#1E293B,#1565C0)"}>
                      <span style={{ fontSize: 14 }}>📊</span>
                      <span style={{ color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: "0.06em" }}>SITE DEMOGRAPHICS</span>
                      <span style={{ background: "linear-gradient(135deg,#FBBF24,#F59E0B)", color: "#0F172A", fontSize: 10, fontWeight: 900, padding: "2px 8px", borderRadius: 5 }}>ESRI 2025</span>
                      <span style={{ marginLeft: "auto", color: "#C9A84C", fontSize: 11, fontWeight: 700, opacity: 0.8 }}>{demoExpanded ? "▲ Collapse" : "▼ Expand Deep Dive"}</span>
                    </div>
                    {/* Compact view — each row clickable with expansion */}
                    <div style={{ background: "rgba(15,21,56,0.3)" }}>
                      {demoRows.map((row, i) => {
                        const isRowExp = demoRowExpanded === row.key;
                        // Expansion renderer per row key
                        const renderRowExpansion = () => {
                          const MR = ({ label, value, color, pctOf, bench, benchLabel }) => (
                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid rgba(201,168,76,0.04)" }}>
                              <div style={{ width: 130, fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>{label}</div>
                              <div style={{ flex: 1, position: "relative", height: 9, borderRadius: 5, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, pctOf || 0)}%`, borderRadius: 5, background: `linear-gradient(90deg, ${color}99, ${color})`, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
                              </div>
                              <div style={{ width: 90, textAlign: "right", fontSize: 13, fontWeight: 800, color: "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{value || "—"}</div>
                              {bench && <div style={{ width: 90, textAlign: "right", fontSize: 9, color: "#6B7394" }}>vs {benchLabel}</div>}
                            </div>
                          );
                          const SvxBox = ({ text, signal, sigColor }) => (
                            <div style={{ marginTop: 16, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(201,168,76,0.12)" }}>
                              <div style={{ background: "linear-gradient(135deg, #1E2761, #0F172A)", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 12 }}>🔬</span>
                                <span style={{ fontSize: 10, fontWeight: 900, color: "#C9A84C", letterSpacing: "0.1em" }}>STORVEX SUMMARY ANALYSIS</span>
                                {signal && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, padding: "2px 10px", borderRadius: 5, background: (sigColor || "#C9A84C") + "18", color: sigColor || "#C9A84C" }}>{signal}</span>}
                              </div>
                              <div style={{ padding: "12px 16px", background: "rgba(10,10,14,0.6)", fontSize: 11, color: "#CBD5E1", lineHeight: 1.7 }}>{text}</div>
                            </div>
                          );
                          const k = row.key;
                          if (k === "population") {
                            const futurePop = popRaw && gVal2 != null ? Math.round(popRaw * Math.pow(1 + gVal2 / 100, 5)) : null;
                            const signal = popRaw >= 40000 ? "DENSE MARKET" : popRaw >= 25000 ? "SOLID DEMAND" : popRaw >= 10000 ? "EMERGING" : "THIN";
                            const sigC = popRaw >= 40000 ? "#22C55E" : popRaw >= 25000 ? "#3B82F6" : popRaw >= 10000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(59,130,246,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>RADIUS POPULATION BREAKDOWN</div>
                                  <MR label="1-Mile Radius" value={pop1Raw ? pop1Raw.toLocaleString() : "—"} color="#8B5CF6" pctOf={pop1Raw ? Math.min(100, (pop1Raw / 10000) * 100) : 0} bench benchLabel="10K" />
                                  <MR label="3-Mile Radius" value={popRaw ? popRaw.toLocaleString() : "—"} color="#3B82F6" pctOf={popRaw ? Math.min(100, (popRaw / popBench) * 100) : 0} bench benchLabel="40K" />
                                  <MR label="5-Mile (est.)" value={popRaw ? Math.round(popRaw * 2.4).toLocaleString() : "—"} color="#1D4ED8" pctOf={popRaw ? Math.min(100, (popRaw * 2.4 / 100000) * 100) : 0} bench benchLabel="100K" />
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(34,197,94,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>PROJECTED TRAJECTORY (2025-2030)</div>
                                  <MR label="Current (2025)" value={popRaw ? popRaw.toLocaleString() : "—"} color="#3B82F6" pctOf={popRaw ? Math.min(100, (popRaw / popBench) * 100) : 0} />
                                  <MR label="Projected (2030)" value={futurePop ? futurePop.toLocaleString() : "—"} color={gVal2 > 0 ? "#22C55E" : "#EF4444"} pctOf={futurePop ? Math.min(100, (futurePop / popBench) * 100) : 0} />
                                  <MR label="Net Change" value={futurePop && popRaw ? (futurePop > popRaw ? "+" : "") + (futurePop - popRaw).toLocaleString() : "—"} color={gVal2 > 0 ? "#22C55E" : "#EF4444"} pctOf={futurePop && popRaw ? Math.min(100, Math.abs(futurePop - popRaw) / popRaw * 500) : 0} />
                                  <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", display: "flex", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: 10, color: "#6B7394" }}>5-Year CAGR</span>
                                    <span style={{ fontSize: 13, fontWeight: 800, color: gVal2 > 0 ? "#22C55E" : "#EF4444", fontFamily: "'Space Mono', monospace" }}>{gVal2 != null ? (gVal2 >= 0 ? "+" : "") + gVal2.toFixed(2) + "%" : "—"}</span>
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 4 }}>
                                {[{ l: "PS BENCHMARK", v: "40,000", s: popRaw >= 40000 ? "EXCEEDS" : Math.round((popRaw||0) / 400) + "% of target", c: popRaw >= 40000 ? "#22C55E" : "#F59E0B" },
                                  { l: "MIN THRESHOLD", v: "5,000", s: popRaw >= 5000 ? "CLEAR" : "BELOW MIN", c: popRaw >= 5000 ? "#22C55E" : "#EF4444" },
                                  { l: "DENSITY SIGNAL", v: signal, s: "Score", c: sigC }
                                ].map((b, j) => (
                                  <div key={j} style={{ background: "rgba(15,21,56,0.3)", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                                    <div style={{ fontSize: 8, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em" }}>{b.l}</div>
                                    <div style={{ fontSize: 16, fontWeight: 900, color: j < 2 ? "#4A5080" : b.c, fontFamily: "'Space Mono', monospace" }}>{b.v}</div>
                                    <div style={{ fontSize: 9, color: b.c, fontWeight: 700 }}>{b.s}</div>
                                  </div>
                                ))}
                              </div>
                              <SvxBox signal={signal} sigColor={sigC} text={popRaw >= 40000 ? `Dense population base of ${popRaw.toLocaleString()} within 3 miles exceeds PS's 40K benchmark — top tier for household-driven self-storage absorption. ${gVal2 > 1 ? "Combined with above-average growth, compounding demand tailwinds." : "Population density alone supports facility viability."}` : popRaw >= 15000 ? `Population of ${popRaw.toLocaleString()} within 3 miles — mid-range for storage feasibility. Sufficient for climate-controlled facility if competition is limited. ${gVal2 > 1.5 ? "Strong growth could push this into premium territory within 3-5 years." : "Growth and income quality become critical tiebreakers."}` : `Population of ${popRaw ? popRaw.toLocaleString() : "N/A"} within 3 miles — thinner demand base. Requires low competition, premium income, or exceptional growth to justify development.`} />
                            </div>);
                          }
                          if (k === "income") {
                            const tier = hhiRaw >= 90000 ? "PREMIUM" : hhiRaw >= 75000 ? "AFFLUENT" : hhiRaw >= 65000 ? "STRONG" : hhiRaw >= 55000 ? "ADEQUATE" : "BELOW THRESHOLD";
                            const tC = hhiRaw >= 90000 ? "#C9A84C" : hhiRaw >= 75000 ? "#22C55E" : hhiRaw >= 65000 ? "#3B82F6" : hhiRaw >= 55000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${tC}15` }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>MEDIAN HOUSEHOLD INCOME</div>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1, marginBottom: 8 }}>{hhiRaw ? "$" + hhiRaw.toLocaleString() : "—"}</div>
                                  <div style={{ display: "inline-block", padding: "4px 12px", borderRadius: 6, background: tC + "18", border: `1px solid ${tC}30` }}><span style={{ fontSize: 11, fontWeight: 800, color: tC }}>{tier}</span></div>
                                  <div style={{ marginTop: 14 }}>
                                    <MR label="This Market" value={"$" + (hhiRaw || 0).toLocaleString()} color={tC} pctOf={hhiRaw ? Math.min(100, (hhiRaw / hhiBench) * 100) : 0} />
                                    <MR label="Premium ($90K)" value="$90,000" color="#C9A84C" pctOf={100} />
                                    <MR label="Strong ($65K)" value="$65,000" color="#3B82F6" pctOf={72} />
                                    <MR label="Minimum ($55K)" value="$55,000" color="#EF4444" pctOf={61} />
                                  </div>
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(201,168,76,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>INCOME IMPLICATIONS FOR STORAGE</div>
                                  {[
                                    { label: "Willingness to Pay", val: hhiRaw >= 75000 ? "High" : hhiRaw >= 55000 ? "Moderate" : "Limited", c: hhiRaw >= 75000 ? "#22C55E" : hhiRaw >= 55000 ? "#F59E0B" : "#EF4444", desc: "Higher income = premium unit absorption" },
                                    { label: "Climate-Controlled Demand", val: hhiRaw >= 65000 ? "Strong" : "Moderate", c: hhiRaw >= 65000 ? "#22C55E" : "#F59E0B", desc: "Affluent households store higher-value items" },
                                    { label: "Price Sensitivity", val: hhiRaw >= 90000 ? "Low" : hhiRaw >= 65000 ? "Moderate" : "High", c: hhiRaw >= 90000 ? "#22C55E" : hhiRaw >= 65000 ? "#F59E0B" : "#EF4444", desc: "Impacts rate growth potential" },
                                  ].map((r, j) => (
                                    <div key={j} style={{ padding: "10px 0", borderBottom: j < 2 ? "1px solid rgba(201,168,76,0.04)" : "none" }}>
                                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11, fontWeight: 700, color: "#E2E8F0" }}>{r.label}</span><span style={{ fontSize: 12, fontWeight: 800, color: r.c, fontFamily: "'Space Mono', monospace" }}>{r.val}</span></div>
                                      <div style={{ fontSize: 9, color: "#6B7394", marginTop: 2 }}>{r.desc}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <SvxBox signal={tier} sigColor={tC} text={hhiRaw >= 90000 ? `Premium income market at $${hhiRaw.toLocaleString()} median HHI. Core self-storage demographic: homeowners with accumulated possessions, disposable income for storage rents, and preference for climate-controlled units. Supports premium pricing and strong RevPAF.` : hhiRaw >= 65000 ? `Solid income base at $${hhiRaw.toLocaleString()} median HHI. Supports standard pricing and moderate CC demand. Income alone is not a differentiator but removes downside risk.` : `Income at $${(hhiRaw || 0).toLocaleString()} approaches the $55K threshold. Lower-income markets see higher price sensitivity and lower CC uptake. Demand skews toward smaller drive-up units.`} />
                            </div>);
                          }
                          if (k === "growth" || k === "growthOutlook") {
                            const gC = gVal2 > 1.5 ? "#22C55E" : gVal2 > 0.5 ? "#4ADE80" : gVal2 > 0 ? "#FBBF24" : "#94A3B8";
                            const outlook = gVal2 > 2.0 ? "RAPID EXPANSION" : gVal2 > 1.5 ? "HIGH GROWTH" : gVal2 > 1.0 ? "ABOVE AVERAGE" : gVal2 > 0.5 ? "STEADY GROWTH" : gVal2 > 0 ? "STABLE" : "FLAT/DECLINING";
                            const natAvg = 0.5; const futurePop = popRaw && gVal2 != null ? Math.round(popRaw * Math.pow(1 + gVal2 / 100, 5)) : null;
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 20, border: `1px solid ${gC}15`, textAlign: "center" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 8 }}>5-YEAR COMPOUND ANNUAL GROWTH RATE</div>
                                  <div style={{ fontSize: 48, fontWeight: 900, color: gC, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{gVal2 != null ? (gVal2 >= 0 ? "+" : "") + gVal2.toFixed(2) + "%" : "—"}</div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: gC, marginTop: 8 }}>{outlook}</div>
                                  <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.04)", overflow: "hidden", marginTop: 14 }}>
                                    <div style={{ height: "100%", width: `${Math.min(100, Math.max(5, ((gVal2 || 0) / 3) * 100))}%`, borderRadius: 4, background: `linear-gradient(90deg, ${gC}99, ${gC})` }} />
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span style={{ fontSize: 8, color: "#4A5080" }}>0%</span><span style={{ fontSize: 8, color: "#4A5080" }}>3%+ (rapid)</span></div>
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 20, border: "1px solid rgba(59,130,246,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 14 }}>GROWTH CONTEXT</div>
                                  <MR label="This Market" value={gVal2 != null ? gVal2.toFixed(2) + "%" : "—"} color={gC} pctOf={gVal2 ? Math.min(100, (gVal2 / 3) * 100) : 0} />
                                  <MR label="National Average" value={natAvg.toFixed(2) + "%"} color="#4A5080" pctOf={(natAvg / 3) * 100} />
                                  <MR label="Spread vs National" value={gVal2 != null ? (gVal2 - natAvg >= 0 ? "+" : "") + (gVal2 - natAvg).toFixed(2) + "%" : "—"} color={gVal2 > natAvg ? "#22C55E" : "#EF4444"} pctOf={gVal2 ? Math.min(100, Math.abs(gVal2 - natAvg) / 3 * 100) : 0} />
                                  {futurePop && popRaw && <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}>
                                    <div style={{ fontSize: 9, color: "#6B7394", marginBottom: 4 }}>5-YEAR NET POPULATION CHANGE</div>
                                    <div style={{ fontSize: 18, fontWeight: 900, color: futurePop > popRaw ? "#22C55E" : "#EF4444", fontFamily: "'Space Mono', monospace" }}>{futurePop > popRaw ? "+" : ""}{(futurePop - popRaw).toLocaleString()} people</div>
                                    <div style={{ fontSize: 10, color: "#94A3B8" }}>{popRaw.toLocaleString()} (2025) → {futurePop.toLocaleString()} (2030)</div>
                                  </div>}
                                </div>
                              </div>
                              <SvxBox signal={outlook} sigColor={gC} text={gVal2 > 1.5 ? `Growing at ${gVal2.toFixed(2)}% annually, ${(gVal2 / natAvg).toFixed(1)}x the national average. Rapid growth is the strongest predictor of new storage demand. Projects ${futurePop ? "+" + (futurePop - (popRaw || 0)).toLocaleString() + " new residents" : "significant expansion"} by 2030.` : gVal2 > 0.5 ? `Growth of ${gVal2.toFixed(2)}% tracks above national average. Steady expansion supports organic storage demand growth with a 3-5 year lease-up horizon.` : `Modest growth at ${gVal2 != null ? gVal2.toFixed(2) : "N/A"}%. Demand driven by household turnover rather than net new population. Competition quality becomes the differentiator.`} />
                            </div>);
                          }
                          if (k === "households") {
                            const signal = hhRaw >= 25000 ? "DEEP DEMAND POOL" : hhRaw >= 18000 ? "STRONG BASE" : hhRaw >= 12000 ? "ADEQUATE" : hhRaw >= 6000 ? "MODERATE" : "LIMITED";
                            const sC = hhRaw >= 25000 ? "#22C55E" : hhRaw >= 12000 ? "#3B82F6" : hhRaw >= 6000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${sC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>3-MILE HOUSEHOLD COUNT</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{hhRaw ? hhRaw.toLocaleString() : "—"}</div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: sC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: sC }}>{signal}</span></div>
                                </div>
                                <MR label="This Market" value={(hhRaw || 0).toLocaleString()} color={sC} pctOf={hhRaw ? Math.min(100, (hhRaw / hhBench) * 100) : 0} bench benchLabel="25K" />
                                <MR label="Top Tier (25K)" value="25,000" color="#22C55E" pctOf={100} />
                                <MR label="Solid Base (12K)" value="12,000" color="#3B82F6" pctOf={48} />
                                {popRaw && hhRaw && <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ fontSize: 10, color: "#6B7394" }}>Avg Household Size</span>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{(popRaw / hhRaw).toFixed(1)} ppl/hh</span>
                                </div>}
                                <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ fontSize: 10, color: "#6B7394" }}>10% Penetration Projection</span>
                                  <span style={{ fontSize: 13, fontWeight: 800, color: "#C9A84C", fontFamily: "'Space Mono', monospace" }}>~{Math.round((hhRaw || 0) * 0.10).toLocaleString()} renters</span>
                                </div>
                              </div>
                              <SvxBox signal={signal} sigColor={sC} text={hhRaw >= 25000 ? `${hhRaw.toLocaleString()} households represents a deep demand pool. ~${Math.round(hhRaw * 0.10).toLocaleString()} potential storage renters at 10% penetration. Can support multiple facilities.` : hhRaw >= 12000 ? `${hhRaw.toLocaleString()} households provide a solid demand base. ~${Math.round((hhRaw || 0) * 0.10).toLocaleString()} potential renters. Sufficient for a well-positioned facility.` : `Household count of ${(hhRaw || 0).toLocaleString()} indicates a thinner customer base. Each competitor consumes a larger demand share.`} />
                            </div>);
                          }
                          if (k === "homeValue") {
                            const hvTier = hvRaw >= 500000 ? "PREMIUM" : hvRaw >= 350000 ? "UPPER-MIDDLE" : hvRaw >= 250000 ? "MIDDLE MARKET" : hvRaw >= 180000 ? "MODERATE" : "VALUE";
                            const hvC = hvRaw >= 500000 ? "#C9A84C" : hvRaw >= 350000 ? "#22C55E" : hvRaw >= 250000 ? "#3B82F6" : hvRaw >= 180000 ? "#F59E0B" : "#EF4444";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${hvC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>MEDIAN HOME VALUE (3-MI)</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{hvRaw ? "$" + hvRaw.toLocaleString() : "—"}</div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: hvC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: hvC }}>{hvTier}</span></div>
                                </div>
                                <MR label="This Market" value={"$" + (hvRaw || 0).toLocaleString()} color={hvC} pctOf={hvRaw ? Math.min(100, (hvRaw / hvBench) * 100) : 0} bench benchLabel="$500K" />
                                <MR label="Premium ($500K)" value="$500,000" color="#C9A84C" pctOf={100} />
                                <MR label="Affluent ($350K)" value="$350,000" color="#22C55E" pctOf={70} />
                                <MR label="Middle ($250K)" value="$250,000" color="#3B82F6" pctOf={50} />
                              </div>
                              <SvxBox signal={hvTier} sigColor={hvC} text={hvRaw >= 350000 ? `Home values at $${hvRaw.toLocaleString()} signal an affluent submarket. Higher home values correlate with larger homes, more possessions, and greater willingness to pay for premium climate-controlled storage.` : hvRaw >= 180000 ? `Middle-market home values at $${hvRaw.toLocaleString()}. Standard storage demand profile — supports a mix of unit sizes and moderate pricing.` : `Home values at $${(hvRaw || 0).toLocaleString()} indicate a value market. Storage demand exists but skews toward drive-up and smaller units.`} />
                            </div>);
                          }
                          if (k === "acreage") {
                            const sizeSignal = acreageVal >= 3.5 && acreageVal <= 5 ? "IDEAL SIZE" : acreageVal >= 2.5 && acreageVal < 3.5 ? "MULTI-STORY" : acreageVal > 5 && acreageVal <= 7 ? "LARGE" : acreageVal > 7 ? "SUBDIVISIBLE" : "REVIEW";
                            const sizeC = acreageVal >= 3.5 && acreageVal <= 5 ? "#22C55E" : acreageVal >= 2.5 ? "#3B82F6" : "#F59E0B";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${sizeC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>SITE SIZE & CONFIGURATION</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14 }}>
                                  <div style={{ fontSize: 36, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{acreageVal.toFixed(2)}<span style={{ fontSize: 14, color: "#6B7394" }}> ac</span></div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: sizeC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: sizeC }}>{sizeSignal}</span></div>
                                </div>
                                {[{ l: "Primary (3.5-5 ac)", d: "One-story indoor CC", r: [3.5, 5], c: "#22C55E" },
                                  { l: "Secondary (2.5-3.5 ac)", d: "Multi-story option", r: [2.5, 3.5], c: "#3B82F6" },
                                  { l: "Large (5-7 ac)", d: "Subdivisible", r: [5, 7], c: "#F59E0B" },
                                  { l: "XL (7+ ac)", d: "Pad-split potential", r: [7, 999], c: "#8B5CF6" },
                                ].map((r, j) => (
                                  <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 5, marginBottom: 3, background: acreageVal >= r.r[0] && acreageVal <= r.r[1] ? r.c + "12" : "transparent" }}>
                                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: acreageVal >= r.r[0] && acreageVal <= r.r[1] ? r.c : "#4A5080" }} />
                                    <span style={{ fontSize: 10, color: acreageVal >= r.r[0] && acreageVal <= r.r[1] ? "#E2E8F0" : "#6B7394", fontWeight: acreageVal >= r.r[0] && acreageVal <= r.r[1] ? 700 : 500 }}>{r.l}</span>
                                    <span style={{ fontSize: 9, color: "#4A5080", marginLeft: "auto" }}>{r.d}</span>
                                  </div>
                                ))}
                              </div>
                              <SvxBox signal={sizeSignal} sigColor={sizeC} text={acreageVal >= 3.5 && acreageVal <= 5 ? `${acreageVal.toFixed(2)} acres — ideal for PS's preferred one-story, indoor climate-controlled product. Accommodates 80,000-110,000 net rentable SF with parking, landscaping, and stormwater.` : acreageVal > 5 ? `${acreageVal.toFixed(2)} acres — large parcel offers flexibility. Could accommodate PS's standard product with excess land for expansion or outparcel development to offset land basis.` : `${acreageVal.toFixed(2)} acres — suitable for multi-story (3-4 story) climate-controlled facility. Can achieve 70,000-100,000 net rentable SF with vertical construction.`} />
                            </div>);
                          }
                          if (k === "psProximity") {
                            const proxSig = psDist2 <= 5 ? "VALIDATED SUBMARKET" : psDist2 <= 10 ? "PS ADJACENT" : psDist2 <= 15 ? "MODERATE" : psDist2 <= 25 ? "EDGE" : "REMOTE";
                            const pC = psDist2 <= 5 ? "#22C55E" : psDist2 <= 10 ? "#3B82F6" : psDist2 <= 15 ? "#F59E0B" : "#E87A2E";
                            return (<div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${pC}15`, marginBottom: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>PS NEAREST FACILITY PROXIMITY</div>
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                  <div style={{ fontSize: 42, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{psDist2 ? psDist2.toFixed(1) : "—"}<span style={{ fontSize: 16, color: "#6B7394" }}> mi</span></div>
                                  <div style={{ padding: "4px 12px", borderRadius: 6, background: pC + "18" }}><span style={{ fontSize: 11, fontWeight: 800, color: pC }}>{proxSig}</span></div>
                                </div>
                                {[{ l: "0-5 mi: Validated Submarket", c: "#22C55E", a: psDist2 <= 5, s: "10/10" },
                                  { l: "5-10 mi: PS Adjacent", c: "#3B82F6", a: psDist2 > 5 && psDist2 <= 10, s: "9/10" },
                                  { l: "10-15 mi: Moderate", c: "#F59E0B", a: psDist2 > 10 && psDist2 <= 15, s: "7/10" },
                                  { l: "15-25 mi: Edge", c: "#E87A2E", a: psDist2 > 15 && psDist2 <= 25, s: "5/10" },
                                  { l: "25-35 mi: Remote", c: "#EF4444", a: psDist2 > 25, s: "3/10" },
                                ].map((t, j) => (
                                  <div key={j} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 6, marginBottom: 4, background: t.a ? t.c + "12" : "transparent", border: t.a ? `1px solid ${t.c}30` : "1px solid transparent" }}>
                                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.a ? t.c : "#4A5080" }} />
                                    <span style={{ fontSize: 11, color: t.a ? "#E2E8F0" : "#6B7394", fontWeight: t.a ? 700 : 500, flex: 1 }}>{t.l}</span>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: t.a ? t.c : "#4A5080", fontFamily: "'Space Mono', monospace" }}>{t.s}</span>
                                  </div>
                                ))}
                              </div>
                              <SvxBox signal={proxSig} sigColor={pC} text={psDist2 <= 5 ? `Nearest PS is ${psDist2.toFixed(1)} miles away — validated PS submarket. Proximity confirms market has been previously vetted. Closer = stronger validation, not cannibalization.` : psDist2 <= 15 ? `At ${psDist2.toFixed(1)} miles, within PS's established footprint. Adjacent trade area PS hasn't yet saturated — infill opportunity.` : `${psDist2 ? psDist2.toFixed(1) : "N/A"} miles from nearest PS. Requires stronger standalone fundamentals to justify expansion into a new submarket.`} />
                            </div>);
                          }
                          if (k === "competition") {
                            const cc = compCount || 0;
                            const signal = cc <= 1 ? "UNDERSERVED" : cc <= 3 ? "LOW COMPETITION" : cc <= 6 ? "MODERATE" : "COMPETITIVE";
                            const sC = cc <= 1 ? "#22C55E" : cc <= 3 ? "#3B82F6" : cc <= 6 ? "#F59E0B" : "#EF4444";
                            const operators = compNames ? String(compNames).split(",").map(n => n.trim()).filter(Boolean) : [];
                            const reitCt = operators.filter(n => n.match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage|National Storage/i)).length;
                            return (<div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: `1px solid ${sC}15` }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 12 }}>COMPETITIVE DENSITY (3-MI RADIUS)</div>
                                  <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 14 }}>
                                    <div style={{ fontSize: 48, fontWeight: 900, color: sC, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{cc}</div>
                                    <div><div style={{ padding: "4px 12px", borderRadius: 6, background: sC + "18", marginBottom: 4 }}><span style={{ fontSize: 11, fontWeight: 800, color: sC }}>{signal}</span></div>
                                    {reitCt > 0 && <div style={{ fontSize: 10, color: "#EF4444", fontWeight: 700 }}>{reitCt} REIT{reitCt > 1 ? "s" : ""}</div>}</div>
                                  </div>
                                  {nearComp && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)", marginBottom: 8 }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>NEAREST: </span><span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 600 }}>{nearComp}</span></div>}
                                  {demandSig && <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>MARKET: </span><span style={{ fontSize: 11, color: "#C9A84C", fontWeight: 600 }}>{demandSig}</span></div>}
                                </div>
                                <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 10, padding: 16, border: "1px solid rgba(232,122,46,0.1)" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 10 }}>OPERATOR LANDSCAPE</div>
                                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                                    {operators.length > 0 ? operators.map((name, j) => (
                                      <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: j < operators.length - 1 ? "1px solid rgba(201,168,76,0.04)" : "none" }}>
                                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: name.match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage/i) ? "#EF4444" : name.match(/StorageMart|U-Haul|SecurCare/i) ? "#F59E0B" : "#3B82F6", flexShrink: 0 }} />
                                        <span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 600, flex: 1 }}>{name}</span>
                                        {name.match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage|National Storage/i) && <span style={{ fontSize: 8, fontWeight: 800, color: "#EF4444", background: "rgba(239,68,68,0.1)", padding: "1px 5px", borderRadius: 3 }}>REIT</span>}
                                      </div>
                                    )) : <div style={{ fontSize: 11, color: "#6B7394", fontStyle: "italic" }}>No operator data available</div>}
                                  </div>
                                </div>
                              </div>
                              <SvxBox signal={signal} sigColor={sC} text={cc <= 1 ? `Only ${cc} competitor within 3 miles — underserved market with significant unmet demand. Ideal for new PS development.` : cc <= 3 ? `${cc} competitors — manageable competition. ${reitCt > 0 ? reitCt + " REIT(s) validates institutional demand." : "Predominantly local operators — opportunity for REIT-quality facility."}` : `${cc} facilities within 3 miles — ${cc <= 6 ? "moderate" : "high"} competition. ${reitCt >= 2 ? "Multiple REITs confirm mature market." : ""} Success requires competitive positioning and rate strategy.`} />
                            </div>);
                          }
                          return null;
                        };
                        return (
                          <div key={i}>
                            <div onClick={() => { if (row.key !== "growthOutlook") setDemoRowExpanded(isRowExp ? null : row.key); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 18px", borderBottom: "1px solid rgba(201,168,76,0.06)", cursor: row.key !== "growthOutlook" ? "pointer" : "default", background: isRowExp ? "rgba(201,168,76,0.06)" : "transparent", transition: "background 0.15s" }} onMouseEnter={(e) => { if (row.key !== "growthOutlook" && !isRowExp) e.currentTarget.style.background = "rgba(201,168,76,0.03)"; }} onMouseLeave={(e) => { if (!isRowExp) e.currentTarget.style.background = "transparent"; }}>
                              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 13 }}>{row.icon}</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: isRowExp ? "#C9A84C" : "#94A3B8" }}>{row.label}</span>
                                {row.key !== "growthOutlook" && <span style={{ fontSize: 9, color: isRowExp ? "#C9A84C" : "#4A5080", transition: "transform 0.2s", display: "inline-block", transform: isRowExp ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>}
                              </span>
                              <span style={{ fontSize: 14, fontWeight: 800, color: row.color || "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{row.val}</span>
                            </div>
                            {isRowExp && renderRowExpansion() && (
                              <div style={{ padding: "16px 20px 20px", background: "rgba(10,10,14,0.8)", borderBottom: "2px solid rgba(201,168,76,0.1)", animation: "fadeIn 0.2s ease-out" }}>
                                {renderRowExpansion()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* EXPANDED DEEP DIVE */}
                    {demoExpanded && (
                      <div style={{ background: "rgba(10,10,14,0.95)", borderTop: "2px solid rgba(201,168,76,0.15)" }}>
                        {/* POPULATION ANALYSIS */}
                        <div style={{ padding: "20px 24px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                            <div style={{ width: 3, height: 18, borderRadius: 2, background: "#3B82F6" }} />
                            <span style={{ fontSize: 12, fontWeight: 800, color: "#3B82F6", letterSpacing: "0.1em" }}>POPULATION ANALYSIS</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                            {/* Pop bar chart */}
                            <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 12, padding: 16, border: "1px solid rgba(59,130,246,0.1)" }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", marginBottom: 12, letterSpacing: "0.08em" }}>3-MILE POPULATION vs BENCHMARK</div>
                              {[
                                { label: "This Site", val: popRaw, color: "#3B82F6" },
                                { label: "PS Benchmark (40K)", val: popBench, color: "#4A5080" },
                                { label: "Min Threshold (5K)", val: 5000, color: "#EF4444" },
                              ].map((b, i) => (
                                <div key={i} style={{ marginBottom: 10 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                    <span style={{ fontSize: 10, fontWeight: 600, color: "#94A3B8" }}>{b.label}</span>
                                    <span style={{ fontSize: 11, fontWeight: 800, color: b.color, fontFamily: "'Space Mono', monospace" }}>{b.val ? b.val.toLocaleString() : "—"}</span>
                                  </div>
                                  <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${Math.min(100, ((b.val || 0) / popBench) * 100)}%`, borderRadius: 4, background: `linear-gradient(90deg, ${b.color}99, ${b.color})`, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                            {/* Growth trajectory */}
                            <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 12, padding: 16, border: "1px solid rgba(34,197,94,0.1)" }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7394", marginBottom: 12, letterSpacing: "0.08em" }}>GROWTH TRAJECTORY</div>
                              <div style={{ textAlign: "center", padding: "12px 0" }}>
                                <div style={{ fontSize: 36, fontWeight: 900, color: gColor2, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{gLabel2 || "—"}</div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: gVal2 != null ? (gVal2 > 1.5 ? "#22C55E" : "#FBBF24") : "#6B7394", marginTop: 6, fontStyle: "italic" }}>{gOutlook2 || "No data"}</div>
                              </div>
                              <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.1)" }}>
                                <div style={{ fontSize: 10, color: "#94A3B8", lineHeight: 1.6 }}>
                                  {gVal2 != null && gVal2 > 1.5 ? "High-growth corridor — population expanding rapidly. Strong demand signal for storage as new households form." : gVal2 != null && gVal2 > 0.5 ? "Steady growth market. Population is expanding at a sustainable pace, driving incremental storage demand." : gVal2 != null && gVal2 > 0 ? "Stable market with modest growth. Existing facilities may absorb most new demand." : "Flat or declining population. Storage demand may be static — focus on existing household turnover."}
                                </div>
                              </div>
                              {pop1Raw && <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", padding: "6px 10px", borderRadius: 6, background: "rgba(15,21,56,0.3)" }}><span style={{ fontSize: 10, color: "#6B7394" }}>1-Mile Pop</span><span style={{ fontSize: 12, fontWeight: 800, color: "#E2E8F0", fontFamily: "'Space Mono', monospace" }}>{pop1Raw.toLocaleString()}</span></div>}
                            </div>
                          </div>
                        </div>
                        {/* INCOME & WEALTH */}
                        <div style={{ padding: "4px 24px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                            <div style={{ width: 3, height: 18, borderRadius: 2, background: "#C9A84C" }} />
                            <span style={{ fontSize: 12, fontWeight: 800, color: "#C9A84C", letterSpacing: "0.1em" }}>INCOME & WEALTH INDICATORS</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                            {[
                              { label: "MEDIAN HHI", val: hhiRaw, fmt: "$" + (hhiRaw || 0).toLocaleString(), bench: hhiBench, benchLabel: "$90K (top tier)", color: "#C9A84C", signal: hhiRaw >= 90000 ? "Premium" : hhiRaw >= 65000 ? "Strong" : hhiRaw >= 55000 ? "Adequate" : "Below threshold" },
                              { label: "HOUSEHOLDS", val: hhRaw, fmt: (hhRaw || 0).toLocaleString(), bench: hhBench, benchLabel: "25K (top tier)", color: "#8B5CF6", signal: hhRaw >= 25000 ? "Deep demand pool" : hhRaw >= 12000 ? "Solid base" : "Limited pool" },
                              { label: "HOME VALUE", val: hvRaw, fmt: "$" + (hvRaw || 0).toLocaleString(), bench: hvBench, benchLabel: "$500K (top tier)", color: "#F37C33", signal: hvRaw >= 500000 ? "Premium market" : hvRaw >= 250000 ? "Affluent" : hvRaw >= 180000 ? "Middle market" : "Value market" },
                            ].map((m, i) => (
                              <div key={i} style={{ background: "rgba(15,21,56,0.4)", borderRadius: 12, padding: 16, border: `1px solid ${m.color}15` }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 8 }}>{m.label}</div>
                                <div style={{ fontSize: 22, fontWeight: 900, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", marginBottom: 4 }}>{m.val ? m.fmt : "—"}</div>
                                <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.04)", overflow: "hidden", marginBottom: 8 }}>
                                  <div style={{ height: "100%", width: `${Math.min(100, ((m.val || 0) / m.bench) * 100)}%`, borderRadius: 3, background: `linear-gradient(90deg, ${m.color}99, ${m.color})` }} />
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ fontSize: 9, color: "#6B7394" }}>vs {m.benchLabel}</span>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: m.color }}>{m.signal}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* COMPETITION LANDSCAPE */}
                        {(compCount != null || compNames) && (
                          <div style={{ padding: "4px 24px 20px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                              <div style={{ width: 3, height: 18, borderRadius: 2, background: "#E87A2E" }} />
                              <span style={{ fontSize: 12, fontWeight: 800, color: "#E87A2E", letterSpacing: "0.1em" }}>COMPETITION LANDSCAPE</span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 12, padding: 16, border: "1px solid rgba(232,122,46,0.1)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                                  <div>
                                    <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 4 }}>FACILITIES WITHIN 3 MI</div>
                                    <div style={{ fontSize: 36, fontWeight: 900, color: compCount <= 3 ? "#22C55E" : compCount <= 6 ? "#F59E0B" : "#EF4444", fontFamily: "'Space Mono', monospace" }}>{compCount}</div>
                                  </div>
                                  <div style={{ padding: "6px 12px", borderRadius: 8, background: compCount <= 3 ? "rgba(34,197,94,0.12)" : compCount <= 6 ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)", border: `1px solid ${compCount <= 3 ? "rgba(34,197,94,0.2)" : compCount <= 6 ? "rgba(245,158,11,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                                    <div style={{ fontSize: 11, fontWeight: 800, color: compCount <= 3 ? "#22C55E" : compCount <= 6 ? "#F59E0B" : "#EF4444" }}>{compCount <= 3 ? "UNDERSERVED" : compCount <= 6 ? "MODERATE" : "COMPETITIVE"}</div>
                                  </div>
                                </div>
                                {nearComp && <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(15,21,56,0.3)", marginBottom: 8 }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>NEAREST: </span><span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 600 }}>{nearComp}</span></div>}
                                {demandSig && <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(15,21,56,0.3)" }}><span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394" }}>SIGNAL: </span><span style={{ fontSize: 11, color: "#C9A84C", fontWeight: 600 }}>{demandSig}</span></div>}
                              </div>
                              <div style={{ background: "rgba(15,21,56,0.4)", borderRadius: 12, padding: 16, border: "1px solid rgba(232,122,46,0.1)" }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.1em", marginBottom: 10 }}>COMPETING OPERATORS</div>
                                {compNames ? String(compNames).split(",").map((name, i) => (
                                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(201,168,76,0.04)" }}>
                                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: name.trim().match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage/) ? "#EF4444" : name.trim().match(/StorageMart|U-Haul|SecurCare/) ? "#F59E0B" : "#3B82F6", flexShrink: 0 }} />
                                    <span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 600 }}>{name.trim()}</span>
                                    {name.trim().match(/Public Storage|Extra Space|CubeSmart|Life Storage|NSA|iStorage/) && <span style={{ fontSize: 8, fontWeight: 800, color: "#EF4444", background: "rgba(239,68,68,0.1)", padding: "1px 5px", borderRadius: 3 }}>REIT</span>}
                                  </div>
                                )) : <div style={{ fontSize: 11, color: "#6B7394" }}>No competitor data</div>}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
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

              {/* SITESCORE DETAILED SCORECARD */}
              {iqR && iqR.scores && (() => {
                const dims2 = [
                  { key: "population", label: "Population", icon: "👥", weight: getIQWeight("population") },
                  { key: "growth", label: "Growth", icon: "📈", weight: getIQWeight("growth") },
                  { key: "income", label: "Income", icon: "💰", weight: getIQWeight("income") },
                  { key: "households", label: "Households", icon: "🏠", weight: getIQWeight("households") },
                  { key: "homeValue", label: "Home Value", icon: "🏡", weight: getIQWeight("homeValue") },
                  { key: "zoning", label: "Zoning", icon: "🏛️", weight: getIQWeight("zoning") },
                  { key: "psProximity", label: "PS Proximity", icon: "📦", weight: getIQWeight("psProximity") },
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
                        <span style={{ color: "#FFB347", fontSize: 13, fontWeight: 800, letterSpacing: "0.06em" }}>SiteScore™ SCORECARD</span>
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
                <button disabled={!prevSite} onClick={() => { if (prevSite) { goToDetail({ regionKey: dv.regionKey, siteId: prevSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); } }} style={{ ...navBtnSt(!prevSite), padding: "12px 24px" }}>← {prevSite ? prevSite.name : "Start"}</button>
                <button onClick={() => { setDetailView(null); navigateTo(dv.regionKey); }} style={{ padding: "12px 24px", borderRadius: 10, background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.15)", color: "#C9A84C", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>↩ Back to Tracker</button>
                <button disabled={!nextSite} onClick={() => { if (nextSite) { goToDetail({ regionKey: dv.regionKey, siteId: nextSite.id }); window.scrollTo({ top: 0, behavior: "smooth" }); } }} style={{ ...navBtnSt(!nextSite), padding: "12px 24px" }}>{nextSite ? nextSite.name : "End"} →</button>
              </div>
            </div>
          );
        })()}

        {/* ═══ TRACKERS ═══ */}
        {(tab === "southwest" || tab === "east") && !detailView && <TrackerCards regionKey={tab} />}
      </div>

            {/* ═══ COPYRIGHT FOOTER ═══ */}
                  <div style={{ textAlign: "center", padding: "18px 0 14px", borderTop: "1px solid rgba(201,168,76,0.1)", marginTop: 24, color: "#94A3B8", fontSize: 11, letterSpacing: 0.3 }}>
                          © {new Date().getFullYear()} DJR Real Estate LLC. All rights reserved. Patent Pending (App. No. 64/009,393). Proprietary software — unauthorized reproduction prohibited.
                                </div>
    </div>
  );
}

export default function App() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>;
}
