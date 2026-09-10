// parity ui — Selective Extraction.
//
// Der Picker laeuft im Elternfenster und liest den DOM des iframes direkt.
// Das geht nur, weil die inspizierte Seite vom selben Server kommt wie diese
// Oberflaeche (siehe serveSite in ui/server.mjs). Deshalb wird auch nichts in
// die Seite hineingeschrieben — kein injiziertes Overlay, kein postMessage,
// keine Skripte, die mit denen der Seite kollidieren koennen.

const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ── Fortschritt ─────────────────────────────────────────────────────────────
// Dieselben elf Schritte, die tools/extract.mjs meldet.
const STEPS = [
  ['element', 'Element gefunden'], ['animation', 'Animation erkannt'], ['trigger', 'Trigger erkannt'],
  ['css', 'CSS untersucht'], ['js', 'JavaScript untersucht'], ['deps', 'Abhaengigkeiten geprueft'],
  ['original', 'Original-Preview'], ['isolatability', 'Isolierbarkeit'], ['isolated', 'Isolierte Preview'],
  ['code', 'Code vorbereitet'], ['export', 'Export bereit'],
];
const stepEl = {};

export const initPipeline = () => {
  if (Object.keys(stepEl).length) return;
  for (const [key, label] of STEPS) {
    const b = el('div', 'step');
    b.append(el('span', 'n', label), el('span', 'v', '·'));
    $('xpipeline').append(b);
    stepEl[key] = b;
  }
};
const resetSteps = () => {
  for (const [k] of STEPS) { if (!stepEl[k]) continue; delete stepEl[k].dataset.s; stepEl[k].querySelector('.v').textContent = '·'; }
};

// ── Zustand ─────────────────────────────────────────────────────────────────
const state = {
  url: null,          // Original-URL — dagegen wird gemessen
  picked: null,       // Element im iframe
  selector: null,
  scope: 'element',
  trigger: 'auto',
  meta: null,         // metadata.json der letzten Analyse
  base: null,         // /extractions/<slug>
};

const frame = () => $('frame');
const fdoc = () => { try { return frame().contentDocument; } catch { return null; } };

// ── Selector fuer ein Element ───────────────────────────────────────────────
// Muss im Dokument eindeutig sein, sonst misst extract spaeter ein anderes
// Element als das angeklickte. Wird deshalb gegen den DOM geprueft, nicht
// nur zusammengebaut.
const CSSesc = s => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/([^\w-])/g, '\\$1');

const uniqueSelector = (doc, node) => {
  if (!doc || !node || node.nodeType !== 1) return null;
  const one = sel => { try { return doc.querySelectorAll(sel).length === 1; } catch { return false; } };
  if (node.id && one('#' + CSSesc(node.id))) return '#' + CSSesc(node.id);

  const parts = [];
  for (let n = node; n && n.nodeType === 1 && n !== doc.documentElement; n = n.parentElement) {
    if (n.id && one('#' + CSSesc(n.id))) { parts.unshift('#' + CSSesc(n.id)); break; }

    let s = n.tagName.toLowerCase();
    // Generierte Klassen (hash-artig) taugen nicht als Anker — sie aendern sich
    // beim naechsten Build der Zielseite.
    const cls = [...n.classList].filter(c => /^[a-zA-Z][\w-]{1,40}$/.test(c) && !/^[a-z]+-[a-z0-9]{6,}$/i.test(c)).slice(0, 3);
    if (cls.length) s += '.' + cls.map(CSSesc).join('.');

    const parent = n.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(c => { try { return c.matches(s); } catch { return false; } });
      if (siblings.length > 1) {
        const sameTag = [...parent.children].filter(c => c.tagName === n.tagName);
        s += ':nth-of-type(' + (sameTag.indexOf(n) + 1) + ')';
      }
    }
    parts.unshift(s);
    const test = parts.join(' > ');
    if (one(test)) return test;
  }
  return parts.join(' > ');
};

const domPathOf = node => {
  const parts = [];
  for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
    const p = n.parentElement;
    const i = p ? [...p.children].filter(c => c.tagName === n.tagName).indexOf(n) : 0;
    parts.unshift(n.tagName.toLowerCase() + (i > 0 ? ':nth-of-type(' + (i + 1) + ')' : ''));
  }
  return parts.join(' > ');
};

