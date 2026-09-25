// ============================================================
// BOWLING — the neon lanes in the Back Alley.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Face-off hold, SPLIT SCREEN. Two lanes side by side down the length of the
// phone. Each player bowls down their own lane toward the far end, both at
// once, and each half is that player's own camera behind their ball.
//
//   FLICK up your half toward the pins to bowl. The speed of the flick is the
//   pace of the ball; a curve in the flick puts hook on it.
//
// The pins are real bodies in the physics and fall however they are hit.
// Two frames each, scored properly: a strike or a spare in the last frame
// earns its bonus balls. Most pins scored wins.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const FRAMES = 2;
const LANE_X = [1.45, -1.45];          // P1's lane, P2's lane
const DIR = [-1, 1];                   // which way each lane rolls (z)
const HALF = 0.9;                      // lane half-width
const GUTTER = 1.17;                   // |x - lane| of a gutter ball's track
const FOUL = 7.5;                      // |z| of the foul line
const HEAD = 5.2;                      // |z| of the head pin
const ROW = 0.45, SPACING = 0.52;      // rack geometry
const PIN_R = 0.12, PIN_H = 0.62, BALL_R = 0.21;
const VMIN = 6.2, VMAX = 13.5;       // launch; a rolling ball keeps ~5/7 of it
const HOOK = 2.6;                      // lateral accel at full spin, after the skid
const AIM_MAX = 0.12;                  // rad either side
const SHOT_CLOCK = 9;
const SETTLE = 1.4;
const FIG_SCALE = 0.95;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _dir = null, _hud = null, _in = null, _fx = null;
let _world = null, _pinMat = null, _lanes = [], _cams = [], _figs = [];
let _phase = 'intro', _phaseT = 0, _t = 0;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0;
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#140a24;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 50, background: 0x140a24 });
    _hud = faceoffHud(_stage, { bg: 'rgba(20,10,36,.78)' });
    _in = touch(_stage, { split: 'y', stick: 140, onDown: slot => { _lanes[slot] && (_lanes[slot].path = []); },
                          onRelease: (slot, r) => _release(slot, r) });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    _world = typeof CANNON !== 'undefined' ? _buildWorld() : null;
    if (_stage.gl) {
        _buildAlley();
        _cams = [0, 1].map(slot => {
            const c = new THREE.PerspectiveCamera(56, 1, 0.1, 80);
            c.up.set(0, slot === 0 ? 1 : -1, 0);     // the far half reads from its own end
            return c;
        });
    }
    _lanes = [0, 1].map(_buildLane);
    _figs = [0, 1].map(_buildFig);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'FLICK UP TO BOWL · CURVE IT TO HOOK'));

    _dir.open({
        place: 'BACK ALLEY · THE NEON LANES', title: 'BOWLING',
        sub: 'TWO FRAMES · MOST PINS WINS',
        from: { pos: [5, 7, 10], look: [0, 0, 0] },
        to: { pos: [0, 16, 1], look: [0, 0, 0] },
        onDone: () => { if (!_done) _enter('play'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.views = null; _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _world = null; _lanes = []; _cams = []; _figs = []; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── Physics ──────────────────────────────────────────────────────────────────
function _buildWorld() {
    const w = new CANNON.World();
    w.gravity.set(0, -9.8, 0);
    w.broadphase = new CANNON.NaiveBroadphase();
    w.solver.iterations = 12;
    _pinMat = new CANNON.Material('pin');
    const laneMat = new CANNON.Material('lane'), ballMat = new CANNON.Material('ball');
    w.addContactMaterial(new CANNON.ContactMaterial(_pinMat, _pinMat, { friction: 0.2, restitution: 0.6 }));
    w.addContactMaterial(new CANNON.ContactMaterial(_pinMat, laneMat, { friction: 0.35, restitution: 0.2 }));
    w.addContactMaterial(new CANNON.ContactMaterial(ballMat, _pinMat, { friction: 0.1, restitution: 0.55 }));
    w.addContactMaterial(new CANNON.ContactMaterial(ballMat, laneMat, { friction: 0.02, restitution: 0.1 }));
    const floor = new CANNON.Body({ mass: 0, material: laneMat });
    floor.addShape(new CANNON.Plane());
    floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    w.addBody(floor);
    // Back walls behind each deck, and a divider between the lanes.
    [0, 1].forEach(i => {
        const back = new CANNON.Body({ mass: 0, material: laneMat });
        back.addShape(new CANNON.Box(new CANNON.Vec3(HALF + 0.6, 0.8, 0.2)));
        back.position.set(LANE_X[i], 0.8, DIR[i] * (HEAD + 2.2));
        w.addBody(back);
    });
    const div = new CANNON.Body({ mass: 0, material: laneMat });
    div.addShape(new CANNON.Box(new CANNON.Vec3(0.08, 0.4, FOUL + 1)));
    div.position.set(0, 0.4, 0);
    w.addBody(div);
    w._ballMat = ballMat;
    return w;
}

// ── The alley ────────────────────────────────────────────────────────────────
function _buildAlley() {
    const scene = _stage.scene;
    scene.fog = new THREE.Fog(0x140a24, 14, 34);
    scene.add(new THREE.HemisphereLight(0xb7a2ff, 0x1a0b2e, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.8); key.position.set(3, 12, 4); key.castShadow = true;
    const sc = key.shadow.camera; sc.left = -6; sc.right = 6; sc.top = 10; sc.bottom = -10; scene.add(key);
    [1, -1].forEach(s => { const p = new THREE.PointLight(0xff4fd8, 0.9, 16); p.position.set(0, 3, s * (HEAD + 0.8)); scene.add(p); });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 40), new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; scene.add(floor);
    const wood = new THREE.MeshStandardMaterial({ color: 0xd9a05b, roughness: 0.25, metalness: 0.05 });
    const gut = new THREE.MeshStandardMaterial({ color: 0x2a2440, roughness: 0.4, metalness: 0.4 });
    const neon = [0x22d3ee, 0xff4fd8];
    [0, 1].forEach(i => {
        const lane = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, 0.02, (FOUL + HEAD + 2)), wood);
        lane.position.set(LANE_X[i], 0.0, 0); lane.receiveShadow = true; _stage.add(lane);
        [-1, 1].forEach(s => {
            const g = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.015, FOUL + HEAD + 2), gut);
            g.position.set(LANE_X[i] + s * (HALF + 0.15), -0.005, 0); _stage.add(g);
            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, FOUL + HEAD + 2), new THREE.MeshBasicMaterial({ color: neon[i] }));
            strip.position.set(LANE_X[i] + s * (HALF + 0.32), 0.03, 0); _stage.add(strip);
        });
        // Aiming arrows, a third of the way down, and the foul line.
        for (let k = -2; k <= 2; k++) {
            const a = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 3), new THREE.MeshBasicMaterial({ color: 0x7c2d12 }));
            a.rotation.x = DIR[i] * -Math.PI / 2; a.position.set(LANE_X[i] + k * 0.3, 0.02, DIR[i] * -(FOUL - 4.2) - DIR[i] * Math.abs(k) * 0.3); _stage.add(a);
        }
        const foul = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.6, 0.012, 0.06), new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
        foul.position.set(LANE_X[i], 0.02, -DIR[i] * FOUL); _stage.add(foul);
        // The pit's back wall, lit.
        const back = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 1.2, 1.6, 0.4), new THREE.MeshStandardMaterial({ color: 0x0d0718, emissive: neon[i], emissiveIntensity: 0.15 }));
        back.position.set(LANE_X[i], 0.8, DIR[i] * (HEAD + 2.2)); _stage.add(back);
    });
    const div = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, (FOUL + 1) * 2), new THREE.MeshStandardMaterial({ color: 0x2a2440 }));
    div.position.set(0, 0.25, 0); _stage.add(div);
}

