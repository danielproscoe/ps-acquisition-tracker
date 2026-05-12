// refresh-county-permits.mjs — orchestrator for all per-county permit
// scrapers. Runs each in sequence, aggregates summary output, exits non-zero
// if any required automated scraper failed (manual-ingest scrapers always
// "succeed" with 0 records when no --ingest is provided).
//
// CRUSH-RADIUS-PLUS AUDIT-LAYER PIVOT · 5/12/26 EOD architecture is live
// (commit `bb64881`). This sprint adds the data-ingestion engine — one
// scraper per pilot county feeding the shared county-permits.json registry
// that the Verification Oracle multi-source query already consumes.
//
// AUTOMATED VS MANUAL classification:
//
//   Denton TX   · AUTOMATED · vanilla HTTPS · runs in daily cron
//   Warren OH   · MANUAL    · reCAPTCHA-gated iWorQ portal · --ingest=<csv>
//   Kenton KY   · MANUAL    · Orchard Core CSRF · --ingest=<csv>
//   Boone IN    · MANUAL    · no online portal · --ingest=<json> records request
//   Hancock IN  · MANUAL    · no online portal · --ingest=<json> records request
//
// In daily-cron mode (no --ingest paths supplied), only Denton TX runs an
// actual scrape; the other four invoke their portal-probe / contact-info
// path. This is the correct Phase 1 behavior — the daily cron keeps Denton's
// recent permits flowing into the Oracle while the manual-ingest counties
// run on a quarterly Dan-driven cycle.
//
// CLI
// ---
//   node refresh-county-permits.mjs               · daily mode (Denton only)
//   node refresh-county-permits.mjs --all         · run every scraper
//   node refresh-county-permits.mjs --county=denton-tx [args passed through]
//   node refresh-county-permits.mjs --ingest-dir=./permit-batches
//                                                 · auto-discover ingest files
//                                                   named <county-slug>.<csv|json>
//   node refresh-county-permits.mjs --dryrun      · no writes
//
// Exit codes:
//   0 · all attempted scrapers exited 0
//   1 · one or more scrapers errored
//   2 · invalid CLI args

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRAPERS = [
  {
    slug: "denton-tx",
    file: "scrape-county-permits-denton-tx.mjs",
    automated: true,
    description: "Denton County, TX · apps.dentoncounty.gov/DevPermit/ (ASP.NET RadGrid)",
  },
  {
    slug: "warren-oh",
    file: "scrape-county-permits-warren-oh.mjs",
    automated: false,
    description: "Warren County, OH · warrencountyoh.portal.iworq.net (iWorQ + reCAPTCHA)",
  },
  {
    slug: "kenton-ky",
    file: "scrape-county-permits-kenton-ky.mjs",
    automated: false,
    description:
      "Kenton County, KY · pdskc.govbuilt.com/ActivitySearchTool (GovBuilt + Orchard Core)",
  },
  {
    slug: "boone-in",
    file: "scrape-county-permits-boone-in.mjs",
    automated: false,
    description: "Boone County, IN · paper records · Area Plan Commission",
  },
  {
    slug: "hancock-in",
    file: "scrape-county-permits-hancock-in.mjs",
    automated: false,
    description: "Hancock County, IN · paper records · Planning & Building",
  },
];

// ─── Run a single scraper ──────────────────────────────────────────────────

function runScraper(scraper, args, opts = {}) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, scraper.file);
    if (!fs.existsSync(scriptPath)) {
      console.error(`[orchestrator] missing scraper file: ${scriptPath}`);
      resolve({ slug: scraper.slug, code: 127, stdout: "", stderr: "missing file" });
      return;
    }

    console.log("");
    console.log("═".repeat(72));
    console.log(`▸ ${scraper.slug} · ${scraper.description}`);
    console.log("═".repeat(72));

    const proc = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: opts.cwd || __dirname,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(s);
    });
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(s);
    });
    proc.on("close", (code) => {
      resolve({ slug: scraper.slug, code, stdout, stderr });
    });
  });
}

