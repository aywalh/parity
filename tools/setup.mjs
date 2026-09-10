// Einrichtung. Prueft die Umgebung und richtet auf Wunsch die Oberflaeche ein.
//
// Usage: node tools/setup.mjs [--ui | --no-ui]
//        parity --install
//
// Ohne Flag wird gefragt. Ohne Terminal (CI, Pipe) wird nicht geraten, sondern
// nach einem Flag verlangt — eine Verknuepfung anzulegen, ohne dass jemand ja
// gesagt hat, waere uebergriffig.
import { existsSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Die Version steht in package.json und nirgends sonst.
const VERSION = createRequire(import.meta.url)('../package.json').version;

// ── Ausgabe ─────────────────────────────────────────────────────────────────
// Farbe nur, wenn ein Terminal zuschaut. Gepipet oder mit NO_COLOR bleibt es
// reiner Text, sonst landen Escape-Sequenzen in Logdateien.
const TTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => TTY ? `\x1b[${code}m${s}\x1b[0m` : s;
const bold = s => c(1, s), dim = s => c(2, s);
const green = s => c(32, s), red = s => c(31, s), yellow = s => c(33, s);
const w = process.stdout.columns || 80;
const out = s => process.stdout.write(s + '\n');

// Die Marke im Terminal — dieselbe Form wie im Hilfetext des Dispatchers.
const header = () => {
  out('');
  out(`  ${bold('█▌▐█')}  ${bold('parity')}`);
  out('');
};

// ── Umgebung ────────────────────────────────────────────────────────────────
// Chrome und Edge im App-Modus. Wird auch von ui/server.mjs benutzt, damit es
// die Liste nur einmal gibt.
export const findBrowser = () => {
  const L = process.env.LOCALAPPDATA || '';
  const PF = process.env.ProgramFiles || 'C:\\Program Files';
  const P86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    [join(P86, 'Microsoft/Edge/Application/msedge.exe'), 'Edge'],
    [join(PF, 'Microsoft/Edge/Application/msedge.exe'), 'Edge'],
    [join(PF, 'Google/Chrome/Application/chrome.exe'), 'Chrome'],
    [join(P86, 'Google/Chrome/Application/chrome.exe'), 'Chrome'],
    [join(L, 'Google/Chrome/Application/chrome.exe'), 'Chrome'],
    ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'Chrome'],
    ['/usr/bin/google-chrome', 'Chrome'],
    ['/usr/bin/chromium', 'Chromium'],
  ];
  const hit = candidates.find(([p]) => existsSync(p));
  return hit ? { path: hit[0], name: hit[1] } : null;
};

// Der Agenten-Skill. Im Repo liegt unter skills/ nur die Quelle — installiert
// ist er erst, wenn der Agent ihn ausgepackt hat: entweder als Plugin (dann
// unter einer Versionsnummer, die hier niemanden interessiert) oder von Hand
// nach ~/.claude/skills/. Findet sich beides nicht, wird daran erinnert; ein
// Messlauf haengt nicht daran, deshalb blockiert es die Einrichtung nicht.
export const skillInstalled = () => {
  const home = homedir();
  if (existsSync(join(home, '.claude/skills/parity/SKILL.md'))) return true;
  const cache = join(home, '.claude/plugins/cache/parity/parity');
  try {
    return readdirSync(cache).some(v => existsSync(join(cache, v, 'skills/parity/SKILL.md')));
  } catch { return false; }
};

