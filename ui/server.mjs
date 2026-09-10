// parity ui — Server. Spawnt die CLI, streamt ihre --json-Events per SSE.
//
// Der Strom laeuft nur in eine Richtung, deshalb SSE statt WebSocket: eine
// Abhaengigkeit weniger und die halbe Fehlerklasse.
//
// Usage: node ui/server.mjs [port] [--no-window]
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve, sep, dirname } from 'node:path';
import { MIME, typeOf } from '../tools/mime.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(ROOT, 'ui');
const RUNS = join(ROOT, 'runs');
const EXTRACTIONS = join(ROOT, 'extractions');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
const PORT = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? 4174);
const CLONE_PORT = 4173;
const NO_WINDOW = process.argv.includes('--no-window');
// Loopback by default. The /api routes below start runs and read what they
// produced, so a bare listen(PORT) — which binds every interface — would hand
// that to anyone on the same network, unauthenticated. Opening it up is a
// deliberate flag: --host 0.0.0.0
const HOST = (() => {
  const a = process.argv.slice(2);
  const i = a.indexOf('--host');
  if (i !== -1 && a[i + 1]) return a[i + 1];
  const eq = a.find(x => x.startsWith('--host='));
  return eq ? eq.slice('--host='.length) : '127.0.0.1';
})();



// ── Laufzustand ─────────────────────────────────────────────────────────────
// Serverseitig gehalten: ein Reload spielt den ganzen Lauf nach, statt ihn zu
// verlieren. Ein Lauf gleichzeitig — ein zweiter Start wird abgelehnt.
const run = { id: null, url: null, dir: null, events: [], active: false, child: null };
const clients = new Set();

// ── Inspect-Ziel ────────────────────────────────────────────────────────────
// Die Seite, ueber die der Nutzer gerade mit der Maus faehrt. Sie liegt als
// lokalisierte Kopie auf DIESEM Server und damit same-origin zur Oberflaeche —
// nur so kommt der Picker an ihren DOM. Ein zweiter Port waere eine andere
// Origin und das iframe damit blind; das Original direkt einzubetten scheitert
// bei den meisten Produktionsseiten an X-Frame-Options.
//
// Es wird bewusst NICHT die ganze Seite geholt: localize laedt nur das HTML,
// alles andere kommt beim ersten Zugriff durch den Proxy unten nach. Selective
// Extraction soll keinen vollstaendigen Clone erzwingen.
const site = { url: null, origin: null, dir: null, slug: null };

const push = e => {
  e.t = Date.now();
  e.i = run.events.length;
  run.events.push(e);
  const line = 'data: ' + JSON.stringify(e) + '\n\n';
  for (const c of clients) c.write(line);
};

const webPath = p => {
  const a = resolve(ROOT, p);
  return a.startsWith(ROOT + sep) ? '/' + a.slice(ROOT.length + 1).split(sep).join('/') : p;
};

// Einen wirklich freien Port suchen, statt 4173 anzunehmen. Ein fremder
// parity serve auf demselben Port laesst unseren still scheitern — und dann
// misst verify die fremde Seite und meldet sie als Clone. Falsches Ergebnis
// ist schlimmer als gar keins.
// Geprueft wird durch Verbinden, nicht durch Binden: Windows laesst ein
// listen auf 127.0.0.1 zu, waehrend ein fremder Server schon auf 0.0.0.0
// liegt — der Port sieht dann frei aus und ist es nicht.
const freePort = (from = CLONE_PORT) => new Promise(res => {
  const c = connect({ port: from, host: '127.0.0.1' });
  const free = () => { c.destroy(); res(from); };
  c.setTimeout(400);
  c.once('connect', () => { c.destroy(); res(freePort(from + 1)); });
  c.once('error', free);
  c.once('timeout', free);
});

let cloneServer = null;
const startCloneServer = async dir => {
  cloneServer?.kill();
  const port = await freePort();
  cloneServer = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), dir, String(port)], { cwd: ROOT });
  cloneServer.stderr.on('data', d => push({ ev: 'stderr', cmd: 'serve', line: String(d).slice(0, 300) }));
  cloneServer.on('exit', () => { cloneServer = null; });
  push({ ev: 'serve', port, dir: webPath(dir) });
  return port;
};

