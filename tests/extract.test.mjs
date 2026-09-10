// Selbsttest fuer tools/extract.mjs gegen tests/fixture/index.html.
// Die Fixture enthaelt drei Faelle, die sich anders verhalten muessen:
//   #card   Hover-Transition           420ms, zwei Eigenschaften
//   #pulse  Endlose CSS-Keyframes      900ms, loops, NICHT die Messfensterbreite
//   #reveal Scroll-Reveal per IO       600ms, nur nach echtem Reload messbar
//
// Alle drei sind schon einmal falsch gemessen worden. Deshalb stehen sie hier.
//
// Lauf: node tests/extract.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Der Port laesst sich ueberschreiben: laeuft schon etwas darauf, misst der Test
// sonst gegen die fremde Seite und meldet einen Selector-Fehler, der keiner ist.
const PORT = Number(process.env.PARITY_TEST_PORT ?? 4191);
const OUT = join(ROOT, 'tests/.out');

const run = (script, args) => new Promise((res, rej) => {
  const c = spawn(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  c.stdout.on('data', d => { out += d; });
  c.stderr.on('data', d => { err += d; });
  c.on('exit', code => code === 0 ? res(out) : rej(new Error(`${script} exit ${code}\n${err}${out}`)));
});

const server = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), join(ROOT, 'tests/fixture'), String(PORT)],
  { cwd: ROOT, stdio: 'ignore' });
const stop = () => { server.kill(); };
process.on('exit', stop);

const meta = slug => JSON.parse(readFileSync(join(OUT, slug, 'metadata.json'), 'utf8'));
const url = `http://localhost:${PORT}/`;
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); } };

