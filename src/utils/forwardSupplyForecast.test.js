import {
  computeForwardSupplyForecast,
  describeForecast,
  DEFAULT_CONFIDENCE_WEIGHTS,
  DEFAULT_HORIZON_MONTHS,
} from "./forwardSupplyForecast";

const ASOF = new Date("2026-05-12T12:00:00Z");

describe("computeForwardSupplyForecast — submarket targeting", () => {
  test("returns 0 entries for an unseeded submarket", () => {
    const r = computeForwardSupplyForecast({
      city: "Nowheresville",
      state: "ZZ",
      asOf: ASOF,
      includeHistoricalProjection: false,
    });
    expect(r.sources.edgar.entryCount).toBe(0);
    expect(r.sources.permit.entryCount).toBe(0);
    expect(r.totals.totalForecastCcSf).toBe(0);
  });

  test("matches by msa parameter when supplied", () => {
    // Miami MSA has a seeded PSA Doral entry in development-pipeline.json
    const r = computeForwardSupplyForecast({
      msa: "Miami",
      horizonMonths: 24,
      asOf: ASOF,
      includeHistoricalProjection: false,
    });
    expect(r.sources.edgar.entryCount).toBeGreaterThanOrEqual(1);
    expect(r.sources.edgar.ccSf).toBeGreaterThan(0);
  });

  test("matches by city+state when supplied", () => {
    const r = computeForwardSupplyForecast({
      city: "Doral",
      state: "FL",
      horizonMonths: 24,
      asOf: ASOF,
      includeHistoricalProjection: false,
    });
    expect(r.sources.edgar.entryCount).toBeGreaterThanOrEqual(1);
  });
});

describe("computeForwardSupplyForecast — confidence classification", () => {
  test("every entry has a confidence label in {VERIFIED, CLAIMED, STALE, UNVERIFIED}", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF });
    const all = [...r.sources.edgar.breakdown, ...r.sources.permit.breakdown];
    for (const e of all) {
      expect(["VERIFIED", "CLAIMED", "STALE", "UNVERIFIED"]).toContain(e.confidence);
    }
  });

  test("entriesByConfidence tallies sum to total entry count", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF });
    const sumByConf = Object.values(r.entriesByConfidence).reduce((s, v) => s + v, 0);
    const totalEntries = r.sources.edgar.entryCount + r.sources.permit.entryCount;
    expect(sumByConf).toBe(totalEntries);
  });

  test("confidence-weighted CC SF respects DEFAULT_CONFIDENCE_WEIGHTS", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF, includeHistoricalProjection: false });
    const expected =
      r.totals.verifiedCcSf * DEFAULT_CONFIDENCE_WEIGHTS.VERIFIED +
      r.totals.claimedCcSf * DEFAULT_CONFIDENCE_WEIGHTS.CLAIMED +
      r.totals.staleCcSf * DEFAULT_CONFIDENCE_WEIGHTS.STALE +
      r.totals.unverifiedCcSf * DEFAULT_CONFIDENCE_WEIGHTS.UNVERIFIED;
    expect(r.totals.confidenceWeightedCcSf).toBeCloseTo(expected, 5);
  });

  test("custom confidence weights override defaults", () => {
    const r = computeForwardSupplyForecast({
      msa: "Miami",
      asOf: ASOF,
      includeHistoricalProjection: false,
      confidenceWeights: { VERIFIED: 0.5, CLAIMED: 0, STALE: 0, UNVERIFIED: 0 },
    });
    const expected = r.totals.verifiedCcSf * 0.5;
    expect(r.totals.confidenceWeightedCcSf).toBeCloseTo(expected, 5);
  });
});

describe("computeForwardSupplyForecast — horizon filtering", () => {
  test("12-month horizon includes fewer entries than 36-month horizon for active submarkets", () => {
    const short = computeForwardSupplyForecast({ msa: "Houston", horizonMonths: 12, asOf: ASOF, includeHistoricalProjection: false });
    const long = computeForwardSupplyForecast({ msa: "Houston", horizonMonths: 36, asOf: ASOF, includeHistoricalProjection: false });
    // Long horizon must capture at least as many entries as short
    expect(long.sources.edgar.entryCount + long.sources.permit.entryCount).toBeGreaterThanOrEqual(
      short.sources.edgar.entryCount + short.sources.permit.entryCount
    );
  });

  test("default horizon is 24 months", () => {
    expect(DEFAULT_HORIZON_MONTHS).toBe(24);
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF });
    expect(r.horizonMonths).toBe(24);
  });

  test("explicit horizon overrides default", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", horizonMonths: 6, asOf: ASOF });
    expect(r.horizonMonths).toBe(6);
  });
});

