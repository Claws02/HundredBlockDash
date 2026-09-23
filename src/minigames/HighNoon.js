// High Noon — a showdown on Perdition's main street, played as your own figure.
//
// The first game built on the shared stage (src/engine/Stage.js), and the
// pilot for everything a 3D, character-driven minigame needs: the players'
// own figures rigged and animated, a set built from the board's own scenery,
// a camera that directs the scene, and a verdict you watch happen.
//
// THE STORY OF A ROUND
//   Two figures stand back to back in the street under the bell tower. Both
//   players put a thumb down on their side — a hand on the holster — and the
//   pair start pacing away from each other. Somewhere between the third pace
//   and the eighth the bell rings. The figures spin round and whoever LETS GO
//   first fires first.
//
//   Let go before the bell and you have flinched: your gun goes off into the
//   dirt and the round is theirs. The town does not help: a crow bursts off
//   the saloon, a shutter slams, a tumbleweed rolls through. None of them is
//   the bell. Decoys come more often as the match goes on.
//
//   First to three rounds. A round is about six seconds.
//
// THE HOLD
//   Landscape ('sideon'): both players side by side along one long edge. P1's
//   ready button is on the phone's home edge, which is on the players' right,
//   so P1 is the RIGHT-hand figure and holds the right half; P2 the left.
//
// ONE VERB, AND A STRUCTURAL CEILING
//   Hold, then let go. A player who never puts a thumb down forfeits the round
//   after HOLSTER_WAIT seconds, a draw nobody lets go of is void after
//   DRAW_WAIT, two void rounds in a row settle the match on the score, and a
//   match stops at MAX_ROUNDS regardless, so it always ends well inside the
//   manager's 90 s net.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot, seatFor } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const WIN_ROUNDS   = 3;
const MAX_ROUNDS   = 7;      // voids and forfeits count; the match cannot run on
const MAX_VOIDS    = 2;      // back-to-back rounds nobody played end the match
const PACE_LEN     = 0.85;   // world units per pace
const PACE_TIME    = 0.5;    // seconds per pace
const START_X      = 0.55;   // back to back, a figure's width apart
const BELL_MIN     = 3;      // earliest pace the bell can come on
const BELL_MAX     = 8;
const HOLSTER_WAIT = 6.0;    // s to get a thumb down before the round is forfeit
const DRAW_WAIT    = 2.5;    // s after the bell before a round nobody fired is void
const RESOLVE_TIME = 2.0;    // the shot, the fall, the scoreline
const FINALE_TIME  = 2.4;    // the winner's moment before the scoreboard

// ── Module state (singleton; reset in start) ─────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _hud = null;
let _figs = [];              // [{ slot, rig, anim, gun, x }]  slot 0 = P1 (right)
let _score = [0, 0];
let _round = 0;
let _voids = 0;              // consecutive rounds nobody played
let _phase = 'intro', _phaseT = 0;
let _held = [0, 0];          // live pointer count per slot
let _pointers = new Map();   // pointerId → slot
let _bellPace = 5, _pace = 0;
let _decoys = [];            // [{ pace, kind }] for this round
let _bellAt = 0;             // stage time the bell rang
let _released = [-1, -1];    // stage time each slot let go after the bell
let _bot = [];               // per slot: { holdAt, fireAt, flinchAt }
let _roundResult = null;     // { winner, kind: 'shot'|'flinch'|'forfeit'|'void', ms }
let _fx = [];                // transient effects: { obj, t, life, update }
let _shake = 0;
let _flash = null;           // the one muzzle-flash light, built up front
let _flashT = 0;
let _camPos = null, _camLook = null;
let _t = 0;

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _score = [0, 0]; _round = 0; _voids = 0; _t = 0;
    _held = [0, 0]; _pointers = new Map(); _fx = []; _shake = 0;
    _figs = []; _roundResult = null;
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2: no id
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#e8c9a0;z-index:5;';
    mg.appendChild(_overlay);

    _stage = createStage(_overlay, { hold: 'side', fov: 34, background: 0xf0cfa0 });
    _buildHud();
    if (_stage.gl) {
        _set = STAGE_SETS.hub(_stage);
        _stage.camera.position.set(-6, 7, 22);
        _stage.camera.lookAt(0, 3, -6);
        _camPos = _stage.camera.position.clone();
        _camLook = new THREE.Vector3(0, 3, -6);
        for (let slot = 0; slot < 2; slot++) _figs.push(_buildFigure(slot));
        // Built now, at zero, and moved to whichever gun fires. Adding a light
        // mid-round changes the scene's light count, and three recompiles every
        // material's shader when that happens — a visible hitch on exactly the
        // frame the shot lands.
        _flash = new THREE.PointLight(0xffc16b, 0, 8);
        _stage.add(_flash);
    } else {
        _figs = [0, 1].map(slot => ({ slot, x: 0 }));
    }

    _stage.listen('pointerdown', _onDown);
    _stage.listen('pointerup', _onUp);
    _stage.listen('pointercancel', _onUp);
    _stage.onResize(() => _layoutHud());

    _enter('intro');
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _fx = []; _set = null; _hud = null; _flash = null;
    _pointers = new Map();
}