try {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  await new Promise(r => setTimeout(r, 800));

  // ── Hover-Transition ──────────────────────────────────────────────────────
  await run('tools/extract.mjs', [url, '--selector', '#card', '--out', join(OUT, 'card'), '--repeat', '2']);
  const card = meta('card');
  console.log('\n#card — Hover-Transition');
  check('Trigger automatisch als hover erkannt', () => assert.equal(card.triggers[0], 'hover'));
  check('transform und opacity als bewegt erkannt', () => {
    assert.ok(card.properties.includes('transform'), 'transform fehlt in ' + JSON.stringify(card.properties));
    assert.ok(card.properties.includes('opacity'), 'opacity fehlt');
  });
  check('Dauer nahe den deklarierten 420ms', () => {
    assert.ok(card.timing.durationMs > 300 && card.timing.durationMs < 600, 'war ' + card.timing.durationMs);
  });
  check('als isolierbar eingestuft', () => assert.equal(card.isolatability, 'isolatable'));
  // Die Fixture hat KEINE prefers-reduced-motion-Regel. Wer das ueber laufende
  // Animationen im Ruhezustand prueft, bekommt hier faelschlich "respektiert" —
  // bei einem Hover-Effekt laeuft im Ruhezustand naemlich nie etwas.
  check('Reduced Motion korrekt als ignoriert erkannt', () => {
    assert.equal(card.reducedMotion.probed, true);
    assert.equal(card.reducedMotion.respected, false, 'Fixture hat keine reduced-motion-Regel');
  });
  check('isolierte Fassung geschrieben', () => {
    assert.ok(existsSync(join(OUT, 'card/vanilla/index.html')));
    assert.match(readFileSync(join(OUT, 'card/vanilla/style.css'), 'utf8'), /:hover/);
  });

  // ── Endlose Keyframes ─────────────────────────────────────────────────────
  await run('tools/extract.mjs', [url, '--selector', '#pulse', '--out', join(OUT, 'pulse'), '--repeat', '2']);
  const pulse = meta('pulse');
  console.log('\n#pulse — endlose CSS-Keyframes');
  check('als loop erkannt', () => assert.equal(pulse.triggers[0], 'loop'));
  check('Dauer 900ms aus der Engine, nicht aus der Abtastung', () => {
    assert.equal(pulse.timing.durationMs, 900, 'war ' + pulse.timing.durationMs);
    assert.equal(pulse.timing.durationSource, 'engine');
  });
  check('Endlosschleife markiert', () => assert.equal(pulse.timing.loops, true));
  check('Abtastwert getrennt ausgewiesen', () => {
    assert.ok(pulse.timing.sampledDurationMs > 1500, 'Abtastung sollte die Fensterbreite melden');
  });
  check('Keyframes im isolierten CSS', () => {
    assert.match(readFileSync(join(OUT, 'pulse/vanilla/style.css'), 'utf8'), /@(-\w+-)?keyframes\s+pulse/);
  });

  // ── Scroll-Reveal ─────────────────────────────────────────────────────────
  await run('tools/extract.mjs', [url, '--selector', '#reveal', '--out', join(OUT, 'reveal'), '--repeat', '2']);
  const rev = meta('reveal');
  console.log('\n#reveal — Scroll-Reveal per IntersectionObserver');
  check('als scroll erkannt', () => assert.equal(rev.triggers[0], 'scroll'));
  check('Bewegung ueberhaupt gemessen', () => {
    assert.ok(rev.properties.length > 0, 'nichts gemessen — feuert der Reveal vor der Messung?');
  });
  check('Dauer nahe den deklarierten 600ms', () => {
    assert.ok(rev.timing.durationMs > 400 && rev.timing.durationMs < 900, 'war ' + rev.timing.durationMs);
  });
  check('IntersectionObserver mit Schwelle erfasst', () => {
    assert.equal(rev.dependencies.intersectionObservers[0].threshold, 0.25);
  });
  check('wegen Scroll-Abhaengigkeit nur teilweise isolierbar', () => assert.equal(rev.isolatability, 'partial'));

  // ── Nachbau ───────────────────────────────────────────────────────────────
  // Alle vier Pruefungen hier decken Fehler ab, die der Generator schon
  // gemacht hat. Ein Nachbau, der falsch ist, ist schlimmer als keiner.
  for (const slug of ['card', 'pulse', 'reveal']) await run('tools/rebuild.mjs', [join(OUT, slug)]);
  const cardCss = readFileSync(join(OUT, 'card/rebuilt/style.css'), 'utf8');
  const pulseCss = readFileSync(join(OUT, 'pulse/rebuilt/style.css'), 'utf8');
  const revCss = readFileSync(join(OUT, 'reveal/rebuilt/style.css'), 'utf8');
  const revJs = readFileSync(join(OUT, 'reveal/rebuilt/script.js'), 'utf8');

  console.log('\nNachbau');
  check('jede Eigenschaft bekommt ihr eigenes Timing', () => {
    // "transition: transform, opacity 420ms ease" ist gueltige Syntax und
    // trotzdem falsch — transform liefe dann mit 0s.
    const t = /transition:([\s\S]*?);/.exec(cardCss);
    assert.ok(t, 'keine transition erzeugt');
    // Auf oberster Ebene trennen: die Kommas in cubic-bezier(.22, 1, .36, 1)
    // gehoeren zur Kurve, nicht zur Liste.
    const parts = t[1].split(/,(?![^(]*\))/);
    assert.equal(parts.length, 2, 'erwartet zwei Eigenschaften, bekam: ' + t[1].trim());
    for (const p of parts) assert.match(p, /\d+ms/, 'ohne Dauer: ' + p.trim());
  });
  check('transform ist lesbar, keine matrix()', () => {
    assert.doesNotMatch(cardCss, /matrix\(/, 'matrix() statt translate/scale');
    assert.match(cardCss, /translateY\(-12px\)|scale\(1\.03\)/);
  });
  check('gemessene Layout-Breite nicht einbetoniert', () => {
    // Die Breite eines Block-Elements ist die Breite des Elternteils, nicht
    // eine Eigenschaft der Komponente.
    assert.doesNotMatch(cardCss.split('@media')[0], /^\s*width:/m, 'width aus dem Layout uebernommen');
  });
  check('deklarierte Groesse bleibt erhalten', () => {
    assert.match(pulseCss, /width:\s*64px/, 'der 64px-Kreis braucht seine Groesse');
  });
  check('Keyframes mit echten Offsets', () => {
    assert.match(pulseCss, /@keyframes/);
    assert.match(pulseCss, /0%\s*\{[\s\S]*?100%\s*\{/);
  });
  check('kein abgetasteter Zwischenframe im Grundzustand', () => {
    // Bei einer Endlosschleife ist der erste gemessene Frame ein zufaelliger
    // Punkt mitten in der Animation — er gehoert nicht in die Grundregel.
    const base = pulseCss.split('@keyframes')[0];
    assert.doesNotMatch(base, /opacity:\s*0\.\d{3,}/, 'Zwischenwert im Grundzustand');
  });
  check('Zustandsregel des Reveals ist nicht leer', () => {
    // opacity:1 und transform:none SIND das Ziel — sie als Vorgabewerte
    // wegzufiltern liefert eine leere Regel und einen unsichtbaren Nachbau.
    const st = /\.[\w-]+\.is-visible\s*\{([\s\S]*?)\}/.exec(revCss);
    assert.ok(st, 'keine is-visible-Regel');
    assert.match(st[1], /opacity:\s*1/, 'Endzustand fehlt: ' + st[1].trim());
  });
  check('Reduced Motion versteckt den Reveal nicht', () => {
    const rm = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}/.exec(revCss);
    assert.ok(rm, 'kein reduced-motion-Block');
    assert.match(rm[1], /opacity:\s*1/, 'Inhalt bliebe unsichtbar');
  });
  check('Reduced Motion friert Hover nicht ein', () => {
    // Beim Hover waere der Endzustand hier falsch — die Karte staende dann
    // dauerhaft angehoben.
    const rm = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}/.exec(cardCss);
    assert.doesNotMatch(rm[1], /translateY/, 'Hover-Endzustand faelschlich gesetzt');
  });
  check('gemessene IO-Schwelle landet im Nachbau', () => {
    assert.match(revJs, /threshold:\s*0\.25/);
    assert.match(revJs, /rootMargin/);
  });
  check('Demos laufen auch per Doppelklick (file://)', () => {
    // type="module" wird beim Oeffnen per file:// von der CORS-Regel blockiert.
    // Die Demo sieht dann heil aus und ist tot: kein Trigger, keine Steuerung.
    for (const f of ['card/rebuilt/index.html', 'card/vanilla/index.html', 'reveal/rebuilt/index.html']) {
      const html = readFileSync(join(OUT, f), 'utf8');
      assert.doesNotMatch(html, /<script[^>]*type=["']module["']/, 'Modul-Script in ' + f);
    }
    assert.doesNotMatch(readFileSync(join(OUT, 'card/rebuilt/script.js'), 'utf8'), /^\s*(export|import)\s/m,
      'export/import zwingt zum Modul');
  });
  check('React und Svelte erzeugt', () => {
    assert.ok(existsSync(join(OUT, 'card/react/Component.jsx')));
    assert.ok(existsSync(join(OUT, 'card/svelte/Component.svelte')));
    const jsx = readFileSync(join(OUT, 'card/react/Component.jsx'), 'utf8');
    assert.doesNotMatch(jsx, /useRef/, 'ungenutzter ref beim Hover-Trigger');
  });
  check('Nachbau nutzt nur eigene, am Slug verankerte Selektoren', () => {
    // Der ganze Punkt: der Nachbau uebernimmt keine Selektorstruktur der
    // Quellseite. Jede Regel haengt am eigenen Wurzelnamen — kein `.wrap`,
    // kein Nachkommen-Selektor, den es nur im Original gibt.
    for (const [slug, css] of [['card', cardCss], ['pulse', pulseCss], ['reveal', revCss]]) {
      const selectors = css
        .replace(/\/\*[\s\S]*?\*\//g, '')                 // Kommentare raus
        .split('\n')
        .filter(l => l.trim().endsWith('{'))
        .map(l => l.replace('{', '').trim())
        // @keyframes/@media sind At-Regeln, keine Selektoren; die Prozentmarken
        // und from/to darin auch nicht.
        .filter(s => s && !s.startsWith('@') && !/^\d+%$/.test(s) && s !== 'from' && s !== 'to');
      assert.ok(selectors.length, 'keine Selektoren in ' + slug);
      for (const s of selectors) {
        assert.ok(s.startsWith('.' + slug), `fremder Selektor in ${slug}: "${s}"`);
      }
    }
  });

  // ── ZIP ───────────────────────────────────────────────────────────────────
  // Ein selbstgeschriebenes Archivformat glaubt man erst, wenn es sich wieder
  // auslesen laesst. Geprueft wird gegen das zentrale Verzeichnis, nicht gegen
  // die eigene Vorstellung vom Aufbau.
  console.log('\nZIP');
  {
    const { zip } = await import('../tools/zip.mjs');
    const { inflateRawSync } = await import('node:zlib');
    const cases = [
      { name: 'a.txt', data: 'hallo\n'.repeat(200) },                 // komprimierbar
      { name: 'sub/dir/b.css', data: '.x{color:red}' },               // Unterverzeichnis
      { name: 'ümlaut/größe.txt', data: 'Straße & Gruß' },            // UTF-8-Name
      { name: 'raw.bin', data: Buffer.from([0, 1, 2, 253, 254, 255]) }, // binaer, kaum komprimierbar
    ];
    const buf = zip(cases);

    check('Signaturen und Eintragszahl stimmen', () => {
      assert.equal(buf.readUInt32LE(0), 0x04034b50, 'kein lokaler Header am Anfang');
      const eocdAt = buf.length - 22;
      assert.equal(buf.readUInt32LE(eocdAt), 0x06054b50, 'kein End-of-Central-Directory');
      assert.equal(buf.readUInt16LE(eocdAt + 10), cases.length);
    });

    check('jeder Eintrag laesst sich wieder herausholen', () => {
      const eocdAt = buf.length - 22;
      let p = buf.readUInt32LE(eocdAt + 16);          // Anfang des zentralen Verzeichnisses
      const got = new Map();
      for (let i = 0; i < cases.length; i++) {
        assert.equal(buf.readUInt32LE(p), 0x02014b50, 'Verzeichniseintrag ' + i + ' kaputt');
        const method = buf.readUInt16LE(p + 10);
        const csize = buf.readUInt32LE(p + 20);
        const usize = buf.readUInt32LE(p + 24);
        const nlen = buf.readUInt16LE(p + 28);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
        // Im lokalen Header steht der Name noch einmal — dahinter die Daten.
        const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const body = buf.slice(dataAt, dataAt + csize);
        const raw = method === 8 ? inflateRawSync(body) : body;
        assert.equal(raw.length, usize, 'Groesse passt nicht bei ' + name);
        got.set(name, raw);
        p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
      }
      for (const c of cases) {
        const raw = got.get(c.name);
        assert.ok(raw, 'Eintrag fehlt: ' + c.name);
        const want = Buffer.isBuffer(c.data) ? c.data : Buffer.from(c.data, 'utf8');
        assert.ok(raw.equals(want), 'Inhalt weicht ab bei ' + c.name);
      }
    });

    check('UTF-8-Flag fuer Namen mit Umlauten gesetzt', () => {
      // Ohne Bit 11 liest Windows den Namen in der alten Codepage — aus
      // "größe.txt" wird dann Buchstabensalat.
      assert.equal(buf.readUInt16LE(6) & 0x0800, 0x0800);
    });

    check('unkomprimierbares bleibt unkomprimiert', () => {
      // Deflate auf Zufallsdaten macht die Datei groesser. Dann roh ablegen.
      const tiny = zip([{ name: 'r.bin', data: Buffer.from([0, 1, 2, 253, 254, 255]) }]);
      assert.equal(tiny.readUInt16LE(8), 0, 'haette roh gespeichert werden muessen');
    });
  }

  // ── Schema ────────────────────────────────────────────────────────────────
  console.log('\nSchema');
  const FIELDS = ['id', 'slug', 'title', 'source', 'route', 'selector', 'domPath', 'category', 'triggers',
    'techniques', 'properties', 'timing', 'easing', 'dependencies', 'assets', 'responsive', 'accessibility',
    'reducedMotion', 'isolatability', 'confidence', 'previews', 'code', 'status', 'warnings', 'createdAt'];
  check('alle Pflichtfelder vorhanden', () => {
    for (const f of FIELDS) assert.ok(f in card, 'Feld fehlt: ' + f);
  });
  const STATUS = ['candidate', 'inspected', 'isolated', 'rebuilt', 'verified', 'exported', 'needs-review', 'not-isolatable'];
  check('status ist ein erlaubter Wert', () => {
    for (const m of [card, pulse, rev]) assert.ok(STATUS.includes(m.status), 'unbekannt: ' + m.status);
  });
  check('isolatability ist ein erlaubter Wert', () => {
    for (const m of [card, pulse, rev]) assert.ok(['isolatable', 'partial', 'reference-only', 'not-analysable'].includes(m.isolatability));
  });

  console.log(failed ? `\n✗ ${failed} Pruefung(en) fehlgeschlagen\n` : '\n✓ alle Pruefungen bestanden\n');
} finally {
  stop();
}
process.exit(failed ? 1 : 0);
