// Reads promotional phrases from each vendor's public pages and proposes perk text updates.
// Writes data/vendors.json only when the set of perks changed. Logs counts only.
import fs from 'node:fs';
import { readJSON, writeJSON, UA, sleep } from './lib/util.mjs';
import { extractPerks, mergePerks, samePerks } from './lib/perk-text.mjs';

const data = readJSON('data/vendors.json');
const stats = { read: 0, empty: 0, failed: 0, changed: 0 };

async function fetchDecoded(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'ko-KR' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const head = buf.subarray(0, 4096).toString('latin1');
    const type = res.headers.get('content-type') || '';
    const cs = (type.match(/charset=([\w-]+)/i) || head.match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
    return new TextDecoder(/euc-?kr|ks_c_5601|cp949/i.test(cs) ? 'euc-kr' : 'utf-8').decode(buf);
  } finally {
    clearTimeout(t);
  }
}

for (const v of data.vendors) {
  if (v.status !== 'active' || !v.url) continue;
  const pages = v.perkPages?.length ? v.perkPages : [v.url];
  let html = '';
  let ok = 0;
  for (const p of pages) {
    try {
      html += '\n' + (await fetchDecoded(p));
      ok++;
    } catch {
      /* counted below */
    }
    await sleep(700);
  }
  if (!ok) {
    stats.failed++;
    continue;
  }
  const found = extractPerks(html);
  if (!found.length) {
    stats.empty++;
    continue;
  }
  stats.read++;
  const merged = mergePerks(found, v.perks || []);
  if (!samePerks(merged, v.perks || [])) {
    v.perks = merged;
    stats.changed++;
  }
}

if (stats.changed) writeJSON('data/vendors.json', data);
console.log(`read ${stats.read}, no phrase ${stats.empty}, failed ${stats.failed}, changed ${stats.changed}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${stats.changed ? 'true' : 'false'}\n`);
