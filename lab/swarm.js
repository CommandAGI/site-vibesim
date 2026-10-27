/**
 * The hero: a boids swarm, full bleed, rebuilt from the visitor's sentence (describe.js reads it). Separation,
 * alignment and cohesion over a spatial hash; the cursor (or a finger) repels or attracts when the sentence says so.
 * The readout states what was understood and the swarm's order parameter φ (1 = all heading one way, 0 = none).
 * Colour by heading. Reduced motion: the swarm settles off screen and holds one frame; Step advances it. Nothing is sent.
 */
import { describeSwarm } from './describe.js';

const canvas = document.getElementById('swarm');
const form = document.getElementById('describe');
const input = document.getElementById('sentence');
const understoodEl = document.getElementById('understood');
const phiEl = document.getElementById('phi');
const countEl = document.getElementById('count');
const stepBtn = document.getElementById('swarm-step');
const TAGS = JSON.parse(document.getElementById('swarm-strings')?.textContent ?? '{}');
const still = matchMedia('(prefers-reduced-motion: reduce)');

const ctx = canvas.getContext('2d', { alpha: false });
const INK = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#0b0e12';
// OKLCH ramps (as sRGB), slow → fast. Warm: coral and amber; cold: ultraviolet to ice; neutral: the whole spectrum.
const RAMPS = {
    '-1': ['#3b3a6e', '#5d57b0', '#7c74e0', '#a89bfa', '#c9c1ff', '#e8edf1'],
    '0': ['#a89bfa', '#6cc7f0', '#7fe0b8', '#e6d36a', '#f6a04d', '#fa674f'],
    '1': ['#6e2a22', '#a8402f', '#d9533f', '#fa674f', '#f6a04d', '#ffd9a8'],
};

let P = describeSwarm(input.value).params;
let n = 0, x, y, vx, vy, w = 0, h = 0, dpr = 1;
const pointer = { x: -1e9, y: -1e9, active: false };

function size() {
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width * dpr)); h = Math.max(1, Math.round(r.height * dpr));
    canvas.width = w; canvas.height = h;
}

function seed() {
    // Fewer agents on small screens: the same density, not the same number.
    const area = (w * h) / (dpr * dpr) / (1440 * 900);
    n = Math.max(40, Math.round(P.count * Math.min(1, 0.35 + area * 0.65)));
    x = new Float32Array(n); y = new Float32Array(n); vx = new Float32Array(n); vy = new Float32Array(n);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
        x[i] = rnd() * w; y[i] = rnd() * h;
        const a = rnd() * Math.PI * 2;
        vx[i] = Math.cos(a); vy[i] = Math.sin(a);
    }
    countEl.textContent = n.toLocaleString(document.documentElement.lang);
}

const cell = 40;
let head, next;
function step() {
    const R = 34 * dpr, R2 = R * R, sep2 = (10 * dpr) ** 2;
    const cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1;
    if (!head || head.length < cols * rows) head = new Int32Array(cols * rows);
    if (!next || next.length < n) next = new Int32Array(n);
    head.fill(-1);
    for (let i = 0; i < n; i++) {
        const c = Math.min(cols - 1, Math.max(0, (x[i] / cell) | 0)) + Math.min(rows - 1, Math.max(0, (y[i] / cell) | 0)) * cols;
        next[i] = head[c]; head[c] = i;
    }
    const vmax = 1.6 * dpr * P.speed, vmin = 0.5 * dpr * P.speed;
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < n; i++) {
        let ax = 0, ay = 0, cxs = 0, cys = 0, sx = 0, sy = 0, k = 0;
        const gx = (x[i] / cell) | 0, gy = (y[i] / cell) | 0;
        for (let oy = -1; oy <= 1; oy++)
            for (let ox = -1; ox <= 1; ox++) {
                const qx = gx + ox, qy = gy + oy;
                if (qx < 0 || qy < 0 || qx >= cols || qy >= rows) continue;
                for (let j = head[qx + qy * cols]; j !== -1; j = next[j]) {
                    if (j === i) continue;
                    const dx = x[j] - x[i], dy = y[j] - y[i], d2 = dx * dx + dy * dy;
                    if (d2 > R2) continue;
                    ax += vx[j]; ay += vy[j]; cxs += dx; cys += dy; k++;
                    if (d2 < sep2) { sx -= dx / (d2 + 1); sy -= dy / (d2 + 1); }
                }
            }
        let fx = 0, fy = 0;
        if (k) {
            fx += (ax / k - vx[i]) * 0.12 + (cxs / k) * 0.0016 * P.cohesion;
            fy += (ay / k - vy[i]) * 0.12 + (cys / k) * 0.0016 * P.cohesion;
        }
        fx += sx * 1.4 * P.separation * dpr; fy += sy * 1.4 * P.separation * dpr;
        if (P.cursor && pointer.active) {
            const dx = x[i] - pointer.x, dy = y[i] - pointer.y, d2 = dx * dx + dy * dy, reach = (150 * dpr) ** 2;
            if (d2 < reach) { const f = (-P.cursor * (1 - d2 / reach) * 0.35) / Math.sqrt(d2 + 1); fx += dx * f; fy += dy * f; }
        }
        if (P.swirl) { const dx = x[i] - cx, dy = y[i] - cy, d = Math.hypot(dx, dy) + 1; fx += (-dy / d) * 0.04 - dx * 0.00004; fy += (dx / d) * 0.04 - dy * 0.00004; }
        if (P.wind) fx += 0.025 * dpr;
        vx[i] += fx; vy[i] += fy;
        const v = Math.hypot(vx[i], vy[i]) || 1, c = Math.min(vmax, Math.max(vmin, v)) / v;
        vx[i] *= c; vy[i] *= c;
        x[i] += vx[i]; y[i] += vy[i];
        if (x[i] < 0) x[i] += w; else if (x[i] >= w) x[i] -= w;
        if (y[i] < 0) y[i] += h; else if (y[i] >= h) y[i] -= h;
    }
}

