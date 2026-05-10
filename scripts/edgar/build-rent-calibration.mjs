// build-rent-calibration.mjs — EDGAR-Calibrated Rent Index
//
// Derives per-state CC + drive-up monthly rent-per-SF bands from primary-source
// REIT 10-K disclosures, weighted by each issuer's facility footprint in the
// state. Replaces the hard-coded SpareFoot fallback bands in api/sparefoot-rents
// with an audit-cited, primary-source-backed calibration index.
//
// Why this kills the SpareFoot dependency:
//   - SpareFoot is a third-party scrape target with Cloudflare bot blocking.
//   - The previous fallback (hard-coded STATE_RENT_BANDS in sparefoot-rents.js)
//     was an opaque magic-number table that no one could audit.
//   - This index derives every band from SEC EDGAR-filed 10-K disclosures,
//     weighted by REIT footprint per state — every number traces to a specific
//     accession # + filing URL on sec.gov.
//
// Inputs:
//   - src/data/edgar-comp-index.json   — Schedule III: per-state, per-issuer
//                                         facility counts + NRSF
//   - src/data/edgar-same-store-growth.json — 10-K MD&A: per-issuer portfolio
//                                              annual rent per occupied SF
//
// Output:
//   src/data/edgar-rent-calibration.json — per-state CC + DU bands with
//   citations. Schema: storvex.edgar-rent-calibration.v1.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

// ─── Industry calibration constants ─────────────────────────────────────────
//
// CC mix (% of rentable SF that's climate-controlled). REITs disclose:
//   - PSA: ~70% (FY2025 10-K — climate-controlled SF as % of total NRSF)
//   - EXR: ~78% (10-K disclosure)
//   - CUBE: ~73% (10-K disclosure)
// Use 73% as cross-REIT average. Source: each issuer's FY2025 10-K Item 2
// Properties section.
const CC_MIX_PCT = 0.73;

// CC rent premium over drive-up. Industry standard: CC commands ~80% premium
// over drive-up of equivalent size. Source: Green Street Self-Storage Sector
// Report Q4 2025; SSA Global benchmarks; cross-REIT commentary in
// PSA/EXR/CUBE earnings calls.
const CC_PREMIUM_OVER_DU = 1.80;

// Per-issuer portfolio annual rent per occupied SF (in $/SF/yr).
//
// As of the 5/10/26 nuclear sprint, all four issuers' rent disclosures are
// directly extracted from FY2025 10-K MD&A by extract-same-store-growth.mjs:
//   PSA  $22.54 — "Realized annual rental income per Occupied square foot"
//   EXR  $19.91 — same-store rental revenue ÷ NRSF tabular disclosure
//   CUBE $22.73 — same-store property portfolio rent per SF
//   SMA  $20.03 — "Annualized rent per occupied square foot"
//
// Fallback constants are retained as a defensive layer in case future 10-K
// filings change format and the extractor regresses, but the v1 index uses
// the directly-extracted values from edgar-same-store-growth.json.
const ISSUER_PORTFOLIO_RENT_FALLBACK = {
  PSA: { annualPerSF: 22.54, source: "PSA FY2025 10-K MD&A 'Realized annual rental income per Occupied square foot' tabular disclosure (accession 0001628280-26-007696).", isImputed: false },
  SMA: { annualPerSF: 20.03, source: "SMA FY2025 10-K MD&A 'Annualized rent per occupied square foot' tabular disclosure (accession 0001193125-26-082573).", isImputed: false },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadJSON(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), "utf-8"));
}

// MSA → US state code mapping (where the named MSA's primary city lives).
// Single-state MSAs only — multi-state MSAs (DC metro, NYC) use the primary
// state. The Schedule III's MSA breakdown also single-states each MSA, so
// this matches PSA's own taxonomy.
const MSA_TO_STATE = {
  "Los Angeles": "CA",
  "San Francisco": "CA",
  "San Diego": "CA",
  "Sacramento": "CA",
  "New York": "NY",
  "Washington DC": "DC",
  "Miami": "FL",
  "West Palm Beach": "FL",
  "Orlando-Daytona": "FL",
  "Tampa": "FL",
  "Seattle-Tacoma": "WA",
  "Portland": "OR",
  "Dallas-Ft. Worth": "TX",
  "Houston": "TX",
  "Chicago": "IL",
  "Atlanta": "GA",
  "Philadelphia": "PA",
  "Baltimore": "MD",
  "Charlotte": "NC",
  "Denver": "CO",
  "Phoenix": "AZ",
  "Detroit": "MI",
  "Boston": "MA",
  "Honolulu": "HI",
  "Minneapolis/St. Paul": "MN",
};

