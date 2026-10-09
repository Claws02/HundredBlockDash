// ============================================================
// BOMB PASS — one lit bomb, and neither of you wants it.
//
// The bomb flies between the two halves. While it is in YOUR half, tap to bat
// it back; every return sends it faster. Let it reach the wall behind you and
// it goes off in your hands.
//
// The fuse is the second clock. It burns down the whole round and it is drawn
// on the bomb, so it is pressure you can see rather than a random ending: when
// it runs out the bomb detonates wherever it happens to be, and whoever's half
// that is loses the round. Late in a round you are trying to get rid of it, not
// to rally — which flips the whole feel of the exchange without changing a rule.
//
// Tapping while the bomb is in the OTHER half is a whiff and locks you out
// briefly, so mashing is not a strategy. That single rule is what makes this a
// game of timing rather than hot potato.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ────────────────────────────────────────────────────────────────
// First to 3. At first-to-2 a player who missed both returns was out in eight
// seconds — under the §3 floor. Three rounds is the same game with a floor you
// can actually come back from after one bad read.
const WIN_ROUNDS  = 3;
// R1b. The floating status pill owns roughly the outer 48 px, so the wall sits
// far enough in to leave a clear band between it and the pill for this player's
// HUD. Measured on a 412x892 phone: the "TAP! IT'S YOURS" prompt was drawn
// behind the pill at the old 74.
const WALL_PAD    = 108;    // px from each outer edge
// Measured: at 330 px/s the bomb crossed a half in 1.3 s, so a round could be
// over before a player who glanced away looked back — the §3 floor. It now
// hangs at the centre for a beat and sets off slower, which makes the FIRST
// return reachable and leaves the acceleration to do the difficulty.
const SERVE_HANG  = 0.85;   // s the bomb hovers at the centre before it launches
const SPEED_0     = 232;    // px/s at the serve
const SPEED_MUL   = 1.085;  // per return
const SPEED_MAX   = 1150;
const FUSE_MIN    = 7.0;    // s
const FUSE_MAX    = 11.5;
const WHIFF_MS    = 340;    // lockout after swinging at nothing
const BLAST_MS    = 1250;   // explosion hold before the next round
const MATCH_TIME  = 56;     // s ceiling

// ── Module state ────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;
let _W = 0, _H = 0;
let _wins = [0, 0];
let _round = 0;
let _phase = 'serve';       // 'serve' | 'live' | 'blast'
let _bomb = null;           // { y, vy, speed, fuse, fuseMax, rallies }
let _lock = [0, 0];         // performance.now() until each player may swing
let _flash = [0, 0];        // swing animation per half
let _parts = [];            // explosion particles
let _sparks = [];           // fuse sparks
let _blastAt = null;        // { x, y, t } while exploding
let _loser = -1;
let _shake = 0;
let _botNext = 0;
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
    _wins = [0, 0]; _round = 0; _phase = 'serve';
    _bomb = null; _lock = [0, 0]; _flash = [0, 0];
    _parts = []; _sparks = []; _blastAt = null; _loser = -1; _shake = 0;
    _last = 0; _elapsed = 0; _botNext = 0;
    registerMinigameCleanup(_destroy);           // R3
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _serve();
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
        'background:radial-gradient(ellipse at 50% 50%, #2a1414 0%, #0a0608 78%);';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const pid = e.clientY < _overlay.clientHeight / 2 ? 1 : 0;
        if (pid === 1 && _isBot) return;
        _swing(pid);
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

// ── Round flow ──────────────────────────────────────────────────────────────
function _serve() {
    if (_done) return;
    const fuse = FUSE_MIN + Math.random() * (FUSE_MAX - FUSE_MIN);
    // Serve toward whoever is ahead, so a lead is never a rest.
    const toward = _wins[0] === _wins[1] ? (Math.random() < 0.5 ? 1 : -1)
                                         : (_wins[0] > _wins[1] ? 1 : -1);
    _bomb = { y: _H / 2, vy: toward * SPEED_0, speed: SPEED_0, fuse, fuseMax: fuse,
              rallies: 0, hang: SERVE_HANG };
    _lock = [0, 0];
    _phase = 'live';
    _botNext = 0;
    _say(`ROUND ${_round + 1} — ${_wins[0]}–${_wins[1]}`);
    sfx('countdown');
}

