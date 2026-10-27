# VibeSim redesign: notes (2026-10-26)

## generated media (fal)

Both clips come from `tools/media.mjs` (the prompts are in it, verbatim), run once on 2026-10-26 with
`COMMANDAGI_ENV_ROOT=/home/brandonin/Documents/commandagi`. The key never reaches the client or this repository.

| clip | model | length | price | cost | use |
|---|---|---|---|---|---|
| `pigment` | `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` | 10 s, 16:9 | $0.07 / s | $0.70 | the full-screen interval |
| `flock` | `fal-ai/kling-video/v2.5-turbo/pro/text-to-video` | 10 s, 16:9 | $0.07 / s | $0.70 | behind the format section, at 40 % |

Total fal spend: **$1.40** of the $15 allowance (prices from fal's pricing API on the day). No retakes.

Prompts (abridged; full text in `tools/media.mjs`): *pigment* — "Extreme macro of coral-red and ultraviolet pigment
diffusing through still black water, slow laminar plumes curling into von Karman vortex streets …"; *flock* — "Top-down
view … thousands of tiny glowing points of light moving together as one flock over pure black … like a starling
murmuration …".

Post: each clip is cut to an 8 s seamless loop (the last 2 s crossfade into the first), 1280 px, 24 fps, H.264
(CRF 30, faststart) and AV1 (libaom, CRF 42); posters are the frame at 4 s. Sizes: pigment 0.78 MB / 0.70 MB, flock
1.41 MB / 1.52 MB. Both are captioned on the page as generated footage, never a result.

The OG image (`og.png`) and the touch icon are renders of the site's own hero and mark (Playwright), not generated.

## fonts

Unbounded and Onest (SIL OFL 1.1, `fonts/OFL-*.txt`), from google/fonts, subset to Latin and Latin-1 with fontTools
(`pyftsubset`, woff2): 67 KB and 37 KB. Chinese falls to the system's CJK face.

## self-review (screenshots at 1440, 768, 390, 320 and reduced motion; three rounds)

Round 1 → 2: the swarm read as noise (alignment too weak, coloured by speed, which barely varies) → stronger alignment,
coloured by heading, longer trails, pre-warmed so the first frame is already a flock; the bar collided with content
→ it fills as the page scrolls (scroll-driven); the verbs list overflowed at 390 → wraps; the "Step" control showed
without reduced motion → fixed. Round 2 → 3: the describe phase left the right half empty → a ghost arm; the prompt
clipped at 320 (a grid column sized to the input's intrinsic width) → `minmax(0, 1fr)`.

| criterion | score |
|---|---|
| art direction | 8 |
| brand specificity | 8 |
| product expression | 9 — the hero and the scroll scene are the product running |
| interaction | 8 |
| technical quality | 8 — LCP 1.06 s at 390 px with 4× CPU and ~1.6 Mb/s, CLS 0.03, 195 KB of JS uncompressed |
| craft | 7 — the joint traces are honest but flat for the short pick run |

Average 8.0, nothing below 7.

## what is not done

- The traces lane spans each joint's whole range, so a short move draws a nearly flat line; a zoomed lane with the
  limit band drawn at scale would read better.
