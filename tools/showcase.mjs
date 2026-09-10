// Showcase — eine lesbare Seite aus einer Extraktion.
//
// Usage: node tools/showcase.mjs <extraction-dir> [--serve [port]]
//
// Der Results-Bereich der Oberflaeche ist zum Arbeiten. Das hier ist zum
// Zeigen: eine Seite, die aus metadata.json und dem, was im Verzeichnis liegt,
// zusammenbaut, was gefunden wurde — Video, Aufnahmen, 3D-Modelle, Toene,
// Messwerte, Code.
//
// Sie sagt auch, was NICHT drin ist. Eine Showcase-Seite, die eine
// reference-only-Extraktion wie ein fertiges Bauteil praesentiert, waere die
// eine Luege, die dieses ganze Werkzeug vermeiden soll.
//
// Braucht einen Server (Module und Import-Map): --serve startet ihn gleich mit.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { emit } from './_emit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const DIR = argv[0];
if (!DIR) { console.error('usage: node tools/showcase.mjs <extraction-dir> [--serve [port]]'); process.exit(2); }
const metaPath = join(DIR, 'metadata.json');
if (!existsSync(metaPath)) { console.error(`✗ ${metaPath} nicht gefunden`); process.exit(1); }
const m = JSON.parse(readFileSync(metaPath, 'utf8'));

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kb = n => n < 1024 * 1024 ? Math.round(n / 1024) + ' KB' : (Math.round(n / 1024 / 102.4) / 10) + ' MB';
const has = f => f && existsSync(join(DIR, f));

// ── Was liegt im Verzeichnis ────────────────────────────────────────────────
const assetDir = join(DIR, 'assets');
const assets = existsSync(assetDir)
  ? readdirSync(assetDir).map(f => ({ f, ext: extname(f).slice(1).toLowerCase(), size: statSync(join(assetDir, f)).size }))
  : [];
// Alphabetisch, nicht nach Groesse: die Reihenfolge soll vorhersehbar sein,
// und der Betrachter startet mit dem ersten Eintrag. Nach Groesse zu sortieren
// laedt zuerst irgendein Beiwerk.
const models = assets.filter(a => a.ext === 'glb' || a.ext === 'gltf').sort((a, b) => a.f.localeCompare(b.f));
const sounds = assets.filter(a => ['mp3', 'ogg', 'wav', 'm4a'].includes(a.ext)).sort((a, b) => a.f.localeCompare(b.f));
const other = assets.filter(a => !models.includes(a) && !sounds.includes(a));

// Welche Modelle sich ohne Zusatzdecoder laden lassen — das entscheidet, was
// der Betrachter wirklich anzeigen kann.
for (const mo of models) {
  try {
    const b = readFileSync(join(assetDir, mo.f));
    const j = JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString('utf8'));
    mo.ext_used = j.extensionsUsed || [];
    mo.meshes = (j.meshes || []).length;
    mo.draco = mo.ext_used.some(e => /draco/i.test(e));
    mo.basis = mo.ext_used.some(e => /basisu|webp/i.test(e));
  } catch { mo.ext_used = []; mo.meshes = 0; }
}

const ISO = {
  isolatable: ['isolierbar', 'ok'],
  partial: ['teilweise isolierbar', 'limit'],
  'reference-only': ['nur als Referenz dokumentierbar', 'limit'],
  'not-analysable': ['nicht analysierbar', 'bad'],
};
const [isoText, isoCls] = ISO[m.isolatability] || [m.isolatability, ''];

