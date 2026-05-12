// BuyerDigestView.js — dashboard surface for the per-buyer weekly digest.
//
// THE FUNNEL IS THE PRODUCT (cont.) — Sprint 2 of the Crush-Radius-Plus
// arc. Renders a per-recipient summary of who the queue + tracker sites
// route to, with a one-click HTML copy + Outlook compose flow for each
// digest.
//
// Workflow:
//   1. View loads — pulls subs + east + sw from the Firebase hook props
//   2. Runs generateAllDigests() against the combined universe
//   3. Renders a sortable table: recipient · siteCount · strong · avg
//      score · top score · CTA buttons
//   4. CTA "Copy HTML" puts the digest body on the clipboard for paste
//      into Outlook / Gmail compose
//   5. CTA "Preview" opens an inline modal with the rendered digest
//
// This is the layer that lets Dan send each recipient a curated weekly
// pull from the Storvex pipeline without ever asking them to open the
// dashboard. The buyers receive deals; they don't fetch them.

import React, { useMemo, useState, useCallback } from "react";
import {
  generateAllDigests,
  summarizeDigests,
  renderRecipientDigest,
} from "../utils/buyerDigest";

const NAVY = "#1E2761";
const GOLD = "#C9A84C";
const ICE = "#D6E4F7";
const NAVY_DARK = "#0F1538";

function fitColor(score) {
  if (!Number.isFinite(score)) return "#94A3B8";
  if (score >= 7.5) return "#16A34A";
  if (score >= 5.5) return "#D97706";
  return "#B45309";
}

function safeNotify(notify, msg, kind) {
  try {
    if (typeof notify === "function") notify(msg, kind);
  } catch {}
}

async function copyHTMLToClipboard(html, notify) {
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      const htmlBlob = new Blob([html], { type: "text/html" });
      const textBlob = new Blob([html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")], {
        type: "text/plain",
      });
      const item = new ClipboardItem({
        "text/html": htmlBlob,
        "text/plain": textBlob,
      });
      await navigator.clipboard.write([item]);
      safeNotify(notify, "Digest HTML copied — paste into Outlook/Gmail compose (Ctrl+V)", "success");
      return true;
    }
    // Fallback — text-only
    await navigator.clipboard.writeText(html);
    safeNotify(notify, "Digest HTML copied (text-only fallback)", "info");
    return true;
  } catch (e) {
    safeNotify(notify, `Clipboard failed — ${e?.message || "see console"}`, "error");
    console.error("Clipboard write failed:", e);
    return false;
  }
}

