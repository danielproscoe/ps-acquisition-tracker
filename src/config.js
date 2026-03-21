// src/config.js -- Shared constants for PS Acquisition Tracker
// Addresses audit finding ARCH-05: Extract constants to shared config

// ---- SiteScore v3.0 Scoring Weights (must match SITE_SCORE_DEFAULTS in App.js) ----
  export const SITEIQ_WEIGHTS = {
        population: 0.16,
        growth: 0.21,
        income: 0.10,
        households: 0.05,
        homeValue: 0.05,
        zoning: 0.16,
        psProximity: 0.11,
        access: 0.07,
        competition: 0.07,
        marketTier: 0.02
  };

// ---- SiteScore Classification Thresholds ----
export const SITEIQ_THRESHOLDS = {
  GREEN: 8.0,    // auto-advance to Firebase
  YELLOW: 6.0,   // present for Dan's review
  ORANGE: 4.0,   // flagged
  RED: 0         // auto-pass (below 4.0)
};

// ---- SiteScore Tier Labels ----
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
  maxPsDistance: 35
};

// ---- Phase Definitions (must match App.js) ----
export const PHASES = ['Prospect', 'Submitted to PS', 'SiteScore Approved', 'LOI', 'PSA Sent', 'Under Contract', 'Closed', 'Declined', 'Dead'];

// ---- Phase Bonuses (applied after weighted sum, must match App.js) ----
export const PHASE_BONUSES = {
  'Under Contract': 0.3,
  'Closed': 0.3,
  'PSA Sent': 0.2,
  'LOI': 0.15,
  'SiteScore Approved': 0.1
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
