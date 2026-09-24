// ============================================================
// __TITLE__ — a 3D stage game.  (Built from src/minigames/_template3d.js.)
//
// Read docs/MINIGAME_3D_PLAYBOOK.md before changing the shape of this file.
// As it stands this is a complete, playable face-off game so a fresh copy runs
// on the first try: coins drop into the works yard, each player DRAGS on their
// half to run, and the most coins at the whistle wins. Replace the rules; keep
// the skeleton:
//
//   start()  → stage, set, figures, HUD, input, director.open()
//   _frame() → phases 'intro' → 'ready' → 'play' → 'over'
//   _end()   → director.close() → _finish(winner) → onWin, exactly once
//   _destroy → stage.dispose() and the overlay; registered for force-ends
//
// Reference games: TurfWar.js (face-off, overhead), HighNoon.js (side-on),
// RiftDive.js (split screen), RooftopRun.js (travelling camera).
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects, overheadCam } from '../engine/StageKit.js';

// ── Tuning (seconds and world units — never frames, R1) ─────────────────────
const W = 10, D = 18;              // the floor, in world units (x across, z along)
const MATCH_TIME = 25;             // s of play; the whole game is 15–40 s (§3)
const READY_TIME = 1.2;            // s of "GO!" before input counts
const SPEED = 5;                   // units per second at full drag
const BODY = 0.45;                 // figure radius, for bumps and pickups
const COIN_EVERY = 0.9, COINS_MAX = 6;
const FIG_SCALE = 1.25;            // figures read small from an overhead camera
const SET = '__SET__';             // a STAGE_SETS key: ind, fin, fae, shop, ...
const PLACE = '__PLACE__';         // the opening card's location line

// ── Module state — start() resets all of it, _destroy() clears it ───────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _figs = [], _coins = [], _score = [0, 0], _bot = [];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _nextCoin = 0;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _nextCoin = 0.5;
    _coins = []; _score = [0, 0];
    _bot = [0, 1].map(() => ({ think: 0, tx: 0, tz: 0 }));
    registerMinigameCleanup(_destroy);                         // R3: force-ends land here

    // R2: our own id-less overlay inside #minigame-layer.
    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#20242c;z-index:5;';
    mg.appendChild(_overlay);

    // The stage: renderer, scene, camera, rigs, DPR cap and adaptive resolution.
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 38, background: 0x20242c });
    _hud = faceoffHud(_stage);                                 // a strip at each end
    _in = touch(_stage, { split: 'y' });                       // per-seat drag on each half
    _fx = effects(_stage);                                     // bursts, puffs, confetti
    _dir = createDirector(_stage);                             // opening shot and verdict
    if (_stage.gl) {
        _stage.camera.up.set(0, 0, -1);                        // face-off: P2's end is "up" for every shot
        _set = STAGE_SETS[SET] ? STAGE_SETS[SET](_stage, { w: W, d: D }) : null;
    }
    _figs = [0, 1].map(_buildFig);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'DRAG TO RUN · GRAB THE COINS'));

    _dir.open({
        place: PLACE, title: '__TITLE__', sub: 'MOST COINS WINS',
        from: { pos: [6, 8, 16], look: [0, 0, 2] },
        to: overheadCam(_stage, W, D, 8),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);                                      // capped dt; rigs animate before _frame
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }           // geometry, materials, GL, listeners; board resumes
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _coins = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null;
}
// R6: the one way out. Guarded, so a late callback can never report twice.
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── Figures ──────────────────────────────────────────────────────────────────
function _buildFig(slot) {
    // Logic lives on plain numbers; the rig only mirrors them. If WebGL is
    // missing (stage.gl false) the round still plays and still ends.
    const f = { slot, x: 0, z: (slot === 0 ? 1 : -1) * (D / 2 - 1.5), face: slot === 0 ? Math.PI : 0, moving: false };
    if (_stage.gl) {
        const c = _stage.character(slot);                      // the seat's own figure, rigged
        c.rig.root.scale.setScalar(FIG_SCALE);
        c.rig.root.position.set(f.x, 0, f.z);
        c.anim.face(f.face, true);
        Object.assign(f, { rig: c.rig, anim: c.anim });
    }
    return f;
}

// ── Coins ────────────────────────────────────────────────────────────────────
function _spawnCoin() {
    const c = { x: (Math.random() - 0.5) * (W - 2), z: (Math.random() - 0.5) * (D - 4), mesh: null };
    if (_stage.gl) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 20),
            new THREE.MeshStandardMaterial({ color: 0xf5c842, emissive: 0x6b4a00, metalness: 0.6, roughness: 0.3 }));
        m.rotation.x = Math.PI / 2; m.position.set(c.x, 0.6, c.z); m.castShadow = true;
        _stage.add(m);                                         // stage.add: disposed with the stage
        c.mesh = m;
    }
    _coins.push(c);
}
function _take(i, f) {
    const c = _coins[i];
    if (c.mesh) { _stage.scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh.material.dispose(); }
    _coins.splice(i, 1);
    _score[f.slot]++;
    sfx('coin_gain'); haptic([10]);                            // R7: registered sfx names only
    if (_stage?.gl) _fx.burst(new THREE.Vector3(c.x, 0.6, c.z), seat(f.slot).color, 0.4, 0.25);
    f.anim?.flinch?.();
}

