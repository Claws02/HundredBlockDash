// ============================================================
// METEOR DODGE — evade / survival duel. Drag your pod left and right
// along the base of your half to dodge falling meteors. Three lives
// each; lose them all and you're out. If both survive 30 s, the most
// lives wins (ties broken by meteors dodged). The longer it runs the
// faster and thicker the storm gets, so a stalemate can't last.
//
// New verb for the roster: evade / survive. Built to
// docs/MINIGAME_STANDARD.md on the SnapStrike scaffold. Face-off
// symmetric with independent simultaneous drag per player (one finger
// each); meaning carried by position & motion, not colour (§4).
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables (all positions are 0..1 fractions of a half) ───────────────────────
const ROUND_TIME   = 30;
const START_LIVES  = 3;
const SHIP_Y       = 0.82;    // pod sits near the player's outer edge
const HIT_X        = 0.085;   // x overlap for a hit
const HIT_BAND     = 0.06;    // y band around the pod
const SPAWN_HI     = 0.95;    // spawn interval at the start (s)
const SPAWN_LO     = 0.42;    // ...and at the end
const FALL_HI      = 0.30;    // fall speed at the start (frac/s)
const FALL_LO      = 0.62;    // ...and at the end
const INVULN       = 0.9;     // s of i-frames after a hit

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;

let _ship    = [0.5, 0.5];
let _ptr     = [null, null];
let _lives   = [START_LIVES, START_LIVES];
let _dodges  = [0, 0];
let _inv     = [0, 0];
let _hitFx   = [0, 0];
let _meteors = [[], []];
let _spawnT  = [0, 0];

const _cleanups = [];
const _timers   = [];

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}
function _gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }
function _diff()  { return Math.min(1, _elapsed / ROUND_TIME); }

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0; _elapsed = 0;
    _ship = [0.5, 0.5]; _ptr = [null, null];
    _lives = [START_LIVES, START_LIVES]; _dodges = [0, 0];
    _inv = [0, 0]; _hitFx = [0, 0]; _meteors = [[], []]; _spawnT = [0.3, 0.3];
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        document.getElementById('mg-neutral').textContent = 'DODGE THE METEORS! DRAG TO MOVE';
        sfx('go');
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0d0b18;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    const pidAt = ly => (ly > _overlay.clientHeight / 2 ? 0 : 1);
    const setShip = (pid, lx) => {
        const w = _overlay.clientWidth;
        const fx = pid === 0 ? lx / w : (w - lx) / w;     // top half is rotated 180°
        _ship[pid] = Math.max(0.06, Math.min(0.94, fx));
    };

    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const rect = _overlay.getBoundingClientRect();
        const pid = pidAt(e.clientY - rect.top);
        if (pid === 1 && _isBot) return;
        if (_ptr[pid] !== null) return;                   // one finger per side
        _ptr[pid] = e.pointerId;
        setShip(pid, e.clientX - rect.left);
    };
    const onMove = e => {
        if (_done) return;
        const rect = _overlay.getBoundingClientRect();
        for (let pid = 0; pid < 2; pid++) {
            if (_ptr[pid] === e.pointerId) { setShip(pid, e.clientX - rect.left); e.preventDefault(); }
        }
    };
    const onUp = e => {
        for (let pid = 0; pid < 2; pid++) if (_ptr[pid] === e.pointerId) _ptr[pid] = null;
    };
    _overlay.addEventListener('pointerdown', onDown);
    _overlay.addEventListener('pointermove', onMove);
    _overlay.addEventListener('pointerup', onUp);
    _overlay.addEventListener('pointercancel', onUp);
    _cleanups.push(() => {
        _overlay.removeEventListener('pointerdown', onDown);
        _overlay.removeEventListener('pointermove', onMove);
        _overlay.removeEventListener('pointerup', onUp);
        _overlay.removeEventListener('pointercancel', onUp);
    });

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
}

// ── Gameplay ────────────────────────────────────────────────────────────────
function _spawn(pid) {
    _meteors[pid].push({
        x: 0.1 + Math.random() * 0.8,
        y: -0.04,
        r: 0.045 + Math.random() * 0.025,
        vy: (FALL_HI + (FALL_LO - FALL_HI) * _diff()) * (0.85 + Math.random() * 0.4),
    });
}

function _hit(pid) {
    if (_inv[pid] > 0) return;
    _lives[pid]--;
    _inv[pid] = INVULN;
    _hitFx[pid] = 0.45;
    sfx('land_bad'); haptic([80, 40, 80]);
    if (_lives[pid] <= 0) _finish((pid + 1) % 2);
}

function _updateSide(pid, dt) {
    // spawn
    _spawnT[pid] -= dt;
    if (_spawnT[pid] <= 0) {
        _spawn(pid);
        _spawnT[pid] = SPAWN_HI + (SPAWN_LO - SPAWN_HI) * _diff() + Math.random() * 0.25;
    }
    // move + collide
    const arr = _meteors[pid];
    for (let i = arr.length - 1; i >= 0; i--) {
        const m = arr[i];
        m.y += m.vy * dt;
        if (Math.abs(m.y - SHIP_Y) < HIT_BAND && Math.abs(m.x - _ship[pid]) < HIT_X + m.r * 0.5) {
            _hit(pid); arr.splice(i, 1); continue;
        }
        if (m.y > 1.05) { arr.splice(i, 1); _dodges[pid]++; }
    }
    if (_inv[pid] > 0) _inv[pid] -= dt;
    if (_hitFx[pid] > 0) _hitFx[pid] -= dt;
}

