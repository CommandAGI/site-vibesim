/** Small triangle/line geometry layer. Millimetres, right-handed Z up internally. */
/** Flat per-face normals unless `given` supplies one normal per vertex (e.g. smoothed CAD from a GLB). */
export function mesh(positions, color = [.55, .62, .67], given) {
    if (positions.length % 9 || positions.length > 9000000 || !positions.every(Number.isFinite))
        throw Error('invalid or oversized triangle geometry');
    if (given?.length === positions.length && given.every(Number.isFinite))
        return { positions, normals: given, color };
    const normals = [];
    for (let i = 0; i < positions.length; i += 9) {
        const a = positions.slice(i, i + 3), b = positions.slice(i + 3, i + 6), c = positions.slice(i + 6, i + 9);
        const u = b.map((x, j) => x - a[j]), v = c.map((x, j) => x - a[j]);
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const len = Math.hypot(...n) || 1;
        for (let j = 0; j < 3; j++)
            normals.push(...n.map(x => x / len));
    }
    return { positions, normals, color };
}
export function box(size, center = [0, 0, 0], color) {
    const v = [];
    for (const z of [-1, 1])
        for (const y of [-1, 1])
            for (const x of [-1, 1])
                v.push([x, y, z].map((a, i) => center[i] + a * size[i] / 2));
    const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    return mesh(faces.flatMap(([a, b, c, d]) => [...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]]), color);
}
export function cylinder(radius, height, center = [0, 0, 0], sides = 16, color) {
    const p = [];
    for (let i = 0; i < sides; i++) {
        const a = i * 2 * Math.PI / sides, b = (i + 1) * 2 * Math.PI / sides;
        const at = (t, z) => [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t), center[2] + z];
        const a0 = at(a, -height / 2), b0 = at(b, -height / 2), a1 = at(a, height / 2), b1 = at(b, height / 2);
        p.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1, ...[center[0], center[1], center[2] - height / 2], ...b0, ...a0, ...[center[0], center[1], center[2] + height / 2], ...a1, ...b1);
    }
    return mesh(p, color);
}
export function bounds(m) { const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < m.positions.length; i++) {
    const j = i % 3;
    min[j] = Math.min(min[j], m.positions[i]);
    max[j] = Math.max(max[j], m.positions[i]);
} if (!m.positions.length)
    return { min: [0, 0, 0], max: [0, 0, 0] }; return { min, max }; }
