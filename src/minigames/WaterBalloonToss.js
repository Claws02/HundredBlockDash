// ============================================================
// WATER BALLOON TOSS — lobbing one back and forth in the fountain park.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Side-on hold, side by side. The two characters face each other and a water
// balloon goes back and forth between them.
//
//   TAP on your half to catch it as it arrives.
//
// A ring closes in on the catcher's hands as the balloon comes: tap when it
// meets them. Tap too early or too late and it bursts all over you. After
// every clean exchange you both take a step back, so the lob is longer and the
// window tighter. First to get soaked loses the round; best of three.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, sideHud, touch, effects } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const ROUNDS_TO_WIN = 2;
const GAP0 = 2.6, STEP = 0.75, GAP_MAX = 9.5;    // distance between them
const FLIGHT = gap => 0.95 + gap * 0.1;           // s in the air
const WINDOW = gap => Math.max(0.085, 0.2 - gap * 0.012);   // ± s around arrival
const HOLD = 0.55;                                // s the catcher holds it before throwing back
const RESULT = 1.8;
const FIG_SCALE = 1.05;
const HAND_Y = 1.15;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _figs = [], _score = [0, 0], _ball = null, _cue = null, _bot = [];
let _phase = 'intro', _sub = '', _subT = 0, _t = 0, _gap = GAP0, _round = 0, _exch = 0, _frozen = false;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _sub = ''; _subT = 0; _t = 0; _gap = GAP0; _round = 0; _exch = 0; _score = [0, 0]; _frozen = false;
    _bot = [0, 1].map(() => ({ tapAt: null }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#a9d4f2;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'side', fov: 34, background: 0xa9d4f2 });
    _hud = sideHud(_stage, { padWidth: 240 });
    _in = touch(_stage, { split: 'x', floating: false, onDown: slot => _tap(slot) });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _set = STAGE_SETS.ring(_stage, { w: 12, d: 8, lanterns: false });
        _buildBalloon();
    }
    _figs = [0, 1].map(_buildFig);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'TAP TO CATCH'));

    _dir.open({
        place: 'CITY RING ROAD · THE FOUNTAIN PARK', title: 'WATER BALLOON TOSS',
        sub: 'LAST ONE DRY WINS',
        from: { pos: [6, 4, 12], look: [0, 1.2, 0] },
        to: _cam(),
        onDone: () => { if (!_done) { _phase = 'play'; _nextRound(); } },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _ball = null; _cue = null; _set = null; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

function _cam() { return { pos: [0, 2.9 + _gap * 0.14, 8.2 + _gap * 0.9], look: [0, 1.45, 0] }; }
const _x = slot => (slot === 0 ? 1 : -1) * _gap / 2;         // P1 on the right

// ── Pieces ───────────────────────────────────────────────────────────────────
function _buildFig(slot) {
    const f = { slot, x: _x(slot), wet: 0 };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        c.rig.root.position.set(f.x, 0, 0);
        c.anim.face(slot === 0 ? -Math.PI / 2 : Math.PI / 2, true);
        c.anim.play('ready');
        Object.assign(f, { rig: c.rig, anim: c.anim });
    }
    return f;
}
function _buildBalloon() {
    const g = new THREE.Group();
    const skin = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.92 }));
    g.add(skin);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 8), skin.material); knot.position.y = 0.28; g.add(knot);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
    shine.position.set(-0.1, 0.1, 0.18); g.add(shine);
    g.castShadow = true; skin.castShadow = true;
    _stage.add(g);
    _ball = { g, skin, from: 0, to: 1, t: 0, T: 1, live: false };
    // The catch cue: a ring that closes in on the catcher's hands.
    _cue = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    _stage.add(_cue);
}

