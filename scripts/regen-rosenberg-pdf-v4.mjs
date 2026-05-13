// v4 — Same as v3 but uses inline site data (Firebase record was deleted; not routing to PS).
// Fetches nothing from Firebase — all site data is embedded here.

import esbuild from 'esbuild';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync, unlinkSync } from 'fs';
import puppeteer from 'puppeteer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SITE_ID = 'rosenberg_tx_0_benton_rd';

const masterDir = 'C:/Users/danie/OneDrive/Desktop/MASTER FOLDER - CLAUDE';
const desktopDir = 'C:/Users/danie/OneDrive/Desktop';
const htmlOut = `${masterDir}/rec-package-post-polish.html`;
const pdfDesktop = `${desktopDir}/REC Package — Rosenberg TX — 0 Benton Rd.pdf`;
const siteFolderDir = `${masterDir}/#2 - PS/Rosenberg TX - 0 Benton Rd`;
if (!existsSync(siteFolderDir)) mkdirSync(siteFolderDir, { recursive: true });
const pdfSiteFolder = `${siteFolderDir}/REC_Package_Rosenberg_TX_0_Benton_Rd_2026-04-22.pdf`;

// ── Inline site record (ESRI-verified 2026-04-22) ──
const site = {
  id: SITE_ID,
  name: "Rosenberg TX \u2014 0 Benton Rd",
  address: "0 Benton Rd",
  city: "Rosenberg",
  state: "TX",
  zip: "77469",
  market: "Fort Bend County TX \u2014 Houston SW MSA / Rosenberg / US-59/69 Corridor",
  region: "southwest",
  status: "pending",
  phase: "Prospect",
  acreage: "5.29",
  useableAcreage: "5.29 (outside floodplain per broker flyer)",
  askingPrice: "$1,613,027",
  pricePerAcre: "$305K/ac",
  pricePerSF: "$7.00/PSF",
  coordinates: "29.540083, -95.725137",
  coordinateStatus: "verified",
  listingSource: "LoopNet",
  listingUrl: "https://www.loopnet.com/Listing/0-Benton-Rd-Rosenberg-TX/40110301/",
  sellerBroker: "Keith Grothaus, CCIM, SIOR \u2014 Caldwell Land Co",
  brokerEmail: "kgrothaus@caldwellcos.com",
  brokerPhone: "281.664.6635",
  brokerFirm: "Caldwell Land Co (Caldwell Companies)",
  brokerNotes: "IABS dated 11-3-25; listing ~5.5 mo old. Flyer cites broker-derived demographics understating 3-mi market. ESRI standard 3-mi at verified Benton Rd coordinate shows 66,691 pop / $107,295 HHI / 2.38% CAGR. Flyer acknowledges 'utilities may be available through adjacent MUD' — confirms by-request water extension.",
  zoning: "Unrestricted (City of Rosenberg has no zoning)",
  zoningClassification: "by-right",
  zoningUseTerm: "Not applicable \u2014 use not restricted by zoning (Rosenberg UDC regulates dev standards only)",
  zoningOrdinanceSection: "City of Rosenberg UDC Ordinance No. 2017-07",
  zoningSource: "https://rosenbergtx.gov/281/Unified-Development-Code + FAQ #205",
  zoningVerifyDate: "April 22, 2026",
  zoningTableAccessed: true,
  zoningNotes: "City of Rosenberg explicitly does NOT have a Zoning Ordinance or zoning map per Official City FAQ #205. The UDC (Ord. 2017-07) governs site development standards but does NOT regulate use. Self-storage is permitted by-right. No SUP or CUP required. No overlay districts restrict storage.",
  jurisdictionType: "City of Rosenberg (incorporated, Fort Bend County)",
  overlayDistrict: "None identified",
  overlayCostImpact: "None anticipated",
  planningContact: "City of Rosenberg Development Assistance Center",
  planningPhone: "832-595-3300",
  planningEmail: "planning@rosenbergtx.gov",
  politicalRisk: "Low \u2014 by-right unrestricted use, no public hearing required.",
  storageSpecificOrdinance: "None identified in Rosenberg UDC",
  waterProvider: "Fort Bend County MUD (FBCMUD 162 / FBCMUD 146 via Si Environmental) \u2014 by-request extension from adjacent MUD-served subdivisions",
  waterAvailable: true,
  insideServiceBoundary: null,
  waterHookupStatus: "by-request",
  waterContact: "Si Environmental, LLC (operates FBCMUD 146, 162 + more) \u2014 6420 Reading Road, Rosenberg TX 77471 \u2014 832-490-1600",
  distToWaterMain: "TBD (<500 LF estimated from adjacent Summer Lakes subdivision mains)",
  waterMainSize: "TBD \u2014 confirm with MUD engineer",
  fireFlowAdequate: null,
  nearestHydrant: "TBD \u2014 Summer Lakes residential hydrants likely within 500-1,000 LF",
  sewerProvider: "Same serving MUD (shared water/sewer service)",
  sewerAvailable: true,
  distToSewerMain: "TBD",
  electricProvider: "CenterPoint Energy",
  threePhase: null,
  gasProvider: "CenterPoint Energy",
  telecomProvider: "AT&T, Comcast/Xfinity",
  waterTapFee: "TBD",
  sewerTapFee: "TBD",
  impactFees: "Fort Bend County transportation impact fees applicable",
  lineExtensionCost: "TBD",
  totalUtilityBudget: "TBD pending MUD engagement",
  utilityCapacity: "No published moratorium in Fort Bend MUDs as of 4/22/26",
  utilityNotes: "Broker flyer explicitly flags 'utilities may be available through adjacent MUD' — by-request status confirmed. Call Si Environmental 832-490-1600 to confirm serving MUD + extension cost.",
  roadFrontage: "\u00B1400 LF on Benton Rd (per broker flyer)",
  frontageRoadName: "Benton Rd",
  roadType: "Local arterial / collector",
  medianType: "Open median with protected left-turn (per broker flyer)",
  trafficData: "Benton Rd 9,912 VPD (TXDOT 2024). Reading Rd 7,192 VPD. FM 762 @ I-69 16,874 VPD. US-59/69 main 60K-172K VPD (<2 mi W).",
  nearestSignal: "TBD \u2014 likely Reading Rd @ Benton Rd (~0.5-1 mi N)",
  curbCuts: "Two existing curb cuts on site (per broker flyer)",
  decelLane: "Unlikely required given 9,912 VPD and existing curb cuts",
  drivewayGrade: "Flat per aerial",
  visibility: "Good \u2014 \u00B1400' frontage on Benton Rd, two curb cuts, open median = visible to N and S-bound traffic",
  demoSource: "ESRI ArcGIS GeoEnrichment 2025 (current year estimates + 2030 projections)",
  pop1mi: "10,784",
  pop3mi: "66,691",
  pop5mi: "136,677",
  pop1mi_fy: "12,383",
  pop3mi_fy: "75,032",
  pop5mi_fy: "151,154",
  income1mi: "$123,825",
  income3mi: "$107,295",
  income5mi: "$100,916",
  households1mi: "3,303",
  households3mi: "23,286",
  households5mi: "46,857",
  homeValue1mi: "$384,609",
  homeValue3mi: "$367,541",
  homeValue5mi: "$366,627",
  growthRate: "2.38% 5-yr CAGR (3-mi, ESRI 2025\u21922030)",
  popGrowth1mi: "2.80%",
  popGrowth3mi: "2.38%",
  popGrowth5mi: "2.03%",
  growth1mi: "2.80%",
  growth5mi: "2.03%",
  renterPct3mi: "24.6%",
  marketRents: {
    source: "Direct operator website pull — CubeSmart.com + PublicStorage.com (CC 10x10 unit pages)",
    auditStatus: "verified",
    auditDate: "April 22, 2026",
    methodology: "CC 10x10 units ONLY. Storage King excluded (zero CC product). NSA/iStorage excluded (no accessible CC unit rates). Blended averages avoided.",
    rates: [
      { operator: "CubeSmart (adjacent)", address: "102 Benton Rd, Rosenberg TX 77469", unitSize: "10x10 CC", streetRate: 124, promoRate: 112, perSFStreet: 1.24, perSFPromo: 1.12, source: "cubesmart.com direct" },
      { operator: "Public Storage #22073", address: "5601 Avenue I, Rosenberg TX 77471", unitSize: "10x10 CC", streetRate: 174, promoRate: 104, perSFStreet: 1.74, perSFPromo: 1.04, source: "publicstorage.com direct" },
    ],
    avgStreetRatePerSF: 1.49,
    avgPromoRatePerSF: 1.08,
    modeledStabilizedRate: 1.45,
    verdict: "VERIFIED — modeled $1.45/SF/mo stabilized rate sits between promo avg ($1.08) and street avg ($1.49). Realistic for Year 3-5 stabilized via ECRI/street bumps.",
    notes: "CC 10x10 street rate band: $1.24 (CubeSmart) to $1.74 (PS) = $1.49/SF avg street. Model $1.45 is defensible.",
  },
  competitorNames: "CubeSmart 102 Benton Rd (adjacent), NSA/Move It 5820 Ave I, PS #22073 5601 Ave I, Storage King 3619 Ave H, NSA 1728 Crabb River Rd",
  nearestCompetitor: "CubeSmart Self Storage 102 Benton Rd \u2014 adjacent (0.1-0.2 mi) \u2014 CC",
  nearestCCCompetitor: "CubeSmart 102 Benton Rd \u2014 adjacent (0.1-0.2 mi) \u2014 CC",
  nearestPSFamily: "NSA 1728 Crabb River Rd, Richmond TX \u2014 2.38 mi",
  competitorTypes: "CubeSmart (CC + drive-up, 2-story indoor + U-Haul), PS (CC-dominant), NSA Move It (CC + drive-up), Storage King (drive-up only)",
  competingSF: "~300-370K SF total within 3 mi",
  competingCCSF: "~180-220K SF CC within 3 mi",
  ccSPC: "~3.0 SF/capita CC (200K CC SF \u00F7 66,691 pop = 3.00 CC SPC \u2014 MODERATE to UNDERSERVED)",
  projectedCCSPC: "~2.9 SF/capita CC projected 5-yr (no CC pipeline within 3 mi; pop growth outpaces supply)",
  pipelineSF: "0 SF CC pipeline within 3 mi. Brazos Town Center CubeSmart expansion 33,500 SF at ~3.8 mi (outside 3-mi ring).",
  demandSupplySignal: "CC SPC ~3.0 = MODERATE/UNDERSERVED. Growth 2.38% CAGR improves projected SPC to ~2.9. CubeSmart adjacent validates demand. PS family presence (3 within 3 mi) confirms submarket.",
  siteiqData: {
    nearestPS: 2.38,
    competitorCount: 5,
    ccSPC: 3.0,
    projectedCCSPC: 2.9,
    marketTier: 4,
    brokerConfirmedZoning: true,
    surveyClean: false,
  },
  floodZone: "Outside floodplain per broker flyer",
  floodZoneSource: "Broker flyer (Caldwell Land Co, 11/03/25) \u2014 verify against FEMA Panel 48157C at site plan",
  terrainGrade: "Flat",
  gradingRisk: "Low",
  wetlands: "None visible on aerial; verify NWI at site plan",
  soilConcerns: "Fort Bend County expansive clay (gumbo soils) \u2014 geotech recommended pre-close",
  demandDrivers: "(1) 10,000+ rooftop pipeline within 5 mi \u2014 Summer Lakes 846, Bonbrook Plantation 1,607, Bridlewood 1,131, Stonecreek Estates 1,700 + 10+ additional subdivisions. (2) Johnson Development 1,500 AC future tract east. (3) Lamar CISD anchor. (4) HEB/Target/Home Depot anchor node 1.5-2 mi W. (5) US-59/69 Corridor 60K-172K VPD <2 mi W. (6) 2.38% CAGR / $107K HHI / Fort Bend County fastest-growing TX county.",
  summary: "SiteScore PRIME. Unrestricted use \u2014 by right (City of Rosenberg has no zoning; UDC Ord 2017-07 governs dev standards only per FAQ #205). CC SPC ~3.0 SF/capita (moderate tier), projected 5-yr ~2.9. 5 competitors within 3 mi (CubeSmart adjacent 102 Benton is nearest threat). 5.29ac, \u00B1400' frontage on Benton Rd (9,912 VPD), two curb cuts, open median. No flood. Houston SW Fort Bend high-growth corridor. Strong demographics \u2014 3-mi pop 66,691 / $107K HHI / 2.38% CAGR. Water by-request through adjacent MUD (Si Environmental 832-490-1600). $1.61M ask / $305K/ac.",
  latestNote: "VETTED 4/22. Rosenberg TX in-city parcel, unrestricted use. ESRI demos 3-mi: 66,691 pop / $107K HHI / 2.38% CAGR. 5.29ac, \u00B1400' Benton Rd frontage. CC SPC ~3.0. Water by-request via FBCMUD. $1.61M / 5.29ac.",
  latestNoteDate: "Apr 22, 2026",
  buyerStrategy: "Primary: SROA (Beau Raich braich@sroa.com). Secondary: SmartStop (Wayne Johnson), Storage King (Brett/Gupta/Manuel).",
};

