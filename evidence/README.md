# evidence

Rohdaten der Gegenmessungen. Pro Ziel je ein `source/`- und ein `clone/`-Verzeichnis
mit identisch erzeugten Reports — genau die Paare, die `parity diff` vergleicht.

Screenshots sind entfernt (reproduzierbar mit `--shots`), die Messwerte sind vollständig.

```bash
node bin/parity.mjs diff evidence/example.com/source    evidence/example.com/clone
node bin/parity.mjs diff evidence/rust-lang.org/source  evidence/rust-lang.org/clone
node bin/parity.mjs diff evidence/oryzo.ai/source       evidence/oryzo.ai/clone
```

Alle drei enden mit Exit-Code 0.

| Ziel | Charakter | Assets | Besonderes |
|---|---|---|---|
| example.com | statisches HTML | 1 | Untergrenze — beweist, dass nichts site-spezifisch verdrahtet ist |
| rust-lang.org | Produktionsseite: CSS, 5 Fonts, Bilder, JS | 117 | 15/15 Breiten identisch |
| oryzo.ai | Three.js, Rive/wasm, Splats, MSDF, 56691 px Scroll | 161 | 6 Canvases, 19/20 Interaktionen |
