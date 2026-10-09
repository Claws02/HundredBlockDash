// ============================================================
// KEEP UP — juggle & sustain. Orbs fall down your half; tap one to punt it back
// up. Every hit scores. Let one hit the floor and your combo resets. A second
// orb joins after a while, and later a 💣 you must let fall — tap it and you
// lose points. Most points in 30 s wins.
//
// Verb: sustain under compounding load. Meteor Dodge is about avoiding things
// and Loot Catch is about intercepting them; this is the only game where the
// same object stays in play and your own success is what makes it harder —
// each punt sends the orb back for another decision.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables (all rates per SECOND — R1) ─────────────────────────────────────
const GAME_TIME    = 30;
const GRAVITY      = 1.55;   // half-heights per second²
const PUNT_V       = -0.95;  // upward velocity applied by a hit
const PUNT_SPREAD  = 0.30;   // horizontal kick from an off-centre hit
const ORB_R        = 0.075;  // radius as a fraction of the half's width
const TAP_FORGIVE  = 1.85;   // tap radius multiplier — generous on purpose (§4)
const SECOND_ORB_T = 10;     // s before a second orb joins
const BOMB_T       = 17;     // s before bombs start appearing
const BOMB_EVERY   = 6.5;    // s between bombs
const BOMB_PENALTY = 3;
const COMBO_STEP   = 5;      // hits per combo tier
const DROP_PENALTY = 0;      // dropping costs no points — it costs your combo

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;

let _orbs   = [[], []];     // { x, y, vx, vy, bomb, life }
let _score  = [0, 0];
let _combo  = [0, 0];
let _best   = [0, 0];
let _flash  = [0, 0];
let _flashTxt = ['', ''];
let _nextBomb = BOMB_T;
let _spawned2 = false;
let _botCool = [0, 0];

const _cleanups = [];
const _timers   = [];
function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0; _elapsed = 0;
    _score = [0, 0]; _combo = [0, 0]; _best = [0, 0];
    _flash = [0, 0]; _flashTxt = ['', ''];
    _nextBomb = BOMB_T; _spawned2 = false; _botCool = [0, 0];
    _orbs = [[], []];
    registerMinigameCleanup(_destroy);
    // Both halves get an identical opening orb (R5 symmetry).
    for (let p = 0; p < 2; p++) _orbs[p].push(_mkOrb(0.5, 0.25, false));
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _af = requestAnimationFrame(_tick);
    }));
}

function _mkOrb(x, y, bomb) {
    return { x, y, vx: (Math.random() - 0.5) * 0.18, vy: 0, bomb: !!bomb };
}

// ── DOM ──────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;background:#0b1020;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const rect = _overlay.getBoundingClientRect();
        const w = _overlay.clientWidth, h = _overlay.clientHeight, hh = h / 2;
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const pid = sy > hh ? 0 : 1;
        if (pid === 1 && _isBot) return;
        // Half-local fractions; the top half is drawn rotated 180°.
        const lx = (pid === 0 ? sx : w - sx) / w;
        const ly = (pid === 0 ? sy - hh : hh - sy) / hh;
        _hit(pid, lx, ly, hh / w);
    };
    _overlay.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'TAP TO KEEP IT UP!';
}

function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
}

// ── Hit resolution ───────────────────────────────────────────────────────────
// aspect = halfHeight / width, used so the hit test is circular on screen.
function _hit(pid, lx, ly, aspect) {
    const list = _orbs[pid];
    let bestI = -1, bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
        const o = list[i];
        const d = Math.hypot(lx - o.x, (ly - o.y) * aspect);
        if (d < ORB_R * TAP_FORGIVE && d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI < 0) return;
    const o = list[bestI];

    if (o.bomb) {
        _score[pid] = Math.max(0, _score[pid] - BOMB_PENALTY);
        _combo[pid] = 0;
        _flash[pid] = 0.5; _flashTxt[pid] = `💣 −${BOMB_PENALTY}`;
        sfx('land_bad'); if (pid === 0) haptic([80]);
        list.splice(bestI, 1);
        return;
    }

    // Punt: off-centre hits add sideways drift, so control is a skill.
    o.vy = PUNT_V;
    o.vx += (o.x - lx) * PUNT_SPREAD * 6;
    o.vx = Math.max(-0.75, Math.min(0.75, o.vx));

    _combo[pid]++;
    _best[pid] = Math.max(_best[pid], _combo[pid]);
    const tier = 1 + Math.floor(_combo[pid] / COMBO_STEP);   // 1, 2, 3…
    _score[pid] += tier;
    _flash[pid] = 0.32;
    _flashTxt[pid] = tier > 1 ? `+${tier}  ×${tier}` : `+${tier}`;
    sfx(tier > 1 ? 'coin_gain' : 'land_good');
    if (pid === 0) haptic([12]);
}

