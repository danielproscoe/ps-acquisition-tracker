// ─── SiteScore Badge Component ───
// Extracted from App.js for modular component architecture
import React from "react";

export default function SiteScoreBadge({ site, size = "normal", iq: iqProp, computeSiteScore }) {
  const iq = iqProp || (computeSiteScore ? computeSiteScore(site) : { score: 0, tier: "gray", label: "N/A", flags: [], scores: {}, classification: "" });
  const s = iq.score;
  const isGold = iq.tier === "gold";
  const isSmall = size === "small";

  const tierColors = {
    gold: { bg: "linear-gradient(135deg, #C9A84C, #FFD700, #C9A84C)", glow: "0 0 24px rgba(201,168,76,0.5), 0 0 48px rgba(201,168,76,0.2), 0 0 4px rgba(255,215,0,0.8)", text: "#0a0a0a", ring: "#C9A84C", labelBg: "linear-gradient(135deg, #FFFBEB, #FFF8ED)" },
    steel: { bg: "linear-gradient(135deg, #1a1a2e, #2C3E6B, #1a1a2e)", glow: "0 2px 12px rgba(44,62,107,0.35), 0 0 2px rgba(243,124,51,0.2)", text: "#fff", ring: "#F37C33", labelBg: "linear-gradient(135deg, #E8EAF6, #F0F2FF)" },
    gray: { bg: "linear-gradient(135deg, #3a3a4a, #4a4a5a, #3a3a4a)", glow: "0 2px 8px rgba(0,0,0,0.2)", text: "#94A3B8", ring: "#64748B", labelBg: "rgba(15,21,56,0.3)" },
  };
  const tc = tierColors[iq.tier] || tierColors.gray;

  if (isSmall) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "3px 10px", borderRadius: 8,
        background: tc.labelBg,
        border: `1px solid ${tc.ring}28`,
        fontSize: 11, fontWeight: 700, color: iq.tier === "gold" ? "#D45500" : iq.tier === "steel" ? "#1E2761" : "#64748B",
        fontFamily: "'Space Mono', monospace",
        transition: "all 0.3s ease",
        boxShadow: iq.tier === "gold" ? "0 0 8px rgba(243,124,51,0.15)" : "none",
      }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "inherit", opacity: 0.85 }}>S</span>
        {s.toFixed(2)}
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
          <div style={{ fontSize: 24, fontWeight: 900, color: tc.text, fontFamily: "'Space Mono', monospace", letterSpacing: "-0.02em" }}>{s.toFixed(2)}</div>
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
            background: tc.labelBg,
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
