// ─── BuyerFit™ Routing Engine — Per-Operator Site-to-Buyer Match ───
//
// Third lens alongside SiteScore (is the site good?) and PortfolioFit
// (does PS specifically buy this kind of site?). BuyerFit answers:
// "If PS passes, who else is the right buyer?"
//
// Operationalizes memory/buyer-routing-matrix.md (49 operators, v6) into
// machine-actionable routing intelligence. Every site is scored against
// every viable buyer; the dashboard surfaces top-N with hot-capital tier
// indicators and one-click outreach hooks.
//
// ADDITIVE — never modifies SiteScore (scoring.js) or PortfolioFit
// (portfolioFit.js). Reads operator-matrix.json from public/.
//
// Algorithm (per public/operator-matrix-architecture.md §4.1):
//   STEP 1 — CLASSIFY  : extract dealType + geography + size + price
//   STEP 2 — FILTER    : eliminate operators whose hard-gates fail
//   STEP 3 — SCORE     : tier weight + pressure + product fit + geo + recency
//   STEP 4 — ENRICH    : attach pitch hook + contacts + signature
//   STEP 5 — RANK      : sort by score desc, return top-N
//
// Hardcoded behavior per memory files (verified 2026-04-26):
//   - Brock Wollent is a COMPETITOR (feedback_brock-is-competitor.md) —
//     never surfaced as a routing destination. PS routing uses DW/MT only.
//   - DW rejects → SK fallback (feedback_dw-rejects-to-sk.md) — when the
//     phase indicates DW pass on a strong site, Storage King is boosted.
//   - DO_NOT_ROUTE list (operator-matrix.json:1887) — 16 entities filtered.

let _matrixCache = null;

async function loadMatrix() {
  if (_matrixCache) return _matrixCache;
  try {
    const res = await fetch('/operator-matrix.json');
    if (!res.ok) throw new Error(`Operator matrix fetch failed: ${res.status}`);
    _matrixCache = await res.json();
    return _matrixCache;
  } catch (e) {
    console.warn('BuyerFit: operator matrix unavailable —', e.message);
    return null;
  }
}

export async function preloadOperatorMatrix() {
  return loadMatrix();
}

// ─── Constants ───

// Tier base scores (Hot Capital ranking from operator-matrix.json:11-18)
const TIER_BASE_SCORE = {
  'TIER_1_HOT_CAPITAL': 7.5,
  'TIER_2_ACTIVE':      6.5,
  'TIER_3_MEDIUM':      5.5,
  'TIER_4_SELECTIVE':   4.5,
  'TIER_5_HYPER_LOCAL': 4.0,
};

// Tier display colors (used by BuyerFitBadge + RoutingEnginePanel)
export const TIER_COLOR = {
  'TIER_1_HOT_CAPITAL': '#22C55E',  // emerald — peak urgency
  'TIER_2_ACTIVE':      '#3B82F6',  // blue — active
  'TIER_3_MEDIUM':      '#F59E0B',  // amber — disciplined
  'TIER_4_SELECTIVE':   '#8B5CF6',  // violet — selective
  'TIER_5_HYPER_LOCAL': '#94A3B8',  // slate — hyper-local
  'DO_NOT_ROUTE':       '#EF4444',  // red — skip
  'DEVELOPER_ONLY':     '#64748B',  // gray — non-buyer
};

export const TIER_LABEL = {
  'TIER_1_HOT_CAPITAL': 'HOT CAPITAL',
  'TIER_2_ACTIVE':      'ACTIVE',
  'TIER_3_MEDIUM':      'MEDIUM',
  'TIER_4_SELECTIVE':   'SELECTIVE',
  'TIER_5_HYPER_LOCAL': 'HYPER-LOCAL',
};