function _pinSpots(i) {
    const out = [];
    for (let r = 0; r < 4; r++) for (let k = 0; k <= r; k++) {
        out.push({ x: LANE_X[i] + (k - r / 2) * SPACING, z: DIR[i] * (HEAD + r * ROW) });
    }
    return out;
}

function _makePin(x, z) {
    const p = { x0: x, z0: z, body: null, mesh: null, down: false, gone: false };
    if (_world) {
        // Arcade pins: a touch lighter and livelier than the real thing, so they
        // scatter into each other.
        const b = new CANNON.Body({ mass: 1.0, material: _pinMat, linearDamping: 0.05, angularDamping: 0.1 });
        const cyl = new CANNON.Cylinder(PIN_R, PIN_R * 0.75, PIN_H, 10);
        const q = new CANNON.Quaternion(); q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);   // cannon's cylinder runs along z
        b.addShape(cyl, new CANNON.Vec3(0, 0, 0), q);
        b.position.set(x, PIN_H / 2 + 0.01, z);
        _world.addBody(b); p.body = b;
    }
    if (_stage.gl) {
        const g = new THREE.Group();
        const white = new THREE.MeshStandardMaterial({ color: 0xf8f8f8, roughness: 0.3 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(PIN_R * 0.85, PIN_R * 0.8, PIN_H * 0.62, 12), white); body.position.y = -PIN_H * 0.12; g.add(body);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(PIN_R * 0.45, PIN_R * 0.8, PIN_H * 0.25, 12), white); neck.position.y = PIN_H * 0.3; g.add(neck);
        const head = new THREE.Mesh(new THREE.SphereGeometry(PIN_R * 0.55, 12, 10), white); head.position.y = PIN_H * 0.45; g.add(head);
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(PIN_R * 0.52, PIN_R * 0.56, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0xef4444 })); stripe.position.y = PIN_H * 0.27; g.add(stripe);
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        _stage.add(g); p.mesh = g;
    }
    return p;
}

