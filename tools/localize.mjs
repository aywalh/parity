// Turn a downloaded site into a locally runnable clone:
// fetch the pristine server HTML, strip tracking, and install a guard that
// stops the clone from talking to the original's live services.
//
// Usage: node tools/localize.mjs <url> <outDir> [--keep-analytics] [--allow <host,host>]
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emit } from './_emit.mjs';

const args = process.argv.slice(2);
const URL_ = args[0], OUT = args[1];
if (!URL_ || !OUT) {
  console.error('usage: node tools/localize.mjs <url> <outDir> [--keep-analytics] [--allow <host,host>]');
  process.exit(1);
}
const KEEP_ANALYTICS = args.includes('--keep-analytics');
const allowIdx = args.indexOf('--allow');
const ALLOW = allowIdx > -1 ? (args[allowIdx + 1] || '').split(',').map(s => s.trim()).filter(Boolean) : [];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

// Hosts whose only job is telemetry. Removing them changes nothing visually
// and stops the clone reporting to the original's dashboards.
const TRACKERS = [
  'cloudflareinsights.com', 'google-analytics.com', 'googletagmanager.com',
  'analytics.google.com', 'connect.facebook.net', 'static.hotjar.com',
  'cdn.segment.com', 'cdn.mxpnl.com', 'plausible.io', 'cdn.usefathom.com',
  'matomo.cloud', 'clarity.ms', 'doubleclick.net', 'amplitude.com',
  'posthog.com', 'sentry-cdn.com', 'newrelic.com', 'hs-scripts.com',
];

mkdirSync(OUT, { recursive: true });

// ── 1. pristine server HTML ────────────────────────────────────────────────
// page.content() would give the hydrated DOM, which makes the runtime start
// from a state it was going to build itself.
emit({ ev: 'phase', name: 'localize', status: 'start', url: URL_ });
console.log('→ fetching server HTML');
const res = await fetch(URL_, { headers: { 'user-agent': UA } });
if (!res.ok) { console.error(`  HTTP ${res.status}`); process.exit(1); }
let html = await res.text();
const before = html.length;

// ── 2. strip trackers ──────────────────────────────────────────────────────
const stripped = [];
if (!KEEP_ANALYTICS) {
  for (const host of TRACKERS) {
    const re = new RegExp(`<script[^>]*(?:src=["'][^"']*${host.replace(/\./g, '\\.')}[^"']*["'])[^>]*>\\s*</script>`, 'gi');
    const hits = html.match(re);
    if (hits) { stripped.push(`${host} (${hits.length})`); html = html.replace(re, `<!-- parity: ${host} removed -->`); }
  }
  // Inline GTM/GA snippets keyed by their measurement id
  const inline = /<script(?![^>]*\ssrc=)[^>]*>[\s\S]{0,4000}?(?:googletagmanager|gtag\(|GoogleAnalytics|dataLayer\.push)[\s\S]*?<\/script>/gi;
  const inlineHits = html.match(inline);
  if (inlineHits) { stripped.push(`inline GTM/GA (${inlineHits.length})`); html = html.replace(inline, '<!-- parity: inline analytics removed -->'); }
}

// ── 2b. point the clone at itself ──────────────────────────────────────────
// A site that writes its own absolute URLs into the markup keeps loading from
// the original server, however many assets were downloaded. The clone then
// looks right and proves nothing — it *is* the original. Same-origin absolutes
// become root-relative so the local server answers instead.
//
// Plain string replacement, not a regex: the prefixes are literals, and the
// escaping needed to express them as a pattern is where this goes wrong.
// A path boundary. String.fromCharCode(92) is a backslash — spelled this way
// because the literal does not survive every editing layer intact.
const BOUND = new Set(['/', '"', "'", '`', ')', ' ', String.fromCharCode(92)]);
const target = new URL(URL_);
const bare = target.host.replace(/^www\./, '');
let rewritten = 0;
for (const host of new Set([target.host, bare, 'www.' + bare])) {
  for (const prefix of [`https://${host}`, `http://${host}`, `https:\/\/${host}`, `http:\/\/${host}`, `//${host}`]) {
    let i = 0;
    while ((i = html.indexOf(prefix, i)) !== -1) {
      const after = html[i + prefix.length];
      // Only a real path boundary — never chop "igloo.inc.evil.com" in half.
      if (after === undefined || BOUND.has(after)) {
        html = html.slice(0, i) + html.slice(i + prefix.length);
        rewritten++;
      } else i += prefix.length;
    }
  }
}
if (rewritten) emit({ ev: 'note', kind: 'localize', name: 'self-contained', note: `${rewritten} absolute Origin-URLs umgebogen`, bad: false });

// ── 3. install the guard before any page script ────────────────────────────
const GUARD = 'parity-guard.js';
if (!html.includes(GUARD)) {
  const tag = `<script src="/${GUARD}"></script>`;
  // Must run before the first script the page loads, or its overrides land too late.
  if (/<script/i.test(html)) html = html.replace(/<script/i, `${tag}<script`);
  else if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `${tag}</head>`);
  else html = tag + html;
}

writeFileSync(join(OUT, 'index.html'), html, 'utf8');

