// Rebuild — schreibt aus einer Messung eine eigenstaendige Fassung.
//
// Usage: node tools/rebuild.mjs <extraction-dir> [--shot]
//
// Der Unterschied zu vanilla/ ist der ganze Punkt dieser Datei:
//
//   vanilla/  = Original-Markup und Original-CSS der Quellseite, ausgeschnitten.
//               Ein Analyseergebnis. Darf nicht veroeffentlicht werden.
//   rebuilt/  = neu geschriebener Code aus metadata.json. Kennt das Original-CSS
//               nicht. Nur Messwerte: Dauer, Delay, Easing, Start-, Endzustand,
//               Keyframe-Offsets, Kastenwerte — und eine Strukturbeschreibung
//               (Tag, Rolle, Text), kein DOM-Abzug.
//
// Was sich nicht ehrlich nachbauen laesst, wird auch nicht nachgebaut: dann
// entsteht NOT-REBUILT.md mit dem Grund. Ein Nachbau, der das Original als
// eigene Arbeit ausgibt, waere schlimmer als gar keiner.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { emit } from './_emit.mjs';

const argv = process.argv.slice(2);
const DIR = argv[0];
const SHOT = argv.includes('--shot');
if (!DIR) {
  console.error('usage: node tools/rebuild.mjs <extraction-dir> [--shot]');
  process.exit(2);
}
const metaPath = join(DIR, 'metadata.json');
if (!existsSync(metaPath)) {
  console.error(`✗ ${metaPath} nicht gefunden`);
  process.exit(1);
}
const m = JSON.parse(readFileSync(metaPath, 'utf8'));

// ── Laesst sich das ehrlich nachbauen? ──────────────────────────────────────
const blockers = [];
if (m.isolatability === 'reference-only') {
  // Der Grund der Einstufung, nicht die erstbeste Warnung. Schriftlizenzen sind
  // ein Hinweis, aber nie der Grund, warum etwas nicht nachbaubar ist.
  const why = m.isolatabilityReasons?.length ? m.isolatabilityReasons : ['die Runtime laesst sich nicht ausschneiden.'];
  for (const r of why) blockers.push('Als "nur als Referenz dokumentierbar" eingestuft: ' + r);
}
if (m.isolatability === 'not-analysable')
  blockers.push('Das Ziel war nicht analysierbar.');
if (!m.structure)
  blockers.push('Keine Strukturbeschreibung in den Metadaten — mit einer aelteren Fassung von extract gemessen. Bitte neu messen.');
if (m.techniques?.some(t => ['webgl', 'canvas', 'three', 'rive'].includes(t)))
  blockers.push('Der Inhalt entsteht aus WebGL/Canvas/Rive. Was dort gezeichnet wird, steht in keiner CSS-Regel.');

const props = Object.keys(m.states || {});
const kf = (m.timing?.keyframes || []).filter(k => k.offset != null);
const hasMotion = props.length > 0 || kf.length > 1;
if (!hasMotion && !blockers.length)
  blockers.push('Beim gemessenen Trigger hat sich nichts veraendert — es gibt keine Bewegung zum Nachbauen. Die statische Fassung entsteht trotzdem.');

// Fehlende Bewegung blockiert nicht, sie schraenkt nur ein.
const hardBlocked = blockers.some(b => !b.startsWith('Beim gemessenen Trigger'));

if (hardBlocked) {
  const md = `# Nicht nachgebaut

**${m.title}** — \`${m.selector}\` auf ${m.source}

Fuer dieses Ziel wird keine eigene Fassung erzeugt:

${blockers.map(b => '- ' + b).join('\n')}

Was es stattdessen gibt:

- \`metadata.json\` — die vollstaendige Messung
- \`report.md\` — der lesbare Bericht
- \`vanilla/\` — die isolierte Fassung mit **Original-Code** der Quellseite.
  Analyseergebnis, keine eigene Komponente. Nicht veroeffentlichen.

Eine automatisch erzeugte Nachbildung waere hier geraten, nicht gemessen.
`;
  writeFileSync(join(DIR, 'NOT-REBUILT.md'), md, 'utf8');
  for (const d of ['rebuilt', 'react', 'svelte']) rmSync(join(DIR, d), { recursive: true, force: true });
  m.code = { ...m.code, rebuilt: null, react: null, svelte: null };
  m.previews = { ...m.previews, rebuilt: null };
  if (m.status === 'rebuilt') m.status = 'isolated';
  writeFileSync(metaPath, JSON.stringify(m, null, 2), 'utf8');
  emit({ ev: 'done', cmd: 'rebuild', out: DIR, rebuilt: false, reasons: blockers, exit: 0 });
  console.log(`— ${m.title}: nicht nachgebaut`);
  for (const b of blockers) console.log('  · ' + b);
  process.exit(0);
}

