/**
 * The bench in the page: the description's text, the picture, the run's playback (index.html § the lab).
 *
 * The description is JSON: the machine, every joint's start angle (radians), the tool point to reach (millimetres) and
 * what the gripper holds (grams). `bench.js` reads it and computes the whole run; this file draws the run, plays it
 * back at real speed and states the result. Nothing is sent anywhere.
 */
import { createBench, PRESETS } from './bench.js';
import { forward, robotState, stepRobot } from '../engine/sim-robots.js';
import { palette, projector, drawArm, drawTraces } from './draw.js';

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
const tracesCanvas = document.getElementById('traces');
const tctx = tracesCanvas?.getContext('2d');
const scene = document.getElementById('scene');
const hud = document.getElementById('hud');
const statusEl = document.getElementById('status');
const runBtn = document.getElementById('run');
const stepBtn = document.getElementById('step');
const resetBtn = document.getElementById('reset');
const colour = palette();
// The traces are drawn at the size they are shown, so their labels stay readable on a phone.
function fitTraces() {
    if (!tracesCanvas) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), w = tracesCanvas.getBoundingClientRect().width;
    if (!w) return;
    tracesCanvas.width = Math.round(w * dpr); tracesCanvas.height = Math.round(Math.min(240, Math.max(150, w * 0.3)) * dpr);
    traceScale = dpr;
}
let traceScale = 1;

const channel = await fetch(new URL('../engine/machines/so101.json', import.meta.url)).then(r => r.json());
const bench = createBench(channel);
const camera = { yaw: -0.62, pitch: 0.34 };
const project = projector(canvas, camera);
let run = null;      // the computed run, the frame shown, whether it is playing
let payload = 0;     // grams in the gripper

const mm = p => p.map(x => Math.round(x * 1000));
const mmText = p => mm(p).join(', ');

function draw(q, goal, ok, path = []) {
    drawArm(ctx, project, bench, q, { goal, ok, path, colour });
    if (tctx && run) drawTraces(tctx, bench, run.frames, { upto: run.i + 1, colour, scale: traceScale });
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

fitTraces();
addEventListener('resize', () => { fitTraces(); if (run) show(run.frames[run.i], []); });
scene.value = JSON.stringify(PRESETS.reach, null, 2);
attempt(reset)();
// The page says when the bench is ready: its machine load and the first picture are asynchronous.
document.documentElement.dataset.bench = 'ready';
