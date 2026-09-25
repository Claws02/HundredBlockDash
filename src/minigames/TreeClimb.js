// ============================================================
// TREE CLIMB — a trunk each, one race, and a coin for every branch.
// (3D rebuild of the 2D original, kept in archived/TreeClimb.js.)
//
// Face-off hold, SPLIT SCREEN: each half is a side-on camera riding up that
// player's own trunk. Played across phones (solo) the one trunk fills the
// screen.
//
// A leaf sprouts on the LEFT or the RIGHT of your trunk. Tap that side of your
// half and you jump up onto it; only then does the next one grow. Sides are
// random (never three alike in a row), so it is a read, not a rhythm.
// Grab the wrong side and you fall to the last branch on THAT side — the
// branches above survive, so you climb the same ladder back.
//
// COIN GAME (R6b): every new branch banks a coin, and a fall never takes one
// back. 30 seconds; highest when the clock runs out takes the round.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, effects } from '../engine/StageKit.js';
import * as Solo from './SoloArena.js';

// ── Rules (unchanged from the 2D game) ───────────────────────────────────────
const MATCH_TIME = 30;
const COIN_PER = 1, MAX_PAYOUT = 30;
const RISE_TIME = 0.20, FALL_PER = 0.16, RECOVER = 0.17;
// ── The tree ─────────────────────────────────────────────────────────────────
const SP = 1.15;                         // world units between branches
const TRUNK_X = [-3.6, 3.6];             // P1's tree, P2's tree
const PERCH = 0.95;                      // how far out on its branch a climber stands
const TREE_H = 90 * SP;
const READY_TIME = 1.4;
const FIG_SCALE = 0.62;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _dir = null, _hud = null, _fx = null;
let _n = 2, _p = [], _cams = [], _botDelay = [];
let _mats = null, _geo = null;
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0;

// ── The ladder ───────────────────────────────────────────────────────────────
// `branches[i]` is the side of the i-th branch from the ground, and there is
// always exactly one more branch than you have climbed: `branches[height]` is
// the leaf you are reading now.
function _newClimber(slot) {
    const c = { slot, height: 0, best: 0, branches: [], meshes: [], perch: 0, anim: null, hold: 0,
                coins: 0, falls: 0, shake: 0 };
    _grow(c);
    return c;
}
// Genuinely random, never a third of the same side in a row. Drawn by BRANCH
// index from the shared seed when solo, so every phone climbs the same tree.
function _nextSide(c) {
    const r = Solo.isSolo() ? Solo.draw(c.branches.length) : Math.random();
    let s = r < 0.5 ? -1 : 1;
    const n = c.branches.length;
    if (n >= 2 && c.branches[n - 1] === c.branches[n - 2] && s === c.branches[n - 1]) s = -s;
    return s;
}
const _pending = c => c.branches[c.height];

