// ============================================================
// RED LIGHT, GREEN LIGHT — a race to the traffic light in the fountain park.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Face-off hold, seen from above. A giant traffic light stands in the middle
// of the lawn, a head facing each end. Each player's character races from
// their own end toward it.
//
//   HOLD on your half to run. Let go to stop.
//
// Green: go. Amber: it is about to change, unless it is a fake-out and flips
// back to green. Red: anyone still moving once the short grace is up is caught
// and sent back to the start. Runners carry a little momentum, so a late let-go
// is a caught one. First to the stop line under the light wins.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects, overheadCam } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const W = 9, D = 24;
const START = 10.5, FINISH = 1.6;       // |z| of the start line and the stop line
const VMAX = 1.75, ACCEL = 5, DECEL = 6.5; // momentum: stopping from full takes ~0.27 s; the course ~5 s of pure running
const GRACE = 0.32;                     // s after red before moving counts
const MOVING = 0.35;                    // speed that counts as moving
const GREEN = [1.4, 3.6], AMBER = 0.7, RED = [1.5, 2.8];
const FAKE_AMBER = 0.3;                 // chance an amber flips back to green
const SENT_BACK = 0.9;                  // s the walk of shame takes
const MATCH_TIME = 60;
const READY_TIME = 1.2;
const LANE_X = [0.9, -0.9];             // players' lanes (P1, P2)
const FIG_SCALE = 1.15;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _runners = [], _bot = [], _light = null, _lampMats = null, _glow = null, _cap = null;
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _winner = -1;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _winner = -1;
    _light = { state: 'red', t: 0, dur: 99, fake: false };
    _bot = [0, 1].map(() => ({ react: 0, hold: false }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#a9d4f2;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 38, background: 0xa9d4f2 });
    _hud = faceoffHud(_stage);
    _in = touch(_stage, { split: 'y' });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _stage.camera.up.set(0, 0, -1);
        _set = STAGE_SETS.ring(_stage, { w: W, d: D });
        _buildCourse();
    }
    // The seated players, and nobody else.
    _runners = [
        _buildRunner(0, 0, LANE_X[0], 1),
        _buildRunner(1, 1, LANE_X[1], -1),
    ];
    _setLight('red', 99);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'HOLD TO RUN · FREEZE ON RED'));

    _dir.open({
        place: 'CITY RING ROAD · THE FOUNTAIN PARK', title: 'RED LIGHT, GREEN LIGHT',
        sub: 'FIRST TO THE LIGHT',
        from: { pos: [8, 5, 9], look: [0, 2.5, 0] },
        to: overheadCam(_stage, W, D, 5),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _runners = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null; _lampMats = null; _glow = null; _cap = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── The course: lanes, lines and the light ───────────────────────────────────
function _buildCourse() {
    const chalk = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const line = (z, w, h = 0.22) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), chalk); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.02, z); _stage.add(m); };
    [1, -1].forEach(s => { line(s * START, W - 1); line(s * FINISH, W - 1, 0.35); });
    // Lane dashes.
    for (let z = FINISH + 0.8; z < START; z += 1.3) [1, -1].forEach(s => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.6), chalk); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.02, s * z); _stage.add(m);
    });
    // The light: a pole, and a head facing each end. Lamps red (top), amber,
    // green (bottom) — position as well as colour says which is lit.
    const steel = new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.45, metalness: 0.5 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 4.2, 12), steel);
    pole.position.y = 2.1; pole.castShadow = true; _stage.add(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.25, 16), steel); base.position.y = 0.12; _stage.add(base);
    const cols = { red: 0xff3b30, amber: 0xffb020, green: 0x34d399 };
    _lampMats = { red: [], amber: [], green: [] };
    [1, -1].forEach(s => {
        const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.9, 0.7), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6 }));
        head.position.set(0, 4.6, s * 0.2); head.castShadow = true; _stage.add(head);
        ['red', 'amber', 'green'].forEach((k, i) => {
            const m = new THREE.MeshStandardMaterial({ color: cols[k], emissive: cols[k], emissiveIntensity: 0.05, roughness: 0.3 });
            const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), m);
            lamp.position.set(0, 5.5 - i * 0.9, s * 0.58); _stage.add(lamp);
            const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 14, 1, true, 0, Math.PI), steel);
            hood.rotation.x = Math.PI / 2; hood.rotation.z = s > 0 ? 0 : Math.PI; hood.position.set(0, 5.62 - i * 0.9, s * 0.72); _stage.add(hood);
            _lampMats[k].push(m);
        });
    });
    // A lamp on top of the head, facing the sky: the overhead camera sees the
    // head from above, where the side lamps are edge-on.
    _cap = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 24), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    _cap.position.set(0, 6.1, 0); _stage.add(_cap);
    // A ring of light on the lawn round the pole, in the light's colour: from
    // above, the lamps are side-on, and this is what the eye catches.
    _glow = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.55, 40), new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.85 }));
    _glow.rotation.x = -Math.PI / 2; _glow.position.y = 0.03; _stage.add(_glow);
}

