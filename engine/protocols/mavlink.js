/**
 * MAVLink 2 as ArduPilot speaks it (mavlink.io/en/guide/serialization.html; the message definitions of common.xml and
 * ardupilotmega.xml at ArduPilot e204ca77). Pure: frames, the X.25 checksum with each message's CRC_EXTRA, the record
 * shapes the four MAVLink drivers write, and the bounds they hold. No socket.
 *
 *   v2 frame  0xFD · len · incompat · compat · seq · sysid · compid · msgid (3 bytes LE) · payload · crc (LE) · [signature 13]
 *   v1 frame  0xFE · len · seq · sysid · compid · msgid · payload · crc (LE)
 *
 * The payload holds the base fields sorted by type size (largest first; the order of the XML within a size), then the
 * extension fields in XML order. A v2 sender cuts the trailing zero bytes of the payload (at least one byte stays); a
 * receiver pads them back. The checksum is CRC-16/MCRF4XX over the frame from `len` to the end of the payload, then the
 * message's CRC_EXTRA. A frame with a bad checksum is dropped. A signed frame is decoded, but its signature is not
 * checked: this code has no signing key (docs/devices.md § MAVLink).
 *
 * `mavlink` record shapes (docs/devices.md § record shapes per format): what `mavlink-udp` writes for each message.
 *   HEARTBEAT            → state { status: armed | disarmed, mode }            base_mode bit 7; mode from custom_mode
 *   ATTITUDE             → state { values: { roll, pitch, yaw } }              rad against local NED, in the autopilot's
 *                                                                              view: a tail-sitter (ArduPlane) sends its
 *                                                                              VTOL view while it shows VTOL flight
 *   ATTITUDE_QUATERNION  → state { values: { q1, q2, q3, q4 } }               w, x, y, z: the body (FRD) against local
 *                                                                              NED in every mode
 *   LOCAL_POSITION_NED   → state { values: { x, y, z, vx, vy, vz } }           m, m/s from the EKF origin
 *   GLOBAL_POSITION_INT  → state { values: { lat, lon, alt, alt_rel, hdg } }   deg, m above mean sea level, m above home, deg
 *   VFR_HUD              → state { values: { airspeed, groundspeed, throttle, climb } }   m/s, %, m/s (the heading is hdg)
 *   SYS_STATUS           → state { prearm?: pass | fail, values: { battery_v, battery_a?, battery_pct? } }   prearm: the
 *                                                                              autopilot's arming checks, when it reports them
 *   BATTERY_STATUS id 0  → state { values: { battery_mah, battery_temp? } }    mAh used, °C
 *   GPS_RAW_INT          → state { values: { gps_fix, gps_sats } }
 *   EXTENDED_SYS_STATE   → state { landed, vtol }                              words of MAV_LANDED_STATE, MAV_VTOL_STATE
 *   MISSION_CURRENT      → state { values: { mission_seq, mission_total? } }
 *   HOME_POSITION        → state { values: { home_lat, home_lon, home_alt } }
 *   SERVO_OUTPUT_RAW     → state { values: { servo1 … servo16 } }             µs, port 0 only; 0 (no output) is left out
 *   STATUSTEXT           → event { severity, text }                            the autopilot's own words
 * Every state record carries the status of the last HEARTBEAT (`no heartbeat` before the first one). A record holds what
 * one message said, so the fold merges them (motion.js). A servo output is the pulse the autopilot sends, not a measured
 * motor speed or surface angle.
 */
export const ARMED_FLAG = 128;
export const CUSTOM_MODE_FLAG = 1;
export const SERVO_OUTPUTS = 16;
export const AUTOPILOT_ARDUPILOT = 3;
export const AUTOPILOT_INVALID = 8;
export const TYPE_GCS = 6;
/** A component that is not the autopilot (a camera, a gimbal, the GCS) sends heartbeats too; only 1 is the autopilot. */
export const AUTOPILOT_COMPONENT = 1;
export const PREARM_CHECK = 0x10000000;
/** Every value name a `mavlink` state record can carry. */
export const MAVLINK_VALUES = Object.freeze(['roll', 'pitch', 'yaw', 'q1', 'q2', 'q3', 'q4', 'x', 'y', 'z', 'vx', 'vy', 'vz',
    'lat', 'lon', 'alt', 'alt_rel', 'hdg', 'airspeed', 'groundspeed', 'throttle', 'climb',
    'battery_v', 'battery_a', 'battery_pct', 'battery_mah', 'battery_temp', 'gps_fix', 'gps_sats', 'mission_seq', 'mission_total',
    'home_lat', 'home_lon', 'home_alt', ...Array.from({ length: SERVO_OUTPUTS }, (_, i) => `servo${i + 1}`)]);

