// Tiny HTML builder + indented serializer that keeps every line within the width limit.

export const LINE_LIMIT = 140;
const VOID = new Set(['meta', 'link', 'img', 'br', 'input', 'source', 'hr']);
const INLINE = new Set([
  'a', 'span', 'b', 'strong', 'em', 'small', 'time', 'abbr', 'img', 'br', 'sup', 'sub', 'mark', 'data', 's', 'i', 'button',
]);
const RAW = new Set(['script', 'style']);

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Display width: wide (CJK/Hangul) characters count as 2. */
export function width(s) {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    w += (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ? 2 : 1;
  }
  return w;
}

export function h(tag, attrs, ...children) {
  if (attrs === null || typeof attrs !== 'object' || Array.isArray(attrs) || attrs.__node) {
    children.unshift(attrs);
    attrs = {};
  }
  return { __node: true, tag, attrs: attrs || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== '') };
}
/** Pre-escaped markup that is emitted as-is (single line). */
export const raw = (html) => ({ __node: true, raw: String(html) });

function attrList(attrs) {
  const out = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    out.push(v === true ? k : `${k}="${esc(v)}"`);
  }
  return out;
}

const isInline = (n) => typeof n === 'string' || typeof n === 'number' || n.raw !== undefined || INLINE.has(n.tag);

function inlineString(n) {
  if (typeof n === 'string' || typeof n === 'number') return esc(n);
  if (n.raw !== undefined) return n.raw;
  const a = attrList(n.attrs);
  const open = `<${n.tag}${a.length ? ' ' + a.join(' ') : ''}>`;
  if (VOID.has(n.tag)) return open;
  return open + n.children.map(inlineString).join('') + `</${n.tag}>`;
}

/**
 * Break a long phrasing line at spaces: in text, or between attributes inside a tag.
 * Spaces inside quoted attribute values are kept unless `inValue` is set (attribute wrapping).
 */
function wrapInline(text, pad, contPad, limit = LINE_LIMIT, inValue = false) {
  const lines = [];
  let cur = pad;
  let curW = width(pad);
  const tokens = [];
  let buf = '';
  let inTag = false;
  let quote = false;
  for (const ch of text) {
    if (!inValue) {
      if (ch === '<' && !quote) inTag = true;
      else if (ch === '>' && !quote) inTag = false;
      else if (ch === '"' && inTag) quote = !quote;
    }
    if (ch === ' ' && !quote) {
      tokens.push(buf);
      buf = '';
    } else buf += ch;
  }
  tokens.push(buf);
  let first = true;
  for (const t of tokens) {
    const tw = width(t);
    if (!first && curW + 1 + tw > limit) {
      lines.push(cur);
      cur = contPad + t;
      curW = width(contPad) + tw;
    } else {
      cur += (first ? '' : ' ') + t;
      curW += (first ? 0 : 1) + tw;
    }
    first = false;
  }
  lines.push(cur);
  return lines;
}

function openTag(n, pad) {
  const a = attrList(n.attrs);
  const one = `${pad}<${n.tag}${a.length ? ' ' + a.join(' ') : ''}>`;
  if (width(one) <= LINE_LIMIT) return [one];
  const lines = [`${pad}<${n.tag}`];
  for (const x of a) {
    if (width(pad + '    ' + x) <= LINE_LIMIT) lines.push(`${pad}    ${x}`);
    else {
      // long attribute value: split value at spaces
      const m = x.match(/^([^=]+)="(.*)"$/s);
      const wrapped = wrapInline(m[2], `${pad}    ${m[1]}="`, `${pad}      `, LINE_LIMIT - 1, true);
      wrapped[wrapped.length - 1] += '"';
      lines.push(...wrapped);
    }
  }
  lines.push(`${pad}>`);
  return lines;
}

export function render(n, depth = 0) {
  const pad = '  '.repeat(depth);
  if (typeof n === 'string' || typeof n === 'number') return wrapInline(esc(n), pad, pad);
  if (n.raw !== undefined) return [pad + n.raw];
  if (RAW.has(n.tag)) {
    const a = attrList(n.attrs);
    const body = n.children.map((c) => (typeof c === 'string' ? c : c.raw)).join('');
    if (n.attrs.type === 'application/ld+json') {
      return [`${pad}<${n.tag} ${a.join(' ')}>`, ...body.split('\n').map((l) => pad + '  ' + l), `${pad}</${n.tag}>`];
    }
    return [`${pad}<${n.tag}${a.length ? ' ' + a.join(' ') : ''}>${body}</${n.tag}>`];
  }
  if (VOID.has(n.tag)) return openTag(n, pad);
  if (!n.children.length) {
    const o = openTag(n, pad);
    o[o.length - 1] += `</${n.tag}>`;
    return o;
  }
  if (n.children.every(isInline)) {
    const a = attrList(n.attrs);
    const open = `<${n.tag}${a.length ? ' ' + a.join(' ') : ''}>`;
    const body = n.children.map(inlineString).join('');
    const one = pad + open + body + `</${n.tag}>`;
    if (width(one) <= LINE_LIMIT) return [one];
    const o = openTag(n, pad);
    return [...o, ...wrapInline(body, pad + '  ', pad + '  '), `${pad}</${n.tag}>`];
  }
  const out = openTag(n, pad);
  for (const c of n.children) {
    if (isInline(c) && typeof c !== 'string') out.push(...wrapInline(inlineString(c), pad + '  ', pad + '    '));
    else out.push(...render(c, depth + 1));
  }
  out.push(`${pad}</${n.tag}>`);
  return out;
}

export function documentHTML(root) {
  return '<!doctype html>\n' + render(root).join('\n') + '\n';
}