export function transform(m, position = [0, 0, 0], rotation = 0) { const c = Math.cos(rotation), s = Math.sin(rotation), p = [], n = []; for (let i = 0; i < m.positions.length; i += 3) {
    const [x, y, z] = m.positions.slice(i, i + 3), [a, b, d] = m.normals.slice(i, i + 3);
    p.push(position[0] + x * c - y * s, position[1] + x * s + y * c, position[2] + z);
    n.push(a * c - b * s, a * s + b * c, d);
} return { ...m, ...mesh(p, m.color, n) }; }
export function parseSTL(buffer) {
    const b = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const view = new DataView(b);
    let p = [];
    if (b.byteLength >= 84 && 84 + view.getUint32(80, true) * 50 === b.byteLength) {
        const n = view.getUint32(80, true);
        if (n > 1000000)
            throw Error('STL too large');
        for (let i = 0; i < n; i++)
            for (let j = 0; j < 9; j++)
                p.push(view.getFloat32(84 + i * 50 + 12 + j * 4, true));
    }
    else {
        const text = new TextDecoder().decode(b);
        p = [...text.matchAll(/vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/g)].flatMap(m => m.slice(1).map(Number));
    }
    if (!p.length)
        throw Error('invalid STL');
    return mesh(p);
}
export function parseOBJ(text) {
    const vertices = [], p = [];
    for (const line of text.split(/\r?\n/)) {
        const [tag, ...args] = line.trim().split(/\s+/);
        if (tag === 'v') {
            const v = args.slice(0, 3).map(Number);
            if (v.length !== 3 || !v.every(Number.isFinite))
                throw Error('invalid OBJ vertex');
            vertices.push(v);
        }
        if (tag === 'f') {
            const face = args.map(t => { const n = Number(t.split('/')[0]); const i = n < 0 ? vertices.length + n : n - 1; if (!Number.isInteger(n) || !vertices[i])
                throw Error('invalid OBJ index'); return vertices[i]; });
            if (face.length < 3)
                throw Error('invalid OBJ face');
            for (let i = 1; i < face.length - 1; i++)
                p.push(...face[0], ...face[i], ...face[i + 1]);
        }
    }
    if (!p.length)
        throw Error('OBJ has no faces');
    return mesh(p);
}
/** In memory, mesh colours are sRGB (as authored and as the renderer expects); glTF stores baseColorFactor linear. */
export const srgbToLinear = c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
export const linearToSrgb = c => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055;
export function encodeGLB(meshes) {
    const doc = { asset: { version: '2.0', generator: 'commandagi', extras: { sourceUnits: 'mm', sourceUp: 'Z', purpose: 'layout proxy; not manufacturer CAD' } }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [] };
    const parts = [];
    let offset = 0;
    const shared = new Map();
    for (const [i, m] of meshes.entries()) {
        const b = bounds(m), center = b.min.map((v, j) => (v + b.max[j]) / 2);
        const p = [], n = [];
        const round = x => Math.round(x * 1e9) / 1e9;
        for (let j = 0; j < m.positions.length; j += 3) {
            p.push(round((m.positions[j] - center[0]) / 1000), round((m.positions[j + 2] - center[2]) / 1000), round(-(m.positions[j + 1] - center[1]) / 1000));
            n.push(round(m.normals[j]), round(m.normals[j + 2]), round(-m.normals[j + 1]));
        }
        const color = m.color ?? [.5, .6, .7];
        const signature = JSON.stringify([p, n, color]);
        let meshId = shared.get(signature);
        if (meshId === undefined) {
            meshId = doc.meshes.length;
            shared.set(signature, meshId);
            const accessor = doc.accessors.length;
            for (const data of [p, n]) {
                const a = new Float32Array(data);
                parts.push(new Uint8Array(a.buffer));
                doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: a.byteLength, target: 34962 });
                offset += a.byteLength;
                const bb = bounds({ positions: data });
                doc.accessors.push({ bufferView: doc.bufferViews.length - 1, componentType: 5126, count: data.length / 3, type: 'VEC3', min: bb.min, max: bb.max });
            }
            const material = doc.materials.length;
            doc.materials.push({ pbrMetallicRoughness: { baseColorFactor: [...color.map(srgbToLinear), 1], metallicFactor: .15, roughnessFactor: .65 }, doubleSided: true });
            doc.meshes.push({ primitives: [{ attributes: { POSITION: accessor, NORMAL: accessor + 1 }, material }] });
        }
        doc.nodes.push({ name: m.name ?? `part-${i}`, mesh: meshId, translation: [center[0] / 1000, center[2] / 1000, -center[1] / 1000] });
        doc.scenes[0].nodes.push(i);
    }
    doc.buffers[0].byteLength = offset;
    let json = new TextEncoder().encode(JSON.stringify(doc));
    const padding = (4 - json.length % 4) % 4;
    const padded = new Uint8Array(json.length + padding);
    padded.fill(32);
    padded.set(json);
    json = padded;
    const out = new Uint8Array(12 + 8 + json.length + 8 + offset);
    const v = new DataView(out.buffer);
    v.setUint32(0, 0x46546c67, true);
    v.setUint32(4, 2, true);
    v.setUint32(8, out.length, true);
    v.setUint32(12, json.length, true);
    v.setUint32(16, 0x4e4f534a, true);
    out.set(json, 20);
    let at = 20 + json.length;
    v.setUint32(at, offset, true);
    v.setUint32(at + 4, 0x004e4942, true);
    at += 8;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