const checkEnvironment = async () => {
  const rows = [];

  const major = Number(process.versions.node.split('.')[0]);
  rows.push({ ok: major >= 18, label: 'Node', value: 'v' + process.versions.node,
              hint: major >= 18 ? '' : 'parity braucht Node 18 oder neuer' });

  let pw = null;
  try {
    pw = createRequire(import.meta.url)('playwright/package.json').version;
    rows.push({ ok: true, label: 'Playwright', value: pw });
  } catch {
    rows.push({ ok: false, label: 'Playwright', value: 'fehlt', hint: 'npm install' });
  }

  if (pw) {
    let exe = null;
    try { exe = (await import('playwright')).chromium.executablePath(); } catch {}
    const ok = Boolean(exe && existsSync(exe));
    rows.push({ ok, label: 'Chromium', value: ok ? 'installiert' : 'nicht heruntergeladen',
                hint: ok ? '' : 'npx playwright install chromium' });
  } else {
    rows.push({ ok: false, label: 'Chromium', value: 'ungeprüft', hint: 'erst Playwright installieren' });
  }

  const b = findBrowser();
  rows.push({ ok: Boolean(b), soft: true, label: 'App-Fenster', value: b ? b.name : 'kein Chrome/Edge',
              hint: b ? '' : 'die Oberfläche läuft dann im normalen Browser' });

  const skill = skillInstalled();
  rows.push({ ok: skill, soft: true, label: 'Agenten-Skill', value: skill ? 'installiert' : 'nicht installiert',
              hint: skill ? '' : '/plugin marketplace add aywalh/parity' });

  return rows;
};

const printChecks = rows => {
  out(`  ${dim('Umgebung')}`);
  out('');
  const pad = Math.max(...rows.map(r => r.label.length)) + 2;
  for (const r of rows) {
    const mark = r.ok ? green('✓') : yellow('!');
    out(`  ${mark}  ${r.label.padEnd(pad)}${r.value}`);
    if (r.hint) out(`  ${' '.repeat(pad + 3)}${dim(r.hint)}`);
  }
  out('');
};

// ── Auswahl ─────────────────────────────────────────────────────────────────
// Pfeiltasten statt J/n-Tippen. Faellt auf die erste Option zurueck, wenn das
// Terminal keinen Rohmodus kann.
export const select = (options) => new Promise(resolve => {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) return resolve(0);
  let i = 0;
  const lines = options.length + 3;
  const pad = Math.max(...options.map(o => o.label.length)) + 4;

  const draw = redraw => {
    if (redraw) process.stdout.write(`\x1b[${lines}A\x1b[0J`);
    out('');
    for (const [n, o] of options.entries()) {
      const label = o.label.padEnd(pad);
      out(n === i ? `  ${bold('❯')} ${bold(label)}${dim(o.hint)}`
                  : `    ${label}${dim(o.hint)}`);
    }
    out('');
    out(dim('  ↑↓ wählen · ⏎ bestätigen · esc abbrechen'));
  };

  const done = value => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.removeListener('data', onKey);
    resolve(value);
  };

  const onKey = k => {
    if (k === '\x1b[A' || k === 'k') { i = (i - 1 + options.length) % options.length; draw(true); }
    else if (k === '\x1b[B' || k === 'j') { i = (i + 1) % options.length; draw(true); }
    else if (k === '\r' || k === '\n') { draw(true); done(i); }
    else if (k === '\x1b' || k === '\x03') { done(-1); }
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onKey);
  draw(false);
});

// ── Verknuepfung ────────────────────────────────────────────────────────────
// Ziel ist node.exe direkt statt einer .cmd, damit kein Konsolenfenster im
// Vordergrund steht. In PowerShell einfach zitieren (Backslashes sind dort
// literal) und ueber eine Datei mit BOM statt -Command, sonst zerlegt die
// Konsolen-Codepage Umlaute im Pfad.
export const LNK = process.platform === 'win32'
  ? join(process.env.APPDATA || '', 'Microsoft/Windows/Start Menu/Programs/parity.lnk')
  : null;

const createShortcut = () => {
  const q = s => "'" + s.replace(/'/g, "''") + "'";
  const ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + q(LNK) + ')',
    '$s.TargetPath = ' + q(process.execPath),
    '$s.Arguments = ' + q('"' + join(ROOT, 'bin/parity.mjs') + '" ui'),
    '$s.WorkingDirectory = ' + q(ROOT),
    '$s.IconLocation = ' + q(join(ROOT, 'brand/app.ico')),
    '$s.Description = ' + q('parity'),
    '$s.WindowStyle = 7',
    '$s.Save()',
  ].join('\n');
  const script = join(tmpdir(), 'parity-shortcut.ps1');
  writeFileSync(script, '\uFEFF' + ps, 'utf8');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-File', script], { encoding: 'utf8' });
  rmSync(script, { force: true });
  return r.status === 0 ? null : (r.stderr || 'unbekannter Fehler').trim();
};

