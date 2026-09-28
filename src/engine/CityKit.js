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

/** Place a built model and record what it is, so a layout can be exported
 *  from the board and rebuilt exactly (see src/config/layouts). */
function _tag(grp, pos, model, seed, hq) {
    grp.position.copy(pos);
    grp.userData.kit = { model, seed, hq: !!hq };
    return grp;
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
    const s = opts.seed ?? Math.abs(Math.round(pos.x * 7 + pos.z * 13)) % 100;
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
    return _tag(grp, pos, 'fin', s, isHQ);
}

// ------------------------------------------------------------
// BACK ALLEY — brick walk-up
// ------------------------------------------------------------
// Bevelled brick in one of three tones on a dark base course; cream sills,
// lintels and a projecting cornice; a stoop door; a front fire escape on some;
// a neon blade sign on others; and the water tower on every other roof.
export function walkup(pos, isHQ, opts = {}) {
    const s = opts.seed ?? Math.abs(Math.round(pos.x * 5 + pos.z * 11)) % 100;
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
    return _tag(grp, pos, 'ba', s, isHQ);
}

// ------------------------------------------------------------
// SHOPPING PROMENADE — shopfront
// ------------------------------------------------------------
// A saturated two-tone front with white pilasters and cornice, a lit display
// window with mullions, a striped awning, a glowing sign board, and flower
// boxes under the upper windows. The mall HQ gets a glass dome on a drum.
const SHOP_COLS = [0xe0559b, 0x3fb86a, 0x4a86e8, 0xf08c24, 0xa45ad6];
export function shopfront(pos, colorIdx, isHQ, opts = {}) {
    const s = opts.seed ?? Math.abs(Math.round(pos.x * 3 + pos.z * 9)) % 100;
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
    return _tag(grp, pos, 'shop', s, isHQ);
}

// ------------------------------------------------------------
// INDUSTRIAL ZONE — works shed
// ------------------------------------------------------------
// An ochre shed ribbed like corrugated iron over a dark wainscot, a sawtooth
// roof with lit north-lights, a roller door in a hazard-striped frame, red and
// white banded chimneys, roof vents, and a cream office block at one end.
export function works(pos, isHQ, opts = {}) {
    const s = opts.seed ?? Math.abs(Math.round(pos.x * 11 + pos.z * 7)) % 100;
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
    return _tag(grp, pos, 'ind', s, isHQ);
}

// ------------------------------------------------------------
// RING ROAD — civic hall
// ------------------------------------------------------------
// A stone hall on a stepped plinth with a portico on both long faces (the
// ring's buildings stand inside the circle, so the camera usually sees their
// back): four columns with bases and capitals, an entablature and a pediment.
// One in three carries a verdigris dome on a drum; the rest fly a flag.
export function civic(pos, opts = {}) {
    const s = opts.seed ?? Math.abs(Math.round(pos.x * 7 + pos.z * 3)) % 100;
    // On the procedural board one ring plot in four is a tree, not a hall.
    // Asked for by seed (the map editor), a tree seed is a hall anyway.
    if (s % 4 === 0) { if (opts.seed === undefined) return null; return civic(pos, { ...opts, seed: (s + 1) % 100 }); }
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
    return _tag(grp, pos, 'ring', s, false);
}

// ------------------------------------------------------------
// DISTRICT LANDMARKS
// ------------------------------------------------------------
// One per district, standing back from its road. These are the landmarks as
// they were built in Renderer.js, moved here unchanged so the map editor and
// the game draw them from the same code. Rebuilding them in the kit's style
// is the next batch of docs/MODEL_UPGRADE.md.
function dress(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
        color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0,
        emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 0,
        transparent: !!opts.opacity, opacity: opts.opacity ?? 1,
    });
}

function _exchange(live) {                                 // colonnaded exchange
    const g = new THREE.Group();
    const stone = dress(0xd7d2c6, { rough: 0.75 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(22, 2, 13), stone);
    base.position.y = 1; g.add(base);
    const body = new THREE.Mesh(new THREE.BoxGeometry(19, 11, 11), stone);
    body.position.y = 7.5; g.add(body);
    for (let i = 0; i < 7; i++) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 11, 12), stone);
        col.position.set(-8.4 + i * 2.8, 7.5, 6.2); g.add(col);
    }
    const ped = new THREE.Mesh(new THREE.ConeGeometry(11.5, 3.6, 4), stone);
    ped.position.y = 14.6; ped.rotation.y = Math.PI / 4; g.add(ped);
    // A gold arrow over the pediment: the district's own emblem.
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.2, 4),
        dress(0xfbbf24, { rough: 0.3, metal: 0.7, emissive: 0xb45309, ei: 0.4 }));
    arrow.position.y = 18.4; arrow.rotation.y = Math.PI / 4; g.add(arrow);
    return g;
}

