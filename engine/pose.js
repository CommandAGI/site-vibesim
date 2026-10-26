/**
 * Posing units from their streams (docs/worlds-and-runs.md; the 3D view's live and replayed state). Pure: no DOM.
 *
 * This module poses only what the records honestly show:
 *   tool      a channel that declares `tool: { origin_mm, sign? }` (where machine zero is in the model's frame, and
 *             which axes run backwards) and whose folded state carries x, y, z puts a tool marker there;
 *   joints    a servo-bus channel's folded joint positions, against the declared joint ranges;
 *   skeleton  a channel that declares `kinematics` (below) and whose state carries every chained joint's value: the
 *             view draws its kinematic chain, one bar per link, posed by forward kinematics from those values.
 * A unit's model without `links` is one rigid mesh (in the pose of its published CAD), so the view draws the chain over it.
 * An unknown state poses nothing: the last values before it are not current, and the view does not draw them.
 * A world's link may carry a model part on a unit's frame (`frame`, modelPose) instead of driving it by a joint.
 *
 *   "kinematics": { "base_mm": [x, y, z],                   where the chain's base frame sits, in the model's frame
 *                   "base_rpy_deg"?: [r, p, y],             how that frame is turned in the model's frame
 *                   "angle": { "per_turn": 4096 } | { "units": "deg" | "rad" },   what a joint value is
 *                   "links": [{ "joint": "<name>", "origin_mm"?: [x, y, z], "rpy_deg"?: [r, p, y],
 *                               "axis": "x" | "y" | "z" | [x, y, z], "sign"?: ±1, "zero_deg"?: n,
 *                               "offset_mm"?: [x, y, z] }, …],
 *                   "tip_mm"?: [x, y, z],                   the tool point, in the last joint's frame after it turns
 *                   "source"?: { … }, "verified"?: "none" | … }   where the numbers come from; what was measured
 * Each link is one joint: move by `origin_mm` and turn by the fixed `rpy_deg` in the frame before it (a URDF joint's
 * `<origin xyz rpy>`; a modified-DH row's a and alpha), turn by the joint's angle about `axis`, then move by
 * `offset_mm` in the turned frame (a DH row's d). The view draws a point after each link, and at `tip_mm`. rpy is URDF's:
 * fixed-axis roll about x, then pitch about y, then yaw about z (R = Rz·Ry·Rx).
 * A raw servo value turns by (value − that joint's `home`) · 360° / per_turn; `zero_deg` is the angle at that value.
 *
 *   nodes     a definition that declares `links` (below) has its model's named nodes moved as rigid bodies: each
 *             linked node by forward kinematics of the joint values its tree binds, from one or several channels.
 * A definition's `links` is a tree over its model's nodes (docs/devices.md § links):
 *   "links": [{ "node": "<GLB node name>", "parent"?: "<node>",
 *               "joint"?: { "channel": "<channel id>", "name": "<that channel's joint>", "type": "revolute" | "prismatic",
 *                           "axis": "x" | "y" | "z" | [x, y, z], "origin_mm"?: [x, y, z], "home": n,
 *                           "per_turn"?: n | "per_mm"?: n | "units"?: "deg" | "rad" | "mm" | "m",
 *                           "sign"?: ±1, "zero"?: n } }, …]
 * The axis and origin are in the model's frame, as the model is drawn (its nodes at their joints' `home`, in degrees
 * or mm): a screw axis, so no node hierarchy in the file is needed. A joint's position is
 * zero + sign · (what its channel value is: raw steps around the channel joint's `home` · 360 / per_turn, or
 * · 1 / per_mm; else the value in `units`, default degrees or mm); its node turns by (position − home) about the axis
 * through origin_mm, or moves by it along the axis, after its parent's motion. A joint with no value stays as drawn.
 * Each channel's values are its records folded by its format (motion.js foldMotion), so a link binds to a servo joint,
 * a machine axis (`x` of gcode-chat, linuxcnc-rsh or print-job), a MAVLink servo output or a leg joint alike.
 *   joint without channel   not driven: the joint is declared (its axis is known) but no record moves it
 *   joint.rate              { units: rpm | deg/s | rad/s | mm/s, scale?, offset? }: the channel value is a rate, and the
 *                           joint moves by its travel since the run's first value (motion.js rateTravel)
 *   emit                    { channel, name, color, min?, max?, off? } or a list: the node glows by that value
 *   root (the definition's) the unit's body moves by position and attitude values (motion.js rootTransform)
 */
import { box, mesh } from './geometry.js';
import { foldMotion, motionNames, rateTravel, rootTransform, emitGlow, checkEmit, RATE_UNIT_NAMES } from './motion.js';
const rotate = ([x, y, z], r) => { const c = Math.cos(r), s = Math.sin(r); return [x * c - y * s, x * s + y * c, z]; };
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
/** 3×3 rotation about a unit axis by t radians (Rodrigues), row-major. */
function rotation(axis, t) {
    const a = typeof axis === 'string' ? AXES[axis] : axis, n = Math.hypot(...(a ?? []));
    if (!a || !(n > 0))
        throw Error(`kinematics: axis must be x, y, z or a vector, not ${JSON.stringify(axis)}`);
    const [x, y, z] = a.map(v => v / n), c = Math.cos(t), s = Math.sin(t), k = 1 - c;
    return [[c + x * x * k, x * y * k - z * s, x * z * k + y * s], [y * x * k + z * s, c + y * y * k, y * z * k - x * s], [z * x * k - y * s, z * y * k + x * s, c + z * z * k]];
}
const matMul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const apply = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const RAD = Math.PI / 180;
/** A fixed URDF rotation (roll, pitch, yaw in degrees): Rz(yaw)·Ry(pitch)·Rx(roll); identity when absent. */
function rpyMatrix(rpy) {
    if (rpy === undefined || rpy === null)
        return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    if (!Array.isArray(rpy) || rpy.length !== 3 || !rpy.every(Number.isFinite))
        throw Error(`kinematics: rpy_deg must be [roll, pitch, yaw] in degrees, not ${JSON.stringify(rpy)}`);
    return matMul(matMul(rotation('z', rpy[2] * RAD), rotation('y', rpy[1] * RAD)), rotation('x', rpy[0] * RAD));
}
const vec3 = (v, what) => {
    if (v === undefined || v === null)
        return [0, 0, 0];
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite))
        throw Error(`kinematics: ${what} must be [x, y, z] in mm, not ${JSON.stringify(v)}`);
    return v;
};
/**
 * The problems with a declared chain (an empty list when it is well formed): each link names a joint of the channel
 * (when the channel lists joints), axes and vectors are well formed, and a raw-step angle has joints with a home.
 */
