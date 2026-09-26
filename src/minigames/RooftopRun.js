// Rooftop Run — a race across the Back Alley roofs, at night, in the neon.
//
// A stage game, side-on. Both figures run on their own — the roofs come to
// them. Between the roofs are gaps down to the street; on the roofs are
// rooftop vents to hurdle and neon signs hung low enough to take your head
// off. Same course for both, side by side, first to the finish banner.
//
//   SWIPE UP      JUMP — keep your finger down for a higher, longer one.
//   SWIPE DOWN    SLIDE — under the signs (keep it down to slide further).
//                 Slide into the runner in front of you and you take their
//                 legs out.
// Each hurdle carries a yellow ▲ JUMP board and each low sign a cyan ▼ SLIDE.
//
// Miss a gap and you drop to the street and climb back up on the far roof, a
// second and a half behind. First to two races.
//
// THE HOLD
//   SIDE-ON, like High Noon: P1 is the right half of the screen, P2 the left.
//   Both run to the right; P1's lane is the near one.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, sideHud, touch, effects } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const LEN        = 100;         // start line at 0, finish here
const RUN_V      = 7.5;         // units / s
const JUMP_V     = 8.2;
const GRAV       = 26, GRAV_HOLD = 12, HOLD_MAX = 0.26;   // holding jump floats the rise
const SLIDE_T    = 0.75, SLIDE_MIN = 0.3, SLIDE_CD = 0.3, SLIDE_BOOST = 3.2;
const STUMBLE_T  = 0.55, STUMBLE_K = 0.3;                  // speed kept while stumbling
const TRIP_T     = 0.85;
const COYOTE     = 0.12;        // s after running off an edge that a jump still counts
const FALL_WAIT  = 1.0;         // s in the street before climbing back up
const BODY_H     = 1.45, SLIDE_H = 0.7;
const SIGN_LOW   = 1.2, SIGN_HIGH = 1.9;                   // above the roof
const SWIPE      = 0.4;         // share of the stick a finger must travel to count as a swipe
const ROUND_CAP  = 28;
const WIN_ROUNDS = 2, MAX_ROUNDS = 3, READY_TIME = 1.3, RESULT_TIME = 2.0;
const FIG_SCALE  = 0.82;
const LANE       = [0.9, -0.9]; // z: P1 near the camera

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _figs = [], _bot = [], _course = null, _hazards = [];
let _round = 0, _score = [0, 0];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0;
let _dirOwns = false, _cam = { x: 0, y: 0, d: 13 }, _zones = [];
let _winner = -1;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _round = 0; _score = [0, 0]; _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0;
    _bot = [0, 1].map(() => ({ hold: 0, slide: 0, seen: -1, err: 0, miss: false }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#150e1e;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'side', fov: 36, background: 0x150e1e });
    _hud = sideHud(_stage, { padWidth: 240 });
    _in = touch(_stage, { split: 'x', stick: 50, tapPx: 10, onDown: _onDown,
                          // A flick can start and end between two frames: catch it here.
                          onRelease: (slot, r) => { const s = _in.seat(slot); if (!s.zone && r.moved) _swipe(slot, r.dx, r.dy); } });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) _set = STAGE_SETS.ba(_stage);
    _figs = [0, 1].map(_buildFig);
    _buildZones();
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'SWIPE ▲ JUMP (HOLD = HIGHER) · SWIPE ▼ SLIDE'));

    _newCourse();
    _resetRound();
    _dir.open({
        place: 'BACK ALLEY · 2 A.M.', title: 'ROOFTOP RUN',
        sub: 'MIND THE GAPS',
        from: { pos: [LEN * 0.35, 14, 30], look: [LEN * 0.2, 2, 0] },
        to: _playCam(),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null; _zones = [];
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── The course ───────────────────────────────────────────────────────────────
// Roofs with gaps between them, a step up or down at each, and a vent or a
// sign or two on the longer roofs. Every gap can be cleared with a tap from
// right at the edge; a step up of a metre wants the jump held.
function _newCourse() {
    const roofs = [{ x0: -14, x1: 9, y: 0 }], obstacles = [];
    let x = 9, y = 0, id = 0;
    const hard = Math.min(1, (_round) * 0.35);
    while (x < LEN - 16) {
        const up = Math.random() < 0.35;
        const dy = up ? 0.5 + Math.random() * 0.5 : Math.random() < 0.3 ? 0 : -(0.4 + Math.random() * 1.2);
        const gap = up ? 1.8 + Math.random() * 0.8 : 2 + Math.random() * (1 + hard * 0.5);
        y = Math.max(-3, Math.min(3, y + dy));
        const len = 9 + Math.random() * 8;
        const r = { x0: x + gap, x1: x + gap + len, y };
        roofs.push(r);
        // Obstacles, clear of both edges and of each other.
        const n = len > 12.5 ? 2 : 1;
        let ox = r.x0 + 3.2;
        for (let k = 0; k < n; k++) {
            ox += Math.random() * Math.max(0.1, (r.x1 - 3 - ox) / (n - k) - 1);
            if (ox > r.x1 - 3) break;
            if (Math.random() < 0.55) obstacles.push({ id: id++, kind: 'vent', x: ox, y, w: 0.9, h: 0.7 + Math.random() * 0.2 });
            else obstacles.push({ id: id++, kind: 'sign', x: ox, y, w: 0.3, bottom: y + SIGN_LOW, top: y + SIGN_HIGH });
            ox += 4.8;
        }
        x = r.x1;
    }
    const gap = 2.2 + Math.random() * 0.6;
    y = Math.max(-3, Math.min(3, y - 0.5));
    const lastX0 = x + gap;
    const finish = Math.max(LEN, lastX0 + 7);
    roofs.push({ x0: lastX0, x1: finish + 16, y });
    _course = { roofs, obstacles, finish };
    // What a runner meets, in order: roof edges and obstacles.
    _hazards = [];
    for (let i = 1; i < roofs.length; i++) {
        const a = roofs[i - 1], b = roofs[i];
        _hazards.push({ kind: 'gap', x: a.x1, up: b.y - a.y, width: b.x0 - a.x1, end: b.x0 });
    }
    obstacles.forEach(o => _hazards.push({ kind: o.kind, x: o.x - o.w / 2, end: o.x + o.w / 2, o }));
    _hazards.sort((p, q) => p.x - q.x);
    _set?.layCourse(_course);
}

function _roofAt(x) {
    const R = _course.roofs;
    for (let i = 0; i < R.length; i++) if (x >= R[i].x0 - 0.12 && x <= R[i].x1 + 0.12) return R[i];
    return null;
}

// ── Figures ──────────────────────────────────────────────────────────────────
function _buildFig(slot) {
    const f = { slot, z: LANE[slot] };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        Object.assign(f, { rig: c.rig, anim: c.anim });
    }
    return f;
}

function _resetFig(f) {
    Object.assign(f, { z: LANE[f.slot], x: 0, y: 0, vy: 0, ground: true, airT: 0, jumpHeld: false,
                       slide: 0, slideHeld: false, slideCd: 0, slideQueued: false, tackled: false, coyote: 0, lastFall: null, groundY: 0,
                       stumble: 0, fallT: 0, falling: false, hits: new Set(), done: false, doneT: 0 });
    if (f.rig) {
        f.rig.root.position.set(f.x, f.y, f.z);
        f.rig.root.rotation.set(0, 0, 0);
        f.anim.play('ready', { restart: true });
        f.anim.face(Math.PI / 2 - 0.35, true);
    }
}

function _resetRound() {
    _figs.forEach(_resetFig);
    _bot.forEach(b => Object.assign(b, { hold: 0, slide: 0, seen: -1, err: 0, miss: false }));
    _clock = 0; _winner = -1;
    _cam = { x: 2.2, y: 0, d: 9.5 };
}

// ── Moves ────────────────────────────────────────────────────────────────────
function _jump(slot) {
    const f = _figs[slot];
    if (_phase !== 'play' || f.fallT > 0 || f.done) return false;
    if (!f.ground && f.coyote <= 0) return false;
    f.coyote = 0;
    f.vy = JUMP_V; f.ground = false; f.airT = 0; f.jumpHeld = true;
    f.slide = 0; f.slideQueued = false;
    f.anim?.play('jump', { restart: true });
    sfx('boost'); haptic([10]);
    return true;
}

function _slide(slot) {
    const f = _figs[slot];
    if (_phase !== 'play' || f.fallT > 0 || f.done) return false;
    if (!f.ground) {                        // in the air: drop fast, slide on landing
        f.vy = Math.min(f.vy, -9); f.slideQueued = true; f.slideHeld = true;
        return true;
    }
    if (f.slideCd > 0 || f.slide > 0) return false;
    f.slide = SLIDE_T; f.slideHeld = true; f.tackled = false;
    f.anim?.play('slide', { restart: true });
    sfx('dice_throw'); haptic([12]);
    return true;
}

function _stumble(f, t, why) {
    if (f.stumble > 0.2) return;
    f.stumble = t; f.slide = 0;
    f.anim?.play('hit', { restart: true });
    sfx('slam'); haptic([40]);
    if (_stage?.gl) _fx.burst(new THREE.Vector3(f.x + 0.4, f.y + 0.8, f.z), why === 'trip' ? seat(1 - f.slot).color : 0xffd27a, 0.35, 0.22);
}

function _onDown(slot) { _in.seat(slot).zone = null; }
// Up or down, once per touch: the first clear vertical swipe decides it.
function _swipe(slot, dx, dy) {
    const s = _in.seat(slot);
    if (s.zone || Math.abs(dy) < SWIPE || Math.abs(dy) < Math.abs(dx) * 0.8) return;
    s.zone = dy < 0 ? 'jump' : 'slide';
    if (s.zone === 'jump') _jump(slot); else _slide(slot);
}

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// Reads the next hazard and acts at a distance that is right on average and
// noisier the weaker it is; now and then it simply misses one.
function _botStep(slot, dt) {
    const f = _figs[slot], b = _bot[slot], o = _figs[1 - slot];
    if (f.fallT > 0 || f.done) return;
    b.hold = Math.max(0, b.hold - dt);
    f.jumpHeld = b.hold > 0;
    if (b.slide > 0) { b.slide -= dt; f.slideHeld = true; } else f.slideHeld = false;
    const i = _hazards.findIndex(h => h.end > f.x + 0.05);
    if (i < 0) return;
    const h = _hazards[i];
    if (b.seen !== i) {
        b.seen = i;
        b.err = (Math.random() - 0.5) * (1 - _botSkill) * 1.6;
        b.miss = Math.random() < 0.1 * (1 - _botSkill) + 0.01;
        b.acted = false;
    }
    // Measured to where it will be next frame, so a slow frame cannot carry it
    // past the edge before it acts.
    const d = h.x - f.x - RUN_V * dt;
    if (!b.acted && !b.miss && (f.ground || f.coyote > 0)) {
        if (h.kind === 'gap' && d <= Math.max(0.1, 0.7 + b.err)) {
            _jump(slot); b.hold = h.up > 0.3 || h.width > 2.9 ? 0.26 : 0.08; b.acted = true;
        } else if (h.kind === 'vent' && d <= Math.max(0.4, 1.3 + b.err)) {
            _jump(slot); b.hold = 0.05; b.acted = true;
        } else if (h.kind === 'sign' && d <= Math.max(0.5, 1.5 + b.err * 0.8)) {
            if (_slide(slot)) { b.slide = SLIDE_T; b.acted = true; }
        }
    }
    // The tackle: the rival just in front, nothing in the way.
    const lead = o.x - f.x;
    if (f.ground && f.slide <= 0 && f.slideCd <= 0 && !o.done && o.fallT <= 0 && lead > 0.4 && lead < 2
        && d > 4 && Math.random() < _botSkill * dt * 3) {
        if (_slide(slot)) b.slide = 0.5;
    }
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') {
        _round++;
        if (_round > 1) { _newCourse(); [0, 1].forEach(s => _hud.hint(s, '')); }
        _resetRound();
        _hud.say(`RACE ${_round}`, 'FIRST TO THE BANNER', READY_TIME * 1000, _t, '#ff7ac0');
    } else if (phase === 'play') { _hud.say('GO!', '', 600, _t, '#34f5a0'); sfx('go'); }
    else if (phase === 'result') {
        const w = _winner;
        if (w >= 0) _score[w]++;
        _hud.say(w < 0 ? 'DEAD HEAT' : `${seat(w).name} TAKES IT`, `${_score[1]} – ${_score[0]}`, RESULT_TIME * 1000, _t, w >= 0 ? seat(w).css : '');
        sfx(w < 0 ? 'land_bad' : 'coin_gain');
        _figs.forEach(f => { if (f.anim) f.anim.play(f.slot === w ? 'victory' : 'defeat'); });
    }
}

