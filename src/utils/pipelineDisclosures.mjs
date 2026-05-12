// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Disclosures — Primary-Source Extractor (Move 2)
//
// Extracts construction / development pipeline disclosures from storage
// REIT 10-Q + 10-K filings on SEC EDGAR. Two output shapes per filing:
//
//   - disclosures[]: REIT-level aggregate disclosures (remaining spend,
//     balance-sheet line items, narrative timing windows)
//   - facilities[]:  per-property named pipeline entries (rare — only
//     emerges when the REIT names individual development projects in the
//     narrative or a small table, e.g. SMA's Canadian JV property roll)
//
// Why this matters (Crush Radius+ context):
//   Storage REITs DO NOT routinely disclose per-facility pipeline in SEC
//   filings — only aggregate spend + narrative + occasional named JV
//   projects. Aggregator platforms (Radius+) synthesize per-facility
//   pipeline from third-party signals (permits, listings, construction
//   chatter) and present it as primary-source. Storvex's structural
//   answer is to HONESTLY classify what's verifiable from SEC primary
//   source (aggregate + named projects) and to flag synthesized
//   per-facility data as CLAIMED rather than VERIFIED. This is the
//   inversion wedge: Storvex treats Radius+ as input data to be graded,
//   not as a source of truth.
//
// Each disclosure / facility produced by this module carries:
//   verifiedSource: "EDGAR-10Q-{accession}" or "EDGAR-10K-{accession}"
//   verifiedDate:   extractedAt ISO date
//   verifierName:   "storvex-edgar-pipeline-extractor"
// → pipelineConfidence.js derivation rule #3 auto-classifies these as
//   VERIFIED (the EDGAR- prefix triggers it).
//
// Per-REIT strategies:
//   PSA  · Narrative remaining-spend disclosure + timing window
//   EXR  · Balance-sheet "Real estate under development/redevelopment" line
//   CUBE · Named JV under-construction projects (1-2 per filing typical)
//   NSA  · Best-effort — being absorbed by PSA, may have nothing
//   SMA  · Canadian JV property table with per-property CIP investment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize whitespace + decode common HTML entities. Mirrors the helper
 * already used in scripts/edgar/extract-*.mjs.
 */