function _neonArch(live) {                                 // market gate over the alley
    const g = new THREE.Group();
    const brick = dress(0x5a2417, { rough: 0.95 });
    [-6.5, 6.5].forEach(x => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(2.2, 12, 2.2), brick);
        leg.position.set(x, 6, 0); g.add(leg);
    });
    const span = new THREE.Mesh(new THREE.BoxGeometry(15, 2.4, 2.2), brick);
    span.position.y = 13.2; g.add(span);
    const signMat = new THREE.MeshBasicMaterial({ color: 0xff2d78 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(11, 2.6, 0.3), signMat);
    sign.position.set(0, 13.2, 1.3); g.add(sign);
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0x2ddcff });
    for (let i = 0; i < 5; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.11, 6, 16), tubeMat);
        t.position.set(-4 + i * 2, 10.6, 1.3); g.add(t);
    }
    // Washing lines strung between the legs — the detail that says "lived in".
    const line = dress(0x2a2a2a, { rough: 1 });
    [8.6, 6.4].forEach((y, li) => {
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 13, 5), line);
        rope.rotation.z = Math.PI / 2; rope.position.set(0, y, li ? 1.2 : -1.2); g.add(rope);
        for (let i = 0; i < 6; i++) {
            const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3),
                dress([0xf8fafc, 0x60a5fa, 0xfbbf24, 0xf87171][i % 4],
                          { rough: 0.9, opacity: 0.95 }));
            cloth.material.side = THREE.DoubleSide;
            cloth.position.set(-5 + i * 2, y - 0.75, li ? 1.2 : -1.2); g.add(cloth);
        }
    });
    live({ kind: 'neon', parts: [signMat, tubeMat], seed: 4 });
    return g;
}

function _arcade(live) {                                   // glass arcade with bunting
    const g = new THREE.Group();
    const frame = dress(0xf2e9f7, { rough: 0.5 });
    [-8, 8].forEach(x => {
        const w = new THREE.Mesh(new THREE.BoxGeometry(1.6, 12, 10), frame);
        w.position.set(x, 6, 0); g.add(w);
    });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 8.4, 10, 20, 1, true, 0, Math.PI),
        new THREE.MeshPhysicalMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.42,
            roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide }));
    glass.rotation.z = Math.PI / 2; glass.rotation.y = Math.PI / 2;
    glass.position.y = 12; g.add(glass);
    for (let i = 0; i < 6; i++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(8.4, 0.16, 6, 18, Math.PI), frame);
        rib.position.set(0, 12, -4.6 + i * 1.85); g.add(rib);
    }
    // Bunting between the two piers.
    for (let i = 0; i < 11; i++) {
        const flag = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 3),
            dress([0xef4444, 0xfbbf24, 0x22c55e, 0x3b82f6][i % 4], { rough: 0.7 }));
        const t = i / 10;
        flag.position.set(-7.5 + t * 15, 13.2 - Math.sin(t * Math.PI) * 1.8, 5.4);
        flag.rotation.x = Math.PI; g.add(flag);
    }
    return g;
}

function _coolingTowers(live) {                            // the power plant
    const g = new THREE.Group();
    const shell = dress(0x9c968a, { rough: 0.92 });
    [-7.5, 7.5].forEach((x, i) => {
        const pts = [];
        for (let s = 0; s <= 10; s++) {
            const t = s / 10;
            const rr = 5.4 - Math.sin(t * Math.PI) * 2.2 + t * 1.1;
            pts.push(new THREE.Vector2(rr, t * 18));
        }
        const tower = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), shell);
        tower.position.set(x, 0, i ? 2.5 : -2.5); g.add(tower);
        const puffs = [];
        for (let k = 0; k < 4; k++) {
            const puff = new THREE.Mesh(new THREE.SphereGeometry(3.0, 10, 8),
                new THREE.MeshBasicMaterial({ color: 0xdfe3e8, transparent: true, opacity: 0, depthWrite: false }));
            puff.position.set(x, 18, i ? 2.5 : -2.5); g.add(puff); puffs.push(puff);
        }
        live({ kind: 'steam', puffs, seed: 20 + i * 3, rise: 13, base: 18,
                         spread: 2.2, x, z: i ? 2.5 : -2.5 });
    });
    // A red aircraft beacon on a gantry between them.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 22, 8),
        dress(0x6b6f66, { rough: 0.6, metal: 0.5 }));
    mast.position.y = 11; g.add(mast);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), lampMat);
    lamp.position.y = 22.4; g.add(lamp);
    live({ kind: 'beacon', mat: lampMat, seed: 1 });
    return g;
}

const LANDMARKS = { fin: _exchange, ba: _neonArch, shop: _arcade, ind: _coolingTowers };

/** A district landmark, at the origin. `live` registers its animated parts. */
export function landmark(key, opts = {}) {
    const make = LANDMARKS[key];
    if (!make) return null;
    const g = make(opts.live || (() => {}));
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.userData.kit = { model: 'lm-' + key, seed: 0, hq: false };
    return g;
}

// ------------------------------------------------------------
// PLOT TREE — what one Ring Road plot in four holds instead of a hall
// ------------------------------------------------------------
export function tree(pos, opts = {}) {
    const k = new Kit();
    k.cyl('body', 0.22, 0.3, 2.2, 6, T([0, 1.1, 0]), 0x5a3010);
    k.geo('body', new THREE.SphereGeometry(1.6, 8, 8), at(0, 3.3, 0, 0, 0, 0, 1, 1.15, 1), 0x2a7a18);
    return _tag(k.build(), pos, 'tree', 0, false);
}


// ------------------------------------------------------------
// STREET PIECES — props, overhead spans, lamps, benches, the fountain
// ------------------------------------------------------------
// Moved here unchanged from Renderer.js so the map editor places them with
// the same code the game draws them with. Each prop function still picks
// its kind from `r` (the bands below); a layout names the kind directly.

