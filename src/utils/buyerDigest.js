// buyerDigest.js — per-buyer funnel push generator.
//
// Sprint 2 of the Crush-Radius-Plus arc. Takes the universe of sites
// Storvex has sourced (Firebase submissions + east + southwest trackers)
// and produces a per-recipient weekly digest payload:
//
//   For each recipient declared in BUYER_SPECS (Reza, Aaron, Jennifer,
//   DW, MT, EXR/CUBE/SMA pending-relationship rows, capital partner
//   rotation):
//     1. Filter sites where topBuyerFit(site).recipient === this recipient
//     2. Rank by fit score descending
//     3. Cap at maxPerRecipient (default 10)
//     4. Render digest HTML with site cards, Storvex deep links, sign-off
//
// THE FUNNEL IS THE PRODUCT. Radius+/TractIQ users open a portal to
// screen for deals. Storvex users get a weekly email with deals already
// vetted, scored, REC-packaged, and routed by relationship — pulled from
// the operator's own spec, not the user's manual filter.
//
// The output of this module is consumed by:
//   - Dashboard "Weekly Digest Preview" section (shows per-recipient
//     counts and lets Dan copy/send the HTML)
//   - Future cron job that auto-generates Gmail drafts every Monday
//     at 06:30 ET
//
// The module is pure (no Firebase, no DOM, no fetch). The dashboard
// passes in already-fetched site data; the cron job will too.

import { topBuyerFit, classifyBuyerFit } from "./buyerMatchEngine";

const NAVY = "#1E2761";
const GOLD = "#C9A84C";
const ICE = "#D6E4F7";

/**
 * Map Firebase/dashboard site record shape to the flat-field shape
 * buyerMatchEngine expects. Defensive against missing optional fields —
 * the engine handles undefined inputs by defaulting to neutral scores.
 */
export function siteToMatchInput(site) {
  if (!site) return {};
  const iq = site.siteiqData || {};
  const growth = Number.parseFloat(
    String(site.growthRate || site.growth3mi || "").replace(/[^\d.-]/g, "")
  );
  return {
    acreage: Number.isFinite(Number(site.acreage)) ? Number(site.acreage) : null,
    pop3mi: Number.isFinite(Number(site.pop3mi))
      ? Number(site.pop3mi)
      : Number.isFinite(Number(iq.pop3mi))
      ? Number(iq.pop3mi)
      : null,
    hhi3mi: Number.isFinite(Number(site.income3mi || site.hhi3mi))
      ? Number(site.income3mi || site.hhi3mi)
      : null,
    state: site.state || null,
    nearestPSFamilyMi: Number.isFinite(Number(iq.nearestPS))
      ? Number(iq.nearestPS)
      : Number.isFinite(Number(site.nearestPSFamilyMi))
      ? Number(site.nearestPSFamilyMi)
      : null,
    ccSPC: Number.isFinite(Number(iq.ccSPC))
      ? Number(iq.ccSPC)
      : Number.isFinite(Number(site.ccSPC))
      ? Number(site.ccSPC)
      : null,
    marketTier: Number.isFinite(Number(iq.marketTier))
      ? Number(iq.marketTier)
      : null,
    growth3mi: Number.isFinite(growth) ? growth : null,
    zoningPath: site.zoningClassification || site.zoningPath || site.zoning || null,
    summary: site.summary || "",
  };
}

/**
 * Group sites by their highest-fit recipient. Sites with no viable fit
 * (every spec hard-fails) are dropped. Sites with only fallback fits are
 * grouped under the GENERIC recipient.
 *
 * @param {Array<object>} sites — Firebase site records
 * @param {object} opts
 * @returns {Object<string, Array<object>>} — { recipient: [enrichedSite, ...] }
 */
