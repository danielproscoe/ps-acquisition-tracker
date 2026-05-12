import {
  resolveCityToMSA,
  getHistoricalMSARentSeries,
  getHistoricalSameStoreSeries,
  getCrossREITHistoricalLatest,
  getEdgarPipelineMetadata,
  getAllEdgarPipelineDisclosures,
  getAllEdgarPipelineFacilities,
  getEdgarPipelineTotalDollars,
} from "./data/edgarCompIndex";
import {
  forecastStorageDemand,
  extractRingForDemandForecast,
} from "./utils/storageDemandForecast.mjs";

// warehouseExport.js — Push Storvex Asset Analyzer outputs to PSA's data warehouse.
//
// Outputs a structured JSON payload in a PSA-likely warehouse schema. Every
// Storvex field flows through with provenance + audit trail so Reza
// Mahdavian's team (PSA Finance + RE Applications) can ingest directly into
// the Welltower model layer or PSA's internal data lake.
//
// Schema: storvex.asset-analyzer.v1
//   - Subject (property identity)
//   - Physical (NRSF, units, year built, occupancy, mix)
//   - Financial (ask, T12, pro forma)
//   - Broker (listing source, contact)
//   - PSA Underwrite (verdict + every PSA-Lens output)
//   - Enrichment (auto-pulled ESRI demographics, PS family proximity, market rents)
//   - Extraction (OM source, confidence, engine, timestamp)
//   - Audit (data sources, framework versions, citations)
//
// This is the Welltower-feeder integration made literal — the button
// Reza sees and immediately recognizes as "production-grade structured
// records ready for ingestion."

const SCHEMA_VERSION = "storvex.asset-analyzer.v1";
const ANALYZER_VERSION = "v2";
const VALUATION_FRAMEWORK_VERSION = "v2";
const PS_LENS_VERSION = "PSA FY2025 10-K (FYE 2025-12-31)";

/**
 * Build a warehouse-ready JSON payload from a Storvex Asset Analyzer run.
 *
 * @param {Object} args
 * @param {Object} args.analysis        — analyzeExistingAsset() output (generic buyer-lens)
 * @param {Object} args.psLens          — computeBuyerLens(input, PS_LENS) output
 * @param {Object} [args.enrichment]    — analyzerEnrich.enrichAssetAnalysis() output
 * @param {Object} [args.extractionMeta] — { confidence, notes, model, elapsedMs, filename, tokenUsage }
 * @param {Object} [args.memo]          — IC memo (if generated)
 * @param {string} [args.dealId]        — deal ID (Firebase key); auto-generated if absent
 * @returns {Object} warehouse payload
 */
