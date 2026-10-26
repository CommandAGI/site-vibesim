/**
 * The `print-job` record shapes (docs/devices.md § record shapes per format), shared by every print-server
 * protocol: OctoPrint, Moonraker, PrusaLink, Repetier-Server and RepRapFirmware. Pure: no network, no DOM.
 *
 *   command (in)  { verb: start | pause | resume | cancel | home | set, file?, target?, value? }
 *   reply (out)   { text, http? }   what the server answered, summarized; never proof the machine did it
 *   state (out)   { status: idle | printing | paused | error | unknown, progress?: 0..1, file?, values }
 *
 * `set` targets: nozzle, bed (°C), feedOverride (percent, 100 = as programmed), spindle (rpm), laser (0..1).
 * A nozzle target may name its extruder, `tool` (0-based; absent = the first / the active one, as the server has it).
 * `values` carries only what the server measured this poll; an absent key means nobody measured it:
 *   nozzle, nozzleTarget      the first extruder (tool 0), or the active tool where the server reports only that
 *   nozzle1…nozzle15 (+Target) further extruders, by tool number
 *   tool                      the active tool, where the server reports it
 *   spindle, spindleTarget    rpm measured / commanded (negative = counter-clockwise), CNC mode
 *   laser                     laser power now, 0..1 of full, laser mode
 */
export const PRINT_VERBS = Object.freeze(['start', 'pause', 'resume', 'cancel', 'home', 'set']);
export const SET_TARGETS = Object.freeze(['nozzle', 'bed', 'feedOverride', 'spindle', 'laser']);
export const PRINT_STATUSES = Object.freeze(['idle', 'printing', 'paused', 'error', 'unknown']);
const EXTRA_NOZZLES = Array.from({ length: 15 }, (_, i) => [`nozzle${i + 1}`, `nozzle${i + 1}Target`]).flat();
/** Every value name a `print-job` state record can carry. */
export const VALUE_KEYS = Object.freeze(['nozzle', 'nozzleTarget', ...EXTRA_NOZZLES, 'tool', 'bed', 'bedTarget', 'x', 'y', 'z', 'feedOverride', 'spindle', 'spindleTarget', 'laser']);
/** The `values` keys of extruder `i`'s temperature and target: tool 0 is `nozzle`, tool 3 is `nozzle3`. */
export const nozzleKeys = i => i === 0 ? ['nozzle', 'nozzleTarget'] : [`nozzle${i}`, `nozzle${i}Target`];
/** The most extruders a state record names (tool 0 … 15). */
export const MAX_TOOLS = 16;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const refuse = message => Object.assign(Error(message), { status: 422 });
/** A state record from what one poll learned. Drops non-finite values; never writes them as 0. */
export function printState({ status, progress, file, values = {} }) {
    if (!PRINT_STATUSES.includes(status))
        throw Error(`print-job status must be one of ${PRINT_STATUSES.join(', ')}`);
    const r = { src: 'device', kind: 'state', status };
    if (finite(progress))
        r.progress = Math.max(0, Math.min(1, progress));
    if (typeof file === 'string' && file)
        r.file = file;
    r.values = {};
    for (const k of VALUE_KEYS)
        if (finite(values[k]))
            r.values[k] = values[k];
    return r;
}
/** The state record for a server that did not answer (or answered something unreadable). */
export const unknownState = () => ({ src: 'device', kind: 'state', status: 'unknown' });
/** A reply record: the server's answer in a line. `http` is the status code when there was one. */
export function printReply(text, http) {
    const r = { src: 'device', kind: 'reply', text: String(text).slice(0, 500) };
    if (Number.isInteger(http))
        r.http = http;
    return r;
}
/** Validate a command record's verb/target/value; throws (status 422) before anything is sent. */
export function checkPrintCommand(record) {
    if (!record || typeof record !== 'object')
        throw refuse('send one command record: { verb, target?, value? }');
    const { verb, target, value, file, tool } = record;
    if (!PRINT_VERBS.includes(verb))
        throw refuse(`unknown print-job verb ${verb}; one of ${PRINT_VERBS.join(', ')}`);
    if (verb !== 'set')
        return { verb, ...(typeof file === 'string' && file ? { file } : {}) };
    if (!SET_TARGETS.includes(target))
        throw refuse(`set needs a target: one of ${SET_TARGETS.join(', ')}`);
    if (!finite(value) || value < 0)
        throw refuse(`set ${target} needs a finite, non-negative value`);
    if (target === 'laser' && value > 1)
        throw refuse('set laser takes a fraction of full power, 0..1');
    if (target === 'feedOverride' && (value < 1 || value > 500))
        throw refuse('set feedOverride takes a percent, 1..500');
    if ((target === 'nozzle' || target === 'bed') && value > 500)
        throw refuse(`set ${target} above 500 °C is not a temperature any of these servers accepts`);
    if (tool !== undefined && (target !== 'nozzle' || !Number.isInteger(tool) || tool < 0 || tool >= MAX_TOOLS))
        throw refuse(`tool names an extruder (0..${MAX_TOOLS - 1}) for a nozzle target`);
    return { verb, target, value, ...(tool !== undefined ? { tool } : {}) };
}
/** The command record that the host writes before the command goes to the server. */
export function printCommand(cmd) {
    const r = { src: 'operator', kind: 'command', verb: cmd.verb };
    for (const k of ['file', 'target', 'value', 'tool'])
        if (cmd[k] !== undefined)
            r[k] = cmd[k];
    return r;
}
const PROGRAM_EXT = ['gcode', 'gco', 'g', 'nc', 'ngc', 'tap'];
/**
 * The name for a program upload, which no server could mistake for a path: the file's own name when the page
 * or agent ran one (`source`, e.g. `bracket v2.gcode` → `bracket-v2-20260928T101500Z.gcode`), else the unit; then the
 * UTC time, so an upload never overwrites an earlier one.
 */
export function uploadName(uid, date = new Date(), source = null) {
    const clean = v => String(v ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const base = typeof source === 'string' ? source.split(/[\\/]/).pop() : '';
    const dot = base.lastIndexOf('.'), ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
    const stem = clean(dot > 0 ? base.slice(0, dot) : base);
    if (stem)
        return `${stem}-${stamp}.${PROGRAM_EXT.includes(ext) ? ext : 'gcode'}`;
    return `commandagi-${clean(uid) || 'unit'}-${stamp}.gcode`;
}