// ── Namen, die nichts kopieren ──────────────────────────────────────────────
// Klassennamen der Quellseite zu uebernehmen waere Kopieren. Erlaubt ist nur
// ein kleiner Satz allgemeiner Woerter — "title" gehoert niemandem.
const GENERIC = new Set(['title', 'label', 'text', 'body', 'icon', 'image', 'media', 'header',
  'footer', 'content', 'inner', 'wrap', 'wrapper', 'item', 'link', 'button', 'badge', 'meta', 'caption']);
const ROOT = (m.slug || 'component').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'component';

const nameOf = (node, i, seen) => {
  const generic = (node.semantic || []).find(c => GENERIC.has(c.toLowerCase()));
  let base = generic ? generic.toLowerCase()
    : node.role ? node.role
    : { a: 'link', img: 'image', button: 'button', p: 'text', span: 'text',
        h1: 'title', h2: 'title', h3: 'title', h4: 'title', ul: 'list', li: 'item',
        svg: 'icon', figure: 'media', video: 'media' }[node.tag] || 'part';
  let name = base;
  let n = 2;
  while (seen.has(name)) name = base + '-' + n++;
  seen.add(name);
  return name;
};

// ── Markup ──────────────────────────────────────────────────────────────────
const VOID = new Set(['img', 'br', 'hr', 'input', 'source']);
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const buildMarkup = (node, cls, depth, classAttr) => {
  const pad = '  '.repeat(depth);
  const tag = /^[a-z][a-z0-9]*$/.test(node.tag) ? node.tag : 'div';
  const attrs = [`${classAttr}="${cls}"`];
  if (node.role) attrs.push(`role="${node.role}"`);
  if (node.label) attrs.push(`aria-label="${esc(node.label)}"`);
  if (tag === 'a') attrs.push('href="#"');
  if (tag === 'img') attrs.push(`src="" alt="${esc(node.label || '')}"`);
  if (VOID.has(tag)) return `${pad}<${tag} ${attrs.join(' ')}>`;

  const seen = new Set();
  const kids = (node.children || []).map((c, i) =>
    buildMarkup(c, cls + '__' + nameOf(c, i, seen), depth + 1, classAttr));
  const inner = [node.text ? '  '.repeat(depth + 1) + esc(node.text) : null, ...kids].filter(Boolean).join('\n');
  return inner
    ? `${pad}<${tag} ${attrs.join(' ')}>\n${inner}\n${pad}</${tag}>`
    : `${pad}<${tag} ${attrs.join(' ')}></${tag}>`;
};

// ── CSS aus den gemessenen Werten ───────────────────────────────────────────
// Nur Werte, die etwas aussagen. Die Vorgabewerte des Browsers wieder
// hinzuschreiben blaeht das Ergebnis auf und erklaert nichts.
const DEFAULT = {
  display: 'inline', 'flex-direction': 'row', 'align-items': 'normal', 'justify-content': 'normal',
  gap: 'normal', padding: '0px', margin: '0px', width: 'auto', height: 'auto', 'min-height': '0px',
  'max-width': 'none', 'box-sizing': 'content-box', 'background-color': 'rgba(0, 0, 0, 0)',
  border: 'none', 'border-radius': '0px', 'box-shadow': 'none', 'font-weight': '400',
  'letter-spacing': 'normal', 'text-transform': 'none', 'text-align': 'start',
  'text-decoration-line': 'none', opacity: '1', transform: 'none', overflow: 'visible',
  position: 'static', cursor: 'auto', 'white-space': 'normal',
};
// Groesse ist Layout, keine Komponenteneigenschaft. Die gemessene Breite eines
// Block-Elements ist die Breite seines Elternteils bei 1440px Viewport — sie in
// einen Nachbau zu schreiben friert das Layout einer fremden Seite ein und
// macht die Komponente unbrauchbar. Uebernommen wird nur, was die Quellseite
// selbst deklariert (z. B. ein 64px-Kreis).
const LAYOUT_ONLY = new Set(['width', 'height', 'max-width', 'min-height', 'margin']);
const declared = new Set(m.declaredBoxProps || []);
const isLayoutNoise = k => LAYOUT_ONLY.has(k) && !declared.has(k);

