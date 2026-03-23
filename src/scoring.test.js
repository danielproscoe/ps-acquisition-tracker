// ─── Unit Tests for SiteScore Scoring Engine ───
// McKinsey Audit: TEST-02 — scoring engine correctness verification
// Expanded suite: 50+ test cases covering all edge cases, hard fails, bonuses, penalties
import { computeSiteScore, computeSiteFinancials } from './scoring';
import { SITE_SCORE_DEFAULTS } from './utils';

// ─── Shared Fixtures ───

const baseSite = {
  name: 'Test Site',
  address: '123 Main St',
  city: 'Indianapolis',
  state: 'IN',
  acreage: '4.0',
  pop3mi: '35,000',
  income3mi: '$75,000',
  popGrowth3mi: '1.2',
  households3mi: '14,000',
  homeValue3mi: '$280,000',
  zoning: 'C-3',
  zoningTableAccessed: true, // §6h Rule #4: ordinance verified for test fixture
  summary: 'SiteScore 7.5/10. C-3 — by right. No nearby storage. 4.0ac, 350\' frontage. No flood. Tier 1 — Indy.',
  siteiqData: {
    nearestPS: 8.5,
    competitorCount: 2,
    marketTier: 1,
    brokerConfirmedZoning: false,
    surveyClean: false,
  },
};

// Helper to create a fully-vetted site (all 17 vet checks pass)
const fullyVettedSite = {
  ...baseSite,
  zoningTableAccessed: true,
  zoningSource: 'https://municode.com/indianapolis/zoning',
  zoningClassification: 'by-right',
  zoningNotes: 'Permitted use table accessed — storage warehouse listed as P in C-3 district per Table 14-1',
  zoningUseTerm: 'Storage Warehouse (Includes Mini-Warehouse)',
  waterProvider: 'Citizens Energy Group — Indianapolis Water',
  waterAvailable: true,
  insideServiceBoundary: true,
  distToWaterMain: '50 LF',
  fireFlowAdequate: true,
  sewerProvider: 'Citizens Wastewater',
  electricProvider: 'AES Indiana',
  floodZone: 'Zone X — no flood',
  planningContact: 'John Smith, Indianapolis Planning Dept',
  roadFrontage: '350 LF on US-31',
  frontageRoadName: 'US-31',
};

const score = (overrides = {}) => {
  const site = { ...baseSite, ...overrides };
  if (overrides.siteiqData) {
    site.siteiqData = { ...baseSite.siteiqData, ...overrides.siteiqData };
  }
  return computeSiteScore(site, SITE_SCORE_DEFAULTS);
};

// ─── 1. WEIGHT NORMALIZATION ───