/** A box with round corners (three r128 has no RoundedBoxGeometry). */
function roundedBox(w, h, d, r, seg = 4) {
    const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    const pos = g.attributes.position;
    const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
    const v = new THREE.Vector3(), c = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        c.set(Math.max(-ix, Math.min(ix, v.x)), Math.max(-iy, Math.min(iy, v.y)), Math.max(-iz, Math.min(iz, v.z)));
        o.copy(v).sub(c);
        if (o.lengthSq() > 1e-9) { o.setLength(r); v.copy(c).add(o); pos.setXYZ(i, v.x, v.y, v.z); }
    }
    g.computeVertexNormals();
    return g;
}

const _street = {};
function streetMats() {
    if (_street.pole) return _street;
    Object.assign(_street, {
        pole:  new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.3 }),
        glow:  new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffff44, emissiveIntensity: 1.0 }),
        bench: new THREE.MeshStandardMaterial({ color: 0x8a6030, roughness: 0.8 }),
        benchMetal: new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.7, roughness: 0.4 }),
        concrete: new THREE.MeshStandardMaterial({ color: 0x8a8680, roughness: 0.85 }),
        water: new THREE.MeshPhysicalMaterial({ color: 0x3399cc, transparent: true, opacity: 0.72, roughness: 0.08, metalness: 0.2 }),
    });
    return _street;
}

/** A park bench, at the origin, facing +Z. */
export function bench() {
    const M = streetMats();
    const grp = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.65), M.bench);
    seat.position.y = 0.72; grp.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.85, 0.1), M.bench);
    back.position.set(0, 1.14, -0.27); grp.add(back);
    const legGeo = new THREE.BoxGeometry(0.14, 0.72, 0.65);
    [-0.8, 0.8].forEach(x => { const leg = new THREE.Mesh(legGeo, M.benchMetal); leg.position.set(x, 0.36, 0); grp.add(leg); });
    return grp;
}

/** A street lamp, its arm reaching along +X. */
export function lamp() {
    const M = streetMats();
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 8.5, 7), M.pole);
    pole.position.y = 4.25; pole.castShadow = true; grp.add(pole);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.2, 6), M.pole);
    arm.rotation.z = Math.PI / 2; arm.position.set(1.1, 8.4, 0); grp.add(arm);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.55, 8), M.pole);
    head.position.set(2.1, 8.2, 0); grp.add(head);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), M.glow);
    glow.position.set(2.1, 8.1, 0); grp.add(glow);
    return grp;
}

/** The park fountain: platform, basin, water, column and spray. */
export function fountain() {
    const M = streetMats();
    const g = new THREE.Group();
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.4, 32), M.concrete);
    platform.position.y = -0.38; g.add(platform);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 1.0, 32), M.concrete);
    basin.position.y = 0.28; g.add(basin);
    const water = new THREE.Mesh(new THREE.CircleGeometry(5.2, 32), M.water);
    water.rotation.x = -Math.PI / 2; water.position.y = 0.82; g.add(water);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 3.5, 8),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.5, roughness: 0.4 }));
    col.position.y = 2.35; g.add(col);
    const spray = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.2, 16),
        new THREE.MeshPhysicalMaterial({ color: 0x99ccff, transparent: true, opacity: 0.35, roughness: 0.1 }));
    spray.position.y = 5.1; g.add(spray);
    return g;
}

function _propFinance(r, seed, live) {
    const g = new THREE.Group();
    if (r < 0.34) {                                    // stone planter with a hedge
        const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.2), dress(0xbfc6d1, { rough: 0.7 }));
        box.position.y = 0.45; g.add(box);
        const hedge = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.8, 0.95), dress(0x2f6b32, { rough: 0.95 }));
        hedge.position.y = 1.2; g.add(hedge);
    } else if (r < 0.66) {                             // bollard row
        for (let i = 0; i < 4; i++) {
            const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.0, 8),
                dress(0xd8dee8, { rough: 0.4, metal: 0.6 }));
            b.position.set((i - 1.5) * 0.95, 0.5, 0); g.add(b);
        }
    } else {                                            // ticker board
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 3.0, 8),
            dress(0x5b6472, { rough: 0.4, metal: 0.7 }));
        post.position.y = 1.5; g.add(post);
        const board = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.95, 0.22), dress(0x0b1220, { rough: 0.5 }));
        board.position.y = 3.1; g.add(board);
        const bars = [];
        for (let i = 0; i < 7; i++) {
            const up = seeded(seed * 5 + i) > 0.45;
            const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.5),
                new THREE.MeshBasicMaterial({ color: up ? 0x22c55e : 0xef4444 }));
            bar.position.set(-1.3 + i * 0.44, 3.1, 0.13);
            g.add(bar); bars.push(bar);
        }
        live({ kind: 'ticker', bars, seed });
    }
    return g;
}

