// Selective Extraction — misst ein einzelnes Element statt einer ganzen Seite.
//
// Usage: node tools/extract.mjs <url> --selector <css> [Optionen]
//   --selector <css>     Ziel. Pflicht.
//   --trigger <name>     auto (Vorgabe) | load hover click focus scroll drag pointer touch idle loop
//   --scope <name>       element (Vorgabe) | animation | deps | interaction | section
//   --out <dir>          Vorgabe: extractions/<slug>
//   --repeat <n>         Wie oft der Trigger gemessen wird (Vorgabe 3)
//   --title <text>       Anzeigename
//
// Der Rest von parity misst zwei Seiten und vergleicht sie. Hier wird ein Ziel
// gemessen und isoliert — dieselben Werkzeuge, anderes Ergebnis.
//
// Die zentrale Sonde ist element.getAnimations({subtree:true}): sie liefert
// CSS-Transitions, CSS-Keyframes UND Web Animations API in einem Aufruf, mit
// echten Dauern, Delays und Easing-Kurven direkt aus der Engine. Was daran
// vorbeilaeuft — GSAP, rAF-getriebenes JS — wird durch Abtasten der Computed
// Styles pro Frame erfasst. Beides zusammen deckt ab, was ohne Raten geht.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { emit } from './_emit.mjs';

// ── Argumente ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i > -1 ? (argv[i + 1] ?? d) : d; };
const URL_ = argv[0];
const SEL = flag('selector');
const TRIGGER = flag('trigger', 'auto');
const SCOPE = flag('scope', 'element');
const REPEAT = Math.max(1, Number(flag('repeat', 3)));
const TITLE = flag('title');

if (!URL_ || !SEL || URL_.startsWith('--')) {
  console.error('usage: node tools/extract.mjs <url> --selector <css> [--trigger auto] [--scope element] [--out dir]');
  process.exit(2);
}

const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'element';
const SLUG = slugify(TITLE || SEL);
const OUT = flag('out', join('extractions', SLUG));

// Grundstock an Eigenschaften, die fast jede Animation bewegt. Kurz gehalten:
// jede zusaetzliche kostet Messzeit pro Frame.
//
// Diese Liste allein reicht nicht. Eine feste Auswahl uebersieht genau das, was
// die Seite tatsaechlich animiert — ein Button, dessen Hover nur die
// border-color aendert, meldet sonst "keine Bewegung", obwohl er sich sichtbar
// aendert. Was zusaetzlich zu beobachten ist, steht im CSS der Seite und wird
// dort ausgelesen (siehe candidateProps in INSPECT).
const BASE_WATCH = [
  'transform', 'opacity', 'filter', 'clip-path', 'color', 'background-color',
  'width', 'height', 'translate', 'rotate', 'scale', 'visibility',
  'border-radius', 'box-shadow', 'letter-spacing', 'backdrop-filter',
];

// Nicht animierbare oder pro Frame wertlose Eigenschaften. Sie aus dem CSS
// aufzunehmen kostet nur Messzeit.
const NOT_WATCHABLE = new Set([
  'content', 'cursor', 'pointer-events', 'user-select', 'will-change', 'contain',
  'transition', 'transition-property', 'transition-duration', 'transition-delay',
  'transition-timing-function', 'animation', 'animation-name', 'animation-duration',
  'animation-delay', 'animation-timing-function', 'animation-iteration-count',
  'animation-direction', 'animation-fill-mode', 'animation-play-state',
  'position', 'display', 'overflow', 'box-sizing', 'font-family', 'src',
]);

const step = (name, label, extra = {}) => emit({ ev: 'step', cmd: 'extract', name, label, ...extra });

// ── Recorder, die vor jedem Seitenskript laufen muessen ─────────────────────
// addEventListener, IntersectionObserver und rAF lassen sich nachtraeglich nicht
// rekonstruieren — wer sie erst nach dem Laden abfragt, sieht nichts. Also
// werden sie vorher ersetzt und protokollieren mit.
const INIT = () => {
  const P = { listeners: [], io: [], raf: 0, ro: 0, waapi: 0 };
  window.__parity = P;

  const cssPath = el => {
    if (!el || el.nodeType !== 1) return String(el);
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 6; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + n.id); break; }
      let s = n.tagName.toLowerCase();
      const cls = (n.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  window.__parityPath = cssPath;

  const oAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    try {
      const on = this instanceof Element ? cssPath(this)
        : this === window ? 'window' : this === document ? 'document' : 'other';
      if (P.listeners.length < 4000) P.listeners.push({ type, on, node: this instanceof Element ? this : null });
    } catch { /* Aufzeichnen darf die Seite nie stoeren */ }
    return oAdd.call(this, type, fn, opts);
  };

  const OIO = window.IntersectionObserver;
  if (OIO) {
    window.IntersectionObserver = class extends OIO {
      constructor(cb, opts) {
        super(cb, opts);
        this.__i = P.io.push({ threshold: opts?.threshold ?? 0, rootMargin: opts?.rootMargin ?? '0px', targets: [], nodes: [] }) - 1;
      }
      observe(t) { try { P.io[this.__i].targets.push(cssPath(t)); P.io[this.__i].nodes.push(t); } catch {} return super.observe(t); }
    };
  }

  const oRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) { P.raf++; return oRaf.call(window, cb); };

  const ORO = window.ResizeObserver;
  if (ORO) window.ResizeObserver = class extends ORO { constructor(cb) { super(cb); P.ro++; } };

  const oAnim = Element.prototype.animate;
  if (oAnim) Element.prototype.animate = function () { P.waapi++; return oAnim.apply(this, arguments); };
};