// Ein CLI-Befehl. Loest auf, wenn der Prozess endet — nie mit reject, der
// Exit-Code gehoert zum Ergebnis (diff endet absichtlich mit 1).
const cli = (cmd, args) => new Promise(res => {
  push({ ev: 'cmd', name: cmd, args, status: 'start' });
  const child = spawn(process.execPath, [join(ROOT, 'bin/parity.mjs'), cmd, ...args, '--json'],
    { cwd: ROOT });
  run.child = child;
  let buf = '';
  child.stdout.on('data', d => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const o = JSON.parse(l);
        // Die Tools schreiben absolute Pfade. Der Client bekommt URLs unter der
        // Repo-Wurzel — er kann sie laden, und nichts leakt ausserhalb.
        for (const k of ['path', 'out']) if (o[k]) o[k] = webPath(o[k]);
        push({ ...o, cmd });
      } catch { push({ ev: 'log', cmd, line: l.slice(0, 500) }); }
    }
  });
  child.stderr.on('data', d => String(d).split('\n').filter(Boolean)
    .forEach(l => push({ ev: 'stderr', cmd, line: l.slice(0, 500) })));
  child.on('exit', code => {
    run.child = null;
    push({ ev: 'cmd', name: cmd, status: 'end', exit: code ?? 0 });
    res(code ?? 0);
  });
  child.on('error', e => { push({ ev: 'stderr', cmd, line: String(e) }); res(1); });
});

const slugOf = u => {
  const { host, pathname } = new URL(u);
  return host.replace(/[^a-z0-9.-]/gi, '_')
    + (pathname.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '-') || '');
};

const pipeline = async url => {
  const dir = join(RUNS, slugOf(url));
  const clone = join(dir, 'clone');
  const src = join(dir, 'capture/source');
  const cl = join(dir, 'capture/clone');
  const base = join(dir, 'capture/baseline');
  const origin = new URL(url).origin;
  run.dir = dir; run.url = url; run.id = String(Date.now());
  mkdirSync(dir, { recursive: true });
  push({ ev: 'run', status: 'start', url, dir: dir.slice(ROOT.length + 1).split(sep).join('/'), id: run.id });

  await cli('capture', [url, base]);
  await cli('localize', [url, clone]);

  // Runde 1: statische Discovery durch HTML/CSS/JS.
  const seeds = [join(clone, 'index.html')];
  if (existsSync(join(base, 'resources.txt'))) seeds.push(join(base, 'resources.txt'));
  push({ ev: 'loop', round: 1, status: 'start' });
  await cli('fetch', [origin, clone, ...seeds]);

  const port = await startCloneServer(clone);
  const cloneUrl = 'http://localhost:' + port + '/';
  run.clonePort = port;
  await new Promise(r => setTimeout(r, 600));

  await cli('verify', [url, src, '--shots']);
  await cli('verify', [cloneUrl, cl, '--shots']);

  // Runde 2: was erst zur Laufzeit angefragt wurde, steht jetzt in missing.txt.
  // Nur nachladen, wenn wirklich etwas fehlt — sonst ein zweiter Verify umsonst.
  const readMissing = () => existsSync(join(cl, 'missing.txt'))
    ? readFileSync(join(cl, 'missing.txt'), 'utf8').split('\n').filter(Boolean) : [];
  const missing = readMissing();
  push({ ev: 'loop', round: 1, status: 'end', missing: missing.length });
  if (missing.length) {
    push({ ev: 'loop', round: 2, status: 'start' });
    await cli('fetch', [origin, clone, join(cl, 'missing.txt')]);
    await cli('verify', [cloneUrl, cl, '--shots']);
    push({ ev: 'loop', round: 2, status: 'end', missing: readMissing().length });
  }

  await cli('interact', [url, src]);
  await cli('interact', [cloneUrl, cl]);
  await cli('responsive', [url, src]);
  await cli('responsive', [cloneUrl, cl]);

  const exit = await cli('diff', [src, cl]);
  push({ ev: 'run', status: 'end', exit });
};

// ── HTTP ────────────────────────────────────────────────────────────────────
const sendFile = (res, base, rel) => {
  // Trust boundary: nur Dateien unterhalb von base ausliefern.
  const p = resolve(base, '.' + rel.replace(/\\/g, '/'));
  if (!p.startsWith(resolve(base) + sep) && p !== resolve(base)) { res.writeHead(403); return res.end('403'); }
  if (!existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, {
    'content-type': MIME[extname(p).toLowerCase()] || 'application/octet-stream',
    'content-length': statSync(p).size, 'cache-control': 'no-cache',
  });
  createReadStream(p).pipe(res);
};

