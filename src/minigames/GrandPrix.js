// ============================================================
// GRAND PRIX — one track, one pedal.
//
// There is no steering and no brake. You hold your half to open the throttle
// and you let go to slow down, and that is the entire control scheme. The game
// is in the corners: each one has a speed it can be taken at, and arriving over
// that speed spins you out for a second. So the skill is knowing when to lift —
// braking early costs you a tenth, braking late costs you a second.
//
// Both players race the SAME track, and each half renders it from that player's
// own end with both cars on it (R5) — so you can always see your rival's car
// and how far up the road they are, without reading anything upside down.
//
// Comeback (§3): the trailing car gets a slipstream. A driver who spins once is
// still in it; a driver who spins twice is not, which is the right shape.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables (units are metres and metres/second) ───────────────────────────
const TRACK_LEN   = 2400;
const V_MAX       = 268;
const ACCEL       = 152;
const DRAG_OFF    = 205;   // deceleration with the throttle shut
const DRAG_ON     = 26;    // natural drag while accelerating (caps top speed)
const SPIN_MS     = 950;
const SLIP_GAIN   = 0.13;  // top-speed bonus for the trailing car
const SLIP_RANGE  = 260;   // m within which the slipstream applies
const M_PER_PX    = 0.74;  // road scale: metres per screen pixel
const MATCH_TIME  = 62;    // s ceiling; furthest down the road takes it

// ── Module state ────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;
let _W = 0, _H = 0;
let _track = null;          // [{ start, end, limit, bend }]
let _cars = null;           // per player
let _held = [false, false];
// The braking point for the corner the bot is currently approaching. Committed
// ONCE per corner: rolling it per frame made the throttle stutter at the
// randomness rate instead of at the skill rate, and the two tiers measured
// identically because of it.
let _botPlan = null;        // { segStart, brakeAt }
const _cleanups = [];
const _timers   = [];

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Track ───────────────────────────────────────────────────────────────────
//
// Alternating straights and corners, with the corners getting tighter as the
// lap goes on so the last third is where a race is actually won.
function _buildTrack() {
    const segs = [];
    let d = 0, i = 0;
    while (d < TRACK_LEN) {
        const late = d / TRACK_LEN;
        const straight = 150 + Math.random() * 130;
        segs.push({ start: d, end: d + straight, limit: Infinity, bend: 0 });
        d += straight;
        if (d >= TRACK_LEN) break;
        // Kept shorter than the visible road ahead, so a corner never fills the
        // whole view — you should always be able to see its exit.
        const corner = 62 + Math.random() * 52;
        // Tightest corners late: 165 m/s early down to about 95 m/s at the end.
        const limit  = 168 - late * 74 - Math.random() * 14;
        segs.push({ start: d, end: d + corner, limit, bend: (i % 2 ? 1 : -1) * (0.55 + Math.random() * 0.5) });
        d += corner;
        i++;
    }
    segs[segs.length - 1].end = Math.max(segs[segs.length - 1].end, TRACK_LEN + 120);
    return segs;
}

function _segAt(d) {
    for (const s of _track) if (d >= s.start && d < s.end) return s;
    return _track[_track.length - 1];
}

// Lateral offset of the road centreline at distance d, so corners visibly bend.
function _bendAt(d) {
    let x = 0;
    for (const s of _track) {
        if (!s.bend) continue;
        if (d <= s.start) break;
        const t = Math.min(1, (d - s.start) / (s.end - s.start));
        x += s.bend * 46 * Math.sin(t * Math.PI);
    }
    return x;
}

