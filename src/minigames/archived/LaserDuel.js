// Laser Duel — Hold to charge, release to fire a laser beam.
// P1 (bottom, red) and P2 (top, blue) each protect their shield.
// First to destroy the opponent's shield wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const MAX_CHARGE  = 100;
const CHARGE_RATE = 1.6;
const LASER_SPEED = 14;
const SHIELD_MAX  = 100;
const DAMAGE_BASE = 32;
const COOLDOWN_MS = 1000;

let _done = false, _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null, _lastTime = 0;
let _players = [], _lasers = [];
let _scoreEls = [null, null], _neutralEl = null;
let _botInterval = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _lasers = []; _lastTime = 0;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'HOLD TO CHARGE! RELEASE TO FIRE!';
        _lastTime = performance.now();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0a0a1a;';
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;align-items:flex-start;padding:6px 14px;box-sizing:border-box;';
    _scoreEls[1] = _mkShield('P2', '#3b8eff');
    _scoreEls[0] = _mkShield('P1', '#ff3b3b');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkShield(name, color) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'text-align:center;min-width:90px;';
    const lbl = document.createElement('div');
    lbl.style.cssText = `font-size:0.75rem;font-weight:900;color:${color};font-family:inherit;`;
    lbl.textContent = name;
    const bg = document.createElement('div');
    bg.style.cssText = 'width:90px;height:10px;background:rgba(255,255,255,0.12);border-radius:5px;overflow:hidden;margin:3px 0;';
    const fill = document.createElement('div');
    fill.style.cssText = `width:100%;height:100%;background:${color};border-radius:5px;transition:width 0.2s;`;
    bg.appendChild(fill);
    wrap.appendChild(lbl); wrap.appendChild(bg);
    wrap._fill = fill;
    return wrap;
}

function _setup() {
    const r = _canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    _W = r.width; _H = r.height;
    _canvas.width  = Math.round(_W * dpr);
    _canvas.height = Math.round(_H * dpr);
    _ctx = _canvas.getContext('2d');
    _ctx.scale(dpr, dpr);

    _players = [
        { x: _W / 2, y: _H * 0.82, charge: 0, charging: false, shield: SHIELD_MAX, cooldown: 0, pid: 0 },
        { x: _W / 2, y: _H * 0.18, charge: 0, charging: false, shield: SHIELD_MAX, cooldown: 0, pid: 1 },
    ];

    const pointerPid = new Map();
    const onDown = e => {
        e.preventDefault();
        const cr = _canvas.getBoundingClientRect();
        const pid = (e.clientY - cr.top) > _H / 2 ? 0 : 1;
        pointerPid.set(e.pointerId, pid);
        if (!(_isBot && pid === 1)) _players[pid].charging = true;
    };
    const onUp = e => {
        const pid = pointerPid.get(e.pointerId);
        pointerPid.delete(e.pointerId);
        if (pid === undefined || (_isBot && pid === 1)) return;
        _tryFire(pid);
    };
    const onCancel = e => {
        const pid = pointerPid.get(e.pointerId);
        pointerPid.delete(e.pointerId);
        if (pid !== undefined) _players[pid].charging = false;
    };
    _canvas.addEventListener('pointerdown',   onDown);
    _canvas.addEventListener('pointerup',     onUp);
    _canvas.addEventListener('pointercancel', onCancel);
    _cleanups.push(() => {
        _canvas.removeEventListener('pointerdown',   onDown);
        _canvas.removeEventListener('pointerup',     onUp);
        _canvas.removeEventListener('pointercancel', onCancel);
    });

    if (_isBot) {
        _botInterval = setInterval(() => {
            if (_done || !state.mgActive) return;
            const bot = _players[1];
            if (bot.cooldown > 0 || bot.charging) return;
            bot.charging = true;
            const wait = 600 + Math.random() * 1200;
            setTimeout(() => {
                if (_done || !state.mgActive) return;
                _tryFire(1); bot.charging = false;
            }, wait);
        }, 1200);
        _cleanups.push(() => { clearInterval(_botInterval); _botInterval = null; });
    }
}