// ── Was drin ist, was nicht ─────────────────────────────────────────────────
// Die ehrliche Bilanz. Sie steht oben, nicht im Kleingedruckten.
const gotIt = [], missing = [];
if (has(m.previews?.video)) gotIt.push('Aufnahme in Bewegung' + (m.previews.videoShows === 'original' ? ' (von der Originalseite)' : ''));
if (has(m.previews?.original)) gotIt.push('Aufnahmen des Originals');
if (models.length) gotIt.push(models.length + ' 3D-Modell' + (models.length > 1 ? 'e' : ''));
if (sounds.length) gotIt.push(sounds.length + ' Tondatei' + (sounds.length > 1 ? 'en' : ''));
gotIt.push('vollstaendige Messung als JSON');
if (m.code?.rebuilt) gotIt.push('eigenstaendiger Nachbau (HTML/CSS/JS, React, Svelte)');
else gotIt.push('isolierte Fassung mit Original-Code (Analyseergebnis)');

if (!m.code?.rebuilt) {
  missing.push('Kein eigenstaendiger Nachbau — ' + (m.isolatabilityReasons?.[0] || 'das Ziel ist nicht isolierbar.'));
}
if (m.techniques?.includes('webgl') || m.techniques?.includes('canvas')) {
  missing.push('Keine Spiellogik, Physik oder Shader. Was auf dem Canvas passiert, steht in gebuendeltem JavaScript der Quellseite, nicht in CSS.');
}
if (models.some(x => x.draco || x.basis)) missing.push('Die Modelle sind Draco-komprimiert und nutzen KTX2-Texturen. Der Betrachter unten dekodiert beides; ausserhalb davon braucht es dieselben Decoder.');
if (m.assets?.length) missing.push('Schriften und Bilder der Quellseite sind nicht mitkopiert, nur verlinkt.');

const card = (label, value, cls = '') => value == null || value === '' ? '' :
  `<div class="kv"><b>${esc(label)}</b><span class="${cls}">${value}</span></div>`;

const page = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${esc(m.title)} — parity showcase</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root {
  --bg:#0A0A0A; --fg:#FAFAFA; --muted:#8A8A8A; --line:#1E1E1E; --panel:#0F0F0F;
  --ok:#4ADE80; --bad:#F87171; --limit:#FACC15; --seam:4px;
  --mono: ui-monospace,"Cascadia Mono",Consolas,"SF Mono",Menlo,monospace;
}
@media (prefers-color-scheme: light){:root{--bg:#FAFAFA;--fg:#0A0A0A;--muted:#737373;--line:#E5E5E5;--panel:#FFF}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.6 var(--mono);
     font-variant-ligatures:none;-webkit-font-smoothing:antialiased}
.wrap{max-width:1100px;margin:0 auto;padding:0 24px 80px}

header{display:flex;align-items:center;gap:14px;padding:22px 0;border-bottom:1px solid var(--line);margin-bottom:32px}
header svg rect{fill:var(--fg)}
header .name{font:600 26px/1 var(--mono);letter-spacing:-.02em}
header .sub{margin-left:auto;color:var(--muted);font-size:11px}

h1{font-size:26px;margin:0 0 6px;letter-spacing:-.02em}
.src{color:var(--muted);font-size:12px;margin-bottom:18px;word-break:break-all}
.src a{color:var(--muted)}

.badges{display:flex;gap:var(--seam);flex-wrap:wrap;margin-bottom:34px}
.badge{border:1px solid var(--line);padding:5px 10px;border-radius:2px;font-size:11px;color:var(--muted)}
.badge.ok{color:var(--ok);border-color:var(--ok)}
.badge.limit{color:var(--limit);border-color:var(--limit)}
.badge.bad{color:var(--bad);border-color:var(--bad)}

section{margin-bottom:40px}
h2{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);
   margin:0 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}

.balance{display:grid;gap:20px;grid-template-columns:1fr}
@media(min-width:820px){.balance{grid-template-columns:1fr 1fr}}
.balance ul{margin:0;padding-left:18px}
.balance li{margin-bottom:6px}
.balance h3{font-size:12px;margin:0 0 10px;letter-spacing:.04em}
.balance .yes h3{color:var(--ok)} .balance .no h3{color:var(--limit)}
.balance .no li{color:var(--muted)}

