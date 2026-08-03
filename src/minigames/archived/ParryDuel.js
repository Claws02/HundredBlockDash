// ============================================================
// PARRY DUEL — read & counter. Both players choose in secret from three
// stances each round, then they resolve at once:
//
//        ⚔ STRIKE  beats  ⚡ CHARGE
//        🛡 PARRY   beats  ⚔ STRIKE
//        ⚡ CHARGE  beats  🛡 PARRY
//
// STRIKE and PARRY score 1. CHARGE is the greedy option: +2 when it lands,
// −1 when it's read. Best score after 5 rounds takes it.
//
// Verb: read & counter. Every other game in the roster tests a motor skill;
// this one is the only pure mind game — you're playing the person, not the
// screen. That's what makes it replayable against the same opponent.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const ROUNDS      = 5;
const CHOOSE_TIME = 2.6;   // s to lock a stance
const REVEAL_TIME = 1.7;   // s the resolution stays on screen
const FINAL_BONUS = 2;     // last round is worth double (comeback, §3)

// index → { key, icon, label, beats }
const STANCES = [
    { key: 'strike', icon: '⚔',  label: 'STRIKE', beats: 2, win: 1, lose: 0 },
    { key: 'parry',  icon: '🛡', label: 'PARRY',  beats: 0, win: 1, lose: 0 },
    { key: 'charge', icon: '⚡', label: 'CHARGE', beats: 1, win: 2, lose: -1 },
];

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0;

let _round = 0;
let _phase = 'choose';        // 'choose' | 'reveal'
let _timer = 0;               // seconds left in the current phase
let _pick  = [-1, -1];        // stance index locked this round, -1 = none
let _score = [0, 0];
let _banner = '';
let _lastOutcome = [0, 0];    // points gained last round, for the reveal
let _history = [];            // P1's picks — the bot reads patterns from this
let _botPlan = -1;

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
    _last = 0; _round = 0; _score = [0, 0]; _history = [];
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
    _phase = 'choose';
    _timer = CHOOSE_TIME;
    _pick = [-1, -1];
    _banner = '';
    _lastOutcome = [0, 0];
    _botPlan = _isBot ? _botChoose() : -1;
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
        'position:absolute;inset:0;overflow:hidden;background:#17111f;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    const onDown = e => {
        if (_done || _phase !== 'choose') return;
        e.preventDefault();
        const rect = _overlay.getBoundingClientRect();
        const w = _overlay.clientWidth, h = _overlay.clientHeight;
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const pid = sy > h / 2 ? 0 : 1;
        if (pid === 1 && _isBot) return;
        if (_pick[pid] >= 0) return;                 // locked for this round
        // Map to the half's local space (the top half is drawn rotated 180°).
        const lx = pid === 0 ? sx : w - sx;
        const idx = _stanceAt(lx, w);
        if (idx >= 0) _lock(pid, idx);
    };
    _overlay.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'PICK YOUR STANCE!';
}

// Three equal columns across the half.
function _stanceAt(lx, w) {
    const i = Math.floor((lx / w) * 3);
    return i >= 0 && i < 3 ? i : -1;
}

function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
}

// ── Round resolution ─────────────────────────────────────────────────────────
function _lock(pid, idx) {
    _pick[pid] = idx;
    sfx('buy');
    if (pid === 0) haptic([18]);
    if (_pick[0] >= 0 && _pick[1] >= 0) _resolveRound();
}

function _resolveRound() {
    if (_phase !== 'choose') return;
    _phase = 'reveal';
    _timer = REVEAL_TIME;

    if (_pick[0] >= 0) _history.push(_pick[0]);

    const mult = _round === ROUNDS - 1 ? FINAL_BONUS : 1;
    const a = _pick[0], b = _pick[1];

    if (a < 0 && b < 0) {
        _banner = 'BOTH HESITATED';
    } else if (a < 0 || b < 0) {
        // Failing to commit hands the round over.
        const w = a < 0 ? 1 : 0;
        _lastOutcome[w] = 1 * mult;
        _score[w] += 1 * mult;
        _banner = `P${(a < 0 ? 0 : 1) + 1} HESITATED`;
    } else if (a === b) {
        _banner = 'CLASH — NO SCORE';
    } else {
        const aWins = STANCES[a].beats === b;
        const wi = aWins ? 0 : 1, li = aWins ? 1 : 0;
        const wStance = STANCES[_pick[wi]], lStance = STANCES[_pick[li]];
        _lastOutcome[wi] = wStance.win * mult;
        _lastOutcome[li] = lStance.lose * mult;
        _score[wi] += _lastOutcome[wi];
        _score[li] += _lastOutcome[li];
        _banner = `${wStance.icon} BEATS ${lStance.icon}`;
    }
    _score = _score.map(s => Math.max(0, s));

    sfx(_banner.includes('CLASH') || _banner.includes('HESITATED') ? 'land_bad' : 'coin_gain');
    haptic([30, 40, 30]);

    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = `${_banner}   P1 ${_score[0]} · ${_score[1]} P2`;
}

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// Skill = how well it reads the human. At low skill it plays near-random; at
// high skill it counters the opponent's most frequent recent stance. It always
// keeps noise so it is never deterministic and never unbeatable.
function _botChoose() {
    if (Math.random() > _botSkill) return Math.floor(Math.random() * 3);

    const recent = _history.slice(-4);
    if (recent.length === 0) return Math.floor(Math.random() * 3);
    const counts = [0, 0, 0];
    recent.forEach(v => counts[v]++);
    let fav = 0;
    for (let i = 1; i < 3; i++) if (counts[i] > counts[fav]) fav = i;

    // Play the stance that beats their favourite.
    const counter = STANCES.findIndex(s => s.beats === fav);
    // Even when reading correctly, sometimes take the safe 1-pointer instead of
    // the greedy CHARGE, so the bot isn't a solved pattern either.
    if (counter === 2 && Math.random() > _botSkill) return Math.floor(Math.random() * 2);
    return counter >= 0 ? counter : Math.floor(Math.random() * 3);
}

