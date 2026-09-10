# 00 – Project Overview

## Ziel

Vollständige lokale Rekonstruktion des öffentlich ausgelieferten Frontends von **https://oryzo.ai/** — nicht "etwas Ähnliches bauen", sondern das reale Frontend-System (DOM, CSS, JS-Runtime, Asset-Graph, Animationszustände) lokal lauffähig machen und gegen das Original verifizieren.

## Methodik

`SOURCE FIRST → RUNTIME SECOND → VISUAL VALIDATION THIRD`

Kein einziger Pixel wurde aus einem Screenshot rekonstruiert. Das Original-Bundle (Astro-HTML, CSS, JS, WebGL-Assets) läuft im Clone unverändert weiter; es gibt nur drei chirurgische Eingriffe, siehe [08 – Reconstruction Architecture](08-reconstruction-architecture.md).

Browser-Automation und Verifikation laufen über [Playwright](https://github.com/microsoft/playwright).

## Toolchain

| Komponente | Rolle |
|---|---|
| `true-web-clone` | Methodik: source-first, Asset-Graph, iterativer 404-Loop |
| Playwright 1.63 | Capture, Verifikation, Interaktionsmatrix, Responsive-Sweep |
| `tools/serve.mjs` | Lokaler HTTP-Server mit korrekten MIME-Typen für `.wasm`/`.buf`/`.sog`/`.riv` |

## Aufbau

```
├── tools/     capture · fetch-assets · verify · interact · responsive · serve
├── capture/   Baselines und Verifikationsreports (JSON)
├── docs/      diese Dokumentation
└── clone/     der lauffähige Clone — nicht im Repo, lokal erzeugt
```

## Status

**Abgeschlossen.** Die Metriken des Clones sind identisch zum Original: gleiche `scrollHeight` (56691 px), 6 Canvases, 0 Console-Errors, 0 HTTP-Fehler, 15/16 Interaktionsschritte — exakt dieselbe Bilanz wie das Original, und alle 15 getesteten Viewport-Breiten stimmen überein.

Bewertung und Gesamtergebnis: [12 – Final Report](12-final-report.md)
