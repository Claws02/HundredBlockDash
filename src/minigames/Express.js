// The 4:15 to Perdition — sumo on the roof of a moving train.
//
// The fourth game on the shared 3D stage. Both figures stand on the roof of
// the carriage behind the locomotive while Ironwood Railyard streams past.
// Shove the other one off either end of the roof. Every few seconds the
// whistle blows and a low timber bridge comes over the track: anybody still
// standing when it passes is swept off the back of the train.
//
//   DRAG  across your half to walk along the roof.
//   TAP   to lunge and shove.
//   HOLD  to duck — under a bridge, and braced against a shove. Ducking
//         cannot walk or shove, and that is the whole game: the bridge makes
//         both of you duck at once, and whoever stands up first gets the
//         first shove.
//
// First to two rounds. A round the train reaches Perdition without anybody
// falling goes to whoever is nearer the middle of the roof.
//
// THE HOLD
//   SIDE-ON, like High Noon: P1 is the right-hand figure and the right half
//   of the screen, P2 the left.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot, seatFor } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const ROOF_Y      = 3.4;
const ROOF_HALF   = 5.6;
const TRAIN_SPEED = 16;
const WIN_ROUNDS  = 2;
const MAX_ROUNDS  = 3;
const ROUND_TIME  = 15;       // reaching Perdition; nearest the middle takes it
const READY_TIME  = 1.3;
const RESULT_TIME = 2.0;
const WALK        = 4.2;      // units / s
const LUNGE_T     = 0.2;
const LUNGE_V     = 6.5;
const REACH       = 1.25;
const SHOVE_V     = 9.5;      // knockback on a standing figure
const BRACED_V    = 3.4;      // ...on a ducking one
const COOLDOWN    = 0.6;
const BODY        = 0.9;      // how close two figures can stand
const WARN        = 1.5;      // s of whistle before a bridge reaches the roof
const BRIDGE_GAP  = [3.6, 5.8];
const TAP_MS      = 220;
const TAP_PX      = 12;
const HOLD_S      = 0.16;
const STICK_PX    = 45;
const FIG_SCALE   = 0.85;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null;
let _figs = [];
let _in = [];                  // per slot: pointer state
let _bot = [];
let _round = 0, _score = [0, 0];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0;
let _bridge = null;            // { x0, t0, obj, prevX, warned }
let _nextBridge = 0;
let _result = null;
let _shake = 0;
let _dirOwns = false;

