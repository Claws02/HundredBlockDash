// ============================================================
// BALLOON PUMP — push your luck at the Promenade's balloon stall.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Side-on hold, side by side. Each player's character stands at a pump with a
// balloon in their colour on the nozzle.
//
//   HOLD on your half to pump. Let go to stop.
//
// When the whistle goes, a balloon still in one piece scores its size. A
// balloon pumped past its limit pops and scores nothing. Both balloons in a
// round share the same hidden limit, so the round is about who dares closer.
//
// The tell: near its limit a balloon starts to strain. It wobbles, stretches
// and squeaks, harder the closer it gets, so reading it is the skill.
// Five rounds; the last counts double.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, sideHud, touch, effects } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const ROUNDS = 5;
const LEAD = 1.3;                  // s of "ROUND n" before pumping counts
const PUMP_TIME = 5.5;             // s of pumping per round
const TALLY = 1.9;                 // s to show the round's result
const RATE = 21;                   // size per second while pumping (0–100 scale)
const LIMIT_MIN = 52, LIMIT_MAX = 97;
const STRAIN = 16;                 // the tell starts this far below the limit
const X = [1.9, -1.9];             // P1 on the right (the home edge)
const FIG_SCALE = 1.05;
const R0 = 0.16, R1 = 1.12;        // balloon radius at size 0 and 100

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _figs = [], _score = [0, 0], _bot = [];
let _phase = 'intro', _sub = '', _subT = 0, _t = 0, _round = 0, _limit = 70, _squeakT = [0, 0];

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _sub = ''; _subT = 0; _t = 0; _round = 0; _score = [0, 0];
    _bot = [0, 1].map(() => ({ target: 60 }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#6a3fa0;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'side', fov: 34, background: 0x6a3fa0 });
    _hud = sideHud(_stage, { padWidth: 240 });
    _in = touch(_stage, { split: 'x', floating: false });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) _set = STAGE_SETS.shop(_stage);
    _figs = [0, 1].map(_buildStation);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'HOLD TO PUMP · DON’T POP IT'));

    _dir.open({
        place: 'SHOPPING PROMENADE · THE BALLOON STALL', title: 'BALLOON PUMP',
        sub: 'BIGGEST BALLOON WINS · DON’T POP IT',
        from: { pos: [8, 6, 15], look: [0, 1.8, -2] },
        to: _playCam(),
        onDone: () => { if (!_done) { _phase = 'play'; _nextRound(); } },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

function _playCam() { return { pos: [0, 2.9, 10.4], look: [0, 2.1, 0] }; }

// ── A pump, a balloon, a figure ─────────────────────────────────────────────
function _buildStation(slot) {
    const f = { slot, size: 0, popped: false, pumping: false, banked: false, wob: 0, handle: 0 };
    if (!_stage.gl) return f;
    const col = seat(slot).color;
    const c = _stage.character(slot);
    c.rig.root.scale.setScalar(FIG_SCALE);
    c.rig.root.position.set(X[slot], 0.17, -0.2);
    c.anim.face(0, true);
    c.anim.play('ready');
    Object.assign(f, { rig: c.rig, anim: c.anim });

    // The pump: a barrel, a plunger and a T handle, in front of the figure.
    // Outboard of the figure, so two full balloons never meet in the middle.
    const out = slot === 0 ? 1 : -1;
    const px = X[slot] + out * 0.9;
    const pump = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 14), new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.5, roughness: 0.35 }));
    barrel.position.y = 0.62; pump.add(barrel);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.34), new THREE.MeshStandardMaterial({ color: 0x3a3f47 }));
    foot.position.y = 0.2; pump.add(foot);
    const plunger = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.6 }));
    rod.position.y = 0.3; plunger.add(rod);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 10), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }));
    bar.rotation.z = Math.PI / 2; bar.position.y = 0.6; plunger.add(bar);
    plunger.position.y = 0.95; pump.add(plunger);
    pump.position.set(px, 0.17, 0.35);
    pump.traverse(o => { if (o.isMesh) o.castShadow = true; });
    _stage.add(pump);

    // The balloon rides a hose up from the pump's nozzle.
    const balloon = new THREE.Group();
    const skin = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.25, metalness: 0.05, emissive: col, emissiveIntensity: 0.08 }));
    skin.castShadow = true;
    balloon.add(skin);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
    shine.position.set(-0.38, 0.42, 0.72); balloon.add(shine);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 8), skin.material);
    _stage.add(balloon); _stage.add(knot);
    const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.8 }));
    _stage.add(hose);

    Object.assign(f, { plunger, balloon, skin, knot, hose, nozzle: new THREE.Vector3(px, 1.1, 0.35), base: new THREE.Vector3(px + out * 0.55, 1.45, 0.4) });
    _placeBalloon(f);
    return f;
}

