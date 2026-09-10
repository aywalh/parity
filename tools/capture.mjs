// Baseline capture of a live site: rendered HTML, resource entries across three
// load phases, console, failed requests, desktop + mobile screenshots.
// Usage: node tools/capture.mjs <url> [outDir]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { emit } from './_emit.mjs';
import { join } from 'node:path';

const URL_ = process.argv[2];
const OUT = process.argv[3] ?? 'capture/original';
if (!URL_) {
  console.error('usage: node tools/capture.mjs <url> [outDir]');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const GLOBALS = [
  'gsap', 'ScrollTrigger', 'Swiper', 'lottie', 'bodymovin', 'lenis', 'Lenis',
  'THREE', 'rive', 'Rive', 'PIXI', 'BABYLON', 'Splat', 'anime', 'Motion',
  'LocomotiveScroll', 'barba', 'Alpine', 'React', 'Vue', '__NEXT_DATA__', '__remixContext',
];

const probe = () => ({
  title: document.title,
  url: location.href,
  lang: document.documentElement.lang,
  htmlClass: document.documentElement.className,
  bodyClass: document.body?.className,
  scrollHeight: document.documentElement.scrollHeight,
  canvases: [...document.querySelectorAll('canvas')].map(c => ({
    w: c.width, h: c.height, cls: c.className,
    ctx: (() => { try { return c.getContext('webgl2') ? 'webgl2' : (c.getContext('webgl') ? 'webgl' : '2d/none'); } catch { return '?'; } })(),
  })),
  videos: [...document.querySelectorAll('video')].map(v => ({ src: v.currentSrc || v.src, poster: v.poster })),
  iframes: [...document.querySelectorAll('iframe')].map(f => f.src),
  scripts: [...document.querySelectorAll('script[src]')].map(s => s.src),
  styles: [...document.querySelectorAll('link[rel~="stylesheet"]')].map(l => l.href),
  fontsLoaded: [...(document.fonts || [])].map(f => `${f.family}|${f.weight}|${f.style}|${f.status}`),
  links: [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href))],
});

const res = () => performance.getEntriesByType('resource').map(r => ({
  name: r.name, type: r.initiatorType, size: r.transferSize, dur: Math.round(r.duration),
}));

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  const console_ = [], failed = [], responses = [];
  page.on('console', m => console_.push({ type: m.type(), text: m.text().slice(0, 500) }));
  page.on('pageerror', e => console_.push({ type: 'pageerror', text: String(e).slice(0, 500) }));
  page.on('requestfailed', r => failed.push({ url: r.url(), err: r.failure()?.errorText }));
  page.on('response', r => responses.push({ url: r.url(), status: r.status(), ct: r.headers()['content-type'] }));

  emit({ ev: 'phase', name: 'capture', status: 'start', url: URL_ });
  console.log('→ goto', URL_);
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 });
  writeFileSync(join(OUT, 'original.html'), await page.content(), 'utf8');

  await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => console.log('  (networkidle timeout, continuing)'));
  await page.waitForTimeout(6000);

  const phases = {};
  phases.load = { probe: await page.evaluate(probe), res: await page.evaluate(res) };
  console.log('  loaded:', phases.load.probe.title, '| canvases:', phases.load.probe.canvases.length);

  await page.screenshot({ path: join(OUT, 'desktop-top.png'), timeout: 60000 }).catch(e => console.log('  shot fail', e.message));

  // Exercise the page: slow scroll through the whole document, pausing for lazy loads.
  const h = phases.load.probe.scrollHeight;
  console.log('  scrollHeight', h);
  for (let y = 0; y <= h; y += 700) {
    await page.mouse.move(720 + (y % 200), 450);
    await page.evaluate(v => window.scrollTo({ top: v, behavior: 'smooth' }), y);
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(4000);
  phases.afterScroll = { probe: await page.evaluate(probe), res: await page.evaluate(res) };
  await page.screenshot({ path: join(OUT, 'desktop-full.png'), fullPage: true, timeout: 120000 }).catch(e => console.log('  fullpage fail', e.message));

  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.waitForTimeout(2500);

  const globals = await page.evaluate(g => Object.fromEntries(g.map(k => [k, typeof window[k]])), GLOBALS);

  // Mobile pass
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, 'mobile-top.png'), timeout: 60000 }).catch(() => {});
  const mh = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= mh; y += 800) {
    await page.evaluate(v => window.scrollTo(0, v), y);
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(3000);
  phases.mobile = { probe: await page.evaluate(probe), res: await page.evaluate(res) };

  const out = {
    source: URL_, capturedAt: new Date().toISOString(),
    globals,
    phases,
    console: console_,
    failedRequests: failed,
    responses: [...new Map(responses.map(r => [r.url, r])).values()],
  };
  writeFileSync(join(OUT, 'baseline.json'), JSON.stringify(out, null, 2), 'utf8');

  const all = [...new Set([...phases.load.res, ...phases.afterScroll.res, ...phases.mobile.res].map(r => r.name))].sort();
  writeFileSync(join(OUT, 'resources.txt'), all.join('\n'), 'utf8');
  emit({ ev: 'done', cmd: 'capture', resources: all.length, console: console_.length, failed: failed.length, exit: 0 });
  console.log(`✓ ${all.length} unique resources, ${console_.length} console msgs, ${failed.length} failed`);
  await browser.close();
};
run();
