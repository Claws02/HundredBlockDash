// ============================================================
// GO-KART GRAND PRIX — three laps of one of five circuits, picked at random.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Face-off hold, SPLIT SCREEN: each half is that player's own chase camera,
// the far half rolled 180° so it reads the right way up from its own end.
// Each player's character drives a kart.
//
//   The kart drives itself. DRAG left/right on your half to steer.
//   Steer hard at speed to DRIFT: sparks go blue, then orange. Straighten up
//   to fire a mini-turbo.
//   TAP to use your item: 🍄 a boost, or 🍌 a banana dropped behind you.
//
// The circuits: THE PARK CIRCUIT (a shortcut path across the south hairpin),
// CANYON SWITCHBACKS (hairpins, a long straight, a narrow gorge to cut
// through), BEACH BOARDWALK (sweeping S-bends, the pier, boost pads),
// SNOWY MOUNTAIN (black ice that slides you about, a tunnel) and NEON CITY
// NIGHT (square downtown corners between lit barriers).
// Walls line the track and any path: hit one head-on and you back off it.
// Laps count through checkpoints in order. First to finish three laps wins.
//
// The MUSHROOM is the big one: a long surge well past top speed, with
// flames out of the back, the camera pulling wide and speed lines racing
// past the edges of your half.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects } from '../engine/StageKit.js';

// ── The circuits ─────────────────────────────────────────────────────────────
// Five of them; each race picks one at random. A circuit is a closed polygon
// whose corners are rounded off with arcs of a given radius (straights and
// true arcs, so every corner is a corner a kart can take), sampled every half
// unit into a table: s = 0 is the start line, and everything else — laps,
// walls, the racing line, item boxes — reads the table. A shortcut is a
// straight, narrow path between two points on the circuit.
const TRACK_W = 8;
const LAPS = 3;
const MAX_TIME = 150;                          // s: a safety bell, then by position
const CP_WIN = 5;
const REVERSE = 0.7, REVERSE_V = 3.5;          // backing off a wall
const BUMP = 5.5;                              // shove between karts
const TRACKS = [
    {   key: 'park', name: 'THE PARK CIRCUIT', place: 'CITY RING ROAD · THE PARK CIRCUIT', sub: 'MIND THE SHORTCUT',
        corners: [[14, -36, 14], [14, 36, 14], [-14, 36, 14], [-14, -36, 14]], start: [14, 0],
        cut: { a: [-14, -22], b: [14, -22] }, theme: 'park' },
    {   key: 'canyon', name: 'CANYON SWITCHBACKS', place: 'BOOT HILL BADLANDS · CANYON SWITCHBACKS', sub: 'HAIRPINS · A GORGE TO CUT THROUGH',
        corners: [[28, -26, 7], [28, -10, 7], [-6, -10, 7], [-6, 4, 7], [28, 4, 7], [28, 18, 7], [-28, 18, 8], [-28, -26, 8]], start: [0, -26],
        cut: { a: [3, -10], b: [3, 4], w: 4.2 }, theme: 'canyon' },
    {   key: 'beach', name: 'BEACH BOARDWALK', place: 'THE PROMENADE · BEACH BOARDWALK', sub: 'S-BENDS · THE PIER · BOOST PADS',
        corners: [[30, -30, 12], [32, -6, 9], [20, 4, 7], [32, 16, 9], [24, 32, 11], [-26, 32, 12], [-32, 6, 10], [-26, -30, 12]], start: [0, -30],
        pier: [0.83, 0.97], pads: [0.49, 0.55, 0.61], theme: 'beach' },
    {   key: 'snow', name: 'SNOWY MOUNTAIN', place: 'THE MOUNTAIN PASS · SNOWY MOUNTAIN', sub: 'BLACK ICE · THE TUNNEL',
        corners: [[26, -28, 10], [30, 0, 9], [12, 8, 8], [22, 30, 10], [-20, 30, 10], [-30, 6, 9], [-12, -4, 8], [-24, -28, 10]], start: [0, -28],
        ice: [0.2, 0.34], tunnel: [0.56, 0.68], theme: 'snow' },
    {   key: 'city', name: 'NEON CITY NIGHT', place: 'DOWNTOWN · NEON CITY NIGHT', sub: 'SQUARE CORNERS · LIT BARRIERS',
        corners: [[28, -26, 7], [28, 0, 7], [8, 0, 7], [8, 24, 7], [-28, 24, 7], [-28, -26, 7]], start: [0, -26],
        theme: 'city' },
];
let T = TRACKS[0], L = 1, N = 1, CHECKPOINTS = [], CUT_A = null, CUT_B = null, _S_CUT = [0, 0], PATH_W = 3.2;
let _bounds = { x0: -1, x1: 1, z0: -1, z1: 1 }, _CAM_X = 30, _CAM_Z = 40, _CAM_CX = 0, _CAM_CZ = 0;

/** The centreline of a track: straights and fillet arcs, as a closed list of points. */
function _outline(tr) {
    const C = tr.corners, n = C.length, pts = [];
    const arcs = C.map(([x, z, r], i) => {
        const [px, pz] = C[(i - 1 + n) % n], [nx, nz] = C[(i + 1) % n];
        let ax = x - px, az = z - pz, bx = nx - x, bz = nz - z;
        const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz); ax /= la; az /= la; bx /= lb; bz /= lb;
        const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);        // + = a left turn (x→z)
        const t = r * Math.tan(Math.abs(turn) / 2);
        const sx = x - ax * t, sz = z - az * t;
        const side = Math.sign(turn) || 1;
        const cx = sx - az * r * side, cz = sz + ax * r * side;              // centre, to the inside
        const a0 = Math.atan2(sz - cz, sx - cx);
        return { sx, sz, cx, cz, a0, turn, r };
    });
    arcs.forEach(a => {
        const steps = Math.max(2, Math.ceil(Math.abs(a.turn) * a.r / 0.5));
        for (let k = 0; k <= steps; k++) {
            const u = a.a0 + a.turn * (k / steps);
            pts.push({ x: a.cx + Math.cos(u) * a.r, z: a.cz + Math.sin(u) * a.r });
        }
        // (the straight to the next arc is the gap between this arc's end and its start)
    });
    return pts;
}
/** Resample a closed polyline every `step` units; s = 0 nearest `start`. */
function _table(pts, start, step = 0.5) {
    const segs = [], n = pts.length;
    let tot = 0;
    for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n], len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 1e-6) continue;
        segs.push({ a, b, len, s0: tot }); tot += len;
    }
    const at = s => {
        s = ((s % tot) + tot) % tot;
        let lo = 0, hi = segs.length - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].s0 <= s) lo = m; else hi = m - 1; }
        const g = segs[lo], u = (s - g.s0) / g.len;
        return { x: g.a.x + (g.b.x - g.a.x) * u, z: g.a.z + (g.b.z - g.a.z) * u, hx: (g.b.x - g.a.x) / g.len, hz: (g.b.z - g.a.z) / g.len };
    };
    const m = Math.round(tot / step);
    let raw = Array.from({ length: m }, (_, i) => at((i / m) * tot));
    // Rotate so s = 0 is the start line.
    let best = 0, bd = Infinity;
    raw.forEach((p, i) => { const d = (p.x - start[0]) ** 2 + (p.z - start[1]) ** 2; if (d < bd) { bd = d; best = i; } });
    raw = raw.slice(best).concat(raw.slice(0, best));
    return { line: raw, L: tot };
}
function _useTrack(tr) {
    T = tr;
    const { line, L: len } = _table(_outline(tr), tr.start);
    _line = line; L = len; N = line.length;
    CUT_A = tr.cut ? { x: tr.cut.a[0], z: tr.cut.a[1] } : null;
    CUT_B = tr.cut ? { x: tr.cut.b[0], z: tr.cut.b[1] } : null;
    PATH_W = tr.cut?.w ?? 3.2;
    _S_CUT = tr.cut ? [_nearest(CUT_A.x, CUT_A.z).s, _nearest(CUT_B.x, CUT_B.z).s] : [0, 0];
    // Checkpoints: three, spread round the lap, none on the stretch a shortcut
    // skips (or taking it would never count), one after it rejoins.
    const skipped = s => tr.cut && s > _S_CUT[0] - CP_WIN && s < _S_CUT[1] + CP_WIN;
    CHECKPOINTS = [0.1, 0.22, 0.34, 0.5, 0.66, 0.8, 0.9].map(f => f * L).filter(s => !skipped(s));
    if (tr.cut) {
        const after = CHECKPOINTS.filter(s => s > _S_CUT[1]);
        const before = CHECKPOINTS.filter(s => s < _S_CUT[0]);
        CHECKPOINTS = [...before.slice(-2), after[Math.floor(after.length / 2)] ?? (_S_CUT[1] + L) / 2].sort((a, b) => a - b);
    } else CHECKPOINTS = [0.25, 0.5, 0.75].map(f => f * L);
    const xs = _line.map(p => p.x), zs = _line.map(p => p.z);
    _bounds = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    _CAM_CX = (_bounds.x0 + _bounds.x1) / 2; _CAM_CZ = (_bounds.z0 + _bounds.z1) / 2;
    _CAM_X = (_bounds.x1 - _bounds.x0) / 2 + TRACK_W / 2 + 9; _CAM_Z = (_bounds.z1 - _bounds.z0) / 2 + TRACK_W / 2 + 9;
}
const _inRange = (s, r) => !!r && s >= r[0] * L && s <= r[1] * L;

