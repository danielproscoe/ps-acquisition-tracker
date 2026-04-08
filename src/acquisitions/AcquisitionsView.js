// ─── AcquisitionsView — Off-Market Existing Facility Acquisition Engine ───
// Separate from PS Tracker. StorQuest + Storage King buyers only.
// PS contacts (DW, MT, Jarrod) will never see this tab.

import React, { useState, useMemo } from "react";
import { STYLES, fmt$, fmtN, safeNum } from "../utils";
import { useAcquisitionData } from "./hooks/useAcquisitionData";
import { computeAcquisitionScore, scoreContactIntelligence } from "./scoring/acquisitionScoring";
import { ACQUISITION_SCORE_DEFAULTS, ACQUISITION_STAGES, ACQUISITION_STAGE_COLORS, DEFAULT_BUYER_PROFILES } from "./scoring/scoringDefaults";

// ─── KPI Card ───
const KPICard = ({ label, value, sub, color, onClick }) => (
  <div onClick={onClick} style={{
    ...STYLES.kpiCard(color || "#C9A84C"),
    flex: "1 1 160px",
    minWidth: 140,
    cursor: onClick ? "pointer" : "default",
  }}>
    <div style={STYLES.labelMicro}>{label}</div>
    <div style={{ fontSize: 28, fontWeight: 900, color: color || "#E2E8F0", fontFamily: "'Space Mono', monospace", lineHeight: 1.1 }}>
      {value}
    </div>
    {sub && <div style={{ fontSize: 10, color: "#6B7394", marginTop: 4 }}>{sub}</div>}
  </div>
);

// ─── Score Badge (inline) ───
const AcqScoreBadge = ({ score, classification }) => {
  const colors = {
    GREEN: "#16A34A", YELLOW: "#D97706", ORANGE: "#EA580C", RED: "#DC2626",
  };
  const c = colors[classification] || "#6B7394";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: `${c}18`, border: `1px solid ${c}40`, borderRadius: 6,
      padding: "2px 8px", fontSize: 12, fontWeight: 800, color: c,
      fontFamily: "'Space Mono', monospace",
    }}>
      {score.toFixed(1)}
    </span>
  );
};

// ─── Stage Badge ───
const StageBadge = ({ stage }) => {
  const sc = ACQUISITION_STAGE_COLORS[stage] || { bg: "#1E293B", text: "#94A3B8", dot: "#64748B" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: sc.bg, color: sc.text, borderRadius: 6,
      padding: "3px 10px", fontSize: 10, fontWeight: 700,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: sc.dot }} />
      {stage}
    </span>
  );
};

// ─── Buyer Badge ───
const BuyerBadge = ({ buyerId }) => {
  const profile = DEFAULT_BUYER_PROFILES[buyerId];
  if (!profile) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: `${profile.color}15`, border: `1px solid ${profile.color}30`,
      borderRadius: 5, padding: "2px 8px", fontSize: 9, fontWeight: 700,
      color: profile.color, letterSpacing: "0.05em",
    }}>
      {profile.label}
    </span>
  );
};

// ─── Loan Maturity Countdown ───
const MaturityCountdown = ({ dateStr }) => {
  if (!dateStr) return <span style={{ color: "#4A5080", fontSize: 10 }}>No data</span>;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return <span style={{ color: "#4A5080", fontSize: 10 }}>Invalid</span>;
  const months = Math.max(0, Math.round((d - new Date()) / (30.44 * 24 * 60 * 60 * 1000)));
  const color = months <= 6 ? "#EF4444" : months <= 12 ? "#F59E0B" : months <= 24 ? "#3B82F6" : "#6B7394";
  return (
    <span style={{ fontSize: 12, fontWeight: 800, color, fontFamily: "'Space Mono', monospace" }}>
      {months}mo
    </span>
  );
};