// display:block ist die Vorgabe fuer div/section/p — sie hinzuschreiben erklaert
// nichts. Bei inline-Elementen, die zu block gemacht wurden, schon.
const BLOCKISH = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'li', 'figure']);

const meaningful = (k, v) => {
  if (!v || v === 'none' || v === 'auto' || v === 'normal' || v === DEFAULT[k]) return false;
  if (isLayoutNoise(k)) return false;
  if (k === 'display' && v === 'block' && BLOCKISH.has(m.structure?.tag)) return false;
  if (k === 'border' && /0px/.test(v)) return false;
  if (/^0px(\s+0px)*$/.test(v)) return false;
  return true;
};

// matrix(a,b,c,d,e,f) ist korrekt und unlesbar. Wer den Nachbau spaeter anfasst,
// soll translateY(-12px) scale(1.03) sehen, nicht sechs Zahlen.
const readableTransform = v => {
  const mm = /^matrix\(([^)]+)\)$/.exec(String(v).trim());
  if (!mm) return v;
  const [a, b, c, d, e, f] = mm[1].split(',').map(Number);
  if ([a, b, c, d, e, f].some(n => !Number.isFinite(n))) return v;
  const round = n => Math.abs(n) < 1e-4 ? 0 : Math.round(n * 1000) / 1000;
  const scaleX = round(Math.hypot(a, b));
  const scaleY = round((a * d - b * c) / (Math.hypot(a, b) || 1));
  const rotate = round((Math.atan2(b, a) * 180) / Math.PI);
  const out = [];
  if (round(e) || round(f)) out.push(round(f) && !round(e) ? `translateY(${round(f)}px)`
    : round(e) && !round(f) ? `translateX(${round(e)}px)`
    : `translate(${round(e)}px, ${round(f)}px)`);
  if (rotate) out.push(`rotate(${rotate}deg)`);
  if (scaleX !== 1 || scaleY !== 1) out.push(scaleX === scaleY ? `scale(${scaleX})` : `scale(${scaleX}, ${scaleY})`);
  return out.length ? out.join(' ') : 'none';
};

const value = (k, v) => (k === 'transform' ? readableTransform(v) : v);

// keepAll fuer Zustands- und Keyframe-Regeln. Dort ist der Vorgabewert die
// Aussage: "opacity: 1" und "transform: none" SIND das Ziel eines Reveals.
// Sie als Rauschen zu filtern liefert eine leere Regel — und damit einen
// Nachbau, der das Element nie sichtbar macht.
const declBlock = (obj, indent = '  ', keepAll = false) => Object.entries(obj)
  .filter(([k, v]) => v != null && v !== '' && (keepAll || meaningful(k, v)))
  .map(([k, v]) => `${indent}${k}: ${value(k, v)};`).join('\n');

const dur = m.timing?.durationMs ?? 400;
const delay = m.timing?.delayMs ?? 0;
const easing = (m.easing || []).find(e => e && e !== 'ease' && e !== 'linear')
  || (m.easing || [])[0] || 'ease';
const iterations = m.timing?.loops ? 'infinite' : 1;
const trigger = (m.triggers || ['load'])[0];
const io = m.dependencies?.intersectionObservers?.[0];

// Der Startzustand ist der gemessene from-Wert, der Zielzustand der to-Wert.
const fromDecl = {}, toDecl = {};
for (const [p, s] of Object.entries(m.states || {})) {
  if (meaningful(p, s.from) || s.from === '0' || /^0(\.\d+)?$/.test(s.from)) fromDecl[p] = s.from;
  toDecl[p] = s.to;
}

