// ============================================================
// SNOWBALL FIGHT — the winter yard, a half each, three hits and you're out.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Face-off hold, seen from above. Each of you has a half of the yard with two
// low snow walls in it.
//
//   DRAG on your half to run.
//   FLICK (a quick swipe) to throw — the way you flick is the way it goes, and
//   a longer flick throws further.
//   STAND STILL to crouch and pack snow: a snowball every second, three at most.
//
// A throw is a lob that drops as it goes. Crouched behind a wall you are safe
// from anything thrown straight at you: to hit somebody who is hiding, come
// round the side of their wall. Three hits and you're
// out; after 45 s, fewest hits taken wins.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects, overheadCam } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const W = 10, D = 14;
const MID = 0.7;                           // no one crosses within this of the line
const SPEED = 3.6, BODY = 0.42;
const HITS = 3, MATCH_TIME = 45, READY_TIME = 1.4;
const AMMO_MAX = 3, AMMO_START = 2, PACK = 1.0;   // s of standing still per snowball
const CROUCH_AFTER = 0.2;                  // s still before you are down
const FLICK_MS = 320;                      // a release this quick, having moved, is a throw
const V_MIN = 7.5, V_MAX = 12.5;           // horizontal speed, short flick → long flick
const LAUNCH_Y = 1.5, VY0 = 2.0, G = 9.8;
const STAND_H = 1.7, CROUCH_H = 0.95;      // what a ball has to be under to hit you
const WALL_H = 1.1;
const FLINCH = 0.45, COOLDOWN = 0.35;
const FIG_SCALE = 1.1;
// Two walls a side: (x, z, half-width, half-depth). Mirrored for P2.
const WALLS = [[-2.3, 2.6, 1.3, 0.3], [2.4, 4.3, 1.2, 0.3]].flatMap(([x, z, hw, hd]) => [
    { x, z, hw, hd }, { x: -x, z: -z, hw, hd },
]);

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _dir = null, _hud = null, _in = null, _fx = null;
let _figs = [], _balls = [], _flakes = null, _bot = [];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _winner = -2, _endAt = 0;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _winner = -2; _endAt = 0; _balls = [];
    _bot = [0, 1].map(() => ({ think: 0, tx: 0, tz: 0, throwAt: 1 + Math.random() }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#cfe6f7;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 38, background: 0xcfe6f7 });
    _hud = faceoffHud(_stage, { bg: 'rgba(20,40,70,.78)' });
    _in = touch(_stage, { split: 'y', stick: 70, onRelease: (slot, r) => _release(slot, r) });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _stage.camera.up.set(0, 0, -1);          // P1's end at the bottom of the phone
        _buildYard();
    }
    _figs = [0, 1].map(_buildFig);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'DRAG TO RUN · FLICK TO THROW · STAND STILL TO PACK'));

    _dir.open({
        place: 'THE TERRITORY · THE WINTER YARD', title: 'SNOWBALL FIGHT',
        sub: `${HITS} HITS AND YOU'RE OUT`,
        from: { pos: [8, 5, 10], look: [0, 0.5, 0] },
        to: overheadCam(_stage, W, D, 3),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _balls = []; _flakes = null; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── The yard ─────────────────────────────────────────────────────────────────
function _buildYard() {
    const scene = _stage.scene;
    scene.fog = new THREE.Fog(0xcfe6f7, 26, 60);
    _stage.light({ sun: 0xfff6ea, sunI: 0.75, sky: 0xdce9f7, ground: 0x7d93ab, hemiI: 0.5, dir: [-6, 16, 8], span: 12 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); _stage.add(m); return m; };
    const snow = new THREE.MeshStandardMaterial({ color: 0xe2eaf2, roughness: 0.9 });
    const ground = add(new THREE.PlaneGeometry(70, 70), snow, 0, 0, 0); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    // Each half faintly in its player's colour, and a trodden line down the middle.
    [0, 1].forEach(slot => {
        const h = add(new THREE.PlaneGeometry(W, D / 2), new THREE.MeshBasicMaterial({ color: seat(slot).color, transparent: true, opacity: 0.16, depthWrite: false }), 0, 0.01, (slot === 0 ? 1 : -1) * D / 4);
        h.rotation.x = -Math.PI / 2;
    });
    const line = add(new THREE.PlaneGeometry(W, 0.12), new THREE.MeshBasicMaterial({ color: 0x9fb6cc }), 0, 0.015, 0); line.rotation.x = -Math.PI / 2;
    // Snow walls: packed blocks with a rounded cap.
    const block = new THREE.MeshStandardMaterial({ color: 0xa9c1da, roughness: 0.8 });
    WALLS.forEach(w => {
        const m = add(new THREE.BoxGeometry(w.hw * 2, WALL_H, w.hd * 2), block, w.x, WALL_H / 2, w.z); m.castShadow = true; m.receiveShadow = true;
        const cap = add(new THREE.CylinderGeometry(w.hd * 1.1, w.hd * 1.1, w.hw * 2, 10), snow, w.x, WALL_H, w.z); cap.rotation.z = Math.PI / 2; cap.castShadow = true;
    });
    // Banks round the yard, snowy pines, and a snowman on each side.
    const bank = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    for (let k = 0; k < 18; k++) {
        const side = k % 2 ? 1 : -1, z = -D / 2 - 1 + (k >> 1) * 2;
        const m = add(new THREE.SphereGeometry(1.2 + Math.random() * 0.5, 10, 8), bank, side * (W / 2 + 1.2), -0.4, z); m.scale.y = 0.6;
    }
    const pine = new THREE.MeshStandardMaterial({ color: 0x2f6b4a, roughness: 0.9 }), bark = new THREE.MeshStandardMaterial({ color: 0x6b4423 });
    [[-11, -7], [-12, 1], [-11, 9], [11, -9], [12, 0], [11.5, 7], [-4, -14], [5, 14], [1, -15], [-6, 14]].forEach(([x, z], k) => {
        const s = 0.9 + (k % 3) * 0.25;
        add(new THREE.CylinderGeometry(0.2, 0.25, 1, 6), bark, x, 0.5, z);
        [0, 1, 2].forEach(i => {
            add(new THREE.ConeGeometry((1.5 - i * 0.4) * s, 1.6 * s, 8), pine, x, 1.2 + i * 0.9 * s, z);
            add(new THREE.ConeGeometry((1.2 - i * 0.35) * s, 0.5 * s, 8), snow, x, 1.7 + i * 0.9 * s, z);
        });
    });
    [[-3.8, 6.2], [3.8, -6.2]].forEach(([x, z]) => {
        [[0.55, 0.5], [0.4, 1.25], [0.28, 1.8]].forEach(([r, y]) => add(new THREE.SphereGeometry(r, 14, 10), snow, x, y, z));
        const nose = add(new THREE.ConeGeometry(0.06, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xf97316 }), x, 1.8, z + (z > 0 ? -0.3 : 0.3));
        nose.rotation.x = (z > 0 ? -1 : 1) * Math.PI / 2;
    });
    // Falling snow.
    const n = 260, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 30; pos[i * 3 + 1] = Math.random() * 14; pos[i * 3 + 2] = (Math.random() - 0.5) * 30; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    _flakes = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85 }));
    _stage.add(_flakes);
}