export function checkKinematics(kinematics, joints = null) {
    const problems = [];
    if (!kinematics || typeof kinematics !== 'object')
        return ['kinematics must be an object'];
    if (!Array.isArray(kinematics.links) || !kinematics.links.length)
        problems.push('kinematics.links must list at least one joint');
    const angle = kinematics.angle ?? {};
    if (!(Number(angle.per_turn) > 0) && !['deg', 'rad'].includes(angle.units))
        problems.push('kinematics.angle must be { per_turn } or { units: "deg" | "rad" }');
    const probe = (fn, where) => { try {
        fn();
    }
    catch (e) {
        problems.push(`${where}: ${e.message}`);
    } };
    probe(() => vec3(kinematics.base_mm ?? [0, 0, 0], 'base_mm'), 'base_mm');
    probe(() => rpyMatrix(kinematics.base_rpy_deg), 'base_rpy_deg');
    probe(() => vec3(kinematics.tip_mm, 'tip_mm'), 'tip_mm');
    for (const [i, link] of (kinematics.links ?? []).entries()) {
        const where = `links[${i}] (${link?.joint ?? '?'})`;
        if (typeof link?.joint !== 'string' || !link.joint)
            problems.push(`${where}: joint must name a joint`);
        else if (Array.isArray(joints) && !joints.some(j => j.name === link.joint))
            problems.push(`${where}: the channel has no joint ${link.joint}`);
        else if (Number(angle.per_turn) > 0 && Array.isArray(joints) && !Number.isFinite(joints.find(j => j.name === link.joint)?.home))
            problems.push(`${where}: a raw-step angle needs the joint's home`);
        probe(() => rotation(link?.axis, 0), where);
        probe(() => rpyMatrix(link?.rpy_deg), where);
        probe(() => vec3(link?.origin_mm, 'origin_mm'), where);
        probe(() => vec3(link?.offset_mm, 'offset_mm'), where);
        if (link?.sign !== undefined && link.sign !== 1 && link.sign !== -1)
            problems.push(`${where}: sign must be 1 or -1`);
        if (link?.zero_deg !== undefined && !Number.isFinite(link.zero_deg))
            problems.push(`${where}: zero_deg must be a number`);
    }
    return problems;
}
/** A joint's angle in radians from its channel value (see the header), or null when the value is not a number. */
export function jointAngle(link, value, { angle = {}, joint = {} } = {}) {
    if (!Number.isFinite(value))
        return null;
    const sign = link.sign === -1 ? -1 : 1, zero = Number.isFinite(link.zero_deg) ? link.zero_deg : 0;
    const deg = Number(angle.per_turn) > 0 ? (value - (Number.isFinite(joint.home) ? joint.home : 0)) * 360 / angle.per_turn : angle.units === 'rad' ? value * 180 / Math.PI : value;
    return (zero + sign * deg) * Math.PI / 180;
}
/** The channel value at which a joint is at `rad` radians: jointAngle's inverse, or null when `rad` is not a number. */
export function jointValue(link, rad, { angle = {}, joint = {} } = {}) {
    if (!Number.isFinite(rad))
        return null;
    const sign = link.sign === -1 ? -1 : 1, zero = Number.isFinite(link.zero_deg) ? link.zero_deg : 0;
    const deg = (rad * 180 / Math.PI - zero) / sign;
    return Number(angle.per_turn) > 0 ? (Number.isFinite(joint.home) ? joint.home : 0) + deg * angle.per_turn / 360 : angle.units === 'rad' ? deg * Math.PI / 180 : deg;
}
/** The one walk of a chain: the points [base, after link 1, …] and the frame at its end, or null (see chainPoints). */
function walkChain(kinematics, values, joints = []) {
    const links = kinematics?.links;
    if (!Array.isArray(links) || !links.length)
        return null;
    let R = rpyMatrix(kinematics.base_rpy_deg), p = (kinematics.base_mm ?? [0, 0, 0]).map(Number);
    const points = [p], move = v => { const d = apply(R, vec3(v, 'offset').map(Number)); p = p.map((x, i) => x + d[i]); };
    for (const link of links) {
        const t = jointAngle(link, values?.[link.joint], { angle: kinematics.angle ?? {}, joint: joints.find(j => j.name === link.joint) ?? {} });
        if (t === null)
            return null;
        move(link.origin_mm);
        R = matMul(matMul(R, rpyMatrix(link.rpy_deg)), rotation(link.axis, t));
        move(link.offset_mm);
        points.push(p);
    }
    if (kinematics.tip_mm) {
        move(kinematics.tip_mm);
        points.push(p);
    }
    return points.every(q => q.every(Number.isFinite)) ? { points, R, p } : null;
}
/**
 * Forward kinematics of a declared chain from joint values ({ name: value }): the points [base, after link 1, …] in
 * the model's frame (mm), or null when a chained joint has no value (then the view draws nothing: a guess is not a pose).
 */
export function chainPoints(kinematics, values, joints = []) {
    return walkChain(kinematics, values, joints)?.points ?? null;
}
/**
 * Where the end of a chain is and how it is turned: the tool frame a part rides on (the flange of an arm), as
 * { R, p } in the model's frame. Null when a chained joint has no value: a frame with no pose places nothing.
 */