function _buildLane(i) {
    const L = { i, pins: [], ball: null, sub: 'wait', subT: 0, clock: 0, frame: 0, rolls: [], frames: [], path: [], bot: { wait: 0 },
                gutter: false, hook: 0, released: 0, bonus: 0, lastDown: 0, msg: '' };
    _rack(L, true);
    // The ball.
    const b = { body: null, mesh: null };
    if (_world) {
        b.body = new CANNON.Body({ mass: 8, material: _world._ballMat, linearDamping: 0.01, angularDamping: 0.01 });
        b.body.addShape(new CANNON.Sphere(BALL_R));
        _world.addBody(b.body);
    }
    if (_stage.gl) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 16), new THREE.MeshStandardMaterial({ color: seat(i).color, roughness: 0.15, metalness: 0.35 }));
        m.castShadow = true; _stage.add(m); b.mesh = m;
    }
    L.ball = b;
    _placeBall(L);
    return L;
}
function _placeBall(L) {
    const b = L.ball.body;
    L.gutter = false; L.hook = 0;
    if (!b) return;
    b.position.set(LANE_X[L.i], BALL_R + 0.01, -DIR[L.i] * (FOUL - 0.4));
    b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
    b.sleep && b.wakeUp && b.wakeUp();
}
function _rack(L, full) {
    // Full rack: all ten, fresh. Otherwise the pinsetter sweeps away the fallen.
    if (full) {
        L.pins.forEach(p => _removePin(p));
        L.pins = _pinSpots(L.i).map(s => _makePin(s.x, s.z));
    } else {
        L.pins.filter(p => p.down).forEach(p => { _removePin(p); p.gone = true; });
        L.pins = L.pins.filter(p => !p.gone);
    }
}
function _removePin(p) {
    if (p.body && _world) _world.removeBody(p.body);
    if (p.mesh && _stage?.scene) { _stage.scene.remove(p.mesh); p.mesh.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
}
function _isDown(p) {
    if (!p.body) return p.down;
    const b = p.body, q = b.quaternion;
    // The pin's own up axis, in the world: y of (0, 1, 0) rotated by q.
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    return upY < 0.75 || b.position.y < 0 || Math.hypot(b.position.x - p.x0, b.position.z - p.z0) > 0.35;
}

// ── Bowling a ball ───────────────────────────────────────────────────────────
function _release(slot, r) {
    const L = _lanes[slot];
    if (!L || L.sub !== 'aim' || isBotSlot(slot) || !r.moved) return;
    // Flick direction in world terms, from each player's own end.
    const lat = slot === 0 ? r.dx : -r.dx, fwd = slot === 0 ? -r.dy : r.dy;
    if (fwd < 0.2) return;                                   // not toward the pins
    const pxLen = Math.hypot(r.dx, r.dy) * 140;
    const pace = Math.max(0, Math.min(1, (pxLen / Math.max(0.06, r.held) - 250) / 1100));
    // Curve: how far the path bowed off the straight line, and which way.
    let spin = 0;
    const path = L.path;
    if (path.length > 3) {
        const [ex, ey] = [r.dx, r.dy], len = Math.hypot(ex, ey) || 1;
        let best = 0;
        path.forEach(([x, y]) => { const d = (x * ey - y * ex) / len; if (Math.abs(d) > Math.abs(best)) best = d; });
        spin = Math.max(-1, Math.min(1, best / 0.25)) * (slot === 0 ? 1 : -1);
    }
    _bowl(L, Math.atan2(lat, fwd), pace, spin);
}

function _bowl(L, aim, pace, spin) {
    const a = Math.max(-AIM_MAX, Math.min(AIM_MAX, aim));
    const v = VMIN + (VMAX - VMIN) * pace;
    const b = L.ball.body;
    if (b) b.velocity.set(Math.sin(a) * v, 0, DIR[L.i] * Math.cos(a) * v);
    L.hook = -spin;                  // a curve to the right bows left: the ball hooks back across
    L.sub = 'roll'; L.subT = 0; L.released = v;
    sfx('slam'); haptic([15]);
    _figs[L.i]?.anim?.play('shove', { restart: true });
}

// ── Scoring ──────────────────────────────────────────────────────────────────
// rolls: the pins down on each ball, in order; score it as a real card would.
function _score(rolls) {
    let s = 0, r = 0;
    for (let f = 0; f < FRAMES && r < rolls.length; f++) {
        if (rolls[r] === 10) { s += 10 + (rolls[r + 1] || 0) + (rolls[r + 2] || 0); r += 1; }
        else if ((rolls[r] || 0) + (rolls[r + 1] || 0) === 10) { s += 10 + (rolls[r + 2] || 0); r += 2; }
        else { s += (rolls[r] || 0) + (rolls[r + 1] || 0); r += 2; }
    }
    return s;
}
// After a ball: what comes next on this lane.
function _afterBall(L, down) {
    L.rolls.push(down);
    const inFrame = L.frameRolls = (L.frameRolls || []);
    inFrame.push(down);
    const last = L.frame === FRAMES - 1;
    const tot = inFrame.slice(0, 2).reduce((a, b) => a + b, 0);
    let msg = down === 0 ? 'GUTTER' : `${down}`;
    if (inFrame.length === 1 && down === 10) msg = 'STRIKE!';
    else if (inFrame.length === 2 && inFrame[0] < 10 && tot === 10) msg = 'SPARE!';
    L.msg = msg;
    if (msg === 'STRIKE!' || msg === 'SPARE!') { sfx('mg_win'); haptic([30, 20, 30]); if (_stage?.gl) _fx.confetti(new THREE.Vector3(LANE_X[L.i], 0.6, DIR[L.i] * HEAD), [seat(L.i).color, 0xff4fd8, 0x22d3ee], 22, 2.5); }
    else sfx(down >= 7 ? 'land_good' : 'land_bad');
    if (!last) {
        if (down === 10 || inFrame.length === 2) return _nextFrame(L);
        _rack(L, false); return _nextBall(L);
    }
    // The last frame: a strike or a spare earns more balls (three at most),
    // with a fresh rack whenever the deck has just been cleared.
    const f = inFrame, n = f.length;
    if (n === 1) { _rack(L, f[0] === 10); return _nextBall(L); }
    if (n === 2) {
        if (f[0] === 10) { _rack(L, f[1] === 10); return _nextBall(L); }
        if (f[0] + f[1] === 10) { _rack(L, true); return _nextBall(L); }
    }
    return _laneDone(L);
}
function _nextFrame(L) {
    L.frame++; L.frameRolls = [];
    if (L.frame >= FRAMES) return _laneDone(L);
    _rack(L, true);
    _nextBall(L);
}
function _nextBall(L) { _placeBall(L); L.sub = 'aim'; L.subT = 0; L.clock = 0; L.bot.wait = 0.9 + Math.random() * 0.8; L.path = []; }
function _laneDone(L) {
    L.sub = 'done'; L.subT = 0;
    // Off the lane for good: out of the physics (a body parked under the floor
    // plane would be shoved back up through it) and out of sight.
    if (L.ball.body && _world) { _world.removeBody(L.ball.body); L.ball.body = null; }
    if (L.ball.mesh) L.ball.mesh.visible = false;
}

// ── Bot (§5): the pocket first, the biggest cluster after ────────────────────
function _botBowl(L) {
    const standing = L.pins.filter(p => !p.down);
    let tx = LANE_X[L.i] + (L.i === 0 ? 0.13 : -0.13);           // the pocket
    if (standing.length && standing.length < 10) tx = standing.reduce((a, p) => a + p.x0, 0) / standing.length;
    const dist = FOUL + HEAD;
    const noise = 1 - _botSkill;
    // World-space aim: _bowl turns the angle into world x velocity for either lane.
    // Even a hard bot's hand wobbles: pocket hits, not a perfect game every time.
    const aim = Math.atan2(tx - LANE_X[L.i], dist) + (Math.random() - 0.5) * (0.025 + noise * 0.12);
    _bowl(L, aim, 0.55 + _botSkill * 0.4 + (Math.random() - 0.5) * noise * 0.3, (Math.random() - 0.5) * noise * 0.4);
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'play') {
        if (_stage?.gl) _stage.views = [0, 1].map(slot => ({ camera: _cams[slot], rect: slot === 0 ? [0, 0, 1, 0.5] : [0, 0.5, 1, 0.5] }));
        _lanes.forEach(L => _nextBall(L));
        _hud.say('FRAME 1', 'FLICK UP TO BOWL', 1300, _t, '#ff4fd8');
        sfx('go');
    }
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);

    if (_phase === 'play') {
        _lanes.forEach(L => {
            L.subT += dt;
            if (L.sub === 'aim') {
                L.clock += dt;
                const s = _in.seat(L.i);
                if (s.down) L.path.push([s.dx, s.dy]);
                if (isBotSlot(L.i)) { L.bot.wait -= dt; if (L.bot.wait <= 0) _botBowl(L); }
                else if (L.clock >= SHOT_CLOCK) { L.msg = 'TIME · FOUL'; _afterBall(L, 0); }
            } else if (L.sub === 'roll') {
                const b = L.ball.body;
                if (b) {
                    const travelled = Math.abs(b.position.z + DIR[L.i] * FOUL);
                    // The hook bites once the skid is over, a third of the way down.
                    if (!L.gutter && travelled > (FOUL + HEAD) * 0.33) b.velocity.x += L.hook * HOOK * dt;
                    // Off the edge: into the gutter, and it stays there.
                    if (!L.gutter && Math.abs(b.position.x - LANE_X[L.i]) > HALF - 0.04 && DIR[L.i] * b.position.z < HEAD - 0.3) {
                        L.gutter = true; sfx('land_bad');
                    }
                    if (L.gutter) { b.position.x = LANE_X[L.i] + Math.sign(b.position.x - LANE_X[L.i]) * GUTTER; b.velocity.x = 0; }
                    const past = DIR[L.i] * b.position.z > HEAD + 1.8;
                    if (past || b.velocity.length() < 0.25 || L.subT > 7) { L.sub = 'settle'; L.subT = 0; }
                }
            } else if (L.sub === 'settle' && L.subT >= SETTLE) {
                const before = L.pins.filter(p => p.down).length;
                L.pins.forEach(p => { p.down = p.down || _isDown(p); });
                const down = L.pins.filter(p => p.down).length - before;
                _afterBall(L, Math.max(0, down));
            }
        });
        if (_world) _world.step(1 / 60, dt, 8);
        if (_lanes.every(L => L.sub === 'done')) _end();
    }

    // Draw: pins and balls follow their bodies.
    _lanes.forEach(L => {
        L.pins.forEach(p => { if (p.mesh && p.body) { p.mesh.position.copy(p.body.position); p.mesh.quaternion.copy(p.body.quaternion); } });
        const b = L.ball;
        if (b.mesh && b.body) { b.mesh.position.copy(b.body.position); b.mesh.quaternion.copy(b.body.quaternion); }
        const cam = _cams[L.i];
        if (cam) {
            const bz = b.body ? b.body.position.z : -DIR[L.i] * FOUL;
            const hold = DIR[L.i] * (HEAD - 4.2);
            const z = L.sub === 'roll' || L.sub === 'settle'
                ? (DIR[L.i] > 0 ? Math.min(bz - 3.2, hold) : Math.max(bz + 3.2, hold))
                : -DIR[L.i] * (FOUL + 2.6);
            const want = new THREE.Vector3(LANE_X[L.i], L.sub === 'aim' || L.sub === 'wait' ? 2.1 : 1.6, z);
            if (!cam.userData.init) { cam.position.copy(want); cam.userData.init = true; }
            cam.position.lerp(want, Math.min(1, dt * 4));
            cam.lookAt(LANE_X[L.i], 0.2, cam.position.z + DIR[L.i] * 7);
        }
    });
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    _renderHud();
}