// ── Lifecycle ────────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _round = 0; _score = [0, 0]; _t = 0; _clock = 0; _shake = 0; _result = null; _bridge = null;
    _in = [0, 1].map(() => ({ pid: null, ax: 0, ay: 0, t0: 0, moved: false, drive: 0, held: false }));
    _bot = [0, 1].map(() => ({ tick: 0, drive: 0, duck: false, miss: false, jit: 0 }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#cfa478;z-index:5;';
    mg.appendChild(_overlay);

    _stage = createStage(_overlay, { hold: 'side', fov: 34, background: 0xf0a868 });
    _buildHud();
    _dir = createDirector(_stage);
    if (_stage.gl) _set = STAGE_SETS.rail(_stage, { speed: TRAIN_SPEED, roofY: ROOF_Y, roofHalf: ROOF_HALF });
    _figs = [0, 1].map(slot => _buildFigure(slot));

    _stage.listen('pointerdown', _onDown);
    _stage.listen('pointermove', _onMove);
    _stage.listen('pointerup', _onUp);
    _stage.listen('pointercancel', _onUp);
    _stage.onResize(() => _layoutHud());

    _resetRound();
    _dir.open({
        place: 'IRONWOOD RAILYARD · DAWN', title: 'THE 4:15 TO PERDITION',
        sub: 'SHOVE THEM OFF · DUCK THE BRIDGES',
        from: { pos: [-22, 9, 14], look: [-6, 3, 0] },
        to: _playCam(),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _set = null; _dir = null; _hud = null; _bridge = null;
}

function _finish(winner) {
    if (_done) return;                           // R6
    _destroy();
    _onWin?.(winner);
}

// Close enough that the figures read, wide enough for the whole roof.
function _playCam() { return { pos: [0, 5.2, 12.2], look: [0, ROOF_Y + 0.5, 0] }; }

// ── Figures ──────────────────────────────────────────────────────────────────
const _home = slot => (slot === 0 ? 2.4 : -2.4);

function _buildFigure(slot) {
    const f = { slot, x: _home(slot), v: 0, duck: false, lunge: 0, lungeDir: 0, cool: 0, stun: 0,
                out: false, outT: 0, outV: 0, y: ROOF_Y, vy: 0, moving: false };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        Object.assign(f, { rig: c.rig, anim: c.anim });
    }
    return f;
}

function _resetRound() {
    _figs.forEach(f => {
        Object.assign(f, { x: _home(f.slot), v: 0, duck: false, lunge: 0, cool: 0, stun: 0,
                           out: false, outT: 0, outV: 0, y: ROOF_Y, vy: 0 });
        if (f.rig) {
            f.rig.root.position.set(f.x, ROOF_Y, 0);
            f.rig.root.rotation.set(0, 0, 0);
            f.anim.play('idle', { restart: true });
            f.anim.face(_faceOf(f), true);
        }
    });
    _in.forEach(s => Object.assign(s, { drive: 0, held: false }));
    _bot.forEach(b => Object.assign(b, { tick: 0, drive: 0, duck: false }));
    if (_bridge?.obj) _bridge.obj.visible = false;
    _bridge = null;
    _clock = 0;
    _nextBridge = 3.4 + Math.random() * 1.2;
}

// Toward the other figure, turned a little toward the camera so faces read.
function _faceOf(f) {
    const other = _figs[1 - f.slot];
    const dir = other ? Math.sign(other.x - f.x) || (f.slot === 0 ? -1 : 1) : (f.slot === 0 ? -1 : 1);
    return dir * (Math.PI / 2 - 0.4);
}

// ── Rounds ───────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') {
        _round++;
        // The how-to line is for the first round; after that it is clutter.
        if (_round > 1 && _hud) _hud.pads.forEach(p => { p.h.style.display = 'none'; });
        _resetRound();
        _say(`ROUND ${_round}`, 'SHOVE THEM OFF THE TRAIN', READY_TIME * 1000);
    } else if (phase === 'play') {
        _say('');
        sfx('go');
    } else if (phase === 'result') {
        const r = _result;
        if (r.winner >= 0) _score[r.winner]++;
        _say(r.title, r.sub, RESULT_TIME * 1000);
        sfx(r.winner < 0 ? 'land_bad' : 'coin_gain');
    }
    _neutral();
}

function _endRound(winner, title, sub) {
    if (_phase !== 'play') return;
    _result = { winner, title, sub };
    _enter('result');
}

function _endMatch() {
    _phase = 'over';
    _say('');
    const w = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;
    // Anyone who went over the side is back up for the verdict — on the roof.
    _figs.forEach(f => {
        Object.assign(f, { out: false, x: _home(f.slot), v: 0, y: ROOF_Y, duck: false, lunge: 0 });
        if (f.rig) { f.rig.root.position.set(f.x, ROOF_Y, 0); f.rig.root.rotation.set(0, 0, 0); f.anim.face(_faceOf(f), true); }
    });
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? 'THEY BOTH RODE IN' : 'FIRST INTO PERDITION',
        onDone: () => _finish(w),
    });
    _neutral(w < 0 ? 'DRAW!' : `${_name(w)} WINS!`);
}

// ── Input: drag to walk, tap to shove, hold to duck ──────────────────────────
function _slotAt(p) { return p.x >= _stage.width / 2 ? 0 : 1; }

function _onDown(e) {
    if (_done) return;
    e.preventDefault();
    const p = _stage.toLocal(e.clientX, e.clientY);
    const slot = _slotAt(p);
    const s = _in[slot];
    if (isBotSlot(slot) || s.pid !== null) return;
    Object.assign(s, { pid: e.pointerId, ax: p.x, ay: p.y, t0: performance.now(), moved: false, drive: 0, held: true });
}
function _onMove(e) {
    const s = _in.find(x => x.pid === e.pointerId);
    if (!s) return;
    const p = _stage.toLocal(e.clientX, e.clientY);
    let dx = p.x - s.ax;
    if (Math.abs(dx) > TAP_PX) s.moved = true;
    if (Math.abs(dx) > STICK_PX) { s.ax = p.x - Math.sign(dx) * STICK_PX; dx = Math.sign(dx) * STICK_PX; }
    s.drive = s.moved ? dx / STICK_PX : 0;
}
function _onUp(e) {
    const s = _in.find(x => x.pid === e.pointerId);
    if (!s) return;
    const slot = _in.indexOf(s);
    const quick = performance.now() - s.t0 < TAP_MS && !s.moved;
    Object.assign(s, { pid: null, drive: 0, held: false, moved: false });
    if (quick) _shove(slot);
}

