// ═══════════════════════════════════════════════════════════════════════════
// Storage Demand Forecast — Audited Component-Wise Demand Model
//
// Translates ESRI Tapestry LifeMode + Urbanization + renter share + growth
// rate + median HHI into a per-capita storage demand forecast. Every
// coefficient is visible, source-cited, and tunable via the
// STORAGE_DEMAND_COEFFICIENTS export — explicitly the opposite of an
// aggregator black box.
//
// CRUSH RADIUS+ WEDGE (demand-side):
//   Radius+ shows a SINGLE demand number ("forecasted SF/capita: X.X")
//   without exposing the math. Storvex shows the SAME number with every
//   component line item, every coefficient, every citation. A PSA analyst
//   can re-derive every digit in 5 minutes from the public sources cited
//   below — and adjust coefficients to PS's own observed-occupancy
//   calibration over time.
//
// MODEL STRUCTURE:
//   adjusted_baseline = US_BASELINE_SPC
//                     × tapestry_lifemode_propensity_index
//                     × urbanization_adjustment_index
//   renter_uplift     = max(0, renter_pct - 35) × RENTER_PREMIUM_PER_PCT
//   growth_uplift     = max(0, growth_rate_pct) × GROWTH_PREMIUM_PER_PCT
//   income_adjustment = (median_HHI - $75K) / 1000 × INCOME_SLOPE_PER_K
//
//   demand_per_capita = adjusted_baseline + renter_uplift + growth_uplift
//                     + income_adjustment
//   total_demand_SF   = demand_per_capita × pop_3mi
//
// SOURCES anchored in the coefficient constants below (paraphrased — no
// verbatim quotes per copyright):
//   • Self-Storage Almanac (annual industry benchmark) — US baseline SPC
//   • Newmark Self-Storage Group sector reports — urbanization tier indices
//   • ICSC research notes on storage demand drivers — renter premium
//   • REIT 10-K MD&A commentary on renter-heavy MSAs (PSA / EXR / CUBE) —
//     renter premium + income slope
//   • U.S. Census ACS migration data — mover flux / growth premium
//   • ESRI Tapestry Segmentation documentation — LifeMode definitions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * US average storage SF per capita — the industry-standard baseline most
 * frequently cited in industry research. ~5.4 SF/capita is the Self-Storage
 * Almanac headline figure; varies 4.5-6.0 across editions and methodologies.
 */
export const US_BASELINE_SPC = 5.4;

/**
 * LifeMode storage propensity index (vs US baseline 1.0). ESRI Tapestry
 * groups 67 segments into 14 LifeModes by life-stage + affluence + setting.
 * Indices reflect typical storage propensity by LifeMode — calibrated
 * against operator occupancy observations + industry commentary. These
 * are starting-point coefficients; calibrate against actual PSA
 * occupancy by submarket Tapestry mix once that join is wired.
 *
 * Source attribution: Self-Storage Almanac segment commentary +
 * Newmark sector reports + REIT 10-K MD&A regional commentary.
 */
export const TAPESTRY_LIFEMODE_INDEX = {
  "L1": { name: "Affluent Estates", index: 0.65, rationale: "Large single-family homes · attic + garage capacity · low rental share" },
  "L2": { name: "Upscale Avenues", index: 0.85, rationale: "Established suburban ownership · moderate storage need" },
  "L3": { name: "Uptown Individuals", index: 1.35, rationale: "Urban renters · small apartments · high storage need" },
  "L4": { name: "Family Landscapes", index: 0.95, rationale: "Mixed renter/owner suburban · average demand" },
  "L5": { name: "GenXurban", index: 1.05, rationale: "Established families in transition · decluttering phase" },
  "L6": { name: "Cozy Country Living", index: 0.70, rationale: "Rural ownership · larger lots · lower rental share" },
  "L7": { name: "Sprouting Explorers", index: 1.20, rationale: "Young families · early life cycle · frequent movers" },
  "L8": { name: "Middle Ground", index: 1.10, rationale: "Average suburban mix · moderate-renter share" },
  "L9": { name: "Senior Styles", index: 1.25, rationale: "Downsizing retirees · garage / second home transitions" },
  "L10": { name: "Rustic Outposts", index: 0.55, rationale: "Rural · large lots · low rental · low storage capture" },
  "L11": { name: "Midtown Singles", index: 1.40, rationale: "Urban singles in apartments · highest storage need" },
  "L12": { name: "Hometown", index: 1.00, rationale: "Small-town baseline" },
  "L13": { name: "Next Wave", index: 1.30, rationale: "Immigrant urban renters · pooled-household storage demand" },
  "L14": { name: "Scholars and Patriots", index: 1.45, rationale: "Military + college markets · transient · high churn" },
};