function _step(f, dt) {
    const s = _in.seat(f.slot);
    if (!isBotSlot(f.slot)) {
        f.jumpHeld = s.down && s.zone === 'jump' && f.jumpHeld;
        f.slideHeld = s.down && s.zone === 'slide';
    }
    f.slideCd = Math.max(0, f.slideCd - dt);
    f.coyote = Math.max(0, f.coyote - dt);
    f.stumble = Math.max(0, f.stumble - dt);

    // In the street: wait, then climb back up on the far roof.
    if (f.fallT > 0) {
        f.fallT -= dt;
        f.vy -= GRAV * dt; f.y += f.vy * dt;
        if (f.fallT <= 0) {
            const R = _course.roofs.find(r => r.x0 > f.x - 0.3) || _course.roofs[_course.roofs.length - 1];
            Object.assign(f, { x: R.x0 + 0.6, y: R.y, groundY: R.y, vy: 0, ground: true, falling: false, stumble: 0, slide: 0 });
            if (_stage?.gl) _fx.puff(new THREE.Vector3(f.x, f.y + 0.3, f.z), 0xd8c8ff, 7, 0.5, 1.2);
            f.anim?.play('run', { restart: true, rate: 4.5 });
        }
        return;
    }

    let vx = RUN_V * (f.stumble > 0 ? STUMBLE_K : 1);
    if (f.slide > 0) vx += SLIDE_BOOST * (f.slide / SLIDE_T);
    let nx = f.x + vx * dt;
    // A wall: the next roof's side, if the feet are below its top.
    for (const r of _course.roofs) {
        if (r.x0 > f.x - 0.01 && r.x0 <= nx + 0.25 && f.y < r.y - 0.3) { nx = Math.min(nx, r.x0 - 0.25); break; }
    }
    if (f.ground) {
        const r = _roofAt(nx);
        if (!r || r.y < f.y - 0.05) { f.ground = false; f.vy = 0; f.airT = 0.3; f.coyote = COYOTE; }
        else { f.y = r.y; f.groundY = r.y; }
    }
    if (!f.ground) {
        const hold = f.jumpHeld && f.vy > 0 && f.airT < HOLD_MAX;
        f.vy -= (hold ? GRAV_HOLD : GRAV) * dt;
        f.airT += dt;
        const ny = f.y + f.vy * dt;
        const r = _roofAt(nx);
        if (r && f.vy <= 0 && f.y >= r.y - 0.3 && ny <= r.y) {
            f.y = r.y; f.vy = 0; f.ground = true; f.groundY = r.y;
            sfx('dice_land');
            if (f.slideQueued) { f.slideQueued = false; f.slide = SLIDE_T; f.tackled = false; f.anim?.play('slide', { restart: true }); }
        } else f.y = ny;
        // Below both roofs of the gap it is in: gone to the street.
        const R = _course.roofs, ni = R.findIndex(q => q.x0 > nx - 0.3);
        const floor = Math.min(R[Math.max(0, ni - 1)].y, R[ni >= 0 ? ni : R.length - 1].y) - 2.2;
        if (!f.ground && !_roofAt(nx) && f.y < floor) {
            f.fallT = FALL_WAIT; f.falling = true;
            f.lastFall = { x: +nx.toFixed(2), y: +f.y.toFixed(2), clock: +_clock.toFixed(2), stumble: f.stumble > 0, air: +f.airT.toFixed(2) };
            f.anim?.play('fall', { restart: true });
            sfx('coin_loss'); haptic([70]);
        }
    }
    f.x = nx;
    // Slide timer.
    if (f.slide > 0) {
        f.slide -= dt;
        if (!f.slideHeld && SLIDE_T - f.slide > SLIDE_MIN) f.slide = 0;
        if (f.slide <= 0) { f.slide = 0; f.slideCd = SLIDE_CD; }
    }
    // Obstacles.
    const top = f.y + (f.slide > 0 ? SLIDE_H : BODY_H);
    for (const o of _course.obstacles) {
        if (f.hits.has(o.id) || Math.abs(o.x - f.x) > o.w / 2 + 0.3) continue;
        const hit = o.kind === 'vent' ? f.y < o.y + o.h - 0.06 : (top > o.bottom && f.y < o.top);
        if (hit) { f.hits.add(o.id); _stumble(f, STUMBLE_T, o.kind); }
    }
    if (!f.done && f.x >= _course.finish) { f.done = true; f.doneT = _clock; }
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
        [0, 1].forEach(slot => {
            if (isBotSlot(slot)) return _botStep(slot, dt);
            const s = _in.seat(slot);
            if (s.down && !s.zone) _swipe(slot, s.dx, s.dy);
        });
        _figs.forEach(f => _step(f, dt));
        // Slide tackles.
        _figs.forEach(f => {
            const o = _figs[1 - f.slot];
            if (f.slide <= 0 || f.tackled || SLIDE_T - f.slide > 0.45 || o.fallT > 0 || o.done) return;
            const gap = o.x - f.x;
            if (gap > -0.15 && gap < 0.95 && Math.abs(o.y - f.y) < 0.6 && o.slide <= 0) {
                f.tackled = true;
                _stumble(o, TRIP_T, 'trip');
                _hud.say('TRIPPED!', `${seat(f.slot).name} TOOK ${seat(o.slot).name}'S LEGS`, 900, _t, seat(f.slot).css);
            }
        });
        const fin = _figs.filter(f => f.done);
        if (fin.length) {
            const [a, b] = _figs;
            _winner = fin.length === 2 && Math.abs(a.x - b.x) < 0.01 ? -1 : (a.x > b.x ? 0 : 1);
            _enter('result');
        } else if (_clock >= ROUND_CAP) {
            _winner = Math.abs(_figs[0].x - _figs[1].x) < 0.3 ? -1 : (_figs[0].x > _figs[1].x ? 0 : 1);
            _enter('result');
        }
    } else if (_phase === 'result') {
        // Coast to a stop.
        _figs.forEach(f => { if (f.fallT <= 0 && f.ground) f.x += RUN_V * Math.max(0, 0.5 - _phaseT) * dt; });
    }

    // Figures.
    _figs.forEach(f => {
        if (!f.rig) return;
        f.rig.root.position.set(f.x, f.y, f.z);
        if (_phase !== 'play') return;
        if (f.fallT > 0) return;
        const st = f.stumble > 0 ? f.anim.state : f.slide > 0 ? 'slide' : !f.ground ? 'jump' : 'run';
        if (f.anim.state !== st && !(f.stumble > 0)) f.anim.play(st, { rate: 4.8 });
        if (f.stumble <= 0 && (f.anim.state === 'hit' || f.anim.state === 'fall')) f.anim.play('run', { rate: 4.8 });
        f.anim.face(Math.PI / 2 - 0.35);
    });
    // Steam off the vents now and then.
    if (_stage?.gl && _set && Math.random() < dt * 2) {
        const near = _set.steam.filter(s => Math.abs(s.at.x - _cam.x) < 12);
        if (near.length) { const s = near[Math.floor(Math.random() * near.length)]; _fx.puff(s.at.clone(), 0xd8dde5, 3, 0.3, 1.6); }
    }
    _updateCam(dt);
    _set?.update(dt, _t, _cam.x, _cam.y);
    _fx?.update(dt);
    _dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!_dirOwns && _stage?.gl && _phase !== 'over') {
        const c = _playCam();
        _stage.camera.position.fromArray(c.pos);
        _stage.camera.lookAt(...c.look);
        _stage.camera.userData.look = c.look;
    }
    _renderHud();
}

