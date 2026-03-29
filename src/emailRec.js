// ─── Email Recommendation HTML Generator v3.0 ───
// Premium institutional AI aesthetic — Storvex™
// Returns { previewHTML, emailBody, subject, toEmails, listingWarning, recipient }

import { escapeHtml, fixEncoding } from './utils';
import { computeSiteFinancials } from './scoring';

const REC_RECIPIENTS = {
  east: { name: "Matt", email: "mtoussaint@publicstorage.com" },
  southwest: { name: "Dan", email: "dwollent@publicstorage.com" },
  queue: { name: "PS Team", email: "" },
};

export const generateRecEmailHTML = (site, regionKey, valuationOverrides) => {
  const h = escapeHtml;
  const fe = (v) => fixEncoding(v || "");
  const recip = REC_RECIPIENTS[regionKey] || REC_RECIPIENTS.queue;
  const iq = site.siteiqData || {};
  const ccSPC = iq.ccSPC ? parseFloat(iq.ccSPC).toFixed(1) : null;
  const projCCSPC = iq.projectedCCSPC ? parseFloat(iq.projectedCCSPC).toFixed(1) : null;
  const zClass = site.zoningClassification || "TBD";
  const coords = site.coordinates || "";
  const pinDrop = coords ? "https://www.google.com/maps?q=" + coords : "";
  const dashLink = "https://storvex.vercel.app/?site=" + site.id;
  const listingRaw = (site.listingUrl || "").trim();
  const listingUrl = listingRaw.startsWith("http") ? listingRaw : listingRaw ? "https://" + listingRaw : "";
  const listingWarning = listingUrl ? "" : "NO LISTING LINK";

  let fin = null;
  try { fin = computeSiteFinancials(site, valuationOverrides || {}, site.overrides || {}); } catch (e) { /* skip */ }
  const $k = (v) => v >= 1000000 ? "$" + (v / 1000000).toFixed(1) + "M" : v >= 1000 ? "$" + Math.round(v / 1000) + "K" : "$" + Math.round(v).toLocaleString();

  const acreageRaw = fe(site.acreage || "").replace(/\s*\(.*?\)\s*/g, "").trim();
  const askClean = fe(site.askingPrice || "TBD").replace(/\s*\(.*?\)\s*/g, "").trim();
  const pricePerAc = fin && fin.landCost > 0 && fin.acres > 0 ? $k(Math.round(fin.landCost / fin.acres)) : null;

  const siteName = fe(site.name || site.address || site.id);
  const cityState = ((site.city || "") + " " + (site.state || "")).trim();
  const subjectSite = siteName.toLowerCase().includes((site.city || "").toLowerCase()) ? siteName : cityState + ", " + siteName;
  const subject = ("Site Recommendation - " + subjectSite + (ccSPC ? " | CC SPC " + ccSPC : "") + (zClass === "by-right" ? ", By-Right" : "")).replace(/[\u2014\u2013\u2012\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x00-\x7F]/g, "");

  const toEmails = [];
  if (recip.email) toEmails.push(recip.email);
  if (regionKey === "east" && REC_RECIPIENTS.southwest.email) toEmails.push(REC_RECIPIENTS.southwest.email);
  if (regionKey === "southwest" && REC_RECIPIENTS.east.email) toEmails.push(REC_RECIPIENTS.east.email);

  // ── Data extraction ──
  const pop1 = site.pop1mi || ""; const pop3 = site.pop3mi || ""; const pop5 = site.pop5mi || "";
  const hhi1 = site.income1mi || ""; const hhi3 = site.income3mi || ""; const hhi5 = site.income5mi || "";
  const hh1 = site.households1mi || ""; const hh3 = site.households3mi || ""; const hh5 = site.households5mi || "";
  const hv1 = site.homeValue1mi || ""; const hv3 = site.homeValue3mi || ""; const hv5 = site.homeValue5mi || "";
  const growth = site.popGrowth3mi || site.growthRate || "";
  const renter = site.renterPct3mi || "";
  const nearPS = iq.nearestPS ? iq.nearestPS + " mi" : "";
  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // Zoning detail
  let zoningNote = "";
  if (site.zoningUseTerm && site.zoningOrdinanceSection) {
    zoningNote = '"' + h(fe(site.zoningUseTerm)) + '" permitted ' + (zClass === "by-right" ? "by right" : "conditionally") + " in " + h(site.zoning || "") + " per " + h(fe(site.zoningOrdinanceSection));
  } else if (site.zoning) {
    zoningNote = h(site.zoning) + " \u2014 " + zClass;
  }

  // CC SPC classification
  const ccV = ccSPC ? parseFloat(ccSPC) : null;
  const ccLabel = ccV ? (ccV < 1.5 ? "Severely Underserved" : ccV < 3.0 ? "Underserved" : ccV < 5.0 ? "Moderate" : ccV < 7.0 ? "Well-Supplied" : "Oversupplied") : "";
  const ccColor = ccV ? (ccV < 3.0 ? "#10B981" : ccV < 5.0 ? "#C9A84C" : "#F59E0B") : "#94A3B8";

  // Water status
  const hookup = site.waterHookupStatus || "";
  const waterColor = hookup === "by-right" ? "#10B981" : hookup === "by-request" ? "#C9A84C" : hookup === "no-provider" ? "#EF4444" : "#94A3B8";

  // Watches
  const watches = [];
  if (site.overlayDistrict) watches.push(h(fe(site.overlayDistrict)));
  if (site.floodZone && site.floodZone !== "Zone X" && site.floodZone !== "X") watches.push("Flood: " + h(fe(site.floodZone)));
  if (zClass === "conditional") watches.push("SUP/CUP required" + (site.supTimeline ? " (" + h(fe(site.supTimeline)) + ")" : ""));

  // Verdict
  let verdict = "";
  let verdictColor = "#3B82F6";
  if (fin && fin.landVerdict) {
    verdict = fin.landVerdict;
    verdictColor = (verdict === "STRONG BUY" || verdict === "BUY") ? "#10B981" : verdict === "NEGOTIATE" ? "#F59E0B" : "#3B82F6";
  }
  const yocStr = fin && fin.yocStab ? fin.yocStab + "%" : "";
  const bannerText = verdict || (yocStr ? "Projected " + yocStr + " YOC" : "Under Review");

  // ── Style tokens ──
  const MONO = "'SF Mono','Fira Code','Cascadia Code','Consolas',monospace";
  const SANS = "'Inter','SF Pro Display','Segoe UI',Calibri,system-ui,sans-serif";
  const NAVY = "#0A0F1E";
  const SLATE = "#0F172A";
  const GOLD = "#C9A84C";

  // ── Pill helper ──
  const pill = (text, bg, fg) => '<span style="display:inline-block;padding:3px 10px;border-radius:100px;background:' + bg + ';color:' + fg + ';font-size:10px;font-weight:700;letter-spacing:0.06em;font-family:' + MONO + '">' + text + '</span>';

  // ── KPI cell helper ──
  const kpi = (label, value, sub) => '<td style="padding:18px 16px;text-align:center;border-right:1px solid rgba(255,255,255,0.04)">' +
    '<div style="font-size:8px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.18em;font-family:' + MONO + '">' + label + '</div>' +
    '<div style="font-size:22px;font-weight:900;color:#F1F5F9;margin-top:6px;font-family:' + MONO + ';letter-spacing:-0.02em">' + value + '</div>' +
    (sub ? '<div style="font-size:9px;color:rgba(255,255,255,0.3);margin-top:3px;font-family:' + MONO + '">' + sub + '</div>' : '') +
    '</td>';

  // ── Demo row helper ──
  const dRow = (label, v1, v3, v5, opts) => {
    const clr = (opts && opts.color) || "#E2E8F0";
    const bg = (opts && opts.bg) || "transparent";
    return '<tr style="background:' + bg + '">' +
      '<td style="padding:10px 16px;font-size:12px;color:rgba(255,255,255,0.5);font-weight:600;border-bottom:1px solid rgba(255,255,255,0.04)">' + label + '</td>' +
      '<td style="padding:10px 12px;font-size:12px;color:rgba(255,255,255,0.4);text-align:right;font-family:' + MONO + ';border-bottom:1px solid rgba(255,255,255,0.04)">' + h(v1) + '</td>' +
      '<td style="padding:10px 12px;font-size:13px;color:' + clr + ';font-weight:800;text-align:right;font-family:' + MONO + ';border-bottom:1px solid rgba(255,255,255,0.04)">' + h(v3) + '</td>' +
      '<td style="padding:10px 12px;font-size:12px;color:rgba(255,255,255,0.4);text-align:right;font-family:' + MONO + ';border-bottom:1px solid rgba(255,255,255,0.04)">' + h(v5) + '</td>' +
      '</tr>';
  };

  // ── Econ row helper ──
  const eRow = (label, value, highlight) => {
    const bg = highlight ? "rgba(16,185,129,0.06)" : "transparent";
    const clr = highlight ? "#10B981" : "#E2E8F0";
    const sz = highlight ? "20px" : "14px";
    return '<tr style="background:' + bg + '">' +
      '<td style="padding:12px 16px;font-size:12px;color:rgba(255,255,255,' + (highlight ? '0.8' : '0.5') + ');font-weight:' + (highlight ? '700' : '500') + ';border-bottom:1px solid rgba(255,255,255,0.04)">' + label + '</td>' +
      '<td style="padding:12px 16px;font-size:' + sz + ';color:' + clr + ';font-weight:' + (highlight ? '900' : '700') + ';text-align:right;font-family:' + MONO + ';border-bottom:1px solid rgba(255,255,255,0.04);letter-spacing:-0.01em">' + value + '</td></tr>';
  };

  // ════════════════════════════════════════════════
  // ASSEMBLE EMAIL — dark header + light body (Outlook-safe)
  // ════════════════════════════════════════════════
  const emailBody = [
    '<div style="font-family:' + SANS + ';max-width:700px;margin:0 auto;border-radius:0;overflow:hidden;background:#FFFFFF">',

    // ══ DARK HERO HEADER ══
    '<table cellpadding="0" cellspacing="0" style="width:100%;background:#0A0F1E"><tr>' +
    '<td style="padding:12px 28px"><span style="font-size:10px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:0.22em">STORVEX</span></td>' +
    '<td style="padding:12px 28px;text-align:right"><span style="font-size:9px;color:#64748B;letter-spacing:0.08em">' + dateStr + '</span></td>' +
    '</tr></table>',

    // ══ VERDICT BANNER — high contrast, impossible to miss ══
    '<table cellpadding="0" cellspacing="0" style="width:100%;background:' + verdictColor + '"><tr>' +
    '<td style="padding:14px 28px"><span style="font-size:13px;font-weight:900;color:#FFFFFF;letter-spacing:0.08em">' + h(bannerText) + '</span></td>' +
    (yocStr ? '<td style="padding:14px 28px;text-align:right"><span style="font-size:10px;color:rgba(255,255,255,0.7);letter-spacing:0.08em">PROJECTED YOC </span><span style="font-size:20px;font-weight:900;color:#FFFFFF">' + yocStr + '</span></td>' : '') +
    '</tr></table>',

    // ══ SITE HEADER — dark ══
    '<div style="background:#0A0F1E;padding:24px 28px 20px">',
    '<div style="font-size:10px;font-weight:700;color:#C9A84C;text-transform:uppercase;letter-spacing:0.18em;margin-bottom:8px">SITE ACQUISITION RECOMMENDATION</div>',
    '<div style="font-size:28px;font-weight:900;color:#FFFFFF;letter-spacing:-0.02em;line-height:1.15">' + h(fe(site.address || site.name || "")) + '</div>',
    '<div style="font-size:13px;color:#94A3B8;margin-top:4px">' + h(site.city || "") + (site.city && site.state ? ", " : "") + h(site.state || "") + '</div>',
    // Action buttons — PROMINENT
    '<table cellpadding="0" cellspacing="0" style="margin-top:16px"><tr>',
    listingUrl ? '<td style="padding-right:8px"><a href="' + h(listingUrl) + '" style="display:inline-block;padding:10px 20px;background:#1E293B;border:1px solid #334155;border-radius:6px;color:#E2E8F0;font-size:12px;font-weight:700;text-decoration:none;letter-spacing:0.04em">View Listing</a></td>' : "",
    pinDrop ? '<td style="padding-right:8px"><a href="' + h(pinDrop) + '" style="display:inline-block;padding:10px 20px;background:#1E293B;border:1px solid #334155;border-radius:6px;color:#E2E8F0;font-size:12px;font-weight:700;text-decoration:none;letter-spacing:0.04em">Pin Drop</a></td>' : "",
    '<td><a href="' + h(dashLink) + '" style="display:inline-block;padding:10px 24px;background:#C9A84C;border-radius:6px;color:#0A0F1E;font-size:12px;font-weight:900;text-decoration:none;letter-spacing:0.04em">Open in Storvex</a></td>',
    '</tr></table>',
    '</div>',

    // ══ KPI BAR — dark, 4 columns ══
    '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#0F172A"><tr>',
    '<td style="padding:16px;text-align:center;width:25%;border-right:1px solid #1E293B"><div style="font-size:8px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.12em">ACREAGE</div><div style="font-size:20px;font-weight:900;color:#F1F5F9;margin-top:4px">' + (h(acreageRaw) || "-") + '</div></td>',
    '<td style="padding:16px;text-align:center;width:25%;border-right:1px solid #1E293B"><div style="font-size:8px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.12em">ASKING</div><div style="font-size:18px;font-weight:900;color:#F1F5F9;margin-top:4px">' + h(askClean) + '</div>' + (pricePerAc ? '<div style="font-size:10px;color:#64748B;margin-top:2px">' + pricePerAc + '/ac</div>' : '') + '</td>',
    '<td style="padding:16px;text-align:center;width:25%;border-right:1px solid #1E293B"><div style="font-size:8px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.12em">ZONING</div><div style="margin-top:6px">' + (zClass === "by-right" ? '<span style="background:#16A34A;color:#fff;padding:4px 12px;border-radius:4px;font-size:11px;font-weight:800">BY-RIGHT</span>' : zClass === "conditional" ? '<span style="background:#F59E0B;color:#fff;padding:4px 12px;border-radius:4px;font-size:11px;font-weight:800">CONDITIONAL</span>' : '<span style="background:#475569;color:#fff;padding:4px 12px;border-radius:4px;font-size:11px;font-weight:800">TBD</span>') + '</div></td>',
    '<td style="padding:16px;text-align:center;width:25%"><div style="font-size:8px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.12em">NEAREST PS</div><div style="font-size:20px;font-weight:900;color:#F1F5F9;margin-top:4px">' + (h(nearPS) || "-") + '</div></td>',
    '</tr></table>',

    // ══════════════════════════════════════
    // LIGHT BODY — white background, high contrast
    // ══════════════════════════════════════

    // ── GREETING ──
    '<div style="padding:24px 28px;background:#FFFFFF">',
    '<div style="font-size:14px;color:#1E293B;line-height:1.75">',
    recip.name !== "PS Team" ? h(recip.name) + ',<br><br>' : '',
    'Submitting a site for review' + (site.market ? ' in the ' + h(fe(site.market)) + ' corridor' : (site.city ? ' in ' + h(site.city) : '')) + '. ',
    'Key metrics below. Complete analysis, interactive mapping, and projected economics available on <a href="' + h(dashLink) + '" style="color:#C9A84C;font-weight:700;text-decoration:underline">Storvex</a>.',
    '</div></div>',

    // ── DEMOGRAPHICS TABLE — light ──
    '<div style="padding:0 28px 20px;background:#FFFFFF">',
    '<table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:6px"><tr>' +
    '<td><span style="font-size:10px;font-weight:800;color:#1E293B;text-transform:uppercase;letter-spacing:0.14em">DEMOGRAPHICS</span></td>' +
    '<td style="text-align:right"><span style="font-size:9px;color:#C9A84C;font-weight:700;letter-spacing:0.06em">ESRI PREMIUM 2025</span></td>' +
    '</tr></table>',
    '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden">',
    '<tr style="background:#0F172A">' +
    '<td style="padding:10px 14px;font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.1em"></td>' +
    '<td style="padding:10px 12px;font-size:9px;font-weight:700;color:#94A3B8;text-align:right;text-transform:uppercase;letter-spacing:0.1em">1-MI</td>' +
    '<td style="padding:10px 12px;font-size:9px;font-weight:800;color:#C9A84C;text-align:right;text-transform:uppercase;letter-spacing:0.1em">3-MI</td>' +
    '<td style="padding:10px 12px;font-size:9px;font-weight:700;color:#94A3B8;text-align:right;text-transform:uppercase;letter-spacing:0.1em">5-MI</td></tr>',
    // Light rows
    '<tr style="background:#FFFFFF"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #F1F5F9">Population</td><td style="padding:10px 12px;font-size:12px;color:#64748B;text-align:right;border-bottom:1px solid #F1F5F9">' + h(pop1) + '</td><td style="padding:10px 12px;font-size:13px;color:#0F172A;font-weight:900;text-align:right;border-bottom:1px solid #F1F5F9">' + h(pop3) + '</td><td style="padding:10px 12px;font-size:12px;color:#64748B;text-align:right;border-bottom:1px solid #F1F5F9">' + h(pop5) + '</td></tr>',
    '<tr style="background:#F8FAFC"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #F1F5F9">Growth (5yr CAGR)</td><td style="padding:10px 12px;font-size:12px;color:#64748B;text-align:right;border-bottom:1px solid #F1F5F9">-</td><td style="padding:10px 12px;font-size:13px;color:#16A34A;font-weight:900;text-align:right;border-bottom:1px solid #F1F5F9">' + h(growth ? "+" + String(growth).replace("+", "") : "-") + '</td><td style="padding:10px 12px;font-size:12px;color:#64748B;text-align:right;border-bottom:1px solid #F1F5F9">-</td></tr>',
    '<tr style="background:#FFFFFF"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #F1F5F9">Median HHI</td><td style="padding:10px 12px;font-size:12px;color:#64748B;text-align:right;border-bottom:1px solid #F1F5F9">' + h(hhi1) + '</td><td style="padding:10px 12px;font-size:13px;color:#0F172A;font-weight:900;text-align:right;border-bottom:1px solid #F1F5F9">' + h(hhi3) + '</td><td style="padding:10px 12px;font-size:12px;color:#64748B;text-align:right;border-bottom:1px solid #F1F5F9">' + h(hhi5) + '</td></tr>',
    '<tr style="background:#F8FAFC"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #F1F5F9">Households</td><td style="padding:10px 12px;font-size:12px;color:#64748B;text-align:right;border-bottom:1px solid #F1F5F9">' + h(hh1) + '</td><td style="padding:10px 12px;font-size:13px;color:#0F172A;font-weight:900;text-align:right;border-bottom:1px solid #F1F5F9">' + h(hh3) + '</td><td style="padding:10px 12px;font-size:12px;color:#64748B;text-align:right;border-bottom:1px solid #F1F5F9">' + h(hh5) + '</td></tr>',
    '<tr style="background:#FFFFFF"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #F1F5F9">Home Value</td><td style="padding:10px 12px;font-size:12px;color:#64748B;text-align:right;border-bottom:1px solid #F1F5F9">' + h(hv1) + '</td><td style="padding:10px 12px;font-size:13px;color:#0F172A;font-weight:900;text-align:right;border-bottom:1px solid #F1F5F9">' + h(hv3) + '</td><td style="padding:10px 12px;font-size:12px;color:#64748B;text-align:right;border-bottom:1px solid #F1F5F9">' + h(hv5) + '</td></tr>',
    renter ? '<tr style="background:#F8FAFC"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600">Renter %</td><td style="padding:10px 12px;font-size:12px;color:#64748B;text-align:right"></td><td style="padding:10px 12px;font-size:13px;color:#0F172A;font-weight:900;text-align:right">' + h(renter) + '</td><td style="padding:10px 12px;font-size:12px;color:#64748B;text-align:right"></td></tr>' : '',
    '</table></div>',

    // ── CC SPC — light card ──
    ccSPC ? '<div style="padding:0 28px 20px;background:#FFFFFF">' +
    '<table cellpadding="0" cellspacing="0" style="width:100%;border:2px solid ' + ccColor + ';border-radius:8px;overflow:hidden"><tr>' +
    '<td style="padding:16px 20px;background:' + ccColor + '08"><table cellpadding="0" cellspacing="0" style="width:100%"><tr>' +
    '<td><div style="font-size:9px;font-weight:800;color:' + ccColor + ';text-transform:uppercase;letter-spacing:0.12em">CC STORAGE PER CAPITA</div>' +
    '<div style="font-size:28px;font-weight:900;color:' + ccColor + ';margin-top:4px">' + ccSPC + ' <span style="font-size:12px;font-weight:600;color:#64748B">SF/capita</span></div>' +
    '<div style="font-size:11px;color:#475569;margin-top:2px;font-weight:600">' + ccLabel + '</div></td>' +
    (projCCSPC ? '<td style="text-align:right"><div style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.1em">5-YR PROJECTED</div>' +
    '<div style="font-size:22px;font-weight:800;color:#475569;margin-top:4px">' + projCCSPC + '</div></td>' : '') +
    '</tr></table>' +
    (site.competitorNames ? '<div style="margin-top:10px;padding-top:10px;border-top:1px solid #E2E8F0;font-size:11px;color:#64748B;line-height:1.5">' +
    (site.competingCCSF ? h(fe(site.competingCCSF)) + ' CC SF within 3 mi. ' : '') +
    'Competitors: ' + h(fe(site.competitorNames)) + '</div>' : '') +
    '</td></tr></table></div>' : '',

    // ── PROJECTED ECONOMICS — light table ──
    fin && fin.totalSF > 0 ? '<div style="padding:0 28px 20px;background:#FFFFFF">' +
    '<div style="font-size:10px;font-weight:800;color:#1E293B;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:8px">PROJECTED ECONOMICS</div>' +
    '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden">' +
    '<tr style="background:#F8FAFC"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #E2E8F0">Build Plate</td><td style="padding:10px 14px;font-size:13px;font-weight:800;color:#0F172A;text-align:right;border-bottom:1px solid #E2E8F0">~' + Math.round(fin.totalSF / 1000) + 'K SF / ' + (fin.stories > 1 ? fin.stories + "-story" : "1-story") + ' / ' + Math.round((fin.climatePct || 0.65) * 100) + '/' + Math.round((fin.drivePct || 0.35) * 100) + ' CC/DU</td></tr>' +
    '<tr><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #E2E8F0">Build Cost</td><td style="padding:10px 14px;font-size:13px;font-weight:800;color:#0F172A;text-align:right;border-bottom:1px solid #E2E8F0">' + $k(fin.totalDevCost || 0) + ' (' + $k(fin.totalHardPerSF || 0) + '/SF)</td></tr>' +
    '<tr style="background:#F8FAFC"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #E2E8F0">Total Investment</td><td style="padding:10px 14px;font-size:13px;font-weight:800;color:#0F172A;text-align:right;border-bottom:1px solid #E2E8F0">' + $k((fin.landCost || 0) + (fin.totalDevCost || 0)) + '</td></tr>' +
    '<tr><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #E2E8F0">Stabilized NOI (Yr 3)</td><td style="padding:10px 14px;font-size:13px;font-weight:800;color:#16A34A;text-align:right;border-bottom:1px solid #E2E8F0">' + $k(fin.stabNOI || 0) + '</td></tr>' +
    (fin.yocStab ? '<tr style="background:#F0FDF4"><td style="padding:12px 14px;font-size:13px;color:#15803D;font-weight:800">Projected YOC</td><td style="padding:12px 14px;font-size:22px;font-weight:900;color:#15803D;text-align:right">' + fin.yocStab + '%</td></tr>' : '') +
    (fin.landPrices && fin.landPrices[1] && fin.landPrices[1].maxLand > 0 ? '<tr style="background:#F8FAFC"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600">Recommended Offer</td><td style="padding:10px 14px;font-size:13px;font-weight:800;color:#0F172A;text-align:right">' + $k(fin.landPrices[1].maxLand) + (fin.landPrices[1].perAcre ? ' (' + $k(fin.landPrices[1].perAcre) + '/ac)' : '') + '</td></tr>' : '') +
    '</table></div>' : '',

    // ── WATCH ITEMS — light ──
    watches.length ? '<div style="padding:0 28px 20px;background:#FFFFFF">' +
    '<div style="padding:14px 18px;border-radius:8px;background:#FFFBEB;border:1px solid #FDE68A">' +
    '<div style="font-size:9px;font-weight:800;color:#92400E;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px">WATCH ITEMS</div>' +
    watches.map(function(w) { return '<div style="font-size:12px;color:#78350F;margin-bottom:3px;padding-left:10px;border-left:2px solid #F59E0B">' + w + '</div>'; }).join("") +
    '</div></div>' : '',

    // ── VERDICT — light card with dark accent ──
    '<div style="padding:0 28px 24px;background:#FFFFFF">',
    '<div style="padding:18px 22px;border-radius:8px;background:#0F172A;border-left:4px solid #C9A84C">',
    '<div style="font-size:9px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:0.16em;margin-bottom:8px">STORVEX VERDICT</div>',
    verdict ? '<div style="font-size:14px;color:#E2E8F0;font-weight:600;line-height:1.7">' + h(verdict + ". " + (verdict === "STRONG BUY" || verdict === "BUY" ? "Strong fundamentals, margin in the land." : verdict === "NEGOTIATE" ? "Fundamentals support - price needs work." : "Good site, asking above strike.")) + '</div>' : '',
    '</div></div>',

    // ══ MINIMAL FOOTER — clean close, no signature ══
    '<div style="background:#0A0F1E;padding:16px 28px;border-top:2px solid #C9A84C">',
    '<table cellpadding="0" cellspacing="0" style="width:100%"><tr>',
    '<td><span style="font-size:9px;color:#475569;letter-spacing:0.1em">STORVEX</span></td>',
    '<td style="text-align:right"><span style="font-size:9px;color:#334155">' + dateStr + '</span></td>',
    '</tr></table>',
    '</div>',

    '</div>',
  ].join("");

  // ── Preview page ──
  const previewHTML = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">'
    + '<title>Storvex - ' + h(siteName) + '</title>'
    + '<style>'
    + "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Fira+Code:wght@400;500;600;700&display=swap');"
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + "body{font-family:'Inter',system-ui,sans-serif;background:#080C18;padding:40px 20px;min-height:100vh}"
    + '@media print{body{background:#fff;padding:0}.no-print{display:none!important}.page{box-shadow:none!important}}'
    + '.page{max-width:740px;margin:0 auto;border-radius:16px;overflow:hidden;box-shadow:0 8px 60px rgba(0,0,0,0.5)}'
    + '.toolbar{max-width:740px;margin:0 auto 20px;display:flex;gap:10px;justify-content:flex-end}'
    + '.toolbar button{padding:10px 20px;border-radius:10px;border:none;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:0.06em;text-transform:uppercase;transition:all 0.2s}'
    + '.toolbar button:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(0,0,0,0.3)}'
    + '</style></head><body>'
    + '<div class="toolbar no-print">'
    + '<button onclick="window.print()" style="background:#1E293B;color:#C9A84C;border:1px solid rgba(201,168,76,0.2)">Print / PDF</button>'
    + '<button id="copyBtn" onclick="copyEmail()" style="background:linear-gradient(135deg,#C9A84C,#E8B84A);color:#0A0F1E">Copy for Gmail</button>'
    + '</div>'
    + '<div class="page">' + emailBody + '</div>'
    + '<script>'
    + 'function copyEmail(){'
    + "var el=document.querySelector('.page');"
    + "var b=document.getElementById('copyBtn');"
    + 'try{'
    + "var blob=new Blob([el.innerHTML],{type:'text/html'});"
    + "var text=new Blob([el.innerText],{type:'text/plain'});"
    + "navigator.clipboard.write([new ClipboardItem({'text/html':blob,'text/plain':text})]).then(function(){"
    + "b.textContent='\\u2713 Copied!';b.style.background='#10B981';b.style.color='#fff';"
    + "setTimeout(function(){b.textContent='Copy for Gmail';b.style.background='linear-gradient(135deg,#C9A84C,#E8B84A)';b.style.color='#0A0F1E';},2500);"
    + '}).catch(function(){fallbackCopy(el,b)});'
    + '}catch(e){fallbackCopy(el,b)}'
    + '}'
    + 'function fallbackCopy(el,b){'
    + 'var r=document.createRange();r.selectNodeContents(el);'
    + 'var s=window.getSelection();s.removeAllRanges();s.addRange(r);'
    + "try{document.execCommand('copy');"
    + "b.textContent='\\u2713 Copied! (Ctrl+V to paste)';b.style.background='#10B981';b.style.color='#fff';"
    + "}catch(e2){b.textContent='Select All + Copy manually';b.style.background='#F59E0B';b.style.color='#000';}"
    + "setTimeout(function(){s.removeAllRanges();b.textContent='Copy for Gmail';b.style.background='linear-gradient(135deg,#C9A84C,#E8B84A)';b.style.color='#0A0F1E';},3000);"
    + '}'
    + '</script></body></html>';

  return { previewHTML, emailBody, subject, toEmails, listingWarning, recipient: recip.name };
};
