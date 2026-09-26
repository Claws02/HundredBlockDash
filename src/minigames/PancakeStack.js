// ============================================================
// PANCAKE STACK — the all-night diner, a plate each, and real physics.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Side-on hold, side by side. Each of you has a plate on its own pedestal
// table (no wider than the plate: a spill goes to the floor) and a
// pancake sliding back and forth above it.
//
//   TAP on your half to drop the pancake.
//
// The pancakes are real bodies: drop one off-centre and it overhangs, and a
// stack that leans far enough topples. Every pancake that lands makes the
// next one slide faster. Whoever has the TALLEST stack, plate to top,
// when the 40 s are up wins.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, sideHud, touch, effects } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const PLATE_X = [2.3, -2.3];             // P1 on the right, P2 on the left
const TABLE_Y = 0.9, PLATE_R = 0.8, PLATE_TOP = TABLE_Y + 0.08;
const R = 0.55, TH = 0.13;               // a pancake
const BOX = R * 1.55;                    // its physics: a flat square that fits inside it
const SWING = 1.25;                      // how far either side of the plate the dropper travels
const PERIOD_0 = 2.0, PERIOD_MIN = 0.8;  // s per full swing, first pancake → faster
const DROP_H = 1.6;                      // above the top of the stack
const RELOAD = 0.55;                     // s before the next pancake appears
const MATCH_TIME = 40, READY_TIME = 1.4;
const FIG_SCALE = 1.0;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _dir = null, _hud = null, _in = null, _fx = null;
let _world = null, _cakeMat = null, _geo = null, _mats = null;
let _look = null, _p = [], _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _frozen = false;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _frozen = false; _look = null;
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#2a1b2e;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'side', fov: 36, background: 0x2a1b2e });
    _hud = sideHud(_stage, { padWidth: 240 });
    _in = touch(_stage, { split: 'x', floating: false, onDown: slot => _drop(slot) });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    _world = typeof CANNON !== 'undefined' ? _buildWorld() : null;
    if (_stage.gl) _buildDiner();
    _p = [0, 1].map(_buildPlayer);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'TAP TO DROP IT ON THE STACK'));

    _dir.open({
        place: 'PERDITION · THE ALL-NIGHT DINER', title: 'PANCAKE STACK',
        sub: `TALLEST STACK AFTER ${MATCH_TIME} SECONDS`,
        from: { pos: [4, 3.2, 5], look: [0, 1.4, 0] },
        to: _cam(),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _world = null; _p = []; _dir = null; _hud = null; _in = null; _fx = null; _geo = null; _mats = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// The camera rises with the taller stack so both tops stay in view.
function _cam() {
    const top = Math.max(PLATE_TOP, ..._p.map(p => _topY(p)));
    const y = Math.max(1.9, top + 0.6);
    const back = 8.2 + Math.max(0, top - 2.5) * 0.7;
    return { pos: [0, y + 1.0, back], look: [0, y - 0.2, 0] };
}

// ── Physics ──────────────────────────────────────────────────────────────────
function _buildWorld() {
    const w = new CANNON.World();
    w.gravity.set(0, -9.8, 0);
    w.broadphase = new CANNON.NaiveBroadphase();
    w.solver.iterations = 14;
    w.allowSleep = true;
    _cakeMat = new CANNON.Material('cake');
    const hard = new CANNON.Material('hard');
    w.addContactMaterial(new CANNON.ContactMaterial(_cakeMat, _cakeMat, { friction: 0.9, restitution: 0.0 }));
    w.addContactMaterial(new CANNON.ContactMaterial(_cakeMat, hard, { friction: 0.7, restitution: 0.05 }));
    const floor = new CANNON.Body({ mass: 0, material: hard });
    floor.addShape(new CANNON.Plane());
    floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    w.addBody(floor);
    // A pedestal under each plate and nothing else: whatever misses the
    // plate goes to the floor, where it can't prop a stack up.
    PLATE_X.forEach(x => {
        const post = new CANNON.Body({ mass: 0, material: hard });
        post.addShape(new CANNON.Box(new CANNON.Vec3(0.12, TABLE_Y / 2, 0.12)));
        post.position.set(x, TABLE_Y / 2, 0);
        w.addBody(post);
    });
    PLATE_X.forEach(x => {
        const plate = new CANNON.Body({ mass: 0, material: hard });
        plate.addShape(new CANNON.Box(new CANNON.Vec3(PLATE_R * 0.8, 0.04, PLATE_R * 0.8)));
        plate.position.set(x, TABLE_Y + 0.04, 0);
        w.addBody(plate);
    });
    return w;
}

// ── The diner ────────────────────────────────────────────────────────────────
function _buildDiner() {
    const scene = _stage.scene;
    _stage.light({ sun: 0xfff1d6, sunI: 1.1, sky: 0xffe2c4, ground: 0x4a2a3a, hemiI: 0.7, dir: [3, 10, 8], span: 8 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); _stage.add(m); return m; };
    // Checked floor, the back wall with a window and a neon sign.
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#1f1f24' : '#f1ece2'; g.fillRect(i * 32, j * 32, 32, 32); }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(14, 10);
    const floor = add(new THREE.PlaneGeometry(28, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), 0, 0, 0); floor.rotation.x = -Math.PI / 2;
    add(new THREE.BoxGeometry(28, 9, 0.3), new THREE.MeshStandardMaterial({ color: 0x5ec2b7, roughness: 0.8 }), 0, 4.5, -3.2);
    add(new THREE.BoxGeometry(28, 1.1, 0.34), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 }), 0, 0.55, -3.18);
    const win = add(new THREE.PlaneGeometry(4.5, 2.2), new THREE.MeshBasicMaterial({ color: 0x1b2a4a }), -5.5, 3.3, -3.03);
    [[0, 0, 4.6, 0.12], [0, 0, 0.12, 2.3]].forEach(([x, y, w, h]) => add(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xf1ece2 }), -5.5 + x, 3.3 + y, -3.02));
    const scv = document.createElement('canvas'); scv.width = 256; scv.height = 64;
    const sg = scv.getContext('2d'); sg.fillStyle = '#ff5fa2'; sg.shadowColor = '#ff5fa2'; sg.shadowBlur = 12;
    sg.font = 'bold 40px sans-serif'; sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.fillText('PANCAKES', 128, 34);
    add(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(scv), transparent: true }), 3.2, 4.2, -3.0);
    // Two chrome pedestal tables, each topped by its plate.
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd9d9df, metalness: 0.7, roughness: 0.25 });
    PLATE_X.forEach(x => {
        add(new THREE.CylinderGeometry(0.1, 0.1, TABLE_Y, 12), chrome, x, TABLE_Y / 2, 0).castShadow = true;
        add(new THREE.CylinderGeometry(0.5, 0.55, 0.06, 24), chrome, x, 0.03, 0);
    });
    // Plates.
    const china = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
    PLATE_X.forEach((x, slot) => {
        const p = add(new THREE.CylinderGeometry(PLATE_R, PLATE_R * 0.8, 0.08, 32), china, x, TABLE_Y + 0.04, 0); p.receiveShadow = true;
        const rim = add(new THREE.TorusGeometry(PLATE_R * 0.97, 0.03, 6, 32), new THREE.MeshStandardMaterial({ color: seat(slot).color }), x, TABLE_Y + 0.08, 0); rim.rotation.x = Math.PI / 2;
    });
    // Pancake look, shared: golden top, darker edge.
    _geo = { cake: new THREE.CylinderGeometry(R, R * 0.97, TH, 28), pat: new THREE.BoxGeometry(0.16, 0.06, 0.16) };
    _mats = [new THREE.MeshStandardMaterial({ color: 0xe0a458, roughness: 0.75 }), new THREE.MeshStandardMaterial({ color: 0xf2c27a, roughness: 0.75 }),
             new THREE.MeshStandardMaterial({ color: 0xc98b3c, roughness: 0.75 })];
}

