// ============================================================
// MINI GOLF — crazy golf in the park, both of you at once.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Face-off hold, SPLIT SCREEN. Each of you plays your OWN copy of the same
// hole, at the same time, with a camera behind your own tee looking down the
// hole at the flag. No turns and no waiting: putt again as soon as your ball
// stops.
//
//   DRAG BACK on your half and LET GO: a slingshot. The further you pull, the
//   harder the putt; the dotted line shows where it's going.
//
// Three holes, picked at random from seven:
//   THE WINDMILL · THE LOOP · THE FOUNTAIN BRIDGE · PINBALL · THE DOGLEG ·
//   SAND TRAPS · THE SLIDER
// Fewest strokes over the three wins. Level on strokes, the faster total time
// to hole out wins — so there are no ties.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const HX = 8.6, HZ = 3.2;              // a hole: x from the tee end (−) to the cup end (+), z across
const OFF = [9, -9];                   // world z of each player's copy of the hole
const BR = 0.2;                        // ball radius
const MAXV = 11;                       // a full pull
const DECEL = 1.3, DRAG = 0.55;        // rolling friction: constant + per unit speed
const SAND = 3.2;                      // friction multiplier in a bunker
const REST = 0.72, BUMP_REST = 1.05;   // off a wall, off a bumper
const STOP_V = 0.07;
const CUP_R = 0.32, SINK_V = 4.2;
const LOOP_V = 6.2;                    // speed to make it round the loop
const MAX_STROKES = 6;                 // then you pick up, scoring MAX + 1
const SHOT_CLOCK = 10;                 // s, then a short putt is taken for you
const HOLES_PER_MATCH = 3;
const TALLY = 2.0;
const FIG_SCALE = 0.95;