function _tryFire(pid) {
    const p = _players[pid];
    if (p.cooldown > 0) { p.charging = false; return; }
    const ratio = p.charge / MAX_CHARGE;
    _lasers.push({
        x: p.x, y: p.y,
        vy: LASER_SPEED * (pid === 0 ? -1 : 1),
        damage: Math.floor(DAMAGE_BASE * (0.4 + ratio * 0.6)),
        pid,
        color: pid === 0 ? '#ff7b7b' : '#7bb5ff',
    });
    p.charge = 0; p.charging = false; p.cooldown = COOLDOWN_MS;
    sfx('land_good');
}

function _tick(now) {
    if (_done || !state.mgActive) return;
    const dt = Math.min((now - _lastTime) / (1000 / 60), 3);
    _lastTime = now;

    for (const p of _players) {
        if (p.charging && p.cooldown <= 0) p.charge = Math.min(MAX_CHARGE, p.charge + CHARGE_RATE * dt);
        p.cooldown = Math.max(0, p.cooldown - dt * (1000 / 60));
    }

    for (let i = _lasers.length - 1; i >= 0; i--) {
        const l = _lasers[i];
        l.y += l.vy * dt;
        const target = _players[1 - l.pid];
        if (Math.hypot(l.x - target.x, l.y - target.y) < 36) {
            target.shield = Math.max(0, target.shield - l.damage);
            _lasers.splice(i, 1);
            sfx('coin_loss');
            if (_scoreEls[1 - l.pid]?._fill) _scoreEls[1 - l.pid]._fill.style.width = `${target.shield}%`;
            if (target.shield <= 0) { _resolve(l.pid); return; }
            continue;
        }
        if (l.y < -60 || l.y > _H + 60) _lasers.splice(i, 1);
    }

    _draw(now);
    _af = requestAnimationFrame(_tick);
}

function _draw(now) {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    _ctx.setLineDash([6, 6]);
    _ctx.strokeStyle = 'rgba(255,255,255,0.08)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H / 2); _ctx.lineTo(_W, _H / 2); _ctx.stroke();
    _ctx.setLineDash([]);

    const pColors = ['#ff3b3b', '#3b8eff'];
    for (const p of _players) {
        const c = pColors[p.pid];
        if (p.charge > 0) {
            const aura = _ctx.createRadialGradient(p.x, p.y, 14, p.x, p.y, 38 + p.charge * 0.28);
            aura.addColorStop(0, `rgba(${p.pid===0?'255,59,59':'59,130,255'},${0.35*p.charge/MAX_CHARGE})`);
            aura.addColorStop(1, 'transparent');
            _ctx.fillStyle = aura;
            _ctx.beginPath(); _ctx.arc(p.x, p.y, 38 + p.charge * 0.28, 0, Math.PI * 2); _ctx.fill();
        }
        _ctx.fillStyle = c; _ctx.shadowColor = c; _ctx.shadowBlur = 22;
        _ctx.beginPath(); _ctx.arc(p.x, p.y, 22, 0, Math.PI * 2); _ctx.fill();
        _ctx.shadowBlur = 0;
        if (p.cooldown > 0) {
            _ctx.strokeStyle = 'rgba(255,255,255,0.45)'; _ctx.lineWidth = 3;
            _ctx.beginPath();
            _ctx.arc(p.x, p.y, 28, -Math.PI/2, -Math.PI/2 + (1-p.cooldown/COOLDOWN_MS)*Math.PI*2);
            _ctx.stroke();
        }
    }

    for (const l of _lasers) {
        _ctx.fillStyle = l.color; _ctx.shadowColor = l.color; _ctx.shadowBlur = 14;
        _ctx.fillRect(l.x - 3, l.y - 18, 6, 36);
        _ctx.shadowBlur = 0;
    }
}

function _resolve(winner) {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_af); _af = null;
    clearInterval(_botInterval); _botInterval = null;
    if (_neutralEl) _neutralEl.textContent = `P${winner + 1} WINS THE DUEL!`;
    setTimeout(() => { _destroy(); _onWin(winner); }, 1500);
}

function _destroy() {
    clearInterval(_botInterval); _botInterval = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}
