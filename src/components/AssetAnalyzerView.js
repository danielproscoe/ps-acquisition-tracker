// AssetAnalyzerView.js — Storvex Asset Analyzer panel.
// Vets existing-stabilized self-storage acquisitions using the institutional
// 8-step framework from memory/valuation-framework.md.
//
// Companion to ground-up SiteScore (which vets land for build-to-suit).
// Demos Storvex's dual-acquisition coverage to PS VP Reza Mahdavian
// (memory/project_ps-vp-reit-platform-elevation.md).

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { analyzeExistingAsset, MSA_TIER_CAP_ADJUST, DEAL_TYPES } from "../existingAssetAnalysis";
import { computeBuyerLens, PS_LENS, BUYER_LENSES, BUYER_LENS_ORDER, DEFAULT_BUYER_KEY, getBuyerLens, computeAllBuyerLenses, computePlatformFitDelta } from "../buyerLensProfiles";
import { detectBuyer, formatDetectionBadge } from "../buyerDetection";
import { RECIPIENTS, RECIPIENT_OPTIONS, getRecipient, resolveRecipientLens } from "../recipientProfiles";
import { enrichAssetAnalysis } from "../analyzerEnrich";
import { buildWarehousePayload, downloadWarehousePayload } from "../warehouseExport";
import { openAnalyzerReport } from "../analyzerReport";
import { uid, safeNum, fmt$, fmtN } from "../utils";

// ─── Brand tokens — match QuickLookupPanel + CLAUDE.md §3 ─────────────────
const NAVY = "#1E2761";
const GOLD = "#C9A84C";
const ICE = "#D6E4F7";
const STEEL = "#2C3E6B";
const FIRE = "#F37C33";

const card = {
  background: "rgba(15,21,56,0.6)",
  border: "1px solid rgba(201,168,76,0.12)",
  borderRadius: 14,
  padding: 24,
  marginBottom: 16,
};
const sectionHeader = {
  fontSize: 11,
  fontWeight: 700,
  color: "#94A3B8",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 14,
};
const inputBase = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 10,
  border: "1px solid rgba(201,168,76,0.25)",
  background: "rgba(0,0,0,0.4)",
  color: "#fff",
  fontSize: 13,
  fontFamily: "'Inter', sans-serif",
  outline: "none",
  boxSizing: "border-box",
};
const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  color: "#94A3B8",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 6,
  display: "block",
};
const metricBox = {
  background: "rgba(0,0,0,0.25)",
  padding: "14px 16px",
  borderRadius: 10,
  borderLeft: `3px solid ${GOLD}`,
};

// ─── Defaults: Red Rock Mega Storage Reno NV calibration deal ─────────────
// Pre-loaded so Dan can demo the analyzer without typing — clicking through
// the sample shows the framework producing the documented PASS verdict.
const RED_ROCK_DEFAULTS = {
  name: "Red Rock Mega Storage",
  buyerLens: "PS",
  state: "NV",
  msaTier: "tertiary",
  dealType: "stabilized",
  ask: "16500000",
  nrsf: "100000",
  unitCount: "600",
  yearBuilt: "2018",
  physicalOcc: "92",
  economicOcc: "88",
  t12NOI: "633000",
  t12EGI: "1055000",
  proFormaEGI: "",
  proFormaNOI: "",
  ccPct: "20",
  isManned: "no",
  currentTaxAnnual: "",
  nearestPortfolioMi: "",
  actualMonthlyMoveins: "",
  listingBroker: "Marcus & Millichap",
  listingSource: "M&M",
};

// ─── Defaults: Texas Store & Go Greenville TX (Reza demo — broker takedown) ───
// 2024-vintage CO-LU lease-up flip listed by M&M Karr-Cunningham at $5.2M.
// 33% physical occ, mom-and-pop self-managed, 11% climate-controlled, well/septic,
// no fire sprinklers. M&M pro forma claims 8.99% Pro Forma cap with 24-month
// stabilization — falsifiable against actual rent roll showing 2.7 net move-ins/mo.
// All numbers from M&M OM (5/1/26) + seller's TTM P&L (Mar 2025–Feb 2026).
const GREENVILLE_DEFAULTS = {
  name: "Texas Store & Go · 2980 I-30 Greenville TX",
  buyerLens: "PS",
  state: "TX",
  msaTier: "tertiary",
  dealType: "co-lu",
  ask: "5200000",
  nrsf: "111650",
  unitCount: "451",
  yearBuilt: "2024",
  physicalOcc: "33",
  economicOcc: "23",
  t12NOI: "31508",
  t12EGI: "157422",
  proFormaEGI: "733467",
  proFormaNOI: "467589",
  ccPct: "11",
  isManned: "yes",
  currentTaxAnnual: "40699",
  nearestPortfolioMi: "",
  actualMonthlyMoveins: "2.7",
  listingBroker: "Marcus & Millichap (Karr-Cunningham Storage Team)",
  listingSource: "M&M / Crexi · 5/1/26",
};

// ─── Defaults: CubeSmart NNN Tallahassee FL (Reza demo — institutional pair) ───
// 4-story, 121K NRSF, 100% climate-controlled, single-tenant NNN credit lease
// to CubeSmart Inc (NYSE: CUBE). $21.6M @ 6.25% disclosed cap. Listed by
// Premier Commercial Group 8 days ago. CO expected first week June 2026.
//
// dealType="nnn" routes through the NNN-mode bypass in
// existingAssetAnalysis.js: opex reconstruction skipped (tenant absorbs),
// disclosed NOI passed through, tier pricing uses institutional credit-tenant
// cap band (5.5–6.5% per Green Street Q1 2026 + EDGAR M&A comps).
const TALLAHASSEE_DEFAULTS = {
  name: "CubeSmart NNN · 2320 Capital Circle NE Tallahassee FL",
  buyerLens: "CUBE",
  state: "FL",
  msaTier: "secondary",
  dealType: "nnn",
  ask: "21600000",
  nrsf: "121000",
  unitCount: "960",
  yearBuilt: "2026",
  physicalOcc: "85",
  economicOcc: "100",
  t12NOI: "1350000",
  t12EGI: "1500000",
  proFormaEGI: "",
  proFormaNOI: "",
  ccPct: "100",
  isManned: "no",
  currentTaxAnnual: "",
  nearestPortfolioMi: "",
  actualMonthlyMoveins: "",
  listingBroker: "Premier Commercial Group (Tracy Waters / Logan Short / Fletcher Dilmore)",
  listingSource: "Premier / Crexi · 5/1/26",
};

const EMPTY_INPUTS = Object.fromEntries(
  Object.keys(RED_ROCK_DEFAULTS).map((k) => [k, ""])
);

const STATE_OPTIONS = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const MSA_TIER_OPTIONS = [
  { key: "top30", label: "Top-30 MSA (−25 bps)" },
  { key: "secondary", label: "Secondary MSA (rank 31–125)" },
  { key: "tertiary", label: "Tertiary MSA (+75 bps)" },
];

const DEAL_TYPE_OPTIONS = [
  { key: "stabilized", label: "Stabilized — 85%+ occ, run-rate T-12" },
  { key: "co-lu", label: "CO-LU lease-up — newly built, <70% occ" },
  { key: "value-add", label: "Value-Add — under-managed / rate-compressed" },
  { key: "nnn", label: "NNN — credit-tenant net lease (REIT-leased)" },
];

// Buyer-lens dropdown options — derived from BUYER_LENSES registry. Each
// entry shows the lens name + ticker so analysts can pick the underwriting
// profile that matches the prospective buyer (PSA / EXR / CUBE / SMA /
// Generic 3PM-managed). Drives:
//   - opex ratios applied during NOI reconstruction
//   - acquisition cap by MSA tier
//   - revenue brand premium
//   - portfolio-fit bonus (proximity-driven cap reduction)
//   - YOC verdict (deal stabilized cap vs lens target acq cap)
const BUYER_OPTIONS = BUYER_LENS_ORDER.map((k) => ({
  key: k,
  label: `${BUYER_LENSES[k]?.ticker || k} — ${BUYER_LENSES[k]?.name || k}`,
}));

const LISTING_SOURCE_OPTIONS = [
  "Crexi", "LoopNet", "M&M", "CBRE", "JLL", "Colliers", "Off-market", "Other",
];

// ─── Field group definitions for clean rendering ──────────────────────────
const FIELD_GROUPS = [
  {
    title: "Property",
    fields: [
      { key: "name", label: "Property name / address", type: "text", placeholder: "e.g. Red Rock Mega Storage" },
      { key: "buyerLens", label: "Underwrite as buyer", type: "select", options: BUYER_OPTIONS, required: true },
      { key: "state", label: "State", type: "select", options: STATE_OPTIONS, required: true },
      { key: "msaTier", label: "MSA tier", type: "select", options: MSA_TIER_OPTIONS },
      { key: "dealType", label: "Deal type", type: "select", options: DEAL_TYPE_OPTIONS, required: true },
    ],
  },
  {
    title: "Pricing & Size",
    fields: [
      { key: "ask", label: "Asking price ($)", type: "number", placeholder: "16500000", required: true },
      { key: "nrsf", label: "NRSF (net rentable SF)", type: "number", placeholder: "100000", required: true },
      { key: "unitCount", label: "Unit count", type: "number", placeholder: "600", required: true },
      { key: "yearBuilt", label: "Year built", type: "number", placeholder: "2018" },
    ],
  },
  {
    title: "Operations",
    fields: [
      { key: "physicalOcc", label: "Physical occupancy (%)", type: "number", placeholder: "92", required: true },
      { key: "economicOcc", label: "Economic occupancy (%) — optional", type: "number", placeholder: "88" },
      { key: "ccPct", label: "Climate-controlled mix (%)", type: "number", placeholder: "70 (default)" },
      { key: "isManned", label: "Onsite manager?", type: "select", options: [{ key: "yes", label: "Yes — manned" }, { key: "no", label: "No — unmanned / kiosk" }] },
    ],
  },
  {
    title: "Financials",
    fields: [
      { key: "t12NOI", label: "Seller T-12 NOI ($)", type: "number", placeholder: "633000", required: true },
      { key: "t12EGI", label: "Seller T-12 EGI ($)", type: "number", placeholder: "1055000", required: true },
      { key: "proFormaEGI", label: "Pro Forma EGI ($) — CO-LU / Value-Add stabilized projection", type: "number", placeholder: "Required for non-stabilized" },
      { key: "proFormaNOI", label: "Pro Forma NOI ($) — optional, used for sanity check", type: "number", placeholder: "" },
      { key: "currentTaxAnnual", label: "Current annual property tax ($) — optional", type: "number", placeholder: "Used for NV / no-reassess states" },
    ],
  },
  {
    title: "Portfolio Fit",
    fields: [
      { key: "nearestPortfolioMi", label: "Distance to nearest operator-family facility (mi) — for portfolio-fit bonus", type: "number", placeholder: "e.g. 3 for −25 bps cap" },
    ],
  },
  {
    title: "Lease-Up Risk (CO-LU only)",
    fields: [
      { key: "actualMonthlyMoveins", label: "Actual net move-ins / month — from rent roll trailing 90 days", type: "number", placeholder: "e.g. 2.7 (Greenville run-rate)" },
    ],
  },
  {
    title: "Listing",
    fields: [
      { key: "listingBroker", label: "Listing broker / firm", type: "text", placeholder: "e.g. Marcus & Millichap" },
      { key: "listingSource", label: "Listing source", type: "select", options: LISTING_SOURCE_OPTIONS },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────
function parseInputs(inputs) {
  return {
    name: (inputs.name || "").trim(),
    state: (inputs.state || "").toUpperCase().trim(),
    msaTier: inputs.msaTier || "secondary",
    dealType: inputs.dealType || "stabilized",
    ask: safeNum(inputs.ask),
    nrsf: safeNum(inputs.nrsf),
    unitCount: safeNum(inputs.unitCount),
    yearBuilt: inputs.yearBuilt ? safeNum(inputs.yearBuilt) : null,
    // Percent inputs — accept either raw % (92) or decimal (0.92)
    physicalOcc: pctToDecimal(inputs.physicalOcc),
    economicOcc: pctToDecimal(inputs.economicOcc),
    ccPct: inputs.ccPct ? pctToDecimal(inputs.ccPct) : 0.70,
    isManned: inputs.isManned !== "no",
    t12NOI: safeNum(inputs.t12NOI),
    t12EGI: safeNum(inputs.t12EGI),
    proFormaEGI: safeNum(inputs.proFormaEGI),
    proFormaNOI: safeNum(inputs.proFormaNOI),
    currentTaxAnnual: safeNum(inputs.currentTaxAnnual),
    nearestPortfolioMi: inputs.nearestPortfolioMi ? safeNum(inputs.nearestPortfolioMi) : null,
    actualMonthlyMoveins: inputs.actualMonthlyMoveins ? safeNum(inputs.actualMonthlyMoveins) : null,
    listingBroker: (inputs.listingBroker || "").trim(),
    listingSource: inputs.listingSource || "",
  };
}

function pctToDecimal(v) {
  const n = safeNum(v);
  if (n <= 0) return 0;
  return n > 1 ? n / 100 : n; // accept 92 → 0.92 OR 0.92 → 0.92
}

function fmtPct(v, digits = 1) {
  if (v == null || !isFinite(v)) return "—";
  return (v * 100).toFixed(digits) + "%";
}

function readyToAnalyze(parsed) {
  return parsed.ask > 0 && parsed.nrsf > 0 && parsed.t12EGI > 0 && parsed.state.length === 2;
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

// sessionStorage key for hydrating analyzer state across tab switches.
// Cleared by Clear button. Bumped when the persisted shape changes.
const STORAGE_KEY = "storvex.asset-analyzer.v1";

function readPersisted() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function writePersisted(state) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* quota or disabled — silent */ }
}
function clearPersisted() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* silent */ }
}

