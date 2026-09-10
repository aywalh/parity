# 12 – Final Report

## Clone Fidelity

| Dimension | Score | Belegt durch |
|---|---|---|
| **Layout** | `10/10` | `scrollHeight` bei 15 Viewport-Breiten identisch (52557 – 57827 px), Screenshot-Paare an 5 Scroll-Marken deckungsgleich |
| **Typografie** | `10/10` | Beide Webfonts lokal, 3/3 geladen, Hero-Fontgrößen bei allen 15 Breiten auf 4 Nachkommastellen identisch |
| **Assets** | `9/10` | 161 Dateien / 26 MB lokal, 0× HTTP ≥ 400. Abzug: Vimeo-Videodaten bleiben extern (domaingebunden) |
| **Responsive** | `10/10` | 15 Breiten von 320 bis 1920 px, alle Werte identisch, 0 Overflow-Verstöße, Breakpoint gemessen (768 → 700) |
| **Interaktionen** | `9/10` | 15/16 Schritte — dieselbe Bilanz wie das Original. Abzug: 1 Schritt vom Testverfahren in beiden Läufen nicht erreichbar |
| **Animationen** | `9/10` | Original-Runtime, Canvas-Zustände an 5 Scroll-Marken identisch. Abzug: Flip-Button unbestätigt, freilaufende Partikel nicht frame-vergleichbar |
| **WebGL / 3D** | `10/10` | 6 Canvases, Gaussian Splats + Worker + wasm, Rive, MSDF, 25 `.buf`-Animationen — alles lokal, 0 fehlende Ressourcen |
| **Gesamt** | **`9.6/10`** | |

Kein Wert ist geschätzt; jeder stammt aus einem Lauf, der mit demselben Skript gegen Original **und** Clone gefahren wurde.

## Was geklont wurde

`https://oryzo.ai/` — Single-Page-Kampagnenseite von Lusion, Astro-SSG mit einer eigenen WebGL-Engine über 56691 px Scroll-Achse.

**Routen:** `/` (einzige HTML-Route, per `sitemap.xml` bestätigt) plus zwei PDFs, `sitemap.xml`, `robots.txt`.

**Technologie erkannt** (aus Bundle-Evidenz, nicht aus dem Aussehen): Astro · Three.js · custom GLSL (607 Uniforms) · postprocessing/SMAA · GSAP SplitText · Rive + wasm · Gaussian Splatting · MSDF-Textrendering · 25 binäre Animationsbuffer · eigene gedämpfte Scroll-Engine.

Explizit **nicht** vorhanden: ScrollTrigger, Lenis, Swiper, Lottie, React/Vue/Next, IntersectionObserver. Details: [04 – Technology Stack](04-technology-stack.md)

**Assets lokalisiert:** 161 Dateien, 26 MB — 65 Texturen, 47 Bilder/Videos, 25 `.buf`-Modelle, 2 Splats, Rive-wasm, 4 Fonts, das komplette Astro-Bundle.

## Tests

| Test | Umfang |
|---|---|
| Baseline-Capture | 3 Ladephasen, 153 Ressourcen, Console + Failed Requests |
| Verifikationslauf | Original **und** Clone, gleiches Skript, 21 Scroll-Schritte |
| Screenshot-Vergleich | 6 Paare (Desktop 0/25/50/75/100 %, Mobile), visuell geprüft |
| Interaktionsmatrix | 16 Schritte, beide Seiten |
| Responsive-Sweep | 15 Breiten (320–1920), beide Seiten |
| 404-Loop | 5 Runden bis 0 fehlende Ressourcen |
| Console-Loop | bis 0 Errors |

## Original vs. Clone

| | Original | Clone |
|---|---|---|
| Titel | ORYZO AI | ORYZO AI |
| Canvases | 6 | 6 |
| scrollHeight | 56691 | 56691 |
| erreichte scrollY | 55791 | 55791 |
| Bilder | 39/39 | 39/39 |
| Console-Errors | 0 | 0 |
| HTTP ≥ 400 | 0 | 0 |
| Interaktionen | 15/16 | 15/16 |
| Responsive (15 Breiten) | — | alle identisch |

## Verbleibende Unterschiede

1. **Vimeo-Video extern** — signierte Player-URLs, kein Bypass. Overlay und Thumbnail lokal.
2. **Newsletter gestubbt** — bewusst; sonst reale Anmeldungen an Lusions produktive Liste.
3. **Analytics entfernt** — Cloudflare-Beacon raus.
4. **Freilaufende Partikel auf anderem Frame** — zeitgetrieben, kein Fidelity-Defekt.

Vollständig: [11 – Known Limitations](11-known-limitations.md)

## Verbleibende Fehler

- **Kritische Console-Errors: 0**
- **Fehlgeschlagene Requests: 2** — `yoga.mp4`, `bite.mp4`, `net::ERR_ABORTED`. Treten im Original identisch auf, Dateien liegen lokal vor. Kein Defekt.
- **HTTP ≥ 400: 0**

## Reproduzieren

```bash
npm install
npx playwright install chromium

node tools/capture.mjs https://oryzo.ai/ capture/original
node tools/fetch-assets.mjs
node tools/serve.mjs clone 4173
```

Dann verifizieren:

```bash
node tools/verify.mjs     http://localhost:4173/ capture/check --shots
node tools/interact.mjs   http://localhost:4173/ capture/check-i
node tools/responsive.mjs http://localhost:4173/ capture/check-r
```

Dieselben Skripte laufen gegen `https://oryzo.ai/` — so wird jede Differenz dem Clone zugerechnet und nicht dem Messverfahren.

`file://` funktioniert **nicht** — Modul-JS, wasm, Worker und binäre Szenendaten brauchen HTTP mit korrekten MIME-Typen.

## Rechtlicher Hinweis

Lokale Studien-Rekonstruktion. Alle Inhalte, Assets und Marken gehören Lusion. Der erzeugte Clone gehört auf `localhost` und **nicht** ins Netz — Begründung in [11 – Known Limitations](11-known-limitations.md), Punkt 9.
