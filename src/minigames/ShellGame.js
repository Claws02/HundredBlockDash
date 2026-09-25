// ============================================================
// SHELL GAME — three cups, one pea, and Madame Fortuna's quick hands.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Face-off hold, one table between you, seen from above.
//
//   WATCH: a cup lifts to show the pea, drops, and the cups shuffle.
//   PICK: tap LEFT, MIDDLE or RIGHT on your half — as YOU see the table from
//   your end. Your pick is secret until you have both locked in.
//
// Five rounds, each shuffle longer and quicker than the last. A right pick
// scores a point; most points wins, and a tie goes to a sudden-death shuffle.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, effects, overheadCam } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const CUP_X = [-1.7, 0, 1.7];            // the three positions, P1's left to right
const ROUNDS = 5, SUDDEN_MAX = 2;
// Per round: swaps, and seconds per swap.
const PLAN = r => ({ swaps: 4 + r * 2, dur: Math.max(0.22, 0.58 - r * 0.08) });
const SHOW = 1.4, PICK_TIME = 5, REVEAL = 1.7;
const FIG_SCALE = 1.05;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _dir = null, _hud = null, _fx = null;
let _cups = [], _pea = null, _figs = [], _pads = [], _rings = [];
let _score = [0, 0], _round = 0, _phase = 'intro', _sub = '', _subT = 0, _t = 0;
let _under = 0, _swaps = [], _swapI = 0, _plan = null, _picks = [null, null], _bot = [null, null], _frozen = false;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _score = [0, 0]; _round = 0; _phase = 'intro'; _sub = ''; _subT = 0; _t = 0; _picks = [null, null]; _frozen = false;
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#1d1030;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 38, background: 0x1d1030 });
    _hud = faceoffHud(_stage, { bg: 'rgba(40,14,50,.8)' });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _stage.camera.up.set(0, 0, -1);          // P1's end at the bottom of the phone
        _buildBooth();
    }
    _cups = CUP_X.map((x, i) => _buildCup(i));
    _figs = [0, 1].map(_buildFig);
    _buildPads();
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'WATCH THE CUP WITH THE PEA'));

    _dir.open({
        place: "THE MIDWAY · MADAME FORTUNA'S BOOTH", title: 'SHELL GAME',
        sub: 'KEEP YOUR EYE ON THE PEA',
        from: { pos: [5, 3.5, 5], look: [0, 0.6, 0] },
        to: overheadCam(_stage, 6, 6.5, 2.5, 0.1),
        onDone: () => { if (!_done) { _phase = 'play'; _nextRound(); } },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _cups = []; _pea = null; _figs = []; _pads = []; _rings = []; _dir = null; _hud = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── The booth ────────────────────────────────────────────────────────────────
function _buildBooth() {
    _stage.light({ sun: 0xffe6c4, sunI: 1.15, sky: 0xffd6f0, ground: 0x2a1030, hemiI: 0.6, dir: [2, 10, 4], span: 6 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); _stage.add(m); return m; };
    const planks = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
    const floor = add(new THREE.PlaneGeometry(30, 30), planks, 0, 0, 0); floor.rotation.x = -Math.PI / 2;
    // Velvet table with gold trim.
    add(new THREE.BoxGeometry(6.2, 0.8, 3.0), new THREE.MeshStandardMaterial({ color: 0x7a1030, roughness: 0.95 }), 0, 0.4, 0).receiveShadow = true;
    const top = add(new THREE.BoxGeometry(6.0, 0.04, 2.8), new THREE.MeshStandardMaterial({ color: 0x1f5c3a, roughness: 1 }), 0, 0.82, 0); top.receiveShadow = true;
    add(new THREE.BoxGeometry(6.3, 0.06, 3.1), new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.6, roughness: 0.3 }), 0, 0.79, 0);
    // A striped canopy's posts and a string of bulbs round the booth.
    const red = new THREE.MeshStandardMaterial({ color: 0xd62839 }), white = new THREE.MeshStandardMaterial({ color: 0xf5efe6 });
    [[-4, -3.5], [4, -3.5], [-4, 3.5], [4, 3.5]].forEach(([x, z]) => {
        for (let k = 0; k < 6; k++) add(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), k % 2 ? red : white, x, 0.25 + k * 0.5, z);
    });
    const bulbCols = [0xffd166, 0xff6b9a, 0x7dd3fc];
    for (let k = 0; k < 28; k++) {
        const a = k / 28 * Math.PI * 2;
        add(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: bulbCols[k % 3] }), Math.cos(a) * 4.8, 0.05, Math.sin(a) * 4.2);
    }
    _pea = add(new THREE.SphereGeometry(0.14, 14, 10), new THREE.MeshStandardMaterial({ color: 0x9be15d, roughness: 0.4 }), 0, 0.98, 0);
    _pea.castShadow = true;
}

