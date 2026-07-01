// ============================================================
// LOOT CATCH — collect & select. Coins and bombs rain down each
// player's half; slide your basket to scoop coins and dodge bombs.
// Most coins after 30 s wins. Spawns are mirrored to both halves so
// the challenge is identical — a pure test of who collects cleaner.
// Fills the "collect & select" verb (distinct from Meteor Dodge's
// pure evade — here you chase the good and reject the bad).
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const GAME_TIME    = 30;     // seconds
const SPAWN_START  = 0.85;   // s between spawns at the start
const SPAWN_END    = 0.42;   // s between spawns at the end (faster)
const FALL_START   = 0.52;   // half-heights per SECOND at the start
const FALL_END     = 0.95;   // half-heights per second at the end
const BOMB_CHANCE  = 0.30;   // probability a spawned item is a bomb
const COIN_VALUE   = 1;
const BOMB_PENALTY = 2;
const BASKET_W     = 0.20;   // basket width as a fraction of half-width
const ITEM_R       = 0.045;  // item radius as a fraction of half-width

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _t = 0;

let _items   = [[], []];     // per player: { x, y, vy, bomb } in 0..1 local coords
let _basket  = [0.5, 0.5];   // per player basket centre x (0..1)
let _score   = [0, 0];
let _spawnAcc = 0;
let _botTarget = 0.5, _botRetargetIn = 0;
const _flash = [null, null];   // per-player catch feedback { type, t }

const _cleanups = [];
const _timers   = [];
function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0; _t = 0;
    _items = [[], []]; _basket = [0.5, 0.5]; _score = [0, 0];
    _spawnAcc = 0; _botTarget = 0.5; _botRetargetIn = 0;
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#10131c;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    // Track the basket under a held finger in each half.
    const move = e => {
        if (_done) return;
        e.preventDefault();
        const w = _overlay.clientWidth, h = _overlay.clientHeight, hh = h / 2;
        const top = e.clientY < hh;
        const pid = top ? 1 : 0;
        if (pid === 1 && _isBot) return;
        // Map into local half x (top half is rotated 180°).
        const lx = top ? (w - e.clientX) / w : e.clientX / w;
        _basket[pid] = Math.max(BASKET_W / 2, Math.min(1 - BASKET_W / 2, lx));
    };
    _overlay.addEventListener('pointerdown', move);
    _overlay.addEventListener('pointermove', move);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', move));
    _cleanups.push(() => _overlay.removeEventListener('pointermove', move));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'CATCH COINS — DODGE BOMBS!';
}

function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
}

// ── Loop ───────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const now = performance.now();
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _t += dt;

    if (_t >= GAME_TIME) { _finish(); return; }
    _update(dt);
    if (_isBot) _botUpdate(dt);
    _draw();
}

function _progress() { return Math.min(_t / GAME_TIME, 1); }

function _update(dt) {
    const p = _progress();
    // Late "gold rush": coins become more common in the final stretch.
    const bombChance = p > 0.75 ? BOMB_CHANCE * 0.5 : BOMB_CHANCE;
    const spawnEvery = SPAWN_START + (SPAWN_END - SPAWN_START) * p;
    const fallSpeed  = FALL_START + (FALL_END - FALL_START) * p;

    _spawnAcc += dt;
    while (_spawnAcc >= spawnEvery) {
        _spawnAcc -= spawnEvery;
        // Mirrored spawn — identical item to both halves for fairness.
        const x    = 0.1 + Math.random() * 0.8;
        const bomb = Math.random() < bombChance;
        const vy   = fallSpeed * (0.9 + Math.random() * 0.2);
        _items[0].push({ x, y: -ITEM_R, vy, bomb });
        _items[1].push({ x, y: -ITEM_R, vy, bomb });
    }

    for (let pid = 0; pid < 2; pid++) _stepItems(pid, dt);

    const left = Math.ceil(GAME_TIME - _t);
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = `${left}s   🪙 P1 ${_score[0]} · ${_score[1]} P2`;
}

const BASKET_Y = 0.84;   // basket line in local half coords

function _stepItems(pid, dt) {
    const arr = _items[pid];
    for (let i = arr.length - 1; i >= 0; i--) {
        const it = arr[i];
        it.y += it.vy * dt;
        // Catch test when the item reaches the basket line.
        if (it.y >= BASKET_Y && it.y - it.vy * dt < BASKET_Y + 0.06) {
            if (Math.abs(it.x - _basket[pid]) < BASKET_W / 2 + ITEM_R) {
                _catch(pid, it);
                arr.splice(i, 1);
                continue;
            }
        }
        if (it.y > 1.05) arr.splice(i, 1);   // fell past the basket
    }
}

function _catch(pid, it) {
    if (it.bomb) {
        _score[pid] = Math.max(0, _score[pid] - BOMB_PENALTY);
        sfx('land_bad'); if (pid === 0) haptic([40]);
        it._flash = 'bomb';
    } else {
        _score[pid] += COIN_VALUE;
        sfx('coin_gain'); if (pid === 0) haptic([12]);
    }
    _flash[pid] = { type: it.bomb ? 'bomb' : 'coin', t: 0.35 };
}