function _buildFig(slot) {
    const f = { slot, x: 0, z: (slot === 0 ? 1 : -1) * (D / 2 - 1.2), face: slot === 0 ? Math.PI : 0,
                hits: 0, ammo: AMMO_START, still: 0, pack: 0, flinch: 0, cool: 0, moving: false, crouch: false, out: false };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        c.rig.root.position.set(f.x, 0, f.z);
        c.anim.face(f.face, true);
        c.anim.play('ready');
        Object.assign(f, { rig: c.rig, anim: c.anim });
    }
    return f;
}

// ── Throwing ─────────────────────────────────────────────────────────────────
function _release(slot, r) {
    if (_phase !== 'play' || isBotSlot(slot)) return;
    const m = Math.hypot(r.dx, r.dy);
    if (!r.moved || r.held * 1000 > FLICK_MS || m < 0.35) return;
    _throw(slot, r.dx / m, r.dy / m, Math.min(1, m));
}

/** Throw from `slot` along (dx, dz), with power 0–1. */
function _throw(slot, dx, dz, power) {
    const f = _figs[slot];
    if (!f || f.out || f.ammo <= 0 || f.cool > 0 || f.flinch > 0) return false;
    f.ammo--; f.cool = COOLDOWN; f.still = 0; f.pack = 0;
    const v = V_MIN + (V_MAX - V_MIN) * power;
    const b = { from: slot, x: f.x + dx * 0.5, y: LAUNCH_Y, z: f.z + dz * 0.5, vx: dx * v, vz: dz * v, vy: VY0, mesh: null };
    if (_stage?.gl) {
        b.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
        b.mesh.castShadow = true; _stage.add(b.mesh);
    }
    _balls.push(b);
    f.face = Math.atan2(dx, dz);
    f.anim?.play('shove', { restart: true });
    sfx('seq_lit');
    if (!isBotSlot(slot)) haptic([12]);
    return true;
}