// Back Alley: dumpsters, crate stacks, steam vents, flickering neon.
function _propAlley(r, seed, live) {
    const g = new THREE.Group();
    if (r < 0.3) {                                      // dumpster
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 1.3), dress(0x2f5f3a, { rough: 0.8 }));
        body.position.y = 0.7; g.add(body);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.16, 1.4), dress(0x24482d, { rough: 0.8 }));
        lid.position.set(0, 1.5, -0.1); lid.rotation.x = -0.25; g.add(lid);
    } else if (r < 0.55) {                              // crates and a barrel
        for (let i = 0; i < 3; i++) {
            const s = 0.7 + seeded(seed + i) * 0.4;
            const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), dress(0x8a6a3c, { rough: 0.95 }));
            c.position.set((i - 1) * 0.85, s / 2 + (i === 1 ? 0.75 : 0), seeded(seed * 3 + i) * 0.5);
            c.rotation.y = seeded(seed + i * 2) * 0.7; g.add(c);
        }
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 10),
            dress(0x7a3b22, { rough: 0.85 }));
        barrel.position.set(1.5, 0.55, 0.2); g.add(barrel);
    } else if (r < 0.72) {                              // steam vent
        const grate = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.14, 12),
            dress(0x3a3a3a, { rough: 0.7, metal: 0.5 }));
        grate.position.y = 0.07; g.add(grate);
        const puffs = [];
        for (let i = 0; i < 4; i++) {
            const puff = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6),
                new THREE.MeshBasicMaterial({ color: 0xd8dde5, transparent: true,
                    opacity: 0.0, depthWrite: false }));
            puff.position.y = 0.3; g.add(puff); puffs.push(puff);
        }
        live({ kind: 'steam', puffs, seed, rise: 4.5, spread: 0.5 });
    } else {                                            // neon sign on a bracket
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.4), dress(0x333333, { rough: 0.6, metal: 0.5 }));
        arm.position.set(0, 3.0, 0.7); g.add(arm);
        const col = [0xff2d78, 0x2ddcff, 0xffd12d, 0x8b5cf6][Math.floor(seeded(seed * 9) * 4)];
        const tube = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.09, 6, 18),
            new THREE.MeshBasicMaterial({ color: col }));
        tube.position.set(0, 2.8, 1.4); g.add(tube);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.13, 0.13),
            new THREE.MeshBasicMaterial({ color: col }));
        bar.position.set(0, 2.8, 1.4); g.add(bar);
        live({ kind: 'neon', parts: [tube.material, bar.material], seed });
    }
    return g;
}

// Promenade: market stalls, kiosks, planters, sandwich boards.
function _propMarket(r, seed, live) {
    const g = new THREE.Group();
    const stripe = [0xef4444, 0x22c55e, 0x3b82f6, 0xf59e0b][Math.floor(seeded(seed * 3) * 4)];
    if (r < 0.5) {                                      // stall with a striped awning
        for (let i = 0; i < 4; i++) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.0, 6),
                dress(0xd6d3d1, { rough: 0.6, metal: 0.3 }));
            leg.position.set(i < 2 ? -1.1 : 1.1, 1.0, i % 2 ? -0.7 : 0.7); g.add(leg);
        }
        const table = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 1.6), dress(0xa1854f, { rough: 0.9 }));
        table.position.y = 1.0; g.add(table);
        // Awning: two sloped panels in the stall's colour and white.
        [-1, 1].forEach(s => {
            const panel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.05),
                dress(s > 0 ? stripe : 0xf8fafc, { rough: 0.7 }));
            panel.position.set(0, 2.25, s * 0.5);
            panel.rotation.x = s * 0.42; g.add(panel);
        });
        // Goods on the table.
        for (let i = 0; i < 3; i++) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6),
                dress([0xef4444, 0xfbbf24, 0x22c55e][i], { rough: 0.7 }));
            b.position.set(-0.7 + i * 0.7, 1.2, 0); g.add(b);
        }
    } else if (r < 0.75) {                              // kiosk
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 2.4, 10),
            dress(0xe8e2ee, { rough: 0.7 }));
        body.position.y = 1.2; g.add(body);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.8, 10), dress(stripe, { rough: 0.7 }));
        roof.position.y = 2.8; g.add(roof);
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7),
            dress(0xffffff, { rough: 0.5, emissive: 0xffffff, ei: 0.25 }));
        board.position.set(0, 1.6, 1.02); g.add(board);
    } else {                                            // planter + sandwich board
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.45, 0.8, 10),
            dress(0xb08968, { rough: 0.9 }));
        pot.position.y = 0.4; g.add(pot);
        const bush = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), dress(0x2f6b32, { rough: 0.95 }));
        bush.position.y = 1.25; bush.scale.y = 1.15; g.add(bush);
        [-1, 1].forEach(s => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.06), dress(0x6b4f2a, { rough: 0.9 }));
            p.position.set(1.6, 0.65, s * 0.16); p.rotation.x = s * 0.22; g.add(p);
        });
    }
    return g;
}

