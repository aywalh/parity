<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/wordmark-light.png">
  <img alt="parity" src="brand/wordmark-dark.png" width="200">
</picture>

![parity — the method in 45 seconds](media/parity-film.gif)

<sub>**45 seconds**, captions burned in — the method end to end, and the counter-measurement that decides it. GitHub strips `<video>` from a README, so this is the film as an animated frame; the version with voice-over and sound plays on <a href="https://parity-ui.vercel.app/#film">parity-ui.vercel.app</a>.</sub>

**Source-first frontend reconstruction with counter-measurement.**

Every cloning tool claims fidelity. `parity` measures it.

The idea is simple, and it is the reason this tool exists: **the same probes run against the original *and* against the clone.** A clone checked only against itself proves nothing. Only the difference between two identical measurement runs says anything — and, just as important, a failure on *both* sides is recognised as a limit of the measurement, not booked as a defect.

```
✓ title                     ORYZO AI                             ORYZO AI
✓ canvas count              6                                    6
✓ canvas rendering          [false,false,true,false,true,false]  [false,false,true,false,true,false]
✓ scrollHeight              56691                                56691
✓ images loaded             39/39                                39/39
✓ interaction steps passed  19/20                                19/20
✓ responsive (15 widths)    15 measured                          all identical

  · encryption-flip: failed on both sides → limit of the measurement

✓ Parity reached
```

That is not sample output. It is a real run, and the raw data behind it lives in this repository.

---

## The evidence

Four targets reached parity. One did not produce a result at all — and that one is in here on purpose.

Every number below comes from a file you can open. Nothing is summarised by hand.

### oryzo.ai — Three.js, Rive/wasm, Gaussian splats

The hard case. 161 assets, shaders with 607 uniforms, 25 animation buffers, MSDF text, and a 56 691-pixel scroll axis.

| Probe | Original | Clone | |
|---|---|---|---|
| Scroll height | 56 691 px | 56 691 px | ✓ |
| Canvas elements | 6 | 6 | ✓ |
| …actually rendering | 2 of 6 | the same 2 | ✓ |
| Images loaded | 39 / 39 | 39 / 39 | ✓ |
| Font faces | 3 | 3 | ✓ |
| Console errors | 0 | 0 | ✓ |
| HTTP ≥ 400 | 0 | 0 | ✓ |
| Interaction steps | 19 / 20 | 19 / 20 | ✓ |
| Responsive widths | 15 measured | all identical | ✓ |

The one step that did not pass — `encryption-flip` — failed on **both** sides. That is a limit of the measurement harness, not a defect of the clone, and `diff` does not count it as one. This is precisely what counter-measurement buys you.

→ [`evidence/oryzo.ai/`](evidence/oryzo.ai/) · [full case study](docs/case-studies/oryzo-ai/)

### dogstudio.co — a real production site

| Probe | Original | Clone | |
|---|---|---|---|
| Scroll height | 3800 px | 3800 px | ✓ |
| Scroll position reached | 2900 px | 2900 px | ✓ |
| Images loaded | 13 / 13 | 13 / 13 | ✓ |
| Font faces | 8 | 8 | ✓ |
| Console errors | 0 | 0 | ✓ |
| Responsive widths | 15 measured | all identical | ✓ |

→ [`evidence/dogstudio.co/`](evidence/dogstudio.co/)

### threejs-ocean — a continuously animating WebGL scene

| Probe | Original | Clone | |
|---|---|---|---|
| Canvas elements | 4 | 4 | ✓ |
| …actually rendering | the 4th | the 4th | ✓ |
| Font faces | 1 | 1 | ✓ |
| Console errors | 0 | 0 | ✓ |
| Responsive widths | 15 measured | all identical | ✓ |

This is also the target that produced the `--freeze` insight below: without a frozen clock, two screenshots of this page disagree on 79 % of their pixels. With one, the worst channel deviation drops to **2 of 255**.

