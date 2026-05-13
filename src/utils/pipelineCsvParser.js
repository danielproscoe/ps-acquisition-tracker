// ═══════════════════════════════════════════════════════════════════════════
// Pipeline CSV Parser — bulk aggregator-data ingest
//
// Parses a Radius+ / TractIQ / StorTrack / Yardi Matrix / generic competitor
// pipeline-data CSV export into the entry shape that pipelineVerificationOracle
// expects. Each parsed entry runs through verifyExtractedEntries() and lands
// as one row in the Phase B Firebase audit ledger — same downstream pipeline
// as the single-screenshot Verify Screenshot mode, just at scale.
//
// Why this exists:
//   The single-screenshot intake (Move 3 ship 2026-05-11) is the demo wedge.
//   The bulk-CSV intake is the OPERATIONAL wedge: every customer that signs
//   up brings their existing Radius+ subscription history with them. Drop the
//   CSV export → all entries become Storvex audit-log entries → the longitudinal
//   moat compounds with every customer that joins.
//
// Patent posture (extends the pipelineVerificationOracle.js SYSTEM CLAIM):
//   The CSV ingest is the bulk-mode instantiation of the verification method.
//   The same operator-alias normalization, multi-source registry query, and
//   audit-ledger append apply — just dispatched per CSV row instead of per
//   vision-extracted entry. The patent claim covers both single-entry and
//   bulk-entry application; this file is the bulk-entry implementation.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Column auto-mapping table ────────────────────────────────────────────
// Maps normalized field names → array of common CSV column header variants.
// Matched case-insensitively against the trimmed header row. First match wins.
// Add new variants here as new aggregator export formats are discovered.

export const COLUMN_VARIANTS = {
  facilityName: [
    "facility name",
    "property name",
    "site name",
    "name",
    "development name",
    "project name",
    "asset name",
  ],
  operator: [
    "operator",
    "brand",
    "owner",
    "company",
    "developer",
    "operator name",
    "owner name",
    "tenant",
  ],
  address: [
    "address",
    "street address",
    "street",
    "site address",
    "property address",
  ],
  city: ["city", "municipality", "town", "locality"],
  state: ["state", "st", "province", "state abbreviation"],
  status: [
    "status",
    "development status",
    "construction status",
    "phase",
    "stage",
    "pipeline status",
  ],
  expectedDelivery: [
    "expected delivery",
    "delivery date",
    "est completion",
    "estimated completion",
    "target open",
    "target date",
    "completion date",
    "open date",
    "expected open",
    "completion",
    "delivery",
  ],
  nrsf: [
    "nrsf",
    "net rentable",
    "net rentable sq ft",
    "net rentable square feet",
    "rentable sq ft",
    "rentable square feet",
    "rentable sf",
    "square feet",
    "sq ft",
    "sqft",
    "sf",
    "total sf",
    "gross sq ft",
    "gross sf",
  ],
  ccPct: [
    "cc %",
    "cc%",
    "climate %",
    "climate%",
    "climate controlled %",
    "cc pct",
    "climate pct",
    "climate-controlled %",
  ],
  stories: ["stories", "story count", "floors", "number of stories", "num stories"],
};

// ─── Delimiter auto-detect ────────────────────────────────────────────────
// Picks the delimiter most likely to maximize column count on the first
// non-blank line. Common formats: comma, tab, semicolon, pipe.

const DELIMITERS = [",", "\t", ";", "|"];

function detectDelimiter(text) {
  const firstLine = (text.split(/\r?\n/).find((l) => l.trim().length > 0) || "");
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    // Count occurrences outside quoted regions
    const count = countOutsideQuotes(firstLine, d);
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line, delim) {
  let inQuote = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      // Toggle, accounting for escaped "" inside quoted field
      if (inQuote && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuote = !inQuote;
    } else if (!inQuote && c === delim) {
      count++;
    }
  }
  return count;
}

// ─── Line parsing (CSV-safe — handles quoted fields + escaped quotes) ─────

