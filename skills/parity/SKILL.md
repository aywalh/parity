---
name: parity
description: Reconstruct the publicly served frontend of any website locally and prove the reconstruction is faithful by running the same probes against the original and the clone — or pull one single element, animation or interaction out of a page and measure that. Use when the user wants to clone, rebuild, mirror, copy or reverse-engineer a site, or wants just one effect from it (a hover, a scroll reveal, a canvas animation, a card) — especially on sites built with WebGL, Three.js, canvas, wasm, Rive, Lottie, GSAP or heavy scroll animation — and whenever a clone has to be verified, measured, diffed or defended with numbers rather than a screenshot. Drives the parity CLI: capture, localize, fetch, serve, verify, interact, responsive, motion, depth, diff, pxdiff for whole pages; extract, rebuild, export, showcase for single elements. Do NOT use to bypass authentication, paywalls, DRM or private APIs, and not for scraping page text or data.
---

# parity

Reconstruct the publicly served frontend of a site locally, then prove the
reconstruction is faithful by measuring both sides with the same probes.

Every cloning approach claims fidelity. This one measures it: identical probes
run against the original **and** against the clone, `parity diff` evaluates the
pair, and only the difference counts. A clone checked against itself proves
nothing.

The second consequence matters as much as the first: a probe that fails on
**both** sides is a limit of the measurement, not a defect of the clone. `diff`
marks it and does not count it against you. Say it that way too — do not book it
as a bug, and do not quietly drop it.

Below, `parity` means the CLI. If it is not on PATH, run `node bin/parity.mjs`
from the repository root instead; the arguments are identical.

## The rule that decides everything

**SOURCE FIRST → RUNTIME SECOND → VISUAL VALIDATION THIRD.**

Do not look at a screenshot and guess at HTML and CSS. A screenshot is an
instrument of verification, never the source. When the original runtime runs
locally, timing, easing and stagger are correct by definition — the job is to
get that runtime running, not to reproduce what it does by hand.

## Setup

```bash
npm install
npx playwright install chromium
```

`parity install` checks the environment and can set up the optional UI.

## Phase 1 — Baseline the original

```bash
parity capture <TARGET-URL> capture/original
```

Writes to `capture/original/`:

| File | Contents |
|---|---|
| `baseline.json` | globals, console, failed requests, resource entries — in 3 phases (load / after scroll / mobile) |
| `resources.txt` | every unique resource URL |
| `original.html` | hydrated DOM — **for comparison only** |
| `*.png` | desktop and mobile screenshots |

Read `baseline.json` before doing anything else:

- **`globals`** — which runtime libraries sit on `window`? Frequently **none**;
  modern bundles are module-scoped. Then grep the JS bundle instead of trusting
  `window.gsap` and friends.
- **`responses`** — which hosts? Everything same-origin can be localized.
  Judge third parties one at a time.
- **`failedRequests`** — some failures belong to the original. Note them now, or
  you will chase ghosts later.

## Phase 2 — Localize

```bash
parity localize <TARGET-URL> clone
```

Fetches the raw server HTML, strips tracking scripts, and installs
`parity-guard.js`, which blocks every off-origin request. When a third party
genuinely needs access (a video player, say):

```bash
parity localize <TARGET-URL> clone --allow player.vimeo.com
```

**Never build the clone on `page.content()` from Phase 1.** That serializes the
hydrated DOM including runtime classes; the runtime then starts against a state
it wanted to establish itself. Always take the raw HTML.

Check whether the page sets `<base href="/">`. If it does and all paths are
root-relative, no URL rewriting is needed as long as you serve from the clone
root — that removes half the error class before it appears.

## Phase 3 — Fetch the assets

```bash
parity fetch <TARGET-URL> clone clone/index.html
```

Follows paths recursively through HTML, CSS and JS bundles until nothing new
appears. Writes `clone/ASSETS.json` with `downloaded` / `notFound` / `failed`.
Extra entry points can be appended:

```bash
parity fetch <TARGET-URL> clone clone/index.html capture/original/resources.txt
```

## Phase 4 — Determine the technology

Do not guess, grep. In the main bundle:

```bash
grep -o "THREE" bundle.js | wc -l
```

Check at least: `THREE`, `WebGLRenderer`, `ShaderMaterial`, `gl_FragColor`,
`uniform`, `postprocessing`, `SMAA`, `SplitText`, `gsap`, `ScrollTrigger`,
`lenis`, `Swiper`, `lottie`, `rive-app`, `msdf`, `sog`, `InstancedMesh`,
`IntersectionObserver`, `lerp`, `damp`, `requestAnimationFrame`.

