/**
 * Drawing the arm and its joint traces on a 2D canvas: the bench (lab.js) and the four-verb scene (verbs.js) draw the
 * same run the same way. The picture is a projection of the engine's own forward kinematics; nothing here is computed
 * twice or approximated, except the joint-range arcs, whose span is the joint's real range and whose orientation is
 * the screen's.
 */
import { forward, chainPoints } from '../engine/sim-robots.js';

export function palette() {
    const css = getComputedStyle(document.documentElement);
    const get = (n, fallback) => css.getPropertyValue(n).trim() || fallback;
    return {
        grid: get('--grid', '#1a2028'), link: get('--paper', '#e8edf1'), joint: get('--dim', '#95a1ad'),
        accent: get('--coral', '#fa674f'), uv: get('--uv', '#a89bfa'), trace: get('--uv', '#a89bfa'),
        miss: get('--coral', '#fa674f'), dim: get('--dim', '#95a1ad'),
        spectral: ['#fa674f', '#f6a04d', '#e6d36a', '#7fe0b8', '#6cc7f0', '#a89bfa'],
    };
}

export function projector(canvas, camera, zoom = 2.1, floorAt = 0.62) {
    return p => {
        const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
        const x1 = p[0] * cy - p[1] * sy, y1 = p[0] * sy + p[1] * cy;
        const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
        const scale = Math.min(canvas.width, canvas.height) * zoom;
        return [canvas.width / 2 + x1 * scale, canvas.height * floorAt - (p[2] * cp - y1 * sp) * scale];
    };
}

/**
 * One pose: the floor, the path so far, the links, the joints, the tool point and the goal.
 * `links` draws only the first n links (the scene's "instantiate"); `ranges` adds each joint's range arc.
 */
export function drawArm(ctx, project, bench, q, { goal = null, ok = true, path = [], colour, links = Infinity, ranges = false, scale = 1 } = {}) {
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    const line = (a, b, style, w) => {
        const [ax, ay] = project(a), [bx, by] = project(b);
        ctx.strokeStyle = style; ctx.lineWidth = w * scale;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    };
    const dot = (p, r, style) => {
        const [x, y] = project(p);
        ctx.fillStyle = style; ctx.beginPath(); ctx.arc(x, y, r * scale, 0, Math.PI * 2); ctx.fill();
    };
    for (let i = -6; i <= 6; i++) {
        const t = i * 0.05;
        line([t, -0.3, 0], [t, 0.3, 0], colour.grid, 1);
        line([-0.3, t, 0], [0.3, t, 0], colour.grid, 1);
    }
    const fk = forward(bench.model, q, bench.place);
    const pts = chainPoints(fk, bench.model);
    ctx.lineCap = 'round';
    for (let i = 1; i < path.length; i++) line(path[i - 1], path[i], colour.trace, 1.5);
    const n = Math.min(pts.length - 1, links);
    for (let i = 1; i <= n; i++) line(pts[i - 1], pts[i], colour.link, 11);
    if (ranges)
        bench.model.joints.slice(0, n).forEach((j, i) => {
            const [x, y] = project(pts[Math.min(i, pts.length - 1)]);
            const r = (22 + i * 5) * scale, mid = -Math.PI / 2 + (q[j.index] ?? 0);
            ctx.strokeStyle = colour.spectral[i % colour.spectral.length]; ctx.lineWidth = 1.5 * scale;
            ctx.beginPath(); ctx.arc(x, y, r, mid - (q[j.index] - j.lo), mid + (j.hi - q[j.index])); ctx.stroke();
        });
    for (let i = 1; i < Math.min(pts.length - 1, n + 1); i++) dot(pts[i], 6.5, colour.joint);
    dot(pts[0], 10, colour.joint);
    if (n >= pts.length - 1) dot(pts.at(-1), 5, colour.accent);
    if (goal) {
        const [x, y] = project(goal);
        ctx.strokeStyle = ok ? colour.accent : colour.miss; ctx.lineWidth = 1.6 * scale;
        ctx.beginPath();
        ctx.arc(x, y, 9 * scale, 0, Math.PI * 2);
        ctx.moveTo(x - 14 * scale, y); ctx.lineTo(x + 14 * scale, y);
        ctx.moveTo(x, y - 14 * scale); ctx.lineTo(x, y + 14 * scale);
        ctx.stroke();
    }
}

/**
 * Each joint's angle over the run, one lane per joint, its band the joint's whole range [lo, hi]: a trace touching a
 * lane's edge is a joint at its limit. Frames past `upto` are not drawn yet.
 */
export function drawTraces(ctx, bench, frames, { upto = frames.length, colour, scale = 1, labels = true } = {}) {
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    const joints = bench.model.joints;
    const pad = 6 * scale, left = labels ? 92 * scale : pad, lane = (height - pad * 2) / joints.length;
    const tEnd = Math.max(frames.at(-1)?.t ?? 1, 0.5);
    ctx.font = `${11 * scale}px Onest, Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    joints.forEach((j, k) => {
        const top = pad + k * lane, h = lane - 4 * scale;
        ctx.strokeStyle = colour.grid; ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + 0.5, width - left - pad, h);
        if (labels) { ctx.fillStyle = colour.dim; ctx.fillText(j.name.replace('_', ' '), pad, top + h / 2); }
        ctx.strokeStyle = colour.spectral[k % colour.spectral.length]; ctx.lineWidth = 1.6 * scale;
        ctx.beginPath();
        for (let i = 0; i < Math.min(upto, frames.length); i++) {
            const f = frames[i];
            const x = left + (f.t / tEnd) * (width - left - pad);
            const y = top + h - ((f.q[j.index] - j.lo) / (j.hi - j.lo)) * h;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
    });
}