// State → region rollup for geography matching
const STATE_REGION = {
  TX: ['Sunbelt', 'SE', 'South', 'Southwest'],
  FL: ['Sunbelt', 'SE', 'South'],
  GA: ['Sunbelt', 'SE', 'South'],
  AL: ['Sunbelt', 'SE', 'South'],
  NC: ['Sunbelt', 'SE', 'South'],
  SC: ['Sunbelt', 'SE', 'South'],
  TN: ['Sunbelt', 'SE', 'South'],
  MS: ['Sunbelt', 'SE', 'South'],
  AR: ['Sunbelt', 'SE', 'South'],
  LA: ['Sunbelt', 'SE', 'South'],
  KY: ['Midwest', 'SE'],
  IL: ['Midwest'],
  IN: ['Midwest'],
  OH: ['Midwest'],
  MI: ['Midwest'],
  WI: ['Midwest'],
  MN: ['Midwest'],
  IA: ['Midwest'],
  MO: ['Midwest'],
  KS: ['Midwest'],
  NE: ['Midwest'],
  ND: ['Midwest'],
  SD: ['Midwest'],
  NY: ['NE', 'Northeast'],
  NJ: ['NE', 'Northeast'],
  PA: ['NE', 'Northeast', 'Mid-Atlantic'],
  MA: ['NE', 'Northeast'],
  CT: ['NE', 'Northeast'],
  RI: ['NE', 'Northeast'],
  VT: ['NE', 'Northeast'],
  NH: ['NE', 'Northeast'],
  ME: ['NE', 'Northeast'],
  MD: ['NE', 'Mid-Atlantic'],
  DE: ['NE', 'Mid-Atlantic'],
  DC: ['NE', 'Mid-Atlantic'],
  VA: ['Mid-Atlantic', 'SE'],
  WV: ['Mid-Atlantic', 'Midwest'],
  AZ: ['Southwest', 'Sunbelt', 'West'],
  NM: ['Southwest', 'Sunbelt'],
  OK: ['Southwest', 'South'],
  NV: ['West', 'Southwest'],
  UT: ['West', 'Mountain'],
  CO: ['West', 'Mountain'],
  WY: ['West', 'Mountain'],
  MT: ['West', 'Mountain'],
  ID: ['West', 'Mountain'],
  CA: ['West'],
  OR: ['West', 'PNW'],
  WA: ['West', 'PNW'],
  AK: ['West'],
  HI: ['West'],
};

// Top-50 MSAs (rough — used to evaluate "Top-50 MSA only" hardNo)
const TOP_50_MSA_STATES = new Set([
  'NY','CA','TX','FL','IL','PA','OH','GA','NC','MI','VA','WA','AZ','MA','TN','IN','MO','MD','WI','CO','MN','SC','AL','LA','KY','OR','OK','CT','UT','IA','NV','AR','MS','KS','NE'
]);

// ─── Site classification ───

function parseNum(v) {
  if (v == null || v === '') return NaN;
  const s = String(v);
  const m = s.match(/-?[\d,.]+/);
  if (!m) return NaN;
  const n = parseFloat(m[0].replace(/,/g, ''));
  return isNaN(n) ? NaN : n;
}

export function classifyDealType(site) {
  if (site.dealType) return site.dealType;
  const sum = ((site.summary || '') + ' ' + (site.name || '') + ' ' + (site.phase || '')).toLowerCase();
  const phase = (site.phase || 'Prospect').toLowerCase();

  // Existing facility signals
  if (/portfolio/.test(sum)) return 'PORT';
  if (/c-of-o|c\/o|lease.?up/.test(sum)) return 'CO-LU';
  if (/conversion|repurpose|big.?box/.test(sum)) return 'CONV-VAN';
  if (/stabilized/.test(sum)) return 'EX-STAB';
  if (/value.?add/.test(sum) && /existing/.test(sum)) return 'EX-VAL';

  // Land — distinguish entitled vs raw by zoning
  const z = (site.zoningClassification || '').toLowerCase();
  if (z === 'by-right' || z === 'permitted') return 'GU-ENT';
  return 'GU-RAW';
}

// ─── Hard-gate matchers ───

function dealTypeMatches(siteDealType, opDealTypes) {
  if (!opDealTypes || opDealTypes.length === 0) return true;
  const norm = (s) => String(s).toLowerCase().replace(/[\s\-_/]/g, '');
  const a = norm(siteDealType);

  const aliasMap = {
    'guraw':   ['groundup', 'rawland', 'land', 'rawlandgroundup', 'guraw'],
    'guent':   ['groundup', 'groundupentitled', 'entitled', 'permitready', 'guent'],
    'colu':    ['cofo', 'cofolease', 'leaseup', 'cleaseup', 'colu'],
    'exval':   ['existingvalueadd', 'valueadd', 'existing', 'valueaddexisting', 'exval'],
    'exstab':  ['existingstabilized', 'stabilized', 'existing', 'classastabilized', 'exstab'],
    'convbig': ['conversion', 'bigboxconv', 'bigbox'],
    'convvan': ['conversion', 'vanilla'],
    'port':    ['portfolio', 'portfolios', 'port'],
  };
  const aliases = aliasMap[a] || [a];

  for (const opDT of opDealTypes) {
    const b = norm(opDT);
    if (b === 'all' || b === 'any') return true;
    if (aliases.some(al => b.includes(al))) return true;
  }
  return false;
}