function parseLine(line, delim) {
  const cells = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (!inQuote && c === delim) {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

// ─── Header → normalized-field auto-mapping ───────────────────────────────

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function inferColumnMapping(headerRow, override = null) {
  if (override && typeof override === "object") {
    return { mapping: override, unmapped: [] };
  }
  const mapping = {};
  const usedHeaderIdx = new Set();
  const normalizedHeaders = headerRow.map(normalizeHeader);

  for (const [field, variants] of Object.entries(COLUMN_VARIANTS)) {
    for (const variant of variants) {
      const idx = normalizedHeaders.indexOf(variant);
      if (idx >= 0 && !usedHeaderIdx.has(idx)) {
        mapping[field] = headerRow[idx];
        usedHeaderIdx.add(idx);
        break;
      }
    }
  }

  const unmapped = headerRow.filter((_, i) => !usedHeaderIdx.has(i));
  return { mapping, unmapped };
}

// ─── Cell coercion ────────────────────────────────────────────────────────

function coerceNumber(v) {
  if (v == null || v === "") return null;
  // Strip thousands separators + spaces + units ("sf", "SF")
  const cleaned = String(v).replace(/[,\s]/g, "").replace(/sf$/i, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function coercePct(v) {
  if (v == null || v === "") return null;
  const cleaned = String(v).replace(/%/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  // If user provides 0.85, treat as 85; if user provides 85, treat as 85.
  // Heuristic: <= 1 means decimal-fraction, else assume already percent.
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

function coerceState(v) {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  // 2-letter codes pass through; full names map to abbreviations later if needed
  if (/^[A-Z]{2}$/.test(s)) return s;
  return s; // leave full names alone; Oracle does case-insensitive matching
}

function coerceStatus(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  // Normalize to one of: permitted | under_construction | announced | unknown
  if (/under.construction|in.progress|active|building/.test(s)) return "under_construction";
  if (/permitted|approved|entitled/.test(s)) return "permitted";
  if (/announced|planned|proposed/.test(s)) return "announced";
  return s.replace(/\s+/g, "_");
}

// ─── Main parse entry point ───────────────────────────────────────────────

/**
 * Parse a CSV string into normalized pipeline entries.
 *
 * @param {string} csvText - CSV file contents (utf-8, optional BOM)
 * @param {object} opts
 * @param {string} [opts.delimiter] - Override auto-detected delimiter
 * @param {object} [opts.columnMapping] - Override auto-detected column mapping
 * @returns {{
 *   entries: Array<object>,
 *   mapping: object,
 *   unmappedColumns: string[],
 *   warnings: string[],
 *   delimiter: string,
 *   rowCount: number,
 *   parsedRows: number,
 * }}
 */
export function parsePipelineCsv(csvText, opts = {}) {
  const warnings = [];

  if (typeof csvText !== "string" || csvText.trim() === "") {
    return {
      entries: [],
      mapping: {},
      unmappedColumns: [],
      warnings: ["Empty input — provide CSV text or upload a CSV file."],
      delimiter: ",",
      rowCount: 0,
      parsedRows: 0,
    };
  }

  // Strip UTF-8 BOM
  const text = csvText.replace(/^﻿/, "");
  const delimiter = opts.delimiter || detectDelimiter(text);

  const allLines = text.split(/\r?\n/);
  const nonEmptyLines = allLines.filter((l) => l.trim().length > 0);

  if (nonEmptyLines.length < 2) {
    return {
      entries: [],
      mapping: {},
      unmappedColumns: [],
      warnings: [
        nonEmptyLines.length === 1
          ? "CSV contains only a header row — no data rows to parse."
          : "CSV has no rows.",
      ],
      delimiter,
      rowCount: nonEmptyLines.length,
      parsedRows: 0,
    };
  }

  // Parse header
  const headerRow = parseLine(nonEmptyLines[0], delimiter);
  if (headerRow.length === 0) {
    return {
      entries: [],
      mapping: {},
      unmappedColumns: [],
      warnings: ["Could not parse header row."],
      delimiter,
      rowCount: nonEmptyLines.length,
      parsedRows: 0,
    };
  }

  const { mapping, unmapped } = inferColumnMapping(headerRow, opts.columnMapping);

  // Critical-field warning — Oracle needs operator + city + state at minimum
  // to score a match. Missing any of these will produce mostly INCONCLUSIVE
  // verdicts. Surface this to the user so they can column-map manually.
  if (!mapping.operator) {
    warnings.push(
      'No "operator/brand/owner" column found — verdicts will mostly be INCONCLUSIVE without operator alignment.',
    );
  }
  if (!mapping.city || !mapping.state) {
    warnings.push(
      'Missing "city" and/or "state" columns — submarket-coverage signal cannot fire.',
    );
  }

  // Build column index map for fast row→entry conversion
  const colIdx = {};
  for (const [field, headerName] of Object.entries(mapping)) {
    const i = headerRow.indexOf(headerName);
    if (i >= 0) colIdx[field] = i;
  }

  const entries = [];
  for (let r = 1; r < nonEmptyLines.length; r++) {
    const row = parseLine(nonEmptyLines[r], delimiter);
    // Skip rows that are entirely blank after delim-split
    if (row.every((c) => c === "")) continue;

    const entry = {};
    if (colIdx.facilityName != null) entry.facilityName = row[colIdx.facilityName] || null;
    if (colIdx.operator != null) entry.operator = row[colIdx.operator] || null;
    if (colIdx.address != null) entry.address = row[colIdx.address] || null;
    if (colIdx.city != null) entry.city = row[colIdx.city] || null;
    if (colIdx.state != null) entry.state = coerceState(row[colIdx.state]);
    if (colIdx.status != null) entry.status = coerceStatus(row[colIdx.status]);
    if (colIdx.expectedDelivery != null)
      entry.expectedDelivery = row[colIdx.expectedDelivery] || null;
    if (colIdx.nrsf != null) entry.nrsf = coerceNumber(row[colIdx.nrsf]);
    if (colIdx.ccPct != null) entry.ccPct = coercePct(row[colIdx.ccPct]);
    if (colIdx.stories != null) entry.stories = coerceNumber(row[colIdx.stories]);

    // Preserve the original row for downstream audit-trail visibility
    entry._sourceRow = r;
    entry._sourceLine = nonEmptyLines[r];

    entries.push(entry);
  }

  return {
    entries,
    mapping,
    unmappedColumns: unmapped,
    warnings,
    delimiter,
    rowCount: nonEmptyLines.length,
    parsedRows: entries.length,
  };
}
