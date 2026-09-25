// ============================================================
// MINI GOLF — three holes of crazy golf in the fountain park.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Side-on hold, side by side: the course runs left to right, so both players
// read it the same way round. You take turns.
//
//   On your turn, DRAG BACK on your half and LET GO: a slingshot. The further
//   you pull, the harder the putt. The aim line shows where it is going.
//
//   1  THE WINDMILL        the way through is under the sails, and only open
//                          between blades
//   2  THE LOOP            hit it hard enough to go round, or it rolls back
//   3  THE FOUNTAIN BRIDGE a narrow bridge over the pond: water costs a stroke
//                          and puts you back where you hit from
//
// Both balls are on the course and can knock each other. Fewest strokes over
// the three holes wins.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, sideHud, touch, effects } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const HX = 8.6, HZ = 3.2;              // the course: x in ±HX, z in ±HZ
const BR = 0.2;                        // ball radius
const MAXV = 11;                       // a full pull
const DECEL = 1.3, DRAG = 0.55;        // rolling friction: constant + per unit speed
const REST = 0.72;                     // off a wall
const STOP_V = 0.07;
const CUP_R = 0.32, SINK_V = 4.2;
const LOOP_V = 6.2;                    // speed to make it round the loop
const MAX_STROKES = 6;                 // then you pick up, scoring MAX + 1
const SHOT_CLOCK = 7;                  // s, then the stroke is taken for you as a tap
const TALLY = 1.8;
const FIG_SCALE = 0.95;

// ── The holes ────────────────────────────────────────────────────────────────
// Walls are segments [x1, z1, x2, z2] (both faces solid). The rectangle round
// every hole is added by _walls().
const HOLES = [
    {   name: 'THE WINDMILL', par: 2,
        tee: [-7, 0], cup: [7, 0.8],
        // The mill's two halves, solid, with the doorway (the open channel
        // between them) at |z| < 0.55.
        walls: [[-0.6, -0.55, 0.6, -0.55], [-0.6, -0.55, -0.6, -HZ], [0.6, -0.55, 0.6, -HZ],
                [-0.6, 0.55, 0.6, 0.55], [-0.6, 0.55, -0.6, HZ], [0.6, 0.55, 0.6, HZ]],
        windmill: { x: 0 },
        route: [[-7, 0], [-0.9, 0], [0.9, 0], [7, 0.8]],
    },
    {   name: 'THE LOOP', par: 3,
        tee: [-7, -2.2], cup: [7, 1.6],
        walls: [[-1.5, -1.0, 1.5, -1.0], [-1.5, -1.0, -1.5, HZ], [1.5, -1.0, 1.5, HZ]],
        loop: { x0: -1.5, x1: 1.5, zMax: -1.0 },
        route: [[-7, -2.2], [-1.7, -2.1], [1.7, -2.1], [4.2, -1.2], [7, 1.6]],
    },
    {   name: 'THE FOUNTAIN BRIDGE', par: 2,
        tee: [-7, 0], cup: [7, 0],
        walls: [[5.2, -1.4, 5.8, -1.4], [5.2, 1.4, 5.8, 1.4]],
        pond: { x: 0, z: 0, r: 2.5, bridge: 0.55 },
        route: [[-7, 0], [-2.9, 0], [2.9, 0], [7, 0]],
    },
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
        d = Math.abs(d - Math.PI * 1.5);                   // straight down
        if (d < 0.3) return true;
    }
    return false;
}

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _balls = [], _strokes = [[], []], _hole = -1, _turn = 0, _holeGrp = null, _sails = null, _gate = null, _aim = null, _chevrons = [];
let _phase = 'intro', _sub = '', _subT = 0, _t = 0, _clockT = 0, _idle = [0, 0], _bot = [];
let _figs = [];

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _sub = ''; _subT = 0; _t = 0; _hole = -1; _strokes = [[], []]; _idle = [0, 0];
    _bot = [0, 1].map(() => ({ plan: null, wait: 0 }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#a9d4f2;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'side', fov: 38, background: 0xa9d4f2 });
    _hud = sideHud(_stage, { padWidth: 250 });
    _in = touch(_stage, { split: 'x', stick: 90, onRelease: (slot, r) => _release(slot, r) });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _set = STAGE_SETS.ring(_stage, { w: HX * 2 + 2, d: HZ * 2 + 6, lanterns: false });
        _buildAim();
    }
    _balls = [0, 1].map(_buildBall);
    _figs = [0, 1].map(_buildFig);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'DRAG BACK · LET GO'));

    _dir.open({
        place: 'CITY RING ROAD · THE CRAZY GOLF', title: 'MINI GOLF',
        sub: 'THREE HOLES · FEWEST STROKES WINS',
        from: { pos: [10, 7, 14], look: [0, 0, 0] },
        to: _cam(),
        onDone: () => { if (!_done) { _phase = 'play'; _nextHole(); } },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _balls = []; _figs = []; _holeGrp = null; _sails = null; _aim = null; _chevrons = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

function _cam() { return { pos: [0, 15.5, 10.5], look: [0, 0, 0.6] }; }

// ── Building ─────────────────────────────────────────────────────────────────
function _buildBall(slot) {
    const b = { slot, x: 0, z: 0, vx: 0, vz: 0, moving: false, holed: false, loop: null, from: [0, 0], mesh: null };
    if (_stage.gl) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(BR, 18, 14), new THREE.MeshStandardMaterial({ color: seat(slot).color, roughness: 0.3 }));
        m.castShadow = true; _stage.add(m); b.mesh = m;
    }
    return b;
}
function _buildFig(slot) {
    // The two players stand at the near edge, watching, each on their own side.
    const f = { slot };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        c.rig.root.position.set(slot === 0 ? 4.5 : -4.5, 0, HZ + 1.6);
        c.anim.face(Math.PI, true);
        c.anim.play('ready');
        Object.assign(f, { rig: c.rig, anim: c.anim });
    }
    return f;
}
function _buildAim() {
    const g = new THREE.Group();
    for (let i = 0; i < 9; i++) {
        const d = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        d.position.x = i; g.add(d);
    }
    g.visible = false; _stage.add(g); _aim = g;
}