export function parseGLB(buffer) {
    const v = new DataView(buffer);
    if (v.byteLength < 20 || v.getUint32(0, true) !== 0x46546c67 || v.getUint32(4, true) !== 2 || v.getUint32(8, true) !== v.byteLength)
        throw Error('invalid GLB 2');
    let doc, bin;
    for (let p = 12; p < v.byteLength;) {
        const len = v.getUint32(p, true), type = v.getUint32(p + 4, true);
        if (p + 8 + len > v.byteLength)
            throw Error('invalid GLB chunk');
        const b = buffer.slice(p + 8, p + 8 + len);
        if (type === 0x4e4f534a)
            doc = JSON.parse(new TextDecoder().decode(b));
        if (type === 0x004e4942)
            bin = b;
        p += 8 + len;
    }
    if (!doc || !bin || doc.extensionsRequired?.length || doc.skins?.length || doc.animations?.length)
        throw Error('GLB requires unsupported compression, animation or skinning');
    const read = (id) => { const a = doc.accessors[id], view = doc.bufferViews[a.bufferView]; if (a.sparse)
        throw Error('sparse accessor unsupported'); const sizes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }, methods = { 5121: 'getUint8', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }; const components = { SCALAR: 1, VEC3: 3 }[a.type], size = sizes[a.componentType]; if (!components || !size)
        throw Error('unsupported GLB accessor'); const data = new DataView(bin), out = []; for (let i = 0; i < a.count; i++)
        for (let k = 0; k < components; k++)
            out.push(data[methods[a.componentType]]((view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? size * components) + k * size, true)); return out; };
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const mul = (a, b) => { const o = Array(16).fill(0); for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++)
            for (let k = 0; k < 4; k++)
                o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
    const nodeMatrix = n => { if (n.matrix)
        return n.matrix; const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1], t = n.translation ?? [0, 0, 0]; return [(1 - 2 * y * y - 2 * z * z) * s[0], (2 * x * y + 2 * w * z) * s[0], (2 * x * z - 2 * w * y) * s[0], 0, (2 * x * y - 2 * w * z) * s[1], (1 - 2 * x * x - 2 * z * z) * s[1], (2 * y * z + 2 * w * x) * s[1], 0, (2 * x * z + 2 * w * y) * s[2], (2 * y * z - 2 * w * x) * s[2], (1 - 2 * x * x - 2 * y * y) * s[2], 0, ...t, 1]; };
    const result = [], active = new Set();
    function visit(id, parent = identity) { if (active.has(id))
        throw Error('cyclic GLB scene'); active.add(id); const node = doc.nodes[id], m = mul(parent, nodeMatrix(node)); if (node.mesh !== undefined)
        for (const prim of doc.meshes[node.mesh].primitives) {
            if ((prim.mode ?? 4) !== 4)
                throw Error('GLB primitive is not triangles');
            const positions = read(prim.attributes.POSITION), indices = prim.indices === undefined ? Array.from({ length: positions.length / 3 }, (_, i) => i) : read(prim.indices);
            const normals = prim.attributes.NORMAL === undefined ? null : read(prim.attributes.NORMAL);
            const p = [], nn = normals ? [] : undefined;
            for (const index of indices) {
                const [x, y, z] = positions.slice(index * 3, index * 3 + 3);
                const q = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
                p.push(q[0] * 1000, -q[2] * 1000, q[1] * 1000);
                if (normals) {
                    // Rigid/uniform-scale node transforms only (what CAD exporters emit), so the linear part rotates normals.
                    const [a, b, d] = normals.slice(index * 3, index * 3 + 3), r = [m[0] * a + m[4] * b + m[8] * d, m[1] * a + m[5] * b + m[9] * d, m[2] * a + m[6] * b + m[10] * d], len = Math.hypot(...r) || 1;
                    nn.push(r[0] / len, -r[2] / len, r[1] / len);
                }
            }
            const mat = doc.materials?.[prim.material], pbr = mat?.pbrMetallicRoughness ?? {};
            // Material pass-through for renderers: when the factors are absent, glTF's defaults are metallic 1 / roughness 1.
            const material = mat ? { ...(typeof mat.name === 'string' ? { name: mat.name } : {}), metallic: pbr.metallicFactor ?? 1, roughness: pbr.roughnessFactor ?? 1 } : undefined;
            result.push({ ...mesh(p, pbr.baseColorFactor?.slice(0, 3).map(linearToSrgb), nn), name: node.name, ...(material ? { material } : {}) });
        } for (const child of node.children ?? [])
        visit(child, m); active.delete(id); }
    for (const id of doc.scenes[doc.scene ?? 0].nodes)
        visit(id);
    if (!result.length)
        throw Error('GLB contains no triangle meshes');
    return result;
}
