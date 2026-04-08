// ─── Crexi Intelligence Parser v1.0 ───
// Structured extraction from Crexi Intelligence property pages.
//
// THREE INGEST PATHS:
// 1. Chrome extraction — Claude reads Crexi Intelligence page, extracts structured data
// 2. Notification email — Crexi saved search emails parsed for listing URLs + metadata
// 3. Manual entry — Dan pastes key fields into the dashboard submit form
//
// OUTPUT: Normalized facility record ready for Firebase write + AcquisitionScore input.
//
// CONTACT DEEP-VET: Crexi Intelligence provides raw contact info (often masked or
// incomplete). This module scores contact quality and generates ordered vet steps:
// Crexi first → Secretary of State → LinkedIn → county records → phone verify → outreach.

import { safeNum } from "../../utils";

// ─── TARGET FIELDS: What We Extract from Crexi Intelligence ───
// Maps Crexi Intelligence page sections to our Firebase schema.
// Claude reads the page and populates these fields via Chrome MCP tools.
export const CREXI_FIELD_MAP = {
  // ── PROPERTY BASICS ──
  name:             { section: "Page title / property name", required: true },
  address:          { section: "Property address line", required: true },
  city:             { section: "City from address", required: true },
  state:            { section: "State abbreviation", required: true },
  zip:              { section: "ZIP code", required: false },
  coordinates:      { section: "Map widget lat/lng or page source", required: true },
  totalSF:          { section: "Building size / total SF", required: true },
  acreage:          { section: "Lot size in acres", required: false },
  unitCount:        { section: "Number of storage units", required: false },
  yearBuilt:        { section: "Year built", required: false },
  stories:          { section: "Number of stories", required: false },
  facilityType:     { section: "Property type / subtype", required: false },
  climatePct:       { section: "% climate-controlled (from description or unit mix)", required: false },
  listingUrl:       { section: "Crexi property URL", required: true },
  crexiPropertyId:  { section: "Crexi property ID (from URL: /properties/XXXXXX)", required: true },

  // ── FINANCIAL / DEBT (THE MOAT) ──
  askingPrice:          { section: "Asking price", required: true },
  loanMaturityDate:     { section: "Loan maturity date (Crexi Intelligence debt tab)", required: false },
  loanOriginationDate:  { section: "Loan origination date", required: false },
  loanAmount:           { section: "Original loan amount", required: false },
  loanRate:             { section: "Interest rate at origination", required: false },
  loanLTV:              { section: "Loan-to-value at origination", required: false },
  lenderName:           { section: "Lender / servicer name", required: false },
  lastSaleDate:         { section: "Last sale date (transaction history)", required: false },
  lastSalePrice:        { section: "Last sale price", required: false },

  // ── OWNERSHIP ──
  ownerEntity:      { section: "Owner entity name (from tax/ownership tab)", required: false },
  ownerType:        { section: "Owner classification (individual/LLC/REIT/etc)", required: false },
  ownerPortfolioSize: { section: "Number of properties owned by entity", required: false },

  // ── BROKER / CONTACTS ──
  brokerName:       { section: "Listing broker name (Listing Contacts section)", required: false },
  brokerEmail:      { section: "Broker email (click eyeball to reveal)", required: false },
  brokerPhone:      { section: "Broker phone number", required: false },
  brokerFirm:       { section: "Brokerage firm name", required: false },

  // ── OPERATIONS (if available) ──
  occupancy:        { section: "Current occupancy rate", required: false },
  noi:              { section: "NOI (if listed)", required: false },
  capRate:          { section: "Cap rate (if listed)", required: false },

  // ── LISTING META ──
  daysOnMarket:     { section: "Days on Crexi", required: false },
  description:      { section: "Property description (first 500 chars)", required: false },
};