function _finish(winner) {
    if (_done) return;                           // R6
    _destroy();
    _onWin?.(winner);
}

// ── Figures ─────────────────────────────────────────────────────────────────
// Right-hand figure is P1, facing +x when walking away; left is P2.
const _dirOf = slot => (slot === 0 ? 1 : -1);

function _revolver(scale) {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x4b5058, roughness: 0.35, metalness: 0.85 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b3f1f, roughness: 0.7 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc99a3a, roughness: 0.35, metalness: 0.8 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.5, 10), steel);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.07, 0.3); g.add(barrel);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 12), steel);
    drum.rotation.x = Math.PI / 2; drum.position.set(0, 0.04, 0.05); g.add(drum);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.3), steel);
    frame.position.set(0, 0.06, 0.08); g.add(frame);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.12), wood);
    grip.position.set(0, -0.08, -0.07); grip.rotation.x = -0.45; g.add(grip);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), brass);
    bead.position.set(0, 0.13, 0.52); g.add(bead);
    g.scale.setScalar(scale);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // Where the muzzle is, in the gun's own frame, for the flash.
    g.userData.muzzle = new THREE.Vector3(0, 0.07, 0.58);
    return g;
}

function _buildFigure(slot) {
    const c = _stage.character(slot);
    // Bigger than life, like everything else a toy holds: at true scale the
    // revolver was a black splinter at the far end of the street.
    const gun = _revolver(1.45 * Math.max(0.8, c.rig.handR / 0.16));
    gun.position.set(0, 0.02, 0.06);
    c.rig.hold(1, gun);
    c.gun = gun;
    c.x = _dirOf(slot) * START_X;
    c.rig.root.position.set(c.x, 0, 0);
    c.anim.face(_dirOf(slot) * Math.PI / 2, true);    // backs to each other
    c.anim.turnRate = 14;
    c.anim.onStep = () => { if (_phase === 'walk') haptic([8]); };
    return c;
}

// ── HUD (inside the turned frame, so it reads the same way up as the scene) ─
function _el(tag, css, parent) {
    const e = document.createElement(tag);
    e.style.cssText = css;
    (parent || _hud.root).appendChild(e);
    return e;
}

function _name(slot) {
    const p = state.players[seatFor(slot)];
    return (p && p.name ? p.name : `P${slot + 1}`).toUpperCase();
}
function _cssColor(slot) {
    const c = state.players[seatFor(slot)]?.color ?? (slot === 0 ? 0xff3b3b : 0x3b8eff);
    return '#' + c.toString(16).padStart(6, '0');
}