export function chainFrame(kinematics, values, joints = []) {
    const w = walkChain(kinematics, values, joints);
    return w ? { R: w.R, p: w.p } : null;
}
/**
 * Which way each chained joint moves the tool point at a pose (docs/realtime-agents.md § robots): the words a joint
 * needs whose meaning depends on the pose (a lift raises the tip in one pose and lowers it in another). At `values`,
 * each chained joint moves one `step` toward each end of its range, as the channel's `joints` declare them, and the
 * tool point's move is said as up or down, forward or back along the arm's reach at the pose, left or right of it
 * (the same left as the pan's declared words: up x forward).
 * → { base, tip, forward, left, step, joints: [{ joint, value, low, high, toward: { min: way, max: way } }] }, or null
 * when a chained joint has no value (no pose, no words). `forward` (the reach at the pose) and `left` are the two
 * horizontal unit directions a word is about. A `way` is { words: ['up', …], mm, steps }, or { atEnd: true } for a
 * joint already at that end of its range. Derived from the declared chain: nothing here was measured on a machine.
 */
export function tipWays(kinematics, values, joints = [], { step = 100 } = {}) {
    const points = chainPoints(kinematics, values, joints);
    if (!points)
        return null;
    const base = points[0], tip = points.at(-1);
    const [rx, ry] = [tip[0] - base[0], tip[1] - base[1]], reach = Math.hypot(rx, ry);
    const forward = reach > 1e-6 ? [rx / reach, ry / reach] : [1, 0], left = [-forward[1], forward[0]];
    const tipAt = v => chainPoints(kinematics, v, joints)?.at(-1) ?? null;
    const said = d => {
        const mm = Math.hypot(...d), up = d[2], along = d[0] * forward[0] + d[1] * forward[1], side = d[0] * left[0] + d[1] * left[1];
        const most = Math.max(Math.abs(up), Math.abs(along), Math.abs(side));
        const words = [];
        // A move at least half as big as the largest one is said too: a lift usually raises the tip and pulls it back.
        // Below 2 mm a joint only jostles the tip (a roll about the tool's own axis), so it gets no direction.
        if (mm >= 2) {
            if (Math.abs(up) >= 0.5 * most) words.push(up > 0 ? 'up' : 'down');
            if (Math.abs(along) >= 0.5 * most) words.push(along > 0 ? 'forward' : 'back');
            if (Math.abs(side) >= 0.5 * most) words.push(side > 0 ? 'left' : 'right');
        }
        return { words, mm: Math.round(mm * 10) / 10 };
    };
    return {
        base, tip, forward, left, step,
        joints: (kinematics.links ?? []).map(link => {
            const declared = joints.find(j => j.name === link.joint) ?? {}, value = values[link.joint];
            const low = Number.isFinite(declared.min) ? declared.min : value - step, high = Number.isFinite(declared.max) ? declared.max : value + step;
            const clamped = v => Math.min(Math.max(v, low), high), way = v => {
                if (v === value)
                    return { atEnd: true };
                const p = tipAt({ ...values, [link.joint]: v });
                return p ? { ...said([p[0] - tip[0], p[1] - tip[1], p[2] - tip[2]]), steps: Math.abs(v - value) } : { words: [], mm: 0, steps: 0 };
            };
            return { joint: link.joint, value, low, high, toward: { min: way(clamped(value - step)), max: way(clamped(value + step)) } };
        }),
    };
}
const JOINT_TYPES = ['revolute', 'prismatic'];
const FRAME_POINTS = ['tip', 'tool'];
/**
 * The problems with a link that rides on a unit's frame (empty when it is well formed), given the channels its ids name
 * (`<unit>/<channel>`): the world's link grammar for a part that is carried by a unit rather than by the model (the
 * gripper on the arm's flange). The frame is the part's parent, so it has no `parent`, and a joint does not drive it.
 */
function checkFrameLink(l, channels) {
    const f = l.frame, problems = [];
    const probe = (fn, where) => { try {
        fn();
    }
    catch (e) {
        problems.push(`${where}: ${e.message.replace(/^kinematics: /, '')}`);
    } };
    if (!f || typeof f !== 'object' || Array.isArray(f))
        return ['frame must name the unit and channel whose frame the part rides on'];
    if (l.joint !== undefined)
        problems.push('a part is driven by a joint or rides on a unit\'s frame, not both');
    if (l.parent !== undefined)
        problems.push('a part on a unit\'s frame has no parent link: the frame is its parent');
    if (typeof f.unit !== 'string' || !f.unit)
        problems.push('frame.unit must name the unit whose frame the part rides on');
    if (typeof f.channel !== 'string' || !f.channel)
        problems.push('frame.channel must name the channel whose frame the part rides on');
    if (!FRAME_POINTS.includes(f.at))
        problems.push('frame.at must be tip (the end of the channel\'s kinematic chain) or tool (its tool point)');
    probe(() => rpyMatrix(f.rpy_deg), 'frame.rpy_deg');
    probe(() => vec3(f.offset_mm, 'frame.offset_mm'), 'frame.offset_mm');
    // A world's links are checked joined (`<unit>/<channel>`) and a definition's unjoined: a message says the channel
    // as the link names it.
    const named = typeof f.channel === 'string' && typeof f.unit === 'string' && f.channel.startsWith(`${f.unit}/`) ? f.channel.slice(f.unit.length + 1) : f.channel;
    const c = typeof f.unit === 'string' && typeof named === 'string' ? channels.find(x => x.id === `${f.unit}/${named}`) : null;
    if (c && f.at === 'tip' && !Array.isArray(c.kinematics?.links))
        problems.push(`channel ${named} declares no kinematics: it has no tip to ride on`);
    if (c && f.at === 'tool' && !c.tool)
        problems.push(`channel ${named} declares no tool point`);
    return problems;
}
const IDENTITY = () => ({ R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], p: [0, 0, 0] });
/**
 * The problems with a definition's `links` (an empty list when it is well formed): every link names a node once, its
 * parent is a link, the parents form a tree, and every joint is well formed and names a value its channel records
 * (a joint it lists, or a name of its format: motion.js motionNames). `nodes` (a Set of the model's node names), when
 * given, must hold every linked node.
 */
