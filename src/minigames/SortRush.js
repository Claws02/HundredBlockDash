// ============================================================
// SORT RUSH — one shape, four buttons, first correct press takes the round.
//
// The old version was a solo score-attack duplicated across a divider: each
// player sorted their own private stream of shapes into their own two bins and
// the totals were compared at the end. Nothing either player did touched the
// other, which is the exact failure documented in docs/MINIGAME_BACKLOG.md.
//
// Now there is ONE shape, in the middle, that both players are looking at, and
// exactly one round win to take from it. That makes it a race with a decision in
// it — you have to recognise which of four shapes it is before you commit — and
// the button order is reshuffled every round so muscle memory can't do it for
// you. Getting it wrong locks you out long enough for your rival to answer.
//
// First to 3 rounds wins. Ceiling: MAX_ROUNDS rounds and a MATCH_TIME clock, so
// it always resolves well inside the 15–40 s window.
//
// LIVE at two, three or four. One shape in the middle is already the right
// shape for a crowd — everybody is looking at the same thing and exactly one
// of them gets to answer it — so going wide meant sizing the arrays to
// slotCount() and taking the zones from MinigameLayout instead of hard-coding
// two halves. The false-start rule is the one thing that had to change: at two
// it hands the round to the other player, which cannot mean anything at four,
// so above two it locks the jumper out of the round instead.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { zonesFor } from '../config/MinigameLayout.js';
import { registerMinigameCleanup, slotCount, isBotSlot, seatFor } from './MinigameManager.js';

// ── Tunables ────────────────────────────────────────────────────────────────
const WIN_ROUNDS   = 3;      // rounds needed to take the match
const MAX_ROUNDS    = 7;     // hard ceiling; settles on rounds won
const MATCH_TIME   = 46;     // s — safety ceiling, settles on rounds won
// Beat lengths are set by the FLOOR, not the ceiling: measured with the bot
// playing unopposed, a 3–0 sweep at the old 0.65/1.9/0.95 timings was over in
// 9 s — under the standard's 15 s floor, which robs a player who glanced away.
const SUSPENSE_MIN = 0.95;   // s before the shape appears
const SUSPENSE_MAX = 2.4;
const ROUND_LIMIT  = 4.5;    // s to answer before the round is scrubbed
const LOCKOUT      = 1.15;   // s a wrong press costs you
const GAP          = 1.3;    // s between rounds

// Four silhouettes that stay distinct at a glance and at arm's length. Shape is
// the signal and colour only reinforces it, so this reads for a colour-blind
// player too (§4).
const SHAPES = [
    { id: 'tri',  name: 'TRIANGLE', color: '#ff6b6b' },
    { id: 'circ', name: 'CIRCLE',   color: '#4ade80' },
    { id: 'sq',   name: 'SQUARE',   color: '#fbbf24' },
    { id: 'star', name: 'STAR',     color: '#a78bfa' },
];

// ── Module state (singleton — start() resets, _destroy() clears) ────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _stage = null, _stageShape = null, _stageLabel = null, _stageLabelTop = null;
let _n       = 2;            // how many are playing
let _halves  = [];
let _buttons = [];           // [pid][slot] → button element
let _pips    = [];           // round-win pip rows
let _wins    = [];
let _round   = 0;
let _target  = null;         // the shape being asked for this round
let _live    = false;        // true once the shape is up and answers count
let _lockedUntil = [];
let _out     = [];           // jumped this round: locked out of it
let _roundStart  = 0;
let _elapsed = 0, _last = 0, _af = null;
const _botTimers = new Set();
const _cleanups = [];
const _timers   = [];

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _n = Math.max(2, Math.min(4, slotCount()));
    _wins = new Array(_n).fill(0); _round = 0; _target = null; _live = false;
    _lockedUntil = new Array(_n).fill(0); _out = new Array(_n).fill(false);
    _roundStart = 0; _elapsed = 0; _last = 0;
    _botTimers.clear();
    registerMinigameCleanup(_destroy);   // R3 — force-end safety
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _af = requestAnimationFrame(_tick);
        _nextRound();
    }));
}

