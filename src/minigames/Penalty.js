// ============================================================
// PENALTY — the shootout at the stadium. One shoots, one keeps, then swap.
// (3D rebuild of the 2D original, kept in archived/Penalty.js.)
//
// Face-off hold, SPLIT SCREEN, and the two halves are different jobs:
//   THE SHOOTER's camera stands behind the ball. PULL BACK on your half and let
//     go: how far you pull is how hard it is hit (and a harder ball gets UP);
//     pull left to put it right, as a slingshot does. The aim ring shows where
//     it will go — and only YOUR camera can see it.
//   THE KEEPER's camera stands behind the net. SLIDE your finger to move along
//     the line; you can keep diving once the ball is struck, at a keeper's
//     speed, so a soft shot gives you time and a hard one does not.
//
// Too hard and it clears the bar; too near a post and the woodwork has it.
// Three kicks each, alternating; most goals wins; sudden death if level.
// No shot clock: a penalty is taken when the taker is ready.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, effects } from '../engine/StageKit.js';

// ── Rules (as the 2D game) ───────────────────────────────────────────────────
const ROUNDS = 3, SUDDEN_MAX = 4;
const PULL_MIN = 26, PULL_MAX = 190;   // stage px
const PULL_SPAN_X = 0.26;              // fraction of the stage width = post to post
const FLIGHT_SOFT = 0.94, FLIGHT_HARD = 0.44;
const BASE_Y = 0.86, RISE = 0.95;      // height in the mouth (0 = bar, 1 = ground)
const KEEPER_W = 0.15, KEEPER_DIVE = 1.05, POST_MISS = 0.965, HIGH_GUARD = 0.62;
const SETTLE = 1.7;
// ── The pitch ────────────────────────────────────────────────────────────────
const GW = 6, GH = 2.2;                // goal mouth
const SPOT_Z = 9.5;
const RETICLE_LAYER = 1;               // drawn by the shooter's camera only

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _dir = null, _hud = null, _fx = null;
let _figs = [], _cams = [], _ball = null, _reticle = null, _net = null;
let _score = [0, 0], _kick = 0, _shooter = 0, _phase = 'intro', _phaseT = 0, _t = 0;
let _aim = { x: 0.5, y: BASE_Y }, _power = 0, _flight = FLIGHT_SOFT, _pull = null;
let _keeper = 0.5, _keeperTarget = 0.5, _outcome = '', _botTimer = 0, _hist = [];

