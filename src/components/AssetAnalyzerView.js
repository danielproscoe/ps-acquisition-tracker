// AssetAnalyzerView.js — Storvex Asset Analyzer panel.
// Vets existing-stabilized self-storage acquisitions using the institutional
// 8-step framework from memory/valuation-framework.md.
//
// Companion to ground-up SiteScore (which vets land for build-to-suit).
// Demos Storvex's dual-acquisition coverage to PS VP Reza Mahdavian
// (memory/project_ps-vp-reit-platform-elevation.md).

import React, { useState, useMemo, useCallback } from "react";
import { analyzeExistingAsset, MSA_TIER_CAP_ADJUST, DEAL_TYPES } from "../existingAssetAnalysis";
import { computeBuyerLens, PS_LENS } from "../buyerLensProfiles";
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
  listingBroker: "Marcus & Millichap",
  listingSource: "M&M",
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
];

const LISTING_SOURCE_OPTIONS = [
  "Crexi", "LoopNet", "M&M", "CBRE", "JLL", "Colliers", "Off-market", "Other",
];

// ─── Field group definitions for clean rendering ──────────────────────────
const FIELD_GROUPS = [
  {
    title: "Property",
    fields: [
      { key: "name", label: "Property name / address", type: "text", placeholder: "e.g. Red Rock Mega Storage" },
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
    title: "PS Lens Inputs",
    fields: [
      { key: "nearestPortfolioMi", label: "Distance to nearest PS family facility (mi) — for portfolio-fit bonus", type: "number", placeholder: "e.g. 3 for −25 bps cap" },
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

export default function AssetAnalyzerView({ fbSet, notify }) {
  const [inputs, setInputs] = useState(EMPTY_INPUTS);
  const [savedId, setSavedId] = useState(null);
  const [saving, setSaving] = useState(false);

  const setField = useCallback((key, value) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
    setSavedId(null);
  }, []);

  const loadDemo = useCallback(() => {
    setInputs(RED_ROCK_DEFAULTS);
    setSavedId(null);
  }, []);

  const clearAll = useCallback(() => {
    setInputs(EMPTY_INPUTS);
    setSavedId(null);
  }, []);

  const parsed = useMemo(() => parseInputs(inputs), [inputs]);
  const ready = useMemo(() => readyToAnalyze(parsed), [parsed]);
  const analysis = useMemo(
    () => (ready ? analyzeExistingAsset(parsed) : null),
    [parsed, ready]
  );
  const psLens = useMemo(
    () => (ready ? computeBuyerLens(parsed, PS_LENS, { nearestPortfolioMi: parsed.nearestPortfolioMi }) : null),
    [parsed, ready]
  );

  const handleSave = useCallback(async () => {
    if (!analysis || !fbSet) return;
    setSaving(true);
    try {
      const id = uid();
      const record = {
        id,
        inputs,
        analysis,
        createdAt: new Date().toISOString(),
        version: "v1",
      };
      await fbSet(`existingAssets/${id}`, record);
      setSavedId(id);
      if (notify) notify(`Analysis saved · ${id.slice(0, 8)}`, "success");
    } catch (e) {
      if (notify) notify(`Save failed: ${e.message || e}`, "error");
    } finally {
      setSaving(false);
    }
  }, [analysis, inputs, fbSet, notify]);

  return (
    <div style={{ animation: "fadeIn 0.3s ease-out", color: "#E2E8F0", fontFamily: "'Inter', sans-serif" }}>
      <Header onLoadDemo={loadDemo} onClear={clearAll} onSave={handleSave} canSave={!!analysis} saving={saving} savedId={savedId} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 20, alignItems: "flex-start" }}>
        <FormPanel inputs={inputs} setField={setField} />
        <OutputsPanel analysis={analysis} psLens={psLens} ready={ready} />
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────
function Header({ onLoadDemo, onClear, onSave, canSave, saving, savedId }) {
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
        <button onClick={onLoadDemo} style={btnGhost} title="Pre-load Red Rock Mega Storage Reno NV (4/21/26 PASS calibration deal)">⤓ Load demo</button>
        <button onClick={onClear} style={btnGhost}>Clear</button>
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

// ─── Form Panel ───────────────────────────────────────────────────────────
function FormPanel({ inputs, setField }) {
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
function OutputsPanel({ analysis, psLens, ready }) {
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
      <VerdictHero analysis={analysis} />
      <DealTypeBadge dealType={analysis.dealType} />
      <SnapshotCard snapshot={analysis.snapshot} />
      <ReconstructedNOICard reconstructed={analysis.reconstructed} sellerNOI={analysis.snapshot.sellerNOI} />
      <ProjectionCard projection={analysis.projection} />
      <ValuationMatrixCard matrix={analysis.matrix} ask={analysis.snapshot.ask} />
      <PriceTiersCard tiers={analysis.tiers} ask={analysis.snapshot.ask} marketCap={analysis.marketCap} msaTier={analysis.msaTier} />
      {psLens && <PSLensCard psLens={psLens} generic={analysis} />}
      <CompGridCard comps={analysis.comps} subjectAsk={analysis.snapshot.ask} />
    </div>
  );
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
          <div style={{ fontSize: 11, fontWeight: 700, color: PS_BLUE, textTransform: "uppercase", letterSpacing: "0.08em" }}>PS Lens · Public Storage Underwrite</div>
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4, lineHeight: 1.5 }}>{psLens.lens.description}</div>
        </div>
        <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: PS_BLUE, padding: "5px 10px", borderRadius: 999, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{psLens.lens.badgeText}</span>
      </div>

      {/* Lens-driven verdict */}
      <div style={{ marginBottom: 14, padding: 14, borderRadius: 10, background: verdictBg, border: `1px solid ${v.color}80` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em" }}>PS Lens Verdict</div>
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
          <div style={{ fontSize: 9, color: PS_BLUE, fontWeight: 700, textTransform: "uppercase" }}>PS Cap Rate</div>
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
            <th style={{ ...thStyle, textAlign: "right", color: PS_BLUE }}>PS</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Δ (PS Premium)</th>
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
        Cap basis: {psLens.lens.capBasis}. PS premium = (PS price − Generic price). The Δ column quantifies the platform-fit value PS would pay above a generic institutional buyer.
      </div>
    </div>
  );
}

// ─── Verdict Hero ─────────────────────────────────────────────────────────
function VerdictHero({ analysis }) {
  const v = analysis.verdict;
  const bg = v.label === "PURSUE" ? "rgba(34,197,94,0.12)" : v.label === "NEGOTIATE" ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)";
  const border = v.label === "PURSUE" ? "#22C55E" : v.label === "NEGOTIATE" ? "#F59E0B" : "#EF4444";
  return (
    <div style={{ ...card, background: `linear-gradient(135deg, ${bg}, rgba(15,21,56,0.6))`, border: `2px solid ${border}80`, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Verdict</div>
          <div style={{ fontSize: 36, fontWeight: 900, color: v.color, letterSpacing: "-0.02em", lineHeight: 1, marginBottom: 8 }}>{v.label}</div>
          <div style={{ fontSize: 13, color: "#E2E8F0", lineHeight: 1.5, maxWidth: 600 }}>{v.rationale}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Cap on Ask</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", fontFamily: "'Space Mono', monospace", marginTop: 4 }}>{fmtPct(analysis.snapshot.capOnAsk, 2)}</div>
          {analysis.snapshot.doaFlag && <div style={{ fontSize: 10, color: "#EF4444", fontWeight: 700, marginTop: 4 }}>⚠ DOA cap rate</div>}
        </div>
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
      <div style={sectionHeader}>DJR Price Tiers · Step 6</div>
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
