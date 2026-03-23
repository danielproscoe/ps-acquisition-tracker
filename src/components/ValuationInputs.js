// ─── ValuationInputs — McKinsey-Level Financial Model Console ───
// Storvex auto-populates intelligent defaults. PS corporate can toggle any lever.
// "Revert to Storvex Inputs" snaps back to engine defaults.
// Voltage animation on recalculation = the engine is alive.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { STYLES } from '../utils';
import { computeSiteFinancials } from '../scoring';

// ─── Storvex Engine Defaults (source of truth) ───
// These match scoring.js computeSiteFinancials() hardcoded values exactly.
export const STORVEX_DEFAULTS = {
  // ── Facility Sizing ──
  coverageRatio: 0.35,          // 35% lot coverage (PS Killeen sketch)
  netToGross: 0.90,             // 90% efficiency
  climatePctOneStory: 0.65,     // One-story: 65% climate
  climatePctMultiStory: 0.75,   // Multi-story: 75% climate
  multiStoryThreshold: 3.5,     // Below 3.5ac → multi-story
  multiStoryFloors: 3,          // Default 3 stories

  // ── Market Rates ($/SF/mo) ──
  climateRatePremium: 1.45,
  climateRateUpper: 1.25,
  climateRateMid: 1.10,
  climateRateValue: 0.95,
  driveRatePremium: 0.85,
  driveRateUpper: 0.72,
  driveRateMid: 0.62,
  driveRateValue: 0.52,
  annualEscalation: 0.03,       // 3% annual rent escalation

  // ── Lease-Up Schedule ──
  leaseUpY1Occ: 0.30,
  leaseUpY2Occ: 0.55,
  leaseUpY3Occ: 0.75,
  leaseUpY4Occ: 0.88,
  leaseUpY5Occ: 0.92,
  leaseUpY1ClimDisc: 0.35,
  leaseUpY2ClimDisc: 0.15,
  leaseUpY3ClimDisc: 0.05,
  leaseUpY1DriveDisc: 0.30,
  leaseUpY2DriveDisc: 0.12,
  leaseUpY3DriveDisc: 0.05,

  // ── ECRI Schedule (cumulative premium above street rate) ──
  ecriY1: 0.00,
  ecriY2: 0.06,
  ecriY3: 0.14,
  ecriY4: 0.24,
  ecriY5: 0.32,

  // ── Construction Costs (Recalibrated 2026-03-22 per PS Killeen closing) ──
  hardCostOneStoryClimate: 45,  // $/SF — building shell + HVAC only
  hardCostOneStoryDrive: 28,    // $/SF — drive-up shell only
  hardCostMultiStory3: 68,      // $/SF 3-story
  hardCostMultiStory4: 78,      // $/SF 4-story
  siteWorkPerSFOneStory: 8,     // $/SF of total site area — grading, paving, stormwater, landscaping
  siteWorkPerSFMulti: 10,       // $/SF multi-story (tighter sites)
  fireSuppressionPerSF: 5.50,   // $/SF gross — full sprinkler, alarm, standpipe (NFPA 13/72)
  interiorBuildoutPerSF: 15,    // $/SF net — unit partitions, roll-up doors, locks, office
  technologyPerSF: 3.50,        // $/SF gross — access control, cameras, smart-entry, IT
  utilityInfraBase: 75000,      // Flat base — tap fees, hookup regardless of size
  utilityInfraPerSF: 2.00,      // $/SF gross — capacity sizing (fire line, electric, sewer)
  softCostPct: 0.20,            // 20% of TOTAL hard costs (all 6 categories)
  contingencyPct: 0.075,        // 7.5% of TOTAL hard costs

  // ── Construction Carry ──
  constructionMonthsOneStory: 14,
  constructionMonthsMultiStory: 18,
  constLoanLTC: 0.60,
  constLoanRate: 0.075,
  avgDrawPct: 0.55,
  workingCapitalPct: 0.02,

  // ── PS Operator Profile ──
  propTaxRate: 0.010,
  insurancePerSF: 0.30,
  mgmtFeePct: 0.035,
  basePayroll: 55000,
  payrollBurden: 1.25,
  baseFTE: 1.0,
  climateUtilPerSF: 0.85,
  driveUtilPerSF: 0.20,
  rmPerSF: 0.25,
  marketingPct: 0.02,
  marketingLeaseUpPct: 0.04,
  gaPct: 0.010,
  badDebtPct: 0.015,
  reservePerSF: 0.15,

  // ── Cap Rates & Valuations ──
  capRateConservative: 0.065,
  capRateMarket: 0.0575,
  capRateAggressive: 0.05,

  // ── Land Pricing YOC Targets (REIT-tight, recalibrated 2026-03-22) ──
  yocMax: 0.075,                // Walk Away — PS minimum for strategic sites
  yocStrike: 0.09,              // Strike Price — standard REC approval zone
  yocMin: 0.105,                // Home Run — exceptional deal territory

  // ── Capital Stack ──
  loanLTV: 0.65,
  loanRate: 0.0675,
  loanAmort: 25,

  // ── DCF ──
  exitCapRate: 0.06,
  holdPeriod: 10,

  // ── Sensitivity Ranges ──
  sensitivityRentDelta: 0.10,   // ±10%
  sensitivityOccDelta: 0.05,    // ±5 pts
};