export function groupSitesByRecipient(sites, opts = {}) {
  const {
    minScore = 5.5, // VIABLE+ floor — sites below this aren't worth pushing
    maxPerRecipient = 10,
    deepLinkBase = "https://storvex.vercel.app/",
  } = opts;

  if (!Array.isArray(sites)) return {};

  const byRecipient = {};
  for (const site of sites) {
    if (!site) continue;
    const top = topBuyerFit(siteToMatchInput(site));
    if (!top) continue;
    if (top.score < minScore) continue;

    const recipient = top.recipient;
    if (!byRecipient[recipient]) byRecipient[recipient] = [];

    const id = site.id || site._id || site.firebaseKey || null;
    const deepLink = id ? `${deepLinkBase}?site=${encodeURIComponent(id)}` : deepLinkBase;

    byRecipient[recipient].push({
      ...site,
      _topFit: top,
      _deepLink: deepLink,
    });
  }

  // Rank within each recipient bucket + cap
  for (const recipient of Object.keys(byRecipient)) {
    byRecipient[recipient].sort((a, b) => b._topFit.score - a._topFit.score);
    byRecipient[recipient] = byRecipient[recipient].slice(0, maxPerRecipient);
  }

  return byRecipient;
}

// ─── HTML formatting helpers ───────────────────────────────────────────────