function _buildCup(i) {
    const c = { x: CUP_X[i], z: 0, lift: 0, mesh: null };
    if (_stage.gl) {
        const g = new THREE.Group();
        const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.75, roughness: 0.28 });
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 0.85, 24, 1, true), brass);
        cup.material.side = THREE.DoubleSide; cup.position.y = 0.425; cup.castShadow = true; g.add(cup);
        const lid = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), brass); lid.rotation.x = -Math.PI / 2; lid.position.y = 0.85; g.add(lid);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), brass); knob.position.y = 0.92; g.add(knob);
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.03, 6, 24), new THREE.MeshStandardMaterial({ color: 0x7a1030 }));
        band.rotation.x = Math.PI / 2; band.position.y = 0.2; g.add(band);
        g.position.set(c.x, 0.84, 0);
        _stage.add(g); c.mesh = g;
    }
    return c;
}

function _buildFig(slot) {
    const f = { slot };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        c.rig.root.position.set(0, 0, (slot === 0 ? 1 : -1) * 2.4);
        c.anim.face(slot === 0 ? Math.PI : 0, true);
        c.anim.play('ready');
        Object.assign(f, { rig: c.rig, anim: c.anim });
        // The ring that shows, at the reveal, which cup this player picked.
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.7, 28), new THREE.MeshBasicMaterial({ color: seat(slot).color, transparent: true, opacity: 0.95, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.visible = false; _stage.add(ring);
        _rings[slot] = ring;
    }
    return f;
}

// ── The pick buttons: LEFT, MIDDLE, RIGHT as each player sees the table ─────
function _buildPads() {
    const root = _stage.hud;
    [0, 1].forEach(slot => {
        const half = document.createElement('div');
        half.style.cssText = 'position:absolute;left:0;right:0;height:50%;pointer-events:none;' + (slot === 0 ? 'bottom:0;' : 'top:0;transform:rotate(180deg);');
        const row = document.createElement('div');
        row.style.cssText = 'position:absolute;left:50%;bottom:112px;transform:translateX(-50%);display:flex;gap:12px;';
        const btns = ['LEFT', 'MIDDLE', 'RIGHT'].map((label, k) => {
            const b = document.createElement('button');
            b.className = 'bfont';
            b.dataset.slot = slot; b.dataset.k = k;
            b.style.cssText = `pointer-events:auto;width:92px;height:62px;border-radius:14px;border:3px solid ${seat(slot).css};` +
                'background:rgba(40,14,50,.85);color:#fff8ee;font-size:15px;letter-spacing:1.5px;opacity:.4;transition:opacity .15s, transform .15s;touch-action:none;';
            b.innerHTML = `🥤<br>${label}`;
            b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (!isBotSlot(slot)) _pick(slot, k); });
            row.appendChild(b);
            return b;
        });
        half.appendChild(row);
        root.appendChild(half);
        _pads[slot] = btns;
    });
}

/** A player's button k (0 = their left) → the position index on the table (0 = P1's left). */
const _posFor = (slot, k) => (slot === 0 ? k : 2 - k);