function _cakeMesh() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(_geo.cake, [_mats[2], _mats[1], _mats[0]]);
    m.castShadow = true; m.receiveShadow = true; g.add(m);
    _stage.add(g);
    return g;
}

// ── Players ──────────────────────────────────────────────────────────────────
function _buildPlayer(slot) {
    const p = { slot, cakes: [], held: null, reload: 0.4, phase: Math.random() * Math.PI * 2, drops: 0, bot: { wait: 0 } };
    if (_stage.gl) {
        // The cook behind each plate, watching the stack.
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        c.rig.root.position.set(PLATE_X[slot] + (slot === 0 ? 1.9 : -1.9), 0, -2.8);
        c.anim.face(0, true);
        c.anim.play('ready');
        Object.assign(p, { rig: c.rig, anim: c.anim });
        // A shadow on the stack under the held pancake, so the drop can be judged.
        p.aim = new THREE.Mesh(new THREE.RingGeometry(R * 0.85, R, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
        p.aim.rotation.x = -Math.PI / 2; _stage.add(p.aim);
    }
    return p;
}

/** The pancakes that make up this player's stack: landed, settled, flat, over the plate. */
function _onPlate(p) {
    return p.cakes.filter(c => {
        const b = c.body;
        if (!b) return c.landed && !c.off;
        // Still falling is not on the stack: counting it the moment it was
        // dropped lifted the stack top (and the camera) by the drop height.
        if (!c.landed || b.velocity.length() > 0.6) return false;
        // Lying flat, not slumped: a pancake tipped on its edge is a collapse.
        const q = b.quaternion, upY = 1 - 2 * (q.x * q.x + q.z * q.z);
        return upY > 0.9 && b.position.y > PLATE_TOP + TH * 0.3 && Math.hypot(b.position.x - PLATE_X[p.slot], b.position.z) < PLATE_R + 0.2;
    });
}
function _topY(p) {
    const on = _onPlate(p);
    return on.length ? Math.max(...on.map(c => c.body ? c.body.position.y : PLATE_TOP)) + TH / 2 : PLATE_TOP;
}
const _count = p => _onPlate(p).length;
/** The score: height of the stack, plate to top, in world units. */
const _height = p => Math.max(0, _topY(p) - PLATE_TOP);
const _cm = h => `${(h * 10).toFixed(1)} cm`;       // one pancake ≈ 1.3 cm
const _period = p => Math.max(PERIOD_MIN, PERIOD_0 - _count(p) * 0.09);
const _heldX = p => PLATE_X[p.slot] + Math.sin(p.phase) * SWING;

function _drop(slot) {
    const p = _p[slot];
    if (!p || _phase !== 'play' || p.reload > 0) return;
    const x = p.forceX != null ? p.forceX : _heldX(p);
    p.forceX = null;
    const y = _topY(p) + DROP_H * 0.55;
    const c = { body: null, mesh: p.held && p.held.isObject3D ? p.held : null, landed: false };
    p.held = null;
    if (_world) {
        const b = new CANNON.Body({ mass: 0.25, material: _cakeMat, linearDamping: 0.05, angularDamping: 0.3 });
        b.addShape(new CANNON.Box(new CANNON.Vec3(BOX / 2, TH / 2, BOX / 2)));
        b.position.set(x, y, 0);
        b.sleepSpeedLimit = 0.08; b.sleepTimeLimit = 0.4;
        _world.addBody(b); c.body = b;
        b.addEventListener('collide', () => { if (!c.landed) { c.landed = true; sfx('dice_land'); } });
    }
    if (!c.mesh && _stage?.gl) c.mesh = _cakeMesh();
    p.cakes.push(c);
    p.drops++;
    p.reload = RELOAD;
    sfx('seq_lit');
    if (!isBotSlot(slot)) haptic([10]);
}

// ── Bot (§5): drop when the pancake is over the top of its stack, give or
// take a skill-sized slip of the finger. ─────────────────────────────────────
function _botStep(p, dt) {
    if (p.reload > 0 || !p.held) return;
    p.bot.wait -= dt;
    if (p.bot.wait > 0) return;
    const on = _onPlate(p);
    const top = on.length ? on.reduce((a, c) => (c.body && c.body.position.y > (a?.body?.position.y ?? -1) ? c : a), null) : null;
    const target = top?.body ? top.body.position.x : PLATE_X[p.slot];
    const err = (1 - _botSkill) * 0.55 * (Math.random() - 0.5) * 2;
    if (Math.abs(_heldX(p) - (target + err)) < 0.06 + (1 - _botSkill) * 0.1) { _drop(p.slot); p.bot.wait = 0.2 + (1 - _botSkill) * 0.6; }
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') { _hud.say('READY…', 'TAP WHEN IT\'S OVER YOUR STACK', 1300, _t, '#f2c27a'); sfx('countdown'); }
    else if (phase === 'play') { _hud.say('STACK!', '', 700, _t, '#4ade80'); sfx('go'); haptic([40]); }
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready' && _phaseT >= READY_TIME) _enter('play');
    if (_phase === 'play') {
        if (!_frozen) _clock += dt;
        _p.forEach(p => {
            p.reload = Math.max(0, p.reload - dt);
            if (!_frozen) p.phase += dt * Math.PI * 2 / _period(p);
            if (!p.held && p.reload <= 0 && _stage?.gl) p.held = _cakeMesh();
            if (!p.held && p.reload <= 0 && !_stage?.gl) p.held = true;
            if (isBotSlot(p.slot)) _botStep(p, dt);
        });
        if (_clock >= MATCH_TIME) _end();
    }
    if (_world) _world.step(1 / 60, dt, 6);
    _p.forEach(p => p.cakes.forEach(c => _floorCheck(c, dt)));
    _draw();
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!dirOwns && _stage?.gl && _phase !== 'over') {
        const c = _cam(), cam = _stage.camera;
        cam.position.lerp(new THREE.Vector3(...c.pos), Math.min(1, dt * 1.5));
        if (!_look) _look = new THREE.Vector3(...c.look);
        _look.lerp(new THREE.Vector3(...c.look), Math.min(1, dt * 1.5));
        cam.lookAt(_look);
    }
    _renderHud();
}