// ── Moves ────────────────────────────────────────────────────────────────────
function _shove(slot) {
    const f = _figs[slot];
    if (_phase !== 'play' || f.out || f.cool > 0 || f.stun > 0 || f.duck) return false;
    const o = _figs[1 - slot];
    f.lungeDir = Math.sign(o.x - f.x) || (slot === 0 ? -1 : 1);
    f.lunge = LUNGE_T; f.cool = COOLDOWN; f.hitDone = false;
    f.anim?.play('shove', { restart: true });
    haptic([15]);
    return true;
}

function _knockOff(f, dir, why) {
    if (f.out) return;
    f.out = true; f.outT = 0; f.outV = dir * 7; f.vy = 4;
    f.anim?.play('hit', { restart: true });
    sfx('slam'); haptic([60]);
    _shake = Math.max(_shake, 0.35);
    f.why = why;
}

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
function _botThink(slot, dt) {
    const f = _figs[slot], o = _figs[1 - slot], b = _bot[slot];
    // The bridge first: duck in time, unless this is the one it misjudges.
    if (_bridge) {
        const bx = _bridgeX();
        const tta = (f.x - bx) / TRAIN_SPEED;           // s until it reaches us
        const lead = 0.12 + _botSkill * 0.22 + b.jit;
        b.duck = !b.miss && tta > -0.15 && tta < lead + 0.25;
        if (b.duck) { b.drive = 0; return; }
    } else b.duck = false;
    // Brace when they lunge at us near an edge.
    if (o.lunge > 0 && Math.abs(f.x) > ROOF_HALF - 1.6 && Math.random() < _botSkill * 0.6) { b.duck = true; b.drive = 0; return; }
    b.tick -= dt;
    if (b.tick > 0) return;
    b.tick = 0.3 - _botSkill * 0.18 + Math.random() * 0.15;
    const gap = o.x - f.x, dist = Math.abs(gap);
    // Keep to the middle side of them: back away from an edge first.
    if (Math.abs(f.x) > ROOF_HALF - 1.4 && Math.sign(f.x) === Math.sign(-gap)) { b.drive = -Math.sign(f.x); return; }
    if (dist < REACH * 0.95 && f.cool <= 0 && Math.random() < 0.5 + _botSkill * 0.4) { _shove(slot); b.drive = 0; return; }
    b.drive = Math.sign(gap) * (0.6 + 0.4 * _botSkill);
}

// ── Bridges ──────────────────────────────────────────────────────────────────
function _bridgeX() { return _bridge ? _bridge.x0 + TRAIN_SPEED * (_clock - _bridge.t0) : -99; }

