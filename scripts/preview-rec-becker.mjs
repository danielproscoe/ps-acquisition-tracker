// Quick HTML-only generator for visual QC of the polished REC Package.
// Bundles reports.js + scoring.js + utils.js via esbuild, generates HTML for a
// real Becker site fixture, writes to /tmp for browser preview. No PDF, no Firebase.

import esbuild from 'esbuild';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Minimal Becker site fixture — same shape as production Firebase records.
const site = {
  id: 'hockley_tx_19250_becker',
  name: 'Hockley TX — 19250 Becker Rd',
  address: '19250 Becker Road',
  city: 'Hockley',
  state: 'TX',
  zip: '77447',
  market: 'Houston / NW Harris County',
  region: 'southwest',
  status: 'pending',
  phase: 'Prospect',
  acreage: '4.5008',
  askingPrice: '$1,200,000',
  pricePerAcre: '$266,621/ac',
  coordinates: '30.0569, -95.7985',

  listingSource: 'Off-market — Wendy Cline direct email 4/24/26',
  listingUrl: 'https://www.har.com/homedetail/19250-becker-rd-hockley-tx-77447/8096758',
  sellerBroker: 'Wendy Cline (Broker/Owner)',
  brokerFirm: 'Wendy Cline Properties Group',
  brokerEmail: 'wendy@wendyclineproperties.com',
  brokerPhone: '281-460-9360',
  brokerNotes: 'Existing relationship — prior Hockley deals. Wendy emailed Dan directly 4/24/26: "I am listing this property today for $1.2M." Survey attached. Off-market first-look. No public Crexi/LoopNet listing yet.',

  zoning: 'Unincorporated Harris County (NO ZONING)',
  zoningClassification: 'by-right',
  zoningUseTerm: 'N/A — TX Local Government Code Ch. 231 preempts county zoning authority',
  zoningOrdinanceSection: 'TX Local Government Code Ch. 231 (county zoning preemption)',
  zoningSource: 'Census Geographies API + memory hardcode 4/28/26',
  zoningVerifyDate: 'April 28, 2026',
  jurisdictionType: 'Unincorporated County (Harris County)',
  zoningNotes: 'Hockley has NO incorporated municipal government. TX Ch. 231 LGC preempts county zoning authority — storage by-right with no use restriction.',
  planningContact: 'Harris County Engineering / Permits',
  planningPhone: '713-274-3700',
  politicalRisk: 'Low — unincorporated county, no zoning hearings, no SUP/CUP risk',

  waterProvider: 'Northwest Freeway MUD',
  waterAvailable: true,
  insideServiceBoundary: true,
  waterHookupStatus: 'by-right',
  waterContact: 'Lonnie Lee, Regional Water Corporation — 281-897-9100 — billing@regionalwater.net',
  waterNotes: 'Northwest Freeway MUD — subject is at the heart of this MUD',
  fireFlowAdequate: true,
  sewerProvider: 'Septic (typical for 4.5ac outparcel)',
  sewerAvailable: true,
  electricProvider: 'CenterPoint Energy',
  threePhase: true,
  gasProvider: 'CenterPoint Energy',
  telecomProvider: 'Comcast/Xfinity + AT&T fiber',
  totalUtilityBudget: 'Standard commercial tap fees only — no line extension required',

  roadFrontage: '311 LF on Becker Rd',
  frontageRoadName: 'Becker Road',
  roadType: 'County-maintained 2-lane rural collector',
  trafficData: 'Becker Rd ~2,500-5,000 VPD; US-290 corridor ~70-85K AADT (TxDOT 2023)',
  nearestSignal: 'Becker Rd / US-290 frontage road (~0.5-0.8 mi south)',
  visibility: 'Rural Becker Rd low local VPD; US-290 corridor visibility limited',
  curbCuts: 'Existing driveway visible at Becker Rd frontage per survey',

  floodZone: 'Zone AE (100-year floodplain)',
  femaFloodZone: 'Zone AE',
  femaPanel: '48201C 0185 H, rev 11/15/2019',
  terrain: 'Flat — Houston coastal plain',

  // ESRI 1-3-5 mile rings
  pop1mi: '1,840',
  pop3mi: '19,420',
  pop5mi: '63,180',
  pop1mi_fy: '2,210',
  pop3mi_fy: '23,590',
  pop5mi_fy: '79,300',
  income1mi: '108500',
  income3mi: '101200',
  income5mi: '123400',
  households1mi: '650',
  households3mi: '6840',
  households5mi: '21900',
  homeValue1mi: '385000',
  homeValue3mi: '362500',
  homeValue5mi: '402000',
  popGrowth1mi: '3.72%',
  popGrowth3mi: '3.76%',
  popGrowth5mi: '4.81%',
  growthRate: '3.76%',
  renterPct3mi: '28%',
  demandDrivers: 'Bridgeland MPC (Howard Hughes 11K homes) · Sunterra (Land Tejas 4.5K homes) · Daikin Texas Tech Park (8,000 employees)',

  // Competition
  siteiqData: {
    nearestPS: 5.74,
    competitorCount: 1,
    ccSPC: 0.85,
    projectedCCSPC: 1.42,
    marketTier: 4,
    brokerConfirmedZoning: true,
    surveyClean: true,
  },
  competitorNames: 'My Garage Self Storage (drive-up only, 0.3 mi)',
  nearestCCCompetitor: 'iStorage 17010 Huffmeister Cypress (5.4 mi) — ~75K SF CC',
  nearestCompetitor: 'My Garage Self Storage (0.3 mi, drive-up only)',
  competitorTypes: '0 climate-controlled, 1 drive-up only within 3 mi',
  competingSF: '~28,000 SF total within 3 mi',
  competingCCSF: '0 SF CC within 3 mi',
  pipelineSF: 'No CC pipeline within 5 mi',

  // Survey scrub
  surveyVerdict: 'CLEAN',
  surveyEasementSummary: 'Diagonal CenterPoint electric ROW on eastern third (verified, recorded). Building plate fits western/center per Dan visual review. No gas/petroleum easements. No drainage easements consuming buildable area.',
  surveyAccessSummary: 'Single public road access on Becker Rd west boundary, 311 LF frontage. NOT landlocked. Standard storage destination access.',
  surveyScrubDate: 'Apr 29, 2026',

  redFlags: '(1) Zone AE 100-yr flood — $300-600K cost adder for slab elevation. (2) Diagonal easement on eastern third — building plate fits western/center.',
  keyStrengths: '(1) NO ZONING — unincorporated Harris County, by-right with zero entitlement risk. (2) Water by-right — Northwest Freeway MUD. (3) CC SPC 0.85 — SEVERELY UNDERSERVED.',
  summary: 'Off-market opportunity from Wendy Cline. Strong submarket with embedded demand drivers (Bridgeland, Sunterra, Daikin). Underwrite supports $1.2M ask given by-right zoning + zero CC competition + 5.74mi to nearest PS family.',
};