// ── Rounds and throws ────────────────────────────────────────────────────────
function _nextRound() {
    _round++;
    _gap = GAP0; _exch = 0;
    _figs.forEach(f => { f.x = _x(f.slot); f.wet = 0; f.anim?.play('ready'); });
    _hud.say(`ROUND ${_round}`, 'CATCH IT WHEN THE RING MEETS YOUR HANDS', 1500, _t, '#7dd3fc');
    _sub = 'hold'; _subT = -0.9;
    // Rounds alternate who throws first.
    _ballAt((_round % 2) ? 0 : 1);
}
function _ballAt(slot) { if (_ball) { _ball.holder = slot; _ball.live = false; } }

function _throw(from) {
    const to = 1 - from;
    Object.assign(_ball, { from, to, t: 0, T: FLIGHT(_gap), live: true, judged: false, holder: -1 });
    _sub = 'flight'; _subT = 0;
    _figs[from].anim?.play('shove', { restart: true });
    sfx('seq_lit');
    const b = _bot[to];
    // A bot's tap: arrival plus a skill-sized error.
    const err = (Math.random() + Math.random() - 1) * (0.03 + (1 - _botSkill) * 0.2);
    b.tapAt = _ball.T + err;
}

function _tap(slot) {
    if (_phase !== 'play' || _sub !== 'flight' || !_ball || _ball.to !== slot || _ball.judged) return;
    _judge(_ball.t);
}

function _judge(tapT) {
    _ball.judged = true;
    const off = tapT - _ball.T;
    if (Math.abs(off) <= WINDOW(_gap)) {
        // Caught.
        const f = _figs[_ball.to];
        _ball.live = false; _ballAt(_ball.to);
        sfx('land_good'); haptic([12]);
        f.anim?.play('raise', { restart: true });
        _hud.lit(_ball.to, true, 'rgba(56,189,248,.45)');
        // Back to the round's first thrower = one full exchange: step back.
        if (_ball.to === ((_round % 2) ? 0 : 1)) {
            _exch++;
            _gap = Math.min(GAP_MAX, _gap + STEP);
            _hud.say('STEP BACK!', `${_gap.toFixed(1)} m`, 700, _t, '#7dd3fc');
        }
        _sub = 'hold'; _subT = 0;
    } else _splash(_ball.to, off < 0 ? 'TOO EARLY!' : 'TOO LATE!');
}