// Frames both runners, a little ahead of them, pulling back as they spread.
function _updateCam(dt) {
    if (!_figs.length) return;
    const xs = _figs.map(f => f.x), ys = _figs.map(f => f.groundY ?? 0);
    const lead = Math.max(...xs), trail = Math.min(...xs);
    const sep = Math.min(lead - trail, 16);
    const tx = lead - sep / 2 + 2.2, ty = (ys[0] + ys[1]) / 2;
    const td = 9.5 + Math.max(0, sep - 3) * 0.6;
    const k = 1 - Math.exp(-dt * 5);
    _cam.x += (tx - _cam.x) * k; _cam.y += (ty - _cam.y) * (1 - Math.exp(-dt * 4)); _cam.d += (td - _cam.d) * (1 - Math.exp(-dt * 2));
}
function _playCam() { return { pos: [_cam.x - 1.2, _cam.y + 2.3, _cam.d], look: [_cam.x + 0.6, _cam.y + 1.1, 0] }; }

// ── HUD ──────────────────────────────────────────────────────────────────────
function _buildZones() {
    const root = _stage.hud;
    _zones = [0, 1].map(slot => {
        if (seat(slot).bot) return null;
        const z = document.createElement('div');
        z.style.cssText = `position:absolute;top:0;bottom:0;width:50%;${slot === 0 ? 'right:0;' : 'left:0;'}pointer-events:none;`;
        const lab = 'position:absolute;left:0;right:0;text-align:center;font-size:14px;letter-spacing:3px;color:rgba(255,255,255,.4);';
        const up = document.createElement('div'), dn = document.createElement('div');
        up.style.cssText = lab + 'top:22%;'; up.textContent = '⇧ SWIPE UP · JUMP';
        dn.style.cssText = lab + 'top:66%;'; dn.textContent = '⇩ SWIPE DOWN · SLIDE';
        z.append(up, dn);
        root.appendChild(z);
        return z;
    });
}

