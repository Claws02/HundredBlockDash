// ============================================================
// TREE CLIMB — two stems, one race, and a coin for every branch.
//
// A leaf sprouts on the left or the right of your stem. Tap that side to swing
// up onto it. The NEXT leaf does not exist until you are standing on the last
// one, so the game is never a memorised pattern — it is a read-and-react loop
// that gets faster the higher you go.
//
// Tap the wrong side and you slip: a short stun, no height lost. Losing height
// on a mistake would make an early stumble unrecoverable, and the arcade's
// comeback rule (§3) says a behind player must still be able to win.
//
// COIN GAME (R6b): every branch pays, and both players keep what they climbed.
// You are racing for the bonus, not for the right to be paid at all.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ────────────────────────────────────────────────────────────────
const TARGET      = 22;     // branches to the top
// 1 per branch, not 2: at 2 the winner hit the 30 cap every single time, which
// made the payout a flat number instead of a record of how far you got.
const COIN_PER    = 1;      // coins banked per branch
const MAX_PAYOUT  = 30;     // R6b: cap it, matching Loot Catch's ceiling
const SLIP_MS     = 620;    // stun after a wrong tap
const MATCH_TIME  = 40;     // s ceiling; tallest climber takes it
const RISE_TIME   = 0.17;   // s of swing animation per branch
const SPACING     = 74;     // px between branches on the drawn stem

// ── Module state ────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;
let _W = 0, _H = 0;
// Per player: height climbed, the side the pending leaf grew on, animation and
// stun clocks, and the scrolling offset that makes the stem slide past.
let _p = null;
let _botDelay = 0;
const _cleanups = [];
const _timers   = [];

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

function _newClimber() {
    return {
        height: 0,          // branches climbed
        side: Math.random() < 0.5 ? -1 : 1,   // where the current leaf grew: -1 left, +1 right
        rise: 0,            // 0..1 swing progress, 0 when standing
        slipUntil: 0,       // performance.now() while stunned
        shake: 0,           // px of wobble after a slip, decays
        coins: 0,
        lastSide: 0,
    };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _p = [_newClimber(), _newClimber()];
    _last = 0; _elapsed = 0;
    _botDelay = _botReact();
    registerMinigameCleanup(_destroy);           // R3
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        const neu = document.getElementById('mg-neutral');
        if (neu) neu.textContent = 'TAP THE SIDE THE LEAF GREW';
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM (R2) ────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;touch-action:none;' +
        'background:linear-gradient(180deg,#0a1a10 0%,#123021 50%,#0a1a10 100%);';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    // R1a: each player taps in their OWN frame. P2 holds the phone upside down,
    // so their "left" is the screen's right — the side has to be flipped before
    // it is compared with the leaf.
    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const pid = e.clientY < _overlay.clientHeight / 2 ? 1 : 0;
        if (pid === 1 && _isBot) return;
        const half = e.clientX < _overlay.clientWidth / 2 ? -1 : 1;
        _tap(pid, pid === 0 ? half : -half);
    };
    _overlay.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
}

function _resize() {
    if (!_canvas || !_overlay) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);       // R4
    _W = _overlay.clientWidth; _H = _overlay.clientHeight;
    _canvas.width  = Math.round(_W * _dpr);
    _canvas.height = Math.round(_H * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
}

// ── Moves ───────────────────────────────────────────────────────────────────
function _tap(pid, side) {
    const c = _p[pid];
    if (!c || c.rise > 0) return;                       // already swinging
    if (performance.now() < c.slipUntil) return;        // still stunned
    if (c.height >= TARGET) return;

    if (side !== c.side) {
        c.slipUntil = performance.now() + SLIP_MS;
        c.shake = 9;
        sfx('land_bad');
        if (pid === 0) haptic([26, 40, 26]);
        return;
    }
    c.rise = 0.0001;                                    // start the swing
    c.lastSide = c.side;
    sfx('seq_lit');
    if (pid === 0) haptic([12]);
}

// The branch is reached: bank it, and only then grow the next leaf.
function _land(pid) {
    const c = _p[pid];
    c.rise = 0;
    c.height++;
    c.coins = Math.min(MAX_PAYOUT, c.height * COIN_PER);
    // Never three of the same side in a row — a run of them stops being a read
    // and becomes a metronome, which is a different (worse) game.
    let next = Math.random() < 0.5 ? -1 : 1;
    if (next === c.side && next === c.lastSide) next = -next;
    c.side = next;
    if (c.height >= TARGET) { _finish(pid); return; }
    if (pid === 0) sfx('coin_gain');
}