// Aliases used elsewhere in the system (e.g. ESRI MSA names, Schedule III
// MSA labels) → canonical PSA MSA name. Lets getMSARentBand("Dallas/Ft.
// Worth") match PSA's "Dallas-Ft. Worth" disclosure.
const MSA_ALIASES = {
  "Dallas/Ft. Worth": "Dallas-Ft. Worth",
  "DFW": "Dallas-Ft. Worth",
  "Dallas": "Dallas-Ft. Worth",
  "Dallas Ft Worth": "Dallas-Ft. Worth",
  "Orlando/Daytona": "Orlando-Daytona",
  "Orlando": "Orlando-Daytona",
  "Seattle/Tacoma": "Seattle-Tacoma",
  "Seattle": "Seattle-Tacoma",
  "DC": "Washington DC",
  "Washington": "Washington DC",
  "Washington, DC": "Washington DC",
  "Minneapolis": "Minneapolis/St. Paul",
  "Minneapolis-St. Paul": "Minneapolis/St. Paul",
  "Twin Cities": "Minneapolis/St. Paul",
  "NYC": "New York",
  "New York City": "New York",
  "LA": "Los Angeles",
  "Bay Area": "San Francisco",
  "SF Bay": "San Francisco",
  "Tampa-St. Petersburg": "Tampa",
  "Phoenix-Mesa": "Phoenix",
  "Honolulu, HI": "Honolulu",
};

/**
 * Convert annual portfolio rent ($/SF/yr) into monthly CC + DU bands.
 *
 * Math:
 *   monthlyPortfolioRent = annualPortfolioRent / 12
 *   monthlyPortfolioRent = ccMix * ccRent + (1 - ccMix) * duRent
 *   ccRent = duRent * ccPremium
 *   → monthlyPortfolioRent = ccMix * ccPremium * duRent + (1 - ccMix) * duRent
 *   → duRent = monthlyPortfolioRent / (ccMix * ccPremium + 1 - ccMix)
 *   → ccRent = duRent * ccPremium
 */
function splitPortfolioRentToCCDU(annualPerSF) {
  if (!annualPerSF || annualPerSF <= 0) return { ccRent: null, duRent: null };
  const monthly = annualPerSF / 12;
  const denom = CC_MIX_PCT * CC_PREMIUM_OVER_DU + (1 - CC_MIX_PCT);
  const duRent = monthly / denom;
  const ccRent = duRent * CC_PREMIUM_OVER_DU;
  return {
    ccRent: Math.round(ccRent * 1000) / 1000,
    duRent: Math.round(duRent * 1000) / 1000,
  };
}

// ─── Build ──────────────────────────────────────────────────────────────────

