# 02 – Original Site Analysis

## Was die Seite ist

Satirische Kampagnen-Site des Studios **Lusion** für ein fiktives Produkt — ein Korkuntersetzer, vermarktet wie ein AI-Flaggschiff. Der Footer sagt es selbst: *"This entire site is a fictional creative project by Lusion."*

Technisch ist das keine HTML-Seite mit ein paar Effekten, sondern eine **kleine Frontend-Engine**, die über eine 56691 px lange Scroll-Achse eine durchgehende WebGL-Inszenierung streamt.

## Route-Inventar

`sitemap.xml` listet genau eine URL. Die Navigation besteht ausschließlich aus In-Page-Ankern — es gibt keine zweite HTML-Route.

| Route | Typ |
|---|---|
| `/` | Single-Page, Astro-SSG |
| `/privacy_policy.pdf` | Dokument |
| `/terms_and_conditions.pdf` | Dokument |
| `/sitemap.xml`, `/robots.txt` | Meta |

Ein separates Route-Inventar wäre bei einer Route reine Duplikation — deshalb hier mit abgehandelt.

## Sektionsarchitektur (Scroll-Reihenfolge)

| # | Sektion | ID | Charakter |
|---|---|---|---|
| 1 | Hero | `#hero` | WebGL-Schreibtischszene, Coaster-Modell, Video-Karte |
| 2 | AI-Claim | `#ai` | Typografie-Sequenz, Split-Text |
| 3 | Wearable | `#wearable` | Horizontale Galerie, eigener Canvas, Video-Kacheln |
| 4 | Wearable Magazine | `#wearable-magazine` | Editorial-Layout, Barcode, Nummerierung |
| 5 | Features | `#features` | Temperatur-Slider, Kurven-Canvas, Circular-Logo |
| 6 | Encryption | `#encryption` | Feld mit Flip-Button |
| 7 | Grip | `#grip` | Zoom-Box mit Koeffizienten-Anzeige |
| 8 | Sustainability | `#sustainability` | **Rive**-Canvas (`harvesting` + `text`) |
| 9 | Testimonies | `#testimonies` | Tabelle, 364 Reviews, Sterne-Rating |
| 10 | Social Content | `#social-content` | Horizontale Scroll-Strecke, 21 Bilder |
| 11 | Product | `#product` | 3-Varianten-Konfigurator (WebGL) + Vergleichstabelle |
| 12 | Open Weight | `#open-weight` | BibTeX-Block, GitHub-Links |
| 13 | Footer | `#footer` | Kaffeebohnen-Partikelsimulation, Newsletter |

Global dazu: `#preloader` (eigener Canvas), `#site-header` (Desktop-Nav + Mobile-Menü), `#scroll-indicator`, `#video-overlay` (Vimeo).

## Responsive Verhalten

Gemessen, nicht angenommen — der Breakpoint liegt **zwischen 768 und 700 px**:

| Klasse | Verhalten |
|---|---|
| ≥ 768 px | Horizontale Nav (`INTRO / FEATURES / PRODUCT / CONTACT`), Hero-Copy neben dem Modell |
| ≤ 700 px | Hamburger `● MENU`, Hero-Logo formatfüllend, Copy unter dem Titel |

Die Wurzel bekommt beim Laden `is-desktop is-ready` und `--vh` als CSS-Variable gesetzt. Die Layoutumschaltung läuft über CSS-Breakpoints, nicht über Re-Mount — dieselbe DOM-Struktur bedient beide Größen.

Vollständige Messreihe: [09 – Verification Results](09-verification-results.md)

## Besonderheiten

- **Split-Text überall**: Nav-Labels rendern doppelte Zeichen (`IInnttrroo`), weil jedes Zeichen für den Hover-Effekt zweifach im DOM liegt. Kein Bug — Designabsicht.
- **Kein Preloader-Blocker**: `#preloader` bleibt im DOM (`display:none` nach Abschluss) als Teil des Übergangsstacks.
- **Gaussian Splats**: `props.sog` und `table_reflection.sog` (3,5 MB) für Reflexionen und Requisiten.
- **MSDF-Text im WebGL**: `fonts/msdf/Inter.json` + `Inter.webp` für Text, der innerhalb der 3D-Szene gerendert wird.

Weiter: [04 – Technology Stack](04-technology-stack.md) · [06 – Animation System](06-animation-system.md)