// ── Loop ─────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _timer -= dt;

    if (_phase === 'choose') {
        // Bot commits partway through the window so its pick isn't instant.
        if (_isBot && _pick[1] < 0 && _timer < CHOOSE_TIME * (0.75 - _botSkill * 0.35)) {
            _lock(1, _botPlan >= 0 ? _botPlan : Math.floor(Math.random() * 3));
        }
        if (_timer <= 0) _resolveRound();
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

    // Centre band: the shared clock and the round result
    _ctx.save();
    _ctx.fillStyle = 'rgba(0,0,0,0.45)';
    _ctx.fillRect(0, h / 2 - 22, w, 44);
    _ctx.strokeStyle = 'rgba(255,255,255,0.16)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, h / 2 - 22); _ctx.lineTo(w, h / 2 - 22);
    _ctx.moveTo(0, h / 2 + 22); _ctx.lineTo(w, h / 2 + 22); _ctx.stroke();

    if (_phase === 'choose') {
        const frac = Math.max(0, _timer / CHOOSE_TIME);
        _ctx.fillStyle = frac < 0.3 ? '#f87171' : '#fbbf24';
        _ctx.fillRect(0, h / 2 - 3, w * frac, 6);
        _ctx.fillStyle = 'rgba(255,255,255,0.75)';
        _ctx.font = '900 16px "Bebas Neue", sans-serif';
        _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
        _ctx.fillText(`LOCK IT IN — ${_timer.toFixed(1)}s`, w / 2, h / 2 - 12);
    } else {
        _ctx.fillStyle = '#fbbf24';
        _ctx.font = '900 20px "Bebas Neue", sans-serif';
        _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
        _ctx.fillText(_banner, w / 2, h / 2);
    }
    _ctx.restore();
}

function _drawHalf(pid, w, h) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    const colW = w / 3;
    const top  = h * 0.20, boxH = h * 0.52;

    // Score + round
    _ctx.fillStyle = accent;
    _ctx.font = '700 14px Nunito, sans-serif';
    _ctx.textAlign = 'left'; _ctx.textBaseline = 'top';
    _ctx.fillText(`P${pid + 1}`, 14, 10);
    _ctx.textAlign = 'right';
    _ctx.font = '900 24px "Bebas Neue", sans-serif';
    _ctx.fillText(`${_score[pid]}`, w - 14, 4);

    for (let i = 0; i < 3; i++) {
        const s = STANCES[i];
        const x = i * colW + 8, bw = colW - 16;
        const chosen  = _pick[pid] === i;
        const revealed = _phase === 'reveal';

        // Card
        _ctx.globalAlpha = (_phase === 'choose' && _pick[pid] >= 0 && !chosen) ? 0.28 : 1;
        _roundRect(x, top, bw, boxH, 12);
        _ctx.fillStyle = chosen && revealed ? 'rgba(251,191,36,0.22)'
                       : chosen             ? 'rgba(255,255,255,0.14)'
                                            : 'rgba(255,255,255,0.05)';
        _ctx.fill();
        _ctx.strokeStyle = chosen ? (revealed ? '#fbbf24' : accent) : 'rgba(255,255,255,0.18)';
        _ctx.lineWidth = chosen ? 3 : 1.5;
        _ctx.stroke();

        // Icon + label. During 'choose' the opponent's pick stays hidden — only
        // your own card lights up, so neither player can see the other's choice.
        const showPick = revealed || chosen;
        _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
        _ctx.font = '30px system-ui, sans-serif';
        _ctx.fillStyle = '#fff';
        _ctx.fillText(s.icon, x + bw / 2, top + boxH * 0.36);
        _ctx.font = '900 14px "Bebas Neue", sans-serif';
        _ctx.fillStyle = showPick ? '#fff' : 'rgba(255,255,255,0.65)';
        _ctx.fillText(s.label, x + bw / 2, top + boxH * 0.66);
        // Beats-what hint, so the rules are readable without a tutorial (§3)
        _ctx.font = '600 10px Nunito, sans-serif';
        _ctx.fillStyle = 'rgba(255,255,255,0.42)';
        _ctx.fillText(`beats ${STANCES[s.beats].icon}`, x + bw / 2, top + boxH * 0.84);
        _ctx.globalAlpha = 1;
    }

    // Lock state / round payoff
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    if (_phase === 'choose') {
        _ctx.font = '700 12px Nunito, sans-serif';
        _ctx.fillStyle = _pick[pid] >= 0 ? '#4ade80' : 'rgba(255,255,255,0.5)';
        _ctx.fillText(_pick[pid] >= 0 ? '✓ LOCKED' : 'CHOOSE ONE', w / 2, top + boxH + 22);
    } else {
        const d = _lastOutcome[pid];
        _ctx.font = '900 18px "Bebas Neue", sans-serif';
        _ctx.fillStyle = d > 0 ? '#4ade80' : d < 0 ? '#f87171' : 'rgba(255,255,255,0.5)';
        _ctx.fillText(d > 0 ? `+${d}` : d < 0 ? `${d}` : '—', w / 2, top + boxH + 22);
    }

    // CHARGE risk reminder
    _ctx.font = '600 10px Nunito, sans-serif';
    _ctx.fillStyle = 'rgba(255,255,255,0.34)';
    _ctx.fillText('⚡ CHARGE: +2 if it lands, −1 if it\'s read', w / 2, h - 14);
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
}
