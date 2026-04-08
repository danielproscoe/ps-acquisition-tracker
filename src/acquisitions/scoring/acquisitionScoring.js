// ─── AcquisitionScore v1.0 — Existing Facility Acquisition Scoring Engine ───
//
// Evaluates EXISTING STORAGE FACILITIES for off-market acquisition.
// Different from SiteScore (which evaluates vacant land for ground-up development).
//
// 11 Weighted Dimensions + 3 Binary Gates
// Return shape matches computeSiteScore for component reuse (SiteScoreBadge, etc.)
//
// Competitive moat: Loan maturity intelligence from Crexi Intelligence.
// No other platform scores storage facilities by debt pressure.

import { ACQUISITION_SCORE_DEFAULTS, OWNER_TYPES, CONTACT_VET_LEVELS } from "./scoringDefaults";
import { safeNum } from "../../utils";

// ─── Normalize weights to sum to 1.0 ───
export const normalizeAcquisitionWeights = (dims) => {
  const total = dims.reduce((s, d) => s + d.weight, 0);
  if (total > 0 && Math.abs(total - 1.0) > 0.001) {
    dims.forEach((d) => { d.weight = d.weight / total; });
  }
  return dims;
};

// ─── Main Scoring Function ───
export const computeAcquisitionScore = (facility, config, buyerProfile) => {
  // Config = array of { key, weight, ... } — defaults or Firebase overrides
  // buyerProfile = optional buyer-specific weight overrides
  const dims = config || ACQUISITION_SCORE_DEFAULTS;

  // Merge buyer-specific weights if provided
  const effectiveDims = buyerProfile?.weights
    ? dims.map((d) => ({
        ...d,
        weight: buyerProfile.weights[d.key] !== undefined ? buyerProfile.weights[d.key] : d.weight,
      }))
    : dims;

  // Normalize
  normalizeAcquisitionWeights(effectiveDims);

  const getW = (key) => {
    const dim = effectiveDims.find((d) => d.key === key);
    return dim ? dim.weight : 0;
  };

  const scores = {};
  const flags = [];
  let hardFail = false;

  // ─── HELPERS ───
  const parseNum = (v) => {
    if (v == null || v === "") return 0;
    const s = String(v);
    const direct = Number(s);
    if (!isNaN(direct) && isFinite(direct)) return direct;
    const m = s.match(/[\d,.]+/);
    if (!m) return 0;
    return parseFloat(m[0].replace(/,/g, "")) || 0;
  };

  const monthsUntil = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    return Math.max(0, (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth()));
  };

  // ════════════════════════════════════════════════════════
  // DIMENSION 1: LOAN MATURITY PRESSURE (20% default)
  // Source: Crexi Intelligence — THE competitive moat
  // ════════════════════════════════════════════════════════
  let loanScore = 0;
  const crexi = facility.crexi || {};
  const maturityMonths = monthsUntil(crexi.loanMaturityDate);
  let loanExplain = "No loan maturity data";
  let loanRaw = null;
  let loanVerified = false;

  if (maturityMonths !== null) {
    loanVerified = true;
    loanRaw = `${maturityMonths} months (${crexi.loanMaturityDate})`;

    if (maturityMonths <= 6) { loanScore = 10; loanExplain = `Maturity in ${maturityMonths} mo — URGENT refinance pressure`; }
    else if (maturityMonths <= 12) { loanScore = 9; loanExplain = `Maturity in ${maturityMonths} mo — high pressure`; }
    else if (maturityMonths <= 18) { loanScore = 8; loanExplain = `Maturity in ${maturityMonths} mo — approaching deadline`; }
    else if (maturityMonths <= 24) { loanScore = 6; loanExplain = `Maturity in ${maturityMonths} mo — moderate pressure`; }
    else if (maturityMonths <= 36) { loanScore = 4; loanExplain = `Maturity in ${maturityMonths} mo — low urgency`; }
    else { loanScore = 2; loanExplain = `Maturity in ${maturityMonths} mo — no near-term pressure`; }

    // Bonus: High LTV at origination (more refinance pain)
    const ltv = safeNum(crexi.loanLTV);
    if (ltv > 70) { loanScore = Math.min(10, loanScore + 1); flags.push("High LTV at origination (>" + ltv + "%) — elevated refinance risk"); }

    // Bonus: Pre-2022 origination with low rate (rate shock from 3.5% to 7%+)
    const origYear = crexi.loanOriginationDate ? new Date(crexi.loanOriginationDate).getFullYear() : null;
    const origRate = safeNum(crexi.loanRate);
    if (origYear && origYear < 2022 && origRate > 0 && origRate < 4) {
      loanScore = Math.min(10, loanScore + 1);
      flags.push(`Rate shock: originated ${origYear} at ${origRate}% — refinancing at 7%+ doubles debt service`);
    }
  }
  scores.loanMaturity = Math.min(10, Math.max(0, loanScore));

  // ════════════════════════════════════════════════════════
  // DIMENSION 2: OWNERSHIP PROFILE (15% default)
  // Source: Crexi Intelligence + County Records
  // ════════════════════════════════════════════════════════
  let ownerScore = 5;
  const ownerType = (facility.owner?.type || facility.ownerType || "").toLowerCase().trim();
  let ownerExplain = "No ownership data — default 5";
  let ownerRaw = null;
  let ownerVerified = false;

  const ownerMatch = OWNER_TYPES.find((o) =>
    ownerType.includes(o.key) || ownerType.includes(o.label.toLowerCase())
  );
  if (ownerMatch) {
    ownerScore = ownerMatch.score;
    ownerExplain = `${ownerMatch.label} → ${ownerMatch.score}`;
    ownerRaw = ownerMatch.label;
    ownerVerified = true;
    if (ownerMatch.key === "government") {
      hardFail = true;
      flags.push("FAIL: Government/non-profit ownership — not acquirable");
    }
  } else if (ownerType) {
    // Try portfolio size parsing
    const portfolioSize = safeNum(facility.owner?.portfolioSize || facility.ownerPortfolioSize);
    if (portfolioSize > 0) {
      ownerVerified = true;
      if (portfolioSize === 1) { ownerScore = 10; ownerExplain = `Single facility owner — highest sell probability`; }
      else if (portfolioSize <= 3) { ownerScore = 9; ownerExplain = `Small LLC (${portfolioSize} facilities)`; }
      else if (portfolioSize <= 10) { ownerScore = 7; ownerExplain = `Small portfolio (${portfolioSize} facilities)`; }
      else if (portfolioSize <= 25) { ownerScore = 5; ownerExplain = `Regional operator (${portfolioSize} facilities)`; }
      else if (portfolioSize <= 50) { ownerScore = 3; ownerExplain = `Large portfolio (${portfolioSize} facilities)`; }
      else { ownerScore = 1; ownerExplain = `Institutional (${portfolioSize} facilities)`; }
      ownerRaw = `${portfolioSize} facilities`;
    }
  }
  scores.ownership = ownerScore;

  // ════════════════════════════════════════════════════════
  // DIMENSION 3: CAP RATE SPREAD (12% default)
  // Implied cap rate vs. market institutional cap rate
  // ════════════════════════════════════════════════════════
  let spreadScore = 5;
  const impliedCap = safeNum(facility.underwriting?.impliedCapRate || facility.impliedCapRate);
  const marketCap = safeNum(facility.underwriting?.marketCapRate || facility.marketCapRate);
  let spreadExplain = "No cap rate data — default 5";
  let spreadRaw = null;
  let spreadVerified = false;

  if (impliedCap > 0 && marketCap > 0) {
    const spreadBps = Math.round((impliedCap - marketCap) * 100);
    spreadRaw = `${spreadBps} bps (${impliedCap.toFixed(1)}% implied vs. ${marketCap.toFixed(1)}% market)`;
    spreadVerified = true;

    if (spreadBps > 200) { spreadScore = 10; spreadExplain = `${spreadBps} bps spread — massive value arbitrage`; }
    else if (spreadBps > 150) { spreadScore = 8; spreadExplain = `${spreadBps} bps spread — strong arbitrage`; }
    else if (spreadBps > 100) { spreadScore = 7; spreadExplain = `${spreadBps} bps spread — solid opportunity`; }
    else if (spreadBps > 50) { spreadScore = 5; spreadExplain = `${spreadBps} bps spread — moderate`; }
    else if (spreadBps > 0) { spreadScore = 3; spreadExplain = `${spreadBps} bps spread — thin margin`; }
    else { spreadScore = 1; spreadExplain = `Negative spread (${spreadBps} bps) — premium pricing`; }
  } else if (impliedCap > 0) {
    // Have implied cap but no market benchmark — score on absolute
    spreadVerified = true;
    spreadRaw = `${impliedCap.toFixed(1)}% implied cap (no market benchmark)`;
    if (impliedCap >= 8) { spreadScore = 8; spreadExplain = `High implied cap (${impliedCap.toFixed(1)}%) — likely undervalued`; }
    else if (impliedCap >= 6.5) { spreadScore = 6; spreadExplain = `Moderate implied cap (${impliedCap.toFixed(1)}%)`; }
    else if (impliedCap >= 5) { spreadScore = 4; spreadExplain = `Low implied cap (${impliedCap.toFixed(1)}%) — tight pricing`; }
    else { spreadScore = 2; spreadExplain = `Very low implied cap (${impliedCap.toFixed(1)}%) — premium`; }
  }
  scores.capRateSpread = spreadScore;

  // ════════════════════════════════════════════════════════
  // DIMENSION 4: FACILITY QUALITY & CONDITION (10% default)
  // ════════════════════════════════════════════════════════
  let qualityScore = 5;
  const yearBuilt = safeNum(facility.yearBuilt);
  const climatePct = safeNum(facility.climatePct);
  const googleRating = safeNum(facility.operations?.googleRating || facility.googleRating);
  let qualityExplain = "No facility data — default 5";
  let qualityRaw = null;
  let qualityVerified = false;

  if (yearBuilt > 0) {
    qualityVerified = true;
    const age = new Date().getFullYear() - yearBuilt;
    qualityRaw = `Built ${yearBuilt} (${age} yrs old)`;

    if (age <= 10) { qualityScore = 10; qualityExplain = `Modern (${yearBuilt}) — minimal deferred maintenance`; }
    else if (age <= 20) { qualityScore = 8; qualityExplain = `${yearBuilt} — well within useful life`; }
    else if (age <= 30) { qualityScore = 6; qualityExplain = `${yearBuilt} — mid-life, some capex likely`; }
    else if (age <= 40) { qualityScore = 4; qualityExplain = `${yearBuilt} — aging, deferred maintenance probable`; }
    else { qualityScore = 2; qualityExplain = `${yearBuilt} — significant renovation needed`; }

    // CC percentage bonus — modern CC facilities are worth more
    if (climatePct >= 80) qualityScore = Math.min(10, qualityScore + 1);
    else if (climatePct > 0 && climatePct < 20) qualityScore = Math.max(0, qualityScore - 1);
  }

  // Google review keyword analysis
  const reviewKeywords = facility.operations?.reviewKeywords || facility.reviewKeywords || [];
  const negativeKeywords = ["dirty", "broken", "pest", "unsafe", "mold", "flood", "rodent", "leak"];
  const positiveKeywords = ["clean", "secure", "modern", "friendly", "well-maintained", "excellent"];
  let reviewMod = 0;
  reviewKeywords.forEach((kw) => {
    const kwLower = String(kw).toLowerCase();
    if (negativeKeywords.some((nk) => kwLower.includes(nk))) reviewMod -= 1;
    if (positiveKeywords.some((pk) => kwLower.includes(pk))) reviewMod += 0.5;
  });
  reviewMod = Math.max(-3, Math.min(2, reviewMod));
  qualityScore = Math.min(10, Math.max(0, qualityScore + reviewMod));

  if (googleRating > 0) {
    qualityRaw = (qualityRaw || "") + ` | ${googleRating.toFixed(1)} stars`;
    if (googleRating < 3.0) { qualityScore = Math.max(0, qualityScore - 1); flags.push("Low Google rating (" + googleRating.toFixed(1) + ")"); }
  }
  scores.facilityQuality = Math.round(qualityScore * 10) / 10;

  // ════════════════════════════════════════════════════════
  // DIMENSION 5: VALUE-ADD POTENTIAL (10% default)
  // ════════════════════════════════════════════════════════
  let vaScore = 5;
  let vaExplain = "No value-add data — default 5";
  let vaRaw = null;
  let vaVerified = false;

  const facilityType = (facility.facilityType || "").toLowerCase();
  const currentOcc = safeNum(facility.operations?.occupancy || facility.occupancy);
  const belowMarketRent = facility.operations?.belowMarketRent || facility.belowMarketRent;
  const incN = parseNum(facility.income3mi);
  const vaSignals = [];

  // All drive-up in high-income market = massive CC conversion opportunity
  if ((facilityType === "driveup" || climatePct < 10) && incN >= 75000) {
    vaScore = 10;
    vaSignals.push("All drive-up in high-income market — CC conversion opportunity");
    vaVerified = true;
  } else if (climatePct > 0 && climatePct < 30 && incN >= 65000) {
    vaScore = 9;
    vaSignals.push("Low CC mix (" + climatePct + "%) in strong income market — conversion upside");
    vaVerified = true;
  }

  // Below-market rents signal
  if (belowMarketRent === true || belowMarketRent === "true") {
    vaScore = Math.min(10, vaScore + 2);
    vaSignals.push("Below-market rents — rent bump opportunity on day 1");
    vaVerified = true;
  }

  // Low occupancy = operational improvement opportunity (scored separately but synergizes)
  if (currentOcc > 0 && currentOcc < 75) {
    vaScore = Math.min(10, vaScore + 1);
    vaSignals.push("Low occupancy (" + currentOcc + "%) — operational turnaround opportunity");
    vaVerified = true;
  }

  // Technology upgrade signal — no smart access
  if (facility.hasSmartAccess === false) {
    vaScore = Math.min(10, vaScore + 1);
    vaSignals.push("No smart access system — technology upgrade opportunity");
    vaVerified = true;
  }

  if (vaSignals.length > 0) {
    vaExplain = vaSignals.join(". ");
    vaRaw = vaSignals.length + " value-add signals";
  }
  scores.valueAdd = Math.min(10, Math.max(0, vaScore));

  // ════════════════════════════════════════════════════════
  // DIMENSION 6: MARKET DEMOGRAPHICS (8% default)
  // Reuses ESRI engine — composite of pop, growth, HHI, households
  // ════════════════════════════════════════════════════════
  let demoScore = 5;
  let demoExplain = "No demographic data — default 5";
  let demoRaw = null;
  let demoVerified = false;
  const popRaw = parseNum(facility.pop3mi);
  const hhiRaw = parseNum(facility.income3mi);
  const growthRaw = parseFloat(String(facility.popGrowth3mi || facility.growthRate || "").replace(/[^0-9.\-]/g, "")) || 0;
  const hhRaw = parseNum(facility.households3mi);

  if (popRaw > 0 || hhiRaw > 0) {
    demoVerified = true;
    // Mini-composite: pop (30%), growth (30%), HHI (25%), HH (15%)
    let popSub = 5, growthSub = 5, hhiSub = 5, hhSub = 5;

    if (popRaw >= 40000) popSub = 10;
    else if (popRaw >= 25000) popSub = 8;
    else if (popRaw >= 15000) popSub = 6;
    else if (popRaw >= 10000) popSub = 5;
    else if (popRaw >= 5000) popSub = 3;
    else if (popRaw > 0) popSub = 1;

    if (growthRaw >= 2.0) growthSub = 10;
    else if (growthRaw >= 1.0) growthSub = 8;
    else if (growthRaw >= 0.5) growthSub = 6;
    else if (growthRaw >= 0) growthSub = 4;
    else growthSub = 2;

    if (hhiRaw >= 90000) hhiSub = 10;
    else if (hhiRaw >= 75000) hhiSub = 8;
    else if (hhiRaw >= 65000) hhiSub = 6;
    else if (hhiRaw >= 55000) hhiSub = 4;
    else if (hhiRaw > 0) hhiSub = 2;

    if (hhRaw >= 25000) hhSub = 10;
    else if (hhRaw >= 12000) hhSub = 7;
    else if (hhRaw >= 6000) hhSub = 5;
    else if (hhRaw > 0) hhSub = 3;

    demoScore = Math.round((popSub * 0.30 + growthSub * 0.30 + hhiSub * 0.25 + hhSub * 0.15) * 10) / 10;
    demoExplain = `Pop: ${popRaw.toLocaleString()} (${popSub}), Growth: ${growthRaw.toFixed(1)}% (${growthSub}), HHI: $${hhiRaw.toLocaleString()} (${hhiSub}), HH: ${hhRaw.toLocaleString()} (${hhSub})`;
    demoRaw = `${popRaw.toLocaleString()} pop | $${hhiRaw.toLocaleString()} HHI | ${growthRaw.toFixed(1)}% growth`;
  }
  scores.demographics = demoScore;

  // ════════════════════════════════════════════════════════
  // DIMENSION 7: COMPETITION DENSITY (7% default)
  // Reuses CC SPC engine from SiteScore
  // ════════════════════════════════════════════════════════
  let compScore = 6;
  let compExplain = "No competition data — default 6";
  let compRaw = null;
  let compVerified = false;
  const ccSPC = safeNum(facility.siteiqData?.ccSPC || facility.ccSPC);

  if (ccSPC > 0) {
    compVerified = true;
    compRaw = `${ccSPC.toFixed(1)} CC SF/capita`;
    if (ccSPC < 1.5) { compScore = 10; compExplain = `CC SPC ${ccSPC.toFixed(1)} — severely underserved`; }
    else if (ccSPC <= 3.0) { compScore = 8; compExplain = `CC SPC ${ccSPC.toFixed(1)} — underserved`; }
    else if (ccSPC <= 5.0) { compScore = 6; compExplain = `CC SPC ${ccSPC.toFixed(1)} — moderate`; }
    else if (ccSPC <= 7.0) { compScore = 5; compExplain = `CC SPC ${ccSPC.toFixed(1)} — well-supplied`; }
    else if (ccSPC <= 10.0) { compScore = 4; compExplain = `CC SPC ${ccSPC.toFixed(1)} — high supply`; }
    else if (ccSPC <= 15.0) { compScore = 3; compExplain = `CC SPC ${ccSPC.toFixed(1)} — near saturated`; }
    else { compScore = 1; compExplain = `CC SPC ${ccSPC.toFixed(1)} — oversaturated`; }
  }
  scores.competition = compScore;

  // ════════════════════════════════════════════════════════
  // DIMENSION 8: OCCUPANCY PERFORMANCE (6% default)
  // INVERTED: lower occupancy = higher score (value-add opportunity)
  // ════════════════════════════════════════════════════════
  let occScore = 5;
  let occExplain = "No occupancy data — default 5";
  let occRaw = null;
  let occVerified = false;

  if (currentOcc > 0) {
    occVerified = true;
    occRaw = `${currentOcc}% occupied`;
    // INVERTED — underperformance is the opportunity
    if (currentOcc < 70) { occScore = 10; occExplain = `${currentOcc}% — major upside (likely mismanaged)`; flags.push("Low occupancy (" + currentOcc + "%) — value-add opportunity"); }
    else if (currentOcc < 80) { occScore = 8; occExplain = `${currentOcc}% — significant lease-up opportunity`; }
    else if (currentOcc < 85) { occScore = 6; occExplain = `${currentOcc}% — moderate improvement potential`; }
    else if (currentOcc < 90) { occScore = 4; occExplain = `${currentOcc}% — healthy but limited upside`; }
    else if (currentOcc < 93) { occScore = 2; occExplain = `${currentOcc}% — near-stabilized`; }
    else { occScore = 1; occExplain = `${currentOcc}% — fully stabilized, premium pricing expected`; }
  }
  scores.occupancy = occScore;

  // ════════════════════════════════════════════════════════
  // DIMENSION 9: REIT PROXIMITY — MARKET VALIDATION (5% default)
  // ════════════════════════════════════════════════════════
  let reitScore = 5;
  let reitExplain = "No proximity data — default 5";
  let reitRaw = null;
  let reitVerified = false;
  const nearestREIT = safeNum(facility.siteiqData?.nearestPS || facility.nearestREIT);

  if (nearestREIT > 0) {
    reitVerified = true;
    reitRaw = `${nearestREIT.toFixed(1)} mi to nearest REIT facility`;
    if (nearestREIT <= 3) { reitScore = 10; reitExplain = `${nearestREIT.toFixed(1)} mi — strong market validation`; }
    else if (nearestREIT <= 5) { reitScore = 8; reitExplain = `${nearestREIT.toFixed(1)} mi — good validation`; }
    else if (nearestREIT <= 10) { reitScore = 6; reitExplain = `${nearestREIT.toFixed(1)} mi — moderate proximity`; }
    else if (nearestREIT <= 20) { reitScore = 4; reitExplain = `${nearestREIT.toFixed(1)} mi — distant`; }
    else { reitScore = 2; reitExplain = `${nearestREIT.toFixed(1)} mi — no REIT presence nearby`; }
  }
  scores.reitProximity = reitScore;

  // ════════════════════════════════════════════════════════
  // DIMENSION 10: FACILITY SIZE (4% default)
  // ════════════════════════════════════════════════════════
  let sizeScore = 5;
  let sizeExplain = "No size data — default 5";
  let sizeRaw = null;
  let sizeVerified = false;
  const totalSF = safeNum(facility.totalSF);

  if (totalSF > 0) {
    sizeVerified = true;
    sizeRaw = `${totalSF.toLocaleString()} SF`;
    if (totalSF >= 40000 && totalSF <= 80000) { sizeScore = 10; sizeExplain = `${totalSF.toLocaleString()} SF — sweet spot for acquisitions`; }
    else if (totalSF > 80000 && totalSF <= 120000) { sizeScore = 8; sizeExplain = `${totalSF.toLocaleString()} SF — larger but viable`; }
    else if (totalSF >= 25000 && totalSF < 40000) { sizeScore = 6; sizeExplain = `${totalSF.toLocaleString()} SF — smaller, tighter returns`; }
    else if (totalSF > 120000 && totalSF <= 200000) { sizeScore = 4; sizeExplain = `${totalSF.toLocaleString()} SF — large, higher basis`; }
    else if (totalSF < 25000) { sizeScore = 2; sizeExplain = `${totalSF.toLocaleString()} SF — may be too small for institutional buyers`; }
    else { sizeScore = 1; sizeExplain = `${totalSF.toLocaleString()} SF — very large, limited buyer pool`; }
  }
  scores.facilitySize = sizeScore;

  // ════════════════════════════════════════════════════════
  // DIMENSION 11: SUBMARKET RENT GROWTH (3% default)
  // ════════════════════════════════════════════════════════
  let rgScore = 5;
  let rgExplain = "No rent growth data — default 5";
  let rgRaw = null;
  let rgVerified = false;
  const rentGrowth = safeNum(facility.siteiqData?.msaCCGrowth || facility.msaCCGrowth || facility.rentGrowth);

  if (rentGrowth !== 0 || (facility.siteiqData?.msaCCGrowth !== undefined)) {
    const rg = rentGrowth;
    rgVerified = rg !== 0;
    rgRaw = `${rg.toFixed(1)}% CC rent growth`;
    if (rg > 5) { rgScore = 10; rgExplain = `${rg.toFixed(1)}% rent growth — exceptional tailwind`; }
    else if (rg >= 3) { rgScore = 8; rgExplain = `${rg.toFixed(1)}% rent growth — strong`; }
    else if (rg >= 2) { rgScore = 6; rgExplain = `${rg.toFixed(1)}% rent growth — healthy`; }
    else if (rg >= 1) { rgScore = 4; rgExplain = `${rg.toFixed(1)}% rent growth — modest`; }
    else if (rg >= 0) { rgScore = 2; rgExplain = `${rg.toFixed(1)}% rent growth — flat`; }
    else { rgScore = 0; rgExplain = `${rg.toFixed(1)}% — negative rent growth`; }
  }
  scores.rentGrowth = rgScore;

  // ════════════════════════════════════════════════════════
  // BINARY GATES (any triggers HARD FAIL)
  // ════════════════════════════════════════════════════════

  // Gate 1: Government/non-profit ownership (checked above in ownership)

  // Gate 2: Active environmental contamination
  if (facility.environmentalFlag === true || facility.environmentalFlag === "true") {
    hardFail = true;
    flags.push("FAIL: Active environmental contamination — Phase I/II flag");
  }

  // Gate 3: Uninsured flood zone
  const floodZone = (facility.floodZone || "").toLowerCase();
  if ((floodZone.includes("zone a") || floodZone.includes("zone ae")) && !facility.floodInsurance) {
    hardFail = true;
    flags.push("FAIL: Flood zone A/AE with no insurance or mitigation");
  }

  // ════════════════════════════════════════════════════════
  // COMPOSITE SCORE (weighted sum, 0-10 scale)
  // ════════════════════════════════════════════════════════
  const weightedSum =
    (scores.loanMaturity * getW("loanMaturity")) +
    (scores.ownership * getW("ownership")) +
    (scores.capRateSpread * getW("capRateSpread")) +
    (scores.facilityQuality * getW("facilityQuality")) +
    (scores.valueAdd * getW("valueAdd")) +
    (scores.demographics * getW("demographics")) +
    (scores.competition * getW("competition")) +
    (scores.occupancy * getW("occupancy")) +
    (scores.reitProximity * getW("reitProximity")) +
    (scores.facilitySize * getW("facilitySize")) +
    (scores.rentGrowth * getW("rentGrowth"));

  let adjusted = Math.round(weightedSum * 100) / 100;

  // ─── CONTACT INTELLIGENCE BONUS ───
  // Better contact data = higher confidence in closing
  const contactLevel = facility.owner?.contactVetLevel || facility.contactVetLevel;
  const vetLevel = CONTACT_VET_LEVELS.find((l) => l.key === contactLevel);
  if (vetLevel && vetLevel.confidence >= 0.85) {
    adjusted = Math.min(10, adjusted + 0.3);
    flags.push("Contact verified (" + vetLevel.label + ") — high close probability");
  } else if (vetLevel && vetLevel.confidence >= 0.6) {
    adjusted = Math.min(10, adjusted + 0.15);
  }

  // ─── PIPELINE STAGE BONUS ───
  const stage = (facility.pipeline?.stage || facility.stage || "").toLowerCase();
  if (/closed|under contract/i.test(stage)) adjusted = Math.min(10, adjusted + 0.3);
  else if (/psa/i.test(stage)) adjusted = Math.min(10, adjusted + 0.2);
  else if (/loi/i.test(stage)) adjusted = Math.min(10, adjusted + 0.15);
  else if (/interested/i.test(stage)) adjusted = Math.min(10, adjusted + 0.1);

  // ─── RESEARCH COMPLETENESS BONUS ───
  const researchChecks = [
    !!crexi.loanMaturityDate,
    !!facility.owner?.type || !!facility.ownerType,
    impliedCap > 0,
    yearBuilt > 0,
    currentOcc > 0,
    popRaw > 0,
    ccSPC > 0,
    nearestREIT > 0,
    totalSF > 0,
    facility.owner?.contactVetLevel != null,
  ];
  const researchPct = researchChecks.filter(Boolean).length / researchChecks.length;
  if (researchPct === 1) adjusted = Math.min(10, adjusted + 0.5);
  else if (researchPct >= 0.7) adjusted = Math.min(10, adjusted + 0.3);
  else if (researchPct < 0.3) adjusted = Math.max(0, adjusted - 0.2);

  const final = Math.round(adjusted * 100) / 100;

  // ─── CLASSIFICATION ───
  let classification, classColor;
  if (hardFail) { classification = "RED"; classColor = "#DC2626"; }
  else if (final >= 8.0) { classification = "GREEN"; classColor = "#16A34A"; }
  else if (final >= 6.0) { classification = "YELLOW"; classColor = "#D97706"; }
  else if (final >= 4.0) { classification = "ORANGE"; classColor = "#EA580C"; }
  else { classification = "RED"; classColor = "#DC2626"; }

  // ─── BUILD BREAKDOWN (matches SiteScore shape for badge reuse) ───
  const breakdown = [
    {
      label: "Loan Maturity", key: "loanMaturity",
      score: scores.loanMaturity, weight: getW("loanMaturity"),
      reason: loanExplain,
      source: "Crexi Intelligence", rawValue: loanRaw,
      methodology: "Months until loan maturity scored on urgency tiers. Bonuses for high LTV (>70%) and pre-2022 rate shock.",
      verified: loanVerified,
    },
    {
      label: "Ownership", key: "ownership",
      score: scores.ownership, weight: getW("ownership"),
      reason: ownerExplain,
      source: "Crexi Intelligence + County Records", rawValue: ownerRaw,
      methodology: "Owner classification by portfolio size: individual (10) → institutional (1). Government = HARD FAIL.",
      verified: ownerVerified,
    },
    {
      label: "Cap Rate Spread", key: "capRateSpread",
      score: scores.capRateSpread, weight: getW("capRateSpread"),
      reason: spreadExplain,
      source: "Crexi Transactions + MSA Intelligence", rawValue: spreadRaw,
      methodology: "Spread between implied facility cap rate and market institutional cap rate. >200 bps = 10 (massive arbitrage).",
      verified: spreadVerified,
    },
    {
      label: "Facility Quality", key: "facilityQuality",
      score: scores.facilityQuality, weight: getW("facilityQuality"),
      reason: qualityExplain,
      source: "Google Reviews + Building Permits + Imagery", rawValue: qualityRaw,
      methodology: "Year built + CC% + Google review keyword sentiment analysis.",
      verified: qualityVerified,
    },
    {
      label: "Value-Add", key: "valueAdd",
      score: scores.valueAdd, weight: getW("valueAdd"),
      reason: vaExplain,
      source: "Facility Analysis + Market Comps", rawValue: vaRaw,
      methodology: "CC conversion potential, below-market rents, occupancy improvement, technology upgrade signals.",
      verified: vaVerified,
    },
    {
      label: "Demographics", key: "demographics",
      score: scores.demographics, weight: getW("demographics"),
      reason: demoExplain,
      source: "ESRI GeoEnrichment 2025", rawValue: demoRaw,
      methodology: "Composite: Population (30%) + Growth (30%) + HHI (25%) + Households (15%). 3-mile radial rings.",
      verified: demoVerified,
    },
    {
      label: "Competition", key: "competition",
      score: scores.competition, weight: getW("competition"),
      reason: compExplain,
      source: "CC SPC Analysis (Facility Census + ESRI)", rawValue: compRaw,
      methodology: "Climate-controlled SF per capita in 3-mile trade area. <1.5 = underserved (10), >15 = saturated (1).",
      verified: compVerified,
    },
    {
      label: "Occupancy", key: "occupancy",
      score: scores.occupancy, weight: getW("occupancy"),
      reason: occExplain,
      source: "SpareFoot / Operator Websites / Crexi", rawValue: occRaw,
      methodology: "INVERTED scoring: lower occupancy = higher score (underperformance = value-add opportunity for acquirer).",
      verified: occVerified,
    },
    {
      label: "REIT Proximity", key: "reitProximity",
      score: scores.reitProximity, weight: getW("reitProximity"),
      reason: reitExplain,
      source: "PS + NSA + EXR Location Database", rawValue: reitRaw,
      methodology: "Haversine distance to nearest REIT facility. Proximity validates submarket demand and institutional confidence.",
      verified: reitVerified,
    },
    {
      label: "Facility Size", key: "facilitySize",
      score: scores.facilitySize, weight: getW("facilitySize"),
      reason: sizeExplain,
      source: "Crexi Intelligence / Tax Records", rawValue: sizeRaw,
      methodology: "Sweet spot 40K-80K SF = 10 (optimal for SK/StorQuest acquisitions). Sub-25K or 200K+ = 2.",
      verified: sizeVerified,
    },
    {
      label: "Rent Growth", key: "rentGrowth",
      score: scores.rentGrowth, weight: getW("rentGrowth"),
      reason: rgExplain,
      source: "MSA CC Rent Intelligence (REIT 10-K)", rawValue: rgRaw,
      methodology: "Submarket CC rent growth trajectory from REIT quarterly filings. >5% = 10 (exceptional tailwind).",
      verified: rgVerified,
    },
  ];

  // ─── BUYER-SPECIFIC SCORES (if we have buyer profiles) ───
  // Compute score under each buyer's weight profile for routing
  const buyerScores = {};
  // This is called externally per-buyer; we include a convenience method
  // that the routing panel uses.

  return {
    score: final,
    scores,
    flags,
    hardFail,
    classification,
    classColor,
    breakdown,
    researchPct: Math.round(researchPct * 100),
    tier: final >= 8 ? "gold" : final >= 6 ? "steel" : "gray",
    label: final >= 9 ? "ELITE TARGET" : final >= 8 ? "PRIME TARGET" : final >= 7 ? "STRONG" : final >= 6 ? "VIABLE" : final >= 4 ? "MARGINAL" : "PASS",
    buyerScores,
  };
};

