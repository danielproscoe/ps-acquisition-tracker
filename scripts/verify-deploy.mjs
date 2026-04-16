#!/usr/bin/env node
// ─── Deployment Verification Script ───
// Checks Vercel deployment status after every push.
// Usage: node scripts/verify-deploy.mjs [--wait] [--project storvex|sitescore]
//
// --wait     Poll until the latest deployment reaches READY or ERROR (default: single check)
// --project  Which project to check (default: storvex)
//
// Exit codes:
//   0 = latest deployment is READY and live in production
//   1 = latest deployment is in ERROR state (build failed)
//   2 = deployment still building (only without --wait)
//   3 = configuration error (missing token, etc.)

import https from 'https';

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const TEAM_ID = 'team_OrZvQJswiVJByudBekMRvD5H';
const PROJECTS = {
  storvex: 'prj_sxvzunTctiTmg2eo1X8ZX6iK8FHO',
  sitescore: 'prj_mnrORSTxEhFDmucHbnrXb1Vleqe6',
};

const args = process.argv.slice(2);
const shouldWait = args.includes('--wait');
const projectArg = args.find(a => a !== '--wait' && !a.startsWith('--'))
  || (args.includes('--project') ? args[args.indexOf('--project') + 1] : 'storvex');
const projectId = PROJECTS[projectArg] || PROJECTS.storvex;

if (!VERCEL_TOKEN) {
  console.error('ERROR: VERCEL_TOKEN environment variable not set.');
  console.error('Set it with: export VERCEL_TOKEN=your_token_here');
  process.exit(3);
}

function vercelGet(path) {
  return new Promise((resolve, reject) => {
    const url = `https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${TEAM_ID}`;
    const req = https.get(url, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
  });
}

async function getLatestDeployments() {
  const data = await vercelGet(`/v6/deployments?projectId=${projectId}&limit=5`);
  return data.deployments || [];
}

function formatDeploy(d) {
  const age = Math.round((Date.now() - d.created) / 60000);
  const commit = d.meta?.githubCommitMessage?.split('\n')[0]?.slice(0, 60) || 'no commit msg';
  const branch = d.meta?.githubCommitRef || '?';
  const target = d.target || 'preview';
  return `  ${d.state.padEnd(8)} | ${target.padEnd(10)} | ${branch.padEnd(8)} | ${age}m ago | ${commit}`;
}

async function checkDeployments() {
  const deps = await getLatestDeployments();
  if (!deps.length) {
    console.error('No deployments found.');
    return 2;
  }

  console.log(`\n── ${projectArg.toUpperCase()} Deployment Status ──\n`);
  console.log('  STATE    | TARGET     | BRANCH   | AGE     | COMMIT');
  console.log('  ' + '─'.repeat(70));
  deps.forEach(d => console.log(formatDeploy(d)));

  // Find latest production deployment
  const latestProd = deps.find(d => d.target === 'production');
  const latest = deps[0];

  console.log('');

  if (latest.state === 'ERROR') {
    console.error(`DEPLOY FAILED: Latest build (${latest.meta?.githubCommitRef}) is in ERROR state.`);
    console.error(`  Commit: ${latest.meta?.githubCommitMessage?.split('\n')[0]}`);
    console.error(`  Inspect: ${latest.inspectorUrl}`);
    console.error('\n  Action: Check build logs → fix failing tests → push again.');
    return 1;
  }

  if (latest.state === 'BUILDING' || latest.state === 'QUEUED' || latest.state === 'INITIALIZING') {
    console.log(`BUILD IN PROGRESS: ${latest.state} (${latest.meta?.githubCommitRef})`);
    if (!shouldWait) {
      console.log('  Run with --wait to poll until complete.');
      return 2;
    }
  }

  if (latestProd && latestProd.state === 'READY') {
    const age = Math.round((Date.now() - latestProd.created) / 60000);
    console.log(`PRODUCTION LIVE: ${latestProd.meta?.githubCommitRef} branch`);
    console.log(`  Deployed ${age}m ago`);
    console.log(`  Commit: ${latestProd.meta?.githubCommitMessage?.split('\n')[0]}`);
    console.log(`  URL: ${latestProd.url}`);

    // Check if latest push matches latest production
    const latestSha = deps[0].meta?.githubCommitSha;
    const prodSha = latestProd.meta?.githubCommitSha;
    if (latestSha && prodSha && latestSha !== prodSha) {
      console.log(`\n  WARNING: Latest push (${latestSha.slice(0,7)}) is NOT the live production deploy.`);
      console.log(`  Production is on: ${prodSha.slice(0,7)}`);
      const behind = deps.filter(d => d.created > latestProd.created).length;
      console.log(`  Production is ${behind} deployment(s) behind HEAD.`);
    }
    return 0;
  }

  console.log('No READY production deployment found in recent deployments.');
  return 2;
}

async function main() {
  if (shouldWait) {
    const maxAttempts = 30; // 5 minutes max
    for (let i = 0; i < maxAttempts; i++) {
      const deps = await getLatestDeployments();
      const latest = deps[0];
      if (latest.state === 'READY' || latest.state === 'ERROR') {
        return checkDeployments();
      }
      process.stdout.write(`  Building... (${i * 10}s)\r`);
      await new Promise(r => setTimeout(r, 10000));
    }
    console.error('Timeout: Build did not complete in 5 minutes.');
    return 2;
  }
  return checkDeployments();
}

main().then(code => process.exit(code)).catch(err => {
  console.error('Error:', err.message);
  process.exit(3);
});