function _splat(b, color = 0xffffff) {
    if (_stage?.gl) _fx.puff(new THREE.Vector3(b.x, Math.max(0.1, b.y), b.z), color, 5, 0.35, 0.4);
    if (b.mesh) { _stage.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    b.dead = true;
}

function _stepBalls(dt) {
    // Small slices: at 12 u/s a slow frame would carry a ball clean over a
    // wall 0.8 deep without it ever being inside it.
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let k = 0; k < n; k++) _sliceBalls(dt / n);
    _balls.forEach(b => { if (b.mesh && !b.dead) b.mesh.position.set(b.x, b.y, b.z); });
    _balls = _balls.filter(b => !b.dead);
}
function _sliceBalls(dt) {
    for (const b of _balls) {
        if (b.dead) continue;
        b.x += b.vx * dt; b.z += b.vz * dt; b.vy -= G * dt; b.y += b.vy * dt;
        // Walls stop anything below their top.
        if (b.y < WALL_H + 0.1 && WALLS.some(w => Math.abs(b.x - w.x) < w.hw + 0.12 && Math.abs(b.z - w.z) < w.hd + 0.12)) { _splat(b); sfx('dice_land'); continue; }
        // Players: the one who threw it can't be hit by it.
        const f = _figs[1 - b.from];
        if (f && !f.out && Math.hypot(b.x - f.x, b.z - f.z) < BODY + 0.2 && b.y < (f.crouch ? CROUCH_H : STAND_H)) { _hit(f, b); continue; }
        if (b.y <= 0.05 || Math.abs(b.x) > W / 2 + 3 || Math.abs(b.z) > D / 2 + 3) _splat(b);
    }
}

function _hit(f, b) {
    _splat(b);
    f.hits++; f.flinch = FLINCH; f.still = 0; f.pack = 0;
    sfx('slam'); if (!isBotSlot(f.slot)) haptic([40, 30, 40]);
    if (_stage?.gl) _fx.confetti(new THREE.Vector3(f.x, 1.3, f.z), [0xffffff, 0xdbeafe], 14, 2);
    f.anim?.play('hit', { restart: true });
    _hud.say('SPLAT!', `${seat(f.slot).name} · ${HITS - Math.min(HITS, f.hits)} LEFT`, 800, _t, '#7dd3fc');
    if (f.hits >= HITS && !f.out) {
        f.out = true;
        f.anim?.play('defeat', { restart: true });
        if (_winner === -2) { _winner = 1 - f.slot; _endAt = _clock + 1.3; sfx('mg_win'); }
    }
}

// ── Movement ─────────────────────────────────────────────────────────────────
function _collide(f) {
    const zMin = f.slot === 0 ? MID : -D / 2 + BODY, zMax = f.slot === 0 ? D / 2 - BODY : -MID;
    f.x = Math.max(-W / 2 + BODY, Math.min(W / 2 - BODY, f.x));
    f.z = Math.max(zMin, Math.min(zMax, f.z));
    WALLS.forEach(w => {
        const cx = Math.max(w.x - w.hw, Math.min(w.x + w.hw, f.x)), cz = Math.max(w.z - w.hd, Math.min(w.z + w.hd, f.z));
        const dx = f.x - cx, dz = f.z - cz, d = Math.hypot(dx, dz);
        if (d < BODY && d > 1e-6) { f.x = cx + dx / d * BODY; f.z = cz + dz / d * BODY; }
        else if (d <= 1e-6) f.z += (f.z > w.z ? 1 : -1) * BODY;
    });
}

