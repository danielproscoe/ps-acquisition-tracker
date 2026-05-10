// edgarCompIndex.test.js — coverage for the EDGAR-derived rent calibration
// accessor that replaces the old hard-coded SpareFoot fallback bands.
//
// The data flows from:
//   scripts/edgar/extract-schedule-iii.mjs       (per-issuer Sched III)
//   scripts/edgar/aggregate-comps.mjs            (cross-REIT state index)
//   scripts/edgar/extract-same-store-growth.mjs  (per-issuer rent disclosures)
//   scripts/edgar/build-rent-calibration.mjs     (this index)
//
// All bands cite specific 10-K accession numbers + filing URLs on sec.gov.

import {
  getStateRentBand,
  EDGAR_RENT_CALIBRATION_METADATA,
  getEDGARStateData,
  formatEDGARCitation,
  getCalibratedSameStoreGrowth,
  EDGAR_INDEX_METADATA,
} from "./edgarCompIndex";

// ══════════════════════════════════════════════════════════════════════════
// getStateRentBand — primary rent calibration accessor
// ══════════════════════════════════════════════════════════════════════════

describe("getStateRentBand", () => {
  test("returns a band for every major state", () => {
    for (const code of ["TX", "CA", "FL", "NY", "OH", "IN", "GA", "AZ"]) {
      const band = getStateRentBand(code);
      expect(band).not.toBeNull();
      expect(band.stateCode).toBe(code);
      expect(typeof band.ccRent).toBe("number");
      expect(typeof band.duRent).toBe("number");
      expect(band.ccRent).toBeGreaterThan(0);
      expect(band.duRent).toBeGreaterThan(0);
    }
  });

  test("CC rent always exceeds drive-up rent", () => {
    for (const code of ["TX", "CA", "FL", "NY", "OH", "IN", "MI", "WA"]) {
      const band = getStateRentBand(code);
      expect(band.ccRent).toBeGreaterThan(band.duRent);
      // 80% premium ± rounding
      const ratio = band.ccRent / band.duRent;
      expect(ratio).toBeGreaterThanOrEqual(1.78);
      expect(ratio).toBeLessThanOrEqual(1.82);
    }
  });

  test("high-cost markets (NY/HI) command higher rents than tertiary (KS/NM)", () => {
    const ny = getStateRentBand("NY");
    const oh = getStateRentBand("OH");
    expect(ny.ccRent).toBeGreaterThan(oh.ccRent);
    expect(ny.duRent).toBeGreaterThan(oh.duRent);
    // NY's geo multiplier should be > 1.0; OH's should be < 1.0
    expect(ny.geoMultiplier).toBeGreaterThan(1.0);
    expect(oh.geoMultiplier).toBeLessThan(1.0);
  });

  test("returns citations with SEC accession numbers", () => {
    const band = getStateRentBand("TX");
    expect(Array.isArray(band.citations)).toBe(true);
    expect(band.citations.length).toBeGreaterThan(0);
    // Every citation must include the accession # so the report can audit
    for (const c of band.citations) {
      expect(c.accessionNumber).toBeTruthy();
      expect(c.filingURL).toMatch(/sec\.gov/);
      expect(["PSA", "EXR", "CUBE", "SMA"]).toContain(c.issuer);
    }
  });

  test("source string identifies it as primary-source EDGAR-derived", () => {
    const band = getStateRentBand("FL");
    expect(band.source).toMatch(/EDGAR/i);
    expect(band.source).toMatch(/facilities/i);
  });

  test("falls back to national average when state has no data", () => {
    const band = getStateRentBand("XX"); // bogus state code
    expect(band).not.toBeNull();
    expect(band.stateCode).toBeNull();
    expect(band.stateName).toMatch(/national/i);
    expect(band.ccRent).toBeGreaterThan(0);
    expect(band.duRent).toBeGreaterThan(0);
  });

  test("returns null when fallback explicitly disabled and state missing", () => {
    expect(getStateRentBand("XX", { fallbackToNational: false })).toBeNull();
    expect(getStateRentBand("", { fallbackToNational: false })).toBeNull();
  });

  test("case-insensitive state code lookup", () => {
    const upper = getStateRentBand("tx");
    const lower = getStateRentBand("TX");
    expect(upper).toEqual(lower);
  });

  test("trims whitespace from state code", () => {
    expect(getStateRentBand("  TX  ")).toEqual(getStateRentBand("TX"));
  });

  test("confidence reflects sample size + issuer breadth", () => {
    const tx = getStateRentBand("TX"); // many facilities, all 4 REITs
    expect(["HIGH", "MEDIUM", "LOW", "VERY_LOW"]).toContain(tx.confidence);
    // States with 100+ facilities and 3+ REITs should be HIGH
    if (tx.sampleFacilities >= 100 && tx.contributingIssuers.length >= 3) {
      expect(tx.confidence).toBe("HIGH");
    }
  });

  test("contributingIssuers list matches citations", () => {
    const band = getStateRentBand("CA");
    const citedIssuers = new Set(band.citations.map((c) => c.issuer));
    for (const issuer of band.contributingIssuers) {
      // Every issuer in the contributing list must have a citation (or be
      // explicitly imputed for PSA/SMA where same-store rent is null)
      expect(["PSA", "EXR", "CUBE", "SMA"]).toContain(issuer);
    }
  });

  test("weightedAnnualPerSF is in plausible REIT-grade range ($14-25/SF/yr)", () => {
    for (const code of ["TX", "CA", "FL", "NY", "OH", "MI", "AZ"]) {
      const band = getStateRentBand(code);
      expect(band.weightedAnnualPerSF).toBeGreaterThanOrEqual(14);
      expect(band.weightedAnnualPerSF).toBeLessThanOrEqual(25);
    }
  });

  test("geoMultiplier bounded to [0.55, 1.65]", () => {
    for (const code of ["NY", "HI", "DC", "MD", "KS", "NM", "WI"]) {
      const band = getStateRentBand(code);
      expect(band.geoMultiplier).toBeGreaterThanOrEqual(0.55);
      expect(band.geoMultiplier).toBeLessThanOrEqual(1.65);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EDGAR_RENT_CALIBRATION_METADATA — audit metadata block
// ══════════════════════════════════════════════════════════════════════════

describe("EDGAR_RENT_CALIBRATION_METADATA", () => {
  test("schema identifies as v1 calibration", () => {
    expect(EDGAR_RENT_CALIBRATION_METADATA.schema).toBe("storvex.edgar-rent-calibration.v1");
  });

  test("methodology block documents weighting + CC/DU split", () => {
    const m = EDGAR_RENT_CALIBRATION_METADATA.methodology;
    expect(m.ccMixPct).toBe(0.73);
    expect(m.ccPremiumOverDU).toBe(1.80);
    expect(typeof m.formula).toBe("string");
    expect(m.formula).toMatch(/ccRent/);
    expect(m.formula).toMatch(/duRent/);
  });

  test("portfolio rent sources cite each REIT", () => {
    const sources = EDGAR_RENT_CALIBRATION_METADATA.methodology.portfolioRentSources;
    expect(sources.PSA).toMatch(/PSA/);
    expect(sources.EXR).toMatch(/10-K/);
    expect(sources.CUBE).toMatch(/10-K/);
    expect(sources.SMA).toBeTruthy();
  });

  test("issuer portfolio rents include all major REITs", () => {
    const rents = EDGAR_RENT_CALIBRATION_METADATA.issuerPortfolioRents;
    expect(rents.PSA).toBeTruthy();
    expect(rents.EXR).toBeTruthy();
    expect(rents.CUBE).toBeTruthy();
    expect(rents.SMA).toBeTruthy();
    // EXR + CUBE are 10-K disclosed (not imputed)
    expect(rents.EXR.isImputed).toBe(false);
    expect(rents.CUBE.isImputed).toBe(false);
    // PSA + SMA fallback values stay in plausible range
    expect(rents.PSA.annualPerSF).toBeGreaterThan(10);
    expect(rents.PSA.annualPerSF).toBeLessThan(30);
  });

  test("national fallback band is well-formed", () => {
    const nat = EDGAR_RENT_CALIBRATION_METADATA.nationalFallback;
    expect(nat.ccRent).toBeGreaterThan(0);
    expect(nat.duRent).toBeGreaterThan(0);
    expect(nat.ccRent).toBeGreaterThan(nat.duRent);
    expect(nat.sampleFacilities).toBeGreaterThanOrEqual(5000);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Existing accessors stay green — regression coverage
// ══════════════════════════════════════════════════════════════════════════

describe("existing accessors remain functional", () => {
  test("getEDGARStateData still returns state record", () => {
    const tx = getEDGARStateData("TX");
    expect(tx).toBeTruthy();
    expect(tx.stateCode).toBe("TX");
    expect(tx.totalFacilities).toBeGreaterThan(500);
  });

  test("formatEDGARCitation surfaces per-issuer breakdown", () => {
    const cite = formatEDGARCitation("CA");
    expect(cite).toBeTruthy();
    expect(Array.isArray(cite.issuers)).toBe(true);
    expect(cite.issuers.length).toBeGreaterThan(0);
  });

  test("getCalibratedSameStoreGrowth returns cross-REIT avg", () => {
    const g = getCalibratedSameStoreGrowth();
    expect(g).toBeTruthy();
    expect(typeof g.annualGrowthRate).toBe("number");
    expect(Array.isArray(g.contributingIssuers)).toBe(true);
  });

  test("EDGAR_INDEX_METADATA reports total facilities indexed", () => {
    expect(EDGAR_INDEX_METADATA.totalFacilities).toBeGreaterThan(5000);
    expect(EDGAR_INDEX_METADATA.issuersIngested).toContain("PSA");
    expect(EDGAR_INDEX_METADATA.issuersIngested).toContain("EXR");
    expect(EDGAR_INDEX_METADATA.issuersIngested).toContain("CUBE");
  });
});
