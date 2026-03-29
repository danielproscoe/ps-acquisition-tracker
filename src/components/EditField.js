// ─── EditField (EF) — Reusable inline edit component ───
// Extracted from App.js for modular component architecture
import React, { useState, useEffect, useRef } from "react";

export default function EF({ label, value, onSave, placeholder, multi }) {
  const [local, setLocal] = useState(value || "");
  const prevValue = useRef(value);
  const focused = useRef(false);
  useEffect(() => {
    // Don't overwrite local state while user is actively typing
    if (!focused.current && value !== prevValue.current) {
      setLocal(value || "");
      prevValue.current = value;
    }
  }, [value]);
  const st = {
    width: "100%",
    padding: multi ? "8px 10px" : "6px 10px",
    borderRadius: 8,
    border: "1px solid rgba(201,168,76,0.12)",
    fontSize: 13,
    fontFamily: "'Inter', sans-serif",
    background: "rgba(15,21,56,0.5)",
    color: "#E2E8F0",
    outline: "none",
    boxSizing: "border-box",
    resize: multi ? "vertical" : "none",
  };
  const handleFocus = () => { focused.current = true; };
  const handleBlur = () => {
    focused.current = false;
    prevValue.current = local;
    if (local !== (value || "")) onSave(local);
  };
  return (
    <div>
      {label && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#6B7394",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
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
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
        />
      ) : (
        <input
          style={st}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