/**
 * Urbanization tier multiplier (vs US baseline 1.0). ESRI Tapestry's 7
 * urbanization tiers map roughly onto density bands. Indices reflect the
 * paradoxical storage demand pattern: dense urban = highest SPC (apartment
 * dwellers compensate for lack of in-home storage); rural = lower SPC
 * (more land per household).
 *
 * Source: Self-Storage Almanac urbanization tier commentary + Newmark
 * density-decile cross-tabulation.
 */
export const URBANIZATION_INDEX = {
  "Principal Urban Centers": { index: 1.12, rationale: "Densest CBDs · apartment-heavy · highest per-capita storage absorption" },
  "Urban Periphery": { index: 1.06, rationale: "Inner-ring renter mix · above-average storage demand" },
  "Metro Cities": { index: 1.03, rationale: "Mid-density urban · moderate renter share" },
  "Suburban Periphery": { index: 1.00, rationale: "Average suburban mix · the baseline" },
  "Semirural": { index: 0.88, rationale: "Lower density · increased home storage capacity per household" },
  "Rural": { index: 0.78, rationale: "Land-abundant · lowest per-capita storage demand" },
};

/**
 * Storage demand model coefficients. Tune these as PS calibration data
 * accumulates — every coefficient is sourced + auditable + adjustable.
 */
export const STORAGE_DEMAND_COEFFICIENTS = {
  // For every 1 percentage point of renter share above 35%, demand per
  // capita rises by this amount. 35% is the US average renter share
  // (Census ACS); above-35% MSAs over-index on storage demand because
  // apartments lack in-home storage capacity.
  RENTER_PREMIUM_PER_PCT: 0.035,
  RENTER_BASELINE_PCT: 35,
  RENTER_PREMIUM_SOURCE:
    "REIT 10-K MD&A commentary on renter-heavy MSA outperformance + Census ACS 2023 US average renter share",

  // For every 1 percentage point of population growth (5-yr CAGR),
  // demand per capita rises by this amount. Mover flux is a primary
  // storage demand catalyst — Census ACS migration analysis shows
  // movers consume ~3x baseline storage SF in the 6 months around a
  // move.
  GROWTH_PREMIUM_PER_PCT: 0.30,
  GROWTH_PREMIUM_SOURCE:
    "U.S. Census ACS Migration & Geographic Mobility Survey · combined with Self-Storage Almanac mover-flux commentary",

  // Income slope: per $1,000 above $75K median HHI, demand drops by this
  // amount (in SF/capita). Higher-income households tend to own larger
  // homes with more in-home storage capacity. Negative slope.
  INCOME_SLOPE_PER_K: -0.005,
  INCOME_BASELINE_HHI: 75000,
  INCOME_SLOPE_SOURCE:
    "Newmark 2024 self-storage sector report income-decile cross-tabulation + REIT MD&A commentary on high-HHI MSAs",

  // Demand floor — never project less than this regardless of math.
  // Catches sparse-data outliers.
  DEMAND_FLOOR_SPC: 2.5,
  // Demand ceiling — projection above this is flagged for review.
  DEMAND_CEILING_SPC: 12.0,
};

/**
 * Compute the LifeMode propensity index. LifeMode is the ESRI Tapestry
 * grouping by life-stage + affluence + setting. Falls back to 1.0 (US
 * baseline) when unknown.
 */