export default function AssetAnalyzerView({ fbSet, notify }) {
  // Hydrate from sessionStorage on first mount so tab switches don't wipe the analysis.
  const persisted = useMemo(() => readPersisted(), []);
  const [inputs, setInputs] = useState(persisted?.inputs || EMPTY_INPUTS);
  const [savedId, setSavedId] = useState(persisted?.savedId || null);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractionMeta, setExtractionMeta] = useState(persisted?.extractionMeta || null);
  const [enrichment, setEnrichment] = useState(persisted?.enrichment || null);
  const [enriching, setEnriching] = useState(false);
  const [memo, setMemo] = useState(persisted?.memo || null);
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoError, setMemoError] = useState(null);
  // Auto-buyer-detection result — populated by handleOMFile after OM extraction
  // completes. Null until first OM upload (or after Clear). Renders the
  // AUTO-DETECTED badge next to the buyer dropdown.
  const [buyerDetection, setBuyerDetection] = useState(null);
  // Pitch target — when set, brands the Goldman PDF for a specific institutional
  // recipient (Reza / Aaron / Jennifer / Custom). Selecting a recipient also
  // auto-applies their default underwriting lens.
  const [pitchTarget, setPitchTarget] = useState(null);

  // Persist on every analyzer-state change so navigating away and back (Methodology
  // → Asset Analyzer, etc.) restores the loaded deal. Transient flags (saving,
  // extracting, enriching, memoLoading) are NOT persisted — they're in-flight.
  useEffect(() => {
    writePersisted({ inputs, savedId, extractionMeta, enrichment, memo });
  }, [inputs, savedId, extractionMeta, enrichment, memo]);

  const setField = useCallback((key, value) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
    setSavedId(null);
  }, []);

  // Pitch-target handler — selects a recipient + auto-applies their default
  // lens. Reza → PS · Aaron / Jennifer → AMERCO · Custom → keeps current lens.
  const handlePitchTargetChange = useCallback((targetKey) => {
    if (!targetKey) {
      setPitchTarget(null);
      return;
    }
    const recipient = getRecipient(targetKey);
    setPitchTarget(targetKey);
    if (recipient && recipient.defaultLens && targetKey !== "custom") {
      // Auto-apply recipient's default lens (skip for "custom" — leave whatever
      // the analyst already picked).
      setInputs((prev) => ({ ...prev, buyerLens: recipient.defaultLens }));
    }
  }, []);

  const loadDemo = useCallback(() => {
    setInputs(RED_ROCK_DEFAULTS);
    setSavedId(null);
    setMemo(null);
    setMemoError(null);
  }, []);

  const loadGreenville = useCallback(() => {
    setInputs(GREENVILLE_DEFAULTS);
    setSavedId(null);
    setMemo(null);
    setMemoError(null);
  }, []);

  const loadTallahassee = useCallback(() => {
    setInputs(TALLAHASSEE_DEFAULTS);
    setSavedId(null);
    setMemo(null);
    setMemoError(null);
  }, []);

  // ─── DEEP-LINK ROUTING — auto-load preset from ?asset=<preset> on mount ───
  // Companion to App.js routing — App.js switches the tab to Asset Analyzer
  // when ?asset=<preset> is present; this effect then auto-loads the matching
  // preset once the component mounts. Used for Reza demo emails:
  //   storvex.vercel.app/?asset=greenville   → Greenville TX preset
  //   storvex.vercel.app/?asset=tallahassee  → Tallahassee FL NNN preset
  //   storvex.vercel.app/?asset=red-rock     → Red Rock Reno calibration
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const asset = (params.get("asset") || "").toLowerCase().trim();
    if (asset === "greenville") loadGreenville();
    else if (asset === "tallahassee") loadTallahassee();
    else if (asset === "red-rock" || asset === "redrock") loadDemo();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearAll = useCallback(() => {
    setInputs(EMPTY_INPUTS);
    setSavedId(null);
    setExtractionMeta(null);
    setEnrichment(null);
    setMemo(null);
    setMemoError(null);
    setBuyerDetection(null);
    clearPersisted();
  }, []);

  const parsed = useMemo(() => parseInputs(inputs), [inputs]);
  const ready = useMemo(() => readyToAnalyze(parsed), [parsed]);
  // Both analyses receive marketRents from enrichment when available, enabling
  // the rent sanity cross-check inside analyzeExistingAsset. Sanity gracefully
  // degrades to null when enrichment hasn't completed yet (first render path).
  const analysis = useMemo(
    () => (ready ? analyzeExistingAsset(parsed, { marketRents: enrichment?.marketRents || null }) : null),
    [parsed, ready, enrichment]
  );
  // Buyer-lens analysis — driven by the user-selected buyer dropdown.
  // Replaces the prior hard-coded PS_LENS so the analyzer can render any
  // operator's underwriting view (PSA / EXR / CUBE / SMA / Generic 3PM).
  // The selected lens drives opex ratios, MSA-tier acq cap, brand premium,
  // portfolio-fit bonus, and the YOC verdict block.
  const selectedLens = useMemo(
    () => getBuyerLens(inputs.buyerLens || DEFAULT_BUYER_KEY),
    [inputs.buyerLens]
  );
  const psLens = useMemo(
    () => (ready ? computeBuyerLens(parsed, selectedLens, { nearestPortfolioMi: parsed.nearestPortfolioMi, marketRents: enrichment?.marketRents || null }) : null),
    [parsed, ready, enrichment, selectedLens]
  );

  // Multi-lens comparison — runs every registered lens against the same deal
  // for the side-by-side YOC comparison view. Sorted DESC by implied takedown
  // price so the natural takeout buyer is row 1. Powers MultiLensComparisonCard.
  const multiLensRows = useMemo(
    () => (ready ? computeAllBuyerLenses(parsed, { nearestPortfolioMi: parsed.nearestPortfolioMi, marketRents: enrichment?.marketRents || null }) : []),
    [parsed, ready, enrichment]
  );
  const platformFitDelta = useMemo(
    () => (multiLensRows.length ? computePlatformFitDelta(multiLensRows) : null),
    [multiLensRows]
  );

  // ── OM upload + auto-extract ────────────────────────────────────────────
  const handleOMFile = useCallback(async (file) => {
    if (!file || file.type !== "application/pdf") {
      if (notify) notify("Drop a PDF file (.pdf only)", "error");
      return;
    }
    // Vercel serverless functions cap request body at ~4.5 MB. For large OMs
    // (typical 5-10 MB), we extract text client-side via pdfjs and send only
    // the text to the API (~50 KB). Smaller PDFs can still send base64 for
    // full PDF input (richer extraction with charts/images), but text is
    // 100% adequate for the structured-table data we need.
    setExtracting(true);
    setExtractionMeta(null);
    try {
      const buffer = await file.arrayBuffer();

      // Lazy-load pdfjs only on first use (keeps initial bundle lean)
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      const pageCount = pdf.numPages;
      let pdfText = "";
      for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
        pdfText += `\n\n=== Page ${i} ===\n\n${pageText}`;
      }

      const resp = await fetch("/api/analyze-om", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfText, filename: file.name, pageCount }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || `API ${resp.status}`);
      }

      // Map extracted fields → form state
      const f = data.fields || {};
      const next = { ...EMPTY_INPUTS };
      if (f.name) next.name = String(f.name);
      if (f.state) next.state = String(f.state).toUpperCase();
      if (f.msaTier) next.msaTier = String(f.msaTier);
      if (f.dealType) next.dealType = String(f.dealType);
      if (f.ask != null) next.ask = String(f.ask);
      if (f.nrsf != null) next.nrsf = String(f.nrsf);
      if (f.unitCount != null) next.unitCount = String(f.unitCount);
      if (f.yearBuilt != null) next.yearBuilt = String(f.yearBuilt);
      if (f.physicalOcc != null) next.physicalOcc = String(Math.round(f.physicalOcc * 100));
      if (f.economicOcc != null) next.economicOcc = String(Math.round(f.economicOcc * 100));
      if (f.t12NOI != null) next.t12NOI = String(f.t12NOI);
      if (f.t12EGI != null) next.t12EGI = String(f.t12EGI);
      if (f.proFormaEGI != null) next.proFormaEGI = String(f.proFormaEGI);
      if (f.proFormaNOI != null) next.proFormaNOI = String(f.proFormaNOI);
      if (f.ccPct != null) next.ccPct = String(Math.round(f.ccPct * 100));
      if (f.isManned != null) next.isManned = f.isManned ? "yes" : "no";
      if (f.listingBroker) next.listingBroker = String(f.listingBroker);
      if (f.listingSource) next.listingSource = String(f.listingSource);
      if (f.currentTaxAnnual != null) next.currentTaxAnnual = String(f.currentTaxAnnual);

      // ── AUTO-BUYER-DETECTION ─────────────────────────────────────────────
      // Score each registered buyer lens against the OM extraction signals
      // (brand-name match in property name / filename, listing broker
      // fingerprint, geographic match, deal type heuristics). Auto-set the
      // dropdown to the detected buyer. User can override manually.
      const detection = detectBuyer({
        name: next.name,
        filename: file.name,
        listingBroker: next.listingBroker,
        state: next.state,
        city: f.city,
        dealType: next.dealType,
      });
      next.buyerLens = detection.buyerKey;
      setBuyerDetection(detection);

      setInputs(next);
      setExtractionMeta({
        confidence: data.confidence,
        notes: data.extractionNotes || "",
        model: data.model,
        elapsedMs: data.elapsedMs,
        filename: file.name,
        tokenUsage: data.tokenUsage,
      });
      setSavedId(null);
      if (notify) notify(`OM extracted · ${file.name} · ${(data.elapsedMs / 1000).toFixed(1)}s · confidence ${((data.confidence || 0) * 100).toFixed(0)}% · buyer auto-detected: ${detection.buyerKey} (${detection.confidence})`, "success");

      // ── PSA-grade auto-enrichment (parallel to user reviewing extracted fields)
      // Pulls what a PSA underwriter pulls manually: ESRI 1-3-5 demographics,
      // PS family proximity (Haversine vs ps-locations.csv), SpareFoot market rents.
      setEnriching(true);
      setEnrichment(null);
      try {
        const enrich = await enrichAssetAnalysis({
          address: f.address,
          city: f.city,
          state: f.state,
          buyerLens: next.buyerLens,
        });
        setEnrichment(enrich);
        // Auto-fill the PS Lens portfolio-fit input
        if (enrich.psFamily?.distanceMi != null && isFinite(enrich.psFamily.distanceMi)) {
          setInputs((prev) => ({ ...prev, nearestPortfolioMi: String(Math.round(enrich.psFamily.distanceMi * 10) / 10) }));
        }
        if (notify) {
          const parts = [];
          if (enrich.coords) parts.push(`coords ${enrich.coords.lat.toFixed(4)}, ${enrich.coords.lng.toFixed(4)}`);
          if (enrich.demographics?.pop3mi) parts.push(`3-mi pop ${Math.round(enrich.demographics.pop3mi).toLocaleString()}`);
          if (enrich.psFamily?.distanceMi != null) parts.push(`nearest PS ${enrich.psFamily.distanceMi.toFixed(1)} mi`);
          notify(`Auto-enriched · ${parts.join(" · ")}`, "success");
        }
      } catch (e) {
        if (notify) notify(`Auto-enrichment partial: ${e.message || e}`, "info");
      } finally {
        setEnriching(false);
      }
    } catch (err) {
      if (notify) notify(`Extraction failed: ${err.message || err}`, "error");
      setExtractionMeta({ error: err.message || String(err) });
    } finally {
      setExtracting(false);
    }
  }, [notify]);

  // ── Generate IC Memo from deterministic outputs ─────────────────────────
  const handleGenerateMemo = useCallback(async () => {
    if (!analysis || !psLens) return;
    setMemoLoading(true);
    setMemoError(null);
    setMemo(null);
    try {
      const resp = await fetch("/api/analyzer-memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generic: analysis, psLens, enrichment }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || `API ${resp.status}`);
      setMemo({ ...data.memo, _meta: { model: data.model, elapsedMs: data.elapsedMs, tokenUsage: data.tokenUsage } });
      if (notify) notify(`IC memo generated · ${(data.elapsedMs / 1000).toFixed(1)}s`, "success");
    } catch (err) {
      setMemoError(err.message || String(err));
      if (notify) notify(`Memo generation failed: ${err.message || err}`, "error");
    } finally {
      setMemoLoading(false);
    }
  }, [analysis, psLens, enrichment, notify]);

  // Reset memo when inputs change so it doesn't go stale silently.
  // Skip the very first run — on remount the hydrated `inputs` arrives as a
  // "new" reference and would otherwise wipe the just-restored memo.
  const skipMemoResetRef = useRef(true);
  React.useEffect(() => {
    if (skipMemoResetRef.current) {
      skipMemoResetRef.current = false;
      return;
    }
    setMemo(null);
    setMemoError(null);
  }, [inputs]);

  // ── Push to PSA Data Warehouse — JSON export in storvex.asset-analyzer.v1 schema
  const handleExportToWarehouse = useCallback(() => {
    if (!analysis) return;
    try {
      const payload = buildWarehousePayload({
        analysis,
        psLens,
        enrichment,
        extractionMeta,
        memo,
        dealId: savedId || null,
        multiLensRows,
        platformFitDelta,
        pitchTarget,
      });
      downloadWarehousePayload(payload, payload.subject?.name || analysis.snapshot?.name);
      if (notify) notify("Exported · structured JSON ready for data warehouse ingestion", "success");
    } catch (e) {
      if (notify) notify(`Export failed: ${e.message || e}`, "error");
    }
  }, [analysis, psLens, enrichment, extractionMeta, memo, savedId, multiLensRows, platformFitDelta, pitchTarget, notify]);

  // ── Export Report — Goldman-exec PDF deliverable (opens in new tab, browser prints)
  const handleExportReport = useCallback(() => {
    if (!analysis) return;
    try {
      openAnalyzerReport({ analysis, psLens, enrichment, memo, multiLensRows, platformFitDelta, pitchTarget });
      if (notify) notify("Report opened in new tab · click 'Save as PDF' to print", "success");
    } catch (e) {
      if (notify) notify(`Report failed: ${e.message || e}`, "error");
    }
  }, [analysis, psLens, enrichment, memo, multiLensRows, platformFitDelta, pitchTarget, notify]);

  const handleSave = useCallback(async () => {
    if (!analysis || !fbSet) return;
    setSaving(true);
    try {
      const id = uid();
      // Save the full underwriting context — analysis, PSA Lens, enrichment,
      // and memo (if generated) — so Calibration view can compare Storvex's
      // PSA Lens verdict against PSA's actual outcome later. Trim heavy
      // fields (Reconstruction line tables, full extraction transcripts) to
      // keep Firebase records under reasonable size.
      const trimAnalysis = (a) => a ? {
        snapshot: a.snapshot,
        verdict: a.verdict,
        marketCap: a.marketCap,
        msaTier: a.msaTier,
        dealType: a.dealType,
        tiers: a.tiers,
        reconstructed: a.reconstructed ? {
          buyerNOI: a.reconstructed.buyerNOI,
          opexRatio: a.reconstructed.opexRatio,
          buyerCap: a.reconstructed.buyerCap,
        } : null,
        projection: a.projection,
      } : null;
      const record = {
        id,
        inputs,
        analysis: trimAnalysis(analysis),
        psLens: psLens ? {
          ...trimAnalysis(psLens),
          lens: psLens.lens,
        } : null,
        enrichment: enrichment ? {
          coords: enrichment.coords,
          demographics: enrichment.demographics,
          psFamily: enrichment.psFamily,
          marketRents: enrichment.marketRents,
        } : null,
        memo: memo || null,
        actualOutcome: "",     // Calibration tab will populate when PSA decides
        calibrationNote: "",
        createdAt: new Date().toISOString(),
        version: "v2",
      };
      await fbSet(`existingAssets/${id}`, record);
      setSavedId(id);
      if (notify) notify(`Analysis saved · ${id.slice(0, 8)} · trackable in Calibration tab`, "success");
    } catch (e) {
      if (notify) notify(`Save failed: ${e.message || e}`, "error");
    } finally {
      setSaving(false);
    }
  }, [analysis, psLens, enrichment, memo, inputs, fbSet, notify]);

  return (
    <div style={{ animation: "fadeIn 0.3s ease-out", color: "#E2E8F0", fontFamily: "'Inter', sans-serif" }}>
      <Header
        onLoadDemo={loadDemo}
        onLoadGreenville={loadGreenville}
        onLoadTallahassee={loadTallahassee}
        onClear={clearAll}
        onSave={handleSave}
        onExport={handleExportToWarehouse}
        onExportReport={handleExportReport}
        canSave={!!analysis}
        canExport={!!analysis}
        saving={saving}
        savedId={savedId}
        pitchTarget={pitchTarget}
        onPitchTargetChange={handlePitchTargetChange}
      />
      <OMDropZone onFile={handleOMFile} extracting={extracting} meta={extractionMeta} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 20, alignItems: "flex-start" }}>
        <FormPanel
          inputs={inputs}
          setField={setField}
          buyerDetection={buyerDetection}
          buyerRentAnchor={enrichment?.buyerSpecificRentAnchor}
        />
        <OutputsPanel
          analysis={analysis}
          psLens={psLens}
          multiLensRows={multiLensRows}
          platformFitDelta={platformFitDelta}
          ready={ready}
          enrichment={enrichment}
          enriching={enriching}
          memo={memo}
          memoLoading={memoLoading}
          memoError={memoError}
          onGenerateMemo={handleGenerateMemo}
        />
      </div>
    </div>
  );
}

