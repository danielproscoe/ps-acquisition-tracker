// CalibrationView.js — Storvex Asset Analyzer Calibration Loop
//
// Tracks Storvex's PSA Lens verdict vs PSA's actual decision on the same
// deal. Every saved analysis becomes a calibration data point. After 20-50
// deals, the hit rate becomes Reza's credibility test:
//
//   "Storvex independently agreed with PSA's UW team on N of M deals.
//    The disagreements were always more conservative on Storvex's side."
//
// Without this loop, every PS Lens output is just theory. With it, the
// model's accuracy is auditable, traceable, and defensible to PSA's IC.

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ref, onValue, update, off } from "firebase/database";
import { db } from "../firebase";
import { fmt$ } from "../utils";

const NAVY = "#1E2761";
const GOLD = "#C9A84C";
const ICE = "#D6E4F7";
const PS_BLUE = "#3B82F6";

const card = {
  background: "rgba(15,21,56,0.6)",
  border: "1px solid rgba(201,168,76,0.12)",
  borderRadius: 14,
  padding: 24,
  marginBottom: 16,
};

const ACTUAL_OUTCOME_OPTIONS = [
  { key: "", label: "— pending —" },
  { key: "PURSUED", label: "Buyer Pursued" },
  { key: "LOI_SIGNED", label: "Buyer Signed LOI" },
  { key: "PSA_SENT", label: "Buyer Active (PSA / counter)" },
  { key: "UNDER_CONTRACT", label: "Under Contract" },
  { key: "CLOSED", label: "Closed" },
  { key: "PASSED", label: "Buyer Passed" },
  { key: "KILLED", label: "Killed (any party)" },
];

// Map PSA actual decision to "agree with Storvex verdict" classification
function classifyAgreement(storvexVerdict, actualOutcome) {
  if (!actualOutcome) return null; // pending
  const positiveOutcomes = ["PURSUED", "LOI_SIGNED", "PSA_SENT", "UNDER_CONTRACT", "CLOSED"];
  const negativeOutcomes = ["PASSED", "KILLED"];
  const psaPositive = positiveOutcomes.includes(actualOutcome);
  const psaNegative = negativeOutcomes.includes(actualOutcome);
  const storvexPositive = storvexVerdict === "PURSUE";
  const storvexNegotiate = storvexVerdict === "NEGOTIATE";
  const storvexNegative = storvexVerdict === "PASS";

  if (psaPositive && (storvexPositive || storvexNegotiate)) return "AGREE";
  if (psaNegative && storvexNegative) return "AGREE";
  if (psaNegative && storvexNegotiate) return "PARTIAL"; // Storvex flagged risk
  if (psaPositive && storvexNegative) return "DISAGREE_STORVEX_TOO_CONSERVATIVE";
  if (psaNegative && storvexPositive) return "DISAGREE_STORVEX_TOO_AGGRESSIVE";
  return "PARTIAL";
}