// ── Karts ────────────────────────────────────────────────────────────────────
const VMAX = 13, ACCEL = 8, GRASS = 0.5;
const TURN = 2.3;                              // rad/s at full steer and speed
const R = 0.9;                                 // kart radius
const DRIFT_MIN_V = 8, DRIFT_1 = 0.7, DRIFT_2 = 1.5;
const BOOST_MUL = 1.45, TURBO_1 = 0.6, TURBO_2 = 1.1;
const SHROOM = 2.6, SHROOM_MUL = 1.85;         // the mushroom: longer, and a lot faster than a turbo
const ICE_GRIP = 2.2;                          // on ice, how fast the slide catches up with the nose (1/s)
const SPIN = 1.1;
const READY_TIME = 3.2;                        // the 3-2-1
const FIG_SCALE = 0.6;
const FOV = 62;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _dir = null, _hud = null, _in = null, _fx = null;
let _karts = [], _cams = [], _boxes = [], _bananas = [], _bot = [], _line = [], _trees = [], _lines = [];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _winner = -1, _count = 0, _endAt = 0;
let _forceTrack = null;

// ── Geometry of the circuit ─────────────────────────────────────────────────
function _at(s) {
    s = ((s % L) + L) % L;
    const f = s / L * N, i = Math.floor(f) % N, j = (i + 1) % N, u = f - Math.floor(f);
    const a = _line[i], b = _line[j];
    const hx = b.x - a.x, hz = b.z - a.z, hl = Math.hypot(hx, hz) || 1;
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, hx: hx / hl, hz: hz / hl };
}
const _segDist = (x, z, a, b) => {
    const vx = b.x - a.x, vz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz)));
    return Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
};
function _nearest(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < N; i++) { const p = _line[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    return { s: (best / N) * L, d: Math.sqrt(bd) };
}
function _surface(x, z) {
    return _drivable(x, z) ? 1 : GRASS;
}
const _onCut = (x, z, pad = 0) => !!CUT_A && _segDist(x, z, CUT_A, CUT_B) < PATH_W / 2 + pad;
/** On the track or the shortcut path. Everywhere else is behind a wall. */
function _drivable(x, z) {
    return _nearest(x, z).d < TRACK_W / 2 - R * 0.6 || _onCut(x, z, -R * 0.6);
}

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _winner = -1; _count = 0; _endAt = 0;
    _bananas = []; _boxes = []; _lines = [];
    _useTrack(_forceTrack ? TRACKS.find(t => t.key === _forceTrack) : TRACKS[Math.floor(Math.random() * TRACKS.length)]);
    _bot = [0, 1].map(() => ({ cut: false, wait: 0 }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#a9d4f2;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 40, background: 0xa9d4f2 });
    _hud = faceoffHud(_stage);
    _in = touch(_stage, { split: 'y', stick: 60, onTap: slot => _useItem(slot) });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _buildCircuit();
        _cams = [0, 1].map(slot => {
            const c = new THREE.PerspectiveCamera(FOV, 1, 0.1, 220);
            // The far half is upside down on the phone: roll its camera 180°.
            c.up.set(0, slot === 0 ? 1 : -1, 0);
            return c;
        });
    }
    _placeBoxes();
    _karts = [0, 1].map(_buildKart);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'DRAG ⬅➡ TO STEER · TAP FOR YOUR ITEM'));
    if (_stage.gl) _buildSpeedLines();

    const p0 = _at(0);
    _dir.open({
        place: T.place, title: 'GO-KART GRAND PRIX',
        sub: `${LAPS} LAPS · ${T.sub}`,
        from: { pos: [_CAM_CX + 26, 34, _CAM_CZ - 34], look: [_CAM_CX, 0, _CAM_CZ] },
        to: { pos: [p0.x + p0.hz * 7 - p0.hx * 9, 5, p0.z - p0.hx * 7 - p0.hz * 9], look: [p0.x + p0.hx * 2, 0.5, p0.z + p0.hz * 2] },
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.views = null; _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _karts = []; _cams = []; _boxes = []; _bananas = []; _trees = []; _lines = []; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── The circuit, built ───────────────────────────────────────────────────────
function _ribbon(pts, width, y, mat, closed) {
    const pos = [], idx = [];
    pts.forEach((p, i) => {
        const nx = p.hz, nz = -p.hx;                     // the tangent turned a quarter
        pos.push(p.x + nx * width / 2, y, p.z + nz * width / 2, p.x - nx * width / 2, y, p.z - nz * width / 2);
        if (i < pts.length - 1 || closed) {
            const a = i * 2, b = ((i + 1) % pts.length) * 2;
            idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
    });
    // Face up whichever way round the circuit runs: a circuit drawn the other
    // way round winds its triangles face-down, and they'd be culled from above.
    if (idx.length >= 3) {
        const [i0, i1, i2] = idx, P = k => [pos[k * 3], pos[k * 3 + 2]];
        const [a, b, c] = [P(i0), P(i1), P(i2)];
        const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);   // y of (b−a)×(c−a)
        if (ny < 0) for (let t = 0; t < idx.length; t += 3) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
    return m;
}
// Each circuit's look: sky, ground, road, the walls, and what stands around it.
const THEMES = {
    park:   { sky: 0xa9d4f2, fog: 0xbfe0f5, ground: 0x5fae4a, road: 0x3d434c, verge: 0xe8e2d4, kerb: [0xef4444, 0xffffff], wall: 'tyres', wallCols: [0x222428, 0xd83a3a],
              light: { sun: 0xfff3dd, sunI: 1.25, sky: 0xbfe0f5, ground: 0x3f6a38, hemiI: 0.85, rimI: 0.25 } },
    canyon: { sky: 0xe9b886, fog: 0xe3b489, ground: 0xb8773f, road: 0x4f4038, verge: 0xa86a3a, kerb: [0xea580c, 0xfff7ed], wall: 'tyres', wallCols: [0x2a211c, 0xea580c],
              light: { sun: 0xffe7c4, sunI: 1.05, sky: 0xe9c6a0, ground: 0x6b4226, hemiI: 0.6, rimI: 0.25 } },
    beach:  { sky: 0x8fd3f7, fog: 0xb9e6fb, ground: 0xf1dca6, road: 0x474d57, verge: 0xfff4d6, kerb: [0x0ea5e9, 0xffffff], wall: 'tyres', wallCols: [0x1f2937, 0x38bdf8],
              light: { sun: 0xfff6e0, sunI: 1.3, sky: 0xb9e6fb, ground: 0xc9b27a, hemiI: 0.9, rimI: 0.25 } },
    snow:   { sky: 0xcfe3f5, fog: 0xdbeaf7, ground: 0xf4f8ff, road: 0x59616b, verge: 0xe2ecf7, kerb: [0x2563eb, 0xffffff], wall: 'tyres', wallCols: [0x1f2937, 0x3b82f6],
              light: { sun: 0xf5f8ff, sunI: 1.15, sky: 0xdbeaf7, ground: 0xa9b8c9, hemiI: 1.0, rimI: 0.3 } },
    city:   { sky: 0x0b1026, fog: 0x12183a, ground: 0x1e2230, road: 0x2b2f38, verge: 0x3a4052, kerb: [0xff2bd6, 0x22d3ee], wall: 'neon', wallCols: [0xff2bd6, 0x22d3ee],
              light: { sun: 0x9fb4ff, sunI: 0.55, sky: 0x39407a, ground: 0x10131f, hemiI: 0.7, rimI: 0.45 } },
};

function _buildCircuit() {
    const th = THEMES[T.theme];
    const scene = _stage.scene;
    scene.background = new THREE.Color(th.sky);
    scene.fog = new THREE.Fog(th.fog, 60, 150);
    const span = Math.max(_bounds.x1 - _bounds.x0, _bounds.z1 - _bounds.z0) / 2 + 8;
    _stage.light({ ...th.light, dir: [12, 30, 8], span });
    const W = Math.max(_bounds.x1 - _bounds.x0, _bounds.z1 - _bounds.z0) + 120;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, W), new THREE.MeshStandardMaterial({ color: th.ground, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(_CAM_CX, 0, _CAM_CZ); ground.receiveShadow = true; _stage.add(ground);
    // Track, verge, kerbs.
    const nl = Math.round(L / 0.8);
    const loop = Array.from({ length: nl }, (_, i) => _at((i / nl) * L));
    _stage.add(_ribbon(loop, TRACK_W + 0.9, 0.015, new THREE.MeshStandardMaterial({ color: th.verge, roughness: 0.9 }), true));
    _stage.add(_ribbon(loop, TRACK_W, 0.03, new THREE.MeshStandardMaterial({ color: th.road, roughness: 0.85 }), true));
    const nk = Math.round(L / 1.45);
    const kerb = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.12, 1.2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), 2 * nk);
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < nk; i++) {
        const p = _at((i / nk) * L);
        q.setFromAxisAngle(Y, Math.atan2(p.hx, p.hz));
        [1, -1].forEach((side, k) => {
            mm.compose(new THREE.Vector3(p.x + p.hz * side * (TRACK_W / 2 + 0.2), 0.06, p.z - p.hx * side * (TRACK_W / 2 + 0.2)), q, new THREE.Vector3(1, 1, 1));
            kerb.setMatrixAt(i * 2 + k, mm);
            kerb.setColorAt(i * 2 + k, col.setHex(th.kerb[i % 2]));
        });
    }
    kerb.receiveShadow = true; _stage.add(kerb);
    // Special stretches, drawn over the road.
    if (T.pier) {
        const pier = Array.from({ length: 60 }, (_, i) => _at((T.pier[0] + (T.pier[1] - T.pier[0]) * i / 59) * L));
        const wood = new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.9 });
        _stage.add(_ribbon(pier, TRACK_W + 1.8, 0.045, wood, false));
        // Planks and piles.
        for (let i = 0; i < 60; i += 2) {
            const p = pier[i];
            const plank = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W + 1.8, 0.03, 0.12), new THREE.MeshStandardMaterial({ color: 0x6f4a2a, roughness: 1 }));
            plank.position.set(p.x, 0.065, p.z); plank.rotation.y = Math.atan2(p.hx, p.hz) + Math.PI / 2; _stage.add(plank);
            if (i % 6 === 0) [1, -1].forEach(side => {
                const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 1.4, 8), wood);
                pile.position.set(p.x + p.hz * side * (TRACK_W / 2 + 1.1), 0.7, p.z - p.hx * side * (TRACK_W / 2 + 1.1)); _stage.add(pile);
            });
        }
    }
    if (T.pads) {
        T.pads.forEach(f => {
            const p = _at(f * L);
            const pad = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W * 0.7, 1.6), new THREE.MeshStandardMaterial({ color: 0xff8a00, emissive: 0xff6a00, emissiveIntensity: 0.9, roughness: 0.4 }));
            pad.rotation.x = -Math.PI / 2; pad.rotation.z = -Math.atan2(p.hx, p.hz);
            pad.position.set(p.x, 0.05, p.z); _stage.add(pad);
            // Chevrons on it, pointing the way.
            [-0.35, 0.35].forEach(o => {
                const ch = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 3), new THREE.MeshBasicMaterial({ color: 0xfff1a8 }));
                ch.rotation.x = Math.PI / 2; ch.rotation.z = -Math.atan2(p.hx, p.hz);
                ch.scale.y = 0.2;
                ch.position.set(p.x + p.hx * o, 0.07, p.z + p.hz * o); _stage.add(ch);
            });
        });
    }
    if (T.ice) {
        const ice = Array.from({ length: 50 }, (_, i) => _at((T.ice[0] + (T.ice[1] - T.ice[0]) * i / 49) * L));
        _stage.add(_ribbon(ice, TRACK_W - 0.4, 0.04, new THREE.MeshStandardMaterial({ color: 0xbfe6ff, emissive: 0x3a7bb0, emissiveIntensity: 0.25, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.85 }), false));
    }
    // Walls down both edges and both sides of any shortcut. The inside of a
    // corner and a shortcut's mouths are left open.
    const spots = [];
    const edge = TRACK_W / 2 + 0.55;
    for (let i = 0, n = Math.round(L / 1.05); i < n; i++) {
        const s = (i / n) * L, p = _at(s);
        if (_inRange(s, T.tunnel)) continue;                                  // the tunnel has walls of its own
        [1, -1].forEach(side => {
            const x = p.x + p.hz * side * edge, z = p.z - p.hx * side * edge;
            if (_onCut(x, z, 0.6)) return;
            if (_nearest(x, z).d < edge - 0.3) return;
            spots.push([x, z, Math.atan2(p.hx, p.hz)]);
        });
    }
    if (CUT_A) {
        const len = Math.hypot(CUT_B.x - CUT_A.x, CUT_B.z - CUT_A.z), ux = (CUT_B.x - CUT_A.x) / len, uz = (CUT_B.z - CUT_A.z) / len;
        for (let d = 0; d <= len; d += 1.05) [-1, 1].forEach(k => {
            const x = CUT_A.x + ux * d + uz * k * (PATH_W / 2 + 0.55), z = CUT_A.z + uz * d - ux * k * (PATH_W / 2 + 0.55);
            if (_nearest(x, z).d < edge + 0.2) return;
            spots.push([x, z, Math.atan2(ux, uz)]);
        });
        const path = new THREE.Mesh(new THREE.PlaneGeometry(PATH_W, len + 1), new THREE.MeshStandardMaterial({ color: T.theme === 'canyon' ? 0xb07a4a : 0xcdbf9f, roughness: 0.9 }));
        path.rotation.x = -Math.PI / 2; path.rotation.z = -Math.atan2(ux, uz);
        path.position.set((CUT_A.x + CUT_B.x) / 2, 0.025, (CUT_A.z + CUT_B.z) / 2); path.receiveShadow = true; _stage.add(path);
    }
    if (th.wall === 'neon') {
        // Lit barriers: glowing blocks, alternating colours.
        const bar = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.7, 0.35), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.4 }), spots.length);
        spots.forEach(([x, z, a], i) => {
            q.setFromAxisAngle(Y, a + Math.PI / 2);
            mm.compose(new THREE.Vector3(x, 0.35, z), q, new THREE.Vector3(1, 1, 1));
            bar.setMatrixAt(i, mm); bar.setColorAt(i, col.setHex(th.wallCols[Math.floor(i / 4) % 2]));
        });
        _stage.add(bar);
    } else {
        const tyres = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.62, 12), new THREE.MeshStandardMaterial({ roughness: 0.85 }), spots.length);
        spots.forEach(([x, z], i) => {
            mm.compose(new THREE.Vector3(x, 0.31, z), q.identity(), new THREE.Vector3(1, 1, 1));
            tyres.setMatrixAt(i, mm);
            tyres.setColorAt(i, col.setHex(i % 6 < 3 ? th.wallCols[0] : th.wallCols[1]));
        });
        tyres.castShadow = true; _stage.add(tyres);
    }
    if (T.tunnel) {
        const stoneM = new THREE.MeshStandardMaterial({ color: 0x8b95a3, roughness: 0.9 });
        const lampM = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
        const n = Math.round((T.tunnel[1] - T.tunnel[0]) * L / 1.2);
        for (let i = 0; i <= n; i++) {
            const p = _at((T.tunnel[0] + (T.tunnel[1] - T.tunnel[0]) * i / n) * L), a = Math.atan2(p.hx, p.hz);
            [1, -1].forEach(side => {
                const w = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4.4, 1.3), stoneM);
                w.position.set(p.x + p.hz * side * (TRACK_W / 2 + 0.6), 2.2, p.z - p.hx * side * (TRACK_W / 2 + 0.6)); w.rotation.y = a; _stage.add(w);
            });
            const roof = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W + 2.8, 0.6, 1.3), stoneM);
            roof.position.set(p.x, 4.6, p.z); roof.rotation.y = a; _stage.add(roof);
            if (i % 3 === 0) { const l = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.3), lampM); l.position.set(p.x, 4.25, p.z); l.rotation.y = a; _stage.add(l); }
        }
        // Snow on the hill it runs through.
        const mid = _at((T.tunnel[0] + T.tunnel[1]) / 2 * L);
        const hill = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness: 1 }));
        hill.scale.set(1, 0.62, 1.4); hill.rotation.y = Math.atan2(mid.hx, mid.hz); hill.position.set(mid.x, 0, mid.z);
        _stage.add(hill);
        _trees.push({ x: mid.x, z: mid.z, r: 7, mats: [hill.material], o: 1 });
    }
    // The start line: a checker across the road, and a gantry over it.
    const p0 = _at(0), a0 = Math.atan2(p0.hx, p0.hz);
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 16;
    const cx = cv.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { cx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; cx.fillRect(i * 4, j * 4, 4, 4); }
    const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter;
    const gantry = new THREE.Group(); gantry.position.set(p0.x, 0, p0.z); gantry.rotation.y = a0; _stage.add(gantry);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 1.1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    line.rotation.x = -Math.PI / 2; line.position.y = 0.04; gantry.add(line);
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.5, roughness: 0.4 });
    [-1, 1].forEach(k => { const pp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.6, 0.3), steel); pp.position.set(k * (TRACK_W / 2 + 0.9), 2.3, 0); pp.castShadow = true; gantry.add(pp); });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W + 2.1, 0.7, 0.4), new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5, emissive: T.theme === 'city' ? 0xffd23f : 0x000000, emissiveIntensity: 0.4 }));
    beam.position.y = 4.6; beam.castShadow = true; gantry.add(beam);
    _decorate(th);
    // A low fence round it all, so the world visibly ends where the karts stop.
    const fenceM = new THREE.MeshStandardMaterial({ color: T.theme === 'city' ? 0x4b5563 : 0xf5f5f5, roughness: 0.7 });
    const fx = _CAM_X - 2.6, fz = _CAM_Z - 2.6;
    [[0, fz, 2 * fx, 0.2], [0, -fz, 2 * fx, 0.2], [fx, 0, 0.2, 2 * fz], [-fx, 0, 0.2, 2 * fz]].forEach(([x, z, w, d]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), fenceM); m.position.set(_CAM_CX + x, 0.3, _CAM_CZ + z); m.castShadow = true; _stage.add(m);
    });
}

