// Verification pass: drives a page, records 404s/console errors/runtime state, shoots screenshots.
// Usage: node tools/verify.mjs <url> <outDir> [--shots] [--freeze[=ms]]
//
// --freeze pins the page clock: Date, setTimeout and requestAnimationFrame all
// come from a fake clock that only moves when we move it. An animated scene then
// renders the same frame on both sides, so screenshots become comparable at all —
// without it, source and clone are photographed at different moments of the same
// animation and differ for a reason that has nothing to do with fidelity.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { emit } from './_emit.mjs';

const URL_ = process.argv[2];
const OUT = process.argv[3];
const SHOTS = process.argv.includes('--shots');
const FREEZE_ARG = process.argv.find(a => a === '--freeze' || a.startsWith('--freeze='));
const FREEZE = FREEZE_ARG ? Number(FREEZE_ARG.split('=')[1] ?? 3000) : 0;
if (FREEZE_ARG && !(FREEZE > 0)) { console.error('--freeze needs a positive number of ms'); process.exit(2); }
// A fixed epoch, so Date.now() matches across runs too.
const EPOCH = new Date('2026-01-01T00:00:00Z');
mkdirSync(OUT, { recursive: true });

const state = () => ({
  title: document.title,
  htmlClass: document.documentElement.className,
  scrollHeight: document.documentElement.scrollHeight,
  // A page whose html/body cannot overflow does not scroll at all — what looks
  // like scrolling is the page driving a canvas from wheel events. Without this
  // flag a scrollHeight equal to the viewport reads as "a short page", and the
  // 21-step scroll walk below silently measures the same frame 21 times.
  scrollLocked: ['hidden', 'clip'].includes(getComputedStyle(document.documentElement).overflowY)
             || ['hidden', 'clip'].includes(getComputedStyle(document.body).overflowY)
             || getComputedStyle(document.body).position === 'fixed',
  scrollY: Math.round(window.scrollY),
  canvases: [...document.querySelectorAll('canvas')].map(c => ({ w: c.width, h: c.height, cls: c.className })),
  // Is the WebGL scene actually drawing, or is it a blank canvas?
  canvasNonBlank: [...document.querySelectorAll('canvas')].map(c => {
    try {
      const t = document.createElement('canvas'); t.width = 40; t.height = 40;
      t.getContext('2d').drawImage(c, 0, 0, 40, 40);
      const d = t.getContext('2d').getImageData(0, 0, 40, 40).data;
      let min = 255, max = 0;
      for (let i = 0; i < d.length; i += 4) { const v = d[i]; if (v < min) min = v; if (v > max) max = v; }
      return max - min; // 0 = flat/blank
    } catch { return -1; }
  }),
  // Did the page build anything at all? An app that never boots reports zero
  // canvases, zero images and zero fonts — indistinguishable from a page that
  // simply has none, unless the emptiness itself is recorded.
  nodes: document.querySelectorAll('*').length,
  textLength: (document.body.innerText || '').replace(/\s+/g, '').length,
  imagesTotal: document.images.length,
  imagesLoaded: [...document.images].filter(i => i.complete && i.naturalWidth > 0).length,
  videos: [...document.querySelectorAll('video')].map(v => ({ src: v.currentSrc, ready: v.readyState })),
  sections: [...document.querySelectorAll('.section, section, [id]')].filter(e => e.id).map(e => e.id).slice(0, 60),
  fonts: [...(document.fonts || [])].filter(f => f.status === 'loaded').map(f => f.family),
});

