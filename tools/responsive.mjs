// Responsive sweep across widths incl. intermediate sizes, for source or clone.
// Usage: node tools/responsive.mjs <url> <outDir>
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { emit } from './_emit.mjs';

const URL_ = process.argv[2], OUT = process.argv[3];
mkdirSync(OUT, { recursive: true });
const WIDTHS = [1920, 1600, 1440, 1280, 1024, 900, 834, 768, 700, 600, 500, 430, 390, 375, 320];

const probe = () => {
  const de = document.documentElement;
  const nav = document.querySelector('#site-header-nav');
  const burger = document.querySelector('#site-header-mobile-btn');
  const vis = e => e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'
    && e.getBoundingClientRect().width > 0;
  return {
    scrollHeight: de.scrollHeight,
    overflowX: de.scrollWidth > de.clientWidth ? de.scrollWidth - de.clientWidth : 0,
    htmlClass: de.className,
    desktopNav: vis(nav), burger: vis(burger),
    heroTitleSize: (() => { const e = document.querySelector('#hero-logo-ref, #hero-top-tagline');
      return e ? getComputedStyle(e).fontSize : null; })(),
    vh: getComputedStyle(de).getPropertyValue('--vh').trim(),
  };
};

const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(8000);

emit({ ev: 'phase', name: 'responsive', status: 'start', widths: WIDTHS });
const rows = [];
for (const w of WIDTHS) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(2200);
  const r = await page.evaluate(probe);
  rows.push({ w, ...r });
  emit({ ev: 'row', kind: 'responsive', w, ...r });
  console.log(`  ${String(w).padStart(4)}  h=${String(r.scrollHeight).padStart(6)}  overflowX=${r.overflowX}  nav=${r.desktopNav ? 'desktop' : '-'} burger=${r.burger ? 'yes' : '-'}  hero=${r.heroTitleSize}`);
}
writeFileSync(join(OUT, 'RESPONSIVE.json'), JSON.stringify({ url: URL_, rows, errors: errs }, null, 2), 'utf8');
emit({ ev: 'done', cmd: 'responsive', rows: rows.length, overflow: rows.filter(r => r.overflowX > 0).length, errors: errs.length, exit: 0 });
console.log(`  overflow-Verstöße: ${rows.filter(r => r.overflowX > 0).length} · pageerrors: ${errs.length}`);
await b.close();
