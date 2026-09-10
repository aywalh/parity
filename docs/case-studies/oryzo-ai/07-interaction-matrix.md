# 07 – Interaction Matrix

Erzeugt von `tools/interact.mjs` — identisches Skript gegen Original **und** Clone, damit jede Abweichung dem Clone zuzurechnen ist und nicht dem Messverfahren.

## Ergebnis

| # | Interaktion | Zustand gemessen | Original | Clone | Match |
|---|---|---|---|---|---|
| 1 | Ready-State | `html.className` | `is-desktop is-ready` | identisch | ✅ |
| 2 | Preloader | Opacity/Display | `1/none` | `1/none` | ✅ |
| 3 | Nav-Labels | Textinhalt | `IInnttrroo, FFeeaattuurreess, …` | identisch | ✅ |
| 4 | Nav-Hover | Decoration/Opacity | `none\|1` | `none\|1` | ✅ |
| 5 | Video-Overlay öffnen | Klasse, Opacity, Iframe | `opacity 0.5`, `iframe: true` | identisch | ✅ |
| 6 | Video-Overlay schließen | Opacity | `0.5` | `0.5` | ✅ |
| 7 | Sprung zu `#product` | `scrollY` | `51683` | `51683` | ✅ |
| 8 | Produktvariante ORYZO | Active-Klassen | `[ACTIVE,-,-]` | identisch | ✅ |
| 9 | Produktvariante Pro | Active-Klassen | `[-,ACTIVE,-]` | identisch | ✅ |
| 10 | Produktvariante Pro Max | Active-Klassen | `[-,-,ACTIVE]` | identisch | ✅ |
| 11 | Encryption-Flip | Feldinhalt | ⚠️ Timeout | ⚠️ Timeout | ✅ (gleich) |
| 12 | Temperatur-Slider (Drag) | Label | `Creative T=10 / Balanced T=1 / Deterministic T=0.1` | identisch | ✅ |
| 13 | Copy-URL-Button | Label nach Klick | `→ COPIED!` | identisch | ✅ |
| 14 | Newsletter absenden | Statusmeldung | `Something went wrong…` | `Almost there!…` | ⚠️ **absichtlich** |
| 15 | Mobile-Menü öffnen | Opacity + Items | `1`, 5 Items | identisch | ✅ |
| 16 | Mobile-Menü schließen | Opacity | `1` | `1` | ✅ |

**15/16 in beiden Läufen** — dieselbe Bilanz, derselbe fehlschlagende Schritt.

## Die zwei Auffälligkeiten

### #11 Encryption-Flip — Harness-Limit, kein Clone-Bug

`#encryption-field-flip-btn` läuft in beiden Läufen in denselben 8s-Timeout. Playwright findet das Element, kann es aber nicht klicken (Actionability-Check schlägt fehl). Da das Original dasselbe Verhalten zeigt, lautet die Aussage: *das Messverfahren erreicht diesen Button nicht*, nicht *der Clone ist kaputt*.

### #14 Newsletter — bewusste Abweichung

Das Original antwortet aus dem Headless-Kontext mit `Something went wrong, please try again`. Der Clone zeigt `Almost there! Check your inbox`, weil der Request lokal abgefangen und mit einer Erfolgsantwort gestubbt wird.

Das ist **absichtlich und nicht verhandelbar**: ohne Stub geht ein echter Anmelde-Request an Lusions produktive Mailchimp-Liste raus. Genau das ist in einem frühen Lauf passiert — siehe [10 – Errors and Fixes](10-errors-and-fixes.md), Problem 2. Nebeneffekt: der Erfolgspfad der UI wird dadurch überhaupt erst sichtbar.

## Zustandsmatrix je Komponente

| Komponente | Zustände geprüft |
|---|---|
| Button (`.btn`) | default ✅ · hover ✅ · active ✅ · focus – nicht separat gemessen |
| Navigation | default ✅ · hover ✅ · aktive Sektion ✅ (Unterstreichung wandert synchron) |
| Mobile-Menü | geschlossen ✅ · offen ✅ · Items ✅ · schließen ✅ |
| Produktkonfigurator | Variante 1 ✅ · 2 ✅ · 3 ✅ |
| Video-Overlay | geschlossen ✅ · offen ✅ · Iframe ✅ · schließen ✅ |
| Slider | Drag 20 % → 85 % ✅, Labelwechsel korrekt |
| Scroll-Sektion | vor Eintritt / Eintritt / aktiv / verlassen — über die 5 Marken in [06](06-animation-system.md) |