// ─── Parse raw extracted data into a normalized facility record ───
// Input: object with keys from CREXI_FIELD_MAP (extracted by Claude from Chrome)
// Output: normalized facility record ready for Firebase + AcquisitionScore
export function parseCrexiExtraction(raw) {
  const facility = {
    // Core identity
    name: raw.name || "",
    address: raw.address || "",
    city: raw.city || "",
    state: raw.state || "",
    zip: raw.zip || "",
    coordinates: normalizeCoordinates(raw.coordinates),
    listingUrl: raw.listingUrl || "",
    listingSource: "Crexi Intelligence",

    // Physical
    totalSF: safeNum(raw.totalSF),
    acreage: safeNum(raw.acreage),
    unitCount: safeNum(raw.unitCount),
    yearBuilt: safeNum(raw.yearBuilt),
    stories: safeNum(raw.stories),
    facilityType: normalizeFacilityType(raw.facilityType, raw.climatePct, raw.description),
    climatePct: safeNum(raw.climatePct),

    // Financial / Debt — THE CREXI INTELLIGENCE MOAT
    crexi: {
      propertyId: raw.crexiPropertyId || extractPropertyId(raw.listingUrl),
      loanMaturityDate: normalizeDate(raw.loanMaturityDate),
      loanOriginationDate: normalizeDate(raw.loanOriginationDate),
      loanAmount: safeNum(raw.loanAmount),
      loanRate: safeNum(raw.loanRate),
      loanLTV: safeNum(raw.loanLTV),
      lenderName: raw.lenderName || "",
      lastSaleDate: normalizeDate(raw.lastSaleDate),
      lastSalePrice: safeNum(raw.lastSalePrice),
      extractedAt: new Date().toISOString(),
    },

    // Ownership
    ownerEntity: raw.ownerEntity || "",
    ownerType: classifyOwnerType(raw.ownerType, raw.ownerEntity, raw.ownerPortfolioSize),
    owner: {
      name: raw.ownerEntity || "",
      type: classifyOwnerType(raw.ownerType, raw.ownerEntity, raw.ownerPortfolioSize),
      portfolioSize: safeNum(raw.ownerPortfolioSize),
      contactVetLevel: "crexi_raw",   // Starting point — needs deep vet
    },

    // Broker
    sellerBroker: raw.brokerName || "",
    brokerEmail: raw.brokerEmail || "",
    brokerPhone: raw.brokerPhone || "",
    brokerFirm: raw.brokerFirm || "",

    // Operations
    operations: {
      occupancy: safeNum(raw.occupancy),
      googleRating: 0,               // Enriched later
      reviewKeywords: [],             // Enriched later
    },

    // Underwriting (seed from Crexi data)
    underwriting: {
      askingPrice: safeNum(raw.askingPrice),
      impliedCapRate: computeImpliedCap(raw.noi, raw.askingPrice),
      marketCapRate: 0,               // Enriched from MSA data later
    },

    // Listing meta
    daysOnMarket: safeNum(raw.daysOnMarket),
    description: (raw.description || "").slice(0, 500),

    // Pipeline (initial state)
    pipeline: {
      stage: "Identified",
      addedDate: new Date().toISOString(),
      source: "Crexi Intelligence",
    },

    // Enrichment flags (set to false — enrichment pipeline fills these)
    _enriched: {
      esri: false,
      psProximity: false,
      competition: false,
      googleReviews: false,
      msaRents: false,
    },
  };

  // Validation
  facility._validation = validateFacility(facility);

  return facility;
}

// ─── HELPERS ───

function normalizeCoordinates(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  // Already "lat,lng" format
  if (/^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(s)) return s;
  // Try to extract from various formats
  const m = s.match(/(-?\d+\.?\d+)\s*[,/]\s*(-?\d+\.?\d+)/);
  if (m) return `${m[1]},${m[2]}`;
  return s;
}