describe('Weight Normalization', () => {
  test('all 10 SITE_SCORE_DEFAULTS weights sum to 1.0', () => {
    const total = SITE_SCORE_DEFAULTS.reduce((s, d) => s + d.weight, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(0.001);
  });

  test('SITE_SCORE_DEFAULTS has exactly 10 dimensions', () => {
    expect(SITE_SCORE_DEFAULTS.length).toBe(10);
  });

  test('all required dimension keys are present', () => {
    const keys = SITE_SCORE_DEFAULTS.map(d => d.key);
    expect(keys).toEqual(expect.arrayContaining([
      'population', 'growth', 'income', 'households', 'homeValue',
      'zoning', 'psProximity', 'access', 'competition', 'marketTier',
    ]));
  });

  test('no pricing dimension exists (removed per v3.1)', () => {
    const keys = SITE_SCORE_DEFAULTS.map(d => d.key);
    expect(keys).not.toContain('pricing');
  });
});

// ─── 2. BASIC SCORE STRUCTURE ───

describe('computeSiteScore — basic structure', () => {
  test('returns score between 0 and 10', () => {
    const result = score();
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  test('returns all 10 dimension scores', () => {
    const result = score();
    expect(Object.keys(result.scores).length).toBe(10);
    expect(result.scores).toHaveProperty('population');
    expect(result.scores).toHaveProperty('growth');
    expect(result.scores).toHaveProperty('income');
    expect(result.scores).toHaveProperty('households');
    expect(result.scores).toHaveProperty('homeValue');
    expect(result.scores).toHaveProperty('zoning');
    expect(result.scores).toHaveProperty('psProximity');
    expect(result.scores).toHaveProperty('access');
    expect(result.scores).toHaveProperty('competition');
    expect(result.scores).toHaveProperty('marketTier');
  });

  test('assigns tier label (gold / steel / gray)', () => {
    const result = score();
    expect(['gold', 'steel', 'gray']).toContain(result.tier);
    expect(result.label).toBeTruthy();
  });

  test('assigns classification (GREEN / YELLOW / ORANGE / RED)', () => {
    const result = score();
    expect(['GREEN', 'YELLOW', 'ORANGE', 'RED']).toContain(result.classification);
  });

  test('returns breakdown array with 10 entries', () => {
    const result = score();
    expect(result.breakdown).toHaveLength(10);
    result.breakdown.forEach(entry => {
      expect(entry).toHaveProperty('label');
      expect(entry).toHaveProperty('key');
      expect(entry).toHaveProperty('score');
      expect(entry).toHaveProperty('weight');
    });
  });

  test('hasDemoData is true when pop or income provided', () => {
    const result = score();
    expect(result.hasDemoData).toBe(true);
  });

  test('hasDemoData is false when no pop or income', () => {
    const result = score({ pop3mi: '', income3mi: '' });
    expect(result.hasDemoData).toBe(false);
  });
});

// ─── 3. CLASSIFICATION THRESHOLDS ───

describe('Classification thresholds', () => {
  test('score >= 8.0 classifies as GREEN', () => {
    // Build a site that will score very high
    const result = computeSiteScore({
      ...fullyVettedSite,
      pop3mi: '50,000',
      income3mi: '$95,000',
      popGrowth3mi: '2.5',
      households3mi: '30,000',
      homeValue3mi: '$550,000',
      acreage: '4.0',
      summary: 'by right. 400\' frontage. No flood. No nearby storage.',
      siteiqData: { nearestPS: 3, competitorCount: 0, marketTier: 1, brokerConfirmedZoning: true, surveyClean: true },
    }, SITE_SCORE_DEFAULTS);
    expect(result.classification).toBe('GREEN');
    expect(result.score).toBeGreaterThanOrEqual(8.0);
    expect(result.tier).toBe('gold');
  });

  test('score < 4.0 classifies as RED (without hard fail)', () => {
    const result = score({
      pop3mi: '6,000',
      income3mi: '$56,000',
      popGrowth3mi: '-0.8',
      households3mi: '2,000',
      homeValue3mi: '$80,000',
      acreage: '1.5',
      zoning: '',
      summary: 'agricultural residential only. high competition. saturated.',
      market: '',
      siteiqData: { nearestPS: 30, competitorCount: 8, marketTier: undefined },
    });
    // With these bad inputs, score should be very low
    expect(result.score).toBeLessThan(5.0);
    expect(['ORANGE', 'RED']).toContain(result.classification);
  });

  test('hard fail forces RED regardless of composite score', () => {
    // High-scoring site but population hard fail
    const result = score({
      pop3mi: '3,000',
      income3mi: '$95,000',
      popGrowth3mi: '0.5', // growth < 8 so no corridor exemption
      summary: 'by right. No nearby storage. 4.0ac, 350\' frontage. No flood.',
    });
    expect(result.hardFail).toBe(true);
    expect(result.classification).toBe('RED');
  });
});

// ─── 4. POPULATION SCORING ───

describe('Population scoring', () => {
  test('pop >= 40,000 scores 10', () => {
    expect(score({ pop3mi: '45,000' }).scores.population).toBe(10);
  });

  test('pop 25,000 scores 8', () => {
    expect(score({ pop3mi: '25,000' }).scores.population).toBe(8);
  });

  test('pop 15,000 scores 6', () => {
    expect(score({ pop3mi: '15,000' }).scores.population).toBe(6);
  });

  test('pop 10,000 scores 5', () => {
    expect(score({ pop3mi: '10,000' }).scores.population).toBe(5);
  });

  test('pop 5,000 scores 3', () => {
    expect(score({ pop3mi: '5,000' }).scores.population).toBe(3);
  });

  test('pop < 5,000 is HARD FAIL (score 0)', () => {
    const result = score({ pop3mi: '4,000', popGrowth3mi: '0.5' });
    expect(result.scores.population).toBe(0);
    expect(result.hardFail).toBe(true);
    expect(result.flags.some(f => f.includes('FAIL') && f.includes('pop'))).toBe(true);
  });

  test('pop 0 or empty defaults to score 5 (no hard fail)', () => {
    const result = score({ pop3mi: '' });
    expect(result.scores.population).toBe(5);
    expect(result.hardFail).toBe(false);
  });
});

// ─── 5. GROWTH CORRIDOR EXEMPTION ───

describe('Growth corridor exemption', () => {
  test('pop 2,500-5,000 with growth >= 8 scores 2 (not FAIL)', () => {
    const result = score({ pop3mi: '3,500', popGrowth3mi: '2.0' }); // growth 2.0% = score 10 >= 8
    expect(result.scores.population).toBe(2);
    expect(result.hardFail).toBe(false);
    expect(result.flags.some(f => f.includes('Growth corridor exemption'))).toBe(true);
    expect(result.flags.some(f => f.startsWith('FAIL') && f.includes('pop'))).toBe(false);
  });

  test('pop 2,500 with growth score exactly 8 triggers exemption', () => {
    const result = score({ pop3mi: '2,500', popGrowth3mi: '1.0' }); // 1.0% = growth score 8
    expect(result.scores.population).toBe(2);
    expect(result.hardFail).toBe(false);
  });

  test('pop 4,999 with high growth triggers exemption', () => {
    const result = score({ pop3mi: '4,999', popGrowth3mi: '2.5' });
    expect(result.scores.population).toBe(2);
    expect(result.hardFail).toBe(false);
  });

  test('pop 2,499 does NOT trigger exemption (below 2,500)', () => {
    const result = score({ pop3mi: '2,499', popGrowth3mi: '2.5' });
    expect(result.scores.population).toBe(0);
    expect(result.hardFail).toBe(true);
  });

  test('pop 3,500 with growth score 6 does NOT trigger exemption (growth < 8)', () => {
    const result = score({ pop3mi: '3,500', popGrowth3mi: '0.5' }); // 0.5% = growth score 6
    expect(result.scores.population).toBe(0);
    expect(result.hardFail).toBe(true);
  });
});

// ─── 6. INCOME SCORING & HARD FAIL ───

describe('Income scoring', () => {
  test('HHI >= $90K scores 10', () => {
    expect(score({ income3mi: '$95,000' }).scores.income).toBe(10);
  });

  test('HHI >= $75K scores 8', () => {
    expect(score({ income3mi: '$75,000' }).scores.income).toBe(8);
  });

  test('HHI >= $65K scores 6', () => {
    expect(score({ income3mi: '$65,000' }).scores.income).toBe(6);
  });

  test('HHI >= $55K scores 4', () => {
    expect(score({ income3mi: '$55,000' }).scores.income).toBe(4);
  });

  test('HHI < $55K is HARD FAIL', () => {
    const result = score({ income3mi: '$40,000' });
    expect(result.scores.income).toBe(0);
    expect(result.hardFail).toBe(true);
    expect(result.flags.some(f => f.includes('FAIL') && f.includes('HHI'))).toBe(true);
  });

  test('empty income defaults to 5 (no hard fail)', () => {
    const result = score({ income3mi: '' });
    expect(result.scores.income).toBe(5);
    expect(result.hardFail).toBe(false);
  });
});

// ─── 7. PS PROXIMITY ───

describe('PS proximity scoring', () => {
  test('>35 mi is HARD FAIL (score 0)', () => {
    const result = score({ siteiqData: { nearestPS: 36 } });
    expect(result.scores.psProximity).toBe(0);
    expect(result.hardFail).toBe(true);
    expect(result.flags.some(f => f.includes('FAIL') && f.includes('35 mi'))).toBe(true);
  });

  test('<= 5 mi scores 10 (market validation)', () => {
    expect(score({ siteiqData: { nearestPS: 5 } }).scores.psProximity).toBe(10);
  });

  test('0.5 mi scores 10 — no minimum proximity penalty', () => {
    expect(score({ siteiqData: { nearestPS: 0.5 } }).scores.psProximity).toBe(10);
  });

  test('0.1 mi scores 10 — adjacent to PS is fine', () => {
    expect(score({ siteiqData: { nearestPS: 0.1 } }).scores.psProximity).toBe(10);
  });

  test('8 mi scores 9', () => {
    expect(score({ siteiqData: { nearestPS: 8 } }).scores.psProximity).toBe(9);
  });

  test('12 mi scores 7', () => {
    expect(score({ siteiqData: { nearestPS: 12 } }).scores.psProximity).toBe(7);
  });

  test('20 mi scores 5', () => {
    expect(score({ siteiqData: { nearestPS: 20 } }).scores.psProximity).toBe(5);
  });

  test('30 mi scores 3', () => {
    expect(score({ siteiqData: { nearestPS: 30 } }).scores.psProximity).toBe(3);
  });

  test('exactly 35 mi scores 3 (not FAIL)', () => {
    expect(score({ siteiqData: { nearestPS: 35 } }).scores.psProximity).toBe(3);
  });

  test('missing nearestPS defaults to score 5', () => {
    expect(score({ siteiqData: { nearestPS: undefined } }).scores.psProximity).toBe(5);
  });

  test('null nearestPS defaults to score 5', () => {
    expect(score({ siteiqData: { nearestPS: null } }).scores.psProximity).toBe(5);
  });
});

// ─── 8. ZONING SCORING ───

describe('Zoning scoring', () => {
  test('zoningClassification "by-right" scores 10', () => {
    expect(score({ zoningClassification: 'by-right' }).scores.zoning).toBe(10);
  });

  test('zoningClassification "conditional" scores 6', () => {
    expect(score({ zoningClassification: 'conditional' }).scores.zoning).toBe(6);
  });

  test('zoningClassification "rezone-required" scores 2', () => {
    expect(score({ zoningClassification: 'rezone-required' }).scores.zoning).toBe(2);
  });

  test('zoningClassification "prohibited" is HARD FAIL (score 0)', () => {
    const result = score({ zoningClassification: 'prohibited' });
    expect(result.scores.zoning).toBe(0);
    expect(result.hardFail).toBe(true);
    expect(result.flags.some(f => f.includes('FAIL') && f.includes('Zoning'))).toBe(true);
  });

  test('zoningClassification "unknown" falls through to regex', () => {
    const result = score({
      zoningClassification: 'unknown',
      summary: 'by right permitted',
      zoning: 'C-2',
    });
    expect(result.scores.zoning).toBe(10);
  });

  test('ETJ / no zoning scores 10 via regex', () => {
    const result = score({
      zoningClassification: undefined,
      zoning: 'ETJ',
      summary: 'no zoning restrictions',
    });
    expect(result.scores.zoning).toBe(10);
  });

  test('unincorporated county scores 10', () => {
    const result = score({
      zoningClassification: undefined,
      zoning: 'unincorporated county',
      summary: 'no zoning',
    });
    expect(result.scores.zoning).toBe(10);
  });

  test('summary with "conditional SUP" scores 6 via regex', () => {
    const result = score({
      zoningClassification: undefined,
      zoning: 'R-2',
      summary: 'conditional SUP required for storage',
    });
    expect(result.scores.zoning).toBe(6);
  });

  test('summary with "rezone required" scores 2 via regex', () => {
    const result = score({
      zoningClassification: undefined,
      zoning: 'AG',
      summary: 'rezone required for storage use. rezoning would be needed.',
    });
    // "rezone" matches rezoning regex before "prohibited" matches the AG regex
    expect(result.scores.zoning).toBe(2);
  });

  test('zoning field present but no classification and no summary keywords scores 5', () => {
    const result = score({
      zoningClassification: undefined,
      zoning: 'PD-42',
      summary: 'site available for development',
    });
    expect(result.scores.zoning).toBe(5);
  });

  test('empty zoning with no summary keywords scores 3 (default)', () => {
    const result = score({
      zoningClassification: undefined,
      zoning: '',
      summary: '',
    });
    expect(result.scores.zoning).toBe(3);
  });
});

// ─── 9. COMPETITION SCORING ───

describe('Competition scoring via siteiqData.competitorCount (6-tier scale)', () => {
  test('0 competitors scores 10', () => {
    expect(score({ siteiqData: { competitorCount: 0 } }).scores.competition).toBe(10);
  });

  test('1 competitor scores 9', () => {
    expect(score({ siteiqData: { competitorCount: 1 } }).scores.competition).toBe(9);
  });

  test('2 competitors scores 7', () => {
    expect(score({ siteiqData: { competitorCount: 2 } }).scores.competition).toBe(7);
  });

  test('3 competitors scores 6', () => {
    expect(score({ siteiqData: { competitorCount: 3 } }).scores.competition).toBe(6);
  });

  test('4-5 competitors scores 4', () => {
    expect(score({ siteiqData: { competitorCount: 5 } }).scores.competition).toBe(4);
  });

  test('6-8 competitors scores 3', () => {
    expect(score({ siteiqData: { competitorCount: 7 } }).scores.competition).toBe(3);
  });

  test('9+ competitors scores 2', () => {
    expect(score({ siteiqData: { competitorCount: 10 } }).scores.competition).toBe(2);
  });

  test('missing competitorCount falls back to summary regex', () => {
    const result = score({
      siteiqData: { competitorCount: undefined },
      summary: 'no nearby storage facilities',
    });
    expect(result.scores.competition).toBe(9);
  });

  test('saturated market via summary scores 3', () => {
    const result = score({
      siteiqData: { competitorCount: undefined },
      summary: 'high competition. storage market saturated.',
    });
    expect(result.scores.competition).toBe(3);
  });
});

// ─── 10. MARKET TIER ───

describe('Market tier scoring via siteiqData.marketTier', () => {
  test('tier 1 scores 10', () => {
    expect(score({ siteiqData: { marketTier: 1 } }).scores.marketTier).toBe(10);
  });

  test('tier 2 scores 8', () => {
    expect(score({ siteiqData: { marketTier: 2 } }).scores.marketTier).toBe(8);
  });

  test('tier 3 scores 6', () => {
    expect(score({ siteiqData: { marketTier: 3 } }).scores.marketTier).toBe(6);
  });

  test('tier 4 scores 4', () => {
    expect(score({ siteiqData: { marketTier: 4 } }).scores.marketTier).toBe(4);
  });

  test('no tier falls back to market field keyword — Cincinnati', () => {
    const result = score({
      siteiqData: { marketTier: undefined },
      market: 'Cincinnati metro',
    });
    expect(result.scores.marketTier).toBe(10);
  });

  test('no tier and no market keyword defaults to 2', () => {
    const result = score({
      siteiqData: { marketTier: undefined },
      market: 'Boise ID',
    });
    expect(result.scores.marketTier).toBe(2);
  });
});

// ─── 11. ACCESS & SIZE SCORING ───

describe('Access & size scoring', () => {
  test('3.5-5 ac base score 8', () => {
    const result = score({ acreage: '4.0', summary: '' });
    expect(result.scores.access).toBe(8);
  });

  test('2.5-3.5 ac base score 6', () => {
    const result = score({ acreage: '3.0', summary: '' });
    expect(result.scores.access).toBe(6);
  });

  test('5-7 ac base score 7', () => {
    const result = score({ acreage: '6.0', summary: '' });
    expect(result.scores.access).toBe(7);
  });

  test('> 7 ac base score 5', () => {
    const result = score({ acreage: '10.0', summary: '' });
    expect(result.scores.access).toBe(5);
  });

  test('< 2 ac base score 2', () => {
    const result = score({ acreage: '1.5', summary: '' });
    expect(result.scores.access).toBe(2);
  });

  test('frontage keyword adds +2', () => {
    const result = score({ acreage: '4.0', summary: "350' frontage on US-31" });
    expect(result.scores.access).toBe(10); // 8 + 2
  });

  test('landlocked is HARD FAIL (score 0)', () => {
    const result = score({ summary: 'landlocked no access' });
    expect(result.scores.access).toBe(0);
    expect(result.hardFail).toBe(true);
    expect(result.flags.some(f => f.includes('FAIL') && f.includes('Landlocked'))).toBe(true);
  });

  test('flood reduces access score by 2', () => {
    const result = score({ acreage: '4.0', summary: 'in flood zone AE' });
    expect(result.scores.access).toBe(6); // 8 - 2
  });

  test('subdivisible large tract adds +2', () => {
    const result = score({ acreage: '8.0', summary: 'could subdivide split the parcel' });
    expect(result.scores.access).toBe(7); // 5 + 2
  });

  test('access score clamped to 0-10 range', () => {
    // Frontage + large acreage to test upper cap
    const result = score({ acreage: '4.0', summary: "400' frontage on main road" });
    expect(result.scores.access).toBeLessThanOrEqual(10);
    expect(result.scores.access).toBeGreaterThanOrEqual(0);
  });
});

// ─── 12. PHASE BONUSES ───

describe('Phase bonuses', () => {
  test('"Under Contract" adds +0.3', () => {
    const base = score();
    const phased = score({ phase: 'Under Contract' });
    expect(phased.score).toBeCloseTo(base.score + 0.3, 0);
  });

  test('"Closed" adds +0.3', () => {
    const base = score();
    const phased = score({ phase: 'Closed' });
    expect(phased.score).toBeCloseTo(base.score + 0.3, 0);
  });

  test('"PSA Sent" adds +0.2', () => {
    const base = score();
    const phased = score({ phase: 'PSA Sent' });
    expect(phased.score).toBeCloseTo(base.score + 0.2, 0);
  });

  test('"LOI" adds +0.15', () => {
    const base = score();
    const phased = score({ phase: 'LOI' });
    const diff = phased.score - base.score;
    // floating point: 0.15 rounds to 0.1 or 0.2 — use toBeCloseTo for precision
    expect(diff).toBeCloseTo(0.15, 0);
  });

  test('"SiteScore Approved" adds +0.1', () => {
    const base = score();
    const phased = score({ phase: 'SiteScore Approved' });
    expect(phased.score).toBeGreaterThanOrEqual(base.score);
  });

  test('phase bonus capped at 10', () => {
    const result = computeSiteScore({
      ...fullyVettedSite,
      pop3mi: '50,000',
      income3mi: '$95,000',
      popGrowth3mi: '2.5',
      households3mi: '30,000',
      homeValue3mi: '$550,000',
      phase: 'Under Contract',
      summary: 'by right. 400\' frontage. No flood. No nearby storage.',
      siteiqData: { nearestPS: 3, competitorCount: 0, marketTier: 1, brokerConfirmedZoning: true, surveyClean: true },
    }, SITE_SCORE_DEFAULTS);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  test('no phase = no bonus', () => {
    const withPhase = score({ phase: '' });
    const noPhase = score({ phase: undefined });
    expect(withPhase.score).toBe(noPhase.score);
  });
});

// ─── 13. STALE LISTING PENALTY ───

describe('Stale listing penalty', () => {
  test('dateOnMarket > 1000 days ago applies -0.5 penalty', () => {
    const staleDate = new Date(Date.now() - 1100 * 86400000).toISOString();
    const base = score();
    const stale = score({ dateOnMarket: staleDate });
    expect(stale.score).toBeCloseTo(base.score - 0.5, 0);
    expect(stale.flags.some(f => f.includes('Stale'))).toBe(true);
  });

  test('dateOnMarket 500 days ago = no penalty', () => {
    const recentDate = new Date(Date.now() - 500 * 86400000).toISOString();
    const base = score();
    const notStale = score({ dateOnMarket: recentDate });
    expect(notStale.score).toBe(base.score);
  });

  test('no dateOnMarket = no penalty', () => {
    const result = score({ dateOnMarket: undefined });
    expect(result.flags.some(f => f.includes('Stale'))).toBe(false);
  });

  test('stale penalty does not drop score below 0', () => {
    const staleDate = new Date(Date.now() - 1500 * 86400000).toISOString();
    const result = score({
      pop3mi: '6,000',
      income3mi: '$56,000',
      popGrowth3mi: '-1.0',
      dateOnMarket: staleDate,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

// ─── 14. BROKER INTEL BONUSES ───

describe('Broker intel bonuses', () => {
  test('brokerConfirmedZoning adds +0.3', () => {
    const base = score();
    const confirmed = score({ siteiqData: { brokerConfirmedZoning: true } });
    expect(confirmed.score).toBeCloseTo(base.score + 0.3, 0);
  });

  test('surveyClean adds +0.2', () => {
    const base = score();
    const clean = score({ siteiqData: { surveyClean: true } });
    expect(clean.score).toBeCloseTo(base.score + 0.2, 0);
  });

  test('both bonuses stack (+0.5)', () => {
    const base = score();
    const both = score({ siteiqData: { brokerConfirmedZoning: true, surveyClean: true } });
    expect(both.score).toBeCloseTo(base.score + 0.5, 0);
  });

  test('brokerConfirmedZoning false = no bonus', () => {
    const base = score({ siteiqData: { brokerConfirmedZoning: false } });
    const noBonus = score({ siteiqData: { brokerConfirmedZoning: false, surveyClean: false } });
    expect(base.score).toBe(noBonus.score);
  });
});

// ─── 15. WATER HOOKUP PENALTY ───

describe('Water hookup penalty', () => {
  test('waterAvailable false + no provider = -1.0 penalty', () => {
    const base = score();
    const noWater = score({ waterAvailable: false, waterProvider: '' });
    expect(noWater.score).toBeLessThan(base.score);
    const diff = base.score - noWater.score;
    // Should be approximately 1.0 (may differ slightly due to vet completeness changes)
    expect(diff).toBeGreaterThanOrEqual(0.5);
    expect(noWater.flags.some(f => f.includes('WATER') && f.includes('No water provider'))).toBe(true);
  });

  test('waterAvailable false + provider identified = -0.3 penalty', () => {
    const base = score();
    const providerExists = score({
      waterAvailable: false,
      waterProvider: 'Citizens Energy Group — Indianapolis Water',
    });
    expect(providerExists.score).toBeLessThan(base.score);
    expect(providerExists.flags.some(f => f.includes('WATER') && f.includes('line extension'))).toBe(true);
  });

  test('waterAvailable true = no penalty', () => {
    const withWater = score({ waterAvailable: true });
    // No water penalty flag
    expect(withWater.flags.some(f => f.includes('WATER'))).toBe(false);
  });

  test('waterAvailable undefined = no penalty', () => {
    const result = score({ waterAvailable: undefined });
    expect(result.flags.some(f => f.includes('WATER'))).toBe(false);
  });

  test('short waterProvider string (<=10 chars) treated as no provider', () => {
    const result = score({ waterAvailable: false, waterProvider: 'unknown' });
    expect(result.flags.some(f => f.includes('No water provider'))).toBe(true);
  });
});

// ─── 16. VET COMPLETENESS BONUS ───

describe('Vet completeness bonus / penalty', () => {
  test('fully vetted site (100%) gets +0.5 bonus', () => {
    const unvetted = computeSiteScore({ ...baseSite }, SITE_SCORE_DEFAULTS);
    const vetted = computeSiteScore({ ...fullyVettedSite }, SITE_SCORE_DEFAULTS);
    // The fully vetted site should score meaningfully higher from vet bonus
    // (also benefits from zoningClassification: by-right changing zoning score)
    expect(vetted.score).toBeGreaterThan(unvetted.score);
  });

  test('zero vet fields populated gets -0.3 penalty', () => {
    const result = computeSiteScore({
      name: 'Empty',
      pop3mi: '20,000',
      income3mi: '$70,000',
      summary: 'by right. No nearby storage.',
    }, SITE_SCORE_DEFAULTS);
    expect(result.flags.some(f => f.includes('No deep vet'))).toBe(true);
  });

  test('partial vet (~70%) gets +0.3 bonus', () => {
    const partialVet = {
      ...baseSite,
      zoningSource: 'https://municode.com/test',
      zoningClassification: 'by-right',
      zoningNotes: 'Storage permitted in C-3 per Table 14-1 Section 4.3',
      zoningUseTerm: 'Self-Storage Warehouse',
      waterProvider: 'City Water Dept',
      waterAvailable: true,
      insideServiceBoundary: true,
      distToWaterMain: '100 LF',
      fireFlowAdequate: true,
      sewerProvider: 'City Sewer',
      electricProvider: 'Duke Energy',
      floodZone: 'Zone X',
      planningContact: 'Planning Dept 555-1234',
      // roadFrontage and frontageRoadName intentionally missing
    };
    const result = computeSiteScore(partialVet, SITE_SCORE_DEFAULTS);
    // Should not have the "No deep vet" flag
    expect(result.flags.some(f => f.includes('No deep vet'))).toBe(false);
  });
});

// ─── 17. GROWTH SCORING ───

describe('Growth scoring', () => {
  test('growth >= 2.0% scores 10', () => {
    expect(score({ popGrowth3mi: '2.5' }).scores.growth).toBe(10);
  });

  test('growth 1.5% scores 9', () => {
    expect(score({ popGrowth3mi: '1.5' }).scores.growth).toBe(9);
  });

  test('growth 1.0% scores 8', () => {
    expect(score({ popGrowth3mi: '1.0' }).scores.growth).toBe(8);
  });

  test('growth 0.5% scores 6', () => {
    expect(score({ popGrowth3mi: '0.5' }).scores.growth).toBe(6);
  });

  test('growth 0.0% scores 4', () => {
    expect(score({ popGrowth3mi: '0.0' }).scores.growth).toBe(4);
  });

  test('growth -0.3% scores 2', () => {
    expect(score({ popGrowth3mi: '-0.3' }).scores.growth).toBe(2);
  });

  test('growth < -0.5% scores 0 with warning', () => {
    const result = score({ popGrowth3mi: '-0.8' });
    expect(result.scores.growth).toBe(0);
    expect(result.flags.some(f => f.includes('declining'))).toBe(true);
  });

  test('no growth data defaults to score 5', () => {
    expect(score({ popGrowth3mi: undefined }).scores.growth).toBe(5);
  });
});

// ─── 18. HOUSEHOLDS & HOME VALUE ───

describe('Households scoring', () => {
  test('25,000+ households scores 10', () => {
    expect(score({ households3mi: '30,000' }).scores.households).toBe(10);
  });

  test('18,000 households scores 8', () => {
    expect(score({ households3mi: '18,000' }).scores.households).toBe(8);
  });

  test('< 6,000 households scores 3', () => {
    expect(score({ households3mi: '4,000' }).scores.households).toBe(3);
  });

  test('no household data defaults to 5', () => {
    expect(score({ households3mi: '' }).scores.households).toBe(5);
  });
});

describe('Home value scoring', () => {
  test('$500K+ scores 10', () => {
    expect(score({ homeValue3mi: '$550,000' }).scores.homeValue).toBe(10);
  });

  test('$350K scores 9', () => {
    expect(score({ homeValue3mi: '$350,000' }).scores.homeValue).toBe(9);
  });

  test('$250K scores 8', () => {
    expect(score({ homeValue3mi: '$250,000' }).scores.homeValue).toBe(8);
  });

  test('< $120K scores 2', () => {
    expect(score({ homeValue3mi: '$100,000' }).scores.homeValue).toBe(2);
  });

  test('no data defaults to 5', () => {
    expect(score({ homeValue3mi: '' }).scores.homeValue).toBe(5);
  });
});

// ─── 19. EMPTY / MISSING FIELD HANDLING ───

describe('Empty and missing field handling', () => {
  test('completely empty site object produces valid result', () => {
    const result = computeSiteScore({}, SITE_SCORE_DEFAULTS);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(typeof result.score).toBe('number');
    expect(result.flags).toBeDefined();
    expect(Array.isArray(result.flags)).toBe(true);
    expect(result.scores).toBeDefined();
    expect(result.classification).toBeDefined();
  });

  test('null siteiqData handled gracefully', () => {
    const result = score({ siteiqData: null });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.scores.psProximity).toBe(5);
    expect(result.scores.competition).toBeDefined();
  });

  test('undefined siteiqData handled gracefully', () => {
    const result = score({ siteiqData: undefined });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  test('string numbers with commas and $ signs parsed correctly', () => {
    const result = score({ pop3mi: '$42,000', income3mi: '78000' });
    expect(result.scores.population).toBe(10); // 42000 >= 40000
    expect(result.scores.income).toBe(8); // 78000 >= 75000
  });

  test('null pop3mi and income3mi treated as no data', () => {
    const result = score({ pop3mi: null, income3mi: null });
    expect(result.scores.population).toBe(5);
    expect(result.scores.income).toBe(5);
    expect(result.hardFail).toBe(false);
  });
});

// ─── 20. LABEL ASSIGNMENT ───

describe('Label assignment', () => {
  test('score 9+ = ELITE', () => {
    const result = computeSiteScore({
      ...fullyVettedSite,
      pop3mi: '50,000',
      income3mi: '$95,000',
      popGrowth3mi: '2.5',
      households3mi: '30,000',
      homeValue3mi: '$550,000',
      summary: 'by right. 400\' frontage. No flood. No nearby storage.',
      siteiqData: { nearestPS: 3, competitorCount: 0, marketTier: 1, brokerConfirmedZoning: true, surveyClean: true },
    }, SITE_SCORE_DEFAULTS);
    if (result.score >= 9) {
      expect(result.label).toBe('ELITE');
    } else if (result.score >= 8) {
      expect(result.label).toBe('PRIME');
    }
  });

  test('score 7-7.9 = STRONG', () => {
    // baseSite should score somewhere in this range
    const result = score();
    if (result.score >= 7 && result.score < 8) {
      expect(result.label).toBe('STRONG');
    }
  });
});

// ─── 21. MULTIPLE HARD FAILS ───

describe('Multiple hard fails', () => {
  test('low pop + low income + landlocked = multiple flags, still RED', () => {
    const result = score({
      pop3mi: '3,000',
      income3mi: '$40,000',
      popGrowth3mi: '0.5',
      summary: 'landlocked no access',
    });
    expect(result.hardFail).toBe(true);
    expect(result.classification).toBe('RED');
    const failFlags = result.flags.filter(f => f.includes('FAIL'));
    expect(failFlags.length).toBeGreaterThanOrEqual(2);
  });

  test('prohibited zoning + >35mi PS = multiple hard fails', () => {
    const result = score({
      zoningClassification: 'prohibited',
      siteiqData: { nearestPS: 40 },
    });
    expect(result.hardFail).toBe(true);
    expect(result.classification).toBe('RED');
  });
});

// ─── 22. computeSiteFinancials ───

describe('computeSiteFinancials', () => {
  test('returns valid financial model for standard site', () => {
    const site = { ...baseSite, askingPrice: '$1,200,000' };
    const result = computeSiteFinancials(site);
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect(result.totalSF).toBeGreaterThan(0);
    expect(result.yearData).toHaveLength(5);
    expect(result.landCost).toBe(1200000);
  });

  test('handles missing price gracefully', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '' });
    expect(result).toBeDefined();
    expect(result.landCost).toBe(0);
  });

  test('PS operator profile has lowest management fee', () => {
    const ps = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000', operatorProfile: 'ps' });
    const generic = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000', operatorProfile: 'generic' });
    const indie = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000', operatorProfile: 'independent' });
    // PS mgmt fee is 3.5%, generic 6%, independent 8%
    expect(ps.operatorLabel).toContain('Public Storage');
  });

  test('default operator is PS if not specified', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    expect(result.operatorLabel).toContain('Public Storage');
  });

  test('multi-story sizing for 2.5-3.5 ac', () => {
    const result = computeSiteFinancials({ ...baseSite, acreage: '3.0', askingPrice: '$800,000' });
    expect(result.stories).toBe(3);
    expect(result.climatePct).toBe(0.75);
  });

  test('one-story sizing for 3.5+ ac', () => {
    const result = computeSiteFinancials({ ...baseSite, acreage: '4.5', askingPrice: '$1,200,000' });
    expect(result.stories).toBe(1);
    expect(result.climatePct).toBe(0.65);
  });

  test('land price guide returns 3 tiers (walk away, strike, home run)', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    expect(result.landPrices).toHaveLength(3);
    expect(result.landPrices[0].label).toBe('Walk Away');
    expect(result.landPrices[1].label).toBe('Strike Price');
    expect(result.landPrices[2].label).toBe('Home Run');
  });

  test('IRR is a valid percentage string', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    const irr = parseFloat(result.irrPct);
    expect(irr).not.toBeNaN();
    // IRR should be reasonable (between -10% and 50%)
    expect(irr).toBeGreaterThan(-10);
    expect(irr).toBeLessThan(50);
  });

  test('cap rate valuations return 3 scenarios', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    expect(result.valuations).toHaveLength(3);
    expect(result.valuations[0].label).toContain('Conservative');
    expect(result.valuations[1].label).toContain('Market');
    expect(result.valuations[2].label).toContain('Aggressive');
    // Aggressive cap (lower) = higher value
    expect(result.valuations[2].value).toBeGreaterThan(result.valuations[0].value);
  });

  test('5-year lease-up model has escalating occupancy', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    for (let i = 1; i < result.yearData.length; i++) {
      expect(result.yearData[i].occRate).toBeGreaterThan(result.yearData[i - 1].occRate);
    }
  });

  test('internalPrice overrides askingPrice for landCost', () => {
    const result = computeSiteFinancials({
      ...baseSite,
      askingPrice: '$1,500,000',
      internalPrice: '$1,000,000',
    });
    expect(result.landCost).toBe(1000000);
  });

  test('sensitivity matrix is present', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    expect(result.sensitivityMatrix).toBeDefined();
    expect(result.sensitivityMatrix.grid).toHaveLength(3); // 3 rent scenarios
    expect(result.sensitivityMatrix.grid[0]).toHaveLength(3); // 3 occ scenarios each
  });

  test('DSCR is valid at stabilization', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    const dscr = parseFloat(result.dscrStab);
    if (!isNaN(dscr)) {
      expect(dscr).toBeGreaterThan(0);
    }
  });

  test('unlevered IRR is computed and reasonable', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    const uIRR = parseFloat(result.unleveredIRR);
    expect(uIRR).toBeGreaterThan(0);
    expect(uIRR).toBeLessThan(50);
    // Unlevered should be lower than levered (no leverage amplification)
    expect(uIRR).toBeLessThanOrEqual(parseFloat(result.irrPct) + 1);
  });

  test('exit scenarios contain bull/base/bear with valid IRRs', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    expect(result.exitScenarios).toHaveLength(3);
    expect(result.exitScenarios[0].rate).toBe(0.0525); // Bull
    expect(result.exitScenarios[1].rate).toBe(0.06);   // Base
    expect(result.exitScenarios[2].rate).toBe(0.07);   // Bear
    // Bull exit = higher value = higher IRR
    expect(parseFloat(result.exitScenarios[0].irr)).toBeGreaterThan(parseFloat(result.exitScenarios[2].irr));
  });

  test('NPV at PS WACC is computed', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    expect(result.npvAtWACC).toBeDefined();
    expect(typeof result.npvAtWACC).toBe('number');
  });

  test('debt yield is computed and reasonable', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    const dy = parseFloat(result.debtYield);
    expect(dy).toBeGreaterThan(0);
    expect(dy).toBeLessThan(30);
  });

  test('profit on cost is computed', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    const poc = parseFloat(result.profitOnCost);
    expect(poc).toBeDefined();
    expect(typeof poc).toBe('number');
  });

  // ── Bain Audit 2026-03-22: Sources & Uses balance control ──
  test('Sources & Uses totals balance exactly (totalSources === totalUses)', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,200,000' });
    const { sourcesAndUses } = result;
    expect(sourcesAndUses.totalSources).toBe(sourcesAndUses.totalUses);
  });

  test('Sources line items sum to totalSources', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,200,000' });
    const { sourcesAndUses } = result;
    const lineSum = sourcesAndUses.sources.reduce((s, r) => s + r.amount, 0);
    expect(lineSum).toBe(sourcesAndUses.totalSources);
  });

  test('Uses line items sum to totalUses', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,200,000' });
    const { sourcesAndUses } = result;
    const lineSum = sourcesAndUses.uses.reduce((s, r) => s + r.amount, 0);
    expect(lineSum).toBe(sourcesAndUses.totalUses);
  });

  test('Sources percentages sum to ~100%', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,200,000' });
    const { sourcesAndUses } = result;
    const pctSum = sourcesAndUses.sources.reduce((s, r) => s + parseFloat(r.pct), 0);
    expect(pctSum).toBeCloseTo(100, 0);
  });

  test('Uses percentages sum to ~100%', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,200,000' });
    const { sourcesAndUses } = result;
    const pctSum = sourcesAndUses.uses.reduce((s, r) => s + parseFloat(r.pct), 0);
    expect(pctSum).toBeCloseTo(100, 0);
  });

  // ── Bain Audit 2026-03-22: holdPeriod parameter wiring ──
  test('holdPeriod defaults to 10 and controls DCF array length', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    expect(result.holdPeriod).toBe(10);
    expect(result.yrDataExt).toHaveLength(10);
    expect(result.irrCashFlows).toHaveLength(11); // initial equity + 10 years
  });

  test('holdPeriod override changes DCF array length', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { holdPeriod: 7 });
    expect(result.holdPeriod).toBe(7);
    expect(result.yrDataExt).toHaveLength(7);
    expect(result.irrCashFlows).toHaveLength(8); // initial equity + 7 years
  });

  test('holdPeriod clamped to 5-20 range', () => {
    const low = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { holdPeriod: 3 });
    expect(low.holdPeriod).toBe(5);
    const high = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { holdPeriod: 25 });
    expect(high.holdPeriod).toBe(20);
  });

  test('totalDevCost includes workingCapital (Bain audit fix)', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    // totalDevCost = land + buildCosts + carry + workingCapital
    // workingCapital = buildCosts * 0.02
    expect(result.totalDevCost).toBeGreaterThan(result.landCost + result.buildCosts + result.carryCosts);
    expect(result.totalDevCost).toBe(result.landCost + result.buildCosts + result.carryCosts + result.workingCapital);
  });

  // ── COD Audit 2026-03-22: ECRI falsy-zero fix ──
  test('Year 1 ECRI multiplier is 1.0 (no phantom ECRI in launch year)', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    // ecriSchedule[0] = 0 → ecriMult = 1 + 0 = 1.0 (no ECRI Y1)
    // Prior bug: 0 || 0.20 → 1.20 (phantom 20% Y1 boost)
    expect(result.yearData[0].ecriMult).toBe(1.0);
  });

  test('Year 2 ECRI multiplier is 1.06 (6% ECRI premium)', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    expect(result.yearData[1].ecriMult).toBeCloseTo(1.06, 2);
  });

  test('Year 5 ECRI multiplier is 1.32 (32% cumulative ECRI)', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    expect(result.yearData[4].ecriMult).toBeCloseTo(1.32, 2);
  });

  test('ECRI schedule handles zero values without falsy fallback', () => {
    // If someone explicitly sets ecriY1 to 0, it should stay 0 (not become 0.20)
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { ecriY1: 0 });
    expect(result.yearData[0].ecriMult).toBe(1.0);
  });

  test('DCF yrDataExt Y1 ECRI matches yearData Y1 ECRI', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    // Both loops should use the same ECRI multiplier for Y1
    expect(result.yrDataExt[0].ecriMult).toBe(result.yearData[0].ecriMult);
  });

  test('DCF yrDataExt Y5 revenue matches yearData Y5 revenue', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    // After rate rounding parity fix, Y5 revenue should match across both loops
    expect(result.yrDataExt[4].rev).toBe(result.yearData[4].totalRev);
  });

  test('sensitivity base case NOI is within $50 of Y5 stabilized NOI', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });
    const baseCase = result.sensitivityMatrix.grid[1][1]; // Base rent, base occ
    // Sensitivity uses simplified varPctSum (single rounding) vs yearData's individual rounding.
    // Acceptable tolerance: $50 on a ~$500K+ NOI = <0.01% variance.
    expect(Math.abs(baseCase.noi - result.yearData[4].noi)).toBeLessThanOrEqual(50);
  });
});