// ── Bot (§5): pack behind a wall, pop out and throw with a skill-sized aim
// error, and move somewhere else afterwards. ─────────────────────────────────
function _botMove(slot, dt) {
    const me = _figs[slot], them = _figs[1 - slot], b = _bot[slot];
    b.think -= dt;
    if (b.think <= 0) {
        b.think = 1.2 + Math.random() * 1.4 - _botSkill * 0.5;
        const mine = WALLS.filter(w => (slot === 0 ? w.z > 0 : w.z < 0));
        if (me.ammo === 0 || Math.random() < 0.45) {
            // Behind a wall, on the far side of it from the rival.
            const w = mine[(Math.random() * mine.length) | 0];
            b.tx = w.x + (Math.random() - 0.5) * w.hw; b.tz = w.z + (slot === 0 ? 1 : -1) * (w.hd + BODY + 0.15);
        } else {
            // Out into the open, and forward when skilled.
            b.tx = (Math.random() - 0.5) * (W - 2);
            b.tz = (slot === 0 ? 1 : -1) * (MID + 0.5 + (1 - _botSkill) * 3 + Math.random() * 2);
        }
    }
    b.throwAt -= dt;
    if (b.throwAt <= 0 && me.ammo > 0 && !them.out) {
        b.throwAt = 0.9 + (1 - _botSkill) * 1.3 + Math.random() * 0.8;
        // Aim at where they'll be, give or take.
        const dist = Math.hypot(them.x - me.x, them.z - me.z);
        const lead = dist / 10;
        const err = (1 - _botSkill) * 1.6;
        const tx = them.x + (them.vx || 0) * lead * _botSkill + (Math.random() - 0.5) * err;
        const tz = them.z + (them.vz || 0) * lead * _botSkill + (Math.random() - 0.5) * err;
        const dx = tx - me.x, dz = tz - me.z, d = Math.hypot(dx, dz) || 1;
        // Power to land it at their chest: solve the flight time roughly.
        const power = Math.max(0, Math.min(1, (d / 0.66 - V_MIN) / (V_MAX - V_MIN)));
        _throw(slot, dx / d, dz / d, power);
    }
    const dx = b.tx - me.x, dz = b.tz - me.z, d = Math.hypot(dx, dz);
    return d < 0.25 ? { dx: 0, dz: 0 } : { dx: dx / d * (0.7 + _botSkill * 0.3), dz: dz / d * (0.7 + _botSkill * 0.3) };
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') { _hud.say('READY…', 'STAND STILL TO PACK SNOW', 1300, _t, '#7dd3fc'); sfx('countdown'); }
    else if (phase === 'play') { _hud.say('FIGHT!', '', 700, _t, '#4ade80'); sfx('go'); haptic([40]); }
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready' && _phaseT >= READY_TIME) _enter('play');
    if (_phase === 'play') {
        _clock += dt;
        _figs.forEach(f => {
            f.flinch = Math.max(0, f.flinch - dt); f.cool = Math.max(0, f.cool - dt);
            let mv = { dx: 0, dz: 0 };
            if (!f.out && f.flinch <= 0) mv = isBotSlot(f.slot) ? _botMove(f.slot, dt) : (s => (s.down ? { dx: s.dx, dz: s.dy } : { dx: 0, dz: 0 }))(_in.seat(f.slot));
            const m = Math.min(1, Math.hypot(mv.dx, mv.dz));
            f.moving = m > 0.15;
            f.vx = f.moving ? mv.dx / Math.hypot(mv.dx, mv.dz) * m * SPEED : 0;
            f.vz = f.moving ? mv.dz / Math.hypot(mv.dx, mv.dz) * m * SPEED : 0;
            f.x += f.vx * dt; f.z += f.vz * dt;
            _collide(f);
            if (f.moving) { f.face = Math.atan2(mv.dx, mv.dz); f.still = 0; f.pack = 0; }
            else if (!f.out) {
                f.still += dt;
                if (f.ammo < AMMO_MAX) {
                    f.pack += dt;
                    if (f.pack >= PACK) { f.pack = 0; f.ammo++; if (!isBotSlot(f.slot)) { sfx('tick'); haptic([6]); } }
                } else f.pack = 0;
            }
            f.crouch = !f.out && f.still >= CROUCH_AFTER;
        });
        _stepBalls(dt);
        if (_endAt && _clock >= _endAt) _end();
        else if (_clock >= MATCH_TIME && _winner === -2) {
            const [a, b] = _figs;
            _winner = a.hits < b.hits ? 0 : b.hits < a.hits ? 1 : -1;
            _end();
        }
    }
    _draw(dt);
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!dirOwns && _stage?.gl && _phase !== 'over') {
        const c = overheadCam(_stage, W, D, 3), cam = _stage.camera;
        cam.position.lerp(new THREE.Vector3(...c.pos), Math.min(1, dt * 3)); cam.lookAt(...c.look);
    }
    _renderHud();
}

