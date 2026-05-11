// Volley Zap — Hit the spark ball back to your opponent. Each hit charges it.
// At 5 charges, it becomes supercharged — a miss costs an extra point.
// Tap anywhere on your half to return. Miss = opponent scores. First to 7 wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_SCORE   = 7;
const BALL_R      = 12;
const BASE_SPEED  = 7;
const SPEED_INC   = 0.4;
const SUPER_CHARGE = 5;

let _done = false, _scores = [0, 0], _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null;
let _ball = null, _charge = 0, _scoring = false;
let _tapFlash = [0, 0];
let _scoreEls = [null, null], _neutralEl = null;
let _resetTimer = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _charge = 0; _scoring = false; _tapFlash = [0, 0]; _cleanups.length = 0;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        _resetBall();
        if (_neutralEl) _neutralEl.textContent = 'TAP TO RETURN THE ZAP!';
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0a0a1e;';
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

function _resetBall() {
    _scoring = false;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const spd = BASE_SPEED + _charge * SPEED_INC;
    _ball = {
        x: _W / 2, y: _H / 2,
        vx: (Math.random() - 0.5) * 4,
        vy: dir * spd,
    };
    if (_neutralEl) _neutralEl.textContent = 'TAP TO RETURN THE ZAP!';
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
        if (_done || _scoring) return;
        const cr = _canvas.getBoundingClientRect();
        const pid = (e.clientY - cr.top) > _H / 2 ? 0 : 1;
        _tryReturn(pid);
    };
    _canvas.addEventListener('pointerdown', onTap);
    _cleanups.push(() => _canvas.removeEventListener('pointerdown', onTap));
}

function _tryReturn(pid) {
    // Ball must be in your half and moving toward your edge
    const inMyHalf = pid === 0 ? _ball.y > _H / 2 : _ball.y < _H / 2;
    const comingAtMe = pid === 0 ? _ball.vy > 0 : _ball.vy < 0;
    if (!inMyHalf || !comingAtMe) return;

    _charge++;
    _tapFlash[pid] = performance.now();
    const spd = BASE_SPEED + _charge * SPEED_INC;
    const dir = pid === 0 ? -1 : 1;
    _ball.vx += (Math.random() - 0.5) * 3;
    _ball.vy  = dir * spd;
    sfx('land_good');
    if (_charge >= SUPER_CHARGE && _neutralEl) _neutralEl.textContent = '⚡ SUPERCHARGED! ⚡';
}

function _tick(now) {
    if (_done || !state.mgActive) return;

    if (!_scoring) {
        _ball.x += _ball.vx;
        _ball.y += _ball.vy;

        // Wall bounce
        if (_ball.x - BALL_R < 0)  { _ball.x = BALL_R;      _ball.vx = Math.abs(_ball.vx); }
        if (_ball.x + BALL_R > _W) { _ball.x = _W - BALL_R; _ball.vx = -Math.abs(_ball.vx); }

        // Bot: tap when ball is in P2 half and coming at P2
        if (_isBot && _ball.y < _H / 2 && _ball.vy < 0 && Math.random() < 0.06) {
            _tryReturn(1);
        }

        // Miss detection
        if (_ball.y + BALL_R > _H) {
            _doScore(1); return; // P2 scores (P1 missed)
        } else if (_ball.y - BALL_R < 0) {
            _doScore(0); return; // P1 scores (P2 missed)
        }
    }

    _draw(now);
    _af = requestAnimationFrame(_tick);
}

function _doScore(scoringPid) {
    if (_scoring) return;
    _scoring = true;
    const multi = _charge >= SUPER_CHARGE ? 2 : 1;
    _scores[scoringPid] += multi;
    if (_scoreEls[scoringPid]) _scoreEls[scoringPid].textContent = `P${scoringPid + 1}: ${_scores[scoringPid]}`;
    sfx(multi > 1 ? 'mg_start' : 'coin_gain');
    _charge = 0;
    const msg = multi > 1 ? `⚡ P${scoringPid + 1} SUPER SCORES! +2` : `P${scoringPid + 1} SCORES! ${_scores[0]}–${_scores[1]}`;
    if (_neutralEl) _neutralEl.textContent = msg;
    if (_scores[scoringPid] >= WIN_SCORE) {
        _done = true; state.mgActive = false;
        cancelAnimationFrame(_af); _af = null;
        setTimeout(() => { _destroy(); _onWin(scoringPid); }, 1500);
        return;
    }
    _resetTimer = setTimeout(() => { if (!_done && state.mgActive) _resetBall(); }, 1400);
}

function _draw(now) {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    // Tap flash zones
    const flashColors = ['rgba(255,59,59,', 'rgba(59,130,255,'];
    for (let pid = 0; pid < 2; pid++) {
        const age = now - _tapFlash[pid];
        if (age < 200) {
            _ctx.fillStyle = flashColors[pid] + (0.15 * (1 - age / 200)) + ')';
            _ctx.fillRect(0, pid === 0 ? _H/2 : 0, _W, _H/2);
        }
    }

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.08)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Charge indicator bar
    if (_charge > 0) {
        const prog = Math.min(1, _charge / SUPER_CHARGE);
        const barColor = _charge >= SUPER_CHARGE ? '#ffff00' : '#aa88ff';
        _ctx.fillStyle = `rgba(${_charge >= SUPER_CHARGE ? '255,255,0' : '160,100,255'},0.15)`;
        _ctx.fillRect(0, _H/2 - 3, _W * prog, 6);
        _ctx.fillStyle = barColor;
        _ctx.fillRect(0, _H/2 - 2, _W * prog, 4);
    }

    // Ball
    const isSuper = _charge >= SUPER_CHARGE;
    const ballColor = isSuper ? '#ffff44' : '#cc88ff';
    _ctx.fillStyle = ballColor; _ctx.shadowColor = ballColor;
    _ctx.shadowBlur = isSuper ? 30 : 18;
    _ctx.beginPath(); _ctx.arc(_ball.x, _ball.y, BALL_R + (isSuper ? 4 : 0), 0, Math.PI * 2); _ctx.fill();
    _ctx.shadowBlur = 0;
}

function _destroy() {
    clearTimeout(_resetTimer); _resetTimer = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}