function _buildHole(h) {
    if (!_stage.gl) return;
    if (_holeGrp) { _stage.scene.remove(_holeGrp); _holeGrp.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
    const g = new THREE.Group();
    const felt = new THREE.Mesh(new THREE.BoxGeometry(HX * 2, 0.1, HZ * 2), new THREE.MeshStandardMaterial({ color: 0x2f9e44, roughness: 0.9 }));
    felt.position.y = 0.05; felt.receiveShadow = true; g.add(felt);
    const rail = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.6 });
    const wallMesh = ([x1, z1, x2, z2], mat = rail, h = 0.32) => {
        const len = Math.hypot(x2 - x1, z2 - z1);
        const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.16, h, 0.16), mat);
        m.position.set((x1 + x2) / 2, 0.1 + h / 2, (z1 + z2) / 2);
        m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        m.castShadow = true; g.add(m);
    };
    _walls(h).forEach(w => wallMesh(w));
    // The tee and the cup, with its flag.
    const tee = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.02, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    tee.position.set(h.tee[0], 0.11, h.tee[1]); g.add(tee);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(CUP_R, CUP_R, 0.02, 24), new THREE.MeshBasicMaterial({ color: 0x0b0f0c }));
    cup.position.set(h.cup[0], 0.11, h.cup[1]); g.add(cup);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0xe5e7eb }));
    pole.position.set(h.cup[0], 0.9, h.cup[1]); g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.38), new THREE.MeshStandardMaterial({ color: 0xef4444, side: THREE.DoubleSide }));
    flag.position.set(h.cup[0] + 0.3, 1.5, h.cup[1]); g.add(flag);
    _sails = null; _gate = null; _chevrons = [];
    // The route: glowing chevrons on the felt, tee → obstacle → cup, with a
    // light running along them so "go this way" is unmistakable.
    if (h.route) {
        const shape = new THREE.Shape();
        shape.moveTo(0.22, 0); shape.lineTo(-0.12, 0.2); shape.lineTo(-0.04, 0); shape.lineTo(-0.12, -0.2); shape.closePath();
        const geo = new THREE.ShapeGeometry(shape);
        let n = 0;
        for (let i = 0; i < h.route.length - 1; i++) {
            const [x1, z1] = h.route[i], [x2, z2] = h.route[i + 1];
            const len = Math.hypot(x2 - x1, z2 - z1), ang = Math.atan2(z2 - z1, x2 - x1);
            for (let d = 0.6; d < len - 0.3; d += 0.75) {
                const x = x1 + (x2 - x1) * d / len, z = z1 + (z2 - z1) * d / len;
                if (Math.hypot(x - h.tee[0], z - h.tee[1]) < 0.7 || Math.hypot(x - h.cup[0], z - h.cup[1]) < 0.8) continue;
                if (h.windmill && Math.abs(x) < 0.7) continue;
                if (h.loop && x > h.loop.x0 - 0.1 && x < h.loop.x1 + 0.1) continue;
                const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.5, depthWrite: false }));
                m.rotation.set(-Math.PI / 2, 0, -ang); m.position.set(x, 0.112, z);
                m.userData.k = n++; g.add(m); _chevrons.push(m);
            }
        }
    }
    if (h.windmill) {
        // Two solid halves either side of an open channel: from above, the
        // doorway is the gap in the middle of the mill.
        const brick = new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.75 });
        const trim = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.6 });
        [-1, 1].forEach(sd => {
            const half = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, HZ - 0.55), brick);
            half.position.set(0, 1.3, sd * (0.55 + (HZ - 0.55) / 2)); half.castShadow = true; g.add(half);
            const cap = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.14, HZ - 0.45), trim);
            cap.position.set(0, 2.55, sd * (0.55 + (HZ - 0.55) / 2)); g.add(cap);
            // Doorposts, white, so the opening is framed.
            const post = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.1, 0.12), trim);
            post.position.set(0, 0.65, sd * 0.61); g.add(post);
        });
        // The cap and the sail hub over the doorway.
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.4), brick);
        lintel.position.set(0, 2.3, 0); lintel.castShadow = true; g.add(lintel);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.3, 4), new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.8 }));
        roof.position.set(0, 3.2, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
        _sails = new THREE.Group();
        const sailM = new THREE.MeshStandardMaterial({ color: 0xfefce8, roughness: 0.6, side: THREE.DoubleSide });
        for (let k = 0; k < 4; k++) {
            const arm = new THREE.Group();
            const spar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.15, 0.06), new THREE.MeshStandardMaterial({ color: 0x78350f }));
            spar.position.y = 1.07; arm.add(spar);
            const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 1.6), sailM);
            cloth.position.set(0.26, 1.25, 0.02); arm.add(cloth);
            arm.rotation.z = k * Math.PI / 2; _sails.add(arm);
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0x3f2a1a }));
        hub.rotation.x = Math.PI / 2; _sails.add(hub);
        // Turning on the players' side of the doorway: a blade swung down is
        // visibly across the way through, which is exactly when it is shut.
        _sails.position.set(0, 2.3, 0.78);
        g.add(_sails);
        _gate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 1.1), new THREE.MeshStandardMaterial({ color: 0xfde047, emissive: 0x7a5d00, emissiveIntensity: 0.5 }));
        _gate.position.set(0, 0.28, 0); g.add(_gate);
    }
    if (h.loop) {
        // A real loop-the-loop: two rails the ball rides up, over and down, with
        // a sideways drift so the way out passes the way in.
        const rails = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.3, metalness: 0.5 });
        [-0.2, 0.2].forEach(off => {
            const pts = [];
            for (let i = 0; i <= 64; i++) { const p = _loopPoint(1, i / 64); pts.push(new THREE.Vector3(p.x, p.y + BR * 0.2, p.z + off)); }
            const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.06, 8, false), rails);
            tube.castShadow = true; g.add(tube);
        });
        // Struts to the ground, so it stands.
        [[-0.75, -2.35], [0.75, -1.85]].forEach(([x, z]) => {
            const st = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), new THREE.MeshStandardMaterial({ color: 0x94a3b8 }));
            st.position.set(x, 0.55, z); g.add(st);
        });
        // The hedge that closes the rest of the hole, so the loop is the way.
        const hedge = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.7, HZ + 1.0), new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 1 }));
        hedge.position.set(0, 0.45, (HZ - 1.0) / 2); hedge.castShadow = true; g.add(hedge);
        for (let i = 0; i < 9; i++) {
            const bush = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x15803d : 0x22883f, roughness: 1 }));
            bush.position.set(-1.1 + (i % 3) * 1.1, 0.85, -0.6 + Math.floor(i / 3) * 1.4); g.add(bush);
        }
    }
    if (h.pond) {
        const water = new THREE.Mesh(new THREE.CircleGeometry(h.pond.r, 40), new THREE.MeshStandardMaterial({ color: 0x38a3e8, emissive: 0x0b4f7a, emissiveIntensity: 0.4, roughness: 0.1 }));
        water.rotation.x = -Math.PI / 2; water.position.set(h.pond.x, 0.105, h.pond.z); g.add(water);
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(h.pond.r * 2 + 0.4, 0.06, h.pond.bridge * 2), new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.8 }));
        bridge.position.set(h.pond.x, 0.13, h.pond.z); g.add(bridge);
        const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0xcfd6dd }));
        spout.position.set(0, 0.7, 1.6); g.add(spout);
    }
    _stage.add(g);
    _holeGrp = g;
}

