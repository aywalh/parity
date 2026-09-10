# 08 – Reconstruction Architecture

## Prinzip

Direct Reuse. Das Original-Frontend läuft im Clone **unverändert** — es gibt keinen nachgebauten Code, nur drei Eingriffe.

## Aufbau

```
clone/
├── index.html                    ← rohes Astro-Server-HTML, 2 Änderungen
├── clone-fixes.js                ← ~45 Zeilen Shim (Mailchimp-Blocker)
├── _astro/                       ← Original-Bundle, 1 Patch
├── models/ textures/ splats/ images/ fonts/ rive/ meta/
├── vendor/rive/rive.wasm         ← von unpkg lokalisiert
├── privacy_policy.pdf, terms_and_conditions.pdf
└── robots.txt, sitemap.xml
```

## Die drei Eingriffe

### 1. `index.html` — Tracking raus, Shim rein

```diff
- <script defer src="https://static.cloudflareinsights.com/beacon.min.js" …></script>
+ <!-- analytics removed for local clone -->

+ <script src="/clone-fixes.js"></script>
  <script type="module" src="/_astro/hoisted.CRsATKbF.js"></script>
```

Der Shim läuft als klassisches Script **vor** dem Modul-Bundle, damit seine Prototyp-Overrides stehen, bevor irgendein Seitencode läuft.

### 2. `_astro/hoisted.CRsATKbF.js` — Rive-wasm lokalisieren

Rive baut seine wasm-URL zur Laufzeit zusammen. Zwei String-Ersetzungen:

```diff
- "https://unpkg.com/".concat(_.name,"@").concat(_.version,"/rive.wasm")
+ "/vendor/rive/rive.wasm"
- "https://cdn.jsdelivr.net/npm/".concat(_.name,"@").concat(_.version,"/rive_fallback.wasm")
+ "/vendor/rive/rive.wasm"
```

Ergebnis: 1.097.784 → 1.097.672 Bytes, 0 verbleibende unpkg-Rive-Referenzen.

### 3. `clone-fixes.js` — Mailchimp-Blocker

Fängt `Element.prototype.{appendChild,insertBefore,append,prepend}`, `window.fetch` und `XMLHttpRequest.open` ab und lässt nichts an `list-manage.com` durch; der JSONP-Callback wird stattdessen lokal mit einer Erfolgsantwort aufgerufen. Warum alle vier Insertionspfade nötig sind: [10 – Errors and Fixes](10-errors-and-fixes.md), Problem 2.

## Was **nicht** gemacht wurde

- **Kein URL-Rewriting.** Das Original liefert `<base href="/">` und ausschließlich wurzelrelative Pfade — beim Serven aus dem Clone-Root lösen alle Referenzen unverändert auf. Die klassische Rewrite-Falle (`https:assets/…`, escaped JSON-URLs, `srcset`) entfällt komplett.
- Keine Klassennamen oder DOM-Struktur angefasst.
- Keine Animation nachgebaut, keine Szene durch ein Bild ersetzt, kein 3D-Abschnitt geflacht.

## Lokaler Server

`file://` ist für diesen Clone **kein gültiger Testpfad** — Modul-JS, wasm, Worker und binäre Szenendaten brauchen HTTP mit korrekten MIME-Typen. `tools/serve.mjs` (~50 Zeilen, nur Node-stdlib) liefert:

| Typ | MIME |
|---|---|
| `.wasm` | `application/wasm` |
| `.buf`, `.bin`, `.sog`, `.riv` | `application/octet-stream` |
| `.js`, `.mjs` | `text/javascript` |
| `.webmanifest` | `application/manifest+json` |
| `.woff2`, `.webp`, `.avif`, `.mp4` | jeweils korrekt |

Plus Range-Requests (206) — ohne die stockt Chrome bei den Galerie-Videos.

## Decision Log

**Original-Runtime behalten statt Animationen nachzubauen.**
Lusions gedämpfte Scroll-Engine treibt 607 Shader-Uniforms und samplet vorgebackene Kamerapfade aus `.buf`-Dateien. Ein Nachbau träfe Timing und Easing bestenfalls näherungsweise. Der Original-Code wird öffentlich ausgeliefert und läuft lokal. → Scroll-Zustände stimmen exakt.

**Rive-wasm lokalisieren statt extern zu lassen.**
Ohne lokalisierte wasm braucht der Clone Internet, und die Sustainability-Sektion bleibt leer. Die Datei ist ein öffentliches npm-Artefakt. → Die 404s verschwanden.

**Vimeo extern belassen.**
Die MP4-Quellen liegen hinter signierter Player-Auslieferung; das zu umgehen wäre ein Zugriffsschutz-Bypass. → Iframe bleibt extern, als Limitation dokumentiert.

**Mailchimp hart blockieren statt durchzulassen.**
Ein Testlauf hat real an die produktive Liste gepostet. → Blockiert, UI-Erfolgspfad lokal gestubbt.

**Kein URL-Rewriting.**
`<base href="/">` macht es überflüssig. → Bundle bleibt bis auf den Rive-Patch bytegleich.
