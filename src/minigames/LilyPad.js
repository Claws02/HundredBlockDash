// Lily Pad Leap — the Fae Glade pond, and nowhere to stand still.
//
// A stage game, face-off, seen from above. Both figures stand on lily pads
// in a glowing pond. A pad sinks under whoever is on it — faster with two —
// and a sunk pad comes back up a few seconds later. Fall in and the round is
// over.
//
//   DRAG  to aim at a pad (it lights up in your colour).
//   LET GO to hop to it.
//
// Hop onto the pad your rival is standing on and you stomp them off it, onto
// a pad beside them — or into the water, if there is none. Last one dry takes
// the round; first to two. The pond gets hungrier the longer a round runs.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects, overheadCam } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const COLS = 5, ROWS = 8, GAP = 2.2;
const W = (COLS - 1) * GAP + 2.4, D = (ROWS - 1) * GAP + 2.4;
const PAD_R = 0.85;
const HOP_T = 0.34, HOP_RANGE = 3.2, AIM_CONE = 0.9;   // radians either side
const DRAIN = 0.8, DRAIN_TWO = 1.8;                    // health / s
const GRACE = 1.5;                                      // s at round start before pads drain
const HUNGER = 0.05;                                    // extra drain per second of round
const REGROW = 4.5;
const RISE_AT = 7;                                      // no regrowth after this, and pads start going on their own
const RISE_EVERY = 0.25, ROUND_CAP = 16;
const WIN_ROUNDS = 2, MAX_ROUNDS = 3, READY_TIME = 1.2, RESULT_TIME = 1.8;
const FIG_SCALE = 1.05;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _pads = [], _figs = [], _bot = [], _aimRings = [];
let _round = 0, _score = [0, 0];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0;
let _dirOwns = false;
let _nextRise = 0;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _round = 0; _score = [0, 0]; _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0;
    _bot = [0, 1].map(() => ({ wait: 0 }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#380f3f;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 38, background: 0x380f3f });
    _hud = faceoffHud(_stage, { bg: 'rgba(30,10,40,.72)' });
    _in = touch(_stage, { split: 'y', onRelease: (slot, r) => { if (r.moved) _hopAimed(slot); } });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _stage.camera.up.set(0, 0, -1);          // P2's end is up for every shot
        _set = STAGE_SETS.fae(_stage, { w: W, d: D });
    }
    _buildPads();
    _figs = [0, 1].map(_buildFig);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'DRAG TO AIM · LET GO TO HOP'));

    _dir.open({
        place: 'FAE GLADE · MIDNIGHT', title: 'LILY PAD LEAP',
        sub: 'LAST ONE DRY',
        from: { pos: [5, 7, 14], look: [0, 0, 2] },
        to: overheadCam(_stage, W, D, 8),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _pads = []; _figs = []; _aimRings = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── Pads ─────────────────────────────────────────────────────────────────────
function _buildPads() {
    _pads = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const x = (c - (COLS - 1) / 2) * GAP + (r % 2 ? GAP * 0.25 : -GAP * 0.25);
        const z = (r - (ROWS - 1) / 2) * GAP;
        const p = { x, z, hp: 1, sunk: 0, up: true, mesh: null };
        if (_stage.gl) {
            const g = new THREE.Group();
            const leaf = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R, PAD_R, 0.08, 24, 1, false, 0.35, Math.PI * 2 - 0.35),
                new THREE.MeshStandardMaterial({ color: 0x3fa34d, roughness: 0.6, side: THREE.DoubleSide }));
            leaf.receiveShadow = true; leaf.castShadow = true; g.add(leaf);
            const vein = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 16),
                new THREE.MeshBasicMaterial({ color: 0x9be38a, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
            vein.rotation.x = -Math.PI / 2; vein.position.y = 0.05; g.add(vein);
            if ((r * 7 + c * 3) % 5 === 0) {        // the odd lotus flower
                const bloom = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.3, 6),
                    new THREE.MeshStandardMaterial({ color: 0xf0abfc, emissive: 0x9a3aa0, emissiveIntensity: 0.6 }));
                bloom.position.set(0.45, 0.18, 0.2); g.add(bloom);
            }
            g.position.set(x, 0.04, z);
            g.rotation.y = (r * 13 + c * 7) % 6;
            _stage.add(g);
            p.mesh = g; p.leaf = leaf;
        }
        _pads.push(p);
    }
}

function _padColor(p) {
    if (!p.leaf) return;
    const k = Math.max(0, p.hp);
    p.leaf.material.color.setRGB(0.25 + (1 - k) * 0.35, 0.64 * k + 0.25 * (1 - k), 0.3 * k + 0.12 * (1 - k));
}

