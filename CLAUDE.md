# CLAUDE.md — Storvex Acquisition Engine

## Project Overview

Storvex — a proprietary AI-powered acquisition intelligence engine developed by DJR Real Estate LLC. Storvex is a versatile platform for scoring, vetting, and tracking property acquisitions across any property type. It powers real-time pipeline management with a configurable SiteScore algorithm (Patent Application No. 64/009,393).

The engine is property-type agnostic — while currently deployed for self-storage acquisition, its scoring dimensions, vetting framework, and pipeline workflows are designed to evaluate any commercial real estate opportunity.

**Live users:** Dan R (admin), Daniel Wollent (Southwest region), Matthew Toussaint (East region).

## Tech Stack

- **Frontend:** React 18 (Create React App) — single-page application
- **Backend:** Firebase Realtime Database (NoSQL JSON) + Firebase Cloud Storage
- **Auth:** Firebase Auth (configured, minimal enforcement — open DB rules by design)
- **Build:** react-scripts 5.0.1 (Webpack under the hood)
- **Hosting:** Vercel (auto-deploys on push)
- **Key libraries:** firebase 10.7.1, xlsx 0.18.5 (lazy-loaded), ajv 8.12.0

## Quick Commands

```bash
npm start          # Dev server (localhost:3000)
npm run build      # Production build → build/
npm test           # Jest (no tests written yet)
```

## Repository Structure

```
├── src/
│   ├── App.js              # Main monolithic component (~4200 lines)
│   ├── firebase.js          # Firebase SDK init (db, storage, auth exports)
│   ├── config.js            # Shared constants: SiteScore weights, thresholds, dimensions, colors
│   ├── SessionLogger.js     # User login/pageview logging to Firebase
│   ├── index.js             # React entry point
│   └── responsive.css       # Media queries and accessibility styles
├── scripts/
│   └── backup-firebase.mjs  # Firebase database backup utility
├── public/                  # Static assets (index.html, logos, favicons)
├── firebase-rules.json      # DB rules (open read/write — intentional)
├── storage.rules            # Storage rules (open read/write)
├── DEPLOYMENT_GUIDE.md      # Step-by-step deploy guide for Vercel/Firebase
├── .gitignore               # Excludes node_modules/ and build/
└── package.json
```

## Architecture Notes

### Monolithic App.js

All application logic lives in `src/App.js`. It contains:
- Tab-based navigation (Dashboard, Pipeline, Review Queue, Admin)
- Site submission and review workflows
- Storvex SiteScore engine (configurable weights stored in Firebase at `config/siteiq_weights`)
- Vetting report generator (standalone HTML with sticky section navigation)
- Document upload/management (Flyer, Survey, Geotech, PSA, LOI, Appraisal, Environmental, Title, Plat, Other)
- CSV/Excel bulk import and Excel export (XLSX lazy-loaded via dynamic `import()`)
- Real-time Firebase listeners for multi-user sync
- Inline styles via a `STYLES` constant object (no CSS-in-JS library)

### Shared Config (`src/config.js`)

Canonical reference for all Storvex constants — weights, thresholds, tiers, phases, colors, dimensions. Must stay in sync with `SITE_SCORE_DEFAULTS` and `PHASES` in App.js.

### Firebase Data Structure

- `submissions/` — Sites in the review queue
- `southwest/` — Daniel Wollent's regional pipeline
- `east/` — Matthew Toussaint's regional pipeline
- `userLogs/` — Session and activity logs
- `config/siteiq_weights` — Live SiteScore weight overrides (legacy key name retained)

### Storvex SiteScore System

Weighted composite scoring across 9 dimensions (weights sum to exactly 1.00):