export function buildWarehousePayload({ analysis, psLens, enrichment, extractionMeta, memo, dealId, multiLensRows, platformFitDelta, pitchTarget }) {
  if (!analysis || !analysis.snapshot) {
    throw new Error("analysis with snapshot required");
  }

  const s = analysis.snapshot;
  const ps = psLens || null;
  const e = enrichment || null;

  const generatedAt = new Date().toISOString();
  const id = dealId || generateDealId(s);

  return {
    schema: SCHEMA_VERSION,
    deal_id: id,
    generated_at: generatedAt,
    analyzer_version: ANALYZER_VERSION,

    subject: {
      name: s.name || null,
      address: s.address || null,
      city: s.city || null,
      state: s.state || null,
      msa_tier: analysis.msaTier || null,
      deal_type: analysis.dealType || null,
      coordinates: e?.coords ? { lat: e.coords.lat, lng: e.coords.lng } : null,
    },

    physical: {
      nrsf: numOrNull(s.nrsf),
      unit_count: numOrNull(s.unitCount),
      year_built: numOrNull(s.yearBuilt),
      physical_occupancy: numOrNull(s.physicalOcc),
      economic_occupancy: numOrNull(s.economicOcc),
      cc_pct: numOrNull(analysis.snapshot.ccPct ?? null),
      is_manned: analysis.snapshot.isManned ?? null,
    },

    financial: {
      ask_price: numOrNull(s.ask),
      cap_on_ask: numOrNull(s.capOnAsk),
      price_per_sf: numOrNull(s.pricePerSF),
      price_per_unit: numOrNull(s.pricePerUnit),
      seller_t12_egi: numOrNull(s.sellerEGI),
      seller_t12_noi: numOrNull(s.sellerNOI),
      pro_forma_egi: numOrNull(s.proFormaEGI),
      pro_forma_noi: numOrNull(s.proFormaNOI),
      doa_flag: s.doaFlag || false,
      doa_reason: s.doaReason || null,
    },

    psa_underwrite: ps ? {
      verdict: ps.verdict?.label || null,
      verdict_rationale: ps.verdict?.rationale || null,
      gap_dollars: numOrNull(ps.verdict?.gapDollars),
      gap_pct: numOrNull(ps.verdict?.gapPct),

      // Selected buyer lens — drives all psa_underwrite math below.
      // (Field names retain the "psa_*" prefix for backwards-compat with
      // existing PS-tracker consumers; lens_key tells you which buyer's
      // profile actually drove the numbers — PS / EXR / CUBE / SMA / GENERIC.)
      lens_key: ps.lens?.key || null,
      lens_name: ps.lens?.name || null,
      lens_ticker: ps.lens?.ticker || null,
      lens_dev_yoc_target: numOrNull(ps.lens?.devYOCTarget),
      lens_acq_cap_top30: numOrNull(ps.lens?.acqCapByMSATier?.top30),
      lens_acq_cap_secondary: numOrNull(ps.lens?.acqCapByMSATier?.secondary),
      lens_acq_cap_tertiary: numOrNull(ps.lens?.acqCapByMSATier?.tertiary),
      lens_same_store_noi_margin: numOrNull(ps.lens?.sameStoreNOIMargin),
      lens_avg_occupancy: numOrNull(ps.lens?.avgOccupancy),
      lens_ecri_premium: numOrNull(ps.lens?.ecriPremium),
      lens_realized_rent_per_occ_sf: numOrNull(ps.lens?.realizedRentPerOccSF),
      lens_move_in_rate_per_occ_sf: numOrNull(ps.lens?.moveInRatePerOccSF),
      lens_citation_footnote: ps.lens?.citationFootnote || null,

      // YOC verdict — deal stabilized cap vs lens hurdle. Computed live;
      // mirrors the YOCVerdictCard on the dashboard.
      yoc_verdict: (() => {
        const ask = ps.snapshot?.ask;
        const y3NOI = ps.projection?.y3?.noi;
        const target = ps.marketCap;
        if (!ask || !y3NOI || !target || ask <= 0 || y3NOI <= 0 || target <= 0) return null;
        const dealStabCap = y3NOI / ask;
        const bps = Math.round((dealStabCap - target) * 10000);
        const label = bps >= 50 ? "HURDLE_CLEARED" : bps >= -25 ? "AT_HURDLE" : "MISSES_HURDLE";
        return {
          deal_stab_cap: Math.round(dealStabCap * 100000) / 100000,
          lens_target_cap: Math.round(target * 100000) / 100000,
          delta_bps: bps,
          verdict: label,
        };
      })(),

      psa_market_cap: numOrNull(ps.marketCap),
      psa_market_cap_basis: ps.lens?.capBasis || null,
      portfolio_fit: !!ps.lens?.portfolioFit,
      revenue_premium_pct: numOrNull(ps.lens?.revenuePremium),

      reconstructed_egi: numOrNull(ps.reconstructed?.egi),
      reconstructed_total_opex: numOrNull(ps.reconstructed?.totalOpEx),
      reconstructed_buyer_noi: numOrNull(ps.reconstructed?.buyerNOI),
      reconstructed_buyer_cap: numOrNull(ps.reconstructed?.buyerCap),
      reconstructed_opex_ratio: numOrNull(ps.reconstructed?.opexRatio),
      delta_vs_seller_noi: numOrNull(ps.reconstructed?.deltaNOI),
      delta_vs_seller_pct: numOrNull(ps.reconstructed?.deltaPct),
      reconstructed_lines: Array.isArray(ps.reconstructed?.lines) ? ps.reconstructed.lines.map((l) => ({
        line: l.line, amount: numOrNull(l.buyer), basis: l.basis,
      })) : null,
      reconstructed_flags: ps.reconstructed?.flags || [],

      projection: {
        y1: yearOrNull(ps.projection?.y1),
        y3: yearOrNull(ps.projection?.y3),
        y5: yearOrNull(ps.projection?.y5),
        basis: ps.projection?.assumptions?.basis || null,
      },

      tiers: {
        home_run: tierOrNull(ps.tiers?.homeRun),
        strike: tierOrNull(ps.tiers?.strike),
        walk: tierOrNull(ps.tiers?.walk),
      },
    } : null,

    generic_buyer_underwrite: {
      verdict: analysis.verdict?.label || null,
      market_cap: numOrNull(analysis.marketCap),
      reconstructed_buyer_noi: numOrNull(analysis.reconstructed?.buyerNOI),
      walk: tierOrNull(analysis.tiers?.walk),
      strike: tierOrNull(analysis.tiers?.strike),
      home_run: tierOrNull(analysis.tiers?.homeRun),
      // The platform-fit Δ — what PSA pays above a generic institutional buyer
      psa_premium_over_generic: ps?.tiers?.walk?.price && analysis.tiers?.walk?.price
        ? numOrNull(ps.tiers.walk.price - analysis.tiers.walk.price)
        : null,
    },

    enrichment: e ? {
      coordinates: e.coords ? { lat: e.coords.lat, lng: e.coords.lng, geocoder_score: e.coords.score } : null,
      demographics: e.demographics ? {
        pop_1mi: numOrNull(e.demographics.pop1mi),
        pop_3mi: numOrNull(e.demographics.pop3mi),
        pop_5mi: numOrNull(e.demographics.pop5mi),
        pop_3mi_fy: numOrNull(e.demographics.pop3mi_fy),
        income_1mi: numOrNull(e.demographics.income1mi),
        income_3mi: numOrNull(e.demographics.income3mi),
        income_5mi: numOrNull(e.demographics.income5mi),
        households_3mi: numOrNull(e.demographics.households3mi),
        home_value_3mi: numOrNull(e.demographics.homeValue3mi),
        pop_growth_3mi_5yr_cagr: numOrNull(e.demographics.popGrowth3mi),
        income_growth_3mi_5yr_cagr: numOrNull(e.demographics.incomeGrowth3mi),
        renter_pct_3mi: numOrNull(e.demographics.renterPct3mi),
        median_age_3mi: numOrNull(e.demographics.medianAge3mi),
        unemployment_rate_3mi: numOrNull(e.demographics.unemploymentRate3mi),
        storage_mpi_3mi: numOrNull(e.demographics.storageMPI3mi),
        moved_mpi_3mi: numOrNull(e.demographics.movedMPI3mi),
        source: e.demographics.source || "ESRI ArcGIS GeoEnrichment 2025",
      } : null,
      ps_family: e.psFamily ? {
        nearest_distance_mi: numOrNull(e.psFamily.distanceMi),
        nearest_brand: e.psFamily.brand,
        nearest_name: e.psFamily.name,
        nearest_city: e.psFamily.city,
        nearest_state: e.psFamily.state,
        count_within_35_mi: numOrNull(e.psFamily.count35mi),
        total_facilities_indexed: numOrNull(e.psFamily.totalFacilitiesIndexed),
      } : null,
      market_rents: e.marketRents || null,
      enrichment_errors: e.errors || [],
    } : null,

    sale_comps: {
      state: analysis.comps?.state || null,
      avg_cap_rate: numOrNull(analysis.comps?.avgCap),
      avg_price_psf: numOrNull(analysis.comps?.avgPPSF),
      subject_psf: numOrNull(analysis.comps?.subjectPPSF),
      subject_vs_avg_psf: numOrNull(analysis.comps?.subjectVsAvgPPSF),
      comp_count: analysis.comps?.comps?.length || 0,
      fell_back_to_peer_state: !!analysis.comps?.fellbackToPeer,
    },

    // Independent SpareFoot cross-check on seller's implied effective rent.
    // Null when enrichment hasn't completed at write time.
    rent_sanity: analysis.rentSanity ? {
      implied_rate_psf_mo: numOrNull(analysis.rentSanity.impliedRatePerSF),
      blended_market_rate_psf_mo: numOrNull(analysis.rentSanity.blendedMarketRate),
      cc_market_rate_psf_mo: numOrNull(analysis.rentSanity.ccMarketRate),
      drive_up_market_rate_psf_mo: numOrNull(analysis.rentSanity.driveUpMarketRate),
      premium_pct: numOrNull(analysis.rentSanity.premiumPct),
      severity: analysis.rentSanity.severity || null,
      message: analysis.rentSanity.message || null,
      sample_size: numOrNull(analysis.rentSanity.sampleSize),
      source: analysis.rentSanity.source || "SpareFoot",
    } : null,

    // EDGAR 8-K per-deal transactions — individual M&A comps with full
    // SEC source citations. Empty array when no transactions on file.
    edgar_8k_transactions: Array.isArray(analysis.edgar8KTransactions) ? analysis.edgar8KTransactions
      .filter((t) => t.aggregate_price_million != null)
      .map((t) => ({
        issuer: t.issuer,
        filing_date: t.filingDate,
        accession_number: t.accessionNumber,
        filing_url: t.filingURL,
        deal_type: t.deal_type,
        target_entity: t.target_entity,
        seller: t.seller,
        num_facilities: numOrNull(t.num_facilities),
        nrsf_million: numOrNull(t.nrsf_million),
        aggregate_price_million: numOrNull(t.aggregate_price_million),
        cap_rate_pct: numOrNull(t.cap_rate_pct),
        consideration_type: t.consideration_type,
        is_closed: t.is_closed,
        key_quote: t.keyQuote,
      })) : [],

    // Cross-REIT institutional cost-basis index for the subject's state.
    // Pulled from the SEC EDGAR Schedule III ingestion pipeline. Every
    // contributing REIT cites a specific SEC accession number + filing URL.
    // PSA per-MSA same-store rent time series (FY2021-FY2025+). Ingested
    // directly from PSA's 10-K MD&A "Same Store Facilities Operating Trends
    // by Market" disclosure. Distinct from edgar_cross_reit (which is the
    // state-level Schedule III cost-basis index) and cross_reit_move_in_rates
    // (which is the live per-facility scrape). This is the multi-year
    // PSA-only same-store rent disclosure — uniquely granular at the MSA
    // level among institutional storage REITs.
    //
    // Surfaces only when subject city resolves to a PSA-disclosed MSA (17
    // MSAs with multi-year continuity as of 5/10/26). Null otherwise.
    historical_msa_rent: (() => {
      const city = s.city || s.location?.city;
      const state = s.state || s.location?.state;
      const msa = city ? resolveCityToMSA(city, state) : null;
      if (!msa) return null;
      const series = getHistoricalMSARentSeries(msa, "PSA");
      if (!series || !series.series || series.series.length < 2) return null;
      const last = series.series[series.series.length - 1];
      const prior = series.series.length >= 2 ? series.series[series.series.length - 2] : null;
      const yoy = prior && last && prior.rentPerOccSF > 0
        ? ((last.rentPerOccSF / prior.rentPerOccSF) - 1) * 100
        : null;
      return {
        issuer: series.issuer,
        msa: series.msa,
        first_year: series.firstYear,
        last_year: series.lastYear,
        first_rent_per_occ_sf: numOrNull(series.firstRent),
        last_rent_per_occ_sf: numOrNull(series.lastRent),
        total_change_pct: numOrNull(series.totalChangePct),
        cagr_pct: numOrNull(series.cagrPct),
        years_covered: series.series.length,
        most_recent_year_rent: last?.rentPerOccSF != null ? numOrNull(last.rentPerOccSF) : null,
        prior_year_rent: prior?.rentPerOccSF != null ? numOrNull(prior.rentPerOccSF) : null,
        most_recent_yoy_change_pct: numOrNull(yoy),
        series: series.series.map((p) => ({
          fiscal_year: p.year,
          rent_per_occ_sf: numOrNull(p.rentPerOccSF),
          occupancy: numOrNull(p.occupancy),
          facilities: numOrNull(p.facilities),
          sqft_millions: numOrNull(p.sqftMillions),
        })),
        source: `PSA FY${series.firstYear}-FY${series.lastYear} 10-K MD&A · Same Store Facilities Operating Trends by Market`,
        source_provider: "SEC EDGAR",
        ingestion_pipeline: "scripts/edgar/backfill-historical-msa-rents.mjs",
        schema_version: "storvex.edgar-historical-msa-rents.v1",
      };
    })(),

    // Multi-year portfolio-aggregate same-store time series for non-PSA
    // institutional storage REITs (EXR / CUBE / NSA / LSI). Covers FY2020-
    // FY2025 where disclosed. Distinct from historical_msa_rent (PSA-only,
    // MSA-granular) — these issuers don't disclose per-MSA, so this is the
    // closest backfill for non-PSA buyer lenses. Each metric includes a
    // multi-year series + first/last endpoints + computed CAGR (level
    // metrics only).
    historical_cross_reit_same_store: (() => {
      const latest = getCrossREITHistoricalLatest();
      if (!latest || !latest.contributingIssuers || latest.contributingIssuers.length === 0) {
        return null;
      }
      // Pull the rent-per-SF series for each issuer (the most cite-able
      // headline metric). Other metrics flow when caller wants them.
      const issuerSeries = latest.contributingIssuers.map((iss) => {
        const rentSeries = getHistoricalSameStoreSeries(iss, "sameStoreRentPerSF");
        const occSeries = getHistoricalSameStoreSeries(iss, "sameStoreOccupancyEOP");
        return {
          issuer: iss,
          rent_per_sf: rentSeries
            ? {
                first_year: rentSeries.firstYear,
                last_year: rentSeries.lastYear,
                first_value: numOrNull(rentSeries.firstValue),
                last_value: numOrNull(rentSeries.lastValue),
                cagr_pct: numOrNull(rentSeries.cagrPct),
                data_points: rentSeries.dataPoints,
                series: (rentSeries.series || []).map((p) => ({
                  fiscal_year: p.year,
                  rent_per_occ_sf: numOrNull(p.value),
                })),
              }
            : null,
          occupancy_eop: occSeries
            ? {
                first_year: occSeries.firstYear,
                last_year: occSeries.lastYear,
                first_value: numOrNull(occSeries.firstValue),
                last_value: numOrNull(occSeries.lastValue),
                series: (occSeries.series || []).map((p) => ({
                  fiscal_year: p.year,
                  occupancy: numOrNull(p.value),
                })),
              }
            : null,
        };
      });
      return {
        as_of: latest.asOf,
        cross_reit_avg_rent_per_sf: numOrNull(latest.avgSameStoreRentPerSF),
        cross_reit_avg_occupancy_eop: numOrNull(latest.avgSameStoreOccupancyEOP),
        cross_reit_avg_revenue_growth_yoy: numOrNull(latest.avgSameStoreRevenueGrowthYoY),
        cross_reit_avg_noi_growth_yoy: numOrNull(latest.avgSameStoreNOIGrowthYoY),
        contributing_issuers: latest.contributingIssuers,
        issuer_series: issuerSeries,
        source: `EDGAR 10-K MD&A · Same-Store Performance · ${latest.contributingIssuers.join(" + ")} · FY${latest.asOf}`,
        source_provider: "SEC EDGAR",
        ingestion_pipeline: "scripts/edgar/backfill-historical-same-store.mjs",
        schema_version: "storvex.edgar-historical-same-store.v1",
      };
    })(),

    // Move 2 (Crush Radius+ wedge #7 — Pipeline Verification long-tail data
    // engine). Per-storage-REIT pipeline disclosures pulled directly from
    // each issuer's most recent 10-Q + 10-K on SEC EDGAR. Includes:
    //   - aggregate REIT-level disclosures (PSA remaining-spend, EXR balance-
    //     sheet under-development, EXR JV under-development count)
    //   - named per-property under-construction facilities (CUBE NY JV +
    //     SMA Canadian JVs — Regent / Allard / Finch / Edmonton JV)
    // Every record carries verifiedSource = "EDGAR-<form>-<accession>" which
    // pipelineConfidence.js classifies as VERIFIED. This is the layer that
    // calibrates the Pipeline Confidence chip system's default state from
    // UNVERIFIED → VERIFIED as the registry fills out.
    // Crush Radius+ DEMAND wedge — audited storage demand model output.
    // Per-capita demand + total demand SF computed from ESRI Tapestry
    // LifeMode + Urbanization + renter % + growth + median HHI, with each
    // component's coefficient + formula + primary-source citation visible
    // in the payload. Radius+ ships a black-box demand number; Storvex
    // ships the same number with every input traced.
    storage_demand_forecast: (() => {
      // Precedence: explicit enrichment.ring3mi (Quick Lookup live pull) →
      // analyzer's subject snapshot → enrichment top-level fallback.
      const ring = enrichment?.ring3mi
        ? {
            pop: enrichment.ring3mi.pop,
            renterPct: enrichment.ring3mi.renterPct,
            growthRatePct: enrichment.ring3mi.growthRate,
            medianHHIncome: enrichment.ring3mi.medianHHIncome,
            tapestryLifeMode: enrichment.tapestryLifeMode3mi,
            tapestryUrbanization: enrichment.tapestryUrbanization3mi,
          }
        : extractRingForDemandForecast({
            ...(analysis?.subject || {}),
            ...(enrichment || {}),
          });
      if (!ring || (!ring.pop && !ring.renterPct)) return null;
      const ccCurrent = enrichment?.ccSPCCurrent ?? analysis?.competition?.ccSPC ?? null;
      const fc = forecastStorageDemand(ring, {
        currentCCSPC: ccCurrent != null ? Number(ccCurrent) : undefined,
      });
      return {
        model_version: fc.modelVersion,
        demand_per_capita: numOrNull(fc.demandPerCapita),
        total_demand_sf: numOrNull(fc.totalDemandSF),
        confidence: fc.confidence,
        missing_fields: fc.missingFields,
        inputs: {
          pop_3mi: numOrNull(fc.inputs.pop),
          renter_pct_3mi: numOrNull(fc.inputs.renterPct),
          growth_rate_pct: numOrNull(fc.inputs.growthPct),
          median_hhincome: numOrNull(fc.inputs.medianHHI),
          tapestry_lifemode: fc.inputs.tapestryLifeMode,
          tapestry_urbanization: fc.inputs.tapestryUrbanization,
        },
        adjustments: {
          lifemode_name: fc.adjustments.lifeMode.name || null,
          lifemode_index: numOrNull(fc.adjustments.lifeMode.index),
          lifemode_rationale: fc.adjustments.lifeMode.rationale || null,
          urbanization_name: fc.adjustments.urbanization.name || null,
          urbanization_index: numOrNull(fc.adjustments.urbanization.index),
          urbanization_rationale: fc.adjustments.urbanization.rationale || null,
        },
        components: fc.components.map((c) => ({
          label: c.label,
          value_per_capita: numOrNull(c.valuePerCapita),
          formula: c.formula,
          source: c.source,
          rationale: c.rationale,
        })),
        surplus_vs_observed_cc_spc: fc.surplus
          ? {
              observed_cc_spc: numOrNull(fc.surplus.observedCCSPC),
              forecast_demand_spc: numOrNull(fc.surplus.forecastDemandSPC),
              delta_per_capita: numOrNull(fc.surplus.deltaPerCapita),
              delta_sf: numOrNull(fc.surplus.deltaSF),
              signal: fc.surplus.signal,
            }
          : null,
        coefficients: {
          us_baseline_spc: numOrNull(5.4),
          renter_premium_per_pct: numOrNull(fc.coefficients.RENTER_PREMIUM_PER_PCT),
          growth_premium_per_pct: numOrNull(fc.coefficients.GROWTH_PREMIUM_PER_PCT),
          income_slope_per_k: numOrNull(fc.coefficients.INCOME_SLOPE_PER_K),
          renter_premium_source: fc.coefficients.RENTER_PREMIUM_SOURCE,
          growth_premium_source: fc.coefficients.GROWTH_PREMIUM_SOURCE,
          income_slope_source: fc.coefficients.INCOME_SLOPE_SOURCE,
        },
        citations: fc.citations,
        source: "Storvex audited component-wise storage demand model · ESRI Tapestry + REIT 10-K MD&A + Self-Storage Almanac",
        schema_version: "storvex.storageDemandForecast.v1",
      };
    })(),

    edgar_pipeline_disclosures: (() => {
      const meta = getEdgarPipelineMetadata();
      if (!meta) return null;
      const disclosures = getAllEdgarPipelineDisclosures();
      const facilities = getAllEdgarPipelineFacilities();
      const dollars = getEdgarPipelineTotalDollars();
      return {
        as_of: meta.generatedAt,
        schema_version: meta.schema,
        total_issuers_disclosing: meta.totalIssuers,
        total_filings_parsed: meta.totalFilings,
        total_disclosures: meta.totalDisclosures,
        total_named_facilities: meta.totalFacilities,
        cumulative_disclosed_dollars: dollars ? dollars.total : null,
        by_issuer_dollars: dollars ? dollars.byIssuer.map((b) => ({
          operator: b.operator,
          disclosed_dollars: b.dollars,
        })) : [],
        aggregate_disclosures: disclosures.map((d) => ({
          operator: d.operator,
          operator_name: d.operatorName,
          form: d.form,
          accession_number: d.accession,
          filing_date: d.filingDate,
          report_date: d.reportDate || null,
          filing_url: d.sourceURL,
          kind: d.kind,
          remaining_spend_million: numOrNull(d.remainingSpendMillion),
          delivery_window: d.deliveryWindow || null,
          current_year_thousands: numOrNull(d.currentYearThousands),
          prior_year_thousands: numOrNull(d.priorYearThousands),
          named_jv_city: d.city || null,
          named_jv_completion: d.completion || null,
          named_jv_invested_million: numOrNull(d.investedMillion),
          named_jv_expected_million: numOrNull(d.expectedMillion),
          num_facilities: numOrNull(d.numFacilities),
          num_states: numOrNull(d.numStates),
          nrsf_million: numOrNull(d.nrsfMillion),
          aggregate_price_million: numOrNull(d.aggregatePriceMillion),
          narrative: d.narrative || null,
          citation: d.citation || null,
          verified_source: d.verifiedSource || null,
          verified_date: d.verifiedDate || null,
        })),
        named_facilities: facilities.map((f) => ({
          id: f.id,
          name: f.name,
          property_name: f.propertyName || null,
          operator: f.operator,
          city: f.city || null,
          state: f.state || null,
          country: f.country || null,
          msa: f.msa || null,
          status: f.status,
          estimated_investment: numOrNull(f.estimatedInvestment),
          invested_to_date: numOrNull(f.investedToDate),
          ci_in_progress: numOrNull(f.ciInProgress),
          acquisition_date: f.acquisitionDate || null,
          expected_delivery: f.expectedDelivery || null,
          form: f.form,
          accession_number: f.accession,
          filing_date: f.filingDate,
          filing_url: f.sourceURL,
          verified_source: f.verifiedSource,
          verified_date: f.verifiedDate,
          verifier_name: f.verifierName,
          verification_notes: f.verificationNotes || null,
          source: f.source || null,
          citation: f.citation || null,
        })),
        source: "SEC EDGAR · 10-Q + 10-K Properties Under Development / Real Estate Facilities Under Development sections",
        source_provider: "SEC EDGAR",
        ingestion_pipeline: "scripts/edgar/extract-pipeline-disclosures.mjs",
        chip_classification_rule: "verifiedSource prefix 'EDGAR-' → VERIFIED (pipelineConfidence.js derivation rule #3)",
      };
    })(),

    edgar_cross_reit: analysis.edgarComp ? {
      state_code: analysis.edgarComp.stateCode,
      state_name: analysis.edgarComp.stateName,
      total_facilities: numOrNull(analysis.edgarComp.totalFacilities),
      total_nrsf_thousands: numOrNull(analysis.edgarComp.totalNRSFThousands),
      total_gross_carrying_thou: numOrNull(analysis.edgarComp.totalGrossCarryingThou),
      weighted_psf: numOrNull(analysis.edgarComp.weightedPSF),
      avg_per_facility_m: numOrNull(analysis.edgarComp.avgPerFacilityM),
      depreciation_ratio: numOrNull(analysis.edgarComp.depreciationRatio),
      num_issuers_contributing: numOrNull(analysis.edgarComp.numIssuersContributing),
      issuers: Array.isArray(analysis.edgarComp.issuers) ? analysis.edgarComp.issuers.map((i) => ({
        issuer: i.issuer,
        issuer_name: i.issuerName,
        source_label: i.sourceLabel,
        facilities: numOrNull(i.facilities),
        nrsf_thousands: numOrNull(i.nrsfThousands),
        total_gross_thou: numOrNull(i.totalGrossThou),
        implied_psf: numOrNull(i.impliedPSF),
        depreciation_ratio: numOrNull(i.depreciationRatio),
        filing_date: i.filingDate || null,
        report_date: i.reportDate || null,
        accession_number: i.accessionNumber || null,
        filing_url: i.filingURL || null,
      })) : [],
    } : null,

    // Cross-REIT primary-source per-facility move-in rate matrix. Each row
    // is one operator (PSA + CUBE + EXR) with median CC + DU rates scraped
    // directly from the operator's facility detail pages. Daily-refreshed.
    // No third-party rate aggregator (no SpareFoot, no Radius+) — every
    // rate cites the operator's source URL on their public storage website.
    cross_reit_move_in_rates: enrichment?.crossREITMSARates && enrichment.crossREITMSARates.length > 0 ? {
      msa: enrichment.subjectMSA || null,
      operator_count: numOrNull(enrichment.crossREITScrapedMetadata?.operatorCount),
      total_facilities_indexed: numOrNull(enrichment.crossREITScrapedMetadata?.totalFacilities),
      total_unit_listings_indexed: numOrNull(enrichment.crossREITScrapedMetadata?.totalUnitListings),
      operators: enrichment.crossREITMSARates.map((r) => ({
        operator: r.operator,
        operator_name: r.operatorName,
        cc_median_psf_mo: numOrNull(r.ccMedianPerSF_mo),
        cc_low_psf_mo: numOrNull(r.ccLowPerSF_mo),
        cc_high_psf_mo: numOrNull(r.ccHighPerSF_mo),
        du_median_psf_mo: numOrNull(r.duMedianPerSF_mo),
        cc_standard_median_psf_mo: numOrNull(r.ccStandardMedianPerSF_mo),
        du_standard_median_psf_mo: numOrNull(r.duStandardMedianPerSF_mo),
        implied_discount_pct: numOrNull(r.impliedDiscountPct),
        facilities_scraped: numOrNull(r.facilitiesScraped),
        total_unit_listings: numOrNull(r.totalUnitListings),
      })),
      // Cross-REIT operator-level metadata for each scraped index
      operator_metadata: (enrichment.crossREITScrapedMetadata?.operators || []).map((o) => ({
        operator: o.operator,
        schema: o.schema,
        scrape_generated_at: o.scrapeGeneratedAt || o.generatedAt,
        facilities: numOrNull(o.totals?.facilities),
        unit_listings: numOrNull(o.totals?.unitListings),
        national_validation: o.nationalValidation || null,
      })),
      data_source: "Per-facility unit-rent scraping from each operator's public-facing facility detail pages (publicstorage.com Schema.org SelfStorage entities, cubesmart.com structured HTML widget, extraspace.com Schema.org via Puppeteer-core + stealth plugin). Refreshed daily via GitHub Actions cron at 06:00 UTC.",
      audit_trail: "Each operator's scraper outputs a date-stamped JSON file in src/data/{operator}-facility-rents-{YYYY-MM-DD}.json. The aggregator builds {operator}-scraped-rent-index.json with per-facility median + per-MSA rollup + national cross-validation against MD&A in-place rent.",
    } : null,

    // Multi-lens buyer comparison — runs every registered lens against this
    // deal and emits an array sorted DESC by implied takedown price. The top
    // row IS the natural institutional takeout — the buyer who would pay the
    // most at their own underwriting hurdle. Platform-fit Δ is the dollar
    // value the institutional self-managed REIT defensibly pays above the
    // GENERIC third-party-managed buyer on the identical asset.
    multi_lens_comparison: Array.isArray(multiLensRows) && multiLensRows.length > 0 ? {
      lenses_evaluated: multiLensRows.length,
      top_buyer_key: multiLensRows[0]?.key || null,
      top_buyer_ticker: multiLensRows[0]?.ticker || null,
      top_buyer_implied_takedown: numOrNull(multiLensRows[0]?.impliedTakedownPrice),
      platform_fit_delta_dollars: numOrNull(platformFitDelta?.deltaDollars),
      platform_fit_delta_pct: numOrNull(platformFitDelta?.deltaPct),
      platform_fit_top_lens: platformFitDelta?.topLensTicker || null,
      platform_fit_top_price: numOrNull(platformFitDelta?.topPrice),
      platform_fit_generic_price: numOrNull(platformFitDelta?.genericPrice),
      lenses: multiLensRows.map((row) => ({
        key: row.key,
        ticker: row.ticker,
        name: row.name,
        deal_stab_cap: numOrNull(row.dealStabCap),
        lens_target_cap: numOrNull(row.lensTargetCap),
        bps_delta: numOrNull(row.bpsDelta),
        verdict: row.verdict || null,
        implied_takedown_price: numOrNull(row.impliedTakedownPrice),
        reconstructed_noi: numOrNull(row.reconstructedNOI),
        revenue_premium_pct: numOrNull(row.revenuePremiumPct),
        portfolio_fit: !!row.portfolioFit,
        cap_basis: row.capBasis || null,
        dev_yoc_target: numOrNull(row.devYOCTarget),
      })),
      methodology: "For each registered buyer lens, runs computeBuyerLens(input, lens) which applies that lens's expense overrides + revenue adjustment + custom market cap to reconstruct the buyer's NOI and project Y3. Implied takedown price = Y3 NOI / lens.marketCap (the price each buyer would pay AT their own underwriting hurdle). Sorted DESC by implied takedown — top row is the natural institutional takeout. Platform-fit Δ = top - GENERIC. All constants trace to FY2025 10-K accession numbers (per-lens citation footnotes available in Goldman PDF).",
    } : null,

    // Acquisition financing scenario — lens-specific levered hold model.
    // Capital stack + debt service + DSCR + cash-on-cash + 10-yr levered IRR.
    // Closes the all-cash credibility gap on every warehouse export.
    financing_scenario: psLens?.financing && Number.isFinite(psLens.financing.equity) && psLens.financing.equity > 0 ? {
      lens_key: psLens.lens?.key || null,
      lens_ticker: psLens.lens?.ticker || null,
      assumptions: {
        ltv: numOrNull(psLens.financing.assumptions?.ltv),
        rate: numOrNull(psLens.financing.assumptions?.rate),
        amort_yrs: numOrNull(psLens.financing.assumptions?.amortYrs),
        term_yrs: numOrNull(psLens.financing.assumptions?.termYrs),
        hold_yrs: numOrNull(psLens.financing.assumptions?.holdYrs),
        exit_cap_delta: numOrNull(psLens.financing.assumptions?.exitCapDelta),
        effective_exit_cap: numOrNull(psLens.financing.assumptions?.effectiveExitCap),
        rent_growth_yoy: numOrNull(psLens.financing.assumptions?.rentGrowthYoY),
        debt_source: psLens.financing.assumptions?.debtSource || null,
      },
      capital_stack: {
        ask: numOrNull(psLens.financing.ask),
        loan_amount: numOrNull(psLens.financing.loanAmount),
        equity: numOrNull(psLens.financing.equity),
      },
      debt_service: {
        monthly: numOrNull(psLens.financing.monthlyDebtService),
        annual: numOrNull(psLens.financing.annualDebtService),
      },
      y1: {
        noi: numOrNull(psLens.financing.y1NOI),
        dscr: numOrNull(psLens.financing.y1DSCR),
        cash_on_cash: numOrNull(psLens.financing.y1CashOnCash),
      },
      y3_stabilized: {
        noi: numOrNull(psLens.financing.y3NOI),
        dscr: numOrNull(psLens.financing.y3DSCR),
        cash_on_cash: numOrNull(psLens.financing.y3CashOnCash),
      },
      hold_exit: {
        cashflows: Array.isArray(psLens.financing.cashflows) ? psLens.financing.cashflows.map(numOrNull) : [],
        exit_value: numOrNull(psLens.financing.exitValue),
        remaining_loan_at_exit: numOrNull(psLens.financing.remainingLoanAtExit),
      },
      irr: {
        levered: numOrNull(psLens.financing.leveredIRR),
        unlevered: numOrNull(psLens.financing.unleveredIRR),
      },
      methodology: "Lens-specific acquisition financing: capital stack (ask × LTV = senior debt; ask − senior debt = equity), debt service (P&I on amortizing loan), DSCR (NOI / debt service), cash-on-cash (levered cash flow / equity), 10-yr levered hold IRR (Y0 = -equity; Y1-Y10 = NOI - debt service; Y10 exit = sale price - remaining principal). Rent grows linearly Y1→Y3, then compounds at lens.benchmarks.industryECRI/4 capped 1-3%/yr. Exit cap = going-in cap + lens.financing.exitCapDelta (50-75 bps cap expansion). Sources: Newmark 2025 Self-Storage Capital Markets Report + Cushman H1 2025 Trends + Q1 2026 Freddie SBL/CMBS storage rate sheets.",
    } : null,

    // New-supply pipeline within 3 mi — disclosed institutional REIT
    // facilities under construction or permitted that may compress Y3 NOI.
    // Saturation severity flags whether the analyst should haircut Y3 NOI
    // assumptions (Y3 occupancy −1pp, rent growth −1pp on MATERIAL flag).
    development_pipeline: enrichment?.pipelineNearby && enrichment.pipelineNearby.length > 0 ? {
      facilities_within_3mi: enrichment.pipelineNearby.length,
      saturation_severity: enrichment.pipelineSaturation?.severity || null,
      saturation_flag: !!enrichment.pipelineSaturation?.flag,
      saturation_verdict: enrichment.pipelineSaturation?.verdict || null,
      saturation_narrative: enrichment.pipelineSaturation?.narrative || null,
      cc_nrsf_in_horizon: numOrNull(enrichment.pipelineSaturation?.ccNRSFInHorizon),
      total_nrsf: numOrNull(enrichment.pipelineSaturation?.totalNRSF),
      facilities_in_horizon: numOrNull(enrichment.pipelineSaturation?.facilitiesInHorizon),
      pipeline: enrichment.pipelineNearby.map((row) => ({
        id: row.id,
        operator: row.operator,
        operator_name: row.operatorName,
        address: row.address,
        city: row.city,
        state: row.state,
        msa: row.msa,
        lat: numOrNull(row.lat),
        lng: numOrNull(row.lng),
        distance_mi: numOrNull(row.distanceMi),
        nrsf: numOrNull(row.nrsf),
        cc_pct: numOrNull(row.ccPct),
        stories: numOrNull(row.stories),
        expected_delivery: row.expectedDelivery,
        status: row.status,
        estimated_investment: numOrNull(row.estimatedInvestment),
        source: row.source,
        citation: row.citation,
      })),
      methodology: "Phase 1 pipeline dataset — disclosed institutional REIT facilities sourced from each REIT's FY2025 10-K MD&A 'Properties Under Development' sections + Q1 2026 earnings transcripts. Refreshes quarterly. Saturation thresholds: >=100K SF CC delivering Y1-Y3 = MATERIAL (Y3 occ -1pp, rent growth -1pp suggested haircut); 50-100K = MODERATE; <50K or out-of-horizon = MINIMAL/no flag.",
    } : null,

    // Pitch target — when set, the analyzer was run in pitch mode for a
    // specific institutional recipient (Reza Mahdavian / Aaron Liken /
    // Jennifer Settles / Custom). Branded the Goldman PDF cover and (where
    // applicable) auto-applied that recipient's default underwriting lens.
    // Downstream consumers can use this to filter / route / track which
    // institutional buyers each analysis was tailored for.
    pitch_target: pitchTarget ? {
      key: pitchTarget,
      // Embed recipient meta inline so warehouse readers don't need to
      // cross-reference recipientProfiles.js.
      ...(() => {
        try {
          // eslint-disable-next-line global-require
          const { getRecipient } = require("./recipientProfiles");
          const r = getRecipient(pitchTarget);
          if (!r) return {};
          return {
            recipient_name: r.recipientName,
            role: r.role,
            firm: r.firm,
            default_lens: r.defaultLens,
          };
        } catch {
          return {};
        }
      })(),
    } : null,

    extraction: extractionMeta ? {
      om_filename: extractionMeta.filename || null,
      confidence: numOrNull(extractionMeta.confidence),
      extraction_engine: "Storvex OM Engine",
      extraction_notes: extractionMeta.notes || null,
      extracted_at: generatedAt,
      elapsed_ms: numOrNull(extractionMeta.elapsedMs),
      token_usage: extractionMeta.tokenUsage || null,
    } : null,

    ic_memo: memo ? {
      recommendation: memo.recommendation || null,
      exec_summary_markdown: memo.execSummary || null,
      bid_posture: memo.bidPosture || null,
      top_risks: memo.topRisks || [],
      buyer_routing: memo.buyerRouting || null,
      memo_engine: "Storvex IC Engine",
      memo_generated_at: generatedAt,
    } : null,

    audit: {
      ps_lens_constants_source: PS_LENS_VERSION,
      ps_lens_documentation: "docs/PS_UNDERWRITING_MODEL.md",
      demographics_source: "ESRI ArcGIS GeoEnrichment 2025 (current year + 2030 projection)",
      ps_family_proximity_source: "PS_Locations_ALL.csv + NSA_Locations.csv (2026-Q2 vintage)",
      market_rents_source: "EDGAR Rent Calibration Index v1 (cross-REIT primary source: PSA/EXR/CUBE/SMA 10-K same-store rent disclosures, Schedule III facility-weighted, geographic adjustment via weighted gross carrying $/SF). Endpoint: /api/sparefoot-rents (URL retained for backward compatibility). PLUS per-facility move-in rates scraped daily from operator facility detail pages — see cross_reit_move_in_rates block above for the per-MSA primary-source matrix.",
      sale_comps_source: "src/data/storageCompSales.js (REIT 10-K + Cushman + SSA + MMX)",
      valuation_framework_version: VALUATION_FRAMEWORK_VERSION,
      valuation_framework_documentation: "memory/valuation-framework.md",
      analyzer_version: ANALYZER_VERSION,
      ic_memo_engine: "Storvex IC Engine (deterministic math + narrative narration)",
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) || !isFinite(n) ? null : n;
}

function yearOrNull(y) {
  if (!y) return null;
  return {
    revenue: numOrNull(y.rev),
    operating_expense: numOrNull(y.exp),
    net_operating_income: numOrNull(y.noi),
  };
}

function tierOrNull(t) {
  if (!t) return null;
  return {
    price: numOrNull(t.price),
    cap_rate: numOrNull(t.cap),
    basis: t.basis || null,
  };
}

function generateDealId(snapshot) {
  const slug = (snapshot.name || "deal")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const ts = Date.now();
  return `${slug}-${ts}`;
}

/**
 * Trigger a browser download of the warehouse payload as a JSON file.
 * Filename: Storvex_{deal-name}_{YYYY-MM-DD}.json
 */
export function downloadWarehousePayload(payload, suggestedName) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  const name = (suggestedName || payload.deal_id || "storvex-deal")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 80);
  a.download = `Storvex_${name}_${date}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