function _grow(c) {
    const side = _nextSide(c);
    c.branches.push(side);
    if (!_stage?.gl) return;
    const i = c.branches.length - 1;
    const g = new THREE.Group();
    const stick = new THREE.Mesh(_geo.stick, _mats.bark);
    stick.rotation.z = Math.PI / 2 - side * 0.25; stick.position.set(side * 0.55, -0.12, 0); g.add(stick);
    const pad = new THREE.Mesh(_geo.pad, _mats.leaf.clone());
    pad.scale.set(1, 0.32, 0.8); pad.position.set(side * PERCH, 0.02, 0); g.add(pad);
    [-1, 1].forEach(k => {
        const tuft = new THREE.Mesh(_geo.tuft, pad.material);
        tuft.position.set(side * (PERCH + 0.3), 0.15, k * 0.28); g.add(tuft);
    });
    g.position.set(_trunkX(c), (i + 1) * SP, 0);
    g.scale.setScalar(0.01);
    _stage.add(g);
    c.meshes.push({ g, mat: pad.material, born: _t });
}
const _trunkX = c => (_n === 1 ? 0 : TRUNK_X[c.slot]);

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0;
    _n = Solo.isSolo() ? 1 : 2;
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#bfe3ff;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 50, background: 0xbfe3ff });
    _hud = faceoffHud(_stage, { bg: 'rgba(20,40,20,.78)' });
    if (_n === 1) {
        // Alone on the phone: no far half. The near half's strip takes the screen.
        const [near, far] = _stage.hud.children;
        if (far) far.style.display = 'none';
        if (near) near.style.height = '100%';
    }
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _mats = {
            bark: new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.95 }),
            leaf: new THREE.MeshStandardMaterial({ color: 0x3f9b3a, roughness: 0.8, emissive: 0x7dff5a, emissiveIntensity: 0 }),
            coin: new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xb07a00, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 }),
        };
        _geo = { stick: new THREE.CylinderGeometry(0.07, 0.12, 1.2, 6), pad: new THREE.SphereGeometry(0.5, 10, 8), tuft: new THREE.SphereGeometry(0.26, 8, 6) };
        _buildWood();
        _cams = Array.from({ length: _n }, (_, slot) => {
            const c = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
            c.up.set(0, slot === 0 ? 1 : -1, 0);  // the far half reads from its own end
            return c;
        });
    }
    _p = Array.from({ length: _n }, (_, slot) => _newClimber(slot));
    _p.forEach(_buildFig);
    _botDelay = _p.map(() => _botReact());
    for (let s = 0; s < _n; s++) _hud.hint(s, seat(s).bot ? '' : 'TAP THE SIDE THE LEAF GREW');

    // Taps: which half (whose tree), then which side of it, as that player sees it.
    _stage.listen('pointerdown', e => {
        e.preventDefault();
        if (_phase !== 'climb') return;
        const p = _stage.toLocal(e.clientX, e.clientY);
        const right = p.x >= _stage.width / 2;
        if (_n === 1) { _tap(0, right ? 1 : -1); return; }
        const slot = p.y >= _stage.height / 2 ? 0 : 1;
        if (isBotSlot(slot)) return;
        // The far half is rolled 180°: P2's right is the stage's left.
        _tap(slot, (right ? 1 : -1) * (slot === 0 ? 1 : -1));
    });

    const mid = 0;
    _dir.open({
        place: 'THE FAE WILDS · THE BIG OAKS', title: 'TREE CLIMB',
        sub: `🪙 A COIN A BRANCH · ${MATCH_TIME} SECONDS`,
        from: { pos: [mid + 2, 3, 16], look: [mid, 6, 0] },
        to: { pos: [mid, 2, 9], look: [mid, 1.5, 0] },
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.views = null; _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _cams = []; _dir = null; _hud = null; _fx = null; _mats = null; _geo = null;
}

// ── The wood ─────────────────────────────────────────────────────────────────
function _buildWood() {
    const scene = _stage.scene;
    scene.fog = new THREE.Fog(0xbfe3ff, 12, 48);
    scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x4a6b2a, 0.85));
    const sun = new THREE.DirectionalLight(0xfff2d6, 0.7); sun.position.set(4, 20, 10); scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshStandardMaterial({ color: 0x5fae45, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; _stage.add(ground);
    const xs = _n === 1 ? [0] : TRUNK_X;
    xs.forEach(x => {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.46, TREE_H, 12), _mats.bark);
        trunk.position.set(x, TREE_H / 2, 0); _stage.add(trunk);
        // Roots, and a sign every ten branches so height reads at a glance.
        for (let k = 0; k < 5; k++) {
            const r = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.4, 5), _mats.bark);
            const a = k / 5 * Math.PI * 2;
            r.position.set(x + Math.cos(a) * 0.45, 0.2, Math.sin(a) * 0.45); r.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2); _stage.add(r);
        }
        for (let m = 10; m <= 80; m += 10) {
            const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
            const g = cv.getContext('2d');
            g.fillStyle = '#c8955a'; g.fillRect(0, 0, 64, 32); g.strokeStyle = '#5a3a1a'; g.lineWidth = 3; g.strokeRect(1, 1, 62, 30);
            g.fillStyle = '#3a220c'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(m), 32, 17);
            const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
            sign.position.set(x, (m + 0.5) * SP, 0.42); _stage.add(sign);
        }
    });
    // A wood behind, and a canopy that the tops disappear into.
    const leafM = new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 0.9 });
    for (let k = 0; k < 26; k++) {
        const x = -26 + k * 2.1 + Math.random(), z = -14 - Math.random() * 16, h = 8 + Math.random() * 10;
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, h, 7), _mats.bark); t.position.set(x, h / 2, z); _stage.add(t);
        const c = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random() * 1.5, 9, 7), leafM); c.position.set(x, h, z); _stage.add(c);
    }
}

function _buildFig(c) {
    if (!_stage.gl) return;
    const ch = _stage.character(c.slot);
    ch.rig.root.scale.setScalar(FIG_SCALE);
    ch.anim.play('ready');
    // `c.anim` is the jump in progress; the character's animator is `c.ctl`.
    Object.assign(c, { rig: ch.rig, ctl: ch.anim });
    // The coin that waits above the next NEW branch.
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16), _mats.coin);
    coin.rotation.x = Math.PI / 2; _stage.add(coin);
    c.coin = coin;
}