// ── A pancake on the floor crumbles away (a moment to see it land first). ────
const FLOOR_Y = 0.4, FLOOR_WAIT = 0.35, CRUMBLE = 0.7;
function _floorCheck(c, dt) {
    if (c.dying != null) {
        c.dying += dt;
        const k = Math.min(1, c.dying / CRUMBLE);
        if (c.mesh) {
            c.mesh.scale.set(1 + k * 0.5, Math.max(0.05, 1 - k), 1 + k * 0.5);
            c.mesh.position.y = Math.max(0.01, c.y0 * (1 - k));
            c.mesh.traverse(o => { if (o.isMesh) o.material.forEach(m => { m.opacity = 1 - k; }); });
            if (k >= 1) {
                c.mesh.traverse(o => { if (o.isMesh) o.material.forEach(m => m.dispose()); });
                c.mesh.parent?.remove(c.mesh); c.mesh = null;
            }
        }
        return;
    }
    const b = c.body;
    if (!b || b.position.y > FLOOR_Y) { c.floorT = 0; return; }
    c.floorT = (c.floorT || 0) + dt;
    if (c.floorT < FLOOR_WAIT) return;
    // Off the table for good: the body goes, the mesh crumbles to crumbs.
    c.off = true; c.landed = true; c.dying = 0; c.y0 = b.position.y;
    if (c.mesh) {
        c.mesh.position.copy(b.position); c.mesh.quaternion.copy(b.quaternion);
        c.mesh.traverse(o => { if (o.isMesh) o.material = o.material.map(m => { const n = m.clone(); n.transparent = true; return n; }); });
    }
    _world?.removeBody(b); c.body = null;
    if (_stage?.gl) {
        _fx?.puff(new THREE.Vector3(b.position.x, 0.1, b.position.z), 0xd9a55b, 7, 0.55, 0.45);
        _fx?.puff(new THREE.Vector3(b.position.x, 0.05, b.position.z), 0xf5e6c8, 4, 0.4, 0.3);
    }
    sfx('dice_land');
}