// ── The holes ────────────────────────────────────────────────────────────────
// Walls are segments [x1, z1, x2, z2]; the rail round every hole is added by
// _walls(). Everything is in the hole's own frame.
const POOL = [
    {   key: 'windmill', name: 'THE WINDMILL', par: 2, tee: [-7, 0], cup: [7, 0.8],
        walls: [[-0.6, -0.55, 0.6, -0.55], [-0.6, -0.55, -0.6, -HZ], [0.6, -0.55, 0.6, -HZ],
                [-0.6, 0.55, 0.6, 0.55], [-0.6, 0.55, -0.6, HZ], [0.6, 0.55, 0.6, HZ]],
        windmill: { x: 0 } },
    {   key: 'loop', name: 'THE LOOP', par: 3, tee: [-7, -2.2], cup: [7, 1.6],
        walls: [[-1.5, -1.0, 1.5, -1.0], [-1.5, -1.0, -1.5, HZ], [1.5, -1.0, 1.5, HZ]],
        loop: { x0: -1.5, x1: 1.5, zMax: -1.0 } },
    {   key: 'bridge', name: 'THE FOUNTAIN BRIDGE', par: 2, tee: [-7, 0], cup: [7, 0],
        walls: [[5.2, -1.4, 5.8, -1.4], [5.2, 1.4, 5.8, 1.4]],
        pond: { x: 0, z: 0, r: 2.5, bridge: 0.55 } },
    {   key: 'pinball', name: 'PINBALL', par: 2, tee: [-7, 0], cup: [7, 0],
        walls: [],
        bumpers: [[-2.5, -1.6], [-2.5, 0.2], [-2.5, 2.0], [0, -0.7], [0, 1.1], [2.5, -1.6], [2.5, 0.2], [2.5, 2.0], [4.8, -0.6], [4.8, 0.6]].map(([x, z]) => ({ x, z, r: 0.42 })) },
    {   key: 'dogleg', name: 'THE DOGLEG', par: 3, tee: [-7, -1.8], cup: [-6, 1.9],
        walls: [[-HX, 0.4, 4.6, 0.4]] },
    {   key: 'sand', name: 'SAND TRAPS', par: 2, tee: [-7, 0], cup: [6.6, 0],
        walls: [[3.0, -HZ, 3.0, -1.1], [3.0, 1.1, 3.0, HZ]],
        sands: [{ x: 0, z: -1.2, r: 1.5 }, { x: 0, z: 1.6, r: 1.3 }, { x: 5.2, z: -1.7, r: 1.2 }, { x: 5.2, z: 1.7, r: 1.2 }] },
    {   key: 'slider', name: 'THE SLIDER', par: 2, tee: [-7, 0], cup: [7, 0],
        walls: [[-0.2, -HZ, -0.2, -1.2], [-0.2, 1.2, -0.2, HZ], [0.2, -HZ, 0.2, -1.2], [0.2, 1.2, 0.2, HZ]],
        mover: { x: 0, len: 1.9, amp: 1.6, speed: 1.4 } },
];
function _walls(h) {
    return [[-HX, -HZ, HX, -HZ], [HX, -HZ, HX, HZ], [HX, HZ, -HX, HZ], [-HX, HZ, -HX, -HZ], ...h.walls];
}
// The windmill's gap is shut while a sail is down in front of it.
const _sailAngle = t => t * 1.7;
function _gapShut(t) {
    const a = _sailAngle(t);
    for (let k = 0; k < 4; k++) {
        let d = (a + k * Math.PI / 2) % (Math.PI * 2);
        d = Math.abs(d - Math.PI * 1.5);
        if (d < 0.3) return true;
    }
    return false;
}
// The slider's block, a bar across the middle of the doorway, at time t.
const _moverZ = (m, t) => m.amp * Math.sin(t * m.speed);
function _dynamic(h, t) {
    const out = [];
    if (h.windmill && _gapShut(t)) out.push([0, -0.55, 0, 0.55]);
    if (h.mover) { const z = _moverZ(h.mover, t); out.push([h.mover.x, z - h.mover.len / 2, h.mover.x, z + h.mover.len / 2]); }
    return out;
}

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _holes = [], _hole = -1, _balls = [], _strokes = [[], []], _times = [[], []], _copies = [], _aims = [], _cams = [], _figs = [], _bot = [];
let _phase = 'intro', _sub = '', _subT = 0, _t = 0, _holeT = 0;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _sub = ''; _subT = 0; _t = 0; _hole = -1; _strokes = [[], []]; _times = [[], []]; _copies = [];
    // Three holes, the same three for both, in a random order.
    _holes = _forceHoles ? _forceHoles.map(k => POOL.find(p => p.key === k)) : [...POOL].sort(() => Math.random() - 0.5).slice(0, HOLES_PER_MATCH);
    _bot = [0, 1].map(() => ({ wait: 1 }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#a9d4f2;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 50, background: 0xa9d4f2 });
    _hud = faceoffHud(_stage);
    _in = touch(_stage, { split: 'y', stick: 90, onRelease: (slot, r) => _release(slot, r) });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _set = STAGE_SETS.ring(_stage, { w: HX * 2 + 4, d: 34, lanterns: false });
        _cams = [0, 1].map(slot => {
            const c = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
            c.up.set(0, slot === 0 ? 1 : -1, 0);  // the far half reads from its own end
            return c;
        });
        _aims = [0, 1].map(_buildAim);
    }
    _balls = [0, 1].map(_buildBall);
    _figs = [0, 1].map(_buildFig);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'DRAG BACK · LET GO TO PUTT'));

    _dir.open({
        place: 'CITY RING ROAD · THE CRAZY GOLF', title: 'MINI GOLF',
        sub: `${_holes.length} HOLES · BOTH AT ONCE · FEWEST STROKES`,
        from: { pos: [14, 12, 0], look: [0, 0, 0] },
        to: { pos: [-HX - 5, 10, OFF[0]], look: [2, 0, OFF[0]] },
        onDone: () => {
            if (_done) return;
            if (_stage?.gl) _stage.views = [0, 1].map(slot => ({ camera: _cams[slot], rect: slot === 0 ? [0, 0, 1, 0.5] : [0, 0.5, 1, 0.5] }));
            _phase = 'play'; _nextHole();
        },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.views = null; _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _balls = []; _figs = []; _copies = []; _aims = []; _cams = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── Building ─────────────────────────────────────────────────────────────────
function _buildBall(slot) {
    const b = { slot, x: 0, z: 0, vx: 0, vz: 0, holed: false, loop: null, from: [0, 0], mesh: null, state: 'aim', clock: 0, idle: 0 };
    if (_stage.gl) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(BR, 18, 14), new THREE.MeshStandardMaterial({ color: seat(slot).color, roughness: 0.3 }));
        m.castShadow = true; _stage.add(m); b.mesh = m;
    }
    return b;
}
function _buildFig(slot) {
    // Each player stands beside their own tee, out of their camera's way.
    const f = { slot };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        c.rig.root.position.set(-HX + 0.6, 0, OFF[slot] + HZ + 1.3);
        c.anim.face(Math.PI / 2, true);
        c.anim.play('ready');
        Object.assign(f, { rig: c.rig, anim: c.anim });
    }
    return f;
}
function _buildAim() {
    const g = new THREE.Group();
    for (let i = 0; i < 9; i++) {
        const d = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        d.position.x = i; g.add(d);
    }
    g.visible = false; _stage.add(g);
    return g;
}