function normalizeDate(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw; // Keep raw string if unparseable
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

function extractPropertyId(url) {
  if (!url) return "";
  const m = String(url).match(/properties\/(\d+)/);
  return m ? m[1] : "";
}

function normalizeFacilityType(type, climatePct, description) {
  const t = (type || "").toLowerCase();
  const d = (description || "").toLowerCase();
  const cc = safeNum(climatePct);

  if (t.includes("climate") || cc >= 80) return "climate";
  if (t.includes("drive") || cc === 0) return "driveup";
  if (cc > 0 && cc < 80) return "mixed";
  // Infer from description
  if (d.includes("climate controlled") || d.includes("climate-controlled")) return "climate";
  if (d.includes("drive-up") || d.includes("drive up")) return "driveup";
  return "unknown";
}

function classifyOwnerType(rawType, entityName, portfolioSize) {
  const t = (rawType || "").toLowerCase();
  const e = (entityName || "").toLowerCase();
  const ps = safeNum(portfolioSize);

  // Explicit type provided
  if (t.includes("individual") || t.includes("person")) return "individual";
  if (t.includes("government") || t.includes("non-profit") || t.includes("municipality")) return "government";
  if (t.includes("reit") || t.includes("institutional")) return "institutional";
  if (t.includes("trust") || t.includes("estate")) return "familyTrust";

  // Infer from portfolio size
  if (ps === 1) return "individual";
  if (ps >= 2 && ps <= 3) return "smallLLC";
  if (ps >= 4 && ps <= 10) return "smallPortfolio";
  if (ps >= 11 && ps <= 25) return "regional";
  if (ps >= 26 && ps <= 50) return "largePortfolio";
  if (ps > 50) return "institutional";

  // Infer from entity name patterns
  if (e.includes("llc") || e.includes("l.l.c")) return "smallLLC";
  if (e.includes("trust") || e.includes("estate") || e.includes("revocable")) return "familyTrust";
  if (e.includes("inc") || e.includes("corp") || e.includes("partners") || e.includes("fund")) return "smallPortfolio";

  return "";  // Unknown — needs research
}

function computeImpliedCap(noi, askingPrice) {
  const n = safeNum(noi);
  const p = safeNum(askingPrice);
  if (n > 0 && p > 0) return Math.round((n / p) * 10000) / 100; // e.g., 7.5
  return 0;
}

function validateFacility(f) {
  const errors = [];
  const warnings = [];

  if (!f.address) errors.push("Missing address");
  if (!f.city || !f.state) errors.push("Missing city/state");
  if (!f.coordinates) warnings.push("No coordinates — geocode before enrichment");
  if (!f.totalSF) warnings.push("No total SF — needed for size scoring");
  if (!f.listingUrl) warnings.push("No listing URL");

  if (!f.crexi.loanMaturityDate) {
    warnings.push("No loan maturity date — #1 scoring dimension will score 0");
  }
  if (!f.ownerType && !f.ownerEntity) {
    warnings.push("No owner data — ownership scoring defaults to 5");
  }
  if (!f.underwriting.askingPrice) {
    warnings.push("No asking price — cap rate spread cannot be calculated");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    completeness: Math.round(
      (Object.values(CREXI_FIELD_MAP).filter(
        (spec) => spec.required
      ).length -
        errors.length) /
        Object.values(CREXI_FIELD_MAP).filter((spec) => spec.required).length *
        100
    ),
  };
}

// ─── CONTACT DEEP-VET WORKFLOW ───
// Crexi Intelligence gives us raw contact info. This function builds
// the full vet pipeline Dan described: "the contact information is a
// DEEP VET of its own really on these."
//
// Vet levels (in order of reliability):
// 1. crexi_raw — straight from Crexi Intelligence (unverified, could be stale)
// 2. county_records — county assessor / Secretary of State (registered agent)
// 3. web_scrub — LinkedIn, firm website, NAI Global, broker directory
// 4. phone_verified — confirmed via phone call
// 5. direct_conversation — spoke with decision-maker
export function buildContactVetPlan(facility) {
  const owner = facility.owner || {};
  const broker = {
    name: facility.sellerBroker || "",
    email: facility.brokerEmail || "",
    phone: facility.brokerPhone || "",
    firm: facility.brokerFirm || "",
  };

  const steps = [];
  const currentLevel = owner.contactVetLevel || "unknown";

  // ── STEP 1: CREXI INTELLIGENCE (always first) ──
  // Even if we already have data, verify it's from Crexi
  if (currentLevel === "unknown" || !owner.name) {
    steps.push({
      step: 1,
      action: "PULL FROM CREXI INTELLIGENCE",
      priority: "CRITICAL",
      detail: [
        `Navigate to Crexi Intelligence for property at: ${facility.address}, ${facility.city} ${facility.state}`,
        "DEBT TAB: Extract loan maturity date, origination date, rate, LTV, lender name",
        "OWNERSHIP TAB: Extract owner entity name, mailing address, portfolio size",
        "CONTACTS TAB: Click eyeball icon to reveal masked email. Record name, email, phone",
        "TRANSACTION HISTORY: Last sale date, price, buyer/seller entities",
      ],
      targetFields: ["crexi.loanMaturityDate", "ownerEntity", "brokerEmail", "crexi.lastSaleDate"],
      source: "Crexi Intelligence subscription",
      estimatedTime: "5 min",
    });
  }

  // ── STEP 2: SECRETARY OF STATE / ENTITY UNMASK ──
  // The LLC name from Crexi hides the actual human. SOS reveals the registered agent.
  const entityName = owner.name || facility.ownerEntity || "";
  if (entityName && (entityName.toLowerCase().includes("llc") ||
      entityName.toLowerCase().includes("inc") ||
      entityName.toLowerCase().includes("trust"))) {
    steps.push({
      step: 2,
      action: "UNMASK ENTITY VIA SECRETARY OF STATE",
      priority: "HIGH",
      detail: [
        `Search "${entityName}" on ${facility.state} Secretary of State business search`,
        "Record: Registered Agent name + address, Formation date, Status (active/dissolved)",
        "The Registered Agent is often the owner or their attorney — this is the human behind the LLC",
        `State SOS URL: search "${facility.state} secretary of state business search"`,
        "If dissolved or forfeited: entity may be distressed — increases seller motivation",
      ],
      targetFields: ["owner.decisionMakerName", "owner.registeredAgent", "owner.entityStatus"],
      source: `${facility.state} Secretary of State`,
      estimatedTime: "5 min",
    });
  }

  // ── STEP 3: COUNTY TAX RECORDS ──
  // Cross-reference owner info, get mailing address, assessed value
  steps.push({
    step: steps.length + 1,
    action: "COUNTY TAX RECORDS CROSS-REFERENCE",
    priority: "HIGH",
    detail: [
      `Search ${facility.city}, ${facility.state} county assessor/auditor for: ${facility.address}`,
      "Record: Owner name on tax rolls, mailing address, assessed value (land + improvements)",
      "Check: Is mailing address different from property address? (absentee owner = more likely to sell)",
      "Check: Any tax delinquency? (financial distress signal)",
      "Check: Last sale date and price (if different from Crexi data, note discrepancy)",
    ],
    targetFields: ["owner.mailingAddress", "owner.assessedValue", "owner.absenteeOwner", "owner.taxDelinquent"],
    source: "County Assessor / Auditor",
    estimatedTime: "10 min",
  });

  // ── STEP 4: LINKEDIN + WEB SCRUB ──
  // Find the decision-maker and verify contact info
  const agentName = owner.decisionMakerName || owner.registeredAgent || "";
  steps.push({
    step: steps.length + 1,
    action: "LINKEDIN + WEB SCRUB FOR DECISION-MAKER",
    priority: "MEDIUM",
    detail: [
      agentName
        ? `Search LinkedIn for "${agentName}" + "${entityName || facility.city}"`
        : `Search LinkedIn for "${entityName}" + "self-storage" OR "storage"`,
      "Look for title: Owner, Managing Member, Principal, President",
      "Cross-reference LinkedIn profile with SOS registered agent name",
      `Google: "${entityName}" + "${facility.city}" + "self-storage"`,
      "Check if operator has a website (storageunitname.com) — often has contact info",
      "Check SpareFoot/SelfStorage.com listing for the facility — may show operator contact",
    ],
    targetFields: ["owner.decisionMakerName", "owner.linkedInUrl", "owner.email", "owner.phone"],
    source: "LinkedIn + Web Search",
    estimatedTime: "10 min",
  });

  // ── STEP 5: BROKER CONTACT VERIFICATION ──
  // If there's a listing broker, verify their info too
  if (broker.name || broker.email) {
    steps.push({
      step: steps.length + 1,
      action: "VERIFY BROKER CONTACT",
      priority: "MEDIUM",
      detail: [
        broker.email
          ? `Verify ${broker.email} — check domain against firm website (${broker.firm || "unknown firm"})`
          : `No broker email — search "${broker.name}" + "${broker.firm}" on firm website / NAI Global`,
        "Check: Is the broker email a personal address or firm address?",
        "Check: Is the broker still active at the firm? (LinkedIn, firm directory)",
        "For NAI affiliates: check naiglobal.com — naming conventions vary by affiliate",
      ],
      targetFields: ["brokerEmail", "brokerPhone"],
      source: "Firm Website + NAI Global + LinkedIn",
      estimatedTime: "5 min",
    });
  }

  // ── STEP 6: PHONE VERIFICATION ──
  if (owner.name || agentName) {
    steps.push({
      step: steps.length + 1,
      action: "PHONE VERIFICATION (PRE-OUTREACH)",
      priority: "LOW",
      detail: [
        "Before drafting outreach, verify at least one contact method is live:",
        "  - Phone: Call the number on file. Confirm it reaches the entity/person.",
        "  - Email: Send a neutral verification (e.g., delivery confirmation tool)",
        "If both bounce: flag as UNVERIFIED — Dan decides whether to proceed via mail",
      ],
      targetFields: ["owner.phoneVerified", "owner.emailVerified"],
      source: "Direct Verification",
      estimatedTime: "5 min",
    });
  }

  return {
    currentLevel,
    steps,
    totalEstimatedTime: steps.reduce((sum, s) => {
      const m = parseInt((s.estimatedTime || "").match(/\d+/)?.[0] || "0");
      return sum + m;
    }, 0) + " min",
    nextAction: steps[0] || null,
  };
}

// ─── Crexi notification email parser ───
// Extracts listing URLs and basic metadata from Crexi saved search emails.
// Input: email body text (HTML stripped to text or raw HTML)
// Output: array of { url, address, price, acreage } objects
export function parseCrexiNotificationEmail(emailBody) {
  const listings = [];
  const urlPattern = /https?:\/\/(?:www\.)?crexi\.com\/properties\/(\d+)/g;
  let match;
  const seen = new Set();

  while ((match = urlPattern.exec(emailBody)) !== null) {
    const url = match[0];
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    listings.push({
      url,
      crexiPropertyId: id,
      // These fields are extracted when Claude visits each listing page
      address: "",
      price: "",
      acreage: "",
    });
  }

  return listings;
}

// ─── Export field map for Claude extraction prompts ───
export function getExtractionPrompt() {
  const fields = Object.entries(CREXI_FIELD_MAP)
    .map(([key, spec]) => `- ${key}: ${spec.section}${spec.required ? " (REQUIRED)" : ""}`)
    .join("\n");

  return `Extract these fields from the Crexi Intelligence property page:\n\n${fields}\n\nFor loan data: check the Debt/Mortgage tab in Crexi Intelligence.\nFor ownership: check the Ownership/Tax tab.\nFor contacts: click the eyeball icon next to masked emails in the Listing Contacts section.\nReturn as a JSON object with these exact keys.`;
}