// ── In-Page: Struktur, CSS, Abhaengigkeiten ─────────────────────────────────
const INSPECT = ({ sel, scope, watch }) => {
  const el = document.querySelector(sel);
  if (!el) return { found: false };
  const P = window.__parity || { listeners: [], io: [], raf: 0, ro: 0, waapi: 0 };
  const path = window.__parityPath || (e => e.tagName.toLowerCase());

  const domPath = (() => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const i = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName).indexOf(n) : 0;
      parts.unshift(n.tagName.toLowerCase() + (i > 0 ? ':nth-of-type(' + (i + 1) + ')' : ''));
    }
    return parts.join(' > ');
  })();

  // Die Vorfahren tragen das Layout. Ohne sie steht das Element im Nichts.
  const ancestors = [];
  for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
    const c = getComputedStyle(n);
    ancestors.unshift({
      tag: n.tagName.toLowerCase(), id: n.id || null, cls: n.getAttribute('class') || '',
      layout: {
        display: c.display, position: c.position,
        'flex-direction': c.flexDirection, 'align-items': c.alignItems, 'justify-content': c.justifyContent,
        gap: c.gap, padding: c.padding, 'max-width': c.maxWidth,
        'font-family': c.fontFamily, 'font-size': c.fontSize, color: c.color,
        'background-color': c.backgroundColor, perspective: c.perspective,
        'text-align': c.textAlign, 'line-height': c.lineHeight,
      },
    });
    if (ancestors.length >= 6) break;
  }

  // ── CSS: passende Regeln, Keyframes, Pseudo-Elemente, @font-face
  const rules = [], keyframes = {}, fontFaces = [], pseudo = [], mediaSeen = [];
  const scopeEls = [el, ...el.querySelectorAll('*')].slice(0, scope === 'section' || scope === 'deps' ? 400 : 150);

  // ":hover" & Co. matchen im Ruhezustand nie — fuer die Regelsuche entfernen,
  // sonst faellt genau die Regel raus, die die Animation ausloest.
  const STATE = /::?(hover|focus|focus-visible|focus-within|active|visited|target|checked|before|after|first-line|first-letter|placeholder|selection|marker|backdrop|not-allowed)\b(\([^)]*\))?/g;
  const matchesAny = selText => selText.split(',').some(part => {
    const clean = part.replace(STATE, '').trim();
    if (!clean) return false;
    try { return scopeEls.some(n => n.matches(clean)); } catch { return false; }
  });

  const walk = (list, media) => {
    for (const r of list) {
      try {
        if (r.type === 1 /* style */) {
          if (!r.selectorText || !r.cssText || !matchesAny(r.selectorText)) continue;
          rules.push({ selector: r.selectorText, css: r.cssText, media: media || null });
          if (/::(before|after|marker|placeholder|selection|first-line|first-letter|backdrop)/.test(r.selectorText)) pseudo.push(r.selectorText);
          if (media) mediaSeen.push(media);
        } else if (r.type === 7 /* keyframes */) keyframes[r.name] = r.cssText;
        else if (r.type === 5 /* font-face */) fontFaces.push(r.cssText);
        else if (r.type === 4 /* media */) walk(r.cssRules, r.conditionText);
        else if (r.cssRules) walk(r.cssRules, media);
      } catch { /* CORS-gesperrtes Stylesheet — nicht lesbar, kein Fehler */ }
    }
  };
  let blockedSheets = 0;
  for (const s of document.styleSheets) { try { walk(s.cssRules, null); } catch { blockedSheets++; } }

  // Nur die Keyframes, die das Ziel wirklich benutzt
  const usedKf = new Set();
  for (const n of scopeEls) {
    for (const pe of [null, '::before', '::after']) {
      const an = getComputedStyle(n, pe).animationName;
      if (an && an !== 'none') an.split(',').forEach(k => usedKf.add(k.trim()));
    }
  }

  const c = getComputedStyle(el);
  const computed = {};
  for (const p of watch) computed[p] = c.getPropertyValue(p);
  const declared = {
    transitionProperty: c.transitionProperty, transitionDuration: c.transitionDuration,
    transitionDelay: c.transitionDelay, transitionTimingFunction: c.transitionTimingFunction,
    animationName: c.animationName, animationDuration: c.animationDuration,
    animationDelay: c.animationDelay, animationTimingFunction: c.animationTimingFunction,
    animationIterationCount: c.animationIterationCount, animationDirection: c.animationDirection,
    animationFillMode: c.animationFillMode, animationPlayState: c.animationPlayState,
    willChange: c.willChange, position: c.position, display: c.display, mixBlendMode: c.mixBlendMode,
  };

  // ── Listener, die dieses Ziel oder seine Vorfahren betreffen
  const chain = new Set(); for (let n = el; n; n = n.parentElement) chain.add(n);
  const own = new Set(), inherited = new Set(), globalEv = new Set();
  for (const l of P.listeners) {
    if (!l.node) { if (l.on === 'window' || l.on === 'document') globalEv.add(l.type); continue; }
    if (l.node === el || el.contains(l.node)) own.add(l.type);
    else if (chain.has(l.node)) inherited.add(l.type);
  }

  const observedByIO = P.io
    .filter(o => o.nodes?.some(n => n === el || el.contains(n) || n.contains(el)))
    .map(o => ({ threshold: o.threshold, rootMargin: o.rootMargin }));

  // ── Bibliotheken (dieselbe Liste wie tools/motion.mjs)
  const libs = [];
  const has = (fn, label) => { try { if (fn()) libs.push(label); } catch {} };
  has(() => window.gsap, 'gsap');
  has(() => window.ScrollTrigger || window.gsap?.core?.globals?.().ScrollTrigger, 'ScrollTrigger');
  has(() => window.Lenis || window.lenis, 'lenis');
  has(() => window.LocomotiveScroll, 'locomotive');
  has(() => window.THREE, 'three');
  has(() => window.Rive || window.rive, 'rive');
  has(() => window.anime, 'anime');
  has(() => window.Motion || window.motion, 'motion');
  has(() => window.Swiper, 'swiper');
  has(() => window.barba, 'barba');
  has(() => window.Alpine, 'alpine');
  has(() => document.querySelector('[data-framer-name],[data-projection-id]'), 'framer');

  // ── Technik im Ziel selbst
  const canvases = [...el.querySelectorAll('canvas')].concat(el.tagName === 'CANVAS' ? [el] : []);
  const webgl = canvases.some(cv => {
    try { const a = cv.getContext('webgl2'); const b = a || cv.getContext('webgl'); return !!b; } catch { return false; }
  });
  const media = {
    canvas: canvases.length, webgl,
    video: el.querySelectorAll('video').length + (el.tagName === 'VIDEO' ? 1 : 0),
    audio: el.querySelectorAll('audio').length + (el.tagName === 'AUDIO' ? 1 : 0),
    svg: el.querySelectorAll('svg').length + (el.tagName === 'SVG' ? 1 : 0),
    iframe: el.querySelectorAll('iframe').length,
  };

  // ── Assets und Schriften, die im Ziel vorkommen
  const assets = new Set();
  for (const n of scopeEls) {
    if (n.tagName === 'IMG' && n.currentSrc) assets.add(n.currentSrc);
    if ((n.tagName === 'VIDEO' || n.tagName === 'AUDIO') && n.currentSrc) assets.add(n.currentSrc);
    const bg = getComputedStyle(n).backgroundImage;
    for (const m of (bg || '').matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      try { assets.add(new URL(m[2], location.href).href); } catch {}
    }
  }
  const fonts = [...new Set(scopeEls.map(n => getComputedStyle(n).fontFamily).filter(Boolean))].slice(0, 8);

  // ── Welche Eigenschaften diese Seite an diesem Ziel ueberhaupt bewegt.
  // Aus drei Quellen, alle schon eingesammelt: die Zustandsregeln (:hover,
  // .is-active …), die benutzten Keyframes, und was transition-property
  // ausdruecklich nennt.
  const props = new Set();
  const propsIn = css => { for (const m of css.matchAll(/[;{]\s*(-{0,2}[a-z][a-z0-9-]*)\s*:/g)) props.add(m[1]); };
  for (const r of rules) if (/:(hover|focus|active|checked|target)|\.(is-|has-|in\b|active|open|visible|shown)/.test(r.selector)) propsIn(r.css);
  for (const k of usedKf) if (keyframes[k]) propsIn(keyframes[k]);
  for (const p of (c.transitionProperty || '').split(',').map(s => s.trim())) {
    if (p && p !== 'all' && p !== 'none') props.add(p);
  }

  // ── Was ein Nachbau braucht ────────────────────────────────────────────
  // Bewusst eine BESCHREIBUNG, kein DOM-Abzug: Tag, Rolle, sichtbarer Text,
  // und nur Klassennamen, die etwas bedeuten. Wer daraus neu schreibt, kopiert
  // nichts — er baut nach, was gemessen wurde. Genau das trennt eine eigene
  // Komponente von einem umbenannten Clone.
  const SEMANTIC = /^[a-z][a-z-]{2,24}$/i;
  const simplify = (node, depth = 0) => ({
    tag: node.tagName.toLowerCase(),
    role: node.getAttribute('role') || null,
    label: node.getAttribute('aria-label') || node.getAttribute('alt') || node.getAttribute('title') || null,
    href: node.tagName === 'A' ? !!node.getAttribute('href') : undefined,
    text: [...node.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').slice(0, 160) || null,
    semantic: [...node.classList].filter(c => SEMANTIC.test(c) && !/^(is|has)-/.test(c)).slice(0, 3),
    children: depth < 2 ? [...node.children].slice(0, 8).map(c => simplify(c, depth + 1)) : [],
  });

  // Die Kastenwerte des Ziels im Ruhezustand — der Startzustand, den der
  // Nachbau treffen muss.
  const BOX = ['display', 'flex-direction', 'align-items', 'justify-content', 'gap',
    'padding', 'margin', 'width', 'height', 'min-height', 'max-width', 'box-sizing',
    'background-color', 'color', 'border', 'border-radius', 'box-shadow',
    'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
    'text-transform', 'text-align', 'text-decoration-line', 'opacity', 'transform',
    'overflow', 'position', 'cursor', 'white-space'];
  const box = {};
  for (const p of BOX) box[p] = c.getPropertyValue(p);

  // Welche Kastenwerte die Seite an diesem Element SELBST deklariert. Der Rest
  // ist Layout-Ergebnis: die gemessene Breite eines Block-Elements ist die
  // Breite seines Elternteils, keine Eigenschaft der Komponente. Wer sie in
  // einen Nachbau schreibt, friert das Layout einer fremden Seite ein.
  const declaredBoxProps = new Set();
  for (const r of rules) {
    let ownRule = false;
    try { ownRule = r.selector.split(',').some(s => { const cl = s.replace(STATE, '').trim(); return cl && el.matches(cl); }); } catch {}
    if (!ownRule) continue;
    for (const mm of r.css.matchAll(/[;{]\s*(-{0,2}[a-z][a-z0-9-]*)\s*:/g)) declaredBoxProps.add(mm[1]);
  }

  const rect = el.getBoundingClientRect();
  return {
    found: true,
    candidateProps: [...props],
    structure: simplify(el),
    box,
    declaredBoxProps: [...declaredBoxProps],
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: (el.getAttribute('class') || '').split(/\s+/).filter(Boolean),
    text: (el.innerText || '').trim().slice(0, 200),
    domPath, path: path(el),
    rect: { x: Math.round(rect.x), y: Math.round(rect.y + window.scrollY), w: Math.round(rect.width), h: Math.round(rect.height) },
    inViewport: rect.top < innerHeight && rect.bottom > 0,
    childCount: el.querySelectorAll('*').length,
    outerHTML: el.outerHTML.length > 60000 ? el.outerHTML.slice(0, 60000) + '\n<!-- parity: gekuerzt -->' : el.outerHTML,
    ancestors, computed, declared,
    css: {
      rules, keyframes: Object.fromEntries([...usedKf].filter(k => keyframes[k]).map(k => [k, keyframes[k]])),
      fontFaces: fontFaces.slice(0, 30), pseudo: [...new Set(pseudo)],
      media: [...new Set(mediaSeen)], blockedSheets,
    },
    events: { own: [...own], ancestor: [...inherited], global: [...globalEv] },
    observers: { intersection: observedByIO, resize: P.ro, rafCalls: P.raf, waapiCalls: P.waapi },
    libs, media, assets: [...assets].slice(0, 40), fonts,
    documentClasses: document.documentElement.className,
  };
};

// ── In-Page: pro Frame abtasten ─────────────────────────────────────────────
const SAMPLE = ({ sel, watch, ms }) => new Promise(res => {
  const el = document.querySelector(sel);
  if (!el) return res([]);
  const camel = p => p.replace(/-([a-z])/g, (_, x) => x.toUpperCase());
  const out = [];
  const t0 = performance.now();
  const tick = () => {
    const c = getComputedStyle(el);
    const row = { t: Math.round(performance.now() - t0) };
    for (const p of watch) row[p] = c.getPropertyValue(p);
    // Was die Engine gerade selbst abspielt — die verlaesslichste Quelle.
    row.anims = el.getAnimations({ subtree: true }).map(a => {
      const o = { kind: a.constructor.name, name: a.animationName || a.transitionProperty || null, state: a.playState };
      try { const t = a.effect.getTiming();
            o.timing = { duration: t.duration, delay: t.delay, easing: t.easing, iterations: t.iterations, direction: t.direction, fill: t.fill }; } catch { o.timing = null; }
      try { o.self = a.effect.target === el; } catch { o.self = null; }
      try {
        o.keyframes = a.effect.getKeyframes().map(k => {
          const f = { offset: k.offset, easing: k.easing };
          for (const p of watch) if (k[camel(p)] != null) f[p] = k[camel(p)];
          return f;
        });
      } catch { o.keyframes = []; }
      return o;
    });
    out.push(row);
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
    else res(out);
  };
  requestAnimationFrame(tick);
});

// ── Auswertung einer Abtastreihe ────────────────────────────────────────────
const analyseFrames = (frames, watch) => {
  if (!frames.length) return null;
  const first = frames[0];
  const changed = {};
  for (const p of watch) {
    let firstChange = null, lastChange = null, prev = first[p];
    for (const f of frames) {
      if (f[p] !== prev) { if (firstChange === null) firstChange = f.t; lastChange = f.t; prev = f[p]; }
    }
    if (firstChange !== null) {
      changed[p] = { from: first[p], to: frames.at(-1)[p], delay: firstChange, settled: lastChange, duration: lastChange - firstChange };
    }
  }
  // Deklarierte Timings schlagen gemessene: sie kommen aus der Engine, nicht aus
  // einem Abtastraster, das jeder ausgelastete Frame verschiebt.
  const anims = [], seen = new Set();
  for (const f of frames) for (const a of f.anims || []) {
    const k = a.kind + '|' + a.name + '|' + JSON.stringify(a.timing);
    if (!seen.has(k)) { seen.add(k); anims.push(a); }
  }
  return { changed, anims, frames: frames.length, span: frames.at(-1).t };
};

const median = xs => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

// ── Trigger ─────────────────────────────────────────────────────────────────
const inferTrigger = d => {
  const hoverRule = d.css.rules.some(r => /:hover/.test(r.selector));
  const clickish = ['click', 'pointerdown', 'mousedown', 'touchstart'].some(t => d.events.own.includes(t) || d.events.ancestor.includes(t));
  const dragish = ['pointermove', 'mousemove', 'dragstart', 'touchmove'].some(t => d.events.own.includes(t));
  if (d.observers.intersection.length) return 'scroll';
  if (hoverRule) return 'hover';
  if (dragish) return 'drag';
  if (clickish) return 'click';
  if (d.declared.animationName && d.declared.animationName !== 'none') {
    return /infinite/.test(d.declared.animationIterationCount) ? 'loop' : 'load';
  }
  if (!d.inViewport) return 'scroll';
  if (parseFloat(d.declared.transitionDuration) > 0) return 'hover';
  return 'load';
};

const fireTrigger = async (page, sel, trigger) => {
  const loc = page.locator(sel).first();
  switch (trigger) {
    case 'hover':  await loc.hover({ timeout: 5000, force: true }); break;
    case 'click':  await loc.click({ timeout: 5000, force: true, noWaitAfter: true }); break;
    case 'focus':  await loc.focus({ timeout: 5000 }); break;
    case 'scroll': await page.evaluate(s => document.querySelector(s)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), sel); break;
    case 'drag': {
      const b = await loc.boundingBox();
      if (b) {
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2 + 40, { steps: 12 });
        await page.mouse.up();
      }
      break;
    }
    case 'pointer': {
      const b = await loc.boundingBox();
      if (b) for (let i = 0; i <= 10; i++) await page.mouse.move(b.x + (b.width * i) / 10, b.y + b.height / 2);
      break;
    }
    case 'touch': await loc.tap({ timeout: 5000 }).catch(() => loc.click({ force: true })); break;
    case 'idle':  await page.waitForTimeout(1200); break;
    default:      break;   // load / loop laufen von allein, es wird nur zugesehen
  }
};