/** One copy of a hole, for one player, built in the hole's own frame at z = off. */
function _buildCopy(h, off) {
    const g = new THREE.Group();
    g.position.z = off;
    const copy = { g, sails: null, gate: null, mover: null };
    const felt = new THREE.Mesh(new THREE.BoxGeometry(HX * 2, 0.1, HZ * 2), new THREE.MeshStandardMaterial({ color: 0x2f9e44, roughness: 0.9 }));
    felt.position.y = 0.05; felt.receiveShadow = true; g.add(felt);
    const rail = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.6 });
    const wallMesh = ([x1, z1, x2, z2], mat = rail, hh = 0.32) => {
        const len = Math.hypot(x2 - x1, z2 - z1);
        const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.16, hh, 0.16), mat);
        m.position.set((x1 + x2) / 2, 0.1 + hh / 2, (z1 + z2) / 2);
        m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        m.castShadow = true; g.add(m);
        return m;
    };
    _walls(h).forEach(w => wallMesh(w));
    const tee = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.02, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    tee.position.set(h.tee[0], 0.11, h.tee[1]); g.add(tee);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(CUP_R, CUP_R, 0.02, 24), new THREE.MeshBasicMaterial({ color: 0x0b0f0c }));
    cup.position.set(h.cup[0], 0.11, h.cup[1]); g.add(cup);
    // A tall flag, so the cup is the first thing you see down the hole.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0xe5e7eb }));
    pole.position.set(h.cup[0], 1.2, h.cup[1]); g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshStandardMaterial({ color: 0xef4444, side: THREE.DoubleSide, emissive: 0x7f1d1d, emissiveIntensity: 0.4 }));
    flag.position.set(h.cup[0], 2.0, h.cup[1] + 0.4); flag.rotation.y = Math.PI / 2; g.add(flag);
    if (h.windmill) {
        const brick = new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.75 });
        const trim = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.6 });
        [-1, 1].forEach(sd => {
            const half = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, HZ - 0.55), brick);
            half.position.set(0, 1.3, sd * (0.55 + (HZ - 0.55) / 2)); half.castShadow = true; g.add(half);
            const post = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.1, 0.12), trim);
            post.position.set(0, 0.65, sd * 0.61); g.add(post);
        });
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.4), brick); lintel.position.set(0, 2.3, 0); g.add(lintel);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.3, 4), new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.8 }));
        roof.position.set(0, 3.2, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
        // The sails turn on the TEE side of the mill, facing the player.
        const sails = new THREE.Group();
        const sailM = new THREE.MeshStandardMaterial({ color: 0xfefce8, roughness: 0.6, side: THREE.DoubleSide });
        for (let k = 0; k < 4; k++) {
            const arm = new THREE.Group();
            const spar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.15, 0.06), new THREE.MeshStandardMaterial({ color: 0x78350f }));
            spar.position.y = 1.07; arm.add(spar);
            const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 1.6), sailM);
            cloth.position.set(0.26, 1.25, 0.02); arm.add(cloth);
            arm.rotation.z = k * Math.PI / 2; sails.add(arm);
        }
        const holder = new THREE.Group(); holder.add(sails);
        holder.rotation.y = -Math.PI / 2; holder.position.set(-0.7, 2.3, 0); g.add(holder);
        copy.sails = sails;
        copy.gate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 1.1), new THREE.MeshStandardMaterial({ color: 0xfde047, emissive: 0x7a5d00, emissiveIntensity: 0.5 }));
        copy.gate.position.set(0, 0.28, 0); g.add(copy.gate);
    }
    if (h.loop) {
        const rails = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.3, metalness: 0.5 });
        [-0.2, 0.2].forEach(o => {
            const pts = [];
            for (let i = 0; i <= 64; i++) { const p = _loopPoint(1, i / 64); pts.push(new THREE.Vector3(p.x, p.y + BR * 0.2, p.z + o)); }
            const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.06, 8, false), rails);
            tube.castShadow = true; g.add(tube);
        });
        const hedge = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.7, HZ + 1.0), new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 1 }));
        hedge.position.set(0, 0.45, (HZ - 1.0) / 2); hedge.castShadow = true; g.add(hedge);
    }
    if (h.pond) {
        const water = new THREE.Mesh(new THREE.CircleGeometry(h.pond.r, 40), new THREE.MeshStandardMaterial({ color: 0x38a3e8, emissive: 0x0b4f7a, emissiveIntensity: 0.4, roughness: 0.1 }));
        water.rotation.x = -Math.PI / 2; water.position.set(h.pond.x, 0.105, h.pond.z); g.add(water);
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(h.pond.r * 2 + 0.4, 0.06, h.pond.bridge * 2), new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.8 }));
        bridge.position.set(h.pond.x, 0.13, h.pond.z); g.add(bridge);
    }
    (h.bumpers || []).forEach(p => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 0.5, 20), new THREE.MeshStandardMaterial({ color: 0xec4899, emissive: 0x831843, emissiveIntensity: 0.4, roughness: 0.3 }));
        post.position.set(p.x, 0.35, p.z); post.castShadow = true; g.add(post);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.6, p.r * 0.6, 0.06, 16), new THREE.MeshBasicMaterial({ color: 0xfde68a }));
        top.position.set(p.x, 0.63, p.z); g.add(top);
    });
    (h.sands || []).forEach(s => {
        const sand = new THREE.Mesh(new THREE.CircleGeometry(s.r, 28), new THREE.MeshStandardMaterial({ color: 0xe5c07b, roughness: 1 }));
        sand.rotation.x = -Math.PI / 2; sand.position.set(s.x, 0.106, s.z); g.add(sand);
    });
    if (h.mover) {
        copy.mover = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, h.mover.len), new THREE.MeshStandardMaterial({ color: 0x7c3aed, emissive: 0x3b0764, emissiveIntensity: 0.4 }));
        copy.mover.position.set(h.mover.x, 0.33, 0); copy.mover.castShadow = true; g.add(copy.mover);
    }
    _stage.add(g);
    return copy;
}
function _clearCopies() {
    _copies.forEach(c => { _stage.scene.remove(c.g); c.g.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); });
    _copies = [];
}