// Industrial: pipe runs, containers, cones, and a smoking stack.
function _propWorks(r, seed, live) {
    const g = new THREE.Group();
    if (r < 0.32) {                                     // pipe run on trestles
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 5.2, 10),
            dress(0x8a8f7a, { rough: 0.6, metal: 0.5 }));
        pipe.rotation.z = Math.PI / 2; pipe.position.y = 1.35; g.add(pipe);
        [-1.9, 1.9].forEach(x => {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.35, 0.2), dress(0x5c6157, { rough: 0.7, metal: 0.4 }));
            leg.position.set(x, 0.68, 0); g.add(leg);
        });
        const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.2, 10),
            dress(0xb45309, { rough: 0.6, metal: 0.4 }));
        flange.rotation.z = Math.PI / 2; flange.position.y = 1.35; g.add(flange);
    } else if (r < 0.6) {                               // cargo containers
        const cols = [0xb45309, 0x1d4ed8, 0x15803d, 0x991b1b];
        for (let i = 0; i < 2; i++) {
            const c = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.5, 1.5),
                dress(cols[Math.floor(seeded(seed * 3 + i) * 4)], { rough: 0.85, metal: 0.2 }));
            c.position.set(seeded(seed + i) * 0.5, 0.75 + i * 1.55, 0);
            c.rotation.y = (seeded(seed * 7 + i) - 0.5) * 0.25; g.add(c);
        }
    } else if (r < 0.78) {                              // hazard cones and a barrier
        for (let i = 0; i < 3; i++) {
            const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.85, 8), dress(0xf97316, { rough: 0.8 }));
            cone.position.set((i - 1) * 1.1, 0.42, seeded(seed + i) * 0.4); g.add(cone);
            const band = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.14, 8), dress(0xf8fafc, { rough: 0.7 }));
            band.position.copy(cone.position).setY(0.52); g.add(band);
        }
    } else {                                            // smoking stack
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.78, 5.2, 12),
            dress(0x8a8070, { rough: 0.9 }));
        stack.position.y = 2.6; g.add(stack);
        [1.5, 3.2, 4.6].forEach(y => {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.09, 6, 14), dress(0x59544a, { rough: 0.8 }));
            ring.position.y = y; ring.rotation.x = Math.PI / 2; g.add(ring);
        });
        const puffs = [];
        for (let i = 0; i < 5; i++) {
            const puff = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 6),
                new THREE.MeshBasicMaterial({ color: 0xc9ccd2, transparent: true, opacity: 0, depthWrite: false }));
            puff.position.y = 5.2; g.add(puff); puffs.push(puff);
        }
        live({ kind: 'steam', puffs, seed, rise: 7.0, base: 5.2, spread: 1.1 });
    }
    return g;
}

// Ring road: the civic baseline — hedges, benches, parked cars, crossings.
function _propCivic(r, seed, live) {
    const g = new THREE.Group();
    if (r < 0.4) {                                      // hedge run
        const hedge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.0, 1.0), dress(0x2f6b32, { rough: 0.95 }));
        hedge.position.y = 0.5; g.add(hedge);
    } else if (r < 0.72) {                              // parked car
        const cols = [0xdc2626, 0x2563eb, 0xf8fafc, 0x111827, 0x16a34a];
        const col = cols[Math.floor(seeded(seed * 5) * 5)];
        const body = new THREE.Mesh(roundedBox(3.9, 1.0, 1.7, 0.32, 4), dress(col, { rough: 0.35, metal: 0.35 }));
        body.position.y = 0.78; g.add(body);
        const cabin = new THREE.Mesh(roundedBox(2.0, 0.8, 1.5, 0.3, 4),
            dress(0x93c5fd, { rough: 0.15, metal: 0.2, opacity: 0.85 }));
        cabin.position.set(-0.25, 1.5, 0); g.add(cabin);
        [[-1.3, 0.65], [1.3, 0.65], [-1.3, -0.65], [1.3, -0.65]].forEach(([x, z]) => {
            const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10), dress(0x1c1c1c, { rough: 0.9 }));
            w.rotation.x = Math.PI / 2; w.position.set(x, 0.38, z); g.add(w);
        });
    } else {                                            // bench and a bin
        g.add(bench());
        const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.9, 10),
            dress(0x4b5563, { rough: 0.7, metal: 0.3 }));
        bin.position.set(1.7, 0.45, 0); g.add(bin);
    }
    return g;
}


export const SPAN_HALF = 7.4;

function _spanLegs(g, mat, height, thick = 0.55) {
    [-SPAN_HALF, SPAN_HALF].forEach(x => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(thick, height, thick), mat);
        leg.position.set(x, height / 2, 0);
        g.add(leg);
    });
}

function _spanTickerArch(i, live) {                    // Financial: the boards overhead
    const g = new THREE.Group();
    const steel = dress(0xb8c2cf, { rough: 0.35, metal: 0.7 });
    _spanLegs(g, steel, 8.4, 0.6);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2 + 1.2, 0.5, 1.0), steel);
    deck.position.y = 8.4; g.add(deck);
    const face = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2, 1.9, 0.28),
        dress(0x080d16, { rough: 0.45 }));
    face.position.set(0, 7.2, 0.62); g.add(face);
    const bars = [];
    for (let k = 0; k < 16; k++) {
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.1),
            new THREE.MeshBasicMaterial({ color: 0x22c55e }));
        bar.position.set(-SPAN_HALF + 0.75 + k * 0.94, 7.2, 0.78);
        g.add(bar); bars.push(bar);
    }
    live({ kind: 'ticker', bars, seed: 90 + i * 5 });
    // A gold band under the deck picks the district's colour out at night.
    const band = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2 + 1.2, 0.16, 1.02),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24 }));
    band.position.y = 8.1; g.add(band);
    return g;
}

