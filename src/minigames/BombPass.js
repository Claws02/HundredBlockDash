// ============================================================
// HOT POTATO — one lit bomb in the works yard, and neither of you wants it.
// (3D rebuild of Bomb Pass; the 2D original is in archived/BombPass.js.)
//
// Face-off hold, one shared overhead camera. You stand at your end of the
// yard; the bomb is lobbed back and forth between you.
//
//   TAP while the bomb is on YOUR side of the line to bat it back. Every
//   return sends it faster. Let it reach you and it goes off in your hands.
//
// The fuse is the second clock: it burns down the whole round, you can see it
// shorten on the bomb, and when it runs out the bomb blows wherever it is —
// whoever's side that is loses the round. Tapping while it is on THEIR side is
// a whiff and locks you out briefly, so mashing does not work. First to 3.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects, overheadCam } from '../engine/StageKit.js';

// ── Rules (the 2D game's, in world units: one px of the old half = 1/84.5 u) ─
const W = 6, D = 10;
const WALL = 4.0;                        // |z| where the bomb reaches a player
const WIN_ROUNDS = 3;
const SERVE_HANG = 0.85;
const SPEED_0 = 2.75, SPEED_MUL = 1.085, SPEED_MAX = 13.6;
const FUSE_MIN = 7.0, FUSE_MAX = 11.5;
const WHIFF = 0.34, BLAST = 1.6;
const MATCH_TIME = 56;
const FIG_SCALE = 1.0;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _figs = [], _bomb = null, _mesh = null, _halves = [];
let _wins = [0, 0], _round = 0, _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0;
let _lock = [0, 0], _botNext = null, _shake = 0, _frozen = false, _loser = -1;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _wins = [0, 0]; _round = 0; _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0;
    _lock = [0, 0]; _botNext = null; _shake = 0; _frozen = false; _loser = -1; _bomb = null;
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#3a2418;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 38, background: 0x3a2418 });
    _hud = faceoffHud(_stage);
    _in = touch(_stage, { split: 'y', onDown: slot => _swing(slot) });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _stage.camera.up.set(0, 0, -1);          // P1's end at the bottom of the phone
        _set = STAGE_SETS.ind(_stage, { w: W, d: D });
        _buildYard();
    }
    _figs = [0, 1].map(_buildFig);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'TAP WHEN IT\'S ON YOUR SIDE'));

    _dir.open({
        place: 'THE WORKS YARD · SHIFT CHANGE', title: 'HOT POTATO',
        sub: `ONE LIT BOMB · FIRST TO ${WIN_ROUNDS}`,
        from: { pos: [7, 5, 7], look: [0, 1, 0] },
        to: overheadCam(_stage, W, D, 3),
        onDone: () => { if (!_done) _serve(); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _mesh = null; _halves = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── The yard, the halves, the bomb ──────────────────────────────────────────
function _buildYard() {
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); _stage.add(m); return m; };
    // Each side of the line tinted its player's colour; it glows when the bomb is on it.
    _halves = [0, 1].map(slot => {
        const m = add(new THREE.PlaneGeometry(W, D / 2), new THREE.MeshBasicMaterial({ color: seat(slot).color, transparent: true, opacity: 0.12, depthWrite: false }), 0, 0.01, (slot === 0 ? 1 : -1) * D / 4);
        m.rotation.x = -Math.PI / 2;
        return m;
    });
    const line = add(new THREE.PlaneGeometry(W, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 0.02, 0);
    line.rotation.x = -Math.PI / 2;
    // The bomb: a black iron ball, a brass cap, a fuse that burns down, a spark.
    const g = new THREE.Group();
    const iron = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.35, metalness: 0.6 }));
    iron.castShadow = true; g.add(iron);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 10), new THREE.MeshStandardMaterial({ color: 0xb08d3a, metalness: 0.7, roughness: 0.3 }));
    cap.position.y = 0.34; g.add(cap);
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), new THREE.MeshStandardMaterial({ color: 0xd9c89a }));
    fuse.geometry.translate(0, 0.5, 0); fuse.position.y = 0.38; fuse.rotation.z = -0.35; g.add(fuse);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
    g.add(spark);
    const glow = new THREE.PointLight(0xff9a3c, 0.8, 3); g.add(glow);
    const shadow = add(new THREE.RingGeometry(0.25, 0.4, 24), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8, depthWrite: false }), 0, 0.03, 0);
    shadow.rotation.x = -Math.PI / 2;
    g.scale.setScalar(1.3);                      // read from overhead, at phone size
    _stage.add(g);
    _mesh = { g, fuse, spark, glow, shadow };
    g.visible = false; shadow.visible = false;
}

function _buildFig(slot) {
    const f = { slot, z: (slot === 0 ? 1 : -1) * (WALL + 0.55) };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        c.rig.root.position.set(0, 0, f.z);
        c.anim.face(slot === 0 ? Math.PI : 0, true);
        c.anim.play('ready');
        Object.assign(f, { rig: c.rig, anim: c.anim });
    }
    return f;
}