// The loop's path, u 0..1, for a ball heading dir (±1).
const LOOP_R = 0.95, LOOP_Z = -2.1;
function _loopPoint(dir, u) {
    if (u < 0.18) { const k = u / 0.18; return { x: dir * (-1.5 + 1.5 * k), y: 0.1, z: LOOP_Z - 0.3 }; }
    if (u > 0.82) { const k = (u - 0.82) / 0.18; return { x: dir * 1.5 * k, y: 0.1, z: LOOP_Z + 0.3 }; }
    const phi = (u - 0.18) / 0.64 * Math.PI * 2;
    return { x: dir * LOOP_R * Math.sin(phi), y: 0.1 + LOOP_R * (1 - Math.cos(phi)), z: LOOP_Z - 0.3 + 0.6 * (phi / (Math.PI * 2)) };
}

// ── Physics (pure enough to run ahead for the bot) ───────────────────────────
function _step(b, dt, t, h, walls) {
    const sp = Math.hypot(b.vx, b.vz);
    if (sp < 1e-6) return null;
    const n = Math.max(1, Math.ceil(sp * dt / 0.08));
    const d = dt / n;
    for (let i = 0; i < n; i++) {
        b.x += b.vx * d; b.z += b.vz * d;
        const segs = [...walls, ..._dynamic(h, t + i * d)];
        for (const [x1, z1, x2, z2] of segs) {
            const vx = x2 - x1, vz = z2 - z1, L2 = vx * vx + vz * vz;
            const u = Math.max(0, Math.min(1, ((b.x - x1) * vx + (b.z - z1) * vz) / L2));
            const cx = x1 + vx * u, cz = z1 + vz * u;
            let nx = b.x - cx, nz = b.z - cz; const dist = Math.hypot(nx, nz);
            if (dist >= BR || dist < 1e-6) continue;
            nx /= dist; nz /= dist;
            b.x = cx + nx * BR; b.z = cz + nz * BR;
            const vn = b.vx * nx + b.vz * nz;
            if (vn < 0) { b.vx -= (1 + REST) * vn * nx; b.vz -= (1 + REST) * vn * nz; b.hit = (b.hit || 0) + Math.abs(vn); }
        }
        for (const p of h.bumpers || []) {
            let nx = b.x - p.x, nz = b.z - p.z; const dist = Math.hypot(nx, nz);
            if (dist >= p.r + BR || dist < 1e-6) continue;
            nx /= dist; nz /= dist;
            b.x = p.x + nx * (p.r + BR); b.z = p.z + nz * (p.r + BR);
            const vn = b.vx * nx + b.vz * nz;
            if (vn < 0) { b.vx -= (1 + BUMP_REST) * vn * nx; b.vz -= (1 + BUMP_REST) * vn * nz; b.bump = true; }
        }
        if (h.loop && b.z < h.loop.zMax && b.x > h.loop.x0 && b.x < h.loop.x1 && !b.looped) {
            b.looped = true;
            if (Math.abs(b.vx) >= LOOP_V) return 'loop';
            b.vx = -b.vx * 0.5; b.x = b.vx < 0 ? h.loop.x0 - 0.05 : h.loop.x1 + 0.05;
            return 'fail';
        }
        if (h.loop && (b.x < h.loop.x0 - 0.3 || b.x > h.loop.x1 + 0.3)) b.looped = false;
        if (h.pond) {
            const p = h.pond;
            if (Math.hypot(b.x - p.x, b.z - p.z) < p.r && Math.abs(b.z - p.z) > p.bridge) return 'water';
        }
        const dc = Math.hypot(b.x - h.cup[0], b.z - h.cup[1]);
        if (dc < CUP_R && Math.hypot(b.vx, b.vz) < SINK_V) return 'cup';
    }
    const s2 = Math.hypot(b.vx, b.vz);
    const inSand = (h.sands || []).some(s => Math.hypot(b.x - s.x, b.z - s.z) < s.r);
    const ns = Math.max(0, s2 - (DECEL + DRAG * s2) * (inSand ? SAND : 1) * dt);
    if (ns < STOP_V) { b.vx = 0; b.vz = 0; } else { b.vx *= ns / s2; b.vz *= ns / s2; }
    return null;
}