function openGmailCompose(recipient, subject) {
  const url = new URL("https://mail.google.com/mail/u/0/");
  url.searchParams.set("view", "cm");
  url.searchParams.set("fs", "1");
  url.searchParams.set("tf", "1");
  url.searchParams.set("su", subject || "");
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function openOutlookCompose(subject) {
  const url = new URL("https://outlook.office.com/mail/deeplink/compose");
  url.searchParams.set("subject", subject || "");
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

export default function BuyerDigestView({ subs = [], east = [], sw = [], notify }) {
  const [previewKey, setPreviewKey] = useState(null);
  const [minScore, setMinScore] = useState(5.5);

  const universe = useMemo(() => {
    return [
      ...(Array.isArray(subs) ? subs : []),
      ...(Array.isArray(east) ? east : []),
      ...(Array.isArray(sw) ? sw : []),
    ];
  }, [subs, east, sw]);

  const digests = useMemo(() => generateAllDigests(universe, { minScore }), [universe, minScore]);
  const summary = useMemo(() => summarizeDigests(universe, { minScore }), [universe, minScore]);

  const totalSitesInDigests = summary.reduce((s, r) => s + r.siteCount, 0);
  const totalStrong = summary.reduce((s, r) => s + r.strongCount, 0);

  const previewDigest = previewKey ? digests[previewKey] : null;

  const onCopy = useCallback(
    async (recipient) => {
      const entry = digests[recipient];
      if (!entry || !entry.html) {
        safeNotify(notify, "No digest content to copy", "error");
        return;
      }
      await copyHTMLToClipboard(entry.html, notify);
    },
    [digests, notify]
  );

  return (
    <div style={{ animation: "fadeIn 0.3s ease-out" }}>
      {/* Hero strip */}
      <div
        style={{
          background: `linear-gradient(135deg, ${NAVY_DARK}, ${NAVY})`,
          border: `1px solid rgba(201,168,76,0.30)`,
          borderRadius: 14,
          padding: 22,
          marginBottom: 22,
        }}
      >
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
          ⚡ Weekly Digest · The Funnel is the Product
        </div>
        <div style={{ fontSize: 22, color: "#fff", fontWeight: 800, lineHeight: 1.2, marginBottom: 8 }}>
          {totalSitesInDigests} sites across {summary.length} buyer
          {summary.length === 1 ? "" : "s"}
          <span style={{ color: GOLD }}>
            {" "}
            · {totalStrong} STRONG fit
            {totalStrong === 1 ? "" : "s"}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
          Every site in the queue + trackers is auto-scored against every buyer-spec maintained.
          The funnel pushes pre-vetted opportunities to the relationship owner — copy any digest as
          HTML and paste into Outlook / Gmail. Spec source:{" "}
          <code style={{ color: GOLD }}>src/utils/buyerMatchEngine.js</code>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <label
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.70)",
              fontWeight: 700,
              letterSpacing: "0.05em",
            }}
          >
            Min fit score:
            <input
              type="number"
              step="0.5"
              min="0"
              max="10"
              value={minScore}
              onChange={(e) => setMinScore(parseFloat(e.target.value) || 0)}
              style={{
                marginLeft: 8,
                width: 60,
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid rgba(201,168,76,0.40)",
                background: "rgba(0,0,0,0.30)",
                color: "#fff",
                fontSize: 12,
                fontFamily: "inherit",
              }}
            />
          </label>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            5.5 = VIABLE · 7.5 = STRONG
          </div>
        </div>
      </div>

      {/* Summary table */}
      {summary.length === 0 ? (
        <div
          style={{
            background: "rgba(255,255,255,0.04)",
            border: `1px solid rgba(255,255,255,0.10)`,
            borderRadius: 12,
            padding: 32,
            textAlign: "center",
            color: "rgba(255,255,255,0.65)",
            fontSize: 13,
          }}
        >
          No buyer-fits at score ≥ {minScore.toFixed(1)}. Lower the threshold or wait for daily
          scan to fill the funnel.
        </div>
      ) : (
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: `1px solid rgba(255,255,255,0.10)`,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "inherit" }}>
            <thead>
              <tr style={{ background: "rgba(30,39,97,0.5)" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    fontSize: 10,
                    color: GOLD,
                    fontWeight: 800,
                    letterSpacing: "0.10em",
                  }}
                >
                  RECIPIENT
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "12px 16px",
                    fontSize: 10,
                    color: GOLD,
                    fontWeight: 800,
                    letterSpacing: "0.10em",
                  }}
                >
                  SITES
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "12px 16px",
                    fontSize: 10,
                    color: GOLD,
                    fontWeight: 800,
                    letterSpacing: "0.10em",
                  }}
                >
                  STRONG
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "12px 16px",
                    fontSize: 10,
                    color: GOLD,
                    fontWeight: 800,
                    letterSpacing: "0.10em",
                  }}
                >
                  AVG FIT
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "12px 16px",
                    fontSize: 10,
                    color: GOLD,
                    fontWeight: 800,
                    letterSpacing: "0.10em",
                  }}
                >
                  TOP FIT
                </th>
                <th
                  style={{
                    textAlign: "center",
                    padding: "12px 16px",
                    fontSize: 10,
                    color: GOLD,
                    fontWeight: 800,
                    letterSpacing: "0.10em",
                  }}
                >
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row, i) => {
                const recipientShort = row.recipient.split(/[/,]/)[0].trim();
                const subject = `Storvex Weekly Digest · ${recipientShort} · ${row.siteCount} pre-vetted fits`;
                return (
                  <tr
                    key={row.recipient}
                    style={{
                      borderBottom:
                        i < summary.length - 1
                          ? "1px solid rgba(255,255,255,0.06)"
                          : "none",
                    }}
                  >
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#fff", fontWeight: 700 }}>
                      {row.recipient}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        fontSize: 13,
                        color: "rgba(255,255,255,0.85)",
                        textAlign: "right",
                        fontWeight: 700,
                      }}
                    >
                      {row.siteCount}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        fontSize: 13,
                        color: row.strongCount > 0 ? "#16A34A" : "rgba(255,255,255,0.40)",
                        textAlign: "right",
                        fontWeight: 800,
                      }}
                    >
                      {row.strongCount}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        fontSize: 13,
                        color: fitColor(row.avgScore),
                        textAlign: "right",
                        fontWeight: 700,
                      }}
                    >
                      {row.avgScore.toFixed(2)}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        fontSize: 13,
                        color: fitColor(row.topScore),
                        textAlign: "right",
                        fontWeight: 800,
                      }}
                    >
                      {row.topScore.toFixed(2)}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                        <button
                          onClick={() => setPreviewKey(row.recipient)}
                          style={{
                            padding: "5px 12px",
                            background: "rgba(201,168,76,0.15)",
                            border: `1px solid ${GOLD}40`,
                            color: GOLD,
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.04em",
                            cursor: "pointer",
                          }}
                        >
                          Preview
                        </button>
                        <button
                          onClick={() => onCopy(row.recipient)}
                          style={{
                            padding: "5px 12px",
                            background: GOLD,
                            border: "none",
                            color: NAVY,
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.04em",
                            cursor: "pointer",
                          }}
                        >
                          Copy HTML
                        </button>
                        <button
                          onClick={() => openOutlookCompose(subject)}
                          style={{
                            padding: "5px 12px",
                            background: NAVY,
                            border: `1px solid rgba(255,255,255,0.20)`,
                            color: "#fff",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.04em",
                            cursor: "pointer",
                          }}
                        >
                          Outlook
                        </button>
                        <button
                          onClick={() => openGmailCompose(row.recipient, subject)}
                          style={{
                            padding: "5px 12px",
                            background: "rgba(255,255,255,0.06)",
                            border: `1px solid rgba(255,255,255,0.20)`,
                            color: "rgba(255,255,255,0.85)",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.04em",
                            cursor: "pointer",
                          }}
                        >
                          Gmail
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Preview modal */}
      {previewDigest && (
        <div
          onClick={() => setPreviewKey(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#FFFFFF",
              borderRadius: 12,
              maxWidth: 760,
              width: "100%",
              maxHeight: "90vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 80px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 20px",
                borderBottom: "1px solid #E2E8F0",
                background: NAVY,
                color: "#fff",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: GOLD,
                    fontWeight: 800,
                    letterSpacing: "0.10em",
                  }}
                >
                  DIGEST PREVIEW
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
                  {previewDigest.recipient}
                </div>
              </div>
              <button
                onClick={() => setPreviewKey(null)}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.30)",
                  color: "#fff",
                  padding: "6px 14px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
            <div
              style={{
                overflow: "auto",
                padding: 20,
                background: "#F8FAFC",
              }}
              dangerouslySetInnerHTML={{ __html: previewDigest.html }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