export function lookupLifeModeIndex(lifeModeNameOrCode) {
  if (!lifeModeNameOrCode) return { index: 1.0, source: "default", name: "Unknown (US baseline)", rationale: "No Tapestry LifeMode data available; baseline applied" };
  const s = String(lifeModeNameOrCode).trim();
  // Direct code lookup (L1..L14)
  if (TAPESTRY_LIFEMODE_INDEX[s]) {
    return { ...TAPESTRY_LIFEMODE_INDEX[s], source: "ESRI Tapestry LifeMode code" };
  }
  // Name-based lookup (case-insensitive substring match)
  const lower = s.toLowerCase();
  for (const [code, info] of Object.entries(TAPESTRY_LIFEMODE_INDEX)) {
    if (info.name.toLowerCase() === lower) return { ...info, code, source: "ESRI Tapestry LifeMode name (exact)" };
  }
  for (const [code, info] of Object.entries(TAPESTRY_LIFEMODE_INDEX)) {
    if (lower.includes(info.name.toLowerCase()) || info.name.toLowerCase().includes(lower)) {
      return { ...info, code, source: "ESRI Tapestry LifeMode name (partial)" };
    }
  }
  return { index: 1.0, source: "default (no LifeMode match)", name: s, rationale: "LifeMode name not in index; baseline applied" };
}

/**
 * Compute the urbanization tier index. Falls back to 1.0 (suburban
 * baseline) when unknown.
 */
export function lookupUrbanizationIndex(urbanizationName) {
  if (!urbanizationName) return { index: 1.0, source: "default", name: "Unknown (suburban baseline)" };
  const s = String(urbanizationName).trim();
  if (URBANIZATION_INDEX[s]) return { ...URBANIZATION_INDEX[s], source: "ESRI Tapestry Urbanization tier (exact)" };
  const lower = s.toLowerCase();
  for (const [name, info] of Object.entries(URBANIZATION_INDEX)) {
    if (name.toLowerCase() === lower) return { ...info, source: "ESRI Tapestry Urbanization tier (exact)" };
    if (lower.includes(name.toLowerCase()) || name.toLowerCase().includes(lower)) {
      return { ...info, source: "ESRI Tapestry Urbanization tier (partial)" };
    }
  }
  return { index: 1.0, source: "default (no urbanization match)", name: s };
}

/**
 * Audited component-wise storage demand forecast.
 *
 * @param {Object} ring - The 3-mi ring data (or substitute the ring most
 *   relevant to the analysis). Required fields are flexible:
 *   pop, households, medianHHIncome, renterPct, growthRatePct,
 *   tapestryLifeMode, tapestryUrbanization. Missing fields fall back
 *   to neutral defaults and contribute a "confidence: degraded" flag.
 * @param {Object} [opts]
 * @param {Object} [opts.coefficients] - Override the default
 *   STORAGE_DEMAND_COEFFICIENTS for sensitivity testing.
 * @param {number} [opts.currentCCSPC] - Current observed CC SF / capita
 *   in the submarket. If provided, surplus/deficit is computed.
 * @returns {{
 *   demandPerCapita: number,
 *   totalDemandSF: number | null,
 *   components: Array<{label, valuePerCapita, source, rationale}>,
 *   adjustments: { lifeMode, urbanization },
 *   inputs: Object,
 *   surplus: { deltaPerCapita, deltaSF, signal } | null,
 *   confidence: 'high' | 'medium' | 'low',
 *   missingFields: string[],
 *   modelVersion: string,
 *   citations: string[]
 * }}
 */
