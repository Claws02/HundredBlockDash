// ============================================================
// SPEED BOAT — one river, two boats, a chase camera each.
// (3D rebuild of the 2D original, kept in archived/SpeedBoat.js.)
//
// Face-off hold, SPLIT SCREEN: each half is that player's own chase camera,
// the far half rolled 180° so it reads the right way up from its own end.
// The river is SHARED: one course, one set of rocks, and boats that shove
// each other when they touch.
//
//   DRAG ⬅➡ on your half to steer across the river.
//   TAP to change gear — SLOW, CRUISE, FLAT OUT, and round again.
//
// The game is the tension between the two. Flat out finishes the course in
// about fifteen seconds; it is also the gear in which the next line of rocks
// arrives before you can steer across to the gate in it, and a hit at speed
// costs more than a hit at a crawl. The throttle is a decision, not a
// direction. Each gate is marked with a red and a green flag.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects } from '../engine/StageKit.js';

// ── Tuning. The sim runs in RIVER WIDTHS (u across 0–1, d along), as the 2D
// game did; RW turns a width into world units for drawing. ──────────────────
const RW = 9;
const COURSE = 30;                      // widths from the line to the flag
const GEARS = [0.90, 1.40, 2.00];       // widths per second
const GEAR_NAME = ['SLOW', 'CRUISE', 'FLAT OUT'];
const STEER = 0.80;                     // widths/s across at full deflection
const BOT_STEER = 0.55;                 // ...and a bot's, which is always full
const ROW_GAP = 1.15;                   // widths between lines of rocks
const GAP_W = 0.30;                     // a gate: wide enough for two, level
const GAP_MIN = 0.14, GAP_MAX = 0.86;
const HIT_BASE = 0.70, HIT_SPEED = 1.30;
const BUMP_PUSH = 0.55, BUMP_COST = 0.35;
const BOAT_W = 0.13, ROCK_R = 0.075;
const MATCH_TIME = 52;
const READY_TIME = 3.2;
const FIG_SCALE = 0.5;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _dir = null, _hud = null, _in = null, _fx = null;
let _boats = [], _rows = [], _cams = [], _botAim = [0.5, 0.5];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _winner = -1, _count = 0, _endAt = 0;

