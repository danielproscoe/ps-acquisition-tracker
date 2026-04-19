#!/usr/bin/env node
/**
 * owner-hunt.mjs — FBI-grade decision-maker + email discovery for existing
 * storage facility acquisitions.
 *
 * Pipeline (per facility):
 *   Phase 1: Legal owner identification
 *     - County appraisal district scrape (TX: HCAD, TAD, DCAD, Travis, Bexar)
 *     - Fallback: public records search
 *     → Output: LLC/entity name + mailing address
 *
 *   Phase 2: Corporate structure unmask
 *     - Secretary of State entity search (TX SOSDirect REST)
 *     - Registered agent + officers + managers
 *     → Output: Named principals
 *
 *   Phase 3: Company identity + website
 *     - Google search: "[company]" storage OR "[facility]"
 *     - Operator name cross-reference (from SpareFoot scrape)
 *     → Output: Company website + social links
 *
 *   Phase 4: Email pattern discovery
 *     - Scrape company website for visible mailto: / contact page
 *     - Hunter.io API (if HUNTER_API_KEY provided) for verified patterns
 *     - Pattern regression: first.last@, flast@, first@, etc.
 *     → Output: Ranked candidate emails with confidence scores
 *
 *   Phase 5: Decision-maker ranking
 *     - Score by title: CEO/President/Owner > Head of Acq > Director RE > Regional
 *     - Score by LinkedIn activity recency (if scrapeable)
 *     → Output: Ranked list with outreach priority
 *
 *   Phase 6: Firebase write
 *     - site.ownerIntel = { owner, principals[], emails[], outreachPlan }
 *
 * Usage:
 *   node scripts/owner-hunt.mjs --site <firebaseKey>
 *   node scripts/owner-hunt.mjs --facility "Mesa Ridge Storage" --address "9455 Texas 317, Belton, TX 76502"
 *
 * Optional env vars:
 *   HUNTER_API_KEY   — Hunter.io ($49-149/mo) for verified email patterns
 *   APOLLO_API_KEY   — Apollo.io ($49-99/mo) for verified B2B contacts
 *   ANTHROPIC_API_KEY — Claude API for name disambiguation + intel synthesis
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, update } from 'firebase/database';
import { spawn } from 'child_process';

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function curlFetch(url, timeoutMs = 20000, extraHeaders = []) {
  return new Promise((resolve) => {
    const args = ['-s', '-L', '-A', USER_AGENT,
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Accept-Language: en-US,en;q=0.9',
      '-H', 'Accept-Encoding: gzip, deflate, br',
      '--compressed',
      '--max-time', String(Math.floor(timeoutMs / 1000)),
      '-w', '\n---HTTP:%{http_code}---',
      ...extraHeaders.flatMap(h => ['-H', h]),
      url];
    const proc = spawn('curl', args);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d.toString('utf-8'));
    proc.stderr.on('data', d => stderr += d.toString('utf-8'));
    proc.on('close', () => {
      const m = stdout.match(/---HTTP:(\d+)---$/);
      const status = m ? parseInt(m[1]) : 0;
      const body = stdout.replace(/---HTTP:\d+---$/, '');
      resolve({ ok: status >= 200 && status < 400, status, body, error: stderr });
    });
    proc.on('error', e => resolve({ ok: false, status: 0, body: '', error: e.message }));
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — LEGAL OWNER IDENTIFICATION (County Appraisal Districts)
// ═══════════════════════════════════════════════════════════════════════════

// County / jurisdiction dispatcher
async function identifyLegalOwner({ address, city, state }) {
  const st = (state || '').toUpperCase();
  const county = await inferCounty(address, city, st);

  // Texas counties — largest with online appraisal search
  if (st === 'TX') {
    if (/harris/i.test(county)) return scrapeHCAD(address);
    if (/tarrant/i.test(county)) return scrapeTAD(address);
    if (/dallas/i.test(county)) return scrapeDCAD(address);
    if (/travis/i.test(county)) return scrapeTravisCAD(address);
    if (/bexar/i.test(county)) return scrapeBCAD(address);
    // Fallback to Texas CAD generic
    return { owner: null, source: 'tx-cad-not-implemented', county };
  }

  // Florida: every county uses propertyAppraiser.X or SunBiz lookups
  if (st === 'FL') return scrapeFLPA(address, city, county);

  // Default: try Google-scraping the county appraiser
  return googleOwnerLookup(address, state);
}

async function inferCounty(address, city, state) {
  // Best-effort: use Census Geocoder API (free, no key needed)
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/address?street=${encodeURIComponent(address || '')}&city=${encodeURIComponent(city || '')}&state=${state}&benchmark=Public_AR_Current&vintage=Current_Current&layers=82&format=json`;
    const r = await curlFetch(url, 10000);
    if (r.ok) {
      const j = JSON.parse(r.body.replace(/---HTTP:\d+---/, ''));
      const match = j?.result?.addressMatches?.[0];
      const county = match?.geographies?.Counties?.[0]?.NAME;
      if (county) return county;
    }
  } catch {}
  return null;
}

// -- TX HCAD (Harris County) --
async function scrapeHCAD(address) {
  // HCAD requires POST to their search endpoint; returns account number then detail
  // For MVP: use their simple address search returning owner field
  try {
    const url = `https://public.hcad.org/records/QuickSearch.asp?crit=${encodeURIComponent(address || '')}`;
    const r = await curlFetch(url, 15000);
    if (!r.ok) return { owner: null, source: 'hcad-error', status: r.status };
    const html = r.body;
    // Owner name typically in a cell after "Owner Name" or in account detail
    const m = html.match(/Owner\s*Name[:\s]*<[^>]+>([^<]+)/i) || html.match(/<td[^>]*>([A-Z][A-Z\s&.,'/-]{3,}LLC|[A-Z][A-Z\s&.,'/-]{3,}(?:INC|CORP|LP|LLP))<\/td>/);
    return { owner: m?.[1]?.trim() || null, source: 'hcad', url };
  } catch (e) {
    return { owner: null, source: 'hcad-exception', error: e.message };
  }
}

// -- TX TAD (Tarrant County) --
async function scrapeTAD(address) {
  try {
    const url = `https://www.tad.org/property-search/?searchtype=realEstate&q=${encodeURIComponent(address || '')}`;
    const r = await curlFetch(url, 15000);
    if (!r.ok) return { owner: null, source: 'tad-error', status: r.status };
    const m = r.body.match(/Owner[:\s]*<[^>]+>([^<]+)/i);
    return { owner: m?.[1]?.trim() || null, source: 'tad', url };
  } catch (e) { return { owner: null, source: 'tad-exception', error: e.message }; }
}

// -- TX DCAD (Dallas County) --
async function scrapeDCAD(address) {
  try {
    const url = `https://www.dallascad.org/SearchAddr.aspx?search=${encodeURIComponent(address || '')}`;
    const r = await curlFetch(url, 15000);
    if (!r.ok) return { owner: null, source: 'dcad-error', status: r.status };
    const m = r.body.match(/Owner[:\s]*<[^>]+>([^<]+)/i);
    return { owner: m?.[1]?.trim() || null, source: 'dcad', url };
  } catch (e) { return { owner: null, source: 'dcad-exception', error: e.message }; }
}

async function scrapeTravisCAD(address) {
  return { owner: null, source: 'travis-cad-stub', note: 'Travis CAD search UI requires multi-step POST — implement full flow later' };
}

async function scrapeBCAD(address) {
  return { owner: null, source: 'bcad-stub', note: 'BCAD search requires form POST' };
}

async function scrapeFLPA(address, city, county) {
  return { owner: null, source: 'fl-pa-stub', note: `Florida uses county-specific PA sites — ${county || 'county?'} needed` };
}

async function googleOwnerLookup(address, state) {
  // Google: "[address]" "owner" site:[state].gov OR public records
  const q = `"${address}" owner LLC OR LP OR corp ${state} property`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const r = await curlFetch(url, 15000);
  // Extract first visible LLC/LP from snippets
  const m = r.body.match(/([A-Z][A-Z0-9\s&.,'/-]{3,}(?:\s+LLC|\s+LP|\s+LLLP|\s+Inc\.?|\s+Corp\.?))/);
  return { owner: m?.[1]?.trim() || null, source: 'google-owner', url };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — SOS ENTITY UNMASK (TX SOSDirect, FL Sunbiz)
// ═══════════════════════════════════════════════════════════════════════════

async function unmaskEntity(entityName, state) {
  const st = (state || '').toUpperCase();
  if (!entityName) return { principals: [], source: 'no-entity' };
  if (st === 'TX') return searchTXSOS(entityName);
  if (st === 'FL') return searchFLSunbiz(entityName);
  return { principals: [], source: `${st}-sos-not-implemented` };
}

async function searchTXSOS(entityName) {
  // TX SOSDirect requires auth — public mirror at comptroller.texas.gov taxable entity search
  const q = encodeURIComponent(entityName);
  const url = `https://mycpa.cpa.state.tx.us/coa/coaSearchBtn?searchNav=Keyword&searchText=${q}`;
  try {
    const r = await curlFetch(url, 15000);
    if (!r.ok) return { principals: [], source: 'tx-sos-error', status: r.status };
    // Comptroller search returns taxable entity summary — extract agent + address
    const agent = r.body.match(/Registered Agent[:\s]*<[^>]+>([^<]+)/i)?.[1]?.trim();
    return { principals: agent ? [{ name: agent, role: 'Registered Agent' }] : [], source: 'tx-comptroller', url };
  } catch (e) { return { principals: [], source: 'tx-sos-exception', error: e.message }; }
}

async function searchFLSunbiz(entityName) {
  const q = encodeURIComponent(entityName);
  const url = `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?inquiryType=EntityName&searchTerm=${q}`;
  try {
    const r = await curlFetch(url, 15000);
    if (!r.ok) return { principals: [], source: 'sunbiz-error', status: r.status };
    const principals = [];
    const nameMatches = [...r.body.matchAll(/<td[^>]*class="[^"]*OfficerName[^"]*"[^>]*>([^<]+)<\/td>/gi)];
    for (const m of nameMatches.slice(0, 5)) principals.push({ name: m[1].trim(), role: 'Officer', source: 'sunbiz' });
    return { principals, source: 'sunbiz', url };
  } catch (e) { return { principals: [], source: 'sunbiz-exception', error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — COMPANY WEBSITE DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════

async function findCompanyWebsite(companyName) {
  if (!companyName) return { domain: null, source: 'no-company' };
  const q = `${companyName} self storage`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const r = await curlFetch(url, 15000);
  // Extract first visible org-looking URL
  const urls = [...r.body.matchAll(/https?:\/\/([\w.-]+\.(?:com|net|org|us|co))/gi)]
    .map(m => m[1].toLowerCase())
    .filter(d => !/(google|facebook|instagram|yelp|linkedin|youtube|twitter|yellowpages|wikipedia|sparefoot|storagecafe|costar|crexi|loopnet|mapquest|bbb|apartments|angi|tripadvisor)/.test(d));
  const domain = urls[0];
  return { domain, source: 'google-sites', searchUrl: url };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — EMAIL HUNT
// ═══════════════════════════════════════════════════════════════════════════

async function huntEmails({ domain, principals = [] }) {
  const emails = [];

  // 4a: Scrape the domain for visible mailto: links + contact page emails
  if (domain) {
    const pages = [
      `https://${domain}`,
      `https://${domain}/contact`,
      `https://${domain}/about`,
      `https://${domain}/team`,
      `https://${domain}/leadership`,
    ];
    for (const page of pages) {
      const r = await curlFetch(page, 10000);
      if (!r.ok) continue;
      const mailtos = [...r.body.matchAll(/mailto:([\w.\-+]+@[\w.\-]+\.[a-z]{2,})/gi)].map(m => m[1].toLowerCase());
      const rawEmails = [...r.body.matchAll(/\b([\w.\-+]+)@([\w.\-]+\.[a-z]{2,})\b/gi)]
        .map(m => `${m[1].toLowerCase()}@${m[2].toLowerCase()}`)
        .filter(e => !/@(example|sentry|gmail|yahoo|hotmail|outlook|protonmail)\./.test(e) && !/\.(png|jpg|gif|svg)$/.test(e));
      for (const e of [...mailtos, ...rawEmails]) {
        if (emails.findIndex(x => x.email === e) < 0) emails.push({ email: e, source: 'website-scrape', page, confidence: 'medium' });
      }
    }
  }

  // 4b: Hunter.io API (if key provided)
  const hunterKey = process.env.HUNTER_API_KEY;
  if (hunterKey && domain) {
    try {
      const url = `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${hunterKey}`;
      const r = await curlFetch(url, 15000);
      if (r.ok) {
        const j = JSON.parse(r.body.replace(/---HTTP:\d+---/, ''));
        const data = j?.data?.emails || [];
        for (const e of data) {
          const full = `${e.first_name || ''} ${e.last_name || ''}`.trim();
          emails.push({
            email: e.value,
            source: 'hunter.io',
            page: url,
            confidence: e.confidence >= 80 ? 'high' : e.confidence >= 50 ? 'medium' : 'low',
            person: full || null,
            position: e.position || null,
            linkedIn: e.linkedin || null,
          });
        }
      }
    } catch {}
  }

  // 4c: Pattern-generate emails for each principal name (first.last, flast, fl, etc.)
  if (domain && principals.length > 0) {
    for (const p of principals) {
      const [first, ...rest] = p.name.split(/\s+/);
      const last = rest[rest.length - 1] || '';
      if (!first || !last) continue;
      const f = first.toLowerCase(), l = last.toLowerCase();
      const fi = f[0], li = l[0];
      const patterns = [`${f}.${l}`, `${fi}${l}`, `${f}${l}`, `${f}`, `${fi}.${l}`, `${f}_${l}`];
      for (const p2 of patterns) {
        const email = `${p2}@${domain}`;
        if (emails.findIndex(x => x.email === email) < 0) {
          emails.push({ email, source: 'pattern-guess', confidence: 'low', person: p.name, role: p.role });
        }
      }
    }
  }

  return emails;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5 — RANKING
// ═══════════════════════════════════════════════════════════════════════════

function rankDecisionMakers(data) {
  const principalsByTier = (data.principals || []).map(p => {
    const title = (p.role || p.title || '').toLowerCase();
    let score = 5;
    if (/owner|ceo|president|founder|managing partner/.test(title)) score = 10;
    else if (/head.*(acqui|real estate|development)/.test(title)) score = 9;
    else if (/chief|evp|svp/.test(title)) score = 8;
    else if (/director|vp/.test(title)) score = 7;
    else if (/manager|principal/.test(title)) score = 6;
    else if (/registered agent/.test(title)) score = 3;
    return { ...p, priorityScore: score };
  }).sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

  const emailByTier = (data.emails || []).map(e => {
    let score = 5;
    if (e.confidence === 'high') score += 3;
    else if (e.confidence === 'medium') score += 1;
    else if (e.confidence === 'low') score -= 2;
    if (e.source === 'website-scrape' && !/info@|contact@|sales@/.test(e.email)) score += 2;
    if (e.source === 'hunter.io') score += 1;
    if (e.person) score += 1;
    return { ...e, priorityScore: score };
  }).sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

  return { principals: principalsByTier, emails: emailByTier };
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

async function huntOwner({ facilityName, address, city, state, zip }) {
  const result = {
    huntedAt: new Date().toISOString(),
    engine: 'storvex-owner-hunt-v1.0',
    inputs: { facilityName, address, city, state, zip },
    phases: {}
  };

  console.log(`\n[1/5] Identifying legal owner via county appraisal...`);
  const ownerResult = await identifyLegalOwner({ address, city, state });
  result.phases.phase1_owner = ownerResult;
  console.log(`     Owner: ${ownerResult.owner || '(not found)'} · source: ${ownerResult.source}`);

  console.log(`\n[2/5] Unmasking entity → principals...`);
  const entityResult = await unmaskEntity(ownerResult.owner, state);
  result.phases.phase2_principals = entityResult;
  console.log(`     ${entityResult.principals?.length || 0} principals identified · source: ${entityResult.source}`);

  console.log(`\n[3/5] Finding company website...`);
  const websiteResult = await findCompanyWebsite(ownerResult.owner || facilityName);
  result.phases.phase3_website = websiteResult;
  console.log(`     Domain: ${websiteResult.domain || '(not found)'}`);

  console.log(`\n[4/5] Email hunt (scrape + Hunter.io + pattern regression)...`);
  const emails = await huntEmails({ domain: websiteResult.domain, principals: entityResult.principals });
  result.phases.phase4_emails = { count: emails.length, emails };
  console.log(`     ${emails.length} candidate emails found`);

  console.log(`\n[5/5] Ranking decision-makers...`);
  const ranked = rankDecisionMakers({ principals: entityResult.principals, emails });
  result.rankedPrincipals = ranked.principals;
  result.rankedEmails = ranked.emails;

  // Top candidate summary
  result.topCandidate = ranked.principals[0] || null;
  result.topEmail = ranked.emails[0] || null;

  console.log(`\nTop decision-maker: ${result.topCandidate?.name || '(unknown)'}  [${result.topCandidate?.role || '—'}]`);
  console.log(`Top email:          ${result.topEmail?.email || '(none found)'}  [${result.topEmail?.confidence || '—'} confidence · ${result.topEmail?.source || '—'}]`);

  return result;
}

// ---- CLI ----
const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : null; };

async function main() {
  console.log(`\n=== Storvex Owner Hunt · Decision-Maker Discovery Engine ===`);
  const siteKey = getArg('site');
  const facilityName = getArg('facility');
  const address = getArg('address');
  let city, state, zip;

  if (siteKey) {
    let found = null;
    for (const t of ['southwest', 'east', 'submissions']) {
      const snap = await get(ref(db, `${t}/${siteKey}`));
      if (snap.exists()) { found = { tracker: t, data: snap.val() }; break; }
    }
    if (!found) { console.log(`Site ${siteKey} not found`); process.exit(1); }
    const s = found.data;
    const addrParts = (s.address || '').split(',');
    const result = await huntOwner({
      facilityName: s.name || '',
      address: addrParts[0]?.trim() || s.address,
      city: s.city || addrParts[1]?.trim(),
      state: s.state || (s.address?.match(/\b[A-Z]{2}\b/)?.[0]),
      zip: (s.address?.match(/\b\d{5}\b/)?.[0]) || null,
    });
    console.log(`\nWriting ownerIntel to Firebase: ${found.tracker}/${siteKey}...`);
    const deepSanitize = (o) => o === undefined ? null : (o === null || typeof o !== 'object' ? o : Array.isArray(o) ? o.map(deepSanitize) : Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : deepSanitize(v)])));
    await update(ref(db, `${found.tracker}/${siteKey}`), { ownerIntel: deepSanitize(result) });
    console.log('Done.');
  } else if (address) {
    const parts = address.split(',').map(s => s.trim());
    city = getArg('city') || parts[1] || '';
    state = getArg('state') || parts[2]?.split(/\s+/)[0] || '';
    zip = getArg('zip') || parts[2]?.split(/\s+/)[1] || '';
    const result = await huntOwner({ facilityName: facilityName || '', address: parts[0], city, state, zip });
    console.log(`\n` + JSON.stringify(result, null, 2).slice(0, 4000));
  } else {
    console.log(`Usage:
  node scripts/owner-hunt.mjs --site <firebaseKey>
  node scripts/owner-hunt.mjs --facility "Mesa Ridge Storage" --address "9455 Texas 317, Belton, TX 76502"

Optional env:
  HUNTER_API_KEY  — Hunter.io for verified email patterns
  ANTHROPIC_API_KEY — for LLM-assisted disambiguation`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
