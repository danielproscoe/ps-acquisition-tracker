// PipelineBulkImportPanel — bulk aggregator-data ingest UI
//
// The OPERATIONAL wedge that compounds with every customer:
//   Customer drops their Radius+ / TractIQ / StorTrack pipeline CSV export →
//   parsePipelineCsv() normalizes column headers + coerces fields →
//   verifyExtractedEntries() runs each entry through the Oracle →
//   single audit-log cycle records all verdicts with source="csv-bulk-import" →
//   verdicts surface as a counts strip + per-entry table.
//
// The same downstream pipeline as the single-screenshot Verify Screenshot
// mode (Move 3 ship 2026-05-11 commit 218b49a) — just at scale.
//
// Sibling intake surface alongside QuickLookupPanel (Address Lookup),
// AssetAnalyzerView (Drop OM), and PipelineScreenshotIntakePanel (Verify
// Screenshot). Wired into TheReadView's 4-mode toggle.

import React, { useCallback, useRef, useState } from "react";
import { parsePipelineCsv } from "../utils/pipelineCsvParser";
import { verifyExtractedEntries } from "../utils/pipelineVerificationOracle";
import { appendAuditEntry } from "../utils/pipelineAuditLog";

const NAVY = "#1E2761";
const GOLD = "#C9A84C";
const ICE = "#D6E4F7";
const STEEL = "#2C3E6B";

const VERDICT_COLORS = {
  REAL: { bg: "rgba(34,197,94,0.15)", border: "rgba(34,197,94,0.45)", text: "#86EFAC" },
  NOT_FOUND: { bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.45)", text: "#FCA5A5" },
  STALE: { bg: "rgba(251,191,36,0.15)", border: "rgba(251,191,36,0.45)", text: "#FCD34D" },
  INCONCLUSIVE: { bg: "rgba(148,163,184,0.15)", border: "rgba(148,163,184,0.45)", text: "#CBD5E1" },
};

