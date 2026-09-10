# 05 – Resource Graph

161 Dateien, 26 MB. Erfasst über drei Wege: rohes Server-HTML, `performance.getEntriesByType('resource')` in drei Phasen (Load / nach Scroll / Mobile) und rekursive String-Extraktion aus CSS + JS-Bundle.

## Architektur

```
/  (Astro-SSG, 71 KB HTML, <base href="/">)
├── _astro/index.TL6TuoJb.css        69 KB   ← @font-face → /fonts/*.woff2
├── _astro/hoisted.CRsATKbF.js      1,1 MB   ← die gesamte Engine
│   ├── Three.js + custom GLSL + postprocessing/SMAA
│   │   ├── /textures/hero/*         19 Dateien  ← Schreibtischszene
│   │   ├── /textures/table/*        10          ← Tischszene
│   │   ├── /textures/coffee/*, coffeeBean/*, coaster/*, wearable/*
│   │   ├── /textures/smaa-{search,area}.png     ← SMAA-Lookups
│   │   ├── /textures/brdf.png, LDR_RGB1_0.png   ← BRDF-LUT, Dithering
│   │   └── /models/**.buf           25 Dateien  ← Kamera- & Objektanimationen
│   ├── Gaussian Splats
│   │   ├── _astro/SplatsWorker-DSMxtdkh.js      ← Sortierung im Worker
│   │   ├── _astro/splat_sorter_bg-BfJrILzx.wasm 38 KB
│   │   └── /splats/props.sog + table_reflection.sog   3,5 MB
│   ├── MSDF-Text
│   │   └── /fonts/msdf/Inter.json + Inter.webp
│   └── Rive
│       ├── /vendor/rive/rive.wasm   1,8 MB  ← lokalisiert (Original: unpkg)
│       └── /rive/oryzo.riv          60 KB
├── /images/social-content/*         21 Dateien
├── /images/wearable-gallery/*       15          ← inkl. 2 MP4 + thumbs/
├── /images/testimonies/*            10
├── /fonts/Literata.woff2, DM-Mono-400-Latin.woff2
└── /meta/* (Favicons, og_image, site.webmanifest)
```

## Nach Familie

| Familie | Dateien | Größe |
|---|---|---|
| images | 47 | 8,2 MB |
| textures | 65 | 5,8 MB |
| splats | 2 | 3,5 MB |
| models (`.buf`) | 25 | 3,6 MB |
| vendor (rive.wasm) | 1 | 1,8 MB |
| _astro | 4 | 1,2 MB |
| meta | 6 | 1,1 MB |
| fonts | 4 | 164 KB |
| rive | 1 | 60 KB |

## Ladephasen

Der entscheidende Punkt für die Discovery: **nach dem ersten Load waren längst nicht alle Assets sichtbar.** Ressourcen kamen in Wellen:

1. **Initial** — HTML, CSS, JS, Hero-Texturen, `hero_camera.buf`, Fonts
2. **Nach Preloader-Abschluss** — Rive-wasm, `oryzo.riv`, Splats
3. **Beim Scrollen** — Tisch-/Kaffee-/Wearable-Texturen, Galerie-Videos, Social-Content-Bilder
4. **Mobile-Pass** — teils andere Bildvarianten

Deshalb sammelt `tools/capture.mjs` die Resource-Entries in drei Phasen, und `tools/fetch-assets.mjs` verfolgt Pfade rekursiv durch jede geladene Text-Datei weiter.

## Externe Ressourcen

| URL | Behandlung |
|---|---|
| `unpkg.com/@rive-app/canvas@2.37.0/rive.wasm` | **lokalisiert** → `/vendor/rive/rive.wasm`, Bundle gepatcht |
| `cdn.jsdelivr.net/.../rive_fallback.wasm` | **lokalisiert** → gleicher lokaler Pfad |
| `static.cloudflareinsights.com/beacon.min.js` | **entfernt** (Tracking) |
| `player.vimeo.com/video/1174820580` | extern belassen — [11 – Known Limitations](11-known-limitations.md) |
| `use.typekit.net/pmn6ngx.css` | gehört zum Vimeo-Iframe, nicht zur Seite |
| `lusion.us20.list-manage.com` | **blockiert + gestubbt** — [10 – Errors and Fixes](10-errors-and-fixes.md) |
