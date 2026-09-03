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
import { registerMinigameCleanup, slotCount, isBotSlot, seatFor } from './MinigameManager.js';
import { zonesFor } from '../config/MinigameLayout.js';
import * as Solo from './SoloArena.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
//
// THIS IS A COIN GAME. Unlike every other minigame, where the winner takes a
// flat reward and the loser gets nothing, both players KEEP EVERY COIN THEY
// CATCH here — the score on screen is real money going into a real purse. So
// the numbers are deliberately much bigger than the old 1-per-coin scoring, and
// the rain is thicker: a good run should be worth several turns of board income,
// and the player who loses still walks away with something to show for it.
const GAME_TIME    = 34;     // seconds — a little longer, it's the payday game
const SPAWN_START  = 0.62;   // s between spawns at the start (was 0.85)
const SPAWN_END    = 0.34;   // s between spawns at the end   (was 0.42)
const FALL_START   = 0.58;   // half-heights per SECOND at the start
const FALL_END     = 1.05;   // half-heights per second at the end
// 0.36, up from 0.26. Play-tested, the basket was never in real danger — you
// could sweep the whole half collecting everything and simply never meet a
// bomb often enough to have to choose. Better than one item in three is now a
// hazard, so a greedy line across the screen actually costs you.
const BOMB_CHANCE  = 0.36;   // probability a spawned item is a bomb
const COIN_VALUE   = 1;
const GEM_VALUE    = 3;      // rarer, worth three coins
const GEM_CHANCE   = 0.14;   // share of non-bomb items that are gems
const BOMB_PENALTY = 2;
// Hard ceiling on what one round can pay out, so a freak run can never hand
// somebody the match off a minigame. Measured: a perfect bot run banks ~70, so
// 30 is a real cap rather than a formality — a good run reaches it with time to
// spare, which is deliberate: it makes the last stretch about the WIN bonus.
// The two other coin games (Tree Climb, Memory Match) use the same number.
const MAX_PAYOUT   = 30;
const BASKET_W     = 0.20;   // basket width as a fraction of half-width
const ITEM_R       = 0.045;  // item radius as a fraction of half-width

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _t = 0;

let _n       = 2;            // slots, not seats
let _items   = [];           // per player: { x, y, vy, bomb } in 0..1 local coords
let _basket  = [];           // per player basket centre x (0..1)
let _score   = [];
let _spawnAcc = 0;
let _dropped  = 0;   // how many items have fallen — the index the seed is read at
let _botTarget = [], _botRetargetIn = [];
let _flash = [];             // per-player catch feedback { type, t }
let _zones = [];             // one rect+rotation per slot, from MinigameLayout

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
    _n = Solo.isSolo() ? 1 : Math.max(2, Math.min(4, slotCount()));
    _last = 0; _t = 0;
    _items  = Array.from({ length: _n }, () => []);
    _basket = new Array(_n).fill(0.5);
    _score  = new Array(_n).fill(0);
    _flash  = new Array(_n).fill(null);
    _botTarget = new Array(_n).fill(0.5);
    _botRetargetIn = new Array(_n).fill(0);
    _spawnAcc = 0; _dropped = 0;
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
        const rect = _overlay.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        // Alone the chute is the whole screen and every finger is yours.
        if (Solo.isSolo()) {
            _basket[0] = Math.max(BASKET_W / 2,
                Math.min(1 - BASKET_W / 2, x / _overlay.clientWidth));
            return;
        }
        const pid = _zoneAt(x, y);
        if (pid < 0 || isBotSlot(pid)) return;
        // Into the zone's own 0..1 x. A far seat holds the screen upside down,
        // so their fraction runs the other way.
        const z = _zones[pid], r = z.rect;
        const lx = z.rot === 180 ? (r.x + r.w - x) / r.w : (x - r.x) / r.w;
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
    _zones = zonesFor(_n, w, h);
}

/** Which slot's zone contains this point, or -1. */
function _zoneAt(x, y) {
    for (let i = 0; i < _zones.length; i++) {
        const r = _zones[i].rect;
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
    }
    return -1;
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
    // One bot per slot: the single-target version steered slot 1 only.
    if (!Solo.isSolo()) {
        for (let pid = 0; pid < _n; pid++) if (isBotSlot(pid)) _botUpdate(pid, dt);
    }
    _draw();
}

function _progress() { return Math.min(_t / GAME_TIME, 1); }