→ [`evidence/threejs-ocean/`](evidence/threejs-ocean/)

### bruno-simon.com — a WebGL portfolio

| Probe | Original | Clone | |
|---|---|---|---|
| Canvas elements | 1 | 1 | ✓ |
| Images loaded | 1 / 44 | 1 / 44 | ✓ |
| Font faces | 4 | 4 | ✓ |
| Responsive widths | 15 measured | all identical | ✓ |

`1 / 44` is not a fault. The site defers 43 images until they are needed, and it does so identically on both sides — which is the whole point of comparing rather than counting.

→ [`evidence/bruno-simon.com/`](evidence/bruno-simon.com/)

### igloo.inc — no result

```
✗ No result — there was nothing to compare
```

The page never rendered far enough for the probes to observe anything: no canvases, no images, no fonts, a document that does not scroll. Both sides agreed on that emptiness, and `diff` **refuses to call it parity.**

This row is in the README on purpose. A tool that measures fidelity has to be able to say *I don't know*. If it cannot, its green checkmarks are worth nothing.

→ [`evidence/igloo.inc/`](evidence/igloo.inc/)

---

## Works on any site

There is no target configuration, no site profile, nothing to fill in. The procedure is identical for a shader demo and for a marketing site: **URL in, clone out, measurements alongside.**