// ─── Input Section Definitions ───
const SECTIONS = [
  {
    id: 'facility',
    label: 'Facility Program',
    icon: '🏗️',
    description: 'Site yield, unit mix, and building configuration',
    inputs: [
      { key: 'coverageRatio', label: 'Lot Coverage Ratio', type: 'pct', step: 0.01, min: 0.15, max: 0.60, tip: 'Building footprint as % of total lot area. PS standard: 35%' },
      { key: 'netToGross', label: 'Net-to-Gross Efficiency', type: 'pct', step: 0.01, min: 0.75, max: 0.95, tip: 'Leasable SF / Gross SF. Corridors, office, mechanical reduce this.' },
      { key: 'climatePctOneStory', label: 'Climate Mix (1-Story)', type: 'pct', step: 0.01, min: 0.40, max: 0.90, tip: 'Climate-controlled unit share of one-story product. PS Killeen: 65%' },
      { key: 'climatePctMultiStory', label: 'Climate Mix (Multi-Story)', type: 'pct', step: 0.01, min: 0.50, max: 1.00, tip: 'Climate-controlled share of multi-story. Vertical = all indoor: 75%' },
      { key: 'multiStoryThreshold', label: 'Multi-Story Threshold (ac)', type: 'num', step: 0.1, min: 2.0, max: 5.0, unit: 'ac', tip: 'Sites below this acreage trigger multi-story product' },
      { key: 'multiStoryFloors', label: 'Multi-Story Floor Count', type: 'int', step: 1, min: 2, max: 5, unit: 'floors', tip: 'Number of stories for multi-story buildings' },
    ]
  },
  {
    id: 'rates',
    label: 'Revenue — Market Rates',
    icon: '💰',
    description: 'Street rates by income tier — the top line',
    inputs: [
      { key: 'climateRatePremium', label: 'Climate — Premium ($90K+ HHI)', type: 'rate', step: 0.01, min: 0.50, max: 3.00, unit: '$/SF/mo' },
      { key: 'climateRateUpper', label: 'Climate — Upper ($75K+ HHI)', type: 'rate', step: 0.01, min: 0.50, max: 2.50, unit: '$/SF/mo' },
      { key: 'climateRateMid', label: 'Climate — Mid ($60K+ HHI)', type: 'rate', step: 0.01, min: 0.40, max: 2.00, unit: '$/SF/mo' },
      { key: 'climateRateValue', label: 'Climate — Value (<$60K HHI)', type: 'rate', step: 0.01, min: 0.30, max: 1.50, unit: '$/SF/mo' },
      { key: 'driveRatePremium', label: 'Drive-Up — Premium', type: 'rate', step: 0.01, min: 0.30, max: 2.00, unit: '$/SF/mo' },
      { key: 'driveRateUpper', label: 'Drive-Up — Upper', type: 'rate', step: 0.01, min: 0.25, max: 1.50, unit: '$/SF/mo' },
      { key: 'driveRateMid', label: 'Drive-Up — Mid', type: 'rate', step: 0.01, min: 0.20, max: 1.20, unit: '$/SF/mo' },
      { key: 'driveRateValue', label: 'Drive-Up — Value', type: 'rate', step: 0.01, min: 0.15, max: 1.00, unit: '$/SF/mo' },
      { key: 'annualEscalation', label: 'Annual Rent Escalation', type: 'pct', step: 0.005, min: 0.00, max: 0.08, tip: 'Year-over-year street rate growth' },
    ]
  },
  {
    id: 'leaseup',
    label: 'Revenue — Lease-Up',
    icon: '📈',
    description: '5-year absorption and promotional discounting schedule',
    inputs: [
      { key: 'leaseUpY1Occ', label: 'Year 1 Occupancy', type: 'pct', step: 0.01, min: 0.10, max: 0.60, tip: 'Grand opening year — heavy promotions' },
      { key: 'leaseUpY2Occ', label: 'Year 2 Occupancy', type: 'pct', step: 0.01, min: 0.30, max: 0.80 },
      { key: 'leaseUpY3Occ', label: 'Year 3 Occupancy', type: 'pct', step: 0.01, min: 0.50, max: 0.90 },
      { key: 'leaseUpY4Occ', label: 'Year 4 Occupancy', type: 'pct', step: 0.01, min: 0.70, max: 0.95 },
      { key: 'leaseUpY5Occ', label: 'Year 5 (Stabilized)', type: 'pct', step: 0.01, min: 0.80, max: 0.97 },
      { key: 'leaseUpY1ClimDisc', label: 'Y1 Climate Discount', type: 'pct', step: 0.01, min: 0.00, max: 0.60, tip: 'Promotional discount off street rate' },
      { key: 'leaseUpY2ClimDisc', label: 'Y2 Climate Discount', type: 'pct', step: 0.01, min: 0.00, max: 0.40 },
      { key: 'leaseUpY3ClimDisc', label: 'Y3 Climate Discount', type: 'pct', step: 0.01, min: 0.00, max: 0.20 },
      { key: 'leaseUpY1DriveDisc', label: 'Y1 Drive-Up Discount', type: 'pct', step: 0.01, min: 0.00, max: 0.50 },
      { key: 'leaseUpY2DriveDisc', label: 'Y2 Drive-Up Discount', type: 'pct', step: 0.01, min: 0.00, max: 0.30 },
      { key: 'leaseUpY3DriveDisc', label: 'Y3 Drive-Up Discount', type: 'pct', step: 0.01, min: 0.00, max: 0.15 },
    ]
  },
  {
    id: 'ecri',
    label: 'Revenue — ECRI',
    icon: '⚡',
    description: 'Existing Customer Rate Increases — in-place rent growth engine',
    inputs: [
      { key: 'ecriY1', label: 'Year 1 ECRI Premium', type: 'pct', step: 0.01, min: 0.00, max: 0.10, tip: 'Cumulative ECRI above street rate' },
      { key: 'ecriY2', label: 'Year 2 ECRI Premium', type: 'pct', step: 0.01, min: 0.00, max: 0.20 },
      { key: 'ecriY3', label: 'Year 3 ECRI Premium', type: 'pct', step: 0.01, min: 0.00, max: 0.30 },
      { key: 'ecriY4', label: 'Year 4 ECRI Premium', type: 'pct', step: 0.01, min: 0.00, max: 0.45 },
      { key: 'ecriY5', label: 'Year 5 ECRI Premium', type: 'pct', step: 0.01, min: 0.00, max: 0.60, tip: 'PS benchmark: 32% cumulative by Y5 (38-42% of mature revenue from ECRI)' },
    ]
  },
  {
    id: 'construction',
    label: 'Development Costs',
    icon: '🔨',
    description: 'Hard costs, site work, and full development budget',
    inputs: [
      { key: 'hardCostOneStoryClimate', label: '1-Story Shell+HVAC ($/SF)', type: 'dollar', step: 1, min: 20, max: 100, unit: '$/SF', tip: 'Building shell & HVAC only. PS benchmark: $45/SF national' },
      { key: 'hardCostOneStoryDrive', label: '1-Story Drive-Up Shell ($/SF)', type: 'dollar', step: 1, min: 10, max: 60, unit: '$/SF' },
      { key: 'hardCostMultiStory3', label: '3-Story Shell ($/SF)', type: 'dollar', step: 1, min: 40, max: 140, unit: '$/SF' },
      { key: 'hardCostMultiStory4', label: '4-Story Shell ($/SF)', type: 'dollar', step: 1, min: 50, max: 160, unit: '$/SF' },
      { key: 'siteWorkPerSFOneStory', label: 'Site Dev 1-Story ($/SF site)', type: 'dollar', step: 0.5, min: 3, max: 20, unit: '$/SF', tip: 'Grading, paving, stormwater, landscaping, fencing — per SF of total site area' },
      { key: 'siteWorkPerSFMulti', label: 'Site Dev Multi-Story ($/SF site)', type: 'dollar', step: 0.5, min: 4, max: 25, unit: '$/SF' },
      { key: 'fireSuppressionPerSF', label: 'Fire Suppression ($/SF)', type: 'rate', step: 0.25, min: 2.00, max: 10.00, unit: '$/SF', tip: 'Full sprinkler (NFPA 13), fire alarm, standpipe, FDC' },
      { key: 'interiorBuildoutPerSF', label: 'Interior Buildout ($/SF net)', type: 'dollar', step: 0.5, min: 5, max: 30, unit: '$/SF', tip: 'Unit partitions, roll-up doors, locks, corridor finish, office' },
      { key: 'technologyPerSF', label: 'Technology & Security ($/SF)', type: 'rate', step: 0.25, min: 1.00, max: 8.00, unit: '$/SF', tip: 'Access control, cameras, smart-entry, IoT, IT infrastructure' },
      { key: 'utilityInfraBase', label: 'Utility Base Cost ($)', type: 'dollar', step: 5000, min: 25000, max: 200000, unit: '$', tip: 'Flat hookup costs: water/sewer taps, electric service, gas' },
      { key: 'utilityInfraPerSF', label: 'Utility Per-SF ($/SF)', type: 'rate', step: 0.25, min: 0.50, max: 5.00, unit: '$/SF', tip: 'Capacity sizing: fire line, transformer, sewer main' },
      { key: 'softCostPct', label: 'Soft Costs (% of All Hard)', type: 'pct', step: 0.01, min: 0.10, max: 0.35, tip: 'A&E, permits, legal, survey, dev fee — applied to TOTAL hard costs' },
      { key: 'contingencyPct', label: 'Contingency (% of All Hard)', type: 'pct', step: 0.005, min: 0.03, max: 0.15, tip: 'Industry standard: 7.5%. Required by PS REC.' },
    ]
  },
  {
    id: 'carry',
    label: 'Development — Carry Costs',
    icon: '🏦',
    description: 'Construction financing, insurance, and pre-revenue carry',
    inputs: [
      { key: 'constructionMonthsOneStory', label: '1-Story Build (months)', type: 'int', step: 1, min: 8, max: 24, unit: 'mo' },
      { key: 'constructionMonthsMultiStory', label: 'Multi-Story Build (months)', type: 'int', step: 1, min: 12, max: 30, unit: 'mo' },
      { key: 'constLoanLTC', label: 'Construction LTC', type: 'pct', step: 0.01, min: 0.40, max: 0.80, tip: 'Loan-to-cost on construction financing' },
      { key: 'constLoanRate', label: 'Construction Loan Rate', type: 'pct', step: 0.0025, min: 0.04, max: 0.12 },
      { key: 'avgDrawPct', label: 'Avg Draw Schedule', type: 'pct', step: 0.01, min: 0.30, max: 0.75, tip: 'Average outstanding balance — S-curve draw' },
      { key: 'workingCapitalPct', label: 'Working Capital Reserve', type: 'pct', step: 0.005, min: 0.00, max: 0.05 },
    ]
  },
  {
    id: 'opex',
    label: 'Operating Expenses',
    icon: '📊',
    description: 'Property-level OpEx — taxes, insurance, payroll, utilities, R&M',
    inputs: [
      { key: 'propTaxRate', label: 'Property Tax Rate', type: 'pct', step: 0.001, min: 0.005, max: 0.030, tip: '% of development cost, 2%/yr reassessment escalation' },
      { key: 'insurancePerSF', label: 'Insurance ($/SF)', type: 'rate', step: 0.01, min: 0.10, max: 1.00, unit: '$/SF/yr' },
      { key: 'mgmtFeePct', label: 'Management Fee (% EGI)', type: 'pct', step: 0.005, min: 0.00, max: 0.10, tip: 'PS: 3.5% (self-managed). Industry: 5-8%' },
      { key: 'basePayroll', label: 'Base Payroll ($/yr)', type: 'dollar', step: 1000, min: 30000, max: 120000, unit: '$/yr' },
      { key: 'payrollBurden', label: 'Payroll Burden Multiple', type: 'num', step: 0.01, min: 1.00, max: 1.60, tip: 'FICA, health, workers comp' },
      { key: 'baseFTE', label: 'On-Site FTE', type: 'num', step: 0.1, min: 0.5, max: 3.0, unit: 'FTE' },
      { key: 'climateUtilPerSF', label: 'Climate Utilities ($/SF)', type: 'rate', step: 0.01, min: 0.30, max: 2.00, unit: '$/SF/yr', tip: 'HVAC-driven. PS: $0.85/SF (centralized monitoring)' },
      { key: 'driveUtilPerSF', label: 'Drive-Up Utilities ($/SF)', type: 'rate', step: 0.01, min: 0.05, max: 0.60, unit: '$/SF/yr' },
      { key: 'rmPerSF', label: 'R&M ($/SF)', type: 'rate', step: 0.01, min: 0.10, max: 0.80, unit: '$/SF/yr' },
      { key: 'marketingPct', label: 'Marketing (% EGI, Stabilized)', type: 'pct', step: 0.005, min: 0.00, max: 0.08 },
      { key: 'marketingLeaseUpPct', label: 'Marketing (% EGI, Lease-Up)', type: 'pct', step: 0.005, min: 0.01, max: 0.10, tip: 'Higher spend during Y1-Y2 to drive initial occupancy' },
      { key: 'gaPct', label: 'G&A (% EGI)', type: 'pct', step: 0.005, min: 0.005, max: 0.04, tip: 'Software, legal, accounting, CC processing' },
      { key: 'badDebtPct', label: 'Bad Debt (% EGI)', type: 'pct', step: 0.005, min: 0.005, max: 0.05, tip: 'Lien auctions, late payments' },
      { key: 'reservePerSF', label: 'Replacement Reserve ($/SF)', type: 'rate', step: 0.01, min: 0.05, max: 0.50, unit: '$/SF/yr' },
    ]
  },
  {
    id: 'valuation',
    label: 'Investor Returns',
    icon: '🎯',
    description: 'Cap rates, exit assumptions, and hold period',
    inputs: [
      { key: 'capRateConservative', label: 'Conservative Cap Rate', type: 'pct', step: 0.0025, min: 0.04, max: 0.10 },
      { key: 'capRateMarket', label: 'Market Cap Rate', type: 'pct', step: 0.0025, min: 0.035, max: 0.09 },
      { key: 'capRateAggressive', label: 'Aggressive Cap Rate', type: 'pct', step: 0.0025, min: 0.03, max: 0.08 },
      { key: 'exitCapRate', label: 'Exit Cap Rate (DCF)', type: 'pct', step: 0.0025, min: 0.035, max: 0.10, tip: 'Year 10 exit disposition cap rate' },
      { key: 'holdPeriod', label: 'Hold Period', type: 'int', step: 1, min: 5, max: 20, unit: 'years' },
    ]
  },
  {
    id: 'land',
    label: 'Land Acquisition',
    icon: '🗺️',
    description: 'Target YOC thresholds that drive max/strike/min land price',
    inputs: [
      { key: 'yocMax', label: 'YOC — Maximum (Ceiling)', type: 'pct', step: 0.005, min: 0.04, max: 0.12, tip: 'Most PS will pay for land. Back-solves to max land price.' },
      { key: 'yocStrike', label: 'YOC — Strike Price (Target)', type: 'pct', step: 0.005, min: 0.05, max: 0.15 },
      { key: 'yocMin', label: 'YOC — Minimum (Floor)', type: 'pct', step: 0.005, min: 0.06, max: 0.20 },
    ]
  },
  {
    id: 'capital',
    label: 'Capital Stack',
    icon: '🏛️',
    description: 'Permanent financing — LTV, rate, and amortization',
    inputs: [
      { key: 'loanLTV', label: 'Loan-to-Value', type: 'pct', step: 0.01, min: 0.40, max: 0.80 },
      { key: 'loanRate', label: 'Permanent Loan Rate', type: 'pct', step: 0.0025, min: 0.03, max: 0.12 },
      { key: 'loanAmort', label: 'Amortization Period', type: 'int', step: 1, min: 15, max: 35, unit: 'years' },
    ]
  },
];

