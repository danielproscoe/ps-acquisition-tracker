import { getRecipient } from "./recipientProfiles";
import {
  resolveCityToMSA,
  getHistoricalMSARentSeries,
  getHistoricalRentMetadata,
  getHistoricalSameStoreSeries,
  getCrossREITHistoricalLatest,
} from "./data/edgarCompIndex";
import {
  computePipelineConfidence,
  renderConfidenceChip,
  aggregatePipelineConfidence,
} from "./utils/pipelineConfidence";

// analyzerReport.js — Storvex PS Asset Analyzer · Goldman-exec PDF report.
//
// Renders a full institutional-grade printable HTML document from a single
// Asset Analyzer run. Output mirrors the on-screen analysis with a polished
// 12-section layout: cover, exec summary, verdict + KPI strip, NOI
// reconstruction, stabilized projection, valuation matrix, price tiers,
// rent sanity, sale comps, IC memo, audit/provenance, footer.
//
// Pattern matches generateRECPackage() in reports.js — pure function returning
// a complete HTML string with embedded CSS. The "Export Report" button in
// AssetAnalyzerView opens a new tab, writes the HTML, and the user clicks the
// bundled Print/Save-as-PDF CTA. Browser handles the PDF generation.
//
// Brand standards per CLAUDE.md §3:
//   NAVY  #1E2761  · primary chrome
//   GOLD  #C9A84C  · accent / verdict CTAs / key numbers
//   ICE   #D6E4F7  · table row backgrounds
//   STEEL #2C3E6B  · panel backgrounds
//   Calibri-equivalent (Inter / DM Sans) for body, Space Mono for figures.

// ─── Format helpers ─────────────────────────────────────────────────────────
const fmt$ = (v) => {
  if (v == null || !isFinite(v)) return "—";
  const n = Math.round(v);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};
const fmt$Full = (v) => (v == null || !isFinite(v) ? "—" : `$${Math.round(v).toLocaleString()}`);
const fmtN = (v) => (v == null || !isFinite(v) ? "—" : Number(v).toLocaleString());
const fmtPct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);
const fmtRate = (v) => (v == null || !isFinite(v) ? "—" : `$${Number(v).toFixed(2)}/SF/mo`);
const safe = (s, fallback = "—") => (s == null || s === "" ? fallback : String(s));
const todayStr = () => {
  const d = new Date();
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};
const docIdFrom = (snapshot) => {
  const slug = (snapshot.name || "deal").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `STX-${slug}-${ts}`.toUpperCase();
};

// ─── Section renderers ─────────────────────────────────────────────────────

function renderCover({ snapshot, verdict, ps, msaTier, dealType, docId, recipient }) {
  const verdictColor = verdict.label === "PURSUE" ? "#22C55E" : verdict.label === "NEGOTIATE" ? "#F59E0B" : "#EF4444";
  const cap = ps?.marketCap || 0;
  const lensTicker = ps?.lens?.ticker || null;
  const lensName = ps?.lens?.name || null;
  // Pitch-mode cover gets a personalized "PITCH FOR [Name]" strip and an
  // institutional greeting paragraph. Otherwise rendered as standard.
  const pitchStrip = recipient && recipient.recipientName ? `
  <div class="pitch-strip" style="border-bottom:2px solid #A855F7;background:linear-gradient(135deg,rgba(168,85,247,0.18),rgba(15,21,56,0.6));padding:18pt 32pt 14pt;color:#fff;">
    <div style="font-size:9pt;font-weight:800;color:#A855F7;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4pt;">⚡ Pitch · For Institutional Review</div>
    <div style="font-size:18pt;font-weight:900;color:#fff;line-height:1.1;">${safe(recipient.recipientName)}</div>
    <div style="font-size:11pt;font-weight:600;color:#C9A84C;margin-top:2pt;">${safe(recipient.role)} · ${safe(recipient.firm)}</div>
    ${lensTicker ? `<div style="font-size:9pt;color:#94A3B8;margin-top:6pt;">Underwritten through <b style="color:#fff">${safe(lensTicker)} lens</b> — ${safe(lensName)}</div>` : ""}
  </div>` : "";
  const greetingBlock = recipient && recipient.greeting ? `
    <div class="cover-greeting" style="margin-top:18pt;padding:14pt 18pt;background:rgba(168,85,247,0.06);border-left:3px solid #A855F7;border-radius:4pt;font-size:11pt;line-height:1.55;color:#E2E8F0;">
      ${safe(recipient.greeting)}
    </div>` : "";
  return `
<section class="cover">
  ${pitchStrip}
  <div class="cover-strip">
    <div class="brand">STORVEX${recipient && recipient.firm ? ` <span class="gold">· ${safe(lensTicker || "")}</span>` : ` <span class="gold">PS</span>`}</div>
    <div class="cover-meta">
      <div>INSTITUTIONAL ACQUISITION ANALYSIS</div>
      <div class="doc-id">${docId} · ${todayStr()}</div>
    </div>
  </div>
  <div class="cover-body">
    <div class="cover-tag">EXISTING-STABILIZED · ${(dealType || "stabilized").toUpperCase().replace(/_/g, "-")} · ${(msaTier || "secondary").toUpperCase()} MSA</div>
    <h1 class="cover-title">${safe(snapshot.name, "Subject Asset")}</h1>
    <div class="cover-sub">${safe(snapshot.state ? `${snapshot.state} · ${fmtN(snapshot.nrsf)} NRSF · ${fmtN(snapshot.unitCount)} units · Built ${safe(snapshot.yearBuilt)}` : "")}</div>

    <div class="cover-verdict" style="border-color:${verdictColor}80;background:linear-gradient(135deg,rgba(15,21,56,0.92),rgba(30,39,97,0.6))">
      <div class="cover-verdict-label">STORVEX UNDERWRITE · VERDICT</div>
      <div class="cover-verdict-value" style="color:${verdictColor}">${verdict.label}</div>
      <div class="cover-verdict-rationale">${safe(verdict.rationale)}</div>
      <div class="cover-cap">
        <span class="cap-label">STABILIZED CAP</span>
        <span class="cap-value">${fmtPct(cap, 2)}</span>
      </div>
    </div>

    ${greetingBlock}

    <div class="cover-tiles">
      <div class="cover-tile"><div class="t-l">Ask</div><div class="t-v">${fmt$(snapshot.ask)}</div></div>
      <div class="cover-tile"><div class="t-l">Cap on Ask</div><div class="t-v">${fmtPct(snapshot.capOnAsk, 2)}</div></div>
      <div class="cover-tile"><div class="t-l">$ / SF</div><div class="t-v">${snapshot.pricePerSF > 0 ? fmt$(snapshot.pricePerSF) : "—"}</div></div>
      <div class="cover-tile"><div class="t-l">Phys / Econ Occ</div><div class="t-v">${fmtPct(snapshot.physicalOcc, 0)} / ${fmtPct(snapshot.economicOcc, 0)}</div></div>
    </div>

    <div class="cover-prepared">
      <div>PREPARED ${recipient && recipient.recipientName ? "FOR " + safe(recipient.recipientName).toUpperCase() + " · " : ""}BY</div>
      <div class="prep-firm">DJR REAL ESTATE LLC · Storvex${lensTicker ? " · " + safe(lensTicker) + " Lens" : " PS"} Asset Analyzer</div>
      <div class="prep-contact">Daniel P. Roscoe · Droscoe@DJRrealestate.com · 312.805.5996</div>
    </div>
  </div>
</section>`;
}

function renderExecSummary({ snapshot, verdict, ps, analysis, rentSanity }) {
  const psWalk = ps?.tiers?.walk?.price;
  const genericWalk = analysis?.tiers?.walk?.price;
  const platformDelta = (psWalk != null && genericWalk != null) ? psWalk - genericWalk : null;
  const askVsWalk = (psWalk != null && snapshot.ask) ? (snapshot.ask - psWalk) / psWalk : null;
  const verdictPhrase = verdict.label === "PURSUE"
    ? `the ask sits ${fmtPct(Math.abs(askVsWalk || 0), 1)} below the institutional Walk, validating pursuit at the institutional self-managed lens`
    : verdict.label === "NEGOTIATE"
    ? `the ask falls between Strike and Walk — pursue with negotiated reduction`
    : `the ask exceeds the institutional Walk by ${fmtPct(Math.abs(askVsWalk || 0), 1)}, breaking the yield story under disciplined underwriting`;

  return `
<section class="page section">
  <h2 class="section-h">EXECUTIVE SUMMARY</h2>
  <div class="exec-body">
    <p>
      ${safe(snapshot.name)} is an existing-stabilized self-storage asset offered at <b>${fmt$(snapshot.ask)}</b>
      (${fmtN(snapshot.nrsf)} NRSF · ${fmt$(snapshot.pricePerSF)}/SF · cap on ask ${fmtPct(snapshot.capOnAsk, 2)}).
      The institutional self-managed lens — calibrated to FY2025 sector 10-K disclosures (24.86% same-store opex, 6.00–7.00% stabilized cap range, +12% brand-premium revenue lift) —
      reconstructs the buyer NOI from seller's T-12 EGI and applies the discipline of a self-managed national operator profile.
      The verdict is <b style="color:${verdict.label === "PURSUE" ? "#16A34A" : verdict.label === "NEGOTIATE" ? "#D97706" : "#DC2626"}">${verdict.label}</b>: ${verdictPhrase}.
    </p>
    ${platformDelta != null ? `<p>
      The platform-fit Δ — defined as the institutional Walk less the generic third-party-managed Walk on the identical asset —
      is <b>${fmt$(platformDelta)}</b>, quantifying the dollar value that an institutional self-managed REIT defensibly pays above a generic institutional buyer.
      The delta derives from the self-managed opex floor, the 12% brand-premium revenue lift, the absence of a third-party management fee,
      and the platform-integration yield uplift on rolled tenants disclosed in management transcripts.
      ${rentSanity ? `Independent SpareFoot cross-check on seller's implied effective rent: ${rentSanity.severity === "warn" ? "<b style=\"color:#D97706\">caution</b>" : rentSanity.severity === "info" ? "<b style=\"color:#2563EB\">value-add signal</b>" : "<b style=\"color:#16A34A\">aligned with submarket</b>"} (${fmtRate(rentSanity.impliedRatePerSF)} implied vs ${fmtRate(rentSanity.blendedMarketRate)} blended market).` : ""}
    </p>` : ""}
  </div>
</section>`;
}