export default function CalibrationView({ notify }) {
  const [analyses, setAnalyses] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  // Subscribe to existingAssets/ Firebase path
  useEffect(() => {
    const r = ref(db, "existingAssets");
    const handler = onValue(
      r,
      (snap) => {
        const data = snap.val() || {};
        setAnalyses(data);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => off(r, "value", handler);
  }, []);

  const records = useMemo(() => {
    return Object.entries(analyses)
      .map(([id, rec]) => ({ id, ...rec }))
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [analyses]);

  const stats = useMemo(() => {
    const total = records.length;
    const confirmed = records.filter((r) => r.actualOutcome).length;
    const pending = total - confirmed;
    let agree = 0;
    let partial = 0;
    let storvexConservative = 0;
    let storvexAggressive = 0;
    records.forEach((r) => {
      const verdict = r.analysis?.psLensVerdict || r.analysis?.verdict?.label;
      const cls = classifyAgreement(verdict, r.actualOutcome);
      if (cls === "AGREE") agree++;
      else if (cls === "PARTIAL") partial++;
      else if (cls === "DISAGREE_STORVEX_TOO_CONSERVATIVE") storvexConservative++;
      else if (cls === "DISAGREE_STORVEX_TOO_AGGRESSIVE") storvexAggressive++;
    });
    const hitRate = confirmed > 0 ? agree / confirmed : 0;
    return { total, confirmed, pending, agree, partial, storvexConservative, storvexAggressive, hitRate };
  }, [records]);

  const updateOutcome = useCallback(
    async (id, field, value) => {
      setSavingId(id);
      try {
        await update(ref(db, `existingAssets/${id}`), { [field]: value, calibrationUpdatedAt: new Date().toISOString() });
      } catch (e) {
        if (notify) notify(`Save failed: ${e.message || e}`, "error");
      } finally {
        setSavingId(null);
      }
    },
    [notify]
  );

  if (loading) {
    return (
      <div style={{ ...card, textAlign: "center", padding: 40, color: "#94A3B8" }}>
        Loading calibration data…
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeIn 0.3s ease-out", color: "#E2E8F0", fontFamily: "'Inter', sans-serif" }}>
      <Header />
      <CalibrationStats stats={stats} />
      <RecordsTable
        records={records}
        savingId={savingId}
        onUpdateOutcome={(id, val) => updateOutcome(id, "actualOutcome", val)}
        onUpdateNote={(id, val) => updateOutcome(id, "calibrationNote", val)}
      />
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────
function Header() {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 26, lineHeight: 1 }}>🎯</span>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>Calibration</h1>
        <span style={{ fontSize: 10, fontWeight: 700, color: PS_BLUE, background: "rgba(59,130,246,0.12)", border: `1px solid ${PS_BLUE}40`, padding: "3px 9px", borderRadius: 999, letterSpacing: "0.06em", textTransform: "uppercase" }}>Storvex vs Buyer Decisions</span>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "#94A3B8", maxWidth: 720, lineHeight: 1.5 }}>
        Track every Storvex institutional verdict against the actual buyer decision when it lands. Hit rate = credibility. After 20-50 deals, this is what proves the model to a buyer's IC: <em>"Storvex independently agreed with our team on N of M — disagreements were always more conservative on Storvex's side."</em>
      </p>
    </div>
  );
}

// ─── Aggregate Stats ──────────────────────────────────────────────────────
function CalibrationStats({ stats }) {
  const tiles = [
    { label: "Total Runs", value: stats.total, color: GOLD },
    { label: "Confirmed", value: stats.confirmed, color: "#22C55E", sub: `${stats.pending} pending` },
    { label: "Agree", value: stats.agree, color: "#22C55E", sub: stats.confirmed > 0 ? `${(stats.hitRate * 100).toFixed(0)}% hit rate` : "—" },
    { label: "Partial", value: stats.partial, color: "#F59E0B", sub: "Storvex flagged risk" },
    { label: "Too Conservative", value: stats.storvexConservative, color: ICE, sub: "Storvex PASS, Buyer Pursued" },
    { label: "Too Aggressive", value: stats.storvexAggressive, color: "#EF4444", sub: "Storvex PURSUE, Buyer Passed" },
  ];

  return (
    <div style={card}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>Aggregate · Storvex vs Buyer Decisions</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ background: "rgba(0,0,0,0.25)", padding: "14px 16px", borderRadius: 10, borderLeft: `3px solid ${t.color}` }}>
            <div style={{ fontSize: 9, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>{t.label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: t.color, marginTop: 4, fontFamily: "'Space Mono', monospace" }}>{t.value}</div>
            {t.sub && <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>{t.sub}</div>}
          </div>
        ))}
      </div>
      {stats.confirmed === 0 && (
        <div style={{ marginTop: 14, padding: 12, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, fontSize: 11, color: "#FCD34D" }}>
          No confirmed outcomes yet. As the buyer actually decides on the deals you've underwritten via Storvex, log the outcome below to start building the calibration curve.
        </div>
      )}
    </div>
  );
}