const resetTrigger = async (page, sel, trigger) => {
  if (['hover', 'pointer', 'drag'].includes(trigger)) await page.mouse.move(2, 2);
  if (trigger === 'scroll') { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400); }
  if (['click', 'touch'].includes(trigger)) await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
};

// ── Isolierbarkeit ──────────────────────────────────────────────────────────
// Vier Stufen, wie in der Spezifikation. Die Regeln sind bewusst konservativ:
// lieber "teilweise isolierbar" behaupten und recht behalten, als "isolierbar"
// versprechen und eine kaputte Preview ausliefern.
const classify = (d, measured) => {
  const warn = [], reasons = [];
  let level = 'isolatable', conf = 1;

  if (!d.found) return { level: 'not-analysable', reasons: ['Element nicht gefunden'], warnings: [], confidence: 0 };

  if (d.media.webgl || d.libs.includes('three')) {
    level = 'reference-only'; conf -= .45;
    reasons.push('WebGL/Three.js-Szene — die Runtime laesst sich nicht in eine Datei schneiden');
  } else if (d.media.canvas) {
    level = 'reference-only'; conf -= .35;
    reasons.push('Canvas-Zeichnung — der Inhalt entsteht aus JS, nicht aus DOM/CSS');
  } else if (d.libs.includes('rive')) {
    level = 'reference-only'; conf -= .4;
    reasons.push('Rive-Runtime noetig');
  }

  const jsLibs = d.libs.filter(l => ['gsap', 'ScrollTrigger', 'motion', 'framer', 'anime', 'lenis', 'locomotive', 'swiper'].includes(l));
  const engineAnims = (measured?.anims || []).length;
  if (level === 'isolatable' && jsLibs.length && !engineAnims) {
    level = 'partial'; conf -= .3;
    reasons.push('Bewegung kommt aus ' + jsLibs.join('/') + ' — der Code liegt in der Library, nicht im CSS');
  }
  if (level === 'isolatable' && d.observers.intersection.length) {
    level = 'partial'; conf -= .12;
    reasons.push('IntersectionObserver: der Trigger haengt an der Scroll-Position der Seite');
  }
  if (d.events.ancestor.length) {
    warn.push('Listener sitzen an Vorfahren (' + d.events.ancestor.join(', ') + ') — Parent-State noetig');
    if (level === 'isolatable') { level = 'partial'; conf -= .15; }
  }
  if (d.css.blockedSheets) {
    warn.push(d.css.blockedSheets + ' Stylesheet(s) nicht lesbar (CORS) — das CSS ist womoeglich unvollstaendig');
    conf -= .1 * d.css.blockedSheets;
  }
  if (d.assets.length) warn.push(d.assets.length + ' fremde Assets referenziert — verlinkt, nicht mitkopiert');
  if (d.css.fontFaces.length) warn.push(d.css.fontFaces.length + ' @font-face-Regeln — fremde Schriften, Lizenz pruefen');
  if (d.libs.includes('ScrollTrigger')) warn.push('ScrollTrigger: Start- und Endpunkte haengen an der Seitenhoehe, nicht am Element');
  if (!measured || (!Object.keys(measured.changed || {}).length && !engineAnims)) {
    warn.push('Beim gewaehlten Trigger hat sich nichts messbar veraendert');
    conf -= .3;
  }

  return { level, reasons, warnings: warn, confidence: Math.max(0, Math.min(1, Math.round(conf * 100) / 100)) };
};