const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const path = decodeURIComponent(u.pathname);

  if (path === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    for (const e of run.events) res.write('data: ' + JSON.stringify(e) + '\n\n');   // Reload spielt nach
    if (!run.active) res.write('data: ' + JSON.stringify({ ev: 'idle' }) + '\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (path === '/api/run' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    let url;
    try { url = new URL(JSON.parse(body).url).href; }
    catch { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"err":"ungueltige URL"}'); }
    if (run.active) { res.writeHead(409, { 'content-type': 'application/json' }); return res.end('{"err":"Ein Lauf laeuft bereits"}'); }
    run.active = true; run.events = [];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url }));
    pipeline(url)
      .catch(e => push({ ev: 'run', status: 'error', err: String(e) }))
      .finally(() => { run.active = false; });
    return;
  }

  // Evidenz-Modus: der diff-Lauf gegen die mitgelieferten Referenzpaare.
  // Braucht kein Playwright und keine drei Minuten — zum Entwickeln und Zeigen.
  if (path === '/api/demo' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    const t = (JSON.parse(body || '{}').target || '').replace(/[^a-z0-9.-]/gi, '');
    const dir = join(ROOT, 'evidence', t);
    if (!t || !existsSync(dir)) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"err":"unbekanntes Ziel"}'); }
    if (run.active) { res.writeHead(409, { 'content-type': 'application/json' }); return res.end('{"err":"Ein Lauf laeuft bereits"}'); }
    run.active = true; run.events = []; run.url = t; run.dir = dir;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    push({ ev: 'run', status: 'start', url: t, dir: 'evidence/' + t, demo: true });
    cli('diff', [join(dir, 'source'), join(dir, 'clone')])
      .then(exit => push({ ev: 'run', status: 'end', exit }))
      .finally(() => { run.active = false; });
    return;
  }

  if (path === '/api/stop' && req.method === 'POST') {
    run.child?.kill();
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"ok":true}');
  }

  if (path === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      active: run.active, url: run.url, id: run.id,
      events: run.events.length, clonePort: run.clonePort ?? null,
    }));
  }

  // ── Selective Extraction ──────────────────────────────────────────────────

  // Ziel oeffnen: nur das HTML holen (localize), nicht die ganze Seite. Die
  // Assets kommen beim ersten Zugriff durch den Proxy weiter unten.
  if (path === '/api/inspect' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    let url;
    try { url = new URL(JSON.parse(body).url).href; }
    catch { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"err":"ungueltige URL"}'); }
    if (run.active) { res.writeHead(409, { 'content-type': 'application/json' }); return res.end('{"err":"Ein Lauf laeuft bereits"}'); }

    const slug = slugOf(url);
    const dir = join(RUNS, slug, 'site');
    run.active = true; run.events = [];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url, slug, frame: '/__site/' }));

    push({ ev: 'inspect', status: 'start', url, slug });
    mkdirSync(dir, { recursive: true });
    cli('localize', [url, dir])
      .then(exit => {
        site.url = url; site.origin = new URL(url).origin; site.dir = dir; site.slug = slug;
        push({ ev: 'inspect', status: exit === 0 ? 'ready' : 'error', url, slug, frame: '/__site/', exit });
      })
      .finally(() => { run.active = false; });
    return;
  }

  // Ein Ziel messen. Laeuft gegen die ORIGINAL-URL, nicht gegen die Kopie —
  // gemessen wird die echte Runtime, ausgewaehlt wurde nur auf der Kopie.
  if (path === '/api/extract' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    let o;
    try { o = JSON.parse(body); new URL(o.url); } catch { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"err":"ungueltige Anfrage"}'); }
    if (!o.selector) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"err":"kein Selector"}'); }
    if (run.active) { res.writeHead(409, { 'content-type': 'application/json' }); return res.end('{"err":"Ein Lauf laeuft bereits"}'); }

    const slug = (o.title || o.selector).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'element';
    const out = join('extractions', slug);
    const args = [o.url, '--selector', o.selector, '--out', out];
    if (o.trigger && o.trigger !== 'auto') args.push('--trigger', o.trigger);
    if (o.scope) args.push('--scope', o.scope);
    if (o.title) args.push('--title', o.title);
    if (o.repeat) args.push('--repeat', String(Number(o.repeat) || 3));

    run.active = true; run.events = [];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, slug, out: '/' + out.split(sep).join('/') }));

    push({ ev: 'extract', status: 'start', url: o.url, selector: o.selector, slug, out: '/' + out.split(sep).join('/') });
    // Messen, dann daraus die eigene Fassung schreiben. rebuild bleibt ein
    // eigener Befehl — es liest nur metadata.json und laesst sich deshalb
    // wiederholen, ohne noch einmal zu messen.
    cli('extract', args)
      .then(async exit => {
        if (exit === 0) {
          await cli('rebuild', [out, '--shot']);
          await cli('export', [out, '--all']);
        }
        push({ ev: 'extract', status: exit === 0 ? 'end' : 'error', slug, exit, out: '/' + out.split(sep).join('/') });
      })
      .finally(() => { run.active = false; });
    return;
  }

  // Was schon extrahiert wurde — fuer die Kandidatenliste in der UI.
  if (path === '/api/extractions') {
    const list = [];
    if (existsSync(EXTRACTIONS)) {
      for (const name of readdirSync(EXTRACTIONS)) {
        const f = join(EXTRACTIONS, name, 'metadata.json');
        if (!existsSync(f)) continue;
        try {
          const m = JSON.parse(readFileSync(f, 'utf8'));
          list.push({ slug: name, title: m.title, category: m.category, triggers: m.triggers,
                      isolatability: m.isolatability, confidence: m.confidence, status: m.status,
                      source: m.source, createdAt: m.createdAt, warnings: (m.warnings || []).length,
                      // Vorschaubild und Exporte, damit der Results-Bereich mehr
                      // als eine Textzeile pro Ergebnis zeigen kann.
                      previews: m.previews ?? {}, code: m.code ?? {},
                      duration: m.timing?.durationMs ?? null, techniques: m.techniques ?? [] });
        } catch { /* halb geschriebene Datei — beim naechsten Mal wieder */ }
      }
    }
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(list));
  }

  if (path.startsWith('/extractions/')) return sendFile(res, EXTRACTIONS, path.slice(12));
  if (path.startsWith('/runs/'))         return sendFile(res, RUNS, path.slice(5));
  if (path.startsWith('/evidence/'))     return sendFile(res, join(ROOT, 'evidence'), path.slice(9));
  if (path.startsWith('/__parity/brand/')) return sendFile(res, join(ROOT, 'brand'), path.slice(15));
  if (path.startsWith('/__parity/'))     return sendFile(res, UI, path.slice(9));
  if (path === '/')                      return sendFile(res, UI, '/index.html');
  if (path === '/__site' || path === '/__site/') return serveSite(res, '/index.html', u.search);

  // Alles Uebrige gehoert der inspizierten Seite. localize biegt ihre absoluten
  // Origin-URLs auf wurzelrelativ um, also landen ihre Assets genau hier — und
  // deshalb liegen die eigenen Dateien der Oberflaeche unter /__parity/.
  if (site.dir) return serveSite(res, path, u.search);
  res.writeHead(404); res.end('404');
});

