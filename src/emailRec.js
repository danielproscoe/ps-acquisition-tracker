// Email Recommendation Generator — server-side Gmail draft creation
// Button click → calls /api/create-email-rec → Gmail draft created → opens Gmail

export const generateEmailRec = (site, siteId) => {
  const p = (v) => v ? String(v).replace(/[^0-9.]/g, "") : "0";
  const fmt = (v) => v || "\u2014";
  const fmtP = (v) => { const n = parseInt(p(v)); return n ? "$" + n.toLocaleString() : "\u2014"; };
  const acres = parseFloat(p(site.acreage)) || 0;
  const priceNum = parseInt(p(site.askingPrice)) || 0;
  const pricePerAc = acres > 0 && priceNum > 0 ? "$" + Math.round(priceNum / acres).toLocaleString() + "/AC" : "\u2014";
  const siteCov = acres >= 3.5 ? 0.35 : 0.25;
  const buildSF = Math.round(acres * 43560 * siteCov);
  const ccPct = acres >= 3.5 ? 0.65 : 0.75;
  const duPct = 1 - ccPct;
  const ccSF = Math.round(buildSF * ccPct);
  const duSF = Math.round(buildSF * duPct);
  const costPerSF = acres >= 3.5 ? 65 : 95;
  const buildCost = buildSF * costPerSF;
  const totalBasis = priceNum + buildCost;
  const noiAnn = Math.round((ccSF * 1.40 * 12 * 0.87) + (duSF * 0.75 * 12 * 0.87));
  const yoc = totalBasis > 0 ? ((noiAnn / totalBasis) * 100).toFixed(1) : "\u2014";
  const zc = site.zoningClassification || "unknown";
  const zGreen = zc === "by-right";
  const ws = (site.waterHookupStatus || "unknown").toLowerCase();
  const wGreen = ws === "by-right";
  const dl = `https://storvex.vercel.app/?site=${siteId}`;
  const ll = site.listingUrl || "#";
  const pl = site.coordinates ? `https://www.google.com/maps?q=${site.coordinates.replace(/\s/g, "")}` : "#";
  const gb = (t) => `<span style="color:#1B7A2B;font-weight:bold">${t}</span>`;
  const row = (l, v, a) => `<tr style="background:${a ? "#f5f7fa" : "transparent"}"><td style="padding:6px 12px;font-weight:bold;width:200px">${l}</td><td style="padding:6px 12px">${v}</td></tr>`;
  const dr = (l, v1, v3, v5, a) => `<tr style="background:${a ? "#f5f7fa" : "transparent"}"><td style="padding:6px 12px;font-weight:bold">${l}</td><td style="padding:6px 12px;text-align:center">${v1}</td><td style="padding:6px 12px;text-align:center;font-weight:bold">${v3}</td><td style="padding:6px 12px;text-align:center">${v5}</td></tr>`;
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6">
<p>Hi, PS Team — Recommending a site for review. ${site.market || site.city + ", " + site.state}. ${zGreen ? "By-right zoning" : "Zoning: " + zc}, ${wGreen ? "by-right water" : "water: " + ws}${site.siteiqData?.nearestPS ? ", " + site.siteiqData.nearestPS + " mi to nearest PS" : ""}.</p>
<p style="font-size:18px;font-weight:bold;color:#1E2761;margin-bottom:2px">${site.name || site.address}</p>
<p style="color:#555;margin-top:0">${site.city}, ${site.state}${site.address ? " | " + site.address : ""}</p>
<table style="border-collapse:collapse;width:100%;max-width:640px;margin:16px 0">
<tr style="background-color:#1E2761;color:white"><td style="padding:8px 12px;font-weight:bold" colspan="2">SITE SUMMARY</td></tr>
${row("Acreage", fmt(site.acreage), true)}
${row("Asking Price", fmtP(site.askingPrice) + (pricePerAc !== "\u2014" ? " (" + pricePerAc + ")" : ""), false)}
${row("Zoning", fmt(site.zoning) + " \u2014 " + (zGreen ? gb("BY-RIGHT") : zc.toUpperCase()) + (site.zoningUseTerm ? ` ("${site.zoningUseTerm}")` : ""), true)}
${row("Water", (wGreen ? gb("BY-RIGHT") : ws.toUpperCase()) + (site.waterProvider ? " \u2014 " + site.waterProvider : ""), false)}
${row("Overlays", site.overlayDistrict ? fmt(site.overlayDistrict) : "\u2014", true)}
${row("Frontage", site.roadFrontage ? fmt(site.roadFrontage) : "\u2014", false)}
${row("PS Proximity", site.siteiqData?.nearestPS ? site.siteiqData.nearestPS + " mi to nearest PS" : "\u2014", true)}
</table>
<table style="border-collapse:collapse;width:100%;max-width:640px;margin:16px 0">
<tr style="background-color:#1E2761;color:white"><td style="padding:8px 12px;font-weight:bold" colspan="4">DEMOGRAPHICS \u2014 ESRI 2025</td></tr>
<tr style="background:#C9A84C;color:#1E2761;font-weight:bold"><td style="padding:6px 12px"></td><td style="padding:6px 12px;text-align:center">1-Mile</td><td style="padding:6px 12px;text-align:center">3-Mile</td><td style="padding:6px 12px;text-align:center">5-Mile</td></tr>
${dr("Population", fmt(site.pop1mi), fmt(site.pop3mi), fmt(site.pop5mi), true)}
${dr("Median HHI", fmt(site.income1mi), fmt(site.income3mi), fmt(site.income5mi), false)}
${dr("Households", fmt(site.households1mi), fmt(site.households3mi), fmt(site.households5mi), true)}
${dr("Home Value", fmt(site.homeValue1mi), fmt(site.homeValue3mi), fmt(site.homeValue5mi), false)}
${dr("Growth CAGR", fmt(site.popGrowth3mi || site.growthRate), fmt(site.popGrowth3mi || site.growthRate), fmt(site.popGrowth3mi || site.growthRate), true)}
</table>
<table style="border-collapse:collapse;width:100%;max-width:640px;margin:16px 0">
<tr style="background-color:#1E2761;color:white"><td style="padding:8px 12px;font-weight:bold" colspan="2">COMPETITION &amp; PROJECTED ECONOMICS</td></tr>
${row("CC SPC (Current)", fmt(site.ccSPC || (site.siteiqData?.ccSPC ? site.siteiqData.ccSPC + " SF/capita" : "\u2014")), true)}
${row("CC SPC (5-Yr)", fmt(site.projectedCCSPC || (site.siteiqData?.projectedCCSPC ? site.siteiqData.projectedCCSPC + " SF/capita" : "\u2014")), false)}
${row("Competitors (3 mi)", fmt(site.competitorNames), true)}
${row("Build Plate", "~" + buildSF.toLocaleString() + " SF (" + Math.round(ccPct*100) + "% CC / " + Math.round(duPct*100) + "% drive-up) on " + acres + " AC", false)}
${row("Est. Build Cost", "~$" + (buildCost/1e6).toFixed(2) + "M ($" + costPerSF + "/SF)", true)}
${row("Stabilized NOI (Yr 3)", "~$" + noiAnn.toLocaleString(), false)}
${row("Projected YOC", '<span style="font-weight:bold;color:#1B7A2B">~' + yoc + '% (on $' + (totalBasis/1e6).toFixed(2) + 'M total basis)</span>', true)}
</table>
<p style="margin:16px 0"><a href="${dl}" style="color:#1E2761;font-weight:bold;text-decoration:underline">Review Site on Storvex</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="${ll}" style="color:#1E2761;text-decoration:underline">Property Listing</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="${pl}" style="color:#1E2761;text-decoration:underline">View Location</a></p>
<p>REC package deck, ALTA survey, subdivision plat, and broker flyer attached.</p>
<p>Best,<br>Dan Roscoe<br>DJR / Dan Roscoe Real Estate</p></div>`;
};

export const handleEmailRec = async (site, siteId, notify) => {
  const html = generateEmailRec(site, siteId);
  const subject = `Site Recommendation \u2014 ${site.name || site.address}, ${site.city} ${site.state}`;

  if (notify) notify("\u23F3 Creating Gmail draft...");

  try {
    const resp = await fetch("/api/create-email-rec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, html }),
    });
    const data = await resp.json();
    if (data.success && data.draftUrl) {
      window.open(data.draftUrl, "_blank");
      if (notify) notify("\u2705 Gmail draft created \u2014 review and forward to Outlook");
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (err) {
    console.error("Email rec API failed:", err);
    // Fallback: open as rendered preview with copy button
    const preview = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${subject}</title>
<style>body{margin:0;padding:0;background:#f0f0f0}.bar{position:sticky;top:0;z-index:100;background:#1E2761;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 20px rgba(0,0,0,0.3)}.bar h3{color:#fff;margin:0;font-family:Calibri,sans-serif;font-size:14px}.btn{padding:10px 24px;border-radius:8px;border:none;background:linear-gradient(135deg,#C9A84C,#E87A2E);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:Calibri}.wrap{max-width:700px;margin:24px auto;background:#fff;border-radius:12px;padding:32px 40px;box-shadow:0 4px 24px rgba(0,0,0,0.1)}</style></head><body>
<div class="bar"><h3>\u{1F4E7} Email Rec Preview (API unavailable \u2014 copy manually)</h3>
<div style="display:flex;gap:8px;align-items:center"><span id="st" style="color:#C9A84C;font-size:12px;font-family:Calibri"></span>
<button class="btn" onclick="copyIt()">Copy to Clipboard</button></div></div>
<div class="wrap" id="ec">${html.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
<script>document.getElementById('ec').innerHTML=decodeURIComponent("${encodeURIComponent(html)}");function copyIt(){var e=document.getElementById('ec');try{var b=new Blob([e.innerHTML],{type:'text/html'});navigator.clipboard.write([new ClipboardItem({'text/html':b})]).then(function(){document.getElementById('st').textContent='Copied! Paste in Gmail compose';})}catch(x){var r=document.createRange();r.selectNodeContents(e);var s=window.getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('copy');s.removeAllRanges();document.getElementById('st').textContent='Copied!';}}</script></body></html>`;
    const blob = new Blob([preview], { type: "text/html;charset=utf-8" });
    window.open(URL.createObjectURL(blob), "_blank");
    if (notify) notify("\u26A0\uFE0F API unavailable \u2014 preview opened, click Copy to paste manually");
  }
};