export function checkLinks(links, channels = [], nodes = null) {
    if (!Array.isArray(links) || !links.length)
        return ['links must list at least one link'];
    const problems = [], byNode = new Map();
    const probe = (fn, where) => { try {
        fn();
    }
    catch (e) {
        problems.push(`${where}: ${e.message.replace(/^kinematics: /, '')}`);
    } };
    for (const [i, l] of links.entries()) {
        if (typeof l?.node !== 'string' || !l.node) {
            problems.push(`links[${i}]: node must name a node of the model`);
            continue;
        }
        if (byNode.has(l.node))
            problems.push(`links[${i}]: node ${l.node} is listed twice`);
        byNode.set(l.node, l);
        if (nodes && !nodes.has(l.node))
            problems.push(`link ${l.node}: the model has no node ${l.node}`);
    }
    for (const l of byNode.values()) {
        const where = `link ${l.node}`;
        if (l.parent !== undefined && !byNode.has(l.parent))
            problems.push(`${where}: parent ${l.parent} is not a link`);
        for (let seen = new Set([l.node]), at = byNode.get(l.parent); at; at = byNode.get(at.parent)) {
            if (seen.has(at.node)) {
                problems.push(`${where}: its parents form a loop`);
                break;
            }
            seen.add(at.node);
        }
        if (l.emit !== undefined)
            problems.push(...checkEmit(l.emit, channels).map(p => `${where}: ${p}`));
        if (l.frame !== undefined)
            problems.push(...checkFrameLink(l, channels).map(p => `${where}: ${p}`));
        const j = l.joint;
        if (j === undefined)
            continue;
        if (!j || typeof j !== 'object') {
            problems.push(`${where}: joint must be an object`);
            continue;
        }
        const channel = channels.find(c => c.id === j.channel), cj = channel?.joints?.find?.(x => x.name === j.name), known = channel ? motionNames(channel) : null;
        if (j.channel === undefined) {
            if (j.name !== undefined || j.rate !== undefined)
                problems.push(`${where}: a joint that no channel drives names no value and no rate`);
        }
        else if (!channel)
            problems.push(`${where}: joint names channel ${j.channel}, which the definition does not declare`);
        else if (typeof j.name !== 'string' || (known && !known.includes(j.name)))
            problems.push(`${where}: channel ${j.channel} ${channel.joints?.length ? 'has no joint' : 'records no value'} ${j.name}`);
        if (j.rate !== undefined) {
            if (!RATE_UNIT_NAMES.includes(j.rate?.units) || (j.rate.units === 'mm/s') !== (j.type === 'prismatic'))
                problems.push(`${where}: rate.units must be ${j.type === 'prismatic' ? 'mm/s' : 'rpm, deg/s or rad/s'}`);
            for (const k of ['scale', 'offset'])
                if (j.rate?.[k] !== undefined && !Number.isFinite(j.rate[k]))
                    problems.push(`${where}: rate.${k} must be a number`);
            for (const k of ['per_turn', 'per_mm', 'units', 'zero'])
                if (j[k] !== undefined)
                    problems.push(`${where}: a rate joint takes no ${k}`);
        }
        if (!JOINT_TYPES.includes(j.type))
            problems.push(`${where}: joint type must be revolute or prismatic`);
        probe(() => rotation(j.axis, 0), where);
        probe(() => vec3(j.origin_mm, 'origin_mm'), where);
        if (!Number.isFinite(j.home))
            problems.push(`${where}: joint home (the position the model is drawn at) must be a number`);
        if (j.sign !== undefined && j.sign !== 1 && j.sign !== -1)
            problems.push(`${where}: sign must be 1 or -1`);
        if (j.zero !== undefined && !Number.isFinite(j.zero))
            problems.push(`${where}: zero must be a number`);
        const revolute = j.type === 'revolute', step = revolute ? 'per_turn' : 'per_mm';
        if (j[revolute ? 'per_mm' : 'per_turn'] !== undefined)
            problems.push(`${where}: a ${j.type} joint takes ${step}, not ${revolute ? 'per_mm' : 'per_turn'}`);
        if (j[step] !== undefined && !(j[step] > 0))
            problems.push(`${where}: ${step} must be positive`);
        if (j[step] !== undefined && cj && !Number.isFinite(cj.home))
            problems.push(`${where}: raw steps need the channel joint's home`);
        if (j.units !== undefined && !(revolute ? ['deg', 'rad'] : ['mm', 'm']).includes(j.units))
            problems.push(`${where}: units must be ${revolute ? 'deg or rad' : 'mm or m'}`);
    }
    return problems;
}
/** A linked joint's position (degrees or mm) from its channel value (see the header), or null without a number. */
export function jointPosition(joint, value, channelJoint = {}) {
    if (!Number.isFinite(value))
        return null;
    const sign = joint.sign === -1 ? -1 : 1, zero = Number.isFinite(joint.zero) ? joint.zero : 0, home = Number.isFinite(channelJoint.home) ? channelJoint.home : 0;
    const raw = joint.per_turn > 0 ? (value - home) * 360 / joint.per_turn : joint.per_mm > 0 ? (value - home) / joint.per_mm : joint.units === 'rad' ? value * 180 / Math.PI : joint.units === 'm' ? value * 1000 : value;
    return zero + sign * raw;
}
/**
 * Forward kinematics of a link tree: every linked node's rigid motion from the pose it is drawn in, in the model's
 * frame (mm): Map(node -> { R: 3×3 rows, p: [x, y, z] }), x' = R·x + p. `values` is { channel id: { joint: value } };
 * `channels` gives the channel joints' `home` for raw steps; `travel` is { 'channel.name': degrees or mm } for rate
 * joints (rateTravel). Also which joints were posed, which stayed as drawn for want of a value (held), which moved by
 * a rate (spun), which no channel drives (undriven), and each emitting node's glow: Map(node -> [r, g, b]).
 * `frames` (Map(node -> { R, p })) gives the node that rides on a unit's frame its place from that unit's own pose;
 * a node without an entry stays as drawn (that unit's state is not known), and its children with it.
 */