// ── Die inspizierte Seite ausliefern ────────────────────────────────────────
// Lokal, wenn schon da. Sonst einmal vom Ursprung holen und ablegen. So muss
// vorher nichts vollstaendig heruntergeladen werden, und was einmal geholt
// wurde, kostet beim zweiten Mal nichts.
const serveSite = async (res, rel, search = '') => {
  if (!site.dir) { res.writeHead(503); return res.end('kein Inspect-Ziel geoeffnet'); }
  const clean = rel.split('?')[0];
  const p = resolve(site.dir, '.' + clean);
  if (!p.startsWith(resolve(site.dir) + sep) && p !== resolve(site.dir)) { res.writeHead(403); return res.end('403'); }

  if (existsSync(p) && statSync(p).isFile()) return sendFile(res, site.dir, clean);

  // Nicht da — beim Ursprung nachfragen.
  let upstream;
  try {
    upstream = await fetch(site.origin + clean + search, { headers: { 'user-agent': UA, referer: site.url } });
  } catch (e) {
    push({ ev: 'stderr', cmd: 'proxy', line: clean + ' → ' + String(e).slice(0, 120) });
    res.writeHead(502); return res.end('502');
  }
  if (!upstream.ok) { res.writeHead(upstream.status); return res.end(String(upstream.status)); }

  const buf = Buffer.from(await upstream.arrayBuffer());
  const type = upstream.headers.get('content-type') || typeOf(clean);
  // Nur ablegen, wenn der Pfad ohne Query eindeutig ist — sonst ueberschreiben
  // sich zwei Varianten derselben Datei gegenseitig.
  if (!search) {
    try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf); } catch { /* Cache ist Kuer */ }
  }
  push({ ev: 'asset', cmd: 'proxy', path: clean, status: upstream.status, bytes: buf.length });
  res.writeHead(200, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'no-cache' });
  res.end(buf);
};

