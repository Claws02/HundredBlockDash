// ============================================================
// GO-KART GRAND PRIX — three laps of the park circuit on City Ring Road.
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
// The shortcut: a narrow paved path cuts straight across the south hairpin.
// Tyre walls line the track and the path: hit one head-on and you back off it.
// Laps count through checkpoints in order. First to finish three laps wins.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects } from '../engine/StageKit.js';

// ── The circuit: a stadium. Straights along z at x = ±SX, hairpins of radius
// TR round (0, ±SZ). s = 0 is the start line, halfway up the east straight. ──
const SX = 14, SZ = 22, TR = 14;
const TRACK_W = 8, PATH_W = 3.2;
const L = 4 * SZ + 2 * Math.PI * TR;          // lap length
const N = 360;                                 // centreline samples
const LAPS = 3;
const MAX_TIME = 130;                          // s: a safety bell, then by position
// Laps count through these, in order, and then the line — so no loop that
// skips part of the circuit can be a lap. The third sits on the east
// straight AFTER the shortcut rejoins, so the shortcut still counts.
const CHECKPOINTS = [SZ + Math.PI * TR * 0.5, 2 * SZ + Math.PI * TR, 3 * SZ + 2 * Math.PI * TR + SZ * 0.4];
const CP_WIN = 5;
const REVERSE = 0.7, REVERSE_V = 3.5;          // backing off a wall
const BUMP = 5.5;                              // shove between karts

// ── Karts ────────────────────────────────────────────────────────────────────
const VMAX = 13, ACCEL = 8, GRASS = 0.5;
const TURN = 2.3;                              // rad/s at full steer and speed
const R = 0.9;                                 // kart radius
const DRIFT_MIN_V = 8, DRIFT_1 = 0.7, DRIFT_2 = 1.5;
const BOOST_MUL = 1.45, SHROOM = 1.6, TURBO_1 = 0.6, TURBO_2 = 1.1;
const SPIN = 1.1;
const READY_TIME = 3.2;                        // the 3-2-1
const FIG_SCALE = 0.6;
// How far a chase camera may stray: inside the outer trees.
const _CAM_X = SX + TRACK_W / 2 + 9, _CAM_Z = SZ + TR + TRACK_W / 2 + 9;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _dir = null, _hud = null, _in = null, _fx = null;
let _karts = [], _cams = [], _boxes = [], _bananas = [], _bot = [], _line = [], _trees = [];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _winner = -1, _count = 0, _endAt = 0;

