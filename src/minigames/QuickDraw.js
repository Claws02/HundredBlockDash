// ============================================================
// QUICK DRAW — a reflex race for TWO, THREE OR FOUR. Every zone
// shows WAIT; after a random delay they all flip to DRAW. First to
// tap takes the round — but tap before DRAW and you jump, and a
// jumper cannot win the round they jumped. First to 2 rounds.
//
// THE REFERENCE FOR A LIVE GAME. "Live" means every seat plays at
// once, on its own zone, with nobody waiting a turn — which above
// two players is the only arrangement worth having. Three things
// make a game live, and they are all visible below:
//
//   1. It asks MinigameManager.slotCount() how many players there
//      are instead of assuming two, and sizes every array to it.
//   2. It takes its zones from MinigameLayout.zonesFor(), which
//      lays them out where people are actually sitting — the
//      shipped face-off at two, corners at four.
//   3. It asks isBotSlot(slot) per slot rather than taking the one
//      `isBot` flag, which only ever described slot 1.
//
// At two players this is the game that shipped, unchanged in feel:
// two full-width halves, the far one rotated, first finger wins.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, slotCount, isBotSlot, seatFor } from './MinigameManager.js';
import { zonesFor } from '../config/MinigameLayout.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const WINS_NEEDED = 2;     // best of 3
const ARM_MIN     = 1.4;   // s — shortest wait before DRAW
const ARM_MAX     = 3.0;   // s — longest wait
const TIE_WINDOW  = 0.05;  // s — taps this close count as a tie (replay)
// Ceilings (§3). Without these the round sat in the 'fire' phase forever if
// neither player drew, and the match only ended when the manager's 90 s tie
// watchdog fired — the last game in the roster that could reach it.
const DRAW_LIMIT  = 2.8;   // s after DRAW! before the round is scrubbed
const MATCH_TIME  = 44;    // s hard ceiling; settles on rounds won

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _t = 0;

let _phase = 'arm';        // 'arm' | 'fire' | 'over'
let _fireAt = 0;           // performance.now() when DRAW fired
let _n = 2;                // how many are playing — slots, not seats
let _wins = [];
let _round = 0;
let _tapped = [];
let _jumped = [];          // drew before DRAW: out of THIS round, not the match
let _taps = [];            // { pid, t } collected during the tie window
let _banner = '';          // centre result text for the round
let _flushPending = false;
let _zones = [];           // one rect+rotation per slot, from MinigameLayout

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
    _last = 0; _round = 0;
    _wins = new Array(_n).fill(0);
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _startRound();
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
        const pid = _zoneAt(e.clientX - r.left, e.clientY - r.top);
        if (pid < 0 || isBotSlot(pid)) return;   // a bot's zone ignores fingers
        _tap(pid);
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
    // Above and below the zones are the status pills' bands. A finger that
    // lands there belongs to whichever zone is nearest, rather than to nobody.
    let best = -1, bestD = Infinity;
    _zones.forEach((z, i) => {
        const cy = z.rect.y + z.rect.h / 2;
        const d = Math.abs(y - cy) + (x < z.rect.x || x > z.rect.x + z.rect.w ? 1e4 : 0);
        if (d < bestD) { bestD = d; best = i; }
    });
    return best;
}

// ── Rounds ────────────────────────────────────────────────────────────────────
function _startRound() {
    _phase = 'arm';
    _tapped = new Array(_n).fill(false);
    _jumped = new Array(_n).fill(false);
    _taps = [];
    _flushPending = false;
    _banner = '';
    // The strip is one line on a 412 px phone and four names plus four scores
    // do not fit next to the prose — it was truncating mid-word at "P3". Each
    // zone already carries its own name and win pips, so above two seats the
    // strip drops the score line and just says what is happening.
    document.getElementById('mg-neutral').textContent = _n > 2
        ? `ROUND ${_round + 1} — WAIT FOR IT…`
        : `ROUND ${_round + 1} — WAIT FOR IT…  ${_scoreLine()}`;

    const armMs = (ARM_MIN + Math.random() * (ARM_MAX - ARM_MIN)) * 1000;

    // Every bot plans its own round: an honest reaction after DRAW, or (rarely,
    // more at low skill) a jumpy false start before it. §5 — always noisy, and
    // now once per bot rather than once for slot 1.
    for (let slot = 0; slot < _n; slot++) {
        if (!isBotSlot(slot)) continue;
        if (Math.random() < (1 - _botSkill) * 0.16) {
            _after(() => { if (_phase === 'arm') _tap(slot); },
                   300 + Math.random() * Math.max(100, armMs - 500));
        } else {
            const react = 600 - _botSkill * 460 + Math.random() * 120;
            _after(() => { if (_phase === 'fire') _tap(slot); }, armMs + react);
        }
    }

    _after(_fire, armMs);
}