function geographyMatches(state, city, opGeo, op) {
  if (!state) return true; // give the benefit of the doubt only when state genuinely unknown
  const st = state.toUpperCase();
  const cityLower = (city || '').toLowerCase();
  const regions = STATE_REGION[st] || [];

  // Build a unified geography set from ALL sources — uwProfile.geography PLUS
  // portfolio.geography PLUS portfolio.concentrations. Many tier-5 hyper-local
  // operators (All Aboard FL, Stop & Stor NYC, Westy CT/NY/NJ) declare their
  // territory in portfolio.geography rather than uwProfile.geography. If we
  // only check uwProfile we'd let them route everywhere → wrong.
  const allGeo = [
    ...(opGeo || []),
    ...(op?.portfolio?.geography ? (Array.isArray(op.portfolio.geography) ? op.portfolio.geography : [op.portfolio.geography]) : []),
    ...(op?.portfolio?.concentrations || []),
  ];
  if (allGeo.length === 0) return true; // truly no metadata — benefit of the doubt

  const hasNationwide = allGeo.some(g => /nationwide/i.test(String(g)));
  if (hasNationwide) return true;

  for (const g of allGeo) {
    const gl = String(g).toLowerCase().trim();
    if (gl.length === 2 && gl.toUpperCase() === st) return true;
    // State code in a list/string ("TX/OK/LA/NM/PNW")
    const re = new RegExp(`(^|[^a-z])${st.toLowerCase()}([^a-z]|$)`);
    if (re.test(gl)) return true;
    // Region name match
    if (regions.some(r => gl.includes(r.toLowerCase()))) return true;
    // City name match (e.g. "Cincinnati", "Indianapolis")
    if (cityLower && gl.includes(cityLower)) return true;
  }

  return false;
}

// Distinguish stabilized-acquisition price gates from raw-land deals.
// Operators' priceLow/priceHigh in operator-matrix.json reflect the price
// of stabilized facility acquisitions ($5-100M). Raw land sells for 1/5 to
// 1/10 of that. Applying the floor to GU-RAW would wrongly filter SROA off
// every $1.5M TX land deal — even though SROA explicitly buys ground-up.
// Solution: skip the price gate for ground-up dealTypes; rely on geography
// + hardNos + size to filter instead.
function isPriceGateApplicable(dealType) {
  return dealType === 'EX-STAB' || dealType === 'EX-VAL' || dealType === 'CO-LU' || dealType === 'PORT';
}

function hardNoMatches(rule, site, dealType, ctx) {
  if (!rule) return false;
  const r = String(rule).toLowerCase();
  const acreage = parseNum(site.acreage);
  const pop3mi = parseNum(site.pop3mi);
  const sf = parseNum(site.proposedNRSF || site.buildingSF);
  const ccShare = parseNum(site.ccSharePct);

  // Ground-up exclusions (Merit Hill, etc.)
  if (/ground.?up/.test(r) && (dealType === 'GU-RAW' || dealType === 'GU-ENT')) return true;
  if (/land.?hard.?no/.test(r) && (dealType === 'GU-RAW' || dealType === 'GU-ENT')) return true;

  // Demographic / market exclusions
  if (/rural/.test(r) && isFinite(pop3mi) && pop3mi < 5000) return true;
  if (/tertiary/.test(r) && isFinite(pop3mi) && pop3mi < 25000) return true;
  if (/sub.?500k.?pop/.test(r) || /<500k/.test(r)) {
    if (isFinite(pop3mi) && pop3mi < 35000) return true; // proxy: 3-mi < 35K ~ MSA <500K
  }
  if (/non.top.?50.?msa/.test(r) || /top.?50.?msa.?only/.test(r)) {
    // Only flag when state truly out of Top-50 footprint
    const st = (site.state || '').toUpperCase();
    if (st && !TOP_50_MSA_STATES.has(st)) return true;
  }

  // Size exclusions
  if (/sub.?2(\b|[^.])/.test(r) && isFinite(acreage) && acreage < 2) return true;
  if (/sub.?2\.5/.test(r) && isFinite(acreage) && acreage < 2.5) return true;
  if (/sub.?3\.5/.test(r) && isFinite(acreage) && acreage < 3.5) return true;
  if (/sub.?35k.?sf/.test(r) && isFinite(sf) && sf > 0 && sf < 35000) return true;

  // Product exclusions
  if (/drive.?up.*secondary/.test(r) && isFinite(ccShare) && ccShare < 25) return true;
  if (/standalone.?drive.?up/.test(r) && isFinite(ccShare) && ccShare === 0) return true;
  if (/non.?dense.?submarket/.test(r) && isFinite(pop3mi) && pop3mi < 25000) return true;

  // CA-specific (Derrel's-style) — skip out-of-state
  if (/ca.?only|california.?only/.test(r) && site.state !== 'CA') return true;

  // Geography exclusions handled separately by geographyMatches; ignore here

  return false;
}

