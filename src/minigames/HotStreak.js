// ============================================================
// HOT STREAK — press your luck. Hold your side and a charge bar climbs. Let go
// to bank what you've built. Push past the hidden burn-out point and you bank
// nothing. The safe zone is marked; where exactly it goes bad is not.
//
// Five rounds, both players charging at once. The last round pays double.
//
// Verb: risk appetite. Every other game in the roster asks "can you do it?" —
// this one asks "how far will you push?". Nothing here is reaction or accuracy;
// the whole game is a greed decision made under a visible opponent, which is
// exactly why it stays interesting against someone you've played before.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const ROUNDS       = 5;
const CHARGE_RATE  = 0.30;   // bar fraction PER SECOND (R1) — ~3.3 s to full
const SAFE_UNTIL   = 0.45;   // below this the bar can never burn out
const BURN_MIN     = 0.52;   // burn-out point is drawn from [BURN_MIN, 1.0]
const ROUND_LIMIT  = 5.0;    // s — hold past this and it burns out regardless
const REVEAL_TIME  = 1.6;    // s between rounds
const FINAL_MULT   = 2;      // last round pays double (comeback, §3)
const MAX_POINTS   = 100;    // a full bar is worth this many points

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0;

let _round  = 0;
let _phase  = 'charge';        // 'charge' | 'reveal'
let _timer  = 0;
let _fill   = [0, 0];          // 0..1
let _holding = [false, false];
let _banked = [false, false];  // has this player released this round?
let _burnAt = [1, 1];          // hidden burn-out point per player per round
let _busted = [false, false];
let _score  = [0, 0];
let _gain   = [0, 0];
let _botTarget = 0;
const _pointerOwner = {};

const _cleanups = [];
const _timers   = [];
function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0; _round = 0; _score = [0, 0];
    for (const k of Object.keys(_pointerOwner)) delete _pointerOwner[k];
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _startRound();
        _af = requestAnimationFrame(_tick);
    }));
}

function _startRound() {
    _phase = 'charge';
    _timer = ROUND_LIMIT;
    _fill = [0, 0];
    _holding = [false, false];
    _banked = [false, false];
    _busted = [false, false];
    _gain = [0, 0];
    // Independent burn-out points: neither player can read the other's risk.
    _burnAt = [
        BURN_MIN + Math.random() * (1 - BURN_MIN),
        BURN_MIN + Math.random() * (1 - BURN_MIN),
    ];
    // Bot's intended release point — see §5 below.
    const greed = 0.50 + _botSkill * 0.16;                  // 0.54 easy → 0.63 hard
    _botTarget = Math.max(0.12, Math.min(0.95, greed + (Math.random() - 0.5) * (0.34 - _botSkill * 0.18)));
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = `ROUND ${_round + 1}/${ROUNDS}${_round === ROUNDS - 1 ? ' — DOUBLE!' : ''}   P1 ${_score[0]} · ${_score[1]} P2`;
    sfx('countdown');
}

// ── DOM ──────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;background:#1b1207;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    const pidOf = e => {
        const rect = _overlay.getBoundingClientRect();
        return (e.clientY - rect.top) > _overlay.clientHeight / 2 ? 0 : 1;
    };

    const onDown = e => {
        if (_done || _phase !== 'charge') return;
        e.preventDefault();
        const pid = pidOf(e);
        if (pid === 1 && _isBot) return;
        if (_banked[pid] || _busted[pid]) return;
        _pointerOwner[e.pointerId] = pid;
        _holding[pid] = true;
        if (pid === 0) haptic([12]);
    };
    const onUp = e => {
        const pid = _pointerOwner[e.pointerId];
        if (pid === undefined) return;
        delete _pointerOwner[e.pointerId];
        if (_done || _phase !== 'charge') return;
        e.preventDefault();
        _holding[pid] = false;
        _bank(pid);
    };

    _overlay.addEventListener('pointerdown',   onDown);
    _overlay.addEventListener('pointerup',     onUp);
    _overlay.addEventListener('pointercancel', onUp);
    _cleanups.push(() => {
        _overlay.removeEventListener('pointerdown',   onDown);
        _overlay.removeEventListener('pointerup',     onUp);
        _overlay.removeEventListener('pointercancel', onUp);
    });

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'HOLD TO CHARGE!';
}

function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
}

