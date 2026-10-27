// The palette's contrast on the ink, measured (redesign/DESIGN.md § colour). Run: node tools/contrast.mjs
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = h => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const TOKENS = { paper: '#e8edf1', dim: '#95a1ad', coral: '#fa674f', uv: '#a89bfa' };
export const INK = '#0b0e12';
if (process.argv[1]?.endsWith('contrast.mjs'))
    for (const [k, v] of Object.entries(TOKENS)) console.log(`${k} ${v} on ink: ${ratio(v, INK).toFixed(1)} : 1`);
export { ratio };