function _buildHud() {
    const root = _stage.hud;
    root.classList.add('bfont');
    _hud = { root };
    const txt = 'color:#fff8e6;text-shadow:0 2px 0 #3b2716,0 0 14px rgba(0,0,0,.55);letter-spacing:2px;';
    // Score, top centre. P2 is on the left because P2 stands on the left.
    _hud.score = _el('div',
        'position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:14px;align-items:center;' +
        'padding:6px 16px;border-radius:14px;background:rgba(40,24,12,.72);border:2px solid rgba(255,220,160,.35);' +
        'font-size:20px;white-space:nowrap;' + txt);
    // countPop animates `transform`, so it goes on an inner span; the outer
    // box keeps the centring transform to itself.
    const bigBox = _el('div',
        'position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);font-size:64px;white-space:nowrap;' +
        'transition:opacity .15s;opacity:0;' + txt);
    _hud.bigBox = bigBox;
    _hud.big = _el('span', 'display:inline-block;', bigBox);
    _hud.sub = _el('div',
        'position:absolute;left:50%;top:40%;transform:translate(-50%,40px);font-size:22px;white-space:nowrap;opacity:0;' + txt);
    _hud.pace = _el('div',
        'position:absolute;left:50%;top:22%;transform:translateX(-50%);font-size:34px;opacity:0;' + txt);
    // One pad per player at the bottom of their own half: where the thumb
    // goes, whether it is down, and how long they have left to put it there.
    _hud.pads = [0, 1].map(slot => {
        const pad = _el('div',
            'position:absolute;bottom:12px;width:180px;height:70px;border-radius:18px;display:flex;flex-direction:column;' +
            'align-items:center;justify-content:center;gap:2px;border:3px solid;transition:background .12s, transform .12s;' + txt);
        pad.style.borderColor = _cssColor(slot);
        const n = _el('div', 'font-size:15px;opacity:.9;', pad);
        n.textContent = _name(slot) + (isBotSlot(slot) ? ' · BOT' : '');
        const l = _el('div', 'font-size:22px;white-space:nowrap;', pad);
        return { pad, label: l };
    });
    _layoutHud();
}

function _layoutHud() {
    if (!_hud || !_stage) return;
    const W = _stage.width;
    _hud.pads[0].pad.style.left = (W * 0.75 - 90) + 'px';
    _hud.pads[1].pad.style.left = (W * 0.25 - 90) + 'px';
}

function _renderHud() {
    if (!_hud) return;
    const stars = n => '★'.repeat(n) + '☆'.repeat(WIN_ROUNDS - n);
    _hud.score.innerHTML =
        `<span style="color:${_cssColor(1)}">${_name(1)}</span><span>${stars(_score[1])}</span>` +
        `<span style="opacity:.6">·</span>` +
        `<span>${stars(_score[0])}</span><span style="color:${_cssColor(0)}">${_name(0)}</span>`;
    [0, 1].forEach(slot => {
        const p = _hud.pads[slot];
        const down = _held[slot] > 0 || (isBotSlot(slot) && _botHolding(slot));
        p.pad.style.background = down ? 'rgba(255,220,150,.38)' : 'rgba(40,24,12,.55)';
        p.pad.style.transform = down ? 'scale(.95)' : 'scale(1)';
        let label;
        if (_phase === 'holster') {
            const left = Math.ceil(HOLSTER_WAIT - _phaseT);
            label = down ? 'READY' : (_phaseT > 2.5 ? `HOLD · ${left}` : 'HOLD HERE');
        } else if (_phase === 'walk') label = down ? 'STEADY…' : 'LET GO';
        else if (_phase === 'draw') label = down ? 'LET GO!' : '💥';
        else label = '';
        p.label.textContent = label;
    });
}

function _say(big, sub = '', ms = 0) {
    if (!_hud) return;
    _hud.big.textContent = big; _hud.bigBox.style.opacity = big ? '1' : '0';
    _hud.sub.textContent = sub; _hud.sub.style.opacity = sub ? '1' : '0';
    _hud.big.style.animation = 'none'; void _hud.big.offsetWidth;
    _hud.big.style.animation = big ? 'countPop .35s ease' : 'none';
    if (ms) _hud.clearAt = _t + ms / 1000; else _hud.clearAt = 0;
}

// The prompt strip: side-on games hide #mg-neutral (it sits on the short
// edges, sideways to both players), but keep its text current for anything
// that reads it — probes, the standings rail's mirror.
function _neutral(msg) {
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = msg;
}