// ── Banking / busting ────────────────────────────────────────────────────────
function _bank(pid) {
    if (_banked[pid] || _busted[pid]) return;
    _banked[pid] = true;
    const mult = _round === ROUNDS - 1 ? FINAL_MULT : 1;
    _gain[pid] = Math.round(_fill[pid] * MAX_POINTS) * mult;
    _score[pid] += _gain[pid];
    sfx('coin_gain');
    if (pid === 0) haptic([20, 25, 20]);
    _maybeEndRound();
}

function _bust(pid) {
    if (_banked[pid] || _busted[pid]) return;
    _busted[pid] = true;
    _holding[pid] = false;
    _gain[pid] = 0;
    sfx('land_bad');
    if (pid === 0) haptic([90, 50, 90]);
    _maybeEndRound();
}

function _maybeEndRound() {
    const settled = p => _banked[p] || _busted[p];
    if (!settled(0) || !settled(1)) return;
    _phase = 'reveal';
    _timer = REVEAL_TIME;
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = `P1 ${_busted[0] ? 'BURNED OUT' : '+' + _gain[0]}  ·  ` +
                           `${_busted[1] ? 'BURNED OUT' : '+' + _gain[1]} P2`;
}

// ── Loop ─────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _timer -= dt;

    if (_phase === 'charge') {
        if (_isBot) _botUpdate();
        for (let p = 0; p < 2; p++) {
            if (!_holding[p] || _banked[p] || _busted[p]) continue;
            _fill[p] = Math.min(1, _fill[p] + CHARGE_RATE * dt);
            if (_fill[p] > SAFE_UNTIL && _fill[p] >= _burnAt[p]) _bust(p);
            else if (_fill[p] >= 1) _bust(p);
        }
        if (_timer <= 0) {
            // Time is up — anyone still holding pushed too long.
            for (let p = 0; p < 2; p++) {
                if (_banked[p] || _busted[p]) continue;
                if (_fill[p] > 0 && !_holding[p]) _bank(p);
                else _bust(p);
            }
        }
    } else if (_timer <= 0) {
        _round++;
        if (_round >= ROUNDS) {
            _finish(_score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1);
            return;
        }
        _startRound();
    }
    _draw();
}

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// Skill is expressed as judgement, not speed: a high-skill bot releases near the
// expected-value sweet spot with a tight spread, a low-skill bot is erratic and
// busts often. It also chases when behind, which keeps late rounds tense.
function _botUpdate() {
    const pid = 1;
    if (_banked[pid] || _busted[pid]) return;
    if (!_holding[pid]) { _holding[pid] = true; return; }
    let target = _botTarget;
    // Trailing badly on the last round? Gamble.
    if (_round === ROUNDS - 1 && _score[1] < _score[0] - 20) target = Math.min(0.95, target + 0.2);
    if (_fill[pid] >= target) { _holding[pid] = false; _bank(pid); }
}

// ── Draw ─────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);

    _ctx.save();
    _ctx.translate(w, h / 2); _ctx.rotate(Math.PI);
    _drawHalf(1, w, h / 2);
    _ctx.restore();

    _ctx.save();
    _ctx.translate(0, h / 2);
    _drawHalf(0, w, h / 2);
    _ctx.restore();

    _ctx.strokeStyle = 'rgba(255,255,255,0.14)'; _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(0, h / 2); _ctx.lineTo(w, h / 2); _ctx.stroke();
}