// ─── Multi-Buyer Scoring — scores one facility for all buyer profiles ───
export const scoreForAllBuyers = (facility, config, buyerProfiles) => {
  const results = {};
  Object.entries(buyerProfiles).forEach(([id, profile]) => {
    results[id] = computeAcquisitionScore(facility, config, profile);
  });
  return results;
};

// ─── Owner Contact Intelligence — Deep Vet Scoring ───
// Crexi Intelligence provides raw contact info. This module scores the
// QUALITY of that contact data and suggests next verification steps.
export const scoreContactIntelligence = (owner) => {
  if (!owner) return { confidence: 0, level: "unknown", nextStep: "Pull from Crexi Intelligence" };

  const checks = {
    hasName: !!owner.name,
    hasEmail: !!owner.email,
    hasPhone: !!owner.phone,
    hasMailingAddress: !!owner.mailingAddress,
    isEntityUnmasked: !!owner.entityName && !owner.entityName.includes("LLC") || !!owner.registeredAgent,
    isPhoneVerified: owner.phoneVerified === true,
    isEmailVerified: owner.emailVerified === true,
    hasDecisionMaker: !!owner.decisionMakerName,
    hasLinkedIn: !!owner.linkedInUrl,
    hasConversation: owner.contactVetLevel === "direct_conversation",
  };

  const score = Object.values(checks).filter(Boolean).length;
  const confidence = score / Object.keys(checks).length;

  let level, nextStep;
  if (confidence >= 0.9) { level = "verified"; nextStep = "Ready for outreach — all contacts validated"; }
  else if (confidence >= 0.7) { level = "strong"; nextStep = "Verify phone/email via direct call"; }
  else if (confidence >= 0.5) { level = "moderate"; nextStep = "Scrub: Secretary of State for registered agent, LinkedIn for decision-maker"; }
  else if (confidence >= 0.3) { level = "weak"; nextStep = "Deep scrub: County records for owner entity, SOS filing, web search for principal"; }
  else { level = "raw"; nextStep = "Start with Crexi Intelligence — pull ownership + loan data"; }

  return {
    confidence: Math.round(confidence * 100),
    level,
    nextStep,
    checks,
    vetSteps: generateVetSteps(owner, checks),
  };
};