// ── DOM (R2 — built here, no ids, into #minigame-layer) ─────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;touch-action:none;' +
        'background:radial-gradient(ellipse at 50% 50%, #241c3d 0%, #120f22 72%);';

    const style = document.createElement('style');
    style.textContent = `
        .sr-half { position:absolute;display:flex;flex-direction:column;
                   align-items:center;justify-content:flex-end;gap:12px;padding:0 10px 16px; }
        .sr-half.sr-narrow { gap:7px;padding:0 6px 10px; }
        .sr-half.sr-narrow .sr-btn { max-width:52px;border-radius:12px; }
        .sr-half.sr-narrow .sr-pip { width:11px;height:11px; }
        .sr-row  { display:flex;gap:9px;width:100%;max-width:420px;justify-content:center; }
        .sr-btn  { flex:1 1 0;min-width:0;aspect-ratio:1/1;max-width:80px;
                   border-radius:16px;border:2px solid rgba(255,255,255,.16);
                   background:rgba(255,255,255,.05);display:flex;align-items:center;
                   justify-content:center;cursor:pointer;padding:0;
                   transition:transform .08s, background .12s, border-color .12s, opacity .18s; }
        .sr-btn:active { transform:scale(.93); }
        .sr-btn.sr-hit  { background:rgba(74,222,128,.28);border-color:#4ade80; }
        .sr-btn.sr-miss { background:rgba(239,68,68,.28);border-color:#ef4444; }
        .sr-half.sr-locked .sr-btn { opacity:.26; }
        .sr-pips { display:flex;gap:7px;align-items:center; }
        .sr-pip  { width:15px;height:15px;border-radius:50%;
                   border:2px solid rgba(255,255,255,.28);transition:background .2s,box-shadow .2s; }
        .sr-stage { position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
                    display:flex;flex-direction:column;align-items:center;gap:8px;
                    pointer-events:none;z-index:12; }
        .sr-shape { transition:transform .12s ease, opacity .14s ease;height:96px; }
        .sr-label { font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:4px;
                    color:rgba(255,255,255,.42);text-align:center; }
    `;
    _overlay.appendChild(style);

    // The shared shape, dead centre, equidistant from both players.
    _stage = document.createElement('div');
    _stage.className = 'sr-stage';
    _stageShape = document.createElement('div');
    _stageShape.className = 'sr-shape';
    // Two labels, one per player, so the shape's NAME is readable from both
    // ends — the silhouette carries the game, but the word confirms it.
    _stageLabelTop = document.createElement('div');
    _stageLabelTop.className = 'sr-label';
    _stageLabelTop.style.transform = 'rotate(180deg)';
    _stageLabel = document.createElement('div');
    _stageLabel.className = 'sr-label';
    _stage.appendChild(_stageLabelTop);
    _stage.appendChild(_stageShape);
    _stage.appendChild(_stageLabel);
    _overlay.appendChild(_stage);

    _buttons = []; _halves = []; _pips = [];
    // The zones come from MinigameLayout, so this is the shipped face-off at
    // two and corners at four without the game knowing the difference.
    const zones = zonesFor(_n, _overlay.clientWidth || window.innerWidth,
                               _overlay.clientHeight || window.innerHeight);
    for (let pid = 0; pid < _n; pid++) {
        const z = zones[pid];
        const half = document.createElement('div');
        half.className = 'sr-half';
        // R5 — mechanically identical zones; the far ones are turned to face
        // the player sitting at that edge.
        half.style.cssText +=
            `left:${z.rect.x}px;top:${z.rect.y}px;width:${z.rect.w}px;height:${z.rect.h}px;` +
            `right:auto;bottom:auto;` +
            (z.rot === 180 ? 'transform:rotate(180deg);' : '');
        _halves[pid] = half;

        const pips = document.createElement('div');
        pips.className = 'sr-pips';
        for (let i = 0; i < WIN_ROUNDS; i++) {
            const pip = document.createElement('div');
            pip.className = 'sr-pip';
            pips.appendChild(pip);
        }
        _pips[pid] = pips;

        const row = document.createElement('div');
        row.className = 'sr-row';
        const btns = [];
        _buttons[pid] = btns;
        for (let slot = 0; slot < SHAPES.length; slot++) {
            const b = document.createElement('button');
            b.className = 'sr-btn';
            b.type = 'button';
            const onDown = e => { e.preventDefault(); _press(pid, slot); };
            b.addEventListener('pointerdown', onDown);
            _cleanups.push(() => b.removeEventListener('pointerdown', onDown));
            row.appendChild(b);
            btns.push(b);
        }

        if (_n > 2) half.classList.add('sr-narrow');
        half.appendChild(pips);
        half.appendChild(row);
        _overlay.appendChild(half);
    }

    mg.appendChild(_overlay);
    _paintPips();
    document.getElementById('mg-neutral').textContent = `FIRST TO ${WIN_ROUNDS} — MATCH THE SHAPE!`;
}

// SVG silhouettes rather than emoji, so both halves are pixel-identical and the
// size can be tuned per context (40 px on a button, 96 px on the stage).
function _shapeSVG(id, color, size) {
    const wrap = inner =>
        `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">${inner}</svg>`;
    switch (id) {
        case 'tri':  return wrap(`<polygon points="50,10 92,86 8,86" fill="${color}"/>`);
        case 'circ': return wrap(`<circle cx="50" cy="50" r="40" fill="${color}"/>`);
        case 'sq':   return wrap(`<rect x="13" y="13" width="74" height="74" rx="10" fill="${color}"/>`);
        case 'star': return wrap(`<polygon fill="${color}" points="50,6 61,38 95,38 68,58 78,91 50,71 22,91 32,58 5,38 39,38"/>`);
        default:     return wrap('');
    }
}