// World x of a shot (the shooter's right is +x) and of the keeper (their right
// is −x: they face the other way).
const _aimWX = () => (_aim.x - 0.5) * GW;
const _keepWX = (k = _keeper) => -(k - 0.5) * GW;
const _keeperSlot = () => 1 - _shooter;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _score = [0, 0]; _kick = 0; _shooter = 0; _phase = 'intro'; _phaseT = 0; _t = 0; _hist = [];
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0b1630;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 50, background: 0x0b1630 });
    _hud = faceoffHud(_stage, { bg: 'rgba(10,20,40,.8)' });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _buildStadium();
        _cams = [0, 1].map(slot => {
            const c = new THREE.PerspectiveCamera(50, 1, 0.1, 140);
            c.up.set(0, slot === 0 ? 1 : -1, 0);  // the far half reads from its own end
            return c;
        });
    }
    _figs = [0, 1].map(slot => {
        const f = { slot };
        if (_stage.gl) {
            const c = _stage.character(slot);
            c.anim.play('ready');
            Object.assign(f, { rig: c.rig, anim: c.anim });
        }
        return f;
    });
    _place();
    _input();

    _dir.open({
        place: 'THE TERRITORY STADIUM · UNDER THE LIGHTS', title: 'PENALTY SHOOTOUT',
        sub: `${ROUNDS} KICKS EACH · ONE SHOOTS, ONE KEEPS`,
        from: { pos: [9, 6, 16], look: [0, 1, 2] },
        to: { pos: [0, 1.8, SPOT_Z + 3.4], look: [0, 1, 0] },
        onDone: () => { if (!_done) { if (_stage?.gl) _stage.views = [0, 1].map(slot => ({ camera: _cams[slot], rect: slot === 0 ? [0, 0, 1, 0.5] : [0, 0.5, 1, 0.5] })); _beginKick(); } },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.views = null; _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _cams = []; _ball = null; _reticle = null; _net = null; _dir = null; _hud = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── The stadium ──────────────────────────────────────────────────────────────
function _buildStadium() {
    const scene = _stage.scene;
    scene.fog = new THREE.Fog(0x0b1630, 40, 90);
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1d3a1d, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 0.8); key.position.set(6, 16, 12); scene.add(key);
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); _stage.add(m); return m; };
    // Striped pitch.
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 256;
    const g = cv.getContext('2d');
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#3f9a3f' : '#48a848'; g.fillRect(0, i * 32, 16, 32); }
    const tex = new THREE.CanvasTexture(cv);
    const pitch = add(new THREE.PlaneGeometry(60, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }), 0, 0, 8);
    pitch.rotation.x = -Math.PI / 2;
    // Lines: goal line, six-yard box, the box, the spot, the arc.
    const white = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
    const line = (x, z, w, d) => { const m = add(new THREE.PlaneGeometry(w, d), white, x, 0.012, z); m.rotation.x = -Math.PI / 2; };
    line(0, 0, 30, 0.08);
    [[GW + 3.2, 2.2], [GW + 11, 7.2]].forEach(([w, d]) => { line(-w / 2, d / 2, 0.08, d); line(w / 2, d / 2, 0.08, d); line(0, d, w, 0.08); });
    const spot = add(new THREE.CircleGeometry(0.13, 16), white, 0, 0.013, SPOT_Z); spot.rotation.x = -Math.PI / 2;
    const arc = add(new THREE.RingGeometry(3.6, 3.68, 32, 1, Math.PI * 0.2, Math.PI * 0.6), white, 0, 0.012, SPOT_Z);
    arc.rotation.x = -Math.PI / 2;
    // The goal: posts, bar and a net.
    const postM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    [-1, 1].forEach(s => add(new THREE.CylinderGeometry(0.07, 0.07, GH, 10), postM, s * GW / 2, GH / 2, 0));
    const bar = add(new THREE.CylinderGeometry(0.07, 0.07, GW + 0.14, 10), postM, 0, GH, 0); bar.rotation.z = Math.PI / 2;
    const ncv = document.createElement('canvas'); ncv.width = ncv.height = 64;
    const ng = ncv.getContext('2d'); ng.strokeStyle = 'rgba(255,255,255,.55)'; ng.lineWidth = 1.5;
    for (let i = 0; i <= 64; i += 8) { ng.beginPath(); ng.moveTo(i, 0); ng.lineTo(i, 64); ng.moveTo(0, i); ng.lineTo(64, i); ng.stroke(); }
    const ntex = new THREE.CanvasTexture(ncv); ntex.wrapS = ntex.wrapT = THREE.RepeatWrapping; ntex.repeat.set(26, 9);
    const netM = new THREE.MeshBasicMaterial({ map: ntex, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    _net = add(new THREE.PlaneGeometry(GW, GH, 8, 4), netM, 0, GH / 2, -1.4);
    [-1, 1].forEach(s => { const side = add(new THREE.PlaneGeometry(1.4, GH), netM, s * GW / 2, GH / 2, -0.7); side.rotation.y = Math.PI / 2; });
    const roof = add(new THREE.PlaneGeometry(GW, 1.4), netM, 0, GH, -0.7); roof.rotation.x = Math.PI / 2;
    // Stands at both ends, full of crowd, and four floodlights.
    const standM = new THREE.MeshStandardMaterial({ color: 0x24324f, roughness: 0.9 });
    const crowdCols = [0xef4444, 0x3b82f6, 0xfacc15, 0xf8fafc, 0x22c55e, 0xf97316];
    [[-9, 1], [SPOT_Z + 16, -1]].forEach(([z, face]) => {
        for (let tier = 0; tier < 4; tier++) add(new THREE.BoxGeometry(44, 1, 2), standM, 0, 0.5 + tier, z - face * tier * 2);
        const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.6, 0.4), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 280);
        const m4 = new THREE.Matrix4(), col = new THREE.Color();
        for (let i = 0; i < 280; i++) {
            const tier = i % 4;
            m4.makeTranslation(-21 + (i / 4 | 0) * 0.6 + Math.random() * 0.1, 1.3 + tier, z - face * tier * 2);
            crowd.setMatrixAt(i, m4); crowd.setColorAt(i, col.setHex(crowdCols[(Math.random() * crowdCols.length) | 0]));
        }
        _stage.add(crowd);
    });
    const poleM = new THREE.MeshStandardMaterial({ color: 0x9ca3af });
    [[-18, -8], [18, -8], [-18, SPOT_Z + 15], [18, SPOT_Z + 15]].forEach(([x, z]) => {
        add(new THREE.CylinderGeometry(0.2, 0.3, 14, 8), poleM, x, 7, z);
        add(new THREE.BoxGeometry(2.4, 1.2, 0.4), new THREE.MeshBasicMaterial({ color: 0xfffbe6 }), x, 14, z);
    });
    // The ball, and the aim ring only the shooter's camera draws.
    const bcv = document.createElement('canvas'); bcv.width = 128; bcv.height = 64;
    const bg = bcv.getContext('2d'); bg.fillStyle = '#fff'; bg.fillRect(0, 0, 128, 64); bg.fillStyle = '#111';
    [[16, 16], [56, 12], [96, 18], [36, 44], [76, 46], [116, 44]].forEach(([x, y]) => { bg.beginPath(); bg.arc(x, y, 8, 0, Math.PI * 2); bg.fill(); });
    const ball = add(new THREE.SphereGeometry(0.2, 18, 14), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(bcv), roughness: 0.5 }), 0, 0.2, SPOT_Z);
    _ball = { m: ball, from: null, to: null, bounce: null };
    _reticle = add(new THREE.RingGeometry(0.22, 0.3, 28), new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }), 0, 1, 0.05);
    _reticle.layers.set(RETICLE_LAYER);
    _reticle.renderOrder = 10;
}

