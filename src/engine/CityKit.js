// ============================================================
// CITY KIT — the City Circuit's plot buildings, modelled properly
// ============================================================
//
// The five plot buildings (Financial tower, Back Alley walk-up, Promenade
// shopfront, Industrial works, Ring Road civic hall) were plain boxes with a
// few flat planes stuck to them: hard edges, windows painted on, and six or
// seven materials each. Next to the rounded characters and the minigame sets
// they read as placeholders.
//
// The art direction is CHUNKY TOY-TOWN: bevelled edges that catch the light,
// bold readable silhouettes, saturated colour, and detail that stands proud of
// the wall (sills, cornices, awnings, pilasters) so it reads at board distance
// on a phone.
//
// THE DRAW-CALL RULE. Every building is exactly three meshes however much
// detail it carries, one per layer:
//
//   body   the solid shell and its trim: vertex-coloured, lit, casts shadows
//   sheen  glassy surfaces: the same, but smooth and slightly metallic
//   glow   lit windows, neon and signs: vertex-coloured, unlit
//
// Colour lives in the vertices, so one material per layer is shared by every
// building in the city. The occluder fade clones a building's materials to
// ghost it on its own, so a building is three draw calls; the old ones were
// six or seven. Detail therefore costs triangles, which phones have plenty
// of, and never draw calls, which they do not.
//
// Anything that animates on its own material (a blinking aircraft light) is
// a separate small mesh, handed to the caller through `opts.live`.
//
// Footprints (w, h, d per seed) are exactly the old ones: the plot layout in
// Renderer._buildAllDistrictBuildings sets each building back from the kerb by
// its footprint, and must not move.
// ============================================================

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);

export function seeded(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

/** A translation (and optional rotation / scale) as a matrix. */
export function at(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
        _q.setFromEuler(_e.set(rx, ry, rz)).clone(), new THREE.Vector3(sx, sy, sz));
}

// One material per layer for the whole city.
let _mats = null;
export function kitMaterials() {
    if (_mats) return _mats;
    _mats = {
        body:  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0 }),
        sheen: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.25 }),
        glow:  new THREE.MeshBasicMaterial({ vertexColors: true }),
    };
    return _mats;
}

// ------------------------------------------------------------
// The accumulator: triangles in, three meshes out.
// ------------------------------------------------------------
export class Kit {
    constructor() {
        this.L = { body: [], sheen: [], glow: [] };   // flat arrays: x y z nx ny nz r g b per vertex
        this.tris = 0;
    }

    vert(layer, p, n, c) { this.L[layer].push(p.x, p.y, p.z, n.x, n.y, n.z, c.r, c.g, c.b); }

    /** A convex polygon, wound outward from `centre` (local coordinates), then moved by `m`. */
    poly(layer, pts, col, centre, m) {
        const c = col.isColor ? col : new THREE.Color(col);
        // Wind it so the face points away from the solid's centre.
        _a.subVectors(pts[1], pts[0]); _b.subVectors(pts[2], pts[0]); _n.crossVectors(_a, _b);
        const cen = _v.set(0, 0, 0); pts.forEach(p => cen.add(p)); cen.divideScalar(pts.length);
        if (_n.dot(cen.sub(centre)) < 0) pts = pts.slice().reverse();
        const w = m ? pts.map(p => p.clone().applyMatrix4(m)) : pts;
        _a.subVectors(w[1], w[0]); _b.subVectors(w[2], w[0]);
        const nrm = new THREE.Vector3().crossVectors(_a, _b);
        if (nrm.lengthSq() < 1e-12) return;
        nrm.normalize();
        for (let i = 1; i < w.length - 1; i++) {
            this.vert(layer, w[0], nrm, c); this.vert(layer, w[i], nrm, c); this.vert(layer, w[i + 1], nrm, c);
            this.tris++;
        }
    }

