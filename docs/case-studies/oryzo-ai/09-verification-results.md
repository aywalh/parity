# 09 – Verification Results

Beide Seiten wurden mit **demselben** Skript gefahren — Original und Clone, gleiche Viewports, gleiche Scroll-Choreografie, gleiche Wartezeiten. Nur so ist eine Differenz dem Clone zuzuschreiben.

Rohdaten im Repo unter `capture/` — `orig-run/` vs. `clone-run/`, `orig-interact/` vs. `clone-interact/`, `orig-resp/` vs. `clone-resp/`.

## Kernmetriken

| Metrik | Original | Clone | |
|---|---|---|---|
| Titel | `ORYZO AI` | `ORYZO AI` | ✅ |
| Canvas-Anzahl | 6 | 6 | ✅ |
| Canvas-Kontrast (nach Scroll) | `[0,0,255,0,251,0]` | `[0,0,255,0,251,0]` | ✅ |
| `scrollHeight` | 56691 px | 56691 px | ✅ |
| erreichte `scrollY` | 55791 | 55791 | ✅ |
| Bilder geladen | 39/39 | 39/39 | ✅ |
| Fonts geladen | 3 | 3 | ✅ |
| Console-Errors | 0 | 0 | ✅ |
| HTTP ≥ 400 | 0 | 0 | ✅ |
| Failed Requests | 2 | 2 | ✅ |

Die `scrollHeight` ist der aussagekräftigste Einzelwert: Sie ist die Summe aller Sektionshöhen und aller scroll-getriebenen Pin-Strecken. Eine fehlende Sektion, ein nicht initialisiertes Modul oder ein ausgefallenes Layout würde sie verschieben. Sie ist auf den Pixel identisch.

## Die 2 "Failed Requests"

`net::ERR_ABORTED` auf `/images/wearable-gallery/yoga.mp4` und `bite.mp4`.

**Kein Defekt.** Dieselben zwei Aborts treten beim Original auf (`capture/original/baseline.json`). Chrome bricht die Video-Preloads ab, sobald die Kacheln aus dem Sichtbereich scrollen. Beide Dateien liegen lokal vor und werden ausgeliefert.

## Visueller Vergleich

| Ansicht | Original | Clone | Δ |
|---|---|---|---|
| `desktop-top` | 2.033.269 B | 2.033.671 B | 0,02 % |
| `scroll-25` | 1.590.815 B | 1.590.393 B | 0,03 % |
| `scroll-50` | 1.652.103 B | 1.653.141 B | 0,06 % |
| `scroll-75` | 1.536.879 B | 1.539.815 B | 0,19 % |
| `scroll-100` | 899.403 B | 918.445 B | 2,1 % |
| `mobile-top` | 507.871 B | 507.797 B | 0,01 % |

Sichtprüfung aller Paare: Layout, Typografie, Zeilenumbrüche, Bilder, Farben, Abstände, aktive Nav-Zustände deckungsgleich. Die 2,1 % bei `scroll-100` sind die Kaffeebohnen-Partikelsimulation auf einem anderen Frame — zeitgetrieben, nicht scrollgetrieben.

Im Detail geprüft: Hero (WebGL-Schreibtischszene, Coaster, Lineal-Beschriftung, Copy-Block) · Wearable 25 % (horizontale Galerie, roter WebGL-Card-Render, alle Kacheln) · Übergang 50 % (Gradient, Geister-Wortmarke, Nav-Highlight `FEATURES`) · Testimonies 75 % (3D-Coaster, Rating-Leiste) · Footer 100 % (Partikel, Newsletter, Disclaimer) · Mobile 390×844.

## Responsive

Sweep über **15 Breiten** von 320 bis 1920 px, gegen Original und Clone. Breakpoint aus dem Verhalten ermittelt, nicht angenommen: der Umschlag von Desktop-Nav auf Hamburger liegt **zwischen 768 und 700 px**.

| Breite | scrollHeight | Nav | Hero-Fontsize | overflowX |
|---|---|---|---|---|
| 1920 | 57827 | Desktop | 24px | 0 |
| 1600 | 57070 | Desktop | 20px | 0 |
| 1440 | 56691 | Desktop | 18px | 0 |
| 1280 | 56311 | Desktop | 16px | 0 |
| 1024 | 55706 | Desktop | 12.8px | 0 |
| 900 | 55413 | Desktop | 11.25px | 0 |
| 834 | 55257 | Desktop | 10.425px | 0 |
| 768 | 55100 | Desktop | 9.6px | 0 |
| **700** | **61099** | **Burger** | **29.8667px** | 0 |
| 600 | 58840 | Burger | 25.6px | 0 |
| 500 | 56585 | Burger | 21.3333px | 0 |
| 430 | 55010 | Burger | 18.3467px | 0 |
| 390 | 54117 | Burger | 16.64px | 0 |
| 375 | 53783 | Burger | 16px | 0 |
| 320 | 52557 | Burger | 13.6533px | 0 |

**Die Tabelle gilt für Original und Clone gleichermaßen — alle 15 Zeilen sind in beiden Läufen identisch.** 0 Overflow-Verstöße, 0 Pageerrors auf beiden Seiten.

Bemerkenswert: unterhalb des Breakpoints springt die Seitenhöhe auf 61099 px hoch und fällt dann wieder — das mobile Layout stapelt Sektionen, die im Desktop nebeneinander liegen. Der Clone reproduziert diesen Sprung exakt.

## Interaktion

15/16 Schritte in beiden Läufen erfolgreich — dieselbe Bilanz, derselbe fehlschlagende Schritt. Vollständige Matrix: [07 – Interaction Matrix](07-interaction-matrix.md)

## Request-Failure-Loop

| Runde | Aktion | Ergebnis |
|---|---|---|
| 1 | Download aus HTML + 3-Phasen-Resource-Entries | 155 Dateien, 2× 404 (`/rive.wasm`, `/rive_fallback.wasm`) |
| 2 | Rive-wasm lokalisiert + Bundle gepatcht | 0 lokale 404 |
| 3 | Nachzügler: PDFs, `sitemap.xml`, `robots.txt` | +2 Dateien |
| 4 | `site.webmanifest` (von der Extension-Regex verfehlt) | +1 Datei |
| 5 | Final | **161 Dateien, 26 MB, 0 HTTP ≥ 400** |

## Console-Error-Loop

Endstand Clone: **0 Errors**. Verbleibende Warnungen sind auch im Original vorhanden und harmlos:

| Meldung | Klasse |
|---|---|
| `Unrecognized feature: 'web-share'` | harmlos (Vimeo-Iframe-Policy) |
| `GL Driver Message … GPU stall due to ReadPixels` | harmlos (Software-Rendering im Headless-Modus) |
| `console.clear` + ORYZO-Branding-Log | erwartet (seiteneigener Log) |