// ── Geometry of the circuit ─────────────────────────────────────────────────
function _at(s) {
    s = ((s % L) + L) % L;
    const a = SZ, b = a + Math.PI * TR, c = b + 2 * SZ, d = c + Math.PI * TR;
    if (s < a) return { x: SX, z: s, hx: 0, hz: 1 };                                   // east straight, north
    if (s < b) { const u = (s - a) / TR; return { x: TR * Math.cos(u), z: SZ + TR * Math.sin(u), hx: -Math.sin(u), hz: Math.cos(u) }; }
    if (s < c) return { x: -SX, z: SZ - (s - b), hx: 0, hz: -1 };                     // west straight, south
    if (s < d) { const u = Math.PI + (s - c) / TR; return { x: TR * Math.cos(u), z: -SZ + TR * Math.sin(u), hx: -Math.sin(u), hz: Math.cos(u) }; }
    return { x: SX, z: -SZ + (s - d), hx: 0, hz: 1 };                                   // east straight, back to the line
}
// The shortcut: straight across the south hairpin, west to east.
const CUT_A = { x: -SX, z: -SZ }, CUT_B = { x: SX, z: -SZ };
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
/** On the track or the shortcut path. Everywhere else is behind a tyre wall. */
function _drivable(x, z) {
    return _nearest(x, z).d < TRACK_W / 2 - R * 0.6 || _segDist(x, z, CUT_A, CUT_B) < PATH_W / 2 - R * 0.6;
}

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _winner = -1; _count = 0; _endAt = 0;
    _bananas = []; _boxes = [];
    _line = Array.from({ length: N }, (_, i) => _at((i / N) * L));
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
            const c = new THREE.PerspectiveCamera(62, 1, 0.1, 220);
            // The far half is upside down on the phone: roll its camera 180°.
            c.up.set(0, slot === 0 ? 1 : -1, 0);
            return c;
        });
    }
    _placeBoxes();
    _karts = [0, 1].map(_buildKart);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'DRAG ⬅➡ TO STEER · TAP FOR YOUR ITEM'));

    _dir.open({
        place: 'CITY RING ROAD · THE PARK CIRCUIT', title: 'GO-KART GRAND PRIX',
        sub: `${LAPS} LAPS · MIND THE SHORTCUT`,
        from: { pos: [26, 30, -30], look: [0, 0, 0] },
        to: { pos: [SX + 7, 5, -9], look: [SX, 0.5, 2] },
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.views = null; _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _karts = []; _cams = []; _boxes = []; _bananas = []; _trees = []; _dir = null; _hud = null; _in = null; _fx = null;
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
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
    return m;
}
function _buildCircuit() {
    const scene = _stage.scene;
    scene.background = new THREE.Color(0xa9d4f2);
    scene.fog = new THREE.Fog(0xbfe0f5, 60, 140);
    _stage.light({ sun: 0xfff3dd, sunI: 1.25, sky: 0xbfe0f5, ground: 0x3f6a38, hemiI: 0.85, rimI: 0.25, dir: [12, 30, 8], span: 34 });
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x5fae4a, roughness: 0.95 }));
    grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; _stage.add(grass);
    // Track, kerbs, the shortcut path.
    const loop = Array.from({ length: 240 }, (_, i) => _at((i / 240) * L));
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x3d434c, roughness: 0.85 });
    _stage.add(_ribbon(loop, TRACK_W + 0.9, 0.015, new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9 }), true));
    _stage.add(_ribbon(loop, TRACK_W, 0.03, asphalt, true));
    const kerb = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.12, 1.2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), 2 * 120);
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    for (let i = 0; i < 120; i++) {
        const p = _at((i / 120) * L), ang = Math.atan2(p.hx, p.hz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
        [1, -1].forEach((side, k) => {
            mm.compose(new THREE.Vector3(p.x + p.hz * side * (TRACK_W / 2 + 0.2), 0.06, p.z - p.hx * side * (TRACK_W / 2 + 0.2)), q, new THREE.Vector3(1, 1, 1));
            kerb.setMatrixAt(i * 2 + k, mm);
            kerb.setColorAt(i * 2 + k, col.setHex(i % 2 ? 0xef4444 : 0xffffff));
        });
    }
    kerb.receiveShadow = true; _stage.add(kerb);
    // Tyre walls down both edges of the track and both sides of the shortcut:
    // the infield (and the fountain in it) is out of bounds.
    const spots = [];
    const edge = TRACK_W / 2 + 0.55;
    for (let i = 0, n = Math.round(L / 1.05); i < n; i++) {
        const p = _at((i / n) * L);
        [1, -1].forEach(side => {
            const x = p.x + p.hz * side * edge, z = p.z - p.hx * side * edge;
            if (_segDist(x, z, CUT_A, CUT_B) < PATH_W / 2 + 0.6) return;        // the shortcut's mouths
            if (_nearest(x, z).d < edge - 0.3) return;                          // tight inside of a hairpin
            spots.push([x, z]);
        });
    }
    for (let x = -SX + edge + 0.6; x <= SX - edge - 0.6; x += 1.05) [-1, 1].forEach(k => spots.push([x, -SZ + k * (PATH_W / 2 + 0.55)]));
    const tyres = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.62, 12), new THREE.MeshStandardMaterial({ roughness: 0.85 }), spots.length);
    spots.forEach(([x, z], i) => {
        mm.compose(new THREE.Vector3(x, 0.31, z), q.identity(), new THREE.Vector3(1, 1, 1));
        tyres.setMatrixAt(i, mm);
        tyres.setColorAt(i, col.setHex(i % 6 < 3 ? 0x222428 : 0xd83a3a));
    });
    tyres.castShadow = true; _stage.add(tyres);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(2 * SX, PATH_W), new THREE.MeshStandardMaterial({ color: 0xcdbf9f, roughness: 0.9 }));
    path.rotation.x = -Math.PI / 2; path.position.set(0, 0.025, -SZ); path.receiveShadow = true; _stage.add(path);
    // The start line: a checker across the east straight.
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 16;
    const cx = cv.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { cx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; cx.fillRect(i * 4, j * 4, 4, 4); }
    const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 1.1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    line.rotation.x = -Math.PI / 2; line.position.set(SX, 0.04, 0); _stage.add(line);
    // A gantry over the line.
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.5, roughness: 0.4 });
    [-1, 1].forEach(k => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.6, 0.3), steel); p.position.set(SX + k * (TRACK_W / 2 + 0.9), 2.3, 0); p.castShadow = true; _stage.add(p); });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W + 2.1, 0.7, 0.4), new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5 }));
    beam.position.set(SX, 4.6, 0); beam.castShadow = true; _stage.add(beam);
    // The park in the middle: the fountain, trees; trees and lanterns outside.
    const stone = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.6 });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.7, 28), stone); basin.position.set(0, 0.35, 2); basin.castShadow = true; _stage.add(basin);
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.7, 28), new THREE.MeshStandardMaterial({ color: 0x5fb7e8, emissive: 0x1b5f86, emissiveIntensity: 0.4, roughness: 0.1 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, 0.66, 2); _stage.add(water);
    const colm = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.2, 12), stone); colm.position.set(0, 1.4, 2); _stage.add(colm);
    const trunk = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 });
    const leaves = [new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: 0x57a84a, roughness: 0.9 })];
    // Each tree owns its materials so it can fade on its own when it comes
    // between a chase camera and its kart (_fadeTrees).
    _trees = [];
    const tree = (x, z, k) => {
        const tm = trunk.clone(), lm = leaves[k % 2].clone();
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.2, 6), tm); t.position.set(x, 1.1, z); t.castShadow = true; _stage.add(t);
        const l = new THREE.Mesh(new THREE.SphereGeometry(1.5 + (k % 3) * 0.2, 9, 8), lm); l.position.set(x, 3.2, z); l.scale.y = 1.1; l.castShadow = true; _stage.add(l);
        _trees.push({ x, z, mats: [tm, lm], o: 1 });
    };
    [[-3.5, 9], [3.5, 10], [-4, -6], [4, -5]].forEach(([x, z], k) => tree(x, z, k));
    // Outside trees stand beyond the fence AND beyond where a chase camera may
    // go (_CAM_X, _CAM_Z), so a kart that runs wide never puts its own camera
    // inside a tree.
    for (let k = 0; k < 14; k++) {
        const side = k % 2 ? 1 : -1;
        tree(side * (_CAM_X + 2.5 + (k % 3)), -26 + k * 4.2, k + 3);
    }
    [[0, _CAM_Z + 2.5], [0, -_CAM_Z - 2.5], [-9, _CAM_Z + 3.5], [9, -_CAM_Z - 3.5]].forEach(([x, z], k) => tree(x, z, k + 20));
    // The fence itself, low, so the world visibly ends where the karts stop.
    const fenceM = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7 });
    const fx = SX + TRACK_W / 2 + 6.4, fz = SZ + TR + TRACK_W / 2 + 6.4;
    [[0, fz, 2 * fx, 0.2], [0, -fz, 2 * fx, 0.2], [fx, 0, 0.2, 2 * fz], [-fx, 0, 0.2, 2 * fz]].forEach(([x, z, w, d]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), fenceM); m.position.set(x, 0.3, z); m.castShadow = true; _stage.add(m);
    });
}