export function linkTransforms(links, values = {}, channels = [], { travel = {}, frames = null } = {}) {
    const byNode = new Map(links.map(l => [l.node, l])), out = new Map(), posed = [], held = [], spun = [], undriven = [], glow = new Map();
    const solve = node => {
        if (out.has(node))
            return out.get(node);
        const l = byNode.get(node), j = l.joint;
        // A part that rides on a unit's frame takes its place from that unit's pose, in the frame the model is drawn in;
        // without one (no state, or a unit not named) it stays where the model draws it, and so do its children.
        if (l.frame !== undefined) {
            const given = frames?.get(node), m = given ?? IDENTITY();
            (given ? posed : held).push(`${l.frame.channel}@${l.frame.at}`);
            out.set(node, m);
            return m;
        }
        const parent = l.parent !== undefined ? solve(l.parent) : IDENTITY();
        let local = IDENTITY();
        if (j) {
            const cj = channels.find(c => c.id === j.channel)?.joints?.find(x => x.name === j.name) ?? {}, key = `${j.channel}.${j.name}`;
            const q = j.channel === undefined ? null : j.rate ? (Number.isFinite(travel[key]) ? j.home + (j.sign === -1 ? -1 : 1) * travel[key] : null) : jointPosition(j, values?.[j.channel]?.[j.name], cj);
            (j.channel === undefined ? undriven : q === null ? held : j.rate ? spun : posed).push(j.channel === undefined ? node : key);
            if (q !== null) {
                const d = q - j.home, a = typeof j.axis === 'string' ? AXES[j.axis] : j.axis, n = Math.hypot(...a);
                if (j.type === 'prismatic')
                    local = { R: IDENTITY().R, p: a.map(v => v / n * d) };
                else {
                    const R = rotation(j.axis, d * RAD), o = vec3(j.origin_mm, 'origin_mm'), Ro = apply(R, o);
                    local = { R, p: o.map((v, i) => v - Ro[i]) };
                }
            }
        }
        const pp = apply(parent.R, local.p), m = { R: matMul(parent.R, local.R), p: pp.map((v, i) => v + parent.p[i]) };
        out.set(node, m);
        return m;
    };
    for (const l of links) {
        solve(l.node);
        const g = l.emit ? emitGlow(l.emit, values) : null;
        if (g)
            glow.set(l.node, g);
    }
    return { nodes: out, posed, held, spun, undriven, glow };
}
const compose = (A, B) => ({ R: matMul(A.R, B.R), p: apply(A.R, B.p).map((v, i) => v + A.p[i]) });
/**
 * Meshes named by node moved by `nodes` (linkTransforms): positions by R·x + p, normals by R; others unchanged. A
 * `root` ({ R, p }, rootTransform) then moves every mesh: the body carries its parts.
 */
export function poseNodes(meshes, nodes, root = null) {
    return meshes.map(m => {
        const N0 = nodes?.get(m.name), T = root ? compose(root, N0 ?? IDENTITY()) : N0;
        if (!T)
            return m;
        const { R, p } = T, P = m.positions, N = m.normals, q = new Array(P.length), n = new Array(N.length);
        for (let i = 0; i < P.length; i += 3) {
            const x = P[i], y = P[i + 1], z = P[i + 2], a = N[i], b = N[i + 1], c = N[i + 2];
            for (let k = 0; k < 3; k++) {
                q[i + k] = R[k][0] * x + R[k][1] * y + R[k][2] * z + p[k];
                n[i + k] = R[k][0] * a + R[k][1] * b + R[k][2] * c;
            }
        }
        return { ...m, positions: q, normals: n };
    });
}
/**
 * A unit's pose at time t (ms) from its channels' records.
 *   unit: { uid, position, rotation }, channels: its channels (channelsOf), recordsOf(channelId) -> records | null,
 *   motion: the definition's { links?, root? }
 * -> { tool: { channel, at: [x, y, z] world mm, machine: {x, y, z}, status, since } | null,
 *      joints: { channel, status, since, units, joints: [{ name, value, min, max, frac, gripper }] } | null,
 *      skeleton: { channel, points: [[x, y, z] world mm], status, since } | null,
 *      nodes: linkTransforms' result (nodes in the model's frame, posed, held, spun, undriven, glow) | null,
 *      root: { channel, R, p, status, since } in the model's frame | null (no root, or its values are not known),
 *      frames: { [channel id]: { at: 'tool' | 'tip', R, p, status, since } } in the world,
 *      unknown: [channel ids whose state is unknown at t] }
 * Each channel's values are folded by its format (motion.js foldMotion). A joint whose channel has no known state stays
 * as the model is drawn; a root without its values leaves the unit at its placement. The tool and the chain move with
 * the root. `frames` is where a part rides on this unit (a world's link with a `frame`): the tool point of a `tool`
 * channel, and the end of a declared chain with how it is turned (chainFrame).
 */