// Was an diesem Element ueberhaupt Bewegung verspricht — reine Vorschau, die
// echte Antwort liefert erst die Messung.
const hintFor = node => {
  const doc = fdoc();
  if (!doc || !doc.defaultView) return '—';
  const c = doc.defaultView.getComputedStyle(node);
  const bits = [];
  if (parseFloat(c.transitionDuration) > 0) bits.push('transition ' + c.transitionDuration.split(',')[0].trim());
  if (c.animationName && c.animationName !== 'none') bits.push('@keyframes ' + c.animationName.split(',')[0].trim());
  try { const a = node.getAnimations({ subtree: true }); if (a.length) bits.push(a.length + ' laufende Animation(en)'); } catch {}
  if (node.querySelector('canvas') || node.tagName === 'CANVAS') bits.push('Canvas');
  if (node.querySelector('video') || node.tagName === 'VIDEO') bits.push('Video');
  if (node.querySelector('svg')) bits.push('SVG');
  return bits.length ? bits.join(' · ') : 'keine CSS-Bewegung im Ruhezustand — Trigger noetig';
};

// ── Highlight ───────────────────────────────────────────────────────────────
// Der Rahmen wird im Elternfenster gezeichnet. In die Seite hineinzuschreiben
// wuerde ihr Layout veraendern — und damit genau das verfaelschen, was hier
// gemessen werden soll.
const drawHighlight = node => {
  const hl = $('hl');
  if (!node) { hl.hidden = true; return; }
  const r = node.getBoundingClientRect();
  const f = frame().getBoundingClientRect();
  if (!r.width && !r.height) { hl.hidden = true; return; }
  hl.hidden = false;
  hl.style.left = (f.left + r.left) + 'px';
  hl.style.top = (f.top + r.top) + 'px';
  hl.style.width = r.width + 'px';
  hl.style.height = r.height + 'px';
  $('hl-tag').textContent = node.tagName.toLowerCase()
    + (node.id ? '#' + node.id : '')
    + ([...node.classList].slice(0, 2).map(c => '.' + c).join(''))
    + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
};

const pick = node => {
  if (!node || node.nodeType !== 1) return;
  state.picked = node;
  const doc = fdoc();
  state.selector = uniqueSelector(doc, node);
  $('p-sel').textContent = state.selector || '—';
  $('p-path').textContent = domPathOf(node);
  $('p-hint').textContent = hintFor(node);
  $('sel-count').textContent = (() => {
    try { return doc.querySelectorAll(state.selector).length + ' Treffer'; } catch { return 'Selector nicht pruefbar'; }
  })();
  $('sec-pick').hidden = false;
  $('analyse').disabled = false;
  node.scrollIntoView?.({ block: 'nearest' });
  drawHighlight(node);
};

// ── iframe verdrahten ───────────────────────────────────────────────────────
let wired = false;
const wireFrame = () => {
  const doc = fdoc();
  if (!doc) { $('pick-c').textContent = 'Seite nicht lesbar'; return; }
  wired = true;
  $('pick-c').textContent = 'mit der Maus fahren, dann klicken';

  doc.addEventListener('mousemove', e => {
    const n = doc.elementFromPoint(e.clientX, e.clientY);
    if (n && n !== state.hover) { state.hover = n; drawHighlight(n); }
  }, true);
  doc.addEventListener('mouseleave', () => drawHighlight(state.picked), true);

  // Capture-Phase: die Seite darf den Klick nicht vorher abfangen, und
  // navigieren soll er auch nicht — sonst ist das Inspect-Ziel weg.
  doc.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    pick(doc.elementFromPoint(e.clientX, e.clientY));
  }, true);
  doc.addEventListener('submit', e => e.preventDefault(), true);

  // Beim Scrollen im iframe wandert das Element unter dem Rahmen weg.
  doc.addEventListener('scroll', () => drawHighlight(state.picked), true);
  frame().contentWindow.addEventListener('resize', () => drawHighlight(state.picked));
};

window.addEventListener('scroll', () => state.picked && drawHighlight(state.picked), true);

// ── Verwandtschaft ──────────────────────────────────────────────────────────
const REL = {
  parent: n => n.parentElement,
  child: n => n.firstElementChild,
  prev: n => n.previousElementSibling,
  next: n => n.nextElementSibling,
};
document.addEventListener('click', e => {
  const b = e.target.closest?.('.nav-rel button');
  if (!b || !state.picked) return;
  const next = REL[b.dataset.rel]?.(state.picked);
  if (next) pick(next);
});

// ── Chips ───────────────────────────────────────────────────────────────────
const wireChips = (id, key) => {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const x of $(id).querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    state[key] = b.dataset[key];
  });
};