function _spanLaundry(i, live) {                       // Back Alley: lines and dead neon
    const g = new THREE.Group();
    const brick = dress(0x4a2018, { rough: 0.95 });
    // Two tenement walls right at the kerb, so the alley is enclosed.
    [-1, 1].forEach(sgn => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 13, 11), brick);
        wall.position.set(sgn * (SPAN_HALF + 0.7), 6.5, 0); g.add(wall);
        // Fire escape: three landings and their rails.
        for (let f = 0; f < 3; f++) {
            const deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 3.2),
                dress(0x2c2c2c, { rough: 0.6, metal: 0.55 }));
            deck.position.set(sgn * (SPAN_HALF - 0.6), 3.4 + f * 3.1, 0); g.add(deck);
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 3.2),
                dress(0x2c2c2c, { rough: 0.6, metal: 0.55 }));
            rail.position.set(sgn * (SPAN_HALF - 1.3), 3.9 + f * 3.1, 0); g.add(rail);
        }
        // Lit window squares up the wall — the cheapest "people live here".
        for (let w = 0; w < 5; w++) {
            const lit = seeded(i * 13 + w + (sgn > 0 ? 7 : 0)) > 0.45;
            const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1),
                new THREE.MeshBasicMaterial({ color: lit ? 0xffd88a : 0x14171f }));
            win.position.set(sgn * (SPAN_HALF - 0.05), 4.5 + w * 1.9, -3.4 + (w % 2) * 6.8);
            win.rotation.y = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
            g.add(win);
        }
    });
    // Three washing lines across, sagging.
    const rope = dress(0x1e1e1e, { rough: 1 });
    [7.2, 9.6, 11.4].forEach((y, li) => {
        const line = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, SPAN_HALF * 2, 5), rope);
        line.rotation.z = Math.PI / 2;
        line.position.set(0, y, -2 + li * 2); g.add(line);
        for (let k = 0; k < 7; k++) {
            const t = (k + 0.5) / 7;
            const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.4),
                dress([0xf1f5f9, 0x60a5fa, 0xfbbf24, 0xf87171, 0x86efac][(k + li) % 5], { rough: 0.9 }));
            cloth.material.side = THREE.DoubleSide;
            cloth.position.set(-SPAN_HALF + t * SPAN_HALF * 2,
                               y - 0.8 - Math.sin(t * Math.PI) * 0.5, -2 + li * 2);
            g.add(cloth);
        }
    });
    // A dead neon sign hanging over the middle of the road.
    const col = [0xff2d78, 0x35e0ff, 0xa855f7][i % 3];
    const signMat = new THREE.MeshBasicMaterial({ color: col });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.5, 0.22), signMat);
    sign.position.set(0, 5.6, 1.2); g.add(sign);
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0xfff3a0 });
    for (let k = 0; k < 3; k++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.1, 6, 14), tubeMat);
        t.position.set(-1.3 + k * 1.3, 4.2, 1.2); g.add(t);
    }
    live({ kind: 'neon', parts: [signMat, tubeMat], seed: 30 + i * 3 });
    return g;
}

function _spanBunting(i, live) {                       // Promenade: the parade arch
    const g = new THREE.Group();
    const pole = dress(0xf5eaf8, { rough: 0.5 });
    _spanLegs(g, pole, 7.6, 0.4);
    [-SPAN_HALF, SPAN_HALF].forEach(x => {
        const finial = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10),
            dress(0xfbbf24, { rough: 0.3, metal: 0.6 }));
        finial.position.set(x, 8.0, 0); g.add(finial);
    });
    // Three swags of bunting at different depths, each a catenary of triangles.
    const cols = [0xef4444, 0xfbbf24, 0x22c55e, 0x3b82f6, 0xf472b6];
    [0, 1, 2].forEach(row => {
        for (let k = 0; k < 13; k++) {
            const t = k / 12;
            const flag = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.85, 3),
                dress(cols[(k + row) % 5], { rough: 0.65 }));
            flag.position.set(-SPAN_HALF + t * SPAN_HALF * 2,
                              7.2 - Math.sin(t * Math.PI) * 1.7 - row * 0.15,
                              -2.2 + row * 2.2);
            flag.rotation.x = Math.PI;
            g.add(flag);
        }
    });
    // A banner across the top.
    const banner = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 1.5, 1.5, 0.2),
        dress(0xf472b6, { rough: 0.6, emissive: 0xd6337f, ei: 0.35 }));
    banner.position.set(0, 8.3, 0); g.add(banner);
    // Balloon cluster tied to one leg.
    const side = i % 2 ? 1 : -1;
    for (let k = 0; k < 6; k++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8),
            dress(cols[k % 5], { rough: 0.35 }));
        b.scale.y = 1.2;
        b.position.set(side * (SPAN_HALF - 0.9) + (seeded(i * 9 + k) - 0.5) * 1.4,
                       5.6 + seeded(i * 5 + k) * 1.5,
                       (seeded(i * 3 + k) - 0.5) * 1.4);
        g.add(b);
    }
    return g;
}