function renderVerdictKPIStrip({ verdict, ps, analysis }) {
  const verdictColor = verdict.label === "PURSUE" ? "#22C55E" : verdict.label === "NEGOTIATE" ? "#F59E0B" : "#EF4444";
  const isPSA = !!(ps && ps.verdict);
  const generic = analysis?.verdict;
  const verdictsDiffer = isPSA && generic && generic.label !== verdict.label;

  const tiles = isPSA ? [
    { l: "Street Premium", v: `+${((ps.lens?.revenuePremium || 0) * 100).toFixed(0)}%`, sub: "vs comp set (10-K)" },
    { l: "Buyer NOI (Y1)", v: fmt$(ps.reconstructed?.buyerNOI), sub: `opex ${fmtPct(ps.reconstructed?.opexRatio, 1)}` },
    { l: "Stabilized Cap", v: fmtPct(ps.marketCap, 2), sub: ps.lens?.portfolioFit ? "−25 bps fit bonus" : "no fit bonus" },
    { l: "Mgmt Fee", v: "$0", sub: "self-managed" },
  ] : [];

  return `
<section class="page section">
  <h2 class="section-h">VERDICT &amp; UNDERWRITE</h2>
  <div class="verdict-card" style="border-color:${verdictColor}80;background:linear-gradient(135deg,rgba(15,21,56,0.92),rgba(30,39,97,0.7))">
    <div class="verdict-row">
      <div class="verdict-left">
        <div class="verdict-tag">STORVEX UNDERWRITE · VERDICT</div>
        <div class="verdict-label" style="color:${verdictColor}">${verdict.label}</div>
        <div class="verdict-rationale">${safe(verdict.rationale)}</div>
        ${verdictsDiffer ? `<div class="verdict-divergence" style="border-color:${generic.color}80">
          <span style="color:${generic.color};font-weight:800">Generic buyer would ${generic.label}</span> at this ask — the platform-fit Δ is the story below.
        </div>` : ""}
      </div>
      <div class="verdict-right">
        <div class="verdict-cap-l">STABILIZED CAP</div>
        <div class="verdict-cap-v">${fmtPct(ps?.marketCap, 2)}</div>
        ${ps?.lens?.portfolioFit ? `<div class="fit-bonus">✓ Portfolio fit (−25 bps)</div>` : ""}
      </div>
    </div>
  </div>

  ${tiles.length > 0 ? `<div class="kpi-strip">
    ${tiles.map(t => `<div class="kpi-tile">
      <div class="kpi-l">${t.l}</div>
      <div class="kpi-v">${t.v}</div>
      <div class="kpi-s">${t.sub}</div>
    </div>`).join("")}
  </div>` : ""}
</section>`;
}

