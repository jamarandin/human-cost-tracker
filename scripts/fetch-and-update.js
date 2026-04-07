#!/usr/bin/env node
/**
 * fetch-and-update.js
 *
 * Checks source URLs for updates and optionally writes new values to
 * data/casualties.json. Also copies JSON files into docs/data/ so they
 * are served by GitHub Pages.
 *
 * Usage:
 *   node scripts/fetch-and-update.js               # check sources, copy to docs/data/
 *   node scripts/fetch-and-update.js --check-only  # check without writing
 *   node scripts/fetch-and-update.js --set iran.reportedDeaths.raw=2100 --set iran.reportedDeaths.display=">2,100"
 *   node scripts/fetch-and-update.js --validate    # validate JSON schema only
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const ROOT          = path.resolve(__dirname, '..');
const CASUALTIES    = path.join(ROOT, 'data', 'casualties.json');
const SOURCES_FILE  = path.join(ROOT, 'data', 'sources.json');
const DOCS_DATA_DIR = path.join(ROOT, 'docs', 'data');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args      = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check-only');
const VALIDATE   = args.includes('--validate');
const SET_FLAGS  = args
  .filter((a) => a.startsWith('--set'))
  .map((a) => {
    const val = a.startsWith('--set=') ? a.slice(6) : args[args.indexOf(a) + 1];
    return val;
  })
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Set a deep key on an object using dot-notation.
 * e.g. setDeep(obj, 'iran.reportedDeaths.raw', 2100)
 */
function setDeep(obj, dotPath, value) {
  const keys = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]]) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * Lightweight HEAD request — returns { ok, status, lastModified }.
 */