// ── Bot ───────────────────────────────────────────────────────────────────────
function _botUpdate(dt) {
    const arr = _items[1];
    // Find the most urgent item: lowest coin to grab, or a bomb to dodge.
    let targetCoin = null, dodge = null;
    for (const it of arr) {
        if (it.y < 0.2 || it.y > BASKET_Y + 0.05) continue;
        if (it.bomb) {
            if (Math.abs(it.x - _basket[1]) < BASKET_W && (!dodge || it.y > dodge.y)) dodge = it;
        } else if (!targetCoin || it.y > targetCoin.y) {
            targetCoin = it;
        }
    }
    _botRetargetIn -= dt;
    if (_botRetargetIn <= 0) {
        _botRetargetIn = 0.12 + (1 - _botSkill) * 0.25;   // slower reactions at low skill
        const err = (1 - _botSkill) * 0.22 * (Math.random() + Math.random() - 1);
        if (targetCoin) _botTarget = targetCoin.x + err;
        if (dodge && (!targetCoin || dodge.y > targetCoin.y - 0.1)) {
            // sidestep the bomb
            _botTarget = dodge.x + (dodge.x < 0.5 ? 0.28 : -0.28) + err;
        }
        _botTarget = Math.max(BASKET_W / 2, Math.min(1 - BASKET_W / 2, _botTarget));
    }
    const speed = (1.6 + _botSkill * 2.4);   // basket tracking speed (half-widths/s)
    const d = _botTarget - _basket[1];
    _basket[1] += Math.max(-speed * dt, Math.min(speed * dt, d));
}

// ── Draw ─────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight, hh = h / 2;
    _ctx.clearRect(0, 0, w, h);

    // Divider
    _ctx.strokeStyle = 'rgba(255,255,255,0.12)'; _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(0, hh); _ctx.lineTo(w, hh); _ctx.stroke();

    // P2 (top), rotated 180°.
    _ctx.save(); _ctx.translate(w, hh); _ctx.rotate(Math.PI); _drawHalf(1, w, hh); _ctx.restore();
    // P1 (bottom).
    _ctx.save(); _ctx.translate(0, hh); _drawHalf(0, w, hh); _ctx.restore();
}

function _drawHalf(pid, w, hh) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    // Faint side tint
    _ctx.fillStyle = pid === 0 ? 'rgba(255,90,90,0.05)' : 'rgba(90,155,255,0.05)';
    _ctx.fillRect(0, 0, w, hh);

    const R = ITEM_R * w;
    for (const it of _items[pid]) {
        const x = it.x * w, y = it.y * hh;
        if (it.bomb) _drawBomb(x, y, R);
        else _drawCoin(x, y, R);
    }

    // Basket
    const bx = _basket[pid] * w, by = BASKET_Y * hh;
    const bw = BASKET_W * w;
    _ctx.fillStyle = accent;
    _ctx.beginPath();
    _ctx.moveTo(bx - bw / 2, by);
    _ctx.lineTo(bx + bw / 2, by);
    _ctx.lineTo(bx + bw * 0.38, by + R * 1.7);
    _ctx.lineTo(bx - bw * 0.38, by + R * 1.7);
    _ctx.closePath(); _ctx.fill();
    _ctx.fillStyle = 'rgba(255,255,255,0.25)';
    _ctx.fillRect(bx - bw / 2, by - 3, bw, 4);

    // Flash feedback
    const fl = _flash[pid];
    if (fl && fl.t > 0) {
        _ctx.globalAlpha = Math.min(1, fl.t * 2);
        _ctx.fillStyle = fl.type === 'bomb' ? '#ef4444' : '#fbbf24';
        _ctx.font = '900 26px "Bebas Neue", sans-serif';
        _ctx.textAlign = 'center';
        _ctx.fillText(fl.type === 'bomb' ? `-${BOMB_PENALTY}` : `+${COIN_VALUE}`, bx, by - R);
        _ctx.globalAlpha = 1;
        fl.t -= 0.016;
        if (fl.t <= 0) _flash[pid] = null;
    }

    // Score
    _ctx.fillStyle = accent;
    _ctx.font = '900 30px "Bebas Neue", sans-serif';
    _ctx.textAlign = 'left'; _ctx.textBaseline = 'top';
    _ctx.fillText(`P${pid + 1}: ${_score[pid]}`, 14, 12);
}

function _drawCoin(x, y, r) {
    _ctx.beginPath(); _ctx.arc(x, y, r, 0, Math.PI * 2);
    _ctx.fillStyle = '#fbbf24'; _ctx.fill();
    _ctx.lineWidth = 2; _ctx.strokeStyle = '#b8860b'; _ctx.stroke();
    _ctx.fillStyle = 'rgba(255,255,255,0.55)';
    _ctx.beginPath(); _ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.28, 0, Math.PI * 2); _ctx.fill();
    _ctx.fillStyle = '#7a5200'; _ctx.font = `900 ${Math.round(r * 1.2)}px "Bebas Neue", sans-serif`;
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.fillText('$', x, y + 1);
}

function _drawBomb(x, y, r) {
    // Spiky shape so it reads as "danger" by form, not color alone (R4).
    _ctx.beginPath();
    const spikes = 9;
    for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 === 0 ? r * 1.15 : r * 0.78;
        const a = (i / (spikes * 2)) * Math.PI * 2;
        const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
        if (i === 0) _ctx.moveTo(px, py); else _ctx.lineTo(px, py);
    }
    _ctx.closePath();
    _ctx.fillStyle = '#1f2430'; _ctx.fill();
    _ctx.lineWidth = 2; _ctx.strokeStyle = '#ef4444'; _ctx.stroke();
    _ctx.fillStyle = '#ef4444';
    _ctx.beginPath(); _ctx.arc(x, y, r * 0.34, 0, Math.PI * 2); _ctx.fill();
}

// ── End ─────────────────────────────────────────────────────────────────────
function _finish() {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const winner = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = winner < 0
        ? `DRAW! ${_score[0]}-${_score[1]}`
        : `P${winner + 1} WINS! ${_score[0]}-${_score[1]}`;
    sfx(winner < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winner); }, 1500);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _t = 0;
    _items = [[], []]; _flash[0] = _flash[1] = null;
}
