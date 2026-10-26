/**
 * The bench in the page: the description's text, the picture, the run's playback (index.html § the lab).
 *
 * The description is JSON: the machine, every joint's start angle (radians), the tool point to reach (millimetres) and
 * what the gripper holds (grams). `bench.js` reads it and computes the whole run; this file draws the run, plays it
 * back at real speed and states the result. Nothing is sent anywhere.
 */
import { createBench, PRESETS } from './bench.js';
import { forward, robotState, stepRobot, chainPoints } from '../engine/sim-robots.js';

const STRINGS = {
    en: {
        home: 'Home pose. Press Run.',
        running: 'Running…',
        reached: (mm, s, tau) => `Reached ${mm} mm in ${s} s. Largest servo torque ${tau} N·m.`,
        missed: (mm, err) => `Out of reach: the tool stopped ${err} mm short of the goal (${mm} mm at its best).`,
        bad: (why) => `The description did not load: ${why}`,
        step: (mm) => `Tool at ${mm} mm.`,
        payload: (g) => (g ? `Holding ${g} g.` : 'Gripper empty.'),
    },
    es: {
        home: 'Pose de reposo. Pulse Ejecutar.',
        running: 'Ejecutando…',
        reached: (mm, s, tau) => `Alcanzado en ${mm} mm y ${s} s. Par máximo de un servo: ${tau} N·m.`,
        missed: (mm, err) => `Fuera de alcance: la herramienta quedó a ${err} mm del objetivo (${mm} mm en su mejor punto).`,
        bad: (why) => `La descripción no se cargó: ${why}`,
        step: (mm) => `Herramienta a ${mm} mm.`,
        payload: (g) => (g ? `Sujeta ${g} g.` : 'Pinza vacía.'),
    },
    'zh-Hans': {
        home: '初始姿态。点击“运行”。',
        running: '运行中…',
        reached: (mm, s, tau) => `已到达 ${mm} 毫米处，用时 ${s} 秒。最大伺服扭矩 ${tau} N·m。`,
        missed: (mm, err) => `超出可达范围：工具停在距目标 ${err} 毫米处（最好处为 ${mm} 毫米）。`,
        bad: (why) => `描述未载入：${why}`,
        step: (mm) => `工具位于 ${mm} 毫米处。`,
        payload: (g) => (g ? `夹持 ${g} 克。` : '夹爪为空。'),
    },
};
const L = STRINGS[document.documentElement.lang] ?? STRINGS.en;

const DT = 1 / 1000;
const GRAVITY = [0, 0, -9.81];

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const scene = document.getElementById('scene');
const hud = document.getElementById('hud');
const statusEl = document.getElementById('status');
const runBtn = document.getElementById('run');
const stepBtn = document.getElementById('step');
const resetBtn = document.getElementById('reset');
const colour = (() => {
    const css = getComputedStyle(document.documentElement);
    const get = (n, fallback) => css.getPropertyValue(n).trim() || fallback;
    return { grid: get('--grid', '#1d2329'), link: get('--link', '#e8eef3'), joint: get('--joint', '#8fa3b5'), accent: get('--accent', '#2bd9c0'), miss: get('--miss', '#e2684f'), trace: get('--trace', '#2b5c55') };
})();

const channel = await fetch(new URL('../engine/machines/so101.json', import.meta.url)).then(r => r.json());
const bench = createBench(channel);
const camera = { yaw: -0.62, pitch: 0.34 };
let run = null;      // the computed run, the frame shown, whether it is playing
let payload = 0;     // grams in the gripper

const mm = p => p.map(x => Math.round(x * 1000));
const mmText = p => mm(p).join(', ');

function project(p) {
    const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
    const x1 = p[0] * cy - p[1] * sy, y1 = p[0] * sy + p[1] * cy;
    const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
    const scale = Math.min(canvas.width, canvas.height) * 2.1;
    return [canvas.width / 2 + x1 * scale, canvas.height * 0.62 - (p[2] * cp - y1 * sp) * scale];
}

function line(a, b, style, width) {
    const [ax, ay] = project(a), [bx, by] = project(b);
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
}

function dot(p, r, style) {
    const [x, y] = project(p);
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

function drawFloor() {
    for (let i = -6; i <= 6; i++) {
        const t = i * 0.05;
        line([t, -0.3, 0], [t, 0.3, 0], colour.grid, 1);
        line([-0.3, t, 0], [0.3, t, 0], colour.grid, 1);
    }
}

function drawGoal(goal, ok) {
    if (!goal) return;
    const [x, y] = project(goal);
    ctx.strokeStyle = ok ? colour.accent : colour.miss;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.moveTo(x - 14, y);
    ctx.lineTo(x + 14, y);
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x, y + 14);
    ctx.stroke();
}

