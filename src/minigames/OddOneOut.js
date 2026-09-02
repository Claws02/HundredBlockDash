// ============================================================
// ODD ONE OUT — spot-the-difference race for TWO, THREE OR FOUR.
// Every tile on your grid is the same shade except one. Tap the odd
// one to score and get a fresh, harder grid (more tiles, subtler
// difference). A wrong tap briefly locks you. Most correct in 30 s
// wins. Fills the visual-scan category.
//
// LIVE (MG_PROFILE.live): every seat plays at once on a zone of its
// own, nobody waits a turn. It is the cheapest game in the roster to
// run that way because there was never a shared playfield to divide —
// each player already had a private grid, a private score and a
// private lockout, so widening the arrays from two to slotCount() and
// taking the zones from MinigameLayout is the whole conversion. Its
// wire tier is 'none' for the same reason: across phones each player
// solves their own seeded puzzles and only the final count is compared.
//
// Tiles differ by LIGHTNESS only (not hue) so it stays colourblind-safe.
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, slotCount, isBotSlot, seatFor } from './MinigameManager.js';
import { zonesFor } from '../config/MinigameLayout.js';
import * as Solo from './SoloArena.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const GAME_TIME = 30;     // s
const LOCK      = 0.8;    // s lockout after a wrong tap

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;

let _n = 2;                 // how many are playing — slots, not seats
let _score = [];
let _gridN = [];
let _base  = [];
let _odd   = [];
let _oddColor = [];
let _lockUntil = [];
let _flashWrong = [];
let _botNextAt = [];         // one per slot: above two seats there is more than one bot
let _zones = [];             // one rect+rotation per slot, from MinigameLayout

const _cleanups = [];
const _timers   = [];
// Seeded when this is played across phones: the same hues, the same odd tile
// in the same place, the same difficulty step. Comparing scores earned on
// different grids would not be comparing anything.
// Drawn BY INDEX: a new puzzle is generated whenever a player solves the last
// one, so two phones reach their Nth puzzle at completely different moments. By
// index, everybody's 4th grid is the same 4th grid — which is what makes "most
// found in thirty seconds" a fair comparison.
let _puzzles = 0;
let _k = 0;
const _rnd  = () => (Solo.isSolo() ? Solo.draw(_puzzles * 8 + (_k++ % 8)) : Math.random());
const _rand = n => Math.floor(_rnd() * n);

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _n = Math.max(2, Math.min(4, slotCount()));
    _last = 0; _elapsed = 0;
    _score      = new Array(_n).fill(0);
    _gridN      = new Array(_n).fill(3);
    _base       = new Array(_n).fill('');
    _odd        = new Array(_n).fill(0);
    _oddColor   = new Array(_n).fill('');
    _lockUntil  = new Array(_n).fill(0);
    _flashWrong = new Array(_n).fill(0);
    _botNextAt  = new Array(_n).fill(0);
    _puzzles = 0; _k = 0;
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        for (let i = 0; i < _n; i++) _newPuzzle(i);
        document.getElementById('mg-neutral').textContent = 'TAP THE ODD TILE!';
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;background:#14141f;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const r = _overlay.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        // Alone the grid is the whole screen, and every tap is yours.
        if (Solo.isSolo()) {
            const i = _cellAt(x, y, _overlay.clientWidth, _overlay.clientHeight, _gridN[0]);
            if (i >= 0) _tap(0, i);
            return;
        }
        const pid = _zoneAt(x, y);
        if (pid < 0 || isBotSlot(pid)) return;    // a bot's grid ignores fingers
        const z = _zones[pid], zr = z.rect;
        // Into the zone's own frame, and the far seats read theirs upside down.
        const lx = z.rot === 180 ? (zr.x + zr.w) - x : x - zr.x;
        const ly = z.rot === 180 ? (zr.y + zr.h) - y : y - zr.y;
        const idx = _cellAt(lx, ly, zr.w, zr.h, _gridN[pid]);
        if (idx >= 0) _tap(pid, idx);
    };
    _overlay.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
}

function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    _zones = zonesFor(_n, w, h);
}

/** Which slot's zone contains this point, or -1. */
function _zoneAt(x, y) {
    for (let i = 0; i < _zones.length; i++) {
        const r = _zones[i].rect;
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
    }
    // The bands above and below the zones are the manager's status pills. A
    // finger that lands there belongs to the nearest zone rather than nobody.
    let best = -1, bestD = Infinity;
    _zones.forEach((z, i) => {
        const cy = z.rect.y + z.rect.h / 2;
        const d = Math.abs(y - cy) + (x < z.rect.x || x > z.rect.x + z.rect.w ? 1e4 : 0);
        if (d < bestD) { bestD = d; best = i; }
    });
    return best;
}