// Scenery: some inside the circuit (well clear of the road, and faded when it
// comes between a chase camera and its kart), more outside the fence.
function _decorate(th) {
    const rnd = (() => { let a = 1234567; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
    // Each prop owns its materials so it can fade on its own (_fadeTrees).
    const prop = (x, z, r, build) => {
        const mats = [];
        const own = m => { const c = m.clone(); mats.push(c); return c; };
        build(own).forEach(o => { o.position.x += x; o.position.z += z; o.castShadow = true; _stage.add(o); });
        _trees.push({ x, z, r, mats, o: 1 });
    };
    const M = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, ...extra });
    const mesh = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };
    const kinds = {
        park: own => { const k = Math.floor(rnd() * 2); return [mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.2, 6), own(M(0x6b4a2e)), 0, 1.1, 0), mesh(new THREE.SphereGeometry(1.5 + k * 0.3, 9, 8), own(M(k ? 0x57a84a : 0x3f8f3a)), 0, 3.2, 0)]; },
        canyon: own => rnd() < 0.55
            ? [mesh(new THREE.CylinderGeometry(0.35, 0.4, 2.6, 8), own(M(0x3f8f4a)), 0, 1.3, 0), mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.0, 6), own(M(0x3f8f4a)), 0.55, 1.6, 0), mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.8, 6), own(M(0x3f8f4a)), -0.5, 1.9, 0)]
            : [mesh(new THREE.DodecahedronGeometry(1.2 + rnd() * 0.8, 0), own(M(0xb4693c)), 0, 0.8, 0)],
        beach: own => [mesh(new THREE.CylinderGeometry(0.16, 0.24, 4.2, 6), own(M(0x9c7a4c)), 0, 2.1, 0), mesh(new THREE.ConeGeometry(1.9, 0.9, 7), own(M(0x2f9e57)), 0, 4.3, 0)],
        snow: own => [mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.2, 6), own(M(0x5b3d26)), 0, 0.6, 0), mesh(new THREE.ConeGeometry(1.4, 3.2, 8), own(M(0x2f6b45)), 0, 2.6, 0), mesh(new THREE.ConeGeometry(0.8, 1.1, 8), own(M(0xffffff)), 0, 3.9, 0)],
        city: own => {
            const h = 5 + rnd() * 9, w = 3 + rnd() * 2.5;
            const win = own(M(0x1c2140, { emissive: [0xff2bd6, 0x22d3ee, 0xfacc15][Math.floor(rnd() * 3)], emissiveIntensity: 0.18 }));
            return [mesh(new THREE.BoxGeometry(w, h, w), win, 0, h / 2, 0),
                    mesh(new THREE.BoxGeometry(w * 0.7, 0.35, 0.1), own(M(0xffffff, { emissive: [0xff2bd6, 0x22d3ee][Math.floor(rnd() * 2)], emissiveIntensity: 1 })), 0, h * 0.7, w / 2 + 0.06)];
        },
    };
    const build = kinds[T.theme];
    // Inside and between the legs of the circuit: only where a prop is well
    // clear of the road and any path.
    const clear = T.theme === 'city' ? TRACK_W / 2 + 6 : TRACK_W / 2 + 3.2;
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 18; tries++) {
        const x = _bounds.x0 + rnd() * (_bounds.x1 - _bounds.x0), z = _bounds.z0 + rnd() * (_bounds.z1 - _bounds.z0);
        if (_nearest(x, z).d < clear || _onCut(x, z, 3)) continue;
        if (_trees.some(t => Math.hypot(t.x - x, t.z - z) < 5)) continue;
        prop(x, z, 1.6, build); placed++;
    }
    // Outside the fence, all the way round.
    const ox = _CAM_X + 3, oz = _CAM_Z + 3;
    for (let k = 0; k < 36; k++) {
        const u = k / 36 * Math.PI * 2;
        const x = _CAM_CX + Math.cos(u) * ox * (1 + rnd() * 0.15), z = _CAM_CZ + Math.sin(u) * oz * (1 + rnd() * 0.15);
        prop(Math.max(_CAM_CX - ox - 6, Math.min(_CAM_CX + ox + 6, x)), Math.max(_CAM_CZ - oz - 6, Math.min(_CAM_CZ + oz + 6, z)), 1.6, build);
    }
    // Theme set-pieces.
    if (T.theme === 'park') {
        const stone = M(0xcfd6dd, { roughness: 0.6 });
        const basin = mesh(new THREE.CylinderGeometry(3, 3.2, 0.7, 28), stone, 0, 0.35, 2); _stage.add(basin);
        const water = mesh(new THREE.CircleGeometry(2.7, 28), M(0x5fb7e8, { emissive: 0x1b5f86, emissiveIntensity: 0.4, roughness: 0.1 }), 0, 0.66, 2);
        water.rotation.x = -Math.PI / 2; _stage.add(water);
        _stage.add(mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.2, 12), stone, 0, 1.4, 2));
    } else if (T.theme === 'beach') {
        // The sea, off the south side, past the pier.
        const sea = mesh(new THREE.PlaneGeometry(400, 120), M(0x2b8fd6, { emissive: 0x0b4f86, emissiveIntensity: 0.35, roughness: 0.15 }), _CAM_CX, 0.02, _bounds.z0 - 64);
        sea.rotation.x = -Math.PI / 2; _stage.add(sea);
        const surf = mesh(new THREE.PlaneGeometry(400, 1.2), M(0xffffff, { roughness: 0.6 }), _CAM_CX, 0.03, _bounds.z0 - 4.6);
        surf.rotation.x = -Math.PI / 2; _stage.add(surf);
    } else if (T.theme === 'canyon' || T.theme === 'snow') {
        // Big mesas / peaks on the horizon.
        for (let k = 0; k < 9; k++) {
            const u = k / 9 * Math.PI * 2 + 0.3, d = Math.max(_CAM_X, _CAM_Z) + 30 + (k % 3) * 8;
            const g = T.theme === 'canyon' ? new THREE.CylinderGeometry(9, 12, 16 + (k % 4) * 5, 7) : new THREE.ConeGeometry(14, 26 + (k % 3) * 8, 7);
            const m = mesh(g, M(T.theme === 'canyon' ? 0xb4693c : 0xe8f0fa), _CAM_CX + Math.cos(u) * d, (T.theme === 'canyon' ? 8 + (k % 4) * 2.5 : 13 + (k % 3) * 4), _CAM_CZ + Math.sin(u) * d);
            _stage.add(m);
        }
        if (T.theme === 'canyon' && CUT_A) {
            // The gorge: red rock rising either side of the path.
            const len = Math.hypot(CUT_B.x - CUT_A.x, CUT_B.z - CUT_A.z), ux = (CUT_B.x - CUT_A.x) / len, uz = (CUT_B.z - CUT_A.z) / len;
            const rock = M(0xa4532e);
            [-1, 1].forEach(k => {
                const x = (CUT_A.x + CUT_B.x) / 2 + uz * k * (PATH_W / 2 + 1.6), z = (CUT_A.z + CUT_B.z) / 2 - ux * k * (PATH_W / 2 + 1.6);
                const w = mesh(new THREE.BoxGeometry(2.2, 3.6, Math.max(1, len - TRACK_W - 1.2)), rock, x, 1.8, z);
                w.rotation.y = Math.atan2(ux, uz); _stage.add(w);
            });
        }
    } else if (T.theme === 'city') {
        // Street lamps along the road.
        const pole = M(0x2a2f3a), lamp = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
        for (let i = 0, n = Math.round(L / 14); i < n; i++) {
            const p = _at((i / n) * L), side = i % 2 ? 1 : -1, d = TRACK_W / 2 + 1.5;
            const x = p.x + p.hz * side * d, z = p.z - p.hx * side * d;
            if (_nearest(x, z).d < TRACK_W / 2 + 1) continue;
            _stage.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6), pole, x, 2.1, z));
            _stage.add(mesh(new THREE.SphereGeometry(0.28, 8, 6), lamp, x, 4.3, z));
        }
    }
}

