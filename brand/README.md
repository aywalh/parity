# brand

## Die Marke

Zwei exakt gleiche Hälften eines Quadrats, getrennt von einer Naht von 4/64 der Breite.

Die schmale Naht ist der ganze Punkt. Ein Spalt so breit wie die Hälften selbst ergibt
**zwei Objekte** — und das ist das Pause-Symbol, das bei 16 px jeder so liest. Eine Haarlinie
ergibt **ein Objekt mit zwei identischen Hälften**: genau die Aussage des Tools, und der
Diff-Gutter steckt buchstäblich drin.

Die Geometrie ist konstruiert, nicht gezeichnet: beide Hälften sind auf dem 64er-Raster
`22 × 48`. Bei einem Logo, das „diese beiden sind nachweislich identisch" behauptet, wäre
alles andere ein Widerspruch in sich.

## Dateien

| Datei | Verwendung |
|---|---|
| `mark.svg` | Marke, dunkel — für helle Untergründe |
| `mark-light.svg` | Marke, hell — für dunkle Untergründe |
| `favicon.svg` | folgt `prefers-color-scheme` automatisch |
| `favicon-{16,32,180,512}.png` | Rasterfallbacks, u.a. Apple-Touch-Icon (180) |
| `wordmark-{dark,light}.svg` | Wortmarke, editierbar |
| `wordmark-{dark,light}.png` | Wortmarke, **kanonisch** (@3x) |
| `og-image.png` | GitHub Social Preview, 1280×640 |

Neu erzeugen: `node brand/render.mjs`

## Warum PNG bei der Wortmarke kanonisch ist

Die SVG-Wortmarke referenziert einen Monospace-Font-Stack. Wer die Fonts nicht hat, sieht
eine andere Schrift — für eine Marke inakzeptabel. Die PNGs sind deshalb die verbindliche
Fassung; die SVGs sind zum Weiterbearbeiten da.

Für eine endgültige Produktions-Wortmarke gehört der Text in einem Vektoreditor in Pfade
konvertiert. Dann wird auch die SVG-Fassung font-unabhängig.

## Regeln

**Farbe.** `#0A0A0A` auf hell, `#FAFAFA` auf dunkel. Das Grün `#4ADE80` gehört in die
Terminal-Ausgabe (`✓ Parität erreicht`), **nicht** in die Marke — sobald die Hälften
unterschiedlich aussehen, ist es keine Parität mehr.

**Schutzraum.** Mindestens eine Hälftenbreite (22/64 der Markenbreite) ringsum frei.

**Nicht verändern.** Naht nicht verbreitern, Hälften nicht unterschiedlich einfärben,
nicht drehen, keine Rundungen, kein Verlauf, kein Schlagschatten.

**Mindestgröße.** 16 px. Darunter verschwindet die Naht.
