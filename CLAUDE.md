# CLAUDE.md — PS Acquisition Tracker

## Project Overview

Storvex Acquisition Tracker — a real-time property acquisition pipeline tool for DJR Real Estate LLC. Tracks self-storage site opportunities through scoring, review, and deal phases across two regional teams. Branded under "Storvex" with a proprietary SiteIQ scoring algorithm (Patent Application No. 64/009,393).

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
│   ├── App.js              # Main monolithic component (~4100 lines)
│   ├── firebase.js          # Firebase SDK init (db, storage, auth exports)
│   ├── config.js            # Shared constants: SiteIQ weights, thresholds, colors
│   ├── SessionLogger.js     # User login/pageview logging to Firebase
│   ├── index.js             # React entry point
│   └── responsive.css       # Media queries and accessibility styles
├── scripts/
│   └── backup-firebase.mjs  # Firebase database backup utility
├── public/                  # Static assets (index.html, logos, favicons)
├── firebase-rules.json      # DB rules (open read/write — intentional)
├── storage.rules            # Storage rules (open read/write)
├── DEPLOYMENT_GUIDE.md      # Step-by-step deploy guide for Vercel/Firebase
└── package.json
```

## Architecture Notes

### Monolithic App.js

All application logic lives in `src/App.js`. It contains:
- Tab-based navigation (Dashboard, Pipeline, Review Queue, Admin)
- Site submission and review workflows
- SiteIQ scoring engine (configurable weights stored in Firebase at `config/siteiq_weights`)
- Document upload/management (Flyer, Survey, Geotech, PSA, LOI, Appraisal, Environmental, Title, Plat, Other)
- CSV/Excel bulk import and Excel export (XLSX lazy-loaded via dynamic `import()`)
- Real-time Firebase listeners for multi-user sync
- Inline styles via a `STYLES` constant object (no CSS-in-JS library)

### Firebase Data Structure

- `submissions/` — Sites in the review queue
- `southwest/` — Daniel Wollent's regional pipeline
- `east/` — Matthew Toussaint's regional pipeline
- `userLogs/` — Session and activity logs
- `config/siteiq_weights` — Live SiteIQ weight overrides

### SiteIQ Scoring System

Weighted scoring across 9 dimensions (weights auto-normalize to 1.0):
- Population (18%), Growth (20%), Income (10%), Pricing (8%)
- Zoning (14%), Site Access (7%), PS Proximity (10%)
- Competition (5%), Market Tier (8%)

Hard fail triggers: population < 5,000 (3mi), income < $55,000 (3mi), PS distance < 2.5mi.

Classification: GREEN (≥7.5), YELLOW (≥5.5), ORANGE (≥3.0), RED (<3.0).

### Pipeline Phases

`Prospect → Submitted to PS → Storvex Approved → LOI → PSA Sent → Under Contract → Closed → Declined → Dead`

Legacy phase migration map exists in App.js for backward compatibility with old 14-phase system.

### Key Patterns

- **State management:** React hooks only (useState, useEffect, useCallback, useRef, useMemo) — no Redux or external state library
- **Styling:** Inline style objects throughout; responsive.css for media queries
- **ID generation:** `uid()` helper using `Date.now().toString(36)` + random suffix
- **Currency formatting:** `fmt$()` and `fmtN()` helpers in App.js
- **XLSX lazy loading:** Dynamic `import("xlsx")` to keep initial bundle small (~500KB savings)

## Development Conventions

- **No component decomposition** — all UI lives in App.js. Follow this pattern for consistency.
- **Inline styles** — use the existing `STYLES` constant pattern, not separate CSS files.
- **Firebase direct** — no ORM or abstraction layer. Use `ref()`, `onValue()`, `set()`, `push()`, `remove()`, `update()` directly.
- **No .env files** — Firebase config is hardcoded in `src/firebase.js`.
- **No automated tests** — testing infrastructure exists (Jest via react-scripts) but no test files written.
- **No pre-commit hooks or CI checks** — code deploys directly via Vercel on push.
- **ESLint** — minimal config, extends `react-app` preset only.
- **Copyright notice** — `src/App.js` header: `© 2026 DJR Real Estate LLC. All rights reserved.`

## Important Warnings

- **Proprietary code** — unauthorized reproduction or distribution prohibited.
- **Open Firebase rules** — DB and Storage have `read: true, write: true`. This is intentional for the 3-user setup. Do not add authentication gates without explicit approval.
- **Firebase config in source** — API keys are committed. This is known and accepted for this project's threat model.
- **No tests** — verify changes manually or by running `npm run build` to catch compile errors.
- **Single large file** — `src/App.js` is ~4100 lines. Be careful with edits; always read relevant sections before modifying.