// ── Item boxes ───────────────────────────────────────────────────────────────
function _placeBoxes() {
    // Three rows across the track; with a shortcut, the last one after it
    // rejoins, so the short way still passes one.
    const rows = CUT_A ? [0.08 * L, (_S_CUT[0] * 0.55), (_S_CUT[1] + L) / 2] : [0.1, 0.45, 0.76].map(f => f * L);
    rows.forEach((s, row) => {
        const p = _at(s);
        for (let k = -1.5; k <= 1.5; k++) {
            const x = p.x + p.hz * k * 1.6, z = p.z - p.hx * k * 1.6;
            const b = { x, z, t: 0, mesh: null, row };
            if (_stage?.gl) {
                const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9),
                    new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xb07a00, emissiveIntensity: 0.5, transparent: true, opacity: 0.85, roughness: 0.3 }));
                m.position.set(x, 1, z); m.castShadow = true; _stage.add(m);
                b.mesh = m;
            }
            _boxes.push(b);
        }
    });
}

// ── Karts ────────────────────────────────────────────────────────────────────
function _buildKart(slot) {
    const p = _at(-2.5 - slot * 0.4);
    const off = slot === 0 ? 1.6 : -1.6;               // side by side on the grid
    const h0 = Math.atan2(p.hx, p.hz);
    const k = { slot, x: p.x + p.hz * off, z: p.z - p.hx * off, h: h0, vh: h0, v: 0, steer: 0, drift: 0, driftDir: 0, boost: 0, boostMul: BOOST_MUL, shroom: 0, spin: 0,
                item: null, lap: 0, s: 0, cp: 0, rev: 0, bx: 0, bz: 0, done: false, finishT: 0, bananaImmune: 0, padT: 0, msgT: 0 };
    k.s = _nearest(k.x, k.z).s;
    if (!_stage.gl) return k;
    const colr = seat(slot).color;
    const g = new THREE.Group();
    const bodyM = new THREE.MeshStandardMaterial({ color: colr, roughness: 0.35, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1f2328, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 2.1), bodyM); body.position.y = 0.42; g.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.6), bodyM); nose.position.set(0, 0.38, 1.25); g.add(nose);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.35), dark); wing.position.set(0, 0.95, -1.05); g.add(wing);
    [[-0.72, 0.7], [0.72, 0.7], [-0.72, -0.75], [0.72, -0.75]].forEach(([x, z]) => {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.32, 12), dark);
        w.rotation.z = Math.PI / 2; w.position.set(x, 0.34, z); g.add(w);
    });
    // Drift sparks behind the back wheels.
    const sparks = [-0.72, 0.72].map(x => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: 0 }));
        m.position.set(x, 0.2, -1.05); g.add(m); return m;
    });
    // Exhaust flames: a turbo shows a flicker, the mushroom a roaring jet.
    const flames = [-0.35, 0.35].map(x => {
        const f = new THREE.Group();
        const outer = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.2, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a00, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
        const inner = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.8, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.95, depthWrite: false }));
        outer.rotation.x = inner.rotation.x = -Math.PI / 2;           // pointing out the back (−z)
        outer.position.z = -0.6; inner.position.z = -0.4;
        f.add(outer, inner); f.position.set(x, 0.45, -1.2); f.visible = false; g.add(f);
        return f;
    });
    g.traverse(o => { if (o.isMesh && !sparks.includes(o) && !o.material.transparent) o.castShadow = true; });
    _stage.add(g);
    const ch = _stage.character(slot);
    ch.rig.root.scale.setScalar(FIG_SCALE);
    ch.rig.root.position.set(0, 0.55, -0.2);
    g.add(ch.rig.root);
    ch.anim.play('ready');
    Object.assign(k, { g, sparks, flames, rig: ch.rig, anim: ch.anim });
    return k;
}