// ── Play ─────────────────────────────────────────────────────────────────────
function _tap(slot, side) {
    const c = _p[slot];
    if (!c || c.anim || c.hold > 0 || _phase !== 'climb') return;
    if (side === _pending(c)) {
        c.anim = { kind: 'rise', from: c.height, to: c.height + 1, fromX: c.perch, toX: side, t: 0, dur: RISE_TIME };
        sfx('seq_lit');
        if (!isBotSlot(slot)) haptic([12]);
        return;
    }
    // Wrong side: down to the last branch placed on THAT side, or the ground.
    let to = 0;
    for (let i = c.height - 2; i >= 0; i--) if (c.branches[i] === side) { to = i + 1; break; }
    c.falls++;
    c.shake = 0.35;
    c.anim = { kind: 'fall', from: c.height, to, fromX: c.perch, toX: to > 0 ? c.branches[to - 1] : 0, t: 0,
               dur: Math.max(0.18, (c.height - to) * FALL_PER) };
    sfx('land_bad');
    if (!isBotSlot(slot)) haptic([26, 40, 26]);
}

function _land(c) {
    const a = c.anim;
    c.anim = null;
    c.height = a.to;
    c.perch = a.toX;
    if (a.kind === 'fall') { c.hold = RECOVER; return; }       // coins already banked
    if (c.height > c.best) {
        c.best = c.height;
        c.coins = Math.min(MAX_PAYOUT, c.best * COIN_PER);
        sfx('coin_gain');
        if (_stage?.gl) _fx.burst(new THREE.Vector3(_trunkX(c) + c.perch * PERCH, c.height * SP + 1.1, 0.2), 0xffd23f, 0.1, 0.22);
    }
    if (c.branches.length <= c.height) _grow(c);
}

const _botReact = () => 0.62 - _botSkill * 0.40 + Math.random() * 0.16;
function _botStep(c, dt) {
    if (c.anim || c.hold > 0) return;
    _botDelay[c.slot] -= dt;
    if (_botDelay[c.slot] > 0) return;
    _botDelay[c.slot] = _botReact();
    const want = _pending(c);
    _tap(c.slot, Math.random() < 0.20 - _botSkill * 0.18 ? -want : want);
}

function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') {
        if (_stage?.gl) _stage.views = _cams.map((cam, slot) => ({ camera: cam, rect: _n === 1 ? [0, 0, 1, 1] : slot === 0 ? [0, 0, 1, 0.5] : [0, 0.5, 1, 0.5] }));
        _hud.say('READY…', '', 1200, _t, '#facc15'); sfx('countdown');
    } else if (phase === 'climb') { _hud.say('CLIMB!', '', 700, _t, '#4ade80'); sfx('go'); haptic([40]); }
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready' && _phaseT >= READY_TIME) _enter('climb');
    if (_phase === 'climb') {
        _clock += dt;
        _p.forEach(c => {
            c.hold = Math.max(0, c.hold - dt);
            if (c.anim) { c.anim.t += dt / c.anim.dur; if (c.anim.t >= 1) _land(c); }
            if (isBotSlot(c.slot) && _n > 1) _botStep(c, dt);
        });
        if (_clock >= MATCH_TIME) _end();
    }
    _p.forEach(c => _draw(c, dt));
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    _renderHud();
}

const _ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

function _draw(c, dt) {
    if (!c.rig) return;
    c.shake = Math.max(0, c.shake - dt);
    const a = c.anim, t = a ? Math.min(1, a.t) : 0;
    const p = a ? (a.kind === 'fall' ? t * t : _ease(t)) : 0;
    const climbed = a ? a.from + (a.to - a.from) * p : c.height;
    const fx = a ? a.fromX + (a.toX - a.fromX) * _ease(t) : c.perch;
    const hop = a && a.kind === 'rise' ? Math.sin(t * Math.PI) * 0.45 : 0;
    const x0 = _trunkX(c);
    const y = climbed * SP + hop + (climbed > 0 ? 0.12 : 0);
    c.rig.root.position.set(x0 + fx * PERCH + (c.shake ? Math.sin(_t * 60) * 0.06 : 0), y, 0.05);
    c.rig.root.rotation.z = a && a.kind === 'fall' ? t * 5.2 : 0;
    c.rig.root.rotation.y = fx * 0.5;
    const want = _phase === 'over' ? (c.slot === _winnerSlot() ? 'victory' : 'ready')
        : a && a.kind === 'fall' ? 'hit' : c.hold > 0 ? 'hit' : 'ready';
    if (c.pose !== want && _phase !== 'over') { c.pose = want; c.ctl.play(want); }
    // Leaves: sprout in, and the one to read now glows.
    c.meshes.forEach((m, i) => {
        m.g.scale.setScalar(Math.min(1, 0.01 + (_t - m.born) * 6));
        const live = i === c.height && !(a && a.kind === 'fall');
        m.mat.emissiveIntensity = live ? 0.35 + Math.sin(_t * 9) * 0.2 : 0;
        m.mat.color.setHex(live ? 0x7dff5a : i < c.height ? 0x2e6b2a : 0x3f9b3a);
    });
    // The coin sits over the next branch while that branch is a new best.
    if (c.coin) {
        const nb = c.height + 1, side = c.branches[c.height];
        c.coin.visible = nb > c.best && _phase !== 'over';
        c.coin.position.set(x0 + side * PERCH, nb * SP + 0.75 + Math.sin(_t * 4) * 0.06, 0);
        c.coin.rotation.z = _t * 3;
    }
    const cam = _cams[c.slot];
    if (cam) {
        // The climber a little below the middle, the next two leaves above.
        const want = new THREE.Vector3(x0, climbed * SP + 0.6, _n === 1 ? 9.5 : 7.5);
        if (!cam.userData.init) { cam.position.copy(want); cam.userData.init = true; }
        cam.position.lerp(want, Math.min(1, dt * 7));
        cam.lookAt(x0, cam.position.y + 0.4, 0);
    }
}

