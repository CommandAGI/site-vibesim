/**
 * The hero's sentence → the swarm's parameters (tests/lab.test.mjs holds it). A word parser, not a language model: it
 * reads one number (how many) and the words of a short list, in English, Spanish and Chinese, and says which words it
 * understood, so the page never claims to have read more than it did.
 */
export const SWARM_DEFAULTS = { count: 1600, speed: 1, cursor: 0, warmth: 0, cohesion: 1, separation: 1, wind: 0, swirl: 0 };
export const COUNT_RANGE = [50, 3000];

// Each rule: the words that trigger it (a Latin word matches at a word's start, a Chinese one anywhere), the parameters it sets, and its tag.
const RULES = [
    { words: ['slow', 'calm', 'lazy', 'gentle', 'lento', 'calma', 'tranquil', '慢', '平静', '安静'], set: { speed: 0.5 }, tag: 'slow' },
    { words: ['fast', 'frantic', 'nervous', 'quick', 'rápid', 'rapid', 'nervios', '快', '急'], set: { speed: 1.8 }, tag: 'fast' },
    { words: ['scared', 'fear', 'afraid', 'avoid', 'flee', 'shy', 'miedo', 'asustad', 'huy', '怕', '躲', '逃'], set: { cursor: -1 }, tag: 'fears the cursor' },
    { words: ['follow', 'curious', 'chase', 'love', 'attract', 'sigue', 'curios', 'persigue', '跟', '好奇', '追'], set: { cursor: 1 }, tag: 'follows the cursor' },
    { words: ['warm', 'hot', 'coral', 'fire', 'cálid', 'calient', '暖', '热'], set: { warmth: 1 }, tag: 'warm' },
    { words: ['cold', 'cool', 'violet', 'ice', 'icy', 'frí', 'fria', 'fría', 'hielo', '冷', '冰', '紫'], set: { warmth: -1 }, tag: 'cold' },
    { words: ['tight', 'together', 'school', 'dense', 'flock', 'junt', 'denso', '紧', '聚', '一起'], set: { cohesion: 2.2, separation: 0.8 }, tag: 'tight' },
    { words: ['loose', 'scatter', 'alone', 'sparse', 'dispers', 'suelt', 'solo', '散', '稀'], set: { cohesion: 0.2, separation: 1.8 }, tag: 'loose' },
    { words: ['wind', 'drift', 'breeze', 'viento', 'brisa', '风'], set: { wind: 1 }, tag: 'wind' },
    { words: ['swirl', 'vortex', 'spin', 'storm', 'remolino', 'vórtice', 'gira', '漩', '旋', '涡'], set: { swirl: 1 }, tag: 'swirl' },
];

export function describeSwarm(sentence) {
    const text = String(sentence ?? '').toLowerCase();
    const params = { ...SWARM_DEFAULTS };
    const understood = [];
    const n = /(\d[\d,. ]*)/.exec(text);
    if (n) {
        const raw = Number(n[1].replace(/[,. ]/g, ''));
        if (Number.isFinite(raw) && raw > 0) {
            params.count = Math.round(Math.min(COUNT_RANGE[1], Math.max(COUNT_RANGE[0], raw)));
            understood.push(params.count === raw ? `${raw}` : `${raw} → ${params.count}`);
        }
    }
    for (const rule of RULES)
        if (rule.words.some(w => (/^[\p{Script=Han}]/u.test(w) ? text.includes(w) : new RegExp(`(^|[^\\p{L}])${w}`, 'u').test(text)))) {
            Object.assign(params, rule.set);
            understood.push(rule.tag);
        }
    return { params, understood };
}