// ── Isolierte Preview bauen ─────────────────────────────────────────────────
const buildIsolated = (d, trigger, origin) => {
  const abs = u => { try { return new URL(u, origin).href; } catch { return u; } };
  const cssText = [
    '/* parity — isoliertes CSS. Original-Regeln der Quellseite, die auf das Ziel',
    '   oder seine Kinder passen. Nicht neu geschrieben, nur ausgeschnitten. */',
    ...d.css.fontFaces,
    ...Object.values(d.css.keyframes),
    ...d.css.rules.map(r => r.media ? '@media ' + r.media + ' {\n  ' + r.css + '\n}' : r.css),
  ].join('\n')
    // Relative URLs zeigen nach dem Ausschneiden ins Leere — auf den Ursprung
    // biegen, damit die Preview zeigt, was sie zeigen soll. Dass das fremde
    // Assets sind, steht als Warnung in den Metadaten.
    .replace(/url\((['"]?)(?!data:|https?:|\/\/|#)([^'")]+)\1\)/g, (m, q, u) => 'url(' + q + abs(u) + q + ')');

  const styleOf = layout => Object.entries(layout)
    .filter(([, v]) => v && !['none', 'normal', 'auto', 'static', '0px', 'rgba(0, 0, 0, 0)'].includes(v))
    .map(([k, v]) => k + ':' + v).join(';');

  const wrapOpen = d.ancestors.map(a =>
    `<div class="parity-ctx" data-ctx="${a.tag}${a.id ? '#' + a.id : ''}" style="${styleOf(a.layout)}">`).join('\n');
  const wrapClose = d.ancestors.map(() => '</div>').join('');

  const innerSel = d.id ? '#' + d.id : d.classes.length ? '.' + CSS_escape(d.classes[0]) : d.tag;

  const html = `<div id="parity-stage">\n${wrapOpen}\n${d.outerHTML}\n${wrapClose}\n</div>`;

  const js = `// parity — Steuerung der isolierten Preview.
// Trigger: ${trigger}.
// Play/Pause/Restart wirken auf alles, was die Browser-Engine kennt: CSS-
// Transitions, CSS-Keyframes und Web Animations API. Nicht auf JS-Schleifen
// fremder Libraries — die werden hier bewusst nicht mitgeliefert.
const stage = document.getElementById('parity-stage');
const target = stage.querySelector(${JSON.stringify(innerSel)}) || stage.lastElementChild;
const anims = () => (target ? target.getAnimations({ subtree: true }) : []);

const api = {
  play:    () => anims().forEach(a => a.play()),
  pause:   () => anims().forEach(a => a.pause()),
  restart: () => anims().forEach(a => { a.cancel(); a.play(); }),
  reset:   () => anims().forEach(a => a.cancel()),
  rate:    v => anims().forEach(a => { a.playbackRate = Number(v) || 1; }),
  fire:    () => {
    if (!target) return;
${trigger === 'hover' ? `    target.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));`
  : trigger === 'click' ? `    target.click();`
  : trigger === 'focus' ? `    target.focus();`
  : trigger === 'scroll' ? `    target.scrollIntoView({ block: 'center', behavior: 'smooth' });`
  : `    api.restart();`}
  },
};

window.parityPreview = api;
// Die UI steuert die Preview von aussen durch das iframe.
window.addEventListener('message', e => {
  const c = e.data && e.data.parity;
  if (c && typeof api[c.cmd] === 'function') api[c.cmd](c.arg);
});
`;

  const page = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>parity — isolated</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; }
  body { background: ${d.ancestors[0]?.layout['background-color'] || '#ffffff'}; }
  #parity-stage { min-height: 100vh; }
  .parity-ctx { min-width: 0; }
</style>
<link rel="stylesheet" href="style.css">
</head>
<body>
${html}
<!-- Klassisches Script, kein Modul: type="module" wird beim Oeffnen per
     file:// von der CORS-Regel blockiert, und dann ist die Demo tot, sobald
     jemand sie herunterlaedt und doppelklickt. -->
<script src="script.js"></script>
</body>
</html>`;

  return { page, cssText, js };
};

// CSS.escape gibt es hier nicht — Klassennamen sind fast immer harmlos, aber
// ein fuehrender Ziffer- oder Sonderzeichenfall wuerde den Selector zerlegen.
function CSS_escape(s) { return s.replace(/([^\w-])/g, '\\$1').replace(/^(\d)/, '\\3$1 '); }

// ── Lauf ────────────────────────────────────────────────────────────────────
const origin = new URL(URL_).origin;
mkdirSync(join(OUT, 'vanilla'), { recursive: true });

emit({ ev: 'phase', name: 'extract', status: 'start', url: URL_, selector: SEL });
console.log(`→ ${URL_}\n  Ziel: ${SEL}`);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const openPage = async (opts = {}) => {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    reducedMotion: opts.reducedMotion,
    hasTouch: !!opts.touch,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.addInitScript(INIT);
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(opts.settle ?? 3500);
  return { page, ctx, errors };
};

const { page, ctx, errors: consoleErrors } = await openPage();

// Einmal durchscrollen: Reveal-Styles existieren nur an Elementen, die die Seite
// schon angefasst hat. Ohne das misst man den Zustand vor dem Aufwachen.
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 3));
await page.waitForTimeout(1200);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(800);

const found = await page.locator(SEL).count().catch(() => 0);
if (!found) {
  await browser.close();
  emit({ ev: 'done', cmd: 'extract', exit: 1, err: 'Selector trifft nichts: ' + SEL });
  console.error(`✗ Selector trifft kein Element: ${SEL}`);
  process.exit(1);
}
step('element', 'Element gefunden', { count: found });

const data = await page.evaluate(INSPECT, { sel: SEL, scope: SCOPE, watch: BASE_WATCH });

// Was diese Seite an diesem Ziel wirklich bewegt, steht in ihrem eigenen CSS.
// Der Grundstock deckt den Normalfall ab; die Zusatzliste faengt die Faelle,
// die eine feste Auswahl nie erwischt — border-color, stroke, gap, was auch
// immer die Seite in ihrer :hover- oder Keyframe-Regel deklariert.
const EXTRA = (data.candidateProps || []).filter(p => !NOT_WATCHABLE.has(p) && !BASE_WATCH.includes(p));
const WATCH = [...BASE_WATCH, ...EXTRA].slice(0, 48);
if (EXTRA.length) emit({ ev: 'note', kind: 'extract', name: 'beobachtet', note: 'zusaetzlich aus dem CSS der Seite: ' + EXTRA.join(', '), bad: false });

step('css', 'CSS untersucht', { rules: data.css.rules.length, keyframes: Object.keys(data.css.keyframes).length, blocked: data.css.blockedSheets, watching: WATCH.length });
step('js', 'JavaScript untersucht', { listeners: data.events.own.length + data.events.ancestor.length, libs: data.libs });

const trigger = TRIGGER === 'auto' ? inferTrigger(data) : TRIGGER;
step('trigger', 'Trigger erkannt', { trigger, inferred: TRIGGER === 'auto' });
console.log(`  Trigger: ${trigger}${TRIGGER === 'auto' ? ' (erkannt)' : ''} · ${data.css.rules.length} CSS-Regeln · Libs: ${data.libs.join(', ') || '—'}`);

// ── mehrfach ausloesen und messen ───────────────────────────────────────────
// Ein Scroll-Reveal feuert genau einmal. Der Aufwaermscroll oben hat ihn schon
// ausgeloest, und Zurueckscrollen setzt ihn nicht zurueck — wer das ignoriert,
// misst den Endzustand gegen sich selbst und meldet "keine Bewegung". Fuer
// diese Trigger wird die Seite pro Durchgang neu geladen.
const RELOAD_TRIGGERS = new Set(['scroll', 'load', 'idle']);
const freshPage = async () => {
  // Ganz nach oben, BEVOR neu geladen wird: Chrome stellt beim Reload die alte
  // Scroll-Position wieder her. Laedt man von weiter unten neu, steht das Ziel
  // sofort im Viewport, der Observer feuert vor der ersten Messung — und die
  // Auswertung meldet "keine Bewegung", obwohl die Animation lief.
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
};

const runs = [];
for (let i = 0; i < REPEAT; i++) {
  if (RELOAD_TRIGGERS.has(trigger)) await freshPage();
  else await resetTrigger(page, SEL, trigger);
  const sampling = page.evaluate(SAMPLE, { sel: SEL, watch: WATCH, ms: 2600 });
  await page.waitForTimeout(60);
  await fireTrigger(page, SEL, trigger)
    .catch(e => emit({ ev: 'note', kind: 'extract', name: 'trigger', note: String(e).slice(0, 120), bad: true }));
  const r = analyseFrames(await sampling, WATCH);
  if (r) runs.push(r);
  emit({
    ev: 'row', kind: 'measure', label: 'Durchgang ' + (i + 1),
    source: Object.keys(r?.changed || {}).join(', ') || '—',
    clone: (r?.anims?.length || 0) + ' Animationen',
    match: !!(Object.keys(r?.changed || {}).length || r?.anims?.length),
  });
}

const measured = (() => {
  if (!runs[0]) return null;
  const anims = runs.flatMap(r => r.anims)
    .filter((a, i, arr) => arr.findIndex(b => b.name === a.name && JSON.stringify(b.timing) === JSON.stringify(a.timing)) === i);

  const sampledDuration = median(runs.flatMap(r => Object.values(r.changed).map(c => c.duration)));
  const sampledDelay = median(runs.flatMap(r => Object.values(r.changed).map(c => c.delay)));

  // Die Engine kennt die deklarierte Dauer exakt; das Abtasten schaetzt sie nur.
  // Bei einer Endlosschleife schaetzt es sogar Unsinn: dort aendert sich jeder
  // Frame, also meldet die Abtastung die Breite des Messfensters als "Dauer".
  const finite = anims.map(a => a.timing).filter(t => t && Number.isFinite(t.duration) && t.duration > 0);
  const loops = anims.some(a => a.timing && (a.timing.iterations === null || !Number.isFinite(a.timing.iterations)));
  const engineDuration = finite.length ? Math.max(...finite.map(t => t.duration)) : null;
  const engineDelay = finite.length ? Math.min(...finite.map(t => t.delay ?? 0)) : null;

  return {
    changed: runs[0].changed,
    anims,
    repeats: runs.length,
    stable: runs.every(r => Object.keys(r.changed).join() === Object.keys(runs[0].changed).join()),
    loops,
    // Engine schlaegt Abtastung. Nur wenn die Engine nichts weiss — GSAP und
    // anderes rAF-getriebenes JS laufen an ihr vorbei — zaehlt der Messwert.
    durationMedian: engineDuration ?? (loops ? null : sampledDuration),
    delayMedian: engineDelay ?? (loops ? null : sampledDelay),
    durationSource: engineDuration != null ? 'engine' : loops ? 'unbestimmt (Endlosschleife)' : 'abgetastet',
    sampledDurationMs: sampledDuration,
    sampledDelayMs: sampledDelay,
  };
})();

step('animation', 'Animation erkannt', {
  properties: Object.keys(measured?.changed || {}),
  anims: measured?.anims.length || 0,
  duration: measured?.durationMedian ?? null,
});

// ── Original-Preview ────────────────────────────────────────────────────────
// Der Startzustand eines Scroll-Reveals existiert nur auf einer frisch geladenen
// Seite — nach dem Feuern gibt es ihn nicht mehr zurueckzuholen.
if (RELOAD_TRIGGERS.has(trigger)) await freshPage();
else await resetTrigger(page, SEL, trigger);
const previews = {};
const shotOf = async (file, before) => {
  try {
    if (before) await before();
    await page.locator(SEL).first().screenshot({ path: join(OUT, file), timeout: 8000 });
    emit({ ev: 'shot', cmd: 'extract', mark: file.replace('.png', ''), path: join(OUT, file) });
    return file;
  } catch { return null; }
};
previews.original = await shotOf('preview-original.png', async () => {
  await page.locator(SEL).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
});
previews.originalAfter = await shotOf('preview-original-after.png', async () => {
  await fireTrigger(page, SEL, trigger).catch(() => {});
  await page.waitForTimeout(Math.min(2000, (measured?.durationMedian ?? 600) + 400));
});
step('original', 'Original-Preview erstellt', { shots: Object.values(previews).filter(Boolean).length });

// ── Reduced-Motion und mobile Variante ──────────────────────────────────────
const variantProbe = async opts => {
  const v = await openPage({ ...opts, settle: 2500 }).catch(() => null);
  if (!v) return null;
  try {
    if (!(await v.page.locator(SEL).count())) return { found: false };
    return await v.page.evaluate(({ sel, watch }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const c = getComputedStyle(el), o = {};
      for (const p of watch) o[p] = c.getPropertyValue(p);
      return {
        found: true, computed: o,
        animationName: c.animationName, animationDuration: c.animationDuration,
        transitionDuration: c.transitionDuration, display: c.display,
        anims: el.getAnimations({ subtree: true }).length,
      };
    }, { sel: SEL, watch: WATCH });
  } catch { return null; }
  finally { await v.ctx.close().catch(() => {}); }
};
const reducedMotion = await variantProbe({ reducedMotion: 'reduce' });
const mobile = await variantProbe({ viewport: { width: 390, height: 844 }, touch: true });
step('deps', 'Abhaengigkeiten geprueft', { libs: data.libs, assets: data.assets.length, fonts: data.fonts.length });

// ── Isolierbarkeit ──────────────────────────────────────────────────────────
const iso = classify(data, measured);
step('isolatability', 'Isolierbarkeit bewertet', { level: iso.level, confidence: iso.confidence });
console.log(`  Isolierbarkeit: ${iso.level} · Confidence ${iso.confidence}`);
for (const r of iso.reasons) emit({ ev: 'note', kind: 'extract', name: 'isolierbarkeit', note: r, bad: false });
for (const w of iso.warnings) emit({ ev: 'note', kind: 'extract', name: 'warnung', note: w, bad: true });

// ── isolierte Preview + Vanilla-Export ──────────────────────────────────────
const built = buildIsolated(data, trigger, origin);
writeFileSync(join(OUT, 'vanilla/index.html'), built.page, 'utf8');
writeFileSync(join(OUT, 'vanilla/style.css'), built.cssText, 'utf8');
writeFileSync(join(OUT, 'vanilla/script.js'), built.js, 'utf8');
step('isolated', 'Isolierte Preview erstellt', { out: join(OUT, 'vanilla/index.html') });

// Aufnahme der isolierten Fassung — der ehrliche Beleg, ob die Isolation traegt.
try {
  const p2 = await ctx.newPage();
  await p2.goto(pathToFileURL(resolvePath(OUT, 'vanilla/index.html')).href, { waitUntil: 'load', timeout: 20000 });
  await p2.waitForTimeout(1500);
  await p2.locator('#parity-stage').screenshot({ path: join(OUT, 'preview-isolated.png'), timeout: 8000 });
  previews.isolated = 'preview-isolated.png';
  emit({ ev: 'shot', cmd: 'extract', mark: 'preview-isolated', path: join(OUT, 'preview-isolated.png') });
  await p2.close();
} catch (e) {
  iso.warnings.push('Isolierte Preview liess sich nicht aufnehmen: ' + String(e).slice(0, 100));
}

await browser.close();

// ── Metadaten ───────────────────────────────────────────────────────────────
const techniques = [];
if (parseFloat(data.declared.transitionDuration) > 0) techniques.push('css-transition');
if (data.declared.animationName && data.declared.animationName !== 'none') techniques.push('css-keyframes');
if ((measured?.anims || []).some(a => a.kind === 'Animation')) techniques.push('web-animations-api');
if (data.observers.intersection.length) techniques.push('intersection-observer');
if (data.observers.rafCalls > 200) techniques.push('requestAnimationFrame');
if (data.media.webgl) techniques.push('webgl');
else if (data.media.canvas) techniques.push('canvas');
if (data.media.video) techniques.push('video');
if (data.media.audio) techniques.push('audio');
techniques.push(...data.libs);

const engineTimings = (measured?.anims || []).map(a => a.timing).filter(Boolean);

// ── Reduced Motion, ehrlich ausgewertet ─────────────────────────────────────
// Nicht ueber laufende Animationen im Ruhezustand: bei einem Hover- oder
// Click-Effekt laeuft dort nie etwas, und die Pruefung faellt dann IMMER
// positiv aus — auch bei einer Seite ohne jede Reduced-Motion-Regel.
// Verglichen wird stattdessen, was der Browser unter reduce deklariert.
const rmVerdict = (() => {
  if (!reducedMotion?.found) return { probed: false };
  const d = data.declared;
  const hasMotion = parseFloat(d.transitionDuration) > 0
    || (d.animationName && d.animationName !== 'none' && parseFloat(d.animationDuration) > 0);
  const base = {
    probed: true,
    animationsRunning: reducedMotion.anims,
    normal: { transitionDuration: d.transitionDuration, animationName: d.animationName, animationDuration: d.animationDuration },
    reduced: { transitionDuration: reducedMotion.transitionDuration, animationName: reducedMotion.animationName, animationDuration: reducedMotion.animationDuration },
  };
  if (!hasMotion) return { ...base, respected: null, note: 'Kein Motion am Element deklariert — nichts zu reduzieren.' };
  const changed = reducedMotion.transitionDuration !== d.transitionDuration
    || reducedMotion.animationDuration !== d.animationDuration
    || reducedMotion.animationName !== d.animationName;
  return {
    ...base,
    respected: changed,
    note: changed
      ? 'Unter prefers-reduced-motion: reduce liefert die Seite andere Werte — sie reagiert darauf.'
      : 'Unter prefers-reduced-motion: reduce sind die Werte unveraendert — die Seite ignoriert die Einstellung.',
  };
})();
if (rmVerdict.respected === false) iso.warnings.push('prefers-reduced-motion wird von der Quellseite ignoriert — beim Nachbau selbst beruecksichtigen');
const category =
  data.media.webgl ? 'webgl'
  : data.media.canvas ? 'canvas'
  : data.tag === 'nav' || data.classes.some(c => /nav|menu/i.test(c)) ? 'navigation'
  : data.media.video ? 'video'
  : data.media.audio ? 'audio'
  : ['button', 'a'].includes(data.tag) ? 'button'
  : data.classes.some(c => /card/i.test(c)) ? 'card'
  : data.tag === 'section' ? 'section'
  : Object.keys(measured?.changed || {}).length ? 'animation'
  : 'element';

const metadata = {
  id: SLUG + '-' + Date.now().toString(36),
  slug: SLUG,
  title: TITLE || (data.text ? data.text.split('\n')[0].slice(0, 50) : null) || SEL,
  source: URL_,
  route: new URL(URL_).pathname,
  selector: SEL,
  domPath: data.domPath,
  category,
  triggers: [trigger],
  techniques: [...new Set(techniques)],
  properties: Object.keys(measured?.changed || {}),
  timing: {
    durationMs: measured?.durationMedian ?? null,
    delayMs: measured?.delayMedian ?? null,
    // Woher der Wert stammt. "engine" ist exakt, "abgetastet" ist ein Messwert
    // mit Frame-Rauschen, "unbestimmt" heisst: die Schleife hat kein Ende.
    durationSource: measured?.durationSource ?? null,
    sampledDurationMs: measured?.sampledDurationMs ?? null,
    sampledDelayMs: measured?.sampledDelayMs ?? null,
    loops: measured?.loops ?? false,
    declared: {
      transitionDuration: data.declared.transitionDuration,
      transitionDelay: data.declared.transitionDelay,
      animationDuration: data.declared.animationDuration,
      animationDelay: data.declared.animationDelay,
      iterations: data.declared.animationIterationCount,
      direction: data.declared.animationDirection,
      fill: data.declared.animationFillMode,
    },
    engine: engineTimings,
    // Die Keyframes, wie die Engine sie kennt — mit Offsets. Daraus schreibt
    // tools/rebuild.mjs echte @keyframes statt nur from/to zu raten.
    keyframes: (measured?.anims || []).find(a => a.keyframes?.length > 1)?.keyframes ?? [],
    repeats: measured?.repeats ?? 0,
    stableAcrossRepeats: measured?.stable ?? null,
  },
  easing: [...new Set([
    ...(data.declared.transitionTimingFunction || '').split(/,(?![^(]*\))/).map(s => s.trim()),
    ...(data.declared.animationTimingFunction || '').split(/,(?![^(]*\))/).map(s => s.trim()),
    ...engineTimings.map(t => t.easing),
  ].filter(Boolean))],
  states: measured?.changed ?? {},
  dependencies: {
    libraries: data.libs,
    ancestorEvents: data.events.ancestor,
    globalEvents: data.events.global,
    intersectionObservers: data.observers.intersection,
    ancestorsNeeded: data.ancestors.length,
    documentClasses: data.documentClasses,
    blockedStylesheets: data.css.blockedSheets,
    rafCalls: data.observers.rafCalls,
  },
  assets: data.assets,
  fonts: data.fonts,
  responsive: { mobile },
  accessibility: {
    interactive: ['a', 'button', 'input', 'select', 'textarea'].includes(data.tag) || data.events.own.includes('click'),
    focusable: ['a', 'button', 'input', 'select', 'textarea'].includes(data.tag),
    hasText: !!data.text,
  },
  reducedMotion: rmVerdict,
  isolatability: iso.level,
  // Warum diese Einstufung — getrennt von den allgemeinen Warnungen. Beides in
  // einen Topf zu werfen liefert Saetze wie "als reference-only eingestuft:
  // 15 @font-face-Regeln", und das ist schlicht nicht der Grund gewesen.
  isolatabilityReasons: iso.reasons,
  confidence: iso.confidence,
  previews: {
    original: previews.original ?? null,
    originalAfter: previews.originalAfter ?? null,
    isolated: previews.isolated ?? null,
    rebuilt: null,
    comparison: null,
  },
  // Beschreibung des Ziels fuer einen Nachbau. Kein Original-Markup — daraus
  // schreibt tools/rebuild.mjs eine eigenstaendige Fassung.
  structure: data.structure,
  box: data.box,
  declaredBoxProps: data.declaredBoxProps,
  code: {
    vanilla: 'vanilla/index.html',
    react: null,
    svelte: null,
    htmlBytes: data.outerHTML.length,
    cssRules: data.css.rules.length,
  },
  status: iso.level === 'not-analysable' ? 'needs-review'
        : iso.level === 'reference-only' ? 'not-isolatable'
        : previews.isolated ? 'isolated' : 'inspected',
  warnings: [
    ...iso.warnings,
    ...iso.reasons,
    ...(consoleErrors.length ? [consoleErrors.length + ' Konsolenfehler auf der Quellseite'] : []),
  ],
  createdAt: new Date().toISOString(),
};

writeFileSync(join(OUT, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
step('code', 'Code vorbereitet', { out: OUT });

// ── Bericht ─────────────────────────────────────────────────────────────────
const changedRows = Object.entries(measured?.changed || {});
const report = `# ${metadata.title}

| | |
|---|---|
| Quelle | ${URL_} |
| Selector | \`${SEL}\` |
| DOM-Pfad | \`${data.domPath}\` |
| Kategorie | ${category} |
| Trigger | ${trigger}${TRIGGER === 'auto' ? ' (automatisch erkannt)' : ' (vorgegeben)'} |
| Technik | ${metadata.techniques.join(', ') || '—'} |
| Isolierbarkeit | **${iso.level}** |
| Confidence | ${iso.confidence} |
| Status | ${metadata.status} |

## Gemessen

${changedRows.length
  ? '| Eigenschaft | von | nach | Delay | Dauer |\n|---|---|---|---|---|\n' +
    changedRows.map(([p, c]) => `| ${p} | \`${String(c.from).slice(0, 40)}\` | \`${String(c.to).slice(0, 40)}\` | ${c.delay}ms | ${c.duration}ms |`).join('\n')
  : `_Beim Trigger \`${trigger}\` hat sich keine der beobachteten Eigenschaften messbar veraendert._`}

