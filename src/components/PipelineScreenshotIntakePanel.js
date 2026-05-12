// PipelineScreenshotIntakePanel.js — DW Screenshot Intake (Crush Radius+ Move 3)
//
// The active wedge that turns Storvex's verification layer from passive
// labeling into a live competitive moat. Workflow:
//
//   1. DW pastes (or drag-drops) a screenshot from Radius Plus (or any
//      competitor pipeline view) into this panel.
//   2. /api/pipeline-verify-screenshot routes the image through Claude
//      Vision, returning a list of facility entries extracted from the
//      visible pipeline rows.
//   3. The Verification Oracle (src/utils/pipelineVerificationOracle.js)
//      cross-references each extracted entry against Storvex's primary-
//      source registry (development-pipeline.json + submarketPipelineSupply
//      .json), classifying each as REAL / NOT_FOUND / STALE /
//      INCONCLUSIVE with the supporting citation.
//   4. Verdict cards render inline. Each cycle is appended to a shared
//      audit ledger that mirrors localStorage → Firebase Realtime DB at
//      /pipelineVerifyAudit/{cycleId} so DW + MT + Reza + Dan share one
//      ledger across browsers and sessions (see ../utils/pipelineAuditLog.js).
//
// Over the engagement window, the audit ledger itself becomes the moat:
// a cross-device record of Radius+ accuracy errors that institutional
// users (DW, MT, Reza, Aaron) can reference.

import React, { useState, useRef, useCallback, useEffect } from "react";
import { verifyExtractedEntries } from "../utils/pipelineVerificationOracle";
import { appendAuditEntry, subscribeAuditLog } from "../utils/pipelineAuditLog";

const NAVY = "#1E2761";
const GOLD = "#C9A84C";

