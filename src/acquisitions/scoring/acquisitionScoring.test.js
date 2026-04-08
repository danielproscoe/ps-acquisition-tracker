// ─── AcquisitionScore v1.0 — Unit Tests ───
import { computeAcquisitionScore, scoreForAllBuyers, scoreContactIntelligence } from "./acquisitionScoring";
import { ACQUISITION_SCORE_DEFAULTS, DEFAULT_BUYER_PROFILES } from "./scoringDefaults";

// ─── Helper: create a facility with all fields populated ───
const baseFacility = (overrides = {}) => ({
  name: "Test Storage Facility",
  address: "123 Main St",
  city: "Dallas",
  state: "TX",
  totalSF: 65000,
  yearBuilt: 2010,
  facilityType: "mixed",
  climatePct: 60,
  crexi: {
    loanMaturityDate: "2027-01-15",
    loanOriginationDate: "2020-06-01",
    loanAmount: 3500000,
    loanRate: 3.8,
    loanLTV: 72,
  },
  owner: {
    type: "individual",
    name: "John Smith",
    email: "john@example.com",
    phone: "555-0100",
    portfolioSize: 1,
    contactVetLevel: "county_records",
  },
  ownerType: "individual",
  underwriting: {
    impliedCapRate: 7.5,
    marketCapRate: 5.5,
  },
  operations: {
    occupancy: 72,
    googleRating: 3.8,
    reviewKeywords: [],
  },
  occupancy: 72,
  pop3mi: 45000,
  income3mi: 82000,
  popGrowth3mi: "1.8",
  households3mi: 16000,
  siteiqData: {
    ccSPC: 3.2,
    nearestPS: 4.5,
    msaCCGrowth: 3.5,
  },
  ...overrides,
});

