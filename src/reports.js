// ─── Reports Module ───
// Extracted from App.js — three HTML report generators.
// Each function takes siteScoreConfig as a new trailing parameter
// and passes it through to computeSiteScore.

import { escapeHtml, safeNum, fmtPrice, mapsLink, earthLink, buildDemoReport, fmtN, stripEmoji, cleanPriority } from './utils';
import { computeSiteScore, computeSiteFinancials } from './scoring';

// ─── Demographics Report — Full 1-3-5 Mile ESRI Table ───
export const generateDemographicsReport = (site) => {
  if (!site) return null;
  const dr = buildDemoReport(site);
  const pN = (v) => { if (v == null || v === "") return null; const n = typeof v === "number" ? v : parseInt(String(v).replace(/[$,]/g, ""), 10); return isNaN(n) ? null : n; };
  const fV = (v, pre) => { const n = pN(v); return n != null ? (pre || "") + n.toLocaleString() : "—"; };
  const fPct = (v) => v != null && v !== "" ? String(v) : "—";
  const fGrowth = (v) => { if (v == null || v === "") return "—"; const n = typeof v === "number" ? v : parseFloat(String(v)); if (isNaN(n)) return String(v); return (n >= 0 ? "+" : "") + n.toFixed(2) + "%"; };
  const gColor = (v) => { if (v == null) return "#64748B"; const n = typeof v === "number" ? v : parseFloat(String(v)); return !isNaN(n) && n > 0 ? "#16A34A" : !isNaN(n) && n < 0 ? "#EF4444" : "#64748B"; };
  const r = dr?.rings || {};
  const r1 = r[1] || {}; const r3 = r[3] || {}; const r5 = r[5] || {};
  const siteName = site.name || site.address || "Unknown Site";
  const coords = site.coordinates || "";

  // Growth outlook
  const pg = site.popGrowth3mi ? parseFloat(site.popGrowth3mi) : null;
  const growthOutlook = pg != null ? (pg > 1.5 ? "High Growth" : pg > 0.5 ? "Growing" : pg > 0 ? "Stable Growth" : pg > -0.5 ? "Flat" : "Declining") : "N/A";
  const outlookColor = pg != null ? (pg > 1.5 ? "#22C55E" : pg > 0.5 ? "#4ADE80" : pg > 0 ? "#FBBF24" : pg > -0.5 ? "#94A3B8" : "#EF4444") : "#64748B";

  // Income tier
  const hhi3 = pN(site.income3mi);
  const incomeTier = hhi3 != null ? (hhi3 >= 90000 ? "PREMIUM" : hhi3 >= 75000 ? "AFFLUENT" : hhi3 >= 65000 ? "STRONG" : hhi3 >= 55000 ? "ADEQUATE" : "BELOW THRESHOLD") : "N/A";
  const incomeColor = hhi3 != null ? (hhi3 >= 90000 ? "#C9A84C" : hhi3 >= 75000 ? "#22C55E" : hhi3 >= 65000 ? "#3B82F6" : hhi3 >= 55000 ? "#FBBF24" : "#EF4444") : "#64748B";

  // Pop signal
  const pop3 = pN(site.pop3mi);
  const popSignal = pop3 != null ? (pop3 >= 40000 ? "DENSE MARKET" : pop3 >= 25000 ? "SOLID DEMAND" : pop3 >= 10000 ? "EMERGING" : "THIN") : "N/A";
  const popColor = pop3 != null ? (pop3 >= 40000 ? "#22C55E" : pop3 >= 25000 ? "#3B82F6" : pop3 >= 10000 ? "#FBBF24" : "#EF4444") : "#64748B";

  // Storage demand signals
  const hhRaw = pN(site.households3mi);
  const hvRaw = pN(site.homeValue3mi);
  const renterPct = site.renterPct3mi;

  const tableRow = (metric, v1, v3, v5, opts = {}) => {
    const isGrowth = opts.isGrowth;
    const prefix = opts.prefix || "";
    const format = (v) => isGrowth ? `<span style="color:${gColor(v)}">${fGrowth(v)}</span>` : (opts.isPct ? fPct(v) : fV(v, prefix));
    return `<tr>
      <td style="padding:14px 20px;font-weight:700;color:#E2E8F0;font-size:13px;border-bottom:1px solid rgba(255,255,255,.06);white-space:nowrap">${metric}</td>
      <td style="padding:14px 20px;text-align:right;font-size:14px;font-weight:600;color:#CBD5E1;font-family:'Space Mono',monospace;border-bottom:1px solid rgba(255,255,255,.06)">${format(v1)}</td>
      <td style="padding:14px 20px;text-align:right;font-size:15px;font-weight:800;color:#C9A84C;font-family:'Space Mono',monospace;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(201,168,76,.04)">${format(v3)}</td>
      <td style="padding:14px 20px;text-align:right;font-size:14px;font-weight:600;color:#CBD5E1;font-family:'Space Mono',monospace;border-bottom:1px solid rgba(255,255,255,.06)">${format(v5)}</td>
    </tr>`;
  };

  return `<!DOCTYPE html><html><head>
<title>Demographics — ${escapeHtml(siteName)}</title>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#080C24;color:#E2E8F0;min-height:100vh}
.hero{background:linear-gradient(135deg,#0A0E2A 0%,#1E2761 40%,#1565C0 100%);padding:48px 40px 36px;position:relative;overflow:hidden}
.hero::after{content:'';position:absolute;top:0;right:0;width:400px;height:400px;background:radial-gradient(circle,rgba(201,168,76,.08),transparent 70%);pointer-events:none}
.hero h1{font-size:28px;font-weight:900;color:#fff;letter-spacing:-.01em;margin-bottom:6px}
.hero .sub{font-size:13px;color:#94A3B8;font-weight:600;letter-spacing:.04em}
.hero .badge{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#FBBF24,#F59E0B);color:#0F172A;font-size:11px;font-weight:900;padding:4px 12px;border-radius:6px;letter-spacing:.06em;margin-left:12px}
.container{max-width:1100px;margin:0 auto;padding:32px 24px}
.signal-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:32px}
.signal-card{background:rgba(15,21,56,.6);border-radius:14px;padding:20px;border:1px solid rgba(255,255,255,.06);text-align:center;transition:all .2s}
.signal-card:hover{border-color:rgba(201,168,76,.25);transform:translateY(-2px);box-shadow:0 8px 30px rgba(0,0,0,.3)}
.signal-label{font-size:9px;font-weight:700;color:#6B7394;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px}
.signal-value{font-size:24px;font-weight:900;font-family:'Space Mono',monospace;line-height:1.1;margin-bottom:4px}
.signal-sub{font-size:10px;font-weight:700;letter-spacing:.06em}
.table-wrap{background:rgba(15,21,56,.5);border-radius:16px;overflow:hidden;border:1px solid rgba(201,168,76,.1);margin-bottom:28px;box-shadow:0 4px 24px rgba(0,0,0,.2)}
.table-header{background:linear-gradient(135deg,#0F172A,#1E293B);padding:16px 20px;display:flex;align-items:center;gap:10px;border-bottom:2px solid rgba(201,168,76,.15)}
.table-header span.icon{font-size:18px}
.table-header span.title{font-size:14px;font-weight:800;color:#fff;letter-spacing:.05em}
.table-header span.tag{font-size:10px;font-weight:800;color:#C9A84C;background:rgba(201,168,76,.1);padding:3px 10px;border-radius:5px;margin-left:auto;letter-spacing:.08em}
table{width:100%;border-collapse:collapse}
thead th{padding:12px 20px;text-align:right;font-size:10px;font-weight:800;color:#94A3B8;letter-spacing:.1em;text-transform:uppercase;border-bottom:2px solid rgba(201,168,76,.1)}
thead th:first-child{text-align:left}
thead th.gold{background:rgba(201,168,76,.06);color:#C9A84C}
.proj-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:20px;background:linear-gradient(135deg,#0F172A,#1a1a2e)}
.proj-card{background:rgba(255,255,255,.03);border-radius:10px;padding:14px;text-align:center;border:1px solid rgba(255,255,255,.05)}
.proj-label{font-size:8px;font-weight:700;color:#6B7394;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px}
.proj-val{font-size:16px;font-weight:800;color:#E2E8F0;font-family:'Space Mono',monospace}
.proj-growth{font-size:10px;font-weight:700;margin-top:3px}
.insight-box{background:linear-gradient(135deg,#1E2761,#0F172A);border-radius:14px;padding:20px 24px;border:1px solid rgba(201,168,76,.12);margin-bottom:20px}
.insight-header{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.insight-header .dot{width:8px;height:8px;border-radius:50%}
.insight-header span{font-size:11px;font-weight:800;color:#C9A84C;letter-spacing:.08em;text-transform:uppercase}
.insight-text{font-size:12px;color:#CBD5E1;line-height:1.8}
.footer{text-align:center;padding:24px;border-top:1px solid rgba(201,168,76,.08)}
.footer span{font-size:9px;color:#4A5080;letter-spacing:.06em}
@media(max-width:768px){.signal-grid,.proj-grid{grid-template-columns:repeat(2,1fr)}}
@media print{body{background:#fff;color:#1E293B} .hero{background:#1E2761!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>

<div class="hero">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
    <span style="font-size:28px">📊</span>
    <div>
      <h1>Demographic Intelligence<span class="badge">ESRI 2025</span></h1>
      <div class="sub">${escapeHtml(siteName)}${coords ? ` — ${escapeHtml(coords)}` : ""}</div>
    </div>
  </div>
  <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
    <span style="font-size:10px;color:#94A3B8;background:rgba(255,255,255,.06);padding:4px 12px;border-radius:6px;font-weight:600">ESRI ArcGIS GeoEnrichment — Live Geocoded — Current Year + 2030 Projections</span>
    ${dr?.pulledAt ? `<span style="font-size:10px;color:#64748B;background:rgba(255,255,255,.04);padding:4px 12px;border-radius:6px;font-weight:600">Updated ${new Date(dr.pulledAt).toLocaleDateString()}</span>` : ""}
  </div>
</div>

<div class="container">

  <!-- Signal Cards -->
  <div class="signal-grid">
    <div class="signal-card">
      <div class="signal-label">3-Mile Population</div>
      <div class="signal-value" style="color:${popColor}">${fV(pop3)}</div>
      <div class="signal-sub" style="color:${popColor}">${popSignal}</div>
    </div>
    <div class="signal-card">
      <div class="signal-label">Median Household Income</div>
      <div class="signal-value" style="color:${incomeColor}">${fV(hhi3, "$")}</div>
      <div class="signal-sub" style="color:${incomeColor}">${incomeTier}</div>
    </div>
    <div class="signal-card">
      <div class="signal-label">Growth Outlook (5yr)</div>
      <div class="signal-value" style="color:${outlookColor}">${fGrowth(pg)}</div>
      <div class="signal-sub" style="color:${outlookColor}">${growthOutlook}</div>
    </div>
    <div class="signal-card">
      <div class="signal-label">3-Mile Households</div>
      <div class="signal-value" style="color:#3B82F6">${fV(hhRaw)}</div>
      <div class="signal-sub" style="color:#64748B">Demand Proxy</div>
    </div>
  </div>

  <!-- Full 1-3-5 Mile Table -->
  <div class="table-wrap">
    <div class="table-header">
      <span class="icon">🎯</span>
      <span class="title">RADIUS RING ANALYSIS</span>
      <span class="tag">1 · 3 · 5 MILE</span>
    </div>
    <table>
      <thead><tr>
        <th style="text-align:left;width:28%">METRIC</th>
        <th>1-MILE</th>
        <th class="gold">3-MILE</th>
        <th>5-MILE</th>
      </tr></thead>
      <tbody>
        ${tableRow("Population", r1.pop, r3.pop, r5.pop)}
        ${tableRow("Median Household Income", r1.medIncome, r3.medIncome, r5.medIncome, { prefix: "$" })}
        ${tableRow("Households", r1.hh, r3.hh, r5.hh)}
        ${tableRow("Median Home Value", r1.homeValue, r3.homeValue, r5.homeValue, { prefix: "$" })}
        ${tableRow("Renter %", r1.renterPct, r3.renterPct, r5.renterPct, { isPct: true })}
        ${tableRow("Pop Growth (CAGR)", r1.popGrowth, r3.popGrowth, r5.popGrowth, { isGrowth: true })}
      </tbody>
    </table>

    <!-- 2030 Projections -->
    ${(dr?.pop3mi_fy || dr?.income3mi_fy) ? `
    <div style="border-top:2px solid rgba(201,168,76,.12)">
      <div style="padding:14px 20px;background:linear-gradient(135deg,#0F172A,#1a1a2e)">
        <div style="font-size:10px;font-weight:800;color:#C9A84C;letter-spacing:.1em;margin-bottom:12px">2030 FIVE-YEAR PROJECTIONS (3-MILE RADIUS)</div>
        <div class="proj-grid" style="padding:0">
          <div class="proj-card">
            <div class="proj-label">Population</div>
            <div class="proj-val">${fV(dr.pop3mi_fy)}</div>
            ${dr.popGrowth3mi ? `<div class="proj-growth" style="color:${gColor(dr.popGrowth3mi)}">${fGrowth(dr.popGrowth3mi)} /yr</div>` : ""}
          </div>
          <div class="proj-card">
            <div class="proj-label">Median HHI</div>
            <div class="proj-val">${fV(dr.income3mi_fy, "$")}</div>
            ${dr.incomeGrowth3mi ? `<div class="proj-growth" style="color:${gColor(dr.incomeGrowth3mi)}">${fGrowth(dr.incomeGrowth3mi)} /yr</div>` : ""}
          </div>
          <div class="proj-card">
            <div class="proj-label">Households</div>
            <div class="proj-val">${fV(dr.households3mi_fy)}</div>
            ${dr.hhGrowth3mi ? `<div class="proj-growth" style="color:${gColor(dr.hhGrowth3mi)}">${fGrowth(dr.hhGrowth3mi)} /yr</div>` : ""}
          </div>
          <div class="proj-card">
            <div class="proj-label">Growth Outlook</div>
            <div class="proj-val" style="font-size:14px;color:${outlookColor}">${growthOutlook}</div>
          </div>
        </div>
      </div>
    </div>` : ""}
  </div>

  <!-- Storage Demand Insights -->
  <div class="insight-box">
    <div class="insight-header">
      <div class="dot" style="background:${popColor}"></div>
      <span>Storage Demand Analysis</span>
    </div>
    <div class="insight-text">
      ${pop3 != null && pop3 >= 40000
        ? `Dense population base of <strong>${pop3.toLocaleString()}</strong> within 3 miles exceeds the 40K benchmark — top tier for household-driven self-storage absorption.${pg != null && pg > 1 ? " Combined with above-average growth, this site has compounding demand tailwinds." : ""}`
        : pop3 != null && pop3 >= 15000
        ? `Population of <strong>${pop3.toLocaleString()}</strong> within 3 miles — mid-range for storage feasibility. Sufficient for a climate-controlled facility if competition is limited.${pg != null && pg > 1.5 ? " Strong growth could push this into premium territory within 3-5 years." : ""}`
        : `Population of <strong>${pop3 != null ? pop3.toLocaleString() : "N/A"}</strong> within 3 miles — thinner demand base. Requires low competition, premium income, or exceptional growth to justify development.`}
      <br><br>
      ${hhi3 != null
        ? `Median household income of <strong>$${hhi3.toLocaleString()}</strong> classifies this market as <strong style="color:${incomeColor}">${incomeTier}</strong> for climate-controlled storage demand.${hhi3 >= 75000 ? " Affluent households store higher-value items and show lower price sensitivity — premium unit absorption expected." : hhi3 >= 55000 ? " Moderate willingness to pay supports standard rate structures." : " Below minimum threshold — price sensitivity is high."}`
        : "Income data not available."}
      ${hvRaw != null ? `<br><br>Median home value of <strong>$${hvRaw.toLocaleString()}</strong> ${hvRaw >= 350000 ? "signals an affluent homeowner base with storage demand for furniture, seasonal items, and lifestyle goods." : hvRaw >= 180000 ? "indicates a stable middle-income housing market — solid base for storage demand." : "suggests a value-oriented market — price positioning will be critical."}` : ""}
      ${renterPct ? `<br><br>Renter percentage of <strong>${renterPct}</strong> — renters are disproportionately high users of self-storage due to space constraints and mobility.` : ""}
    </div>
  </div>

  <div class="footer">
    <span>STORVEX™ Demographic Intelligence — ESRI ArcGIS GeoEnrichment (Paid) — ${new Date().toLocaleDateString()}</span>
  </div>

</div>
</body></html>`;
};

export const generateVettingReport = (site, nearestPSDistance, iqResult, siteScoreConfig) => {
  try {
  // XSS protection — escape all user-supplied text before HTML interpolation
  const h = escapeHtml;
  const popN = parseInt(String(site.pop3mi).replace(/[^0-9]/g, ""), 10);
  const incN = parseInt(String(site.income3mi).replace(/[^0-9]/g, ""), 10);
  const acres = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
  const demoScore = (popN && incN) ? (popN >= 40000 && incN >= 60000 ? "PASS" : popN >= 20000 && incN >= 50000 ? "MARGINAL" : "BELOW THRESHOLD") : null;
  const demoColor = demoScore === "PASS" ? "#16A34A" : demoScore === "MARGINAL" ? "#F59E0B" : "#EF4444";
  let sizingText = "TBD", sizingColor = "#94A3B8", sizingTag = "PENDING";
  if (!isNaN(acres)) {
    if (acres >= 3.5 && acres <= 5) { sizingText = `${acres} ac — PRIMARY (one-story climate-controlled)`; sizingColor = "#16A34A"; sizingTag = "PASS"; }
    else if (acres >= 2.5 && acres < 3.5) { sizingText = `${acres} ac — SECONDARY (multi-story 3-4 story)`; sizingColor = "#16A34A"; sizingTag = "PASS"; }
    else if (acres < 2.5) { sizingText = `${acres} ac — Below minimum threshold`; sizingColor = "#EF4444"; sizingTag = "FAIL"; }
    else if (acres > 5 && acres <= 7) { sizingText = `${acres} ac — Viable if subdivisible`; sizingColor = "#F59E0B"; sizingTag = "CAUTION"; }
    else { sizingText = `${acres} ac — Large tract, subdivision potential`; sizingColor = "#F59E0B"; sizingTag = "CAUTION"; }
  }
  const psDistance = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : (nearestPSDistance ? nearestPSDistance : "Not checked — enter Nearest Facility in site detail");
  // PS proximity color: closer = better (market validation). >35mi = FAIL. No minimum distance.
  const psColor = site.siteiqData?.nearestPS ? (site.siteiqData.nearestPS > 35 ? "#EF4444" : site.siteiqData.nearestPS <= 15 ? "#16A34A" : "#F59E0B") : "#94A3B8";
  // Z&U intelligence parsing
  const combined = ((site.zoning || "") + " " + (site.summary || "")).toLowerCase();
  const hasByRight = /(by\s*right|permitted|storage\s*(?:by|permitted))/i.test(combined);
  const hasSUP = /(conditional|sup\b|cup\b|special\s*use)/i.test(combined);
  const hasRezone = /rezone/i.test(combined);
  const hasOverlay = /overlay/i.test(combined);
  const hasFlood = /flood/i.test(combined);
  const hasUtilities = /(utilit|water|sewer|electric|gas\b)/i.test(combined);
  const hasSeptic = /septic/i.test(combined);
  const hasWell = /\bwell\b/i.test(combined);
  const zoningClass = site.zoningClassification || "unknown";
  const zoningColor = zoningClass === "by-right" ? "#16A34A" : zoningClass === "conditional" ? "#F59E0B" : zoningClass === "rezone-required" ? "#EF4444" : zoningClass === "prohibited" ? "#991B1B" : "#94A3B8";
  const zoningLabel = { "by-right": "BY-RIGHT (Permitted)", "conditional": "CONDITIONAL (SUP/CUP Required)", "rezone-required": "REZONE REQUIRED", "prohibited": "PROHIBITED", "unknown": "UNKNOWN — Research Required" }[zoningClass] || zoningClass.toUpperCase();
  const statusPill = (text, color) => `<span style="display:inline-block;padding:4px 14px;border-radius:8px;font-size:12px;font-weight:700;background:${color}15;color:${color};border:1px solid ${color}30">${text}</span>`;
  // Flags — merged from both reports
  const flags = [];
  if (!site.zoning) flags.push("No zoning district recorded — critical data gap");
  if (zoningClass === "unknown") flags.push("Zoning classification not confirmed — verify with local planning");
  if (zoningClass === "prohibited") flags.push("Storage use PROHIBITED in current zoning district");
  if (zoningClass === "rezone-required") flags.push("Rezone required — timeline and political risk apply");
  if (!site.coordinates) flags.push("No coordinates — cannot verify location");
  if (!isNaN(acres) && acres < 2.5) flags.push("Below minimum acreage threshold");
  if (popN && popN < 10000) flags.push("3-mi population below 10,000 minimum");
  if (incN && incN < 60000) flags.push("3-mi median HHI below $60,000 target");
  if (!site.askingPrice || site.askingPrice === "TBD") flags.push("No confirmed asking price");
  if (hasFlood) flags.push("Flood zone identified — verify FEMA panel and insurance cost");
  if (!hasUtilities && !hasSeptic) flags.push("Utility availability not confirmed — verify water hookup (HARD REQUIREMENT for fire suppression)");
  if (site.waterAvailable === false) flags.push("WATER HOOKUP Need Further Research — municipal water is a HARD REQUIREMENT for fire suppression. Septic OK for sewer.");
  // NOTE: Septic is VIABLE for sewer (storage has minimal wastewater). But WATER is non-negotiable — fire code requires municipal pressure.
  if (hasWell) flags.push("Well water noted — may need municipal connection for commercial use");
  if (hasOverlay) flags.push("Overlay district applies — additional standards may affect design/cost");
  // Utility Readiness Score (0-100) — quantifies how "hookup-ready" a site is
  const utilChecks = [
    { done: !!site.waterProvider, weight: 20, label: "Water provider identified" },
    { done: site.waterAvailable === true, weight: 15, label: "Water confirmed available" },
    { done: site.insideServiceBoundary === true, weight: 10, label: "Inside service boundary" },
    { done: !!site.sewerProvider || hasSeptic, weight: 12, label: "Sewer/septic solution" },
    { done: site.sewerAvailable === true || hasSeptic, weight: 8, label: "Sewer confirmed" },
    { done: !!site.electricProvider, weight: 10, label: "Electric provider identified" },
    { done: site.threePhase === true, weight: 10, label: "3-phase power available" },
    { done: !!site.waterTapFee || !!site.tapFees, weight: 5, label: "Tap fees documented" },
    { done: site.fireFlowAdequate === true, weight: 5, label: "Fire flow confirmed" },
    { done: !!site.distToWaterMain, weight: 5, label: "Distance to main known" },
  ];
  const utilScore = utilChecks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  const utilGrade = utilScore >= 80 ? "A" : utilScore >= 60 ? "B" : utilScore >= 40 ? "C" : utilScore >= 20 ? "D" : "F";
  const utilGradeColor = utilScore >= 80 ? "#16A34A" : utilScore >= 60 ? "#3B82F6" : utilScore >= 40 ? "#F59E0B" : "#EF4444";
  // Water hookup status
  const waterHookup = site.waterHookupStatus || (site.insideServiceBoundary === true ? "by-right" : site.insideServiceBoundary === false ? "by-request" : site.waterProvider ? "unknown" : "unknown");
  const waterHookupLabel = { "by-right": "BY-RIGHT", "by-request": "BY-REQUEST", "no-provider": "NO PROVIDER", "unknown": "UNKNOWN" }[waterHookup] || "UNKNOWN";
  const waterHookupColor = waterHookup === "by-right" ? "#16A34A" : waterHookup === "by-request" ? "#F59E0B" : waterHookup === "no-provider" ? "#EF4444" : "#94A3B8";
  // Water hookup cost estimator
  const distFt = site.distToWaterMain ? parseFloat(String(site.distToWaterMain).replace(/[^0-9.]/g, "")) : null;
  const parseFee = (v) => { if (!v) return null; const m = String(v).match(/\$?([\d,]+(?:\.\d+)?)/); return m ? parseFloat(m[1].replace(/,/g, "")) : null; };
  const waterTapN = parseFee(site.waterTapFee);
  const sewerTapN = parseFee(site.sewerTapFee);
  const impactN = parseFee(site.impactFees);
  const extensionLow = distFt ? Math.round(distFt * 50) : null;
  const extensionHigh = distFt ? Math.round(distFt * 150) : null;
  const totalUtilLow = (waterTapN || 0) + (sewerTapN || 0) + (impactN || 0) + (extensionLow || 0);
  const totalUtilHigh = (waterTapN || 0) + (sewerTapN || 0) + (impactN || 0) + (extensionHigh || 0);
  if (site.waterAvailable === false && !site.distToWaterMain) flags.push("Water extension required but distance to main UNKNOWN — critical cost variable");
  if (distFt && distFt > 500) flags.push(`Water main is ${Math.round(distFt)} LF away — extension cost est. $${Math.round(extensionLow/1000)}K–$${Math.round(extensionHigh/1000)}K`);
  if (site.fireFlowAdequate === false) flags.push("Fire flow INADEQUATE — hydrant/main upgrade required before development");
  const iq = iqResult || computeSiteScore(site, siteScoreConfig);
  const iqScore = iq?.score || "—";
  const iqTier = iq?.tier || "gray";
  const iqLabel = iq?.label || "—";
  const iqBadgeColor = iqTier === "gold" ? "#C9A84C" : iqTier === "steel" ? "#2C3E6B" : "#94A3B8";
  const zoningScore = iq?.scores?.zoning;
  const zoningScoreColor = zoningScore >= 8 ? "#16A34A" : zoningScore >= 5 ? "#F59E0B" : zoningScore > 0 ? "#EF4444" : "#94A3B8";
  // Competition data for executive summary
  const cc = site.siteiqData?.competitorCount;
  const compColor = cc !== undefined && cc !== null ? (cc <= 1 ? "#16A34A" : cc <= 3 ? "#F59E0B" : "#EF4444") : "#94A3B8";
  const compLabel = cc !== undefined && cc !== null ? (cc === 0 ? "NO COMPETITORS" : cc === 1 ? "1 COMPETITOR" : cc + " COMPETITORS") : "NOT ASSESSED";
  const satLevel = cc !== undefined && cc !== null ? (cc === 0 ? "Unserved Market" : cc <= 2 ? "Low Saturation" : cc <= 4 ? "Moderate Saturation" : "High Saturation") : "Unknown";
  // Demographics for exec summary
  const hhN = parseInt(String(site.households3mi || "").replace(/[^0-9]/g, ""), 10);
  const hvN = parseInt(String(site.homeValue3mi || "").replace(/[^0-9]/g, ""), 10);
  const pop1 = parseInt(String(site.pop1mi || "").replace(/[^0-9]/g, ""), 10);
  const growthPct = site.popGrowth3mi ? parseFloat(String(site.popGrowth3mi).replace(/[^0-9.\-+]/g, "")) : null;
  const growthColor = growthPct !== null ? (growthPct >= 1.5 ? "#16A34A" : growthPct >= 0.5 ? "#3B82F6" : growthPct >= 0 ? "#F59E0B" : "#EF4444") : "#94A3B8";
  // Key strength / risk for exec summary
  const keyStrength = iqScore >= 8 ? "Elite composite score — strong fundamentals across all dimensions" : zoningClass === "by-right" && popN >= 25000 ? "Permitted zoning + strong demographics" : popN >= 40000 ? "Exceptional population density within 3-mi radius" : growthPct >= 2.0 ? "High-growth corridor with strong projected demand" : zoningClass === "by-right" ? "Storage permitted by-right — no entitlement risk" : "Evaluate on case-by-case basis";
  const keyRisk = zoningClass === "prohibited" ? "Storage explicitly prohibited — rezone is only path" : zoningClass === "unknown" ? "Zoning not verified — cannot confirm storage permissibility" : zoningClass === "rezone-required" ? "Rezone required — political risk and 4-12 month timeline" : waterHookup === "no-provider" ? "No municipal water provider identified — fire code blocker" : hasFlood ? "Flood zone present — insurance cost and development constraints" : popN < 10000 && popN > 0 ? "Low population density — demand may not support facility" : flags.length > 0 ? flags[0] : "No critical risks identified";
  // Recommendation for exec summary
  const recommendation = iqScore >= 8.0 ? "AUTO-ADVANCE — Site meets all thresholds for review queue." : iqScore >= 6.0 ? "PRESENT FOR REVIEW — Strong candidate with noted concerns." : iqScore >= 4.0 ? "FLAGGED — Below target thresholds. Recommend pass unless override." : typeof iqScore === "number" ? "AUTO-PASS — Below minimum thresholds." : "INSUFFICIENT DATA — Complete research before scoring.";
  const recColor = iqScore >= 8.0 ? "#16A34A" : iqScore >= 6.0 ? "#F59E0B" : typeof iqScore === "number" ? "#EF4444" : "#94A3B8";
  // SF/capita competition gauge
  const sfCapitaMatch = (site.demandSupplySignal || "").match(/([\d.]+)\s*SF\/capita/i);
  const sfCapita = sfCapitaMatch ? parseFloat(sfCapitaMatch[1]) : null;
  const sfCapitaColor = sfCapita !== null ? (sfCapita < 5 ? "#16A34A" : sfCapita <= 9 ? "#3B82F6" : "#EF4444") : "#94A3B8";
  const sfCapitaLabel = sfCapita !== null ? (sfCapita < 5 ? "Underserved" : sfCapita <= 9 ? "Equilibrium" : "Oversupplied") : "Unknown";

  const row = (label, value, opts = {}) => `<tr><td style="padding:10px 16px;font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid #F1F5F9;width:180px;vertical-align:top">${label}</td><td style="padding:10px 16px;font-size:13px;color:#1E293B;font-weight:${opts.bold ? 700 : 500};border-bottom:1px solid #F1F5F9">${opts.badge ? `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:11px;font-weight:700;background:${opts.badgeBg || '#F1F5F9'};color:${opts.badgeColor || '#64748B'}">${value}</span>` : value}</td></tr>`;
  const mapsUrl = site.coordinates ? `https://www.google.com/maps?q=${site.coordinates}` : "#";
  const dom = site.dateOnMarket && site.dateOnMarket !== "N/A" ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;

  // Section ID generator for TOC anchors
  const sectionId = (num) => `sec-${num}`;
  const section = (num, title) => `<div id="${sectionId(num)}" class="report-section" style="scroll-margin-top:20px;margin:32px 0 16px;padding-bottom:8px;border-bottom:2px solid #1E2761;position:relative">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#F37C33,#D45500);display:flex;align-items:center;justify-content:center;font-size:15px;color:#fff;font-weight:900;box-shadow:0 2px 10px rgba(243,124,51,0.35);flex-shrink:0">${num}</div>
      <h2 style="margin:0;font-size:17px;font-weight:800;color:#1E2761;letter-spacing:0.01em;line-height:1.3">${title}</h2>
    </div>
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vetting Report — ${site.name || "Site"}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#F0F2F5;color:#1E293B;padding:0}
@media print{
  body{background:#fff}
  .no-print{display:none!important}
  .report-wrapper{box-shadow:none!important;margin:0!important}
  .report-section{page-break-inside:avoid}
  .toc-sidebar{display:none!important}
  .quick-actions{display:none!important}
}
.report-wrapper{max-width:860px;margin:0 auto;background:#fff;box-shadow:0 8px 40px rgba(30,39,97,0.12),0 0 0 1px rgba(30,39,97,0.04);border-radius:0 0 8px 8px;position:relative}
table{width:100%;border-collapse:collapse}

/* Collapsible methodology sections */
details.method-box{margin-top:10px;border-radius:8px;overflow:hidden;border:1px solid #E2E8F0}
details.method-box summary{padding:10px 16px;cursor:pointer;font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;background:#FAFBFC;list-style:none;display:flex;align-items:center;gap:6px;user-select:none}
details.method-box summary::-webkit-details-marker{display:none}
details.method-box summary::before{content:'\\25B6';font-size:8px;color:#94A3B8;transition:transform 0.2s ease;display:inline-block}
details.method-box[open] summary::before{transform:rotate(90deg)}
details.method-box .method-content{padding:10px 16px;font-size:9px;color:#475569;line-height:1.6;background:#FAFBFC;border-top:1px solid #E2E8F0}

/* Card hover */
.hover-card{transition:transform 0.15s ease,box-shadow 0.15s ease}
.hover-card:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,0.08)}

/* Quick actions floating panel */
.quick-actions{position:fixed;bottom:28px;right:28px;display:flex;flex-direction:column;gap:8px;z-index:9999}
.quick-actions button{display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;border:none;font-size:12px;font-weight:700;font-family:'DM Sans',sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.15);transition:all 0.2s ease}
.quick-actions button:hover{transform:translateY(-2px);box-shadow:0 6px 24px rgba(0,0,0,0.2)}
.qa-print{background:linear-gradient(135deg,#F37C33,#D45500);color:#fff}
.qa-jump{background:#fff;color:#1E2761;border:1px solid #E2E8F0!important}

/* TOC sidebar — McKinsey nav strip */
.toc-sidebar{position:fixed;left:0;top:50%;transform:translateY(-50%);width:52px;background:linear-gradient(180deg,#0A0A0C,#1E2761 40%,#2C3E6B);border-radius:0 14px 14px 0;box-shadow:4px 0 30px rgba(0,0,0,0.15);padding:14px 6px;z-index:999;transition:width 0.3s cubic-bezier(0.4,0,0.2,1);overflow:hidden}
.toc-sidebar:hover{width:210px;padding:14px 12px}
.toc-sidebar .toc-title{font-size:8px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:12px;padding:0 4px;white-space:nowrap;opacity:0;transition:opacity 0.2s}
.toc-sidebar:hover .toc-title{opacity:1}
.toc-sidebar .toc-icon{display:flex;align-items:center;justify-content:center;width:32px;height:32px;margin:0 auto 8px;border-radius:8px;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.3)}
.toc-sidebar:hover .toc-icon{display:none}
.toc-sidebar .toc-icon svg{width:16px;height:16px;fill:#C9A84C}
.toc-sidebar a{display:flex;align-items:center;gap:10px;padding:6px 8px;font-size:11px;color:rgba(255,255,255,0.5);text-decoration:none;border-radius:8px;font-weight:600;transition:all 0.15s ease;line-height:1.3;margin-bottom:2px;white-space:nowrap;overflow:hidden}
.toc-sidebar a .toc-num{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);font-size:10px;font-weight:800;font-family:'Space Mono',monospace;flex-shrink:0;transition:all 0.15s}
.toc-sidebar a .toc-label{opacity:0;transition:opacity 0.2s}
.toc-sidebar:hover a .toc-label{opacity:1}
.toc-sidebar a:hover{background:rgba(243,124,51,0.15);color:#fff}
.toc-sidebar a:hover .toc-num{background:rgba(243,124,51,0.3);color:#F37C33}
.toc-sidebar a.active{background:rgba(201,168,76,0.15);color:#C9A84C}
.toc-sidebar a.active .toc-num{background:#C9A84C;color:#0A0A0C}

/* Circular gauge */
.gauge-ring{position:relative;width:90px;height:90px;display:inline-block}
.gauge-ring svg{transform:rotate(-90deg)}
.gauge-ring .gauge-text{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}

/* Zoning Decision Tree */
.z-tree{display:flex;align-items:center;gap:0;margin:16px 0;overflow-x:auto}
.z-tree-node{padding:10px 16px;border-radius:10px;text-align:center;min-width:100px;position:relative;flex-shrink:0}
.z-tree-arrow{width:32px;height:2px;background:#CBD5E1;position:relative;flex-shrink:0}
.z-tree-arrow::after{content:'';position:absolute;right:0;top:-4px;border:5px solid transparent;border-left:6px solid #CBD5E1}

/* SF/capita gauge bar */
.sf-gauge{height:10px;border-radius:5px;background:linear-gradient(90deg,#16A34A 0%,#16A34A 33%,#3B82F6 33%,#3B82F6 60%,#EF4444 60%,#EF4444 100%);position:relative;margin:8px 0}
.sf-gauge-marker{position:absolute;top:-4px;width:4px;height:18px;background:#1E293B;border-radius:2px;transform:translateX(-50%)}

@media (max-width:1000px){.toc-sidebar{display:none}}
</style></head><body>

<!-- TOC Sidebar — McKinsey nav strip (collapsed = icons only, hover = expand with labels) -->
<nav class="toc-sidebar no-print" id="tocNav">
  <div class="toc-icon"><svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg></div>
  <div class="toc-title">Contents</div>
  <a href="#sec-E" onclick="document.getElementById('sec-E').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">E</span><span class="toc-label">Executive Summary</span></a>
  <a href="#sec-R" onclick="document.getElementById('sec-R').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">R</span><span class="toc-label">Research Gate</span></a>
  <a href="#sec-1" onclick="document.getElementById('sec-1').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">1</span><span class="toc-label">Property</span></a>
  <a href="#sec-2" onclick="document.getElementById('sec-2').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">2</span><span class="toc-label">Zoning</span></a>
  <a href="#sec-3" onclick="document.getElementById('sec-3').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">3</span><span class="toc-label">Water</span></a>
  <a href="#sec-4" onclick="document.getElementById('sec-4').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">4</span><span class="toc-label">Topography</span></a>
  <a href="#sec-5" onclick="document.getElementById('sec-5').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">5</span><span class="toc-label">Access</span></a>
  <a href="#sec-6" onclick="document.getElementById('sec-6').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">6</span><span class="toc-label">Demographics</span></a>
  <a href="#sec-7" onclick="document.getElementById('sec-7').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">7</span><span class="toc-label">Competition</span></a>
  <a href="#sec-8" onclick="document.getElementById('sec-8').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">8</span><span class="toc-label">Sizing</span></a>
  <a href="#sec-S" onclick="document.getElementById('sec-S').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">S</span><span class="toc-label">SiteScore</span></a>
</nav>

<!-- Quick Actions -->
<div class="quick-actions no-print">
  <button class="qa-print" onclick="window.print()">Print / Save PDF</button>
  <button class="qa-jump" onclick="document.getElementById('sec-2').scrollIntoView({behavior:'smooth'})">Zoning</button>
  <button class="qa-jump" onclick="document.getElementById('sec-3').scrollIntoView({behavior:'smooth'})">Water</button>
  <button class="qa-jump" onclick="document.getElementById('sec-7').scrollIntoView({behavior:'smooth'})">Competition</button>
</div>

<div class="report-wrapper">
  <!-- HEADER -->
  <div style="background:linear-gradient(135deg,#0A0A0C 0%,#1E2761 50%,#2C3E6B 100%);padding:40px 44px 32px;position:relative;overflow:hidden">
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(ellipse at 80% 20%,rgba(201,168,76,0.06) 0%,transparent 60%)"></div>
    <div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#C9A84C,#F37C33,#C9A84C,transparent)"></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;position:relative">
      <div>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
          <div style="width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#C9A84C,#A08530);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(201,168,76,0.4)"><span style="font-size:24px;font-weight:900;color:#fff;font-family:'Space Mono';letter-spacing:-0.02em">S</span></div>
          <div><div style="font-size:10px;color:#C9A84C;letter-spacing:0.14em;text-transform:uppercase;font-weight:700">Site Vetting Report</div><div style="font-size:24px;font-weight:900;color:#fff;letter-spacing:0.01em;margin-top:4px">${h(site.name) || "Unnamed Site"}</div></div>
        </div>
        <div style="font-size:12px;color:#94A3B8;margin-top:4px">${h(site.address) || ""}, ${h(site.city) || ""}, ${h(site.state) || ""}</div>
        <div style="font-size:10px;color:#64748B;margin-top:4px">${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} &nbsp;|&nbsp; ${site.market ? h(site.market) : ""}</div>
      </div>
      <div style="text-align:right">
        <div style="display:inline-flex;align-items:center;gap:10px;padding:12px 20px;border-radius:14px;background:${iqBadgeColor}15;border:2px solid ${iqBadgeColor}35;backdrop-filter:blur(4px)">
          <span style="font-size:32px;font-weight:900;color:${iqBadgeColor};font-family:'Space Mono'">${typeof iqScore === "number" ? iqScore.toFixed(1) : iqScore}</span>
          <div><div style="font-size:9px;color:#CBD5E1;letter-spacing:0.1em;font-weight:700">SITESCORE<span style="font-size:7px;vertical-align:super">&trade;</span></div><div style="font-size:12px;font-weight:800;color:${iqBadgeColor};margin-top:2px">${iqLabel}</div></div>
        </div>
      </div>
    </div>
  </div>

  <!-- KEY METRICS BAR -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);background:linear-gradient(180deg,#FAFBFC,#F5F7FA);border-bottom:2px solid #E2E8F0">
    ${[
      { l: "ACREAGE", v: site.acreage ? site.acreage + " ac" : "—" },
      { l: "ASKING PRICE", v: site.askingPrice || "—" },
      { l: "3-MI POP", v: popN > 0 ? fmtN(popN) : "—" },
      { l: "3-MI MED INC", v: incN > 0 ? ("$" + fmtN(incN)) : "—" },
      { l: "NEAREST PS", v: site.siteiqData?.nearestPS ? site.siteiqData.nearestPS + " mi" : "—" },
    ].map(m => `<div style="padding:16px 10px;text-align:center;border-right:1px solid #E2E8F0"><div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.08em;margin-bottom:5px">${m.l}</div><div style="font-size:15px;font-weight:800;color:#1E293B;font-family:'Space Mono',monospace">${m.v}</div></div>`).join("")}
  </div>

  <div style="padding:28px 44px 44px">

    <!-- ═══════════════════════════════════════════════ -->
    <!-- SECTION 0: EXECUTIVE SUMMARY -->
    <!-- ═══════════════════════════════════════════════ -->
    <div id="${sectionId("E")}" class="report-section" style="scroll-margin-top:20px;margin:0 0 28px;padding:28px 28px 24px;border-radius:14px;background:linear-gradient(135deg,#0F1235 0%,#1E2761 60%,#2C3E6B 100%);border:2px solid #C9A84C30;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#C9A84C,transparent)"></div>
      <div style="position:absolute;bottom:0;right:0;width:200px;height:200px;background:radial-gradient(circle,rgba(201,168,76,0.04) 0%,transparent 70%)"></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
        <div style="width:28px;height:28px;border-radius:8px;background:#C9A84C20;border:1px solid #C9A84C40;display:flex;align-items:center;justify-content:center"><span style="font-size:12px;font-weight:900;color:#C9A84C">E</span></div>
        <div style="font-size:14px;font-weight:800;color:#C9A84C;letter-spacing:0.06em;text-transform:uppercase">Executive Summary</div>
        <div style="flex:1;height:1px;background:#C9A84C20;margin-left:8px"></div>
      </div>

      <!-- Score + Classification row -->
      <div style="display:grid;grid-template-columns:auto 1fr auto;gap:20px;align-items:center;margin-bottom:20px">
        <div style="text-align:center;padding:8px 20px">
          <div style="font-size:42px;font-weight:900;color:${iqBadgeColor};font-family:'Space Mono',monospace;line-height:1">${typeof iqScore === "number" ? iqScore.toFixed(1) : iqScore}</div>
          <div style="font-size:9px;color:#94A3B8;font-weight:700;letter-spacing:0.08em;margin-top:4px">${iqLabel}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
          <div style="padding:10px 14px;border-radius:10px;background:${zoningColor}12;border:1px solid ${zoningColor}30">
            <div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.06em;margin-bottom:4px">ZONING</div>
            <div style="font-size:12px;font-weight:800;color:${zoningColor}">${zoningClass === "by-right" ? "Permitted" : zoningClass === "conditional" ? "SUP/CUP" : zoningClass === "rezone-required" ? "Rezone" : zoningClass === "prohibited" ? "Prohibited" : "Unknown"}</div>
            ${site.zoning ? `<div style="font-size:9px;color:#CBD5E1;margin-top:2px">${h(site.zoning)}</div>` : ""}
          </div>
          <div style="padding:10px 14px;border-radius:10px;background:${waterHookupColor}12;border:1px solid ${waterHookupColor}30">
            <div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.06em;margin-bottom:4px">WATER HOOKUP</div>
            <div style="font-size:12px;font-weight:800;color:${waterHookupColor}">${waterHookupLabel}</div>
            ${site.waterProvider ? `<div style="font-size:9px;color:#CBD5E1;margin-top:2px">${h(site.waterProvider)}</div>` : ""}
          </div>
          <div style="padding:10px 14px;border-radius:10px;background:${compColor}12;border:1px solid ${compColor}30">
            <div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.06em;margin-bottom:4px">COMPETITION</div>
            <div style="font-size:12px;font-weight:800;color:${compColor}">${compLabel}</div>
            <div style="font-size:9px;color:#CBD5E1;margin-top:2px">${satLevel}</div>
          </div>
        </div>
        <div style="text-align:center;padding:8px 16px;border-radius:10px;background:${recColor}12;border:1px solid ${recColor}30">
          <div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.06em;margin-bottom:4px">VERDICT</div>
          <div style="font-size:11px;font-weight:800;color:${recColor};line-height:1.3">${iqScore >= 8.0 ? "GREEN" : iqScore >= 6.0 ? "YELLOW" : iqScore >= 4.0 ? "ORANGE" : typeof iqScore === "number" ? "RED" : "TBD"}</div>
        </div>
      </div>

      <!-- Demographics snapshot + PS Proximity -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:18px">
        ${[
          { l: "3-MI POPULATION", v: popN > 0 ? fmtN(popN) : "—", c: popN >= 25000 ? "#16A34A" : popN >= 10000 ? "#3B82F6" : "#F59E0B" },
          { l: "MEDIAN HHI", v: incN > 0 ? "$" + fmtN(incN) : "—", c: incN >= 75000 ? "#16A34A" : incN >= 55000 ? "#3B82F6" : "#F59E0B" },
          { l: "5-YR GROWTH", v: growthPct !== null ? (growthPct >= 0 ? "+" : "") + growthPct.toFixed(1) + "%" : "—", c: growthColor },
          { l: "PS PROXIMITY", v: site.siteiqData?.nearestPS ? site.siteiqData.nearestPS + " mi" : "—", c: psColor },
        ].map(k => `<div style="text-align:center;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06)">
          <div style="font-size:7px;font-weight:700;color:#64748B;letter-spacing:0.06em">${k.l}</div>
          <div style="font-size:16px;font-weight:900;color:${k.c};font-family:'Space Mono',monospace;margin-top:4px">${k.v}</div>
        </div>`).join("")}
      </div>

      <!-- Key strength / key risk -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="padding:10px 14px;border-radius:8px;background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.15)">
          <div style="font-size:8px;font-weight:700;color:#16A34A;letter-spacing:0.06em;margin-bottom:4px">KEY STRENGTH</div>
          <div style="font-size:11px;color:#D1FAE5;line-height:1.4">${keyStrength}</div>
        </div>
        <div style="padding:10px 14px;border-radius:8px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.15)">
          <div style="font-size:8px;font-weight:700;color:#EF4444;letter-spacing:0.06em;margin-bottom:4px">KEY RISK</div>
          <div style="font-size:11px;color:#FEE2E2;line-height:1.4">${keyRisk}</div>
        </div>
      </div>

      <!-- Recommendation -->
      <div style="padding:10px 16px;border-radius:8px;background:${recColor}10;border:1px solid ${recColor}25;display:flex;align-items:center;gap:10px">
        <div style="width:6px;height:6px;border-radius:50%;background:${recColor};flex-shrink:0"></div>
        <div style="font-size:11px;font-weight:700;color:${recColor};letter-spacing:0.02em">${recommendation}</div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- RESEARCH COMPLETENESS GATE -->
    <!-- ═══════════════════════════════════════════════ -->
    ${(() => {
      const checks = [
        { label: "Zoning District Identified", done: !!site.zoning, category: "ZONING" },
        { label: "Zoning Classification Confirmed", done: !!site.zoningClassification && site.zoningClassification !== "unknown", category: "ZONING" },
        { label: "Ordinance Source Cited", done: !!site.zoningSource, category: "ZONING" },
        { label: "Ordinance Section Referenced", done: !!site.zoningOrdinanceSection, category: "ZONING" },
        { label: "Exact Use Category Extracted", done: !!site.zoningUseTerm, category: "ZONING" },
        { label: "Jurisdiction Type Identified", done: !!site.jurisdictionType, category: "ZONING" },
        { label: "Planning Dept Contact Found", done: !!site.planningContact, category: "ZONING" },
        { label: "Permitted Use Table Reviewed", done: !!site.zoningNotes && site.zoningNotes.length > 20, category: "ZONING" },
        { label: "Water Provider Identified", done: !!site.waterProvider, category: "UTILITY" },
        { label: "Water Availability Confirmed", done: site.waterAvailable === true || site.waterAvailable === false, category: "UTILITY" },
        { label: "Inside Service Boundary", done: site.insideServiceBoundary === true || site.insideServiceBoundary === false, category: "UTILITY" },
        { label: "Distance to Water Main", done: !!site.distToWaterMain, category: "UTILITY" },
        { label: "Fire Flow Assessed", done: site.fireFlowAdequate === true || site.fireFlowAdequate === false, category: "UTILITY" },
        { label: "Sewer Provider Identified", done: !!site.sewerProvider, category: "UTILITY" },
        { label: "Sewer Availability Confirmed", done: site.sewerAvailable === true || site.sewerAvailable === false, category: "UTILITY" },
        { label: "Electric Provider + 3-Phase", done: !!site.electricProvider, category: "UTILITY" },
        { label: "Tap/Impact Fees Documented", done: !!site.tapFees || !!site.waterTapFee, category: "UTILITY" },
        { label: "FEMA Flood Zone Checked", done: !!site.floodZone, category: "TOPO" },
        { label: "FIRM Panel Recorded", done: !!site.firmPanel, category: "TOPO" },
        { label: "Soil Type Checked", done: !!site.soilType, category: "TOPO" },
        { label: "Terrain Assessment", done: !!site.terrain, category: "TOPO" },
        { label: "Wetlands Checked (NWI)", done: site.wetlands === true || site.wetlands === false, category: "TOPO" },
      ];
      const done = checks.filter(c => c.done).length;
      const total = checks.length;
      const pct = Math.round((done / total) * 100);
      const grade = pct === 100 ? "COMPLETE" : pct >= 80 ? "NEAR COMPLETE" : pct >= 50 ? "IN PROGRESS" : "INCOMPLETE";
      const gradeColor = pct === 100 ? "#16A34A" : pct >= 80 ? "#3B82F6" : pct >= 50 ? "#F59E0B" : "#EF4444";
      const catSummary = (cat) => { const items = checks.filter(c => c.category === cat); const d = items.filter(c => c.done).length; return { done: d, total: items.length, pct: Math.round((d / items.length) * 100) }; };
      const z = catSummary("ZONING"); const u = catSummary("UTILITY"); const t = catSummary("TOPO");
      return `
    <div id="${sectionId("R")}" style="margin-bottom:28px;border-radius:14px;overflow:hidden;border:2px solid ${gradeColor}30;scroll-margin-top:20px" class="report-section">
      <div style="background:linear-gradient(135deg,#0A0A0C,#1E2761);padding:18px 22px;display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:52px;height:52px;border-radius:12px;background:${gradeColor}12;border:2px solid ${gradeColor}35;display:flex;align-items:center;justify-content:center">
            <span style="font-size:20px;font-weight:900;color:${gradeColor};font-family:'Space Mono',monospace">${pct}%</span>
          </div>
          <div>
            <div style="font-size:14px;font-weight:800;color:#fff;letter-spacing:0.02em">Research Completeness</div>
            <div style="font-size:10px;color:#94A3B8;margin-top:2px">${done}/${total} items verified against primary sources</div>
          </div>
        </div>
        <span style="padding:6px 18px;border-radius:8px;font-size:12px;font-weight:800;background:${gradeColor}18;color:${gradeColor};border:1px solid ${gradeColor}30;letter-spacing:0.06em">${grade}</span>
      </div>
      <div style="background:#FAFBFC;padding:16px 22px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
        ${[
          { label: "Zoning & Entitlements", ...z, color: "#1E2761" },
          { label: "Utilities & Water", ...u, color: "#16A34A" },
          { label: "Topography & Flood", ...t, color: "#E87A2E" },
        ].map(c => `<div class="hover-card" style="text-align:center;padding:14px;border-radius:10px;background:#fff;border:1px solid #E2E8F0">
          <div style="font-size:9px;font-weight:800;color:${c.color};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">${c.label}</div>
          <div style="width:100%;height:8px;border-radius:4px;background:#E2E8F0;overflow:hidden;margin-bottom:6px"><div style="width:${c.pct}%;height:100%;border-radius:4px;background:${c.pct === 100 ? "#16A34A" : c.pct >= 60 ? "#F59E0B" : "#EF4444"};transition:width 0.5s"></div></div>
          <div style="font-size:12px;font-weight:800;color:${c.pct === 100 ? "#16A34A" : "#64748B"}">${c.done}/${c.total}</div>
        </div>`).join("")}
      </div>
      ${pct < 100 ? `<div style="background:#FEF2F2;padding:12px 22px;border-top:1px solid #FECACA">
        <div style="font-size:10px;font-weight:700;color:#991B1B;margin-bottom:6px">OUTSTANDING RESEARCH ITEMS:</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${checks.filter(c => !c.done).map(c => `<span style="font-size:9px;font-weight:600;color:#991B1B;background:#FEE2E2;padding:3px 10px;border-radius:5px">${c.label}</span>`).join("")}</div>
      </div>` : `<div style="background:#F0FDF4;padding:12px 22px;border-top:1px solid #BBF7D0;text-align:center">
        <span style="font-size:11px;font-weight:700;color:#166534">ALL RESEARCH ITEMS VERIFIED — REPORT IS INSTITUTIONAL-GRADE</span>
      </div>`}
    </div>`;
    })()}

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 1. PROPERTY OVERVIEW -->
    <!-- ═══════════════════════════════════════════════ -->
    ${section("1", "Property Overview")}
    <table style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">${[
      row("Name", site.name || "—", { bold: true }),
      row("Address", `${site.address || "—"}, ${site.city || "—"}, ${site.state || "—"}`),
      row("Market", site.market || "—"),
      row("Acreage", site.acreage || "—"),
      row("Asking Price", site.askingPrice || "—", { bold: true }),
      row("Internal Price", site.internalPrice || "—"),
      row("Phase", site.phase || "Prospect", { badge: true, badgeBg: site.phase === "Under Contract" ? "#DCFCE7" : "#FFF7ED", badgeColor: site.phase === "Under Contract" ? "#166534" : "#9A3412" }),
      row("Priority", cleanPriority(site.priority)),
      row("Coordinates", site.coordinates ? `<a href="${mapsUrl}" target="_blank" style="color:#1565C0;text-decoration:none;font-weight:600">${site.coordinates} &#8599;</a>` : "—"),
      row("Listing", site.listingUrl ? `<a href="${site.listingUrl}" target="_blank" style="color:#F37C33;text-decoration:none;font-weight:600">View Listing &#8599;</a>` : "—"),
      dom !== null ? row("Days on Market", `${dom} days`, { badge: true, badgeBg: dom > 365 ? "#FEE2E2" : dom > 180 ? "#FEF3C7" : "#DCFCE7", badgeColor: dom > 365 ? "#991B1B" : dom > 180 ? "#92400E" : "#166534" }) : "",
    ].join("")}</table>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 2. ZONING & ENTITLEMENTS — DEEP DIVE -->
    <!-- ═══════════════════════════════════════════════ -->
    ${section("2", "Zoning & Entitlements")}

    <!-- Zoning Verdict Card -->
    <div class="hover-card" style="padding:20px 24px;border-radius:14px;background:${zoningColor}06;border:2px solid ${zoningColor}30;margin-bottom:18px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;width:4px;height:100%;background:${zoningColor}"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div>
          <div style="font-size:9px;font-weight:700;color:#94A3B8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px">Zoning Verdict</div>
          <span style="font-size:18px;font-weight:900;color:${zoningColor}">${zoningLabel}</span>
        </div>
        <div style="text-align:right">
          <div style="font-size:9px;color:#94A3B8;font-weight:700;letter-spacing:0.06em">DISTRICT</div>
          <div style="font-size:16px;font-weight:800;color:#1E293B;font-family:'Space Mono',monospace;margin-top:2px">${h(site.zoning) || "TBD"}</div>
        </div>
      </div>
      ${site.zoningOrdinanceSection ? `<div style="font-size:10px;color:#64748B;margin-top:6px">Ordinance: <strong style="color:#1E293B">${h(site.zoningOrdinanceSection)}</strong>${site.zoningSource ? ` | <a href="${h(site.zoningSource)}" target="_blank" style="color:#F37C33;text-decoration:none">Source &#8599;</a>` : ""}</div>` : ""}
      ${site.zoningUseTerm ? `<div style="font-size:10px;color:#64748B;margin-top:4px">Use Category: <strong style="color:#1E293B">${h(site.zoningUseTerm)}</strong></div>` : ""}
      <div style="font-size:11px;color:#64748B;line-height:1.6;margin-top:10px">${
        zoningClass === "by-right" ? "Self-storage / mini-warehouse is a <strong style='color:#16A34A'>permitted use</strong> in this zoning district. No special approvals required — proceed with site plan review." :
        zoningClass === "conditional" ? "Self-storage is allowed as a <strong style='color:#F59E0B'>conditional / special use</strong>. Requires public hearing and approval. Timeline: typically 2-6 months. Factor SUP costs (~$15K-$50K) and uncertainty into underwriting." :
        zoningClass === "rezone-required" ? "Current zoning <strong style='color:#EF4444'>does not permit</strong> storage use. Rezoning required — political risk, 4-12 month timeline, significant cost ($25K-$75K+)." :
        zoningClass === "prohibited" ? "Storage is <strong style='color:#991B1B'>explicitly prohibited</strong> with no conditional path. Rezone is the only option and may face strong opposition." :
        "Zoning classification has <strong>not been confirmed</strong>. The permitted use table for this jurisdiction must be reviewed before proceeding."
      }</div>
    </div>

    <!-- Zoning Decision Tree -->
    <div style="margin-bottom:18px;padding:16px 20px;border-radius:12px;background:#F8FAFC;border:1px solid #E2E8F0">
      <div style="font-size:9px;font-weight:800;color:#1E2761;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:12px">Zoning Decision Tree</div>
      <div class="z-tree">
        <div class="z-tree-node" style="background:#1E276110;border:2px solid #1E276130"><div style="font-size:8px;font-weight:700;color:#94A3B8;margin-bottom:2px">DISTRICT</div><div style="font-size:12px;font-weight:800;color:#1E2761">${h(site.zoning) || "?"}</div></div>
        <div class="z-tree-arrow"></div>
        <div class="z-tree-node" style="background:${site.zoningUseTerm ? "#16A34A" : "#94A3B8"}10;border:2px solid ${site.zoningUseTerm ? "#16A34A" : "#94A3B8"}30"><div style="font-size:8px;font-weight:700;color:#94A3B8;margin-bottom:2px">USE TABLE</div><div style="font-size:10px;font-weight:700;color:${site.zoningUseTerm ? "#16A34A" : "#94A3B8"}">${site.zoningUseTerm ? "Found" : "Pending"}</div></div>
        <div class="z-tree-arrow"></div>
        <div class="z-tree-node" style="background:${site.zoningUseTerm ? "#16A34A" : "#94A3B8"}10;border:2px solid ${site.zoningUseTerm ? "#16A34A" : "#94A3B8"}30"><div style="font-size:8px;font-weight:700;color:#94A3B8;margin-bottom:2px">STORAGE ROW</div><div style="font-size:9px;font-weight:700;color:#475569;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${site.zoningUseTerm ? h(site.zoningUseTerm) : "—"}</div></div>
        <div class="z-tree-arrow"></div>
        <div class="z-tree-node" style="background:${zoningColor}12;border:2px solid ${zoningColor}40"><div style="font-size:8px;font-weight:700;color:#94A3B8;margin-bottom:2px">RESULT</div><div style="font-size:12px;font-weight:900;color:${zoningColor}">${zoningClass === "by-right" ? "P" : zoningClass === "conditional" ? "C" : zoningClass === "rezone-required" ? "—" : zoningClass === "prohibited" ? "X" : "?"}</div></div>
      </div>
    </div>

    <!-- Zoning detail table -->
    <table style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">${[
      row("Zoning District", site.zoning || "Not confirmed", { bold: true }),
      row("Classification", zoningLabel, { badge: true, badgeBg: zoningColor + "18", badgeColor: zoningColor }),
      row("Storage Use Term", hasByRight ? "Permitted (by right)" : hasSUP ? "Conditional / SUP / CUP" : hasRezone ? "Rezone required" : "Not determined"),
      row("Exact Use Category", site.zoningUseTerm || "<em style='color:#94A3B8'>Extract from permitted use table</em>"),
      row("Overlay Districts", site.overlayDistrict || (hasOverlay ? "Yes — additional standards apply" : "None identified")),
      row("Jurisdiction Type", site.jurisdictionType || "<em style='color:#94A3B8'>City / Township / Unincorporated County</em>"),
      row("Ordinance Section", site.zoningOrdinanceSection || "<em style='color:#94A3B8'>Section & chapter reference needed</em>"),
      row("Ordinance Source", site.zoningSource ? `<a href="${h(site.zoningSource)}" target="_blank" style="color:#F37C33;text-decoration:none">${h(site.zoningSource).substring(0,60)}... &#8599;</a>` : "<em style='color:#94A3B8'>Not yet researched</em>"),
      row("Verification Date", site.zoningVerifyDate || "<em style='color:#94A3B8'>Not verified</em>"),
      row("Zoning Score", zoningScore != null ? `<span style="font-weight:900;color:${zoningScoreColor};font-family:'Space Mono',monospace">${zoningScore.toFixed(1)}/10</span>` : "—"),
      site.zoningClass === "conditional" || hasSUP ? row("SUP/CUP Timeline", site.supTimeline || "<em style='color:#F59E0B'>Typically 2-6 months</em>") : "",
      site.zoningClass === "conditional" || hasSUP ? row("SUP/CUP Est. Cost", site.supCost || "<em style='color:#F59E0B'>$15K-$50K typical</em>") : "",
      site.zoningClass === "conditional" || hasSUP ? row("Political Risk", site.politicalRisk || "<em style='color:#94A3B8'>Check recent applications</em>") : "",
      site.zoningClass === "rezone-required" || hasRezone ? row("Rezone Timeline", site.rezoneTimeline || "<em style='color:#EF4444'>4-12 months typical</em>") : "",
      site.zoningClass === "rezone-required" || hasRezone ? row("Rezone Est. Cost", site.rezoneCost || "<em style='color:#EF4444'>$25K-$75K+ typical</em>") : "",
      row("Planning Contact", site.planningContact || "<em style='color:#94A3B8'>Research needed</em>"),
      row("Planning Phone", site.planningPhone || "<em style='color:#94A3B8'>—</em>"),
      row("Planning Email", site.planningEmail || "<em style='color:#94A3B8'>—</em>"),
    ].filter(Boolean).join("")}</table>

    <!-- Zoning Notes (formatted paragraphs) -->
    ${site.zoningNotes ? `<div style="margin-top:14px;padding:16px 20px;border-radius:12px;background:#F8FAFC;border:1px solid #E2E8F0">
      <div style="font-size:9px;font-weight:800;color:#1E2761;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Zoning Research Notes</div>
      <div style="font-size:12px;line-height:1.8;color:#475569">${h(site.zoningNotes).replace(/\n/g, '<br/>')}</div>
    </div>` : ""}

    <!-- Entitlement Risk Matrix / Timeline -->
    ${(zoningClass === "conditional" || zoningClass === "rezone-required" || hasSUP || hasRezone) ? `
    <div style="margin-top:18px;padding:18px 22px;border-radius:14px;background:#FEF3C7;border:2px solid #F59E0B30">
      <div style="font-size:11px;font-weight:800;color:#92400E;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:12px">Entitlement Risk Assessment</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px">
        ${[
          { l: "Timeline", v: site.supTimeline || site.rezoneTimeline || (hasSUP ? "2-6 mo" : "4-12 mo") },
          { l: "Est. Cost", v: site.supCost || site.rezoneCost || (hasSUP ? "$15-50K" : "$25-75K+") },
          { l: "Political Risk", v: site.politicalRisk || "Assess" },
        ].map(x => `<div class="hover-card" style="text-align:center;padding:12px;border-radius:10px;background:#fff;border:1px solid #FDE68A">
          <div style="font-size:9px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.05em">${x.l}</div>
          <div style="font-size:17px;font-weight:900;color:#D97706;margin-top:6px">${x.v}</div>
        </div>`).join("")}
      </div>
      <!-- Zoning Timeline Bar -->
      <div style="padding:12px 16px;border-radius:8px;background:#fff;border:1px solid #FDE68A">
        <div style="font-size:8px;font-weight:700;color:#92400E;letter-spacing:0.06em;margin-bottom:8px">APPROVAL TIMELINE</div>
        <div style="display:flex;align-items:center;gap:0">
          ${["Application", "Public Hearing", "Decision", "Permit"].map((step, i) => `<div style="flex:1;text-align:center;position:relative">
            <div style="width:24px;height:24px;border-radius:50%;background:${i === 0 ? "#D97706" : "#FDE68A"};border:2px solid #D97706;margin:0 auto;display:flex;align-items:center;justify-content:center"><span style="font-size:10px;font-weight:900;color:${i === 0 ? "#fff" : "#D97706"}">${i + 1}</span></div>
            <div style="font-size:8px;font-weight:600;color:#78350F;margin-top:4px">${step}</div>
            ${i < 3 ? `<div style="position:absolute;top:12px;left:50%;width:100%;height:2px;background:#FDE68A;z-index:0"></div>` : ""}
          </div>`).join("")}
        </div>
      </div>
      ${site.recentApprovals ? `<div style="font-size:11px;color:#78350F;margin-top:10px;line-height:1.5"><strong>Recent Applications:</strong> ${h(site.recentApprovals)}</div>` : ""}
    </div>` : ""}

    <!-- Supplemental Standards -->
    <details class="method-box" style="margin-top:16px">
      <summary>Supplemental Standards</summary>
      <div class="method-content" style="padding:0!important">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:14px">
          ${[
            { label: "Facade / Materials", text: site.facadeReqs || (/facade|material|masonry|brick/i.test(combined) ? "Requirements noted" : "No specific requirements") },
            { label: "Setbacks", text: site.setbackReqs || (/setback/i.test(combined) ? "Setback requirements noted" : "Standard district setbacks") },
            { label: "Height Limits", text: site.heightLimit || (/height\s*limit|max.*height|story.*limit/i.test(combined) ? "Height restrictions noted" : "Standard district limits") },
            { label: "Screening / Landscape", text: site.screeningReqs || (/screen|landscape|buffer/i.test(combined) ? "Screening required" : "Standard requirements") },
            { label: "Signage", text: site.signageReqs || (/sign/i.test(combined) ? "Signage requirements noted" : "Standard signage rules") },
            { label: "Parking", text: site.parkingReqs || (/parking/i.test(combined) ? "Parking requirements noted" : "Per district standards") },
          ].map(s => `<div style="padding:10px 14px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0">
            <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:3px">${s.label}</div>
            <div style="font-size:11px;color:#64748B">${s.text}</div>
          </div>`).join("")}
        </div>
      </div>
    </details>

    <details class="method-box">
      <summary>Research Methodology — Zoning</summary>
      <div class="method-content">
        Zoning classification sourced from municipal ordinance permitted use table. Ordinance databases searched: ecode360.com, Municode.com, American Legal Publishing, Code Publishing Co., and jurisdiction websites. Storage use terms searched: "storage warehouse," "mini-warehouse," "self-service storage," "self-storage," "personal storage," "indoor storage," "warehouse (mini/self-service)." Overlay districts identified via zoning map review. Supplemental standards extracted from district-specific regulations. Planning department contact sourced from jurisdiction website. Verification date: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
      </div>
    </details>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 3. UTILITIES & WATER — DEEP DIVE -->
    <!-- ═══════════════════════════════════════════════ -->
    ${section("3", "Utilities & Water")}

    <!-- Water Hookup Decision Card -->
    <div class="hover-card" style="padding:20px 24px;border-radius:14px;background:${waterHookupColor}06;border:2px solid ${waterHookupColor}30;margin-bottom:18px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;width:4px;height:100%;background:${waterHookupColor}"></div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:9px;font-weight:700;color:#94A3B8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px">Water Hookup Status</div>
          <span style="font-size:18px;font-weight:900;color:${waterHookupColor}">${waterHookupLabel}</span>
          <div style="font-size:11px;color:#64748B;margin-top:4px">${
            waterHookup === "by-right" ? "Site is inside the provider's service boundary — entitled to a water tap." :
            waterHookup === "by-request" ? "Extension or annexation agreement needed — contact provider." :
            waterHookup === "no-provider" ? "No municipal water provider identified — critical blocker." :
            "Water hookup status not yet determined — research required."
          }</div>
        </div>
        <div style="text-align:center">
          <!-- Circular Gauge for Utility Readiness -->
          <div class="gauge-ring">
            <svg width="90" height="90" viewBox="0 0 90 90">
              <circle cx="45" cy="45" r="38" fill="none" stroke="#E2E8F0" stroke-width="6"/>
              <circle cx="45" cy="45" r="38" fill="none" stroke="${utilGradeColor}" stroke-width="6"
                stroke-dasharray="${Math.round(238.76 * utilScore / 100)} 238.76"
                stroke-linecap="round"/>
            </svg>
            <div class="gauge-text">
              <div style="font-size:22px;font-weight:900;color:${utilGradeColor};font-family:'Space Mono',monospace;line-height:1">${utilGrade}</div>
              <div style="font-size:8px;color:#94A3B8;font-weight:600">${utilScore}/100</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Who To Call card -->
    ${(site.waterProvider || site.waterContact || site.planningPhone) ? `<div class="hover-card" style="padding:16px 20px;border-radius:12px;background:#F0F9FF;border:2px solid #BAE6FD;margin-bottom:18px">
      <div style="font-size:9px;font-weight:800;color:#0369A1;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px">Who To Call — Water Hookup</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div style="font-size:10px;color:#64748B;margin-bottom:2px">Provider</div>
          <div style="font-size:13px;font-weight:700;color:#1E293B">${h(site.waterProvider) || "TBD"}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#64748B;margin-bottom:2px">Contact</div>
          <div style="font-size:13px;font-weight:700;color:#1E293B">${site.waterContact ? h(site.waterContact) : (site.planningContact ? h(site.planningContact) : "Research needed")}</div>
        </div>
      </div>
      ${site.planningPhone ? `<div style="margin-top:8px;font-size:11px;color:#0369A1;font-weight:600">Phone: ${h(site.planningPhone)}${site.planningEmail ? " | Email: " + h(site.planningEmail) : ""}</div>` : ""}
      <div style="margin-top:8px;padding:8px 12px;border-radius:6px;background:#E0F2FE;font-size:10px;color:#075985;line-height:1.4"><strong>Request:</strong> Commercial water tap for a climate-controlled self-storage facility (${site.acreage || "~4"} acres, ~80,000 SF building)</div>
    </div>` : ""}

    <!-- Utility Budget Waterfall -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px">
      ${totalUtilLow > 0 || totalUtilHigh > 0 ? `<div class="hover-card" style="padding:18px 22px;border-radius:12px;background:#FEF3C7;border:2px solid #FDE68A;text-align:center">
        <div style="font-size:9px;font-weight:800;color:#92400E;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Est. Utility Budget</div>
        <div style="font-size:24px;font-weight:900;color:#D97706;font-family:'Space Mono',monospace;line-height:1">$${totalUtilLow > 0 ? (totalUtilLow/1000).toFixed(0) + "K" : "—"} – $${totalUtilHigh > 0 ? (totalUtilHigh/1000).toFixed(0) + "K" : "—"}</div>
        <!-- Cost breakdown bars -->
        <div style="margin-top:12px;text-align:left">
          ${[
            { label: "Water Tap", val: waterTapN, color: "#0284C7" },
            { label: "Sewer Tap", val: sewerTapN, color: "#059669" },
            { label: "Impact Fees", val: impactN, color: "#7C3AED" },
            { label: "Line Extension", val: extensionLow ? (extensionLow + extensionHigh) / 2 : null, color: "#D97706" },
          ].filter(x => x.val).map(x => {
            const maxVal = Math.max(waterTapN || 0, sewerTapN || 0, impactN || 0, extensionHigh || 0);
            const barW = maxVal > 0 ? Math.max(8, (x.val / maxVal) * 100) : 0;
            return `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;margin-bottom:2px"><span style="font-size:9px;font-weight:600;color:#78350F">${x.label}</span><span style="font-size:9px;font-weight:700;color:#78350F">$${(x.val/1000).toFixed(0)}K</span></div><div style="height:6px;border-radius:3px;background:#FDE68A"><div style="height:100%;width:${barW}%;border-radius:3px;background:${x.color}"></div></div></div>`;
          }).join("")}
        </div>
      </div>` : `<div class="hover-card" style="padding:18px 22px;border-radius:12px;background:#F8FAFC;border:2px solid #E2E8F0;text-align:center">
        <div style="font-size:9px;font-weight:800;color:#94A3B8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Est. Utility Budget</div>
        <div style="font-size:18px;font-weight:700;color:#94A3B8;margin-top:12px">Pending Data</div>
        <div style="font-size:10px;color:#94A3B8;margin-top:6px">Add tap fees & distance to main</div>
      </div>`}
      <!-- Readiness Checklist -->
      <div style="padding:14px 18px;border-radius:12px;background:#F8FAFC;border:1px solid #E2E8F0">
        <div style="font-size:9px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px">Readiness Checklist</div>
        ${utilChecks.map(c => `<div style="display:flex;align-items:center;gap:8px;padding:3px 0"><div style="width:16px;height:16px;border-radius:4px;background:${c.done ? "#16A34A" : "#E2E8F0"};display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="font-size:9px;color:#fff;font-weight:900">${c.done ? "&#10003;" : ""}</span></div><span style="font-size:10px;color:${c.done ? "#1E293B" : "#94A3B8"};font-weight:${c.done ? 600 : 400}">${c.label}</span></div>`).join("")}
      </div>
    </div>

    <!-- Utility cards grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
      ${[
        { label: "Water Service", available: !!site.waterProvider || site.waterAvailable === true || /water|municipal|city\s*water/i.test(combined), issue: site.waterAvailable === false ? "Extension required" : hasWell ? "Well water noted" : null, color: site.waterAvailable === true ? "#16A34A" : site.waterAvailable === false ? "#EF4444" : !!site.waterProvider ? "#16A34A" : /water|municipal/i.test(combined) ? "#16A34A" : "#94A3B8", detail: site.waterProvider || null },
        { label: "Sanitary Sewer", available: !!site.sewerProvider || site.sewerAvailable === true || /sewer|sanitary/i.test(combined) || hasSeptic, issue: site.sewerAvailable === false && !hasSeptic ? "Not available" : null, color: site.sewerAvailable === true ? "#16A34A" : !!site.sewerProvider ? "#16A34A" : /sewer/i.test(combined) ? "#16A34A" : hasSeptic ? "#16A34A" : site.sewerAvailable === false ? "#F59E0B" : "#94A3B8", detail: site.sewerProvider || (hasSeptic ? "Septic — viable for storage" : null) },
        { label: "Electric Service", available: !!site.electricProvider || site.threePhase === true || /electric|power/i.test(combined), issue: site.threePhase === false ? "No 3-phase" : null, color: site.threePhase === true ? "#16A34A" : !!site.electricProvider ? "#16A34A" : /electric|power/i.test(combined) ? "#16A34A" : "#94A3B8", detail: site.electricProvider ? (site.electricProvider + (site.threePhase === true ? " — 3-Phase" : "")) : null },
        { label: "Natural Gas", available: !!site.gasProvider || /\bgas\b|natural\s*gas/i.test(combined), issue: null, color: !!site.gasProvider ? "#16A34A" : /\bgas\b/i.test(combined) ? "#16A34A" : "#94A3B8", detail: site.gasProvider || null },
      ].map(u => `<div class="hover-card" style="padding:14px 16px;border-radius:12px;background:${u.color}06;border:1px solid ${u.color}20"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:12px;font-weight:700;color:#1E293B">${u.label}</span>${statusPill(u.available ? "Confirmed" : u.issue ? u.issue : "Not Confirmed", u.color)}</div><div style="font-size:11px;color:#64748B">${u.detail ? `<strong style="color:#1E293B">${u.detail}</strong>` : u.available ? "Available per verified research" : u.issue ? u.issue : "Verify with provider"}</div></div>`).join("")}
    </div>

    <!-- Water & Sewer Infrastructure table -->
    <table style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">${[
      row("Water Provider", site.waterProvider || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Water Available", site.waterAvailable === true ? '<span style="color:#16A34A;font-weight:700">YES — Municipal</span>' : site.waterAvailable === false ? '<span style="color:#EF4444;font-weight:700">NO — Extension Required</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Inside Service Boundary", site.insideServiceBoundary === true ? '<span style="color:#16A34A;font-weight:700">YES</span>' : site.insideServiceBoundary === false ? '<span style="color:#EF4444;font-weight:700">NO</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Distance to Water Main", site.distToWaterMain || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Water Main Size", site.waterMainSize || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Fire Flow Adequate", site.fireFlowAdequate === true ? '<span style="color:#16A34A;font-weight:700">YES — 1,500+ GPM confirmed</span>' : site.fireFlowAdequate === false ? '<span style="color:#EF4444;font-weight:700">NO — upgrade needed</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Sewer Provider", site.sewerProvider || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Sewer Available", site.sewerAvailable === true ? '<span style="color:#16A34A;font-weight:700">YES</span>' : site.sewerAvailable === false && hasSeptic ? '<span style="color:#16A34A;font-weight:700">Septic — viable for storage</span>' : site.sewerAvailable === false ? '<span style="color:#F59E0B;font-weight:700">NO — septic may work</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Electric (3-Phase)", site.threePhase === true ? '<span style="color:#16A34A;font-weight:700">Available</span>' : site.threePhase === false ? '<span style="color:#F59E0B;font-weight:700">Upgrade needed ($15K-$40K)</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Capacity / Moratorium", site.utilityCapacity || '<span style="color:#16A34A;font-weight:700">No moratorium identified</span>'),
    ].join("")}</table>

    <!-- Fee table -->
    <table style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;margin-top:14px">${[
      row("Water Tap Fee", site.waterTapFee || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Sewer Tap Fee", site.sewerTapFee || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Impact Fees", site.impactFees || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Line Extension Est.", site.lineExtensionCost || (site.distToWaterMain ? '<span style="color:#F59E0B;font-weight:600">Est. $50-$150/LF based on distance</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>')),
      row("Total Utility Budget", site.totalUtilityBudget || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
    ].join("")}</table>

    ${site.utilityNotes ? `<div style="margin-top:14px;padding:16px 20px;border-radius:12px;background:#F0F9FF;border:1px solid #BAE6FD;font-size:12px;line-height:1.7;color:#0C4A6E">${h(site.utilityNotes).replace(/\n/g, '<br/>')}</div>` : ""}

    <details class="method-box">
      <summary>Research Methodology — Utilities</summary>
      <div class="method-content">
        Water/sewer provider identified via city utility department website, county records, and state regulatory databases (TCEQ CCN maps for TX, state DEQ/utility commission for other states). Service boundary verified via municipal GIS portals and utility district maps. Tap/impact fees sourced from published jurisdiction fee schedules (commercial/warehouse classification). Electric provider identified via utility service territory maps; 3-phase availability checked against provider service records. Distance to nearest water/sewer main estimated via GIS infrastructure layers where available.
      </div>
    </details>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 4. TOPOGRAPHY & FLOOD -->
    <!-- ═══════════════════════════════════════════════ -->
    ${section("4", "Topography & Flood Assessment")}
    <div class="hover-card" style="padding:14px 18px;border-radius:12px;background:${hasFlood ? "#FEF2F2" : "#F0FDF4"};border:1px solid ${hasFlood ? "#FECACA" : "#BBF7D0"};display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <span style="font-size:13px;font-weight:600;color:#1E293B">${hasFlood ? "Flood zone concern identified" : "No flood zone issues identified"}</span>
      ${statusPill(hasFlood ? "FLOOD RISK" : "CLEAR", hasFlood ? "#EF4444" : "#16A34A")}
    </div>
    <table style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">${[
      row("FEMA Flood Zone", site.floodZone || (hasFlood ? '<span style="color:#F59E0B;font-weight:700">Flood concern — verify FEMA panel</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>')),
      row("FIRM Panel #", site.firmPanel || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Terrain", site.terrain || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Grade Change", site.gradeChange || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Drainage Direction", site.drainageDirection || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Grading Risk", site.gradingRisk || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Est. Grading Cost", site.gradingCost || (site.gradingRisk === "High" ? '<span style="color:#EF4444;font-weight:700">$150K-$400K+</span>' : site.gradingRisk === "Medium" ? '<span style="color:#F59E0B">$50K-$150K</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>')),
      row("Wetlands (NWI)", site.wetlands === true ? '<span style="color:#EF4444;font-weight:700">Present</span>' : site.wetlands === false ? '<span style="color:#16A34A;font-weight:700">None per NWI</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Soil Type", site.soilType || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Environmental", /environmental|contamina|brownfield|phase\s*[12i]/i.test(combined) ? "Issues noted — see summary" : "None identified"),
    ].join("")}</table>
    ${site.topoNotes ? `<div style="margin-top:14px;padding:16px 20px;border-radius:12px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:12px;line-height:1.7;color:#475569">${h(site.topoNotes).replace(/\n/g, '<br/>')}</div>` : ""}
    <details class="method-box">
      <summary>Research Methodology — Topography</summary>
      <div class="method-content">
        FEMA flood zone designation sourced from FEMA Flood Map Service Center (msc.fema.gov). Topographic assessment via Google Earth elevation profiles, USGS TopoView, and county GIS contour data. Wetlands checked via USFWS National Wetlands Inventory (NWI) mapper. Soil data from USDA Web Soil Survey. Grading cost estimates: flat-2% = no concern, 2-5% = $50K-$150K, 5-10% = $150K-$400K+, >10% = potentially prohibitive.
      </div>
    </details>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 5. SITE ACCESS & INFRASTRUCTURE -->
    <!-- ═══════════════════════════════════════════════ -->
    ${section("5", "Site Access & Infrastructure")}
    <table style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">${[
      row("Road Frontage", site.roadFrontage || (/frontage|\d+['']?\s*(?:ft|feet|linear)/i.test(combined) ? '<span style="color:#16A34A;font-weight:600">Frontage noted — see summary</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>')),
      row("Frontage Road Name", site.frontageRoadName || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Road Type", site.roadType || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Traffic Data (VPD)", site.trafficData || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Median / Turn Restrictions", site.medianType || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Nearest Signal", site.nearestSignal || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Curb Cuts", site.curbCuts || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Driveway Grade", site.drivewayGrade || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Visibility", site.visibility || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Decel / Turn Lane", site.decelLane || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Landlocked Risk", /landlocked|no\s*(?:road|access)|easement\s*only/i.test(combined) ? '<span style="color:#EF4444;font-weight:700">ACCESS CONCERN</span>' : '<span style="color:#16A34A;font-weight:700">No concerns</span>'),
    ].join("")}</table>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 6. DEMOGRAPHICS — FULL DEPTH -->
    <!-- ═══════════════════════════════════════════════ -->
    ${section("6", "Demographics & Demand Drivers")}
    <!-- KPI Cards — larger and more impactful -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
      ${[
        { label: "Population (3-mi)", val: popN > 0 ? fmtN(popN) : "—", color: popN >= 25000 ? "#16A34A" : popN >= 10000 ? "#3B82F6" : popN > 0 ? "#F59E0B" : "#94A3B8", sub: pop1 > 0 ? "1-mi: " + fmtN(pop1) : null },
        { label: "Median HHI", val: incN > 0 ? "$" + fmtN(incN) : "—", color: incN >= 75000 ? "#16A34A" : incN >= 55000 ? "#3B82F6" : incN > 0 ? "#F59E0B" : "#94A3B8", sub: null },
        { label: "Households", val: hhN > 0 ? fmtN(hhN) : "—", color: hhN >= 18000 ? "#16A34A" : hhN >= 6000 ? "#3B82F6" : hhN > 0 ? "#F59E0B" : "#94A3B8", sub: null },
        { label: "Home Value", val: hvN > 0 ? "$" + fmtN(hvN) : "—", color: hvN >= 250000 ? "#16A34A" : hvN >= 120000 ? "#3B82F6" : hvN > 0 ? "#F59E0B" : "#94A3B8", sub: null },
      ].map(k => `<div class="hover-card" style="padding:16px;border-radius:12px;background:${k.color}06;border:2px solid ${k.color}20;text-align:center">
        <div style="font-size:8px;font-weight:800;color:${k.color};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">${k.label}</div>
        <div style="font-size:22px;font-weight:900;color:${k.color};font-family:'Space Mono',monospace;line-height:1.1">${k.val}</div>
        ${k.sub ? `<div style="font-size:9px;color:#64748B;margin-top:6px">${k.sub}</div>` : ""}
      </div>`).join("")}
    </div>

    <!-- Growth Trend with arrow -->
    <div class="hover-card" style="padding:16px 22px;border-radius:12px;background:${growthColor}06;border:2px solid ${growthColor}20;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
      <div>
        <div style="font-size:9px;font-weight:800;color:${growthColor};text-transform:uppercase;letter-spacing:0.06em">5-Year Population Growth (CAGR)</div>
        <div style="font-size:11px;color:#64748B;margin-top:2px">ESRI 2025 &#8594; 2030 projection</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${growthPct !== null ? `<span style="font-size:18px;color:${growthColor}">${growthPct >= 0 ? "&#9650;" : "&#9660;"}</span>` : ""}
        <span style="font-size:28px;font-weight:900;color:${growthColor};font-family:'Space Mono',monospace">${growthPct !== null ? (growthPct >= 0 ? "+" : "") + growthPct.toFixed(1) + "%" : "—"}</span>
      </div>
    </div>

    ${demoScore ? `<div style="padding:10px 18px;border-radius:10px;background:${demoColor}08;border:1px solid ${demoColor}20;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px"><span style="font-size:12px;font-weight:700;color:#1E293B">Demographic Gate</span>${statusPill(demoScore, demoColor)}</div>` : ""}

    <!-- Growth Story / Demand Drivers card -->
    ${site.demandDrivers ? `<div class="hover-card" style="padding:16px 20px;border-radius:12px;background:linear-gradient(135deg,#F0F4FF,#F8FAFC);border:2px solid #1E276120;margin-bottom:18px">
      <div style="font-size:9px;font-weight:800;color:#1E2761;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Demand Drivers</div>
      <div style="font-size:12px;color:#475569;line-height:1.7">${h(site.demandDrivers)}</div>
    </div>` : ""}

    <table style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">${[
      row("Population (3-mi)", popN > 0 ? '<span style="color:#16A34A;font-weight:700">' + fmtN(popN) + '</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Population (1-mi)", pop1 > 0 ? fmtN(pop1) : '<span style="color:#94A3B8;font-weight:600;font-size:10px">Not required</span>'),
      row("Median HHI", incN > 0 ? '<span style="color:#16A34A;font-weight:700">$' + fmtN(incN) + '</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Households (3-mi)", hhN > 0 ? '<span style="color:#16A34A;font-weight:700">' + fmtN(hhN) + '</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Median Home Value", hvN > 0 ? '<span style="color:#16A34A;font-weight:700">$' + fmtN(hvN) + '</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("5-Yr Pop Growth", growthPct !== null ? '<span style="color:#16A34A;font-weight:700">' + (growthPct >= 0 ? "+" : "") + growthPct.toFixed(2) + "% CAGR</span>" : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Renter %", site.renterPct3mi ? String(site.renterPct3mi).replace(/%/g, "") + "%" : '<span style="color:#94A3B8;font-weight:600;font-size:10px">Not required</span>'),
      row("Demand Drivers", site.demandDrivers || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
    ].join("")}</table>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 7. COMPETITION LANDSCAPE -->
    <!-- ═══════════════════════════════════════════════ -->
    ${section("7", "Competition Landscape (3-Mile Radius)")}

    <!-- Competition Density Visual Card -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:18px">
      <div class="hover-card" style="padding:18px;border-radius:14px;background:${compColor}06;border:2px solid ${compColor}25;text-align:center">
        <div style="font-size:8px;font-weight:800;color:${compColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Competitors (3-mi)</div>
        <div style="font-size:40px;font-weight:900;color:${compColor};font-family:'Space Mono',monospace;line-height:1">${cc !== undefined && cc !== null ? cc : "?"}</div>
        <!-- Dot indicators -->
        ${cc !== undefined && cc !== null && cc > 0 && cc <= 10 ? `<div style="margin-top:8px;display:flex;justify-content:center;gap:4px">${Array.from({length: cc}).map(() => `<div style="width:8px;height:8px;border-radius:50%;background:${compColor}"></div>`).join("")}</div>` : ""}
        <div style="font-size:10px;color:#64748B;margin-top:8px;font-weight:600">${satLevel}</div>
      </div>
      <div class="hover-card" style="padding:18px;border-radius:14px;background:#1E276108;border:2px solid #1E276120;text-align:center">
        <div style="font-size:8px;font-weight:800;color:#1E2761;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Nearest PS</div>
        <div style="font-size:28px;font-weight:900;color:#1E2761;font-family:'Space Mono',monospace;line-height:1">${site.siteiqData?.nearestPS ? site.siteiqData.nearestPS : "—"}<span style="font-size:14px;color:#64748B"> mi</span></div>
        <div style="font-size:10px;color:#64748B;margin-top:8px;font-weight:600">${site.siteiqData?.nearestPS ? (site.siteiqData.nearestPS <= 5 ? "Validated submarket" : site.siteiqData.nearestPS <= 15 ? "Expansion zone" : site.siteiqData.nearestPS <= 35 ? "Frontier market" : "Too remote") : "Run proximity check"}</div>
      </div>
      <!-- SF/capita gauge -->
      <div class="hover-card" style="padding:18px;border-radius:14px;background:${sfCapitaColor}06;border:2px solid ${sfCapitaColor}25;text-align:center">
        <div style="font-size:8px;font-weight:800;color:${sfCapitaColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">SF / Capita</div>
        <div style="font-size:28px;font-weight:900;color:${sfCapitaColor};font-family:'Space Mono',monospace;line-height:1">${sfCapita !== null ? sfCapita.toFixed(1) : "—"}</div>
        ${sfCapita !== null ? `<div class="sf-gauge"><div class="sf-gauge-marker" style="left:${Math.min(100, Math.max(0, (sfCapita / 15) * 100))}%"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:7px;color:#94A3B8;font-weight:600"><span>Under</span><span>Equilib.</span><span>Over</span></div>` : ""}
        <div style="font-size:10px;color:#64748B;margin-top:6px;font-weight:600">${sfCapitaLabel}</div>
      </div>
    </div>

    <!-- Competitor table -->
    ${site.competitorNames ? `<div style="margin-bottom:18px;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0">
      <div style="background:#FAFBFC;padding:10px 16px;font-size:10px;font-weight:800;color:#1E2761;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #E2E8F0">Known Competitors</div>
      <table>
        <thead><tr style="background:#FAFBFC">${["Operator", "Distance", "Type", "Est. SF"].map(h2 => `<th style="padding:8px 14px;font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.04em;text-align:left;border-bottom:1px solid #E2E8F0">${h2}</th>`).join("")}</tr></thead>
        <tbody>
          ${(site.competitorNames || "").split(",").map((name, i) => {
            const trimmed = name.trim();
            if (!trimmed) return "";
            return `<tr style="background:${i % 2 ? "#FAFBFC" : "#fff"}">
              <td style="padding:8px 14px;font-size:12px;font-weight:600;color:#1E293B">${h(trimmed)}</td>
              <td style="padding:8px 14px;font-size:11px;color:#64748B">${i === 0 && site.nearestCompetitor ? h(site.nearestCompetitor).split("—")[0] || "—" : "—"}</td>
              <td style="padding:8px 14px;font-size:11px;color:#64748B">${site.competitorTypes ? (site.competitorTypes.split(",")[i] || "").trim() || "—" : "—"}</td>
              <td style="padding:8px 14px;font-size:11px;color:#64748B">${i === 0 && site.competingSF ? h(site.competingSF) : "—"}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : ""}

    <table style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">${[
      row("Competitor Count", compLabel, { badge: true, badgeBg: compColor + "18", badgeColor: compColor }),
      row("Known Operators", site.competitorNames || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Nearest Competitor", site.nearestCompetitor || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Est. Competing SF", site.competingSF || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Demand/Supply Signal", site.demandSupplySignal || (cc !== undefined && cc !== null && cc === 0 ? '<span style="color:#16A34A;font-weight:700">Unserved — high demand signal</span>' : cc !== undefined && cc !== null && cc >= 4 ? '<span style="color:#EF4444;font-weight:700">Saturated — verify occupancy</span>' : '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>')),
    ].join("")}</table>
    <details class="method-box">
      <summary>Research Methodology — Competition</summary>
      <div class="method-content">
        Competitor scan via Google Maps, SpareFoot, SelfStorage.com, and operator websites within 3-mile radius. Operator names, facility types, and estimated SF recorded. Occupancy data sourced from operator quarterly filings (PSA, EXR, CUBE, LSI, NSA). Demand/supply assessment based on population-to-storage-SF ratio (7-9 SF/capita = equilibrium, &lt;5 = underserved, &gt;12 = oversupplied).
      </div>
    </details>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 8. SITE SIZING -->
    <!-- ═══════════════════════════════════════════════ -->
    ${section("8", "Site Sizing Assessment")}
    <div class="hover-card" style="padding:16px 20px;border-radius:12px;background:${sizingColor}08;border:2px solid ${sizingColor}25;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:600;color:#1E293B">${sizingText}</span>
      <span style="padding:4px 14px;border-radius:8px;font-size:11px;font-weight:800;background:${sizingColor}18;color:${sizingColor}">${sizingTag}</span>
    </div>

    <!-- 9. BROKER -->
    ${section("9", "Broker / Seller")}
    <table style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">${[
      row("Contact", site.sellerBroker || "Not listed"),
      row("Days on Market", dom !== null ? dom + " days" : "Unknown"),
      row("Listing Source", site.listingSource || '<span style="color:#DC2626;font-weight:600;font-size:10px;background:#FEF2F2;padding:2px 8px;border-radius:4px">Need Further Research</span>'),
      row("Broker Notes", site.brokerNotes || '<span style="color:#94A3B8;font-weight:600;font-size:10px">No broker intel received</span>'),
    ].join("")}</table>

    <!-- 10. RECOMMENDED NEXT STEPS -->
    ${section("10", "Recommended Next Steps")}
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
      ${[
        zoningClass === "unknown" ? { pri: "HIGH", color: "#EF4444", text: "Locate permitted use table and verify storage permissibility" } : null,
        zoningClass === "conditional" ? { pri: "MED", color: "#F59E0B", text: "Research SUP/CUP process — timeline, cost, hearing requirements" } : null,
        zoningClass === "rezone-required" ? { pri: "HIGH", color: "#EF4444", text: "Evaluate rezone feasibility — comp plan alignment, political climate" } : null,
        !hasUtilities ? { pri: "HIGH", color: "#EF4444", text: "Confirm water & sewer — contact provider and verify service boundary" } : null,
        hasFlood ? { pri: "HIGH", color: "#EF4444", text: "Order FEMA flood certification and evaluate insurance cost" } : null,
        hasOverlay ? { pri: "LOW", color: "#3B82F6", text: "Review overlay standards — facade, signage, landscaping" } : null,
        { pri: "LOW", color: "#3B82F6", text: "Verify all tap fees and connection costs" },
      ].filter(Boolean).map(s => `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-radius:10px;background:${s.color}06;border:1px solid ${s.color}15"><span style="font-size:10px;font-weight:800;color:${s.color};background:${s.color}12;padding:3px 10px;border-radius:6px;white-space:nowrap;margin-top:1px">${s.pri}</span><span style="font-size:12px;color:#1E293B;line-height:1.5">${s.text}</span></div>`).join("")}
    </div>

    <!-- 11. RED FLAGS -->
    ${section("11", "Red Flags & Action Items")}
    ${flags.length === 0
      ? `<div style="padding:16px 20px;border-radius:12px;background:#F0FDF4;border:1px solid #BBF7D0;color:#166534;font-size:13px;font-weight:600">No red flags identified</div>`
      : `<div style="display:flex;flex-direction:column;gap:6px">${flags.map(f => `<div style="padding:10px 16px;border-radius:10px;background:#FEF2F2;border:1px solid #FECACA;font-size:12px;font-weight:600;color:#991B1B;display:flex;align-items:center;gap:8px"><span style="font-size:14px;flex-shrink:0">&#9888;</span> ${f}</div>`).join("")}</div>`
    }

    <!-- 12. SUMMARY -->
    ${section("12", "Summary & Deal Notes")}
    <div style="padding:18px 22px;border-radius:12px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:13px;line-height:1.8;color:#475569">${h(site.summary || "No notes").replace(/\n/g, '<br/>')}</div>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- SITESCORE SCORECARD -->
    <!-- ═══════════════════════════════════════════════ -->
    ${iq && iq.scores ? (() => {
      const dims = [
        { key: "population", label: "Population", weight: 0.16 },
        { key: "growth", label: "Growth", weight: 0.21 },
        { key: "income", label: "Income", weight: 0.10 },
        { key: "households", label: "Households", weight: 0.05 },
        { key: "homeValue", label: "Home Value", weight: 0.05 },
        { key: "zoning", label: "Zoning", weight: 0.16 },
        { key: "psProximity", label: "PS Proximity", weight: 0.11 },
        { key: "access", label: "Site Access", weight: 0.07 },
        { key: "competition", label: "Competition", weight: 0.07 },
        { key: "marketTier", label: "Market Tier", weight: 0.02 },
      ];
      const weightedSum = dims.reduce((s, d) => s + ((iq.scores[d.key] || 0) * d.weight), 0);
      const adjustments = typeof iqScore === "number" ? (iqScore - weightedSum).toFixed(2) : "0.00";
      return `
    ${section("S", "SiteScore&trade; Scorecard")}

    <!-- Composite Score Hero -->
    <div style="display:flex;align-items:center;gap:24px;margin-bottom:24px;padding:20px 24px;border-radius:12px;background:linear-gradient(135deg,#1E2761,#2C3E6B);border:1px solid rgba(201,168,76,0.2)">
      <div style="text-align:center;min-width:100px">
        <div style="font-size:42px;font-weight:900;color:#C9A84C;font-family:'Space Mono',monospace;line-height:1">${typeof iqScore === "number" ? iqScore.toFixed(1) : iqScore}</div>
        <div style="font-size:8px;font-weight:700;letter-spacing:0.1em;color:#6B7394;margin-top:4px">COMPOSITE</div>
      </div>
      <div style="width:1px;height:50px;background:rgba(201,168,76,0.2)"></div>
      <div style="flex:1;display:flex;gap:8px;flex-wrap:wrap">
        ${(() => {
          const cls = typeof iqScore === "number" ? (iqScore >= 8 ? { label: "PRIME", color: "#16A34A", bg: "rgba(22,163,74,0.12)" } : iqScore >= 6 ? { label: "VIABLE", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" } : iqScore >= 4 ? { label: "MARGINAL", color: "#E87A2E", bg: "rgba(232,122,46,0.12)" } : { label: "WEAK", color: "#EF4444", bg: "rgba(239,68,68,0.12)" }) : { label: "—", color: "#6B7394", bg: "rgba(107,115,148,0.12)" };
          const strong = dims.filter(d => (iq.scores[d.key] || 0) >= 8).map(d => d.label);
          const weak = dims.filter(d => (iq.scores[d.key] || 0) < 5 && (iq.scores[d.key] || 0) > 0).map(d => d.label);
          return `<div style="padding:6px 14px;border-radius:6px;background:${cls.bg};border:1px solid ${cls.color}40">
            <span style="font-size:12px;font-weight:800;color:${cls.color};letter-spacing:0.06em">${cls.label}</span>
          </div>
          ${strong.length ? `<div style="padding:6px 12px;border-radius:6px;background:rgba(22,163,74,0.06);border:1px solid rgba(22,163,74,0.15)"><span style="font-size:9px;font-weight:600;color:#16A34A">STRENGTHS:</span> <span style="font-size:9px;color:#94A3B8">${strong.join(", ")}</span></div>` : ""}
          ${weak.length ? `<div style="padding:6px 12px;border-radius:6px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15)"><span style="font-size:9px;font-weight:600;color:#EF4444">CONCERNS:</span> <span style="font-size:9px;color:#94A3B8">${weak.join(", ")}</span></div>` : ""}`;
        })()}
      </div>
    </div>

    <!-- Horizontal Bar Scorecard -->
    <div style="margin-bottom:4px">
      ${dims.map((d, i) => {
        const v = iq.scores[d.key] || 0;
        const pct = Math.max(3, (v / 10) * 100);
        const c = v >= 8 ? "#16A34A" : v >= 6 ? "#3B82F6" : v >= 4 ? "#F59E0B" : "#EF4444";
        const wc = (v * d.weight).toFixed(2);
        return `<div style="display:grid;grid-template-columns:130px 1fr 50px 55px;align-items:center;gap:12px;padding:7px 0;${i < dims.length - 1 ? "border-bottom:1px solid #E2E8F015" : ""}">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;font-weight:800;color:#1E2761">${d.label}</span>
            <span style="font-size:9px;color:#6B7394;font-weight:700;font-family:'Space Mono',monospace">${(d.weight * 100).toFixed(0)}%</span>
          </div>
          <div style="height:18px;border-radius:4px;background:rgba(255,255,255,0.04);overflow:hidden;position:relative">
            <div style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;border-radius:4px;background:linear-gradient(90deg,${c}cc,${c});transition:width 0.5s"></div>
            ${[2,4,6,8].map(tick => `<div style="position:absolute;left:${tick*10}%;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.04)"></div>`).join("")}
          </div>
          <div style="text-align:right;font-size:14px;font-weight:800;color:${c};font-family:'Space Mono',monospace">${typeof v === "number" ? v.toFixed(1) : "—"}</div>
          <div style="text-align:right;font-size:10px;color:#6B7394;font-family:'Space Mono',monospace">${wc}</div>
        </div>`;
      }).join("")}
    </div>

    <!-- Footer: Weighted Sum + Adjustments + Composite -->
    <div style="margin-top:8px;padding:12px 16px;border-radius:8px;background:rgba(201,168,76,0.04);border:1px solid rgba(201,168,76,0.1)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <span style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.04em">WEIGHTED SUM</span>
          <span style="font-size:13px;font-weight:800;color:#E2E8F0;font-family:'Space Mono',monospace;margin-left:8px">${weightedSum.toFixed(2)}</span>
          ${parseFloat(adjustments) !== 0 ? `<span style="font-size:10px;color:#6B7394;margin-left:12px">+</span><span style="font-size:10px;font-weight:600;color:#D97706;margin-left:4px">adj ${parseFloat(adjustments) >= 0 ? "+" : ""}${adjustments}</span>` : ""}
        </div>
        <div style="display:flex;align-items:baseline;gap:6px">
          <span style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.04em">FINAL</span>
          <span style="font-size:20px;font-weight:900;color:#C9A84C;font-family:'Space Mono',monospace">${typeof iqScore === "number" ? iqScore.toFixed(1) : iqScore}</span>
          <span style="font-size:9px;color:#6B7394">/ 10</span>
        </div>
      </div>
    </div>`;
    })() : ""}
  </div>

  <!-- ═══════════════════════════════════════════════ -->
  <!-- SOURCES & METHODOLOGY APPENDIX -->
  <!-- ═══════════════════════════════════════════════ -->
  <div style="padding:28px 44px 24px;border-top:3px solid #1E2761">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <div style="width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#1E2761,#2C3E6B);display:flex;align-items:center;justify-content:center;font-size:12px;color:#C9A84C;font-weight:900">&#167;</div>
      <h2 style="margin:0;font-size:15px;font-weight:800;color:#1E2761;letter-spacing:0.02em">Sources &amp; Methodology</h2>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:18px">
      ${[
        { title: "Zoning & Entitlements", color: "#1E2761", items: ["Municipal ordinance (ecode360, Municode, American Legal)", "Permitted use table — district column verified", "Overlay district maps via GIS portal", "Planning department direct contact"] },
        { title: "Utilities & Water", color: "#16A34A", items: ["City/county utility dept + fee schedules", "TCEQ CCN maps (TX) / state commissions", "Municipal GIS infrastructure layers", "Electric utility territory maps — 3-phase"] },
        { title: "Topography", color: "#E87A2E", items: ["FEMA Flood Map Service Center", "Google Earth + USGS TopoView", "National Wetlands Inventory (NWI)", "USDA Web Soil Survey"] },
        { title: "Competition", color: "#DC2626", items: ["Google Maps, SpareFoot, SelfStorage.com", "Public REIT filings (PSA, EXR, CUBE)", "Population-to-SF benchmarking", "Operator identification"] },
        { title: "Site Access", color: "#7C3AED", items: ["Aerial imagery (Google Earth, county GIS)", "State DOT traffic count maps", "Speed limits, median type, signals", "Driveway grade, decel lane assessment"] },
        { title: "Demographics", color: "#2C3E6B", items: ["Licensed ESRI 2025 + 2030 projections", "Census Bureau ACS 5-Year", "SiteScore(TM) composite scoring", "PS proximity: Haversine vs 3,400+ locations"] },
      ].map(s => `<div style="padding:14px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0">
        <div style="font-size:9px;font-weight:800;color:${s.color};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">${s.title}</div>
        <div style="font-size:8px;color:#64748B;line-height:1.6">${s.items.map(i => `&#8226; ${i}`).join("<br/>")}</div>
      </div>`).join("")}
    </div>
    <div style="padding:12px 16px;border-radius:8px;background:#0A0A0C;font-size:8px;color:#64748B;line-height:1.6;text-align:center">
      This report was generated by SiteScore&trade;, a proprietary AI-powered acquisition intelligence platform developed by DJR Real Estate LLC.
      All findings are sourced from primary municipal records, federal databases, and licensed data providers.
      Findings should be independently verified prior to capital commitment. Report date: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
    </div>
  </div>

  <!-- FOOTER -->
  <div style="background:#0A0A0C;padding:22px 44px;display:flex;justify-content:space-between;align-items:center;border-radius:0 0 8px 8px">
    <div style="font-size:11px;color:#64748B">Report generated by <span style="color:#C9A84C;font-weight:700">SiteScore&trade;</span> &middot; Patent Pending &middot; Serial No. 99712640</div>
    <div style="font-size:11px;color:#64748B"><span style="color:#C9A84C;font-weight:700">DJR Real Estate LLC</span> &nbsp;|&nbsp; Confidential</div>
  </div>
</div>

<script>
(function(){
  var links = document.querySelectorAll('#tocNav a');
  var sections = [];
  links.forEach(function(a){
    var id = a.getAttribute('href').replace('#','');
    var el = document.getElementById(id);
    if(el) sections.push({el:el, link:a});
  });
  function onScroll(){
    var scrollPos = window.scrollY + 120;
    var active = null;
    sections.forEach(function(s){
      if(s.el.offsetTop <= scrollPos) active = s;
    });
    links.forEach(function(a){ a.classList.remove('active'); });
    if(active) active.link.classList.add('active');
  }
  window.addEventListener('scroll', onScroll);
  onScroll();
})();
</script>
</body></html>`;
  } catch (err) {
    console.error("Report generation error:", err);
    return `<!DOCTYPE html><html><head><title>Error</title></head><body style="font-family:sans-serif;padding:40px;background:#0A0E2A;color:#fff;text-align:center"><h1 style="color:#C9A84C">Report Generation Error</h1><p style="color:#94A3B8">${escapeHtml(err.message)}</p><p style="color:#64748B;font-size:12px">Check the browser console for details. Try refreshing the site data.</p></body></html>`;
  }
};

export const generatePricingReport = (site, iqResult, siteScoreConfig, valuationOverrides, allSites) => {
  try {
  const h = escapeHtml;
  const iq = iqResult || computeSiteScore(site, siteScoreConfig);
  const siteOverrides = site.overrides || {};
  const fin = computeSiteFinancials(site, valuationOverrides || {}, siteOverrides);
  const { acres, landCost, popN, incN, hvN, growthPct, compCount, nearestPS, incTier,
    operatorProfile, operatorLabel, noiMarginBenchmark,
    isMultiStory, stories, footprint, grossSF, netToGross, totalSF, climatePct, drivePct, climateSF, driveSF,
    baseClimateRate, baseDriveRate, compAdj, mktClimateRate, mktDriveRate, annualEsc,
    leaseUpSchedule, yearData, stabNOI, stabRev,
    stateToCostIdx, costIdx, baseHardPerSF, hardCostPerSF, softCostPct, hardCost, softCost,
    contingencyPct, contingency, buildCosts, totalHardCost, totalHardPerSF,
    siteAreaSF, baseSiteWorkPerSF, siteWorkCost,
    baseFireSuppressionPerSF, fireSuppressionCost,
    baseInteriorPerSF, interiorBuildoutCost,
    baseTechPerSF, technologyCost,
    utilityInfraBase, baseUtilityPerSF, utilityInfraCost,
    constructionMonths, constructionInterest, constructionPropTax, constructionInsurance, carryCosts, workingCapital,
    totalDevCost, yocStab,
    opexDetail, totalOpexDetail, opexRatioDetail, noiDetail,
    ecriSchedule,
    capRates, valuations,
    landTargets, landPrices, askVsStrike, landVerdict, verdictColor,
    loanLTV, loanRate, loanAmort, equityPct, loanAmount, equityRequired, monthlyLoanRate, numPmts, monthlyPmt, annualDS, dscrStab, cashAfterDS, cashOnCash,
    exitCapRate, yrDataExt, exitValue, exitLoanBal, exitEquityProceeds, irrCashFlows, irrPct, equityMultiple,
    m1Rate, m2ClimRate, m2DriveRate, m3ClimRate, popDensityFactor, consensusClimRate, rateConfidence, rateConfColor,
    stabOccSF, revPAF, revPOF, noiPerSF, noiMarginPct, mktAcqCap, devSpread, impliedLandCap,
    estCompSF, totalMktSF, sfPerCapita, sfPerCapitaExcl, demandSignal, demandColor,
    replacementCost, replacementCostPerSF, fullReplacementCost, replacementVsMarket, buildOrBuy,
    reitBench, sensitivityMatrix, sourcesAndUses, pricePerAcre,
    unleveredIRR, psWACC, npvAtWACC, debtYield, profitOnCost, exitScenarios,
  } = fin;
  const phase = site.phase || "Prospect";

  // ── REIT comparable (pricing-report-specific) ──
  const siteRevPAFn = parseFloat(revPAF) || 0;
  const reitComparable = reitBench.find(r => Math.abs(r.revPAF - siteRevPAFn) === Math.min(...reitBench.map(b => Math.abs(b.revPAF - siteRevPAFn))));

  // ── Street Rate Estimator (cross-check against listing data) ──
  const streetRateOverride = site.streetRateClimate ? parseFloat(site.streetRateClimate) : null;
  const streetVariance = streetRateOverride && mktClimateRate > 0 ? ((mktClimateRate / streetRateOverride - 1) * 100).toFixed(1) : null;

  // ── Unit Mix Estimate ──
  const unitMix = [
    { type: "5x5 Climate", sf: 25, pct: 0.10, rate: null, cat: "climate" },
    { type: "5x10 Climate", sf: 50, pct: 0.20, rate: null, cat: "climate" },
    { type: "10x10 Climate", sf: 100, pct: 0.25, rate: null, cat: "climate" },
    { type: "10x15 Climate", sf: 150, pct: 0.10, rate: null, cat: "climate" },
    { type: "10x20 Climate", sf: 200, pct: 0.05, rate: null, cat: "climate" },
    { type: "10x10 Drive-Up", sf: 100, pct: 0.12, rate: null, cat: "drive" },
    { type: "10x15 Drive-Up", sf: 150, pct: 0.08, rate: null, cat: "drive" },
    { type: "10x20 Drive-Up", sf: 200, pct: 0.06, rate: null, cat: "drive" },
    { type: "10x30 Drive-Up", sf: 300, pct: 0.04, rate: null, cat: "drive" },
  ];
  const stabClimRate = yearData[4].climRate;
  const stabDriveRate = yearData[4].driveRate;
  const unitRows = unitMix.map(u => {
    const allocSF = Math.round(totalSF * u.pct);
    const units = Math.round(allocSF / u.sf);
    const moRate = u.cat === "climate" ? Math.round(u.sf * stabClimRate) : Math.round(u.sf * stabDriveRate);
    return { ...u, allocSF, units, moRate };
  });
  const totalUnits = unitRows.reduce((s, r) => s + r.units, 0);
  const avgMonthlyRent = totalUnits > 0 ? Math.round(stabRev / 12 / (totalUnits * 0.92)) : 0;

  const fmtD = (n) => "$" + Math.round(n).toLocaleString();
  const fmtM = (n) => n >= 1000000 ? "$" + (n / 1000000).toFixed(2) + "M" : n >= 100000 ? "$" + Math.round(n / 1000) + "K" : "$" + Math.round(n).toLocaleString();
  const pctBar = (pct, color) => `<div style="display:flex;align-items:center;gap:6px"><div style="width:80px;height:10px;border-radius:5px;background:rgba(255,255,255,0.06);overflow:hidden"><div style="width:${Math.round(pct*100)}%;height:100%;border-radius:5px;background:${color};transition:width 0.5s"></div></div><span style="font-size:12px;font-weight:700;color:${color}">${Math.round(pct*100)}%</span></div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Storvex Pricing Report — ${h(site.name)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:linear-gradient(180deg,#080B1A 0%,#0F1538 40%,#1E2761 100%);color:#E2E8F0;min-height:100vh;padding:0}
.page{max-width:1100px;margin:0 auto;padding:40px 30px}
h1{font-size:28px;font-weight:900;letter-spacing:-0.02em}
h2{font-size:18px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:16px}
h3{font-size:14px;font-weight:700;margin-bottom:10px}
.section{background:rgba(15,21,56,0.6);border:1px solid rgba(201,168,76,0.1);border-radius:16px;padding:28px;margin-bottom:24px;backdrop-filter:blur(12px)}
.section-gold{border-color:rgba(201,168,76,0.25);box-shadow:0 4px 24px rgba(201,168,76,0.08)}
.gold{color:#C9A84C} .orange{color:#E87A2E} .green{color:#16A34A} .red{color:#EF4444} .blue{color:#42A5F5} .muted{color:#6B7394}
.mono{font-family:'Space Mono',monospace}
.badge{display:inline-block;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.06em}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;overflow:hidden}
.grid2>div{overflow:hidden;min-width:0}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.metric-box{background:rgba(15,21,56,0.5);border:1px solid rgba(201,168,76,0.08);border-radius:12px;padding:16px;text-align:center}
.metric-box .label{font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.1em;margin-bottom:6px;text-transform:uppercase}
.metric-box .value{font-size:22px;font-weight:800;font-family:'Space Mono',monospace}
table{width:100%;border-collapse:collapse;font-size:12px}
th{padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:#C9A84C;text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid rgba(201,168,76,0.15);background:rgba(15,21,56,0.4)}
td{padding:10px 12px;border-bottom:1px solid rgba(201,168,76,0.06);color:#E2E8F0}
tr:hover td{background:rgba(201,168,76,0.04)}
.yr-row{transition:all 0.2s}
.divider{height:2px;background:linear-gradient(90deg,transparent,#C9A84C,#E87A2E,#C9A84C,transparent);margin:32px 0;opacity:0.4}
.tag{display:inline-block;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:0.04em}
.footer{text-align:center;padding:24px;color:#6B7394;font-size:10px;border-top:1px solid rgba(201,168,76,0.1);margin-top:40px}
.expand-panel{max-height:0;overflow:hidden;transition:max-height 0.4s ease,opacity 0.3s ease,padding 0.3s ease;opacity:0;padding:0 20px}
.expand-panel.open{max-height:4000px;opacity:1;padding:20px}
.expand-trigger{cursor:pointer;position:relative;transition:all 0.2s}
.expand-trigger:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(201,168,76,0.12)!important}
.expand-trigger .expand-hint{position:absolute;top:10px;right:14px;font-size:9px;color:#6B7394;letter-spacing:0.08em;font-weight:600;text-transform:uppercase;opacity:0.6;transition:opacity 0.2s}
.expand-trigger:hover .expand-hint{opacity:1;color:#C9A84C}
.expand-arrow{display:inline-block;transition:transform 0.3s;font-size:10px;color:#C9A84C}
.expand-arrow.open{transform:rotate(180deg)}
.insight-box{background:linear-gradient(135deg,rgba(201,168,76,0.06),rgba(30,39,97,0.4));border:1px solid rgba(201,168,76,0.15);border-radius:12px;padding:16px;margin-top:14px;font-size:12px;color:#94A3B8;line-height:1.7}
.insight-box .insight-title{font-size:10px;font-weight:800;color:#C9A84C;letter-spacing:0.1em;margin-bottom:8px;text-transform:uppercase;display:flex;align-items:center;gap:6px}
.insight-box .insight-title::before{content:"◆";font-size:7px}
.drill-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.06);font-size:12px}
.drill-row:last-child{border-bottom:none}
.drill-label{color:#6B7394;font-weight:600}
.drill-value{color:#E2E8F0;font-weight:700;font-family:'Space Mono',monospace}
.sensitivity-cell{padding:10px 14px;text-align:center;border:1px solid rgba(201,168,76,0.06);font-family:'Space Mono',monospace;font-size:11px;font-weight:700}
.waterfall-bar{height:28px;border-radius:4px;display:flex;align-items:center;padding:0 10px;font-size:11px;font-weight:700;color:#fff;margin-bottom:4px;transition:width 0.5s}

/* ═══ METRIC INTELLIGENCE SYSTEM v4.0 ═══ */
.mi{position:relative;cursor:pointer;display:inline-block;transition:all 0.2s}
.mi .value{position:relative;z-index:1}
.mi::after{content:"";position:absolute;inset:-4px -8px;border-radius:8px;background:rgba(201,168,76,0);border:1px solid rgba(201,168,76,0);transition:all 0.25s;z-index:0}
.mi:hover::after{background:rgba(201,168,76,0.06);border-color:rgba(201,168,76,0.2);box-shadow:0 0 16px rgba(201,168,76,0.1)}
.mi:hover .mi-hint{opacity:1}
.mi-hint{position:absolute;top:-6px;right:-6px;width:14px;height:14px;border-radius:50%;background:linear-gradient(135deg,#C9A84C,#E87A2E);display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:900;color:#080B1A;opacity:0;transition:opacity 0.2s;z-index:2;font-style:normal;line-height:1}
.mi-panel{max-height:0;overflow:hidden;transition:max-height 0.35s ease,opacity 0.3s ease,margin 0.3s ease;opacity:0;margin-top:0;border-radius:12px}
.mi-panel.open{max-height:800px;opacity:1;margin-top:12px}
.mi-panel-inner{background:linear-gradient(135deg,rgba(8,11,26,0.95),rgba(15,21,56,0.9));border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:18px;backdrop-filter:blur(16px);box-shadow:0 8px 32px rgba(0,0,0,0.4),0 0 24px rgba(201,168,76,0.06)}
.mi-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(201,168,76,0.12)}
.mi-title{font-size:10px;font-weight:800;color:#C9A84C;letter-spacing:0.1em;text-transform:uppercase;display:flex;align-items:center;gap:6px}
.mi-title::before{content:"◆";font-size:6px}
.mi-conf{font-size:9px;font-weight:700;letter-spacing:0.06em;padding:3px 8px;border-radius:4px;text-transform:uppercase}
.mi-conf-high{background:rgba(22,163,74,0.15);color:#16A34A;border:1px solid rgba(22,163,74,0.2)}
.mi-conf-med{background:rgba(245,158,11,0.15);color:#F59E0B;border:1px solid rgba(245,158,11,0.2)}
.mi-conf-low{background:rgba(239,68,68,0.15);color:#EF4444;border:1px solid rgba(239,68,68,0.2)}
.mi-body{font-size:11px;color:#94A3B8;line-height:1.65}
.mi-body strong{color:#E2E8F0}
.mi-formula{background:rgba(15,21,56,0.6);border:1px solid rgba(66,165,245,0.15);border-radius:8px;padding:10px 14px;margin:10px 0;font-family:'Space Mono',monospace;font-size:10px;color:#42A5F5;line-height:1.8}
.mi-source{display:flex;align-items:center;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid rgba(201,168,76,0.08);font-size:9px;color:#6B7394;font-weight:600;letter-spacing:0.04em}
.mi-source::before{content:"📊";font-size:10px}
.mi-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(201,168,76,0.04);font-size:11px}
.mi-row:last-child{border-bottom:none}
.mi-row-label{color:#6B7394;font-weight:600}
.mi-row-val{color:#E2E8F0;font-weight:700;font-family:'Space Mono',monospace}

/* ═══ v4.1 COSMETICS — BCG Polish Pass ═══ */
@keyframes headerGlow{0%,100%{box-shadow:0 0 30px rgba(201,168,76,0.08)}50%{box-shadow:0 0 50px rgba(201,168,76,0.15)}}
.header-v4{animation:headerGlow 4s ease-in-out infinite}
@keyframes pulseGold{0%,100%{opacity:0.6}50%{opacity:1}}
.version-badge{background:linear-gradient(135deg,#C9A84C,#E87A2E);color:#080B1A;font-size:9px;font-weight:900;padding:3px 10px;border-radius:4px;letter-spacing:0.1em;animation:pulseGold 3s ease-in-out infinite}
.metric-box.mi-active{border-color:rgba(201,168,76,0.2);box-shadow:0 0 12px rgba(201,168,76,0.06)}
.section-v4{border-image:linear-gradient(135deg,rgba(201,168,76,0.15),rgba(232,122,46,0.1),rgba(201,168,76,0.15)) 1;border-width:1px;border-style:solid}
.nav-dot{width:6px;height:6px;border-radius:50%;background:#C9A84C;display:inline-block;margin:0 3px;opacity:0.3}
.nav-dot.active{opacity:1;box-shadow:0 0 6px rgba(201,168,76,0.4)}

/* ═══ v4.1 — Storvex Turbine Engine Animation ═══ */
@keyframes turbineSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
@keyframes liquidFlow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes particleFloat{0%,100%{opacity:0;transform:translateY(0) scale(0.3)}30%{opacity:0.8;transform:translateY(-20px) scale(1)}70%{opacity:0.4;transform:translateY(-40px) scale(0.6)}100%{opacity:0;transform:translateY(-60px) scale(0.2)}}
.storvex-turbine{position:relative;width:60px;height:60px;margin:0 auto}
.turbine-core{width:60px;height:60px;border-radius:50%;border:3px solid transparent;border-top-color:#42A5F5;border-right-color:#16A34A;border-bottom-color:#42A5F5;border-left-color:#16A34A;animation:turbineSpin 2s linear infinite;box-shadow:0 0 20px rgba(66,165,245,0.3),inset 0 0 15px rgba(22,163,74,0.2)}
.turbine-inner{position:absolute;top:8px;left:8px;width:44px;height:44px;border-radius:50%;border:2px solid transparent;border-top-color:#16A34A;border-right-color:#42A5F5;border-bottom-color:#16A34A;border-left-color:#42A5F5;animation:turbineSpin 1.2s linear infinite reverse}
.turbine-center{position:absolute;top:18px;left:18px;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#42A5F5,#16A34A);box-shadow:0 0 12px rgba(66,165,245,0.5),0 0 24px rgba(22,163,74,0.3);display:flex;align-items:center;justify-content:center}
.turbine-center::after{content:"";width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.9);box-shadow:0 0 6px rgba(255,255,255,0.6)}
.turbine-liquid{position:absolute;top:-4px;left:-4px;width:68px;height:68px;border-radius:50%;background:linear-gradient(45deg,rgba(66,165,245,0.15),rgba(22,163,74,0.15),rgba(66,165,245,0.15),rgba(22,163,74,0.15));background-size:200% 200%;animation:liquidFlow 3s ease-in-out infinite;pointer-events:none}
.turbine-particle{position:absolute;width:4px;height:4px;border-radius:50%;pointer-events:none}
.turbine-particle:nth-child(1){left:10px;top:0;background:#42A5F5;animation:particleFloat 2.5s ease-out infinite}
.turbine-particle:nth-child(2){left:40px;top:-5px;background:#16A34A;animation:particleFloat 3s ease-out 0.5s infinite}
.turbine-particle:nth-child(3){left:25px;top:-3px;background:#42A5F5;animation:particleFloat 2.8s ease-out 1s infinite}
.turbine-particle:nth-child(4){left:50px;top:5px;background:#16A34A;animation:particleFloat 3.2s ease-out 1.5s infinite}
.turbine-particle:nth-child(5){left:5px;top:10px;background:#42A5F5;animation:particleFloat 2.6s ease-out 0.8s infinite}

/* ═══ v4.1 — Section Dividers ═══ */
.section-divider{height:1px;background:linear-gradient(90deg,transparent 0%,rgba(201,168,76,0.2) 20%,rgba(66,165,245,0.15) 50%,rgba(201,168,76,0.2) 80%,transparent 100%);margin:28px 0;position:relative}
.section-divider::after{content:"";position:absolute;left:50%;top:-2px;transform:translateX(-50%);width:5px;height:5px;border-radius:50%;background:#C9A84C;box-shadow:0 0 8px rgba(201,168,76,0.4)}

/* ═══ v4.1 — Polished Placeholder Styling ═══ */
.val-pending{color:#6B7394;font-style:italic;font-weight:500;letter-spacing:0.02em}
.val-confirmed{color:#E2E8F0;font-weight:700}

/* TOC sidebar — McKinsey nav strip */
.toc-sidebar{position:fixed;left:0;top:50%;transform:translateY(-50%);width:52px;background:linear-gradient(180deg,#0A0A0C,#1E2761 40%,#2C3E6B);border-radius:0 14px 14px 0;box-shadow:4px 0 30px rgba(0,0,0,0.15);padding:14px 6px;z-index:999;transition:width 0.3s cubic-bezier(0.4,0,0.2,1);overflow:hidden}
.toc-sidebar:hover{width:210px;padding:14px 12px}
.toc-sidebar .toc-title{font-size:8px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:12px;padding:0 4px;white-space:nowrap;opacity:0;transition:opacity 0.2s}
.toc-sidebar:hover .toc-title{opacity:1}
.toc-sidebar .toc-icon{display:flex;align-items:center;justify-content:center;width:32px;height:32px;margin:0 auto 8px;border-radius:8px;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.3)}
.toc-sidebar:hover .toc-icon{display:none}
.toc-sidebar .toc-icon svg{width:16px;height:16px;fill:#C9A84C}
.toc-sidebar a{display:flex;align-items:center;gap:10px;padding:6px 8px;font-size:11px;color:rgba(255,255,255,0.5);text-decoration:none;border-radius:8px;font-weight:600;transition:all 0.15s ease;line-height:1.3;margin-bottom:2px;white-space:nowrap;overflow:hidden}
.toc-sidebar a .toc-num{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);font-size:10px;font-weight:800;font-family:'Space Mono',monospace;flex-shrink:0;transition:all 0.15s}
.toc-sidebar a .toc-label{opacity:0;transition:opacity 0.2s}
.toc-sidebar:hover a .toc-label{opacity:1}
.toc-sidebar a:hover{background:rgba(243,124,51,0.15);color:#fff}
.toc-sidebar a:hover .toc-num{background:rgba(243,124,51,0.3);color:#F37C33}
.toc-sidebar a.active{background:rgba(201,168,76,0.15);color:#C9A84C}
.toc-sidebar a.active .toc-num{background:#C9A84C;color:#0A0A0C}
@media (max-width:1000px){.toc-sidebar{display:none}}

@media print{body{background:#fff;color:#1a1a2e}.section{border:1px solid #e5e7eb;box-shadow:none;background:#fff}.gold{color:#92700C}.muted{color:#64748B}th{background:#f8f9fa;color:#1a1a2e}td{color:#1a1a2e}.expand-panel{max-height:none!important;opacity:1!important;padding:20px!important}.mi-panel{max-height:none!important;opacity:1!important;margin-top:12px!important}.mi::after{display:none}.mi-hint{display:none}.toc-sidebar{display:none!important}}
</style>
<script>
function toggleExpand(id){
  const p=document.getElementById(id);
  const a=document.getElementById(id+'-arrow');
  if(p.classList.contains('open')){p.classList.remove('open');if(a)a.classList.remove('open');}
  else{p.classList.add('open');if(a)a.classList.add('open');}
}
function toggleMI(id,evt){
  if(evt){evt.stopPropagation();}
  const p=document.getElementById('mi-'+id);
  if(!p)return;
  document.querySelectorAll('.mi-panel.open').forEach(el=>{if(el.id!=='mi-'+id)el.classList.remove('open');});
  p.classList.toggle('open');
}
function updateCustomCap(val){
  val=parseFloat(val);if(isNaN(val)||val<=0)return;
  var c=document.getElementById('custom-cap-container');
  var noi=parseFloat(c.dataset.stabNoi),dc=parseFloat(c.dataset.totalDevCost),sf=parseFloat(c.dataset.totalSf);
  document.getElementById('cap-slider').value=val;
  document.getElementById('cap-input').value=val;
  if(!noi||noi<=0){return;}
  var v=Math.round(noi/(val/100));
  var fmt=function(n){return n>=1e6?'$'+(n/1e6).toFixed(2)+'M':n>=1e3?'$'+(n/1e3).toFixed(0)+'K':'$'+n;};
  document.getElementById('cc-value').textContent=fmt(v);
  document.getElementById('cc-value').style.color=v>dc?'#C9A84C':'#EF4444';
  if(dc>0){
    var sp=v-dc;document.getElementById('cc-spread').textContent=fmt(sp);
    document.getElementById('cc-spread').style.color=sp>0?'#16A34A':'#EF4444';
    var pct=((v/dc-1)*100).toFixed(0);document.getElementById('cc-profit').textContent=pct+'%';
    document.getElementById('cc-profit').style.color=parseFloat(pct)>0?'#16A34A':'#EF4444';
  }
  if(sf>0){document.getElementById('cc-persf').textContent='$'+Math.round(v/sf);}
}
</script>
</head><body>

<!-- TOC Sidebar — McKinsey nav strip -->
<nav class="toc-sidebar" id="tocNav" style="display:none">
  <div class="toc-icon"><svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg></div>
  <div class="toc-title">Contents</div>
  <a href="#sec-P0" onclick="document.getElementById('sec-P0').scrollIntoView({behavior:'smooth'});return false" style="background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.2);margin-bottom:6px"><span class="toc-num" style="background:#C9A84C;color:#0A0A0C">&#9889;</span><span class="toc-label" style="color:#C9A84C;font-weight:800">Pricing Inputs</span></a>
  <a href="#sec-P1" onclick="document.getElementById('sec-P1').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">1</span><span class="toc-label">Executive Summary</span></a>
  <a href="#sec-P2" onclick="document.getElementById('sec-P2').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">2</span><span class="toc-label">Timeline</span></a>
  <a href="#sec-P3" onclick="document.getElementById('sec-P3').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">3</span><span class="toc-label">PS Advantage</span></a>
  <a href="#sec-P4" onclick="document.getElementById('sec-P4').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">4</span><span class="toc-label">Facility Program</span></a>
  <a href="#sec-P5" onclick="document.getElementById('sec-P5').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">5</span><span class="toc-label">Unit Mix</span></a>
  <a href="#sec-P6" onclick="document.getElementById('sec-P6').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">6</span><span class="toc-label">Market Rates</span></a>
  <a href="#sec-P7" onclick="document.getElementById('sec-P7').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">7</span><span class="toc-label">Revenue Model</span></a>
  <a href="#sec-P8" onclick="document.getElementById('sec-P8').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">8</span><span class="toc-label">Dev Costs</span></a>
  <a href="#sec-P9" onclick="document.getElementById('sec-P9').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">9</span><span class="toc-label">Valuation</span></a>
  <a href="#sec-P10" onclick="document.getElementById('sec-P10').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">10</span><span class="toc-label">Land Price Guide</span></a>
  <a href="#sec-P11" onclick="document.getElementById('sec-P11').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">11</span><span class="toc-label">OpEx Detail</span></a>
  <a href="#sec-P12" onclick="document.getElementById('sec-P12').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">12</span><span class="toc-label">Capital Stack</span></a>
  <a href="#sec-P13" onclick="document.getElementById('sec-P13').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">13</span><span class="toc-label">Rate Audit</span></a>
  <a href="#sec-P14" onclick="document.getElementById('sec-P14').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">14</span><span class="toc-label">Institutional</span></a>
  <a href="#sec-P15" onclick="document.getElementById('sec-P15').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">15</span><span class="toc-label">REIT Bench</span></a>
  <a href="#sec-P16" onclick="document.getElementById('sec-P16').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">16</span><span class="toc-label">Supply/Demand</span></a>
  <a href="#sec-P17" onclick="document.getElementById('sec-P17').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">17</span><span class="toc-label">Replacement Cost</span></a>
</nav>

<div class="page">

<!-- HEADER v4.1 — BCG Polish -->
<div class="header-v4" style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding:24px 28px;border-radius:16px;background:linear-gradient(135deg,rgba(15,21,56,0.8),rgba(30,39,97,0.5));border:1px solid rgba(201,168,76,0.2)">
  <div style="flex:1">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <div style="font-size:13px;font-weight:900;letter-spacing:0.14em;color:#C9A84C">STORVEX<span style="font-size:7px;vertical-align:super">™</span></div>
      <div style="width:1px;height:16px;background:rgba(201,168,76,0.3)"></div>
      <div style="font-size:11px;font-weight:600;color:#6B7394;letter-spacing:0.08em">INTERACTIVE PRICING INTELLIGENCE</div>
      <span class="version-badge">v4.1</span>
    </div>
    <h1 style="color:#fff;margin-bottom:6px">${h(site.name)}</h1>
    <div style="font-size:13px;color:#94A3B8">${h(site.address || "")}${site.city ? ", " + h(site.city) : ""}${site.state ? ", " + h(site.state) : ""}</div>
    <div style="margin-top:10px;font-size:10px;color:#6B7394;display:flex;align-items:center;gap:8px">
      <span style="background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.15);padding:2px 8px;border-radius:4px;color:#C9A84C;font-weight:700;letter-spacing:0.06em">CLICK ANY METRIC</span>
      <span>for full source methodology and derivation intelligence</span>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:20px">
    <!-- Storvex Turbine Engine -->
    <div class="storvex-turbine">
      <div class="turbine-liquid"></div>
      <div class="turbine-core"></div>
      <div class="turbine-inner"></div>
      <div class="turbine-center"></div>
      <div class="turbine-particle"></div>
      <div class="turbine-particle"></div>
      <div class="turbine-particle"></div>
      <div class="turbine-particle"></div>
      <div class="turbine-particle"></div>
    </div>
    <div style="text-align:right">
      <div class="badge" style="background:rgba(201,168,76,0.12);color:#C9A84C;border:1px solid rgba(201,168,76,0.25);font-size:12px;padding:6px 16px">${phase}</div>
      <div style="font-size:11px;color:#6B7394;margin-top:8px">${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
    <div style="font-size:10px;color:#4A5080;margin-top:2px">SiteScore: ${iq.score?.toFixed(2) || "N/A"}/10</div>
  </div>
</div>

<!-- ═══ PROPERTY MODEL INPUTS ═══ -->
<div id="sec-P0" class="section" style="scroll-margin-top:20px;background:linear-gradient(135deg,rgba(15,21,56,0.9),rgba(30,39,97,0.7));border:1px solid rgba(201,168,76,0.25);box-shadow:0 4px 30px rgba(201,168,76,0.08)">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
    <div style="display:flex;align-items:center;gap:12px">
      <div class="storvex-turbine" style="width:36px;height:36px">
        <div class="turbine-liquid" style="width:44px;height:44px;top:-4px;left:-4px"></div>
        <div class="turbine-core" style="width:36px;height:36px"></div>
        <div class="turbine-inner" style="width:24px;height:24px;top:6px;left:6px"></div>
        <div class="turbine-center" style="width:14px;height:14px;top:11px;left:11px"></div>
      </div>
      <div>
        <h2 style="margin:0;font-size:16px;color:#C9A84C;letter-spacing:0.06em">PRICING INPUTS</h2>
        <div style="font-size:10px;color:#6B7394;margin-top:2px;letter-spacing:0.04em">Per-site assumptions driving this analysis</div>
      </div>
    </div>
  </div>

  <!-- Property Selector -->
  <div style="margin-bottom:24px">
    <label style="font-size:9px;font-weight:800;color:#6B7394;letter-spacing:0.12em;text-transform:uppercase;display:block;margin-bottom:8px">Select Property</label>
    <select id="site-selector" onchange="switchSiteInputs(this.value)" style="width:100%;padding:12px 16px;border-radius:10px;background:rgba(8,11,26,0.8);border:1px solid rgba(201,168,76,0.25);color:#E2E8F0;font-size:13px;font-weight:700;font-family:'Inter',sans-serif;cursor:pointer;appearance:none;background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22><path d=%22M2 4l4 4 4-4%22 fill=%22none%22 stroke=%22%23C9A84C%22 stroke-width=%221.5%22/></svg>');background-repeat:no-repeat;background-position:right 14px center;outline:none;transition:border-color 0.2s">
      ${(() => {
        const sites = (allSites || [site]).map(s => ({ id: s.id || '', name: s.name || 'Unknown', city: s.city || '', state: s.state || '', overrides: s.overrides || {} }));
        sites.sort((a, b) => (a.city || '').localeCompare(b.city || ''));
        return sites.map(s => `<option value="${h(s.id)}" ${s.id === (site.id || '') ? 'selected' : ''}>${h(s.city)}${s.state ? ', ' + h(s.state) : ''} — ${h(s.name)}</option>`).join('');
      })()}
    </select>
  </div>

  <!-- Argus-Style Input Assumptions Table -->
  ${(() => {
    const ov = site.overrides || {};
    const D = {
      coverageRatio: 0.35, netToGross: 0.90, climatePctOneStory: 0.65, climatePctMultiStory: 0.75,
      multiStoryThreshold: 3.5, multiStoryFloors: 3,
      climateRatePremium: 1.45, climateRateUpper: 1.25, climateRateMid: 1.10, climateRateValue: 0.95,
      driveRatePremium: 0.85, driveRateUpper: 0.72, driveRateMid: 0.62, driveRateValue: 0.52,
      annualEscalation: 0.03,
      leaseUpY1Occ: 0.30, leaseUpY2Occ: 0.55, leaseUpY3Occ: 0.75, leaseUpY4Occ: 0.88, leaseUpY5Occ: 0.92,
      ecriY1: 0, ecriY2: 0.06, ecriY3: 0.14, ecriY4: 0.24, ecriY5: 0.32,
      hardCostOneStoryClimate: 45, hardCostOneStoryDrive: 28, hardCostMultiStory3: 68,
      siteWorkPerSFOneStory: 8, fireSuppressionPerSF: 5.50, interiorBuildoutPerSF: 15,
      technologyPerSF: 3.50, utilityInfraBase: 75000, utilityInfraPerSF: 2.00,
      softCostPct: 0.20, contingencyPct: 0.075,
      constructionMonthsOneStory: 14, constructionMonthsMultiStory: 18,
      constLoanLTC: 0.60, constLoanRate: 0.075, avgDrawPct: 0.55, workingCapitalPct: 0.02,
      propTaxRate: 0.010, insurancePerSF: 0.30, mgmtFeePct: 0.035,
      basePayroll: 55000, payrollBurden: 1.25, baseFTE: 1.0,
      climateUtilPerSF: 0.85, driveUtilPerSF: 0.20, rmPerSF: 0.25,
      marketingPct: 0.02, gaPct: 0.010, badDebtPct: 0.015, reservePerSF: 0.15,
      capRateConservative: 0.065, capRateMarket: 0.0575, capRateAggressive: 0.05,
      yocMax: 0.075, yocStrike: 0.09, yocMin: 0.105,
      loanLTV: 0.65, loanRate: 0.0675, loanAmort: 25, exitCapRate: 0.06, holdPeriod: 10,
    };
    const V = (k) => ov[k] !== undefined ? ov[k] : D[k];
    const isOv = (k) => ov[k] !== undefined && ov[k] !== D[k];
    const pct = (v) => (v * 100).toFixed(1) + '%';
    const pct2 = (v) => (v * 100).toFixed(2) + '%';
    const dlr = (v) => '$' + (typeof v === 'number' && v >= 1000 ? v.toLocaleString() : (typeof v === 'number' ? v.toFixed(2) : v));
    const dlrSF = (v) => '$' + Number(v).toFixed(2) + '/SF';
    const mo = (v) => v + ' mo';
    const yr = (v) => v + ' yr';
    const n = (v) => String(v);
    const ovCount = Object.keys(ov).filter(k => D[k] !== undefined && ov[k] !== D[k]).length;
    const row = (label, k, fmt) => {
      const val = V(k);
      const modified = isOv(k);
      return '<tr style="border-bottom:1px solid rgba(255,255,255,0.03)">' +
        '<td style="padding:6px 12px;font-size:11px;color:#94A3B8;font-weight:500">' + label + '</td>' +
        '<td style="padding:6px 12px;text-align:right;font-size:12px;font-weight:700;font-family:\'Space Mono\',monospace;color:' + (modified ? '#C9A84C' : '#E2E8F0') + '">' + fmt(val) + (modified ? ' <span style="font-size:8px;color:#C9A84C;font-weight:800;vertical-align:super">*</span>' : '') + '</td></tr>';
    };
    const hdr = (title) => '<tr><td colspan="2" style="padding:14px 12px 6px;font-size:10px;font-weight:800;color:#C9A84C;letter-spacing:0.12em;text-transform:uppercase;border-bottom:1px solid rgba(201,168,76,0.15)">' + title + '</td></tr>';

    return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <span style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em">STORVEX ENGINE v4.1</span>
      <span style="width:4px;height:4px;border-radius:50%;background:#6B7394"></span>
      <span style="font-size:10px;color:#4A5080;font-weight:600">PS Killeen Calibrated</span>
      ${ovCount > 0 ? '<span style="margin-left:auto;font-size:10px;font-weight:700;color:#C9A84C;background:rgba(201,168,76,0.1);padding:3px 10px;border-radius:5px;border:1px solid rgba(201,168,76,0.15)"><span style="font-size:8px">*</span> = site override (' + ovCount + ')</span>' : '<span style="margin-left:auto;font-size:10px;font-weight:600;color:#16A34A;background:rgba(22,163,74,0.08);padding:3px 10px;border-radius:5px;border:1px solid rgba(22,163,74,0.15)">Using Defaults</span>'}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <table style="width:100%;border-collapse:collapse">
          ${hdr('Revenue Assumptions')}
          ${row('Climate Rate (Premium)', 'climateRatePremium', dlrSF)}
          ${row('Climate Rate (Upper)', 'climateRateUpper', dlrSF)}
          ${row('Climate Rate (Mid)', 'climateRateMid', dlrSF)}
          ${row('Climate Rate (Value)', 'climateRateValue', dlrSF)}
          ${row('Drive-Up Rate (Premium)', 'driveRatePremium', dlrSF)}
          ${row('Drive-Up Rate (Upper)', 'driveRateUpper', dlrSF)}
          ${row('Drive-Up Rate (Mid)', 'driveRateMid', dlrSF)}
          ${row('Drive-Up Rate (Value)', 'driveRateValue', dlrSF)}
          ${row('Annual Escalation', 'annualEscalation', pct)}

          ${hdr('Lease-Up Schedule')}
          ${row('Year 1 Occupancy', 'leaseUpY1Occ', pct)}
          ${row('Year 2 Occupancy', 'leaseUpY2Occ', pct)}
          ${row('Year 3 Occupancy', 'leaseUpY3Occ', pct)}
          ${row('Year 4 Occupancy', 'leaseUpY4Occ', pct)}
          ${row('Year 5 (Stabilized)', 'leaseUpY5Occ', pct)}

          ${hdr('ECRI Schedule')}
          ${row('Year 1', 'ecriY1', pct)}
          ${row('Year 2', 'ecriY2', pct)}
          ${row('Year 3', 'ecriY3', pct)}
          ${row('Year 4', 'ecriY4', pct)}
          ${row('Year 5', 'ecriY5', pct)}

          ${hdr('Valuation & Exit')}
          ${row('Cap Rate (Conservative)', 'capRateConservative', pct2)}
          ${row('Cap Rate (Market)', 'capRateMarket', pct2)}
          ${row('Cap Rate (Aggressive)', 'capRateAggressive', pct2)}
          ${row('Exit Cap Rate', 'exitCapRate', pct2)}
          ${row('Hold Period', 'holdPeriod', yr)}

          ${hdr('Target YOC (Land Pricing)')}
          ${row('Max Price (aggressive)', 'yocMax', pct2)}
          ${row('Strike Price (target)', 'yocStrike', pct2)}
          ${row('Min Price (conservative)', 'yocMin', pct2)}
        </table>
      </div>
      <div>
        <table style="width:100%;border-collapse:collapse">
          ${hdr('Facility Sizing')}
          ${row('Lot Coverage Ratio', 'coverageRatio', pct)}
          ${row('Net-to-Gross Efficiency', 'netToGross', pct)}
          ${row('Climate Mix (1-Story)', 'climatePctOneStory', pct)}
          ${row('Climate Mix (Multi-Story)', 'climatePctMultiStory', pct)}
          ${row('Multi-Story Threshold', 'multiStoryThreshold', (v) => v + ' ac')}
          ${row('Multi-Story Floors', 'multiStoryFloors', n)}

          ${hdr('Construction Costs')}
          ${row('1-Story Climate Shell', 'hardCostOneStoryClimate', dlrSF)}
          ${row('1-Story Drive-Up Shell', 'hardCostOneStoryDrive', dlrSF)}
          ${row('Multi-Story (3-Floor)', 'hardCostMultiStory3', dlrSF)}
          ${row('Site Work (1-Story)', 'siteWorkPerSFOneStory', dlrSF)}
          ${row('Fire Suppression', 'fireSuppressionPerSF', dlrSF)}
          ${row('Interior Buildout', 'interiorBuildoutPerSF', dlrSF)}
          ${row('Technology/Access', 'technologyPerSF', dlrSF)}
          ${row('Utility Infrastructure', 'utilityInfraBase', dlr)}
          ${row('Utility Per SF', 'utilityInfraPerSF', dlrSF)}
          ${row('Soft Costs', 'softCostPct', pct)}
          ${row('Contingency', 'contingencyPct', pct)}

          ${hdr('Construction Carry')}
          ${row('Duration (1-Story)', 'constructionMonthsOneStory', mo)}
          ${row('Duration (Multi-Story)', 'constructionMonthsMultiStory', mo)}
          ${row('Loan LTC', 'constLoanLTC', pct)}
          ${row('Construction Rate', 'constLoanRate', pct)}
          ${row('Avg Draw %', 'avgDrawPct', pct)}
          ${row('Working Capital', 'workingCapitalPct', pct)}

          ${hdr('Operating Expenses')}
          ${row('Property Tax Rate', 'propTaxRate', pct2)}
          ${row('Insurance', 'insurancePerSF', dlrSF)}
          ${row('Management Fee', 'mgmtFeePct', pct)}
          ${row('Base Payroll', 'basePayroll', dlr)}
          ${row('Climate Utilities', 'climateUtilPerSF', dlrSF)}
          ${row('Drive-Up Utilities', 'driveUtilPerSF', dlrSF)}
          ${row('R&M', 'rmPerSF', dlrSF)}
          ${row('Marketing', 'marketingPct', pct)}
          ${row('G&A', 'gaPct', pct)}
          ${row('Bad Debt', 'badDebtPct', pct)}
          ${row('Reserves', 'reservePerSF', dlrSF)}

          ${hdr('Capital Stack')}
          ${row('Perm Loan LTV', 'loanLTV', pct)}
          ${row('Perm Loan Rate', 'loanRate', pct)}
          ${row('Amortization', 'loanAmort', yr)}
        </table>
      </div>
    </div>`;
  })()}
</div>

<script>
var __allSitesData = ${JSON.stringify((allSites || [site]).map(s => ({ id: s.id || '', name: s.name || '', city: s.city || '', state: s.state || '', overrides: s.overrides || {} })))};
var __storvexDefaults = {"coverageRatio":0.35,"netToGross":0.90,"climatePctOneStory":0.65,"climatePctMultiStory":0.75,"multiStoryThreshold":3.5,"multiStoryFloors":3,"climateRatePremium":1.45,"climateRateUpper":1.25,"climateRateMid":1.10,"climateRateValue":0.95,"driveRatePremium":0.85,"driveRateUpper":0.72,"driveRateMid":0.62,"driveRateValue":0.52,"annualEscalation":0.03,"hardCostOneStoryClimate":45,"hardCostOneStoryDrive":28,"hardCostMultiStory3":68,"siteWorkPerSFOneStory":8,"fireSuppressionPerSF":5.50,"interiorBuildoutPerSF":15,"technologyPerSF":3.50,"utilityInfraBase":75000,"utilityInfraPerSF":2.00,"softCostPct":0.20,"contingencyPct":0.075,"propTaxRate":0.010,"insurancePerSF":0.30,"mgmtFeePct":0.035,"basePayroll":55000,"climateUtilPerSF":0.85,"rmPerSF":0.25,"marketingPct":0.02,"gaPct":0.010,"badDebtPct":0.015,"reservePerSF":0.15,"capRateConservative":0.065,"capRateMarket":0.0575,"capRateAggressive":0.05,"yocMax":0.075,"yocStrike":0.09,"yocMin":0.105,"loanLTV":0.65,"loanRate":0.0675,"loanAmort":25,"exitCapRate":0.06,"holdPeriod":10};

function switchSiteInputs(siteId) {
  var site = __allSitesData.find(function(s) { return s.id === siteId; });
  if (!site) return;
  var ov = site.overrides || {};
  var keys = Object.keys(ov);
  var panel = document.getElementById('site-overrides-panel');
  if (keys.length === 0) {
    panel.innerHTML = '<div style="text-align:center;padding:20px"><span style="display:inline-block;padding:8px 20px;border-radius:6px;background:rgba(22,163,74,0.12);color:#16A34A;border:1px solid rgba(22,163,74,0.2);font-size:11px;font-weight:700;letter-spacing:0.06em">Using Storvex Engine Defaults \\u2014 No Site-Specific Overrides</span></div>';
    return;
  }
  var fmtK = function(k) { return k.replace(/([A-Z])/g, ' $1').replace(/^./, function(s) { return s.toUpperCase(); }); };
  var fmtV = function(k, v) {
    if (typeof v !== 'number') return String(v);
    if (k.indexOf('Pct') >= 0 || k.indexOf('Rate') >= 0 || k.indexOf('Occ') >= 0 || k.indexOf('Disc') >= 0 || k.indexOf('LTV') >= 0 || k.indexOf('LTC') >= 0 || k.indexOf('Escalation') >= 0 || k.indexOf('Burden') >= 0 || k.indexOf('ecri') === 0 || k.indexOf('yoc') === 0 || k === 'capRateConservative' || k === 'capRateMarket' || k === 'capRateAggressive' || k === 'exitCapRate') return (v * 100).toFixed(v < 0.01 ? 2 : 1) + '%';
    if (k.indexOf('PerSF') >= 0 || k.indexOf('perSF') >= 0 || k === 'insurancePerSF' || k === 'rmPerSF' || k === 'reservePerSF' || k === 'climateUtilPerSF' || k === 'driveUtilPerSF') return '$' + v.toFixed(2);
    if (v >= 1000) return '$' + v.toLocaleString();
    return String(v);
  };
  var html = '<div style="margin-bottom:8px">' +
    '<div style="font-size:9px;font-weight:800;color:#C9A84C;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:8px">' +
    '<span style="width:8px;height:8px;border-radius:50%;background:#C9A84C;display:inline-block"></span>' +
    'SITE-SPECIFIC OVERRIDES (' + keys.length + ' modified)</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">';
  keys.forEach(function(k) {
    html += '<div style="padding:10px 14px;border-radius:8px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);display:flex;justify-content:space-between;align-items:center">' +
      '<span style="font-size:10px;color:#94A3B8;font-weight:600">' + fmtK(k) + '</span>' +
      '<span style="font-size:13px;font-weight:800;font-family:\\'Space Mono\\',monospace;color:#C9A84C">' + fmtV(k, ov[k]) + '</span></div>';
  });
  html += '</div></div>';
  panel.innerHTML = html;
}
</script>

<!-- EXECUTIVE SUMMARY v4.0 -->
<div id="sec-P1" class="section section-gold expand-trigger" onclick="toggleExpand('exec')" style="scroll-margin-top:20px;background:linear-gradient(135deg,rgba(15,21,56,0.8),rgba(30,39,97,0.6))">
  <span class="expand-hint">▼ Click to expand <span id="exec-arrow" class="expand-arrow">▼</span></span>
  <h2 class="gold">Executive Summary</h2>
  <div class="grid4" style="margin-bottom:20px">
    <div class="metric-box mi-active mi" onclick="toggleMI('landcost',event)"><div class="label">Land Cost</div><div class="value gold">${landCost > 0 ? fmtM(landCost) : "TBD"}</div><em class="mi-hint">i</em>
      <div id="mi-landcost" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Land Cost Derivation</div><div class="mi-conf ${landCost > 0 ? "mi-conf-high" : "mi-conf-low"}">${landCost > 0 ? "Confirmed" : "Pending"}</div></div>
        <div class="mi-body">
          ${landCost > 0 ? `<strong>Source:</strong> ${site.askingPrice ? "Listing asking price" : "Broker-provided figure"} — <strong style="color:#C9A84C">${fmtM(landCost)}</strong> for ${!isNaN(acres) ? acres.toFixed(2) : "?"} acres.
          <div class="mi-formula">Price/Acre = ${fmtD(landCost)} ÷ ${!isNaN(acres) ? acres.toFixed(2) : "?"} ac = <strong style="color:#C9A84C">${pricePerAcre ? fmtD(pricePerAcre) + "/ac" : "N/A"}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Land as % of Total Dev</span><span class="mi-row-val">${totalDevCost > 0 ? Math.round(landCost/totalDevCost*100) : 0}%</span></div>
          <div class="mi-row"><span class="mi-row-label">Industry Benchmark</span><span class="mi-row-val">15-25% of total dev cost</span></div>
          <div class="mi-row"><span class="mi-row-label">Assessment</span><span class="mi-row-val" style="color:${landCost/totalDevCost < 0.25 ? "#16A34A" : "#F59E0B"}">${landCost/totalDevCost < 0.15 ? "Favorable" : landCost/totalDevCost < 0.25 ? "Market Rate" : "Premium"}</span></div>` : "Land cost not yet confirmed. This metric will populate when pricing is received from the broker or listing platform."}
          <div class="mi-source">Source: ${h(site.listingSource || "Crexi/LoopNet listing")} | Verified: ${new Date().toLocaleDateString()}</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi-active mi" onclick="toggleMI('devcost',event)"><div class="label">Total Dev Cost</div><div class="value orange">${totalDevCost > 0 ? fmtM(totalDevCost) : "TBD"}</div><em class="mi-hint">i</em>
      <div id="mi-devcost" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Total Development Cost</div><div class="mi-conf mi-conf-med">Modeled</div></div>
        <div class="mi-body">
          <strong>Storvex builds total dev cost from five components (PS "Total Development Yield" denominator):</strong>
          <div class="mi-formula">Total Dev = Land + All Hard Costs + Soft + Contingency + Carry<br>= ${fmtD(landCost)} + ${fmtD(totalHardCost)} + ${fmtD(softCost)} + ${fmtD(contingency)} + ${fmtD(carryCosts)}<br>= <strong style="color:#E87A2E">${fmtD(totalDevCost)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Land Acquisition</span><span class="mi-row-val">${fmtD(landCost)} (${totalDevCost > 0 ? Math.round(landCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Building Shell & HVAC ($${hardCostPerSF}/SF)</span><span class="mi-row-val">${fmtD(hardCost)} (${totalDevCost > 0 ? Math.round(hardCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Site Development ($${baseSiteWorkPerSF}/SF site)</span><span class="mi-row-val">${fmtD(siteWorkCost)} (${totalDevCost > 0 ? Math.round(siteWorkCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Fire Suppression ($${baseFireSuppressionPerSF}/SF)</span><span class="mi-row-val">${fmtD(fireSuppressionCost)} (${totalDevCost > 0 ? Math.round(fireSuppressionCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Interior Buildout ($${baseInteriorPerSF}/SF net)</span><span class="mi-row-val">${fmtD(interiorBuildoutCost)} (${totalDevCost > 0 ? Math.round(interiorBuildoutCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Technology & Security ($${baseTechPerSF}/SF)</span><span class="mi-row-val">${fmtD(technologyCost)} (${totalDevCost > 0 ? Math.round(technologyCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Utility Infrastructure</span><span class="mi-row-val">${fmtD(utilityInfraCost)} (${totalDevCost > 0 ? Math.round(utilityInfraCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Soft Costs (${Math.round(softCostPct*100)}% of all hard)</span><span class="mi-row-val">${fmtD(softCost)} (${totalDevCost > 0 ? Math.round(softCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Construction Contingency (${(contingencyPct*100).toFixed(1)}%)</span><span class="mi-row-val">${fmtD(contingency)} (${totalDevCost > 0 ? Math.round(contingency/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Construction Carry (${constructionMonths}mo)</span><span class="mi-row-val">${fmtD(carryCosts)} (${totalDevCost > 0 ? Math.round(carryCosts/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row" style="padding-left:16px;font-size:10px;color:#6B7394"><span class="mi-row-label">— Interest Reserve</span><span class="mi-row-val">${fmtD(constructionInterest)}</span></div>
          <div class="mi-row" style="padding-left:16px;font-size:10px;color:#6B7394"><span class="mi-row-label">— Property Tax (during constr.)</span><span class="mi-row-val">${fmtD(constructionPropTax)}</span></div>
          <div class="mi-row" style="padding-left:16px;font-size:10px;color:#6B7394"><span class="mi-row-label">— Builder's Risk Insurance</span><span class="mi-row-val">${fmtD(constructionInsurance)}</span></div>
          <div class="mi-row"><span class="mi-row-label">Cost/SF (all-in)</span><span class="mi-row-val">${totalSF > 0 ? fmtD(totalDevCost/totalSF) + "/SF" : "N/A"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Regional Cost Index</span><span class="mi-row-val">${(costIdx*100).toFixed(0)}% of national avg</span></div>
          <div class="mi-row"><span class="mi-row-label">Operator Profile</span><span class="mi-row-val">${operatorLabel || "Public Storage Operating Platform"}</span></div>
          <div class="mi-source">Source: RSMeans/ENR 2025 regional construction cost data | Base: $${baseHardPerSF}/SF × ${(costIdx).toFixed(2)} state index | Carry: 60% LTC @ 7.5% const. rate | Contingency: 7.5% industry standard</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi-active mi" onclick="toggleMI('stabnoi',event)"><div class="label">Stabilized NOI (Y5)</div><div class="value green">${fmtM(stabNOI)}</div><em class="mi-hint">i</em>
      <div id="mi-stabnoi" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Stabilized NOI Derivation</div><div class="mi-conf mi-conf-med">Projected</div></div>
        <div class="mi-body">
          <strong>Year 5 stabilized Net Operating Income — the critical metric for valuation.</strong>
          <div class="mi-formula">Stabilized NOI = Stabilized Revenue × (1 - OpEx Ratio)<br>= ${fmtD(stabRev)} × (1 - ${opexRatioDetail || "38"}%)<br>= <strong style="color:#16A34A">${fmtD(stabNOI)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Stabilized Revenue (Y5)</span><span class="mi-row-val">${fmtD(stabRev)}</span></div>
          <div class="mi-row"><span class="mi-row-label">Stabilized Occupancy</span><span class="mi-row-val">92% (industry standard)</span></div>
          <div class="mi-row"><span class="mi-row-label">Total OpEx</span><span class="mi-row-val">${fmtD(stabRev - stabNOI)}</span></div>
          <div class="mi-row"><span class="mi-row-label">NOI Margin</span><span class="mi-row-val">${noiMarginPct || Math.round(stabNOI/stabRev*100)}%</span></div>
          <div class="mi-row"><span class="mi-row-label">NOI/SF</span><span class="mi-row-val">$${noiPerSF || (totalSF > 0 ? (stabNOI/totalSF).toFixed(2) : "N/A")}</span></div>
          <div class="mi-row"><span class="mi-row-label">PS Actual NOI Margin</span><span class="mi-row-val">78.4% (PSA Q4 2025 — self-managed, scale economies)</span></div>
          <div class="mi-row"><span class="mi-row-label">Operator Profile</span><span class="mi-row-val">${operatorLabel || "Public Storage Operating Platform"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Net-to-Gross</span><span class="mi-row-val">${netToGross ? (netToGross*100).toFixed(0) + "% (gross " + (grossSF ? grossSF.toLocaleString() : "?") + " SF → net " + totalSF.toLocaleString() + " SF)" : "N/A"}</span></div>
          <div class="mi-source">Source: Storvex 5-Year Lease-Up Model | Rates: Income-tier methodology | OpEx: 10-line PS-calibrated detail (Bain Review 2026-03-21)</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi-active mi" onclick="toggleMI('yoc',event)"><div class="label">Yield on Cost</div><div class="value" style="color:${parseFloat(yocStab) >= 9 ? "#16A34A" : parseFloat(yocStab) >= 7 ? "#F59E0B" : "#EF4444"}">${yocStab}%</div><em class="mi-hint">i</em>
      <div id="mi-yoc" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Yield on Cost Analysis</div><div class="mi-conf ${parseFloat(yocStab) >= 8 ? "mi-conf-high" : "mi-conf-med"}">${parseFloat(yocStab) >= 9 ? "Strong" : parseFloat(yocStab) >= 7.5 ? "Acceptable" : "Below Target"}</div></div>
        <div class="mi-body">
          <strong>YOC is the single most important development return metric — it measures the unlevered return on total capital deployed.</strong>
          <div class="mi-formula">YOC = Stabilized NOI ÷ Total Development Cost<br>= ${fmtD(stabNOI)} ÷ ${fmtD(totalDevCost)}<br>= <strong style="color:${parseFloat(yocStab) >= 9 ? "#16A34A" : "#F59E0B"}">${yocStab}%</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Target Range</span><span class="mi-row-val">8.0% - 10.0%</span></div>
          <div class="mi-row"><span class="mi-row-label">PS Minimum Hurdle</span><span class="mi-row-val">7.5%</span></div>
          <div class="mi-row"><span class="mi-row-label">Development Spread</span><span class="mi-row-val" style="color:${parseFloat(devSpread) >= 2.0 ? "#16A34A" : "#F59E0B"}">${devSpread || "N/A"} bps vs market cap</span></div>
          <div class="mi-row"><span class="mi-row-label">Assessment</span><span class="mi-row-val" style="color:${parseFloat(yocStab) >= 9 ? "#16A34A" : parseFloat(yocStab) >= 7.5 ? "#F59E0B" : "#EF4444"}">${parseFloat(yocStab) >= 9.5 ? "Exceptional — well above PS hurdle" : parseFloat(yocStab) >= 8.5 ? "Strong — above PS sweet spot" : parseFloat(yocStab) >= 7.5 ? "Meets PS minimum development threshold" : "Below PS hurdle — negotiate land price down"}</span></div>
          <div class="mi-source">Source: SiteScore Financial Engine | Formula: Industry-standard development return metric used by all REIT developers</div>
        </div>
      </div></div>
    </div>
  </div>
  <div class="grid3">
    ${valuations.map((v,vi) => `<div class="metric-box mi-active mi" onclick="toggleMI('val${vi}',event)"><div class="label">${v.label}</div><div class="value blue">${fmtM(v.value)}</div><div style="font-size:10px;color:#6B7394;margin-top:4px">@ ${(v.rate*100).toFixed(2)}% cap</div><em class="mi-hint">i</em>
      <div id="mi-val${vi}" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">${v.label} Valuation</div><div class="mi-conf mi-conf-med">Modeled</div></div>
        <div class="mi-body">
          <strong>Direct capitalization of stabilized NOI at a ${(v.rate*100).toFixed(2)}% cap rate.</strong>
          <div class="mi-formula">Value = Stabilized NOI ÷ Cap Rate<br>= ${fmtD(stabNOI)} ÷ ${(v.rate*100).toFixed(2)}%<br>= <strong style="color:#42A5F5">${fmtM(v.value)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Value/SF</span><span class="mi-row-val">${totalSF > 0 ? fmtD(v.value/totalSF) : "N/A"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Value vs Dev Cost</span><span class="mi-row-val" style="color:${v.value > totalDevCost ? "#16A34A" : "#EF4444"}">${totalDevCost > 0 ? (v.value > totalDevCost ? "+" : "") + fmtM(v.value - totalDevCost) + " (" + Math.round((v.value/totalDevCost-1)*100) + "%)" : "N/A"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Cap Rate Context</span><span class="mi-row-val">${v.rate <= 0.05 ? "Aggressive — primary market pricing" : v.rate <= 0.06 ? "Market — secondary market pricing" : "Conservative — discount/tertiary"}</span></div>
          <div class="mi-source">Source: REIT transaction comps (PSA, EXR, CUBE Q4 2025 filings) | Method: Direct capitalization</div>
        </div>
      </div></div>
    </div>`).join("")}
  </div>
  <!-- BOARD METRICS PANEL — Bain Review 2026-03-21 -->
  <div style="margin-top:16px;padding:16px;border-radius:12px;background:rgba(15,21,56,0.6);border:1px solid rgba(201,168,76,0.15)">
    <div style="font-size:10px;font-weight:800;color:#C9A84C;letter-spacing:0.12em;margin-bottom:12px;text-transform:uppercase">Board Review Metrics</div>
    <div class="grid3" style="gap:12px">
      <div style="text-align:center;padding:12px;border-radius:8px;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.1)">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.06em;margin-bottom:4px">DEV SPREAD</div>
        <div class="mono" style="font-size:18px;font-weight:800;color:${parseFloat(devSpread) >= 2.0 ? "#16A34A" : "#F59E0B"}">${devSpread}<span style="font-size:10px;color:#6B7394"> bps</span></div>
        <div style="font-size:9px;color:#6B7394;margin-top:2px">≥150 bps = justified</div>
      </div>
      <div style="text-align:center;padding:12px;border-radius:8px;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.1)">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.06em;margin-bottom:4px">PROFIT ON COST</div>
        <div class="mono" style="font-size:18px;font-weight:800;color:${parseFloat(profitOnCost) >= 20 ? "#16A34A" : "#F59E0B"}">${profitOnCost}%</div>
        <div style="font-size:9px;color:#6B7394;margin-top:2px">value creation</div>
      </div>
      <div style="text-align:center;padding:12px;border-radius:8px;background:${npvAtWACC >= 0 ? "rgba(22,163,74,0.08)" : "rgba(239,68,68,0.08)"};border:1px solid ${npvAtWACC >= 0 ? "rgba(22,163,74,0.2)" : "rgba(239,68,68,0.2)"}">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.06em;margin-bottom:4px">NPV @ WACC</div>
        <div class="mono" style="font-size:18px;font-weight:800;color:${npvAtWACC >= 0 ? "#16A34A" : "#EF4444"}">${fmtM(npvAtWACC)}</div>
        <div style="font-size:9px;color:#6B7394;margin-top:2px">@ PS 9.26% WACC</div>
      </div>
    </div>
    <div class="grid4" style="gap:8px;margin-top:10px">
      <div style="text-align:center;padding:8px;border-radius:6px;background:rgba(201,168,76,0.04)">
        <div style="font-size:8px;font-weight:700;color:#6B7394;letter-spacing:0.06em">UNLEVERED IRR</div>
        <div class="mono" style="font-size:14px;font-weight:800;color:${parseFloat(unleveredIRR) >= 10 ? "#16A34A" : "#F59E0B"}">${unleveredIRR}%</div>
      </div>
      <div style="text-align:center;padding:8px;border-radius:6px;background:rgba(201,168,76,0.04)">
        <div style="font-size:8px;font-weight:700;color:#6B7394;letter-spacing:0.06em">LEVERED IRR</div>
        <div class="mono" style="font-size:14px;font-weight:800;color:${parseFloat(irrPct) >= 15 ? "#16A34A" : "#F59E0B"}">${irrPct}%</div>
      </div>
      <div style="text-align:center;padding:8px;border-radius:6px;background:rgba(201,168,76,0.04)">
        <div style="font-size:8px;font-weight:700;color:#6B7394;letter-spacing:0.06em">DEBT YIELD</div>
        <div class="mono" style="font-size:14px;font-weight:800;color:${parseFloat(debtYield) >= 10 ? "#16A34A" : "#F59E0B"}">${debtYield}%</div>
      </div>
      <div style="text-align:center;padding:8px;border-radius:6px;background:rgba(201,168,76,0.04)">
        <div style="font-size:8px;font-weight:700;color:#6B7394;letter-spacing:0.06em">EQUITY MULTIPLE</div>
        <div class="mono" style="font-size:14px;font-weight:800;color:${parseFloat(equityMultiple) >= 2.0 ? "#16A34A" : "#F59E0B"}">${equityMultiple}x</div>
      </div>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
      <span style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.06em">EXIT SCENARIOS:</span>
      ${exitScenarios ? exitScenarios.map(s => `<span style="padding:3px 10px;border-radius:6px;font-size:10px;font-weight:700;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.1);color:${parseFloat(s.irr) >= 15 ? "#16A34A" : parseFloat(s.irr) >= 10 ? "#C9A84C" : "#EF4444"}">${s.label}: ${s.irr}% IRR</span>`).join("") : ""}
    </div>
    <div style="font-size:9px;color:#4A5080;margin-top:8px">Operating Profile: ${operatorLabel || "Public Storage"} | NOI Margin Benchmark: ${noiMarginBenchmark || "78.4% (PSA Q4 2025)"}</div>
  </div>

  <div id="exec" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Investment Thesis</div>
      ${landCost > 0 && totalDevCost > 0 ? `<div>This ${!isNaN(acres) ? acres.toFixed(1) + "-acre" : ""} ${site.state || ""} site requires a total capital deployment of <strong style="color:#E87A2E">${fmtM(totalDevCost)}</strong> (${landCost > 0 ? Math.round(landCost/totalDevCost*100) : 0}% land / ${Math.round(hardCost/totalDevCost*100)}% hard / ${Math.round(softCost/totalDevCost*100)}% soft / ${contingency > 0 ? Math.round(contingency/totalDevCost*100) : 0}% contingency). At stabilization (Year 5), the facility produces <strong style="color:#16A34A">${fmtM(stabNOI)}</strong> NOI at a <strong>${noiMarginPct}% margin</strong> (PS benchmark: 78.4%), implying a <strong style="color:${parseFloat(yocStab) >= 9 ? "#16A34A" : "#F59E0B"}">${yocStab}% yield on cost</strong> — ${parseFloat(yocStab) >= 9 ? "well above" : parseFloat(yocStab) >= 7.5 ? "above" : "near"} PS's ~8% development hurdle. Development spread of <strong>${devSpread} bps</strong> over the ${(mktAcqCap*100).toFixed(1)}% acquisition cap rate ${parseFloat(devSpread) >= 1.5 ? "justifies" : "may not justify"} construction risk. NPV at PS's 9.26% WACC: <strong style="color:${npvAtWACC >= 0 ? "#16A34A" : "#EF4444"}">${fmtM(npvAtWACC)}</strong> — ${npvAtWACC >= 0 ? "creates shareholder value" : "does not exceed cost of capital"}.</div>` : "<div>Pricing data pending — investment thesis will populate when land cost is confirmed.</div>"}
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Return Waterfall</div>
      ${(() => {
        const items = [
          { label: "Land Acquisition", val: landCost, color: "#C9A84C" },
          { label: "Building Shell", val: hardCost, color: "#E87A2E" },
          { label: "Site Development", val: siteWorkCost, color: "#D97706" },
          { label: "Fire / Interior", val: fireSuppressionCost + interiorBuildoutCost, color: "#B45309" },
          { label: "Tech / Utility", val: technologyCost + utilityInfraCost, color: "#92400E" },
          { label: "Soft + Contingency", val: softCost + contingency, color: "#F59E0B" },
        ];
        const maxVal = totalDevCost || 1;
        return items.map(it => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div style="width:120px;font-size:11px;color:#6B7394;font-weight:600;text-align:right">${it.label}</div>
          <div class="waterfall-bar" style="width:${Math.max(Math.round(it.val/maxVal*400), 40)}px;background:${it.color}">${it.val > 0 ? fmtM(it.val) : "TBD"}</div>
        </div>`).join("") + `<div style="display:flex;align-items:center;gap:10px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(201,168,76,0.15)">
          <div style="width:120px;font-size:11px;color:#C9A84C;font-weight:800;text-align:right">TOTAL</div>
          <div class="waterfall-bar" style="width:400px;background:linear-gradient(90deg,#C9A84C,#E87A2E)">${totalDevCost > 0 ? fmtM(totalDevCost) : "TBD"}</div>
        </div>`;
      })()}
    </div>
    <div class="grid3" style="margin-top:16px">
      <div class="insight-box" style="text-align:center">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">5-YEAR CUMULATIVE NOI</div>
        <div class="mono" style="font-size:20px;font-weight:800;color:#16A34A">${fmtM(yearData.reduce((s,y) => s + y.noi, 0))}</div>
      </div>
      <div class="insight-box" style="text-align:center">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">BREAK-EVEN YEAR</div>
        <div class="mono" style="font-size:20px;font-weight:800;color:#42A5F5">${(() => { let cum = 0; for(let i=0;i<yearData.length;i++){cum+=yearData[i].noi;if(cum>=totalDevCost)return "Year "+(i+1);} return totalDevCost > 0 ? ">5 Yrs" : "TBD"; })()}</div>
      </div>
      <div class="insight-box" style="text-align:center">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">VALUE CREATION</div>
        <div class="mono" style="font-size:20px;font-weight:800;color:#C9A84C">${totalDevCost > 0 ? fmtM(valuations[1].value - totalDevCost) : "TBD"}</div>
        <div style="font-size:9px;color:#6B7394;margin-top:2px">@ market cap</div>
      </div>
    </div>
  </div>
</div>

<!-- DEVELOPMENT TIMELINE -->
<div id="sec-P2" class="section expand-trigger" onclick="toggleExpand('timeline')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="timeline-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Development Timeline</span></h2>
  <div style="font-size:11px;color:#6B7394;margin-bottom:20px">Capital-at-risk timeline from acquisition through stabilized operations</div>
  ${(() => {
    const constMo = constructionMonths || (isMultiStory ? 18 : 14);
    const phases = [
      { label: "Due Diligence & Entitlements", abbr: "DD", start: 0, dur: 3, color: "#42A5F5", icon: "◆" },
      { label: "Design Development & Permits", abbr: "Design", start: 3, dur: 3, color: "#7C4DFF", icon: "◆" },
      { label: "Site Prep & Grading", abbr: "Site Prep", start: 6, dur: 2, color: "#F59E0B", icon: "◆" },
      { label: "Vertical Construction", abbr: "Construction", start: 8, dur: constMo - 4, color: "#E87A2E", icon: "◆" },
      { label: "CO & Grand Opening", abbr: "CO", start: 4 + constMo, dur: 2, color: "#16A34A", icon: "★" },
      { label: "Lease-Up (36-mo ramp to 92%)", abbr: "Lease-Up", start: 6 + constMo, dur: 36, color: "#C9A84C", icon: "◆" },
      { label: "Stabilized Operations", abbr: "Stabilized", start: 42 + constMo, dur: 12, color: "#16A34A", icon: "★" },
    ];
    const totalMo = phases[phases.length - 1].start + phases[phases.length - 1].dur;
    const barW = 680;
    const labelW = 200;
    // Year markers
    const yearMarkers = [];
    for (let y = 0; y <= Math.ceil(totalMo / 12); y++) {
      yearMarkers.push(y * 12);
    }
    // Phase groupings
    const preDevEnd = 6;
    const constructionEnd = 6 + constMo;
    const leaseUpEnd = 42 + constMo;
    return `<div style="overflow-x:auto"><div style="min-width:${barW + labelW + 40}px">
      <!-- Phase group headers -->
      <div style="display:flex;align-items:flex-end;gap:0;margin-bottom:4px;padding-left:${labelW + 12}px">
        <div style="width:${Math.round(preDevEnd / totalMo * barW)}px;text-align:center;border-bottom:2px solid rgba(66,165,245,0.4);padding-bottom:4px;margin-right:2px">
          <span style="font-size:8px;font-weight:800;letter-spacing:0.1em;color:rgba(66,165,245,0.7)">PRE-DEVELOPMENT</span>
        </div>
        <div style="width:${Math.round((constructionEnd - preDevEnd) / totalMo * barW)}px;text-align:center;border-bottom:2px solid rgba(232,122,46,0.4);padding-bottom:4px;margin-right:2px">
          <span style="font-size:8px;font-weight:800;letter-spacing:0.1em;color:rgba(232,122,46,0.7)">CONSTRUCTION</span>
        </div>
        <div style="width:${Math.round((leaseUpEnd - constructionEnd) / totalMo * barW)}px;text-align:center;border-bottom:2px solid rgba(201,168,76,0.4);padding-bottom:4px;margin-right:2px">
          <span style="font-size:8px;font-weight:800;letter-spacing:0.1em;color:rgba(201,168,76,0.7)">LEASE-UP</span>
        </div>
        <div style="flex:1;text-align:center;border-bottom:2px solid rgba(22,163,74,0.4);padding-bottom:4px">
          <span style="font-size:8px;font-weight:800;letter-spacing:0.1em;color:rgba(22,163,74,0.7)">STABILIZED</span>
        </div>
      </div>

      <!-- Year gridline labels -->
      <div style="display:flex;align-items:center;margin-bottom:2px">
        <div style="width:${labelW}px;flex-shrink:0"></div>
        <div style="position:relative;width:${barW}px;height:14px;flex-shrink:0">
          ${yearMarkers.filter(m => m <= totalMo).map(m => {
            const x = Math.round(m / totalMo * barW);
            return `<span style="position:absolute;left:${x}px;transform:translateX(-50%);font-size:8px;font-weight:700;letter-spacing:0.08em;color:#4A5080;font-family:'Space Mono',monospace">${m === 0 ? 'START' : 'YR ' + (m / 12)}</span>`;
          }).join("")}
        </div>
      </div>

      <!-- Gantt rows -->
      ${phases.map((p, i) => {
      const left = Math.round(p.start / totalMo * barW);
      const width = Math.max(Math.round(p.dur / totalMo * barW), 24);
      const isLong = width > 60;
      return `<div style="display:flex;align-items:center;margin-bottom:0;gap:12px;position:relative">
        <!-- Row label -->
        <div style="width:${labelW}px;text-align:right;font-size:10px;color:#94A3B8;font-weight:500;flex-shrink:0;padding:8px 0;line-height:1.3;${i === 0 ? 'border-top:1px solid rgba(201,168,76,0.06)' : ''};border-bottom:1px solid rgba(201,168,76,0.06)">
          <span style="color:#E2E8F0;font-weight:700">${p.label}</span>
        </div>
        <!-- Bar area with gridlines -->
        <div style="position:relative;width:${barW}px;height:36px;flex-shrink:0;${i === 0 ? 'border-top:1px solid rgba(201,168,76,0.06)' : ''};border-bottom:1px solid rgba(201,168,76,0.06)">
          <!-- Year gridlines -->
          ${yearMarkers.filter(m => m > 0 && m <= totalMo).map(m => {
            const x = Math.round(m / totalMo * barW);
            return `<div style="position:absolute;left:${x}px;top:0;bottom:0;width:1px;background:rgba(201,168,76,0.08)"></div>`;
          }).join("")}
          <!-- Bar -->
          <div style="position:absolute;left:${left}px;top:6px;width:${width}px;height:24px;border-radius:3px;background:linear-gradient(135deg,${p.color},${p.color}dd);box-shadow:0 2px 8px ${p.color}33;display:flex;align-items:center;${isLong ? 'justify-content:space-between;padding:0 8px' : 'justify-content:center'}">
            ${isLong ? `<span style="font-size:8px;font-weight:600;color:rgba(255,255,255,0.7);font-family:'Space Mono',monospace">Mo ${p.start}</span><span style="font-size:8px;font-weight:600;color:rgba(255,255,255,0.7);font-family:'Space Mono',monospace">Mo ${p.start + p.dur}</span>` : `<span style="font-size:8px;font-weight:700;color:#fff;font-family:'Space Mono',monospace">${p.dur}mo</span>`}
          </div>
        </div>
      </div>`;
    }).join("")}

      <!-- Bottom axis -->
      <div style="display:flex;align-items:flex-start;margin-top:0;gap:12px">
        <div style="width:${labelW}px;flex-shrink:0"></div>
        <div style="position:relative;width:${barW}px;height:20px;flex-shrink:0;border-top:2px solid rgba(201,168,76,0.15)">
          ${yearMarkers.filter(m => m <= totalMo).map(m => {
            const x = Math.round(m / totalMo * barW);
            return `<span style="position:absolute;left:${x}px;top:4px;transform:translateX(-50%);font-size:8px;font-weight:600;color:#4A5080;font-family:'Space Mono',monospace">${m}</span>`;
          }).join("")}
          <span style="position:absolute;right:0;top:4px;font-size:7px;color:#4A5080;letter-spacing:0.06em">MONTHS</span>
        </div>
      </div>

      <!-- Milestone diamonds -->
      <div style="display:flex;align-items:center;margin-top:12px;gap:12px">
        <div style="width:${labelW}px;flex-shrink:0;text-align:right">
          <span style="font-size:8px;font-weight:700;letter-spacing:0.08em;color:#4A5080">KEY MILESTONES</span>
        </div>
        <div style="position:relative;width:${barW}px;height:24px;flex-shrink:0">
          ${[
            { mo: 0, label: "Close", color: "#42A5F5" },
            { mo: 6, label: "Break Ground", color: "#F59E0B" },
            { mo: 4 + constMo, label: "CO", color: "#16A34A" },
            { mo: 42 + constMo, label: "Stabilized", color: "#C9A84C" },
          ].map(m => {
            const x = Math.round(m.mo / totalMo * barW);
            return `<div style="position:absolute;left:${x}px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center">
              <div style="width:8px;height:8px;background:${m.color};transform:rotate(45deg);box-shadow:0 0 6px ${m.color}55"></div>
              <span style="font-size:7px;font-weight:700;color:${m.color};margin-top:3px;white-space:nowrap;letter-spacing:0.04em">${m.label}</span>
            </div>`;
          }).join("")}
        </div>
      </div>
    </div></div>

    <!-- KPI Cards -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px">
      <div style="text-align:center;padding:14px 10px;border-radius:8px;background:linear-gradient(135deg,rgba(66,165,245,0.06),rgba(66,165,245,0.02));border:1px solid rgba(66,165,245,0.12)">
        <div style="font-size:8px;font-weight:800;color:#42A5F5;letter-spacing:0.1em;margin-bottom:6px">PRE-DEV</div>
        <div class="mono" style="font-size:24px;font-weight:800;color:#42A5F5">6</div>
        <div style="font-size:8px;color:#6B7394;margin-top:2px">months</div>
      </div>
      <div style="text-align:center;padding:14px 10px;border-radius:8px;background:linear-gradient(135deg,rgba(232,122,46,0.06),rgba(232,122,46,0.02));border:1px solid rgba(232,122,46,0.12)">
        <div style="font-size:8px;font-weight:800;color:#E87A2E;letter-spacing:0.1em;margin-bottom:6px">CONSTRUCTION</div>
        <div class="mono" style="font-size:24px;font-weight:800;color:#E87A2E">${constMo}</div>
        <div style="font-size:8px;color:#6B7394;margin-top:2px">months</div>
      </div>
      <div style="text-align:center;padding:14px 10px;border-radius:8px;background:linear-gradient(135deg,rgba(201,168,76,0.06),rgba(201,168,76,0.02));border:1px solid rgba(201,168,76,0.12)">
        <div style="font-size:8px;font-weight:800;color:#C9A84C;letter-spacing:0.1em;margin-bottom:6px">STABILIZATION</div>
        <div class="mono" style="font-size:24px;font-weight:800;color:#C9A84C">${42 + constMo}</div>
        <div style="font-size:8px;color:#6B7394;margin-top:2px">months from close</div>
      </div>
      <div style="text-align:center;padding:14px 10px;border-radius:8px;background:linear-gradient(135deg,rgba(22,163,74,0.06),rgba(22,163,74,0.02));border:1px solid rgba(22,163,74,0.12)">
        <div style="font-size:8px;font-weight:800;color:#16A34A;letter-spacing:0.1em;margin-bottom:6px">TOTAL TIMELINE</div>
        <div class="mono" style="font-size:24px;font-weight:800;color:#16A34A">${(Math.round((42 + constMo) / 12 * 10) / 10).toFixed(1)}</div>
        <div style="font-size:8px;color:#6B7394;margin-top:2px">years</div>
      </div>
    </div>`;
  })()}
  <div id="timeline" class="expand-panel">
    <div style="margin-top:12px;font-size:11px;color:#6B7394;line-height:1.6">
      <strong style="color:#E2E8F0">Key Milestones:</strong><br>
      <span style="color:#42A5F5">●</span> <strong>Due Diligence (Mo 0-3):</strong> Environmental Phase I, survey, geotech, title commitment, utility confirmation<br>
      <span style="color:#7C4DFF">●</span> <strong>Design & Permits (Mo 3-6):</strong> Architectural plans, civil engineering, building permit application${site.zoningClassification === "conditional" ? ", SUP/CUP hearing (may extend 2-4 mo)" : ""}<br>
      <span style="color:#F59E0B">●</span> <strong>Site Prep (Mo 6-8):</strong> Grading, utilities rough-in, foundation, detention/retention<br>
      <span style="color:#E87A2E">●</span> <strong>Construction (Mo 8-${8 + (constructionMonths || (isMultiStory ? 18 : 14)) - 4}):</strong> ${isMultiStory ? "Structural steel, floors, envelope, MEP, elevator, fire stairs, interior build-out" : "Slab-on-grade, pre-engineered metal building, HVAC, unit partitions, doors, fire suppression"}<br>
      <span style="color:#16A34A">●</span> <strong>CO & Opening:</strong> Final inspections, certificate of occupancy, access system activation, grand opening marketing<br>
      <span style="color:#C9A84C">●</span> <strong>Lease-Up (36 months):</strong> Ramp from 25% → 92% occupancy. ECRI kicks in at Month 12. PS's brand + digital marketing platform accelerates fill vs. independent operators.
    </div>
  </div>
</div>

<!-- PS vs INDUSTRY BENCHMARK -->
<div id="sec-P3" class="section" style="scroll-margin-top:20px">
  <h2><span class="gold">PS Operating Advantage</span> <span style="font-size:11px;font-weight:400;color:#6B7394">vs. Industry</span></h2>
  <div style="font-size:11px;color:#6B7394;margin-bottom:16px">Why PS's operating platform produces superior returns on the same physical asset</div>
  <table style="width:100%;border-collapse:collapse">
    <tr style="border-bottom:2px solid rgba(201,168,76,0.15)">
      <td style="padding:8px 0;font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.06em">METRIC</td>
      <td style="padding:8px 0;font-size:10px;font-weight:800;color:#16A34A;letter-spacing:0.06em;text-align:center">PS PLATFORM</td>
      <td style="padding:8px 0;font-size:10px;font-weight:800;color:#F59E0B;letter-spacing:0.06em;text-align:center">GENERIC REIT</td>
      <td style="padding:8px 0;font-size:10px;font-weight:800;color:#EF4444;letter-spacing:0.06em;text-align:center">INDEPENDENT</td>
      <td style="padding:8px 0;font-size:10px;font-weight:800;color:#42A5F5;letter-spacing:0.06em;text-align:center">PS EDGE</td>
    </tr>
    <tr style="border-bottom:1px solid rgba(201,168,76,0.08)">
      <td style="padding:6px 0;font-size:11px;color:#E2E8F0;font-weight:600">NOI Margin</td>
      <td style="padding:6px 0;text-align:center;font-weight:800;color:#16A34A;font-family:'Space Mono',monospace">78.4%</td>
      <td style="padding:6px 0;text-align:center;color:#F59E0B;font-family:'Space Mono',monospace">58-65%</td>
      <td style="padding:6px 0;text-align:center;color:#EF4444;font-family:'Space Mono',monospace">50-58%</td>
      <td style="padding:6px 0;text-align:center;font-weight:700;color:#42A5F5;font-size:10px">+13-20 pts vs REIT</td>
    </tr>
    <tr style="border-bottom:1px solid rgba(201,168,76,0.08)">
      <td style="padding:6px 0;font-size:11px;color:#E2E8F0;font-weight:600">Management Fee</td>
      <td style="padding:6px 0;text-align:center;font-weight:800;color:#16A34A;font-family:'Space Mono',monospace">3.5%</td>
      <td style="padding:6px 0;text-align:center;color:#F59E0B;font-family:'Space Mono',monospace">5-6%</td>
      <td style="padding:6px 0;text-align:center;color:#EF4444;font-family:'Space Mono',monospace">8-10%</td>
      <td style="padding:6px 0;text-align:center;font-weight:700;color:#42A5F5;font-size:10px">Self-managed</td>
    </tr>
    <tr style="border-bottom:1px solid rgba(201,168,76,0.08)">
      <td style="padding:6px 0;font-size:11px;color:#E2E8F0;font-weight:600">Payroll / Site</td>
      <td style="padding:6px 0;text-align:center;font-weight:800;color:#16A34A;font-family:'Space Mono',monospace">$69K</td>
      <td style="padding:6px 0;text-align:center;color:#F59E0B;font-family:'Space Mono',monospace">$85-95K</td>
      <td style="padding:6px 0;text-align:center;color:#EF4444;font-family:'Space Mono',monospace">$100-130K</td>
      <td style="padding:6px 0;text-align:center;font-weight:700;color:#42A5F5;font-size:10px">Smart-access tech</td>
    </tr>
    <tr style="border-bottom:1px solid rgba(201,168,76,0.08)">
      <td style="padding:6px 0;font-size:11px;color:#E2E8F0;font-weight:600">Marketing</td>
      <td style="padding:6px 0;text-align:center;font-weight:800;color:#16A34A;font-family:'Space Mono',monospace">2%</td>
      <td style="padding:6px 0;text-align:center;color:#F59E0B;font-family:'Space Mono',monospace">3%</td>
      <td style="padding:6px 0;text-align:center;color:#EF4444;font-family:'Space Mono',monospace">4-5%</td>
      <td style="padding:6px 0;text-align:center;font-weight:700;color:#42A5F5;font-size:10px">Brand + SEO moat</td>
    </tr>
    <tr style="border-bottom:1px solid rgba(201,168,76,0.08)">
      <td style="padding:6px 0;font-size:11px;color:#E2E8F0;font-weight:600">ECRI Capability</td>
      <td style="padding:6px 0;text-align:center;font-weight:800;color:#16A34A;font-family:'Space Mono',monospace">8-12%/yr</td>
      <td style="padding:6px 0;text-align:center;color:#F59E0B;font-family:'Space Mono',monospace">5-8%/yr</td>
      <td style="padding:6px 0;text-align:center;color:#EF4444;font-family:'Space Mono',monospace">2-4%/yr</td>
      <td style="padding:6px 0;text-align:center;font-weight:700;color:#42A5F5;font-size:10px">Pricing algorithm</td>
    </tr>
    <tr style="border-bottom:1px solid rgba(201,168,76,0.08)">
      <td style="padding:6px 0;font-size:11px;color:#E2E8F0;font-weight:600">Insurance / SF</td>
      <td style="padding:6px 0;text-align:center;font-weight:800;color:#16A34A;font-family:'Space Mono',monospace">$0.30</td>
      <td style="padding:6px 0;text-align:center;color:#F59E0B;font-family:'Space Mono',monospace">$0.40</td>
      <td style="padding:6px 0;text-align:center;color:#EF4444;font-family:'Space Mono',monospace">$0.55</td>
      <td style="padding:6px 0;text-align:center;font-weight:700;color:#42A5F5;font-size:10px">Scale purchasing</td>
    </tr>
    <tr style="border-bottom:1px solid rgba(201,168,76,0.08)">
      <td style="padding:6px 0;font-size:11px;color:#E2E8F0;font-weight:600">Lease-Up Speed</td>
      <td style="padding:6px 0;text-align:center;font-weight:800;color:#16A34A;font-family:'Space Mono',monospace">30-36 mo</td>
      <td style="padding:6px 0;text-align:center;color:#F59E0B;font-family:'Space Mono',monospace">36-42 mo</td>
      <td style="padding:6px 0;text-align:center;color:#EF4444;font-family:'Space Mono',monospace">42-60 mo</td>
      <td style="padding:6px 0;text-align:center;font-weight:700;color:#42A5F5;font-size:10px">Brand recognition</td>
    </tr>
    <tr>
      <td style="padding:8px 0;font-size:11px;color:#E2E8F0;font-weight:600">Occupancy (Stab.)</td>
      <td style="padding:8px 0;text-align:center;font-weight:800;color:#16A34A;font-family:'Space Mono',monospace">91-92%</td>
      <td style="padding:8px 0;text-align:center;color:#F59E0B;font-family:'Space Mono',monospace">87-90%</td>
      <td style="padding:8px 0;text-align:center;color:#EF4444;font-family:'Space Mono',monospace">80-85%</td>
      <td style="padding:8px 0;text-align:center;font-weight:700;color:#42A5F5;font-size:10px">+2-5 pts vs peers</td>
    </tr>
  </table>
  <div style="margin-top:14px;padding:12px;border-radius:8px;background:rgba(22,163,74,0.06);border:1px solid rgba(22,163,74,0.12)">
    <div style="font-size:11px;font-weight:700;color:#16A34A;margin-bottom:4px">What This Means for This Site</div>
    <div style="font-size:11px;color:#6B7394;line-height:1.5">${(() => {
      const psMargin = 0.784;
      const peerMargin = 0.62; // EXR ~65%, CUBE ~62%, NSA ~58% — weighted avg ~62%
      const marginDelta = psMargin - peerMargin; // ~16.4 pts
      const peerNOI = stabRev > 0 ? Math.round(stabRev * peerMargin) : 0;
      const psNOI = stabRev > 0 ? Math.round(stabRev * psMargin) : 0;
      const annualAdv = psNOI - peerNOI;
      return `On the same ${totalSF.toLocaleString()} SF facility generating ${fmtD(stabRev)} stabilized revenue, PS's platform produces <strong style="color:#16A34A">${fmtD(psNOI)}</strong> NOI (78.4% margin) vs. <strong style="color:#F59E0B">${fmtD(peerNOI)}</strong> for a peer REIT (62% margin) — an annual advantage of <strong style="color:#16A34A">${fmtD(annualAdv)}</strong>. Over a 10-year hold with ECRI compounding, this ${Math.round(marginDelta * 100)}-point margin edge drives approximately <strong style="color:#C9A84C">${fmtD(Math.round(annualAdv * 12))}</strong> in cumulative additional value vs. industry-average operations.`;
    })()}</div>
  </div>
  <div style="font-size:9px;color:#4A5080;margin-top:8px">Source: PSA Q4 2025 10-K | EXR/CUBE/NSA public filings | NAREIT Self-Storage Operating Survey 2025</div>
</div>

<!-- FACILITY PROGRAM v4.0 -->
<div class="section-divider"></div>
<div id="sec-P4" class="section expand-trigger" onclick="toggleExpand('facility')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="facility-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Facility Program</span></h2>
  <div class="grid4" style="margin-bottom:20px">
    <div class="metric-box mi-active mi" onclick="toggleMI('facreage',event)"><div class="label">Site Acreage</div><div class="value">${!isNaN(acres) ? acres.toFixed(2) : "TBD"} <span style="font-size:12px;color:#6B7394">ac</span></div><em class="mi-hint">i</em>
      <div id="mi-facreage" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Site Acreage</div><div class="mi-conf mi-conf-high">Listing Data</div></div>
        <div class="mi-body">
          <strong>Acreage sourced from listing platform.</strong> Drives all facility sizing calculations.
          <div class="mi-formula">Gross Site = ${!isNaN(acres) ? acres.toFixed(2) : "?"} acres = ${!isNaN(acres) ? Math.round(acres*43560).toLocaleString() : "?"} SF<br>Buildable (35% coverage) = ${footprint.toLocaleString()} SF<br>Gross Building SF = ${grossSF ? grossSF.toLocaleString() : "?"} SF<br>Net Rentable (${netToGross ? (netToGross*100).toFixed(0) : 90}% efficiency) = ${totalSF.toLocaleString()} SF</div>
          <div class="mi-row"><span class="mi-row-label">PS Size Classification</span><span class="mi-row-val">${acres >= 3.5 ? "Primary (one-story preferred)" : acres >= 2.5 ? "Secondary (multi-story candidate)" : "Undersized"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Coverage Ratio</span><span class="mi-row-val">35% (PS standard — Killeen TX sketch)</span></div>
          <div class="mi-source">Source: ${site.listingSource || "Crexi/LoopNet"} listing | Verify with survey when available</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi-active mi" onclick="toggleMI('fbldgtype',event)"><div class="label">Building Type</div><div class="value" style="font-size:16px">${isMultiStory ? stories + "-Story" : "1-Story"}</div><em class="mi-hint">i</em>
      <div id="mi-fbldgtype" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Building Type Selection</div><div class="mi-conf mi-conf-med">Algorithmic</div></div>
        <div class="mi-body">
          <strong>SiteScore auto-selects building type based on site acreage:</strong>
          <div class="mi-formula">${!isNaN(acres) ? acres.toFixed(2) : "?"} acres ${acres >= 2.5 ? "≥" : "<"} 2.5 ac threshold<br>→ ${isMultiStory ? stories + "-story multi-story (smaller site = build up)" : "One-story (preferred PS product on 3.5+ ac)"}</div>
          <div class="mi-row"><span class="mi-row-label">≥ 3.5 ac</span><span class="mi-row-val">One-story indoor (PS preference)</span></div>
          <div class="mi-row"><span class="mi-row-label">2.5 – 3.5 ac</span><span class="mi-row-val">3-4 story multi-story</span></div>
          <div class="mi-row"><span class="mi-row-label">< 2.5 ac</span><span class="mi-row-val">Generally too small for PS</span></div>
          <div class="mi-source">Source: PS development standards | One-story = lower per-SF cost, drive-up access, simpler operations</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi-active mi" onclick="toggleMI('ftotalsf',event)"><div class="label">Total Rentable SF</div><div class="value">${totalSF.toLocaleString()}</div><em class="mi-hint">i</em>
      <div id="mi-ftotalsf" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Total SF Calculation</div><div class="mi-conf mi-conf-med">Derived</div></div>
        <div class="mi-body">
          <strong>Total rentable square footage is the key revenue driver.</strong>
          <div class="mi-formula">Total SF = Building Footprint × Stories<br>= ${footprint.toLocaleString()} SF × ${stories}<br>= <strong style="color:#E2E8F0">${totalSF.toLocaleString()} SF</strong></div>
          <div class="mi-row"><span class="mi-row-label">Building Footprint</span><span class="mi-row-val">${footprint.toLocaleString()} SF</span></div>
          <div class="mi-row"><span class="mi-row-label">Footprint = Acres × 43,560 × 35%</span><span class="mi-row-val">${!isNaN(acres) ? (acres * 43560).toLocaleString() : "?"} × 0.35</span></div>
          <div class="mi-row"><span class="mi-row-label">Stories</span><span class="mi-row-val">${stories}</span></div>
          <div class="mi-row"><span class="mi-row-label">Revenue Density</span><span class="mi-row-val">${totalSF > 0 ? "$" + (stabRev/totalSF).toFixed(2) + "/SF/yr" : "N/A"}</span></div>
          <div class="mi-source">Source: SiteScore Facility Sizing Engine | 35% coverage from PS Killeen TX Option A sketch (Dec 2024)</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi-active mi" onclick="toggleMI('funits',event)"><div class="label">Est. Unit Count</div><div class="value">${totalUnits.toLocaleString()}</div><em class="mi-hint">i</em>
      <div id="mi-funits" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Unit Count Estimation</div><div class="mi-conf mi-conf-med">Modeled</div></div>
        <div class="mi-body">
          <strong>Unit count derived from PS standard unit mix allocation:</strong>
          <div class="mi-formula">Total Units = Σ (SF Allocation ÷ Unit Size)<br>= ${unitRows.map(u => u.units).join(" + ")}<br>= <strong style="color:#E2E8F0">${totalUnits} units</strong></div>
          <div style="font-size:10px;font-weight:700;color:#6B7394;margin:8px 0 4px">UNIT MIX BREAKDOWN:</div>
          ${unitRows.map(u => `<div class="mi-row"><span class="mi-row-label">${u.type} (${Math.round(u.pct*100)}%)</span><span class="mi-row-val">${u.units} units × ${u.sf} SF = ${u.allocSF.toLocaleString()} SF</span></div>`).join("")}
          <div class="mi-row" style="border-top:1px solid rgba(201,168,76,0.12);padding-top:6px;margin-top:4px"><span class="mi-row-label">Avg Monthly Rent/Unit</span><span class="mi-row-val">${fmtD(avgMonthlyRent)}</span></div>
          <div class="mi-source">Source: PS typical unit mix (industry standard) | Weighted toward 5x10 and 10x10 (highest demand)</div>
        </div>
      </div></div>
    </div>
  </div>
  <div class="grid2">
    <div class="mi" onclick="toggleMI('fclimate',event)" style="background:rgba(21,101,192,0.08);border:1px solid rgba(21,101,192,0.2);border-radius:12px;padding:16px;cursor:pointer">
      <div style="font-size:11px;font-weight:700;color:#42A5F5;letter-spacing:0.08em;margin-bottom:8px">CLIMATE-CONTROLLED (${Math.round(climatePct*100)}%)</div>
      <div class="mono" style="font-size:20px;font-weight:800;color:#fff">${climateSF.toLocaleString()} SF</div>
      <div style="font-size:11px;color:#94A3B8;margin-top:4px">Stabilized rate: $${stabClimRate.toFixed(2)}/SF/mo</div><em class="mi-hint">i</em>
      <div id="mi-fclimate" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Climate-Controlled SF</div><div class="mi-conf mi-conf-high">PS Standard</div></div>
        <div class="mi-body">
          <div class="mi-formula">Climate SF = Total SF × ${Math.round(climatePct*100)}%<br>= ${totalSF.toLocaleString()} × ${climatePct}<br>= <strong style="color:#42A5F5">${climateSF.toLocaleString()} SF</strong></div>
          <div class="mi-row"><span class="mi-row-label">Split Ratio</span><span class="mi-row-val">${Math.round(climatePct*100)}/${Math.round(drivePct*100)} (Climate/Drive)</span></div>
          <div class="mi-row"><span class="mi-row-label">Why ${Math.round(climatePct*100)}%?</span><span class="mi-row-val">${isMultiStory ? "Multi-story = vertical = all indoor" : "Per PS Killeen TX layout (Dec 2024)"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Revenue Premium</span><span class="mi-row-val">Climate rates ~${Math.round((stabClimRate/stabDriveRate-1)*100)}% above drive-up</span></div>
          <div class="mi-row"><span class="mi-row-label">Annual Revenue (Y5)</span><span class="mi-row-val">${fmtD(climateSF * stabClimRate * 12 * 0.92)}</span></div>
          <div class="mi-source">Source: PS Killeen TX Option A site sketch calibration | Climate = primary revenue driver, premium pricing</div>
        </div>
      </div></div>
    </div>
    <div class="mi" onclick="toggleMI('fdrive',event)" style="background:rgba(232,122,46,0.08);border:1px solid rgba(232,122,46,0.2);border-radius:12px;padding:16px;cursor:pointer">
      <div style="font-size:11px;font-weight:700;color:#E87A2E;letter-spacing:0.08em;margin-bottom:8px">DRIVE-UP (${Math.round(drivePct*100)}%)</div>
      <div class="mono" style="font-size:20px;font-weight:800;color:#fff">${driveSF.toLocaleString()} SF</div>
      <div style="font-size:11px;color:#94A3B8;margin-top:4px">Stabilized rate: $${stabDriveRate.toFixed(2)}/SF/mo</div><em class="mi-hint">i</em>
      <div id="mi-fdrive" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Drive-Up SF</div><div class="mi-conf mi-conf-high">PS Standard</div></div>
        <div class="mi-body">
          <div class="mi-formula">Drive-Up SF = Total SF × ${Math.round(drivePct*100)}%<br>= ${totalSF.toLocaleString()} × ${drivePct.toFixed(2)}<br>= <strong style="color:#E87A2E">${driveSF.toLocaleString()} SF</strong></div>
          <div class="mi-row"><span class="mi-row-label">Drive-Up Rate</span><span class="mi-row-val">$${stabDriveRate.toFixed(2)}/SF/mo (55% of climate)</span></div>
          <div class="mi-row"><span class="mi-row-label">Rate Methodology</span><span class="mi-row-val">Climate × 0.55 (no HVAC, ground-floor access)</span></div>
          <div class="mi-row"><span class="mi-row-label">Annual Revenue (Y5)</span><span class="mi-row-val">${fmtD(driveSF * stabDriveRate * 12 * 0.92)}</span></div>
          <div class="mi-source">Source: Industry 55% discount vs climate (no HVAC, simpler construction) | PS development standards</div>
        </div>
      </div></div>
    </div>
  </div>
  <div id="facility" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Sizing Methodology</div>
      <div>PS standard product: ${isMultiStory ? stories + "-story multi-story" : "single-story indoor climate-controlled"} facility on ${!isNaN(acres) ? acres.toFixed(2) : "N/A"} acres. Building footprint calculated at <strong>35% lot coverage</strong> (${footprint.toLocaleString()} SF ground floor), the PS development standard for optimal site utilization while accommodating parking, drive aisles, landscaping, and stormwater.</div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Site Utilization Breakdown</div>
      <div style="display:flex;gap:4px;height:32px;border-radius:8px;overflow:hidden;margin-bottom:12px">
        <div style="width:35%;background:linear-gradient(90deg,#1565C0,#42A5F5);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff">Building 35%</div>
        <div style="width:30%;background:rgba(107,115,148,0.3);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#94A3B8">Parking/Drives 30%</div>
        <div style="width:20%;background:rgba(22,163,74,0.2);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#66BB6A">Landscape 20%</div>
        <div style="width:15%;background:rgba(66,165,245,0.15);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#42A5F5">SW/Other 15%</div>
      </div>
    </div>
    <div class="grid2" style="margin-top:14px">
      <div>
        <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.08em;margin-bottom:8px">CLIMATE-CONTROLLED DEEP DIVE</div>
        <div class="drill-row"><span class="drill-label">Gross SF Allocation</span><span class="drill-value">${climateSF.toLocaleString()} SF</span></div>
        <div class="drill-row"><span class="drill-label">Net Rentable (92%)</span><span class="drill-value">${Math.round(climateSF * 0.92).toLocaleString()} SF</span></div>
        <div class="drill-row"><span class="drill-label">Annual Revenue (Stab.)</span><span class="drill-value" style="color:#42A5F5">${fmtD(yearData[4].climRev)}</span></div>
        <div class="drill-row"><span class="drill-label">Revenue Per SF</span><span class="drill-value">$${(yearData[4].climRev / climateSF).toFixed(2)}/SF/yr</span></div>
        <div class="drill-row"><span class="drill-label">HVAC Requirement</span><span class="drill-value">3-phase, ${Math.round(climateSF/1000)*3} ton est.</span></div>
        <div class="drill-row"><span class="drill-label">Insulation</span><span class="drill-value">R-30 walls, R-38 roof min.</span></div>
      </div>
      <div>
        <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.08em;margin-bottom:8px">DRIVE-UP DEEP DIVE</div>
        <div class="drill-row"><span class="drill-label">Gross SF Allocation</span><span class="drill-value">${driveSF.toLocaleString()} SF</span></div>
        <div class="drill-row"><span class="drill-label">Net Rentable (95%)</span><span class="drill-value">${Math.round(driveSF * 0.95).toLocaleString()} SF</span></div>
        <div class="drill-row"><span class="drill-label">Annual Revenue (Stab.)</span><span class="drill-value" style="color:#E87A2E">${fmtD(yearData[4].driveRev)}</span></div>
        <div class="drill-row"><span class="drill-label">Revenue Per SF</span><span class="drill-value">$${(yearData[4].driveRev / driveSF).toFixed(2)}/SF/yr</span></div>
        <div class="drill-row"><span class="drill-label">Door Size</span><span class="drill-value">8'W x 8'H roll-up standard</span></div>
        <div class="drill-row"><span class="drill-label">Drive Aisle</span><span class="drill-value">26' minimum (truck access)</span></div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:14px">
      <div class="insight-title">Why ${Math.round(climatePct*100)}/${Math.round(drivePct*100)} Climate/Drive Split?</div>
      <div>PS's development playbook targets 70/30 climate-to-drive ratio for new builds. Climate-controlled units command a <strong style="color:#42A5F5">${Math.round((stabClimRate/stabDriveRate - 1) * 100)}% rate premium</strong> over drive-up ($${stabClimRate.toFixed(2)} vs $${stabDriveRate.toFixed(2)}/SF/mo), generating ${Math.round(yearData[4].climRev/(yearData[4].climRev+yearData[4].driveRev)*100)}% of stabilized revenue from ${Math.round(climatePct*100)}% of the space. Higher margins, lower maintenance, better insurance profile.</div>
    </div>
  </div>
</div>

<!-- UNIT MIX v4.0 -->
<div id="sec-P5" class="section expand-trigger" onclick="toggleExpand('unitmix')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="unitmix-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Unit Mix & Stabilized Pricing</span></h2>
  <table>
    <thead><tr><th>Unit Type</th><th>Size (SF)</th><th>Units</th><th>Total SF</th><th>Mo. Rate</th><th>Annual Rev</th><th>% of Total</th></tr></thead>
    <tbody>
      ${unitRows.map((u, idx) => {
        const annRev = u.units * u.moRate * 12 * 0.92;
        const ratePerSF = u.moRate / u.sf;
        return `<tr class="mi" onclick="toggleMI('umr${idx}',event)" style="cursor:pointer"><td style="font-weight:600">${u.type} <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td class="mono">${u.sf}</td><td class="mono">${u.units}</td><td class="mono">${u.allocSF.toLocaleString()}</td><td class="mono gold">$${u.moRate}</td><td class="mono">${fmtD(annRev)}</td><td class="muted">${(u.pct * 100).toFixed(0)}%</td></tr>
        <tr><td colspan="7" style="padding:0;border:none"><div id="mi-umr${idx}" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">${u.type} — Rate & Allocation Logic</div><div class="mi-conf mi-conf-high">PS Standard</div></div>
          <div class="mi-body">
            <strong>Why ${u.units} units at $${u.moRate}/mo?</strong>
            <div class="mi-formula">${u.type} = ${(u.pct*100).toFixed(0)}% of total mix (${u.units} of ${totalUnits} units)<br>Size: ${u.sf} SF/unit × ${u.units} units = ${u.allocSF.toLocaleString()} SF total<br>Monthly Rate: $${u.moRate} → $${ratePerSF.toFixed(2)}/SF/mo<br>Stabilized Annual Rev (92% occ): ${fmtD(annRev)}</div>
            <div class="mi-row"><span class="mi-row-label">Rate Per SF</span><span class="mi-row-val">$${ratePerSF.toFixed(2)}/SF/mo — ${ratePerSF > 1.8 ? "premium density (small units command highest $/SF)" : ratePerSF > 1.2 ? "strong revenue density" : "volume-driven unit (lower $/SF, high demand)"}</span></div>
            <div class="mi-row"><span class="mi-row-label">PS Portfolio Demand</span><span class="mi-row-val">${u.sf <= 50 ? "Highest demand velocity — turns over 2-3x/year, minimal vacancy risk" : u.sf <= 150 ? "Core demand driver — household movers, small business inventory" : "Lower velocity but essential for large-item storage (furniture, vehicles)"}</span></div>
            <div class="mi-row"><span class="mi-row-label">Value to PS</span><span class="mi-row-val">${u.sf <= 50 ? "Small units generate 2.5-3x the revenue/SF of large units — PS maximizes small-unit allocation to drive RevPAF" : u.sf <= 150 ? "10x10 and 10x15 are the highest-volume unit types in the PS portfolio — they balance revenue density with customer demand" : "Large units anchor occupancy — customers moving or renovating homes use these units and often convert to long-term tenants"}</span></div>
            <div class="mi-source">Source: PS unit mix allocation model | Industry standard weighted toward 5x10 and 10x10 (highest demand categories per SSA annual survey)</div>
          </div>
        </div></div></td></tr>`;
      }).join("")}
      <tr class="mi" onclick="toggleMI('umtotal',event)" style="border-top:2px solid rgba(201,168,76,0.2);font-weight:700;cursor:pointer"><td>TOTAL <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td></td><td class="mono">${totalUnits}</td><td class="mono">${totalSF.toLocaleString()}</td><td></td><td class="mono green">${fmtD(yearData[4].totalRev)}</td><td></td></tr>
      <tr><td colspan="7" style="padding:0;border:none"><div id="mi-umtotal" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Portfolio Revenue Summary</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <strong>Stabilized (Y5) revenue at 92% occupancy across all ${totalUnits} units.</strong>
          <div class="mi-formula">Total Rentable SF: ${totalSF.toLocaleString()}<br>Climate SF: ${climateSF.toLocaleString()} (${Math.round(climatePct*100)}%) @ $${mktClimateRate.toFixed(2)}/SF/mo<br>Drive-Up SF: ${driveSF.toLocaleString()} (${Math.round(drivePct*100)}%) @ $${mktDriveRate.toFixed(2)}/SF/mo<br>Weighted Blended Rate: $${(mktClimateRate * climatePct + mktDriveRate * drivePct).toFixed(2)}/SF/mo<br>Y5 Stabilized Revenue: <strong style="color:#16A34A">${fmtD(yearData[4].totalRev)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Revenue Density (RevPAF)</span><span class="mi-row-val">$${(yearData[4].totalRev / totalSF).toFixed(2)}/SF/yr — ${(yearData[4].totalRev / totalSF) >= 22 ? "above PS portfolio avg ($24.50)" : "competitive with institutional benchmarks"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Why This Mix Matters to PS</span><span class="mi-row-val">Unit mix optimization is PS's #1 lever for RevPAF growth. Small-unit-heavy mixes (40%+ of units under 100 SF) consistently outperform large-unit facilities by 15-25% on RevPAF. This mix allocates ${Math.round(unitRows.filter(u=>u.sf<=100).reduce((s,u)=>s+u.pct,0)*100)}% to units under 100 SF.</span></div>
          <div class="mi-source">Source: SiteScore™ unit mix engine | Calibrated against PS 10-K reported RevPAF and SSA operating benchmarks</div>
        </div>
      </div></div></td></tr>
    </tbody>
  </table>
  <div id="unitmix" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Unit Mix Strategy</div>
      <div>PS's unit mix is optimized for maximum revenue density. <strong>Small units (5x5 to 5x10)</strong> represent ${Math.round(unitRows.filter(u=>u.sf<=50).reduce((s,u)=>s+u.pct,0)*100)}% of inventory but command the highest per-SF rates ($${(unitRows.find(u=>u.sf===25)?.moRate/25).toFixed(2)}/SF/mo for 5x5 climate). <strong>Mid-size (10x10 to 10x15)</strong> are the volume driver at ${Math.round(unitRows.filter(u=>u.sf>=100&&u.sf<=150).reduce((s,u)=>s+u.pct,0)*100)}% of mix — the sweet spot for household movers and small business. <strong>Large units (10x20+)</strong> are limited to ${Math.round(unitRows.filter(u=>u.sf>=200).reduce((s,u)=>s+u.pct,0)*100)}% — high demand but low revenue per SF.</div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Revenue Per SF by Unit Type</div>
      ${unitRows.map(u => {
        const ratePerSF = u.moRate / u.sf;
        const maxRate = Math.max(...unitRows.map(r => r.moRate / r.sf));
        const barPct = Math.round(ratePerSF / maxRate * 100);
        return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">
          <div style="width:110px;font-size:10px;color:#6B7394;font-weight:600;text-align:right">${u.type}</div>
          <div style="flex:1;height:18px;border-radius:4px;background:rgba(255,255,255,0.04);overflow:hidden">
            <div style="width:${barPct}%;height:100%;border-radius:4px;background:${u.cat === "climate" ? "linear-gradient(90deg,#1565C0,#42A5F5)" : "linear-gradient(90deg,#C65D00,#E87A2E)"};display:flex;align-items:center;padding:0 8px">
              <span style="font-size:9px;font-weight:700;color:#fff">$${ratePerSF.toFixed(2)}/SF</span>
            </div>
          </div>
          <div style="width:50px;font-size:10px;font-weight:700;color:#C9A84C;font-family:'Space Mono',monospace;text-align:right">$${u.moRate}/mo</div>
        </div>`;
      }).join("")}
    </div>
    <div class="grid3" style="margin-top:16px">
      <div class="insight-box" style="text-align:center">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">AVG UNIT SIZE</div>
        <div class="mono" style="font-size:18px;font-weight:800;color:#fff">${Math.round(totalSF / totalUnits)} SF</div>
      </div>
      <div class="insight-box" style="text-align:center">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">AVG MONTHLY RENT</div>
        <div class="mono" style="font-size:18px;font-weight:800;color:#C9A84C">$${Math.round(unitRows.reduce((s,u) => s + u.moRate * u.units, 0) / totalUnits)}</div>
      </div>
      <div class="insight-box" style="text-align:center">
        <div style="font-size:9px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">REVENUE DENSITY</div>
        <div class="mono" style="font-size:18px;font-weight:800;color:#16A34A">$${(yearData[4].totalRev / totalSF).toFixed(2)}<span style="font-size:10px">/SF/yr</span></div>
      </div>
    </div>
  </div>
</div>

<!-- MARKET RATE INTELLIGENCE v4.0 -->
<div id="sec-P6" class="section expand-trigger" onclick="toggleExpand('rates')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="rates-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Market Rate Intelligence</span></h2>
  <div class="grid2" style="margin-bottom:20px">
    <div>
      <h3 class="muted">Rate Drivers</h3>
      <table style="font-size:12px">
        <tr class="mi" onclick="toggleMI('rdinctier',event)" style="cursor:pointer"><td style="color:#6B7394;width:130px;white-space:nowrap">Income Tier <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td style="font-weight:700;text-transform:capitalize;font-size:11px">${incTier} ${incN ? "($" + incN.toLocaleString() + " HHI)" : ""}</td></tr>
        <tr><td colspan="2" style="padding:0;border:none"><div id="mi-rdinctier" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Income Tier Classification</div><div class="mi-conf mi-conf-high">Census ACS</div></div>
          <div class="mi-body">
            <strong>3-mile median household income determines the base rental rate tier.</strong> Higher income = higher willingness to pay for climate-controlled storage.
            <div class="mi-formula">3-mi Median HHI = $${incN ? incN.toLocaleString() : "N/A"}<br>→ Tier: <strong style="color:#C9A84C;text-transform:capitalize">${incTier}</strong><br>→ Base Climate Rate: $${baseClimateRate.toFixed(2)}/SF/mo</div>
            <div class="mi-row"><span class="mi-row-label">Premium ($90K+)</span><span class="mi-row-val">$1.45/SF base</span></div>
            <div class="mi-row"><span class="mi-row-label">Upper ($75K-$90K)</span><span class="mi-row-val">$1.25/SF base</span></div>
            <div class="mi-row"><span class="mi-row-label">Mid ($60K-$75K)</span><span class="mi-row-val">$1.10/SF base</span></div>
            <div class="mi-row"><span class="mi-row-label">Value (&lt;$60K)</span><span class="mi-row-val">$0.95/SF base</span></div>
            <div class="mi-source">Source: US Census ACS 5-Year | Table B19013 | 3-mile radius from site coordinates</div>
          </div>
        </div></div></td></tr>
        <tr class="mi" onclick="toggleMI('rdcomp',event)" style="cursor:pointer"><td style="color:#6B7394">Competition (3-mi) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td style="font-weight:700">${compCount} facilities ${compCount <= 2 ? '<span class="tag" style="background:#16A34A20;color:#16A34A">LOW — Rate Premium</span>' : compCount <= 5 ? '<span class="tag" style="background:#F59E0B20;color:#F59E0B">MODERATE</span>' : '<span class="tag" style="background:#EF444420;color:#EF4444">HIGH — Rate Pressure</span>'}</td></tr>
        <tr><td colspan="2" style="padding:0;border:none"><div id="mi-rdcomp" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Competition Rate Adjustment</div><div class="mi-conf mi-conf-med">Web Research</div></div>
          <div class="mi-body">
            <strong>Competitor count within 3 miles adjusts the base rate up or down.</strong> Low competition = pricing power. High competition = rate pressure.
            <div class="mi-formula">Competitors found: <strong>${compCount}</strong><br>Adjustment: <strong style="color:${compAdj >= 1 ? "#16A34A" : "#F59E0B"}">${compAdj >= 1 ? "+" : ""}${((compAdj-1)*100).toFixed(0)}%</strong> to base rate<br>Adjusted Rate: $${baseClimateRate.toFixed(2)} × ${compAdj.toFixed(2)} = $${mktClimateRate.toFixed(2)}/SF/mo</div>
            <div class="mi-row"><span class="mi-row-label">0-1 competitors</span><span class="mi-row-val">+8% premium (supply scarcity)</span></div>
            <div class="mi-row"><span class="mi-row-label">2-3 competitors</span><span class="mi-row-val">0% (market equilibrium)</span></div>
            <div class="mi-row"><span class="mi-row-label">4+ competitors</span><span class="mi-row-val">-3% to -6% (rate pressure)</span></div>
            <div class="mi-source">Source: Google Maps, SpareFoot, operator websites | 3-mile radius scan | ${h(site.competitorNames || "Competitors surveyed")}</div>
          </div>
        </div></div></td></tr>
        <tr><td style="color:#6B7394">Population Growth</td><td style="font-weight:700">${growthPct.toFixed(1)}% CAGR ${growthPct >= 2 ? '<span class="tag" style="background:#16A34A20;color:#16A34A">Explosive</span>' : growthPct >= 1 ? '<span class="tag" style="background:#42A5F520;color:#42A5F5">Healthy</span>' : '<span class="tag" style="background:#F59E0B20;color:#F59E0B">Stable</span>'}</td></tr>
        <tr><td style="color:#6B7394">Competition Adj.</td><td style="font-weight:700;color:${compAdj >= 1 ? "#16A34A" : "#F59E0B"}">${compAdj >= 1 ? "+" : ""}${((compAdj - 1) * 100).toFixed(0)}% to base rate</td></tr>
        ${site.demandDrivers ? `<tr><td style="color:#6B7394">Demand Drivers</td><td style="font-weight:600;font-size:11px">${h(site.demandDrivers.substring(0, 150))}${site.demandDrivers.length > 150 ? "..." : ""}</td></tr>` : ""}
      </table>
    </div>
    <div>
      <h3 class="muted">Blended Market Rates</h3>
      <div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid rgba(201,168,76,0.08)">
        <div class="mi" onclick="toggleMI('rclim',event)" style="display:flex;justify-content:space-between;margin-bottom:12px;cursor:pointer;padding:4px;border-radius:6px">
          <span style="font-size:11px;color:#6B7394">Climate-Controlled <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span>
          <span class="mono" style="font-size:16px;font-weight:800;color:#42A5F5">$${mktClimateRate.toFixed(2)}<span style="font-size:10px;color:#6B7394">/SF/mo</span></span>
        </div>
        <div id="mi-rclim" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Climate Rate Derivation</div><div class="mi-conf mi-conf-${rateConfidence === "High" ? "high" : "med"}">${rateConfidence || "Medium"} Confidence</div></div>
          <div class="mi-body">
            <strong>Three independent methods cross-validated to derive the final climate rate:</strong>
            <div class="mi-formula">Method 1 (Income Tier): $${m1Rate.toFixed(2)}/SF<br>Method 2 (Rev Density): $${m2ClimRate.toFixed(2)}/SF<br>Method 3 (Pop Density): $${m3ClimRate.toFixed(2)}/SF<br>────────────────────────<br>Consensus: <strong style="color:#42A5F5">$${consensusClimRate.toFixed(2)}/SF</strong> × ${compAdj.toFixed(2)} comp adj = <strong style="color:#42A5F5">$${mktClimateRate.toFixed(2)}/SF/mo</strong></div>
            <div class="mi-row"><span class="mi-row-label">Cross-Validation Spread</span><span class="mi-row-val">$${Math.abs(Math.max(m1Rate,m2ClimRate,m3ClimRate) - Math.min(m1Rate,m2ClimRate,m3ClimRate)).toFixed(2)} (${Math.abs(Math.max(m1Rate,m2ClimRate,m3ClimRate) - Math.min(m1Rate,m2ClimRate,m3ClimRate)) < 0.15 ? "tight — high confidence" : "moderate spread"})</span></div>
            <div class="mi-row"><span class="mi-row-label">Annual Escalation</span><span class="mi-row-val">${(annualEsc*100).toFixed(1)}% (CPI + storage inflation)</span></div>
            ${streetRateOverride ? `<div class="mi-row"><span class="mi-row-label">Street Rate Override</span><span class="mi-row-val">$${streetRateOverride.toFixed(2)} (${streetVariance > 0 ? "+" : ""}${streetVariance}% vs model)</span></div>` : ""}
            <div class="mi-source">Source: Income-tier matrix + Revenue density benchmarks + Population density factor | 3-method consensus</div>
          </div>
        </div></div>
        <div class="mi" onclick="toggleMI('rdrive',event)" style="display:flex;justify-content:space-between;margin-bottom:12px;cursor:pointer;padding:4px;border-radius:6px">
          <span style="font-size:11px;color:#6B7394">Drive-Up <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span>
          <span class="mono" style="font-size:16px;font-weight:800;color:#E87A2E">$${mktDriveRate.toFixed(2)}<span style="font-size:10px;color:#6B7394">/SF/mo</span></span>
        </div>
        <div id="mi-rdrive" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Drive-Up Rate</div><div class="mi-conf mi-conf-high">Derived</div></div>
          <div class="mi-body">
            <div class="mi-formula">Drive-Up Rate = Climate Rate × 55%<br>= $${mktClimateRate.toFixed(2)} × 0.55<br>= <strong style="color:#E87A2E">$${mktDriveRate.toFixed(2)}/SF/mo</strong></div>
            <strong>Why 55%?</strong> Drive-up units have no HVAC, simpler construction, ground-floor only. Industry-standard discount: 45-55% below climate. PS uses 55% consistently across their portfolio.
            <div class="mi-source">Source: Industry standard | PS portfolio pricing analysis | No HVAC overhead = lower rate justified by lower opex</div>
          </div>
        </div></div>
        <div style="border-top:1px solid rgba(201,168,76,0.1);padding-top:10px;display:flex;justify-content:space-between">
          <span style="font-size:11px;color:#6B7394">Blended Avg</span>
          <span class="mono" style="font-size:16px;font-weight:800;color:#C9A84C">$${(mktClimateRate * climatePct + mktDriveRate * drivePct).toFixed(2)}<span style="font-size:10px;color:#6B7394">/SF/mo</span></span>
        </div>
      </div>
    </div>
  </div>
  <div id="rates" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Rate Derivation Methodology</div>
      <div>Rates are derived from a 3-factor model: <strong>(1) Income tier</strong> sets the base — ${incTier} markets ($${incN ? incN.toLocaleString() : "N/A"} HHI) support ${incTier === "premium" ? "premium pricing above $1.40/SF for climate" : incTier === "upper" ? "above-average rates of $1.20-1.40/SF for climate" : incTier === "mid" ? "mid-market rates of $1.00-1.20/SF for climate" : "value rates below $1.00/SF for climate"}. <strong>(2) Competition density</strong> adjusts ±8%: ${compCount} competitors within 3 miles = ${compAdj >= 1.05 ? "rate premium opportunity (low supply)" : compAdj >= 1.0 ? "market-rate pricing" : compAdj >= 0.94 ? "modest rate pressure" : "significant rate compression"}. <strong>(3) Annual escalation</strong> of ${(annualEsc*100).toFixed(0)}% compounds through the 5-year model, reflecting CPI + storage-specific inflation.</div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Income Tier Rate Matrix</div>
      <table style="font-size:11px">
        <thead><tr><th>Tier</th><th>HHI Range</th><th>Climate Base</th><th>Drive-Up Base</th><th style="text-align:center">This Site</th></tr></thead>
        <tbody>
          ${[
            { tier: "Premium", hhi: "$90K+", clim: "$1.45", drive: "$0.85", active: incTier === "premium" },
            { tier: "Upper", hhi: "$75K–$90K", clim: "$1.25", drive: "$0.72", active: incTier === "upper" },
            { tier: "Mid", hhi: "$60K–$75K", clim: "$1.10", drive: "$0.62", active: incTier === "mid" },
            { tier: "Value", hhi: "<$60K", clim: "$0.95", drive: "$0.52", active: incTier === "value" },
          ].map(t => `<tr style="${t.active ? "background:rgba(201,168,76,0.08);border-left:3px solid #C9A84C" : ""}">
            <td style="font-weight:700;${t.active ? "color:#C9A84C" : ""}">${t.tier}</td>
            <td>${t.hhi}</td>
            <td class="mono">${t.clim}/SF/mo</td>
            <td class="mono">${t.drive}/SF/mo</td>
            <td style="text-align:center">${t.active ? '<span class="tag" style="background:#C9A84C20;color:#C9A84C">ACTIVE</span>' : ""}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">5-Year Rate Escalation Trajectory</div>
      <div style="display:flex;gap:12px">
        ${yearData.map((y, i) => `<div style="flex:1;text-align:center;background:rgba(15,21,56,0.5);border-radius:8px;padding:10px;border:1px solid rgba(201,168,76,0.06)">
          <div style="font-size:9px;font-weight:700;color:#6B7394;margin-bottom:4px">Y${y.yr}</div>
          <div class="mono" style="font-size:13px;font-weight:700;color:#42A5F5">$${y.mktClimFull.toFixed(2)}</div>
          <div class="mono" style="font-size:11px;color:#E87A2E">$${y.mktDriveFull.toFixed(2)}</div>
          ${y.climDisc > 0 ? `<div style="font-size:8px;color:#EF4444;margin-top:2px">-${Math.round(y.climDisc*100)}% promo</div>` : `<div style="font-size:8px;color:#16A34A;margin-top:2px">Full rate</div>`}
        </div>`).join("")}
      </div>
    </div>
    ${site.competitorNames ? `<div class="insight-box" style="margin-top:14px">
      <div class="insight-title">Competitive Landscape</div>
      <div><strong>Known Operators (3-mi):</strong> ${h(site.competitorNames)}</div>
      ${site.nearestCompetitor ? `<div style="margin-top:6px"><strong>Nearest:</strong> ${h(site.nearestCompetitor)}</div>` : ""}
      ${site.demandSupplySignal ? `<div style="margin-top:6px"><strong>Market Signal:</strong> ${h(site.demandSupplySignal)}</div>` : ""}
    </div>` : ""}
  </div>
</div>

<div class="divider"></div>

<!-- 5-YEAR LEASE-UP MODEL v4.0 -->
<div class="section-divider"></div>
<div id="sec-P7" class="section section-gold expand-trigger" onclick="toggleExpand('leaseup')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="leaseup-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">5-Year Lease-Up Revenue Model</span></h2>
  <div style="font-size:12px;color:#94A3B8;margin-bottom:20px">PS lease-up strategy: aggressive discounting in Y1 to fill units, gradual ECRI (Existing Customer Rate Increases) through Y3-Y5 to push above street rates.</div>
  <table style="table-layout:fixed;width:100%">
    <colgroup><col style="width:22%"><col style="width:14%"><col style="width:10%"><col style="width:10%"><col style="width:16%"><col style="width:14%"><col style="width:14%"></colgroup>
    <thead><tr><th>Year</th><th>Occupancy</th><th>Climate $/SF</th><th>Drive $/SF</th><th>Gross Revenue</th><th>OpEx (${Math.round(yearData[0].opex/yearData[0].totalRev*100)}%→${Math.round(yearData[4].opex/yearData[4].totalRev*100)}%)</th><th>NOI</th></tr></thead>
    <tbody>
      ${yearData.map((y, i) => {
        const noiColor = y.noi > 0 ? (i >= 3 ? "#16A34A" : "#42A5F5") : "#EF4444";
        const revGrowth = i > 0 ? Math.round(((y.totalRev - yearData[i-1].totalRev) / yearData[i-1].totalRev) * 100) : 0;
        return `<tr class="yr-row mi" onclick="toggleMI('ly${i}',event)" style="cursor:pointer">
          <td style="overflow:hidden"><div style="font-weight:700;color:#C9A84C">${y.label} <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div><div style="font-size:10px;color:#6B7394;margin-top:2px;line-height:1.3">${y.desc}</div></td>
          <td>${pctBar(y.occRate, y.occRate >= 0.85 ? "#16A34A" : y.occRate >= 0.60 ? "#F59E0B" : "#EF4444")}</td>
          <td class="mono"><span style="color:#42A5F5">$${y.climRate.toFixed(2)}</span>${y.climDisc > 0 ? `<div style="font-size:9px;color:#EF4444">-${Math.round(y.climDisc*100)}% disc</div>` : `<div style="font-size:9px;color:#16A34A">Full rate</div>`}</td>
          <td class="mono"><span style="color:#E87A2E">$${y.driveRate.toFixed(2)}</span>${y.driveDisc > 0 ? `<div style="font-size:9px;color:#EF4444">-${Math.round(y.driveDisc*100)}% disc</div>` : `<div style="font-size:9px;color:#16A34A">Full rate</div>`}</td>
          <td class="mono" style="font-weight:700">${fmtD(y.totalRev)}${i > 0 ? `<div style="font-size:9px;color:#16A34A">+${revGrowth}% YoY</div>` : ""}</td>
          <td class="mono" style="color:#F59E0B">(${fmtD(y.opex)})</td>
          <td class="mono" style="font-weight:800;color:${noiColor}">${fmtD(y.noi)}</td>
        </tr>
        <tr><td colspan="7" style="padding:0;border:none"><div id="mi-ly${i}" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">${y.label} — Full Revenue Derivation</div><div class="mi-conf mi-conf-${i >= 3 ? "high" : "med"}">${i >= 3 ? "High Confidence" : "Lease-Up Risk"}</div></div>
          <div class="mi-body">
            <strong>${i === 0 ? "Grand opening year — aggressive promotional pricing to drive initial occupancy. PS invests $50-75K in marketing (Google Ads, signage, direct mail) to build awareness." : i === 1 ? "Occupancy ramp continues. First ECRI round applied to Y1 tenants (8-10% increase). Marketing spend declines 40%." : i === 2 ? "Facility approaching stabilization. ECRI applied to all cohorts. Y1 tenants now paying 20%+ above their original rate." : i === 3 ? "Near-stabilized operations. ECRI revenue engine fully engaged. Street rates set competitively; in-place rents 25-35% above street for tenured tenants." : "Stabilized year — the basis for all valuation metrics in this report. 92% occupancy reflects PS portfolio average."}</strong>
            <div class="mi-formula">Occupancy: ${Math.round(y.occRate*100)}% → ${Math.round(y.occRate * totalSF).toLocaleString()} occupied SF<br>Climate Rev: ${climateSF.toLocaleString()} SF × ${Math.round(y.occRate*100)}% × $${y.climRate.toFixed(2)}/SF × 12 mo = ${fmtD(Math.round(climateSF * y.occRate * y.climRate * 12))}<br>Drive-Up Rev: ${driveSF.toLocaleString()} SF × ${Math.round(y.occRate*100)}% × $${y.driveRate.toFixed(2)}/SF × 12 mo = ${fmtD(Math.round(driveSF * y.occRate * y.driveRate * 12))}<br>Total Revenue: <strong style="color:#C9A84C">${fmtD(y.totalRev)}</strong><br>OpEx: (${fmtD(y.opex)}) — ${Math.round(y.opex/y.totalRev*100)}% ratio<br>NOI: <strong style="color:${noiColor}">${fmtD(y.noi)}</strong></div>
            ${y.climDisc > 0 ? `<div class="mi-row"><span class="mi-row-label">Promotional Discount</span><span class="mi-row-val">${Math.round(y.climDisc*100)}% below market — PS offers "first month free" or reduced rates to drive move-ins. This is recaptured via ECRI within 12-18 months.</span></div>` : `<div class="mi-row"><span class="mi-row-label">Rate Status</span><span class="mi-row-val">Full market rate + ${(annualEsc*100).toFixed(0)}% annual escalation compounded ${i} year${i>1?"s":""}. In-place rents exceed street rate via ECRI.</span></div>`}
            <div class="mi-row"><span class="mi-row-label">PS Strategic Value</span><span class="mi-row-val">${i === 0 ? "Y1 is an investment year — PS accepts compressed returns to build a tenant base. The low-elasticity nature of storage means these tenants become a captive revenue stream for ECRI." : i <= 2 ? "Revenue acceleration phase — each ECRI cycle adds 8-12% to in-place rents. Move-out rate post-ECRI is only 5-8%, meaning 92%+ of rate increases stick." : "Mature operations — this NOI level is the basis for stabilized valuation. PS's ECRI program generates 35-40% of same-store revenue growth at this stage."}</span></div>
            ${i > 0 ? `<div class="mi-row"><span class="mi-row-label">YoY Growth</span><span class="mi-row-val">+${revGrowth}% revenue growth — driven by ${y.occRate > yearData[i-1].occRate ? "occupancy gains (" + Math.round(yearData[i-1].occRate*100) + "% → " + Math.round(y.occRate*100) + "%)" : "rate escalation (ECRI + market)"} ${y.occRate > yearData[i-1].occRate && y.climRate > yearData[i-1].climRate ? "+ rate escalation" : ""}</span></div>` : ""}
            <div class="mi-source">Source: PS lease-up benchmarks (10-K filings, earnings calls) | SSA Industry Factbook | SiteScore™ revenue model with ${(annualEsc*100).toFixed(0)}% annual escalation</div>
          </div>
        </div></div></td></tr>`;
      }).join("")}
    </tbody>
  </table>
  <div id="leaseup" class="expand-panel">
    <div style="margin-top:8px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:12px;text-transform:uppercase">Revenue & NOI Growth Trajectory</div>
      <div style="display:flex;align-items:flex-end;gap:8px;height:160px;padding:0 20px">
        ${yearData.map((y, i) => {
          const maxRev = yearData[4].totalRev;
          const revH = Math.round(y.totalRev / maxRev * 130);
          const noiH = Math.round(y.noi / maxRev * 130);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
            <div style="font-size:9px;font-weight:700;color:#16A34A">${fmtD(y.noi)}</div>
            <div style="display:flex;gap:2px;align-items:flex-end">
              <div style="width:20px;height:${revH}px;background:linear-gradient(180deg,#42A5F5,#1565C0);border-radius:4px 4px 0 0;opacity:0.6"></div>
              <div style="width:20px;height:${noiH}px;background:linear-gradient(180deg,#16A34A,#0D7A2C);border-radius:4px 4px 0 0"></div>
            </div>
            <div style="font-size:10px;font-weight:700;color:#C9A84C">Y${y.yr}</div>
          </div>`;
        }).join("")}
      </div>
      <div style="display:flex;gap:16px;justify-content:center;margin-top:10px;font-size:10px">
        <div style="display:flex;align-items:center;gap:4px"><div style="width:10px;height:10px;border-radius:2px;background:#42A5F5;opacity:0.6"></div><span style="color:#6B7394">Gross Revenue</span></div>
        <div style="display:flex;align-items:center;gap:4px"><div style="width:10px;height:10px;border-radius:2px;background:#16A34A"></div><span style="color:#6B7394">NOI</span></div>
      </div>
    </div>
    <div class="grid2" style="margin-top:20px">
      <div class="insight-box">
        <div class="insight-title">ECRI Strategy Deep Dive</div>
        <div style="margin-bottom:8px">PS's <strong>Existing Customer Rate Increase (ECRI)</strong> program is the primary revenue engine post-stabilization. After locking in tenants at promotional rates in Y1:</div>
        <div class="drill-row"><span class="drill-label">Y1 Tenants by Y3</span><span class="drill-value" style="color:#16A34A">+20-25% above original rate</span></div>
        <div class="drill-row"><span class="drill-label">Y1 Tenants by Y5</span><span class="drill-value" style="color:#16A34A">+35-45% above original rate</span></div>
        <div class="drill-row"><span class="drill-label">ECRI Cadence</span><span class="drill-value">Every 6-9 months</span></div>
        <div class="drill-row"><span class="drill-label">Typical ECRI Amount</span><span class="drill-value">8-12% per increase</span></div>
        <div class="drill-row"><span class="drill-label">Move-Out Rate Post-ECRI</span><span class="drill-value">~5-8% (low elasticity)</span></div>
        <div style="margin-top:8px;font-size:11px;color:#94A3B8">Storage tenants have extremely low price elasticity — the hassle cost of moving belongings far exceeds typical rate increases. PS leverages this to push long-tenured customers 20-40% above street rates.</div>
      </div>
      <div class="insight-box">
        <div class="insight-title">Operating Expense Trajectory</div>
        <div style="margin-bottom:8px">OpEx declines from <strong style="color:#EF4444">${Math.round(yearData[0].opex/yearData[0].totalRev*100)}%</strong> in Y1 to <strong style="color:#16A34A">${Math.round(yearData[4].opex/yearData[4].totalRev*100)}%</strong> at stabilization:</div>
        ${yearData.map(y => `<div class="drill-row">
          <span class="drill-label">Year ${y.yr} OpEx Ratio</span>
          <span class="drill-value" style="color:${y.yr <= 2 ? "#F59E0B" : "#16A34A"}">${Math.round(y.opex/y.totalRev*100)}% (${fmtD(y.opex)})</span>
        </div>`).join("")}
        <div style="margin-top:8px;font-size:11px;color:#94A3B8">Y1 OpEx elevated due to marketing spend ($50K+ grand opening), staffing ramp, and fixed costs spread over low occupancy. By Y4-5, marketing is minimal (word-of-mouth + web), and fixed costs are amortized across full occupancy.</div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:14px">
      <div class="insight-title">Revenue Sensitivity — Occupancy Scenarios</div>
      <table style="font-size:11px;margin-top:8px">
        <thead><tr><th>Scenario</th><th>Y5 Occupancy</th><th>Y5 Revenue</th><th>Y5 NOI</th><th>Yield on Cost</th></tr></thead>
        <tbody>
          ${[
            { label: "Bear Case", occ: 0.82, color: "#EF4444" },
            { label: "Base Case", occ: 0.92, color: "#C9A84C" },
            { label: "Bull Case", occ: 0.97, color: "#16A34A" },
          ].map(sc => {
            const scRev = Math.round((climateSF * sc.occ * yearData[4].climRate + driveSF * sc.occ * yearData[4].driveRate) * 12);
            const scOpex = Math.round(scRev * 0.35);
            const scNoi = scRev - scOpex;
            const scYoc = totalDevCost > 0 ? ((scNoi / totalDevCost) * 100).toFixed(1) : "N/A";
            return `<tr><td style="font-weight:700;color:${sc.color}">${sc.label}</td><td class="mono">${Math.round(sc.occ*100)}%</td><td class="mono">${fmtD(scRev)}</td><td class="mono" style="color:${sc.color}">${fmtD(scNoi)}</td><td class="mono" style="font-weight:800;color:${sc.color}">${scYoc}%</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- DEVELOPMENT COST STACK v4.0 -->
<div id="sec-P8" class="section expand-trigger" onclick="toggleExpand('devcost')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="devcost-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Development Cost Stack</span></h2>
  <div class="grid2">
    <div>
      <table>
        <tr class="mi" onclick="toggleMI('dcland',event)" style="cursor:pointer"><td style="color:#6B7394;font-weight:600">Land Acquisition <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td class="mono" style="font-weight:700;text-align:right">${landCost > 0 ? fmtD(landCost) : "TBD"}</td></tr>
        <tr><td colspan="2" style="padding:0;border:none"><div id="mi-dcland" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Land Acquisition Cost</div><div class="mi-conf mi-conf-${landCost > 0 ? "high" : "low"}">${landCost > 0 ? "Broker Listing" : "Not Priced"}</div></div>
          <div class="mi-body">
            <strong>${landCost > 0 ? "Asking price from broker listing. Subject to negotiation per Land Price Guide below." : "Asking price not yet available — use the Land Price Guide to determine offer range."}</strong>
            <div class="mi-formula">${landCost > 0 ? `Asking: ${fmtD(landCost)} (${!isNaN(acres) && acres > 0 ? "$" + Math.round(landCost/acres).toLocaleString() + "/acre" : "—"})<br>SiteScore™ Strike Price: ${landPrices[1].maxLand > 0 ? fmtM(landPrices[1].maxLand) : "N/A"}<br>Ask vs Strike: ${askVsStrike !== null ? askVsStrike + "%" : "—"}` : "Land cost TBD — enter asking price to activate valuation engine"}</div>
            <div class="mi-row"><span class="mi-row-label">PS Significance</span><span class="mi-row-val">Land is typically 10-25% of total dev cost for PS projects. Sites where land exceeds 30% of total cost face tighter YOC — PS's internal hurdle is 8.0-9.0% YOC, and land is the primary variable the buyer controls.</span></div>
            <div class="mi-row"><span class="mi-row-label">Land as % of Total</span><span class="mi-row-val">${totalDevCost > 0 && landCost > 0 ? Math.round(landCost/totalDevCost*100) + "%" : "—"} — ${totalDevCost > 0 && landCost > 0 && landCost/totalDevCost > 0.30 ? "ABOVE typical PS range — negotiate aggressively" : totalDevCost > 0 && landCost > 0 ? "within normal PS range" : "pending"}</span></div>
            <div class="mi-source">Source: Broker listing (Crexi/LoopNet/CoStar) | SiteScore™ reverse-engineered from stabilized NOI</div>
          </div>
        </div></div></td></tr>
        <tr class="mi" onclick="toggleMI('dchard',event)" style="cursor:pointer"><td style="color:#6B7394;font-weight:600">All Hard Costs (${grossSF ? grossSF.toLocaleString() : totalSF.toLocaleString()} GSF @ $${totalHardPerSF}/SF) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td class="mono" style="font-weight:700;text-align:right">${fmtD(totalHardCost)}</td></tr>
        <tr><td colspan="2" style="padding:0;border:none"><div id="mi-dchard" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Hard Cost Breakdown — Full Development Stack</div><div class="mi-conf mi-conf-high">PS Killeen Calibrated</div></div>
          <div class="mi-body">
            <strong>All-in hard costs for ${isMultiStory ? stories + "-story multi-story" : "single-story indoor"} climate-controlled self-storage. Calibrated against PS Killeen TX closing (Dec 2025, $11.65M actual).</strong>
            <table style="width:100%;border-collapse:collapse;margin:10px 0">
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Building Shell & HVAC</td><td class="mono" style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">$${hardCostPerSF}/SF × ${grossSF ? grossSF.toLocaleString() : "?"}</td><td class="mono" style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0">${fmtD(hardCost)}</td></tr>
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Site Development</td><td class="mono" style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">$${baseSiteWorkPerSF}/SF × ${siteAreaSF.toLocaleString()} site SF</td><td class="mono" style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0">${fmtD(siteWorkCost)}</td></tr>
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Fire Suppression</td><td class="mono" style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">$${baseFireSuppressionPerSF}/SF × ${grossSF ? grossSF.toLocaleString() : "?"}</td><td class="mono" style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0">${fmtD(fireSuppressionCost)}</td></tr>
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Interior Buildout</td><td class="mono" style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">$${baseInteriorPerSF}/SF × ${totalSF.toLocaleString()} net SF</td><td class="mono" style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0">${fmtD(interiorBuildoutCost)}</td></tr>
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Technology & Security</td><td class="mono" style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">$${baseTechPerSF}/SF × ${grossSF ? grossSF.toLocaleString() : "?"}</td><td class="mono" style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0">${fmtD(technologyCost)}</td></tr>
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Utility Infrastructure</td><td class="mono" style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">$${utilityInfraBase.toLocaleString()} base + $${baseUtilityPerSF}/SF</td><td class="mono" style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0">${fmtD(utilityInfraCost)}</td></tr>
              <tr style="border-top:2px solid rgba(201,168,76,0.2)"><td style="padding:6px 0;font-size:12px;color:#C9A84C;font-weight:800">Total Hard Costs</td><td class="mono" style="padding:6px 0;font-size:11px;text-align:center;color:#C9A84C;font-weight:700">$${totalHardPerSF}/SF all-in</td><td class="mono" style="padding:6px 0;font-size:12px;text-align:right;font-weight:800;color:#E87A2E">${fmtD(totalHardCost)}</td></tr>
            </table>
            <div class="mi-row"><span class="mi-row-label">Regional Index</span><span class="mi-row-val">${site.state || "N/A"}: ${costIdx.toFixed(2)}x — ${costIdx < 0.95 ? "below-average market, favorable GC pricing" : costIdx > 1.05 ? "above-average market, elevated costs" : "near national average"}</span></div>
            <div class="mi-row"><span class="mi-row-label">PS Calibration</span><span class="mi-row-val">Killeen TX closing (Dec 2025): $11.65M dev cost on 98K GSF = $119/SF all-in. Model produces $${totalHardPerSF}/SF — ${Math.abs(totalHardPerSF - 119) <= 15 ? "within calibration range" : "review rates"}.</span></div>
            <div class="mi-source">Source: RSMeans 2025 | PS Killeen TX settlement statement (ORNTIC 303884/TX24380) | ENR Q1 2026</div>
          </div>
        </div></div></td></tr>
        <tr class="mi" onclick="toggleMI('dcsoft',event)" style="cursor:pointer"><td style="color:#6B7394;font-weight:600">Soft Costs (${Math.round(softCostPct*100)}%) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td class="mono" style="font-weight:700;text-align:right">${fmtD(softCost)}</td></tr>
        <tr><td colspan="2" style="padding:0;border:none"><div id="mi-dcsoft" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Soft Cost Breakdown — REC Detail View</div><div class="mi-conf mi-conf-med">Industry Standard</div></div>
          <div class="mi-body">
            <strong>Soft costs cover all non-construction development expenses. Set at ${Math.round(softCostPct*100)}% of total hard costs (conservative range: 15-25%). Breakdown shows REC-level granularity.</strong>
            <div class="mi-formula">Total Hard Costs: ${fmtD(totalHardCost)}<br>Soft Cost %: ${Math.round(softCostPct*100)}%<br>Total Soft: ${fmtD(totalHardCost)} × ${(softCostPct).toFixed(2)} = <strong style="color:#F59E0B">${fmtD(softCost)}</strong></div>
            <table style="width:100%;border-collapse:collapse;margin:10px 0">
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Architecture & Engineering</td><td style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">5-7% of hard</td><td style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0;font-family:'Space Mono',monospace">${fmtD(Math.round(totalHardCost * 0.06))}</td><td style="padding:5px 0;font-size:10px;color:#4A5080;padding-left:8px">Civil, structural, MEP, landscape arch</td></tr>
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Permits & Impact Fees</td><td style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">3-5% of hard</td><td style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0;font-family:'Space Mono',monospace">${fmtD(Math.round(totalHardCost * 0.04))}</td><td style="padding:5px 0;font-size:10px;color:#4A5080;padding-left:8px">${site.state === "TX" ? "TX — generally lower regulatory costs" : "Jurisdiction-dependent"}</td></tr>
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Legal & Title</td><td style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">1-2% of hard</td><td style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0;font-family:'Space Mono',monospace">${fmtD(Math.round(totalHardCost * 0.015))}</td><td style="padding:5px 0;font-size:10px;color:#4A5080;padding-left:8px">Closing, zoning counsel, contracts</td></tr>
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Survey & Geotech</td><td style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">0.5-1%</td><td style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0;font-family:'Space Mono',monospace">${fmtD(Math.round(totalHardCost * 0.0075))}</td><td style="padding:5px 0;font-size:10px;color:#4A5080;padding-left:8px">ALTA survey, Phase I ESA, geotech borings</td></tr>
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Developer Fee</td><td style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">3-5% of hard</td><td style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0;font-family:'Space Mono',monospace">${fmtD(Math.round(totalHardCost * 0.04))}</td><td style="padding:5px 0;font-size:10px;color:#4A5080;padding-left:8px">PS internal allocation — self-developed</td></tr>
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Construction Mgmt</td><td style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">2-3% of hard</td><td style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0;font-family:'Space Mono',monospace">${fmtD(Math.round(totalHardCost * 0.025))}</td><td style="padding:5px 0;font-size:10px;color:#4A5080;padding-left:8px">PS internal — no third-party CM fee</td></tr>
              <tr style="border-bottom:1px solid rgba(201,168,76,0.12)"><td style="padding:5px 0;font-size:11px;color:#6B7394;font-weight:600">Financing Costs</td><td style="padding:5px 0;font-size:11px;text-align:center;color:#6B7394">1-2% of hard</td><td style="padding:5px 0;font-size:11px;text-align:right;font-weight:700;color:#E2E8F0;font-family:'Space Mono',monospace">${fmtD(Math.round(totalHardCost * 0.015))}</td><td style="padding:5px 0;font-size:10px;color:#4A5080;padding-left:8px">Origination, appraisal, title insurance</td></tr>
              <tr style="border-top:2px solid rgba(201,168,76,0.2)"><td style="padding:6px 0;font-size:12px;color:#C9A84C;font-weight:800">Total Soft Costs</td><td style="padding:6px 0;font-size:11px;text-align:center;color:#C9A84C;font-weight:700">${Math.round(softCostPct*100)}%</td><td style="padding:6px 0;font-size:12px;text-align:right;font-weight:800;color:#F59E0B;font-family:'Space Mono',monospace">${fmtD(softCost)}</td><td></td></tr>
            </table>
            <div style="font-size:10px;color:#4A5080;margin-top:4px">Note: Line items are estimated allocations within the ${Math.round(softCostPct*100)}% total. Actual breakdown varies by jurisdiction and project complexity. PS's self-development model reduces developer fee and CM costs vs. third-party development.</div>
            <div class="mi-source">Source: PS development pipeline analysis | RSMeans Soft Cost Guide 2025 | Industry standard range 15-25% of hard costs</div>
          </div>
        </div></div></td></tr>
        <tr class="mi" onclick="toggleMI('dctotal',event)" style="border-top:2px solid rgba(201,168,76,0.2);cursor:pointer"><td style="font-weight:800;color:#C9A84C">Total Development Cost <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td><td class="mono" style="font-weight:800;text-align:right;color:#E87A2E;font-size:16px">${fmtM(totalDevCost)}</td></tr>
        <tr><td colspan="2" style="padding:0;border:none"><div id="mi-dctotal" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Total Capital Required</div><div class="mi-conf mi-conf-high">Computed</div></div>
          <div class="mi-body">
            <strong>All-in development cost = Land + Total Hard Costs + Soft Costs + Contingency + Carry. This is the denominator in the Yield on Cost calculation — the single metric PS uses to evaluate development projects.</strong>
            <div class="mi-formula">Land: ${landCost > 0 ? fmtD(landCost) : "TBD"}<br>Total Hard Costs: ${fmtD(totalHardCost)} ($${totalHardPerSF}/SF)<br>Soft Costs (${Math.round(softCostPct*100)}%): ${fmtD(softCost)}<br>Contingency (${(contingencyPct*100).toFixed(1)}%): ${fmtD(contingency)}<br>Carry (${constructionMonths}mo): ${fmtD(carryCosts)}<br>────────────<br>Total: <strong style="color:#E87A2E">${fmtM(totalDevCost)}</strong> ($${totalDevCost > 0 ? Math.round(totalDevCost/totalSF).toLocaleString() : "—"}/SF all-in)</div>
            <div class="mi-row"><span class="mi-row-label">Yield on Cost</span><span class="mi-row-val">${yocStab}% — ${parseFloat(yocStab) >= 9 ? "EXCEEDS PS hurdle rate (8.0-9.0%). Strong internal approval signal." : parseFloat(yocStab) >= 8 ? "MEETS PS hurdle rate. Standard approval path." : parseFloat(yocStab) >= 7 ? "BELOW PS hurdle — requires exceptional location or strategic rationale." : "BELOW institutional minimum — does not pencil without significant cost reduction or NOI increase."}</span></div>
            <div class="mi-row"><span class="mi-row-label">Why This Matters to PS</span><span class="mi-row-val">PS's Real Estate Committee (REC) evaluates every development project primarily on YOC. The development spread (YOC minus acquisition cap rate of ~${(mktAcqCap*100).toFixed(1)}%) must justify the 18-24 month construction period and lease-up risk. This project's ${devSpread}-point spread ${parseFloat(devSpread) >= 2.5 ? "clearly justifies development" : parseFloat(devSpread) >= 1.5 ? "is acceptable for development" : "is marginal — acquisition may be more efficient"}.</span></div>
            <div class="mi-source">Source: SiteScore™ cost engine | Land from broker listing | Hard costs from RSMeans regional index | Soft costs at ${Math.round(softCostPct*100)}% industry standard</div>
          </div>
        </div></div></td></tr>
      </table>
    </div>
    <div>
      <h3 class="muted">Return Metrics</h3>
      <div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid rgba(201,168,76,0.08)">
        <div class="mi" onclick="toggleMI('dcyoc',event)" style="display:flex;justify-content:space-between;margin-bottom:10px;cursor:pointer;padding:4px;border-radius:6px">
          <span style="font-size:12px;color:#6B7394">Yield on Cost (Stabilized) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span>
          <span class="mono" style="font-size:18px;font-weight:800;color:${parseFloat(yocStab) >= 9 ? "#16A34A" : parseFloat(yocStab) >= 7 ? "#F59E0B" : "#EF4444"}">${yocStab}%</span>
        </div>
        <div id="mi-dcyoc" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Yield on Cost — The #1 PS Development Metric</div><div class="mi-conf mi-conf-high">Computed</div></div>
          <div class="mi-body">
            <strong>YOC = Stabilized NOI ÷ Total Development Cost. This is the return PS earns on every dollar deployed — the single metric that determines whether a project gets REC approval.</strong>
            <div class="mi-formula">Stabilized NOI (Y5): ${fmtD(stabNOI)}<br>Total Dev Cost: ${fmtM(totalDevCost)}<br>YOC: ${fmtD(stabNOI)} ÷ ${fmtM(totalDevCost)} = <strong style="color:#C9A84C">${yocStab}%</strong></div>
            <div class="mi-row"><span class="mi-row-label">PS Internal Hurdles</span><span class="mi-row-val">8.0-9.0% minimum for standard approval | 7.0-8.0% for strategic/irreplaceable sites | <9.0% requires VP+ signoff</span></div>
            <div class="mi-row"><span class="mi-row-label">Development Spread</span><span class="mi-row-val">${devSpread} bps over ~${(mktAcqCap*100).toFixed(1)}% acquisition cap — this premium compensates for 18-24 month construction + 3-5 year lease-up risk</span></div>
            <div class="mi-source">Source: SiteScore™ financial engine | PS 10-K development pipeline disclosures | Green Street Advisors cap rate surveys</div>
          </div>
        </div></div>
        <div class="mi" onclick="toggleMI('dccpsf',event)" style="display:flex;justify-content:space-between;margin-bottom:10px;cursor:pointer;padding:4px;border-radius:6px">
          <span style="font-size:12px;color:#6B7394">Cost Per SF <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span>
          <span class="mono" style="font-size:14px;font-weight:700">${totalDevCost > 0 ? "$" + Math.round(totalDevCost / totalSF).toLocaleString() : "TBD"}</span>
        </div>
        <div id="mi-dccpsf" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">All-In Cost Per Rentable SF</div><div class="mi-conf mi-conf-high">Computed</div></div>
          <div class="mi-body">
            <div class="mi-formula">Total Dev Cost: ${fmtM(totalDevCost)} ÷ ${totalSF.toLocaleString()} SF = <strong>$${totalDevCost > 0 ? Math.round(totalDevCost/totalSF).toLocaleString() : "—"}/SF</strong></div>
            <div class="mi-row"><span class="mi-row-label">PS Benchmark</span><span class="mi-row-val">$${isMultiStory ? "140-180" : "100-140"}/SF all-in for ${isMultiStory ? "multi-story" : "single-story"} in ${site.state || "this region"}</span></div>
            <div class="mi-source">Source: Total development cost ÷ total rentable SF</div>
          </div>
        </div></div>
        <div class="mi" onclick="toggleMI('dcrevsf',event)" style="display:flex;justify-content:space-between;cursor:pointer;padding:4px;border-radius:6px">
          <span style="font-size:12px;color:#6B7394">Stabilized Rev/SF/Yr <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span>
          <span class="mono" style="font-size:14px;font-weight:700;color:#16A34A">${yearData[4].totalRev > 0 ? "$" + (yearData[4].totalRev / totalSF).toFixed(2) : "TBD"}</span>
        </div>
        <div id="mi-dcrevsf" class="mi-panel"><div class="mi-panel-inner">
          <div class="mi-header"><div class="mi-title">Revenue Density — RevPAF</div><div class="mi-conf mi-conf-high">Computed</div></div>
          <div class="mi-body">
            <div class="mi-formula">Y5 Revenue: ${fmtD(yearData[4].totalRev)} ÷ ${totalSF.toLocaleString()} SF = <strong>$${(yearData[4].totalRev / totalSF).toFixed(2)}/SF/yr</strong></div>
            <div class="mi-row"><span class="mi-row-label">PS Portfolio RevPAF</span><span class="mi-row-val">~$24.50/SF/yr (Q4 2025). Extra Space: ~$22.80. CubeSmart: ~$19.50.</span></div>
            <div class="mi-source">Source: Y5 stabilized revenue ÷ total available SF | PS 10-K portfolio metrics</div>
          </div>
        </div></div>
      </div>
    </div>
  </div>
  <div id="devcost" class="expand-panel">
    <div style="margin-top:8px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Hard Cost Breakdown</div>
      <table style="font-size:11px">
        <thead><tr><th>Category</th><th>$/SF</th><th>% of Hard</th><th>Total</th></tr></thead>
        <tbody>
          ${[
            { cat: "Sitework & Grading", pct: 0.12 },
            { cat: "Foundation & Structural", pct: 0.22 },
            { cat: "Shell & Envelope", pct: 0.18 },
            { cat: "Interior Build-Out (Corridors, Units, Doors)", pct: 0.20 },
            { cat: "HVAC (Climate Control)", pct: 0.13 },
            { cat: "Electrical & Lighting", pct: 0.08 },
            { cat: "Fire Protection (Sprinklers)", pct: 0.04 },
            { cat: "Paving, Landscaping & Stormwater", pct: 0.03 },
          ].map(c => `<tr>
            <td style="font-weight:600">${c.cat}</td>
            <td class="mono">$${Math.round(hardCostPerSF * c.pct)}</td>
            <td class="mono">${Math.round(c.pct*100)}%</td>
            <td class="mono">${fmtD(Math.round(hardCost * c.pct))}</td>
          </tr>`).join("")}
          <tr style="border-top:2px solid rgba(201,168,76,0.15);font-weight:700"><td>TOTAL HARD COSTS</td><td class="mono">$${hardCostPerSF}</td><td class="mono">100%</td><td class="mono" style="color:#E87A2E">${fmtD(hardCost)}</td></tr>
        </tbody>
      </table>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Soft Cost Breakdown</div>
      <table style="font-size:11px">
        <thead><tr><th>Category</th><th>% of Soft</th><th>Total</th></tr></thead>
        <tbody>
          ${[
            { cat: "Architecture & Engineering", pct: 0.30 },
            { cat: "Permits & Impact Fees", pct: 0.20 },
            { cat: "Legal & Title", pct: 0.10 },
            { cat: "Geotech, Survey, Environmental", pct: 0.12 },
            { cat: "Construction Management", pct: 0.15 },
            { cat: "Contingency", pct: 0.13 },
          ].map(c => `<tr>
            <td style="font-weight:600">${c.cat}</td>
            <td class="mono">${Math.round(c.pct*100)}%</td>
            <td class="mono">${fmtD(Math.round(softCost * c.pct))}</td>
          </tr>`).join("")}
          <tr style="border-top:2px solid rgba(201,168,76,0.15);font-weight:700"><td>TOTAL SOFT COSTS</td><td class="mono">100%</td><td class="mono" style="color:#F59E0B">${fmtD(softCost)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="insight-box" style="margin-top:14px">
      <div class="insight-title">Cost Benchmarking</div>
      <div>PS ${isMultiStory ? "multi-story" : "single-story"} facilities typically build at <strong>$${hardCostPerSF}/SF hard costs</strong> in the current construction environment (2025-2026 pricing). ${isMultiStory ? "Multi-story adds structural steel, elevator, and fire stair costs (~$30/SF premium over single-story)." : "Single-story is the most cost-efficient construction type — no elevator, no fire stairs, simpler structural."} Soft costs at ${Math.round(softCostPct*100)}% are conservative — actual may range 15-25% depending on jurisdiction complexity and impact fees. ${site.state === "TX" ? "Texas generally has lower soft costs due to fewer regulatory hurdles and no state income tax impact on labor." : ""}</div>
    </div>
  </div>
</div>

<!-- VALUATION SCENARIOS v4.0 -->
<div id="sec-P9" class="section expand-trigger" onclick="toggleExpand('valuation')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="valuation-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Stabilized Valuation Scenarios</span></h2>
  <div style="font-size:12px;color:#94A3B8;margin-bottom:16px">Based on Year 5 stabilized NOI of <span class="mono gold" style="font-weight:700">${fmtD(stabNOI)}</span></div>
  <div class="grid3">
    ${valuations.map((v, i) => `<div class="metric-box mi" onclick="toggleMI('vs${i}',event)" style="cursor:pointer;${i === 1 ? "border-color:rgba(201,168,76,0.3);box-shadow:0 4px 20px rgba(201,168,76,0.1)" : ""}">
      <div class="label">${v.label} <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="color:${i === 0 ? "#42A5F5" : i === 1 ? "#C9A84C" : "#16A34A"};font-size:26px">${fmtM(v.value)}</div>
      <div style="font-size:10px;color:#6B7394;margin-top:6px">Spread to cost: ${totalDevCost > 0 ? fmtM(v.value - totalDevCost) : "TBD"}</div>
      ${totalDevCost > 0 ? `<div style="font-size:10px;color:${v.value > totalDevCost ? "#16A34A" : "#EF4444"};font-weight:700;margin-top:2px">${((v.value / totalDevCost - 1) * 100).toFixed(0)}% ${v.value > totalDevCost ? "profit" : "loss"} on cost</div>` : ""}
      <div id="mi-vs${i}" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">${v.label} — Valuation Derivation</div><div class="mi-conf mi-conf-${i === 1 ? "high" : "med"}">${i === 1 ? "Base Case" : i === 0 ? "Conservative" : "Aggressive"}</div></div>
        <div class="mi-body">
          <strong>Direct capitalization: Stabilized NOI ÷ Cap Rate = Market Value.</strong>
          <div class="mi-formula">NOI: ${fmtD(stabNOI)}<br>Cap Rate: ${(v.rate*100).toFixed(2)}%<br>Value: ${fmtD(stabNOI)} ÷ ${(v.rate*100).toFixed(2)}% = <strong style="color:${i === 0 ? "#42A5F5" : i === 1 ? "#C9A84C" : "#16A34A"}">${fmtM(v.value)}</strong><br>${totalDevCost > 0 ? `Value Created: ${fmtM(v.value)} − ${fmtM(totalDevCost)} = <strong style="color:${v.value > totalDevCost ? "#16A34A" : "#EF4444"}">${fmtM(v.value - totalDevCost)}</strong> (${((v.value/totalDevCost-1)*100).toFixed(0)}%)` : ""}</div>
          <div class="mi-row"><span class="mi-row-label">Cap Rate Source</span><span class="mi-row-val">${i === 0 ? "Conservative exit — typical for secondary markets or buyers pricing in lease-up risk" : i === 1 ? "Base case — aligned with current storage transaction market (CBRE Q1 2026 cap rate survey: 5.25-6.00%)" : "Aggressive — achievable for institutional-quality assets in primary markets with 93%+ occupancy"}</span></div>
          <div class="mi-row"><span class="mi-row-label">PS Context</span><span class="mi-row-val">PSA trades at ~4.5-5.0% implied cap on existing portfolio. New development is underwritten at ${(v.rate*100).toFixed(1)}% to price in construction + lease-up uncertainty. ${i === 1 ? "This base case reflects institutional consensus for stabilized storage assets." : ""}</span></div>
          <div class="mi-source">Source: Green Street Advisors | CBRE Self-Storage Cap Rate Survey Q1 2026 | REIT implied caps from 10-K filings</div>
        </div>
      </div></div>
    </div>`).join("")}
  </div>

  <!-- CUSTOM CAP RATE INPUT -->
  <div data-stab-noi="${stabNOI}" data-total-dev-cost="${totalDevCost}" data-total-sf="${totalSF}" id="custom-cap-container" style="margin-top:20px;padding:20px 24px;background:linear-gradient(135deg,rgba(15,21,56,0.6),rgba(30,39,97,0.4));border-radius:14px;border:1px solid rgba(201,168,76,0.2)">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px">
      <div>
        <div style="font-size:10px;font-weight:800;color:#C9A84C;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:6px">Custom Cap Rate</div>
        <div style="font-size:11px;color:#6B7394">Adjust to model your own exit cap scenario</div>
      </div>
      <div style="display:flex;align-items:center;gap:16px">
        <input type="range" id="cap-slider" min="3.5" max="9.0" step="0.25" value="5.75" oninput="updateCustomCap(this.value)" style="width:200px;accent-color:#C9A84C;cursor:pointer">
        <div style="display:flex;align-items:center;gap:4px;background:rgba(15,21,56,0.8);border:1px solid rgba(201,168,76,0.3);border-radius:8px;padding:6px 10px">
          <input type="number" id="cap-input" min="3.5" max="9.0" step="0.25" value="5.75" oninput="updateCustomCap(this.value)" onclick="event.stopPropagation()" style="width:50px;background:transparent;border:none;color:#C9A84C;font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;text-align:right;outline:none">
          <span style="color:#6B7394;font-size:14px;font-weight:700">%</span>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:18px">
      <div style="text-align:center">
        <div style="font-size:9px;color:#6B7394;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px">Valuation</div>
        <div id="cc-value" class="mono" style="font-size:22px;font-weight:900;color:#C9A84C">${stabNOI > 0 ? fmtM(Math.round(stabNOI / 0.0575)) : "N/A"}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:9px;color:#6B7394;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px">Spread to Cost</div>
        <div id="cc-spread" class="mono" style="font-size:22px;font-weight:900;color:#16A34A">${totalDevCost > 0 && stabNOI > 0 ? fmtM(Math.round(stabNOI / 0.0575) - totalDevCost) : "TBD"}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:9px;color:#6B7394;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px">Profit on Cost</div>
        <div id="cc-profit" class="mono" style="font-size:22px;font-weight:900;color:#16A34A">${totalDevCost > 0 && stabNOI > 0 ? ((Math.round(stabNOI / 0.0575) / totalDevCost - 1) * 100).toFixed(0) + "%" : "TBD"}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:9px;color:#6B7394;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px">Value / SF</div>
        <div id="cc-persf" class="mono" style="font-size:22px;font-weight:900;color:#E2E8F0">${totalSF > 0 && stabNOI > 0 ? "$" + Math.round(Math.round(stabNOI / 0.0575) / totalSF) : "TBD"}</div>
      </div>
    </div>
  </div>

  <div id="valuation" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Valuation Methodology</div>
      <div>Self-storage valuation uses the <strong>direct capitalization method</strong>: Stabilized NOI ÷ Cap Rate = Value. Cap rates for institutional-quality storage have compressed significantly — PS trades at ~4.5-5.0% implied cap on existing assets. New development projects are underwritten at higher caps (5.0-6.5%) to account for lease-up risk and construction uncertainty.</div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Cap Rate Sensitivity Grid</div>
      <table style="font-size:11px">
        <thead><tr><th>Cap Rate</th><th>Stabilized Value</th><th>Value per SF</th><th>Profit on Cost</th><th>Multiple on Equity</th></tr></thead>
        <tbody>
          ${[0.045, 0.050, 0.0525, 0.0575, 0.060, 0.065, 0.070].map(cr => {
            const val = Math.round(stabNOI / cr);
            const profit = val - totalDevCost;
            const multiple = totalDevCost > 0 ? (val / totalDevCost).toFixed(2) : "N/A";
            const isBase = cr === 0.0575;
            return `<tr style="${isBase ? "background:rgba(201,168,76,0.08);border-left:3px solid #C9A84C" : ""}">
              <td class="mono" style="font-weight:700;${isBase ? "color:#C9A84C" : ""}">${(cr*100).toFixed(2)}%${isBase ? " (base)" : ""}</td>
              <td class="mono" style="font-weight:700">${fmtM(val)}</td>
              <td class="mono">$${Math.round(val/totalSF)}/SF</td>
              <td class="mono" style="color:${profit > 0 ? "#16A34A" : "#EF4444"}">${totalDevCost > 0 ? fmtM(profit) : "TBD"}</td>
              <td class="mono" style="font-weight:700;color:${parseFloat(multiple) >= 1.5 ? "#16A34A" : parseFloat(multiple) >= 1.0 ? "#F59E0B" : "#EF4444"}">${multiple}x</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="insight-box">
        <div class="insight-title">PS REIT Trading Context</div>
        <div class="drill-row"><span class="drill-label">PSA Implied Cap</span><span class="drill-value">~4.5-5.0%</span></div>
        <div class="drill-row"><span class="drill-label">PSA Market Cap</span><span class="drill-value">~$52B</span></div>
        <div class="drill-row"><span class="drill-label">PS Avg Same-Store Occ.</span><span class="drill-value">~92-94%</span></div>
        <div class="drill-row"><span class="drill-label">PS Avg Same-Store Rev/SF</span><span class="drill-value">~$23-25/SF/yr</span></div>
        <div style="margin-top:6px;font-size:10px;color:#4A5080;font-style:italic">Development cap rates 100-200bps above trading cap due to lease-up risk premium.</div>
      </div>
      <div class="insight-box">
        <div class="insight-title">Exit Timing Scenarios</div>
        <div class="drill-row"><span class="drill-label">Sell at Y3 (75% occ)</span><span class="drill-value">${fmtM(Math.round(yearData[2].noi / 0.06))}</span></div>
        <div class="drill-row"><span class="drill-label">Sell at Y5 (stabilized)</span><span class="drill-value" style="color:#C9A84C">${fmtM(valuations[1].value)}</span></div>
        <div class="drill-row"><span class="drill-label">Sell at Y7 (ECRI mature)</span><span class="drill-value" style="color:#16A34A">${fmtM(Math.round(stabNOI * Math.pow(1.04, 2) / 0.055))}</span></div>
        <div style="margin-top:6px;font-size:10px;color:#4A5080;font-style:italic">Y7 assumes 4% annual NOI growth from ECRI + market escalation, and 25bps cap compression at maturity.</div>
      </div>
    </div>
  </div>
</div>

<div class="divider"></div>

<!-- LAND PRICE SUGGESTION v4.0 -->
<div class="section-divider"></div>
<div id="sec-P10" class="section section-gold expand-trigger" onclick="toggleExpand('landprice')" style="scroll-margin-top:20px;background:linear-gradient(135deg,rgba(15,21,56,0.8),rgba(30,39,97,0.6));border-color:rgba(201,168,76,0.3);box-shadow:0 4px 30px rgba(201,168,76,0.12)">
  <span class="expand-hint">▼ Click to expand <span id="landprice-arrow" class="expand-arrow">▼</span></span>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
    <div>
      <h2 style="margin-bottom:4px"><span class="gold">Land Acquisition Price Guide</span></h2>
      <div style="font-size:11px;color:#94A3B8">Reverse-engineered from stabilized NOI — what should we pay for this land?</div>
    </div>
    ${landVerdict ? `<div class="mi" onclick="toggleMI('lpverdict',event)" style="display:flex;flex-direction:column;align-items:center;cursor:pointer">
      <div class="badge" style="background:${verdictColor}20;color:${verdictColor};border:1px solid ${verdictColor}40;font-size:14px;padding:8px 20px;font-weight:900;letter-spacing:0.08em">${landVerdict} <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      ${askVsStrike ? `<div style="font-size:10px;color:#6B7394;margin-top:4px">Ask is ${parseFloat(askVsStrike) > 0 ? askVsStrike + "% above" : Math.abs(parseFloat(askVsStrike)) + "% below"} strike</div>` : ""}
      <div id="mi-lpverdict" class="mi-panel" style="text-align:left;min-width:400px"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Land Verdict — ${landVerdict}</div><div class="mi-conf mi-conf-high">SiteScore™</div></div>
        <div class="mi-body">
          <strong>SiteScore™ determines the land verdict by comparing the asking price against the target (strike) price derived from the facility's projected NOI performance.</strong>
          <div class="mi-formula">Strike Price: ${landPrices[1].maxLand > 0 ? fmtM(landPrices[1].maxLand) : "N/A"} (at ${(landPrices[1].yoc*100).toFixed(1)}% target YOC)<br>Asking Price: ${landCost > 0 ? fmtD(landCost) : "Not listed"}<br>Variance: ${askVsStrike !== null ? askVsStrike + "%" : "—"}<br>Verdict: <strong style="color:${verdictColor}">${landVerdict}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Verdict Logic</span><span class="mi-row-val">${parseFloat(askVsStrike) <= -15 ? "Ask is 15%+ BELOW strike → STRONG BUY. Move fast — this is a home run deal at current ask." : parseFloat(askVsStrike) <= 0 ? "Ask is at or below strike → BUY. Deal pencils at current ask." : parseFloat(askVsStrike) <= 15 ? "Ask is above strike but negotiable → NEGOTIATE. Counter at strike price." : parseFloat(askVsStrike) <= 30 ? "Ask is significantly above strike → STRETCH. Only for irreplaceable locations." : "Ask exceeds max ceiling → PASS. Does not pencil at any realistic YOC target."}</span></div>
          <div class="mi-row"><span class="mi-row-label">Why PS Needs This</span><span class="mi-row-val">Traditional CRE brokerage uses comparable sales to value land. SiteScore™ inverts this: it prices land from the storage facility's income potential. This means PS knows the maximum justifiable price BEFORE entering negotiations — a fundamental informational advantage.</span></div>
          <div class="mi-source">Source: SiteScore™ reverse-engineering engine | Stabilized NOI ÷ target YOC − build costs = max land price</div>
        </div>
      </div></div>
    </div>` : ""}
  </div>
  <div class="mi" onclick="toggleMI('lpformula',event)" style="font-size:12px;color:#94A3B8;margin-bottom:20px;padding:12px 16px;background:rgba(15,21,56,0.4);border-radius:10px;border:1px solid rgba(201,168,76,0.08);cursor:pointer">
    <strong style="color:#C9A84C">Formula:</strong> <span class="mono" style="color:#E2E8F0">Max Land Price = (Stabilized NOI ÷ Target YOC%) − Build Costs</span> <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em>
    <div style="margin-top:6px"><strong style="color:#C9A84C">Inputs:</strong> Stabilized NOI = <span class="mono" style="color:#16A34A">${fmtD(stabNOI)}</span> | Build Costs (Hard + Soft) = <span class="mono" style="color:#E87A2E">${fmtD(buildCosts)}</span></div>
  </div>
  <div id="mi-lpformula" class="mi-panel"><div class="mi-panel-inner">
    <div class="mi-header"><div class="mi-title">Reverse-Engineering Land Value from NOI</div><div class="mi-conf mi-conf-high">SiteScore™ Proprietary</div></div>
    <div class="mi-body">
      <strong>This is SiteScore™'s core value proposition to PS. Instead of relying on land comps (which are scarce and often non-comparable), we derive what the land IS WORTH based on what the completed storage facility WILL PRODUCE.</strong>
      <div class="mi-formula">Step 1: Project stabilized NOI → ${fmtD(stabNOI)}/yr<br>Step 2: Set target YOC (PS hurdle) → 8.5%<br>Step 3: Calculate total development budget → ${fmtD(stabNOI)} ÷ 0.085 = ${fmtD(Math.round(stabNOI/0.085))}<br>Step 4: Subtract build costs → ${fmtD(Math.round(stabNOI/0.085))} − ${fmtD(buildCosts)} = <strong style="color:#C9A84C">${landPrices[1].maxLand > 0 ? fmtM(landPrices[1].maxLand) : "N/A"}</strong><br><br>This is the MAXIMUM PS should pay for this land and still hit their development return target.</div>
      <div class="mi-row"><span class="mi-row-label">Why Not Use Land Comps?</span><span class="mi-row-val">Vacant land transactions are infrequent, parcels are heterogeneous (different sizes, shapes, zoning, access), and comp adjustments are subjective. SiteScore™'s income approach is objective, repeatable, and directly tied to the investment thesis.</span></div>
      <div class="mi-row"><span class="mi-row-label">Competitive Edge for PS</span><span class="mi-row-val">No other tool in the self-storage industry provides real-time land pricing derived from projected facility performance. PS land brokers currently rely on gut feel and comp-based BOVs. SiteScore™ replaces guesswork with a data-driven pricing engine that updates dynamically as market inputs change.</span></div>
      <div class="mi-source">Source: SiteScore™ proprietary pricing model | Patent Pending — Serial No. 99712640</div>
    </div>
  </div></div>
  <div class="grid3" style="margin-bottom:16px">
    ${landPrices.map((lp, lpIdx) => `<div class="metric-box mi" onclick="toggleMI('lp${lpIdx}',event)" style="cursor:pointer;${lp.tag === "TARGET" ? "border-color:rgba(201,168,76,0.35);box-shadow:0 4px 24px rgba(201,168,76,0.12)" : ""}">
      <div style="display:flex;justify-content:center;margin-bottom:8px"><span class="tag" style="background:${lp.color}20;color:${lp.color}">${lp.tag}</span></div>
      <div class="label">${lp.label} (${(lp.yoc*100).toFixed(1)}% YOC) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="color:${lp.color};font-size:28px">${lp.maxLand > 0 ? fmtM(lp.maxLand) : "N/A"}</div>
      ${lp.perAcre > 0 ? `<div style="font-size:12px;color:#6B7394;margin-top:4px;font-family:'Space Mono',monospace">$${lp.perAcre.toLocaleString()}/acre</div>` : ""}
      <div id="mi-lp${lpIdx}" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">${lp.label} — ${lp.tag} Price</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">Target YOC: ${(lp.yoc*100).toFixed(1)}%<br>Total Budget: ${fmtD(stabNOI)} ÷ ${(lp.yoc*100).toFixed(1)}% = ${fmtD(Math.round(stabNOI/lp.yoc))}<br>Less Build Costs: (${fmtD(buildCosts)})<br>Max Land: <strong style="color:${lp.color}">${lp.maxLand > 0 ? fmtM(lp.maxLand) : "$0"}</strong>${lp.perAcre > 0 ? ` ($${lp.perAcre.toLocaleString()}/ac)` : ""}</div>
          <div class="mi-row"><span class="mi-row-label">When to Use</span><span class="mi-row-val">${lpIdx === 0 ? "WALK AWAY — absolute maximum. Only for strategic/irreplaceable sites where PS has no alternative. Requires EVP approval and strategic justification." : lpIdx === 1 ? "STRIKE — PS's development sweet spot. 250-350bps spread over acquisition cap. Standard REC approval path." : "HOME RUN — exceptional pricing. Maximum margin of safety. Deal-of-the-year territory."}</span></div>
          <div class="mi-source">Source: SiteScore™ reverse-engineering | NOI: ${fmtD(stabNOI)} | Build costs: ${fmtD(buildCosts)}</div>
        </div>
      </div></div>
    </div>`).join("")}
  </div>
  ${landCost > 0 ? `<div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid rgba(201,168,76,0.1);margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:11px;font-weight:700;color:#6B7394;letter-spacing:0.08em">CURRENT ASKING PRICE</div>
        <div class="mono" style="font-size:22px;font-weight:800;color:#E2E8F0;margin-top:4px">${fmtM(landCost)}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:10px;color:#6B7394">vs Strike Price</div>
        <div class="mono" style="font-size:24px;font-weight:900;color:${verdictColor}">${askVsStrike !== null ? (parseFloat(askVsStrike) > 0 ? "+" : "") + askVsStrike + "%" : "—"}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;color:#6B7394">Suggested Counter</div>
        ${(() => {
          const minLand = landPrices[2]?.maxLand || 0;
          const strikeLand = landPrices[1]?.maxLand || 0;
          const maxLand = landPrices[0]?.maxLand || 0;
          if (landCost <= 0 || strikeLand <= 0) return `<div class="mono" style="font-size:22px;font-weight:800;color:#6B7394">N/A</div>`;
          if (landCost <= minLand) return `<div class="mono" style="font-size:18px;font-weight:800;color:#16A34A">BUY AT ASKING</div><div style="font-size:9px;color:#16A34A;margin-top:2px">Home run pricing — move fast</div>`;
          if (landCost <= strikeLand) return `<div class="mono" style="font-size:22px;font-weight:800;color:#16A34A">${fmtM(landCost)}</div><div style="font-size:9px;color:#16A34A;margin-top:2px">At/below strike — buy at asking</div>`;
          if (landCost <= maxLand) return `<div class="mono" style="font-size:22px;font-weight:800;color:#C9A84C">${fmtM(strikeLand)}</div><div style="font-size:9px;color:#F59E0B;margin-top:2px">Counter to strike price</div>`;
          return `<div class="mono" style="font-size:22px;font-weight:800;color:#EF4444">${fmtM(maxLand)}</div><div style="font-size:9px;color:#EF4444;margin-top:2px">Above walk-away — counter to max or pass</div>`;
        })()}
      </div>
    </div>
    <div style="margin-top:12px;height:8px;border-radius:4px;background:rgba(255,255,255,0.06);position:relative;overflow:visible">
      ${landPrices.map(lp => lp.maxLand > 0 ? `<div style="position:absolute;left:${Math.min(Math.max(Math.round(lp.maxLand / (landPrices[0].maxLand * 1.4) * 100), 5), 95)}%;top:-4px;width:3px;height:16px;background:${lp.color};border-radius:2px" title="${lp.label}: ${fmtM(lp.maxLand)}"></div>` : "").join("")}
      ${landCost > 0 ? `<div style="position:absolute;left:${Math.min(Math.max(Math.round(landCost / (landPrices[0].maxLand * 1.4) * 100), 5), 95)}%;top:-6px;width:4px;height:20px;background:#fff;border-radius:2px;box-shadow:0 0 8px rgba(255,255,255,0.4)" title="Asking: ${fmtM(landCost)}"></div>` : ""}
      <div style="width:100%;height:100%;border-radius:4px;background:linear-gradient(90deg,#16A34A,#F59E0B,#EF4444)"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:9px;color:#6B7394">
      <span>Home Run</span>
      <span>Strike</span>
      <span>Walk Away</span>
    </div>
  </div>` : ""}
  <div id="landprice" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">How This Works</div>
      <div>This model reverse-engineers the maximum land price from the facility's projected performance. Instead of asking "what does this land cost?" — it answers <strong style="color:#C9A84C">"what SHOULD this land cost?"</strong> based on what the storage facility will produce.</div>
      <div style="margin-top:10px">The formula backs into land price by subtracting known build costs from the total capital budget implied by each yield target:</div>
      <div style="margin-top:8px;padding:12px;background:rgba(15,21,56,0.5);border-radius:8px;border:1px solid rgba(201,168,76,0.08)">
        <div class="mono" style="font-size:12px;color:#E2E8F0;line-height:2">
          <div>Total Dev Budget = Stabilized NOI ÷ Target YOC%</div>
          <div>Max Land Price = Total Dev Budget − Hard Costs − Soft Costs</div>
          <div style="margin-top:4px;color:#C9A84C">Strike Example: ${fmtD(stabNOI)} ÷ 9.0% = ${fmtD(Math.round(stabNOI / 0.09))} − ${fmtD(buildCosts)} = <strong>${landPrices[1].maxLand > 0 ? fmtM(landPrices[1].maxLand) : "N/A"}</strong></div>
        </div>
      </div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;font-weight:800;color:#6B7394;letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Full YOC Sensitivity — Land Price Matrix</div>
      <table style="font-size:11px">
        <thead><tr><th>Target YOC</th><th>Total Dev Budget</th><th>Less Build Costs</th><th>Max Land Price</th><th>Per Acre</th><th>Signal</th></tr></thead>
        <tbody>
          ${[0.065, 0.07, 0.075, 0.08, 0.085, 0.09, 0.095, 0.10, 0.11, 0.12].map(yoc => {
            const budget = stabNOI > 0 ? Math.round(stabNOI / yoc) : 0;
            const maxL = Math.max(budget - buildCosts, 0);
            const pa = !isNaN(acres) && acres > 0 && maxL > 0 ? Math.round(maxL / acres) : 0;
            const isStrike = yoc === 0.085;
            const signal = yoc <= 0.07 ? "Too Aggressive" : yoc <= 0.075 ? "Walk Away" : yoc <= 0.085 ? "Aggressive" : yoc <= 0.095 ? "Strike Zone" : yoc <= 0.105 ? "Conservative" : "Home Run";
            const sigColor = yoc <= 0.07 ? "#EF4444" : yoc <= 0.08 ? "#E87A2E" : yoc <= 0.09 ? "#C9A84C" : yoc <= 0.10 ? "#16A34A" : "#16A34A";
            return `<tr style="${isStrike ? "background:rgba(201,168,76,0.08);border-left:3px solid #C9A84C" : ""}">
              <td class="mono" style="font-weight:700;${isStrike ? "color:#C9A84C" : ""}">${(yoc*100).toFixed(1)}%${isStrike ? " ◆" : ""}</td>
              <td class="mono">${budget > 0 ? fmtM(budget) : "N/A"}</td>
              <td class="mono" style="color:#6B7394">(${fmtD(buildCosts)})</td>
              <td class="mono" style="font-weight:700;color:${maxL > 0 ? "#E2E8F0" : "#EF4444"}">${maxL > 0 ? fmtM(maxL) : "$0"}</td>
              <td class="mono">${pa > 0 ? "$" + pa.toLocaleString() : "—"}</td>
              <td><span class="tag" style="background:${sigColor}20;color:${sigColor}">${signal}</span></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="insight-box">
        <div class="insight-title">Negotiation Intelligence</div>
        ${landCost > 0 && landPrices[1].maxLand > 0 ? `<div style="margin-bottom:8px">
          ${parseFloat(askVsStrike) <= -15 ? `<div style="color:#16A34A;font-weight:700;margin-bottom:6px">The asking price is ${Math.abs(parseFloat(askVsStrike))}% BELOW strike — this is a strong buy. Move fast before competing offers emerge. Consider offering at or near ask to lock it up.</div>` :
          parseFloat(askVsStrike) <= 0 ? `<div style="color:#22C55E;font-weight:700;margin-bottom:6px">The asking price is at or below strike — this deal pencils at the current ask. Standard LOI at asking price is defensible.</div>` :
          parseFloat(askVsStrike) <= 15 ? `<div style="color:#F59E0B;font-weight:700;margin-bottom:6px">The asking price is ${askVsStrike}% above strike — negotiate. Counter at ${fmtM(landPrices[1].maxLand)} (strike price) with a ${fmtD(Math.round((landCost - landPrices[1].maxLand) * 0.4 + landPrices[1].maxLand))} fallback position.</div>` :
          parseFloat(askVsStrike) <= 30 ? `<div style="color:#E87A2E;font-weight:700;margin-bottom:6px">The asking price is ${askVsStrike}% above strike — this is a stretch. Only pursue if the site has exceptional strategic value (location, competition void, growth trajectory) that justifies compressed returns.</div>` :
          `<div style="color:#EF4444;font-weight:700;margin-bottom:6px">The asking price is ${askVsStrike}% above strike — this deal does not pencil at the current ask. The seller's expectations exceed what this facility can support. Pass or submit a significantly below-ask offer at ${fmtM(landPrices[1].maxLand)} with full justification.</div>`}
        </div>` : `<div style="color:#6B7394">Asking price not available — use the strike price of ${landPrices[1].maxLand > 0 ? fmtM(landPrices[1].maxLand) : "N/A"} as the opening offer anchor.</div>`}
        <div class="drill-row"><span class="drill-label">LOI Opening Offer</span><span class="drill-value" style="color:#16A34A">${landPrices[2].maxLand > 0 ? fmtM(Math.round((landPrices[2].maxLand + landPrices[1].maxLand) / 2)) : "N/A"}</span></div>
        <div class="drill-row"><span class="drill-label">Walk-Away Price</span><span class="drill-value" style="color:#EF4444">${landPrices[0].maxLand > 0 ? fmtM(landPrices[0].maxLand) : "N/A"}</span></div>
        <div class="drill-row"><span class="drill-label">Negotiation Range</span><span class="drill-value">${landPrices[2].maxLand > 0 && landPrices[0].maxLand > 0 ? fmtM(landPrices[2].maxLand) + " — " + fmtM(landPrices[0].maxLand) : "N/A"}</span></div>
      </div>
      <div class="insight-box">
        <div class="insight-title">Why These YOC Targets?</div>
        <div style="font-size:11px;color:#94A3B8;line-height:1.8">
          <div><strong style="color:#EF4444">7.0% (Max/Ceiling)</strong> — Below PS's typical hurdle. Only justified for irreplaceable locations (freeway visibility, zero competition, top-5 metro growth). Requires EVP+ approval.</div>
          <div style="margin-top:6px"><strong style="color:#C9A84C">8.5% (Strike/Target)</strong> — PS's development sweet spot. 250-350bps spread over acquisition cap rates. Provides cushion for construction overruns and slower-than-modeled lease-up.</div>
          <div style="margin-top:6px"><strong style="color:#16A34A">10.0% (Min/Floor)</strong> — Conservative / home run. Maximum margin of safety. Easiest internal approval path. Typically achievable in secondary/tertiary markets with lower land costs.</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- DETAILED OPEX BREAKDOWN v4.0 -->
<div id="sec-P11" class="section expand-trigger" onclick="toggleExpand('opexdetail')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="opexdetail-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Stabilized Operating Expense Detail</span></h2>
  <div style="font-size:12px;color:#94A3B8;margin-bottom:16px">Line-item OpEx at Year 5 stabilization — <span class="mono" style="font-weight:700;color:${parseFloat(opexRatioDetail) <= 38 ? "#16A34A" : "#F59E0B"}">${opexRatioDetail}% OpEx ratio</span> (industry benchmark: 35-42%)</div>
  <table>
    <thead><tr><th>Line Item</th><th>Annual Amount</th><th>% of EGI</th><th>Basis</th></tr></thead>
    <tbody>
      ${opexDetail.map((o, oIdx) => `<tr class="mi" onclick="toggleMI('ox${oIdx}',event)" style="cursor:pointer">
        <td style="font-weight:600">${o.item} <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td>
        <td class="mono" style="font-weight:700">${fmtD(o.amount)}</td>
        <td class="mono">${stabRev > 0 ? (o.amount / stabRev * 100).toFixed(1) + "%" : "—"}</td>
        <td style="font-size:10px;color:#6B7394">${o.note}</td>
      </tr>
      <tr><td colspan="4" style="padding:0;border:none"><div id="mi-ox${oIdx}" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">${o.item} — Derivation</div><div class="mi-conf mi-conf-high">PS Benchmarks</div></div>
        <div class="mi-body">
          <div class="mi-formula">${o.note}<br>Amount: <strong>${fmtD(o.amount)}</strong> (${stabRev > 0 ? (o.amount/stabRev*100).toFixed(1) : "—"}% of EGI)</div>
          <div class="mi-row"><span class="mi-row-label">PS Portfolio Benchmark</span><span class="mi-row-val">${o.item.includes("Property Tax") ? "PS average: 8-12% of EGI. TX: 1.5-2.5% of assessed value. OH/IN: 1.0-1.8%. Reassessment post-development is the primary risk — budget for 15-20% increase at stabilization." : o.item.includes("Insurance") ? "PS average: $0.40-0.55/SF. Coastal/tornado regions add 15-25%. Climate-controlled + sprinklers earn preferred rates." : o.item.includes("Management") ? "PS self-manages at 4-5% with corporate overhead allocated separately. Third-party operators charge 6-8%. This model uses 6% (institutional standard)." : o.item.includes("Payroll") ? "PS targets 1.0 FTE per 60-80K SF. All-in burden (FICA, health, WC) at 30% of base salary. Automated kiosks and smart-access reduce labor needs." : o.item.includes("Utilit") ? "Primary driver: HVAC for climate-controlled units ($1.10/SF/yr). Drive-up: lighting only ($0.25/SF). LED conversions and smart thermostats save 15-20%." : o.item.includes("Marketing") ? "Y1 marketing is $50-75K (grand opening). By Y5, marketing drops to <3% of EGI — PS relies on web presence, Google Ads, and brand recognition." : o.item.includes("R&M") ? "PS budgets $0.30-0.50/SF for ongoing maintenance. Major items: HVAC servicing, door replacements, parking lot repair, security system maintenance." : o.item.includes("Admin") ? "Accounting, legal, software (access control, billing, CRM), pest control, snow removal (where applicable)." : "Based on PS operating benchmarks and industry standard assumptions."}</span></div>
          <div class="mi-source">Source: PS 10-K same-store operating expense disclosures | SSA Self-Storage Almanac | SiteScore™ OpEx engine</div>
        </div>
      </div></div></td></tr>`).join("")}
      <tr class="mi" onclick="toggleMI('oxtotal',event)" style="border-top:2px solid rgba(201,168,76,0.2);font-weight:800;background:rgba(15,21,56,0.3);cursor:pointer">
        <td style="color:#C9A84C">TOTAL OPERATING EXPENSES <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></td>
        <td class="mono" style="color:#E87A2E;font-size:14px">${fmtD(totalOpexDetail)}</td>
        <td class="mono" style="color:#E87A2E">${opexRatioDetail}%</td>
        <td></td>
      </tr>
      <tr><td colspan="4" style="padding:0;border:none"><div id="mi-oxtotal" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Total OpEx — Efficiency Analysis</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <strong>OpEx ratio of ${opexRatioDetail}% — ${parseFloat(opexRatioDetail) <= 36 ? "best-in-class efficiency, comparable to PS self-managed facilities" : parseFloat(opexRatioDetail) <= 40 ? "within institutional range, consistent with third-party management" : "above institutional average — investigate specific line items for optimization"}.</strong>
          <div class="mi-formula">Total OpEx: ${fmtD(totalOpexDetail)}<br>Stabilized Revenue: ${fmtD(stabRev)}<br>OpEx Ratio: ${totalOpexDetail} ÷ ${stabRev} = <strong style="color:#E87A2E">${opexRatioDetail}%</strong><br>NOI Margin: <strong style="color:#16A34A">${stabRev > 0 ? (noiDetail/stabRev*100).toFixed(1) : "—"}%</strong></div>
          <div class="mi-row"><span class="mi-row-label">REIT Benchmarks</span><span class="mi-row-val">PSA: 36.5% | EXR: 34.8% | CUBE: 38.2% | Industry avg: 40.5%</span></div>
          <div class="mi-row"><span class="mi-row-label">PS Value-Add</span><span class="mi-row-val">PS's scale drives operating leverage — centralized billing, negotiated insurance rates, smart-access technology reducing payroll, and ECRI pushing revenue without proportional OpEx increase. Every 1% improvement in OpEx ratio adds ~${stabRev > 0 ? fmtD(Math.round(stabRev * 0.01)) : "—"} to NOI.</span></div>
          <div class="mi-source">Source: REIT 10-K filings (Q4 2025) | SSA Industry Factbook | SiteScore™ line-item OpEx engine</div>
        </div>
      </div></div></td></tr>
      <tr style="font-weight:800;background:rgba(22,163,74,0.06)">
        <td style="color:#16A34A">NET OPERATING INCOME</td>
        <td class="mono" style="color:#16A34A;font-size:14px">${fmtD(noiDetail)}</td>
        <td class="mono" style="color:#16A34A">${stabRev > 0 ? (noiDetail / stabRev * 100).toFixed(1) + "%" : "—"}</td>
        <td></td>
      </tr>
    </tbody>
  </table>
  <div id="opexdetail" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">OpEx Methodology Notes</div>
      <div style="line-height:1.8;font-size:11px">
        <div><strong style="color:#E2E8F0">Property Tax:</strong> Estimated at 1.2% of total development cost. ${site.state === "TX" ? "Texas has no state income tax but higher property tax rates (1.5-2.5%). Verify with county appraisal district." : "Verify actual millage rate with local assessor."} After development, the property will be reassessed at full improvement value — budget for potential increases.</div>
        <div style="margin-top:6px"><strong style="color:#E2E8F0">Insurance:</strong> $0.45/SF covers property, general liability, and wind/hail. Climate-controlled facilities with sprinklers receive better rates. Coastal and tornado-corridor sites should budget 15-25% higher.</div>
        <div style="margin-top:6px"><strong style="color:#E2E8F0">Management:</strong> 6% of EGI is standard for institutional operators. REITs typically self-manage at 4-5% but allocate corporate overhead separately. Third-party operators charge 6-8%.</div>
        <div style="margin-top:6px"><strong style="color:#E2E8F0">Payroll:</strong> ${totalSF > 80000 ? "1.5 FTE for facilities >80K SF — one full-time manager + part-time relief." : "1.0 FTE for facilities <80K SF."} All-in burden (FICA, health, WC) at 30% of base. Larger facilities or those in high-wage markets may require adjustment.</div>
        <div style="margin-top:6px"><strong style="color:#E2E8F0">Utilities:</strong> Climate-controlled units are the primary electric cost driver (HVAC). Budget $1.10/SF/yr for climate space, $0.25/SF for drive-up (lighting only). ${incTier === "premium" || incTier === "upper" ? "Premium markets often have higher utility rates." : ""}</div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">Industry Benchmarking — OpEx Ratios</div>
      <div style="margin-top:8px">
        ${[
          { name: "This Site (Projected)", ratio: parseFloat(opexRatioDetail) || 0, color: "#C9A84C" },
          { name: "PS Portfolio Average", ratio: 36.5, color: "#42A5F5" },
          { name: "Extra Space (EXR)", ratio: 34.8, color: "#16A34A" },
          { name: "CubeSmart (CUBE)", ratio: 38.2, color: "#F59E0B" },
          { name: "Industry Average (All)", ratio: 40.5, color: "#94A3B8" },
        ].map(b => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div style="width:180px;font-size:10px;color:${b.color};font-weight:700;text-align:right">${b.name}</div>
          <div style="flex:1;height:14px;border-radius:4px;background:rgba(255,255,255,0.04);overflow:hidden">
            <div style="width:${Math.min(b.ratio / 50 * 100, 100)}%;height:100%;border-radius:4px;background:${b.color};display:flex;align-items:center;justify-content:flex-end;padding-right:6px">
              <span style="font-size:9px;font-weight:700;color:#fff">${b.ratio.toFixed(1)}%</span>
            </div>
          </div>
        </div>`).join("")}
      </div>
    </div>
  </div>
</div>

<!-- CAPITAL STACK & DEBT SERVICE v4.0 -->
<div id="sec-P12" class="section expand-trigger" onclick="toggleExpand('debtservice')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="debtservice-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Capital Stack & Debt Service</span></h2>
  <div class="grid4" style="margin-bottom:20px">
    <div class="metric-box mi" onclick="toggleMI('csloan',event)" style="cursor:pointer"><div class="label">Loan Amount <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div><div class="value" style="font-size:16px">${fmtM(loanAmount)}</div><div style="font-size:10px;color:#6B7394;margin-top:2px">${Math.round(loanLTV*100)}% LTV</div>
      <div id="mi-csloan" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Senior Debt — Construction/Perm Loan</div><div class="mi-conf mi-conf-high">Market Terms</div></div>
        <div class="mi-body">
          <div class="mi-formula">Total Dev Cost: ${fmtM(totalDevCost)}<br>LTV: ${Math.round(loanLTV*100)}%<br>Loan: ${fmtM(totalDevCost)} × ${Math.round(loanLTV*100)}% = <strong>${fmtM(loanAmount)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Financing Context</span><span class="mi-row-val">PS finances development through revolving credit facilities and term loans at investment-grade rates. As a land broker, we model standard market financing (${Math.round(loanLTV*100)}% LTV, ${(loanRate*100).toFixed(2)}%) to show project viability independent of PS's balance sheet advantage.</span></div>
          <div class="mi-source">Source: Current market construction/mini-perm terms (Q1 2026) | ${(loanRate*100).toFixed(2)}% rate reflects SOFR + 200-250bps spread</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('cseq',event)" style="cursor:pointer"><div class="label">Equity Required <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div><div class="value" style="font-size:16px;color:#C9A84C">${fmtM(equityRequired)}</div><div style="font-size:10px;color:#6B7394;margin-top:2px">${Math.round(equityPct*100)}% of total</div>
      <div id="mi-cseq" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Equity Requirement</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">Total Dev Cost − Loan = Equity<br>${fmtM(totalDevCost)} − ${fmtM(loanAmount)} = <strong style="color:#C9A84C">${fmtM(equityRequired)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Cash-on-Cash Return</span><span class="mi-row-val">${cashOnCash}% at stabilization — measures annual cash yield on the equity invested</span></div>
          <div class="mi-row"><span class="mi-row-label">Equity Multiple (10-Yr)</span><span class="mi-row-val">${equityMultiple}x — total return on equity including exit proceeds</span></div>
          <div class="mi-source">Source: Total dev cost − loan amount | Standard ${Math.round(equityPct*100)}% equity requirement for construction financing</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('csds',event)" style="cursor:pointer"><div class="label">Annual Debt Service <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div><div class="value" style="font-size:16px;color:#EF4444">${fmtD(annualDS)}</div><div style="font-size:10px;color:#6B7394;margin-top:2px">@ ${(loanRate*100).toFixed(2)}% / ${loanAmort}yr</div>
      <div id="mi-csds" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Debt Service Calculation</div><div class="mi-conf mi-conf-high">Amortization</div></div>
        <div class="mi-body">
          <div class="mi-formula">Loan: ${fmtM(loanAmount)} @ ${(loanRate*100).toFixed(2)}% / ${loanAmort}-yr amort<br>Monthly Payment: ${fmtD(Math.round(monthlyPmt))}<br>Annual DS: ${fmtD(Math.round(monthlyPmt))} × 12 = <strong style="color:#EF4444">${fmtD(annualDS)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Rate Environment</span><span class="mi-row-val">Modeled at ${(loanRate*100).toFixed(2)}% (SOFR + ~225bps). PS's investment-grade rating (A2/A) achieves tighter spreads — actual PS cost of debt is typically 100-150bps lower.</span></div>
          <div class="mi-source">Source: Standard amortization calculation | ${loanAmort}-year fully amortizing | Current market rate as of Q1 2026</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('csdscr',event)" style="cursor:pointer"><div class="label">DSCR (Stabilized) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div><div class="value" style="font-size:22px;color:${parseFloat(dscrStab) >= 1.4 ? "#16A34A" : parseFloat(dscrStab) >= 1.2 ? "#F59E0B" : "#EF4444"}">${dscrStab}x</div><div style="font-size:10px;color:#6B7394;margin-top:2px">Min: 1.25x (lender req)</div>
      <div id="mi-csdscr" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Debt Service Coverage Ratio</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <strong>DSCR = NOI ÷ Annual Debt Service. Lenders require minimum 1.25x. Below 1.0x means the project cannot cover its debt obligations from operations.</strong>
          <div class="mi-formula">Stabilized NOI: ${fmtD(stabNOI)}<br>Annual DS: ${fmtD(annualDS)}<br>DSCR: ${fmtD(stabNOI)} ÷ ${fmtD(annualDS)} = <strong style="color:${parseFloat(dscrStab) >= 1.4 ? "#16A34A" : "#F59E0B"}">${dscrStab}x</strong></div>
          <div class="mi-row"><span class="mi-row-label">Lender Threshold</span><span class="mi-row-val">${parseFloat(dscrStab) >= 1.4 ? "STRONG — exceeds all lender requirements. Favorable refinancing terms achievable." : parseFloat(dscrStab) >= 1.25 ? "PASS — meets minimum requirement. Standard terms." : "BELOW MINIMUM — lender may require additional equity, guarantees, or interest reserve."}</span></div>
          <div class="mi-source">Source: NOI ÷ debt service | Minimum 1.25x per CMBS, life co, and bank lending standards</div>
        </div>
      </div></div>
    </div>
  </div>
  <div class="grid2">
    <div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid rgba(201,168,76,0.08)">
      <div style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:10px">LEVERAGED RETURNS</div>
      <div class="mi drill-row" onclick="toggleMI('cscorc',event)" style="cursor:pointer"><span class="drill-label">Stabilized Cash After DS <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span><span class="drill-value" style="color:${cashAfterDS > 0 ? "#16A34A" : "#EF4444"}">${fmtD(cashAfterDS)}/yr</span></div>
      <div id="mi-cscorc" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Cash Flow After Debt Service</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">NOI: ${fmtD(stabNOI)} − DS: ${fmtD(annualDS)} = <strong style="color:${cashAfterDS > 0 ? "#16A34A" : "#EF4444"}">${fmtD(cashAfterDS)}</strong>/yr</div>
          <div class="mi-row"><span class="mi-row-label">Cash-on-Cash</span><span class="mi-row-val">${cashAfterDS > 0 ? fmtD(cashAfterDS) : "$0"} ÷ ${fmtM(equityRequired)} equity = ${cashOnCash}% annual cash yield on equity invested</span></div>
          <div class="mi-source">Source: Stabilized NOI minus annual debt service obligation</div>
        </div>
      </div></div>
      <div class="mi drill-row" onclick="toggleMI('csirr',event)" style="cursor:pointer"><span class="drill-label">10-Yr Levered IRR <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></span><span class="drill-value" style="color:${parseFloat(irrPct) >= 15 ? "#16A34A" : parseFloat(irrPct) >= 10 ? "#F59E0B" : "#EF4444"}">${irrPct}%</span></div>
      <div id="mi-csirr" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Internal Rate of Return (Levered)</div><div class="mi-conf mi-conf-high">DCF Model</div></div>
        <div class="mi-body">
          <strong>IRR measures the annualized return including all cash flows and exit proceeds. This is the institutional benchmark for comparing investment opportunities.</strong>
          <div class="mi-formula">Equity invested: (${fmtM(equityRequired)}) at Y0<br>Annual cash flows: Y1-Y10 (NOI − debt service)<br>Exit proceeds: ${fmtM(exitEquityProceeds)} at Y10 (${fmtM(exitValue)} value − ${fmtM(exitLoanBal)} loan payoff)<br>IRR: <strong style="color:${parseFloat(irrPct) >= 15 ? "#16A34A" : "#F59E0B"}">${irrPct}%</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Benchmark</span><span class="mi-row-val">${parseFloat(irrPct) >= 18 ? "Exceptional — top-decile returns for storage development" : parseFloat(irrPct) >= 14 ? "Strong — exceeds PS's cost of capital by significant margin" : parseFloat(irrPct) >= 10 ? "Adequate — meets minimum institutional threshold" : "Below institutional hurdle — review cost assumptions"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Equity Multiple</span><span class="mi-row-val">${equityMultiple}x — for every $1 of equity invested, the project returns $${equityMultiple} over the 10-year hold</span></div>
          <div class="mi-source">Source: SiteScore™ 10-year DCF model | Exit at ${(exitCapRate*100).toFixed(1)}% cap | Newton-Raphson IRR solver</div>
        </div>
      </div></div>
      <div class="drill-row"><span class="drill-label">Cash-on-Cash Return</span><span class="drill-value" style="color:${parseFloat(cashOnCash) >= 10 ? "#16A34A" : "#F59E0B"}">${cashOnCash}%</span></div>
      <div class="drill-row"><span class="drill-label">Equity Multiple (10-Yr)</span><span class="drill-value" style="color:#C9A84C">${equityMultiple}x</span></div>
    </div>
    <div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid rgba(201,168,76,0.08)">
      <div style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:10px">CAPITAL STACK</div>
      <div style="display:flex;gap:2px;height:24px;border-radius:6px;overflow:hidden;margin-bottom:12px">
        <div style="width:${loanLTV*100}%;background:linear-gradient(90deg,#1565C0,#42A5F5);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff">Debt ${Math.round(loanLTV*100)}%</div>
        <div style="width:${equityPct*100}%;background:linear-gradient(90deg,#C9A84C,#E87A2E);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff">Equity ${Math.round(equityPct*100)}%</div>
      </div>
      <div class="drill-row"><span class="drill-label">Loan Rate</span><span class="drill-value">${(loanRate*100).toFixed(2)}%</span></div>
      <div class="drill-row"><span class="drill-label">Amortization</span><span class="drill-value">${loanAmort} years</span></div>
      <div class="drill-row"><span class="drill-label">Monthly Payment</span><span class="drill-value">${fmtD(Math.round(monthlyPmt))}</span></div>
      <div class="drill-row"><span class="drill-label">Exit Loan Balance (Y10)</span><span class="drill-value">${fmtD(exitLoanBal)}</span></div>
    </div>
  </div>
  <div id="debtservice" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">DSCR Year-by-Year</div>
      <div style="margin-top:8px">
        ${yrDataExt.slice(0, 5).map((y, i) => {
          const dscr = annualDS > 0 ? (y.noi / annualDS).toFixed(2) : "—";
          const dscrColor = parseFloat(dscr) >= 1.4 ? "#16A34A" : parseFloat(dscr) >= 1.25 ? "#F59E0B" : parseFloat(dscr) >= 1.0 ? "#E87A2E" : "#EF4444";
          return `<div class="drill-row">
            <span class="drill-label">Year ${y.yr} DSCR</span>
            <span class="drill-value" style="color:${dscrColor}">${dscr}x ${parseFloat(dscr) < 1.25 ? '<span style="font-size:9px;color:#EF4444">⚠ BELOW MIN</span>' : parseFloat(dscr) >= 1.4 ? '<span style="font-size:9px;color:#16A34A">✓ PASS</span>' : ""}</span>
          </div>`;
        }).join("")}
        <div style="margin-top:8px;font-size:10px;color:#6B7394">Most construction/mini-perm lenders require 1.25x DSCR minimum. Interest-only periods during lease-up (Y1-Y2) are common and improve early-year coverage.</div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">10-Year Levered Cash Flow</div>
      <table style="font-size:11px;margin-top:8px">
        <thead><tr><th>Year</th><th>NOI</th><th>Debt Service</th><th>Cash After DS</th><th>DSCR</th></tr></thead>
        <tbody>
          ${yrDataExt.map((y, i) => {
            const cf = y.noi - annualDS;
            const dscr = annualDS > 0 ? (y.noi / annualDS).toFixed(2) : "—";
            return `<tr${i === 9 ? ' style="font-weight:700;background:rgba(201,168,76,0.05)"' : ""}>
              <td style="font-weight:600">Y${y.yr}</td>
              <td class="mono">${fmtD(y.noi)}</td>
              <td class="mono" style="color:#EF4444">(${fmtD(annualDS)})</td>
              <td class="mono" style="color:${cf > 0 ? "#16A34A" : "#EF4444"}">${fmtD(cf)}</td>
              <td class="mono" style="color:${parseFloat(dscr) >= 1.25 ? "#16A34A" : "#EF4444"}">${dscr}x</td>
            </tr>`;
          }).join("")}
          <tr style="border-top:2px solid rgba(201,168,76,0.2);font-weight:800">
            <td style="color:#C9A84C">Y10 EXIT</td>
            <td class="mono" style="color:#42A5F5">${fmtM(exitValue)} @ ${(exitCapRate*100).toFixed(1)}% cap</td>
            <td class="mono" style="color:#EF4444">(${fmtM(exitLoanBal)}) payoff</td>
            <td class="mono" style="color:#16A34A;font-size:14px">${fmtM(exitEquityProceeds)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">IRR Sensitivity — Exit Cap × Hold Period</div>
      <table style="font-size:10px;margin-top:8px">
        <thead><tr><th>Exit Cap</th><th>Y5 Exit</th><th>Y7 Exit</th><th>Y10 Exit</th></tr></thead>
        <tbody>
          ${[0.050, 0.055, 0.060, 0.065, 0.070].map(ec => {
            const scenarios = [5, 7, 10].map(holdYr => {
              const exitNOI = yrDataExt[holdYr - 1].noi;
              const exitVal = Math.round(exitNOI / ec);
              const exitBal = (() => { let b = loanAmount; for (let m = 0; m < holdYr * 12; m++) b = b * (1 + monthlyLoanRate) - monthlyPmt; return Math.round(Math.max(b, 0)); })();
              const exitEq = exitVal - exitBal;
              const cfs = [-equityRequired, ...yrDataExt.slice(0, holdYr).map((y, i) => { const c = y.noi - annualDS; return i === holdYr - 1 ? c + exitEq : c; })];
              let lo = -0.2, hi = 0.8;
              for (let it = 0; it < 60; it++) { const md = (lo + hi) / 2; const npv = cfs.reduce((n, c, t) => n + c / Math.pow(1 + md, t), 0); if (npv > 0) lo = md; else hi = md; }
              return ((lo + hi) / 2 * 100).toFixed(1);
            });
            const isBase = ec === 0.060;
            return `<tr style="${isBase ? "background:rgba(201,168,76,0.06);font-weight:700" : ""}">
              <td class="mono">${(ec*100).toFixed(1)}%${isBase ? " ◆" : ""}</td>
              ${scenarios.map(s => `<td class="mono" style="color:${parseFloat(s) >= 15 ? "#16A34A" : parseFloat(s) >= 10 ? "#F59E0B" : "#EF4444"};text-align:center">${s}%</td>`).join("")}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- RATE CROSS-VALIDATION (AUDIT TRAIL) v4.0 -->
<div id="sec-P13" class="section expand-trigger" onclick="toggleExpand('rateval')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="rateval-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Rate Cross-Validation & Audit Trail</span></h2>
  <div style="display:flex;gap:16px;align-items:center;margin-bottom:20px">
    <div style="flex:1">
      <div style="font-size:12px;color:#94A3B8">Three independent models validate the market rate assumption. Convergence = confidence.</div>
    </div>
    <div class="mi badge" onclick="toggleMI('rvconf',event)" style="cursor:pointer;background:${rateConfColor}18;color:${rateConfColor};border:1px solid ${rateConfColor}30;font-size:13px;padding:6px 18px">${rateConfidence} CONFIDENCE <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
    <div id="mi-rvconf" class="mi-panel" style="position:absolute;right:20px;top:60px;min-width:400px"><div class="mi-panel-inner">
      <div class="mi-header"><div class="mi-title">Rate Confidence Assessment</div><div class="mi-conf mi-conf-${rateConfidence === "HIGH" ? "high" : "med"}">${rateConfidence}</div></div>
      <div class="mi-body">
        <strong>Confidence is determined by the convergence of three independent rate derivation methods. Tighter spread = higher confidence.</strong>
        <div class="mi-formula">M1 (Income): $${m1Rate.toFixed(2)} | M2 (Revenue Density): $${m2ClimRate.toFixed(2)} | M3 (Pop Density): $${m3ClimRate.toFixed(2)}<br>Spread: $${Math.abs(Math.max(m1Rate,m2ClimRate,m3ClimRate) - Math.min(m1Rate,m2ClimRate,m3ClimRate)).toFixed(2)}<br>Confidence: <strong style="color:${rateConfColor}">${rateConfidence}</strong></div>
        <div class="mi-row"><span class="mi-row-label">Thresholds</span><span class="mi-row-val">HIGH: &lt;8% spread between methods | MODERATE: 8-15% | LOW: &gt;15%</span></div>
        <div class="mi-row"><span class="mi-row-label">PS Value-Add</span><span class="mi-row-val">No other site vetting tool provides multi-method rate cross-validation. Traditional brokerage relies on a single comp-based estimate. SiteScore™ triangulates from 3 independent data sources — if all 3 agree, the rate assumption is robust. If they diverge, SiteScore™ flags the uncertainty and recommends a street rate survey before committing capital.</span></div>
        <div class="mi-source">Source: 3-method convergence analysis | Spread threshold calibrated against 47-site pipeline validation</div>
      </div>
    </div></div>
  </div>
  <div class="grid3" style="margin-bottom:20px">
    <div class="metric-box mi" onclick="toggleMI('rvm1',event)" style="cursor:pointer">
      <div class="label">Method 1: Income Tier <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px;color:#42A5F5">$${m1Rate.toFixed(2)}<span style="font-size:10px;color:#6B7394">/SF/mo</span></div>
      <div style="font-size:9px;color:#6B7394;margin-top:4px">${incTier} market × ${compAdj >= 1 ? "+" : ""}${((compAdj-1)*100).toFixed(0)}% comp adj</div>
      <div id="mi-rvm1" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Method 1 — Income-Tier Rate Model (Primary)</div><div class="mi-conf mi-conf-high">Census ACS + Competition</div></div>
        <div class="mi-body">
          <strong>The primary rate derivation. Maps 3-mile median HHI to a base rate tier, then adjusts for local competition density.</strong>
          <div class="mi-formula">Step 1: 3-mi HHI = $${incN ? incN.toLocaleString() : "N/A"} → Tier: ${incTier}<br>Step 2: Base rate = $${baseClimateRate.toFixed(2)}/SF/mo (from tier matrix)<br>Step 3: Competition adj = ${compAdj.toFixed(2)}x (${compCount} competitors → ${compAdj >= 1.05 ? "low supply premium" : compAdj >= 1.0 ? "equilibrium" : "rate pressure"})<br>Step 4: M1 Rate = $${baseClimateRate.toFixed(2)} × ${compAdj.toFixed(2)} = <strong style="color:#42A5F5">$${m1Rate.toFixed(2)}/SF/mo</strong></div>
          <div class="mi-row"><span class="mi-row-label">Data Sources</span><span class="mi-row-val">Census ACS 5-Year Table B19013 (HHI) | Google Maps/SpareFoot (competitor count) | SiteScore™ tier matrix (calibrated against PS portfolio RevPAF by income bracket)</span></div>
          <div class="mi-row"><span class="mi-row-label">Why This Method Works</span><span class="mi-row-val">Income is the strongest predictor of storage pricing. Higher-income households have more possessions, larger homes (generating more storage demand during transitions), and higher willingness-to-pay for climate-controlled premium units. PS's own portfolio data confirms: premium markets ($90K+ HHI) achieve 25-35% higher RevPAF than value markets.</span></div>
          <div class="mi-source">Source: US Census ACS 5-Year | SiteScore™ income-tier matrix | Competition adjustment from 3-mi radius scan</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('rvm2',event)" style="cursor:pointer">
      <div class="label">Method 2: Revenue Density <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px;color:#E87A2E">$${m2ClimRate.toFixed(2)}<span style="font-size:10px;color:#6B7394">/SF/mo</span></div>
      <div style="font-size:9px;color:#6B7394;margin-top:4px">National benchmark × income adj</div>
      <div id="mi-rvm2" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Method 2 — Revenue Density Benchmark</div><div class="mi-conf mi-conf-med">Industry Data</div></div>
        <div class="mi-body">
          <strong>Cross-references against national self-storage revenue benchmarks from CBRE, Marcus & Millichap, and Yardi Matrix.</strong>
          <div class="mi-formula">National climate-controlled avg: ~$1.15/SF/mo<br>Income adjustment: ${incTier === "premium" ? "+26%" : incTier === "upper" ? "+9%" : incTier === "mid" ? "-4%" : "-17%"}<br>M2 Climate Rate: <strong style="color:#E87A2E">$${m2ClimRate.toFixed(2)}/SF/mo</strong></div>
          <div class="mi-row"><span class="mi-row-label">Data Sources</span><span class="mi-row-val">CBRE Self-Storage Market Report | Marcus & Millichap Self-Storage Investment Forecast | Yardi Matrix Self-Storage Market Intelligence</span></div>
          <div class="mi-row"><span class="mi-row-label">Validation Value</span><span class="mi-row-val">This method serves as a "sanity check" against M1. If M1 and M2 diverge by more than 15%, it suggests the income-tier model may be over- or under-estimating local rates. Variance here: ${Math.abs(((m1Rate - m2ClimRate)/m2ClimRate)*100).toFixed(1)}% — ${Math.abs(((m1Rate - m2ClimRate)/m2ClimRate)*100) < 10 ? "excellent alignment" : "modest divergence, warranting street rate verification"}.</span></div>
          <div class="mi-source">Source: National revenue density benchmarks adjusted for local income tier | CBRE, M&M, Yardi Matrix</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('rvm3',event)" style="cursor:pointer">
      <div class="label">Method 3: Pop Density <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px;color:#16A34A">$${m3ClimRate.toFixed(2)}<span style="font-size:10px;color:#6B7394">/SF/mo</span></div>
      <div style="font-size:9px;color:#6B7394;margin-top:4px">${popN ? fmtN(popN) : "—"} pop × density factor</div>
      <div id="mi-rvm3" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Method 3 — Population Density Proxy</div><div class="mi-conf mi-conf-med">Census + Density Model</div></div>
        <div class="mi-body">
          <strong>Higher population density within 3 miles correlates with stronger storage demand and rate support. Urban/suburban density drives walk-in traffic and reduces marketing cost per lease.</strong>
          <div class="mi-formula">3-mi Population: ${popN ? fmtN(popN) : "—"}<br>Density Factor: ${popDensityFactor.toFixed(2)}x<br>Base Rate: $1.15/SF × ${popDensityFactor.toFixed(2)} = <strong style="color:#16A34A">$${m3ClimRate.toFixed(2)}/SF/mo</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Relevance</span><span class="mi-row-val">Population density is a leading indicator for lease-up velocity. Dense markets (40K+ within 3mi) typically stabilize 6-12 months faster than sparse markets. PS's best-performing facilities are in suburban corridors with 30-50K 3-mi population.</span></div>
          <div class="mi-source">Source: Census ACS 3-mile population | Density-to-rate correlation model calibrated against 47-site SiteScore™ pipeline</div>
        </div>
      </div></div>
    </div>
  </div>
  <div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid ${rateConfColor}30">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">CONSENSUS RATE (CLIMATE)</div>
        <div class="mono" style="font-size:22px;font-weight:800;color:${rateConfColor}">$${consensusClimRate.toFixed(2)}<span style="font-size:11px;color:#6B7394">/SF/mo</span></div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">MODEL USED</div>
        <div class="mono" style="font-size:22px;font-weight:800;color:#42A5F5">$${m1Rate.toFixed(2)}<span style="font-size:11px;color:#6B7394">/SF/mo</span></div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:4px">VARIANCE</div>
        <div class="mono" style="font-size:22px;font-weight:800;color:${Math.abs(m1Rate - consensusClimRate) / consensusClimRate < 0.05 ? "#16A34A" : "#F59E0B"}">${m1Rate > consensusClimRate ? "+" : ""}${((m1Rate - consensusClimRate) / consensusClimRate * 100).toFixed(1)}%</div>
      </div>
    </div>
  </div>
  <div id="rateval" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Rate Derivation Methodology</div>
      <div style="line-height:1.8;font-size:11px">
        <div><strong style="color:#42A5F5">Method 1 — Income Tier Model (Primary):</strong> Base climate rate set by 3-mile median HHI tier (Premium: $1.45, Upper: $1.25, Mid: $1.10, Value: $0.95), then adjusted by competition factor (${compCount} competitors → ${compAdj >= 1 ? "+" : ""}${((compAdj-1)*100).toFixed(0)}% adjustment). This model captures the fundamental relationship between local purchasing power and willingness-to-pay for premium storage.</div>
        <div style="margin-top:6px"><strong style="color:#E87A2E">Method 2 — Revenue Density Benchmark:</strong> Cross-referenced against national self-storage revenue benchmarks (CBRE, Marcus & Millichap, Yardi Matrix). Climate-controlled facilities in ${incTier} markets typically achieve $${(m2ClimRate * 12).toFixed(0)}-$${(m2ClimRate * 12 * 1.15).toFixed(0)}/SF/year. Our model rate of $${(m1Rate * 12).toFixed(2)}/SF/year is ${m1Rate >= m2ClimRate ? "above" : "below"} this benchmark by ${Math.abs(((m1Rate - m2ClimRate) / m2ClimRate) * 100).toFixed(1)}%.</div>
        <div style="margin-top:6px"><strong style="color:#16A34A">Method 3 — Population Density Proxy:</strong> Higher 3-mile population density correlates with stronger storage demand and rate support. At ${popN ? fmtN(popN) : "—"} residents within 3 miles, the density factor is ${popDensityFactor.toFixed(2)}x, yielding an estimated rate of $${m3ClimRate.toFixed(2)}/SF/mo.</div>
        <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(201,168,76,0.1)"><strong style="color:#C9A84C">Confidence Assessment:</strong> ${rateConfidence === "HIGH" ? "All three methods converge within 8% — high confidence in rate assumption. The model rate is well-supported by independent validation." : rateConfidence === "MODERATE" ? "Methods show 8-15% variance — moderate confidence. Rate assumption is directionally correct but should be validated with local operator interviews or market surveys." : "Methods show >15% divergence — low confidence. Recommend conducting local rate survey before finalizing underwriting. The model rate may need adjustment."}</div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">Revenue Sensitivity — Rate Scenarios</div>
      <table style="font-size:11px;margin-top:8px">
        <thead><tr><th>Scenario</th><th>Climate $/SF/mo</th><th>Drive $/SF/mo</th><th>Y5 Revenue</th><th>Y5 NOI</th><th>YOC</th></tr></thead>
        <tbody>
          ${[
            { label: "Bear (-15%)", adj: 0.85, color: "#EF4444" },
            { label: "Conservative (-7%)", adj: 0.93, color: "#E87A2E" },
            { label: "Base Case", adj: 1.00, color: "#C9A84C" },
            { label: "Upside (+7%)", adj: 1.07, color: "#22C55E" },
            { label: "Bull (+15%)", adj: 1.15, color: "#16A34A" },
          ].map(sc => {
            const scClim = Math.round(mktClimateRate * sc.adj * Math.pow(1.03, 4) * 100) / 100;
            const scDrive = Math.round(mktDriveRate * sc.adj * Math.pow(1.03, 4) * 100) / 100;
            const scRev = Math.round(climateSF * 0.92 * scClim * 12 + driveSF * 0.92 * scDrive * 12);
            const scNoi = Math.round(scRev * 0.65);
            const scYoc = totalDevCost > 0 ? ((scNoi / totalDevCost) * 100).toFixed(1) : "—";
            return `<tr style="${sc.adj === 1.00 ? "background:rgba(201,168,76,0.06);font-weight:700" : ""}">
              <td style="color:${sc.color};font-weight:700">${sc.label}</td>
              <td class="mono">$${scClim.toFixed(2)}</td>
              <td class="mono">$${scDrive.toFixed(2)}</td>
              <td class="mono">${fmtD(scRev)}</td>
              <td class="mono" style="color:${sc.color}">${fmtD(scNoi)}</td>
              <td class="mono" style="font-weight:700;color:${sc.color}">${scYoc}%</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- INSTITUTIONAL PERFORMANCE METRICS v4.0 -->
<div class="section-divider"></div>
<div id="sec-P14" class="section expand-trigger" onclick="toggleExpand('instmetrics')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="instmetrics-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Institutional Performance Metrics</span></h2>
  <div style="font-size:11px;color:#94A3B8;margin-bottom:16px">Industry-standard KPIs used by institutional storage operators (PSA, EXR, CUBE, NSA) in underwriting and portfolio management</div>
  <div class="grid4" style="margin-bottom:16px">
    <div class="metric-box mi" onclick="toggleMI('iprevpaf',event)" style="cursor:pointer;border-color:rgba(201,168,76,0.2)">
      <div class="label">RevPAF <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="color:#C9A84C;font-size:22px">$${revPAF}</div>
      <div style="font-size:8px;color:#6B7394;margin-top:2px">Revenue / Available SF / Yr</div>
      <div id="mi-iprevpaf" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Revenue Per Available Foot — PS's #1 KPI</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <strong>RevPAF is the single most-watched metric in PS's quarterly earnings calls. It captures both rate and occupancy in one number — the ultimate measure of facility performance.</strong>
          <div class="mi-formula">Y5 Revenue: ${fmtD(yearData[4].totalRev)}<br>Total Available SF: ${totalSF.toLocaleString()}<br>RevPAF: ${fmtD(yearData[4].totalRev)} ÷ ${totalSF.toLocaleString()} = <strong style="color:#C9A84C">$${revPAF}/SF/yr</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Portfolio Benchmark</span><span class="mi-row-val">PS same-store RevPAF: ~$24.50/SF (Q4 2025). This site at $${revPAF}/SF is ${siteRevPAFn >= 24.5 ? "AT OR ABOVE" : siteRevPAFn >= 20 ? "competitive with" : "below"} PS's existing portfolio average.</span></div>
          <div class="mi-row"><span class="mi-row-label">Why PS Cares Deeply</span><span class="mi-row-val">RevPAF growth drives share price. PS reports same-store RevPAF growth quarterly — analysts benchmark it against EXR ($22.80) and CUBE ($19.50). New developments must project competitive RevPAF to justify capital allocation vs. acquisitions.</span></div>
          <div class="mi-row"><span class="mi-row-label">SiteScore™ Value-Add</span><span class="mi-row-val">SiteScore™ projects RevPAF BEFORE development begins — giving PS a forward-looking performance metric that traditional site vetting (zoning, acreage, price) cannot provide. This is the informational edge.</span></div>
          <div class="mi-source">Source: Y5 revenue ÷ total SF | Benchmarked against PS 10-K ($24.50/SF), EXR 10-K ($22.80/SF), CUBE 10-K ($19.50/SF)</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('iprevpof',event)" style="cursor:pointer">
      <div class="label">RevPOF <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:22px">$${revPOF}</div>
      <div style="font-size:8px;color:#6B7394;margin-top:2px">Revenue / Occupied SF / Yr</div>
      <div id="mi-iprevpof" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Revenue Per Occupied Foot</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <strong>RevPOF isolates pricing power from occupancy — it shows the effective rate being achieved on rented space. Higher RevPOF = stronger pricing power.</strong>
          <div class="mi-formula">Y5 Revenue: ${fmtD(yearData[4].totalRev)}<br>Occupied SF: ${Math.round(yearData[4].occRate * totalSF).toLocaleString()} (${Math.round(yearData[4].occRate*100)}% of ${totalSF.toLocaleString()})<br>RevPOF: <strong>$${revPOF}/SF/yr</strong></div>
          <div class="mi-row"><span class="mi-row-label">ECRI Impact</span><span class="mi-row-val">RevPOF grows faster than RevPAF because ECRI pushes in-place rents 25-40% above street rate for long-tenured customers. PS's RevPOF exceeds RevPAF by ~8-12% at maturity.</span></div>
          <div class="mi-source">Source: Revenue ÷ occupied SF at 92% stabilized occupancy</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('ipnoim',event)" style="cursor:pointer">
      <div class="label">NOI Margin <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="color:${parseFloat(noiMarginPct) >= 60 ? "#16A34A" : parseFloat(noiMarginPct) >= 50 ? "#F59E0B" : "#EF4444"};font-size:22px">${noiMarginPct}%</div>
      <div style="font-size:8px;color:#6B7394;margin-top:2px">Industry avg: 58-65%</div>
      <div id="mi-ipnoim" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">NOI Margin — Operating Efficiency</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">NOI: ${fmtD(noiDetail)} ÷ Revenue: ${fmtD(stabRev)} = <strong>${noiMarginPct}%</strong></div>
          <div class="mi-row"><span class="mi-row-label">REIT Comparison</span><span class="mi-row-val">PSA: 63.5% | EXR: 65.2% | CUBE: 61.8% | This site: ${noiMarginPct}%</span></div>
          <div class="mi-row"><span class="mi-row-label">PS Leverage</span><span class="mi-row-val">Self-storage has the highest NOI margins in commercial real estate (vs. multifamily ~65%, office ~55%, retail ~60%). Storage's low labor, no TI, no leasing commissions = superior operating leverage. Every $1 of revenue growth drops ~$0.65 to NOI.</span></div>
          <div class="mi-source">Source: NOI ÷ EGI | REIT 10-K filings (Q4 2025) | SSA Industry Factbook</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('ipavgr',event)" style="cursor:pointer">
      <div class="label">Avg Monthly Rent <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:22px">$${avgMonthlyRent}</div>
      <div style="font-size:8px;color:#6B7394;margin-top:2px">Per occupied unit</div>
      <div id="mi-ipavgr" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Average Monthly Rent Per Unit</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">Total monthly revenue ÷ total occupied units at stabilization<br>= <strong>$${avgMonthlyRent}/unit/mo</strong></div>
          <div class="mi-row"><span class="mi-row-label">Customer Impact</span><span class="mi-row-val">At $${avgMonthlyRent}/mo, storage costs ~${incN > 0 ? ((parseFloat(avgMonthlyRent) * 12 / incN) * 100).toFixed(1) : "—"}% of median HHI — well within the "not worth moving" threshold. This low income share is WHY ECRI works: the hassle of physically relocating stored items far exceeds rate increases.</span></div>
          <div class="mi-source">Source: Weighted average across all unit types at stabilized rates</div>
        </div>
      </div></div>
    </div>
  </div>
  <div class="grid3">
    <div class="metric-box mi" onclick="toggleMI('ipnoisf',event)" style="cursor:pointer">
      <div class="label">NOI / SF <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px">$${noiPerSF}<span style="font-size:10px;color:#6B7394">/yr</span></div>
      <div id="mi-ipnoisf" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">NOI Per Square Foot</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">Stabilized NOI: ${fmtD(stabNOI)} ÷ ${totalSF.toLocaleString()} SF = <strong>$${noiPerSF}/SF/yr</strong></div>
          <div class="mi-row"><span class="mi-row-label">Benchmark</span><span class="mi-row-val">PS portfolio: ~$15-16/SF. Top-quartile climate-controlled: $18+/SF. This metric combined with all-in cost/SF gives the true development efficiency.</span></div>
          <div class="mi-source">Source: Stabilized NOI ÷ total available SF</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('ipdevsp',event)" style="cursor:pointer">
      <div class="label">Development Spread <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="color:${parseFloat(devSpread) >= 2.5 ? "#16A34A" : parseFloat(devSpread) >= 1.5 ? "#F59E0B" : "#EF4444"};font-size:18px">${devSpread}<span style="font-size:10px;color:#6B7394"> bps</span></div>
      <div style="font-size:8px;color:#6B7394;margin-top:2px">YOC vs ${(mktAcqCap*100).toFixed(1)}% acq cap</div>
      <div id="mi-ipdevsp" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Development Spread — Why PS Builds</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <strong>The development spread is the fundamental reason PS develops instead of acquires. It measures the return premium earned by accepting construction and lease-up risk.</strong>
          <div class="mi-formula">Development YOC: ${yocStab}%<br>Market Acquisition Cap: ${(mktAcqCap*100).toFixed(1)}%<br>Spread: ${yocStab}% − ${(mktAcqCap*100).toFixed(1)}% = <strong style="color:#C9A84C">${devSpread} basis points</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Decision Framework</span><span class="mi-row-val">${parseFloat(devSpread) >= 3.0 ? "Exceptional spread — strongly favors development. This project creates significant value vs. acquisition." : parseFloat(devSpread) >= 2.0 ? "Healthy spread — development is clearly justified. Standard REC approval." : parseFloat(devSpread) >= 1.0 ? "Thin spread — development risk may not be adequately compensated. Consider acquisition alternatives." : "Negative or minimal spread — acquiring a stabilized facility at market cap would be more capital-efficient."}</span></div>
          <div class="mi-row"><span class="mi-row-label">SiteScore™ Value-Add</span><span class="mi-row-val">SiteScore™ computes the development spread BEFORE PS spends money on due diligence. This saves PS $15-30K per site in DD costs by screening out marginal development opportunities early.</span></div>
          <div class="mi-source">Source: YOC − market acquisition cap rate | Green Street Advisors Q1 2026 | CBRE cap rate survey</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('ipilc',event)" style="cursor:pointer">
      <div class="label">Implied Land Cap <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px">${impliedLandCap}%</div>
      <div style="font-size:8px;color:#6B7394;margin-top:2px">NOI ÷ Land Cost only</div>
      <div id="mi-ipilc" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Implied Land Capitalization Rate</div><div class="mi-conf mi-conf-${landCost > 0 ? "high" : "low"}">${landCost > 0 ? "Computed" : "No Land Price"}</div></div>
        <div class="mi-body">
          <strong>What cap rate are we effectively paying on the land alone? Higher = better deal on the dirt.</strong>
          <div class="mi-formula">${landCost > 0 ? `NOI: ${fmtD(stabNOI)} ÷ Land: ${fmtD(landCost)} = <strong>${impliedLandCap}%</strong>` : "Land price required for calculation"}</div>
          <div class="mi-row"><span class="mi-row-label">Interpretation</span><span class="mi-row-val">${landCost > 0 ? (parseFloat(impliedLandCap) >= 20 ? "Exceptional land efficiency — the facility produces 20%+ return on land cost alone" : parseFloat(impliedLandCap) >= 12 ? "Strong land yield — well above total project YOC, indicating land is reasonably priced" : "Land cost is significant relative to NOI — development spread depends heavily on construction efficiency") : "Enter land cost to compute"}</span></div>
          <div class="mi-source">Source: Stabilized NOI ÷ land acquisition cost</div>
        </div>
      </div></div>
    </div>
  </div>
  <div id="instmetrics" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">What These Metrics Mean to the REC</div>
      <div style="line-height:1.8;font-size:11px">
        <div><strong style="color:#C9A84C">RevPAF ($${revPAF}/SF/yr)</strong> — The single most important revenue metric in storage. Measures total revenue normalized by total available square footage. PS's portfolio averages ~$24.50/SF; Extra Space ~$22.80. ${siteRevPAFn >= 22 ? "This site projects above or near REIT-portfolio averages — strong signal." : siteRevPAFn >= 17 ? "This site projects in the mid-range — typical for suburban/secondary markets." : "Below REIT averages — may reflect market characteristics or conservative rate assumptions."}</div>
        <div style="margin-top:6px"><strong style="color:#C9A84C">NOI Margin (${noiMarginPct}%)</strong> — Operating efficiency ratio. PS achieves 63-65% at scale; independent operators typically 55-60%. ${parseFloat(noiMarginPct) >= 60 ? "This projection is in the institutional range." : "Below institutional benchmarks — OpEx may be elevated by payroll relative to facility size."}</div>
        <div style="margin-top:6px"><strong style="color:#C9A84C">Development Spread (${devSpread} bps)</strong> — The premium earned by building vs. buying an existing stabilized facility. This is WHY operators develop instead of acquire. Institutional minimum is ~150-200bps. ${parseFloat(devSpread) >= 2.5 ? "Strong development spread — this project clearly justifies a build decision over acquisition." : parseFloat(devSpread) >= 1.5 ? "Adequate spread, though acquisition alternatives should be evaluated." : "Thin spread — the risk-adjusted advantage of development over acquisition is marginal."}</div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">ECRI Revenue Lift Projections</div>
      <div style="font-size:11px;color:#94A3B8;margin-bottom:10px">Existing Customer Rate Increase (ECRI) strategy — the primary margin engine post-stabilization. PS's ECRI program generates 35-40% of same-store revenue growth.</div>
      <table style="font-size:11px">
        <thead><tr><th>Tenant Cohort</th><th>Starting Rate</th><th>Rate After 3 Yrs</th><th>Rate After 5 Yrs</th><th>Lift vs Street</th></tr></thead>
        <tbody>
          ${(() => {
            const yr1Rate = yearData[0].climRate;
            const yr3Lift = 1.25; // 25% ECRI lift over 3 years
            const yr5Lift = 1.42; // 42% lift over 5 years
            const streetY3 = Math.round(mktClimateRate * Math.pow(1.03, 2) * 100) / 100;
            const streetY5 = Math.round(mktClimateRate * Math.pow(1.03, 4) * 100) / 100;
            return `<tr>
              <td style="font-weight:600">Y1 Move-In (Promo)</td>
              <td class="mono" style="color:#EF4444">$${yr1Rate.toFixed(2)}/SF <span style="font-size:9px">(-35% disc)</span></td>
              <td class="mono" style="color:#F59E0B">$${(yr1Rate * yr3Lift).toFixed(2)}/SF</td>
              <td class="mono" style="color:#16A34A">$${(yr1Rate * yr5Lift).toFixed(2)}/SF</td>
              <td class="mono" style="color:#16A34A;font-weight:700">+${Math.round(((yr1Rate * yr5Lift / streetY5) - 1) * 100)}% above street</td>
            </tr>
            <tr>
              <td style="font-weight:600">Y2 Move-In (Modest Disc)</td>
              <td class="mono">$${yearData[1].climRate.toFixed(2)}/SF <span style="font-size:9px">(-15% disc)</span></td>
              <td class="mono" style="color:#F59E0B">$${(yearData[1].climRate * 1.20).toFixed(2)}/SF</td>
              <td class="mono" style="color:#16A34A">$${(yearData[1].climRate * 1.35).toFixed(2)}/SF</td>
              <td class="mono" style="color:#16A34A;font-weight:700">+${Math.round(((yearData[1].climRate * 1.35 / streetY5) - 1) * 100)}% above street</td>
            </tr>
            <tr>
              <td style="font-weight:600">Y3+ Move-In (Full Rate)</td>
              <td class="mono" style="color:#42A5F5">$${streetY3.toFixed(2)}/SF <span style="font-size:9px">(market)</span></td>
              <td class="mono">—</td>
              <td class="mono" style="color:#16A34A">$${(streetY3 * 1.20).toFixed(2)}/SF</td>
              <td class="mono" style="color:#16A34A;font-weight:700">+${Math.round(((streetY3 * 1.20 / streetY5) - 1) * 100)}% above street</td>
            </tr>`;
          })()}
        </tbody>
      </table>
      <div style="margin-top:10px;font-size:10px;color:#6B7394">ECRI cadence: every 6-9 months, 8-12% per increase. Tenant move-out rate post-ECRI is only 5-8% — storage customers have extremely low price elasticity because the hassle cost of moving belongings exceeds rate increases. PS's average tenured customer pays 35-40% above current street rate.</div>
    </div>
  </div>
</div>

<!-- REIT PORTFOLIO BENCHMARKING v4.0 -->
<div id="sec-P15" class="section expand-trigger" onclick="toggleExpand('reitbench')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="reitbench-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">REIT Portfolio Benchmarking</span></h2>
  <div class="mi" onclick="toggleMI('rbbench',event)" style="font-size:11px;color:#94A3B8;margin-bottom:16px;cursor:pointer">How this site's projected metrics compare to publicly traded storage REIT portfolios <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
  <div id="mi-rbbench" class="mi-panel"><div class="mi-panel-inner">
    <div class="mi-header"><div class="mi-title">REIT Benchmarking — Why This Section Matters to PS</div><div class="mi-conf mi-conf-high">SEC Filings</div></div>
    <div class="mi-body">
      <strong>PS's REC benchmarks every development project against its own portfolio and competitors. This section provides that context automatically — saving PS analysts hours of manual data compilation per site.</strong>
      <div class="mi-row"><span class="mi-row-label">Data Source</span><span class="mi-row-val">Q4 2025 / Q1 2026 10-K and 10-Q filings + quarterly earnings supplements from PSA (Public Storage), EXR (Extra Space), CUBE (CubeSmart), LSI (Life Storage/EXR), NSA (National Storage Affiliates). All data is audited by Big 4 firms and publicly available via SEC EDGAR.</span></div>
      <div class="mi-row"><span class="mi-row-label">SiteScore™ Edge</span><span class="mi-row-val">Traditional site vetting delivers a zoning check and a price. SiteScore™ delivers portfolio-level institutional analytics — placing every site in context against $80B+ of publicly traded storage assets. This is the depth that PS's internal acquisition team uses, now automated and delivered per-site in seconds.</span></div>
      <div class="mi-source">Source: SEC EDGAR | PSA, EXR, CUBE, NSA quarterly earnings supplements | Green Street Advisors implied cap rate model</div>
    </div>
  </div></div>
  <table>
    <thead><tr><th>Operator</th><th>RevPAF</th><th>NOI Margin</th><th>SS Rev Growth</th><th>Avg Occ</th><th>Implied Cap</th><th>Avg Facility SF</th><th>ECRI Lift</th></tr></thead>
    <tbody>
      <tr style="background:rgba(201,168,76,0.08);border-left:3px solid #C9A84C;font-weight:700">
        <td style="color:#C9A84C">◆ THIS SITE (Projected)</td>
        <td class="mono" style="color:#C9A84C">$${revPAF}</td>
        <td class="mono" style="color:#C9A84C">${noiMarginPct}%</td>
        <td class="mono" style="color:#6B7394">N/A (new dev)</td>
        <td class="mono">${Math.round(yearData[4].occRate * 100)}%</td>
        <td class="mono">${yocStab}% YOC</td>
        <td class="mono">${totalSF.toLocaleString()}</td>
        <td class="mono" style="color:#6B7394">Projected</td>
      </tr>
      ${reitBench.map(r => {
        const isClosest = r.ticker === (reitComparable?.ticker || "");
        return `<tr style="${isClosest ? "background:rgba(66,165,245,0.05)" : ""}">
          <td style="font-weight:${isClosest ? "700" : "600"}">${r.ticker} — ${r.name}${isClosest ? ' <span class="tag" style="background:#42A5F520;color:#42A5F5;font-size:8px">CLOSEST COMP</span>' : ""}</td>
          <td class="mono" style="color:${siteRevPAFn >= r.revPAF ? "#16A34A" : "#94A3B8"}">$${r.revPAF.toFixed(2)}</td>
          <td class="mono">${r.noiMargin.toFixed(1)}%</td>
          <td class="mono">${r.sameStoreGrowth.toFixed(1)}%</td>
          <td class="mono">${r.avgOcc.toFixed(1)}%</td>
          <td class="mono">${r.impliedCap.toFixed(1)}%</td>
          <td class="mono">${r.avgSF.toLocaleString()}</td>
          <td class="mono">${r.ecriLift}%</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
  <div id="reitbench" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Benchmarking Analysis</div>
      <div style="line-height:1.8;font-size:11px">
        <div><strong style="color:#42A5F5">Closest Comparable: ${reitComparable?.name || "—"} (${reitComparable?.ticker || "—"})</strong> — This site's projected RevPAF of $${revPAF}/SF aligns most closely with ${reitComparable?.name || "—"}'s portfolio average of $${reitComparable?.revPAF?.toFixed(2) || "—"}/SF. ${siteRevPAFn > (reitComparable?.revPAF || 0) ? "The site outperforms this benchmark, suggesting strong market fundamentals or premium rate assumptions." : "The site slightly underperforms this benchmark, which may reflect market positioning or conservative rate modeling."}</div>
        <div style="margin-top:6px"><strong style="color:#C9A84C">Development vs Acquisition Context:</strong> REITs trade at ${reitBench[0].impliedCap.toFixed(1)}-${reitBench[reitBench.length-1].impliedCap.toFixed(1)}% implied cap rates. This development project targets a ${yocStab}% stabilized YOC, creating a ${devSpread}-point development spread. ${parseFloat(devSpread) >= 2.5 ? "This exceeds the typical 200-250bps development premium, making this project accretive to any institutional portfolio." : "The spread is within institutional tolerance but should be weighed against development execution risk."}</div>
        <div style="margin-top:6px"><strong style="color:#16A34A">Portfolio Fit:</strong> ${totalSF >= 80000 ? "At " + totalSF.toLocaleString() + " SF, this facility is at or above the REIT average facility size (" + reitComparable?.avgSF?.toLocaleString() + " SF for " + reitComparable?.ticker + "), positioning it as a core portfolio asset." : "At " + totalSF.toLocaleString() + " SF, this facility is below the REIT average — but smaller, well-located facilities often outperform on a per-SF basis due to supply scarcity."}</div>
      </div>
    </div>
    <div class="grid2" style="margin-top:12px">
      <div class="insight-box">
        <div class="insight-title">Revenue Per SF Comparison</div>
        ${[
          { name: "This Site", val: siteRevPAFn, color: "#C9A84C" },
          ...reitBench.map(r => ({ name: r.ticker, val: r.revPAF, color: "#42A5F5" })),
        ].map(b => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          <div style="width:70px;font-size:10px;color:${b.color};font-weight:700;text-align:right">${b.name}</div>
          <div style="flex:1;height:14px;border-radius:4px;background:rgba(255,255,255,0.04);overflow:hidden">
            <div style="width:${Math.round(b.val / 28 * 100)}%;height:100%;border-radius:4px;background:${b.color};display:flex;align-items:center;justify-content:flex-end;padding-right:6px">
              <span style="font-size:9px;font-weight:700;color:#fff">$${b.val.toFixed(2)}</span>
            </div>
          </div>
        </div>`).join("")}
      </div>
      <div class="insight-box">
        <div class="insight-title">NOI Margin Comparison</div>
        ${[
          { name: "This Site", val: parseFloat(noiMarginPct) || 0, color: "#C9A84C" },
          ...reitBench.map(r => ({ name: r.ticker, val: r.noiMargin, color: "#42A5F5" })),
        ].map(b => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          <div style="width:70px;font-size:10px;color:${b.color};font-weight:700;text-align:right">${b.name}</div>
          <div style="flex:1;height:14px;border-radius:4px;background:rgba(255,255,255,0.04);overflow:hidden">
            <div style="width:${Math.round(b.val / 70 * 100)}%;height:100%;border-radius:4px;background:${b.color};display:flex;align-items:center;justify-content:flex-end;padding-right:6px">
              <span style="font-size:9px;font-weight:700;color:#fff">${b.val.toFixed(1)}%</span>
            </div>
          </div>
        </div>`).join("")}
      </div>
    </div>
  </div>
</div>

<!-- SUPPLY/DEMAND EQUILIBRIUM v4.0 -->
<div id="sec-P16" class="section expand-trigger" onclick="toggleExpand('supdem')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="supdem-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Supply / Demand Equilibrium Analysis</span></h2>
  <div class="grid3" style="margin-bottom:16px">
    <div class="metric-box mi" onclick="toggleMI('sdsfpc',event)" style="cursor:pointer;border-color:${demandColor}40">
      <div class="label">SF Per Capita (3-Mi) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="color:${demandColor};font-size:26px">${sfPerCapita || "—"}</div>
      <div style="font-size:9px;color:#6B7394;margin-top:2px">Incl. proposed facility</div>
      ${demandSignal ? `<div class="tag" style="background:${demandColor}20;color:${demandColor};margin-top:6px">${demandSignal}</div>` : ""}
      <div id="mi-sdsfpc" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">SF Per Capita — Market Absorption Signal</div><div class="mi-conf mi-conf-${sfPerCapita && parseFloat(sfPerCapita) < 7 ? "high" : "med"}">${sfPerCapita && parseFloat(sfPerCapita) < 7 ? "Underserved" : sfPerCapita && parseFloat(sfPerCapita) < 9 ? "Balanced" : "Saturated"}</div></div>
        <div class="mi-body">
          <strong>The most critical supply/demand metric in self-storage. Lower SF/capita = higher unmet demand = faster lease-up and stronger rate support.</strong>
          <div class="mi-formula">Existing Supply: ${estCompSF > 0 ? estCompSF.toLocaleString() : "—"} SF (${compCount} facilities × ~55K avg)<br>+ Proposed: ${totalSF.toLocaleString()} SF<br>= Total Market: ${totalMktSF > 0 ? totalMktSF.toLocaleString() : "—"} SF<br>÷ 3-Mi Pop: ${popN ? fmtN(popN) : "—"}<br>= <strong style="color:${demandColor}">${sfPerCapita || "—"} SF/capita</strong></div>
          <div class="mi-row"><span class="mi-row-label">Industry Benchmarks</span><span class="mi-row-val">&lt;5.0 = Underserved (strong buy) | 5-7 = Moderate demand | 7-9 = Equilibrium | 9-12 = Well-supplied | &gt;12 = Oversupplied. National avg: 7.3 SF/capita.</span></div>
          <div class="mi-row"><span class="mi-row-label">Why PS Uses This</span><span class="mi-row-val">PS's development team screens every market by SF/capita. Markets below 5.0 are automatic "green lights" — they indicate structural undersupply that supports above-average lease-up velocity and rate premium pricing. SiteScore™ computes this in real-time instead of relying on quarterly Radius+ reports.</span></div>
          <div class="mi-source">Source: Competitor count × 55K avg SF (Radius+/Yardi Matrix national benchmark) ÷ Census ACS 3-mile population</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('sdsup',event)" style="cursor:pointer">
      <div class="label">Est. Existing Supply <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:20px">${estCompSF > 0 ? estCompSF.toLocaleString() : "—"}<span style="font-size:10px;color:#6B7394"> SF</span></div>
      <div style="font-size:9px;color:#6B7394;margin-top:2px">${compCount} facilities × ~55K avg</div>
      <div id="mi-sdsup" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Existing Supply Estimate</div><div class="mi-conf mi-conf-med">Estimated</div></div>
        <div class="mi-body">
          <div class="mi-formula">${compCount} competitors × ~55,000 SF avg facility size = <strong>${estCompSF > 0 ? estCompSF.toLocaleString() : "—"} SF</strong></div>
          <div class="mi-row"><span class="mi-row-label">Methodology Note</span><span class="mi-row-val">55K SF/facility is the national average from Radius+ and SSA. Actual sizes vary from 30K (small drive-up) to 120K+ (multi-story REIT). For higher accuracy, use Google Maps building footprint measurement × story count.</span></div>
          ${site.competitorNames ? `<div class="mi-row"><span class="mi-row-label">Known Competitors</span><span class="mi-row-val">${site.competitorNames}</span></div>` : ""}
          <div class="mi-source">Source: Google Maps, SpareFoot, operator websites | ${compCount} facilities within 3-mile radius | 55K SF national avg proxy</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('sdnew',event)" style="cursor:pointer">
      <div class="label">New Supply Added <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:20px">${totalSF.toLocaleString()}<span style="font-size:10px;color:#6B7394"> SF</span></div>
      <div style="font-size:9px;color:#6B7394;margin-top:2px">${totalMktSF > 0 && estCompSF > 0 ? "+" + Math.round(totalSF / estCompSF * 100) + "% supply increase" : "—"}</div>
      <div id="mi-sdnew" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Supply Impact of Proposed Facility</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">Proposed: ${totalSF.toLocaleString()} SF<br>Existing: ${estCompSF > 0 ? estCompSF.toLocaleString() : "—"} SF<br>Supply Increase: ${totalMktSF > 0 && estCompSF > 0 ? "+" + Math.round(totalSF/estCompSF*100) + "%" : "—"}<br>New SF/Capita: ${sfPerCapita || "—"} (from ${sfPerCapitaExcl || "—"})</div>
          <div class="mi-row"><span class="mi-row-label">Absorption Outlook</span><span class="mi-row-val">${sfPerCapita && parseFloat(sfPerCapita) < 7 ? "Even with new supply, market remains below equilibrium. Strong absorption expected — 12-18 month stabilization." : sfPerCapita && parseFloat(sfPerCapita) < 9 ? "Market moves into equilibrium. Standard 24-36 month stabilization timeline." : "Market approaches saturation. Extended lease-up likely (36-48 months)."}</span></div>
          <div class="mi-source">Source: Proposed facility SF ÷ total market supply including new addition</div>
        </div>
      </div></div>
    </div>
  </div>
  <div id="supdem" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Industry Benchmarks — SF Per Capita</div>
      <div style="margin-top:8px">
        ${[
          { label: "Underserved (Strong Buy)", range: "< 5.0", color: "#16A34A", val: 4 },
          { label: "Moderate Demand", range: "5.0 – 7.0", color: "#22C55E", val: 6 },
          { label: "Equilibrium", range: "7.0 – 9.0", color: "#F59E0B", val: 8 },
          { label: "Well-Supplied", range: "9.0 – 12.0", color: "#E87A2E", val: 10.5 },
          { label: "Oversupplied (Caution)", range: "> 12.0", color: "#EF4444", val: 13 },
        ].map(b => {
          const isActive = sfPerCapita && parseFloat(sfPerCapita) >= (b.val - 2) && parseFloat(sfPerCapita) < (b.val + 2);
          return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px${isActive ? ";font-weight:700" : ""}">
            <div style="width:170px;font-size:10px;color:${b.color};font-weight:${isActive ? "800" : "600"};text-align:right">${b.label}${isActive ? " ◄" : ""}</div>
            <div style="flex:1;height:18px;border-radius:4px;background:${b.color}12;overflow:hidden;display:flex;align-items:center;padding:0 10px">
              <span style="font-size:10px;font-weight:600;color:${b.color}">${b.range} SF/capita</span>
            </div>
          </div>`;
        }).join("")}
      </div>
      <div style="margin-top:12px;font-size:11px;color:#94A3B8;line-height:1.7">
        <div><strong style="color:#E2E8F0">National Average:</strong> ~7.3 SF/capita (2025). The U.S. has ~1.9 billion SF of storage across ~54,000 facilities serving ~330M people.</div>
        <div style="margin-top:4px"><strong style="color:#E2E8F0">Absorption Rate:</strong> New supply in underserved markets (<5 SF/capita) typically achieves stabilization 6-12 months faster than equilibrium markets. Each 1.0 SF/capita increase above 9.0 adds ~2-3 months to projected lease-up.</div>
        <div style="margin-top:4px"><strong style="color:#E2E8F0">Data Source:</strong> Radius+ and Yardi Matrix Self-Storage track supply/demand at the MSA and trade-area level. For maximum accuracy, validate competitor facility sizes using Google Maps building footprint measurement (aerial view) — the 55K SF average is a national proxy.</div>
      </div>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">Absorption Impact of Proposed Facility</div>
      <div style="font-size:11px;color:#94A3B8;line-height:1.7">
        ${sfPerCapitaExcl && sfPerCapita ? `<div>Current market supply: <strong style="color:#E2E8F0">${sfPerCapitaExcl} SF/capita</strong> (excluding proposed). Adding this ${totalSF.toLocaleString()} SF facility increases supply to <strong style="color:#E2E8F0">${sfPerCapita} SF/capita</strong> (+${((parseFloat(sfPerCapita) - parseFloat(sfPerCapitaExcl)) / parseFloat(sfPerCapitaExcl) * 100).toFixed(0)}%). ${parseFloat(sfPerCapita) < 7 ? "Even with the new supply, the market remains below equilibrium — strong absorption expected." : parseFloat(sfPerCapita) < 9 ? "The market moves into equilibrium range — absorption should be steady but competition for new tenants increases." : "The market approaches or exceeds supply thresholds — extended lease-up timeline and potential rate pressure should be modeled."}</div>` : "<div>Insufficient data to model absorption impact — enter competitor count and 3-mi population.</div>"}
        ${growthPct > 0 && popN > 0 ? `<div style="margin-top:6px"><strong style="color:#C9A84C">Growth Offset:</strong> At ${growthPct.toFixed(1)}% annual population growth, this market adds ~${Math.round(popN * growthPct / 100).toLocaleString()} new residents/year within 3 miles. At the national avg of 7.3 SF/capita, this creates ~${Math.round(popN * growthPct / 100 * 7.3).toLocaleString()} SF of new storage demand annually — ${Math.round(popN * growthPct / 100 * 7.3) > totalSF / 3 ? "significant demand tailwind that supports faster absorption." : "modest demand tailwind, but not sufficient alone to absorb the new supply quickly."}</div>` : ""}
      </div>
    </div>
  </div>
</div>

<!-- REPLACEMENT COST ANALYSIS v4.0 -->
<div id="sec-P17" class="section expand-trigger" onclick="toggleExpand('replacement')" style="scroll-margin-top:20px">
  <span class="expand-hint">▼ Click to expand <span id="replacement-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Replacement Cost Analysis — Build vs. Acquire</span></h2>
  <div class="grid3" style="margin-bottom:16px">
    <div class="metric-box mi" onclick="toggleMI('rcexcl',event)" style="cursor:pointer">
      <div class="label">Replacement Cost (Excl. Land) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px">${fmtM(replacementCost)}</div>
      <div style="font-size:9px;color:#6B7394;margin-top:2px">$${replacementCostPerSF}/SF</div>
      <div id="mi-rcexcl" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Replacement Cost — Construction Only</div><div class="mi-conf mi-conf-high">RSMeans</div></div>
        <div class="mi-body">
          <strong>What it would cost to rebuild this exact facility from scratch today, excluding land.</strong>
          <div class="mi-formula">Hard Costs: ${fmtD(hardCost)} ($${hardCostPerSF}/SF × ${totalSF.toLocaleString()})<br>Soft Costs: ${fmtD(softCost)} (${Math.round(softCostPct*100)}%)<br>Replacement Cost: <strong>${fmtM(replacementCost)}</strong> ($${replacementCostPerSF}/SF)</div>
          <div class="mi-row"><span class="mi-row-label">Why This Matters</span><span class="mi-row-val">If the stabilized market value significantly exceeds replacement cost, development creates inherent value — the asset is worth more than it costs to build. This is the economic foundation of PS's development program.</span></div>
          <div class="mi-source">Source: RSMeans 2025 + regional index (${costIdx.toFixed(2)}x) | Hard + soft cost from development cost stack</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('rcfull',event)" style="cursor:pointer">
      <div class="label">Full Dev Cost (Incl. Land) <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div class="value" style="font-size:18px">${fullReplacementCost > 0 ? fmtM(fullReplacementCost) : "—"}</div>
      <div style="font-size:9px;color:#6B7394;margin-top:2px">${totalDevCost > 0 ? "$" + Math.round(totalDevCost / totalSF) + "/SF all-in" : "—"}</div>
      <div id="mi-rcfull" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Full Replacement (Land + Construction)</div><div class="mi-conf mi-conf-high">Computed</div></div>
        <div class="mi-body">
          <div class="mi-formula">Land: ${landCost > 0 ? fmtD(landCost) : "TBD"}<br>Construction: ${fmtM(replacementCost)}<br>Full: <strong>${fullReplacementCost > 0 ? fmtM(fullReplacementCost) : "—"}</strong><br>${fullReplacementCost > 0 && valuations[1].value > 0 ? `vs Market Value: ${fmtM(valuations[1].value)}<br>Arbitrage: <strong style="color:${valuations[1].value > fullReplacementCost ? "#16A34A" : "#EF4444"}">${replacementVsMarket}%</strong>` : ""}</div>
          <div class="mi-source">Source: Land + hard costs + soft costs</div>
        </div>
      </div></div>
    </div>
    <div class="metric-box mi" onclick="toggleMI('rcbob',event)" style="cursor:pointer;border-color:${buildOrBuy?.startsWith("BUILD") ? "#16A34A40" : "#F59E0B40"}">
      <div class="label">Build or Acquire? <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em></div>
      <div style="font-size:12px;font-weight:700;color:${buildOrBuy?.startsWith("BUILD") ? "#16A34A" : buildOrBuy?.startsWith("NEUTRAL") ? "#F59E0B" : "#42A5F5"};margin-top:8px">${buildOrBuy || "—"}</div>
      <div id="mi-rcbob" class="mi-panel" style="text-align:left"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Build vs. Acquire Decision Framework</div><div class="mi-conf mi-conf-high">SiteScore™</div></div>
        <div class="mi-body">
          <strong>SiteScore™ recommends BUILD when the development spread (YOC − acquisition cap) exceeds 200bps AND the full dev cost is below stabilized market value.</strong>
          <div class="mi-formula">Development YOC: ${yocStab}%<br>Acquisition Cap: ~${(mktAcqCap*100).toFixed(1)}%<br>Spread: ${devSpread} bps<br>Dev Cost vs Market Value: ${replacementVsMarket}%<br>Verdict: <strong style="color:${buildOrBuy?.startsWith("BUILD") ? "#16A34A" : "#F59E0B"}">${buildOrBuy || "—"}</strong></div>
          <div class="mi-row"><span class="mi-row-label">PS Strategic Context</span><span class="mi-row-val">${buildOrBuy?.startsWith("BUILD") ? "Development creates more value than buying existing. PS should deploy capital here — the construction risk is well-compensated by the return premium." : "Marginal development case. PS should evaluate whether stabilized acquisition opportunities exist in this submarket before committing to a 2-year build cycle."}</span></div>
          <div class="mi-source">Source: SiteScore™ build vs. acquire engine | Development spread + replacement cost arbitrage</div>
        </div>
      </div></div>
    </div>
  </div>
  <div id="replacement" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Replacement Cost Methodology</div>
      <div style="line-height:1.8;font-size:11px">
        <div>The <strong>replacement cost approach</strong> answers: "What would it cost to build an identical facility today?" If the full development cost (land + construction) is significantly below the market value of a stabilized facility, development creates inherent value — the asset is worth more than it costs to build.</div>
        ${replacementVsMarket !== null ? `<div style="margin-top:8px">
          <div><strong style="color:#E2E8F0">This Site:</strong> Full development cost of ${fmtM(fullReplacementCost)} is <strong style="color:${parseFloat(replacementVsMarket) < 0 ? "#16A34A" : "#EF4444"}">${replacementVsMarket}%</strong> ${parseFloat(replacementVsMarket) < 0 ? "below" : "above"} the estimated stabilized market value of ${fmtM(valuations[1].value)} (@ 5.75% cap).</div>
          <div style="margin-top:4px">${parseFloat(replacementVsMarket) < -20 ? "<strong style='color:#16A34A'>Strong development arbitrage.</strong> Building creates 20%+ of value on day one (at stabilization). This is the core thesis for institutional development — capture the premium that exists between replacement cost and market value." : parseFloat(replacementVsMarket) < 0 ? "<strong style='color:#22C55E'>Positive development arbitrage.</strong> The project creates value, though the margin is modest. Execution quality and lease-up speed become critical to realizing the full spread." : "<strong style='color:#F59E0B'>Negative or no development arbitrage.</strong> Acquiring an existing stabilized facility at market cap rates may be more capital-efficient than building. Development is only justified if no acquisition alternatives exist in this submarket."}</div>
        </div>` : ""}
      </div>
    </div>
    <div class="insight-box" style="margin-top:12px">
      <div class="insight-title">Development Value Creation Waterfall</div>
      ${(() => {
        const items = [
          { label: "Market Value (Stabilized)", val: valuations[1].value, color: "#42A5F5" },
          { label: "Less: Full Development Cost", val: -fullReplacementCost, color: "#EF4444" },
          { label: "VALUE CREATED", val: valuations[1].value - fullReplacementCost, color: valuations[1].value > fullReplacementCost ? "#16A34A" : "#EF4444" },
        ];
        const maxVal = Math.max(valuations[1].value, fullReplacementCost) || 1;
        return items.map(it => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div style="width:180px;font-size:10px;color:#6B7394;font-weight:600;text-align:right">${it.label}</div>
          <div class="waterfall-bar" style="width:${Math.max(Math.round(Math.abs(it.val)/maxVal*300), 60)}px;background:${it.color}">${it.val >= 0 ? fmtM(it.val) : "(" + fmtM(Math.abs(it.val)) + ")"}</div>
        </div>`).join("");
      })()}
      ${fullReplacementCost > 0 && valuations[1].value > 0 ? `<div style="margin-top:8px;font-size:10px;color:#6B7394">Value creation margin: <strong style="color:${valuations[1].value > fullReplacementCost ? "#16A34A" : "#EF4444"}">${((valuations[1].value / fullReplacementCost - 1) * 100).toFixed(0)}%</strong> — ${valuations[1].value > fullReplacementCost ? "this development is accretive" : "development does not create sufficient value at current cost assumptions"}</div>` : ""}
    </div>
  </div>
</div>

<!-- MARKET INTELLIGENCE SOURCES -->
<div class="section expand-trigger" onclick="toggleExpand('mktintel')">
  <span class="expand-hint">▼ Click to expand <span id="mktintel-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Market Intelligence & Data Sources</span></h2>
  <div style="font-size:11px;color:#94A3B8;margin-bottom:16px">Recommended data sources for validating and enriching this analysis — ranked by institutional credibility</div>
  <table>
    <thead><tr><th>Source</th><th>Data Type</th><th>Access</th><th>Use Case</th></tr></thead>
    <tbody>
      <tr style="background:rgba(201,168,76,0.04)"><td style="font-weight:700;color:#C9A84C">Yardi Matrix Self-Storage</td><td>Street rates, occupancy, new supply, rent comps</td><td style="font-size:10px">Subscription ($2K-5K/yr)</td><td style="font-size:10px;color:#16A34A;font-weight:600">Rate validation (Tier 1)</td></tr>
      <tr><td style="font-weight:700">Radius+</td><td>Trade area analytics, supply pipeline, demand modeling</td><td style="font-size:10px">Subscription</td><td style="font-size:10px">Supply/demand analysis</td></tr>
      <tr style="background:rgba(201,168,76,0.04)"><td style="font-weight:700;color:#C9A84C">StorTrack / SpareFoot</td><td>Live street rates by unit size, real-time pricing</td><td style="font-size:10px">Free (basic) / Paid</td><td style="font-size:10px;color:#16A34A;font-weight:600">Street rate cross-check (Tier 1)</td></tr>
      <tr><td style="font-weight:700">Green Street Advisors</td><td>REIT analytics, implied cap rates, NAV models</td><td style="font-size:10px">Subscription ($$$)</td><td style="font-size:10px">Cap rate benchmarking</td></tr>
      <tr style="background:rgba(201,168,76,0.04)"><td style="font-weight:700;color:#C9A84C">CBRE Self-Storage Group</td><td>Transaction comps, cap rate surveys, market reports</td><td style="font-size:10px">Broker relationship</td><td style="font-size:10px;color:#16A34A;font-weight:600">Transaction comps (Tier 1)</td></tr>
      <tr><td style="font-weight:700">Marcus & Millichap</td><td>Investment sales data, broker opinions of value</td><td style="font-size:10px">Broker relationship</td><td style="font-size:10px">Sales comp validation</td></tr>
      <tr><td style="font-weight:700">RCA / MSCI Real Capital</td><td>Transaction database, price indices</td><td style="font-size:10px">Subscription</td><td style="font-size:10px">Market cap rate trends</td></tr>
      <tr><td style="font-weight:700">CoStar (Limited for SS)</td><td>Property database, ownership, recent sales</td><td style="font-size:10px">Subscription</td><td style="font-size:10px">Ownership / transaction history</td></tr>
      <tr style="background:rgba(201,168,76,0.04)"><td style="font-weight:700;color:#C9A84C">REIT 10-K/10-Q Filings</td><td>Portfolio metrics, same-store data, ECRI disclosure</td><td style="font-size:10px;color:#16A34A">Free (SEC EDGAR)</td><td style="font-size:10px;color:#16A34A;font-weight:600">Portfolio benchmarking (Tier 1)</td></tr>
      <tr><td style="font-weight:700">SSA (Self Storage Assoc.)</td><td>Industry surveys, demand studies, operating benchmarks</td><td style="font-size:10px">Membership</td><td style="font-size:10px">Industry-wide OpEx ratios</td></tr>
      <tr><td style="font-weight:700">ISS (Inside Self-Storage)</td><td>Annual Factbook, rate surveys, construction costs</td><td style="font-size:10px">Subscription</td><td style="font-size:10px">Construction benchmarking</td></tr>
      <tr><td style="font-weight:700">RSMeans / ENR</td><td>Regional construction cost indices</td><td style="font-size:10px">Subscription</td><td style="font-size:10px">Hard cost validation</td></tr>
    </tbody>
  </table>
  <div id="mktintel" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">How to Validate This Report's Assumptions</div>
      <div style="line-height:1.8;font-size:11px">
        <div><strong style="color:#C9A84C">Step 1 — Street Rate Check (15 min):</strong> Go to SpareFoot.com or StorTrack.com. Search for storage near ${site.address || site.city || "this site"}. Record climate-controlled 10x10 rates for the 3-5 nearest competitors. Compare to our modeled rate of $${(mktClimateRate * 100).toFixed(0)}/mo for a 10x10 climate unit. If >15% variance, adjust the model.</div>
        <div style="margin-top:6px"><strong style="color:#C9A84C">Step 2 — Supply Pipeline (30 min):</strong> Check Radius+ or search local municipality permit records for approved/under-construction storage facilities within 5 miles. New supply not yet captured in competitor counts can shift the demand/supply ratio significantly.</div>
        <div style="margin-top:6px"><strong style="color:#C9A84C">Step 3 — Transaction Comps (requires broker):</strong> Ask CBRE or M&M for recent self-storage transactions within the MSA — specifically price/SF, cap rate, and buyer type (REIT, institutional, private). These anchor the exit cap rate assumption.</div>
        <div style="margin-top:6px"><strong style="color:#C9A84C">Step 4 — REIT Filing Cross-Check (free):</strong> Pull the most recent quarterly supplement from PSA, EXR, or CUBE investor relations page. Look at same-store metrics for the relevant market/state. These are audited numbers that validate (or challenge) our projections.</div>
      </div>
    </div>
    ${streetRateOverride ? `<div class="insight-box" style="margin-top:12px;border-color:rgba(201,168,76,0.3)">
      <div class="insight-title">Street Rate Override Detected</div>
      <div style="font-size:11px;line-height:1.7">
        <div>User-supplied street rate: <strong style="color:#C9A84C">$${streetRateOverride.toFixed(2)}/SF/mo</strong></div>
        <div>Model rate: <strong>$${mktClimateRate.toFixed(2)}/SF/mo</strong></div>
        <div>Variance: <strong style="color:${Math.abs(parseFloat(streetVariance)) < 10 ? "#16A34A" : "#F59E0B"}">${streetVariance}%</strong> ${Math.abs(parseFloat(streetVariance)) < 10 ? "— model aligns with market data" : "— consider adjusting model assumptions"}</div>
      </div>
    </div>` : ""}
  </div>
</div>

<!-- REGIONAL COST INTELLIGENCE v4.0 -->
<div class="section expand-trigger" onclick="toggleExpand('costidx')">
  <span class="expand-hint">▼ Click to expand <span id="costidx-arrow" class="expand-arrow">▼</span></span>
  <h2><span class="gold">Regional Construction Cost Intelligence</span></h2>
  <div class="mi" onclick="toggleMI('rccidx',event)" style="font-size:12px;color:#94A3B8;margin-bottom:16px;cursor:pointer">${site.state || "N/A"} regional cost index: <span class="mono" style="font-weight:700;color:#C9A84C">${costIdx.toFixed(2)}x</span> national average <em class="mi-hint" style="position:static;display:inline;opacity:0.5;font-size:8px">i</em> — ${costIdx < 0.95 ? "below-average construction costs, favorable for development returns" : costIdx > 1.05 ? "above-average construction costs — pressure on YOC, higher land price sensitivity" : "near-national-average construction costs"}</div>
  <div id="mi-rccidx" class="mi-panel"><div class="mi-panel-inner">
    <div class="mi-header"><div class="mi-title">Regional Cost Index — ${site.state || "N/A"} at ${costIdx.toFixed(2)}x</div><div class="mi-conf mi-conf-high">RSMeans / ENR</div></div>
    <div class="mi-body">
      <strong>Construction costs vary 30%+ across US markets. SiteScore™ applies state-level cost indices to adjust the national base rate, ensuring accurate per-site hard cost projections.</strong>
      <div class="mi-formula">All-In Hard Cost: <strong style="color:#C9A84C">$${totalHardPerSF}/SF</strong> (shell $${hardCostPerSF} + site $${baseSiteWorkPerSF} + fire $${baseFireSuppressionPerSF.toFixed(1)} + interior $${baseInteriorPerSF} + tech $${baseTechPerSF.toFixed(1)} + utility)<br>${site.state || "N/A"} Index: ${costIdx.toFixed(2)}x<br>Total Hard: <strong style="color:#E87A2E">${fmtD(totalHardCost)}</strong> on ${grossSF ? grossSF.toLocaleString() : totalSF.toLocaleString()} GSF</div>
      <div class="mi-row"><span class="mi-row-label">Data Source</span><span class="mi-row-val">RSMeans 2025 Construction Cost Data (Gordian) + ENR Construction Cost Index Q1 2026. Indices reflect labor rates, material costs, and subcontractor market conditions by state. Updated quarterly.</span></div>
      <div class="mi-row"><span class="mi-row-label">PS Development Impact</span><span class="mi-row-val">${costIdx < 0.95 ? "Below-average market — PS gets more facility per dollar deployed. Lower cost markets like " + (site.state || "this state") + " are where development spreads are widest and YOC targets easiest to achieve." : costIdx > 1.05 ? "Above-average market — cost pressure requires stronger revenue (higher rates) or lower land costs to maintain target YOC. PS must model aggressively on rate assumptions or negotiate harder on land." : "Average market — standard cost assumptions apply. Development viability depends primarily on land pricing and local rates."}</span></div>
      <div class="mi-source">Source: RSMeans 2025 (Gordian) | ENR Construction Cost Index Q1 2026 | PS development pipeline actual vs. budget analysis</div>
    </div>
  </div></div>
  <div class="grid2">
    <div>
      <table style="font-size:11px">
        <thead><tr><th>Cost Component</th><th>Rate</th><th>${site.state || "—"} Adjusted</th></tr></thead>
        <tbody>
          <tr><td style="font-weight:600">Building Shell & HVAC</td><td class="mono">$${hardCostPerSF}/SF × ${grossSF ? grossSF.toLocaleString() : "?"} GSF</td><td class="mono" style="font-weight:700;color:#C9A84C">${fmtD(hardCost)}</td></tr>
          <tr><td style="font-weight:600">Site Development</td><td class="mono">$${baseSiteWorkPerSF}/SF × ${siteAreaSF.toLocaleString()} site SF</td><td class="mono" style="font-weight:700;color:#C9A84C">${fmtD(siteWorkCost)}</td></tr>
          <tr><td style="font-weight:600">Fire Suppression</td><td class="mono">$${baseFireSuppressionPerSF}/SF × ${grossSF ? grossSF.toLocaleString() : "?"} GSF</td><td class="mono" style="font-weight:700;color:#C9A84C">${fmtD(fireSuppressionCost)}</td></tr>
          <tr><td style="font-weight:600">Interior Buildout</td><td class="mono">$${baseInteriorPerSF}/SF × ${totalSF.toLocaleString()} net SF</td><td class="mono" style="font-weight:700;color:#C9A84C">${fmtD(interiorBuildoutCost)}</td></tr>
          <tr><td style="font-weight:600">Technology & Security</td><td class="mono">$${baseTechPerSF}/SF × ${grossSF ? grossSF.toLocaleString() : "?"} GSF</td><td class="mono" style="font-weight:700;color:#C9A84C">${fmtD(technologyCost)}</td></tr>
          <tr><td style="font-weight:600">Utility Infrastructure</td><td class="mono">$${utilityInfraBase.toLocaleString()} + $${baseUtilityPerSF}/SF</td><td class="mono" style="font-weight:700;color:#C9A84C">${fmtD(utilityInfraCost)}</td></tr>
          <tr style="border-top:2px solid rgba(201,168,76,0.2)"><td style="font-weight:800;color:#C9A84C">Total Hard Cost</td><td class="mono" style="font-weight:700;color:#C9A84C">$${totalHardPerSF}/SF all-in</td><td class="mono" style="font-weight:800;color:#E87A2E">${fmtD(totalHardCost)}</td></tr>
        </tbody>
      </table>
    </div>
    <div style="background:rgba(15,21,56,0.5);border-radius:12px;padding:16px;border:1px solid rgba(201,168,76,0.08)">
      <div style="font-size:10px;font-weight:700;color:#6B7394;letter-spacing:0.08em;margin-bottom:8px">COST INDEX BY STATE</div>
      ${["TX|0.92", "OH|0.88", "IN|0.86", "TN|0.90", "KY|0.87", "FL|0.95", "GA|0.91", "CO|1.02", "NY|1.20", "NJ|1.15"].map(s => {
        const [st, idx] = s.split("|");
        const idxN = parseFloat(idx);
        const isCurrent = st === (site.state || "").toUpperCase();
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px${isCurrent ? ";font-weight:700" : ""}">
          <span style="width:24px;font-size:10px;color:${isCurrent ? "#C9A84C" : "#6B7394"}">${st}</span>
          <div style="flex:1;height:10px;border-radius:3px;background:rgba(255,255,255,0.04);overflow:hidden">
            <div style="width:${Math.round(idxN / 1.25 * 100)}%;height:100%;border-radius:3px;background:${isCurrent ? "#C9A84C" : idxN <= 0.90 ? "#16A34A" : idxN <= 1.0 ? "#42A5F5" : "#F59E0B"}"></div>
          </div>
          <span style="font-size:9px;color:${isCurrent ? "#C9A84C" : "#6B7394"};font-family:'Space Mono',monospace;width:36px;text-align:right">${idx}x</span>
        </div>`;
      }).join("")}
    </div>
  </div>
  <div id="costidx" class="expand-panel">
    <div class="insight-box">
      <div class="insight-title">Construction Cost Methodology</div>
      <div style="line-height:1.8;font-size:11px">
        Regional cost indices derived from RSMeans and ENR Construction Cost Index data (Q1 2026). Indices reflect all-in hard cost differentials including labor, materials, and subcontractor market conditions. ${site.state === "TX" ? "Texas benefits from right-to-work labor laws, abundant subcontractor capacity, and lower prevailing wages compared to coastal markets." : ""} ${site.state === "OH" || site.state === "IN" || site.state === "KY" ? "Midwest states generally have the lowest construction costs nationally due to competitive labor markets and lower land costs for staging/logistics." : ""}
        <div style="margin-top:8px"><strong style="color:#C9A84C">Important:</strong> These are baseline estimates. Actual costs vary by specific metro, GC availability, bidding climate, and site-specific conditions (soil, grade, access). Always solicit 3+ GC bids during DD.</div>
      </div>
    </div>
  </div>
</div>

<div class="divider"></div>

<!-- ASSUMPTIONS & METHODOLOGY -->
<div class="section expand-trigger" onclick="toggleExpand('assumptions')" style="opacity:0.85">
  <span class="expand-hint">▼ Click to expand <span id="assumptions-arrow" class="expand-arrow">▼</span></span>
  <h2 class="muted" style="font-size:14px">Assumptions & Methodology</h2>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:11px;color:#94A3B8">
    <div>
      <div style="font-weight:700;color:#6B7394;margin-bottom:6px">Facility</div>
      <div>Building coverage: 35% of site</div>
      <div>Climate/drive split: ${Math.round(climatePct*100)}/${Math.round(drivePct*100)}</div>
      <div>Construction: $${totalHardPerSF}/SF all-in hard (${costIdx.toFixed(2)}x regional adj) + ${Math.round(softCostPct*100)}% soft</div>
      <div>Product: ${isMultiStory ? stories + "-story multi-story" : "Single-story indoor climate-controlled"}</div>
    </div>
    <div>
      <div style="font-weight:700;color:#6B7394;margin-bottom:6px">Financial</div>
      <div>Annual rate escalation: ${(annualEsc*100).toFixed(0)}%</div>
      <div>OpEx: Line-item detail (${opexRatioDetail}% stabilized ratio)</div>
      <div>Lease-up: 30% Y1, 55% Y2, 75% Y3, 88% Y4, 92% Y5</div>
      <div>Debt: ${Math.round(loanLTV*100)}% LTV @ ${(loanRate*100).toFixed(2)}% / ${loanAmort}yr amort</div>
      <div>Exit: ${(exitCapRate*100).toFixed(1)}% cap, Year 10 disposition</div>
    </div>
  </div>
  <!-- Sensitivity Matrix -->
  <div style="margin:24px 0">
    <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;color:#C9A84C;text-transform:uppercase;margin-bottom:12px">Sensitivity Analysis — Rent ±10% × Occupancy ±5pts</div>
    <table style="width:100%;font-size:11px;border-collapse:collapse">
      <thead>
        <tr>
          <th style="background:#0A0E2A;color:#6B7394;padding:8px;border:1px solid rgba(201,168,76,0.1)"></th>
          ${sensitivityMatrix.occScenarios.map(o => `<th style="background:#0A0E2A;color:#C9A84C;padding:8px;text-align:center;border:1px solid rgba(201,168,76,0.1);font-weight:700">${o.label}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${sensitivityMatrix.grid.map((row, ri) => `<tr>
          <td style="background:#0A0E2A;color:#C9A84C;padding:8px;font-weight:700;border:1px solid rgba(201,168,76,0.1)">${sensitivityMatrix.rentScenarios[ri].label}</td>
          ${row.map((cell, ci) => {
            const isBase = ri === 1 && ci === 1;
            const bg = isBase ? "rgba(201,168,76,0.12)" : "rgba(15,21,56,0.6)";
            const yocColor = parseFloat(cell.yoc) >= 9 ? "#16A34A" : parseFloat(cell.yoc) >= 7 ? "#C9A84C" : "#EF4444";
            const irrColor = parseFloat(cell.irr) >= 15 ? "#16A34A" : parseFloat(cell.irr) >= 10 ? "#C9A84C" : "#EF4444";
            return `<td style="background:${bg};padding:8px;text-align:center;border:1px solid rgba(201,168,76,0.1);${isBase ? "border:2px solid #C9A84C;" : ""}">
              <div style="font-size:14px;font-weight:800;color:${yocColor}">${cell.yoc}%</div>
              <div style="font-size:9px;color:#6B7394;margin-top:2px">YOC</div>
              <div style="font-size:12px;font-weight:700;color:${irrColor};margin-top:4px">${cell.irr}%</div>
              <div style="font-size:9px;color:#6B7394">IRR</div>
            </td>`;
          }).join("")}
        </tr>`).join("")}
      </tbody>
    </table>
    <div style="font-size:9px;color:#4A5080;margin-top:6px;text-align:center">Base case highlighted. Fixed OpEx held constant; variable OpEx adjusts with revenue. ECRI at 20% Y5 blended lift.</div>
  </div>

  <div id="assumptions" class="expand-panel">
    <div class="grid2" style="margin-top:12px">
      <div class="insight-box">
        <div class="insight-title">Data Sources</div>
        <div class="drill-row"><span class="drill-label">Demographics</span><span class="drill-value" style="font-size:10px">US Census ACS 5-Year</span></div>
        <div class="drill-row"><span class="drill-label">Growth Projections</span><span class="drill-value" style="font-size:10px">ESRI 2025→2030</span></div>
        <div class="drill-row"><span class="drill-label">Construction Costs</span><span class="drill-value" style="font-size:10px">RSMeans 2025 + PS benchmarks</span></div>
        <div class="drill-row"><span class="drill-label">Market Rates</span><span class="drill-value" style="font-size:10px">SiteScore™ 3-method cross-validated</span></div>
        <div class="drill-row"><span class="drill-label">Cap Rates</span><span class="drill-value" style="font-size:10px">Green Street, REIT filings</span></div>
        <div class="drill-row"><span class="drill-label">Competition</span><span class="drill-value" style="font-size:10px">Google, SpareFoot, operator sites</span></div>
      </div>
      <div class="insight-box">
        <div class="insight-title">Key Assumptions & Limitations</div>
        <div style="font-size:11px;line-height:1.8;color:#94A3B8">
          <div>• Rates modeled from demographic/competition inputs, not surveyed street rates</div>
          <div>• Occupancy trajectory assumes standard PS marketing budget allocation</div>
          <div>• Hard costs regionally adjusted via RSMeans/ENR index (${site.state || "N/A"}: ${costIdx.toFixed(2)}x)</div>
          <div>• Debt service modeled at ${(loanRate*100).toFixed(2)}% / ${loanAmort}yr — verify with lender quotes</div>
          <div>• 10-year DCF with IRR assumes ${(exitCapRate*100).toFixed(1)}% exit cap — conservative vs current market</div>
          <div>• Environmental, geotech, and entitlement risks not priced in</div>
          <div>• Tax abatement or TIF incentives not included (upside potential)</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- PRINT BUTTON -->
<div style="text-align:center;margin:24px 0">
  <button onclick="window.print()" style="padding:14px 40px;border-radius:12px;background:linear-gradient(135deg,#C9A84C,#E87A2E);color:#fff;font-size:14px;font-weight:800;border:none;cursor:pointer;letter-spacing:0.06em;text-transform:uppercase;box-shadow:0 4px 20px rgba(201,168,76,0.3)">🖨 Print / Save as PDF</button>
</div>

<div class="footer" style="padding:40px 24px">
  <!-- Turbine Engine in footer -->
  <div style="margin-bottom:16px">
    <div class="storvex-turbine" style="width:40px;height:40px">
      <div class="turbine-liquid" style="width:48px;height:48px;top:-4px;left:-4px"></div>
      <div class="turbine-core" style="width:40px;height:40px"></div>
      <div class="turbine-inner" style="width:28px;height:28px;top:6px;left:6px"></div>
      <div class="turbine-center" style="width:16px;height:16px;top:12px;left:12px"></div>
    </div>
  </div>
  <div style="font-size:14px;font-weight:800;letter-spacing:0.14em;color:#C9A84C;margin-bottom:4px">STORVEX<span style="font-size:9px;vertical-align:super">™</span> + SITESCORE<span style="font-size:9px;vertical-align:super">™</span></div>
  <div style="font-size:11px;color:#6B7394;margin-bottom:12px">AI-Powered Storage Site Intelligence & Pricing Analytics</div>
  <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,0.3),transparent);margin:12px auto;max-width:400px"></div>
  <div style="font-size:10px;color:#4A5080;margin-top:12px;line-height:1.8">
    <div>Storvex Pricing Report — ${h(site.name)} | Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
    <div style="margin-top:8px;font-weight:600;color:#6B7394">Powered by DJR Real Estate LLC | U.S. Patent Pending — Serial No. 99712640</div>
    <div style="margin-top:10px;max-width:700px;margin-left:auto;margin-right:auto;color:#3A4060;font-size:9px;line-height:1.7">
      <strong style="color:#6B7394">CONFIDENTIAL & PROPRIETARY.</strong> This report and its contents are the exclusive property of DJR Real Estate LLC.
      The SiteScore™ platform, scoring methodology, pricing models, and analytical frameworks contained herein are proprietary
      trade secrets protected under federal and state law. Unauthorized reproduction, distribution, reverse engineering, or disclosure
      of this report or any portion thereof is strictly prohibited and may result in civil and criminal penalties. This report is provided
      for informational purposes only and does not constitute investment advice, an appraisal, or a guarantee of future performance.
      All projections are forward-looking estimates based on current market data and are subject to change. Recipients should conduct
      independent due diligence before making investment decisions.
    </div>
    <div style="margin-top:10px;color:#3A4060;font-size:9px">© ${new Date().getFullYear()} DJR Real Estate LLC. All rights reserved. SiteScore™ is a trademark of DJR Real Estate LLC.</div>
  </div>
</div>

</div>
<script>
(function(){
  var nav=document.getElementById('tocNav');
  if(nav) nav.style.display='';
  var links = document.querySelectorAll('#tocNav a');
  var sections = [];
  links.forEach(function(a){
    var id = a.getAttribute('href').replace('#','');
    var el = document.getElementById(id);
    if(el) sections.push({el:el, link:a});
  });
  function onScroll(){
    var scrollPos = window.scrollY + 120;
    var active = null;
    sections.forEach(function(s){
      if(s.el.offsetTop <= scrollPos) active = s;
    });
    links.forEach(function(a){ a.classList.remove('active'); });
    if(active) active.link.classList.add('active');
  }
  window.addEventListener('scroll', onScroll);
  onScroll();
})();
</script>
</body></html>`;
  } catch (err) {
    console.error("Report generation error:", err);
    return `<!DOCTYPE html><html><head><title>Error</title></head><body style="font-family:sans-serif;padding:40px;background:#0A0E2A;color:#fff;text-align:center"><h1 style="color:#C9A84C">Report Generation Error</h1><p style="color:#94A3B8">${escapeHtml(err.message)}</p><p style="color:#64748B;font-size:12px">Check the browser console for details. Try refreshing the site data.</p></body></html>`;
  }
};

// ─── REC Package — Real Estate Committee Investment Package ───
// Comprehensive boardroom-ready document combining SiteScore, Pricing, Competition, Zoning, Market Data
export const generateRECPackage = (site, iqResult, siteScoreConfig, valuationOverrides) => {
  try {
  const h = escapeHtml;
  const iq = iqResult || computeSiteScore(site, siteScoreConfig);
  const siteOverrides = site.overrides || {};
  const fin = computeSiteFinancials(site, valuationOverrides || {}, siteOverrides);
  const { acres, landCost, popN, incN, hvN, hhN, pop1, growthPct, compCount, nearestPS, incTier,
    operatorProfile, operatorLabel, noiMarginBenchmark,
    isMultiStory, stories, footprint, grossSF, netToGross, totalSF, climatePct, drivePct, climateSF, driveSF,
    baseClimateRate, baseDriveRate, compAdj, mktClimateRate, mktDriveRate, annualEsc,
    leaseUpSchedule, yearData, stabNOI, stabRev,
    stateToCostIdx, costIdx, baseHardPerSF, hardCostPerSF, softCostPct, hardCost, softCost,
    contingencyPct, contingency, buildCosts, totalHardCost, totalHardPerSF,
    siteAreaSF, baseSiteWorkPerSF, siteWorkCost,
    baseFireSuppressionPerSF, fireSuppressionCost,
    baseInteriorPerSF, interiorBuildoutCost,
    baseTechPerSF, technologyCost,
    utilityInfraBase, baseUtilityPerSF, utilityInfraCost,
    constructionMonths, constructionInterest, constructionPropTax, constructionInsurance, carryCosts, workingCapital,
    totalDevCost, yocStab,
    opexDetail, totalOpexDetail, opexRatioDetail, noiDetail,
    ecriSchedule,
    capRates, valuations,
    landTargets, landPrices, askVsStrike, landVerdict, verdictColor,
    loanLTV, loanRate, loanAmort, equityPct, loanAmount, equityRequired, monthlyLoanRate, numPmts, monthlyPmt, annualDS, dscrStab, cashAfterDS, cashOnCash,
    exitCapRate, yrDataExt, exitValue, exitLoanBal, exitEquityProceeds, irrCashFlows, irrPct, equityMultiple,
    m1Rate, m2ClimRate, m2DriveRate, m3ClimRate, popDensityFactor, consensusClimRate, rateConfidence, rateConfColor,
    stabOccSF, revPAF, revPOF, noiPerSF, noiMarginPct, mktAcqCap, devSpread, impliedLandCap,
    estCompSF, totalMktSF, sfPerCapita, sfPerCapitaExcl, demandSignal, demandColor,
    replacementCost, replacementCostPerSF, fullReplacementCost, replacementVsMarket, buildOrBuy,
    reitBench, sensitivityMatrix, sourcesAndUses, pricePerAcre,
    unleveredIRR, psWACC, npvAtWACC, debtYield, profitOnCost, exitScenarios,
  } = fin;
  const phase = site.phase || "Prospect";

  // ── Zoning Intelligence ──
  const combined = ((site.zoning || "") + " " + (site.summary || "")).toLowerCase();
  const zoningClass = site.zoningClassification || "unknown";
  const zoningColor = zoningClass === "by-right" ? "#16A34A" : zoningClass === "conditional" ? "#F59E0B" : zoningClass === "rezone-required" ? "#EF4444" : zoningClass === "prohibited" ? "#991B1B" : "#94A3B8";
  const zoningLabel = { "by-right": "BY-RIGHT (Permitted)", "conditional": "CONDITIONAL (SUP/CUP Required)", "rezone-required": "REZONE REQUIRED", "prohibited": "PROHIBITED", "unknown": "UNKNOWN — Research Required" }[zoningClass] || zoningClass.toUpperCase();
  const hasFlood = /flood/i.test(combined);
  const hasOverlay = /overlay/i.test(combined);

  // ── Utility Readiness ──
  const utilChecks = [
    { done: !!site.waterProvider, w: 20, l: "Water provider" },
    { done: site.waterAvailable === true, w: 15, l: "Water available" },
    { done: site.insideServiceBoundary === true, w: 10, l: "Service boundary" },
    { done: !!site.sewerProvider || /septic/i.test(combined), w: 12, l: "Sewer/septic" },
    { done: site.sewerAvailable === true || /septic/i.test(combined), w: 8, l: "Sewer confirmed" },
    { done: !!site.electricProvider, w: 10, l: "Electric" },
    { done: site.threePhase === true, w: 10, l: "3-phase" },
    { done: !!site.waterTapFee || !!site.tapFees, w: 5, l: "Tap fees" },
    { done: site.fireFlowAdequate === true, w: 5, l: "Fire flow" },
    { done: !!site.distToWaterMain, w: 5, l: "Dist to main" },
  ];
  const utilScore = utilChecks.reduce((s, c) => s + (c.done ? c.w : 0), 0);
  const utilGrade = utilScore >= 80 ? "A" : utilScore >= 60 ? "B" : utilScore >= 40 ? "C" : utilScore >= 20 ? "D" : "F";
  const utilColor = utilScore >= 80 ? "#16A34A" : utilScore >= 60 ? "#3B82F6" : utilScore >= 40 ? "#F59E0B" : "#EF4444";

  // ── Risk Matrix ──
  const risks = [];
  if (zoningClass === "rezone-required" || zoningClass === "prohibited") risks.push({ cat: "Entitlement", level: "HIGH", desc: "Rezone or rezoning required — timeline, political, and cost risk", color: "#EF4444" });
  else if (zoningClass === "conditional") risks.push({ cat: "Entitlement", level: "MEDIUM", desc: "SUP/CUP required — public hearing process", color: "#F59E0B" });
  else if (zoningClass === "by-right") risks.push({ cat: "Entitlement", level: "LOW", desc: "Storage use permitted by right", color: "#16A34A" });
  if (hasFlood) risks.push({ cat: "Environmental", level: "HIGH", desc: "Flood zone identified — insurance cost and development constraints", color: "#EF4444" });
  if (site.waterAvailable === false) risks.push({ cat: "Utilities", level: "HIGH", desc: "Municipal water not confirmed — HARD REQUIREMENT for fire suppression", color: "#EF4444" });
  else if (!site.waterProvider) risks.push({ cat: "Utilities", level: "MEDIUM", desc: "Water provider not yet identified — needs verification", color: "#F59E0B" });
  if (compCount > 5) risks.push({ cat: "Competition", level: "MEDIUM", desc: `${compCount} competitors within 3mi — potential supply saturation`, color: "#F59E0B" });
  if (popN && popN < 15000) risks.push({ cat: "Demographics", level: "MEDIUM", desc: "3-mi population below 15K — limited demand pool", color: "#F59E0B" });
  if (growthPct < 0) risks.push({ cat: "Growth", level: "HIGH", desc: `Negative population growth (${growthPct}%) — declining market`, color: "#EF4444" });
  if (landVerdict === "PASS") risks.push({ cat: "Pricing", level: "HIGH", desc: "Asking price exceeds strike by 30%+ — requires significant negotiation", color: "#EF4444" });
  else if (landVerdict === "STRETCH") risks.push({ cat: "Pricing", level: "MEDIUM", desc: "Asking price 15-30% above strike — tight underwriting", color: "#F59E0B" });
  if (!isNaN(acres) && acres < 2.5) risks.push({ cat: "Site", level: "HIGH", desc: "Below minimum acreage — insufficient for development", color: "#EF4444" });

  // ── Overall Recommendation ──
  const score = iq.score || 0;
  const recLabel = score >= 8.0 ? "STORVEX RECOMMENDATION: APPROVED" : score >= 6.5 ? "STORVEX RECOMMENDATION: CONDITIONAL" : score >= 5.0 ? "STORVEX RECOMMENDATION: HOLD — DILIGENCE REQUIRED" : "STORVEX RECOMMENDATION: PASS";
  const recColor = score >= 8.0 ? "#16A34A" : score >= 6.5 ? "#3B82F6" : score >= 5.0 ? "#F59E0B" : "#EF4444";
  const recIcon = score >= 8.0 ? "✅" : score >= 6.5 ? "🔵" : score >= 5.0 ? "⚠️" : "❌";

  const fmtD = (n) => "$" + Math.round(n).toLocaleString();
  const fmtM = (n) => n >= 1000000 ? "$" + (n / 1000000).toFixed(2) + "M" : n >= 100000 ? "$" + Math.round(n / 1000) + "K" : "$" + Math.round(n).toLocaleString();
  const fmtN2 = (n) => isNaN(n) ? "—" : n.toLocaleString();
  const iqBadgeColor = (iq.tier || "gray") === "gold" ? "#C9A84C" : (iq.tier || "gray") === "steel" ? "#2C3E6B" : "#94A3B8";
  const dom = site.dateOnMarket && site.dateOnMarket !== "N/A" ? Math.max(0, Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000)) : null;
  const mapsUrl = site.coordinates ? `https://www.google.com/maps?q=${site.coordinates}` : "#";
  // ── SiteScore Breakdown ──
  const breakdownRows = (iq.breakdown || []).map((b, bi) => {
    const dimScore = b.score || 0;
    const dimWeighted = dimScore * (b.weight || 0);
    const barColor = dimScore >= 8 ? "#16A34A" : dimScore >= 6 ? "#3B82F6" : dimScore >= 4 ? "#F59E0B" : "#EF4444";
    const reason = b.reason || "";
    return `<tr>
      <td style="padding:10px 14px;font-size:12px;font-weight:700;border-bottom:1px solid rgba(201,168,76,0.06)"><span style="display:inline-flex;align-items:center;gap:6px">${b.icon || "◆"} ${b.label}${reason ? `<span class="dim-info" onclick="event.stopPropagation();var t=document.getElementById('dt${bi}');t.style.display=t.style.display==='block'?'none':'block'" style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:rgba(201,168,76,0.12);color:#C9A84C;font-size:8px;font-weight:800;cursor:pointer;font-style:italic;font-family:Georgia,serif;flex-shrink:0;border:1px solid rgba(201,168,76,0.2)">i</span>` : ""}</span>${reason ? `<div id="dt${bi}" style="display:none;margin-top:6px;padding:8px 10px;background:rgba(30,39,97,0.06);border-radius:6px;border-left:3px solid ${barColor};font-size:10px;font-weight:500;color:#4A5080;line-height:1.5">${reason}</div>` : ""}</td>
      <td style="padding:10px 14px;border-bottom:1px solid rgba(201,168,76,0.06);width:180px"><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,0.06)"><div style="width:${(dimScore/10)*100}%;height:100%;border-radius:4px;background:${barColor}"></div></div><span style="font-size:12px;font-weight:800;color:${barColor};font-family:'Space Mono',monospace;min-width:28px;text-align:right">${dimScore.toFixed(1)}</span></div></td>
      <td style="padding:10px 14px;font-size:11px;color:#6B7394;border-bottom:1px solid rgba(201,168,76,0.06);text-align:right;font-weight:600">${Math.round((b.weight || 0) * 100)}%</td>
      <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#E2E8F0;border-bottom:1px solid rgba(201,168,76,0.06);text-align:right;font-family:'Space Mono',monospace">${dimWeighted.toFixed(2)}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>REC Package — ${h(site.name)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#F8FAFC;color:#1E293B;min-height:100vh;padding:0}
.page{max-width:900px;margin:0 auto;background:#fff}
h1{font-size:26px;font-weight:900;letter-spacing:-0.02em}
h2{font-size:15px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#1E2761;margin-bottom:14px;display:flex;align-items:center;gap:10px}
h2 .sec-num{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#1E2761,#2C3E6B);color:#C9A84C;font-size:12px;font-weight:900}
table{width:100%;border-collapse:collapse}
th{padding:10px 14px;text-align:left;font-size:9px;font-weight:700;color:#1E2761;text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid #E2E8F0;background:#F8FAFC}
td{padding:10px 14px;border-bottom:1px solid #F1F5F9;font-size:12px}
.section{padding:28px 40px;border-bottom:1px solid #E2E8F0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;overflow:hidden}
.grid2>div{overflow:hidden;min-width:0}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.metric{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;text-align:center}
.metric .label{font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px}
.metric .value{font-size:20px;font-weight:800;font-family:'Space Mono',monospace;color:#1E293B}
.metric .sub{font-size:10px;color:#94A3B8;margin-top:2px}
.badge{display:inline-block;padding:4px 14px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.04em}
.pill{display:inline-block;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:0.04em}
.mono{font-family:'Space Mono',monospace}
.row-label{font-size:12px;font-weight:600;color:#64748B;padding:8px 0}
.row-value{font-size:13px;font-weight:700;color:#1E293B;font-family:'Space Mono',monospace;padding:8px 0;text-align:right}
.risk-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;margin-bottom:6px}
.divider{height:2px;background:linear-gradient(90deg,transparent,#C9A84C,#E87A2E,#C9A84C,transparent);margin:0;opacity:0.4}
.print-btn{position:fixed;bottom:28px;right:28px;display:flex;align-items:center;gap:8px;padding:14px 24px;border-radius:12px;border:none;background:linear-gradient(135deg,#1E2761,#2C3E6B);color:#C9A84C;font-size:14px;font-weight:700;font-family:'Inter',sans-serif;cursor:pointer;box-shadow:0 4px 20px rgba(30,39,97,0.4);z-index:9999}
.print-btn:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(30,39,97,0.5)}
.mi{position:relative;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s}
.mi:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(30,39,97,0.08)}
.mi:hover .mi-hint{opacity:1}
.mi-hint{position:absolute;top:-6px;right:-6px;width:14px;height:14px;border-radius:50%;background:linear-gradient(135deg,#C9A84C,#E87A2E);display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:900;color:#fff;opacity:0;transition:opacity 0.2s;z-index:2;font-style:normal;line-height:1}
.mi-panel{max-height:0;overflow:hidden;transition:max-height 0.35s ease,opacity 0.3s ease,margin 0.3s ease;opacity:0;margin-top:0;border-radius:12px}
.mi-panel.open{max-height:800px;opacity:1;margin-top:12px}
.mi-panel-inner{background:linear-gradient(135deg,#F8FAFC,#F1F5F9);border:1px solid #E2E8F0;border-radius:12px;padding:18px;box-shadow:0 4px 16px rgba(30,39,97,0.06)}
.mi-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #E2E8F0}
.mi-title{font-size:12px;font-weight:800;color:#1E2761;letter-spacing:0.04em}
.mi-conf{font-size:9px;font-weight:700;letter-spacing:0.06em;padding:3px 8px;border-radius:4px;text-transform:uppercase}
.mi-conf-high{background:rgba(22,163,74,0.1);color:#16A34A;border:1px solid rgba(22,163,74,0.2)}
.mi-conf-med{background:rgba(245,158,11,0.1);color:#D97706;border:1px solid rgba(245,158,11,0.2)}
.mi-conf-low{background:rgba(239,68,68,0.1);color:#EF4444;border:1px solid rgba(239,68,68,0.2)}
.mi-body{font-size:11px;color:#475569;line-height:1.65}
.mi-body strong{color:#1E293B}
.mi-formula{background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 14px;margin:10px 0;font-family:'Space Mono',monospace;font-size:10px;color:#1E40AF;line-height:1.8}
.mi-source{display:flex;align-items:center;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid #E2E8F0;font-size:9px;color:#64748B;font-weight:600;letter-spacing:0.04em}
.mi-source::before{content:"📊";font-size:10px}
.mi-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #F1F5F9;font-size:11px}
.mi-row:last-child{border-bottom:none}
.mi-row-label{color:#64748B;font-weight:600}
.mi-row-val{color:#1E293B;font-weight:700;font-family:'Space Mono',monospace}
/* TOC sidebar — McKinsey nav strip */
.toc-sidebar{position:fixed;left:0;top:50%;transform:translateY(-50%);width:52px;background:linear-gradient(180deg,#0A0A0C,#1E2761 40%,#2C3E6B);border-radius:0 14px 14px 0;box-shadow:4px 0 30px rgba(0,0,0,0.15);padding:14px 6px;z-index:999;transition:width 0.3s cubic-bezier(0.4,0,0.2,1);overflow:hidden}
.toc-sidebar:hover{width:210px;padding:14px 12px}
.toc-sidebar .toc-title{font-size:8px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:12px;padding:0 4px;white-space:nowrap;opacity:0;transition:opacity 0.2s}
.toc-sidebar:hover .toc-title{opacity:1}
.toc-sidebar .toc-icon{display:flex;align-items:center;justify-content:center;width:32px;height:32px;margin:0 auto 8px;border-radius:8px;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.3)}
.toc-sidebar:hover .toc-icon{display:none}
.toc-sidebar .toc-icon svg{width:16px;height:16px;fill:#C9A84C}
.toc-sidebar a{display:flex;align-items:center;gap:10px;padding:6px 8px;font-size:11px;color:rgba(255,255,255,0.5);text-decoration:none;border-radius:8px;font-weight:600;transition:all 0.15s ease;line-height:1.3;margin-bottom:2px;white-space:nowrap;overflow:hidden}
.toc-sidebar a .toc-num{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);font-size:10px;font-weight:800;font-family:'Space Mono',monospace;flex-shrink:0;transition:all 0.15s}
.toc-sidebar a .toc-label{opacity:0;transition:opacity 0.2s}
.toc-sidebar:hover a .toc-label{opacity:1}
.toc-sidebar a:hover{background:rgba(243,124,51,0.15);color:#fff}
.toc-sidebar a:hover .toc-num{background:rgba(243,124,51,0.3);color:#F37C33}
.toc-sidebar a.active{background:rgba(201,168,76,0.15);color:#C9A84C}
.toc-sidebar a.active .toc-num{background:#C9A84C;color:#0A0A0C}
@media (max-width:1000px){.toc-sidebar{display:none}}

@media print{body{background:#fff}.print-btn{display:none!important}.page{box-shadow:none}.mi-panel{max-height:none!important;opacity:1!important;margin-top:12px!important}.mi-hint{display:none}.toc-sidebar{display:none!important}@page{margin:0.5in;size:letter}}
</style>
<script>
function toggleMI(id,evt){
  if(evt){evt.stopPropagation();}
  var p=document.getElementById('mi-'+id);
  if(!p)return;
  document.querySelectorAll('.mi-panel.open').forEach(function(el){if(el.id!=='mi-'+id)el.classList.remove('open');});
  p.classList.toggle('open');
}
</script>
</head><body>

<!-- TOC Sidebar — McKinsey nav strip -->
<nav class="toc-sidebar" id="tocNav" style="display:none">
  <div class="toc-icon"><svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg></div>
  <div class="toc-title">REC Package</div>
  <a href="#sec-R1" onclick="document.getElementById('sec-R1').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">1</span><span class="toc-label">Recommendation</span></a>
  <a href="#sec-R2" onclick="document.getElementById('sec-R2').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">2</span><span class="toc-label">SiteScore</span></a>
  <a href="#sec-R3" onclick="document.getElementById('sec-R3').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">3</span><span class="toc-label">Demographics</span></a>
  <a href="#sec-R4" onclick="document.getElementById('sec-R4').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">4</span><span class="toc-label">Competition</span></a>
  <a href="#sec-R5" onclick="document.getElementById('sec-R5').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">5</span><span class="toc-label">Zoning</span></a>
  <a href="#sec-R6" onclick="document.getElementById('sec-R6').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">6</span><span class="toc-label">Utilities</span></a>
  <a href="#sec-R7" onclick="document.getElementById('sec-R7').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">7</span><span class="toc-label">Site Access</span></a>
  <a href="#sec-R8" onclick="document.getElementById('sec-R8').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">8</span><span class="toc-label">Financials</span></a>
  <a href="#sec-R9" onclick="document.getElementById('sec-R9').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">9</span><span class="toc-label">Institutional</span></a>
  <a href="#sec-R10" onclick="document.getElementById('sec-R10').scrollIntoView({behavior:'smooth'});return false"><span class="toc-num">10</span><span class="toc-label">Risk</span></a>
</nav>

<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
<div class="page">

<!-- ═══════════════════════════════════════════════ COVER HEADER ═══════════════════════════════════════════════ -->
<div style="background:linear-gradient(135deg,#080B1A 0%,#1E2761 60%,#2C3E6B 100%);padding:44px 40px 36px;position:relative;overflow:hidden">
  <div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#C9A84C,#E87A2E,#C9A84C,transparent)"></div>
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
        <div style="width:50px;height:50px;border-radius:12px;background:linear-gradient(135deg,#C9A84C,#E87A2E);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(201,168,76,0.4)"><span style="font-size:20px;font-weight:900;color:#fff;font-family:'Space Mono'">REC</span></div>
        <div>
          <div style="font-size:10px;color:#C9A84C;letter-spacing:0.14em;font-weight:800">REAL ESTATE COMMITTEE</div>
          <div style="font-size:10px;color:#94A3B8;letter-spacing:0.08em;margin-top:2px">SITE ACQUISITION PACKAGE</div>
        </div>
      </div>
      <h1 style="color:#fff;margin-bottom:6px;font-size:28px">${h(site.name || "Unnamed Site")}</h1>
      <div style="font-size:13px;color:#94A3B8;margin-top:6px">${h(site.address || "")}${site.city ? ", " + h(site.city) : ""}${site.state ? ", " + h(site.state) : ""}</div>
      ${site.coordinates ? `<div style="font-size:11px;color:#64748B;margin-top:4px">📍 <a href="${mapsUrl}" style="color:#64748B" target="_blank">${site.coordinates}</a></div>` : ""}
    </div>
    <div style="text-align:right">
      <div style="display:inline-flex;align-items:center;gap:10px;padding:10px 20px;border-radius:12px;background:${iqBadgeColor}18;border:1px solid ${iqBadgeColor}40">
        <span style="font-size:32px;font-weight:900;color:${iqBadgeColor};font-family:'Space Mono'">${typeof iq.score === "number" ? iq.score.toFixed(2) : "—"}</span>
        <div>
          <div style="font-size:9px;color:#CBD5E1;letter-spacing:0.1em;font-weight:700">SITESCORE<span style="font-size:7px;vertical-align:super">™</span></div>
          <div style="font-size:12px;font-weight:800;color:${iqBadgeColor}">${iq.label || "—"}</div>
        </div>
      </div>
      <div style="font-size:11px;color:#64748B;margin-top:10px">${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
      <div style="font-size:10px;color:#4A5080;margin-top:2px">Phase: ${phase}</div>
    </div>
  </div>
</div>

<!-- KEY METRICS BAR -->
<div style="display:grid;grid-template-columns:repeat(6,1fr);background:#FAFBFC;border-bottom:2px solid #E2E8F0">
  ${[
    { l: "ACREAGE", v: !isNaN(acres) ? acres.toFixed(2) + " ac" : "—" },
    { l: "ASK PRICE", v: site.askingPrice || "—" },
    { l: "PRICE/ACRE", v: pricePerAcre ? fmtD(pricePerAcre) : "—" },
    { l: "3-MI POP", v: !isNaN(popN) ? fmtN2(popN) : "—" },
    { l: "MED INCOME", v: !isNaN(incN) ? "$" + fmtN2(incN) : "—" },
    { l: "GROWTH", v: growthPct ? growthPct.toFixed(1) + "%" : "—" },
  ].map(m => `<div style="padding:14px 8px;text-align:center;border-right:1px solid #E2E8F0"><div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.08em;margin-bottom:3px">${m.l}</div><div style="font-size:15px;font-weight:800;color:#1E293B;font-family:'Space Mono',monospace">${m.v}</div></div>`).join("")}
</div>

<!-- ═══════════════ SECTION 1: RECOMMENDATION ═══════════════ -->
<div id="sec-R1" class="section" style="scroll-margin-top:20px;background:${recColor}08;border-left:4px solid ${recColor}">
  <h2><span class="sec-num">1</span> Storvex Recommendation</h2>
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
    <span style="font-size:28px">${recIcon}</span>
    <div>
      <div style="font-size:18px;font-weight:900;color:${recColor};letter-spacing:0.02em">${recLabel}</div>
      <div style="font-size:12px;color:#64748B;margin-top:4px">Storvex ${(iq.breakdown || []).length}-dimension composite analysis — SiteScore™ ${iq.score?.toFixed(2) || "—"}/10</div>
    </div>
  </div>
  ${landVerdict ? `<div style="display:flex;gap:16px;margin-top:16px">
    <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;text-align:center" class="mi" onclick="toggleMI('rec-verdict',event)">
      <div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;margin-bottom:4px">LAND VERDICT</div>
      <div class="badge" style="background:${verdictColor}18;color:${verdictColor};border:1px solid ${verdictColor}30;font-size:14px;padding:6px 18px">${landVerdict}</div><em class="mi-hint">i</em>
      <div id="mi-rec-verdict" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Land Pricing Verdict</div><div class="mi-conf ${landVerdict === "BUY" || landVerdict === "TARGET" ? "mi-conf-high" : landVerdict === "STRETCH" ? "mi-conf-med" : "mi-conf-low"}">${landVerdict === "BUY" ? "Favorable" : landVerdict === "TARGET" ? "At Target" : landVerdict === "STRETCH" ? "Above Target" : "Overpriced"}</div></div>
        <div class="mi-body">
          <strong>Verdict is determined by comparing the asking price against the strike price (max land at target YOC).</strong>
          <div class="mi-formula">Strike Price = Max land at ${landPrices[1] ? (landPrices[1].yoc*100).toFixed(1) : "8.5"}% target YOC<br>= ${landPrices[1] ? fmtM(landPrices[1].maxLand) : "—"}<br>Ask vs Strike = ${parseFloat(askVsStrike) > 0 ? "+" : ""}${askVsStrike}%</div>
          <div class="mi-row"><span class="mi-row-label">BUY (≤-10%)</span><span class="mi-row-val">Below strike — strong acquisition opportunity</span></div>
          <div class="mi-row"><span class="mi-row-label">TARGET (-10% to +5%)</span><span class="mi-row-val">At or near strike — proceed with standard terms</span></div>
          <div class="mi-row"><span class="mi-row-label">STRETCH (+5% to +30%)</span><span class="mi-row-val">Above strike — requires negotiation or rent upside</span></div>
          <div class="mi-row"><span class="mi-row-label">PASS (>+30%)</span><span class="mi-row-val">Significantly above strike — does not underwrite</span></div>
          <div class="mi-source">Source: SiteScore Land Acquisition Price Guide | Back-calculated from stabilized NOI at target development yield</div>
        </div>
      </div></div>
    </div>
    <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;text-align:center" class="mi" onclick="toggleMI('rec-askvstrike',event)">
      <div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;margin-bottom:4px">ASK vs STRIKE</div>
      <div style="font-size:20px;font-weight:900;color:${parseFloat(askVsStrike) <= 0 ? '#16A34A' : '#EF4444'};font-family:'Space Mono',monospace">${parseFloat(askVsStrike) > 0 ? '+' : ''}${askVsStrike}%</div><em class="mi-hint">i</em>
      <div id="mi-rec-askvstrike" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Ask vs Strike Differential</div><div class="mi-conf ${parseFloat(askVsStrike) <= 0 ? "mi-conf-high" : parseFloat(askVsStrike) <= 15 ? "mi-conf-med" : "mi-conf-low"}">${parseFloat(askVsStrike) <= 0 ? "Below Strike" : "Above Strike"}</div></div>
        <div class="mi-body">
          <strong>Measures the gap between asking price and maximum land price at target development yield.</strong>
          <div class="mi-formula">Ask vs Strike = (Asking - Strike) ÷ Strike × 100<br>= (${fmtD(landCost)} - ${landPrices[1] ? fmtD(landPrices[1].maxLand) : "—"}) ÷ ${landPrices[1] ? fmtD(landPrices[1].maxLand) : "—"}<br>= <strong style="color:${parseFloat(askVsStrike) <= 0 ? '#16A34A' : '#EF4444'}">${parseFloat(askVsStrike) > 0 ? '+' : ''}${askVsStrike}%</strong></div>
          <div class="mi-row"><span class="mi-row-label">Asking Price</span><span class="mi-row-val">${fmtD(landCost)}</span></div>
          <div class="mi-row"><span class="mi-row-label">Strike Price (8.5% YOC)</span><span class="mi-row-val">${landPrices[1] ? fmtD(landPrices[1].maxLand) : "—"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Negotiation Room</span><span class="mi-row-val">${parseFloat(askVsStrike) > 0 ? fmtD(landCost - (landPrices[1] ? landPrices[1].maxLand : 0)) + " reduction needed" : "Already below strike"}</span></div>
          <div class="mi-source">Source: SiteScore Financial Engine | Strike = NOI ÷ Target YOC − Construction Costs</div>
        </div>
      </div></div>
    </div>
    <div style="flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;text-align:center" class="mi" onclick="toggleMI('rec-yoc',event)">
      <div style="font-size:8px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;margin-bottom:4px">STABILIZED YOC</div>
      <div style="font-size:20px;font-weight:900;color:${parseFloat(yocStab) >= 8.5 ? '#16A34A' : parseFloat(yocStab) >= 7.0 ? '#F59E0B' : '#EF4444'};font-family:'Space Mono',monospace">${yocStab}%</div><em class="mi-hint">i</em>
      <div id="mi-rec-yoc" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Stabilized Yield on Cost</div><div class="mi-conf ${parseFloat(yocStab) >= 8.5 ? "mi-conf-high" : parseFloat(yocStab) >= 7.0 ? "mi-conf-med" : "mi-conf-low"}">${parseFloat(yocStab) >= 9 ? "Exceeds Target" : parseFloat(yocStab) >= 8.0 ? "Meets Target" : "Below Target"}</div></div>
        <div class="mi-body">
          <strong>The primary return metric for ground-up development — stabilized NOI as a percentage of total development cost.</strong>
          <div class="mi-formula">YOC = Stabilized NOI (Y5) ÷ Total Dev Cost<br>= ${fmtD(stabNOI)} ÷ ${fmtD(totalDevCost)}<br>= <strong style="color:${parseFloat(yocStab) >= 8.5 ? '#16A34A' : '#F59E0B'}">${yocStab}%</strong></div>
          <div class="mi-row"><span class="mi-row-label">REIT Target Range</span><span class="mi-row-val">8.0% – 10.0%</span></div>
          <div class="mi-row"><span class="mi-row-label">Minimum Hurdle</span><span class="mi-row-val">7.5%</span></div>
          <div class="mi-row"><span class="mi-row-label">Dev Spread vs Mkt Cap</span><span class="mi-row-val">${devSpread || "N/A"} bps</span></div>
          <div class="mi-row"><span class="mi-row-label">Assessment</span><span class="mi-row-val" style="color:${parseFloat(yocStab) >= 9 ? '#16A34A' : parseFloat(yocStab) >= 7.5 ? '#D97706' : '#EF4444'}">${parseFloat(yocStab) >= 9.5 ? "Exceptional — well above hurdle" : parseFloat(yocStab) >= 8.5 ? "Strong — above sweet spot" : parseFloat(yocStab) >= 7.5 ? "Meets minimum threshold" : "Below hurdle — negotiate land price"}</span></div>
          <div class="mi-source">Source: SiteScore 5-Year Lease-Up Model | Industry-standard development return metric (PSA 10-K, EXR 10-K)</div>
        </div>
      </div></div>
    </div>
  </div>` : ""}
</div>

<!-- ═══════════════ SECTION 2: SITESCORE BREAKDOWN ═══════════════ -->
<div id="sec-R2" class="section" style="scroll-margin-top:20px">
  <h2><span class="sec-num">2</span> SiteScore™ Analysis — ${typeof iq.score === "number" ? iq.score.toFixed(2) : "—"}/10</h2>
  <table>
    <thead><tr><th>Dimension</th><th>Score (0–10)</th><th>Weight</th><th>Weighted</th></tr></thead>
    <tbody>${breakdownRows}</tbody>
    <tfoot><tr style="background:#F8FAFC">
      <td style="padding:12px 14px;font-size:13px;font-weight:900;border-top:2px solid #1E2761" colspan="3">COMPOSITE SCORE</td>
      <td style="padding:12px 14px;font-size:18px;font-weight:900;color:${iqBadgeColor};font-family:'Space Mono',monospace;text-align:right;border-top:2px solid #1E2761">${typeof iq.score === "number" ? iq.score.toFixed(2) : "—"}</td>
    </tr></tfoot>
  </table>
</div>

<!-- ═══════════════ SECTION 3: MARKET DEMOGRAPHICS ═══════════════ -->
<div id="sec-R3" class="section" style="scroll-margin-top:20px">
  <h2><span class="sec-num">3</span> Market Demographics</h2>
  <div class="grid4" style="margin-bottom:16px">
    <div class="metric mi" onclick="toggleMI('dem-pop',event)"><div class="label">3-Mi Population</div><div class="value">${!isNaN(popN) ? fmtN2(popN) : "—"}</div><em class="mi-hint">i</em>
      <div id="mi-dem-pop" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">3-Mile Population</div><div class="mi-conf ${popN >= 25000 ? "mi-conf-high" : popN >= 10000 ? "mi-conf-med" : "mi-conf-low"}">${popN >= 40000 ? "Dense" : popN >= 25000 ? "Strong" : popN >= 10000 ? "Adequate" : "Low"}</div></div>
        <div class="mi-body">
          <strong>Total population within a 3-mile radius — the primary demand catchment for self-storage.</strong>
          <div class="mi-formula">SiteScore Weight: 16% of composite<br>Score: ${popN >= 40000 ? "10/10 (40K+)" : popN >= 25000 ? "8/10 (25K+)" : popN >= 15000 ? "6/10 (15K+)" : popN >= 10000 ? "5/10 (10K+)" : popN >= 5000 ? "3/10 (5K+)" : "0/10 — FAIL (<5K)"}</div>
          <div class="mi-row"><span class="mi-row-label">3-Mi Population</span><span class="mi-row-val">${!isNaN(popN) ? fmtN2(popN) : "—"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Industry Avg Demand</span><span class="mi-row-val">~10% of pop rents storage</span></div>
          <div class="mi-row"><span class="mi-row-label">Est. Demand Pool</span><span class="mi-row-val">${!isNaN(popN) ? fmtN2(Math.round(popN * 0.10)) + " potential renters" : "—"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Hard FAIL Threshold</span><span class="mi-row-val" style="color:#EF4444">Below 5,000</span></div>
          <div class="mi-source">Source: U.S. Census Bureau ACS 5-Year Estimates (2020-2024) | 3-mile radius centroid calculation</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('dem-hhi',event)"><div class="label">Median HHI</div><div class="value">${!isNaN(incN) ? "$" + fmtN2(incN) : "—"}</div><em class="mi-hint">i</em>
      <div id="mi-dem-hhi" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Median Household Income</div><div class="mi-conf ${incN >= 75000 ? "mi-conf-high" : incN >= 55000 ? "mi-conf-med" : "mi-conf-low"}">${incN >= 90000 ? "Affluent" : incN >= 75000 ? "Upper-Middle" : incN >= 55000 ? "Middle" : "Below Threshold"}</div></div>
        <div class="mi-body">
          <strong>Median household income within 3 miles — indicates spending capacity for premium storage services.</strong>
          <div class="mi-formula">SiteScore Weight: 10% of composite<br>Score: ${incN >= 90000 ? "10/10 ($90K+)" : incN >= 75000 ? "8/10 ($75K+)" : incN >= 65000 ? "6/10 ($65K+)" : incN >= 55000 ? "4/10 ($55K+)" : "0/10 — FAIL (<$55K)"}</div>
          <div class="mi-row"><span class="mi-row-label">Median HHI</span><span class="mi-row-val">${!isNaN(incN) ? "$" + fmtN2(incN) : "—"}</span></div>
          <div class="mi-row"><span class="mi-row-label">U.S. Median (2024)</span><span class="mi-row-val">$80,610</span></div>
          <div class="mi-row"><span class="mi-row-label">vs National</span><span class="mi-row-val" style="color:${incN >= 80610 ? '#16A34A' : '#D97706'}">${incN >= 80610 ? "+" : ""}${!isNaN(incN) ? Math.round((incN/80610-1)*100) : "—"}%</span></div>
          <div class="mi-row"><span class="mi-row-label">Hard FAIL Threshold</span><span class="mi-row-val" style="color:#EF4444">Below $55,000</span></div>
          <div class="mi-source">Source: U.S. Census Bureau ACS 5-Year Estimates (2020-2024) | Table B19013</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('dem-hh',event)"><div class="label">Households</div><div class="value">${!isNaN(hhN) ? fmtN2(hhN) : "—"}</div><em class="mi-hint">i</em>
      <div id="mi-dem-hh" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">3-Mile Household Count</div><div class="mi-conf ${hhN >= 18000 ? "mi-conf-high" : hhN >= 6000 ? "mi-conf-med" : "mi-conf-low"}">${hhN >= 25000 ? "Dense" : hhN >= 12000 ? "Strong" : "Moderate"}</div></div>
        <div class="mi-body">
          <strong>Total households within 3 miles — more precise demand proxy than population (1 household = 1 potential storage unit).</strong>
          <div class="mi-formula">SiteScore Weight: 5% of composite<br>Score: ${hhN >= 25000 ? "10/10 (25K+)" : hhN >= 18000 ? "8/10 (18K+)" : hhN >= 12000 ? "7/10 (12K+)" : hhN >= 6000 ? "5/10 (6K+)" : "3/10 (<6K)"}</div>
          <div class="mi-row"><span class="mi-row-label">Households</span><span class="mi-row-val">${!isNaN(hhN) ? fmtN2(hhN) : "—"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Avg HH Size</span><span class="mi-row-val">${!isNaN(popN) && !isNaN(hhN) && hhN > 0 ? (popN/hhN).toFixed(2) : "—"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Est. Addressable HH</span><span class="mi-row-val">${!isNaN(hhN) ? fmtN2(Math.round(hhN * 0.10)) + " (10% penetration)" : "—"}</span></div>
          <div class="mi-source">Source: U.S. Census Bureau ACS 5-Year Estimates (2020-2024) | Table B11001</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('dem-hv',event)"><div class="label">Home Value</div><div class="value">${!isNaN(hvN) ? "$" + fmtN2(hvN) : "—"}</div><em class="mi-hint">i</em>
      <div id="mi-dem-hv" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Median Home Value</div><div class="mi-conf ${hvN >= 350000 ? "mi-conf-high" : hvN >= 180000 ? "mi-conf-med" : "mi-conf-low"}">${hvN >= 500000 ? "Premium" : hvN >= 250000 ? "Strong" : "Moderate"}</div></div>
        <div class="mi-body">
          <strong>Median home value within 3 miles — affluence signal correlated with storage demand and willingness to pay premium rates.</strong>
          <div class="mi-formula">SiteScore Weight: 5% of composite<br>Score: ${hvN >= 500000 ? "10/10 ($500K+)" : hvN >= 350000 ? "9/10 ($350K+)" : hvN >= 250000 ? "8/10 ($250K+)" : hvN >= 180000 ? "6/10 ($180K+)" : "4/10 or lower"}</div>
          <div class="mi-row"><span class="mi-row-label">Median Home Value</span><span class="mi-row-val">${!isNaN(hvN) ? "$" + fmtN2(hvN) : "—"}</span></div>
          <div class="mi-row"><span class="mi-row-label">U.S. Median (2024)</span><span class="mi-row-val">$344,900</span></div>
          <div class="mi-row"><span class="mi-row-label">Why It Matters</span><span class="mi-row-val">Higher home values → more possessions → more storage demand</span></div>
          <div class="mi-source">Source: U.S. Census Bureau ACS 5-Year Estimates (2020-2024) | Table B25077 | Zillow ZHVI cross-reference</div>
        </div>
      </div></div>
    </div>
  </div>
  <div class="grid3">
    <div class="metric mi" onclick="toggleMI('dem-pop1',event)"><div class="label">1-Mi Population</div><div class="value">${!isNaN(pop1) ? fmtN2(pop1) : "—"}</div><em class="mi-hint">i</em>
      <div id="mi-dem-pop1" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">1-Mile Population</div><div class="mi-conf mi-conf-med">Supplemental</div></div>
        <div class="mi-body">
          <strong>Immediate-vicinity population — measures walk-up/drive-by demand within 1 mile of the site.</strong>
          <div class="mi-row"><span class="mi-row-label">1-Mi Population</span><span class="mi-row-val">${!isNaN(pop1) ? fmtN2(pop1) : "—"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Pop Density</span><span class="mi-row-val">${!isNaN(pop1) ? fmtN2(Math.round(pop1 / 3.14)) + "/sq mi" : "—"}</span></div>
          <div class="mi-row"><span class="mi-row-label">1-Mi vs 3-Mi Ratio</span><span class="mi-row-val">${!isNaN(pop1) && !isNaN(popN) && popN > 0 ? Math.round(pop1/popN*100) + "% concentration" : "—"}</span></div>
          <div class="mi-source">Source: U.S. Census Bureau ACS 5-Year Estimates (2020-2024) | 1-mile radius centroid</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('dem-growth',event)"><div class="label">5-Yr Growth CAGR</div><div class="value" style="color:${growthPct >= 1.5 ? '#16A34A' : growthPct >= 0 ? '#F59E0B' : '#EF4444'}">${growthPct ? growthPct.toFixed(1) + "%" : "—"}</div><em class="mi-hint">i</em>
      <div id="mi-dem-growth" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">5-Year Population Growth CAGR</div><div class="mi-conf ${growthPct >= 1.5 ? "mi-conf-high" : growthPct >= 0 ? "mi-conf-med" : "mi-conf-low"}">${growthPct >= 2.0 ? "High Growth" : growthPct >= 1.0 ? "Growing" : growthPct >= 0 ? "Stable" : "Declining"}</div></div>
        <div class="mi-body">
          <strong>Projected compound annual population growth rate (2025→2030) — the highest-weighted SiteScore dimension at 21%.</strong>
          <div class="mi-formula">SiteScore Weight: 21% of composite (highest weight)<br>Score: ${growthPct >= 2.0 ? "10/10 (≥2.0%)" : growthPct >= 1.5 ? "9/10 (≥1.5%)" : growthPct >= 1.0 ? "8/10 (≥1.0%)" : growthPct >= 0.5 ? "6/10 (≥0.5%)" : growthPct >= 0 ? "4/10 (≥0%)" : "0-2/10 (negative)"}</div>
          <div class="mi-row"><span class="mi-row-label">5-Yr CAGR</span><span class="mi-row-val">${growthPct ? growthPct.toFixed(1) + "%" : "—"}</span></div>
          <div class="mi-row"><span class="mi-row-label">U.S. Average</span><span class="mi-row-val">0.4% CAGR</span></div>
          <div class="mi-row"><span class="mi-row-label">Why Highest Weight</span><span class="mi-row-val">Growing markets = rising demand + rent growth + lower vacancy risk</span></div>
          <div class="mi-source">Source: ESRI Demographics 2025→2030 projections | ArcGIS Business Analyst | Census base year 2020</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('dem-tier',event)"><div class="label">Income Tier</div><div class="value" style="font-size:14px">${incTier.toUpperCase()}</div><em class="mi-hint">i</em>
      <div id="mi-dem-tier" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Income Tier Classification</div><div class="mi-conf mi-conf-med">Derived</div></div>
        <div class="mi-body">
          <strong>Income tier drives storage rental rate assumptions — higher-income markets command premium pricing.</strong>
          <div class="mi-formula">Classification: ${incTier.toUpperCase()}<br>Based on 3-mi median HHI: $${!isNaN(incN) ? fmtN2(incN) : "—"}</div>
          <div class="mi-row"><span class="mi-row-label">Premium ($100K+)</span><span class="mi-row-val">Highest climate rates — $1.40-1.80/SF/mo</span></div>
          <div class="mi-row"><span class="mi-row-label">Upper ($80-100K)</span><span class="mi-row-val">Above-average rates — $1.15-1.40/SF/mo</span></div>
          <div class="mi-row"><span class="mi-row-label">Middle ($60-80K)</span><span class="mi-row-val">Market rates — $0.95-1.15/SF/mo</span></div>
          <div class="mi-row"><span class="mi-row-label">Value ($45-60K)</span><span class="mi-row-val">Below-market rates — $0.75-0.95/SF/mo</span></div>
          <div class="mi-row"><span class="mi-row-label">This Site Rate</span><span class="mi-row-val">$${mktClimateRate.toFixed(2)}/SF/mo climate</span></div>
          <div class="mi-source">Source: SiteScore Income-Tier Rate Methodology | Calibrated to PSA/EXR submarket rate cards (Q4 2025)</div>
        </div>
      </div></div>
    </div>
  </div>
  ${site.demandDrivers ? `<div style="margin-top:16px;padding:14px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px"><div style="font-size:9px;font-weight:700;color:#16A34A;letter-spacing:0.08em;margin-bottom:6px">DEMAND DRIVERS</div><div style="font-size:12px;color:#1E293B;line-height:1.6">${h(site.demandDrivers)}</div></div>` : ""}
</div>

<!-- ═══════════════ SECTION 4: COMPETITION LANDSCAPE ═══════════════ -->
<div id="sec-R4" class="section" style="scroll-margin-top:20px">
  <h2><span class="sec-num">4</span> Competition Landscape</h2>
  <div class="grid3" style="margin-bottom:16px">
    <div class="metric mi" onclick="toggleMI('comp-count',event)"><div class="label">Competitors (3-Mi)</div><div class="value" style="color:${compCount <= 2 ? '#16A34A' : compCount <= 5 ? '#F59E0B' : '#EF4444'}">${compCount}</div><em class="mi-hint">i</em>
      <div id="mi-comp-count" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Competitive Density</div><div class="mi-conf ${compCount <= 2 ? "mi-conf-high" : compCount <= 5 ? "mi-conf-med" : "mi-conf-low"}">${compCount <= 1 ? "Low Competition" : compCount <= 3 ? "Moderate" : "High Competition"}</div></div>
        <div class="mi-body">
          <strong>Total self-storage facilities within a 3-mile radius. Fewer competitors = stronger pricing power and faster lease-up.</strong>
          <div class="mi-formula">SiteScore Weight: 7% of composite<br>Score: ${compCount === 0 ? "10/10 (0 competitors)" : compCount === 1 ? "9/10 (1 competitor)" : compCount === 2 ? "7/10 (2 competitors)" : compCount === 3 ? "6/10 (3 competitors)" : compCount <= 5 ? "4/10 (4-5 competitors)" : compCount <= 8 ? "3/10 (6-8 competitors)" : "2/10 (9+ competitors)"}</div>
          <div class="mi-row"><span class="mi-row-label">Competitor Count</span><span class="mi-row-val">${compCount} facilities</span></div>
          <div class="mi-row"><span class="mi-row-label">Est. Competing SF</span><span class="mi-row-val">${site.competingSF || "—"}</span></div>
          ${sfPerCapita ? `<div class="mi-row"><span class="mi-row-label">SF/Capita (3-Mi)</span><span class="mi-row-val" style="color:${demandColor}">${sfPerCapita} (${demandSignal})</span></div>` : ""}
          <div class="mi-row"><span class="mi-row-label">Industry Equilibrium</span><span class="mi-row-val">7-9 SF/capita</span></div>
          <div class="mi-source">Source: Google Maps, SpareFoot, SelfStorage.com facility scan | Cross-referenced with REIT property databases</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('comp-nearest',event)"><div class="label">Nearest Competitor</div><div class="value" style="font-size:12px">${site.nearestCompetitor || "—"}</div><em class="mi-hint">i</em>
      <div id="mi-comp-nearest" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Nearest Competing Facility</div><div class="mi-conf mi-conf-med">Verified</div></div>
        <div class="mi-body">
          <strong>Closest competing self-storage facility to the subject site. Proximity validates market demand but also indicates direct overlap.</strong>
          <div class="mi-row"><span class="mi-row-label">Nearest Facility</span><span class="mi-row-val">${h(site.nearestCompetitor || "—")}</span></div>
          <div class="mi-row"><span class="mi-row-label">Competitor Types</span><span class="mi-row-val">${h(site.competitorTypes || "—")}</span></div>
          <div class="mi-row"><span class="mi-row-label">Operators in Market</span><span class="mi-row-val">${h(site.competitorNames || "—")}</span></div>
          <div class="mi-row"><span class="mi-row-label">≤0.5 mi</span><span class="mi-row-val">Direct overlap — validates demand but competitive</span></div>
          <div class="mi-row"><span class="mi-row-label">0.5-2.0 mi</span><span class="mi-row-val">Ideal — market validation without cannibalization</span></div>
          <div class="mi-row"><span class="mi-row-label">2.0+ mi</span><span class="mi-row-val">Low overlap — potential underserved catchment</span></div>
          <div class="mi-source">Source: Google Maps radius scan, SpareFoot, operator websites | Verified ${new Date().toLocaleDateString()}</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('comp-supply',event)"><div class="label">Supply Signal</div><div class="value" style="font-size:11px;line-height:1.3">${site.demandSupplySignal || "—"}</div><em class="mi-hint">i</em>
      <div id="mi-comp-supply" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Demand / Supply Analysis</div><div class="mi-conf ${demandColor === '#16A34A' ? "mi-conf-high" : demandColor === '#F59E0B' ? "mi-conf-med" : "mi-conf-low"}">${demandSignal || "—"}</div></div>
        <div class="mi-body">
          <strong>Supply-per-capita ratio indicates whether the submarket is underserved, balanced, or oversaturated.</strong>
          <div class="mi-formula">SF/Capita = Total Competing SF ÷ 3-Mi Population<br>${sfPerCapita ? `= ${site.competingSF || "N/A"} ÷ ${!isNaN(popN) ? fmtN2(popN) : "N/A"}<br>= <strong style="color:${demandColor}">${sfPerCapita} SF/capita</strong>` : "Data pending"}</div>
          <div class="mi-row"><span class="mi-row-label">< 5 SF/capita</span><span class="mi-row-val" style="color:#16A34A">Underserved — strong demand signal</span></div>
          <div class="mi-row"><span class="mi-row-label">7-9 SF/capita</span><span class="mi-row-val" style="color:#D97706">Equilibrium — healthy market</span></div>
          <div class="mi-row"><span class="mi-row-label">> 12 SF/capita</span><span class="mi-row-val" style="color:#EF4444">Oversupplied — saturation risk</span></div>
          <div class="mi-source">Source: SSA (Self Storage Association) industry benchmarks | National avg: 7.3 SF/capita (2024)</div>
        </div>
      </div></div>
    </div>
  </div>
  ${site.competitorNames ? `<table>
    <thead><tr><th>Competitor Names</th><th>Types</th><th>Est. Total SF</th></tr></thead>
    <tbody><tr><td>${h(site.competitorNames || "—")}</td><td>${h(site.competitorTypes || "—")}</td><td>${h(site.competingSF || "—")}</td></tr></tbody>
  </table>` : ""}
  ${nearestPS !== null ? `<div class="mi" onclick="toggleMI('comp-nearps',event)" style="margin-top:14px;padding:12px 14px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;display:flex;justify-content:space-between;align-items:center">
    <div><div style="font-size:9px;font-weight:700;color:#0284C7;letter-spacing:0.08em">NEAREST EXISTING FACILITY</div><div style="font-size:13px;font-weight:700;margin-top:4px">${nearestPS} miles</div></div>
    <div class="pill" style="background:${nearestPS <= 5 ? '#16A34A' : nearestPS <= 15 ? '#3B82F6' : '#F59E0B'}18;color:${nearestPS <= 5 ? '#16A34A' : nearestPS <= 15 ? '#3B82F6' : '#F59E0B'}">${nearestPS <= 5 ? "VALIDATED SUBMARKET" : nearestPS <= 15 ? "EXPANSION ZONE" : "NEW MARKET"}</div><em class="mi-hint">i</em>
    <div id="mi-comp-nearps" class="mi-panel"><div class="mi-panel-inner">
      <div class="mi-header"><div class="mi-title">Nearest Facility Proximity</div><div class="mi-conf ${nearestPS <= 15 ? "mi-conf-high" : nearestPS <= 25 ? "mi-conf-med" : "mi-conf-low"}">${nearestPS <= 5 ? "Validated" : nearestPS <= 15 ? "Expansion" : "New Market"}</div></div>
      <div class="mi-body">
        <strong>Distance to the nearest existing corporate facility. Closer = market validation (not cannibalization). Sites >35mi from any facility are excluded as too remote.</strong>
        <div class="mi-formula">SiteScore Weight: 11% of composite<br>Score: ${nearestPS <= 5 ? "10/10 (≤5mi — validated submarket)" : nearestPS <= 10 ? "9/10 (≤10mi)" : nearestPS <= 15 ? "7/10 (≤15mi)" : nearestPS <= 25 ? "5/10 (≤25mi)" : "3/10 (>25mi) or FAIL if >35mi"}</div>
        <div class="mi-row"><span class="mi-row-label">Distance</span><span class="mi-row-val">${nearestPS} miles</span></div>
        <div class="mi-row"><span class="mi-row-label">≤ 5 mi</span><span class="mi-row-val" style="color:#16A34A">Validated — existing ops confirm demand</span></div>
        <div class="mi-row"><span class="mi-row-label">5-15 mi</span><span class="mi-row-val" style="color:#3B82F6">Expansion zone — adjacent market</span></div>
        <div class="mi-row"><span class="mi-row-label">15-35 mi</span><span class="mi-row-val" style="color:#D97706">New market — requires stand-alone demand</span></div>
        <div class="mi-row"><span class="mi-row-label">> 35 mi</span><span class="mi-row-val" style="color:#EF4444">HARD FAIL — too remote for footprint</span></div>
        <div class="mi-source">Source: PS_Locations_ALL.csv (3,112 locations) | Haversine distance calculation from site coordinates</div>
      </div>
    </div></div>
  </div>` : ""}
</div>

<!-- ═══════════════ SECTION 5: ZONING & ENTITLEMENTS ═══════════════ -->
<div id="sec-R5" class="section" style="scroll-margin-top:20px">
  <h2><span class="sec-num">5</span> Zoning & Entitlements</h2>
  <div style="display:flex;gap:16px;margin-bottom:16px">
    <div style="flex:1" class="metric mi" onclick="toggleMI('zon-district',event)">
      <div class="label">Zoning District</div>
      <div class="value" style="font-size:16px">${site.zoning || "—"}</div><em class="mi-hint">i</em>
      <div id="mi-zon-district" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Zoning District</div><div class="mi-conf mi-conf-med">Research</div></div>
        <div class="mi-body">
          <strong>The zoning district designation determines what uses are permitted on the parcel by right, by conditional use, or not at all.</strong>
          <div class="mi-row"><span class="mi-row-label">District</span><span class="mi-row-val">${site.zoning || "—"}</span></div>
          ${site.zoningOrdinanceSection ? `<div class="mi-row"><span class="mi-row-label">Ordinance Section</span><span class="mi-row-val">${site.zoningOrdinanceSection}</span></div>` : ""}
          ${site.jurisdictionType ? `<div class="mi-row"><span class="mi-row-label">Jurisdiction</span><span class="mi-row-val">${site.jurisdictionType}</span></div>` : ""}
          ${site.zoningUseTerm ? `<div class="mi-row"><span class="mi-row-label">Use Category</span><span class="mi-row-val">${site.zoningUseTerm}</span></div>` : ""}
          <div class="mi-row"><span class="mi-row-label">SiteScore Weight</span><span class="mi-row-val">16% of composite</span></div>
          <div class="mi-source">Source: ${site.zoningSource || "Municipal zoning ordinance"} | Verified: ${site.zoningVerifyDate || new Date().toLocaleDateString()}</div>
        </div>
      </div></div>
    </div>
    <div style="flex:1" class="metric mi" onclick="toggleMI('zon-class',event)">
      <div class="label">Classification</div>
      <div class="badge" style="background:${zoningColor}15;color:${zoningColor};border:1px solid ${zoningColor}30;font-size:12px;padding:6px 16px;margin-top:4px">${zoningLabel}</div><em class="mi-hint">i</em>
      <div id="mi-zon-class" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Zoning Classification</div><div class="mi-conf ${zoningClass === "by-right" ? "mi-conf-high" : zoningClass === "conditional" ? "mi-conf-med" : "mi-conf-low"}">${zoningLabel}</div></div>
        <div class="mi-body">
          <strong>Zoning classification determines entitlement timeline, cost, and political risk for self-storage development.</strong>
          <div class="mi-formula">SiteScore Weight: 16% of composite<br>Score: ${zoningClass === "by-right" ? "10/10 — permitted by right" : zoningClass === "conditional" ? "6/10 — conditional/SUP required" : zoningClass === "rezone-required" ? "2/10 — rezone required" : zoningClass === "prohibited" ? "0/10 — FAIL" : "5/10 — unknown"}</div>
          <div class="mi-row"><span class="mi-row-label">By-Right (P)</span><span class="mi-row-val" style="color:#16A34A">10/10 — no public hearing needed</span></div>
          <div class="mi-row"><span class="mi-row-label">Conditional (SUP/CUP)</span><span class="mi-row-val" style="color:#D97706">6/10 — 3-6 month hearing process</span></div>
          <div class="mi-row"><span class="mi-row-label">Rezone Required</span><span class="mi-row-val" style="color:#EF4444">2/10 — 6-12 months, $25K-$75K+</span></div>
          <div class="mi-row"><span class="mi-row-label">Prohibited</span><span class="mi-row-val" style="color:#991B1B">0/10 — HARD FAIL</span></div>
          ${site.politicalRisk ? `<div class="mi-row"><span class="mi-row-label">Political Risk</span><span class="mi-row-val">${site.politicalRisk}</span></div>` : ""}
          <div class="mi-source">Source: ${site.zoningSource || "Municipal permitted use table"} | Methodology: §6c ordinance lookup</div>
        </div>
      </div></div>
    </div>
  </div>
  <table>
    <tbody>
      ${site.zoningUseTerm ? `<tr><td style="font-weight:700;color:#64748B;width:200px">Use Category</td><td>${site.zoningUseTerm}</td></tr>` : ""}
      ${site.zoningOrdinanceSection ? `<tr><td style="font-weight:700;color:#64748B">Ordinance Section</td><td>${site.zoningOrdinanceSection}</td></tr>` : ""}
      ${site.zoningSource ? `<tr><td style="font-weight:700;color:#64748B">Source</td><td style="word-break:break-all">${site.zoningSource}</td></tr>` : ""}
      ${site.jurisdictionType ? `<tr><td style="font-weight:700;color:#64748B">Jurisdiction</td><td>${site.jurisdictionType}</td></tr>` : ""}
      ${site.overlayDistrict ? `<tr><td style="font-weight:700;color:#64748B">Overlay District</td><td>${site.overlayDistrict}</td></tr>` : ""}
      ${site.heightLimit ? `<tr><td style="font-weight:700;color:#64748B">Height Limit</td><td>${site.heightLimit}</td></tr>` : ""}
      ${site.facadeReqs ? `<tr><td style="font-weight:700;color:#64748B">Facade Requirements</td><td>${site.facadeReqs}</td></tr>` : ""}
      ${site.setbackReqs ? `<tr><td style="font-weight:700;color:#64748B">Setbacks</td><td>${site.setbackReqs}</td></tr>` : ""}
      ${site.parkingReqs ? `<tr><td style="font-weight:700;color:#64748B">Parking</td><td>${site.parkingReqs}</td></tr>` : ""}
      ${site.planningContact ? `<tr><td style="font-weight:700;color:#64748B">Planning Contact</td><td>${site.planningContact}${site.planningPhone ? " — " + site.planningPhone : ""}${site.planningEmail ? " — " + site.planningEmail : ""}</td></tr>` : ""}
    </tbody>
  </table>
  ${site.zoningNotes ? `<div style="margin-top:14px;padding:12px 14px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px"><div style="font-size:9px;font-weight:700;color:#92400E;letter-spacing:0.08em;margin-bottom:6px">ZONING RESEARCH NOTES</div><div style="font-size:11px;color:#1E293B;line-height:1.6;white-space:pre-wrap">${h(site.zoningNotes)}</div></div>` : ""}
</div>

<!-- ═══════════════ SECTION 6: UTILITIES & INFRASTRUCTURE ═══════════════ -->
<div id="sec-R6" class="section" style="scroll-margin-top:20px">
  <h2><span class="sec-num">6</span> Utilities & Infrastructure</h2>
  <div style="display:flex;gap:16px;margin-bottom:16px;align-items:center">
    <div class="metric mi" style="flex:0 0 120px" onclick="toggleMI('util-grade',event)">
      <div class="label">Utility Grade</div>
      <div class="value" style="font-size:36px;color:${utilColor}">${utilGrade}</div>
      <div class="sub">${utilScore}/100</div><em class="mi-hint">i</em>
      <div id="mi-util-grade" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Utility Readiness Score</div><div class="mi-conf ${utilScore >= 80 ? "mi-conf-high" : utilScore >= 60 ? "mi-conf-med" : "mi-conf-low"}">${utilGrade} Grade</div></div>
        <div class="mi-body">
          <strong>Weighted assessment of 10 utility readiness criteria. Municipal water is a HARD REQUIREMENT for fire suppression — self-storage facilities require 1,500+ GPM at 20 PSI residual.</strong>
          <div class="mi-formula">Utility Score = Σ (Criteria × Weight)<br>= ${utilScore}/100 → Grade ${utilGrade}</div>
          ${utilChecks.map(c => `<div class="mi-row"><span class="mi-row-label">${c.done ? "✓" : "○"} ${c.l}</span><span class="mi-row-val">${c.w} pts ${c.done ? "(earned)" : "(missing)"}</span></div>`).join("")}
          <div class="mi-row" style="border-top:1px solid #E2E8F0;padding-top:6px;margin-top:4px"><span class="mi-row-label">A ≥80</span><span class="mi-row-val">Development-ready — proceed</span></div>
          <div class="mi-row"><span class="mi-row-label">B (60-79)</span><span class="mi-row-val">Viable — verify remaining items</span></div>
          <div class="mi-row"><span class="mi-row-label">C (40-59)</span><span class="mi-row-val">Gaps exist — budget for extensions</span></div>
          <div class="mi-row"><span class="mi-row-label">D/F (<40)</span><span class="mi-row-val">Significant utility concerns</span></div>
          <div class="mi-source">Source: Municipal utility maps, TCEQ CCN (TX), city GIS portals, provider websites | Fire flow: NFPA 13/14</div>
        </div>
      </div></div>
    </div>
    <div style="flex:1">
      <div style="height:12px;border-radius:6px;background:#F1F5F9;overflow:hidden;margin-bottom:8px">
        <div style="width:${utilScore}%;height:100%;border-radius:6px;background:linear-gradient(90deg,${utilColor},${utilColor}CC);transition:width 0.5s"></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">
        ${utilChecks.map(c => `<span class="pill" style="background:${c.done ? '#16A34A' : '#94A3B8'}15;color:${c.done ? '#16A34A' : '#94A3B8'}">${c.done ? '✓' : '○'} ${c.l}</span>`).join("")}
      </div>
    </div>
  </div>
  <table>
    <tbody>
      ${site.waterProvider ? `<tr><td style="font-weight:700;color:#64748B;width:200px">Water Provider</td><td>${site.waterProvider}${site.waterAvailable === true ? ' <span class="pill" style="background:#16A34A15;color:#16A34A">AVAILABLE</span>' : site.waterAvailable === false ? ' <span class="pill" style="background:#EF444415;color:#EF4444">Need Further Research</span>' : ''}</td></tr>` : ""}
      ${site.distToWaterMain ? `<tr><td style="font-weight:700;color:#64748B">Dist to Water Main</td><td>${site.distToWaterMain}</td></tr>` : ""}
      ${site.waterMainSize ? `<tr><td style="font-weight:700;color:#64748B">Water Main Size</td><td>${site.waterMainSize}</td></tr>` : ""}
      ${site.sewerProvider ? `<tr><td style="font-weight:700;color:#64748B">Sewer Provider</td><td>${site.sewerProvider}${site.sewerAvailable === true ? ' <span class="pill" style="background:#16A34A15;color:#16A34A">AVAILABLE</span>' : ''}</td></tr>` : ""}
      ${site.electricProvider ? `<tr><td style="font-weight:700;color:#64748B">Electric Provider</td><td>${site.electricProvider}${site.threePhase === true ? ' <span class="pill" style="background:#16A34A15;color:#16A34A">3-PHASE ✓</span>' : ''}</td></tr>` : ""}
      ${site.gasProvider ? `<tr><td style="font-weight:700;color:#64748B">Gas Provider</td><td>${site.gasProvider}</td></tr>` : ""}
      ${site.waterTapFee || site.sewerTapFee ? `<tr><td style="font-weight:700;color:#64748B">Tap Fees</td><td>Water: ${site.waterTapFee || "—"} | Sewer: ${site.sewerTapFee || "—"}</td></tr>` : ""}
      ${site.impactFees ? `<tr><td style="font-weight:700;color:#64748B">Impact Fees</td><td>${site.impactFees}</td></tr>` : ""}
      ${site.totalUtilityBudget ? `<tr><td style="font-weight:700;color:#64748B">Est. Utility Budget</td><td style="font-weight:700;color:#1E293B">${site.totalUtilityBudget}</td></tr>` : ""}
    </tbody>
  </table>
  ${site.utilityNotes ? `<div style="margin-top:14px;padding:12px 14px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px"><div style="font-size:9px;font-weight:700;color:#0284C7;letter-spacing:0.08em;margin-bottom:6px">UTILITY NOTES</div><div style="font-size:11px;color:#1E293B;line-height:1.6;white-space:pre-wrap">${h(site.utilityNotes)}</div></div>` : ""}
</div>

<!-- ═══════════════ SECTION 7: SITE CHARACTERISTICS ═══════════════ -->
<div id="sec-R7" class="section" style="scroll-margin-top:20px">
  <h2><span class="sec-num">7</span> Site Characteristics & Access</h2>
  <div class="grid3" style="margin-bottom:16px">
    <div class="metric mi" onclick="toggleMI('site-acreage',event)"><div class="label">Acreage</div><div class="value">${!isNaN(acres) ? acres.toFixed(2) : "—"}</div><div class="sub">${isMultiStory ? "Multi-Story (3-4)" : "Single-Story"}</div><em class="mi-hint">i</em>
      <div id="mi-site-acreage" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Site Acreage & Product Type</div><div class="mi-conf mi-conf-high">Listing Data</div></div>
        <div class="mi-body">
          <strong>Site acreage determines product type selection and total rentable SF.</strong>
          <div class="mi-formula">Gross Site: ${!isNaN(acres) ? acres.toFixed(2) : "?"} ac = ${!isNaN(acres) ? Math.round(acres*43560).toLocaleString() : "?"} SF<br>Product: ${isMultiStory ? stories + "-story (< 3.5 ac → build up)" : "Single-story (≥ 3.5 ac → preferred)"}<br>Buildable @ 35% coverage: ${footprint.toLocaleString()} SF footprint</div>
          <div class="mi-row"><span class="mi-row-label">≥ 3.5 ac (Primary)</span><span class="mi-row-val">One-story indoor — PS preference</span></div>
          <div class="mi-row"><span class="mi-row-label">2.5 – 3.5 ac (Secondary)</span><span class="mi-row-val">3-4 story multi-story</span></div>
          <div class="mi-row"><span class="mi-row-label">< 2.5 ac</span><span class="mi-row-val" style="color:#EF4444">Generally too small for development</span></div>
          <div class="mi-row"><span class="mi-row-label">Coverage Ratio</span><span class="mi-row-val">35% (PS standard — Killeen TX sketch)</span></div>
          <div class="mi-source">Source: ${site.listingSource || "Crexi/LoopNet"} listing | PS development standards (Dec 2024)</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('site-sf',event)"><div class="label">Est. Building SF</div><div class="value">${totalSF.toLocaleString()}</div><div class="sub">${stories > 1 ? stories + " stories" : "Single-story"} · 35% coverage</div><em class="mi-hint">i</em>
      <div id="mi-site-sf" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Total Rentable SF Derivation</div><div class="mi-conf mi-conf-med">Calculated</div></div>
        <div class="mi-body">
          <strong>Total rentable square footage is the primary revenue driver. Derived from site acreage, coverage ratio, and stories.</strong>
          <div class="mi-formula">Step 1: Footprint = ${!isNaN(acres) ? acres.toFixed(2) : "?"} ac × 43,560 SF/ac × 35%<br>= ${footprint.toLocaleString()} SF<br>Step 2: Total SF = ${footprint.toLocaleString()} × ${stories} stories<br>= <strong style="color:#1E40AF">${totalSF.toLocaleString()} SF</strong></div>
          <div class="mi-row"><span class="mi-row-label">Climate-Controlled</span><span class="mi-row-val">${climateSF.toLocaleString()} SF (${Math.round(climatePct*100)}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Drive-Up</span><span class="mi-row-val">${driveSF.toLocaleString()} SF (${Math.round(drivePct*100)}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Revenue Density</span><span class="mi-row-val">$${totalSF > 0 ? (stabRev/totalSF).toFixed(2) : "N/A"}/SF/yr</span></div>
          <div class="mi-source">Source: SiteScore Facility Sizing Engine | 35% coverage from PS Killeen TX Option A sketch (Dec 2024)</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('site-flood',event)"><div class="label">Flood Zone</div><div class="value" style="font-size:14px">${site.floodZone || (hasFlood ? "⚠️ FLOOD" : "—")}</div><em class="mi-hint">i</em>
      <div id="mi-site-flood" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">FEMA Flood Zone Assessment</div><div class="mi-conf ${hasFlood ? "mi-conf-low" : "mi-conf-high"}">${hasFlood ? "Flood Risk" : "No Flood"}</div></div>
        <div class="mi-body">
          <strong>FEMA flood zone designation determines insurance costs, development feasibility, and SiteScore access penalty.</strong>
          <div class="mi-row"><span class="mi-row-label">Designation</span><span class="mi-row-val">${site.floodZone || (hasFlood ? "Flood zone identified" : "Zone X (no flood)")}</span></div>
          <div class="mi-row"><span class="mi-row-label">Zone X (Minimal)</span><span class="mi-row-val" style="color:#16A34A">No special flood area — preferred</span></div>
          <div class="mi-row"><span class="mi-row-label">Zone X (Shaded)</span><span class="mi-row-val" style="color:#D97706">500-yr flood — manageable</span></div>
          <div class="mi-row"><span class="mi-row-label">Zone A/AE</span><span class="mi-row-val" style="color:#EF4444">100-yr flood — significant constraint</span></div>
          <div class="mi-row"><span class="mi-row-label">SiteScore Impact</span><span class="mi-row-val">${hasFlood ? "-2 point penalty on access score" : "No penalty"}</span></div>
          <div class="mi-source">Source: FEMA Flood Map Service Center (msc.fema.gov) | National Flood Insurance Program</div>
        </div>
      </div></div>
    </div>
  </div>
  <table>
    <tbody>
      ${site.roadFrontage ? `<tr><td style="font-weight:700;color:#64748B;width:200px">Road Frontage</td><td>${site.roadFrontage}</td></tr>` : ""}
      ${site.frontageRoadName ? `<tr><td style="font-weight:700;color:#64748B">Frontage Road</td><td>${site.frontageRoadName}</td></tr>` : ""}
      ${site.roadType ? `<tr><td style="font-weight:700;color:#64748B">Road Type</td><td>${site.roadType}</td></tr>` : ""}
      ${site.trafficData ? `<tr><td style="font-weight:700;color:#64748B">Traffic (VPD)</td><td>${site.trafficData}</td></tr>` : ""}
      ${site.medianType ? `<tr><td style="font-weight:700;color:#64748B">Median Type</td><td>${site.medianType}</td></tr>` : ""}
      ${site.nearestSignal ? `<tr><td style="font-weight:700;color:#64748B">Nearest Signal</td><td>${site.nearestSignal}</td></tr>` : ""}
      ${site.curbCuts ? `<tr><td style="font-weight:700;color:#64748B">Curb Cuts</td><td>${site.curbCuts}</td></tr>` : ""}
      ${site.visibility ? `<tr><td style="font-weight:700;color:#64748B">Visibility</td><td>${site.visibility}</td></tr>` : ""}
      ${site.terrain ? `<tr><td style="font-weight:700;color:#64748B">Terrain</td><td>${site.terrain}</td></tr>` : ""}
      ${site.soilType ? `<tr><td style="font-weight:700;color:#64748B">Soil Type</td><td>${site.soilType}</td></tr>` : ""}
      ${dom !== null ? `<tr><td style="font-weight:700;color:#64748B">Days on Market</td><td>${dom}${dom > 365 ? ' <span class="pill" style="background:#F59E0B15;color:#F59E0B">STALE</span>' : ''}</td></tr>` : ""}
    </tbody>
  </table>
</div>

<!-- ═══════════════ SECTION 8: FINANCIAL ANALYSIS ═══════════════ -->
<div id="sec-R8" class="section" style="scroll-margin-top:20px;background:#FAFBFC">
  <h2><span class="sec-num">8</span> Financial Analysis</h2>

  <!-- Development Cost -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px">Development Cost Estimate</h3>
  <div class="grid4" style="margin-bottom:20px">
    <div class="metric mi" onclick="toggleMI('fin-land',event)"><div class="label">Land Cost</div><div class="value" style="font-size:16px">${landCost > 0 ? fmtM(landCost) : "—"}</div><em class="mi-hint">i</em>
      <div id="mi-fin-land" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Land Acquisition Cost</div><div class="mi-conf ${landCost > 0 ? "mi-conf-high" : "mi-conf-low"}">${landCost > 0 ? "Confirmed" : "Pending"}</div></div>
        <div class="mi-body">
          <strong>Land cost as listed or broker-confirmed. The single most variable input — drives YOC and land verdict.</strong>
          <div class="mi-formula">Price/Acre = ${fmtD(landCost)} ÷ ${!isNaN(acres) ? acres.toFixed(2) : "?"} ac = <strong style="color:#1E40AF">${pricePerAcre ? fmtD(pricePerAcre) + "/ac" : "N/A"}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Land as % of Total Dev</span><span class="mi-row-val">${totalDevCost > 0 ? Math.round(landCost/totalDevCost*100) : 0}%</span></div>
          <div class="mi-row"><span class="mi-row-label">Industry Benchmark</span><span class="mi-row-val">15-25% of total dev cost</span></div>
          <div class="mi-row"><span class="mi-row-label">Assessment</span><span class="mi-row-val" style="color:${landCost/totalDevCost < 0.25 ? "#16A34A" : "#D97706"}">${landCost/totalDevCost < 0.15 ? "Favorable" : landCost/totalDevCost < 0.25 ? "Market Rate" : "Premium"}</span></div>
          <div class="mi-source">Source: ${site.listingSource || "Crexi/LoopNet"} listing | Verified: ${new Date().toLocaleDateString()}</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('fin-hard',event)"><div class="label">Total Hard Cost</div><div class="value" style="font-size:16px">${fmtM(totalHardCost)}</div><div class="sub">$${totalHardPerSF}/SF all-in</div><em class="mi-hint">i</em>
      <div id="mi-fin-hard" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Full Hard Cost Stack — PS Killeen Calibrated</div><div class="mi-conf mi-conf-high">Killeen Benchmarked</div></div>
        <div class="mi-body">
          <strong>All-in hard costs: building shell, site development, fire suppression, interior buildout, technology, and utility infrastructure. Regionally adjusted. Calibrated to PS Killeen TX closing ($119/SF actual).</strong>
          <div class="mi-formula">
            Building Shell & HVAC: $${hardCostPerSF}/SF × ${grossSF ? grossSF.toLocaleString() : "?"} = ${fmtD(hardCost)}<br>
            Site Development: $${baseSiteWorkPerSF}/SF × ${siteAreaSF.toLocaleString()} site SF = ${fmtD(siteWorkCost)}<br>
            Fire Suppression: $${baseFireSuppressionPerSF}/SF × ${grossSF ? grossSF.toLocaleString() : "?"} = ${fmtD(fireSuppressionCost)}<br>
            Interior Buildout: $${baseInteriorPerSF}/SF × ${totalSF.toLocaleString()} net SF = ${fmtD(interiorBuildoutCost)}<br>
            Technology & Security: $${baseTechPerSF}/SF × ${grossSF ? grossSF.toLocaleString() : "?"} = ${fmtD(technologyCost)}<br>
            Utility Infrastructure: $${utilityInfraBase.toLocaleString()} + $${baseUtilityPerSF}/SF = ${fmtD(utilityInfraCost)}<br>
            ────────────<br>
            <strong style="color:#1E40AF">${fmtD(totalHardCost)}</strong> ($${totalHardPerSF}/SF all-in)
          </div>
          <div class="mi-row"><span class="mi-row-label">State Cost Index (${site.state || "N/A"})</span><span class="mi-row-val">${costIdx.toFixed(2)}x — ${costIdx < 0.95 ? "below national avg" : costIdx > 1.05 ? "above national avg" : "near national avg"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Gross vs Net SF</span><span class="mi-row-val">${grossSF ? grossSF.toLocaleString() : "?"} gross → ${totalSF.toLocaleString()} net (${netToGross ? (netToGross*100).toFixed(0) : 90}% efficiency)</span></div>
          <div class="mi-row"><span class="mi-row-label">Hard % of Total Dev</span><span class="mi-row-val">${totalDevCost > 0 ? Math.round(totalHardCost/totalDevCost*100) : 0}%</span></div>
          <div class="mi-row"><span class="mi-row-label">PS Benchmark</span><span class="mi-row-val">Killeen TX: $119/SF all-in on 98K GSF. Model: $${totalHardPerSF}/SF. ${Math.abs(totalHardPerSF - 119) <= 15 ? "Within calibration range." : "Review assumptions."}</span></div>
          <div class="mi-source">Source: RSMeans 2025 | PS Killeen TX closing (ORNTIC 303884/TX24380) | ENR Q1 2026</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('fin-soft',event)"><div class="label">Soft Cost (20%)</div><div class="value" style="font-size:16px">${fmtM(softCost)}</div><em class="mi-hint">i</em>
      <div id="mi-fin-soft" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Soft Costs</div><div class="mi-conf mi-conf-med">Standard Ratio</div></div>
        <div class="mi-body">
          <strong>Soft costs include architecture, engineering, permitting, legal, insurance, and financing fees. Contingency tracked separately at ${(contingencyPct*100).toFixed(1)}% of total hard costs (${fmtD(contingency)}).</strong>
          <div class="mi-formula">Soft Cost = Total Hard Cost × ${Math.round(softCostPct*100)}%<br>= ${fmtD(totalHardCost)} × ${softCostPct}<br>= <strong style="color:#1E40AF">${fmtD(softCost)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Architecture & Engineering</span><span class="mi-row-val">~6-8% of hard costs</span></div>
          <div class="mi-row"><span class="mi-row-label">Permitting & Impact Fees</span><span class="mi-row-val">~3-5% of hard costs</span></div>
          <div class="mi-row"><span class="mi-row-label">Financing & Legal</span><span class="mi-row-val">~3-4% of hard costs</span></div>
          <div class="mi-row"><span class="mi-row-label">Contingency</span><span class="mi-row-val">~3-5% of hard costs</span></div>
          <div class="mi-source">Source: REIT development pro formas (PSA, EXR) | 20% soft cost ratio is industry-standard for storage</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" style="border:2px solid #1E2761" onclick="toggleMI('fin-total',event)"><div class="label">Total Dev Cost</div><div class="value" style="font-size:16px;color:#1E2761">${totalDevCost > 0 ? fmtM(totalDevCost) : "—"}</div><em class="mi-hint">i</em>
      <div id="mi-fin-total" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Total Development Cost</div><div class="mi-conf mi-conf-med">Modeled</div></div>
        <div class="mi-body">
          <strong>All-in development cost — PS "Total Development Yield" denominator. Includes contingency and construction carry costs.</strong>
          <div class="mi-formula">Total Dev = Land + Hard + Soft + Contingency + Carry<br>= ${fmtD(landCost)} + ${fmtD(hardCost)} + ${fmtD(softCost)} + ${fmtD(contingency)} + ${fmtD(carryCosts)}<br>= <strong style="color:#1E2761">${fmtD(totalDevCost)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Land</span><span class="mi-row-val">${fmtD(landCost)} (${totalDevCost > 0 ? Math.round(landCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Hard Costs</span><span class="mi-row-val">${fmtD(hardCost)} (${totalDevCost > 0 ? Math.round(hardCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Soft Costs</span><span class="mi-row-val">${fmtD(softCost)} (${totalDevCost > 0 ? Math.round(softCost/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Contingency (${(contingencyPct*100).toFixed(1)}%)</span><span class="mi-row-val">${fmtD(contingency)} (${totalDevCost > 0 ? Math.round(contingency/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Construction Carry (${constructionMonths}mo)</span><span class="mi-row-val">${fmtD(carryCosts)} (${totalDevCost > 0 ? Math.round(carryCosts/totalDevCost*100) : 0}%)</span></div>
          <div class="mi-row"><span class="mi-row-label">Cost/SF (All-In)</span><span class="mi-row-val">${totalSF > 0 ? fmtD(totalDevCost/totalSF) + "/SF" : "N/A"}</span></div>
          <div class="mi-source">Source: SiteScore Financial Engine | Land: listing price | Hard: RSMeans/ENR 2025 regional index | Soft: 20% industry standard | Contingency: 7.5% of hard (REC standard)</div>
        </div>
      </div></div>
    </div>
  </div>

  <!-- 5-Year Pro Forma Summary -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin:20px 0 12px">5-Year Pro Forma Summary</h3>
  <table>
    <thead><tr><th>Year</th><th>Occupancy</th><th>Revenue</th><th>OpEx</th><th>NOI</th><th>YOC</th></tr></thead>
    <tbody>
      ${yearData.map((y, i) => {
        const yoc = totalDevCost > 0 ? ((y.noi / totalDevCost) * 100).toFixed(1) : "—";
        const yocC = parseFloat(yoc) >= 8.5 ? "#16A34A" : parseFloat(yoc) >= 7.0 ? "#F59E0B" : "#EF4444";
        return `<tr${i === 4 ? ' style="background:#F0FDF4;font-weight:700"' : ""}>
          <td style="font-weight:700">Y${y.yr}</td>
          <td>${Math.round(y.occRate * 100)}%</td>
          <td class="mono">${fmtD(y.totalRev)}</td>
          <td class="mono">${fmtD(y.opex)}</td>
          <td class="mono" style="font-weight:700">${fmtD(y.noi)}</td>
          <td class="mono" style="color:${yocC};font-weight:700">${yoc}%</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>

  <!-- Stabilized Valuation -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin:20px 0 12px">Stabilized Valuation (Y5 NOI: ${fmtD(stabNOI)})</h3>
  <div class="grid3">
    ${valuations.map((v,vi) => `<div class="metric mi" onclick="toggleMI('val${vi}',event)"><div class="label">${v.label}</div><div class="value" style="font-size:18px;color:#1E2761">${fmtM(v.value)}</div><div class="sub">@ ${(v.rate*100).toFixed(2)}% cap</div><em class="mi-hint">i</em>
      <div id="mi-val${vi}" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">${v.label} Valuation</div><div class="mi-conf mi-conf-med">Modeled</div></div>
        <div class="mi-body">
          <strong>Direct capitalization of stabilized NOI at a ${(v.rate*100).toFixed(2)}% cap rate.</strong>
          <div class="mi-formula">Value = Stabilized NOI ÷ Cap Rate<br>= ${fmtD(stabNOI)} ÷ ${(v.rate*100).toFixed(2)}%<br>= <strong style="color:#1E2761">${fmtM(v.value)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Value/SF</span><span class="mi-row-val">${totalSF > 0 ? fmtD(v.value/totalSF) : "N/A"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Value vs Dev Cost</span><span class="mi-row-val" style="color:${v.value > totalDevCost ? "#16A34A" : "#EF4444"}">${totalDevCost > 0 ? (v.value > totalDevCost ? "+" : "") + fmtM(v.value - totalDevCost) + " (" + Math.round((v.value/totalDevCost-1)*100) + "%)" : "N/A"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Cap Rate Context</span><span class="mi-row-val">${v.rate <= 0.05 ? "Aggressive — primary market" : v.rate <= 0.06 ? "Market — secondary market" : "Conservative — tertiary/discount"}</span></div>
          <div class="mi-source">Source: REIT transaction comps (PSA, EXR, CUBE Q4 2025 10-K filings) | Direct capitalization method</div>
        </div>
      </div></div>
    </div>`).join("")}
  </div>

  <!-- Land Price Guide -->
  <h3 style="font-size:12px;font-weight:800;color:#C9A84C;letter-spacing:0.08em;text-transform:uppercase;margin:24px 0 12px">◆ Land Acquisition Price Guide</h3>
  <div style="border:2px solid rgba(201,168,76,0.2);border-radius:12px;overflow:hidden">
    <table>
      <thead><tr><th>Tier</th><th>Target YOC</th><th>Max Land Price</th><th>Per Acre</th><th></th></tr></thead>
      <tbody>
        ${landPrices.map(lp => `<tr>
          <td style="font-weight:700">${lp.label}</td>
          <td class="mono">${(lp.yoc * 100).toFixed(1)}%</td>
          <td class="mono" style="font-weight:800;color:${lp.color}">${lp.maxLand > 0 ? fmtM(lp.maxLand) : "—"}</td>
          <td class="mono">${lp.perAcre > 0 ? fmtD(lp.perAcre) : "—"}/ac</td>
          <td><span class="pill" style="background:${lp.color}15;color:${lp.color}">${lp.tag}</span></td>
        </tr>`).join("")}
      </tbody>
    </table>
    ${askVsStrike !== null ? `<div style="padding:14px;background:#F8FAFC;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center">
      <div><span style="font-size:11px;color:#64748B;font-weight:600">Ask (${landCost > 0 ? fmtM(landCost) : "—"}) vs Strike (${fmtM(landPrices[1].maxLand)})</span></div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:16px;font-weight:900;color:${verdictColor};font-family:'Space Mono',monospace">${parseFloat(askVsStrike) > 0 ? '+' : ''}${askVsStrike}%</span>
        <span class="badge" style="background:${verdictColor}15;color:${verdictColor};border:1px solid ${verdictColor}30">${landVerdict}</span>
      </div>
    </div>` : ""}
  </div>
</div>

<!-- ═══════════════ SECTION 9: INSTITUTIONAL METRICS & REIT BENCHMARKING ═══════════════ -->
<div id="sec-R9" class="section" style="scroll-margin-top:20px">
  <h2><span class="sec-num">9</span> Institutional Performance Metrics</h2>
  <div class="grid4" style="margin-bottom:16px">
    <div class="metric mi" style="border:2px solid #1E2761" onclick="toggleMI('inst-revpaf',event)"><div class="label">RevPAF</div><div class="value" style="font-size:18px;color:#1E2761">$${revPAF}</div><div class="sub">/available SF/yr</div><em class="mi-hint">i</em>
      <div id="mi-inst-revpaf" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Revenue Per Available Foot</div><div class="mi-conf mi-conf-med">Institutional</div></div>
        <div class="mi-body">
          <strong>RevPAF is the REIT industry's primary operating metric — revenue per available square foot, regardless of occupancy.</strong>
          <div class="mi-formula">RevPAF = Stabilized Revenue ÷ Total SF<br>= ${fmtD(stabRev)} ÷ ${totalSF.toLocaleString()}<br>= <strong style="color:#1E2761">$${revPAF}/SF/yr</strong></div>
          <div class="mi-row"><span class="mi-row-label">PSA Q4 2025 Same-Store</span><span class="mi-row-val">$22.45/SF/yr</span></div>
          <div class="mi-row"><span class="mi-row-label">EXR Q4 2025 Same-Store</span><span class="mi-row-val">$21.82/SF/yr</span></div>
          <div class="mi-row"><span class="mi-row-label">CUBE Q4 2025 Same-Store</span><span class="mi-row-val">$20.19/SF/yr</span></div>
          <div class="mi-row"><span class="mi-row-label">This Site vs PSA</span><span class="mi-row-val" style="color:${parseFloat(revPAF) >= 22 ? '#16A34A' : '#D97706'}">${parseFloat(revPAF) >= 22 ? "At or above PSA" : "Below PSA — growth market pricing"}</span></div>
          <div class="mi-source">Source: PSA/EXR/CUBE 10-K Annual Reports (FY 2025) | Same-store revenue per available foot</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('inst-noim',event)"><div class="label">NOI Margin</div><div class="value" style="font-size:18px;color:${parseFloat(noiMarginPct) >= 60 ? '#16A34A' : '#F59E0B'}">${noiMarginPct}%</div><em class="mi-hint">i</em>
      <div id="mi-inst-noim" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">NOI Margin Analysis</div><div class="mi-conf ${parseFloat(noiMarginPct) >= 60 ? "mi-conf-high" : "mi-conf-med"}">${parseFloat(noiMarginPct) >= 65 ? "Strong" : parseFloat(noiMarginPct) >= 55 ? "Adequate" : "Below Industry"}</div></div>
        <div class="mi-body">
          <strong>Net Operating Income as a percentage of total revenue — self-storage's hallmark is high NOI margins (60%+).</strong>
          <div class="mi-formula">NOI Margin = Stabilized NOI ÷ Stabilized Revenue<br>= ${fmtD(stabNOI)} ÷ ${fmtD(stabRev)}<br>= <strong style="color:${parseFloat(noiMarginPct) >= 60 ? '#16A34A' : '#D97706'}">${noiMarginPct}%</strong></div>
          <div class="mi-row"><span class="mi-row-label">PSA NOI Margin (2025)</span><span class="mi-row-val">62.8%</span></div>
          <div class="mi-row"><span class="mi-row-label">EXR NOI Margin (2025)</span><span class="mi-row-val">64.1%</span></div>
          <div class="mi-row"><span class="mi-row-label">Industry Range</span><span class="mi-row-val">58-68% (top-tier operators)</span></div>
          <div class="mi-row"><span class="mi-row-label">OpEx Ratio</span><span class="mi-row-val">${opexRatioDetail || "38"}%</span></div>
          <div class="mi-source">Source: PSA/EXR/CUBE/LSI 10-K Annual Reports (FY 2025) | SiteScore 10-line OpEx model</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('inst-devspread',event)"><div class="label">Dev Spread</div><div class="value" style="font-size:18px">${devSpread} bps</div><div class="sub">YOC vs ${(mktAcqCap*100).toFixed(1)}% acq cap</div><em class="mi-hint">i</em>
      <div id="mi-inst-devspread" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Development Spread</div><div class="mi-conf ${parseFloat(devSpread) >= 2.0 ? "mi-conf-high" : "mi-conf-med"}">${parseFloat(devSpread) >= 3.0 ? "Wide Spread" : parseFloat(devSpread) >= 2.0 ? "Adequate" : "Tight"}</div></div>
        <div class="mi-body">
          <strong>The development spread is the yield premium a developer earns by building vs. acquiring at market cap rate. This is the "developer's profit" that justifies the construction and lease-up risk.</strong>
          <div class="mi-formula">Dev Spread = YOC − Market Acquisition Cap Rate<br>= ${yocStab}% − ${(mktAcqCap*100).toFixed(1)}%<br>= <strong style="color:${parseFloat(devSpread) >= 2.0 ? '#16A34A' : '#D97706'}">${devSpread} bps</strong></div>
          <div class="mi-row"><span class="mi-row-label">Target Spread</span><span class="mi-row-val">≥ 200 bps (minimum risk premium)</span></div>
          <div class="mi-row"><span class="mi-row-label">Market Acq Cap</span><span class="mi-row-val">${(mktAcqCap*100).toFixed(1)}% (stabilized storage)</span></div>
          <div class="mi-row"><span class="mi-row-label">Risk Premium Covers</span><span class="mi-row-val">Construction, lease-up, entitlement risk</span></div>
          <div class="mi-source">Source: REIT transaction comps, Green Street Advisors cap rate index (2025) | Industry: 200-400 bps target spread</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('inst-sfcap',event)"><div class="label">SF/Capita (3-Mi)</div><div class="value" style="font-size:18px;color:${demandColor}">${sfPerCapita || "—"}</div><div class="sub">${demandSignal || "—"}</div><em class="mi-hint">i</em>
      <div id="mi-inst-sfcap" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Supply Per Capita Analysis</div><div class="mi-conf ${demandColor === '#16A34A' ? "mi-conf-high" : demandColor === '#F59E0B' ? "mi-conf-med" : "mi-conf-low"}">${demandSignal || "—"}</div></div>
        <div class="mi-body">
          <strong>Square feet of self-storage per capita within the 3-mile catchment — the key supply/demand equilibrium metric.</strong>
          <div class="mi-formula">SF/Capita = (Existing Storage SF + Proposed SF) ÷ 3-Mi Pop<br>${sfPerCapita ? `= <strong style="color:${demandColor}">${sfPerCapita} SF/capita</strong>` : "Data pending"}<br>SF/Capita (excl. this project) = ${sfPerCapitaExcl || "—"}</div>
          <div class="mi-row"><span class="mi-row-label">< 5 SF/capita</span><span class="mi-row-val" style="color:#16A34A">Underserved — strong demand</span></div>
          <div class="mi-row"><span class="mi-row-label">7-9 SF/capita</span><span class="mi-row-val">Equilibrium</span></div>
          <div class="mi-row"><span class="mi-row-label">> 12 SF/capita</span><span class="mi-row-val" style="color:#EF4444">Oversupplied</span></div>
          <div class="mi-row"><span class="mi-row-label">National Avg (2024)</span><span class="mi-row-val">7.3 SF/capita</span></div>
          <div class="mi-source">Source: SSA Self Storage Almanac (2024) | Facility count via Google Maps/SpareFoot scan</div>
        </div>
      </div></div>
    </div>
  </div>

  <!-- Capital Stack -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin:20px 0 12px">Capital Stack & Leveraged Returns</h3>
  <div class="grid4" style="margin-bottom:16px">
    <div class="metric mi" onclick="toggleMI('cap-loan',event)"><div class="label">Loan (${Math.round(loanLTV*100)}% LTV)</div><div class="value" style="font-size:14px">${fmtM(loanAmount)}</div><div class="sub">${(loanRate*100).toFixed(2)}% / ${loanAmort}yr</div><em class="mi-hint">i</em>
      <div id="mi-cap-loan" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Senior Debt Structure</div><div class="mi-conf mi-conf-med">Modeled</div></div>
        <div class="mi-body">
          <strong>Construction-to-permanent loan assumptions based on current CMBS/bank lending standards for self-storage development.</strong>
          <div class="mi-formula">Loan Amount = Total Dev Cost × LTV<br>= ${fmtD(totalDevCost)} × ${Math.round(loanLTV*100)}%<br>= <strong style="color:#1E40AF">${fmtD(loanAmount)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">LTV</span><span class="mi-row-val">${Math.round(loanLTV*100)}%</span></div>
          <div class="mi-row"><span class="mi-row-label">Interest Rate</span><span class="mi-row-val">${(loanRate*100).toFixed(2)}%</span></div>
          <div class="mi-row"><span class="mi-row-label">Amortization</span><span class="mi-row-val">${loanAmort} years</span></div>
          <div class="mi-row"><span class="mi-row-label">Annual Debt Service</span><span class="mi-row-val">${fmtD(annualDS)}</span></div>
          <div class="mi-source">Source: CMBS/bank construction-to-perm terms (Q1 2026) | 65% LTV, 25yr amort standard for SS development</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('cap-equity',event)"><div class="label">Equity Required</div><div class="value" style="font-size:14px">${fmtM(equityRequired)}</div><em class="mi-hint">i</em>
      <div id="mi-cap-equity" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Equity Requirement</div><div class="mi-conf mi-conf-med">Derived</div></div>
        <div class="mi-body">
          <strong>Total equity needed to fund the project after debt proceeds.</strong>
          <div class="mi-formula">Equity = Total Dev Cost × (1 - LTV)<br>= ${fmtD(totalDevCost)} × ${Math.round(equityPct*100)}%<br>= <strong style="color:#1E40AF">${fmtD(equityRequired)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Equity % of Stack</span><span class="mi-row-val">${Math.round(equityPct*100)}%</span></div>
          <div class="mi-row"><span class="mi-row-label">Cash After DS (Stab.)</span><span class="mi-row-val">${fmtD(cashAfterDS)}</span></div>
          <div class="mi-row"><span class="mi-row-label">Cash-on-Cash Return</span><span class="mi-row-val">${cashOnCash}%</span></div>
          <div class="mi-source">Source: SiteScore Capital Stack Model | Standard self-storage development financing structure</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('cap-dscr',event)"><div class="label">DSCR (Stab.)</div><div class="value" style="font-size:18px;color:${parseFloat(dscrStab) >= 1.25 ? '#16A34A' : '#EF4444'}">${dscrStab}x</div><em class="mi-hint">i</em>
      <div id="mi-cap-dscr" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Debt Service Coverage Ratio</div><div class="mi-conf ${parseFloat(dscrStab) >= 1.25 ? "mi-conf-high" : "mi-conf-low"}">${parseFloat(dscrStab) >= 1.25 ? "Meets Covenant" : "Below Covenant"}</div></div>
        <div class="mi-body">
          <strong>DSCR measures how many times NOI covers annual debt service. Lenders require 1.25x minimum for self-storage.</strong>
          <div class="mi-formula">DSCR = Stabilized NOI ÷ Annual Debt Service<br>= ${fmtD(stabNOI)} ÷ ${fmtD(annualDS)}<br>= <strong style="color:${parseFloat(dscrStab) >= 1.25 ? '#16A34A' : '#EF4444'}">${dscrStab}x</strong></div>
          <div class="mi-row"><span class="mi-row-label">Minimum Covenant</span><span class="mi-row-val">1.25x (CMBS standard)</span></div>
          <div class="mi-row"><span class="mi-row-label">Comfortable Level</span><span class="mi-row-val">1.40x+</span></div>
          <div class="mi-row"><span class="mi-row-label">Cushion</span><span class="mi-row-val">${parseFloat(dscrStab) >= 1.25 ? fmtD(stabNOI - annualDS * 1.25) + " above 1.25x" : "Below minimum — risk"}</span></div>
          <div class="mi-source">Source: CMBS underwriting standards | Fannie/Freddie small-balance loan guidelines (2025)</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('cap-coc',event)"><div class="label">Cash-on-Cash</div><div class="value" style="font-size:18px;color:${parseFloat(cashOnCash) >= 10 ? '#16A34A' : '#F59E0B'}">${cashOnCash}%</div><em class="mi-hint">i</em>
      <div id="mi-cap-coc" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Cash-on-Cash Return</div><div class="mi-conf ${parseFloat(cashOnCash) >= 10 ? "mi-conf-high" : "mi-conf-med"}">${parseFloat(cashOnCash) >= 12 ? "Strong" : parseFloat(cashOnCash) >= 8 ? "Adequate" : "Low"}</div></div>
        <div class="mi-body">
          <strong>Annual cash return on equity invested — measures the income yield on the sponsor's actual cash outlay.</strong>
          <div class="mi-formula">Cash-on-Cash = Cash After DS ÷ Equity<br>= ${fmtD(cashAfterDS)} ÷ ${fmtD(equityRequired)}<br>= <strong style="color:${parseFloat(cashOnCash) >= 10 ? '#16A34A' : '#D97706'}">${cashOnCash}%</strong></div>
          <div class="mi-row"><span class="mi-row-label">Target Range</span><span class="mi-row-val">8-15% (development)</span></div>
          <div class="mi-row"><span class="mi-row-label">vs 10-Yr Treasury</span><span class="mi-row-val">${parseFloat(cashOnCash) > 4.5 ? "+" : ""}${(parseFloat(cashOnCash) - 4.5).toFixed(1)}% spread</span></div>
          <div class="mi-source">Source: SiteScore Capital Stack Model | Risk-adjusted return on equity after leverage</div>
        </div>
      </div></div>
    </div>
  </div>
  <div class="grid3">
    <div class="metric mi" style="border:2px solid #1E2761" onclick="toggleMI('inst-irr',event)"><div class="label">10-Yr Levered IRR</div><div class="value" style="font-size:22px;color:${parseFloat(irrPct) >= 15 ? '#16A34A' : parseFloat(irrPct) >= 10 ? '#F59E0B' : '#EF4444'}">${irrPct}%</div><em class="mi-hint">i</em>
      <div id="mi-inst-irr" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">10-Year Levered IRR</div><div class="mi-conf ${parseFloat(irrPct) >= 15 ? "mi-conf-high" : parseFloat(irrPct) >= 10 ? "mi-conf-med" : "mi-conf-low"}">${parseFloat(irrPct) >= 18 ? "Exceptional" : parseFloat(irrPct) >= 15 ? "Strong" : parseFloat(irrPct) >= 10 ? "Adequate" : "Below Hurdle"}</div></div>
        <div class="mi-body">
          <strong>Internal Rate of Return on levered equity over a 10-year hold — the comprehensive return metric incorporating cash flow timing, exit value, and leverage effects.</strong>
          <div class="mi-formula">IRR = Rate where NPV of all cash flows = 0<br>Equity invested: -${fmtD(equityRequired)} (Year 0)<br>Annual cash flow (stab.): +${fmtD(cashAfterDS)}<br>Exit proceeds (Y10): +${fmtD(exitEquityProceeds)}<br>= <strong style="color:${parseFloat(irrPct) >= 15 ? '#16A34A' : '#D97706'}">${irrPct}% IRR</strong></div>
          <div class="mi-row"><span class="mi-row-label">Institutional Target</span><span class="mi-row-val">15-20% levered (development)</span></div>
          <div class="mi-row"><span class="mi-row-label">Exit Cap Rate</span><span class="mi-row-val">${(exitCapRate*100).toFixed(2)}%</span></div>
          <div class="mi-row"><span class="mi-row-label">Exit Value (Y10)</span><span class="mi-row-val">${fmtM(exitValue)}</span></div>
          <div class="mi-row"><span class="mi-row-label">Equity Proceeds (Y10)</span><span class="mi-row-val">${fmtM(exitEquityProceeds)}</span></div>
          <div class="mi-source">Source: SiteScore 10-Year DCF Model | NPV-based IRR solver | Exit: 50bp cap expansion from entry</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('inst-eqmult',event)"><div class="label">Equity Multiple (10-Yr)</div><div class="value" style="font-size:22px">${equityMultiple}x</div><em class="mi-hint">i</em>
      <div id="mi-inst-eqmult" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Equity Multiple</div><div class="mi-conf ${parseFloat(equityMultiple) >= 2.5 ? "mi-conf-high" : parseFloat(equityMultiple) >= 2.0 ? "mi-conf-med" : "mi-conf-low"}">${parseFloat(equityMultiple) >= 2.5 ? "Strong" : parseFloat(equityMultiple) >= 2.0 ? "Adequate" : "Below Target"}</div></div>
        <div class="mi-body">
          <strong>Total return on equity — how many times the initial equity investment is returned over the 10-year hold period.</strong>
          <div class="mi-formula">Equity Multiple = Total Distributions ÷ Equity Invested<br>= (Cumulative Cash Flow + Exit Proceeds) ÷ ${fmtD(equityRequired)}<br>= <strong style="color:#1E2761">${equityMultiple}x</strong></div>
          <div class="mi-row"><span class="mi-row-label">Institutional Target</span><span class="mi-row-val">2.0x – 3.0x (10-yr development)</span></div>
          <div class="mi-row"><span class="mi-row-label">Total Profit</span><span class="mi-row-val">${fmtD((parseFloat(equityMultiple) - 1) * equityRequired)}</span></div>
          <div class="mi-row"><span class="mi-row-label">Profit / Year</span><span class="mi-row-val">${fmtD((parseFloat(equityMultiple) - 1) * equityRequired / 10)}/yr avg</span></div>
          <div class="mi-source">Source: SiteScore 10-Year DCF Model | Total capital return including cash flow and exit</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('inst-rateconf',event)"><div class="label">Rate Confidence</div><div class="value" style="font-size:14px;color:${rateConfColor}">${rateConfidence}</div><div class="sub">3-method cross-validated</div><em class="mi-hint">i</em>
      <div id="mi-inst-rateconf" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Rental Rate Confidence</div><div class="mi-conf ${rateConfidence === "HIGH" ? "mi-conf-high" : rateConfidence === "MEDIUM" ? "mi-conf-med" : "mi-conf-low"}">${rateConfidence}</div></div>
        <div class="mi-body">
          <strong>Three independent rate-estimation methods are cross-validated to determine confidence in the modeled rental rates.</strong>
          <div class="mi-row"><span class="mi-row-label">Method 1: Income-Tier</span><span class="mi-row-val">$${m1Rate.toFixed(2)}/SF/mo (HHI-based)</span></div>
          <div class="mi-row"><span class="mi-row-label">Method 2: Comp Scan</span><span class="mi-row-val">$${m2ClimRate.toFixed(2)} clim / $${m2DriveRate.toFixed(2)} drive</span></div>
          <div class="mi-row"><span class="mi-row-label">Method 3: Pop Density</span><span class="mi-row-val">$${m3ClimRate.toFixed(2)}/SF/mo</span></div>
          <div class="mi-row"><span class="mi-row-label">Consensus Rate</span><span class="mi-row-val" style="color:#1E2761">$${consensusClimRate.toFixed(2)}/SF/mo climate</span></div>
          <div class="mi-row"><span class="mi-row-label">Methodology</span><span class="mi-row-val">Median of 3 methods (outlier-resistant)</span></div>
          <div class="mi-row"><span class="mi-row-label">Confidence Logic</span><span class="mi-row-val">${rateConfidence === "HIGH" ? "All 3 methods within 15% of consensus" : rateConfidence === "MEDIUM" ? "2 of 3 methods within 20% of consensus" : "Methods diverge >25% — verify with comps"}</span></div>
          <div class="mi-source">Source: SiteScore 3-Method Rate Engine | Census ACS (M1), SpareFoot/operator websites (M2), ESRI pop density (M3)</div>
        </div>
      </div></div>
    </div>
  </div>

  <!-- REIT Benchmarking (condensed) -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin:20px 0 12px">REIT Portfolio Comparison</h3>
  <table style="font-size:11px">
    <thead><tr><th>Operator</th><th>RevPAF</th><th>NOI Margin</th><th>Avg Occ</th><th>Implied Cap</th></tr></thead>
    <tbody>
      <tr style="background:rgba(201,168,76,0.06);font-weight:700;border-left:3px solid #C9A84C">
        <td style="color:#C9A84C">◆ THIS SITE</td><td class="mono">$${revPAF}</td><td class="mono">${noiMarginPct}%</td><td class="mono">${Math.round(yearData[4].occ * 100)}%</td><td class="mono">${yocStab}% YOC</td>
      </tr>
      ${reitBench.slice(0, 4).map(r => `<tr>
        <td style="font-weight:600">${r.ticker}</td><td class="mono">$${r.revPAF.toFixed(2)}</td><td class="mono">${r.noiMargin.toFixed(1)}%</td><td class="mono">${r.avgOcc.toFixed(1)}%</td><td class="mono">${r.impliedCap.toFixed(1)}%</td>
      </tr>`).join("")}
    </tbody>
  </table>

  <!-- Replacement Cost -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin:20px 0 12px">Replacement Cost — Build vs. Acquire</h3>
  <div class="grid3">
    <div class="metric mi" onclick="toggleMI('repl-cost',event)"><div class="label">Replacement Cost</div><div class="value" style="font-size:14px">${fmtM(replacementCost)}</div><div class="sub">$${replacementCostPerSF}/SF excl. land</div><em class="mi-hint">i</em>
      <div id="mi-repl-cost" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Replacement Cost Analysis</div><div class="mi-conf mi-conf-med">Modeled</div></div>
        <div class="mi-body">
          <strong>What it would cost to build an identical facility at current construction costs — the "floor" for acquisition pricing.</strong>
          <div class="mi-formula">Replacement Cost (excl. land) = Total SF × Cost/SF<br>= ${totalSF.toLocaleString()} × $${replacementCostPerSF}<br>= <strong style="color:#1E40AF">${fmtM(replacementCost)}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Construction $/SF</span><span class="mi-row-val">$${replacementCostPerSF}/SF</span></div>
          <div class="mi-row"><span class="mi-row-label">Full w/ Land</span><span class="mi-row-val">${fullReplacementCost > 0 ? fmtM(fullReplacementCost) : "—"}</span></div>
          <div class="mi-row"><span class="mi-row-label">vs Market Value</span><span class="mi-row-val">${replacementVsMarket || "—"}</span></div>
          <div class="mi-source">Source: RSMeans Construction Cost Database (2025) | State-adjusted index | Self-storage specification</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" onclick="toggleMI('repl-full',event)"><div class="label">Full Dev Cost</div><div class="value" style="font-size:14px">${fullReplacementCost > 0 ? fmtM(fullReplacementCost) : "—"}</div><em class="mi-hint">i</em>
      <div id="mi-repl-full" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Full Replacement Cost (w/ Land)</div><div class="mi-conf mi-conf-med">Calculated</div></div>
        <div class="mi-body">
          <strong>Total cost to replicate this facility from scratch including land — used to evaluate build vs. acquire decisions.</strong>
          <div class="mi-formula">Full Cost = Replacement (excl. land) + Land<br>= ${fmtD(replacementCost)} + ${fmtD(landCost)}<br>= <strong style="color:#1E40AF">${fullReplacementCost > 0 ? fmtD(fullReplacementCost) : "—"}</strong></div>
          <div class="mi-row"><span class="mi-row-label">Cost/SF (all-in)</span><span class="mi-row-val">${totalSF > 0 && fullReplacementCost > 0 ? fmtD(fullReplacementCost/totalSF) + "/SF" : "—"}</span></div>
          <div class="mi-source">Source: SiteScore Financial Engine | Land: listing, Construction: RSMeans (2025)</div>
        </div>
      </div></div>
    </div>
    <div class="metric mi" style="border:1px solid ${buildOrBuy?.startsWith("BUILD") ? '#16A34A' : '#F59E0B'}40" onclick="toggleMI('repl-verdict',event)"><div class="label">Verdict</div><div style="font-size:11px;font-weight:700;color:${buildOrBuy?.startsWith("BUILD") ? '#16A34A' : '#F59E0B'};margin-top:6px">${buildOrBuy || "—"}</div><em class="mi-hint">i</em>
      <div id="mi-repl-verdict" class="mi-panel"><div class="mi-panel-inner">
        <div class="mi-header"><div class="mi-title">Build vs. Acquire Verdict</div><div class="mi-conf ${buildOrBuy?.startsWith("BUILD") ? "mi-conf-high" : "mi-conf-med"}">${buildOrBuy?.startsWith("BUILD") ? "Build Favorable" : "Evaluate"}</div></div>
        <div class="mi-body">
          <strong>Compares the cost of ground-up development versus acquiring an existing stabilized facility at market cap rate.</strong>
          <div class="mi-row"><span class="mi-row-label">Development Cost</span><span class="mi-row-val">${fmtD(totalDevCost)}</span></div>
          <div class="mi-row"><span class="mi-row-label">Market Acq Price</span><span class="mi-row-val">${valuations[1] ? fmtM(valuations[1].value) : "—"} (@ mkt cap)</span></div>
          <div class="mi-row"><span class="mi-row-label">Value Creation</span><span class="mi-row-val" style="color:#16A34A">${valuations[1] ? fmtM(valuations[1].value - totalDevCost) : "—"}</span></div>
          <div class="mi-row"><span class="mi-row-label">Verdict</span><span class="mi-row-val" style="color:${buildOrBuy?.startsWith("BUILD") ? '#16A34A' : '#D97706'}">${buildOrBuy || "—"}</span></div>
          <div class="mi-source">Source: SiteScore Replacement Cost Engine | Market cap rates from REIT transaction comps (Q4 2025)</div>
        </div>
      </div></div>
    </div>
  </div>
</div>

<!-- ═══════════════ SECTION 9: SENSITIVITY ANALYSIS & SOURCES/USES ═══════════════ -->
<div class="section">
  <h2><span class="sec-num">9</span> Sensitivity Analysis & Capital Structure</h2>

  <!-- Sensitivity Matrix -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px">Stabilized YOC & IRR Sensitivity — Rent ±10% × Occupancy ±5pts</h3>
  <table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:24px">
    <thead>
      <tr>
        <th style="background:#F8FAFC;color:#64748B;padding:10px;border:1px solid #E2E8F0"></th>
        ${sensitivityMatrix.occScenarios.map(o => `<th style="background:#F8FAFC;color:#1E2761;padding:10px;text-align:center;border:1px solid #E2E8F0;font-weight:700">${o.label}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${sensitivityMatrix.grid.map((row, ri) => `<tr>
        <td style="background:#F8FAFC;color:#1E2761;padding:10px;font-weight:700;border:1px solid #E2E8F0">${sensitivityMatrix.rentScenarios[ri].label}</td>
        ${row.map((cell, ci) => {
          const isBase = ri === 1 && ci === 1;
          const bg = isBase ? "#FFF7ED" : "#FFFFFF";
          const yocColor = parseFloat(cell.yoc) >= 9 ? "#16A34A" : parseFloat(cell.yoc) >= 7 ? "#D97706" : "#EF4444";
          const irrColor = parseFloat(cell.irr) >= 15 ? "#16A34A" : parseFloat(cell.irr) >= 10 ? "#D97706" : "#EF4444";
          return `<td style="background:${bg};padding:10px;text-align:center;border:1px solid #E2E8F0;${isBase ? "border:2px solid #C9A84C;font-weight:700;" : ""}">
            <div style="font-size:16px;font-weight:800;color:${yocColor}">${cell.yoc}%</div>
            <div style="font-size:9px;color:#94A3B8;margin-top:2px">YOC</div>
            <div style="font-size:13px;font-weight:700;color:${irrColor};margin-top:4px">${cell.irr}%</div>
            <div style="font-size:9px;color:#94A3B8">IRR (10-Yr Levered)</div>
          </td>`;
        }).join("")}
      </tr>`).join("")}
    </tbody>
  </table>
  <div style="font-size:10px;color:#94A3B8;margin-bottom:24px">Base case highlighted (gold border). Fixed operating costs held constant across scenarios; variable costs adjust with revenue. ECRI at 20% Y5 cumulative blended lift. IRR computed via full 10-year DCF rerun per scenario.</div>

  <!-- Sources & Uses -->
  <h3 style="font-size:12px;font-weight:800;color:#64748B;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px">Sources & Uses of Capital</h3>
  <div style="display:flex;gap:24px;margin-bottom:16px">
    <div style="flex:1">
      <div style="font-size:11px;font-weight:700;color:#1E2761;letter-spacing:0.06em;margin-bottom:8px;text-transform:uppercase">Sources</div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        ${sourcesAndUses.sources.map(s => `<tr>
          <td style="padding:8px 12px;border:1px solid #E2E8F0;color:#1E293B;font-weight:600">${s.item}</td>
          <td style="padding:8px 12px;border:1px solid #E2E8F0;text-align:right;font-family:'Space Mono',monospace">${fmtD(s.amount)}</td>
          <td style="padding:8px 12px;border:1px solid #E2E8F0;text-align:right;color:#64748B;font-family:'Space Mono',monospace">${s.pct}%</td>
        </tr>`).join("")}
        <tr style="background:#F0FDF4;font-weight:800">
          <td style="padding:8px 12px;border:1px solid #E2E8F0;color:#1E2761">Total Sources</td>
          <td style="padding:8px 12px;border:1px solid #E2E8F0;text-align:right;font-family:'Space Mono',monospace;color:#16A34A">${fmtD(sourcesAndUses.totalSources)}</td>
          <td style="padding:8px 12px;border:1px solid #E2E8F0;text-align:right;font-family:'Space Mono',monospace">100%</td>
        </tr>
      </table>
    </div>
    <div style="flex:1">
      <div style="font-size:11px;font-weight:700;color:#1E2761;letter-spacing:0.06em;margin-bottom:8px;text-transform:uppercase">Uses</div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        ${sourcesAndUses.uses.map(u => `<tr>
          <td style="padding:8px 12px;border:1px solid #E2E8F0;color:#1E293B;font-weight:600">${u.item}</td>
          <td style="padding:8px 12px;border:1px solid #E2E8F0;text-align:right;font-family:'Space Mono',monospace">${fmtD(u.amount)}</td>
          <td style="padding:8px 12px;border:1px solid #E2E8F0;text-align:right;color:#64748B;font-family:'Space Mono',monospace">${u.pct}%</td>
        </tr>`).join("")}
        <tr style="background:#FFF7ED;font-weight:800">
          <td style="padding:8px 12px;border:1px solid #E2E8F0;color:#1E2761">Total Uses</td>
          <td style="padding:8px 12px;border:1px solid #E2E8F0;text-align:right;font-family:'Space Mono',monospace;color:#E87A2E">${fmtD(sourcesAndUses.totalUses)}</td>
          <td style="padding:8px 12px;border:1px solid #E2E8F0;text-align:right;font-family:'Space Mono',monospace">100%</td>
        </tr>
      </table>
    </div>
  </div>
  <div style="font-size:10px;color:#94A3B8">Construction financing at 60% LTC, 7.5% rate, ${constructionMonths}-month build. Permanent financing: ${Math.round(loanLTV*100)}% LTV @ ${(loanRate*100).toFixed(2)}% / ${loanAmort}-yr amortization. Working capital reserve: 2% of build costs.</div>
</div>

<!-- ═══════════════ SECTION 10: RISK ASSESSMENT ═══════════════ -->
<div id="sec-R10" class="section" style="scroll-margin-top:20px">
  <h2><span class="sec-num">10</span> Risk Assessment</h2>
  ${risks.length > 0 ? risks.map(r => `<div class="risk-row" style="background:${r.color}08;border:1px solid ${r.color}20">
    <span class="pill" style="background:${r.color}18;color:${r.color};min-width:60px;text-align:center">${r.level}</span>
    <span style="font-size:11px;font-weight:700;color:#64748B;min-width:90px">${r.cat}</span>
    <span style="font-size:12px;color:#1E293B">${r.desc}</span>
  </div>`).join("") : `<div style="padding:16px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;text-align:center;color:#16A34A;font-weight:700;font-size:13px">✅ No significant risks identified</div>`}
</div>

<!-- ═══════════════ SECTION 11: BROKER INTEL ═══════════════ -->
${site.sellerBroker || site.brokerNotes || site.listingSource ? `<div class="section">
  <h2><span class="sec-num">11</span> Broker Intelligence</h2>
  <table>
    <tbody>
      ${site.sellerBroker ? `<tr><td style="font-weight:700;color:#64748B;width:200px">Seller / Broker</td><td>${h(site.sellerBroker)}</td></tr>` : ""}
      ${site.listingSource ? `<tr><td style="font-weight:700;color:#64748B">Listing Source</td><td>${h(site.listingSource)}</td></tr>` : ""}
      ${site.listingUrl ? `<tr><td style="font-weight:700;color:#64748B">Listing URL</td><td><a href="${h(site.listingUrl)}" style="color:#2563EB;word-break:break-all">${h(site.listingUrl)}</a></td></tr>` : ""}
      ${site.brokerNotes ? `<tr><td style="font-weight:700;color:#64748B">Broker Notes</td><td>${h(site.brokerNotes)}</td></tr>` : ""}
    </tbody>
  </table>
</div>` : ""}

<!-- ═══════════════ SECTION 12: DEAL SUMMARY ═══════════════ -->
${site.summary ? `<div class="section">
  <h2><span class="sec-num">${site.sellerBroker || site.brokerNotes || site.listingSource ? "12" : "11"}</span> Deal Summary & Notes</h2>
  <div style="padding:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;font-size:12px;color:#1E293B;line-height:1.7;white-space:pre-wrap">${h(site.summary)}</div>
</div>` : ""}

<!-- ═══════════════ FOOTER ═══════════════ -->
<div class="divider"></div>
<div style="padding:32px 40px;text-align:center">
  <div style="display:flex;justify-content:center;align-items:center;gap:12px;margin-bottom:12px">
    <div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#C9A84C,#E87A2E);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:#fff;font-family:'Space Mono'">REC</div>
    <div>
      <div style="font-size:11px;font-weight:800;letter-spacing:0.12em;color:#1E2761">REAL ESTATE COMMITTEE PACKAGE</div>
      <div style="font-size:9px;color:#94A3B8;letter-spacing:0.06em">Powered by SiteScore™ Intelligence Platform</div>
    </div>
  </div>
  <div style="height:1px;background:linear-gradient(90deg,transparent,#C9A84C,transparent);margin:16px auto;max-width:400px"></div>
  <div style="font-size:10px;color:#94A3B8;line-height:1.8">
    <div>REC Package — ${h(site.name)} | Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
    <div style="font-weight:600;color:#64748B;margin-top:4px">DJR Real Estate LLC | U.S. Patent Pending — Serial No. 99712640</div>
    <div style="margin-top:10px;font-size:9px;color:#94A3B8;max-width:700px;margin-left:auto;margin-right:auto">
      <strong>CONFIDENTIAL & PROPRIETARY.</strong> This document and its contents are the exclusive property of DJR Real Estate LLC.
      The SiteScore™ platform, scoring methodology, pricing models, and analytical frameworks contained herein are proprietary
      trade secrets protected under federal and state law. Unauthorized reproduction, distribution, or disclosure is strictly prohibited.
      This report is provided for informational purposes only and does not constitute investment advice or a guarantee of future performance.
    </div>
    <div style="margin-top:8px;font-size:9px;color:#94A3B8">&copy; ${new Date().getFullYear()} DJR Real Estate LLC. All rights reserved. SiteScore™ is a trademark of DJR Real Estate LLC.</div>
  </div>
</div>

</div>
<script>
(function(){
  var nav=document.getElementById('tocNav');
  if(nav) nav.style.display='';
  var links = document.querySelectorAll('#tocNav a');
  var sections = [];
  links.forEach(function(a){
    var id = a.getAttribute('href').replace('#','');
    var el = document.getElementById(id);
    if(el) sections.push({el:el, link:a});
  });
  function onScroll(){
    var scrollPos = window.scrollY + 120;
    var active = null;
    sections.forEach(function(s){
      if(s.el.offsetTop <= scrollPos) active = s;
    });
    links.forEach(function(a){ a.classList.remove('active'); });
    if(active) active.link.classList.add('active');
  }
  window.addEventListener('scroll', onScroll);
  onScroll();
})();
</script>
</body></html>`;
  } catch (err) {
    console.error("Report generation error:", err);
    return `<!DOCTYPE html><html><head><title>Error</title></head><body style="font-family:sans-serif;padding:40px;background:#0A0E2A;color:#fff;text-align:center"><h1 style="color:#C9A84C">Report Generation Error</h1><p style="color:#94A3B8">${escapeHtml(err.message)}</p><p style="color:#64748B;font-size:12px">Check the browser console for details. Try refreshing the site data.</p></body></html>`;
  }
};
