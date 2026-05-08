// ─── InlineNoteRow — Always-visible note input on collapsed tracker cards ───
// Lives below IntelCardHeader. Saves on blur to latestNote + latestNoteDate
// and pushes the text to activityLog so history is preserved (CLAUDE.md §6h Step 2b).
import React, { useState, useEffect, useRef } from "react";

export default function InlineNoteRow({ site, onSave }) {
  const initial = site.latestNote || "";
  const [local, setLocal] = useState(initial);
  const prevValue = useRef(initial);
  const focused = useRef(false);
  const taRef = useRef(null);

  useEffect(() => {
    if (!focused.current && initial !== prevValue.current) {
      setLocal(initial);
      prevValue.current = initial;
    }
  }, [initial]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(34, el.scrollHeight) + "px";
  }, [local]);

  const handleBlur = () => {
    focused.current = false;
    if (local !== prevValue.current) {
      prevValue.current = local;
      onSave(local);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      e.currentTarget.blur();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        padding: "10px 22px 14px",
        borderTop: "1px solid rgba(201,168,76,0.06)",
        background: "rgba(8,12,32,0.35)",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          color: "#4A5080",
          letterSpacing: "0.16em",
          paddingTop: 10,
          minWidth: 44,
          userSelect: "none",
        }}
      >
        NOTES
      </span>
      <textarea
        ref={taRef}
        value={local}
        placeholder="Type a note…  (saves on blur · ⌘/Ctrl+Enter to save)"
        onChange={(e) => setLocal(e.target.value)}
        onFocus={() => { focused.current = true; }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        rows={1}
        spellCheck={true}
        style={{
          flex: 1,
          minHeight: 34,
          maxHeight: 240,
          padding: "8px 12px",
          borderRadius: 6,
          border: "1px solid rgba(201,168,76,0.10)",
          background: "rgba(15,21,56,0.45)",
          color: "#E2E8F0",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Inter', sans-serif",
          fontSize: 12.5,
          lineHeight: 1.5,
          resize: "none",
          outline: "none",
          boxSizing: "border-box",
          transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={(e) => {
          if (document.activeElement !== e.currentTarget) {
            e.currentTarget.style.borderColor = "rgba(201,168,76,0.22)";
          }
        }}
        onMouseLeave={(e) => {
          if (document.activeElement !== e.currentTarget) {
            e.currentTarget.style.borderColor = "rgba(201,168,76,0.10)";
          }
        }}
        onFocusCapture={(e) => {
          e.currentTarget.style.borderColor = "rgba(201,168,76,0.45)";
          e.currentTarget.style.background = "rgba(15,21,56,0.65)";
          e.currentTarget.style.boxShadow = "0 0 0 1px rgba(201,168,76,0.15)";
        }}
        onBlurCapture={(e) => {
          e.currentTarget.style.borderColor = "rgba(201,168,76,0.10)";
          e.currentTarget.style.background = "rgba(15,21,56,0.45)";
          e.currentTarget.style.boxShadow = "none";
        }}
      />
      {site.latestNoteDate && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: "#4A5080",
            letterSpacing: "0.10em",
            paddingTop: 12,
            whiteSpace: "nowrap",
            userSelect: "none",
            textTransform: "uppercase",
          }}
          title={`Last updated ${site.latestNoteDate}`}
        >
          {site.latestNoteDate}
        </span>
      )}
    </div>
  );
}
