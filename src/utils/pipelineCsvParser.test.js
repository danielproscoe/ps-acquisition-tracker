// Tests for pipelineCsvParser.js — bulk aggregator-data ingest

import { parsePipelineCsv, COLUMN_VARIANTS } from "./pipelineCsvParser";

describe("parsePipelineCsv — basic shape", () => {
  test("returns empty result on empty input", () => {
    const r = parsePipelineCsv("");
    expect(r.entries).toEqual([]);
    expect(r.parsedRows).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  test("returns empty result on null/non-string input", () => {
    expect(parsePipelineCsv(null).entries).toEqual([]);
    expect(parsePipelineCsv(undefined).entries).toEqual([]);
    expect(parsePipelineCsv(123).entries).toEqual([]);
  });

  test("returns warning when only header row present", () => {
    const r = parsePipelineCsv("operator,city,state");
    expect(r.entries).toEqual([]);
    expect(r.warnings.some((w) => /only a header row/.test(w))).toBe(true);
  });
});

describe("parsePipelineCsv — Radius+ canonical CSV", () => {
  const radiusPlusCsv = `Facility Name,Operator,Address,City,State,Status,Expected Delivery,NRSF,CC %,Stories
West Houston CC Storage,Public Storage,123 Westheimer Rd,Houston,TX,Under Construction,Q3 2026,82500,75,3
Frisco Storage Hub,Extra Space,8126 Main St,Frisco,TX,Permitted,Q1 2027,68000,80,2
Tampa Bay Storage,CubeSmart,400 Bay Dr,Tampa,FL,Announced,Q4 2027,90000,70,4`;

  test("parses 3 entries from a Radius+ canonical export", () => {
    const r = parsePipelineCsv(radiusPlusCsv);
    expect(r.parsedRows).toBe(3);
    expect(r.entries).toHaveLength(3);
  });

  test("auto-maps all 10 standard columns without override", () => {
    const r = parsePipelineCsv(radiusPlusCsv);
    expect(r.mapping.facilityName).toBe("Facility Name");
    expect(r.mapping.operator).toBe("Operator");
    expect(r.mapping.address).toBe("Address");
    expect(r.mapping.city).toBe("City");
    expect(r.mapping.state).toBe("State");
    expect(r.mapping.status).toBe("Status");
    expect(r.mapping.expectedDelivery).toBe("Expected Delivery");
    expect(r.mapping.nrsf).toBe("NRSF");
    expect(r.mapping.ccPct).toBe("CC %");
    expect(r.mapping.stories).toBe("Stories");
    expect(r.unmappedColumns).toEqual([]);
  });

  test("normalizes status field to canonical values", () => {
    const r = parsePipelineCsv(radiusPlusCsv);
    expect(r.entries[0].status).toBe("under_construction");
    expect(r.entries[1].status).toBe("permitted");
    expect(r.entries[2].status).toBe("announced");
  });

  test("coerces numeric NRSF without thousands separators", () => {
    const csv = `Operator,City,State,NRSF
Public Storage,Houston,TX,"82,500"
Extra Space,Frisco,TX,"68,000 sf"`;
    const r = parsePipelineCsv(csv);
    expect(r.entries[0].nrsf).toBe(82500);
    expect(r.entries[1].nrsf).toBe(68000);
  });

  test("coerces CC % as either '75' or '0.75' to 75", () => {
    const csv = `Operator,City,State,CC %
Public Storage,Houston,TX,75
Extra Space,Frisco,TX,0.75
CubeSmart,Tampa,FL,75%`;
    const r = parsePipelineCsv(csv);
    expect(r.entries[0].ccPct).toBe(75);
    expect(r.entries[1].ccPct).toBe(75);
    expect(r.entries[2].ccPct).toBe(75);
  });
});

describe("parsePipelineCsv — TractIQ-style column variants", () => {
  test("maps 'Property Name / Brand / Street Address / Sq Ft / Climate Controlled %'", () => {
    const csv = `Property Name,Brand,Street Address,City,State,Sq Ft,Climate Controlled %
Storage West,Public Storage,100 Main,Austin,TX,55000,80`;
    const r = parsePipelineCsv(csv);
    expect(r.mapping.facilityName).toBe("Property Name");
    expect(r.mapping.operator).toBe("Brand");
    expect(r.mapping.address).toBe("Street Address");
    expect(r.mapping.nrsf).toBe("Sq Ft");
    expect(r.mapping.ccPct).toBe("Climate Controlled %");
    expect(r.entries[0].operator).toBe("Public Storage");
    expect(r.entries[0].nrsf).toBe(55000);
  });
});

describe("parsePipelineCsv — quoting + escaping", () => {
  test("handles fields with embedded commas (quoted)", () => {
    const csv = `Operator,Address,City,State
"Public Storage, Inc.","100 Main St, Suite B",Houston,TX`;
    const r = parsePipelineCsv(csv);
    expect(r.entries[0].operator).toBe("Public Storage, Inc.");
    expect(r.entries[0].address).toBe("100 Main St, Suite B");
  });

  test("handles escaped double-quotes inside fields", () => {
    const csv = `Operator,City,State,Status
"The ""Big"" Storage",Houston,TX,Permitted`;
    const r = parsePipelineCsv(csv);
    expect(r.entries[0].operator).toBe('The "Big" Storage');
  });
});

describe("parsePipelineCsv — delimiter auto-detect", () => {
  test("detects tab-separated input", () => {
    const csv = `Operator\tCity\tState\nPublic Storage\tHouston\tTX`;
    const r = parsePipelineCsv(csv);
    expect(r.delimiter).toBe("\t");
    expect(r.entries[0].operator).toBe("Public Storage");
  });

  test("detects semicolon-separated input", () => {
    const csv = `Operator;City;State\nPublic Storage;Houston;TX`;
    const r = parsePipelineCsv(csv);
    expect(r.delimiter).toBe(";");
  });

  test("detects pipe-separated input", () => {
    const csv = `Operator|City|State\nPublic Storage|Houston|TX`;
    const r = parsePipelineCsv(csv);
    expect(r.delimiter).toBe("|");
  });

  test("respects opts.delimiter override", () => {
    const csv = `Operator,City;State`; // ambiguous — commas split first by default
    const r = parsePipelineCsv(csv, { delimiter: ";" });
    expect(r.delimiter).toBe(";");
  });
});

describe("parsePipelineCsv — warnings on missing critical fields", () => {
  test("warns when operator column is missing", () => {
    const csv = `City,State,NRSF\nHouston,TX,50000`;
    const r = parsePipelineCsv(csv);
    expect(r.warnings.some((w) => /operator/i.test(w))).toBe(true);
    expect(r.mapping.operator).toBeUndefined();
  });

  test("warns when city and state are missing", () => {
    const csv = `Operator,NRSF\nPublic Storage,50000`;
    const r = parsePipelineCsv(csv);
    expect(r.warnings.some((w) => /city.*state|state.*city/i.test(w))).toBe(true);
  });

  test("no warning when operator + city + state are all present", () => {
    const csv = `Operator,City,State\nPublic Storage,Houston,TX`;
    const r = parsePipelineCsv(csv);
    expect(r.warnings).toEqual([]);
  });
});

describe("parsePipelineCsv — state coercion", () => {
  test("upper-cases 2-letter state codes", () => {
    const csv = `Operator,City,State\nPublic Storage,Houston,tx`;
    const r = parsePipelineCsv(csv);
    expect(r.entries[0].state).toBe("TX");
  });

  test("preserves full state names in upper case (oracle handles case-insensitive)", () => {
    const csv = `Operator,City,State\nPublic Storage,Houston,Texas`;
    const r = parsePipelineCsv(csv);
    expect(r.entries[0].state).toBe("TEXAS");
  });
});

describe("parsePipelineCsv — header normalization", () => {
  test("handles snake_case + kebab-case headers", () => {
    const csv = `operator_name,city,state,net_rentable_sq_ft
Public Storage,Houston,TX,50000`;
    const r = parsePipelineCsv(csv);
    // operator_name doesn't match any variant, but "operator name" (after normalization) does
    expect(r.mapping.operator).toBe("operator_name");
    expect(r.mapping.nrsf).toBe("net_rentable_sq_ft");
  });

  test("is case-insensitive on headers", () => {
    const csv = `OPERATOR,CITY,STATE\nPublic Storage,Houston,TX`;
    const r = parsePipelineCsv(csv);
    expect(r.mapping.operator).toBe("OPERATOR");
  });
});

describe("parsePipelineCsv — edge cases", () => {
  test("skips entirely blank rows", () => {
    const csv = `Operator,City,State\nPublic Storage,Houston,TX\n,,\nExtra Space,Frisco,TX`;
    const r = parsePipelineCsv(csv);
    expect(r.parsedRows).toBe(2);
  });

  test("strips UTF-8 BOM at file start", () => {
    const csv = "﻿Operator,City,State\nPublic Storage,Houston,TX";
    const r = parsePipelineCsv(csv);
    expect(r.mapping.operator).toBe("Operator");
    expect(r.entries[0].operator).toBe("Public Storage");
  });

  test("preserves _sourceRow + _sourceLine for audit trail", () => {
    const csv = `Operator,City,State\nPublic Storage,Houston,TX`;
    const r = parsePipelineCsv(csv);
    expect(r.entries[0]._sourceRow).toBe(1);
    expect(r.entries[0]._sourceLine).toBe("Public Storage,Houston,TX");
  });

  test("returns unmapped columns separately", () => {
    const csv = `Operator,City,State,Asset Class,Yield\nPublic Storage,Houston,TX,Self-Storage,7.5`;
    const r = parsePipelineCsv(csv);
    expect(r.unmappedColumns).toContain("Asset Class");
    expect(r.unmappedColumns).toContain("Yield");
  });

  test("opts.columnMapping override skips auto-detect", () => {
    const csv = `OpName,Town,Region\nPublic Storage,Houston,TX`;
    const r = parsePipelineCsv(csv, {
      columnMapping: { operator: "OpName", city: "Town", state: "Region" },
    });
    expect(r.entries[0].operator).toBe("Public Storage");
    expect(r.entries[0].city).toBe("Houston");
    expect(r.entries[0].state).toBe("TX");
  });
});

describe("COLUMN_VARIANTS — coverage check", () => {
  test("exports all 10 normalized field names", () => {
    const expected = [
      "facilityName",
      "operator",
      "address",
      "city",
      "state",
      "status",
      "expectedDelivery",
      "nrsf",
      "ccPct",
      "stories",
    ];
    for (const f of expected) {
      expect(COLUMN_VARIANTS[f]).toBeDefined();
      expect(Array.isArray(COLUMN_VARIANTS[f])).toBe(true);
      expect(COLUMN_VARIANTS[f].length).toBeGreaterThan(0);
    }
  });
});