const X = u => (0.5 - u) * RW;          // P1 looks up +z, so their right is −x
const Z = d => d * RW;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _winner = -1; _count = 0; _endAt = 0;
    _botAim = [0.5, 0.5];
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#9fd4f5;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 45, background: 0x9fd4f5 });
    _hud = faceoffHud(_stage);
    _in = touch(_stage, { split: 'y', stick: 60, onTap: slot => _shift(slot) });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    _buildRiver();
    if (_stage.gl) {
        _buildScene();
        _cams = [0, 1].map(slot => {
            const c = new THREE.PerspectiveCamera(58, 1, 0.1, 160);
            c.up.set(0, slot === 0 ? 1 : -1, 0);  // the far half reads from its own end
            return c;
        });
    }
    _boats = [0, 1].map(_buildBoat);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'DRAG ⬅➡ TO STEER · TAP TO CHANGE GEAR'));

    _dir.open({
        place: 'THE RIVER · WHITEWATER RUN', title: 'SPEED BOAT',
        sub: 'SHOOT THE GATES · FIRST TO THE FLAG',
        from: { pos: [14, 22, -10], look: [0, 0, 30] },
        to: { pos: [0, 4.2, -7.5], look: [0, 0.5, 10] },
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.views = null; _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _boats = []; _rows = []; _cams = []; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── The river: lines of rocks with one gate in each, and the gate moves. ──────
function _buildRiver() {
    _rows = [];
    for (let d = 2.4; d < COURSE - 1.2; d += ROW_GAP) _rows.push({ d, gap: GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN) });
}
/** The whole HULL has to fit through the gate. */
const _blocked = (r, u) => Math.abs(u - r.gap) > GAP_W / 2 - BOAT_W / 2;

function _buildScene() {
    const scene = _stage.scene;
    const len = Z(COURSE) + 60;
    scene.fog = new THREE.Fog(0x9fd4f5, 38, 95);
    scene.add(new THREE.HemisphereLight(0xdff3ff, 0x3f6b2a, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(-6, 14, 6); scene.add(sun);
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); _stage.add(m); return m; };

    // Water, banks, and white streaks on the water so speed is felt.
    const water = add(new THREE.PlaneGeometry(RW + 3, len), new THREE.MeshStandardMaterial({ color: 0x2f8fd8, roughness: 0.25, metalness: 0.15 }), 0, 0, len / 2 - 20);
    water.rotation.x = -Math.PI / 2;
    const grass = new THREE.MeshStandardMaterial({ color: 0x5fae45, roughness: 0.95 });
    const sand = new THREE.MeshStandardMaterial({ color: 0xe4cf94, roughness: 1 });
    [-1, 1].forEach(s => {
        add(new THREE.BoxGeometry(30, 0.8, len), grass, s * (RW / 2 + 1.5 + 15), 0.3, len / 2 - 20);
        add(new THREE.BoxGeometry(1.6, 0.35, len), sand, s * (RW / 2 + 0.7), 0.08, len / 2 - 20);
    });
    const streak = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.01, 1.3), new THREE.MeshBasicMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.55 }), 220);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 220; i++) { m4.makeTranslation((Math.random() - 0.5) * RW, 0.02, -15 + Math.random() * (len - 10)); streak.setMatrixAt(i, m4); }
    _stage.add(streak);

    // Trees along both banks.
    const nT = Math.floor(len / 7) * 2;
    const leaf = new THREE.InstancedMesh(new THREE.ConeGeometry(1.3, 3.2, 7), new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 0.9 }), nT);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.25, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0x6b4423 }), nT);
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < nT; i++) {
        const side = i % 2 ? 1 : -1, z = -15 + Math.floor(i / 2) * 7 + Math.random() * 3;
        const x = side * (RW / 2 + 3 + Math.random() * 6), k = 0.8 + Math.random() * 0.6;
        sc.set(k, k, k);
        m4.compose(p.set(x, 0.7 + 0.6 * k, z), q, sc); trunk.setMatrixAt(i, m4);
        m4.compose(p.set(x, 0.7 + 2.6 * k, z), q, sc); leaf.setMatrixAt(i, m4);
    }
    _stage.add(leaf); _stage.add(trunk);

    // The rocks: every row filled edge to edge but for its gate, which is
    // flagged red on its left (as P1 sees it) and green on its right.
    const perRow = [];
    _rows.forEach(r => {
        const lo = r.gap - GAP_W / 2, hi = r.gap + GAP_W / 2, list = [];
        for (let u = lo - ROCK_R * 0.9; u > -0.05; u -= ROCK_R * 1.35) list.push(u);
        for (let u = hi + ROCK_R * 0.9; u < 1.05; u += ROCK_R * 1.35) list.push(u);
        perRow.push(list);
    });
    const nR = perRow.reduce((a, l) => a + l.length, 0);
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(ROCK_R * RW, 0), new THREE.MeshStandardMaterial({ color: 0x7d7f86, roughness: 0.9, flatShading: true }), nR);
    let n = 0;
    _rows.forEach((r, i) => perRow[i].forEach(u => {
        const k = 0.85 + Math.random() * 0.35;
        q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
        m4.compose(p.set(X(u), 0.15, Z(r.d) + (Math.random() - 0.5) * 0.5), q, sc.set(k, k * 0.8, k));
        rocks.setMatrixAt(n++, m4);
    }));
    _stage.add(rocks);
    q.identity();
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0xffffff }), _rows.length * 2);
    const flags = [0xef4444, 0x22c55e].map(c => new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.45, 0.04), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35 }), _rows.length));
    _rows.forEach((r, i) => [-1, 1].forEach((s, j) => {
        const x = X(r.gap - s * GAP_W / 2), z = Z(r.d);
        m4.compose(p.set(x, 1.1, z), q, sc.set(1, 1, 1)); pole.setMatrixAt(i * 2 + j, m4);
        m4.compose(p.set(x - s * 0.38, 1.95, z), q, sc); flags[j].setMatrixAt(i, m4);
    }));
    _stage.add(pole); flags.forEach(f => _stage.add(f));

    // Start line, and a chequered arch at the flag.
    const line = add(new THREE.PlaneGeometry(RW, 0.35), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 0.03, 0.9);
    line.rotation.x = -Math.PI / 2;
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 16;
    const cx = cv.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { cx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; cx.fillRect(i * 8, j * 8, 8, 8); }
    const tex = new THREE.CanvasTexture(cv);
    const post = new THREE.MeshStandardMaterial({ color: 0xdddddd });
    [-1, 1].forEach(s => add(new THREE.CylinderGeometry(0.22, 0.22, 5, 8), post, s * (RW / 2 + 0.4), 2.5, Z(COURSE)));
    add(new THREE.BoxGeometry(RW + 1.2, 0.9, 0.12), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }), 0, 4.6, Z(COURSE));
    const fin = add(new THREE.PlaneGeometry(RW, 0.6), new THREE.MeshBasicMaterial({ map: tex }), 0, 0.03, Z(COURSE));
    fin.rotation.x = -Math.PI / 2;
}