// ── Holes ────────────────────────────────────────────────────────────────────
function _nextHole() {
    _hole++;
    if (_hole >= _holes.length) { _end(); return; }
    const h = _holes[_hole];
    if (_stage?.gl) { _clearCopies(); _copies = OFF.map(off => _buildCopy(h, off)); }
    _balls.forEach(b => Object.assign(b, { x: h.tee[0], z: h.tee[1], vx: 0, vz: 0, holed: false, loop: null, looped: false, state: 'aim', clock: 0, idle: 0 }));
    _strokes.forEach(s => s.push(0));
    _times.forEach(s => s.push(0));
    _bot.forEach(b => { b.wait = 1.8 + Math.random() * 0.8; });
    _holeT = 0;
    _hud.say(`HOLE ${_hole + 1} · ${h.name}`, `PAR ${h.par}`, 1600, _t, '#fde047');
    _sub = 'play'; _subT = 0;
}
const _totals = () => _strokes.map(s => s.reduce((a, b) => a + b, 0));
const _timeTotals = () => _times.map(s => s.reduce((a, b) => a + b, 0));

// A player's drag, read in their own frame: right is their right, forward is
// down the hole (+x); both copies' "right" is +z in the hole's frame.
const _playerXY = (slot, x, y) => (slot === 0 ? [x, -y] : [-x, y]);

function _release(slot, r) {
    const b = _balls[slot];
    if (_phase !== 'play' || !b || b.state !== 'aim' || isBotSlot(slot) || !r.moved) return;
    const p = Math.min(1, Math.hypot(r.dx, r.dy));
    if (p < 0.08) return;
    const [lat, fwd] = _playerXY(slot, r.dx, r.dy), n = Math.hypot(lat, fwd) || 1;
    // A slingshot: the ball goes the opposite way to the pull.
    _shoot(slot, -fwd / n, -lat / n, p);
}