function _renderHud() {
    if (!_hud || !_course) return;
    const stars = n => '★'.repeat(n) + '☆'.repeat(Math.max(0, WIN_ROUNDS - n));
    const pct = f => Math.max(0, Math.min(1, f.x / _course.finish)) * 100;
    const dot = f => `<span style="position:absolute;top:-3px;left:calc(${pct(f)}% - 6px);width:12px;height:12px;border-radius:50%;background:${seat(f.slot).css};box-shadow:0 0 6px ${seat(f.slot).css}"></span>`;
    _hud.bar(`<span style="color:${seat(1).css}">${seat(1).name}</span><span>${stars(_score[1])}</span>` +
        `<span style="position:relative;display:inline-block;width:150px;height:6px;border-radius:3px;background:rgba(255,255,255,.25)">` +
        `<span style="position:absolute;right:-2px;top:-5px;font-size:12px">🏁</span>${_figs.map(dot).join('')}</span>` +
        `<span>${stars(_score[0])}</span><span style="color:${seat(0).css}">${seat(0).name}</span>`);
    _figs.forEach(f => _hud.lit(f.slot, f.slide > 0 || !f.ground, f.slide > 0 ? 'rgba(52,245,160,.3)' : 'rgba(255,122,192,.3)'));
    _zones.forEach(z => { if (z) z.style.opacity = _phase === 'play' || _phase === 'ready' ? (_round > 1 ? '0.5' : '1') : '0'; });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `RACE ${_round} · ${seat(1).name} ${_score[1]} – ${_score[0]} ${seat(0).name}`;
}