    /**
     * A box of w×h×d centred on the origin of `m`, with its edges chamfered by
     * `ch`: flat faces, flat 45° bevels and corner facets, so every edge
     * catches a highlight. `top` colours the upward face differently.
     */
    box(layer, w, h, d, m, col, { ch = 0, top = null, skipBottom = true } = {}) {
        const a = w / 2, b = h / 2, e = d / 2;
        ch = Math.max(0, Math.min(ch, a * 0.45, b * 0.45, e * 0.45));
        const O = new THREE.Vector3();
        const P = (x, y, z) => new THREE.Vector3(x, y, z);
        const ext = [a, b, e];
        const inset = [a - ch, b - ch, e - ch];
        // Main faces: one per axis and sign.
        for (let ax = 0; ax < 3; ax++) for (const s of [-1, 1]) {
            if (skipBottom && ax === 1 && s < 0) continue;
            const u = (ax + 1) % 3, v = (ax + 2) % 3;
            const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
                const p = [0, 0, 0]; p[ax] = s * ext[ax]; p[u] = su * inset[u]; p[v] = sv * inset[v];
                return P(p[0], p[1], p[2]);
            });
            this.poly(layer, q, (ax === 1 && s > 0 && top !== null) ? top : col, O, m);
        }
        if (ch <= 0) return;
        // Edge bevels: between axis i (sign si) and axis j (sign sj), running along k.
        const corner = (sx, sy, sz, which) => {   // the corner facet's vertex nearest axis `which`
            const s = [sx, sy, sz], p = [0, 0, 0];
            for (let k = 0; k < 3; k++) p[k] = s[k] * (k === which ? ext[k] : inset[k]);
            return P(p[0], p[1], p[2]);
        };
        for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
            const k = 3 - i - j;
            for (const si of [-1, 1]) for (const sj of [-1, 1]) {
                if (skipBottom && ((i === 1 && si < 0) || (j === 1 && sj < 0))) continue;
                const s0 = [0, 0, 0], s1 = [0, 0, 0];
                s0[i] = si; s0[j] = sj; s0[k] = -1;
                s1[i] = si; s1[j] = sj; s1[k] = 1;
                const q = [corner(...s0, i), corner(...s0, j), corner(...s1, j), corner(...s1, i)];
                this.poly(layer, q, col, O, m);
            }
        }
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
            if (skipBottom && sy < 0) continue;
            this.poly(layer, [corner(sx, sy, sz, 0), corner(sx, sy, sz, 1), corner(sx, sy, sz, 2)], col, O, m);
        }
    }

    /** A prism: a triangle in the XY plane (x from -w/2..w/2, apex at `apexX`), extruded d along Z. */
    prism(layer, w, h, d, m, col, apexX = 0) {
        const a = w / 2, e = d / 2;
        const O = new THREE.Vector3(apexX / 3, h / 3, 0);
        const P = (x, y, z) => new THREE.Vector3(x, y, z);
        const f = [P(-a, 0, e), P(a, 0, e), P(apexX, h, e)], k = [P(-a, 0, -e), P(a, 0, -e), P(apexX, h, -e)];
        this.poly(layer, f, col, O, m); this.poly(layer, k, col, O, m);
        this.poly(layer, [f[0], f[2], k[2], k[0]], col, O, m);
        this.poly(layer, [f[1], f[2], k[2], k[1]], col, O, m);
    }

    /** Any three.js geometry, keeping its own (smooth) normals. */
    geo(layer, geometry, m, col) {
        const c = col.isColor ? col : new THREE.Color(col);
        const g = geometry.index ? geometry.toNonIndexed() : geometry;
        if (m) g.applyMatrix4(m);
        const p = g.attributes.position, n = g.attributes.normal;
        for (let i = 0; i < p.count; i++) {
            this.L[layer].push(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), c.r, c.g, c.b);
        }
        this.tris += p.count / 3;
        if (g !== geometry) g.dispose();
        geometry.dispose();
    }

    cyl(layer, rTop, rBot, h, seg, m, col) { this.geo(layer, new THREE.CylinderGeometry(rTop, rBot, h, seg), m, col); }

    /** The three meshes, as one group. */
    build() {
        const M = kitMaterials();
        const grp = new THREE.Group();
        for (const layer of ['body', 'sheen', 'glow']) {
            const arr = this.L[layer];
            if (!arr.length) continue;
            const n = arr.length / 9;
            const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                pos[i * 3] = arr[i * 9];     pos[i * 3 + 1] = arr[i * 9 + 1]; pos[i * 3 + 2] = arr[i * 9 + 2];
                nor[i * 3] = arr[i * 9 + 3]; nor[i * 3 + 1] = arr[i * 9 + 4]; nor[i * 3 + 2] = arr[i * 9 + 5];
                col[i * 3] = arr[i * 9 + 6]; col[i * 3 + 1] = arr[i * 9 + 7]; col[i * 3 + 2] = arr[i * 9 + 8];
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
            g.setAttribute('color', new THREE.BufferAttribute(col, 3));
            g.computeBoundingSphere();
            const mesh = new THREE.Mesh(g, M[layer]);
            mesh.name = 'kit-' + layer;
            if (layer !== 'glow') { mesh.castShadow = layer === 'body'; mesh.receiveShadow = true; }
            grp.add(mesh);
        }
        grp.userData.kitTris = this.tris;
        return grp;
    }
}

// ------------------------------------------------------------
// Shared facade pieces
// ------------------------------------------------------------

const T = x => new THREE.Matrix4().makeTranslation(x[0], x[1], x[2]);
const DARK_GLASS = 0x1f2a3a;

