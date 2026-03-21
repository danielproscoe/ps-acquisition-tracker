// ─── Status Badge & Priority Badge Components ───
// Extracted from App.js for modular component architecture
import React from "react";
import { STATUS_COLORS, PRIORITY_COLORS } from "../utils";

export function Badge({ status }) {
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

export function normalizePriority(p) {
  if (!p) return p;
  const map = { hot: "🔥 Hot", warm: "🟡 Warm", cold: "🔵 Cold", none: "⚪ None" };
  const key = p.replace(/^[^a-zA-Z]+/, "").trim().toLowerCase();
  return map[key] || p;
}

export function PriorityBadge({ priority }) {
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