function _buildFig(slot) {
    // Each bowler stands behind their own camera: out of their own view, and
    // in the rival's, at the far end of the alley, watching the ball come.
    const f = { slot };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        c.rig.root.position.set(LANE_X[slot], 0, -DIR[slot] * (FOUL + 3.4));
        c.anim.face(DIR[slot] < 0 ? Math.PI : 0, true);
        c.anim.play('ready');
        Object.assign(f, { rig: c.rig, anim: c.anim });
    }
    return f;
}

function _renderHud() {
    if (!_hud) return;
    [0, 1].forEach(slot => {
        const L = _lanes[slot], them = _lanes[1 - slot];
        if (!L) return;
        const fr = Math.min(FRAMES, L.frame + 1);
        const ballN = (L.frameRolls || []).length + 1;
        const clock = L.sub === 'aim' && !isBotSlot(slot) ? ` · ${Math.max(0, Math.ceil(SHOT_CLOCK - L.clock))}s` : '';
        _hud.line(slot, L.sub === 'done' ? `🎳 DONE · ${_score(L.rolls)} · THEM ${_score(them.rolls)}`
            : `🎳 FRAME ${fr}/${FRAMES} · BALL ${ballN}${clock} · ${_score(L.rolls)} – ${_score(them.rolls)}`);
        _hud.hint(slot, L.msg && L.sub !== 'roll' ? L.msg : (L.frame === 0 && L.rolls.length === 0 && !seat(slot).bot ? 'FLICK UP TO BOWL · CURVE IT TO HOOK' : ''));
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `${seat(0).name} ${_score(_lanes[0].rolls)} – ${_score(_lanes[1].rolls)} ${seat(1).name}`;
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    const s = _lanes.map(L => _score(L.rolls));
    const w = s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : -1;
    if (_stage) _stage.views = null;
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? `${s[0]} PINS APIECE` : `${s[w]} TO ${s[1 - w]}`,
        closeUp: (f, p) => ({ pos: [p.x + 2.6, p.y + 4.6, p.z + (f.slot === 0 ? 1 : -1) * 7], look: [p.x, p.y + 0.9, p.z] }),
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase,
             lanes: _lanes.map(L => ({ sub: L.sub, frame: L.frame, rolls: [...L.rolls], score: _score(L.rolls), msg: L.msg, gutter: L.gutter,
                                       standing: L.pins.filter(p => !p.down && !_isDown(p)).length, pins: L.pins.length,
                                       ball: L.ball.body ? { x: +L.ball.body.position.x.toFixed(2), z: +L.ball.body.position.z.toFixed(2), v: +L.ball.body.velocity.length().toFixed(2) } : null })),
             views: _stage?.views ? _stage.views.length : 0, gl: !!_stage?.gl, turned: !!_stage?.turned, physics: !!_world };
}
/** Probes: bowl a ball straight from code (aim rad, pace 0–1, spin −1–1). */
export function _debugBowl(slot, aim, pace, spin = 0) { const L = _lanes[slot]; if (L && L.sub === 'aim') _bowl(L, aim, pace, spin); }
/** Probes: score a list of rolls. */
export function _debugScore(rolls) { return _score(rolls); }
