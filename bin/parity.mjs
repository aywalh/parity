#!/usr/bin/env node
// parity — source-first frontend reconstruction with counter-measurement.
// Thin dispatcher: every subcommand forwards its arguments to the matching
// script in tools/, so each script stays runnable on its own.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const COMMANDS = {
  capture:    ['tools/capture.mjs',    '<url> [outDir]',              'Baseline: 3 Ladephasen, Console, Requests, Screenshots'],
  localize:   ['tools/localize.mjs',   '<url> <outDir> [--allow h]',  'Server-HTML holen, Tracking strippen, Guard installieren'],
  fetch:      ['tools/fetch-assets.mjs','<origin> <outDir> [seed ...]','Rekursive Asset-Discovery durch HTML/CSS/JS'],
  serve:      ['tools/serve.mjs',      '[root] [port]',               'Statischer Server mit korrekten MIME-Typen + Ranges'],
  verify:     ['tools/verify.mjs',     '<url> <out> [--shots] [--freeze]', 'Metriken, Canvas-Kontrast, 404s, Scroll-Marken'],
  interact:   ['tools/interact.mjs',   '<url> <outDir> [--steps m]',  'Interaktionsmatrix, generisch + optionale Site-Steps'],
  responsive: ['tools/responsive.mjs', '<url> <outDir>',              'Sweep über 15 Breiten, misst Breakpoints'],
  motion:     ['tools/motion.mjs',     '<url> [outDir]',              'Motion-Layer messen: Kurven, Dauern, Libraries'],
  depth:      ['tools/depth.mjs',      '<url> [outDir]',              'Reichweite messen: wie weit das Rad die Seite treibt'],
  diff:       ['tools/diff.mjs',       '<sourceDir> <cloneDir>',      'Gegenmessung auswerten — exit 1 bei Abweichung'],
  pxdiff:     ['tools/pxdiff.mjs',     '<a.png> <b.png>',             'Screenshot-Paar pixelweise — nur mit --freeze sinnvoll'],
  install:    ['tools/setup.mjs',      '[--ui|--no-ui]',              'Einrichtung: Umgebung pruefen, Oberflaeche optional'],
  ui:         ['ui/server.mjs',        '[port] [--no-window]',        'Oberflaeche: faehrt den ganzen Ablauf und zeigt ihn live'],
  extract:    ['tools/extract.mjs',    '<url> --selector <css>',      'Ein Element messen und isolieren statt der ganzen Seite'],
  rebuild:    ['tools/rebuild.mjs',    '<extraction-dir> [--shot]',   'Aus der Messung eine eigenstaendige Fassung schreiben'],
  export:     ['tools/export.mjs',     '<extraction-dir> [--all]',    'Video, Einzeldatei und ZIP einer Extraktion'],
  showcase:   ['tools/showcase.mjs',   '<extraction-dir> [--serve]',  'Eine Seite, die zeigt was gefunden wurde — und was nicht'],
};

// Welche Befehle zu welcher Methode gehoeren. Nur fuer die Hilfe — der
// Dispatcher behandelt alle gleich.
const GROUP = {
  'Full Clone — komplette Seite rekonstruieren und gegenmessen':
    ['capture', 'localize', 'fetch', 'serve', 'verify', 'interact', 'responsive', 'motion', 'depth', 'diff', 'pxdiff'],
  'Selective Extraction — einzelne Elemente, Animationen und Interaktionen':
    ['extract', 'rebuild', 'export', 'showcase'],
  'Einrichtung und Oberflaeche':
    ['install', 'ui'],
};

const [arg0, ...rest] = process.argv.slice(2);
// parity --install liest sich natuerlicher als parity install, beides gilt.
const cmd = arg0 === '--install' ? 'install' : arg0;

if (!cmd || cmd === '-h' || cmd === '--help' || !COMMANDS[cmd]) {
  const pad = Math.max(...Object.keys(COMMANDS).map(k => k.length));
  console.log(`
  [1m█▌▐█[0m  parity — source-first frontend reconstruction with counter-measurement

  Jeder Clone-Ansatz behauptet Treue. parity misst sie: dieselben Skripte
  laufen gegen Original UND Clone, nur die Differenz zählt.

${Object.entries(GROUP).map(([title, keys]) => `${title}:
${keys.filter(k => COMMANDS[k]).map(k => {
  const [, usage, desc] = COMMANDS[k];
  return `  ${k.padEnd(pad)}  ${usage.padEnd(29)} ${desc}`;
}).join('\n')}`).join('\n\n')}

Full Clone — der typische Ablauf:
  parity capture   https://ziel.tld capture/original
  parity localize  https://ziel.tld clone
  parity fetch     https://ziel.tld clone clone/index.html
  parity serve     clone 4173 &

  parity verify    https://ziel.tld       capture/orig  --shots
  parity verify    http://localhost:4173/ capture/clone --shots
  parity diff      capture/orig capture/clone

  diff ist der eigentliche Test. Ein Schritt, der auf beiden Seiten
  fehlschlägt, ist eine Grenze des Messverfahrens — kein Clone-Defekt,
  und diff zählt ihn auch nicht als solchen.

Selective Extraction — ein Element statt der ganzen Seite:
  parity extract https://ziel.tld --selector ".hero-title"
  parity extract https://ziel.tld --selector ".card" --trigger hover
  parity extract https://ziel.tld --selector "nav" --scope section --repeat 5

  Die ganze Seite bleibt die Analysequelle, das Ergebnis ist ein einzelnes
  Element. Es muss dafür nichts gecloned oder exportiert werden.
`);
  process.exit(cmd && !COMMANDS[cmd] ? 1 : 0);
}

const child = spawn(process.execPath, [join(ROOT, COMMANDS[cmd][0]), ...rest], { stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 0));