function _swing(pid) {
    if (_phase !== 'live' || !_bomb) return;
    // Nobody owns the bomb on the line, so an eager swing at the serve is
    // simply ignored rather than punished with a lockout.
    if (_bomb.hang > 0) return;
    const now = performance.now();
    if (now < _lock[pid]) return;
    _flash[pid] = 1;
    if (_inHalf(pid)) {
        _bomb.rallies++;
        _bomb.speed = Math.min(SPEED_MAX, _bomb.speed * SPEED_MUL);
        _bomb.vy = (pid === 0 ? -1 : 1) * _bomb.speed;
        sfx('boost');
        if (pid === 0) haptic([16]);
        _burst(_W / 2, _bomb.y, 8, '#ffd166');
    } else {
        // Swung at nothing. The lockout is what stops mashing from working.
        _lock[pid] = now + WHIFF_MS;
        sfx('land_bad');
        if (pid === 0) haptic([30]);
    }
}

// Is the bomb inside this player's half? P1 owns the bottom, P2 the top.
function _inHalf(pid) {
    if (!_bomb) return false;
    return pid === 0 ? _bomb.y > _H / 2 : _bomb.y < _H / 2;
}

function _detonate(loserId) {
    if (_phase === 'blast' || _done) return;
    _phase = 'blast';
    _loser = loserId;
    _wins[1 - loserId]++;
    _blastAt = { x: _W / 2, y: _bomb ? _bomb.y : _H / 2, t: 0 };
    _burst(_blastAt.x, _blastAt.y, 46, '#ff9a3c');
    _burst(_blastAt.x, _blastAt.y, 26, '#ffe9a8');
    _shake = 15;
    sfx('mg_lose'); haptic('heavy');
    _say(`💥 P${loserId + 1} IS HOLDING IT! ${_wins[0]}–${_wins[1]}`);

    _after(() => {
        if (_done) return;
        if (_wins[0] >= WIN_ROUNDS || _wins[1] >= WIN_ROUNDS) {
            _finish(_wins[0] > _wins[1] ? 0 : 1);
            return;
        }
        _round++;
        _blastAt = null; _parts = [];
        _serve();
    }, BLAST_MS);
}

function _say(t) {
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = t;
}

// ── Bot (§5) ────────────────────────────────────────────────────────────────
//
// The bot waits for the bomb to be genuinely in its half and then returns it
// after a skill-scaled delay measured against how long it HAS — so a fast bomb
// squeezes it exactly as it squeezes a player, and hard is late-and-precise
// rather than instant.
function _botStep() {
    if (_phase !== 'live' || !_bomb || !_isBot) return;
    const now = performance.now();
    if (now < _lock[1]) return;

    if (!_inHalf(1)) { _botNext = 0; return; }

    // Time until the bomb hits the bot's wall, in ms.
    const dist = Math.max(0, _bomb.y - WALL_PAD);
    const ttl  = _bomb.vy < 0 ? (dist / Math.abs(_bomb.vy)) * 1000 : 9999;

    if (!_botNext) {
        // Leave a margin that shrinks with skill; easy cuts it far too fine and
        // sometimes leaves it too late entirely.
        const margin = 90 + (1 - _botSkill) * 260 + Math.random() * 120;
        _botNext = now + Math.max(0, ttl - margin);
        // A skill-scaled chance of panicking and swinging at thin air first.
        if (Math.random() < (0.26 - _botSkill * 0.24)) _swing(1);
    }
    if (now >= _botNext) { _swing(1); _botNext = 0; }
}

// ── Particles ───────────────────────────────────────────────────────────────
function _burst(x, y, n, color) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 70 + Math.random() * 420;
        _parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                      life: 0.42 + Math.random() * 0.55, age: 0,
                      r: 2 + Math.random() * 5, color });
    }
}