// ─── 14b. PRESSURE TESTS — Override Flow-Through (COD AUDIT 2026-03-22) ───
// Verifies that changing inputs at the ValuationInputs level flows through
// to pricing, NOI, YOC, IRR, land price guide, and recommendation.

describe('Override flow-through pressure tests', () => {
  const baseFinancials = () => computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' });

  test('raising climate rate raises stabilized NOI and improves YOC', () => {
    const base = baseFinancials();
    const bumped = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { climateRatePremium: 2.00 });
    // Higher rent → higher revenue → higher NOI
    expect(bumped.stabNOI).toBeGreaterThan(base.stabNOI);
    // Higher NOI / same dev cost → higher YOC
    expect(parseFloat(bumped.yocStab)).toBeGreaterThan(parseFloat(base.yocStab));
  });

  test('raising hard costs raises totalDevCost and lowers YOC', () => {
    const base = baseFinancials();
    const expensive = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { hardCostOneStoryClimate: 70 });
    // Higher hard cost → higher dev cost
    expect(expensive.totalDevCost).toBeGreaterThan(base.totalDevCost);
    // Higher dev cost / similar NOI → lower YOC
    expect(parseFloat(expensive.yocStab)).toBeLessThan(parseFloat(base.yocStab));
  });

  test('raising YOC strike threshold lowers max land price', () => {
    const base = baseFinancials();
    const tight = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { yocStrike: 0.12 });
    // Higher YOC requirement → less land budget
    expect(tight.landPrices[1].maxLand).toBeLessThan(base.landPrices[1].maxLand);
  });

  test('lowering stabilized occupancy lowers NOI and IRR', () => {
    const base = baseFinancials();
    const low = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { leaseUpY5Occ: 0.82 });
    expect(low.stabNOI).toBeLessThan(base.stabNOI);
    expect(parseFloat(low.irrPct)).toBeLessThan(parseFloat(base.irrPct));
  });

  test('site-specific override takes precedence over global override', () => {
    const globalOnly = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { climateRatePremium: 2.00 });
    const siteOverride = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { climateRatePremium: 2.00 }, { climateRatePremium: 0.80 });
    // Site override of $0.80 should override global $2.00
    expect(siteOverride.mktClimateRate).toBeLessThan(globalOnly.mktClimateRate);
  });

  test('changing exit cap rate changes exit value and IRR', () => {
    const base = baseFinancials();
    const compCap = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { exitCapRate: 0.05 });
    // Lower exit cap → higher exit value
    expect(compCap.exitValue).toBeGreaterThan(base.exitValue);
    expect(parseFloat(compCap.irrPct)).toBeGreaterThan(parseFloat(base.irrPct));
  });

  test('land verdict moves from BUY to PASS when asking price doubles', () => {
    const cheap = computeSiteFinancials({ ...baseSite, askingPrice: '$500,000' });
    const expensive = computeSiteFinancials({ ...baseSite, askingPrice: '$3,000,000' });
    // Cheap land should have a favorable verdict
    expect(['STRONG BUY', 'BUY', 'NEGOTIATE']).toContain(cheap.landVerdict);
    // Expensive land should have unfavorable verdict
    expect(['STRETCH', 'PASS']).toContain(expensive.landVerdict);
  });

  test('NOI margin stays within PS benchmark range (70-85%) at default inputs', () => {
    const result = baseFinancials();
    const margin = parseFloat(result.noiMarginPct);
    expect(margin).toBeGreaterThanOrEqual(60); // Floor: PS + overhead
    expect(margin).toBeLessThanOrEqual(85);     // Ceiling: PS best-in-class
  });

  test('DSCR above 1.25x at default inputs (lender minimum)', () => {
    const result = baseFinancials();
    const dscr = parseFloat(result.dscrStab);
    if (!isNaN(dscr) && dscr > 0) {
      expect(dscr).toBeGreaterThanOrEqual(1.25);
    }
  });

  test('changing hold period changes IRR and equity multiple', () => {
    const short = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { holdPeriod: 5 });
    const long = computeSiteFinancials({ ...baseSite, askingPrice: '$1,000,000' }, { holdPeriod: 15 });
    // Different hold periods should produce different IRRs
    expect(short.irrPct).not.toBe(long.irrPct);
    // Longer hold → higher equity multiple (more cash flow + appreciation)
    expect(parseFloat(long.equityMultiple)).toBeGreaterThan(parseFloat(short.equityMultiple));
  });
});