// ── 1. Bundle reports.js ──
console.log('[1/4] Bundling reports.js + scoring.js + valuationAnalysis.js via esbuild...');
const entryCode = `
import { generateRECPackage } from '${path.posix.join(ROOT.replace(/\\/g, '/'), 'src/reports.js')}';
import { computeSiteScore } from '${path.posix.join(ROOT.replace(/\\/g, '/'), 'src/scoring.js')}';
import { SITE_SCORE_DEFAULTS, normalizeSiteScoreWeights } from '${path.posix.join(ROOT.replace(/\\/g, '/'), 'src/utils.js')}';
export { generateRECPackage, computeSiteScore, SITE_SCORE_DEFAULTS, normalizeSiteScoreWeights };
`;
const entryFile = path.join(ROOT, 'scripts', '_rec-bundle-entry.mjs');
writeFileSync(entryFile, entryCode, 'utf-8');

const bundleResult = await esbuild.build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  write: false,
  logLevel: 'warning',
  loader: { '.js': 'jsx' },
  jsx: 'transform',
  external: [],
});
const bundledCode = bundleResult.outputFiles[0].text;
const bundleFile = path.join(ROOT, 'scripts', '_rec-bundle.mjs');
writeFileSync(bundleFile, bundledCode, 'utf-8');
console.log(`     Bundled: ${(bundledCode.length / 1024).toFixed(1)}KB`);

