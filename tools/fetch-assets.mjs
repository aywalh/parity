// Recursive same-origin asset downloader. Discovers paths from HTML/CSS/JS text,
// downloads preserving directory structure, repeats on newly fetched text files.
//
// Usage: node tools/fetch-assets.mjs <origin> <outDir> [seedFile ...]
//   node tools/fetch-assets.mjs https://example.com clone capture/original/raw.html
//
// Seed files may be an HTML/CSS/JS document to scan, or a newline-separated URL list.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { emit, family } from './_emit.mjs';

const [, , originArg, outArg, ...seeds] = process.argv;
if (!originArg || !outArg) {
  console.error('usage: node tools/fetch-assets.mjs <origin> <outDir> [seedFile ...]');
  process.exit(1);
}
const ORIGIN = originArg.replace(/\/+$/, '');
const OUT = outArg;
const HOST = new URL(ORIGIN).host;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

const TEXT_EXT = /\.(html|css|js|mjs|json|webmanifest|svg)$/i;
// Root-relative paths in any text source. Extension length is generous on purpose:
// .webmanifest is 11 chars and a tighter bound silently drops it.
const PATH_RE = /(?:"|'|`|\(|\\?")(\/[A-Za-z0-9._\-/@%]+\.[A-Za-z0-9]{2,12})(?:\?[^"'`)\\]*)?(?:"|'|`|\)|\\)/g;
// Absolute same-origin URLs, including JSON-escaped forms (https:\/\/host\/path).
const ABS_RE = new RegExp(
  'https?:\\\\?\\/\\\\?\\/' + HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
  '((?:\\\\?\\/[A-Za-z0-9._\\-@]+)+\\.[A-Za-z0-9]{2,12})', 'g');

const decodePath = p => { try { return decodeURIComponent(p); } catch { return p; } };

// Relative module specifiers. A bundle that splits itself writes
// import("./App3D-f554a111.js") — no leading slash, so PATH_RE cannot see it,
// and the entire application silently stays on the original server. Only ./ and
// ../ count: a bare "foo.js" is too ambiguous to chase safely.
const REL_RE = /(?:"|'|`|\()(\.{1,2}\/[A-Za-z0-9._\-/@%]+\.[A-Za-z0-9]{2,12})(?:\?[^"'`)]*)?(?:"|'|`|\))/g;

// Resolve a relative specifier against the file that contained it.
const resolveRel = (rel, fromPath) => {
  const segs = (fromPath.slice(0, fromPath.lastIndexOf('/')) + '/' + rel).split('/');
  const out = [];
  for (const seg of segs) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return '/' + out.join('/');
};

const queue = new Set();
const done = new Set();
const failed = [];
const notFound = [];

const add = p => {
  if (!p || !p.startsWith('/')) return;
  p = p.replace(/\\\//g, '/').split('?')[0].split('#')[0];
  if (p.includes('//') || p.length > 300) return;
  if (!done.has(p)) queue.add(p);
};

const harvest = (text, from = '/') => {
  for (const m of text.matchAll(PATH_RE)) add(m[1]);
  for (const m of text.matchAll(REL_RE)) add(resolveRel(m[1], from));
  for (const m of text.matchAll(ABS_RE)) add(m[1].replace(/\\\//g, '/'));
  // srcset entries are comma separated and unquoted individually
  for (const m of text.matchAll(/srcset="([^"]+)"/g))
    m[1].split(',').forEach(s => add(s.trim().split(/\s+/)[0]));
};

const pathOf = l => { try { return l.startsWith('/') ? l : new URL(l).pathname; } catch { return null; } };

for (const f of seeds) {
  if (!existsSync(f)) { console.warn(`  seed not found, skipping: ${f}`); continue; }
  const text = readFileSync(f, 'utf8');
  // A plain URL/path list seeds directly; anything else gets scanned.
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const isList = lines.length > 0 && lines.every(l => l.startsWith('/') || l.startsWith('http'));
  // Any host: verify writes missing.txt against whichever URL it measured, so the
  // clone's own 404 list (http://localhost:.../x) must seed the next round too.
  if (isList) lines.forEach(l => add(pathOf(l)));
  else harvest(text);
}
if (!queue.size) { console.error('no seed paths found — pass at least one seed file'); process.exit(1); }
emit({ ev: 'phase', name: 'fetch', status: 'start', queued: queue.size });

const get = async (url, tries = 3) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' } });
      if (!r.ok) { if (r.status === 404) return { status: 404 }; throw new Error('HTTP ' + r.status); }
      return { status: 200, buf: Buffer.from(await r.arrayBuffer()), ct: r.headers.get('content-type') || '' };
    } catch (e) {
      if (i === tries - 1) return { status: 0, err: String(e) };
      await new Promise(s => setTimeout(s, 600 * (i + 1)));
    }
  }
};

let n = 0;
while (queue.size) {
  const p = [...queue][0];
  queue.delete(p); done.add(p);
  // A URL path is percent-encoded, a filesystem path is not — and serve() decodes
  // the incoming request. Store under the encoded name and every asset with a
  // space in it 404s locally while returning 200 from the origin.
  const dest = join(OUT, decodePath(p));
  if (existsSync(dest) && statSync(dest).size > 0) {
    if (TEXT_EXT.test(p)) harvest(readFileSync(dest, 'utf8'), p);
    // Auch Treffer aus dem Cache melden — sonst wirkt eine zweite Runde leer.
    emit({ ev: 'asset', path: p, family: family(p), bytes: statSync(dest).size, cached: true });
    continue;
  }
  const r = await get(ORIGIN + p);
  if (r.status !== 200) {
    (r.status === 404 ? notFound : failed).push({ path: p, status: r.status, err: r.err });
    emit({ ev: 'asset', path: p, family: family(p), status: r.status, err: r.err });
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, r.buf);
  n++;
  emit({ ev: 'asset', path: p, family: family(p), bytes: r.buf.length });
  if (TEXT_EXT.test(p) || /text|javascript|json/.test(r.ct)) harvest(r.buf.toString('utf8'), p);
  if (n % 20 === 0) console.log(`  ${n} downloaded, ${queue.size} queued`);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'ASSETS.json'),
  JSON.stringify({ origin: ORIGIN, downloaded: n, known: done.size, notFound, failed }, null, 2), 'utf8');
emit({ ev: 'done', cmd: 'fetch', downloaded: n, known: done.size, notFound: notFound.length, failed: failed.length, exit: 0 });
console.log(`✓ ${n} new / ${done.size} known · 404: ${notFound.length} · failed: ${failed.length}`);
console.log(`  report: ${join(OUT, 'ASSETS.json')}`);
if (failed.length) console.log(failed.slice(0, 20));