// ── Bot (§5) ────────────────────────────────────────────────────────────────
// The bot reads the same leaf a player does, with a skill-scaled reaction delay
// and a chance of grabbing the wrong side — which stuns it exactly as it would
// a human, so the tiers differ in climbing rate rather than in the rules.
function _botReact() {
    return (0.62 - _botSkill * 0.40 + Math.random() * 0.16) * 1000;
}

function _botStep(dtMs) {
    const c = _p[1];
    if (!c || c.rise > 0 || performance.now() < c.slipUntil || c.height >= TARGET) return;
    _botDelay -= dtMs;
    if (_botDelay > 0) return;
    _botDelay = _botReact();
    const wrong = Math.random() < (0.30 - _botSkill * 0.28);   // 23% easy → 6% hard
    _tap(1, wrong ? -c.side : c.side);
}

// ── Loop (R1) ───────────────────────────────────────────────────────────────
function _tick(now) {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const dt = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    for (let i = 0; i < 2; i++) {
        const c = _p[i];
        if (c.rise > 0) {
            c.rise += dt / RISE_TIME;
            if (c.rise >= 1) _land(i);
        }
        if (c.shake > 0) c.shake = Math.max(0, c.shake - dt * 26);
    }
    if (_isBot) _botStep(dt * 1000);
    if (_done) return;

    if (_elapsed >= MATCH_TIME) { _finishOnHeight(); return; }
    _draw();
}

// ── Draw ────────────────────────────────────────────────────────────────────
function _draw() {
    const ctx = _ctx;
    ctx.clearRect(0, 0, _W, _H);
    _drawHalf(0);
    ctx.save(); ctx.translate(_W, _H); ctx.rotate(Math.PI); _drawHalf(1); ctx.restore();
    _drawDivider();
}

// Everything is drawn in P1's frame — the bottom half — and the caller rotates
// for P2, so the two halves are identical by construction (R5).
function _drawHalf(pid) {
    const ctx = _ctx, c = _p[pid];
    const halfTop = _H / 2;
    const stunned = performance.now() < c.slipUntil;

    // The climber sits at a fixed height and the stem scrolls past, so the
    // sense of climbing comes from the world moving rather than from the
    // character drifting toward an edge it would eventually hit.
    // R1b: kept well clear of the outer edge, where the status pill floats.
    const meY = _H - 168;
    // Offset from centre so the two stems read as two trees. Drawn at the
    // centre they tile into one continuous trunk spanning the whole screen,
    // which looks tidy and is exactly the wrong thing — you are racing your
    // own stem, and the brief is two of them.
    const cx  = _W * 0.37 + (c.shake ? Math.sin(performance.now() / 22) * c.shake : 0);

    // Scroll offset: whole branches climbed, plus the partial swing.
    const climbed = c.height + (c.rise > 0 ? _ease(c.rise) : 0);
    const off = climbed * SPACING;

    // ── Stem ───────────────────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, halfTop, _W, _H - halfTop);
    ctx.clip();

    ctx.fillStyle = '#5b3a1e';
    ctx.fillRect(cx - 17, halfTop - 40, 34, _H - halfTop + 60);
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(cx + 5, halfTop - 40, 8, _H - halfTop + 60);
    // Bark texture, scrolling with the climb so the stem visibly moves.
    ctx.strokeStyle = 'rgba(0,0,0,.20)'; ctx.lineWidth = 2;
    for (let k = -2; k < 14; k++) {
        const y = halfTop + ((k * 46 + (off % 46)) % (_H - halfTop + 92)) - 20;
        ctx.beginPath(); ctx.moveTo(cx - 14, y); ctx.lineTo(cx + 12, y + 7); ctx.stroke();
    }

    // ── Branches already climbed, scrolling down out of view ───────────────
    for (let k = 0; k <= 4; k++) {
        const idx = c.height - k;
        if (idx < 1) break;
        const y = meY + (climbed - idx) * SPACING;
        if (y > _H + 40) continue;
        _branch(ctx, cx, y, _sideOf(pid, idx), 0.5);
    }

    // ── The live leaf: the one thing the player is reading ─────────────────
    if (c.height < TARGET) {
        const y = meY - SPACING + (c.rise > 0 ? _ease(c.rise) * SPACING : 0);
        const pulse = 0.75 + Math.sin(performance.now() / 180) * 0.25;
        _branch(ctx, cx, y, c.side, 1, pulse);
    }

    // ── The climber ────────────────────────────────────────────────────────
    const armSide = c.rise > 0 ? c.lastSide : 0;
    _climber(ctx, cx, meY, pid, armSide, stunned);
    ctx.restore();

    // ── HUD at this player's edge ──────────────────────────────────────────
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 34px "Bebas Neue", sans-serif';
    ctx.fillStyle = pid === 0 ? '#ff6b6b' : '#6bb0ff';
    ctx.fillText(`${c.height}/${TARGET}`, _W / 2, _H - 96);
    ctx.font = '800 14px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = '#fcd34d';
    ctx.fillText(`🪙 ${c.coins}`, _W / 2, _H - 70);

    if (stunned) {
        ctx.font = '900 20px "Bebas Neue", sans-serif';
        ctx.fillStyle = '#ef4444';
        ctx.fillText('SLIPPED!', _W / 2, _H - 124);
    }

    // Left/right tap hints, lit on the side the leaf is on so the control and
    // the answer are never ambiguous — shape and position, not colour (§4).
    for (const s of [-1, 1]) {
        const bx = _W / 2 + s * (_W * 0.30);
        const live = !stunned && c.rise === 0 && s === c.side;
        ctx.globalAlpha = live ? 0.92 : 0.16;
        ctx.fillStyle = '#e7f6cf';
        ctx.beginPath();
        ctx.moveTo(bx + s * 15, _H - 116);
        ctx.lineTo(bx - s * 9, _H - 132);
        ctx.lineTo(bx - s * 9, _H - 100);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
    }
}