console.log('[1/3] Bundling reports.js + scoring.js + valuationAnalysis.js + utils.js...');
const entryCode = `
import { generateRECPackage } from '${path.posix.join(ROOT.replace(/\\/g, '/'), 'src/reports.js')}';
import { computeSiteScore } from '${path.posix.join(ROOT.replace(/\\/g, '/'), 'src/scoring.js')}';
import { SITE_SCORE_DEFAULTS, normalizeSiteScoreWeights } from '${path.posix.join(ROOT.replace(/\\/g, '/'), 'src/utils.js')}';
export { generateRECPackage, computeSiteScore, SITE_SCORE_DEFAULTS, normalizeSiteScoreWeights };
`;
const entryFile = path.join(ROOT, 'scripts', '_rec-preview-entry.mjs');
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
const bundleFile = path.join(ROOT, 'scripts', '_rec-preview-bundle.mjs');
writeFileSync(bundleFile, bundledCode, 'utf-8');
console.log(`     Bundled: ${(bundledCode.length / 1024).toFixed(1)}KB`);

console.log('[2/3] Generating REC HTML...');
const modUrl = 'file:///' + bundleFile.replace(/\\/g, '/') + '?v=' + Date.now();
const mod = await import(modUrl);
const config = mod.normalizeSiteScoreWeights(mod.SITE_SCORE_DEFAULTS);
const iq = mod.computeSiteScore(site, config);
const html = mod.generateRECPackage(site, iq, config);

const masterDir = path.posix.join(ROOT.replace(/\\/g, '/'), '..').replace(/\/scripts\/\.\./, '');
const outDir = 'C:/Users/danie/OneDrive/Desktop/MASTER FOLDER - CLAUDE';
const htmlOut = `${outDir}/rec-preview-becker.html`;
writeFileSync(htmlOut, html, 'utf-8');
console.log(`[3/3] Written: ${htmlOut} (${(html.length / 1024).toFixed(1)}KB)`);
console.log(`     SiteScore: ${typeof iq.score === 'number' ? iq.score.toFixed(2) : iq.score}/10 — ${iq.label || ''}`);
console.log('\nOpen at: http://localhost:4444/rec-preview-becker.html');