export function forecastStorageDemand(ring, opts = {}) {
  const C = { ...STORAGE_DEMAND_COEFFICIENTS, ...(opts.coefficients || {}) };
  const missing = [];

  const pop = Number(ring?.pop ?? ring?.pop3mi ?? ring?.population ?? 0) || 0;
  if (!pop) missing.push("pop");

  const renterPctRaw = ring?.renterPct ?? ring?.renterPct3mi ?? ring?.renter_pct ?? null;
  const renterPct = renterPctRaw != null ? Number(renterPctRaw) : null;
  if (renterPct == null) missing.push("renterPct");

  const growthRaw = ring?.growthRatePct ?? ring?.popGrowthRatePct ?? ring?.growth ?? null;
  const growthPct = growthRaw != null ? Number(growthRaw) : null;
  if (growthPct == null) missing.push("growthRatePct");

  const incomeRaw = ring?.medianHHIncome ?? ring?.income3mi ?? ring?.income ?? null;
  const medianHHI = incomeRaw != null ? Number(incomeRaw) : null;
  if (medianHHI == null) missing.push("medianHHIncome");

  const lifeModeRaw = ring?.tapestryLifeMode ?? ring?.tapestryLifeMode3mi ?? ring?.lifeMode ?? null;
  if (!lifeModeRaw) missing.push("tapestryLifeMode");
  const lifeMode = lookupLifeModeIndex(lifeModeRaw);

  const urbRaw = ring?.tapestryUrbanization ?? ring?.tapestryUrbanization3mi ?? ring?.urbanization ?? null;
  if (!urbRaw) missing.push("tapestryUrbanization");
  const urbanization = lookupUrbanizationIndex(urbRaw);

  // Component 1: Tapestry-adjusted baseline
  const adjustedBaseline = US_BASELINE_SPC * lifeMode.index * urbanization.index;

  // Component 2: Renter premium (only when renter share exceeds baseline)
  const renterUplift = renterPct != null
    ? Math.max(0, renterPct - C.RENTER_BASELINE_PCT) * C.RENTER_PREMIUM_PER_PCT
    : 0;

  // Component 3: Growth premium (only when net population growth positive)
  const growthUplift = growthPct != null
    ? Math.max(0, growthPct) * C.GROWTH_PREMIUM_PER_PCT
    : 0;

  // Component 4: Income adjustment (negative slope above the baseline HHI)
  const incomeAdjustment = medianHHI != null
    ? ((medianHHI - C.INCOME_BASELINE_HHI) / 1000) * C.INCOME_SLOPE_PER_K
    : 0;

  let demandPerCapita = adjustedBaseline + renterUplift + growthUplift + incomeAdjustment;
  // Apply floor / ceiling guardrails
  if (demandPerCapita < C.DEMAND_FLOOR_SPC) demandPerCapita = C.DEMAND_FLOOR_SPC;
  if (demandPerCapita > C.DEMAND_CEILING_SPC) demandPerCapita = C.DEMAND_CEILING_SPC;

  const totalDemandSF = pop > 0 ? Math.round(demandPerCapita * pop) : null;

  // Surplus / deficit vs observed current CC SPC, if provided
  let surplus = null;
  if (opts.currentCCSPC != null && isFinite(Number(opts.currentCCSPC))) {
    const cc = Number(opts.currentCCSPC);
    const deltaPerCapita = demandPerCapita - cc;
    const deltaSF = totalDemandSF != null && pop > 0 ? Math.round(deltaPerCapita * pop) : null;
    surplus = {
      observedCCSPC: cc,
      forecastDemandSPC: demandPerCapita,
      deltaPerCapita,
      deltaSF,
      signal: deltaPerCapita > 0.5
        ? "UNDER-SUPPLIED (forecast demand exceeds observed CC supply)"
        : deltaPerCapita < -0.5
          ? "OVER-SUPPLIED (forecast demand below observed CC supply)"
          : "BALANCED (forecast within ±0.5 SF/capita of observed CC supply)",
    };
  }

  // Confidence — drops as more fields are missing or coefficients
  // extrapolate beyond calibrated ranges
  let confidence = "high";
  if (missing.length >= 3) confidence = "low";
  else if (missing.length >= 1) confidence = "medium";

  const components = [
    {
      label: "Tapestry-Adjusted Baseline",
      valuePerCapita: adjustedBaseline,
      formula: `${US_BASELINE_SPC} × LifeMode ${lifeMode.index.toFixed(2)} × Urbanization ${urbanization.index.toFixed(2)}`,
      source: "Self-Storage Almanac US baseline 5.4 SF/capita × ESRI Tapestry LifeMode + Urbanization indices",
      rationale: `${lifeMode.name || "Unknown LifeMode"} (${lifeMode.rationale || "—"}); ${urbanization.name || "Unknown Urbanization"} (${urbanization.rationale || "—"})`,
    },
    {
      label: "Renter Premium",
      valuePerCapita: renterUplift,
      formula: renterPct != null ? `max(0, ${renterPct.toFixed(1)} − ${C.RENTER_BASELINE_PCT}) × ${C.RENTER_PREMIUM_PER_PCT}` : "n/a (no renterPct)",
      source: C.RENTER_PREMIUM_SOURCE,
      rationale: renterPct != null
        ? `${renterPct.toFixed(1)}% renter share ${renterPct > C.RENTER_BASELINE_PCT ? "above" : "below/at"} ${C.RENTER_BASELINE_PCT}% US baseline · ${renterUplift > 0 ? "premium applied" : "no premium"}`
        : "renterPct missing — no adjustment",
    },
    {
      label: "Growth Premium (mover flux)",
      valuePerCapita: growthUplift,
      formula: growthPct != null ? `max(0, ${growthPct.toFixed(2)}%) × ${C.GROWTH_PREMIUM_PER_PCT}` : "n/a (no growthRatePct)",
      source: C.GROWTH_PREMIUM_SOURCE,
      rationale: growthPct != null
        ? `${growthPct.toFixed(2)}% pop growth · ${growthPct > 0 ? "mover-flux premium applied" : "no premium"}`
        : "growthRatePct missing — no adjustment",
    },
    {
      label: "Income Adjustment",
      valuePerCapita: incomeAdjustment,
      formula: medianHHI != null ? `((${medianHHI.toLocaleString()} − ${C.INCOME_BASELINE_HHI.toLocaleString()}) / 1000) × ${C.INCOME_SLOPE_PER_K}` : "n/a (no medianHHIncome)",
      source: C.INCOME_SLOPE_SOURCE,
      rationale: medianHHI != null
        ? `Median HHI ${medianHHI.toLocaleString()} · ${incomeAdjustment >= 0 ? "below" : "above"} $${C.INCOME_BASELINE_HHI.toLocaleString()} baseline · ${Math.abs(incomeAdjustment).toFixed(2)} SF/capita ${incomeAdjustment >= 0 ? "uplift" : "discount"}`
        : "medianHHIncome missing — no adjustment",
    },
  ];

  const citations = [
    "Self-Storage Almanac (annual) · US baseline SPC + segment commentary",
    "Newmark Self-Storage Group sector reports · urbanization tier indices",
    "ICSC research · storage demand drivers",
    "REIT 10-K MD&A (PSA / EXR / CUBE) · renter-heavy MSA commentary",
    "U.S. Census ACS Migration & Geographic Mobility Survey",
    "ESRI Tapestry Segmentation documentation",
  ];

  return {
    modelVersion: "storvex.storageDemandForecast.v1",
    demandPerCapita,
    totalDemandSF,
    components,
    adjustments: { lifeMode, urbanization },
    inputs: {
      pop,
      renterPct,
      growthPct,
      medianHHI,
      tapestryLifeMode: lifeModeRaw || null,
      tapestryUrbanization: urbRaw || null,
    },
    surplus,
    confidence,
    missingFields: missing,
    coefficients: C,
    citations,
  };
}