// Deterministic side for an already-climbed branch, so the trail below the
// climber doesn't flicker between frames.
function _sideOf(pid, idx) { return ((idx * 7 + pid * 3) % 2) ? 1 : -1; }

function _branch(ctx, cx, y, side, alpha, pulse = 1) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + side * 12, y);
    ctx.lineTo(cx + side * 60, y - 6);
    ctx.stroke();
    // Leaf cluster on the end.
    const lx = cx + side * 74, ly = y - 10;
    ctx.fillStyle = alpha < 1 ? '#3f6b34' : '#6ee06a';
    for (const [ox, oy, r] of [[0, 0, 17 * pulse], [-13 * side, 5, 12 * pulse], [11 * side, 8, 11 * pulse]]) {
        ctx.beginPath(); ctx.ellipse(lx + ox, ly + oy, r, r * 0.72, side * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    if (alpha === 1) {
        ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(lx, ly, 19 * pulse, 14 * pulse, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

function _climber(ctx, cx, y, pid, armSide, stunned) {
    const body = pid === 0 ? '#ff5a5a' : '#5a9bff';
    // Reaching arm, so the swing reads as an action rather than a teleport.
    if (armSide) {
        ctx.strokeStyle = body; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx, y - 6); ctx.lineTo(cx + armSide * 40, y - 26); ctx.stroke();
    }
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(cx, y, 15, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx - 5, y - 5, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 5, y - 5, 3.2, 0, Math.PI * 2); ctx.fill();
    if (stunned) {
        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 3;
        for (let k = 0; k < 3; k++) {
            const a = performance.now() / 160 + k * 2.1;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * 26, y - 26 + Math.sin(a) * 8, 3, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

// A ladder on the centre line showing both climbers, so "am I winning?" is
// answered without either player reading the other's half upside down.
function _drawDivider() {
    const ctx = _ctx, y = _H / 2;
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(_W, y); ctx.stroke();

    const bw = _W * 0.72, bx = (_W - bw) / 2;
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    _round(ctx, bx, y - 7, bw, 14, 7); ctx.fill();
    for (let i = 0; i < 2; i++) {
        const f = Math.min(1, _p[i].height / TARGET);
        ctx.fillStyle = i === 0 ? 'rgba(255,90,90,.85)' : 'rgba(90,155,255,.85)';
        _round(ctx, bx, y - 7 + i * 7, bw * f, 7, 3); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '900 12px "Bebas Neue", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('TOP', bx + bw + 6, y);
}

function _round(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function _ease(t) { const x = Math.min(1, t); return 1 - (1 - x) * (1 - x); }

// ── End (R6 / R6b) ──────────────────────────────────────────────────────────
function _finishOnHeight() {
    const [a, b] = [_p[0].height, _p[1].height];
    _finish(a === b ? -1 : (a > b ? 0 : 1));
}

function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neu = document.getElementById('mg-neutral');
    if (neu) {
        neu.textContent = winnerId < 0
            ? `DEAD HEAT — ${_p[0].height} EACH`
            : `P${winnerId + 1} REACHES THE TOP! 🪙 ${_p[0].coins} · ${_p[1].coins}`;
    }
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    haptic('heavy');
    const payouts = [Math.min(_p[0].coins, MAX_PAYOUT), Math.min(_p[1].coins, MAX_PAYOUT)];
    _after(() => { _destroy(); _onWin(winnerId, payouts); }, 1400);
}

// ── Cleanup (R3) ────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _p = null; _last = 0; _elapsed = 0; _W = 0; _H = 0;
}
