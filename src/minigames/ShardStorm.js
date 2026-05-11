// Shard Storm — Crystal shards rain down. Tap them to collect.
// Gold=3pts, Silver=2pts, Crystal=1pt, Dark Shard=-1pt.
// 25 seconds. Most points wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const GAME_DURATION = 25000;
const SHARD_TYPES   = [
    { color: '#ffd700', glow: '#ffdd44', pts: 3, label: 'GOLD',    chance: 0.15 },
    { color: '#c0c0c0', glow: '#e0e0e0', pts: 2, label: 'SILVER',  chance: 0.30 },
    { color: '#88ccff', glow: '#aaddff', pts: 1, label: 'CRYSTAL', chance: 0.40 },
    { color: '#333333', glow: '#553333', pts:-1, label: 'DARK',    chance: 0.15 },
];
const SHARD_R     = 14;
const SPAWN_BASE  = 800;
const TAP_RADIUS  = 30;

let _done = false, _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null, _startTime = 0, _lastSpawn = 0, _lastTime = 0;
let _shards = [], _scores = [0, 0];
let _particles = [];
let _scoreEls = [null, null], _timerEl = null, _neutralEl = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    _done = false; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _shards = []; _particles = []; _startTime = 0; _lastSpawn = 0; _lastTime = 0;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'TAP SHARDS TO COLLECT!';
        _startTime = performance.now();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0a0a12;';
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;align-items:flex-start;padding:6px 14px;box-sizing:border-box;';
    _scoreEls[1] = _mkLabel('P2: 0', '#93c5fd');
    _timerEl     = _mkLabel('25s',   '#fbbf24');
    _scoreEls[0] = _mkLabel('P1: 0', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_timerEl);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:1.1rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 10px ${color};`;
    el.textContent = text;
    return el;
}

function _shardType() {
    let rnd = Math.random(), cumul = 0;
    for (const t of SHARD_TYPES) { cumul += t.chance; if (rnd < cumul) return t; }
    return SHARD_TYPES[2];
}

function _spawnShard(elapsed) {
    const speed = 1.8 + elapsed / 9000;
    const type  = _shardType();
    // Half for P1 (falls down from center), half for P2 (rises up from center)
    for (let pid = 0; pid < 2; pid++) {
        _shards.push({
            x:   SHARD_R + Math.random() * (_W - SHARD_R * 2),
            y:   pid === 0 ? _H / 2 - SHARD_R : _H / 2 + SHARD_R,
            vy:  pid === 0 ? speed : -speed,
            pid, ...type,
            collected: false,
        });
    }
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
        if (_done) return;
        const cr  = _canvas.getBoundingClientRect();
        const tx  = e.clientX - cr.left;
        const ty  = e.clientY - cr.top;
        const pid = ty > _H / 2 ? 0 : 1;
        if (_isBot && pid === 1) return;
        _tapAt(tx, ty, pid);
    };
    _canvas.addEventListener('pointerdown', onTap);
    _cleanups.push(() => _canvas.removeEventListener('pointerdown', onTap));
}

function _tapAt(tx, ty, pid) {
    for (const s of _shards) {
        if (s.collected || s.pid !== pid) continue;
        if (Math.hypot(tx - s.x, ty - s.y) < TAP_RADIUS) {
            s.collected = true;
            _scores[pid] = Math.max(0, _scores[pid] + s.pts);
            if (_scoreEls[pid]) _scoreEls[pid].textContent = `P${pid + 1}: ${_scores[pid]}`;
            const popColor = s.pts > 0 ? s.glow : '#ff4444';
            sfx(s.pts >= 0 ? 'coin_gain' : 'land_bad');
            _particles.push({ x: s.x, y: s.y, vx: (Math.random()-0.5)*4, vy: -3-Math.random()*3,
                color: popColor, life: 1, text: s.pts > 0 ? `+${s.pts}` : `${s.pts}` });
            break;
        }
    }
}

function _tick(now) {
    if (_done || !state.mgActive) return;
    const elapsed   = now - _startTime;
    const remaining = Math.max(0, GAME_DURATION - elapsed);
    const dt = Math.min((now - (_lastTime || now)) / (1000 / 60), 3);
    _lastTime = now;
    if (_timerEl) _timerEl.textContent = `${Math.ceil(remaining / 1000)}s`;

    const spawnMs = Math.max(350, SPAWN_BASE - elapsed * 0.012);
    if (now - _lastSpawn > spawnMs) { _lastSpawn = now; _spawnShard(elapsed); }

    // Bot: tap shards in P2's half (top)
    if (_isBot && Math.random() < 0.08) {
        for (const s of _shards) {
            if (s.collected || s.pid !== 1) continue;
            if (s.pts > 0 && Math.random() < 0.4) { _tapAt(s.x, s.y, 1); break; }
        }
    }

    _shards = _shards.filter(s => {
        if (s.collected) return false;
        s.y += s.vy * dt;
        const past = s.pid === 0 ? s.y > _H + SHARD_R : s.y < -SHARD_R;
        return !past;
    });

    _particles = _particles.filter(p => {
        p.x += p.vx; p.y += p.vy; p.vy *= 0.92; p.life -= 0.04;
        return p.life > 0;
    });

    _draw();
    if (remaining <= 0) { _resolve(); return; }
    _af = requestAnimationFrame(_tick);
}

function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.08)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    for (const s of _shards) {
        if (s.collected) continue;
        _ctx.fillStyle = s.color; _ctx.shadowColor = s.glow; _ctx.shadowBlur = 12;
        _ctx.beginPath();
        _ctx.moveTo(s.x,           s.y - SHARD_R);
        _ctx.lineTo(s.x + SHARD_R * 0.6, s.y);
        _ctx.lineTo(s.x,           s.y + SHARD_R);
        _ctx.lineTo(s.x - SHARD_R * 0.6, s.y);
        _ctx.closePath(); _ctx.fill();
    }
    _ctx.shadowBlur = 0;

    for (const p of _particles) {
        _ctx.globalAlpha = p.life;
        _ctx.fillStyle = p.color; _ctx.font = 'bold 14px sans-serif'; _ctx.textAlign = 'center';
        _ctx.fillText(p.text, p.x, p.y);
    }
    _ctx.globalAlpha = 1;
}

function _resolve() {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_af); _af = null;
    const winner = _scores[0] > _scores[1] ? 0 : _scores[1] > _scores[0] ? 1 : -1;
    if (_neutralEl) _neutralEl.textContent = winner >= 0
        ? `P${winner+1} WINS! ${_scores[0]}–${_scores[1]}`
        : `TIE! ${_scores[0]}–${_scores[1]}`;
    sfx(winner >= 0 ? 'mg_start' : 'land_good');
    setTimeout(() => { _destroy(); _onWin(winner); }, 1500);
}

function _destroy() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}

export function destroy() { _done = true; cancelAnimationFrame(_af); _af = null; _cleanups.forEach(f => f()); _cleanups.length = 0; }