// ── Boats ────────────────────────────────────────────────────────────────────
function _buildBoat(slot) {
    const b = { slot, u: slot === 0 ? 0.36 : 0.64, d: 0, gear: 1, stall: 0, bumpAt: 0, wall: null,
                finished: 0, hits: 0, wakeT: 0, yaw: 0 };
    if (!_stage.gl) return b;
    const g = new THREE.Group();
    const hullM = new THREE.MeshStandardMaterial({ color: seat(slot).color, roughness: 0.35, metalness: 0.2 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1f2328, roughness: 0.7 });
    const W = BOAT_W * RW;                               // hull width, as the hit test sees it
    const hull = new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, 1.7), hullM); hull.position.set(0, 0.2, -0.2); g.add(hull);
    const bowShape = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, 0.9)]);
    const bow = new THREE.Mesh(new THREE.ExtrudeGeometry(bowShape, { depth: 0.4, bevelEnabled: false }), hullM);
    bow.rotation.x = Math.PI / 2; bow.position.set(0, 0.4, 0.65); g.add(bow);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.08, 1.7), white); stripe.position.set(0, 0.3, -0.2); g.add(stripe);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.3, 0.06), new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.6 }));
    glass.position.set(0, 0.55, 0.45); glass.rotation.x = -0.4; g.add(glass);
    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.6, 0.3), dark); motor.position.set(0, 0.35, -1.15); g.add(motor);
    _stage.add(g);
    const ch = _stage.character(slot);
    ch.rig.root.scale.setScalar(FIG_SCALE);
    ch.rig.root.position.set(0, 0.35, -0.35);
    g.add(ch.rig.root);
    ch.anim.play('ready');
    // Foam rings for the wake, recycled.
    const foamGeo = new THREE.RingGeometry(0.28, 0.5, 16);
    const foam = Array.from({ length: 10 }, () => {
        const m = new THREE.Mesh(foamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.visible = false; _stage.add(m); return m;
    });
    Object.assign(b, { g, rig: ch.rig, anim: ch.anim, foam, foamI: 0 });
    return b;
}

function _shift(slot) {
    const b = _boats[slot];
    if (!b || _phase !== 'race' || b.finished) return;
    b.gear = (b.gear + 1) % GEARS.length;
    sfx(b.gear === 2 ? 'boost' : 'tick'); haptic([10]);
}

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
        _boats.forEach(b => {
            if (isBotSlot(b.slot)) _botDrive(b, dt);
            else if (!b.finished) {
                const s = _in.seat(b.slot);
                b.u = Math.max(BOAT_W / 2, Math.min(1 - BOAT_W / 2, b.u + s.dx * STEER * dt));
                b.yaw = -s.dx * 0.35;
            }
            _run(b, dt);
        });
        _bumps(dt);
        if (_endAt && _clock >= _endAt) _end();
        else if (_boats.every(b => b.finished) || (_clock >= MATCH_TIME && _winner < 0)) {
            if (_winner < 0) _winner = _boats[0].d > _boats[1].d ? 0 : _boats[1].d > _boats[0].d ? 1 : -1;
            _end();
        }
    }
    _boats.forEach(b => _draw(b, dt));
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    _renderHud();
}