// The loop's path, u 0..1, for a ball heading dir (±1): along the lane to the
// bottom of the loop, round it, and on out the other side.
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
        const segs = h.windmill && _gapShut(t) ? [...walls, [0, -0.55, 0, 0.55]] : walls;
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
        // The loop: a lane along the bottom edge through the block.
        if (h.loop && b.z < h.loop.zMax && b.x > h.loop.x0 && b.x < h.loop.x1 && !b.looped) {
            b.looped = true;
            if (Math.abs(b.vx) >= LOOP_V) return 'loop';
            // Not enough: back out of the entrance it came in by (after the
            // reversal, a ball now heading -x came in from the left).
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
    const ns = Math.max(0, s2 - (DECEL + DRAG * s2) * dt);
    if (ns < STOP_V) { b.vx = 0; b.vz = 0; } else { b.vx *= ns / s2; b.vz *= ns / s2; }
    return null;
}

// ── Holes and turns ──────────────────────────────────────────────────────────
function _nextHole() {
    _hole++;
    if (_hole >= HOLES.length) { _end(); return; }
    const h = HOLES[_hole];
    _buildHole(h);
    _balls.forEach((b, i) => Object.assign(b, { x: h.tee[0], z: h.tee[1] + (i === 0 ? 0.35 : -0.35), vx: 0, vz: 0, holed: false, loop: null, looped: false }));
    _strokes.forEach(s => s.push(0));
    _idle = [0, 0];
    // Whoever is behind tees off first; P1 on the first hole.
    const tot = _totals();
    _turn = _hole === 0 ? 0 : tot[0] > tot[1] ? 0 : tot[1] > tot[0] ? 1 : _hole % 2;
    _hud.say(`HOLE ${_hole + 1} · ${h.name}`, `PAR ${h.par}`, 1600, _t, '#fde047');
    _sub = 'intro'; _subT = 0;
}
const _totals = () => _strokes.map(s => s.reduce((a, b) => a + b, 0));