function _drawHalf(pid, w, h) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    const barX = w * 0.14, barW = w * 0.72;
    const barY = h * 0.30, barH = h * 0.34;

    // Header
    _ctx.textAlign = 'left'; _ctx.textBaseline = 'top';
    _ctx.font = '700 14px Nunito, sans-serif'; _ctx.fillStyle = accent;
    _ctx.fillText(`P${pid + 1}`, 12, 8);
    _ctx.textAlign = 'right';
    _ctx.font = '900 24px "Bebas Neue", sans-serif';
    _ctx.fillText(`${_score[pid]}`, w - 12, 4);

    // Track
    _roundRect(barX, barY, barW, barH, 10);
    _ctx.fillStyle = 'rgba(255,255,255,0.06)'; _ctx.fill();
    _ctx.strokeStyle = 'rgba(255,255,255,0.18)'; _ctx.lineWidth = 2; _ctx.stroke();

    // Danger band — everything past SAFE_UNTIL might burn. The exact point is
    // hidden; the hatching says "here be dragons" without giving the answer.
    const dx = barX + barW * SAFE_UNTIL, dw = barW * (1 - SAFE_UNTIL);
    _ctx.save();
    _roundRect(barX, barY, barW, barH, 10); _ctx.clip();
    _ctx.fillStyle = 'rgba(239,68,68,0.13)';
    _ctx.fillRect(dx, barY, dw, barH);
    _ctx.strokeStyle = 'rgba(239,68,68,0.28)'; _ctx.lineWidth = 2;
    for (let x = dx; x < dx + dw + barH; x += 11) {
        _ctx.beginPath(); _ctx.moveTo(x, barY + barH); _ctx.lineTo(x + barH, barY); _ctx.stroke();
    }
    _ctx.restore();

    // Fill
    const f = _fill[pid];
    _ctx.save();
    _roundRect(barX, barY, barW, barH, 10); _ctx.clip();
    const grad = _ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, '#4ade80');
    grad.addColorStop(SAFE_UNTIL, '#fbbf24');
    grad.addColorStop(1, '#ef4444');
    _ctx.fillStyle = _busted[pid] ? 'rgba(120,40,40,0.85)' : grad;
    _ctx.fillRect(barX, barY, barW * f, barH);
    _ctx.restore();

    // Safe-line marker
    _ctx.strokeStyle = 'rgba(255,255,255,0.55)'; _ctx.lineWidth = 2;
    _ctx.setLineDash([5, 4]);
    _ctx.beginPath(); _ctx.moveTo(dx, barY - 6); _ctx.lineTo(dx, barY + barH + 6); _ctx.stroke();
    _ctx.setLineDash([]);
    _ctx.font = '600 9px Nunito, sans-serif';
    _ctx.fillStyle = 'rgba(255,255,255,0.5)';
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'top';
    _ctx.fillText('SAFE', dx, barY + barH + 9);

    // Live value
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.font = '900 30px "Bebas Neue", sans-serif';
    _ctx.fillStyle = _busted[pid] ? '#f87171' : _banked[pid] ? '#4ade80' : '#fff';
    const label = _busted[pid] ? 'BURNED OUT'
                : _banked[pid] ? `BANKED +${_gain[pid]}`
                : `${Math.round(f * MAX_POINTS)}`;
    _ctx.fillText(label, w / 2, barY + barH / 2);

    // Prompt — shape and words, not colour alone (§4)
    _ctx.font = '700 13px Nunito, sans-serif';
    _ctx.fillStyle = 'rgba(255,255,255,0.62)';
    _ctx.textBaseline = 'top';
    const prompt = _phase === 'reveal' ? ''
        : _busted[pid] ? 'out this round'
        : _banked[pid] ? 'banked — wait it out'
        : _holding[pid] ? 'RELEASE TO BANK' : 'HOLD ANYWHERE TO CHARGE';
    _ctx.fillText(prompt, w / 2, barY + barH + 26);

    // Where the burn-out actually was — shown only after the round settles, so
    // players learn the distribution over the match.
    if (_phase === 'reveal') {
        const bx = barX + barW * _burnAt[pid];
        _ctx.strokeStyle = '#ef4444'; _ctx.lineWidth = 3;
        _ctx.beginPath(); _ctx.moveTo(bx, barY - 10); _ctx.lineTo(bx, barY + barH + 10); _ctx.stroke();
        _ctx.font = '900 10px "Bebas Neue", sans-serif';
        _ctx.fillStyle = '#ef4444'; _ctx.textAlign = 'center'; _ctx.textBaseline = 'bottom';
        _ctx.fillText('BURN', bx, barY - 12);
    }

    // Round pips
    for (let i = 0; i < ROUNDS; i++) {
        _ctx.beginPath();
        _ctx.arc(w / 2 - (ROUNDS - 1) * 7 + i * 14, h - 16, 4, 0, Math.PI * 2);
        _ctx.fillStyle = i < _round ? accent : i === _round ? '#fbbf24' : 'rgba(255,255,255,0.18)';
        _ctx.fill();
    }
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

// ── End ──────────────────────────────────────────────────────────────────────
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = winnerId < 0
        ? `DRAW — ${_score[0]} EACH`
        : `P${winnerId + 1} WINS — ${_score[winnerId]} PTS!`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1400);
}

function _destroy() {
    _done = true;
    _phase = 'reveal';
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0;
    for (const k of Object.keys(_pointerOwner)) delete _pointerOwner[k];
}