What lives in `evidence/` is measurement only — titles, scroll heights, counters, error lists. No third-party images, no third-party code. The generated clones themselves are permanently gitignored, and [Limits](#limits) explains why that stays.

---

## The approach

**The original runtime is adopted, not rebuilt.**

No screenshot guessing, no "looks about right". If the original JavaScript runs locally, then timing, easing and stagger are correct by definition — you only have to make it run, not reconstruct it.

```
SOURCE FIRST   →   RUNTIME SECOND   →   VISUAL VALIDATION THIRD
```

A screenshot is an instrument, not the source.

---

## Getting started

```bash
npm install
node bin/parity.mjs --install
```

Setup checks the environment and optionally installs the interface — [see below](#setup). Then the actual run:

```bash
node bin/parity.mjs capture   https://target.tld capture/orig
node bin/parity.mjs localize  https://target.tld clone
node bin/parity.mjs fetch     https://target.tld clone clone/index.html
node bin/parity.mjs serve     clone 4173
```

Then the counter-measurement, which is the entire point:

```bash
node bin/parity.mjs verify https://target.tld       capture/orig  --shots
node bin/parity.mjs verify http://localhost:4173/   capture/clone --shots
node bin/parity.mjs diff   capture/orig capture/clone
```

`diff` exits 1 when anything differs — ready for CI as it stands.

---

## Interface

```bash
node bin/parity.mjs ui
```

Opens its own window — Chrome or Edge in app mode, no address bar, its own taskbar entry — and runs the whole sequence in one go: URL in, then `capture` through `diff` execute while showing their work.

You watch the **404 loop** — round 1 fetches what is written in HTML, CSS and JS; round 2 fetches what only the runtime ever asks for — the **counter-measurement** filling in row by row, and **screenshot pairs** at identical scroll marks with a blend slider.

The interface adds nothing to the engine. It starts the same commands and reads their `--json` output: one NDJSON event per line, streamed to the browser over SSE. **Every** command can do this, and without the flag terminal behaviour is unchanged.

```bash
node bin/parity.mjs diff capture/orig capture/clone --json
```
```json
{"ev":"row","kind":"diff","label":"scrollHeight","source":"56691","clone":"56691","match":true}
{"ev":"done","cmd":"diff","ok":true,"mismatches":0,"checked":12,"exit":0}
```

Without running anything yourself, the *Evidence* dropdown replays `diff` against the reference pairs above.

It listens on `127.0.0.1` only and rejects requests from foreign origins. No network access, and no website you visit can trigger a run.

### Setup

```bash
node bin/parity.mjs --install
```

```
  █▌▐█  parity

  Setup                                              parity

  Environment

  ✓  Node           v24.x
  ✓  Playwright     1.63.0
  !  Chromium       not downloaded
                    npx playwright install chromium
  ✓  App window     Chrome
  !  Agent skill    not installed
                    /plugin marketplace add aywalh/parity

  What should be installed?

  ❯ CLI and interface  Start menu entry with window · recommended
    CLI only           no Start menu entry

  ↑↓ move · ⏎ confirm · esc cancel
```

| Choice | Result |
|---|---|
| **CLI and interface** | Start menu entry carrying the brand mark, pinnable to the taskbar. Starts Node minimised and opens the app window. Closing the window shuts everything down. |
| **CLI only** | Nothing is created. `parity ui` still works; only the shortcut is missing. |

Watching without measuring is a button inside the interface, not a mode you install: it replays the committed pairs from `evidence/` through the real `diff`. No Playwright, no downloads, no clone server.

For scripts and CI without a terminal, a flag replaces the prompt:

```bash
node bin/parity.mjs --install --ui        # with shortcut
node bin/parity.mjs --install --no-ui     # without
```

Chromium is never downloaded behind your back — the command is printed, the 150 MB are yours to pull. A web app manifest ships alongside, in case you prefer *Install this site as an app* in Edge or Chrome.

The agent skill is checked the same way: reported, never installed for you. `/plugin marketplace add` is a command inside Claude Code, not a shell command, so setup can only point at it — and stops pointing once the skill is there. Neither the skill nor the app window blocks anything; a measurement run needs Node, Playwright and Chromium, and nothing else.

Runs land in `runs/<host>/` and are permanently gitignored, for the same reason as `clone/`: they are someone else's content.

---

## Selective extraction

A full clone reconstructs the whole page. Sometimes you only want *one thing* — that text reveal, that hover effect, that card.

```bash
node bin/parity.mjs extract https://target.tld --selector ".hero-title"
node bin/parity.mjs extract https://target.tld --selector ".card" --trigger hover
node bin/parity.mjs extract https://target.tld --selector "nav" --scope section --repeat 5
```

The whole page stays the source of analysis; the result is a single element — and **nothing has to be cloned or exported for it.**

Measured, not guessed. The main probe is `element.getAnimations({subtree: true})`: CSS transitions, CSS keyframes and Web Animations API in one call, with duration, delay and easing straight out of the browser engine. Whatever slips past it — GSAP, rAF loops — is sampled per frame. Every value in the metadata records where it came from: `engine` is exact, `sampled` is a measurement carrying frame noise. Which properties get watched is decided by the target's own CSS, not by a fixed list — a button whose hover only changes `border-color` would otherwise pass as "no motion".

### Four levels of isolatability

| | |
|---|---|
| `isolatable` | DOM element, local CSS, clear trigger, few dependencies |
| `partial` | needs parent state, global scroll logic or an external library |
| `reference-only` | WebGL scene, canvas drawing, Rive — the runtime cannot be cut out |
| `not-analysable` | the selector matches nothing |

The grading is deliberately conservative: better to claim `partial` and be right than to promise `isolatable` and ship a broken preview.

### What `vanilla/` is — and what it is not

The isolated version contains **the source page's own markup and CSS**, reduced to the target. It is an analysis result, not a component of yours — it proves the isolation holds, and it is not for publishing. Foreign assets and fonts are linked, never copied along, and are listed in the warnings.

What may be published comes from the next step:

```bash
node bin/parity.mjs rebuild extractions/<slug> --shot
```

`rebuild` reads `metadata.json` and writes an **independent** version from it. That distinction is the entire point: the first proves what the original does, the second is yours.

---

## Commands

**Full clone** — reconstruct a whole page and counter-measure it:

| | | |
|---|---|---|
| `capture` | `<url> [out]` | baseline: resource entries across 3 load phases, console, failed requests, runtime globals, screenshots |
| `localize` | `<url> <out>` | fetch the pristine server HTML, strip tracking, install the guard |
| `fetch` | `<origin> <out> [seed]` | recursive asset discovery through HTML, CSS and JS bundles |
| `serve` | `[root] [port]` | static server with MIME types for `.wasm`/`.buf`/`.sog`/`.riv` + range requests |
| `verify` | `<url> <out> [--shots] [--freeze]` | metrics, per-canvas contrast, 404s, screenshots at 5 scroll marks |
| `interact` | `<url> <out> [--steps m]` | interaction matrix — generic, optionally with site steps |
| `responsive` | `<url> <out>` | sweep across 15 widths, **measuring** breakpoints instead of assuming them |
| `motion` | `<url> [out]` | measure the motion layer: curves, durations, libraries |
| `depth` | `<url> [out]` | measure reach: how far the wheel still drives the page |
| `diff` | `<source> <clone>` | evaluate the counter-measurement — exit 1 on any difference |
| `pxdiff` | `<a.png> <b.png>` | compare a screenshot pair pixel by pixel — only meaningful with `--freeze` |

**Selective extraction** — one element instead of the whole page:

| | | |
|---|---|---|
| `extract` | `<url> --selector <css>` | measure and isolate a single element |
| `rebuild` | `<extraction-dir> [--shot]` | write an independent version from the measurement |
| `export` | `<extraction-dir> [--all]` | video, single file and ZIP of an extraction |
| `showcase` | `<extraction-dir> [--serve]` | a page showing what was found — and what was not |

**Setup and interface:**

| | | |
|---|---|---|
| `install` | `[--ui\|--no-ui]` | check the environment, optionally install the interface |
| `ui` | `[port] [--no-window]` | interface: runs the sequence and shows it live |

Every command also accepts `--json` and then writes NDJSON instead of text.

Node standard library plus Playwright. Nothing else.

---

## For AI agents

This is the intended working mode: hand over a page, say what you need, the agent does the rest — because through `capture` and `verify` it actually *sees* what the page does instead of guessing.

### As an installed skill

This repository is its own plugin marketplace, so Claude Code installs the brief straight from it:

```bash
/plugin marketplace add aywalh/parity
/plugin install parity@parity
```

From then on the agent reaches for it by itself whenever a frontend has to be reconstructed, or a clone defended with numbers rather than a screenshot. What it reads is [`skills/parity/SKILL.md`](skills/parity/SKILL.md) — the eight phases with exact commands, the traps, the stop conditions, and the optional pass for extracting a single scene or effect out of the finished clone.

The skill drives this CLI; it does not replace it. Clone the repository and run `npm install` as below, or the commands it issues have nothing to run.

### As a prompt

For an agent without plugin support, copy the block below. It is the short form; [**PROMPT.md**](PROMPT.md) is the full eight-phase version with exact commands, pitfalls and stop conditions.

```markdown
Reconstruct and verify the publicly served frontend of <TARGET-URL> locally.
Use parity (bin/parity.mjs).

<YOUR SCOPE: everything / layout only / animations only / desktop only /
 one section / ignore forms / ...>
If nothing is specified, reconstruct everything.

RULE — SOURCE FIRST → RUNTIME SECOND → VISUAL VALIDATION THIRD.
Do not look at a screenshot and guess HTML/CSS. A screenshot is an
instrument, not the source. If the original runtime runs locally, timing
and easing are correct by definition.

WORK THROUGH:
  1. capture    baseline the original across three load phases
  2. localize   pristine server HTML, strip tracking, install the guard
  3. fetch      pull assets recursively from HTML, CSS and JS
  4. identify   determine the stack from bundle evidence, never by guessing
  5. third-party  leave external or give it a local fallback
  6. serve      run it locally with correct MIME types
  7. 404 loop   re-fetch what only the runtime requests, until nothing is missing
  8. diff       counter-measure until it exits 0

DONE means `parity diff` exits 0. A step that fails on BOTH sides is a limit
of the measurement, not a clone defect — do not chase it. Never claim
fidelity you have not measured.
```

Drop it in as an agent file:

```bash
cp PROMPT.md AGENTS.md      # Codex, Cursor and others
```

---

## What `localize` protects

A clone that lets a form through sends real data to someone else's production service. The installed guard therefore blocks **every off-origin request** by default — JSONP script injection across all five DOM insertion paths, `fetch`, `XHR`, `sendBeacon` and off-origin form submits — and answers JSONP callbacks locally so the UI still reaches its success state.

If you genuinely need a third-party script:

```bash
node bin/parity.mjs localize https://target.tld clone --allow player.vimeo.com
```

This is not a theoretical protection. During the oryzo case study an earlier, incomplete version really did post to a live Mailchimp list — the JSONP library used `insertBefore`, and only `appendChild` had been overridden. That is why the guard covers every path, and why [PROMPT.md](PROMPT.md) tells you to prove it rather than assume it.

The interface deliberately does **not** offer `--allow`. What that switch opens up should be typed deliberately.

---

## Case study

**[oryzo.ai](docs/case-studies/oryzo-ai/)** — the hard one. Twelve documents: stack identification from bundle evidence, asset architecture, animation system, interaction matrix, every measurement series, five problems traced to root cause, final assessment. Result 9.6/10.

Reproduce it:

```bash
node bin/parity.mjs interact https://oryzo.ai/ capture/orig \
  --steps case-studies/oryzo-ai/steps.mjs
```

---

## Four things that hurt when cloning

**Some assets appear nowhere in the HTML.** Rive builds its wasm URL at runtime from a package name and version. No static discovery finds it — it only shows up as a 404 once the CDN fetch fails. That is why `capture` collects resource entries across three load phases, not just at load.

**`page.content()` is not the server HTML.** It serialises the hydrated DOM. Used as a clone base, the runtime then meets a state it was going to build itself. `localize` always fetches the raw document.

**`file://` is not a test path.** Module JS, wasm, workers and binary scene data need HTTP with correct MIME types. A clone can look completely broken purely because `.buf` was served as `text/html`.

**Screenshots of an animated page are worthless.** Two captures land at different moments of the same animation — on the three.js ocean that made 79 % of pixels disagree, by up to 216 of 255. Not a fidelity problem, a measurement problem. `verify --freeze` pins the page clock: `Date`, `setTimeout` and `requestAnimationFrame` come from a paused clock that only advances when the measurement script advances it — by exactly the same amount on both sides.

```bash
node bin/parity.mjs verify https://target.tld     capture/orig  --shots --freeze
node bin/parity.mjs verify http://localhost:4173/ capture/clone --shots --freeze
```

Only then are two screenshots comparable at all. The same measurement drops to a worst-channel deviation of **2 of 255** — invisible.

---

## Limits

`parity` reconstructs the **publicly served frontend**. It does not bypass authentication, paywalls, DRM, private APIs or signed asset delivery — and it is not meant to.

Domain-bound services (Vimeo, Maps, SSO) stay external or get a local fallback. Server behaviour is not frontend and is not rebuilt.

And: **do not publicly host generated clones.** Publishing someone else's brand, images, 3D models, fonts and photography is a separate permissions question. This repository therefore contains no third-party assets of its own — `clone/`, `clone-*/` and `runs/` are permanently gitignored, from commit one. See [NOTICE.md](NOTICE.md).

---

## Licence

[MIT](LICENSE) · © 2026 aywalh

Browser automation: [Playwright](https://github.com/microsoft/playwright)

---

<p align="center">
  <a href="https://parity-ui.vercel.app">parity-ui.vercel.app</a>
  &nbsp;·&nbsp;
  <a href="https://x.com/aywalh">@aywalh</a>
</p>

<p align="center">
  <sub>Made with love and heart.</sub>
</p>