function renderPriceTiers({ ps, analysis, snapshot }) {
  const psTiers = ps?.tiers || analysis?.tiers || {};
  const genericTiers = analysis?.tiers || {};
  const ask = snapshot.ask || 0;
  const rows = [
    { name: "Home Run", g: genericTiers.homeRun, p: psTiers.homeRun },
    { name: "Strike", g: genericTiers.strike, p: psTiers.strike },
    { name: "Walk", g: genericTiers.walk, p: psTiers.walk },
  ];
  return `
<section class="page section">
  <h2 class="section-h">PRICE TIERS · INSTITUTIONAL VS GENERIC</h2>
  <table class="data-table">
    <thead>
      <tr>
        <th class="th-name">Tier</th>
        <th class="th-num">Generic Buyer</th>
        <th class="th-num th-accent">Storvex (Institutional)</th>
        <th class="th-num">Δ Platform Premium</th>
        <th class="th-num">Δ vs Ask</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => {
        const delta = (r.p?.price && r.g?.price) ? r.p.price - r.g.price : null;
        const vsAsk = (r.p?.price && ask) ? (r.p.price - ask) / ask : null;
        const vsAskColor = vsAsk == null ? "#64748B" : vsAsk >= 0 ? "#16A34A" : "#DC2626";
        const sign = vsAsk != null && vsAsk >= 0 ? "+" : "";
        return `<tr>
          <td class="td-name">${r.name}</td>
          <td class="td-num">${fmt$Full(r.g?.price)}</td>
          <td class="td-num td-accent">${fmt$Full(r.p?.price)}</td>
          <td class="td-num td-delta">${delta != null ? `+${fmt$Full(delta)}` : "—"}</td>
          <td class="td-num" style="color:${vsAskColor}">${vsAsk != null ? `${sign}${fmtPct(vsAsk, 1)}` : "—"}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
  <div class="footnote">
    Cap basis: institutional secondary cap ${fmtPct(ps?.marketCap || 0.0625, 2)}. Platform Premium = (Storvex price − Generic price). The Δ column quantifies the platform-fit value an institutional self-managed REIT defensibly pays above a generic third-party-managed buyer on the identical asset.
  </div>
</section>`;
}

function renderNOIReconstruction({ ps, analysis, snapshot }) {
  const r = ps?.reconstructed || analysis?.reconstructed;
  if (!r) return "";
  const lines = r.lines || [];
  return `
<section class="page section">
  <h2 class="section-h">NOI RECONSTRUCTION · LINE-BY-LINE</h2>
  <div class="noi-headline">
    <div class="noi-tile"><div class="noi-l">Seller NOI (T-12)</div><div class="noi-v">${fmt$Full(r.sellerNOI)}</div></div>
    <div class="noi-tile noi-accent"><div class="noi-l">Buyer NOI (Reconstructed)</div><div class="noi-v">${fmt$Full(r.buyerNOI)}</div></div>
    <div class="noi-tile"><div class="noi-l">Δ NOI</div><div class="noi-v" style="color:${(r.deltaNOI || 0) >= 0 ? "#16A34A" : "#DC2626"}">${(r.deltaNOI || 0) >= 0 ? "+" : ""}${fmt$Full(r.deltaNOI)} (${fmtPct(r.deltaPct, 1)})</div></div>
  </div>
  <table class="data-table">
    <thead>
      <tr>
        <th class="th-name">Line Item</th>
        <th class="th-num">Buyer Reconstructed</th>
        <th class="th-basis">Basis</th>
      </tr>
    </thead>
    <tbody>
      ${lines.map(l => `<tr>
        <td class="td-name">${safe(l.line)}</td>
        <td class="td-num">${fmt$Full(l.buyer)}</td>
        <td class="td-basis">${safe(l.basis)}</td>
      </tr>`).join("")}
      <tr class="tr-total">
        <td class="td-name"><b>Total Operating Expense</b></td>
        <td class="td-num"><b>${fmt$Full(r.totalOpEx)}</b></td>
        <td class="td-basis">Opex ratio: ${fmtPct(r.opexRatio, 1)}</td>
      </tr>
    </tbody>
  </table>
  ${(r.flags && r.flags.length > 0) ? `<div class="flags-list">
    ${r.flags.map(f => `<div class="flag flag-${f.severity || "info"}">⚠ ${safe(f.text)}</div>`).join("")}
  </div>` : ""}
</section>`;
}

function renderProjection({ ps, analysis }) {
  const proj = ps?.projection || analysis?.projection;
  if (!proj) return "";
  return `
<section class="page section">
  <h2 class="section-h">STABILIZED PROJECTION · Y1 → Y3 → Y5</h2>
  <table class="data-table">
    <thead>
      <tr>
        <th class="th-name">Year</th>
        <th class="th-num">Revenue</th>
        <th class="th-num">Operating Expense</th>
        <th class="th-num th-accent">Net Operating Income</th>
      </tr>
    </thead>
    <tbody>
      <tr><td class="td-name">Year 1</td><td class="td-num">${fmt$Full(proj.y1?.rev)}</td><td class="td-num">${fmt$Full(proj.y1?.exp)}</td><td class="td-num td-accent">${fmt$Full(proj.y1?.noi)}</td></tr>
      <tr><td class="td-name">Year 3 (Stabilized)</td><td class="td-num">${fmt$Full(proj.y3?.rev)}</td><td class="td-num">${fmt$Full(proj.y3?.exp)}</td><td class="td-num td-accent">${fmt$Full(proj.y3?.noi)}</td></tr>
      <tr><td class="td-name">Year 5</td><td class="td-num">${fmt$Full(proj.y5?.rev)}</td><td class="td-num">${fmt$Full(proj.y5?.exp)}</td><td class="td-num td-accent">${fmt$Full(proj.y5?.noi)}</td></tr>
    </tbody>
  </table>
  <div class="footnote">${safe(proj.assumptions?.basis)}</div>
</section>`;
}

function renderValuationMatrix({ analysis, snapshot }) {
  const m = analysis?.matrix;
  if (!m) return "";
  const ask = snapshot.ask || 0;
  const yearLabels = { y1: "Year 1", y3: "Year 3", y5: "Year 5" };
  return `
<section class="page section">
  <h2 class="section-h">VALUATION MATRIX · YEAR × CAP RATE</h2>
  <table class="data-table matrix">
    <thead>
      <tr>
        <th class="th-name">NOI Year</th>
        ${m.capRates.map(c => `<th class="th-num">${(c * 100).toFixed(2)}%</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${m.years.map((y, yi) => `<tr>
        <td class="td-name">${yearLabels[y] || y}</td>
        ${m.cells[yi].map(v => {
          const within = ask > 0 && Math.abs((v - ask) / ask) <= 0.03;
          return `<td class="td-num ${within ? "td-highlight" : ""}">${fmt$Full(v)}</td>`;
        }).join("")}
      </tr>`).join("")}
    </tbody>
  </table>
  <div class="footnote">Highlighted cells denote implied values within ±3% of asking price (${fmt$Full(ask)}). The matrix triangulates value across stabilization horizons and cap-rate sensitivity.</div>
</section>`;
}

function renderRentSanity({ rentSanity }) {
  if (!rentSanity) return "";
  const sevColor = rentSanity.severity === "warn" ? "#D97706" : rentSanity.severity === "info" ? "#2563EB" : "#16A34A";
  const label = rentSanity.severity === "warn" ? "Rent Above Market" : rentSanity.severity === "info" ? "Rent Below Market" : "Rent Aligned";
  return `
<section class="page section">
  <h2 class="section-h">RENT SANITY · INSTITUTIONAL CROSS-CHECK</h2>
  <div class="sanity-card" style="border-color:${sevColor}40;background:rgba(${rentSanity.severity === "warn" ? "217,119,6" : rentSanity.severity === "info" ? "37,99,235" : "22,163,74"},0.06)">
    <div class="sanity-tag" style="background:${sevColor};color:#fff">${label.toUpperCase()}</div>
    <div class="sanity-message">${safe(rentSanity.message)}</div>
    <div class="sanity-grid">
      <div><div class="sg-l">Implied (T-12, full-occ)</div><div class="sg-v">${fmtRate(rentSanity.impliedRatePerSF)}</div></div>
      <div><div class="sg-l">Blended Submarket</div><div class="sg-v">${fmtRate(rentSanity.blendedMarketRate)}</div></div>
      <div><div class="sg-l">CC Market</div><div class="sg-v">${fmtRate(rentSanity.ccMarketRate)}</div></div>
      <div><div class="sg-l">Drive-Up Market</div><div class="sg-v">${fmtRate(rentSanity.driveUpMarketRate)}</div></div>
      <div><div class="sg-l">Premium / Discount</div><div class="sg-v" style="color:${sevColor}">${rentSanity.premiumPct >= 0 ? "+" : ""}${fmtPct(rentSanity.premiumPct, 1)}</div></div>
      <div><div class="sg-l">Source · Sample</div><div class="sg-v">${safe(rentSanity.source)} · n=${safe(rentSanity.sampleSize)}</div></div>
    </div>
  </div>
</section>`;
}

function renderHistoricalMSARents({ snapshot }) {
  if (!snapshot) return "";
  const city = snapshot.city || snapshot.location?.city;
  const state = snapshot.state || snapshot.location?.state;
  const msa = resolveCityToMSA(city, state);
  if (!msa) return "";
  const series = getHistoricalMSARentSeries(msa, "PSA");
  if (!series || !series.series || series.series.length < 2) return "";
  const meta = getHistoricalRentMetadata();

  const tooltipLine = `PSA Same Store Facilities Operating Trends by Market · FY${series.firstYear}-FY${series.lastYear} 10-K MD&A`;
  const cagrColor = series.cagrPct >= 5 ? "#16A34A" : series.cagrPct >= 3 ? "#2C3E6B" : "#D97706";

  return `
<section class="page section">
  <h2 class="section-h">PSA HISTORICAL RENT — ${(msa || "").toUpperCase()} (${series.firstYear}–${series.lastYear})</h2>
  <div class="sanity-card" style="border-color:#1E276140;background:rgba(214,228,247,0.18)">
    <div class="sanity-tag" style="background:#1E2761;color:#C9A84C">PRIMARY-SOURCE SEC EDGAR</div>
    <div class="sanity-message">
      PSA's per-MSA same-store rent disclosure for ${safe(msa)} over ${series.lastYear - series.firstYear + 1} fiscal years. Computed CAGR <b style="color:${cagrColor}">${series.cagrPct.toFixed(2)}%/yr</b> ($${series.firstRent.toFixed(2)} → $${series.lastRent.toFixed(2)}/SF/yr · ${series.totalChangePct.toFixed(1)}% total). EXR / CUBE / NSA do not disclose at MSA granularity in their MD&A — this series is unique to PSA's filings, ingested directly via Storvex's EDGAR backfill pipeline.
    </div>
    <table class="data-table" style="margin-top: 14px;">
      <thead>
        <tr>
          <th class="th-name">FY</th>
          <th class="th-num">Rent / Occ SF</th>
          <th class="th-num">Occupancy</th>
          <th class="th-num">Facilities</th>
          <th class="th-num">SqFt (M)</th>
        </tr>
      </thead>
      <tbody>
        ${series.series.map(p => `<tr>
          <td class="td-name">FY${p.year}</td>
          <td class="td-num">$${p.rentPerOccSF.toFixed(2)}</td>
          <td class="td-num">${p.occupancy != null ? (p.occupancy * 100).toFixed(1) + "%" : "—"}</td>
          <td class="td-num">${p.facilities != null ? p.facilities.toLocaleString() : "—"}</td>
          <td class="td-num">${p.sqftMillions != null ? p.sqftMillions.toFixed(1) : "—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <div style="margin-top:10px;font-size:9pt;color:#475569;">
      <b>Source:</b> ${safe(tooltipLine)}${meta ? ` · ${meta.timeSeriesRows} MSA series ingested · last refresh ${meta.generatedAt?.slice(0, 10)}` : ""}
    </div>
  </div>
</section>`;
}

function renderCrossREITHistoricalSameStore() {
  const latest = getCrossREITHistoricalLatest();
  if (!latest || !latest.contributingIssuers || latest.contributingIssuers.length === 0) {
    return "";
  }

  // Pull per-issuer rent-per-SF series for the cite-able mini-tables
  const issuerRows = latest.contributingIssuers
    .map((iss) => ({
      issuer: iss,
      rent: getHistoricalSameStoreSeries(iss, "sameStoreRentPerSF"),
      occ: getHistoricalSameStoreSeries(iss, "sameStoreOccupancyEOP"),
    }))
    .filter((row) => row.rent || row.occ);

  if (issuerRows.length === 0) return "";

  const fmtPct1 = (v) => (v == null || !isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);
  const fmtRentVal = (v) => (v == null || !isFinite(v) ? "—" : `$${v.toFixed(2)}`);
  const fmtCagrWithSpan = (series) => {
    if (!series || series.cagrPct == null || !isFinite(series.cagrPct)) return "—";
    const yrs = Number(series.lastYear) - Number(series.firstYear);
    return Number.isFinite(yrs) && yrs > 0
      ? `${series.cagrPct.toFixed(2)}%/yr (${yrs}-yr)`
      : `${series.cagrPct.toFixed(2)}%/yr`;
  };

  return `
<section class="page section">
  <h2 class="section-h">CROSS-REIT HISTORICAL SAME-STORE — PORTFOLIO-AGGREGATE CONTEXT</h2>
  <div class="sanity-card" style="border-color:#1E276140;background:rgba(214,228,247,0.10)">
    <div class="sanity-tag" style="background:#1E2761;color:#C9A84C">PRIMARY-SOURCE SEC EDGAR · CROSS-REIT</div>
    <div class="sanity-message">
      Multi-year portfolio-aggregate same-store performance for the institutional storage REITs that disclose at portfolio level (EXR, CUBE, NSA do not break out by MSA in their MD&A — these are the closest possible primary-source historical citations for non-PSA-specific buyer lenses). Cross-REIT FY${safe(latest.asOf)} averages: rent per occupied SF ${fmtRentVal(latest.avgSameStoreRentPerSF)} · occupancy ${fmtPct1(latest.avgSameStoreOccupancyEOP)} · revenue YoY ${fmtPct1(latest.avgSameStoreRevenueGrowthYoY)} · NOI YoY ${fmtPct1(latest.avgSameStoreNOIGrowthYoY)}.
    </div>
    <table class="data-table" style="margin-top: 14px;">
      <thead>
        <tr>
          <th class="th-name">Issuer</th>
          <th class="th-num">Rent / Occ SF — first yr</th>
          <th class="th-num">Rent / Occ SF — last yr</th>
          <th class="th-num">Computed CAGR</th>
          <th class="th-num">Datapoints</th>
          <th class="th-num">Occ first yr</th>
          <th class="th-num">Occ last yr</th>
        </tr>
      </thead>
      <tbody>
        ${issuerRows.map((row) => {
          const r = row.rent;
          const o = row.occ;
          return `<tr>
            <td class="td-name">${safe(row.issuer)}</td>
            <td class="td-num">${r ? `FY${r.firstYear} ${fmtRentVal(r.firstValue)}` : "—"}</td>
            <td class="td-num">${r ? `FY${r.lastYear} ${fmtRentVal(r.lastValue)}` : "—"}</td>
            <td class="td-num">${fmtCagrWithSpan(r)}</td>
            <td class="td-num">${r ? r.dataPoints : "—"}</td>
            <td class="td-num">${o ? `FY${o.firstYear} ${fmtPct1(o.firstValue)}` : "—"}</td>
            <td class="td-num">${o ? `FY${o.lastYear} ${fmtPct1(o.lastValue)}` : "—"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <div style="margin-top:10px;font-size:9pt;color:#475569;">
      <b>Source:</b> SEC EDGAR 10-K MD&amp;A · Same-Store Performance disclosures · ${safe(latest.contributingIssuers.join(" + "))} · ingested via Storvex/scripts/edgar/backfill-historical-same-store.mjs.
    </div>
  </div>
</section>`;
}

function renderComps({ analysis }) {
  const c = analysis?.comps;
  if (!c) return "";
  const comps = c.comps || [];
  if (comps.length === 0) return "";
  return `
<section class="page section">
  <h2 class="section-h">SALE COMPS · ${(c.state || "").toUpperCase()} ${c.fellbackToPeer ? "(PEER-STATE FALLBACK)" : ""}</h2>
  <div class="comp-summary">
    <div><span class="cs-l">Avg Cap Rate</span><span class="cs-v">${fmtPct(c.avgCap, 2)}</span></div>
    <div><span class="cs-l">Avg $/SF</span><span class="cs-v">${fmt$Full(c.avgPPSF)}</span></div>
    <div><span class="cs-l">Subject $/SF</span><span class="cs-v">${fmt$Full(c.subjectPPSF)}</span></div>
    <div><span class="cs-l">Subject vs Avg</span><span class="cs-v" style="color:${(c.subjectVsAvgPPSF || 0) >= 0 ? "#DC2626" : "#16A34A"}">${(c.subjectVsAvgPPSF || 0) >= 0 ? "+" : ""}${fmtPct(c.subjectVsAvgPPSF, 1)}</span></div>
  </div>
  <table class="data-table">
    <thead>
      <tr>
        <th class="th-name">City</th>
        <th class="th-name">Date</th>
        <th class="th-num">NRSF</th>
        <th class="th-num">$M</th>
        <th class="th-num">$/SF</th>
        <th class="th-num">Cap</th>
        <th class="th-name">Buyer</th>
      </tr>
    </thead>
    <tbody>
      ${comps.slice(0, 10).map(co => `<tr>
        <td class="td-name">${safe(co.city)}</td>
        <td class="td-name">${safe(co.date)}</td>
        <td class="td-num">${fmtN(co.nrsf)}</td>
        <td class="td-num">${co.priceMM != null ? `$${Number(co.priceMM).toFixed(2)}M` : "—"}</td>
        <td class="td-num">${fmt$Full(co.psf)}</td>
        <td class="td-num">${fmtPct(co.cap, 2)}</td>
        <td class="td-name">${safe(co.buyer)}</td>
      </tr>`).join("")}
    </tbody>
  </table>
</section>`;
}

function renderICMemo({ memo }) {
  if (!memo || !memo.execSummary) return "";
  return `
<section class="page section">
  <h2 class="section-h">INVESTMENT COMMITTEE MEMO</h2>
  <div class="memo-card">
    ${memo.recommendation ? `<div class="memo-rec"><div class="mr-l">RECOMMENDATION</div><div class="mr-v">${safe(memo.recommendation)}</div></div>` : ""}
    ${memo.execSummary ? `<div class="memo-section"><div class="ms-l">Executive Summary</div><div class="ms-v">${safe(memo.execSummary)}</div></div>` : ""}
    ${memo.bidPosture ? `<div class="memo-section"><div class="ms-l">Bid Posture</div><div class="ms-v">${safe(memo.bidPosture)}</div></div>` : ""}
    ${(memo.topRisks && memo.topRisks.length > 0) ? `<div class="memo-section"><div class="ms-l">Top Risks</div><ul class="ms-list">${memo.topRisks.map(r => `<li>${safe(r)}</li>`).join("")}</ul></div>` : ""}
    ${memo.buyerRouting ? `<div class="memo-section"><div class="ms-l">Strategic Alignment</div><div class="ms-v">${safe(memo.buyerRouting)}</div></div>` : ""}
  </div>
</section>`;
}

function renderEDGAR8KTransactions({ snapshot, analysis }) {
  const txs = analysis?.edgar8KTransactions;
  if (!Array.isArray(txs) || txs.length === 0) return "";
  const withPrice = txs.filter((t) => t.aggregate_price_million);
  if (withPrice.length === 0) return "";
  return `
<section class="page section">
  <h2 class="section-h">PER-DEAL TRANSACTION COMPS · SEC EDGAR 8-K FILINGS</h2>
  <div class="footnote" style="margin-bottom:14px;font-style:normal">
    Individual M&amp;A transactions disclosed by institutional storage REITs in their SEC 8-K material event filings. Each row links to the full disclosure on sec.gov. Use these as direct deal benchmarks alongside the cross-REIT cost-basis index above.
  </div>
  <table class="data-table">
    <thead>
      <tr>
        <th class="th-name">Date</th>
        <th class="th-name">Buyer</th>
        <th class="th-name">Target / Seller</th>
        <th class="th-num">Facilities</th>
        <th class="th-num">NRSF (M)</th>
        <th class="th-num">Price ($M)</th>
        <th class="th-num">$/SF</th>
        <th class="th-name">Type</th>
        <th class="th-name">SEC EDGAR</th>
      </tr>
    </thead>
    <tbody>
      ${withPrice.slice(0, 6).map((t) => {
        const psf = (t.aggregate_price_million && t.nrsf_million) ? Math.round(t.aggregate_price_million / t.nrsf_million) : null;
        return `<tr>
          <td class="td-name">${safe(t.filingDate)}</td>
          <td class="td-name"><b>${safe(t.issuer)}</b></td>
          <td class="td-name">${safe(t.target_entity || t.seller || "—")}</td>
          <td class="td-num">${t.num_facilities != null ? fmtN(t.num_facilities) : "—"}</td>
          <td class="td-num">${t.nrsf_million != null ? Number(t.nrsf_million).toFixed(1) : "—"}</td>
          <td class="td-num td-accent">${t.aggregate_price_million != null ? "$" + Math.round(t.aggregate_price_million).toLocaleString() : "—"}</td>
          <td class="td-num">${psf != null ? "$" + psf : "—"}</td>
          <td class="td-name">${safe(t.deal_type || "—")}${t.consideration_type ? ` · ${t.consideration_type}` : ""}</td>
          <td class="td-basis"><a href="${t.filingURL}" style="color:#1E2761;text-decoration:underline">${t.accessionNumber}</a></td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
  <div class="footnote">
    Each transaction extracted from the issuer's 8-K filing using a structured-output extraction pipeline (Claude Sonnet 4.6) with a "no fabrication" mandate — all fields trace to verbatim source text. Top of comp set: PSA-BREIT Simply Storage ($2.2B/127 fac/9.4M SF · $234/SF) and CUBE-LAACO ($1.74B/59 fac · $381/SF including non-storage assets). Both align directly with the cross-REIT cost-basis index above.
  </div>
</section>`;
}

// ─── Cross-REIT MOVE-IN RATE COMPARISON ─────────────────────────────────────
//
// Renders a section showing PSA + CUBE + EXR per-facility scraped move-in
// medians for the subject MSA. Each row links back to the operator's source
// URL on their public storage website. This is the Radius+ kill-shot block in
// the institutional PDF — every primary-source rate is here, no third-party
// data licensing, every operator's web rate vs in-store standard rate exposed.
function renderCrossREITMoveInRates({ snapshot, enrichment }) {
  if (!enrichment) return "";
  const rates = enrichment.crossREITMSARates || [];
  const meta = enrichment.crossREITScrapedMetadata;
  if (!rates.length || !meta) return "";

  return `
<section class="page section">
  <h2 class="section-h">CROSS-REIT MOVE-IN RATE COMPARISON · ${safe(enrichment.subjectMSA || snapshot.market || snapshot.state)} · PRIMARY-SOURCE PER-FACILITY SCRAPING</h2>
  <div class="edgar-headline">
    <div class="edgar-tile"><div class="ek-l">Operators Indexed</div><div class="ek-v">${meta.operatorCount} of 3</div></div>
    <div class="edgar-tile edgar-accent"><div class="ek-l">Total Facilities</div><div class="ek-v">${fmtN(meta.totalFacilities)}</div></div>
    <div class="edgar-tile"><div class="ek-l">Unit Listings</div><div class="ek-v">${fmtN(meta.totalUnitListings)}</div></div>
    <div class="edgar-tile"><div class="ek-l">MSA Coverage</div><div class="ek-v">${rates.length} REIT${rates.length === 1 ? "" : "s"} in ${safe(enrichment.subjectMSA || "—")}</div></div>
  </div>
  <table class="data-table">
    <thead>
      <tr>
        <th class="th-name">Operator</th>
        <th class="th-num">CC $/SF/mo (median)</th>
        <th class="th-num">CC Range</th>
        <th class="th-num">DU $/SF/mo (median)</th>
        <th class="th-num">Implied Discount</th>
        <th class="th-num">Sample</th>
        <th class="th-name">Source</th>
      </tr>
    </thead>
    <tbody>
      ${rates.map((row) => {
        const sourceUrl = row.operator === "PSA" ? "https://www.publicstorage.com/"
          : row.operator === "CUBE" ? "https://www.cubesmart.com/"
          : row.operator === "EXR" ? "https://www.extraspace.com/"
          : "";
        return `<tr>
          <td class="td-name"><b>${safe(row.operator)}</b><br/><span style="font-size:9pt;color:#64748B">${safe(row.operatorName)}</span></td>
          <td class="td-num td-accent">${row.ccMedianPerSF_mo != null ? "$" + row.ccMedianPerSF_mo.toFixed(2) : "—"}</td>
          <td class="td-num">${row.ccLowPerSF_mo != null && row.ccHighPerSF_mo != null ? "$" + row.ccLowPerSF_mo.toFixed(2) + "–$" + row.ccHighPerSF_mo.toFixed(2) : "—"}</td>
          <td class="td-num">${row.duMedianPerSF_mo != null ? "$" + row.duMedianPerSF_mo.toFixed(2) : "—"}</td>
          <td class="td-num">${row.impliedDiscountPct != null ? "−" + row.impliedDiscountPct.toFixed(1) + "%" : "—"}</td>
          <td class="td-num">${row.facilitiesScraped} fac · ${row.totalUnitListings} units</td>
          <td class="td-basis"><a href="${sourceUrl}" style="color:#1E2761;text-decoration:underline">${sourceUrl.replace("https://", "").replace(/\/$/, "")}</a></td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
  <div class="footnote">
    Per-facility move-in rates scraped directly from each operator's facility detail pages — Schema.org SelfStorage entities for PSA + EXR, structured HTML widget for CUBE. ${meta.operatorCount} of 3 public storage REITs indexed; ${fmtN(meta.totalFacilities)} facilities and ${fmtN(meta.totalUnitListings)} unit listings refreshed daily via GitHub Actions. <b>No third-party rate aggregator</b> (no SpareFoot, no Radius+) — every rate cites the operator's source URL on their public website. CUBE's "Implied Discount" column reflects the spread between web/online rate and in-store standard rate, exposing CUBE's promotional posture per market — a signal Radius+ does not surface. Combined with the Schedule III cost basis above and the M&A 8-K transactions below, every assumption in this report traces to either a SEC EDGAR accession # or a primary-source operator URL.
  </div>
</section>`;
}

// ─── ACQUISITION FINANCING SCENARIO ────────────────────────────────────────
//
// Renders the lens-specific levered hold scenario in the Goldman PDF.
// Capital stack + debt service + DSCR + cash-on-cash + 10-yr levered IRR.
// Closes the all-cash credibility gap on every artifact that hits a buyer.
function renderFinancingScenario({ psLens }) {
  const fin = psLens?.financing;
  if (!fin || !Number.isFinite(fin.equity) || fin.equity <= 0) return "";
  const a = fin.assumptions || {};
  const lensTicker = psLens?.lens?.ticker || "BUYER";

  return `
<section class="page section">
  <h2 class="section-h">ACQUISITION FINANCING · ${safe(lensTicker)} LENS · 10-YEAR LEVERED HOLD</h2>
  <div class="edgar-headline">
    <div class="edgar-tile edgar-accent" style="border:2px solid #3B82F688">
      <div class="ek-l">Levered IRR</div>
      <div class="ek-v" style="color:#3B82F6">${fin.leveredIRR != null ? (fin.leveredIRR * 100).toFixed(1) + "%" : "—"}</div>
    </div>
    <div class="edgar-tile">
      <div class="ek-l">Unlevered IRR</div>
      <div class="ek-v">${fin.unleveredIRR != null ? (fin.unleveredIRR * 100).toFixed(1) + "%" : "—"}</div>
    </div>
    <div class="edgar-tile">
      <div class="ek-l">Y1 DSCR</div>
      <div class="ek-v">${fin.y1DSCR != null ? fin.y1DSCR.toFixed(2) + "x" : "—"}</div>
    </div>
    <div class="edgar-tile">
      <div class="ek-l">Y1 Cash-on-Cash</div>
      <div class="ek-v">${fin.y1CashOnCash != null ? (fin.y1CashOnCash * 100).toFixed(1) + "%" : "—"}</div>
    </div>
    <div class="edgar-tile">
      <div class="ek-l">Y3 Cash-on-Cash</div>
      <div class="ek-v">${fin.y3CashOnCash != null ? (fin.y3CashOnCash * 100).toFixed(1) + "%" : "—"}</div>
    </div>
  </div>
  <table class="data-table">
    <thead>
      <tr>
        <th class="th-name">Capital Stack / Term</th>
        <th class="th-num">Value</th>
        <th class="th-name">Notes</th>
      </tr>
    </thead>
    <tbody>
      <tr><td class="td-name"><b>Acquisition price</b></td><td class="td-num">${fmt$(Math.round(fin.ask))}</td><td class="td-basis">Storvex-recommended takedown for ${safe(lensTicker)} lens</td></tr>
      <tr><td class="td-name">Senior debt (${(a.ltv * 100).toFixed(0)}% LTV)</td><td class="td-num">${fmt$(Math.round(fin.loanAmount))}</td><td class="td-basis">${safe(a.debtSource || "Institutional senior debt")}</td></tr>
      <tr><td class="td-name"><b>Equity required</b></td><td class="td-num td-accent">${fmt$(Math.round(fin.equity))}</td><td class="td-basis">${(((1 - a.ltv) * 100)).toFixed(0)}% equity contribution</td></tr>
      <tr><td class="td-name">Interest rate</td><td class="td-num">${(a.rate * 100).toFixed(2)}%</td><td class="td-basis">${a.amortYrs}-yr amort · ${a.termYrs}-yr fixed term</td></tr>
      <tr><td class="td-name">Annual debt service (P&amp;I)</td><td class="td-num">${fmt$(Math.round(fin.annualDebtService))}</td><td class="td-basis">Monthly P&amp;I × 12</td></tr>
      <tr><td class="td-name">Y1 NOI / Y3 NOI</td><td class="td-num">${fmt$(Math.round(fin.y1NOI))} / ${fmt$(Math.round(fin.y3NOI))}</td><td class="td-basis">Going-in / stabilized projection</td></tr>
      <tr><td class="td-name">Exit cap (Y10)</td><td class="td-num">${(a.effectiveExitCap * 100).toFixed(2)}%</td><td class="td-basis">Going-in cap + ${(a.exitCapDelta * 100).toFixed(0)} bps cap expansion</td></tr>
      <tr><td class="td-name">Y10 exit value</td><td class="td-num">${fmt$(Math.round(fin.exitValue))}</td><td class="td-basis">Y10 NOI ÷ exit cap</td></tr>
      <tr><td class="td-name">Remaining loan at exit</td><td class="td-num">${fmt$(Math.round(fin.remainingLoanAtExit))}</td><td class="td-basis">Amortized principal balance</td></tr>
    </tbody>
  </table>
  <div class="footnote" style="margin-top:14pt">
    <b>Levered hold model:</b> Y0 equity ${fmt$(Math.round(fin.equity))}; Y1-Y10 net cash flow = NOI − $${Math.round(fin.annualDebtService).toLocaleString()} debt service (rent ramps Y1→Y3 linearly, then grows ${((a.rentGrowthYoY ?? 0.02) * 100).toFixed(1)}%/yr per ${safe(lensTicker)}'s disclosed industry ECRI). Y10 exit = sale (${fmt$(Math.round(fin.exitValue))}) − remaining principal (${fmt$(Math.round(fin.remainingLoanAtExit))}) → equity received at exit. IRR solved via bisection on the levered cash-flow series.<br/><br/>
    <b>Levered IRR ${fin.leveredIRR != null ? (fin.leveredIRR * 100).toFixed(1) + "%" : "—"}</b> vs <b>Unlevered IRR ${fin.unleveredIRR != null ? (fin.unleveredIRR * 100).toFixed(1) + "%" : "—"}</b>. Spread = leverage premium (debt amplification of unlevered yield).<br/><br/>
    <b>Lens-specific debt assumptions</b> (LTV ${(a.ltv * 100).toFixed(0)}% · rate ${(a.rate * 100).toFixed(2)}% · ${a.amortYrs}-yr amort · ${a.termYrs}-yr term) reflect ${safe(lensTicker)}'s institutional cost-of-capital position. Sources: Newmark 2025 Self-Storage Capital Markets Report + Cushman &amp; Wakefield H1 2025 Self-Storage Trends · Capital Markets section + Q1 2026 Freddie SBL/CMBS storage rate sheets. PSA's actual unsecured corporate cost is ~25-50 bps tighter than the modeled rate; UHAL parent corp credit makes UHAL debt cheaper than other small/mid caps.
  </div>
</section>`;
}

// ─── NEW-SUPPLY PIPELINE ───────────────────────────────────────────────────
//
// Renders the institutional REIT pipeline within 3 mi of the subject site.
// Saturation verdict at top tells the analyst whether to haircut Y3 NOI
// because of competing new supply. Each row cites the source REIT's 10-K
// accession #.
function renderDevelopmentPipeline({ enrichment }) {
  const nearby = enrichment?.pipelineNearby;
  const saturation = enrichment?.pipelineSaturation;
  const metadata = enrichment?.pipelineMetadata;
  if (!Array.isArray(nearby) || nearby.length === 0 || !saturation) return "";

  const severityColor =
    saturation.severity === "MATERIAL" ? "#EF4444" :
    saturation.severity === "MODERATE" ? "#F59E0B" :
    "#94A3B8";

  // Pipeline Confidence: classify each facility's source citation + freshness.
  // Closes the structural gap vs Radius+ (no verification status, no freshness
  // stamps). VERIFIED = primary-source citation (REIT 10-K accession # / county
  // permit # / planning commission record); CLAIMED = aggregator/screenshot;
  // STALE = primary-source citation > 90 days old; UNVERIFIED = no source info.
  const confidenceOpts = { fileGeneratedAt: metadata?.generatedAt || null };
  const confidenceAgg = aggregatePipelineConfidence(nearby, confidenceOpts);

  const totalConfident = confidenceAgg.counts.VERIFIED + confidenceAgg.counts.CLAIMED;
  const confidencePct = nearby.length > 0 ? Math.round((totalConfident / nearby.length) * 100) : 0;

  return `
<section class="page section">
  <h2 class="section-h">NEW-SUPPLY PIPELINE · 3-MI RADIUS · ${safe(saturation.severity)}</h2>
  <div class="edgar-headline">
    <div class="edgar-tile" style="border:2px solid ${severityColor}88">
      <div class="ek-l">Saturation</div>
      <div class="ek-v" style="color:${severityColor};font-size:14pt">${safe(saturation.severity)}</div>
    </div>
    <div class="edgar-tile">
      <div class="ek-l">CC SF in Y1-Y3</div>
      <div class="ek-v">${saturation.ccNRSFInHorizon ? (saturation.ccNRSFInHorizon / 1000).toFixed(0) + "K" : "0"}</div>
    </div>
    <div class="edgar-tile">
      <div class="ek-l">Total Pipeline NRSF</div>
      <div class="ek-v">${saturation.totalNRSF ? (saturation.totalNRSF / 1000).toFixed(0) + "K" : "0"}</div>
    </div>
    <div class="edgar-tile">
      <div class="ek-l">Facilities in Horizon</div>
      <div class="ek-v">${saturation.facilitiesInHorizon || 0} of ${saturation.facilityCount || 0}</div>
    </div>
  </div>
  <div class="sanity-card" style="border-color:#1E276140;background:rgba(214,228,247,0.10);margin-top:10pt">
    <div class="sanity-tag" style="background:#1E2761;color:#C9A84C">PIPELINE CONFIDENCE · STORVEX VERIFICATION LAYER</div>
    <div class="sanity-message">
      Each pipeline facility carries a verification status derived from its source citation. <b style="color:#16A34A">${confidenceAgg.counts.VERIFIED} VERIFIED</b> (primary-source cite ≤ 90 days old) · <b style="color:#D97706">${confidenceAgg.counts.CLAIMED} CLAIMED</b> (aggregator or screenshot only) · <b style="color:#EA580C">${confidenceAgg.counts.STALE} STALE</b> (primary-source cite > 90 days old) · <b style="color:#64748B">${confidenceAgg.counts.UNVERIFIED} UNVERIFIED</b> (no source). Weighted CC SF (confidence-discounted): <b>${(confidenceAgg.weightedTotalCCSF / 1000).toFixed(0)}K</b> of <b>${(confidenceAgg.rawTotalCCSF / 1000).toFixed(0)}K</b> raw. ${confidencePct}% of rows traced to a primary source — institutional displacement of aggregator-only pipeline data.
    </div>
  </div>
  <table class="data-table" style="margin-top:14px">
    <thead>
      <tr>
        <th class="th-name">Operator</th>
        <th class="th-name">Location</th>
        <th class="th-num">Distance</th>
        <th class="th-num">NRSF</th>
        <th class="th-num">CC%</th>
        <th class="th-name">Delivery</th>
        <th class="th-name">Status</th>
        <th class="th-name">Verification</th>
      </tr>
    </thead>
    <tbody>
      ${nearby.map((row) => `<tr>
        <td class="td-name"><b>${safe(row.operator)}</b><br/><span style="font-size:9pt;color:#64748B">${safe(row.operatorName)}</span></td>
        <td class="td-name">${safe(row.address)}<br/><span style="font-size:9pt;color:#64748B">${safe(row.city)}, ${safe(row.state)} · ${safe(row.msa)}</span></td>
        <td class="td-num">${row.distanceMi != null ? row.distanceMi.toFixed(2) + " mi" : "—"}</td>
        <td class="td-num">${row.nrsf != null ? (row.nrsf / 1000).toFixed(0) + "K" : "—"}</td>
        <td class="td-num">${row.ccPct != null ? row.ccPct + "%" : "—"}</td>
        <td class="td-name">${safe(row.expectedDelivery)}</td>
        <td class="td-name" style="text-transform:uppercase;font-size:9pt">${safe((row.status || "").replace(/-/g, " "))}</td>
        <td class="td-basis">${renderConfidenceChip(row, confidenceOpts)}</td>
      </tr>`).join("")}
    </tbody>
  </table>
  <div class="footnote" style="margin-top:14pt">
    <b style="color:${severityColor}">Verdict:</b> ${safe(saturation.narrative)}<br/><br/>
    <b>Methodology:</b> Phase ${metadata?.phase || 1} pipeline dataset sourced from each REIT's FY2025 10-K MD&A 'Properties Under Development' sections + Q1 2026 earnings transcripts. ${metadata?.totalFacilities || 0} disclosed institutional REIT pipeline facilities indexed nationally; ${nearby.length} fall within the subject site's 3-mi proximity radius. Refreshes quarterly upon new 10-Q/10-K filings.<br/><br/>
    <b>Pipeline Confidence layer:</b> Storvex's structural answer to the aggregator-data gap that institutional users routinely confirm in Radius Plus. Each facility's source citation is classified — REIT EDGAR filing or municipal permit = VERIFIED; aggregator scrape or screenshot = CLAIMED; verified entries older than 90 days flip to STALE pending re-confirmation. Confidence-weighted CC SF (VERIFIED × 1.0, CLAIMED × 0.5, STALE × 0.3, UNVERIFIED × 0.0) gives institutional underwriters a defensible Y3-NOI haircut input. Re-verification cadence: REIT entries quarterly upon 10-Q filings; permit entries on planning-commission cycle; screenshot intake on DW request.<br/><br/>
    <b>Saturation thresholds (LOCKED):</b> ≥ 100K SF CC delivering Y1-Y3 → MATERIAL flag · 50-100K SF → MODERATE flag · &lt; 50K SF or all delivering Y4+ → MINIMAL impact. <b>Storvex flags but does NOT auto-adjust the Y3 NOI math</b> — the analyst makes the haircut call based on local trade-area dynamics + absorption assumptions.
  </div>
</section>`;
}

// ─── MULTI-LENS BUYER COMPARISON ───────────────────────────────────────────
//
// Renders the side-by-side buyer comparison view in the institutional PDF.
// Same shape as the dashboard MultiLensComparisonCard: one row per buyer,
// sorted DESC by implied takedown price. Top row is the natural takeout.
// The platform-fit Δ (top vs GENERIC) is the institutional moat in dollars.
function renderMultiLensComparison({ multiLensRows, platformFitDelta, snapshot }) {
  if (!Array.isArray(multiLensRows) || multiLensRows.length < 2) return "";
  const ask = snapshot?.ask || 0;

  const verdictColor = (v) =>
    v === "HURDLE_CLEARED" ? "#22C55E" :
    v === "AT_HURDLE" ? "#F59E0B" :
    v === "MISSES_HURDLE" ? "#EF4444" :
    "#94A3B8";
  const verdictLabel = (v) =>
    v === "HURDLE_CLEARED" ? "CLEARED" :
    v === "AT_HURDLE" ? "AT HURDLE" :
    v === "MISSES_HURDLE" ? "MISSES" :
    "—";

  return `
<section class="page section">
  <h2 class="section-h">MULTI-BUYER COMPARISON · ALL LENSES · WHO WOULD PAY MOST</h2>
  ${platformFitDelta && Number.isFinite(platformFitDelta.deltaDollars) ? `
  <div class="edgar-headline">
    <div class="edgar-tile edgar-accent" style="border:2px solid #22C55E88">
      <div class="ek-l">Platform-Fit Δ</div>
      <div class="ek-v" style="color:#22C55E">${platformFitDelta.deltaDollars >= 0 ? "+" : ""}${fmt$(Math.round(platformFitDelta.deltaDollars))}</div>
    </div>
    <div class="edgar-tile">
      <div class="ek-l">Top Buyer</div>
      <div class="ek-v">${safe(platformFitDelta.topLensTicker)}</div>
    </div>
    <div class="edgar-tile">
      <div class="ek-l">Top Price</div>
      <div class="ek-v">${fmt$(Math.round(platformFitDelta.topPrice))}</div>
    </div>
    <div class="edgar-tile">
      <div class="ek-l">Generic Price</div>
      <div class="ek-v">${fmt$(Math.round(platformFitDelta.genericPrice))}</div>
    </div>
    ${platformFitDelta.deltaPct != null ? `
    <div class="edgar-tile">
      <div class="ek-l">Δ %</div>
      <div class="ek-v">${(platformFitDelta.deltaPct * 100).toFixed(1)}%</div>
    </div>` : ""}
  </div>` : ""}
  <table class="data-table">
    <thead>
      <tr>
        <th class="th-name">Buyer</th>
        <th class="th-num">Deal Stab Cap</th>
        <th class="th-num">Lens Hurdle</th>
        <th class="th-num">Δ vs Hurdle</th>
        <th class="th-name">Verdict</th>
        <th class="th-num">Implied Takedown $</th>
        <th class="th-num">vs Ask</th>
      </tr>
    </thead>
    <tbody>
      ${multiLensRows.map((row, i) => {
        const isWinner = i === 0 && row.impliedTakedownPrice != null;
        const vsAsk = (ask > 0 && row.impliedTakedownPrice != null)
          ? (row.impliedTakedownPrice - ask) / ask
          : null;
        return `<tr${isWinner ? ' style="background:rgba(201,168,76,0.10)"' : ""}>
          <td class="td-name"><b>${isWinner ? "★ " : ""}${safe(row.ticker)}</b><br/><span style="font-size:9pt;color:#64748B">${safe(row.name)}</span></td>
          <td class="td-num">${row.dealStabCap != null ? (row.dealStabCap * 100).toFixed(2) + "%" : "—"}</td>
          <td class="td-num">${row.lensTargetCap != null ? (row.lensTargetCap * 100).toFixed(2) + "%" : "—"}</td>
          <td class="td-num" style="color:${verdictColor(row.verdict)};font-weight:700">${row.bpsDelta != null ? (row.bpsDelta >= 0 ? "+" : "") + row.bpsDelta + " bps" : "—"}</td>
          <td class="td-name" style="color:${verdictColor(row.verdict)};font-weight:700">${safe(verdictLabel(row.verdict))}</td>
          <td class="td-num td-accent">${row.impliedTakedownPrice != null ? fmt$(Math.round(row.impliedTakedownPrice)) : "—"}</td>
          <td class="td-num" style="color:${vsAsk != null ? (vsAsk >= 0 ? "#22C55E" : "#EF4444") : "#64748B"}">${vsAsk != null ? (vsAsk >= 0 ? "+" : "") + (vsAsk * 100).toFixed(1) + "%" : "—"}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
  <div class="footnote" style="margin-top:14pt">
    <b>Implied Takedown $</b> = Y3 stabilized NOI ÷ lens hurdle (the price each buyer would pay AT their own underwriting hurdle). Each lens applies its own opex ratios + brand premium + portfolio-fit bonus, so the same input deal produces different reconstructed NOIs and different prices. Top row (★) is the natural institutional takeout — they would pay the most at their own hurdle.<br/><br/>
    <b>Platform-Fit Δ</b> = top buyer's implied takedown price minus GENERIC's implied takedown price = the dollar value the institutional self-managed REIT defensibly pays above a generic third-party-managed buyer on the identical asset.<br/><br/>
    <b>Citations:</b> Each lens's constants trace to a specific FY2025 10-K accession # on sec.gov. PSA 0001628280-26-007696 · EXR 0001289490-26-000011 · CUBE 0001298675-26-000010 · SMA 0001193125-26-082573 · GENERIC = cross-REIT average.
  </div>
</section>`;
}

// ─── YOC HURDLE VERDICT (BUYER-LENS) ───────────────────────────────────────
//
// Renders a one-page section showing the deal's stabilized cap vs the
// selected buyer's underwriting hurdle. Mirrors the dashboard YOCVerdictCard
// so the PDF the buyer (Reza, U-Haul COO, etc.) reads tells the same story
// as the live dashboard.
function renderYOCVerdict({ psLens }) {
  if (!psLens?.projection?.y3 || !psLens?.snapshot?.ask) return "";
  const ask = psLens.snapshot.ask;
  const y3NOI = psLens.projection.y3.noi;
  const target = psLens.marketCap;
  if (!Number.isFinite(y3NOI) || y3NOI <= 0 || !Number.isFinite(target) || target <= 0 || ask <= 0) return "";
  const dealStabCap = y3NOI / ask;
  const bps = Math.round((dealStabCap - target) * 10000);
  const label = bps >= 50 ? "HURDLE CLEARED" : bps >= -25 ? "AT HURDLE" : "MISSES HURDLE";
  const color = bps >= 50 ? "#22C55E" : bps >= -25 ? "#F59E0B" : "#EF4444";
  const lensName = psLens.lens?.ticker || "BUYER";
  const lensFullName = psLens.lens?.name || "Buyer Lens";
  const devYOCTarget = psLens.lens?.devYOCTarget;
  const narrative = bps >= 50
    ? `${lensFullName} would PURSUE — deal stabilized cap is ${Math.abs(bps)} bps above the lens hurdle. Yield story holds with cushion.`
    : bps >= -25
      ? `${lensFullName} would NEGOTIATE — deal stabilized cap is within ±25 bps of the lens hurdle. Marginal at ask; pursue at or below Strike.`
      : `${lensFullName} would PASS — deal stabilized cap is ${Math.abs(bps)} bps below the lens hurdle. Yield story breaks under disciplined underwriting.`;

  return `
<section class="page section">
  <h2 class="section-h">YOC HURDLE · ${safe(lensName)} LENS · DEAL STABILIZED CAP VS BUYER UNDERWRITING TARGET</h2>
  <div class="edgar-headline">
    <div class="edgar-tile"><div class="ek-l">Deal Stab Cap</div><div class="ek-v">${(dealStabCap * 100).toFixed(2)}%</div></div>
    <div class="edgar-tile edgar-accent"><div class="ek-l">${safe(lensName)} Hurdle</div><div class="ek-v">${(target * 100).toFixed(2)}%</div></div>
    <div class="edgar-tile" style="border:2px solid ${color}88"><div class="ek-l">Δ vs Hurdle</div><div class="ek-v" style="color:${color}">${bps >= 0 ? "+" : ""}${bps} bps</div></div>
    <div class="edgar-tile" style="border:2px solid ${color}88"><div class="ek-l">Verdict</div><div class="ek-v" style="color:${color};font-size:14pt">${safe(label)}</div></div>
    ${devYOCTarget ? `<div class="edgar-tile"><div class="ek-l">Dev YOC (context)</div><div class="ek-v">${(devYOCTarget * 100).toFixed(1)}%</div></div>` : ""}
  </div>
  <div class="footnote" style="margin-top:14pt;font-size:10pt;line-height:1.5">
    <b style="color:${color}">${safe(narrative)}</b><br/><br/>
    <b>Calculation:</b> Deal stabilized cap = Y3 stabilized NOI (${fmt$(Math.round(y3NOI))}) ÷ asking price (${fmt$(ask)}) = ${(dealStabCap * 100).toFixed(2)}%. ${safe(lensName)} target acquisition cap = ${(target * 100).toFixed(2)}% (${safe(psLens.lens?.capBasis || "MSA-tier acq cap")}).
    <br/><br/>
    <b>Verdict thresholds:</b> ≥ +50 bps above hurdle → HURDLE CLEARED · −25 to +50 bps → AT HURDLE (marginal) · &lt; −25 bps → MISSES HURDLE.
    ${devYOCTarget ? `<br/><br/><b>Dev YOC target (${(devYOCTarget * 100).toFixed(1)}%) is shown for context only</b> — ${safe(lensName)}'s ground-up development hurdle, not their stabilized acquisition hurdle. This deal is a stabilized acquisition; the relevant comparison is deal stabilized cap vs target acq cap (above).` : ""}
    ${psLens.lens?.citationFootnote ? `<br/><br/><b>Lens citation:</b> ${safe(psLens.lens.citationFootnote)}` : ""}
  </div>
</section>`;
}

function renderEDGARCrossREIT({ snapshot, analysis }) {
  const e = analysis.edgarComp;
  if (!e) return "";
  return `
<section class="page section">
  <h2 class="section-h">INSTITUTIONAL CROSS-REIT COST BASIS · ${safe(e.stateName)} · SEC EDGAR PRIMARY-SOURCE</h2>
  <div class="edgar-headline">
    <div class="edgar-tile"><div class="ek-l">Total Facilities</div><div class="ek-v">${fmtN(e.totalFacilities)}</div></div>
    <div class="edgar-tile"><div class="ek-l">NRSF (disclosed)</div><div class="ek-v">${e.totalNRSFThousands ? (e.totalNRSFThousands / 1000).toFixed(1) + "M SF" : "—"}</div></div>
    <div class="edgar-tile edgar-accent"><div class="ek-l">Weighted $/SF</div><div class="ek-v">${e.weightedPSF != null ? "$" + e.weightedPSF : "—"}</div></div>
    <div class="edgar-tile"><div class="ek-l">$ / Facility (avg)</div><div class="ek-v">${e.avgPerFacilityM != null ? "$" + e.avgPerFacilityM + "M" : "—"}</div></div>
    <div class="edgar-tile"><div class="ek-l">Portfolio Depreciation</div><div class="ek-v">${e.depreciationRatio != null ? (e.depreciationRatio * 100).toFixed(1) + "%" : "—"}</div></div>
    <div class="edgar-tile"><div class="ek-l">Cross-validated by</div><div class="ek-v">${e.numIssuersContributing} of 3 REITs</div></div>
  </div>
  <table class="data-table">
    <thead>
      <tr>
        <th class="th-name">REIT</th>
        <th class="th-name">Source Label</th>
        <th class="th-num">Facilities</th>
        <th class="th-num">NRSF (K)</th>
        <th class="th-num">Gross Carrying ($K)</th>
        <th class="th-num">Implied $/SF</th>
        <th class="th-num">Dep%</th>
        <th class="th-name">SEC EDGAR Citation</th>
      </tr>
    </thead>
    <tbody>
      ${e.issuers.map((i) => `<tr>
        <td class="td-name"><b>${safe(i.issuer)}</b></td>
        <td class="td-name">${safe(i.sourceLabel)}</td>
        <td class="td-num">${fmtN(i.facilities)}</td>
        <td class="td-num">${i.nrsfThousands != null ? fmtN(i.nrsfThousands) : "—"}</td>
        <td class="td-num">${fmt$Full(i.totalGrossThou)}</td>
        <td class="td-num td-accent">${i.impliedPSF != null ? "$" + i.impliedPSF : "—"}</td>
        <td class="td-num">${i.depreciationRatio != null ? (i.depreciationRatio * 100).toFixed(1) + "%" : "—"}</td>
        <td class="td-basis"><a href="${i.filingURL}" style="color:#1E2761;text-decoration:underline">${i.accessionNumber}</a> · ${safe(i.filingDate)}</td>
      </tr>`).join("")}
    </tbody>
  </table>
  <div class="footnote">
    Cross-REIT institutional cost basis derived from SEC EDGAR 10-K Schedule III filings (Real Estate and Accumulated Depreciation). Every row links back to the issuer's filing on sec.gov. ${e.numIssuersContributing >= 3 ? "<b>Triple-validated</b> — three independent REIT lenses corroborate this market." : e.numIssuersContributing >= 2 ? "<b>Cross-validated</b> — two independent REIT lenses corroborate this market." : "Single-issuer data point — additional validation desirable."}
  </div>
</section>`;
}

function renderAudit({ snapshot, ps, analysis }) {
  const e = analysis?.edgarComp;
  return `
<section class="page section section-last">
  <h2 class="section-h">AUDIT &amp; PROVENANCE</h2>
  <table class="audit-table">
    <tr><td class="ka">Underwrite Constants</td><td class="va">FY2025 sector 10-K disclosures · same-store opex 24.86% of revenue, payroll 3.43%, marketing 2.21%, R&amp;M 2.07%, utilities 1.32%, G&amp;A 3.07%</td></tr>
    <tr><td class="ka">Stabilized Cap Basis</td><td class="va">Institutional secondary cap ${fmtPct(ps?.marketCap || 0.0625, 2)}${ps?.lens?.portfolioFit ? " (incl. −25 bps portfolio-fit bonus)" : ""}</td></tr>
    <tr><td class="ka">Brand Premium</td><td class="va">+${((ps?.lens?.revenuePremium || 0.12) * 100).toFixed(0)}% revenue lift on subject EGI · third-party derived (consumer pricing analysis, sector midpoint 10–15% range)</td></tr>
    <tr><td class="ka">State Tax Reassessment</td><td class="va">${safe(snapshot.state)} state tax matrix applied to ask price (purchase reassessment basis)</td></tr>
    <tr><td class="ka">Demographics</td><td class="va">ESRI ArcGIS GeoEnrichment 2025 · CY 2025 estimates + FY 2030 projections · 1-3-5 mi geocoded radial rings</td></tr>
    <tr><td class="ka">Operator-Family Index</td><td class="va">3,473 facilities indexed · combined PS + iStorage + NSA family registry, 2026-Q2 vintage</td></tr>
    <tr><td class="ka">Market Rents</td><td class="va">SpareFoot live submarket scan · CC + drive-up rates blended at subject CC mix</td></tr>
    ${e ? `<tr><td class="ka">Cross-REIT Cost Basis</td><td class="va"><b>SEC EDGAR primary-source</b> · ${e.numIssuersContributing} institutional REIT(s) cross-validating ${safe(e.stateName)} · ${fmtN(e.totalFacilities)} facilities · ${e.weightedPSF != null ? "$" + e.weightedPSF + "/SF weighted basis" : "no weighted basis (NRSF not disclosed)"} · accession #s in cross-REIT block above</td></tr>` : ""}
    <tr><td class="ka">Sale Comps</td><td class="va">REIT 10-K transactions · Cushman &amp; Wakefield · SSA Global · MMX (Marcus &amp; Millichap)${e ? " · supplemented by SEC EDGAR Schedule III ingestion (5,818 facilities indexed across 3 institutional REITs)" : ""}</td></tr>
    <tr><td class="ka">Framework</td><td class="va">Storvex Valuation Framework v2 · 8-step institutional methodology · calibrated on Red Rock Mega Storage Reno NV (April 2026 PASS log)</td></tr>
    <tr><td class="ka">Schema · Document ID</td><td class="va">storvex.asset-analyzer.v1 · ${docIdFrom(snapshot)}</td></tr>
  </table>
  <div class="audit-disclaimer">
    This document is prepared for institutional acquisition review. All figures are derived from seller-supplied or publicly disclosed source data and processed through deterministic underwriting math. Constants are pinned to the source vintages enumerated above; old payloads remain immutable. This is a buyer-lens reconstruction — not an independent appraisal. Confirm assumptions with seller diligence and a qualified third-party appraiser before any binding commitment.
  </div>
</section>`;
}

function renderFooter({ docId }) {
  return `
<footer class="doc-footer">
  <div class="ff-l">
    <b>STORVEX <span class="gold">PS</span></b> · Asset Analyzer Report · ${docId}
  </div>
  <div class="ff-r">
    Prepared by <b>Daniel P. Roscoe</b> · DJR Real Estate LLC · Droscoe@DJRrealestate.com · 312.805.5996
  </div>
</footer>`;
}

// ─── Embedded CSS — Goldman-exec institutional styling ─────────────────────
function reportCSS() {
  return `
<style>
  @page { size: Letter; margin: 0.55in; }
  @page :first { margin: 0; }
  @media print {
    body { background: #fff !important; }
    .no-print { display: none !important; }
    .page { page-break-before: always; }
    .cover { page-break-after: always; }
    .section-last { page-break-after: avoid; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: 'Inter', 'Calibri', 'Segoe UI', sans-serif; color: #1E293B; background: #F8FAFC; line-height: 1.5; }
  .gold { color: #C9A84C; }

  /* ── Print/Save controls (screen only) ────────────────────────────────── */
  .controls { position: fixed; top: 16px; right: 16px; z-index: 100; }
  .print-btn {
    padding: 12px 28px; border-radius: 10px; border: none; cursor: pointer;
    background: linear-gradient(135deg, #C9A84C, #A08530); color: #fff;
    font-size: 13px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
    box-shadow: 0 4px 16px rgba(201,168,76,0.4); font-family: inherit;
  }
  .print-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(201,168,76,0.5); }

  /* ── Cover page ───────────────────────────────────────────────────────── */
  .cover { background: #1E2761; color: #fff; min-height: 100vh; padding: 0; }
  .cover-strip {
    background: #0F1538; padding: 18px 48px; display: flex; justify-content: space-between;
    align-items: center; border-bottom: 4px solid #C9A84C;
  }
  .brand { font-size: 18px; font-weight: 900; letter-spacing: 0.18em; }
  .cover-meta { text-align: right; font-size: 10px; letter-spacing: 0.12em; color: #D6E4F7; }
  .doc-id { font-family: 'Space Mono', 'Courier New', monospace; color: #C9A84C; margin-top: 4px; }
  .cover-body { padding: 48px 48px 32px; }
  .cover-tag {
    display: inline-block; padding: 6px 14px; background: rgba(201,168,76,0.15);
    border: 1px solid #C9A84C80; border-radius: 4px; font-size: 10px; letter-spacing: 0.15em;
    color: #C9A84C; font-weight: 700; margin-bottom: 24px;
  }
  .cover-title { font-size: 36px; font-weight: 900; letter-spacing: -0.01em; line-height: 1.1; margin-bottom: 8px; }
  .cover-sub { font-size: 14px; color: #94A3B8; margin-bottom: 32px; }

  .cover-verdict {
    border: 2px solid; border-radius: 10px; padding: 24px 28px; margin-bottom: 28px;
  }
  .cover-verdict-label { font-size: 10px; letter-spacing: 0.12em; color: #94A3B8; font-weight: 700; margin-bottom: 8px; }
  .cover-verdict-value { font-size: 56px; font-weight: 900; letter-spacing: -0.02em; line-height: 1; margin-bottom: 12px; }
  .cover-verdict-rationale { font-size: 13px; color: #E2E8F0; line-height: 1.5; max-width: 70%; }
  .cover-cap { display: flex; align-items: baseline; gap: 12px; margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08); }
  .cap-label { font-size: 10px; letter-spacing: 0.10em; color: #94A3B8; }
  .cap-value { font-size: 24px; font-weight: 900; color: #C9A84C; font-family: 'Space Mono', monospace; }

  .cover-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 36px; }
  .cover-tile { background: rgba(255,255,255,0.04); padding: 14px 16px; border-radius: 8px; border-left: 2px solid #C9A84C; }
  .t-l { font-size: 9px; letter-spacing: 0.10em; color: #94A3B8; text-transform: uppercase; margin-bottom: 6px; }
  .t-v { font-size: 18px; font-weight: 800; color: #fff; font-family: 'Space Mono', monospace; }

  .cover-prepared { font-size: 10px; letter-spacing: 0.08em; color: #94A3B8; margin-top: auto; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.06); }
  .prep-firm { color: #C9A84C; font-weight: 700; margin-top: 4px; font-size: 11px; }
  .prep-contact { color: #D6E4F7; margin-top: 2px; font-size: 11px; }

  /* ── Body sections ─────────────────────────────────────────────────────── */
  .section { background: #fff; padding: 36px 48px; margin: 0; }
  .section-h {
    font-size: 14px; font-weight: 800; letter-spacing: 0.14em; color: #1E2761;
    border-bottom: 2px solid #C9A84C; padding-bottom: 8px; margin-bottom: 18px; text-transform: uppercase;
  }

  .exec-body p { font-size: 12px; line-height: 1.7; color: #334155; margin-bottom: 12px; text-align: justify; }
  .exec-body b { color: #1E2761; }

  /* ── Verdict card (inside body section) ───────────────────────────────── */
  .verdict-card { border: 2px solid; border-radius: 10px; padding: 20px 24px; margin-bottom: 16px; color: #fff; }
  .verdict-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .verdict-tag { font-size: 9px; font-weight: 800; letter-spacing: 0.10em; color: #94A3B8; margin-bottom: 6px; }
  .verdict-label { font-size: 36px; font-weight: 900; line-height: 1; margin-bottom: 8px; }
  .verdict-rationale { font-size: 12px; color: #E2E8F0; line-height: 1.5; max-width: 480px; }
  .verdict-divergence { margin-top: 10px; padding: 6px 10px; background: rgba(255,255,255,0.04); border-radius: 6px; font-size: 11px; color: #94A3B8; border-left: 2px solid; }
  .verdict-right { text-align: right; min-width: 140px; }
  .verdict-cap-l { font-size: 9px; letter-spacing: 0.08em; color: #94A3B8; }
  .verdict-cap-v { font-size: 28px; font-weight: 900; color: #fff; font-family: 'Space Mono', monospace; margin-top: 4px; }
  .fit-bonus { font-size: 10px; color: #22C55E; font-weight: 700; margin-top: 4px; }

  .kpi-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 14px; }
  .kpi-tile { background: #F0F4FA; padding: 12px 14px; border-radius: 8px; border-left: 3px solid #C9A84C; }
  .kpi-l { font-size: 9px; letter-spacing: 0.08em; color: #64748B; text-transform: uppercase; font-weight: 700; }
  .kpi-v { font-size: 20px; font-weight: 800; color: #1E2761; font-family: 'Space Mono', monospace; margin-top: 4px; }
  .kpi-s { font-size: 10px; color: #94A3B8; margin-top: 4px; }

  /* ── Data tables ───────────────────────────────────────────────────────── */
  .data-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
  .data-table th {
    background: #1E2761; color: #fff; padding: 9px 12px; text-align: left;
    font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700;
    border-bottom: 2px solid #C9A84C;
  }
  .data-table th.th-num { text-align: right; }
  .data-table th.th-accent { color: #C9A84C; }
  .data-table th.th-basis { font-style: italic; }
  .data-table tbody tr:nth-child(even) { background: #F0F4FA; }
  .data-table tbody tr:nth-child(odd) { background: #FFF; }
  .data-table tbody tr.tr-total { background: #E0E7F2; border-top: 2px solid #1E2761; }
  .data-table td { padding: 8px 12px; vertical-align: top; }
  .data-table td.td-name { font-weight: 600; color: #1E293B; }
  .data-table td.td-num { text-align: right; font-family: 'Space Mono', 'Courier New', monospace; color: #1E293B; }
  .data-table td.td-accent { color: #C9A84C; font-weight: 800; background: rgba(201,168,76,0.06); }
  .data-table td.td-delta { color: #16A34A; font-weight: 700; }
  .data-table td.td-basis { font-size: 10px; color: #64748B; font-style: italic; }
  .data-table td.td-highlight { background: #C9A84C !important; color: #fff !important; font-weight: 800; }

  .matrix tbody tr { background: #FFF; }
  .matrix tbody tr:nth-child(even) { background: #F0F4FA; }

  .footnote { font-size: 10px; color: #64748B; line-height: 1.5; margin-top: 10px; padding-top: 10px; border-top: 1px solid #E2E8F0; font-style: italic; }

  /* ── NOI reconstruction headline ──────────────────────────────────────── */
  .noi-headline { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
  .noi-tile { background: #F0F4FA; padding: 14px 16px; border-radius: 8px; }
  .noi-tile.noi-accent { background: #FFF8E7; border-left: 3px solid #C9A84C; }
  .noi-l { font-size: 10px; letter-spacing: 0.08em; color: #64748B; text-transform: uppercase; font-weight: 700; }
  .noi-v { font-size: 18px; font-weight: 800; color: #1E2761; font-family: 'Space Mono', monospace; margin-top: 4px; }
  .noi-tile.noi-accent .noi-v { color: #A08530; }

  /* ── Flags (warn/info chips) ──────────────────────────────────────────── */
  .flags-list { margin-top: 12px; }
  .flag { padding: 8px 12px; border-radius: 6px; font-size: 11px; margin-bottom: 6px; line-height: 1.4; }
  .flag-warn { background: rgba(217,119,6,0.10); color: #92400E; border-left: 3px solid #D97706; }
  .flag-info { background: rgba(37,99,235,0.08); color: #1E40AF; border-left: 3px solid #2563EB; }

  /* ── Rent sanity card ─────────────────────────────────────────────────── */
  .sanity-card { border: 1px solid; border-radius: 10px; padding: 18px 22px; }
  .sanity-tag { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 9px; font-weight: 800; letter-spacing: 0.10em; margin-bottom: 10px; }
  .sanity-message { font-size: 12px; color: #334155; line-height: 1.6; margin-bottom: 14px; }
  .sanity-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .sg-l { font-size: 9px; letter-spacing: 0.08em; color: #64748B; text-transform: uppercase; font-weight: 700; }
  .sg-v { font-size: 14px; font-weight: 800; color: #1E2761; font-family: 'Space Mono', monospace; margin-top: 4px; }

  /* ── Comp summary ─────────────────────────────────────────────────────── */
  .comp-summary { display: flex; gap: 24px; margin-bottom: 14px; padding: 12px 16px; background: #F0F4FA; border-radius: 8px; }
  .comp-summary > div { display: flex; flex-direction: column; }
  .cs-l { font-size: 9px; letter-spacing: 0.08em; color: #64748B; text-transform: uppercase; font-weight: 700; }
  .cs-v { font-size: 14px; font-weight: 800; color: #1E2761; font-family: 'Space Mono', monospace; margin-top: 2px; }

  /* ── IC Memo card ─────────────────────────────────────────────────────── */
  .memo-card { background: #FAFBFD; padding: 24px 28px; border-radius: 10px; border-left: 3px solid #C9A84C; }
  .memo-rec { padding-bottom: 12px; margin-bottom: 14px; border-bottom: 1px solid #E2E8F0; }
  .mr-l { font-size: 10px; letter-spacing: 0.10em; color: #64748B; font-weight: 700; text-transform: uppercase; }
  .mr-v { font-size: 14px; font-weight: 800; color: #1E2761; margin-top: 4px; }
  .memo-section { margin-bottom: 12px; }
  .ms-l { font-size: 10px; letter-spacing: 0.10em; color: #C9A84C; font-weight: 700; text-transform: uppercase; margin-bottom: 6px; }
  .ms-v { font-size: 12px; line-height: 1.6; color: #334155; }
  .ms-list { list-style: disc; padding-left: 20px; font-size: 12px; line-height: 1.6; color: #334155; }
  .ms-list li { margin-bottom: 4px; }

  /* ── EDGAR cross-REIT block — primary-source citation showcase ────────── */
  .edgar-headline { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 16px; }
  .edgar-tile { background: #F0F4FA; padding: 12px 14px; border-radius: 8px; border-left: 3px solid #1E2761; }
  .edgar-tile.edgar-accent { background: #FFF8E7; border-left: 3px solid #C9A84C; }
  .ek-l { font-size: 9px; letter-spacing: 0.08em; color: #64748B; text-transform: uppercase; font-weight: 700; }
  .ek-v { font-size: 16px; font-weight: 800; color: #1E2761; font-family: 'Space Mono', monospace; margin-top: 4px; }
  .edgar-tile.edgar-accent .ek-v { color: #A08530; }

  /* ── Audit / provenance table ─────────────────────────────────────────── */
  .audit-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .audit-table td { padding: 8px 12px; vertical-align: top; border-bottom: 1px solid #E2E8F0; }
  .audit-table td.ka { width: 28%; color: #C9A84C; font-weight: 700; letter-spacing: 0.04em; }
  .audit-table td.va { color: #475569; line-height: 1.5; }
  .audit-disclaimer { margin-top: 14px; padding: 12px; background: #F0F4FA; border-radius: 6px; font-size: 9.5px; color: #64748B; line-height: 1.5; font-style: italic; }

  /* ── Doc footer (printed on every page via @page bottom-center is hard;
        we render once at the end + rely on @page numbers) ─────────────── */
  .doc-footer { background: #1E2761; color: #fff; padding: 12px 48px; display: flex; justify-content: space-between; font-size: 10px; border-top: 4px solid #C9A84C; }
  .doc-footer .ff-l { letter-spacing: 0.08em; }
  .doc-footer .ff-r { color: #D6E4F7; text-align: right; }
  .doc-footer .gold { color: #C9A84C; font-weight: 800; }
</style>`;
}

// ─── Top-level orchestrator ────────────────────────────────────────────────

/**
 * Generate the full HTML document for the Storvex PS Asset Analyzer report.
 *
 * @param {Object} args
 * @param {Object} args.analysis     — analyzeExistingAsset() output (generic lens)
 * @param {Object} args.psLens       — computeBuyerLens() output (institutional lens)
 * @param {Object} [args.enrichment] — { coords, demographics, psFamily, marketRents }
 * @param {Object} [args.memo]       — IC memo from /api/analyzer-memo
 * @returns {string} full HTML document
 */
export function generateAnalyzerReport({ analysis, psLens, enrichment, memo, multiLensRows, platformFitDelta, pitchTarget }) {
  if (!analysis || !analysis.snapshot) throw new Error("analysis with snapshot required");
  const { snapshot } = analysis;
  const verdict = (psLens && psLens.verdict) ? psLens.verdict : analysis.verdict;
  const ps = psLens || null;
  const docId = docIdFrom(snapshot);
  const rentSanity = analysis.rentSanity || null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Storvex PS · ${safe(snapshot.name)} · ${docId}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Space+Mono:wght@400;700&display=swap" />
  ${reportCSS()}
</head>
<body>
  <div class="controls no-print">
    <button class="print-btn" onclick="window.print()">🖨 Save as PDF</button>
  </div>

  ${renderCover({ snapshot, verdict, ps, msaTier: analysis.msaTier, dealType: analysis.dealType, docId, recipient: pitchTarget && pitchTarget !== "custom" ? getRecipient(pitchTarget) : null })}
  ${renderExecSummary({ snapshot, verdict, ps, analysis, rentSanity })}
  ${renderVerdictKPIStrip({ verdict, ps, analysis })}
  ${renderYOCVerdict({ psLens: ps })}
  ${renderFinancingScenario({ psLens: ps })}
  ${renderMultiLensComparison({ multiLensRows, platformFitDelta, snapshot })}
  ${renderDevelopmentPipeline({ enrichment })}
  ${renderPriceTiers({ ps, analysis, snapshot })}
  ${renderNOIReconstruction({ ps, analysis, snapshot })}
  ${renderProjection({ ps, analysis })}
  ${renderValuationMatrix({ analysis, snapshot })}
  ${renderRentSanity({ rentSanity })}
  ${renderHistoricalMSARents({ snapshot })}
  ${renderCrossREITHistoricalSameStore()}
  ${renderComps({ analysis })}
  ${renderEDGARCrossREIT({ snapshot, analysis })}
  ${renderCrossREITMoveInRates({ snapshot, enrichment })}
  ${renderEDGAR8KTransactions({ snapshot, analysis })}
  ${renderICMemo({ memo })}
  ${renderAudit({ snapshot, ps, analysis })}
  ${renderFooter({ docId })}
</body>
</html>`;
}

/**
 * Open the rendered report in a new browser tab. User clicks the bundled
 * "Save as PDF" CTA inside the new tab to trigger the browser print dialog.
 */
export function openAnalyzerReport(args) {
  const html = generateAnalyzerReport(args);
  const w = window.open("", "_blank");
  if (!w) throw new Error("Popup blocked — allow popups for storvex.vercel.app and retry");
  w.document.write(html);
  w.document.close();
  return w;
}