// Distance to the next corner whose limit is below `v`, or Infinity.
function _nextCorner(d) {
    for (const s of _track) {
        if (s.limit === Infinity || s.end <= d) continue;
        return { seg: s, gap: Math.max(0, s.start - d) };
    }
    return null;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _track = _buildTrack();
    _cars = [0, 1].map(() => ({ d: 0, v: 0, spinUntil: 0, spin: 0, spins: 0, finished: 0 }));
    _held = [false, false];
    _botPlan = null;
    _last = 0; _elapsed = 0;
    registerMinigameCleanup(_destroy);           // R3
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _say('HOLD FOR GAS — LIFT FOR CORNERS');
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
        'background:linear-gradient(180deg,#0b1220 0%,#131c2e 50%,#0b1220 100%);';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    const half = e => e.clientY < _overlay.clientHeight / 2 ? 1 : 0;
    const down = e => {
        if (_done) return;
        e.preventDefault();
        const pid = half(e);
        if (pid === 1 && _isBot) return;
        _held[pid] = true;
        if (pid === 0) haptic([8]);
    };
    // A pointer that leaves the surface must not leave the throttle stuck open.
    const up = e => {
        if (_done) return;
        const pid = half(e);
        if (pid === 1 && _isBot) return;
        _held[pid] = false;
    };
    _overlay.addEventListener('pointerdown', down);
    _overlay.addEventListener('pointerup', up);
    _overlay.addEventListener('pointercancel', up);
    _overlay.addEventListener('pointerleave', up);
    _cleanups.push(() => {
        _overlay.removeEventListener('pointerdown', down);
        _overlay.removeEventListener('pointerup', up);
        _overlay.removeEventListener('pointercancel', up);
        _overlay.removeEventListener('pointerleave', up);
    });

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

function _say(t) {
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = t;
}

// ── Physics (R1) ────────────────────────────────────────────────────────────
function _drive(pid, dt, now) {
    const c = _cars[pid];
    if (c.finished) return;

    if (now < c.spinUntil) { c.spin += dt * 13; c.v = 0; return; }
    c.spin = 0;

    const other = _cars[1 - pid];
    const behind = other.d - c.d;
    const slip = (behind > 12 && behind < SLIP_RANGE) ? 1 + SLIP_GAIN : 1;

    if (_held[pid]) {
        c.v += ACCEL * dt;
        c.v -= DRAG_ON * dt * (c.v / (V_MAX * slip));
        c.v = Math.min(c.v, V_MAX * slip);
    } else {
        c.v = Math.max(0, c.v - DRAG_OFF * dt);
    }

    c.d += c.v * dt;

    // Corner check: over the limit anywhere inside a corner and you're gone.
    const seg = _segAt(c.d);
    if (seg.limit !== Infinity && c.v > seg.limit) {
        c.spinUntil = now + SPIN_MS;
        c.spins++;
        c.v = 0;
        sfx('land_bad');
        if (pid === 0) haptic([40, 60, 40]);
    }

    if (c.d >= TRACK_LEN) {
        c.d = TRACK_LEN;
        c.finished = _elapsed;
        sfx(pid === 0 ? 'mg_win' : 'mg_lose');
    }
}

// ── Bot (§5) ────────────────────────────────────────────────────────────────
//
// The bot drives the same single pedal a player does. Skill is entirely in WHEN
// it lifts: a hard bot brakes to just under the limit and gets back on the gas
// immediately, an easy one misjudges the braking point and spins for it.
function _botStep(now) {
    if (!_isBot) return;
    const c = _cars[1];
    if (c.finished || now < c.spinUntil) { _held[1] = false; _botPlan = null; return; }

    const seg = _segAt(c.d);
    if (seg.limit !== Infinity) {
        // In the corner: hold it just under the limit. The cushion is the skill
        // — a hard bot rides the limit, an easy one dawdles well below it.
        _botPlan = null;
        const cushion = 6 + (1 - _botSkill) * 30;
        _held[1] = c.v < seg.limit - cushion;
        return;
    }

    const nc = _nextCorner(c.d);
    if (!nc) { _held[1] = true; _botPlan = null; return; }

    // The MARGIN is committed once per corner; the braking distance itself is
    // recomputed every frame from the speed the car is actually doing. Getting
    // this split wrong both ways has now been measured: rolling the margin per
    // frame made the throttle stutter at the randomness rate and both tiers
    // came out identical, and computing the distance once from V_MAX had it
    // braking from the start of every straight — a 64 s lap at both tiers.
    if (!_botPlan || _botPlan.segStart !== nc.seg.start) {
        const late = Math.random() < (0.24 - _botSkill * 0.21);     // 19% easy → 6% hard
        _botPlan = {
            segStart: nc.seg.start,
            // Metres of cushion beyond the physics. Hard brakes late and tidy;
            // easy leaves a hedge, and now and then leaves it far too late.
            // Kept small on purpose. Because `need` is recomputed from live
            // speed, lifting drops the required distance and the bot settles
            // into a cruise at whatever speed satisfies gap ≈ need + margin —
            // so a big margin doesn't make it cautious, it makes it crawl. At
            // 46 the easy bot never finished the lap inside the ceiling.
            margin: late ? -26 : (3 + (1 - _botSkill) * 20 + Math.random() * 10),
        };
    }
    const need = Math.max(0, (c.v * c.v - nc.seg.limit * nc.seg.limit) / (2 * DRAG_OFF));
    _held[1] = nc.gap > need + _botPlan.margin;
}

// ── Loop ────────────────────────────────────────────────────────────────────
function _tick(now) {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const dt = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    _botStep(now);
    _drive(0, dt, now);
    _drive(1, dt, now);

    if (_cars[0].finished && _cars[1].finished) {
        _finish(_cars[0].finished <= _cars[1].finished ? 0 : 1); return;
    }
    // One car home: give the other a moment to cross, then call it.
    if (_cars[0].finished || _cars[1].finished) {
        const w = _cars[0].finished ? 0 : 1;
        if (_elapsed - _cars[w].finished > 2.2) { _finish(w); return; }
    }
    if (_elapsed >= MATCH_TIME) {
        const [a, b] = [_cars[0].d, _cars[1].d];
        _finish(Math.abs(a - b) < 6 ? -1 : (a > b ? 0 : 1));
        return;
    }
    _draw();
}

// ── Draw ────────────────────────────────────────────────────────────────────
function _draw() {
    const ctx = _ctx;
    ctx.clearRect(0, 0, _W, _H);
    _drawHalf(0);
    ctx.save(); ctx.translate(_W, _H); ctx.rotate(Math.PI); _drawHalf(1); ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, _H / 2); ctx.lineTo(_W, _H / 2); ctx.stroke();
}

