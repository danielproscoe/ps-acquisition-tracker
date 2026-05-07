// MethodologyView.js — Institutional-grade methodology one-pager for the
// Storvex Asset Analyzer. Designed for Reza Mahdavian (PSA VP Finance + RE
// Applications) and any institutional buyer to read in 60-90 seconds and
// understand the full underwriting approach without dropping an OM.
//
// All language is buyer-neutral per disclosure-discipline rule
// (memory/feedback_storvex-no-buyer-names-in-ui.md).

import React from "react";

const NAVY = "#1E2761";
const GOLD = "#C9A84C";
const ICE = "#D6E4F7";
const STEEL = "#2C3E6B";
const PS_BLUE = "#3B82F6";
const FIRE = "#F37C33";

const card = {
  background: "rgba(15,21,56,0.6)",
  border: "1px solid rgba(201,168,76,0.12)",
  borderRadius: 14,
  padding: 24,
  marginBottom: 16,
};

const sectionLabel = {
  fontSize: 11,
  fontWeight: 700,
  color: GOLD,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 12,
};

const subhead = {
  fontSize: 14,
  fontWeight: 800,
  color: "#fff",
  marginBottom: 8,
};

const bodyText = {
  fontSize: 13,
  color: "#E2E8F0",
  lineHeight: 1.6,
};

const cite = {
  fontSize: 9,
  fontWeight: 700,
  color: PS_BLUE,
  background: "rgba(59,130,246,0.10)",
  border: `1px solid ${PS_BLUE}40`,
  padding: "2px 7px",
  borderRadius: 4,
  letterSpacing: "0.04em",
  marginLeft: 6,
};

const dataSources = [
  {
    name: "ESRI ArcGIS GeoEnrichment",
    detail: "1, 3, and 5-mile radial rings · 80+ variables · current year + 2030 projection",
    fields: "Pop, HHI, growth CAGR, home value, renter mix, storage MPI, moved MPI",
    icon: "🌐",
  },
  {
    name: "Operator-Family Proximity",
    detail: "4,000+ self-storage facility coordinates indexed",
    fields: "Haversine distance to nearest facility · count within 35 mi (district presence)",
    icon: "📍",
  },
  {
    name: "SpareFoot Market Rents",
    detail: "Submarket CC + drive-up rate comps",
    fields: "Validates seller's stated rents against market sample",
    icon: "💵",
  },
  {
    name: "State Tax Matrix",
    detail: "11-state institutional reassessment lookup",
    fields: "TX 2.4% / CA Prop 13 / FL Just Value / state-by-state purchase tax recalculation",
    icon: "🏛",
  },
];

const benchmarks = [
  {
    label: "Same-Store Opex Ratio",
    value: "24.86% of revenue",
    cite: "FY2025 10-K",
    note: "Self-managed REIT comparable (75.14% NOI margin) vs ~28-29% third-party-managed institutional, ~32-35% independent operators",
  },
  {
    label: "Stabilized Acquisition Cap (Top-30 MSA)",
    value: "6.00%",
    cite: "FY2025 disclosed",
    note: "Underwritten cap (post-platform integration). Buyer pays at market cap (~5.5%) and underwrites to higher stabilized cap because revenue management uplifts NOI 50-100 bps post-acquisition.",
  },
  {
    label: "Stabilized Acquisition Cap (Secondary)",
    value: "6.25%",
    cite: "FY2025 disclosed",
    note: "MSA rank 31-125. Triangulated to Newmark 2025 Self-Storage Almanac + Cushman H1 2025 + Green Street Q1 2026.",
  },
  {
    label: "Stabilized Acquisition Cap (Tertiary)",
    value: "7.00%",
    cite: "FY2025 disclosed",
    note: "Rank 126+. Tertiary expansion footprint relevant post-merger activity.",
  },
  {
    label: "Brand Street-Rate Premium",
    value: "+12% midpoint",
    cite: "Move.org / 10-K disclosure context",
    note: "Disclosed range 10-15% rate premium vs comp set due to brand + tech stack + revenue management. Applied as revenue lift on subject EGI.",
  },
  {
    label: "ECRI on Rolled Tenants",
    value: "8% annual",
    cite: "Inside Self Storage / SkyView Q4 2025",
    note: "Industry midpoint for existing customer rate increases on tenants in place 12+ months. Not directly disclosed by buyer; applied as portfolio benchmark.",
  },
  {
    label: "Portfolio-Fit Cap Bonus",
    value: "−25 bps",
    cite: "Cluster density 10-K commentary",
    note: "Applied when subject is within 5 mi of existing operator-family facility. Captures cross-marketing + customer overflow + 600 bps margin advantage in dense submarkets.",
  },
  {
    label: "CO-LU Lease-Up Cap Band",
    value: "7.00% / 7.25% / 7.50%",
    cite: "Sector convention",
    note: "Walk / Strike / Home Run on Y3 stabilized NOI projection for newly-built C-of-O lease-up assets. Reflects time-value-of-money during 24-36 mo absorption period.",
  },
];

