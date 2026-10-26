/**
 * The `centaur-link`: the Centaur's leg bridge (a Teensy 4.1) and the Jetson over USB CDC serial. Pure. The bridge's
 * C++ (seed/drive/platform/user-commandagi/hardware/CommandAGI-Centaur-001/firmware/bridge/lib/centaur/link.cpp) gives the same bytes; the firmware's
 * protocol/bridge.test.mjs checks that, and its § the link is the specification.
 *
 *   A5 5A  type u8  seq u16  len u16  payload[len]  crc u32       little-endian
 *   crc = CRC-32 (IEEE 802.3, reflected, init and xorout FFFFFFFF) over type … payload
 *
 * Each side numbers its own frames. A receiver that finds a bad sync, length or CRC moves on by one byte and scans on.
 * Joint values are in joint space (the knee after its belt), SI units: rad, rad/s, N·m, N·m/rad, N·m·s/rad.
 *
 * The record shapes the `centaur-link-serial` driver writes (docs/devices.md § record shapes per format):
 *
 *   state { status: disarmed | following | holding | stopped, cause?, power, inputs, bridge, values, missing? }
 *   values  <joint>         q, rad, at the joint (the knee's, not its motor's), measured
 *           <joint>_dq      rad/s, measured
 *           <joint>_tau     N·m, measured
 *           <joint>_temp_c  °C;  <joint>_error  the motor's error code
 *           acc_x … acc_z   m/s²; gyro_x … gyro_z  rad/s (the bridge's BMI088)
 *           v_bus, v_pack   V
 *   inputs  { estop, motorPower, watchdogRelay }: the loop closed, the safety relay closed, the watchdog relay closed
 *   bridge  { t, imuT (µs, the bridge's clock), lastTargetSeq, refusals, crcErrors }
 * <joint> is FL_hip_abad … RR_wheel (the link's joint order). A joint whose motor has not replied (age 255) gives no
 * values and is named in `missing`. The frame carries no odometry: the robot's place is not in these records.
 */
export const SYNC = Object.freeze([0xa5, 0x5a]);
export const MAX_PAYLOAD = 1024;
export const JOINTS = 16;
export const LEGS = Object.freeze(['FL', 'FR', 'RL', 'RR']);
/** A joint's role, the same on every leg; the bridge's bounds are per role (robot.cpp). */
export const ROLES = Object.freeze(['hip_abad', 'hip_pitch', 'knee', 'wheel']);
/** Joint order: leg-major (FL, FR, RL, RR), then hip_abad, hip_pitch, knee, wheel. */
export const CENTAUR_JOINTS = Object.freeze(LEGS.flatMap(leg => ROLES.map(j => `${leg}_${j}`)));

export const TYPE = Object.freeze({
    targets: 0x01, // Jetson → bridge: 16 × { q, dq, kp, kd, tau } f32
    stop: 0x02,    // always accepted: category 1 stop, latched until the bridge is reset
    arm: 0x03,     // disarmed → armed: enter motor mode, then hold (damping) until a target arrives
    zero: 0x04,    // { joint u8 }: set that motor's present position as zero; only while disarmed
    state: 0x81,   // bridge → Jetson, every cycle
    refused: 0x82, // a frame the bridge did not act on, and why
    ack: 0x83,     // a frame the bridge acted on; never that the robot reached anything
});
export const MODE = Object.freeze(['disarmed', 'following', 'holding', 'stopped']);
export const CAUSE = Object.freeze(['none', 'e-stop input', 'stop frame', 'loop overrun', 'watchdog reset',
    'motor silent', 'motor error', 'wheel overspeed', 'configuration', 'motor power off', 'precharge failed']);
export const POWER = Object.freeze(['off', 'precharging', 'closing', 'on', 'failed']);
export const REASON = Object.freeze({
    1: 'q below limit', 2: 'q above limit', 3: 'dq above cap', 4: 'kp above cap', 5: 'kd above cap', 6: 'tau above cap',
    7: 'not finite', 8: 'outside the motor range', 16: 'seq not newer', 17: 'not armed', 18: 'stopped',
    19: 'bad length', 20: 'unknown type', 21: 'armed', 22: 'no motor power',
});
export const STATE_PAYLOAD = 308;