function _beginTurn() {
    _sub = 'aim'; _subT = 0; _clockT = 0;
    _hud.lit(_turn, true, 'rgba(253,224,71,.35)'); _hud.lit(1 - _turn, false);
    _bot[_turn].plan = null; _bot[_turn].wait = 0.8 + Math.random() * 0.6;
    _figs[_turn]?.anim?.play('aim');
    _figs[1 - _turn]?.anim?.play('ready');
}

function _release(slot, r) {
    if (_phase !== 'play' || _sub !== 'aim' || slot !== _turn || isBotSlot(slot) || !r.moved) return;
    const p = Math.min(1, Math.hypot(r.dx, r.dy));
    if (p < 0.08) return;
    _shoot(slot, -r.dx / Math.hypot(r.dx, r.dy), -r.dy / Math.hypot(r.dx, r.dy), p);
}

function _shoot(slot, dx, dz, power) {
    const b = _balls[slot];
    b.from = [b.x, b.z];
    b.vx = dx * power * MAXV; b.vz = dz * power * MAXV; b.looped = false;
    _strokes[slot][_hole]++;
    _idle[slot] = 0;
    sfx('slam'); haptic([12]);
    _figs[slot]?.anim?.play('shove', { restart: true });
    _sub = 'roll'; _subT = 0;
    if (_aim) _aim.visible = false;
    _hud.lit(0, false); _hud.lit(1, false);
}