// ─── Scoring ───

function scoreCandidate(name, op, site, dealType) {
  const tier = op.tier || 'TIER_3_MEDIUM';
  const uw = op.uwProfile || {};
  const portfolio = op.portfolio || {};
  let score = TIER_BASE_SCORE[tier] != null ? TIER_BASE_SCORE[tier] : 5.0;

  // Deployment pressure bonus
  const pressure = String(uw.deploymentPressure || '').toUpperCase();
  if (pressure.includes('VERY HIGH')) score += 0.6;
  else if (pressure.includes('🔻 HIGH') || pressure.match(/\bHIGH\b/)) score += 0.4;
  else if (pressure.includes('MEDIUM')) score += 0.15;
  else if (pressure.includes('LOW')) score -= 0.2;

  // Capital recency bonus (fund close < 24mo)
  const capital = op.capital || {};
  const close = capital.vintageClose ? new Date(capital.vintageClose + '-01') : null;
  if (close && !isNaN(close.getTime())) {
    const months = (Date.now() - close.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (months < 12) score += 0.4;
    else if (months < 24) score += 0.2;
  }

  // Product fit
  const acreage = parseNum(site.acreage);
  const ccShare = parseNum(site.ccSharePct);
  const productMix = String(uw.productMix || '').toLowerCase();
  if (isFinite(ccShare) && productMix.includes('cc')) {
    if (ccShare >= 50) score += 0.4;
    else if (ccShare >= 25) score += 0.2;
  }
  if (productMix.includes('multi-story') && isFinite(acreage) && acreage >= 2.5 && acreage <= 4) score += 0.3;
  if (productMix.includes('one-story') && isFinite(acreage) && acreage >= 3.5) score += 0.2;
  if (productMix.includes('class a') && site.zoningClassification === 'by-right') score += 0.15;

  // Geography precision (state appears in concentrations)
  const st = (site.state || '').toUpperCase();
  const concentrations = portfolio.concentrations || [];
  const inConcentration = concentrations.some(c => String(c).toUpperCase().includes(st));
  if (st && inConcentration) score += 0.5;

  // Active expansion target
  const newMarkets = portfolio.newMarkets2026 || portfolio.newMarkets || [];
  if (newMarkets.some(m => String(m).toUpperCase().includes(st))) score += 0.6;

  // PS-validation bonus for non-PS operators (close to PS = validates submarket)
  const nearPS = parseNum(site.siteiqData?.nearestPS);
  if (isFinite(nearPS) && nearPS < 5 && name !== 'Public Storage') score += 0.15;

  // Off-market preference match
  const listingSrc = String(site.listingSource || '').toLowerCase();
  const offMkt = String(uw.offMarketPreference || '').toLowerCase();
  if (listingSrc.includes('off-market') && offMkt.includes('off')) score += 0.2;

  // Penalize hardNo near-misses (operator was filterable but had concerning rules)
  const hardNos = uw.hardNos || [];
  if (hardNos.some(r => /tertiary|rural|non.?dense/.test(String(r).toLowerCase()))) {
    if (parseNum(site.pop3mi) < 30000) score -= 0.2;
  }

  return Math.max(0, Math.min(10, score));
}

// ─── Special routing rules (memory-driven) ───

function applySpecialRules(ranked, site, ctx) {
  // Brock Wollent is a competitor — never list as routing destination.
  // (He doesn't appear in operator-matrix.json by name; this is a safety net.)
  ranked = ranked.filter(c => !/brock/i.test(c.operator));

  // DW pass → boost Storage King (memory feedback_dw-rejects-to-sk.md)
  const phase = String(site.phase || '').toLowerCase();
  const note = String(site.latestNote || site.summary || '').toLowerCase();
  const dwPassed = /dw.?pass|dw.?reject|passed.?per.?dw|dw.?dead|dw.?too.?rich/.test(phase + ' ' + note);
  if (dwPassed) {
    const sk = ranked.find(c => /storage king/i.test(c.operator));
    if (sk) sk.score = Math.min(10, sk.score + 0.6);
  }

  // DFW ground-up: PS gets a soft penalty (Brock displacement risk)
  const st = (site.state || '').toUpperCase();
  const city = String(site.city || '').toLowerCase();
  const isDFW = st === 'TX' && /(dallas|fort worth|frisco|plano|mckinney|denton|allen|arlington|irving|grand prairie)/.test(city);
  const dealType = ctx.dealType;
  if (isDFW && (dealType === 'GU-RAW' || dealType === 'GU-ENT')) {
    const ps = ranked.find(c => /^public storage$/i.test(c.operator));
    if (ps) ps.score = Math.max(0, ps.score - 0.5);
    // Boost SROA, Metro, Devon (from memory: feedback_brock-is-competitor.md)
    ['SROA Capital', 'Metro Self Storage', 'Devon Self Storage'].forEach(n => {
      const o = ranked.find(c => c.operator === n);
      if (o) o.score = Math.min(10, o.score + 0.25);
    });
  }

  // Re-sort after adjustments
  ranked.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
    return (a.hotCapitalRank || 99) - (b.hotCapitalRank || 99);
  });

  return ranked;
}

