/**
 * Robots in a simulation (docs/formats.md § simulation robots). A scene's `robots` place device definitions as
 * articulated chains: `{ id, device: <ref to a definition.tsx>, at: [x, y, z] m, yaw?: rad, joints: { <name>: rad } }`.
 * The engine simulates only what the definition declares: a channel with `kinematics` (the chain: pose.js) and
 * `dynamics` (each joint's range, its position servo's gains and limits, each link's mass, inertia and convex collision
 * pieces;
 * written from the maker's published model by scripts/workbench/cad/robot_dynamics.py). A definition that declares no
 * dynamics is not simulated, and the engine says so: it never invents a machine.
 *
 * Joint angles are the chain's own (a URDF joint's angle, radians), the same angle pose.js poses a chain by. Each joint
 * is a position servo: torque = clamp(kp·(target − q) − kv·q̇, ±max torque), less its damping and friction loss, plus
 * the torque gravity puts on what it carries; it accelerates its own effective inertia (armature, and the links beyond
 * it about its axis). The joints are not coupled to each other beyond that (no Coriolis or cross inertia terms): a
 * servo-driven arm moving at its rated speeds. A joint stops at the ends of its range. The engine steps it in substeps
 * short enough for the servo's stiffness, so a scene with the same commands steps the same way every time.
 *
 * Pure: matrices and numbers. The engine (runtime/adapters/sim-engine.js) poses the links in the rigid-body world.
 */
