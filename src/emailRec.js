// ─── Email Recommendation HTML Generator v3.0 ───
// Premium institutional AI aesthetic — Storvex™
// Returns { previewHTML, emailBody, subject, toEmails, listingWarning, recipient }

import { escapeHtml, fixEncoding } from './utils';
import { computeSiteFinancials, computeOptimalLayout } from './scoring';

const REC_RECIPIENTS = {
  east: { name: "Matt", email: "mtoussaint@publicstorage.com" },
  southwest: { name: "Dan", email: "dwollent@publicstorage.com" },
  queue: { name: "PS Team", email: "" },
};

export const generateRecEmailHTML = (site, regionKey, valuationOverrides, dualStrategiesOverride) => {
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

  // ── Optimal Layout Analysis ──
  let layout = dualStrategiesOverride || null;
  if (!layout) { try { layout = computeOptimalLayout(site, valuationOverrides || {}, site.overrides || {}); } catch { /* skip */ } }

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

    // ══ EXECUTIVE BANNER — one paragraph tells the whole story ══
    (() => {
      // Build the recommendation offer string
      // When strike is unachievable (recOffer=0), fall back to asking price — "at ask" is the recommendation
      const askAmt = fin ? fin.landCost : 0;
      const rawRecOffer = layout ? layout.recOffer : (fin && fin.landPrices && fin.landPrices[1] ? (fin.landCost > 0 && fin.landPrices[1].maxLand > fin.landCost && !site.offerAboveAskReason ? fin.landCost : fin.landPrices[1].maxLand) : 0);
      const recOfferAmt = rawRecOffer > 0 ? rawRecOffer : (askAmt > 0 ? askAmt : 0);
      const recOfferAcStr = recOfferAmt > 0 && fin && fin.acres > 0 ? $k(Math.round(recOfferAmt / fin.acres)) + "/ac" : (layout && layout.recOfferPerAc > 0 ? $k(layout.recOfferPerAc) + "/ac" : "");
      // Plate and build info
      const plateSF = layout ? layout.totalSF : (fin ? fin.totalSF : 0);
      const plateStr = plateSF > 0 ? Math.round(plateSF / 1000) + "K SF" : "";
      const storiesStr = layout ? layout.productType : (fin && fin.stories > 1 ? fin.stories + "-story" : "1-story");
      const totalCostAmt = layout ? layout.totalInvestment : (fin ? fin.totalDevCost : 0);
      const yocVal = layout ? layout.yoc : (fin ? fin.yocStab : "");
      // Zoning justification — cite FAR, setbacks, coverage if available
      const zoningCites = [];
      if (site.zoningUseTerm) zoningCites.push('"' + fe(site.zoningUseTerm) + '"');
      if (site.zoningOrdinanceSection) zoningCites.push(fe(site.zoningOrdinanceSection));
      if (site.setbackReqs) zoningCites.push(fe(site.setbackReqs));
      if (site.heightLimit) zoningCites.push("height: " + fe(site.heightLimit));
      if (site.imperviousCover) zoningCites.push("coverage: " + fe(site.imperviousCover));
      if (site.facadeReqs) zoningCites.push(fe(site.facadeReqs));
      const zoningCiteStr = zoningCites.length > 0 ? zoningCites.join(", ") : (zClass === "by-right" ? "by-right, no SUP required" : zClass === "conditional" ? "conditional use — SUP required" : "zoning verification pending");
      // Pad acreage recommendation
      const totalAc = layout ? layout.totalAcres : (fin ? fin.acres : parseFloat(acreageRaw) || 0);
      const padAc = layout ? layout.padAcres : totalAc;
      const excessAc = layout ? layout.excessAcres : 0;
      const padStr = excessAc > 0
        ? "The full site is " + totalAc + " acres and we recommend taking the front " + padAc + " ac, with " + excessAc + " ac excess marketable separately."
        : "The full site is " + totalAc + " acres and we are taking the full " + totalAc + " ac.";

      return '<div style="background:#0A0F1E;padding:28px">' +
        // Top line: STORVEX + date
        '<table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px"><tr>' +
        '<td><span style="font-size:10px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:0.22em">STORVEX</span></td>' +
        '<td style="text-align:right"><span style="font-size:9px;color:#64748B;letter-spacing:0.08em">' + dateStr + '</span></td>' +
        '</tr></table>' +
        // Verdict pill
        '<div style="margin-bottom:14px">' +
        '<span style="display:inline-block;padding:6px 18px;border-radius:100px;background:' + verdictColor + ';color:#FFFFFF;font-size:12px;font-weight:900;letter-spacing:0.08em">' + h(verdict || bannerText) + '</span>' +
        (yocStr ? '<span style="margin-left:12px;font-size:22px;font-weight:900;color:#FFFFFF;font-family:' + MONO + '">' + yocStr + ' <span style="font-size:10px;font-weight:600;color:#94A3B8">YOC</span></span>' : '') +
        '</div>' +
        // Site address — large
        '<div style="font-size:28px;font-weight:900;color:#FFFFFF;letter-spacing:-0.02em;line-height:1.15;margin-bottom:4px">' + h(fe(site.address || site.name || "")) + '</div>' +
        '<div style="font-size:13px;color:#64748B;margin-bottom:20px">' + h(site.city || "") + (site.city && site.state ? ", " : "") + h(site.state || "") + '</div>' +
        // ══ THE EXECUTIVE PARAGRAPH — the whole story ══
        '<div style="padding:20px 24px;border-radius:8px;background:rgba(255,255,255,0.04);border-left:4px solid #C9A84C;margin-bottom:20px">' +
        '<div style="font-size:14px;color:#E2E8F0;line-height:1.85;font-weight:500">' +
        '<strong style="color:#C9A84C">Storvex recommends offering ' + (recOfferAmt > 0 ? $k(recOfferAmt) : "TBD") + '</strong>' +
        (recOfferAcStr ? ' (' + recOfferAcStr + ')' : '') +
        (askAmt > 0 ? ' versus the asking price of ' + $k(askAmt) + '.' : '.') +
        ' The offer is justified by ' + zoningCiteStr +
        (plateStr ? ', allowing for a <strong style="color:#FFFFFF">' + plateStr + ' ' + storiesStr + '</strong> plate' : '') +
        (totalCostAmt > 0 ? ' with a total development cost of <strong style="color:#FFFFFF">' + $k(totalCostAmt) + '</strong>' : '') +
        (yocVal && yocVal !== "N/A" ? ' and projected <strong style="color:#10B981">' + yocVal + '% YOC</strong>.' : '.') +
        ' ' + padStr +
        '</div></div>' +
        // Action buttons — clean row
        '<table cellpadding="0" cellspacing="0"><tr>' +
        (listingUrl ? '<td style="padding-right:8px"><a href="' + h(listingUrl) + '" style="display:inline-block;padding:10px 20px;background:#2563EB;border-radius:6px;color:#FFFFFF;font-size:11px;font-weight:800;text-decoration:none;letter-spacing:0.04em">View Listing</a></td>' : "") +
        (pinDrop ? '<td style="padding-right:8px"><a href="' + h(pinDrop) + '" style="display:inline-block;padding:10px 20px;background:#10B981;border-radius:6px;color:#FFFFFF;font-size:11px;font-weight:800;text-decoration:none;letter-spacing:0.04em">Pin Drop</a></td>' : "") +
        '<td><a href="' + h(dashLink) + '" style="display:inline-block;padding:10px 24px;background:#C9A84C;border-radius:6px;color:#0A0F1E;font-size:11px;font-weight:900;text-decoration:none;letter-spacing:0.04em">Open in Storvex</a></td>' +
        '</tr></table>' +
        '</div>';
    })(),

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

    // ── RECOMMENDED LAYOUT — single best layout with pad position ──
    layout ? (() => {
      const lRow = (label, value, highlight) => {
        const c = highlight ? "#15803D" : "#0F172A";
        const w = highlight ? "900" : "700";
        const sz = highlight ? "15px" : "12px";
        const rbg = highlight ? "#F0FDF4" : "transparent";
        return '<tr style="background:' + rbg + '"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #F1F5F9">' + label + '</td>' +
          '<td style="padding:10px 14px;font-size:' + sz + ';color:' + c + ';font-weight:' + w + ';text-align:right;border-bottom:1px solid #F1F5F9;font-family:' + MONO + '">' + value + '</td></tr>';
      };
      const recOfferStr = layout.recOffer > 0
        ? $k(layout.recOffer) + (layout.recOfferPerAc > 0 ? " (" + $k(layout.recOfferPerAc) + "/ac)" : "") + (layout.recOfferCapped ? ' \u2713 at ask' : '')
        : "TBD";

      return '<div style="padding:0 28px 20px;background:#FFFFFF">' +
        '<table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:8px"><tr>' +
        '<td><span style="font-size:10px;font-weight:800;color:#1E293B;text-transform:uppercase;letter-spacing:0.14em">RECOMMENDED LAYOUT</span></td>' +
        '<td style="text-align:right"><span style="font-size:9px;color:#C9A84C;font-weight:700;letter-spacing:0.06em">' + h(layout.productType) + ' \u2022 ' + layout.ccDuSplit + ' CC/DU</span></td>' +
        '</tr></table>' +
        '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:2px solid #C9A84C;border-radius:8px;overflow:hidden">' +
        lRow("Pad Acreage", layout.padAcres + " ac of " + layout.totalAcres + " ac total") +
        (layout.excessAcres > 0 ? lRow("Excess Land", layout.excessAcres + " ac (marketable)") : '') +
        lRow("Pad Land Cost", $k(layout.padLandCost)) +
        lRow("Build Plate", "~" + Math.round(layout.totalSF / 1000) + "K SF") +
        lRow("Build Cost", $k(layout.buildCost)) +
        lRow("Total Investment", $k(layout.totalInvestment)) +
        lRow("CC Rent", "$" + layout.mktClimateRate.toFixed(2) + "/SF/mo") +
        lRow("Stabilized NOI", $k(layout.stabNOI)) +
        lRow("Projected YOC", layout.yoc + "%", true) +
        lRow("Recommended Offer", recOfferStr) +
        '</table>' +
        (layout.padPosition ? '<div style="margin-top:10px;padding:12px 16px;border-radius:6px;background:#F8FAFC;border-left:3px solid #C9A84C">' +
        '<div style="font-size:9px;font-weight:700;color:#C9A84C;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px">PAD POSITION</div>' +
        '<div style="font-size:12px;color:#334155;line-height:1.6">' + h(layout.padPosition) + '</div></div>' : '') +
        '</div>';
    })() : '',

    // ── PROJECTED ECONOMICS — light table ──
    fin && fin.totalSF > 0 ? '<div style="padding:0 28px 20px;background:#FFFFFF">' +
    '<div style="font-size:10px;font-weight:800;color:#1E293B;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:8px">PROJECTED ECONOMICS</div>' +
    '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden">' +
    '<tr style="background:#F8FAFC"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #E2E8F0">Build Plate</td><td style="padding:10px 14px;font-size:13px;font-weight:800;color:#0F172A;text-align:right;border-bottom:1px solid #E2E8F0">~' + Math.round(fin.totalSF / 1000) + 'K SF / ' + (fin.stories > 1 ? fin.stories + "-story" : "1-story") + ' / ' + Math.round((fin.climatePct || 0.65) * 100) + '/' + Math.round((fin.drivePct || 0.35) * 100) + ' CC/DU</td></tr>' +
    '<tr><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #E2E8F0">Build Cost</td><td style="padding:10px 14px;font-size:13px;font-weight:800;color:#0F172A;text-align:right;border-bottom:1px solid #E2E8F0">' + $k(fin.totalDevCost || 0) + ' (' + $k(fin.totalHardPerSF || 0) + '/SF)</td></tr>' +
    '<tr style="background:#F8FAFC"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #E2E8F0">Total Investment</td><td style="padding:10px 14px;font-size:13px;font-weight:800;color:#0F172A;text-align:right;border-bottom:1px solid #E2E8F0">' + $k((fin.landCost || 0) + (fin.totalDevCost || 0)) + '</td></tr>' +
    '<tr><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600;border-bottom:1px solid #E2E8F0">Stabilized NOI (Yr 3)</td><td style="padding:10px 14px;font-size:13px;font-weight:800;color:#16A34A;text-align:right;border-bottom:1px solid #E2E8F0">' + $k(fin.stabNOI || 0) + '</td></tr>' +
    (fin.yocStab ? '<tr style="background:#F0FDF4"><td style="padding:12px 14px;font-size:13px;color:#15803D;font-weight:800">Projected YOC</td><td style="padding:12px 14px;font-size:22px;font-weight:900;color:#15803D;text-align:right">' + fin.yocStab + '%</td></tr>' : '') +
    (fin.landPrices && fin.landPrices[1] && fin.landPrices[1].maxLand > 0 ? (() => {
      // HARD RULE: Never recommend offering above asking price unless offerAboveAskReason is set
      const strikeMax = fin.landPrices[1].maxLand;
      const askLand = fin.landCost || 0;
      const hasOverride = !!(site.offerAboveAskReason);
      const cappedOffer = (!hasOverride && askLand > 0 && strikeMax > askLand) ? askLand : strikeMax;
      const cappedPerAc = fin.acres > 0 ? Math.round(cappedOffer / fin.acres) : 0;
      const wasAbove = (!hasOverride && askLand > 0 && strikeMax > askLand);
      return '<tr style="background:#F8FAFC"><td style="padding:10px 14px;font-size:12px;color:#475569;font-weight:600">Recommended Offer</td><td style="padding:10px 14px;font-size:13px;font-weight:800;color:#0F172A;text-align:right">' + $k(cappedOffer) + (cappedPerAc ? ' (' + $k(cappedPerAc) + '/ac)' : '') + (wasAbove ? ' <span style="color:#16A34A;font-size:10px">\u2713 at ask</span>' : '') + '</td></tr>';
    })() : '') +
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

    // ══ DARK SIGNATURE FOOTER — professional, visible ══
    '<div style="background:#0A0F1E;padding:28px;border-top:3px solid #C9A84C">',
    '<div style="height:2px;background:linear-gradient(90deg,#C9A84C,transparent);width:80px;margin-bottom:18px"></div>',
    '<div style="font-size:12px;color:#94A3B8;margin-bottom:14px">Best regards,</div>',
    '<div style="font-family:Segoe Script,Brush Script MT,cursive;font-size:28px;color:#C9A84C;margin-bottom:6px;line-height:1.2">Daniel P. Roscoe</div>',
    '<div style="font-size:12px;font-weight:600;color:#94A3B8;margin-bottom:14px">Owner, <span style="color:#C9A84C;font-weight:800">Storvex\u2122</span></div>',
    '<div style="margin-bottom:18px"><a href="mailto:Droscoe@DJRrealestate.com" style="font-size:12px;color:#C9A84C;text-decoration:none;font-weight:600">Droscoe@DJRrealestate.com</a><span style="color:#475569"> &middot; </span><span style="font-size:12px;color:#94A3B8">312-805-5996</span></div>',
    '<div style="padding-top:14px;border-top:1px solid #1E293B">',
    '<span style="font-size:9px;color:#94A3B8;text-transform:uppercase;letter-spacing:0.18em">Generated by state-of-the-art AI review at Storvex\u2122</span>',
    '</div></div>',

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
