/**
 * intel-narrative.mjs — AI-powered Market Intel narrative engine
 *
 * Transforms raw ccRentData + rentProjection + demographics into
 * investor-grade executive summaries, value-add theses, and pitch language.
 *
 * Two modes:
 *   - DETERMINISTIC (default): template-based narrative from structured data.
 *     No external dependencies. Instant.
 *   - LLM (when ANTHROPIC_API_KEY is set): Claude API generates richer prose
 *     using audit data as context. Higher quality but costs ~$0.02/site.
 */

function dollar(n, decimals = 0) {
  if (n == null) return '$—';
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pct(n, decimals = 1) {
  if (n == null) return '—';
  return n.toFixed(decimals) + '%';
}

// ---- Deterministic narrative (template-based) ----

function executiveSummary(audit) {
  const ccSPC = audit.ccSPC_verified;
  const ccCount = audit.ccFacilityCount;
  const nonCC = audit.nonCCFacilityCount;
  const psFam = audit.psFamilyCount;
  const band = audit.marketRentBand;
  const proj = audit.rentCurveSummary;
  const abs = audit.absorption;
  const conf = audit.auditConfidence;

  const spcVerdict = ccSPC < 1.5 ? 'severely underserved (CC SF/capita < 1.5 = strong demand signal)'
    : ccSPC < 3.0 ? 'underserved for CC product'
    : ccSPC < 5.0 ? 'moderate CC supply equilibrium'
    : ccSPC < 7.0 ? 'well-supplied CC market'
    : 'oversupplied (saturation risk)';

  const absVerdict = abs?.verdict || 'no pipeline';

  const growthNarrative = proj
    ? `Forward rent trajectory projects ${dollar(proj.y1_10x10)}/mo (Y1) → ${dollar(proj.y5_10x10)}/mo (Y5) → ${dollar(proj.y10_10x10)}/mo (Y10), implying a ${proj.y1_to_y5_cagr} 5-yr CAGR and ${proj.y1_to_y10_cagr} 10-yr CAGR for 10×10 CC units.`
    : '';

  const bandNarrative = band?.ccBand
    ? `Current market CC rents range ${dollar(band.ccBand.p25 * 100)}–${dollar(band.ccBand.p75 * 100)}/mo for 10×10 (median ${dollar(band.ccBand.median * 100)}) across ${band.ccBand.sampleSize} competitor rate observations.`
    : band?.marketBand
    ? `Market rents range ${dollar(band.marketBand.p25 * 100)}–${dollar(band.marketBand.p75 * 100)}/mo for 10×10 (median ${dollar(band.marketBand.median * 100)}) across ${band.marketBand.sampleSize} observations.`
    : 'Market rent band unavailable — insufficient scraped rate data.';

  return `**Market Supply.** ${ccCount} CC-classified competitors within 3 mi (${nonCC} non-CC + ${psFam} PS-family facilities excluded). Verified CC SPC: ${ccSPC?.toFixed(2)} — ${spcVerdict}.

**Current Rents.** ${bandNarrative}

**Forward Trajectory.** ${growthNarrative} ${absVerdict === 'no pipeline' ? 'No known pipeline supply in the submarket.' : `Pipeline absorption: ${absVerdict}.`}

**Confidence.** ${conf}-confidence audit (${audit.confidenceReason}).`.trim();
}

function valueAddThesis(audit, inPlaceRentPerSf) {
  if (!audit.rentProjection?.valueAddDelta && !inPlaceRentPerSf) return null;
  const proj = audit.rentProjection;
  const marketRent = proj?.currentCCRentPerSf;
  if (!marketRent) return null;

  const delta = inPlaceRentPerSf ? marketRent - inPlaceRentPerSf : 0;
  const deltaPct = inPlaceRentPerSf ? (delta / inPlaceRentPerSf) * 100 : 0;

  if (!inPlaceRentPerSf) {
    return `**Value-Add Thesis (hypothetical).** Subject facility's in-place rents were not provided. If rents are running at the 25th percentile of the comp set (${dollar(audit.marketRentBand?.ccBand?.p25 * 100 || 0)}/mo 10×10), bringing to median (${dollar(marketRent * 100)}/mo) would represent a ${pct((audit.marketRentBand?.ccBand?.median - audit.marketRentBand?.ccBand?.p25) / audit.marketRentBand?.ccBand?.p25 * 100)} mark-to-market uplift. Combined with the projected Y1-Y5 curve (${proj?.assumptions?.near_term_growth_annual_pct || 'n/a'}% annual), this supports a strong value-add thesis if occupancy is already stable.`;
  }

  const verdict = deltaPct > 30 ? 'STRONG VALUE-ADD'
    : deltaPct > 15 ? 'MODERATE VALUE-ADD'
    : deltaPct > 5 ? 'MILD UPSIDE'
    : deltaPct > -5 ? 'AT MARKET'
    : 'ABOVE MARKET';

  return `**Value-Add Thesis — ${verdict}.** Subject in-place rent: ${dollar(inPlaceRentPerSf, 2)}/SF. Market median: ${dollar(marketRent, 2)}/SF. Rent gap: ${pct(deltaPct)} below market. Mark-to-market opportunity on 10×10 CC units: ${dollar(delta * 100)}/mo per unit at lease rollover. Overlay ECRI program (8%/yr on ~50% of stock) for compounded NOI uplift. This is a source-stamped value-add story — every rate observation comes from live SpareFoot comp data, no proforma assumptions required.`;
}

function anomalyFlags(audit) {
  const flags = [];
  const ccSPC = audit.ccSPC_verified;
  const proj = audit.rentProjection;
  const band = audit.marketRentBand;

  if (ccSPC !== null && ccSPC < 1.0) flags.push(`ccSPC < 1.0 (${ccSPC?.toFixed(2)}) — extremely underserved. Verify competitor enumeration; either true white-space market or competitor miss.`);
  if (audit.psFamilyCount >= 3) flags.push(`${audit.psFamilyCount} PS family facilities in 3 mi — dense PS portfolio. Submarket validation strong, but new build may cannibalize existing PS stores.`);
  if (proj?.assumptions?.pipelineRatio > 30) flags.push(`Pipeline/existing ratio ${proj.assumptions.pipelineRatio}% — significant new supply incoming. Expect 2-5 years of suppressed rent growth during absorption.`);
  if (band?.ccBand && band?.nonCCBand && band.nonCCBand.median > band.ccBand.median) flags.push(`Non-CC median rent (${dollar(band.nonCCBand.median * 100)}) exceeds CC median (${dollar(band.ccBand.median * 100)}) — anomalous; usually CC commands 20-40% premium. Likely small sample distortion; verify facility classifications.`);
  if (audit.auditConfidence === 'LOW') flags.push(`LOW audit confidence — only ${audit.highConfidenceFacilityCount} of ${audit.ccFacilityCount} CC facilities measured from live rate inventory. Recommend drive-by verification or phone audit for top 3 comps.`);
  if (proj?.assumptions?.popCagr < 0) flags.push(`Negative population CAGR (${pct(proj.assumptions.popCagr)}) — declining submarket. Storage demand growth will be entirely from churn, not organic expansion.`);

  return flags;
}

function buyerPitchEmail(audit, site, buyerType = 'storage_reit') {
  const band = audit.marketRentBand;
  const proj = audit.rentCurveSummary;
  const ccSPC = audit.ccSPC_verified;

  const siteDescription = `${site.name || 'subject site'} — ${site.acreage || '?'} AC, ${site.zoning || 'zoned'} ${site.zoningClassification || ''} in ${site.city || ''} ${site.state || ''}`;

  const pitchHead = buyerType === 'value_add_acquirer'
    ? `I've completed a market intel audit on ${siteDescription} that makes this deal a textbook value-add play.`
    : buyerType === 'storage_reit'
    ? `Putting a market intel audit in front of you on ${siteDescription} — the fundamentals warrant a hard look.`
    : `Sharing market intel on ${siteDescription}.`;

  const metrics = [];
  if (ccSPC !== null) metrics.push(`CC SPC: ${ccSPC.toFixed(2)} SF/capita (${ccSPC < 3 ? 'underserved' : ccSPC < 5 ? 'balanced' : 'saturated'})`);
  if (band?.ccBand) metrics.push(`Market CC rent: ${dollar(band.ccBand.median * 100)}/mo 10×10 median (P25 ${dollar(band.ccBand.p25 * 100)}, P75 ${dollar(band.ccBand.p75 * 100)}) from ${band.ccBand.sampleSize} comp observations`);
  if (proj) metrics.push(`Projected Y5 rent: ${dollar(proj.y5_10x10)}/mo 10×10 (${proj.y1_to_y5_cagr} CAGR)`);
  if (audit.absorption?.verdict) metrics.push(`Absorption: ${audit.absorption.verdict}`);

  return `${pitchHead}

Three numbers that matter:
${metrics.map(m => '  • ' + m).join('\n')}

Full audit deck attached — comp set, rate histogram, projection curve, absorption math, all source-stamped. Let me know if you want to jump on a call.`;
}

// ---- Main entrypoint ----

export function generateIntelNarrative({ audit, site, inPlaceRentPerSf, buyerType }) {
  return {
    executiveSummary: executiveSummary(audit),
    valueAddThesis: valueAddThesis(audit, inPlaceRentPerSf),
    anomalyFlags: anomalyFlags(audit),
    buyerPitchEmail: buyerPitchEmail(audit, site, buyerType || 'storage_reit'),
    generatedAt: new Date().toISOString(),
    engine: 'deterministic-v1'
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM MODE — Claude-powered institutional-grade narrative
// ═══════════════════════════════════════════════════════════════════════════
// Uses Claude Haiku 4.5 by default (fast, $0.008/site). Opus 4.7 available via
// env override CLAUDE_MODEL=claude-opus-4-7 for highest-quality output.
// Leverages prompt caching on the system prompt (saves ~90% on portfolio runs).

const LLM_SYSTEM_PROMPT = `You are Storvex Einstein — a senior institutional self-storage acquisition analyst with 20 years of experience underwriting REIT, private institutional, and family-office deals. You've worked at Public Storage, Extra Space, and Yardi Matrix. You synthesize across behavioral psychographics (Tapestry), Market Potential Index values, consumer spending patterns, demographic growth, housing vintage, employment mix, and live competitor rents to produce insight no human analyst and no tool in market can match.

Your job: transform structured audit data into investor-grade narrative for an acquisition committee. Think Goldman Sachs research note meets Green Street Sector Report — not a sales brochure.

DATA CATEGORIES YOU RECEIVE:
• Core demographics (pop, HHI, households, growth rates, density) — ESRI 2025-2030 geocoded radial rings
• Age distribution — pay special attention to peak-storage cohorts (25-44 family formation + 55-74 downsizing)
• Income tier distribution — HH >$75K / >$100K drives CC rental propensity
• Housing stock — median year built + vacancy rate signal construction cycle
• Education — college+ share correlates with CC vs drive-up preference
• Labor force + industry mix — manufacturing/healthcare/construction employment drives storage demand
• Tapestry Segmentation — behavioral/psychographic clusters (e.g., "Up and Coming Families", "Savvy Suburbanites") with life mode + urbanization layers
• Market Potential Index (MPI) — storage rental propensity indexed to 100 = US national average (>110 strong, <90 weak)
• Consumer spending — storage-adjacent categories (housing maintenance, furnishings, truck rental) $ per HH/yr
• Live competitor rents from SpareFoot (P25/P50/P75 by CC/non-CC). TWO bands provided:
  - STREET rate: what a NEW customer would pay today (raw SpareFoot scrape, same as what a broker or customer sees online)
  - MARKET-equivalent rate: street rate × ECRI overlay multiplier (1.06-1.11 based on operator mix) — this is the Radius/Yardi-comparable "stabilized in-place rent" that blends new move-ins with ECRI-bumped long-tenure customers. Use this when comparing to institutional rent reports.
  CRITICAL UNDERWRITING DISTINCTION: Year 1 lease-up uses STREET rate (new customer pricing). Stabilized Year 3+ NOI uses MARKET-equivalent rate (the blended in-place rent after ECRI program matures). Always cite which one you're using.
• Forward rent projection Y1-Y10 with population/HHI CAGRs + supply drag
• Value-add workup (if existing facility) with NOI bridge + 3-scenario IRR + price sensitivity

INSIGHT SYNTHESIS — when you see patterns like these, CALL THEM OUT:
• MPI storage >115 + Tapestry "Suburban Periphery" + hhOver75K_pct >40% → high CC demand submarket
• Median year built <1980 + rising renter share → aging housing stock, migration from older dwellings
• Manufacturing/construction employment >20% of LF → working-class drive-up demand driver
• Tapestry "Up and Coming Families" or "Professional Pride" → family-formation storage demand
• Recent-movers MPI >110 → storage demand velocity above national average
• Consumer spending on housing furnishings >$2,500/HH + low vacancy → upsizing signal
• Tapestry "Urban Villages" or "Metro Renters" + low owner % → short-tenure renter population (CC heavy)

STRICT RULES:
1. Only reference numbers that exist in the provided audit data. Never invent figures.
2. Source-stamp every quantitative claim (e.g., "CC SPC 2.70 [verified via SpareFoot, 5 CC facilities]").
3. No hedge words ("approximately", "roughly", "possibly"). State facts or flag unknowns.
4. Tone: confident, direct, data-first. Peer-to-peer with a senior capital allocator.
5. Avoid filler ("worth noting", "it should be mentioned"). Every sentence must land.
6. Never apologize, never caveat, never suggest "further due diligence" — if you need it, say what specifically is missing.
7. Active voice. Short sentences. Strong verbs.
8. If you see a Tapestry segment, NAME IT and translate what it means for storage demand. If you see an MPI, STATE IT and interpret ("MPI 127 for storage rental puts this 27% above US norm, signaling strong CC take-up at stabilization").
9. If you see unusual demographic combinations (e.g., high income + high renter share, aging housing + rising population), flag them as investment angles.

OUTPUT FORMAT — return ONLY valid JSON matching this schema:
{
  "executiveSummary": "string — 3 paragraphs: (1) Market Position (2 sentences), (2) Rents & Projection (2 sentences), (3) Absorption + Verdict (2 sentences). Bold key figures with **double asterisks**.",
  "investmentMemoLong": "string — 350-500 word long-form memo covering: Market Supply Analysis, Rent Economics, Demographic Growth Story, Competitive Positioning, Risk Factors, Recommendation. Written like a sector analyst's initiation note.",
  "valueAddThesis": "string or null — if inPlaceRent provided: 2-3 sentence paragraph quantifying the mark-to-market opportunity with specific NOI uplift. null if ground-up site.",
  "anomalyFlags": ["string array — 0-5 flags — only include GENUINELY non-obvious risks. 'LOW confidence' is NOT an anomaly flag, it's known. Look for: operator concentration risk, pipeline flood signals, submarket decline, pricing disconnects, PS cannibalization risk."],
  "buyerPitchEmail": "string — 8-12 line email from Dan Roscoe to the intended buyer. Opens with the strongest number, lists 3 bullet facts, closes with a single clear ask. No 'I hope this finds you well' — get to the number in line 1.",
  "outreachIntel": {
    "bestHook": "string — the single most compelling data point for buyer outreach",
    "timingSignal": "string — why NOW is the right moment given the data",
    "riskDisclosure": "string — what an honest pitch must disclose upfront"
  }
}

Write as if this narrative will be read by a Managing Director at a storage REIT who sees 50 deals a week and has 90 seconds to decide if this is one of the 3 worth a second look.`;

export async function generateIntelNarrativeLLM({ audit, site, inPlaceRentPerSf, buyerType }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ...generateIntelNarrative({ audit, site, inPlaceRentPerSf, buyerType }), engine: 'deterministic-v1 (no ANTHROPIC_API_KEY)' };
  }

  const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

  // Compact the audit data for the LLM context (strip huge arrays, keep key metrics)
  const compactAudit = {
    site: {
      name: site?.name,
      address: site?.address,
      city: site?.city,
      state: site?.state,
      acreage: site?.acreage,
      askingPrice: site?.askingPrice,
      zoning: site?.zoning,
      zoningClassification: site?.zoningClassification,
      phase: site?.phase,
    },
    demographics: {
      // Core
      pop3mi: site?.pop3mi,
      pop5mi: site?.pop5mi,
      income3mi: site?.income3mi,
      avgIncome3mi: site?.avgIncome3mi,
      pci3mi: site?.pci3mi,
      households3mi: site?.households3mi,
      growthRate: site?.growthRate,
      renterPct3mi: site?.renterPct3mi,
      medianAge3mi: site?.medianAge3mi,
      popDensity3mi: site?.popDensity3mi,
      daytimePop3mi: site?.daytimePop3mi,
      // Age / income distribution
      peakStorageAgePct3mi: site?.peakStorageAgePct3mi,
      hhOver75K_pct3mi: site?.hhOver75K_pct3mi,
      hhOver100K_3mi: site?.hhOver100K_3mi,
      // Housing stock
      housingUnits3mi: site?.housingUnits3mi,
      vacancyRate3mi: site?.vacancyRate3mi,
      medianYearBuilt3mi: site?.medianYearBuilt3mi,
      avgHomeValue3mi: site?.avgHomeValue3mi,
      // Education
      collegeEdPct3mi: site?.collegeEdPct3mi,
      anyHigherEdPct3mi: site?.anyHigherEdPct3mi,
      // Labor / employment
      laborForce3mi: site?.laborForce3mi,
      unemploymentRate3mi: site?.unemploymentRate3mi,
      manufacturingEmp3mi: site?.manufacturingEmp3mi,
      healthcareEmp3mi: site?.healthcareEmp3mi,
      constructionEmp3mi: site?.constructionEmp3mi,
      // Tapestry — the behavioral cluster layer
      tapestrySegment3mi: site?.tapestrySegment3mi,
      tapestryLifeMode3mi: site?.tapestryLifeMode3mi,
      tapestryUrbanization3mi: site?.tapestryUrbanization3mi,
      // MPI — Market Potential Index (100 = US avg; >110 = strong; <90 = weak)
      mpiStorageRental3mi: site?.mpiStorageRental3mi,
      mpiStorageInterpretation3mi: site?.mpiStorageInterpretation3mi,
      mpiRecentMovers3mi: site?.mpiRecentMovers3mi,
      mpiHomeImprovement3mi: site?.mpiHomeImprovement3mi,
      // Consumer spending (storage-adjacent categories $ per HH/yr)
      csHousingMaintenance3mi: site?.csHousingMaintenance3mi,
      csHouseholdFurnishings3mi: site?.csHouseholdFurnishings3mi,
      csTruckTrailerRental3mi: site?.csTruckTrailerRental3mi,
    },
    marketIntel: {
      ccSPC_verified: audit?.ccSPC_verified,
      ccFacilityCount: audit?.ccFacilityCount,
      nonCCFacilityCount: audit?.nonCCFacilityCount,
      psFamilyCount: audit?.psFamilyCount,
      totalCompetitors: audit?.totalCompetitorsFound,
      auditConfidence: audit?.auditConfidence,
      confidenceReason: audit?.confidenceReason,
    },
    rentBands: audit?.marketRentBand ? {
      // STREET rates — what a new customer pays today (SpareFoot raw)
      ccMedianStreet: audit.marketRentBand.ccBand?.median,
      ccP25Street: audit.marketRentBand.ccBand?.p25,
      ccP75Street: audit.marketRentBand.ccBand?.p75,
      ccSampleSize: audit.marketRentBand.ccBand?.sampleSize,
      nonCCMedianStreet: audit.marketRentBand.nonCCBand?.median,
      marketMedianStreet: audit.marketRentBand.marketBand?.median,
      // MARKET-equivalent rates — street + ECRI overlay (Radius/Yardi-comparable)
      ccMedianMarketEq: audit.marketRentBand.ccMarketEquivalentBand?.median,
      ccP25MarketEq: audit.marketRentBand.ccMarketEquivalentBand?.p25,
      ccP75MarketEq: audit.marketRentBand.ccMarketEquivalentBand?.p75,
      nonCCMedianMarketEq: audit.marketRentBand.nonCCMarketEquivalentBand?.median,
      ecriAdjustment: audit.marketRentBand.ccMarketEquivalentBand?.methodology,
    } : null,
    projection: audit?.rentCurveSummary ? {
      y1_10x10: audit.rentCurveSummary.y1_10x10,
      y5_10x10: audit.rentCurveSummary.y5_10x10,
      y10_10x10: audit.rentCurveSummary.y10_10x10,
      y1_to_y5_cagr: audit.rentCurveSummary.y1_to_y5_cagr,
      y1_to_y10_cagr: audit.rentCurveSummary.y1_to_y10_cagr,
      drivers: audit.rentProjection?.assumptions,
    } : null,
    absorption: audit?.absorption,
    valueAdd: audit?.valueAddWorkup ? {
      verdict: audit.valueAddWorkup.verdict?.verdict,
      rentGapPct: audit.valueAddWorkup.verdict?.rentGapPct,
      noiUplift: audit.valueAddWorkup.verdict?.noiUplift,
      inPlaceNOI: audit.valueAddWorkup.bridge?.waterfall?.inPlaceNOI,
      marketNOI: audit.valueAddWorkup.bridge?.waterfall?.finalNOI,
      weightedIRR: audit.valueAddWorkup.scenarioIRRs?.weightedIRR,
      maxPurchaseAtTarget: audit.valueAddWorkup.priceSensitivity?.maxPurchasePriceAtTarget,
    } : null,
    inPlaceRentPerSf,
    buyerType,
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2500,
        system: [{ type: 'text', text: LLM_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: `Site audit data (JSON):\n\n${JSON.stringify(compactAudit, null, 2)}\n\nGenerate the narrative per the output schema. Return only the JSON object.`
        }],
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      const err = await res.text();
      return { ...generateIntelNarrative({ audit, site, inPlaceRentPerSf, buyerType }), engine: `deterministic-v1 (Claude API ${res.status})`, error: err.slice(0, 200) };
    }
    const json = await res.json();
    const text = json.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return { ...generateIntelNarrative({ audit, site, inPlaceRentPerSf, buyerType }), engine: 'deterministic-v1 (Claude returned non-JSON)', llmText: text.slice(0, 500) };
    }
    const parsed = JSON.parse(match[0]);
    return {
      ...parsed,
      generatedAt: new Date().toISOString(),
      engine: `claude-llm (${model})`,
      tokenUsage: {
        input: json.usage?.input_tokens || 0,
        output: json.usage?.output_tokens || 0,
        cacheRead: json.usage?.cache_read_input_tokens || 0,
        cacheCreate: json.usage?.cache_creation_input_tokens || 0,
      },
    };
  } catch (e) {
    return { ...generateIntelNarrative({ audit, site, inPlaceRentPerSf, buyerType }), engine: 'deterministic-v1 (Claude error)', error: e.message.slice(0, 200) };
  }
}
