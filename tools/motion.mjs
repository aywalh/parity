// Motion probe: reads the animation layer a page actually ships, instead of
// eyeballing it. Same rule as everything else here — measure, do not assume.
//
// Usage: node tools/motion.mjs <url> [outDir]
//
// Reports the transition and animation timing functions in use with their
// durations and how often each pair occurs, plus which motion libraries are
// present. Runs against any URL, including a local clone, so the motion layer
// can be counter-measured like everything else.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { emit } from './_emit.mjs';

const URL_ = process.argv[2];
const OUT = process.argv[3];
if (!URL_) { console.error('usage: node tools/motion.mjs <url> [outDir]'); process.exit(2); }

const probe = () => {
  const seen = new Map();
  const bump = (kind, ease, ms) => {
    // 0ms entries are the browser default on every element — noise, not motion.
    if (!ms || ms < 16) return;
    const k = `${kind}|${ease}|${ms}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  };
  const secs = v => (v || '').split(',').map(s => parseFloat(s) * 1000);
  const eases = v => (v || '').split(/,(?![^(]*\))/).map(s => s.trim());

  for (const el of document.querySelectorAll('*')) {
    const c = getComputedStyle(el);
    const td = secs(c.transitionDuration), te = eases(c.transitionTimingFunction);
    td.forEach((ms, i) => bump('transition', te[i] ?? te[0], Math.round(ms)));
    const ad = secs(c.animationDuration), ae = eases(c.animationTimingFunction);
    ad.forEach((ms, i) => bump('animation', ae[i] ?? ae[0], Math.round(ms)));
  }

  const libs = [];
  const has = (k, label) => { try { if (k()) libs.push(label); } catch {} };
  has(() => window.gsap, 'gsap');
  has(() => window.ScrollTrigger || window.gsap?.core?.globals?.().ScrollTrigger, 'ScrollTrigger');
  has(() => window.Lenis || window.lenis, 'lenis');
  has(() => window.LocomotiveScroll, 'locomotive');
  has(() => window.THREE, 'three');
  has(() => window.Rive || window.rive, 'rive');
  has(() => window.anime, 'anime');
  has(() => window.Motion || window.motion, 'motion');

  return {
    entries: [...seen].map(([k, n]) => {
      const [kind, ease, ms] = k.split('|');
      return { kind, ease, ms: Number(ms), count: n };
    }).sort((a, b) => b.count - a.count),
    libs,
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    reducedMotionRules: [...document.styleSheets].reduce((n, s) => {
      try { return n + [...s.cssRules].filter(r => String(r.conditionText ?? '').includes('prefers-reduced-motion')).length; }
      catch { return n; }
    }, 0),
    elements: document.querySelectorAll('*').length,
  };
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(6000);
// Scroll once: reveal styles only exist on elements the page has already touched.
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 3));
await page.waitForTimeout(2500);
const r = await page.evaluate(probe);
await browser.close();

const report = { url: URL_, at: new Date().toISOString(), ...r };
if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, 'MOTION.json'), JSON.stringify(report, null, 2), 'utf8'); }
for (const e of r.entries.slice(0, 40)) emit({ ev: 'row', kind: 'motion', label: e.kind, source: `${e.ms}ms ${e.ease}`, clone: String(e.count), match: true });
emit({ ev: 'done', cmd: 'motion', out: OUT ?? null, distinct: r.entries.length, libs: r.libs, exit: 0 });

console.log(`\n${URL_}\n  ${r.elements} Elemente · ${r.entries.length} verschiedene Motion-Signaturen · Libs: ${r.libs.join(', ') || '—'}`);
console.log(`  scroll-behavior: ${r.scrollBehavior} · prefers-reduced-motion-Regeln: ${r.reducedMotionRules}\n`);
console.log(`  ${'Art'.padEnd(11)} ${'Dauer'.padEnd(8)} ${'Kurve'.padEnd(44)} Elemente`);
console.log(`  ${'─'.repeat(11)} ${'─'.repeat(8)} ${'─'.repeat(44)} ${'─'.repeat(8)}`);
for (const e of r.entries.slice(0, 18))
  console.log(`  ${e.kind.padEnd(11)} ${(e.ms + 'ms').padEnd(8)} ${e.ease.slice(0, 44).padEnd(44)} ${e.count}`);
