// Downloads vendor app icons and horizontal logos, then re-encodes them with sharp
// (metadata removed, uniform sizes). Originals stay in .cache/raw and are never committed.
// Usage: node scripts/kite.mjs [vendorId ...]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, readJSON, getText, getBuffer, sleep } from './lib/util.mjs';

const OUT = path.join(ROOT, 'static', 'v');
const RAW = path.join(ROOT, '.cache', 'raw');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

const only = new Set(process.argv.slice(2));
const { vendors } = readJSON('data/vendors.json');

async function iconSource(v) {
  if (v.appStoreId) {
    const j = JSON.parse(await getText(`https://itunes.apple.com/lookup?id=${v.appStoreId}&country=kr`));
    const url = j.results?.[0]?.artworkUrl512;
    if (url) return url;
  }
  if (v.playId) {
    const html = await getText(`https://play.google.com/store/apps/details?id=${encodeURIComponent(v.playId)}&hl=ko&gl=KR`);
    const m = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (m) return m[1].replace(/=s\d+.*$/, '') + '=s512';
  }
  return null;
}

async function saveIcon(v) {
  const src = await iconSource(v);
  if (!src) return 'none';
  const buf = await getBuffer(src);
  fs.writeFileSync(path.join(RAW, `${v.id}-icon`), buf);
  await sharp(buf).resize(128, 128, { fit: 'cover' }).webp({ quality: 86 }).toFile(path.join(OUT, `${v.id}.webp`));
  return 'ok';
}

async function saveLogo(v) {
  if (!v.logoSrc) return 'none';
  const buf = await getBuffer(v.logoSrc, { headers: { referer: v.url } });
  fs.writeFileSync(path.join(RAW, `${v.id}-logo`), buf);
  let img = sharp(buf, { animated: false }).ensureAlpha();
  const fix = v.logoFix || {};
  if (fix.crop) {
    const [left, top, width, height] = fix.crop;
    img = sharp(await img.extract({ left, top, width, height }).png().toBuffer());
  }
  if (fix.clearLight || fix.whiteToDark) {
    // clearLight: pale background -> transparent; whiteToDark: white text on colour -> dark text, colour removed
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const min = Math.min(r, g, b);
      const spread = Math.max(r, g, b) - min;
      if (fix.whiteToDark) {
        const a = Math.max(0, Math.min(255, (min - 120) * 2));
        data[i] = 0x2a; data[i + 1] = 0x25; data[i + 2] = 0x22; data[i + 3] = a;
      } else if (min > 200 && spread < 40) {
        // fade near-white pixels out so no light halo stays around the shapes
        data[i + 3] = Math.min(data[i + 3], Math.round((255 * (255 - min)) / 55));
      }
    }
    img = sharp(data, { raw: info });
  }
  img = sharp(await img.trim({ threshold: 18 }).png().toBuffer());
  const { data, info } = await img.clone().raw().toBuffer({ resolveWithObject: true });
  // share of painted (non-white, non-transparent) pixels
  let painted = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    const light = data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235;
    if (a > 40 && !light) painted++;
  }
  const fill = Math.max(0.15, painted / (info.width * info.height));
  const target = 7200; // painted px² at output size
  // keep detail for sharp screens; visual size is evened out by the page layout
  const scale = Math.min(1, 120 / info.height, 400 / info.width);
  void fill;
  void target;
  const w = Math.max(1, Math.round(info.width * scale));
  const h = Math.max(1, Math.round(info.height * scale));
  await img.resize(w, h).webp({ quality: 90, alphaQuality: 100 }).toFile(path.join(OUT, `${v.id}-wide.webp`));
  return `${w}x${h}`;
}

const report = [];
for (const v of vendors) {
  if (only.size && !only.has(v.id)) continue;
  if (v.status === 'excluded') continue;
  const row = { id: v.id };
  try {
    row.icon = await saveIcon(v);
  } catch (e) {
    row.icon = 'fail';
  }
  try {
    row.logo = await saveLogo(v);
  } catch (e) {
    row.logo = 'fail ' + e.message;
  }
  report.push(row);
  await sleep(500);
}
for (const r of report) console.log(`${r.id}\ticon:${r.icon}\tlogo:${r.logo}`);
