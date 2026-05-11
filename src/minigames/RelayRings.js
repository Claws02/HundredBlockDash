// Relay Rings — Tap the glowing ring on your half before it fades.
// A new ring appears after each tap. Miss = 1.5s penalty.
// First to collect 12 rings wins the round. Best of 3 rounds.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const TARGET_RINGS  = 12;
const WIN_ROUNDS    = 2;
const RING_LIFETIME = 2200;
const RING_R        = 28;
const MISS_PENALTY  = 1500;
const TAP_RADIUS    = 44;

let _done = false, _wins = [0, 0], _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null;
let _rings = [null, null];         // one ring per player
let _ringAppeared = [0, 0];        // timestamp ring appeared
let _counts = [0, 0];              // rings collected this round
let _penaltyUntil = [0, 0];
let _roundActive = false;
let _winsEls = [null, null], _neutralEl = null;
let _botRingInterval = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    _done = false; _wins = [0, 0]; _onWin = onWin; _isBot = isBot;
    _rings = [null, null]; _ringAppeared = [0, 0]; _penaltyUntil = [0, 0];
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        _startRound();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0a0a0a;';
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;align-items:flex-start;padding:6px 14px;box-sizing:border-box;';
    _winsEls[1] = _mkLabel('P2: 0/2 wins', '#93c5fd');
    _winsEls[0] = _mkLabel('P1: 0/2 wins', '#fca5a5');
    hud.appendChild(_winsEls[1]);
    hud.appendChild(_winsEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:0.85rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 8px ${color};`;
    el.textContent = text;
    return el;
}

function _spawnRing(pid, now) {
    const margin = RING_R + 20;
    const minY = pid === 0 ? _H / 2 + margin : margin;
    const maxY = pid === 0 ? _H - margin     : _H / 2 - margin;
    _rings[pid] = {
        x: margin + Math.random() * (_W - margin * 2),
        y: minY  + Math.random() * (maxY - minY),
    };
    _ringAppeared[pid] = now;
}

function _startRound() {
    _counts = [0, 0]; _penaltyUntil = [0, 0]; _rings = [null, null];
    _roundActive = true;
    if (_neutralEl) _neutralEl.textContent = 'TAP THE RINGS!';
}

function _setup() {
    const r = _canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    _W = r.width; _H = r.height;
    _canvas.width  = Math.round(_W * dpr);
    _canvas.height = Math.round(_H * dpr);
    _ctx = _canvas.getContext('2d');
    _ctx.scale(dpr, dpr);

    const onTap = e => {
        e.preventDefault();
        if (!_roundActive || _done) return;
        const cr   = _canvas.getBoundingClientRect();
        const tx   = e.clientX - cr.left;
        const ty   = e.clientY - cr.top;
        const pid  = ty > _H / 2 ? 0 : 1;
        if (_isBot && pid === 1) return;
        _tryTap(tx, ty, pid, performance.now());
    };
    _canvas.addEventListener('pointerdown', onTap);
    _cleanups.push(() => _canvas.removeEventListener('pointerdown', onTap));

    if (_isBot) {
        _botRingInterval = setInterval(() => {
            if (!_roundActive || _done || !state.mgActive) return;
            const now = performance.now();
            if (now < _penaltyUntil[1] || !_rings[1]) return;
            if (Math.random() < 0.85) {
                _collectRing(1, now);
            }
        }, 500 + Math.random() * 300);
        _cleanups.push(() => { clearInterval(_botRingInterval); _botRingInterval = null; });
    }
}

function _tryTap(tx, ty, pid, now) {
    if (now < _penaltyUntil[pid] || !_rings[pid]) return;
    if (Math.hypot(tx - _rings[pid].x, ty - _rings[pid].y) < TAP_RADIUS) {
        _collectRing(pid, now);
    }
}

function _collectRing(pid, now) {
    _counts[pid]++;
    _rings[pid] = null;
    sfx('coin_gain');
    if (_counts[pid] >= TARGET_RINGS) { _roundWin(pid); return; }
    setTimeout(() => { if (_roundActive && !_done) _spawnRing(pid, performance.now()); }, 80);
}

function _tick(now) {
    if (_done || !state.mgActive) return;

    // Spawn rings if needed
    for (let pid = 0; pid < 2; pid++) {
        if (!_rings[pid] && now >= _penaltyUntil[pid] && _roundActive) _spawnRing(pid, now);
    }

    // Check ring expiry
    for (let pid = 0; pid < 2; pid++) {
        if (_rings[pid] && now - _ringAppeared[pid] > RING_LIFETIME) {
            _rings[pid] = null;
            _penaltyUntil[pid] = now + MISS_PENALTY;
            sfx('land_bad');
        }
    }

    _draw(now);
    _af = requestAnimationFrame(_tick);
}

function _roundWin(pid) {
    _roundActive = false;
    _wins[pid]++;
    if (_winsEls[pid]) _winsEls[pid].textContent = `P${pid + 1}: ${_wins[pid]}/2 wins`;
    sfx('mg_start');

    if (_wins[pid] >= WIN_ROUNDS) {
        _done = true; state.mgActive = false;
        cancelAnimationFrame(_af); _af = null;
        if (_neutralEl) _neutralEl.textContent = `P${pid + 1} WINS THE RELAY!`;
        setTimeout(() => { _destroy(); _onWin(pid); }, 1500);
        return;
    }
    if (_neutralEl) _neutralEl.textContent = `P${pid + 1} TAKES ROUND ${_wins[0]+_wins[1]}!`;
    setTimeout(() => { if (!_done && state.mgActive) _startRound(); }, 1500);
}

function _draw(now) {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.08)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Progress bars
    const colors = ['#fca5a5', '#93c5fd'];
    for (let pid = 0; pid < 2; pid++) {
        const progress = _counts[pid] / TARGET_RINGS;
        const y = pid === 0 ? _H * 0.96 : _H * 0.04;
        _ctx.fillStyle = 'rgba(255,255,255,0.08)';
        _ctx.fillRect(_W * 0.05, y - 4, _W * 0.9, 8);
        _ctx.fillStyle = colors[pid];
        _ctx.fillRect(_W * 0.05, y - 4, _W * 0.9 * progress, 8);

        // Count label
        _ctx.font = 'bold 11px sans-serif'; _ctx.textAlign = 'right';
        _ctx.fillStyle = colors[pid];
        _ctx.fillText(`${_counts[pid]}/${TARGET_RINGS}`, _W * 0.95, pid === 0 ? _H * 0.94 : _H * 0.1);
    }

    // Rings
    for (let pid = 0; pid < 2; pid++) {
        const ring = _rings[pid];
        if (!ring) {
            // Penalty indicator
            if (now < _penaltyUntil[pid]) {
                const py = pid === 0 ? _H * 0.75 : _H * 0.25;
                _ctx.fillStyle = 'rgba(255,100,100,0.6)';
                _ctx.font = 'bold 14px sans-serif'; _ctx.textAlign = 'center';
                _ctx.fillText('MISS!', _W/2, py);
            }
            continue;
        }
        const age   = now - _ringAppeared[pid];
        const life  = 1 - age / RING_LIFETIME;
        const pulse = 0.85 + 0.15 * Math.sin(now / 120);
        const ringColor = pid === 0 ? '#ff3b3b' : '#3b8eff';
        _ctx.strokeStyle = `rgba(${pid===0?'255,59,59':'59,130,255'},${life})`;
        _ctx.lineWidth = 4;
        _ctx.shadowColor = ringColor; _ctx.shadowBlur = 20 * life;
        _ctx.beginPath(); _ctx.arc(ring.x, ring.y, RING_R * pulse, 0, Math.PI * 2); _ctx.stroke();
        _ctx.shadowBlur = 0;
        _ctx.strokeStyle = `rgba(255,255,255,${life * 0.4})`;
        _ctx.lineWidth = 1;
        _ctx.beginPath(); _ctx.arc(ring.x, ring.y, RING_R * pulse * 1.4, 0, Math.PI * 2); _ctx.stroke();
    }
}

function _destroy() {
    clearInterval(_botRingInterval); _botRingInterval = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _winsEls = [null, null];
}

export function destroy() { _done = true; cancelAnimationFrame(_af); _af = null; _cleanups.forEach(f => f()); _cleanups.length = 0; }
