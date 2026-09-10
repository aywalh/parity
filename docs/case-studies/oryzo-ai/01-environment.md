# 01 – Environment

## Referenzumgebung

| | |
|---|---|
| OS | Windows, macOS oder Linux |
| Node | >= 18 |
| Playwright | >= 1.6, mit installiertem Chromium |

Die Skripte hängen an nichts Betriebssystem-Spezifischem. Festgehalten ist hier die
Anforderung, nicht die Maschine, auf der die Messwerte entstanden sind — eine exakte
Build-Nummer sagt über die Reproduzierbarkeit nichts und über den Rechner zu viel.

## Setup

```bash
npm install
npx playwright install chromium
```

## Verifikation der Automation

Der erste Lauf von `tools/capture.mjs` gegen `https://oryzo.ai/` muss Titel `ORYZO AI`, 6 Canvases und rund 153 Ressourcen liefern. Kommt weniger zurück, ist die Browser-Automation nicht sauber aufgesetzt und jede weitere Messung wertlos.

## Bewusst nicht eingesetzt

`ChromeDevTools/chrome-devtools-mcp` — Playwrights CDP-Anbindung deckte Netzwerk (`page.on('response')`, `requestfailed`), Console (`page.on('console')`, `pageerror`), Runtime-Evaluation (`page.evaluate`) und Screenshots vollständig ab. Für diesen Clone blieb keine Fähigkeit ungenutzt, die nur der DevTools-MCP geboten hätte. Wer Performance-Traces oder den Sources-Panel-Workflow braucht, ergänzt ihn.