function _shoot(slot, dx, dz, power) {
    const b = _balls[slot];
    if (!b || b.state !== 'aim') return;
    b.from = [b.x, b.z];
    b.vx = dx * power * MAXV; b.vz = dz * power * MAXV; b.looped = false;
    _strokes[slot][_hole]++;
    b.state = 'roll'; b.clock = 0;
    sfx('slam'); if (!isBotSlot(slot)) haptic([12]);
    _figs[slot]?.anim?.play('shove', { restart: true });
    if (_aims[slot]) _aims[slot].visible = false;
}

function _holed(b, h, how) {
    b.holed = true; b.state = 'done'; b.vx = b.vz = 0;
    _times[b.slot][_hole] = _holeT;
    if (how === 'cup') {
        b.x = h.cup[0]; b.z = h.cup[1];
        sfx('mg_win'); if (!isBotSlot(b.slot)) haptic([40]);
        if (_stage?.gl) _fx.confetti(new THREE.Vector3(b.x, 0.5, b.z + OFF[b.slot]), [seat(b.slot).color, 0xffffff, 0xfde047], 22, 2.5);
        const n = _strokes[b.slot][_hole];
        _hud.say(n === 1 ? 'HOLE IN ONE!' : n < h.par ? 'BIRDIE!' : n === h.par ? 'PAR' : 'IN!', `${seat(b.slot).name} · ${n} · ${_holeT.toFixed(1)}s`, 1100, _t, seat(b.slot).css);
        _figs[b.slot]?.anim?.play('victory');
    } else {
        _strokes[b.slot][_hole] = MAX_STROKES + 1;
        if (b.mesh) b.mesh.visible = false;
        _hud.say('PICKED UP', seat(b.slot).name, 900, _t);
    }
}

