// Rocket Relic — Pick up the relic and carry it to the opponent's goal zone.
// You're slower while carrying. Opponent touches you = you drop it. First to 3 scores.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_SCORE  = 3;
const AVATAR_R   = 22;
const RELIC_R    = 16;
const GOAL_H     = 36;
const CARRY_SLOW = 0.55;
const TACKLE_R   = 40;

let _done = false, _scores = [0, 0], _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null;
let _avatars = [], _relic = null;
let _scoreEls = [null, null], _neutralEl = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        _spawnRelic();
        if (_neutralEl) _neutralEl.textContent = 'GRAB THE RELIC & SCORE!';
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0e0a1e;';
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

function _spawnRelic() {
    _relic = {
        x: _W / 2 + (Math.random() - 0.5) * _W * 0.3,
        y: _H / 2 + (Math.random() - 0.5) * _H * 0.1,
        carriedBy: -1,
    };
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
        const carrying = _relic.carriedBy === pid;
        const slowFactor = carrying ? CARRY_SLOW : 1;
        // Smooth movement toward pointer
        _avatars[pid].x += (Math.max(AVATAR_R, Math.min(_W - AVATAR_R, cx)) - _avatars[pid].x) * 0.35 * slowFactor;
        _avatars[pid].y += (Math.max(AVATAR_R, Math.min(_H - AVATAR_R, cy)) - _avatars[pid].y) * 0.35 * slowFactor;
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

function _tick() {
    if (_done || !state.mgActive) return;

    // Bot AI
    if (_isBot) {
        const bot = _avatars[1];
        let tx, ty;
        if (_relic.carriedBy === 0) {
            // Chase carrier to tackle
            tx = _avatars[0].x; ty = _avatars[0].y;
        } else if (_relic.carriedBy === 1) {
            // Carry to P1's goal (bottom)
            tx = _W / 2; ty = _H - GOAL_H / 2;
        } else {
            // Go for relic
            tx = _relic.x; ty = _relic.y;
        }
        const slow = _relic.carriedBy === 1 ? CARRY_SLOW : 1;
        bot.x += (tx - bot.x) * 0.13 * slow;
        bot.y += (ty - bot.y) * 0.13 * slow;
    }

    // Relic follows carrier
    if (_relic.carriedBy >= 0) {
        _relic.x = _avatars[_relic.carriedBy].x;
        _relic.y = _avatars[_relic.carriedBy].y;
    }

    // Pick up
    if (_relic.carriedBy < 0) {
        for (const av of _avatars) {
            if (Math.hypot(av.x - _relic.x, av.y - _relic.y) < AVATAR_R + RELIC_R) {
                _relic.carriedBy = av.pid;
                sfx('land_good');
                if (_neutralEl) _neutralEl.textContent = `P${av.pid + 1} HAS THE RELIC!`;
                break;
            }
        }
    }

    // Tackle check
    if (_relic.carriedBy >= 0) {
        const carrier  = _avatars[_relic.carriedBy];
        const tackler  = _avatars[1 - _relic.carriedBy];
        if (Math.hypot(carrier.x - tackler.x, carrier.y - tackler.y) < TACKLE_R) {
            _relic.x = carrier.x; _relic.y = carrier.y;
            _relic.carriedBy = -1;
            sfx('land_bad');
            if (_neutralEl) _neutralEl.textContent = 'TACKLED! RELIC DROPPED!';
        }
    }

    // Goal scoring — carrier must reach OPPONENT's goal zone
    if (_relic.carriedBy >= 0) {
        const carrier = _avatars[_relic.carriedBy];
        const opponentGoalZone = _relic.carriedBy === 0 ? carrier.y < GOAL_H : carrier.y > _H - GOAL_H;
        if (opponentGoalZone) {
            _doScore(_relic.carriedBy);
            return;
        }
    }

    _draw();
    _af = requestAnimationFrame(_tick);
}

function _doScore(pid) {
    _scores[pid]++;
    if (_scoreEls[pid]) _scoreEls[pid].textContent = `P${pid + 1}: ${_scores[pid]}`;
    sfx('mg_start');
    if (_scores[pid] >= WIN_SCORE) {
        _done = true; state.mgActive = false;
        cancelAnimationFrame(_af); _af = null;
        if (_neutralEl) _neutralEl.textContent = `P${pid + 1} WINS!`;
        setTimeout(() => { _destroy(); _onWin(pid); }, 1500);
        return;
    }
    if (_neutralEl) _neutralEl.textContent = `P${pid + 1} SCORES! ${_scores[0]}–${_scores[1]}`;
    _relic.carriedBy = -1;
    _spawnRelic();
    _af = requestAnimationFrame(_tick);
}

function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    // Goal zones
    _ctx.fillStyle = 'rgba(255,59,59,0.15)';
    _ctx.fillRect(0, _H - GOAL_H, _W, GOAL_H);
    _ctx.fillStyle = 'rgba(59,130,255,0.15)';
    _ctx.fillRect(0, 0, _W, GOAL_H);

    _ctx.font = 'bold 9px sans-serif'; _ctx.textAlign = 'center';
    _ctx.fillStyle = 'rgba(255,59,59,0.5)';  _ctx.fillText('P1 GOAL', _W/2, _H - 5);
    _ctx.fillStyle = 'rgba(59,130,255,0.5)'; _ctx.fillText('P2 GOAL', _W/2, 12);

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.07)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Relic
    if (_relic.carriedBy < 0) {
        _ctx.fillStyle = '#cc88ff'; _ctx.shadowColor = '#cc88ff'; _ctx.shadowBlur = 20;
        _ctx.beginPath(); _ctx.arc(_relic.x, _relic.y, RELIC_R, 0, Math.PI * 2); _ctx.fill();
        // Relic star
        _ctx.fillStyle = '#fff';
        _ctx.font = '18px sans-serif'; _ctx.textAlign = 'center';
        _ctx.fillText('✦', _relic.x, _relic.y + 6);
        _ctx.shadowBlur = 0;
    }

    // Avatars
    const colors = ['#ff3b3b', '#3b8eff'];
    for (const av of _avatars) {
        _ctx.fillStyle = colors[av.pid]; _ctx.shadowColor = colors[av.pid]; _ctx.shadowBlur = 18;
        _ctx.beginPath(); _ctx.arc(av.x, av.y, AVATAR_R, 0, Math.PI * 2); _ctx.fill();
        _ctx.shadowBlur = 0;
        if (_relic.carriedBy === av.pid) {
            _ctx.fillStyle = '#cc88ff'; _ctx.shadowColor = '#cc88ff'; _ctx.shadowBlur = 14;
            _ctx.font = '18px sans-serif'; _ctx.textAlign = 'center';
            _ctx.fillText('✦', av.x, av.y - AVATAR_R - 2);
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
