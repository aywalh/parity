# Case Study: oryzo.ai

Der harte Fall — die Seite, an der `parity` entwickelt wurde.

Satirische Kampagnenseite des Studios Lusion für ein fiktives Produkt. Technisch keine Website mit Effekten, sondern eine kleine Frontend-Engine: Three.js mit 607 Shader-Uniforms, Rive über WebAssembly, Gaussian Splats mit Worker-Sortierung, MSDF-Text im 3D-Raum, 25 vorgebackene Kamera-Animationsbuffer — gestreamt über eine 56691 px lange Scroll-Achse.

## Ergebnis

| Metrik | Original | Clone |
|---|---|---|
| `scrollHeight` | 56691 px | 56691 px |
| Canvases | 6 | 6 |
| Canvas-Zustände nach Scroll | `[·,·,✓,·,✓,·]` | `[·,·,✓,·,✓,·]` |
| Bilder | 39/39 | 39/39 |
| Fonts | 3 | 3 |
| Console-Errors | 0 | 0 |
| HTTP ≥ 400 | 0 | 0 |
| Interaktionsschritte | 19/20 | 19/20 |
| Responsive (15 Breiten) | — | alle identisch |

**Gesamt 9,6/10.** `parity diff` meldet Parität.

Assets: 161 Dateien, 26 MB — 65 Texturen, 47 Bilder/Videos, 25 `.buf`-Modelle, 2 Splats (3,5 MB), Rive-wasm (1,8 MB), 4 Fonts, das komplette Astro-Bundle.

## Nachvollziehen

```bash
node bin/parity.mjs capture   https://oryzo.ai/ capture/original
node bin/parity.mjs localize  https://oryzo.ai/ clone --allow player.vimeo.com
node bin/parity.mjs fetch     https://oryzo.ai  clone clone/index.html
node bin/parity.mjs serve     clone 4173
```

Ein manueller Schritt bleibt: Rive konstruiert seine wasm-URL zur Laufzeit aus Paketname und Version, deshalb findet keine statische Discovery sie. `/vendor/rive/rive.wasm` von unpkg holen und die beiden Konstruktionsausdrücke im Bundle auf den lokalen Pfad zeigen lassen — Details in [08 – Reconstruction Architecture](08-reconstruction-architecture.md).

Gegenmessung mit den site-spezifischen Schritten:

```bash
node bin/parity.mjs interact https://oryzo.ai/       capture/orig  --steps case-studies/oryzo-ai/steps.mjs
node bin/parity.mjs interact http://localhost:4173/  capture/clone --steps case-studies/oryzo-ai/steps.mjs
node bin/parity.mjs diff     capture/orig capture/clone
```

## Dokumente

| | |
|---|---|
| [00 – Project Overview](00-project-overview.md) | Ziel, Methodik, Aufbau |
| [01 – Environment](01-environment.md) | Setup und Referenzumgebung |
| [02 – Original Site Analysis](02-original-site-analysis.md) | Routen, 13 Sektionen, Responsive-Verhalten |
| [04 – Technology Stack](04-technology-stack.md) | Was drin ist — und was trotz Anschein *nicht* |
| [05 – Resource Graph](05-resource-graph.md) | Asset-Architektur und Ladephasen |
| [06 – Animation System](06-animation-system.md) | Antriebsmodell, Motion-Difference-Loop |
| [07 – Interaction Matrix](07-interaction-matrix.md) | Interaktionen, Original vs. Clone |
| [08 – Reconstruction Architecture](08-reconstruction-architecture.md) | Die drei Eingriffe, Decision Log |
| [09 – Verification Results](09-verification-results.md) | Alle Messreihen |
| [10 – Errors and Fixes](10-errors-and-fixes.md) | 5 Probleme mit Root Cause |
| [11 – Known Limitations](11-known-limitations.md) | Was nicht geht und warum |
| [12 – Final Report](12-final-report.md) | Bewertung mit Belegen |

## Was diese Seite gelehrt hat

Drei Dinge aus dieser Fallstudie sind fest in `parity` eingebaut:

**Der Guard blockiert alle fünf DOM-Einfügepfade.** Eine frühere Variante überschrieb nur `appendChild` — die JSONP-Bibliothek der Seite nutzte `insertBefore`, und ein Testlauf hat real an Lusions produktive Mailchimp-Liste gepostet. [10 – Errors and Fixes](10-errors-and-fixes.md), Problem 2.

**`capture` sammelt Resource-Entries in drei Ladephasen.** Nach dem ersten Load waren hier längst nicht alle Assets sichtbar — Splats, Rive und Galerie-Videos kamen erst nach Preloader-Abschluss und beim Scrollen.

**`diff` markiert beidseitige Fehlschläge gelb statt rot.** `#encryption-field-flip-btn` läuft in Original *und* Clone in denselben Timeout. Ohne diese Unterscheidung wären das Stunden Fehlersuche an einem Clone gewesen, der nichts falsch macht.

## Rechtlich

Lokale Studien-Rekonstruktion. Alle Inhalte, Assets und Marken gehören [Lusion](https://lusion.co/). Der erzeugte Clone gehört auf `localhost` — Begründung in [11 – Known Limitations](11-known-limitations.md), Punkt 9.
