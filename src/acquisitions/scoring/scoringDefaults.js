// ─── AcquisitionScore Configurable Weight System v1.0 ───
// Mirrors SITE_SCORE_DEFAULTS pattern from utils.js.
// Persisted at Firebase path: acquisitions/config/acquisition_weights
//
// AcquisitionScore evaluates EXISTING FACILITIES for purchase.
// Different from SiteScore which evaluates VACANT LAND for ground-up development.
// The key question shifts from "Can we BUILD here profitably?"
// to "Can we BUY this and improve returns?"

export const ACQUISITION_SCORE_DEFAULTS = [
  {
    key: "loanMaturity",
    label: "Loan Maturity",
    icon: "\u{1F4C5}",
    weight: 0.20,
    tip: "Months until loan maturity — closer = more motivated seller (refinance pressure)",
    source: "Crexi Intelligence",
    group: "distress",
  },
  {
    key: "ownership",
    label: "Ownership",
    icon: "\u{1F464}",
    weight: 0.15,
    tip: "Owner profile — mom-and-pop single facility vs. institutional REIT",
    source: "Crexi Intelligence + County Records",
    group: "distress",
  },
  {
    key: "capRateSpread",
    label: "Cap Rate Spread",
    icon: "\u{1F4B0}",
    weight: 0.12,
    tip: "Gap between current implied cap rate and market institutional cap — arbitrage signal",
    source: "Crexi Transactions + MSA Data",
    group: "financial",
  },
  {
    key: "facilityQuality",
    label: "Facility Quality",
    icon: "\u{1F3D7}",
    weight: 0.10,
    tip: "Age, condition, CC percentage, Google Reviews sentiment",
    source: "Google Reviews + Imagery + Permits",
    group: "physical",
  },
  {
    key: "valueAdd",
    label: "Value-Add",
    icon: "\u{2B06}",
    weight: 0.10,
    tip: "CC conversion potential, below-market rents, rebrand opportunity, tech upgrade",
    source: "Facility Analysis + Market Comps",
    group: "financial",
  },
  {
    key: "demographics",
    label: "Demographics",
    icon: "\u{1F465}",
    weight: 0.08,
    tip: "3-mile population, income, growth, households — market demand fundamentals",
    source: "ESRI GeoEnrichment 2025",
    group: "market",
  },
  {
    key: "competition",
    label: "Competition",
    icon: "\u{1F3E2}",
    weight: 0.07,
    tip: "CC SPC — climate-controlled SF per capita in the trade area",
    source: "Facility Census + ESRI",
    group: "market",
  },
  {
    key: "occupancy",
    label: "Occupancy",
    icon: "\u{1F4CA}",
    weight: 0.06,
    tip: "Current occupancy — INVERTED: lower = higher score (underperformance = value-add opportunity)",
    source: "SpareFoot / Operator Sites / Crexi",
    group: "financial",
  },
  {
    key: "reitProximity",
    label: "REIT Proximity",
    icon: "\u{1F4CD}",
    weight: 0.05,
    tip: "Distance to nearest PS/EXR/CUBE facility — market validation signal",
    source: "PS + NSA Location Database",
    group: "market",
  },
  {
    key: "facilitySize",
    label: "Facility Size",
    icon: "\u{1F4D0}",
    weight: 0.04,
    tip: "Total SF — sweet spot 40K-80K for SK/StorQuest acquisitions",
    source: "Crexi / Tax Records",
    group: "physical",
  },
  {
    key: "rentGrowth",
    label: "Rent Growth",
    icon: "\u{1F4C8}",
    weight: 0.03,
    tip: "Submarket CC rent growth trajectory — tailwind for value-add returns",
    source: "MSA CC Rent Intelligence (REIT 10-K)",
    group: "market",
  },
];

// ─── Pipeline Stages ───
export const ACQUISITION_STAGES = [
  "Identified",
  "Researching",
  "Contacted",
  "Responded",
  "Interested",
  "LOI",
  "PSA",
  "Under Contract",
  "Closed",
  "Dead",
];

