// ─── Scoring Engine — SiteScore & Financial Models ───
// Extracted from App.js for reuse across modules

// ─── SiteScore™ v4.0 — 9-Dimension + Binary Gate Scoring Engine ───
// Matches CLAUDE.md §6h framework. Uses structured data fields, not regex on summary text.
// Default weights: Pop 14%, Growth 18%, HHI 10%, Households 4%, HomeValue 4%, Zoning 16%, Access 7%, Competition 25%, MarketTier 2%
// PS Proximity: Binary gate only (>35mi = FAIL, otherwise not scored). NOT a weighted dimension.
// Competition: CC SPC (climate-controlled SF/capita) is king — uses worse of current vs projected 5-yr.
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
  const parseNum = (v) => {
    if (v == null || v === "") return 0;
    const s = String(v);
    // If it's already a clean number, use it directly
    const direct = Number(s);
    if (!isNaN(direct) && isFinite(direct)) return Math.round(direct);
    // Extract first number (with commas) from text like "43,000 (est.)" or "$103,000"
    const m = s.match(/[\d,]+/);
    if (!m) return 0;
    const n = parseInt(m[0].replace(/,/g, ""), 10);
    return isNaN(n) ? 0 : n;
  };
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

  // --- 2b. GROWTH (21%) — ESRI 5-year population CAGR ---
  let growthScore = 5; // default when no ESRI data
  // Read growth rate from multiple possible fields: popGrowth3mi (primary), growthRate, siteiqData.growthRate
  const growthFieldRaw = site.popGrowth3mi || site.growthRate || (site.siteiqData?.growthRate != null ? String(site.siteiqData.growthRate) : null);
  const growthRaw = growthFieldRaw ? parseFloat(String(growthFieldRaw).replace(/[^0-9.\-+]/g, "")) : null;
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
    flags.push("Growth corridor exemption: pop under 5K but high growth — scored 2");
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

  // --- 2e. PS PROXIMITY — BINARY GATE ONLY (v4.0) ---
  // >35mi from nearest PS = HARD FAIL. Otherwise NOT scored (weight 0).
  // Kept in scores object for transparency/breakdown display but weight is 0.
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
  scores.psProximity = psProxScore; // stored for display but weight = 0

  // --- 3. ZONING (16%) §6c methodology ---
  // Prefer structured zoningClassification field; fall back to regex on zoning + summary text
  // SOURCE NOTE: ETJ / unincorporated / no zoning = 10/10 (BEST outcome for storage).
  // Under Texas law (Ch. 231 LGC), counties have no zoning authority. ETJ grants platting control only, NOT use restrictions.
  // We actively target unzoned land — it's a HUGE positive, not a neutral score.
  let zoningScore = 3;
  const zClass = site.zoningClassification;
  const zClassNorm = (zClass || "").toLowerCase().trim();
  if (zClassNorm && zClassNorm !== "unknown") {
    if (zClassNorm.startsWith("by-right") || zClassNorm === "by right" || zClassNorm.startsWith("permitted")) zoningScore = 10;
    else if (zClassNorm.startsWith("conditional") || zClassNorm.includes("conditional") || zClassNorm.includes("sup") || zClassNorm.includes("cup") || zClassNorm.includes("special use") || zClassNorm.includes("plan commission")) zoningScore = 6;
    else if (zClassNorm.startsWith("rezone") || zClassNorm.includes("rezone")) zoningScore = 2;
    else if (zClassNorm.startsWith("prohibited") || zClassNorm.includes("prohibited")) { zoningScore = 0; hardFail = true; flags.push("FAIL: Zoning prohibits storage"); }
    else zoningScore = 5; // has classification but unrecognized — treat as unknown
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
  // §6h Scoring Integrity Rule #4: Zoning capped at 5 (UNKNOWN) unless verified.
  // "Verified" means EITHER:
  //   (a) zoningTableAccessed is true (we opened the ordinance), OR
  //   (b) zoningClassification was explicitly set (by-right, conditional, etc.) — this IS our verification
  //   (c) Site is ETJ/unincorporated/no-zoning — no ordinance exists to access
  // The cap only applies to regex-matched scores from the fallback path (no explicit classification set).
  const explicitClassSet = zClassNorm && zClassNorm !== "unknown" && zClassNorm !== "";
  const isNoZoning = /(no\s*zoning|unincorporated|\bETJ\b)/i.test(combinedText);
  if (zoningScore > 5 && !site.zoningTableAccessed && !explicitClassSet && !isNoZoning) {
    zoningScore = 5;
    flags.push("Zoning capped at 5 — ordinance not independently verified (set zoningClassification or zoningTableAccessed to unlock)");
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

  // --- 6. COMPETITION (25%) — CC SPC is KING (v4.0) ---
  // Uses WORSE (higher) of current ccSPC vs projected 5-yr projectedCCSPC.
  // Priority: siteiqData.ccSPC/projectedCCSPC (float) → siteiqData.competitorCount (int) → summary keywords
  let compScore = 6;
  const ccSPC = site.siteiqData?.ccSPC;
  const projCCSPC = site.siteiqData?.projectedCCSPC;
  const compCount = site.siteiqData?.competitorCount;
  let compMethod = 'keyword'; // track which method was used for explain text
  let effectiveSPC = null;

  // Determine effective SPC — use the WORSE (higher) of current vs projected
  const ccSPCValid = ccSPC != null && !isNaN(parseFloat(ccSPC));
  const projCCSPCValid = projCCSPC != null && !isNaN(parseFloat(projCCSPC));
  if (ccSPCValid && projCCSPCValid) {
    effectiveSPC = Math.max(parseFloat(ccSPC), parseFloat(projCCSPC)); // higher SPC = worse (more supply)
  } else if (ccSPCValid) {
    effectiveSPC = parseFloat(ccSPC);
  } else if (projCCSPCValid) {
    effectiveSPC = parseFloat(projCCSPC);
  }

  if (effectiveSPC !== null) {
    compMethod = 'ccSPC';
    if (effectiveSPC < 1.5) compScore = 10;       // severely underserved
    else if (effectiveSPC <= 3.0) compScore = 8;   // underserved
    else if (effectiveSPC <= 5.0) compScore = 6;   // moderate
    else if (effectiveSPC <= 7.0) compScore = 4;   // well-supplied
    else compScore = 2;                             // oversupplied

    // Pipeline flood flag: if projected is 2+ tiers worse than current
    if (ccSPCValid && projCCSPCValid) {
      const tierOf = (v) => v < 1.5 ? 5 : v <= 3.0 ? 4 : v <= 5.0 ? 3 : v <= 7.0 ? 2 : 1;
      const currTier = tierOf(parseFloat(ccSPC));
      const projTier = tierOf(parseFloat(projCCSPC));
      if (currTier - projTier >= 2) {
        compScore = Math.min(compScore, 4);
        flags.push("Pipeline flood: projected CC SPC 2+ tiers worse than current");
      }
    }
  } else if (compCount !== undefined && compCount !== null) {
    compMethod = 'count';
    if (compCount <= 1) compScore = 10;
    else if (compCount <= 3) compScore = 6;
    else compScore = 3;
  } else {
    if (/no\s*(?:nearby|existing)\s*(?:storage|competition|competitor)/i.test(summary) || /low\s*competition/i.test(summary)) compScore = 9;
    else if (/storage\s*(?:next\s*door|adjacent|nearby)/i.test(summary) || /high\s*competition/i.test(summary) || /saturated/i.test(summary)) compScore = 3;
    else if (/competitor/i.test(summary)) compScore = 5;
  }
  scores.competition = compScore;

  // --- 7. MARKET TIER (2%) — MT/DW target market alignment ---
  let marketScore = 2; // default for unknown markets
  const mTier = site.siteiqData?.marketTier;
  if (mTier !== undefined && mTier !== null) {
    const tier = parseInt(String(mTier), 10);
    if (tier === 1) marketScore = 10;
    else if (tier === 2) marketScore = 8;
    else if (tier === 3) marketScore = 6;
    else if (tier === 4) marketScore = 4;
    else marketScore = 2;
  }
  scores.marketTier = marketScore;

  const marketExplain = mTier !== undefined && mTier !== null ? `Market Tier ${mTier} → ${parseInt(String(mTier)) === 1 ? "Tier 1 = 10" : parseInt(String(mTier)) === 2 ? "Tier 2 = 8" : parseInt(String(mTier)) === 3 ? "Tier 3 = 6" : parseInt(String(mTier)) === 4 ? "Tier 4 = 4" : "Other = 2"}` : "No tier data — default 2";

  // --- COMPOSITE (weighted sum, 0-10 scale) — uses configurable weights, 9 scored dimensions ---
  // PS Proximity is a binary gate only (>35mi = FAIL) — NOT included in weighted sum (v4.0).
  const weightedSum =
    (popScore * getIQWeight("population")) + (growthScore * getIQWeight("growth")) +
    (incScore * getIQWeight("income")) + (hhScore * getIQWeight("households")) +
    (hvScore * getIQWeight("homeValue")) +
    (zoningScore * getIQWeight("zoning")) +
    (scores.access * getIQWeight("access")) +
    (compScore * getIQWeight("competition")) +
    (marketScore * getIQWeight("marketTier"));
  let adjusted = Math.round(weightedSum * 100) / 100;

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

  const final = Math.round(adjusted * 100) / 100;

  // --- CLASSIFICATION (§6h) ---
  let classification, classColor;
  if (hardFail) { classification = "RED"; classColor = "#DC2626"; }
  else if (final >= 8.0) { classification = "GREEN"; classColor = "#16A34A"; }
  else if (final >= 6.0) { classification = "YELLOW"; classColor = "#D97706"; }
  else if (final >= 4.0) { classification = "ORANGE"; classColor = "#EA580C"; }
  else { classification = "RED"; classColor = "#DC2626"; }

  // Build scoring explanations for each dimension
  const popExplain = popRaw > 0 ? `3-mi pop: ${popRaw.toLocaleString()} → ${popRaw >= 40000 ? "40K+ = 10" : popRaw >= 25000 ? "25K+ = 8" : popRaw >= 15000 ? "15K+ = 6" : popRaw >= 10000 ? "10K+ = 5" : popRaw >= 5000 ? "5K+ = 3" : "<5K = FAIL"}` : "No data — default 5";
  const growthFieldName = site.popGrowth3mi ? "popGrowth3mi" : site.growthRate ? "growthRate" : site.siteiqData?.growthRate != null ? "siteiqData.growthRate" : null;
  const growthExplain = growthRaw !== null ? `5-yr CAGR: ${growthRaw.toFixed(1)}% (${growthFieldName}) → ${growthRaw >= 2.0 ? "≥2.0% = 10" : growthRaw >= 1.5 ? "≥1.5% = 9" : growthRaw >= 1.0 ? "≥1.0% = 8" : growthRaw >= 0.5 ? "≥0.5% = 6" : growthRaw >= 0.0 ? "≥0% = 4" : growthRaw >= -0.5 ? "declining = 2" : "<-0.5% = 0"}` : "No ESRI data — default 5";
  const incExplain = incRaw > 0 ? `3-mi HHI: $${incRaw.toLocaleString()} → ${incRaw >= 90000 ? "$90K+ = 10" : incRaw >= 75000 ? "$75K+ = 8" : incRaw >= 65000 ? "$65K+ = 6" : incRaw >= 55000 ? "$55K+ = 4" : "<$55K = FAIL"}` : "No data — default 5";
  const hhExplain = hhRaw > 0 ? `3-mi HH: ${hhRaw.toLocaleString()} → ${hhRaw >= 25000 ? "25K+ = 10" : hhRaw >= 18000 ? "18K+ = 8" : hhRaw >= 12000 ? "12K+ = 7" : hhRaw >= 6000 ? "6K+ = 5" : "<6K = 3"}` : "No data — default 5";
  const hvExplain = hvRaw > 0 ? `3-mi home value: $${hvRaw.toLocaleString()} → ${hvRaw >= 500000 ? "$500K+ = 10" : hvRaw >= 350000 ? "$350K+ = 9" : hvRaw >= 250000 ? "$250K+ = 8" : hvRaw >= 180000 ? "$180K+ = 6" : hvRaw >= 120000 ? "$120K+ = 4" : "<$120K = 2"}` : "No data — default 5";
  const psDist = nearestPS !== undefined && nearestPS !== null ? parseFloat(String(nearestPS)) : NaN;
  const psExplain = !isNaN(psDist) ? `Nearest PS: ${psDist.toFixed(1)} mi → ${psDist <= 5 ? "≤5mi = 10" : psDist <= 10 ? "≤10mi = 9" : psDist <= 15 ? "≤15mi = 7" : psDist <= 25 ? "≤25mi = 5" : psDist <= 35 ? "≤35mi = 3" : ">35mi = FAIL"}` : "No data — default 5";
  const zoningBaseLabel = zClass === "by-right" ? "10" : zClass === "conditional" ? "6" : zClass === "rezone-required" ? "2" : "0";
  const zoningExplain = explicitClassSet ? `Classification: ${zClass} → ${scores.zoning}` : (scores.zoning === 5 ? "Unverified — capped at 5 (set zoningClassification to unlock)" : isNoZoning ? `ETJ/no-zoning → ${scores.zoning}` : `Regex-matched: score ${scores.zoning}`);
  const acresStr = !isNaN(acres) ? `${acres.toFixed(1)} ac → ${acres >= 3.5 && acres <= 5 ? "primary range = 8" : acres > 5 && acres <= 7 ? "5-7ac = 7" : acres > 7 ? "7+ ac = 5 base" : acres >= 2.5 ? "2.5-3.5ac = 6" : "small = " + scores.access}` : "No acreage";
  const accessExplain = acresStr + (scores.access > accessScore ? " + bonuses" : "");
  const compExplain = compMethod === 'ccSPC'
    ? `CC SPC: ${effectiveSPC.toFixed(1)} SF/capita (${ccSPCValid && projCCSPCValid ? `current ${parseFloat(ccSPC).toFixed(1)}, projected ${parseFloat(projCCSPC).toFixed(1)} — using worse` : ccSPCValid ? 'current' : 'projected'}) → ${effectiveSPC < 1.5 ? "<1.5 = 10" : effectiveSPC <= 3.0 ? "1.5-3.0 = 8" : effectiveSPC <= 5.0 ? "3.0-5.0 = 6" : effectiveSPC <= 7.0 ? "5.0-7.0 = 4" : ">7.0 = 2"}`
    : compCount !== undefined && compCount !== null ? `${compCount} competitors → ${compCount <= 1 ? "0-1 = 10" : compCount <= 3 ? "2-3 = 6" : "4+ = 3"}` : "Keyword-based estimate";


  // ─── DATA SOURCE CITATIONS — "Where did this come from?" ───
  // Each dimension gets a source, rawValue, and methodology so Dan can answer PS leadership instantly.
  const demoSource = site.demoSource || (growthRaw !== null ? "ESRI Community Analyst" : (popRaw > 0 ? "U.S. Census ACS 5-Year Estimates" : null));
  const demoMethodology = "3-mile radius ring study centered on site coordinates";
  const popSource = { source: popRaw > 0 ? demoSource : "No data available", rawValue: popRaw > 0 ? popRaw.toLocaleString() + " residents" : null, methodology: popRaw > 0 ? demoMethodology : "Default score (5) applied — populate pop3mi field", verified: popRaw > 0 };
  const growthSource = { source: growthRaw !== null ? (site.demoSource || "ESRI 2025→2030 Population Projections") : "No ESRI projection data", rawValue: growthRaw !== null ? growthRaw.toFixed(2) + "% CAGR" : null, methodology: growthRaw !== null ? `5-year compound annual growth rate, 3-mi ring (from ${growthFieldName})` : "Default score (5) applied — populate popGrowth3mi, growthRate, or siteiqData.growthRate field", verified: growthRaw !== null };
  const incSource = { source: incRaw > 0 ? demoSource : "No data available", rawValue: incRaw > 0 ? "$" + incRaw.toLocaleString() : null, methodology: incRaw > 0 ? demoMethodology : "Default score (5) applied — populate income3mi field", verified: incRaw > 0 };
  const hhSource = { source: hhRaw > 0 ? demoSource : "No data available", rawValue: hhRaw > 0 ? hhRaw.toLocaleString() + " households" : null, methodology: hhRaw > 0 ? demoMethodology : "Default score (5) applied — populate households3mi field", verified: hhRaw > 0 };
  const hvSource = { source: hvRaw > 0 ? demoSource : "No data available", rawValue: hvRaw > 0 ? "$" + hvRaw.toLocaleString() : null, methodology: hvRaw > 0 ? demoMethodology : "Default score (5) applied — populate homeValue3mi field", verified: hvRaw > 0 };
  const zoningSourceInfo = {
    source: site.zoningSource || (site.zoningTableAccessed ? "Municipal ordinance (verified)" : explicitClassSet ? "Verified classification" : "Unverified"),
    rawValue: site.zoningUseTerm || site.zoning || null,
    methodology: site.zoningTableAccessed ? `Permitted use table accessed — ${site.zoningOrdinanceSection || "section on file"}` : explicitClassSet ? `Classification set: ${zClass}` : isNoZoning ? "ETJ/unincorporated — no zoning ordinance applies" : "Regex keyword match on summary text (unverified — score capped at 5)",
    verified: !!(site.zoningTableAccessed || explicitClassSet || isNoZoning),
    url: site.zoningSource || null,
  };
  const psSource = { source: "PS Corporate Location Database", rawValue: !isNaN(psDist) ? psDist.toFixed(1) + " miles" : null, methodology: !isNaN(psDist) ? "Haversine distance calculation from site to nearest of 3,112 PS-owned locations" : "No proximity data — populate siteiqData.nearestPS", verified: !isNaN(psDist) };
  const accessSource = { source: "Listing data + aerial imagery review", rawValue: !isNaN(acres) ? acres.toFixed(1) + " acres" : null, methodology: "Acreage from listing, frontage/access from aerial review and summary keywords" + (site.roadFrontage ? ` — ${site.roadFrontage}` : ""), verified: !isNaN(acres) && acres > 0 };
  const compSource = { source: compMethod === 'ccSPC' ? "Climate-controlled SF per capita analysis (current + projected 5-yr)" : compMethod === 'count' ? "3-mile radius facility scan" : "Summary keyword analysis (estimated)", rawValue: compMethod === 'ccSPC' ? `${effectiveSPC.toFixed(1)} CC SF/capita (effective)${ccSPCValid && projCCSPCValid ? ` — current ${parseFloat(ccSPC).toFixed(1)}, projected ${parseFloat(projCCSPC).toFixed(1)}` : ''}` : compCount !== undefined && compCount !== null ? compCount + " facilities within 3 mi" : null, methodology: compMethod === 'ccSPC' ? "CC SF within 3 mi ÷ 3-mi population; uses worse of current vs projected 5-yr" + (site.competitorNames ? ` — ${site.competitorNames}` : "") : compMethod === 'count' ? "Google Maps + SpareFoot + SelfStorage.com scan" + (site.competitorNames ? ` — ${site.competitorNames}` : "") : "Keyword match on summary text — run full competition scan for verified count", verified: compMethod !== 'keyword' };

  const breakdown = [
    { label: "Population", key: "population", score: scores.population, weight: getIQWeight("population"), reason: popExplain, ...popSource },
    { label: "Growth", key: "growth", score: scores.growth, weight: getIQWeight("growth"), reason: growthExplain, ...growthSource },
    { label: "Income", key: "income", score: scores.income, weight: getIQWeight("income"), reason: incExplain, ...incSource },
    { label: "Households", key: "households", score: scores.households, weight: getIQWeight("households"), reason: hhExplain, ...hhSource },
    { label: "Home Value", key: "homeValue", score: scores.homeValue, weight: getIQWeight("homeValue"), reason: hvExplain, ...hvSource },
    { label: "Zoning", key: "zoning", score: scores.zoning, weight: getIQWeight("zoning"), reason: zoningExplain, ...zoningSourceInfo },
    { label: "PS Proximity", key: "psProximity", score: scores.psProximity, weight: 0, reason: psExplain + " (Binary gate — >35mi = FAIL, otherwise not scored)", ...psSource },
    { label: "Access", key: "access", score: scores.access, weight: getIQWeight("access"), reason: accessExplain, ...accessSource },
    { label: "Competition", key: "competition", score: scores.competition, weight: getIQWeight("competition"), reason: compExplain, ...compSource },
    { label: "Market Tier", key: "marketTier", score: scores.marketTier, weight: getIQWeight("marketTier"), reason: marketExplain, source: "MT/DW Territory Analysis", rawValue: mTier !== undefined && mTier !== null ? `Tier ${mTier}` : null, methodology: "Geographic alignment with PS expansion territories", verified: mTier !== undefined && mTier !== null },
  ];
  return {
    score: final, scores, flags, hardFail, hasDemoData, classification, classColor, breakdown,
    tier: final >= 8 ? "gold" : final >= 6 ? "steel" : "gray",
    label: final >= 9 ? "ELITE" : final >= 8 ? "PRIME" : final >= 7 ? "STRONG" : final >= 6 ? "VIABLE" : final >= 4 ? "MARGINAL" : "WEAK",
  };
};

// ─── Financial Model — Full Development Pro Forma ───
// 3-tier override chain: Site Override > Global Override > Storvex Default
// - siteOverrides: per-site tweaks stored at {region}/{siteId}/overrides in Firebase
// - overrides: global defaults from config/valuation_overrides (applies to all sites)
// - fallback: hardcoded Storvex engine default
// Site-specific values always win. Global overrides fill gaps. Engine defaults are the floor.
export const computeSiteFinancials = (site, overrides = {}, siteOverrides = {}) => {
  const O = (key, fallback) =>
    siteOverrides[key] !== undefined ? siteOverrides[key] :
    overrides[key] !== undefined ? overrides[key] :
    fallback;
  const parseP = (v) => { if (!v) return NaN; const s = String(v).replace(/,/g, ""); const m = s.match(/([\d.]+)\s*[Mm]/); if (m) return parseFloat(m[1]) * 1000000; return parseFloat(s.replace(/[^0-9.]/g, "")); };
  const acres = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
  const askRaw = parseP(site.askingPrice);
  const intRaw = parseP(site.internalPrice);
  const landCost = !isNaN(intRaw) && intRaw > 0 ? intRaw : (!isNaN(askRaw) ? askRaw : 0);
  const safeInt = (v) => {
    if (v == null || v === "") return 0;
    const s = String(v);
    const d = Number(s); if (!isNaN(d) && isFinite(d)) return Math.round(d);
    const m = s.match(/[\d,]+/); if (!m) return 0;
    return parseInt(m[0].replace(/,/g, ""), 10) || 0;
  };
  const popN = safeInt(site.pop3mi);
  const incN = safeInt(site.income3mi);
  const hvN = safeInt(site.homeValue3mi);
  const hhN = safeInt(site.households3mi);
  const pop1 = safeInt(site.pop1mi);
  const growthStr = site.popGrowth3mi || site.growthRate || "";
  const growthPct = parseFloat(String(growthStr).replace(/[^0-9.\-]/g, "")) || 0;
  const compCount = site.siteiqData?.competitorCount || 0;
  const nearestPS = site.siteiqData?.nearestPS || null;

  // ── Operator Profile — PS vs. Generic vs. Independent ──
  // PS operates at 78.4% NOI margin (Q4 2025) due to self-management, scale economies,
  // national brand, and centralized operations across 3,112 locations.
  // Generic/independent operators run at 58-66% NOI margins.
  const operatorProfile = site.operatorProfile || 'ps';
  const opProfiles = {
    ps: {
      label: "Public Storage Operating Platform",
      propTaxRate: O('propTaxRate', 0.010), insurancePerSF: O('insurancePerSF', 0.30), mgmtFeePct: O('mgmtFeePct', 0.035),
      basePayroll: O('basePayroll', 55000), payrollBurden: O('payrollBurden', 1.25), baseFTE: O('baseFTE', 1.0),
      climateUtilPerSF: O('climateUtilPerSF', 0.85), driveUtilPerSF: O('driveUtilPerSF', 0.20),
      rmPerSF: O('rmPerSF', 0.25), marketingPct: O('marketingPct', 0.02), marketingLeaseUpPct: O('marketingLeaseUpPct', 0.04),
      gaPct: O('gaPct', 0.010), badDebtPct: O('badDebtPct', 0.015), reservePerSF: O('reservePerSF', 0.15),
      noiMarginBenchmark: "78.4% (PSA Q4 2025)"
    },
    generic: {
      label: "Institutional Operator (Industry Average)",
      propTaxRate: 0.012, insurancePerSF: 0.45, mgmtFeePct: 0.06,
      basePayroll: 65000, payrollBurden: 1.30, baseFTE: 1.0,
      climateUtilPerSF: 1.10, driveUtilPerSF: 0.25,
      rmPerSF: 0.35, marketingPct: 0.03, marketingLeaseUpPct: 0.05,
      gaPct: 0.015, badDebtPct: 0.02, reservePerSF: 0.20,
      noiMarginBenchmark: "62-66% (industry average)"
    },
    independent: {
      label: "Independent / Mom-and-Pop Operator",
      propTaxRate: 0.012, insurancePerSF: 0.50, mgmtFeePct: 0.08,
      basePayroll: 55000, payrollBurden: 1.35, baseFTE: 1.5,
      climateUtilPerSF: 1.20, driveUtilPerSF: 0.30,
      rmPerSF: 0.40, marketingPct: 0.04, marketingLeaseUpPct: 0.06,
      gaPct: 0.020, badDebtPct: 0.025, reservePerSF: 0.25,
      noiMarginBenchmark: "55-60% (independent operators)"
    }
  };
  const op = opProfiles[operatorProfile] || opProfiles.ps;

  // ── Facility Sizing Model ──
  // Multi-story (2.5–3.5 ac): 3-story, higher climate ratio (smaller footprint = maximize rentable SF)
  // One-story (3.5+ ac): PS suburban format — 65/35 climate/drive-up per Killeen TX site sketch (Option A, Dec 2024)
  const isMultiStory = !isNaN(acres) && acres < O('multiStoryThreshold', 3.5) && acres >= 2.5;
  const stories = isMultiStory ? O('multiStoryFloors', 3) : 1;
  const footprint = !isNaN(acres) ? Math.round(acres * 43560 * O('coverageRatio', 0.35)) : 60000;
  const grossSF = footprint * stories;
  // Net-to-gross efficiency — corridors, office, hallways, mechanical reduce leasable space
  const netToGross = O('netToGross', 0.90);
  const totalSF = Math.round(grossSF * netToGross);
  const climatePct = isMultiStory ? O('climatePctMultiStory', 0.75) : O('climatePctOneStory', 0.65);
  const drivePct = 1 - climatePct;
  const climateSF = Math.round(totalSF * climatePct);
  const driveSF = Math.round(totalSF * drivePct);

  // ── Market Rate Intelligence ──
  const incTier = incN >= 90000 ? "premium" : incN >= 75000 ? "upper" : incN >= 60000 ? "mid" : "value";
  const baseClimateRate = incTier === "premium" ? O('climateRatePremium', 1.45) : incTier === "upper" ? O('climateRateUpper', 1.25) : incTier === "mid" ? O('climateRateMid', 1.10) : O('climateRateValue', 0.95);
  const baseDriveRate = incTier === "premium" ? O('driveRatePremium', 0.85) : incTier === "upper" ? O('driveRateUpper', 0.72) : incTier === "mid" ? O('driveRateMid', 0.62) : O('driveRateValue', 0.52);
  const compAdj = compCount <= 2 ? 1.08 : compCount <= 5 ? 1.00 : compCount <= 8 ? 0.94 : 0.88;
  const mktClimateRate = Math.round(baseClimateRate * compAdj * 100) / 100;
  const mktDriveRate = Math.round(baseDriveRate * compAdj * 100) / 100;

  // ── Regional Construction Costs — Recalibrated 2026-03-22 ──
  // PRIOR MODEL (pre-2026-03-22): Only included building shell + HVAC at $45/SF.
  // Produced ~$5.4M on Killeen TX (98K GSF) vs. PS actual closing of $11.65M dev cost.
  // Underestimated by ~54% because it omitted: site work, fire suppression, interior
  // buildout (unit partitions/doors), technology, and utility infrastructure.
  //
  // RECALIBRATED: Full development cost stack matching PS's actual Killeen TX closing
  // (3007 E Stan Schlueter, Dec 2025, ORNTIC File 303884/TX24380).
  // PS actual: $11,654,895 dev cost (excl land) on ~98K GSF = ~$119/SF all-in.
  // New model produces ~$11.1M = ~$113/SF — within 5% of PS actuals (delta = PS internal overhead).
  // Sources: RSMeans 2025, ENR, SteelCo, PS Killeen closing settlement statement.
  const stateToCostIdx = { "TX": 0.92, "FL": 0.95, "OH": 0.88, "IN": 0.86, "KY": 0.87, "TN": 0.90, "GA": 0.91, "NC": 0.93, "SC": 0.90, "AZ": 0.94, "NV": 0.97, "CO": 1.02, "MI": 0.91, "PA": 1.05, "NJ": 1.15, "NY": 1.20, "MA": 1.18, "CT": 1.12, "IL": 1.00, "MO": 0.89, "AL": 0.85, "MS": 0.83, "LA": 0.88, "AR": 0.84, "VA": 0.98, "MD": 1.08, "WI": 0.95, "MN": 0.97, "IA": 0.88, "KS": 0.87, "NE": 0.89, "OK": 0.86, "NM": 0.92, "UT": 0.96, "ID": 0.94, "AK": 1.28, "HI": 1.25, "WV": 0.87, "ME": 1.03, "NH": 1.05, "VT": 1.04, "RI": 1.10, "DE": 1.02, "DC": 1.18, "MT": 0.93, "ND": 0.90, "SD": 0.88, "WY": 0.93 };
  const costIdx = stateToCostIdx[(site.state || "").toUpperCase()] || 1.0;

  // ── 1. Building Shell + HVAC (vertical construction) ──
  // Pre-engineered metal building, HVAC for climate-controlled units, roofing, exterior envelope
  const baseHardPerSF = isMultiStory
    ? (stories <= 3 ? O('hardCostMultiStory3', 68) : stories <= 4 ? O('hardCostMultiStory4', 78) : 95)
    : (climatePct >= 0.5 ? O('hardCostOneStoryClimate', 45) : O('hardCostOneStoryDrive', 28));
  const hardCost = Math.round(grossSF * baseHardPerSF * costIdx); // Building shell + HVAC on gross SF
  const hardCostPerSF = grossSF > 0 ? Math.round(hardCost / grossSF) : 0; // Display-only — derived from total

  // ── 2. Site Development (horizontal construction) ──
  // Grading/earthwork, paving (drives + parking + loading), stormwater detention,
  // landscaping, fencing, perimeter screening, monument signage, curb cuts/access
  // Calculated on total site area SF — covers everything outside the building footprint.
  // One-story: $8/SF (larger, flatter sites); Multi-story: $10/SF (tighter, more vertical work)
  const siteAreaSF = !isNaN(acres) ? Math.round(acres * 43560) : Math.round(grossSF / 0.35);
  const baseSiteWorkPerSF = isMultiStory ? O('siteWorkPerSFMulti', 10) : O('siteWorkPerSFOneStory', 8);
  const siteWorkCost = Math.round(siteAreaSF * baseSiteWorkPerSF * costIdx);

  // ── 3. Fire Suppression ──
  // Full sprinkler system (NFPA 13), fire alarm (NFPA 72), standpipe, FDC, hydrant connections.
  // Storage buildings require sprinklers per IBC — non-negotiable for any commercial storage.
  // $5.50/SF of gross building SF (includes design, installation, testing, backflow preventer)
  const baseFireSuppressionPerSF = O('fireSuppressionPerSF', 5.50);
  const fireSuppressionCost = Math.round(grossSF * baseFireSuppressionPerSF * costIdx);

  // ── 4. Interior Buildout ──
  // Unit partition walls (metal studs + metal panel), roll-up doors (one per unit),
  // unit latches/locks, corridor finishes, office buildout (reception, restroom, break room),
  // interior signage, unit numbering. Calculated on net rentable SF (totalSF).
  // ~$15/SF covers: partitions ($4/SF) + doors ($8/SF @ ~1 door per 100 SF) + finish ($3/SF)
  const baseInteriorPerSF = O('interiorBuildoutPerSF', 15);
  const interiorBuildoutCost = Math.round(totalSF * baseInteriorPerSF * costIdx);

  // ── 5. Technology & Security ──
  // Access control keypads (gate + building entries), security cameras (40-80 per facility),
  // smart-entry/IoT sensors, property management software, IT network infrastructure,
  // kiosk rental stations. PS runs a heavily tech-enabled platform.
  const baseTechPerSF = O('technologyPerSF', 3.50);
  const technologyCost = Math.round(grossSF * baseTechPerSF * costIdx);

  // ── 6. Utility Infrastructure ──
  // Water/sewer hookups, fire suppression water line (6"+ dedicated), 3-phase electric
  // service upgrade, gas service, telecom/fiber. Base cost covers tap fees + hookup
  // regardless of building size; per-SF covers capacity sizing (larger buildings need
  // bigger mains, more electric capacity, larger fire line).
  const utilityInfraBase = O('utilityInfraBase', 75000);
  const baseUtilityPerSF = O('utilityInfraPerSF', 2.00);
  const utilityInfraCost = Math.round((utilityInfraBase + grossSF * baseUtilityPerSF) * costIdx);

  // ── Total Hard Cost (all 6 categories) ──
  const totalHardCost = hardCost + siteWorkCost + fireSuppressionCost + interiorBuildoutCost + technologyCost + utilityInfraCost;
  const totalHardPerSF = grossSF > 0 ? Math.round(totalHardCost / grossSF) : 0;

  // ── Soft Costs & Contingency (applied to TOTAL hard cost, not just shell) ──
  const softCostPct = O('softCostPct', 0.20);
  const softCost = Math.round(totalHardCost * softCostPct);
  // Construction contingency — 7.5% of total hard costs (industry standard, required by REC)
  const contingencyPct = O('contingencyPct', 0.075);
  const contingency = Math.round(totalHardCost * contingencyPct);
  const buildCosts = totalHardCost + softCost + contingency;

  // ── P1: Construction Carry Costs (Pre-Revenue Period) ──
  // PS uses "Total Development Yield" = Stabilized NOI / (Land + Build + Carry).
  // Omitting carry inflates IRR by 200-400 bps — REC catches this instantly.
  const constructionMonths = isMultiStory ? O('constructionMonthsMultiStory', 18) : O('constructionMonthsOneStory', 14);
  const constructionYears = constructionMonths / 12;
  const constLoanLTC = O('constLoanLTC', 0.60);
  const constLoanRate = O('constLoanRate', 0.075);
  const avgDrawPct = O('avgDrawPct', 0.55);
  const constructionLoan = Math.round(buildCosts * constLoanLTC);
  const constructionInterest = Math.round(constructionLoan * constLoanRate * constructionYears * avgDrawPct);
  const constructionPropTax = Math.round(landCost * 0.012 * constructionYears); // land only during construction
  const constructionInsurance = Math.round(buildCosts * 0.004 * constructionYears); // builder's risk
  const carryCosts = constructionInterest + constructionPropTax + constructionInsurance;
  const workingCapital = Math.round(buildCosts * O('workingCapitalPct', 0.02));

  // ── Total Development Cost (PS "Total Development Yield" denominator) ──
  // Includes ALL project costs: build (hard+soft+contingency) + carry + working capital reserve.
  // Working capital is equity-funded but IS a project cost — Sources & Uses must balance.
  // Prior to 2026-03-22 audit: workingCapital was excluded, causing S&U imbalance.
  const totalDevCost = landCost + buildCosts + carryCosts + workingCapital;

  // ── 5-Year Lease-Up Model ──
  const leaseUpSchedule = [
    { yr: 1, label: "Year 1 — Launch & Fill", occRate: O('leaseUpY1Occ', 0.30), climDisc: O('leaseUpY1ClimDisc', 0.35), driveDisc: O('leaseUpY1DriveDisc', 0.30), desc: "Grand opening promos. First month free. 50% off first 3 months. Heavy marketing spend." },
    { yr: 2, label: "Year 2 — Ramp", occRate: O('leaseUpY2Occ', 0.55), climDisc: O('leaseUpY2ClimDisc', 0.15), driveDisc: O('leaseUpY2DriveDisc', 0.12), desc: "Reduce promotions. Begin ECRI on Y1 tenants. Organic demand building." },
    { yr: 3, label: "Year 3 — Growth", occRate: O('leaseUpY3Occ', 0.75), climDisc: O('leaseUpY3ClimDisc', 0.05), driveDisc: O('leaseUpY3DriveDisc', 0.05), desc: "Minimal discounting. ECRIs on Y1-Y2 tenants (+8-12%/yr typical)." },
    { yr: 4, label: "Year 4 — Stabilization", occRate: O('leaseUpY4Occ', 0.88), climDisc: 0.00, driveDisc: 0.00, desc: "At or near market rate. ECRIs pushing above street rate." },
    { yr: 5, label: "Year 5 — Mature", occRate: O('leaseUpY5Occ', 0.92), climDisc: 0.00, driveDisc: 0.00, desc: "Fully stabilized. ECRI revenue above street rate." },
  ];
  const annualEsc = O('annualEscalation', 0.03);

  // ── OpEx Helper — single source of truth for fixed + variable operating expenses ──
  // COD AUDIT 2026-03-22: Extracted from 3 duplicate calculation sites (yearData, yrDataExt, sensitivity)
  // to eliminate maintenance drift. Any OpEx change is now made once.
  const calcOpEx = (yr, rev) => {
    const fixed = Math.round(totalDevCost * op.propTaxRate * Math.pow(1.02, yr))
      + Math.round(totalSF * op.insurancePerSF * Math.pow(1.03, yr))
      + Math.round(op.basePayroll * op.payrollBurden * (totalSF > 80000 ? Math.max(op.baseFTE, 1.5) : op.baseFTE) * Math.pow(1.03, yr))
      + Math.round((climateSF * op.climateUtilPerSF + driveSF * op.driveUtilPerSF) * Math.pow(1.02, yr))
      + Math.round(totalSF * op.rmPerSF * Math.pow(1.02, yr))
      + Math.round(totalSF * op.reservePerSF);
    const variable = Math.round(rev * op.mgmtFeePct)
      + Math.round(rev * (yr <= 1 ? op.marketingLeaseUpPct : op.marketingPct))
      + Math.round(rev * op.gaPct) + Math.round(rev * op.badDebtPct);
    return { fixed, variable, total: fixed + variable };
  };

  // ── OpEx Breakdown Helper — returns named items for display (Y5 stabilized) ──
  const calcOpExBreakdown = (yr, rev) => {
    const propTax = Math.round(totalDevCost * op.propTaxRate * Math.pow(1.02, yr));
    const insurance = Math.round(totalSF * op.insurancePerSF * Math.pow(1.03, yr));
    const payroll = Math.round(op.basePayroll * op.payrollBurden * (totalSF > 80000 ? Math.max(op.baseFTE, 1.5) : op.baseFTE) * Math.pow(1.03, yr));
    const utilities = Math.round((climateSF * op.climateUtilPerSF + driveSF * op.driveUtilPerSF) * Math.pow(1.02, yr));
    const rm = Math.round(totalSF * op.rmPerSF * Math.pow(1.02, yr));
    const reserves = Math.round(totalSF * op.reservePerSF);
    const mgmtFee = Math.round(rev * op.mgmtFeePct);
    const marketing = Math.round(rev * (yr <= 1 ? op.marketingLeaseUpPct : op.marketingPct));
    const ga = Math.round(rev * op.gaPct);
    const badDebt = Math.round(rev * op.badDebtPct);
    return { propTax, insurance, payroll, utilities, rm, reserves, mgmtFee, marketing, ga, badDebt };
  };

  // ── P0: ECRI Revenue Model ──
  // Existing Customer Rate Increase — PS's #1 revenue lever (38-42% of mature revenue).
  // After 6-9 months, existing tenants get 8-12% annual rate increases.
  // ecriSchedule = cumulative blended ECRI premium above street rate by year.
  // Recalibrated 2026-03-21: Prior schedule (0/5/10/15/20%) understated PS's actual ECRI lift.
  // PS applies 8-12% annual increases; by Y5 a Y1 tenant has received 3-4 increases.
  // New schedule reflects ~32% cumulative ECRI by Y5, consistent with 38-42% of mature revenue from ECRI.
  const ecriSchedule = [O('ecriY1', 0), O('ecriY2', 0.06), O('ecriY3', 0.14), O('ecriY4', 0.24), O('ecriY5', 0.32)];

  const yearData = leaseUpSchedule.map((y, i) => {
    const escMult = Math.pow(1 + annualEsc, i);
    const climRate = Math.round((mktClimateRate * escMult * (1 - y.climDisc)) * 100) / 100;
    const driveRate = Math.round((mktDriveRate * escMult * (1 - y.driveDisc)) * 100) / 100;

    // ECRI: blended portfolio premium above street rate
    // AUDIT FIX 2026-03-22: Use nullish coalescing — ecriSchedule[0]=0 is a valid value (no ECRI Y1).
    // Prior code: `ecriSchedule[i] || 0.20` treated 0 as falsy → applied phantom 20% Y1 ECRI premium.
    const ecriMult = 1 + (ecriSchedule[i] != null ? ecriSchedule[i] : 0);
    const climRev = Math.round(climateSF * y.occRate * climRate * ecriMult * 12);
    const driveRev = Math.round(driveSF * y.occRate * driveRate * ecriMult * 12);
    const totalRev = climRev + driveRev;

    // P0: Bottom-up OpEx via single-source-of-truth helper (COD AUDIT 2026-03-22)
    const opexResult = calcOpEx(i, totalRev);
    const opexBkdn = calcOpExBreakdown(i, totalRev);
    const fixedOpex = opexResult.fixed;
    const variableOpex = opexResult.variable;
    const opex = opexResult.total;
    const noi = totalRev - opex;
    const opexRatio = totalRev > 0 ? (opex / totalRev * 100).toFixed(1) : "N/A";
    const mktClimFull = Math.round(mktClimateRate * escMult * 100) / 100;
    const mktDriveFull = Math.round(mktDriveRate * escMult * 100) / 100;
    return {
      ...y, climRate, driveRate, climRev, driveRev, totalRev, opex, noi,
      mktClimFull, mktDriveFull, escMult, ecriMult,
      fixedOpex, variableOpex, opexRatio,
      opexBreakdown: opexBkdn,
    };
  });

  const stabNOI = yearData[4].noi;
  const stabRev = yearData[4].totalRev;

  // Construction costs + totalDevCost computed above (before yearData — needed for bottom-up OpEx)
  const yocStab = stabNOI > 0 && totalDevCost > 0 ? ((stabNOI / totalDevCost) * 100).toFixed(1) : "N/A";

  // ── Detailed OpEx Breakdown (Stabilized Y5) — sourced from bottom-up model ──
  const stabBkdn = yearData[4].opexBreakdown;
  const opexDetail = [
    { item: "Property Tax", amount: stabBkdn.propTax, note: `${(op.propTaxRate*100).toFixed(1)}% of dev cost, 2%/yr reassessment escalation`, pctRev: 0, type: "fixed" },
    { item: "Insurance", amount: stabBkdn.insurance, note: `Property + GL — $${op.insurancePerSF.toFixed(2)}/SF base, 3%/yr escalation${operatorProfile === 'ps' ? ' (PS captive insurance program)' : ''}`, pctRev: 0, type: "fixed" },
    { item: "Management Fee", amount: stabBkdn.mgmtFee, note: `${(op.mgmtFeePct*100).toFixed(1)}% EGI — ${operatorProfile === 'ps' ? 'PS internal allocation (self-managed, no external fee)' : 'institutional operator standard'}`, pctRev: op.mgmtFeePct, type: "variable" },
    { item: "On-Site Payroll", amount: stabBkdn.payroll, note: `${totalSF > 80000 ? Math.max(op.baseFTE, 1.5) : op.baseFTE} FTE @ $${(op.basePayroll/1000).toFixed(0)}K + ${Math.round((op.payrollBurden-1)*100)}% burden, 3%/yr esc${operatorProfile === 'ps' ? ' (smart-access tech reduces staffing)' : ''}`, pctRev: 0, type: "fixed" },
    { item: "Utilities (Electric/HVAC)", amount: stabBkdn.utilities, note: `Climate: $${op.climateUtilPerSF.toFixed(2)}/SF | Drive-up: $${op.driveUtilPerSF.toFixed(2)}/SF, 2%/yr esc${operatorProfile === 'ps' ? ' (centralized HVAC monitoring)' : ''}`, pctRev: 0, type: "fixed" },
    { item: "Repairs & Maintenance", amount: stabBkdn.rm, note: `$${op.rmPerSF.toFixed(2)}/SF base, 2%/yr escalation${operatorProfile === 'ps' ? ' (scale procurement)' : ''}`, pctRev: 0, type: "fixed" },
    { item: "Marketing & Digital", amount: stabBkdn.marketing, note: `${(op.marketingPct*100).toFixed(0)}% EGI stabilized (${(op.marketingLeaseUpPct*100).toFixed(0)}% during lease-up Y1-Y2)${operatorProfile === 'ps' ? ' — national brand reduces per-facility spend' : ''}`, pctRev: op.marketingPct, type: "variable" },
    { item: "Administrative / G&A", amount: stabBkdn.ga, note: `${(op.gaPct*100).toFixed(1)}% EGI — software, legal, accounting, CC fees${operatorProfile === 'ps' ? ' (centralized across 3,112 locations)' : ''}`, pctRev: op.gaPct, type: "variable" },
    { item: "Bad Debt & Collections", amount: stabBkdn.badDebt, note: `${(op.badDebtPct*100).toFixed(1)}% reserve — lien auctions, late payments${operatorProfile === 'ps' ? ' (automated lien system)' : ''}`, pctRev: op.badDebtPct, type: "variable" },
    { item: "Replacement Reserve", amount: stabBkdn.reserves, note: `$${op.reservePerSF.toFixed(2)}/SF — HVAC, roof, resurfacing${operatorProfile === 'ps' ? ' (bulk replacement purchasing)' : ''}`, pctRev: 0, type: "fixed" },
  ];
  const totalOpexDetail = opexDetail.reduce((s, o) => s + o.amount, 0);
  const opexRatioDetail = stabRev > 0 ? (totalOpexDetail / stabRev * 100).toFixed(1) : "N/A";
  const noiDetail = stabRev - totalOpexDetail;

  // ── Valuations ──
  const capRates = [
    { label: `Conservative (${(O('capRateConservative', 0.065) * 100).toFixed(1)}%)`, rate: O('capRateConservative', 0.065) },
    { label: `Market (${(O('capRateMarket', 0.0575) * 100).toFixed(2)}%)`, rate: O('capRateMarket', 0.0575) },
    { label: `Aggressive (${(O('capRateAggressive', 0.05) * 100).toFixed(1)}%)`, rate: O('capRateAggressive', 0.05) },
  ];
  const valuations = capRates.map(c => ({ ...c, value: Math.round(stabNOI / c.rate) }));

  // ── Land Price Guide — REIT-tight thresholds (recalibrated 2026-03-22) ──
  // Prior: 7.0/8.5/10.0% — too loose, 7% walk-away let marginal deals through.
  // Recalibrated: 7.5/9.0/10.5% — PS REC discipline without killing every deal.
  // 7.5% walk-away = floor for strategic/irreplaceable sites (EVP+ approval).
  // 9.0% strike = standard REC approval zone (PS targets 8-9% YOC on dev pipeline).
  // 10.5% home run = genuinely exceptional — deal-of-the-year territory.
  const landTargets = [
    { label: "Walk Away", yoc: O('yocMax', 0.075), color: "#EF4444", tag: "MAX" },
    { label: "Strike Price", yoc: O('yocStrike', 0.09), color: "#C9A84C", tag: "TARGET" },
    { label: "Home Run", yoc: O('yocMin', 0.105), color: "#16A34A", tag: "STEAL" },
  ];
  const landPrices = landTargets.map(t => {
    const maxLand = stabNOI > 0 ? Math.round(stabNOI / t.yoc - buildCosts - carryCosts - workingCapital) : 0;
    const perAcre = !isNaN(acres) && acres > 0 && maxLand > 0 ? Math.round(maxLand / acres) : 0;
    return { ...t, maxLand: Math.max(maxLand, 0), perAcre };
  });
  const askVsStrike = landCost > 0 && landPrices[1].maxLand > 0 ? ((landCost / landPrices[1].maxLand - 1) * 100).toFixed(0) : null;
  const landVerdict = askVsStrike !== null ? (parseFloat(askVsStrike) <= -15 ? "STRONG BUY" : parseFloat(askVsStrike) <= 0 ? "BUY" : parseFloat(askVsStrike) <= 15 ? "NEGOTIATE" : parseFloat(askVsStrike) <= 30 ? "STRETCH" : "ABOVE STRIKE") : "APPROVED";
  const verdictColor = landVerdict === "STRONG BUY" ? "#16A34A" : landVerdict === "BUY" ? "#22C55E" : landVerdict === "NEGOTIATE" ? "#F59E0B" : landVerdict === "STRETCH" ? "#E87A2E" : landVerdict === "ABOVE STRIKE" ? "#E87A2E" : landVerdict === "APPROVED" ? "#16A34A" : "#6B7394";

  // ── Debt Service & Capital Stack ──
  const loanLTV = O('loanLTV', 0.65);
  const loanRate = O('loanRate', 0.0675);
  const loanAmort = O('loanAmort', 25);
  const equityPct = 1 - loanLTV;
  const loanAmount = Math.round(totalDevCost * loanLTV);
  const equityRequired = totalDevCost - loanAmount; // Derived from loan to guarantee Sources = Uses balance exactly
  const monthlyLoanRate = loanRate / 12;
  const numPmts = loanAmort * 12;
  const monthlyPmt = loanAmount > 0 ? loanAmount * (monthlyLoanRate * Math.pow(1 + monthlyLoanRate, numPmts)) / (Math.pow(1 + monthlyLoanRate, numPmts) - 1) : 0;
  const annualDS = Math.round(monthlyPmt * 12);
  const dscrStab = annualDS > 0 ? (noiDetail / annualDS).toFixed(2) : "N/A";
  const cashAfterDS = noiDetail - annualDS;
  const cashOnCash = equityRequired > 0 ? ((cashAfterDS / equityRequired) * 100).toFixed(1) : "N/A";

  // ── N-Year DCF & IRR (with ECRI + bottom-up OpEx) ──
  // holdPeriod wired from STORVEX_DEFAULTS / overrides — default 10 years.
  // Prior to 2026-03-22 audit: hardcoded to 10, holdPeriod slider was non-functional.
  const holdPeriod = Math.max(5, Math.min(20, Math.round(O('holdPeriod', 10))));
  const exitCapRate = O('exitCapRate', 0.06);
  const yrDataExt = [];
  for (let i = 0; i < holdPeriod; i++) {
    const esc = Math.pow(1 + annualEsc, i);
    const occ = i < 5 ? leaseUpSchedule[i].occRate : 0.92;
    const cDisc = i < 5 ? leaseUpSchedule[i].climDisc : 0;
    const dDisc = i < 5 ? leaseUpSchedule[i].driveDisc : 0;
    // AUDIT FIX 2026-03-22: Same nullish coalescing fix as yearData loop — 0 is valid, not falsy.
    const ecriIdx = Math.min(i, 4);
    const ecriMult = 1 + (ecriSchedule[ecriIdx] != null ? ecriSchedule[ecriIdx] : 0);
    // AUDIT FIX 2026-03-22: Round rates to match yearData precision (¢ rounding parity).
    const cR = Math.round(mktClimateRate * esc * (1 - cDisc) * 100) / 100;
    const dR = Math.round(mktDriveRate * esc * (1 - dDisc) * 100) / 100;
    const rev = Math.round(climateSF * occ * cR * ecriMult * 12) + Math.round(driveSF * occ * dR * ecriMult * 12);
    // Bottom-up OpEx via single-source-of-truth helper (COD AUDIT 2026-03-22)
    const { total: opex } = calcOpEx(i, rev);
    const noi = rev - opex;
    yrDataExt.push({ yr: i + 1, occ, rev, opex, noi, cR, dR, ecriMult });
  }
  const exitValue = Math.round(yrDataExt[holdPeriod - 1].noi / exitCapRate);
  const exitLoanBal = (() => { let bal = loanAmount; for (let i = 0; i < holdPeriod * 12; i++) { bal = bal * (1 + monthlyLoanRate) - monthlyPmt; } return Math.round(Math.max(bal, 0)); })();
  const exitEquityProceeds = exitValue - exitLoanBal;
  const irrCashFlows = [-equityRequired, ...yrDataExt.map((y, i) => { const cf = y.noi - annualDS; return i === holdPeriod - 1 ? cf + exitEquityProceeds : cf; })];
  const calcNPV = (rate) => irrCashFlows.reduce((npv, cf, t) => npv + cf / Math.pow(1 + rate, t), 0);
  let irrLow = -0.1, irrHigh = 0.5;
  for (let iter = 0; iter < 100; iter++) { const mid = (irrLow + irrHigh) / 2; if (calcNPV(mid) > 0) irrLow = mid; else irrHigh = mid; }
  const irrPct = ((irrLow + irrHigh) / 2 * 100).toFixed(1);
  const equityMultiple = equityRequired > 0 ? ((irrCashFlows.slice(1).reduce((s, v) => s + v, 0)) / equityRequired).toFixed(2) : "N/A";

  // ── P1: Sensitivity Matrix (3×3: Rent ±10% × Occupancy ±5pts) ──
  // Required by PS REC — shows downside/upside impact on YOC and IRR
  const sensitivityMatrix = (() => {
    const rentScenarios = [
      { label: "Rent -10%", factor: 0.90 },
      { label: "Base Case", factor: 1.00 },
      { label: "Rent +10%", factor: 1.10 },
    ];
    const occScenarios = [
      { label: "Occ -5pts", adj: -0.05 },
      { label: "Base Case", adj: 0 },
      { label: "Occ +5pts", adj: 0.05 },
    ];
    const stabFixed = yearData[4].fixedOpex;
    const varPctSum = op.mgmtFeePct + op.marketingPct + op.gaPct + op.badDebtPct;
    const grid = rentScenarios.map(r => occScenarios.map(o => {
      const adjOcc = Math.min(0.97, Math.max(0.50, 0.92 + o.adj));
      const esc4 = Math.pow(1 + annualEsc, 4);
      const adjClimRate = Math.round(mktClimateRate * esc4 * r.factor * 100) / 100;
      const adjDriveRate = Math.round(mktDriveRate * esc4 * r.factor * 100) / 100;
      // AUDIT FIX 2026-03-22: Consistent nullish coalescing (ecriSchedule[4]=0 is valid).
      const ecri5 = 1 + (ecriSchedule[4] != null ? ecriSchedule[4] : 0);
      const adjRev = Math.round((climateSF * adjOcc * adjClimRate * ecri5 * 12) + (driveSF * adjOcc * adjDriveRate * ecri5 * 12));
      const adjVarOpex = Math.round(adjRev * varPctSum);
      const adjOpex = stabFixed + adjVarOpex;
      const adjNOI = adjRev - adjOpex;
      const adjYOC = totalDevCost > 0 ? ((adjNOI / totalDevCost) * 100).toFixed(1) : "N/A";
      // IRR sensitivity — recompute N-year DCF for each scenario
      const adjCFs = [-equityRequired];
      for (let yr = 0; yr < holdPeriod; yr++) {
        const e = Math.pow(1 + annualEsc, yr);
        const oc = yr < 5 ? leaseUpSchedule[yr].occRate + o.adj : adjOcc;
        const ocCl = Math.min(0.97, Math.max(0.10, oc));
        const cD = yr < 5 ? leaseUpSchedule[yr].climDisc : 0;
        const dD = yr < 5 ? leaseUpSchedule[yr].driveDisc : 0;
        // AUDIT FIX 2026-03-22: Consistent nullish coalescing for ECRI.
        const emIdx = Math.min(yr, 4);
        const em = 1 + (ecriSchedule[emIdx] != null ? ecriSchedule[emIdx] : 0);
        const yRev = Math.round(climateSF * ocCl * mktClimateRate * e * (1 - cD) * r.factor * em * 12)
          + Math.round(driveSF * ocCl * mktDriveRate * e * (1 - dD) * r.factor * em * 12);
        // COD AUDIT 2026-03-22: Use calcOpEx helper for fixed costs, keep varPctSum for rent-adjusted variable costs
        const { fixed: yFix } = calcOpEx(yr, yRev);
        const yVar = Math.round(yRev * varPctSum);
        const yNoi = yRev - yFix - yVar;
        const yCF = yNoi - annualDS;
        if (yr === holdPeriod - 1) {
          const exitVal = Math.round(yNoi / exitCapRate);
          const exitBal = exitLoanBal;
          adjCFs.push(yCF + exitVal - exitBal);
        } else {
          adjCFs.push(yCF);
        }
      }
      const npvCalc = (rate) => adjCFs.reduce((npv, cf, t) => npv + cf / Math.pow(1 + rate, t), 0);
      let lo = -0.1, hi = 0.5;
      for (let it = 0; it < 80; it++) { const m = (lo + hi) / 2; if (npvCalc(m) > 0) lo = m; else hi = m; }
      const adjIRR = ((lo + hi) / 2 * 100).toFixed(1);
      return { rentLabel: r.label, occLabel: o.label, occ: adjOcc, rev: adjRev, noi: adjNOI, yoc: adjYOC, irr: adjIRR };
    }));
    return { rentScenarios, occScenarios, grid };
  })();

  // ── P1: Sources & Uses Table ──
  const sourcesAndUses = {
    sources: [
      { item: "Senior Debt (Construction → Permanent)", amount: loanAmount, pct: totalDevCost > 0 ? (loanAmount / totalDevCost * 100).toFixed(1) : "0" },
      { item: "Sponsor Equity", amount: equityRequired, pct: totalDevCost > 0 ? (equityRequired / totalDevCost * 100).toFixed(1) : "0" },
    ],
    uses: [
      { item: "Land Acquisition", amount: landCost, pct: totalDevCost > 0 ? (landCost / totalDevCost * 100).toFixed(1) : "0" },
      { item: "Building Shell & HVAC", amount: hardCost, pct: totalDevCost > 0 ? (hardCost / totalDevCost * 100).toFixed(1) : "0" },
      { item: "Site Development", amount: siteWorkCost, pct: totalDevCost > 0 ? (siteWorkCost / totalDevCost * 100).toFixed(1) : "0" },
      { item: "Fire Suppression", amount: fireSuppressionCost, pct: totalDevCost > 0 ? (fireSuppressionCost / totalDevCost * 100).toFixed(1) : "0" },
      { item: "Interior Buildout", amount: interiorBuildoutCost, pct: totalDevCost > 0 ? (interiorBuildoutCost / totalDevCost * 100).toFixed(1) : "0" },
      { item: "Technology & Security", amount: technologyCost, pct: totalDevCost > 0 ? (technologyCost / totalDevCost * 100).toFixed(1) : "0" },
      { item: "Utility Infrastructure", amount: utilityInfraCost, pct: totalDevCost > 0 ? (utilityInfraCost / totalDevCost * 100).toFixed(1) : "0" },
      { item: "Soft Costs (Design/Permits/Legal)", amount: softCost, pct: totalDevCost > 0 ? (softCost / totalDevCost * 100).toFixed(1) : "0" },
      { item: "Construction Contingency (7.5%)", amount: contingency, pct: totalDevCost > 0 ? (contingency / totalDevCost * 100).toFixed(1) : "0" },
      { item: "Construction Carry Costs", amount: carryCosts, pct: totalDevCost > 0 ? (carryCosts / totalDevCost * 100).toFixed(1) : "0" },
      { item: "Working Capital Reserve", amount: workingCapital, pct: totalDevCost > 0 ? (workingCapital / totalDevCost * 100).toFixed(1) : "0" },
    ],
    totalSources: loanAmount + equityRequired,
    totalUses: landCost + totalHardCost + softCost + contingency + carryCosts + workingCapital,
  };

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

  // ── REIT Benchmarks — Updated Q4 2025 ──
  const reitBench = [
    { ticker: "PSA", name: "Public Storage", revPAF: 22.53, noiMargin: 78.4, sameStoreGrowth: -0.7, avgOcc: 91.6, impliedCap: 4.8, stores: 3112, avgSF: 87000, ecriLift: 38 },
    { ticker: "EXR", name: "Extra Space", revPAF: 22.80, noiMargin: 65.2, sameStoreGrowth: 2.8, avgOcc: 93.5, impliedCap: 5.2, stores: 3800, avgSF: 72000, ecriLift: 42 },
    { ticker: "CUBE", name: "CubeSmart", revPAF: 20.10, noiMargin: 61.8, sameStoreGrowth: 2.5, avgOcc: 92.0, impliedCap: 5.5, stores: 1500, avgSF: 65000, ecriLift: 35 },
    { ticker: "NSA", name: "National Storage", revPAF: 17.50, noiMargin: 58.0, sameStoreGrowth: 2.2, avgOcc: 90.5, impliedCap: 6.0, stores: 1100, avgSF: 58000, ecriLift: 30 },
    { ticker: "LSI", name: "Life Storage", revPAF: 19.20, noiMargin: 60.0, sameStoreGrowth: 2.4, avgOcc: 91.5, impliedCap: 5.4, stores: 1200, avgSF: 68000, ecriLift: 33 },
  ];

  // ── Phase 2: Institutional Board Metrics (Bain Review 2026-03-21) ──

  // Unlevered IRR — isolates asset quality from capital structure
  const unleveredCFs = [-totalDevCost, ...yrDataExt.map((y, i) => i === holdPeriod - 1 ? y.noi + exitValue : y.noi)];
  let uIrrLow = -0.1, uIrrHigh = 0.5;
  for (let iter = 0; iter < 100; iter++) {
    const mid = (uIrrLow + uIrrHigh) / 2;
    const npv = unleveredCFs.reduce((s, cf, t) => s + cf / Math.pow(1 + mid, t), 0);
    if (npv > 0) uIrrLow = mid; else uIrrHigh = mid;
  }
  const unleveredIRR = ((uIrrLow + uIrrHigh) / 2 * 100).toFixed(1);

  // NPV at PS's WACC (9.26%) — definitive go/no-go: positive = creates shareholder value
  const psWACC = 0.0926;
  const npvAtWACC = Math.round(unleveredCFs.reduce((npv, cf, t) => npv + cf / Math.pow(1 + psWACC, t), 0));

  // Debt Yield — lender risk metric, independent of cap rates and interest rates
  const debtYield = loanAmount > 0 ? ((stabNOI / loanAmount) * 100).toFixed(1) : "N/A";

  // Profit on Cost — value creation metric: how much stabilized value exceeds total development cost
  const profitOnCost = totalDevCost > 0 && valuations[1].value > 0
    ? ((valuations[1].value - totalDevCost) / totalDevCost * 100).toFixed(1)
    : "N/A";

  // Multi-Scenario Exit Cap — Bull/Base/Bear
  const exitScenarios = [
    { label: "Bull (5.25%)", rate: 0.0525 },
    { label: "Base (6.00%)", rate: 0.06 },
    { label: "Bear (7.00%)", rate: 0.07 },
  ].map(s => {
    const eVal = Math.round(yrDataExt[holdPeriod - 1].noi / s.rate);
    const eProceeds = eVal - exitLoanBal;
    const cfs = [-equityRequired, ...yrDataExt.map((y, i) => {
      const cf = y.noi - annualDS;
      return i === holdPeriod - 1 ? cf + eProceeds : cf;
    })];
    let lo = -0.1, hi = 0.5;
    for (let it = 0; it < 100; it++) {
      const m = (lo + hi) / 2;
      const npv = cfs.reduce((n, c, t) => n + c / Math.pow(1 + m, t), 0);
      if (npv > 0) lo = m; else hi = m;
    }
    const poc = totalDevCost > 0 ? ((eVal - totalDevCost) / totalDevCost * 100).toFixed(1) : "N/A";
    return { ...s, exitValue: eVal, equityProceeds: eProceeds, irr: ((lo + hi) / 2 * 100).toFixed(1), profitOnCost: poc };
  });

  const pricePerAcre = landCost > 0 && !isNaN(acres) && acres > 0 ? Math.round(landCost / acres) : null;

  return {
    // Inputs
    acres, landCost, popN, incN, hvN, hhN, pop1, growthPct, compCount, nearestPS, incTier,
    // Operator profile
    operatorProfile, operatorLabel: op.label, noiMarginBenchmark: op.noiMarginBenchmark,
    // Facility
    isMultiStory, stories, footprint, grossSF, netToGross, totalSF, climatePct, drivePct, climateSF, driveSF,
    // Rates
    baseClimateRate, baseDriveRate, compAdj, mktClimateRate, mktDriveRate, annualEsc,
    // Year data
    leaseUpSchedule, yearData,
    // NOI
    stabNOI, stabRev,
    // Construction + Carry
    stateToCostIdx, costIdx, baseHardPerSF, hardCostPerSF, softCostPct, hardCost, softCost,
    contingencyPct, contingency, buildCosts, totalHardCost, totalHardPerSF,
    siteAreaSF, baseSiteWorkPerSF, siteWorkCost,
    baseFireSuppressionPerSF, fireSuppressionCost,
    baseInteriorPerSF, interiorBuildoutCost,
    baseTechPerSF, technologyCost,
    utilityInfraBase, baseUtilityPerSF, utilityInfraCost,
    constructionMonths, constructionYears, constLoanLTC, constLoanRate, avgDrawPct, constructionLoan,
    constructionInterest, constructionPropTax, constructionInsurance, carryCosts, workingCapital,
    totalDevCost, yocStab,
    // OpEx
    opexDetail, totalOpexDetail, opexRatioDetail, noiDetail,
    // ECRI
    ecriSchedule,
    // Valuations
    capRates, valuations,
    // Land pricing
    landTargets, landPrices, askVsStrike, landVerdict, verdictColor,
    // Capital stack
    loanLTV, loanRate, loanAmort, equityPct, loanAmount, equityRequired, monthlyLoanRate, numPmts, monthlyPmt, annualDS, dscrStab, cashAfterDS, cashOnCash,
    // DCF
    holdPeriod, exitCapRate, yrDataExt, exitValue, exitLoanBal, exitEquityProceeds, irrCashFlows, irrPct, equityMultiple,
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
    // Sensitivity & Sources/Uses
    sensitivityMatrix, sourcesAndUses,
    // Phase 2: Institutional Board Metrics
    unleveredIRR, psWACC, npvAtWACC, debtYield, profitOnCost, exitScenarios,
    // Misc
    pricePerAcre,
  };
};

// ─── Vetting Intelligence — Shared computation layer for all reports ───
// Extracts zoning, utilities, access, competition, and risk assessment into a
// structured object that all 4 report generators consume. Single source of truth
// for vetting findings — eliminates duplication across vet/pricing/REC reports.
export const computeVettingIntel = (site) => {
  const combined = ((site.zoning || "") + " " + (site.summary || "") + " " + (site.zoningNotes || "")).toLowerCase();
  const parseNum = (v) => {
    if (v == null || v === "") return 0;
    const s = String(v);
    const d = Number(s); if (!isNaN(d) && isFinite(d)) return Math.round(d);
    const m = s.match(/[\d,]+/); if (!m) return 0;
    return parseInt(m[0].replace(/,/g, ""), 10) || 0;
  };
  const parseFee = (v) => { if (!v) return null; const m = String(v).match(/\$?([\d,]+(?:\.\d+)?)/); return m ? parseFloat(m[1].replace(/,/g, "")) : null; };
  const acres = parseFloat(String(site.acreage || "").replace(/[^0-9.]/g, ""));
  const popN = parseNum(site.pop3mi);
  const incN = parseNum(site.income3mi);
  const hhN = parseNum(site.households3mi);
  const hvN = parseNum(site.homeValue3mi);
  const pop1 = parseNum(site.pop1mi);
  const growthPct = site.popGrowth3mi ? parseFloat(String(site.popGrowth3mi).replace(/[^0-9.\-+]/g, "")) : null;

  // ── Zoning Intelligence ──
  const zoningClass = site.zoningClassification || "unknown";
  const zoningColor = zoningClass === "by-right" ? "#16A34A" : zoningClass === "conditional" ? "#F59E0B" : zoningClass === "rezone-required" ? "#EF4444" : zoningClass === "prohibited" ? "#991B1B" : "#94A3B8";
  const zoningLabel = { "by-right": "BY-RIGHT (Permitted)", "conditional": "CONDITIONAL (SUP/CUP Required)", "rezone-required": "REZONE REQUIRED", "prohibited": "PROHIBITED", "unknown": "UNKNOWN — Research Required" }[zoningClass] || zoningClass.toUpperCase();
  const hasByRight = /(by\s*right|permitted|storage\s*(?:by|permitted))/i.test(combined);
  const hasSUP = /(conditional|sup\b|cup\b|special\s*use)/i.test(combined);
  const hasRezone = /rezone/i.test(combined);
  const hasOverlay = /overlay/i.test(combined);
  const hasFlood = /flood/i.test(combined);
  const hasUtilities = /(utilit|water|sewer|electric|gas\b)/i.test(combined);
  const hasSeptic = /septic/i.test(combined);
  const hasWell = /\bwell\b/i.test(combined);
  const zoningTableAccessed = site.zoningTableAccessed === true;

  // ── Overlay cost impact (flows into pricing) ──
  const overlayCostImpactRaw = parseFee(site.overlayCostImpact);
  const overlayCostAdder = hasOverlay ? (overlayCostImpactRaw || 150000) : 0; // Default $150K if overlay noted but cost not specified

  // ── Zoning-driven design premiums ──
  // Facade requirements in overlays add masonry/stone costs above standard metal panel
  const facadeReqs = site.facadeReqs || "";
  const hasMasonryReq = /masonry|brick|stone|stucco/i.test(facadeReqs);
  const facadePremium = hasMasonryReq ? 100000 : 0; // $100K average masonry upgrade on storage

  // ── Utility Readiness Score (0-100) ──
  const utilChecks = [
    { done: !!site.waterProvider, weight: 20, label: "Water provider identified" },
    { done: site.waterAvailable === true, weight: 15, label: "Water confirmed available" },
    { done: site.insideServiceBoundary === true, weight: 10, label: "Inside service boundary" },
    { done: !!site.sewerProvider || hasSeptic, weight: 12, label: "Sewer/septic solution" },
    { done: site.sewerAvailable === true || hasSeptic, weight: 8, label: "Sewer confirmed" },
    { done: !!site.electricProvider, weight: 10, label: "Electric provider identified" },
    { done: site.threePhase === true, weight: 10, label: "3-phase power available" },
    { done: !!site.waterTapFee || !!site.tapFees, weight: 5, label: "Tap fees documented" },
    { done: site.fireFlowAdequate === true, weight: 5, label: "Fire flow confirmed" },
    { done: !!site.distToWaterMain, weight: 5, label: "Distance to main known" },
  ];
  const utilScore = utilChecks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  const utilGrade = utilScore >= 80 ? "A" : utilScore >= 60 ? "B" : utilScore >= 40 ? "C" : utilScore >= 20 ? "D" : "F";
  const utilGradeColor = utilScore >= 80 ? "#16A34A" : utilScore >= 60 ? "#3B82F6" : utilScore >= 40 ? "#F59E0B" : "#EF4444";

  // ── Water hookup status & cost estimator ──
  const waterHookup = site.waterHookupStatus || (site.insideServiceBoundary === true ? "by-right" : site.insideServiceBoundary === false ? "by-request" : site.waterProvider ? "unknown" : "unknown");
  const waterHookupLabel = { "by-right": "BY-RIGHT", "by-request": "BY-REQUEST", "no-provider": "NO PROVIDER", "unknown": "UNKNOWN" }[waterHookup] || "UNKNOWN";
  const waterHookupColor = waterHookup === "by-right" ? "#16A34A" : waterHookup === "by-request" ? "#F59E0B" : waterHookup === "no-provider" ? "#EF4444" : "#94A3B8";
  const distFt = site.distToWaterMain ? parseFloat(String(site.distToWaterMain).replace(/[^0-9.]/g, "")) : null;
  const waterTapN = parseFee(site.waterTapFee);
  const sewerTapN = parseFee(site.sewerTapFee);
  const impactN = parseFee(site.impactFees);
  const extensionLow = distFt ? Math.round(distFt * 50) : null;
  const extensionHigh = distFt ? Math.round(distFt * 150) : null;
  const totalUtilLow = (waterTapN || 0) + (sewerTapN || 0) + (impactN || 0) + (extensionLow || 0);
  const totalUtilHigh = (waterTapN || 0) + (sewerTapN || 0) + (impactN || 0) + (extensionHigh || 0);

  // ── Utility cost adder for pricing (flows into computeSiteFinancials) ──
  // If water hookup is "by-request" and we have distance data, add extension cost
  // If "no-provider", add a large penalty cost estimate
  const utilCostAdder = waterHookup === "no-provider" ? 250000
    : waterHookup === "by-request" ? (extensionHigh || 75000)
    : (totalUtilLow > 0 ? totalUtilLow : 0);

  // ── Site Access & Sizing ──
  let sizingText = "TBD", sizingColor = "#94A3B8", sizingTag = "PENDING";
  if (!isNaN(acres)) {
    if (acres >= 3.5 && acres <= 5) { sizingText = `${acres} ac — PRIMARY (one-story climate-controlled)`; sizingColor = "#16A34A"; sizingTag = "MEETS CRITERIA"; }
    else if (acres >= 2.5 && acres < 3.5) { sizingText = `${acres} ac — SECONDARY (multi-story 3-4 story)`; sizingColor = "#16A34A"; sizingTag = "MEETS CRITERIA"; }
    else if (acres < 2.5) { sizingText = `${acres} ac — Below minimum threshold`; sizingColor = "#EF4444"; sizingTag = "FAIL"; }
    else if (acres > 5 && acres <= 7) { sizingText = `${acres} ac — Viable if subdivisible`; sizingColor = "#F59E0B"; sizingTag = "CAUTION"; }
    else { sizingText = `${acres} ac — Large tract, subdivision potential`; sizingColor = "#F59E0B"; sizingTag = "CAUTION"; }
  }

  // ── PS Proximity ──
  const psDistance = site.siteiqData?.nearestPS ? `${site.siteiqData.nearestPS} mi` : null;
  const psColor = site.siteiqData?.nearestPS ? (site.siteiqData.nearestPS > 35 ? "#EF4444" : site.siteiqData.nearestPS <= 15 ? "#16A34A" : "#F59E0B") : "#94A3B8";

  // ── Competition ──
  const cc = site.siteiqData?.competitorCount;
  const compColor = cc !== undefined && cc !== null ? (cc <= 1 ? "#16A34A" : cc <= 3 ? "#F59E0B" : "#EF4444") : "#94A3B8";
  const compLabel = cc !== undefined && cc !== null ? (cc === 0 ? "NO COMPETITORS" : cc === 1 ? "1 COMPETITOR" : cc + " COMPETITORS") : "NOT ASSESSED";
  const satLevel = cc !== undefined && cc !== null ? (cc === 0 ? "Unserved Market" : cc <= 2 ? "Low Saturation" : cc <= 4 ? "Moderate Saturation" : "High Saturation") : "Unknown";
  const sfCapitaMatch = (site.demandSupplySignal || "").match(/([\d.]+)\s*SF\/capita/i);
  const sfCapita = sfCapitaMatch ? parseFloat(sfCapitaMatch[1]) : null;
  const sfCapitaColor = sfCapita !== null ? (sfCapita < 5 ? "#16A34A" : sfCapita <= 9 ? "#3B82F6" : "#EF4444") : "#94A3B8";
  const sfCapitaLabel = sfCapita !== null ? (sfCapita < 5 ? "Underserved" : sfCapita <= 9 ? "Equilibrium" : "Oversupplied") : "Unknown";

  // ── Demographics classifications ──
  const demoScore = (popN && incN) ? (popN >= 40000 && incN >= 60000 ? "MEETS CRITERIA" : popN >= 20000 && incN >= 50000 ? "MARGINAL" : "BELOW THRESHOLD") : null;
  const demoColor = demoScore === "MEETS CRITERIA" ? "#16A34A" : demoScore === "MARGINAL" ? "#F59E0B" : "#EF4444";
  const growthColor = growthPct !== null ? (growthPct >= 1.5 ? "#16A34A" : growthPct >= 0.5 ? "#3B82F6" : growthPct >= 0 ? "#F59E0B" : "#EF4444") : "#94A3B8";
  const incTier = incN >= 90000 ? "PREMIUM" : incN >= 75000 ? "AFFLUENT" : incN >= 65000 ? "STRONG" : incN >= 55000 ? "ADEQUATE" : "BELOW THRESHOLD";
  const incomeColor = incN >= 90000 ? "#C9A84C" : incN >= 75000 ? "#22C55E" : incN >= 65000 ? "#3B82F6" : incN >= 55000 ? "#FBBF24" : "#EF4444";
  const popSignal = popN >= 40000 ? "DENSE MARKET" : popN >= 25000 ? "SOLID DEMAND" : popN >= 10000 ? "EMERGING" : popN > 0 ? "THIN" : "N/A";
  const popColor = popN >= 40000 ? "#22C55E" : popN >= 25000 ? "#3B82F6" : popN >= 10000 ? "#FBBF24" : "#EF4444";
  const growthOutlook = growthPct !== null ? (growthPct > 1.5 ? "High Growth" : growthPct > 0.5 ? "Growing" : growthPct > 0 ? "Stable Growth" : growthPct > -0.5 ? "Flat" : "Declining") : "N/A";
  const outlookColor = growthPct !== null ? (growthPct > 1.5 ? "#22C55E" : growthPct > 0.5 ? "#4ADE80" : growthPct > 0 ? "#FBBF24" : growthPct > -0.5 ? "#94A3B8" : "#EF4444") : "#64748B";

  // ── Flags (unified across all reports) ──
  const flags = [];
  if (!site.zoning) flags.push("No zoning district recorded — critical data gap");
  if (zoningClass === "unknown") flags.push("Zoning classification not confirmed — verify with local planning");
  if (zoningClass === "prohibited") flags.push("Storage use PROHIBITED in current zoning district");
  if (zoningClass === "rezone-required") flags.push("Rezone required — timeline and political risk apply");
  if (!site.coordinates) flags.push("No coordinates — cannot verify location");
  if (!isNaN(acres) && acres < 2.5) flags.push("Below minimum acreage threshold");
  if (popN && popN < 10000) flags.push("3-mi population below 10,000 minimum");
  if (incN && incN < 60000) flags.push("3-mi median HHI below $60,000 target");
  if (!site.askingPrice || site.askingPrice === "TBD") flags.push("No confirmed asking price");
  if (hasFlood) flags.push("Flood zone identified — verify FEMA panel and insurance cost");
  if (!hasUtilities && !hasSeptic) flags.push("Utility availability not confirmed — verify water hookup (HARD REQUIREMENT for fire suppression)");
  if (site.waterAvailable === false) flags.push("WATER HOOKUP Need Further Research — municipal water is a HARD REQUIREMENT for fire suppression. Septic OK for sewer.");
  if (hasWell) flags.push("Well water noted — may need municipal connection for commercial use");
  if (hasOverlay) flags.push("Overlay district applies — additional standards may affect design/cost");
  if (site.waterAvailable === false && !site.distToWaterMain) flags.push("Water extension required but distance to main UNKNOWN — critical cost variable");
  if (distFt && distFt > 500) flags.push(`Water main is ${Math.round(distFt)} LF away — extension cost est. $${Math.round((extensionLow || 0) / 1000)}K–$${Math.round((extensionHigh || 0) / 1000)}K`);
  if (site.fireFlowAdequate === false) flags.push("Fire flow INADEQUATE — hydrant/main upgrade required before development");

  // ── Risk Matrix (shared across pricing & REC) ──
  const risks = [];
  if (zoningClass === "rezone-required" || zoningClass === "prohibited") risks.push({ cat: "Entitlement", level: "HIGH", desc: "Rezone or rezoning required — timeline, political, and cost risk", color: "#EF4444" });
  else if (zoningClass === "conditional") risks.push({ cat: "Entitlement", level: "MEDIUM", desc: "SUP/CUP required — public hearing process", color: "#F59E0B" });
  else if (zoningClass === "by-right") risks.push({ cat: "Entitlement", level: "LOW", desc: "Storage use permitted by right", color: "#16A34A" });
  if (hasFlood) risks.push({ cat: "Environmental", level: "HIGH", desc: "Flood zone identified — insurance cost and development constraints", color: "#EF4444" });
  if (site.waterAvailable === false) risks.push({ cat: "Utilities", level: "HIGH", desc: "Municipal water not confirmed — HARD REQUIREMENT for fire suppression", color: "#EF4444" });
  else if (!site.waterProvider) risks.push({ cat: "Utilities", level: "MEDIUM", desc: "Water provider not yet identified — needs verification", color: "#F59E0B" });
  if (cc > 5) risks.push({ cat: "Competition", level: "MEDIUM", desc: `${cc} competitors within 3mi — potential supply saturation`, color: "#F59E0B" });
  if (popN && popN < 15000) risks.push({ cat: "Demographics", level: "MEDIUM", desc: "3-mi population below 15K — limited demand pool", color: "#F59E0B" });
  if (growthPct !== null && growthPct < 0) risks.push({ cat: "Growth", level: "HIGH", desc: `Negative population growth (${growthPct}%) — declining market`, color: "#EF4444" });

  // ── Key Strength / Risk for executive summaries ──
  const keyStrength = popN >= 40000 ? "Exceptional population density within 3-mi radius" : growthPct >= 2.0 ? "High-growth corridor with strong projected demand" : zoningClass === "by-right" && popN >= 25000 ? "Permitted zoning + strong demographics" : zoningClass === "by-right" ? "Storage permitted by-right — no entitlement risk" : "Evaluate on case-by-case basis";
  const keyRisk = zoningClass === "prohibited" ? "Storage explicitly prohibited — rezone is only path" : zoningClass === "unknown" ? "Zoning not verified — cannot confirm storage permissibility" : zoningClass === "rezone-required" ? "Rezone required — political risk and 4-12 month timeline" : waterHookup === "no-provider" ? "No municipal water provider identified — fire code blocker" : hasFlood ? "Flood zone present — insurance cost and development constraints" : popN < 10000 && popN > 0 ? "Low population density — demand may not support facility" : flags.length > 0 ? flags[0] : "No critical risks identified";

  // ── Cost adjustments that flow into pricing ──
  // These represent vetting-discovered cost impacts not captured in the standard
  // construction cost model. They feed into buildSitePackage → computeSiteFinancials.
  const vettingCostAdders = {
    overlayCost: overlayCostAdder,          // Overlay district design/facade premium
    facadePremium: facadePremium,           // Masonry/stone facade upgrade cost
    utilityExtension: utilCostAdder,         // Water/utility extension or hookup costs beyond standard tap
    totalAdder: overlayCostAdder + facadePremium + utilCostAdder,
  };

  return {
    // Parsed demographics
    acres, popN, incN, hhN, hvN, pop1, growthPct,
    // Demographic classifications (shared — no recomputation in reports)
    demoScore, demoColor, incTier, incomeColor, popSignal, popColor,
    growthOutlook, outlookColor, growthColor,
    // Zoning
    zoningClass, zoningColor, zoningLabel, zoningTableAccessed,
    hasByRight, hasSUP, hasRezone, hasOverlay, hasFlood, hasUtilities, hasSeptic, hasWell,
    // Utilities
    utilChecks, utilScore, utilGrade, utilGradeColor,
    waterHookup, waterHookupLabel, waterHookupColor,
    distFt, waterTapN, sewerTapN, impactN, extensionLow, extensionHigh, totalUtilLow, totalUtilHigh,
    // Site access & sizing
    sizingText, sizingColor, sizingTag,
    // PS proximity
    psDistance, psColor,
    // Competition
    cc, compColor, compLabel, satLevel, sfCapita, sfCapitaColor, sfCapitaLabel,
    // Flags & risks (shared across all reports)
    flags, risks, keyStrength, keyRisk,
    // Cost adjustments (flows into pricing)
    vettingCostAdders,
  };
};

// ─── Site Package Orchestrator — Single computation, all reports consume ───
// Calls all computation functions ONCE and returns a unified object.
// Any report generator can destructure what it needs without recomputing.
// Ensures circularity: demographics → vetting → pricing → REC all share one truth.
export const buildSitePackage = (site, siteScoreConfig, valuationOverrides = {}) => {
  const timestamp = new Date().toISOString();

  // 1. Demographics (foundation layer)
  // buildDemoReport is imported from utils at call site — we accept it as a result
  // to avoid circular imports. Caller passes it in.

  // 2. SiteScore (quality layer)
  const iq = computeSiteScore(site, siteScoreConfig);

  // 3. Vetting Intelligence (research layer)
  const vet = computeVettingIntel(site);

  // 4. Financial Model (pricing layer) — receives vetting cost adjustments
  const siteOverrides = site.overrides || {};
  // Merge vetting-discovered cost adders into site overrides so pricing reflects reality
  const enrichedOverrides = {
    ...siteOverrides,
    // Add vetting-discovered costs to utility infrastructure budget
    utilityInfraBase: (siteOverrides.utilityInfraBase || valuationOverrides.utilityInfraBase || 75000) + (vet.vettingCostAdders.utilityExtension || 0),
  };
  const fin = computeSiteFinancials(site, valuationOverrides, enrichedOverrides);

  // 5. Pricing verdict augmented with vetting risk context
  const landVerdictRisk = vet.risks.some(r => r.level === "HIGH") ? "HIGH_RISK_SITE" : vet.risks.some(r => r.level === "MEDIUM") ? "MEDIUM_RISK_SITE" : "LOW_RISK_SITE";

  // 6. Cross-report recommendation
  const score = iq.score || 0;
  const recommendation = score >= 8.0 ? "AUTO-ADVANCE — Site meets all thresholds for review queue."
    : score >= 6.0 ? "PRESENT FOR REVIEW — Strong candidate with noted concerns."
    : score >= 4.0 ? "FLAGGED — Below target thresholds. Recommend pass unless override."
    : typeof score === "number" && score > 0 ? "AUTO-PASS — Below minimum thresholds."
    : "INSUFFICIENT DATA — Complete research before scoring.";
  const recColor = score >= 8.0 ? "#16A34A" : score >= 6.0 ? "#F59E0B" : typeof score === "number" ? "#EF4444" : "#94A3B8";

  // 7. Vetting completeness (22-item checklist per §6h-2)
  const combined = ((site.zoning || "") + " " + (site.summary || "") + " " + (site.zoningNotes || "")).toLowerCase();
  const vetCompleteness = {
    zoning: [
      { item: "Zoning district confirmed", done: !!site.zoning },
      { item: "Permitted use table accessed", done: vet.zoningTableAccessed },
      { item: "Use category identified", done: !!site.zoningUseTerm },
      { item: "Ordinance section cited", done: !!site.zoningOrdinanceSection },
      { item: "Ordinance URL/source", done: !!site.zoningSource },
      { item: "Overlay districts checked", done: vet.hasOverlay || !!site.overlayDistrict },
      { item: "Planning dept contact", done: !!site.planningPhone || !!site.planningEmail },
      { item: "Verification date", done: !!site.zoningVerifyDate },
    ].map(c => ({ ...c, done: typeof c.done === 'boolean' ? c.done : false })),
    utility: [
      { item: "Water provider identified", done: !!site.waterProvider },
      { item: "Water hookup status", done: !!site.waterHookupStatus },
      { item: "Service boundary checked", done: site.insideServiceBoundary === true || site.insideServiceBoundary === false },
      { item: "Distance to water main", done: !!site.distToWaterMain },
      { item: "Fire flow assessed", done: site.fireFlowAdequate === true || site.fireFlowAdequate === false },
      { item: "Sewer solution", done: !!site.sewerProvider || vet.hasSeptic },
      { item: "Electric + 3-phase", done: !!site.electricProvider },
      { item: "Tap fees documented", done: !!site.waterTapFee || !!site.tapFees },
      { item: "Water contact provided", done: !!site.waterContact },
    ],
    topo: [
      { item: "FEMA flood zone", done: !!site.femaFloodZone || vet.hasFlood || /zone x/i.test(combined) },
      { item: "Terrain classification", done: !!site.terrainClass },
      { item: "Wetlands check", done: !!site.wetlands || /wetland|nwi/i.test(combined) },
      { item: "Grade change estimate", done: !!site.gradeChange },
      { item: "Grading cost risk", done: !!site.gradingCostRisk },
    ],
  };
  // Patch overlay check to include "no overlay" keyword detection
  vetCompleteness.zoning[5].done = vet.hasOverlay || !!site.overlayDistrict || /no overlay/i.test(combined);
  const allChecks = [...vetCompleteness.zoning, ...vetCompleteness.utility, ...vetCompleteness.topo];
  const completionPct = Math.round((allChecks.filter(c => c.done).length / allChecks.length) * 100);
  const completionGate = completionPct >= 50 ? "PASS" : "FAIL";

  return {
    // Metadata
    _packageVersion: "1.0",
    _timestamp: timestamp,
    _site: site,

    // Layer 1: SiteScore
    iq,

    // Layer 2: Vetting Intelligence
    vet,

    // Layer 3: Financial Model (with vetting cost adjustments baked in)
    fin,

    // Layer 4: Cross-report derived fields
    recommendation,
    recColor,
    landVerdictRisk,
    vetCompleteness,
    completionPct,
    completionGate,
  };
};

// ─── SiteScore Validation — REIC Outcome Correlation Engine ───
// Computes correlation stats between SiteScore predictions and REIC outcomes.
// Pure function: takes array of site objects, returns analytics for the Validation tab.
export const computeValidationStats = (sites) => {
  const withOutcome = sites.filter(s => s.reicOutcome === "approved" || s.reicOutcome === "rejected");
  const approved = withOutcome.filter(s => s.reicOutcome === "approved");
  const rejected = withOutcome.filter(s => s.reicOutcome === "rejected");

  // Helper: average of numeric array
  const avg = (arr) => {
    const nums = arr.filter(v => v != null && !isNaN(v));
    return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
  };

  // Helper: get score for a site (prefer snapshot, fall back to current)
  const getScore = (s) => {
    if (s.scoreAtReicSubmit != null && !isNaN(Number(s.scoreAtReicSubmit))) return Number(s.scoreAtReicSubmit);
    return null;
  };

  // --- Score Band Breakdown ---
  const bands = [
    { label: "8.0–10", min: 8, max: 10.01, color: "#22C55E" },
    { label: "6.0–7.9", min: 6, max: 8, color: "#3B82F6" },
    { label: "4.0–5.9", min: 4, max: 6, color: "#F59E0B" },
    { label: "0–3.9", min: 0, max: 4, color: "#DC2626" },
  ];
  const bandStats = bands.map(b => {
    const inBand = withOutcome.filter(s => {
      const sc = getScore(s);
      return sc != null && sc >= b.min && sc < b.max;
    });
    const app = inBand.filter(s => s.reicOutcome === "approved").length;
    return {
      ...b,
      total: inBand.length,
      approved: app,
      rejected: inBand.length - app,
      approvalRate: inBand.length > 0 ? app / inBand.length : null,
    };
  });

  // --- Confusion Matrix (Classification at submission vs Outcome) ---
  const classifications = ["GREEN", "YELLOW", "ORANGE", "RED"];
  const confusionMatrix = classifications.map(cls => {
    const inClass = withOutcome.filter(s => (s.classAtReicSubmit || "").toUpperCase() === cls);
    const app = inClass.filter(s => s.reicOutcome === "approved").length;
    return {
      classification: cls,
      total: inClass.length,
      approved: app,
      rejected: inClass.length - app,
      accuracy: inClass.length > 0 ? (cls === "GREEN" || cls === "YELLOW" ? app / inClass.length : (inClass.length - app) / inClass.length) : null,
    };
  });

  // --- Per-Dimension Predictive Power ---
  const dimKeys = ["population", "growth", "income", "households", "homeValue", "zoning", "psProximity", "access", "competition", "marketTier"];
  const dimLabels = { population: "Population", growth: "Growth", income: "Income", households: "Households", homeValue: "Home Value", zoning: "Zoning", psProximity: "PS Proximity", access: "Access & Size", competition: "Competition", marketTier: "Market Tier" };
  const dimStats = dimKeys.map(key => {
    const appScores = approved.map(s => s.scoresAtReicSubmit?.[key]).filter(v => v != null && !isNaN(v));
    const rejScores = rejected.map(s => s.scoresAtReicSubmit?.[key]).filter(v => v != null && !isNaN(v));
    const appAvg = avg(appScores);
    const rejAvg = avg(rejScores);
    return {
      key,
      label: dimLabels[key] || key,
      appAvg,
      rejAvg,
      delta: appAvg != null && rejAvg != null ? appAvg - rejAvg : null,
      appCount: appScores.length,
      rejCount: rejScores.length,
    };
  });

  // --- Confidence level ---
  const total = withOutcome.length;
  const confidence = total >= 25 ? "high" : total >= 10 ? "medium" : "low";
  const confidenceLabel = total >= 25 ? "Statistically meaningful sample" : total >= 10 ? "Patterns emerging — building confidence" : "Early data — trends are directional only";

  return {
    total,
    approvedCount: approved.length,
    rejectedCount: rejected.length,
    approvalRate: total > 0 ? approved.length / total : null,
    avgScoreApproved: avg(approved.map(getScore)),
    avgScoreRejected: avg(rejected.map(getScore)),
    bandStats,
    confusionMatrix,
    dimStats,
    confidence,
    confidenceLabel,
    pending: sites.filter(s => s.reicOutcome === "pending").length,
  };
};