// ─── Records Table ────────────────────────────────────────────────────────
function RecordsTable({ records, savingId, onUpdateOutcome, onUpdateNote }) {
  if (records.length === 0) {
    return (
      <div style={{ ...card, textAlign: "center", padding: 40, color: "#64748B" }}>
        <div style={{ fontSize: 36, opacity: 0.3, marginBottom: 10 }}>🎯</div>
        <div style={{ fontSize: 13, color: "#94A3B8" }}>No saved analyses yet.</div>
        <div style={{ fontSize: 11, color: "#64748B", marginTop: 6 }}>Run a deal through the Asset Analyzer and click "Save Analysis" to begin tracking calibration.</div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>All Saved Analyses</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${GOLD}33` }}>
              <th style={th}>Property</th>
              <th style={th}>Date</th>
              <th style={th}>State</th>
              <th style={th}>Ask</th>
              <th style={th}>Storvex Verdict</th>
              <th style={th}>Storvex Walk</th>
              <th style={th}>Buyer Actual Decision</th>
              <th style={th}>Note</th>
              <th style={th}>Match</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <RecordRow
                key={r.id}
                record={r}
                saving={savingId === r.id}
                onUpdateOutcome={onUpdateOutcome}
                onUpdateNote={onUpdateNote}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = { textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" };
const td = { padding: "10px", fontSize: 12, color: "#E2E8F0", verticalAlign: "top" };

function RecordRow({ record, saving, onUpdateOutcome, onUpdateNote }) {
  const a = record.analysis || {};
  const snapshot = a.snapshot || {};
  // PSA Lens verdict — fall back to generic verdict if PSA-Lens not stored on the record
  const psLensVerdict = record.psLens?.verdict?.label || a.verdict?.label || "—";
  const psLensWalk = record.psLens?.tiers?.walk?.price || a.tiers?.walk?.price || null;
  const verdictColor = psLensVerdict === "PURSUE" ? "#22C55E" : psLensVerdict === "NEGOTIATE" ? "#F59E0B" : psLensVerdict === "PASS" ? "#EF4444" : "#94A3B8";
  const date = (record.createdAt || "").slice(0, 10);
  const cls = classifyAgreement(psLensVerdict, record.actualOutcome);
  const matchBadge = clsBadge(cls);
  const [noteDraft, setNoteDraft] = useState(record.calibrationNote || "");

  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <td style={{ ...td, fontWeight: 600, maxWidth: 220 }}>
        <div style={{ color: "#fff" }}>{snapshot.name || record.id}</div>
        <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>{snapshot.address || record.id.slice(0, 10)}</div>
      </td>
      <td style={{ ...td, color: "#94A3B8", whiteSpace: "nowrap" }}>{date}</td>
      <td style={{ ...td, color: "#94A3B8", textTransform: "uppercase" }}>{snapshot.state || "—"}</td>
      <td style={{ ...td, fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap" }}>{snapshot.ask ? fmt$(snapshot.ask) : "—"}</td>
      <td style={{ ...td }}>
        <span style={{ fontWeight: 800, color: verdictColor }}>{psLensVerdict}</span>
      </td>
      <td style={{ ...td, fontFamily: "'Space Mono', monospace", color: PS_BLUE, whiteSpace: "nowrap" }}>{psLensWalk ? fmt$(Math.round(psLensWalk)) : "—"}</td>
      <td style={{ ...td, minWidth: 180 }}>
        <select
          value={record.actualOutcome || ""}
          onChange={(e) => onUpdateOutcome(record.id, e.target.value)}
          disabled={saving}
          style={{ width: "100%", padding: "6px 10px", fontSize: 11, borderRadius: 6, border: "1px solid rgba(201,168,76,0.25)", background: "rgba(0,0,0,0.4)", color: "#fff", fontFamily: "'Inter', sans-serif" }}
        >
          {ACTUAL_OUTCOME_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
      </td>
      <td style={{ ...td, minWidth: 200 }}>
        <input
          type="text"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={() => { if (noteDraft !== (record.calibrationNote || "")) onUpdateNote(record.id, noteDraft); }}
          placeholder="DW said... / REIC outcome..."
          disabled={saving}
          style={{ width: "100%", padding: "6px 10px", fontSize: 11, borderRadius: 6, border: "1px solid rgba(201,168,76,0.15)", background: "rgba(0,0,0,0.4)", color: "#fff", fontFamily: "'Inter', sans-serif" }}
        />
      </td>
      <td style={{ ...td, textAlign: "center", whiteSpace: "nowrap" }}>{matchBadge}</td>
    </tr>
  );
}

function clsBadge(cls) {
  const cfg = {
    AGREE: { label: "✓ AGREE", color: "#22C55E", bg: "rgba(34,197,94,0.12)" },
    PARTIAL: { label: "~ PARTIAL", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
    DISAGREE_STORVEX_TOO_CONSERVATIVE: { label: "← TOO CONSERV", color: "#94A3B8", bg: "rgba(214,228,247,0.12)" },
    DISAGREE_STORVEX_TOO_AGGRESSIVE: { label: "→ TOO AGGRO", color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
  };
  if (!cls) {
    return <span style={{ fontSize: 9, color: "#64748B", padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.04)" }}>—</span>;
  }
  const c = cfg[cls];
  return <span style={{ fontSize: 9, color: c.color, padding: "3px 7px", borderRadius: 4, background: c.bg, fontWeight: 700, letterSpacing: "0.04em" }}>{c.label}</span>;
}