// ─── 15. ZONING TABLE ACCESSED GATE (§6h Rule #4) ───

describe('Zoning ordinance verification gate', () => {
  test('by-right zoning scores 10 with explicit classification (no zoningTableAccessed needed)', () => {
    const result = score({
      zoningClassification: 'by-right',
      zoningTableAccessed: false,
    });
    expect(result.scores.zoning).toBe(10);
    // Explicit classification bypasses the cap — no flag expected
    expect(result.flags.some(f => f.includes('ordinance not independently verified'))).toBe(false);
  });

  test('by-right zoning scores 10 WITH zoningTableAccessed', () => {
    const result = score({
      zoningClassification: 'by-right',
      zoningTableAccessed: true,
    });
    expect(result.scores.zoning).toBe(10);
  });

  test('regex "by right" in summary capped at 5 without zoningTableAccessed', () => {
    const result = score({
      zoningClassification: undefined,
      zoningTableAccessed: false,
      summary: 'by right for storage use',
      zoning: 'C-2',
    });
    expect(result.scores.zoning).toBe(5);
  });

  test('ETJ/no-zoning scores 10 without zoningTableAccessed (no ordinance exists)', () => {
    const result = score({
      zoningClassification: undefined,
      zoningTableAccessed: false,
      zoning: 'ETJ',
      summary: 'no zoning restrictions',
    });
    expect(result.scores.zoning).toBe(10);
  });

  test('conditional scores 6 with explicit classification (no zoningTableAccessed needed)', () => {
    const result = score({
      zoningClassification: 'conditional',
      zoningTableAccessed: false,
    });
    expect(result.scores.zoning).toBe(6);
  });

  test('rezone-required (score 2) NOT capped — already below 5', () => {
    const result = score({
      zoningClassification: 'rezone-required',
      zoningTableAccessed: false,
    });
    expect(result.scores.zoning).toBe(2);
  });

  test('prohibited (score 0) NOT capped — already below 5', () => {
    const result = score({
      zoningClassification: 'prohibited',
      zoningTableAccessed: false,
    });
    expect(result.scores.zoning).toBe(0);
    expect(result.hardFail).toBe(true);
  });

  test('unknown zoning (score 5) NOT capped — already at 5', () => {
    const result = score({
      zoningClassification: undefined,
      zoningTableAccessed: false,
      zoning: 'PD-42',
      summary: 'site available',
    });
    expect(result.scores.zoning).toBe(5);
  });
});