function normalizeText(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#8203;/g, " ")
    .replace(/​|‌|‍/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&#x2019;|’/g, "'")
    .replace(/&#8220;|&#8221;|“|”/g, '"')
    .replace(/&#8211;|&#8212;|–|—/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDollarMillion(value, unit) {
  if (value == null) return null;
  const v = parseFloat(String(value).replace(/,/g, ""));
  if (!isFinite(v)) return null;
  const u = String(unit || "").toLowerCase();
  if (u.startsWith("b")) return v * 1000;
  if (u.startsWith("m")) return v;
  if (u.startsWith("th")) return v / 1000;
  return v;
}

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

function wordOrDigitToInt(s) {
  if (s == null) return null;
  const cleaned = String(s).trim().toLowerCase();
  if (!cleaned) return null;
  const digit = parseInt(cleaned, 10);
  if (isFinite(digit)) return digit;
  return WORD_NUMBERS[cleaned] != null ? WORD_NUMBERS[cleaned] : null;
}

function parseThousands(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "—" || cleaned === "-") return 0;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function makeVerifiedSource(formType, accession) {
  if (!accession) return null;
  // Strip non-alphanumerics including dashes: "10-K" → "10K", "10-Q" → "10Q",
  // "10-K/A" → "10KA". This keeps the chip-class derivation prefix tidy
  // (EDGAR-10K-... not EDGAR-10-K-...).
  const form = String(formType || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `EDGAR-${form}-${accession}`;
}

function commonMeta(meta) {
  const verifiedSource = makeVerifiedSource(meta?.form, meta?.accession);
  return {
    operator: meta?.operator || null,
    operatorName: meta?.operatorName || null,
    accession: meta?.accession || null,
    form: meta?.form || null,
    filingDate: meta?.filingDate || null,
    reportDate: meta?.reportDate || null,
    sourceURL: meta?.sourceURL || null,
    verifiedSource,
    verifiedDate: todayISO(),
    verifierName: "storvex-edgar-pipeline-extractor",
  };
}

/**
 * Pull surrounding context for a regex hit — useful when the disclosure
 * text is the citation itself.
 */
function contextSnippet(text, idx, before = 40, after = 280) {
  const start = Math.max(0, idx - before);
  const end = Math.min(text.length, idx + after);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

// ════════════════════════════════════════════════════════════════════════════
// PSA — Public Storage
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extract PSA aggregate pipeline disclosure from a normalized text.
 * PSA discloses "remaining spending on our current development pipeline"
 * in MD&A · Liquidity and Capital Resources subsection.
 *
 * @returns Array of disclosure objects with `kind: "aggregate-remaining-spend"`
 */
export function extractPSAPipelineDisclosures(text, meta) {
  const t = normalizeText(text);
  const base = commonMeta({ ...meta, operator: "PSA", operatorName: "Public Storage" });
  const disclosures = [];

  // Pattern 1 — remaining spending callout
  const remainingPattern =
    /\$\s*([\d,.]+)\s*(million|billion)\s+(?:of\s+)?remaining\s+spending\s+on\s+(?:our|the)\s+(?:current\s+)?development\s+pipeline/i;
  const remainingMatch = remainingPattern.exec(t);
  if (remainingMatch) {
    const amountMillion = parseDollarMillion(remainingMatch[1], remainingMatch[2]);
    // Look for timing window in the next ~200 chars
    const tail = t.slice(remainingMatch.index, Math.min(t.length, remainingMatch.index + 400));
    const timingPattern = /(?:will be incurred|to be incurred|over)\s+(?:primarily\s+)?(?:in|over)\s+(?:the\s+next\s+)?(\d+\s+to\s+\d+\s+(?:months|years)|\d+\s+(?:months|years))/i;
    const timingMatch = timingPattern.exec(tail);
    disclosures.push({
      ...base,
      kind: "aggregate-remaining-spend",
      remainingSpendMillion: amountMillion,
      deliveryWindow: timingMatch ? timingMatch[1] : null,
      narrative: contextSnippet(t, remainingMatch.index, 80, 400),
      citation: meta?.accession ? `Accession ${meta.accession}` : null,
    });
  }

  // Pattern 2 — acquisitions activity in "Real Estate Investment Activities".
  // PSA writes state counts in word form ("across four states") not digits
  // ("across 4 states"), so accept either via (\S+).
  const investmentActivityPattern =
    /Real\s+Estate\s+Investment\s+Activities[\s\S]{0,400}?(?:acquired|under\s+contract\s+to\s+acquire)\s+(\d{1,4})\s+self.storage\s+(?:facilit\w+|properties|stores)\s+(?:across\s+(\S+)\s+states\s+)?(?:with\s+)?(?:approximately\s+)?([\d,.]+)\s+(million|billion)?\s*(?:net rentable\s+)?square\s+feet\s+for\s+\$\s*([\d,.]+)\s*(million|billion)/i;
  const activityMatch = investmentActivityPattern.exec(t);
  if (activityMatch) {
    disclosures.push({
      ...base,
      kind: "subsequent-event-acquisitions",
      numFacilities: parseInt(activityMatch[1], 10),
      numStates: wordOrDigitToInt(activityMatch[2]),
      nrsfMillion: parseDollarMillion(activityMatch[3], activityMatch[4] || "million"),
      aggregatePriceMillion: parseDollarMillion(activityMatch[5], activityMatch[6]),
      narrative: contextSnippet(t, activityMatch.index, 30, 350),
      citation: meta?.accession ? `Accession ${meta.accession}` : null,
    });
  }

  return { operator: "PSA", disclosures, facilities: [] };
}

// ════════════════════════════════════════════════════════════════════════════
// EXR — Extra Space Storage
// ════════════════════════════════════════════════════════════════════════════

/**
 * EXR discloses real-estate under development as a balance-sheet line item
 * (in thousands) and via JV mentions in narrative. Extract both.
 */
export function extractEXRPipelineDisclosures(text, meta) {
  const t = normalizeText(text);
  const base = commonMeta({ ...meta, operator: "EXR", operatorName: "Extra Space Storage Inc" });
  const disclosures = [];

  // Pattern 1 — balance sheet line:
  //   "Real estate under development/redevelopment 103,089 101,293"
  //   (current year, prior year — both in thousands of dollars)
  const balanceSheetPattern =
    /Real\s+estate\s+under\s+development\/redevelopment\s+([\d,]+)\s+([\d,]+)/i;
  const bsMatch = balanceSheetPattern.exec(t);
  if (bsMatch) {
    disclosures.push({
      ...base,
      kind: "balance-sheet-under-development",
      currentYearThousands: parseThousands(bsMatch[1]),
      priorYearThousands: parseThousands(bsMatch[2]),
      currentYearMillion: parseThousands(bsMatch[1]) / 1000,
      priorYearMillion: parseThousands(bsMatch[2]) / 1000,
      narrative: contextSnippet(t, bsMatch.index, 60, 240),
      citation: meta?.accession ? `Accession ${meta.accession}` : null,
    });
  }

  // Pattern 2 — JV property under-development mentions
  //   "27 stores ... five of which are under development"
  const jvUnderDevelopmentPattern =
    /(\d+)\s+(?:stores|properties)[^.]{0,200}?(?:of\s+which|are\s+(?:currently\s+)?)?\s*(?:are\s+)?under\s+development/i;
  const jvMatch = jvUnderDevelopmentPattern.exec(t);
  if (jvMatch) {
    disclosures.push({
      ...base,
      kind: "jv-under-development",
      numProperties: parseInt(jvMatch[1], 10),
      narrative: contextSnippet(t, jvMatch.index, 80, 300),
      citation: meta?.accession ? `Accession ${meta.accession}` : null,
    });
  }

  return { operator: "EXR", disclosures, facilities: [] };
}

// ════════════════════════════════════════════════════════════════════════════
// CUBE — CubeSmart
// ════════════════════════════════════════════════════════════════════════════

/**
 * CUBE typically names specific JV development projects in narrative.
 * Format: "joint venture development property under construction ... in
 * <city>, ... expected to be completed during <quarter>. As of <date>,
 * we had invested $X million of the expected $Y million related to this
 * project."
 *
 * When a named project is found, emit BOTH a disclosure AND a facility
 * entry (since the project name is the per-property anchor).
 */
export function extractCUBEPipelineDisclosures(text, meta) {
  const t = normalizeText(text);
  const base = commonMeta({ ...meta, operator: "CUBE", operatorName: "CubeSmart" });
  const disclosures = [];
  const facilities = [];

  // Pattern 1 — named JV development project with city + completion + investment
  //   "joint venture development property under construction ... in New York ...
  //    expected to be completed during the first quarter of 2026. As of
  //    December 31, 2025, we had invested $17.2 million of the expected
  //    $19.0 million related to this project."
  const jvProjectPattern =
    /joint\s+venture\s+development\s+(?:property|properties)\s+under\s+construction(?:[\s\S]{0,260}?in\s+([A-Z][A-Za-z][A-Za-z\s,]{2,40}?)\s*,)?[\s\S]{0,260}?expected\s+to\s+be\s+completed\s+(?:during|in)\s+(?:the\s+)?([A-Za-z]+\s+quarter\s+of\s+\d{4}|[A-Z][a-z]+\s+\d{4}|\d{4})[\s\S]{0,260}?invested\s+\$\s*([\d,.]+)\s+million\s+of\s+the\s+expected\s+\$\s*([\d,.]+)\s+million/i;
  const jvMatch = jvProjectPattern.exec(t);
  if (jvMatch) {
    const city = jvMatch[1] ? jvMatch[1].trim() : null;
    const completion = jvMatch[2] ? jvMatch[2].trim() : null;
    const investedMillion = parseDollarMillion(jvMatch[3], "million");
    const expectedMillion = parseDollarMillion(jvMatch[4], "million");
    disclosures.push({
      ...base,
      kind: "named-jv-under-construction",
      city,
      completion,
      investedMillion,
      expectedMillion,
      remainingMillion: expectedMillion != null && investedMillion != null ? expectedMillion - investedMillion : null,
      narrative: contextSnippet(t, jvMatch.index, 30, 500),
      citation: meta?.accession ? `Accession ${meta.accession}` : null,
    });
    facilities.push({
      ...base,
      id: `cube-${(city || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${completion ? completion.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "jv"}-${meta?.accession ? meta.accession.slice(0, 12) : "x"}`,
      name: city ? `${city} JV (CUBE)` : `CUBE JV Development`,
      propertyName: city ? `${city} JV` : "CUBE JV Development",
      city,
      state: null,
      country: city && /\b(?:NY|New York)\b/.test(city) ? "United States" : null,
      msa: null,
      status: "under-construction",
      estimatedInvestment: expectedMillion != null ? Math.round(expectedMillion * 1_000_000) : null,
      investedToDate: investedMillion != null ? Math.round(investedMillion * 1_000_000) : null,
      expectedDelivery: completion,
      source: `${meta?.operator || "CUBE"} ${meta?.form || ""} ${meta?.reportDate || meta?.filingDate || ""} · Joint Venture Development`,
      citation: meta?.accession ? `Accession ${meta.accession}` : null,
      notes: `Extracted from CUBE filing narrative — named JV property with disclosed investment + expected completion.`,
      verificationNotes: `CUBE ${meta?.form || ""} primary-source named JV pipeline · invested $${investedMillion?.toFixed(1)}M of expected $${expectedMillion?.toFixed(1)}M · target ${completion || "n/a"}`,
    });
  }

  return { operator: "CUBE", disclosures, facilities };
}

// ════════════════════════════════════════════════════════════════════════════
// NSA — National Storage Affiliates (post-PSA-merger, residual)
// ════════════════════════════════════════════════════════════════════════════

/**
 * NSA is being absorbed by PSA. Most NSA filings post-merger are
 * residual / wind-down. Extract any acquisition or development activity
 * mentioned but expect this to be sparse.
 */
export function extractNSAPipelineDisclosures(text, meta) {
  const t = normalizeText(text);
  const base = commonMeta({ ...meta, operator: "NSA", operatorName: "National Storage Affiliates" });
  const disclosures = [];

  // Pattern — under construction count
  const underConstructionPattern =
    /(\d+)\s+(?:self.storage\s+)?(?:facilit\w+|properties|stores)\s+(?:currently\s+)?under\s+(?:construction|development)/i;
  const ucMatch = underConstructionPattern.exec(t);
  if (ucMatch) {
    disclosures.push({
      ...base,
      kind: "narrative-under-construction-count",
      numFacilities: parseInt(ucMatch[1], 10),
      narrative: contextSnippet(t, ucMatch.index, 80, 280),
      citation: meta?.accession ? `Accession ${meta.accession}` : null,
    });
  }

  return { operator: "NSA", disclosures, facilities: [] };
}

// ════════════════════════════════════════════════════════════════════════════
// SMA — SmartStop Self Storage REIT
// ════════════════════════════════════════════════════════════════════════════

/**
 * SMA discloses Canadian JV under-development properties by NAME with
 * per-property construction-in-progress dollars (in thousands).
 *
 * Table shape (FY2025 10-K, observed):
 *   Property         Status               2025 CIP$K   2024 CIP$K
 *   Regent (2)       Under Development    3,839        2,655
 *   Allard (3)       Under Development    1,270        —
 *   Finch (4)        Under Development    3,033        —
 *
 * Footnote anchors (2)/(3)/(4) carry acquisition-date + city + province.
 */
export function extractSMAPipelineDisclosures(text, meta) {
  const t = normalizeText(text);
  const base = commonMeta({ ...meta, operator: "SMA", operatorName: "SmartStop Self Storage REIT, Inc." });
  const disclosures = [];
  const facilities = [];

  // Per-property "Under Development" row pattern.
  // Property names are followed by a footnote marker like "(2)", "(3)", etc.
  // Captures: name, footnote, status keyword, current-year CIP$, prior-year CIP$ (or —).
  const rowPattern =
    /([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s*\((\d+)\)\s+Under\s+Development\s+([\d,]+)\s+([\d,—-]+)/g;
  const rowsFoundRaw = [];
  let m;
  while ((m = rowPattern.exec(t)) !== null) {
    const propName = m[1].trim();
    const footnote = parseInt(m[2], 10);
    const currentCIP = parseThousands(m[3]);
    const priorCIP = parseThousands(m[4]);
    rowsFoundRaw.push({ propName, footnote, currentCIP, priorCIP, idx: m.index });
  }
  // Dedupe — SMA repeats the same Canadian JV table in multiple sections of
  // each filing (notes + MD&A discussion). Keep first occurrence by propName.
  const seenNames = new Set();
  const rowsFound = [];
  for (const row of rowsFoundRaw) {
    if (seenNames.has(row.propName)) continue;
    seenNames.add(row.propName);
    rowsFound.push(row);
  }

  // Detect "Canadian JV Properties" table — every row in that table is in
  // Canada by definition, so we default country to "Canada" even when the
  // per-row footnote doesn't restate it (Regent's footnote says only "The
  // property is currently under development to become a self storage facility").
  const inCanadianJVTable = /Canadian\s+JV\s+(?:Propert(?:y|ies)|Investments)/i.test(t);

  for (const row of rowsFound) {
    // Look for the footnote text near the row (typically appears after the table).
    // Skip the in-row marker "(N) Under Development …" via negative lookahead and
    // require the footnote body to start with a capital letter (sentence start).
    const footnoteRegex = new RegExp(
      `\\(${row.footnote}\\)\\s+(?!Under\\s+Development)([A-Z][^.]{20,400}?\\.)`,
      "i"
    );
    const fnSearch = t.slice(row.idx, Math.min(t.length, row.idx + 4500));
    const fnMatch = footnoteRegex.exec(fnSearch);
    const footnoteText = fnMatch ? fnMatch[1].trim() : null;

    // Parse acquisition date + city/province from footnote when present
    const acqDatePattern = /On\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4}),\s+we\s+acquired/i;
    const acqMatch = footnoteText ? acqDatePattern.exec(footnoteText) : null;
    const acquisitionDate = acqMatch ? acqMatch[1] : null;

    const locationPattern = /(?:land\s+)?(?:in|located\s+in)\s+([A-Z][A-Za-z\s,.'-]+?(?:,\s*(?:Canada|United States|U\.S\.))?)\s*(?:,\s*with|with|\.|and)/i;
    const locMatch = footnoteText ? locationPattern.exec(footnoteText) : null;
    const location = locMatch ? locMatch[1].trim() : null;

    // Parse province/state from location. Examples observed in SMA filings:
    //   "Edmonton, Alberta, Canada" → city=Edmonton, province=Alberta
    //   "Toronto, Canada"           → city=Toronto, province=null (don't claim
    //                                  "Canada" as a province — it's the country)
    let province = null;
    let city = location;
    const COUNTRY_TOKENS = /^(?:Canada|United\s+States|U\.?S\.?A?\.?|USA)$/i;
    if (location) {
      // Try 3-part match first (city, province, country)
      const threePart = /^([A-Z][A-Za-z\s'-]+?)\s*,\s*([A-Z][A-Za-z\s]+?)\s*,\s*(Canada|United\s+States|U\.?S\.?A?\.?|USA)\s*$/.exec(location);
      if (threePart) {
        city = threePart[1].trim();
        province = threePart[2].trim();
      } else {
        // 2-part: "city, second" — if "second" is a country, drop it; else
        // treat as city/province.
        const twoPart = /^([A-Z][A-Za-z\s'-]+?)\s*,\s*([A-Z][A-Za-z\s.]+?)\s*$/.exec(location);
        if (twoPart) {
          city = twoPart[1].trim();
          const second = twoPart[2].trim();
          province = COUNTRY_TOKENS.test(second) ? null : second;
        }
      }
    }

    // When the row's "name" is a placeholder abbreviation (e.g. "AB" for a
    // newly-acquired Alberta JV parcel that hasn't been named yet) AND the
    // footnote gave us a real city, prefer the city as the canonical
    // display name. Keeps `propertyName` as the raw row label for fidelity
    // to the SEC source.
    const isPlaceholderName = row.propName.length <= 3;
    const displayName = isPlaceholderName && city
      ? `${city} JV`
      : row.propName;
    const idAnchor = (isPlaceholderName && city ? city : row.propName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const id = `sma-${idAnchor}-jv-${meta?.accession ? meta.accession.slice(0, 12) : "x"}`;
    const countryResolved = (location && /Canada/i.test(location)) ? "Canada" : (inCanadianJVTable ? "Canada" : null);

    disclosures.push({
      ...base,
      kind: "named-property-under-development",
      propertyName: row.propName,
      displayName,
      city,
      province,
      country: countryResolved,
      cipCurrentThousands: row.currentCIP,
      cipPriorThousands: row.priorCIP,
      cipDeltaThousands: row.currentCIP != null && row.priorCIP != null ? row.currentCIP - row.priorCIP : null,
      acquisitionDate,
      footnoteText,
      citation: meta?.accession ? `Accession ${meta.accession}` : null,
    });

    facilities.push({
      ...base,
      id,
      name: `${displayName} (SMA JV)`,
      propertyName: row.propName,
      city,
      state: province,
      msa: null,
      country: countryResolved,
      status: "under-development",
      estimatedInvestment: row.currentCIP != null ? row.currentCIP * 1000 : null,
      ciInProgress: row.currentCIP != null ? row.currentCIP * 1000 : null,
      acquisitionDate,
      expectedDelivery: null,
      source: `${meta?.operator || "SMA"} ${meta?.form || ""} ${meta?.reportDate || meta?.filingDate || ""} · Canadian JV Properties Table`,
      citation: meta?.accession ? `Accession ${meta.accession}` : null,
      notes: footnoteText || `SmartStop joint venture with SmartCentres · property under development.`,
      verificationNotes: `SMA ${meta?.form || ""} primary-source named JV pipeline · CIP $${(row.currentCIP / 1000).toFixed(2)}M as of ${meta?.reportDate || meta?.filingDate || "filing date"}`,
    });
  }

  return { operator: "SMA", disclosures, facilities };
}

// ════════════════════════════════════════════════════════════════════════════
// Router
// ════════════════════════════════════════════════════════════════════════════

const EXTRACTORS = {
  PSA: extractPSAPipelineDisclosures,
  EXR: extractEXRPipelineDisclosures,
  CUBE: extractCUBEPipelineDisclosures,
  NSA: extractNSAPipelineDisclosures,
  SMA: extractSMAPipelineDisclosures,
};

/**
 * Dispatch to the correct per-REIT extractor.
 */
export function extractPipelineDisclosures(operator, text, meta) {
  const key = String(operator || "").toUpperCase();
  const extractor = EXTRACTORS[key];
  if (!extractor) {
    return { operator: key, disclosures: [], facilities: [], unsupported: true };
  }
  return extractor(text, { ...meta, operator: key });
}

export const SUPPORTED_OPERATORS = Object.keys(EXTRACTORS);