// Drawn in P1's frame (the bottom half); the caller rotates it for P2, so both
// views are identical by construction.
function _drawHalf(pid) {
    const ctx = _ctx;
    const me = _cars[pid], them = _cars[1 - pid];
    const now = performance.now();

    // The player's car sits at a fixed point near their own edge and the road
    // comes at them. R1b: clear of the outer edge where the status pill floats.
    const carY   = _H - 172;
    const topY   = _H / 2 + 6;
    const halfW  = _W * 0.30;

    ctx.save();
    ctx.beginPath(); ctx.rect(0, topY, _W, _H - topY); ctx.clip();

    // Verge
    ctx.fillStyle = '#16301f';
    ctx.fillRect(0, topY, _W, _H - topY);

    // Road, sampled every few pixels from the player's car up the screen.
    const STEP = 6;
    const cx = d => _W / 2 + (_bendAt(d) - _bendAt(me.d));

    ctx.beginPath();
    for (let y = carY; y >= topY - STEP; y -= STEP) {
        const d = me.d + (carY - y) * M_PER_PX;
        ctx.lineTo(cx(d) - halfW, y);
    }
    for (let y = topY - STEP; y <= carY; y += STEP) {
        const d = me.d + (carY - y) * M_PER_PX;
        ctx.lineTo(cx(d) + halfW, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#23262e'; ctx.fill();

    // Corner zones, each filled as ONE polygon following the road edges. Doing
    // it as a stack of per-row rects made every row's alpha compound where they
    // overlapped, and the corner came out looking like decking rather than a
    // painted zone.
    for (const seg of _track) {
        if (seg.limit === Infinity) continue;
        const yEnd   = carY - (seg.start - me.d) / M_PER_PX;   // nearer the car
        const yStart = carY - (seg.end   - me.d) / M_PER_PX;   // further up the road
        if (yEnd < topY || yStart > carY) continue;
        const y0 = Math.max(topY, yStart), y1 = Math.min(carY, yEnd);
        ctx.beginPath();
        for (let y = y1; y >= y0 - STEP; y -= STEP) ctx.lineTo(cx(me.d + (carY - y) * M_PER_PX) - halfW, y);
        for (let y = y0 - STEP; y <= y1; y += STEP) ctx.lineTo(cx(me.d + (carY - y) * M_PER_PX) + halfW, y);
        ctx.closePath();
        ctx.fillStyle = me.v > seg.limit ? 'rgba(248,80,80,.44)' : 'rgba(251,191,36,.30)';
        ctx.fill();

        // Chevrons pointing the way the road bends, so it reads as a corner and
        // not merely as a coloured stretch of tarmac.
        const dir = Math.sign(seg.bend) || 1;
        for (let y = y1 - 18; y > y0; y -= 34) {
            const c0 = cx(me.d + (carY - y) * M_PER_PX);
            ctx.strokeStyle = 'rgba(255,255,255,.34)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(c0 - dir * 16, y + 9);
            ctx.lineTo(c0 + dir * 12, y);
            ctx.lineTo(c0 - dir * 16, y - 9);
            ctx.stroke();
        }
    }

    // Lane dashes, scrolling with distance so speed is legible without the HUD.
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3;
    ctx.setLineDash([16, 22]);
    ctx.lineDashOffset = (me.d / M_PER_PX) % 38;
    ctx.beginPath();
    for (let y = carY; y >= topY; y -= STEP) {
        const d = me.d + (carY - y) * M_PER_PX;
        y === carY ? ctx.moveTo(cx(d), y) : ctx.lineTo(cx(d), y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Corner warning boards, placed ahead of each corner entry.
    for (const seg of _track) {
        if (seg.limit === Infinity) continue;
        const ahead = seg.start - me.d;
        if (ahead < -20 || ahead > (carY - topY) * M_PER_PX) continue;
        const y = carY - ahead / M_PER_PX;
        const bx = cx(seg.start) + halfW + 8;
        ctx.fillStyle = 'rgba(251,191,36,.9)';
        _round(ctx, bx, y - 11, 40, 22, 5); ctx.fill();
        ctx.fillStyle = '#231a02';
        ctx.font = '900 13px "Bebas Neue", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.round(seg.limit)), bx + 20, y);
    }

    // Finish line if it's in view.
    const finAhead = TRACK_LEN - me.d;
    if (finAhead > -30 && finAhead < (carY - topY) * M_PER_PX) {
        const y = carY - finAhead / M_PER_PX;
        for (let k = 0; k < 10; k++) {
            ctx.fillStyle = k % 2 ? '#fff' : '#111';
            ctx.fillRect(cx(TRACK_LEN) - halfW + k * (halfW * 2 / 10), y - 7, halfW * 2 / 10, 14);
        }
    }

    // The rival's car, on the same road, wherever they actually are.
    const gap = them.d - me.d;
    const theirY = carY - gap / M_PER_PX;
    if (theirY > topY - 30 && theirY < _H) {
        _car(ctx, cx(them.d) + (halfW * 0.42), theirY, 1 - pid, them.spin, 0.85);
    } else {
        // Off-screen: an arrow and the gap, so you always know where they are.
        const upfield = gap > 0;
        const ay = upfield ? topY + 16 : _H - 176;
        ctx.fillStyle = (1 - pid) === 0 ? 'rgba(255,90,90,.9)' : 'rgba(90,155,255,.9)';
        ctx.beginPath();
        ctx.moveTo(_W - 44, ay + (upfield ? -8 : 8));
        ctx.lineTo(_W - 56, ay + (upfield ? 6 : -6));
        ctx.lineTo(_W - 32, ay + (upfield ? 6 : -6));
        ctx.closePath(); ctx.fill();
        ctx.font = '800 12px "Nunito", system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,.8)';
        ctx.fillText(`${Math.abs(Math.round(gap))}m`, _W - 44, ay + (upfield ? 18 : -18));
    }

    // Your car.
    _car(ctx, cx(me.d) - (halfW * 0.42), carY, pid, me.spin, 1);

    // Speed streaks while on the gas — the sense of pace, cheaply.
    if (_held[pid] && me.v > V_MAX * 0.5 && now % 2 < 1.2) {
        ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 2;
        for (let k = 0; k < 5; k++) {
            const sx = cx(me.d) + (Math.random() - 0.5) * halfW * 1.7;
            const sy = topY + Math.random() * (carY - topY);
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + 26); ctx.stroke();
        }
    }
    ctx.restore();

    // ── HUD ────────────────────────────────────────────────────────────────
    const spinning = now < me.spinUntil;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 30px "Bebas Neue", sans-serif';
    ctx.fillStyle = spinning ? '#ef4444' : (pid === 0 ? '#ff6b6b' : '#6bb0ff');
    ctx.fillText(spinning ? 'SPUN OUT!' : `${Math.round(me.v)}`, _W / 2, _H - 118);
    if (!spinning) {
        ctx.font = '800 11px "Nunito", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.fillText('SPEED', _W / 2, _H - 96);
    }

    // Throttle bar: filled while you're on it, so "am I holding?" is never a
    // question, and the corner limit is marked on the same scale.
    // R1b: the throttle bar and the position pips used to sit at H-58 and H-34,
    // where the floating status pill covers them. Everything is above H-56 now.
    const bw = Math.min(_W * 0.62, 250), bx = (_W - bw) / 2, by = _H - 82;
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    _round(ctx, bx, by, bw, 12, 6); ctx.fill();
    ctx.fillStyle = _held[pid] ? '#4ade80' : 'rgba(255,255,255,.30)';
    _round(ctx, bx, by, bw * Math.min(1, me.v / V_MAX), 12, 6); ctx.fill();
    const nc = _nextCorner(me.d);
    if (nc && nc.seg.limit < V_MAX) {
        const lx = bx + bw * (nc.seg.limit / V_MAX);
        ctx.fillStyle = me.v > nc.seg.limit ? '#ef4444' : '#fbbf24';
        ctx.fillRect(lx - 1.5, by - 4, 3, 20);
    }

    // Progress pips down the side, so the race position is readable at a glance.
    const pw = _W * 0.5, px = (_W - pw) / 2;
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    _round(ctx, px, _H - 62, pw, 8, 4); ctx.fill();
    for (let i = 0; i < 2; i++) {
        const f = Math.min(1, _cars[i].d / TRACK_LEN);
        ctx.fillStyle = i === pid ? (pid === 0 ? '#ff5a5a' : '#5a9bff') : 'rgba(255,255,255,.5)';
        ctx.beginPath(); ctx.arc(px + pw * f, _H - 58, 5, 0, Math.PI * 2); ctx.fill();
    }
}

function _car(ctx, x, y, pid, spin, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (spin) ctx.rotate(spin);
    const body = pid === 0 ? '#ff5a5a' : '#5a9bff';
    ctx.fillStyle = '#0d0f14';
    _round(ctx, -15, -22, 30, 44, 7); ctx.fill();
    ctx.fillStyle = body;
    _round(ctx, -12, -19, 24, 38, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    _round(ctx, -8, -12, 16, 12, 3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(-17, -16, 5, 11); ctx.fillRect(12, -16, 5, 11);
    ctx.fillRect(-17, 6, 5, 11);  ctx.fillRect(12, 6, 5, 11);
    ctx.restore();
    ctx.globalAlpha = 1;
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

// ── End (R6) ────────────────────────────────────────────────────────────────
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    _say(winnerId < 0 ? 'PHOTO FINISH — DEAD HEAT!' : `P${winnerId + 1} TAKES THE FLAG! 🏁`);
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    haptic('heavy');
    _after(() => { _destroy(); _onWin(winnerId); }, 1400);
}

// ── Cleanup (R3) ────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _track = null; _cars = null; _held = [false, false]; _botPlan = null;
    _last = 0; _elapsed = 0; _W = 0; _H = 0;
}