function _buildRunner(i, slot, x, side) {
    const r = { i, slot, human: slot >= 0, x, z: side * START, side, v: 0, back: 0, backFrom: 0, caught: 0, home: false };
    if (!_stage.gl) return r;
    const c = _stage.character(slot);
    c.rig.root.scale.setScalar(FIG_SCALE);
    c.rig.root.position.set(r.x, 0, r.z);
    c.anim.face(side > 0 ? Math.PI : 0, true);
    Object.assign(r, { rig: c.rig, anim: c.anim });
    return r;
}

// ── The light ────────────────────────────────────────────────────────────────
function _setLight(s, dur) {
    _light.state = s; _light.t = 0; _light.dur = dur;
    _light.fake = s === 'amber' && Math.random() < FAKE_AMBER;
    if (_lampMats) ['red', 'amber', 'green'].forEach(k => _lampMats[k].forEach(m => { m.emissiveIntensity = k === s ? 1.6 : 0.05; }));
    const hex = s === 'red' ? 0xff3b30 : s === 'amber' ? 0xffb020 : 0x34d399;
    if (_glow) _glow.material.color.setHex(hex);
    if (_cap) _cap.material.color.setHex(hex);
    if (_phase !== 'play') return;
    if (s === 'green') { sfx('go'); _hud.say('GREEN!', '', 600, _t, '#34d399'); }
    else if (s === 'amber') { sfx('countdown'); _hud.say('AMBER…', '', 500, _t, '#ffb020'); }
    else { sfx('land_bad'); haptic([30]); _hud.say('RED!', 'FREEZE', 700, _t, '#ff3b30'); }
}
const _rand = ([a, b]) => a + Math.random() * (b - a);

function _tickLight(dt) {
    _light.t += dt;
    if (_light.t < _light.dur) return;
    if (_light.state === 'green') _setLight('amber', AMBER);
    else if (_light.state === 'amber') {
        if (_light.fake) { _setLight('green', _rand(GREEN) * 0.7); _hud.say('GREEN!', 'FAKE-OUT', 600, _t, '#34d399'); }
        else _setLight('red', _rand(RED));
    } else _setLight('green', _rand(GREEN));
}

// ── Running ──────────────────────────────────────────────────────────────────
function _wantsToRun(r, dt) {
    if (r.human && !isBotSlot(r.slot)) return !!_in.seat(r.slot).down;
    // Bots: run on green, react to amber after a delay (worse
    // for easy bots), and sometimes chance it.
    const skill = r.human ? _botSkill : 0.35;
    const b = r.human ? _bot[r.slot] : (r.bot || (r.bot = { react: 0, hold: false }));
    if (_light.state === 'green') { b.react = 0; b.greedy = Math.random() < (1 - skill) * 0.3; return true; }
    if (_light.state === 'amber') {
        b.react += dt;
        const delay = 0.45 - skill * 0.35 + (b.greedy ? 0.5 : 0);
        return b.react < delay;
    }
    b.react += dt;
    return b.greedy && b.react < 0.25;
}

