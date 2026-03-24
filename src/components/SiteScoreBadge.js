// ─── SiteScore Badge Component ───
// Extracted from App.js for modular component architecture
// v2: Clickable bars with source attribution popovers
import React, { useState } from "react";

export default function SiteScoreBadge({ site, size = "normal", iq: iqProp, computeSiteScore }) {
  const iq = iqProp || (computeSiteScore ? computeSiteScore(site) : { score: 0, tier: "gray", label: "N/A", flags: [], scores: {}, classification: "", breakdown: [] });
  const s = iq.score;
  const isGold = iq.tier === "gold";
  const isSmall = size === "small";
  const [activeBar, setActiveBar] = useState(null);

  const tierColors = {
    gold: { bg: "linear-gradient(135deg, #C9A84C, #FFD700, #C9A84C)", glow: "0 0 24px rgba(201,168,76,0.5), 0 0 48px rgba(201,168,76,0.2), 0 0 4px rgba(255,215,0,0.8)", text: "#0a0a0a", ring: "#C9A84C", labelBg: "linear-gradient(135deg, #FFFBEB, #FFF8ED)" },
    steel: { bg: "linear-gradient(135deg, #1a1a2e, #2C3E6B, #1a1a2e)", glow: "0 2px 12px rgba(44,62,107,0.35), 0 0 2px rgba(243,124,51,0.2)", text: "#fff", ring: "#F37C33", labelBg: "linear-gradient(135deg, #E8EAF6, #F0F2FF)" },
    gray: { bg: "linear-gradient(135deg, #3a3a4a, #4a4a5a, #3a3a4a)", glow: "0 2px 8px rgba(0,0,0,0.2)", text: "#94A3B8", ring: "#64748B", labelBg: "rgba(15,21,56,0.3)" },
  };
  const tc = tierColors[iq.tier] || tierColors.gray;

  // Get breakdown info for a dimension key
  const getBreakdown = (key) => (iq.breakdown || []).find(b => b.key === key);

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

  const dims = [
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
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", position: "relative" }}>
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
        <div style={{ display: "flex", gap: 5, marginTop: 8, alignItems: "flex-end", height: 64, position: "relative" }}>
          {dims.map((f) => {
            const v = iq.scores[f.key] || 0;
            const pct = Math.max(8, (v / 10) * 100);
            const c = v >= 8 ? "#F37C33" : v >= 6 ? "#3B82F6" : v >= 4 ? "#F59E0B" : "#EF4444";
            const bd = getBreakdown(f.key);
            const isActive = activeBar === f.key;
            return (
              <div key={f.key} onClick={(e) => { e.stopPropagation(); setActiveBar(isActive ? null : f.key); }} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: 24, cursor: "pointer", position: "relative", zIndex: isActive ? 100 : 1 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: c, fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{v}</div>
                <div style={{ width: isActive ? 20 : 16, height: 40, borderRadius: 4, background: "rgba(0,0,0,0.06)", position: "relative", overflow: "hidden", transition: "width 0.15s ease", border: isActive ? `1px solid ${c}80` : "1px solid transparent" }}>
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${pct}%`, borderRadius: 4, background: `linear-gradient(180deg, ${c}, ${c}99)`, transition: "height 0.5s cubic-bezier(0.4,0,0.2,1)", boxShadow: v >= 8 ? `0 0 8px ${c}50` : "none" }} />
                </div>
                <div style={{ fontSize: 8, fontWeight: 700, color: isActive ? c : "#94A3B8", letterSpacing: "0.02em", lineHeight: 1, transition: "color 0.15s" }}>{f.label}</div>
                {/* Source popover */}
                {isActive && bd && (
                  <div onClick={(e) => e.stopPropagation()} style={{
                    position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
                    width: 280, padding: "12px 14px", borderRadius: 10,
                    background: "linear-gradient(135deg, rgba(10,10,20,0.98), rgba(15,21,56,0.98))",
                    border: `1px solid ${c}40`, boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 12px ${c}15`,
                    zIndex: 1000, animation: "fadeIn 0.15s ease-out",
                  }}>
                    {/* Arrow */}
                    <div style={{ position: "absolute", top: -6, left: "50%", transform: "translateX(-50%)", width: 12, height: 12, background: "rgba(10,10,20,0.98)", border: `1px solid ${c}40`, borderRight: "none", borderBottom: "none", transform: "translateX(-50%) rotate(45deg)" }} />
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: "#E2E8F0", letterSpacing: "0.06em" }}>{bd.label}</span>
                        <span style={{ fontSize: 16, fontWeight: 900, color: c, fontFamily: "'Space Mono', monospace" }}>{v}/10</span>
                      </div>
                      {bd.verified
                        ? <span style={{ fontSize: 7, fontWeight: 800, color: "#22C55E", background: "rgba(34,197,94,0.15)", padding: "2px 6px", borderRadius: 3, letterSpacing: "0.08em" }}>VERIFIED</span>
                        : <span style={{ fontSize: 7, fontWeight: 800, color: "#F59E0B", background: "rgba(245,158,11,0.15)", padding: "2px 6px", borderRadius: 3, letterSpacing: "0.08em" }}>UNVERIFIED</span>
                      }
                    </div>
                    {/* Raw value */}
                    {bd.rawValue && (
                      <div style={{ background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 6, padding: "6px 10px", marginBottom: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#C9A84C", fontFamily: "'Space Mono', monospace" }}>{bd.rawValue}</div>
                      </div>
                    )}
                    {/* Source */}
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 7, fontWeight: 800, color: "#4A5080", letterSpacing: "0.12em", marginBottom: 2 }}>DATA SOURCE</div>
                      <div style={{ fontSize: 10, color: "#E2E8F0", fontWeight: 600 }}>{bd.source}</div>
                    </div>
                    {/* Methodology */}
                    <div style={{ marginBottom: bd.url ? 6 : 0 }}>
                      <div style={{ fontSize: 7, fontWeight: 800, color: "#4A5080", letterSpacing: "0.12em", marginBottom: 2 }}>METHODOLOGY</div>
                      <div style={{ fontSize: 9, color: "#94A3B8", lineHeight: 1.5 }}>{bd.methodology}</div>
                    </div>
                    {/* Source URL if available */}
                    {bd.url && (
                      <div>
                        <div style={{ fontSize: 7, fontWeight: 800, color: "#4A5080", letterSpacing: "0.12em", marginBottom: 2 }}>SOURCE URL</div>
                        <a href={bd.url} target="_blank" rel="noreferrer" style={{ fontSize: 9, color: "#3B82F6", wordBreak: "break-all" }}>{bd.url}</a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* Click-away overlay to close popover */}
      {activeBar && <div onClick={() => setActiveBar(null)} style={{ position: "fixed", inset: 0, zIndex: 99 }} />}
    </div>
  );
}
