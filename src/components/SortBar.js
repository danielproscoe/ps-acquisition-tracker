// src/components/SortBar.js
// Pure sort-bar component extracted from App.js

import React from "react";

export const SORT_OPTIONS = [
  { key: "sitescore", label: "SiteScore™ (Best)" },
  { key: "name", label: "Name (A→Z)" },
  { key: "city", label: "City (A→Z)" },
  { key: "recent", label: "Recently Added" },
  { key: "dom", label: "Days on Market" },
  { key: "priority", label: "Priority" },
  { key: "phase", label: "Phase" },
];

export function SortBar({ sortBy, setSortBy, sortOptions }) {
  const options = sortOptions || SORT_OPTIONS;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#6B7394" }}>Sort:</span>
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => setSortBy(o.key)}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: sortBy === o.key ? "1px solid #E87A2E" : "1px solid rgba(201,168,76,0.12)",
            background: sortBy === o.key ? "rgba(232,122,46,0.12)" : "rgba(15,21,56,0.4)",
            color: sortBy === o.key ? "#E87A2E" : "#6B7394",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "'Inter'",
            transition: "all 0.15s",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default SortBar;
