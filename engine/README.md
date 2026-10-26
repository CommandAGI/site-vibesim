# engine: CommandAGI's simulation core, copied

These files are the owner's code, copied verbatim from the CommandAGI repository at revision `289fc50180`
(2026-10-26; `pose.js` and `motion.js` were re-copied, since they had moved on from `79bf3c5b3c`) so the site can run a
simulation in the browser. Nothing here is rewritten; the relative imports are already the same shape.

| file | from |
|---|---|
| `sim-robots.js` | `packages/domain/world/sim-robots.js`: a device definition's chain as servo-driven joints |
| `pose.js` | `packages/domain/world/pose.js`: the kinematics checks and the chain's maths |
| `geometry.js`, `motion.js` | `packages/domain/world/`: what `pose.js` imports |
| `protocols/mavlink.js`, `protocols/centaur-link.js`, `protocols/printjob.js` | `packages/domain/world/protocols/`: the value tables `motion.js` imports |
| `machines/so101.json` | the `kinematics` and `dynamics` channel of `seed/global/devices/so101-follower-arm/definition.tsx` (the SO-101's published joint ranges, servo gains and limits, written by `scripts/workbench/cad/robot_dynamics.py`) |

The engine is pure: no DOM, no files, no engine. The site's `lab/lab.js` is the only code here that touches the page.

When CommandAGI's engine changes, copy the files again and update the commit above; do not edit them here.