// ── Loop ─────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    // Escalation — identical on both halves.
    if (!_spawned2 && _elapsed >= SECOND_ORB_T) {
        _spawned2 = true;
        for (let p = 0; p < 2; p++) _orbs[p].push(_mkOrb(0.35 + Math.random() * 0.3, 0.1, false));
        sfx('boost');
    }
    if (_elapsed >= _nextBomb && _elapsed < GAME_TIME - 3) {
        _nextBomb = _elapsed + BOMB_EVERY;
        for (let p = 0; p < 2; p++) _orbs[p].push(_mkOrb(0.25 + Math.random() * 0.5, 0.05, true));
        sfx('land_bad');
    }

    const w = _overlay ? _overlay.clientWidth : 1;
    const hh = _overlay ? _overlay.clientHeight / 2 : 1;
    const aspect = hh / w;

    for (let p = 0; p < 2; p++) {
        const list = _orbs[p];
        for (let i = list.length - 1; i >= 0; i--) {
            const o = list[i];
            o.vy += GRAVITY * dt;
            o.x  += o.vx * dt;
            o.y  += o.vy * dt;
            // Walls
            if (o.x < ORB_R)     { o.x = ORB_R;     o.vx = Math.abs(o.vx) * 0.85; }
            if (o.x > 1 - ORB_R) { o.x = 1 - ORB_R; o.vx = -Math.abs(o.vx) * 0.85; }
            // Ceiling / floor. ORB_R is a fraction of the half's WIDTH, and o.y is
            // a fraction of its HEIGHT, so convert: r_height = ORB_R / aspect.
            const rY = ORB_R / aspect;
            if (o.y < rY) { o.y = rY; o.vy = Math.abs(o.vy) * 0.5; }
            if (o.y > 1 + rY) {
                list.splice(i, 1);
                if (o.bomb) continue;                 // letting a bomb fall is correct
                _combo[p] = 0;
                _score[p] = Math.max(0, _score[p] - DROP_PENALTY);
                _flash[p] = 0.5; _flashTxt[p] = 'DROPPED!';
                if (p === 0) { sfx('coin_loss'); haptic([60]); }
                // Always keep at least one live orb per half.
                list.push(_mkOrb(0.3 + Math.random() * 0.4, 0.05, false));
            }
        }
        // Safety net: never leave a half with nothing to hit.
        if (list.filter(o => !o.bomb).length === 0) list.push(_mkOrb(0.5, 0.05, false));
        if (_flash[p] > 0) _flash[p] = Math.max(0, _flash[p] - dt);
    }

    if (_isBot) _botUpdate(dt, aspect);

    const left = Math.max(0, GAME_TIME - _elapsed);
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = `${Math.ceil(left)}s   P1 ${_score[0]} · ${_score[1]} P2`;

    if (_elapsed >= GAME_TIME) {
        _finish(_score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1);
        return;
    }
    _draw();
}

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// Punts the lowest orb once it drops past a skill-scaled reaction line, with a
// chance to whiff entirely and a chance to mistakenly swat a bomb at low skill.
function _botUpdate(dt, aspect) {
    const pid = 1;
    _botCool[pid] -= dt;
    if (_botCool[pid] > 0) return;

    const list = _orbs[pid];
    if (!list.length) return;
    // Where the bot chooses to strike. Counter-intuitively, punting LATE (low on
    // screen) is the stronger play: the orb re-enters the strike zone sooner, so
    // you get more hits per second and a longer combo. Skill therefore raises
    // this line — a high-skill bot lets the orb fall and takes the risk, a
    // low-skill bot swats early and safely, and scores less for it.
    // (Measured: the original mapping was inverted, and easy out-scored hard
    // 136 to 95.)
    const line = 0.48 + _botSkill * 0.26;
    let target = null;
    for (const o of list) {
        if (o.y < line) continue;
        if (o.bomb && Math.random() > (1 - _botSkill) * 0.22) continue;   // usually avoids bombs
        if (!target || o.y > target.y) target = o;
    }
    if (!target) return;
    if (Math.random() < (1 - _botSkill) * 0.30) { _botCool[pid] = 0.18; return; }   // whiff
    const err = (1 - _botSkill) * 0.10 * (Math.random() + Math.random() - 1);
    _hit(pid, target.x + err, target.y, aspect);
    _botCool[pid] = 0.10 + (1 - _botSkill) * 0.24;
}

