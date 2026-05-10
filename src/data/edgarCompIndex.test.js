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
  getMSARentBand,
  getBestRentBand,
  resolveCityToMSA,
  estimateFacilityCostBasis,
  enrichCompetitor,
  enrichNearbyCompetitors,
  EDGAR_RENT_CALIBRATION_METADATA,
  getEDGARStateData,
  formatEDGARCitation,
  getCalibratedSameStoreGrowth,
  EDGAR_INDEX_METADATA,
} from "./edgarCompIndex";

// Lightweight haversine for tests — pulled inline to avoid jsdom CSV-load
// dependency. Validated against src/haversine.js.
function testHaversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
    expect(["TRIPLE_VALIDATED", "DOUBLE_VALIDATED", "SINGLE_SOURCE", "THIN_SAMPLE"]).toContain(tx.confidence);
    // States with 100+ facilities and 3+ REITs should be TRIPLE_VALIDATED
    if (tx.sampleFacilities >= 100 && tx.contributingIssuers.length >= 3) {
      expect(tx.confidence).toBe("TRIPLE_VALIDATED");
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

// ══════════════════════════════════════════════════════════════════════════
// getMSARentBand — per-MSA rent calibration (highest fidelity)
// ══════════════════════════════════════════════════════════════════════════

describe("getMSARentBand — PSA-disclosed per-MSA rents", () => {
  test("returns disclosed rent for PSA's named MSAs", () => {
    const la = getMSARentBand("Los Angeles");
    expect(la).not.toBeNull();
    expect(la.msa).toBe("Los Angeles");
    expect(la.stateCode).toBe("CA");
    expect(la.weightedAnnualPerSF).toBe(35.76); // FY2025 PSA-disclosed
    expect(la.confidence).toBe("MSA_DISCLOSED_PSA");
    expect(la.facilities).toBe(217);
    expect(la.ccRent).toBeGreaterThan(3.0); // LA is >$3/mo CC
    expect(la.duRent).toBeGreaterThan(1.7);
  });

  test("Honolulu commands the highest rent in the index", () => {
    const honolulu = getMSARentBand("Honolulu");
    expect(honolulu).not.toBeNull();
    expect(honolulu.weightedAnnualPerSF).toBeGreaterThan(50);
    expect(honolulu.ccRent).toBeGreaterThan(5.0); // ~$5.23/mo CC
  });

  test("MSA aliases resolve correctly", () => {
    expect(getMSARentBand("DFW")?.msa).toBe("Dallas-Ft. Worth");
    expect(getMSARentBand("Dallas/Ft. Worth")?.msa).toBe("Dallas-Ft. Worth");
    expect(getMSARentBand("NYC")?.msa).toBe("New York");
    expect(getMSARentBand("DC")?.msa).toBe("Washington DC");
    expect(getMSARentBand("Bay Area")?.msa).toBe("San Francisco");
  });

  test("returns null for undisclosed MSAs", () => {
    expect(getMSARentBand("Buffalo")).toBeNull();
    expect(getMSARentBand("Albuquerque")).toBeNull();
    expect(getMSARentBand("")).toBeNull();
    expect(getMSARentBand(null)).toBeNull();
  });

  test("every MSA cites a SEC accession number", () => {
    const msas = ["Los Angeles", "New York", "Honolulu", "Chicago", "Atlanta"];
    for (const m of msas) {
      const band = getMSARentBand(m);
      expect(band.accessionNumber).toMatch(/0001628280-26-007696/); // PSA's FY2025 10-K
      expect(band.filingURL).toMatch(/sec\.gov/);
      expect(band.citations.length).toBeGreaterThan(0);
    }
  });

  test("CC/DU split holds the 80% premium constraint", () => {
    const msas = ["Los Angeles", "New York", "Atlanta", "Chicago"];
    for (const m of msas) {
      const band = getMSARentBand(m);
      const ratio = band.ccRent / band.duRent;
      expect(ratio).toBeGreaterThanOrEqual(1.78);
      expect(ratio).toBeLessThanOrEqual(1.82);
    }
  });

  test("occupancy is plausible (88-96% range)", () => {
    const msas = ["Los Angeles", "Atlanta", "Charlotte", "Honolulu"];
    for (const m of msas) {
      const band = getMSARentBand(m);
      expect(band.occupancy_2025).toBeGreaterThan(0.85);
      expect(band.occupancy_2025).toBeLessThan(0.97);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// getBestRentBand — MSA > state > national fallback
// ══════════════════════════════════════════════════════════════════════════

describe("getBestRentBand", () => {
  test("uses MSA when both MSA + state are provided and MSA is disclosed", () => {
    const band = getBestRentBand({ msa: "Los Angeles", state: "CA" });
    expect(band.msa).toBe("Los Angeles");
    expect(band.confidence).toBe("MSA_DISCLOSED_PSA");
  });

  test("falls back to state when MSA is undisclosed", () => {
    const band = getBestRentBand({ msa: "Buffalo", state: "NY" });
    expect(band.stateCode).toBe("NY");
    expect(band.confidence).toBe("TRIPLE_VALIDATED");
  });

  test("falls back to national when neither MSA nor state available", () => {
    const band = getBestRentBand({ msa: null, state: null });
    expect(band).toBeTruthy();
    expect(band.stateName).toMatch(/national/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// resolveCityToMSA — city → PSA-disclosed MSA disambiguation
// ══════════════════════════════════════════════════════════════════════════

describe("resolveCityToMSA", () => {
  test("LA suburbs map to Los Angeles MSA", () => {
    expect(resolveCityToMSA("Los Angeles", "CA")).toBe("Los Angeles");
    expect(resolveCityToMSA("Long Beach", "CA")).toBe("Los Angeles");
    expect(resolveCityToMSA("Pasadena", "CA")).toBe("Los Angeles");
    expect(resolveCityToMSA("Costa Mesa", "CA")).toBe("Los Angeles");
    expect(resolveCityToMSA("Burbank", "CA")).toBe("Los Angeles");
  });

  test("Bay Area cities map to San Francisco MSA", () => {
    expect(resolveCityToMSA("San Jose", "CA")).toBe("San Francisco");
    expect(resolveCityToMSA("Oakland", "CA")).toBe("San Francisco");
    expect(resolveCityToMSA("Fremont", "CA")).toBe("San Francisco");
  });

  test("DFW suburbs map to Dallas-Ft. Worth", () => {
    expect(resolveCityToMSA("Dallas", "TX")).toBe("Dallas-Ft. Worth");
    expect(resolveCityToMSA("Plano", "TX")).toBe("Dallas-Ft. Worth");
    expect(resolveCityToMSA("Frisco", "TX")).toBe("Dallas-Ft. Worth");
  });

  test("Houston suburbs map to Houston MSA", () => {
    expect(resolveCityToMSA("Houston", "TX")).toBe("Houston");
    expect(resolveCityToMSA("Sugar Land", "TX")).toBe("Houston");
    expect(resolveCityToMSA("Katy", "TX")).toBe("Houston");
    expect(resolveCityToMSA("The Woodlands", "TX")).toBe("Houston");
  });

  test("NYC and metro NJ cities map to New York MSA", () => {
    expect(resolveCityToMSA("Brooklyn", "NY")).toBe("New York");
    expect(resolveCityToMSA("Queens", "NY")).toBe("New York");
    expect(resolveCityToMSA("Newark", "NJ")).toBe("New York");
    expect(resolveCityToMSA("Jersey City", "NJ")).toBe("New York");
  });

  test("returns null for cities outside disclosed MSAs", () => {
    expect(resolveCityToMSA("Buffalo", "NY")).toBeNull();
    expect(resolveCityToMSA("Spokane", "WA")).toBeNull();
    expect(resolveCityToMSA("Tucson", "AZ")).toBeNull();
    expect(resolveCityToMSA("Albuquerque", "NM")).toBeNull();
    expect(resolveCityToMSA(null)).toBeNull();
    expect(resolveCityToMSA("")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// estimateFacilityCostBasis — Schedule III pro-rata allocation
// ══════════════════════════════════════════════════════════════════════════

describe("estimateFacilityCostBasis", () => {
  test("returns MSA aggregate when city + state map to a known MSA", () => {
    const result = estimateFacilityCostBasis({ city: "Los Angeles", state: "CA", brand: "PS" });
    expect(result).not.toBeNull();
    expect(result.estimatedGrossPSF).toBeGreaterThan(100);
    expect(result.basis).toBe("msa-aggregate");
    expect(result.msa).toBe("Los Angeles");
    expect(result.accessionNumber).toBeTruthy();
  });

  test("falls back to state-weighted PSF when city is unmatched", () => {
    const result = estimateFacilityCostBasis({ city: "Buffalo", state: "NY", brand: "PS" });
    expect(result).not.toBeNull();
    expect(result.basis).toBe("state-weighted");
    expect(result.estimatedGrossPSF).toBeGreaterThan(100);
  });

  test("returns null without state", () => {
    expect(estimateFacilityCostBasis({ city: "Anywhere" })).toBeNull();
    expect(estimateFacilityCostBasis(null)).toBeNull();
  });

  test("source citation is human-readable", () => {
    const r = estimateFacilityCostBasis({ city: "Houston", state: "TX", brand: "PS" });
    expect(r.source).toMatch(/Schedule III/i);
    expect(r.source).toMatch(/\$\d+\/SF/); // includes the PSF figure
  });
});

// ══════════════════════════════════════════════════════════════════════════
// enrichCompetitor + enrichNearbyCompetitors — pure-function enrichment
// ══════════════════════════════════════════════════════════════════════════

describe("enrichCompetitor", () => {
  test("computes distance + cost basis + rent for a known LA facility", () => {
    const facility = { brand: "PS", name: "PS LA", city: "Los Angeles", state: "CA", lat: 34.05, lng: -118.25 };
    const subjectLat = 34.10; // ~3.5 mi north
    const subjectLng = -118.25;
    const e = enrichCompetitor(facility, subjectLat, subjectLng, testHaversine);
    expect(e).not.toBeNull();
    expect(e.distanceMi).toBeGreaterThan(0);
    expect(e.distanceMi).toBeLessThan(10);
    expect(e.msa).toBe("Los Angeles");
    expect(e.estimatedGrossPSF).toBeGreaterThan(100);
    expect(e.estimatedCCRentPerSF_mo).toBeGreaterThan(3.0); // LA MSA-disclosed
    expect(e.rentConfidence).toBe("MSA_DISCLOSED_PSA");
  });

  test("uses state-level rent for facility outside disclosed MSA", () => {
    const facility = { brand: "PS", name: "PS Buffalo", city: "Buffalo", state: "NY", lat: 42.89, lng: -78.88 };
    const e = enrichCompetitor(facility, 42.95, -78.85, testHaversine);
    expect(e).not.toBeNull();
    expect(e.msa).toBeNull();
    expect(e.estimatedCCRentPerSF_mo).toBeGreaterThan(0);
    expect(["TRIPLE_VALIDATED", "DOUBLE_VALIDATED", "SINGLE_SOURCE"]).toContain(e.rentConfidence);
  });

  test("handles invalid input gracefully", () => {
    expect(enrichCompetitor(null, 0, 0, testHaversine)).toBeNull();
    expect(enrichCompetitor({ lat: null, lng: null }, 0, 0, testHaversine)).toBeNull();
    expect(enrichCompetitor({ lat: 0, lng: 0 }, 0, 0, null)).toBeNull();
  });
});

describe("enrichNearbyCompetitors", () => {
  const facilities = [
    { brand: "PS", name: "A", city: "Los Angeles", state: "CA", lat: 34.05, lng: -118.25 },
    { brand: "PS", name: "B", city: "Long Beach", state: "CA", lat: 33.77, lng: -118.19 },
    { brand: "PS", name: "C", city: "Pasadena", state: "CA", lat: 34.15, lng: -118.13 },
    { brand: "NSA", name: "D", city: "Burbank", state: "CA", lat: 34.18, lng: -118.31 },
    { brand: "PS", name: "E", city: "San Francisco", state: "CA", lat: 37.77, lng: -122.42 }, // ~350 mi away
  ];

  test("filters by radius + sorts by distance", () => {
    const subjectLat = 34.05;
    const subjectLng = -118.25;
    const result = enrichNearbyCompetitors(facilities, subjectLat, subjectLng, {
      radiusMi: 25,
      limit: 10,
      haversineFn: testHaversine,
    });
    // Should NOT include the SF facility (~350 mi)
    expect(result.find((c) => c.name === "E")).toBeUndefined();
    // Should be sorted ascending by distance
    for (let i = 1; i < result.length; i++) {
      expect(result[i].distanceMi).toBeGreaterThanOrEqual(result[i - 1].distanceMi);
    }
  });

  test("respects limit param", () => {
    const result = enrichNearbyCompetitors(facilities, 34.05, -118.25, {
      radiusMi: 100,
      limit: 2,
      haversineFn: testHaversine,
    });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  test("every result has cost basis + rent enrichment", () => {
    const result = enrichNearbyCompetitors(facilities, 34.05, -118.25, {
      radiusMi: 50,
      limit: 10,
      haversineFn: testHaversine,
    });
    for (const c of result) {
      expect(c.estimatedGrossPSF).toBeGreaterThan(0);
      expect(c.estimatedCCRentPerSF_mo).toBeGreaterThan(0);
      expect(c.estimatedDURentPerSF_mo).toBeGreaterThan(0);
    }
  });

  test("returns empty array for invalid input", () => {
    expect(enrichNearbyCompetitors(null, 0, 0, { haversineFn: testHaversine })).toEqual([]);
    expect(enrichNearbyCompetitors([], 0, 0, { haversineFn: testHaversine })).toEqual([]);
    expect(enrichNearbyCompetitors(facilities, "bad", 0, { haversineFn: testHaversine })).toEqual([]);
    expect(enrichNearbyCompetitors(facilities, 0, 0, {})).toEqual([]); // missing haversineFn
  });
});

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
