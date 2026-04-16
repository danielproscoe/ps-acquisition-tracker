# Session Handoff — Storvex sec-CAP Runtime Bug

**Date:** 2026-04-16
**Status:** OPEN — rendering crash on every Storvex REC Package
**Priority:** HIGH — PECO side works cleanly; Storvex REC Package needs this fixed before DW/MT see the capstone
**Last commit attempting fix:** `c80e872` (pre-compute try/catch hardening, currently BUILDING on Vercel at handoff time)

---

## Bug

Clicking the **REC PACKAGE** button on any Storvex (ps-acquisition-tracker) site opens a tab titled "Error" with body:

```
Report Generation Error
jt.toFixed is not a function
```

**Full console stack** (minified, captured on `main.389db3f2.js` bundle):
```
Report generation error: TypeError: jt.toFixed is not a function
    at ou (...:2:1242133)   ← this is generateRECPackage
    at Fh (...:2:1518922)   ← onClick wrapper
    at onClick (...:2:1792635)
    ... [React internals]
```

## Sites tested (all fail identically)

- Argyle TX — Under Contract, SiteScore 9.56
- Greenville TX — Prospect, SiteScore 8.50

→ **Bug is universal across Storvex sites**, not data-specific.

## PECO side works fine

- Lancaster TX (sitescore-peco) — full sec-CAP renders
- Manvel TX (sitescore-peco) — full sec-CAP renders + anchorIntel "KROGER INTENT" chip + no-red ASK vs REC +11.1% navy

The bug is specific to `ps-acquisition-tracker/src/reports.js` — the Storvex variant of sec-CAP that I inserted in commit `e1752a3`.

## Attempted fixes (so far)

1. **`a6fc344`** — wrapped sec-CAP HTML in IIFE try/catch inside the template literal + added `toN()` defensive coercion helper + guarded 3 unguarded `.toFixed` calls (`sxFin1.dscr`, `r.moic`, `sxRisk.weightedMOIC`).
   - Result: **did not catch** the error. Same `jt.toFixed` crash. Conclusion: error is outside the sec-CAP HTML block.

2. **`c80e872`** — wrapped the sec-CAP pre-computes (lines 4157–4165) in try/catch too, with `sxCapError` flag. IIFE now re-throws `sxCapError` if set, triggering the fallback div which shows the exact error message.
   - Result after deploy + test: **error variable renamed `jt` → `Nt`.** Same function (`ou`). New bundle `main.29d8f773.js`, line 2:1234301.
   - Interpretation: the pre-compute try/catch DID catch the original throw (otherwise bundle positions wouldn't have shifted). But the crash moved downstream to a DIFFERENT `.toFixed` call. Either:
     - Previously the pre-compute throw short-circuited everything → now execution continues past it and hits another bug
     - OR the minifier's output just happens to rename the same unguarded toFixed from `jt` to `Nt` after code shape change, not actually a different toFixed

## Most likely actual root cause (for fresh-session hypothesis)

Since the error is happening inside `generateRECPackage` (function `ou`) but OUTSIDE both my IIFE try/catch AND my pre-compute try/catch, the offending `.toFixed` must be in:
- **Existing Storvex sec-VW / sec-RA / legacy sections** (pre-existing code)
- **Pre-compute try/catch variables being referenced WHERE my fallback path doesn't expect** — e.g. if pre-computes fail, `sxScenarios` is undefined; if something in the REST of the REC Package references it, that throws

Check lines in `ps-acquisition-tracker/src/reports.js` for `.toFixed` calls on destructured fin fields around sec-VW (~4399) and sec-RA (~4477). Candidates: `yocStab.toFixed`, `yocStabRaw.toFixed`, `compAdj.toFixed`, `baseClimateRate.toFixed`, `m1Rate.toFixed`, `m2ClimRate.toFixed`, `m3ClimRate.toFixed`, `consensusClimRate.toFixed`. If any of those are called on a potentially-undefined fin field, that's the smoking gun.

**Fastest local repro:** `npm install && npm start` on ps-acquisition-tracker → open any storage site → click REC Package. React dev-mode will give the real line number in unminified code.

## Diagnostic plan for fresh session

1. **Check build status** — `mcp__vercel__get_deployment` for branchAlias `storvex-git-main-danielproscoes-projects.vercel.app`. Confirm `c80e872` READY.

2. **Hard-refresh `storvex.vercel.app`** in Chrome, click DETAIL on any DW/MT site, click REC PACKAGE button.

3. **If the fallback diagnostic div appears** (yellow/amber `⚠ Capstone section temporarily unavailable`) — read the `Error: ...` message in the div. That will pinpoint which pre-compute threw:
   - If `sxYOCSens` / `sxValSens` / `sxComputeScenarios` → issue is in `src/valuationAnalysis.js` (STORAGE constants branch). Likely fin field coercion.
   - If `sxTriangulate` → land comp shape mismatch.
   - If `sxFinancing` / `sxRiskAdjIRR` → scoring.js `computeSiteFinancials` returning unexpected shape.

4. **If still the generic "Error" page** — there's a different crash upstream of my pre-computes. Check:
   - Syntax error in my IIFE template wrap (lines 4552 + 4897 of reports.js) — nested backticks may have broken.
   - Something in an existing Storvex section that uses `.toFixed` on a field shape that changed.
   - The `toN` helper definition timing (declared after pre-computes — OK since template evaluates later).

5. **Local repro path:** clone ps-acquisition-tracker → `npm install` → `npm start` → open storvex locally, click REC PACKAGE on a storage site. React dev-mode will give UNMINIFIED stack with real line numbers.

## Relevant code locations

- **Pre-computes** with try/catch wrap: `ps-acquisition-tracker/src/reports.js` lines 4153–4172
- **sec-CAP IIFE** opening: line 4552
- **sec-CAP IIFE** closing + fallback: line 4897
- **Helper module**: `ps-acquisition-tracker/src/valuationAnalysis.js` (STORAGE constants + `computeScenarios`, `computeYOCSensitivity`, `computeValueSensitivity`, `computeLandTriangulation`, `computeFinancingScenario`, `computeRiskAdjustedIRR`, `computeIRR`)
- **Comp data**: `ps-acquisition-tracker/src/data/storageCompSales.js`
- **Design spec**: `ps-acquisition-tracker/docs/CAPSTONE_DESIGN_SPEC.md`

## What works on Storvex (don't break)

- All sections except sec-CAP: exec summary, sec-VW Valuation Workup, sec-RA Rent Analysis (with ECRI schedule), SiteScore Breakdown, Demographics, Zoning, Competition, Utilities, Topography, Risk Assessment, Broker Intel
- Quick Access: 3-button row (Demos + Pricing + REC Package) — EMAIL REC retired
- Routing: Dan's approve-and-route flow (PECO-side already fixed in commit `6f85fa9`; Storvex routing unchanged from existing 2-step flow)

## What must work before declaring fixed

- Click REC PACKAGE on any Storvex site → tab title shows the site name (not "Error")
- sec-CAP section renders OR shows the diagnostic fallback (either is acceptable once the bug is understood)
- All 4 tested Storvex sites work: Argyle TX, Greenville TX, plus one LOI-phase site + one Prospect-phase site
- No regressions on PECO side (Lancaster + Manvel still render full sec-CAP)

## PECO is fully shipped and verified — do not touch

- `sitescore-peco.vercel.app` at commit `dd4cf3f`
- Lancaster TX REC Package + Manvel TX REC Package both render the full 10-sub-section capstone
- Do not modify `sitescore-peco/src/reports.js` while chasing the Storvex bug.
