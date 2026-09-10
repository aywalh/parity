# 11 – Known Limitations

## 1. Vimeo-Video bleibt extern

Das Hero-Video (`player.vimeo.com/video/1174820580`) läuft weiter über Vimeos Iframe. Der Overlay-Mechanismus, das Thumbnail und die Steuerung sind lokal und funktionieren; die Videodaten kommen von Vimeo.

**Warum nicht lokalisiert:** Vimeo liefert die MP4-Quellen nur über signierte, sitzungsgebundene Player-URLs aus. Das zu umgehen wäre ein Bypass einer Zugriffskontrolle — außerhalb dessen, was "öffentlich ausgeliefertes Frontend" bedeutet.

**Folge:** Ohne Internet zeigt das Overlay einen leeren Iframe. Alles andere läuft offline.

## 2. Newsletter ist gestubbt, nicht funktional

`clone-fixes.js` blockiert jeden Request an `list-manage.com` und ruft den JSONP-Callback lokal mit einer Erfolgsantwort auf.

**Warum:** Ohne Blocker meldet der Clone reale Personen an Lusions produktiver Mailchimp-Liste an. Das ist in einem frühen Lauf tatsächlich passiert — [10 – Errors and Fixes](10-errors-and-fixes.md), Problem 2.

**Folge:** Die UI erreicht `Almost there! Check your inbox`, es wird nichts versendet. Bewusste Abweichung vom Original.

## 3. Analytics entfernt

Der Cloudflare-Insights-Beacon wurde aus `index.html` entfernt. Der Clone sendet keine Telemetrie. Kein Einfluss auf die Darstellung.

## 4. Manifest-Icons fehlen — im Original ebenfalls

`/web-app-manifest-192x192.png` und `-512x512.png` liefern auch auf der Live-Seite 404; das Manifest trägt unverändertes Boilerplate. Der Clone reproduziert diesen Zustand statt ihn zu kaschieren.

## 5. Chrome DevTools MCP nicht eingesetzt

Playwrights CDP-Anbindung deckte Netzwerk, Console, Runtime-Evaluation und Screenshots vollständig ab. Für diesen Clone blieb keine Fähigkeit ungenutzt, die nur der DevTools-MCP geboten hätte. Wer Performance-Traces oder den Sources-Panel-Workflow braucht, ergänzt ihn.

## 6. Ein Interaktionsschritt vom Testverfahren nicht erreicht

`#encryption-field-flip-btn` läuft in Original **und** Clone in denselben Playwright-Timeout. Ob der Flip im Clone korrekt animiert, ist damit nicht automatisiert belegt — die Sektion rendert, und die Assets sind vollständig. Eine manuelle Prüfung im Browser würde das schließen.

## 7. Headless-Rendering ist Software-Rendering

Alle Verifikationsläufe liefen headless mit SwiftShader. Farben, Layout und Szenenzustand stimmen, aber echte GPU-Effekte (Präzision, Filterung, Framerate) können auf realer Hardware minimal abweichen — für Original und Clone gleichermaßen, da beide identisch gemessen wurden.

## 8. Zeitgetriebene Partikel sind nicht frame-synchron vergleichbar

Kaffeebohnen-Simulation und Hero-Beleuchtung laufen über freie `requestAnimationFrame`-Loops. Zwei Aufnahmen derselben Seite unterscheiden sich hier ebenfalls. Scroll-gebundene Animationen sind dagegen deterministisch und stimmen exakt.

## 9. Rechtliche Grenze — nicht veröffentlichen

Die `robots.txt` von oryzo.ai setzt `Content-Signal: search=yes, ai-train=no, use=reference` und sperrt mehrere KI-Crawler per `Disallow: /`.

Dieses Repo enthält **nur Methodik, Werkzeuge und Messergebnisse** — keine Assets von oryzo.ai. Der Clone entsteht lokal beim Ausführen der Skripte und ist eine nutzergesteuerte Rekonstruktion zu Studienzwecken: kein Crawling, kein Training, konsistent mit `use=reference`.

**Aber:** Eine fremde Marke samt Bildern, Modellen, Videos, Fonts und Produktidentität **öffentlich zu hosten, ist eine separate Genehmigungsfrage.** Der erzeugte Clone gehört auf `localhost`. Alle Inhalte, Assets und Marken bleiben Eigentum von Lusion.