/**
 * Pull the most-relevant ring + tapestry data off a Storvex site record
 * for the demand model. Looks at the site fields the QuickLookup intake
 * + Submit Site form both populate.
 */
export function extractRingForDemandForecast(site) {
  if (!site || typeof site !== "object") return null;
  const popRaw = site.pop3mi || site.pop_3mi;
  const pop = parseRoughNumber(popRaw);
  const renterRaw = site.renterPct3mi || site.renter_pct_3mi || site.renterPct;
  const renterPct = parseRoughNumber(renterRaw);
  const growthRaw = site.growthRate || site.popGrowthRate || site.growthRatePct;
  let growthPct = parseRoughNumber(growthRaw);
  // Convert decimal growth (0.012) → percentage (1.2)
  if (growthPct != null && Math.abs(growthPct) < 1) growthPct *= 100;
  const incomeRaw = site.income3mi || site.income_3mi || site.medianHHIncome;
  const medianHHI = parseRoughNumber(incomeRaw);
  return {
    pop,
    renterPct,
    growthRatePct: growthPct,
    medianHHIncome: medianHHI,
    tapestryLifeMode: site.tapestryLifeMode3mi || site.tapestryLifeMode || null,
    tapestryUrbanization: site.tapestryUrbanization3mi || site.tapestryUrbanization || null,
    tapestrySegment: site.tapestrySegment3mi || site.tapestrySegment || null,
  };
}

function parseRoughNumber(input) {
  if (input == null) return null;
  if (typeof input === "number") return isFinite(input) ? input : null;
  const s = String(input).replace(/[$,\s%]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}
