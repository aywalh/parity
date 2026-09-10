# 04 – Technology Stack

Alle Angaben aus Runtime- bzw. Bundle-Evidenz, nicht aus dem Aussehen abgeleitet. Zählungen = Vorkommen im Original-Bundle `_astro/hoisted.CRsATKbF.js` (1,1 MB).

| Technologie | Detected | Evidence | Zweck |
|---|---|---|---|
| **Astro** (SSG) | ✅ | `/_astro/`-Bundlepfade, `hoisted.*.js`-Namensschema, statisches Server-HTML mit `<base href="/">` | Seitengerüst, Build |
| **Three.js** | ✅ | 105× `THREE`, 35× `WebGLRenderer`, 15× `InstancedMesh`, 1× `OrbitControls` | Alle 3D-Szenen |
| **Custom GLSL** | ✅ | 99× `ShaderMaterial`, 139× `gl_FragColor`, 607× `uniform`, 274× `varying` | Materialien, Partikel, Reflexionen |
| **postprocessing** (pmndrs) | ✅ | 52× `postprocessing`, 44× `SMAA` + `/textures/smaa-search.png`, `smaa-area.png` | Antialiasing, Effekt-Pipeline |
| **GSAP SplitText** | ✅ | 151× `SplitText`, GSAP-Lizenzbanner im Bundle, `SplitText.register(window.gsap)` | Zeichenweise Text-Animation |
| **Rive** | ✅ | `@rive-app/canvas@2.37.0`, `/rive/oryzo.riv` (60 KB), `rive.wasm` (1,8 MB) | Sustainability-Sektion |
| **Gaussian Splatting** | ✅ | 20× `sog`, `/splats/*.sog` (3,5 MB), `SplatsWorker-*.js`, `splat_sorter_bg-*.wasm` | Requisiten + Tischreflexion |
| **MSDF-Textrendering** | ✅ | 25× `msdf`, `/fonts/msdf/Inter.json` + `Inter.webp` | Text innerhalb der WebGL-Szene |
| **WebAssembly** | ✅ | `rive.wasm`, `splat_sorter_bg-*.wasm` | Rive-Runtime, Splat-Sortierung |
| **Web Worker** | ✅ | `_astro/SplatsWorker-DSMxtdkh.js` | Splat-Sortierung außerhalb des Main-Threads |
| **Binäre Animationsbuffer** | ✅ | 25 `.buf`-Dateien (`hero_camera.buf`, `coaster_hero_animation.buf`, …) | Vorgebackene Kamera- & Objektanimationen |
| **Vimeo Player** | ✅ | `player.vimeo.com/video/1174820580`, oEmbed-Call | Hero-Video-Overlay |
| **Mailchimp (JSONP)** | ✅ | `MAILCHIMP_URL = lusion.us20.list-manage.com/subscribe/post` | Newsletter |
| **Cloudflare Insights** | ✅ | `static.cloudflareinsights.com/beacon.min.js` | Analytics — **im Clone entfernt** |

## Explizit geprüft und NICHT vorhanden

Die Prüfung war nötig, weil das Scroll-Verhalten typisch nach diesen Libraries aussieht — es ist aber alles Eigenbau:

| Technologie | Detected |
|---|---|
| ScrollTrigger | ❌ 0 Treffer |
| Lenis / Locomotive Scroll | ❌ 0 |
| Swiper | ❌ 0 |
| Lottie / bodymovin | ❌ 0 |
| Framer Motion / Motion One / Anime.js | ❌ 0 |
| PixiJS / Babylon.js / Spline | ❌ 0 |
| IntersectionObserver | ❌ 0 |
| React / Vue / Svelte / Next | ❌ 0 |

## Scroll-Engine

Lusion nutzt eine **eigene gedämpfte Scroll-Engine**: 41× `lerp`, 17× `damp`, 25× `wheel`, 10× `requestAnimationFrame`, 7× `ResizeObserver`, kein `IntersectionObserver`. Sektionsübergänge werden also nicht über Observer-Schwellen, sondern über eine kontinuierlich interpolierte Scroll-Position getrieben, die pro Frame in die Szenen-Uniforms fließt.

**Konsequenz für den Clone:** Diese Engine nachzubauen wäre aussichtslos. Sie wurde als Original-Runtime übernommen — siehe [08 – Reconstruction Architecture](08-reconstruction-architecture.md).

## Runtime-Globals

`window.gsap`, `window.THREE`, `window.lenis`, `window.Swiper`, `window.rive` sind **alle `undefined`**. Das Bundle ist vollständig modul-gekapselt. Bibliothekserkennung über Globals hätte hier nichts gefunden — die Zuordnung lief ausschließlich über Bundle-Analyse und Asset-Signaturen.

Fonts: `Literata.woff2`, `DM-Mono-400-Latin.woff2` — beide same-origin. `use.typekit.net` gehört zum Vimeo-Iframe, nicht zur Seite selbst.
