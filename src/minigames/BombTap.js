// Bomb Tap — Hot potato with an explosive twist.
// A bomb bounces between players — tap it to send it away.
// Its fuse burns faster the longer it's held. 5 explosions = loser.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_LOSSES = 5;
const BOMB_R     = 22;
const FUSE_MAX   = 100;
const FUSE_BURN  = 0.35;
const TAP_FORCE  = 11;
const GRAVITY    = 0.28;
const BOUNCE     = 0.68;

let _done = false, _losses = [0, 0], _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null;
let _bomb = null, _fuse = 0, _scoring = false;
let _scoreEls = [null, null], _neutralEl = null;
let _resetTimer = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _losses = [0, 0]; _onWin = onWin; _isBot = isBot;
    _scoring = false; _cleanups.length = 0;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        _resetBomb();
        if (_neutralEl) _neutralEl.textContent = 'TAP THE BOMB AWAY!';
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#1a0a0a;';
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;align-items:flex-start;padding:6px 14px;box-sizing:border-box;';
    _scoreEls[1] = _mkLabel('P2: 0 losses', '#93c5fd');
    _scoreEls[0] = _mkLabel('P1: 0 losses', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:0.9rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 10px ${color};`;
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

    const onTap = e => {
        e.preventDefault();
        if (_done || _scoring || !_bomb) return;
        const cr = _canvas.getBoundingClientRect();
        const tx = e.clientX - cr.left;
        const ty = e.clientY - cr.top;
        if (Math.hypot(tx - _bomb.x, ty - _bomb.y) > BOMB_R + 35) return;
        const angle = Math.atan2(ty - _bomb.y, tx - _bomb.x);
        _bomb.vx += Math.cos(angle) * TAP_FORCE;
        _bomb.vy += Math.sin(angle) * TAP_FORCE;
        _fuse = Math.min(FUSE_MAX, _fuse + 8);
        sfx('land_good');
    };
    _canvas.addEventListener('pointerdown', onTap);
    _cleanups.push(() => _canvas.removeEventListener('pointerdown', onTap));
}

function _resetBomb() {
    _scoring = false;
    _bomb = {
        x: _W / 2, y: _H / 2,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4,
    };
    _fuse = 0;
    if (_neutralEl) _neutralEl.textContent = 'TAP THE BOMB AWAY!';
}

function _tick() {
    if (_done || !state.mgActive) return;

    _bomb.vy += GRAVITY;
    _bomb.x  += _bomb.vx;
    _bomb.y  += _bomb.vy;
    _fuse    += FUSE_BURN;

    if (_bomb.x - BOMB_R < 0)  { _bomb.x = BOMB_R;      _bomb.vx = Math.abs(_bomb.vx) * BOUNCE; }
    if (_bomb.x + BOMB_R > _W) { _bomb.x = _W - BOMB_R; _bomb.vx = -Math.abs(_bomb.vx) * BOUNCE; }

    // Bot logic: if bomb is in top half, tap it downward
    if (_isBot && !_scoring && _bomb.y < _H / 2 && Math.random() < 0.035) {
        const angle = Math.atan2(_bomb.y - (_H * 0.12), _bomb.x - _W / 2);
        _bomb.vx += Math.cos(angle) * TAP_FORCE * 0.7;
        _bomb.vy += Math.sin(angle) * TAP_FORCE * 0.7;
        _fuse = Math.min(FUSE_MAX, _fuse + 8);
        sfx('land_good');
    }

    // Fuse expired — explode at current position
    if (_fuse >= FUSE_MAX && !_scoring) {
        const loser = _bomb.y > _H / 2 ? 0 : 1;
        _hitPlayer(loser);
        return;
    }

    // Exiting top/bottom = explode on that player's side
    if (!_scoring) {
        if (_bomb.y + BOMB_R > _H) { _hitPlayer(0); return; }
        if (_bomb.y - BOMB_R < 0)  { _hitPlayer(1); return; }
    }

    _draw();
    _af = requestAnimationFrame(_tick);
}

function _hitPlayer(loser) {
    if (_scoring) return;
    _scoring = true;
    sfx('land_bad');
    _losses[loser]++;
    if (_scoreEls[loser]) _scoreEls[loser].textContent = `P${loser + 1}: ${_losses[loser]} losses`;
    if (_neutralEl) _neutralEl.textContent = `💥 P${loser + 1} EXPLODED!`;

    if (_losses[loser] >= WIN_LOSSES) {
        _done = true; state.mgActive = false;
        cancelAnimationFrame(_af); _af = null;
        const winner = 1 - loser;
        if (_neutralEl) _neutralEl.textContent = `P${winner + 1} WINS! No more explosions!`;
        setTimeout(() => { _destroy(); _onWin(winner); }, 1500);
        return;
    }
    _resetTimer = setTimeout(() => { if (!_done && state.mgActive) _resetBomb(); }, 1200);
    _draw();
    _af = requestAnimationFrame(_tick);
}

function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    const dangerAlpha = (_fuse / FUSE_MAX) * 0.12;
    _ctx.fillStyle = `rgba(255,0,0,${dangerAlpha})`;
    _ctx.fillRect(0, 0, _W, _H * 0.3);
    _ctx.fillRect(0, _H * 0.7, _W, _H * 0.3);

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.08)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Fuse ring
    const fuseColor = `hsl(${(1 - _fuse / FUSE_MAX) * 60}, 100%, 50%)`;
    _ctx.strokeStyle = fuseColor; _ctx.lineWidth = 4;
    _ctx.beginPath();
    _ctx.arc(_bomb.x, _bomb.y, BOMB_R + 6, -Math.PI/2, -Math.PI/2 + (1 - _fuse/FUSE_MAX) * Math.PI * 2);
    _ctx.stroke();

    // Bomb body
    _ctx.fillStyle = '#1a1a1a';
    _ctx.beginPath(); _ctx.arc(_bomb.x, _bomb.y, BOMB_R, 0, Math.PI * 2); _ctx.fill();
    _ctx.strokeStyle = '#333'; _ctx.lineWidth = 2;
    _ctx.stroke();

    // Fuse spark
    if (_fuse > 0) {
        _ctx.fillStyle = '#ff6600'; _ctx.shadowColor = '#ff6600'; _ctx.shadowBlur = 10 + _fuse * 0.15;
        _ctx.beginPath(); _ctx.arc(_bomb.x, _bomb.y - BOMB_R - 2, 5, 0, Math.PI * 2); _ctx.fill();
        _ctx.shadowBlur = 0;
    }
}

function _destroy() {
    clearTimeout(_resetTimer); _resetTimer = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}