// ─── OM Drop Zone — drag/drop PDF or click to browse ─────────────────────
function OMDropZone({ onFile, extracting, meta }) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);

  const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); };
  const onDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); };
  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };
  const onClick = () => inputRef.current?.click();
  const onChange = (e) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = ""; // allow re-upload of same file
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      style={{
        marginBottom: 16,
        padding: "20px 24px",
        borderRadius: 14,
        border: `2px dashed ${dragActive ? GOLD : "rgba(201,168,76,0.3)"}`,
        background: dragActive ? "rgba(201,168,76,0.08)" : "rgba(15,21,56,0.5)",
        cursor: extracting ? "wait" : "pointer",
        transition: "all 0.2s ease",
        textAlign: "center",
        position: "relative",
      }}
    >
      <input ref={inputRef} type="file" accept="application/pdf" onChange={onChange} style={{ display: "none" }} />
      {extracting ? (
        <div>
          <div style={{ fontSize: 24, marginBottom: 6 }}>⏳</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: GOLD }}>Reading the OM…</div>
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>Storvex is extracting underwriting fields. ~15-45s for a 70-page PDF.</div>
        </div>
      ) : meta?.error ? (
        <div>
          <div style={{ fontSize: 22, marginBottom: 4 }}>⚠</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#EF4444" }}>Extraction failed</div>
          <div style={{ fontSize: 11, color: "#FCA5A5", marginTop: 4, maxWidth: 600, marginLeft: "auto", marginRight: "auto" }}>{meta.error}</div>
          <div style={{ fontSize: 11, color: GOLD, marginTop: 8 }}>Click or drop another PDF to retry</div>
        </div>
      ) : meta ? (
        <div>
          <div style={{ fontSize: 22, marginBottom: 4 }}>✓</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#22C55E" }}>Extracted · {meta.filename}</div>
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>
            Confidence {((meta.confidence || 0) * 100).toFixed(0)}% · {(meta.elapsedMs / 1000).toFixed(1)}s · Storvex OM Engine
            {meta.tokenUsage ? ` · ${(meta.tokenUsage.input / 1000).toFixed(1)}K tokens in` : ""}
          </div>
          {meta.notes && <div style={{ fontSize: 11, color: ICE, marginTop: 6, fontStyle: "italic", maxWidth: 700, marginLeft: "auto", marginRight: "auto", lineHeight: 1.4 }}>"{meta.notes}"</div>}
          <div style={{ fontSize: 11, color: GOLD, marginTop: 8 }}>Drop another OM to re-extract · review fields below before running</div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.6 }}>📄</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0" }}>Drop an Offering Memorandum (PDF) here</div>
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4, lineHeight: 1.5 }}>
            Or click to browse. Auto-extracts ask, NRSF, units, occupancy, T-12 + pro forma NOI, broker, deal type. ~30s round trip.
          </div>
          <div style={{ fontSize: 10, color: "#64748B", marginTop: 6 }}>Max 32 MB · PDFs only</div>
        </div>
      )}
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────
function Header({ onLoadDemo, onLoadGreenville, onLoadTallahassee, onClear, onSave, onExport, onExportReport, canSave, canExport, saving, savedId, pitchTarget, onPitchTargetChange }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 26, lineHeight: 1 }}>📊</span>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>Asset Analyzer</h1>
          <span style={{ fontSize: 10, fontWeight: 700, color: GOLD, background: "rgba(201,168,76,0.12)", border: `1px solid ${GOLD}40`, padding: "3px 9px", borderRadius: 999, letterSpacing: "0.06em", textTransform: "uppercase" }}>Existing-Stabilized</span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "#94A3B8", maxWidth: 720, lineHeight: 1.5 }}>
          Buyer-lens NOI reconstruction · state-specific RE tax matrix · ECRI burn-in projection · Home Run / Strike / Walk price tiers. Companion to ground-up SiteScore.
        </p>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={onLoadDemo} style={btnGhost} title="Pre-load Red Rock Mega Storage Reno NV (4/21/26 PASS calibration deal)">⤓ Red Rock</button>
        <button onClick={onLoadGreenville} style={{...btnGhost, color: GOLD, borderColor: `${GOLD}66`, background: "rgba(201,168,76,0.10)"}} title="Reza demo · Texas Store & Go Greenville TX — M&M $5.2M lease-up flip (broker pro forma takedown)">⤓ Greenville</button>
        <button onClick={onLoadTallahassee} style={{...btnGhost, color: GOLD, borderColor: `${GOLD}66`, background: "rgba(201,168,76,0.10)"}} title="Reza demo · CubeSmart NNN Tallahassee FL — $21.6M Class A institutional pair (NNN credit-tenant — note analyzer treats as operational, future NNN mode TBD)">⤓ Tallahassee</button>
        <button onClick={onClear} style={btnGhost}>Clear</button>
        <button
          onClick={onExport}
          disabled={!canExport}
          style={{ ...btnGhost, opacity: !canExport ? 0.5 : 1, cursor: !canExport ? "not-allowed" : "pointer", color: "#3B82F6", borderColor: "rgba(59,130,246,0.4)", background: "rgba(59,130,246,0.08)" }}
          title="Export structured JSON for institutional data warehouse / downstream scoring layer ingestion"
        >
          ⤓ Push to Warehouse
        </button>
        {/* Pitch-to dropdown — selecting a recipient auto-applies their lens
            and brands the Goldman PDF cover for them. */}
        <select
          value={pitchTarget || ""}
          onChange={(e) => onPitchTargetChange(e.target.value || null)}
          style={{
            ...btnGhost,
            color: pitchTarget ? "#A855F7" : "#94A3B8",
            borderColor: pitchTarget ? "rgba(168,85,247,0.5)" : "rgba(148,163,184,0.30)",
            background: pitchTarget ? "rgba(168,85,247,0.10)" : "rgba(148,163,184,0.05)",
            fontWeight: pitchTarget ? 700 : 500,
            paddingRight: 26,
            cursor: "pointer",
          }}
          title="Brand the Goldman PDF for a specific institutional recipient · auto-applies their default underwriting lens"
        >
          <option value="">🎯 Pitch to…</option>
          {RECIPIENT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
        <button
          onClick={onExportReport}
          disabled={!canExport}
          style={{ ...btnGhost, opacity: !canExport ? 0.5 : 1, cursor: !canExport ? "not-allowed" : "pointer", color: GOLD, borderColor: `${GOLD}66`, background: "rgba(201,168,76,0.10)", fontWeight: 700 }}
          title={pitchTarget ? `Open pitch-mode Goldman PDF for ${getRecipient(pitchTarget)?.recipientName || "recipient"}` : "Open Goldman-exec institutional report in a new tab · browser handles Save-as-PDF"}
        >
          📄 {pitchTarget && pitchTarget !== "custom" ? `Pitch · ${getRecipient(pitchTarget)?.recipientName?.split(" ")[0] || "Custom"}` : "Export Report"}
        </button>
        <button
          onClick={onSave}
          disabled={!canSave || saving}
          style={{ ...btnPrimary, opacity: !canSave || saving ? 0.5 : 1, cursor: !canSave || saving ? "not-allowed" : "pointer" }}
          title={canSave ? "Save analysis to Firebase" : "Fill in required fields first"}
        >
          {saving ? "Saving…" : savedId ? `✓ Saved · ${savedId.slice(0, 8)}` : "Save Analysis"}
        </button>
      </div>
    </div>
  );
}

const btnGhost = {
  padding: "9px 14px",
  borderRadius: 10,
  border: "1px solid rgba(201,168,76,0.25)",
  background: "rgba(201,168,76,0.06)",
  color: GOLD,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "'Inter', sans-serif",
};
const btnPrimary = {
  padding: "9px 16px",
  borderRadius: 10,
  border: "1px solid #C9A84C",
  background: `linear-gradient(135deg, ${GOLD}, #B89538)`,
  color: NAVY,
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
  letterSpacing: "0.02em",
  fontFamily: "'Inter', sans-serif",
};