export function unitPose(unit, channels, recordsOf, t, { links = null, root = null, frames = null } = {}) {
    let tool = null, joints = null, skeleton = null, body = null;
    const frameOf = {};
    const unknown = [], values = {}, folded = {}, bound = new Set([...(links ?? []).flatMap(l => [l.joint?.channel, ...[l.emit ?? []].flat().map(e => e.channel)]), root?.channel].filter(Boolean));
    for (const c of channels) {
        const records = recordsOf(c.id);
        if (!records?.length)
            continue;
        const wantsTool = !!c.tool, wantsJoints = c.format === 'servo-bus' && Array.isArray(c.joints), wantsChain = Array.isArray(c.kinematics?.links);
        if (!wantsTool && !wantsJoints && !wantsChain && !bound.has(c.id))
            continue;
        const st = foldMotion(c, records, t);
        if (st.status === 'unknown') {
            unknown.push(c.id);
            continue;
        }
        values[c.id] = st.values;
        folded[c.id] = st;
    }
    if (root && folded[root.channel]) {
        const T = rootTransform(root, values[root.channel]);
        if (T)
            body = { channel: root.channel, ...T, status: folded[root.channel].status, since: folded[root.channel].at };
    }
    const place = q => placePoint(unit, body, q);
    // A frame's place and turning in the world: the body's and the placement's motion on the model's own frame.
    const placed = at => F => {
        const R = matMul(rotation('z', unit.rotation ?? 0), matMul(body?.R ?? IDENTITY().R, F.R));
        return { at, R, p: place(F.p) };
    };
    for (const c of channels) {
        const st = folded[c.id], v = st?.values;
        if (!st)
            continue;
        if (c.tool && !tool && ['x', 'y', 'z'].every(k => Number.isFinite(v[k]))) {
            const sign = c.tool.sign ?? [1, 1, 1], local = c.tool.origin_mm.map((o, i) => o + sign[i] * v['xyz'[i]]);
            tool = { channel: c.id, at: place(local), machine: { x: v.x, y: v.y, z: v.z }, status: st.status, since: st.at };
            frameOf[c.id] = { ...placed('tool')({ R: IDENTITY().R, p: local }), status: st.status, since: st.at };
        }
        if (c.format === 'servo-bus' && Array.isArray(c.joints) && !joints) {
            const list = c.joints.filter(j => Number.isFinite(v[j.name])).map(j => ({ name: j.name, value: v[j.name], min: j.min, max: j.max, gripper: !!j.gripper, frac: Number.isFinite(j.min) && Number.isFinite(j.max) && j.max > j.min ? Math.max(0, Math.min(1, (v[j.name] - j.min) / (j.max - j.min))) : null }));
            if (list.length)
                joints = { channel: c.id, status: st.status, since: st.at, units: c.units ?? null, joints: list };
        }
        if (Array.isArray(c.kinematics?.links) && !skeleton) {
            const local = chainPoints(c.kinematics, v, c.joints ?? []);
            if (local)
                skeleton = { channel: c.id, points: local.map(place), status: st.status, since: st.at };
            const frame = chainFrame(c.kinematics, v, c.joints ?? []);
            if (frame)
                frameOf[c.id] = { ...placed('tip')(frame), status: st.status, since: st.at };
        }
    }
    const travel = {};
    for (const j of (links ?? []).map(l => l.joint).filter(j => j?.rate && folded[j.channel])) {
        const d = rateTravel(channels.find(c => c.id === j.channel), recordsOf(j.channel), j.name, t, j.rate);
        if (d !== null)
            travel[`${j.channel}.${j.name}`] = d;
    }
    return { tool, joints, skeleton, frames: frameOf, nodes: links?.length ? linkTransforms(links, values, channels, { travel, frames }) : null, root: body, unknown };
}
/** A point of a unit's model frame in the world: the root's body motion (`body`: { R, p } or null), then the placement. */
export const placePoint = (unit, body, q) => rotate(body ? apply(body.R, q).map((v, i) => v + body.p[i]) : q, unit.rotation ?? 0).map((p, i) => p + (unit.position?.[i] ?? 0));
/**
 * The point that shows where a unit's moving part is at t, in the world (mm), or null when nothing of it moves or its
 * state is unknown: its tool point, else the tip of its kinematic chain, else the centre of its deepest driven linked
 * node (`centroids`: Map(node -> the centre of that node's mesh in the model's frame)), else its body's origin.
 */
export function movingPoint(unit, channels, recordsOf, t, { links = null, root = null, centroids = null } = {}) {
    const p = unitPose(unit, channels, recordsOf, t, { links, root });
    if (p.tool)
        return p.tool.at;
    if (p.skeleton?.points?.length)
        return p.skeleton.points.at(-1);
    if (p.nodes?.posed.length && centroids?.size) {
        const parents = new Map((links ?? []).map(l => [l.node, l.parent])), depth = n => { let d = 0; for (let x = n; parents.get(x) !== undefined && d < 64; x = parents.get(x)) d++; return d; };
        const driven = (links ?? []).filter(l => l.joint?.channel && centroids.has(l.node) && p.nodes.nodes.has(l.node)).sort((a, b) => depth(b.node) - depth(a.node))[0];
        if (driven) {
            const N = p.nodes.nodes.get(driven.node), c = centroids.get(driven.node);
            return placePoint(unit, p.root, apply(N.R, c).map((v, i) => v + N.p[i]));
        }
    }
    if (p.root)
        return placePoint(unit, p.root, root?.origin_mm ?? [0, 0, 0]);
    return null;
}
/**
 * Where a unit's moving part went from `from` to `to` (ms), sampled at the moments its records change (at most `max`
 * of them, evenly chosen): [[point, …], …], one list per stretch of known state. A moment whose state is unknown ends
 * a stretch: a path never bridges what the records do not show. A part that did not move has no path ([]).
 */