// ── Input ───────────────────────────────────────────────────────────────────
function _slotAt(e) {
    const p = _stage.toLocal(e.clientX, e.clientY);
    return p.x >= _stage.width / 2 ? 0 : 1;          // right half is P1
}

function _onDown(e) {
    if (_done) return;
    e.preventDefault();
    const slot = _slotAt(e);
    if (isBotSlot(slot)) return;
    _pointers.set(e.pointerId, slot);
    _held[slot]++;
}

function _onUp(e) {
    if (_done || !_pointers.has(e.pointerId)) return;
    const slot = _pointers.get(e.pointerId);
    _pointers.delete(e.pointerId);
    _held[slot] = Math.max(0, _held[slot] - 1);
    if (_held[slot] === 0) _letGo(slot);
}

function _isHolding(slot) {
    return isBotSlot(slot) ? _botHolding(slot) : _held[slot] > 0;
}

// ── Bot (§5) ────────────────────────────────────────────────────────────────
// Holds promptly; lets go on the bell after a human-shaped reaction time, and
// can be fooled by a decoy. Reaction: ~540 ms at easy, ~260 ms at hard, with
// noise, so hard is beatable by a focused person and never frame-perfect.
function _botHolding(slot) {
    const b = _bot[slot];
    return !!b && b.holdAt <= _t && !b.gone;
}

function _botPlanRound() {
    _bot = [0, 1].map(slot => isBotSlot(slot) ? {
        holdAt: _t + 0.35 + Math.random() * 0.6,
        fireAt: Infinity, flinchAt: Infinity, gone: false,
    } : null);
}

function _botOnDecoy(slot) {
    const b = _bot[slot];
    if (!b || b.gone) return;
    // 22% at easy → 4% at hard.
    if (Math.random() < 0.28 - _botSkill * 0.28) b.flinchAt = _t + 0.14 + Math.random() * 0.18;
}

function _botOnBell(slot) {
    const b = _bot[slot];
    if (!b || b.gone) return;
    b.fireAt = _t + (0.66 - _botSkill * 0.47) + Math.random() * 0.13;
}

function _botStep() {
    [0, 1].forEach(slot => {
        const b = _bot[slot];
        if (!b || b.gone) return;
        if (_t >= b.flinchAt || _t >= b.fireAt) { b.gone = true; _letGo(slot); }
    });
}

// ── The round ───────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'intro') {
        _say('HIGH NOON', 'PERDITION · TEN TO FOUR');
        _neutral('HIGH NOON');
    } else if (phase === 'holster') {
        _round++;
        _released = [-1, -1];
        _roundResult = null;
        _pace = 0;
        _bellPace = BELL_MIN + Math.floor(Math.random() * (BELL_MAX - BELL_MIN + 1));
        // Decoys: one chance per pace before the bell, rising each round.
        const p = Math.min(0.55, 0.14 + 0.09 * (_round - 1));
        const kinds = ['crow', 'slam', 'weed'];
        _decoys = [];
        for (let k = 1; k < _bellPace; k++) {
            if (k >= 2 && Math.random() < p) _decoys.push({ pace: k, kind: kinds[Math.floor(Math.random() * kinds.length)] });
        }
        _botPlanRound();
        _figs.forEach(f => {
            f.x = _dirOf(f.slot) * START_X;
            if (f.rig) {
                f.rig.root.position.x = f.x;
                f.anim.face(_dirOf(f.slot) * Math.PI / 2, true);
                f.anim.play('ready', { restart: true });
            }
        });
        _say(`ROUND ${_round}`, 'BOTH HOLD YOUR SIDE', 1300);
        _neutral(`ROUND ${_round} — HOLD YOUR SIDE`);
    } else if (phase === 'walk') {
        _figs.forEach(f => f.anim?.play('walk', { rate: 1 / PACE_TIME, restart: true }));
        _neutral('STEADY…');
    } else if (phase === 'draw') {
        _bellAt = _t;
        _set?.ringBell();
        sfx('bell');
        _say('DRAW!', '', 900);
        _neutral('DRAW!');
        _figs.forEach(f => {
            if (!f.anim) return;
            f.anim.face(-_dirOf(f.slot) * Math.PI / 2);     // spin to face them
            f.anim.play('aim');
        });
        _shake = Math.max(_shake, 0.12);
        [0, 1].forEach(_botOnBell);
    } else if (phase === 'resolve') {
        if (_hud) _hud.pace.style.opacity = '0';
        _resolveRound();
    } else if (phase === 'finale') {
        const w = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;
        _figs.forEach(f => {
            if (!f.anim) return;
            if (w < 0) f.anim.play('idle');
            else if (f.slot === w) { f.anim.face(0); f.anim.play('victory'); }
            else if (f.anim.state !== 'fall') f.anim.play('defeat');
        });
        // Up and out of the way: the camera is pushing in on the winner's face.
        if (_hud) { _hud.bigBox.style.top = '17%'; _hud.sub.style.top = '17%'; }
        _say(w < 0 ? 'DEAD EVEN' : `${_name(w)} WINS`, w < 0 ? '' : 'THE TOWN IS YOURS');
        _neutral(w < 0 ? 'DRAW!' : `${_name(w)} WINS!`);
        sfx(w < 0 ? 'land_bad' : 'mg_win');
    }
}