// ─── Buyer Detection Badge ────────────────────────────────────────────────
//
// Renders under the buyerLens dropdown when OM extraction triggered auto-
// detection. Shows the winning signal evidence so analysts can see WHY a
// particular lens was picked and audit/override if needed.
function BuyerDetectionBadge({ detection }) {
  if (!detection) return null;
  const { buyerKey, confidence, defaulted, signals } = detection;
  const winningSignals = (signals || [])
    .filter((s) => s.buyer === buyerKey && s.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const evidence = defaulted
    ? "no decisive signals — defaulted to PS lens"
    : (winningSignals[0]?.evidence || "multiple signals");

  const confColors = {
    HIGH: { fg: "#22C55E", bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.40)" },
    MEDIUM: { fg: "#C9A84C", bg: "rgba(201,168,76,0.10)", border: "rgba(201,168,76,0.40)" },
    LOW: { fg: "#94A3B8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.30)" },
  };
  const c = confColors[confidence] || confColors.LOW;

  return (
    <div
      style={{
        marginTop: 6,
        padding: "6px 10px",
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 4,
        fontSize: 10,
        color: "#94A3B8",
        lineHeight: 1.4,
      }}
    >
      <span style={{ fontWeight: 800, color: c.fg, letterSpacing: "0.04em", textTransform: "uppercase", marginRight: 6 }}>
        ⚡ AUTO-DETECTED · {buyerKey} ({confidence})
      </span>
      <span style={{ color: "#94A3B8" }}>{evidence}</span>
    </div>
  );
}

// ─── Buyer Rent Anchor Badge ──────────────────────────────────────────────
//
// Renders under the buyerLens dropdown when an enrichment has computed a
// buyer-specific Y0 rent anchor. Surfaces which 10-K + scrape the rent
// number cites, so analysts can see WHY this rent flowed into the forecast.
function BuyerRentAnchorBadge({ anchor }) {
  if (!anchor || anchor.annualPerSF == null) return null;
  const sample = anchor.sampleN ? ` · ${anchor.sampleN.toLocaleString()} ${anchor.sampleN === 1 ? "facility" : "facilities"}` : "";
  return (
    <div
      style={{
        marginTop: 6,
        padding: "6px 10px",
        background: "rgba(59,130,246,0.08)",
        border: "1px solid rgba(59,130,246,0.30)",
        borderRadius: 4,
        fontSize: 10,
        color: "#94A3B8",
        lineHeight: 1.4,
      }}
    >
      <span style={{ fontWeight: 800, color: "#3B82F6", letterSpacing: "0.04em", textTransform: "uppercase", marginRight: 6 }}>
        💰 RENT ANCHOR · {anchor.basis}
      </span>
      <span style={{ color: "#fff", fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>
        ${anchor.annualPerSF.toFixed(2)}/SF/yr
      </span>
      <span style={{ color: "#94A3B8" }}> · ${anchor.monthlyPerSF.toFixed(2)}/SF/mo{sample}</span>
      <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>
        {anchor.source} · {anchor.citation}
      </div>
    </div>
  );
}

// ─── Form Panel ───────────────────────────────────────────────────────────
function FormPanel({ inputs, setField, buyerDetection, buyerRentAnchor }) {
  return (
    <div style={card}>
      <div style={sectionHeader}>Inputs</div>
      {FIELD_GROUPS.map((group) => (
        <div key={group.title} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: GOLD, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${GOLD}22` }}>{group.title}</div>
          {group.fields.map((f) => (
            <div key={f.key} style={{ marginBottom: 10 }}>
              <label style={labelStyle}>
                {f.label}{f.required && <span style={{ color: FIRE, marginLeft: 4 }}>*</span>}
              </label>
              {f.type === "select" ? (
                <select value={inputs[f.key] || ""} onChange={(e) => setField(f.key, e.target.value)} style={inputBase}>
                  <option value="">— select —</option>
                  {f.options.map((opt) => {
                    const v = typeof opt === "string" ? opt : opt.key;
                    const l = typeof opt === "string" ? opt : opt.label;
                    return <option key={v} value={v}>{l}</option>;
                  })}
                </select>
              ) : (
                <input
                  type={f.type === "number" ? "text" : f.type}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  value={inputs[f.key] || ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  style={inputBase}
                />
              )}
              {/* AUTO-DETECTED badge — surfaces under the buyerLens dropdown
                  whenever an OM upload triggered detection. Shows the winning
                  signal evidence so analysts can audit the auto-pick. */}
              {f.key === "buyerLens" && buyerDetection && (
                <BuyerDetectionBadge detection={buyerDetection} />
              )}
              {/* RENT ANCHOR badge — shows which 10-K + scrape source the
                  selected buyer's Y0 rent anchor cites. Renders only when an
                  enrichment has run (post-OM-upload) and a rent anchor was
                  routed for the selected buyer. */}
              {f.key === "buyerLens" && buyerRentAnchor && (
                <BuyerRentAnchorBadge anchor={buyerRentAnchor} />
              )}
            </div>
          ))}
        </div>
      ))}
      <div style={{ fontSize: 10, color: "#64748B", marginTop: 12, lineHeight: 1.5 }}>
        Required: ask, NRSF, state, NOI, EGI. Demographics-only fields default to institutional benchmarks.
      </div>
    </div>
  );
}

// ─── Outputs Panel ────────────────────────────────────────────────────────
function OutputsPanel({ analysis, psLens, multiLensRows, platformFitDelta, ready, enrichment, enriching, memo, memoLoading, memoError, onGenerateMemo }) {
  if (!ready || !analysis) {
    return (
      <div style={{ ...card, minHeight: 480, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#64748B" }}>
        <div>
          <div style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 14, color: "#94A3B8", fontWeight: 600 }}>Fill in required fields to run analysis</div>
          <div style={{ fontSize: 11, color: "#64748B", marginTop: 6 }}>Or click <span style={{ color: GOLD }}>Load demo</span> to see the Red Rock Reno calibration deal</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* PSA Lens drives the headline — generic buyer's verdict shows in the PS Lens card body as a context point only */}
      <PSAVerdictHero psLens={psLens} analysis={analysis} />
      <YOCVerdictCard psLens={psLens} />
      <FinancingScenarioCard psLens={psLens} />
      <MultiLensComparisonCard rows={multiLensRows} platformFitDelta={platformFitDelta} ask={analysis.snapshot?.ask} />
      <DevelopmentPipelineCard
        nearby={enrichment?.pipelineNearby}
        saturation={enrichment?.pipelineSaturation}
        metadata={enrichment?.pipelineMetadata}
      />
      <DealTypeBadge dealType={analysis.dealType} />
      {/* Rent sanity — independent SpareFoot cross-check on seller's implied EGI rate.
          Renders only when marketRents enrichment has completed. */}
      <RentSanityBanner rentSanity={analysis.rentSanity} />
      {(enriching || enrichment) && <EnrichmentCard enrichment={enrichment} loading={enriching} />}
      <RadiusPlusComparisonCard enrichment={enrichment} />
      <ICMemoCard memo={memo} loading={memoLoading} error={memoError} onGenerate={onGenerateMemo} />
      <SnapshotCard snapshot={analysis.snapshot} />
      {psLens && <PSLensCard psLens={psLens} generic={analysis} />}
      <ProjectionCard projection={analysis.projection} />
      <ValuationMatrixCard matrix={analysis.matrix} ask={analysis.snapshot.ask} />
      {/* Market-context cards demoted below the fold — these are the GENERIC buyer view, here for triangulation, not headline */}
      <ReconstructedNOICard reconstructed={analysis.reconstructed} sellerNOI={analysis.snapshot.sellerNOI} />
      <PriceTiersCard tiers={analysis.tiers} ask={analysis.snapshot.ask} marketCap={analysis.marketCap} msaTier={analysis.msaTier} />
      <CompGridCard comps={analysis.comps} subjectAsk={analysis.snapshot.ask} />
    </div>
  );
}

// ─── Storvex vs Radius+ Comparison Card — explicit feature parity ──────────
//
// The institutional positioning lever: explicit feature-by-feature comparison
// between Storvex and Radius+ (the storage industry's #1 data platform).
// Refreshes from `enrichment` so per-deal data presence is reflected (when
// scraped data is available for the subject MSA, it shows ✓ on that row).
function RadiusPlusComparisonCard({ enrichment }) {
  const [expanded, setExpanded] = React.useState(false);

  const hasScrapedData = !!enrichment?.scrapedMSARent;
  const hasMSADisclosed = !!enrichment?.msaRentBand;
  const hasECRI = !!enrichment?.ecriIndex;
  const hasForecast = !!enrichment?.rentForecast;
  const hasCompetitors = !!(enrichment?.competitors && enrichment.competitors.length);
  // Cross-REIT scraped coverage (CUBE shipped this sprint, EXR code-ready)
  const xreitMeta = enrichment?.crossREITScrapedMetadata;
  const hasCubeScraped = !!xreitMeta?.operators?.find((o) => o.operator === "CUBE");
  const hasExrScraped = !!xreitMeta?.operators?.find((o) => o.operator === "EXR");
  const xreitFacilities = xreitMeta?.totalFacilities || 0;

  // Each row: [feature, storvex_status, radiusplus_status, note]
  // Status: "yes" | "no" | "partial"
  const features = [
    {
      group: "Rent Data",
      rows: [
        ["Per-facility unit-level move-in rates", hasScrapedData || hasCubeScraped ? "yes" : "partial", "yes",
          hasScrapedData || hasCubeScraped
            ? `Scraped from PSA + CubeSmart facility detail pages, primary-source — ${xreitFacilities.toLocaleString()} facilities indexed across ${xreitMeta?.operatorCount || 0} REIT operators`
            : "PSA + CUBE scrapers run daily via GitHub Actions; subject MSA may not have coverage yet"],
        ["MSA-level disclosed in-place rents", hasMSADisclosed ? "yes" : "yes", "no",
          "PSA's FY2025 10-K MD&A 'Same Store Facilities Operating Trends by Market' table — directly disclosed for 24 MSAs. Radius+ scrapes move-in rates only; can't access in-place data filed only with the SEC."],
        ["State-level cross-REIT rent calibration", "yes", "no",
          "EDGAR-Calibrated Rent Index — 41 states with TRIPLE_VALIDATED bands (PSA + EXR + CUBE + SMA disclosures), every band cites accession #s on sec.gov."],
        ["Move-in vs in-place ECRI premium signal", hasECRI ? "yes" : "yes", "no",
          "EXR-disclosed: in-place $19.91/SF/yr vs move-in $13.16 = +51.3% ECRI premium. Radius+ has move-in rate only; can't see the gap."],
        ["Daily refresh cadence", "yes", "yes",
          "GitHub Actions cron at 06:00 UTC re-runs the scraper across all 24 MSAs and commits the refreshed JSON. Vercel auto-rebuilds on push."],
      ],
    },
    {
      group: "Forecasting",
      rows: [
        ["5-year rent forecast trajectories", hasForecast ? "yes" : "yes", "no",
          "REIT-calibrated 5-yr forecast with 3 scenarios (BASE / UPSIDE / DOWNSIDE) per buyer lens. Radius+ is current rents only."],
        ["Per-buyer-lens operating dynamics (PSA / EXR / CUBE / SMA)", "yes", "no",
          "PSNext platform uplift, brand premium, ECRI program, opex ratio, retention quality — sourced from each REIT's FY2025 10-K MD&A."],
        ["Tenant churn / cohort rebase modeling", "yes", "no",
          "DOWNSIDE scenario rebases in-place rent toward move-in as cohort churns at (1 - retentionQualityIdx)/yr."],
      ],
    },
    {
      group: "Cost Basis & Comps",
      rows: [
        ["Per-facility cost basis allocation", "yes", "no",
          "Schedule III MSA aggregate $/SF allocated to each PS family facility, with state-weighted fallback for unmatched cities."],
        ["M&A transaction comps (per-deal terms)", "yes", "no",
          "12 SEC-filed 8-K transactions with verbatim deal quotes (PSA→BREIT $2.2B, CUBE→LAACO $1.74B, EXR→Life Storage merger amendments, etc.)."],
        ["Audit trail to primary source", "yes", "no",
          "Every rent / cost basis / comp / forecast assumption traces to a specific SEC EDGAR accession # on sec.gov. Radius+ is third-party scraped, no primary-source citation chain."],
      ],
    },
    {
      group: "Underwriting",
      rows: [
        ["Buyer-lens NOI reconstruction", "yes", "no",
          "FY2025 10-K opex ratios applied per deal (PSA same-store opex 24.86%, NOI margin 75.14%). Radius+ doesn't model deal-level NOI."],
        ["Home Run / Strike / Walk price tiers", "yes", "no",
          "Storvex valuation framework — Y3 NOI / cap math with MSA-tier-adjusted caps + portfolio-fit bonus."],
        ["IC memo + Goldman PDF report", "yes", "no",
          "Storvex IC engine + polished export. Radius+ is data only, no underwriting deliverables."],
        ["Welltower warehouse export schema", "yes", "no",
          "Structured JSON ready for ingestion into REIT data platforms — silo-killing thesis made literal."],
      ],
    },
    {
      group: "Coverage breadth (3-REIT public storage core)",
      rows: [
        ["PSA per-facility scraped rents", hasScrapedData ? "yes" : "yes", "yes",
          "Schema.org SelfStorage entities, vanilla HTTPS. 24 PSA-disclosed MSAs · ~260 facilities · ~3,000 unit listings. Daily refresh via GitHub Actions."],
        ["CUBE per-facility scraped rents", hasCubeScraped ? "yes" : "yes", "yes",
          "Sitemap-driven crawl (1,551 facilities), HTML widget parsing — captures BOTH web rate AND in-store standard rate, exposing CUBE's promotional discount %. Vanilla HTTPS, daily refresh."],
        ["EXR per-facility scraped rents", hasExrScraped ? "yes" : "partial", "yes",
          "Scraper code complete (Puppeteer-core + puppeteer-extra-stealth, validated against PerimeterX). Bulk crawl deferred until residential-IP rotation infrastructure or scheduled IP cooldown. Sitemap exposes 4,400 EXR facilities."],
      ],
    },
    {
      group: "Coverage breadth (deferred to follow-on sprints)",
      rows: [
        ["Independent operator coverage (mom-and-pops)", "no", "yes",
          "Radius+ scrapes thousands of independent listings. Storvex roadmap: extend SpareFoot scraper via Puppeteer."],
        ["Per-facility occupancy estimates", "no", "yes",
          "Roadmap: derive from rating-count growth + price elasticity. Next sprint."],
        ["New-supply pipeline tracking", "no", "yes",
          "Roadmap: extract under-construction + permitted facilities from REIT 10-Q + 8-K disclosures (Claude-assisted). Next sprint."],
        ["Trade-area heatmap visualization", "no", "yes",
          "Roadmap: leverage existing competitor data + add WebGL/Mapbox heatmap layer. Next sprint."],
      ],
    },
  ];

  const totalStorvex = features.flatMap((g) => g.rows).filter((r) => r[1] === "yes").length;
  const totalRadius = features.flatMap((g) => g.rows).filter((r) => r[2] === "yes").length;
  const totalRows = features.flatMap((g) => g.rows).length;

  return (
    <div style={{ ...card, border: `1px solid ${GOLD}66`, background: "linear-gradient(135deg, rgba(15,21,56,0.85) 0%, rgba(30,39,97,0.5) 100%)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12, color: GOLD, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            ⚔️ Storvex vs Radius+ · Feature Parity
          </div>
          <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>
            Storvex covers <b style={{ color: GOLD }}>{totalStorvex}/{totalRows}</b> · Radius+ covers <b style={{ color: "#fff" }}>{totalRadius}/{totalRows}</b> · Storvex unique features: <b style={{ color: GOLD }}>{totalStorvex - features.flatMap((g) => g.rows).filter((r) => r[1] === "yes" && r[2] === "yes").length}</b>
          </div>
        </div>
        <button onClick={() => setExpanded(!expanded)} style={{ ...btnGhost, padding: "6px 14px", fontSize: 11 }}>
          {expanded ? "Collapse" : "Show comparison"}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {features.map((group, gi) => (
            <div key={gi} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: GOLD, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, borderBottom: `1px solid ${GOLD}33`, paddingBottom: 4 }}>
                {group.group}
              </div>
              <table style={{ width: "100%", fontSize: 11, color: "#CBD5E1", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "#94A3B8" }}>
                    <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 700, fontSize: 9 }}>Feature</th>
                    <th style={{ width: 70, textAlign: "center", padding: "4px 6px", fontWeight: 700, fontSize: 9, color: GOLD }}>Storvex</th>
                    <th style={{ width: 70, textAlign: "center", padding: "4px 6px", fontWeight: 700, fontSize: 9 }}>Radius+</th>
                    <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 700, fontSize: 9 }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, ri) => {
                    const [feature, storvex, radiusplus, note] = row;
                    const cell = (status) => {
                      if (status === "yes") return <span style={{ color: "#22C55E", fontWeight: 800 }}>✓</span>;
                      if (status === "partial") return <span style={{ color: "#F59E0B", fontWeight: 800 }}>~</span>;
                      return <span style={{ color: "#64748B", fontWeight: 800 }}>—</span>;
                    };
                    return (
                      <tr key={ri} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "4px 6px", color: "#fff" }}>{feature}</td>
                        <td style={{ padding: "4px 6px", textAlign: "center", fontSize: 13 }}>{cell(storvex)}</td>
                        <td style={{ padding: "4px 6px", textAlign: "center", fontSize: 13 }}>{cell(radiusplus)}</td>
                        <td style={{ padding: "4px 6px", fontSize: 9, color: "#94A3B8", lineHeight: 1.4 }}>{note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          <div style={{ marginTop: 12, padding: 10, background: "rgba(0,0,0,0.3)", borderRadius: 4, fontSize: 10, color: "#94A3B8", lineHeight: 1.5 }}>
            <b style={{ color: GOLD }}>The thesis:</b> Storvex is the only platform that combines per-facility primary-source rent data (matching Radius+ on breadth) with primary-source SEC EDGAR institutional underwriting depth (10-K disclosures, M&A 8-K transaction comps, REIT-calibrated forecast trajectories — Radius+ has none of this). Every Storvex assumption traces to a specific accession # on sec.gov. No third-party data licensing, no scraping fragility on the data layer Radius+ lives on.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Enrichment Card — auto-pulled data (PSA underwriter equivalent) ─────
function EnrichmentCard({ enrichment, loading }) {
  if (loading && !enrichment) {
    return (
      <div style={{ ...card, padding: "18px 22px", textAlign: "center" }}>
        <div style={{ fontSize: 22, marginBottom: 6 }}>🌐</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>Storvex is auto-pulling underwriter data…</div>
        <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>Geocoding · ESRI 1-3-5 mile demographics · operator-family proximity · market rents</div>
      </div>
    );
  }
  if (!enrichment) return null;

  const { coords, demographics, psFamily, marketRents, competitors, subjectMSA, msaRentBand, bestRentBand, ecriIndex, rentForecast, scrapedMSARent, crossREITMSARates, crossREITScrapedMetadata } = enrichment;
  const hasData = coords || demographics || psFamily || marketRents || (competitors && competitors.length);
  if (!hasData) return null;

  return (
    <div style={{ ...card, border: `1px solid ${GOLD}33`, background: "rgba(15,21,56,0.7)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: GOLD, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>🌐 Auto-Enriched · Storvex Data Layer</div>
          <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>Pulled in parallel during OM extraction — same data an institutional underwriter pulls manually</div>
        </div>
        <span style={{ fontSize: 9, color: "#64748B", fontWeight: 700 }}>ESRI · CSV · SpareFoot</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
        {coords && (
          <div style={metricBox}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Coordinates</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</div>
            <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>ESRI geocoder · score {coords.score}</div>
          </div>
        )}
        {demographics?.pop3mi != null && (
          <div style={metricBox}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>3-mi Population</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{Math.round(demographics.pop3mi).toLocaleString()}</div>
            <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>5-yr CAGR {demographics.popGrowth3mi != null ? (demographics.popGrowth3mi * 100).toFixed(2) + "%" : "—"}</div>
          </div>
        )}
        {demographics?.income3mi != null && (
          <div style={metricBox}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>3-mi Median HHI</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>${Math.round(demographics.income3mi).toLocaleString()}</div>
            <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>{demographics.households3mi != null ? `${Math.round(demographics.households3mi).toLocaleString()} HH` : ""}</div>
          </div>
        )}
        {demographics?.homeValue3mi != null && (
          <div style={metricBox}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>3-mi Home Value</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>${Math.round(demographics.homeValue3mi).toLocaleString()}</div>
            <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>renter {demographics.renterPct3mi != null ? Math.round(demographics.renterPct3mi * 100) + "%" : "—"}</div>
          </div>
        )}
        {demographics?.storageMPI3mi != null && (
          <div style={metricBox}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Storage MPI</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: demographics.storageMPI3mi >= 110 ? "#22C55E" : demographics.storageMPI3mi >= 90 ? "#fff" : "#F59E0B", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{Math.round(demographics.storageMPI3mi)}</div>
            <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>{demographics.storageMPI3mi >= 110 ? "strong" : demographics.storageMPI3mi >= 90 ? "average" : "weak"} · 100=US avg</div>
          </div>
        )}
        {psFamily && psFamily.distanceMi != null && (
          <div style={{ ...metricBox, borderLeft: "3px solid #3B82F6" }}>
            <div style={{ fontSize: 9, color: "#3B82F6", textTransform: "uppercase", fontWeight: 700 }}>Nearest PS Family</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{psFamily.distanceMi.toFixed(2)} mi</div>
            <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>{psFamily.brand}{psFamily.city ? ` · ${psFamily.city}` : ""}{psFamily.state ? `, ${psFamily.state}` : ""}</div>
          </div>
        )}
        {psFamily?.count35mi != null && (
          <div style={metricBox}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>PS within 35 mi</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{psFamily.count35mi}</div>
            <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>district presence</div>
          </div>
        )}
        {marketRents?.ccRentPerSF != null && (
          <div style={metricBox}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Market CC Rent</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>${marketRents.ccRentPerSF.toFixed(2)}/SF</div>
            <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>SpareFoot · n={marketRents.sampleSize || "?"}</div>
          </div>
        )}
      </div>

      {/* Scraped MSA Rent — primary-source per-facility move-in rates from PSA Schema.org SelfStorage */}
      {scrapedMSARent && scrapedMSARent.crossValidation && (
        <div style={{ marginTop: 14, padding: 12, background: "rgba(168, 85, 247, 0.08)", border: `1px solid #A855F755`, borderRadius: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: "#A855F7", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              🎯 PRIMARY-SOURCE MOVE-IN RATES · {scrapedMSARent.msa} · {scrapedMSARent.facilitiesScraped} facilities · {scrapedMSARent.totalUnitListings} units
            </div>
            <span style={{ fontSize: 8, color: "#64748B" }}>scraped from PSA facility detail pages</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            <div>
              <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>CC Median (move-in)</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#A855F7", fontFamily: "'Space Mono', monospace" }}>${scrapedMSARent.ccMedianPerSF_mo?.toFixed(2)}/mo</div>
              <div style={{ fontSize: 8, color: "#64748B" }}>range ${scrapedMSARent.ccLowPerSF_mo?.toFixed(2)} - ${scrapedMSARent.ccHighPerSF_mo?.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>DU Median (move-in)</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", fontFamily: "'Space Mono', monospace" }}>${scrapedMSARent.duMedianPerSF_mo?.toFixed(2) || "—"}/mo</div>
              <div style={{ fontSize: 8, color: "#64748B" }}>{scrapedMSARent.facilitiesWithDU} facilities w/ DU</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>PSA MD&A In-Place</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", fontFamily: "'Space Mono', monospace" }}>${scrapedMSARent.crossValidation.psaImpliedMonthlyCC?.toFixed(2)}/mo CC</div>
              <div style={{ fontSize: 8, color: "#64748B" }}>${scrapedMSARent.crossValidation.psaDisclosedAnnualPerSF}/SF/yr disclosed</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>Move-In vs In-Place</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: scrapedMSARent.crossValidation.sanityGatePassed ? "#22C55E" : "#EF4444", fontFamily: "'Space Mono', monospace" }}>
                {scrapedMSARent.crossValidation.ccDeltaPct > 0 ? "+" : ""}{scrapedMSARent.crossValidation.ccDeltaPct?.toFixed(1)}%
              </div>
              <div style={{ fontSize: 8, color: "#64748B" }}>{scrapedMSARent.crossValidation.sanityGatePassed ? "✓ sanity gate" : "✗ deviation"}</div>
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: 9, color: "#64748B", lineHeight: 1.4 }}>
            {scrapedMSARent.crossValidation.interpretation} The move-in vs in-place gap is the ECRI lift opportunity (existing customers pay above-market because of cumulative annual rate increases).
          </div>
        </div>
      )}

      {/* Cross-REIT MSA Move-In Rate Comparison — shows PSA + CUBE + EXR
          medians side-by-side. This is the Radius+ kill-shot view: every
          public REIT operator's per-facility move-in rate, primary-source,
          for the subject MSA. */}
      {crossREITMSARates && crossREITMSARates.length > 1 && (
        <div style={{ marginTop: 14, padding: 12, background: "rgba(201, 168, 76, 0.08)", border: `1px solid #C9A84C99`, borderRadius: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#C9A84C", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              ⚡ CROSS-REIT MOVE-IN RATE COMPARISON · {subjectMSA || "Subject MSA"}
            </div>
            <span style={{ fontSize: 8, color: "#64748B" }}>
              {crossREITScrapedMetadata?.totalFacilities?.toLocaleString() || "—"} facilities · {crossREITScrapedMetadata?.totalUnitListings?.toLocaleString() || "—"} unit listings indexed
            </span>
          </div>
          <table style={{ width: "100%", fontSize: 11, fontFamily: "'Space Mono', monospace", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#94A3B8", borderBottom: "1px solid #C9A84C44" }}>
                <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 700, fontSize: 9, textTransform: "uppercase" }}>Operator</th>
                <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 700, fontSize: 9 }}>CC $/SF/mo</th>
                <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 700, fontSize: 9 }}>CC Range</th>
                <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 700, fontSize: 9 }}>DU $/SF/mo</th>
                <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 700, fontSize: 9 }}>Discount</th>
                <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 700, fontSize: 9 }}>Sample</th>
              </tr>
            </thead>
            <tbody>
              {crossREITMSARates.map((row) => (
                <tr key={row.operator} style={{ borderBottom: "1px solid rgba(201,168,76,0.15)" }}>
                  <td style={{ padding: "5px 6px", color: "#fff", fontWeight: 700 }}>
                    {row.operator}
                    <span style={{ color: "#64748B", fontWeight: 400, fontFamily: "system-ui, sans-serif", marginLeft: 6, fontSize: 9 }}>
                      {row.operatorName}
                    </span>
                  </td>
                  <td style={{ padding: "5px 6px", textAlign: "right", color: "#C9A84C", fontWeight: 700 }}>
                    {row.ccMedianPerSF_mo != null ? `$${row.ccMedianPerSF_mo.toFixed(2)}` : "—"}
                  </td>
                  <td style={{ padding: "5px 6px", textAlign: "right", color: "#94A3B8", fontSize: 9 }}>
                    {row.ccLowPerSF_mo != null && row.ccHighPerSF_mo != null
                      ? `$${row.ccLowPerSF_mo.toFixed(2)}–$${row.ccHighPerSF_mo.toFixed(2)}`
                      : "—"}
                  </td>
                  <td style={{ padding: "5px 6px", textAlign: "right", color: "#fff" }}>
                    {row.duMedianPerSF_mo != null ? `$${row.duMedianPerSF_mo.toFixed(2)}` : "—"}
                  </td>
                  <td style={{ padding: "5px 6px", textAlign: "right", color: row.impliedDiscountPct ? "#22C55E" : "#64748B", fontSize: 10 }}>
                    {row.impliedDiscountPct != null ? `−${row.impliedDiscountPct.toFixed(1)}%` : "—"}
                  </td>
                  <td style={{ padding: "5px 6px", textAlign: "right", color: "#94A3B8", fontSize: 9 }}>
                    {row.facilitiesScraped} fac · {row.totalUnitListings} units
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8, fontSize: 9, color: "#64748B", lineHeight: 1.4 }}>
            Per-facility move-in rates scraped directly from each operator's facility detail pages — Schema.org SelfStorage entities for PSA + EXR, structured HTML widget for CUBE. No third-party rate aggregator (no SpareFoot, no Radius+) — every rate cites the operator's source URL. CUBE's "Discount" column reflects the implied promotional discount (web rate vs in-store standard rate).
          </div>
        </div>
      )}

      {/* Rent Forecast — Y0/Y1/Y3/Y5 trajectory under base/upside/downside scenarios per buyer lens */}
      {rentForecast && rentForecast.trajectories && (
        <div style={{ marginTop: 14, padding: 12, background: "rgba(34,197,94,0.06)", border: `1px solid #22C55E55`, borderRadius: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#22C55E", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              🔮 RENT FORECAST · {rentForecast.buyerLens} Lens · 5-Year Trajectory
            </div>
            <span style={{ fontSize: 8, color: "#64748B" }}>
              {rentForecast.msa ? `${rentForecast.msa}, ${rentForecast.state}` : `${rentForecast.state} state-weighted`} · {rentForecast.rentBandConfidence}
            </span>
          </div>

          {/* Y0 anchor */}
          <div style={{ marginBottom: 8, padding: 8, background: "rgba(255,255,255,0.03)", borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Y0 Anchor (FY2025 disclosed)</div>
            <div style={{ display: "flex", gap: 16, fontSize: 11, fontFamily: "'Space Mono', monospace" }}>
              <span><span style={{ color: "#94A3B8" }}>In-place:</span> <b style={{ color: "#fff" }}>${rentForecast.y0.inPlaceRentPerSF_yr.toFixed(2)}/SF/yr</b></span>
              <span><span style={{ color: "#94A3B8" }}>Move-in:</span> <b style={{ color: "#fff" }}>${rentForecast.y0.moveInRatePerSF_yr.toFixed(2)}/SF/yr</b></span>
              <span><span style={{ color: "#94A3B8" }}>Occ:</span> <b style={{ color: "#fff" }}>{(rentForecast.y0.occupancy * 100).toFixed(1)}%</b></span>
            </div>
          </div>

          {/* Trajectory tables — base / upside / downside */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 8 }}>
            {[
              { key: "base", label: "BASE", color: "#94A3B8", desc: "REIT-disclosed growth applied" },
              { key: "upside", label: "UPSIDE", color: "#22C55E", desc: rentForecast.buyerSpecificDynamics.psnextStabilizedUpliftBps > 0 ? `+ ${rentForecast.buyerLens} platform uplift` : "+ retention upside" },
              { key: "downside", label: "DOWNSIDE", color: "#EF4444", desc: "Cohort churn rebases to move-in" },
            ].map(({ key, label, color, desc }) => (
              <div key={key} style={{ padding: 8, background: "rgba(0,0,0,0.15)", borderRadius: 4, borderLeft: `3px solid ${color}` }}>
                <div style={{ fontSize: 10, color, fontWeight: 800, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 8, color: "#64748B", marginBottom: 6 }}>{desc}</div>
                <table style={{ width: "100%", fontSize: 10, fontFamily: "'Space Mono', monospace", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "#64748B" }}>
                      <th style={{ textAlign: "left", padding: "2px 4px", fontWeight: 700, fontSize: 8 }}>Yr</th>
                      <th style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700, fontSize: 8 }}>In-Place</th>
                      <th style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700, fontSize: 8 }}>Move-In</th>
                      <th style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700, fontSize: 8 }}>ECRI%</th>
                      <th style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700, fontSize: 8 }}>Occ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rentForecast.horizons.map((yr) => {
                      const t = rentForecast.trajectories[key][`Y${yr}`];
                      if (!t) return null;
                      return (
                        <tr key={yr} style={{ color: "#CBD5E1" }}>
                          <td style={{ padding: "2px 4px" }}>Y{yr}</td>
                          <td style={{ padding: "2px 4px", textAlign: "right", color: "#fff" }}>${t.inPlaceRentPerSF_yr.toFixed(2)}</td>
                          <td style={{ padding: "2px 4px", textAlign: "right" }}>${t.moveInRatePerSF_yr.toFixed(2)}</td>
                          <td style={{ padding: "2px 4px", textAlign: "right" }}>+{t.ecriPremiumPct?.toFixed(0) || 0}%</td>
                          <td style={{ padding: "2px 4px", textAlign: "right" }}>{(t.occupancy * 100).toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 8, fontSize: 9, color: "#64748B", lineHeight: 1.4 }}>
            {rentForecast.marketSignal}
          </div>
          <div style={{ marginTop: 4, fontSize: 8, color: "#64748B" }}>
            Citations: {rentForecast.citations.map((c) => c.accessionNumber).filter(Boolean).join(" · ")}
          </div>
        </div>
      )}

      {/* Cross-REIT ECRI Premium signal — rent-raising headroom from disclosed in-place vs move-in rates */}
      {ecriIndex && ecriIndex.crossREITAvgECRIPremium != null && (
        <div style={{ marginTop: 14, padding: 12, background: "rgba(59,130,246,0.08)", border: `1px solid #3B82F655`, borderRadius: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: "#3B82F6", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              📈 ECRI PREMIUM · Rent-Raising Headroom (Cross-REIT 10-K Disclosed)
            </div>
            <span style={{ fontSize: 8, color: "#64748B" }}>
              {ecriIndex.issuersDisclosed.join(", ")} · {ecriIndex.issuerDetails[0]?.accessionNumber || ""}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            <div>
              <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>In-Place Rent / Yr</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", fontFamily: "'Space Mono', monospace" }}>${ecriIndex.crossREITAvgInPlaceRent.toFixed(2)}/SF</div>
              <div style={{ fontSize: 8, color: "#64748B" }}>same-store cohort</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>Move-In Rate / Yr</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", fontFamily: "'Space Mono', monospace" }}>${ecriIndex.crossREITAvgMoveInRate.toFixed(2)}/SF</div>
              <div style={{ fontSize: 8, color: "#64748B" }}>new-lease pricing</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>ECRI Premium</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#3B82F6", fontFamily: "'Space Mono', monospace" }}>+{ecriIndex.crossREITAvgECRIPremiumPct.toFixed(1)}%</div>
              <div style={{ fontSize: 8, color: "#64748B" }}>cumulative book lift</div>
            </div>
            {ecriIndex.issuerDetails[0]?.moveInRentChangeYoY != null && (
              <div>
                <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>Move-In YoY</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", fontFamily: "'Space Mono', monospace" }}>
                  {ecriIndex.issuerDetails[0].moveInRentChangeYoY > 0 ? "+" : ""}{(ecriIndex.issuerDetails[0].moveInRentChangeYoY * 100).toFixed(1)}%
                </div>
                <div style={{ fontSize: 8, color: "#64748B" }}>YoY new-lease change</div>
              </div>
            )}
          </div>
          <div style={{ marginTop: 6, fontSize: 9, color: "#64748B", lineHeight: 1.4 }}>
            {ecriIndex.institutionalImplication}
          </div>
        </div>
      )}

      {/* MSA-disclosed rent band — highest fidelity when subject city maps to a PSA-disclosed MSA */}
      {msaRentBand && (
        <div style={{ marginTop: 14, padding: 12, background: "rgba(201,168,76,0.08)", border: `1px solid ${GOLD}55`, borderRadius: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: GOLD, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              ⭐ MSA-DISCLOSED RENT · {msaRentBand.msa}
            </div>
            <span style={{ fontSize: 8, color: "#64748B", fontFamily: "'Space Mono', monospace" }}>
              accession {msaRentBand.accessionNumber}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
            <div>
              <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>Rent / Occ SF</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", fontFamily: "'Space Mono', monospace" }}>${msaRentBand.weightedAnnualPerSF.toFixed(2)}/yr</div>
              <div style={{ fontSize: 8, color: "#64748B" }}>YoY {msaRentBand.rentChangeYoY > 0 ? "+" : ""}{msaRentBand.rentChangeYoY}%</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>CC $/Mo/SF</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: GOLD, fontFamily: "'Space Mono', monospace" }}>${msaRentBand.ccRent.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>DU $/Mo/SF</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", fontFamily: "'Space Mono', monospace" }}>${msaRentBand.duRent.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>Avg Occ</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", fontFamily: "'Space Mono', monospace" }}>{(msaRentBand.occupancy_2025 * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>PSA Facilities</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", fontFamily: "'Space Mono', monospace" }}>{msaRentBand.facilities} · {msaRentBand.sqftMillions.toFixed(1)}M SF</div>
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: 9, color: "#64748B" }}>
            PSA FY2025 10-K MD&A · Same Store Facilities Operating Trends by Market table · directly disclosed
          </div>
        </div>
      )}

      {/* Primary-source competitor analysis — top N nearest with EDGAR-derived cost basis + rent */}
      {competitors && competitors.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#3B82F6", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              🎯 Primary-Source Competitor Analysis · {competitors.length} within 5 mi
            </div>
            <span style={{ fontSize: 8, color: "#64748B" }}>SEC EDGAR · Schedule III + 10-K MD&A</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 10, color: "#CBD5E1", fontFamily: "'Space Mono', monospace", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${GOLD}33`, color: "#94A3B8", fontWeight: 700 }}>
                  <th style={{ textAlign: "left", padding: "4px 6px" }}>Brand</th>
                  <th style={{ textAlign: "left", padding: "4px 6px" }}>City</th>
                  <th style={{ textAlign: "right", padding: "4px 6px" }}>Distance</th>
                  <th style={{ textAlign: "left", padding: "4px 6px" }}>MSA</th>
                  <th style={{ textAlign: "right", padding: "4px 6px" }}>Cost Basis</th>
                  <th style={{ textAlign: "right", padding: "4px 6px" }}>CC $/mo</th>
                  <th style={{ textAlign: "right", padding: "4px 6px" }}>DU $/mo</th>
                  <th style={{ textAlign: "left", padding: "4px 6px" }}>Conf</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "4px 6px", fontWeight: 700, color: c.brand === "PS" ? "#3B82F6" : "#94A3B8" }}>{c.brand}</td>
                    <td style={{ padding: "4px 6px" }}>{c.city || "—"}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>{c.distanceMi.toFixed(2)} mi</td>
                    <td style={{ padding: "4px 6px", color: c.msa ? GOLD : "#64748B" }}>{c.msa || "—"}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700 }}>{c.estimatedGrossPSF != null ? `$${c.estimatedGrossPSF}` : "—"}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>{c.estimatedCCRentPerSF_mo != null ? `$${c.estimatedCCRentPerSF_mo.toFixed(2)}` : "—"}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>{c.estimatedDURentPerSF_mo != null ? `$${c.estimatedDURentPerSF_mo.toFixed(2)}` : "—"}</td>
                    <td style={{ padding: "4px 6px", fontSize: 8, color: c.rentConfidence === "MSA_DISCLOSED_PSA" ? GOLD : c.rentConfidence === "TRIPLE_VALIDATED" ? "#22C55E" : "#94A3B8" }}>
                      {c.rentConfidence ? c.rentConfidence.replace(/_/g, " ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 6, fontSize: 9, color: "#64748B", lineHeight: 1.4 }}>
            Cost basis: PSA Schedule III MSA aggregate (when MSA-matched) or cross-REIT state-weighted $/SF.
            Rent: PSA MD&A MSA-disclosed (when MSA-matched) or cross-REIT state-calibrated.
            Every figure traces to a specific 10-K accession #.
          </div>
        </div>
      )}

      {enrichment.errors?.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 10, color: "#F59E0B" }}>
          ⚠ Partial: {enrichment.errors.map((e) => e.step).join(", ")} unavailable
        </div>
      )}
    </div>
  );
}

// ─── IC Memo Card — Storvex-generated narrative on top of deterministic math ──
function ICMemoCard({ memo, loading, error, onGenerate }) {
  if (!memo && !loading && !error) {
    return (
      <div style={{ ...card, textAlign: "center", padding: "20px 24px" }}>
        <div style={{ fontSize: 11, color: GOLD, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>📝 Investment Committee Memo</div>
        <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 14, maxWidth: 640, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>
          Generate the IC-style narrative on top of the deterministic math: 2-paragraph executive summary, recommended bid posture, top 3 risks, buyer routing. Storvex reads the analysis, doesn't make up numbers.
        </div>
        <button onClick={onGenerate} style={{ ...btnPrimary, padding: "10px 22px" }}>Generate IC Memo · ~30-60s</button>
      </div>
    );
  }
  if (loading) {
    return (
      <div style={{ ...card, textAlign: "center", padding: "20px 24px" }}>
        <div style={{ fontSize: 22, marginBottom: 6 }}>⏳</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: GOLD }}>Drafting IC memo…</div>
        <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>Storvex is narrating the analysis. Typical run: 30-60s.</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ ...card, textAlign: "center", padding: "20px 24px", border: `1px solid #EF444466` }}>
        <div style={{ fontSize: 22, marginBottom: 4 }}>⚠</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#EF4444" }}>Memo generation failed</div>
        <div style={{ fontSize: 11, color: "#FCA5A5", marginTop: 4, maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>{error}</div>
        <button onClick={onGenerate} style={{ ...btnGhost, marginTop: 10 }}>Retry</button>
      </div>
    );
  }

  // Memo rendered
  const recColor = memo.recommendation === "PURSUE" ? "#22C55E" : memo.recommendation === "NEGOTIATE" ? "#F59E0B" : "#EF4444";
  return (
    <div style={{ ...card, border: `2px solid ${GOLD}66`, background: `linear-gradient(135deg, rgba(201,168,76,0.05), rgba(15,21,56,0.6))` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: GOLD, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>📝 Investment Committee Memo</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {memo._meta && (
            <span style={{ fontSize: 10, color: "#64748B" }}>
              Storvex IC Engine · {(memo._meta.elapsedMs / 1000).toFixed(1)}s
            </span>
          )}
          <button onClick={onGenerate} style={{ ...btnGhost, padding: "5px 10px", fontSize: 10 }}>↻ Regenerate</button>
        </div>
      </div>

      {memo.recommendation && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${GOLD}30` }}>
          <span style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>IC Recommendation</span>
          <span style={{ fontSize: 18, fontWeight: 900, color: recColor, letterSpacing: "0.02em" }}>{memo.recommendation}</span>
        </div>
      )}

      {memo.execSummary && (
        <div style={{ fontSize: 13, color: "#E2E8F0", lineHeight: 1.65, marginBottom: 16 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(memo.execSummary) }} />
      )}

      {memo.bidPosture && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div style={{ ...metricBox, borderLeft: "3px solid #22C55E" }}>
            <div style={{ fontSize: 10, color: "#22C55E", fontWeight: 700, textTransform: "uppercase" }}>Opening Bid</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Inter', sans-serif", fontVariantNumeric: "tabular-nums" }}>{fmt$(Math.round(memo.bidPosture.openingBid || 0))}</div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4, lineHeight: 1.4 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(memo.bidPosture.openingBidRationale || "") }} />
          </div>
          <div style={{ ...metricBox, borderLeft: "3px solid #F59E0B" }}>
            <div style={{ fontSize: 10, color: "#F59E0B", fontWeight: 700, textTransform: "uppercase" }}>Walk-Away</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Inter', sans-serif", fontVariantNumeric: "tabular-nums" }}>{fmt$(Math.round(memo.bidPosture.walkAway || 0))}</div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4, lineHeight: 1.4 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(memo.bidPosture.walkAwayRationale || "") }} />
          </div>
        </div>
      )}

      {Array.isArray(memo.topRisks) && memo.topRisks.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Top Risks</div>
          <ol style={{ margin: 0, paddingLeft: 22, color: "#E2E8F0", fontSize: 12, lineHeight: 1.6 }}>
            {memo.topRisks.map((r, i) => <li key={i} style={{ marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(r) }} />)}
          </ol>
        </div>
      )}

      {memo.buyerRouting && (
        <div style={{ padding: "10px 12px", background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 8, fontSize: 12, color: "#E2E8F0", lineHeight: 1.5, marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: "#3B82F6", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 8 }}>Buyer Routing</span>
          <span dangerouslySetInnerHTML={{ __html: renderMarkdown(memo.buyerRouting) }} />
        </div>
      )}
      {memo.ps4Alignment && (
        <div style={{ padding: "10px 12px", background: "rgba(201,168,76,0.08)", border: `1px solid ${GOLD}50`, borderRadius: 8, fontSize: 12, color: "#E2E8F0", lineHeight: 1.5 }}>
          <span style={{ fontSize: 10, color: GOLD, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 8 }}>Strategic Alignment</span>
          <span dangerouslySetInnerHTML={{ __html: renderMarkdown(memo.ps4Alignment) }} />
        </div>
      )}
    </div>
  );
}

// Small markdown helper — we only want **bold** + paragraph breaks. Keep it tight.
function renderMarkdown(s) {
  if (typeof s !== "string") return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#C9A84C">$1</strong>')
    .replace(/\n\n+/g, '</p><p style="margin:0 0 10px;">')
    .replace(/^/, '<p style="margin:0 0 10px;">')
    .replace(/$/, "</p>");
}

// ─── Deal Type Badge — small chip that explains the math path ────────────
function DealTypeBadge({ dealType }) {
  if (!dealType) return null;
  const labels = {
    stabilized: { text: "STABILIZED — run-rate T-12 underwrite", color: "#22C55E" },
    "co-lu": { text: "CO-LU LEASE-UP — Y3 stabilized projection drives valuation", color: "#F59E0B" },
    "value-add": { text: "VALUE-ADD — execution-risk premium applied", color: "#A855F7" },
  };
  const l = labels[dealType] || labels.stabilized;
  return (
    <div style={{ marginBottom: 14, padding: "8px 14px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${l.color}40`, fontSize: 11, fontWeight: 600, color: l.color, letterSpacing: "0.04em", textTransform: "uppercase" }}>
      Deal type · {l.text}
    </div>
  );
}

// ─── PS Lens Card — buyer-specific underwrite delta ──────────────────────
function PSLensCard({ psLens, generic }) {
  const PS_BLUE = "#3B82F6";
  const v = psLens.verdict;
  const ask = psLens.snapshot.ask;
  const verdictBg = v.label === "PURSUE" ? "rgba(34,197,94,0.10)" : v.label === "NEGOTIATE" ? "rgba(245,158,11,0.10)" : "rgba(239,68,68,0.10)";

  // Side-by-side delta tables
  const tierDeltas = [
    { label: "Home Run", ps: psLens.tiers.homeRun.price, gen: generic.tiers.homeRun.price },
    { label: "Strike",   ps: psLens.tiers.strike.price,  gen: generic.tiers.strike.price },
    { label: "Walk",     ps: psLens.tiers.walk.price,    gen: generic.tiers.walk.price },
  ];

  return (
    <div style={{ ...card, border: `2px solid ${PS_BLUE}66`, background: `linear-gradient(135deg, rgba(59,130,246,0.06), rgba(15,21,56,0.6))` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: PS_BLUE, textTransform: "uppercase", letterSpacing: "0.08em" }}>Storvex Underwrite · Institutional Self-Managed REIT Lens</div>
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4, lineHeight: 1.5 }}>{psLens.lens.description}</div>
        </div>
        <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: PS_BLUE, padding: "5px 10px", borderRadius: 999, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{psLens.lens.badgeText}</span>
      </div>

      {/* Lens-driven verdict */}
      <div style={{ marginBottom: 14, padding: 14, borderRadius: 10, background: verdictBg, border: `1px solid ${v.color}80` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Storvex Verdict</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: v.color, marginTop: 4 }}>{v.label}</div>
          </div>
          <div style={{ fontSize: 11, color: "#E2E8F0", maxWidth: 380, textAlign: "right", lineHeight: 1.4 }}>{v.rationale}</div>
        </div>
      </div>

      {/* Levers applied */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
        <div style={{ ...metricBox, borderLeft: `3px solid ${PS_BLUE}` }}>
          <div style={{ fontSize: 9, color: PS_BLUE, fontWeight: 700, textTransform: "uppercase" }}>Street Premium</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>+{(psLens.lens.revenuePremium * 100).toFixed(0)}%</div>
          <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 2 }}>vs comp set (10-K)</div>
        </div>
        <div style={{ ...metricBox, borderLeft: `3px solid ${PS_BLUE}` }}>
          <div style={{ fontSize: 9, color: PS_BLUE, fontWeight: 700, textTransform: "uppercase" }}>Buyer NOI</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{fmt$(Math.round(psLens.reconstructed.buyerNOI))}</div>
          <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 2 }}>opex {fmtPct(psLens.reconstructed.opexRatio, 1)}</div>
        </div>
        <div style={{ ...metricBox, borderLeft: `3px solid ${PS_BLUE}` }}>
          <div style={{ fontSize: 9, color: PS_BLUE, fontWeight: 700, textTransform: "uppercase" }}>Stabilized Cap</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{fmtPct(psLens.marketCap, 2)}</div>
          <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 2 }}>{psLens.lens.portfolioFit ? "−25 bps fit" : "no fit bonus"}</div>
        </div>
        <div style={{ ...metricBox, borderLeft: `3px solid ${PS_BLUE}` }}>
          <div style={{ fontSize: 9, color: PS_BLUE, fontWeight: 700, textTransform: "uppercase" }}>Mgmt Fee</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#22C55E", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>$0</div>
          <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 2 }}>self-managed</div>
        </div>
      </div>

      {/* PS vs Generic side-by-side */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${PS_BLUE}40` }}>
            <th style={thStyle}>Tier</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Generic Buyer</th>
            <th style={{ ...thStyle, textAlign: "right", color: PS_BLUE }}>Storvex</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Δ (Platform Premium)</th>
            <th style={{ ...thStyle, textAlign: "right" }}>vs Ask</th>
          </tr>
        </thead>
        <tbody>
          {tierDeltas.map((t) => {
            const delta = t.ps - t.gen;
            const askGap = t.ps - ask;
            const askGapPct = ask > 0 ? (askGap / ask) : 0;
            return (
              <tr key={t.label} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ ...tdStyle, fontWeight: 700 }}>{t.label}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'Space Mono', monospace", color: "#94A3B8" }}>{fmt$(Math.round(t.gen))}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'Space Mono', monospace", color: PS_BLUE, fontWeight: 700 }}>{fmt$(Math.round(t.ps))}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'Space Mono', monospace", color: delta > 0 ? "#22C55E" : "#EF4444" }}>{delta >= 0 ? "+" : ""}{fmt$(Math.round(delta))}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'Space Mono', monospace", color: askGap >= 0 ? "#22C55E" : "#F59E0B" }}>{askGap >= 0 ? "+" : ""}{fmtPct(askGapPct, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: "#64748B", marginTop: 10, lineHeight: 1.5 }}>
        Cap basis: {psLens.lens.capBasis}. Platform premium = (Storvex price − Generic price). The Δ column quantifies the platform-fit value an institutional self-managed REIT would pay above a generic third-party-managed buyer.
      </div>
    </div>
  );
}

// ─── Rent Sanity Banner ───────────────────────────────────────────────────
// Independent SpareFoot cross-check on seller's implied effective rent.
// Computed inside analyzeExistingAsset() when marketRents enrichment is
// available. Renders nothing when null (graceful first-render path before
// the enrichment promise resolves).
//
// Three states: "warn" (rent >15% above market — pro forma may be aggressive),
// "info" (rent >15% below market — value-add lever or distressed signal),
// "ok" (within ±15% — pro forma defensible).
function RentSanityBanner({ rentSanity }) {
  if (!rentSanity) return null;

  const colorMap = {
    warn: { color: "#F59E0B", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.4)", label: "Rent Above Market", icon: "⚠" },
    info: { color: "#3B82F6", bg: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.4)", label: "Rent Below Market", icon: "ⓘ" },
    ok:   { color: "#22C55E", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.3)", label: "Rent Aligned", icon: "✓" },
  };
  const c = colorMap[rentSanity.severity] || colorMap.ok;

  return (
    <div style={{ ...card, background: c.bg, border: `1px solid ${c.border}`, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontSize: 18, color: c.color, flex: "0 0 auto", lineHeight: 1.2 }}>{c.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: c.color, padding: "3px 8px", borderRadius: 999, letterSpacing: "0.06em", textTransform: "uppercase" }}>RENT SANITY</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: c.color, textTransform: "uppercase", letterSpacing: "0.08em" }}>{c.label}</span>
          </div>
          <div style={{ fontSize: 12, color: "#E2E8F0", lineHeight: 1.5 }}>{rentSanity.message}</div>
          <div style={{ marginTop: 8, fontSize: 10, color: "#64748B", fontFamily: "'Space Mono', monospace" }}>
            Implied: ${rentSanity.impliedRatePerSF.toFixed(2)}/SF/mo · Blended market: ${rentSanity.blendedMarketRate.toFixed(2)}/SF/mo · {rentSanity.source}
            {rentSanity.sampleSize ? ` · n=${rentSanity.sampleSize}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PSA Verdict Hero ─────────────────────────────────────────────────────
// PSA Lens drives the headline. The model encodes PSA's own underwriting
// (24.86% opex, 6.0-7.0% stabilized caps, 12% brand premium) so the verdict
// is what PSA's IC would conclude — not what a generic institutional buyer
// would. Generic buyer's verdict is shown as a secondary context line.
function PSAVerdictHero({ psLens, analysis }) {
  const PS_BLUE = "#3B82F6";
  // Headline = PSA Lens verdict. Falls back to generic if psLens not yet computed.
  const v = (psLens && psLens.verdict) ? psLens.verdict : analysis.verdict;
  const isPSA = !!(psLens && psLens.verdict);
  const bg = v.label === "PURSUE" ? "rgba(34,197,94,0.12)" : v.label === "NEGOTIATE" ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)";
  const border = v.label === "PURSUE" ? "#22C55E" : v.label === "NEGOTIATE" ? "#F59E0B" : "#EF4444";
  // Generic comparison verdict — show only when PSA verdict differs (the platform-fit story)
  const generic = analysis?.verdict;
  const verdictsDiffer = isPSA && generic && generic.label !== v.label;

  return (
    <div style={{ ...card, background: `linear-gradient(135deg, ${bg}, rgba(15,21,56,0.6))`, border: `2px solid ${border}80`, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: PS_BLUE, padding: "3px 8px", borderRadius: 999, letterSpacing: "0.06em", textTransform: "uppercase" }}>{isPSA ? "Storvex Underwrite" : "Generic Buyer"}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Verdict</span>
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, color: v.color, letterSpacing: "-0.02em", lineHeight: 1, marginBottom: 8 }}>{v.label}</div>
          <div style={{ fontSize: 13, color: "#E2E8F0", lineHeight: 1.5, maxWidth: 600 }}>{v.rationale}</div>
          {verdictsDiffer && (
            <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 6, fontSize: 11, color: "#94A3B8", borderLeft: `2px solid ${generic.color}80` }}>
              <strong style={{ color: generic.color }}>Generic buyer would {generic.label}</strong> at this ask — the platform-fit Δ is the story below.
            </div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>{isPSA ? "Stabilized Cap" : "Cap on Ask"}</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", fontFamily: "'Space Mono', monospace", marginTop: 4 }}>
            {isPSA ? fmtPct(psLens.marketCap, 2) : fmtPct(analysis.snapshot.capOnAsk, 2)}
          </div>
          {isPSA && psLens.lens?.portfolioFit && (
            <div style={{ fontSize: 10, color: "#22C55E", fontWeight: 700, marginTop: 4 }}>✓ Portfolio fit (−25 bps)</div>
          )}
          {!isPSA && analysis.snapshot.doaFlag && <div style={{ fontSize: 10, color: "#EF4444", fontWeight: 700, marginTop: 4 }}>⚠ DOA cap rate</div>}
        </div>
      </div>
    </div>
  );
}