function _cellRects(w, hh, n) {
    const grid = Math.min(w, hh * 0.78) * 0.84;
    const cell = grid / n;
    const pad  = cell * 0.09;
    const x0 = w / 2 - grid / 2;
    const y0 = hh * 0.56 - grid / 2;
    const rects = [];
    for (let i = 0; i < n * n; i++) {
        const r = Math.floor(i / n), c = i % n;
        rects.push({ x: x0 + c * cell + pad, y: y0 + r * cell + pad, s: cell - pad * 2 });
    }
    return rects;
}

function _cellAt(lx, ly, w, hh, n) {
    const rects = _cellRects(w, hh, n);
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (lx >= r.x && lx <= r.x + r.s && ly >= r.y && ly <= r.y + r.s) return i;
    }
    return -1;
}

// ── Puzzles ────────────────────────────────────────────────────────────────────
function _newPuzzle(pid) {
    _k = 0;
    const n = Math.min(3 + Math.floor(_score[pid] / 3), 5);
    const hue = _rand(360);
    const baseL = 52;
    const delta = Math.max(7, 32 - _score[pid] * 2);   // shrinks as you score
    _gridN[pid] = n;
    _base[pid]  = `hsl(${hue},60%,${baseL}%)`;
    _oddColor[pid] = `hsl(${hue},60%,${baseL + (_rnd() < 0.5 ? delta : -delta)}%)`;
    _odd[pid] = _rand(n * n);
    // Every bot plans its own next scan. This used to be one variable that only
    // slot 1 ever wrote, so at three or four seats the second and third bots
    // would have sat on their first grid for the whole thirty seconds.
    if (isBotSlot(pid)) _botNextAt[pid] = _elapsed + _botThink(n);
    _puzzles++;
}

function _botThink(n) {
    // Scan time grows with grid size; shrinks with skill. Always noisy. (§5)
    return (0.6 - _botSkill * 0.38) + n * n * (0.030 - _botSkill * 0.018) + Math.random() * 0.25;
}

function _tap(pid, idx) {
    if (_done || _elapsed < _lockUntil[pid]) return;
    if (idx === _odd[pid]) {
        _score[pid]++;
        sfx('coin_gain'); haptic([15]);
        _newPuzzle(pid);
    } else {
        _lockUntil[pid] = _elapsed + LOCK;
        _flashWrong[pid] = LOCK;
        sfx('land_bad'); haptic([60]);
        if (isBotSlot(pid)) _botNextAt[pid] = _elapsed + LOCK + 0.15;
    }
}

// ── Loop ────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1/60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _elapsed += dt;
    for (let i = 0; i < _n; i++) _flashWrong[i] = Math.max(0, _flashWrong[i] - dt);

    for (let pid = 0; pid < _n; pid++) {
        if (!isBotSlot(pid)) continue;
        if (_elapsed < _botNextAt[pid] || _elapsed < _lockUntil[pid]) continue;
        const cells = _gridN[pid] * _gridN[pid];
        const wrong = Math.random() < (1 - _botSkill) * 0.15;
        const idx = wrong ? (_odd[pid] + 1 + _rand(cells - 1)) % cells : _odd[pid];
        _tap(pid, idx);
    }

    if (_elapsed >= GAME_TIME) {
        if (Solo.isSolo()) return _finishSolo();
        return _finish(_leader());
    }

    _draw();
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);
    if (Solo.isSolo()) {
        // No divider, no second grid, no rotation: the puzzle is the screen.
        _drawHalf(0, w, h);
        const t = Math.max(0, GAME_TIME - _elapsed);
        // At the top, on its own band. The bottom belongs to the status strip,
        // which wraps to three lines on a narrow phone.
        _ctx.fillStyle = 'rgba(8,6,18,0.72)';
        _ctx.fillRect(0, 0, w, 46);
        _ctx.fillStyle = t < 5 ? '#ef4444' : 'rgba(255,255,255,0.75)';
        _ctx.font = '900 22px "Bebas Neue", sans-serif'; _ctx.textAlign = 'center';
        _ctx.fillText(`${t.toFixed(1)}s`, w / 2, 31);
        return;
    }
    if (!_zones.length) _zones = zonesFor(_n, w, h);

    // Zone borders. At two seats this is the single centre line the face-off
    // has always had; at four it is the cross between the quarters.
    _ctx.strokeStyle = 'rgba(255,255,255,0.10)'; _ctx.lineWidth = 2;
    _zones.forEach(z => {
        const r = z.rect;
        _ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    });

    _zones.forEach((z, pid) => {
        const r = z.rect;
        _ctx.save();
        if (z.rot === 180) {
            // About the zone's own centre, so its grid faces the player sitting
            // at that edge — per zone, rather than per screen.
            _ctx.translate(r.x + r.w, r.y + r.h);
            _ctx.rotate(Math.PI);
        } else {
            _ctx.translate(r.x, r.y);
        }
        _drawHalf(pid, r.w, r.h);
        _ctx.restore();
    });

    // Shared countdown, dead centre, upright for everybody.
    const left = Math.max(0, GAME_TIME - _elapsed);
    _ctx.fillStyle = 'rgba(8,6,18,0.72)';
    _ctx.beginPath(); _ctx.arc(w / 2, h / 2, 26, 0, Math.PI * 2); _ctx.fill();
    _ctx.fillStyle = left < 5 ? '#ef4444' : 'rgba(255,255,255,0.7)';
    _ctx.font = '900 20px "Bebas Neue", sans-serif';
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.fillText(`${left.toFixed(1)}s`, w / 2, h / 2 + 1);
    _ctx.textBaseline = 'alphabetic';
}

