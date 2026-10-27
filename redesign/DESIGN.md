# VibeSim: the design (2027)

Designer: a computational artist. I do not decorate pages; I run systems and let type sit on them. The page is a
simulation. Everything that moves on it is computed in the visitor's tab, from numbers they can change, and says so.

## concept

**The page is a simulation.** The first screen is a live swarm, full bleed, under one line the visitor can rewrite:
"*600 boids, scared of the cursor, slow, warm*". Press return and the swarm is rebuilt from the sentence. Four verbs
carry the page — describe, instantiate, simulate, inspect — and the arm bench is the same loop with real joint limits
and real traces. Generated footage appears once, as a full-screen interval between the bench and the format, and is
captioned as generated.

## type

- Display: **Unbounded** (variable, wght 200–900). Very wide; used huge and tight (−0.04em) at 800 for statements,
  and at 250 for numerals in readouts, so one family carries both shout and instrument.
- Text: **Onest** (variable, wght 100–900), 17 px base, 1.55 leading, `text-wrap: pretty`; headings `balance`.
- No mono family: the description textarea and readouts use Onest with `tnum` and `zero`, so the code reads as the
  same voice as the page (the sentence *is* the scene).
- Scale: ratio 1.5 from 17 px: 11.3 · 17 · 25.5 · 38 · 57 · 86 · 128 (clamped to the viewport).
- Fallbacks: `size-adjust`ed local faces (Arial Black-like for Unbounded at 118 %, Arial for Onest at 101 %) so a late
  font does not shift the layout; Chinese falls to PingFang SC / Noto Sans CJK SC.

## colour (OKLCH, sRGB fallbacks first)

| token | value | use | contrast on ink |
|---|---|---|---|
| `--ink` | oklch(0.16 0.012 250) ≈ #0b0e12 | the only background | — |
| `--paper` | oklch(0.94 0.008 240) ≈ #e8edf1 | text | 16.4 : 1 |
| `--dim` | oklch(0.70 0.02 245) ≈ #95a1ad | secondary text | 7.3 : 1 |
| `--coral` | oklch(0.69 0.19 32) ≈ #fa674f | action, the goal, the cursor’s fear | 6.6 : 1 |
| `--uv` | oklch(0.73 0.14 285) ≈ #a89bfa | the simulated state: traces, readouts | 8.0 : 1 |
| spectral | coral → amber → mint → uv, mixed in OKLCH | the swarm by speed, joint traces by joint | data only |

Measured with `tools/contrast.mjs`. Dark only: a simulation reads best as light on black.

## shape and furniture

- Radius language: **circles and hairlines**. The one filled control is a circle (Run ▶, Instantiate ↵) beside its
  label; everything else is a 1 px hairline or nothing. No cards, no rounded rectangles, no shadows.
- Nav: a **phase rail** across the top: four stations (describe · instantiate · simulate · inspect) on one hairline;
  a coral dot travels the line with scroll (scroll-driven animation; a static dot without support). At ≤ 768 px the
  rail collapses to the wordmark and "Docs", and the phase shows as a single word.
- Focus: a 2 px coral ring offset 3 px, round on circles, square on the textarea.

## layout

- 1440 / 2560: the hero is 100 svh; the headline sits top-left on an 8-column grid, the readout top-right, the
  sentence prompt along the bottom edge across six columns. 2560 caps the text measure at 1680 px and lets the swarm fill
  the rest.
- 768: headline across 6 of 8 columns; the readout drops under it as one line.
- 390: the headline breaks into four lines at 44 px; the prompt is full width with the circle button at its right; the
  readout is two numbers only. The verbs become a vertical sequence; the bench stacks canvas → traces → description.
- 320: headline at 34 px, prompt wraps to two lines, the button stays a 48 px circle (the touch target).

## motion

- The swarm: boids (separation, alignment, cohesion) with a cursor/touch field. Coloured by speed. Motion explains:
  changing the sentence visibly changes the system's parameters, and the readout shows the order parameter φ.
- The four verbs: a sticky scene, scrubbed by scroll: the description's lines light, the arm's links draw in with their
  joint-range arcs (instantiate), the pick-and-place run plays at the scroll's rate (simulate), the joint traces build
  against their limit bands (inspect).
- Reduced motion: the swarm renders one settled frame and holds; a "Step" button advances it. The verbs render as four
  still plates. The video shows its poster. Nothing flashes.

## media plan (fal, ≤ $15; log in NOTES.md)

- `pigment`: macro of coral and ultraviolet pigment in black water, vortex streets: the full-screen interval.
  Kling 2.5 turbo pro, 10 s, 16:9. Encoded AV1 + H.264, ≤ 3 MB, poster frame, lazy.
- `flock`: a top-down murmuration of points of light: behind the format section, at 40 % under the type.
- OG image and the hero poster are frames of the site's own simulation, rendered by Playwright, not generated.

## signature moment

Type a sentence and the swarm becomes it. "*2000, calm, cold*" and the field cools to violet and slows; "*fear the
cursor*" and it parts around your finger. The readout states what was understood, word by word, so the parser is
honest about what it read.

## don'ts

No robot-arm footage (VibeCut has it), no corner-bracket buttons (VibeCut), no vertical rail (VibeMatch), no pills
(VibeMatch, VibeShit), no gradient text, no cards, no glass. Never show a generated clip as a result.