The negative result carries as much weight as the positive one. "Looks like
ScrollTrigger" and "contains ScrollTrigger" are different statements.

## Phase 5 — Handle third parties

| Kind | What to do |
|---|---|
| Analytics / tracking | Remove. |
| CDN runtime (wasm) | Localize. URLs are often assembled at runtime — then patch the bundle, after saving the original: `cp bundle.js capture/bundle.orig.js`. |
| **Forms** | **Block.** See below. |
| Video / maps / SSO | Domain-bound. Leave external or build a local fallback. Never circumvent anything that is access control. |

A clone that lets a form through sends **real data to somebody's live production
service**. Override `appendChild`, `insertBefore`, `append`, `prepend`, `fetch`
**and** `XMLHttpRequest.open` — JSONP libraries use `insertBefore`, not
`appendChild`. Then **prove** with `page.on('request')` that nothing leaves. Do
not assume it. Test it.

## Phase 6 — Serve locally

```bash
parity serve clone 4173
```

`file://` is not a valid test path once module JS, wasm, workers or binary scene
data are involved. `serve` sends the right MIME types (`.wasm`, `.buf`, `.sog`,
`.riv`, `.webmanifest`) plus range requests for video.

## Phase 7 — The 404 loop

Repeat until nothing is missing:

```bash
parity verify http://localhost:4173/ capture/run
```

Read `capture/run/missing.txt`, fetch exactly those files, repeat. On 3D sites
this is normal: the first wave is hero assets, later waves arrive only once a
scene initializes or you have scrolled far enough. Being finished after the
first load is the exception, not the rule.

## Phase 8 — Counter-measurement

This is the actual test. Run **every** script against **both** sides:

```bash
parity verify     <TARGET-URL>           capture/orig  --shots
parity verify     http://localhost:4173/ capture/clone --shots
parity interact   <TARGET-URL>           capture/orig
parity interact   http://localhost:4173/ capture/clone
parity responsive <TARGET-URL>           capture/orig
parity responsive http://localhost:4173/ capture/clone
parity motion     <TARGET-URL>           capture/orig
parity motion     http://localhost:4173/ capture/clone
parity depth      <TARGET-URL>           capture/orig
parity depth      http://localhost:4173/ capture/clone
```

`motion` measures the motion layer — curves, durations, libraries. `depth`
measures reach: how far the wheel still changes the picture. Both matter on a
page whose movement is the product; on a static page they cost a run and tell
you little.

Then evaluate:

```bash
parity diff capture/orig capture/clone
```

Exit code 0 = parity, 1 = deviation. What `diff` checks:

- **`scrollHeight`** — the single most telling value. It is the sum of every
  section height and pin distance. One missing section or one uninitialized
  module moves it immediately.
- **`canvasNonBlank`** — per canvas: rendering content, or blank?
- **Interaction steps** — same count passing? the same steps failing?
- **Responsive** — every width identical? `overflowX` zero everywhere?
- **Screenshots** at 0 / 25 / 50 / 75 / 100 % — actually look at them, do not
  merely count them.

An animated page needs a frozen clock so both sides are photographed at the same
moment: add `--freeze`, or `--freeze=30000` for an intro that takes 30 virtual
seconds to settle. A page waiting behind a start gate cannot be advanced by time
at all; its loaded state is what you get.

With a frozen clock the screenshot pair also becomes comparable pixel by pixel:

```bash
parity pxdiff capture/orig/scroll-50.png capture/clone/scroll-50.png
```

Without `--freeze` this measures the animation phase, not the reconstruction —
do not report such a number.

When the site needs interactions of its own (configurator, slider, modal), write
a steps module and attach it:

```bash
parity interact <URL> <out> --steps my-steps.mjs
```

```js
// my-steps.mjs
export default async ({ page, step, shot }) => {
  await step('variant-2', async () => {
    await page.click('#option-2');
    await page.waitForTimeout(2000);
    return page.$$eval('.option', e => e.map(x => x.className));
  });
  await shot('variant-2');
};
```

Template: `case-studies/oryzo-ai/steps.mjs`.

## Extracting one part instead of the whole page

Sometimes the user wants one thing rather than the whole clone: a WebGL scene, a
shader, a particle system, a canvas effect, a GSAP timeline, a scroll
transition, a cursor interaction, a loader. This does **not** require Phases
1–8. The whole page stays the source of analysis, but nothing gets reconstructed
and nothing gets downloaded:

```bash
parity extract <TARGET-URL> --selector ".hero-title"
parity extract <TARGET-URL> --selector ".card" --trigger hover
parity extract <TARGET-URL> --selector "nav" --scope section --repeat 5
```

Only on request, and in the output form they asked for — do not assume a
framework or a deliverable.

**Read the grading before you promise anything.** `extract` writes
`extractions/<slug>/` with `metadata.json` and a readable `report.md`, and it
grades isolatability itself:

| | |
|---|---|
| `isolatable` | DOM element, local CSS, clear trigger, few dependencies |
| `partial` | needs parent state, global scroll logic or an external library |
| `reference-only` | WebGL scene, canvas drawing, Rive — the runtime cannot be cut out |
| `not-analysable` | the selector matches nothing |

Every measured value records its origin: `engine` comes from
`getAnimations()` and is exact, `sampled` carries frame noise. Repeat that
distinction when you report — do not present a sampled number as an exact one.

**`vanilla/` is not yours to publish.** The isolated version contains the source
page's own markup and CSS. It proves the isolation holds; it is an analysis
result, not a component. What may be published comes from the next step, which
writes an independent version out of the measurement:

```bash
parity rebuild extractions/<slug> --shot
```

**Do not invent limitations.** Difficulty, minification, bundling, obfuscation,
unfamiliar technology, missing documentation and framework coupling are not
proof that extraction is impossible — only that it is inconvenient. Exhaust the
reasonable technical approaches before declaring a limit, and never fall back to
a simplified imitation because separating the original was awkward. A
`reference-only` grading from the tool is a measurement, not a verdict on your
effort: it says the runtime cannot be cut out, not that nothing can be learned.

**When isolation resists, keep going.** Trace the module graph, instrument
runtime loading, find the initialization boundary, expose internal entry points,
separate shared state, reproduce the original environment locally. Find the real
implementation and its full dependency boundary — the responsible module, its
styles, runtime libraries, shaders, models, textures, fonts, binary data, event
handlers and initialization code. Minified and bundled code is still code and
can still be traced; complexity on its own is not a technical limit, and
rebuilding an effect from screenshots while its implementation sits in front of
you is the same mistake here as it was on the first page.

**Verify against the original** at equal viewport, input, scroll position and
frozen clock — Phase 8 again, on a smaller stage. Preserve timing, easing,
interaction states, responsive behavior and visual output. Strip unrelated page
code, analytics, production forms and anything that submits data. Name every
dependency, and every behavior that could not be separated faithfully. Report a
limitation only once you have observed it: name the exact dependency, resource,
interface or runtime requirement that failed, and the approaches you tried. Then
still ship the most functional result you have.

A clean reimplementation from measured public behavior is the last fallback, not
the default — for when the implementation genuinely cannot be obtained, or
cannot run outside its original environment. Label it a reimplementation, never
original source.

**Never** applies to extraction unchanged. `extractions/` is gitignored for the
same reason `clone/` is: it holds someone else's markup, CSS and assets.

## Done when

- 0 HTTP >= 400 locally
- 0 unexplained console errors
- `scrollHeight` matches the original
- canvas count and canvas states match
- interaction balance equal
- every tested width matches, 0 overflow
- every remaining deviation is **named and explained**

Never report finished because the page loads. When something does not work,
write down what and why. An honest limitation is worth more than a flattering
number.

## Never

- Circumvent authentication, paywalls, DRM, private APIs or signed asset
  delivery. A login wall is the end of the job, not an obstacle in it.
- Let forms through to somebody's live production service.
- Publicly host the clone. Republishing another party's brand, images, models
  and photographs of people is a separate permission question — and not yours
  to answer.
- Commit the target's assets to a repository.
- Use `--allow` without knowing what for. The guard is the only thing standing
  between the clone and real data leaving for a stranger's service.

## When it goes wrong

| Symptom | Cause |
|---|---|
| Section stays empty, 404 on a wasm file | URL assembled at runtime; no static discovery finds it |
| A form "works" | It is sending real data to somebody's production service |
| Runtime behaves strangely at startup | `page.content()` used as the clone base instead of raw server HTML |
| "Finished" after the first load | Later load waves not triggered yet |
| Everything loads, nothing moves | The original JS aborts early — read the console, do not rebuild the animation |
| Page will not run over `file://` | Wrong MIME types for module JS, wasm, binary data |

Root cause and verification for each:
`docs/case-studies/oryzo-ai/10-errors-and-fixes.md`.