function _winnerSlot() {
    if (_p.length < 2) return 0;
    return _p[0].height > _p[1].height ? 0 : _p[1].height > _p[0].height ? 1 : -1;
}

function _renderHud() {
    if (!_hud) return;
    const left = Math.max(0, Math.ceil(MATCH_TIME - _clock));
    _p.forEach(c => {
        _hud.line(c.slot, `🌳 ${c.height} · 🪙 ${c.coins} · ⏱ ${left}s`);
        if (_clock > 5 || c.falls) _hud.hint(c.slot, c.hold > 0 || (c.anim && c.anim.kind === 'fall') ? 'WRONG SIDE!' : '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'climb') el.textContent = _n === 1 ? `${_p[0].height} BRANCHES · ⏱ ${left}s` : `${seat(0).name} ${_p[0].height} – ${_p[1].height} ${seat(1).name} · ⏱ ${left}s`;
}

// ── End ──────────────────────────────────────────────────────────────────────
/** Banked coins: the payday number the host pays out (MG_PAYOUT). */
export function soloScore() { return _p[0] ? Math.min(_p[0].coins, MAX_PAYOUT) : 0; }

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    _p.forEach(c => { if (c.anim) _land(c); });
    // Read NOW: _destroy() clears everything before the callback runs.
    const payouts = _p.map(c => Math.min(c.coins, MAX_PAYOUT));
    const standings = _p.map(c => c.height);
    const el = document.getElementById('mg-neutral');
    if (_n === 1) {
        if (el) el.textContent = `${_p[0].best} BRANCHES — ${_p[0].coins} 🪙 BANKED`;
        _hud.say('TIME!', `${_p[0].coins} 🪙 BANKED`, 0, _t, '#facc15');
        sfx('mg_win'); haptic('heavy');
        const banked = soloScore();
        setTimeout(() => { if (_done) return; _destroy(); Solo.soloFinish(banked); }, 1400);
        return;
    }
    const w = _winnerSlot();
    if (_stage) _stage.views = null;               // the director's shots are full-frame
    _dir.close({
        winner: w, figs: _p.filter(c => c.rig).map(c => ({ slot: c.slot, rig: c.rig, anim: c.ctl })),
        sub: w < 0 ? `LEVEL AT ${standings[0]} BRANCHES` : `${standings[w]} BRANCHES TO ${standings[1 - w]}`,
        closeUp: (f, p) => ({ pos: [p.x, p.y + 1.2, p.z + 5.5], look: [p.x, p.y + 0.7, p.z] }),
        onDone: () => { if (_done) return; _destroy(); _onWin?.(w, payouts, standings); },
    });
    if (el) el.textContent = w < 0 ? `TIME! DEAD HEAT — ${standings.join('–')}` : `TIME! ${seat(w).name} CLIMBED HIGHEST — ${standings.join('–')}`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, clock: +_clock.toFixed(2), n: _n,
             climbers: _p.map(c => ({ height: c.height, best: c.best, coins: c.coins, falls: c.falls, pending: _pending(c),
                                      branches: c.branches.slice(), busy: !!c.anim || c.hold > 0 })),
             views: _stage?.views ? _stage.views.length : 0, gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: stop (or restart) the clock, so a slow renderer cannot run it out mid-test. */
export function _debugClock(s) { _clock = s; }
