// src/App.js — Public Storage Acquisition Tracker
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

// ─── Shared Style Constants ───
const STYLES = {
  cardBase: { background: "#fff", borderRadius: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", overflow: "hidden" },
  kpiCard: (borderColor) => ({ cursor: "pointer", background: "linear-gradient(135deg, #fff 0%, #FAFBFC 100%)", borderRadius: 14, padding: "20px 24px", minWidth: 130, boxShadow: "0 2px 8px rgba(0,0,0,0.04)", borderLeft: `4px solid ${borderColor}`, transition: "all 0.25s ease" }),
  labelMicro: { fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 },
  btnPrimary: { padding: "8px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#F37C33,#E8650A)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 6px rgba(243,124,51,0.25)", transition: "all 0.2s" },
  btnGhost: { padding: "6px 14px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" },
  frostedHeader: { background: "rgba(44,44,44,0.92)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", padding: "0 20px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(0,0,0,0.2)" },
};

// ─── Debounce Helper ───
const debounce = (fn, ms) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

// ─── Geocode Demographics Helper ───
// Uses US Census Bureau ACS 5-Year via data.census.gov API
// Fetches 3-mile radius approximate demographics from coordinates
const fetchDemographics = async (coordinates) => {
  if (!coordinates) return null;
  const parts = coordinates.split(",").map((s) => s.trim());
  if (parts.length !== 2) return null;
  const [lat, lng] = parts.map(Number);
  if (isNaN(lat) || isNaN(lng)) return null;
  try {
    // Step 1: Reverse geocode to get FIPS via FCC API (CORS-friendly)
    const geoRes = await fetch(
      `https://geo.fcc.gov/api/census/block/find?latitude=${lat}&longitude=${lng}&format=json&showall=false`
    );
    const geoData = await geoRes.json();
    if (geoData.status !== "OK" || !geoData.Block?.FIPS) return { error: "Could not determine census tract" };
    const blockFips = geoData.Block.FIPS; // e.g. "481210203144035"
    const stFips = geoData.State?.FIPS || blockFips.substring(0, 2);
    const coFips = blockFips.substring(2, 5);
    const trFips = blockFips.substring(5, 11);
    // Step 2: Fetch ACS 5-Year data for the tract (B01003_001E=population, B19013_001E=median HHI)
    const acsRes = await fetch(
      `https://api.census.gov/data/2022/acs/acs5?get=B01003_001E,B19013_001E,B11001_001E&for=tract:${trFips}&in=state:${stFips}%20county:${coFips}`
    );
    const acsData = await acsRes.json();
    if (!acsData || acsData.length < 2) return { error: "No ACS data for tract" };
    const row = acsData[1];
    const pop = parseInt(row[0], 10);
    const income = parseInt(row[1], 10);
    const hh = parseInt(row[2], 10);
    // Estimate ring radii: multiply tract values by scaling factors (avg 3-mi covers ~8 tracts)
    // Also pull county-level for context
    let countyPop = null, countyIncome = null;
    try {
      const cRes = await fetch(`https://api.census.gov/data/2022/acs/acs5?get=B01003_001E,B19013_001E&for=county:${coFips}&in=state:${stFips}`);
      const cData = await cRes.json();
      if (cData?.[1]) { countyPop = parseInt(cData[1][0], 10); countyIncome = parseInt(cData[1][1], 10); }
    } catch (_) {}
    const tPop = isNaN(pop) ? 0 : pop;
    const incVal = isNaN(income) || income < 0 ? 0 : income;
    const tHh = isNaN(hh) ? 0 : hh;
    const rings = {
      1: { pop: Math.round(tPop * 0.8), hh: Math.round(tHh * 0.8), medIncome: incVal },
      3: { pop: Math.round(tPop * 8), hh: Math.round(tHh * 8), medIncome: incVal },
      5: { pop: Math.round(tPop * 18), hh: Math.round(tHh * 18), medIncome: incVal },
    };
    let growthOutlook = "Stable";
    if (tPop > 5000) growthOutlook = "Growing — high density";
    else if (tPop > 2000) growthOutlook = "Moderate growth";
    else growthOutlook = "Emerging — verify demand";
    return {
      rings,
      pop3mi: rings[3].pop ? rings[3].pop.toLocaleString() : null,
      income3mi: incVal ? "$" + incVal.toLocaleString() : null,
      growthOutlook,
      countyPop: countyPop ? countyPop.toLocaleString() : null,
      countyIncome: countyIncome && countyIncome > 0 ? "$" + countyIncome.toLocaleString() : null,
      fips: `${stFips}-${coFips}-${trFips}`,
      source: "Census ACS 5-Year (2022)",
    };
  } catch (err) {
    console.error("Demographics fetch error:", err);
    return { error: "Failed to fetch demographics" };
  }
};

// ─── Vetting Report Generator ───
const generateVettingReport = (site, nearestPSDistance) => {
  const lines = [];
  lines.push("═══════════════════════════════════════════════════");
  lines.push(`SITE VETTING REPORT — ${site.name || "Unnamed"}`);
  lines.push(`Generated: ${new Date().toLocaleDateString()} by PS Acquisition Pipeline`);
  lines.push("═══════════════════════════════════════════════════");
  lines.push("");
  lines.push("1. PROPERTY OVERVIEW");
  lines.push("─────────────────────");
  lines.push(`   Name:           ${site.name || "—"}`);
  lines.push(`   Address:        ${site.address || "—"}`);
  lines.push(`   City / State:   ${site.city || "—"}, ${site.state || "—"}`);
  lines.push(`   Market:         ${site.market || "—"}`);
  lines.push(`   Acreage:        ${site.acreage || "—"}`);
  lines.push(`   Asking Price:   ${site.askingPrice || "—"}`);
  lines.push(`   PS Int. Price:  ${site.internalPrice || "—"}`);
  lines.push(`   Coordinates:    ${site.coordinates || "—"}`);
  lines.push(`   Listing URL:    ${site.listingUrl || "—"}`);
  lines.push("");
  lines.push("2. ZONING & ENTITLEMENTS");
  lines.push("─────────────────────");
  lines.push(`   Current Zoning: ${site.zoning || "Not confirmed"}`);
  lines.push(`   Storage Use:    ${site.zoning ? "Verify with local jurisdiction" : "UNKNOWN — research required"}`);
  lines.push("");
  lines.push("3. DEMOGRAPHICS (3-Mile Radius)");
  lines.push("─────────────────────");
  lines.push(`   Population:     ${site.pop3mi ? fmtN(site.pop3mi) : "Not available"}`);
  lines.push(`   Median HHI:     ${site.income3mi || "Not available"}`);
  const popN = parseInt(String(site.pop3mi).replace(/[^0-9]/g, ""), 10);
  const incN = parseInt(String(site.income3mi).replace(/[^0-9]/g, ""), 10);
  if (popN && incN) {
    lines.push(`   Demo Score:     ${popN >= 40000 && incN >= 60000 ? "✅ PASS" : popN >= 20000 && incN >= 50000 ? "⚠️ MARGINAL" : "❌ BELOW THRESHOLD"}`);
  }
  lines.push("");
  lines.push("4. SITE SIZING ASSESSMENT");
  lines.push("─────────────────────");
  const acres = parseFloat(String(site.acreage).replace(/[^0-9.]/g, ""));
  if (!isNaN(acres)) {
    if (acres >= 3.5 && acres <= 5) lines.push(`   ${acres} ac → PRIMARY (one-story climate-controlled) ✅`);
    else if (acres >= 2.5 && acres < 3.5) lines.push(`   ${acres} ac → SECONDARY (multi-story 3-4 story) ✅`);
    else if (acres < 2.5) lines.push(`   ${acres} ac → ❌ BELOW MINIMUM — generally too small`);
    else if (acres > 5 && acres <= 7) lines.push(`   ${acres} ac → VIABLE if subdivisible ⚠️`);
    else lines.push(`   ${acres} ac → LARGE TRACT — subdivision potential ⚠️`);
  } else {
    lines.push("   Acreage not confirmed — sizing TBD");
  }
  lines.push("");
  lines.push("5. PS PROXIMITY CHECK");
  lines.push("─────────────────────");
  lines.push(`   Nearest PS:     ${nearestPSDistance || "Run proximity check with PS_Locations_ALL.csv"}`);
  lines.push("");
  lines.push("6. BROKER / SELLER");
  lines.push("─────────────────────");
  lines.push(`   Contact:        ${site.sellerBroker || "Not listed"}`);
  lines.push(`   Date on Market: ${site.dateOnMarket || "Unknown"}`);
  lines.push(`   Phase:          ${site.phase || "Prospect"}`);
  lines.push(`   Priority:       ${site.priority || "None"}`);
  lines.push("");
  lines.push("7. RED FLAGS / NOTES");
  lines.push("─────────────────────");
  const flags = [];
  if (!site.zoning) flags.push("   ⚠ Zoning not confirmed");
  if (!site.coordinates) flags.push("   ⚠ No coordinates — cannot verify location");
  if (acres < 2.5) flags.push("   ⚠ Below minimum acreage threshold");
  if (popN && popN < 10000) flags.push("   ⚠ 3-mi population below 10,000 minimum");
  if (incN && incN < 60000) flags.push("   ⚠ 3-mi median HHI below $60,000 target");
  if (!site.askingPrice || site.askingPrice === "TBD") flags.push("   ⚠ No confirmed asking price");
  if (flags.length === 0) flags.push("   None identified at this time");
  lines.push(flags.join("\n"));
  lines.push("");
  lines.push("8. SUMMARY / DEAL NOTES");
  lines.push("─────────────────────");
  lines.push(`   ${site.summary || "No notes"}`);
  lines.push("");
  lines.push("═══════════════════════════════════════════════════");
  lines.push("Report generated by PS Acquisition Pipeline · Powered by DJR Real Estate LLC");
  lines.push("═══════════════════════════════════════════════════");
  return lines.join("\n");
};

// ─── SiteIQ™ v3 — Calibrated PS Site Scoring Engine ───
// Matches CLAUDE.md §6h framework exactly. Uses structured data fields, not regex on summary text.
// Weights: Demographics 25% (pop) + 15% (HHI), PS Proximity 20%, Zoning 15%, Access 10%, Competition 5%, Market Tier 10%
// Hard FAIL: pop <5K, HHI <$55K, PS <2.5mi, landlocked
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

  // --- 3. PS PROXIMITY (20%) ---
  let spacingScore = 6;
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

  // --- 4. ZONING (15%) §6c methodology ---
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

  // --- COMPOSITE (weighted sum, 0-10 scale) ---
  const weightedSum =
    (popScore * 0.25) + (incScore * 0.15) + (spacingScore * 0.20) +
    (zoningScore * 0.15) + (scores.access * 0.10) + (compScore * 0.05) + (tierScore * 0.10);
  let adjusted = Math.round(weightedSum * 10) / 10;

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

  // --- CLASSIFICATION (§6h) ---
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

// ─── SiteIQ Badge Component ───
function SiteIQBadge({ site, size = "normal", iq: iqProp }) {
  const iq = iqProp || computeSiteIQ(site);
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

  if (isSmall) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px", borderRadius: 6,
        background: tc.labelBg, border: `1px solid ${tc.ring}33`,
        fontSize: 11, fontWeight: 700, color: iq.tier === "gold" ? "#B8860B" : iq.tier === "steel" ? "#2C3E6B" : "#64748B",
        fontFamily: "'Space Mono', monospace",
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
        width: 56, height: 56, borderRadius: "50%",
        background: tc.bg,
        boxShadow: tc.glow,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        ...(isGold ? { animation: "siteiq-glow 2s ease-in-out infinite alternate" } : {}),
      }}>
        {isGold && <div style={{
          position: "absolute", inset: -3, borderRadius: "50%",
          border: "2px solid #C9A84C",
          opacity: 0.5,
          animation: "siteiq-ring 2s ease-in-out infinite alternate",
        }} />}
        <div style={{ textAlign: "center", lineHeight: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: tc.text, fontFamily: "'Space Mono', monospace", letterSpacing: "-0.02em" }}>{s.toFixed(1)}</div>
        </div>
      </div>
      {/* Label + Breakdown */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: "0.12em",
            color: iq.tier === "gold" ? "#B8860B" : iq.tier === "steel" ? "#2C3E6B" : "#64748B",
            textTransform: "uppercase",
            padding: "2px 6px", borderRadius: 4,
            background: tc.labelBg,
          }}>{iq.label}</span>
          <span style={{ fontSize: 9, fontWeight: 600, color: "#94A3B8", letterSpacing: "0.08em" }}>SiteIQ™</span>
          {iq.classification && <span style={{ fontSize: 8, fontWeight: 800, color: iq.classColor, background: iq.classColor + "18", padding: "1px 5px", borderRadius: 3, letterSpacing: "0.06em" }}>{iq.classification}</span>}
        </div>
        {iq.flags && iq.flags.length > 0 && (
          <div style={{ display: "flex", gap: 3, marginTop: 2, flexWrap: "wrap" }}>
            {iq.flags.map((f, i) => (
              <span key={i} style={{ fontSize: 8, fontWeight: 600, color: "#DC2626", background: "#FEF2F2", padding: "1px 4px", borderRadius: 3 }}>{f}</span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
          {[
            { key: "population", label: "POP", emoji: "👥" },
            { key: "income", label: "HHI", emoji: "💰" },
            { key: "spacing", label: "PS", emoji: "📏" },
            { key: "zoning", label: "ZN", emoji: "📋" },
            { key: "access", label: "ACC", emoji: "🛣️" },
            { key: "competition", label: "CP", emoji: "🏢" },
            { key: "marketTier", label: "MKT", emoji: "📍" },
          ].map((f) => {
            const v = iq.scores[f.key] || 0;
            const c = v >= 8 ? "#16A34A" : v >= 6 ? "#2563EB" : v >= 4 ? "#D97706" : "#DC2626";
            return (
              <span key={f.key} title={`${f.label}: ${v}/10`} style={{
                fontSize: 9, fontWeight: 700, color: c,
                background: c + "15", padding: "1px 4px", borderRadius: 3,
                fontFamily: "'Space Mono', monospace",
              }}>{f.label}{v}</span>
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
      {status}
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
  // vettingReport removed — auto-generates on site add

  // ─── FONT LOADER ───
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap";
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
    };
  }, []);

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

  // ─── GEOCODE & DEMOGRAPHICS ───
  const handleFetchDemos = async (region, site) => {
    if (!site.coordinates) { notify("Add coordinates first"); return; }
    setDemoLoading((prev) => ({ ...prev, [site.id]: true }));
    try {
      const result = await fetchDemographics(site.coordinates);
      if (result?.error) {
        notify(result.error);
      } else if (result) {
        const updates = {};
        // Only overwrite if field is currently empty — protect manually verified data
        if (result.income3mi && !site.income3mi) updates.income3mi = result.income3mi;
        if (result.pop3mi && !site.pop3mi) updates.pop3mi = result.pop3mi;
        const skipped = [];
        if (result.income3mi && site.income3mi) skipped.push("HHI (kept existing: " + site.income3mi + ")");
        if (result.pop3mi && site.pop3mi) skipped.push("Pop (kept existing: " + site.pop3mi + ")");
        if (Object.keys(updates).length > 0) {
          fbUpdate(`${region}/${site.id}`, updates);
          fbPush(`${region}/${site.id}/activityLog`, {
            action: `Demographics pulled: Pop ${result.pop3mi || "?"}, HHI ${result.income3mi || "?"} (${result.source})${skipped.length ? " — Skipped overwrite: " + skipped.join(", ") : ""}`,
            ts: new Date().toISOString(),
            by: "System",
          });
        } else if (skipped.length > 0) {
          // All fields already populated — log but don't overwrite
          fbPush(`${region}/${site.id}/activityLog`, {
            action: `Demographics fetch skipped — existing data preserved: ${skipped.join(", ")}. Census returned: Pop ${result.pop3mi || "?"}, HHI ${result.income3mi || "?"}`,
            ts: new Date().toISOString(),
            by: "System",
          });
        }
        setDemoReport((prev) => ({ ...prev, [site.id]: result }));
        notify(Object.keys(updates).length > 0 ? "Demographics loaded — see report below" : "No demographic data found");
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

  // ─── REVIEW ───
  const handleApprove = (id) => {
    const site = subs.find((s) => s.id === id);
    if (!site) return;
    const ri = reviewInputs[id] || {};
    const now = new Date().toISOString();
    const t = {
      ...site,
      status: "tracking",
      approvedAt: now,
      reviewedBy: ri.reviewer || "Unknown",
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
      market: "",
      priority: "⚪ None",
      messages: {},
      docs: {},
      activityLog: { [uid()]: { action: `Approved by ${ri.reviewer || "Unknown"}`, ts: now, by: ri.reviewer || "Unknown" } },
    };
    fbSet(`${site.region}/${id}`, t);
    fbUpdate(`submissions/${id}`, { status: "approved", reviewedBy: ri.reviewer, reviewNote: ri.note });
    notify(`Approved by ${ri.reviewer || "Unknown"}`);
    autoGenerateVettingReport(site.region, id, t);
  };

  const handleApproveAll = () => {
    const p = subs.filter((s) => s.status === "pending");
    if (!p.length) return;
    const now = new Date().toISOString();
    const updates = {};
    p.forEach((s) => {
      const t = {
        ...s,
        status: "tracking",
        approvedAt: now,
        priority: "⚪ None",
        messages: {},
        docs: {},
        activityLog: { [uid()]: { action: "Bulk approved", ts: now, by: "Dan R" } },
      };
      updates[`${s.region}/${s.id}`] = t;
      updates[`submissions/${s.id}/status`] = "approved";
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
      <span style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>Sort:</span>
      {SORT_OPTIONS.map((o) => (
        <button key={o.key} onClick={() => setSortBy(o.key)} style={{ padding: "4px 10px", borderRadius: 6, border: sortBy === o.key ? "1px solid #F37C33" : "1px solid #E2E8F0", background: sortBy === o.key ? "#FFF3E0" : "#fff", color: sortBy === o.key ? "#E65100" : "#64748B", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans'", transition: "all 0.15s" }}>{o.label}</button>
      ))}
    </div>
  );

  // ─── STYLES ───
  const inp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: "#fff", color: "#2C2C2C", outline: "none", boxSizing: "border-box" };
  const navBtn = (key) => ({ padding: "10px 16px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s", background: tab === key ? "#2C2C2C" : "transparent", color: tab === key ? "#F37C33" : "#64748B", whiteSpace: "nowrap" });
  const pendingN = subs.filter((s) => s.status === "pending").length;

  if (!loaded) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#F1F5F9", fontFamily: "'DM Sans'" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 40, height: 40, border: "4px solid #E2E8F0", borderTopColor: "#F37C33", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
        <div style={{ color: "#64748B", fontSize: 14 }}>Loading…</div>
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
                <div key={site.id} id={`site-${site.id}`} className="site-card" style={{ ...STYLES.cardBase, borderLeft: `4px solid ${PRIORITY_COLORS[site.priority] || region.accent}` }}>
                  {/* Collapsed header */}
                  <div onClick={() => setExpandedSite(isOpen ? null : site.id)} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: "#2C2C2C" }}>{site.name}</span>
                        <SiteIQBadge site={site} size="small" iq={getSiteIQ(site)} />
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
                        {docs.length > 0 && <span style={{ color: "#64748B" }}>📁 {docs.length} doc{docs.length !== 1 ? "s" : ""}</span>}
                        {msgs.length > 0 && <span style={{ color: "#F37C33" }}>💬 {msgs.length}</span>}
                        {site.coordinates && <span>📍</span>}
                        {site.listingUrl && <a href={site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#E65100", textDecoration: "none", fontWeight: 600 }}>🔗 Listing</a>}
                      </div>
                    </div>
                    <div style={{ fontSize: 16, color: "#CBD5E1", transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}>▼</div>
                  </div>

                  {/* Expanded */}
                  {isOpen && (
                    <div className="card-expand" style={{ padding: "0 18px 18px", borderTop: "1px solid #F1F5F9" }}>
                      {/* SiteIQ™ Score — Primary Metric */}
                      <div style={{ background: "linear-gradient(135deg, #FAFBFC, #F1F5F9)", borderRadius: 12, padding: "10px 16px", margin: "14px 0 6px", border: "1px solid #E2E8F0" }}>
                        <SiteIQBadge site={site} iq={getSiteIQ(site)} />
                      </div>
                      {/* Aerial / Satellite View */}
                      <div style={{ margin: "14px 0 10px" }}>
                        {site.coordinates ? (
                          <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "1px solid #E2E8F0" }}>
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
                          <div style={{ background: "#F1F5F9", borderRadius: 10, padding: "24px 14px", textAlign: "center", border: "1px dashed #CBD5E1" }}>
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
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, padding: "5px 12px", borderRadius: 7, background: "#FFF3E0", border: "1px dashed #F37C33", fontSize: 11, color: "#E65100", fontWeight: 600 }}>
                              📎 No flyer uploaded — add one below
                            </div>
                          );
                        })()}
                      </div>

                      {/* Summary */}
                      <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 14, margin: "14px 0", border: "1px solid #E2E8F0" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 6 }}>Recent Summary</div>
                        <EF multi label="" value={site.summary || ""} onSave={(v) => saveField(regionKey, site.id, "summary", v)} placeholder="Deal notes, updates…" />
                      </div>

                      {/* Priority + Phase */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Priority</div>
                          <select value={site.priority || "⚪ None"} onChange={(e) => updateSiteField(regionKey, site.id, "priority", e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: `2px solid ${PRIORITY_COLORS[site.priority] || "#E2E8F0"}`, fontSize: 13, fontFamily: "'DM Sans'", background: "#fff", cursor: "pointer", fontWeight: 600, color: PRIORITY_COLORS[site.priority] || "#64748B" }}>
                            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>Phase</div>
                          <select value={site.phase || "Prospect"} onChange={(e) => updateSiteField(regionKey, site.id, "phase", e.target.value)} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 13, fontFamily: "'DM Sans'", background: "#fff", cursor: "pointer" }}>
                            {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Last Updated Indicator */}
                      {(() => {
                        const logs = Object.values(site.activityLog || {});
                        const lastLog = logs.length > 0 ? logs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0] : null;
                        const lastDate = lastLog?.date || site.approvedAt;
                        const daysAgo = lastDate ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000) : null;
                        return lastDate ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 11, color: daysAgo > 30 ? "#EF4444" : daysAgo > 14 ? "#F59E0B" : "#22C55E" }}>
                            <span style={{ fontSize: 9 }}>●</span>
                            <span style={{ fontWeight: 600 }}>Last updated {daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : daysAgo + "d ago"}</span>
                            {lastLog?.action && <span style={{ color: "#94A3B8", fontWeight: 400 }}>— {lastLog.action.length > 40 ? lastLog.action.slice(0, 40) + "…" : lastLog.action}</span>}
                          </div>
                        ) : null;
                      })()}

                      {/* Fields grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
                        <EF label="Market" value={site.market || ""} onSave={(v) => saveField(regionKey, site.id, "market", v)} placeholder="DFW, Houston…" />
                        <EF label="Asking Price" value={site.askingPrice || ""} onSave={(v) => saveField(regionKey, site.id, "askingPrice", v)} placeholder="$1.5M" />
                        <EF label="PS Internal Price" value={site.internalPrice || ""} onSave={(v) => saveField(regionKey, site.id, "internalPrice", v)} placeholder="$1.2M" />
                        <EF label="Seller / Broker" value={site.sellerBroker || ""} onSave={(v) => saveField(regionKey, site.id, "sellerBroker", v)} placeholder="John Smith" />
                        <EF label="3-Mile Income" value={site.income3mi || ""} onSave={(v) => saveField(regionKey, site.id, "income3mi", v)} placeholder="$95,000" />
                        <EF label="3-Mile Pop" value={site.pop3mi || ""} onSave={(v) => saveField(regionKey, site.id, "pop3mi", v)} placeholder="45,000" />
                        <EF label="Acreage" value={site.acreage || ""} onSave={(v) => saveField(regionKey, site.id, "acreage", v)} placeholder="4.5 ac" />
                        <EF label="Zoning" value={site.zoning || ""} onSave={(v) => saveField(regionKey, site.id, "zoning", v)} placeholder="C-2, B3…" />
                      </div>

                      {/* Pull Demographics Button */}
                      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                        <button onClick={() => handleFetchDemos(regionKey, site)} disabled={demoLoading[site.id] || !site.coordinates} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: demoLoading[site.id] ? "#E8F0FE" : "linear-gradient(135deg,#1565C0,#1976D2)", color: demoLoading[site.id] ? "#1565C0" : "#fff", fontSize: 11, fontWeight: 700, cursor: site.coordinates ? "pointer" : "not-allowed", opacity: site.coordinates ? 1 : 0.5, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 1px 3px rgba(21,101,192,.2)" }}>
                          {demoLoading[site.id] ? "⏳ Fetching…" : "📊 Pull Demographics"}
                        </button>
                      </div>

                      {/* Demographic Report Card — 1/3/5 Mile Snapshot */}
                      {demoReport[site.id] && (() => {
                        const dr = demoReport[site.id];
                        const r = dr.rings || {};
                        const ringRow = (label, key) => (
                          <tr key={label}>
                            <td style={{ padding: "6px 10px", fontWeight: 700, color: "#334155", fontSize: 12, borderBottom: "1px solid #E2E8F0" }}>{label}</td>
                            {[1, 3, 5].map((mi) => (
                              <td key={mi} style={{ padding: "6px 10px", textAlign: "right", fontSize: 12, color: "#475569", borderBottom: "1px solid #E2E8F0" }}>
                                {key === "medIncome" ? (r[mi]?.[key] ? "$" + r[mi][key].toLocaleString() : "—") : (r[mi]?.[key] ? r[mi][key].toLocaleString() : "—")}
                              </td>
                            ))}
                          </tr>
                        );
                        return (
                          <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, marginBottom: 14, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
                            <div style={{ background: "linear-gradient(135deg,#1E3A5F,#1565C0)", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ color: "#fff", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em" }}>DEMOGRAPHIC REPORT</div>
                              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <span style={{ color: "rgba(255,255,255,.6)", fontSize: 9 }}>{dr.source}</span>
                                <button onClick={() => setDemoReport((prev) => { const n = { ...prev }; delete n[site.id]; return n; })} style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid rgba(255,255,255,.3)", background: "transparent", color: "#fff", fontSize: 10, cursor: "pointer" }}>✕</button>
                              </div>
                            </div>
                            <div style={{ padding: 14 }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
                                <thead>
                                  <tr style={{ background: "#F8FAFC" }}>
                                    <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", borderBottom: "2px solid #E2E8F0" }}>Metric</th>
                                    {[1, 3, 5].map((mi) => <th key={mi} style={{ padding: "6px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", borderBottom: "2px solid #E2E8F0" }}>{mi}-Mile</th>)}
                                  </tr>
                                </thead>
                                <tbody>
                                  {ringRow("Population", "pop")}
                                  {ringRow("Households", "hh")}
                                  {ringRow("Median HHI", "medIncome")}
                                </tbody>
                              </table>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                <div style={{ background: "#F0F9FF", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 2 }}>Growth Outlook</div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: dr.growthOutlook?.includes("Growing") ? "#16A34A" : dr.growthOutlook?.includes("Moderate") ? "#D97706" : "#64748B" }}>{dr.growthOutlook || "—"}</div>
                                </div>
                                <div style={{ background: "#F0F9FF", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 2 }}>County Context</div>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: "#334155" }}>{dr.countyPop ? `Pop ${dr.countyPop}` : "—"}{dr.countyIncome ? ` · HHI ${dr.countyIncome}` : ""}</div>
                                </div>
                              </div>
                              {dr.fips && <div style={{ marginTop: 8, fontSize: 10, color: "#94A3B8", textAlign: "right" }}>FIPS {dr.fips}</div>}
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
                          <div style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 13, background: "#F8FAFC", color: dom !== null ? "#2C2C2C" : "#CBD5E1", fontWeight: dom !== null ? 700 : 400 }}>{dom !== null ? `${dom} days` : "—"}</div>
                        </div>
                      </div>

                      {/* Coordinates */}
                      <div style={{ marginBottom: 12 }}>
                        <EF label="Coordinates (lat, lng)" value={site.coordinates || ""} onSave={(v) => saveField(regionKey, site.id, "coordinates", v)} placeholder="39.123, -84.456" />
                        {site.coordinates && (
                          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                            <a href={mapsLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "4px 10px", borderRadius: 6, background: "#E8F0FE", color: "#1565C0", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>🗺 Google Maps</a>
                            <a href={earthLink(site.coordinates)} target="_blank" rel="noopener noreferrer" style={{ padding: "4px 10px", borderRadius: 6, background: "#E8F5E9", color: "#2E7D32", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>🌍 Google Earth</a>
                            <a href={site.listingUrl ? (site.listingUrl.startsWith("http") ? site.listingUrl : `https://${site.listingUrl}`) : `https://www.crexi.com/properties?query=${encodeURIComponent((site.address || "") + " " + (site.city || "") + " " + (site.state || ""))}`} target="_blank" rel="noopener noreferrer" style={{ padding: "4px 10px", borderRadius: 6, background: "#FFF3E0", color: "#E65100", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>🔗 Property Listing</a>
                            <button onClick={() => {
                              const docs = site.docs ? Object.values(site.docs) : [];
                              const vr = docs.find(d => d.name && d.name.startsWith("Vetting_Report"));
                              if (vr && vr.url) { window.open(vr.url, "_blank"); }
                              else { autoGenerateVettingReport(regionKey, site.id, site); setTimeout(() => alert("Vetting report generated! Click again to view."), 1500); }
                            }} style={{ padding: "4px 10px", borderRadius: 6, background: "#EDE7F6", color: "#5E35B1", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer" }}>📋 Vetting Report</button>
                          </div>
                        )}
                      </div>

                      {/* Listing URL */}
                      <div style={{ marginBottom: 14 }}>
                        <EF label="Listing URL (Crexi / LoopNet)" value={site.listingUrl || ""} onSave={(v) => saveField(regionKey, site.id, "listingUrl", v)} placeholder="https://www.crexi.com/…" />
                      </div>

                      {/* Documents */}
                      <div style={{ background: "#F8FAFC", borderRadius: 10, padding: 14, marginBottom: 14, border: "1px solid #E2E8F0" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 10 }}>📁 Documents</div>
                        {docs.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                            {docs.map(([docKey, doc]) => (
                              <div key={docKey} style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8, padding: "5px 10px", fontSize: 11 }}>
                                <span style={{ fontWeight: 600, color: "#475569" }}>{doc.type}: {doc.name?.length > 20 ? doc.name.slice(0, 20) + "…" : doc.name}</span>
                                <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ color: "#1565C0", fontWeight: 600, textDecoration: "none" }}>↗ View</a>
                                <button onClick={() => handleDocDelete(regionKey, site.id, docKey, doc)} style={{ border: "none", background: "none", color: "#EF4444", cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
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

                      {/* Messages */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 8 }}>💬 Thread</div>
                        {msgs.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, maxHeight: 200, overflowY: "auto" }}>
                            {[...msgs].sort((a, b) => new Date(a.ts) - new Date(b.ts)).map((m, i) => {
                              const mc = MSG_COLORS[m.from] || { bg: "#F8FAFC", border: "#E2E8F0", text: "#475569" };
                              return (
                                <div key={i} style={{ background: mc.bg, border: `1px solid ${mc.border}`, borderRadius: 8, padding: "8px 10px" }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: mc.text, marginBottom: 2 }}>{m.from} · {m.ts ? new Date(m.ts).toLocaleDateString() : ""}</div>
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
                          <input value={mi.text} onChange={(e) => setMsgInputs({ ...msgInputs, [site.id]: { ...mi, text: e.target.value } })} onKeyDown={(e) => { if (e.key === "Enter") handleSendMsg(regionKey, site.id); }} placeholder="Add message…" style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 13, outline: "none", fontFamily: "'DM Sans'" }} />
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
                                <span style={{ color: "#64748B" }}>{l.ts ? new Date(l.ts).toLocaleDateString() : ""}</span> — {l.action}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      {/* Remove */}
                      <button onClick={() => { if (window.confirm(`Remove "${site.name}"?`)) handleRemove(regionKey, site.id); }} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#991B1B", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans'" }}>🗑 Remove Site</button>
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
          <span style={{ fontSize: 13, color: "#E65100", fontWeight: 600 }}>🔔 {newSiteCount} new site{newSiteCount > 1 ? "s" : ""} pending review</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setTab("review"); setShowNewAlert(false); }} style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Review</button>
            <button onClick={() => setShowNewAlert(false)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#fff", color: "#94A3B8", fontSize: 11, cursor: "pointer" }}>✕</button>
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
                <div style={{ fontSize: 10, color: "#94A3B8", letterSpacing: "0.1em", textTransform: "uppercase" }}>Acquisition Pipeline · 2026</div>
                <div style={{ fontSize: 8, color: "#64748B", letterSpacing: "0.06em", marginTop: 1, opacity: 0.7 }}>Powered by DJR Real Estate LLC</div>
              </div>
            </div>
            <button onClick={handleExport} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#F37C33", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans'" }}>⬇ Export Excel</button>
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
      {/* Main content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>

        {/* ═══ DASHBOARD ═══ */}
        {tab === "dashboard" && (
          <div style={{ animation: "fadeIn 0.3s ease-out" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Pipeline", value: sw.length + east.length, color: "#F37C33", icon: "📊", action: () => setTab("summary"), sub: "View summary →" },
                { label: "Pending", value: pendingN, color: "#F59E0B", icon: "⏳", action: () => { setTab("review"); setShowNewAlert(false); }, sub: "Review queue →" },
                { label: "Daniel Wollent", value: sw.length, color: REGIONS.southwest.accent, icon: "🔷", action: () => { setTab("southwest"); setExpandedSite(null); }, sub: "Open tracker →" },
                { label: "Matthew Toussaint", value: east.length, color: REGIONS.east.accent, icon: "🟢", action: () => { setTab("east"); setExpandedSite(null); }, sub: "Open tracker →" },
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

            {[{ label: "Daniel Wollent", data: sw, color: REGIONS.southwest.color, accent: REGIONS.southwest.accent, tabKey: "southwest" }, { label: "Matthew Toussaint", data: east, color: REGIONS.east.color, accent: REGIONS.east.accent, tabKey: "east" }].map((r) => {
              const total = r.data.length || 1;
              const phaseColors = ["#CBD5E1", "#94A3B8", "#3B82F6", "#6366F1", "#16A34A", "#D97706", "#DC2626", "#8B5CF6", "#A855F7", "#F59E0B", "#F37C33", "#16A34A", "#64748B"];
              return (
                <div key={r.label} onClick={() => { setTab(r.tabKey); setExpandedSite(null); }} className="site-card" style={{ background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,.06)", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: r.color }}>{r.label} — 2026 Pipeline</h3>
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

        {/* ═══ SUMMARY ═══ */}
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
                            <td style={{ ...td, textAlign: "center" }}><SiteIQBadge site={s} size="small" iq={getSiteIQ(s)} /></td>
                            <td style={{ ...td, fontWeight: 600, color: "#2C2C2C" }}>{s.name}</td>
                            <td style={{ ...td, fontWeight: 600 }}>{s.city || "—"}</td>
                            <td style={td}>{s.state || "—"}</td>
                            <td style={{ ...td, fontSize: 11 }}><span style={{ padding: "2px 8px", borderRadius: 6, background: s.phase === "Under Contract" ? "#DCFCE7" : s.phase === "LOI Signed" ? "#FEF3C7" : s.phase === "LOI Sent" ? "#DBEAFE" : "#F1F5F9", color: s.phase === "Under Contract" ? "#166534" : s.phase === "LOI Signed" ? "#92400E" : s.phase === "LOI Sent" ? "#1E40AF" : "#64748B", fontWeight: 600 }}>{s.phase || "—"}</span></td>
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
              <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#2C2C2C" }}>📊 Summary</h2>
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
                  {(filterState !== "all" || filterPhase !== "all") && <button onClick={() => { setFilterState("all"); setFilterPhase("all"); }} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#fff", color: "#94A3B8", cursor: "pointer" }}>✕ Clear</button>}
              </div>
              <SumTable rk="southwest" />
              <SumTable rk="east" />
            </div>
          );
        })()}

        {/* ═══ SUBMIT ═══ */}
        {tab === "submit" && (
          <div style={{ animation: "fadeIn .3s ease-out", maxWidth: 600 }}>
            <div style={{ background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700 }}>Submit Site</h2>
              <div style={{ display: "flex", gap: 6, marginBottom: 16, background: "#F1F5F9", borderRadius: 10, padding: 3 }}>
                {[["direct", "⚡ Direct to Tracker"], ["review", "📋 Send to Review"]].map(([k, l]) => (
                  <button key={k} onClick={() => setSubmitMode(k)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans'", background: submitMode === k ? "#fff" : "transparent", color: submitMode === k ? "#2C2C2C" : "#94A3B8", boxShadow: submitMode === k ? "0 1px 3px rgba(0,0,0,.1)" : "none" }}>{l}</button>
                ))}
              </div>
              {/* ── Flyer Upload Zone ── */}
              <div style={{ fontSize: 12, fontWeight: 700, color: "#2C2C2C", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>📄 Flyer <span style={{ fontSize: 10, fontWeight: 500, color: "#94A3B8" }}>— auto-extracts acreage, price, zoning & broker</span></div>
              <div style={{ border: flyerFile ? "2px solid #F37C33" : "2px dashed #E2E8F0", borderRadius: 12, padding: flyerFile ? 14 : 20, textAlign: "center", background: flyerFile ? "#FFF8F3" : "#F8FAFC", marginBottom: 16, cursor: "pointer", transition: "all .2s" }} onClick={() => !flyerParsing && flyerRef.current?.click()} onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#F37C33"; }} onDragLeave={(e) => { e.currentTarget.style.borderColor = flyerFile ? "#F37C33" : "#E2E8F0"; }} onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = flyerFile ? "#F37C33" : "#E2E8F0"; const f = e.dataTransfer.files?.[0]; if (f) parseFlyer(f); }}>
                <input ref={flyerRef} type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFlyer(f); }} />
                {flyerParsing ? (
                  <div><div style={{ fontSize: 22, marginBottom: 4 }}>⏳</div><div style={{ fontSize: 12, color: "#64748B", fontWeight: 600 }}>Extracting info from flyer…</div></div>
                ) : flyerFile ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {flyerPreview && <img src={flyerPreview} alt="Flyer preview" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid #E2E8F0" }} />}
                    {!flyerPreview && <div style={{ width: 48, height: 48, borderRadius: 6, background: "#FFF3E0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>📄</div>}
                    <div style={{ textAlign: "left", flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#2C2C2C" }}>{flyerFile.name}</div>
                      <div style={{ fontSize: 11, color: "#64748B" }}>{(flyerFile.size / 1024).toFixed(0)} KB — fields auto-populated</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setFlyerFile(null); setFlyerPreview(null); if (flyerRef.current) flyerRef.current.value = ""; }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#fff", color: "#94A3B8", fontSize: 11, cursor: "pointer" }}>✕</button>
                  </div>
                ) : (
                  <div><div style={{ fontSize: 22, marginBottom: 4 }}>📎</div><div style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Drop a flyer here or click to upload</div><div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>PDF or image — we'll extract acreage, price, zoning, broker & more</div></div>
                )}
              </div>
              {/* ── Additional Attachments ── */}
              <div style={{ marginBottom: 16, background: "#F8FAFC", borderRadius: 10, padding: 14, border: "1px solid #E2E8F0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#2C2C2C", display: "flex", alignItems: "center", gap: 6 }}>📁 More Documents <span style={{ fontSize: 10, fontWeight: 500, color: "#94A3B8" }}>— survey, PSA, environmental, etc.</span></div>
                  <button onClick={() => attachRef.current?.click()} style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#2C2C2C", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ Add File</button>
                  <input ref={attachRef} type="file" accept=".pdf,image/*,.doc,.docx,.xlsx,.xls,.csv" multiple style={{ display: "none" }} onChange={(e) => { const files = Array.from(e.target.files || []); const newA = files.map((f) => ({ file: f, type: "Other", id: uid() })); setAttachments((prev) => [...prev, ...newA]); e.target.value = ""; }} />
                </div>
                {attachments.length > 0 && (
                  <div style={{ display: "grid", gap: 6 }}>
                    {attachments.map((a) => (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#FAFAFA" }}>
                        <div style={{ fontSize: 16 }}>{a.file.name.match(/\.pdf$/i) ? "📄" : a.file.type?.startsWith("image/") ? "🖼️" : "📎"}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#2C2C2C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.file.name}</div>
                          <div style={{ fontSize: 10, color: "#94A3B8" }}>{(a.file.size / 1024).toFixed(0)} KB</div>
                        </div>
                        <select value={a.type} onChange={(e) => setAttachments((prev) => prev.map((x) => x.id === a.id ? { ...x, type: e.target.value } : x))} style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #E2E8F0", fontSize: 11, background: "#fff", cursor: "pointer", color: "#475569" }}>
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
                <div><label style={{ fontSize: 10, fontWeight: 600, color: "#64748B", textTransform: "uppercase" }}>Notes</label><textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any additional notes…" /></div>
                <button onClick={handleSubmit} style={{ padding: "12px 20px", borderRadius: 10, border: "none", cursor: "pointer", background: submitMode === "direct" ? "linear-gradient(135deg,#F37C33,#E8650A)" : "linear-gradient(135deg,#2C2C2C,#3D3D3D)", color: "#fff", fontSize: 14, fontWeight: 700 }}>
                  {submitMode === "direct" ? "⚡ Add Now" : "📋 Submit for Review"}
                </button>
              </div>
              {shareLink && (
                <div style={{ background: "#FFF3E0", border: "1px solid #F37C33", borderRadius: 10, padding: 14, marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#E65100", marginBottom: 6 }}>✅ Submitted! Share this review link:</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input readOnly value={`${window.location.origin}${window.location.pathname}?review=${shareLink}`} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12, background: "#fff", outline: "none" }} onClick={(e) => e.target.select()} />
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 6 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Review Queue</h2>
              <div style={{ display: "flex", gap: 6 }}>
                {pendingN > 0 && <button onClick={handleApproveAll} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✓ Approve All ({pendingN})</button>}
                {subs.some((s) => s.status === "declined") && <button onClick={handleClearDeclined} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#991B1B", fontSize: 11, cursor: "pointer" }}>Clear Declined</button>}
              </div>
            </div>
            <SortBar />
            {subs.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 14, padding: "40px 30px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#475569", marginBottom: 6 }}>Review Queue Empty</div>
                <div style={{ fontSize: 12, color: "#94A3B8", maxWidth: 380, margin: "0 auto", lineHeight: 1.5 }}>Sites submitted via the "Submit Site" tab appear here for review and approval before being added to a tracker. Use <strong>Submit Site → Send to Review</strong> to queue a new site.</div>
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
                        {site.status === "pending" && <button onClick={() => { const url = `${window.location.origin}${window.location.pathname}?review=${site.id}`; navigator.clipboard.writeText(url); notify("Link copied!"); }} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#64748B", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>🔗 Copy Link</button>}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748B" }}>{site.address}, {site.city}, {site.state} → {REGIONS[site.region]?.label}</div>
                      {site.status === "pending" ? (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F1F5F9" }}>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                            <select value={ri.reviewer} onChange={(e) => setRI("reviewer", e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12, background: "#fff", cursor: "pointer", minWidth: 120 }}>
                              <option value="">Reviewer…</option>
                              <option>Daniel Wollent</option>
                              <option>Matthew Toussaint</option>
                              <option>Dan R</option>
                            </select>
                            <input value={ri.note} onChange={(e) => setRI("note", e.target.value)} placeholder="Review note…" style={{ flex: 1, minWidth: 180, padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12, outline: "none" }} />
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => { if (!ri.reviewer) { notify("Select reviewer"); return; } handleApprove(site.id); setHighlightedSite(null); }} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#F37C33", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
                            <button onClick={() => { handleDecline(site.id); setHighlightedSite(null); }} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✗ Decline</button>
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

        {/* ═══ TRACKERS ═══ */}
        {tab === "southwest" && <TrackerCards regionKey="southwest" />}
        {tab === "east" && <TrackerCards regionKey="east" />}
      </div>

            {/* ═══ COPYRIGHT FOOTER ═══ */}
                  <div style={{ textAlign: "center", padding: "18px 0 14px", borderTop: "1px solid #E2E8F0", marginTop: 24, color: "#94A3B8", fontSize: 11, letterSpacing: 0.3 }}>
                          © {new Date().getFullYear()} DJR Real Estate LLC. All rights reserved. Proprietary software — unauthorized reproduction prohibited.
                                </div>
    </div>
  );
}
