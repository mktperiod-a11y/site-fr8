// Computes the ranking from the latest metrics snapshot.
// The scoring profile comes from the SCORE_PROFILE environment variable (or --profile <file> locally)
// and must match one of the hashes in data/profile.sha256.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { readJSON, writeJSON, ROOT } from './lib/util.mjs';
import path from 'node:path';
import { computeRanking } from './lib/score.mjs';

const HISTORY_KEEP = 90;
const inCI = !!process.env.GITHUB_ACTIONS;

function fail(msg) {
  console.log(inCI ? `::error::${msg}` : `error: ${msg}`);
  process.exit(1);
}

let rawProfile = process.env.SCORE_PROFILE || '';
const fi = process.argv.indexOf('--profile');
if (!rawProfile && fi > 0 && !inCI) rawProfile = fs.readFileSync(process.argv[fi + 1], 'utf8');
rawProfile = rawProfile.trim();

if (!rawProfile) {
  if (inCI) fail('scoring profile is empty; ranking not computed');
  console.log('warning: scoring profile not provided; skipped (local run)');
  process.exit(0);
}

const hash = createHash('sha256').update(rawProfile).digest('hex');
const allowed = fs
  .readFileSync(path.join(ROOT, 'data', 'profile.sha256'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => /^[0-9a-f]{64}$/.test(l));
if (!allowed.includes(hash)) fail('scoring profile hash does not match; ranking not computed');

let profile;
try {
  profile = JSON.parse(rawProfile);
} catch {
  fail('scoring profile is not valid JSON');
}

// local previews may write somewhere other than data/
const oi = process.argv.indexOf('--out');
const outDir = oi > 0 && !inCI ? path.resolve(process.argv[oi + 1]) : path.join(ROOT, 'data');
const outFile = (f) => path.join(outDir, f);

const { vendors } = readJSON('data/vendors.json');
const store = readJSON('data/metrics.json');
const history = readJSON(outFile('history.json'), { runs: [] });
const date = store.snapshots.at(-1)?.date;
const prev = history.runs.filter((r) => r.date < date).at(-1) || null;

const result = computeRanking(profile, vendors, store, prev);

history.runs = history.runs.filter((r) => r.date !== result.date);
history.runs.push({ date: result.date, scale: result.scale, list: result.list.map(({ id, rank, total, items }) => ({ id, rank, total, items })) });
history.runs = history.runs.slice(-HISTORY_KEEP);

writeJSON(outFile('ranking.json'), result);
writeJSON(outFile('history.json'), history);
if (!fs.existsSync(outFile('baseline.json'))) writeJSON(outFile('baseline.json'), result);

const filled = result.notes.filter((n) => n.endsWith(':filled')).length;
console.log(`ranked ${result.list.length}, waiting ${result.pending.length}, median-filled values ${filled}`);
