// Export einer einzelnen Extraktion — alles, was parity ohne fremdes Projekt
// aus einem Ergebnis herausgeben kann.
//
// Usage: node tools/export.mjs <extraction-dir> [--video] [--single] [--zip] [--all]
//   --video    Aufnahme der Preview als .webm
//   --single   eine eigenstaendige HTML-Datei, alles inline, laeuft per Doppelklick
//   --zip      das ganze Verzeichnis als Archiv
//   --all      alle drei (Vorgabe, wenn nichts angegeben ist)
//
// Bewusst allgemeine Formate. Selective Extraction ist in parity vollstaendig
// und haengt an keinem anderen Projekt — wer ein Ergebnis anderswohin bringen
// will, nimmt ZIP, JSON, die Einzeldatei oder die Komponentendateien mit.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, copyFileSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { zip } from './zip.mjs';
import { emit } from './_emit.mjs';

const argv = process.argv.slice(2);
const DIR = argv[0];
if (!DIR) {
  console.error('usage: node tools/export.mjs <extraction-dir> [--video] [--single] [--zip] [--all]');
  process.exit(2);
}
const picked = ['video', 'single', 'zip'].filter(f => argv.includes('--' + f));
const WANT = new Set(argv.includes('--all') || !picked.length ? ['video', 'single', 'zip'] : picked);

const metaPath = join(DIR, 'metadata.json');
if (!existsSync(metaPath)) { console.error(`✗ ${metaPath} nicht gefunden`); process.exit(1); }
const m = JSON.parse(readFileSync(metaPath, 'utf8'));
const SLUG = m.slug || basename(DIR);

// Welche Fassung gezeigt wird: der eigene Nachbau, wenn es ihn gibt. Sonst die
// isolierte — dann ist im Video Original-Code zu sehen, und das steht auch dran.
const useRebuilt = !!m.code?.rebuilt && existsSync(join(DIR, 'rebuilt/index.html'));
const previewDir = useRebuilt ? 'rebuilt' : 'vanilla';
const previewPage = join(DIR, previewDir, 'index.html');

// Bei einer WebGL- oder Canvas-Szene ist die isolierte Fassung ein leeres
// Rechteck: der Inhalt entsteht aus JS, das hier nicht mitlaeuft. Ein Video
// davon zeigt nichts. Aufgenommen wird dann die Originalseite, auf das Ziel
// ausgerichtet — dokumentierbar bleibt es dadurch trotzdem, und genau das ist
// bei "nur als Referenz" der Sinn.
const recordSource = !useRebuilt && m.isolatability === 'reference-only';

const done = {};