function _botUpdate(dt) {
    const s = _botSkill;
    const look = 0.2 + s * 0.5;          // hard looks further ahead
    let threat = null, best = 2;
    for (const m of _meteors[1]) {
        const dy = SHIP_Y - m.y;
        if (dy > 0 && dy < look && Math.abs(m.x - _ship[1]) < 0.22 && dy < best) { best = dy; threat = m; }
    }
    let desired;
    if (threat) {
        desired = threat.x > 0.5 ? threat.x - 0.26 : threat.x + 0.26;
        desired += (1 - s) * 0.18 * _gauss();
    } else {
        desired = 0.5 + (Math.random() - 0.5) * 0.04;
    }
    desired = Math.max(0.06, Math.min(0.94, desired));
    const spd = 0.7 + s * 1.0;
    const d = desired - _ship[1];
    _ship[1] += Math.sign(d) * Math.min(Math.abs(d), spd * dt);
}

// ── Loop ────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    if (_isBot) _botUpdate(dt);
    _updateSide(0, dt);
    if (!_done) _updateSide(1, dt);

    if (!_done && _elapsed >= ROUND_TIME) {
        // Survived: most lives, then most dodged.
        let winner = _lives[0] > _lives[1] ? 0 : _lives[1] > _lives[0] ? 1
                   : _dodges[0] > _dodges[1] ? 0 : _dodges[1] > _dodges[0] ? 1 : -1;
        _finish(winner);
        return;
    }
    _draw();
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);

    _ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(0, h / 2); _ctx.lineTo(w, h / 2); _ctx.stroke();

    _ctx.save(); _ctx.translate(w, h / 2); _ctx.rotate(Math.PI); _drawHalf(1, w, h / 2); _ctx.restore();
    _ctx.save(); _ctx.translate(0, h / 2); _drawHalf(0, w, h / 2); _ctx.restore();
}

function _drawHalf(pid, w, h) {
    const color = pid === 0 ? '#ff5a5a' : '#5a9bff';

    // Meteors
    for (const m of _meteors[pid]) {
        const cx = m.x * w, cy = m.y * h, r = m.r * w;
        _ctx.fillStyle = '#9ca3af';
        _ctx.strokeStyle = '#e5e7eb';
        _ctx.lineWidth = 2;
        _ctx.beginPath();
        for (let a = 0; a < 8; a++) {
            const ang = (a / 8) * Math.PI * 2;
            const rr = r * (a % 2 ? 0.74 : 1);
            const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
            a === 0 ? _ctx.moveTo(px, py) : _ctx.lineTo(px, py);
        }
        _ctx.closePath(); _ctx.fill(); _ctx.stroke();
    }

    // Pod (blinks while invulnerable)
    if (!(_inv[pid] > 0 && Math.floor(_elapsed * 12) % 2)) {
        const sx = _ship[pid] * w, sy = SHIP_Y * h, r = Math.min(w, h) * 0.07;
        _ctx.fillStyle = color;
        _ctx.shadowColor = color; _ctx.shadowBlur = 14;
        _ctx.beginPath();
        _ctx.moveTo(sx, sy - r);
        _ctx.lineTo(sx + r, sy + r * 0.8);
        _ctx.lineTo(sx - r, sy + r * 0.8);
        _ctx.closePath(); _ctx.fill();
        _ctx.shadowBlur = 0;
    }

    // Lives (pips near the divider)
    for (let i = 0; i < START_LIVES; i++) {
        _ctx.fillStyle = i < _lives[pid] ? color : 'rgba(255,255,255,0.18)';
        _ctx.beginPath(); _ctx.arc(w * 0.5 + (i - 1) * 26, h * 0.14, 8, 0, Math.PI * 2); _ctx.fill();
    }
    _ctx.fillStyle = 'rgba(255,255,255,0.55)';
    _ctx.font = '700 14px Nunito, sans-serif';
    _ctx.textAlign = 'center';
    _ctx.fillText(`P${pid + 1} · dodged ${_dodges[pid]}`, w / 2, h * 0.26);

    if (_hitFx[pid] > 0) {
        _ctx.fillStyle = `rgba(239,68,68,${0.30 * (_hitFx[pid] / 0.45)})`;
        _ctx.fillRect(0, 0, w, h);
    }
    if (_lives[pid] <= 0) {
        _ctx.fillStyle = '#ef4444';
        _ctx.font = '900 28px "Bebas Neue", sans-serif';
        _ctx.fillText('OUT!', w / 2, h * 0.55);
    }
}

// ── End ───────────────────────────────────────────────────────────────────────
function _finish(winner) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent =
        winner < 0 ? 'DRAW — BOTH SURVIVED!' : `P${winner + 1} SURVIVES!`;
    sfx(winner < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winner); }, 1500);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _meteors = [[], []];
}