/**
 * A grid of windows on the +Z (sign 1) or -Z (sign -1) face at depth `z`.
 * Lit panes go to the glow layer; dark ones stay on the body. `trim` adds a
 * sill and a lintel that stand proud of the wall, which is most of what makes
 * a window read as a window rather than a painted rectangle.
 */
function windowRow(k, { z, sign = 1, x0, x1, y, cols, pw, ph, lit, dark = DARK_GLASS, trim = null, chance, seed, axis = 'z' }) {
    const span = x1 - x0;
    for (let c = 0; c < cols; c++) {
        const x = x0 + (c + 0.5) * span / cols;
        const on = seeded(seed + c * 7.31) < chance;
        const place = (dx, dy, dz) => axis === 'z' ? T([x + dx, y + dy, z + sign * dz]) : T([z + sign * dz, y + dy, x + dx]);
        const pw2 = axis === 'z' ? pw : 0.06, pd2 = axis === 'z' ? 0.06 : pw;
        k.box(on ? 'glow' : 'body', pw2, ph, pd2, place(0, 0, 0.03), on ? lit[Math.floor(seeded(seed + c * 3.7) * lit.length)] : dark);
        if (trim) {
            const sw = axis === 'z' ? pw + 0.3 : 0.26, sd = axis === 'z' ? 0.26 : pw + 0.3;
            k.box('body', sw, 0.14, sd, place(0, -ph / 2 - 0.07, 0.1), trim, { ch: 0.04 });
            const lw = axis === 'z' ? pw + 0.16 : 0.14, ld = axis === 'z' ? 0.14 : pw + 0.16;
            k.box('body', lw, 0.16, ld, place(0, ph / 2 + 0.1, 0.05), trim);
        }
    }
}

// ------------------------------------------------------------
// FINANCIAL DISTRICT — glass tower
// ------------------------------------------------------------
// A stone podium with a lit canopy entrance, a bevelled glass shaft between
// white corner piers and spandrel bands, lit offices on all four faces, a
// setback crown and rooftop plant. The HQ adds a gold crown ring and a taller
// spire.
export function tower(pos, isHQ, opts = {}) {
    const s = Math.abs(Math.round(pos.x * 7 + pos.z * 13)) % 100;
    const h = isHQ ? 32 : 15 + (s % 8) * 2;
    const w = isHQ ? 7 : 4 + (s % 3);
    const d = isHQ ? 7 : 4 + ((s + 2) % 3);
    const k = new Kit();
    const STONE = 0xd8d2c4, FRAME = 0xeef3f7, GLASS = [0x3f78c0, 0x4a86c9, 0x3a6fb2][s % 3], BAND = 0xc9dbea;
    const LIT = [0xffe6a8, 0xbfe6ff, 0xfff3d6];

    // Podium and entrance.
    const pod = 2.4;
    k.box('body', w + 0.9, pod, d + 0.9, T([0, pod / 2, 0]), STONE, { ch: 0.22, top: 0xbfb8a9 });
    k.box('sheen', w * 0.42, 1.7, 0.1, T([0, 0.85, d / 2 + 0.47]), DARK_GLASS);
    k.box('body', w * 0.62, 0.2, 1.3, T([0, 2.0, d / 2 + 0.95]), FRAME, { ch: 0.06 });
    k.box('glow', w * 0.55, 0.06, 1.1, T([0, 1.88, d / 2 + 0.95]), 0xffe0a0);

    // Shaft: glass core between four corner piers.
    const sh = h - pod;
    k.box('sheen', w, sh, d, T([0, pod + sh / 2, 0]), GLASS, { ch: 0.3 });
    const pier = Math.min(0.6, w * 0.12);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        k.box('body', pier, sh, pier, T([sx * (w / 2 - pier * 0.3), pod + sh / 2, sz * (d / 2 - pier * 0.3)]), FRAME, { ch: 0.08 });
    }
    // Spandrel bands every floor-group, and the lit offices between them.
    const floors = Math.floor(sh / 3);
    for (let f = 1; f <= floors; f++) {
        const y = pod + f * 3;
        if (y < h - 0.5) k.box('body', w + 0.14, 0.3, d + 0.14, T([0, y, 0]), BAND, { ch: 0.05 });
        const wy = y - 1.45;
        const colsW = Math.max(2, Math.round(w / 1.3)), colsD = Math.max(2, Math.round(d / 1.3));
        const common = { y: wy, pw: 0.75, ph: 1.7, lit: LIT, chance: 0.4 };
        windowRow(k, { ...common, z: d / 2 + 0.02, x0: -w / 2 + pier, x1: w / 2 - pier, cols: colsW, seed: s * 31 + f * 11, dark: GLASS });
        windowRow(k, { ...common, z: -d / 2 - 0.02, sign: -1, x0: -w / 2 + pier, x1: w / 2 - pier, cols: colsW, seed: s * 37 + f * 13, dark: GLASS });
        windowRow(k, { ...common, axis: 'x', z: w / 2 + 0.02, x0: -d / 2 + pier, x1: d / 2 - pier, cols: colsD, seed: s * 41 + f * 17, dark: GLASS });
        windowRow(k, { ...common, axis: 'x', z: -w / 2 - 0.02, sign: -1, x0: -d / 2 + pier, x1: d / 2 - pier, cols: colsD, seed: s * 43 + f * 19, dark: GLASS });
    }
    // Setback crown and cap.
    const cw = w * 0.7, cd = d * 0.7, chH = Math.max(2.4, h * 0.14);
    k.box('body', w + 0.5, 0.45, d + 0.5, T([0, h + 0.2, 0]), FRAME, { ch: 0.12 });
    k.box('sheen', cw, chH, cd, T([0, h + 0.4 + chH / 2, 0]), GLASS, { ch: 0.25 });
    k.box('body', cw + 0.35, 0.35, cd + 0.35, T([0, h + 0.4 + chH, 0]), FRAME, { ch: 0.1 });
    if (isHQ) k.box('glow', cw + 0.2, 0.25, cd + 0.2, T([0, h + 0.4 + chH * 0.55, 0]), 0xffd27a);
    const top = h + 0.6 + chH;
    // Rooftop plant and spire.
    k.box('body', cw * 0.5, 0.8, cd * 0.38, T([-cw * 0.15, top + 0.4, cd * 0.1]), 0x9aa3ad, { ch: 0.1 });
    const spH = h * (isHQ ? 0.3 : 0.18);
    k.cyl('body', 0.07, 0.2, spH, 8, T([cw * 0.2, top + spH / 2, -cd * 0.1]), FRAME);
    const grp = k.build();
    // A red aircraft light on the taller ones, on its own material so it can blink.
    if (h > 22 && opts.live) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), mat);
        lamp.position.set(cw * 0.2, top + spH + 0.2, -cd * 0.1);
        grp.add(lamp);
        opts.live({ kind: 'beacon', mat, seed: s });
    }
    grp.position.copy(pos);
    return grp;
}

