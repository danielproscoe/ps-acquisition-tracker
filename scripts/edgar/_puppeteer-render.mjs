// _puppeteer-render.mjs — shared Puppeteer HTML-rendering adapter.
//
// CRUSH-RADIUS-PLUS BREADTH PLAY · Sprint 1.
//
// Why this exists
// ---------------
// All four net-new daily-rent operators (EXR · NSA · SmartStop · StorageMart)
// hide unit-level pricing behind client-side JS hydration. Vanilla HTTPS
// fetches return shell HTML without the unit-select-item cards. Puppeteer
// renders the page through a real Chrome instance, waits for hydration,
// and returns the post-hydration HTML — which each operator scraper's
// existing regex-parser then consumes unchanged.
//
// One adapter, four operators unlocked (~3,450 daily-priced facilities).
//
// Design contract
// ---------------
//   renderHTML(url, opts)               — one-shot render, full browser lifecycle
//   createBrowserSession(opts)           — pooled session for batch crawls
//                                          (saves ~3 sec/facility on startup overhead)
//
// Both return raw HTML strings. The scrapers' parser code is unchanged.
//
// Where Chromium comes from
// -------------------------
//   1. In-repo `puppeteer` package (bundled Chromium) — CI runs this, works
//      out of the box on Ubuntu runners after `npm install`.
//   2. Master-folder `_tools/pdf-gen/node_modules/puppeteer-core` + system
//      Chrome — Dan's local dev machine uses this, faster startup since
//      Chromium isn't bundled.
//   The adapter auto-detects and prefers the in-repo path. The toolchain
//   path is the fallback if `puppeteer` isn't installed (e.g., partial
//   dependency install).
//
// Proxy support
// -------------
//   Reads EXR_PROXY_HOST / EXR_PROXY_PORT / EXR_PROXY_USERNAME /
//   EXR_PROXY_PASSWORD env vars by default. Passes through to puppeteer
//   `--proxy-server` arg + `page.authenticate()`. The proxy is named
//   EXR_PROXY_* historically because EXR was the first PerimeterX-
//   protected operator; it works for any operator that benefits from
//   residential IP rotation.
//
// Anti-detection
// --------------
//   - --disable-blink-features=AutomationControlled — hides webdriver flag
//   - Real Chrome UA string — defeats trivial UA-based blocks
//   - Resource interception: blocks images/fonts/media for ~3x nav speed
//   - Inter-page settle delay before reading content

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOOLCHAIN_PATH = path.resolve(__dirname, "..", "..", "..", "_tools", "pdf-gen");

const SYSTEM_CHROME_PATHS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Puppeteer loader (in-repo preferred, toolchain fallback) ──────────────

let _puppeteerLib = null;
let _usingToolchain = null;

function loadPuppeteer() {
  if (_puppeteerLib) return { puppeteer: _puppeteerLib, usingToolchain: _usingToolchain };

  // 1. In-repo `puppeteer` (CI uses this — bundled Chromium)
  try {
    const requireInRepo = createRequire(import.meta.url);
    _puppeteerLib = requireInRepo("puppeteer");
    _usingToolchain = false;
    return { puppeteer: _puppeteerLib, usingToolchain: false };
  } catch (e) {
    /* fall through */
  }

  // 2. Toolchain `puppeteer-core` (Dan's local dev — system Chrome)
  try {
    const requireToolchain = createRequire(
      pathToFileURL(path.join(TOOLCHAIN_PATH, "package.json")).href
    );
    _puppeteerLib = requireToolchain("puppeteer-core");
    _usingToolchain = true;
    return { puppeteer: _puppeteerLib, usingToolchain: true };
  } catch (e) {
    /* fall through */
  }

  throw new Error(
    "Neither in-repo `puppeteer` nor toolchain `puppeteer-core` could be loaded. " +
      "Run `npm install puppeteer` in ps-acquisition-tracker, or ensure " +
      `${TOOLCHAIN_PATH}/node_modules/puppeteer-core exists.`
  );
}