// ── Ablauf ──────────────────────────────────────────────────────────────────
const main = async () => {
  const args = process.argv.slice(2);
  const wantUi = args.includes('--ui') ? true
               : args.includes('--no-ui') ? false : null;

  header();
  out(`  ${bold('Einrichtung')}${' '.repeat(Math.max(1, w - 30))}${dim('parity ' + VERSION)}`);
  out('');

  const rows = await checkEnvironment();
  printChecks(rows);

  const blocking = rows.filter(r => !r.ok && !r.soft);
  if (blocking.length) {
    out(`  ${yellow('Nicht alles bereit.')} ${dim('Messläufe brauchen Playwright und Chromium.')}`);
    out(`  ${dim('Die Einrichtung läuft trotzdem weiter — nachholen geht jederzeit.')}`);
    out('');
  }

  let ui = wantUi;
  if (ui === null) {
    if (!process.stdin.isTTY) {
      out(`  ${red('Kein Terminal.')} Bitte ${bold('--ui')} oder ${bold('--no-ui')} angeben.`);
      process.exit(2);
    }
    out(`  ${bold('Was soll eingerichtet werden?')}`);
    const pick = await select([
      { label: 'CLI und Oberfläche', hint: 'Startmenü-Eintrag mit Fenster · empfohlen' },
      { label: 'Nur CLI', hint: 'kein Startmenü-Eintrag' },
    ]);
    if (pick === -1) { out(''); out(`  ${dim('abgebrochen — nichts geändert')}`); out(''); process.exit(130); }
    ui = pick === 0;
  }

  out('');
  if (ui && process.platform !== 'win32') {
    out(`  ${yellow('!')}  Startmenü-Einträge gibt es bisher nur unter Windows.`);
    out(`     ${dim('Die Oberfläche selbst läuft überall: parity ui')}`);
    ui = false;
  } else if (ui) {
    const err = createShortcut();
    if (err) {
      out(`  ${red('✗')}  Verknüpfung fehlgeschlagen`);
      out(`     ${dim(err.split('\n')[0])}`);
      process.exit(1);
    }
  }

  // ── Ergebnis ──────────────────────────────────────────────────────────────
  out(`  ${green('✓')}  ${bold(ui ? 'Eingerichtet' : 'Eingerichtet — nur CLI')}`);
  out('');
  const steps = [];
  if (ui) steps.push(['Startmenü', 'parity'],
                     ['Oberfläche starten', 'parity ui']);
  else steps.push(['Oberfläche bleibt verfügbar', 'parity ui']);
  steps.push(['Erster Messlauf', 'parity capture https://ziel.tld capture/orig']);
  const pad = Math.max(...steps.map(s => s[0].length)) + 3;
  for (const [k, v] of steps) out(`     ${dim(k.padEnd(pad))}${v}`);
  out('');

  // Ein fehlendes App-Fenster ist kein offener Punkt, sondern eine Auskunft —
  // der fehlende Skill dagegen schon, deshalb faellt hier nur das eine raus.
  const missing = rows.find(r => !r.ok && r.hint && r.label !== 'App-Fenster');
  if (missing) { out(`  ${yellow('Noch offen:')} ${bold(missing.hint)}`); out(''); }
  else if (ui) { out(`  ${dim('Zum Anheften: im Startmenü rechtsklicken → An Taskleiste anheften')}`); out(''); }
};

// Nur ausfuehren, wenn direkt aufgerufen — ui/server.mjs importiert von hier
// findBrowser und LNK, ohne dass die Einrichtung losläuft.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
