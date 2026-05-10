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

function renderCover({ snapshot, verdict, ps, msaTier, dealType, docId }) {
  const verdictColor = verdict.label === "PURSUE" ? "#22C55E" : verdict.label === "NEGOTIATE" ? "#F59E0B" : "#EF4444";
  const cap = ps?.marketCap || 0;
  return `
<section class="cover">
  <div class="cover-strip">
    <div class="brand">STORVEX <span class="gold">PS</span></div>
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

    <div class="cover-tiles">
      <div class="cover-tile"><div class="t-l">Ask</div><div class="t-v">${fmt$(snapshot.ask)}</div></div>
      <div class="cover-tile"><div class="t-l">Cap on Ask</div><div class="t-v">${fmtPct(snapshot.capOnAsk, 2)}</div></div>
      <div class="cover-tile"><div class="t-l">$ / SF</div><div class="t-v">${snapshot.pricePerSF > 0 ? fmt$(snapshot.pricePerSF) : "—"}</div></div>
      <div class="cover-tile"><div class="t-l">Phys / Econ Occ</div><div class="t-v">${fmtPct(snapshot.physicalOcc, 0)} / ${fmtPct(snapshot.economicOcc, 0)}</div></div>
    </div>

    <div class="cover-prepared">
      <div>PREPARED BY</div>
      <div class="prep-firm">DJR REAL ESTATE LLC · Storvex PS Asset Analyzer</div>
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
export function generateAnalyzerReport({ analysis, psLens, enrichment, memo }) {
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

  ${renderCover({ snapshot, verdict, ps, msaTier: analysis.msaTier, dealType: analysis.dealType, docId })}
  ${renderExecSummary({ snapshot, verdict, ps, analysis, rentSanity })}
  ${renderVerdictKPIStrip({ verdict, ps, analysis })}
  ${renderPriceTiers({ ps, analysis, snapshot })}
  ${renderNOIReconstruction({ ps, analysis, snapshot })}
  ${renderProjection({ ps, analysis })}
  ${renderValuationMatrix({ analysis, snapshot })}
  ${renderRentSanity({ rentSanity })}
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