video,.shot img{width:100%;display:block;border:1px solid var(--line);border-radius:2px;background:#000}
.shots{display:grid;gap:12px;grid-template-columns:1fr}
@media(min-width:820px){.shots{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}}
.shot figcaption{color:var(--muted);font-size:11px;margin-top:6px}
figure{margin:0}

#viewer{height:460px;border:1px solid var(--line);border-radius:2px;background:var(--panel);
        position:relative;overflow:hidden}
#viewer canvas{display:block;width:100%;height:100%}
#vmsg{position:absolute;inset:0;display:grid;place-items:center;text-align:center;
      color:var(--muted);font-size:12px;padding:24px;pointer-events:none}
.models{display:flex;gap:var(--seam);flex-wrap:wrap;margin-bottom:12px}
.models button{background:transparent;color:var(--muted);border:1px solid var(--line);
  font:inherit;font-size:11px;padding:5px 10px;border-radius:2px;cursor:pointer}
.models button:hover{color:var(--fg);border-color:var(--muted)}
.models button[aria-pressed=true]{background:var(--fg);color:var(--bg);border-color:var(--fg);font-weight:600}
.models button .n{opacity:.6;margin-left:6px}

table{width:100%;border-collapse:collapse;font-size:12px}
td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:400;font-size:10px;letter-spacing:.08em;text-transform:uppercase}
tr:last-child td{border-bottom:0}
td.num{text-align:right;color:var(--muted);white-space:nowrap}

.sounds{display:grid;gap:10px;grid-template-columns:1fr}
@media(min-width:820px){.sounds{grid-template-columns:1fr 1fr}}
.snd{border:1px solid var(--line);border-radius:2px;padding:10px 12px}
.snd .nm{font-size:11px;margin-bottom:8px;word-break:break-all}
.snd audio{width:100%;height:32px}

.kv{display:grid;grid-template-columns:190px 1fr;gap:10px;padding:6px 0;
    border-bottom:1px solid var(--line);font-size:12px}
.kv:last-child{border-bottom:0}
.kv b{color:var(--muted);font-weight:400}
.kv .ok{color:var(--ok)} .kv .limit{color:var(--limit)} .kv .bad{color:var(--bad)}

pre{margin:0;padding:12px;background:var(--panel);border:1px solid var(--line);border-radius:2px;
    overflow:auto;max-height:400px;font-size:11px;line-height:1.6}

.dl{display:flex;gap:8px;flex-wrap:wrap}
.dl a{color:var(--fg);border:1px solid var(--line);padding:6px 12px;border-radius:2px;
      text-decoration:none;font-size:11px}
.dl a:hover{border-color:var(--muted)}

.warn{border-left:2px solid var(--limit);padding:10px 14px;color:var(--muted);font-size:11px;
      background:var(--panel);border-radius:2px}
footer{border-top:1px solid var(--line);padding-top:18px;color:var(--muted);font-size:11px}
</style>
</head>
<body>
<div class="wrap">

<header>
  <svg width="26" height="26" viewBox="0 0 64 64" role="img" aria-label="parity">
    <rect x="8" y="8" width="22" height="48"/><rect x="34" y="8" width="22" height="48"/>
  </svg>
  <span class="name">parity</span>
  <span class="sub">Selective Extraction · ${esc(new Date(m.createdAt).toLocaleDateString('de-DE'))}</span>
</header>

<h1>${esc(m.title)}</h1>
<div class="src">Gemessen aus <a href="${esc(m.source)}" target="_blank" rel="noreferrer noopener">${esc(m.source)}</a> · <code>${esc(m.selector)}</code></div>

<div class="badges">
  <span class="badge">${esc(m.category)}</span>
  ${(m.triggers || []).map(t => `<span class="badge">Trigger: ${esc(t)}</span>`).join('')}
  <span class="badge ${isoCls}">${esc(isoText)}</span>
  <span class="badge ${m.confidence >= .8 ? 'ok' : m.confidence >= .5 ? 'limit' : 'bad'}">Confidence ${m.confidence}</span>
  ${(m.techniques || []).map(t => `<span class="badge">${esc(t)}</span>`).join('')}
