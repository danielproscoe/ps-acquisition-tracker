// ─── Unit Tests for SiteScore Scoring Engine ───
// McKinsey Audit: TEST-02 — scoring engine correctness verification
import { computeSiteScore, computeSiteFinancials } from './scoring';
import { SITE_SCORE_DEFAULTS } from './utils';

const baseSite = {
  name: 'Test Site',
  address: '123 Main St',
  city: 'Indianapolis',
  state: 'IN',
  acreage: '4.0',
  pop3mi: '35,000',
  income3mi: '$75,000',
  zoning: 'C-3',
  summary: 'SiteScore 7.5/10. C-3 — by right. No nearby storage. 4.0ac, 350\' frontage. No flood. Tier 1 — Indy.',
  siteiqData: {
    nearestPS: 8.5,
    competitorCount: 2,
    marketTier: 1,
    brokerConfirmedZoning: false,
    surveyClean: false,
  },
};

describe('computeSiteScore', () => {
  test('returns score between 0 and 10', () => {
    const result = computeSiteScore(baseSite, SITE_SCORE_DEFAULTS);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  test('returns all 10 dimension scores', () => {
    const result = computeSiteScore(baseSite, SITE_SCORE_DEFAULTS);
    expect(Object.keys(result.scores).length).toBe(10);
    expect(result.scores).toHaveProperty('population');
    expect(result.scores).toHaveProperty('growth');
    expect(result.scores).toHaveProperty('income');
    expect(result.scores).toHaveProperty('zoning');
    expect(result.scores).toHaveProperty('psProximity');
    expect(result.scores).toHaveProperty('access');
    expect(result.scores).toHaveProperty('competition');
    expect(result.scores).toHaveProperty('marketTier');
  });

  test('assigns tier label', () => {
    const result = computeSiteScore(baseSite, SITE_SCORE_DEFAULTS);
    expect(['gold', 'steel', 'gray']).toContain(result.tier);
    expect(result.label).toBeTruthy();
  });

  test('assigns classification', () => {
    const result = computeSiteScore(baseSite, SITE_SCORE_DEFAULTS);
    expect(['GREEN', 'YELLOW', 'ORANGE', 'RED']).toContain(result.classification);
  });

  test('hard FAILs on low population', () => {
    const lowPopSite = { ...baseSite, pop3mi: '2,000', siteiqData: { ...baseSite.siteiqData } };
    const result = computeSiteScore(lowPopSite, SITE_SCORE_DEFAULTS);
    expect(result.hardFail).toBe(true);
    expect(result.flags.some(f => f.includes('FAIL'))).toBe(true);
  });

  test('hard FAILs on low income', () => {
    const lowIncomeSite = { ...baseSite, income3mi: '$40,000', siteiqData: { ...baseSite.siteiqData } };
    const result = computeSiteScore(lowIncomeSite, SITE_SCORE_DEFAULTS);
    expect(result.hardFail).toBe(true);
  });

  test('by-right zoning scores higher than conditional', () => {
    const byRight = { ...baseSite, summary: 'by right zoning', siteiqData: { ...baseSite.siteiqData } };
    const conditional = { ...baseSite, summary: 'conditional SUP required', zoning: 'R-1', siteiqData: { ...baseSite.siteiqData } };
    const brResult = computeSiteScore(byRight, SITE_SCORE_DEFAULTS);
    const cResult = computeSiteScore(conditional, SITE_SCORE_DEFAULTS);
    expect(brResult.scores.zoning).toBeGreaterThan(cResult.scores.zoning);
  });

  test('handles missing siteiqData gracefully', () => {
    const noIQ = { ...baseSite, siteiqData: undefined };
    const result = computeSiteScore(noIQ, SITE_SCORE_DEFAULTS);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  test('handles empty site object', () => {
    const result = computeSiteScore({}, SITE_SCORE_DEFAULTS);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(typeof result.score).toBe('number');
    expect(result.flags).toBeDefined();
  });
});

describe('computeSiteFinancials', () => {
  test('returns financial model for valid site', () => {
    const site = { ...baseSite, askingPrice: '$1,200,000' };
    const result = computeSiteFinancials(site);
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  test('handles missing price gracefully', () => {
    const result = computeSiteFinancials({ ...baseSite, askingPrice: '' });
    expect(result).toBeDefined();
  });
});