function _update(dt) {
    const p = _progress();
    // Late "gold rush": coins become more common in the final stretch.
    // The late gold rush still tilts toward coins, but less generously — at half
    // the bomb rate the closing stretch was a free-for-all.
    const bombChance = p > 0.75 ? BOMB_CHANCE * 0.72 : BOMB_CHANCE;
    const spawnEvery = SPAWN_START + (SPAWN_END - SPAWN_START) * p;
    const fallSpeed  = FALL_START + (FALL_END - FALL_START) * p;

    _spawnAcc += dt;
    while (_spawnAcc >= spawnEvery) {
        _spawnAcc -= spawnEvery;
        // Mirrored spawn — identical item to both halves for fairness. Across
        // phones the seed does the same job between DEVICES: the same coins,
        // gems and bombs fall on all of them, so the hauls being compared were
        // earned from the same loot.
        // Drawn BY INDEX, not from a running stream: spawns are timer-driven
        // inside an animation frame, so two phones consume a shared stream at
        // different moments and the loot diverges. The 6th item is the 6th item
        // on every phone.
        const rnd  = k => (Solo.isSolo() ? Solo.draw(_dropped * 4 + k) : Math.random());
        const x    = 0.1 + rnd(0) * 0.8;
        const bomb = rnd(1) < bombChance;
        const gem  = !bomb && rnd(2) < GEM_CHANCE;
        const vy   = fallSpeed * (0.9 + rnd(3) * 0.2);
        _dropped++;
        // The same item into every chute: the hauls being compared have to be
        // earned from the same loot, whether that is two players on one screen
        // or four on four phones.
        for (let pid = 0; pid < _n; pid++) _items[pid].push({ x, y: -ITEM_R, vy, bomb, gem });
    }

    for (let pid = 0; pid < _n; pid++) _stepItems(pid, dt);

    const left = Math.ceil(GAME_TIME - _t);
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = Solo.isSolo()
        ? `${left}s   🪙 ${_score[0]}`
        : `${left}s   🪙 ${_score.join(' · ')}`;
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
    const value = it.gem ? GEM_VALUE : COIN_VALUE;
    if (it.bomb) {
        _score[pid] = Math.max(0, _score[pid] - BOMB_PENALTY);
        sfx('land_bad'); if (pid === 0) haptic([40]);
        it._flash = 'bomb';
    } else {
        _score[pid] += value;
        sfx('coin_gain'); if (pid === 0) haptic(it.gem ? [12, 30, 12] : [12]);
    }
    _flash[pid] = { type: it.bomb ? 'bomb' : it.gem ? 'gem' : 'coin', t: 0.35, v: value };
}

// ── Bot ───────────────────────────────────────────────────────────────────────
function _botUpdate(pid, dt) {
    const arr = _items[pid];
    // Find the most urgent item: lowest coin to grab, or a bomb to dodge.
    let targetCoin = null, dodge = null;
    for (const it of arr) {
        if (it.y < 0.2 || it.y > BASKET_Y + 0.05) continue;
        if (it.bomb) {
            if (Math.abs(it.x - _basket[pid]) < BASKET_W && (!dodge || it.y > dodge.y)) dodge = it;
        } else if (!targetCoin || it.y > targetCoin.y) {
            targetCoin = it;
        }
    }
    _botRetargetIn[pid] -= dt;
    if (_botRetargetIn[pid] <= 0) {
        _botRetargetIn[pid] = 0.12 + (1 - _botSkill) * 0.25;   // slower reactions at low skill
        const err = (1 - _botSkill) * 0.22 * (Math.random() + Math.random() - 1);
        if (targetCoin) _botTarget[pid] = targetCoin.x + err;
        if (dodge && (!targetCoin || dodge.y > targetCoin.y - 0.1)) {
            // sidestep the bomb
            _botTarget[pid] = dodge.x + (dodge.x < 0.5 ? 0.28 : -0.28) + err;
        }
        _botTarget[pid] = Math.max(BASKET_W / 2, Math.min(1 - BASKET_W / 2, _botTarget[pid]));
    }
    const speed = (1.6 + _botSkill * 2.4);   // basket tracking speed (half-widths/s)
    const d = _botTarget[pid] - _basket[pid];
    _basket[pid] += Math.max(-speed * dt, Math.min(speed * dt, d));
}

// ── Draw ─────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight, hh = h / 2;
    _ctx.clearRect(0, 0, w, h);

    if (Solo.isSolo()) {
        // No divider, no second chute, no rotation.
        _drawHalf(0, w, h);
        return;
    }

    if (!_zones.length) _zones = zonesFor(_n, w, h);

    _ctx.strokeStyle = 'rgba(255,255,255,0.12)'; _ctx.lineWidth = 2;
    _zones.forEach(z => {
        const r = z.rect;
        _ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    });

    _zones.forEach((z, pid) => {
        const r = z.rect;
        _ctx.save();
        // Loot falls in from above the zone, so the chute is clipped to it.
        _ctx.beginPath(); _ctx.rect(r.x, r.y, r.w, r.h); _ctx.clip();
        if (z.rot === 180) {
            _ctx.translate(r.x + r.w, r.y + r.h);
            _ctx.rotate(Math.PI);
        } else {
            _ctx.translate(r.x, r.y);
        }
        _drawHalf(pid, r.w, r.h);
        _ctx.restore();
    });
}