// ── Loop (R1) ───────────────────────────────────────────────────────────────
function _tick(now) {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const dt = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    if (_phase === 'live' && _bomb) {
        // While it hangs on the line the fuse still burns, but the bomb doesn't
        // move and nobody owns it — that beat is what makes the serve readable.
        if (_bomb.hang > 0) _bomb.hang -= dt;
        else _bomb.y += _bomb.vy * dt;
        _bomb.fuse -= dt;

        // Sparks stream off the fuse the whole time it is lit.
        if (Math.random() < 0.85) {
            _sparks.push({ x: _W / 2 + (Math.random() - 0.5) * 10, y: _bomb.y - 26,
                           vx: (Math.random() - 0.5) * 90, vy: -30 - Math.random() * 90,
                           life: 0.30, age: 0 });
        }

        if (_bomb.fuse <= 0) {
            _detonate(_bomb.y > _H / 2 ? 0 : 1);
        } else if (_bomb.y >= _H - WALL_PAD) {
            _detonate(0);
        } else if (_bomb.y <= WALL_PAD) {
            _detonate(1);
        }
        _botStep();
    }

    for (let i = 0; i < 2; i++) if (_flash[i] > 0) _flash[i] = Math.max(0, _flash[i] - dt * 4.2);
    if (_shake > 0) _shake = Math.max(0, _shake - dt * 44);
    if (_blastAt) _blastAt.t += dt;

    _stepParts(_parts, dt, 620);
    _stepParts(_sparks, dt, 240);

    if (_elapsed >= MATCH_TIME && _phase !== 'blast') {
        // Out of time mid-rally: the round count decides it, and a level score
        // is an honest draw.
        _finish(_wins[0] === _wins[1] ? -1 : (_wins[0] > _wins[1] ? 0 : 1));
        return;
    }
    _draw();
}

function _stepParts(arr, dt, gravity) {
    for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        p.age += dt;
        if (p.age >= p.life) { arr.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += gravity * dt * 0.35;
    }
}

// ── Draw ────────────────────────────────────────────────────────────────────
function _draw() {
    const ctx = _ctx;
    ctx.clearRect(0, 0, _W, _H);
    ctx.save();
    if (_shake > 0) ctx.translate((Math.random() - 0.5) * _shake, (Math.random() - 0.5) * _shake);

    // Blast wash behind everything, so the explosion lights the whole arena.
    if (_blastAt) {
        const p = Math.min(1, _blastAt.t / 0.42);
        ctx.fillStyle = `rgba(255,150,60,${0.34 * (1 - p)})`;
        ctx.fillRect(-40, -40, _W + 80, _H + 80);
    }

    _wall(0); _wall(1);

    // Fuse sparks
    for (const s of _sparks) {
        const a = 1 - s.age / s.life;
        ctx.fillStyle = `rgba(255,${180 + Math.floor(60 * a)},90,${a})`;
        ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }

    if (_phase === 'live' && _bomb) _drawBomb();

    // Explosion particles
    for (const p of _parts) {
        const a = 1 - p.age / p.life;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + a * 0.9), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (_blastAt) {
        const p = Math.min(1, _blastAt.t / 0.5);
        ctx.strokeStyle = `rgba(255,220,150,${1 - p})`;
        ctx.lineWidth = 8 * (1 - p) + 1;
        ctx.beginPath(); ctx.arc(_blastAt.x, _blastAt.y, 18 + p * 210, 0, Math.PI * 2); ctx.stroke();
    }

    ctx.restore();
    _hud(0);
    ctx.save(); ctx.translate(_W, _H); ctx.rotate(Math.PI); _hud(1); ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 2;
    ctx.setLineDash([9, 9]);
    ctx.beginPath(); ctx.moveTo(0, _H / 2); ctx.lineTo(_W, _H / 2); ctx.stroke();
    ctx.setLineDash([]);
}

// The wall you are defending. It glows when the bomb is coming at you, which is
// the "it's yours now" signal — position and brightness, not colour alone (§4).
function _wall(pid) {
    const ctx = _ctx;
    const y = pid === 0 ? _H - WALL_PAD : WALL_PAD;
    const mine = _inHalf(pid) && _phase === 'live';
    const heat = mine ? 0.55 + Math.sin(performance.now() / 90) * 0.35 : 0.16;
    const color = pid === 0 ? '255,90,90' : '90,155,255';
    ctx.fillStyle = `rgba(${color},${heat})`;
    ctx.fillRect(0, y - 5, _W, 10);
    ctx.fillStyle = `rgba(${color},${heat * 0.30})`;
    ctx.fillRect(0, pid === 0 ? y : y - 34, _W, 34);
    // Swing flash across the whole half so a return is unmistakable.
    if (_flash[pid] > 0) {
        ctx.fillStyle = `rgba(255,235,180,${0.20 * _flash[pid]})`;
        ctx.fillRect(0, pid === 0 ? _H / 2 : 0, _W, _H / 2);
    }
}

