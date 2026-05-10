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
