import {
  siteToMatchInput,
  groupSitesByRecipient,
  renderRecipientDigest,
  generateAllDigests,
  summarizeDigests,
} from "./buyerDigest";

// Fixture builder — Firebase/dashboard site record shape.
function buildSite(id, overrides = {}) {
  return {
    id,
    name: `Site ${id}`,
    address: `${id} Test Rd`,
    state: "TX",
    market: "Houston",
    acreage: 4.0,
    askingPrice: 1500000,
    pop3mi: 35000,
    income3mi: 75000,
    growthRate: "1.8%",
    zoningClassification: "by-right",
    summary: "4.0 ac C-3 by-right · 350' frontage on US-79 · signalized intersection · 28K VPD",
    siteiqData: {
      nearestPS: 8,
      ccSPC: 3.5,
      marketTier: 2,
    },
    coordinates: "29.7604,-95.3698",
    listingUrl: "https://www.crexi.com/properties/test",
    ...overrides,
  };
}

describe("siteToMatchInput", () => {
  test("maps Firebase site fields to match-engine input shape", () => {
    const site = buildSite("s1");
    const input = siteToMatchInput(site);

    expect(input.acreage).toBe(4.0);
    expect(input.pop3mi).toBe(35000);
    expect(input.hhi3mi).toBe(75000);
    expect(input.state).toBe("TX");
    expect(input.nearestPSFamilyMi).toBe(8);
    expect(input.ccSPC).toBe(3.5);
    expect(input.marketTier).toBe(2);
    expect(input.growth3mi).toBe(1.8);
    expect(input.zoningPath).toBe("by-right");
  });

  test("survives null + undefined input without throwing", () => {
    expect(() => siteToMatchInput(null)).not.toThrow();
    expect(() => siteToMatchInput(undefined)).not.toThrow();
    expect(siteToMatchInput(null)).toEqual({});
  });

  test("strips % sign from growthRate string", () => {
    expect(siteToMatchInput(buildSite("g", { growthRate: "2.3%" })).growth3mi).toBe(2.3);
    expect(siteToMatchInput(buildSite("g", { growthRate: "-0.5%" })).growth3mi).toBe(-0.5);
  });

  test("falls back to siteiqData fields when top-level missing", () => {
    const site = buildSite("s", {
      pop3mi: undefined,
      siteiqData: { nearestPS: 5, ccSPC: 2.8, marketTier: 1, pop3mi: 42000 },
    });
    const input = siteToMatchInput(site);
    expect(input.pop3mi).toBe(42000);
    expect(input.ccSPC).toBe(2.8);
  });
});

describe("groupSitesByRecipient — funnel routing", () => {
  test("PS-spec-fit site routes to Reza/DW/MT recipient", () => {
    const sites = [buildSite("ps-1")];
    const grouped = groupSitesByRecipient(sites);
    const recipients = Object.keys(grouped);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatch(/Reza/);
  });

  test("AMERCO-fit site (interstate, 5.5 ac) routes to Aaron/Jennifer", () => {
    const sites = [
      buildSite("amerco-1", {
        acreage: 5.5,
        summary: "5.5 ac I-35 interstate frontage · 50K VPD · hard corner",
        siteiqData: { nearestPS: 28, ccSPC: 6.5, marketTier: 3 },
      }),
    ];
    const grouped = groupSitesByRecipient(sites);
    const aaronRecipient = Object.keys(grouped).find((r) => /Aaron|Jennifer/.test(r));
    expect(aaronRecipient).toBeTruthy();
    expect(grouped[aaronRecipient]).toHaveLength(1);
  });

  test("sites below minScore floor are excluded from digest", () => {
    const weakSites = [
      // Score below the SMA floor: tiny pop, low income, rezone-required.
      buildSite("weak-1", {
        pop3mi: 6000,
        hhi3mi: 46000,
        zoningClassification: "rezone-required",
        siteiqData: { nearestPS: 30, ccSPC: 8.5, marketTier: 5 },
      }),
    ];
    const grouped = groupSitesByRecipient(weakSites, { minScore: 7.5 });
    expect(Object.keys(grouped)).toHaveLength(0);
  });

  test("hard-fail sites (CA-excluded) produce zero recipients", () => {
    const grouped = groupSitesByRecipient([buildSite("ca-1", { state: "CA" })]);
    expect(Object.keys(grouped)).toHaveLength(0);
  });

  test("caps each recipient bucket at maxPerRecipient", () => {
    const sites = Array.from({ length: 20 }, (_, i) =>
      buildSite(`bulk-${i}`, { acreage: 3.5 + (i % 3) * 0.5 })
    );
    const grouped = groupSitesByRecipient(sites, { maxPerRecipient: 5 });
    for (const recipient of Object.keys(grouped)) {
      expect(grouped[recipient].length).toBeLessThanOrEqual(5);
    }
  });

  test("each site in a bucket carries _topFit and _deepLink metadata", () => {
    const sites = [buildSite("meta-1")];
    const grouped = groupSitesByRecipient(sites);
    const all = Object.values(grouped).flat();
    expect(all[0]._topFit).toBeDefined();
    expect(all[0]._topFit.score).toBeGreaterThan(0);
    expect(all[0]._deepLink).toMatch(/storvex\.vercel\.app/);
    expect(all[0]._deepLink).toMatch(/site=meta-1/);
  });

  test("within each recipient bucket, sites are sorted by fit score descending", () => {
    const sites = [
      buildSite("a", { pop3mi: 20000 }),
      buildSite("b", { pop3mi: 45000 }),
      buildSite("c", { pop3mi: 32000 }),
    ];
    const grouped = groupSitesByRecipient(sites);
    // Iterate each bucket separately — across-bucket ordering isn't a contract.
    for (const recipientSites of Object.values(grouped)) {
      for (let i = 0; i < recipientSites.length - 1; i++) {
        expect(recipientSites[i]._topFit.score).toBeGreaterThanOrEqual(
          recipientSites[i + 1]._topFit.score
        );
      }
    }
  });
});