function _useItem(slot) {
    const k = _karts[slot];
    if (!k || !k.item || _phase !== 'race' || k.done) return;
    if (k.item === 'shroom') {
        // The mushroom: a long surge well past top speed, and it shows.
        k.boost = Math.max(k.boost, SHROOM); k.shroom = SHROOM; k.boostMul = SHROOM_MUL;
        k.v = Math.max(k.v, VMAX * 1.25);
        sfx('boost'); if (!isBotSlot(slot)) haptic([40, 30, 60]);
        k.msgT = 1.2; if (!isBotSlot(slot)) _hud.hint(slot, '🍄 MUSHROOM BOOST!');
        if (_stage?.gl) _fx.burst(new THREE.Vector3(k.x - Math.sin(k.h) * 1.4, 0.6, k.z - Math.cos(k.h) * 1.4), 0xff7a00, 0.5, 0.3);
    }
    else {
        const b = { x: k.x - Math.sin(k.h) * 1.9, z: k.z - Math.cos(k.h) * 1.9, by: slot, mesh: null };
        if (_stage?.gl) {
            const m = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.14, 8, 14, Math.PI * 1.3), new THREE.MeshStandardMaterial({ color: 0xffe04a, roughness: 0.5 }));
            m.rotation.x = -Math.PI / 2; m.position.set(b.x, 0.2, b.z); _stage.add(m); b.mesh = m;
        }
        _bananas.push(b);
        k.bananaImmune = 0.8;
        sfx('land_bad');
    }
    k.item = null;
}