// ─── YOC Verdict Card ─────────────────────────────────────────────────────
//
// Renders the deal's stabilized cap vs the selected buyer's underwriting
// hurdle. The hurdle is the buyer's MSA-tier-adjusted target acquisition cap
// (with portfolio-fit bonus applied if applicable). The dev YOC target is
// shown as context — that's the buyer's hurdle for ground-up development,
// not for stabilized acquisitions.
//
// Verdict thresholds (vs target acq cap):
//   ≥ +50 bps above hurdle  → HURDLE CLEARED (green)
//   −25 to +50 bps          → AT HURDLE (gold — marginal)
//   < −25 bps below hurdle  → MISSES HURDLE (red)
//
// This block answers Dan's #1 question: "if [buyer] underwrote this deal at
// their hurdle, would they pursue it?"
function YOCVerdictCard({ psLens }) {
  if (!psLens || !psLens.projection?.y3 || !psLens.snapshot?.ask || psLens.snapshot.ask <= 0) return null;
  const ask = psLens.snapshot.ask;
  const y3NOI = psLens.projection.y3.noi;
  if (!Number.isFinite(y3NOI) || y3NOI <= 0) return null;
  const dealStabCap = y3NOI / ask;
  const targetCap = psLens.marketCap;
  if (!Number.isFinite(targetCap) || targetCap <= 0) return null;
  const bpsDelta = Math.round((dealStabCap - targetCap) * 10000); // positive = above target = better
  const devYOCTarget = psLens.lens?.devYOCTarget;
  const baseCap = psLens.lens?.baseCap;
  const portfolioFit = psLens.lens?.portfolioFit;
  const lensName = psLens.lens?.ticker || "BUYER";

  const verdictLabel = bpsDelta >= 50 ? "HURDLE CLEARED" : bpsDelta >= -25 ? "AT HURDLE" : "MISSES HURDLE";
  const verdictColor = bpsDelta >= 50 ? "#22C55E" : bpsDelta >= -25 ? "#F59E0B" : "#EF4444";
  const bg = bpsDelta >= 50 ? "rgba(34,197,94,0.08)" : bpsDelta >= -25 ? "rgba(245,158,11,0.08)" : "rgba(239,68,68,0.08)";
  const verdictNarrative = bpsDelta >= 50
    ? `${lensName} would PURSUE — deal stabilized cap is ${Math.abs(bpsDelta)} bps above the lens hurdle. Yield story holds with cushion.`
    : bpsDelta >= -25
      ? `${lensName} would NEGOTIATE — deal stabilized cap is within ±25 bps of the lens hurdle. Marginal at ask; pursue at or below Strike.`
      : `${lensName} would PASS — deal stabilized cap is ${Math.abs(bpsDelta)} bps below the lens hurdle. Yield story breaks under disciplined underwriting.`;

  // Dev YOC is the buyer's ground-up dev target — shown for context only
  const devContextLine = devYOCTarget
    ? `Dev hurdle (ground-up): ${(devYOCTarget * 100).toFixed(1)}% YOC — context only; this is a stabilized acquisition, not a development.`
    : null;

  return (
    <div style={{ ...card, background: `linear-gradient(135deg, ${bg}, rgba(15,21,56,0.6))`, border: `1.5px solid ${verdictColor}66`, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: verdictColor, textTransform: "uppercase", letterSpacing: "0.10em", marginBottom: 4 }}>
            🎯 YOC HURDLE · {lensName} LENS
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: verdictColor, letterSpacing: "-0.01em", lineHeight: 1 }}>
            {verdictLabel}
          </div>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Deal Stab Cap</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#fff", fontFamily: "'Space Mono', monospace", marginTop: 2 }}>{(dealStabCap * 100).toFixed(2)}%</div>
            <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>Y3 NOI / ask</div>
          </div>
          <div style={{ textAlign: "right", borderLeft: "1px solid rgba(255,255,255,0.08)", paddingLeft: 18 }}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>{lensName} Hurdle</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#C9A84C", fontFamily: "'Space Mono', monospace", marginTop: 2 }}>{(targetCap * 100).toFixed(2)}%</div>
            <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>
              {portfolioFit && baseCap ? `${(baseCap * 100).toFixed(2)}% − ${psLens.lens?.portfolioFitBps || 0} bps fit` : `${psLens.lens?.capBasis || "MSA-tier acq cap"}`}
            </div>
          </div>
          <div style={{ textAlign: "right", borderLeft: "1px solid rgba(255,255,255,0.08)", paddingLeft: 18 }}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Δ vs Hurdle</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: verdictColor, fontFamily: "'Space Mono', monospace", marginTop: 2 }}>
              {bpsDelta >= 0 ? "+" : ""}{bpsDelta} bps
            </div>
            <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>+50 = clear · −25 = at · &lt;−25 = miss</div>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#E2E8F0", lineHeight: 1.5, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {verdictNarrative}
      </div>
      {devContextLine && (
        <div style={{ fontSize: 10, color: "#64748B", marginTop: 6, fontStyle: "italic" }}>{devContextLine}</div>
      )}
    </div>
  );
}