// ── Rounds ───────────────────────────────────────────────────────────────────
function _nextRound() {
    _round++;
    _plan = PLAN(Math.min(_round - 1, ROUNDS + 1));
    _picks = [null, null]; _bot = [null, null];
    _rings.forEach(r => { if (r) r.visible = false; });
    // Cups back in a row; the pea under a random one.
    const order = [0, 1, 2].sort(() => Math.random() - 0.5);
    _cups.forEach((c, i) => { c.x = CUP_X[order[i]]; c.z = 0; c.lift = 0; });
    _under = (Math.random() * 3) | 0;
    // The shuffle, planned now: pairs of CUP indices to swap.
    _swaps = Array.from({ length: _plan.swaps }, () => { const a = (Math.random() * 3) | 0; return [a, (a + 1 + ((Math.random() * 2) | 0)) % 3]; });
    _swapI = 0;
    _sub = 'show'; _subT = 0;
    const label = _round > ROUNDS ? 'SUDDEN DEATH' : `ROUND ${_round} OF ${ROUNDS}`;
    _hud.say(label, 'WATCH THE PEA', SHOW * 1000, _t, '#ffd166');
    _pads.forEach(p => p.forEach(b => { b.style.opacity = '.4'; b.style.transform = ''; }));
    sfx('countdown');
}

function _pick(slot, k) {
    if (_phase !== 'play' || _sub !== 'pick' || _picks[slot] != null) return;
    _picks[slot] = _posFor(slot, k);
    // Your own button lights; the rival only learns that you have locked in.
    _pads[slot].forEach((b, i) => { b.style.opacity = i === k ? '1' : '.25'; b.style.transform = i === k ? 'scale(1.08)' : ''; });
    _hud.hint(1 - slot, seat(1 - slot).bot ? '' : `${seat(slot).name} HAS PICKED`);
    sfx('tick');
    if (!isBotSlot(slot)) haptic([12]);
    if (_picks[0] != null && _picks[1] != null) _reveal();
}

function _reveal() {
    _sub = 'reveal'; _subT = 0;
    const at = _posIndex(_under);
    [0, 1].forEach(slot => {
        const right = _picks[slot] === at;
        if (right) _score[slot]++;
        const ring = _rings[slot];
        if (ring && _picks[slot] != null) { ring.visible = true; ring.position.set(CUP_X[_picks[slot]], 0.87 + slot * 0.005, 0); ring.scale.setScalar(slot === 0 ? 1 : 1.2); }
        _figs[slot].anim?.play(right ? 'raise' : 'hit', { restart: true });
    });
    const both = [0, 1].map(s => _picks[s] === at);
    sfx(both[0] || both[1] ? 'land_good' : 'land_bad');
    const txt = both[0] && both[1] ? 'BOTH RIGHT!' : both[0] ? `${seat(0).name} FOUND IT` : both[1] ? `${seat(1).name} FOUND IT` : 'NOBODY FOUND IT';
    _hud.say(txt, `${seat(0).name} ${_score[0]} – ${_score[1]} ${seat(1).name}`, REVEAL * 1000, _t, '#9be15d');
}

/** Which table position (0 = P1's left) the cup with index i stands at. */
function _posIndex(i) {
    const x = _cups[i].x;
    let best = 0;
    CUP_X.forEach((cx, k) => { if (Math.abs(cx - x) < Math.abs(CUP_X[best] - x)) best = k; });
    return best;
}

// ── Bot (§5): follows the pea, and loses it more often the faster it goes ───
function _botPlan(slot) {
    const speed = 1 - (_plan.dur - 0.22) / 0.36;          // 0 slow → 1 fastest
    const p = Math.max(0.3, Math.min(0.97, 0.55 + _botSkill * 0.45 - speed * (1 - _botSkill) * 0.6 - _plan.swaps * 0.01));
    const at = _posIndex(_under);
    const guess = Math.random() < p ? at : [0, 1, 2].filter(k => k !== at)[(Math.random() * 2) | 0];
    _bot[slot] = { k: slot === 0 ? guess : 2 - guess, at: 0.6 + Math.random() * 1.8 };
}

// ── The loop ─────────────────────────────────────────────────────────────────
const _ease = u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

