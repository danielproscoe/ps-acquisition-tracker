/**
 * Storvex™ Email Templates
 * Master templates for all PS site recommendation emails.
 * Goldman-institutional style. Navy/Gold brand. Calibri font.
 *
 * Usage: import { generateSiteRecEmail, SIGNATURE_BLOCK, ACTION_BUTTONS } from './emailTemplates';
 */

// Brand constants
const NAVY = '#1E2761';
const GOLD = '#C9A84C';
const STEEL = '#2C3E6B';
const ICE = '#D6E4F7';
const MUTED = '#7888a8';

/**
 * Storvex™ institutional signature block (HTML)
 * Used at the bottom of every outgoing email.
 */
export const SIGNATURE_BLOCK = `
<table cellpadding="0" cellspacing="0" style="width: 100%; max-width: 540px; margin-top: 30px; border: none;">
<tr><td style="border-top: 3px solid ${GOLD}; line-height: 0; font-size: 0; height: 3px;">&nbsp;</td></tr>
<tr>
<td style="background-color: ${NAVY}; padding: 16px 22px;">
<table cellpadding="0" cellspacing="0" style="width: 100%;">
<tr>
<td style="vertical-align: middle;">
<span style="font-family: Calibri, Arial, sans-serif; font-size: 15px; font-weight: bold; color: ${GOLD}; letter-spacing: 0.3px;">Daniel P. Roscoe</span><span style="font-family: Calibri, Arial, sans-serif; font-size: 11px; color: ${MUTED};">&nbsp;&nbsp;&middot;&nbsp;&nbsp;Principal</span><br>
<span style="font-family: Calibri, Arial, sans-serif; font-size: 10px; color: ${MUTED}; letter-spacing: 0.2px;">Reply directly or email&nbsp;&nbsp;<a href="mailto:Droscoe@DJRrealestate.com" style="color: ${GOLD}; text-decoration: none; font-size: 10px;">Droscoe@DJRrealestate.com</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;312-805-5996</span>
</td>
<td style="vertical-align: middle; text-align: right;">
<span style="font-family: Calibri, Arial, sans-serif; font-size: 16px; font-weight: bold; color: #FFFFFF; letter-spacing: 2.5px;">STORVEX</span><span style="font-family: Calibri, Arial, sans-serif; font-size: 8px; color: ${GOLD}; vertical-align: super; letter-spacing: 0;">&trade;</span>
</td>
</tr>
</table>
</td>
</tr>
</table>`;

/**
 * Generate action buttons row (HTML)
 * @param {Object} params
 * @param {string} params.storvexUrl - Full Storvex deep link (e.g., https://storvex.vercel.app/?site=KEY)
 * @param {string} params.listingUrl - Crexi/LoopNet listing URL
 * @param {string} params.pinDropUrl - Google Maps pin drop URL (https://www.google.com/maps?q=LAT,LONG)
 */
export function generateActionButtons({ storvexUrl, listingUrl, pinDropUrl }) {
  return `
<table cellpadding="0" cellspacing="0" style="margin-top: 14px;">
<tr>
<td style="padding-right: 6px;">
<a href="${storvexUrl}" style="background-color: ${GOLD}; color: ${NAVY}; font-weight: bold; font-family: Calibri, Arial, sans-serif; font-size: 11px; text-decoration: none; padding: 9px 18px; border-radius: 2px; display: inline-block; letter-spacing: 0.8px;">REVIEW ON STORVEX</a>
</td>
<td style="padding-right: 6px;">
<a href="${listingUrl}" style="background-color: ${NAVY}; color: #FFFFFF; font-weight: bold; font-family: Calibri, Arial, sans-serif; font-size: 11px; text-decoration: none; padding: 9px 18px; border-radius: 2px; display: inline-block; letter-spacing: 0.8px;">PROPERTY LISTING</a>
</td>
<td>
<a href="${pinDropUrl}" style="background-color: ${STEEL}; color: #FFFFFF; font-weight: bold; font-family: Calibri, Arial, sans-serif; font-size: 11px; text-decoration: none; padding: 9px 18px; border-radius: 2px; display: inline-block; letter-spacing: 0.8px;">PIN DROP</a>
</td>
</tr>
</table>`;
}

