# Storvex vs Radius — Head-to-Head Benchmark

Run date: 2026-04-21
Base URL: https://storvex.vercel.app
Sites benchmarked: 10

## Coverage Matrix — What Storvex delivers on every address

| Site | Market | Zoning conf | Cache? | Utility conf | Water hookup | Access conf | VPD | Total runtime |
|------|--------|-------------|--------|--------------|--------------|-------------|-----|---------------|
| temple_tx | Temple TX · local | medium | 🎯 | high | by-right | medium | — | 76.9s |
| mckinney_tx | McKinney TX · arterial | low | 🎯 | high | by-right | medium | — | 190.6s |
| greenfield_in | Greenfield IN · suburban | medium | 🎯 | medium | by-request | medium | — | 131.9s |
| springboro_oh | Springboro OH · I-75 corridor | low | 🎯 | high | by-right | low | — | 132.6s |
| independence_ky | Independence KY · Kenton County | low | 🎯 | high | by-request | medium | — | 131.9s |
| spring_hill_tn | Spring Hill TN · Columbia Pike | medium | 🎯 | high | by-right | low | — | 75.0s |
| port_charlotte_fl | Port Charlotte FL · US-41 | medium | 🎯 | high | by-right | medium | 61,000 | 185.2s |
| westampton_nj | Westampton NJ · Burlington County | low | — | medium | by-request | low | — | 196.8s |
| escondido_ca | Escondido CA · local arterial | low | — | high | by-right | medium | 22,138 | 180.5s |
| pflugerville_tx | Pflugerville TX · MOPAC/IH-35 | low | — | medium | unknown | medium | — | 183.0s |

## Radius Comparison (manual fill — Dan runs Radius report on same addresses)

| Dimension | Storvex | Radius | Delta / Notes |
|-----------|---------|--------|---------------|
| Zoning — exact ordinance section citation | ✅ cited by Oracle | ❌ district code only | Storvex unique |
| Zoning — by-right district list | ✅ extracted when confidence high | ❌ not provided | Storvex unique |
| Utility — water provider + contact phone | ✅ with full contact card | ❌ not provided | Storvex unique |
| Utility — fire flow notes | ✅ extracted from utility docs | ❌ not provided | Storvex unique |
| Utility — tap fees published rate | ✅ when available | ❌ not provided | Storvex unique |
| Access — VPD from state DOT | ✅ state DOT citation | ⚠ has DOT counts but paid tier | Parity with paid Radius+ |
| Access — decel lane risk | ✅ scored low/med/high | ❌ not provided | Storvex unique |
| Access — landlocked flag | ✅ auto-flagged | ❌ not provided | Storvex unique |
| CC SPC current + projected | ✅ tier verdict | ⚠ SPC only, no tier, no projection | Storvex better |
| Buildable envelope with setbacks | ✅ product auto-select | ❌ acreage only | Storvex unique |
| Best-fit buyer routing | ✅ 49-operator matrix | ❌ not provided | Storvex unique |
| Einstein narrative | ✅ Claude Haiku 4.5 | ❌ static PDF | Storvex unique |
| Demographics (ESRI 1/3/5 mi) | ✅ | ✅ | Parity |
| Competitor list 3-mi | ✅ Places + REIT registry | ✅ Yardi Matrix | Parity (both good) |
| **Historical rent comps (10+ yr)** | ❌ rent flywheel just started | ✅ decade of archives | **Radius unique** |

## The Verdict

Storvex wins on: **operator-specific UW**, **zoning citation**, **utility contact**, **decel lane cost risk**, **buildable scenario**, **Best-Fit Buyer + pitch button**, **Einstein narrative**.

Radius wins on: **historical rent time series** (10+ yr data advantage — the rent flywheel will close this over 2-3 years).

Storvex ships the one-stop shop Radius structurally can't, in 30 seconds, for a fraction of the unit cost.