function escapeHTML(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmt$(n) {
  if (!Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtN(n) {
  if (!Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString();
}

function fmtAcres(n) {
  if (!Number.isFinite(Number(n))) return "—";
  return `${Number(n).toFixed(2)} AC`;
}

function fitColor(cls) {
  if (cls === "STRONG") return "#16A34A";
  if (cls === "VIABLE") return "#D97706";
  if (cls === "MARGINAL") return "#B45309";
  return "#94A3B8";
}

// ─── Site card HTML ────────────────────────────────────────────────────────

function renderSiteCard(site, idx) {
  const fit = site._topFit || {};
  const cls = classifyBuyerFit(fit.score);
  const fitColorVal = fitColor(cls);
  const iq = site.siteiqData || {};

  const psProx = Number.isFinite(Number(iq.nearestPS))
    ? `${Number(iq.nearestPS).toFixed(1)} mi`
    : "—";
  const ccSPC = Number.isFinite(Number(iq.ccSPC))
    ? `${Number(iq.ccSPC).toFixed(2)}`
    : "—";

  const ctaButtons = [];
  if (site._deepLink) {
    ctaButtons.push(
      `<a href="${escapeHTML(site._deepLink)}" style="display:inline-block;background-color:${GOLD};color:${NAVY};padding:8px 16px;text-decoration:none;border-radius:4px;font-weight:700;font-size:12px;margin-right:8px;">View on Storvex</a>`
    );
  }
  if (site.listingUrl) {
    ctaButtons.push(
      `<a href="${escapeHTML(site.listingUrl)}" style="display:inline-block;background-color:${NAVY};color:#fff;padding:8px 16px;text-decoration:none;border-radius:4px;font-weight:700;font-size:12px;margin-right:8px;">Listing</a>`
    );
  }
  if (site.coordinates) {
    const coords = String(site.coordinates).replace(/\s/g, "");
    if (/-?\d+\.\d+,-?\d+\.\d+/.test(coords)) {
      ctaButtons.push(
        `<a href="https://www.google.com/maps?q=${escapeHTML(coords)}" style="display:inline-block;background-color:${NAVY};color:#fff;padding:8px 16px;text-decoration:none;border-radius:4px;font-weight:700;font-size:12px;">Location</a>`
      );
    }
  }

  return `
<div style="border:1px solid #E2E8F0;border-left:4px solid ${fitColorVal};border-radius:6px;padding:14px 18px;margin-bottom:16px;background:#FFFFFF;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
    <div>
      <div style="font-size:10px;color:#94A3B8;letter-spacing:0.08em;font-weight:700;">SITE ${idx + 1}</div>
      <div style="font-size:15px;font-weight:800;color:${NAVY};margin-top:2px;">${escapeHTML(site.name || site.address || "(unnamed)")}</div>
      ${site.market ? `<div style="font-size:11px;color:#64748B;">${escapeHTML(site.market)} · ${escapeHTML(site.state || "")}</div>` : ""}
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;color:#94A3B8;font-weight:700;letter-spacing:0.08em;">FIT</div>
      <div style="font-size:18px;font-weight:800;color:${fitColorVal};line-height:1;">${(fit.score || 0).toFixed(1)}</div>
      <div style="font-size:9px;color:${fitColorVal};font-weight:700;letter-spacing:0.05em;">${escapeHTML(cls)}</div>
    </div>
  </div>

  <table style="width:100%;font-size:11px;color:#1E2761;margin-bottom:10px;border-collapse:collapse;">
    <tr>
      <td style="padding:3px 0;color:#64748B;width:30%;">Acreage</td>
      <td style="padding:3px 0;font-weight:700;">${fmtAcres(site.acreage)}</td>
      <td style="padding:3px 0;color:#64748B;width:20%;">Ask</td>
      <td style="padding:3px 0;font-weight:700;">${fmt$(site.askingPrice)}</td>
    </tr>
    <tr>
      <td style="padding:3px 0;color:#64748B;">3-Mi Pop</td>
      <td style="padding:3px 0;font-weight:700;">${fmtN(site.pop3mi)}</td>
      <td style="padding:3px 0;color:#64748B;">3-Mi HHI</td>
      <td style="padding:3px 0;font-weight:700;">${fmt$(site.income3mi || site.hhi3mi)}</td>
    </tr>
    <tr>
      <td style="padding:3px 0;color:#64748B;">PS Family</td>
      <td style="padding:3px 0;font-weight:700;">${escapeHTML(psProx)}</td>
      <td style="padding:3px 0;color:#64748B;">CC SPC</td>
      <td style="padding:3px 0;font-weight:700;">${escapeHTML(ccSPC)}</td>
    </tr>
  </table>

  ${site.summary ? `<div style="font-size:11px;color:#475569;line-height:1.5;margin-bottom:10px;">${escapeHTML(String(site.summary).slice(0, 280))}${String(site.summary).length > 280 ? "…" : ""}</div>` : ""}

  ${ctaButtons.length ? `<div>${ctaButtons.join("")}</div>` : ""}

  ${
    fit.flagged && fit.flagged.length
      ? `<div style="margin-top:8px;font-size:10px;color:#D97706;">⚠ ${fit.flagged.map(escapeHTML).join(" · ")}</div>`
      : ""
  }
</div>`;
}

// ─── Recipient digest HTML ──────────────────────────────────────────────────

/**
 * Generate the digest email body HTML for one recipient.
 *
 * @param {string} recipient — e.g. "Reza Mahdavian / DW / MT"
 * @param {Array<object>} sites — enriched sites (with _topFit + _deepLink)
 * @param {object} opts
 * @returns {string} — HTML
 */
export function renderRecipientDigest(recipient, sites, opts = {}) {
  const {
    generationDate = new Date(),
    weekLabel = null,
    dashboardUrl = "https://storvex.vercel.app/",
  } = opts;

  if (!Array.isArray(sites) || !sites.length) return "";

  const dateLabel =
    weekLabel ||
    generationDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const buyerKey = sites[0]?._topFit?.key || "";
  const buyerName = sites[0]?._topFit?.name || "the buyer-spec";

  const intro = recipient.includes(" / ")
    ? recipient.split(" / ")[0]
    : recipient.split(/[,\s/]/)[0];

  const siteCardsHTML = sites.map(renderSiteCard).join("");

  // Aggregate stats for the header chip
  const avgScore = sites.reduce((s, x) => s + (x._topFit?.score || 0), 0) / sites.length;
  const strongCount = sites.filter(
    (x) => classifyBuyerFit(x._topFit?.score) === "STRONG"
  ).length;

  return `
<div style="font-family:Calibri,Arial,sans-serif;max-width:680px;margin:0 auto;color:${NAVY};">

  <div style="background:${NAVY};color:#fff;padding:18px 22px;border-radius:8px 8px 0 0;">
    <div style="font-size:11px;letter-spacing:0.15em;color:${GOLD};font-weight:800;">STORVEX · WEEKLY DIGEST · ${escapeHTML(dateLabel.toUpperCase())}</div>
    <div style="font-size:22px;font-weight:800;margin-top:6px;">${sites.length} pre-vetted ${escapeHTML(buyerName)} fits this week</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.75);margin-top:4px;">
      ${strongCount} STRONG · avg fit ${avgScore.toFixed(2)}/10 · routed via ${escapeHTML(recipient)}
    </div>
  </div>

  <div style="padding:18px 22px;background:#F8FAFC;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">
    <p style="font-size:13px;color:${NAVY};margin:0 0 14px 0;line-height:1.5;">
      ${escapeHTML(intro)},
    </p>
    <p style="font-size:13px;color:#475569;margin:0 0 18px 0;line-height:1.5;">
      Storvex's daily scan + audit-layer underwriting flagged the sites below as the highest-fit matches for ${escapeHTML(buyerName)}'s acquisition spec this week. Every entry carries a full REC Package with primary-source ESRI demographics, EDGAR-cited rent comps, zoning verification, and IC-ready financials. Click <b>View on Storvex</b> on any card to open the full institutional workpaper.
    </p>

    ${siteCardsHTML}

    <div style="background:${ICE};border-radius:6px;padding:14px 18px;margin-top:18px;font-size:12px;color:${NAVY};line-height:1.5;">
      <b>How to action this digest:</b> Reply with <b>Pursue</b>, <b>Pass</b>, or <b>Hold</b> against each site number. Pursue triggers the next sourcing step (LOI draft / broker outreach / capital partner intro). Pass logs the rejection rationale to the calibration system so future digests learn from your selectivity. Storvex never sends a site twice unless its underwriting materially changes.
    </div>

    <div style="margin-top:14px;font-size:11px;color:#64748B;text-align:center;">
      <a href="${escapeHTML(dashboardUrl)}" style="color:${NAVY};text-decoration:underline;">Open Storvex Dashboard</a>
      &nbsp;·&nbsp;
      <span>Generated ${escapeHTML(generationDate.toISOString())}</span>
    </div>
  </div>

  <div style="margin-top:18px;padding:0 22px;font-size:12px;color:${NAVY};line-height:1.4;">
    Best,<br/>
    <b>Daniel P. Roscoe</b><br/>
    E: <a href="mailto:Droscoe@DJRrealestate.com" style="color:${NAVY};">Droscoe@DJRrealestate.com</a><br/>
    C: 312-805-5996
  </div>
</div>`.trim();
}

// ─── Public API: generate all digests at once ───────────────────────────────

/**
 * Generate digests for every recipient with at least one viable fit.
 *
 * @param {Array<object>} sites — Firebase site records
 * @param {object} opts
 * @returns {Object<string, { recipient, siteCount, sites, html, topScore, strongCount }>}
 */
export function generateAllDigests(sites, opts = {}) {
  const grouped = groupSitesByRecipient(sites, opts);
  const out = {};
  for (const [recipient, recipientSites] of Object.entries(grouped)) {
    const html = renderRecipientDigest(recipient, recipientSites, opts);
    const topScore = recipientSites[0]?._topFit?.score || 0;
    const strongCount = recipientSites.filter(
      (x) => classifyBuyerFit(x._topFit?.score) === "STRONG"
    ).length;
    out[recipient] = {
      recipient,
      siteCount: recipientSites.length,
      sites: recipientSites,
      html,
      topScore,
      strongCount,
    };
  }
  return out;
}

/**
 * Convenience — produce a flat summary table of digest stats for the
 * dashboard's "Weekly Digest Preview" section. No HTML, just data.
 *
 * @param {Array<object>} sites
 * @returns {Array<{ recipient, siteCount, topScore, strongCount, avgScore }>}
 */
export function summarizeDigests(sites, opts = {}) {
  const grouped = groupSitesByRecipient(sites, opts);
  return Object.entries(grouped)
    .map(([recipient, recipientSites]) => {
      const topScore = recipientSites[0]?._topFit?.score || 0;
      const avg =
        recipientSites.reduce((s, x) => s + (x._topFit?.score || 0), 0) / recipientSites.length;
      const strong = recipientSites.filter(
        (x) => classifyBuyerFit(x._topFit?.score) === "STRONG"
      ).length;
      return {
        recipient,
        siteCount: recipientSites.length,
        topScore,
        avgScore: avg,
        strongCount: strong,
      };
    })
    .sort((a, b) => b.strongCount - a.strongCount || b.topScore - a.topScore);
}