const keyframeBlock = () => {
  if (kf.length > 1) {
    // Echte Offsets aus der Engine.
    return kf.map(k => {
      const body = Object.entries(k)
        .filter(([key, v]) => !['offset', 'easing', 'composite', 'computedOffset'].includes(key) && v != null)
        .map(([key, v]) => `    ${key}: ${v};`).join('\n');
      return `  ${Math.round((k.offset ?? 0) * 100)}% {\n${body}\n  }`;
    }).join('\n');
  }
  const a = declBlock(fromDecl, '    ', true), b = declBlock(toDecl, '    ', true);
  return `  from {\n${a}\n  }\n  to {\n${b}\n  }`;
};

// Bei click/scroll/drag traegt eine Klasse den Zustand — CSS allein kann das
// nicht, und ein Nachbau soll nicht so tun als koennte er es.
const STATE_CLASS = { click: 'is-active', touch: 'is-active', scroll: 'is-visible', drag: 'is-active', pointer: 'is-active', idle: 'is-active', focus: null, hover: null, load: null, loop: null };
const stateClass = STATE_CLASS[trigger] ?? 'is-active';

const stateSelector =
  trigger === 'hover' ? `.${ROOT}:hover`
  : trigger === 'focus' ? `.${ROOT}:focus-visible, .${ROOT}:focus`
  : stateClass ? `.${ROOT}.${stateClass}`
  : null;

const usesKeyframes = trigger === 'loop' || trigger === 'load' || (!stateSelector && hasMotion);

// Jede Eigenschaft braucht ihr eigenes Timing. "transform, opacity 420ms ease"
// ist gueltige CSS-Syntax und trotzdem falsch: nur opacity bekaeme die 420ms,
// transform liefe mit dem Vorgabewert 0s — also gar nicht.
const transitionValue = props
  .map(p => `${p} ${dur}ms ${easing}${delay ? ' ' + delay + 'ms' : ''}`)
  .join(',\n              ');

// Unter prefers-reduced-motion nur die Bewegung wegnehmen, nicht den Inhalt.
// Bei einem Reveal (Startzustand unsichtbar) muss der Endzustand gesetzt
// werden, sonst bleibt das Element dauerhaft verborgen. Bei einem Hover-Effekt
// waere genau das falsch — die Karte staende dann permanent im Hover-Zustand.
const revealsIntoView = ['scroll', 'load'].includes(trigger)
  && (parseFloat(fromDecl.opacity ?? '1') === 0 || (fromDecl.visibility === 'hidden'));

const baseBox = { ...m.box };
for (const k of Object.keys(fromDecl)) delete baseBox[k];
const baseDecl = [
  declBlock(baseBox),
  usesKeyframes ? '' : declBlock(fromDecl, '  ', true),
].filter(Boolean).join('\n');

// Der Hintergrund der Demo-Seite richtet sich nach der gemessenen Textfarbe.
// Ein Element von einer dunklen Seite bringt helle Schrift mit; auf weissem
// Grund ist die Preview dann unlesbar und die Extraktion sieht kaputt aus,
// obwohl sie stimmt. Eigener Hintergrund am Element schlaegt beides.
const demoBackground = (() => {
  const own = m.box?.['background-color'];
  if (own && own !== 'rgba(0, 0, 0, 0)' && !/^rgba\(.*,\s*0\)$/.test(own)) return '#f5f5f5';
  const rgb = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(m.box?.color || '');
  if (!rgb) return '#f5f5f5';
  const [r, g, b] = rgb.slice(1).map(Number);
  // Wahrnehmungsgewichtete Helligkeit, nicht der arithmetische Mittelwert:
  // Gruen traegt zur empfundenen Helligkeit viel mehr bei als Blau.
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#111111' : '#f5f5f5';
})();

const rmComment = m.reducedMotion?.respected === false
  ? 'Die Quellseite ignoriert prefers-reduced-motion. Dieser Nachbau nicht.'
  : 'prefers-reduced-motion wird respektiert, wie in der Quellseite.';