function _spawnBridge() {
    const x0 = -ROOF_HALF - 0.6 - TRAIN_SPEED * WARN;
    _bridge = { x0, t0: _clock, prevX: x0, obj: _set ? _set.spawnBridge(x0) : null };
    _bot.forEach(b => { b.miss = Math.random() < (0.18 - _botSkill * 0.15); b.jit = (Math.random() - 0.5) * 0.12; });
    sfx('whistle');
    // Up until the bridge is past the whole roof, not just until it arrives.
    _say('DUCK!', 'BRIDGE AHEAD — HOLD', (WARN + (ROOF_HALF * 2 + 2) / TRAIN_SPEED) * 1000);
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    if (_hud?.clearAt && _t > _hud.clearAt) _say('');

    if (_phase === 'ready' && _phaseT > READY_TIME) _enter('play');
    else if (_phase === 'result' && _phaseT > RESULT_TIME) {
        if (_score[0] >= WIN_ROUNDS || _score[1] >= WIN_ROUNDS || _round >= MAX_ROUNDS) _endMatch();
        else _enter('ready');
    }

    if (_phase === 'play') {
        _clock += dt;
        if (!_bridge && _clock >= _nextBridge) _spawnBridge();
        [0, 1].forEach(slot => { if (isBotSlot(slot)) _botThink(slot, dt); });

        _figs.forEach(f => {
            if (f.out) return;
            const s = _in[f.slot], b = _bot[f.slot];
            const bot = isBotSlot(f.slot);
            // Ducking: a human holding still past HOLD_S; a bot when it decides.
            f.duck = bot ? b.duck : (s.held && !s.moved && (performance.now() - s.t0) / 1000 > HOLD_S);
            const drive = f.duck || f.stun > 0 || f.lunge > 0 ? 0 : (bot ? b.drive : s.drive);
            f.cool = Math.max(0, f.cool - dt);
            f.stun = Math.max(0, f.stun - dt);
            let vx = drive * WALK + f.v;
            if (f.lunge > 0) {
                f.lunge -= dt;
                vx += f.lungeDir * LUNGE_V;
                const o = _figs[1 - f.slot];
                if (!f.hitDone && !o.out && Math.abs(o.x - f.x) < REACH) {
                    f.hitDone = true;
                    f.lunge = 0;        // the lunge stops on contact — it used to carry the shover off the end after them
                    o.v = f.lungeDir * (o.duck ? BRACED_V : SHOVE_V);
                    o.stun = o.duck ? 0.1 : 0.3;
                    sfx('slam'); haptic([40]);
                    _shake = Math.max(_shake, o.duck ? 0.1 : 0.25);
                    if (!o.duck) o.anim?.flinch();
                }
            }
            f.x += vx * dt;
            f.v *= Math.exp(-(f.duck ? 11 : 6) * dt);
            f.moving = Math.abs(drive) > 0.1;
        });
        // Bodies do not overlap.
        const [a, c] = _figs;
        if (!a.out && !c.out && Math.abs(a.x - c.x) < BODY) {
            const mid = (a.x + c.x) / 2, s = Math.sign(a.x - c.x) || 1;
            a.x = mid + s * BODY / 2; c.x = mid - s * BODY / 2;
        }
        // Off either end.
        _figs.forEach(f => { if (!f.out && Math.abs(f.x) > ROOF_HALF + 0.05) _knockOff(f, Math.sign(f.x), 'shove'); });
        // The bridge sweeps the roof from the front (-x) back.
        if (_bridge) {
            const bx = _bridgeX();
            _figs.forEach(f => {
                if (!f.out && !f.duck && _bridge.prevX < f.x + 0.3 && bx >= f.x - 0.3) _knockOff(f, 1, 'bridge');
            });
            _bridge.prevX = bx;
            if (bx > ROOF_HALF + 2) {
                _bridge = null;
                _nextBridge = _clock + BRIDGE_GAP[0] + Math.random() * (BRIDGE_GAP[1] - BRIDGE_GAP[0]) - (_round - 1) * 0.4;
            }
        }
        // Round over?
        const outs = _figs.filter(f => f.out);
        if (outs.length === 2) _endRound(-1, 'BOTH OFF!', 'NOBODY TAKES IT');
        else if (outs.length === 1 && outs[0].outT > 0.35) {
            const w = 1 - outs[0].slot;
            _endRound(w, `${_name(w)} TAKES IT`, outs[0].why === 'bridge' ? `${_name(outs[0].slot)} MET THE BRIDGE` : `${_name(outs[0].slot)} WENT OVER THE SIDE`);
        } else if (_clock >= ROUND_TIME) {
            const d0 = Math.abs(_figs[0].x), d1 = Math.abs(_figs[1].x);
            const w = Math.abs(d0 - d1) < 0.3 ? -1 : (d0 < d1 ? 0 : 1);
            _endRound(w, 'PERDITION!', w < 0 ? 'LEVEL AT THE STATION' : `${_name(w)} HELD THE MIDDLE`);
        }
    }

    // Figures: falling ones tumble and are left behind by the train.
    _figs.forEach(f => {
        if (f.out) {
            f.outT += dt;
            f.vy -= 22 * dt;
            f.y = Math.max(0, f.y + f.vy * dt);
            f.x += (f.outV + (f.y <= 0 ? TRAIN_SPEED : TRAIN_SPEED * Math.min(1, f.outT * 1.5))) * dt;
        }
        if (!f.rig) return;
        f.rig.root.position.set(f.x, f.out ? f.y : ROOF_Y, 0);
        if (f.out) return;
        f.anim.face(_faceOf(f));
        const st = f.lunge > 0 ? 'shove' : f.duck ? 'duck' : f.moving ? 'walk' : 'ready';
        if (f.anim.state !== st && !(f.anim.state === 'shove' && f.lunge > 0)) f.anim.play(st, { rate: 3.4 });
    });

    _set?.update(dt, _t);
    _dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!_dirOwns && _stage?.gl && _phase !== 'over') {
        const c = _playCam(), cam = _stage.camera;
        cam.position.fromArray(c.pos);
        if (_shake > 0) {
            cam.position.x += (Math.random() - 0.5) * _shake;
            cam.position.y += (Math.random() - 0.5) * _shake;
            _shake = Math.max(0, _shake - dt * 1.5);
        }
        cam.lookAt(...c.look);
        cam.userData.look = c.look;
    }
    _renderHud();
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function _name(slot) {
    const p = state.players[seatFor(slot)];
    return (p && p.name ? p.name : `P${slot + 1}`).toUpperCase();
}
function _css(slot) {
    const c = state.players[seatFor(slot)]?.color ?? (slot === 0 ? 0xff3b3b : 0x3b8eff);
    return '#' + c.toString(16).padStart(6, '0');
}
function _el(tag, css, parent) {
    const e = document.createElement(tag);
    e.style.cssText = css;
    (parent || _hud.root).appendChild(e);
    return e;
}