function _run(b, dt) {
    if (b.finished) return;
    if (b.stall > 0) { b.stall = Math.max(0, b.stall - dt); return; }
    // Pinned against a line of rocks until the hull is over the gate: you do
    // not reverse out of a rock, you slide along it looking for the way through.
    if (b.wall) {
        if (_blocked(b.wall, b.u)) { b.d = b.wall.d - ROCK_R; return; }
        b.wall = null;
    }
    const v = GEARS[b.gear], before = b.d;
    b.d += v * dt;
    for (const r of _rows) {
        if (r.d <= before || r.d > b.d) continue;
        if (_blocked(r, b.u)) {
            b.d = r.d - ROCK_R;
            b.wall = r;
            b.stall = HIT_BASE + HIT_SPEED * (v / GEARS[GEARS.length - 1]);
            b.gear = 0;
            b.hits++;
            sfx('land_bad');
            if (!isBotSlot(b.slot)) haptic([50, 40, 50]);
            if (_stage?.gl) { _fx.burst(new THREE.Vector3(X(b.u), 0.5, Z(b.d) + 0.9), 0xffffff, 0.5, 0.3); _fx.puff(new THREE.Vector3(X(b.u), 0.4, Z(b.d) + 0.8), 0xe6f6ff, 5, 0.7, 1.4); }
            b.anim?.play('hit');
            break;
        }
    }
    if (b.d >= COURSE) {
        b.d = COURSE;
        b.finished = _clock;
        if (_winner < 0) {
            _winner = b.slot; _endAt = _clock + 1.6;
            sfx('mg_win'); _hud.say('FINISH!', seat(b.slot).name, 1500, _t, seat(b.slot).css);
        }
    }
}

// Hulls that overlap shove each other apart; the one BEHIND pays the stall,
// and both pay when they are dead level.
function _bumps(dt) {
    const [A, B] = _boats;
    if (!A || !B || A.finished || B.finished) return;
    if (Math.abs(A.d - B.d) > BOAT_W * 1.9) return;
    const du = A.u - B.u;
    if (Math.abs(du) > BOAT_W) return;
    const s = du === 0 ? -1 : Math.sign(du);
    A.u = Math.max(BOAT_W / 2, Math.min(1 - BOAT_W / 2, A.u + s * BUMP_PUSH * dt));
    B.u = Math.max(BOAT_W / 2, Math.min(1 - BOAT_W / 2, B.u - s * BUMP_PUSH * dt));
    const level = Math.abs(A.d - B.d) < BOAT_W * 0.5;
    let hit = false;
    (level ? [A, B] : [A.d < B.d ? A : B]).forEach(p => {
        if (p.stall > 0 || _t - p.bumpAt <= 0.5) return;
        p.stall = BUMP_COST; p.bumpAt = _t; hit = true;
    });
    if (hit) sfx('dice_land');
}

// ── Bot (§5): aim for the next gate, and pick the fastest gear that still
// leaves time to get across to it. A weak bot overestimates that time. ──────
function _botDrive(b, dt) {
    if (b.finished) return;
    const next = b.wall || _rows.find(r => r.d > b.d + ROCK_R);
    if (!next) { b.gear = GEARS.length - 1; return; }
    const tol = Math.max(0.01, GAP_W / 2 - BOAT_W / 2);
    if (b.wall) _botAim[b.slot] = next.gap;
    else if (b.aimRow !== next) {
        b.aimRow = next;
        const err = (1 - _botSkill) * 0.16 * (Math.random() + Math.random() - 1);
        _botAim[b.slot] = next.gap + (b.slot ? 1 : -1) * BOAT_W / 2 + err;
    }
    const aim = Math.max(next.gap - tol * 0.92, Math.min(next.gap + tol * 0.92, _botAim[b.slot]));
    const need = Math.abs(aim - b.u);
    const slack = 1 + (1 - _botSkill) * 0.55;
    let want = 0;
    for (let g = GEARS.length - 1; g >= 0; g--) {
        if (BOT_STEER * ((next.d - b.d) / GEARS[g]) * slack >= need) { want = g; break; }
    }
    b.gear = want;
    const step = BOT_STEER * dt, dv = aim - b.u;
    b.u += Math.max(-step, Math.min(step, dv));
    b.yaw = Math.max(-0.35, Math.min(0.35, -Math.sign(dv) * Math.min(1, Math.abs(dv) * 20) * 0.35));
}

