// The bench and the site's pages. Run: node --test tests/lab.test.mjs (Node 22 or 24).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBench, PRESETS } from '../lab/bench.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const channel = JSON.parse(readFileSync(resolve(root, 'engine/machines/so101.json'), 'utf8'));
const bench = createBench(channel);
const runPreset = name => {
    const d = bench.readDescription(JSON.stringify(PRESETS[name]));
    return { d, run: bench.simulate(d) };
};

test('a description that names a reachable point reaches it, inside every joint range', () => {
    const { d, run } = runPreset('reach');
    assert.equal(run.reached, true, `IK error ${run.error}`);
    const [x, y, z] = run.frames.at(-1).tool;
    const [gx, gy, gz] = d.goal;
    assert.ok(Math.hypot(x - gx, y - gy, z - gz) < 0.002, `tool ${[x, y, z]} vs goal ${[gx, gy, gz]}`);
    assert.ok(run.seconds < 2, `settled after ${run.seconds} s`);
    for (const f of run.frames)
        for (const [i, q] of f.q.entries())
            assert.ok(q >= bench.model.joints[i].lo - 1e-9 && q <= bench.model.joints[i].hi + 1e-9, `frame ${f.t}: joint ${i} at ${q}`);
    assert.ok(run.maxTorque > 0 && run.maxTorque <= Math.max(...bench.model.joints.map(j => j.maxTorque)), 'a torque within the servos’ limits');
});

test('the payload reaches the servos: the same move with a load droops, and a heavy one cannot be held', () => {
    const withLoad = grams => bench.simulate(bench.readDescription(JSON.stringify({ ...PRESETS.reach, payload_g: grams })));
    const free = withLoad(0), loaded = withLoad(250), heavy = withLoad(2000);
    assert.equal(free.reached && loaded.reached && heavy.reached, true, 'the goal is reachable in all three');
    const z = run => run.frames.at(-1).tool[2];
    assert.ok(z(loaded) < z(free), `250 g settles lower (${z(loaded)} vs ${z(free)} m)`);
    assert.ok(loaded.seconds > free.seconds, `and takes longer (${loaded.seconds} vs ${free.seconds} s)`);
    // Two kilograms at the tool out-torque the servos: the arm sags well below the goal instead of holding it.
    assert.ok(z(heavy) < z(free) - 0.05, `2 kg sags to ${z(heavy)} m against a goal at ${z(free)} m`);
});

test('a point out of reach is reported, never faked', () => {
    const { run } = runPreset('unreachable');
    assert.equal(run.reached, false);
    assert.ok(run.error > 0.05, `IK error ${run.error} m`);
});

test('a description is refused, with a plain reason, when it does not say enough', () => {
    const bad = mutate => JSON.stringify(mutate(structuredClone(PRESETS.reach)));
    assert.throws(() => bench.readDescription('not json'), /the text is not JSON/);
    assert.throws(() => bench.readDescription(bad(d => ({ ...d, machine: 'arm9000' }))), /machine must be "so101"/);
    assert.throws(() => bench.readDescription(bad(d => ({ ...d, start: { ...d.start, shoulder_pan: 9 } }))), /shoulder_pan 9 is outside/);
    assert.throws(() => bench.readDescription(bad(d => { const s = { ...d.start }; delete s.elbow_flex; return { ...d, start: s }; })), /start\.elbow_flex must be a number/);
    assert.throws(() => bench.readDescription(bad(d => ({ ...d, goal_mm: [1, 2] }))), /goal_mm must be/);
    assert.throws(() => bench.readDescription(bad(d => ({ ...d, payload_g: -5 }))), /payload_g must be/);
});

// The pages: the same three locales, each complete, each linking to the others, with nothing from another origin.
const PAGES = [
    { file: 'index.html', lang: 'en', base: '' },
    { file: 'es/index.html', lang: 'es', base: '../' },
    { file: 'zh-Hans/index.html', lang: 'zh-Hans', base: '../' },
    { file: 'docs/index.html', lang: 'en', base: '../' },
    { file: 'es/docs/index.html', lang: 'es', base: '../../' },
    { file: 'zh-Hans/docs/index.html', lang: 'zh-Hans', base: '../../' },
];
const read = file => readFileSync(resolve(root, file), 'utf8');

test('every page is in its locale, loads only this site, and every link and asset it names exists', () => {
    for (const { file, lang, base } of PAGES) {
        const html = read(file);
        assert.match(html, new RegExp(`<html lang="${lang}">`), `${file}: the page's language`);
        const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1].replace(/[?#].*$/, ''))
            .filter(u => u && !u.startsWith('mailto:') && !u.startsWith('https://vibesim.commandagi.app') && !u.startsWith('/'));
        assert.ok(refs.length, `${file}: it names its stylesheet and script`);
        for (const ref of refs) {
            const target = resolve(root, dirname(file), ref);
            const found = existsSync(target) && (ref.endsWith('/') ? existsSync(resolve(target, 'index.html')) : true);
            assert.ok(found, `${file}: ${ref} exists`);
        }
        assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//, `${file}: no script from another origin`);
        assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"[^>]+href="https?:\/\//, `${file}: no stylesheet from another origin`);
        assert.doesNotMatch(html, /<(img|iframe|source)[^>]+src="https?:\/\//, `${file}: no image or frame from another origin`);
    }
});

test('the language dialog lists all three locales on every page, in their own names', () => {
    for (const { file } of PAGES) {
        const html = read(file);
        const dialog = /<dialog id="lang-dialog"[\s\S]*?<\/dialog>/.exec(html);
        assert.ok(dialog, `${file}: the language dialog`);
        for (const [href, name] of [['en', 'English'], ['es', 'Español'], ['zh-Hans', '简体中文']])
            assert.ok(dialog[0].includes(`<span lang="${href}"`) && dialog[0].includes(name), `${file}: ${name} in the dialog`);
        assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1, `${file}: exactly one current language`);
        assert.match(html, /class="lang-btn"[\s\S]*?A<span>\/<\/span><span lang="zh-Hans">文<\/span>/, `${file}: the A/文 button`);
    }
});

test('the two home pages carry the lab: the canvas, the description, and the three examples', () => {
    for (const file of ['index.html', 'es/index.html', 'zh-Hans/index.html']) {
        const html = read(file);
        assert.match(html, /<canvas id="stage"/, `${file}: the canvas`);
        assert.match(html, /<textarea id="scene"/, `${file}: the description`);
        for (const preset of ['reach', 'pick', 'unreachable']) assert.ok(html.includes(`data-preset="${preset}"`), `${file}: ${preset}`);
        assert.match(html, /<script type="module" src="[^"]*lab\/lab\.js"/, `${file}: the bench's script`);
    }
});