export function sweptPath(unit, channels, recordsOf, from, to, opts = {}, { max = 240 } = {}) {
    const times = new Set([from, to]);
    for (const c of channels)
        for (const r of recordsOf(c.id) ?? []) {
            const t = Date.parse(r.t);
            if (r.kind === 'state' && t > from && t < to)
                times.add(t);
        }
    let list = [...times].sort((a, b) => a - b);
    if (list.length > max)
        list = Array.from({ length: max }, (_, i) => list[Math.round(i * (list.length - 1) / (max - 1))]);
    const out = [];
    let run = [];
    for (const t of list) {
        const q = movingPoint(unit, channels, recordsOf, t, opts);
        if (!q) {
            if (run.length > 1)
                out.push(run);
            run = [];
            continue;
        }
        if (!run.length || Math.hypot(...q.map((v, i) => v - run.at(-1)[i])) > 1e-3)
            run.push(q);
    }
    if (run.length > 1)
        out.push(run);
    return out;
}
/**
 * A drawn path (sweptPath's stretches) as overlay meshes: square bars `width` mm thick, tagged with the unit id. `dash`
 * (mm): drawn and left out in turn, that long each (a sketch's path under the path that ran).
 */
export function pathMarkers(stretches, uid, { width = 6, color = [1, .55, .12], dash = 0 } = {}) {
    const out = [];
    for (const run of stretches) {
        let along = 0;
        for (let i = 1; i < run.length; i++) {
            const a = run[i - 1], b = run[i], len = Math.hypot(...b.map((v, k) => v - a[k]));
            if (!(len > 1e-6))
                continue;
            if (!(dash > 0)) {
                const m = bar(a, b, width, color);
                if (m)
                    out.push(m);
                continue;
            }
            // Split the segment at the dash boundaries; draw the pieces that fall in an "on" stretch.
            for (let s = 0; s < len;) {
                const phase = (along + s) % (2 * dash), on = phase < dash, step = Math.min(len - s, (on ? dash : 2 * dash) - phase);
                if (on) {
                    const p = s / len, q = (s + step) / len, m = bar(a.map((v, k) => v + (b[k] - v) * p), a.map((v, k) => v + (b[k] - v) * q), width, color);
                    if (m)
                        out.push(m);
                }
                s += Math.max(step, 1e-6);
            }
            along += len;
        }
    }
    return out.map(m => ({ ...m, id: uid, material: { name: 'plastic-light' }, marker: true }));
}
/** One square bar from a to b (a link of a drawn chain), `w` mm thick. */
function bar(a, b, w, color) {
    const d = b.map((x, i) => x - a[i]), len = Math.hypot(...d);
    if (!(len > 1e-6))
        return null;
    const u = d.map(x => x / len), ref = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const s = cross(u, ref), sn = Math.hypot(...s), v1 = s.map(x => x / sn * w / 2), v2 = cross(u, v1.map(x => x / (w / 2))).map(x => x * w / 2);
    const corner = (end, i, j) => end.map((x, k) => x + i * v1[k] + j * v2[k]);
    const ring = end => [corner(end, -1, -1), corner(end, 1, -1), corner(end, 1, 1), corner(end, -1, 1)];
    const A = ring(a), B = ring(b), tri = [];
    for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4;
        tri.push(...A[k], ...A[n], ...B[n], ...A[k], ...B[n], ...B[k]);
    }
    tri.push(...A[0], ...A[2], ...A[1], ...A[0], ...A[3], ...A[2], ...B[0], ...B[1], ...B[2], ...B[0], ...B[2], ...B[3]);
    return mesh(tri, color);
}
/** A posed kinematic chain as overlay meshes: a bar per link and a block at each joint, tagged with the unit id. */
export function skeletonMarkers(points, uid, { width = 14, color = [.2, .75, .95], joint = [1, .55, .12] } = {}) {
    const out = [];
    for (let i = 1; i < points.length; i++) {
        const m = bar(points[i - 1], points[i], width, color);
        if (m)
            out.push(m);
    }
    for (const p of points)
        out.push(box([width * 1.6, width * 1.6, width * 1.6], p, joint));
    return out.map(m => ({ ...m, id: uid, material: { name: 'plastic-light' }, marker: true }));
}
/** A small marker at a tool position: a cross of three bars, tagged with the unit id so picking it selects the unit. */
export function toolMarker(at, uid, { size = 24, color = [1, .55, .12] } = {}) {
    const thin = size / 8;
    return [box([size, thin, thin], at, color), box([thin, size, thin], at, color), box([thin, thin, size * 1.6], [at[0], at[1], at[2] + size * .3], color)].map(m => ({ ...m, id: uid, material: { name: 'plastic-light' }, marker: true }));
}
/**
 * A world's model posed by a run (docs/worlds-and-runs.md § a world's model posed by a run). The world's `links` are a
 * definition's link tree over the parts of its model (`node`: the id of the 3D document's feature that makes the part),
 * and each joint and emit names its unit as well as its channel: `{ unit, channel, name, … }`. The axes and origins
 * are in the world's frame, where the model is drawn. One code path: each bound channel becomes the channel
 * `<uid>/<id>` of one tree, posed by unitPose and linkTransforms as a unit's own links are.
 * A link with a `frame` (`{ unit, channel, at: 'tip' | 'tool', offset_mm?, rpy_deg? }`) instead rides on a unit: the
 * part is carried by the end of that unit's chain, or by its tool point, so a gripper follows the arm's flange.
 */