let table;
export function crc32(bytes) {
    table ??= Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n; });
    let c = 0xffffffff;
    for (const b of bytes) c = table[(c ^ b) & 255] ^ c >>> 8;
    return (c ^ 0xffffffff) >>> 0;
}

export function frame(type, seq, payload = new Uint8Array(0)) {
    if (payload.length > MAX_PAYLOAD) throw RangeError(`centaur-link: payload ${payload.length} > ${MAX_PAYLOAD}`);
    const out = new Uint8Array(7 + payload.length + 4);
    const view = new DataView(out.buffer);
    out.set(SYNC);
    view.setUint8(2, type);
    view.setUint16(3, seq & 0xffff, true);
    view.setUint16(5, payload.length, true);
    out.set(payload, 7);
    view.setUint32(7 + payload.length, crc32(out.subarray(2, 7 + payload.length)), true);
    return out;
}

/** Scan received bytes. -> { frames: [{ type, seq, payload }], rest, dropped } */
export function parse(bytes) {
    const frames = [];
    let i = 0, dropped = 0;
    while (bytes.length - i >= 11) {
        if (bytes[i] !== SYNC[0] || bytes[i + 1] !== SYNC[1]) { i++; dropped++; continue; }
        const len = bytes[i + 5] | bytes[i + 6] << 8;
        if (len > MAX_PAYLOAD) { i++; dropped++; continue; }
        if (bytes.length - i < 11 + len) break;
        const view = new DataView(bytes.buffer, bytes.byteOffset + i);
        if (view.getUint32(7 + len, true) !== crc32(bytes.subarray(i + 2, i + 7 + len))) { i++; dropped++; continue; }
        frames.push({ type: bytes[i + 2], seq: view.getUint16(3, true), payload: bytes.slice(i + 7, i + 7 + len) });
        i += 11 + len;
    }
    return { frames, rest: bytes.slice(i), dropped };
}

const FIELDS = ['q', 'dq', 'kp', 'kd', 'tau'];

/** targets: an array of 16 { q, dq, kp, kd, tau }. */
export function targets(seq, joints) {
    if (joints.length !== JOINTS) throw RangeError(`centaur-link: ${joints.length} joints, not ${JOINTS}`);
    const payload = new Uint8Array(JOINTS * 20);
    const view = new DataView(payload.buffer);
    joints.forEach((j, n) => FIELDS.forEach((f, k) => view.setFloat32(n * 20 + k * 4, j[f], true)));
    return frame(TYPE.targets, seq, payload);
}
export const stop = seq => frame(TYPE.stop, seq);
export const arm = seq => frame(TYPE.arm, seq);
export const zero = (seq, joint) => frame(TYPE.zero, seq, Uint8Array.of(joint));

export function decodeTargets(payload) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    return Array.from({ length: JOINTS }, (_, n) => Object.fromEntries(FIELDS.map((f, k) => [f, view.getFloat32(n * 20 + k * 4, true)])));
}

/**
 * state (308 bytes): t u32 µs on the bridge clock, lastTargetSeq u16, mode u8, cause u8, refusals u16, crcErrors u16,
 * inputs u8 (bit 0 e-stop loop closed, 1 safety relay closed, 2 watchdog relay closed), power u8 (POWER), pad ×2,
 * imu { t u32, acc xyz f32 m/s², gyro xyz f32 rad/s }, 16 × { q, dq, tau f32 (measured), temperature i8 °C,
 * error u8, age u8 ms since the motor's last reply (255: none or older), pad u8 }, vBus f32 V, vPack f32 V.
 */
export function decodeState(payload) {
    const v = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const f = o => v.getFloat32(o, true);
    return {
        t: v.getUint32(0, true), lastTargetSeq: v.getUint16(4, true), mode: MODE[v.getUint8(6)], cause: CAUSE[v.getUint8(7)],
        refusals: v.getUint16(8, true), crcErrors: v.getUint16(10, true),
        inputs: { estop: !!(v.getUint8(12) & 1), motorPower: !!(v.getUint8(12) & 2), watchdogRelay: !!(v.getUint8(12) & 4) },
        power: POWER[v.getUint8(13)], vBus: f(300), vPack: f(304),
        imu: { t: v.getUint32(16, true), acc: [f(20), f(24), f(28)], gyro: [f(32), f(36), f(40)] },
        joints: Array.from({ length: JOINTS }, (_, n) => {
            const o = 44 + n * 16;
            return { q: f(o), dq: f(o + 4), tau: f(o + 8), temperature: v.getInt8(o + 12), error: v.getUint8(o + 13), age: v.getUint8(o + 14) };
        }),
    };
}

