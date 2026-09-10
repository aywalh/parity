# 06 – Animation System

## Grundentscheidung

Die Animationen wurden **nicht nachgebaut**. Lusions Engine (eigene gedämpfte Scroll-Achse → Three.js-Uniforms → vorgebackene `.buf`-Kameraanimationen) ist original übernommen. Damit sind Trigger, Dauer, Easing, Stagger und Scrub definitionsgemäß identisch — es läuft derselbe Code auf denselben Daten.

Der Verifikationsauftrag verschiebt sich dadurch: nicht *"stimmt meine Easing-Kurve?"*, sondern *"erreicht die Original-Runtime lokal dieselben Zustände?"*. Genau das wurde bei 0 / 25 / 50 / 75 / 100 % Scroll-Fortschritt gemessen.

## Das Antriebsmodell

```
wheel/touch  →  gedämpfte virtuelle Scroll-Position (lerp 41× / damp 17×)
             →  requestAnimationFrame-Loop
             →  Fortschrittswert pro Sektion
                 ├→ Three.js-Uniforms (607× uniform)
                 ├→ Kamerapfad-Sampling aus *.buf
                 ├→ SplitText-Zeichenoffsets
                 └→ CSS-Transforms der DOM-Sektionen
```

Kein ScrollTrigger, kein IntersectionObserver, kein Lenis. Die Scroll-Position ist der einzige Zeitparameter — deshalb sind die Zustände deterministisch reproduzierbar, sobald `scrollY` übereinstimmt. Und das tut es: 55791 in beiden.

## Wesentliche Animationen

| Element | Runtime | Trigger | Status |
|---|---|---|---|
| Preloader-Canvas | Three.js | Load | ✅ `1/none` in beiden |
| Hero-Coaster | Three.js + `coaster_hero_animation.buf` | Scroll | ✅ Screenshot-Match |
| Hero-Kamera | `hero_camera.buf` | Scroll | ✅ |
| Hand-Einblendung | `hand_animation.buf` | Scroll | ✅ |
| Split-Text (Nav, Titel) | GSAP SplitText | Hover / Scroll | ✅ `IInnttrroo`-Doppelung identisch |
| Wearable-Galerie | Custom, horizontal | vertikaler Scroll | ✅ Match bei 25 % |
| Temperatur-Slider | Custom + `featuresAnimations/*.buf` | Drag | ✅ interaktiv getestet |
| Grip-Zoom-Box | Custom | Scroll | ✅ |
| Sustainability | **Rive** (`oryzo.riv`) | Scroll-Eintritt | ✅ wasm + riv lokal |
| Tischreflexion | Gaussian Splats | Szenenstart | ✅ Worker + wasm laufen |
| Produktkonfigurator | Three.js | Klick | ✅ alle 3 Zustände |
| Kaffeebohnen-Partikel | Three.js InstancedMesh + GLSL | Footer sichtbar | ✅ Match bei 100 % |
| Video-Overlay | Vimeo-Iframe | Klick | ✅ Iframe vorhanden |

## Motion-Difference-Loop

Vergleich Original vs. Clone an fünf Scroll-Marken, jeweils Screenshot + Canvas-Kontrastmessung:

| Marke | scrollY | Original | Clone |
|---|---|---|---|
| 0 % | 0 | `[0,0,0,0,251,0]` | `[0,0,0,0,251,0]` |
| 25 % | 13948 | `[0,0,0,0,251,0]` | `[0,0,0,0,251,0]` |
| 50 % | 27896 | `[0,0,255,0,251,0]` | `[0,0,255,0,251,0]` |
| 75 % | 41843 | `[0,0,255,0,251,0]` | `[0,0,255,0,251,0]` |
| 100 % | 55791 | `[0,0,255,0,251,0]` | `[0,0,255,0,251,0]` |

Identisch an allen fünf Marken. Der Wert misst die Spannweite zwischen hellstem und dunkelstem Pixel eines auf 40×40 heruntergerechneten Canvas — er unterscheidet "rendert Inhalt" von "leer", und zwar pro Canvas.

## Einzige beobachtete Abweichung

Kaffeebohnen-Partikelsimulation und Hero-Beleuchtung stehen auf den Screenshots auf **unterschiedlichen Frames**. Kein Fidelity-Defekt: beide Simulationen laufen frei über `requestAnimationFrame` und sind zeit-, nicht scroll-gebunden. Zwei Aufnahmen derselben Seite unterscheiden sich hier ebenfalls.

Siehe [07 – Interaction Matrix](07-interaction-matrix.md) · [09 – Verification Results](09-verification-results.md)
