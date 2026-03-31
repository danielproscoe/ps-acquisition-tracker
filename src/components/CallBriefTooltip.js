// ─── CallBriefTooltip — McKinsey-level hover card with live-editable notes ───
// Shows key site metrics + editable briefing notes on hover/click
// Auto-saves to Firebase when closed or on blur
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Extract just the dollar amount from askingPrice strings like "$1,945,000 ($300K/ac — confirmed active...)"
function cleanPrice(raw) {
  if (!raw) return "—";
  const s = String(raw).trim();
  // Match first dollar amount pattern
  const m = s.match(/^\$[\d,]+(?:\.\d+)?(?:\s*[MmKk])?/);
  return m ? m[0] : (s.length > 16 ? s.substring(0, 16) + "…" : s);
}

// Truncate long text with ellipsis
function trunc(s, max) {
  if (!s) return "—";
  return s.length > max ? s.substring(0, max) + "…" : s;
}

export default function CallBriefTooltip({ site, initialDraft, onSave, onClose, getSiteScore, anchorId }) {
  const [briefDraft, setBriefDraft] = useState(initialDraft ?? site.callBrief ?? "");
  const iq = getSiteScore ? getSiteScore(site) : null;
  const score = iq?.composite ?? iq?.score ?? null;
  const cls = score >= 8 ? "GREEN" : score >= 6 ? "YELLOW" : score >= 4 ? "ORANGE" : "RED";
  const clsColor = { GREEN: "#22C55E", YELLOW: "#FBBF24", ORANGE: "#F97316", RED: "#EF4444" }[cls] || "#6B7394";
  const zoningCls = (site.zoningClassification || "").toLowerCase();
  const zoningColor = zoningCls.includes("by-right") ? "#22C55E" : zoningCls.includes("conditional") ? "#FBBF24" : zoningCls.includes("rezone") ? "#F97316" : "#94A3B8";
  const waterStatus = (site.waterHookupStatus || "").toLowerCase();
  const waterColor = waterStatus === "by-right" ? "#22C55E" : waterStatus === "by-request" ? "#FBBF24" : waterStatus === "no-provider" ? "#EF4444" : "#94A3B8";

  const textRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  // Position the tooltip below the anchor card element
  useEffect(() => {
    const el = anchorId ? document.getElementById(anchorId) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
  }, [anchorId]);

  // Auto-focus textarea after a tick
  useEffect(() => { const t = setTimeout(() => { if (textRef.current) textRef.current.focus(); }, 100); return () => clearTimeout(t); }, []);

  // Store latest callbacks in refs to avoid stale closures
  const onSaveRef = useRef(onSave);
  const onCloseRef = useRef(onClose);
  const briefDraftRef = useRef(briefDraft);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { briefDraftRef.current = briefDraft; }, [briefDraft]);

  const fmtN = (v) => { const n = Number(v); return isNaN(n) ? v : n.toLocaleString(); };

  const metrics = [
    { label: "ASKING", value: cleanPrice(site.askingPrice) },
    { label: "ACRES", value: site.acreage ? `${site.acreage} ac` : "—" },
    { label: "3MI POP", value: site.pop3mi ? fmtN(site.pop3mi) : "—" },
    { label: "3MI HHI", value: site.income3mi ? (String(site.income3mi).startsWith("$") ? site.income3mi : `$${fmtN(site.income3mi)}`) : "—" },
  ];

  // Clean zoning display — just district + classification, not the full overlay name
  const zoningShort = site.zoning ? trunc(site.zoning.split("(")[0].trim(), 20) : "—";
  const zoningClsShort = zoningCls ? zoningCls.replace(/-/g, " ") : "";

  // Clean broker — just first name if multiple
  const brokerShort = site.sellerBroker ? trunc(site.sellerBroker.split(",")[0].split("(")[0].trim(), 24) : null;

  const pills = [
    { label: "ZONING", value: `${zoningShort}${zoningClsShort ? ` · ${zoningClsShort}` : ""}`, color: zoningColor },
    site.waterHookupStatus && { label: "WATER", value: site.waterHookupStatus.replace(/-/g, " "), color: waterColor },
    brokerShort && { label: "BROKER", value: brokerShort, color: "#C9A84C" },
    site.siteiqData?.nearestPS != null && { label: `NEAREST ${(site.siteiqData?.nearestPSBrand || "PS").toUpperCase()}`, value: `${site.siteiqData.nearestPS} mi`, color: site.siteiqData?.nearestPSBrand === "NSA" ? "#22C55E" : "#818CF8" },
    site.siteiqData?.competitorCount != null && { label: "COMP.", value: `${site.siteiqData.competitorCount} in 3mi`, color: "#94A3B8" },
  ].filter(Boolean);

  return createPortal(
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99998 }}
      onClick={(e) => { if (e.target === e.currentTarget) { onSaveRef.current(briefDraftRef.current); onCloseRef.current(); } }}>
      {/* Tooltip card — positioned inside the full-screen container so clicks stay contained */}
      <div id="call-brief-portal" style={{
        position: "absolute", top: pos.top, left: pos.left, width: pos.width || "auto",
        borderRadius: 14, overflow: "hidden",
        background: "linear-gradient(170deg, #0c0e1a 0%, #111827 50%, #0f1629 100%)",
        border: "1px solid rgba(201,168,76,0.2)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,168,76,0.08), 0 0 40px rgba(201,168,76,0.04)",
        animation: "fadeIn 0.12s ease-out",
      }}>
      {/* Gold accent bar */}
      <div style={{ height: 2, background: "linear-gradient(90deg, transparent, #C9A84C, #E87A2E, #C9A84C, transparent)" }} />

      {/* Header strip */}
      <div style={{ padding: "12px 16px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#F4F6FA", letterSpacing: "-0.01em" }}>CALL BRIEFING</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: clsColor, background: `${clsColor}15`, padding: "2px 8px", borderRadius: 5, border: `1px solid ${clsColor}30` }}>
            {score ? `${score.toFixed(1)} ${cls}` : "—"}
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#6B7394" }}>{site.phase || "Prospect"}</span>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ background: "none", border: "none", color: "#6B7394", fontSize: 14, cursor: "pointer", padding: "2px 6px", borderRadius: 4, lineHeight: 1 }} title="Close (Esc)">✕</button>
      </div>

      {/* Key metrics row — minWidth:0 forces grid cells to respect overflow */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, padding: "0 12px 10px" }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px", border: "1px solid rgba(255,255,255,0.05)", minWidth: 0, overflow: "hidden" }}>
            <div style={{ fontSize: 8, fontWeight: 800, color: "#4A5080", letterSpacing: "0.1em", marginBottom: 2 }}>{m.label}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#E2E8F0", fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Status pills */}
      <div style={{ display: "flex", gap: 6, padding: "0 12px 10px", flexWrap: "wrap" }}>
        {pills.map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: `${p.color}10`, padding: "4px 10px", borderRadius: 6, border: `1px solid ${p.color}25`, maxWidth: "100%", overflow: "hidden" }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#6B7394", letterSpacing: "0.06em", flexShrink: 0 }}>{p.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: p.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.value}</span>
          </div>
        ))}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(201,168,76,0.12), transparent)", margin: "0 12px" }} />

      {/* Editable briefing notes */}
      <div style={{ padding: "10px 12px 12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: "#6B7394", letterSpacing: "0.1em" }}>BRIEFING NOTES</span>
          <span style={{ fontSize: 8, color: "#4A5080", fontWeight: 600 }}>auto-saves on close · Esc to dismiss</span>
        </div>
        <textarea
          ref={textRef}
          value={briefDraft}
          onChange={(e) => setBriefDraft(e.target.value)}
          onBlur={() => onSave(briefDraft)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Escape") { onSave(briefDraft); onClose(); } e.stopPropagation(); }}
          placeholder="Type call notes here — auto-saves when you close..."
          style={{
            width: "100%", minHeight: 80, maxHeight: 200, padding: "10px 12px",
            borderRadius: 10, border: "1px solid rgba(201,168,76,0.1)",
            background: "rgba(15,21,56,0.6)", color: "#E2E8F0",
            fontSize: 12, fontFamily: "'Inter', sans-serif", lineHeight: 1.6,
            resize: "vertical", outline: "none", boxSizing: "border-box",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => { e.target.style.borderColor = "rgba(232,122,46,0.3)"; }}
        />
      </div>
      </div>
    </div>,
    document.body
  );
}
