// ─── Unit Tests for Utility Functions & Validators ───
// McKinsey Audit: TEST-01 — baseline test coverage for business-critical functions
import {
  sanitizeString, cleanText, isValidCoordinates, isValidState, isValidPrice, isValidAcreage,
  uid, fmt$, fmtN, safeNum, escapeHtml, stripEmoji, cleanPriority,
  normalizeSiteScoreWeights, SITE_SCORE_DEFAULTS, PHASES,
} from './utils';

// ─── Sanitization ───
describe('sanitizeString', () => {
  test('trims whitespace', () => expect(sanitizeString('  hello  ')).toBe('hello'));
  test('strips null bytes', () => expect(sanitizeString('he\x00llo')).toBe('hello'));
  test('strips control chars', () => expect(sanitizeString('he\x01l\x02lo')).toBe('hello'));
  test('preserves newlines in notes', () => expect(sanitizeString('line1\nline2')).toBe('line1\nline2'));
  test('handles non-string input', () => expect(sanitizeString(123)).toBe(''));
  test('handles null', () => expect(sanitizeString(null)).toBe(''));
  test('truncates at 5000 chars', () => expect(sanitizeString('a'.repeat(6000)).length).toBe(5000));
});

// ─── Deep Text Normalization ───
// Catches the bugs caught in the 5/7/26 dashboard QC: U+FFFD replacement chars
// from broken Firebase writes, and "[ST] -- " / "[ST] - " separators that bypass
// the em-dash convention.
describe('cleanText', () => {
  // U+FFFD heuristic (was almost always an em-dash in the DJR data)
  test('replaces U+FFFD with em-dash (broker line)', () =>
    expect(cleanText('Zachary Schunn � Edge Real Estate Group'))
      .toBe('Zachary Schunn — Edge Real Estate Group'));
  test('replaces multiple U+FFFD instances', () =>
    expect(cleanText('Lancaster TX � Tater Brown (ORPHAN � needs cleanup)'))
      .toBe('Lancaster TX — Tater Brown (ORPHAN — needs cleanup)'));

  // Dash typography normalization — anchored on US state abbrev
  test('normalizes "[ST] -- " to "[ST] — "', () =>
    expect(cleanText('Westampton NJ -- 598 Rancocas Rd'))
      .toBe('Westampton NJ — 598 Rancocas Rd'));
  test('normalizes "[ST] - " to "[ST] — "', () =>
    expect(cleanText('Halfmoon NY - 1879 Route 9'))
      .toBe('Halfmoon NY — 1879 Route 9'));
  test('normalizes within longer titles', () =>
    expect(cleanText('South Lebanon OH -- I-71 & SR 48'))
      .toBe('South Lebanon OH — I-71 & SR 48'));

  // Negative cases — must NOT touch
  test('does not touch I-71 highway designation', () =>
    expect(cleanText('Sites along I-71 corridor')).toBe('Sites along I-71 corridor'));
  test('does not touch hyphenated words like drive-thru', () =>
    expect(cleanText('Coffee drive-thru pad on US-31')).toBe('Coffee drive-thru pad on US-31'));
  test('does not touch dates like 2026-05-07', () =>
    expect(cleanText('Filed 2026-05-07')).toBe('Filed 2026-05-07'));

  // Delegates UTF-8/CP1252 mojibake to fixEncoding
  test('still fixes em-dash mojibake via fixEncoding delegation', () =>
    expect(cleanText('Mike Cassidy â€” Carolina One'))
      .toBe('Mike Cassidy — Carolina One'));

  // Type safety
  test('handles non-string input', () => expect(cleanText(123)).toBe(123));
  test('handles null', () => expect(cleanText(null)).toBe(null));
  test('handles undefined', () => expect(cleanText(undefined)).toBe(undefined));
  test('handles empty string', () => expect(cleanText('')).toBe(''));
});

// ─── Coordinate Validation ───
describe('isValidCoordinates', () => {
  test('valid lat,lng', () => expect(isValidCoordinates('33.123, -97.456')).toBe(true));
  test('valid negative both', () => expect(isValidCoordinates('-33.123, -97.456')).toBe(true));
  test('empty is valid (optional)', () => expect(isValidCoordinates('')).toBe(true));
  test('null is valid (optional)', () => expect(isValidCoordinates(null)).toBe(true));
  test('invalid text', () => expect(isValidCoordinates('not coords')).toBe(false));
  test('lat out of range', () => expect(isValidCoordinates('91, -97')).toBe(false));
  test('lng out of range', () => expect(isValidCoordinates('33, 181')).toBe(false));
});

// ─── State Validation ───
describe('isValidState', () => {
  test('valid TX', () => expect(isValidState('TX')).toBe(true));
  test('valid lowercase', () => expect(isValidState('tx')).toBe(true));
  test('valid with whitespace', () => expect(isValidState(' OH ')).toBe(true));
  test('invalid XX', () => expect(isValidState('XX')).toBe(false));
  test('too long', () => expect(isValidState('Texas')).toBe(false));
});

