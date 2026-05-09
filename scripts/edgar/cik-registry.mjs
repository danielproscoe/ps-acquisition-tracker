// cik-registry.mjs — SEC EDGAR Central Index Key (CIK) registry for the
// institutional self-storage REIT universe. CIKs verified against SEC's
// company tickers JSON (https://www.sec.gov/files/company_tickers.json)
// on 2026-05-09.
//
// Used by the EDGAR ingester to fetch each issuer's quarterly + annual
// filings via SEC's submissions API.

export const STORAGE_REITS = {
  PSA: {
    cik: 1393311,
    name: "Public Storage",
    ticker: "PSA",
    notes: "Largest US storage REIT. Acquired NSA (National Storage Affiliates) and iStorage. Same-store opex 24.86% of revenue per FY2025 10-K.",
  },
  EXR: {
    cik: 1289490,
    name: "Extra Space Storage Inc",
    ticker: "EXR",
    notes: "#2 US storage REIT. Acquired Life Storage (LSI) in July 2023. Largest pure-storage portfolio post-PSA-NSA merger.",
  },
  CUBE: {
    cik: 1298675,  // verified via SEC company_tickers.json 2026-05-09 — prior 1298946 was DiamondRock Hospitality
    name: "CubeSmart",
    ticker: "CUBE",
    notes: "#3 US storage REIT. Significant 3rd-party management business (CubeSmart-managed) that scales beyond owned facilities.",
  },
  // Life Storage (LSI) was acquired by EXR in July 2023 — historical filings
  // still on EDGAR for backfill purposes (CIK 1283630). Post-merger the
  // entity stops filing.
  LSI: {
    cik: 1283630,
    name: "Life Storage Inc (acquired by EXR 2023)",
    ticker: "LSI",
    notes: "Acquired by EXR July 2023. Historical 10-Q/10-K filings still on EDGAR through 2023-Q2.",
    historicalOnly: true,
    lastFilingExpected: "2023-Q2",
  },
  // National Storage Affiliates (NSA) — acquired by PSA. Historical filings
  // through close of merger in 2025.
  NSA: {
    cik: 1618563,
    name: "National Storage Affiliates Trust (acquired by PSA 2025)",
    ticker: "NSA",
    notes: "Acquired by PSA in 2025. Historical 10-Q/10-K filings on EDGAR.",
    historicalOnly: true,
    lastFilingExpected: "2025-Q3",
  },
  // SmartStop Self Storage REIT — non-traded REIT, files with SEC.
  SMA: {
    cik: 1585389,
    name: "SmartStop Self Storage REIT, Inc.",
    ticker: "SMA",
    notes: "Non-traded REIT. Smaller portfolio but files quarterly. Useful for tertiary-market comps.",
  },
  // Global Self Storage — small public storage REIT, ~13 facilities. Niche but
  // captures small-MSA / suburban storage comp data the larger REITs miss.
  SELF: {
    cik: 1031235,
    name: "Global Self Storage, Inc.",
    ticker: "SELF",
    notes: "Small-cap storage REIT (~13 facilities). Useful for small-MSA / suburban comp coverage where larger REITs don't operate.",
  },
  // Strategic Storage Trust VI — non-traded REIT, smaller portfolio.
  SGST: {
    cik: 1852575,
    name: "Strategic Storage Trust VI, Inc.",
    ticker: "SGST",
    notes: "Non-traded REIT (Strategic Storage Trust series). Adds breadth to comp database.",
  },
};

// Pad CIK to 10 digits (SEC's submissions API requires this format).
export function padCIK(cik) {
  return String(cik).padStart(10, "0");
}

// Common HTTP headers required by SEC EDGAR. They want a User-Agent
// identifying the requester (per https://www.sec.gov/os/accessing-edgar-data).
export const SEC_HEADERS = {
  "User-Agent": "DJR Real Estate Storvex Asset Analyzer · daniel.p.roscoe@gmail.com",
  "Accept-Encoding": "gzip, deflate",
  "Host": "data.sec.gov",
};

// Same headers but for www.sec.gov (different Host).
export const SEC_ARCHIVE_HEADERS = {
  ...SEC_HEADERS,
  "Host": "www.sec.gov",
};