describe("renderRecipientDigest", () => {
  test("returns empty string when no sites supplied", () => {
    expect(renderRecipientDigest("Anyone", [])).toBe("");
    expect(renderRecipientDigest("Anyone", null)).toBe("");
  });

  test("renders header chip with site count and avg score", () => {
    const grouped = groupSitesByRecipient([buildSite("s1"), buildSite("s2")]);
    const recipient = Object.keys(grouped)[0];
    const html = renderRecipientDigest(recipient, grouped[recipient]);

    expect(html).toContain("STORVEX · WEEKLY DIGEST");
    expect(html).toMatch(/pre-vetted .* fits this week/);
    expect(html).toContain(recipient);
  });

  test("renders one site card per supplied site", () => {
    const grouped = groupSitesByRecipient([
      buildSite("s1"),
      buildSite("s2"),
      buildSite("s3"),
    ]);
    const recipient = Object.keys(grouped)[0];
    const html = renderRecipientDigest(recipient, grouped[recipient]);

    expect(html).toMatch(/SITE 1/);
    expect(html).toMatch(/SITE 2/);
    expect(html).toMatch(/SITE 3/);
  });

  test("each site card includes Storvex deep link CTA", () => {
    const grouped = groupSitesByRecipient([buildSite("cta-1")]);
    const recipient = Object.keys(grouped)[0];
    const html = renderRecipientDigest(recipient, grouped[recipient]);

    expect(html).toMatch(/View on Storvex/);
    expect(html).toMatch(/storvex\.vercel\.app\/\?site=cta-1/);
  });

  test("listing URL renders as Listing CTA when present", () => {
    const grouped = groupSitesByRecipient([buildSite("listing-1")]);
    const recipient = Object.keys(grouped)[0];
    const html = renderRecipientDigest(recipient, grouped[recipient]);

    expect(html).toContain("Listing");
    expect(html).toContain("crexi.com/properties/test");
  });

  test("coordinate-bearing site renders Location CTA with maps deep link", () => {
    const grouped = groupSitesByRecipient([buildSite("coord-1")]);
    const recipient = Object.keys(grouped)[0];
    const html = renderRecipientDigest(recipient, grouped[recipient]);

    expect(html).toMatch(/google\.com\/maps\?q=29\.7604,-95\.3698/);
  });

  test("includes Storvex sign-off block", () => {
    const grouped = groupSitesByRecipient([buildSite("sig-1")]);
    const recipient = Object.keys(grouped)[0];
    const html = renderRecipientDigest(recipient, grouped[recipient]);

    expect(html).toContain("Daniel P. Roscoe");
    expect(html).toContain("Droscoe@DJRrealestate.com");
    expect(html).toContain("312-805-5996");
  });

  test("HTML is XSS-safe — angle brackets in site name are escaped", () => {
    const site = buildSite("xss-1", { name: "<script>alert(1)</script>" });
    const grouped = groupSitesByRecipient([site]);
    const recipient = Object.keys(grouped)[0];
    const html = renderRecipientDigest(recipient, grouped[recipient]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("generateAllDigests", () => {
  test("produces one entry per recipient with siteCount, html, sites array", () => {
    const sites = [
      buildSite("ps-strong-1"),
      buildSite("ps-strong-2"),
      buildSite("amerco-1", {
        acreage: 5.5,
        summary: "5.5 ac I-35 interstate frontage 50K VPD",
        siteiqData: { nearestPS: 28, ccSPC: 6.5, marketTier: 3 },
      }),
    ];
    const digests = generateAllDigests(sites);

    expect(Object.keys(digests).length).toBeGreaterThan(0);
    for (const entry of Object.values(digests)) {
      expect(entry.recipient).toBeTruthy();
      expect(entry.siteCount).toBeGreaterThan(0);
      expect(entry.html).toContain("STORVEX · WEEKLY DIGEST");
      expect(entry.sites).toHaveLength(entry.siteCount);
      expect(entry.topScore).toBeGreaterThan(0);
    }
  });

  test("returns empty object when no sites are viable", () => {
    expect(generateAllDigests([])).toEqual({});
    expect(generateAllDigests([buildSite("ca", { state: "CA" })])).toEqual({});
  });
});

describe("summarizeDigests", () => {
  test("returns flat summary rows sorted by strongCount then topScore", () => {
    const sites = [
      buildSite("s1"),
      buildSite("s2"),
      buildSite("s3", { pop3mi: 20000 }),
    ];
    const rows = summarizeDigests(sites);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.recipient).toBeTruthy();
      expect(r.siteCount).toBeGreaterThan(0);
      expect(r.topScore).toBeGreaterThanOrEqual(0);
      expect(r.avgScore).toBeGreaterThanOrEqual(0);
    }
  });

  test("returns empty array when no sites are viable", () => {
    expect(summarizeDigests([])).toEqual([]);
  });
});