// ─── Price Validation ───
describe('isValidPrice', () => {
  test('valid number', () => expect(isValidPrice('500000')).toBe(true));
  test('valid with $ and commas', () => expect(isValidPrice('$1,500,000')).toBe(true));
  test('empty is valid (optional)', () => expect(isValidPrice('')).toBe(true));
  test('negative is invalid', () => expect(isValidPrice('-100')).toBe(false));
  test('absurdly large', () => expect(isValidPrice('99999999999')).toBe(false));
  test('text is invalid', () => expect(isValidPrice('lots')).toBe(false));
});

// ─── Acreage Validation ───
describe('isValidAcreage', () => {
  test('valid 3.5', () => expect(isValidAcreage('3.5')).toBe(true));
  test('empty is valid', () => expect(isValidAcreage('')).toBe(true));
  test('zero is invalid', () => expect(isValidAcreage('0')).toBe(false));
  test('negative is invalid', () => expect(isValidAcreage('-1')).toBe(false));
});

// ─── Core Utilities ───
describe('uid', () => {
  test('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid()));
    expect(ids.size).toBe(100);
  });
});

describe('fmt$', () => {
  test('formats dollar amounts', () => expect(fmt$(1500000)).toBe('$1,500,000'));
  test('handles 0', () => expect(fmt$(0)).toBe('$0'));
});

describe('fmtN', () => {
  test('formats numbers with commas', () => expect(fmtN(42000)).toBe('42,000'));
});

describe('safeNum', () => {
  test('parses valid number', () => expect(safeNum('42.5')).toBe(42.5));
  test('returns 0 for NaN', () => expect(safeNum('abc')).toBe(0));
  test('strips $ and commas', () => expect(safeNum('$1,500')).toBe(1500));
});

describe('escapeHtml', () => {
  test('escapes angle brackets', () => expect(escapeHtml('<script>')).toBe('&lt;script&gt;'));
  test('escapes ampersand', () => expect(escapeHtml('A&B')).toBe('A&amp;B'));
  test('escapes quotes', () => expect(escapeHtml('"test"')).toBe('&quot;test&quot;'));
});

describe('stripEmoji', () => {
  test('strips emoji prefix', () => expect(stripEmoji('🔥 Hot')).toBe('Hot'));
  test('handles plain text', () => expect(stripEmoji('None')).toBe('None'));
});

describe('cleanPriority', () => {
  test('cleans emoji priority', () => expect(cleanPriority('🔥 Hot')).toBe('Hot'));
  test('handles empty', () => expect(cleanPriority('')).toBe('None'));
});

// ─── SiteScore Config ───
describe('SITE_SCORE_DEFAULTS', () => {
  test('has 9 dimensions', () => expect(SITE_SCORE_DEFAULTS.length).toBe(9));
  test('weights sum to ~1.0', () => {
    const sum = SITE_SCORE_DEFAULTS.reduce((s, d) => s + d.weight, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });

  // ─── DRIFT PREVENTION — v4.0 locked weight table (QC audit 2026-03-26) ───
  // If this test fails, it means someone changed SITE_SCORE_DEFAULTS weights
  // without updating CLAUDE.md §6h and Scoring Integrity Rule #1.
  // Update BOTH the code AND the docs, then update this table to match.
  test('v4.0 locked weights match expected table (drift prevention)', () => {
    const expected = {
      population: 0.14,
      growth: 0.18,
      income: 0.10,
      households: 0.04,
      homeValue: 0.04,
      zoning: 0.16,
      access: 0.07,
      competition: 0.25,
      marketTier: 0.02,
    };
    const actual = {};
    SITE_SCORE_DEFAULTS.forEach(d => { actual[d.key] = d.weight; });
    Object.entries(expected).forEach(([key, weight]) => {
      expect(actual[key]).toBeCloseTo(weight, 3);
    });
  });

  test('all required dimension keys present (no psProximity — binary gate only)', () => {
    const keys = SITE_SCORE_DEFAULTS.map(d => d.key);
    expect(keys).toEqual(expect.arrayContaining([
      'population', 'growth', 'income', 'households', 'homeValue',
      'zoning', 'access', 'competition', 'marketTier',
    ]));
    expect(keys).not.toContain('psProximity');
    expect(keys).not.toContain('pricing');
  });
});

describe('normalizeSiteScoreWeights', () => {
  test('normalizes to sum 1.0', () => {
    const input = SITE_SCORE_DEFAULTS.map(d => ({ ...d, weight: d.weight * 2 }));
    const result = normalizeSiteScoreWeights(input);
    const sum = result.reduce((s, d) => s + d.weight, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });
  test('handles zero weights', () => {
    const input = SITE_SCORE_DEFAULTS.map(d => ({ ...d, weight: 0 }));
    const result = normalizeSiteScoreWeights(input);
    // Should not crash, returns original
    expect(result.length).toBe(9);
  });
});

// ─── Business Constants ───
describe('PHASES', () => {
  test('has 9 phases', () => expect(PHASES.length).toBe(9));
  test('includes Prospect', () => expect(PHASES).toContain('Prospect'));
  test('includes Closed', () => expect(PHASES).toContain('Closed'));
  test('includes Dead', () => expect(PHASES).toContain('Dead'));
});