// Somebody's thumb came off the screen.
function _letGo(slot) {
    if (_done) return;
    if (_phase === 'walk') {
        // Before the bell: a flinch. The round is the other player's.
        _roundResult = { winner: 1 - slot, kind: 'flinch', loser: slot };
        _enter('resolve');
    } else if (_phase === 'draw' && _released[slot] < 0) {
        _released[slot] = _t;
        if (_released[1 - slot] < 0) {
            _roundResult = { winner: slot, kind: 'shot', ms: Math.round((_t - _bellAt) * 1000) };
            _enter('resolve');
        }
    }
}

function _resolveRound() {
    const r = _roundResult;
    if (r.winner >= 0) _score[r.winner]++;
    // A room that has walked away from the phone should not sit through seven
    // empty rounds: two in a row and the match is settled on what was played.
    _voids = r.kind === 'void' ? _voids + 1 : 0;
    const W = _figs[r.winner] ?? null, L = r.loser !== undefined ? _figs[r.loser] : _figs[1 - r.winner];
    if (r.kind === 'shot') {
        _shoot(W, L);
        _say(`${_name(r.winner)}`, `FIRST · ${(r.ms / 1000).toFixed(3)} s`, 1700);
        _neutral(`${_name(r.winner)} FIRES FIRST — ${_score[1]}-${_score[0]}`);
    } else if (r.kind === 'flinch') {
        _misfire(L);
        _say(`${_name(r.loser)} FLINCHED`, 'THAT WAS NOT THE BELL', 1700);
        _neutral(`${_name(r.loser)} FLINCHED`);
        W?.anim?.play('idle');
        sfx('land_bad');
    } else if (r.kind === 'forfeit') {
        _say(`${_name(r.loser)} NEVER DREW`, 'HOLD YOUR SIDE TO PLAY', 1700);
        _neutral(`${_name(r.loser)} FORFEITS THE ROUND`);
        L?.anim?.play('defeat');
        sfx('land_bad');
    } else {
        _say('NOBODY FIRED', 'ROUND VOID', 1500);
        _neutral('ROUND VOID');
        _figs.forEach(f => f.anim?.play('idle'));
    }
}

// ── Effects ─────────────────────────────────────────────────────────────────
function _muzzleWorld(f) {
    const v = f.gun.userData.muzzle.clone();
    f.gun.localToWorld(v);
    return v;
}

function _addFx(obj, life, update) {
    if (!_stage?.gl) return;
    _stage.add(obj);
    _fx.push({ obj, t: 0, life, update });
}

