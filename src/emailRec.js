// ─── Email Recommendation HTML Generator ───
// Extracted module — imported by App.js
// Returns { previewHTML, emailBody, subject, toEmails, listingWarning }

import { escapeHtml, fixEncoding } from './utils';
import { computeSiteFinancials } from './scoring';

const REC_RECIPIENTS = {
  east: { name: "Matt Toussaint", email: "mtoussaint@publicstorage.com" },
  southwest: { name: "Daniel Wollent", email: "dwollent@publicstorage.com" },
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

  // Zoning badge
  const zBadge = "display:inline-block;padding:2px 10px;border-radius:4px;color:#fff;font-size:11px;font-weight:800;letter-spacing:0.05em";
  const zoningBadge = zClass === "by-right"
    ? '<span style="' + zBadge + ';background:#16A34A">BY-RIGHT</span>'
    : zClass === "conditional"
    ? '<span style="' + zBadge + ';background:#F59E0B">CONDITIONAL</span>'
    : '<span style="' + zBadge + ';background:#6B7280">TBD</span>';

  let zoningDetail = "";
  if (site.zoningUseTerm && site.zoningOrdinanceSection) {
    zoningDetail = '"' + h(fe(site.zoningUseTerm)) + '" permitted ' + (zClass === "by-right" ? "by right" : zClass === "conditional" ? "(conditional)" : "") + " in <b>" + h(site.zoning || "") + "</b> per " + h(fe(site.zoningOrdinanceSection)) + ". " + (zClass === "by-right" ? "No SUP, no hearing." : "");
  } else if (site.zoningNotes) {
    zoningDetail = h(site.zoning || "TBD") + " \u2014 " + zClass + ". " + h(fe(site.zoningNotes));
  } else {
    zoningDetail = h(site.zoning || "TBD") + " \u2014 " + zClass + ". Verification pending.";
  }

  // Competition
  let compLine = "";
  if (ccSPC) {
    const v = parseFloat(ccSPC);
    const ccLabel = v < 1.5 ? "severely underserved" : v < 3.0 ? "underserved" : v < 5.0 ? "moderate supply" : v < 7.0 ? "well-supplied" : "oversupplied";
    compLine = "CC SPC <b>" + ccSPC + "</b> SF/capita (<b>" + ccLabel + "</b>)" + (projCCSPC ? ", projected <b>" + projCCSPC + "</b> at 5-yr" : "") + ".";
    if (site.competingCCSF) compLine += " " + h(fe(site.competingCCSF)) + " CC SF within 3 mi.";
    if (site.competitorNames) compLine += " Competitors: " + h(fe(site.competitorNames)) + ".";
  }

  // Water
  let waterLine = "";
  if (site.waterHookupStatus || site.waterProvider) {
    const hookup = site.waterHookupStatus || "TBD";
    const wBadge = "display:inline-block;padding:2px 8px;border-radius:4px;color:#fff;font-size:10px;font-weight:700";
    const hkBadge = hookup === "by-right"
      ? '<span style="' + wBadge + ';background:#16A34A">BY-RIGHT</span>'
      : '<span style="' + wBadge + ';background:#F59E0B">' + h(hookup).toUpperCase() + '</span>';
    waterLine = "Water: " + hkBadge + " \u2014 " + (site.insideServiceBoundary ? "inside" : "outside") + " " + h(fe(site.waterProvider || "municipal")) + " service area.";
  }

  // Economics
  let econRows = "";
  if (fin && !fin.valuationError && fin.totalSF > 0) {
    const tdL = 'style="padding:8px 14px;font-size:12px;color:#4A5080;border-bottom:1px solid #E2E8F0"';
    const tdR = 'style="padding:8px 14px;font-size:12px;font-weight:700;color:#1E293B;border-bottom:1px solid #E2E8F0;text-align:right"';
    econRows += "<tr><td " + tdL + ">Build Plate</td><td " + tdR + ">~" + Math.round(fin.totalSF / 1000) + "K SF (" + Math.round((fin.climatePct || 0.65) * 100) + "% CC / " + Math.round((fin.drivePct || 0.35) * 100) + "% DU) on " + (fin.acres ? fin.acres.toFixed(1) : "?") + " AC</td></tr>";
    econRows += '<tr style="background:#F8FAFC"><td ' + tdL + ">Est. Build Cost</td><td " + tdR + ">" + $k(fin.totalDevCost || 0) + " (" + $k(fin.totalHardPerSF || 0) + "/SF)</td></tr>";
    econRows += "<tr><td " + tdL + ">Stabilized NOI</td><td " + tdR + ">" + $k(fin.stabNOI || 0) + " (Year 3)</td></tr>";
    const yocColor = parseFloat(fin.yocStab) >= 8 ? "#16A34A" : parseFloat(fin.yocStab) >= 7 ? "#F59E0B" : "#EF4444";
    econRows += '<tr style="background:#F8FAFC"><td style="padding:8px 14px;font-size:12px;color:#4A5080;font-weight:700;border-bottom:2px solid #C9A84C">Projected YOC</td><td style="padding:8px 14px;font-size:14px;font-weight:900;color:' + yocColor + ';border-bottom:2px solid #C9A84C;text-align:right">' + (fin.yocStab || "?") + "%</td></tr>";
    if (fin.landPrices && fin.landPrices[1] && fin.landPrices[1].maxLand > 0) {
      econRows += '<tr><td style="padding:8px 14px;font-size:12px;color:#4A5080">Recommended Offer</td><td style="padding:8px 14px;font-size:12px;font-weight:700;color:#1E2761;text-align:right">' + $k(fin.landPrices[1].maxLand) + (fin.landPrices[1].perAcre ? " (" + $k(fin.landPrices[1].perAcre) + "/ac)" : "") + "</td></tr>";
    }
  }

  const pop3 = site.pop3mi || ""; const hhi3 = site.income3mi || ""; const hh3 = site.households3mi || "";
  const growth = site.popGrowth3mi || site.growthRate || ""; const renter = site.renterPct3mi || "";
  const nearPS = iq.nearestPS ? iq.nearestPS + " mi" : "";

  const watches = [];
  if (site.overlayDistrict) watches.push(h(fe(site.overlayDistrict)) + (site.overlayCostImpact ? " (" + h(fe(site.overlayCostImpact)) + ")" : ""));
  if (site.facadeReqs) watches.push("Facade: " + h(fe(site.facadeReqs)));
  if (site.floodZone && site.floodZone !== "Zone X" && site.floodZone !== "X") watches.push("Flood: " + h(fe(site.floodZone)));
  if (zClass === "conditional") watches.push("SUP/CUP required" + (site.supTimeline ? " \u2014 est. " + h(fe(site.supTimeline)) : "") + (site.supCost ? ", " + h(fe(site.supCost)) : ""));

  let recLine = "";
  if (fin && fin.landVerdict) {
    recLine = fin.landVerdict;
    if (fin.landVerdict === "STRONG BUY" || fin.landVerdict === "BUY") recLine += ". Strong fundamentals, margin in the land.";
    else if (fin.landVerdict === "NEGOTIATE") recLine += ". Fundamentals support \u2014 price needs work.";
    else if (fin.landVerdict === "STRETCH") recLine += ". Good site, asking above strike.";
  }

  // Section builder
  const secHead = (label) => '<div style="font-size:10px;font-weight:700;color:#1E2761;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;border-bottom:2px solid #C9A84C;padding-bottom:4px;display:inline-block">' + label + '</div>';
  const section = (label, content) => '<div style="margin-bottom:18px">' + secHead(label) + '<div style="font-size:13px;color:#334155">' + content + '</div></div>';

  // Demographics rows
  let demoRows = "";
  if (pop3) demoRows += '<tr><td style="padding:6px 10px;font-size:12px;color:#4A5080;border-bottom:1px solid #F1F5F9">3-Mi Population</td><td style="padding:6px 10px;font-size:12px;font-weight:700;color:#1E293B;border-bottom:1px solid #F1F5F9;text-align:right">' + h(pop3) + (growth ? ' | Growth: <b>' + h(growth) + '%</b> CAGR' : '') + '</td></tr>';
  if (hhi3) demoRows += '<tr style="background:#F8FAFC"><td style="padding:6px 10px;font-size:12px;color:#4A5080;border-bottom:1px solid #F1F5F9">3-Mi Median HHI</td><td style="padding:6px 10px;font-size:12px;font-weight:700;color:#1E293B;border-bottom:1px solid #F1F5F9;text-align:right">' + h(hhi3) + '</td></tr>';
  if (hh3) demoRows += '<tr><td style="padding:6px 10px;font-size:12px;color:#4A5080;border-bottom:1px solid #F1F5F9">3-Mi Households</td><td style="padding:6px 10px;font-size:12px;font-weight:700;color:#1E293B;border-bottom:1px solid #F1F5F9;text-align:right">' + h(hh3) + (renter ? ' | Renter: <b>' + h(renter) + '%</b>' : '') + '</td></tr>';

  // Recommendation banner text
  const recBannerText = recLine || (fin && fin.yocStab ? "Projected " + fin.yocStab + "% YOC" : "Site under review");
  const recBannerColor = (fin && fin.landVerdict === "STRONG BUY") || (fin && fin.landVerdict === "BUY") ? "#16A34A" : (fin && fin.landVerdict === "NEGOTIATE") ? "#F59E0B" : "#3B82F6";

  // Assemble email body
  const emailBody = [
    '<div style="font-family:Calibri,sans-serif;max-width:680px;margin:0 auto;color:#1E293B;line-height:1.6">',
    // ── STORVEX RECOMMENDATION BANNER ──
    '<div style="background:linear-gradient(135deg,' + recBannerColor + ',' + recBannerColor + 'dd);padding:10px 28px;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:space-between">',
    '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:9px;font-weight:800;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.12em">STORVEX\u2122 RECOMMENDATION</span></div>',
    '<div style="font-size:11px;font-weight:800;color:#fff;letter-spacing:0.04em">' + h(recBannerText).substring(0, 60) + '</div>',
    '</div>',
    // ── HEADER ──
    '<div style="background:linear-gradient(135deg,#0A0E2A,#1E2761);padding:28px 28px 20px">',
    '<div style="font-size:22px;font-weight:900;color:#C9A84C;letter-spacing:-0.01em">' + h(fe(site.address || site.name || "")) + '</div>',
    '<div style="font-size:14px;color:#D6E4F7;margin-top:4px;font-weight:500">' + h(site.city || "") + (site.city && site.state ? ", " : "") + h(site.state || "") + " " + h(site.zip || "") + '</div>',
    // ── Premium action buttons ──
    '<table cellpadding="0" cellspacing="0" style="margin-top:16px"><tr>',
    listingUrl ? '<td style="padding-right:8px"><a href="' + h(listingUrl) + '" style="display:inline-block;padding:9px 20px;background:linear-gradient(135deg,rgba(201,168,76,0.2),rgba(201,168,76,0.08));border:1px solid rgba(201,168,76,0.5);border-radius:6px;color:#C9A84C;font-size:11px;font-weight:800;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase">\u25B8 LISTING</a></td>' : "",
    pinDrop ? '<td style="padding-right:8px"><a href="' + h(pinDrop) + '" style="display:inline-block;padding:9px 20px;background:linear-gradient(135deg,rgba(201,168,76,0.2),rgba(201,168,76,0.08));border:1px solid rgba(201,168,76,0.5);border-radius:6px;color:#C9A84C;font-size:11px;font-weight:800;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase">\u25B8 PIN DROP</a></td>' : "",
    '<td><a href="' + h(dashLink) + '" style="display:inline-block;padding:9px 22px;background:linear-gradient(135deg,#C9A84C,#E8B84A);border:none;border-radius:6px;color:#0A0E2A;font-size:11px;font-weight:900;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase;box-shadow:0 2px 12px rgba(201,168,76,0.4)">\u26A1 OPEN IN STORVEX</a></td>',
    '</tr></table></div>',
    '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#F8FAFC;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0"><tr>',
    '<td style="padding:14px 16px;text-align:center;border-bottom:1px solid #E2E8F0;border-right:1px solid #E2E8F0;width:25%"><div style="font-size:9px;font-weight:700;color:#6B7394;text-transform:uppercase;letter-spacing:0.08em">Acreage</div><div style="font-size:16px;font-weight:800;color:#1E2761;margin-top:2px">' + (h(acreageRaw) || "N/A") + '</div></td>',
    '<td style="padding:14px 16px;text-align:center;border-bottom:1px solid #E2E8F0;border-right:1px solid #E2E8F0;width:25%"><div style="font-size:9px;font-weight:700;color:#6B7394;text-transform:uppercase;letter-spacing:0.08em">Asking</div><div style="font-size:16px;font-weight:800;color:#1E2761;margin-top:2px">' + h(fe(site.askingPrice || "TBD")) + (pricePerAc ? ' <span style="font-size:11px;color:#6B7394">(' + pricePerAc + '/ac)</span>' : '') + '</div></td>',
    '<td style="padding:14px 16px;text-align:center;border-bottom:1px solid #E2E8F0;border-right:1px solid #E2E8F0;width:25%"><div style="font-size:9px;font-weight:700;color:#6B7394;text-transform:uppercase;letter-spacing:0.08em">Zoning</div><div style="margin-top:4px">' + zoningBadge + '</div></td>',
    '<td style="padding:14px 16px;text-align:center;border-bottom:1px solid #E2E8F0;width:25%"><div style="font-size:9px;font-weight:700;color:#6B7394;text-transform:uppercase;letter-spacing:0.08em">Nearest PS</div><div style="font-size:16px;font-weight:800;color:#1E2761;margin-top:2px">' + (h(nearPS) || "\u2014") + '</div></td></tr></table>',
    '<div style="padding:24px 28px;background:#fff;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0">',
    section("Zoning", zoningDetail),
    waterLine ? section("Water", waterLine) : "",
    compLine ? section("Competition", compLine) : "",
    '<div style="margin-bottom:18px">' + secHead("Demographics (ESRI 2025)") + '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:6px">' + demoRows + '</table></div>',
    econRows ? '<div style="margin-bottom:18px">' + secHead("Projected Economics") + '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:6px">' + econRows + '</table></div>' : "",
    watches.length ? '<div style="margin-bottom:18px;padding:12px 16px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px"><div style="font-size:10px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Watch Items</div>' + watches.map(function(w) { return '<div style="font-size:12px;color:#78350F;margin-bottom:4px">\u2022 ' + w + '</div>'; }).join("") + '</div>' : "",
    recLine ? '<div style="margin-bottom:18px;padding:16px 20px;background:linear-gradient(135deg,#0A0E2A,#1E2761);border-radius:8px;border-left:4px solid #C9A84C"><div style="font-size:9px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">STORVEX\u2122 VERDICT</div><div style="font-size:14px;color:#E2E8F0;font-weight:700;line-height:1.5">' + h(recLine) + '</div></div>' : "",
    '</div>',
    '<div style="background:linear-gradient(135deg,#0A0E2A,#1E2761);padding:24px 28px;border-radius:0 0 8px 8px;border-top:3px solid #C9A84C">',
    '<div style="font-size:12px;color:#6B7394;margin-bottom:10px;letter-spacing:0.03em">Best regards,</div>',
    '<div style="font-family:\'Dancing Script\',\'Segoe Script\',\'Brush Script MT\',cursive;font-size:28px;color:#C9A84C;margin-bottom:6px;letter-spacing:1px;text-shadow:0 1px 3px rgba(0,0,0,0.3)">Daniel P. Roscoe</div>',
    '<div style="height:1px;background:linear-gradient(90deg,#C9A84C,transparent);width:200px;margin-bottom:10px"></div>',
    '<div style="font-size:12px;font-weight:700;color:#D6E4F7;letter-spacing:0.04em">Daniel P. Roscoe <span style="color:#6B7394">|</span> Owner, <span style="color:#C9A84C">Storvex\u2122</span></div>',
    '<div style="font-size:11px;color:#6B7394;margin-top:4px">E: <a href="mailto:Droscoe@DJRrealestate.com" style="color:#94A3B8;text-decoration:none">Droscoe@DJRrealestate.com</a> <span style="color:#2C3E6B">\u2022</span> C: 312-805-5996</div>',
    '</div></div>',
  ].join("");

  // Preview page (print/PDF)
  const previewHTML = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">'
    + '<title>Email Rec \u2014 ' + h(siteName) + '</title>'
    + '<style>'
    + "@import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Inter:wght@400;500;600;700;800;900&display=swap');"
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + "body{font-family:'Inter',Calibri,sans-serif;background:#F1F5F9;padding:40px 20px}"
    + '@media print{body{background:#fff;padding:0}.no-print{display:none!important}.page{box-shadow:none!important;border:none!important}}'
    + '.page{max-width:720px;margin:0 auto;background:#fff;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden}'
    + '.toolbar{max-width:720px;margin:0 auto 16px;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}'
    + '.toolbar button{padding:10px 20px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:0.04em;text-transform:uppercase}'
    + '</style></head><body>'
    + '<div class="toolbar no-print">'
    + '<button onclick="window.print()" style="background:linear-gradient(135deg,#1E2761,#2C3E6B);color:#C9A84C;box-shadow:0 2px 12px rgba(30,39,97,0.3)">Print / Save PDF</button>'
    + '<button id="copyBtn" onclick="copyEmail()" style="background:linear-gradient(135deg,#4A1942,#7B2D8E);color:#fff;box-shadow:0 2px 12px rgba(123,45,142,0.3)">Copy HTML for Gmail</button>'
    + '</div>'
    + '<div class="page">' + emailBody + '</div>'
    + '<script>'
    + 'function copyEmail(){'
    + "var el=document.querySelector('.page');"
    + "var blob=new Blob([el.innerHTML],{type:'text/html'});"
    + "var text=new Blob([el.innerText],{type:'text/plain'});"
    + "navigator.clipboard.write([new ClipboardItem({'text/html':blob,'text/plain':text})]).then(function(){"
    + "var b=document.getElementById('copyBtn');b.textContent='Copied!';b.style.background='#16A34A';"
    + "setTimeout(function(){b.textContent='Copy HTML for Gmail';b.style.background='linear-gradient(135deg,#4A1942,#7B2D8E)';},2000);"
    + '}).catch(function(){'
    + 'var r=document.createRange();r.selectNodeContents(el);var s=window.getSelection();s.removeAllRanges();s.addRange(r);'
    + "document.execCommand('copy');s.removeAllRanges();"
    + "var b=document.getElementById('copyBtn');b.textContent='Copied!';b.style.background='#16A34A';"
    + "setTimeout(function(){b.textContent='Copy HTML for Gmail';b.style.background='linear-gradient(135deg,#4A1942,#7B2D8E)';},2000);"
    + '});}'
    + '</script></body></html>';

  return { previewHTML, emailBody, subject, toEmails, listingWarning, recipient: recip.name };
};