const css = `/* ${m.title} — eigenstaendiger Nachbau.
 *
 * Geschrieben aus der Messung in metadata.json, nicht aus dem CSS der
 * Quellseite. Die Werte unten stammen aus:
 *   Dauer   ${m.timing?.durationMs ?? '—'}ms  (${m.timing?.durationSource ?? '—'})
 *   Delay   ${m.timing?.delayMs ?? 0}ms
 *   Easing  ${easing}
 *   Trigger ${trigger}
 */

.${ROOT} {
${baseDecl}
${props.length && !usesKeyframes ? `  transition: ${transitionValue};` : ''}
${usesKeyframes && hasMotion ? `  animation: ${ROOT}-motion ${dur}ms ${easing}${delay ? ' ' + delay + 'ms' : ''} ${iterations}${m.timing?.declared?.direction && m.timing.declared.direction !== 'normal' ? ' ' + m.timing.declared.direction : ''} both;` : ''}
}
${stateSelector && !usesKeyframes ? `
${stateSelector} {
${declBlock(toDecl, '  ', true)}
}` : ''}
${usesKeyframes && hasMotion ? `
@keyframes ${ROOT}-motion {
${keyframeBlock()}
}` : ''}

/* ${rmComment} */
@media (prefers-reduced-motion: reduce) {
  .${ROOT} {
    transition-duration: 0.01ms;
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
  }
${revealsIntoView ? `
  /* Ein Reveal ohne Animation muss trotzdem sichtbar sein — sonst versteckt
     Reduced Motion den Inhalt, statt nur die Bewegung wegzunehmen. */
  .${ROOT} {
${declBlock(toDecl, '    ', true)}
  }` : ''}
}
`.replace(/\n{3,}/g, '\n\n').replace(/\n\s*\n(\s*\})/g, '\n$1');

// ── Ausgabe ─────────────────────────────────────────────────────────────────
mkdirSync(join(DIR, 'rebuilt'), { recursive: true });
mkdirSync(join(DIR, 'react'), { recursive: true });
mkdirSync(join(DIR, 'svelte'), { recursive: true });
rmSync(join(DIR, 'NOT-REBUILT.md'), { force: true });

const htmlMarkup = buildMarkup(m.structure, ROOT, 2, 'class');
const needsJs = !!stateClass && stateClass !== null && !['hover', 'focus', 'load', 'loop'].includes(trigger);

const js = !needsJs ? `// Trigger "${trigger}" braucht kein JavaScript — das CSS traegt den Zustand.
// Diese Datei bleibt leer, damit index.html unveraendert funktioniert.
` : trigger === 'scroll' ? `// Scroll-Reveal. Gemessen: IntersectionObserver mit threshold ${io?.threshold ?? 0.25}${io?.rootMargin ? ', rootMargin "' + io.rootMargin + '"' : ''}.
// Einmalig — nach dem Aufdecken wird nicht mehr beobachtet.
const io = new IntersectionObserver((entries, obs) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('${stateClass}');
    obs.unobserve(e.target);
  }
}, { threshold: ${JSON.stringify(io?.threshold ?? 0.25)}, rootMargin: ${JSON.stringify(io?.rootMargin ?? '0px')} });

for (const el of document.querySelectorAll('.${ROOT}')) io.observe(el);
` : `// Zustandswechsel per ${trigger}.
for (const el of document.querySelectorAll('.${ROOT}')) {
  el.addEventListener('${trigger === 'touch' ? 'pointerdown' : trigger === 'drag' ? 'pointerdown' : 'click'}', () => {
    el.classList.toggle('${stateClass}');
  });
}
`;

const page = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${esc(m.title)} — parity rebuilt</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; }
  body { display: grid; place-items: center; min-height: 100vh;
         background: ${demoBackground}; }
  #stage { padding: 60px; }
</style>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div id="stage">
${htmlMarkup}
</div>
<!-- Klassisches Script, kein Modul: type="module" wird beim Oeffnen per
     file:// von der CORS-Regel blockiert, und dann ist die Demo tot, sobald
     jemand sie herunterlaedt und doppelklickt. -->