// ── Bot (§5 of MINIGAME_STANDARD: reads botSkill, is noisy, is beatable) ────
function _botMove(slot, dt) {
    const f = _figs[slot], b = _bot[slot];
    b.think -= dt;
    if (b.think <= 0) {
        b.think = 0.7 - _botSkill * 0.45 + Math.random() * 0.25;       // slower to re-plan when easy
        let best = null, bd = Infinity;
        _coins.forEach(c => { const d = Math.hypot(c.x - f.x, c.z - f.z) + Math.random() * (1 - _botSkill) * 6; if (d < bd) { bd = d; best = c; } });
        if (best) { b.tx = best.x; b.tz = best.z; }
    }
    const dx = b.tx - f.x, dz = b.tz - f.z, d = Math.hypot(dx, dz) || 1;
    const sp = 0.7 + 0.3 * _botSkill;
    return d < 0.3 ? { dx: 0, dz: 0 } : { dx: dx / d * sp, dz: dz / d * sp };
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') _hud.say('GO!', 'GRAB THE COINS', READY_TIME * 1000, _t);
    else if (phase === 'play') sfx('go');
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready' && _phaseT > READY_TIME) _enter('play');

    if (_phase === 'play') {
        _clock += dt;
        if (_clock >= _nextCoin && _coins.length < COINS_MAX) { _spawnCoin(); _nextCoin = _clock + COIN_EVERY; }
        _figs.forEach(f => {
            const mv = isBotSlot(f.slot) ? _botMove(f.slot, dt) : (s => ({ dx: s.dx, dz: s.dy }))(_in.seat(f.slot));
            const m = Math.hypot(mv.dx, mv.dz);
            f.moving = m > 0.12;
            if (f.moving) {
                f.x = Math.max(-W / 2 + BODY, Math.min(W / 2 - BODY, f.x + mv.dx * SPEED * dt));
                f.z = Math.max(-D / 2 + BODY, Math.min(D / 2 - BODY, f.z + mv.dz * SPEED * dt));
                // Turn toward travel at a capped rate, the short way round.
                let d = Math.atan2(mv.dx, mv.dz) - f.face; d = Math.atan2(Math.sin(d), Math.cos(d));
                f.face += Math.max(-12 * dt, Math.min(12 * dt, d));
            }
            for (let i = _coins.length - 1; i >= 0; i--) {
                if (Math.hypot(_coins[i].x - f.x, _coins[i].z - f.z) < BODY + 0.4) _take(i, f);
            }
        });
        // Bodies bump rather than pass through each other.
        const [a, b] = _figs, dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
        if (d < BODY * 2 && d > 1e-4) {
            const push = (BODY * 2 - d) / 2 + 0.05;
            a.x += dx / d * push; a.z += dz / d * push; b.x -= dx / d * push; b.z -= dz / d * push;
        }
        if (MATCH_TIME - _clock < 5.05 && MATCH_TIME - _clock > 4.95) _hud.say('5 SECONDS!', '', 900, _t, '#facc15');
        if (_clock >= MATCH_TIME) _end();
    }

    // Mirror logic onto the scene.
    _figs.forEach(f => {
        if (!f.rig) return;
        f.rig.root.position.set(f.x, 0, f.z);
        f.anim.face(f.face, true);
        f.anim.play(f.moving ? 'walk' : 'ready', { rate: 3.4 });
    });
    _coins.forEach(c => { if (c.mesh) c.mesh.rotation.z += dt * 3; });
    _set?.update?.(dt, _t);
    _fx?.update(dt);
    // While the director has a shot running (open or close), it owns the camera.
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!dirOwns && _stage?.gl && _phase !== 'over') {
        const c = overheadCam(_stage, W, D, 8);
        _stage.camera.position.fromArray(c.pos);
        _stage.camera.lookAt(0, 0, 0);
    }
    _renderHud();
}

function _renderHud() {
    if (!_hud) return;
    const left = Math.max(0, Math.ceil(MATCH_TIME - _clock));
    [0, 1].forEach(slot => {
        _hud.line(slot, `🪙 YOU ${_score[slot]} · ${left}s · THEM ${_score[1 - slot]}`);
        if (_clock > 6) _hud.hint(slot, '');
    });
    // The neutral status line the manager draws down the middle.
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `${left}s · ${seat(0).name} ${_score[0]} – ${_score[1]} ${seat(1).name}`;
}

function _end() {
    _phase = 'over';
    _hud.say('');
    const w = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;   // -1 is a draw
    _dir.close({
        winner: w,
        figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? 'A DEAD HEAT' : `${_score[w]} COINS`,
        // Shoot the winner from their own end of the table. Scale the distance
        // with FIG_SCALE: at 6 units a 1.25x figure fills the whole frame.
        closeUp: (f, p) => ({ pos: [p.x + 2, p.y + 8.5 * FIG_SCALE, p.z + (f.slot === 0 ? 1 : -1) * 8 * FIG_SCALE], look: [p.x, p.y + 0.8, p.z] }),
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks (qa/__KEY__.js reads these; they never run in play) ─────────
export function _debugState() {
    return { phase: _phase, clock: +_clock.toFixed(2), score: [..._score], coins: _coins.length,
             pos: _figs.map(f => [+f.x.toFixed(2), +f.z.toFixed(2)]), gl: !!_stage?.gl, turned: !!_stage?.turned };
}
export function _debugCoinAt(x, z) { _spawnCoin(); const c = _coins[_coins.length - 1]; c.x = x; c.z = z; c.mesh?.position.set(x, 0.6, z); }