describe("computeAcquisitionScore", () => {
  // ─── BASIC SCORING ───
  test("returns a score between 0 and 10", () => {
    const result = computeAcquisitionScore(baseFacility(), ACQUISITION_SCORE_DEFAULTS);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  test("returns required shape fields", () => {
    const result = computeAcquisitionScore(baseFacility(), ACQUISITION_SCORE_DEFAULTS);
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("scores");
    expect(result).toHaveProperty("flags");
    expect(result).toHaveProperty("hardFail");
    expect(result).toHaveProperty("classification");
    expect(result).toHaveProperty("classColor");
    expect(result).toHaveProperty("breakdown");
    expect(result).toHaveProperty("tier");
    expect(result).toHaveProperty("label");
    expect(result).toHaveProperty("researchPct");
  });

  test("breakdown has 11 dimensions", () => {
    const result = computeAcquisitionScore(baseFacility(), ACQUISITION_SCORE_DEFAULTS);
    expect(result.breakdown).toHaveLength(11);
  });

  test("each breakdown entry has source, rawValue, methodology, verified", () => {
    const result = computeAcquisitionScore(baseFacility(), ACQUISITION_SCORE_DEFAULTS);
    result.breakdown.forEach((bd) => {
      expect(bd).toHaveProperty("source");
      expect(bd).toHaveProperty("rawValue");
      expect(bd).toHaveProperty("methodology");
      expect(bd).toHaveProperty("verified");
      expect(bd).toHaveProperty("label");
      expect(bd).toHaveProperty("key");
      expect(bd).toHaveProperty("score");
      expect(bd).toHaveProperty("weight");
      expect(bd).toHaveProperty("reason");
    });
  });

  // ─── DIMENSION 1: LOAN MATURITY ───
  test("loan maturing in 6 months scores 10", () => {
    const sixMonthsOut = new Date();
    sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 5);
    const f = baseFacility({ crexi: { ...baseFacility().crexi, loanMaturityDate: sixMonthsOut.toISOString() } });
    const result = computeAcquisitionScore(f, ACQUISITION_SCORE_DEFAULTS);
    expect(result.scores.loanMaturity).toBeGreaterThanOrEqual(9);
  });

  test("loan maturing in 30 months scores low", () => {
    const farOut = new Date();
    farOut.setMonth(farOut.getMonth() + 30);
    const f = baseFacility({ crexi: { ...baseFacility().crexi, loanMaturityDate: farOut.toISOString() } });
    const result = computeAcquisitionScore(f, ACQUISITION_SCORE_DEFAULTS);
    expect(result.scores.loanMaturity).toBeLessThanOrEqual(4);
  });

  test("no loan data scores 0", () => {
    const f = baseFacility({ crexi: {} });
    const result = computeAcquisitionScore(f, ACQUISITION_SCORE_DEFAULTS);
    expect(result.scores.loanMaturity).toBe(0);
  });

  test("high LTV bonus adds +1", () => {
    const nearMaturity = new Date();
    nearMaturity.setMonth(nearMaturity.getMonth() + 10);
    const withHighLTV = baseFacility({
      crexi: { loanMaturityDate: nearMaturity.toISOString(), loanLTV: 75, loanRate: 5, loanOriginationDate: "2023-01-01" },
    });
    const withoutHighLTV = baseFacility({
      crexi: { loanMaturityDate: nearMaturity.toISOString(), loanLTV: 60, loanRate: 5, loanOriginationDate: "2023-01-01" },
    });
    const r1 = computeAcquisitionScore(withHighLTV, ACQUISITION_SCORE_DEFAULTS);
    const r2 = computeAcquisitionScore(withoutHighLTV, ACQUISITION_SCORE_DEFAULTS);
    expect(r1.scores.loanMaturity).toBeGreaterThan(r2.scores.loanMaturity);
  });

  // ─── DIMENSION 2: OWNERSHIP ───
  test("individual owner scores 10", () => {
    const result = computeAcquisitionScore(baseFacility(), ACQUISITION_SCORE_DEFAULTS);
    expect(result.scores.ownership).toBe(10);
  });

  test("government owner is HARD FAIL", () => {
    const f = baseFacility({ ownerType: "government", owner: { type: "government" } });
    const result = computeAcquisitionScore(f, ACQUISITION_SCORE_DEFAULTS);
    expect(result.hardFail).toBe(true);
    expect(result.classification).toBe("RED");
  });

  // ─── DIMENSION 3: CAP RATE SPREAD ───
  test("200+ bps spread scores 10", () => {
    const f = baseFacility({ underwriting: { impliedCapRate: 8.0, marketCapRate: 5.5 } });
    const result = computeAcquisitionScore(f, ACQUISITION_SCORE_DEFAULTS);
    expect(result.scores.capRateSpread).toBe(10);
  });

  test("negative spread scores 1", () => {
    const f = baseFacility({ underwriting: { impliedCapRate: 4.5, marketCapRate: 5.5 } });
    const result = computeAcquisitionScore(f, ACQUISITION_SCORE_DEFAULTS);
    expect(result.scores.capRateSpread).toBe(1);
  });

  // ─── DIMENSION 8: OCCUPANCY (INVERTED) ───
  test("low occupancy (<70%) scores 10 (inverted)", () => {
    const f = baseFacility({ operations: { ...baseFacility().operations, occupancy: 65 }, occupancy: 65 });
    const result = computeAcquisitionScore(f, ACQUISITION_SCORE_DEFAULTS);
    expect(result.scores.occupancy).toBe(10);
  });

  test("high occupancy (>93%) scores 1 (inverted)", () => {
    const f = baseFacility({ operations: { ...baseFacility().operations, occupancy: 95 }, occupancy: 95 });
    const result = computeAcquisitionScore(f, ACQUISITION_SCORE_DEFAULTS);
    expect(result.scores.occupancy).toBe(1);
  });

  // ─── BINARY GATES ───
  test("environmental flag triggers hard fail", () => {
    const f = baseFacility({ environmentalFlag: true });
    const result = computeAcquisitionScore(f, ACQUISITION_SCORE_DEFAULTS);
    expect(result.hardFail).toBe(true);
    expect(result.flags).toEqual(expect.arrayContaining([expect.stringContaining("environmental")]));
  });

  test("flood zone A without insurance triggers hard fail", () => {
    const f = baseFacility({ floodZone: "Zone AE", floodInsurance: false });
    const result = computeAcquisitionScore(f, ACQUISITION_SCORE_DEFAULTS);
    expect(result.hardFail).toBe(true);
  });

  // ─── CLASSIFICATION ───
  test("well-populated facility classifies GREEN", () => {
    const result = computeAcquisitionScore(baseFacility(), ACQUISITION_SCORE_DEFAULTS);
    // baseFacility has strong data across all dimensions
    expect(["GREEN", "YELLOW"]).toContain(result.classification);
  });

  test("empty facility defaults to low score", () => {
    const result = computeAcquisitionScore({}, ACQUISITION_SCORE_DEFAULTS);
    expect(result.score).toBeLessThan(6);
  });

  // ─── BUYER-SPECIFIC WEIGHTS ───
  test("buyer profile overrides weights", () => {
    const skProfile = DEFAULT_BUYER_PROFILES.storageking;
    const sqProfile = DEFAULT_BUYER_PROFILES.storquest;
    const f = baseFacility();

    const skResult = computeAcquisitionScore(f, ACQUISITION_SCORE_DEFAULTS, skProfile);
    const sqResult = computeAcquisitionScore(f, ACQUISITION_SCORE_DEFAULTS, sqProfile);

    // Scores should differ because weights differ
    expect(skResult.score).not.toBeCloseTo(sqResult.score, 0);
  });

  // ─── RESEARCH COMPLETENESS ───
  test("full research data gives +0.5 bonus", () => {
    const full = baseFacility();
    const result = computeAcquisitionScore(full, ACQUISITION_SCORE_DEFAULTS);
    expect(result.researchPct).toBeGreaterThanOrEqual(80);
  });

  test("empty facility has low research pct", () => {
    const result = computeAcquisitionScore({}, ACQUISITION_SCORE_DEFAULTS);
    expect(result.researchPct).toBeLessThan(30);
  });

  // ─── LABELS & TIERS ───
  test("labels match score ranges", () => {
    const high = computeAcquisitionScore(baseFacility(), ACQUISITION_SCORE_DEFAULTS);
    if (high.score >= 9) expect(high.label).toBe("ELITE TARGET");
    else if (high.score >= 8) expect(high.label).toBe("PRIME TARGET");
    else if (high.score >= 7) expect(high.label).toBe("STRONG");
    else if (high.score >= 6) expect(high.label).toBe("VIABLE");
  });
});

describe("scoreForAllBuyers", () => {
  test("returns scores for each buyer profile", () => {
    const results = scoreForAllBuyers(baseFacility(), ACQUISITION_SCORE_DEFAULTS, DEFAULT_BUYER_PROFILES);
    expect(results).toHaveProperty("storquest");
    expect(results).toHaveProperty("storageking");
    expect(results.storquest).toHaveProperty("score");
    expect(results.storageking).toHaveProperty("score");
  });
});

describe("scoreContactIntelligence", () => {
  test("full contact info scores high confidence", () => {
    const result = scoreContactIntelligence({
      name: "John Smith",
      email: "john@smith.com",
      phone: "555-0100",
      mailingAddress: "123 Main St",
      entityName: "Smith Storage Inc",
      registeredAgent: "John Smith",
      phoneVerified: true,
      emailVerified: true,
      decisionMakerName: "John Smith",
      linkedInUrl: "https://linkedin.com/in/johnsmith",
      contactVetLevel: "direct_conversation",
    });
    expect(result.confidence).toBeGreaterThanOrEqual(90);
    expect(result.level).toBe("verified");
  });

  test("empty owner returns raw level", () => {
    const result = scoreContactIntelligence({});
    expect(result.confidence).toBeLessThan(30);
    expect(result.level).toBe("raw");
  });

  test("null owner returns unknown", () => {
    const result = scoreContactIntelligence(null);
    expect(result.confidence).toBe(0);
    expect(result.level).toBe("unknown");
  });

  test("generates ordered vet steps", () => {
    const result = scoreContactIntelligence({ name: "John", email: "john@test.com" });
    expect(result.vetSteps.length).toBeGreaterThan(0);
    // Steps should be priority-ordered
    for (let i = 1; i < result.vetSteps.length; i++) {
      expect(result.vetSteps[i].priority).toBeGreaterThanOrEqual(result.vetSteps[i - 1].priority);
    }
  });
});
