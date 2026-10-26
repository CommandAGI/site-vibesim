/**
 * Motion from records (docs/devices.md § motion from records): what a channel's state records say about where a unit's
 * parts are, in the record shapes its drivers write. Pure: no DOM. pose.js turns these values into node motion.
 *
 *   foldMotion    the values a channel's records hold at time t, by the format's fold:
 *                   whole   each state record is one whole poll or frame (print-job, linuxcnc-rsh, centaur-link): the
 *                           last one alone is current; a value it does not carry is not known now
 *                   machine as merge, but a gcode-chat record in the work frame (`frame: 'work'`, WPos) drops the axis
 *                           positions: they are not machine positions, and the model's frame is the machine's
 *                   merge   each record says what changed or what one message held (servo-bus, mavlink, others)
 *                 A state record with status `unknown` clears everything (a lost link).
 *   motionNames   the value names a channel's records can carry: its declared joints, else its format's names, else
 *                 null (an open shape such as json-records: a binding cannot be checked before a record names it)
 *   rateTravel    how far a joint driven by a rate (a propeller from a motor output) has gone at t
 *   rootTransform where the unit's body is, from position and attitude values, in the model's frame
 *   emitStrength  how strongly a part lights, from a channel value (a lamp's duty, an LED's level)
 */
import { MAVLINK_VALUES } from './protocols/mavlink.js';
import { CENTAUR_VALUES } from './protocols/centaur-link.js';
import { VALUE_KEYS as PRINT_VALUES } from './protocols/printjob.js';
const AXES6 = ['x', 'y', 'z', 'a', 'b', 'c', 'u', 'v', 'w'];
const FORMATS = {
    'gcode-chat': { fold: 'machine', names: [...AXES6, 'feed', 'spindle', 'laser', 'feedOverride'] },
    'print-job': { fold: 'whole', names: PRINT_VALUES },
    'linuxcnc-rsh': { fold: 'whole', names: ['x', 'y', 'z', 'a', 'b', 'c', 'feedOverride', 'line'] },
    'centaur-link': { fold: 'whole', names: CENTAUR_VALUES },
    mavlink: { fold: 'merge', names: MAVLINK_VALUES },
};
/** The value names a channel's records can carry, or null when its shape is open. */
export function motionNames(channel) {
    if (Array.isArray(channel?.joints) && channel.joints.length)
        return channel.joints.map(j => j.name);
    return FORMATS[channel?.format]?.names ?? null;
}
/**
 * A channel's motion values at t (ms): { status, at, values } from its state records up to t. `status` is that of
 * the last state record ('unknown' with no record); an unknown status leaves no values.
 */
export function foldMotion(channel, records, t) {
    const fold = FORMATS[channel?.format]?.fold ?? 'merge';
    let status = 'unknown', at = null, values = {};
    for (const r of records ?? []) {
        if (Date.parse(r.t) > t)
            break;
        if (r.kind !== 'state')
            continue;
        status = r.status;
        at = r.t;
        if (status === 'unknown') {
            values = {};
            continue;
        }
        values = fold === 'whole' ? { ...(r.values ?? {}) } : { ...values, ...(r.values ?? {}) };
        if (fold === 'machine' && r.frame === 'work')
            for (const k of AXES6)
                delete values[k];
    }
    return { status, at, values };
}
const RATE_UNITS = { rpm: 6, 'deg/s': 1, 'rad/s': 180 / Math.PI, 'mm/s': 1 };
export const RATE_UNIT_NAMES = Object.keys(RATE_UNITS);
/**
 * How far a rate-driven joint has gone at t (ms), in degrees (revolute) or mm (prismatic), from the state records of
 * its channel: each value of `name` holds until the next record (as the fold does), as `(value − offset) · scale` in
 * `units`. Nothing accrues before the first value, after a record without it (whole fold) or while the state is
 * unknown. Null when no record up to t gave a rate. The travel is a depiction of motion: the absolute angle of a
 * spinning part is not in the records.
 */