/**
 * Generate a section header row for data tables
 * @param {string} title - Section title (e.g., "SITE OVERVIEW", "DEMOGRAPHICS")
 */
export function sectionHeader(title) {
  return `<tr style="background-color: ${NAVY}; color: ${GOLD}; font-weight: bold;">
<td colspan="2" style="padding: 10px; font-size: 15px;">${title}</td>
</tr>`;
}

/**
 * Generate a data row for tables
 * @param {string} label - Row label
 * @param {string} value - Row value (can contain HTML)
 * @param {boolean} alt - Alternate row background
 */
export function dataRow(label, value, alt = false) {
  const bg = alt ? ' background-color: #f8f9fa;' : '';
  return `<tr style="${bg}">
<td style="width: 35%; font-weight: bold; color: ${NAVY}; border-bottom: 1px solid #ddd;">${label}</td>
<td style="border-bottom: 1px solid #ddd;">${value}</td>
</tr>`;
}

/**
 * Green badge for positive zoning/water/overlay status
 */
export function greenBadge(text) {
  return `<span style="color: green; font-weight: bold;">${text}</span>`;
}

/**
 * Generate full site recommendation email HTML
 *
 * STYLE RULES (locked):
 * - Opening: "Recommending a site for review in [market context]." Clean, direct. No "flagging" language.
 * - Buttons at TOP, before salutation
 * - Navy/gold data tables, green badges for BY-RIGHT / ALL CLEAR
 * - Storvex signature block at bottom (no "Best," sign-off)
 * - No trailing whitespace or artifacts after signature
 * - CC order for east team: To: MT, CC: Brian, Madeleine, Jose, then Dan
 *
 * @param {Object} site - Site data from Firebase
 * @returns {string} Complete HTML email body
 */
export function generateSiteRecEmail(site) {
  const {
    name, address, city, state, market,
    acreage, askingPrice,
    coordinates, listingUrl,
    pop3mi, income3mi, households3mi, homeValue3mi, growthRate, renterPct3mi,
    zoning, zoningNotes, zoningClassification,
    waterHookupStatus, waterProvider,
    ccSPC, projectedCCSPC, competitorNames, competingCCSF, pipelineSF,
    buildPlateSF, buildCost, totalProjectCost, stabilizedNOI, projectedYOC,
    highlights = [],
  } = site;

  const siteId = site.firebaseKey || site.id || '';
  const lat = coordinates ? coordinates.split(',')[0].trim() : '';
  const lon = coordinates ? coordinates.split(',')[1].trim() : '';
  const storvexUrl = `https://storvex.vercel.app/?site=${siteId}`;
  const pinDropUrl = `https://www.google.com/maps?q=${lat},${lon}`;
  const buttons = generateActionButtons({ storvexUrl, listingUrl, pinDropUrl });

  // Opening paragraph — clean, direct, no "flagging" language
  // Customize per site in the caller; this is the structural template
  return `<div style="font-family: Calibri, Arial, sans-serif; font-size: 14px; color: ${NAVY}; line-height: 1.6; margin: 0; padding: 0;">${buttons}<p>Matt,</p><p>Recommending a site for review in ${market || city + ', ' + state}. <!-- CUSTOMIZE OPENING PER SITE --></p><!-- DATA TABLES GO HERE -->${SIGNATURE_BLOCK}</div>`;
}

// Default export for convenience
export default {
  SIGNATURE_BLOCK,
  generateActionButtons,
  generateSiteRecEmail,
  sectionHeader,
  dataRow,
  greenBadge,
};
