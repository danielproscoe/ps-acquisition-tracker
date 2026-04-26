#!/usr/bin/env node
/**
 * build-buyer-uw-profiles.mjs
 *
 * Derives the slim Buyer_UW_Profiles.json deliverable from the canonical
 * operator-matrix.json (v6, 49 operators). The slim view contains the
 * fields the routing engine actually consumes — geography, deal types,
 * size/price floors, hard-nos, tier/hot-capital — without the full
 * pitch/exec/source narrative.
 *
 * Source : ps-acquisition-tracker/public/operator-matrix.json
 * Output : #2 - PS/Reference Files/Buyer_UW_Profiles.json
 *
 * Re-run anytime operator-matrix.json updates.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const SRC = path.resolve(ROOT, 'public/operator-matrix.json');
const OUT = path.resolve(ROOT, '..', '#2 - PS', 'Reference Files', 'Buyer_UW_Profiles.json');

if (!fs.existsSync(SRC)) {
  console.error(`Source not found: ${SRC}`);
  process.exit(1);
}

const matrix = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const operators = matrix.operators || {};

const slim = {};
let included = 0;
let skipped = 0;

for (const [name, op] of Object.entries(operators)) {
  if (name.endsWith('_META')) continue;
  if (op.tier === 'DUPLICATE' || op.tier === 'ALIAS-SEE-StorageMart') { skipped++; continue; }

  const uw = op.uwProfile || {};
  const portfolio = op.portfolio || {};
  const capital = op.capital || {};
  const contacts = op.contacts || {};
  const primary = contacts.primary || {};

  slim[name] = {
    tier: op.tier || null,
    hotCapitalRank: op.hotCapitalRank || null,
    type: op.firmographics?.type || null,
    hq: op.firmographics?.hq || null,
    facilityCount: portfolio.facilityCount || null,
    states: portfolio.states || null,
    concentrations: portfolio.concentrations || null,
    newMarkets: portfolio.newMarkets2026 || portfolio.newMarkets || null,
    uwProfile: {
      dealTypes: uw.dealTypes || [],
      geography: uw.geography || [],
      sizeFloor: uw.sizeFloor || null,
      sizeCeiling: uw.sizeCeiling || null,
      priceLow: uw.priceLow || null,
      priceHigh: uw.priceHigh || null,
      productMix: uw.productMix || null,
      deploymentPressure: uw.deploymentPressure || null,
      decisionSpeedDays: uw.decisionSpeedDays || null,
      offMarketPreference: uw.offMarketPreference || null,
      hardNos: uw.hardNos || [],
      uniqueMoats: uw.uniqueMoats || null,
    },
    capital: {
      activeFund: capital.activeFund || null,
      fundSize: capital.fundSize || null,
      vintageClose: capital.vintageClose || null,
      remainingRunway: capital.remainingRunway || null,
      deploymentPace: capital.deploymentPace || null,
    },
    primaryContact: {
      name: primary.name || null,
      title: primary.title || null,
      email: primary.email || null,
      emailConfidence: primary.emailConfidence || null,
    },
    pitchHook: op.pitchHook || null,
    operationalFlag: op.operationalFlag || null,
    sig: op.sig || 'SiteScore',
  };
  included++;
}

const output = {
  schema: 'Buyer_UW_Profiles v1',
  derivedFrom: 'public/operator-matrix.json v' + (matrix.version || '?'),
  derivedAt: new Date().toISOString(),
  operatorCount: included,
  skipped,
  tierDefinitions: matrix.tierDefinitions || {},
  contactRoutingMeta: operators.CONTACT_ROUTING_META || null,
  doNotRouteMeta: operators.DO_NOT_ROUTE_META || null,
  tierMeta: operators.TIER_META || null,
  operators: slim,
};

const outDir = path.dirname(OUT);
if (!fs.existsSync(outDir)) {
  console.error(`Output directory not found: ${outDir}`);
  process.exit(1);
}
fs.writeFileSync(OUT, JSON.stringify(output, null, 2));
console.log(`Wrote ${OUT}`);
console.log(`Included ${included} operators · skipped ${skipped} (duplicates/aliases)`);

// Tier breakdown
const tierCounts = {};
for (const op of Object.values(slim)) {
  tierCounts[op.tier] = (tierCounts[op.tier] || 0) + 1;
}
console.log('\nTier breakdown:');
Object.entries(tierCounts).sort().forEach(([t, n]) => console.log(`  ${t.padEnd(20)} ${n}`));
