// src/config.js -- Shared constants for Storvex Acquisition Engine
// Storvex is a versatile property acquisition intelligence platform — not limited to any single property type.
// Addresses audit finding ARCH-05: Extract constants to shared config

// ---- Storvex SiteScore v2.0 Scoring Weights (must match SITE_SCORE_DEFAULTS in App.js) ----
// Weights MUST sum to exactly 1.00
export const SITESCORE_WEIGHTS = {
  population: 0.15,
  growth: 0.17,
  income: 0.08,
  pricing: 0.07,
  zoning: 0.15,
  access: 0.06,
  psProximity: 0.12,
  competition: 0.10,
  marketTier: 0.10
};
// Sum: 0.15 + 0.17 + 0.08 + 0.07 + 0.15 + 0.06 + 0.12 + 0.10 + 0.10 = 1.00

// ---- Storvex SiteScore Classification Thresholds ----
export const SITESCORE_THRESHOLDS = {
  GREEN: 7.5,    // auto-advance to Firebase
  YELLOW: 5.5,   // present for Dan's review
  ORANGE: 3.0,   // flagged
  RED: 0         // auto-pass (below 3.0)
};

// ---- Storvex SiteScore Tier Labels ----
export const SITESCORE_TIERS = [
  { min: 9, label: 'ELITE', badge: 'gold' },
  { min: 8, label: 'PRIME', badge: 'gold' },
  { min: 7, label: 'STRONG', badge: 'steel' },
  { min: 6, label: 'VIABLE', badge: 'steel' },
  { min: 4, label: 'MARGINAL', badge: 'gray' },
  { min: 0, label: 'WEAK', badge: 'gray' }
];

// ---- Hard FAIL Triggers ----
export const HARD_FAIL = {
  minPop3mi: 5000,
  minIncome3mi: 55000
};

// ---- Phase Definitions (matches App.js PHASES) ----
export const PHASES = [
  'Prospect',
  'Submitted to PS',
  'Storvex Approved',
  'LOI',
  'PSA Sent',
  'Under Contract',
  'Closed',
  'Declined',
  'Dead'
];

// ---- Phase Bonuses (applied after weighted sum) ----
export const PHASE_BONUSES = {
  'Under Contract': 0.3,
  'Closed': 0.3,
  'PSA Sent': 0.2,
  'LOI': 0.15,
  'Storvex Approved': 0.1
};

// ---- Market Tier Scores ----
export const MARKET_TIER_SCORES = {
  T1: 10,
  T2: 8,
  T3: 6,
  T4: 4
};

// ---- Firebase Paths ----
export const FIREBASE_PATHS = {
  submissions: 'submissions',
  southwest: 'southwest',
  east: 'east',
  siteScoreWeights: 'config/siteiq_weights'
};

// ---- UI Color Palette ----
export const COLORS = {
  primary: '#2563eb',
  success: '#16a34a',
  warning: '#f59e0b',
  danger: '#dc2626',
  info: '#0ea5e9',
  storvexGold: '#C9A84C',
  storvexOrange: '#F37C33',
  storvexNavy: '#1E2761',
  storvexSteel: '#2C3E6B',
  phaseProspect: '#6b7280',
  phaseSubmitted: '#2563eb',
  phaseApproved: '#f59e0b',
  phaseLOI: '#8b5cf6',
  phasePSASent: '#06b6d4',
  phaseUC: '#16a34a',
  phaseClosed: '#059669',
  phaseDeclined: '#dc2626',
  phaseDead: '#6b7280',
  bgLight: '#f8fafc',
  bgCard: '#ffffff',
  textPrimary: '#1e293b',
  textSecondary: '#64748b',
  border: '#e2e8f0'
};

// ---- Stale Listing Penalty ----
export const STALE_DOM_THRESHOLD = 1000; // days on market
export const STALE_PENALTY = -0.5;

// ---- Broker Intel Bonuses ----
export const BROKER_BONUSES = {
  confirmedZoning: 0.2,
  cleanSurvey: 0.1,
  maxTotal: 0.3
};

// ---- Research Completeness Vet Checks ----
export const VET_BONUSES = {
  full: 0.5,      // 100% vet = +0.5
  partial: 0.3,   // >= 70% = +0.3
  low: -0.1,      // > 0% but < 40% = -0.1
  none: -0.3      // 0% = -0.3
};

// ---- Water Hookup Penalties ----
export const WATER_PENALTIES = {
  extensionNeeded: -0.3,   // Provider identified but not connected
  noProvider: -1.0          // No provider identified at all
};

// ---- SiteScore Dimension Metadata ----
export const SITESCORE_DIMENSIONS = [
  { key: 'population', label: 'Population', icon: '👥', group: 'demographics', source: 'ESRI / Census ACS' },
  { key: 'growth', label: 'Growth', icon: '📈', group: 'demographics', source: 'ESRI 2025→2030 projections' },
  { key: 'income', label: 'Med. Income', icon: '💰', group: 'demographics', source: 'ESRI / Census ACS' },
  { key: 'pricing', label: 'Pricing', icon: '💲', group: 'deal', source: 'Asking price / acreage' },
  { key: 'zoning', label: 'Zoning', icon: '📋', group: 'entitlements', source: 'Zoning field + summary' },
  { key: 'access', label: 'Site Access', icon: '🛣️', group: 'physical', source: 'Site data + summary' },
  { key: 'psProximity', label: 'Facility Proximity', icon: '📦', group: 'market', source: 'siteiqData.nearestPS' },
  { key: 'competition', label: 'Competition', icon: '🏢', group: 'market', source: 'Competitor density in trade area' },
  { key: 'marketTier', label: 'Market Tier', icon: '📍', group: 'market', source: 'Market field / config' }
];

// ---- Document Types ----
export const DOC_TYPES = [
  'Flyer', 'Survey', 'Geotech', 'PSA', 'LOI',
  'Appraisal', 'Environmental', 'Title', 'Plat', 'Other'
];

// ---- Regions ----
export const REGIONS = {
  southwest: { label: 'Daniel Wollent', color: '#1565C0', accent: '#42A5F5' },
  east: { label: 'Matthew Toussaint', color: '#2D5F2D', accent: '#4CAF50' }
};

// ---- Priority Levels ----
export const PRIORITIES = ['🔥 Hot', '🟡 Warm', '🔵 Cold', '⚪ None'];