function _end() {
    _phase = 'over';
    _hud.say('');
    _zones.forEach(z => { if (z) z.style.opacity = '0'; });
    const w = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;
    // Both on the finish roof for the verdict.
    const fr = _course.roofs[_course.roofs.length - 1];
    _figs.forEach(f => {
        Object.assign(f, { x: _course.finish + 2 + (f.slot === 0 ? 1.3 : -1.3), y: fr.y, z: 0, groundY: fr.y, fallT: 0, slide: 0, stumble: 0 });
        if (f.rig) { f.rig.root.position.set(f.x, f.y, f.z); f.anim.face(f.slot === 0 ? 0.4 : -0.4, true); }
    });
    _cam.x = _course.finish + 2; _cam.y = fr.y;
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? 'NECK AND NECK' : 'FASTEST ON THE ROOFS',
        // From the winner's outer side, so the other one is off the edge of the shot.
        closeUp: (f, p) => ({ pos: [p.x + (f.slot === 0 ? 1.4 : -1.4), p.y + 1.5, p.z + 4.2], look: [p.x, p.y + 0.8, p.z] }),
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// For probes.
export function _debugState() {
    return {
        phase: _phase, round: _round, score: _score.slice(), clock: +_clock.toFixed(2),
        x: _figs.map(f => +f.x.toFixed(2)), y: _figs.map(f => +f.y.toFixed(2)),
        ground: _figs.map(f => f.ground), slide: _figs.map(f => f.slide > 0), stumble: _figs.map(f => f.stumble > 0),
        falling: _figs.map(f => f.fallT > 0), lastFall: _figs.map(f => f.lastFall || null), done: _figs.map(f => f.done),
        finish: _course?.finish ?? 0, hazards: _hazards.map(h => ({ kind: h.kind, x: +h.x.toFixed(2), end: +h.end.toFixed(2), up: +(h.up ?? 0).toFixed(2) })),
        gl: !!_stage?.gl, turned: !!_stage?.turned,
    };
}
/** Probes: each sign's bar, drawn (lowest lit tube in the scene at its x) against judged (o.bottom). */
export function _debugSignBars() {
    if (!_stage?.gl || !_course) return [];
    const tubes = [];
    _stage.scene.traverse(m => {
        if (m.isMesh && m.geometry?.parameters?.height === 0.12 && m.geometry.parameters.depth === 4.3) {
            const v = new THREE.Vector3(); m.getWorldPosition(v); tubes.push(v);
        }
    });
    return _course.obstacles.filter(o => o.kind === 'sign').map(o => {
        const mine = tubes.filter(v => Math.abs(v.x - o.x) < 0.05).map(v => v.y);
        return { x: +o.x.toFixed(2), roof: +o.y.toFixed(2), judged: +o.bottom.toFixed(2), mesh: mine.length ? +Math.min(...mine).toFixed(2) : null };
    });
}
/** Probes: stand a runner somewhere on the course (on the roof under x). */
export function _debugPlace(slot, x) {
    const f = _figs[slot], r = _roofAt(x);
    if (!f || !r) return false;
    Object.assign(f, { x, y: r.y, groundY: r.y, vy: 0, ground: true, fallT: 0, stumble: 0, slide: 0, hits: new Set() });
    return true;
}