function _afterRoll() {
    // Picked up at the maximum.
    _balls.forEach(b => { if (!b.holed && _strokes[b.slot][_hole] >= MAX_STROKES) { b.holed = true; _strokes[b.slot][_hole] = MAX_STROKES + 1; if (b.mesh) b.mesh.visible = false; _hud.say('PICKED UP', seat(b.slot).name, 900, _t); } });
    const left = _balls.filter(b => !b.holed);
    if (!left.length) { _sub = 'tally'; _subT = 0; const s = _strokes.map(x => x[_hole]); _hud.say(`${seat(0).name} ${s[0]} · ${seat(1).name} ${s[1]}`, `HOLE ${_hole + 1} DONE`, TALLY * 1000, _t, '#fde047'); return; }
    // Alternate, skipping anyone who is down.
    _turn = left.find(b => b.slot === 1 - _turn) ? 1 - _turn : left[0].slot;
    _beginTurn();
}

// ── Bot (§5): try shots ahead in the physics, keep the best, then miss a bit ─
function _botPlan(slot) {
    const h = HOLES[_hole], walls = _walls(h), b = _balls[slot];
    const direct = Math.atan2(h.cup[1] - b.z, h.cup[0] - b.x);
    let best = null;
    const tries = 26 + Math.round(_botSkill * 40);
    for (let k = 0; k < tries; k++) {
        const a = direct + (Math.random() - 0.5) * (k < tries / 2 ? 0.9 : 2.6);
        const p = 0.25 + Math.random() * 0.75;
        const sim = { x: b.x, z: b.z, vx: Math.cos(a) * p * MAXV, vz: Math.sin(a) * p * MAXV };
        let t = _t, res = null, score;
        for (let i = 0; i < 90 && Math.hypot(sim.vx, sim.vz) > 0; i++) {
            res = _step(sim, 1 / 30, t, h, walls); t += 1 / 30;
            if (res === 'loop') { sim.x = h.loop.x1 + 0.35; sim.vx = Math.abs(sim.vx) * 0.72 * Math.sign(sim.vx || 1); res = null; }
            if (res === 'cup' || res === 'water') break;
        }
        score = res === 'cup' ? -100 : res === 'water' ? 60 : Math.hypot(sim.x - h.cup[0], sim.z - h.cup[1]);
        if (!best || score < best.score) best = { a, p, score };
    }
    // Hands shake: aim and weight both off by skill.
    const err = 1 - _botSkill;
    return { a: best.a + (Math.random() - 0.5) * err * 0.35, p: Math.min(1, best.p * (1 + (Math.random() - 0.5) * err * 0.35)) };
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt; _subT += dt;
    _hud.tick(_t);
    const h = HOLES[Math.max(0, _hole)];

    if (_phase === 'play' && _hole < HOLES.length) {
        if (_sub === 'intro' && _subT > 1.6) _beginTurn();
        else if (_sub === 'aim') {
            _clockT += dt;
            const s = _in.seat(_turn);
            if (isBotSlot(_turn)) {
                const bb = _bot[_turn];
                bb.wait -= dt;
                if (bb.wait <= 0) { const pl = _botPlan(_turn); _shoot(_turn, Math.cos(pl.a), Math.sin(pl.a), pl.p); }
            } else if (_aim && s.down && s.moved) {
                // The aim line: from the ball, opposite the pull, as long as the pull.
                const b = _balls[_turn], m = Math.min(1, Math.hypot(s.dx, s.dy));
                _aim.visible = true;
                _aim.position.set(b.x, 0.22, b.z);
                _aim.rotation.y = -Math.atan2(-s.dy, -s.dx);
                _aim.children.forEach((d, i) => { d.position.x = 0.35 + i * 0.32 * (0.4 + m * 1.6); d.material.color.setHex(m > 0.85 ? 0xff6b6b : 0xffffff); });
            } else if (_aim) _aim.visible = false;
            if (_clockT >= SHOT_CLOCK && !isBotSlot(_turn)) {
                // Out of time: the stroke counts, and twice in a hole picks you up.
                _idle[_turn]++;
                _strokes[_turn][_hole] = Math.min(MAX_STROKES, _strokes[_turn][_hole] + 1);
                if (_idle[_turn] >= 2) _strokes[_turn][_hole] = MAX_STROKES;
                _hud.say('TIME!', `${seat(_turn).name} · STROKE LOST`, 900, _t, '#fca5a5');
                if (_aim) _aim.visible = false;
                _afterRoll();
            }
        } else if (_sub === 'roll') {
            const walls = _walls(h);
            _balls.forEach(b => {
                if (b.holed) return;
                if (b.loop) {
                    b.loop.t += dt;
                    if (b.loop.t >= b.loop.dur) {
                        const s = b.loop.dir;
                        b.x = s > 0 ? h.loop.x1 + 0.35 : h.loop.x0 - 0.35; b.z = LOOP_Z + 0.3 * s; b.vx = s * b.loop.v * 0.72; b.vz = 0; b.loop = null;
                    }
                    return;
                }
                const res = _step(b, dt, _t, h, walls);
                if (b.hit > 1.5) { sfx('land_good'); } b.hit = 0;
                if (res === 'cup') {
                    b.holed = true; b.vx = b.vz = 0; b.x = h.cup[0]; b.z = h.cup[1];
                    sfx('mg_win'); haptic([40]);
                    if (_stage?.gl) _fx.confetti(new THREE.Vector3(b.x, 0.5, b.z), [seat(b.slot).color, 0xffffff, 0xfde047], 22, 2.5);
                    const n = _strokes[b.slot][_hole];
                    _hud.say(n === 1 ? 'HOLE IN ONE!' : n < h.par ? 'BIRDIE!' : n === h.par ? 'PAR' : 'IN!', seat(b.slot).name, 1100, _t, seat(b.slot).css);
                    _figs[b.slot]?.anim?.play('victory');
                } else if (res === 'water') {
                    _strokes[b.slot][_hole]++;
                    sfx('boom');
                    if (_stage?.gl) _fx.puff(new THREE.Vector3(b.x, 0.3, b.z), 0x7dd3fc, 8, 0.4, 0.8);
                    _hud.say('SPLASH!', 'ONE STROKE · BACK WHERE YOU HIT FROM', 1000, _t, '#38bdf8');
                    b.x = b.from[0]; b.z = b.from[1]; b.vx = b.vz = 0;
                } else if (res === 'loop') {
                    b.loop = { t: 0, dur: 1.1, v: Math.abs(b.vx), dir: Math.sign(b.vx) || 1 }; sfx('boost');
                } else if (res === 'fail') sfx('land_bad');
            });
            // Ball on ball.
            const [p, q] = _balls;
            if (!p.holed && !q.holed && !p.loop && !q.loop) {
                const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
                if (d < BR * 2 && d > 1e-5) {
                    const nx = dx / d, nz = dz / d, over = BR * 2 - d;
                    p.x -= nx * over / 2; p.z -= nz * over / 2; q.x += nx * over / 2; q.z += nz * over / 2;
                    const rel = (p.vx - q.vx) * nx + (p.vz - q.vz) * nz;
                    if (rel > 0) { p.vx -= rel * nx; p.vz -= rel * nz; q.vx += rel * nx; q.vz += rel * nz; sfx('land_good'); }
                }
            }
            if (_balls.every(b => b.holed || (!b.loop && b.vx === 0 && b.vz === 0))) _afterRoll();
        } else if (_sub === 'tally' && _subT >= TALLY) _nextHole();
    }

    // Draw.
    _balls.forEach(b => {
        if (!b.mesh) return;
        if (b.loop) {
            const p = _loopPoint(b.loop.dir, Math.min(1, b.loop.t / b.loop.dur));
            b.mesh.position.set(p.x, p.y + BR, p.z);
        } else b.mesh.position.set(b.x, b.holed ? -0.1 : 0.1 + BR, b.z);
        b.mesh.visible = !(b.holed && _strokes[b.slot][_hole] > MAX_STROKES);
    });
    // Arm k points at angle a + k·90° once the group is turned a − 90°, which is
    // the angle _gapShut tests against straight down.
    if (_sails) _sails.rotation.z = _sailAngle(_t) - Math.PI / 2;
    _chevrons.forEach(c => { c.material.opacity = 0.28 + 0.6 * Math.max(0, Math.sin(c.userData.k * 0.55 - _t * 4)); });
    if (_gate) _gate.visible = _gapShut(_t);
    _set?.update?.(dt, _t);
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!dirOwns && _stage?.gl && _phase !== 'over') {
        const c = _cam();
        _stage.camera.position.fromArray(c.pos);
        _stage.camera.lookAt(...c.look);
    }
    _renderHud();
}

