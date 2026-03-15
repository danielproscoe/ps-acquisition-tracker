// src/config.js -- Shared constants for PS Acquisition Tracker
// Addresses audit finding ARCH-05: Extract constants to shared config

// ---- SiteIQ Scoring Weights (must match computeSiteIQ in App.js) ----
export const SITEIQ_WEIGHTS = {
  population: 0.25,
  psProximity: 0.20,
  income: 0.15,
  zoning: 0.15,
  marketTier: 0.10,
  siteAccess: 0.10,
  competition: 0.05
};

// ---- SiteIQ Classification Thresholds ----
export const SITEIQ_THRESHOLDS = {
  GREEN: 7.5,    // auto-advance to Firebase
  YELLOW: 5.5,   // present for Dan's review
  ORANGE: 3.0,   // flagged
  RED: 0         // auto-pass (below 3.0)
};

// ---- SiteIQ Tier Labels ----
export const SITEIQ_TIERS = [
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
  minIncome3mi: 55000,
  minPsDistance: 2.5
};

// ---- Phase Definitions ----
export const PHASES = ['Prospect', 'LOI Sent', 'LOI Signed', 'Under Contract'];

// ---- Phase Bonuses (applied after weighted sum) ----
export const PHASE_BONUSES = {
  'Under Contract': 0.3,
  'DD': 0.3,
  'Closed': 0.3,
  'LOI Signed': 0.2,
  'LOI Sent': 0.1
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
  east: 'east'
};

// ---- UI Color Palette ----
export const COLORS = {
  primary: '#2563eb',
  success: '#16a34a',
  warning: '#f59e0b',
  danger: '#dc2626',
  info: '#0ea5e9',
  phaseProspect: '#6b7280',
  phaseLOISent: '#2563eb',
  phaseLOISigned: '#f59e0b',
  phaseUC: '#16a34a',
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
  confirmedZoning: 0.3,
  cleanSurvey: 0.2
};