// ── Rounds ───────────────────────────────────────────────────────────────────
function _serve() {
    if (_done) return;
    const fuse = FUSE_MIN + Math.random() * (FUSE_MAX - FUSE_MIN);
    // Served toward whoever is ahead, so a lead is never a rest.
    const toward = _wins[0] === _wins[1] ? (Math.random() < 0.5 ? 1 : -1) : (_wins[0] > _wins[1] ? 1 : -1);
    _bomb = { z: 0, vz: toward * SPEED_0, speed: SPEED_0, fuse, fuseMax: fuse, rallies: 0, hang: SERVE_HANG };
    _lock = [0, 0]; _botNext = null; _loser = -1;
    _phase = 'live'; _phaseT = 0;
    _figs.forEach(f => f.anim?.play('ready'));
    if (_mesh) { _mesh.g.visible = true; _mesh.shadow.visible = true; }
    _hud.say(`ROUND ${_round + 1}`, `${seat(0).name} ${_wins[0]} – ${_wins[1]} ${seat(1).name}`, 1100, _t, '#ff9a3c');
    sfx('countdown');
}

const _inHalf = slot => !!_bomb && (slot === 0 ? _bomb.z > 0 : _bomb.z < 0);

function _swing(slot) {
    if (_phase !== 'live' || !_bomb || _bomb.hang > 0) return;
    if (_clock < _lock[slot]) return;
    const f = _figs[slot];
    f.anim?.play('shove', { restart: true });
    if (_inHalf(slot)) {
        _bomb.rallies++;
        _bomb.speed = Math.min(SPEED_MAX, _bomb.speed * SPEED_MUL);
        _bomb.vz = (slot === 0 ? -1 : 1) * _bomb.speed;
        sfx('boost');
        if (!isBotSlot(slot)) haptic([16]);
        if (_stage?.gl) _fx.burst(_mesh.g.position.clone(), 0xffd166, 0.25, 0.15);
    } else {
        // Swung at nothing: the lockout is what stops mashing from working.
        _lock[slot] = _clock + WHIFF;
        sfx('land_bad');
        if (!isBotSlot(slot)) haptic([30]);
    }
}

function _detonate(loser) {
    if (_phase !== 'live') return;
    _phase = 'blast'; _phaseT = 0; _loser = loser;
    _wins[1 - loser]++;
    sfx('boom'); haptic('heavy');
    _shake = 0.5;
    if (_stage?.gl) {
        const at = _mesh.g.position.clone();
        _fx.burst(at, 0xff9a3c, 1.1, 0.4);
        _fx.burst(at, 0xffe9a8, 0.6, 0.25);
        _fx.puff(at, 0x3a3a3a, 10, 1.2, 2.2);
        _fx.confetti(at, [0x1b1b1f, 0xff9a3c, 0xffd166], 24, 4);
        _mesh.g.visible = false; _mesh.shadow.visible = false;
    }
    _figs[loser].anim?.play('hit', { restart: true });
    _figs[1 - loser].anim?.play('raise', { restart: true });
    _hud.say('BOOM!', `${seat(loser).name} WAS HOLDING IT · ${_wins[0]} – ${_wins[1]}`, BLAST * 1000, _t, '#ff9a3c');
}

// ── Bot (§5): wait until the bomb is really on its side, then return it with a
// margin against the time it HAS — so a fast bomb squeezes it as it squeezes a
// player. Sometimes it panics and swings at thin air first. ─────────────────
function _botStep(slot) {
    if (_phase !== 'live' || !_bomb || _bomb.hang > 0 || _clock < _lock[slot]) return;
    if (!_inHalf(slot)) { _botNext = null; return; }
    const toward = slot === 0 ? _bomb.vz > 0 : _bomb.vz < 0;
    const ttl = toward ? (WALL - Math.abs(_bomb.z)) / Math.abs(_bomb.vz) : 9;
    if (_botNext == null) {
        const margin = 0.09 + (1 - _botSkill) * 0.26 + Math.random() * 0.12;
        _botNext = _clock + Math.max(0, ttl - margin);
        if (Math.random() < 0.26 - _botSkill * 0.24) _swingAtNothing(slot);
    }
    if (_clock >= _botNext) { _swing(slot); _botNext = null; }
}
function _swingAtNothing(slot) { _lock[slot] = _clock + WHIFF; _figs[slot].anim?.play('shove', { restart: true }); sfx('land_bad'); }