// ------------------------------------------------------------
// BACK ALLEY — brick walk-up
// ------------------------------------------------------------
// Bevelled brick in one of three tones on a dark base course; cream sills,
// lintels and a projecting cornice; a stoop door; a front fire escape on some;
// a neon blade sign on others; and the water tower on every other roof.
export function walkup(pos, isHQ, opts = {}) {
    const s = Math.abs(Math.round(pos.x * 5 + pos.z * 11)) % 100;
    const h = isHQ ? 14 : 6 + (s % 6);
    const w = isHQ ? 9 : 5 + (s % 4);
    const d = isHQ ? 7 : 4 + (s % 3);
    const k = new Kit();
    const BRICK = [0x9a4632, 0x7f3a2c, 0x8e5236][s % 3], BASE = 0x4a2620, CREAM = 0xead9b8, METAL = 0x2a2a30;
    const NEON = [0xff4fa3, 0x35e0ff, 0xffd12d][s % 3];
    const LIT = [0xffc46a, 0xffb070, 0xffd99a];

    k.box('body', w, h, d, T([0, h / 2, 0]), BRICK, { ch: 0.18, top: 0x3a3236 });
    k.box('body', w + 0.16, 1.0, d + 0.16, T([0, 0.5, 0]), BASE, { ch: 0.06 });
    // Cornice and parapet.
    k.box('body', w + 0.7, 0.4, d + 0.7, T([0, h - 0.15, 0]), CREAM, { ch: 0.12 });
    k.box('body', w + 0.2, 0.55, d + 0.2, T([0, h + 0.3, 0]), BRICK, { ch: 0.08 });

    // Windows, front and back, one row per floor above the ground floor.
    const cols = Math.max(2, Math.round(w / 1.8));
    const rows = Math.max(1, Math.floor((h - 2) / 2.6));
    for (let r = 0; r < rows; r++) {
        const y = 2.6 + r * 2.6;
        if (y > h - 1.2) break;
        const common = { y, pw: 0.85, ph: 1.3, lit: LIT, trim: CREAM, chance: 0.42, x0: -w / 2 + 0.3, x1: w / 2 - 0.3, cols };
        windowRow(k, { ...common, z: d / 2, seed: s * 17 + r * 5 });
        windowRow(k, { ...common, z: -d / 2, sign: -1, seed: s * 19 + r * 7 });
    }
    // Stoop door.
    k.box('body', 1.2, 2.0, 0.16, T([0, 1.0, d / 2 + 0.05]), 0x3b2418);
    k.box('body', 1.9, 0.3, 0.7, T([0, 0.15, d / 2 + 0.35]), 0x8d8478, { ch: 0.05 });
    k.box('body', 1.7, 0.12, 0.8, T([0, 2.25, d / 2 + 0.4]), METAL, { ch: 0.03 });
    k.box('glow', 0.5, 0.12, 0.12, T([0, 2.12, d / 2 + 0.72]), 0xffd08a);

    // Fire escape: a landing per floor down one side of the front.
    if (s % 3 === 0) {
        const fx = -w / 2 + 1.5;
        for (let r = 0; r < rows; r++) {
            const y = 2.6 + r * 2.6 - 0.8;
            if (y > h - 1.5) break;
            k.box('body', 2.4, 0.1, 0.9, T([fx, y, d / 2 + 0.5]), METAL);
            k.box('body', 2.4, 0.07, 0.07, T([fx, y + 0.8, d / 2 + 0.92]), METAL);
            for (const px of [-1.15, 0, 1.15]) k.box('body', 0.06, 0.8, 0.06, T([fx + px, y + 0.4, d / 2 + 0.92]), METAL);
        }
        k.box('body', 0.08, h - 2, 0.08, T([fx - 1.2, h / 2 - 0.2, d / 2 + 0.92]), METAL);
    }
    // Neon blade sign, hung off the side wall at the front corner so it
    // stands out into the street without covering any windows.
    if (s % 2 === 1 || isHQ) {
        const by = Math.min(h - 1.6, 4.2), bz = d / 2 - 0.45;
        k.box('body', 1.2, 2.4, 0.3, T([w / 2 + 0.7, by, bz]), 0x1b1b22, { ch: 0.06 });
        k.box('glow', 0.9, 2.0, 0.36, T([w / 2 + 0.7, by, bz]), NEON);
        for (const dy of [-0.9, 0.9]) k.box('body', 0.3, 0.08, 0.08, T([w / 2 + 0.1, by + dy, bz]), METAL);
    }
    // Water tower.
    if (s % 2 === 0 || isHQ) {
        const tx = w * 0.18, tz = -d * 0.12, ty = h + 0.6;
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + Math.PI / 4;
            k.box('body', 0.12, 1.6, 0.12, T([tx + Math.cos(a) * 0.72, ty + 0.8, tz + Math.sin(a) * 0.72]), METAL);
        }
        k.cyl('body', 0.95, 0.95, 1.9, 12, T([tx, ty + 2.55, tz]), 0x7a4a26);
        for (const yy of [2.0, 3.1]) k.cyl('body', 0.99, 0.99, 0.1, 12, T([tx, ty + yy, tz]), METAL);
        k.geo('body', new THREE.ConeGeometry(1.1, 0.95, 12), T([tx, ty + 3.97, tz]), 0x3d3f45);
    }
    // HQ: a rooftop billboard in the district's neon.
    if (isHQ) {
        k.box('body', w * 0.7, 2.2, 0.3, T([-w * 0.1, h + 2.0, d / 2 - 0.8]), 0x1b1b22, { ch: 0.08 });
        k.box('glow', w * 0.64, 1.8, 0.1, T([-w * 0.1, h + 2.0, d / 2 - 0.62]), NEON);
        for (const px of [-0.3, 0.1]) k.box('body', 0.12, 1.2, 0.12, T([px * w, h + 0.6, d / 2 - 0.8]), METAL);
    }
    const grp = k.build();
    grp.position.copy(pos);
    return grp;
}

