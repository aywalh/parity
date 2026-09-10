# PROMPT.md — Agent-Anleitung für parity

Diese Datei ist dafür da, einem KI-Agenten in die Hand gedrückt zu werden. Kopier den Block unter [Der Prompt](#der-prompt) in dein Agenten-Tool, ersetz die Ziel-URL, fertig.

Wenn du willst, dass ein Agent das automatisch findet, leg eine Kopie als `AGENTS.md` (Codex, Cursor, viele andere) im Repo-Root ab:

```bash
cp PROMPT.md AGENTS.md
```

Claude Code braucht das nicht mehr — dort gibt es dieselbe Anleitung als installierbaren Skill, auf Englisch und ohne Kopieren:

```bash
/plugin marketplace add aywalh/parity
/plugin install parity@parity
```

---

## Was parity einem Agenten gibt

Acht Befehle, mit denen sich das öffentlich ausgelieferte Frontend **jeder** Website lokal rekonstruieren und messbar verifizieren lässt — von statischem HTML bis zur WebGL-Engine. Es gibt keine Zielkonfiguration und kein Site-Profil; der Agent bekommt eine URL und arbeitet.

Der Kern ist nicht das Herunterladen — das ist der einfache Teil. Der Kern ist die **Gegenmessung**: dieselben Prüfungen laufen gegen Original *und* Clone, `parity diff` wertet aus, und nur die Differenz zählt.

Für den Agenten heißt das konkret: er *sieht* die Seite (Ladephasen, Console, Requests, Canvas-Zustände, Breakpoints), statt über sie zu spekulieren. Deshalb kann man ihm in normaler Sprache sagen, was man braucht — "nur die Animationen", "nur Desktop", "Formulare weglassen" — und er kann es an echten Messwerten prüfen.

---

## Der Prompt

````markdown
Du sollst das öffentlich ausgelieferte Frontend von <ZIEL-URL> lokal
rekonstruieren und verifizieren. Nutze parity (bin/parity.mjs).

<HIER DEIN BEDARF: alles / nur Layout / nur Animationen / nur Desktop /
 bestimmte Sektion / Formulare ignorieren / ...>

Wenn nichts angegeben ist, rekonstruiere alles.

## Grundregel

SOURCE FIRST → RUNTIME SECOND → VISUAL VALIDATION THIRD.

Nicht: Screenshot ansehen und HTML/CSS raten. Ein Screenshot ist ein
Prüfmittel, nicht die Quelle. Wenn die Original-Runtime lokal läuft, sind
Timing, Easing und Stagger definitionsgemäß korrekt — du musst sie dann nur
noch zum Laufen bringen, nicht nachbauen.

## Setup

    npm install
    npx playwright install chromium

## Phase 1 — Baseline des Originals

    node bin/parity.mjs capture <ZIEL-URL> capture/original

Schreibt nach capture/original/:
  baseline.json    Globals, Console, Failed Requests, Resource-Entries
                   in 3 Phasen (Load / nach Scroll / Mobile)
  resources.txt    alle eindeutigen Ressourcen-URLs
  original.html    hydratisiertes DOM (nur zum Vergleich!)
  *.png            Desktop- und Mobile-Screenshots

Lies baseline.json, bevor du weitermachst. Interessant:
- globals: welche Runtime-Libraries liegen auf window? Oft KEINE — moderne
  Bundles sind modul-gekapselt. Dann musst du das JS-Bundle greppen statt
  dich auf window.gsap & Co. zu verlassen.
- responses: welche Hosts? Alles same-origin ist lokalisierbar. Third-party
  einzeln bewerten.
- failedRequests: manche Fehler hat schon das Original. Notier sie, sonst
  jagst du später Geister.

## Phase 2 — Lokalisieren

    node bin/parity.mjs localize <ZIEL-URL> clone

Holt das rohe Server-HTML, entfernt Tracking-Scripts und installiert
parity-guard.js, der jeden Off-Origin-Request blockiert. Braucht ein
Drittanbieter wirklich Zugriff (z.B. ein Videoplayer):

    node bin/parity.mjs localize <ZIEL-URL> clone --allow player.vimeo.com

WICHTIG: page.content() aus Phase 1 ist NICHT das Server-HTML. Es
serialisiert das hydratisierte DOM inklusive Laufzeitklassen. Als Clone-Basis
trifft die Runtime dann auf einen Zustand, den sie selbst erst herstellen
wollte. Nimm immer das rohe HTML.

Prüf, ob die Seite <base href="/"> setzt. Wenn ja und alle Pfade
wurzelrelativ sind: du brauchst KEIN URL-Rewriting, solange du aus dem
Clone-Root servierst. Das erspart dir die halbe Fehlerklasse.

## Phase 3 — Assets holen

    node bin/parity.mjs fetch <ZIEL-URL> clone clone/index.html

Verfolgt Pfade rekursiv durch HTML, CSS und JS-Bundles, bis nichts Neues
mehr auftaucht. Schreibt clone/ASSETS.json mit downloaded / notFound /
failed. Zusätzliche Startpunkte kannst du anhängen:

    node bin/parity.mjs fetch <ZIEL-URL> clone \
        clone/index.html capture/original/resources.txt

## Phase 4 — Technologie bestimmen

Nicht raten, greppen. Im Haupt-Bundle:

    grep -o "THREE" bundle.js | wc -l

Prüf mindestens: THREE, WebGLRenderer, ShaderMaterial, gl_FragColor,
uniform, postprocessing, SMAA, SplitText, gsap, ScrollTrigger, lenis,
Swiper, lottie, rive-app, msdf, sog, InstancedMesh, IntersectionObserver,
lerp, damp, requestAnimationFrame.

Das Negativergebnis ist genauso wichtig wie das Positive. "Sieht aus wie
ScrollTrigger" und "enthält ScrollTrigger" sind verschiedene Aussagen.

## Phase 5 — Third-Party behandeln

Analytics/Tracking:  entfernen.
CDN-Runtime (wasm):  lokalisieren. Achtung, URLs werden oft zur Laufzeit
                     zusammengesetzt — dann im Bundle patchen. Sichere das
                     Original vorher (cp bundle.js capture/bundle.orig.js).
Formulare:           BLOCKIEREN. Ein Clone, der ein Formular durchlässt,
                     schickt echte Daten an einen fremden produktiven
                     Dienst. Überschreib appendChild, insertBefore, append,
                     prepend, fetch UND XMLHttpRequest.open — JSONP-Libs
                     nutzen insertBefore, nicht appendChild.
                     Danach mit page.on('request') NACHWEISEN, dass nichts
                     rausgeht. Nicht annehmen, testen.
Video/Maps/SSO:      domaingebunden. Extern lassen oder lokalen Fallback
                     bauen. Nichts umgehen, was Zugriffsschutz ist.

## Phase 6 — Lokal servieren

    node bin/parity.mjs serve clone 4173

file:// ist KEIN gültiger Testpfad, sobald Modul-JS, wasm, Worker oder
binäre Szenendaten im Spiel sind. serve.mjs liefert die richtigen
MIME-Typen (.wasm, .buf, .sog, .riv, .webmanifest) plus Range-Requests
für Video.

## Phase 7 — Der 404-Loop

Wiederhol, bis nichts mehr fehlt:

    node bin/parity.mjs verify http://localhost:4173/ capture/run

Lies capture/run/missing.txt, lade genau diese Dateien nach, wiederhol.
Bei 3D-Seiten ist das normal: die erste Welle sind Hero-Assets, spätere
Wellen kommen erst, wenn eine Szene initialisiert oder du weit genug
gescrollt hast. Nach dem ersten Load fertig zu sein ist die Ausnahme.

## Phase 8 — Gegenmessung

Das ist der eigentliche Test. Fahr JEDES Skript gegen beide Seiten:

    node bin/parity.mjs verify     <ZIEL-URL>             capture/orig  --shots
    node bin/parity.mjs verify     http://localhost:4173/ capture/clone --shots
    node bin/parity.mjs interact   <ZIEL-URL>             capture/orig
    node bin/parity.mjs interact   http://localhost:4173/ capture/clone
    node bin/parity.mjs responsive <ZIEL-URL>             capture/orig
    node bin/parity.mjs responsive http://localhost:4173/ capture/clone

Dann auswerten lassen:

    node bin/parity.mjs diff capture/orig capture/clone

Exit-Code 0 = Parität, 1 = Abweichung. Was diff prüft:
- scrollHeight — der aussagekräftigste Einzelwert. Er ist die Summe aller
  Sektionshöhen und Pin-Strecken. Eine fehlende Sektion oder ein nicht
  initialisiertes Modul verschiebt ihn sofort.
- canvasNonBlank — pro Canvas: rendert Inhalt oder ist leer?
- Interaktionsschritte — gleiche Anzahl ok? gleiche Schritte fehlgeschlagen?
- Responsive — alle Breiten gleich? overflowX überall 0?
- Screenshots an 0/25/50/75/100 % wirklich ansehen, nicht nur zählen.

Ein Schritt, der auf BEIDEN Seiten fehlschlägt, ist eine Grenze deines
Messverfahrens, kein Clone-Defekt. diff markiert das gelb und zählt es
nicht als Abweichung. Sag es genauso, statt es als Fehler zu buchen oder
stillschweigend zu verschweigen.

Braucht die Seite eigene Interaktionsschritte (Konfigurator, Slider,
Modal), schreib ein Steps-Modul und häng es an:

    node bin/parity.mjs interact <URL> <out> --steps meine-steps.mjs

    // meine-steps.mjs
    export default async ({ page, step, shot }) => {
      await step('variante-2', async () => {
        await page.click('#option-2');
        await page.waitForTimeout(2000);
        return page.$$eval('.option', e => e.map(x => x.className));
      });
      await shot('variante-2');
    };

Vorlage: case-studies/oryzo-ai/steps.mjs

## Fertig ist es, wenn

- 0 HTTP >= 400 lokal
- 0 unerklärte Console-Errors
- scrollHeight stimmt mit dem Original überein
- Canvas-Anzahl und -Zustände stimmen
- Interaktionsbilanz gleich
- alle getesteten Breiten stimmen, 0 Overflow
- jede verbliebene Abweichung ist benannt UND begründet

Melde niemals fertig, weil die Seite lädt. Wenn etwas nicht geht, schreib
hin was und warum. Eine ehrliche Limitation ist mehr wert als eine
geschönte Zahl.

## Nicht tun

- Authentifizierung, Paywalls, DRM, private APIs oder signierte
  Asset-Auslieferung umgehen
- Formulare an fremde produktive Dienste durchlassen
- den erzeugten Clone öffentlich hosten — fremde Marken, Bilder, Modelle
  und Personenaufnahmen zu veröffentlichen ist eine separate
  Genehmigungsfrage
- Assets der Zielseite in ein Repo committen
- --allow benutzen, ohne zu wissen wofür — der Guard ist der einzige
  Schutz davor, dass der Clone echte Daten an fremde Dienste schickt
````

---

## Warum die Gegenmessung der Kern ist

Ein Clone gegen sich selbst zu prüfen sagt nichts. Erst wenn dasselbe Skript beide Seiten fährt, ist eine Differenz aussagekräftig — und, genauso wichtig, eine *Übereinstimmung im Fehlschlag* als Messgrenze erkennbar statt als Defekt.

Konkret aus dem Referenzlauf gegen oryzo.ai: ein Interaktionsschritt lief in beiden Läufen in denselben Timeout, und zwei Video-Requests brachen in beiden Läufen ab. Ohne die Gegenmessung wären das vier Stunden Fehlersuche an einem Clone gewesen, der nichts falsch macht.

## Was schiefgeht, wenn man schludert

| Symptom | Ursache |
|---|---|
| Sektion bleibt leer, 404 auf eine wasm-Datei | URL wird zur Laufzeit zusammengesetzt, keine statische Discovery findet sie |
| Formular „funktioniert" | Es schickt echte Daten an einen fremden produktiven Dienst |
| Runtime verhält sich beim Start seltsam | `page.content()` statt rohem Server-HTML als Basis genommen |
| Nach dem ersten Load „fertig" | Spätere Ladewellen noch nicht ausgelöst |
| Alles lädt, nichts bewegt sich | Original-JS bricht früh ab — Console lesen, nicht Animation nachbauen |
| Seite läuft über `file://` nicht | Falsche MIME-Typen für Modul-JS, wasm, Binärdaten |

Ausführlich mit Root Cause und Verifikation: [10 – Errors and Fixes](docs/case-studies/oryzo-ai/10-errors-and-fixes.md)
