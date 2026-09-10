// Interaction matrix. Runs a generic probe set that works on any site, plus
// optional site-specific steps from a JS module.
//
// Usage: node tools/interact.mjs <url> <outDir> [--steps <module.mjs>]
//
// A steps module default-exports an async function receiving { page, step, shot }:
//
//   export default async ({ page, step, shot }) => {
//     await step('open menu', async () => {
//       await page.click('#burger');
//       return page.$eval('#menu', e => getComputedStyle(e).opacity);
//     });
//     await shot('menu-open');
//   };
//
// `step` records name + returned value (or the error) into the report; `shot`
// writes a screenshot. Site-specific steps run after the generic ones, so a
// failing custom step never hides a generic regression.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { emit } from './_emit.mjs';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const URL_ = args[0];
const OUT = args[1];
const stepsIdx = args.indexOf('--steps');
const STEPS = stepsIdx > -1 ? args[stepsIdx + 1] : null;
if (!URL_ || !OUT) {
  console.error('usage: node tools/interact.mjs <url> <outDir> [--steps <module.mjs>]');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const results = [], errors = [], missing = [];

const run = async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('response', r => { if (r.status() >= 400) missing.push(r.status() + ' ' + r.url()); });

  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);

  const step = async (name, fn) => {
    try {
      const value = await fn();
      results.push({ name, ok: true, value });
      emit({ ev: 'step', name, ok: true, value });
      console.log(`  ✓ ${name}: ${JSON.stringify(value)?.slice(0, 150)}`);
      return value;
    } catch (e) {
      results.push({ name, ok: false, err: String(e).slice(0, 200) });
      emit({ ev: 'step', name, ok: false, err: String(e).slice(0, 200) });
      console.log(`  ✗ ${name}: ${String(e).slice(0, 150)}`);
    }
  };
  const shot = n => page.screenshot({ path: join(OUT, n + '.png'), timeout: 60000 }).catch(() => {});

  // ── Generic probes: no site-specific selectors ─────────────────────────
  await step('document-state', () => page.evaluate(() => ({
    title: document.title,
    htmlClass: document.documentElement.className,
    bodyClass: document.body?.className,
    scrollHeight: document.documentElement.scrollHeight,
  })));

  // A stuck preloader is the classic clone failure, so surface any element
  // that names itself one rather than guessing at a single selector.
  await step('preloader-state', () => page.evaluate(() =>
    [...document.querySelectorAll('[id*="preload" i],[class*="preload" i],[id*="loader" i]')]
      .slice(0, 5).map(e => ({
        id: e.id || e.className,
        opacity: getComputedStyle(e).opacity,
        display: getComputedStyle(e).display,
      }))));

  await step('canvases', () => page.evaluate(() =>
    [...document.querySelectorAll('canvas')].map(c => ({ w: c.width, h: c.height }))));

  await step('nav-links', () => page.evaluate(() => {
    const nav = document.querySelector('nav, header nav, [id*="nav" i], [class*="nav" i]');
    return nav ? [...nav.querySelectorAll('a')].map(a => a.textContent.trim()).slice(0, 12) : [];
  }));

  await step('nav-hover', async () => {
    const link = page.locator('nav a, header a').first();
    if (!await link.count()) return 'no nav link';
    await link.hover(); await page.waitForTimeout(600);
    return link.evaluate(e => getComputedStyle(e).textDecorationLine + '|' + getComputedStyle(e).opacity);
  });

  await step('buttons', () => page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"]')]
      .filter(b => b.offsetParent !== null)
      .slice(0, 15).map(b => (b.textContent || '').trim().slice(0, 30) || '(no label)')));

  await step('forms', () => page.evaluate(() =>
    [...document.querySelectorAll('form')].map(f => ({
      action: f.getAttribute('action') || '(js-handled)',
      inputs: f.querySelectorAll('input, textarea, select').length,
    }))));

  await step('scroll-to-bottom', async () => {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= h; y += Math.max(700, Math.round(h / 20))) {
      await page.evaluate(v => window.scrollTo(0, v), y);
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(1500);
    return page.evaluate(() => Math.round(window.scrollY));
  });
  await shot('bottom');

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);

  // Mobile: find whatever toggle appears only at narrow widths and press it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(3500);
  await step('mobile-menu-toggle', async () => {
    const t = page.locator(
      '[id*="mobile" i][id*="btn" i], [class*="burger" i], [class*="hamburger" i], ' +
      '[aria-label*="menu" i], button[aria-expanded]').first();
    if (!await t.count()) return 'no mobile toggle found';
    const before = await page.evaluate(() => document.body.innerText.length);
    await t.click({ timeout: 8000 });
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => document.body.innerText.length);
    return { textLenBefore: before, textLenAfter: after, changed: before !== after };
  });
  await shot('mobile-menu');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(2000);

  // ── Site-specific steps ────────────────────────────────────────────────
  if (STEPS) {
    console.log(`  — site steps: ${STEPS}`);
    const mod = await import(pathToFileURL(resolve(STEPS)).href);
    await (mod.default ?? mod.steps)({ page, step, shot });
  }

  const report = {
    url: URL_, steps: STEPS ?? null, at: new Date().toISOString(),
    passed: results.filter(r => r.ok).length, total: results.length,
    results, errors: [...new Set(errors)], missing: [...new Set(missing)],
  };
  writeFileSync(join(OUT, 'INTERACTIONS.json'), JSON.stringify(report, null, 2), 'utf8');
  emit({ ev: 'done', cmd: 'interact', passed: report.passed, total: report.total, exit: 0 });
  console.log(`  → ${report.passed}/${report.total} ok · errors=${report.errors.length} · http>=400=${report.missing.length}`);
  await browser.close();
};
run();
