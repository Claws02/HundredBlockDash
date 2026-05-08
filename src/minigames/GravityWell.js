// Gravity Well — Tap and drag to create gravity fields that pull the ball.
// Guide the ball into the opponent's goal zone (top/bottom edge) to score.
// P1 controls bottom half, P2 controls top half. First to 5 points wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_SCORE       = 5;
const BALL_R          = 12;
const GRAVITY_STR     = 0.55;
const MAX_WELLS       = 3;
const WELL_LIFETIME   = 4000;
const FRICTION        = 0.993;
const GOAL_ZONE_H     = 18;

let _done = false, _scores = [0, 0], _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null;
let _ball = null, _wells = [[], []];
let _scoring = false;
let _scoreEls = [null, null], _neutralEl = null;
let _botInterval = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _wells = [[], []]; _scoring = false;
    _neutralEl = document.getElementById('mg-neutral');

    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'DRAW GRAVITY WELLS TO GUIDE THE BALL!';
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0f0f2e;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);

    const hud = document.createElement('div');
    hud.style.cssText = `
        position:absolute;inset:0;pointer-events:none;
        display:flex;justify-content:space-between;align-items:center;
        padding:6px 14px;box-sizing:border-box;
    `;
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

    _resetBall();

    // Track drag start position to size the well
    const drags = new Map(); // pointerId → {pid, startX, startY}

    const onDown = e => {
        e.preventDefault();
        const cr = _canvas.getBoundingClientRect();
        const cx = e.clientX - cr.left, cy = e.clientY - cr.top;
        const pid = cy > _H / 2 ? 0 : 1;
        drags.set(e.pointerId, { pid, startX: cx, startY: cy });
    };
    const onUp = e => {
        e.preventDefault();
        if (!drags.has(e.pointerId)) return;
        const { pid, startX, startY } = drags.get(e.pointerId);
        drags.delete(e.pointerId);
        if (_done || _scoring || _wells[pid].length >= MAX_WELLS) return;
        const cr   = _canvas.getBoundingClientRect();
        const endX = e.clientX - cr.left, endY = e.clientY - cr.top;
        const dist = Math.hypot(endX - startX, endY - startY);
        if (dist > 10) {
            _wells[pid].push({
                x:        (startX + endX) / 2,
                y:        (startY + endY) / 2,
                radius:   Math.min(Math.max(dist, 25), 90),
                strength: Math.min(dist / 80, 1.5),
                created:  performance.now(),
            });
            sfx('land_good');
        }
    };
    const onCancel = e => drags.delete(e.pointerId);

    _canvas.addEventListener('pointerdown',  onDown);
    _canvas.addEventListener('pointerup',    onUp);
    _canvas.addEventListener('pointercancel', onCancel);
    _cleanups.push(() => {
        _canvas.removeEventListener('pointerdown',  onDown);
        _canvas.removeEventListener('pointerup',    onUp);
        _canvas.removeEventListener('pointercancel', onCancel);
    });

    if (_isBot) {
        _botInterval = setInterval(() => {
            if (_done || _scoring || _wells[1].length >= MAX_WELLS) return;
            // Place well slightly between ball and opponent's goal (top)
            _wells[1].push({
                x:        _ball.x + (Math.random() - 0.5) * 80,
                y:        _ball.y - 40 - Math.random() * 60,
                radius:   40 + Math.random() * 45,
                strength: 0.8 + Math.random() * 0.7,
                created:  performance.now(),
            });
        }, 1600);
        _cleanups.push(() => { clearInterval(_botInterval); _botInterval = null; });
    }
}

function _resetBall() {
    _ball = {
        x: _W / 2,
        y: _H / 2,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
    };
}