const VERDICT_STYLES = {
  REAL: {
    color: "#16A34A",
    background: "rgba(22, 163, 74, 0.10)",
    border: "rgba(22, 163, 74, 0.40)",
    icon: "✓",
    label: "REAL",
    description: "Matched Storvex primary-source registry",
  },
  NOT_FOUND: {
    color: "#EF4444",
    background: "rgba(239, 68, 68, 0.10)",
    border: "rgba(239, 68, 68, 0.40)",
    icon: "✕",
    label: "NOT FOUND",
    description: "Storvex registry has good coverage; no match found",
  },
  STALE: {
    color: "#EA580C",
    background: "rgba(234, 88, 12, 0.10)",
    border: "rgba(234, 88, 12, 0.40)",
    icon: "↻",
    label: "STALE",
    description: "Matched but Storvex's last verification > 90 days old",
  },
  INCONCLUSIVE: {
    color: "#94A3B8",
    background: "rgba(148, 163, 184, 0.10)",
    border: "rgba(148, 163, 184, 0.40)",
    icon: "?",
    label: "INCONCLUSIVE",
    description: "Storvex coverage sparse for this submarket",
  },
};

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function PipelineScreenshotIntakePanel() {
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [contextNote, setContextNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [extraction, setExtraction] = useState(null); // raw API response
  const [verification, setVerification] = useState(null); // Oracle output
  const [auditLog, setAuditLog] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  // Subscribe to the shared Firebase audit ledger on mount (Phase B).
  // The handler fires immediately with localStorage bootstrap and again
  // every time Firebase pushes a new entry from any browser.
  useEffect(() => {
    const unsub = subscribeAuditLog((merged) => {
      setAuditLog(merged);
    });
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith("image/")) {
      setError("Please drop an image file (PNG / JPG / WebP).");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setError("Image too large — max 6 MB. Crop or downscale and retry.");
      return;
    }
    setError(null);
    setExtraction(null);
    setVerification(null);
    setImageFile(file);
    try {
      const dataUrl = await fileToDataURL(file);
      setImagePreview(dataUrl);
    } catch (e) {
      setError("Could not read file: " + (e.message || String(e)));
    }
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onPaste = useCallback(
    (e) => {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) {
            handleFile(file);
            return;
          }
        }
      }
    },
    [handleFile]
  );

  // Bind paste to the panel (allows Ctrl+V into the page)
  useEffect(() => {
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onPaste]);

  const onFileSelect = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const runVerification = useCallback(async () => {
    if (!imagePreview) {
      setError("No screenshot loaded.");
      return;
    }
    setLoading(true);
    setError(null);
    setExtraction(null);
    setVerification(null);
    try {
      const resp = await fetch("/api/pipeline-verify-screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imagePreview,
          filename: imageFile?.name || null,
          context: contextNote || null,
          uploader: "DJR-dashboard",
        }),
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setExtraction(data);

      if (data.notPipelineScreenshot) {
        setError(
          "Screenshot does not appear to be a pipeline view: " +
            (data.rationale || "")
        );
        return;
      }

      const entries = Array.isArray(data.extractedEntries) ? data.extractedEntries : [];
      const verdicts = verifyExtractedEntries(entries);
      setVerification(verdicts);

      // Append to audit log
      const auditEntry = {
        timestamp: new Date().toISOString(),
        uploader: "DJR-dashboard",
        filename: imageFile?.name || null,
        context: contextNote || null,
        screenshotInsight: data.screenshotInsight,
        rationale: data.rationale,
        entriesExtracted: entries.length,
        counts: verdicts.counts,
        summary: verdicts.summary,
        verdicts: verdicts.verdicts.map((v) => ({
          extracted: v.extracted,
          verdict: v.verdict,
          confidence: v.confidence,
          matchedId: v.matchedRegistryEntry?.id || null,
          citation: v.citation,
          reasoning: v.reasoning,
        })),
        model: data.model,
        elapsedMs: data.elapsedMs,
      };
      // Phase B: write goes to localStorage (sync) + Firebase (async).
      // The subscribeAuditLog handler will refresh the UI on the Firebase
      // round-trip — no manual setAuditLog needed.
      await appendAuditEntry(auditEntry);
    } catch (e) {
      setError("Verification failed: " + (e.message || String(e)));
    } finally {
      setLoading(false);
    }
  }, [imagePreview, imageFile, contextNote]);

  const reset = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    setContextNote("");
    setExtraction(null);
    setVerification(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(30,39,97,0.92), rgba(15,21,56,0.95))",
        border: `1px solid rgba(201,168,76,0.30)`,
        borderRadius: 14,
        padding: 22,
        minHeight: 600,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 10,
            color: GOLD,
            letterSpacing: "0.18em",
            fontWeight: 900,
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          ⚡ Pipeline Verification · Storvex vs Aggregator
        </div>
        <div style={{ fontSize: 22, color: "#fff", fontWeight: 800, lineHeight: 1.2, marginBottom: 6 }}>
          Drop a Radius+ screenshot. <span style={{ color: GOLD }}>Get the truth in 10 seconds.</span>
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
          Claude Vision extracts every pipeline entry visible in the screenshot. The Storvex Verification Oracle
          cross-references each against Storvex's primary-source registry (REIT 10-K filings · county building permits ·
          planning commission records). Every cycle is logged to the append-only audit ledger.
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? GOLD : "rgba(201,168,76,0.40)"}`,
          background: dragOver ? "rgba(201,168,76,0.08)" : "rgba(255,255,255,0.02)",
          borderRadius: 10,
          padding: 30,
          textAlign: "center",
          cursor: "pointer",
          transition: "all 0.2s",
          marginBottom: 14,
        }}
      >
        {!imagePreview ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 14, color: "#fff", fontWeight: 700, marginBottom: 4 }}>
              Drop screenshot here · or click to browse · or Ctrl+V to paste
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
              PNG · JPG · WebP — max 6 MB · works with Radius+, CoStar, REIT 10-Q exhibits, Newmark reports, etc.
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <img
              src={imagePreview}
              alt="Screenshot preview"
              style={{
                maxHeight: 120,
                maxWidth: 240,
                borderRadius: 6,
                border: `1px solid rgba(201,168,76,0.30)`,
              }}
            />
            <div style={{ textAlign: "left", flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, color: "#fff", fontWeight: 700, marginBottom: 4 }}>
                {imageFile?.name || "Pasted screenshot"}
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>
                {imageFile ? `${(imageFile.size / 1024).toFixed(1)} KB · ${imageFile.type}` : "from clipboard"}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  reset();
                }}
                style={{
                  marginTop: 8,
                  padding: "4px 10px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.30)",
                  borderRadius: 4,
                  color: "rgba(255,255,255,0.70)",
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onFileSelect}
          style={{ display: "none" }}
        />
      </div>

      {/* Context note + Verify button */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <input
          type="text"
          value={contextNote}
          onChange={(e) => setContextNote(e.target.value)}
          placeholder="Context (optional) — e.g. 'DW Houston Westchase pipeline view, 2026-05-11'"
          style={{
            flex: 1,
            minWidth: 240,
            padding: "10px 14px",
            borderRadius: 6,
            border: "1px solid rgba(201,168,76,0.30)",
            background: "rgba(0,0,0,0.30)",
            color: "#fff",
            fontSize: 12,
          }}
        />
        <button
          onClick={runVerification}
          disabled={!imagePreview || loading}
          style={{
            padding: "10px 22px",
            borderRadius: 6,
            border: "none",
            cursor: imagePreview && !loading ? "pointer" : "not-allowed",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.06em",
            background:
              imagePreview && !loading
                ? `linear-gradient(135deg, ${GOLD}, #B89540)`
                : "rgba(255,255,255,0.10)",
            color: imagePreview && !loading ? NAVY : "rgba(255,255,255,0.40)",
            transition: "all 0.2s",
          }}
        >
          {loading ? "⚡ Verifying…" : "⚡ Run Verification"}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            background: "rgba(239,68,68,0.15)",
            border: "1px solid rgba(239,68,68,0.50)",
            color: "#FCA5A5",
            padding: "10px 14px",
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* Extraction summary */}
      {extraction && !extraction.notPipelineScreenshot && (
        <div
          style={{
            background: "rgba(30,39,97,0.40)",
            border: "1px solid rgba(201,168,76,0.30)",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 12,
            fontSize: 11,
            color: "rgba(255,255,255,0.85)",
          }}
        >
          <div style={{ fontWeight: 700, color: GOLD, marginBottom: 4, fontSize: 10, letterSpacing: "0.10em" }}>
            EXTRACTION
          </div>
          <div>{extraction.screenshotInsight}</div>
          {extraction.rationale && (
            <div style={{ marginTop: 4, color: "rgba(255,255,255,0.55)", fontSize: 10 }}>
              {extraction.rationale}
            </div>
          )}
          <div style={{ marginTop: 6, color: "rgba(255,255,255,0.50)", fontSize: 10 }}>
            {extraction.extractedEntries.length} entries · {extraction.model} · {extraction.elapsedMs}ms
          </div>
        </div>
      )}

      {/* Verdict cards */}
      {verification && verification.verdicts.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              background: "rgba(30,39,97,0.30)",
              border: "1px solid rgba(201,168,76,0.40)",
              padding: "10px 14px",
              borderRadius: 8,
              marginBottom: 10,
              fontSize: 12,
              color: "#fff",
            }}
          >
            <span style={{ color: GOLD, fontWeight: 800, marginRight: 8, fontSize: 10, letterSpacing: "0.10em" }}>
              VERDICT
            </span>
            <span style={{ color: "#16A34A", fontWeight: 700 }}>{verification.counts.REAL} REAL</span>
            <span style={{ color: "rgba(255,255,255,0.40)" }}> · </span>
            <span style={{ color: "#EF4444", fontWeight: 700 }}>{verification.counts.NOT_FOUND} NOT_FOUND</span>
            <span style={{ color: "rgba(255,255,255,0.40)" }}> · </span>
            <span style={{ color: "#EA580C", fontWeight: 700 }}>{verification.counts.STALE} STALE</span>
            <span style={{ color: "rgba(255,255,255,0.40)" }}> · </span>
            <span style={{ color: "#94A3B8", fontWeight: 700 }}>
              {verification.counts.INCONCLUSIVE} INCONCLUSIVE
            </span>
          </div>

          {verification.verdicts.map((v, i) => {
            const style = VERDICT_STYLES[v.verdict] || VERDICT_STYLES.INCONCLUSIVE;
            const ex = v.extracted || {};
            return (
              <div
                key={i}
                style={{
                  background: style.background,
                  border: `1px solid ${style.border}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                  marginBottom: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div
                    style={{
                      color: style.color,
                      fontSize: 18,
                      fontWeight: 800,
                      lineHeight: 1,
                      minWidth: 24,
                      textAlign: "center",
                    }}
                  >
                    {style.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div
                      style={{
                        color: style.color,
                        fontWeight: 800,
                        fontSize: 11,
                        letterSpacing: "0.10em",
                        marginBottom: 4,
                      }}
                    >
                      {style.label} · confidence {v.confidence}%
                    </div>
                    <div style={{ color: "#fff", fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
                      {ex.operatorName || ex.operator || "(unknown operator)"} —{" "}
                      {ex.address || ex.city || "(no address)"}
                      {ex.state ? `, ${ex.state}` : ""}
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 11, marginBottom: 6 }}>
                      {ex.nrsf ? `${(ex.nrsf / 1000).toFixed(0)}K NRSF · ` : ""}
                      {ex.ccPct != null ? `${ex.ccPct}% CC · ` : ""}
                      {ex.expectedDelivery || ""}
                      {ex.status ? ` · ${ex.status}` : ""}
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.80)", fontSize: 11, lineHeight: 1.5 }}>
                      {v.reasoning}
                    </div>
                    {v.citation && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 10,
                          color: style.color,
                          fontFamily: "'Space Mono', monospace",
                        }}
                      >
                        ↳ {v.citation}
                      </div>
                    )}
                    {/* Multi-source coverage attribution — shows which primary-source
                        registries Storvex scanned + per-registry density for the
                        submarket. Wired off the perRegistry field added in commit
                        086a4ec. Renders even when registries are empty so Reza sees
                        the audit trail every cycle, not only on hits. */}
                    {v.submarketCoverage && v.submarketCoverage.perRegistry && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: "6px 8px",
                          background: "rgba(0,0,0,0.20)",
                          border: "1px solid rgba(255,255,255,0.06)",
                          borderRadius: 4,
                          fontSize: 10,
                          color: "rgba(255,255,255,0.65)",
                          lineHeight: 1.5,
                        }}
                      >
                        <div style={{ color: GOLD, fontWeight: 700, letterSpacing: "0.06em" }}>
                          STORVEX SCANNED · {(v.registriesScanned || []).join(" + ") || "EDGAR + PERMIT"}
                        </div>
                        <div>
                          {v.submarketCoverage.perRegistry.edgar || 0} EDGAR ·{" "}
                          {v.submarketCoverage.perRegistry.permit || 0} PERMIT
                          {v.submarketCoverage.perRegistry.submarket
                            ? ` · ${v.submarketCoverage.perRegistry.submarket} pre-indexed`
                            : ""}
                          {ex.city && ex.state ? ` entries in ${ex.city}, ${ex.state}` : ""}
                          {" · coverage "}
                          <span style={{ color: style.color, fontWeight: 700 }}>
                            {v.submarketCoverage.confidence}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Audit log preview */}
      {auditLog.length > 0 && (
        <div
          style={{
            marginTop: 18,
            background: "rgba(0,0,0,0.20)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 8,
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              color: GOLD,
              fontWeight: 800,
              fontSize: 10,
              letterSpacing: "0.10em",
              marginBottom: 8,
            }}
          >
            AUDIT LEDGER · {auditLog.length} entries · shared across DJR devices
            {auditLog.some((e) => e._source === "local") && (
              <span style={{ marginLeft: 8, color: "rgba(255,255,255,0.50)", fontWeight: 600 }}>
                ({auditLog.filter((e) => e._source === "local").length} pending sync)
              </span>
            )}
          </div>
          {auditLog
            .slice()
            .reverse()
            .slice(0, 5)
            .map((entry, i) => {
              const isLocal = entry._source === "local";
              return (
                <div
                  key={entry._cycleId || `${entry.timestamp}-${i}`}
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.70)",
                    marginBottom: 4,
                    paddingBottom: 4,
                    borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.05)" : "none",
                  }}
                >
                  <span
                    title={isLocal ? "Pending Firebase sync — visible on this device only" : "Synced to Firebase — visible across all DJR devices"}
                    style={{
                      marginRight: 6,
                      color: isLocal ? "rgba(234,88,12,0.85)" : "rgba(22,163,74,0.85)",
                      fontSize: 9,
                    }}
                  >
                    {isLocal ? "⏳" : "☁"}
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.45)", marginRight: 6 }}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                  {entry.summary || `${entry.entriesExtracted} entries · ${entry.model}`}
                </div>
              );
            })}
          {auditLog.length > 5 && (
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.40)", marginTop: 4 }}>
              + {auditLog.length - 5} earlier entries
            </div>
          )}
        </div>
      )}
    </div>
  );
}
