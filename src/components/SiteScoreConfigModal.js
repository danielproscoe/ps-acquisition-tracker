// src/components/SiteScoreConfigModal.js
// SiteScore Weight Configuration Modal extracted from App.js

import React from "react";

export function SiteScoreConfigModal({
  show,
  onClose,
  iqWeights,
  setIqWeights,
  onSave,
  SITE_SCORE_DEFAULTS,
}) {
  if (!show) return null;

  const totalW = iqWeights.reduce((s, d) => s + d.weight, 0);
  const totalPct = Math.round(totalW * 100);

  const adjustWeight = (key, delta) => {
    setIqWeights(prev =>
      prev.map(d =>
        d.key === key
          ? { ...d, weight: Math.max(0, Math.min(1, Math.round((d.weight + delta) * 100) / 100)) }
          : d
      )
    );
  };

  const handleResetDefaults = () => {
    setIqWeights(
      SITE_SCORE_DEFAULTS.map(d => ({
        key: d.key,
        label: d.label,
        icon: d.icon,
        weight: d.weight,
        tip: d.tip,
      }))
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(8px)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        animation: "modalIn 0.35s cubic-bezier(0.4,0,0.2,1)",
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "rgba(15,21,56,0.5)",
          borderRadius: 20,
          maxWidth: 500,
          width: "100%",
          boxShadow:
            "0 24px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(243,124,51,0.1), 0 0 60px rgba(243,124,51,0.06)",
          overflow: "hidden",
          animation: "cardReveal 0.4s cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            background: "linear-gradient(135deg, #0a0a0e 0%, #121218 50%, #1a1520 100%)",
            padding: "22px 26px",
            color: "#fff",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background:
                "linear-gradient(90deg, transparent, #1E2761, #C9A84C, #FFD700, #C9A84C, #1E2761, transparent)",
              opacity: 0.6,
            }}
          />
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>
            ⚙️ SiteScore™ Weight Configuration
          </div>
          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 5 }}>
            Adjust dimension weights. Changes apply to all users in real-time.
          </div>
        </div>

        {/* Weight rows */}
        <div style={{ padding: "16px 24px" }}>
          {iqWeights.map(dim => (
            <div
              key={dim.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 0",
                borderBottom: "1px solid rgba(201,168,76,0.1)",
              }}
            >
              <span style={{ fontSize: 16, width: 24 }}>{dim.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#E2E8F0" }}>{dim.label}</div>
                <div style={{ fontSize: 10, color: "#94A3B8" }}>{dim.tip}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  onClick={() => adjustWeight(dim.key, -0.01)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: "1px solid rgba(201,168,76,0.1)",
                    background: "rgba(15,21,56,0.4)",
                    fontSize: 14,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#6B7394",
                  }}
                >
                  −
                </button>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    fontFamily: "'Space Mono', monospace",
                    width: 48,
                    textAlign: "center",
                    color:
                      dim.weight > 0.15
                        ? "#F37C33"
                        : dim.weight > 0.05
                        ? "#E2E8F0"
                        : "#94A3B8",
                  }}
                >
                  {Math.round(dim.weight * 100)}%
                </div>
                <button
                  onClick={() => adjustWeight(dim.key, 0.01)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: "1px solid rgba(201,168,76,0.1)",
                    background: "rgba(15,21,56,0.4)",
                    fontSize: 14,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#6B7394",
                  }}
                >
                  +
                </button>
              </div>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 14,
              padding: "10px 0",
              borderTop: "2px solid rgba(201,168,76,0.1)",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color:
                  totalPct === 100
                    ? "#16A34A"
                    : totalPct > 100
                    ? "#DC2626"
                    : "#D97706",
              }}
            >
              Total: {totalPct}%{" "}
              {totalPct === 100 ? "✓" : "(will normalize)"}
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "16px 24px",
            borderTop: "1px solid rgba(201,168,76,0.1)",
            background: "rgba(15,21,56,0.4)",
          }}
        >
          <button
            onClick={handleResetDefaults}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(201,168,76,0.1)",
              background: "rgba(15,21,56,0.5)",
              color: "#6B7394",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reset Defaults
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(201,168,76,0.1)",
              background: "rgba(15,21,56,0.5)",
              color: "#6B7394",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg,#C9A84C 0%,#1E2761 100%)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow:
                "0 4px 16px rgba(201,168,76,0.35), 0 0 0 1px rgba(201,168,76,0.1)",
              transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow =
                "0 6px 24px rgba(243,124,51,0.45), 0 0 0 2px rgba(243,124,51,0.2)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow =
                "0 4px 16px rgba(243,124,51,0.35), 0 0 0 1px rgba(243,124,51,0.1)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            Apply &amp; Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default SiteScoreConfigModal;