function findSystemChrome() {
  for (const p of SYSTEM_CHROME_PATHS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

// ─── Launch (single browser instance) ──────────────────────────────────────

async function launchBrowser(opts = {}) {
  const {
    proxyHost = process.env.EXR_PROXY_HOST,
    proxyPort = process.env.EXR_PROXY_PORT,
    headful = false,
  } = opts;

  const { puppeteer, usingToolchain } = loadPuppeteer();

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu",
    "--window-size=1366,768",
  ];

  if (proxyHost && proxyPort) {
    args.push(`--proxy-server=http://${proxyHost}:${proxyPort}`);
  }

  const launchOpts = {
    headless: !headful,
    args,
    ignoreHTTPSErrors: true,
  };

  if (usingToolchain) {
    const chromePath = findSystemChrome();
    if (!chromePath) {
      throw new Error(
        "puppeteer-core loaded from toolchain but no system Chrome/Edge found in " +
          SYSTEM_CHROME_PATHS.join(", ")
      );
    }
    launchOpts.executablePath = chromePath;
  }

  return await puppeteer.launch(launchOpts);
}

async function configurePage(page, opts = {}) {
  const {
    userAgent = DEFAULT_UA,
    proxyUsername = process.env.EXR_PROXY_USERNAME,
    proxyPassword = process.env.EXR_PROXY_PASSWORD,
    blockResources = true,
    viewportWidth = 1366,
    viewportHeight = 768,
  } = opts;

  await page.setUserAgent(userAgent);
  await page.setViewport({ width: viewportWidth, height: viewportHeight });

  if (proxyUsername && proxyPassword) {
    await page.authenticate({ username: proxyUsername, password: proxyPassword });
  }

  if (blockResources) {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "image" || type === "font" || type === "media" || type === "stylesheet") {
        req.abort().catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });
  }
}

async function renderInPage(page, url, opts = {}) {
  const {
    waitForSelector = null,
    settleMs = 1500,
    navTimeoutMs = 30000,
  } = opts;

  let resp;
  try {
    resp = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: navTimeoutMs,
    });
  } catch (e) {
    return { status: 0, html: "", error: e.message };
  }

  const status = resp ? resp.status() : 0;

  if (waitForSelector) {
    try {
      await page.waitForSelector(waitForSelector, { timeout: settleMs * 4 });
    } catch {
      // Selector not found — return what we have. The scraper's parser
      // will handle empty or partial content gracefully.
    }
  }

  await new Promise((r) => setTimeout(r, settleMs));
  const html = await page.content();
  return { status, html };
}

// ─── Public API: one-shot render ───────────────────────────────────────────

/**
 * Render a URL through Puppeteer and return post-hydration HTML.
 * Each call launches and closes its own browser — use createBrowserSession()
 * for batch crawls to amortize the ~3 sec startup overhead.
 *
 * @param {string} url
 * @param {object} opts
 * @returns {Promise<{ status: number, html: string, error?: string }>}
 */
export async function renderHTML(url, opts = {}) {
  const browser = await launchBrowser(opts);
  try {
    const page = await browser.newPage();
    await configurePage(page, opts);
    return await renderInPage(page, url, opts);
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}

// ─── Public API: pooled browser session ────────────────────────────────────

/**
 * Create a long-lived browser session for batch crawls. Restarts the browser
 * every `restartEvery` requests to evict stale session cookies (helps with
 * PerimeterX, Cloudflare bot scoring, etc.).
 *
 * Usage:
 *   const session = await createBrowserSession({ proxyHost, proxyPort });
 *   for (const url of urls) {
 *     const { status, html } = await session.render(url);
 *     // ... parse html
 *   }
 *   await session.close();
 *
 * @param {object} opts
 * @returns {Promise<{ render: Function, close: Function }>}
 */
export async function createBrowserSession(opts = {}) {
  const { restartEvery = 25 } = opts;

  let browser = await launchBrowser(opts);
  let page = await browser.newPage();
  await configurePage(page, opts);
  let count = 0;

  async function fresh() {
    try {
      await browser.close();
    } catch {}
    browser = await launchBrowser(opts);
    page = await browser.newPage();
    await configurePage(page, opts);
    count = 0;
  }

  return {
    async render(url, perRenderOpts = {}) {
      if (count >= restartEvery) {
        await fresh();
      }
      count++;
      const result = await renderInPage(page, url, { ...opts, ...perRenderOpts });
      if (result.status === 403 || result.status === 429 || result.status === 503) {
        // Hostile response — restart browser to evict whatever's flagging us
        await fresh();
      }
      return result;
    },
    async close() {
      try {
        await browser.close();
      } catch {}
    },
    info() {
      return { usingToolchain: _usingToolchain, requestsThisBrowser: count };
    },
  };
}

// ─── Diagnostics ───────────────────────────────────────────────────────────

/**
 * One-shot probe for env diagnostics. Logs which puppeteer is loaded and
 * whether proxy + system Chrome are available. Run this before starting
 * a long crawl to confirm the environment is configured correctly.
 */
export async function diagnose() {
  const out = {
    nodeVersion: process.version,
    platform: process.platform,
    puppeteerLib: null,
    usingToolchain: null,
    systemChromePath: null,
    proxyConfigured: false,
  };
  try {
    const { puppeteer, usingToolchain } = loadPuppeteer();
    out.puppeteerLib = usingToolchain ? "puppeteer-core (toolchain)" : "puppeteer (in-repo)";
    out.usingToolchain = usingToolchain;
    out.systemChromePath = findSystemChrome();
  } catch (e) {
    out.error = e.message;
  }
  out.proxyConfigured = !!(process.env.EXR_PROXY_HOST && process.env.EXR_PROXY_PORT);
  return out;
}