// ── Bot (§5): follow the racing line, take the shortcut when it can, use items ─
function _botSteer(k, dt) {
    const b = _bot[k.slot];
    const look = 7 + k.v * 0.35;
    let target = _at(k.s + look);
    // Coming up to a shortcut: a good bot takes it. The path is walled on
    // both sides, so it is driven like a road: to its mouth, then along it.
    if (CUT_A) {
        let toCut = _S_CUT[0] - k.s; if (toCut < -L / 2) toCut += L;
        if (toCut > -1 && toCut < 8 && !b.decided) { b.decided = true; b.cut = Math.random() < 0.15 + _botSkill * 0.8; }
        if (toCut > 14 || toCut < -40) b.decided = false;
        if (b.cut && !b.cutting && toCut < 9 && toCut > -2) { b.cutting = true; b.leg = 0; }
        if (b.cutting) {
            const ul = Math.hypot(CUT_B.x - CUT_A.x, CUT_B.z - CUT_A.z), ux = (CUT_B.x - CUT_A.x) / ul, uz = (CUT_B.z - CUT_A.z) / ul;
            // Aim a little way INTO the path, not at its mouth, so the turn in
            // is taken early and the kart arrives lined up with it.
            const mouth = { x: CUT_A.x + ux * 1.8, z: CUT_A.z + uz * 1.8 };
            const along = (k.x - CUT_A.x) * ux + (k.z - CUT_A.z) * uz;
            if (b.leg === 0 && (Math.hypot(k.x - mouth.x, k.z - mouth.z) < 2.2 || (_onCut(k.x, k.z) && along > 1.5))) b.leg = 1;
            if (b.leg === 1 && along > ul - 1.5) b.leg = 2;
            target = b.leg === 0 ? mouth : b.leg === 1 ? { x: CUT_A.x + ux * Math.min(ul + 2, along + 8), z: CUT_A.z + uz * Math.min(ul + 2, along + 8) } : _at(_S_CUT[1] + look);
            // Done, or it went wrong (a wall): back to the road.
            if (b.leg === 2 || toCut < -(_S_CUT[1] - _S_CUT[0]) - 4 || k.rev > 0) { b.cutting = false; b.cut = false; }
        }
    }
    const want = Math.atan2(target.x - k.x, target.z - k.z);
    let d = want - k.h; d = Math.atan2(Math.sin(d), Math.cos(d));
    k.aimErr = Math.abs(d);
    // Items: boost on a straight; a banana when the rival is close behind.
    b.wait -= dt;
    if (k.item && b.wait <= 0) {
        const r = _karts[1 - k.slot];
        const behind = _progress(r) < _progress(k) && _progress(k) - _progress(r) < 14;
        if ((k.item === 'shroom' && Math.abs(d) < 0.15) || (k.item === 'banana' && behind)) _useItem(k.slot);
        b.wait = 0.8 - _botSkill * 0.5;
    }
    const noise = (1 - _botSkill) * Math.sin(_t * 1.7 + k.slot) * 0.25;
    return Math.max(-1, Math.min(1, -d * 2.2 + noise));   // right steer turns the heading down
}

const _progress = k => k.lap * L + k.s;

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') {
        if (_stage?.gl) _stage.views = [0, 1].map(slot => ({ camera: _cams[slot], rect: slot === 0 ? [0, 0, 1, 0.5] : [0, 0.5, 1, 0.5] }));
        _count = 3;
        _hud.say('3', '', 900, _t, '#ff4f4f'); sfx('countdown');
    } else if (phase === 'race') { _hud.say('GO!', '', 700, _t, '#4ade80'); sfx('go'); haptic([40]); }
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready') {
        const n = 3 - Math.floor(_phaseT / (READY_TIME / 3));
        if (n !== _count && n > 0) { _count = n; _hud.say(String(n), '', 900, _t, n === 1 ? '#4ade80' : n === 2 ? '#facc15' : '#ff4f4f'); sfx('countdown'); }
        if (_phaseT >= READY_TIME) _enter('race');
    }
    if (_phase === 'race') {
        _clock += dt;
        _karts.forEach(k => _drive(k, dt));
        // Kart on kart.
        const [a, b] = _karts, dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d < R * 2 && d > 1e-4) {
            // Karts bounce off each other: a shove apart that scales with how
            // hard they met, and hardly any lost speed.
            const nx = dx / d, nz = dz / d, over = R * 2 - d;
            if (_drivable(a.x - nx * over / 2, a.z - nz * over / 2)) { a.x -= nx * over / 2; a.z -= nz * over / 2; }
            if (_drivable(b.x + nx * over / 2, b.z + nz * over / 2)) { b.x += nx * over / 2; b.z += nz * over / 2; }
            const va = { x: Math.sin(a.h) * a.v, z: Math.cos(a.h) * a.v }, vb = { x: Math.sin(b.h) * b.v, z: Math.cos(b.h) * b.v };
            const closing = Math.max(0, (va.x - vb.x) * nx + (va.z - vb.z) * nz);
            const j = BUMP + closing * 0.6;
            if (a.bx * nx + a.bz * nz > -j * 0.5) { a.bx -= nx * j; a.bz -= nz * j; b.bx += nx * j; b.bz += nz * j; sfx('slam'); }
            a.v *= 0.98; b.v *= 0.98;
        }
        if (_endAt && _clock >= _endAt) _end();
        else if (_clock >= MAX_TIME && _winner < 0) { _winner = _progress(a) >= _progress(b) ? 0 : 1; _end(); }
    }

    _karts.forEach(k => {
        if (!k.g) return;
        k.g.position.set(k.x, k.spin > 0 ? Math.abs(Math.sin(k.spin * 9)) * 0.15 : 0, k.z);
        k.g.rotation.y = k.h + (k.spin > 0 ? k.spin * 12 : 0) + k.driftDir * Math.min(1, k.drift * 2) * -0.35;
        const lvl = k.drift >= DRIFT_2 ? 2 : k.drift >= DRIFT_1 ? 1 : k.drift > 0.05 ? 0.5 : 0;
        k.sparks.forEach(s => {
            s.material.opacity = lvl ? 0.9 : k.boost > 0 ? 0.8 : 0;
            s.material.color.setHex(k.boost > 0 ? 0xff7a00 : lvl >= 2 ? 0xffa53d : 0x4fd1ff);
            s.scale.setScalar(0.7 + Math.random() * (lvl ? 0.9 : 0.5));
        });
        k.anim.play(k.spin > 0 ? 'hit' : k.done ? 'victory' : 'ready');
        const big = k.shroom > 0, on = k.boost > 0;
        k.flames.forEach(f => {
            f.visible = on;
            if (!on) return;
            const len = (big ? 1.7 : 0.9) * (0.8 + Math.random() * 0.4), wid = big ? 1.25 : 0.9;
            f.scale.set(wid, wid, len);
            f.children[0].material.color.setHex(big ? (Math.random() < 0.5 ? 0xff5a00 : 0xff9a1a) : 0xff7a00);
        });
        const cam = _cams[k.slot];
        if (cam) {
            // Chase camera: behind and above, eased, looking up the road.
            const fx = Math.sin(k.h), fz = Math.cos(k.h);
            // Under the mushroom the camera drops back and widens: you feel the surge.
            const back = big ? 7.4 : 6.2;
            const want = new THREE.Vector3(k.x - fx * back, big ? 2.7 : 3.1, k.z - fz * back);
            if (!cam.userData.init) { cam.position.copy(want); cam.userData.init = true; }
            cam.position.lerp(want, Math.min(1, dt * 6));
            cam.position.x = Math.max(_CAM_CX - _CAM_X, Math.min(_CAM_CX + _CAM_X, cam.position.x));
            cam.position.z = Math.max(_CAM_CZ - _CAM_Z, Math.min(_CAM_CZ + _CAM_Z, cam.position.z));
            if (_inRange(k.s, T.tunnel)) cam.position.y = Math.min(cam.position.y, 3.4);
            cam.lookAt(k.x + fx * 4, 0.9, k.z + fz * 4);
            const fov = FOV + (big ? 18 : on ? 6 : 0);
            if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * (fov > cam.fov ? 8 : 3)); cam.updateProjectionMatrix(); }
        }
        const ln = _lines[k.slot];
        if (ln) {
            const want = big ? Math.min(1, k.shroom / 0.4) : 0;
            ln.o += (want - ln.o) * Math.min(1, dt * 10);
            ln.el.style.opacity = ln.o.toFixed(3);
            if (ln.o > 0.01) ln.el.style.transform = `rotate(${(Math.random() * 6).toFixed(1)}deg) scale(${(1 + Math.random() * 0.06).toFixed(3)})`;
        }
    });
    _boxes.forEach(b => {
        if (!b.mesh) return;
        b.t = Math.max(0, b.t - dt);
        b.mesh.visible = b.t <= 0;
        b.mesh.rotation.y += dt * 1.6; b.mesh.rotation.x += dt * 0.9;
        b.mesh.position.y = 1 + Math.sin(_t * 2 + b.x) * 0.15;
    });
    _fadeTrees(dt);
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    _renderHud();
}