// ------------------------------------------------------------
// SHOPPING PROMENADE — shopfront
// ------------------------------------------------------------
// A saturated two-tone front with white pilasters and cornice, a lit display
// window with mullions, a striped awning, a glowing sign board, and flower
// boxes under the upper windows. The mall HQ gets a glass dome on a drum.
const SHOP_COLS = [0xe0559b, 0x3fb86a, 0x4a86e8, 0xf08c24, 0xa45ad6];
export function shopfront(pos, colorIdx, isHQ, opts = {}) {
    const s = Math.abs(Math.round(pos.x * 3 + pos.z * 9)) % 100;
    const ci = colorIdx !== undefined ? colorIdx : s % SHOP_COLS.length;
    const MAIN = SHOP_COLS[ci];
    const h = isHQ ? 12 : 5 + (s % 5);
    const w = isHQ ? 10 : 6 + (s % 4);
    const d = isHQ ? 6 : 4 + (s % 2);
    const k = new Kit();
    const WHITE = 0xf5efe4, LIGHT = new THREE.Color(MAIN).lerp(new THREE.Color(0xffffff), 0.45);

    k.box('body', w, h, d, T([0, h / 2, 0]), MAIN, { ch: 0.22, top: 0x5c5560 });
    k.box('body', w + 0.2, 0.5, d + 0.2, T([0, 0.25, 0]), WHITE, { ch: 0.06 });
    k.box('body', w + 0.55, 0.45, d + 0.55, T([0, h - 0.1, 0]), WHITE, { ch: 0.12 });
    for (const sx of [-1, 1]) k.box('body', 0.45, h - 0.4, 0.3, T([sx * (w / 2 - 0.15), h / 2, d / 2 + 0.1]), WHITE, { ch: 0.06 });

    // Display window: lit interior, white mullions, a dark door to one side.
    const dwH = Math.min(2.3, h * 0.38), dwW = w * 0.62;
    k.box('glow', dwW, dwH - 0.06, 0.08, T([-w * 0.08, 0.6 + dwH / 2 - 0.03, d / 2 + 0.02]), 0xfff1c9);
    const mul = Math.max(2, Math.round(dwW / 1.4));
    for (let i = 0; i <= mul; i++) k.box('body', 0.1, dwH, 0.12, T([-w * 0.08 - dwW / 2 + i * dwW / mul, 0.6 + dwH / 2, d / 2 + 0.06]), WHITE);
    k.box('body', dwW + 0.2, 0.14, 0.2, T([-w * 0.08, 0.6 + dwH, d / 2 + 0.08]), WHITE);
    k.box('body', 1.0, 2.1, 0.12, T([w / 2 - 1.05, 1.05, d / 2 + 0.03]), 0x3b2c35);

    // Striped awning, sloping down and out.
    const aY = 0.6 + dwH + 0.55, stripes = Math.max(5, Math.round((w + 0.6) / 0.7));
    const sw = (w + 0.6) / stripes;
    for (let i = 0; i < stripes; i++) {
        k.box('body', sw, 0.12, 1.7, at(-(w + 0.6) / 2 + (i + 0.5) * sw, aY, d / 2 + 0.8, 0.3), i % 2 ? WHITE : MAIN);
    }
    // Sign board above it.
    const sY = Math.min(h - 0.9, aY + 1.05);
    k.box('body', w * 0.62, 0.85, 0.2, T([0, sY, d / 2 + 0.12]), WHITE, { ch: 0.08 });
    k.box('glow', w * 0.54, 0.5, 0.06, T([0, sY, d / 2 + 0.24]), LIGHT);

    // Upper floors: windows with flower boxes, front and back.
    const cols = Math.max(2, Math.round(w / 2));
    for (let y = sY + 1.6; y < h - 1.0; y += 2.4) {
        const common = { y, pw: 1.0, ph: 1.25, lit: [0xfff0c8, 0xffe0f0], trim: WHITE, chance: 0.5, x0: -w / 2 + 0.6, x1: w / 2 - 0.6, cols };
        windowRow(k, { ...common, z: d / 2, seed: s * 13 + y * 3 });
        windowRow(k, { ...common, z: -d / 2, sign: -1, seed: s * 23 + y * 5 });
        for (let c = 0; c < cols; c++) {
            const x = -w / 2 + 0.6 + (c + 0.5) * (w - 1.2) / cols;
            k.box('body', 1.1, 0.3, 0.35, T([x, y - 0.92, d / 2 + 0.28]), 0x3d8a28, { ch: 0.05 });
        }
    }
    // Mall HQ: a glass dome on a white drum.
    if (isHQ) {
        k.cyl('body', 3.3, 3.5, 1.0, 20, T([0, h + 0.5, 0]), WHITE);
        k.geo('sheen', new THREE.SphereGeometry(3.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), T([0, h + 1.0, 0]), 0x9fd6ff);
        k.cyl('body', 0.35, 0.45, 0.8, 10, T([0, h + 4.5, 0]), WHITE);
        k.geo('glow', new THREE.SphereGeometry(0.3, 10, 8), T([0, h + 5.1, 0]), 0xffd27a);
    }
    const grp = k.build();
    grp.position.copy(pos);
    return grp;
}