export const ACQUISITION_STAGE_COLORS = {
  Identified:       { bg: "#F0F4FF", text: "#3730A3", dot: "#6366F1" },
  Researching:      { bg: "#FFF8F0", text: "#92400E", dot: "#D97706" },
  Contacted:        { bg: "#ECFDF5", text: "#065F46", dot: "#10B981" },
  Responded:        { bg: "#EFF6FF", text: "#1E40AF", dot: "#3B82F6" },
  Interested:       { bg: "#FFF7ED", text: "#C2410C", dot: "#EA580C" },
  LOI:              { bg: "#FFFBEB", text: "#92700C", dot: "#C9A84C" },
  PSA:              { bg: "#F0FDF4", text: "#166534", dot: "#16A34A" },
  "Under Contract": { bg: "#ECFDF5", text: "#065F46", dot: "#059669" },
  Closed:           { bg: "#F0FDF4", text: "#14532D", dot: "#22C55E" },
  Dead:             { bg: "#FEF2F2", text: "#991B1B", dot: "#DC2626" },
};

// ─── Buyer Profiles — Default Configurations ───
export const DEFAULT_BUYER_PROFILES = {
  storquest: {
    id: "storquest",
    label: "StorQuest / WWG",
    color: "#2563EB",
    contact: "Max Burch",
    // StorQuest elevates cap rate spread (asking rates drive their model per Max Burch)
    // and occupancy (they target underperformers). Demographics reduced.
    weights: {
      loanMaturity: 0.18,
      ownership: 0.12,
      capRateSpread: 0.15,      // elevated — asking rates drive their model
      facilityQuality: 0.08,
      valueAdd: 0.10,
      demographics: 0.05,       // reduced — they care about rents, not demographic narratives
      competition: 0.07,
      occupancy: 0.10,          // elevated — they target underperformers
      reitProximity: 0.05,
      facilitySize: 0.05,       // 50K-100K preferred
      rentGrowth: 0.05,
    },
    preferences: {
      maxPrice: 25000000,
      minSF: 30000,
      maxSF: 150000,
      targetStates: [],          // nationwide — no geographic restriction
      facilityTypes: ["climate", "mixed"],
    },
  },
  storageking: {
    id: "storageking",
    label: "Storage King / Andover",
    color: "#DC2626",
    contact: "Eric Brett",
    // SK elevates loan maturity + ownership (they target distressed mom-and-pops)
    // and value-add (they rebrand + tech upgrade everything)
    weights: {
      loanMaturity: 0.22,       // elevated — aggressive on distress
      ownership: 0.18,          // elevated — they target mom-and-pop
      capRateSpread: 0.10,
      facilityQuality: 0.05,    // reduced — they renovate everything
      valueAdd: 0.12,           // elevated — rebrand/tech upgrade stories
      demographics: 0.08,
      competition: 0.07,
      occupancy: 0.06,
      reitProximity: 0.04,
      facilitySize: 0.04,
      rentGrowth: 0.04,
    },
    preferences: {
      maxPrice: 15000000,
      minSF: 25000,
      maxSF: 120000,
      targetStates: [],          // nationwide
      facilityTypes: ["climate", "mixed", "driveup"],
    },
  },
};

// ─── Owner Types ───
export const OWNER_TYPES = [
  { key: "individual", label: "Individual / Mom-and-Pop", score: 10 },
  { key: "smallLLC", label: "Small LLC (1-3 facilities)", score: 9 },
  { key: "familyTrust", label: "Family Trust / Estate", score: 8 },
  { key: "smallPortfolio", label: "Small Portfolio (4-10)", score: 7 },
  { key: "regional", label: "Regional Operator (10-25)", score: 5 },
  { key: "largePortfolio", label: "Large Portfolio (25-50)", score: 3 },
  { key: "institutional", label: "Institutional / REIT (50+)", score: 1 },
  { key: "government", label: "Government / Non-Profit", score: 0 },
];

// ─── Contact Intelligence — Vet Levels ───
export const CONTACT_VET_LEVELS = [
  { key: "crexi_raw", label: "Crexi Intelligence (unverified)", confidence: 0.4 },
  { key: "county_records", label: "County Assessor / SOS", confidence: 0.6 },
  { key: "web_scrub", label: "Web Scrub (LinkedIn, firm site, NAI)", confidence: 0.7 },
  { key: "phone_verified", label: "Phone Verified", confidence: 0.85 },
  { key: "direct_conversation", label: "Direct Conversation", confidence: 1.0 },
];

// ─── Territory Exclusivity Defaults ───
export const DEFAULT_TERRITORIES = {
  storquest: {
    exclusive: ["CA", "AZ", "CO", "WA", "OR", "NV"],
    firstLookDays: 3,
  },
  storageking: {
    exclusive: ["GA", "NC", "SC", "AL"],
    firstLookDays: 3,
  },
  shared: ["TX", "FL", "OH", "IN", "TN", "KY"],
};
