// Crown Grab — Move your avatar to grab the crown. Hold it on your side to score.
// Opponent steals by touching you while you carry. First to hold 3 times wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_SCORE   = 3;
const AVATAR_R    = 22;
const CROWN_R     = 18;
const HOLD_MS     = 3000;
const STEAL_R     = 38;

let _done = false, _scores = [0, 0], _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null;
let _avatars = [], _crown = null;
let _holdStart = -1, _scoreEls = [null, null], _neutralEl = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    _done = false; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _holdStart = -1;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'GRAB THE CROWN & HOLD IT!';
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#12100a;';
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;align-items:flex-start;padding:6px 14px;box-sizing:border-box;';
    _scoreEls[1] = _mkLabel('P2: 0', '#93c5fd');
    _scoreEls[0] = _mkLabel('P1: 0', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:1.2rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 10px ${color};`;
    el.textContent = text;
    return el;
}

function _setup() {
    const r = _canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    _W = r.width; _H = r.height;
    _canvas.width  = Math.round(_W * dpr);
    _canvas.height = Math.round(_H * dpr);
    _ctx = _canvas.getContext('2d');
    _ctx.scale(dpr, dpr);

    _avatars = [
        { x: _W / 2, y: _H * 0.78, pid: 0 },
        { x: _W / 2, y: _H * 0.22, pid: 1 },
    ];
    _crown = { x: _W / 2, y: _H / 2, carriedBy: -1 };

    const pointerPid = new Map();
    const onDown = e => {
        e.preventDefault();
        const cr = _canvas.getBoundingClientRect();
        const pid = (e.clientY - cr.top) > _H / 2 ? 0 : 1;
        pointerPid.set(e.pointerId, pid);
    };
    const onMove = e => {
        e.preventDefault();
        const pid = pointerPid.get(e.pointerId);
        if (pid === undefined || (_isBot && pid === 1)) return;
        const cr = _canvas.getBoundingClientRect();
        const cx = e.clientX - cr.left;
        const cy = e.clientY - cr.top;
        _avatars[pid].x = Math.max(AVATAR_R, Math.min(_W - AVATAR_R, cx));
        const minY = pid === 0 ? _H / 2 + AVATAR_R : AVATAR_R;
        const maxY = pid === 0 ? _H - AVATAR_R     : _H / 2 - AVATAR_R;
        _avatars[pid].y = Math.max(minY, Math.min(maxY, cy));
    };
    const onUp = e => pointerPid.delete(e.pointerId);
    _canvas.addEventListener('pointerdown',   onDown);
    _canvas.addEventListener('pointermove',   onMove);
    _canvas.addEventListener('pointerup',     onUp);
    _canvas.addEventListener('pointercancel', onUp);
    _cleanups.push(() => {
        _canvas.removeEventListener('pointerdown',   onDown);
        _canvas.removeEventListener('pointermove',   onMove);
        _canvas.removeEventListener('pointerup',     onUp);
        _canvas.removeEventListener('pointercancel', onUp);
    });
}

function _tick(now) {
    if (_done || !state.mgActive) return;

    // Bot chases crown or opponent carrier
    if (_isBot) {
        const bot = _avatars[1];
        let tx = _crown.carriedBy === 1 ? _W / 2 : _crown.x;
        let ty = _crown.carriedBy === 1 ? _H * 0.14 : _crown.y;
        if (_crown.carriedBy === 0) { tx = _avatars[0].x; ty = _avatars[0].y; }
        bot.x += (tx - bot.x) * 0.12;
        bot.y += (ty - bot.y) * 0.12;
    }

    // Crown follows carrier
    if (_crown.carriedBy >= 0) {
        _crown.x = _avatars[_crown.carriedBy].x;
        _crown.y = _avatars[_crown.carriedBy].y;
    }

    // Pick up crown (must not be carried)
    if (_crown.carriedBy < 0) {
        for (const av of _avatars) {
            if (Math.hypot(av.x - _crown.x, av.y - _crown.y) < AVATAR_R + CROWN_R) {
                _crown.carriedBy = av.pid;
                _holdStart = now;
                sfx('land_good');
                break;
            }
        }
    }

    // Steal
    if (_crown.carriedBy >= 0) {
        const carrier   = _avatars[_crown.carriedBy];
        const opponent  = _avatars[1 - _crown.carriedBy];
        if (Math.hypot(carrier.x - opponent.x, carrier.y - opponent.y) < STEAL_R) {
            _crown.carriedBy = -1;
            _holdStart = -1;
            _crown.x = carrier.x; _crown.y = carrier.y;
            sfx('land_bad');
            if (_neutralEl) _neutralEl.textContent = 'STOLEN!';
        }
    }

    // Check hold scoring — must be carrying on YOUR side
    if (_crown.carriedBy >= 0) {
        const carrier = _avatars[_crown.carriedBy];
        const onOwnSide = _crown.carriedBy === 0 ? carrier.y > _H / 2 : carrier.y < _H / 2;
        if (!onOwnSide) {
            _holdStart = -1;
        } else if (_holdStart < 0) {
            _holdStart = now; // restart timer when re-entering own side
        } else if (now - _holdStart >= HOLD_MS) {
            _doScore(_crown.carriedBy);
        } else {
            const prog = (now - _holdStart) / HOLD_MS;
            if (_neutralEl) _neutralEl.textContent = `P${_crown.carriedBy + 1} holding… ${Math.ceil((1 - prog) * (HOLD_MS / 1000))}s`;
        }
    }

    _draw(now);
    _af = requestAnimationFrame(_tick);
}

function _doScore(pid) {
    _scores[pid]++;
    if (_scoreEls[pid]) _scoreEls[pid].textContent = `P${pid + 1}: ${_scores[pid]}`;
    sfx('mg_start');
    _crown.carriedBy = -1; _holdStart = -1;
    _crown.x = _W / 2 + (Math.random() - 0.5) * _W * 0.3;
    _crown.y = _H / 2 + (Math.random() - 0.5) * _H * 0.15;

    if (_scores[pid] >= WIN_SCORE) {
        _done = true; state.mgActive = false;
        cancelAnimationFrame(_af); _af = null;
        if (_neutralEl) _neutralEl.textContent = `P${pid + 1} WINS THE CROWN!`;
        setTimeout(() => { _destroy(); _onWin(pid); }, 1500);
        return;
    }
    if (_neutralEl) _neutralEl.textContent = `P${pid + 1} SCORES! ${_scores[0]}–${_scores[1]}`;
}

function _draw(now) {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    // Hold meter
    if (_crown.carriedBy >= 0 && _holdStart >= 0) {
        const prog = Math.min(1, (now - _holdStart) / HOLD_MS);
        const pid  = _crown.carriedBy;
        _ctx.fillStyle = pid === 0 ? 'rgba(255,59,59,0.18)' : 'rgba(59,130,255,0.18)';
        _ctx.fillRect(0, pid === 0 ? _H/2 : 0, _W * prog, _H / 2);
    }

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.08)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Crown
    if (_crown.carriedBy < 0) {
        _ctx.fillStyle = '#ffd700'; _ctx.shadowColor = '#ffd700'; _ctx.shadowBlur = 22;
        _ctx.font = `${CROWN_R * 2}px sans-serif`; _ctx.textAlign = 'center';
        _ctx.fillText('👑', _crown.x, _crown.y + CROWN_R * 0.6);
        _ctx.shadowBlur = 0;
    }

    // Avatars
    const colors = ['#ff3b3b', '#3b8eff'];
    for (const av of _avatars) {
        _ctx.fillStyle = colors[av.pid]; _ctx.shadowColor = colors[av.pid]; _ctx.shadowBlur = 18;
        _ctx.beginPath(); _ctx.arc(av.x, av.y, AVATAR_R, 0, Math.PI * 2); _ctx.fill();
        _ctx.shadowBlur = 0;
        if (_crown.carriedBy === av.pid) {
            _ctx.fillStyle = '#ffd700'; _ctx.shadowColor = '#ffd700'; _ctx.shadowBlur = 16;
            _ctx.font = '22px sans-serif'; _ctx.textAlign = 'center';
            _ctx.fillText('👑', av.x, av.y - AVATAR_R - 2);
            _ctx.shadowBlur = 0;
        }
    }
}

function _destroy() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}

export function destroy() { _done = true; cancelAnimationFrame(_af); _af = null; _cleanups.forEach(f => f()); _cleanups.length = 0; }