export function rateTravel(channel, records, name, t, rate) {
    const k = RATE_UNITS[rate?.units], scale = Number.isFinite(rate?.scale) ? rate.scale : 1, offset = Number.isFinite(rate?.offset) ? rate.offset : 0;
    if (!k)
        return null;
    const whole = (FORMATS[channel?.format]?.fold ?? 'merge') === 'whole';
    let travel = 0, seen = false, now = null, since = null;
    const accrue = until => { if (now !== null)
        travel += now * (until - since) / 1000; };
    for (const r of records ?? []) {
        const at = Date.parse(r.t);
        if (at > t)
            break;
        if (r.kind !== 'state')
            continue;
        accrue(at);
        const v = r.values?.[name];
        if (r.status === 'unknown' || (whole && !Number.isFinite(v)))
            now = null;
        else if (Number.isFinite(v)) {
            now = (v - offset) * scale * k;
            seen = true;
        }
        since = at;
    }
    accrue(t);
    return seen ? travel : null;
}
const RAD = Math.PI / 180;
const rx = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const ry = a => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const rz = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const apply = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const transpose = M => [0, 1, 2].map(i => M.map(r => r[i]));
const FORWARD = { '+x': 0, '+y': 90, '-x': 180, '-y': -90 };
const names3 = n => Array.isArray(n) && n.length === 3 && n.every(x => x === null || (typeof x === 'string' && x)) && n.some(x => x !== null);
const names4 = n => Array.isArray(n) && n.length === 4 && n.every(x => typeof x === 'string' && x);
/** The rotation of a unit quaternion [w, x, y, z]; null when it is not near unit length (not an attitude). */
const quat = ([w, x, y, z]) => {
    const n = Math.hypot(w, x, y, z);
    if (!(Math.abs(n - 1) < 0.01))
        return null;
    [w, x, y, z] = [w / n, x / n, y / n, z / n];
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
};
const euler = ([r, p, y]) => mul(mul(rz(y), ry(p)), rx(r));
/**
 * The problems with a definition's `root` (an empty list when it is well formed):
 *   "root": { "channel": "<id>", "frame": "ned" | "flu",
 *             "position"?: { "names": [x, y, z], "units": "m" | "mm" },          a name may be null: that axis stays
 *             "attitude"?: { "names": [roll, pitch, yaw], "units": "rad" | "deg" }
 *                        | { "names": [w, x, y, z], "units": "quaternion" },
 *                          either with "drawn_deg"?: [roll, pitch, yaw] (the attitude at which the model is drawn),
 *             "origin_mm"?: [x, y, z], "forward"?: "+x" | "-x" | "+y" | "-y" }
 */
export function checkRoot(root, channels = []) {
    if (!root || typeof root !== 'object')
        return ['root must be an object'];
    const problems = [], channel = channels.find(c => c.id === root.channel), known = channel ? motionNames(channel) : null;
    if (!channel)
        problems.push(`root names channel ${root.channel}, which the definition does not declare`);
    if (!['ned', 'flu'].includes(root.frame))
        problems.push('root.frame must be ned or flu');
    if (!root.position && !root.attitude)
        problems.push('root needs position or attitude');
    for (const [key, units] of [['position', ['m', 'mm']], ['attitude', ['rad', 'deg', 'quaternion']]]) {
        const part = root[key];
        if (part === undefined)
            continue;
        if (part?.units === 'quaternion' ? !names4(part?.names) : !names3(part?.names))
            problems.push(part?.units === 'quaternion' ? `root.${key}.names must be four value names (w, x, y, z)` : `root.${key}.names must be three value names (null for an axis that does not move)`);
        else if (known)
            for (const n of part.names.filter(Boolean))
                if (!known.includes(n))
                    problems.push(`root.${key}: channel ${root.channel} records no value ${n}`);
        if (!units.includes(part?.units))
            problems.push(`root.${key}.units must be ${units.join(' or ')}`);
    }
    const drawn = root.attitude?.drawn_deg;
    if (drawn !== undefined && !(Array.isArray(drawn) && drawn.length === 3 && drawn.every(Number.isFinite)))
        problems.push('root.attitude.drawn_deg must be [roll, pitch, yaw] in degrees');
    if (root.origin_mm !== undefined && !(Array.isArray(root.origin_mm) && root.origin_mm.length === 3 && root.origin_mm.every(Number.isFinite)))
        problems.push('root.origin_mm must be [x, y, z] in mm');
    if (root.forward !== undefined && !(root.forward in FORWARD))
        problems.push('root.forward must be +x, -x, +y or -y');
    return problems;
}
/**
 * The unit's body motion from its root channel's values: { R, p } in the model's frame (x' = R·x + p), or null when a
 * named value is missing (a part of a pose is not a pose). The record frame's origin and x axis are the placement's
 * origin and the model's `forward` axis; `ned` turns z down and y right (MAVLink's local frame and FRD body), `flu`
 * keeps z up (odometry). Attitude is roll about x, then pitch about y, then yaw about z (R = Rz·Ry·Rx), or a unit
 * quaternion [w, x, y, z], about `origin_mm` (the point of the model the records are of). `drawn_deg` is the attitude
 * at which the model is drawn (a tail-sitter drawn nose up: pitch 90); the model turns by the attitude relative to it.
 */