| Dimension | Key | Weight | Source |
|---|---|---|---|
| Population | population | 15% | ESRI / Census ACS |
| Growth | growth | 17% | ESRI 5-year projections |
| Med. Income | income | 8% | ESRI / Census ACS |
| Pricing | pricing | 7% | Asking price / acreage |
| Zoning | zoning | 15% | Zoning field + summary |
| Site Access | access | 6% | Site data + summary |
| Facility Proximity | psProximity | 12% | siteiqData.nearestPS |
| Competition | competition | 10% | Competitor data / summary |
| Market Tier | marketTier | 10% | Market field / config |

**Adjustments applied after weighted sum:**
- Phase bonuses: Under Contract/Closed (+0.3), PSA Sent (+0.2), LOI (+0.15), Storvex Approved (+0.1)
- Stale listing penalty: >1000 DOM = -0.5
- Broker intel bonuses: confirmed zoning (+0.2), clean survey (+0.1), capped at +0.3
- Water hookup: no provider = -1.0, extension needed = -0.3
- Research completeness: full vet (+0.5), 70%+ (+0.3), <40% (-0.1), none (-0.3)

**Hard fail triggers:** population < 5,000 (3mi), income < $55,000 (3mi), landlocked.

**Classification:** GREEN (≥7.5), YELLOW (≥5.5), ORANGE (≥3.0), RED (<3.0).

**Tier labels:** ELITE (≥9), PRIME (≥8), STRONG (≥7), VIABLE (≥6), MARGINAL (≥4), WEAK (<4).

**Badge tiers:** gold (≥8), steel (≥6), gray (<6).

### Pipeline Phases

`Prospect → Submitted to PS → Storvex Approved → LOI → PSA Sent → Under Contract → Closed → Declined → Dead`

Legacy phase migration map exists in App.js for backward compatibility with old 14-phase system.

### Key Patterns

- **State management:** React hooks only (useState, useEffect, useCallback, useRef, useMemo) — no Redux or external state library
- **Styling:** Inline style objects throughout; responsive.css for media queries
- **ID generation:** `uid()` helper using `Date.now().toString(36)` + random suffix
- **Currency formatting:** `fmt$()` and `fmtN()` helpers in App.js
- **XLSX lazy loading:** Dynamic `import("xlsx")` to keep initial bundle small (~500KB savings)
- **SiteScore caching:** Memoized via `useMemo` to avoid redundant computation per render cycle
- **Property-type agnostic:** User-facing labels use "intended use" / "Facility Proximity" rather than storage-specific terms

## Development Conventions

- **No component decomposition** — all UI lives in App.js. Follow this pattern for consistency.
- **Inline styles** — use the existing `STYLES` constant pattern, not separate CSS files.
- **Firebase direct** — no ORM or abstraction layer. Use `ref()`, `onValue()`, `set()`, `push()`, `remove()`, `update()` directly.
- **No .env files** — Firebase config is hardcoded in `src/firebase.js`.
- **No automated tests** — testing infrastructure exists (Jest via react-scripts) but no test files written.
- **No pre-commit hooks or CI checks** — code deploys directly via Vercel on push.
- **ESLint** — minimal config, extends `react-app` preset only.
- **Copyright notice** — `src/App.js` header: `© 2026 DJR Real Estate LLC. All rights reserved.`
- **Branding:** Always use "Storvex" (not "SiteIQ" or "StorageIQ"). SiteScore is the scoring algorithm name. Firebase keys retain legacy names (e.g., `siteiqData`, `config/siteiq_weights`) for backward compatibility — do not rename data keys.

## Important Warnings

- **Proprietary code** — unauthorized reproduction or distribution prohibited.
- **Open Firebase rules** — DB and Storage have `read: true, write: true`. This is intentional for the 3-user setup. Do not add authentication gates without explicit approval.
- **Firebase config in source** — API keys are committed. This is known and accepted for this project's threat model.
- **No tests** — verify changes manually or by running `npm run build` to catch compile errors.
- **Single large file** — `src/App.js` is ~4200 lines. Be careful with edits; always read relevant sections before modifying.
- **Legacy data keys** — Firebase paths like `siteiqData` and `config/siteiq_weights` are legacy names. Do NOT rename them — existing production data depends on these keys.
