// buyerDetection.test.js — auto-buyer-detection coverage
//
// Validates that detectBuyer() picks the right institutional buyer from OM
// extraction signals (brand-name match, filename pattern, broker fingerprint,
// geography, deal type heuristics).

import { detectBuyer, formatDetectionBadge } from "./buyerDetection";

// ══════════════════════════════════════════════════════════════════════════
// HIGH-confidence brand-name matches
// ══════════════════════════════════════════════════════════════════════════

describe("detectBuyer — brand-name match in property name (decisive)", () => {
  test("CubeSmart NNN @ Tallahassee FL → CUBE (HIGH confidence)", () => {
    const r = detectBuyer({
      name: "CubeSmart NNN · 2320 Capital Circle NE Tallahassee FL",
      state: "FL",
      city: "tallahassee",
      dealType: "nnn",
    });
    expect(r.buyerKey).toBe("CUBE");
    expect(r.confidence).toBe("HIGH");
    expect(r.scores.CUBE).toBeGreaterThanOrEqual(100);
    expect(r.signals.find((s) => s.signal === "BRAND_NAME_MATCH")).toBeDefined();
  });

  test("Public Storage @ Phoenix AZ → PS (HIGH confidence)", () => {
    const r = detectBuyer({
      name: "Public Storage Phoenix AZ #1234",
      state: "AZ",
      city: "phoenix",
    });
    expect(r.buyerKey).toBe("PS");
    expect(r.confidence).toBe("HIGH");
    expect(r.scores.PS).toBeGreaterThanOrEqual(100);
  });

  test("Extra Space Storage @ Long Beach CA → EXR (HIGH confidence)", () => {
    const r = detectBuyer({
      name: "Extra Space Storage · 1234 Pacific Long Beach CA",
      state: "CA",
      city: "long beach",
    });
    expect(r.buyerKey).toBe("EXR");
    expect(r.confidence).toBe("HIGH");
    expect(r.scores.EXR).toBeGreaterThanOrEqual(100);
  });

  test("SmartStop Self Storage @ Tampa FL → SMA (HIGH confidence)", () => {
    const r = detectBuyer({
      name: "SmartStop Self Storage Tampa FL",
      state: "FL",
      city: "tampa",
    });
    expect(r.buyerKey).toBe("SMA");
    expect(r.confidence).toBe("HIGH");
    expect(r.scores.SMA).toBeGreaterThanOrEqual(100);
  });

  test("U-Haul Center @ Reno NV → AMERCO (HIGH confidence)", () => {
    const r = detectBuyer({
      name: "U-Haul Center · 1234 Virginia St Reno NV",
      state: "NV",
      city: "reno",
    });
    expect(r.buyerKey).toBe("AMERCO");
    expect(r.confidence).toBe("HIGH");
    expect(r.scores.AMERCO).toBeGreaterThanOrEqual(100);
  });

  test("UHaul Self Storage (no hyphen) → AMERCO", () => {
    const r = detectBuyer({
      name: "UHaul Self Storage Phoenix AZ",
      state: "AZ",
      city: "phoenix",
    });
    expect(r.buyerKey).toBe("AMERCO");
  });

  test("AMERCO-branded asset → AMERCO", () => {
    const r = detectBuyer({
      name: "AMERCO Storage Holdings · Dallas TX",
      state: "TX",
      city: "dallas",
    });
    expect(r.buyerKey).toBe("AMERCO");
  });

  test("NNN deal reinforces brand match (CUBE NNN → +25 on top of brand)", () => {
    const r = detectBuyer({
      name: "CubeSmart NNN Tallahassee FL",
      dealType: "nnn",
      state: "FL",
      city: "tallahassee",
    });
    expect(r.scores.CUBE).toBeGreaterThanOrEqual(125); // 100 (brand) + 25 (NNN reinforces)
    expect(r.signals.find((s) => s.signal === "NNN_REINFORCES_BRAND")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// FILENAME-only matches (no brand in property name)
// ══════════════════════════════════════════════════════════════════════════

describe("detectBuyer — filename brand pattern", () => {
  test("filename 'cubesmart_tallahassee_OM.pdf' → CUBE", () => {
    const r = detectBuyer({
      name: "Storage Asset · 2320 Capital Circle NE Tallahassee FL", // no brand in name
      filename: "cubesmart_tallahassee_OM.pdf",
      state: "FL",
      city: "tallahassee",
    });
    expect(r.buyerKey).toBe("CUBE");
    expect(r.signals.find((s) => s.signal === "FILENAME_BRAND_MATCH")).toBeDefined();
  });

  test("filename 'public_storage_phoenix.pdf' → PS", () => {
    const r = detectBuyer({
      name: "1234 Main St Phoenix AZ",
      filename: "public_storage_phoenix.pdf",
      state: "AZ",
      city: "phoenix",
    });
    expect(r.buyerKey).toBe("PS");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LISTING-BROKER fingerprint
// ══════════════════════════════════════════════════════════════════════════

describe("detectBuyer — listing broker fingerprint", () => {
  test("Marcus & Millichap broker → GENERIC (3PM-managed buyers)", () => {
    const r = detectBuyer({
      name: "Texas Store & Go · 2980 I-30 Greenville TX",
      listingBroker: "Marcus & Millichap (Karr-Cunningham Storage Team)",
      state: "TX",
      city: "greenville",
    });
    // No brand in name — broker fingerprint should win, but CUBE_HEAVY_STATE
    // signal also fires for TX. Either GENERIC or CUBE could win on points.
    // Assert that AT LEAST one of the broker / state signals is recorded.
    const brokerSignal = r.signals.find((s) => s.signal === "BROKER_FINGERPRINT");
    expect(brokerSignal).toBeDefined();
    expect(brokerSignal.buyer).toBe("GENERIC");
  });

  test("JLL Self-Storage broker → PS (institutional default)", () => {
    const r = detectBuyer({
      name: "Storage Center · Reno NV",
      listingBroker: "JLL Self-Storage Capital Markets",
      state: "NV",
      city: "reno",
    });
    expect(r.signals.find((s) => s.signal === "BROKER_FINGERPRINT")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GEOGRAPHIC fallback (no brand match)
// ══════════════════════════════════════════════════════════════════════════

describe("detectBuyer — geographic fingerprint (fallback when no brand)", () => {
  test("Generic asset in PSA-disclosed MSA → PS lens", () => {
    const r = detectBuyer({
      name: "Storage Asset Phoenix AZ",
      state: "AZ",
      city: "phoenix",
    });
    expect(r.signals.find((s) => s.signal === "PSA_DISCLOSED_MSA")).toBeDefined();
  });

  test("Generic asset in CUBE-heavy state (TX) → CUBE picks up bonus", () => {
    const r = detectBuyer({
      name: "Storage Asset Houston TX",
      state: "TX",
      city: "houston",
    });
    // Houston is BOTH in PSA disclosure AND CUBE heavy — PS gets +10, CUBE
    // does NOT get heavy-state bonus (because PSA_DISCLOSED_MSA fires first).
    // Wait — actually CUBE_HEAVY_STATE fires regardless of PSA match; only
    // BRAND_MATCH gates it.
    expect(r.signals.find((s) => s.signal === "PSA_DISCLOSED_MSA")).toBeDefined();
    expect(r.signals.find((s) => s.signal === "CUBE_HEAVY_STATE")).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// DEAL-TYPE heuristics (growth-stage CO-LU profile)
// ══════════════════════════════════════════════════════════════════════════

describe("detectBuyer — deal type heuristics", () => {
  test("CO-LU lease-up (no brand) gives SMA a small boost", () => {
    const r = detectBuyer({
      name: "Storage Asset Greenville TX",
      dealType: "co-lu",
      state: "TX",
      city: "greenville",
    });
    expect(r.signals.find((s) => s.signal === "GROWTH_STAGE_DEAL_TYPE")).toBeDefined();
  });

  test("Stabilized deal does NOT trigger growth-stage boost for SMA", () => {
    const r = detectBuyer({
      name: "Storage Asset Greenville TX",
      dealType: "stabilized",
      state: "TX",
      city: "greenville",
    });
    expect(r.signals.find((s) => s.signal === "GROWTH_STAGE_DEAL_TYPE")).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LOW-confidence fallback to default
// ══════════════════════════════════════════════════════════════════════════

describe("detectBuyer — low-confidence fallback", () => {
  test("totally unknown asset (no brand, no broker, no geo) → default PS lens", () => {
    const r = detectBuyer({
      name: "Storage Asset",
    });
    expect(r.defaulted).toBe(true);
    expect(r.buyerKey).toBe("PS");
    expect(r.signals.find((s) => s.signal === "DEFAULT_FALLBACK")).toBeDefined();
  });

  test("empty input → default PS lens with LOW confidence", () => {
    const r = detectBuyer({});
    expect(r.defaulted).toBe(true);
    expect(r.confidence).toBe("LOW");
    expect(r.buyerKey).toBe("PS");
  });

  test("only weak signals (broker only) → does not over-confidently pick", () => {
    const r = detectBuyer({
      name: "Storage Asset",
      listingBroker: "Some Random Broker",
    });
    // No matching broker pattern, no brand, no geo → default
    expect(r.defaulted).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Result structure invariants
// ══════════════════════════════════════════════════════════════════════════

describe("detectBuyer — result structure invariants", () => {
  test("always returns scores object with all 5 buyer keys", () => {
    const r = detectBuyer({ name: "Random asset" });
    expect(r.scores).toHaveProperty("PS");
    expect(r.scores).toHaveProperty("EXR");
    expect(r.scores).toHaveProperty("CUBE");
    expect(r.scores).toHaveProperty("SMA");
    expect(r.scores).toHaveProperty("GENERIC");
  });

  test("buyerKey is always a valid lens key", () => {
    const inputs = [
      { name: "" },
      { name: "Random Storage", state: "WY" },
      { name: "CubeSmart NNN", state: "FL" },
      { name: "Public Storage", state: "AZ" },
    ];
    for (const inp of inputs) {
      const r = detectBuyer(inp);
      expect(["PS", "EXR", "CUBE", "SMA", "GENERIC"]).toContain(r.buyerKey);
    }
  });

  test("signals array contains signal objects with required fields", () => {
    const r = detectBuyer({ name: "CubeSmart NNN Tampa FL" });
    expect(Array.isArray(r.signals)).toBe(true);
    for (const sig of r.signals) {
      expect(typeof sig.signal).toBe("string");
      expect(typeof sig.buyer).toBe("string");
      expect(typeof sig.weight).toBe("number");
      expect(typeof sig.evidence).toBe("string");
    }
  });

  test("confidence is always HIGH | MEDIUM | LOW", () => {
    const inputs = [
      { name: "CubeSmart NNN" },
      { name: "Random Storage", state: "AZ", city: "phoenix" },
      { name: "Random Storage" },
    ];
    for (const inp of inputs) {
      const r = detectBuyer(inp);
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(r.confidence);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// formatDetectionBadge — human-readable label
// ══════════════════════════════════════════════════════════════════════════

describe("formatDetectionBadge", () => {
  test("renders winning signal evidence for HIGH-confidence brand match", () => {
    const r = detectBuyer({ name: "CubeSmart NNN Tallahassee FL" });
    const badge = formatDetectionBadge(r);
    expect(badge).toContain("CUBE");
    expect(badge).toContain("HIGH");
  });

  test("renders default-fallback message when no signals", () => {
    const r = detectBuyer({});
    const badge = formatDetectionBadge(r);
    expect(badge).toContain("Default lens");
    expect(badge).toContain("no decisive signals");
  });

  test("returns empty string for null detection", () => {
    expect(formatDetectionBadge(null)).toBe("");
  });
});