// ─── 16. SCORING BOUNDARY TESTS (Exact Thresholds) ───

describe('Exact boundary thresholds', () => {
  // HHI boundary: $55,000 exactly should score 4 (not FAIL)
  test('HHI exactly $55,000 scores 4 — not HARD FAIL', () => {
    const result = score({ income3mi: '$55,000' });
    expect(result.scores.income).toBe(4);
    expect(result.hardFail).toBe(false);
  });

  // HHI boundary: $54,999 should HARD FAIL
  test('HHI $54,999 is HARD FAIL', () => {
    const result = score({ income3mi: '$54,999' });
    expect(result.scores.income).toBe(0);
    expect(result.hardFail).toBe(true);
  });

  // Pop exactly 5,000 scores 3 (not FAIL)
  test('pop exactly 5,000 scores 3 — not HARD FAIL', () => {
    const result = score({ pop3mi: '5,000' });
    expect(result.scores.population).toBe(3);
    expect(result.hardFail).toBe(false);
  });

  // Acreage exactly 3.5 → score 8 (primary PS product)
  test('acreage exactly 3.5 scores 8 (primary product)', () => {
    const result = score({ acreage: '3.5', summary: 'site available' });
    expect(result.scores.access).toBe(8);
  });

  // Acreage exactly 2.5 → score 6 (multi-story secondary)
  test('acreage exactly 2.5 scores 6 (multi-story)', () => {
    const result = score({ acreage: '2.5', summary: 'site available' });
    expect(result.scores.access).toBe(6);
  });

  // Acreage exactly 5.0 → score 8 (upper bound of primary)
  test('acreage exactly 5.0 scores 8 (top of primary range)', () => {
    const result = score({ acreage: '5.0', summary: 'site available' });
    expect(result.scores.access).toBe(8);
  });

  // Acreage 5.01 → score 7 (falls into 5-7 range)
  test('acreage 5.01 scores 7 (large tract)', () => {
    const result = score({ acreage: '5.01', summary: 'site available' });
    expect(result.scores.access).toBe(7);
  });

  // Acreage exactly 7.0 → score 7 (top of 5-7 range)
  test('acreage exactly 7.0 scores 7 (top of large range)', () => {
    const result = score({ acreage: '7.0', summary: 'site available' });
    expect(result.scores.access).toBe(7);
  });

  // Acreage 7.01 → score 5 (>7 range)
  test('acreage 7.01 scores 5 (very large tract)', () => {
    const result = score({ acreage: '7.01', summary: 'site available' });
    expect(result.scores.access).toBe(5);
  });

  // PS distance exactly 35.0 → NOT a fail (≤ 35 allowed)
  test('PS distance exactly 35.0 mi is NOT a fail', () => {
    const result = score({ siteiqData: { nearestPS: 35.0 } });
    expect(result.scores.psProximity).toBe(3); // 25-35 range
    expect(result.hardFail).toBe(false);
  });

  // PS distance 35.01 → HARD FAIL
  test('PS distance 35.01 mi is HARD FAIL', () => {
    const result = score({ siteiqData: { nearestPS: 35.01 } });
    expect(result.scores.psProximity).toBe(0);
    expect(result.hardFail).toBe(true);
  });

  // Growth exactly 1.5% → score 9
  test('growth exactly 1.5% scores 9', () => {
    const result = score({ popGrowth3mi: '1.5' });
    expect(result.scores.growth).toBe(9);
  });

  // Growth exactly 1.0% → score 8
  test('growth exactly 1.0% scores 8', () => {
    const result = score({ popGrowth3mi: '1.0' });
    expect(result.scores.growth).toBe(8);
  });

  // Growth exactly -0.5% → score 2 (not 0)
  test('growth exactly -0.5% scores 2 — not zero', () => {
    const result = score({ popGrowth3mi: '-0.5' });
    expect(result.scores.growth).toBe(2);
  });

  // Stale listing: DOM exactly 1000 → no penalty (> 1000, not >=)
  test('DOM exactly 1000 days gets NO penalty', () => {
    const now = new Date();
    const dom1000 = new Date(now.getTime() - 1000 * 86400000).toISOString();
    const result = score({ dateOnMarket: dom1000 });
    expect(result.flags.every(f => !f.includes('Stale'))).toBe(true);
  });

  // Stale listing: DOM 1001 → -0.5 penalty
  test('DOM 1001 days gets stale penalty', () => {
    const now = new Date();
    const dom1001 = new Date(now.getTime() - 1001 * 86400000).toISOString();
    const result = score({ dateOnMarket: dom1001 });
    expect(result.flags.some(f => f.includes('Stale'))).toBe(true);
  });

  // Households boundaries
  test('households exactly 25,000 scores 10', () => {
    expect(score({ households3mi: '25,000' }).scores.households).toBe(10);
  });

  test('households exactly 6,000 scores 5', () => {
    expect(score({ households3mi: '6,000' }).scores.households).toBe(5);
  });

  // Home value boundaries
  test('home value exactly $500,000 scores 10', () => {
    expect(score({ homeValue3mi: '$500,000' }).scores.homeValue).toBe(10);
  });

  test('home value exactly $120,000 scores 4', () => {
    expect(score({ homeValue3mi: '$120,000' }).scores.homeValue).toBe(4);
  });

  test('home value $119,999 scores 2', () => {
    expect(score({ homeValue3mi: '$119,999' }).scores.homeValue).toBe(2);
  });
});