// ── Verknuepfung ────────────────────────────────────────────────────────────
// Startmenue-Eintrag mit der Marke als Icon. Ziel ist node.exe direkt statt der
// .cmd, damit kein Konsolenfenster im Vordergrund steht — minimiert laeuft es
// mit, sichtbar genug zum Beenden.
if (process.argv.includes('--install')) {
  if (process.platform !== 'win32') {
    console.error('--install gibt es bisher nur unter Windows.');
    process.exit(1);
  }
  const lnk = join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/parity.lnk');
  // In PowerShell einfach zitieren: dort sind Backslashes literal. Und ueber
  // eine Datei mit BOM statt -Command, sonst zerlegt die Konsolen-Codepage
  // Umlaute im Pfad — dieses Repo liegt unter "pläne".
  const q = s => "'" + s.replace(/'/g, "''") + "'";
  const ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + q(lnk) + ')',
    '$s.TargetPath = ' + q(process.execPath),
    '$s.Arguments = ' + q('"' + join(ROOT, 'bin/parity.mjs') + '" ui'),
    '$s.WorkingDirectory = ' + q(ROOT),
    '$s.IconLocation = ' + q(join(ROOT, 'brand/app.ico')),
    '$s.Description = ' + q('parity'),
    '$s.WindowStyle = 7',
    '$s.Save()',
  ].join('\n');
  const script = join(tmpdir(), 'parity-shortcut.ps1');
  writeFileSync(script, '﻿' + ps, 'utf8');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-File', script], { encoding: 'utf8' });
  rmSync(script, { force: true });
  if (r.status !== 0) { console.error(r.stderr || 'Verknuepfung fehlgeschlagen'); process.exit(1); }
  console.log('✓ Startmenue: parity');
  console.log('  ' + lnk);
  console.log('  Zum Anheften: im Startmenue rechtsklicken → An Taskleiste anheften');
  process.exit(0);
}

// Zweiter Klick auf die Verknuepfung, waehrend schon eine Instanz laeuft: das
// ist kein Fehler, sondern der Normalfall bei einer App. Fenster auf die
// laufende Instanz oeffnen statt mit einem Stacktrace in einem minimierten
// Konsolenfenster zu sterben, das niemand sieht.
server.on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log('parity laeuft bereits auf ' + PORT);
  if (NO_WINDOW) process.exit(1);
  openWindow('http://localhost:' + PORT + '/');
});

server.listen(PORT, HOST, () => {
  const url = 'http://localhost:' + PORT + '/';
  console.log('parity → ' + url);
  if (!NO_WINDOW) openWindow(url);
});

// ── App-Fenster ─────────────────────────────────────────────────────────────
// Chrome/Edge im App-Modus: eigenes Fenster ohne Adressleiste, eigener
// Taskleisten-Eintrag. Kein Framework, kein Paket — nur ein Startflag.
// Eigenes Profilverzeichnis ist Pflicht: sonst reicht der neue Prozess das
// Fenster an eine laufende Browser-Instanz weiter und endet sofort.
function openWindow(url) {
  const L = process.env.LOCALAPPDATA || '';
  const PF = process.env.ProgramFiles || 'C:\\Program Files';
  const P86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    join(P86, 'Microsoft/Edge/Application/msedge.exe'),
    join(PF, 'Microsoft/Edge/Application/msedge.exe'),
    join(PF, 'Google/Chrome/Application/chrome.exe'),
    join(P86, 'Google/Chrome/Application/chrome.exe'),
    join(L, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ];
  const bin = candidates.find(p => existsSync(p));
  if (!bin) return console.log('  (kein Chrome/Edge gefunden — im Browser oeffnen)');

  const profile = join(RUNS, '.window-profile');
  mkdirSync(profile, { recursive: true });
  const win = spawn(bin, ['--app=' + url, '--user-data-dir=' + profile,
    '--window-size=1600,1000', '--no-first-run', '--no-default-browser-check'], { stdio: 'ignore' });
  // Fenster zu = Programm beendet. Sonst bliebe ein Node-Prozess liegen.
  win.on('exit', () => { cloneServer?.kill(); run.child?.kill(); process.exit(0); });
  win.on('error', () => console.log('  (Fenster konnte nicht geoeffnet werden — im Browser oeffnen)'));
}

process.on('SIGINT', () => { cloneServer?.kill(); run.child?.kill(); process.exit(0); });