const SLOT_ACCENT = ['#ff5a5a', '#5a9bff', '#5fd68a', '#ffd45f'];

function _drawHalf(pid, w, hh) {
    const accent = SLOT_ACCENT[pid] || '#ffffff';
    const n = _gridN[pid];
    const rects = _cellRects(w, hh, n);
    const locked = _elapsed < _lockUntil[pid];

    for (let i = 0; i < n * n; i++) {
        const { x, y, s } = rects[i];
        _roundRect(x, y, s, s, s * 0.16);
        _ctx.fillStyle = i === _odd[pid] ? _oddColor[pid] : _base[pid];
        _ctx.globalAlpha = locked ? 0.45 : 1;
        _ctx.fill();
        _ctx.globalAlpha = 1;
    }

    if (_flashWrong[pid] > 0) {   // red wash on a wrong tap
        _ctx.globalAlpha = (_flashWrong[pid] / LOCK) * 0.25;
        _ctx.fillStyle = '#ef4444'; _ctx.fillRect(0, 0, w, hh);
        _ctx.globalAlpha = 1;
    }

    _ctx.fillStyle = accent;
    _ctx.font = '700 18px Nunito, sans-serif'; _ctx.textAlign = 'center'; _ctx.textBaseline = 'alphabetic';
    _ctx.fillText(Solo.isSolo() ? 'YOU' : _nameOf(pid), w / 2, hh * 0.12);
    _ctx.fillStyle = 'rgba(255,255,255,0.9)';
    _ctx.font = '900 28px "Bebas Neue", sans-serif';
    _ctx.fillText(`${_score[pid]}`, w / 2, hh * 0.21);
}

function _roundRect(x, y, w, h, r) {
    _ctx.beginPath();
    _ctx.moveTo(x + r, y);
    _ctx.arcTo(x + w, y, x + w, y + h, r);
    _ctx.arcTo(x + w, y + h, x, y + h, r);
    _ctx.arcTo(x, y + h, x, y, r);
    _ctx.arcTo(x, y, x + w, y, r);
    _ctx.closePath();
}

// ── End / cleanup ─────────────────────────────────────────────────────────────
/** Correct taps. Higher is better, as every reported score must be. */
export function soloScore() { return _score[0]; }

function _finishSolo() {
    if (_done) return;
    _done = true;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent = `${_score[0]} FOUND`;
    sfx('mg_win');
    const banked = soloScore();
    _after(() => { _destroy(); Solo.soloFinish(banked); }, 1200);
}

/** The outright top scorer, or -1 if the top is shared. */
function _leader() {
    const best = Math.max(..._score);
    const top = _score.reduce((a, v, i) => (v === best ? a.concat(i) : a), []);
    return top.length === 1 ? top[0] : -1;
}

function _nameOf(pid) {
    const p = state.players[seatFor(pid)];
    return (p && p.name ? p.name : `P${pid + 1}`).toUpperCase();
}

function _scoreLine() {
    return _score.map((v, i) => `${_nameOf(i)} ${v}`).join(' · ');
}

function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) {
        neutral.textContent = winnerId < 0
            ? `DRAW! ${_scoreLine()}`
            : `${_nameOf(winnerId)} WINS! ${_scoreLine()}`;
    }
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1500);
}

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0;
}
