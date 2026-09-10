// Selbsttest fuer die Tastaturauswahl der Einrichtung.
//   node tools/setup.test.mjs
//
// Die Auswahl laesst sich nur mit echtem Terminal von Hand pruefen. Hier wird
// stdin und stdout untergeschoben, damit Umlauf, Bestaetigen, Abbrechen und
// die Zahl der neu gezeichneten Zeilen trotzdem nachweisbar sind.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { select, skillInstalled } from './setup.mjs';

const OPTS = [{ label: 'CLI und Oberfläche', hint: 'a' }, { label: 'Nur CLI', hint: 'b' }];

const realIn = process.stdin, realWrite = process.stdout.write.bind(process.stdout);

// Eine Auswahl durchspielen und zurueckgeben, was sie liefert und was sie malt.
const run = async keys => {
  const fake = new EventEmitter();
  Object.assign(fake, {
    isTTY: true, setRawMode() {}, resume() {}, pause() {}, setEncoding() {},
    removeListener: EventEmitter.prototype.removeListener.bind(fake),
  });
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
  let buf = '';
  process.stdout.write = s => { buf += s; return true; };

  const p = select(OPTS);
  for (const k of keys) fake.emit('data', k);
  const value = await p;

  process.stdout.write = realWrite;
  Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
  return { value, buf };
};

const UP = '\x1b[A', DOWN = '\x1b[B', ENTER = '\r', ESC = '\x1b';

// Direkt bestaetigen nimmt die erste Option.
assert.equal((await run([ENTER])).value, 0);

// Eins runter, dann bestaetigen.
assert.equal((await run([DOWN, ENTER])).value, 1);

// Runter und wieder hoch landet wieder oben.
assert.equal((await run([DOWN, UP, ENTER])).value, 0);

// Hoch von der ersten Option laeuft ans Ende um, nicht ins Negative.
assert.equal((await run([UP, ENTER])).value, OPTS.length - 1);

// Zweimal runter bei zwei Optionen ist wieder die erste.
assert.equal((await run([DOWN, DOWN, ENTER])).value, 0);

// esc und Strg-C brechen ab, ohne etwas auszuwaehlen.
assert.equal((await run([ESC])).value, -1);
assert.equal((await run(['\x03'])).value, -1);

// Der Cursor muss beim Neuzeichnen genau so viele Zeilen hoch, wie gemalt
// wurden — sonst wandert die Liste bei jedem Tastendruck durchs Bild.
const { buf } = await run([DOWN, ENTER]);
const up = Number(buf.match(/\x1b\[(\d+)A/)[1]);
const drawn = buf.split('\x1b[' + up + 'A')[0].split('\n').length - 1;
assert.equal(up, drawn, `Cursor faehrt ${up} Zeilen hoch, gezeichnet wurden ${drawn}`);

// Die Skill-Erkennung liest fremde Verzeichnisse, die es nicht geben muss.
// Sie darf deshalb nie werfen, sondern beantwortet die Frage mit ja oder nein.
assert.equal(typeof skillInstalled(), 'boolean');

console.log('✓ Auswahl: 8 Prüfungen bestanden');
console.log('✓ Skill-Erkennung: antwortet ohne zu werfen');