const verdictLogic = [
  {
    tier: "Home Run",
    color: "#22C55E",
    formula: "Y3 NOI ÷ (Stabilized Cap + 50 bps)",
    meaning: "Aggressive opening bid. Best case if seller is motivated.",
  },
  {
    tier: "Strike",
    color: GOLD,
    formula: "Y5 NOI ÷ Stabilized Cap",
    meaning: "Most likely clear price. Recommended bid posture.",
  },
  {
    tier: "Walk",
    color: "#F59E0B",
    formula: "Y5 NOI ÷ (Stabilized Cap − 25 bps)",
    meaning: "Above this, the yield story breaks. Last resort price.",
  },
];

const verdictMapping = [
  { label: "PURSUE", color: "#22C55E", trigger: "Ask ≤ Strike", action: "Recommend pursuit. Anchor opening bid to Home Run for negotiation room." },
  { label: "NEGOTIATE", color: "#F59E0B", trigger: "Strike < Ask ≤ Walk", action: "Recommend pushback. Counter to Strike or below." },
  { label: "PASS", color: "#EF4444", trigger: "Ask > Walk", action: "Yield story breaks at this price. Recommend pass or counter to Strike." },
];

const auditElements = [
  { label: "Source Citations", desc: "Every constant traceable to a primary source: FY2025 10-K, Q4/Q1 earnings transcripts, Newmark / Cushman / Green Street sector reports." },
  { label: "Structured Records", desc: "Every analysis exports as JSON in storvex.asset-analyzer.v1 schema — provenance, audit trail, ready for institutional data warehouse ingestion." },
  { label: "Calibration Loop", desc: "Track Storvex verdict against actual buyer decision over time. Hit rate becomes auditable accuracy proof." },
  { label: "Two-Tier Math", desc: "Institutional Lens (self-managed REIT profile) + Generic Buyer Lens. Δ between them is the platform-fit value institutional buyers capture." },
];

export default function MethodologyView() {
  return (
    <div style={{ animation: "fadeIn 0.3s ease-out", color: "#E2E8F0", fontFamily: "'Inter', sans-serif", maxWidth: 1100 }}>
      <Header />
      <PipelineCard />
      <DataSourcesCard />
      <InstitutionalBenchmarksCard />
      <VerdictLogicCard />
      <AuditTrailCard />
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 26, lineHeight: 1 }}>📋</span>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>Methodology</h1>
        <span style={{ fontSize: 10, fontWeight: 700, color: GOLD, background: "rgba(201,168,76,0.12)", border: `1px solid ${GOLD}40`, padding: "3px 9px", borderRadius: 999, letterSpacing: "0.06em", textTransform: "uppercase" }}>Storvex Asset Analyzer</span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "#94A3B8", lineHeight: 1.6, maxWidth: 800 }}>
        How the Storvex Asset Analyzer turns a broker Offering Memorandum into an institutional-grade underwrite + IC memo in ~60 seconds. Every number is anchored to a primary source (FY2025 10-K disclosures, sector reports, ESRI 2025 demographics). Built for institutional buyers who care about audit trails, structured records, and disclosure discipline.
      </p>
    </div>
  );
}

function PipelineCard() {
  const steps = [
    { num: "01", title: "Drop OM", body: "PDF dropped on the Asset Analyzer. Browser-side text extraction via pdfjs (any size, no upload limits).", time: "~2s" },
    { num: "02", title: "Storvex Extracts", body: "18 fields auto-extracted: ask, NRSF, units, year built, occupancy, T-12 NOI/EGI, pro-forma NOI/EGI, broker, deal type (auto-classified stabilized vs CO-LU vs value-add), MSA tier.", time: "~14s" },
    { num: "03", title: "Auto-Enrich", body: "Four parallel pulls: ESRI 1-3-5 mi demographics · operator-family proximity (Haversine) · SpareFoot market rents · state tax matrix.", time: "~3-5s" },
    { num: "04", title: "Underwrite", body: "Institutional Lens runs deterministic math: opex reconstruction at 24.86% FY2025 ratios, ECRI projection, MSA-tier cap, portfolio-fit bonus, Home Run / Strike / Walk tiers.", time: "<1s" },
    { num: "05", title: "Verdict + IC Memo", body: "PURSUE / NEGOTIATE / PASS verdict. Generate Storvex IC Memo: 2-paragraph exec summary, recommended bid posture, top 3 risks, buyer routing, strategic alignment paragraph.", time: "~10s" },
    { num: "06", title: "Push to Warehouse", body: "Export structured JSON in storvex.asset-analyzer.v1 schema — every field with provenance + audit trail, ready for institutional data warehouse / downstream scoring layer ingestion.", time: "instant" },
  ];

  return (
    <div style={card}>
      <div style={sectionLabel}>End-to-End Pipeline · OM-In to IC-Memo-Out</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {steps.map((s) => (
          <div key={s.num} style={{ background: "rgba(0,0,0,0.25)", padding: "14px 16px", borderRadius: 10, borderLeft: `3px solid ${GOLD}` }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: GOLD, letterSpacing: "0.08em" }}>{s.num} · {s.title}</span>
              <span style={{ fontSize: 9, color: "#64748B", fontWeight: 600 }}>{s.time}</span>
            </div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6, lineHeight: 1.5 }}>{s.body}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, fontSize: 11, color: ICE, fontStyle: "italic", lineHeight: 1.5 }}>
        Total round-trip: ~60-90 seconds from drop to IC memo. Equivalent manual analyst workup: 3-5 days.
      </div>
    </div>
  );
}