/** The messages the drivers send or record, by id: name, CRC_EXTRA, base fields in wire order, extension fields. */
export const MESSAGES = Object.freeze({
    0: { name: 'HEARTBEAT', crc: 50, fields: [['custom_mode', 'uint32_t'], ['type', 'uint8_t'], ['autopilot', 'uint8_t'], ['base_mode', 'uint8_t'], ['system_status', 'uint8_t'], ['mavlink_version', 'uint8_t']] },
    1: { name: 'SYS_STATUS', crc: 124, fields: [['onboard_control_sensors_present', 'uint32_t'], ['onboard_control_sensors_enabled', 'uint32_t'], ['onboard_control_sensors_health', 'uint32_t'], ['load', 'uint16_t'], ['voltage_battery', 'uint16_t'], ['current_battery', 'int16_t'], ['drop_rate_comm', 'uint16_t'], ['errors_comm', 'uint16_t'], ['errors_count1', 'uint16_t'], ['errors_count2', 'uint16_t'], ['errors_count3', 'uint16_t'], ['errors_count4', 'uint16_t'], ['battery_remaining', 'int8_t']], ext: [['onboard_control_sensors_present_extended', 'uint32_t'], ['onboard_control_sensors_enabled_extended', 'uint32_t'], ['onboard_control_sensors_health_extended', 'uint32_t']] },
    20: { name: 'PARAM_REQUEST_READ', crc: 214, fields: [['param_index', 'int16_t'], ['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['param_id', 'char', 16]] },
    21: { name: 'PARAM_REQUEST_LIST', crc: 159, fields: [['target_system', 'uint8_t'], ['target_component', 'uint8_t']] },
    22: { name: 'PARAM_VALUE', crc: 220, fields: [['param_value', 'float'], ['param_count', 'uint16_t'], ['param_index', 'uint16_t'], ['param_id', 'char', 16], ['param_type', 'uint8_t']] },
    23: { name: 'PARAM_SET', crc: 168, fields: [['param_value', 'float'], ['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['param_id', 'char', 16], ['param_type', 'uint8_t']] },
    24: { name: 'GPS_RAW_INT', crc: 24, fields: [['time_usec', 'uint64_t'], ['lat', 'int32_t'], ['lon', 'int32_t'], ['alt', 'int32_t'], ['eph', 'uint16_t'], ['epv', 'uint16_t'], ['vel', 'uint16_t'], ['cog', 'uint16_t'], ['fix_type', 'uint8_t'], ['satellites_visible', 'uint8_t']], ext: [['alt_ellipsoid', 'int32_t'], ['h_acc', 'uint32_t'], ['v_acc', 'uint32_t'], ['vel_acc', 'uint32_t'], ['hdg_acc', 'uint32_t'], ['yaw', 'uint16_t']] },
    30: { name: 'ATTITUDE', crc: 39, fields: [['time_boot_ms', 'uint32_t'], ['roll', 'float'], ['pitch', 'float'], ['yaw', 'float'], ['rollspeed', 'float'], ['pitchspeed', 'float'], ['yawspeed', 'float']] },
    31: { name: 'ATTITUDE_QUATERNION', crc: 246, fields: [['time_boot_ms', 'uint32_t'], ['q1', 'float'], ['q2', 'float'], ['q3', 'float'], ['q4', 'float'], ['rollspeed', 'float'], ['pitchspeed', 'float'], ['yawspeed', 'float']], ext: [['repr_offset_q', 'float', 4]] },
    32: { name: 'LOCAL_POSITION_NED', crc: 185, fields: [['time_boot_ms', 'uint32_t'], ['x', 'float'], ['y', 'float'], ['z', 'float'], ['vx', 'float'], ['vy', 'float'], ['vz', 'float']] },
    33: { name: 'GLOBAL_POSITION_INT', crc: 104, fields: [['time_boot_ms', 'uint32_t'], ['lat', 'int32_t'], ['lon', 'int32_t'], ['alt', 'int32_t'], ['relative_alt', 'int32_t'], ['vx', 'int16_t'], ['vy', 'int16_t'], ['vz', 'int16_t'], ['hdg', 'uint16_t']] },
    36: { name: 'SERVO_OUTPUT_RAW', crc: 222, fields: [['time_usec', 'uint32_t'], ['servo1_raw', 'uint16_t'], ['servo2_raw', 'uint16_t'], ['servo3_raw', 'uint16_t'], ['servo4_raw', 'uint16_t'], ['servo5_raw', 'uint16_t'], ['servo6_raw', 'uint16_t'], ['servo7_raw', 'uint16_t'], ['servo8_raw', 'uint16_t'], ['port', 'uint8_t']], ext: [['servo9_raw', 'uint16_t'], ['servo10_raw', 'uint16_t'], ['servo11_raw', 'uint16_t'], ['servo12_raw', 'uint16_t'], ['servo13_raw', 'uint16_t'], ['servo14_raw', 'uint16_t'], ['servo15_raw', 'uint16_t'], ['servo16_raw', 'uint16_t']] },
    40: { name: 'MISSION_REQUEST', crc: 230, fields: [['seq', 'uint16_t'], ['target_system', 'uint8_t'], ['target_component', 'uint8_t']], ext: [['mission_type', 'uint8_t']] },
    42: { name: 'MISSION_CURRENT', crc: 28, fields: [['seq', 'uint16_t']], ext: [['total', 'uint16_t'], ['mission_state', 'uint8_t'], ['mission_mode', 'uint8_t']] },
    44: { name: 'MISSION_COUNT', crc: 221, fields: [['count', 'uint16_t'], ['target_system', 'uint8_t'], ['target_component', 'uint8_t']], ext: [['mission_type', 'uint8_t']] },
    45: { name: 'MISSION_CLEAR_ALL', crc: 232, fields: [['target_system', 'uint8_t'], ['target_component', 'uint8_t']], ext: [['mission_type', 'uint8_t']] },
    46: { name: 'MISSION_ITEM_REACHED', crc: 11, fields: [['seq', 'uint16_t']] },
    47: { name: 'MISSION_ACK', crc: 153, fields: [['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['type', 'uint8_t']], ext: [['mission_type', 'uint8_t']] },
    51: { name: 'MISSION_REQUEST_INT', crc: 196, fields: [['seq', 'uint16_t'], ['target_system', 'uint8_t'], ['target_component', 'uint8_t']], ext: [['mission_type', 'uint8_t']] },
    73: { name: 'MISSION_ITEM_INT', crc: 38, fields: [['param1', 'float'], ['param2', 'float'], ['param3', 'float'], ['param4', 'float'], ['x', 'int32_t'], ['y', 'int32_t'], ['z', 'float'], ['seq', 'uint16_t'], ['command', 'uint16_t'], ['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['frame', 'uint8_t'], ['current', 'uint8_t'], ['autocontinue', 'uint8_t']], ext: [['mission_type', 'uint8_t']] },
    74: { name: 'VFR_HUD', crc: 20, fields: [['airspeed', 'float'], ['groundspeed', 'float'], ['alt', 'float'], ['climb', 'float'], ['heading', 'int16_t'], ['throttle', 'uint16_t']] },
    76: { name: 'COMMAND_LONG', crc: 152, fields: [['param1', 'float'], ['param2', 'float'], ['param3', 'float'], ['param4', 'float'], ['param5', 'float'], ['param6', 'float'], ['param7', 'float'], ['command', 'uint16_t'], ['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['confirmation', 'uint8_t']] },
    77: { name: 'COMMAND_ACK', crc: 143, fields: [['command', 'uint16_t'], ['result', 'uint8_t']], ext: [['progress', 'uint8_t'], ['result_param2', 'int32_t'], ['target_system', 'uint8_t'], ['target_component', 'uint8_t']] },
    117: { name: 'LOG_REQUEST_LIST', crc: 128, fields: [['start', 'uint16_t'], ['end', 'uint16_t'], ['target_system', 'uint8_t'], ['target_component', 'uint8_t']] },
    118: { name: 'LOG_ENTRY', crc: 56, fields: [['time_utc', 'uint32_t'], ['size', 'uint32_t'], ['id', 'uint16_t'], ['num_logs', 'uint16_t'], ['last_log_num', 'uint16_t']] },
    119: { name: 'LOG_REQUEST_DATA', crc: 116, fields: [['ofs', 'uint32_t'], ['count', 'uint32_t'], ['id', 'uint16_t'], ['target_system', 'uint8_t'], ['target_component', 'uint8_t']] },
    120: { name: 'LOG_DATA', crc: 134, fields: [['ofs', 'uint32_t'], ['id', 'uint16_t'], ['count', 'uint8_t'], ['data', 'uint8_t', 90]] },
    122: { name: 'LOG_REQUEST_END', crc: 203, fields: [['target_system', 'uint8_t'], ['target_component', 'uint8_t']] },
    147: { name: 'BATTERY_STATUS', crc: 154, fields: [['current_consumed', 'int32_t'], ['energy_consumed', 'int32_t'], ['temperature', 'int16_t'], ['voltages', 'uint16_t', 10], ['current_battery', 'int16_t'], ['id', 'uint8_t'], ['battery_function', 'uint8_t'], ['type', 'uint8_t'], ['battery_remaining', 'int8_t']], ext: [['time_remaining', 'int32_t'], ['charge_state', 'uint8_t'], ['voltages_ext', 'uint16_t', 4], ['mode', 'uint8_t'], ['fault_bitmask', 'uint32_t']] },
    148: { name: 'AUTOPILOT_VERSION', crc: 178, fields: [['capabilities', 'uint64_t'], ['uid', 'uint64_t'], ['flight_sw_version', 'uint32_t'], ['middleware_sw_version', 'uint32_t'], ['os_sw_version', 'uint32_t'], ['board_version', 'uint32_t'], ['vendor_id', 'uint16_t'], ['product_id', 'uint16_t'], ['flight_custom_version', 'uint8_t', 8], ['middleware_custom_version', 'uint8_t', 8], ['os_custom_version', 'uint8_t', 8]], ext: [['uid2', 'uint8_t', 18]] },
    242: { name: 'HOME_POSITION', crc: 104, fields: [['latitude', 'int32_t'], ['longitude', 'int32_t'], ['altitude', 'int32_t'], ['x', 'float'], ['y', 'float'], ['z', 'float'], ['q', 'float', 4], ['approach_x', 'float'], ['approach_y', 'float'], ['approach_z', 'float']], ext: [['time_usec', 'uint64_t']] },
    245: { name: 'EXTENDED_SYS_STATE', crc: 130, fields: [['vtol_state', 'uint8_t'], ['landed_state', 'uint8_t']] },
    253: { name: 'STATUSTEXT', crc: 83, fields: [['severity', 'uint8_t'], ['text', 'char', 50]], ext: [['id', 'uint16_t'], ['chunk_seq', 'uint8_t']] }
});
export const MESSAGE_IDS = Object.freeze(Object.fromEntries(Object.entries(MESSAGES).map(([id, m]) => [m.name, Number(id)])));
const SIZE = { uint8_t: 1, int8_t: 1, char: 1, uint16_t: 2, int16_t: 2, uint32_t: 4, int32_t: 4, float: 4, uint64_t: 8, int64_t: 8, double: 8 };
const LAYOUT = new Map();
function layout(id) {
    let l = LAYOUT.get(id);
    if (l)
        return l;
    const m = MESSAGES[id];
    let at = 0;
    const place = ([name, type, n = 1]) => { const f = { name, type, n, at }; at += SIZE[type] * n; return f; };
    const base = m.fields.map(place), baseLen = at, ext = (m.ext ?? []).map(place);
    l = { fields: [...base, ...ext], baseLen, len: at };
    LAYOUT.set(id, l);
    return l;
}
/** CRC-16/MCRF4XX (the X.25 checksum MAVLink calls crc_accumulate), from 0xFFFF. Its check value: "123456789" → 0x6F91. */
export function crc16(bytes, crc = 0xffff) {
    for (const b of bytes) {
        let t = (b ^ crc) & 0xff;
        t = (t ^ (t << 4)) & 0xff;
        crc = ((crc >> 8) ^ (t << 8) ^ (t << 3) ^ (t >> 4)) & 0xffff;
    }
    return crc;
}
const ascii = s => new TextEncoder().encode(s);
/** A message's CRC_EXTRA from its definition, as mavgen computes it: the name and each base field's type and name. */
export function crcExtra(def) {
    let crc = crc16(ascii(`${def.name} `));
    for (const [name, type, n = 1] of def.fields) {
        crc = crc16(ascii(`${type} `), crc);
        crc = crc16(ascii(`${name} `), crc);
        if (n > 1)
            crc = crc16([n], crc);
    }
    return (crc & 0xff) ^ (crc >> 8);
}
function write(view, f, v) {
    const set = (at, x) => {
        switch (f.type) {
            case 'uint8_t': case 'char': view.setUint8(at, x); break;
            case 'int8_t': view.setInt8(at, x); break;
            case 'uint16_t': view.setUint16(at, x, true); break;
            case 'int16_t': view.setInt16(at, x, true); break;
            case 'uint32_t': view.setUint32(at, x, true); break;
            case 'int32_t': view.setInt32(at, x, true); break;
            case 'float': view.setFloat32(at, x, true); break;
            case 'double': view.setFloat64(at, x, true); break;
            case 'uint64_t': view.setBigUint64(at, BigInt(Math.trunc(x)), true); break;
            case 'int64_t': view.setBigInt64(at, BigInt(Math.trunc(x)), true); break;
        }
    };
    if (f.type === 'char') {
        const b = ascii(String(v ?? ''));
        if (b.length > f.n)
            throw Error(`${f.name}: at most ${f.n} characters`);
        b.forEach((x, i) => set(f.at + i, x));
        return;
    }
    if (f.n > 1) {
        for (let i = 0; i < f.n; i++)
            set(f.at + i * SIZE[f.type], Number(v?.[i] ?? 0));
        return;
    }
    const x = Number(v ?? 0);
    if (!Number.isFinite(x) && f.type !== 'float')
        throw Error(`${f.name}: not a number`);
    set(f.at, x);
}
function read(view, f) {
    const get = at => {
        switch (f.type) {
            case 'uint8_t': case 'char': return view.getUint8(at);
            case 'int8_t': return view.getInt8(at);
            case 'uint16_t': return view.getUint16(at, true);
            case 'int16_t': return view.getInt16(at, true);
            case 'uint32_t': return view.getUint32(at, true);
            case 'int32_t': return view.getInt32(at, true);
            case 'float': return view.getFloat32(at, true);
            case 'double': return view.getFloat64(at, true);
            case 'uint64_t': return Number(view.getBigUint64(at, true));
            case 'int64_t': return Number(view.getBigInt64(at, true));
        }
    };
    if (f.type === 'char') {
        let s = '';
        for (let i = 0; i < f.n; i++) {
            const c = get(f.at + i);
            if (!c)
                break;
            s += String.fromCharCode(c);
        }
        return s;
    }
    if (f.n > 1)
        return f.type === 'uint8_t' ? new Uint8Array(view.buffer, view.byteOffset + f.at, f.n).slice() : Array.from({ length: f.n }, (_, i) => get(f.at + i * SIZE[f.type]));
    return get(f.at);
}
/** One MAVLink 2 frame of `name` with `fields` (by their XML names; absent ones are 0) from sysid/compid, sequence `seq`. */
export function encode(name, fields = {}, { sysid = 255, compid = 190, seq = 0 } = {}) {
    const id = MESSAGE_IDS[name];
    if (id === undefined)
        throw Error(`no MAVLink message ${name} in this table`);
    const l = layout(id), payload = new Uint8Array(l.len), view = new DataView(payload.buffer);
    for (const f of l.fields)
        write(view, f, fields[f.name]);
    let len = l.len;
    while (len > 1 && payload[len - 1] === 0)
        len--;
    const frame = new Uint8Array(10 + len + 2);
    frame.set([0xfd, len, 0, 0, seq & 0xff, sysid, compid, id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff]);
    frame.set(payload.subarray(0, len), 10);
    const crc = crc16([MESSAGES[id].crc], crc16(frame.subarray(1, 10 + len)));
    frame[10 + len] = crc & 0xff;
    frame[11 + len] = crc >> 8;
    return frame;
}
/**
 * Every frame in one datagram (a UDP datagram may carry several) → { messages: [{ name, msgid, sysid, compid, frameSeq,
 * v, signed?, ...fields }], dropped: [{ reason, id? }] }. The header's names differ from every field's (`id` and `seq`
 * are fields of STATUSTEXT, the LOG_ and MISSION_ messages). A message this table does not know cannot be checked, so it is
 * dropped with that reason, like a frame with a bad checksum.
 */
export function decode(bytes) {
    const messages = [], dropped = [];
    let i = 0;
    while (i < bytes.length) {
        const stx = bytes[i];
        if (stx !== 0xfd && stx !== 0xfe) {
            i++;
            continue;
        }
        const v2 = stx === 0xfd, head = v2 ? 10 : 6;
        if (i + head > bytes.length) {
            dropped.push({ reason: 'a frame cut short' });
            break;
        }
        const len = bytes[i + 1], signed = v2 && (bytes[i + 2] & 1) === 1;
        const end = i + head + len + 2 + (signed ? 13 : 0);
        if (end > bytes.length) {
            dropped.push({ reason: 'a frame cut short' });
            break;
        }
        const id = v2 ? bytes[i + 7] | (bytes[i + 8] << 8) | (bytes[i + 9] << 16) : bytes[i + 5];
        const def = MESSAGES[id];
        if (!def) {
            dropped.push({ reason: 'not in this table', id });
            i = end;
            continue;
        }
        const crc = crc16([def.crc], crc16(bytes.subarray(i + 1, i + head + len)));
        if ((crc & 0xff) !== bytes[i + head + len] || (crc >> 8) !== bytes[i + head + len + 1]) {
            dropped.push({ reason: 'bad checksum', id });
            i++;
            continue;
        }
        const l = layout(id), payload = new Uint8Array(l.len);
        payload.set(bytes.subarray(i + head, i + head + Math.min(len, l.len)));
        const view = new DataView(payload.buffer), msg = { name: def.name, msgid: id, sysid: bytes[i + (v2 ? 5 : 3)], compid: bytes[i + (v2 ? 6 : 4)], frameSeq: bytes[i + (v2 ? 4 : 2)], v: v2 ? 2 : 1, ...(signed ? { signed: true } : {}) };
        for (const f of l.fields)
            if (v2 || f.at < l.baseLen)
                msg[f.name] = read(view, f);
        messages.push(msg);
        i = end;
    }
    return { messages, dropped };
}

/** MAV_CMD ids the drivers send, and the mission commands they upload. */
export const CMD = Object.freeze({
    NAV_WAYPOINT: 16, NAV_LOITER_UNLIM: 17, NAV_LOITER_TURNS: 18, NAV_LOITER_TIME: 19, NAV_RETURN_TO_LAUNCH: 20, NAV_LAND: 21,
    NAV_TAKEOFF: 22, NAV_LOITER_TO_ALT: 31, NAV_VTOL_TAKEOFF: 84, NAV_VTOL_LAND: 85, DO_SET_MODE: 176, DO_JUMP: 177,
    DO_CHANGE_SPEED: 178, DO_LAND_START: 189, MISSION_START: 300, COMPONENT_ARM_DISARM: 400, SET_MESSAGE_INTERVAL: 511,
    REQUEST_MESSAGE: 512, DO_VTOL_TRANSITION: 3000
});
export const CMD_NAMES = Object.freeze(Object.fromEntries(Object.entries(CMD).map(([k, v]) => [v, k])));
export const RESULT = Object.freeze(['accepted', 'temporarily rejected', 'denied', 'unsupported', 'failed', 'in progress', 'cancelled', 'command long only', 'command int only', 'unsupported frame']);
export const MISSION_RESULT = Object.freeze(['accepted', 'error', 'unsupported frame', 'unsupported', 'no space', 'invalid', 'invalid param1', 'invalid param2', 'invalid param3', 'invalid param4', 'invalid param5 (x)', 'invalid param6 (y)', 'invalid param7 (z)', 'invalid sequence', 'denied', 'operation cancelled']);
export const SEVERITY = Object.freeze(['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug']);
export const LANDED = Object.freeze(['undefined', 'on ground', 'in air', 'takeoff', 'landing']);
export const VTOL = Object.freeze(['undefined', 'transition to fixed-wing', 'transition to multicopter', 'multicopter', 'fixed-wing']);
/** MAV_PARAM_TYPE: the integer types; 9 is a 32-bit float. ArduPilot sends every value as a float (cast). */
export const PARAM_TYPE = Object.freeze({ 1: 'uint8', 2: 'int8', 3: 'uint16', 4: 'int16', 5: 'uint32', 6: 'int32', 9: 'float' });
/**
 * ArduPlane's flight modes by custom_mode (ArduPlane/mode.h, e204ca77). The words are ArduPlane's short names. A mode
 * number has a name only when the heartbeat says ArduPilot on a plane or a QuadPlane VTOL type.
 */
export const PLANE_MODES = Object.freeze({ MANUAL: 0, CIRCLE: 1, STABILIZE: 2, TRAINING: 3, ACRO: 4, FBWA: 5, FBWB: 6, CRUISE: 7, AUTOTUNE: 8, AUTO: 10, RTL: 11, LOITER: 12, TAKEOFF: 13, AVOID_ADSB: 14, GUIDED: 15, INITIALISING: 16, QSTABILIZE: 17, QHOVER: 18, QLOITER: 19, QLAND: 20, QRTL: 21, QAUTOTUNE: 22, QACRO: 23, THERMAL: 24, LOITER_ALT_QLAND: 25, AUTOLAND: 26 });
const PLANE_MODE_NAMES = Object.fromEntries(Object.entries(PLANE_MODES).map(([k, v]) => [v, k]));
/** MAV_TYPE values ArduPlane reports: FIXED_WING, and the VTOL types (QuadPlane get_mav_type, Q_MAV_TYPE). */
export const PLANE_TYPES = Object.freeze([1, 19, 20, 21, 22, 23, 24, 25]);
export const isPlane = hb => hb?.autopilot === AUTOPILOT_ARDUPILOT && PLANE_TYPES.includes(hb.type);
/** The safing modes of an ArduPlane: any principal with any grant on the unit may set them (AGENTS.md). */
export const SAFING_MODES = Object.freeze(['RTL', 'QLAND']);
export function modeName(hb) {
    if (!Number.isInteger(hb?.custom_mode))
        return null;
    return (isPlane(hb) && PLANE_MODE_NAMES[hb.custom_mode]) || `mode ${hb.custom_mode}`;
}
/** "ArduPilot 4.8.0-dev (e204ca77)" from AUTOPILOT_VERSION: flight_sw_version is major · minor · patch · release type. */
export function versionString(msg) {
    const v = msg.flight_sw_version >>> 0, type = v & 0xff;
    const kind = type === 255 ? '' : type >= 192 ? '-rc' : type >= 128 ? '-beta' : type >= 64 ? '-alpha' : '-dev';
    const git = String.fromCharCode(...Array.from(msg.flight_custom_version ?? []).filter(c => c >= 0x20 && c < 0x7f));
    return `${v >>> 24}.${(v >> 16) & 0xff}.${(v >> 8) & 0xff}${kind}${git ? ` (${git})` : ''}`;
}
const finite = v => typeof v === 'number' && Number.isFinite(v);
const pick = (msg, names) => Object.fromEntries(names.filter(k => finite(msg[k])).map(k => [k, msg[k]]));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
/**
 * One decoded message ({ name, ...fields }) → the record a `mavlink` channel keeps of it, without t/seq/src:
 * { kind: 'state', status, ... } | { kind: 'event', ... } | null for a message this channel does not record. `status` is
 * the last HEARTBEAT's; a HEARTBEAT sets it. Kept for the showcase and the motion tests: mavlinkState(msg, status).
 */
export function mavlinkRecord(msg, status = 'no heartbeat') {
    switch (msg?.name) {
        case 'HEARTBEAT': {
            if (!Number.isInteger(msg.base_mode))
                return null;
            const mode = modeName(msg);
            return { kind: 'state', status: msg.base_mode & ARMED_FLAG ? 'armed' : 'disarmed', ...(mode ? { mode } : {}) };
        }
        case 'ATTITUDE':
            return { kind: 'state', status, values: pick(msg, ['roll', 'pitch', 'yaw']) };
        case 'ATTITUDE_QUATERNION':
            return { kind: 'state', status, values: pick(msg, ['q1', 'q2', 'q3', 'q4']) };
        case 'LOCAL_POSITION_NED':
            return { kind: 'state', status, values: pick(msg, ['x', 'y', 'z', 'vx', 'vy', 'vz']) };
        case 'GLOBAL_POSITION_INT': {
            if (!finite(msg.lat) || !finite(msg.lon))
                return null;
            const values = { lat: msg.lat / 1e7, lon: msg.lon / 1e7, alt: msg.alt / 1000, alt_rel: msg.relative_alt / 1000 };
            // UINT16_MAX: the heading is not known.
            if (finite(msg.hdg) && msg.hdg !== 65535)
                values.hdg = msg.hdg / 100;
            return { kind: 'state', status, values };
        }
        case 'VFR_HUD':
            return { kind: 'state', status, values: pick(msg, ['airspeed', 'groundspeed', 'throttle', 'climb']) };
        case 'SYS_STATUS': {
            const values = {};
            // UINT16_MAX volts, -1 amps and -1 % are "not sent by the autopilot".
            if (finite(msg.voltage_battery) && msg.voltage_battery !== 65535)
                values.battery_v = msg.voltage_battery / 1000;
            if (finite(msg.current_battery) && msg.current_battery !== -1)
                values.battery_a = msg.current_battery / 100;
            if (finite(msg.battery_remaining) && msg.battery_remaining !== -1)
                values.battery_pct = msg.battery_remaining;
            // MAV_SYS_STATUS_PREARM_CHECK: the autopilot's own arming checks, when it reports them.
            const prearm = (msg.onboard_control_sensors_present & PREARM_CHECK) !== 0 ? { prearm: (msg.onboard_control_sensors_health & PREARM_CHECK) !== 0 ? 'pass' : 'fail' } : {};
            return { kind: 'state', status, ...prearm, values };
        }
        case 'BATTERY_STATUS': {
            // The record shape names one battery: the first monitor. A second monitor's numbers are not recorded.
            if ((msg.id ?? 0) !== 0)
                return null;
            const values = {};
            if (finite(msg.current_consumed) && msg.current_consumed !== -1)
                values.battery_mah = msg.current_consumed;
            if (finite(msg.temperature) && msg.temperature !== 32767)
                values.battery_temp = msg.temperature / 100;
            return { kind: 'state', status, values };
        }
        case 'GPS_RAW_INT':
            return { kind: 'state', status, values: { gps_fix: msg.fix_type, ...(msg.satellites_visible !== 255 ? { gps_sats: msg.satellites_visible } : {}) } };
        case 'EXTENDED_SYS_STATE':
            return { kind: 'state', status, landed: LANDED[msg.landed_state] ?? `landed state ${msg.landed_state}`, vtol: VTOL[msg.vtol_state] ?? `vtol state ${msg.vtol_state}` };
        case 'MISSION_CURRENT':
            return { kind: 'state', status, values: { mission_seq: msg.seq, ...(finite(msg.total) && msg.total !== 65535 && msg.v === 2 ? { mission_total: msg.total } : {}) } };
        case 'HOME_POSITION':
            return { kind: 'state', status, values: { home_lat: msg.latitude / 1e7, home_lon: msg.longitude / 1e7, home_alt: round(msg.altitude / 1000, 3) } };
        case 'SERVO_OUTPUT_RAW': {
            // Port 1 and up are further banks whose numbering is the autopilot's; this shape names port 0's outputs only.
            if ((msg.port ?? 0) !== 0)
                return null;
            const values = {};
            for (let i = 1; i <= SERVO_OUTPUTS; i++)
                if (finite(msg[`servo${i}_raw`]) && msg[`servo${i}_raw`] > 0)
                    values[`servo${i}`] = msg[`servo${i}_raw`];
            return { kind: 'state', status, values };
        }
        case 'STATUSTEXT':
            return { kind: 'event', severity: SEVERITY[msg.severity] ?? `severity ${msg.severity}`, text: msg.text };
        default:
            return null;
    }
}
/** The state part of mavlinkRecord: { status, values?, mode? } for state messages, null otherwise. */
export function mavlinkState(msg, status = 'no heartbeat') {
    const r = mavlinkRecord(msg, status);
    if (!r || r.kind !== 'state')
        return null;
    const { kind: _k, ...rest } = r;
    return rest;
}
/**
 * STATUSTEXT in chunks (MAVLink 2: `id` non-zero, `chunk_seq` from 0; the last chunk is shorter than 50 characters).
 * push(msg) → the whole text when it is complete, else null. A chunk out of order drops what was held for that id.
 */
export function createStatusTexts() {
    const held = new Map();
    return {
        push(msg) {
            if (!msg.id)
                return msg.text;
            const h = held.get(msg.id) ?? { next: 0, text: '' };
            if (msg.chunk_seq !== h.next) {
                held.delete(msg.id);
                return null;
            }
            h.text += msg.text;
            h.next++;
            if (msg.text.length < 50) {
                held.delete(msg.id);
                return h.text;
            }
            held.set(msg.id, h);
            return null;
        }
    };
}

/** Great-circle distance in metres (haversine, mean Earth radius). */
export function distanceM(a, b) {
    const R = 6371008.8, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/**
 * The mission commands the command driver uploads. Each names whether it has a position (`at`), whether 0, 0 means
 * "where the aircraft is" (`here`) and what its four params mean. A command not listed (DO_SET_SERVO, DO_SET_RELAY,
 * DO_FLIGHTTERMINATION …) is refused: it can move an output the CAD holds (the fold) or end a flight, and no bound here
 * covers it.
 */
export const MISSION_COMMANDS = Object.freeze({
    WAYPOINT: { cmd: CMD.NAV_WAYPOINT, at: true },
    LOITER_UNLIM: { cmd: CMD.NAV_LOITER_UNLIM, at: true },
    LOITER_TURNS: { cmd: CMD.NAV_LOITER_TURNS, at: true },
    LOITER_TIME: { cmd: CMD.NAV_LOITER_TIME, at: true },
    LOITER_TO_ALT: { cmd: CMD.NAV_LOITER_TO_ALT, at: true },
    RETURN_TO_LAUNCH: { cmd: CMD.NAV_RETURN_TO_LAUNCH, at: false },
    LAND: { cmd: CMD.NAV_LAND, at: true, here: true, ground: true },
    TAKEOFF: { cmd: CMD.NAV_TAKEOFF, at: true, here: true },
    VTOL_TAKEOFF: { cmd: CMD.NAV_VTOL_TAKEOFF, at: true, here: true },
    VTOL_LAND: { cmd: CMD.NAV_VTOL_LAND, at: true, here: true, ground: true },
    DO_CHANGE_SPEED: { cmd: CMD.DO_CHANGE_SPEED, at: false },
    DO_JUMP: { cmd: CMD.DO_JUMP, at: false },
    DO_LAND_START: { cmd: CMD.DO_LAND_START, at: false },
    DO_VTOL_TRANSITION: { cmd: CMD.DO_VTOL_TRANSITION, at: false }
});
/** MAV_FRAME_GLOBAL_RELATIVE_ALT (altitude above home) for items with a position, MAV_FRAME_MISSION for the rest. */
export const FRAME_RELATIVE_ALT = 3;
export const FRAME_MISSION = 2;
const MAX_ITEMS = 500;
/**
 * A mission as the principal wrote it → the MISSION_ITEM_INT fields to upload, seq 0 first (ArduPilot keeps seq 0 as
 * home and does not fly it), or throws the reason it is refused. Items: { command, lat?, lon?, alt?, params?: [p1…p4] }
 * (alt in m above home). `limits` is the channel's: `altitude_m` (no item above it), `radius_m` (no position farther
 * from home; needs `home`), `speed_ms` (no DO_CHANGE_SPEED above it).
 */
export function missionItems(items, { home = null, limits = {} } = {}) {
    if (!Array.isArray(items) || !items.length)
        throw Error('a mission is a non-empty list of items');
    if (items.length > MAX_ITEMS)
        throw Error(`a mission has at most ${MAX_ITEMS} items`);
    const altMax = limits.altitude_m, radius = limits.radius_m;
    const out = [{ seq: 0, frame: 0, command: CMD.NAV_WAYPOINT, current: 0, autocontinue: 1, x: Math.round((home?.lat ?? 0) * 1e7), y: Math.round((home?.lon ?? 0) * 1e7), z: home?.alt ?? 0, mission_type: 0 }];
    items.forEach((item, i) => {
        const where = `item ${i + 1}`, spec = MISSION_COMMANDS[String(item?.command ?? '').toUpperCase()];
        if (!spec)
            throw Error(`${where}: ${item?.command} is not a mission command this driver uploads (${Object.keys(MISSION_COMMANDS).join(', ')})`);
        const p = Array.isArray(item.params) ? item.params : [];
        if (p.length > 4 || !p.every(finite))
            throw Error(`${where}: params are at most four numbers`);
        const fields = { seq: i + 1, frame: spec.at ? FRAME_RELATIVE_ALT : FRAME_MISSION, command: spec.cmd, current: 0, autocontinue: 1, param1: p[0] ?? 0, param2: p[1] ?? 0, param3: p[2] ?? 0, param4: p[3] ?? 0, x: 0, y: 0, z: 0, mission_type: 0 };
        if (spec.at) {
            // A landing ends on the ground: its altitude may be left out (0).
            const { lat = 0, lon = 0, alt = spec.ground ? 0 : undefined } = item;
            if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
                throw Error(`${where}: lat and lon are degrees`);
            const here = lat === 0 && lon === 0;
            if (here && !spec.here)
                throw Error(`${where}: ${item.command} needs a position (lat, lon)`);
            if (!finite(alt))
                throw Error(`${where}: alt is metres above home`);
            if (alt < 0)
                throw Error(`${where}: alt ${alt} m is below home`);
            if (finite(altMax) && alt > altMax)
                throw Error(`${where}: alt ${alt} m is above the declared ${altMax} m`);
            if (finite(radius) && !here) {
                if (!home)
                    throw Error(`${where}: the declared radius (${radius} m from home) cannot be checked: the autopilot has not said where home is`);
                const d = distanceM(home, { lat, lon });
                if (d > radius)
                    throw Error(`${where}: ${Math.round(d)} m from home, beyond the declared ${radius} m`);
            }
            Object.assign(fields, { x: Math.round(lat * 1e7), y: Math.round(lon * 1e7), z: alt });
        }
        if (spec.cmd === CMD.DO_JUMP) {
            const [target, repeat] = p;
            if (!Number.isInteger(target) || target < 1 || target > items.length)
                throw Error(`${where}: DO_JUMP's first param is an item number 1..${items.length}`);
            // ArduPilot repeats a jump forever when the count is -1; a mission that never ends is not bounded.
            if (!Number.isInteger(repeat) || repeat < 0 || repeat > 100)
                throw Error(`${where}: DO_JUMP's repeat count is 0..100`);
        }
        if (spec.cmd === CMD.DO_CHANGE_SPEED && finite(limits.speed_ms) && (p[1] ?? 0) > limits.speed_ms)
            throw Error(`${where}: speed ${p[1]} m/s is above the declared ${limits.speed_ms} m/s`);
        out.push(fields);
    });
    return out;
}
export const PARAM_NAME = /^[A-Z0-9_]{1,16}$/;
const matchName = (pattern, name) => pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
/**
 * Why setting parameter `name` to `value` is refused, or null. `limits` is the params channel's: `writable` (when
 * declared, only these names or `PREFIX*` patterns may be set) and `params` ({ NAME: { min?, max?, equals?, above?,
 * disarmed? } }: a range, equal to or above another parameter's current value, only while the aircraft is disarmed).
 * `current` holds the values the autopilot reported (by name); `armed` is the last heartbeat's (null: not known).
 */
export function paramRefusal(name, value, limits = {}, { current = {}, armed = null } = {}) {
    if (typeof name !== 'string' || !PARAM_NAME.test(name))
        return 'a parameter name is 1 to 16 characters A-Z, 0-9 or _';
    if (!finite(value))
        return `${name}: the value is not a number`;
    if (Array.isArray(limits.writable) && !limits.writable.some(p => matchName(p, name)))
        return `${name} is not in the parameters this unit declares writable`;
    const b = limits.params?.[name];
    if (!b)
        return null;
    const why = b.why ? ` (${b.why})` : '';
    if (finite(b.min) && value < b.min)
        return `${name} ${value} is below ${b.min}${why}`;
    if (finite(b.max) && value > b.max)
        return `${name} ${value} is above ${b.max}${why}`;
    if (b.disarmed && armed !== false)
        return `${name} is set only while the aircraft is disarmed, and it is ${armed === null ? 'not known to be disarmed' : 'armed'}${why}`;
    for (const [rule, ok, words] of [['equals', (v, o) => v === o, 'equal to'], ['above', (v, o) => v > o, 'above']]) {
        const other = b[rule];
        if (!other)
            continue;
        if (!finite(current[other]))
            return `${name} must be ${words} ${other}, whose value the autopilot has not reported${why}`;
        if (!ok(value, current[other]))
            return `${name} ${value} is not ${words} ${other} ${current[other]}${why}`;
    }
    return null;
}