function _drawBomb() {
    const ctx = _ctx;
    const x = _W / 2, y = _bomb.y;
    const burn = 1 - _bomb.fuse / _bomb.fuseMax;             // 0 fresh → 1 spent
    const pulse = 1 + Math.sin(performance.now() / (150 - burn * 105)) * (0.06 + burn * 0.14);
    const r = 21 * pulse;

    // Motion trail
    ctx.globalAlpha = 0.20;
    for (let k = 1; k <= 4; k++) {
        ctx.fillStyle = '#1b1b22';
        ctx.beginPath();
        ctx.arc(x, y - Math.sign(_bomb.vy) * k * 13, r * (1 - k * 0.16), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Casing
    const g = ctx.createRadialGradient(x - 7, y - 8, 2, x, y, r);
    g.addColorStop(0, '#5c5c68'); g.addColorStop(1, '#16161c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // Danger ring reddens as the fuse burns down — a second, redundant channel
    // for the same information the fuse length already gives.
    ctx.strokeStyle = `rgba(255,${Math.round(200 - burn * 190)},60,${0.5 + burn * 0.5})`;
    ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.beginPath(); ctx.ellipse(x - 7, y - 8, 5, 3.4, -0.5, 0, Math.PI * 2); ctx.fill();

    // Cap and fuse — the fuse visibly shortens, which is the whole clock.
    ctx.fillStyle = '#3b3b45';
    ctx.fillRect(x - 6, y - r - 7, 12, 8);
    const len = 26 * (1 - burn) + 4;
    ctx.strokeStyle = '#c9b28a'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y - r - 6);
    ctx.quadraticCurveTo(x + 13, y - r - 6 - len * 0.6, x + 5, y - r - 6 - len);
    ctx.stroke();
    // Burning tip
    const tipX = x + 5, tipY = y - r - 6 - len;
    const fg = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 11);
    fg.addColorStop(0, '#fff6cf'); fg.addColorStop(0.5, '#ffb545'); fg.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(tipX, tipY, 11, 0, Math.PI * 2); ctx.fill();
}

function _hud(pid) {
    const ctx = _ctx;
    const locked = performance.now() < _lock[pid];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // Round pips: won rounds as filled squares, so the score is countable at a
    // glance and doesn't depend on reading a number upside down.
    for (let i = 0; i < WIN_ROUNDS; i++) {
        const bx = _W / 2 - 27 + i * 22;
        ctx.fillStyle = i < _wins[pid] ? (pid === 0 ? '#ff5a5a' : '#5a9bff') : 'rgba(255,255,255,.18)';
        _sq(ctx, bx, _H - 90, 14);
    }

    ctx.font = '900 17px "Bebas Neue", sans-serif';
    if (locked) {
        ctx.fillStyle = '#ef4444';
        ctx.fillText('WHIFFED — WAIT', _W / 2, _H - 64);
    } else if (_inHalf(pid) && _phase === 'live') {
        ctx.fillStyle = '#ffd166';
        ctx.fillText('TAP! IT\'S YOURS', _W / 2, _H - 64);
    } else {
        ctx.fillStyle = 'rgba(255,255,255,.34)';
        ctx.fillText(_phase === 'live' ? 'THEIR SIDE' : 'STAND BY', _W / 2, _H - 64);
    }
}

function _sq(ctx, cx, cy, s) {
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
}

// ── End (R6) ────────────────────────────────────────────────────────────────
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    _say(winnerId < 0 ? `TIME — ${_wins[0]}–${_wins[1]}, DRAW!`
                      : `P${winnerId + 1} WINS ${Math.max(..._wins)}–${Math.min(..._wins)}!`);
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1300);
}

// ── Cleanup (R3) ────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _bomb = null; _parts = []; _sparks = []; _blastAt = null;
    _last = 0; _elapsed = 0; _W = 0; _H = 0;
}
