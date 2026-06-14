// ============================================================
// MINIGAME TEMPLATE — copy this file to start a new game.
// Read docs/MINIGAME_STANDARD.md first. Every rule below maps
// to a section there (R1–R7, §5). SnapStrike.js is a complete
// reference built on this skeleton.
//
// Checklist before shipping: docs/MINIGAME_STANDARD.md §8.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables (name them; no magic numbers in the loop) ──────────────────────
const ROUND_TIME = 20;     // seconds
const MARKER_SPEED = 0.8;  // units PER SECOND (R1) — never per frame

// ── Module state (singleton — start() resets, _destroy() clears) ────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0;
const _cleanups = [];   // listener removers
const _timers   = [];   // setTimeout ids

// Tracked timer so _destroy() can clear it (R3).
function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0;
    registerMinigameCleanup(_destroy);   // R3 — force-end safety
    _build();
    // Two rAFs so the overlay has laid out before we measure it.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM (R2 — own overlay, no id, into #minigame-layer) ─────────────────────
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

    // Input partitioned by half (R5): bottom = P1, top = P2.
    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const pid = e.clientY > _overlay.clientHeight / 2 ? 0 : 1;
        if (pid === 1 && _isBot) return;   // bot's half ignores human touch
        _handleTap(pid);
    };
    _overlay.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);

    document.getElementById('mg-neutral').textContent = 'GO!';  // 3-second prompt (§3)
}

// R4 — DPR-correct backing store; CSS box stays at client size.
function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
}

// ── Game loop (R1 — dt in seconds) ──────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1/60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;

    _update(dt);
    if (_isBot) _botUpdate(dt);
    _draw();
}

function _update(dt) {
    // Advance game state by dt seconds. e.g. marker += MARKER_SPEED * dt;
}

// ── Bot (§5 — scale by _botSkill, always add noise) ─────────────────────────
function _botUpdate(dt) {
    // Example: act when within a skill-scaled error window.
    // const reactMs = 600 - _botSkill * 460 + Math.random() * 120;
}

function _handleTap(pid) {
    // Score the tap, update #mg-neutral, check for a winner.
}

// ── Draw ─────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);

    // P2 (top) half is rotated 180° so it reads right-side up for them (R5).
    _ctx.save();
    _ctx.translate(w, h / 2); _ctx.rotate(Math.PI); _ctx.translate(0, 0);
    _drawHalf(1, w, h / 2);
    _ctx.restore();

    // P1 (bottom) half, drawn normally.
    _ctx.save();
    _ctx.translate(0, h / 2);
    _drawHalf(0, w, h / 2);
    _ctx.restore();
}

function _drawHalf(pid, w, h) {
    // Draw this player's identical playfield into a (w × h) box at origin.
}

// ── End (R6 — once, guarded) ─────────────────────────────────────────────────
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent =
        winnerId < 0 ? 'DRAW!' : `P${winnerId + 1} WINS!`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1400);
}

// ── Cleanup (R3) ──────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0;
}
