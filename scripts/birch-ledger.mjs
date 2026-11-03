// Repository and output scan. Reports file + line + rule only, never the matched text.
// Lists come from environment variables (newline separated):
//   DENY_LIST  strings that must never appear (names, addresses, vendor names not covered, ...)
//   LEAK_LIST  phrases that must never appear
// Usage: node scripts/birch-ledger.mjs [--out _site] [--range <git range> | --all-history]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/util.mjs';

const inCI = !!process.env.GITHUB_ACTIONS;
const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const outDir = arg('--out');
const range = arg('--range');
const allHistory = args.includes('--all-history');

const list = (v) =>
  (v || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
const deny = list(process.env.DENY_LIST);
const leak = list(process.env.LEAK_LIST);
if (process.env.GITHUB_REPOSITORY) {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  deny.push(owner, repo);
}

const findings = [];
const note = (where, rule) => findings.push(`${where}: ${rule}`);
console.log(`lists loaded: deny ${list(process.env.DENY_LIST).length}, phrases ${leak.length}`);
if (!list(process.env.DENY_LIST).length || !leak.length) {
  if (inCI) {
    console.log('::error::protective lists are empty');
    process.exit(1);
  }
  console.log('warning: protective lists are empty (local run)');
}

const RULES = [
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['phone', /(?<![\d-])(0\d{1,2}-\d{3,4}-\d{4}|1[5-9]\d{2}-\d{4})(?![\d-])/],
  ['token', /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[bpa]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,})/],
  ['verification code', /google-site-verification|msvalidate\.01|naver-site-verification/i],
  ['analytics id', /\b(G-[A-Z0-9]{8,}|UA-\d{4,}-\d+|GTM-[A-Z0-9]{5,}|ca-pub-\d{10,})\b/],
  ['author meta', /<meta\s+name="author"/i],
];
const lower = (s) => s.toLowerCase();

// the site's own base path (already part of its public address) may appear as a link target
const BASE = (process.env.SITE_BASE_PATH || '').replace(/^\/*|\/*$/g, '');
const ownPath = BASE ? new RegExp(`href="/${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/"`, 'g') : null;

function scanText(where, text) {
  if (ownPath && where.startsWith(`${outDir}/`)) text = text.replace(ownPath, 'href="/"');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const l = lower(line);
    for (const d of deny) if (l.includes(lower(d))) note(`${where}:${i + 1}`, 'blocked string');
    for (const p of leak) if (l.includes(lower(p))) note(`${where}:${i + 1}`, 'blocked phrase');
    for (const [name, re] of RULES) if (re.test(line)) note(`${where}:${i + 1}`, name);
  });
}

function scanImage(where, buf) {
  const has = (s) => buf.includes(Buffer.from(s));
  if (/\.png$/i.test(where)) for (const c of ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']) if (has(c)) note(where, `image metadata ${c}`);
  if (/\.webp$/i.test(where)) for (const c of ['EXIF', 'XMP ']) if (has(c)) note(where, 'image metadata');
  if (/\.jpe?g$/i.test(where) && (has('Exif') || has('http://ns.adobe.com/xap'))) note(where, 'image metadata');
}

function scanSvgOrHtml(where, text) {
  if (/<metadata|inkscape:|sodipodi:|xmlns:x="adobe|illustrator/i.test(text)) note(where, 'editor traces');
  for (const m of text.matchAll(/data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)/g)) {
    scanImage(`${where} (embedded ${m[1]})`, Buffer.from(m[2], 'base64'));
  }
}

const TEXT_EXT = /\.(html?|css|m?js|json|txt|xml|md|ya?ml|svg|sha256|gitignore)$/i;
const IMG_EXT = /\.(png|webp|jpe?g|gif)$/i;
const SELF = path.relative(ROOT, new URL(import.meta.url).pathname);

function scanFile(abs, where) {
  const buf = fs.readFileSync(abs);
  if (IMG_EXT.test(abs)) return scanImage(where, buf);
  if (!TEXT_EXT.test(abs) && !/^[^.]+$/.test(path.basename(abs))) return;
  const text = buf.toString('utf8');
  if (where === SELF) {
    // this file holds the patterns themselves; only the lists apply
    scanTextListsOnly(where, text);
    return;
  }
  scanText(where, text);
  if (/\.(svg|html?)$/i.test(abs)) scanSvgOrHtml(where, text);
}
function scanTextListsOnly(where, text) {
  text.split('\n').forEach((line, i) => {
    const l = lower(line);
    for (const d of deny) if (l.includes(lower(d))) note(`${where}:${i + 1}`, 'blocked string');
    for (const p of leak) if (l.includes(lower(p))) note(`${where}:${i + 1}`, 'blocked phrase');
  });
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// 1) tracked files
for (const f of git('ls-files', '-z').split('\0').filter(Boolean)) {
  if (f === 'package-lock.json') continue;
  const abs = path.join(ROOT, f);
  if (fs.existsSync(abs)) scanFile(abs, f);
}

// 2) build output
if (outDir) {
  const base = path.resolve(ROOT, outDir);
  for (const f of fs.readdirSync(base, { recursive: true })) {
    const abs = path.join(base, f);
    if (fs.statSync(abs).isFile()) scanFile(abs, `${outDir}/${f}`);
  }
}

// 3) commit messages and identities
const revs = allHistory ? ['--all'] : range ? [range] : [];
if (revs.length) {
  const log = git('log', ...revs, '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e');
  for (const rec of log.split('\x1e').map((s) => s.trim()).filter(Boolean)) {
    const [sha, an, ae, cn, ce, body] = rec.split('\x1f');
    const where = `commit ${sha.slice(0, 10)}`;
    for (const who of [an, ae, cn, ce]) {
      const l = lower(who);
      if (deny.some((d) => l.includes(lower(d)))) note(where, 'identity matches a blocked string');
    }
    for (const e of [ae, ce]) {
      if (!/(@users\.noreply\.github\.com|^noreply@github\.com)$/i.test(e)) note(where, 'identity is not a private address');
    }
    const msg = body.toLowerCase();
    if (/claude-session|co-authored-by|generated with|claude\.ai\/code/.test(msg)) note(where, 'tool signature line');
    if (deny.some((d) => msg.includes(lower(d))) || leak.some((p) => msg.includes(lower(p)))) note(where, 'blocked text in message');
    for (const [name, re] of RULES) if (re.test(body)) note(where, `${name} in message`);
  }
}

if (findings.length) {
  for (const f of [...new Set(findings)]) console.log(inCI ? `::error::${f}` : `FAIL ${f}`);
  console.log(`${findings.length} finding(s)`);
  process.exit(1);
}
console.log('scan passed');
