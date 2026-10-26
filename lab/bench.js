/**
 * The bench without a page: a description in, a run out (tests/lab.test.mjs holds it).
 *
 * The engine is CommandAGI's own simulation core, copied verbatim into engine/ (engine/README.md). `createBench` takes
 * the machine's channel — the SO-101's kinematics and dynamics — so the browser reads it from engine/machines/ and a
 * test reads the same file from disk.
 */
import { robotModel, robotState, forward, inverse, placement, stepRobot } from '../engine/sim-robots.js';

export const PRESETS = {
    reach: {
        machine: 'so101',
        start: { shoulder_pan: 0, shoulder_lift: 0.54, elbow_flex: 0, wrist_flex: 0, wrist_roll: 0, gripper: 1.74 },
        goal_mm: [80, -200, 60],
        payload_g: 0,
    },
    pick: {
        machine: 'so101',
        start: { shoulder_pan: 0, shoulder_lift: 0.54, elbow_flex: 0, wrist_flex: 0, wrist_roll: 0, gripper: 1.74 },
        goal_mm: [60, -150, 30],
        payload_g: 250,
    },
    unreachable: {
        machine: 'so101',
        start: { shoulder_pan: 0, shoulder_lift: 0.54, elbow_flex: 0, wrist_flex: 0, wrist_roll: 0, gripper: 1.74 },
        goal_mm: [0, -600, 400],
        payload_g: 0,
    },
};

const DT = 1 / 1000;
const GRAVITY = [0, 0, -9.81];
/** A goal the servos bring the tool to within this distance counts as reached. */
export const GOAL_TOLERANCE_M = 0.005;

export function createBench(channel) {
    const model = robotModel({ name: 'SO-101', channels: [channel] }, 'engine/machines/so101.json');
    const place = placement({ at: [0, 0, 0] });
    const held = grams => (grams > 0 ? fk => ({ mass: grams / 1000, at: fk.tool.p }) : null);

    /** Read a description's text; throws with a plain reason a visitor can act on. */
    function readDescription(text) {
        let d;
        try { d = JSON.parse(text); }
        catch { throw Error('the text is not JSON'); }
        if (d.machine !== 'so101') throw Error('machine must be "so101"');
        const q = model.joints.map(j => {
            const v = d.start?.[j.name];
            if (typeof v !== 'number' || !Number.isFinite(v)) throw Error(`start.${j.name} must be a number of radians`);
            if (v < j.lo || v > j.hi) throw Error(`start.${j.name} ${v} is outside ${j.lo.toFixed(2)}..${j.hi.toFixed(2)} rad`);
            return v;
        });
        if (!Array.isArray(d.goal_mm) || d.goal_mm.length !== 3 || !d.goal_mm.every(x => Number.isFinite(x)))
            throw Error('goal_mm must be [x, y, z] millimetres');
        const grams = d.payload_g ?? 0;
        if (typeof grams !== 'number' || !Number.isFinite(grams) || grams < 0) throw Error('payload_g must be a non-negative number of grams');
        return { q, goal: d.goal_mm.map(x => x / 1000), grams };
    }

    /** The whole run: the angles that reach the goal, then each servo stepped until the arm settles. */
    function simulate({ q, goal, grams }) {
        const st = robotState(model, q);
        const ik = inverse(model, st.q, place, { to: goal });
        st.target.set(ik.q);
        const load = held(grams);
        const frames = [];
        let maxTorque = 0, t = 0;
        for (let step = 0; ; step++) {
            const fk = forward(model, st.q, place);
            let torque = 0;
            for (const j of model.joints) {
                const i = j.index, tau = Math.abs(j.kp * (st.target[i] - st.q[i]) - j.kv * st.qd[i]);
                torque = Math.max(torque, Math.min(tau, j.maxTorque));
            }
            maxTorque = Math.max(maxTorque, torque);
            if (step % 5 === 0) frames.push({ t, q: Float64Array.from(st.q), tool: fk.tool.p });
            const settled = [...st.q].every((x, i) => Math.abs(x - st.target[i]) < 2e-3) && [...st.qd].every(v => Math.abs(v) < 0.02);
            if ((settled && t > 0.05) || t > 6) break;
            stepRobot(model, st, place, DT, GRAVITY, load);
            t += DT;
        }
        return { frames, reached: ik.error < GOAL_TOLERANCE_M, error: ik.error, maxTorque, seconds: t, goal };
    }

    return { model, place, readDescription, simulate };
}