// Colour by heading: a flock that agrees on a direction shows as one band of the ramp.
function render(fade = 0.1) {
    ctx.globalAlpha = fade;
    ctx.fillStyle = INK; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    const ramp = RAMPS[String(P.warmth)];
    ctx.lineWidth = 1.5 * dpr; ctx.lineCap = 'round';
    // One path per colour: six strokes a frame, whatever the count.
    for (let b = 0; b < ramp.length; b++) {
        ctx.strokeStyle = ramp[b];
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const bin = Math.min(ramp.length - 1, Math.floor(((Math.atan2(vy[i], vx[i]) + Math.PI) / (2 * Math.PI)) * ramp.length));
            if (bin !== b) continue;
            ctx.moveTo(x[i], y[i]); ctx.lineTo(x[i] - vx[i] * 5, y[i] - vy[i] * 5);
        }
        ctx.stroke();
    }
}

function order() {
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { const v = Math.hypot(vx[i], vy[i]) || 1; sx += vx[i] / v; sy += vy[i] / v; }
    return Math.hypot(sx, sy) / n;
}

let visible = true, frame = 0, raf = 0;
function loop() {
    raf = 0;
    if (!visible || document.hidden || still.matches) return;
    step(); render();
    if (++frame % 15 === 0) phiEl.textContent = order().toFixed(2);
    raf = requestAnimationFrame(loop);
}
const start = () => { if (!raf && !still.matches) raf = requestAnimationFrame(loop); };

function hold(steps) {
    for (let i = 0; i < steps; i++) step();
    ctx.fillStyle = INK; ctx.fillRect(0, 0, w, h);
    render(1);
    phiEl.textContent = order().toFixed(2);
}

function instantiate() {
    const d = describeSwarm(input.value);
    P = d.params;
    seed();
    for (let i = 0; i < 90; i++) step(); // the first frame is already a flock, not noise
    const words = d.understood.map(t => TAGS[t] ?? t);
    understoodEl.textContent = words.length ? words.join(' · ') : (TAGS['(nothing)'] ?? 'nothing I know: the defaults');
    still.matches ? hold(240) : start();
}

form.addEventListener('submit', e => { e.preventDefault(); instantiate(); });
stepBtn?.addEventListener('click', () => hold(60));
still.addEventListener('change', () => (still.matches ? hold(0) : start()));
canvas.parentElement.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    pointer.x = (e.clientX - r.left) * dpr; pointer.y = (e.clientY - r.top) * dpr; pointer.active = true;
});
canvas.parentElement.addEventListener('pointerleave', () => { pointer.active = false; });
new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }).observe(canvas);
document.addEventListener('visibilitychange', start);
let resizeTimer = 0;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { size(); seed(); if (still.matches) hold(240); }, 150); });

size();
instantiate();
document.documentElement.dataset.swarm = 'ready';
