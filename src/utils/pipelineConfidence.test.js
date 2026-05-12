import {
  computePipelineConfidence,
  renderConfidenceChip,
  aggregatePipelineConfidence,
  PIPELINE_CONFIDENCE_DEFAULT_STALE_DAYS,
} from "./pipelineConfidence";

// Fixed reference date for deterministic freshness math.
const ASOF = new Date("2026-05-11T12:00:00Z");

describe("computePipelineConfidence — status derivation", () => {
  test("explicit verificationStatus override wins", () => {
    const c = computePipelineConfidence(
      { verificationStatus: "CLAIMED", citation: "Accession 0001628280-26-007696" },
      { asOf: ASOF, fileGeneratedAt: "2026-05-10" }
    );
    expect(c.status).toBe("CLAIMED");
  });

  test("verifiedSource permit- prefix → VERIFIED", () => {
    const c = computePipelineConfidence(
      { verifiedSource: "permit-Denton-County-2025-04-1183", verifiedDate: "2026-05-08" },
      { asOf: ASOF }
    );
    expect(c.status).toBe("VERIFIED");
  });

  test("verifiedSource EDGAR- prefix → VERIFIED", () => {
    const c = computePipelineConfidence(
      { verifiedSource: "EDGAR-10Q-0001289490-26-000011", verifiedDate: "2026-04-30" },
      { asOf: ASOF }
    );
    expect(c.status).toBe("VERIFIED");
  });

  test("verifiedSource planning- prefix → VERIFIED", () => {
    const c = computePipelineConfidence(
      { verifiedSource: "planning-Warren-County-2025-Q4", verifiedDate: "2026-05-01" },
      { asOf: ASOF }
    );
    expect(c.status).toBe("VERIFIED");
  });

  test("verifiedSource aggregator- prefix → CLAIMED", () => {
    const c = computePipelineConfidence(
      { verifiedSource: "aggregator-radiusplus-2026-02-04", verifiedDate: "2026-02-04" },
      { asOf: ASOF }
    );
    // 96 days since verifiedDate (Feb 4 → May 11) exceeds 90-day default → STALE
    expect(c.status).toBe("STALE");
    expect(c.previousStatus).toBe("CLAIMED");
  });

  test("verifiedSource screenshot- prefix → CLAIMED", () => {
    const c = computePipelineConfidence(
      { verifiedSource: "screenshot-DW-2026-05-01" },
      { asOf: ASOF, fileGeneratedAt: "2026-05-01" }
    );
    expect(c.status).toBe("CLAIMED");
  });

  test("legacy citation 'Accession 0001628280-26-007696' → VERIFIED", () => {
    const c = computePipelineConfidence(
      { citation: "Accession 0001628280-26-007696" },
      { asOf: ASOF, fileGeneratedAt: "2026-05-10" }
    );
    expect(c.status).toBe("VERIFIED");
  });

  test("legacy source mentioning 10-K → VERIFIED", () => {
    const c = computePipelineConfidence(
      { source: "PSA FY2025 10-K MD&A · Real estate facilities developed during the year" },
      { asOf: ASOF, fileGeneratedAt: "2026-05-10" }
    );
    expect(c.status).toBe("VERIFIED");
  });

  test("legacy source mentioning 10-Q → VERIFIED", () => {
    const c = computePipelineConfidence(
      { source: "EXR Q3 2025 10-Q · Properties Under Development table" },
      { asOf: ASOF, fileGeneratedAt: "2026-05-10" }
    );
    expect(c.status).toBe("VERIFIED");
  });

  test("no source info → UNVERIFIED", () => {
    const c = computePipelineConfidence({}, { asOf: ASOF });
    expect(c.status).toBe("UNVERIFIED");
  });

  test("null facility → UNVERIFIED", () => {
    const c = computePipelineConfidence(null, { asOf: ASOF });
    expect(c.status).toBe("UNVERIFIED");
  });
});

describe("computePipelineConfidence — freshness math", () => {
  test("VERIFIED entry within stale window stays VERIFIED", () => {
    const c = computePipelineConfidence(
      { verifiedSource: "EDGAR-10K-0001628280-26", verifiedDate: "2026-04-01" },
      { asOf: ASOF }
    );
    expect(c.status).toBe("VERIFIED");
    expect(c.daysSinceVerified).toBe(40);
    expect(c.previousStatus).toBeNull();
  });

  test("VERIFIED entry past stale window flips to STALE", () => {
    const c = computePipelineConfidence(
      { verifiedSource: "EDGAR-10K-0001628280-25", verifiedDate: "2025-12-01" },
      { asOf: ASOF }
    );
    // 161 days since Dec 1 2025 > 90 default
    expect(c.status).toBe("STALE");
    expect(c.previousStatus).toBe("VERIFIED");
    expect(c.daysSinceVerified).toBeGreaterThan(PIPELINE_CONFIDENCE_DEFAULT_STALE_DAYS);
  });

  test("explicit staleAfterDate forces STALE even if within default window", () => {
    const c = computePipelineConfidence(
      {
        verifiedSource: "permit-Denton-2025",
        verifiedDate: "2026-04-30",
        staleAfterDate: "2026-05-01",
      },
      { asOf: ASOF }
    );
    expect(c.status).toBe("STALE");
  });

  test("freshness falls back to fileGeneratedAt when verifiedDate missing", () => {
    const c = computePipelineConfidence(
      { citation: "Accession 0001628280-26-007696" },
      { asOf: ASOF, fileGeneratedAt: "2026-05-10" }
    );
    expect(c.daysSinceVerified).toBe(1);
    expect(c.status).toBe("VERIFIED");
  });

  test("UNVERIFIED never becomes STALE", () => {
    const c = computePipelineConfidence({}, {
      asOf: ASOF,
      fileGeneratedAt: "2020-01-01",
    });
    expect(c.status).toBe("UNVERIFIED");
    expect(c.previousStatus).toBeNull();
  });
});

