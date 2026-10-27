// The site in Chrome: each locale's home page loads with nothing thrown, the hero's swarm reads a sentence, the four
// verbs scene follows the scroll, the lab runs a description to its goal, the
// language dialog opens with the three locales, and no page scrolls sideways at 390 px.
// Run: node tests/browser_lab.mjs (CHROME_PATH names the binary; it serves the folder on 127.0.0.1).
// Or: SITE_URL=https://vibesim.commandagi.app node tests/browser_lab.mjs — the same checks against a deployed site.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const PAGES = [
    { path: '/', reached: 'Reached', lang: 'en' },
    { path: '/es/', reached: 'Alcanzado', lang: 'es' },
    { path: '/zh-Hans/', reached: '已到达', lang: 'zh-Hans' },
    { path: '/docs/', reached: null, lang: 'en' },
    { path: '/es/docs/', reached: null, lang: 'es' },
    { path: '/zh-Hans/docs/', reached: null, lang: 'zh-Hans' },
];

/** A Chrome DevTools Protocol client over Node's own WebSocket: just what this check needs. */
async function openChrome(profile) {
    const chrome = spawn(process.env.CHROME_PATH ?? 'google-chrome', ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const wsUrl = await new Promise((ok, fail) => {
        let seen = '';
        const timer = setTimeout(() => fail(Error(`chrome did not open its DevTools socket: ${seen.slice(-1500)}`)), 60000);
        chrome.stderr.on('data', d => {
            seen += d;
            const m = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
            if (m) { clearTimeout(timer); ok(m[1]); }
        });
        chrome.on('exit', code => { clearTimeout(timer); fail(Error(`chrome exited ${code}: ${seen.slice(-1500)}`)); });
    });
    const socket = new WebSocket(wsUrl);
    await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = () => fail(Error('the DevTools socket failed')); });
    let id = 0;
    const waiting = new Map(), listeners = [];
    socket.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.id && waiting.has(m.id)) { const { ok, fail } = waiting.get(m.id); waiting.delete(m.id); m.error ? fail(Error(JSON.stringify(m.error))) : ok(m.result); }
        for (const l of listeners) l(m);
    };
    const send = (method, params = {}) => new Promise((ok, fail) => { const n = ++id; waiting.set(n, { ok, fail }); socket.send(JSON.stringify({ id: n, method, params })); });
    const once = name => new Promise(ok => { const l = m => { if (m.method === name) { listeners.splice(listeners.indexOf(l), 1); ok(m.params); } }; listeners.push(l); });
    const { targetInfos } = await send('Target.getTargets');
    const page = targetInfos.find(t => t.type === 'page');
    const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const call = (method, params = {}) => new Promise((ok, fail) => { const n = ++id; waiting.set(n, { ok, fail }); socket.send(JSON.stringify({ id: n, method, params, sessionId })); });
    const errors = [];
    listeners.push(m => {
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
        if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
    });
    await call('Runtime.enable');
    await call('Page.enable');
    await call('Log.enable');
    const evaluate = async expression => {
        const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
    };
    const goto = async url => {
        const loaded = once('Page.loadEventFired');
        await call('Page.navigate', { url });
        await loaded;
    };
    // The profile is removed right after this: wait for the process to exit, or Chrome's own writes race the rmdir.
    return { evaluate, goto, errors, call, close: async () => { socket.close(); chrome.kill(); if (chrome.exitCode === null && chrome.signalCode === null) await new Promise(ok => chrome.once('exit', ok)); } };
}

const deployed = process.env.SITE_URL ?? null;
const server = deployed ? null : createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = resolve(join(root, rel.endsWith('/') || !extname(rel) ? join(rel, 'index.html') : rel));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    const body = await readFile(file).catch(() => null);
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
});
if (server) await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const base = deployed ?? `http://127.0.0.1:${server.address().port}`;