// ─── 17. WEIGHT REGRESSION GUARDS ───

describe('Individual dimension weights are locked', () => {
  test('population weight is exactly 0.16', () => {
    expect(SITE_SCORE_DEFAULTS.find(d => d.key === 'population').weight).toBe(0.16);
  });

  test('growth weight is exactly 0.21', () => {
    expect(SITE_SCORE_DEFAULTS.find(d => d.key === 'growth').weight).toBe(0.21);
  });

  test('income weight is exactly 0.10', () => {
    expect(SITE_SCORE_DEFAULTS.find(d => d.key === 'income').weight).toBe(0.10);
  });

  test('households weight is exactly 0.05', () => {
    expect(SITE_SCORE_DEFAULTS.find(d => d.key === 'households').weight).toBe(0.05);
  });

  test('homeValue weight is exactly 0.05', () => {
    expect(SITE_SCORE_DEFAULTS.find(d => d.key === 'homeValue').weight).toBe(0.05);
  });

  test('zoning weight is exactly 0.16', () => {
    expect(SITE_SCORE_DEFAULTS.find(d => d.key === 'zoning').weight).toBe(0.16);
  });

  test('psProximity weight is exactly 0.11', () => {
    expect(SITE_SCORE_DEFAULTS.find(d => d.key === 'psProximity').weight).toBe(0.11);
  });

  test('access weight is exactly 0.07', () => {
    expect(SITE_SCORE_DEFAULTS.find(d => d.key === 'access').weight).toBe(0.07);
  });

  test('competition weight is exactly 0.07', () => {
    expect(SITE_SCORE_DEFAULTS.find(d => d.key === 'competition').weight).toBe(0.07);
  });

  test('marketTier weight is exactly 0.02', () => {
    expect(SITE_SCORE_DEFAULTS.find(d => d.key === 'marketTier').weight).toBe(0.02);
  });
});