${(measured?.anims || []).length
  ? '### Von der Browser-Engine gemeldet\n\n' + measured.anims.map(a =>
      `- **${a.kind}** \`${a.name || '—'}\` — ${a.timing?.duration ?? '?'}ms, Delay ${a.timing?.delay ?? 0}ms, \`${a.timing?.easing ?? '—'}\`, ${a.timing?.iterations ?? 1}×`).join('\n')
  : ''}

**Dauer: ${measured?.durationMedian != null ? measured.durationMedian + 'ms' : 'unbestimmt'}** (Quelle: ${measured?.durationSource ?? '—'})${
  measured?.delayMedian != null ? `, Delay ${measured.delayMedian}ms` : ''}${
  measured?.loops ? ' · laeuft endlos' : ''}

Gemessen ueber ${measured?.repeats ?? 0} Durchgaenge${
  measured?.stable === false ? ' — **die Durchgaenge waren nicht deckungsgleich**, der Wert ist nur ein Anhaltspunkt.'
  : measured?.stable ? ', deckungsgleich.' : '.'}

## Abhaengigkeiten

- Libraries: ${data.libs.join(', ') || 'keine erkannt'}
- Listener am Ziel: ${data.events.own.join(', ') || '—'}
- Listener an Vorfahren: ${data.events.ancestor.join(', ') || '—'}
- IntersectionObserver: ${data.observers.intersection.length ? JSON.stringify(data.observers.intersection) : 'keine'}
- Vorfahren fuers Layout noetig: ${data.ancestors.length}
- Fremde Assets: ${data.assets.length}
- Schriften: ${data.fonts.join(' · ') || '—'}