function _splash(slot, why) {
    const f = _figs[slot];
    _ball.live = false; _ball.judged = true;
    sfx('boom'); haptic([70]);
    if (_stage?.gl) {
        const at = new THREE.Vector3(f.x, HAND_Y + 0.3, 0.25);
        _fx.burst(at, 0x38bdf8, 0.7, 0.25);
        _fx.confetti(at, [0x38bdf8, 0x7dd3fc, 0xffffff], 22, 2);
        _fx.puff(new THREE.Vector3(f.x, 0.2, 0.2), 0x7dd3fc, 6, 0.5, 0.4);
        f.anim.play('hit', { restart: true });
    }
    f.wet = 1;
    _score[1 - slot]++;
    _hud.say('SPLASH!', `${seat(slot).name} · ${why}`, RESULT * 1000, _t, '#38bdf8');
    _sub = 'result'; _subT = 0;
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt;
    if (!_frozen) _subT += dt;
    _hud.tick(_t);

    if (_phase === 'play') {
        if (_sub === 'hold' && _subT >= HOLD) {
            _hud.lit(0, false); _hud.lit(1, false);
            _throw(_ball.holder);
        } else if (_sub === 'flight') {
            if (!_frozen) _ball.t += dt;
            const b = _bot[_ball.to];
            if (isBotSlot(_ball.to) && !_ball.judged && b.tapAt != null && _ball.t >= b.tapAt) _judge(b.tapAt);
            // Nobody tapped: it lands on them.
            if (!_ball.judged && _ball.t > _ball.T + WINDOW(_gap)) _splash(_ball.to, 'NO CATCH!');
        } else if (_sub === 'result' && _subT >= RESULT) {
            if (Math.max(..._score) >= ROUNDS_TO_WIN) _end();
            else _nextRound();
        }
    }

    // Figures step back as the gap opens.
    _figs.forEach(f => {
        const want = _x(f.slot);
        f.x += (want - f.x) * Math.min(1, dt * 5);
        if (!f.rig) return;
        f.rig.root.position.x = f.x;
        if (_phase === 'over') return;
        f.anim.face(f.slot === 0 ? -Math.PI / 2 : Math.PI / 2, true);
    });
    if (_ball && _ball.g) {
        const g = _ball.g;
        if (_ball.live) {
            // A lob: the arc peaks higher the further it goes.
            const u = Math.min(1.15, _ball.t / _ball.T);
            const x0 = _figs[_ball.from].x, x1 = _figs[_ball.to].x;
            const h = 0.9 + _gap * 0.28;
            g.visible = true;
            g.position.set(x0 + (x1 - x0) * u, HAND_Y + 0.35 + Math.sin(Math.min(1, u) * Math.PI) * h - Math.max(0, u - 1) * 2, 0.2);
            const wob = Math.sin(_t * 20) * 0.08;
            g.scale.set(1 + wob, 1 - wob, 1 + wob);
            // The cue: closes from wide to the hands exactly at arrival.
            const k = Math.max(0, 1 - _ball.t / _ball.T);
            _cue.position.set(x1 - (x1 > 0 ? 0.1 : -0.1), HAND_Y + 0.35, 0.25);
            _cue.scale.setScalar(1 + k * 3.2);
            _cue.material.opacity = _ball.judged ? 0 : 0.35 + (1 - k) * 0.6;
            _cue.material.color.setHex(Math.abs(_ball.t - _ball.T) <= WINDOW(_gap) ? 0x4ade80 : 0xffffff);
        } else if (_ball.holder >= 0) {
            const f = _figs[_ball.holder];
            g.visible = true;
            g.position.set(f.x + (f.slot === 0 ? -0.35 : 0.35), HAND_Y + 0.35, 0.25);
            g.scale.setScalar(1);
            _cue.material.opacity = 0;
        } else { g.visible = false; _cue.material.opacity = 0; }
        if (_cue) _cue.lookAt(_stage.camera.position);
    }
    _set?.update?.(dt, _t);
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!dirOwns && _stage?.gl && _phase !== 'over') {
        const c = _cam(), cam = _stage.camera;
        cam.position.lerp(new THREE.Vector3(...c.pos), Math.min(1, dt * 3));
        cam.lookAt(...c.look);
    }
    _renderHud();
}

function _renderHud() {
    if (!_hud) return;
    _hud.bar(`<span style="color:${seat(1).css}">${seat(1).name} ${_score[1]}</span>` +
        `<span>💦 ${_gap.toFixed(1)} m · ${_exch} CATCH${_exch === 1 ? '' : 'ES'}</span>` +
        `<span style="color:${seat(0).css}">${_score[0]} ${seat(0).name}</span>`);
    if (_round > 1) [0, 1].forEach(slot => _hud.hint(slot, ''));
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `${seat(0).name} ${_score[0]} – ${_score[1]} ${seat(1).name}`;
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    const w = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;
    if (_ball?.g) _ball.g.visible = false;
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? 'BOTH SOAKED' : 'STAYED DRY',
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, sub: _sub, round: _round, score: [..._score], gap: +_gap.toFixed(2), exch: _exch,
             ball: _ball ? { from: _ball.from, to: _ball.to, t: +_ball.t.toFixed(3), T: +_ball.T.toFixed(3), live: _ball.live, holder: _ball.holder, judged: !!_ball.judged } : null,
             win: +WINDOW(_gap).toFixed(3), gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: stop the balloon's clock (so a real tap can be timed on a slow renderer). */
export function _debugFreeze(on) { _frozen = !!on; }
/** Probes: put the balloon at time t of its flight. */
export function _debugFlightT(t) { if (_ball) _ball.t = t; }
