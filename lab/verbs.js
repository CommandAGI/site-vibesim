/**
 * The four verbs, scrubbed by scroll: describe (the description's lines light), instantiate (the arm's links draw in
 * with their joint-range arcs), simulate (the pick-and-place run plays at the scroll's rate), inspect (the joint traces
 * build against their limit bands). It is the bench's own run of the "pick" preset, computed once in this tab.
 * Reduced motion: the scene shows its last state, all four verbs at once, and does not follow the scroll.
 */
import { createBench, PRESETS } from './bench.js';
import { palette, projector, drawArm, drawTraces } from './draw.js';

const section = document.getElementById('verbs');
const arm = document.getElementById('verbs-arm');
const traces = document.getElementById('verbs-traces');
const code = document.getElementById('verbs-code');
const verbs = [...section.querySelectorAll('[data-verb]')];
const still = matchMedia('(prefers-reduced-motion: reduce)');

const channel = await fetch(new URL('../engine/machines/so101.json', import.meta.url)).then(r => r.json());
const bench = createBench(channel);
const description = PRESETS.pick;
const run = bench.simulate(bench.readDescription(JSON.stringify(description)));
const colour = palette();
const camera = { yaw: -0.5, pitch: 0.3 };
const project = projector(arm, camera, 3.1, 0.78);

// The description's text, one element per line, so "describe" can light them in order.
const lines = JSON.stringify(description, null, 2).split('\n');
code.replaceChildren(...lines.map(l => Object.assign(document.createElement('span'), { textContent: `${l}\n` })));
const spans = [...code.children];

function fit(c) {
    const r = c.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
    return dpr;
}
let dpr = 1;
const ease = u => u * u * (3 - 2 * u);

function paint(p) {
    const k = Math.min(3, Math.floor(p * 4)), u = Math.min(1, p * 4 - k);
    verbs.forEach((v, i) => v.toggleAttribute('data-on', i <= k));
    section.dataset.phase = ['describe', 'instantiate', 'simulate', 'inspect'][k];
    const lit = k === 0 ? Math.ceil(ease(u) * spans.length) : spans.length;
    spans.forEach((s, i) => s.classList.toggle('lit', i < lit));
    const n = bench.model.joints.length + 1;
    const links = k === 0 ? 0 : k === 1 ? Math.ceil(ease(u) * n) : Infinity;
    const i = k < 2 ? 0 : k === 2 ? Math.round(ease(u) * (run.frames.length - 1)) : run.frames.length - 1;
    const path = run.frames.slice(0, i + 1).map(f => f.tool);
    // Before "instantiate" the arm is a ghost: the description names it, nothing is built yet.
    const shown = k === 0 ? { ...colour, link: colour.grid, joint: colour.grid, accent: colour.grid } : colour;
    drawArm(arm.getContext('2d'), project, bench, run.frames[i].q, { goal: k >= 1 ? run.goal : null, ok: run.reached, path, colour: shown, links: k === 0 ? Infinity : links, ranges: k === 1, scale: dpr });
    const upto = k < 3 ? (k === 2 ? i + 1 : 0) : run.frames.length;
    drawTraces(traces.getContext('2d'), bench, run.frames, { upto, colour, scale: dpr });
}

function progress() {
    const r = section.getBoundingClientRect();
    return Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
}

let queued = false;
const onScroll = () => {
    if (still.matches || queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paint(progress()); });
};
function layout() {
    dpr = fit(arm); fit(traces);
    section.classList.toggle('verbs--still', still.matches);
    paint(still.matches ? 1 : progress());
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', layout);
still.addEventListener('change', layout);
layout();
