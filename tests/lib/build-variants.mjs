// Builds the site variants used by tests and the render check.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { computeRanking } from '../../scripts/lib/score.mjs';
import { randomProfile, writeEdgeDir } from './fixtures.mjs';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const T = path.join(ROOT, '.out', 'test');

function build(env) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'delta.mjs')], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'pipe' });
}

let cached = null;

/** Real data; uses data/ranking.json when present, otherwise a ranking from a random profile. */
export function buildReal(env = {}, out = path.join(T, 'real')) {
  let rankingFile = path.join(ROOT, 'data', 'ranking.json');
  if (!fs.existsSync(rankingFile) && cached) rankingFile = cached;
  else if (!fs.existsSync(rankingFile)) {
    const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
    const res = computeRanking(randomProfile(), read('vendors.json').vendors, read('metrics.json'), null);
    fs.mkdirSync(T, { recursive: true });
    rankingFile = path.join(T, 'ranking-real.json');
    fs.writeFileSync(rankingFile, JSON.stringify(res));
    cached = rankingFile;
  }
  build({ OUT_DIR: out, RANKING_FILE: rankingFile, ...env });
  return out;
}

export function buildEdge(out = path.join(T, 'edge')) {
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site.json'), 'utf8'));
  const dataDir = path.join(T, 'edge-data');
  const info = writeEdgeDir(dataDir, site);
  build({ OUT_DIR: out, DATA_DIR: dataDir, RANKING_FILE: '' });
  return { out, ...info };
}