// ─── Main entry: computeBuyerFit ───

export function computeBuyerFit(site, matrix, options = {}) {
  if (!matrix || !matrix.operators) {
    return {
      topBuyer: null,
      topBuyerScore: 0,
      topBuyerTier: null,
      topBuyerHook: null,
      ranked: [],
      rankedAll: [],
      hardGateFails: [],
      matrixSize: 0,
      classification: 'NO MATRIX',
      classColor: '#64748B',
      dealType: null,
      notes: 'Operator matrix unavailable — run scripts/build-operator-matrix.mjs',
    };
  }

  const dealType = classifyDealType(site);
  const state = (site.state || '').toUpperCase();
  const city = String(site.city || '');
  const askingPrice = parseNum(site.askingPrice);
  const ctx = { dealType, state, city, askingPrice };

  const candidates = [];
  const fails = [];
  let matrixSize = 0;

  for (const [name, op] of Object.entries(matrix.operators)) {
    // Skip metadata + duplicates
    if (name.endsWith('_META') || op.tier === 'DUPLICATE' || op.tier === 'ALIAS-SEE-StorageMart') continue;
    matrixSize++;

    // Tier-based exclusions
    if (op.tier === 'DO_NOT_ROUTE') {
      fails.push({ operator: name, reason: 'DO_NOT_ROUTE list' });
      continue;
    }
    if (op.tier === 'DEVELOPER_ONLY') {
      // Westy is land-only in CT/NY/NJ — fall through to geo + dealType filter below
      // but flag for transparency
    }

    const uw = op.uwProfile || {};

    // Hard-gate: deal type
    if (uw.dealTypes && uw.dealTypes.length > 0 && !dealTypeMatches(dealType, uw.dealTypes)) {
      fails.push({ operator: name, reason: `dealType ${dealType} not in [${uw.dealTypes.slice(0, 3).join(', ')}${uw.dealTypes.length > 3 ? '…' : ''}]` });
      continue;
    }

    // Hard-gate: geography
    if (uw.geography && !geographyMatches(state, city, uw.geography, op)) {
      fails.push({ operator: name, reason: `state ${state || '?'} not in geography` });
      continue;
    }

    // Hard-gate: hardNos (each rule)
    const hitNo = (uw.hardNos || []).find(rule => hardNoMatches(rule, site, dealType, ctx));
    if (hitNo) {
      fails.push({ operator: name, reason: `hardNo: ${String(hitNo).slice(0, 60)}` });
      continue;
    }

    // Hard-gate: price (with 30% slack — listings are noisy)
    // ONLY applied to existing-facility deals. Raw land sells at 5-10x lower
    // multiples than stabilized facilities, so the matrix's priceLow values
    // (calibrated for facility acquisitions) would falsely filter every land
    // deal. See isPriceGateApplicable().
    if (isPriceGateApplicable(dealType) && isFinite(askingPrice) && askingPrice > 0) {
      if (uw.priceLow && askingPrice < uw.priceLow * 0.7) {
        fails.push({ operator: name, reason: `price below floor` });
        continue;
      }
      if (uw.priceHigh && askingPrice > uw.priceHigh * 1.3) {
        fails.push({ operator: name, reason: `price above ceiling` });
        continue;
      }
    }

    // Score the candidate
    const score = scoreCandidate(name, op, site, dealType);

    candidates.push({
      operator: name,
      score: Math.round(score * 100) / 100,
      tier: op.tier,
      tierLabel: TIER_LABEL[op.tier] || op.tier,
      tierColor: TIER_COLOR[op.tier] || '#94A3B8',
      hotCapitalRank: op.hotCapitalRank || 99,
      pitchHook: op.pitchHook || null,
      uniqueMoats: uw.uniqueMoats || null,
      contacts: op.contacts || null,
      sig: op.sig || 'SiteScore',
      pressure: uw.deploymentPressure || null,
      productMix: uw.productMix || null,
      offMarketPreference: uw.offMarketPreference || null,
      decisionSpeedDays: uw.decisionSpeedDays || null,
      operationalFlag: op.operationalFlag || null,
    });
  }

  // Apply special memory-driven rules
  const ranked = applySpecialRules(candidates, site, ctx);

  // Top-7 plus full-sorted shadow list
  const top7 = ranked.slice(0, 7);
  const top = top7[0] || null;

  // Classification (used by badge color)
  let classification, classColor;
  if (!top) {
    classification = 'NO FIT';
    classColor = '#EF4444';
  } else if (top.score >= 8.0) {
    classification = 'STRONG FIT';
    classColor = '#22C55E';
  } else if (top.score >= 6.5) {
    classification = 'GOOD FIT';
    classColor = '#3B82F6';
  } else if (top.score >= 5.0) {
    classification = 'OK FIT';
    classColor = '#F59E0B';
  } else {
    classification = 'WEAK FIT';
    classColor = '#EF4444';
  }

  return {
    dealType,
    topBuyer: top ? top.operator : null,
    topBuyerScore: top ? top.score : 0,
    topBuyerTier: top ? top.tier : null,
    topBuyerTierLabel: top ? top.tierLabel : null,
    topBuyerHook: top ? top.pitchHook : null,
    topBuyerSig: top ? top.sig : 'SiteScore',
    topBuyerContacts: top ? top.contacts : null,
    topBuyerHotCapitalRank: top ? top.hotCapitalRank : null,
    classification,
    classColor,
    ranked: top7,
    rankedAll: ranked,
    hardGateFails: fails,
    matrixSize,
    survivors: ranked.length,
  };
}

export async function computeBuyerFitAsync(site) {
  const matrix = await loadMatrix();
  return computeBuyerFit(site, matrix);
}

// One-line blurb for latestNote / activity log
export function formatBuyerFitBlurb(fit) {
  if (!fit || !fit.topBuyer) return null;
  const tier = fit.topBuyerTierLabel || '';
  return `Top buyer: ${fit.topBuyer} ${fit.topBuyerScore.toFixed(1)}/10 (${tier}). ${fit.survivors}/${fit.matrixSize} operators survive hard-gates.`;
}

// Convenience: format ranked list for report rendering
export function formatRankedList(fit, limit = 7) {
  if (!fit || !fit.ranked || fit.ranked.length === 0) return [];
  return fit.ranked.slice(0, limit).map((c, i) => ({
    rank: i + 1,
    operator: c.operator,
    score: c.score,
    tier: c.tier,
    tierLabel: c.tierLabel,
    tierColor: c.tierColor,
    hotCapitalRank: c.hotCapitalRank,
    pitchHook: c.pitchHook,
    pressure: c.pressure,
    decisionSpeed: c.decisionSpeedDays,
    operationalFlag: c.operationalFlag,
  }));
}