// ── Input: which half, then that player's job on it ─────────────────────────
function _input() {
    // Screen → the player's own frame: P2 holds the phone from the far end.
    const local = (slot, p) => ({ x: slot === 0 ? p.x : _stage.width - p.x, y: slot === 0 ? p.y : _stage.height - p.y });
    const slotAt = p => (p.y >= _stage.height / 2 ? 0 : 1);
    _stage.listen('pointerdown', e => {
        e.preventDefault();
        if (_done) return;
        const p = _stage.toLocal(e.clientX, e.clientY), slot = slotAt(p);
        if (isBotSlot(slot)) return;
        const q = local(slot, p);
        if (slot === _shooter) { if (_phase === 'aim') _pull = { id: e.pointerId, x: q.x, y: q.y }; }
        else if (_phase === 'aim' || _phase === 'flight') _keeperAt(q.x);
    });
    _stage.listen('pointermove', e => {
        if (_done) return;
        const p = _stage.toLocal(e.clientX, e.clientY), slot = slotAt(p);
        if (isBotSlot(slot)) return;
        const q = local(slot, p);
        if (slot === _shooter) { if (_phase === 'aim' && _pull && _pull.id === e.pointerId) _setAim(q.x - _pull.x, q.y - _pull.y); }
        else if ((_phase === 'aim' || _phase === 'flight') && e.buttons !== 0) _keeperAt(q.x);
    });
    const up = e => {
        if (_done || !_pull || _pull.id !== e.pointerId) return;
        _pull = null;
        if (_phase === 'aim') _shoot();
    };
    _stage.listen('pointerup', up);
    _stage.listen('pointercancel', up);
}

function _setAim(px, py) {
    const len = Math.hypot(px, py);
    _power = Math.max(0, Math.min(1, (len - PULL_MIN) / (PULL_MAX - PULL_MIN)));
    _aim.x = Math.max(0, Math.min(1, 0.5 - px / (_stage.width * PULL_SPAN_X)));
    _aim.y = BASE_Y - RISE * _power;
}
/** The keeper's finger across their half is their spot on the line (their left → right). */
function _keeperAt(x) {
    _keeperTarget = Math.max(0, Math.min(1, (x / _stage.width - 0.12) / 0.76));
    if (_phase === 'aim') _keeper = _keeperTarget;
}

