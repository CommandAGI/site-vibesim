# VibeSim: content audit (2026-10-26)

What the site is, what works, what it claims, before the 2027 redesign (`docs/design/startup-redesign-2027.md` § 5.1 in
CommandAGI).

## routes

| route | what | kept |
|---|---|---|
| `/` | home and the lab (en) | yes, redesigned |
| `/es/`, `/zh-Hans/` | the same page in Spanish and Simplified Chinese | yes, generated from one strings table (`tools/pages.mjs`) |
| `/docs/`, `/es/docs/`, `/zh-Hans/docs/` | the description format | yes, same text, the new type and colour |
| `mailto:hello@vibesim.pro` | contact | yes |

## the working features (every one kept)

- **The bench** (`lab/lab.js`, `lab/bench.js`): a JSON description (machine `so101`, start angles, `goal_mm`,
  `payload_g`) is parsed with plain refusals, solved with CommandAGI's inverse kinematics and stepped at 1 kHz by the
  copied engine (`engine/`). Run, Step, Reset, three presets (reach, pick and place, out of reach), drag to turn the
  camera, a status line in `role="status"`, the HUD in `aria-live`.
- **The language dialog** (A/文, `<dialog>` opened by `commandfor`), with a `<noscript>` list of links.
- Nothing is sent: no external font, script, stylesheet or tracker (a test holds it).

## what is a demo

- Everything in the bench is a real simulation of the SO-101's published joint ranges and servo limits, in the
  visitor's tab. It is a simulation, not a measurement of a real arm.
- The redesign adds two things, both labelled on the page: the hero's swarm, a boids simulation whose parameters a
  small word parser reads from the visitor's sentence (it reads numbers and a short list of words; it is not a language
  model), and joint traces of the bench's own run.
- Generated footage (fal) is atmosphere and is captioned "generated footage, not a simulation result".

## claims

- "The engine is copied from CommandAGI's own simulation core": true (`engine/README.md`, revision `289fc50180`).
- "A scene and its commands fully determine a run": true of the bench (deterministic stepping).
- No customers, logos, counts, ratings or press. None are added.