// ── Draw ─────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);

    _ctx.save();
    _ctx.translate(w, h / 2); _ctx.rotate(Math.PI);
    _drawHalf(1, w, h / 2);
    _ctx.restore();

    _ctx.save();
    _ctx.translate(0, h / 2);
    _drawHalf(0, w, h / 2);
    _ctx.restore();

    _ctx.strokeStyle = 'rgba(255,255,255,0.14)'; _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(0, h / 2); _ctx.lineTo(w, h / 2); _ctx.stroke();
}

function _drawHalf(pid, w, h) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    const r = ORB_R * w;

    // Floor line — crossing it is what costs you.
    _ctx.strokeStyle = 'rgba(248,113,113,0.35)'; _ctx.lineWidth = 2;
    _ctx.setLineDash([7, 5]);
    _ctx.beginPath(); _ctx.moveTo(0, h - 6); _ctx.lineTo(w, h - 6); _ctx.stroke();
    _ctx.setLineDash([]);

    for (const o of _orbs[pid]) {
        const cx = o.x * w, cy = o.y * h;
        if (o.bomb) {
            // Bombs read by SHAPE (spiky) and glyph, not colour alone (§4).
            _ctx.beginPath();
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * Math.PI * 2;
                const rr = i % 2 === 0 ? r * 1.05 : r * 0.72;
                const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
                i === 0 ? _ctx.moveTo(px, py) : _ctx.lineTo(px, py);
            }
            _ctx.closePath();
            _ctx.fillStyle = '#3b0d0d'; _ctx.fill();
            _ctx.strokeStyle = '#ef4444'; _ctx.lineWidth = 2.5; _ctx.stroke();
            _ctx.font = `${Math.round(r * 1.1)}px system-ui, sans-serif`;
            _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
            _ctx.fillText('💣', cx, cy);
        } else {
            const g = _ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.15, cx, cy, r);
            g.addColorStop(0, '#fff7d6'); g.addColorStop(1, accent);
            _ctx.beginPath(); _ctx.arc(cx, cy, r, 0, Math.PI * 2);
            _ctx.fillStyle = g; _ctx.fill();
            _ctx.strokeStyle = 'rgba(255,255,255,0.55)'; _ctx.lineWidth = 2; _ctx.stroke();
        }
    }

    // HUD
    _ctx.textAlign = 'left'; _ctx.textBaseline = 'top';
    _ctx.font = '700 14px Nunito, sans-serif'; _ctx.fillStyle = accent;
    _ctx.fillText(`P${pid + 1}`, 12, 8);
    _ctx.textAlign = 'right';
    _ctx.font = '900 24px "Bebas Neue", sans-serif'; _ctx.fillStyle = accent;
    _ctx.fillText(`${_score[pid]}`, w - 12, 4);
    if (_combo[pid] >= COMBO_STEP) {
        _ctx.font = '900 13px "Bebas Neue", sans-serif'; _ctx.fillStyle = '#fbbf24';
        _ctx.fillText(`COMBO ${_combo[pid]}`, w - 12, 30);
    }

    if (_flash[pid] > 0 && _flashTxt[pid]) {
        _ctx.globalAlpha = Math.min(1, _flash[pid] * 2.4);
        _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
        _ctx.font = '900 24px "Bebas Neue", sans-serif';
        _ctx.fillStyle = _flashTxt[pid].startsWith('DROP') || _flashTxt[pid].startsWith('💣')
            ? '#f87171' : '#fbbf24';
        _ctx.fillText(_flashTxt[pid], w / 2, h * 0.16);
        _ctx.globalAlpha = 1;
    }

    _ctx.font = '600 10px Nunito, sans-serif';
    _ctx.fillStyle = 'rgba(255,255,255,0.32)';
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'bottom';
    _ctx.fillText('tap orbs · let 💣 fall', w / 2, h - 12);
}

// ── End ──────────────────────────────────────────────────────────────────────
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = winnerId < 0
        ? `DRAW — ${_score[0]} EACH`
        : `P${winnerId + 1} WINS — ${_score[winnerId]} PTS (BEST COMBO ${_best[winnerId]})`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1400);
}

function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _elapsed = 0;
    _orbs = [[], []];
}
