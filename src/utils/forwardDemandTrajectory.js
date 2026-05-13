// ═══════════════════════════════════════════════════════════════════════════
// FORWARD DEMAND TRAJECTORY ENGINE — CLAIM 11
//
// Projects per-submarket forward storage demand year-by-year over a
// configurable horizon (default 60 months / 5 years) by applying ESRI 2030
// population + income projections through the Audited Storage Demand
// Forecast model (Tapestry LifeMode × Urbanization × renter × growth ×
// income).
//
// Today's storageDemandForecast.mjs is a STATIC snapshot — population +
// income + renter share + growth rate all evaluated at Y0 for a single
// demand-per-capita output. ESRI ships 5-year projections on every
// enrichment call (TOTPOP_FY · TOTHH_FY · MEDHINC_FY → pop3mi_fy /
// income3mi_fy / popGrowth3mi / incomeGrowth3mi on the site record). This
// engine compounds the demand model forward year-by-year so the audit-trail
// surfaces a per-year demand path — not just "today's number" but "today,
// Y1, Y2, Y3, Y4, Y5".
//
// THIS CLOSES THE LAST STATIC-SNAPSHOT GAP across the four most-used
// CRE-intel categories (rents · projected rents · construction pipeline ·
// demos). Pair with CLAIM 7 (forward supply) and CLAIM 9 (forward rents)
// and the THREE pillars all forecast year-by-year. Then CLAIM 12
// (Equilibrium Trajectory) composes all three into a single per-year
// ratio path — the institutional 5-year view incumbent platforms do not
// ship.
//
// SYSTEM CLAIM (patent) — Method for forecasting forward commercial-real-
// estate demand year-by-year from primary-source demographic projection
// data applied through a component-wise audited demand model:
//
//   (a) ingesting primary-source 5-year demographic projection data for
//       the queried submarket (ESRI ArcGIS GeoEnrichment Current Year +
//       Forecast Year — e.g., TOTPOP_CY, TOTPOP_FY, MEDHINC_CY,
//       MEDHINC_FY) along with associated 5-year compound annual growth
//       rates (popGrowth, hhGrowth, incomeGrowth);
//
//   (b) for each integer year Y in [0, horizonYears]:
//          popY = pop_CY × (1 + popGrowth)^Y
//          HHIY = HHI_CY × (1 + incomeGrowth)^Y
//          renterPctY = renterPct_CY (held constant; structural)
//          growthRatePctY = popGrowth × 100 (forward CAGR persists)
//
//   (c) applying the component-wise audited demand model
//       (CLAIM-anchored Tapestry LifeMode × Urbanization × renter premium
//       × growth premium × income slope) to each year's interpolated
//       ring inputs, yielding per-year demandPerCapitaY and
//       totalDemandSfY;
//
//   (d) emitting a per-year audit-trail object exposing the interpolated
//       inputs and the demand-model components for each year, so the
//       consumer can re-derive every digit from the listed public sources
//       (Self-Storage Almanac, Newmark, REIT MD&A, Census ACS, ESRI
//       Tapestry, ESRI GeoEnrichment 2025+2030);
//
//   (e) computing summary statistics including effective demand CAGR,
//       final-year demand SF, percent demand growth over the horizon,
//       and a confidence tier reflecting which inputs were primary-source
//       and which fell back to interpolation defaults.
//
// Together with CLAIMS 7 / 8 / 9 / 10, this engine forms the demand axis
// of the THREE-AXIS FORWARD-STATE UNDERWRITE SURFACE that no aggregator
// platform (Radius+ · TractIQ · StorTrack · Yardi Matrix) ships. The
// ensuing CLAIM 12 (Equilibrium Trajectory) composes forward supply with
// forward demand year-by-year for the single composite trajectory every
// storage operator wants but no incumbent produces.
//
// Filed under DJR Real Estate LLC. Drafted 5/13/26 AM as part of the
// supplemental provisional addendum to USPTO #64/062,607.
// ═══════════════════════════════════════════════════════════════════════════

import {
  forecastStorageDemand,
  extractRingForDemandForecast,
} from "./storageDemandForecast.mjs";

// ─── Configurable defaults ───────────────────────────────────────────────

export const DEFAULT_HORIZON_MONTHS = 60;

// Decay factor applied to the forward CAGRs after Y5. ESRI projects out
// 5 years; assuming the same CAGR continues past Y5 over-extrapolates. We
// hold the CAGR steady through Y5 and decay it by this factor per year
// beyond Y5 to converge toward zero. Default: full CAGR for Y1..Y5, then
// 50% of CAGR for Y6+ (matters only for horizons > 60 months).
export const POST_5YR_CAGR_DECAY = 0.5;

// Renter share — long-term structural. Hold constant unless the caller
// supplies a forward renter projection.
export const RENTER_HOLD_STEADY = true;