const profile = await mkdtemp(join(tmpdir(), 'vibesim-chrome-'));
let page;
const problems = [];
try {
    page = await openChrome(profile);
    for (const { path, reached, lang } of PAGES) {
        page.errors.length = 0;
        await page.goto(base + path);
        const state = await page.evaluate(`({ lang: document.documentElement.lang, title: document.title, h1: document.querySelector('h1')?.textContent?.trim() })`);
        if (state.lang !== lang) problems.push(`${path}: lang ${state.lang}, expected ${lang}`);
        if (!state.h1) problems.push(`${path}: no heading`);
        if (reached) {
            // The bench: its module loaded the machine, so the run button starts a run and the status says it arrived.
            await page.evaluate(`new Promise(ok => { const t0 = performance.now(); const tick = () => { if (document.documentElement.dataset.bench === 'ready') return ok(true); if (performance.now() - t0 > 20000) return ok(false); setTimeout(tick, 50); }; tick(); })`);
            const before = await page.evaluate(`document.getElementById('hud').textContent`);
            await page.evaluate(`document.getElementById('run').click()`);
            const after = await page.evaluate(`new Promise(ok => { const t0 = performance.now(); const tick = () => { const s = document.getElementById('status').textContent; if (s.includes(${JSON.stringify(reached)})) return ok(s); if (performance.now() - t0 > 15000) return ok('timeout: ' + s); requestAnimationFrame(tick); }; tick(); })`);
            if (!after.includes(reached)) problems.push(`${path}: the run did not arrive: ${after}`);
            const blank = await page.evaluate(`(() => { const c = document.getElementById('stage'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()`);
            if (blank < 2000) problems.push(`${path}: the canvas is blank (${blank} pixels drawn)`);
            if (before === (await page.evaluate(`document.getElementById('hud').textContent`))) problems.push(`${path}: the readout did not change`);
            // The example that cannot be reached says so.
            await page.evaluate(`document.querySelector('[data-preset="unreachable"]').click(); document.getElementById('run').click()`);
            const far = await page.evaluate(`new Promise(ok => { const t0 = performance.now(); const tick = () => { const s = document.getElementById('status').textContent; if (/reach|alcance|可达/.test(s) && !s.includes(${JSON.stringify(reached)})) return ok(s); if (performance.now() - t0 > 15000) return ok('timeout: ' + s); requestAnimationFrame(tick); }; tick(); })`);
            if (!far || far.startsWith('timeout')) problems.push(`${path}: an unreachable goal was not reported: ${far}`);
            // The hero: a sentence typed and sent rebuilds the swarm, and the page says what it read.
            const swarm = await page.evaluate(`new Promise(ok => {
                const input = document.getElementById('sentence'), form = document.getElementById('describe');
                input.value = '200 swirl'; form.requestSubmit();
                setTimeout(() => {
                    const c = document.getElementById('swarm'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                    let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++;
                    ok({ understood: document.getElementById('understood').textContent, count: document.getElementById('count').textContent, lit });
                }, 600);
            })`);
            if (!/200/.test(swarm.understood) || !/200|1[0-9]{2}/.test(swarm.count)) problems.push(`${path}: the swarm did not read the sentence: ${JSON.stringify(swarm)}`);
            if (swarm.lit < 200) problems.push(`${path}: the swarm canvas is dark (${swarm.lit} lit pixels)`);
            // The four verbs: scrolled to its end, the scene shows "inspect" and the rail marks it.
            const phase = await page.evaluate(`new Promise(ok => { const v = document.getElementById('verbs'); scrollTo(0, v.offsetTop + v.offsetHeight - innerHeight - 2); setTimeout(() => ok({ phase: v.dataset.phase, rail: document.querySelector('[data-rail][aria-current]')?.dataset.rail }), 400); })`);
            if (phase.phase !== 'inspect' || phase.rail !== '3') problems.push(`${path}: the verbs scene at its end ${JSON.stringify(phase)}`);
            await page.evaluate(`scrollTo(0, 0)`);
            // The language dialog.
            const langs = await page.evaluate(`(() => { document.querySelector('.lang-btn').click(); const d = document.getElementById('lang-dialog'); return { open: d.open, links: [...d.querySelectorAll('a')].map(a => a.getAttribute('hreflang')) }; })()`);
            if (!langs.open || langs.links.join(',') !== 'en,es,zh-Hans') problems.push(`${path}: the language dialog ${JSON.stringify(langs)}`);
        }
        // Nothing scrolls sideways at a phone's width.
        await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        const width = await page.evaluate(`({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })`);
        if (width.scroll > width.inner + 1) problems.push(`${path}: scrolls sideways at 390 px (${width.scroll} > ${width.inner})`);
        await page.call('Emulation.clearDeviceMetricsOverride', {});
        if (page.errors.length) problems.push(`${path}: ${page.errors.join(' | ')}`);
    }
} catch (e) {
    problems.push(String(e.message ?? e));
} finally {
    await page?.close();
    server?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
if (problems.length) {
    console.error(`browser_lab: ${problems.length} problem(s)`);
    for (const p of problems) console.error(' - ' + p);
    process.exit(1);
}
console.log(`browser_lab: ${PAGES.length} pages, the bench ran a reach and an out-of-reach goal in each locale, the swarm read a sentence, the verbs scene reached inspect, the dialog listed en/es/zh-Hans, nothing scrolled sideways and nothing threw.`);