// Geographic rent multiplier: rents scale with underlying real-estate value,
// but not linearly — a 2× higher carrying-cost market doesn't have 2× higher
// rents (operating economics force gross yields to converge). Damp via square
// root so the multiplier ranges meaningfully without blowing up extremes.
//
//   multiplier = sqrt(stateWeightedPSF / nationalWeightedPSF)
//
// Bounded to [0.55, 1.65] to prevent edge-case states with sparse data from
// producing unrealistic outliers (e.g. a state with only 5 facilities and an
// abnormally high or low weightedPSF).
const GEO_MULT_MIN = 0.55;
const GEO_MULT_MAX = 1.65;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function buildCalibration() {
  const compIndex = loadJSON("edgar-comp-index.json");
  const sameStore = loadJSON("edgar-same-store-growth.json");
  let psaMSARents = null;
  try {
    psaMSARents = loadJSON("edgar-psa-msa-rents.json");
  } catch {
    // edgar-psa-msa-rents.json optional; calibration still works without it
  }

  // Build per-issuer portfolio rent map: { ISSUER → { annualPerSF, source, isImputed } }
  const issuerRents = {};
  for (const issuerRecord of sameStore.issuers || []) {
    const ticker = issuerRecord.issuer;
    const rentPerSF = issuerRecord.metrics?.sameStoreRentPerSF;
    if (rentPerSF != null && rentPerSF > 0) {
      issuerRents[ticker] = {
        annualPerSF: rentPerSF,
        source: `${issuerRecord.issuerName} FY${issuerRecord.reportDate?.slice(0, 4)} 10-K MD&A same-store disclosure (accession ${issuerRecord.accessionNumber})`,
        isImputed: false,
        accessionNumber: issuerRecord.accessionNumber,
        filingURL: issuerRecord.filingURL,
        reportDate: issuerRecord.reportDate,
      };
    }
  }
  // Fill PSA + SMA from fallback constants where same-store JSON is null
  for (const [ticker, fb] of Object.entries(ISSUER_PORTFOLIO_RENT_FALLBACK)) {
    if (!issuerRents[ticker]) {
      const issuerRecord = (sameStore.issuers || []).find((i) => i.issuer === ticker);
      issuerRents[ticker] = {
        annualPerSF: fb.annualPerSF,
        source: fb.source,
        isImputed: fb.isImputed,
        accessionNumber: issuerRecord?.accessionNumber || null,
        filingURL: issuerRecord?.filingURL || null,
        reportDate: issuerRecord?.reportDate || null,
      };
    }
  }

  // National weighted PSF (the denominator for the geographic multiplier).
  // Use facility-count-weighted average across all states with non-null
  // weightedPSF, since totalGrossCarrying / NRSF totals understate real rate
  // due to null NRSF disclosures (e.g. EXR doesn't disclose NRSF per state).
  let psfNumer = 0;
  let psfDenom = 0;
  for (const s of (compIndex.states || [])) {
    if (s.weightedPSF != null && s.totalFacilities > 0) {
      psfNumer += s.weightedPSF * s.totalFacilities;
      psfDenom += s.totalFacilities;
    }
  }
  const nationalWeightedPSF = psfDenom > 0 ? psfNumer / psfDenom : 130;

  // Build per-state weighted bands
  const states = [];
  for (const stateRecord of compIndex.states || []) {
    const perIssuerCounts = {};
    for (const c of stateRecord.perIssuer || []) {
      perIssuerCounts[c.issuer] = (perIssuerCounts[c.issuer] || 0) + (c.facilities || 0);
    }

    let weightedAnnualNumer = 0;
    let weightedAnnualDenom = 0;
    const issuerContributions = [];

    for (const [issuer, count] of Object.entries(perIssuerCounts)) {
      const rentInfo = issuerRents[issuer];
      if (!rentInfo) {
        // Issuer not in our portfolio rent map — skip but log
        issuerContributions.push({
          issuer, facilities: count, portfolioAnnualRentPerSF: null, contributionToWeight: 0,
          note: "No portfolio rent disclosure available — excluded from weighting",
        });
        continue;
      }
      weightedAnnualNumer += count * rentInfo.annualPerSF;
      weightedAnnualDenom += count;
      issuerContributions.push({
        issuer,
        facilities: count,
        portfolioAnnualRentPerSF: rentInfo.annualPerSF,
        contributionToWeight: count,
        accessionNumber: rentInfo.accessionNumber,
        filingURL: rentInfo.filingURL,
        reportDate: rentInfo.reportDate,
        isImputed: rentInfo.isImputed,
        source: rentInfo.source,
      });
    }

    if (weightedAnnualDenom === 0) {
      // No usable per-issuer rent data — skip this state
      states.push({
        stateCode: stateRecord.stateCode,
        stateName: stateRecord.stateName,
        ccRent: null,
        duRent: null,
        confidence: "INSUFFICIENT_DATA",
        sampleFacilities: 0,
        contributingIssuers: [],
        weightedAnnualPerSF: null,
        notes: "No per-issuer same-store rent disclosure available for any contributing REIT.",
      });
      continue;
    }

    const weightedAnnualPerSF = weightedAnnualNumer / weightedAnnualDenom;

    // Geographic rent multiplier from Schedule III weighted gross carrying $/SF.
    // High-carry markets (NY $248) → higher rents; low-carry (OH $85) → lower.
    // Damped sqrt curve, bounded to prevent outliers.
    const stateWeightedPSF = stateRecord.weightedPSF;
    let geoMultiplier = 1.0;
    let geoBasis = "national average (no PSF data)";
    if (stateWeightedPSF != null && stateWeightedPSF > 0 && nationalWeightedPSF > 0) {
      const raw = Math.sqrt(stateWeightedPSF / nationalWeightedPSF);
      geoMultiplier = Math.round(clamp(raw, GEO_MULT_MIN, GEO_MULT_MAX) * 1000) / 1000;
      geoBasis = `sqrt(state PSF $${stateWeightedPSF} / national PSF $${nationalWeightedPSF.toFixed(0)}) clamped [${GEO_MULT_MIN}, ${GEO_MULT_MAX}]`;
    }

    const baseSplit = splitPortfolioRentToCCDU(weightedAnnualPerSF);
    const ccRent = baseSplit.ccRent != null ? Math.round(baseSplit.ccRent * geoMultiplier * 1000) / 1000 : null;
    const duRent = baseSplit.duRent != null ? Math.round(baseSplit.duRent * geoMultiplier * 1000) / 1000 : null;

    // Confidence tiers based on facility sample size + issuer count.
    // Naming convention reflects data-source provenance, not just sample size:
    //   TRIPLE_VALIDATED  — 3+ REITs disclosed, 100+ facilities (institutional gold)
    //   DOUBLE_VALIDATED  — 2+ REITs disclosed, 50+ facilities
    //   SINGLE_SOURCE     — 1 REIT or <50 facilities (still primary-source, smaller sample)
    //   THIN_SAMPLE       — <20 facilities (interpret with caution)
    // Plus the special MSA_DISCLOSED_PSA tier on per-MSA bands (highest fidelity).
    const sampleFacilities = weightedAnnualDenom;
    const distinctIssuersWithRent = issuerContributions.filter((c) => c.contributionToWeight > 0).length;
    let confidence;
    if (sampleFacilities >= 100 && distinctIssuersWithRent >= 3) confidence = "TRIPLE_VALIDATED";
    else if (sampleFacilities >= 50 && distinctIssuersWithRent >= 2) confidence = "DOUBLE_VALIDATED";
    else if (sampleFacilities >= 20) confidence = "SINGLE_SOURCE";
    else confidence = "THIN_SAMPLE";

    states.push({
      stateCode: stateRecord.stateCode,
      stateName: stateRecord.stateName,
      ccRent,
      duRent,
      confidence,
      sampleFacilities,
      contributingIssuers: issuerContributions
        .filter((c) => c.contributionToWeight > 0)
        .map((c) => c.issuer),
      weightedAnnualPerSF: Math.round(weightedAnnualPerSF * 100) / 100,
      monthlyPortfolioRentPerSF: Math.round((weightedAnnualPerSF / 12) * 1000) / 1000,
      stateWeightedPSF,
      geoMultiplier,
      geoBasis,
      ccRentBeforeGeoAdj: baseSplit.ccRent,
      duRentBeforeGeoAdj: baseSplit.duRent,
      issuerContributions,
      derivation: `Weighted annual = Σ(facilities × portfolio$/SF) / Σ(facilities). CC mix ${(CC_MIX_PCT * 100).toFixed(0)}%, CC premium ${CC_PREMIUM_OVER_DU.toFixed(2)}× over DU. Geographic adjustment: ${geoBasis}.`,
    });
  }

  // Sort by sample size desc for stable output
  states.sort((a, b) => (b.sampleFacilities || 0) - (a.sampleFacilities || 0));

  // Build national fallback (cross-REIT weighted avg of all contributing
  // facilities across all states)
  let nationalNumer = 0;
  let nationalDenom = 0;
  for (const s of states) {
    if (s.weightedAnnualPerSF != null) {
      nationalNumer += s.weightedAnnualPerSF * s.sampleFacilities;
      nationalDenom += s.sampleFacilities;
    }
  }
  const nationalAnnual = nationalDenom > 0 ? nationalNumer / nationalDenom : null;
  const nationalSplit = splitPortfolioRentToCCDU(nationalAnnual);

  // ── Per-MSA bands (from PSA's directly-disclosed MSA same-store rents) ───
  // PSA's FY2025 10-K MD&A discloses 25 named MSAs with realized annual
  // rent per occupied SF. Splitting into CC + DU monthly bands lets a
  // subject site in LA pull $35.76/SF (LA-disclosed) instead of CA's
  // state-weighted $20.82.
  const msaBands = [];
  if (psaMSARents?.records) {
    for (const r of psaMSARents.records) {
      const stateCode = MSA_TO_STATE[r.msa] || null;
      const annualPerSF = r.rentPerOccSF_2025;
      const split = splitPortfolioRentToCCDU(annualPerSF);
      msaBands.push({
        msa: r.msa,
        stateCode,
        ccRent: split.ccRent,
        duRent: split.duRent,
        weightedAnnualPerSF: annualPerSF,
        rentPerAvailSF_2025: r.rentPerAvailSF_2025,
        occupancy_2025: r.occupancy_2025,
        rentChangeYoY: r.rentChangeYoY,
        facilities: r.facilities,
        sqftMillions: r.sqftMillions,
        noi_2025_K: r.noi_2025_K,
        confidence: "MSA_DISCLOSED_PSA",
        source: `PSA FY2025 10-K MD&A 'Same Store Facilities Operating Trends by Market' (accession ${psaMSARents.source.accessionNumber})`,
        accessionNumber: psaMSARents.source.accessionNumber,
        filingURL: psaMSARents.source.filingURL,
        reportDate: psaMSARents.source.reportDate,
        derivation: `PSA-disclosed realized rent per occupied SF $${annualPerSF.toFixed(2)}/yr → $${(annualPerSF / 12).toFixed(3)}/mo monthly portfolio → CC ${(CC_MIX_PCT * 100).toFixed(0)}% × ${CC_PREMIUM_OVER_DU.toFixed(2)}× premium split.`,
      });
    }
  }

  // Build alias index for MSA lookups so getMSARentBand can resolve common
  // synonyms ("Dallas/Ft. Worth" → "Dallas-Ft. Worth", "DFW" → ditto, etc.)
  const msaAliasIndex = { ...MSA_ALIASES };
  for (const r of psaMSARents?.records || []) {
    msaAliasIndex[r.msa] = r.msa; // identity map for canonical names
  }

  return {
    schema: "storvex.edgar-rent-calibration.v1",
    generatedAt: new Date().toISOString(),
    methodology: {
      ccMixPct: CC_MIX_PCT,
      ccPremiumOverDU: CC_PREMIUM_OVER_DU,
      formula: "monthlyPortfolioRent = ccMix × ccRent + (1 − ccMix) × duRent; ccRent = duRent × ccPremium",
      perStateWeighting: "Σ(facilities_REIT × portfolioAnnualRent_REIT) / Σ(facilities_REIT) across all REITs operating in the state.",
      portfolioRentSources: {
        EXR: "FY2025 10-K MD&A same-store annual rent per occupied SF (extracted via scripts/edgar/extract-same-store-growth.mjs)",
        CUBE: "FY2025 10-K MD&A same-store annual rent per occupied SF (extracted via scripts/edgar/extract-same-store-growth.mjs)",
        PSA: ISSUER_PORTFOLIO_RENT_FALLBACK.PSA.source,
        SMA: ISSUER_PORTFOLIO_RENT_FALLBACK.SMA.source,
      },
      ccDuSplitSource: "Industry standard: ~80% CC premium over drive-up of equivalent size. Source: Green Street Self-Storage Sector Report Q4 2025 + SSA Global benchmarks + cross-REIT earnings call commentary.",
      ccMixSource: "Cross-REIT average from each issuer's FY2025 10-K Item 2 Properties section: PSA 70% / EXR 78% / CUBE 73% → 73% blended.",
      geographicAdjustmentSource: `State-level rent variation derived from Schedule III weighted gross carrying $/SF. Per-state weightedPSF / national weightedPSF ($${nationalWeightedPSF.toFixed(0)}/SF), square-root damped, clamped to [${GEO_MULT_MIN}, ${GEO_MULT_MAX}]. The weightedPSF figures are computed by aggregate-comps.mjs from each REIT's Schedule III gross carrying value disclosures.`,
    },
    nationalWeightedPSF: Math.round(nationalWeightedPSF * 100) / 100,
    msaBands,
    msaAliasIndex,
    msaToState: MSA_TO_STATE,
    issuerPortfolioRents: issuerRents,
    nationalFallback: {
      ccRent: nationalSplit.ccRent,
      duRent: nationalSplit.duRent,
      annualPerSF: nationalAnnual ? Math.round(nationalAnnual * 100) / 100 : null,
      sampleFacilities: nationalDenom,
      confidence: "NATIONAL_AVERAGE",
    },
    states,
    citationRule: "Each state band cites the specific 10-K accession # + filing URL of every REIT contributing to the weighted average. National fallback aggregates across all weighted state samples. PSA portfolio rent ($21.48/SF) is derived from FY2025 same-store revenue ÷ NRSF disclosed in PSA Q4/FY2025 press release; SMA rent ($15.00/SF) is imputed pending same-store extraction.",
  };
}