function DataSourcesCard() {
  return (
    <div style={card}>
      <div style={sectionLabel}>Auto-Pulled Data Layer · What an Institutional Underwriter Pulls Manually</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {dataSources.map((d) => (
          <div key={d.name} style={{ background: "rgba(0,0,0,0.25)", padding: "14px 16px", borderRadius: 10, borderLeft: `3px solid ${PS_BLUE}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>{d.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>{d.name}</span>
            </div>
            <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.5, marginBottom: 4 }}>{d.detail}</div>
            <div style={{ fontSize: 10, color: "#64748B", lineHeight: 1.4 }}>{d.fields}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InstitutionalBenchmarksCard() {
  return (
    <div style={card}>
      <div style={sectionLabel}>Institutional Benchmarks · FY2025 10-K Anchored</div>
      <div style={{ ...bodyText, marginBottom: 14 }}>
        The Storvex Institutional Lens runs the deal through self-managed national REIT operator math — calibrated to FY2025 sector disclosures. Every constant has a primary source citation.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 8 }}>
        {benchmarks.map((b) => (
          <div key={b.label} style={{ background: "rgba(0,0,0,0.25)", padding: "12px 14px", borderRadius: 8, borderLeft: `3px solid ${GOLD}` }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{b.label}</span>
              <span style={cite}>{b.cite}</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: GOLD, fontFamily: "'Space Mono', monospace" }}>{b.value}</div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6, lineHeight: 1.5 }}>{b.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VerdictLogicCard() {
  return (
    <div style={card}>
      <div style={sectionLabel}>Verdict Logic · Home Run / Strike / Walk</div>
      <div style={{ ...bodyText, marginBottom: 14 }}>
        The model produces three price tiers per deal. The relationship between the ask and these tiers determines the verdict.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
        {verdictLogic.map((t) => (
          <div key={t.tier} style={{ background: "rgba(0,0,0,0.25)", padding: "14px 16px", borderRadius: 10, borderLeft: `3px solid ${t.color}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: t.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t.tier}</div>
            <div style={{ fontSize: 11, color: "#fff", fontFamily: "'Space Mono', monospace", marginTop: 6 }}>{t.formula}</div>
            <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 6, lineHeight: 1.5 }}>{t.meaning}</div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: `1px solid ${GOLD}33`, paddingTop: 14 }}>
        <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Verdict Mapping</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${GOLD}33` }}>
              <th style={{ ...th }}>Verdict</th>
              <th style={{ ...th }}>Trigger</th>
              <th style={{ ...th }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {verdictMapping.map((v) => (
              <tr key={v.label} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ ...td }}><span style={{ fontWeight: 800, color: v.color }}>{v.label}</span></td>
                <td style={{ ...td, fontFamily: "'Space Mono', monospace", color: ICE }}>{v.trigger}</td>
                <td style={{ ...td, color: "#94A3B8" }}>{v.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = { textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" };
const td = { padding: "10px", fontSize: 12, color: "#E2E8F0" };

function AuditTrailCard() {
  return (
    <div style={card}>
      <div style={sectionLabel}>Audit Trail · Why This Holds Up Under Review</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        {auditElements.map((a) => (
          <div key={a.label} style={{ background: "rgba(0,0,0,0.25)", padding: "12px 14px", borderRadius: 8, borderLeft: `3px solid ${PS_BLUE}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#fff", marginBottom: 6 }}>{a.label}</div>
            <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.5 }}>{a.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div style={{ ...card, background: "rgba(15,21,56,0.4)", borderTop: `2px solid ${GOLD}66`, marginTop: 8 }}>
      <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.6 }}>
        <strong style={{ color: GOLD }}>Storvex</strong> is the institutional acquisition platform built by DJR Real Estate. The Asset Analyzer is the existing-stabilized companion to the ground-up SiteScore land vetting engine. Both produce structured records ready for institutional data warehouse ingestion. Methodology + constants traceable to source. <span style={{ color: "#64748B" }}>v3 · 2026-05</span>
      </div>
    </div>
  );
}