<script src="script.js"></script>
<script>
  // Dieselbe Fernsteuerung wie die isolierte Preview, damit die Oberflaeche
  // beide gleich bedienen kann.
  const target = document.querySelector('.${ROOT}');
  const anims = () => (target ? target.getAnimations({ subtree: true }) : []);
  const api = {
    play: () => anims().forEach(a => a.play()),
    pause: () => anims().forEach(a => a.pause()),
    restart: () => anims().forEach(a => { a.cancel(); a.play(); }),
    reset: () => { anims().forEach(a => a.cancel()); target?.classList.remove('${stateClass || 'is-active'}'); },
    rate: v => anims().forEach(a => { a.playbackRate = Number(v) || 1; }),
    fire: () => {
${trigger === 'hover' ? `      target?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));`
  : trigger === 'focus' ? `      target?.focus();`
  : stateClass ? `      target?.classList.toggle('${stateClass}');`
  : `      api.restart();`}
    },
  };
  window.parityPreview = api;
  window.addEventListener('message', e => {
    const c = e.data && e.data.parity;
    if (c && typeof api[c.cmd] === 'function') api[c.cmd](c.arg);
  });
</script>
</body>
</html>`;

writeFileSync(join(DIR, 'rebuilt/index.html'), page, 'utf8');
writeFileSync(join(DIR, 'rebuilt/style.css'), css, 'utf8');
writeFileSync(join(DIR, 'rebuilt/script.js'), js, 'utf8');

// ── React ───────────────────────────────────────────────────────────────────
const pascal = ROOT.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('') || 'Component';
const jsxMarkup = buildMarkup(m.structure, ROOT, 2, 'className');

// Ein ref nur, wo er auch gebraucht wird. Ein ungenutzter useRef ist Ballast,
// den jeder Leser erst als solchen erkennen muss.
const usesRef = trigger === 'scroll';
const reactHooks = trigger === 'scroll' ? ['useEffect', 'useRef', 'useState']
  : needsJs ? ['useState'] : [];

const reactBody =
  trigger === 'scroll' ? `  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Gemessen: IntersectionObserver, threshold ${io?.threshold ?? 0.25}${io?.rootMargin ? ', rootMargin "' + io.rootMargin + '"' : ''}.
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      setVisible(true);
      obs.unobserve(el);
    }, { threshold: ${JSON.stringify(io?.threshold ?? 0.25)}, rootMargin: ${JSON.stringify(io?.rootMargin ?? '0px')} });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
`
  : needsJs ? `  const [active, setActive] = useState(false);
` : '';

const reactCls = trigger === 'scroll' ? `\`${ROOT}\${visible ? ' ${stateClass}' : ''}\``
  : needsJs ? `\`${ROOT}\${active ? ' ${stateClass}' : ''}\``
  : `"${ROOT}"`;

const rootAttrs = [
  `className={${reactCls}}`.replace('className={"' + ROOT + '"}', `className="${ROOT}"`),
  usesRef ? 'ref={ref}' : null,
  needsJs && trigger !== 'scroll' ? `onClick={() => setActive(a => !a)}` : null,
].filter(Boolean).join(' ');

const jsx = `// ${m.title} — eigenstaendiger Nachbau, React.
// Geschrieben aus der Messung in metadata.json. Trigger: ${trigger}.
${reactHooks.length ? `import { ${reactHooks.join(', ')} } from 'react';\n` : ''}import './styles.css';

export default function ${pascal}() {
${reactBody}  return (
${jsxMarkup.replace(`class="${ROOT}"`, rootAttrs).replace(new RegExp(`className="${ROOT}"(?![-\\w])`), rootAttrs).replace(/^/gm, '  ')}
  );
}
`;
writeFileSync(join(DIR, 'react/Component.jsx'), jsx, 'utf8');
writeFileSync(join(DIR, 'react/styles.css'), css, 'utf8');

// ── Svelte ──────────────────────────────────────────────────────────────────
const svelteScript =
  trigger === 'scroll' ? `<script>
  import { onMount } from 'svelte';
  let el;
  let visible = false;

  onMount(() => {
    const io = new IntersectionObserver(([e], obs) => {
      if (!e.isIntersecting) return;
      visible = true;
      obs.unobserve(el);
    }, { threshold: ${JSON.stringify(io?.threshold ?? 0.25)}, rootMargin: ${JSON.stringify(io?.rootMargin ?? '0px')} });
    io.observe(el);
    return () => io.disconnect();
  });
</script>`
  : needsJs ? `<script>
  let el;
  let active = false;
</script>`
  : `<script>
  let el;
</script>`;