const SLOT_ACCENT = ['#ff5a5a', '#5a9bff', '#5fd68a', '#ffd45f'];
const SLOT_TINT   = ['rgba(255,90,90,0.05)', 'rgba(90,155,255,0.05)',
                     'rgba(95,214,138,0.05)', 'rgba(255,212,95,0.05)'];

function _drawHalf(pid, w, hh) {
    const accent = SLOT_ACCENT[pid] || '#ffffff';
    // Faint side tint
    _ctx.fillStyle = SLOT_TINT[pid] || 'rgba(255,255,255,0.04)';
    _ctx.fillRect(0, 0, w, hh);

    const R = ITEM_R * w;
    for (const it of _items[pid]) {
        const x = it.x * w, y = it.y * hh;
        if (it.bomb) _drawBomb(x, y, R);
        else if (it.gem) _drawGem(x, y, R);
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
        _ctx.fillStyle = fl.type === 'bomb' ? '#ef4444' : fl.type === 'gem' ? '#67e8f9' : '#fbbf24';
        _ctx.font = '900 26px "Bebas Neue", sans-serif';
        _ctx.textAlign = 'center';
        _ctx.fillText(fl.type === 'bomb' ? `-${BOMB_PENALTY}` : `+${fl.v}`, bx, by - R);
        _ctx.globalAlpha = 1;
        fl.t -= 0.016;
        if (fl.t <= 0) _flash[pid] = null;
    }

    // Score
    _ctx.fillStyle = accent;
    _ctx.font = '900 30px "Bebas Neue", sans-serif';
    _ctx.textAlign = 'left'; _ctx.textBaseline = 'top';
    _ctx.fillText(Solo.isSolo() ? `🪙 ${_score[pid]}` : `${_nameOf(pid)}: ${_score[pid]}`, 14, 12);
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

// A gem is worth three coins. Distinguished by SILHOUETTE (a diamond, not a
// disc) as well as colour, so it reads at a glance and without colour vision.
function _drawGem(x, y, r) {
    const R = r * 1.15;
    _ctx.beginPath();
    _ctx.moveTo(x, y - R);
    _ctx.lineTo(x + R * 0.82, y);
    _ctx.lineTo(x, y + R);
    _ctx.lineTo(x - R * 0.82, y);
    _ctx.closePath();
    _ctx.fillStyle = '#22d3ee'; _ctx.fill();
    _ctx.lineWidth = 2; _ctx.strokeStyle = '#0e7490'; _ctx.stroke();
    _ctx.beginPath();
    _ctx.moveTo(x, y - R); _ctx.lineTo(x - R * 0.3, y - R * 0.1); _ctx.lineTo(x + R * 0.3, y - R * 0.1);
    _ctx.closePath();
    _ctx.fillStyle = 'rgba(255,255,255,0.6)'; _ctx.fill();
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
/**
 * The haul. This game pays what you catch, so the score IS the coins — the
 * ranking uses it to decide the round and the host pays it out on top (see
 * MG_PAYOUT in the registry).
 */
export function soloScore() { return Math.min(_score[0], MAX_PAYOUT); }

/** The outright biggest haul, or -1 if the top is shared. */
function _leader() {
    const best = Math.max(..._score);
    const top = _score.reduce((a, v, i) => (v === best ? a.concat(i) : a), []);
    return top.length === 1 ? top[0] : -1;
}

function _nameOf(pid) {
    const p = state.players[seatFor(pid)];
    return (p && p.name ? p.name : `P${pid + 1}`).toUpperCase();
}

function _finishSolo() {
    if (_done) return;
    _done = true;
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = `YOU CAUGHT ${_score[0]} 🪙 — AND YOU KEEP THEM`;
    sfx('mg_win');
    const banked = soloScore();
    _after(() => { _destroy(); Solo.soloFinish(banked); }, 1400);
}

function _finish() {
    if (_done) return;
    if (Solo.isSolo()) return _finishSolo();
    _done = true;
    state.mgActive = false;
    const winner = _leader();
    const neu = document.getElementById('mg-neutral');
    if (neu) {
        const line = _score.join(' · ');
        neu.textContent = winner < 0
            ? `DRAW! EVERYBODY KEEPS THEIRS — ${line} 🪙`
            : `${_nameOf(winner)} WINS! EVERYBODY KEEPS THEIR COINS — ${line}`;
    }
    sfx(winner < 0 ? 'land_bad' : 'mg_win');
    // Coin game: hand the manager every player's haul so they ALL bank it.
    // Snapshot the scores first — _destroy() clears them.
    const payouts = _score.map(v => Math.min(v, MAX_PAYOUT));
    _after(() => { _destroy(); _onWin(winner, payouts); }, 1500);
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
    _items = []; _flash = []; _zones = [];
}