function _buildHud() {
    const root = _stage.hud;
    root.classList.add('bfont');
    _hud = { root };
    const txt = 'color:#fff8e6;text-shadow:0 2px 0 #3b2716,0 0 12px rgba(0,0,0,.5);letter-spacing:2px;';
    _hud.score = _el('div', 'position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:14px;' +
        'padding:5px 16px;border-radius:14px;background:rgba(40,24,12,.62);font-size:19px;white-space:nowrap;' + txt);
    _hud.pads = [0, 1].map(slot => {
        const pad = _el('div', `position:absolute;bottom:10px;width:300px;padding:3px 8px;border-radius:14px;text-align:center;white-space:nowrap;` +
            `background:rgba(40,24,12,.55);border:2px solid ${_css(slot)};` + txt);
        const n = _el('div', 'font-size:15px;', pad);
        n.textContent = _name(slot) + (isBotSlot(slot) ? ' · BOT' : '');
        const h = _el('div', 'font-size:11px;opacity:.9;', pad);
        h.textContent = isBotSlot(slot) ? '' : 'DRAG · TAP TO SHOVE · HOLD TO DUCK';
        return { pad, h };
    });
    const bigBox = _el('div', 'position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);text-align:center;' +
        'white-space:nowrap;opacity:0;transition:opacity .15s;' + txt);
    _hud.bigBox = bigBox;
    _hud.big = _el('div', 'font-size:54px;display:inline-block;', bigBox);
    _hud.sub = _el('div', 'font-size:18px;', bigBox);
    _layoutHud();
}
function _layoutHud() {
    if (!_hud || !_stage) return;
    const W = _stage.width;
    _hud.pads[0].pad.style.left = (W * 0.75 - 150) + 'px';
    _hud.pads[1].pad.style.left = (W * 0.25 - 150) + 'px';
}
function _say(msg, sub = '', ms = 0) {
    if (!_hud) return;
    _hud.big.textContent = msg; _hud.sub.textContent = sub;
    _hud.bigBox.style.opacity = msg ? '1' : '0';
    _hud.big.style.animation = 'none'; void _hud.big.offsetWidth;
    _hud.big.style.animation = msg ? 'countPop .35s ease' : 'none';
    _hud.big.style.color = msg === 'DUCK!' ? '#facc15' : '';
    _hud.clearAt = ms ? _t + ms / 1000 : 0;
}
function _renderHud() {
    if (!_hud) return;
    const stars = n => '★'.repeat(n) + '☆'.repeat(Math.max(0, WIN_ROUNDS - n));
    _hud.score.innerHTML = `<span style="color:${_css(1)}">${_name(1)}</span><span>${stars(_score[1])}</span>` +
        `<span style="opacity:.6">${_phase === 'play' ? Math.ceil(ROUND_TIME - _clock) + 's' : '·'}</span>` +
        `<span>${stars(_score[0])}</span><span style="color:${_css(0)}">${_name(0)}</span>`;
    _figs.forEach(f => {
        const p = _hud.pads[f.slot].pad;
        p.style.background = f.duck ? 'rgba(250,204,21,.35)' : 'rgba(40,24,12,.55)';
    });
    if (_phase === 'play') _neutral();
}
function _neutral(msg) {
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = msg || `ROUND ${_round} · ${_score[1]}–${_score[0]}`;
}

// For probes.
export function _debugState() {
    return {
        phase: _phase, round: _round, score: _score.slice(), clock: +_clock.toFixed(2),
        x: _figs.map(f => +f.x.toFixed(2)), out: _figs.map(f => f.out), duck: _figs.map(f => f.duck),
        cool: _figs.map(f => +f.cool.toFixed(2)), bridge: _bridge ? +_bridgeX().toFixed(2) : null,
        result: _result, gl: !!_stage?.gl, turned: !!_stage?.turned,
    };
}
/** Probes: fire a bridge now. */
export function _debugBridge() { if (_phase === 'play' && !_bridge) _spawnBridge(); }
/** Probes: stand the figures somewhere. */
export function _debugPlace(slot, x) { const f = _figs[slot]; if (f) { f.x = x; f.v = 0; } }