function _draw(dt) {
    _figs.forEach(f => {
        if (!f.rig) return;
        f.rig.root.position.set(f.x, 0, f.z);
        if (_phase === 'over') return;
        if (!f.out) {
            // Face where you run; when still, face the rival.
            const them = _figs[1 - f.slot];
            const want = f.moving ? f.face : Math.atan2(them.x - f.x, them.z - f.z);
            f.anim.face(want);
            const pose = f.flinch > 0 ? 'hit' : f.moving ? 'run' : f.crouch ? 'duck' : 'ready';
            if (f.pose !== pose && (f.cool <= 0 || pose === 'hit')) { f.pose = pose; f.anim.play(pose); }
        }
    });
    if (_flakes) {
        const p = _flakes.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
            let y = p.getY(i) - dt * 1.2;
            if (y < 0) y += 14;
            p.setY(i, y); p.setX(i, p.getX(i) + Math.sin(_t + i) * dt * 0.2);
        }
        p.needsUpdate = true;
    }
}

function _renderHud() {
    if (!_hud) return;
    [0, 1].forEach(slot => {
        const f = _figs[slot], them = _figs[1 - slot];
        if (!f) return;
        const hearts = '❤️'.repeat(Math.max(0, HITS - f.hits)) + '🤍'.repeat(Math.min(HITS, f.hits));
        const ammo = '❄️'.repeat(f.ammo) + '·'.repeat(AMMO_MAX - f.ammo);
        _hud.line(slot, `${hearts}  ${ammo}  · THEM ${'❤️'.repeat(Math.max(0, HITS - them.hits))} · ${Math.max(0, Math.ceil(MATCH_TIME - _clock))}s`);
        if (_clock > 8 && !seat(slot).bot) _hud.hint(slot, f.ammo === 0 ? 'OUT OF SNOW — STAND STILL TO PACK' : f.crouch ? 'CROUCHED · FLICK TO THROW' : '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `${seat(0).name} ${HITS - _figs[0].hits} – ${HITS - _figs[1].hits} ${seat(1).name}`;
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    _balls.forEach(b => _splat(b)); _balls = [];
    const w = _winner < -1 ? -1 : _winner;
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? 'BOTH EQUALLY SOAKED' : 'LAST ONE DRY',
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, clock: +_clock.toFixed(2), winner: _winner, balls: _balls.length, ballAt: _balls.map(b => [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)]),
             figs: _figs.map(f => ({ x: +f.x.toFixed(2), z: +f.z.toFixed(2), hits: f.hits, ammo: f.ammo, crouch: f.crouch, out: f.out, moving: f.moving })),
             walls: WALLS, gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: put a player at (x, z) with `ammo` snowballs. */
export function _debugPlace(slot, x, z, ammo) { const f = _figs[slot]; if (f) { f.x = x; f.z = z; if (ammo != null) f.ammo = ammo; f.still = 0; f.pack = 0; } }
/** Probes: throw from code. */
export function _debugThrow(slot, dx, dz, power) { return _throw(slot, dx, dz, power); }
/** Probes: freeze the clock at s. */
export function _debugClock(s) { _clock = s; }