function _spanPipeBridge(i, live) {                    // Industrial: the works overhead
    const g = new THREE.Group();
    const steel = dress(0x6d7268, { rough: 0.55, metal: 0.6 });
    _spanLegs(g, steel, 7.0, 0.75);
    // Lattice deck.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2 + 1.5, 0.4, 2.6), steel);
    deck.position.y = 7.0; g.add(deck);
    for (let k = 0; k < 9; k++) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.5, 0.18), steel);
        brace.position.set(-SPAN_HALF + k * (SPAN_HALF * 2 / 8), 6.3, 0);
        brace.rotation.z = (k % 2 ? 1 : -1) * 0.7; g.add(brace);
    }
    // Three pipes running the span, one of them painted hazard orange.
    [[-0.8, 0x8a8f7a], [0, 0xb45309], [0.8, 0x7e8478]].forEach(([z, c], k) => {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, SPAN_HALF * 2 + 1.5, 10),
            dress(c, { rough: 0.6, metal: 0.45 }));
        pipe.rotation.z = Math.PI / 2;
        pipe.position.set(0, 7.9 + (k === 1 ? 0.1 : 0), z * 1.5); g.add(pipe);
    });
    // Floodlights aimed down at the road.
    [-1, 1].forEach(sgn => {
        const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), steel);
        head.position.set(sgn * (SPAN_HALF - 1.6), 6.6, 1.6);
        head.rotation.x = 0.5; g.add(head);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.5),
            new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
        glow.position.set(sgn * (SPAN_HALF - 1.6), 6.35, 1.9);
        glow.rotation.x = -1.1; g.add(glow);
    });
    // Hazard chevrons on the legs.
    [-SPAN_HALF, SPAN_HALF].forEach(x => {
        for (let k = 0; k < 3; k++) {
            const ch = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.28, 0.8),
                dress(k % 2 ? 0x111111 : 0xfacc15, { rough: 0.8 }));
            ch.position.set(x, 0.5 + k * 0.34, 0); g.add(ch);
        }
    });
    return g;
}

function _spanGantrySign(i, live) {                    // Ring road: motorway signage
    const g = new THREE.Group();
    const steel = dress(0x9aa3ad, { rough: 0.4, metal: 0.65 });
    _spanLegs(g, steel, 6.6, 0.42);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2 + 1.0, 0.32, 0.42), steel);
    beam.position.y = 6.6; g.add(beam);
    const board = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.0, 0.22),
        dress(0x1b5e2a, { rough: 0.7 }));
    board.position.set(0, 5.4, 0.35); g.add(board);
    [0, 1].forEach(r => {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(4.4 - r * 1.4, 0.3),
            new THREE.MeshBasicMaterial({ color: 0xf1f5f9 }));
        line.position.set(-0.4 + r * 0.5, 5.8 - r * 0.75, 0.48); g.add(line);
    });
    return g;
}


// Which prop each district's dressing puts down, by the band `r` falls in.
const PROP_KINDS = {
    finance: [[0.34, 'planter'], [0.66, 'bollards'], [1, 'ticker']],
    alley:   [[0.3, 'dumpster'], [0.55, 'crates'], [0.72, 'steam'], [1, 'neon']],
    market:  [[0.5, 'stall'], [0.75, 'kiosk'], [1, 'sandwich']],
    works:   [[0.32, 'pipes'], [0.6, 'containers'], [0.78, 'cones'], [1, 'stack']],
    civic:   [[0.4, 'hedge'], [0.72, 'car'], [1, 'benchbin']],
};
const PROP_MAKERS = { finance: _propFinance, alley: _propAlley, market: _propMarket, works: _propWorks, civic: _propCivic };
export const spanLegs = _spanLegs;
const SPAN_MAKERS = { fin: _spanTickerArch, ba: _spanLaundry, shop: _spanBunting, ind: _spanPipeBridge, ring: _spanGantrySign };

function _shadowed(g) { g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g; }

/** A street prop of `set` (a district's dressing style), kind picked by r. Tagged for layouts. */
export function prop(set, r, seed, opts = {}) {
    const make = PROP_MAKERS[set];
    if (!make) return null;
    const g = make(r, seed, opts.live || (() => {}));
    if (!g) return null;
    const kind = PROP_KINDS[set].find(([top]) => r < top)[1];
    g.userData.kit = { model: 'prop-' + set + '-' + kind, seed, hq: false };
    return _shadowed(g);
}
/** A prop named by kind: the middle of its band, so it is always that kind. */
function propKind(set, kind, seed, opts) {
    const bands = PROP_KINDS[set], i = bands.findIndex(b => b[1] === kind);
    const lo = i ? bands[i - 1][0] : 0, r = (lo + bands[i][0]) / 2;
    return prop(set, r, seed, opts);
}

/** An overhead span across a road; `i` (0 or 1) is which of a district's two. */
export function span(key, i, opts = {}) {
    const make = SPAN_MAKERS[key];
    if (!make) return null;
    const g = make(i, opts.live || (() => {}));
    if (!g) return null;
    g.userData.kit = { model: 'span-' + key, seed: i, hq: false };
    return _shadowed(g);
}

/** Tag a street piece built without a seed. */
function _piece(g, model) { g.userData.kit = { model, seed: 0, hq: false }; return _shadowed(g); }
export function lampPiece() { return _piece(lamp(), 'lamp'); }
export function benchPiece() { return _piece(bench(), 'bench'); }
export function fountainPiece() { return _piece(fountain(), 'fountain'); }

// ------------------------------------------------------------
// ROADS THROUGH MOVED SPACES
// ------------------------------------------------------------
/**
 * A smooth road through `points` ([x, z] pairs), sampled at n+1 points. When a
 * layout moves a district's spaces, the game lays that district's road along
 * this curve (Renderer.lobeSamples), and the map editor previews it with the
 * same function, so the two cannot disagree. Centripetal, so a road does not
 * overshoot or loop between spaces that are close together.
 */
export function roadCurve(points, n) {
    const c = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    return c.getPoints(n);
}