// ── Bot (§5): try shots ahead in the physics, keep the best, then miss a bit ─
function _botPlan(slot) {
    const h = _holes[_hole], walls = _walls(h), b = _balls[slot];
    const direct = Math.atan2(h.cup[1] - b.z, h.cup[0] - b.x);
    let best = null;
    const tries = 30 + Math.round(_botSkill * 50);
    for (let k = 0; k < tries; k++) {
        const a = direct + (Math.random() - 0.5) * (k < tries / 2 ? 0.9 : Math.PI * 2);
        const p = 0.2 + Math.random() * 0.8;
        const sim = { x: b.x, z: b.z, vx: Math.cos(a) * p * MAXV, vz: Math.sin(a) * p * MAXV };
        let t = _t, res = null;
        for (let i = 0; i < 120 && Math.hypot(sim.vx, sim.vz) > 0; i++) {
            res = _step(sim, 1 / 30, t, h, walls); t += 1 / 30;
            if (res === 'loop') { sim.x = h.loop.x1 + 0.35; sim.z = LOOP_Z + 0.3; sim.vx = Math.abs(sim.vx) * 0.72; res = null; }
            if (res === 'cup' || res === 'water') break;
        }
        const score = res === 'cup' ? -100 : res === 'water' ? 60 : _pathLeft(h, sim.x, sim.z);
        if (!best || score < best.score) best = { a, p, score };
    }
    const err = 1 - _botSkill;
    return { a: best.a + (Math.random() - 0.5) * err * 0.35, p: Math.min(1, best.p * (1 + (Math.random() - 0.5) * err * 0.35)) };
}
// How far the ball still has to go, round the long wall of the dogleg.
function _pathLeft(h, x, z) {
    if (h.key === 'dogleg' && z < 0.4 && x < 4.6) return Math.hypot(6.6 - x, 0) + Math.hypot(6.6 - h.cup[0], 1.9 - h.cup[1]);
    return Math.hypot(x - h.cup[0], z - h.cup[1]);
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt; _subT += dt;
    _hud.tick(_t);
    const h = _holes[Math.max(0, Math.min(_hole, _holes.length - 1))];

    if (_phase === 'play' && _sub === 'play') {
        _holeT += dt;
        const walls = _walls(h);
        _balls.forEach(b => {
            if (b.state === 'done') return;
            if (b.state === 'aim') {
                b.clock += dt;
                if (isBotSlot(b.slot)) {
                    const bb = _bot[b.slot];
                    bb.wait -= dt;
                    if (bb.wait <= 0) { const pl = _botPlan(b.slot); _shoot(b.slot, Math.cos(pl.a), Math.sin(pl.a), pl.p); bb.wait = 0.8 + Math.random() * 0.8 + (1 - _botSkill) * 0.8; }
                } else {
                    const s = _in.seat(b.slot), aim = _aims[b.slot];
                    if (aim && s.down && s.moved) {
                        const [lat, fwd] = _playerXY(b.slot, s.dx, s.dy), m = Math.min(1, Math.hypot(s.dx, s.dy));
                        aim.visible = true;
                        aim.position.set(b.x, 0.24, b.z + OFF[b.slot]);
                        aim.rotation.y = -Math.atan2(-lat, -fwd);
                        aim.children.forEach((d, i) => { d.position.x = 0.35 + i * 0.32 * (0.4 + m * 1.6); d.material.color.setHex(m > 0.85 ? 0xff6b6b : 0xffffff); });
                    } else if (aim) aim.visible = false;
                    // Less time to dawdle once the other ball is in; and twice out
                    // of time on a hole picks you up, so nobody holds the table up.
                    const limit = _balls[1 - b.slot].state === 'done' ? 6 : SHOT_CLOCK;
                    if (b.clock >= limit && b.idle >= 1) { b.idle++; _holed(b, h, 'pickup'); return; }
                    if (b.clock >= limit) {
                        // Out of time: a short putt toward the flag is taken for you.
                        b.idle++;
                        const a = Math.atan2(h.cup[1] - b.z, h.cup[0] - b.x);
                        _shoot(b.slot, Math.cos(a), Math.sin(a), 0.25);
                        _hud.say('TIME!', `${seat(b.slot).name} · A SHORT PUTT FOR YOU`, 900, _t, '#fca5a5');
                    }
                }
            } else if (b.state === 'roll') {
                if (b.loop) {
                    b.loop.t += dt;
                    if (b.loop.t >= b.loop.dur) {
                        const sg = b.loop.dir;
                        b.x = sg > 0 ? h.loop.x1 + 0.35 : h.loop.x0 - 0.35; b.z = LOOP_Z + 0.3 * sg; b.vx = sg * b.loop.v * 0.72; b.vz = 0; b.loop = null;
                    }
                    return;
                }
                const res = _step(b, dt, _t, h, walls);
                if (b.hit > 1.5) sfx('land_good');
                if (b.bump) { sfx('boost'); b.bump = false; }
                b.hit = 0;
                if (res === 'cup') _holed(b, h, 'cup');
                else if (res === 'water') {
                    _strokes[b.slot][_hole]++;
                    sfx('boom');
                    if (_stage?.gl) _fx.puff(new THREE.Vector3(b.x, 0.3, b.z + OFF[b.slot]), 0x7dd3fc, 8, 0.4, 0.8);
                    _hud.say('SPLASH!', `${seat(b.slot).name} · ONE STROKE`, 900, _t, '#38bdf8');
                    b.x = b.from[0]; b.z = b.from[1]; b.vx = b.vz = 0;
                } else if (res === 'loop') { b.loop = { t: 0, dur: 1.1, v: Math.abs(b.vx), dir: Math.sign(b.vx) || 1 }; sfx('boost'); }
                else if (res === 'fail') sfx('land_bad');
                if (!b.loop && !b.holed && b.vx === 0 && b.vz === 0) {
                    if (_strokes[b.slot][_hole] >= MAX_STROKES) _holed(b, h, 'pickup');
                    else { b.state = 'aim'; b.clock = 0; }
                }
            }
        });
        if (_balls.every(b => b.state === 'done')) {
            _sub = 'tally'; _subT = 0;
            const s = _strokes.map(x => x[_hole]), tm = _times.map(x => x[_hole]);
            _hud.say(`${seat(0).name} ${s[0]} · ${seat(1).name} ${s[1]}`, `${tm[0].toFixed(1)}s · ${tm[1].toFixed(1)}s`, TALLY * 1000, _t, '#fde047');
        }
    } else if (_phase === 'play' && _sub === 'tally' && _subT >= TALLY) _nextHole();

    // Draw.
    _balls.forEach(b => {
        if (!b.mesh) return;
        if (b.loop) {
            const p = _loopPoint(b.loop.dir, Math.min(1, b.loop.t / b.loop.dur));
            b.mesh.position.set(p.x, p.y + BR, p.z + OFF[b.slot]);
        } else b.mesh.position.set(b.x, b.holed ? -0.1 : 0.1 + BR, b.z + OFF[b.slot]);
        if (!(b.holed && _strokes[b.slot][_hole] > MAX_STROKES)) b.mesh.visible = true;
    });
    _copies.forEach(c => {
        if (c.sails) c.sails.rotation.z = _sailAngle(_t) - Math.PI / 2;
        if (c.gate) c.gate.visible = _gapShut(_t);
        if (c.mover) c.mover.position.z = _moverZ(h.mover, _t);
    });
    // Each camera: behind its own tee, looking down the hole at the flag.
    _cams.forEach((cam, slot) => {
        // Steep enough that the tee sits clear of the HUD strip at the near edge
        // and the flag near the far one.
        cam.position.set(-5.5, 24.5, OFF[slot]);
        cam.lookAt(-2.6, 0, OFF[slot]);
    });
    _set?.update?.(dt, _t);
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    _renderHud();
}