// ── Item boxes ───────────────────────────────────────────────────────────────
function _placeBoxes() {
    // Three rows across the track: after the start, on the west straight, and
    // just before the shortcut's far end, so the short way still passes one.
    [SZ * 0.6, SZ + Math.PI * TR + SZ, L - SZ * 0.4].forEach((s, row) => {
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
    const off = slot === 0 ? 1.6 : -1.6;               // P1 on the outside of the grid
    const k = { slot, x: p.x + off, z: p.z, h: 0, v: 0, steer: 0, drift: 0, driftDir: 0, boost: 0, spin: 0,
                item: null, lap: 0, s: 0, cp: 0, rev: 0, bx: 0, bz: 0, done: false, finishT: 0, bananaImmune: 0 };
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
    g.traverse(o => { if (o.isMesh && !sparks.includes(o)) o.castShadow = true; });
    _stage.add(g);
    const ch = _stage.character(slot);
    ch.rig.root.scale.setScalar(FIG_SCALE);
    ch.rig.root.position.set(0, 0.55, -0.2);
    g.add(ch.rig.root);
    ch.anim.play('ready');
    Object.assign(k, { g, sparks, rig: ch.rig, anim: ch.anim });
    return k;
}

function _useItem(slot) {
    const k = _karts[slot];
    if (!k || !k.item || _phase !== 'race' || k.done) return;
    if (k.item === 'shroom') { k.boost = Math.max(k.boost, SHROOM); sfx('boost'); haptic([25]); }
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
    // Coming up to the south hairpin: a good bot cuts across it.
    const sInto = SZ + Math.PI * TR + 2 * SZ;       // where the hairpin starts
    const toCut = sInto - k.s;
    if (toCut > -1 && toCut < 6 && !b.decided) { b.decided = true; b.cut = Math.random() < 0.15 + _botSkill * 0.8; }
    if (toCut > 12 || toCut < -40) b.decided = false;
    // The shortcut is walled on both sides now, so it is driven like a road:
    // first to its mouth at the end of the west straight, then along it.
    const onPath = _segDist(k.x, k.z, CUT_A, CUT_B) < PATH_W / 2 && k.x > CUT_A.x + 1.5;
    if (b.cut && !b.cutting && toCut < 9 && toCut > -2) b.cutting = true;
    if (b.cutting) {
        if (onPath || Math.hypot(k.x - (CUT_A.x + 1.8), k.z - CUT_A.z) < 2.2) target = { x: Math.min(CUT_B.x + 2, k.x + 8), z: CUT_B.z };
        else target = { x: CUT_A.x + 1.8, z: CUT_A.z };
        if (k.x > CUT_B.x - 1.5 || toCut < -2 - Math.PI * TR) { b.cutting = false; b.cut = false; }
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
        const cam = _cams[k.slot];
        if (cam) {
            // Chase camera: behind and above, eased, looking up the road.
            const fx = Math.sin(k.h), fz = Math.cos(k.h);
            const want = new THREE.Vector3(k.x - fx * 6.2, 3.1, k.z - fz * 6.2);
            if (!cam.userData.init) { cam.position.copy(want); cam.userData.init = true; }
            cam.position.lerp(want, Math.min(1, dt * 6));
            cam.position.x = Math.max(-_CAM_X, Math.min(_CAM_X, cam.position.x));
            cam.position.z = Math.max(-_CAM_Z, Math.min(_CAM_Z, cam.position.z));
            cam.lookAt(k.x + fx * 4, 0.9, k.z + fz * 4);
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
            if (_segDist(tr.x, tr.z, a, b) < 2.3) want = 0.18;
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
    if (k.done) { k.v *= Math.pow(0.4, dt); _move(k, dt); return; }
    if (k.rev > 0) {
        // Backing off a wall: roll back, swinging the nose round to face up
        // the track, then drive on.
        k.rev = Math.max(0, k.rev - dt);
        k.v = k.rev > 0 ? -REVERSE_V : 0;
        const p = _at(k.s);
        let d = Math.atan2(p.hx, p.hz) - k.h; d = Math.atan2(Math.sin(d), Math.cos(d));
        k.h += Math.max(-2.4 * dt, Math.min(2.4 * dt, d));
        k.drift = 0; k.driftDir = 0; k.steer = 0;
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
    const vmax = VMAX * surf * brake * (k.boost > 0 ? BOOST_MUL : 1) * (isBotSlot(k.slot) ? 0.86 + 0.12 * _botSkill : 1);
    k.boost = Math.max(0, k.boost - dt);
    if (k.spin > 0) k.v *= Math.pow(0.15, dt);
    else k.v += Math.max(-ACCEL * 2, Math.min(ACCEL, (vmax - k.v) * 2)) * dt;
    // Drift: a hard steer at speed charges it; straightening up fires it.
    const hard = Math.abs(steer) > 0.75 && k.v > DRIFT_MIN_V;
    if (hard) {
        if (!k.drift) k.driftDir = Math.sign(steer);
        k.drift += dt;
    } else if (k.drift && Math.abs(steer) < 0.35) {
        if (k.drift >= DRIFT_1) { k.boost = Math.max(k.boost, k.drift >= DRIFT_2 ? TURBO_2 : TURBO_1); sfx('boost'); haptic([15]); }
        k.drift = 0; k.driftDir = 0;
    } else if (!hard && Math.abs(steer) < 0.75) { k.drift = Math.max(0, k.drift - dt * 0.5); if (!k.drift) k.driftDir = 0; }
    const grip = k.drift ? 1.15 : 1;
    k.h -= steer * TURN * grip * Math.min(1, k.v / 6) * dt;
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
    const dx = (Math.sin(k.h) * k.v + k.bx) * dt, dz = (Math.cos(k.h) * k.v + k.bz) * dt;
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
        k.rev = REVERSE; k.drift = 0; k.boost = 0;
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
        if (_clock > 8) _hud.hint(slot, '');
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
    return { phase: _phase, clock: +_clock.toFixed(2), winner: _winner, L: +L.toFixed(1),
             karts: _karts.map(k => ({ x: +k.x.toFixed(2), z: +k.z.toFixed(2), h: +k.h.toFixed(2), v: +k.v.toFixed(2), s: +k.s.toFixed(1),
                                        lap: k.lap, cp: k.cp, rev: +k.rev.toFixed(2), item: k.item, drift: +k.drift.toFixed(2), boost: +k.boost.toFixed(2), spin: +k.spin.toFixed(2),
                                        surf: _surface(k.x, k.z), done: k.done })),
             views: _stage?.views ? _stage.views.length : 0, gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: put a kart somewhere, facing h, at speed v. */
export function _debugPlace(slot, x, z, h = 0, v = 0) { const k = _karts[slot]; if (k) Object.assign(k, { x, z, h, v, spin: 0 }); }
/** Probes: give a kart an item, or set its lap count. */
export function _debugItem(slot, item) { if (_karts[slot]) _karts[slot].item = item; }
export function _debugLap(slot, lap, half = true) { if (_karts[slot]) Object.assign(_karts[slot], { lap, cp: half ? CHECKPOINTS.length : 0 }); }