export default function PipelineBulkImportPanel() {
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [verification, setVerification] = useState(null);
  const [loading, setLoading] = useState(false);
  const [auditState, setAuditState] = useState(null); // { synced: bool, localOnly: bool, cycleId }
  const [error, setError] = useState(null);
  const [contextNote, setContextNote] = useState("");
  const [filename, setFilename] = useState(null);
  const inputRef = useRef(null);

  const reset = useCallback(() => {
    setCsvText("");
    setParsed(null);
    setVerification(null);
    setError(null);
    setContextNote("");
    setFilename(null);
    setAuditState(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const handleFile = useCallback((file) => {
    if (!file) return;
    setError(null);
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || "");
      setCsvText(text);
      setParsed(parsePipelineCsv(text));
      setVerification(null);
      setAuditState(null);
    };
    reader.onerror = () => setError("Failed to read file: " + (reader.error?.message || "unknown error"));
    reader.readAsText(file, "utf-8");
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleParseFromTextarea = useCallback(() => {
    setError(null);
    setFilename(null);
    setParsed(parsePipelineCsv(csvText));
    setVerification(null);
    setAuditState(null);
  }, [csvText]);

  const handleRunVerification = useCallback(async () => {
    if (!parsed || parsed.entries.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const verdicts = verifyExtractedEntries(parsed.entries);
      setVerification(verdicts);

      // Build a single audit-log entry capturing the whole cycle.
      // Source is "csv-bulk-import" so downstream filtering can distinguish
      // bulk-CSV runs from single-screenshot Verify runs.
      const auditEntry = {
        timestamp: new Date().toISOString(),
        uploader: "DJR-dashboard",
        source: "csv-bulk-import",
        filename: filename || null,
        context: contextNote || null,
        delimiter: parsed.delimiter,
        rowCount: parsed.rowCount,
        parsedRows: parsed.parsedRows,
        mapping: parsed.mapping,
        unmappedColumns: parsed.unmappedColumns,
        warnings: parsed.warnings,
        entriesExtracted: parsed.entries.length,
        counts: verdicts.counts,
        summary: verdicts.summary,
        verdicts: verdicts.verdicts.map((v) => ({
          extracted: v.extracted,
          verdict: v.verdict,
          confidence: v.confidence,
          matchedId: v.matchedRegistryEntry?.id || null,
          registrySource: v.registrySource || null,
          citation: v.citation,
          reasoning: v.reasoning,
        })),
      };
      const result = await appendAuditEntry(auditEntry);
      setAuditState({
        synced: !result.localOnly,
        localOnly: !!result.localOnly,
        cycleId: result.cycleId,
        reason: result.reason || null,
      });
    } catch (e) {
      setError("Bulk verification failed: " + (e.message || String(e)));
    } finally {
      setLoading(false);
    }
  }, [parsed, filename, contextNote]);

  const counts = verification?.counts || null;
  const totalVerdicts = counts ? counts.REAL + counts.NOT_FOUND + counts.STALE + counts.INCONCLUSIVE : 0;

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
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: GOLD, letterSpacing: "0.18em", fontWeight: 900, textTransform: "uppercase", marginBottom: 4 }}>
          Bulk Import · The Inversion at Scale
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 6 }}>
          Drop a Radius+ / TractIQ / StorTrack CSV export. Every entry → Storvex audit-log entry.
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
          Storvex doesn't try to match aggregator breadth — Storvex turns the breadth into audit-log
          input. Each verified row appends to the cross-device Phase B ledger so the longitudinal
          track record compounds with every CSV ingested.
        </div>
      </div>

      {/* Drop zone + paste */}
      {!parsed && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          style={{
            border: `2px dashed rgba(201,168,76,0.4)`,
            borderRadius: 10,
            padding: 24,
            background: "rgba(15,21,56,0.4)",
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 12, color: ICE, marginBottom: 10, letterSpacing: "0.04em" }}>
            Drop a CSV file here · or use the textarea below
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            onChange={(e) => handleFile(e.target.files?.[0])}
            style={{ display: "none" }}
            id="csv-file-input"
          />
          <label
            htmlFor="csv-file-input"
            style={{
              display: "inline-block",
              padding: "8px 22px",
              borderRadius: 8,
              background: `linear-gradient(135deg, ${GOLD}, #B89540)`,
              color: NAVY,
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer",
              letterSpacing: "0.08em",
            }}
          >
            CHOOSE FILE
          </label>
        </div>
      )}

      {!parsed && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: GOLD, fontWeight: 700, letterSpacing: "0.14em", marginBottom: 4, textTransform: "uppercase" }}>
            Or paste CSV
          </div>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="Operator,City,State,Status,Expected Delivery,NRSF&#10;Public Storage,Houston,TX,Under Construction,Q3 2026,82500"
            rows={6}
            style={{
              width: "100%",
              background: "rgba(15,21,56,0.6)",
              border: `1px solid rgba(201,168,76,0.25)`,
              borderRadius: 8,
              color: ICE,
              padding: 10,
              fontFamily: "monospace",
              fontSize: 11,
              lineHeight: 1.45,
              resize: "vertical",
            }}
          />
          <button
            onClick={handleParseFromTextarea}
            disabled={!csvText.trim()}
            style={{
              marginTop: 8,
              padding: "8px 18px",
              borderRadius: 6,
              border: "none",
              background: csvText.trim() ? `linear-gradient(135deg, ${GOLD}, #B89540)` : "rgba(201,168,76,0.2)",
              color: csvText.trim() ? NAVY : "rgba(255,255,255,0.4)",
              fontSize: 11,
              fontWeight: 800,
              cursor: csvText.trim() ? "pointer" : "not-allowed",
              letterSpacing: "0.08em",
            }}
          >
            PARSE CSV
          </button>
        </div>
      )}

      {/* Parse results */}
      {parsed && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: ICE, fontWeight: 700 }}>
                {filename ? `📄 ${filename}` : "📋 Pasted CSV"} · {parsed.parsedRows} entries · delimiter <code style={{ background: "rgba(0,0,0,0.4)", padding: "1px 4px", borderRadius: 3 }}>{parsed.delimiter === "\t" ? "TAB" : parsed.delimiter}</code>
              </div>
            </div>
            <button onClick={reset} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: "0.06em" }}>
              ✕ Clear
            </button>
          </div>

          {/* Column mapping */}
          <div style={{ background: "rgba(15,21,56,0.55)", border: `1px solid rgba(201,168,76,0.18)`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: GOLD, letterSpacing: "0.14em", fontWeight: 800, marginBottom: 6, textTransform: "uppercase" }}>
              Column Mapping (auto-detected)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 6, fontSize: 11, color: ICE }}>
              {Object.entries(parsed.mapping).map(([field, header]) => (
                <div key={field}>
                  <span style={{ color: "rgba(255,255,255,0.55)" }}>{field}</span>{" "}
                  <span style={{ color: GOLD, fontFamily: "monospace" }}>← {header}</span>
                </div>
              ))}
            </div>
            {parsed.unmappedColumns.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.45)" }}>
                Unmapped: {parsed.unmappedColumns.join(", ")}
              </div>
            )}
          </div>

          {/* Warnings */}
          {parsed.warnings.length > 0 && (
            <div style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: "#FCD34D", letterSpacing: "0.12em", fontWeight: 800, marginBottom: 4, textTransform: "uppercase" }}>
                Warnings
              </div>
              {parsed.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 11, color: "#FDE68A", lineHeight: 1.45 }}>
                  • {w}
                </div>
              ))}
            </div>
          )}

          {/* Preview (first 5 rows) */}
          <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: 10, marginBottom: 10, overflowX: "auto" }}>
            <div style={{ fontSize: 9, color: GOLD, letterSpacing: "0.14em", fontWeight: 800, marginBottom: 6, textTransform: "uppercase" }}>
              Preview · {Math.min(5, parsed.entries.length)} of {parsed.entries.length} rows
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ color: GOLD, textAlign: "left", borderBottom: "1px solid rgba(201,168,76,0.2)" }}>
                  <th style={{ padding: "4px 8px", fontWeight: 700 }}>Operator</th>
                  <th style={{ padding: "4px 8px", fontWeight: 700 }}>City, State</th>
                  <th style={{ padding: "4px 8px", fontWeight: 700 }}>NRSF</th>
                  <th style={{ padding: "4px 8px", fontWeight: 700 }}>Status</th>
                  <th style={{ padding: "4px 8px", fontWeight: 700 }}>Delivery</th>
                </tr>
              </thead>
              <tbody>
                {parsed.entries.slice(0, 5).map((e, i) => (
                  <tr key={i} style={{ color: ICE, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "4px 8px" }}>{e.operator || "—"}</td>
                    <td style={{ padding: "4px 8px" }}>{[e.city, e.state].filter(Boolean).join(", ") || "—"}</td>
                    <td style={{ padding: "4px 8px" }}>{e.nrsf != null ? e.nrsf.toLocaleString() : "—"}</td>
                    <td style={{ padding: "4px 8px" }}>{e.status || "—"}</td>
                    <td style={{ padding: "4px 8px" }}>{e.expectedDelivery || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Optional context note */}
          <div style={{ marginBottom: 10 }}>
            <input
              value={contextNote}
              onChange={(e) => setContextNote(e.target.value)}
              placeholder="Optional context — e.g. 'Q2 2026 Radius+ pipeline export, DFW + Tampa'"
              style={{
                width: "100%",
                background: "rgba(15,21,56,0.6)",
                border: `1px solid rgba(201,168,76,0.2)`,
                borderRadius: 6,
                color: ICE,
                padding: "8px 10px",
                fontSize: 11,
              }}
            />
          </div>

          {/* Run verification */}
          {!verification && (
            <button
              onClick={handleRunVerification}
              disabled={loading || parsed.entries.length === 0}
              style={{
                padding: "12px 28px",
                borderRadius: 8,
                border: "none",
                background: loading || parsed.entries.length === 0 ? "rgba(201,168,76,0.2)" : `linear-gradient(135deg, ${GOLD}, #B89540)`,
                color: loading || parsed.entries.length === 0 ? "rgba(255,255,255,0.4)" : NAVY,
                fontSize: 12,
                fontWeight: 900,
                cursor: loading || parsed.entries.length === 0 ? "not-allowed" : "pointer",
                letterSpacing: "0.10em",
                width: "100%",
              }}
            >
              {loading ? "VERIFYING…" : `⚡ RUN VERIFICATION ON ${parsed.entries.length} ENTRIES`}
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 11, color: "#FCA5A5" }}>
          {error}
        </div>
      )}

      {/* Verdict summary + cards */}
      {verification && counts && (
        <div>
          {/* Audit-log sync state */}
          {auditState && (
            <div style={{ fontSize: 10, color: auditState.localOnly ? "#FCD34D" : "#86EFAC", marginBottom: 10, letterSpacing: "0.04em" }}>
              {auditState.localOnly ? `⏳ Local only — Firebase sync pending (${auditState.reason || "auth/connectivity"})` : "☁ Synced to cross-device audit ledger"}
              {auditState.cycleId && <span style={{ color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>cycle {auditState.cycleId.slice(0, 14)}…</span>}
            </div>
          )}

          {/* Counts strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
            {[
              { key: "REAL", label: "REAL" },
              { key: "NOT_FOUND", label: "NOT FOUND" },
              { key: "STALE", label: "STALE" },
              { key: "INCONCLUSIVE", label: "INCONCLUSIVE" },
            ].map((v) => {
              const c = VERDICT_COLORS[v.key];
              const n = counts[v.key] || 0;
              const pct = totalVerdicts > 0 ? Math.round((n / totalVerdicts) * 100) : 0;
              return (
                <div key={v.key} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 8, color: c.text, letterSpacing: "0.14em", fontWeight: 800, textTransform: "uppercase", marginBottom: 4 }}>{v.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: c.text }}>{n}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{pct}% of total</div>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <div style={{ background: "rgba(15,21,56,0.55)", border: `1px solid rgba(201,168,76,0.18)`, borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12, color: ICE, lineHeight: 1.5 }}>
            <strong style={{ color: GOLD }}>SUMMARY:</strong> {verification.summary}
          </div>

          {/* Per-entry verdict cards (first 20) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {verification.verdicts.slice(0, 20).map((v, i) => {
              const c = VERDICT_COLORS[v.verdict] || VERDICT_COLORS.INCONCLUSIVE;
              return (
                <div key={i} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 6, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>
                      {v.extracted?.operator || "—"} · {[v.extracted?.city, v.extracted?.state].filter(Boolean).join(", ") || "—"}
                      {v.extracted?.nrsf != null && <span style={{ color: "rgba(255,255,255,0.5)" }}> · {v.extracted.nrsf.toLocaleString()} SF</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>
                      {v.reasoning}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: c.text, fontWeight: 900, letterSpacing: "0.10em" }}>{v.verdict}</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{v.confidence}% conf{v.registrySource ? ` · ${v.registrySource}` : ""}</div>
                  </div>
                </div>
              );
            })}
            {verification.verdicts.length > 20 && (
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textAlign: "center", marginTop: 4, fontStyle: "italic" }}>
                +{verification.verdicts.length - 20} more entries audit-logged
              </div>
            )}
          </div>

          {/* Reset / new ingest */}
          <div style={{ marginTop: 14, textAlign: "center" }}>
            <button onClick={reset} style={{ padding: "10px 22px", borderRadius: 8, border: `1px solid rgba(201,168,76,0.3)`, background: "rgba(201,168,76,0.06)", color: GOLD, fontSize: 11, fontWeight: 800, cursor: "pointer", letterSpacing: "0.08em" }}>
              ↺ NEW INGEST
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