function _frame(dt) {
    if (_done) return;
    _t += dt;
    if (!_frozen) _subT += dt;
    _hud.tick(_t);
    if (_phase === 'play') {
        if (_sub === 'show') {
            // Lift the pea's cup, hold, drop it.
            const u = _subT / SHOW;
            _cups[_under].lift = u < 0.2 ? u / 0.2 : u < 0.75 ? 1 : Math.max(0, 1 - (u - 0.75) / 0.2);
            if (_subT >= SHOW) { _cups[_under].lift = 0; _sub = 'shuffle'; _subT = 0; _startSwap(); }
        } else if (_sub === 'shuffle') {
            const s = _swaps[_swapI];
            const u = Math.min(1, _subT / _plan.dur), e = _ease(u);
            const [a, b] = s.pair;
            _cups[a].x = s.xa + (s.xb - s.xa) * e; _cups[a].z = Math.sin(u * Math.PI) * 0.75;
            _cups[b].x = s.xb + (s.xa - s.xb) * e; _cups[b].z = -Math.sin(u * Math.PI) * 0.75;
            if (u >= 1) {
                _cups[a].x = s.xb; _cups[b].x = s.xa; _cups[a].z = _cups[b].z = 0;
                _swapI++; _subT = 0;
                if (_swapI >= _swaps.length) {
                    _sub = 'pick';
                    _hud.say('PICK!', 'LEFT · MIDDLE · RIGHT — AS YOU SEE IT', 900, _t, '#ffd166');
                    [0, 1].forEach(slot => { _hud.hint(slot, seat(slot).bot ? '' : 'TAP THE CUP THE PEA IS UNDER'); if (isBotSlot(slot)) _botPlan(slot); });
                    _pads.forEach((p, slot) => p.forEach(b => { b.style.opacity = isBotSlot(slot) ? '.4' : '1'; }));
                } else _startSwap();
            }
        } else if (_sub === 'pick') {
            [0, 1].forEach(slot => { const b = _bot[slot]; if (b && _picks[slot] == null && _subT >= b.at) _pick(slot, b.k); });
            if (_subT >= PICK_TIME && _sub === 'pick') {
                [0, 1].forEach(slot => { if (_picks[slot] == null) _picks[slot] = -1; });
                _reveal();
            }
        } else if (_sub === 'reveal') {
            const u = _subT / REVEAL;
            _cups.forEach(c => { c.lift = u < 0.2 ? u / 0.2 : u < 0.8 ? 1 : Math.max(0, 1 - (u - 0.8) / 0.2); });
            if (_subT >= REVEAL) {
                _cups.forEach(c => { c.lift = 0; });
                const done = _round >= ROUNDS && (_score[0] !== _score[1] || _round >= ROUNDS + SUDDEN_MAX);
                if (done) _end(); else _nextRound();
            }
        }
    }
    _draw();
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    _renderHud();
}

function _startSwap() {
    const [a, b] = _swaps[_swapI];
    _swaps[_swapI] = { pair: [a, b], xa: _cups[a].x, xb: _cups[b].x };
    sfx('tick');
}

function _draw() {
    // A lifted cup also slides aside, so from above the pea is uncovered.
    _cups.forEach(c => { if (c.mesh) c.mesh.position.set(c.x, 0.84 + c.lift * 0.8, c.z + c.lift * 0.85); });
    if (_pea) {
        const c = _cups[_under];
        _pea.position.set(c.x, 0.98, c.z);
        _pea.visible = c.lift > 0.05 || _sub === 'reveal';
    }
}

function _renderHud() {
    if (!_hud) return;
    [0, 1].forEach(slot => _hud.line(slot, `🥤 ${_round > ROUNDS ? 'SUDDEN DEATH' : `ROUND ${Math.max(1, _round)}/${ROUNDS}`} · ${_score[slot]}–${_score[1 - slot]}` +
        (_sub === 'pick' && _picks[slot] == null ? ` · ${Math.max(0, Math.ceil(PICK_TIME - _subT))}s` : '')));
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `${seat(0).name} ${_score[0]} – ${_score[1]} ${seat(1).name}`;
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    _pads.forEach(p => p.forEach(b => { b.style.display = 'none'; }));
    const w = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? `${_score[0]} EACH` : `${_score[w]} TO ${_score[1 - w]}`,
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, sub: _sub, round: _round, score: [..._score], picks: [..._picks],
             answer: _cups.length ? _posIndex(_under) : -1, swaps: _plan ? _plan.swaps : 0, dur: _plan ? +_plan.dur.toFixed(2) : 0,
             swapI: _swapI, gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: stop the round's clock (the pick timer, the shuffle). */
export function _debugFreeze(on) { _frozen = !!on; }
/** Probes: where a player's button k is on screen, as a DOMRect. */
export function _debugPad(slot, k) { const b = _pads[slot]?.[k]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
