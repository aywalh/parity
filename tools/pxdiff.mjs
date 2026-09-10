// Pixel counter-measurement for a screenshot pair. Only meaningful on runs shot
// with `verify --freeze`: without a pinned clock an animated page is photographed
// at two different moments and every pixel differs for a reason that has nothing
// to do with fidelity.
//
// Usage: node tools/pxdiff.mjs <sourceShot.png> <cloneShot.png> [--tolerance n]
//
// Reports differing pixels and, more usefully, the worst per-channel deviation:
// a large share of pixels off by 1-2 is GPU rounding, a handful off by 200 is a
// real difference. Exit 1 if worst > tolerance (default 8).
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { emit } from './_emit.mjs';

const [, , A, B] = process.argv;
const TOL = Number(process.argv.find(a => a.startsWith('--tolerance='))?.split('=')[1] ?? 8);
if (!A || !B) { console.error('usage: node tools/pxdiff.mjs <a.png> <b.png> [--tolerance=n]'); process.exit(2); }
for (const f of [A, B]) if (!existsSync(f)) { console.error(`not found: ${f}`); process.exit(2); }

const url = f => 'data:image/png;base64,' + readFileSync(f).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
const r = await page.evaluate(async ([sa, sb]) => {
  const load = async s => { const i = new Image(); i.src = s; await i.decode(); return i; };
  const [ia, ib] = await Promise.all([load(sa), load(sb)]);
  if (ia.width !== ib.width || ia.height !== ib.height)
    return { sizeMismatch: [ia.width, ia.height, ib.width, ib.height] };
  const px = im => {
    const c = Object.assign(document.createElement('canvas'), { width: im.width, height: im.height });
    c.getContext('2d').drawImage(im, 0, 0);
    return c.getContext('2d').getImageData(0, 0, im.width, im.height).data;
  };
  const a = px(ia), b = px(ib);
  let n = 0, worst = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (!d) continue;
    n++;
    if (d > worst) worst = d;
    const q = i / 4, x = q % ia.width, y = (q / ia.width) | 0;
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { w: ia.width, h: ia.height, differing: n, total: a.length / 4, worst, box: x1 < 0 ? null : [x0, y0, x1, y1] };
}, [url(A), url(B)]);
await browser.close();

if (r.sizeMismatch) {
  const [aw, ah, bw, bh] = r.sizeMismatch;
  emit({ ev: 'done', cmd: 'pxdiff', ok: false, reason: 'size', exit: 1 });
  console.error(`✗ Größen weichen ab: ${aw}×${ah} vs ${bw}×${bh}`);
  process.exit(1);
}

const pct = (100 * r.differing / r.total).toFixed(3);
const ok = r.worst <= TOL;
emit({ ev: 'row', kind: 'pxdiff', label: 'worst channel delta', source: '0', clone: String(r.worst), match: ok });
emit({ ev: 'done', cmd: 'pxdiff', ok, differing: r.differing, pct: Number(pct), worst: r.worst, tolerance: TOL, exit: ok ? 0 : 1 });
console.log(`\n  ${r.w}×${r.h}  ·  ${r.differing} von ${r.total} Pixeln abweichend (${pct} %)
  schlimmste Kanalabweichung: ${r.worst} von 255   (Toleranz ${TOL})
${ok ? '\n\x1b[32m✓ Bildgleich im Rahmen der Toleranz\x1b[0m  \x1b[2mAbweichungen dieser Größe sind GPU-Rundung.\x1b[0m\n'
     : `\n\x1b[31m✗ Sichtbarer Unterschied\x1b[0m  Bereich ${JSON.stringify(r.box)}\n`}`);
process.exit(ok ? 0 : 1);