// ─── Format helpers ───
const fmtPct = (v, decimals = 1) => `${(v * 100).toFixed(decimals)}%`;
const fmtDollar = (v) => `$${Number(v).toLocaleString()}`;
const fmtRate = (v) => `$${Number(v).toFixed(2)}`;
const fmtVal = (input, val) => {
  if (input.type === 'pct') return fmtPct(val, val < 0.01 ? 2 : 1);
  if (input.type === 'dollar') return fmtDollar(val);
  if (input.type === 'rate') return fmtRate(val);
  if (input.type === 'int') return String(Math.round(val));
  return String(val);
};
const displayToRaw = (input, display) => {
  if (input.type === 'pct') return parseFloat(display) / 100;
  return parseFloat(display);
};
const rawToDisplay = (input, raw) => {
  if (input.type === 'pct') return (raw * 100).toFixed(raw < 0.01 ? 2 : 1);
  if (input.type === 'rate' || input.type === 'num') return Number(raw).toFixed(2);
  if (input.type === 'int') return String(Math.round(raw));
  return String(raw);
};

// ═══ MAIN COMPONENT ═══
// activeSite: the currently-viewed site object (null = no site selected)
// activeRegion: "southwest" or "east" (Firebase path for the site)
// allSites: array of all pipeline sites (for property dropdown)
export default function ValuationInputs({ overrides, onSave, fbSet, activeSite, activeRegion, allSites }) {
  const [localOverrides, setLocalOverrides] = useState(overrides || {});
  const [siteOverrides, setSiteOverrides] = useState({});
  const [scope, setScope] = useState('global'); // 'global' | 'site'
  const [selectedSite, setSelectedSite] = useState(activeSite || null);
  const [selectedRegion, setSelectedRegion] = useState(activeRegion || null);
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [expandedSections, setExpandedSections] = useState(() => {
    const init = {};
    SECTIONS.forEach(s => { init[s.id] = true; });
    return init;
  });
  const [voltageActive, setVoltageActive] = useState(false);
  const [voltagePhase, setVoltagePhase] = useState(0); // 0=idle, 1=charging, 2=discharge, 3=cascade
  const [changedKeys, setChangedKeys] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [subTab, setSubTab] = useState('summary'); // 'summary' | 'inputs' | 'valuations'
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);
  const voltageTimeoutRef = useRef(null);
  const containerRef = useRef(null);

  // Load site-specific overrides when selectedSite changes
  useEffect(() => {
    if (selectedSite?.overrides) {
      setSiteOverrides(selectedSite.overrides);
      setScope('site');
    } else {
      setSiteOverrides({});
      if (selectedSite) setScope('site');
    }
  }, [selectedSite?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync selectedSite when activeSite prop changes (e.g., navigating from detail view)
  useEffect(() => {
    if (activeSite) {
      setSelectedSite(activeSite);
      setSelectedRegion(activeRegion);
    }
  }, [activeSite?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle property dropdown selection
  const handleSiteSelect = (siteId) => {
    if (!siteId) {
      setSelectedSite(null);
      setSelectedRegion(null);
      setScope('global');
      setSiteOverrides({});
      return;
    }
    const site = (allSites || []).find(s => s.id === siteId);
    if (site) {
      setSelectedSite(site);
      setSelectedRegion(site._region || activeRegion);
      setScope('site');
      setSiteOverrides(site.overrides || {});
    }
  };

  // Active overrides based on scope
  const activeOverrides = scope === 'site' ? siteOverrides : localOverrides;
  const setActiveOverrides = scope === 'site' ? setSiteOverrides : setLocalOverrides;

  // 3-tier merge: site overrides > global overrides > Storvex defaults
  const merged = useMemo(() => {
    if (scope === 'site') {
      return { ...STORVEX_DEFAULTS, ...localOverrides, ...siteOverrides };
    }
    return { ...STORVEX_DEFAULTS, ...localOverrides };
  }, [localOverrides, siteOverrides, scope]);

  // ─── Live Financial Model (recomputes on any input change) ───
  const financials = useMemo(() => {
    if (!selectedSite) return null;
    return computeSiteFinancials(selectedSite, localOverrides, siteOverrides);
  }, [selectedSite, localOverrides, siteOverrides]);

  // Count of active overrides (for the current scope)
  const overrideCount = Object.keys(activeOverrides).length;
  const siteOverrideCount = Object.keys(siteOverrides).length;
  const globalOverrideCount = Object.keys(localOverrides).length;
  const totalInputs = SECTIONS.reduce((s, sec) => s + sec.inputs.length, 0);

  // Search filter
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return SECTIONS;
    const q = searchQuery.toLowerCase();
    return SECTIONS.map(sec => ({
      ...sec,
      inputs: sec.inputs.filter(inp =>
        inp.label.toLowerCase().includes(q) ||
        inp.key.toLowerCase().includes(q) ||
        (inp.tip || '').toLowerCase().includes(q) ||
        sec.label.toLowerCase().includes(q)
      )
    })).filter(sec => sec.inputs.length > 0);
  }, [searchQuery]);

  // ─── Voltage Animation Sequence ───
  const triggerVoltage = useCallback(() => {
    if (voltageTimeoutRef.current) clearTimeout(voltageTimeoutRef.current);
    setVoltageActive(true);
    setVoltagePhase(1); // charging

    voltageTimeoutRef.current = setTimeout(() => {
      setVoltagePhase(2); // discharge
      voltageTimeoutRef.current = setTimeout(() => {
        setVoltagePhase(3); // cascade
        voltageTimeoutRef.current = setTimeout(() => {
          setVoltagePhase(0);
          setVoltageActive(false);
        }, 800);
      }, 400);
    }, 300);
  }, []);

  // ─── Firebase path for current scope ───
  const fbPath = scope === 'site' && selectedSite && selectedRegion
    ? `${selectedRegion}/${selectedSite.id}/overrides`
    : 'config/valuation_overrides';

  // ─── Save handler (scope-aware) ───
  const handleSave = useCallback((key, rawValue) => {
    const base = scope === 'site' ? siteOverrides : localOverrides;
    const newOverrides = { ...base };
    // For site scope: compare against effective value (global override or default)
    const effectiveDefault = scope === 'site'
      ? (localOverrides[key] !== undefined ? localOverrides[key] : STORVEX_DEFAULTS[key])
      : STORVEX_DEFAULTS[key];

    if (Math.abs(rawValue - effectiveDefault) < 0.0001) {
      delete newOverrides[key]; // Same as parent level — remove override
    } else {
      newOverrides[key] = rawValue;
    }

    if (scope === 'site') {
      setSiteOverrides(newOverrides);
    } else {
      setLocalOverrides(newOverrides);
    }
    setChangedKeys(prev => new Set(prev).add(key));

    // Persist to Firebase at the correct path
    if (fbSet) {
      fbSet(fbPath, Object.keys(newOverrides).length > 0 ? newOverrides : null);
    }
    if (scope === 'global' && onSave) onSave(newOverrides);

    triggerVoltage();
    setTimeout(() => {
      setChangedKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
    }, 3000);
  }, [scope, localOverrides, siteOverrides, fbSet, fbPath, onSave, triggerVoltage]);

  // ─── Revert All (scope-aware) ───
  const handleRevertAll = useCallback(() => {
    if (scope === 'site') {
      setSiteOverrides({});
    } else {
      setLocalOverrides({});
    }
    if (fbSet) fbSet(fbPath, null);
    if (scope === 'global' && onSave) onSave({});
    triggerVoltage();
    setChangedKeys(new Set(Object.keys(STORVEX_DEFAULTS)));
    setTimeout(() => setChangedKeys(new Set()), 3000);
  }, [scope, fbSet, fbPath, onSave, triggerVoltage]);

  // ─── Revert single input (scope-aware) ───
  const handleRevertOne = useCallback((key) => {
    const base = scope === 'site' ? siteOverrides : localOverrides;
    const newOverrides = { ...base };
    delete newOverrides[key];
    if (scope === 'site') {
      setSiteOverrides(newOverrides);
    } else {
      setLocalOverrides(newOverrides);
    }
    if (fbSet) fbSet(fbPath, Object.keys(newOverrides).length > 0 ? newOverrides : null);
    if (scope === 'global' && onSave) onSave(newOverrides);
    triggerVoltage();
    setChangedKeys(prev => new Set(prev).add(key));
    setTimeout(() => {
      setChangedKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
    }, 3000);
  }, [scope, localOverrides, siteOverrides, fbSet, fbPath, onSave, triggerVoltage]);

  // ─── Keyboard handling for inline edit ───
  const handleKeyDown = useCallback((e, input) => {
    if (e.key === 'Enter') {
      e.target.blur();
    } else if (e.key === 'Escape') {
      setEditingKey(null);
      setEditValue('');
    }
  }, []);

  const handleBlur = useCallback((input) => {
    if (editingKey !== input.key) return;
    const raw = displayToRaw(input, editValue);
    if (!isNaN(raw) && raw >= input.min && raw <= input.max) {
      handleSave(input.key, raw);
    }
    setEditingKey(null);
    setEditValue('');
  }, [editingKey, editValue, handleSave]);

  // Sync with external overrides
  useEffect(() => {
    if (overrides && JSON.stringify(overrides) !== JSON.stringify(localOverrides)) {
      setLocalOverrides(overrides || {});
    }
  }, [overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  // ═══ STYLES ═══
  const S = {
    page: { animation: 'fadeIn 0.4s ease-out', maxWidth: 1200, margin: '0 auto', position: 'relative' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, flexWrap: 'wrap', gap: 16 },
    title: { fontSize: 28, fontWeight: 800, color: '#E2E8F0', letterSpacing: '-0.02em', fontFamily: "'Inter', sans-serif", lineHeight: 1.2 },
    subtitle: { fontSize: 12, color: '#6B7394', fontWeight: 500, marginTop: 6, letterSpacing: '0.03em' },
    badge: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: 'rgba(201,168,76,0.12)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.2)' },
    revertBtn: { ...STYLES.btnPrimary, padding: '10px 24px', fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: 8, background: overrideCount > 0 ? 'linear-gradient(135deg, #E87A2E 0%, #C9A84C 50%, #1E2761 100%)' : 'rgba(107,115,148,0.15)', color: overrideCount > 0 ? '#fff' : '#6B7394', cursor: overrideCount > 0 ? 'pointer' : 'default', boxShadow: overrideCount > 0 ? '0 4px 16px rgba(232,122,46,0.35)' : 'none' },
    search: { width: '100%', maxWidth: 400, padding: '10px 16px 10px 40px', borderRadius: 12, border: '1px solid rgba(201,168,76,0.12)', background: 'rgba(15,21,56,0.5)', color: '#E2E8F0', fontSize: 13, fontFamily: "'Inter', sans-serif", outline: 'none', transition: 'all 0.2s', boxSizing: 'border-box' },
    sectionCard: (isExpanded) => ({ ...STYLES.cardBase, marginBottom: 12, overflow: 'hidden', borderLeft: `3px solid ${isExpanded ? '#E87A2E' : 'rgba(201,168,76,0.12)'}`, transition: 'all 0.25s cubic-bezier(0.22,1,0.36,1)', boxShadow: isExpanded ? '0 8px 32px rgba(232,122,46,0.08), 0 0 0 1px rgba(232,122,46,0.1)' : '0 4px 20px rgba(0,0,0,0.25), 0 0 0 1px rgba(201,168,76,0.08)' }),
    sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', cursor: 'pointer', userSelect: 'none', transition: 'background 0.1s', borderRadius: 16 },
    sectionTitle: { display: 'flex', alignItems: 'center', gap: 10 },
    sectionLabel: { fontSize: 15, fontWeight: 700, color: '#E2E8F0', letterSpacing: '-0.01em' },
    sectionDesc: { fontSize: 11, color: '#6B7394', fontWeight: 500, marginTop: 2 },
    sectionBody: { padding: '0 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 },
    inputCard: (isOverridden, isChanged) => ({
      padding: '12px 16px',
      borderRadius: 12,
      background: isChanged ? 'rgba(57,255,20,0.06)' : isOverridden ? 'rgba(232,122,46,0.06)' : 'rgba(15,21,56,0.4)',
      border: `1px solid ${isChanged ? 'rgba(57,255,20,0.25)' : isOverridden ? 'rgba(232,122,46,0.2)' : 'rgba(201,168,76,0.06)'}`,
      transition: 'all 0.3s cubic-bezier(0.22,1,0.36,1)',
      position: 'relative',
    }),
    inputLabel: { fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    inputValue: (isOverridden) => ({
      fontSize: 24, fontWeight: 800, fontFamily: "'Space Mono', monospace",
      color: isOverridden ? '#E87A2E' : '#E2E8F0',
      cursor: 'text', transition: 'all 0.15s',
      letterSpacing: '-0.02em',
      padding: '2px 6px', borderRadius: 6,
      border: '1px solid transparent',
    }),
    inputDefault: { fontSize: 10, color: '#6B7394', marginTop: 4, fontWeight: 500 },
    sliderTrack: { width: '100%', height: 8, borderRadius: 4, background: 'rgba(107,115,148,0.15)', marginTop: 10, position: 'relative', cursor: 'pointer' },
    sliderFill: (pct, isOverridden) => ({
      position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 4,
      width: `${Math.max(0, Math.min(100, pct))}%`,
      background: isOverridden ? 'linear-gradient(90deg, #E87A2E, #C9A84C)' : 'linear-gradient(90deg, #2C3E6B, #42A5F5)',
      transition: 'width 0.2s cubic-bezier(0.22,1,0.36,1)',
    }),
    sliderThumb: (pct) => ({
      position: 'absolute', top: -6, left: `calc(${Math.max(0, Math.min(100, pct))}% - 10px)`,
      width: 20, height: 20, borderRadius: '50%',
      background: 'linear-gradient(135deg, #F4F6FA, #E2E8F0)', border: '3px solid #E87A2E',
      boxShadow: '0 2px 12px rgba(232,122,46,0.4), 0 1px 4px rgba(0,0,0,0.3)',
      transition: 'left 0.2s cubic-bezier(0.22,1,0.36,1)',
      cursor: 'grab',
    }),
    revertOneBtn: { padding: '2px 6px', borderRadius: 4, border: 'none', background: 'rgba(232,122,46,0.15)', color: '#E87A2E', fontSize: 9, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' },
    overrideDot: { width: 6, height: 6, borderRadius: '50%', background: '#E87A2E', display: 'inline-block', marginRight: 4, animation: 'pulseOnce 2s ease-out' },
    // Voltage overlay
    voltageOverlay: {
      position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none',
      opacity: voltageActive ? 1 : 0, transition: 'opacity 0.2s',
    },
    statusBar: { display: 'flex', gap: 12, alignItems: 'center', padding: '12px 20px', borderRadius: 12, background: 'rgba(15,21,56,0.7)', border: '1px solid rgba(201,168,76,0.1)', marginBottom: 20, flexWrap: 'wrap' },
    statusItem: (color) => ({ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color }),
  };

  // ─── Render a single input control ───
  const renderInput = (input) => {
    const val = merged[input.key];
    const isOverridden = input.key in activeOverrides;
    const isSiteLevel = scope === 'site' && input.key in siteOverrides;
    const isGlobalLevel = input.key in localOverrides && !(input.key in siteOverrides);
    const isChanged = changedKeys.has(input.key);
    const isEditing = editingKey === input.key;
    const pct = ((val - input.min) / (input.max - input.min)) * 100;
    const defaultVal = STORVEX_DEFAULTS[input.key];

    return (
      <div key={input.key} style={S.inputCard(isOverridden, isChanged)}
        onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)'; e.currentTarget.style.borderColor = isOverridden ? 'rgba(232,122,46,0.4)' : 'rgba(201,168,76,0.2)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = ''; }}>

        {/* Label row */}
        <div style={S.inputLabel}>
          <span>
            {isOverridden && <span style={S.overrideDot} />}
            {input.label}
          </span>
          {isOverridden && (
            <button style={S.revertOneBtn} onClick={(e) => { e.stopPropagation(); handleRevertOne(input.key); }}
              title="Revert to Storvex default">
              REVERT
            </button>
          )}
        </div>

        {/* Value — click to type, or use slider */}
        {isEditing ? (
          <input
            autoFocus
            type="number"
            step={input.type === 'pct' ? (input.step * 100) : input.step}
            min={input.type === 'pct' ? input.min * 100 : input.min}
            max={input.type === 'pct' ? input.max * 100 : input.max}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, input)}
            onBlur={() => handleBlur(input)}
            style={{ ...S.inputValue(isOverridden), width: '100%', background: 'rgba(232,122,46,0.08)', border: '2px solid #E87A2E', borderRadius: 8, padding: '6px 10px', outline: 'none', fontSize: 22, boxShadow: '0 0 20px rgba(232,122,46,0.15)' }}
          />
        ) : (
          <div style={S.inputValue(isOverridden)}
            onClick={() => { setEditingKey(input.key); setEditValue(rawToDisplay(input, val)); }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(232,122,46,0.3)'; e.currentTarget.style.background = 'rgba(232,122,46,0.04)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
            title={input.tip || 'Click to type a value directly'}>
            {fmtVal(input, val)}
            {input.unit && <span style={{ fontSize: 11, color: '#6B7394', fontWeight: 500, marginLeft: 4 }}>{input.unit}</span>}
          </div>
        )}

        {/* Native range slider — draggable, accessible, smooth */}
        <input
          type="range"
          min={input.min}
          max={input.max}
          step={input.step}
          value={val}
          onChange={(e) => handleSave(input.key, parseFloat(e.target.value))}
          className="storvex-slider"
          style={{ width: '100%', marginTop: 8, cursor: 'pointer', accentColor: isOverridden ? '#E87A2E' : '#42A5F5' }}
        />

        {/* Override delta — only when changed from default */}
        {isOverridden && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <span style={{ fontSize: 10, color: '#E87A2E', fontWeight: 700 }}>
              {val > defaultVal ? '\u25B2' : '\u25BC'} {fmtVal(input, Math.abs(val - defaultVal))} {val > defaultVal ? 'above' : 'below'} default
            </span>
          </div>
        )}
      </div>
    );
  };

  // ─── Helpers for Valuation tab ───
  const fmtK = (v) => {
    if (v == null || isNaN(v)) return '$0';
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`;
    if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(0)}K`;
    return `${sign}$${abs.toLocaleString()}`;
  };
  // ─── Sub-Tab Definitions ───
  const SUB_TABS = [
    { id: 'summary', label: 'Executive Summary', icon: '\u2605' },
    { id: 'inputs', label: 'Pricing Inputs', icon: '\u2699' },
    { id: 'valuations', label: 'Valuations', icon: '\u25B2' },
  ];

  // ─── Shared metric card renderer ───
  const MetricCard = ({ label, value, sub, color, wide }) => (
    <div style={{ padding: '16px 18px', borderRadius: 12, background: 'rgba(15,21,56,0.5)', border: '1px solid rgba(201,168,76,0.08)', flex: wide ? '1 1 100%' : '1 1 200px', minWidth: wide ? 'auto' : 200 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7394', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, fontFamily: "'Space Mono', monospace", color: color || '#E2E8F0', letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4, fontWeight: 500 }}>{sub}</div>}
    </div>
  );

  // ─── Render: Executive Summary Tab ───
  const renderSummary = () => {
    if (!financials) return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6B7394' }}>
        <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.5 }}>{'\u2605'}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#94A3B8' }}>Select a property to view the executive summary</div>
      </div>
    );
    const f = financials;
    const noiMargin = f.stabRev > 0 ? ((f.stabNOI / f.stabRev) * 100).toFixed(1) : 'N/A';
    const verdictBg = f.landVerdict === 'STRONG BUY' ? 'rgba(22,163,74,0.12)' : f.landVerdict === 'BUY' ? 'rgba(34,197,94,0.12)' : f.landVerdict === 'NEGOTIATE' ? 'rgba(245,158,11,0.12)' : f.landVerdict === 'STRETCH' ? 'rgba(232,122,46,0.12)' : 'rgba(239,68,68,0.12)';
    return (
      <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
        {/* Hero Section */}
        <div style={{ padding: '28px 32px', borderRadius: 16, background: 'linear-gradient(135deg, rgba(15,21,56,0.8), rgba(30,39,97,0.5))', border: '1px solid rgba(201,168,76,0.15)', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #C9A84C, #E87A2E, #C9A84C)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 20 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#6B7394', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>Investment Thesis</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#E2E8F0', letterSpacing: '-0.02em' }}>{selectedSite.name || selectedSite.address || 'Site'}</div>
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{selectedSite.city}{selectedSite.state ? `, ${selectedSite.state}` : ''} {'\u2022'} {f.acres ? `${f.acres} acres` : ''} {'\u2022'} {f.isMultiStory ? `${f.stories}-Story` : '1-Story'} {'\u2022'} {f.totalSF?.toLocaleString()} NSF</div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {f.landVerdict && (
                <div style={{ padding: '8px 20px', borderRadius: 10, background: verdictBg, border: `1px solid ${f.verdictColor}30` }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: f.verdictColor, letterSpacing: '0.04em' }}>{f.landVerdict}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Primary Metrics — 4 across */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <MetricCard label="Stabilized NOI" value={fmtK(f.stabNOI)} sub={`${noiMargin}% NOI margin`} color="#C9A84C" />
          <MetricCard label="Total Dev Cost" value={fmtK(f.totalDevCost)} sub={`${f.totalSF > 0 ? '$' + Math.round(f.totalDevCost / f.totalSF) + '/SF all-in' : ''}`} />
          <MetricCard label="Yield on Cost" value={`${f.yocStab}%`} sub="Stabilized Y5" color={parseFloat(f.yocStab) >= 9.0 ? '#16A34A' : parseFloat(f.yocStab) >= 7.5 ? '#F59E0B' : '#EF4444'} />
          <MetricCard label="Strike Price" value={fmtK(f.landPrices[1]?.maxLand || 0)} sub={`${f.askVsStrike ? (parseFloat(f.askVsStrike) > 0 ? '+' : '') + f.askVsStrike + '% vs asking' : 'No asking price'}`} color="#C9A84C" />
        </div>

        {/* Return Metrics — 4 across */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <MetricCard label="Levered IRR" value={`${f.irrPct}%`} sub={`${f.holdPeriod}-yr hold`} color={parseFloat(f.irrPct) >= 15 ? '#16A34A' : parseFloat(f.irrPct) >= 10 ? '#F59E0B' : '#EF4444'} />
          <MetricCard label="Unlevered IRR" value={`${f.unleveredIRR}%`} sub="Asset-level return" />
          <MetricCard label="DSCR" value={f.dscrStab} sub="Debt coverage" color={parseFloat(f.dscrStab) >= 1.25 ? '#16A34A' : parseFloat(f.dscrStab) >= 1.0 ? '#F59E0B' : '#EF4444'} />
          <MetricCard label="Cash-on-Cash" value={`${f.cashOnCash}%`} sub="Equity yield" />
        </div>

        {/* Facility & Capital Summary side-by-side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* Facility Program */}
          <div style={{ padding: '20px 24px', borderRadius: 14, background: 'rgba(15,21,56,0.4)', border: '1px solid rgba(201,168,76,0.08)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#C9A84C', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14, borderBottom: '1px solid rgba(201,168,76,0.1)', paddingBottom: 8 }}>Facility Program</div>
            {[
              ['Product Type', f.isMultiStory ? `${f.stories}-Story Indoor` : '1-Story Suburban'],
              ['Gross SF', f.grossSF?.toLocaleString() + ' SF'],
              ['Net Rentable SF', f.totalSF?.toLocaleString() + ' SF'],
              ['Climate / Drive-Up', `${Math.round(f.climatePct * 100)}% / ${Math.round(f.drivePct * 100)}%`],
              ['Climate SF', f.climateSF?.toLocaleString() + ' SF'],
              ['Drive-Up SF', f.driveSF?.toLocaleString() + ' SF'],
              ['Lot Coverage', `${Math.round((merged.coverageRatio || 0.35) * 100)}%`],
            ].map(([label, val], i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < 6 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0', fontFamily: "'Space Mono', monospace" }}>{val}</span>
              </div>
            ))}
          </div>

          {/* Capital Stack */}
          <div style={{ padding: '20px 24px', borderRadius: 14, background: 'rgba(15,21,56,0.4)', border: '1px solid rgba(201,168,76,0.08)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#C9A84C', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14, borderBottom: '1px solid rgba(201,168,76,0.1)', paddingBottom: 8 }}>Capital Stack</div>
            {[
              ['Senior Debt', fmtK(f.loanAmount), `${Math.round(f.loanLTV * 100)}% LTV`],
              ['Sponsor Equity', fmtK(f.equityRequired), `${Math.round(f.equityPct * 100)}%`],
              ['Loan Rate', `${(f.loanRate * 100).toFixed(2)}%`, `${f.loanAmort}yr amort`],
              ['Annual Debt Service', fmtK(f.annualDS), ''],
              ['Cash After DS', fmtK(f.cashAfterDS), f.cashAfterDS < 0 ? 'NEGATIVE' : ''],
              ['Equity Multiple', `${f.equityMultiple}x`, `${f.holdPeriod}-yr hold`],
              ['Profit on Cost', `${f.profitOnCost}%`, ''],
            ].map(([label, val, note], i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: i < 6 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>{label}</span>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0', fontFamily: "'Space Mono', monospace" }}>{val}</span>
                  {note && <span style={{ fontSize: 10, color: '#6B7394', marginLeft: 6 }}>{note}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Land Pricing Guide */}
        <div style={{ padding: '20px 24px', borderRadius: 14, background: 'rgba(15,21,56,0.4)', border: '1px solid rgba(201,168,76,0.08)', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#C9A84C', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14, borderBottom: '1px solid rgba(201,168,76,0.1)', paddingBottom: 8 }}>Land Acquisition Price Guide</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {(f.landPrices || []).map((lp, i) => (
              <div key={i} style={{ padding: '14px 16px', borderRadius: 10, background: `${lp.color}10`, border: `1px solid ${lp.color}25`, textAlign: 'center' }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: lp.color, letterSpacing: '0.1em', marginBottom: 4 }}>{lp.tag} {'\u2022'} {(lp.yoc * 100).toFixed(1)}% YOC</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: lp.color, fontFamily: "'Space Mono', monospace" }}>{fmtK(lp.maxLand)}</div>
                <div style={{ fontSize: 10, color: '#6B7394', marginTop: 4 }}>{lp.perAcre > 0 ? `$${lp.perAcre.toLocaleString()}/ac` : ''} {'\u2022'} {lp.label}</div>
              </div>
            ))}
          </div>
          {f.landCost > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 14, padding: '10px 20px', borderRadius: 8, background: verdictBg, border: `1px solid ${f.verdictColor}20` }}>
              <span style={{ fontSize: 12, color: '#94A3B8' }}>Asking: <strong style={{ color: '#E2E8F0' }}>{fmtK(f.landCost)}</strong></span>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#6B7394' }} />
              <span style={{ fontSize: 12, color: '#94A3B8' }}>vs Strike: <strong style={{ color: f.verdictColor }}>{f.askVsStrike ? (parseFloat(f.askVsStrike) > 0 ? '+' : '') + f.askVsStrike + '%' : 'N/A'}</strong></span>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#6B7394' }} />
              <span style={{ fontSize: 13, fontWeight: 900, color: f.verdictColor }}>{f.landVerdict}</span>
            </div>
          )}
        </div>

        {/* NPV & Board Metrics */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <MetricCard label="NPV at WACC (9.26%)" value={fmtK(f.npvAtWACC)} sub={f.npvAtWACC >= 0 ? 'Creates shareholder value' : 'Destroys value at WACC'} color={f.npvAtWACC >= 0 ? '#16A34A' : '#EF4444'} />
          <MetricCard label="Debt Yield" value={`${f.debtYield}%`} sub="Lender risk metric" />
          <MetricCard label="Dev Spread" value={`${f.devSpread} bps`} sub="YOC minus market cap" color={parseFloat(f.devSpread) > 0 ? '#16A34A' : '#EF4444'} />
          <MetricCard label="Build vs Buy" value={f.buildOrBuy ? f.buildOrBuy.split(' \u2014 ')[0] : 'N/A'} sub={f.replacementVsMarket ? `${f.replacementVsMarket}% vs stabilized value` : ''} />
        </div>
      </div>
    );
  };

  // ─── Render: Valuations Tab ───
  const renderValuations = () => {
    if (!financials) return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6B7394' }}>
        <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.5 }}>{'\u25B2'}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#94A3B8' }}>Select a property to view valuations</div>
      </div>
    );
    const f = financials;
    const sectionStyle = { padding: '20px 24px', borderRadius: 14, background: 'rgba(15,21,56,0.4)', border: '1px solid rgba(201,168,76,0.08)', marginBottom: 16 };
    const sectionHeader = (text) => <div style={{ fontSize: 11, fontWeight: 800, color: '#C9A84C', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14, borderBottom: '1px solid rgba(201,168,76,0.1)', paddingBottom: 8 }}>{text}</div>;
    const row = (label, val, bold, color) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
        <span style={{ fontSize: 12, color: bold ? '#E2E8F0' : '#94A3B8', fontWeight: bold ? 700 : 400 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: color || (bold ? '#C9A84C' : '#E2E8F0'), fontFamily: "'Space Mono', monospace" }}>{val}</span>
      </div>
    );
    return (
      <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
        {/* Cap Rate Valuations */}
        <div style={sectionStyle}>
          {sectionHeader('Stabilized Value (Cap Rate Approach)')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
            {(f.valuations || []).map((v, i) => (
              <div key={i} style={{ padding: '16px', borderRadius: 10, background: i === 1 ? 'rgba(201,168,76,0.08)' : 'rgba(15,21,56,0.5)', border: `1px solid ${i === 1 ? 'rgba(201,168,76,0.2)' : 'rgba(201,168,76,0.06)'}`, textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7394', letterSpacing: '0.06em', marginBottom: 6 }}>{v.label}</div>
                <div style={{ fontSize: 26, fontWeight: 900, fontFamily: "'Space Mono', monospace", color: i === 1 ? '#C9A84C' : '#E2E8F0' }}>{fmtK(v.value)}</div>
                <div style={{ fontSize: 10, color: '#6B7394', marginTop: 4 }}>{f.totalSF > 0 ? `$${Math.round(v.value / f.totalSF)}/SF` : ''}</div>
              </div>
            ))}
          </div>
          {row('Stabilized NOI (Y5)', fmtK(f.stabNOI), true, '#C9A84C')}
          {row('Stabilized Revenue', fmtK(f.stabRev))}
          {row('NOI Margin', `${f.noiMarginPct}%`, false, parseFloat(f.noiMarginPct) >= 70 ? '#16A34A' : '#F59E0B')}
        </div>

        {/* 5-Year Lease-Up P&L */}
        <div style={sectionStyle}>
          {sectionHeader('5-Year Lease-Up Pro Forma')}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid rgba(201,168,76,0.15)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6B7394', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>YEAR</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6B7394', fontSize: 10, fontWeight: 700 }}>OCC</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6B7394', fontSize: 10, fontWeight: 700 }}>REVENUE</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6B7394', fontSize: 10, fontWeight: 700 }}>OPEX</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6B7394', fontSize: 10, fontWeight: 700 }}>NOI</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6B7394', fontSize: 10, fontWeight: 700 }}>MARGIN</th>
                </tr>
              </thead>
              <tbody>
                {(f.yearData || []).map((y, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: i === 4 ? 'rgba(201,168,76,0.04)' : 'transparent' }}>
                    <td style={{ padding: '8px 12px', color: '#E2E8F0', fontWeight: i === 4 ? 700 : 400 }}>Y{y.yr}{i === 4 ? ' (Stab)' : ''}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#E2E8F0', fontFamily: "'Space Mono', monospace" }}>{Math.round(y.occRate * 100)}%</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#E2E8F0', fontFamily: "'Space Mono', monospace" }}>{fmtK(y.totalRev)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#E87A2E', fontFamily: "'Space Mono', monospace" }}>({fmtK(y.opex)})</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: i === 4 ? '#C9A84C' : '#16A34A', fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>{fmtK(y.noi)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#94A3B8', fontFamily: "'Space Mono', monospace" }}>{y.totalRev > 0 ? `${((y.noi / y.totalRev) * 100).toFixed(0)}%` : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* OpEx Breakdown */}
        <div style={sectionStyle}>
          {sectionHeader('Operating Expense Breakdown (Stabilized Y5)')}
          {(f.opexDetail || []).map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < f.opexDetail.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
              <div>
                <span style={{ fontSize: 12, color: '#E2E8F0' }}>{item.item}</span>
                <span style={{ fontSize: 9, color: '#6B7394', marginLeft: 8, fontStyle: 'italic' }}>{item.type}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#E87A2E', fontFamily: "'Space Mono', monospace" }}>{fmtK(item.amount)}</span>
            </div>
          ))}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '2px solid rgba(201,168,76,0.15)' }}>
            {row('Total OpEx', fmtK(f.totalOpexDetail), true, '#E87A2E')}
            {row('OpEx Ratio', `${f.opexRatioDetail}%`)}
            {row('Net Operating Income', fmtK(f.noiDetail), true, '#C9A84C')}
          </div>
        </div>

        {/* Sources & Uses */}
        <div style={sectionStyle}>
          {sectionHeader('Sources & Uses')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#16A34A', letterSpacing: '0.08em', marginBottom: 8 }}>SOURCES</div>
              {(f.sourcesAndUses?.sources || []).map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ fontSize: 11, color: '#94A3B8' }}>{s.item}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#E2E8F0', fontFamily: "'Space Mono', monospace" }}>{fmtK(s.amount)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '2px solid rgba(22,163,74,0.2)', marginTop: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#16A34A' }}>Total Sources</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#16A34A', fontFamily: "'Space Mono', monospace" }}>{fmtK(f.sourcesAndUses?.totalSources || 0)}</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#E87A2E', letterSpacing: '0.08em', marginBottom: 8 }}>USES</div>
              {(f.sourcesAndUses?.uses || []).map((u, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ fontSize: 11, color: '#94A3B8' }}>{u.item}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#E2E8F0', fontFamily: "'Space Mono', monospace" }}>{fmtK(u.amount)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '2px solid rgba(232,122,46,0.2)', marginTop: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#E87A2E' }}>Total Uses</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#E87A2E', fontFamily: "'Space Mono', monospace" }}>{fmtK(f.sourcesAndUses?.totalUses || 0)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Exit Scenarios */}
        <div style={sectionStyle}>
          {sectionHeader(`${f.holdPeriod}-Year Exit Scenarios`)}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {(f.exitScenarios || []).map((es, i) => (
              <div key={i} style={{ padding: '16px', borderRadius: 10, background: i === 1 ? 'rgba(201,168,76,0.06)' : 'rgba(15,21,56,0.5)', border: `1px solid ${i === 1 ? 'rgba(201,168,76,0.15)' : 'rgba(201,168,76,0.06)'}`, textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7394', marginBottom: 6 }}>{es.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "'Space Mono', monospace", color: '#E2E8F0' }}>{fmtK(es.exitValue)}</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 8, fontSize: 10, color: '#94A3B8' }}>
                  <span>IRR <strong style={{ color: parseFloat(es.irr) >= 15 ? '#16A34A' : '#F59E0B' }}>{es.irr}%</strong></span>
                  <span>PoC <strong style={{ color: parseFloat(es.profitOnCost) >= 30 ? '#16A34A' : '#F59E0B' }}>{es.profitOnCost}%</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sensitivity Matrix */}
        <div style={sectionStyle}>
          {sectionHeader('Sensitivity Analysis (YOC & IRR)')}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ padding: '8px', background: 'rgba(201,168,76,0.06)', borderRadius: '8px 0 0 0', color: '#6B7394', fontSize: 9, fontWeight: 700 }}></th>
                  {(f.sensitivityMatrix?.occScenarios || []).map((o, i) => (
                    <th key={i} style={{ padding: '8px', background: 'rgba(201,168,76,0.06)', color: '#C9A84C', fontSize: 9, fontWeight: 700, textAlign: 'center' }}>{o.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(f.sensitivityMatrix?.grid || []).map((rentRow, ri) => (
                  <tr key={ri}>
                    <td style={{ padding: '8px', color: '#C9A84C', fontWeight: 700, fontSize: 10, background: 'rgba(201,168,76,0.04)' }}>{f.sensitivityMatrix.rentScenarios[ri]?.label}</td>
                    {rentRow.map((cell, ci) => {
                      const isBase = ri === 1 && ci === 1;
                      const yocVal = parseFloat(cell.yoc);
                      const yocColor = yocVal >= 9.0 ? '#16A34A' : yocVal >= 7.5 ? '#F59E0B' : '#EF4444';
                      return (
                        <td key={ci} style={{ padding: '8px 12px', textAlign: 'center', background: isBase ? 'rgba(201,168,76,0.08)' : 'transparent', border: isBase ? '1px solid rgba(201,168,76,0.2)' : '1px solid rgba(255,255,255,0.02)', borderRadius: isBase ? 6 : 0 }}>
                          <div style={{ fontWeight: 800, color: yocColor, fontFamily: "'Space Mono', monospace", fontSize: 13 }}>{cell.yoc}%</div>
                          <div style={{ fontSize: 9, color: '#6B7394', marginTop: 2 }}>IRR {cell.irr}%</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* REIT Benchmarks */}
        <div style={sectionStyle}>
          {sectionHeader('REIT Peer Benchmarks (Q4 2025)')}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid rgba(201,168,76,0.15)' }}>
                  {['Ticker', 'NOI Margin', 'Avg Occ', 'Rev/SF', 'Cap Rate', 'ECRI Lift'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: h === 'Ticker' ? 'left' : 'right', color: '#6B7394', fontSize: 9, fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(f.reitBench || []).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: r.ticker === 'PSA' ? 'rgba(201,168,76,0.04)' : 'transparent' }}>
                    <td style={{ padding: '6px 10px', color: r.ticker === 'PSA' ? '#C9A84C' : '#E2E8F0', fontWeight: 700 }}>{r.ticker}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: "'Space Mono', monospace", color: '#E2E8F0' }}>{r.noiMargin}%</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: "'Space Mono', monospace", color: '#E2E8F0' }}>{r.avgOcc}%</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: "'Space Mono', monospace", color: '#E2E8F0' }}>${r.revPAF}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: "'Space Mono', monospace", color: '#E2E8F0' }}>{r.impliedCap}%</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: "'Space Mono', monospace", color: '#E2E8F0' }}>{r.ecriLift}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ─── Render: Pricing Inputs Tab (existing section cards) ───
  const renderInputs = () => (
    <div>
      {/* ═══ STATUS BAR ═══ */}
      <div style={S.statusBar}>
        {scope === 'site' && selectedSite && (
          <div style={S.statusItem('#E87A2E')}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#E87A2E' }} />
            Site: {selectedSite.name || selectedSite.address || selectedSite.id}
          </div>
        )}
        <div style={S.statusItem(scope === 'site' ? '#E87A2E' : '#C9A84C')}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: scope === 'site' ? '#E87A2E' : '#C9A84C' }} />
          {overrideCount} {scope === 'site' ? 'Site' : 'Global'} Override{overrideCount !== 1 ? 's' : ''}
        </div>
        <div style={S.statusItem('#39FF14')}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#39FF14' }} />
          {totalInputs - overrideCount} Defaults
        </div>
        <div style={S.statusItem('#6B7394')}>
          {scope === 'site' ? 'Changes apply to this site only' : 'Changes apply to all new sites'}
        </div>
        <div style={{ flex: 1 }} />
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#6B7394', fontSize: 14, pointerEvents: 'none' }}>{'\uD83D\uDD0D'}</span>
          <input
            style={S.search}
            placeholder="Search inputs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={(e) => { e.target.style.borderColor = 'rgba(232,122,46,0.4)'; }}
            onBlur={(e) => { e.target.style.borderColor = 'rgba(201,168,76,0.12)'; }}
          />
        </div>
      </div>

      {/* ═══ SECTION CARDS ═══ */}
      {filteredSections.map(sec => {
        const isExpanded = expandedSections[sec.id] || searchQuery.trim();
        const secOverrides = sec.inputs.filter(inp => inp.key in localOverrides).length;
        return (
          <div key={sec.id} style={S.sectionCard(isExpanded)} className="card-reveal">
            <div style={S.sectionHeader}
              onClick={() => setExpandedSections(prev => ({ ...prev, [sec.id]: !prev[sec.id] }))}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(232,122,46,0.03)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              <div style={S.sectionTitle}>
                <span style={{ fontSize: 20 }}>{sec.icon}</span>
                <div>
                  <div style={S.sectionLabel}>
                    {sec.label}
                    {secOverrides > 0 && (
                      <span style={{ marginLeft: 10, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: 'rgba(232,122,46,0.15)', color: '#E87A2E' }}>
                        {secOverrides} override{secOverrides > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div style={S.sectionDesc}>{sec.description}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: isExpanded ? '#E87A2E' : '#6B7394', fontWeight: 700, transition: 'color 0.2s' }}>{sec.inputs.length} inputs</span>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: isExpanded ? 'rgba(232,122,46,0.15)' : 'rgba(107,115,148,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                  <span style={{ fontSize: 14, color: isExpanded ? '#E87A2E' : '#6B7394', transform: `rotate(${isExpanded ? 180 : 0}deg)`, transition: 'transform 0.25s cubic-bezier(0.22,1,0.36,1)', display: 'inline-block' }}>{'\u25BE'}</span>
                </div>
              </div>
            </div>
            {isExpanded && (
              <div style={S.sectionBody} className="card-expand">
                {sec.inputs.map(renderInput)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div ref={containerRef} style={S.page}>
      {/* ═══ VOLTAGE OVERLAY ═══ */}
      {voltageActive && (
        <div style={S.voltageOverlay}>
          <div style={{
            position: 'absolute', top: '50%', left: 0, right: 0, height: 2,
            background: voltagePhase >= 2
              ? 'linear-gradient(90deg, transparent, #39FF14, #00E5FF, #39FF14, transparent)'
              : 'transparent',
            boxShadow: voltagePhase >= 2 ? '0 0 30px rgba(57,255,20,0.6), 0 0 60px rgba(0,229,255,0.3)' : 'none',
            animation: voltagePhase >= 2 ? 'tabSweep 0.35s cubic-bezier(0.22,1,0.36,1) forwards' : 'none',
            transformOrigin: 'left',
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: voltagePhase === 2
              ? 'radial-gradient(ellipse at center, rgba(57,255,20,0.08) 0%, transparent 60%)'
              : voltagePhase === 3
              ? 'radial-gradient(ellipse at center, rgba(0,229,255,0.04) 0%, transparent 50%)'
              : 'transparent',
            transition: 'background 0.15s',
          }} />
          {voltagePhase >= 2 && [0, 1, 2, 3].map(i => (
            <div key={i} style={{
              position: 'absolute',
              top: i < 2 ? 0 : 'auto', bottom: i >= 2 ? 0 : 'auto',
              left: i % 2 === 0 ? 0 : 'auto', right: i % 2 === 1 ? 0 : 'auto',
              width: 120, height: 120,
              background: `radial-gradient(ellipse at ${i % 2 === 0 ? 'left' : 'right'} ${i < 2 ? 'top' : 'bottom'}, rgba(57,255,20,0.15) 0%, transparent 70%)`,
              animation: `lightning-arc 0.5s ease-out ${i * 0.05}s`,
              pointerEvents: 'none',
            }} />
          ))}
        </div>
      )}

      {/* ═══ REVERT CONFIRMATION DIALOG ═══ */}
      {showRevertConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowRevertConfirm(false)}>
          <div style={{ background: 'linear-gradient(135deg, #0F1538, #1E2761)', borderRadius: 16, padding: '32px 36px', maxWidth: 440, width: '90%', border: '1px solid rgba(232,122,46,0.3)', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 28, textAlign: 'center', marginBottom: 12 }}>{'\u26A0\uFE0F'}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#E2E8F0', textAlign: 'center', marginBottom: 8 }}>Revert All Inputs?</div>
            <div style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 1.7, marginBottom: 24 }}>
              This will revert <strong style={{ color: '#E87A2E' }}>{overrideCount} override{overrideCount !== 1 ? 's' : ''}</strong> back to Storvex global defaults{scope === 'site' ? ` for ${selectedSite?.name || 'this site'}` : ' across all sites'}. All valuation reports, REC packages, and pricing outputs will recalculate to default values.
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setShowRevertConfirm(false)}
                style={{ flex: 1, padding: '12px 20px', borderRadius: 10, border: '1px solid rgba(201,168,76,0.15)', background: 'transparent', color: '#94A3B8', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => { handleRevertAll(); setShowRevertConfirm(false); }}
                style={{ flex: 1, padding: '12px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #E87A2E, #C9A84C)', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 16px rgba(232,122,46,0.35)' }}>
                Yes, Revert to Storvex Defaults
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ HEADER ═══ */}
      <div style={S.header}>
        <div>
          <div style={S.title}>
            <span style={{ background: 'linear-gradient(135deg, #C9A84C, #FFD700, #C9A84C)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Valuation Engine</span>
            {voltageActive && <span style={{ marginLeft: 12, fontSize: 16, color: '#39FF14', animation: 'electricFlicker 0.5s steps(2) infinite' }}>
              {voltagePhase === 1 ? '\u26A1 CHARGING...' : voltagePhase === 2 ? '\u26A1 RECALCULATING' : voltagePhase === 3 ? '\u26A1 MODELS UPDATED' : ''}
            </span>}
          </div>
          <div style={S.subtitle}>
            {selectedSite
              ? <>{totalInputs} levers powering <span style={{ color: '#E87A2E', fontWeight: 700 }}>{selectedSite.name}</span> — adjust any input, models update instantly</>
              : <>Select a property to power the valuation engine</>
            }
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={S.badge}>
            {overrideCount > 0 ? `${overrideCount} override${overrideCount > 1 ? 's' : ''} active` : 'Using Storvex defaults'}
          </div>
          <button style={S.revertBtn}
            onClick={overrideCount > 0 ? () => setShowRevertConfirm(true) : undefined}
            title={overrideCount > 0 ? `Reset all ${scope === 'site' ? 'site' : 'global'} overrides` : 'All inputs already at defaults'}>
            <span style={{ fontSize: 16 }}>{'\u26A1'}</span>
            Revert {scope === 'site' ? 'Site' : 'All'} Inputs
          </button>
        </div>
      </div>

      {/* ═══ PROPERTY SELECTOR ═══ */}
      <div style={{ marginBottom: 20, padding: 20, borderRadius: 14, background: 'linear-gradient(135deg, rgba(15,21,56,0.7), rgba(30,39,97,0.5))', border: '1px solid rgba(201,168,76,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: selectedSite ? '#E87A2E' : '#C9A84C', boxShadow: `0 0 8px ${selectedSite ? 'rgba(232,122,46,0.5)' : 'rgba(201,168,76,0.5)'}` }} />
          <span style={{ fontSize: 10, fontWeight: 800, color: '#6B7394', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {selectedSite ? 'Property-Level Valuation' : 'Select a Property'}
          </span>
        </div>
        <select
          value={selectedSite?.id || ''}
          onChange={(e) => handleSiteSelect(e.target.value)}
          style={{
            width: '100%', padding: '14px 18px', borderRadius: 10,
            background: 'rgba(8,11,26,0.8)', border: '1px solid rgba(201,168,76,0.25)',
            color: '#E2E8F0', fontSize: 14, fontWeight: 700, fontFamily: "'Inter', sans-serif",
            cursor: 'pointer', appearance: 'none', outline: 'none', transition: 'border-color 0.2s',
            backgroundImage: "url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22><path d=%22M2 4l4 4 4-4%22 fill=%22none%22 stroke=%22%23C9A84C%22 stroke-width=%221.5%22/></svg>')",
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center',
          }}>
          <option value="" style={{ background: '#0A0E2A', color: '#6B7394' }}>-- Global Defaults (All Sites) --</option>
          {(allSites || [])
            .slice()
            .sort((a, b) => (a.city || '').localeCompare(b.city || ''))
            .map(s => (
              <option key={s.id} value={s.id} style={{ background: '#0A0E2A', color: '#E2E8F0' }}>
                {s.city || 'Unknown'}{s.state ? `, ${s.state}` : ''} — {s.name || s.address || s.id}
                {s.overrides && Object.keys(s.overrides).length > 0 ? ` (${Object.keys(s.overrides).length} overrides)` : ''}
              </option>
            ))
          }
        </select>
        {selectedSite && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#6B7394' }}>
            <span style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(232,122,46,0.12)', color: '#E87A2E', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em' }}>
              {siteOverrideCount > 0 ? `${siteOverrideCount} SITE OVERRIDE${siteOverrideCount !== 1 ? 'S' : ''}` : 'USING DEFAULTS'}
            </span>
            <span>Changes apply to <strong style={{ color: '#E87A2E' }}>{selectedSite.name || selectedSite.city || 'this site'}</strong></span>
          </div>
        )}
      </div>

      {/* ═══ SUB-TAB NAVIGATION ═══ */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, padding: 4, borderRadius: 12, background: 'rgba(15,21,56,0.6)', border: '1px solid rgba(201,168,76,0.08)' }}>
        {SUB_TABS.map(t => {
          const active = subTab === t.id;
          return (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              style={{
                flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none',
                background: active ? 'linear-gradient(135deg, rgba(201,168,76,0.15), rgba(232,122,46,0.1))' : 'transparent',
                color: active ? '#C9A84C' : '#6B7394',
                fontSize: 12, fontWeight: active ? 800 : 600, letterSpacing: '0.02em',
                cursor: 'pointer', transition: 'all 0.2s ease',
                boxShadow: active ? '0 2px 12px rgba(201,168,76,0.1), inset 0 0 0 1px rgba(201,168,76,0.2)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(201,168,76,0.04)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
              <span style={{ fontSize: 14 }}>{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ═══ EMPTY STATE (no property selected) ═══ */}
      {!selectedSite && (
        <div style={{ textAlign: 'center', padding: '80px 20px', borderRadius: 20, background: 'linear-gradient(180deg, rgba(15,21,56,0.6), rgba(30,39,97,0.3))', border: '1px solid rgba(201,168,76,0.1)', marginTop: 8, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.3), transparent)' }} />
          <div style={{ fontSize: 56, marginBottom: 20, filter: 'drop-shadow(0 0 20px rgba(201,168,76,0.3))' }}>{'\u26A1'}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#E2E8F0', marginBottom: 10, letterSpacing: '-0.02em' }}>Pick a Property. We Handle the Math.</div>
          <div style={{ fontSize: 13, color: '#6B7394', maxWidth: 500, margin: '0 auto', lineHeight: 1.8 }}>
            Every site in the pipeline has <span style={{ color: '#C9A84C', fontWeight: 700 }}>{totalInputs} pre-calibrated inputs</span> across revenue, construction, operating expenses, and valuation. Select a property above — adjust any lever and watch valuations update in real time.
          </div>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
            {['Revenue', 'Construction', 'Lease-Up', 'OpEx', 'Valuation'].map(cat => (
              <span key={cat} style={{ padding: '6px 16px', borderRadius: 20, background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.1)', fontSize: 11, fontWeight: 700, color: '#6B7394', letterSpacing: '0.04em' }}>{cat}</span>
            ))}
          </div>
        </div>
      )}

      {/* ═══ SUB-TAB CONTENT ═══ */}
      {selectedSite && subTab === 'summary' && renderSummary()}
      {selectedSite && subTab === 'inputs' && renderInputs()}
      {selectedSite && subTab === 'valuations' && renderValuations()}

      {/* ═══ FOOTER — ENGINE STATUS ═══ */}
      <div style={{ marginTop: 24, padding: '16px 20px', borderRadius: 12, background: 'rgba(15,21,56,0.5)', border: '1px solid rgba(201,168,76,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7394', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Storvex Valuation Engine</div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
            {overrideCount > 0
              ? `${overrideCount} custom override${overrideCount > 1 ? 's' : ''} applied — all reports & REC packages reflect these inputs`
              : 'Running on Storvex intelligent defaults — calibrated to PS operating platform'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(57,255,20,0.08)', border: '1px solid rgba(57,255,20,0.15)', fontSize: 11, fontWeight: 700, color: '#39FF14' }}>
            LIVE
          </div>
          <div style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)', fontSize: 11, fontWeight: 600, color: '#C9A84C' }}>
            v3.1 {'\u2014'} RSMeans 2025
          </div>
        </div>
      </div>
    </div>
  );
}