</div>

<section>
  <h2>Bilanz</h2>
  <div class="balance">
    <div class="yes"><h3>Was hier ist</h3><ul>${gotIt.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="no"><h3>Was nicht</h3><ul>${missing.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
  </div>
</section>

${has(m.previews?.video) ? `<section>
  <h2>In Bewegung${m.previews.videoShows === 'original' ? ' — Aufnahme der Originalseite' : ''}</h2>
  <video src="${esc(m.previews.video)}" controls loop muted playsinline></video>
  ${m.previews.videoShows === 'original'
    ? '<p class="warn">Aufgenommen von der laufenden Originalseite. Eine isolierte Fassung waere hier ein leeres Rechteck — der Inhalt entsteht erst zur Laufzeit im Canvas.</p>'
    : ''}
</section>` : ''}

${[m.previews?.original, m.previews?.originalAfter, m.previews?.isolated, m.previews?.rebuilt].some(has) ? `<section>
  <h2>Aufnahmen</h2>
  <div class="shots">
    ${[[m.previews?.original, 'Original, vor dem Trigger'],
       [m.previews?.originalAfter, 'Original, nach dem Trigger'],
       [m.previews?.isolated, 'Isoliert — Original-Code, auf das Ziel reduziert'],
       [m.previews?.rebuilt, 'Nachbau — aus der Messung geschrieben']]
      .filter(([f]) => has(f))
      .map(([f, cap]) => `<figure class="shot"><img src="${esc(f)}" alt="${esc(cap)}" loading="lazy"><figcaption>${esc(cap)}</figcaption></figure>`)
      .join('')}
  </div>
</section>` : ''}

${models.length ? `<section>
  <h2>3D-Modelle <span style="float:right;text-transform:none;letter-spacing:0">${models.length} Dateien · ${kb(models.reduce((a, b) => a + b.size, 0))}</span></h2>
  <div class="models">
    ${models.map((x, i) => `<button data-src="assets/${esc(x.f)}" data-draco="${x.draco ? 1 : 0}" aria-pressed="${i === 0}">${esc(x.f.replace(/-\w{8}\.glb$/, ''))}<span class="n">${x.meshes}</span></button>`).join('')}
  </div>
  <div id="viewer"><div id="vmsg">Betrachter wird geladen…</div></div>
  <p class="warn">Ziehen zum Drehen, Rad zum Zoomen. Draco-Geometrie und KTX2-Texturen werden im Browser dekodiert; Modelle ohne Textur bekommen ein neutrales Material, damit die Form sichtbar bleibt.</p>
  <table>
    <thead><tr><th>Datei</th><th>Meshes</th><th>Erweiterungen</th><th class="num">Groesse</th></tr></thead>
    <tbody>${models.map(x => `<tr>
      <td><a href="assets/${esc(x.f)}" download style="color:inherit">${esc(x.f)}</a></td>
      <td>${x.meshes}</td>
      <td style="color:var(--muted);font-size:11px">${esc((x.ext_used || []).join(', ') || '—')}</td>
      <td class="num">${kb(x.size)}</td></tr>`).join('')}</tbody>
  </table>
</section>` : ''}

${sounds.length ? `<section>
  <h2>Toene <span style="float:right;text-transform:none;letter-spacing:0">${sounds.length} Dateien</span></h2>
  <div class="sounds">
    ${sounds.map(x => `<div class="snd">
      <div class="nm">${esc(x.f.replace(/-\w{8}\.\w+$/, ''))} <span style="color:var(--muted)">${kb(x.size)}</span></div>
      <audio src="assets/${esc(x.f)}" controls preload="none"></audio>
    </div>`).join('')}
  </div>
</section>` : ''}

<section>
  <h2>Messung</h2>
  ${card('DOM-Pfad', `<code style="font-size:11px;color:var(--muted);word-break:break-all">${esc(m.domPath)}</code>`)}
  ${card('Trigger', esc((m.triggers || []).join(', ')))}
  ${card('Technik', esc((m.techniques || []).join(', ') || '—'))}
  ${card('Libraries', esc((m.dependencies?.libraries || []).join(', ') || 'keine ueber window erkannt'))}
  ${card('Dauer', m.timing?.durationMs != null
      ? `${m.timing.durationMs}ms <span style="color:var(--muted)">(${esc(m.timing.durationSource)})</span>`
      : '<span style="color:var(--muted)">keine Dauer messbar</span>')}
  ${card('Easing', esc((m.easing || []).join(' · ') || '—'))}
  ${card('Bewegte Eigenschaften', esc((m.properties || []).join(', ') || 'keine gemessen'))}
  ${card('rAF-Aufrufe', m.dependencies?.rafCalls ?? null)}
  ${card('Globale Events', `<span style="color:var(--muted);font-size:11px">${esc((m.dependencies?.globalEvents || []).slice(0, 14).join(', ') || '—')}</span>`)}
  ${card('Reduced Motion', m.reducedMotion?.probed
      ? (m.reducedMotion.respected === null ? 'kein Motion deklariert'
        : m.reducedMotion.respected ? '✓ die Quellseite reagiert darauf'
        : '✗ die Quellseite ignoriert die Einstellung')
      : 'nicht gemessen',
      m.reducedMotion?.respected === false ? 'bad' : m.reducedMotion?.respected ? 'ok' : '')}
  ${card('Isolierbarkeit', esc(isoText), isoCls)}
  ${card('Status', esc(m.status))}
</section>

${(m.warnings || []).length ? `<section>
  <h2>Hinweise</h2>
  <div class="warn">${m.warnings.map(w => '· ' + esc(w)).join('<br>')}</div>
</section>` : ''}

<section>
  <h2>Herunterladen</h2>
  <div class="dl">
    ${[[m.code?.zip, 'Alles als ZIP'], [m.previews?.video, 'Video'], [m.code?.single, 'Einzeldatei'],
       ['metadata.json', 'Messung (JSON)'], ['report.md', 'Bericht'],
       [m.code?.rebuilt, 'Nachbau'], [m.code?.react, 'React'], [m.code?.svelte, 'Svelte'],
       ['NOT-REBUILT.md', 'Warum kein Nachbau']]
      .filter(([f]) => has(f))
      .map(([f, label]) => `<a href="${esc(f)}" download>${esc(label)}</a>`).join('')}
  </div>
</section>

<footer>
  Erzeugt von <b>parity</b> · Selective Extraction.
  Alle Assets und Aufnahmen stammen von <a href="${esc(m.source)}" style="color:var(--muted)">${esc(new URL(m.source).host)}</a>
  und gehoeren deren Urhebern. Diese Seite ist eine Analyse, keine Veroeffentlichung —
  nicht oeffentlich hosten.
</footer>

</div>

${models.length ? `<script type="importmap">
{"imports":{
  "three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
}}
</script>
<script type="module">
// Betrachter fuer die Modelle. Faellt er aus — kein Netz, CDN nicht erreichbar —,
// bleiben Tabelle und Download stehen. Eine Seite, die ohne ihn nutzlos waere,
// haette den Betrachter nicht verdient.
const msg = document.getElementById('vmsg');
let THREE, OrbitControls, GLTFLoader, DRACOLoader, KTX2Loader;
try {
  THREE = await import('three');
  ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
  ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
  ({ DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js'));
  ({ KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js'));
} catch (e) {
  msg.textContent = 'Der 3D-Betrachter braucht eine Internetverbindung (three.js vom CDN). Die Modelle unten lassen sich trotzdem herunterladen.';
  throw e;
}

const box = document.getElementById('viewer');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(box.clientWidth, box.clientHeight);
box.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, box.clientWidth / box.clientHeight, 0.01, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 5, 4); scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(-4, 2, -3); scene.add(rim);

// Beide Decoder sind Pflicht, nicht Kuer: ohne DRACOLoader bleibt die Geometrie
// unlesbar, und ohne KTX2Loader bricht GLTFLoader beim ersten Basis-Bild ab —
// das Modell erscheint dann gar nicht statt nur ungefaerbt.
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/';
const draco = new DRACOLoader().setDecoderPath(CDN + 'draco/');
const ktx2 = new KTX2Loader().setTranscoderPath(CDN + 'basis/').detectSupport(renderer);
const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);

let current = null;
const load = async (src, btn) => {
  msg.style.display = 'grid';
  msg.textContent = 'laedt ' + src.split('/').pop() + ' …';
  for (const b of document.querySelectorAll('.models button')) b.setAttribute('aria-pressed', String(b === btn));
  try {
    const gltf = await loader.loadAsync(src);
    if (current) { scene.remove(current); current.traverse(o => { o.geometry?.dispose?.(); }); }
    current = gltf.scene;

    // Ohne aufgeloeste Texturen sind viele Materialien schwarz. Ein neutrales
    // Material zeigt die Geometrie, um die es hier geht.
    current.traverse(o => {
      if (!o.isMesh) return;
      const had = o.material?.map;
      if (!had) o.material = new THREE.MeshStandardMaterial({ color: 0xb9b9c4, roughness: .55, metalness: .05, side: THREE.DoubleSide });
    });

    scene.add(current);
    // Auf das Modell einpassen, egal wie gross es modelliert wurde.
    const bb = new THREE.Box3().setFromObject(current);
    const size = bb.getSize(new THREE.Vector3()).length() || 1;
    const mid = bb.getCenter(new THREE.Vector3());
    controls.target.copy(mid);
    camera.position.copy(mid).add(new THREE.Vector3(size * .55, size * .35, size * .65));
    camera.near = size / 500; camera.far = size * 20; camera.updateProjectionMatrix();
    controls.update();
    msg.style.display = 'none';
  } catch (e) {
    msg.style.display = 'grid';
    msg.textContent = 'liess sich nicht laden: ' + String(e).slice(0, 120);
  }
};

for (const b of document.querySelectorAll('.models button')) b.onclick = () => load(b.dataset.src, b);
const first = document.querySelector('.models button');
if (first) load(first.dataset.src, first);

addEventListener('resize', () => {
  renderer.setSize(box.clientWidth, box.clientHeight);
  camera.aspect = box.clientWidth / box.clientHeight;
  camera.updateProjectionMatrix();
});
(function tick(){ requestAnimationFrame(tick); controls.update(); renderer.render(scene, camera); })();
</script>` : ''}
</body>
</html>`;

writeFileSync(join(DIR, 'showcase.html'), page, 'utf8');
emit({ ev: 'done', cmd: 'showcase', out: join(DIR, 'showcase.html'), models: models.length, sounds: sounds.length, exit: 0 });
console.log(`✓ ${join(DIR, 'showcase.html')}`);
console.log(`  ${models.length} Modelle · ${sounds.length} Toene · ${other.length} weitere Dateien`);

// ── Direkt zeigen ───────────────────────────────────────────────────────────
// Import-Map und Module brauchen http; per Doppelklick blockt die CORS-Regel.
const si = argv.indexOf('--serve');
if (si > -1) {
  const port = Number(argv[si + 1]) || 4180;
  console.log(`\n  http://localhost:${port}/showcase.html`);
  spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), DIR, String(port)], { stdio: 'inherit' });
} else {
  console.log(`\n  Ansehen:  node bin/parity.mjs serve ${DIR} 4180`);
  console.log(`            http://localhost:4180/showcase.html`);
}