// ─── Contact Intel Badge ───
const ContactBadge = ({ owner }) => {
  const intel = scoreContactIntelligence(owner);
  const colors = { verified: "#22C55E", strong: "#3B82F6", moderate: "#F59E0B", weak: "#EA580C", raw: "#DC2626", unknown: "#64748B" };
  return (
    <span title={intel.nextStep} style={{
      fontSize: 8, fontWeight: 800, letterSpacing: "0.08em",
      color: colors[intel.level] || "#64748B",
      background: `${colors[intel.level] || "#64748B"}15`,
      padding: "2px 6px", borderRadius: 3, cursor: "help",
    }}>
      {intel.confidence}% VET
    </span>
  );
};

// ════════════════════════════════════════════════════════
// MAIN VIEW
// ════════════════════════════════════════════════════════
export function AcquisitionsView() {
  const { loaded, targets, acqWeights, buyerProfiles } = useAcquisitionData();
  const [stageFilter, setStageFilter] = useState(null);
  const [buyerFilter, setBuyerFilter] = useState(null);
  const [sortBy, setSortBy] = useState("score");
  const [viewMode, setViewMode] = useState("pipeline"); // pipeline | maturity | map

  // Score all targets
  const scoredTargets = useMemo(() => {
    return targets.map((t) => {
      const result = computeAcquisitionScore(t, acqWeights);
      return { ...t, _score: result };
    });
  }, [targets, acqWeights]);

  // Filter
  const filtered = useMemo(() => {
    let list = scoredTargets;
    if (stageFilter) list = list.filter((t) => (t.pipeline?.stage || "Identified") === stageFilter);
    if (buyerFilter) list = list.filter((t) => t.pipeline?.assignedBuyer === buyerFilter);
    return list;
  }, [scoredTargets, stageFilter, buyerFilter]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === "score") arr.sort((a, b) => (b._score?.score || 0) - (a._score?.score || 0));
    else if (sortBy === "maturity") {
      arr.sort((a, b) => {
        const am = a.crexi?.loanMaturityDate ? new Date(a.crexi.loanMaturityDate).getTime() : Infinity;
        const bm = b.crexi?.loanMaturityDate ? new Date(b.crexi.loanMaturityDate).getTime() : Infinity;
        return am - bm;
      });
    }
    else if (sortBy === "price") {
      arr.sort((a, b) => safeNum(a.underwriting?.askingPrice || a.askingPrice) - safeNum(b.underwriting?.askingPrice || b.askingPrice));
    }
    return arr;
  }, [filtered, sortBy]);

  // KPI calculations
  const kpis = useMemo(() => {
    const active = scoredTargets.filter((t) => !["Closed", "Dead"].includes(t.pipeline?.stage));
    const loiPsa = scoredTargets.filter((t) => ["LOI", "PSA", "Under Contract"].includes(t.pipeline?.stage));
    const closed = scoredTargets.filter((t) => t.pipeline?.stage === "Closed");
    const totalValue = scoredTargets.reduce((sum, t) => sum + safeNum(t.underwriting?.askingPrice || t.askingPrice), 0);
    const urgentMaturities = scoredTargets.filter((t) => {
      if (!t.crexi?.loanMaturityDate) return false;
      const months = Math.max(0, Math.round((new Date(t.crexi.loanMaturityDate) - new Date()) / (30.44 * 24 * 60 * 60 * 1000)));
      return months <= 12;
    });
    return {
      total: scoredTargets.length,
      active: active.length,
      loiPsa: loiPsa.length,
      closed: closed.length,
      totalValue,
      urgentMaturities: urgentMaturities.length,
    };
  }, [scoredTargets]);

  if (!loaded) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#6B7394" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>Loading acquisitions...</div>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeIn .3s ease-out" }}>
      {/* ─── HEADER ─── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 900, color: "#E2E8F0", letterSpacing: "-0.02em" }}>
            Off-Market Acquisitions
          </span>
          <span style={{
            fontSize: 9, fontWeight: 800, color: "#E87A2E", letterSpacing: "0.12em",
            background: "rgba(232,122,46,0.1)", border: "1px solid rgba(232,122,46,0.2)",
            borderRadius: 4, padding: "3px 8px",
          }}>
            SK + STORQUEST
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#4A5080" }}>
          Existing facility acquisition targets scored by AcquisitionScore — loan maturity, ownership, cap rate spread, value-add potential
        </div>
      </div>

      {/* ─── KPI CARDS ─── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <KPICard label="TOTAL TARGETS" value={kpis.total} color="#E2E8F0" />
        <KPICard label="ACTIVE PIPELINE" value={kpis.active} color="#3B82F6" />
        <KPICard label="LOI / PSA" value={kpis.loiPsa} color="#C9A84C" />
        <KPICard label="CLOSED" value={kpis.closed} color="#22C55E" />
        <KPICard label="EST. DEAL VALUE" value={kpis.totalValue >= 1e6 ? `$${(kpis.totalValue / 1e6).toFixed(1)}M` : fmt$(kpis.totalValue)} color="#E87A2E" />
        <KPICard label="URGENT MATURITIES" value={kpis.urgentMaturities} sub="< 12 months" color={kpis.urgentMaturities > 0 ? "#EF4444" : "#6B7394"} />
      </div>

      {/* ─── VIEW MODE TOGGLE + FILTERS ─── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { key: "pipeline", label: "Pipeline" },
            { key: "maturity", label: "Maturity Timeline" },
          ].map((v) => (
            <button key={v.key} onClick={() => setViewMode(v.key)} style={{
              padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 700,
              background: viewMode === v.key ? "linear-gradient(135deg, #E87A2E, #C9A84C)" : "rgba(148,163,184,0.08)",
              color: viewMode === v.key ? "#fff" : "#6B7394",
              transition: "all 0.2s",
            }}>
              {v.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Stage filter */}
          <select value={stageFilter || ""} onChange={(e) => setStageFilter(e.target.value || null)} style={{
            background: "rgba(15,21,56,0.6)", color: "#94A3B8", border: "1px solid rgba(148,163,184,0.15)",
            borderRadius: 6, padding: "5px 10px", fontSize: 10, fontWeight: 600,
          }}>
            <option value="">All Stages</option>
            {ACQUISITION_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Buyer filter */}
          <select value={buyerFilter || ""} onChange={(e) => setBuyerFilter(e.target.value || null)} style={{
            background: "rgba(15,21,56,0.6)", color: "#94A3B8", border: "1px solid rgba(148,163,184,0.15)",
            borderRadius: 6, padding: "5px 10px", fontSize: 10, fontWeight: 600,
          }}>
            <option value="">All Buyers</option>
            <option value="storquest">StorQuest / WWG</option>
            <option value="storageking">Storage King / Andover</option>
          </select>

          {/* Sort */}
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{
            background: "rgba(15,21,56,0.6)", color: "#94A3B8", border: "1px solid rgba(148,163,184,0.15)",
            borderRadius: 6, padding: "5px 10px", fontSize: 10, fontWeight: 600,
          }}>
            <option value="score">Sort: Score</option>
            <option value="maturity">Sort: Maturity (soonest)</option>
            <option value="price">Sort: Price (low-high)</option>
          </select>
        </div>
      </div>

      {/* ─── PIPELINE VIEW ─── */}
      {viewMode === "pipeline" && (
        <div>
          {sorted.length === 0 ? (
            <div style={{
              textAlign: "center", padding: 60, color: "#4A5080",
              background: "rgba(15,21,56,0.4)", borderRadius: 14,
              border: "1px solid rgba(148,163,184,0.08)",
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>No acquisition targets yet</div>
              <div style={{ fontSize: 13, maxWidth: 400, margin: "0 auto", lineHeight: 1.6 }}>
                Start by searching Crexi Intelligence for storage facilities with maturing loans.
                Claude will extract data and score each facility automatically.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sorted.map((facility) => {
                const stage = facility.pipeline?.stage || "Identified";
                const sc = facility._score || {};
                const price = facility.underwriting?.askingPrice || facility.askingPrice;
                const ownerName = facility.owner?.name || facility.ownerEntity || "";
                const contactIntel = scoreContactIntelligence(facility.owner);

                return (
                  <div key={facility.id} style={{
                    ...STYLES.cardBase,
                    padding: "16px 20px",
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 16,
                    cursor: "pointer",
                    borderLeft: `3px solid ${sc.classColor || "#4A5080"}`,
                  }}>
                    {/* Left: Info */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: "#E2E8F0" }}>
                          {facility.name || facility.address || "Unnamed Facility"}
                        </span>
                        <AcqScoreBadge score={sc.score || 0} classification={sc.classification || "RED"} />
                        <StageBadge stage={stage} />
                        {facility.pipeline?.assignedBuyer && <BuyerBadge buyerId={facility.pipeline.assignedBuyer} />}
                      </div>

                      <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#94A3B8", flexWrap: "wrap" }}>
                        <span>{facility.city}, {facility.state}</span>
                        {facility.totalSF > 0 && <span>{safeNum(facility.totalSF).toLocaleString()} SF</span>}
                        {price && <span>{fmtN(price) ? fmt$(price) : price}</span>}
                        {facility.yearBuilt > 0 && <span>Built {facility.yearBuilt}</span>}
                        {facility.climatePct > 0 && <span>{facility.climatePct}% CC</span>}
                      </div>

                      {/* Owner + Loan Maturity row */}
                      <div style={{ display: "flex", gap: 16, fontSize: 10, color: "#6B7394", marginTop: 6, alignItems: "center" }}>
                        {ownerName && <span>Owner: {ownerName}</span>}
                        <ContactBadge owner={facility.owner} />
                        {facility.crexi?.loanMaturityDate && (
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            Maturity: <MaturityCountdown dateStr={facility.crexi.loanMaturityDate} />
                          </span>
                        )}
                        {facility.crexi?.loanRate > 0 && (
                          <span>Rate: {facility.crexi.loanRate}%</span>
                        )}
                      </div>

                      {/* Flags */}
                      {sc.flags && sc.flags.length > 0 && (
                        <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {sc.flags.slice(0, 3).map((f, i) => (
                            <span key={i} style={{
                              fontSize: 8, fontWeight: 700, color: f.startsWith("FAIL") ? "#EF4444" : "#F59E0B",
                              background: f.startsWith("FAIL") ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)",
                              padding: "2px 6px", borderRadius: 3, letterSpacing: "0.04em",
                            }}>
                              {f.length > 60 ? f.slice(0, 60) + "..." : f}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Right: Key metrics */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: 100 }}>
                      {sc.scores?.loanMaturity > 0 && (
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 8, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em" }}>LOAN PRESSURE</div>
                          <div style={{ fontSize: 16, fontWeight: 900, color: sc.scores.loanMaturity >= 8 ? "#EF4444" : sc.scores.loanMaturity >= 6 ? "#F59E0B" : "#6B7394", fontFamily: "'Space Mono', monospace" }}>
                            {sc.scores.loanMaturity}/10
                          </div>
                        </div>
                      )}
                      {facility.underwriting?.impliedCapRate > 0 && (
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 8, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em" }}>CAP RATE</div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: "#C9A84C", fontFamily: "'Space Mono', monospace" }}>
                            {facility.underwriting.impliedCapRate.toFixed(1)}%
                          </div>
                        </div>
                      )}
                      <div style={{ fontSize: 8, color: "#4A5080" }}>
                        Research: {sc.researchPct || 0}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── MATURITY TIMELINE VIEW ─── */}
      {viewMode === "maturity" && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#E2E8F0", marginBottom: 4 }}>Loan Maturity Timeline</div>
            <div style={{ fontSize: 10, color: "#4A5080" }}>Facilities sorted by loan maturity date — soonest first. Red = urgent (under 12mo), yellow = approaching (12-24mo).</div>
          </div>

          {(() => {
            const withMaturity = sorted
              .filter((t) => t.crexi?.loanMaturityDate)
              .sort((a, b) => new Date(a.crexi.loanMaturityDate) - new Date(b.crexi.loanMaturityDate));

            const withoutMaturity = sorted.filter((t) => !t.crexi?.loanMaturityDate);

            if (withMaturity.length === 0 && withoutMaturity.length === 0) {
              return (
                <div style={{ textAlign: "center", padding: 40, color: "#4A5080" }}>
                  No facilities with loan maturity data. Start by pulling from Crexi Intelligence.
                </div>
              );
            }

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {withMaturity.map((facility) => {
                  const sc = facility._score || {};
                  const maturityDate = new Date(facility.crexi.loanMaturityDate);
                  const monthsLeft = Math.max(0, Math.round((maturityDate - new Date()) / (30.44 * 24 * 60 * 60 * 1000)));
                  const barColor = monthsLeft <= 6 ? "#EF4444" : monthsLeft <= 12 ? "#F59E0B" : monthsLeft <= 24 ? "#3B82F6" : "#22C55E";
                  const barWidth = Math.min(100, Math.max(5, (1 - monthsLeft / 60) * 100));

                  return (
                    <div key={facility.id} style={{
                      ...STYLES.cardBase, padding: "12px 16px",
                      display: "flex", alignItems: "center", gap: 16,
                      borderLeft: `3px solid ${barColor}`,
                    }}>
                      {/* Countdown */}
                      <div style={{ minWidth: 60, textAlign: "center" }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: barColor, fontFamily: "'Space Mono', monospace" }}>
                          {monthsLeft}
                        </div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: "#4A5080", letterSpacing: "0.1em" }}>MONTHS</div>
                      </div>

                      {/* Bar */}
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#E2E8F0" }}>
                            {facility.name || facility.address}
                          </span>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <AcqScoreBadge score={sc.score || 0} classification={sc.classification || "RED"} />
                            {facility.pipeline?.assignedBuyer && <BuyerBadge buyerId={facility.pipeline.assignedBuyer} />}
                          </div>
                        </div>
                        <div style={{ background: "rgba(148,163,184,0.08)", borderRadius: 4, height: 6, overflow: "hidden" }}>
                          <div style={{ background: barColor, height: "100%", width: `${barWidth}%`, borderRadius: 4, transition: "width 0.3s" }} />
                        </div>
                        <div style={{ fontSize: 9, color: "#6B7394", marginTop: 3 }}>
                          {facility.city}, {facility.state} | Matures {maturityDate.toLocaleDateString()} | {facility.crexi.loanRate}% rate
                          {facility.crexi.loanLTV > 0 && ` | ${facility.crexi.loanLTV}% LTV`}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {withoutMaturity.length > 0 && (
                  <div style={{ marginTop: 12, padding: 12, background: "rgba(148,163,184,0.04)", borderRadius: 10, border: "1px solid rgba(148,163,184,0.08)" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#4A5080", marginBottom: 6, letterSpacing: "0.08em" }}>
                      NO LOAN DATA ({withoutMaturity.length} facilities)
                    </div>
                    <div style={{ fontSize: 9, color: "#4A5080" }}>
                      {withoutMaturity.map((f) => f.name || f.address || f.id).join(" | ")}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ─── FOOTER ─── */}
      <div style={{ marginTop: 32, padding: "12px 0", borderTop: "1px solid rgba(148,163,184,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 9, color: "#2C3250", letterSpacing: "0.08em" }}>
          STORVEX ACQUISITIONS ENGINE v1.0 | AcquisitionScore powered by Crexi Intelligence + SiteScore
        </div>
        <div style={{ fontSize: 9, color: "#2C3250" }}>
          {scoredTargets.length} targets | {kpis.urgentMaturities} urgent maturities
        </div>
      </div>
    </div>
  );
}