function _renderHud() {
    if (!_hud || _hole < 0) return;
    const tot = _totals();
    const hl = Math.min(_hole, _holes.length - 1);
    [0, 1].forEach(slot => {
        const b = _balls[slot];
        const now = _strokes[slot][hl] || 0;
        const lim = _balls[1 - slot].state === 'done' ? 6 : SHOT_CLOCK;
        const clock = b.state === 'aim' && !isBotSlot(slot) && b.clock > lim - 4 ? ` · ${Math.max(0, Math.ceil(lim - b.clock))}s` : '';
        _hud.line(slot, `⛳ ${hl + 1}/${_holes.length} ${_holes[hl].name} · ${b.state === 'done' ? 'IN' : `STROKE ${now + (b.state === 'aim' ? 1 : 0)}`} · TOTAL ${tot[slot]}–${tot[1 - slot]}${clock}`);
        if (!seat(slot).bot) _hud.hint(slot, b.state === 'done' && _sub === 'play' ? 'IN! WAITING FOR THE OTHER BALL…' : _hole === 0 && now === 0 ? 'DRAG BACK · LET GO TO PUTT' : '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `HOLE ${hl + 1} · ${seat(0).name} ${tot[0]} – ${tot[1]} ${seat(1).name}`;
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    const tot = _totals(), tt = _timeTotals();
    // Fewest strokes; level on strokes, the faster total time.
    const w = tot[0] !== tot[1] ? (tot[0] < tot[1] ? 0 : 1) : Math.abs(tt[0] - tt[1]) < 0.05 ? -1 : tt[0] < tt[1] ? 0 : 1;
    if (_stage) _stage.views = null;
    _aims.forEach(a => { a.visible = false; });
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? `${tot[0]} STROKES EACH` : tot[0] !== tot[1] ? `${tot[w]} STROKES TO ${tot[1 - w]}` : `LEVEL ON ${tot[0]} · QUICKER BY ${Math.abs(tt[0] - tt[1]).toFixed(1)}s`,
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
let _forceHoles = null;
export function _debugState() {
    return { phase: _phase, sub: _sub, hole: _hole, holes: _holes.map(h => h.key), strokes: _strokes.map(s => [...s]), times: _times.map(s => s.map(t => +t.toFixed(2))),
             balls: _balls.map(b => ({ x: +b.x.toFixed(2), z: +b.z.toFixed(2), v: +Math.hypot(b.vx, b.vz).toFixed(2), state: b.state, holed: b.holed, loop: !!b.loop })),
             views: _stage?.views ? _stage.views.length : 0, gl: !!_stage?.gl, turned: !!_stage?.turned };
}
export function _debugBall(slot, x, z) { const b = _balls[slot]; if (b) Object.assign(b, { x, z, vx: 0, vz: 0, state: 'aim', clock: 0 }); }
export function _debugShoot(slot, dx, dz, p) { const b = _balls[slot]; if (b) b.state = 'aim'; _shoot(slot, dx, dz, p); }
/** Probes: the holes the NEXT start() plays (keys from the pool), or null for random. */
export function _debugForceHoles(keys) { _forceHoles = keys; }
/** Probes: every hole in the pool. */
export function _debugPool() { return POOL.map(h => h.key); }
/** Probes: set the card (strokes and seconds per hole, per player) and end the match. */
export function _debugScore(strokes, times) { _strokes = strokes.map(s => [...s]); _times = times.map(s => [...s]); _end(); }