// Both copies of the shape name always say the same thing.
function _setStageLabel(text) {
    if (_stageLabel)    _stageLabel.textContent = text;
    if (_stageLabelTop) _stageLabelTop.textContent = text;
}

const SLOT_ACCENT = ['#ff5a5a', '#5a9bff', '#5fd68a', '#ffd45f'];

function _paintPips() {
    for (let pid = 0; pid < _n; pid++) {
        if (!_pips[pid]) continue;
        const color = SLOT_ACCENT[pid] || '#ffffff';
        [..._pips[pid].children].forEach((pip, i) => {
            const on = i < _wins[pid];
            pip.style.background = on ? color : 'transparent';
            pip.style.boxShadow  = on ? `0 0 10px ${color}` : 'none';
        });
    }
}

// ── Round flow ──────────────────────────────────────────────────────────────

function _nextRound() {
    if (_done || !_overlay) return;
    _round++;
    _live = false;
    _target = null;
    _lockedUntil = new Array(_n).fill(0);
    _out = new Array(_n).fill(false);

    // Reshuffle which shape sits on which button — identically on both halves,
    // so the two players face exactly the same problem. This is what stops the
    // game decaying into pure reaction time: you have to FIND the shape, not
    // stab a remembered position.
    const order = SHAPES.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    for (let pid = 0; pid < _n; pid++) {
        _halves[pid]?.classList.remove('sr-locked');
        _buttons[pid].forEach((b, slot) => {
            const sh = SHAPES[order[slot]];
            b.dataset.shape = sh.id;
            b.innerHTML = _shapeSVG(sh.id, sh.color, 40);
            b.classList.remove('sr-hit', 'sr-miss');
        });
    }

    _stageShape.innerHTML = '';
    _stageShape.style.opacity = '0';
    _setStageLabel('GET READY…');

    const wait = SUSPENSE_MIN + Math.random() * (SUSPENSE_MAX - SUSPENSE_MIN);
    _after(() => {
        if (_done || !_stageShape) return;
        _target = SHAPES[Math.floor(Math.random() * SHAPES.length)];
        _stageShape.innerHTML = _shapeSVG(_target.id, _target.color, 96);
        _stageShape.style.opacity = '1';
        _stageShape.style.transform = 'scale(1.14)';
        _after(() => { if (_stageShape) _stageShape.style.transform = 'scale(1)'; }, 110);
        _setStageLabel(_target.name);
        _live = true;
        _roundStart = performance.now();
        sfx('react_go'); haptic([14]);
        for (let pid = 0; pid < _n; pid++) if (isBotSlot(pid)) _scheduleBot(pid);
    }, wait * 1000);
}

function _press(pid, slot) {
    if (_done || !state.mgActive) return;
    if (isBotSlot(pid)) return;                  // a bot answers via _botPress
    const now = performance.now();
    if (now < _lockedUntil[pid]) return;         // still serving a penalty
    if (_out[pid]) return;                       // jumped: out of this round

    // Before the shape appears: a false start. The shape appearing IS the go
    // signal, and jumping it has to cost something or the optimal play is to
    // mash all four buttons.
    //
    // At TWO that cost is the round, handed straight to the other player. Above
    // two it cannot be — the round is still live for everybody who waited — so
    // the jumper is locked out of it and the rest play on. The round only ends
    // early when there is nobody left who could still answer.
    if (!_live || !_target) {
        _flashButton(pid, slot, false);
        if (_n === 2) { _endRound(1 - pid, 'FALSE START'); return; }
        _out[pid] = true;
        _halves[pid]?.classList.add('sr-locked');
        sfx('land_bad'); haptic([60]);
        const left = _out.reduce((a, o) => a + (o ? 0 : 1), 0);
        if (left <= 1) _endRound(_out.findIndex(o => !o), 'EVERYBODY JUMPED');
        return;
    }

    if (_buttons[pid][slot].dataset.shape === _target.id) {
        _flashButton(pid, slot, true);
        _endRound(pid, null);
    } else {
        _wrongPress(pid, slot, false);
    }
}

// A wrong button costs you the rest of the round unless a rival is slower than
// the lockout. `retryBot` lets a bot have another go afterwards.
function _wrongPress(pid, slot, retryBot) {
    _flashButton(pid, slot, false);
    _lockedUntil[pid] = performance.now() + LOCKOUT * 1000;
    _halves[pid]?.classList.add('sr-locked');
    sfx('land_bad'); haptic([40, 40, 40]);
    _after(() => {
        if (_done) return;
        _halves[pid]?.classList.remove('sr-locked');
        _buttons[pid].forEach(b => b.classList.remove('sr-miss'));
        if (retryBot && _live && !_done) _scheduleBot(pid);
    }, LOCKOUT * 1000);
}