const svelteCls = trigger === 'scroll' ? `class="${ROOT}" class:${stateClass}={visible} bind:this={el}`
  : needsJs ? `class="${ROOT}" class:${stateClass}={active} bind:this={el} on:click={() => (active = !active)}`
  : `class="${ROOT}" bind:this={el}`;

const svelte = `<!-- ${m.title} — eigenstaendiger Nachbau, Svelte. Trigger: ${trigger}. -->
${svelteScript}

${buildMarkup(m.structure, ROOT, 0, 'class').replace(`class="${ROOT}"`, svelteCls)}

<style>
${css.replace(/^/gm, '  ')}
</style>
`;
writeFileSync(join(DIR, 'svelte/Component.svelte'), svelte, 'utf8');

// ── Metadaten fortschreiben ─────────────────────────────────────────────────
m.code = { ...m.code, rebuilt: 'rebuilt/index.html', react: 'react/Component.jsx', svelte: 'svelte/Component.svelte' };
m.rebuild = {
  root: ROOT,
  trigger,
  stateClass: stateClass || null,
  technique: usesKeyframes ? 'css-keyframes' : stateSelector ? 'css-transition' : 'statisch',
  needsJs,
  fromMeasurement: true,
  animated: hasMotion,
  notes: [
    'Aus metadata.json geschrieben, nicht aus dem CSS der Quellseite.',
    ...(hasMotion ? [] : ['Ohne gemessene Bewegung — nur der statische Zustand.']),
    ...(m.reducedMotion?.respected === false ? ['prefers-reduced-motion wird hier respektiert, anders als im Original.'] : []),
    ...(m.assets?.length ? [m.assets.length + ' Bilder/Medien sind im Nachbau leer — fremde Assets werden nicht uebernommen.'] : []),
    ...(m.dependencies?.libraries?.length ? ['Die Quellseite nutzt ' + m.dependencies.libraries.join(', ') + '. Der Nachbau kommt ohne aus; das Ergebnis kann abweichen.'] : []),
  ],
};
if (m.status === 'isolated' || m.status === 'inspected') m.status = 'rebuilt';

// ── Aufnahme ────────────────────────────────────────────────────────────────
if (SHOT) {
  const { chromium } = await import('playwright');
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
    await p.goto(pathToFileURL(resolvePath(DIR, 'rebuilt/index.html')).href, { waitUntil: 'load', timeout: 20000 });
    await p.waitForTimeout(1200);
    if (stateClass) await p.evaluate(c => document.querySelector('.' + c.root)?.classList.add(c.cls), { root: ROOT, cls: stateClass });
    else if (trigger === 'hover') await p.locator('.' + ROOT).first().hover().catch(() => {});
    await p.waitForTimeout(Math.min(1500, dur + 300));
    await p.locator('#stage').screenshot({ path: join(DIR, 'preview-rebuilt.png'), timeout: 8000 });
    m.previews = { ...m.previews, rebuilt: 'preview-rebuilt.png' };
    emit({ ev: 'shot', cmd: 'rebuild', mark: 'preview-rebuilt', path: join(DIR, 'preview-rebuilt.png') });
  } catch (e) {
    m.rebuild.notes.push('Aufnahme der Nachbau-Preview fehlgeschlagen: ' + String(e).slice(0, 100));
  } finally { await b.close(); }
}

writeFileSync(metaPath, JSON.stringify(m, null, 2), 'utf8');

emit({
  ev: 'done', cmd: 'rebuild', out: DIR, rebuilt: true, root: ROOT, trigger,
  technique: m.rebuild.technique, animated: hasMotion, exit: 0,
});
console.log(`✓ ${DIR}`);
console.log(`  rebuilt/ · react/ · svelte/  —  .${ROOT}, Trigger ${trigger}, ${m.rebuild.technique}`);
for (const n of m.rebuild.notes.slice(1)) console.log('  · ' + n);