function _draw() {
    _p.forEach(p => {
        p.cakes.forEach(c => { if (c.mesh && c.body) { c.mesh.position.copy(c.body.position); c.mesh.quaternion.copy(c.body.quaternion); } });
        const top = _topY(p);
        if (p.held && p.held.isObject3D) {
            p.held.position.set(_heldX(p), top + DROP_H * 0.55, 0);
            p.held.quaternion.identity();
            p.held.visible = _phase === 'play' || _phase === 'ready';
        }
        if (p.aim) {
            p.aim.visible = !!(p.held && p.held.isObject3D) && _phase === 'play' && !isBotSlot(p.slot);
            p.aim.position.set(_heldX(p), top + 0.01, 0);
            const off = Math.abs(_heldX(p) - PLATE_X[p.slot]);
            p.aim.material.color.setHex(off < 0.15 ? 0x4ade80 : off < 0.4 ? 0xfacc15 : 0xef4444);
        }
    });
}

function _renderHud() {
    if (!_hud) return;
    const h = _p.map(_height);
    _hud.bar(`<span style="color:${seat(1).css}">${seat(1).name} 📏 ${_cm(h[1])}</span>` +
        `<span>⏱ ${Math.max(0, Math.ceil(MATCH_TIME - _clock))}s</span>` +
        `<span style="color:${seat(0).css}">${_cm(h[0])} 📏 ${seat(0).name}</span>`);
    if (_clock > 6) [0, 1].forEach(slot => _hud.hint(slot, ''));
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `${seat(0).name} ${_cm(h[0])} – ${_cm(h[1])} ${seat(1).name}`;
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    _p.forEach(p => { if (p.held && p.held.isObject3D) p.held.visible = false; if (p.aim) p.aim.visible = false; });
    // Tallest stack, plate to top. Within half a pancake is a dead heat.
    const h = _p.map(_height);
    const w = Math.abs(h[0] - h[1]) < TH / 2 ? -1 : h[0] > h[1] ? 0 : 1;
    // Syrup on the winner's stack.
    if (w >= 0 && _stage?.gl) {
        const top = _topY(_p[w]);
        const syrup = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.7, R * 0.9, 0.05, 20), new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.15, transparent: true, opacity: 0.9 }));
        syrup.position.set(PLATE_X[w], top + 0.03, 0); _stage.add(syrup);
        const pat = new THREE.Mesh(_geo.pat, new THREE.MeshStandardMaterial({ color: 0xffe28a })); pat.position.set(PLATE_X[w], top + 0.08, 0); _stage.add(pat);
    }
    _dir.close({
        winner: w, figs: _p.filter(p => p.rig).map(p => ({ slot: p.slot, rig: p.rig, anim: p.anim })),
        sub: w < 0 ? `BOTH ${_cm(h[0])} TALL` : `${_cm(h[w])} TO ${_cm(h[1 - w])}`,
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, clock: +_clock.toFixed(2),
             players: _p.map(p => ({ count: _count(p), height: +_height(p).toFixed(3), drops: p.drops, reload: +p.reload.toFixed(2), held: !!p.held,
                                     heldX: +_heldX(p).toFixed(2), top: +_topY(p).toFixed(2) })),
             camY: _stage?.camera ? +_stage.camera.position.y.toFixed(3) : 0,
             lowest: Math.min(9, ..._p.flatMap(p => p.cakes.map(c => (c.body ? +c.body.position.y.toFixed(2) : 9)))),
             crumbled: _p.reduce((n, p) => n + p.cakes.filter(c => c.dying != null).length, 0),
             floorLeft: _p.reduce((n, p) => n + p.cakes.filter(c => c.mesh && c.dying != null).length, 0),
             onFloor: _p.reduce((n, p) => n + p.cakes.filter(c => c.body && c.body.position.y < FLOOR_Y).length, 0),
             physics: !!_world, gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: freeze the dropper's swing and the clock. */
export function _debugFreeze(on) { _frozen = !!on; }
/** Probes: drop P's next pancake at plate x + dx, from code. */
export function _debugDropAt(slot, dx) { const p = _p[slot]; if (!p) return; p.reload = 0; p.forceX = PLATE_X[slot] + dx; _drop(slot); }
/** Probes: set the clock. */
export function _debugClock(s) { _clock = s; }
