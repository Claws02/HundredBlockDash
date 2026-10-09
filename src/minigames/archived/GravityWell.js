// Gravity Well — Tap your half to place a REPULSION well that blasts the ball away.
// Use 2 wells strategically to push the ball into the opponent's goal zone.
// P1 defends the bottom edge, P2 defends the top edge. First to 5 points wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_SCORE     = 5;
const BALL_R        = 13;
const REPULSE_STR   = 1.1;    // repulsion force strength
const WELL_RADIUS   = 85;     // fixed influence radius of each well
const MAX_WELLS     = 2;      // per player
const WELL_LIFETIME = 3500;   // ms before a well fades
const FRICTION      = 0.991;
const SPEED_CAP     = 15;
const GOAL_H        = 20;
const ARROW_COUNT   = 8;      // repulsion arrows drawn around each well

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
        if (_neutralEl) _neutralEl.textContent = 'TAP TO BLAST THE BALL AWAY!';
        _af = requestAnimationFrame(_tick);
    }));
}

// ── Overlay ────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0a0a1e;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);

    // Score HUD
    const hud = document.createElement('div');
    hud.style.cssText = `
        position:absolute;inset:0;pointer-events:none;
        display:flex;justify-content:space-between;align-items:center;
        padding:6px 16px;box-sizing:border-box;
    `;
    _scoreEls[1] = _mkLabel('P2: 0', '#93c5fd');
    _scoreEls[0] = _mkLabel('P1: 0', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);

    // Well counter indicators
    const wellHud = document.createElement('div');
    wellHud.id = 'gw-well-hud';
    wellHud.style.cssText = `
        position:absolute;bottom:28px;left:0;right:0;pointer-events:none;
        display:flex;justify-content:center;gap:10px;
    `;
    _overlay.appendChild(wellHud);

    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:1.2rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 12px ${color};`;
    el.textContent = text;
    return el;
}

// ── Setup ──────────────────────────────────────────────────────────────────────
function _setup() {
    const r = _canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    _W = r.width; _H = r.height;
    _canvas.width  = Math.round(_W * dpr);
    _canvas.height = Math.round(_H * dpr);
    _ctx = _canvas.getContext('2d');
    _ctx.scale(dpr, dpr);

    _resetBall();

    const onDown = e => {
        e.preventDefault();
        if (_done || _scoring) return;
        const cr  = _canvas.getBoundingClientRect();
        const cx  = e.clientX - cr.left;
        const cy  = e.clientY - cr.top;
        const pid = cy > _H / 2 ? 0 : 1;
        _placeWell(pid, cx, cy);
    };

    _canvas.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _canvas.removeEventListener('pointerdown', onDown));

    if (_isBot) {
        _botInterval = setInterval(() => {
            if (_done || _scoring || _wells[1].length >= MAX_WELLS) return;
            // Bot: place well between ball and P2's goal (top), to push ball downward
            const wx = _ball.x + (Math.random() - 0.5) * 60;
            const wy = Math.max(GOAL_H + 20, _ball.y - 50 - Math.random() * 80);
            _placeWell(1, wx, wy);
        }, 1400);
        _cleanups.push(() => { clearInterval(_botInterval); _botInterval = null; });
    }
}

function _placeWell(pid, x, y) {
    // Remove oldest well if at cap
    if (_wells[pid].length >= MAX_WELLS) _wells[pid].shift();

    _wells[pid].push({
        x, y,
        radius:  WELL_RADIUS,
        created: performance.now(),
    });
    sfx('land_good');
}

function _resetBall() {
    // Launch from center with a small random kick toward one player
    const dir = Math.random() < 0.5 ? 1 : -1;
    _ball = {
        x:  _W / 2,
        y:  _H / 2,
        vx: (Math.random() - 0.5) * 2,
        vy: dir * (1.5 + Math.random()),
    };
}

// ── Game loop ──────────────────────────────────────────────────────────────────
function _tick() {
    if (_done || !state.mgActive) return;

    const now = performance.now();

    // Expire wells
    for (let pid = 0; pid < 2; pid++) {
        _wells[pid] = _wells[pid].filter(w => now - w.created < WELL_LIFETIME);
    }

    if (!_scoring) {
        // Apply REPULSION from all wells
        let ax = 0, ay = 0;
        for (let pid = 0; pid < 2; pid++) {
            for (const w of _wells[pid]) {
                const dx   = _ball.x - w.x;   // reversed: ball → well center
                const dy   = _ball.y - w.y;
                const dist = Math.hypot(dx, dy);
                if (dist < w.radius && dist > 1) {
                    // Stronger push when ball is closer to the well center
                    const force = REPULSE_STR * (1 - dist / w.radius);
                    ax += (dx / dist) * force;
                    ay += (dy / dist) * force;
                }
            }
        }

        _ball.vx = (_ball.vx + ax) * FRICTION;
        _ball.vy = (_ball.vy + ay) * FRICTION;

        // Speed cap
        const spd = Math.hypot(_ball.vx, _ball.vy);
        if (spd > SPEED_CAP) { _ball.vx *= SPEED_CAP / spd; _ball.vy *= SPEED_CAP / spd; }

        _ball.x += _ball.vx;
        _ball.y += _ball.vy;

        // Side wall bounce
        if (_ball.x - BALL_R < 0)  { _ball.x = BALL_R;      _ball.vx = Math.abs(_ball.vx); }
        if (_ball.x + BALL_R > _W) { _ball.x = _W - BALL_R; _ball.vx = -Math.abs(_ball.vx); }

        // Goal scoring
        if (_ball.y + BALL_R > _H) _score(0);      // ball exits bottom → P1 scores
        else if (_ball.y - BALL_R < 0) _score(1);  // ball exits top    → P2 scores
    }

    _draw(now);
    _af = requestAnimationFrame(_tick);
}

// ── Scoring ────────────────────────────────────────────────────────────────────
function _score(pid) {
    if (_scoring || _done) return;
    _scoring = true;
    _scores[pid]++;
    if (_scoreEls[pid]) _scoreEls[pid].textContent = `P${pid + 1}: ${_scores[pid]}`;
    sfx('mg_start');
    if (_neutralEl) _neutralEl.textContent = `P${pid + 1} SCORES!  ${_scores[0]}–${_scores[1]}`;

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
        if (_neutralEl) _neutralEl.textContent = 'TAP TO BLAST THE BALL AWAY!';
    }, 1800);
}

// ── Draw ───────────────────────────────────────────────────────────────────────
function _draw(now) {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    // Goal zones
    _ctx.fillStyle = 'rgba(255,59,59,0.22)';
    _ctx.fillRect(0, _H - GOAL_H, _W, GOAL_H);
    _ctx.fillStyle = 'rgba(59,142,255,0.22)';
    _ctx.fillRect(0, 0, _W, GOAL_H);

    // Goal zone labels
    _ctx.font = 'bold 10px sans-serif';
    _ctx.textAlign = 'center';
    _ctx.fillStyle = 'rgba(255,59,59,0.6)';
    _ctx.fillText('P1 GOAL', _W / 2, _H - 6);
    _ctx.fillStyle = 'rgba(59,142,255,0.6)';
    _ctx.fillText('P2 GOAL', _W / 2, 13);

    // Center divider
    _ctx.setLineDash([6, 6]);
    _ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H / 2); _ctx.lineTo(_W, _H / 2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Wells — drawn as repulsion rings with outward arrows
    const wellRgb = ['255,59,59', '59,142,255'];
    for (let pid = 0; pid < 2; pid++) {
        for (const w of _wells[pid]) {
            const life   = 1 - (now - w.created) / WELL_LIFETIME;
            const rgb    = wellRgb[pid];

            // Outer glow ring
            const grad = _ctx.createRadialGradient(w.x, w.y, w.radius * 0.2, w.x, w.y, w.radius);
            grad.addColorStop(0,   `rgba(${rgb},${0.28 * life})`);
            grad.addColorStop(0.6, `rgba(${rgb},${0.12 * life})`);
            grad.addColorStop(1,   'transparent');
            _ctx.fillStyle = grad;
            _ctx.beginPath(); _ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2); _ctx.fill();

            // Pulsing ring border
            _ctx.strokeStyle = `rgba(${rgb},${0.7 * life})`;
            _ctx.lineWidth = 2;
            _ctx.beginPath(); _ctx.arc(w.x, w.y, w.radius * (0.85 + 0.08 * Math.sin(now / 180)), 0, Math.PI * 2); _ctx.stroke();

            // Inner core
            _ctx.beginPath(); _ctx.arc(w.x, w.y, 8, 0, Math.PI * 2);
            _ctx.fillStyle = `rgba(${rgb},${0.9 * life})`;
            _ctx.fill();

            // Outward arrows to show repulsion direction
            _ctx.strokeStyle = `rgba(${rgb},${0.55 * life})`;
            _ctx.lineWidth = 1.5;
            for (let a = 0; a < ARROW_COUNT; a++) {
                const angle  = (a / ARROW_COUNT) * Math.PI * 2;
                const inner  = 14;
                const outer  = 28 + 6 * Math.sin(now / 200 + a);
                const ax1    = w.x + Math.cos(angle) * inner;
                const ay1    = w.y + Math.sin(angle) * inner;
                const ax2    = w.x + Math.cos(angle) * outer;
                const ay2    = w.y + Math.sin(angle) * outer;
                _ctx.beginPath(); _ctx.moveTo(ax1, ay1); _ctx.lineTo(ax2, ay2); _ctx.stroke();
                // Arrowhead
                const hx = Math.cos(angle + 0.4) * 6;
                const hy = Math.sin(angle + 0.4) * 6;
                _ctx.beginPath();
                _ctx.moveTo(ax2, ay2);
                _ctx.lineTo(ax2 - Math.cos(angle) * 7 + hx * 0.5, ay2 - Math.sin(angle) * 7 + hy * 0.5);
                _ctx.stroke();
            }

            // Slot indicator (e.g. well 1 of 2)
            const slotIdx = _wells[pid].indexOf(w) + 1;
            _ctx.font = `bold 9px sans-serif`;
            _ctx.textAlign = 'center';
            _ctx.fillStyle = `rgba(${rgb},${0.8 * life})`;
            _ctx.fillText(`${slotIdx}/${MAX_WELLS}`, w.x, w.y + 3);
        }
    }

    // Ball
    _ctx.beginPath();
    _ctx.arc(_ball.x, _ball.y, BALL_R, 0, Math.PI * 2);
    _ctx.fillStyle = '#ffffff';
    _ctx.shadowColor = '#ffffff';
    _ctx.shadowBlur  = 24;
    _ctx.fill();
    _ctx.shadowBlur = 0;

    // Well slot dots (bottom HUD area — show remaining slots)
    const colors = ['#fca5a5', '#93c5fd'];
    for (let pid = 0; pid < 2; pid++) {
        const used = _wells[pid].length;
        const y    = pid === 0 ? _H - GOAL_H - 12 : GOAL_H + 12;
        for (let s = 0; s < MAX_WELLS; s++) {
            const x = _W / 2 + (s - (MAX_WELLS - 1) / 2) * 18;
            _ctx.beginPath();
            _ctx.arc(x, y, 5, 0, Math.PI * 2);
            _ctx.fillStyle = s < used ? colors[pid] : 'rgba(255,255,255,0.2)';
            _ctx.fill();
        }
    }
}

// ── Cleanup ────────────────────────────────────────────────────────────────────
function _destroy() {
    clearInterval(_botInterval); _botInterval = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}