// ─── Ingest-dir auto-discovery ─────────────────────────────────────────────

function findIngestFor(slug, ingestDir) {
  if (!ingestDir) return null;
  const dir = path.resolve(ingestDir);
  if (!fs.existsSync(dir)) return null;
  const candidates = [`${slug}.csv`, `${slug}.json`, `${slug}-batch.json`];
  for (const c of candidates) {
    const full = path.join(dir, c);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    all: false,
    onlyCounty: null,
    ingestDir: null,
    dryRun: false,
    passthrough: [],
  };
  for (const a of args) {
    if (a === "--all") opts.all = true;
    else if (a === "--dryrun" || a === "--dry-run") opts.dryRun = true;
    else if (a.startsWith("--county=")) opts.onlyCounty = a.split("=")[1];
    else if (a.startsWith("--ingest-dir=")) opts.ingestDir = a.split("=")[1];
    else opts.passthrough.push(a);
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  console.log("┌───────────────────────────────────────────────────────────────────────┐");
  console.log("│ County Permit Refresh Orchestrator                                    │");
  console.log("│ Audit-Layer Verification Oracle · PERMIT primary-source registry      │");
  console.log(`│ Mode: ${opts.all ? "ALL SCRAPERS" : opts.onlyCounty ? `ONLY ${opts.onlyCounty}` : "DAILY (automated only)"}${" ".repeat(Math.max(0, 47 - String(opts.all ? "ALL SCRAPERS" : opts.onlyCounty ? `ONLY ${opts.onlyCounty}` : "DAILY (automated only)").length))}│`);
  console.log("└───────────────────────────────────────────────────────────────────────┘");

  let targets;
  if (opts.onlyCounty) {
    targets = SCRAPERS.filter((s) => s.slug === opts.onlyCounty);
    if (targets.length === 0) {
      console.error(
        `[orchestrator] unknown county slug "${opts.onlyCounty}" · valid: ${SCRAPERS.map((s) => s.slug).join(", ")}`
      );
      process.exit(2);
    }
  } else if (opts.all) {
    targets = SCRAPERS;
  } else {
    // Daily mode — only the automated scrapers
    targets = SCRAPERS.filter((s) => s.automated);
    console.log(
      `[orchestrator] daily mode · running ${targets.length} automated scraper(s) only · use --all to include manual-ingest scrapers`
    );
  }

  const results = [];
  for (const scraper of targets) {
    const args = [...opts.passthrough];
    if (opts.dryRun) args.push("--dryrun");

    // Auto-discover ingest file if --ingest-dir was supplied
    const autoIngest = findIngestFor(scraper.slug, opts.ingestDir);
    if (autoIngest && !args.some((a) => a.startsWith("--ingest="))) {
      args.push(`--ingest=${autoIngest}`);
      console.log(`[orchestrator] auto-ingest: ${scraper.slug} ← ${autoIngest}`);
    }

    const r = await runScraper(scraper, args);
    results.push(r);
  }

  console.log("");
  console.log("┌───────────────────────────────────────────────────────────────────────┐");
  console.log("│ Orchestrator summary                                                  │");
  console.log("└───────────────────────────────────────────────────────────────────────┘");

  let anyFailed = false;
  for (const r of results) {
    const ok = r.code === 0 ? "✓" : "✗";
    if (r.code !== 0) anyFailed = true;
    console.log(`  ${ok} ${r.slug} · exit=${r.code}`);
  }

  process.exit(anyFailed ? 1 : 0);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("refresh-county-permits.mjs");

if (isMain) {
  main().catch((e) => {
    console.error(`[orchestrator] FATAL: ${e.stack || e.message}`);
    process.exit(1);
  });
}

export { SCRAPERS, runScraper, findIngestFor };
