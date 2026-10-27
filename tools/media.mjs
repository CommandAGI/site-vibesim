// The site's generated media: fal clips, fetched at build time, never from a visitor's tab (redesign/NOTES.md logs
// every prompt, model and cost). The key is read from the environment, or from the .env cascade COMMANDAGI_ENV_ROOT
// names; it is never printed. Run: COMMANDAGI_ENV_ROOT=… node tools/media.mjs <name>…  (writes media/raw/<name>.mp4; move them out of the folder before a deploy)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export const CLIPS = {
    pigment: {
        model: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
        input: {
            prompt: 'Extreme macro of coral-red and ultraviolet pigment diffusing through still black water, slow laminar plumes curling into von Karman vortex streets, fine filaments, deep black background, no objects, no people, no text, locked-off camera, slow, scientific, high detail',
            negative_prompt: 'text, logo, people, hands, faces, glass, cup, bubbles, blur, watermark',
            duration: '10',
            aspect_ratio: '16:9',
            cfg_scale: 0.5,
        },
    },
    flock: {
        model: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
        input: {
            prompt: 'Top-down view looking straight down at thousands of tiny glowing points of light moving together as one flock over pure black, the flock folds, splits and rejoins like a starling murmuration, points coloured from coral to pale violet, no birds visible, abstract, no ground, no text, slow and smooth, locked-off camera',
            negative_prompt: 'text, logo, birds, sky, clouds, ground, people, city, watermark',
            duration: '10',
            aspect_ratio: '16:9',
            cfg_scale: 0.5,
        },
    },
};

function falKey() {
    if (process.env.FAL_KEY) return process.env.FAL_KEY;
    const dir = process.env.COMMANDAGI_ENV_ROOT;
    for (const f of dir ? ['.env', '.env.api'] : []) {
        const p = resolve(dir, f);
        if (!existsSync(p)) continue;
        const line = readFileSync(p, 'utf8').split('\n').find(l => l.startsWith('SVC__FAL__MAIN__API_KEY='));
        if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^"|"$/g, '');
    }
    throw Error('no fal key: set COMMANDAGI_ENV_ROOT to the folder whose .env holds SVC__FAL__MAIN__API_KEY');
}

async function generate(name) {
    const clip = CLIPS[name];
    const headers = { Authorization: `Key ${falKey()}`, 'Content-Type': 'application/json' };
    const queued = await fetch(`https://queue.fal.run/${clip.model}`, { method: 'POST', headers, body: JSON.stringify(clip.input) }).then(r => r.json());
    if (!queued.status_url) throw Error(`${name}: fal refused the request: ${JSON.stringify(queued).slice(0, 300)}`);
    for (;;) {
        await new Promise(ok => setTimeout(ok, 8000));
        const s = await fetch(queued.status_url, { headers }).then(r => r.json());
        if (s.status === 'COMPLETED') break;
        if (s.status !== 'IN_QUEUE' && s.status !== 'IN_PROGRESS') throw Error(`${name}: ${JSON.stringify(s).slice(0, 300)}`);
    }
    const out = await fetch(queued.response_url, { headers }).then(r => r.json());
    const url = out.video?.url;
    if (!url) throw Error(`${name}: no video in ${JSON.stringify(out).slice(0, 300)}`);
    mkdirSync(resolve(root, 'media/raw'), { recursive: true });
    writeFileSync(resolve(root, `media/raw/${name}.mp4`), Buffer.from(await fetch(url).then(r => r.arrayBuffer())));
    console.log(`${name}: media/raw/${name}.mp4 (${clip.model}, request ${queued.request_id})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
    await Promise.all(process.argv.slice(2).map(generate));