// ------------------------------------------------------------
// INDUSTRIAL ZONE — works shed
// ------------------------------------------------------------
// An ochre shed ribbed like corrugated iron over a dark wainscot, a sawtooth
// roof with lit north-lights, a roller door in a hazard-striped frame, red and
// white banded chimneys, roof vents, and a cream office block at one end.
export function works(pos, isHQ, opts = {}) {
    const s = Math.abs(Math.round(pos.x * 11 + pos.z * 7)) % 100;
    const h = isHQ ? 10 : 6 + (s % 5);
    const w = isHQ ? 14 : 8 + (s % 6);
    const d = isHQ ? 8 : 6 + (s % 3);
    const k = new Kit();
    const WALL = [0xc9a24a, 0xb8964a, 0xa9a08a][s % 3], LOW = 0x6f5a2e, RIB = new THREE.Color(WALL).multiplyScalar(0.82);
    const ROOF = 0x6f7880, STACK = 0x8b8f94, RED = 0xd94a3a, CREAM = 0xe8dcc0, HAZ = [0xf5c518, 0x1c1c1c];

    k.box('body', w, h, d, T([0, h / 2, 0]), WALL, { ch: 0.2, top: ROOF });
    k.box('body', w + 0.12, 1.3, d + 0.12, T([0, 0.65, 0]), LOW, { ch: 0.05 });
    // Corrugation: ribs on the long faces.
    for (let x = -w / 2 + 0.6; x < w / 2 - 0.4; x += 1.1) {
        for (const sz of [-1, 1]) k.box('body', 0.14, h - 1.5, 0.08, T([x, 1.3 + (h - 1.5) / 2, sz * (d / 2 + 0.04)]), RIB);
    }
    // Sawtooth roof: teeth across the width, glazed face toward +Z.
    const teeth = Math.max(2, Math.round(d / 2.6)), tD = d / teeth, tH = Math.min(1.8, h * 0.2);
    for (let i = 0; i < teeth; i++) {
        const z = -d / 2 + (i + 0.5) * tD;
        // Profile in the ZY plane: rotate a prism so its triangle stands along Z.
        // Rotating +90° about Y sends the prism's -X edge to +Z, so the upright
        // (glazed) face is put on -X.
        k.prism('body', tD, tH, w, at(0, h, z, 0, Math.PI / 2, 0), ROOF, -(tD / 2 - 0.02));
        k.box(seeded(s + i) < 0.6 ? 'glow' : 'sheen', w * 0.9, tH * 0.72, 0.06, T([0, h + tH * 0.42, z + tD / 2 - 0.02]), 0xfff0b0);
    }
    // Roller door in a hazard-striped frame.
    const dw = Math.min(3.4, w * 0.32), dh = Math.min(3.6, h * 0.55);
    k.box('body', dw, dh, 0.14, T([-w * 0.15, dh / 2, d / 2 + 0.06]), 0x5b6066);
    for (let y = 0.35; y < dh; y += 0.45) k.box('body', dw, 0.06, 0.18, T([-w * 0.15, y, d / 2 + 0.08]), 0x464a50);
    const segs = 8;
    for (let i = 0; i < segs; i++) {
        const sx = -w * 0.15 - dw / 2 - 0.16 + (i + 0.5) * (dw + 0.32) / segs;
        k.box('body', (dw + 0.32) / segs, 0.26, 0.2, T([sx, dh + 0.13, d / 2 + 0.1]), HAZ[i % 2]);
    }
    for (const sx of [-1, 1]) k.box('body', 0.2, dh, 0.2, T([-w * 0.15 + sx * (dw / 2 + 0.1), dh / 2, d / 2 + 0.1]), HAZ[1]);
    k.box('glow', 0.8, 0.2, 0.2, T([-w * 0.15, dh + 0.45, d / 2 + 0.2]), 0xffb347);

    // Office block at the +X end, with lit windows.
    const ow = Math.min(3.2, w * 0.3), oh = Math.min(h * 0.62, 5.5), od = d * 0.55;
    k.box('body', ow, oh, od, T([w / 2 + ow / 2 - 0.1, oh / 2, d / 2 - od / 2 + 0.3]), CREAM, { ch: 0.15, top: ROOF });
    for (let y = 1.4; y < oh - 0.6; y += 1.8) {
        windowRow(k, { z: d / 2 + 0.3, y, x0: w / 2 - 0.1, x1: w / 2 + ow - 0.2, cols: 2, pw: 0.8, ph: 1.0, lit: [0xffe0a0], chance: 0.6, seed: s * 7 + y, trim: 0xb9ad94 });
    }
    // Chimneys: banded red and white.
    const stacks = isHQ ? 3 : 1 + (s % 2);
    for (let i = 0; i < stacks; i++) {
        const sx = -w / 2 + 1.4 + i * 2.4, sz = -d / 2 + 1.3, sh = h * (isHQ ? 0.95 : 0.8);
        k.cyl('body', 0.42, 0.55, sh, 12, T([sx, h + sh / 2, sz]), STACK);
        for (const f of [0.62, 0.84]) k.cyl('body', 0.5, 0.52, sh * 0.08, 12, T([sx, h + sh * f, sz]), f < 0.7 ? RED : 0xf2f2f2);
        k.cyl('body', 0.52, 0.48, 0.3, 12, T([sx, h + sh, sz]), 0x2f3236);
    }
    // Roof vents.
    for (let i = 0; i < 2; i++) k.cyl('body', 0.35, 0.35, 0.7, 8, T([w * (0.1 + i * 0.22), h + tH + 0.3, d * 0.1]), 0xa7adb3);
    const grp = k.build();
    grp.position.copy(pos);
    return grp;
}