/** refused (12 bytes): seq u16 of the refused frame, joint u8 (255: the whole frame), reason u8, value f32, limit f32. */
export function decodeRefused(payload) {
    const v = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const joint = v.getUint8(2), reason = v.getUint8(3);
    return { seq: v.getUint16(0, true), joint: joint === 255 ? null : CENTAUR_JOINTS[joint], reason: REASON[reason] ?? `reason ${reason}`,
        value: v.getFloat32(4, true), limit: v.getFloat32(8, true) };
}

/** ack (3 bytes): seq u16 and type u8 of the frame the bridge acted on. */
export function decodeAck(payload) {
    return { seq: payload[0] | payload[1] << 8, type: payload[2] };
}

/** Whether u16 frame seq `a` is newer than `b`, as the bridge compares them (int16 difference). */
export const newer = (a, b) => ((a - b) << 16 >> 16) > 0;

const JOINT_FIELDS = [['', 'q'], ['_dq', 'dq'], ['_tau', 'tau'], ['_temp_c', 'temperature'], ['_error', 'error']];
/** Every value name a `centaur-link` state record can carry. */
export const CENTAUR_VALUES = Object.freeze([...CENTAUR_JOINTS.flatMap(j => JOINT_FIELDS.map(([s]) => j + s)), 'acc_x', 'acc_y', 'acc_z', 'gyro_x', 'gyro_y', 'gyro_z', 'v_bus', 'v_pack']);
const finite = v => typeof v === 'number' && Number.isFinite(v);
/** A decoded STATE frame → the state record's fields. Non-finite readings are left out and named in `missing`. */
export function centaurState(s) {
    const values = {}, missing = [];
    const put = (k, v) => finite(v) ? values[k] = v : missing.push(k);
    CENTAUR_JOINTS.forEach((name, n) => {
        const j = s.joints?.[n];
        if (!j || j.age === 255)
            return void missing.push(name);
        for (const [suffix, field] of JOINT_FIELDS)
            put(name + suffix, j[field]);
    });
    ['x', 'y', 'z'].forEach((a, i) => { put(`acc_${a}`, s.imu?.acc?.[i]); put(`gyro_${a}`, s.imu?.gyro?.[i]); });
    put('v_bus', s.vBus);
    put('v_pack', s.vPack);
    return {
        status: s.mode ?? 'unknown', ...(s.cause && s.cause !== 'none' ? { cause: s.cause } : {}), ...(s.power ? { power: s.power } : {}),
        ...(s.inputs ? { inputs: s.inputs } : {}),
        ...(finite(s.t) ? { bridge: { t: s.t, imuT: s.imu?.t ?? null, lastTargetSeq: s.lastTargetSeq, refusals: s.refusals, crcErrors: s.crcErrors } } : {}),
        values, ...(missing.length ? { missing } : {})
    };
}

// ── the admission gate on the Jetson's side ───────────────────────────────────────────────────────────────────────

/** The verbs a `legs` channel may allow (`channel.verbs`); `stop` is safing and always allowed. */
export const VERBS = Object.freeze(['arm', 'targets', 'zero', 'stop']);
const LIMIT_FIELDS = ['dq', 'kp', 'kd', 'tau'];
const refuse = message => { throw Error(message); };
/**
 * A `legs` channel's declared bounds, checked: `limits.joints` per role (the same on every leg, as the bridge's table),
 * `{ q: [min, max] rad, dq rad/s, kp, kd, tau N·m }`, and the knee's coupled limit `{ coupled: { joint: 'hip_pitch',
 * steps: [[hip at least, knee max], …] } }`; `minIntervalMs` between two TARGETS frames; `verbs` (default all of VERBS).
 * Throws when a bound is missing or not a number: the driver sends no target without them.
 */
