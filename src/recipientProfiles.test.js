// recipientProfiles.test.js — pitch-mode recipient registry coverage.

import {
  REZA_MAHDAVIAN,
  AARON_COOK,
  JENNIFER_SAWYER,
  CUSTOM_RECIPIENT,
  RECIPIENTS,
  RECIPIENT_ORDER,
  RECIPIENT_OPTIONS,
  getRecipient,
  resolveRecipientLens,
} from "./recipientProfiles";

describe("RECIPIENTS registry — institutional pitch targets", () => {
  test("registry contains all 4 declared recipients (Reza, Aaron, Jennifer, Custom)", () => {
    expect(RECIPIENTS.reza).toBe(REZA_MAHDAVIAN);
    expect(RECIPIENTS.aaron).toBe(AARON_COOK);
    expect(RECIPIENTS.jennifer).toBe(JENNIFER_SAWYER);
    expect(RECIPIENTS.custom).toBe(CUSTOM_RECIPIENT);
  });

  test("RECIPIENT_ORDER lists keys in display order", () => {
    expect(RECIPIENT_ORDER).toEqual(["reza", "aaron", "jennifer", "custom"]);
  });

  test("RECIPIENT_OPTIONS render dropdown labels with name + role + firm", () => {
    expect(RECIPIENT_OPTIONS.length).toBe(4);
    const reza = RECIPIENT_OPTIONS.find((o) => o.key === "reza");
    expect(reza.label).toContain("Reza Mahdavian");
    expect(reza.label).toContain("Public Storage");
    const aaron = RECIPIENT_OPTIONS.find((o) => o.key === "aaron");
    expect(aaron.label).toContain("Aaron Cook");
    expect(aaron.label).toContain("U-Haul");
    const custom = RECIPIENT_OPTIONS.find((o) => o.key === "custom");
    expect(custom.label).toMatch(/custom/i);
  });
});

describe("REZA_MAHDAVIAN profile", () => {
  test("default lens is PS (Public Storage)", () => {
    expect(REZA_MAHDAVIAN.defaultLens).toBe("PS");
  });

  test("recipientName + role + firm populated", () => {
    expect(REZA_MAHDAVIAN.recipientName).toBe("Reza Mahdavian");
    expect(REZA_MAHDAVIAN.role).toMatch(/finance|real estate/i);
    expect(REZA_MAHDAVIAN.firm).toBe("Public Storage");
  });

  test("greeting cites PSA-specific institutional facts", () => {
    expect(REZA_MAHDAVIAN.greeting).toMatch(/PSA|self-managed|institutional/i);
    // Should reference PSA's distinguishing 10-K constants
    const g = REZA_MAHDAVIAN.greeting.toLowerCase();
    expect(g).toMatch(/24\.86|75\.14|psnext|10-k/);
  });
});

describe("AARON_COOK profile", () => {
  test("default lens is AMERCO (U-Haul)", () => {
    expect(AARON_COOK.defaultLens).toBe("AMERCO");
  });

  test("recipientName + role + firm populated", () => {
    expect(AARON_COOK.recipientName).toBe("Aaron Cook");
    expect(AARON_COOK.firm).toMatch(/u-haul|uhal/i);
  });

  test("greeting cites UHAL truck-cross-subsidy facts", () => {
    const g = AARON_COOK.greeting.toLowerCase();
    expect(g).toMatch(/cross[-\s]subsid|truck/);
    expect(g).toMatch(/79|81|center|adjacency/);
  });
});

describe("JENNIFER_SAWYER profile", () => {
  test("default lens is AMERCO (U-Haul)", () => {
    expect(JENNIFER_SAWYER.defaultLens).toBe("AMERCO");
  });

  test("recipientName + firm match Aaron's firm (both at UHAL)", () => {
    expect(JENNIFER_SAWYER.recipientName).toBe("Jennifer Sawyer");
    expect(JENNIFER_SAWYER.firm).toBe(AARON_COOK.firm);
  });
});

describe("CUSTOM_RECIPIENT profile", () => {
  test("recipientName + role + firm are null (analyst fills manually)", () => {
    expect(CUSTOM_RECIPIENT.recipientName).toBeNull();
    expect(CUSTOM_RECIPIENT.role).toBeNull();
    expect(CUSTOM_RECIPIENT.firm).toBeNull();
  });

  test("defaultLens is null — keeps whatever the analyst already picked", () => {
    expect(CUSTOM_RECIPIENT.defaultLens).toBeNull();
  });

  test("greeting is generic institutional language (no recipient name)", () => {
    expect(CUSTOM_RECIPIENT.greeting).toMatch(/institutional/i);
    expect(CUSTOM_RECIPIENT.greeting).not.toMatch(/Reza|Aaron|Jennifer/);
  });
});

describe("getRecipient", () => {
  test("returns correct profile for each known key (case-insensitive)", () => {
    expect(getRecipient("reza")).toBe(REZA_MAHDAVIAN);
    expect(getRecipient("REZA")).toBe(REZA_MAHDAVIAN);
    expect(getRecipient("Aaron")).toBe(AARON_COOK);
    expect(getRecipient("jennifer")).toBe(JENNIFER_SAWYER);
    expect(getRecipient("custom")).toBe(CUSTOM_RECIPIENT);
  });

  test("returns null for unknown / empty keys", () => {
    expect(getRecipient("unknown")).toBeNull();
    expect(getRecipient(null)).toBeNull();
    expect(getRecipient(undefined)).toBeNull();
    expect(getRecipient("")).toBeNull();
  });
});

describe("resolveRecipientLens", () => {
  test("maps Reza → PS lens", () => {
    expect(resolveRecipientLens("reza")).toBe("PS");
  });

  test("maps Aaron → AMERCO lens", () => {
    expect(resolveRecipientLens("aaron")).toBe("AMERCO");
  });

  test("maps Jennifer → AMERCO lens", () => {
    expect(resolveRecipientLens("jennifer")).toBe("AMERCO");
  });

  test("custom + unknown → falls back to DEFAULT_BUYER_KEY (PS)", () => {
    expect(resolveRecipientLens("custom")).toBe("PS");
    expect(resolveRecipientLens("unknown")).toBe("PS");
    expect(resolveRecipientLens(null)).toBe("PS");
  });
});