function headRequest(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, { method: 'HEAD', timeout: 10000 }, (res) => {
      resolve({
        ok:           res.statusCode >= 200 && res.statusCode < 400,
        status:       res.statusCode,
        lastModified: res.headers['last-modified'] || null,
        etag:         res.headers['etag'] || null,
      });
    });
    req.on('error', () => resolve({ ok: false, status: 0, lastModified: null, etag: null }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, lastModified: null, etag: null }); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateCasualties(data) {
  const errors = [];

  if (!data.lastUpdated) errors.push('Missing lastUpdated');
  if (!data.metrics)     errors.push('Missing metrics block');
  if (!data.bars)        errors.push('Missing bars block');
  if (!data.tree)        errors.push('Missing tree block');

  const requiredMetrics = [
    'hero.children',
    'iran.reportedDeaths',
    'iran.reportedInjured',
    'iran.confirmedCivilian',
    'iran.children',
    'lebanon.reportedDeaths',
    'lebanon.children',
    'us.militaryDeaths',
    'us.militaryWounded',
  ];

  if (data.metrics) {
    requiredMetrics.forEach((key) => {
      if (!data.metrics[key])          errors.push(`Missing metric: ${key}`);
      else if (!data.metrics[key].display) errors.push(`Metric ${key} missing display`);
      else if (data.metrics[key].raw == null) errors.push(`Metric ${key} missing raw`);
    });
  }

  // Cross-check: children ≤ confirmedCivilian ≤ reportedDeaths
  if (data.metrics) {
    const m = data.metrics;
    if (m['iran.children'] && m['iran.confirmedCivilian']) {
      if (m['iran.children'].raw > m['iran.confirmedCivilian'].raw) {
        errors.push('LOGIC ERROR: iran.children.raw > iran.confirmedCivilian.raw');
      }
    }
    if (m['iran.confirmedCivilian'] && m['iran.reportedDeaths']) {
      if (m['iran.confirmedCivilian'].raw > m['iran.reportedDeaths'].raw) {
        errors.push('LOGIC ERROR: iran.confirmedCivilian.raw > iran.reportedDeaths.raw');
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Copy data files to docs/data/
// ---------------------------------------------------------------------------
function syncToDocsData() {
  if (!fs.existsSync(DOCS_DATA_DIR)) {
    fs.mkdirSync(DOCS_DATA_DIR, { recursive: true });
  }
  fs.copyFileSync(CASUALTIES,   path.join(DOCS_DATA_DIR, 'casualties.json'));
  fs.copyFileSync(SOURCES_FILE, path.join(DOCS_DATA_DIR, 'sources.json'));
  console.log('[sync] Copied data/*.json → docs/data/');
}

// ---------------------------------------------------------------------------
// Apply --set flags
// ---------------------------------------------------------------------------
function applySetFlags(data, flags) {
  flags.forEach((flag) => {
    const eqIdx = flag.indexOf('=');
    if (eqIdx === -1) {
      console.warn(`[set] Ignoring malformed flag (no =): ${flag}`);
      return;
    }
    const keyPath = flag.slice(0, eqIdx);
    let   rawVal  = flag.slice(eqIdx + 1);

    // Try to parse numbers and booleans
    let value = rawVal;
    if (!isNaN(rawVal) && rawVal !== '') value = Number(rawVal);
    else if (rawVal === 'true')          value = true;
    else if (rawVal === 'false')         value = false;

    setDeep(data, keyPath, value);
    console.log(`[set] ${keyPath} = ${JSON.stringify(value)}`);
  });
}

// ---------------------------------------------------------------------------
// Check source URLs
// ---------------------------------------------------------------------------
async function checkSources(sourcesData, casualties) {
  const results = [];
  for (const src of sourcesData.sources) {
    process.stdout.write(`[check] ${src.id} (${src.url}) … `);
    const res = await headRequest(src.url);
    const status = res.ok ? '✓ OK' : `✗ HTTP ${res.status}`;
    console.log(status + (res.lastModified ? `  last-modified: ${res.lastModified}` : ''));
    results.push({ id: src.id, ...res });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Update lastUpdated and conflictDays
// ---------------------------------------------------------------------------
function stampDate(data) {
  const today = new Date().toISOString().slice(0, 10);
  data.lastUpdated = today;

  if (data.conflictStart) {
    const start = new Date(data.conflictStart);
    const now   = new Date(today);
    const days  = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    data.conflictDays = days;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Human Cost Tracker — data updater ===\n');

  let casualties = readJSON(CASUALTIES);
  const sourcesData = readJSON(SOURCES_FILE);

  // --validate only
  if (VALIDATE) {
    const errors = validateCasualties(casualties);
    if (errors.length === 0) {
      console.log('[validate] ✓ casualties.json is valid');
    } else {
      console.error('[validate] ERRORS:');
      errors.forEach((e) => console.error('  •', e));
      process.exit(1);
    }
    return;
  }

  // Apply manual --set overrides first
  if (SET_FLAGS.length > 0) {
    console.log('[set] Applying manual overrides…');
    applySetFlags(casualties, SET_FLAGS);
    stampDate(casualties);
  }

  // Check source URLs (skip in check-only if we also have set flags)
  if (!SET_FLAGS.length) {
    console.log('[check] Pinging source URLs…');
    await checkSources(sourcesData, casualties);
    console.log();
    console.log('[info] To update a value, run:');
    console.log('  node scripts/fetch-and-update.js --set metrics.iran.reportedDeaths.raw=2100 --set metrics.iran.reportedDeaths.display=">2,100"');
    console.log();
  }

  // Validate
  const errors = validateCasualties(casualties);
  if (errors.length > 0) {
    console.error('[validate] Errors in casualties.json — aborting write:');
    errors.forEach((e) => console.error('  •', e));
    process.exit(1);
  }

  if (CHECK_ONLY) {
    console.log('[info] --check-only flag set, skipping write.');
    return;
  }

  // Stamp date and write
  stampDate(casualties);
  writeJSON(CASUALTIES, casualties);
  console.log(`[write] data/casualties.json updated (lastUpdated: ${casualties.lastUpdated})`);

  // Sync to docs/data/
  syncToDocsData();

  console.log('\n[done] All steps complete.');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