// ─── Generate Ordered Vet Steps for Contact Intel ───
function generateVetSteps(owner, checks) {
  const steps = [];

  if (!checks.hasName || !checks.hasEmail) {
    steps.push({
      priority: 1,
      action: "Pull from Crexi Intelligence",
      detail: "Search property address on Crexi Intelligence. Click eyeball icon to reveal masked email. Record owner entity name.",
      source: "Crexi Intelligence",
    });
  }

  if (!checks.isEntityUnmasked) {
    steps.push({
      priority: 2,
      action: "Unmask entity via Secretary of State",
      detail: "Search entity name on state SOS database. Get registered agent name, address, formation date. This reveals the human behind the LLC.",
      source: "State SOS Database",
    });
  }

  if (!checks.hasDecisionMaker) {
    steps.push({
      priority: 3,
      action: "Identify decision-maker via LinkedIn",
      detail: "Search owner name + entity name on LinkedIn. Look for title: Owner, Managing Member, Principal. Cross-reference with SOS registered agent.",
      source: "LinkedIn",
    });
  }

  if (!checks.hasPhone || !checks.isPhoneVerified) {
    steps.push({
      priority: 4,
      action: "Verify phone via county records + web scrub",
      detail: "Check county tax records for owner phone. Search entity name + city on Google for business listings. Try firm website if operator has one.",
      source: "County Records + Web Search",
    });
  }

  if (!checks.isEmailVerified) {
    steps.push({
      priority: 5,
      action: "Verify email deliverability",
      detail: "Cross-reference Crexi email against: (1) firm domain via website, (2) NAI/SVN/broker directory, (3) LinkedIn profile. Pattern-match if needed.",
      source: "Web Verification",
    });
  }

  if (checks.hasEmail && checks.hasPhone && !checks.hasConversation) {
    steps.push({
      priority: 6,
      action: "Initial outreach — gauge interest",
      detail: "Draft professional cold outreach. Frame as buyer's broker for national storage operator. Do NOT name the buyer. Gauge interest before pricing discussion.",
      source: "Direct Outreach",
    });
  }

  return steps;
}