export function rootTransform(root, values = {}) {
    const read = (part, scale) => part ? part.names.map(n => n === null ? 0 : Number.isFinite(values[n]) ? values[n] * scale : NaN) : [0, 0, 0];
    const pos = read(root.position, root.position?.units === 'm' ? 1000 : 1), att = read(root.attitude, root.attitude?.units === 'deg' ? RAD : 1);
    if (![...pos, ...att].every(Number.isFinite))
        return null;
    const body = root.attitude?.units === 'quaternion' ? quat(att) : euler(att);
    if (!body)
        return null;
    const C = root.frame === 'ned' ? [[1, 0, 0], [0, -1, 0], [0, 0, -1]] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const A = mul(rz((FORWARD[root.forward ?? '+x']) * RAD), C), D = euler((root.attitude?.drawn_deg ?? [0, 0, 0]).map(v => v * RAD));
    const R = mul(mul(mul(A, body), transpose(D)), transpose(A)), o = root.origin_mm ?? [0, 0, 0], Ro = apply(R, o), d = apply(A, pos);
    return { R, p: o.map((v, i) => v - Ro[i] + d[i]) };
}
/**
 * The problems with a link's `emit` (one source or a list): { channel, name, color: [r, g, b] (0..1, linear),
 * min? (dark, default 0), max? (full, default 1), off?: a value name whose non-zero value means the light is cut }.
 */
export function checkEmit(emit, channels = []) {
    const problems = [];
    for (const e of Array.isArray(emit) ? emit : [emit]) {
        const channel = channels.find(c => c.id === e?.channel), known = channel ? motionNames(channel) : null;
        if (!channel) {
            problems.push(`emit names channel ${e?.channel}, which the definition does not declare`);
            continue;
        }
        for (const n of [e.name, e.off].filter(x => x !== undefined))
            if (typeof n !== 'string' || !n || (known && !known.includes(n)))
                problems.push(`emit: channel ${e.channel} records no value ${n}`);
        if (!(Array.isArray(e.color) && e.color.length === 3 && e.color.every(v => Number.isFinite(v) && v >= 0)))
            problems.push('emit.color must be [r, g, b], each 0 or more');
        const min = e.min ?? 0, max = e.max ?? 1;
        if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min))
            problems.push('emit: max must be a number above min');
    }
    return problems;
}
/** A light's colour × strength from its channels' values ({ channel: { name: value } }); null when no source has a value. */
export function emitGlow(emit, values = {}) {
    let glow = null;
    for (const e of Array.isArray(emit) ? emit : [emit]) {
        const v = values[e.channel]?.[e.name];
        if (!Number.isFinite(v))
            continue;
        const min = e.min ?? 0, max = e.max ?? 1, cut = e.off !== undefined && values[e.channel]?.[e.off];
        const s = cut ? 0 : Math.max(0, Math.min(1, (v - min) / (max - min)));
        glow = (glow ?? [0, 0, 0]).map((g, i) => g + e.color[i] * s);
    }
    return glow;
}
