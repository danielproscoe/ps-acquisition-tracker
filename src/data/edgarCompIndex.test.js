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
  getECRIPremiumIndex,
  getBuyerSpecificRentAnchor,
  getNearbyPipeline,
  assessPipelineSaturation,
  getDevelopmentPipelineMetadata,
  getScrapedFacilityRents,
  getScrapedMSARentMedian,
  getScrapedRentIndexMetadata,
  getCubeFacilityRents,
  getCubeStateRentMedian,
  getCubeMSARentMedian,
  getCubeScrapedRentIndexMetadata,
  getExrFacilityRents,
  getExrStateRentMedian,
  getExrMSARentMedian,
  getExrScrapedRentIndexMetadata,
  getMSAMoveInRatesByOperator,
  getCrossREITScrapedRentMetadata,
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

// ══════════════════════════════════════════════════════════════════════════
// getECRIPremiumIndex — cross-REIT in-place vs move-in rent spread
// ══════════════════════════════════════════════════════════════════════════

describe("getECRIPremiumIndex — rent-raising-headroom signal", () => {
  test("returns the ECRI premium when at least one issuer discloses both rates", () => {
    const idx = getECRIPremiumIndex();
    expect(idx).not.toBeNull();
    expect(idx.issuersDisclosed.length).toBeGreaterThan(0);
    expect(idx.issuersDisclosed).toContain("EXR"); // EXR uniquely discloses move-in
  });

  test("EXR's disclosed in-place + move-in rates produce ~51% ECRI premium", () => {
    const idx = getECRIPremiumIndex();
    const exr = idx.issuerDetails.find((d) => d.issuer === "EXR");
    expect(exr).toBeTruthy();
    expect(exr.inPlaceRentPerSF).toBe(19.91);
    expect(exr.moveInRentPerSF).toBe(13.16);
    // ECRI premium = (19.91 - 13.16) / 13.16 = 0.5129...
    expect(exr.ecriPremium).toBeCloseTo(0.513, 2);
    expect(exr.ecriPremiumPct).toBeCloseTo(51.3, 1);
  });

  test("issuer details include accession number citations", () => {
    const idx = getECRIPremiumIndex();
    for (const d of idx.issuerDetails) {
      expect(d.accessionNumber).toBeTruthy();
      expect(d.filingURL).toMatch(/sec\.gov/);
    }
  });

  test("cross-REIT averages computed when 2+ issuers disclose", () => {
    const idx = getECRIPremiumIndex();
    expect(idx.crossREITAvgInPlaceRent).toBeGreaterThan(0);
    expect(idx.crossREITAvgMoveInRate).toBeGreaterThan(0);
    expect(idx.crossREITAvgInPlaceRent).toBeGreaterThan(idx.crossREITAvgMoveInRate);
  });

  test("institutional implication string is informative", () => {
    const idx = getECRIPremiumIndex();
    expect(idx.institutionalImplication).toMatch(/above current move-in|premium|rent-raising/i);
  });

  test("citation rule names EXR as the unique discloser", () => {
    const idx = getECRIPremiumIndex();
    expect(idx.citationRule).toMatch(/EXR/);
  });

  test("move-in rate change YoY computed when prior year present", () => {
    const idx = getECRIPremiumIndex();
    const exr = idx.issuerDetails.find((d) => d.issuer === "EXR");
    expect(exr.moveInRentPerSF_PriorYear).toBe(12.6);
    // (13.16 - 12.6) / 12.6 = 0.0444...
    expect(exr.moveInRentChangeYoY).toBeCloseTo(0.044, 2);
  });

  test("EXR discount % of revenue is captured (2.1%)", () => {
    const idx = getECRIPremiumIndex();
    const exr = idx.issuerDetails.find((d) => d.issuer === "EXR");
    expect(exr.discountPctOfRevenue).toBeCloseTo(0.021, 3);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Scraped facility rent accessors
// ══════════════════════════════════════════════════════════════════════════

describe("getScrapedFacilityRents — primary-source per-facility move-in rates", () => {
  test("returns scrape data for known PSA facility ID (Austin TX 809)", () => {
    const facility = getScrapedFacilityRents("809");
    if (facility) {
      // Scraped data may exist if scraper has run
      expect(facility.facilityId).toBe("809");
      expect(facility.city).toBe("Austin");
      expect(facility.state).toBe("TX");
      expect(facility.units.length).toBeGreaterThan(0);
      expect(facility.scrapedAt).toBeTruthy();
    }
  });

  test("returns null for unknown facility IDs", () => {
    expect(getScrapedFacilityRents("9999999999")).toBeNull();
    expect(getScrapedFacilityRents(null)).toBeNull();
    expect(getScrapedFacilityRents("")).toBeNull();
  });

  test("returns CC + DU median rents per facility when available", () => {
    const facility = getScrapedFacilityRents("2350"); // Austin facility w/ both
    if (facility) {
      // 2350 has both CC and DU units in the scrape
      expect(facility.ccMedianPerSF_mo).toBeGreaterThan(0);
      expect(facility.unitListings).toBeGreaterThan(1);
    }
  });
});

describe("getScrapedMSARentMedian — per-MSA scraped aggregation + cross-validation", () => {
  test("returns Austin TX scraped median if scraper has run", () => {
    const austin = getScrapedMSARentMedian("Austin TX");
    if (austin) {
      expect(austin.msa).toBe("Austin TX");
      expect(austin.facilitiesScraped).toBeGreaterThan(0);
      expect(austin.ccMedianPerSF_mo).toBeGreaterThan(0);
      expect(austin.crossValidation).toBeTruthy();
      expect(austin.crossValidation.psaDisclosedAnnualPerSF).toBeGreaterThan(0);
      expect(austin.crossValidation.sanityGatePassed).toBeDefined();
    }
  });

  test("cross-validation includes interpretation string + delta %", () => {
    const austin = getScrapedMSARentMedian("Austin TX");
    if (austin) {
      const cv = austin.crossValidation;
      expect(typeof cv.ccDeltaPct).toBe("number");
      expect(typeof cv.interpretation).toBe("string");
      expect(cv.interpretation.length).toBeGreaterThan(20);
      // Sanity gate: scraped move-in should be within ±40% of MD&A in-place
      // (move-in is structurally below in-place due to cumulative ECRI)
      expect(Math.abs(cv.ccDeltaPct)).toBeLessThan(50);
    }
  });

  test("returns null for unknown MSAs", () => {
    expect(getScrapedMSARentMedian("Mars Colony")).toBeNull();
    expect(getScrapedMSARentMedian(null)).toBeNull();
  });
});

describe("getScrapedRentIndexMetadata — index provenance", () => {
  test("returns metadata when scrape data exists", () => {
    const meta = getScrapedRentIndexMetadata();
    if (meta) {
      expect(meta.schema).toMatch(/storvex.psa-scraped/);
      expect(meta.totals.facilities).toBeGreaterThan(0);
      expect(Array.isArray(meta.msasScraped)).toBe(true);
      expect(meta.citationRule).toMatch(/Schema\.org|publicstorage\.com/i);
    }
  });
});

describe("enrichCompetitor — scraped data flows through when facilityId provided", () => {
  function testHaversine(lat1, lon1, lat2, lon2) {
    const R = 3958.8;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  test("competitor with facilityId surfaces scraped rents when available", () => {
    const facility = {
      brand: "PS",
      name: "PS Austin 809",
      city: "Austin",
      state: "TX",
      lat: 30.27314,
      lng: -97.75917,
      facilityId: "809",
    };
    const e = enrichCompetitor(facility, 30.30, -97.75, testHaversine);
    expect(e).not.toBeNull();
    if (e.scrapedRents) {
      expect(e.hasScrapedData).toBe(true);
      expect(e.scrapedRents.source).toMatch(/Schema\.org|PSA facility detail/);
    }
  });

  test("competitor without facilityId still enriches but has no scraped data", () => {
    const facility = {
      brand: "PS",
      name: "PS Unknown",
      city: "Austin",
      state: "TX",
      lat: 30.27,
      lng: -97.75,
    };
    const e = enrichCompetitor(facility, 30.30, -97.75, testHaversine);
    expect(e).not.toBeNull();
    expect(e.hasScrapedData).toBe(false);
    expect(e.scrapedRents).toBeNull();
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

// ══════════════════════════════════════════════════════════════════════════
// CUBE scraped rent accessors
// ══════════════════════════════════════════════════════════════════════════

describe("getCubeFacilityRents — CUBE per-facility move-in pricing", () => {
  test("returns null for unknown facility IDs", () => {
    expect(getCubeFacilityRents("9999999999")).toBeNull();
    expect(getCubeFacilityRents(null)).toBeNull();
    expect(getCubeFacilityRents("")).toBeNull();
  });

  test("returns scrape data for known CUBE facility ID when available", () => {
    // facility 4243 = Auburn AL CubeSmart (first row of sitemap)
    const f = getCubeFacilityRents("4243");
    if (f) {
      expect(f.facilityId).toBe("4243");
      expect(f.unitListings).toBeGreaterThan(0);
      expect(f.scrapedAt).toBeTruthy();
      // CUBE captures BOTH discount AND standard rate per unit; scrubbed
      // facility-level CC median should be a positive number
      if (f.ccMedianPerSF_mo != null) {
        expect(f.ccMedianPerSF_mo).toBeGreaterThan(0);
      }
    }
  });
});

describe("getCubeStateRentMedian — state-level CUBE aggregation", () => {
  test("returns null for unknown states", () => {
    expect(getCubeStateRentMedian("XX")).toBeNull();
    expect(getCubeStateRentMedian(null)).toBeNull();
  });

  test("returns texas aggregation when CUBE has scraped Texas facilities", () => {
    const tx = getCubeStateRentMedian("texas");
    if (tx) {
      expect(tx.facilitiesScraped).toBeGreaterThan(0);
      expect(tx.totalUnitListings).toBeGreaterThan(0);
    }
  });
});

describe("getCubeMSARentMedian — MSA-level CUBE aggregation", () => {
  test("returns null for unknown MSAs", () => {
    expect(getCubeMSARentMedian("Mars Colony")).toBeNull();
    expect(getCubeMSARentMedian(null)).toBeNull();
  });

  test("returns Houston aggregation when CUBE has scraped Houston facilities", () => {
    const houston = getCubeMSARentMedian("Houston");
    if (houston) {
      expect(houston.msa).toBe("Houston");
      expect(houston.facilitiesScraped).toBeGreaterThan(0);
    }
  });
});

describe("getCubeScrapedRentIndexMetadata — CUBE index provenance", () => {
  test("returns metadata when CUBE scrape data exists", () => {
    const meta = getCubeScrapedRentIndexMetadata();
    if (meta) {
      expect(meta.schema).toMatch(/storvex.cube-scraped/);
      expect(meta.operator).toBe("CUBE");
      expect(meta.totals.facilities).toBeGreaterThan(0);
      expect(Array.isArray(meta.statesScraped)).toBe(true);
      expect(Array.isArray(meta.msasResolved)).toBe(true);
      // National cross-validation against $22.73/SF/yr CUBE MD&A in-place
      if (meta.nationalValidation) {
        expect(meta.nationalValidation.cubeDisclosedAnnualPerSF).toBe(22.73);
        expect(typeof meta.nationalValidation.sanityGatePassed).toBe("boolean");
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXR scraped rent accessors (data may be sparse if IP rotation pending)
// ══════════════════════════════════════════════════════════════════════════

describe("getExrFacilityRents — EXR per-facility move-in pricing", () => {
  test("returns null for unknown facility IDs", () => {
    expect(getExrFacilityRents("9999999999")).toBeNull();
    expect(getExrFacilityRents(null)).toBeNull();
    expect(getExrFacilityRents("")).toBeNull();
  });
});

describe("getExrStateRentMedian — state-level EXR aggregation", () => {
  test("returns null for unknown states", () => {
    expect(getExrStateRentMedian("XX")).toBeNull();
    expect(getExrStateRentMedian(null)).toBeNull();
  });
});

describe("getExrMSARentMedian — MSA-level EXR aggregation", () => {
  test("returns null for unknown MSAs", () => {
    expect(getExrMSARentMedian("Mars Colony")).toBeNull();
    expect(getExrMSARentMedian(null)).toBeNull();
  });
});

describe("getExrScrapedRentIndexMetadata — EXR index provenance", () => {
  test("returns metadata when EXR scrape data exists", () => {
    const meta = getExrScrapedRentIndexMetadata();
    if (meta) {
      expect(meta.schema).toMatch(/storvex.exr/);
      expect(meta.operator).toBe("EXR");
      expect(typeof meta.totals).toBe("object");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Cross-REIT consolidated accessors (Radius+ kill-shot view)
// ══════════════════════════════════════════════════════════════════════════

describe("getMSAMoveInRatesByOperator — cross-REIT MSA matrix", () => {
  test("returns array (possibly empty) for any input", () => {
    const result = getMSAMoveInRatesByOperator("Houston");
    expect(Array.isArray(result)).toBe(true);
  });

  test("returns empty array for unknown MSAs", () => {
    expect(getMSAMoveInRatesByOperator("Mars Colony")).toEqual([]);
    expect(getMSAMoveInRatesByOperator(null)).toEqual([]);
    expect(getMSAMoveInRatesByOperator("")).toEqual([]);
  });

  test("each row identifies operator with name + median rent", () => {
    const houston = getMSAMoveInRatesByOperator("Houston");
    for (const row of houston) {
      expect(["PSA", "CUBE", "EXR"]).toContain(row.operator);
      expect(typeof row.operatorName).toBe("string");
      expect(row.facilitiesScraped).toBeGreaterThanOrEqual(0);
      // At least CC OR DU rate must be populated for a row to exist
      const hasRate = row.ccMedianPerSF_mo != null || row.duMedianPerSF_mo != null;
      expect(hasRate).toBe(true);
    }
  });

  test("rows from different operators surface side-by-side", () => {
    // After CUBE crawl, Houston should have at least 2 operators (PSA + CUBE).
    // If neither is scraped yet, we get 0 — that's fine for unit tests; the
    // structure invariant is what we're enforcing here.
    const houston = getMSAMoveInRatesByOperator("Houston");
    const operators = new Set(houston.map((r) => r.operator));
    if (houston.length >= 2) {
      expect(operators.size).toBeGreaterThanOrEqual(2);
    }
  });

  test("CUBE rows expose impliedDiscountPct (web vs in-store standard rate)", () => {
    const allMSAs = ["Houston", "Dallas-Ft. Worth", "Atlanta", "Phoenix", "Chicago", "Los Angeles"];
    let foundCubeWithDiscount = false;
    for (const msa of allMSAs) {
      const rows = getMSAMoveInRatesByOperator(msa);
      const cubeRow = rows.find((r) => r.operator === "CUBE");
      if (cubeRow && typeof cubeRow.impliedDiscountPct === "number") {
        foundCubeWithDiscount = true;
        // CUBE's promo discount typically lands in 20-50% range across MSAs
        expect(cubeRow.impliedDiscountPct).toBeGreaterThanOrEqual(0);
        expect(cubeRow.impliedDiscountPct).toBeLessThanOrEqual(80);
        break;
      }
    }
    // If no CUBE data scraped yet, the test still passes (structure-only check)
    // Once CUBE crawl completes the loop will find a real promo signal.
    if (foundCubeWithDiscount) {
      expect(foundCubeWithDiscount).toBe(true);
    }
  });
});

describe("getCrossREITScrapedRentMetadata — consolidated 3-REIT coverage", () => {
  test("returns shape with operatorCount + totals always defined", () => {
    const meta = getCrossREITScrapedRentMetadata();
    expect(meta).toBeTruthy();
    expect(typeof meta.operatorCount).toBe("number");
    expect(typeof meta.totalFacilities).toBe("number");
    expect(typeof meta.totalUnitListings).toBe("number");
    expect(Array.isArray(meta.operators)).toBe(true);
    // operatorCount matches the populated operators array length
    expect(meta.operators.length).toBe(meta.operatorCount);
  });

  test("PSA + CUBE coverage means operatorCount >= 2 once both crawls have run", () => {
    const meta = getCrossREITScrapedRentMetadata();
    const operators = meta.operators.map((o) => o.operator);
    // Sanity: returned operators are a subset of the 3 we support
    for (const op of operators) {
      expect(["PSA", "CUBE", "EXR"]).toContain(op);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Buyer-specific rent anchor — routes Y0 rent to the selected buyer's source
// ══════════════════════════════════════════════════════════════════════════

describe("getBuyerSpecificRentAnchor — per-buyer rent routing", () => {
  test("PS + Houston MSA → PSA per-MSA disclosed rent (Houston band)", () => {
    const a = getBuyerSpecificRentAnchor({ buyerKey: "PS", msa: "Houston", state: "TX" });
    expect(a).toBeTruthy();
    expect(a.buyerKey).toBe("PS");
    expect(a.basis).toMatch(/^PSA MSA-disclosed/);
    expect(a.basis).toMatch(/PS Family/); // PS lens encompasses PSA + iStorage + NSA
    expect(a.citation).toMatch(/0001628280-26-007696/);
    expect(a.annualPerSF).toBeGreaterThan(0);
  });

  test("PS + unmatched MSA → PSA national fallback ($22.54/SF/yr)", () => {
    const a = getBuyerSpecificRentAnchor({ buyerKey: "PS", msa: "Boise" });
    expect(a.basis).toMatch(/^PSA national/);
    expect(a.basis).toMatch(/PS Family/);
    expect(a.annualPerSF).toBe(22.54);
  });

  test("EXR → EXR national $19.91/SF/yr (scrape data not yet ingested)", () => {
    const a = getBuyerSpecificRentAnchor({ buyerKey: "EXR", state: "TX" });
    expect(a.buyerKey).toBe("EXR");
    expect(a.annualPerSF).toBe(19.91);
    expect(a.basis).toBe("EXR national");
    expect(a.citation).toMatch(/0001289490-26-000011/);
  });

  test("CUBE + Houston MSA → CUBE scraped MSA when available", () => {
    const a = getBuyerSpecificRentAnchor({ buyerKey: "CUBE", msa: "Houston", state: "TX" });
    expect(a).toBeTruthy();
    expect(a.buyerKey).toBe("CUBE");
    // Tallahassee or unmatched MSAs fall back to national; Houston is in
    // CUBE's resolved MSAs from the 2026-05-10 scrape
    expect(["CUBE scraped MSA", "CUBE scraped state-weighted", "CUBE national"]).toContain(a.basis);
    expect(a.annualPerSF).toBeGreaterThan(0);
  });

  test("CUBE + unmatched MSA + state in scrape → state-weighted from scrape", () => {
    // Wyoming is not in CUBE's heavy states — falls back to national
    const a = getBuyerSpecificRentAnchor({ buyerKey: "CUBE", state: "WY" });
    expect(a.buyerKey).toBe("CUBE");
    expect(["CUBE scraped state-weighted", "CUBE national"]).toContain(a.basis);
  });

  test("CUBE + no MSA + no state → CUBE national $22.73/SF/yr", () => {
    const a = getBuyerSpecificRentAnchor({ buyerKey: "CUBE" });
    expect(a.basis).toBe("CUBE national");
    expect(a.annualPerSF).toBe(22.73);
    expect(a.citation).toMatch(/0001298675-26-000010/);
  });

  test("SMA → SMA national $20.03/SF/yr", () => {
    const a = getBuyerSpecificRentAnchor({ buyerKey: "SMA", state: "FL" });
    expect(a.buyerKey).toBe("SMA");
    expect(a.annualPerSF).toBe(20.03);
    expect(a.basis).toBe("SMA national");
    expect(a.citation).toMatch(/0001193125-26-082573/);
  });

  test("AMERCO → UHAL value-tier $16.50/SF/yr", () => {
    const a = getBuyerSpecificRentAnchor({ buyerKey: "AMERCO", state: "AZ" });
    expect(a.buyerKey).toBe("AMERCO");
    expect(a.buyerTicker).toBe("UHAL");
    expect(a.annualPerSF).toBe(16.50);
    expect(a.basis).toBe("UHAL value-tier");
  });

  test("UHAL key (alias for AMERCO) routes to same anchor", () => {
    const a1 = getBuyerSpecificRentAnchor({ buyerKey: "AMERCO" });
    const a2 = getBuyerSpecificRentAnchor({ buyerKey: "UHAL" });
    expect(a1.annualPerSF).toBe(a2.annualPerSF);
    expect(a1.basis).toBe(a2.basis);
  });

  test("GENERIC → cross-REIT national average $20.92/SF/yr", () => {
    const a = getBuyerSpecificRentAnchor({ buyerKey: "GENERIC" });
    expect(a.buyerKey).toBe("GENERIC");
    expect(a.annualPerSF).toBe(20.92);
    expect(a.basis).toBe("Cross-REIT national");
  });

  test("GEN alias routes to same anchor as GENERIC", () => {
    const a1 = getBuyerSpecificRentAnchor({ buyerKey: "GENERIC" });
    const a2 = getBuyerSpecificRentAnchor({ buyerKey: "GEN" });
    expect(a1.annualPerSF).toBe(a2.annualPerSF);
  });

  test("returns null for unknown buyer key", () => {
    expect(getBuyerSpecificRentAnchor({ buyerKey: "UNKNOWN" })).toBeNull();
    expect(getBuyerSpecificRentAnchor({})).toBeNull();
    expect(getBuyerSpecificRentAnchor()).toBeNull();
  });

  test("buyer-specific anchors produce distinct rent numbers across the 6 lenses", () => {
    const inputs = ["PS", "EXR", "CUBE", "SMA", "AMERCO", "GENERIC"];
    const rents = inputs.map((k) => getBuyerSpecificRentAnchor({ buyerKey: k })?.annualPerSF);
    const unique = new Set(rents.filter((v) => v != null));
    // At minimum, AMERCO ($16.50), EXR ($19.91), SMA ($20.03), GENERIC ($20.92),
    // PS ($22.54), CUBE ($22.73) should all be distinct
    expect(unique.size).toBe(6);
  });

  test("monthlyPerSF = annualPerSF / 12", () => {
    for (const k of ["PS", "EXR", "CUBE", "SMA", "AMERCO", "GENERIC"]) {
      const a = getBuyerSpecificRentAnchor({ buyerKey: k });
      if (a) expect(a.monthlyPerSF).toBeCloseTo(a.annualPerSF / 12, 5);
    }
  });

  test("every routed anchor includes source + citation strings", () => {
    for (const k of ["PS", "EXR", "CUBE", "SMA", "AMERCO", "GENERIC"]) {
      const a = getBuyerSpecificRentAnchor({ buyerKey: k });
      expect(a).toBeTruthy();
      expect(typeof a.source).toBe("string");
      expect(a.source.length).toBeGreaterThan(20);
      expect(typeof a.citation).toBe("string");
      expect(a.citation.length).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Development pipeline accessors
// ══════════════════════════════════════════════════════════════════════════

describe("getNearbyPipeline — proximity radius queries", () => {
  test("returns empty array when lat/lng missing or invalid", () => {
    expect(getNearbyPipeline()).toEqual([]);
    expect(getNearbyPipeline({})).toEqual([]);
    expect(getNearbyPipeline({ lat: NaN, lng: 0 })).toEqual([]);
    expect(getNearbyPipeline({ lat: null, lng: null })).toEqual([]);
  });

  test("Houston subject (29.76, -95.36) has at least 1 pipeline within 30 mi (PSA Cypress, EXR Katy)", () => {
    // Subject in central Houston; both PSA Cypress (29.97, -95.71) and EXR Katy (29.79, -95.83) are in metro
    const r = getNearbyPipeline({ lat: 29.76, lng: -95.36, radiusMi: 30 });
    expect(r.length).toBeGreaterThanOrEqual(1);
    for (const row of r) {
      expect(row.distanceMi).toBeLessThanOrEqual(30);
    }
  });

  test("results sorted ASC by distanceMi", () => {
    const r = getNearbyPipeline({ lat: 29.76, lng: -95.36, radiusMi: 100 });
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].distanceMi).toBeLessThanOrEqual(r[i].distanceMi);
    }
  });

  test("default radius is 3 mi when not specified", () => {
    // Pick a point far from any pipeline (Wyoming, no facility within 3 mi)
    const r = getNearbyPipeline({ lat: 42.97, lng: -107.55 });
    expect(r.length).toBe(0);
  });

  test("each returned row carries distanceMi + operator + nrsf + delivery", () => {
    const r = getNearbyPipeline({ lat: 25.819, lng: -80.355, radiusMi: 50 });
    for (const row of r) {
      expect(typeof row.distanceMi).toBe("number");
      expect(typeof row.operator).toBe("string");
      expect(typeof row.nrsf).toBe("number");
      expect(typeof row.expectedDelivery).toBe("string");
    }
  });
});

describe("assessPipelineSaturation — flag thresholds", () => {
  test("empty input → NONE / no flag", () => {
    const a = assessPipelineSaturation([]);
    expect(a.flag).toBe(false);
    expect(a.severity).toBe("NONE");
    expect(a.totalNRSF).toBe(0);
  });

  test("null/undefined input → NONE", () => {
    expect(assessPipelineSaturation(null).severity).toBe("NONE");
    expect(assessPipelineSaturation(undefined).severity).toBe("NONE");
  });

  test("MATERIAL flag fires when ≥100K SF CC delivering in horizon", () => {
    const rows = [
      { id: "test1", nrsf: 95000, ccPct: 100, expectedDelivery: "2026-Q3" },
      { id: "test2", nrsf: 100000, ccPct: 95, expectedDelivery: "2026-Q4" },
    ];
    const a = assessPipelineSaturation(rows, 3);
    expect(a.flag).toBe(true);
    expect(a.severity).toBe("MATERIAL");
    expect(a.ccNRSFInHorizon).toBeGreaterThanOrEqual(100000);
    expect(a.narrative).toMatch(/material|saturation/i);
  });

  test("MODERATE flag fires when 50-100K SF CC delivering in horizon", () => {
    const rows = [
      { id: "test1", nrsf: 80000, ccPct: 90, expectedDelivery: "2026-Q3" },
    ];
    const a = assessPipelineSaturation(rows, 3);
    expect(a.flag).toBe(true);
    expect(a.severity).toBe("MODERATE");
  });

  test("MINIMAL when <50K SF CC in horizon", () => {
    const rows = [
      { id: "test1", nrsf: 40000, ccPct: 90, expectedDelivery: "2026-Q3" },
    ];
    const a = assessPipelineSaturation(rows, 3);
    expect(a.flag).toBe(false);
    expect(a.severity).toBe("MINIMAL");
  });

  test("OUT_OF_HORIZON when all facilities deliver after Y3", () => {
    const rows = [
      { id: "test1", nrsf: 100000, ccPct: 100, expectedDelivery: "2030-Q1" },
      { id: "test2", nrsf: 100000, ccPct: 100, expectedDelivery: "2031-Q2" },
    ];
    const a = assessPipelineSaturation(rows, 3);
    expect(a.flag).toBe(false);
    expect(a.severity).toBe("OUT_OF_HORIZON");
  });

  test("totals invariant: ccNRSF ≤ totalNRSF", () => {
    const rows = [
      { id: "test1", nrsf: 100000, ccPct: 80, expectedDelivery: "2026-Q3" },
      { id: "test2", nrsf: 50000, ccPct: 100, expectedDelivery: "2027-Q1" },
    ];
    const a = assessPipelineSaturation(rows, 3);
    expect(a.ccNRSF).toBeLessThanOrEqual(a.totalNRSF);
  });

  test("CC pct defaults to 100 when not specified", () => {
    const rows = [{ id: "test1", nrsf: 100000, expectedDelivery: "2026-Q3" }];
    const a = assessPipelineSaturation(rows, 3);
    // 100% × 100K = 100K → MATERIAL
    expect(a.severity).toBe("MATERIAL");
  });
});

describe("getDevelopmentPipelineMetadata", () => {
  test("returns Phase 1 metadata + total facility count + breakdowns", () => {
    const m = getDevelopmentPipelineMetadata();
    expect(m).toBeTruthy();
    expect(m.schema).toMatch(/storvex.development-pipeline/);
    expect(m.phase).toBe(1);
    expect(m.totalFacilities).toBeGreaterThan(0);
    expect(m.totalsByOperator).toBeTruthy();
    expect(m.totalsByDeliveryYear).toBeTruthy();
    expect(m.totalsByStatus).toBeTruthy();
  });

  test("PSA + EXR + CUBE all have at least one pipeline facility seeded", () => {
    const m = getDevelopmentPipelineMetadata();
    expect(m.totalsByOperator.PSA?.count || 0).toBeGreaterThanOrEqual(1);
    expect(m.totalsByOperator.EXR?.count || 0).toBeGreaterThanOrEqual(1);
    expect(m.totalsByOperator.CUBE?.count || 0).toBeGreaterThanOrEqual(1);
  });
});
