// aggregate-comps.mjs — Day 4: cross-REIT institutional cost-basis index.
//
// Combines the per-issuer Schedule III datasets (PSA, EXR, CUBE) into a
// single state-keyed comp index with sample size, weighted cost basis,
// and primary-source citations from each contributing REIT.
//
// PSA reports MSA-aggregated; we roll up MSAs to states using msa-state-map.
// EXR + CUBE report state-aggregated (2-letter and full name respectively).
// Output normalizes everyone to 2-letter state codes.
//
// Output:
//   src/data/edgar-comp-index.json — the cross-REIT institutional cost-basis
//   index. Per state: total facilities, total NRSF (where disclosed),
//   weighted average $/SF, sample size from each issuer, source citations
//   (accession numbers + filing URLs).
//
// This is the deliverable that establishes the "more accurate than Radius"
// claim — primary-source institutional cost data triangulated across the
// three biggest US storage REITs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MSA_TO_STATE, STATE_CODE_TO_NAME, STATE_NAME_TO_CODE } from "./msa-state-map.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "src", "data");

function loadIssuerData(ticker, reportDate) {
  const filename = `edgar-schedule-iii-${ticker.toLowerCase()}-${reportDate}.json`;
  const fullPath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(fullPath)) return null;
  const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  if (!data.rows || data.rows.length === 0) return null;
  return data;
}

// Normalize each issuer's row to a state-level record.
//   PSA  · row.msa is MSA name → look up via MSA_TO_STATE
//   EXR  · row.msa is 2-letter state code → use as-is (validate)
//   CUBE · row.msa is full state name → look up via STATE_NAME_TO_CODE
function normalizeToStateRecord(issuer, row) {
  let stateCode = null;
  let originalLabel = row.msa;

  if (issuer === "PSA") {
    stateCode = MSA_TO_STATE[row.msa] || null;
  } else if (issuer === "EXR") {
    if (/^[A-Z]{2}$/.test(row.msa)) stateCode = row.msa;
  } else if (issuer === "CUBE") {
    stateCode = STATE_NAME_TO_CODE[row.msa] || null;
    if (!stateCode && /Washington D\.?C\.?/i.test(row.msa)) stateCode = "DC";
  } else if (issuer === "SMA") {
    // SMA is property-level — stateCode already populated on each row
    stateCode = row.stateCode || null;
    // Skip Canadian properties (ONT — Ontario) for US-only state aggregation
    if (stateCode === "ONT") return null;
  }

  return stateCode ? {
    stateCode,
    issuer,
    originalLabel,
    aggregationLevel: row.aggregationLevel || "STATE",
    numFacilities: row.numFacilities || 0,
    nrsfThousands: row.nrsfThousands,  // may be null for EXR
    totalGrossThou: row.totalGrossThou || 0,
    accumDepThou: row.accumDepThou || 0,
    impliedPSF: row.impliedPSF,
    impliedPerFacilityM: row.impliedPerFacilityM,
    depreciationRatio: row.depreciationRatio,
  } : null;
}