const boundOf = l => [l?.joint, ...[l?.emit ?? []].flat(), l?.frame].filter(e => e && e.channel !== undefined);
const joined = e => {
    if (!e || e.channel === undefined)
        return e;
    const { unit, ...rest } = e;
    return { ...rest, channel: `${unit}/${e.channel}` };
};
const joinedLinks = links => links.map(l => ({ ...l, ...(l.joint ? { joint: joined(l.joint) } : {}), ...(l.emit !== undefined ? { emit: Array.isArray(l.emit) ? l.emit.map(joined) : joined(l.emit) } : {}), ...(l.frame !== undefined ? { frame: { ...l.frame, channel: `${l.frame.unit}/${l.frame.channel}` } } : {}) }));
/** The channels the links read, each as `<uid>/<id>`; `channelsOfUnit(uid)` gives a unit's channels (channelsOf) or null. */
function boundChannels(links, channelsOfUnit) {
    const out = new Map();
    for (const e of links.flatMap(boundOf)) {
        const c = typeof e.unit === 'string' ? channelsOfUnit(e.unit)?.find(c => c.id === e.channel) : null;
        if (c)
            out.set(`${e.unit}/${c.id}`, { ...c, id: `${e.unit}/${c.id}` });
    }
    return [...out.values()];
}
/** The units and channels a world's links read: [{ unit, channel }], each once. */
export const modelChannels = links => [...new Map((Array.isArray(links) ? links : []).flatMap(boundOf).filter(e => typeof e.unit === 'string').map(e => [`${e.unit}/${e.channel}`, { unit: e.unit, channel: e.channel }])).values()];
/**
 * The problems with a world's `links` (an empty list when they are well formed): each bound joint and emit names a
 * unit of the world and a channel of that unit, then checkLinks' rules. `nodes` (a Set of the model's part names),
 * when given, must hold every linked node.
 */
export function checkModelLinks(links, units, channelsOfUnit, nodes = null) {
    if (!Array.isArray(links) || !links.length)
        return ['links must list at least one link'];
    const problems = [], uids = new Set((units ?? []).map(u => u.uid));
    for (const [i, l] of links.entries())
        for (const e of boundOf(l)) {
            const where = `link ${l.node ?? i}`;
            if (typeof e.unit !== 'string')
                problems.push(`${where}: a joint, emit or frame of the world's model names its unit`);
            else if (!uids.has(e.unit))
                problems.push(`${where}: unit ${e.unit} is not in the world`);
            else if (!channelsOfUnit(e.unit)?.some(c => c.id === e.channel))
                problems.push(`${where}: unit ${e.unit} has no channel ${e.channel}`);
        }
    return problems.length ? problems : checkLinks(joinedLinks(links), boundChannels(links, channelsOfUnit), nodes);
}
/**
 * The world's model at time t (ms) from a run's records: `recordsOf(uid, channelId)` → records | null.
 * → { nodes: Map(part -> { R, p }) in the world's frame, posed and spun: the joints that moved ('uid/channel.name'),
 *     glow: Map(part -> rgb), unknown: [{ unit, channel }] whose state is unknown at t, unknownParts: Set of parts }
 * A part whose own channel, or the channel of a link above it, is unknown at t stays where the model draws it and is in
 * `unknownParts`: its place is not known, so it is not guessed. A part whose channel has no records stays as drawn.
 * `units` (the world's units) gives the placement a part on a unit's frame rides with: a part rides on a unit's pose,
 * so without its placement (or with the unit's state unknown) it stays as drawn, marked unknown.
 */
export function modelPose(links, channelsOfUnit, recordsOf, t, { units = null } = {}) {
    const tree = joinedLinks(links), channels = boundChannels(links, channelsOfUnit);
    const split = id => { const i = id.indexOf('/'); return [id.slice(0, i), id.slice(i + 1)]; };
    // A part on a unit's frame: the world transform of each such node, from that unit's own pose (unitPose, frames).
    const known = new Map((units ?? []).map(u => [u.uid, u])), poses = new Map(), frames = new Map(), frameLost = [];
    for (const l of tree.filter(l => l.frame !== undefined)) {
        const { unit, channel, at } = l.frame, raw = channel.startsWith(`${unit}/`) ? channel.slice(unit.length + 1) : channel, u = known.get(unit);
        if (!u) {
            frameLost.push({ unit, channel: raw });
            continue;
        }
        if (!poses.has(unit))
            poses.set(unit, unitPose(u, channelsOfUnit(unit) ?? [], id => recordsOf(unit, id), t));
        const f = poses.get(unit).frames[raw];
        if (!f || f.at !== at)
            continue;
        const off = vec3(l.frame.offset_mm, 'frame.offset_mm'), R = matMul(f.R, rpyMatrix(l.frame.rpy_deg)), moved = apply(f.R, off);
        frames.set(l.node, { R, p: f.p.map((v, i) => v + moved[i]) });
    }
    const p = unitPose({ uid: 'model', position: [0, 0, 0], rotation: 0 }, channels, id => recordsOf(...split(id)), t, { links: tree, frames });
    const lost = new Set(p.unknown), misplaced = new Set(frameLost.map(f => `${f.unit}/${f.channel}`)), byNode = new Map(tree.map(l => [l.node, l]));
    const own = l => boundOf(l).some(e => lost.has(e.channel) || misplaced.has(e.channel));
    const above = l => { for (let at = l, n = 0; at && n < 64; at = byNode.get(at.parent), n++)
        if (own(at))
            return true; return false; };
    const unknownParts = new Set(tree.filter(above).map(l => l.node));
    const keep = m => new Map([...(m ?? [])].filter(([n]) => !unknownParts.has(n)));
    return { nodes: keep(p.nodes?.nodes), posed: p.nodes?.posed ?? [], spun: p.nodes?.spun ?? [], glow: keep(p.nodes?.glow), unknown: [...p.unknown.map(id => { const [unit, channel] = split(id); return { unit, channel }; }), ...frameLost].filter((u, i, all) => all.findIndex(v => v.unit === u.unit && v.channel === u.channel) === i), unknownParts };
}
/**
 * The model's meshes (named by part) at a modelPose: each linked part moved, a lit part glowing, and a part in an
 * unknown state left where the model draws it, in `unknownColor` and marked `unknown: true`.
 */
export function poseModel(meshes, pose, { unknownColor = [.5, .5, .5] } = {}) {
    if (!pose)
        return meshes;
    return poseNodes(meshes, pose.nodes).map(m => pose.unknownParts.has(m.name) ? { ...m, color: unknownColor, unknown: true } : pose.glow.has(m.name) ? { ...m, glow: pose.glow.get(m.name) } : m);
}