function _radius(size) { return R0 + (R1 - R0) * Math.min(1, size / 100); }

function _placeBalloon(f) {
    if (!f.balloon) return;
    const r = _radius(f.size);
    // Strain: a wobble and a stretch whose size says how close the limit is.
    const near = Math.max(0, f.size - (_limit - STRAIN)) / STRAIN;          // 0 … 1
    const w = Math.sin(_t * (18 + near * 22)) * near;
    const sy = 1.12 + near * 0.12 + w * 0.05, sx = 1 - w * 0.04;
    f.balloon.visible = !f.popped;
    f.knot.visible = !f.popped;
    f.balloon.scale.set(r * sx, r * sy, r * sx);
    const drift = f.banked ? f.bankT * f.bankT * 3.5 : 0;
    const cx = f.base.x + (f.banked ? Math.sin(f.bankT * 3) * 0.3 : 0);
    const cy = f.base.y + r * sy + drift;
    f.balloon.position.set(cx, cy, f.base.z);
    f.skin.material.emissiveIntensity = 0.08 + near * 0.35;
    f.knot.position.set(cx, cy - r * sy - 0.05, f.base.z);
    f.knot.rotation.z = Math.PI;
    // The hose: nozzle to knot, until the balloon is let go.
    f.hose.visible = !f.popped && !f.banked;
    const a = f.nozzle, b = f.knot.position;
    const mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
    f.hose.position.copy(mid);
    f.hose.scale.set(1, len, 1);
    f.hose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
}

// ── Rounds ───────────────────────────────────────────────────────────────────
function _nextRound() {
    _round++;
    if (_round > ROUNDS) { _end(); return; }
    // One hidden limit for both balloons: nobody gets a luckier balloon.
    _limit = LIMIT_MIN + Math.random() * (LIMIT_MAX - LIMIT_MIN);
    _figs.forEach(f => {
        Object.assign(f, { size: 0, popped: false, banked: false, bankT: 0, pumping: false });
        f.anim?.play('ready');
        _placeBalloon(f);
    });
    _bot.forEach(b => {
        // A bot reads the strain, and a better bot reads it later and closer.
        const margin = 16 - _botSkill * 13 + (Math.random() - 0.5) * (1 - _botSkill) * 18;
        b.target = Math.min(99, _limit - margin);
        b.cautious = Math.random() < 0.25 * (1 - _botSkill);     // sometimes bottles it early
    });
    _sub = 'lead'; _subT = 0;
    const final = _round === ROUNDS;
    _hud.say(final ? 'FINAL ROUND' : `ROUND ${_round}`, final ? 'DOUBLE POINTS!' : 'GET READY', LEAD * 1000, _t, final ? '#ff4fa3' : '#ffd12d');
}

function _pop(f) {
    f.popped = true; f.pumping = false;
    sfx('boom'); haptic([70]);
    if (_stage?.gl) {
        const at = f.balloon.position.clone();
        _fx.burst(at, seat(f.slot).color, 0.8, 0.22);
        _fx.confetti(at, [seat(f.slot).color, 0xffffff], 18, 3);
        f.anim.play('hit');
        f.anim.flinch?.();
    }
    _placeBalloon(f);
}

