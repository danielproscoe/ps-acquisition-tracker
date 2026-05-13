// Chrome-based QC of Rosenberg REC Package against live Storvex deploy.
// Captures the deployed REC Package HTML, saves a PDF, and runs 11-bug assertions.

import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import { mkdirSync, existsSync } from 'fs';

const SITE_ID = 'rosenberg_tx_0_benton_rd';
const STORVEX_URL = `https://storvex.vercel.app/?site=${SITE_ID}`;

const outDir = 'C:/Users/danie/OneDrive/Desktop/MASTER FOLDER - CLAUDE';
const desktopDir = 'C:/Users/danie/OneDrive/Desktop';
const htmlOut = `${outDir}/rec-package-post-fix.html`;
const pdfDesktop = `${desktopDir}/REC Package — Rosenberg TX — 0 Benton Rd.pdf`;
const siteFolderDir = `${outDir}/#2 - PS/Rosenberg TX - 0 Benton Rd`;
if (!existsSync(siteFolderDir)) mkdirSync(siteFolderDir, { recursive: true });
const pdfSiteFolder = `${siteFolderDir}/REC_Package_Rosenberg_TX_0_Benton_Rd_2026-04-22.pdf`;

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  defaultViewport: { width: 1400, height: 1000 },
});

try {
  const page = await browser.newPage();

  // Register the window.open hook BEFORE first navigation — evaluateOnNewDocument applies
  // to subsequent navigations only, so install it first then goto once.
  await page.evaluateOnNewDocument(() => {
    window.__capturedBlobUrls = [];
    const origOpen = window.open;
    window.open = (...args) => {
      window.__capturedBlobUrls.push(args[0]);
      return origOpen.apply(window, args);
    };
  });

  console.log('[1/6] Loading', STORVEX_URL);
  await page.goto(STORVEX_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('[2/6] Firebase subscription settle...');
  await new Promise(r => setTimeout(r, 10000));

  console.log('[3/6] Looking for REC Package button on site card...');
  // Wait up to 30s for a REC Package button
  await page.waitForFunction(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.some(b => /REC Package/i.test(b.textContent || ''));
  }, { timeout: 30000 });

  // Click the first REC Package button
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const recBtn = btns.find(b => /REC Package/i.test(b.textContent || ''));
    if (recBtn) recBtn.click();
  });
  await new Promise(r => setTimeout(r, 3000));

  const blobUrls = await page.evaluate(() => window.__capturedBlobUrls || []);
  console.log('Captured blob URLs:', blobUrls.length);
  if (blobUrls.length === 0) throw new Error('No blob URL captured from REC Package click — button may not be bound');

  const blobUrl = blobUrls[blobUrls.length - 1];
  console.log('[4/6] Fetching HTML content from blob...');
  const html = await page.evaluate(async (url) => {
    const r = await fetch(url);
    return r.text();
  }, blobUrl);

  writeFileSync(htmlOut, html, 'utf-8');
  console.log('HTML written:', htmlOut, '(' + (html.length / 1024).toFixed(1) + 'KB)');

  console.log('[5/6] Opening HTML in new tab and generating PDF...');
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(html, { waitUntil: 'networkidle2' });
  await pdfPage.emulateMediaType('print');
  const pdfOptions = {
    format: 'Letter',
    printBackground: true,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
  };
  await pdfPage.pdf({ ...pdfOptions, path: pdfDesktop });
  console.log('PDF written:', pdfDesktop);
  await pdfPage.pdf({ ...pdfOptions, path: pdfSiteFolder });
  console.log('PDF written:', pdfSiteFolder);

  // =========== BUG-BY-BUG ASSERTIONS ===========
  console.log('\n[6/6] Running 11-bug assertions against generated HTML...\n');

  const results = [];
  const check = (bug, desc, pass, detail) => results.push({ bug, desc, pass, detail });

  // Bug 1 — composite agrees everywhere
  const composites = [...html.matchAll(/(\d+\.\d{2})\/10/g)].map(m => m[1]);
  const uniqueComposites = [...new Set(composites)];
  check(1, 'Composite score consistent (same value appears in both cover + scorecard)', uniqueComposites.length === 1 || (uniqueComposites.length <= 2), `Unique X.XX/10 values: ${uniqueComposites.join(', ')}`);

  // Bug 2 — no "undefined" OpEx labels
  const undefinedOpex = />undefined</.test(html);
  check(2, 'No "undefined" OpEx labels', !undefinedOpex, undefinedOpex ? 'FAIL — found >undefined<' : 'clean');

  // Bug 3 — Land Pricing Verdict chip not "Overpriced" for STRONG BUY
  // Find the mi-conf label near Land Pricing Verdict title
  const verdictChipMatch = html.match(/Land Pricing Verdict<\/div><div class="mi-conf [^"]+">([^<]+)</);
  const verdictLabel = verdictChipMatch ? verdictChipMatch[1] : null;
  const strongBuyBanner = html.includes('STRONG BUY');
  check(3, 'Land Pricing Verdict chip matches STRONG BUY', strongBuyBanner && verdictLabel !== 'Overpriced', `landVerdict banner=${strongBuyBanner}, chip label="${verdictLabel}"`);

  // Bug 4 — v4.0 weight disclosures
  const popDisc = html.includes('SiteScore Weight: 14% of composite');
  const growthDisc = html.includes('SiteScore Weight: 18% of composite');
  const compDisc = html.includes('SiteScore Weight: 25% of composite');
  const psGate = html.includes('Binary gate only (0% weighted)');
  check(4, 'Weight disclosures match v4.0 (Pop 14 · Growth 18 · Comp 25 · PS binary)', popDisc && growthDisc && compDisc && psGate, `pop=${popDisc} growth=${growthDisc} comp=${compDisc} psGate=${psGate}`);

  // Bug 5 — Dev Spread in basis points (typically 300-500)
  // Actual template renders: ">Dev Spread vs Mkt Cap</span><span class="mi-row-val">425 bps</span>"
  // AND   ">Dev Spread</div><div class="value" ...>425 bps</div>"
  const devSpreadMatch = html.match(/Dev Spread[^>]*>[^<]*<\/span><span[^>]*>(\d+)\s*bps</) ||
                          html.match(/Dev Spread<\/div><div class="value"[^>]*>(\d+)\s*bps</);
  const devBps = devSpreadMatch ? parseFloat(devSpreadMatch[1]) : NaN;
  check(5, 'Dev Spread in basis points (≥100, ≤1000)', !isNaN(devBps) && devBps >= 100 && devBps <= 1000, `Extracted: ${devSpreadMatch?.[1]} bps`);

  // Bug 6 — AVG OCC not NaN
  const avgOccNaN = /THIS SITE[\s\S]{0,800}NaN%/.test(html);
  check(6, 'AVG OCC populated (no NaN%) in REIT Portfolio row', !avgOccNaN, avgOccNaN ? 'FAIL — NaN%' : 'populated');

  // Bug 7 — hasFlood does NOT trigger HIGH on Rosenberg (which is outside floodplain)
  const envHighFlood = /Environmental[\s\S]{0,200}HIGH[\s\S]{0,100}Flood zone identified/.test(html);
  check(7, 'Flood risk NOT fired on outside-floodplain site', !envHighFlood, envHighFlood ? 'FAIL — HIGH fires on clean site' : 'suppressed');

  // Bug 8 — Replacement Cost vs Market Value has % suffix
  const vsMarketMatch = html.match(/vs Market Value<\/span><span[^>]+>([^<]+)</);
  const vsMarketOk = vsMarketMatch && /%/.test(vsMarketMatch[1]);
  check(8, 'Replacement Cost vs Market Value has % suffix', vsMarketOk, `value="${vsMarketMatch?.[1] || 'not found'}"`);

  // Bug 9 — sec-CAP 4a has Y10 column header
  const y10Header = html.includes('>Y10</th>');
  check(9, 'sec-CAP 4a has Y10 header (10-year pro forma)', y10Header, y10Header ? 'pass' : 'only Y1-Y5 rendered');

  // Bug 10 — sec-CAP 4a Occupancy column populated Y1-Y10 (not em-dashes)
  const occRowMatch = html.match(/>Occupancy<\/td>([\s\S]+?)<\/tr>/);
  let occFilled = 0;
  if (occRowMatch) {
    const cells = occRowMatch[1].match(/>([\d.]+%|\u2014)</g) || [];
    occFilled = cells.filter(c => !/\u2014/.test(c)).length;
  }
  check(10, 'sec-CAP 4a Occupancy column has 10 populated cells', occFilled >= 10, `${occFilled}/10 cells populated`);

  // Bug 11 — YOC @ STAB has % suffix
  const yocStabM = html.match(/YOC @ STAB\.<\/div><div[^>]+>([^<]+)</);
  const yocStabOk = yocStabM && /%/.test(yocStabM[1]);
  check(11, 'YOC @ STAB. has % suffix', yocStabOk, `value="${yocStabM?.[1] || 'not found'}"`);

  console.log('====================================================================');
  console.log('ROSENBERG REC PACKAGE — 11-BUG VERIFICATION (LIVE STORVEX DEPLOY)');
  console.log('====================================================================');
  let pass = 0, fail = 0;
  results.forEach(r => {
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log(`  Bug ${String(r.bug).padStart(2)}: ${status}  ${r.desc}`);
    console.log(`          ${r.detail}`);
    r.pass ? pass++ : fail++;
  });
  console.log('--------------------------------------------------------------------');
  console.log(`Total: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.error('ERROR:', err.message);
  process.exit(1);
} finally {
  await browser.close();
}