// ─── Helpers ─────────────────────────────────────────────────────────────

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Normalize an input growth value. Accepts 0.012 (decimal CAGR), 1.2
 * (percent CAGR), or null. Returns a decimal CAGR or null.
 */
function normalizeGrowth(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // If absolute value < 1, assume decimal already (e.g., 0.018). Otherwise
  // treat as percent (e.g., 1.8) and divide by 100.
  return Math.abs(n) < 1 ? n : n / 100;
}

/**
 * Compute the year-Y CAGR-adjusted scalar. For years 1..5, returns
 * (1 + cagr)^Y. For years 6+, the CAGR decays by POST_5YR_CAGR_DECAY per
 * year past 5 to avoid over-extrapolation past ESRI's projection window.
 */
function compoundedScalar(cagr, year) {
  if (year === 0) return 1;
  if (cagr == null || !Number.isFinite(cagr)) return 1;
  if (year <= 5) return Math.pow(1 + cagr, year);
  // Years past 5: apply 5 full years, then decayed CAGR thereafter
  let scalar = Math.pow(1 + cagr, 5);
  let decayedCagr = cagr * POST_5YR_CAGR_DECAY;
  for (let y = 6; y <= year; y++) {
    scalar *= 1 + decayedCagr;
  }
  return scalar;
}

/**
 * Resolve a Y0 ring from either an explicit ring or a site-record blob.
 * Returns null when no usable pop is available.
 */