// ── 4. the guard itself ────────────────────────────────────────────────────
const guard = `// parity guard — keeps this local clone from reaching the original's live services.
// Generated by tools/localize.mjs. Edit freely; it is plain JS.
(function () {
  var ORIGIN = location.origin;
  var ALLOW = ${JSON.stringify(ALLOW)};

  // data:, blob:, filesystem: and about: carry their own payload — they never
  // reach a server, so blocking them protects nobody and breaks exactly the
  // things a modern site inlines that way: wasm modules, workers, generated
  // media. new URL('data:...').origin is the string "null", which is why a
  // plain origin comparison silently forbids them.
  var SELF_CONTAINED = /^(data|blob|filesystem|about):/i;

  var allowed = function (url) {
    try {
      var s = String(url);
      if (SELF_CONTAINED.test(s)) return true;
      var u = new URL(s, location.href);
      if (u.origin === ORIGIN) return true;
      return ALLOW.some(function (h) { return u.host === h || u.host.endsWith('.' + h); });
    } catch (e) { return true; }
  };

  // What the caller is asking for decides what a block may answer with. A form
  // endpoint wants a success payload so the UI reaches its confirmed state; a
  // wasm module, a video manifest or an image cannot use one — handing them
  // {"result":"success"} turns a blocked request into a crash inside a decoder,
  // which reads like a broken clone instead of a blocked request.
  var BINARY = /\\.(wasm|mp4|webm|m3u8|mpd|ts|mp3|ogg|wav|flac|avif|webp|png|jpe?g|gif|svg|woff2?|ttf|otf|eot|glb|gltf|bin|ktx2|basis|drc|riv|zip|pdf|br)(\\?|#|$)/i;
  var wantsData = function (url) {
    try { return BINARY.test(new URL(url, location.href).pathname); } catch (e) { return false; }
  };

  var block = function (kind, url) {
    console.info('[parity] blocked ' + kind + ': ' + String(url).slice(0, 140));
  };

  // Third-party form endpoints (Mailchimp, HubSpot, Formspree, …) are usually
  // reached by injecting a JSONP <script>. Libraries use insertBefore as often
  // as appendChild, so every insertion path has to be covered — missing one
  // means the clone quietly signs people up to somebody's production list.
  var isBlockedScript = function (n) {
    return n && n.tagName === 'SCRIPT' && typeof n.src === 'string' && n.src && !allowed(n.src);
  };
  ['appendChild', 'insertBefore', 'append', 'prepend', 'replaceChild'].forEach(function (m) {
    var orig = Element.prototype[m];
    if (!orig) return;
    Element.prototype[m] = function () {
      var args = [].slice.call(arguments);
      for (var i = 0; i < args.length; i++) {
        if (isBlockedScript(args[i])) {
          block('script', args[i].src);
          // Satisfy the JSONP callback so the UI reaches its success state.
          var cb = (args[i].src.match(/[?&](?:c|callback|jsonp)=([^&]+)/) || [])[1];
          setTimeout(function () {
            try {
              var fn = cb && (window[cb] || window[decodeURIComponent(cb)]);
              if (fn) fn({ result: 'success', msg: 'parity: request stubbed locally.' });
            } catch (e) {}
          }, 250);
          return args[i];
        }
      }
      return orig.apply(this, args);
    };
  });

  var of = window.fetch;
  window.fetch = function (input) {
    var u = typeof input === 'string' ? input : (input && input.url) || '';
    if (u && !allowed(u)) {
      block('fetch', u);
      // A clean network failure is honest and every library handles it. Fake JSON
      // in place of a binary is not a block, it is corruption.
      if (wantsData(u)) return Promise.reject(new TypeError('parity: off-origin request blocked'));
      return Promise.resolve(new Response('{"result":"success","msg":"parity: stubbed."}',
        { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return of.apply(this, arguments);
  };

  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (url && !allowed(url)) {
      block('xhr', url);
      arguments[1] = wantsData(url) ? 'about:blank' : 'data:application/json,{"result":"success"}';
    }
    return oo.apply(this, arguments);
  };

  var os = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  if (os) navigator.sendBeacon = function (url) {
    if (!allowed(url)) { block('beacon', url); return true; }
    return os.apply(navigator, arguments);
  };

  // A form posting off-origin would submit real data on someone's behalf.
  document.addEventListener('submit', function (e) {
    var a = e.target && e.target.getAttribute('action');
    if (a && !allowed(a)) { e.preventDefault(); block('form submit', a); }
  }, true);
})();
`;
const guardPath = join(OUT, GUARD);
if (existsSync(guardPath) && !readFileSync(guardPath, 'utf8').includes('parity guard')) {
  console.log(`  ! ${GUARD} exists and was not written by parity — left untouched`);
} else {
  writeFileSync(guardPath, guard, 'utf8');
}

emit({ ev: 'done', cmd: 'localize', bytes: html.length, stripped, allow: ALLOW, exit: 0 });
console.log(`✓ ${join(OUT, 'index.html')}  (${before} → ${html.length} bytes)`);
if (rewritten) console.log(`  ${rewritten} absolute Origin-URLs auf den Clone umgebogen`);
console.log(`  tracker entfernt: ${stripped.length ? stripped.join(', ') : 'keine gefunden'}`);
console.log(`  guard: ${guardPath}${ALLOW.length ? `  · erlaubt: ${ALLOW.join(', ')}` : ''}`);
console.log(`\n  Nächster Schritt:  node tools/fetch-assets.mjs ${new URL(URL_).origin} ${OUT} ${join(OUT, 'index.html')}`);