function _tally() {
    _sub = 'tally'; _subT = 0;
    sfx('whistle');
    const mult = _round === ROUNDS ? 2 : 1;
    const pts = _figs.map(f => f.popped ? 0 : Math.round(f.size) * mult);
    pts.forEach((p, i) => { _score[i] += p; });
    _figs.forEach(f => {
        f.pumping = false;
        if (!f.popped) { f.banked = true; f.bankT = 0; f.anim?.play(f.size > 0 ? 'raise' : 'ready'); }
    });
    const [a, b] = pts;
    const msg = a === b ? (a === 0 ? 'BOTH POPPED!' : 'DEAD EVEN') : `${seat(a > b ? 0 : 1).name} +${Math.max(a, b)}`;
    _hud.say(msg, `LIMIT WAS ${Math.round(_limit)}`, TALLY * 1000, _t, a === b ? '#ffffff' : seat(a > b ? 0 : 1).css);
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt; _subT += dt;
    _hud.tick(_t);

    if (_phase === 'play') {
        if (_sub === 'lead' && _subT >= LEAD) { _sub = 'pump'; _subT = 0; sfx('go'); }
        else if (_sub === 'pump') {
            const left = PUMP_TIME - _subT;
            _figs.forEach(f => {
                if (f.popped) return;
                const want = isBotSlot(f.slot) ? _botWants(f) : !!_in.seat(f.slot).down;
                f.pumping = want;
                if (want) {
                    f.size += RATE * dt;
                    if (f.size >= _limit) { _pop(f); return; }
                    const near = Math.max(0, f.size - (_limit - STRAIN)) / STRAIN;
                    _squeakT[f.slot] -= dt;
                    if (near > 0.15 && _squeakT[f.slot] <= 0) { sfx('seq_lit'); haptic([6]); _squeakT[f.slot] = 0.5 - near * 0.35; }
                }
            });
            if (left < 3 && Math.ceil(left) !== Math.ceil(left + dt)) sfx('countdown');
            if (left <= 0) _tally();
        } else if (_sub === 'tally' && _subT >= TALLY) _nextRound();
    }

    _figs.forEach(f => {
        if (f.banked) f.bankT += dt;
        if (!f.rig) return;
        f.handle = f.pumping ? (f.handle + dt * 7) % 1 : Math.max(0, f.handle - dt * 3);
        const stroke = f.pumping ? Math.abs(Math.sin(f.handle * Math.PI)) : 0;
        f.plunger.position.y = 0.95 - stroke * 0.32;
        if (_phase === 'play' && _sub === 'pump' && !f.popped) f.anim.play(f.pumping ? 'shove' : 'ready', { rate: 2.6 });
        _placeBalloon(f);
    });
    _set?.update?.(dt, _t, _t * 2);
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!dirOwns && _stage?.gl && _phase !== 'over') {
        const c = _playCam();
        _stage.camera.position.fromArray(c.pos);
        _stage.camera.lookAt(...c.look);
    }
    _renderHud();
}

function _botWants(f) {
    const b = _bot[f.slot];
    if (b.cautious && f.size > b.target - 12) return false;
    return f.size < b.target;
}

function _renderHud() {
    if (!_hud) return;
    const r = Math.min(_round, ROUNDS);
    const left = _sub === 'pump' ? Math.max(0, Math.ceil(PUMP_TIME - _subT)) : '';
    // Left to right as they sit: P2 on the left, P1 on the right.
    _hud.bar(`<span style="color:${seat(1).css}">${seat(1).name} ${_score[1]}</span>` +
        `<span>🎈 ${r}/${ROUNDS}${left !== '' ? ' · ' + left + 's' : ''}</span>` +
        `<span style="color:${seat(0).css}">${_score[0]} ${seat(0).name}</span>`);
    [0, 1].forEach(slot => {
        const f = _figs[slot];
        _hud.lit(slot, !!f?.pumping);
        if (_round > 1) _hud.hint(slot, f?.popped ? 'POP!' : '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `ROUND ${r}/${ROUNDS} · ${seat(0).name} ${_score[0]} – ${_score[1]} ${seat(1).name}`;
}

function _end() {
    _phase = 'over';
    _hud.say('');
    const w = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? `${_score[0]} APIECE` : `${_score[w]} POINTS OF HOT AIR`,
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, sub: _sub, round: _round, limit: +_limit.toFixed(1), score: [..._score],
             size: _figs.map(f => +f.size.toFixed(1)), popped: _figs.map(f => f.popped), pumping: _figs.map(f => f.pumping),
             gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: fix this round's limit, and set a balloon's size. */
export function _debugLimit(v) { _limit = v; }
export function _debugSize(slot, v) { if (_figs[slot]) _figs[slot].size = v; }
