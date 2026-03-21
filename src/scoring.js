// ─── Scoring Engine — SiteScore & Financial Models ───
// Extracted from App.js for reuse across modules

// ─── SiteScore™ v3.1 — 10-Dimension Calibrated Scoring Engine ───
// Matches CLAUDE.md §6h framework. Uses structured data fields, not regex on summary text.
// Default weights: Pop 16%, Growth 21%, HHI 10%, Households 5%, HomeValue 5%, Zoning 16%, PS Proximity 11%, Access 7%, Competition 7%, Market 2%
// Pricing removed — land valuation handled by Pricing Report's Land Acquisition Price Guide.
// Hard FAIL: pop <5K, HHI <$55K, landlocked, >35mi from nearest PS
export const computeSiteScore = (site, siteScoreConfig) => {
  const getIQWeight = (key) => {
    const dim = siteScoreConfig.find(d => d.key === key);
    return dim ? dim.weight : 0;
  };

  const scores = {};
  const flags = [];
  let hardFail = false;
  const summary = (site.summary || "").toLowerCase();
  const combinedText = ((site.zoning || "") + " " + (site.summary || "")).toLowerCase();

  // --- HELPERS ---
  const parseNum = (v) => { const n = parseInt(String(v || "").replace(/[^0-9]/g, ""), 10); return isNaN(n) ? 0 : n; };
  let acres = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
  if (isNaN(acres) || acres === 0) {
    const acMatch = (site.askingPrice || "").match(/([\d,.]+)\s*(?:\+\/-)?\s*(?:acres?|ac\b)/i);
    if (acMatch) acres = parseFloat(acMatch[1].replace(/,/g, ""));
  }
  const popRaw = parseNum(site.pop3mi);
  const incRaw = parseNum(site.income3mi);
  const hasDemoData = popRaw > 0 || incRaw > 0;

  // --- 1. DEMOGRAPHICS — POPULATION (16%) §6h calibrated ---
  let popScore = 5;
  if (popRaw > 0) {
    if (popRaw >= 40000) popScore = 10;
    else if (popRaw >= 25000) popScore = 8;
    else if (popRaw >= 15000) popScore = 6;
    else if (popRaw >= 10000) popScore = 5;
    else if (popRaw >= 5000) popScore = 3;
    else { popScore = 0; hardFail = true; flags.push("FAIL: 3-mi pop under 5,000"); }
  }
  scores.population = popScore;

  // --- 2. DEMOGRAPHICS — HHI (10%) §6h calibrated ---
  let incScore = 5;
  if (incRaw > 0) {
    if (incRaw >= 90000) incScore = 10;
    else if (incRaw >= 75000) incScore = 8;
    else if (incRaw >= 65000) incScore = 6;
    else if (incRaw >= 55000) incScore = 4;
    else { incScore = 0; hardFail = true; flags.push("FAIL: 3-mi HHI under $55K"); }
  }
  scores.income = incScore;

  // --- 2b. GROWTH (18%) — ESRI 5-year population CAGR ---
  let growthScore = 5; // default when no ESRI data
  const growthRaw = site.popGrowth3mi ? parseFloat(String(site.popGrowth3mi).replace(/[^0-9.\-+]/g, "")) : null;
  if (growthRaw !== null && !isNaN(growthRaw)) {
    if (growthRaw >= 2.0) growthScore = 10;       // booming — Sun Belt corridors
    else if (growthRaw >= 1.5) growthScore = 9;    // strong growth
    else if (growthRaw >= 1.0) growthScore = 8;    // healthy above-national
    else if (growthRaw >= 0.5) growthScore = 6;    // moderate positive
    else if (growthRaw >= 0.0) growthScore = 4;    // flat — no tailwind
    else if (growthRaw >= -0.5) growthScore = 2;   // declining — headwind
    else { growthScore = 0; flags.push("WARN: 3-mi pop declining > -0.5%/yr"); }
  }
  scores.growth = growthScore;

  // --- Growth corridor exemption — exurban boomtowns (Hockley TX, etc.) ---
  // If pop is 2,500–5,000 but growth is booming (≥8), don't hard-FAIL.
  // These are tomorrow's 20K+ suburbs — score low but keep alive.
  if (popRaw > 0 && popRaw < 5000 && popRaw >= 2500 && growthScore >= 8) {
    popScore = 2;
    scores.population = popScore;
    hardFail = false;
    const failIdx = flags.indexOf("FAIL: 3-mi pop under 5,000");
    if (failIdx !== -1) flags.splice(failIdx, 1);
    flags.push("Growth corridor: pop under 5K but high growth — scored 2 (not FAIL)");
  }

  // --- 2c. HOUSEHOLDS (5%) — 3-mi household count (demand proxy) ---
  let hhScore = 5;
  const hhRaw = parseNum(site.households3mi);
  if (hhRaw > 0) {
    if (hhRaw >= 25000) hhScore = 10;
    else if (hhRaw >= 18000) hhScore = 8;
    else if (hhRaw >= 12000) hhScore = 7;
    else if (hhRaw >= 6000) hhScore = 5;
    else hhScore = 3;
  }
  scores.households = hhScore;

  // --- 2d. HOME VALUE (5%) — 3-mi median home value (affluence signal) ---
  let hvScore = 5;
  const hvRaw = parseNum(site.homeValue3mi);
  if (hvRaw > 0) {
    if (hvRaw >= 500000) hvScore = 10;
    else if (hvRaw >= 350000) hvScore = 9;
    else if (hvRaw >= 250000) hvScore = 8;
    else if (hvRaw >= 180000) hvScore = 6;
    else if (hvRaw >= 120000) hvScore = 4;
    else hvScore = 2;
  }
  scores.homeValue = hvScore;

  // --- 2e. PS PROXIMITY (10%) — Distance to nearest PS location ---
  // Closer = market validation, NOT cannibalization. >35mi = too remote (FAIL).
  let psProxScore = 5;
  const nearestPS = site.siteiqData?.nearestPS;
  if (nearestPS !== undefined && nearestPS !== null) {
    const psDist = parseFloat(String(nearestPS));
    if (!isNaN(psDist)) {
      if (psDist > 35) { psProxScore = 0; hardFail = true; flags.push("FAIL: >35 mi from nearest PS location — too remote"); }
      else if (psDist <= 5) psProxScore = 10;
      else if (psDist <= 10) psProxScore = 9;
      else if (psDist <= 15) psProxScore = 7;
      else if (psDist <= 25) psProxScore = 5;
      else psProxScore = 3;
    }
  }
  scores.psProximity = psProxScore;

  // --- 3. ZONING (16%) §6c methodology ---
  // Prefer structured zoningClassification field; fall back to regex on zoning + summary text
  // SOURCE NOTE: ETJ / unincorporated / no zoning = 10/10 (BEST outcome for storage).
  // Under Texas law (Ch. 231 LGC), counties have no zoning authority. ETJ grants platting control only, NOT use restrictions.
  // We actively target unzoned land — it's a HUGE positive, not a neutral score.
  let zoningScore = 3;
  const zClass = site.zoningClassification;
  if (zClass && zClass !== "unknown") {
    if (zClass === "by-right") zoningScore = 10;
    else if (zClass === "conditional") zoningScore = 6;
    else if (zClass === "rezone-required") zoningScore = 2;
    else if (zClass === "prohibited") { zoningScore = 0; hardFail = true; flags.push("FAIL: Zoning prohibits storage"); }
  } else {
    // "no zoning", "unincorporated", "ETJ", "unrestricted" = 10/10 — best possible outcome
    const noZoning = /(no\s*zoning|unincorporated|unrestricted|\bETJ\b|county\s*[-—]\s*no\s*zon)/i;
    const byRight = /(by\s*right|permitted|storage\s*(?:by|permitted)|(?:^|\s)(?:cs|gb|mu|b[- ]?\d|c[- ]?\d|m[- ]?\d)\b|commercial|industrial|business|pud\s*allow)/i;
    const conditional = /(conditional|sup\b|cup\b|special\s*use|overlay|variance|needs?\s*sup)/i;
    const prohibited = /(prohibited|residential\s*only|(?:^|\s)ag\b|agriculture|not\s*permitted)/i;
    const rezoning = /(rezone|rezoning\s*required)/i;
    if (noZoning.test(combinedText)) zoningScore = 10; // No zoning = unrestricted = best score
    else if (byRight.test(combinedText)) zoningScore = 10;
    else if (conditional.test(combinedText)) zoningScore = 6;
    else if (rezoning.test(combinedText)) zoningScore = 2;
    else if (prohibited.test(combinedText)) { zoningScore = 0; hardFail = true; flags.push("FAIL: Zoning prohibits storage"); }
    else if ((site.zoning || "").trim()) zoningScore = 5;
  }
  scores.zoning = zoningScore;

  // --- 5. ACCESS & VISIBILITY (7%) ---
  let accessScore = 5;
  if (!isNaN(acres) && acres > 0) {
    if (acres >= 3.5 && acres <= 5) accessScore = 8;
    else if (acres >= 2.5 && acres < 3.5) accessScore = 6;
    else if (acres > 5 && acres <= 7) accessScore = 7;
    else if (acres > 7) accessScore = 5;
    else if (acres >= 2) accessScore = 4;
    else accessScore = 2;
  }
  if (/\d+['\s]*(?:frontage|front|linear)/i.test(summary) || /frontage/i.test(summary)) accessScore = Math.min(10, accessScore + 2);
  if (/landlocked|no\s*access|easement\s*only/i.test(summary)) { accessScore = 0; hardFail = true; flags.push("FAIL: Landlocked / no road access"); }
  if (/flood/i.test(summary)) accessScore = Math.max(1, accessScore - 2);
  if (/take\s*half|subdivis|split/i.test(summary) && !isNaN(acres) && acres > 5) accessScore = Math.min(10, accessScore + 2);
  scores.access = Math.min(10, Math.max(0, accessScore));

  // --- 6. COMPETITION (5%) ---
  let compScore = 6;
  const compCount = site.siteiqData?.competitorCount;
  if (compCount !== undefined && compCount !== null) {
    if (compCount <= 1) compScore = 10;
    else if (compCount <= 3) compScore = 6;
    else compScore = 3;
  } else {
    if (/no\s*(?:nearby|existing)\s*(?:storage|competition|competitor)/i.test(summary) || /low\s*competition/i.test(summary)) compScore = 9;
    else if (/storage\s*(?:next\s*door|adjacent|nearby)/i.test(summary) || /high\s*competition/i.test(summary) || /saturated/i.test(summary)) compScore = 3;
    else if (/competitor/i.test(summary)) compScore = 5;
  }
  scores.competition = compScore;

  // --- 7. MARKET TIER (2%) ---
  let tierScore = 2;
  const tier = site.siteiqData?.marketTier;
  if (tier === 1) tierScore = 10;
  else if (tier === 2) tierScore = 8;
  else if (tier === 3) tierScore = 6;
  else if (tier === 4) tierScore = 4;
  else {
    const mkt = (site.market || "").toLowerCase();
    if (/cinc|nky|n\.?\s*ky|northern\s*kent/i.test(mkt)) tierScore = 10;
    else if (/ind|indy/i.test(mkt)) tierScore = 10;
    else if (/independence|springboro|s\.?\s*dayton/i.test(mkt)) tierScore = 8;
    else if (/tn|tenn|nashville|murfreesboro|clarksville|lebanon/i.test(mkt)) tierScore = 6;
    else if (/dfw|dallas|austin|houston|san\s*ant/i.test(mkt)) tierScore = 4;
  }
  scores.marketTier = tierScore;

  // --- COMPOSITE (weighted sum, 0-10 scale) — uses configurable weights, 10 dimensions ---
  const weightedSum =
    (popScore * getIQWeight("population")) + (growthScore * getIQWeight("growth")) +
    (incScore * getIQWeight("income")) + (hhScore * getIQWeight("households")) +
    (hvScore * getIQWeight("homeValue")) +
    (zoningScore * getIQWeight("zoning")) + (psProxScore * getIQWeight("psProximity")) +
    (scores.access * getIQWeight("access")) +
    (compScore * getIQWeight("competition")) + (tierScore * getIQWeight("marketTier"));
  let adjusted = Math.round(weightedSum * 10) / 10;

  // --- PHASE BONUS ---
  const phase = (site.phase || "").toLowerCase();
  if (/under contract|closed/i.test(phase)) adjusted = Math.min(10, adjusted + 0.3);
  else if (/psa sent/i.test(phase)) adjusted = Math.min(10, adjusted + 0.2);
  else if (/^loi$/i.test(phase)) adjusted = Math.min(10, adjusted + 0.15);
  else if (/sitescore approved|sitescore approved|ps approved/i.test(phase)) adjusted = Math.min(10, adjusted + 0.1);

  // --- STALE LISTING PENALTY ---
  if (site.dateOnMarket) {
    const dom = Math.floor((Date.now() - new Date(site.dateOnMarket).getTime()) / 86400000);
    if (dom > 1000) { adjusted = Math.max(0, adjusted - 0.5); flags.push("Stale: " + dom + " DOM"); }
  }

  // --- BROKER INTEL BONUSES (from siteiqData) ---
  if (site.siteiqData?.brokerConfirmedZoning) adjusted = Math.min(10, adjusted + 0.3);
  if (site.siteiqData?.surveyClean) adjusted = Math.min(10, adjusted + 0.2);

  // --- WATER HOOKUP — HARD REQUIREMENT ---
  // SOURCE NOTE: Water hookup is a MUST for self-storage. Fire suppression (sprinkler systems)
  // requires municipal-grade pressure and flow. We don't need to be IN a MUD — we just need
  // to be able to HOOK UP to the nearest water main. Line extension is a cost item, not a
  // deal killer. The deal killer is if there's NO water main within reasonable distance.
  // Septic is fine for sewer (storage has minimal wastewater), but water is non-negotiable.
  if (site.waterAvailable === false) {
    if (site.waterProvider && site.waterProvider.length > 10) {
      // Provider identified but not currently connected — line extension likely needed. Flag but don't kill.
      flags.push("⚠ WATER: Not currently connected — line extension to nearest main required. Verify distance & cost.");
      adjusted = Math.max(0, adjusted - 0.3);
    } else {
      // No provider identified at all — high risk
      flags.push("⚠ WATER: No water provider identified — verify hookup feasibility (HARD REQUIREMENT for fire suppression)");
      adjusted = Math.max(0, adjusted - 1.0);
    }
  }

  // --- RESEARCH COMPLETENESS — HARD VET BEFORE SCORE ---
  // SiteScore incorporates depth of due diligence research.
  // Sites with verified primary-source research score higher than unvetted sites.
  // Source: CLAUDE.md §6h — "HARD VET, then SiteScore, not the other way around"
  const vetChecks = [
    !!site.zoningSource,                                          // Ordinance cited
    !!site.zoningClassification && site.zoningClassification !== "unknown",  // Classification confirmed
    !!site.zoningNotes && site.zoningNotes.length > 20,           // Permitted use table reviewed
    !!site.zoningUseTerm,                                          // Exact use category from table
    !!site.waterProvider,                                          // Water provider identified
    site.waterAvailable === true || site.waterAvailable === false, // Water availability confirmed
    site.insideServiceBoundary === true || site.insideServiceBoundary === false, // Service boundary checked
    !!site.distToWaterMain,                                        // Distance to water main known
    site.fireFlowAdequate === true || site.fireFlowAdequate === false, // Fire flow assessed
    !!site.sewerProvider || /septic/i.test(combinedText),          // Sewer/septic solution
    !!site.electricProvider,                                       // Electric provider identified
    !!site.floodZone,                                              // FEMA flood zone checked
    !!site.planningContact,                                        // Planning dept contact found
    site.siteiqData?.competitorCount !== undefined && site.siteiqData?.competitorCount !== null, // Competition scanned
    site.siteiqData?.nearestPS !== undefined && site.siteiqData?.nearestPS !== null, // PS proximity checked
    !!site.households3mi || !!site.homeValue3mi,                   // Demo depth (households or home value)
    !!site.roadFrontage || !!site.frontageRoadName,                // Site access assessed
  ];
  const vetDone = vetChecks.filter(Boolean).length;
  const vetPct = vetDone / vetChecks.length;
  // Full vet (100%) = +0.5 bonus. Partial vet scales linearly. Zero vet = -0.3 penalty.
  if (vetPct === 1) { adjusted = Math.min(10, adjusted + 0.5); }
  else if (vetPct >= 0.7) { adjusted = Math.min(10, adjusted + 0.3); }
  else if (vetPct >= 0.4) { /* no adjustment — neutral */ }
  else if (vetPct > 0) { adjusted = Math.max(0, adjusted - 0.1); }
  else { adjusted = Math.max(0, adjusted - 0.3); flags.push("No deep vet research completed"); }

  const final = Math.round(adjusted * 10) / 10;

  // --- CLASSIFICATION (§6h) ---
  let classification, classColor;
  if (hardFail) { classification = "RED"; classColor = "#DC2626"; }
  else if (final >= 8.0) { classification = "GREEN"; classColor = "#16A34A"; }
  else if (final >= 6.0) { classification = "YELLOW"; classColor = "#D97706"; }
  else if (final >= 4.0) { classification = "ORANGE"; classColor = "#EA580C"; }
  else { classification = "RED"; classColor = "#DC2626"; }

  const breakdown = [
    { label: "Population", key: "population", score: scores.population, weight: getIQWeight("population") },
    { label: "Growth", key: "growth", score: scores.growth, weight: getIQWeight("growth") },
    { label: "Income", key: "income", score: scores.income, weight: getIQWeight("income") },
    { label: "Households", key: "households", score: scores.households, weight: getIQWeight("households") },
    { label: "Home Value", key: "homeValue", score: scores.homeValue, weight: getIQWeight("homeValue") },
    { label: "Zoning", key: "zoning", score: scores.zoning, weight: getIQWeight("zoning") },
    { label: "PS Proximity", key: "psProximity", score: scores.psProximity, weight: getIQWeight("psProximity") },
    { label: "Access", key: "access", score: scores.access, weight: getIQWeight("access") },
    { label: "Competition", key: "competition", score: scores.competition, weight: getIQWeight("competition") },
    { label: "Market Tier", key: "marketTier", score: scores.marketTier, weight: getIQWeight("marketTier") },
  ];
  return {
    score: final, scores, flags, hardFail, hasDemoData, classification, classColor, breakdown,
    tier: final >= 8 ? "gold" : final >= 6 ? "steel" : "gray",
    label: final >= 9 ? "ELITE" : final >= 8 ? "PRIME" : final >= 7 ? "STRONG" : final >= 6 ? "VIABLE" : final >= 4 ? "MARGINAL" : "WEAK",
  };
};

// ─── Financial Model — Full Development Pro Forma ───
export const computeSiteFinancials = (site) => {
  const parseP = (v) => { if (!v) return NaN; const s = String(v).replace(/,/g, ""); const m = s.match(/([\d.]+)\s*[Mm]/); if (m) return parseFloat(m[1]) * 1000000; return parseFloat(s.replace(/[^0-9.]/g, "")); };
  const acres = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
  const askRaw = parseP(site.askingPrice);
  const intRaw = parseP(site.internalPrice);
  const landCost = !isNaN(intRaw) && intRaw > 0 ? intRaw : (!isNaN(askRaw) ? askRaw : 0);
  const popN = parseInt(String(site.pop3mi || "").replace(/[^0-9]/g, ""), 10) || 0;
  const incN = parseInt(String(site.income3mi || "").replace(/[^0-9]/g, ""), 10) || 0;
  const hvN = parseInt(String(site.homeValue3mi || "").replace(/[^0-9]/g, ""), 10) || 0;
  const hhN = parseInt(String(site.households3mi || "").replace(/[^0-9]/g, ""), 10) || 0;
  const pop1 = parseInt(String(site.pop1mi || "").replace(/[^0-9]/g, ""), 10) || 0;
  const growthStr = site.popGrowth3mi || site.growthRate || "";
  const growthPct = parseFloat(String(growthStr).replace(/[^0-9.\-]/g, "")) || 0;
  const compCount = site.siteiqData?.competitorCount || 0;
  const nearestPS = site.siteiqData?.nearestPS || null;

  // ── Facility Sizing Model ──
  // Multi-story (2.5–3.5 ac): 3-story, higher climate ratio (smaller footprint = maximize rentable SF)
  // One-story (3.5+ ac): PS suburban format — 65/35 climate/drive-up per Killeen TX site sketch (Option A, Dec 2024)
  const isMultiStory = !isNaN(acres) && acres < 3.5 && acres >= 2.5;
  const stories = isMultiStory ? 3 : 1;
  const footprint = !isNaN(acres) ? Math.round(acres * 43560 * 0.35) : 60000; // 35% coverage confirmed by Killeen sketch
  const totalSF = footprint * stories;
  const climatePct = isMultiStory ? 0.75 : 0.65; // Multi-story: 75% climate (vertical = all indoor). One-story: 65% per PS Killeen layout
  const drivePct = 1 - climatePct;
  const climateSF = Math.round(totalSF * climatePct);
  const driveSF = Math.round(totalSF * drivePct);

  // ── Market Rate Intelligence ──
  const incTier = incN >= 90000 ? "premium" : incN >= 75000 ? "upper" : incN >= 60000 ? "mid" : "value";
  const baseClimateRate = incTier === "premium" ? 1.45 : incTier === "upper" ? 1.25 : incTier === "mid" ? 1.10 : 0.95;
  const baseDriveRate = incTier === "premium" ? 0.85 : incTier === "upper" ? 0.72 : incTier === "mid" ? 0.62 : 0.52;
  const compAdj = compCount <= 2 ? 1.08 : compCount <= 5 ? 1.00 : compCount <= 8 ? 0.94 : 0.88;
  const mktClimateRate = Math.round(baseClimateRate * compAdj * 100) / 100;
  const mktDriveRate = Math.round(baseDriveRate * compAdj * 100) / 100;

  // ── 5-Year Lease-Up Model ──
  const leaseUpSchedule = [
    { yr: 1, label: "Year 1 — Launch & Fill", occRate: 0.30, climDisc: 0.35, driveDisc: 0.30, desc: "Grand opening promos. First month free. 50% off first 3 months. Heavy marketing spend." },
    { yr: 2, label: "Year 2 — Ramp", occRate: 0.55, climDisc: 0.15, driveDisc: 0.12, desc: "Reduce promotions. Begin ECRI on Y1 tenants. Organic demand building." },
    { yr: 3, label: "Year 3 — Growth", occRate: 0.75, climDisc: 0.05, driveDisc: 0.05, desc: "Minimal discounting. ECRIs on Y1-Y2 tenants (+8-12%/yr typical)." },
    { yr: 4, label: "Year 4 — Stabilization", occRate: 0.88, climDisc: 0.00, driveDisc: 0.00, desc: "At or near market rate. ECRIs pushing above street rate." },
    { yr: 5, label: "Year 5 — Mature", occRate: 0.92, climDisc: 0.00, driveDisc: 0.00, desc: "Fully stabilized. ECRI revenue above street rate." },
  ];
  const annualEsc = 0.03;

  const yearData = leaseUpSchedule.map((y, i) => {
    const escMult = Math.pow(1 + annualEsc, i);
    const climRate = Math.round((mktClimateRate * escMult * (1 - y.climDisc)) * 100) / 100;
    const driveRate = Math.round((mktDriveRate * escMult * (1 - y.driveDisc)) * 100) / 100;
    const climRev = Math.round(climateSF * y.occRate * climRate * 12);
    const driveRev = Math.round(driveSF * y.occRate * driveRate * 12);
    const totalRev = climRev + driveRev;
    const opex = Math.round(totalRev * (y.yr === 1 ? 0.45 : y.yr === 2 ? 0.40 : 0.35));
    const noi = totalRev - opex;
    const mktClimFull = Math.round(mktClimateRate * escMult * 100) / 100;
    const mktDriveFull = Math.round(mktDriveRate * escMult * 100) / 100;
    return { ...y, climRate, driveRate, climRev, driveRev, totalRev, opex, noi, mktClimFull, mktDriveFull, escMult };
  });

  const stabNOI = yearData[4].noi;
  const stabRev = yearData[4].totalRev;

  // ── Regional Construction Costs ──
  const stateToCostIdx = { "TX": 0.92, "FL": 0.95, "OH": 0.88, "IN": 0.86, "KY": 0.87, "TN": 0.90, "GA": 0.91, "NC": 0.93, "SC": 0.90, "AZ": 0.94, "NV": 0.97, "CO": 1.02, "MI": 0.91, "PA": 1.05, "NJ": 1.15, "NY": 1.20, "MA": 1.18, "CT": 1.12, "IL": 1.00, "MO": 0.89, "AL": 0.85, "MS": 0.83, "LA": 0.88, "AR": 0.84, "VA": 0.98, "MD": 1.08, "WI": 0.95, "MN": 0.97, "IA": 0.88, "KS": 0.87, "NE": 0.89, "OK": 0.86, "NM": 0.92, "UT": 0.96, "ID": 0.94 };
  const costIdx = stateToCostIdx[(site.state || "").toUpperCase()] || 1.0;
  const baseHardPerSF = isMultiStory ? 95 : 65;
  const hardCostPerSF = Math.round(baseHardPerSF * costIdx);
  const softCostPct = 0.20;
  const hardCost = totalSF * hardCostPerSF;
  const softCost = Math.round(hardCost * softCostPct);
  const buildCosts = hardCost + softCost;
  const totalDevCost = landCost + buildCosts;
  const yocStab = stabNOI > 0 && totalDevCost > 0 ? ((stabNOI / totalDevCost) * 100).toFixed(1) : "N/A";

  // ── Detailed OpEx Breakdown (Stabilized Y5) ──
  const opexDetail = [
    { item: "Property Tax", amount: Math.round(totalDevCost * 0.012), note: "Est. 1.2% of total dev cost (varies by jurisdiction)", pctRev: 0 },
    { item: "Insurance", amount: Math.round(totalSF * 0.45), note: "Property + GL + wind/hail — $0.45/SF (climate-adjusted)", pctRev: 0 },
    { item: "Management Fee", amount: Math.round(stabRev * 0.06), note: "6% EGI — industry standard for institutional operator", pctRev: 0.06 },
    { item: "On-Site Payroll", amount: Math.round(65000 * 1.30 * (totalSF > 80000 ? 1.5 : 1)), note: `${totalSF > 80000 ? "1.5" : "1.0"} FTE @ $65K + 30% benefits/burden`, pctRev: 0 },
    { item: "Utilities (Electric/HVAC)", amount: Math.round(climateSF * 1.10 + driveSF * 0.25), note: "Climate: $1.10/SF/yr | Drive-up: $0.25/SF/yr", pctRev: 0 },
    { item: "Repairs & Maintenance", amount: Math.round(totalSF * 0.35), note: "Doors, HVAC service, roofing, painting — $0.35/SF", pctRev: 0 },
    { item: "Marketing & Digital", amount: Math.round(stabRev * 0.03), note: "3% EGI — SEM, SEO, signage, move-in promos", pctRev: 0.03 },
    { item: "Administrative / G&A", amount: Math.round(stabRev * 0.015), note: "Software, legal, accounting, credit card fees", pctRev: 0.015 },
    { item: "Bad Debt & Collections", amount: Math.round(stabRev * 0.02), note: "2% reserve — lien auctions, late payments", pctRev: 0.02 },
    { item: "Replacement Reserve", amount: Math.round(totalSF * 0.20), note: "$0.20/SF — HVAC replacement, roof, resurfacing", pctRev: 0 },
  ];
  const totalOpexDetail = opexDetail.reduce((s, o) => s + o.amount, 0);
  const opexRatioDetail = stabRev > 0 ? (totalOpexDetail / stabRev * 100).toFixed(1) : "N/A";
  const noiDetail = stabRev - totalOpexDetail;

  // ── Valuations ──
  const capRates = [
    { label: "Conservative (6.5%)", rate: 0.065 },
    { label: "Market (5.75%)", rate: 0.0575 },
    { label: "Aggressive (5.0%)", rate: 0.05 },
  ];
  const valuations = capRates.map(c => ({ ...c, value: Math.round(stabNOI / c.rate) }));

  // ── Land Price Guide ──
  const landTargets = [
    { label: "Maximum", yoc: 0.07, color: "#EF4444", tag: "CEILING" },
    { label: "Strike Price", yoc: 0.085, color: "#C9A84C", tag: "TARGET" },
    { label: "Minimum", yoc: 0.10, color: "#16A34A", tag: "FLOOR" },
  ];
  const landPrices = landTargets.map(t => {
    const maxLand = stabNOI > 0 ? Math.round(stabNOI / t.yoc - buildCosts) : 0;
    const perAcre = !isNaN(acres) && acres > 0 && maxLand > 0 ? Math.round(maxLand / acres) : 0;
    return { ...t, maxLand: Math.max(maxLand, 0), perAcre };
  });
  const askVsStrike = landCost > 0 && landPrices[1].maxLand > 0 ? ((landCost / landPrices[1].maxLand - 1) * 100).toFixed(0) : null;
  const landVerdict = askVsStrike !== null ? (parseFloat(askVsStrike) <= -15 ? "STRONG BUY" : parseFloat(askVsStrike) <= 0 ? "BUY" : parseFloat(askVsStrike) <= 15 ? "NEGOTIATE" : parseFloat(askVsStrike) <= 30 ? "STRETCH" : "PASS") : null;
  const verdictColor = landVerdict === "STRONG BUY" ? "#16A34A" : landVerdict === "BUY" ? "#22C55E" : landVerdict === "NEGOTIATE" ? "#F59E0B" : landVerdict === "STRETCH" ? "#E87A2E" : landVerdict === "PASS" ? "#EF4444" : "#6B7394";

  // ── Debt Service & Capital Stack ──
  const loanLTV = 0.65;
  const loanRate = 0.0675;
  const loanAmort = 25;
  const equityPct = 1 - loanLTV;
  const loanAmount = Math.round(totalDevCost * loanLTV);
  const equityRequired = Math.round(totalDevCost * equityPct);
  const monthlyLoanRate = loanRate / 12;
  const numPmts = loanAmort * 12;
  const monthlyPmt = loanAmount > 0 ? loanAmount * (monthlyLoanRate * Math.pow(1 + monthlyLoanRate, numPmts)) / (Math.pow(1 + monthlyLoanRate, numPmts) - 1) : 0;
  const annualDS = Math.round(monthlyPmt * 12);
  const dscrStab = annualDS > 0 ? (noiDetail / annualDS).toFixed(2) : "N/A";
  const cashAfterDS = noiDetail - annualDS;
  const cashOnCash = equityRequired > 0 ? ((cashAfterDS / equityRequired) * 100).toFixed(1) : "N/A";

  // ── 10-Year DCF & IRR ──
  const exitCapRate = 0.06;
  const yrDataExt = [];
  for (let i = 0; i < 10; i++) {
    const esc = Math.pow(1 + annualEsc, i);
    const occ = i < 5 ? leaseUpSchedule[i].occRate : 0.92;
    const cDisc = i < 5 ? leaseUpSchedule[i].climDisc : 0;
    const dDisc = i < 5 ? leaseUpSchedule[i].driveDisc : 0;
    const cR = mktClimateRate * esc * (1 - cDisc);
    const dR = mktDriveRate * esc * (1 - dDisc);
    const rev = Math.round(climateSF * occ * cR * 12) + Math.round(driveSF * occ * dR * 12);
    const opexPct = i === 0 ? 0.45 : i === 1 ? 0.40 : 0.35;
    const opex = Math.round(rev * opexPct);
    const noi = rev - opex;
    yrDataExt.push({ yr: i + 1, occ, rev, opex, noi, cR, dR });
  }
  const exitValue = Math.round(yrDataExt[9].noi / exitCapRate);
  const exitLoanBal = (() => { let bal = loanAmount; for (let i = 0; i < 120; i++) { bal = bal * (1 + monthlyLoanRate) - monthlyPmt; } return Math.round(Math.max(bal, 0)); })();
  const exitEquityProceeds = exitValue - exitLoanBal;
  const irrCashFlows = [-equityRequired, ...yrDataExt.map((y, i) => { const cf = y.noi - annualDS; return i === 9 ? cf + exitEquityProceeds : cf; })];
  const calcNPV = (rate) => irrCashFlows.reduce((npv, cf, t) => npv + cf / Math.pow(1 + rate, t), 0);
  let irrLow = -0.1, irrHigh = 0.5;
  for (let iter = 0; iter < 100; iter++) { const mid = (irrLow + irrHigh) / 2; if (calcNPV(mid) > 0) irrLow = mid; else irrHigh = mid; }
  const irrPct = ((irrLow + irrHigh) / 2 * 100).toFixed(1);
  const equityMultiple = equityRequired > 0 ? ((irrCashFlows.slice(1).reduce((s, v) => s + v, 0)) / equityRequired).toFixed(2) : "N/A";

  // ── Rate Cross-Validation ──
  const m1Rate = mktClimateRate;
  const m2ClimRate = incTier === "premium" ? 1.50 : incTier === "upper" ? 1.30 : incTier === "mid" ? 1.15 : 1.00;
  const m2DriveRate = incTier === "premium" ? 0.83 : incTier === "upper" ? 0.70 : incTier === "mid" ? 0.60 : 0.50;
  const popDensityFactor = popN >= 40000 ? 1.12 : popN >= 25000 ? 1.05 : popN >= 15000 ? 1.00 : 0.93;
  const m3ClimRate = Math.round(baseClimateRate * popDensityFactor * compAdj * 100) / 100;
  const consensusClimRate = Math.round((m1Rate + m2ClimRate + m3ClimRate) / 3 * 100) / 100;
  const rateConfidence = Math.abs(m1Rate - consensusClimRate) / consensusClimRate < 0.08 ? "HIGH" : Math.abs(m1Rate - consensusClimRate) / consensusClimRate < 0.15 ? "MODERATE" : "LOW";
  const rateConfColor = rateConfidence === "HIGH" ? "#16A34A" : rateConfidence === "MODERATE" ? "#F59E0B" : "#EF4444";

  // ── Institutional Metrics ──
  const stabOccSF = Math.round(totalSF * 0.92);
  const revPAF = stabRev > 0 ? (stabRev / totalSF).toFixed(2) : "N/A";
  const revPOF = stabRev > 0 && stabOccSF > 0 ? (stabRev / stabOccSF).toFixed(2) : "N/A";
  const noiPerSF = stabNOI > 0 ? (stabNOI / totalSF).toFixed(2) : "N/A";
  const noiMarginPct = stabRev > 0 ? ((stabNOI / stabRev) * 100).toFixed(1) : "N/A";
  const mktAcqCap = 0.0575;
  const devSpread = parseFloat(yocStab) > 0 ? (parseFloat(yocStab) - mktAcqCap * 100).toFixed(1) : "N/A";
  const impliedLandCap = landCost > 0 && stabNOI > 0 ? ((stabNOI / landCost) * 100).toFixed(1) : "N/A";

  // ── Supply/Demand ──
  const estCompSF = compCount > 0 ? compCount * 55000 : 0;
  const totalMktSF = estCompSF + totalSF;
  const sfPerCapita = popN > 0 ? (totalMktSF / popN).toFixed(1) : null;
  const sfPerCapitaExcl = popN > 0 && estCompSF > 0 ? (estCompSF / popN).toFixed(1) : null;
  const demandSignal = sfPerCapita !== null ? (parseFloat(sfPerCapita) < 5 ? "UNDERSERVED" : parseFloat(sfPerCapita) < 7 ? "MODERATE DEMAND" : parseFloat(sfPerCapita) < 9 ? "EQUILIBRIUM" : parseFloat(sfPerCapita) < 12 ? "WELL-SUPPLIED" : "OVERSUPPLIED") : null;
  const demandColor = demandSignal === "UNDERSERVED" ? "#16A34A" : demandSignal === "MODERATE DEMAND" ? "#22C55E" : demandSignal === "EQUILIBRIUM" ? "#F59E0B" : demandSignal === "WELL-SUPPLIED" ? "#E87A2E" : demandSignal === "OVERSUPPLIED" ? "#EF4444" : "#94A3B8";

  // ── Replacement Cost ──
  const replacementCost = buildCosts;
  const replacementCostPerSF = totalSF > 0 ? Math.round(replacementCost / totalSF) : 0;
  const fullReplacementCost = landCost + replacementCost;
  const replacementVsMarket = valuations[1].value > 0 && fullReplacementCost > 0 ? ((fullReplacementCost / valuations[1].value - 1) * 100).toFixed(0) : null;
  const buildOrBuy = replacementVsMarket !== null ? (parseFloat(replacementVsMarket) < -20 ? "BUILD — significant cost advantage" : parseFloat(replacementVsMarket) < 0 ? "BUILD — modest cost advantage" : parseFloat(replacementVsMarket) < 20 ? "NEUTRAL — similar cost to acquire stabilized" : "ACQUIRE — cheaper to buy existing") : null;

  // ── REIT Benchmarks ──
  const reitBench = [
    { ticker: "PSA", name: "Public Storage", revPAF: 24.50, noiMargin: 63.5, sameStoreGrowth: 3.1, avgOcc: 92.5, impliedCap: 4.8, stores: 3112, avgSF: 87000, ecriLift: 38 },
    { ticker: "EXR", name: "Extra Space", revPAF: 22.80, noiMargin: 65.2, sameStoreGrowth: 2.8, avgOcc: 93.5, impliedCap: 5.2, stores: 3800, avgSF: 72000, ecriLift: 42 },
    { ticker: "CUBE", name: "CubeSmart", revPAF: 20.10, noiMargin: 61.8, sameStoreGrowth: 2.5, avgOcc: 92.0, impliedCap: 5.5, stores: 1500, avgSF: 65000, ecriLift: 35 },
    { ticker: "NSA", name: "National Storage", revPAF: 17.50, noiMargin: 58.0, sameStoreGrowth: 2.2, avgOcc: 90.5, impliedCap: 6.0, stores: 1100, avgSF: 58000, ecriLift: 30 },
    { ticker: "LSI", name: "Life Storage", revPAF: 19.20, noiMargin: 60.0, sameStoreGrowth: 2.4, avgOcc: 91.5, impliedCap: 5.4, stores: 1200, avgSF: 68000, ecriLift: 33 },
  ];

  const pricePerAcre = landCost > 0 && !isNaN(acres) && acres > 0 ? Math.round(landCost / acres) : null;

  return {
    // Inputs
    acres, landCost, popN, incN, hvN, hhN, pop1, growthPct, compCount, nearestPS, incTier,
    // Facility
    isMultiStory, stories, footprint, totalSF, climatePct, drivePct, climateSF, driveSF,
    // Rates
    baseClimateRate, baseDriveRate, compAdj, mktClimateRate, mktDriveRate, annualEsc,
    // Year data
    leaseUpSchedule, yearData,
    // NOI
    stabNOI, stabRev,
    // Construction
    stateToCostIdx, costIdx, baseHardPerSF, hardCostPerSF, softCostPct, hardCost, softCost, buildCosts, totalDevCost, yocStab,
    // OpEx
    opexDetail, totalOpexDetail, opexRatioDetail, noiDetail,
    // Valuations
    capRates, valuations,
    // Land pricing
    landTargets, landPrices, askVsStrike, landVerdict, verdictColor,
    // Capital stack
    loanLTV, loanRate, loanAmort, equityPct, loanAmount, equityRequired, monthlyLoanRate, numPmts, monthlyPmt, annualDS, dscrStab, cashAfterDS, cashOnCash,
    // DCF
    exitCapRate, yrDataExt, exitValue, exitLoanBal, exitEquityProceeds, irrCashFlows, irrPct, equityMultiple,
    // Rate validation
    m1Rate, m2ClimRate, m2DriveRate, m3ClimRate, popDensityFactor, consensusClimRate, rateConfidence, rateConfColor,
    // Institutional
    stabOccSF, revPAF, revPOF, noiPerSF, noiMarginPct, mktAcqCap, devSpread, impliedLandCap,
    // Supply/demand
    estCompSF, totalMktSF, sfPerCapita, sfPerCapitaExcl, demandSignal, demandColor,
    // Replacement cost
    replacementCost, replacementCostPerSF, fullReplacementCost, replacementVsMarket, buildOrBuy,
    // REIT
    reitBench,
    // Misc
    pricePerAcre,
  };
};