function _nameOf(pid) {
    const p = state.players[seatFor(pid)];
    return (p && p.name ? p.name : `P${pid + 1}`).toUpperCase();
}

/** Rounds won so far. Short enough for the strip: "1·0·2·0". */
function _scoreLine() {
    return _n > 2 ? _wins.join('·') : _wins.map((w, i) => `P${i + 1} ${w}`).join(' · ');
}

function _fire() {
    if (_done || _phase !== 'arm') return;
    _phase = 'fire';
    _fireAt = performance.now();
    document.getElementById('mg-neutral').textContent = 'DRAW!';
    sfx('react_go'); haptic([40]);
    // Nobody drew: scrub the round rather than waiting forever.
    _after(() => {
        if (_done || _phase !== 'fire' || _taps.length) return;
        _banner = 'NOBODY DREW!';
        document.getElementById('mg-neutral').textContent = 'NOBODY DREW — REDRAW!';
        _endRound(-1);
    }, DRAW_LIMIT * 1000);
}

function _tap(pid) {
    if (_done || _tapped[pid]) return;

    if (_phase === 'arm') {
        // JUMPED. At two players that hands the round straight to the other,
        // as it always has. Above two it cannot — the round is still live for
        // everybody who held their nerve — so the jumper is simply out of it,
        // and the round ends early only when there is nobody left to beat.
        _tapped[pid] = true;
        _jumped[pid] = true;
        sfx('land_bad'); haptic([80]);
        _banner = `${_nameOf(pid)} JUMPED!`;
        const left = _jumped.reduce((a, j) => a + (j ? 0 : 1), 0);
        if (left <= 1) {
            const survivor = _jumped.findIndex(j => !j);
            document.getElementById('mg-neutral').textContent =
                survivor >= 0 ? `${_nameOf(survivor)} HELD THEIR NERVE!` : 'EVERYBODY JUMPED!';
            _endRound(survivor);
        }
        return;
    }
    if (_phase !== 'fire') return;
    if (_jumped[pid]) return;          // you jumped; this round is not yours

    _tapped[pid] = true;
    _taps.push({ pid, t: performance.now() });
    if (_flushPending) return;
    _flushPending = true;
    _after(_resolveFire, TIE_WINDOW * 1000 + 5);
}

function _resolveFire() {
    if (_done || _phase !== 'fire') return;
    if (!_taps.length) return;                 // scrubbed by the draw limit
    const first = Math.min(..._taps.map(t => t.t));
    const winners = [...new Set(_taps.filter(t => t.t - first <= TIE_WINDOW * 1000).map(t => t.pid))];
    if (winners.length !== 1) {
        // Dead heat — replay the round, no score.
        _banner = 'DEAD HEAT!';
        _phase = 'over';
        document.getElementById('mg-neutral').textContent = 'DEAD HEAT — REDRAW!';
        _after(() => { if (!_done) _startRound(); }, 1200);
        return;
    }
    sfx('coin_gain'); haptic([30]);
    _banner = `${_nameOf(winners[0])} FASTEST!`;
    _endRound(winners[0]);
}

function _endRound(winnerId) {
    _phase = 'over';
    if (winnerId >= 0) _wins[winnerId]++;
    document.getElementById('mg-neutral').textContent = `${_banner}   ${_scoreLine()}`;

    _after(() => {
        if (_done) return;
        if (_wins.some(w => w >= WINS_NEEDED)) _finish();
        else { _round++; _startRound(); }
    }, 1300);
}

// ── Loop / draw ────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const now = performance.now();
    const dt  = _last === 0 ? 1/60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _t += dt;
    if (_t >= MATCH_TIME) {
        _finishOnScore();
        return;
    }
    _draw();
}

