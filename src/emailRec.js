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

  const acreageRaw = fe(site.acreage || "");
  const pricePerAc = fin && fin.landCost > 0 && fin.acres > 0 ? $k(Math.round(fin.landCost / fin.acres)) : null;

  const siteName = fe(site.name || site.address || site.id);
  const cityState = ((site.city || "") + " " + (site.state || "")).trim();
  const subjectSite = siteName.toLowerCase().includes((site.city || "").toLowerCase()) ? siteName : cityState + ", " + siteName;
  const subject = "Site Recommendation \u2014 " + subjectSite + (ccSPC ? " | CC SPC " + ccSPC : "") + (zClass === "by-right" ? ", By-Right" : "");

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
  // ASSEMBLE EMAIL — full dark-mode institutional
  // ════════════════════════════════════════════════
  const emailBody = [
    '<div style="font-family:' + SANS + ';max-width:700px;margin:0 auto;border-radius:16px;overflow:hidden;background:' + NAVY + '">',

    // ── MASTHEAD ──
    '<table cellpadding="0" cellspacing="0" style="width:100%;background:' + NAVY + '"><tr>' +
    '<td style="padding:14px 28px"><table cellpadding="0" cellspacing="0"><tr>' +
    '<td style="padding-right:8px"><div style="width:7px;height:7px;background:#10B981;border-radius:50%;box-shadow:0 0 8px rgba(16,185,129,0.5)"></div></td>' +
    '<td><span style="font-size:10px;font-weight:800;color:rgba(255,255,255,0.25);text-transform:uppercase;letter-spacing:0.22em;font-family:' + MONO + '">STORVEX\u2122</span></td>' +
    '</tr></table></td>' +
    '<td style="padding:14px 28px;text-align:right"><span style="font-size:9px;color:rgba(255,255,255,0.2);font-family:' + MONO + ';letter-spacing:0.1em">' + dateStr.toUpperCase() + '</span></td>' +
    '</tr></table>',

    // ── HERO ──
    '<div style="padding:8px 28px 28px;background:linear-gradient(180deg,' + NAVY + ' 0%,#0D1229 100%)">',
    // Location
    '<div style="font-size:12px;font-weight:600;color:' + GOLD + ';text-transform:uppercase;letter-spacing:0.2em;font-family:' + MONO + ';margin-bottom:10px">SITE ACQUISITION RECOMMENDATION</div>',
    '<div style="font-size:34px;font-weight:900;color:#FFFFFF;letter-spacing:-0.03em;line-height:1.1">' + h(fe(site.address || site.name || "")) + '</div>',
    '<div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:6px;letter-spacing:0.02em">' + h(site.city || "") + (site.city && site.state ? ", " : "") + h(site.state || "") + (site.zip ? " " + h(site.zip) : "") + '</div>',

    // Big verdict + YOC
    '<table cellpadding="0" cellspacing="0" style="width:100%;margin-top:24px"><tr>',
    // Left: verdict pill
    '<td style="vertical-align:middle">' +
    '<div style="display:inline-block;padding:8px 20px;background:' + verdictColor + '18;border:1px solid ' + verdictColor + '40;border-radius:100px">' +
    '<span style="font-size:12px;font-weight:900;color:' + verdictColor + ';letter-spacing:0.06em;font-family:' + MONO + '">' + h(bannerText) + '</span></div>' +
    '</td>',
    // Right: YOC hero number
    yocStr ? '<td style="text-align:right;vertical-align:middle">' +
    '<div style="font-size:8px;font-weight:700;color:rgba(255,255,255,0.25);text-transform:uppercase;letter-spacing:0.18em;font-family:' + MONO + ';margin-bottom:4px">PROJECTED YOC</div>' +
    '<div style="font-size:42px;font-weight:900;color:#10B981;font-family:' + MONO + ';letter-spacing:-0.03em;line-height:1">' + yocStr + '</div>' +
    '</td>' : '',
    '</tr></table>',

    // Action links
    '<table cellpadding="0" cellspacing="0" style="margin-top:20px"><tr>',
    listingUrl ? '<td style="padding-right:6px"><a href="' + h(listingUrl) + '" style="display:inline-block;padding:7px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.4);font-size:10px;font-weight:600;text-decoration:none;letter-spacing:0.08em;font-family:' + MONO + '">Listing \u2197</a></td>' : "",
    pinDrop ? '<td style="padding-right:6px"><a href="' + h(pinDrop) + '" style="display:inline-block;padding:7px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:rgba(255,255,255,0.4);font-size:10px;font-weight:600;text-decoration:none;letter-spacing:0.08em;font-family:' + MONO + '">Pin Drop \u2197</a></td>' : "",
    '<td><a href="' + h(dashLink) + '" style="display:inline-block;padding:7px 18px;background:linear-gradient(135deg,' + GOLD + ',' + GOLD + 'cc);border-radius:8px;color:' + NAVY + ';font-size:10px;font-weight:900;text-decoration:none;letter-spacing:0.08em;font-family:' + MONO + '">Full Analysis \u2192</a></td>',
    '</tr></table>',
    '</div>',

    // ── KPI BAR ──
    '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#0D1229;border-top:1px solid rgba(255,255,255,0.04);border-bottom:1px solid rgba(255,255,255,0.04)"><tr>',
    kpi("ACREAGE", h(acreageRaw) || "\u2014", ""),
    kpi("ASKING", h(fe(site.askingPrice || "TBD")), pricePerAc ? pricePerAc + "/ac" : ""),
    kpi("ZONING", zClass === "by-right" ? pill("BY-RIGHT", "#10B98120", "#10B981") : zClass === "conditional" ? pill("CONDITIONAL", "#F59E0B20", "#F59E0B") : pill("TBD", "rgba(255,255,255,0.06)", "#64748B"), ""),
    kpi("NEAREST PS", h(nearPS) || "\u2014", ""),
    '</tr></table>',

    // ── STATUS BADGES ── (water + zoning + competition in one row)
    '<table cellpadding="0" cellspacing="0" style="width:100%;background:#0D1229;padding:0"><tr>',
    '<td style="padding:14px 28px">' +
    (hookup ? pill(hookup.toUpperCase().replace("-", " "), waterColor + "18", waterColor) + '&nbsp;&nbsp;' : '') +
    (zoningNote ? '<span style="font-size:11px;color:rgba(255,255,255,0.35)">' + zoningNote + '</span>' : '') +
    '</td></tr></table>',

    // ── DEMOGRAPHICS — dark table, 1-3-5 mile ──
    '<div style="padding:24px 28px 0;background:' + SLATE + '">',
    '<table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:6px"><tr>' +
    '<td><span style="font-size:10px;font-weight:800;color:rgba(255,255,255,0.2);text-transform:uppercase;letter-spacing:0.18em;font-family:' + MONO + '">DEMOGRAPHICS</span></td>' +
    '<td style="text-align:right"><span style="font-size:9px;color:rgba(201,168,76,0.5);font-family:' + MONO + ';letter-spacing:0.08em">ESRI PREMIUM 2025</span></td>' +
    '</tr></table>',
    '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04)">',
    // Header
    '<tr style="background:rgba(255,255,255,0.02)">' +
    '<td style="padding:10px 16px;font-size:9px;font-weight:700;color:rgba(255,255,255,0.2);text-transform:uppercase;letter-spacing:0.14em;font-family:' + MONO + '"></td>' +
    '<td style="padding:10px 12px;font-size:9px;font-weight:700;color:rgba(255,255,255,0.2);text-align:right;text-transform:uppercase;letter-spacing:0.14em;font-family:' + MONO + '">1-MI</td>' +
    '<td style="padding:10px 12px;font-size:9px;font-weight:800;color:' + GOLD + ';text-align:right;text-transform:uppercase;letter-spacing:0.14em;font-family:' + MONO + '">3-MI</td>' +
    '<td style="padding:10px 12px;font-size:9px;font-weight:700;color:rgba(255,255,255,0.2);text-align:right;text-transform:uppercase;letter-spacing:0.14em;font-family:' + MONO + '">5-MI</td></tr>',
    dRow("Population", pop1, pop3, pop5, {}),
    dRow("Growth (5yr CAGR)", h(growth ? "+" + String(growth).replace("+", "") : "\u2014"), h(growth ? "+" + String(growth).replace("+", "") : "\u2014"), h(growth ? "+" + String(growth).replace("+", "") : "\u2014"), { color: "#10B981" }),
    dRow("Median HHI", hhi1, hhi3, hhi5, {}),
    dRow("Households", hh1, hh3, hh5, {}),
    dRow("Home Value", hv1, hv3, hv5, {}),
    dRow("Renter %", "", renter, "", {}),
    '</table></div>',

    // ── CC SPC ANALYSIS ──
    ccSPC ? '<div style="padding:20px 28px;background:' + SLATE + '">' +
    '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden;background:' + ccColor + '08;border:1px solid ' + ccColor + '20">' +
    '<tr><td style="padding:16px 20px">' +
    '<table cellpadding="0" cellspacing="0" style="width:100%"><tr>' +
    '<td><div style="font-size:8px;font-weight:700;color:' + ccColor + ';text-transform:uppercase;letter-spacing:0.16em;font-family:' + MONO + ';opacity:0.7">CC STORAGE PER CAPITA</div>' +
    '<div style="font-size:32px;font-weight:900;color:' + ccColor + ';font-family:' + MONO + ';letter-spacing:-0.02em;margin-top:4px">' + ccSPC + ' <span style="font-size:14px;font-weight:600;opacity:0.6">SF/capita</span></div>' +
    '<div style="font-size:11px;color:' + ccColor + ';opacity:0.7;margin-top:4px;font-weight:600">' + ccLabel + '</div></td>' +
    (projCCSPC ? '<td style="text-align:right"><div style="font-size:8px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.14em;font-family:' + MONO + '">5-YR PROJECTED</div>' +
    '<div style="font-size:24px;font-weight:800;color:rgba(255,255,255,0.5);font-family:' + MONO + ';margin-top:4px">' + projCCSPC + '</div></td>' : '') +
    '</tr></table>' +
    (site.competitorNames ? '<div style="margin-top:12px;padding-top:12px;border-top:1px solid ' + ccColor + '15;font-size:11px;color:rgba(255,255,255,0.3);line-height:1.5">' +
    (site.competingCCSF ? h(fe(site.competingCCSF)) + ' CC SF within 3 mi. ' : '') +
    'Competitors: ' + h(fe(site.competitorNames)) + '</div>' : '') +
    '</td></tr></table></div>' : '',

    // ── PROJECTED ECONOMICS ──
    fin && fin.totalSF > 0 ? '<div style="padding:0 28px 24px;background:' + SLATE + '">' +
    '<div style="font-size:10px;font-weight:800;color:rgba(255,255,255,0.2);text-transform:uppercase;letter-spacing:0.18em;font-family:' + MONO + ';margin-bottom:10px">PROJECTED ECONOMICS</div>' +
    '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04)">' +
    eRow("Build Plate", "~" + Math.round(fin.totalSF / 1000) + "K SF \u00B7 " + (fin.stories > 1 ? fin.stories + "-story" : "1-story") + " \u00B7 " + Math.round((fin.climatePct || 0.65) * 100) + "/" + Math.round((fin.drivePct || 0.35) * 100) + " CC/DU", false) +
    eRow("Build Cost", $k(fin.totalDevCost || 0) + " (" + $k(fin.totalHardPerSF || 0) + "/SF)", false) +
    eRow("Total Investment", $k((fin.landCost || 0) + (fin.totalDevCost || 0)), false) +
    eRow("Stabilized NOI (Yr 3)", $k(fin.stabNOI || 0), false) +
    (fin.yocStab ? eRow("Projected YOC", fin.yocStab + "%", true) : "") +
    (fin.landPrices && fin.landPrices[1] && fin.landPrices[1].maxLand > 0 ? eRow("Recommended Offer", $k(fin.landPrices[1].maxLand) + (fin.landPrices[1].perAcre ? " (" + $k(fin.landPrices[1].perAcre) + "/ac)" : ""), false) : "") +
    '</table></div>' : '',

    // ── WATCH ITEMS ──
    watches.length ? '<div style="padding:0 28px 20px;background:' + SLATE + '">' +
    '<div style="padding:14px 18px;border-radius:10px;background:rgba(245,158,11,0.04);border:1px solid rgba(245,158,11,0.1)">' +
    '<div style="font-size:9px;font-weight:700;color:#F59E0B;text-transform:uppercase;letter-spacing:0.14em;font-family:' + MONO + ';margin-bottom:8px;opacity:0.7">WATCH ITEMS</div>' +
    watches.map(function(w) { return '<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:4px;padding-left:12px;border-left:2px solid rgba(245,158,11,0.3)">' + w + '</div>'; }).join("") +
    '</div></div>' : '',

    // ── VERDICT ──
    '<div style="padding:0 28px 28px;background:' + SLATE + '">',
    '<div style="padding:20px 24px;border-radius:12px;background:linear-gradient(135deg,rgba(201,168,76,0.06),rgba(201,168,76,0.02));border:1px solid rgba(201,168,76,0.12)">',
    '<div style="font-size:9px;font-weight:800;color:' + GOLD + ';text-transform:uppercase;letter-spacing:0.18em;font-family:' + MONO + ';margin-bottom:10px;opacity:0.6">STORVEX\u2122 VERDICT</div>',
    verdict ? '<div style="font-size:14px;color:rgba(255,255,255,0.7);font-weight:600;line-height:1.7">' + h(verdict + ". " + (verdict === "STRONG BUY" || verdict === "BUY" ? "Strong fundamentals, margin in the land." : verdict === "NEGOTIATE" ? "Fundamentals support \u2014 price needs work." : "Good site, asking above strike.")) + '</div>' : '',
    '</div></div>',

    // ── SIGNATURE — premium institutional ──
    '<div style="background:linear-gradient(180deg,#080C18 0%,' + NAVY + ' 100%);padding:32px 28px 28px;border-top:1px solid rgba(201,168,76,0.08)">',
    // Gold accent line
    '<div style="height:2px;background:linear-gradient(90deg,' + GOLD + ',' + GOLD + '60,transparent);width:80px;margin-bottom:20px"></div>',
    '<div style="font-size:13px;color:rgba(255,255,255,0.25);margin-bottom:16px;letter-spacing:0.02em">Best regards,</div>',
    // Name — large, commanding
    '<div style="font-size:24px;font-weight:900;color:#F8FAFC;letter-spacing:-0.02em;margin-bottom:4px">Daniel P. Roscoe</div>',
    // Title with Storvex gold
    '<div style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.4);letter-spacing:0.06em;margin-bottom:16px">Owner <span style="color:rgba(255,255,255,0.15)">\u2022</span> <span style="color:' + GOLD + ';font-weight:800">Storvex\u2122</span></div>',
    // Contact row — email link + phone
    '<table cellpadding="0" cellspacing="0" style="margin-bottom:20px"><tr>',
    '<td style="padding-right:16px"><a href="mailto:Droscoe@DJRrealestate.com" style="font-size:12px;color:' + GOLD + ';text-decoration:none;font-weight:600;font-family:' + MONO + ';letter-spacing:0.02em;border-bottom:1px solid ' + GOLD + '30">Droscoe@DJRrealestate.com</a></td>',
    '<td><span style="font-size:12px;color:rgba(255,255,255,0.3);font-family:' + MONO + '">312-805-5996</span></td>',
    '</tr></table>',
    // AI tagline with pulse dot
    '<div style="padding-top:16px;border-top:1px solid rgba(255,255,255,0.03)">',
    '<table cellpadding="0" cellspacing="0"><tr>',
    '<td style="padding-right:8px;vertical-align:middle"><div style="width:6px;height:6px;background:#10B981;border-radius:50%;box-shadow:0 0 8px rgba(16,185,129,0.4)"></div></td>',
    '<td style="vertical-align:middle"><span style="font-size:9px;color:rgba(255,255,255,0.15);text-transform:uppercase;letter-spacing:0.22em;font-family:' + MONO + '">Generated by state-of-the-art AI review at Storvex\u2122</span></td>',
    '</tr></table>',
    '</div></div>',

    '</div>',
  ].join("");

  // ── Preview page ──
  const previewHTML = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">'
    + '<title>Storvex\u2122 \u2014 ' + h(siteName) + '</title>'
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
    + "var blob=new Blob([el.innerHTML],{type:'text/html'});"
    + "var text=new Blob([el.innerText],{type:'text/plain'});"
    + "navigator.clipboard.write([new ClipboardItem({'text/html':blob,'text/plain':text})]).then(function(){"
    + "var b=document.getElementById('copyBtn');b.textContent='Copied!';b.style.background='#10B981';b.style.color='#fff';"
    + "setTimeout(function(){b.textContent='Copy for Gmail';b.style.background='linear-gradient(135deg,#C9A84C,#E8B84A)';b.style.color='#0A0F1E';},2000);"
    + '}).catch(function(){'
    + 'var r=document.createRange();r.selectNodeContents(el);var s=window.getSelection();s.removeAllRanges();s.addRange(r);'
    + "document.execCommand('copy');s.removeAllRanges();"
    + "var b=document.getElementById('copyBtn');b.textContent='Copied!';b.style.background='#10B981';"
    + "setTimeout(function(){b.textContent='Copy for Gmail';b.style.background='linear-gradient(135deg,#C9A84C,#E8B84A)';},2000);"
    + '});}'
    + '</script></body></html>';

  return { previewHTML, emailBody, subject, toEmails, listingWarning, recipient: recip.name };
};