const run = async () => {
  emit({ ev: 'phase', name: 'verify', status: 'start', url: URL_ });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors = [], warnings = [], failed = [], notFound = [], blocked = [];
  page.on('console', m => {
    const t = m.text().slice(0, 400);
    // The guard reports every off-origin request it stopped. Without capturing it
    // here you cannot tell a clone that is missing an asset from one that was
    // forbidden to load it — the two look identical from the outside.
    if (t.startsWith('[parity] blocked ')) { blocked.push(t.slice(17)); return; }
    if (m.type() === 'error') errors.push(t);
    else if (m.type() === 'warning') warnings.push(t);
  });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e).slice(0, 400)));
  page.on('requestfailed', r => failed.push({ url: r.url(), err: r.failure()?.errorText }));
  page.on('response', r => { if (r.status() >= 400) notFound.push({ url: r.url(), status: r.status() }); });

  // install() alone leaves the clock running in real time — pauseAt stops it, so
  // the only time that passes is the time we hand out with runFor().
  if (FREEZE) { await page.clock.install({ time: EPOCH }); await page.clock.pauseAt(EPOCH); }

  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);
  // Nothing has painted yet under a frozen clock — rAF only fires when we advance it.
  if (FREEZE) await page.clock.runFor(FREEZE);
  const initial = await page.evaluate(state);
  emit({ ev: 'phase', name: 'verify', status: 'loaded', title: initial.title, scrollHeight: initial.scrollHeight, canvases: initial.canvases.length });
  if (SHOTS) {
    await page.screenshot({ path: join(OUT, 'desktop-top.png'), timeout: 90000 }).catch(e => errors.push('shot: ' + e.message));
    emit({ ev: 'shot', mark: 'desktop-top', path: join(OUT, 'desktop-top.png') });
  }

  // Walk the whole page so late preload phases fire and expose their own 404s.
  const h = initial.scrollHeight;
  const marks = [];
  for (let i = 0; i <= 20; i++) {
    const y = Math.round((h - 900) * (i / 20));
    await page.mouse.move(700 + (i * 13) % 300, 400 + (i * 7) % 200);
    await page.evaluate(v => window.scrollTo(0, v), y);
    await page.waitForTimeout(700);
    if (FREEZE) await page.clock.runFor(300);   // same advance per mark on both sides
    if (i % 5 === 0) {
      marks.push({ pct: i * 5, ...(await page.evaluate(state)) });
      if (SHOTS) {
        await page.screenshot({ path: join(OUT, `scroll-${i * 5}.png`), timeout: 90000 }).catch(() => {});
        emit({ ev: 'shot', mark: String(i * 5), pct: i * 5, path: join(OUT, `scroll-${i * 5}.png`) });
      }
    }
  }
  await page.waitForTimeout(3000);
  const afterScroll = await page.evaluate(state);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(4000);
  if (SHOTS) {
    await page.screenshot({ path: join(OUT, 'mobile-top.png'), timeout: 90000 }).catch(() => {});
    emit({ ev: 'shot', mark: 'mobile-top', path: join(OUT, 'mobile-top.png') });
  }
  const mh = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= mh; y += 1200) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(500); }
  await page.waitForTimeout(2000);
  const mobile = await page.evaluate(state);

  const report = {
    url: URL_, at: new Date().toISOString(), freeze: FREEZE || null,
    initial, afterScroll, mobile, marks,
    counts: { errors: errors.length, warnings: warnings.length, failed: failed.length, http4xx5xx: notFound.length, blocked: blocked.length },
    blocked: [...new Set(blocked)],
    errors: [...new Set(errors)], failed, notFound: [...new Map(notFound.map(n => [n.url, n])).values()],
  };
  writeFileSync(join(OUT, 'VERIFY.json'), JSON.stringify(report, null, 2), 'utf8');
  emit({ ev: 'done', cmd: 'verify', out: OUT, counts: report.counts,
         notFound: report.notFound.length, scrollHeight: initial.scrollHeight, exit: 0 });
  writeFileSync(join(OUT, 'missing.txt'), report.notFound.concat(failed.map(f => ({ url: f.url }))).map(n => n.url).join('\n'), 'utf8');
  console.log(`${URL_}
  title=${initial.title} canvases=${initial.canvases.length} nonBlank=${JSON.stringify(afterScroll.canvasNonBlank)}
  scrollHeight=${initial.scrollHeight} -> reached ${afterScroll.scrollY}
  images ${afterScroll.imagesLoaded}/${afterScroll.imagesTotal} · fonts=${initial.fonts.length}
  errors=${errors.length} failed=${failed.length} http>=400=${report.notFound.length}`);
  if (report.notFound.length) console.log('  MISSING:', report.notFound.slice(0, 15).map(n => n.status + ' ' + n.url).join('\n           '));
  if (errors.length) console.log('  ERR:', [...new Set(errors)].slice(0, 8).join('\n       '));
  await browser.close();
};
run();