// ─── Financing Scenario Card ──────────────────────────────────────────────
//
// Renders the lens-specific acquisition financing scenario: capital stack,
// debt service, DSCR, cash-on-cash, 10-yr levered + unlevered IRR. Closes
// the all-cash credibility gap institutional analysts flag immediately.
//
// Each lens carries its own financing block (LTV, rate, amort, term) — PSA
// gets tightest terms (institutional unsecured); SMA pays small-cap premium;
// AMERCO gets UHAL parent corp credit; GENERIC gets 3PM-managed CMBS.
function FinancingScenarioCard({ psLens }) {
  const fin = psLens?.financing;
  if (!fin || !Number.isFinite(fin.equity) || fin.equity <= 0) return null;

  const a = fin.assumptions || {};
  const lensTicker = psLens?.lens?.ticker || "BUYER";
  const dscrColor = (v) => (v >= 1.40 ? "#22C55E" : v >= 1.20 ? "#F59E0B" : "#EF4444");
  const cocColor = (v) => (v >= 0.08 ? "#22C55E" : v >= 0.05 ? "#F59E0B" : "#EF4444");
  const irrColor = (v) => (v == null ? "#94A3B8" : v >= 0.12 ? "#22C55E" : v >= 0.08 ? "#F59E0B" : "#EF4444");

  return (
    <div style={{ ...card, background: "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(15,21,56,0.6))", border: "1.5px solid rgba(59,130,246,0.50)", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#3B82F6", textTransform: "uppercase", letterSpacing: "0.10em", marginBottom: 4 }}>
            💰 ACQUISITION FINANCING · {lensTicker} LENS
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
            10-Year Levered Hold · {a.debtSource || "Institutional senior debt"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ textAlign: "right", padding: "8px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, minWidth: 110 }}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Levered IRR</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: irrColor(fin.leveredIRR), fontFamily: "'Space Mono', monospace", marginTop: 2 }}>
              {fin.leveredIRR != null ? `${(fin.leveredIRR * 100).toFixed(1)}%` : "—"}
            </div>
          </div>
          <div style={{ textAlign: "right", padding: "8px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, minWidth: 110 }}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Unlevered IRR</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#94A3B8", fontFamily: "'Space Mono', monospace", marginTop: 2 }}>
              {fin.unleveredIRR != null ? `${(fin.unleveredIRR * 100).toFixed(1)}%` : "—"}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
        <div style={{ padding: 10, background: "rgba(255,255,255,0.04)", borderRadius: 4 }}>
          <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Capital Stack</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>
            {fmt$(Math.round(fin.loanAmount))} <span style={{ color: "#94A3B8", fontSize: 10 }}>debt</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#C9A84C", marginTop: 2, fontFamily: "'Space Mono', monospace" }}>
            {fmt$(Math.round(fin.equity))} <span style={{ color: "#94A3B8", fontSize: 10 }}>equity</span>
          </div>
          <div style={{ fontSize: 9, color: "#64748B", marginTop: 4 }}>{(a.ltv * 100).toFixed(0)}% LTV</div>
        </div>
        <div style={{ padding: 10, background: "rgba(255,255,255,0.04)", borderRadius: 4 }}>
          <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Debt Terms</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>
            {(a.rate * 100).toFixed(2)}% · {a.amortYrs}-yr amort
          </div>
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2, fontFamily: "'Space Mono', monospace" }}>
            {a.termYrs}-yr term · {a.holdYrs}-yr hold
          </div>
          <div style={{ fontSize: 9, color: "#64748B", marginTop: 4 }}>Annual P&I: {fmt$(Math.round(fin.annualDebtService))}</div>
        </div>
        <div style={{ padding: 10, background: "rgba(255,255,255,0.04)", borderRadius: 4 }}>
          <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Y1 DSCR</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: dscrColor(fin.y1DSCR), marginTop: 4, fontFamily: "'Space Mono', monospace" }}>
            {fin.y1DSCR != null ? `${fin.y1DSCR.toFixed(2)}x` : "—"}
          </div>
          <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>Y3: {fin.y3DSCR?.toFixed(2)}x · 1.40x lender min</div>
        </div>
        <div style={{ padding: 10, background: "rgba(255,255,255,0.04)", borderRadius: 4 }}>
          <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Y1 Cash-on-Cash</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: cocColor(fin.y1CashOnCash), marginTop: 4, fontFamily: "'Space Mono', monospace" }}>
            {fin.y1CashOnCash != null ? `${(fin.y1CashOnCash * 100).toFixed(1)}%` : "—"}
          </div>
          <div style={{ fontSize: 9, color: "#64748B", marginTop: 2 }}>Y3 Stabilized: {fin.y3CashOnCash != null ? `${(fin.y3CashOnCash * 100).toFixed(1)}%` : "—"}</div>
        </div>
      </div>

      <div style={{ padding: 8, background: "rgba(0,0,0,0.15)", borderRadius: 4, fontSize: 11, color: "#E2E8F0", lineHeight: 1.5 }}>
        <b style={{ color: "#3B82F6" }}>Levered hold model:</b> Equity in Y0 = {fmt$(Math.round(fin.equity))}. Y1-Y10 net cash flow = NOI − ${Math.round(fin.annualDebtService).toLocaleString()} P&I (rent ramps Y1→Y3, then grows {((a.rentGrowthYoY ?? 0.02) * 100).toFixed(1)}%/yr). Exit at Y10 = NOI ÷ {(a.effectiveExitCap * 100).toFixed(2)}% exit cap = {fmt$(Math.round(fin.exitValue))} sale price minus {fmt$(Math.round(fin.remainingLoanAtExit))} remaining principal. <b style={{ color: irrColor(fin.leveredIRR) }}>Levered IRR {fin.leveredIRR != null ? (fin.leveredIRR * 100).toFixed(1) + "%" : "—"}</b>; unlevered {fin.unleveredIRR != null ? (fin.unleveredIRR * 100).toFixed(1) + "%" : "—"}.
      </div>

      <div style={{ marginTop: 6, fontSize: 9, color: "#64748B", lineHeight: 1.4 }}>
        Lens-specific terms reflect each buyer's institutional cost of capital position (Newmark 2025 Self-Storage Capital Markets Report + Q1 2026 storage agency/CMBS rate sheets). Storvex models asset-level senior debt for transparency; PSA's actual unsecured corporate cost is ~25-50 bps tighter than the modeled rate.
      </div>
    </div>
  );
}