function _smoke(at, n = 7, color = 0xeeeeee, spread = 0.35, rise = 1.2) {
    for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.14 + Math.random() * 0.1, 8, 6),
            new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.8, roughness: 1 }));
        m.position.copy(at);
        const v = new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * rise, (Math.random() - 0.5) * spread);
        _addFx(m, 1.1 + Math.random() * 0.5, (o, t, dt) => {
            o.position.addScaledVector(v, dt);
            o.scale.setScalar(1 + t * 2.2);
            o.material.opacity = Math.max(0, 0.8 * (1 - t / 1.4));
        });
    }
}

function _shoot(W, L) {
    sfx('gunshot');
    haptic([60]);
    _shake = 0.45;
    if (!W?.rig) return;
    W.anim.fire();
    const at = _muzzleWorld(W);
    if (_flash) { _flash.position.copy(at); _flashT = 0.12; }
    const burst = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 1 }));
    burst.position.copy(at);
    _addFx(burst, 0.14, (o, t) => { o.scale.setScalar(1 + t * 10); o.material.opacity = 1 - t / 0.14; });
    _smoke(at, 6, 0xf2f2f2, 0.5, 0.9);
    // The loser is hit: a pop of stars over them, and down they go.
    if (L?.rig) {
        L.anim.play('hit', { restart: true });
        const head = L.rig.root.position.clone().add(new THREE.Vector3(0, L.rig.H * 1.1, 0));
        for (let i = 0; i < 6; i++) {
            const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0),
                new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true }));
            s.position.copy(head);
            const a = i / 6 * Math.PI * 2;
            _addFx(s, 1.0, (o, t) => {
                o.position.set(head.x + Math.cos(a + t * 5) * 0.6, head.y + t * 0.5, head.z + Math.sin(a + t * 5) * 0.6);
                o.rotation.y += 0.2;
                o.material.opacity = 1 - t;
            });
        }
    }
}

function _misfire(L) {
    sfx('gunshot');
    _shake = 0.2;
    if (!L?.rig) return;
    L.anim.flinch();
    L.anim.play('defeat');
    const feet = L.rig.root.position.clone().add(new THREE.Vector3(_dirOf(L.slot) * 0.5, 0.1, 0.3));
    _smoke(feet, 9, 0xc9a67a, 1.2, 1.4);         // the dirt it hit
}

function _decoy(kind) {
    if (kind === 'crow') { _set?.startleCrow(); sfx('caw'); _say('', 'CAW!', 600); }
    else if (kind === 'slam') { sfx('slam'); _say('', 'SLAM!', 600); _shake = Math.max(_shake, 0.08); }
    else { _set?.rollTumbleweed(Math.random() < 0.5 ? 1 : -1); }
    [0, 1].forEach(_botOnDecoy);
}

// ── Camera ──────────────────────────────────────────────────────────────────
// Directs the round: a sweep in from over the rooftops, a tight two-shot of
// the backs, a pull out as they pace, a punch in on the bell, and a push on
// the winner at the end.
function _camera(dt) {
    if (!_stage?.gl) return;
    const cam = _stage.camera;
    const aspect = _stage.width / Math.max(1, _stage.height);
    const tanH = Math.tan(cam.fov * Math.PI / 360) * aspect;
    const spread = Math.max(...(_figs.map(f => Math.abs(f.rig ? f.rig.root.position.x : 0))), 0.6);
    let pos, look, rate = 2.4;
    if (_phase === 'intro') {
        const k = Math.min(1, _phaseT / 1.8);
        const e = k * k * (3 - 2 * k);
        pos = new THREE.Vector3(-6 + e * 6, 7 - e * 4.8, 22 - e * 14);
        look = new THREE.Vector3(0, 3 - e * 1.9, -6 + e * 6);
        rate = 12;
    } else if (_phase === 'finale') {
        const w = _score[0] > _score[1] ? _figs[0] : _score[1] > _score[0] ? _figs[1] : null;
        const x = w?.rig ? w.rig.root.position.x : 0;
        pos = new THREE.Vector3(x * 0.8, 1.9, 6.2);
        look = new THREE.Vector3(x, 1.0, 0);
        rate = 2.2;
    } else {
        const need = (spread + 2.4) / tanH;
        const d = Math.max(7.5, need);
        pos = new THREE.Vector3(0, 1.6 + d * 0.09, d);
        look = new THREE.Vector3(0, 1.1, 0);
        if (_phase === 'draw' && _phaseT < 0.35) pos.z -= 1.4 * (1 - _phaseT / 0.35);   // the punch
    }
    const k = 1 - Math.exp(-rate * dt);
    _camPos.lerp(pos, k);
    _camLook.lerp(look, k);
    cam.position.copy(_camPos);
    if (_shake > 0) {
        cam.position.x += (Math.random() - 0.5) * _shake;
        cam.position.y += (Math.random() - 0.5) * _shake;
        _shake = Math.max(0, _shake - dt * 1.6);
    }
    cam.lookAt(_camLook);
}