export function centaurLimits(channel) {
    const roles = channel?.limits?.joints;
    if (!roles || typeof roles !== 'object')
        refuse(`${channel?.id ?? 'the channel'} declares no limits.joints: the driver sends no target without declared bounds`);
    const joints = {};
    for (const role of ROLES) {
        const r = roles[role];
        if (!r || !Array.isArray(r.q) || r.q.length !== 2 || !r.q.every(finite) || !(r.q[0] < r.q[1]))
            refuse(`limits.joints.${role}.q must be [min, max] in rad with min < max`);
        for (const k of LIMIT_FIELDS)
            if (!finite(r[k]) || r[k] < 0)
                refuse(`limits.joints.${role}.${k} must be a number ≥ 0`);
        const coupled = r.coupled;
        if (coupled !== undefined && (role !== 'knee' || coupled.joint !== 'hip_pitch' || !Array.isArray(coupled.steps) || !coupled.steps.every(s => Array.isArray(s) && s.length === 2 && s.every(finite))))
            refuse('limits.joints.knee.coupled is { joint: "hip_pitch", steps: [[hip at least, knee max], …] } (rad), on the knee only');
        joints[role] = { q: [...r.q], ...Object.fromEntries(LIMIT_FIELDS.map(k => [k, r[k]])), ...(coupled ? { coupled: { joint: 'hip_pitch', steps: coupled.steps.map(s => [...s]) } } : {}) };
    }
    if (!finite(channel.minIntervalMs) || channel.minIntervalMs < 0)
        refuse(`${channel.id}: minIntervalMs (the least time between two TARGETS frames) must be declared`);
    const verbs = channel.verbs ?? VERBS;
    if (!Array.isArray(verbs) || !verbs.every(v => VERBS.includes(v)))
        refuse(`${channel.id}: verbs must be some of ${VERBS.join(', ')}`);
    return { joints, minIntervalMs: channel.minIntervalMs, verbs: [...new Set([...verbs, 'stop'])] };
}
/** The knee's upper limit for a hip_pitch angle: the highest step the hip clears, never below the knee's own max. */
function kneeMax(knee, hip) {
    let max = knee.q[1];
    for (const [at, k] of knee.coupled?.steps ?? [])
        if (hip >= at && k > max)
            max = k;
    return max;
}
/**
 * The Jetson's admission of one TARGETS frame, before it is sent: every joint of the link, each with q, dq, kp, kd and
 * tau, inside the declared bounds. Values are checked as the link carries them (f32), so the check sees what the bridge
 * sees. The knee's coupled limit uses the lower of the hip's target and its last reading, and the knee's own max when
 * there is no reading (as the bridge does). Refused, never clamped.
 *   joints: { FL_hip_abad: { q, dq, kp, kd, tau }, … }; limits: centaurLimits(channel); hipReading: { FL: rad, … }
 *   → { targets: [16 × { q, dq, kp, kd, tau }] } | { refusal: { joint, field?, reason, value?, limit? } }
 */
export function admitTargets(joints, limits, hipReading = {}) {
    if (!joints || typeof joints !== 'object' || Array.isArray(joints))
        return { refusal: { joint: null, reason: 'joints is an object of every joint of the link by name' } };
    const unknown = Object.keys(joints).find(k => !CENTAUR_JOINTS.includes(k));
    if (unknown)
        return { refusal: { joint: unknown, reason: 'not a joint of the link' } };
    const out = [];
    for (const name of CENTAUR_JOINTS) {
        const j = joints[name], [leg, ...rest] = name.split('_'), role = rest.join('_'), b = limits.joints[role];
        if (!j || typeof j !== 'object')
            return { refusal: { joint: name, reason: 'missing: a TARGETS frame carries every joint' } };
        const extra = Object.keys(j).find(k => !FIELDS.includes(k));
        if (extra)
            return { refusal: { joint: name, field: extra, reason: `not a field of a target (${FIELDS.join(', ')})` } };
        const t = Object.fromEntries(FIELDS.map(f => [f, typeof j[f] === 'number' ? Math.fround(j[f]) : NaN]));
        const bad = FIELDS.find(f => !Number.isFinite(t[f]));
        if (bad)
            return { refusal: { joint: name, field: bad, reason: 'not finite' } };
        const no = (field, reason, value, limit) => ({ refusal: { joint: name, field, reason, value, limit } });
        if (t.q < b.q[0])
            return no('q', 'q below limit', t.q, b.q[0]);
        const hip = hipReading[leg];
        const qMax = role === 'knee' && b.coupled && finite(hip) ? kneeMax(b, Math.min(out.at(-1).q, hip)) : b.q[1];
        if (t.q > qMax)
            return no('q', 'q above limit', t.q, qMax);
        if (Math.abs(t.dq) > b.dq)
            return no('dq', 'dq above cap', t.dq, b.dq);
        if (t.kp < 0 || t.kp > b.kp)
            return no('kp', 'kp above cap', t.kp, b.kp);
        if (t.kd < 0 || t.kd > b.kd)
            return no('kd', 'kd above cap', t.kd, b.kd);
        if (Math.abs(t.tau) > b.tau)
            return no('tau', 'tau above cap', t.tau, b.tau);
        out.push(t);
    }
    return { targets: out };
}