describe("computePipelineConfidence — confidence weights", () => {
  test("VERIFIED weight 1.0", () => {
    const c = computePipelineConfidence(
      { verifiedSource: "EDGAR-10K-0001628280-26", verifiedDate: "2026-05-08" },
      { asOf: ASOF }
    );
    expect(c.confidence).toBe(1.0);
  });
  test("CLAIMED weight 0.5", () => {
    const c = computePipelineConfidence(
      { verifiedSource: "screenshot-DW-2026-05-01", verifiedDate: "2026-05-01" },
      { asOf: ASOF }
    );
    expect(c.status).toBe("CLAIMED");
    expect(c.confidence).toBe(0.5);
  });
  test("STALE weight 0.3", () => {
    const c = computePipelineConfidence(
      { verifiedSource: "EDGAR-10K-2024", verifiedDate: "2025-11-01" },
      { asOf: ASOF }
    );
    expect(c.status).toBe("STALE");
    expect(c.confidence).toBe(0.3);
  });
  test("UNVERIFIED weight 0.0", () => {
    const c = computePipelineConfidence({}, { asOf: ASOF });
    expect(c.confidence).toBe(0.0);
  });
});

describe("renderConfidenceChip — HTML output", () => {
  test("VERIFIED chip includes ✓ icon + green color + verifiedSource", () => {
    const html = renderConfidenceChip(
      { verifiedSource: "EDGAR-10K-0001628280-26", verifiedDate: "2026-05-08" },
      { asOf: ASOF }
    );
    expect(html).toContain("✓");
    expect(html).toContain("VERIFIED");
    expect(html).toContain("EDGAR-10K-0001628280-26");
    expect(html).toContain("#16A34A");
  });

  test("CLAIMED chip includes ⚠ icon + amber color", () => {
    const html = renderConfidenceChip(
      { verifiedSource: "screenshot-DW-2026-05-01", verifiedDate: "2026-05-01" },
      { asOf: ASOF }
    );
    expect(html).toContain("⚠");
    expect(html).toContain("CLAIMED");
    expect(html).toContain("#D97706");
  });

  test("STALE chip includes ↻ icon + orange color", () => {
    const html = renderConfidenceChip(
      { verifiedSource: "EDGAR-10K-2024", verifiedDate: "2025-11-01" },
      { asOf: ASOF }
    );
    expect(html).toContain("↻");
    expect(html).toContain("STALE");
    expect(html).toContain("#EA580C");
  });

  test("UNVERIFIED chip includes ○ icon + slate color", () => {
    const html = renderConfidenceChip({}, { asOf: ASOF });
    expect(html).toContain("○");
    expect(html).toContain("UNVERIFIED");
    expect(html).toContain("#64748B");
  });

  test("days-since-verified appears in chip when computed", () => {
    const html = renderConfidenceChip(
      { verifiedSource: "EDGAR-10K-0001628280-26", verifiedDate: "2026-05-08" },
      { asOf: ASOF }
    );
    expect(html).toMatch(/\b3d\b/);
  });

  test("chip text HTML-escapes special chars in verifiedSource (XSS hardening)", () => {
    const html = renderConfidenceChip(
      {
        verifiedSource: '<script>alert("xss")</script>',
        verifiedDate: "2026-05-08",
      },
      { asOf: ASOF }
    );
    // Special chars escaped — no raw <script> in output
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("aggregatePipelineConfidence — bulk summary + weighted CCSF", () => {
  const fixture = [
    // VERIFIED — 100K NRSF * 100% CC = 100K CC SF * 1.0 weight = 100K
    { nrsf: 100000, ccPct: 100, verifiedSource: "EDGAR-10K-0001628280-26", verifiedDate: "2026-05-08" },
    // CLAIMED — 80K * 100% = 80K * 0.5 = 40K
    { nrsf: 80000, ccPct: 100, verifiedSource: "screenshot-DW-2026-05-01", verifiedDate: "2026-05-01" },
    // STALE — 60K * 100% = 60K * 0.3 = 18K
    { nrsf: 60000, ccPct: 100, verifiedSource: "EDGAR-10K-2024", verifiedDate: "2025-10-01" },
    // UNVERIFIED — 50K * 100% = 50K * 0.0 = 0
    { nrsf: 50000, ccPct: 100 },
  ];

  test("counts match", () => {
    const agg = aggregatePipelineConfidence(fixture, { asOf: ASOF });
    expect(agg.counts.VERIFIED).toBe(1);
    expect(agg.counts.CLAIMED).toBe(1);
    expect(agg.counts.STALE).toBe(1);
    expect(agg.counts.UNVERIFIED).toBe(1);
  });

  test("rawTotalCCSF sums all CC SF regardless of confidence", () => {
    const agg = aggregatePipelineConfidence(fixture, { asOf: ASOF });
    expect(agg.rawTotalCCSF).toBe(290000);
  });

  test("weightedTotalCCSF applies confidence weights", () => {
    const agg = aggregatePipelineConfidence(fixture, { asOf: ASOF });
    // 100000*1.0 + 80000*0.5 + 60000*0.3 + 50000*0.0 = 158000
    expect(agg.weightedTotalCCSF).toBe(158000);
  });

  test("returns empty shape for non-array input", () => {
    const agg = aggregatePipelineConfidence(null);
    expect(agg.counts).toEqual({ VERIFIED: 0, CLAIMED: 0, STALE: 0, UNVERIFIED: 0 });
    expect(agg.facilities).toEqual([]);
  });
});