// ── The loop ─────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'live' || _phase === 'blast') _clock += dt;
    if (_phase === 'live' && _bomb && !_frozen) {
        if (_bomb.hang > 0) _bomb.hang -= dt;
        else _bomb.z += _bomb.vz * dt;
        _bomb.fuse -= dt;
        if (_bomb.fuse <= 0) _detonate(_bomb.z > 0 ? 0 : 1);
        else if (_bomb.z >= WALL) _detonate(0);
        else if (_bomb.z <= -WALL) _detonate(1);
        [0, 1].forEach(slot => { if (isBotSlot(slot)) _botStep(slot); });
    } else if (_phase === 'blast' && _phaseT >= BLAST) {
        if (_wins[0] >= WIN_ROUNDS || _wins[1] >= WIN_ROUNDS) _end(_wins[0] > _wins[1] ? 0 : 1);
        else { _round++; _serve(); }
    }
    if (_phase !== 'over' && _clock >= MATCH_TIME && _phase !== 'blast') _end(_wins[0] === _wins[1] ? -1 : _wins[0] > _wins[1] ? 0 : 1);
    _draw(dt);
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!dirOwns && _stage?.gl && _phase !== 'over') {
        const c = overheadCam(_stage, W, D, 3), cam = _stage.camera;
        _shake = Math.max(0, _shake - dt);
        const j = _shake * 0.5;
        cam.position.set(c.pos[0] + (Math.random() - 0.5) * j, c.pos[1] + (Math.random() - 0.5) * j, c.pos[2] + (Math.random() - 0.5) * j);
        cam.lookAt(...c.look);
    }
    _renderHud();
}

function _draw(dt) {
    if (!_mesh || !_bomb) return;
    const z = _bomb.z, k = Math.min(1, Math.abs(z) / WALL);
    const y = 1.0 + 1.5 * (1 - k * k);                     // a lob: high over the line, hand-height at each end
    _mesh.g.position.set(0, y, z);
    _mesh.g.rotation.x += _bomb.vz * dt * (_bomb.hang > 0 ? 0 : 1.2);
    const left = Math.max(0, _bomb.fuse / _bomb.fuseMax);
    _mesh.fuse.scale.y = 0.05 + 0.55 * left;
    // The spark rides the end of the fuse, and flickers faster as it gets short.
    const tip = new THREE.Vector3(0, 0.38, 0).add(new THREE.Vector3(Math.sin(0.35), Math.cos(0.35), 0).multiplyScalar(_mesh.fuse.scale.y));
    _mesh.spark.position.copy(tip);
    const fl = 0.7 + Math.random() * 0.6 * (1.2 - left);
    _mesh.spark.scale.setScalar(fl);
    _mesh.spark.material.color.setHex(left < 0.3 ? 0xff4d2d : 0xffd166);
    _mesh.glow.position.copy(tip); _mesh.glow.intensity = 0.6 + fl * 0.5;
    _mesh.shadow.position.set(0, 0.03, z);
    _mesh.shadow.material.color.setHex(left < 0.3 ? 0xff4d2d : left < 0.6 ? 0xff9a3c : 0xffd166);
    _halves.forEach((h, slot) => { h.material.opacity = _phase === 'live' && _inHalf(slot) ? 0.3 + Math.sin(_t * 12) * 0.08 : 0.1; });
}

function _renderHud() {
    if (!_hud) return;
    [0, 1].forEach(slot => {
        _hud.line(slot, `💣 ROUND ${_round + 1} · ${_wins[slot]}–${_wins[1 - slot]} · FIRST TO ${WIN_ROUNDS}`);
        if (seat(slot).bot) return;
        const mine = _phase === 'live' && _bomb && _bomb.hang <= 0 && _inHalf(slot);
        _hud.hint(slot, _clock < _lock[slot] ? 'WHIFF!' : mine ? 'IT\'S YOURS — TAP!' : _round === 0 ? 'TAP WHEN IT\'S ON YOUR SIDE' : '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'live') el.textContent = `${seat(0).name} ${_wins[0]} – ${_wins[1]} ${seat(1).name}`;
}

function _end(w) {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    if (_mesh) { _mesh.g.visible = false; _mesh.shadow.visible = false; }
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? `LEVEL AT ${_wins[0]} – ${_wins[1]}` : `${_wins[w]} – ${_wins[1 - w]}`,
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, round: _round, wins: [..._wins], clock: +_clock.toFixed(2), loser: _loser,
             lock: _lock.map(l => +Math.max(0, l - _clock).toFixed(2)),
             bomb: _bomb ? { z: +_bomb.z.toFixed(2), vz: +_bomb.vz.toFixed(2), fuse: +_bomb.fuse.toFixed(2), hang: +_bomb.hang.toFixed(2), rallies: _bomb.rallies } : null,
             gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: stop the bomb and its fuse where they are. */
export function _debugFreeze(on) { _frozen = !!on; }
/** Probes: put the bomb at z moving at vz, with `fuse` seconds left. */
export function _debugBomb(z, vz, fuse) { if (_bomb) Object.assign(_bomb, { z, vz, hang: 0, ...(fuse != null ? { fuse } : {}) }); }