// ── Centaur-002's sealed state (no firmware speaks this yet) ───────────────────────────────────────────────────────

/**
 * Centaur-002's `legs-state` channel is sealed by the device (`seals: "device"`, docs/integrity.md). Centaur-002 is an
 * architecture: no firmware exists, so NOTHING SPEAKS THIS WIRE YET (seed/drive/platform/user-commandagi/hardware/CommandAGI-Centaur-002/README.md). It is
 * the host side's half, written against the one wire the documents give for a device's sealed lines: the realtime
 * socket's sealed-stream messages (docs/integrity.md § who seals; local-host/drivers/host-wire.mjs), unchanged:
 *
 *   device → host  { type: 'channels', channels: [{ channelId, channel: { id, medium, seals } }] }
 *                  { type: 'data', channelId, url: 'data:text/plain;base64,…' }      lines, ending with a seal
 *                  { type: 'seal_resumed', channelIds }
 *   host → device  { type: 'seal_resume', streams: [{ channelId, seq, prev, counter }], reason }
 *
 * On the serial port each message is its JSON text and a newline, split in order over centaur-link frames of type
 * `WIRE.fromDevice` (device → host) or `WIRE.toDevice` (host → device), at most MAX_PAYLOAD bytes each. A frame that a
 * bad CRC drops breaks one message: it no longer parses, or the group it carried no longer matches its seal, and the
 * device resumes where the file stands.
 */
export const WIRE = Object.freeze({ toDevice: 0x05, fromDevice: 0x84 });
/** The longest message line a reader keeps (a seal with its certificate chain is a few KiB). */
export const MAX_WIRE_LINE = 1 << 20;
/** One message as WIRE frames, the first numbered `seq`. → { bytes, next } (next: the seq after the last frame). */
export function wireFrames(type, seq, message) {
    const text = new TextEncoder().encode(JSON.stringify(message) + '\n'), parts = [];
    for (let at = 0; at < text.length; at += MAX_PAYLOAD)
        parts.push(frame(type, seq++, text.subarray(at, at + MAX_PAYLOAD)));
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { bytes.set(p, o); o += p.length; }
    return { bytes, next: seq & 0xffff };
}
/** Reassembles the messages of WIRE payloads, in order. push(payload) → [message | { malformed: reason }]. */
export function wireReader() {
    let held = new Uint8Array(0);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return {
        push(payload) {
            const all = new Uint8Array(held.length + payload.length);
            all.set(held);
            all.set(payload, held.length);
            const out = [];
            let start = 0;
            for (let i = 0; i < all.length; i++) {
                if (all[i] !== 0x0a)
                    continue;
                const line = all.subarray(start, i);
                start = i + 1;
                try {
                    const m = JSON.parse(decoder.decode(line));
                    out.push(m && typeof m === 'object' && !Array.isArray(m) ? m : { malformed: 'not a message object' });
                }
                catch (e) {
                    out.push({ malformed: e.message });
                }
            }
            held = all.slice(start);
            if (held.length > MAX_WIRE_LINE) {
                held = new Uint8Array(0);
                out.push({ malformed: `a message longer than ${MAX_WIRE_LINE} bytes` });
            }
            return out;
        }
    };
}