describe("computeForwardSupplyForecast — confidence tier derivation", () => {
  test("returns 'low' for unseeded submarket", () => {
    const r = computeForwardSupplyForecast({ city: "Nowheresville", state: "ZZ", asOf: ASOF });
    expect(r.confidenceTier).toBe("low");
    expect(r.primarySourceCount).toBe(0);
  });

  test("returns at least 'medium' when EDGAR has a VERIFIED entry", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF });
    // Miami has psa-miami-2026q3 with citation = "Accession ..." → VERIFIED
    if (r.entriesByConfidence.VERIFIED >= 1) {
      expect(["medium", "high"]).toContain(r.confidenceTier);
    }
  });

  test("primarySourceCount counts non-empty source contributions", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF });
    let expected = 0;
    if (r.sources.edgar.entryCount > 0) expected++;
    if (r.sources.permit.entryCount > 0) expected++;
    if (r.sources.historical.projectedCcSf > 0) expected++;
    expect(r.primarySourceCount).toBe(expected);
  });
});

describe("computeForwardSupplyForecast — per-source attribution", () => {
  test("sources object always has edgar / permit / historical keys", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF });
    expect(r.sources).toHaveProperty("edgar");
    expect(r.sources).toHaveProperty("permit");
    expect(r.sources).toHaveProperty("historical");
  });

  test("edgar breakdown contains the original facility + source attribution", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF });
    for (const e of r.sources.edgar.breakdown) {
      expect(e.source).toBe("EDGAR");
      expect(e).toHaveProperty("registryFile");
      expect(e).toHaveProperty("facility");
      expect(e).toHaveProperty("confidence");
      expect(e).toHaveProperty("nrsf");
    }
  });

  test("includeHistoricalProjection=false suppresses historical component", () => {
    const r = computeForwardSupplyForecast({
      msa: "Miami",
      asOf: ASOF,
      includeHistoricalProjection: false,
    });
    expect(r.sources.historical.projectedCcSf).toBe(0);
    expect(r.totals.projectedCcSf).toBe(0);
  });

  test("totalForecastCcSf = confidenceWeightedCcSf + projectedCcSf", () => {
    const r = computeForwardSupplyForecast({ msa: "Houston", asOf: ASOF });
    expect(r.totals.totalForecastCcSf).toBeCloseTo(
      r.totals.confidenceWeightedCcSf + r.totals.projectedCcSf,
      5
    );
  });
});

describe("describeForecast — English summary", () => {
  test("includes submarket label, horizon, and confidence tier", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF });
    const desc = describeForecast(r);
    expect(desc).toMatch(/Miami/);
    expect(desc).toMatch(/24 months/);
    expect(desc).toMatch(/Confidence tier/);
    expect(desc).toMatch(/(HIGH|MEDIUM|LOW)/);
  });

  test("includes per-source count attribution", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF });
    const desc = describeForecast(r);
    // At least one of these patterns should appear
    expect(
      /EDGAR-disclosed/.test(desc) ||
      /county-permit/.test(desc) ||
      /historical-trajectory/.test(desc) ||
      /no primary-source/.test(desc)
    ).toBe(true);
  });

  test("includes per-confidence verdict breakdown", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF });
    const desc = describeForecast(r);
    expect(desc).toMatch(/VERIFIED/);
    expect(desc).toMatch(/CLAIMED/);
    expect(desc).toMatch(/STALE/);
  });

  test("describes empty submarket gracefully", () => {
    const r = computeForwardSupplyForecast({ city: "Nowheresville", state: "ZZ", asOf: ASOF });
    const desc = describeForecast(r);
    expect(typeof desc).toBe("string");
    expect(desc.length).toBeGreaterThan(0);
  });
});

describe("computeForwardSupplyForecast — output shape contract", () => {
  test("always returns the full result shape (no missing keys)", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF });
    expect(r).toHaveProperty("submarket");
    expect(r).toHaveProperty("horizonMonths");
    expect(r).toHaveProperty("asOf");
    expect(r).toHaveProperty("sources.edgar");
    expect(r).toHaveProperty("sources.permit");
    expect(r).toHaveProperty("sources.historical");
    expect(r).toHaveProperty("totals.verifiedCcSf");
    expect(r).toHaveProperty("totals.claimedCcSf");
    expect(r).toHaveProperty("totals.staleCcSf");
    expect(r).toHaveProperty("totals.unverifiedCcSf");
    expect(r).toHaveProperty("totals.confidenceWeightedCcSf");
    expect(r).toHaveProperty("totals.projectedCcSf");
    expect(r).toHaveProperty("totals.totalForecastCcSf");
    expect(r).toHaveProperty("entriesByConfidence.VERIFIED");
    expect(r).toHaveProperty("entriesByConfidence.CLAIMED");
    expect(r).toHaveProperty("entriesByConfidence.STALE");
    expect(r).toHaveProperty("entriesByConfidence.UNVERIFIED");
    expect(r).toHaveProperty("primarySourceCount");
    expect(r).toHaveProperty("confidenceTier");
  });

  test("asOf is normalized to ISO string", () => {
    const r = computeForwardSupplyForecast({ msa: "Miami", asOf: ASOF });
    expect(r.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("handles empty query gracefully (returns zero-state)", () => {
    const r = computeForwardSupplyForecast({});
    expect(r.totals.totalForecastCcSf).toBeGreaterThanOrEqual(0);
    expect(r.confidenceTier).toBe("low");
  });
});