## Reduced Motion

${!rmVerdict.probed ? '_nicht gemessen_'
  : rmVerdict.respected === null ? `— ${rmVerdict.note}`
  : rmVerdict.respected ? `✓ ${rmVerdict.note}`
  : `✗ ${rmVerdict.note}`}

| | normal | reduce |
|---|---|---|
| transition-duration | ${rmVerdict.normal?.transitionDuration ?? '—'} | ${rmVerdict.reduced?.transitionDuration ?? '—'} |
| animation-name | ${rmVerdict.normal?.animationName ?? '—'} | ${rmVerdict.reduced?.animationName ?? '—'} |
| animation-duration | ${rmVerdict.normal?.animationDuration ?? '—'} | ${rmVerdict.reduced?.animationDuration ?? '—'} |

## Mobile

${mobile?.found ? `390×844 gemessen: animation \`${mobile.animationName || 'none'}\` ${mobile.animationDuration || ''}, display \`${mobile.display}\`` : '_nicht gemessen_'}

## Grenzen

${iso.reasons.length ? iso.reasons.map(r => '- ' + r).join('\n') : '- keine strukturellen Hindernisse gefunden'}

${iso.warnings.length ? '## Warnungen\n\n' + iso.warnings.map(w => '- ' + w).join('\n') + '\n' : ''}
## Was hier liegt