const _home = slot => (slot === 0 ? (ROWS - 1) * COLS + 2 : 2);

// ── Figures ──────────────────────────────────────────────────────────────────
function _buildFig(slot) {
    const f = { slot, pad: _home(slot), hop: null, out: false, y: 0 };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        Object.assign(f, { rig: c.rig, anim: c.anim });
        const ring = new THREE.Mesh(new THREE.RingGeometry(PAD_R * 0.95, PAD_R * 1.25, 28),
            new THREE.MeshBasicMaterial({ color: seat(slot).color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.visible = false; _stage.add(ring);
        _aimRings[slot] = ring;
    }
    return f;
}

function _place(f) {
    const p = _pads[f.pad];
    f.x = p.x; f.z = p.z;
}

function _resetRound() {
    _pads.forEach(p => { p.hp = 1; p.sunk = 0; p.up = true; p.going = false; if (p.mesh) { p.mesh.visible = true; p.mesh.position.y = 0.04; } _padColor(p); });
    _figs.forEach(f => {
        Object.assign(f, { pad: _home(f.slot), hop: null, out: false, y: 0 });
        _place(f);
        if (f.rig) { f.rig.root.position.set(f.x, 0.08, f.z); f.rig.root.rotation.set(0, 0, 0); f.anim.play('ready', { restart: true }); f.anim.face(f.slot === 0 ? Math.PI : 0, true); }
    });
    _clock = 0; _nextRise = RISE_AT;
}

// The pad `slot` is aiming at: the active pad in range best lined up with the drag.
function _aimTarget(slot, dx, dz) {
    const f = _figs[slot];
    if (f.out || f.hop) return -1;
    const len = Math.hypot(dx, dz);
    if (len < 0.3) return -1;
    const ax = dx / len, az = dz / len;
    let best = -1, bs = -Infinity;
    _pads.forEach((p, i) => {
        if (i === f.pad || !p.up) return;
        const vx = p.x - f.x, vz = p.z - f.z, d = Math.hypot(vx, vz);
        if (d > HOP_RANGE || d < 0.5) return;
        const cos = (vx * ax + vz * az) / d;
        if (cos < Math.cos(AIM_CONE)) return;
        const sc = cos * 2 - d * 0.25;
        if (sc > bs) { bs = sc; best = i; }
    });
    return best;
}

function _hopAimed(slot) {
    if (_phase !== 'play') return;
    const s = _in.seat(slot);
    const tgt = _figs[slot].aim ?? -1;
    if (tgt >= 0) _hop(slot, tgt);
}

function _hop(slot, to) {
    const f = _figs[slot];
    if (f.out || f.hop || !_pads[to].up) return false;
    f.hop = { from: f.pad, to, t: 0, knock: false };
    f.anim?.play('walk', { restart: true, rate: 4 });
    sfx('land_good'); haptic([12]);
    return true;
}

function _land(f) {
    const to = f.hop.to;
    f.pad = to; f.hop = null; _place(f);
    const p = _pads[to];
    if (!p.up) { _splash(f); return; }
    f.anim?.play('ready', { restart: true });
    // Stomp: the rival on this pad is knocked to a pad beside them, or in.
    const o = _figs[1 - f.slot];
    if (!o.out && !o.hop && o.pad === to) {
        const near = _pads.map((q, i) => ({ q, i })).filter(({ q, i }) => i !== to && q.up && Math.hypot(q.x - p.x, q.z - p.z) < GAP * 1.2);
        sfx('slam'); haptic([50]);
        o.anim?.flinch();
        if (near.length) {
            const pick = near[Math.floor(Math.random() * near.length)].i;
            o.hop = { from: to, to: pick, t: 0, knock: true };
        } else _splash(o);
        if (_stage?.gl) _fx.burst(new THREE.Vector3(p.x, 0.6, p.z), 0xf0abfc, 0.5, 0.25);
    }
}

function _splash(f) {
    if (f.out) return;
    f.out = true; f.outT = 0;
    f.anim?.play('hit', { restart: true });
    sfx('coin_loss'); haptic([80]);
    if (_stage?.gl) { _fx.puff(new THREE.Vector3(f.x, 0.2, f.z), 0x7fe6ff, 9, 0.8, 1.6); _fx.burst(new THREE.Vector3(f.x, 0.1, f.z), 0xbff4ff, 0.7, 0.3); }
}

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// Stays while its pad is healthy, then hops to the healthiest pad in reach
// that is not next to the rival — or, sometimes, straight onto the rival.
function _botStep(slot, dt) {
    const f = _figs[slot], b = _bot[slot], o = _figs[1 - slot];
    if (f.out || f.hop) return;
    const here = _pads[f.pad];
    b.wait -= dt;
    const nervous = here.hp < 0.3 + _botSkill * 0.25 || (!o.out && o.pad === f.pad);
    if (!nervous && b.wait > 0) return;
    if (!nervous && Math.random() > 0.02) return;
    b.wait = 0.55 - _botSkill * 0.35 + Math.random() * 0.25;
    let best = -1, bs = -Infinity;
    _pads.forEach((p, i) => {
        if (i === f.pad || !p.up) return;
        const d = Math.hypot(p.x - f.x, p.z - f.z);
        if (d > HOP_RANGE) return;
        let sc = p.hp * 3 - d * 0.2;
        const nearRival = !o.out && Math.hypot(p.x - o.x, p.z - o.z) < GAP * 1.2;
        if (nearRival) sc -= 1.2;
        if (!o.out && o.pad === i && Math.random() < 0.15 + _botSkill * 0.4) sc += 3;     // the stomp
        sc += (Math.random() - 0.5) * (1 - _botSkill) * 2;
        if (sc > bs) { bs = sc; best = i; }
    });
    if (best >= 0) _hop(slot, best);
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') { _round++; _resetRound(); _hud.say(`ROUND ${_round}`, 'LAST ONE DRY', READY_TIME * 1000, _t); }
    else if (phase === 'play') sfx('go');
    else if (phase === 'result') {
        const outs = _figs.filter(f => f.out);
        const w = outs.length === 2 ? -1 : 1 - outs[0].slot;
        if (w >= 0) _score[w]++;
        _hud.say(w < 0 ? 'BOTH IN!' : `${seat(w).name} STAYS DRY`, `${_score[0]} – ${_score[1]}`, RESULT_TIME * 1000, _t);
        _figs.forEach(f => { if (!f.out) f.anim?.play('victory'); });
    }
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready' && _phaseT > READY_TIME) _enter('play');
    else if (_phase === 'result' && _phaseT > RESULT_TIME) {
        if (_score[0] >= WIN_ROUNDS || _score[1] >= WIN_ROUNDS || _round >= MAX_ROUNDS) _end();
        else _enter('ready');
    }

    if (_phase === 'play') {
        _clock += dt;
        [0, 1].forEach(slot => { if (isBotSlot(slot)) _botStep(slot, dt); });
        // Aim.
        _figs.forEach(f => {
            if (isBotSlot(f.slot)) { f.aim = -1; return; }
            const s = _in.seat(f.slot);
            f.aim = s.down && s.moved ? _aimTarget(f.slot, s.dx, s.dy) : -1;
        });
        // Drain the pads people stand on.
        const hunger = 1 + _clock * HUNGER;
        _pads.forEach((p, i) => {
            if (!p.up) {
                p.sunk += dt;
                if (p.sunk > REGROW && _clock < RISE_AT) { p.up = true; p.hp = 1; p.sunk = 0; if (p.mesh) p.mesh.visible = true; }
                return;
            }
            const on = _figs.filter(f => !f.out && !f.hop && f.pad === i).length;
            if ((on && _clock > GRACE) || p.going) {
                p.hp -= ((on > 1 ? DRAIN_TWO : on ? DRAIN : 0) * hunger + (p.going ? 1.4 : 0)) * dt;
                if (p.hp <= 0) {
                    p.up = false; p.sunk = 0;
                    _figs.forEach(f => { if (!f.out && !f.hop && f.pad === i) _splash(f); });
                    sfx('land_bad');
                }
            }
            _padColor(p);
        });
        // THE POND RISES: past RISE_AT, nothing regrows and a pad starts to
        // go on its own every RISE_EVERY seconds. Two bots hopping from pad to
        // pad lasted over a hundred seconds before this existed.
        if (_clock >= _nextRise) {
            if (Math.abs(_clock - RISE_AT) < 0.05) _hud.say('THE POND RISES!', '', 1200, _t, '#7fe6ff');
            _nextRise = _clock + RISE_EVERY;
            const live = _pads.filter(p => p.up && !p.going);
            if (live.length) live[Math.floor(Math.random() * live.length)].going = true;
        }
        if (_clock >= ROUND_CAP) {
            // Still both dry: the healthier footing takes it, and the other goes in.
            const [a, b] = _figs;
            const ha = _pads[a.pad].hp, hb = _pads[b.pad].hp;
            if (Math.abs(ha - hb) < 0.05) { _splash(a); _splash(b); } else _splash(ha < hb ? a : b);
        }
        // Hops in flight.
        _figs.forEach(f => {
            if (!f.hop) return;
            f.hop.t += dt / (f.hop.knock ? HOP_T * 1.2 : HOP_T);
            const a = _pads[f.hop.from], b = _pads[f.hop.to], k = Math.min(1, f.hop.t);
            f.x = a.x + (b.x - a.x) * k; f.z = a.z + (b.z - a.z) * k;
            f.y = Math.sin(k * Math.PI) * (f.hop.knock ? 0.9 : 1.3);
            if (f.hop.t >= 1) { f.y = 0; _land(f); }
        });
        const outs = _figs.filter(f => f.out);
        if (outs.length && outs.every(f => f.outT > 0.5)) _enter('result');
        else if (outs.length === 2) _enter('result');
    }
    _figs.forEach(f => { if (f.out) f.outT += dt; });

    // Draw.
    _pads.forEach((p, i) => {
        if (!p.mesh) return;
        const on = _figs.some(f => !f.out && !f.hop && f.pad === i);
        const sinking = !p.up;
        p.mesh.position.y = sinking ? Math.max(-0.6, 0.04 - p.sunk * 0.8) : 0.04 - (1 - p.hp) * 0.05 - (on ? 0.02 : 0);
        p.mesh.rotation.z = on ? Math.sin(_t * 9 + i) * 0.05 * (1 - p.hp) : 0;
        if (sinking && p.sunk > 0.8) p.mesh.visible = false;
    });
    _figs.forEach(f => {
        if (!f.rig) return;
        const sink = f.out ? Math.min(1.8, f.outT * 2.2) : 0;
        f.rig.root.position.set(f.x, 0.08 + f.y - sink, f.z);
        if (f.hop) {
            const a = _pads[f.hop.from], b = _pads[f.hop.to];
            f.anim.face(Math.atan2(b.x - a.x, b.z - a.z), true);
        }
        const ring = _aimRings[f.slot];
        if (ring) {
            const tgt = f.aim ?? -1;
            ring.visible = tgt >= 0 && _phase === 'play';
            if (tgt >= 0) { const p = _pads[tgt]; ring.position.set(p.x, 0.12, p.z); ring.scale.setScalar(1 + Math.sin(_t * 10) * 0.06); }
        }
    });
    _set?.update(dt, _t);
    _fx?.update(dt);
    _dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!_dirOwns && _stage?.gl && _phase !== 'over') {
        const c = overheadCam(_stage, W, D, 8);
        _stage.camera.position.fromArray(c.pos);
        _stage.camera.lookAt(0, 0, 0);
        _stage.camera.userData.look = [0, 0, 0];
    }
    _renderHud();
}

function _renderHud() {
    if (!_hud) return;
    [0, 1].forEach(slot => {
        const f = _figs[slot];
        const hp = f && !f.out ? Math.round(Math.max(0, _pads[f.pad].hp) * 100) : 0;
        _hud.line(slot, `🍃 ROUND ${_round} · YOU ${_score[slot]} – ${_score[1 - slot]} THEM · PAD ${hp}%`);
        if (_round > 1) _hud.hint(slot, '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `ROUND ${_round} · ${seat(0).name} ${_score[0]} – ${_score[1]} ${seat(1).name}`;
}

function _end() {
    _phase = 'over';
    _hud.say('');
    const w = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;
    // Everyone back on a pad for the verdict.
    _figs.forEach(f => {
        f.out = false; f.hop = null; f.y = 0;
        f.pad = _home(f.slot); _place(f);
        const p = _pads[f.pad]; p.up = true; if (p.mesh) { p.mesh.visible = true; p.mesh.position.y = 0.04; }
        if (f.rig) f.rig.root.position.set(f.x, 0.08, f.z);
    });
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? 'THE POND WINS' : 'KING OF THE POND',
        closeUp: (f, p) => {
            const end = f.slot === 0 ? 1 : -1;
            return { pos: [p.x + 1.2, p.y + 5.5, p.z + end * 5.5], look: [p.x, p.y + 0.7, p.z] };
        },
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// For probes.
export function _debugState() {
    return {
        phase: _phase, round: _round, score: _score.slice(), clock: +_clock.toFixed(2),
        pad: _figs.map(f => f.pad), out: _figs.map(f => f.out), hopping: _figs.map(f => !!f.hop),
        hp: _figs.map(f => (_pads[f.pad] ? +_pads[f.pad].hp.toFixed(2) : 0)), aim: _figs.map(f => f.aim ?? -1),
        pads: _pads.map(p => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), up: p.up })),
        gl: !!_stage?.gl, turned: !!_stage?.turned,
    };
}
/** Probes: hop a seat to a pad now. */
export function _debugHop(slot, to) { return _hop(slot, to); }