import { checkKinematics, jointAngle } from './pose.js';
const finite = x => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
export const ROBOT_FIELDS = ['id', 'device', 'at', 'yaw', 'joints'];
const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** 3×3 row-major helpers (arrays of 9). */
const mul = (A, B) => [0, 1, 2].flatMap(i => [0, 1, 2].map(j => A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]));
const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
const tr = A => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
function axisOf(a) {
    const v = typeof a === 'string' ? AXES[a] : a, n = Math.hypot(...(v ?? []));
    if (!v || !(n > 0))
        throw Error(`axis must be x, y, z or a vector, not ${JSON.stringify(a)}`);
    return v.map(x => x / n);
}
/** Rotation about a unit axis by t (Rodrigues). */
export function axisAngle([x, y, z], t) {
    const c = Math.cos(t), s = Math.sin(t), k = 1 - c;
    return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
}
/** URDF rpy (degrees): Rz(yaw)·Ry(pitch)·Rx(roll). */
function rpy(r) {
    if (r === undefined || r === null)
        return I3();
    return mul(mul(axisAngle([0, 0, 1], r[2] * RAD), axisAngle([0, 1, 0], r[1] * RAD)), axisAngle([1, 0, 0], r[0] * RAD));
}
const mm = v => (v ?? [0, 0, 0]).map(x => x / 1000);
/** A rotation matrix as a quaternion [x, y, z, w]. */
export function quatOf(R) {
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = R, t = m00 + m11 + m22;
    let x, y, z, w;
    if (t > 0) {
        const s = Math.sqrt(t + 1) * 2;
        w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
    }
    else if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
        w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s;
    }
    else if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
        w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s;
    }
    else {
        const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
        w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4;
    }
    return [x, y, z, w];
}
/** A quaternion [x, y, z, w] as a rotation matrix. */
export function matrixOf([x, y, z, w]) {
    const n = Math.hypot(x, y, z, w) || 1;
    x /= n; y /= n; z /= n; w /= n;
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
const JOINT_DYN = ['range_rad', 'kp', 'kv', 'damping', 'friction', 'armature', 'max_torque_nm', 'max_velocity_rad_s'];
/**
 * The simulated machine a definition declares (see the top), or a refusal naming what it lacks. `where` names it in
 * messages (its address). → { address, name, joints: [{ name, index, origin, R0, axis, parent, lo, hi, kp, kv, damping,
 * friction, armature, maxTorque, maxVelocity, home? }], chain: count of chain joints, gripper, links, base, tip }
 */
export function robotModel(definition, where = 'device') {
    const channel = (definition?.channels ?? []).find(c => c?.kinematics && c?.dynamics);
    if (!channel)
        throw Error(`${where}: no channel declares kinematics and dynamics, so it is not simulated (docs/formats.md § simulation robots)`);
    const k = channel.kinematics, d = channel.dynamics, problems = checkKinematics(k, channel.joints ?? null);
    if (problems.length)
        throw Error(`${where}: ${problems.join('; ')}`);
    if (!d.joints || typeof d.joints !== 'object')
        throw Error(`${where}: dynamics.joints must give each joint's range and servo`);
    const dynOf = name => {
        const j = d.joints[name];
        if (!j)
            throw Error(`${where}: dynamics declares no joint ${name}, so it is not simulated`);
        for (const f of JOINT_DYN)
            if (j[f] === undefined)
                throw Error(`${where}: joint ${name} declares no ${f}, so it is not simulated`);
        if (!(Array.isArray(j.range_rad) && j.range_rad.length === 2 && j.range_rad.every(finite) && j.range_rad[0] < j.range_rad[1]))
            throw Error(`${where}: joint ${name}: range_rad must be [low, high] radians`);
        for (const f of ['kp', 'max_torque_nm', 'max_velocity_rad_s', 'armature'])
            if (!(finite(j[f]) && j[f] > 0))
                throw Error(`${where}: joint ${name}: ${f} must be a positive number`);
        for (const f of ['kv', 'damping', 'friction'])
            if (!(finite(j[f]) && j[f] >= 0))
                throw Error(`${where}: joint ${name}: ${f} must be a non-negative number`);
        return { lo: j.range_rad[0], hi: j.range_rad[1], kp: j.kp, kv: j.kv, damping: j.damping, friction: j.friction, armature: j.armature, maxTorque: j.max_torque_nm, maxVelocity: j.max_velocity_rad_s };
    };
    const joints = k.links.map((l, i) => ({ name: l.joint, index: i, origin: mm(l.origin_mm), R0: rpy(l.rpy_deg), axis: axisOf(l.axis), offset: mm(l.offset_mm), parent: i - 1, ...dynOf(l.joint) }));
    const chain = joints.length;
    let gripper = null;
    if (d.gripper) {
        const g = d.gripper, after = joints.findIndex(j => j.name === g.after);
        if (after < 0)
            throw Error(`${where}: dynamics.gripper.after must name a joint of the chain`);
        if (joints.some(j => j.name === g.joint))
            throw Error(`${where}: the gripper's joint ${g.joint} is not a joint of the chain`);
        const jd = dynOf(g.joint);
        for (const f of ['closed_rad', 'open_rad'])
            if (!(finite(g[f]) && g[f] >= jd.lo && g[f] <= jd.hi))
                throw Error(`${where}: dynamics.gripper.${f} must be in the gripper joint's range`);
        joints.push({ name: g.joint, index: chain, origin: mm(g.origin_mm), R0: rpy(g.rpy_deg), axis: axisOf(g.axis), offset: [0, 0, 0], parent: after, ...jd });
        gripper = { index: chain, closed: g.closed_rad, open: g.open_rad, carrier: after };
    }
    const links = (d.links ?? []).map((l, i) => {
        const j = joints.findIndex(x => x.name === l.after);
        if (j < 0)
            throw Error(`${where}: dynamics.links[${i}].after must name a joint`);
        if (!(finite(l.mass_kg) && l.mass_kg > 0))
            throw Error(`${where}: dynamics.links[${i}]: mass_kg must be positive`);
        if (!(Array.isArray(l.com_mm) && l.com_mm.length === 3 && l.com_mm.every(finite)))
            throw Error(`${where}: dynamics.links[${i}]: com_mm must be [x, y, z]`);
        if (!(Array.isArray(l.inertia_kg_m2) && l.inertia_kg_m2.length === 6 && l.inertia_kg_m2.every(finite)))
            throw Error(`${where}: dynamics.links[${i}]: inertia_kg_m2 must be [ixx, iyy, izz, ixy, ixz, iyz]`);
        const hulls = (l.hulls_mm ?? []).map(h => h.map(p => mm(p)));
        if (!hulls.every(h => h.length >= 4 && h.every(p => p.length === 3 && p.every(finite))))
            throw Error(`${where}: dynamics.links[${i}]: each of hulls_mm is at least 4 points [x, y, z]`);
        const [ixx, iyy, izz, ixy, ixz, iyz] = l.inertia_kg_m2;
        return { joint: j, mass: l.mass_kg, com: mm(l.com_mm), inertia: [ixx, ixy, ixz, ixy, iyy, iyz, ixz, iyz, izz], hulls };
    });
    if (!links.length)
        throw Error(`${where}: dynamics.links lists no link, so nothing moves`);
    return { address: where, name: definition.name ?? where, joints, chain, gripper, links, base: { p: mm(k.base_mm), R: rpy(k.base_rpy_deg) }, tip: mm(k.tip_mm), source: d.source ?? null };
}
/**
 * The robot entry of a scene, checked against its machine: every joint named once with an angle in range, nothing
 * else. → { id, at, yaw, q: Float64Array }.
 */
export function placeRobot(entry, model) {
    const names = model.joints.map(j => j.name), given = Object.keys(entry.joints ?? {});
    for (const n of given)
        if (!names.includes(n))
            throw Error(`robot ${entry.id}: ${model.name} has no joint ${n} (its joints: ${names.join(', ')})`);
    const q = new Float64Array(names.length);
    model.joints.forEach((j, i) => {
        const v = entry.joints?.[j.name];
        if (!finite(v))
            throw Error(`robot ${entry.id}: joints.${j.name} (radians) is required: a scene gives every joint its starting angle`);
        if (v < j.lo || v > j.hi)
            throw Error(`robot ${entry.id}: joints.${j.name} ${v} is outside ${j.lo}..${j.hi}`);
        q[i] = v;
    });
    return { id: entry.id, at: entry.at, yaw: entry.yaw ?? 0, q };
}
/** Where the robot's model frame is in the world: at `at`, turned by `yaw` about z. */
export const placement = ({ at, yaw = 0 }) => ({ p: [...at], R: axisAngle([0, 0, 1], yaw) });
/**
 * Forward kinematics: each joint's frame after it turns ({ p, R }, world), each joint's axis and origin in the world (for
 * the Jacobian), and the tool point and frame. `q` in joint order (the chain, then the gripper).
 */
export function forward(model, q, place) {
    const P = place.R, base = { p: add(place.p, mv(P, model.base.p)), R: mul(P, model.base.R) };
    const frames = new Array(model.joints.length), axes = new Array(model.joints.length), origins = new Array(model.joints.length);
    for (const j of model.joints) {
        const parent = j.parent < 0 ? base : frames[j.parent], o = add(parent.p, mv(parent.R, j.origin)), Rf = mul(parent.R, j.R0);
        axes[j.index] = mv(Rf, j.axis);
        origins[j.index] = o;
        const R = mul(Rf, axisAngle(j.axis, q[j.index]));
        frames[j.index] = { p: add(o, mv(R, j.offset)), R };
    }
    const last = frames[model.chain - 1], tool = { p: add(last.p, mv(last.R, model.tip)), R: last.R };
    return { base, frames, axes, origins, tool };
}
/** Points a chain is drawn by (world, metres): the base, each chain joint, the tool point. */
export function chainPoints(fk, model) { return [fk.base.p, ...fk.frames.slice(0, model.chain).map(f => f.p), fk.tool.p]; }
/** Whether joint j moves link (or point) carried by joint c: c is j or after it in the chain. */
function carries(model, j, c) {
    for (let x = c; x >= 0; x = model.joints[x].parent)
        if (x === j)
            return true;
    return false;
}
/**
 * The torque gravity puts on each joint, and each joint's effective inertia about its axis, from the links it carries
 * (and a held load: { mass, at } world point carried by the gripper's carrier).
 */
export function loads(model, fk, gravity, held = null) {
    const n = model.joints.length, tau = new Float64Array(n), inertia = new Float64Array(n);
    const masses = model.links.map(l => { const f = fk.frames[l.joint]; return { joint: l.joint, mass: l.mass, c: add(f.p, mv(f.R, l.com)), I: mul(mul(f.R, l.inertia), tr(f.R)) }; });
    if (held)
        masses.push({ joint: model.gripper?.carrier ?? model.chain - 1, mass: held.mass, c: held.at, I: [0, 0, 0, 0, 0, 0, 0, 0, 0] });
    for (const j of model.joints) {
        const z = fk.axes[j.index], o = fk.origins[j.index];
        let t = 0, I = j.armature;
        for (const m of masses) {
            if (!carries(model, j.index, m.joint))
                continue;
            const r = sub(m.c, o);
            t += dot(z, cross(r, scale(gravity, m.mass)));
            const perp = cross(z, r);
            I += m.mass * dot(perp, perp) + dot(z, mv(m.I, z));
        }
        tau[j.index] = t;
        inertia[j.index] = I;
    }
    return { tau, inertia };
}
/** The substeps a step of `dt` seconds takes so that the stiffest servo stays stable (ω·dt ≤ 0.25). */
export function substepsFor(model, dt) {
    const w = Math.max(...model.joints.map(j => Math.sqrt(j.kp / j.armature)));
    return Math.max(1, Math.ceil(dt * w / 0.25));
}
/**
 * One step of `dt` seconds of a robot's joints toward their targets (see the top). `state`: { q, qd, target, stopAt }
 * (Float64Arrays; stopAt[j] a hard stop a grasped body puts on the gripper, NaN for none; `limp`: true while its
 * torque is off); `held`: the load it carries.
 * Mutates the state.
 */
export function stepRobot(model, state, place, dt, gravity, held = null, substeps = substepsFor(model, dt)) {
    const h = dt / substeps, { q, qd, target, stopAt } = state;
    for (let s = 0; s < substeps; s++) {
        const fk = forward(model, q, place), { tau: tg, inertia } = loads(model, fk, gravity, held && held(fk));
        for (const j of model.joints) {
            const i = j.index;
            // A robot whose torque is off (`limp`) has no servo: only gravity, damping and friction act on its joints.
            let servo = state.limp ? 0 : j.kp * (target[i] - q[i]) - j.kv * qd[i];
            if (servo > j.maxTorque)
                servo = j.maxTorque;
            else if (servo < -j.maxTorque)
                servo = -j.maxTorque;
            const t0 = servo - j.damping * qd[i] + tg[i];
            // Friction loss: a joint at rest stays at rest under less than it; a moving one loses it against its
            // motion, and friction alone never turns it the other way.
            let v;
            if (qd[i] === 0) {
                if (Math.abs(t0) <= j.friction)
                    continue;
                v = h * (t0 - Math.sign(t0) * j.friction) / inertia[i];
            }
            else {
                v = qd[i] + h * (t0 - Math.sign(qd[i]) * j.friction) / inertia[i];
                if (Math.sign(v) !== Math.sign(qd[i]) && Math.abs(t0) <= j.friction)
                    v = 0;
            }
            if (v > j.maxVelocity)
                v = j.maxVelocity;
            else if (v < -j.maxVelocity)
                v = -j.maxVelocity;
            let x = q[i] + h * v;
            const lo = j.lo, hi = j.hi, stop = stopAt[i];
            if (!Number.isNaN(stop)) {
                // A grasped body stops the jaw where it closed on it.
                const closing = model.gripper && i === model.gripper.index ? Math.sign(model.gripper.closed - stop) : 0;
                if (closing && Math.sign(x - stop) === closing) {
                    x = stop;
                    v = 0;
                }
            }
            if (x < lo) {
                x = lo;
                v = Math.max(0, v);
            }
            else if (x > hi) {
                x = hi;
                v = Math.min(0, v);
            }
            q[i] = x;
            qd[i] = v;
        }
    }
}
/** A new state at `q` (its targets the same angles: the robot holds where it starts). */
export function robotState(model, q) {
    const n = model.joints.length;
    return { q: Float64Array.from(q), qd: new Float64Array(n), target: Float64Array.from(q), stopAt: new Float64Array(n).fill(NaN) };
}
/**
 * The chain's angles that put the tool point at `to` (world, metres), and its frame's `axis` (an axis of the tool frame,
 * 'x' | 'y' | 'z', with a sign: '-z') along `along` (world) when given: damped least squares over the chain's joints
 * from `seed`, kept in their ranges. → { q, error (m), angle (rad, 0 without `along`), iterations }. The gripper's
 * angle is kept as it is.
 */
export function inverse(model, seed, place, { to, axis = null, along = null, iterations = 300, damping = 0.02, tolerance = 1e-4 } = {}) {
    const q = Float64Array.from(seed), n = model.chain, wantDir = axis && along ? { s: axis.startsWith('-') ? -1 : 1, k: 'xyz'.indexOf(axis.replace('-', '')), v: (() => { const m = Math.hypot(...along); return along.map(x => x / m); })() } : null;
    if (wantDir && wantDir.k < 0)
        throw Error(`axis is x, y or z (with a sign), not ${axis}`);
    let err = Infinity, ang = 0, it = 0;
    for (; it < iterations; it++) {
        const fk = forward(model, q, place), e = sub(to, fk.tool.p);
        const rows = [e[0], e[1], e[2]], J = [];
        let dirErr = null;
        if (wantDir) {
            const cur = scale([fk.tool.R[wantDir.k], fk.tool.R[3 + wantDir.k], fk.tool.R[6 + wantDir.k]], wantDir.s);
            dirErr = cross(cur, wantDir.v);
            ang = Math.atan2(Math.hypot(...dirErr), dot(cur, wantDir.v));
            // Orientation weighs a radian like 10 cm: a position error of millimetres is not traded for degrees.
            rows.push(dirErr[0] * 0.1, dirErr[1] * 0.1, dirErr[2] * 0.1);
        }
        err = Math.hypot(...e);
        if (err < tolerance && (!wantDir || ang < 1e-3))
            break;
        for (let c = 0; c < n; c++) {
            const z = fk.axes[c], col = cross(z, sub(fk.tool.p, fk.origins[c]));
            J.push(wantDir ? [...col, ...scale(z, 0.1)] : col);
        }
        // Δq = Jᵀ (J Jᵀ + λ² I)⁻¹ e
        const m = rows.length, A = Array.from({ length: m }, (_, r) => Array.from({ length: m }, (_, s) => { let x = r === s ? damping * damping : 0; for (let c = 0; c < n; c++)
            x += J[c][r] * J[c][s]; return x; }));
        const y = solve(A, rows);
        for (let c = 0; c < n; c++) {
            let dq = 0;
            for (let r = 0; r < m; r++)
                dq += J[c][r] * y[r];
            const j = model.joints[c];
            q[c] = Math.min(j.hi, Math.max(j.lo, q[c] + dq));
        }
    }
    return { q, error: err, angle: ang, iterations: it };
}
/** Gaussian elimination with partial pivoting (small dense systems). */
function solve(A, b) {
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++)
            if (Math.abs(M[r][c]) > Math.abs(M[p][c]))
                p = r;
        [M[c], M[p]] = [M[p], M[c]];
        const d = M[c][c] || 1e-12;
        for (let r = c + 1; r < n; r++) {
            const f = M[r][c] / d;
            for (let k = c; k <= n; k++)
                M[r][k] -= f * M[c][k];
        }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
        let s = M[r][n];
        for (let k = r + 1; k < n; k++)
            s -= M[r][k] * x[k];
        x[r] = s / (M[r][r] || 1e-12);
    }
    return x;
}
/** The fields a robot records per frame (world/sim.js simLayout): each joint's q, q̇ and target, the tool's pose, what it holds. */
export const robotFields = joints => [...joints.flatMap(n => [`${n}.q`, `${n}.qd`, `${n}.target`]), 'tool.x', 'tool.y', 'tool.z', 'tool.qx', 'tool.qy', 'tool.qz', 'tool.qw', 'held'];
/**
 * The pose a definition declares as its home: each chain joint at its channel's `home` value (pose.js jointAngle: the
 * angle the chain is at there), the gripper open. → { <joint>: radians }, or a refusal when a joint declares no home.
 */
export function homeJoints(definition, model) {
    const channel = (definition?.channels ?? []).find(c => c?.kinematics && c?.dynamics), k = channel.kinematics, out = {};
    for (const [i, link] of k.links.entries()) {
        const joint = (channel.joints ?? []).find(j => j.name === link.joint), raw = Number(k.angle?.per_turn) > 0 ? joint?.home : 0;
        const t = jointAngle(link, raw, { angle: k.angle ?? {}, joint: joint ?? {} });
        if (t === null)
            throw Error(`${model.address}: joint ${link.joint} declares no home, so a robot of it needs its joints given`);
        const j = model.joints[i];
        if (t < j.lo || t > j.hi)
            throw Error(`${model.address}: joint ${link.joint}'s home (${t} rad) is outside its range ${j.lo}..${j.hi}`);
        out[link.joint] = t;
    }
    if (model.gripper)
        out[model.joints[model.gripper.index].name] = model.gripper.open;
    return out;
}