// ── Drawing ──────────────────────────────────────────────────────────────────
function _draw(b, dt) {
    if (!b.g) return;
    const x = X(b.u), z = Z(b.d);
    const moving = _phase === 'race' && !b.finished && b.stall <= 0 && !b.wall;
    const v = moving ? GEARS[b.gear] : 0;
    b.g.position.set(x, 0.05 + Math.sin(_t * 7 + b.slot) * 0.04 * (1 + v), z);
    b.g.rotation.set(-0.05 * v - (b.stall > 0 ? Math.sin(b.stall * 20) * 0.08 : 0), b.yaw, -b.yaw * 0.4);
    if (!moving) b.yaw *= Math.pow(0.02, dt);
    if (b.anim && b.stall <= 0 && b.anim.state === 'hit') b.anim.play(b.finished ? 'victory' : 'ready');
    if (b.finished && b.anim && b.anim.state !== 'victory') b.anim.play('victory');
    // Wake: white puffs off the stern, more of them the faster you go.
    b.wakeT -= dt;
    if (v > 0 && b.wakeT <= 0) {
        b.wakeT = 0.16 - v * 0.04;
        const f = b.foam[b.foamI++ % b.foam.length];
        f.position.set(x + (Math.random() - 0.5) * 0.3, 0.04, z - 1.35);
        f.userData.t = 0; f.visible = true;
    }
    b.foam.forEach(f => {
        if (!f.visible) return;
        const t = (f.userData.t += dt), life = 0.9;
        if (t >= life) { f.visible = false; return; }
        f.scale.setScalar(0.35 + t * 1.6);
        f.material.opacity = 0.75 * (1 - t / life);
    });
    const cam = _cams[b.slot];
    if (cam) {
        const want = new THREE.Vector3(x * 0.55, 4.2, z - 7.5);
        if (!cam.userData.init) { cam.position.copy(want); cam.userData.init = true; }
        cam.position.lerp(want, Math.min(1, dt * 5));
        cam.lookAt(x * 0.6, 0.4, cam.position.z + 17);
        const fov = 56 + (b.stall > 0 ? 0 : v * 5);
        if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }
    }
}

function _renderHud() {
    if (!_hud) return;
    const lead = _boats[0].d === _boats[1].d ? -1 : _boats[0].d > _boats[1].d ? 0 : 1;
    [0, 1].forEach(slot => {
        const b = _boats[slot];
        if (!b) return;
        const pos = lead < 0 || lead === slot ? '1ST' : '2ND';
        const gearTxt = b.stall > 0 || b.wall ? '💥 ON THE ROCKS' : `⚙ ${GEAR_NAME[b.gear]}`;
        _hud.line(slot, b.finished ? `🏁 FINISHED · ${_winner === slot ? '1ST' : '2ND'}`
            : `🚤 ${gearTxt} · ${Math.round(b.d / COURSE * 100)}% · ${pos}`);
        if (_clock > 7) _hud.hint(slot, b.wall && !isBotSlot(slot) ? 'STEER FOR THE FLAGS!' : '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'race') el.textContent = `${seat(0).name} ${Math.round(_boats[0].d / COURSE * 100)}% – ${Math.round(_boats[1].d / COURSE * 100)}% ${seat(1).name}`;
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    const w = _winner;
    if (_stage) _stage.views = null;               // the director's shots are full-frame
    _dir.close({
        winner: w, figs: _boats.filter(b => b.rig).map(b => ({ slot: b.slot, rig: b.rig, anim: b.anim })),
        sub: w < 0 ? 'A DEAD HEAT' : 'FIRST TO THE FLAG',
        closeUp: (f, p) => ({ pos: [p.x + 3.5, p.y + 3.2, p.z + (f.slot === 0 ? -1 : 1) * 5.5], look: [p.x, p.y + 0.5, p.z] }),
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, clock: +_clock.toFixed(2), winner: _winner, rows: _rows.length,
             boats: _boats.map(b => {
                 const next = b.wall || _rows.find(r => r.d > b.d + ROCK_R);
                 return { u: +b.u.toFixed(3), d: +b.d.toFixed(2), gear: b.gear, stall: +b.stall.toFixed(2), pinned: !!b.wall,
                          hits: b.hits, finished: b.finished, next: next ? { d: +next.d.toFixed(2), gap: +next.gap.toFixed(3) } : null };
             }),
             views: _stage?.views ? _stage.views.length : 0, gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: put a boat at (u, d), clear of any rocks it was pinned on. */
export function _debugPlace(slot, u, d) { const b = _boats[slot]; if (b) Object.assign(b, { u, d, wall: null, stall: 0 }); }
export function _debugGear(slot, g) { if (_boats[slot]) _boats[slot].gear = g; }
