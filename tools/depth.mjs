// How far does a page actually go? On a normal page that is scrollHeight. On a
// page whose html/body cannot overflow, scrollHeight is one viewport and says
// nothing — the wheel is driving a canvas, and the content lives there.
//
// Usage: node tools/depth.mjs <url> [outDir] [--step=px] [--max=n]
//
// The clock is pinned exactly as in `verify --freeze`, so a frame that differs
// differs because the wheel moved something, not because time passed. Without
// that, a page with animated water changes every frame and the measurement is
// noise. Reports how far the wheel travels before the page stops responding.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { emit } from './_emit.mjs';

const URL_ = process.argv[2];
const OUT = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
const num = (n, d) => Number(process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);
const STEP = num('step', 600);      // wheel px per turn
const MAX = num('max', 140);        // give up after this many turns
const QUIET = num('quiet', 6);      // turns without change that count as the end
const TICK = 260;                   // virtual ms handed out per turn
if (!URL_) { console.error('usage: node tools/depth.mjs <url> [outDir] [--step=px] [--max=n]'); process.exit(2); }

const EPOCH = new Date('2026-01-01T00:00:00Z');

// A coarse fingerprint: every canvas downscaled to 24x24 plus the text and the
// document's own scroll position. Coarse on purpose — it must survive dithering
// and antialiasing but notice a scene that moved.
const fingerprint = () => {
  const parts = [];
  for (const c of document.querySelectorAll('canvas')) {
    try {
      const t = Object.assign(document.createElement('canvas'), { width: 24, height: 24 });
      const x = t.getContext('2d');
      x.drawImage(c, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data;
      let s = '';
      for (let i = 0; i < d.length; i += 16) s += (d[i] >> 4).toString(16);
      parts.push(s);
    } catch { parts.push('x'); }
  }
  parts.push('t' + document.body.innerText.replace(/\s+/g, '').length);
  parts.push('y' + Math.round(window.scrollY));
  return parts.join('|');
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.clock.install({ time: EPOCH });
await page.clock.pauseAt(EPOCH);
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(9000);
await page.clock.runFor(4000);

const locked = await page.evaluate(() =>
  ['hidden', 'clip'].includes(getComputedStyle(document.documentElement).overflowY)
  || ['hidden', 'clip'].includes(getComputedStyle(document.body).overflowY)
  || getComputedStyle(document.body).position === 'fixed');
const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);

await page.mouse.move(720, 460);
let prev = await page.evaluate(fingerprint);
let quiet = 0, turns = 0, changes = 0, lastChange = 0;

for (let i = 1; i <= MAX; i++) {
  await page.mouse.wheel(0, STEP);
  await page.waitForTimeout(90);
  await page.clock.runFor(TICK);
  const now = await page.evaluate(fingerprint);
  turns = i;
  if (now !== prev) { changes++; lastChange = i; quiet = 0; } else quiet++;
  prev = now;
  emit({ ev: 'row', kind: 'depth', label: `turn ${i}`, source: `${i * STEP}px`, clone: now === prev ? 'same' : 'changed', match: true });
  if (quiet >= QUIET) break;
}

const travel = lastChange * STEP;
const report = {
  url: URL_, at: new Date().toISOString(),
  scrollLocked: locked, docHeight,
  step: STEP, turns, changes, lastChangeTurn: lastChange,
  travel,                       // wheel px that still changed something
  // Which axis actually carries the content? The overflow style is a hint, not
  // the answer: a page can be scrollable in principle and still hold everything
  // in a canvas the wheel drives. Ask what moved instead.
  scrolls: docHeight > 900,
  reach: docHeight > 900 ? docHeight : travel,
  unit: docHeight > 900 ? 'document px' : 'wheel px',
};
if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, 'DEPTH.json'), JSON.stringify(report, null, 2), 'utf8'); }
emit({ ev: 'done', cmd: 'depth', ...report, exit: 0 });

console.log(`\n${URL_}
  Dokument: ${docHeight}px ${locked ? '(overflow gesperrt — der Wert sagt nichts)' : ''}
  ${turns} Radumdrehungen à ${STEP}px · ${changes} davon haben das Bild geändert
  letzte Änderung bei Umdrehung ${lastChange} → ${travel.toLocaleString('de-DE')} px Radweg
  Reichweite: ${report.reach.toLocaleString('de-DE')} ${report.unit}\n`);
await browser.close();