// ── Video ───────────────────────────────────────────────────────────────────
// Playwright nimmt selbst auf; ein zusaetzliches Werkzeug waere hier eine
// Abhaengigkeit fuer etwas, das schon im Haus ist.
if (WANT.has('video') && (recordSource || existsSync(previewPage))) {
  const { chromium } = await import('playwright');
  const tmp = join(tmpdir(), 'parity-video-' + Date.now());
  const browser = await chromium.launch(recordSource
    ? { args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
    : {});
  let ctx;
  const trigger = (m.triggers || ['load'])[0];
  try {
    const size = recordSource ? { width: 1280, height: 720 } : { width: 900, height: 600 };
    ctx = await browser.newContext({ viewport: size, recordVideo: { dir: tmp, size } });
    const page = await ctx.newPage();

    if (recordSource) {
      // Die Originalseite, auf das Ziel ausgerichtet. Eine WebGL-Szene braucht
      // deutlich laenger, bis sie steht — Modelle, Texturen, Decoder.
      await page.goto(m.source, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(9000);
      await page.locator(m.selector).first().scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
    } else {
      await page.goto(pathToFileURL(resolvePath(previewPage)).href, { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(1200);
    }

    const dur = Math.min(2500, (m.timing?.durationMs ?? 600) + 600);
    const target = recordSource ? m.selector : useRebuilt ? '.' + (m.rebuild?.root || SLUG) : '#parity-stage';

    // Dreimal, damit die Bewegung im Video als Bewegung lesbar ist und nicht
    // als einmaliges Zucken am Anfang.
    const rounds = recordSource ? 3 : 3;
    for (let i = 0; i < rounds; i++) {
      if (recordSource) {
        // Auf der echten Seite gibt es keine Fernsteuerung — der Trigger muss
        // mit Maus und Tastatur ausgeloest werden wie von Hand.
        const box = await page.locator(target).first().boundingBox().catch(() => null);
        const cx = box ? box.x + box.width / 2 : size.width / 2;
        const cy = box ? box.y + box.height / 2 : size.height / 2;
        if (trigger === 'drag' || trigger === 'pointer') {
          await page.mouse.move(cx, cy + 140);
          await page.mouse.down();
          await page.mouse.move(cx + (i - 1) * 60, cy - 180, { steps: 18 });
          await page.mouse.up();
        } else if (trigger === 'hover') {
          await page.mouse.move(2, 2); await page.waitForTimeout(300);
          await page.mouse.move(cx, cy, { steps: 12 });
        } else if (trigger === 'click') {
          await page.mouse.click(cx, cy).catch(() => {});
        } else if (trigger === 'scroll') {
          await page.mouse.wheel(0, 400); await page.waitForTimeout(600); await page.mouse.wheel(0, -400);
        }
        await page.waitForTimeout(2200);
      } else if (trigger === 'hover') {
        // Echter Mauszeiger: CSS :hover reagiert nicht auf ein synthetisches Event.
        await page.mouse.move(2, 2);
        await page.waitForTimeout(400);
        await page.locator(target).first().hover({ timeout: 4000, force: true }).catch(() => {});
        await page.waitForTimeout(dur);
      } else {
        await page.evaluate(() => window.parityPreview?.reset?.()).catch(() => {});
        await page.waitForTimeout(300);
        await page.evaluate(() => window.parityPreview?.fire?.()).catch(() => {});
        await page.waitForTimeout(dur);
      }
      if (m.timing?.loops && !recordSource) break;   // eine Schleife wiederholt sich selbst
    }
    await page.waitForTimeout(500);
    await ctx.close();
    ctx = null;

    const src = await page.video()?.path();
    if (src && existsSync(src)) {
      copyFileSync(src, join(DIR, 'preview.webm'));
      done.video = 'preview.webm';
      m.previews = { ...m.previews, video: 'preview.webm', videoShows: recordSource ? 'original' : previewDir };
      emit({ ev: 'shot', cmd: 'export', mark: 'preview-video', path: join(DIR, 'preview.webm') });
    }
  } catch (e) {
    console.error('  Video fehlgeschlagen: ' + String(e).slice(0, 140));
  } finally {
    await ctx?.close().catch(() => {});
    await browser.close().catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Eigenstaendige Einzeldatei ──────────────────────────────────────────────
// CSS und JS hinein, damit die Datei allein lauffaehig ist. Genau dafuer wollen
// Leute eine Einzeldatei: anhaengen, weitergeben, doppelklicken.
if (WANT.has('single') && existsSync(previewPage)) {
  let html = readFileSync(previewPage, 'utf8');
  const inline = (file, open, close) => {
    const p = join(DIR, previewDir, file);
    if (!existsSync(p)) return '';
    return open + '\n' + readFileSync(p, 'utf8') + '\n' + close;
  };
  html = html
    .replace(/<link rel="stylesheet" href="style\.css">/, inline('style.css', '<style>', '</style>'))
    .replace(/<script src="script\.js"><\/script>/, inline('script.js', '<script>', '<\/script>'));

  const banner = `<!--
  ${m.title} — von parity aus ${m.source} gemessen.
  ${useRebuilt
    ? 'Eigenstaendiger Nachbau: aus der Messung geschrieben, ohne das CSS der Quellseite.'
    : 'ACHTUNG: isolierte Fassung mit ORIGINAL-Code der Quellseite. Analyseergebnis,\n  keine eigene Komponente — nicht veroeffentlichen.'}
  Trigger ${(m.triggers || [])[0]} · ${m.timing?.durationMs ?? '—'}ms · ${(m.easing || [])[0] ?? '—'}
-->
`;
  const out = `${SLUG}.component.html`;
  writeFileSync(join(DIR, out), banner + html, 'utf8');
  done.single = out;
  m.code = { ...m.code, single: out, singleShows: previewDir };
}

// ── ZIP ─────────────────────────────────────────────────────────────────────
if (WANT.has('zip')) {
  const zipName = `${SLUG}.zip`;
  const walk = (d, base = '') => {
    const out = [];
    for (const e of readdirSync(d)) {
      // Ein Archiv, das sich selbst enthaelt, waere je nach Reihenfolge halb
      // oder gar nicht drin — und in keinem Fall das, was jemand erwartet.
      if (e === zipName) continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) out.push(...walk(p, base + e + '/'));
      else out.push({ name: base + e, data: readFileSync(p) });
    }
    return out;
  };
  // metadata.json zuletzt schreiben, deshalb hier schon den aktuellen Stand
  // hineinlegen statt den Stand von vor dem Video.
  const files = walk(DIR).filter(f => f.name !== 'metadata.json');
  files.unshift({ name: 'metadata.json', data: JSON.stringify(m, null, 2) });
  files.push({ name: 'LIESMICH.txt', data:
`${m.title}
Gemessen von parity aus ${m.source}
Selector: ${m.selector}
Trigger:  ${(m.triggers || []).join(', ')}
Dauer:    ${m.timing?.durationMs ?? '—'}ms (${m.timing?.durationSource ?? '—'})
Einstufung: ${m.isolatability} (Confidence ${m.confidence})

Was hier drin liegt
-------------------
metadata.json   die vollstaendige Messung
report.md       der lesbare Bericht
vanilla/        ISOLIERT: Original-Markup und Original-CSS der Quellseite.
                Analyseergebnis. Nicht veroeffentlichen.
${m.code?.rebuilt ? `rebuilt/        NACHBAU: aus der Messung geschrieben, kennt das
                Original-CSS nicht. Eigenstaendig.
react/          derselbe Nachbau als React-Komponente
svelte/         derselbe Nachbau als Svelte-Komponente
` : `NOT-REBUILT.md  warum fuer dieses Ziel kein Nachbau erzeugt wurde
`}preview-*.png   Aufnahmen zum Vergleich
${done.video ? 'preview.webm    Aufnahme der Preview\n' : ''}${done.single ? done.single + '   alles in einer Datei, laeuft per Doppelklick\n' : ''}
Fremde Assets und Schriften sind NICHT enthalten, nur verlinkt.
Lizenzen vor jeder Weiterverwendung pruefen.
` });

  writeFileSync(join(DIR, zipName), zip(files));
  done.zip = zipName;
  m.code = { ...m.code, zip: zipName };
}

writeFileSync(metaPath, JSON.stringify(m, null, 2), 'utf8');

emit({ ev: 'done', cmd: 'export', out: DIR, ...done, shows: previewDir, exit: 0 });
console.log(`✓ ${DIR}`);
for (const [k, v] of Object.entries(done)) console.log(`  ${k.padEnd(7)} ${v}`);
if (!Object.keys(done).length) console.log('  nichts erzeugt — fehlt die Preview?');
else if (recordSource) console.log('  Hinweis: Video von der ORIGINALSEITE — die isolierte Fassung waere ein leerer Canvas.');
 else if (!useRebuilt) console.log('  Hinweis: zeigt die ISOLIERTE Fassung (Original-Code) — es gibt keinen Nachbau.');