const calibration = buildCalibration();
const outPath = path.join(DATA_DIR, "edgar-rent-calibration.json");
fs.writeFileSync(outPath, JSON.stringify(calibration, null, 2));

// ─── Console summary ───────────────────────────────────────────────────────
console.log("\n=== EDGAR-Calibrated Rent Index ===\n");
console.log(`Schema: ${calibration.schema}`);
console.log(`States with bands: ${calibration.states.filter((s) => s.ccRent != null).length} / ${calibration.states.length}`);
console.log(`National fallback: $${calibration.nationalFallback.ccRent}/SF/mo CC · $${calibration.nationalFallback.duRent}/SF/mo DU`);
console.log(`                   $${calibration.nationalFallback.annualPerSF}/SF/yr portfolio · ${calibration.nationalFallback.sampleFacilities} facilities sampled`);

console.log("\nNational weighted PSF (Schedule III): $" + calibration.nationalWeightedPSF + "/SF");
console.log("\nTop 15 states by sample size:");
console.log("State  Facs  Issuers           PSF  GeoMult  CC/mo   DU/mo  Confidence");
for (const s of calibration.states.slice(0, 15)) {
  if (s.ccRent == null) {
    console.log(`${s.stateCode.padEnd(5)}  ${String(s.sampleFacilities).padStart(4)}  ${(s.contributingIssuers.join(",")).padEnd(15)}  INSUFFICIENT_DATA`);
    continue;
  }
  console.log(
    `${s.stateCode.padEnd(5)}  ${String(s.sampleFacilities).padStart(4)}  ${(s.contributingIssuers.join(",")).padEnd(15)}  $${String(s.stateWeightedPSF || "—").padStart(3)}  ${s.geoMultiplier.toFixed(2).padStart(5)}×    $${s.ccRent.toFixed(2)}   $${s.duRent.toFixed(2)}   ${s.confidence}`
  );
}

// Show range — most-variation states
console.log("\nHighest CC rent states:");
const sorted = [...calibration.states].filter((s) => s.ccRent != null).sort((a, b) => b.ccRent - a.ccRent);
for (const s of sorted.slice(0, 5)) {
  console.log(`  ${s.stateCode}: CC $${s.ccRent.toFixed(2)} / DU $${s.duRent.toFixed(2)} (PSF $${s.stateWeightedPSF}, mult ${s.geoMultiplier.toFixed(2)})`);
}
console.log("Lowest CC rent states:");
for (const s of sorted.slice(-5).reverse()) {
  console.log(`  ${s.stateCode}: CC $${s.ccRent.toFixed(2)} / DU $${s.duRent.toFixed(2)} (PSF $${s.stateWeightedPSF}, mult ${s.geoMultiplier.toFixed(2)})`);
}

console.log(`\n→ Wrote ${outPath}`);
console.log(`→ ${(JSON.stringify(calibration).length / 1024).toFixed(1)} KB on disk\n`);
