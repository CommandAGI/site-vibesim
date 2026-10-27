# site-vibesim

The site of VibeSim, a company of CommandAGI (`org-vibesim`): simulation by description. A static folder served by
CommandAGI's site hosting at <https://vibesim.commandagi.app>, mounted on the org's Drive at
`seed/drive/platform/org-vibesim/sites/vibesim`.

| path | what |
|---|---|
| `index.html` | the home page in English (`/`): the swarm hero, the four verbs, the lab, the format, contact |
| `es/index.html`, `zh-Hans/index.html` | the same page in Spanish and Simplified Chinese, at `/es/` and `/zh-Hans/` |
| `tools/pages.mjs` | writes the three home pages from one template and one strings table (`node tools/pages.mjs`); edit it, not the pages |
| `docs/index.html` (and its `es/`, `zh-Hans/`) | the description format: the fields, what a run does, what the bench reports, its limits |
| `lab/lab.js` | the bench: reads the description, solves the goal, steps the servos at 1 kHz, draws the arm and the joint traces |
| `lab/swarm.js`, `lab/describe.js` | the hero: a boids swarm rebuilt from the visitor's sentence by a word parser (not a language model) |
| `lab/verbs.js`, `lab/draw.js` | the four verbs scrubbed by scroll (the bench's own pick run); the drawing both share |
| `lab/page.js` | the generated clips load and play only in view, never with reduced motion; the phase rail |
| `media/` | the two generated clips (AV1 + H.264, posters); `tools/media.mjs` made them (fal, at build time) |
| `fonts/` | Unbounded and Onest, subset woff2, with their OFL licences |
| `redesign/` | the 2027 redesign: `CONTENT.md` (audit), `DESIGN.md` (the spec), `NOTES.md` (media, cost, review) |
| `engine/` | CommandAGI's simulation core, copied verbatim (provenance and the exact commit in `engine/README.md`) |
| `style.css`, `mark.svg`, `wordmark.svg` | one stylesheet (dark only), the mark (favicon), the wordmark; `og.png`, `touch-icon.png` |

Every page is static, has no external font, script, stylesheet or tracker (the fonts are served from `fonts/`), and no page sends anything: the simulation
runs in the visitor's tab. The language button (A/文) in the footer opens a dialog listing the three locales as plain
links to each locale's static pages; without script it lists the same links.

## domains

| domain | locale | notes |
|---|---|---|
| `vibesim.commandagi.app` | en | CommandAGI's site hosting, the production address |
| `vibesim.pro` | en | the primary custom domain |
| `vibesim.dev` | en | an alias of the primary |

## the engine

`engine/` is CommandAGI's own code, copied, as the owner asked: `sim-robots.js` (the servo-driven chain), `pose.js`
(the kinematics checks), `geometry.js` and `motion.js` (what `pose.js` imports), `protocols/` (what `motion.js` imports)
and `machines/so101.json` (the SO-101's `kinematics` and `dynamics` channel, read from
`seed/global/devices/so101-follower-arm/definition.tsx`). `engine/README.md` says where each file came from.

## tests

```
node --test tests/lab.test.mjs           # the descriptions, the run, the pages' links and assets
node tests/browser_lab.mjs               # the same in Chrome: the lab runs, the dialog opens, nothing throws
```

The browser check needs Chrome (`CHROME_PATH` names the binary) and serves the folder on `127.0.0.1`.