function _tick() {
    if (_done || !state.mgActive) return;

    const now = performance.now();
    // Expire old wells
    for (let pid = 0; pid < 2; pid++) {
        _wells[pid] = _wells[pid].filter(w => now - w.created < WELL_LIFETIME);
    }

    if (!_scoring) {
        // Apply gravity
        let ax = 0, ay = 0;
        for (let pid = 0; pid < 2; pid++) {
            for (const w of _wells[pid]) {
                const dx = w.x - _ball.x, dy = w.y - _ball.y;
                const dist = Math.hypot(dx, dy);
                if (dist < w.radius && dist > 1) {
                    const force = GRAVITY_STR * w.strength * (1 - dist / w.radius);
                    ax += (dx / dist) * force;
                    ay += (dy / dist) * force;
                }
            }
        }

        _ball.vx = (_ball.vx + ax) * FRICTION;
        _ball.vy = (_ball.vy + ay) * FRICTION;

        // Cap velocity so ball doesn't go off-screen too suddenly
        const spd = Math.hypot(_ball.vx, _ball.vy);
        if (spd > 14) { _ball.vx *= 14 / spd; _ball.vy *= 14 / spd; }

        _ball.x += _ball.vx;
        _ball.y += _ball.vy;

        // Side wall bounce
        if (_ball.x - BALL_R < 0)  { _ball.x = BALL_R;        _ball.vx *=  -0.6; }
        if (_ball.x + BALL_R > _W) { _ball.x = _W - BALL_R;   _ball.vx *=  -0.6; }

        // Goal detection
        if (_ball.y + BALL_R > _H) _score(0);       // bottom — P1 scores
        else if (_ball.y - BALL_R < 0) _score(1);   // top — P2 scores
    }

    _draw(now);
    _af = requestAnimationFrame(_tick);
}

function _score(pid) {
    if (_scoring || _done) return;
    _scoring = true;
    _scores[pid]++;
    if (_scoreEls[pid]) _scoreEls[pid].textContent = `P${pid + 1}: ${_scores[pid]}`;
    sfx('mg_start');
    if (_neutralEl) _neutralEl.textContent = `P${pid + 1} SCORES! ${_scores[0]}–${_scores[1]}`;

    if (_scores[pid] >= WIN_SCORE) {
        _done = true; state.mgActive = false;
        clearInterval(_botInterval); _botInterval = null;
        setTimeout(() => { cancelAnimationFrame(_af); _af = null; _destroy(); _onWin(pid); }, 1500);
        return;
    }

    setTimeout(() => {
        if (_done || !state.mgActive) return;
        _wells = [[], []];
        _resetBall();
        _scoring = false;
        if (_neutralEl) _neutralEl.textContent = 'DRAW GRAVITY WELLS TO GUIDE THE BALL!';
    }, 2000);
}

function _draw(now) {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    // Goal zones
    _ctx.fillStyle = 'rgba(255,59,59,0.18)';
    _ctx.fillRect(0, _H - GOAL_ZONE_H, _W, GOAL_ZONE_H);
    _ctx.fillStyle = 'rgba(59,142,255,0.18)';
    _ctx.fillRect(0, 0, _W, GOAL_ZONE_H);

    // Center divider
    _ctx.setLineDash([5, 5]);
    _ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H / 2); _ctx.lineTo(_W, _H / 2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Wells
    const wellColors = ['rgba(255,59,59,', 'rgba(59,142,255,'];
    for (let pid = 0; pid < 2; pid++) {
        for (const w of _wells[pid]) {
            const life = 1 - (now - w.created) / WELL_LIFETIME;
            const grad = _ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, w.radius);
            grad.addColorStop(0,   wellColors[pid] + (0.35 * life) + ')');
            grad.addColorStop(1,   'transparent');
            _ctx.fillStyle = grad;
            _ctx.beginPath(); _ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2); _ctx.fill();
            _ctx.strokeStyle = wellColors[pid] + (0.6 * life) + ')';
            _ctx.lineWidth = 1.5;
            _ctx.stroke();
        }
    }

    // Ball
    _ctx.beginPath();
    _ctx.arc(_ball.x, _ball.y, BALL_R, 0, Math.PI * 2);
    _ctx.fillStyle = '#fff';
    _ctx.shadowColor = '#fff';
    _ctx.shadowBlur  = 22;
    _ctx.fill();
    _ctx.shadowBlur = 0;
}

function _destroy() {
    clearInterval(_botInterval); _botInterval = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}