// ── 2. Generate REC Package HTML ──
console.log('[2/4] Generating REC Package HTML...');
const modUrl = 'file:///' + bundleFile.replace(/\\/g, '/') + '?v=' + Date.now();
const mod = await import(modUrl);
const config = mod.normalizeSiteScoreWeights(mod.SITE_SCORE_DEFAULTS);
const iq = mod.computeSiteScore(site, config);
const html = mod.generateRECPackage(site, iq, config);
writeFileSync(htmlOut, html, 'utf-8');
console.log(`     HTML written: ${htmlOut} (${(html.length / 1024).toFixed(1)}KB)`);
console.log(`     SiteScore: ${typeof iq.score === 'number' ? iq.score.toFixed(2) : iq.score}/10`);

// ── 3. Render HTML → PDF via Puppeteer ──
console.log('[3/4] Rendering PDF via Puppeteer...');
const winTemp = process.env.TEMP || process.env.TMP || 'C:/Users/danie/AppData/Local/Temp';
const tmpHtml = path.join(winTemp, '_rosenberg-render.html').replace(/\\/g, '/');
writeFileSync(tmpHtml, html, 'utf-8');

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
    '--disable-features=GcmRegistration,OptimizationHints,Translate'],
  protocolTimeout: 180000,
});
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('     [pageerror]', e.message));
  page.on('error', e => console.log('     [error]', e.message));
  const fileUrl = 'file:///' + tmpHtml.replace(/\\/g, '/');
  console.log(`     Navigating to ${fileUrl}`);
  await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));

  const pdfOpts = {
    format: 'Letter',
    printBackground: true,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
  };

  const { copyFileSync } = await import('node:fs');
  const tmpPdf = path.join(winTemp, '_rosenberg.pdf').replace(/\\/g, '/');
  if (existsSync(tmpPdf)) { try { unlinkSync(tmpPdf); } catch {} }
  await page.pdf({ ...pdfOpts, path: tmpPdf });
  if (!existsSync(tmpPdf) || statSync(tmpPdf).size < 10000) {
    throw new Error(`Puppeteer page.pdf did not produce ${tmpPdf}`);
  }
  console.log(`     Temp PDF: ${tmpPdf} (${statSync(tmpPdf).size.toLocaleString()} bytes)`);

  for (const dst of [pdfDesktop, pdfSiteFolder]) {
    if (existsSync(dst)) { try { unlinkSync(dst); } catch {} }
    copyFileSync(tmpPdf, dst);
    if (!existsSync(dst) || statSync(dst).size < 10000) {
      throw new Error(`Copy to ${dst} failed`);
    }
  }
  console.log(`     Desktop PDF: ${pdfDesktop}`);
  console.log(`     Site-folder PDF: ${pdfSiteFolder}`);
} finally {
  await browser.close();
}

// ── 4. Report ──
console.log('[4/4] Done.');
const st1 = statSync(pdfDesktop);
const st2 = statSync(pdfSiteFolder);
console.log(`     Desktop PDF: ${st1.size.toLocaleString()} bytes`);
console.log(`     Site-folder PDF: ${st2.size.toLocaleString()} bytes`);
process.exit(0);