function _catch(r) {
    r.caught = 1; r.back = SENT_BACK; r.backFrom = r.z; r.v = 0;
    if (r.human) { sfx('mg_lose'); haptic([60]); _hud.say('CAUGHT!', r.human ? `${seat(r.slot).name} · BACK TO THE START` : '', 1000, _t, '#ff3b30'); }
    if (_stage?.gl) { _fx.burst(new THREE.Vector3(r.x, 1, r.z), 0xff3b30, 0.45, 0.2); r.anim?.play('hit'); }
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready' && _phaseT > READY_TIME) _enter('play');

    if (_phase === 'play') {
        _clock += dt;
        _tickLight(dt);
        _runners.forEach(r => {
            if (r.home) return;
            if (r.back > 0) {
                // Sent back: glide to the start line, no control.
                r.back = Math.max(0, r.back - dt);
                const u = 1 - r.back / SENT_BACK;
                r.z = r.backFrom + (r.side * START - r.backFrom) * (u * u * (3 - 2 * u));
                return;
            }
            const run = _wantsToRun(r, dt);
            r.v = run ? Math.min(VMAX * (r.human ? 1 : 0.8), r.v + ACCEL * dt) : Math.max(0, r.v - DECEL * dt);
            r.z -= r.side * r.v * dt;
            if (_light.state === 'red' && _light.t > GRACE && r.v > MOVING) _catch(r);
            if (Math.abs(r.z) <= FINISH) {
                r.z = r.side * FINISH; r.home = true; r.v = 0;
                r.anim?.play('victory');
                if (r.human && _winner < 0) { _winner = r.slot; _end(); }
            }
        });
        if (_clock >= MATCH_TIME && _winner < 0) {
            // The bell: nearest the light wins.
            const [a, b] = _runners;
            _winner = Math.abs(a.z) < Math.abs(b.z) - 0.05 ? 0 : Math.abs(b.z) < Math.abs(a.z) - 0.05 ? 1 : -1;
            _end();
        }
    }

    _runners.forEach(r => {
        if (!r.rig) return;
        r.rig.root.position.set(r.x, 0, r.z);
        if (r.home || _phase === 'over') return;
        if (r.back > 0) { r.anim.face(r.side > 0 ? 0 : Math.PI, true); r.anim.play('walk', { rate: 3 }); return; }
        r.anim.face(r.side > 0 ? Math.PI : 0, true);
        r.anim.play(r.v > 0.2 ? 'run' : 'ready', { rate: 1 + r.v * 0.6 });
    });
    if (_glow) _glow.scale.setScalar(1 + (_light.state === 'amber' ? Math.sin(_t * 18) * 0.06 : 0));
    _set?.update?.(dt, _t);
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!dirOwns && _stage?.gl && _phase !== 'over') {
        const c = overheadCam(_stage, W, D, 5);
        _stage.camera.position.fromArray(c.pos);
        _stage.camera.lookAt(0, 0, 0);
    }
    _renderHud();
}

function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') _hud.say('READY…', 'WAIT FOR GREEN', READY_TIME * 1000, _t, '#ffb020');
    else if (phase === 'play') _setLight('green', _rand(GREEN));
}

function _renderHud() {
    if (!_hud) return;
    const pct = r => Math.round((1 - (Math.abs(r.z) - FINISH) / (START - FINISH)) * 100);
    [0, 1].forEach(slot => {
        const me = _runners[slot], them = _runners[1 - slot];
        if (!me) return;
        _hud.line(slot, `🚦 YOU ${pct(me)}% · THEM ${pct(them)}%`);
        if (_clock > 6) _hud.hint(slot, '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = _light.state === 'red' ? 'RED LIGHT' : _light.state === 'amber' ? 'AMBER' : 'GREEN LIGHT';
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    const w = _winner;
    _dir.close({
        winner: w, figs: _runners.slice(0, 2).filter(r => r.rig).map(r => ({ slot: r.slot, rig: r.rig, anim: r.anim })),
        sub: w < 0 ? 'NECK AND NECK' : 'FIRST TO THE LIGHT',
        closeUp: (f, p) => ({ pos: [p.x + 2, p.y + 8.5 * FIG_SCALE, p.z + (f.slot === 0 ? 1 : -1) * 8 * FIG_SCALE], look: [p.x, p.y + 0.8, p.z] }),
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, clock: +_clock.toFixed(2), light: _light?.state, lightT: +(_light?.t || 0).toFixed(2), winner: _winner,
             runners: _runners.map(r => ({ z: +r.z.toFixed(2), v: +r.v.toFixed(2), back: +r.back.toFixed(2), caught: r.caught, home: r.home })),
             gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: set the light (and hold it there for `dur` s). */
export function _debugLight(s, dur = 99) { _setLight(s, dur); if (s === 'amber') _light.fake = false; }
export function _debugPlace(i, z) { const r = _runners[i]; if (r) Object.assign(r, { z, v: 0, back: 0, home: false }); }
