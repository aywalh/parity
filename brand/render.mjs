// Rasterises the brand assets. The wordmark SVG references a font stack, so the
// PNG produced here is the canonical version — it no longer depends on which
// fonts a viewer happens to have.
//   node brand/render.mjs
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const MARK = (fill, x = 8) =>
  `<rect x="${x}" y="8" width="22" height="48" fill="${fill}"/>` +
  `<rect x="${x + 26}" y="8" width="22" height="48" fill="${fill}"/>`;

const browser = await chromium.launch();

const shoot = async (html, { width, height, scale = 1, out, transparent = true }) => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await page.setContent(`<style>
    html,body{margin:0;padding:0;${transparent ? 'background:transparent' : ''};
      font-family:ui-monospace,'SF Mono','JetBrains Mono',Menlo,Consolas,monospace}
  </style>${html}`);
  await page.waitForTimeout(400);
  const buf = await page.screenshot({ omitBackground: transparent });
  writeFileSync(join(DIR, out), buf);
  console.log(`  ${out}  ${width}×${height}${scale > 1 ? ` @${scale}x` : ''}`);
  await page.close();
};

// ── Favicons (PNG fallbacks for the SVG) ──────────────────────────────────
for (const s of [16, 32, 180, 512]) {
  await shoot(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${s}" height="${s}">${MARK('#0A0A0A')}</svg>`,
    { width: s, height: s, out: `favicon-${s}.png` });
}

// ── Wordmark, both themes ─────────────────────────────────────────────────
const wordmark = fill => `
  <div style="display:flex;align-items:center;gap:18px;padding:24px 28px">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="52" height="52">${MARK(fill)}</svg>
    <span style="font-size:46px;font-weight:600;letter-spacing:-1px;color:${fill};line-height:1">parity</span>
  </div>`;
await shoot(wordmark('#0A0A0A'), { width: 260, height: 100, scale: 3, out: 'wordmark-dark.png' });
await shoot(wordmark('#FAFAFA'), { width: 260, height: 100, scale: 3, out: 'wordmark-light.png' });

// ── GitHub social preview (1280×640) ──────────────────────────────────────
await shoot(`
  <div style="width:1280px;height:640px;background:#0A0A0A;display:flex;flex-direction:column;
              justify-content:center;padding:0 96px;box-sizing:border-box">
    <div style="display:flex;align-items:center;gap:26px;margin-bottom:34px">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="86" height="86">${MARK('#FAFAFA')}</svg>
      <span style="font-size:78px;font-weight:600;letter-spacing:-2px;color:#FAFAFA;line-height:1">parity</span>
    </div>
    <div style="font-size:32px;color:#A1A1AA;line-height:1.45;max-width:940px">
      Source-first frontend reconstruction<br>with counter-measurement.
    </div>
    <div style="margin-top:46px;font-size:23px;color:#52525B;line-height:1.7">
      <span style="color:#4ADE80">✓</span> scrollHeight&nbsp;&nbsp;56691&nbsp;&nbsp;→&nbsp;&nbsp;56691<br>
      <span style="color:#4ADE80">✓</span> responsive&nbsp;&nbsp;&nbsp;15 Breiten&nbsp;&nbsp;→&nbsp;&nbsp;alle identisch
    </div>
  </div>`, { width: 1280, height: 640, out: 'og-image.png', transparent: false });

// ── App-Icons ─────────────────────────────────────────────────────────────
// Startmenue und Taskleiste liegen auf unbekanntem Grund, deshalb bringt das
// App-Icon seinen eigenen mit: helle Marke auf #0A0A0A. Die Haelften stehen
// auf 8..56 von 64 — das liegt in der 80%-Sicherheitszone, die eine runde
// Maske uebrig laesst, also ist dasselbe Bild auch maskable.
const APP = `<div style="width:100%;height:100%;background:#0A0A0A;display:flex;
  align-items:center;justify-content:center">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">${MARK('#FAFAFA')}</svg>
</div>`;
for (const s of [192, 512]) await shoot(APP, { width: s, height: s, out: `app-${s}.png`, transparent: false });
await shoot(APP, { width: 256, height: 256, out: 'app-256.png', transparent: false });

// Windows-Verknuepfungen brauchen .ico. Ein ICO darf eine PNG-Nutzlast direkt
// enthalten: 6 Byte ICONDIR + 16 Byte Eintrag + die PNG-Bytes. Spart ein Paket.
const png = readFileSync(join(DIR, 'app-256.png'));
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);  // reserved, Typ 1 = Icon, 1 Bild
head[6] = 0; head[7] = 0;                      // 0 bedeutet 256 px
head[8] = 0; head[9] = 0;                      // Palette, reserviert
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
writeFileSync(join(DIR, 'app.ico'), Buffer.concat([head, png]));
console.log('  app.ico  256×256');

await browser.close();
console.log('✓ brand assets rendered');