function resolveY0Ring(ring) {
  if (!ring || typeof ring !== "object") return null;
  // If the input looks like a site record, run it through the extractor.
  if (ring.pop3mi != null || ring.pop_3mi != null) {
    const extracted = extractRingForDemandForecast(ring);
    return { ...extracted, _raw: ring };
  }
  return { ...ring, _raw: ring };
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Compute the forward demand trajectory for a submarket.
 *
 * @param {Object} query
 * @param {string} [query.city]                e.g., "Houston"
 * @param {string} [query.state]               e.g., "TX"
 * @param {string} [query.msa]                 preferred when known
 * @param {Object} query.ring                  Y0 demographic ring. Required fields:
 *                                             pop, renterPct, growthRatePct,
 *                                             medianHHIncome, tapestryLifeMode,
 *                                             tapestryUrbanization. Optional forward
 *                                             fields: popGrowth, popFy,
 *                                             incomeGrowth, incomeFy.
 * @param {number} [query.horizonMonths=60]
 * @param {Date}   [query.asOf=now]
 * @param {Object} [query.coefficients]        Override storageDemandForecast coefficients
 * @param {Object} [query.growthOverrides]     Override growth rates: { pop, income }
 *
 * @returns {{
 *   submarket: { city, state, msa },
 *   horizonMonths: number,
 *   asOf: string,
 *   baseline: {
 *     popY0: number, medianHHIY0: number, renterPctY0: number,
 *     popCAGR: number, incomeCAGR: number, growthSource: string,
 *     tapestryLifeMode: string, tapestryUrbanization: string
 *   },
 *   path: Array<{
 *     yearIndex: number, year: number,
 *     popY: number, medianHHIY: number, renterPctY: number,
 *     demandPerCapita: number, totalDemandSf: number,
 *     deltaSfVsY0: number, deltaPctVsY0: number,
 *     forecastSnapshot: Object
 *   }>,
 *   summary: {
 *     y0DemandPerCapita: number, y0TotalDemandSf: number,
 *     finalYearDemandPerCapita: number, finalYearTotalDemandSf: number,
 *     totalDemandGainPct: number, effectiveDemandCAGR: number,
 *     finalYear: number
 *   } | null,
 *   confidence: 'high' | 'medium' | 'low',
 *   missing: string[],
 *   modelVersion: string,
 *   citations: string[]
 * }}
 */
export function computeForwardDemandTrajectory(query = {}) {
  const {
    city = null,
    state = null,
    msa = null,
    ring: rawRing = null,
    horizonMonths = DEFAULT_HORIZON_MONTHS,
    asOf = new Date(),
    coefficients = undefined,
    growthOverrides = {},
  } = query;

  const missing = [];
  const horizonYears = Math.max(1, Math.round(horizonMonths / 12));

  const ringY0 = resolveY0Ring(rawRing);
  if (!ringY0 || !ringY0.pop) {
    return {
      submarket: { city, state, msa },
      horizonMonths,
      asOf: asOf instanceof Date ? asOf.toISOString() : new Date(asOf).toISOString(),
      baseline: null,
      path: [],
      summary: null,
      confidence: "low",
      missing: ["ring", "pop"],
      modelVersion: "storvex.forwardDemandTrajectory.v1",
      citations: [],
    };
  }

  // ── Pull / normalize forward CAGRs ────────────────────────────────────
  const raw = ringY0._raw || {};

  let popCAGR =
    growthOverrides.pop != null
      ? normalizeGrowth(growthOverrides.pop)
      : normalizeGrowth(raw.popGrowth3mi ?? raw.popGrowth ?? ringY0.growthRatePct ?? null);
  if (popCAGR == null && ringY0.growthRatePct != null) {
    // growthRatePct on the Y0 ring is in percent — convert to decimal
    popCAGR = Number(ringY0.growthRatePct) / 100;
    if (!Number.isFinite(popCAGR)) popCAGR = null;
  }

  // If we have a Y0 pop + projected FY pop, derive the CAGR directly
  const popFy = Number(raw.pop3mi_fy ?? raw.popFy ?? null);
  if ((popCAGR == null || !Number.isFinite(popCAGR)) && popFy > 0 && ringY0.pop > 0) {
    popCAGR = Math.pow(popFy / ringY0.pop, 1 / 5) - 1;
  }

  let incomeCAGR =
    growthOverrides.income != null
      ? normalizeGrowth(growthOverrides.income)
      : normalizeGrowth(raw.incomeGrowth3mi ?? raw.incomeGrowth ?? null);
  const incomeFy = Number(raw.income3mi_fy ?? raw.incomeFy ?? null);
  if ((incomeCAGR == null || !Number.isFinite(incomeCAGR)) && incomeFy > 0 && ringY0.medianHHIncome > 0) {
    incomeCAGR = Math.pow(incomeFy / ringY0.medianHHIncome, 1 / 5) - 1;
  }

  // Clamp extreme CAGRs to plausible bounds (-5%/yr to +10%/yr)
  if (popCAGR != null) popCAGR = clamp(popCAGR, -0.05, 0.10);
  if (incomeCAGR != null) incomeCAGR = clamp(incomeCAGR, -0.05, 0.15);

  if (popCAGR == null) {
    missing.push("popCAGR");
    popCAGR = 0; // hold steady
  }
  if (incomeCAGR == null) {
    missing.push("incomeCAGR");
    incomeCAGR = 0;
  }

  const growthSource =
    raw.popGrowth3mi != null
      ? `ESRI ArcGIS GeoEnrichment 2025 (TOTPOP_CY → TOTPOP_FY 5-yr CAGR)${raw.incomeGrowth3mi != null ? " · MEDHINC_CY → MEDHINC_FY 5-yr CAGR" : ""}`
      : popFy > 0
        ? `Derived from ESRI TOTPOP_FY ÷ TOTPOP_CY ^ (1/5) − 1`
        : ringY0.growthRatePct != null
          ? `Y0 ring growthRatePct held forward (no ESRI projection on record)`
          : `No primary-source growth data — held steady at 0%`;

  // ── Build year-by-year path ──────────────────────────────────────────
  const baseYear = (asOf instanceof Date ? asOf : new Date(asOf)).getFullYear();

  const path = [];
  let y0DemandPerCapita = null;
  let y0TotalDemandSf = null;

  for (let y = 0; y <= horizonYears; y++) {
    const popScalar = compoundedScalar(popCAGR, y);
    const incomeScalar = compoundedScalar(incomeCAGR, y);
    const popY = Math.round(ringY0.pop * popScalar);
    const medianHHIY = Math.round((ringY0.medianHHIncome || 0) * incomeScalar);
    const renterPctY = RENTER_HOLD_STEADY ? ringY0.renterPct : ringY0.renterPct;
    const growthRateForwardPct = (popCAGR || 0) * 100;

    const ringY = {
      pop: popY,
      renterPct: renterPctY,
      growthRatePct: growthRateForwardPct,
      medianHHIncome: medianHHIY,
      tapestryLifeMode: ringY0.tapestryLifeMode,
      tapestryUrbanization: ringY0.tapestryUrbanization,
    };

    const forecast = forecastStorageDemand(ringY, { coefficients });
    const demandPerCapita = forecast.demandPerCapita;
    const totalDemandSf = forecast.totalDemandSF;

    if (y === 0) {
      y0DemandPerCapita = demandPerCapita;
      y0TotalDemandSf = totalDemandSf;
    }

    const deltaSfVsY0 = y0TotalDemandSf != null && totalDemandSf != null ? totalDemandSf - y0TotalDemandSf : 0;
    const deltaPctVsY0 = y0TotalDemandSf != null && y0TotalDemandSf > 0 && totalDemandSf != null
      ? ((totalDemandSf / y0TotalDemandSf) - 1) * 100
      : 0;

    path.push({
      yearIndex: y,
      year: baseYear + y,
      popY,
      medianHHIY,
      renterPctY,
      demandPerCapita,
      totalDemandSf,
      deltaSfVsY0,
      deltaPctVsY0,
      forecastSnapshot: {
        confidence: forecast.confidence,
        components: forecast.components,
      },
    });
  }

  // ── Summary stats ─────────────────────────────────────────────────────
  const finalRow = path[path.length - 1] || null;
  const summary =
    finalRow && y0TotalDemandSf != null && y0TotalDemandSf > 0
      ? {
          y0DemandPerCapita,
          y0TotalDemandSf,
          finalYearDemandPerCapita: finalRow.demandPerCapita,
          finalYearTotalDemandSf: finalRow.totalDemandSf,
          totalDemandGainPct: ((finalRow.totalDemandSf / y0TotalDemandSf) - 1) * 100,
          // Effective demand CAGR derived from Y0 → final-year demand SF
          effectiveDemandCAGR: horizonYears > 0
            ? Math.pow(finalRow.totalDemandSf / y0TotalDemandSf, 1 / horizonYears) - 1
            : 0,
          finalYear: finalRow.year,
        }
      : null;

  // ── Confidence ────────────────────────────────────────────────────────
  // high   — both popCAGR and incomeCAGR derived from primary source (ESRI)
  //          AND Tapestry LifeMode/Urbanization populated
  // medium — at least one ESRI-derived CAGR; some Tapestry data
  // low    — no ESRI projection on record (CAGR held steady or imputed)
  let confidence = "low";
  const haveEsriPop = raw.popGrowth3mi != null || popFy > 0;
  const haveEsriIncome = raw.incomeGrowth3mi != null || incomeFy > 0;
  const haveTapestry = !!(ringY0.tapestryLifeMode || ringY0.tapestryUrbanization);
  if (haveEsriPop && haveEsriIncome && haveTapestry) confidence = "high";
  else if ((haveEsriPop || haveEsriIncome) && haveTapestry) confidence = "medium";
  else if (haveEsriPop || haveEsriIncome) confidence = "medium";

  const citations = [
    "ESRI ArcGIS GeoEnrichment 2025 · Current Year + Forecast Year (5-yr CAGR)",
    "Self-Storage Almanac (annual) · US baseline SPC",
    "Newmark Self-Storage Group sector reports · urbanization tier indices",
    "REIT 10-K MD&A (PSA / EXR / CUBE) · renter-heavy MSA commentary",
    "U.S. Census ACS Migration & Geographic Mobility Survey",
    "ESRI Tapestry Segmentation documentation · LifeMode + Urbanization tiers",
  ];

  return {
    submarket: { city, state, msa },
    horizonMonths,
    asOf: asOf instanceof Date ? asOf.toISOString() : new Date(asOf).toISOString(),
    baseline: {
      popY0: ringY0.pop,
      medianHHIY0: ringY0.medianHHIncome || null,
      renterPctY0: ringY0.renterPct ?? null,
      popCAGR,
      incomeCAGR,
      growthSource,
      tapestryLifeMode: ringY0.tapestryLifeMode || null,
      tapestryUrbanization: ringY0.tapestryUrbanization || null,
    },
    path,
    summary,
    confidence,
    missing,
    modelVersion: "storvex.forwardDemandTrajectory.v1",
    citations,
  };
}

/**
 * Render a one-paragraph English summary. Used in REC Package generation
 * and the Sentinel daily brief.
 */
export function describeForwardDemandTrajectory(result) {
  if (!result || !result.summary) {
    return (
      `Forward Demand Trajectory unavailable — insufficient input data` +
      (result?.missing?.length ? ` (${result.missing.join(", ")})` : "") +
      "."
    );
  }
  const sm = result.submarket;
  const smLabel = sm.msa || `${sm.city || "?"}, ${sm.state || "?"}`;
  const s = result.summary;
  const b = result.baseline;
  const pct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  const k = (v) => Math.round((v || 0) / 1000).toLocaleString();
  return (
    `Forward Demand Trajectory for ${smLabel} (Y0→FY${s.finalYear}, ${result.horizonMonths}-month horizon): ` +
    `${k(s.y0TotalDemandSf)}K CC SF today → ${k(s.finalYearTotalDemandSf)}K CC SF by FY${s.finalYear} ` +
    `(net ${pct(s.totalDemandGainPct)}, effective demand CAGR ${pct(s.effectiveDemandCAGR * 100)}/yr). ` +
    `Drivers: pop CAGR ${pct((b.popCAGR || 0) * 100)}/yr, income CAGR ${pct((b.incomeCAGR || 0) * 100)}/yr, ` +
    `Tapestry ${b.tapestryLifeMode || "—"}/${b.tapestryUrbanization || "—"}. ` +
    `Confidence: ${result.confidence.toUpperCase()}.`
  );
}

export default computeForwardDemandTrajectory;