// ── Analyse anstossen ───────────────────────────────────────────────────────
const post = async (path, body) => {
  const r = await fetch(path, { method: 'POST', body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.err || ('HTTP ' + r.status));
  return j;
};

export const openSite = async url => {
  state.url = url;
  $('inspect-empty').textContent = 'Seite wird geholt…';
  try {
    await post('/api/inspect', { url });
  } catch (e) {
    $('inspect-empty').textContent = 'Fehler: ' + e.message;
  }
};

const startAnalysis = async () => {
  if (!state.selector || !state.url) return;
  resetSteps();
  $('analyse').disabled = true;
  $('info').innerHTML = '<div class="empty">Analyse laeuft…</div>';
  $('preview').innerHTML = '<div class="empty">Analyse laeuft…</div>';
  $('code').innerHTML = '<div class="empty">Analyse laeuft…</div>';
  try {
    await post('/api/extract', {
      url: state.url, selector: state.selector, scope: state.scope,
      trigger: state.trigger, title: $('p-title').value.trim() || undefined,
    });
  } catch (e) {
    $('info').innerHTML = '<div class="empty">Fehler: ' + esc(e.message) + '</div>';
    $('analyse').disabled = false;
  }
};

// ── Ergebnis darstellen ─────────────────────────────────────────────────────
const ISO_LABEL = {
  isolatable: ['isolierbar', 'ok'],
  partial: ['teilweise isolierbar', 'limit'],
  'reference-only': ['nur als Referenz dokumentierbar', 'limit'],
  'not-analysable': ['nicht analysierbar', 'bad'],
};

const kv = (parent, label, value, cls) => {
  const row = el('div', 'kv');
  row.append(el('b', null, label));
  const v = el('span', cls || null);
  if (value instanceof Node) v.append(value); else v.textContent = value ?? '—';
  row.append(v);
  parent.append(row);
  return row;
};

const renderInfo = m => {
  const box = el('div');
  const [isoText, isoCls] = ISO_LABEL[m.isolatability] || [m.isolatability, ''];

  kv(box, 'Name', m.title);
  kv(box, 'Elementtyp', m.category);
  kv(box, 'Selector', Object.assign(el('code'), { textContent: m.selector }));
  kv(box, 'DOM-Pfad', Object.assign(el('code', 'wrapcode'), { textContent: m.domPath }));
  kv(box, 'Trigger', m.triggers.join(', '));
  kv(box, 'Technik', m.techniques.join(', ') || '—');
  kv(box, 'Libraries', m.dependencies.libraries.join(', ') || 'keine erkannt');
  kv(box, 'Assets', m.assets.length ? m.assets.length + ' fremde Dateien' : 'keine');
  kv(box, 'Schriften', m.fonts.join(' · ') || '—');

  const t = m.timing;
  kv(box, 'Timing', t.durationMs != null
    ? `${t.durationMs}ms${t.delayMs ? ' · Delay ' + t.delayMs + 'ms' : ''} (${t.durationSource})${t.loops ? ' · Endlosschleife' : ''}`
    : 'keine Dauer messbar');
  kv(box, 'Easing', m.easing.join(' · ') || '—');
  kv(box, 'Eigenschaften', m.properties.join(', ') || 'keine Bewegung gemessen');
  kv(box, 'Wiederholungen', `${t.repeats}× gemessen${t.stableAcrossRepeats === false ? ' — nicht deckungsgleich' : t.stableAcrossRepeats ? ', deckungsgleich' : ''}`);

  const rm = m.reducedMotion;
  kv(box, 'Reduced Motion',
    !rm.probed ? 'nicht gemessen'
    : rm.respected === null ? 'kein Motion deklariert — nichts zu reduzieren'
    : rm.respected ? '✓ die Quellseite reagiert darauf'
    : '✗ die Quellseite ignoriert die Einstellung',
    rm.respected === false ? 'bad' : rm.respected === true ? 'ok' : '');
  kv(box, 'Accessibility', [
    m.accessibility.interactive ? 'interaktiv' : 'statisch',
    m.accessibility.focusable ? 'fokussierbar' : 'nicht fokussierbar',
    m.accessibility.hasText ? 'mit Text' : 'ohne Text',
  ].join(' · '));
  kv(box, 'Isolierbarkeit', isoText, isoCls);
  kv(box, 'Confidence', String(m.confidence), m.confidence >= 0.8 ? 'ok' : m.confidence >= 0.5 ? 'limit' : 'bad');
  kv(box, 'Status', m.status);

  if (m.warnings.length) {
    const w = el('div', 'notes');
    w.append(el('div', null, m.warnings.length + ' Hinweis(e):'));
    for (const x of m.warnings) w.append(el('div', 'limit', '· ' + x));
    box.append(w);
  }
  $('info').innerHTML = '';
  $('info').append(box);
  $('info-c').textContent = isoText;
};

// ── Preview ─────────────────────────────────────────────────────────────────
const PREVIEW_TABS = [
  ['original', 'Original'],
  ['isolated', 'Isolated'],
  ['rebuilt', 'Rebuilt'],
  ['comparison', 'Comparison'],
];
let previewTab = 'original';

const renderPreview = m => {
  const base = state.base;
  const box = el('div');

  const tabs = el('div', 'chips');
  for (const [key, label] of PREVIEW_TABS) {
    const b = el('button', null, label);
    b.dataset.tab = key;
    b.setAttribute('aria-pressed', String(key === previewTab));
    b.onclick = () => { previewTab = key; renderPreview(m); };
    tabs.append(b);
  }
  box.append(tabs);

  const stage = el('div', 'pstage');
  box.append(stage);

  const shot = (file, alt) => {
    const i = el('img', 'pshot');
    i.src = base + '/' + file + '?t=' + Date.now();
    i.alt = alt;
    return i;
  };
  const note = (txt, cls) => el('div', 'pnote ' + (cls || ''), txt);

  if (previewTab === 'original') {
    if (m.previews.original) {
      const pair = el('div', 'pair');
      const a = el('figure'); a.append(shot(m.previews.original, 'Original vor dem Trigger'), el('figcaption', null, 'vor dem Trigger'));
      pair.append(a);
      if (m.previews.originalAfter) {
        const b = el('figure'); b.append(shot(m.previews.originalAfter, 'Original nach dem Trigger'), el('figcaption', null, 'nach ' + m.triggers[0]));
        pair.append(b);
      }
      stage.append(pair);
      stage.append(note('Aufnahmen aus der laufenden Originalseite. Ein Live-Einbetten des Originals scheitert bei den meisten Produktionsseiten an X-Frame-Options.'));
    } else stage.append(note('Keine Original-Aufnahme — das Element war nicht aufnehmbar.', 'bad'));
  }

  if (previewTab === 'isolated') {
    if (m.previews.isolated || m.code.vanilla) {
      const wrap = el('div', 'framewrap live');
      const f = el('iframe');
      f.id = 'pframe';
      f.src = base + '/vanilla/index.html?t=' + Date.now();
      f.title = 'Isolierte Preview';
      wrap.append(f);
      stage.append(controls(), wrap);
      stage.append(note('Original-Markup und Original-CSS, auf das Ziel reduziert. Keine eigene Implementierung — nicht veroeffentlichen.'));
    } else stage.append(note('Keine isolierte Fassung erzeugt.', 'bad'));
  }

  if (previewTab === 'rebuilt') {
    if (m.code.rebuilt) {
      const wrap = el('div', 'framewrap live');
      const f = el('iframe');
      f.id = 'pframe';
      f.src = base + '/rebuilt/index.html?t=' + Date.now();
      f.title = 'Nachgebaute Preview';
      wrap.append(f);
      stage.append(controls(), wrap);
      stage.append(note(`Neu geschrieben aus der Messung — .${m.rebuild?.root} als ${m.rebuild?.technique}, `
        + `Trigger ${m.rebuild?.trigger}. Kennt das CSS der Quellseite nicht.`));
      if (m.rebuild?.notes?.length) {
        const ul = el('ul', 'why');
        for (const n of m.rebuild.notes.slice(1)) ul.append(el('li', null, n));
        if (ul.children.length) stage.append(ul);
      }
    } else {
      // Ehrlichkeit ist hier Pflicht. Ein leerer Rahmen mit dem Original darin
      // waere eine Luege, und ein geratener Nachbau auch.
      stage.append(note('Fuer dieses Ziel wird keine eigene Fassung erzeugt.', 'limit'));
      const why = el('ul', 'why');
      if (m.isolatability === 'reference-only')
        why.append(el('li', null, 'Nur als Referenz dokumentierbar: ' + (m.warnings[0] || 'die Runtime laesst sich nicht ausschneiden.')));
      for (const t of ['webgl', 'canvas', 'three', 'rive']) {
        if (m.techniques?.includes(t)) { why.append(el('li', null, `Der Inhalt entsteht aus ${t} — was dort gezeichnet wird, steht in keiner CSS-Regel.`)); break; }
      }
      why.append(el('li', null, 'Was es gibt: die vollstaendige Messung, den Bericht und die isolierte Fassung mit Original-Code.'));
      stage.append(why);
    }
  }

  if (previewTab === 'comparison') {
    // Original gegen die EIGENE Fassung, sobald es sie gibt — das ist der
    // Vergleich, der etwas beweist. Die isolierte Fassung enthaelt dasselbe
    // CSS wie das Original; sie danebenzustellen zeigt vor allem, dass
    // Kopieren funktioniert.
    const rightFile = m.previews.rebuilt || m.previews.isolated;
    const rightLabel = m.previews.rebuilt ? 'Nachgebaut' : 'Isoliert';
    if (m.previews.original && rightFile) {
      const wrap = el('div', 'blend');
      const a = el('img', 'a'), b = el('img', 'b');
      a.src = base + '/' + m.previews.original + '?t=' + Date.now();
      b.src = base + '/' + rightFile + '?t=' + Date.now();
      wrap.append(a, b, el('div', 'lab l', 'Original'), el('div', 'lab r', rightLabel));
      const range = el('input');
      Object.assign(range, { type: 'range', min: 0, max: 100, value: 50 });
      range.addEventListener('input', () => { b.style.opacity = range.value / 100; });
      b.style.opacity = .5;
      stage.append(wrap, range, el('div', 'hint', `Regler: links Original, rechts ${rightLabel.toLowerCase()}e Fassung`));
      if (!m.previews.rebuilt) stage.append(note('Verglichen wird gegen die isolierte Fassung — eine eigene Fassung gibt es fuer dieses Ziel nicht.', 'limit'));
    } else stage.append(note('Fuer den Vergleich fehlt eine der beiden Aufnahmen.', 'limit'));
  }

  // Export
  const ex = el('div', 'exports');
  ex.append(el('span', 'lbl', 'Export:'));
  const dl = (href, label, name) => {
    const a = el('a', 'ghostlink', label);
    a.href = href; a.download = name || '';
    return a;
  };
  if (m.previews.original) ex.append(dl(base + '/' + m.previews.original, 'Screenshot Original'));
  if (m.previews.isolated) ex.append(dl(base + '/' + m.previews.isolated, 'Screenshot Isoliert'));
  ex.append(dl(base + '/report.md', 'Analysebericht'));
  ex.append(dl(base + '/metadata.json', 'Metadaten JSON'));
  ex.append(dl(base + '/vanilla/index.html', 'Isolierte Demo'));
  if (m.code.rebuilt) ex.append(dl(base + '/rebuilt/index.html', 'Nachbau-Demo'));
  if (m.code.react) ex.append(dl(base + '/react/Component.jsx', 'React-Komponente'));
  if (m.code.svelte) ex.append(dl(base + '/svelte/Component.svelte', 'Svelte-Komponente'));
  if (m.previews.rebuilt) ex.append(dl(base + '/' + m.previews.rebuilt, 'Screenshot Nachbau'));
  if (m.previews.video) ex.append(dl(base + '/' + m.previews.video, 'Video (webm)'));
  if (m.code.single) ex.append(dl(base + '/' + m.code.single, 'Einzeldatei'));
  if (m.code.zip) ex.append(dl(base + '/' + m.code.zip, 'ZIP (alles)'));
  box.append(ex);

  $('preview').innerHTML = '';
  $('preview').append(box);
  $('prev-c').textContent = PREVIEW_TABS.find(t => t[0] === previewTab)[1];
};

// Steuerung der isolierten Preview. Die generierte script.js im iframe hoert
// auf postMessage — deshalb funktioniert das ohne Zugriff auf ihre Interna.
const controls = () => {
  const bar = el('div', 'controls');
  const send = (cmd, arg) => {
    const f = $('pframe');
    f?.contentWindow?.postMessage({ parity: { cmd, arg } }, '*');
  };
  for (const [cmd, label] of [['play', 'Play'], ['pause', 'Pause'], ['restart', 'Restart'], ['reset', 'Reset'], ['fire', 'Trigger ausloesen']]) {
    const b = el('button', 'ghost', label);
    b.onclick = () => send(cmd, null);
    bar.append(b);
  }

  const rate = el('select', 'ghost');
  for (const v of ['0.25', '0.5', '1', '2']) {
    const o = el('option', null, v + '×'); o.value = v; if (v === '1') o.selected = true;
    rate.append(o);
  }
  rate.onchange = () => send('rate', Number(rate.value));
  bar.append(rate);

  const sep = el('span', 'sep');
  bar.append(sep);

  for (const [w, label] of [[null, 'Desktop'], [390, 'Mobile']]) {
    const b = el('button', 'ghost', label);
    b.onclick = () => { const f = $('pframe'); if (f) f.style.maxWidth = w ? w + 'px' : ''; };
    bar.append(b);
  }

  const rm = el('button', 'ghost', 'Reduced Motion');
  rm.setAttribute('aria-pressed', 'false');
  rm.onclick = () => {
    const f = $('pframe');
    const d = f?.contentDocument;
    if (!d) return;
    const on = rm.getAttribute('aria-pressed') === 'true';
    let s = d.getElementById('parity-rm');
    if (on) { s?.remove(); rm.setAttribute('aria-pressed', 'false'); return; }
    s = d.createElement('style');
    s.id = 'parity-rm';
    s.textContent = '*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}';
    d.head.append(s);
    rm.setAttribute('aria-pressed', 'true');
  };
  rm.title = 'Simuliert prefers-reduced-motion in der Preview. Wie die Originalseite darauf reagiert, steht in der Analyse.';
  bar.append(rm);

  const full = el('button', 'ghost', 'Vollbild');
  full.onclick = () => $('pframe')?.parentElement?.requestFullscreen?.();
  bar.append(full);

  return bar;
};

// ── Code ────────────────────────────────────────────────────────────────────
// Kleiner Regex-Highlighter statt einer Library. Er faerbt Strings, Kommentare,
// Schluesselwoerter und Zahlen — mehr braucht ein Lesefenster nicht.
const highlight = (src, lang) => {
  let s = esc(src);
  const box = [];
  const stash = (re, cls) => { s = s.replace(re, m => { box.push('<i class="' + cls + '">' + m + '</i>'); return '' + (box.length - 1) + ''; }); };
  stash(/\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*/gm, 'c-com');
  stash(/&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|"[^"\n]*"|'[^'\n]*'|`[^`]*`/g, 'c-str');
  if (lang === 'html') stash(/&lt;\/?[a-zA-Z][\w-]*/g, 'c-kw');
  else if (lang === 'css') { stash(/@[a-z-]+/g, 'c-kw'); stash(/[.#][a-zA-Z_][\w-]*/g, 'c-sel'); stash(/[a-z-]+(?=\s*:)/g, 'c-prop'); }
  else stash(/\b(const|let|var|function|return|if|else|for|of|in|new|class|export|import|await|async|window|document|null|true|false)\b/g, 'c-kw');
  stash(/\b\d+(\.\d+)?(ms|s|px|%|em|rem|deg)?\b/g, 'c-num');
  return s.replace(/(\d+)/g, (_, i) => box[Number(i)]);
};

const renderCode = async m => {
  const base = state.base;
  // Zwei Herkuenfte, deutlich getrennt. "Isoliert" ist Original-Code der
  // Quellseite, "Nachbau" ist aus der Messung geschrieben. Wer die verwechselt,
  // veroeffentlicht fremden Code als eigenen.
  const files = [
    ['Isoliert · HTML', 'vanilla/index.html', 'html'],
    ['Isoliert · CSS', 'vanilla/style.css', 'css'],
    ['Isoliert · JS', 'vanilla/script.js', 'js'],
    ...(m.code.rebuilt ? [
      ['Nachbau · HTML', 'rebuilt/index.html', 'html'],
      ['Nachbau · CSS', 'rebuilt/style.css', 'css'],
      ['Nachbau · JS', 'rebuilt/script.js', 'js'],
    ] : []),
    ...(m.code.react ? [['React', 'react/Component.jsx', 'js']] : []),
    ...(m.code.svelte ? [['Svelte', 'svelte/Component.svelte', 'html']] : []),
    ['Metadaten', 'metadata.json', 'js'],
    ['Bericht', 'report.md', 'md'],
    ...(m.code.rebuilt ? [] : [['Warum kein Nachbau', 'NOT-REBUILT.md', 'md']]),
  ];
  const box = el('div');
  const tabs = el('div', 'chips');
  const pane = el('div');
  let active = 0;

  const show = async i => {
    active = i;
    for (const [j, b] of [...tabs.children].entries()) b.setAttribute('aria-pressed', String(j === i));
    const [label, file, lang] = files[i];
    pane.innerHTML = '<div class="empty">laedt…</div>';
    let text;
    try {
      const r = await fetch(base + '/' + file);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      text = await r.text();
    } catch (e) {
      pane.innerHTML = '<div class="pnote bad">' + esc(label) + ' nicht verfuegbar: ' + esc(e.message) + '</div>';
      return;
    }
    pane.innerHTML = '';

    const bar = el('div', 'codebar');
    const copy = el('button', 'ghost', 'Kopieren');
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = 'kopiert ✓'; setTimeout(() => { copy.textContent = 'Kopieren'; }, 1400); }
      catch { copy.textContent = 'Zwischenablage gesperrt'; }
    };
    const down = el('a', 'ghostlink', 'Download');
    down.href = base + '/' + file; down.download = file.split('/').pop();
    bar.append(copy, down, el('span', 'muted', file + ' · ' + text.length + ' Zeichen'));

    const pre = el('pre', 'code');
    pre.innerHTML = highlight(text.slice(0, 200000), lang);
    pane.append(bar, pre);
  };

  for (const [i, [label]] of files.entries()) {
    const b = el('button', null, label);
    b.setAttribute('aria-pressed', String(i === 0));
    b.onclick = () => show(i);
    tabs.append(b);
  }

  // Was woher kommt — der wichtigste Satz auf dieser Seite.
  const missing = el('div', 'notes');
  missing.append(el('div', 'bad', '· Isoliert = Original-Markup und Original-CSS der Quellseite. Analyseergebnis, nicht veroeffentlichen.'));
  if (m.code.rebuilt)
    missing.append(el('div', 'ok', '· Nachbau, React und Svelte = aus der Messung geschrieben, ohne das CSS der Quellseite. Eigenstaendig.'));
  else
    missing.append(el('div', 'limit', '· Fuer dieses Ziel gibt es keinen Nachbau — siehe Tab "Warum kein Nachbau".'));
  if (m.assets.length) missing.append(el('div', 'bad', '· ' + m.assets.length + ' fremde Assets werden nur verlinkt, nicht mitgeliefert'));
  if (m.fonts.length) missing.append(el('div', 'bad', '· Schriften der Quellseite — Lizenz vor jeder Weiterverwendung pruefen'));

  box.append(tabs, pane, missing);
  $('code').innerHTML = '';
  $('code').append(box);
  $('code-c').textContent = m.code.cssRules + ' CSS-Regeln';
  await show(0);
};

// ── Results: alles, was schon extrahiert wurde ──────────────────────────────
// Der eigene Ergebnisbereich von parity. Jede Extraktion bleibt hier liegen,
// laesst sich wieder oeffnen und einzeln exportieren — ohne fremdes Projekt.
let listFilter = 'alle';

export const loadList = async () => {
  let list = [];
  try { list = await (await fetch('/api/extractions')).json(); } catch { return; }
  $('list-c').textContent = list.length ? list.length + ' gespeichert' : '';
  if (!list.length) {
    $('list').innerHTML = '<div class="empty">Noch nichts extrahiert. Oben eine Seite oeffnen, ein Element anklicken, Analyse starten.</div>';
    return;
  }

  const box = el('div');

  // Filter nach Isolierbarkeit — das ist die Unterscheidung, die zaehlt:
  // was laesst sich weiterverwenden, was ist nur dokumentiert.
  const counts = { alle: list.length };
  for (const x of list) counts[x.isolatability] = (counts[x.isolatability] || 0) + 1;
  const chips = el('div', 'chips');
  for (const key of ['alle', 'isolatable', 'partial', 'reference-only', 'not-analysable']) {
    if (key !== 'alle' && !counts[key]) continue;
    const b = el('button', null, (key === 'alle' ? 'Alle' : ISO_LABEL[key]?.[0] || key) + ' · ' + (counts[key] || 0));
    b.setAttribute('aria-pressed', String(key === listFilter));
    b.onclick = () => { listFilter = key; loadList(); };
    chips.append(b);
  }
  box.append(chips);

  const grid = el('div', 'results');
  const shown = list.filter(x => listFilter === 'alle' || x.isolatability === listFilter);

  for (const x of shown) {
    const card = el('article', 'result');
    const b = '/extractions/' + x.slug;

    const thumbFile = x.previews?.rebuilt || x.previews?.isolated || x.previews?.original;
    const thumb = el('div', 'rthumb');
    if (thumbFile) {
      const img = el('img');
      img.src = b + '/' + thumbFile + '?t=' + Date.now();
      img.alt = '';
      img.loading = 'lazy';
      thumb.append(img);
    } else thumb.append(el('span', 'muted', 'keine Aufnahme'));
    // Die Kachel zeigt den Nachbau, wenn es ihn gibt — sonst muss dranstehen,
    // dass hier Original-Code zu sehen ist.
    thumb.append(el('span', 'rbadge ' + (x.previews?.rebuilt ? 'ok' : 'limit'),
      x.previews?.rebuilt ? 'Nachbau' : x.previews?.isolated ? 'isoliert' : 'original'));
    card.append(thumb);

    const body = el('div', 'rbody');
    const h = el('h3', null, x.title || x.slug);
    body.append(h);

    const meta = el('div', 'rmeta');
    meta.append(el('span', null, x.category));
    if ((x.triggers || []).length) meta.append(el('span', null, x.triggers.join(', ')));
    if (x.duration != null) meta.append(el('span', null, x.duration + 'ms'));
    const [isoText, isoCls] = ISO_LABEL[x.isolatability] || [x.isolatability, ''];
    meta.append(el('span', isoCls, isoText));
    meta.append(el('span', x.confidence >= .8 ? 'ok' : x.confidence >= .5 ? 'limit' : 'bad', 'Confidence ' + x.confidence));
    if (x.warnings) meta.append(el('span', 'limit', x.warnings + ' Hinweise'));
    body.append(meta);

    try {
      body.append(el('div', 'rsrc', new URL(x.source).host + new URL(x.source).pathname));
    } catch { body.append(el('div', 'rsrc', x.source)); }

    const actions = el('div', 'ractions');
    const open = el('button', 'ghost', 'Oeffnen');
    open.onclick = () => { showResult(b); $('sec-info').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    actions.append(open);
    const link = (file, label) => {
      const a = el('a', 'ghostlink', label);
      a.href = b + '/' + file; a.download = '';
      return a;
    };
    if (x.code?.zip) actions.append(link(x.code.zip, 'ZIP'));
    if (x.previews?.video) actions.append(link(x.previews.video, 'Video'));
    if (x.code?.single) actions.append(link(x.code.single, 'Einzeldatei'));
    body.append(actions);

    card.append(body);
    grid.append(card);
  }

  box.append(grid);
  $('list').innerHTML = '';
  $('list').append(box);
};

const showResult = async base => {
  state.base = base;
  let m;
  try { m = await (await fetch(base + '/metadata.json?t=' + Date.now())).json(); }
  catch (e) { $('info').innerHTML = '<div class="pnote bad">metadata.json nicht lesbar: ' + esc(String(e)) + '</div>'; return; }
  state.meta = m;
  previewTab = m.code.rebuilt ? 'rebuilt' : m.previews.isolated ? 'isolated' : 'original';
  renderInfo(m);
  renderPreview(m);
  await renderCode(m);
  loadList();
};

// ── Ereignisstrom ───────────────────────────────────────────────────────────
export const handle = e => {
  switch (e.ev) {
    case 'inspect':
      if (e.status === 'start') { $('pick-c').textContent = 'HTML wird geholt…'; }
      if (e.status === 'ready') {
        $('inspect-empty').hidden = true;
        $('stage').hidden = false;
        const f = frame();
        wired = false;
        f.onload = () => wireFrame();
        f.src = e.frame + '?t=' + Date.now();
      }
      if (e.status === 'error') $('inspect-empty').textContent = 'Seite konnte nicht geoeffnet werden.';
      break;

    case 'extract':
      if (e.status === 'start') { resetSteps(); $('info-c').textContent = 'laeuft'; }
      if (e.status === 'end')   { $('analyse').disabled = false; showResult(e.out); }
      if (e.status === 'error') { $('analyse').disabled = false; $('info').innerHTML = '<div class="pnote bad">Analyse fehlgeschlagen — siehe Meldungen unten.</div>'; }
      break;

    case 'step': {
      const b = stepEl[e.name];
      if (!b) break;
      b.dataset.s = 'done';
      const v = b.querySelector('.v');
      v.textContent =
        e.name === 'element' ? e.count + ' Treffer'
        : e.name === 'css' ? e.rules + ' Regeln'
        : e.name === 'js' ? (e.libs?.length ? e.libs.join(',') : e.listeners + ' Listener')
        : e.name === 'trigger' ? e.trigger
        : e.name === 'animation' ? (e.duration != null ? e.duration + 'ms' : (e.properties?.length ? e.properties.length + ' Props' : '—'))
        : e.name === 'isolatability' ? e.level
        : e.name === 'deps' ? (e.assets + ' Assets')
        : '✓';
      break;
    }

    case 'note':
      if (e.kind === 'extract') {
        let n = $('info').querySelector('.livenotes');
        if (!n) { n = el('div', 'notes livenotes'); $('info').append(n); }
        n.append(el('div', e.bad ? 'bad' : 'limit', '· ' + e.note));
      }
      break;
  }
};

// ── Start ───────────────────────────────────────────────────────────────────
export const init = () => {
  initPipeline();
  wireChips('scope-chips', 'scope');
  wireChips('trigger-chips', 'trigger');
  $('analyse').onclick = startAnalysis;
  loadList();
};
