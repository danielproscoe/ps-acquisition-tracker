// ─── Shared Utility Functions & Constants ───
// Extracted from App.js for reuse across modules

// ─── CSV Parser ───
export function parseCSV(text) {
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
export const REGIONS = {
  southwest: { label: "Daniel Wollent", color: "#1565C0", accent: "#42A5F5" },
  east: { label: "Matthew Toussaint", color: "#2D5F2D", accent: "#4CAF50" },
};
export const STATUS_COLORS = {
  pending: { bg: "#FFFBEB", text: "#92700C", dot: "#C9A84C", label: "Pending" },
  recommended: { bg: "#E0E7FF", text: "#3730A3", dot: "#6366F1", label: "Dan R. Approved" },
  approved: { bg: "#E8F5E9", text: "#2E7D32", dot: "#4CAF50", label: "⚡ Approved to Tracker" },
  declined: { bg: "#FFEBEE", text: "#B71C1C", dot: "#EF5350", label: "Declined" },
  "ps-rejected": { bg: "#FEE2E2", text: "#991B1B", dot: "#DC2626", label: "PS Rejected" },
  tracking: { bg: "#FFF8F0", text: "#BF360C", dot: "#F37C33", label: "In Tracker" },
};
export const PHASES = [
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
export const PHASE_MIGRATION = {
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
export const PRIORITIES = ["🔥 Hot", "🟡 Warm", "🔵 Cold", "⚪ None"];
export const PRIORITY_COLORS = {
  "🔥 Hot": "#EF4444",
  "🟡 Warm": "#F59E0B",
  "🔵 Cold": "#3B82F6",
  "⚪ None": "#CBD5E1",
};
export const MSG_COLORS = {
  "Dan R": { bg: "#FFF3E0", border: "#F37C33", text: "#E65100" },
  "Daniel Wollent": { bg: "#EFF6FF", border: "#42A5F5", text: "#1565C0" },
  "Matthew Toussaint": { bg: "#F0FDF4", border: "#4CAF50", text: "#2D5F2D" },
};
export const DOC_TYPES = [
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
export const SITE_SCORE_DEFAULTS = [
  { key: "population", label: "Population", icon: "👥", weight: 0.16, tip: "3-mile population density", source: "ESRI / Census ACS", group: "demographics" },
  { key: "growth", label: "Growth", icon: "📈", weight: 0.22, tip: "Pop growth CAGR — 5yr projected trend", source: "ESRI 2025→2030 projections", group: "demographics" },
  { key: "income", label: "Med. Income", icon: "💰", weight: 0.10, tip: "Median HHI within 3 miles", source: "ESRI / Census ACS", group: "demographics" },
  { key: "households", label: "Households", icon: "🏠", weight: 0.05, tip: "3-mile household count (demand proxy)", source: "ESRI / Census ACS", group: "demographics" },
  { key: "homeValue", label: "Home Value", icon: "🏡", weight: 0.05, tip: "Median home value — affluence signal", source: "ESRI / Census ACS", group: "demographics" },
  { key: "zoning", label: "Zoning", icon: "📋", weight: 0.17, tip: "By-right / conditional / prohibited", source: "Zoning field + summary", group: "entitlements" },
  { key: "psProximity", label: "PS Proximity", icon: "📦", weight: 0.11, tip: "Distance to nearest PS location", source: "siteiqData.nearestPS", group: "market" },
  { key: "access", label: "Site Access", icon: "🛣️", weight: 0.07, tip: "Acreage, frontage, flood, access", source: "Site data + summary", group: "physical" },
  { key: "competition", label: "Competition", icon: "🏢", weight: 0.07, tip: "Storage competitor density", source: "Competitor data / summary", group: "market" },
];

// Auto-normalize so weights always sum to 1.0
export const normalizeSiteScoreWeights = (dims) => {
  const total = dims.reduce((s, d) => s + d.weight, 0);
  if (total > 0 && Math.abs(total - 1.0) > 0.001) {
    dims.forEach(d => { d.weight = d.weight / total; });
  }
  return dims;
};

// Get normalized weight by key — takes config as parameter for decoupling from mutable state
export const getIQWeight = (config, key) => {
  const dim = config.find(d => d.key === key);
  return dim ? dim.weight : 0;
};

// ─── Helpers ───
export const uid = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
};
export const fmt$ = (v) => {
  if (v == null || v === "") return "";
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? v : "$" + n.toLocaleString();
};
export const fmtN = (v) => {
  if (v == null || v === "") return "";
  const s = String(v);
  // If already a clean number, format it
  const d = Number(s);
  if (!isNaN(d) && isFinite(d)) return Math.round(d).toLocaleString();
  // Extract first number (with commas) from text like "43,000 (est.)"
  const m = s.match(/[\d,]+/);
  if (!m) return v;
  const n = parseInt(m[0].replace(/,/g, ""), 10);
  return isNaN(n) ? v : n.toLocaleString();
};
export const fmtPrice = (v) => {
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
export const mapsLink = (c) =>
  c ? `https://www.google.com/maps?q=${encodeURIComponent(c)}` : "";
export const earthLink = (c) =>
  c ? `https://earth.google.com/web/search/${encodeURIComponent(c)}` : "";

// ─── Shared Style Constants ───
export const STYLES = {
  cardBase: { background: "rgba(15,21,56,0.6)", borderRadius: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.25), 0 0 0 1px rgba(201,168,76,0.08)", overflow: "visible", backdropFilter: "blur(12px)", transition: "all 0.25s cubic-bezier(0.22,1,0.36,1)" },
  kpiCard: (borderColor) => ({ cursor: "pointer", background: "linear-gradient(145deg, rgba(15,21,56,0.85) 0%, rgba(10,14,42,0.95) 100%)", borderRadius: 16, padding: "22px 24px", minWidth: 140, boxShadow: `0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)`, borderLeft: `3px solid ${borderColor}`, transition: "all 0.25s cubic-bezier(0.22,1,0.36,1)", position: "relative", overflow: "hidden" }),
  labelMicro: { fontSize: 10, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 },
  btnPrimary: { padding: "10px 20px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#E87A2E 0%,#C9A84C 50%,#1E2761 100%)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(232,122,46,0.35), 0 0 0 1px rgba(232,122,46,0.15)", transition: "all 0.2s cubic-bezier(0.22,1,0.36,1)", position: "relative", overflow: "hidden" },
  btnGhost: { padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(232,122,46,0.25)", background: "rgba(232,122,46,0.06)", color: "#E87A2E", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s cubic-bezier(0.22,1,0.36,1)" },
  frostedHeader: { background: "linear-gradient(165deg, rgba(15,21,56,0.98) 0%, rgba(10,14,42,0.97) 50%, rgba(15,21,56,0.98) 100%)", backdropFilter: "blur(24px) saturate(1.8)", WebkitBackdropFilter: "blur(24px) saturate(1.8)", padding: "0 24px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 40px rgba(0,0,0,0.5), 0 1px 0 rgba(232,122,46,0.2)" },
};

// ─── Debounce Helper ───
export const debounce = (fn, ms) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

// ─── Safe Number Parser — prevents NaN propagation ───
export const safeNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? fallback : n;
};

// ─── HTML Escape — prevents XSS in report generators ───
export const escapeHtml = (str) => {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
};

// ─── Demographics Helper — reads ESRI GeoEnrichment data from Firebase ───
// Data: 2025 current-year estimates + 2030 five-year projections (ESRI paid)
// Radii: 1-mile, 3-mile, 5-mile (written by refresh-demos-esri.mjs scheduled task)
export const buildDemoReport = (site) => {
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
export const fetchDemographics = async (coordinates) => {
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
export const stripEmoji = (str) => String(str || "").replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{200D}]|[\u{20E3}]|[\u{E0020}-\u{E007F}]|[\u{1F300}-\u{1F9FF}]/gu, "").replace(/^[^\w]+/, "").trim();
export const cleanPriority = (p) => {
  if (!p) return "None";
  const s = stripEmoji(p);
  // Also handle cases where emoji renders as ?? or other garbage
  return s.replace(/^\?\?+\s*/, "").replace(/^[^a-zA-Z]+/, "").trim() || "None";
};

// ─── Input Validation & Sanitization ───
// Strips dangerous characters from free-text fields to prevent injection via Firebase
export const sanitizeString = (str) => {
  if (typeof str !== "string") return "";
  // Remove null bytes and control characters (except newlines/tabs for notes)
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, 5000);
};

// Fix common UTF-8 mojibake patterns (e.g. â€" → —) seen in Firebase data
export const fixEncoding = (str) => {
  if (typeof str !== "string") return str;
  return str
    .replace(/\u00e2\u0080\u0094|â€"/g, "—")
    .replace(/\u00e2\u0080\u0093|â€"/g, "–")
    .replace(/\u00e2\u0080\u0099|â€™/g, "'")
    .replace(/\u00e2\u0080\u009c|â€œ/g, "\u201C")
    .replace(/\u00e2\u0080\u009d|â€\u009d/g, "\u201D");
};

// Validate a Firebase path segment — no dots, brackets, slashes, or control chars
export const isValidFirebasePath = (p) => typeof p === "string" && p.length > 0 && !/[.#$\[\]\/\x00-\x1F]/.test(p);

// Validate coordinates format (lat,lng)
export const isValidCoordinates = (c) => {
  if (!c) return true; // optional field
  const m = String(c).match(/^(-?\d{1,3}\.?\d*),\s*(-?\d{1,3}\.?\d*)$/);
  if (!m) return false;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
};

// Validate US state abbreviation
const US_STATES = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR","VI","GU"]);
export const isValidState = (s) => US_STATES.has(String(s).toUpperCase().trim());

// Validate asking price (positive number or empty)
export const isValidPrice = (p) => {
  if (!p) return true; // optional
  const n = parseFloat(String(p).replace(/[$,]/g, ""));
  return !isNaN(n) && n >= 0 && n < 1e10;
};

// Validate acreage (positive number or empty)
export const isValidAcreage = (a) => {
  if (!a) return true; // optional
  const n = parseFloat(String(a).replace(/[,]/g, ""));
  return !isNaN(n) && n > 0 && n < 100000;
};
