// ─── ValuationInputs — McKinsey-Level Financial Model Console ───
// Storvex auto-populates intelligent defaults. PS corporate can toggle any lever.
// "Revert to Storvex Inputs" snaps back to engine defaults.
// Voltage animation on recalculation = the engine is alive.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { STYLES } from '../utils';

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
    label: 'Facility Sizing',
    icon: '🏗️',
    description: 'Building configuration and unit mix',
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
    label: 'Market Rates',
    icon: '💰',
    description: 'Rental rates by income tier ($/SF/mo)',
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
    label: 'Lease-Up Schedule',
    icon: '📈',
    description: '5-year occupancy ramp & promotional discounting',
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
    label: 'ECRI Revenue Model',
    icon: '⚡',
    description: 'Existing Customer Rate Increase — PS\'s #1 revenue lever',
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
    label: 'Construction Costs',
    icon: '🔨',
    description: 'Full dev cost stack — PS Killeen calibrated ($119/SF actual)',
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
    label: 'Construction Carry',
    icon: '🏦',
    description: 'Pre-revenue carrying costs during build phase',
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
    description: 'PS operating platform — 78.4% NOI margin benchmark',
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
    label: 'Valuation & Cap Rates',
    icon: '🎯',
    description: 'Exit assumptions and stabilized valuation scenarios',
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
    label: 'Land Pricing',
    icon: '🗺️',
    description: 'YOC targets for back-calculating max land acquisition price',
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
    description: 'Permanent debt structure and equity requirements',
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
  const [expandedSections, setExpandedSections] = useState({ facility: true });
  const [voltageActive, setVoltageActive] = useState(false);
  const [voltagePhase, setVoltagePhase] = useState(0); // 0=idle, 1=charging, 2=discharge, 3=cascade
  const [changedKeys, setChangedKeys] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
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
    sectionCard: (isExpanded) => ({ ...STYLES.cardBase, marginBottom: 12, overflow: 'hidden', borderLeft: `3px solid ${isExpanded ? '#E87A2E' : 'rgba(201,168,76,0.12)'}`, transition: 'all 0.3s cubic-bezier(0.22,1,0.36,1)' }),
    sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', cursor: 'pointer', userSelect: 'none', transition: 'background 0.15s' },
    sectionTitle: { display: 'flex', alignItems: 'center', gap: 10 },
    sectionLabel: { fontSize: 15, fontWeight: 700, color: '#E2E8F0', letterSpacing: '-0.01em' },
    sectionDesc: { fontSize: 11, color: '#6B7394', fontWeight: 500, marginTop: 2 },
    sectionBody: { padding: '0 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 },
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
      fontSize: 22, fontWeight: 800, fontFamily: "'Space Mono', monospace",
      color: isOverridden ? '#E87A2E' : '#E2E8F0',
      cursor: 'pointer', transition: 'all 0.15s',
      letterSpacing: '-0.02em',
    }),
    inputDefault: { fontSize: 10, color: '#6B7394', marginTop: 4, fontWeight: 500 },
    sliderTrack: { width: '100%', height: 4, borderRadius: 2, background: 'rgba(107,115,148,0.2)', marginTop: 8, position: 'relative', cursor: 'pointer' },
    sliderFill: (pct, isOverridden) => ({
      position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 2,
      width: `${Math.max(0, Math.min(100, pct))}%`,
      background: isOverridden ? 'linear-gradient(90deg, #E87A2E, #C9A84C)' : 'linear-gradient(90deg, #2C3E6B, #42A5F5)',
      transition: 'width 0.3s cubic-bezier(0.22,1,0.36,1)',
    }),
    sliderThumb: (pct) => ({
      position: 'absolute', top: -5, left: `calc(${Math.max(0, Math.min(100, pct))}% - 7px)`,
      width: 14, height: 14, borderRadius: '50%',
      background: '#E2E8F0', border: '2px solid #E87A2E',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      transition: 'left 0.3s cubic-bezier(0.22,1,0.36,1)',
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

        {/* Value — click to edit inline */}
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
            style={{ ...S.inputValue(isOverridden), width: '100%', background: 'rgba(15,21,56,0.8)', border: '1px solid #E87A2E', borderRadius: 6, padding: '4px 8px', outline: 'none', fontSize: 18 }}
          />
        ) : (
          <div style={S.inputValue(isOverridden)}
            onClick={() => { setEditingKey(input.key); setEditValue(rawToDisplay(input, val)); }}
            title={input.tip || `Click to edit. Range: ${fmtVal(input, input.min)} – ${fmtVal(input, input.max)}`}>
            {fmtVal(input, val)}
            {input.unit && <span style={{ fontSize: 11, color: '#6B7394', fontWeight: 500, marginLeft: 4 }}>{input.unit}</span>}
          </div>
        )}

        {/* Slider track */}
        <div style={S.sliderTrack}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const raw = input.min + clickPct * (input.max - input.min);
            // Snap to step
            const stepped = Math.round(raw / input.step) * input.step;
            const clamped = Math.max(input.min, Math.min(input.max, stepped));
            handleSave(input.key, clamped);
          }}>
          <div style={S.sliderFill(pct, isOverridden)} />
          <div style={S.sliderThumb(pct)} />
        </div>

        {/* Default reference */}
        <div style={S.inputDefault}>
          Storvex: {fmtVal(input, defaultVal)}
          {isOverridden && <span style={{ color: '#E87A2E', marginLeft: 8 }}>
            {val > defaultVal ? '▲' : '▼'} {fmtVal(input, Math.abs(val - defaultVal))} {val > defaultVal ? 'above' : 'below'} default
          </span>}
        </div>
      </div>
    );
  };

  return (
    <div ref={containerRef} style={S.page}>
      {/* ═══ VOLTAGE OVERLAY ═══ */}
      {voltageActive && (
        <div style={S.voltageOverlay}>
          {/* Horizontal discharge line */}
          <div style={{
            position: 'absolute', top: '50%', left: 0, right: 0, height: 2,
            background: voltagePhase >= 2
              ? 'linear-gradient(90deg, transparent, #39FF14, #00E5FF, #39FF14, transparent)'
              : 'transparent',
            boxShadow: voltagePhase >= 2 ? '0 0 30px rgba(57,255,20,0.6), 0 0 60px rgba(0,229,255,0.3)' : 'none',
            animation: voltagePhase >= 2 ? 'tabSweep 0.35s cubic-bezier(0.22,1,0.36,1) forwards' : 'none',
            transformOrigin: 'left',
          }} />
          {/* Full-screen flash */}
          <div style={{
            position: 'absolute', inset: 0,
            background: voltagePhase === 2
              ? 'radial-gradient(ellipse at center, rgba(57,255,20,0.08) 0%, transparent 60%)'
              : voltagePhase === 3
              ? 'radial-gradient(ellipse at center, rgba(0,229,255,0.04) 0%, transparent 50%)'
              : 'transparent',
            transition: 'background 0.15s',
          }} />
          {/* Corner lightning arcs */}
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

      {/* ═══ HEADER ═══ */}
      <div style={S.header}>
        <div>
          <div style={S.title}>
            Valuation Inputs
            {voltageActive && <span style={{ marginLeft: 12, fontSize: 16, color: '#39FF14', animation: 'electricFlicker 0.5s steps(2) infinite' }}>
              {voltagePhase === 1 ? '⚡ CHARGING...' : voltagePhase === 2 ? '⚡ RECALCULATING' : voltagePhase === 3 ? '⚡ MODELS UPDATED' : ''}
            </span>}
          </div>
          <div style={S.subtitle}>
            Storvex Financial Engine — {totalInputs} configurable inputs across {SECTIONS.length} categories
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={S.badge}>
            {overrideCount > 0 ? `${overrideCount} override${overrideCount > 1 ? 's' : ''} active` : 'Using Storvex defaults'}
          </div>
          <button style={S.revertBtn}
            onClick={overrideCount > 0 ? handleRevertAll : undefined}
            title={overrideCount > 0 ? `Reset all ${scope === 'site' ? 'site' : 'global'} overrides` : 'All inputs already at defaults'}>
            <span style={{ fontSize: 16 }}>⚡</span>
            Revert {scope === 'site' ? 'Site' : 'All'} Inputs
          </button>
        </div>
      </div>

      {/* ═══ PROPERTY SELECTOR + SCOPE ═══ */}
      <div style={{ marginBottom: 20, padding: 20, borderRadius: 14, background: 'linear-gradient(135deg, rgba(15,21,56,0.7), rgba(30,39,97,0.5))', border: '1px solid rgba(201,168,76,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: selectedSite ? '#E87A2E' : '#C9A84C', boxShadow: `0 0 8px ${selectedSite ? 'rgba(232,122,46,0.5)' : 'rgba(201,168,76,0.5)'}` }} />
          <span style={{ fontSize: 10, fontWeight: 800, color: '#6B7394', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {selectedSite ? 'Property-Level Pricing Inputs' : 'Select a Property'}
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
            <span>Changes below apply to <strong style={{ color: '#E87A2E' }}>{selectedSite.name || selectedSite.city || 'this site'}</strong> only</span>
          </div>
        )}
        {!selectedSite && (
          <div style={{ marginTop: 10, fontSize: 11, color: '#6B7394', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(201,168,76,0.12)', color: '#C9A84C', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em' }}>
              {globalOverrideCount > 0 ? `${globalOverrideCount} GLOBAL OVERRIDE${globalOverrideCount !== 1 ? 'S' : ''}` : 'STORVEX DEFAULTS'}
            </span>
            <span>Changes apply to all new sites</span>
          </div>
        )}
      </div>

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
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#6B7394', fontSize: 14, pointerEvents: 'none' }}>🔍</span>
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
            {/* Section Header */}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#6B7394', fontWeight: 600 }}>{sec.inputs.length} inputs</span>
                <span style={{ fontSize: 16, color: '#6B7394', transform: `rotate(${isExpanded ? 180 : 0}deg)`, transition: 'transform 0.3s', display: 'inline-block' }}>▾</span>
              </div>
            </div>

            {/* Section Body — expanded */}
            {isExpanded && (
              <div style={S.sectionBody} className="card-expand">
                {sec.inputs.map(renderInput)}
              </div>
            )}
          </div>
        );
      })}

      {/* ═══ FOOTER — ENGINE STATUS ═══ */}
      <div style={{ marginTop: 24, padding: '16px 20px', borderRadius: 12, background: 'rgba(15,21,56,0.5)', border: '1px solid rgba(201,168,76,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7394', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Storvex Financial Engine</div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
            {overrideCount > 0
              ? `${overrideCount} custom override${overrideCount > 1 ? 's' : ''} applied — all reports reflect these inputs`
              : 'Running on Storvex intelligent defaults — calibrated to PS operating platform'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(57,255,20,0.08)', border: '1px solid rgba(57,255,20,0.15)', fontSize: 11, fontWeight: 700, color: '#39FF14' }}>
            LIVE
          </div>
          <div style={{ padding: '6px 14px', borderRadius: 8, background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)', fontSize: 11, fontWeight: 600, color: '#C9A84C' }}>
            v3.1 — RSMeans 2025
          </div>
        </div>
      </div>
    </div>
  );
}