function _renderHud() {
    if (!_hud || _hole < 0) return;
    const tot = _totals();
    const hl = Math.min(_hole, HOLES.length - 1);
    const shot = _sub === 'aim' && !isBotSlot(_turn) ? ` · ${Math.max(0, Math.ceil(SHOT_CLOCK - _clockT))}s` : '';
    _hud.bar(`<span style="color:${seat(1).css}">${seat(1).name} ${tot[1]}</span>` +
        `<span>⛳ ${hl + 1}/${HOLES.length} · ${_sub === 'aim' ? seat(_turn).name + '’S SHOT' : HOLES[hl].name}${shot}</span>` +
        `<span style="color:${seat(0).css}">${tot[0]} ${seat(0).name}</span>`);
    [0, 1].forEach(slot => { if (_hole > 0 || _strokes[slot][0] > 0) _hud.hint(slot, _sub === 'aim' && _turn === slot ? 'YOUR SHOT' : ''); });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `HOLE ${hl + 1} · ${seat(0).name} ${tot[0]} – ${tot[1]} ${seat(1).name}`;
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    const tot = _totals();
    const w = tot[0] < tot[1] ? 0 : tot[1] < tot[0] ? 1 : -1;
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? `${tot[0]} STROKES APIECE` : `${tot[w]} STROKES TO ${tot[1 - w]}`,
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, sub: _sub, hole: _hole, turn: _turn, strokes: _strokes.map(s => [...s]), totals: _totals(),
             balls: _balls.map(b => ({ x: +b.x.toFixed(2), z: +b.z.toFixed(2), v: +Math.hypot(b.vx, b.vz).toFixed(2), holed: b.holed, loop: !!b.loop })),
             cup: _hole >= 0 && _hole < HOLES.length ? HOLES[_hole].cup : null, gapShut: _gapShut(_t),
             gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: move a ball, or jump to a hole. */
export function _debugBall(slot, x, z) { const b = _balls[slot]; if (b) Object.assign(b, { x, z, vx: 0, vz: 0 }); }
export function _debugShoot(slot, dx, dz, p) { _shoot(slot, dx, dz, p); }
export function _debugHole(i) { _hole = i - 1; _strokes.forEach(s => { while (s.length < i) s.push(0); }); _nextHole(); }
