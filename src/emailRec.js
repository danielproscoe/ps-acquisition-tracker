// ─── Email Recommendation HTML Generator ───
// Extracted module — imported by App.js
// Returns { previewHTML, emailBody, subject, toEmails, listingWarning }

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

  // Assemble email body — institutional AI aesthetic
  const emailBody = [
    '<div style="font-family:\'Inter\',\'SF Pro Display\',Calibri,system-ui,sans-serif;max-width:680px;margin:0 auto;color:#0F172A;line-height:1.6;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0;box-shadow:0 4px 24px rgba(0,0,0,0.06)">',
    // ── TOP BAR — AI signal ──
    '<div style="background:#0F172A;padding:8px 28px;display:flex;align-items:center;justify-content:space-between">',
    '<div style="display:flex;align-items:center;gap:6px"><div style="width:6px;height:6px;background:#22C55E;border-radius:50%;box-shadow:0 0 6px rgba(34,197,94,0.6)"></div><span style="font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.16em;font-family:\'SF Mono\',\'Fira Code\',monospace">STORVEX\u2122 AI-POWERED SITE INTELLIGENCE</span></div>',
    '<span style="font-size:9px;color:#475569;font-family:\'SF Mono\',monospace;letter-spacing:0.06em">' + new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + '</span>',
    '</div>',
    // ── VERDICT STRIP ──
    '<div style="background:' + recBannerColor + ';padding:12px 28px;display:flex;align-items:center;justify-content:space-between">',
    '<span style="font-size:10px;font-weight:800;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:0.14em">RECOMMENDATION</span>',
    '<span style="font-size:12px;font-weight:900;color:#fff;font-family:\'SF Mono\',monospace;letter-spacing:0.04em">' + h(recBannerText).substring(0, 60) + '</span>',
    '</div>',
    // ── HEADER — dark, clean, geometric ──
    '<div style="background:linear-gradient(180deg,#0F172A 0%,#1E293B 100%);padding:32px 28px 24px">',
    '<div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:8px;font-family:\'SF Mono\',monospace">' + h(site.city || "") + (site.city && site.state ? ", " : "") + h(site.state || "") + " " + h(site.zip || "") + '</div>',
    '<div style="font-size:26px;font-weight:900;color:#F8FAFC;letter-spacing:-0.02em;line-height:1.2">' + h(fe(site.address || site.name || "")) + '</div>',
    // ── Action pills ──
    '<table cellpadding="0" cellspacing="0" style="margin-top:20px"><tr>',
    listingUrl ? '<td style="padding-right:6px"><a href="' + h(listingUrl) + '" style="display:inline-block;padding:8px 16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:20px;color:#94A3B8;font-size:10px;font-weight:700;text-decoration:none;letter-spacing:0.08em;text-transform:uppercase;font-family:\'SF Mono\',monospace">LISTING \u2192</a></td>' : "",
    pinDrop ? '<td style="padding-right:6px"><a href="' + h(pinDrop) + '" style="display:inline-block;padding:8px 16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:20px;color:#94A3B8;font-size:10px;font-weight:700;text-decoration:none;letter-spacing:0.08em;text-transform:uppercase;font-family:\'SF Mono\',monospace">PIN DROP \u2192</a></td>' : "",
    '<td><a href="' + h(dashLink) + '" style="display:inline-block;padding:8px 20px;background:linear-gradient(135deg,#C9A84C,#E8B84A);border:none;border-radius:20px;color:#0F172A;font-size:10px;font-weight:900;text-decoration:none;letter-spacing:0.08em;text-transform:uppercase;font-family:\'SF Mono\',monospace;box-shadow:0 2px 12px rgba(201,168,76,0.3)">STORVEX \u26A1</a></td>',
    '</tr></table></div>',
    // ── KPI GRID — monospace data cards ──
    '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#F8FAFC"><tr>',
    '<td style="padding:16px;text-align:center;border-bottom:1px solid #E2E8F0;border-right:1px solid #E2E8F0;width:25%"><div style="font-size:8px;font-weight:800;color:#94A3B8;text-transform:uppercase;letter-spacing:0.14em;font-family:\'SF Mono\',monospace">ACREAGE</div><div style="font-size:20px;font-weight:900;color:#0F172A;margin-top:4px;font-family:\'SF Mono\',monospace">' + (h(acreageRaw) || "\u2014") + '</div></td>',
    '<td style="padding:16px;text-align:center;border-bottom:1px solid #E2E8F0;border-right:1px solid #E2E8F0;width:25%"><div style="font-size:8px;font-weight:800;color:#94A3B8;text-transform:uppercase;letter-spacing:0.14em;font-family:\'SF Mono\',monospace">ASKING</div><div style="font-size:18px;font-weight:900;color:#0F172A;margin-top:4px;font-family:\'SF Mono\',monospace">' + h(fe(site.askingPrice || "TBD")) + '</div>' + (pricePerAc ? '<div style="font-size:10px;color:#94A3B8;font-family:\'SF Mono\',monospace;margin-top:2px">' + pricePerAc + '/ac</div>' : '') + '</td>',
    '<td style="padding:16px;text-align:center;border-bottom:1px solid #E2E8F0;border-right:1px solid #E2E8F0;width:25%"><div style="font-size:8px;font-weight:800;color:#94A3B8;text-transform:uppercase;letter-spacing:0.14em;font-family:\'SF Mono\',monospace">ZONING</div><div style="margin-top:6px">' + zoningBadge + '</div></td>',
    '<td style="padding:16px;text-align:center;border-bottom:1px solid #E2E8F0;width:25%"><div style="font-size:8px;font-weight:800;color:#94A3B8;text-transform:uppercase;letter-spacing:0.14em;font-family:\'SF Mono\',monospace">NEAREST PS</div><div style="font-size:20px;font-weight:900;color:#0F172A;margin-top:4px;font-family:\'SF Mono\',monospace">' + (h(nearPS) || "\u2014") + '</div></td></tr></table>',
    // ── BODY — clean white with geometric section dividers ──
    '<div style="padding:28px;background:#fff">',
    section("Zoning", zoningDetail),
    waterLine ? section("Water", waterLine) : "",
    compLine ? section("Competition", compLine) : "",
    '<div style="margin-bottom:20px">' + secHead("Demographics (ESRI 2025)") + '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:8px;border-radius:6px;overflow:hidden;border:1px solid #E2E8F0">' + demoRows + '</table></div>',
    econRows ? '<div style="margin-bottom:20px">' + secHead("Projected Economics") + '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:8px;border-radius:6px;overflow:hidden;border:1px solid #E2E8F0">' + econRows + '</table></div>' : "",
    watches.length ? '<div style="margin-bottom:20px;padding:14px 18px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px"><div style="font-size:9px;font-weight:800;color:#92400E;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:8px;font-family:\'SF Mono\',monospace">WATCH ITEMS</div>' + watches.map(function(w) { return '<div style="font-size:12px;color:#78350F;margin-bottom:4px;padding-left:12px;border-left:2px solid #FBBF24">' + w + '</div>'; }).join("") + '</div>' : "",
    recLine ? '<div style="margin-bottom:20px;padding:18px 22px;background:#0F172A;border-radius:8px;position:relative;overflow:hidden"><div style="position:absolute;top:0;left:0;bottom:0;width:3px;background:linear-gradient(180deg,#C9A84C,#E8B84A)"></div><div style="font-size:8px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:8px;font-family:\'SF Mono\',monospace">STORVEX\u2122 VERDICT</div><div style="font-size:14px;color:#E2E8F0;font-weight:600;line-height:1.6">' + h(recLine) + '</div></div>' : "",
    '</div>',
    // ── FOOTER — signature ──
    '<div style="background:#0F172A;padding:28px;border-top:1px solid #1E293B">',
    '<div style="font-size:13px;color:#64748B;margin-bottom:14px;letter-spacing:0.02em">Best regards,</div>',
    '<div style="font-size:20px;font-weight:900;color:#F8FAFC;letter-spacing:-0.01em;margin-bottom:2px">Daniel P. Roscoe</div>',
    '<div style="font-size:12px;font-weight:600;color:#94A3B8;letter-spacing:0.04em;margin-bottom:14px">Owner, <span style="color:#C9A84C;font-weight:800">Storvex\u2122</span></div>',
    '<div style="height:1px;background:linear-gradient(90deg,#C9A84C 0%,transparent 60%);width:180px;margin-bottom:12px"></div>',
    '<div style="font-size:11px;color:#475569;font-family:\'SF Mono\',monospace">Droscoe@DJRrealestate.com <span style="color:#334155">\u00B7</span> 312-805-5996</div>',
    '<div style="margin-top:12px;display:flex;align-items:center;gap:6px"><div style="width:4px;height:4px;background:#C9A84C;border-radius:50%"></div><span style="font-size:8px;color:#475569;text-transform:uppercase;letter-spacing:0.16em;font-family:\'SF Mono\',monospace">AI-Powered Site Intelligence</span></div>',
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