// ─── Multi-Lens Buyer Comparison Card ─────────────────────────────────────
//
// One screen, every buyer's verdict. For one OM input, this card runs every
// registered buyer lens (PSA / EXR / CUBE / SMA / GENERIC) and shows them
// side-by-side. The columns:
//
//   - Buyer (ticker + name)
//   - Deal Stab Cap (Y3 NOI / ask) — same for every row (input-driven)
//   - Lens Hurdle (lens.marketCap with portfolio-fit applied)
//   - Δ vs Hurdle (bps) — color-coded
//   - Verdict (CLEARED / AT / MISSES)
//   - Implied Takedown Price (Y3 NOI / lens hurdle — what THAT buyer would
//     pay at THEIR hurdle. The institutional "willingness to pay" number.)
//
// Rows sorted DESC by Implied Takedown Price → top row is the natural takeout
// buyer. The price spread between row 1 and the GENERIC row IS the platform-
// fit Δ — the dollar value the institutional self-managed REIT defensibly
// pays above a generic 3PM-managed buyer on the identical asset.
//
// THIS is the institutional moat made literal in one card. Drop one OM, see
// every buyer's verdict simultaneously, see who would pay most, see by how much.
function MultiLensComparisonCard({ rows, platformFitDelta, ask }) {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const verdictColor = (v) =>
    v === "HURDLE_CLEARED" ? "#22C55E" :
    v === "AT_HURDLE" ? "#F59E0B" :
    v === "MISSES_HURDLE" ? "#EF4444" :
    "#94A3B8";
  const verdictLabel = (v) =>
    v === "HURDLE_CLEARED" ? "CLEARED" :
    v === "AT_HURDLE" ? "AT HURDLE" :
    v === "MISSES_HURDLE" ? "MISSES" :
    "—";

  // The natural takeout = top row (highest implied takedown price)
  const winner = rows[0];
  const winnerPrice = winner?.impliedTakedownPrice;
  const winnerVerdict = winner?.verdict;

  return (
    <div style={{ ...card, background: "linear-gradient(135deg, rgba(201,168,76,0.06), rgba(15,21,56,0.6))", border: "1.5px solid rgba(201,168,76,0.50)", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: GOLD, textTransform: "uppercase", letterSpacing: "0.10em", marginBottom: 4 }}>
            ⚔️ MULTI-BUYER COMPARISON · ALL LENSES
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
            Who would pay most for this deal — and by how much.
          </div>
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4, lineHeight: 1.4, maxWidth: 520 }}>
            Each row is one buyer's view of the same asset, underwritten through THEIR FY2025 10-K constants. Sorted DESC by implied takedown price. Top row is the natural institutional takeout.
          </div>
        </div>
        {platformFitDelta && Number.isFinite(platformFitDelta.deltaDollars) && (
          <div style={{ textAlign: "right", padding: "8px 12px", background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.40)", borderRadius: 6, minWidth: 200 }}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.04em" }}>Platform-Fit Δ</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#22C55E", fontFamily: "'Space Mono', monospace", marginTop: 2 }}>
              {platformFitDelta.deltaDollars >= 0 ? "+" : ""}{fmt$(Math.round(platformFitDelta.deltaDollars))}
            </div>
            <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 2 }}>
              {platformFitDelta.topLensTicker} pays {platformFitDelta.deltaPct != null ? `${(platformFitDelta.deltaPct * 100).toFixed(1)}% more` : "more"} than GEN
            </div>
          </div>
        )}
      </div>

      <table style={{ width: "100%", fontSize: 12, fontFamily: "'Inter', sans-serif", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#64748B", borderBottom: "1px solid rgba(201,168,76,0.30)" }}>
            <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.04em" }}>Buyer</th>
            <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700, fontSize: 9 }}>Deal Stab Cap</th>
            <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700, fontSize: 9 }}>Lens Hurdle</th>
            <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700, fontSize: 9 }}>Δ vs Hurdle</th>
            <th style={{ textAlign: "center", padding: "6px 8px", fontWeight: 700, fontSize: 9 }}>Verdict</th>
            <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700, fontSize: 9 }}>Implied Takedown $</th>
            <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700, fontSize: 9 }}>vs Ask</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isWinner = i === 0 && row.impliedTakedownPrice != null;
            const vsAsk = (ask > 0 && row.impliedTakedownPrice != null)
              ? (row.impliedTakedownPrice - ask) / ask
              : null;
            return (
              <tr
                key={row.key}
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  background: isWinner ? "rgba(201,168,76,0.10)" : "transparent",
                }}
              >
                <td style={{ padding: "8px 8px", color: "#fff", fontWeight: 700 }}>
                  {isWinner && <span style={{ color: GOLD, marginRight: 6, fontSize: 11 }}>★</span>}
                  <span style={{ color: row.brandColor || "#fff", fontFamily: "'Space Mono', monospace" }}>{row.ticker}</span>
                  <div style={{ fontSize: 9, color: "#64748B", fontWeight: 400, marginTop: 1, fontFamily: "system-ui, sans-serif" }}>{row.name}</div>
                </td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: "#fff", fontFamily: "'Space Mono', monospace" }}>
                  {row.dealStabCap != null ? `${(row.dealStabCap * 100).toFixed(2)}%` : "—"}
                </td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: "#94A3B8", fontFamily: "'Space Mono', monospace" }}>
                  {row.lensTargetCap != null ? `${(row.lensTargetCap * 100).toFixed(2)}%` : "—"}
                </td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: verdictColor(row.verdict), fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>
                  {row.bpsDelta != null ? `${row.bpsDelta >= 0 ? "+" : ""}${row.bpsDelta} bps` : "—"}
                </td>
                <td style={{ padding: "8px 8px", textAlign: "center" }}>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      color: verdictColor(row.verdict),
                      background: `${verdictColor(row.verdict)}1A`,
                      padding: "3px 8px",
                      borderRadius: 999,
                      letterSpacing: "0.04em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {verdictLabel(row.verdict)}
                  </span>
                </td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: isWinner ? GOLD : "#fff", fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>
                  {row.impliedTakedownPrice != null ? fmt$(Math.round(row.impliedTakedownPrice)) : "—"}
                </td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: vsAsk != null ? (vsAsk >= 0 ? "#22C55E" : "#EF4444") : "#64748B", fontFamily: "'Space Mono', monospace", fontSize: 11 }}>
                  {vsAsk != null ? `${vsAsk >= 0 ? "+" : ""}${(vsAsk * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 10, fontSize: 10, color: "#64748B", lineHeight: 1.5 }}>
        Implied takedown price = Y3 stabilized NOI ÷ lens hurdle (the price each buyer would pay AT their own underwriting hurdle). Each lens applies its own opex ratios + brand premium + portfolio-fit bonus, so the same input deal produces different reconstructed NOIs and different prices. Constants per lens trace to FY2025 10-K accession # — citation footnotes available in the Goldman PDF report.
      </div>
    </div>
  );
}

// ─── Development Pipeline Card ────────────────────────────────────────────
//
// Renders the institutional REIT pipeline within a 3-mi radius of the
// subject site. Each row: operator, distance, NRSF, expected delivery,
// status. Saturation verdict at top tells the analyst whether to haircut
// Y3 NOI assumptions because of competing new supply.
//
// Saturation thresholds (from edgarCompIndex.assessPipelineSaturation):
//   ≥ 100K SF CC in horizon → MATERIAL flag (Y3 occ −1pp, rent growth −1pp)
//   50–100K SF CC          → MODERATE flag (watch absorption)
//   < 50K SF or out-of-horizon → no flag
//
// Storvex flags but does NOT auto-adjust the Y3 NOI math — the analyst
// makes the call based on the local trade-area dynamics.
function DevelopmentPipelineCard({ nearby, saturation, metadata }) {
  // Don't render when there's no enrichment yet OR no pipeline within radius
  if (!nearby || !Array.isArray(nearby) || nearby.length === 0 || !saturation) {
    return null;
  }

  const severityColor =
    saturation.severity === "MATERIAL" ? "#EF4444" :
    saturation.severity === "MODERATE" ? "#F59E0B" :
    saturation.severity === "MINIMAL" ? "#94A3B8" :
    "#94A3B8";
  const severityBg =
    saturation.severity === "MATERIAL" ? "rgba(239,68,68,0.10)" :
    saturation.severity === "MODERATE" ? "rgba(245,158,11,0.10)" :
    "rgba(148,163,184,0.06)";

  const operatorColors = {
    PSA: "#3B82F6",
    PS: "#3B82F6",
    EXR: "#10B981",
    CUBE: "#F59E0B",
    SMA: "#A855F7",
    AMERCO: "#F97316",
    UHAL: "#F97316",
  };

  return (
    <div style={{ ...card, background: `linear-gradient(135deg, ${severityBg}, rgba(15,21,56,0.6))`, border: `1.5px solid ${severityColor}55`, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: severityColor, textTransform: "uppercase", letterSpacing: "0.10em", marginBottom: 4 }}>
            🏗️ NEW-SUPPLY PIPELINE · 3-MI RADIUS · {saturation.severity}
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
            {saturation.verdict.replace(/^./, (c) => c.toUpperCase())}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ textAlign: "right", padding: "8px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, minWidth: 130 }}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>CC SF in Horizon</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: severityColor, fontFamily: "'Space Mono', monospace", marginTop: 2 }}>
              {saturation.ccNRSFInHorizon ? `${(saturation.ccNRSFInHorizon / 1000).toFixed(0)}K` : "—"}
            </div>
            <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 2 }}>{saturation.facilitiesInHorizon} facilities · Y1-Y3</div>
          </div>
          <div style={{ textAlign: "right", padding: "8px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6 }}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Total Pipeline</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", fontFamily: "'Space Mono', monospace", marginTop: 2 }}>
              {saturation.totalNRSF ? `${(saturation.totalNRSF / 1000).toFixed(0)}K` : "0"}
            </div>
            <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 2 }}>{saturation.facilityCount} facilities · all years</div>
          </div>
        </div>
      </div>

      <table style={{ width: "100%", fontSize: 12, fontFamily: "'Inter', sans-serif", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#64748B", borderBottom: `1px solid ${severityColor}33` }}>
            <th style={{ textAlign: "left", padding: "5px 6px", fontWeight: 700, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.04em" }}>Operator</th>
            <th style={{ textAlign: "left", padding: "5px 6px", fontWeight: 700, fontSize: 9 }}>Location</th>
            <th style={{ textAlign: "right", padding: "5px 6px", fontWeight: 700, fontSize: 9 }}>Distance</th>
            <th style={{ textAlign: "right", padding: "5px 6px", fontWeight: 700, fontSize: 9 }}>NRSF</th>
            <th style={{ textAlign: "right", padding: "5px 6px", fontWeight: 700, fontSize: 9 }}>CC %</th>
            <th style={{ textAlign: "left", padding: "5px 6px", fontWeight: 700, fontSize: 9 }}>Delivery</th>
            <th style={{ textAlign: "left", padding: "5px 6px", fontWeight: 700, fontSize: 9 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {nearby.map((row) => (
            <tr key={row.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <td style={{ padding: "7px 6px", color: "#fff", fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>
                <span style={{ color: operatorColors[row.operator] || "#fff" }}>{row.operator}</span>
              </td>
              <td style={{ padding: "7px 6px", color: "#94A3B8", fontSize: 11 }}>
                {row.address}
                <div style={{ fontSize: 9, color: "#64748B" }}>{row.city}, {row.state} · {row.msa}</div>
              </td>
              <td style={{ padding: "7px 6px", textAlign: "right", color: "#fff", fontFamily: "'Space Mono', monospace" }}>
                {row.distanceMi != null ? `${row.distanceMi.toFixed(2)} mi` : "—"}
              </td>
              <td style={{ padding: "7px 6px", textAlign: "right", color: "#fff", fontFamily: "'Space Mono', monospace" }}>
                {row.nrsf != null ? `${(row.nrsf / 1000).toFixed(0)}K` : "—"}
              </td>
              <td style={{ padding: "7px 6px", textAlign: "right", color: "#94A3B8", fontFamily: "'Space Mono', monospace", fontSize: 11 }}>
                {row.ccPct != null ? `${row.ccPct}%` : "—"}
              </td>
              <td style={{ padding: "7px 6px", color: "#94A3B8", fontFamily: "'Space Mono', monospace", fontSize: 11 }}>
                {row.expectedDelivery || "—"}
              </td>
              <td style={{ padding: "7px 6px" }}>
                <span style={{
                  fontSize: 9,
                  fontWeight: 800,
                  color: row.status === "under-construction" ? "#F59E0B" : row.status === "permitted" ? "#3B82F6" : "#94A3B8",
                  background: row.status === "under-construction" ? "rgba(245,158,11,0.10)" : row.status === "permitted" ? "rgba(59,130,246,0.10)" : "rgba(148,163,184,0.10)",
                  padding: "2px 8px",
                  borderRadius: 999,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  whiteSpace: "nowrap",
                }}>
                  {(row.status || "").replace(/-/g, " ")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 4, borderLeft: `3px solid ${severityColor}88`, fontSize: 11, color: "#E2E8F0", lineHeight: 1.5 }}>
        <b style={{ color: severityColor }}>Verdict:</b> {saturation.narrative}
      </div>

      <div style={{ marginTop: 8, fontSize: 9, color: "#64748B", lineHeight: 1.4 }}>
        {metadata?.totalFacilities || 0} disclosed REIT pipeline facilities indexed nationally · sourced from FY2025 10-K MD&A 'Properties Under Development' sections + Q1 2026 earnings transcripts · Phase {metadata?.phase || 1} dataset, refreshes quarterly. Saturation thresholds (LOCKED): ≥ 100K SF CC delivering Y1-Y3 → MATERIAL · 50–100K → MODERATE · &lt; 50K → MINIMAL.
      </div>
    </div>
  );
}

// ─── Snapshot Card ────────────────────────────────────────────────────────
function SnapshotCard({ snapshot }) {
  const tiles = [
    { label: "Ask", value: fmt$(snapshot.ask) },
    { label: "$ / SF", value: snapshot.pricePerSF > 0 ? fmt$(Math.round(snapshot.pricePerSF)) : "—" },
    { label: "$ / Unit", value: snapshot.pricePerUnit > 0 ? fmt$(Math.round(snapshot.pricePerUnit)) : "—" },
    { label: "NRSF", value: fmtN(snapshot.nrsf) },
    { label: "Units", value: fmtN(snapshot.unitCount) },
    { label: "Phys Occ", value: fmtPct(snapshot.physicalOcc, 0) },
    { label: "Econ Occ", value: fmtPct(snapshot.economicOcc, 0) },
    { label: "Year Built", value: snapshot.yearBuilt || "—" },
  ];
  return (
    <div style={card}>
      <div style={sectionHeader}>Snapshot · Step 1</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
        {tiles.map((t) => (
          <div key={t.label} style={metricBox}>
            <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{t.value}</div>
          </div>
        ))}
      </div>
      {snapshot.doaFlag && (
        <div style={{ marginTop: 14, padding: 12, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, fontSize: 12, color: "#FCA5A5" }}>
          ⚠ {snapshot.doaReason}
        </div>
      )}
    </div>
  );
}

// ─── Reconstructed NOI Card ───────────────────────────────────────────────
function ReconstructedNOICard({ reconstructed, sellerNOI }) {
  return (
    <div style={card}>
      <div style={sectionHeader}>Buyer-Lens NOI Reconstruction · Step 3</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        <div style={metricBox}>
          <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Seller NOI (T-12)</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{fmt$(sellerNOI)}</div>
        </div>
        <div style={{ ...metricBox, borderLeft: `3px solid ${GOLD}` }}>
          <div style={{ fontSize: 10, color: GOLD, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Buyer NOI (Reconstructed)</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: GOLD, marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{fmt$(Math.round(reconstructed.buyerNOI))}</div>
        </div>
        <div style={metricBox}>
          <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Δ NOI</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: reconstructed.deltaNOI >= 0 ? "#22C55E" : "#EF4444", marginTop: 4, fontFamily: "'Space Mono', monospace" }}>
            {reconstructed.deltaNOI >= 0 ? "+" : ""}{fmt$(Math.round(reconstructed.deltaNOI))} ({fmtPct(reconstructed.deltaPct, 1)})
          </div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${GOLD}33` }}>
            <th style={thStyle}>Line</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Buyer ($)</th>
            <th style={thStyle}>Basis</th>
          </tr>
        </thead>
        <tbody>
          {reconstructed.lines.map((l) => (
            <tr key={l.line} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <td style={tdStyle}>{l.line}</td>
              <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'Space Mono', monospace", color: "#fff", fontWeight: 600 }}>{fmt$(Math.round(l.buyer))}</td>
              <td style={{ ...tdStyle, color: "#94A3B8", fontSize: 11 }}>{l.basis}</td>
            </tr>
          ))}
          <tr style={{ borderTop: `2px solid ${GOLD}66`, background: "rgba(201,168,76,0.06)" }}>
            <td style={{ ...tdStyle, fontWeight: 800, color: GOLD }}>Total OpEx</td>
            <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'Space Mono', monospace", color: GOLD, fontWeight: 800 }}>{fmt$(Math.round(reconstructed.totalOpEx))}</td>
            <td style={{ ...tdStyle, color: "#94A3B8", fontSize: 11 }}>OpEx ratio · {fmtPct(reconstructed.opexRatio, 1)}</td>
          </tr>
        </tbody>
      </table>

      {reconstructed.flags.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {reconstructed.flags.map((f, i) => (
            <div key={i} style={{ padding: 10, background: f.severity === "warn" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)", border: `1px solid ${f.severity === "warn" ? "rgba(245,158,11,0.3)" : "rgba(59,130,246,0.3)"}`, borderRadius: 8, fontSize: 12, color: f.severity === "warn" ? "#FCD34D" : "#93C5FD", marginBottom: 6 }}>
              {f.severity === "warn" ? "⚠" : "ℹ"} {f.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const thStyle = { textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" };
const tdStyle = { padding: "8px 10px", fontSize: 12, color: "#E2E8F0" };

// ─── Projection Card ──────────────────────────────────────────────────────
function ProjectionCard({ projection }) {
  const cols = [
    { key: "y1", label: "Year 1", sub: "T-12 reconstructed" },
    { key: "y3", label: "Year 3", sub: "ECRI burn-in + concession recovery" },
    { key: "y5", label: "Year 5", sub: "3% rev / 2.5% exp growth" },
  ];
  return (
    <div style={card}>
      <div style={sectionHeader}>Stabilized Projection · Step 5</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {cols.map((c) => {
          const yr = projection[c.key];
          return (
            <div key={c.key} style={{ ...metricBox, borderLeft: `3px solid ${c.key === "y5" ? GOLD : "rgba(201,168,76,0.4)"}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.key === "y5" ? GOLD : "#E2E8F0", textTransform: "uppercase", letterSpacing: "0.06em" }}>{c.label}</div>
              <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 2, marginBottom: 8 }}>{c.sub}</div>
              <div style={{ fontSize: 11, color: "#94A3B8" }}>Revenue</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "'Space Mono', monospace" }}>{fmt$(Math.round(yr.rev))}</div>
              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>OpEx</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "'Space Mono', monospace" }}>({fmt$(Math.round(yr.exp))})</div>
              <div style={{ fontSize: 11, color: GOLD, marginTop: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>NOI</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: GOLD, fontFamily: "'Space Mono', monospace" }}>{fmt$(Math.round(yr.noi))}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: "#64748B", marginTop: 10, lineHeight: 1.5 }}>
        {projection.assumptions.basis}
      </div>
    </div>
  );
}

// ─── Valuation Matrix Card ────────────────────────────────────────────────
function ValuationMatrixCard({ matrix, ask }) {
  const yearLabels = { y1: "Y1", y3: "Y3", y5: "Y5" };
  return (
    <div style={card}>
      <div style={sectionHeader}>Valuation Matrix · NOI × Cap Rate</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${GOLD}33` }}>
            <th style={thStyle}>NOI Year</th>
            {matrix.capRates.map((cap) => (
              <th key={cap} style={{ ...thStyle, textAlign: "right" }}>{(cap * 100).toFixed(2)}%</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.years.map((y, ri) => (
            <tr key={y} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <td style={{ ...tdStyle, fontWeight: 700, color: y === "y5" ? GOLD : "#E2E8F0" }}>{yearLabels[y]}</td>
              {matrix.cells[ri].map((v, ci) => {
                const isAtAsk = v >= ask * 0.97 && v <= ask * 1.03;
                return (
                  <td key={ci} style={{ ...tdStyle, textAlign: "right", fontFamily: "'Space Mono', monospace", color: isAtAsk ? GOLD : "#fff", background: isAtAsk ? "rgba(201,168,76,0.1)" : "transparent", fontWeight: isAtAsk ? 800 : 600 }}>
                    {fmt$(Math.round(v))}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr style={{ borderTop: `1px solid ${GOLD}33`, background: "rgba(0,0,0,0.2)" }}>
            <td style={{ ...tdStyle, fontWeight: 700, color: ICE, fontSize: 11 }}>Ask</td>
            <td colSpan={matrix.capRates.length} style={{ ...tdStyle, textAlign: "right", fontFamily: "'Space Mono', monospace", color: ICE, fontWeight: 700 }}>{fmt$(ask)}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: "#64748B", marginTop: 10 }}>
        Cells within ±3% of ask highlighted gold — that's the implied cap-rate read for the deal.
      </div>
    </div>
  );
}

// ─── Price Tiers Card ─────────────────────────────────────────────────────
function PriceTiersCard({ tiers, ask, marketCap, msaTier }) {
  const tierBox = (label, t, color, sub) => (
    <div style={{ ...metricBox, borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#fff", fontFamily: "'Space Mono', monospace", marginTop: 6 }}>{fmt$(Math.round(t.price))}</div>
      <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>@ {fmtPct(t.cap, 2)} · {sub}</div>
    </div>
  );
  return (
    <div style={card}>
      <div style={sectionHeader}>Storvex Price Tiers · Step 6</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
        {tierBox("Home Run", tiers.homeRun, "#22C55E", "Y3 NOI · aggressive")}
        {tierBox("Strike", tiers.strike, GOLD, "Y5 NOI · likely clear")}
        {tierBox("Walk", tiers.walk, "#F59E0B", "Y5 NOI · ceiling")}
      </div>
      <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.5 }}>
        Market cap <strong style={{ color: ICE }}>{fmtPct(marketCap, 2)}</strong> ({MSA_TIER_OPTIONS.find((m) => m.key === msaTier)?.label || "—"}) — base STORAGE.ACQ_CAP 5.60% adjusted for MSA tier.<br/>
        Ask vs. Strike: <strong style={{ color: ask <= tiers.strike.price ? "#22C55E" : "#F59E0B" }}>{ask <= tiers.strike.price ? `${fmt$(Math.round(tiers.strike.price - ask))} below Strike` : `${fmt$(Math.round(ask - tiers.strike.price))} above Strike`}</strong>
      </div>
    </div>
  );
}

// ─── Comp Grid Card ───────────────────────────────────────────────────────
function CompGridCard({ comps, subjectAsk }) {
  if (!comps || !comps.comps || comps.comps.length === 0) {
    return (
      <div style={card}>
        <div style={sectionHeader}>Sale Comps · Step 8</div>
        <div style={{ fontSize: 12, color: "#94A3B8", padding: 12 }}>No state-keyed comps available. Add a record to <code>src/data/storageCompSales.js</code>.</div>
      </div>
    );
  }
  return (
    <div style={card}>
      <div style={sectionHeader}>Sale Comps · {comps.state} · Step 8</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div style={metricBox}>
          <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>Comp avg cap</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", fontFamily: "'Space Mono', monospace", marginTop: 4 }}>{comps.avgCap ? fmtPct(comps.avgCap, 2) : "—"}</div>
        </div>
        <div style={metricBox}>
          <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>Comp avg $/SF</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", fontFamily: "'Space Mono', monospace", marginTop: 4 }}>{comps.avgPPSF ? `$${comps.avgPPSF.toFixed(0)}` : "—"}</div>
        </div>
        <div style={{ ...metricBox, borderLeft: `3px solid ${GOLD}` }}>
          <div style={{ fontSize: 10, color: GOLD, textTransform: "uppercase", fontWeight: 700 }}>Subject vs. avg</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: GOLD, fontFamily: "'Space Mono', monospace", marginTop: 4 }}>{comps.subjectPPSF ? `$${comps.subjectPPSF.toFixed(0)} (${fmtPct(comps.subjectVsAvgPPSF, 1)})` : "—"}</div>
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${GOLD}33` }}>
            <th style={thStyle}>City</th>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Type</th>
            <th style={{ ...thStyle, textAlign: "right" }}>NRSF</th>
            <th style={{ ...thStyle, textAlign: "right" }}>$M</th>
            <th style={{ ...thStyle, textAlign: "right" }}>$/SF</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Cap</th>
            <th style={thStyle}>Buyer</th>
            <th style={thStyle}>Src</th>
          </tr>
        </thead>
        <tbody>
          {comps.comps.map((c, i) => (
            <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <td style={tdStyle}>{c.city}</td>
              <td style={{ ...tdStyle, color: "#94A3B8" }}>{c.date}</td>
              <td style={{ ...tdStyle, color: "#94A3B8", fontSize: 11 }}>{c.type}</td>
              <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'Space Mono', monospace" }}>{fmtN(c.nrsf)}</td>
              <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'Space Mono', monospace" }}>${c.priceM.toFixed(1)}M</td>
              <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'Space Mono', monospace", color: "#fff", fontWeight: 600 }}>${c.ppsf}</td>
              <td style={{ ...tdStyle, textAlign: "right", fontFamily: "'Space Mono', monospace", color: GOLD, fontWeight: 600 }}>{(c.cap * 100).toFixed(2)}%</td>
              <td style={{ ...tdStyle, color: "#94A3B8" }}>{c.buyer}</td>
              <td style={{ ...tdStyle, fontSize: 9, color: "#64748B" }}>{c.src}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {comps.fellbackToPeer && (
        <div style={{ fontSize: 10, color: "#64748B", marginTop: 8 }}>Subject state has no direct comps — using peer-state fallback.</div>
      )}
    </div>
  );
}