// Speed lines for the mushroom: streaks radiating in from the edges of each
// player's half (a radial pattern, so it reads the same from either end).
function _buildSpeedLines() {
    _lines = [0, 1].map(slot => {
        const el = document.createElement('div');
        el.style.cssText = `position:absolute;left:-10%;right:-10%;${slot === 0 ? 'top:50%;' : 'top:0;'}height:50%;pointer-events:none;opacity:0;` +
            'background:repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,255,255,0) 0deg 5deg, rgba(255,255,255,.75) 5deg 5.8deg, rgba(255,255,255,0) 5.8deg 11deg);' +
            '-webkit-mask-image:radial-gradient(ellipse at 50% 50%, transparent 38%, #000 78%);mask-image:radial-gradient(ellipse at 50% 50%, transparent 38%, #000 78%);';
        _stage.hud.appendChild(el);
        return { el, o: 0 };
    });
}

// A tree between a chase camera and its kart fades to a ghost, the way the
// board's buildings do for the follow camera. Both views share the scene, so
// the far player may see one fade too; that is the better trade than a
// screen full of leaves.
function _fadeTrees(dt) {
    if (!_trees.length || !_cams.length) return;
    _trees.forEach(tr => {
        let want = 1;
        _karts.forEach(k => {
            const c = _cams[k.slot];
            if (!c || want < 1) return;
            const a = { x: c.position.x, z: c.position.z }, b = { x: k.x, z: k.z };
            if (_segDist(tr.x, tr.z, a, b) < (tr.r ?? 1.6) + 0.7) want = 0.18;
        });
        tr.o += (want - tr.o) * Math.min(1, dt * 8);
        const solid = tr.o > 0.98;
        tr.mats.forEach(m => {
            if (m.transparent === solid) { m.transparent = !solid; m.needsUpdate = true; }
            m.opacity = tr.o; m.depthWrite = solid;
        });
    });
}

