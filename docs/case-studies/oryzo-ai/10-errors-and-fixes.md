# 10 – Errors and Fixes

Historie bleibt stehen, Gelöstes ist als gelöst markiert.

---

## Problem 1 — Rive-wasm 404, Sustainability-Sektion tot

**Status:** ✅ GELÖST

**Problem:** Nach dem ersten Asset-Download meldete der Clone 404 auf `/rive.wasm` und `/rive_fallback.wasm`.

**Root Cause:** Rive baut seine wasm-URL zur Laufzeit aus Paketname und Version zusammen. Es gab nie eine statische URL, die eine Discovery aus dem HTML hätte finden können — und wenn der CDN-Abruf scheitert, versucht die Runtime einen wurzelrelativen Fallback. Genau das erzeugte die 404s.

**Evidence:** `capture/ASSETS.json` → `notFound: [/rive_fallback.wasm, /rive.wasm]`; Bundle-Grep zeigte beide Konstruktionsstellen.

**Fix:** `rive.wasm` (1,8 MB) von `unpkg.com/@rive-app/canvas@2.37.0` nach `clone/vendor/rive/rive.wasm` geladen, beide Konstruktionsausdrücke im Bundle durch den lokalen Pfad ersetzt.

**Verification:** 0 verbleibende unpkg-Rive-Referenzen; Folgelauf 0× HTTP ≥ 400.

---

## Problem 2 — Clone hat an Lusions produktive Mailchimp-Liste gepostet

**Status:** ✅ GELÖST · **schwerwiegendster Fund des Projekts**

**Problem:** Der erste Shim sollte die Newsletter-Anmeldung abfangen. Ein gezielter Test zeigte: er griff nicht. Ein realer Request ging an `lusion.us20.list-manage.com/subscribe/post-json` raus.

**Root Cause:** Der Shim übersteuerte nur `Element.prototype.appendChild`. Die verwendete JSONP-Bibliothek injiziert ihr Script-Element aber über `insertBefore` — ein Pfad, der `appendChild` nie berührt. Die Annahme "Script-Injektion läuft über appendChild" war schlicht falsch.

**Evidence:** Gezielter Playwright-Lauf mit Request-Filter auf `list-manage.com` — Request sichtbar, Stub-Log fehlte.

**Fix:** `clone-fixes.js` deckt jetzt alle vier DOM-Insertionspfade (`appendChild`, `insertBefore`, `append`, `prepend`) plus `window.fetch` und `XMLHttpRequest.open` ab. Der JSONP-Callback wird lokal mit einer Erfolgsantwort aufgerufen.

**Verification:** Wiederholter Lauf → Stub greift, **kein** Outbound-Request, UI-Meldung `Almost there! Check your inbox`.

**Lehre:** Einen Blocker nie als "greift schon" annehmen. Der Test, der ihn widerlegt, kostet zwei Minuten.

---

## Problem 3 — `site.webmanifest` nicht heruntergeladen

**Status:** ✅ GELÖST

**Root Cause:** Die Pfad-Regex in `fetch-assets.mjs` akzeptierte Extensions von 2–7 Zeichen. `webmanifest` hat 11.

**Fix:** Datei direkt nachgeladen. Gegensuche nach Referenzen mit mindestens 8 Zeichen Extension bestätigt: keine weiteren Treffer im Projekt.

---

## Problem 4 — Manifest-Icons 404

**Status:** ✅ GELÖST (als Original-Defekt reproduziert)

**Root Cause:** **Defekt der Original-Seite.** `/web-app-manifest-192x192.png` und `-512x512.png` liefern auch auf `https://oryzo.ai/` 404, und das Manifest trägt noch Boilerplate-Werte (`"name": "MyWebSite"`) — es wurde nie angepasst.

**Fix:** Keiner. Die zunächst angelegten 0-Byte-Platzhalter wurden gelöscht — ein leeres Fake-Asset wäre eine Verfälschung. Der Clone reproduziert den Originalzustand.

---

## Problem 5 — `page.content()` lieferte hydratisiertes DOM

**Status:** ✅ GELÖST

**Root Cause:** `page.content()` serialisiert das *aktuelle* DOM. Das zuerst gespeicherte HTML trug bereits `class="is-desktop is-ready"` und eine gesetzte `--vh`-Variable — Laufzeitzustand statt Server-Ausgabe. Als Clone-Basis riskant: die Runtime würde beim Start auf einen Zustand treffen, den sie selbst erst herstellen wollte.

**Fix:** Rohes Server-HTML per `curl` geholt (71.633 B, `class="no-js"`) und als Clone-Basis genutzt.

---

## Nicht-Probleme (geprüft und verworfen)

| Beobachtung | Bewertung |
|---|---|
| 2× `net::ERR_ABORTED` auf Galerie-MP4s | Tritt im Original identisch auf. Chrome bricht Preloads beim Wegscrollen ab. |
| Nav-Text `IInnttrroo` | GSAP SplitText dupliziert Zeichen für den Hover-Effekt. Designabsicht. |
| `#encryption-field-flip-btn` nicht klickbar | Timeout auch im Original. Grenze des Testverfahrens, nicht des Clones. |
| `GPU stall due to ReadPixels` | Software-Rendering im Headless-Modus. Auch im Original. |
| `#preloader` bleibt im DOM | `display:none` nach Abschluss, gehört zum Übergangsstack. Nicht entfernen. |