// ------------------------------------------------------------
// THE MODEL LIBRARY — what a layout can place
// ------------------------------------------------------------
// A layout item is { model, seed, hq, x, z, rotY, scale } (src/config/layouts).
// `seed` picks the variant (height, width, colour and options), independent
// of where the model stands, so moving a building never changes its look.
// Fields: `cat` is what kind of piece it is (the editor's library tabs and
// its conflict rules); `occlude` makes it fade out of the camera's way, with
// `half` the footprint half-width that test uses; `seeds` is how many
// variants the seed picks between; `spansRoad` marks pieces built to stand
// over the road, which the editor's keep-out test leaves alone.
const ORIGIN = new THREE.Vector3();
const B = { cat: 'building', variants: true, occlude: true, seeds: 100 };
const P = { cat: 'prop', variants: true, seeds: 100 };
export const MODELS = {
    fin:  { ...B, name: 'Glass tower',   district: 'Financial District', hq: true, half: 5.0, build: o => tower(ORIGIN, o.hq, o) },
    ba:   { ...B, name: 'Brick walk-up', district: 'Back Alley',         hq: true, half: 5.5, build: o => walkup(ORIGIN, o.hq, o) },
    shop: { ...B, name: 'Shopfront',     district: 'Shopping Promenade', hq: true, half: 5.0, build: o => shopfront(ORIGIN, undefined, o.hq, o) },
    ind:  { ...B, name: 'Works shed',    district: 'Industrial Zone',    hq: true, half: 6.5, build: o => works(ORIGIN, o.hq, o) },
    ring: { ...B, name: 'Civic hall',    district: 'Ring Road',          hq: false, half: 4.5, build: o => civic(ORIGIN, o) },
    'lm-fin':  { cat: 'landmark', name: 'The Exchange',   district: 'Financial District', half: 11, build: o => landmark('fin', o) },
    'lm-ba':   { cat: 'landmark', name: 'Neon arch',      district: 'Back Alley',         half: 8,  build: o => landmark('ba', o) },
    'lm-shop': { cat: 'landmark', name: 'Glass arcade',   district: 'Shopping Promenade', half: 9,  build: o => landmark('shop', o) },
    'lm-ind':  { cat: 'landmark', name: 'Cooling towers', district: 'Industrial Zone',    half: 13, build: o => landmark('ind', o) },
    'span-fin':  { cat: 'span', name: 'Ticker arch',  district: 'Financial District', seeds: 2, variants: true, occlude: true, half: SPAN_HALF * 0.6, spansRoad: true, build: o => span('fin', o.seed, o) },
    'span-ba':   { cat: 'span', name: 'Washing lines', district: 'Back Alley',        seeds: 2, variants: true, occlude: true, half: SPAN_HALF * 0.6, spansRoad: true, build: o => span('ba', o.seed, o) },
    'span-shop': { cat: 'span', name: 'Bunting arch', district: 'Shopping Promenade', seeds: 2, variants: true, occlude: true, half: SPAN_HALF * 0.6, spansRoad: true, build: o => span('shop', o.seed, o) },
    'span-ind':  { cat: 'span', name: 'Pipe bridge',  district: 'Industrial Zone',    seeds: 2, variants: true, occlude: true, half: SPAN_HALF * 0.6, spansRoad: true, build: o => span('ind', o.seed, o) },
    'span-ring': { cat: 'span', name: 'Road sign gantry', district: 'Ring Road',       seeds: 2, variants: true, occlude: true, half: SPAN_HALF * 0.6, spansRoad: true, build: o => span('ring', o.seed, o) },
    tree:     { cat: 'furniture', name: 'Tree',      district: 'Ring Road', occlude: true, half: 2.0, build: o => tree(ORIGIN, o) },
    lamp:     { cat: 'furniture', name: 'Street lamp', district: 'Ring Road', build: () => lampPiece() },
    bench:    { cat: 'furniture', name: 'Bench',     district: 'Ring Road', build: () => benchPiece() },
    fountain: { cat: 'furniture', name: 'Fountain',  district: 'Ring Road', build: () => fountainPiece() },
};
const PROP_NAMES = {
    finance: { district: 'Financial District', planter: 'Planter', bollards: 'Bollards', ticker: 'Ticker board' },
    alley:   { district: 'Back Alley', dumpster: 'Dumpster', crates: 'Crates and barrel', steam: 'Steam vent', neon: 'Neon sign' },
    market:  { district: 'Shopping Promenade', stall: 'Market stall', kiosk: 'Kiosk', sandwich: 'Sandwich board' },
    works:   { district: 'Industrial Zone', pipes: 'Pipe run', containers: 'Containers', cones: 'Hazard cones', stack: 'Smoking stack' },
    civic:   { district: 'Ring Road', hedge: 'Hedge', car: 'Parked car', benchbin: 'Bench and bin' },
};
Object.entries(PROP_KINDS).forEach(([set, bands]) => bands.forEach(([, kind]) => {
    MODELS['prop-' + set + '-' + kind] = { ...P, name: PROP_NAMES[set][kind], district: PROP_NAMES[set].district,
                                           build: o => propKind(set, kind, o.seed, o) };
}));

/** Build one layout item at the origin (the caller places it). */
export function buildModel(item, opts = {}) {
    const M = MODELS[item.model];
    if (!M) return null;
    return M.build({ ...opts, seed: item.seed, hq: !!item.hq });
}