// ── The loop ────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt;
    _phaseT += dt;
    if (_hud?.clearAt && _t > _hud.clearAt) { _say(''); }

    _botStep();

    switch (_phase) {
    case 'intro':
        if (_phaseT > 2.0) _enter('holster');
        break;

    case 'holster': {
        const h0 = _isHolding(0), h1 = _isHolding(1);
        if (h0 && h1 && _phaseT > 0.6) { _enter('walk'); break; }
        if (_phaseT > HOLSTER_WAIT) {
            // Someone never put a thumb down. If neither did, the round is void.
            if (!h0 && !h1) _roundResult = { winner: -1, kind: 'void' };
            else _roundResult = { winner: h0 ? 0 : 1, kind: 'forfeit', loser: h0 ? 1 : 0 };
            _enter('resolve');
        }
        break;
    }

    case 'walk': {
        const paces = _phaseT / PACE_TIME;
        const whole = Math.floor(paces);
        if (whole > _pace) {
            _pace = whole;
            if (_hud) { _hud.pace.textContent = `PACE ${_pace}`; _hud.pace.style.opacity = '1'; }
            const d = _decoys.find(x => x.pace === _pace);
            if (d) _decoy(d.kind);
            if (_pace >= _bellPace) { _enter('draw'); break; }
        }
        _figs.forEach(f => {
            f.x = _dirOf(f.slot) * (START_X + Math.min(paces, _bellPace) * PACE_LEN);
            if (f.rig) f.rig.root.position.x = f.x;
        });
        break;
    }

    case 'draw':
        if (_phaseT > DRAW_WAIT) { _roundResult = { winner: -1, kind: 'void' }; _enter('resolve'); }
        break;

    case 'resolve':
        if (_phaseT > RESOLVE_TIME) {
            if (_score[0] >= WIN_ROUNDS || _score[1] >= WIN_ROUNDS || _round >= MAX_ROUNDS || _voids >= MAX_VOIDS) _enter('finale');
            else _enter('holster');
        }
        break;

    case 'finale':
        if (_figs[0]?.gun && _figs[1]?.gun) {
            // The winner twirls the revolver.
            const w = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;
            if (w >= 0) _figs[w].gun.rotation.x = -_phaseT * 14;
        }
        if (_phaseT > FINALE_TIME) {
            _finish(_score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1);
            return;
        }
        break;
    }

    // Effects.
    if (_flash) {
        _flashT = Math.max(0, _flashT - dt);
        _flash.intensity = 6 * (_flashT / 0.12);
    }
    for (let i = _fx.length - 1; i >= 0; i--) {
        const f = _fx[i];
        f.t += dt;
        f.update?.(f.obj, f.t, dt);
        if (f.t >= f.life) {
            _stage?.scene?.remove(f.obj);
            f.obj.geometry?.dispose(); f.obj.material?.dispose();
            _fx.splice(i, 1);
        }
    }
    _set?.update(dt, _t);
    _camera(dt);
    _renderHud();
}

// For probes: what the game thinks is happening, without reaching into the scene.
export function _debugState() {
    return { phase: _phase, round: _round, score: _score.slice(), pace: _pace, bellPace: _bellPace,
             held: _held.slice(), gl: !!_stage?.gl, turned: !!_stage?.turned, done: _done,
             last: _roundResult ? { ..._roundResult } : null,
             quality: _stage?.quality ? { ..._stage.quality } : null };
}