function main() {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  Day 4 — Cross-REIT Institutional Cost-Basis Index Aggregation");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Load each issuer's latest data.
  const issuers = [
    { ticker: "PSA", date: "2025-12-31" },
    { ticker: "EXR", date: "2025-12-31" },
    { ticker: "CUBE", date: "2025-12-31" },
    { ticker: "SMA", date: "2025-12-31" },
  ];

  const datasets = {};
  const sources = {};
  for (const { ticker, date } of issuers) {
    const data = loadIssuerData(ticker, date);
    if (!data) {
      console.log(`✗ ${ticker} — no data file found`);
      continue;
    }
    datasets[ticker] = data;
    sources[ticker] = {
      issuer: ticker,
      issuerName: data.issuerName,
      cik: data.cik,
      form: data.form,
      filingDate: data.filingDate,
      reportDate: data.reportDate,
      accessionNumber: data.accessionNumber,
      filingURL: data.filingURL,
      extractionMethod: data.extractionMethod,
    };
    console.log(`✓ ${ticker} loaded: ${data.rows.length} rows · ${data.totals.facilities} facilities · accession ${data.accessionNumber}`);
  }
  console.log();

  // Index by state.
  const stateIndex = {};
  let unmappedRows = [];

  // First pass: roll up PROPERTY-level rows (SMA) into per-state-per-issuer
  // aggregates so each issuer contributes ONE record per state, not N
  // (where N = number of properties in that state).
  function rollupPropertyRows(ticker, rows) {
    const byState = {};
    for (const row of rows) {
      const norm = normalizeToStateRecord(ticker, row);
      if (!norm) continue;
      const sc = norm.stateCode;
      if (!byState[sc]) {
        byState[sc] = {
          stateCode: sc,
          issuer: ticker,
          originalLabel: `${ticker} portfolio in ${sc}`,
          aggregationLevel: "STATE_FROM_PROPERTY_ROLLUP",
          numFacilities: 0,
          nrsfThousands: null,  // SMA doesn't disclose
          encumbrancesThou: 0,
          landInitialThou: 0,
          bldgInitialThou: 0,
          costsSubsequentThou: 0,
          landGrossThou: 0,
          bldgGrossThou: 0,
          totalGrossThou: 0,
          accumDepThou: 0,
          impliedPSF: null,
          impliedPerFacilityM: null,
          depreciationRatio: null,
        };
      }
      const agg = byState[sc];
      agg.numFacilities += norm.numFacilities;
      agg.encumbrancesThou += (norm.encumbrancesThou || 0);
      agg.landInitialThou += (norm.landInitialThou || 0);
      agg.bldgInitialThou += (norm.bldgInitialThou || 0);
      agg.costsSubsequentThou += (norm.costsSubsequentThou || 0);
      agg.landGrossThou += (norm.landGrossThou || 0);
      agg.bldgGrossThou += (norm.bldgGrossThou || 0);
      agg.totalGrossThou += (norm.totalGrossThou || 0);
      agg.accumDepThou += (norm.accumDepThou || 0);
    }
    // Compute derived metrics on rolled-up record
    return Object.values(byState).map((agg) => ({
      ...agg,
      impliedPerFacilityM: agg.numFacilities > 0 ? Math.round((agg.totalGrossThou * 1000) / agg.numFacilities / 100000) / 10 : null,
      depreciationRatio: agg.totalGrossThou > 0 ? Math.round((agg.accumDepThou / agg.totalGrossThou) * 1000) / 1000 : null,
    }));
  }

  for (const ticker of Object.keys(datasets)) {
    const data = datasets[ticker];
    const isPropertyLevel = data.rows[0]?.aggregationLevel === "PROPERTY";

    if (isPropertyLevel) {
      // SMA — roll up properties to state then add as one contribution per state
      const rolled = rollupPropertyRows(ticker, data.rows);
      for (const norm of rolled) {
        const sc = norm.stateCode;
        if (!stateIndex[sc]) {
          stateIndex[sc] = { stateCode: sc, stateName: STATE_CODE_TO_NAME[sc] || sc, issuerContributions: [] };
        }
        stateIndex[sc].issuerContributions.push(norm);
      }
    } else {
      // PSA / EXR / CUBE — already MSA- or state-aggregated
      for (const row of data.rows) {
        const norm = normalizeToStateRecord(ticker, row);
        if (!norm) {
          unmappedRows.push({ issuer: ticker, label: row.msa, facilities: row.numFacilities });
          continue;
        }
        const sc = norm.stateCode;
        if (!stateIndex[sc]) {
          stateIndex[sc] = { stateCode: sc, stateName: STATE_CODE_TO_NAME[sc] || sc, issuerContributions: [] };
        }
        stateIndex[sc].issuerContributions.push(norm);
      }
    }
  }

  // Compute aggregate metrics per state.
  for (const state of Object.values(stateIndex)) {
    const contribs = state.issuerContributions;
    const totalFacilities = contribs.reduce((s, c) => s + c.numFacilities, 0);
    const totalGrossThou = contribs.reduce((s, c) => s + c.totalGrossThou, 0);
    const totalAccumDepThou = contribs.reduce((s, c) => s + c.accumDepThou, 0);
    const facWithNRSF = contribs.filter((c) => c.nrsfThousands != null);
    const totalNRSFThou = facWithNRSF.reduce((s, c) => s + c.nrsfThousands, 0);
    const facCountWithNRSF = facWithNRSF.reduce((s, c) => s + c.numFacilities, 0);
    const grossWithNRSF = facWithNRSF.reduce((s, c) => s + c.totalGrossThou, 0);

    state.totalFacilities = totalFacilities;
    state.totalNRSFThousands = totalNRSFThou > 0 ? totalNRSFThou : null;
    state.facilityCountForNRSF = facCountWithNRSF;
    state.totalGrossCarryingThou = totalGrossThou;
    state.totalAccumDepThou = totalAccumDepThou;
    state.numIssuersContributing = contribs.length;

    // Weighted $/SF (only counts facilities where NRSF is disclosed).
    state.weightedPSF = totalNRSFThou > 0 ? Math.round((grossWithNRSF * 1000) / (totalNRSFThou * 1000)) : null;

    // Average $/facility (uses all facilities — all issuers report this)
    state.avgPerFacilityM = totalFacilities > 0 ? Math.round((totalGrossThou * 1000) / totalFacilities / 100000) / 10 : null;

    // Portfolio-wide depreciation ratio
    state.depreciationRatio = totalGrossThou > 0 ? Math.round((totalAccumDepThou / totalGrossThou) * 1000) / 1000 : null;

    // Per-issuer breakdown (for the credibility story)
    state.perIssuer = contribs.map((c) => ({
      issuer: c.issuer,
      sourceLabel: c.originalLabel,
      facilities: c.numFacilities,
      nrsfThousands: c.nrsfThousands,
      totalGrossThou: c.totalGrossThou,
      impliedPSF: c.impliedPSF,
      depreciationRatio: c.depreciationRatio,
    }));

    delete state.issuerContributions; // hoist into perIssuer
  }

  // Sort state list by # issuers contributing (most cross-validated first)
  const stateList = Object.values(stateIndex).sort((a, b) => {
    if (b.numIssuersContributing !== a.numIssuersContributing) return b.numIssuersContributing - a.numIssuersContributing;
    return b.totalFacilities - a.totalFacilities;
  });

  // Top markets summary
  console.log("Top 15 states by total institutional facility count (sorted by cross-REIT validation):\n");
  console.log("State".padEnd(20) + "  Issuers   Fac    NRSF(M)    Gross($B)   $/SF    $M/Fac   Dep%");
  console.log("─".repeat(95));
  for (const s of stateList.slice(0, 15)) {
    const nrsfStr = s.totalNRSFThousands != null ? (s.totalNRSFThousands / 1000).toFixed(1) : "—";
    const grossStr = (s.totalGrossCarryingThou / 1000000).toFixed(2);
    const psfStr = s.weightedPSF != null ? `$${s.weightedPSF}` : "—";
    const facStr = s.avgPerFacilityM != null ? `$${s.avgPerFacilityM}M` : "—";
    const depStr = s.depreciationRatio != null ? `${(s.depreciationRatio * 100).toFixed(1)}%` : "—";
    console.log(
      s.stateName.padEnd(20) +
      `  ${s.numIssuersContributing}/3      ${String(s.totalFacilities).padStart(4)}   ${nrsfStr.padStart(6)}     $${grossStr.padStart(7)}    ${psfStr.padStart(5)}   ${facStr.padStart(7)}  ${depStr.padStart(5)}`
    );
  }

  // Build the final index payload
  const index = {
    schema: "storvex.edgar-comp-index.v1",
    generatedAt: new Date().toISOString(),
    issuersIngested: Object.keys(datasets),
    sources,
    totals: {
      facilities: stateList.reduce((s, c) => s + c.totalFacilities, 0),
      nrsfThousandsDisclosed: stateList.reduce((s, c) => s + (c.totalNRSFThousands || 0), 0),
      grossCarryingThou: stateList.reduce((s, c) => s + c.totalGrossCarryingThou, 0),
      states: stateList.length,
      crossValidatedStates: stateList.filter((s) => s.numIssuersContributing >= 2).length,
      tripleValidatedStates: stateList.filter((s) => s.numIssuersContributing === 3).length,
    },
    states: stateList,
    unmappedRows,
    citationRule: "Every per-issuer record cites a SEC EDGAR filing accession number + URL. To verify any number in this index, follow the issuer's accession number to the source filing on sec.gov.",
  };

  // Write to disk
  const outPath = path.join(DATA_DIR, "edgar-comp-index.json");
  fs.writeFileSync(outPath, JSON.stringify(index, null, 2), "utf8");

  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log(`  Cross-REIT Index — saved to src/data/edgar-comp-index.json`);
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  Issuers ingested:           ${Object.keys(datasets).join(", ")}`);
  console.log(`  Total facilities:           ${index.totals.facilities.toLocaleString()}`);
  console.log(`  Total NRSF (disclosed):     ${(index.totals.nrsfThousandsDisclosed / 1000).toFixed(1)}M SF`);
  console.log(`  Total gross carrying:       $${(index.totals.grossCarryingThou / 1000000).toFixed(2)}B`);
  console.log(`  States covered:             ${index.totals.states}`);
  console.log(`  Cross-validated (≥2 REITs): ${index.totals.crossValidatedStates} states`);
  console.log(`  Triple-validated (3 REITs): ${index.totals.tripleValidatedStates} states`);
  console.log(`  Unmapped rows (need work):  ${unmappedRows.length}`);

  if (unmappedRows.length > 0) {
    console.log(`\n  Unmapped:`);
    for (const r of unmappedRows.slice(0, 10)) {
      console.log(`    ${r.issuer}  "${r.label}"  (${r.facilities} facilities)`);
    }
  }
}

main();