function _drive(k, dt) {
    k.bananaImmune = Math.max(0, k.bananaImmune - dt);
    if (k.done) { k.v *= Math.pow(0.4, dt); k.vh = k.h; _move(k, dt); return; }
    if (k.rev > 0) {
        // Backing off a wall: roll back, swinging the nose round to face up
        // the track, then drive on.
        k.rev = Math.max(0, k.rev - dt);
        k.v = k.rev > 0 ? -REVERSE_V : 0;
        const p = _at(k.s);
        let d = Math.atan2(p.hx, p.hz) - k.h; d = Math.atan2(Math.sin(d), Math.cos(d));
        k.h += Math.max(-2.4 * dt, Math.min(2.4 * dt, d));
        k.drift = 0; k.driftDir = 0; k.steer = 0; k.vh = k.h;
        _move(k, dt);
        _laps(k);
        return;
    }
    let steer = 0;
    if (k.spin > 0) k.spin = Math.max(0, k.spin - dt);
    else if (isBotSlot(k.slot)) steer = _botSteer(k, dt);
    else { const s = _in.seat(k.slot); steer = (k.slot === 0 ? 1 : -1) * s.dx; }
    k.steer = steer;
    const surf = _surface(k.x, k.z);
    // A bot brakes for a sharp turn — the walls leave no grass to run wide on.
    const brake = isBotSlot(k.slot) ? 1 - 0.55 * Math.min(1, (k.aimErr || 0) / 1.1) : 1;
    const vmax = VMAX * surf * brake * (k.boost > 0 ? k.boostMul : 1) * (isBotSlot(k.slot) ? 0.86 + 0.12 * _botSkill : 1);
    k.boost = Math.max(0, k.boost - dt);
    k.shroom = Math.max(0, k.shroom - dt);
    if (k.shroom <= 0) k.boostMul = BOOST_MUL;
    k.msgT = Math.max(0, k.msgT - dt);
    if (k.spin > 0) k.v *= Math.pow(0.15, dt);
    else k.v += Math.max(-ACCEL * 2, Math.min(ACCEL, (vmax - k.v) * 2)) * dt;
    // Drift: a hard steer at speed charges it; straightening up fires it.
    const hard = Math.abs(steer) > 0.75 && k.v > DRIFT_MIN_V;
    if (hard) {
        if (!k.drift) k.driftDir = Math.sign(steer);
        k.drift += dt;
    } else if (k.drift && Math.abs(steer) < 0.35) {
        if (k.drift >= DRIFT_1) { k.boost = Math.max(k.boost, k.drift >= DRIFT_2 ? TURBO_2 : TURBO_1); sfx('boost'); if (!isBotSlot(k.slot)) haptic([15]); }
        k.drift = 0; k.driftDir = 0;
    } else if (!hard && Math.abs(steer) < 0.75) { k.drift = Math.max(0, k.drift - dt * 0.5); if (!k.drift) k.driftDir = 0; }
    const onIce = _inRange(k.s, T.ice) && surf === 1;
    const grip = (k.drift ? 1.15 : 1) * (onIce ? 0.8 : 1);
    k.h -= steer * TURN * grip * Math.min(1, k.v / 6) * dt;
    // The way the kart actually travels: on ice it lags the nose, so the kart
    // slides wide through a turn; everywhere else it goes where it points.
    if (onIce) { let d = k.h - k.vh; d = Math.atan2(Math.sin(d), Math.cos(d)); k.vh += d * Math.min(1, ICE_GRIP * dt); }
    else k.vh = k.h;
    // Boost pads.
    k.padT = Math.max(0, k.padT - dt);
    if (T.pads && k.padT <= 0 && T.pads.some(f => Math.abs(k.s - f * L) < 1.1) && _nearest(k.x, k.z).d < TRACK_W / 2) {
        k.boost = Math.max(k.boost, TURBO_2); k.padT = 0.6; sfx('boost'); if (!isBotSlot(k.slot)) haptic([12]);
    }
    _move(k, dt);
    // Item boxes.
    _boxes.forEach(b => {
        if (b.t > 0 || Math.hypot(b.x - k.x, b.z - k.z) > 1.2) return;
        b.t = 3;
        if (!k.item) { k.item = Math.random() < 0.6 ? 'shroom' : 'banana'; sfx('shop_open'); }
        if (_stage?.gl) _fx.burst(new THREE.Vector3(b.x, 1, b.z), 0xffd23f, 0.4, 0.2);
    });
    // Bananas.
    for (let i = _bananas.length - 1; i >= 0; i--) {
        const b = _bananas[i];
        if (b.by === k.slot && k.bananaImmune > 0) continue;
        if (Math.hypot(b.x - k.x, b.z - k.z) > 1.0) continue;
        if (b.mesh) { _stage.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
        _bananas.splice(i, 1);
        k.spin = SPIN; k.drift = 0; k.boost = 0;
        sfx('slam'); haptic([50]);
        if (k.anim) k.anim.flinch?.();
    }
    _laps(k);
}

// Laps: every checkpoint in order, then the line.
function _laps(k) {
    const prev = k.s;
    k.s = _nearest(k.x, k.z).s;
    if (k.cp < CHECKPOINTS.length && Math.abs(k.s - CHECKPOINTS[k.cp]) < CP_WIN) k.cp++;
    if (prev > L * 0.8 && k.s < L * 0.2 && k.cp >= CHECKPOINTS.length) {
        k.lap++; k.cp = 0;
        if (k.lap >= LAPS) {
            k.done = true; k.finishT = _clock;
            if (_winner < 0) { _winner = k.slot; _endAt = _clock + 1.6; sfx('mg_win'); _hud.say('FINISH!', seat(k.slot).name, 1500, _t, seat(k.slot).css); }
        } else {
            sfx('land_good');
            if (k.lap === LAPS - 1 && !isBotSlot(k.slot)) _hud.say('FINAL LAP!', seat(k.slot).name, 900, _t, '#facc15');
        }
    }
}

function _move(k, dt) {
    const hh = k.vh ?? k.h;
    const dx = (Math.sin(hh) * k.v + k.bx) * dt, dz = (Math.cos(hh) * k.v + k.bz) * dt;
    // A shove from another kart dies away in a fraction of a second.
    const decay = Math.pow(0.004, dt); k.bx *= decay; k.bz *= decay;
    if (_drivable(k.x + dx, k.z + dz)) { k.x += dx; k.z += dz; return; }
    // A tyre wall. A glancing hit slides along it; a head-on one stops you,
    // and you back off it (see _drive) rather than sit pinned to it.
    // Only a real share of the move counts as sliding: a head-on hit has
    // almost none along the wall, and treating it as a slide left the kart
    // pinned there, never backing off.
    const len = Math.hypot(dx, dz) || 1;
    if (Math.abs(dx) > len * 0.35 && _drivable(k.x + dx, k.z)) { k.x += dx; k.v *= Math.pow(0.3, dt); return; }
    if (Math.abs(dz) > len * 0.35 && _drivable(k.x, k.z + dz)) { k.z += dz; k.v *= Math.pow(0.3, dt); return; }
    k.bx = k.bz = 0;
    if (k.rev <= 0 && !k.done) {
        k.rev = REVERSE; k.drift = 0; k.boost = 0; k.shroom = 0; k.boostMul = BOOST_MUL;
        if (_bot[k.slot]) { _bot[k.slot].cutting = false; _bot[k.slot].cut = false; }   // a bot that fluffs the shortcut goes the long way
        sfx('slam'); if (!isBotSlot(k.slot)) haptic([40]);
    }
}

function _renderHud() {
    if (!_hud) return;
    const rank = _progress(_karts[0]) >= _progress(_karts[1]) ? [1, 2] : [2, 1];
    [0, 1].forEach(slot => {
        const k = _karts[slot];
        if (!k) return;
        const lap = Math.min(LAPS, k.lap + 1);
        const item = k.item === 'shroom' ? ' · 🍄 TAP!' : k.item === 'banana' ? ' · 🍌 TAP!' : '';
        _hud.line(slot, k.done ? `FINISHED ${rank[slot] === 1 ? '1ST' : '2ND'}` : `LAP ${lap}/${LAPS} · ${rank[slot] === 1 ? '1ST' : '2ND'}${item}`);
        if (_clock > 8 && k.msgT <= 0) _hud.hint(slot, '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'race') el.textContent = `LAP ${Math.min(LAPS, Math.max(_karts[0].lap, _karts[1].lap) + 1)}/${LAPS}`;
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    const w = _winner;
    if (_stage) _stage.views = null;               // the director's shots are full-frame
    _dir.close({
        winner: w, figs: _karts.filter(k => k.rig).map(k => ({ slot: k.slot, rig: k.rig, anim: k.anim })),
        sub: w < 0 ? 'A DEAD HEAT' : 'TAKES THE CHEQUERED FLAG',
        closeUp: (f, p) => ({ pos: [p.x + 4.5, p.y + 4.2, p.z + (f.slot === 0 ? 1 : -1) * 6.5], look: [p.x, p.y + 0.6, p.z] }),
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, clock: +_clock.toFixed(2), winner: _winner, L: +L.toFixed(1), track: T.key, cps: CHECKPOINTS.map(c => +c.toFixed(1)),
             cut: CUT_A ? { a: CUT_A, b: CUT_B, s: _S_CUT.map(v => +v.toFixed(1)) } : null,
             fov: _cams.map(c => +c.fov.toFixed(1)), lines: _lines.map(l => +l.o.toFixed(2)),
             karts: _karts.map(k => ({ x: +k.x.toFixed(2), z: +k.z.toFixed(2), h: +k.h.toFixed(2), v: +k.v.toFixed(2), s: +k.s.toFixed(1),
                                        lap: k.lap, cp: k.cp, rev: +k.rev.toFixed(2), item: k.item, drift: +k.drift.toFixed(2), boost: +k.boost.toFixed(2), spin: +k.spin.toFixed(2),
                                        shroom: +k.shroom.toFixed(2), vmul: +(k.boost > 0 ? k.boostMul : 1).toFixed(2), vh: +(k.vh ?? k.h).toFixed(2), flames: !!k.flames?.[0]?.visible,
                                        surf: _surface(k.x, k.z), done: k.done })),
             views: _stage?.views ? _stage.views.length : 0, gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: put a kart somewhere, facing h, at speed v. */
export function _debugPlace(slot, x, z, h = 0, v = 0) { const k = _karts[slot]; if (k) Object.assign(k, { x, z, h, vh: h, v, spin: 0, rev: 0 }); }
/** Probes: place a kart at arc distance s along the centreline (lateral offset `off`), facing up the track. */
export function _debugPlaceS(slot, s, off = 0, v = 0) {
    const p = _at(s), h = Math.atan2(p.hx, p.hz);
    _debugPlace(slot, p.x + p.hz * off, p.z - p.hx * off, h, v);
    if (_karts[slot]) _karts[slot].s = ((s % L) + L) % L;
}
/** Probes: the circuit the NEXT start() races (a key), or null for random. */
export function _debugForceTrack(key) { _forceTrack = key; }
export function _debugTracks() { return TRACKS.map(t => t.key); }
/** Probes: the circuit's shape: the closest two stretches of road come (that aren't the same bit), and the tightest corner. */
export function _debugGeometry() {
    let close = Infinity, where = null;
    const step = Math.max(1, Math.round(N / 300));
    for (let i = 0; i < N; i += step) for (let j = i + step; j < N; j += step) {
        const ds = Math.min(j - i, N - (j - i)) / N * L;
        if (ds < TRACK_W * 3) continue;
        const d = Math.hypot(_line[i].x - _line[j].x, _line[i].z - _line[j].z);
        if (d < close) { close = d; where = [i / N * L, j / N * L].map(v => +v.toFixed(1)); }
    }
    let tight = Infinity;
    for (let i = 0; i < N; i++) {
        const a = _line[(i - 4 + N) % N], b = _line[i], c = _line[(i + 4) % N];
        const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
        const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
        if (cross > 1e-6) tight = Math.min(tight, ab * bc * ca / (2 * cross));
    }
    return { L: +L.toFixed(1), close: +close.toFixed(2), where, tightest: +tight.toFixed(2) };
}
/** Probes: drive a bot kart round for `secs` of game time, off the clock, as fast as the page can. */
export function _debugSimDrive(slot, secs, dt = 1 / 60) {
    const k = _karts[slot];
    if (!k) return null;
    const was = _phase; _phase = 'race';
    let revs = 0, lastRev = 0, lapAt = null, cut = false;
    const lap0 = k.lap;
    for (let t = 0; t < secs; t += dt) {
        _clock += dt;
        _drive(k, dt);
        if (k.rev > 0 && lastRev <= 0) revs++;
        lastRev = k.rev;
        if (CUT_A && _onCut(k.x, k.z) && _nearest(k.x, k.z).d > TRACK_W / 2 + 1) cut = true;
        if (lapAt == null && k.lap > lap0) lapAt = +t.toFixed(1);
    }
    _phase = was;
    return { laps: k.lap - lap0, lapAt, wallHits: revs, cut, x: +k.x.toFixed(1), z: +k.z.toFixed(1), s: +k.s.toFixed(1) };
}
/** Probes: give a kart an item, or set its lap count. */
export function _debugItem(slot, item) { if (_karts[slot]) _karts[slot].item = item; }
export function _debugLap(slot, lap, half = true) { if (_karts[slot]) Object.assign(_karts[slot], { lap, cp: half ? CHECKPOINTS.length : 0 }); }