function _flashButton(pid, slot, good) {
    _buttons[pid][slot]?.classList.add(good ? 'sr-hit' : 'sr-miss');
}

function _endRound(winnerId, why) {
    if (_done) return;
    _live = false;
    _target = null;
    _botTimers.forEach(t => { clearTimeout(t); const i = _timers.indexOf(t); if (i >= 0) _timers.splice(i, 1); });
    _botTimers.clear();

    if (winnerId >= 0) {
        _wins[winnerId]++;
        _paintPips();
        sfx('coin_gain'); haptic([25]);
        _setStageLabel(why ? `${why} — ${_nameOf(winnerId)} TAKES IT` : `${_nameOf(winnerId)} TAKES IT`);
    } else {
        _setStageLabel('TOO SLOW — NO SCORE');
        sfx('land_bad');
    }
    if (_stageShape) _stageShape.style.opacity = '.22';

    const neu = document.getElementById('mg-neutral');
    // Four "P4 0" pairs plus the prose overflows one line on a 412 px phone and
    // truncates mid-word, so above two seats the tally is bare numbers — each
    // zone carries its own name and pips anyway.
    if (neu) neu.textContent = _n > 2
        ? `${_wins.join('·')}   —   FIRST TO ${WIN_ROUNDS}`
        : `${_wins.map((w, i) => `P${i + 1} ${w}`).join(' · ')}   —   FIRST TO ${WIN_ROUNDS}`;

    if (winnerId >= 0 && _wins[winnerId] >= WIN_ROUNDS) { _finish(winnerId); return; }
    if (_round >= MAX_ROUNDS)                           { _finishOnScore(); return; }
    _after(_nextRound, GAP * 1000);
}

// ── Bot (§5) ────────────────────────────────────────────────────────────────
//
// Two dials, both of which a human actually has: how fast it recognises the
// shape, and how often it stabs the wrong button.
// Every bot schedules its own answer. A little jitter per slot on top of the
// skill dial, so three bots do not all reach for the same button on the same
// frame — which reads as one bot with three hands.
function _scheduleBot(pid) {
    const think = 900 - _botSkill * 520 + Math.random() * 260 + pid * 40;
    const t = _after(() => { _botTimers.delete(t); _botPress(pid); }, think);
    _botTimers.add(t);
}

function _botPress(pid) {
    if (_done || !_live || !_target || _out[pid]) return;
    const wrongChance = (1 - _botSkill) * 0.42;                  // 0.32 easy → 0.06 hard
    let slot = _buttons[pid].findIndex(b => b.dataset.shape === _target.id);
    if (slot < 0) return;
    if (Math.random() < wrongChance) {
        const others = [0, 1, 2, 3].filter(i => i !== slot);
        slot = others[Math.floor(Math.random() * others.length)];
    }
    if (_buttons[pid][slot].dataset.shape === _target.id) {
        _flashButton(pid, slot, true);
        _endRound(pid, null);
    } else {
        _wrongPress(pid, slot, true);
    }
}

function _nameOf(pid) {
    const p = state.players[seatFor(pid)];
    return (p && p.name ? p.name : `P${pid + 1}`).toUpperCase();
}

// ── Loop: nothing moves, so this is just the two clocks (R1) ───────────────
function _tick(now) {
    if (_done || !state.mgActive) return;
    _af = requestAnimationFrame(_tick);
    const dt = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    // A round nobody answers is scrubbed rather than left hanging.
    if (_live && (now - _roundStart) / 1000 > ROUND_LIMIT) _endRound(-1, null);

    if (_elapsed >= MATCH_TIME) _finishOnScore();
}

// ── End (R6 — signalled once) ───────────────────────────────────────────────
function _finishOnScore() {
    const best = Math.max(..._wins);
    const top = _wins.reduce((a, w, i) => (w === best ? a.concat(i) : a), []);
    _finish(top.length === 1 ? top[0] : -1);
}

function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neu = document.getElementById('mg-neutral');
    if (neu) {
        neu.textContent = winnerId < 0
            ? `DRAW — ${_wins.join('·')}`
            : `${_nameOf(winnerId)} WINS ${_wins.join('–')}!`;
    }
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win'); haptic('heavy');
    _after(() => { _destroy(); _onWin(winnerId, null, _wins.slice(0, _n)); }, 1300);
}

// ── Cleanup (R3) ────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _stage = _stageShape = _stageLabel = _stageLabelTop = null;
    _buttons = []; _pips = []; _halves = [];
    _target = null; _live = false; _botTimers.clear();
    _last = 0; _elapsed = 0;
}