// ── Kicks ────────────────────────────────────────────────────────────────────
function _beginKick() {
    if (_done) return;
    _shooter = _kick % 2;
    _phase = 'aim'; _phaseT = 0; _outcome = ''; _pull = null;
    _aim = { x: 0.5, y: BASE_Y }; _power = 0; _flight = FLIGHT_SOFT;
    _keeper = 0.5; _keeperTarget = 0.5;
    if (_ball?.m) { _ball.m.position.set(0, 0.2, SPOT_Z); _ball.m.visible = true; _ball.bounce = null; }
    if (_net) _net.position.z = -1.4;
    _place();
    _camLayers();
    [0, 1].forEach(slot => {
        const shooting = slot === _shooter;
        _hud.hint(slot, seat(slot).bot ? '' : shooting ? 'PULL BACK AND LET GO · PULL LEFT TO PUT IT RIGHT' : 'SLIDE TO MOVE · KEEP DIVING AFTER THE KICK');
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = `KICK ${_kick + 1} · ${seat(_shooter).name} SHOOTS · ${_score[0]}–${_score[1]}`;
    sfx('countdown');
    _botTimer = isBotSlot(_shooter) ? 0.9 + (1 - _botSkill) * 0.9 + Math.random() * 0.5 : 0;
}

/** The taker behind the ball, the keeper on the line. */
function _place() {
    const s = _figs[_shooter], k = _figs[_keeperSlot()];
    if (s?.rig) { s.rig.root.position.set(-2.1, 0, SPOT_Z + 0.7); s.rig.root.rotation.set(0, 0, 0); s.anim.face(Math.PI - 0.9, true); s.anim.play('ready'); }
    if (k?.rig) { k.rig.root.position.set(0, 0, 0.45); k.rig.root.rotation.set(0, 0, 0); k.anim.face(0, true); k.anim.play('ready'); }
}

function _botShoot() {
    const side = Math.random() < 0.5 ? -1 : 1;
    const reach = 0.30 + _botSkill * 0.62 + (1 - _botSkill) * Math.random() * 0.34;
    _aim.x = 0.5 + side * Math.min(0.52, reach / 2);
    const ceiling = BASE_Y / RISE;
    _power = Math.max(0, Math.min(1, ceiling * (0.62 + _botSkill * 0.30) + (1 - _botSkill) * (Math.random() - 0.35) * 0.34));
    _aim.y = BASE_Y - RISE * _power;
    _shoot();
}

function _shoot() {
    if (_phase !== 'aim') return;
    _phase = 'flight'; _phaseT = 0;
    // A bot keeper guesses at the strike: often near the ball, sometimes not.
    if (isBotSlot(_keeperSlot())) {
        const aimK = 0.5 - _aimWX() / GW;                   // the shot, in the keeper's frame
        const guess = Math.random() < 0.18 + _botSkill * 0.62 ? aimK + (Math.random() - 0.5) * (1 - _botSkill) * 0.55 : Math.random();
        _keeper = _keeperTarget = Math.max(0, Math.min(1, guess));
    } else _keeperTarget = _keeper;
    _flight = FLIGHT_SOFT + (FLIGHT_HARD - FLIGHT_SOFT) * _power;
    const edge = Math.abs(_aim.x - 0.5) * 2;
    _outcome = _aim.y < 0 ? 'OVER' : edge > POST_MISS ? 'POST' : '';
    _ball.from = new THREE.Vector3(0, 0.2, SPOT_Z);
    const tx = edge > POST_MISS ? Math.sign(_aim.x - 0.5) * GW / 2 : _aimWX();
    _ball.to = new THREE.Vector3(tx, Math.max(0.2, GH * (1 - Math.max(-0.18, _aim.y))), 0);
    const s = _figs[_shooter];
    s.anim?.play('shove', { restart: true });
    sfx('boost'); haptic([18]);
}

function _resolve() {
    if (_outcome !== 'POST' && _outcome !== 'OVER') {
        const high = 1 - Math.max(0, Math.min(1, _aim.y));
        const reach = (KEEPER_W / 2 + 0.055) * GW * (1 - (1 - HIGH_GUARD) * high);
        _outcome = Math.abs(_keepWX() - _ball.to.x) <= reach ? 'SAVED' : 'GOAL';
    }
    _hist.push({ shooter: _shooter, outcome: _outcome });
    const s = _figs[_shooter], k = _figs[_keeperSlot()];
    const at = _ball.m ? _ball.m.position.clone() : null;
    if (_outcome === 'GOAL') {
        _score[_shooter]++; sfx('coin_gain'); haptic('heavy');
        _ball.bounce = { v: new THREE.Vector3(0, -0.5, -7), until: -1.25 };
        s.anim?.play('raise', { restart: true }); k.anim?.play('hit', { restart: true });
        if (at) _fx.confetti(new THREE.Vector3(at.x, 1.5, 0), [0xfacc15, 0xffffff, seat(_shooter).color], 26, 3);
    } else {
        sfx('land_bad');
        const v = _outcome === 'SAVED' ? new THREE.Vector3((Math.random() - 0.5) * 4, 3, 7)
                : _outcome === 'POST' ? new THREE.Vector3(-Math.sign(_ball.to.x) * 3, 1.5, 6)
                : new THREE.Vector3(0, 4, -9);
        _ball.bounce = { v, until: null };
        if (_outcome === 'SAVED') { k.anim?.play('raise', { restart: true }); if (at) _fx.burst(at, 0xffffff, 0.25, 0.2); }
        else if (_outcome === 'POST') sfx('slam');
    }
    const said = { GOAL: ['GOAL!', '#facc15'], SAVED: ['SAVED!', '#60a5fa'], POST: ['OFF THE POST!', '#f97316'], OVER: ['OVER THE BAR!', '#f87171'] }[_outcome];
    _hud.say(said[0], `${seat(0).name} ${_score[0]} – ${_score[1]} ${seat(1).name}`, SETTLE * 1000, _t, said[1]);
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = `${said[0]}   ${seat(0).name} ${_score[0]} · ${_score[1]} ${seat(1).name}`;
    _phase = 'settle'; _phaseT = 0;
}

function _nextKick() {
    _kick++;
    const done = _kick >= ROUNDS * 2;
    if (done && _score[0] === _score[1] && _kick < ROUNDS * 2 + SUDDEN_MAX) { _beginKick(); return; }
    if (done) { _end(); return; }
    _beginKick();
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'aim' && _botTimer > 0) { _botTimer -= dt; if (_botTimer <= 0) _botShoot(); }
    if (_phase === 'flight') {
        // A bot keeper tracks the ball after a reaction delay, with an error.
        if (isBotSlot(_keeperSlot()) && _phaseT > 0.10 + (1 - _botSkill) * 0.30 && !_ball.tracked) {
            _ball.tracked = true;
            const aimK = 0.5 - _ball.to.x / GW;
            _keeperTarget = Math.max(0, Math.min(1, aimK + (1 - _botSkill) * 0.42 * (Math.random() - 0.5)));
        }
        const step = KEEPER_DIVE * dt;
        _keeper += Math.max(-step, Math.min(step, _keeperTarget - _keeper));
        const p = Math.min(1, _phaseT / _flight);
        if (_ball.m) {
            _ball.m.position.lerpVectors(_ball.from, _ball.to, p);
            _ball.m.position.y += Math.sin(p * Math.PI) * 0.35 * (1 - _power);
            _ball.m.rotation.x -= dt * 22;
        }
        if (p >= 1) _resolve();
    } else if (_phase === 'settle') {
        const b = _ball;
        if (b?.m && b.bounce) {
            const v = b.bounce.v;
            if (b.bounce.until != null) {
                // Into the net, which gives.
                b.m.position.addScaledVector(v, dt);
                if (b.m.position.z < b.bounce.until) { b.m.position.z = b.bounce.until; v.set(0, 0, 0); }
                if (_net) _net.position.z = Math.min(-1.4, b.m.position.z - 0.25);
                b.m.position.y = Math.max(0.2, b.m.position.y - dt * 1.5);
            } else {
                v.y -= 9.8 * dt;
                b.m.position.addScaledVector(v, dt);
                if (b.m.position.y < 0.2) { b.m.position.y = 0.2; v.y = Math.abs(v.y) * 0.45; v.x *= 0.8; v.z *= 0.8; }
            }
        }
        if (_phaseT >= SETTLE) { if (_ball) _ball.tracked = false; _nextKick(); }
    }
    _draw(dt);
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    _renderHud();
}

function _draw(dt) {
    if (!_stage?.gl || _phase === 'over' || _phase === 'intro') return;
    // Keeper: slides along the line, and leans into a dive when moving fast.
    const k = _figs[_keeperSlot()];
    if (k.rig) {
        const x = _keepWX(), prev = k.rig.root.position.x;
        const vx = (x - prev) / Math.max(dt, 1e-3);
        k.rig.root.position.x = x;
        const lean = _phase === 'flight' || _phase === 'settle' ? Math.max(-1, Math.min(1, vx / 5)) : 0;
        k.rig.root.rotation.z += (-lean * 1.1 - k.rig.root.rotation.z) * Math.min(1, dt * 10);
        k.rig.root.position.y = Math.abs(k.rig.root.rotation.z) * 0.25;
    }
    // The aim ring, in the mouth, coloured by the risk of the shot.
    if (_reticle) {
        _reticle.visible = _phase === 'aim' && !isBotSlot(_shooter);
        const edge = Math.abs(_aim.x - 0.5) * 2;
        _reticle.position.set(_aimWX(), Math.max(0.25, GH * (1 - Math.max(-0.18, _aim.y))), 0.05);
        _reticle.material.color.setHex(_aim.y < 0 ? 0xef4444 : edge > POST_MISS ? 0xf97316 : edge > 0.88 ? 0xfacc15 : 0x4ade80);
        _reticle.scale.setScalar(1 + (1 - _power) * 0.6);
    }
    // Cameras: the shooter behind the ball, the keeper behind the net.
    _camLayers();
    [0, 1].forEach(slot => {
        const cam = _cams[slot];
        if (!cam) return;
        const shooting = slot === _shooter;
        // The taker stands out of their own shot; the keeper's camera looks
        // over their own head at the spot.
        const pos = shooting ? [0.8, 2.2, SPOT_Z + 4.8] : [0, 4.3, -4.4];
        const look = shooting ? [0, 0.9, 0] : [0, 0.3, SPOT_Z * 0.72];
        cam.position.set(...pos); cam.lookAt(...look);
    });
}

/** The aim ring is on a layer only the shooter's camera draws. */
function _camLayers() {
    _cams.forEach((cam, slot) => { cam.layers.set(0); if (slot === _shooter) cam.layers.enable(RETICLE_LAYER); });
}

function _renderHud() {
    if (!_hud) return;
    [0, 1].forEach(slot => {
        const shooting = slot === _shooter;
        _hud.line(slot, `${shooting ? '⚽ YOU SHOOT' : '🧤 YOU KEEP'} · KICK ${_kick + 1} · ${_score[slot]}–${_score[1 - slot]}`);
        if (shooting && _phase === 'aim' && !seat(slot).bot && (_pull || _power > 0)) {
            const n = Math.round(_power * 10), edge = Math.abs(_aim.x - 0.5) * 2;
            const warn = _aim.y < 0 ? ' · OVER THE BAR!' : edge > POST_MISS ? ' · THE POST!' : '';
            _hud.hint(slot, `POWER ${'■'.repeat(n)}${'□'.repeat(10 - n)}${warn}`);
        }
    });
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    const w = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;
    if (_stage) _stage.views = null;               // the director's shots are full-frame
    if (_reticle) _reticle.visible = false;
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? `LEVEL AT ${_score[0]} – ${_score[1]}` : `${_score[w]} – ${_score[1 - w]}`,
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    const cams = _cams.map(c => ({ reticle: c.layers.test(_reticle ? _reticle.layers : new THREE.Layers()) }));
    return { phase: _phase, kick: _kick, shooter: _shooter, score: [..._score], outcome: _outcome, hist: _hist.slice(),
             aim: { x: +_aim.x.toFixed(3), y: +_aim.y.toFixed(3) }, power: +_power.toFixed(3),
             keeper: +_keeper.toFixed(3), keeperWX: +_keepWX().toFixed(2), cams,
             views: _stage?.views ? _stage.views.length : 0, gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: take this kick from code (aim x 0–1 in the shooter's frame, power 0–1). */
export function _debugShoot(x, power) {
    if (_phase !== 'aim') return;
    _power = power; _aim.x = x; _aim.y = BASE_Y - RISE * power; _shoot();
}
/** Probes: put the keeper at k (0–1 in the keeper's frame), and keep them there. */
export function _debugKeeper(k) { _keeper = _keeperTarget = k; }