function _finishOnScore() {
    if (_done) return;
    const w = _leader();
    _done = true;
    state.mgActive = false;
    document.getElementById('mg-neutral').textContent =
        w < 0 ? `TIME — DRAW  ${_scoreLine()}` : `TIME — ${_nameOf(w)} WINS!  ${_scoreLine()}`;
    sfx(w < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(w); }, 1300);
}

/** The outright leader, or -1 if the top is shared. */
function _leader() {
    const best = Math.max(..._wins);
    const top = _wins.reduce((a, w, i) => (w === best ? a.concat(i) : a), []);
    return top.length === 1 ? top[0] : -1;
}

function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);
    if (!_zones.length) _zones = zonesFor(_n, w, h);

    _zones.forEach((z, pid) => {
        const r = z.rect;
        _ctx.save();
        if (z.rot === 180) {
            // Rotate about the zone's own centre so its content faces the
            // player sitting at that edge — the same trick the shipped
            // face-off does for the top half, per zone instead of per screen.
            _ctx.translate(r.x + r.w, r.y + r.h);
            _ctx.rotate(Math.PI);
        } else {
            _ctx.translate(r.x, r.y);
        }
        _drawZone(pid, r.w, r.h);
        _ctx.restore();
    });
}

const SLOT_ACCENT = ['#ff5a5a', '#5a9bff', '#5fd68a', '#ffd45f'];

function _drawZone(pid, w, h) {
    const accent = SLOT_ACCENT[pid] || '#ffffff';
    const pad = Math.min(w, h) * 0.08;
    const zx = pad, zy = pad, zw = w - pad * 2, zh = h - pad * 2;

    // Zone fill reflects phase.
    let fill, label;
    if (_phase === 'fire')      { fill = 'rgba(74,222,128,0.22)'; label = 'TAP!'; }
    else if (_phase === 'arm')  { const p = 0.10 + 0.05 * Math.sin(_t * 4); fill = `rgba(239,68,68,${p})`; label = 'WAIT…'; }
    else                        { fill = 'rgba(255,255,255,0.05)'; label = _tapped[pid] ? '✓' : ''; }
    if (_jumped[pid]) { fill = 'rgba(239,68,68,0.26)'; label = 'JUMPED'; }

    _roundRect(zx, zy, zw, zh, 18);
    _ctx.fillStyle = fill; _ctx.fill();
    _ctx.strokeStyle = _phase === 'fire' ? '#4ade80' : accent;
    _ctx.lineWidth = 3; _ctx.stroke();

    // Centre label
    _ctx.fillStyle = _phase === 'fire' ? '#4ade80' : 'rgba(255,255,255,0.8)';
    _ctx.font = '900 44px "Bebas Neue", sans-serif';
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.fillText(label, w / 2, h / 2);

    // Win pips (best of 3) + player tag
    _ctx.fillStyle = accent;
    _ctx.font = '700 18px Nunito, sans-serif';
    _ctx.textBaseline = 'alphabetic';
    _ctx.fillText(_nameOf(pid), w / 2, zy + 26);
    for (let i = 0; i < WINS_NEEDED; i++) {
        _ctx.beginPath();
        _ctx.arc(w / 2 - 12 + i * 24, zy + 44, 7, 0, Math.PI * 2);
        _ctx.fillStyle = i < _wins[pid] ? accent : 'rgba(255,255,255,0.18)';
        _ctx.fill();
    }

    if (_phase === 'over' && _banner) {
        _ctx.fillStyle = '#fbbf24';
        _ctx.font = '900 24px "Bebas Neue", sans-serif';
        _ctx.textAlign = 'center';
        _ctx.fillText(_banner, w / 2, zy + zh - 22);
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

// ── End / cleanup ─────────────────────────────────────────────────────────────
function _finish() {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const winner = _wins[0] > _wins[1] ? 0 : _wins[1] > _wins[0] ? 1 : -1;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent = winner < 0 ? 'DRAW!' : `${_nameOf(winner)} WINS!`;
    sfx(winner < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winner); }, 1400);
}

function _destroy() {
    _done = true;
    _phase = 'over';
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _t = 0;
}