/** Draw one pose: the floor, the path so far, the links, the joints, the tool point and the goal. */
function draw(q, goal, ok, path = []) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFloor();
    const fk = forward(bench.model, q, bench.place);
    const pts = chainPoints(fk, bench.model);
    for (let i = 1; i < path.length; i++) line(path[i - 1], path[i], colour.trace, 1.5);
    for (let i = 1; i < pts.length; i++) line(pts[i - 1], pts[i], colour.link, 11);
    for (let i = 1; i < pts.length - 1; i++) dot(pts[i], 6.5, colour.joint);
    dot(pts[0], 10, colour.joint);
    dot(pts.at(-1), 5, colour.accent);
    drawGoal(goal, ok);
}

function show(frame, path) {
    draw(frame.q, run?.goal ?? null, run?.reached ?? true, path);
    hud.textContent = `${L.step(mmText(frame.tool))} ${L.payload(payload)}`;
}

function compute() {
    const d = bench.readDescription(scene.value);
    payload = d.grams;
    run = { ...bench.simulate(d), i: 0, playing: false };
    return run;
}

function play() {
    run.playing = true;
    runBtn.disabled = true;
    statusEl.textContent = L.running;
    const t0 = performance.now();
    const path = [];
    const tick = () => {
        const elapsed = (performance.now() - t0) / 1000;
        while (run.i < run.frames.length - 1 && run.frames[run.i].t <= elapsed) path.push(run.frames[run.i++].tool);
        show(run.frames[run.i], path.slice(-500));
        if (run.i >= run.frames.length - 1) {
            run.playing = false;
            runBtn.disabled = false;
            statusEl.textContent = run.reached
                ? L.reached(mmText(run.frames.at(-1).tool), run.seconds.toFixed(2), run.maxTorque.toFixed(2))
                : L.missed(mmText(run.frames.at(-1).tool), Math.round(run.error * 1000));
            return;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function reset() {
    compute();
    draw(run.frames[0].q, run.goal, run.reached);
    hud.textContent = L.home;
    statusEl.textContent = '';
    runBtn.disabled = false;
}

const attempt = fn => () => { try { fn(); } catch (e) { statusEl.textContent = L.bad(e.message); } };

runBtn.addEventListener('click', attempt(() => { compute(); play(); }));
resetBtn.addEventListener('click', attempt(reset));
stepBtn.addEventListener('click', attempt(() => {
    if (!run) reset();
    if (run.i < run.frames.length - 1) {
        const upto = Math.min(run.i + 100, run.frames.length - 1);
        show(run.frames[upto], run.frames.slice(Math.max(0, upto - 500), upto).map(f => f.tool));
        run.i = upto;
        return;
    }
    // Past the end of the run: step the arm on from where it stopped, 200 ms of servo time.
    const st = robotState(bench.model, run.frames.at(-1).q);
    st.target.set(st.q);
    for (let i = 0; i < 200; i++) stepRobot(bench.model, st, bench.place, DT, GRAVITY, payload > 0 ? fk => ({ mass: payload / 1000, at: fk.tool.p }) : null);
    const fk = forward(bench.model, st.q, bench.place);
    show({ q: st.q, tool: fk.tool.p }, []);
}));
for (const b of document.querySelectorAll('[data-preset]'))
    b.addEventListener('click', attempt(() => {
        scene.value = JSON.stringify(PRESETS[b.dataset.preset], null, 2);
        reset();
    }));

// Drag the picture to turn the camera; the arm is drawn from the same angles either way.
let dragging = null;
canvas.addEventListener('pointerdown', e => { dragging = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    camera.yaw += (e.clientX - dragging.x) * 0.01;
    camera.pitch = Math.max(0.05, Math.min(1.2, camera.pitch + (e.clientY - dragging.y) * 0.006));
    dragging = { x: e.clientX, y: e.clientY };
    if (run) show(run.frames[run.i], []);
});
canvas.addEventListener('pointerup', () => { dragging = null; });

scene.value = JSON.stringify(PRESETS.reach, null, 2);
attempt(reset)();
// The page says when the bench is ready: its machine load and the first picture are asynchronous.
document.documentElement.dataset.bench = 'ready';