- \`metadata.json\` — die Messung, maschinenlesbar
- \`vanilla/index.html\` — isolierte Fassung mit **Original-CSS**, nicht neu geschrieben
- \`preview-original.png\` / \`preview-isolated.png\` — Aufnahmen zum Vergleich

> Die isolierte Fassung enthaelt Original-Markup und Original-CSS der Quellseite.
> Sie ist ein Analyseergebnis, keine eigene Komponente — nicht veroeffentlichen.
`;
writeFileSync(join(OUT, 'report.md'), report, 'utf8');

emit({
  ev: 'done', cmd: 'extract', out: OUT, slug: SLUG, trigger,
  isolatability: iso.level, confidence: iso.confidence, status: metadata.status,
  properties: metadata.properties, duration: measured?.durationMedian ?? null,
  warnings: metadata.warnings.length, exit: 0,
});
step('export', 'Export bereit', { out: OUT });

console.log(`\n✓ ${OUT}`);
console.log(`  ${category} · ${trigger} · ${iso.level} (Confidence ${iso.confidence})`);
if (changedRows.length) console.log(`  bewegt: ${changedRows.map(([p, c]) => `${p} ${c.duration}ms`).join(' · ')}`);
else console.log(`  keine messbare Bewegung beim Trigger "${trigger}"`);
if (metadata.warnings.length) console.log(`  ${metadata.warnings.length} Warnung(en) — siehe report.md`);
