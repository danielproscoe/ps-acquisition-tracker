// msa-state-map.mjs — Maps PSA's MSA names to US state codes so the
// aggregation layer can normalize PSA (MSA-aggregated) data against EXR
// and CUBE (state-aggregated) data.
//
// Cross-MSA-state mapping based on US Census Bureau MSA definitions
// (https://www.census.gov/programs-surveys/metro-micro/about/glossary.html).
// PSA's "Other states (14 states)" rollup catches the long tail.
//
// Generated 2026-05-09 from PSA FY2025 10-K Schedule III.

export const MSA_TO_STATE = {
  // Major metros — exact state mapping
  "Los Angeles": "CA",
  "Dallas/Ft. Worth": "TX",
  "Houston": "TX",
  "Chicago": "IL",
  "San Francisco": "CA",
  "Atlanta": "GA",
  "Washington DC": "DC",  // PSA reports as DC even though MSA spans DC/MD/VA
  "Orlando/Daytona": "FL",
  "New York": "NY",  // PSA reports as NY even though MSA spans NY/NJ
  "Miami": "FL",
  "Seattle/Tacoma": "WA",
  "Denver": "CO",
  "Tampa": "FL",
  "Philadelphia": "PA",  // MSA spans PA/NJ/DE — primary state PA
  "Minneapolis/St. Paul": "MN",  // MSA spans MN/WI — primary state MN
  "Charlotte": "NC",  // MSA spans NC/SC — primary state NC
  "Detroit": "MI",
  "Phoenix": "AZ",
  "Baltimore": "MD",
  "Portland": "OR",  // MSA spans OR/WA — primary state OR
  "Oklahoma City": "OK",
  "West Palm Beach": "FL",
  "San Antonio": "TX",
  "Raleigh": "NC",
  "Austin": "TX",
  "Sacramento": "CA",
  "Columbia": "SC",
  "Norfolk": "VA",  // Virginia Beach-Norfolk MSA spans VA/NC — primary state VA
  "Indianapolis": "IN",
  "Columbus": "OH",
  "Kansas City": "MO",  // MSA spans MO/KS — primary state MO
  "Boston": "MA",  // MSA spans MA/NH — primary state MA
  "St. Louis": "MO",  // MSA spans MO/IL — primary state MO
  "Las Vegas": "NV",
  "Nashville/Bowling Green": "TN",  // MSA spans TN/KY — primary state TN
  "Mobile": "AL",
  "San Diego": "CA",
  "Cincinnati": "OH",  // MSA spans OH/KY/IN — primary state OH
  "Memphis": "TN",  // MSA spans TN/AR/MS — primary state TN
  "Greensville/Spartanburg/Asheville": "SC",  // MSA spans SC/NC — primary state SC
  "Greenville/Spartanburg/Asheville": "SC",  // alternate spelling
  "Colorado Springs": "CO",
  "Charleston": "SC",
  "Fort Myers/Naples": "FL",
  "Milwaukee": "WI",
  "Louisville": "KY",  // MSA spans KY/IN — primary state KY
  "Richmond": "VA",
  "Jacksonville": "FL",
  "Birmingham": "AL",
  "Greensboro": "NC",
  "Chattanooga": "TN",  // MSA spans TN/GA — primary state TN
  "Savannah": "GA",
  "Boise": "ID",
  "Honolulu": "HI",
  "New Orleans": "LA",
  "Salt Lake City": "UT",
  "Hartford/New Haven": "CT",
  "Omaha": "NE",  // MSA spans NE/IA — primary state NE
  "Cleveland/Akron": "OH",
  "Augusta": "GA",  // MSA spans GA/SC — primary state GA
  "Buffalo/Rochester": "NY",
  "Reno": "NV",
  "Tucson": "AZ",
  "Wichita": "KS",
  "Monterey/Salinas": "CA",
  "Dayton": "OH",
  "Roanoke": "VA",
  "Pensacola": "FL",
  "Knoxville": "TN",
  "Lexington": "KY",
  "Springfield": "MA",  // PSA could mean MA or MO Springfield — assume MA per typical PSA portfolio
  "Albuquerque": "NM",
  "Toledo": "OH",
  "Lakeland": "FL",
  "Bridgeport": "CT",
  "Allentown": "PA",
  "Lansing": "MI",
  "Spokane": "WA",
  "Stockton": "CA",
  "Fresno": "CA",
  "Lincoln": "NE",
  "Madison": "WI",
  "Anchorage": "AK",
  "Beaumont": "TX",
  "Clarksville": "TN",
  "Fayetteville": "NC",  // could be NC or AR — assume NC per PSA southeast presence
  "Lubbock": "TX",
  "Manchester": "NH",
  "Modesto": "CA",
  "Naples": "FL",
  "Ocala": "FL",
  "Olympia": "WA",
  "Ogden": "UT",
  "Provo": "UT",
  "Pueblo": "CO",
  "Riverside": "CA",
  "Rochester": "NY",
  "Salem": "OR",
  "Salisbury": "MD",
  "Sarasota": "FL",
  "Stamford": "CT",
  "Syracuse": "NY",
  "Tallahassee": "FL",
  "Tyler": "TX",
  "Vancouver": "WA",  // assume Vancouver WA, not BC
  "Visalia": "CA",
  "Waco": "TX",
  "Worcester": "MA",  // MSA spans MA/CT — primary state MA
  "Yakima": "WA",
  "York": "PA",
  "Youngstown": "OH",  // MSA spans OH/PA — primary state OH

  // Multi-state aggregates that PSA explicitly groups
  // "Other states (14 states)" — PSA's catch-all. Cannot allocate to single state.
};

// Reverse helper: state code → list of MSAs in that state.
export function buildStateToMSAs(msaToState) {
  const out = {};
  for (const [msa, state] of Object.entries(msaToState)) {
    if (!out[state]) out[state] = [];
    out[state].push(msa);
  }
  return out;
}

// US state code → full state name (for cross-referencing CUBE which uses
// full state names like "California" rather than 2-letter "CA")
export const STATE_CODE_TO_NAME = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export const STATE_NAME_TO_CODE = Object.fromEntries(
  Object.entries(STATE_CODE_TO_NAME).map(([code, name]) => [name, code])
);