// ------------------------------------------------------------
// RING ROAD — civic hall
// ------------------------------------------------------------
// A stone hall on a stepped plinth with a portico on both long faces (the
// ring's buildings stand inside the circle, so the camera usually sees their
// back): four columns with bases and capitals, an entablature and a pediment.
// One in three carries a verdigris dome on a drum; the rest fly a flag.
export function civic(pos, opts = {}) {
    const s = Math.abs(Math.round(pos.x * 7 + pos.z * 3)) % 100;
    if (s % 4 === 0) return null;                     // the caller plants a tree on this plot
    const h = 8 + (s % 6);
    const w = 5 + (s % 3);
    const d = 5 + (s % 2);
    const k = new Kit();
    const STONE = 0xd8ccb6, PALE = 0xf1ebdf, STEP = 0xe6dccb, DOME = 0x5fb3a1, ROOF = 0x8a7f72;

    // Stepped plinth. Neighbouring halls on the ring stand close enough for
    // their bottom steps to overlap, and at one shared height the two fought
    // for those pixels (qa/zfight.js); each hall's steps sit a seeded few
    // centimetres apart from the next.
    const lift = (s % 7) * 0.03;
    for (let i = 0; i < 3; i++) k.box('body', w + 1.3 - i * 0.4, 0.3 + (i === 0 ? lift : 0), d + 1.3 - i * 0.4,
                                      T([0, i === 0 ? (0.3 + lift) / 2 : 0.15 + i * 0.3 + lift, 0]), STEP, { ch: 0.05 });
    const base = 0.9 + lift;
    k.box('body', w, h - base, d, T([0, base + (h - base) / 2, 0]), STONE, { ch: 0.16, top: ROOF });
    k.box('body', w + 0.6, 0.5, d + 0.6, T([0, h, 0]), PALE, { ch: 0.12 });

    // Portico on both faces.
    const pH = Math.min(h * 0.62, 6), cols = 4, span = w * 0.86;
    for (const sz of [-1, 1]) {
        const z = sz * (d / 2 + 0.75);
        for (let i = 0; i < cols; i++) {
            const x = -span / 2 + i * span / (cols - 1);
            k.box('body', 0.75, 0.3, 0.75, T([x, base + 0.15, z]), PALE, { ch: 0.06 });
            k.cyl('body', 0.26, 0.3, pH - 0.6, 12, T([x, base + 0.3 + (pH - 0.6) / 2, z]), PALE);
            k.box('body', 0.72, 0.3, 0.72, T([x, base + pH - 0.15, z]), PALE, { ch: 0.06 });
        }
        k.box('body', span + 1.1, 0.6, 1.6, T([0, base + pH + 0.3, sz * (d / 2 + 0.6)]), PALE, { ch: 0.08 });
        k.prism('body', span + 1.2, 1.3, 1.5, at(0, base + pH + 0.6, sz * (d / 2 + 0.6)), STONE);
        // Tall lit windows between the columns.
        windowRow(k, { z: sz * d / 2, sign: sz, y: base + pH * 0.45, x0: -span / 2, x1: span / 2, cols: cols - 1,
                       pw: 0.7, ph: pH * 0.5, lit: [0xffe2a8], chance: 0.55, seed: s * 11 + sz, trim: PALE });
        k.box('body', 1.0, 2.0, 0.12, T([0, base + 1.0, sz * (d / 2 + 0.03)]), 0x5a3d26);
    }
    // Side windows.
    for (const sx of [-1, 1]) {
        windowRow(k, { axis: 'x', z: sx * w / 2, sign: sx, y: base + 2.4, x0: -d / 2 + 0.8, x1: d / 2 - 0.8, cols: 2,
                       pw: 0.8, ph: 1.6, lit: [0xffe2a8], chance: 0.5, seed: s * 5 + sx, trim: PALE });
    }
    // Roof: a dome on some, a flag on the rest.
    if (s % 3 === 0) {
        k.cyl('body', 1.8, 1.9, 1.2, 20, T([0, h + 0.85, 0]), PALE);
        k.geo('sheen', new THREE.SphereGeometry(1.75, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), T([0, h + 1.45, 0]), DOME);
        k.cyl('body', 0.3, 0.35, 0.7, 10, T([0, h + 3.5, 0]), PALE);
        k.geo('body', new THREE.ConeGeometry(0.34, 0.6, 10), T([0, h + 4.15, 0]), 0xd4a93a);
    } else {
        k.cyl('body', 0.05, 0.06, 3.2, 6, T([w * 0.25, h + 1.85, 0]), 0x9aa0a6);
        k.box('body', 1.4, 0.85, 0.05, T([w * 0.25 + 0.72, h + 3.0, 0]), [0x2f6fd6, 0xd94a3a, 0x2f9e5b][s % 3]);
    }
    const grp = k.build();
    grp.position.copy(pos);
    return grp;
}
