// ============================================================
// TREE CLIMB — two stems, one race, and a coin for every branch.
//
// A leaf sprouts on the left or the right of your stem. Tap that side to swing
// up onto it. The NEXT leaf does not exist until you are standing on the last
// one, so the game is never a memorised pattern — it is a read-and-react loop
// that gets faster the higher you go.
//
// Grab the wrong side and you fall to the last branch actually placed on THAT
// side — the ladder above you survives, so you climb the same branches back.
// Coins bank off the deepest height you reached, so a fall costs you the race
// but never your purse: the comeback rule (§3) is served by the money rather
// than by making mistakes free.
//
// The climbers are the players' real 3D board pieces, rendered once at the start
// of the round and drawn as sprites.
//
// COIN GAME (R6b): every branch pays, and both players keep what they climbed.
// You are racing for the bonus, not for the right to be paid at all.
// ============================================================

import { state } from '../core/GameState.js';
import { CHAR_ICONS } from '../config/GameConfig.js';
import { createCharacterMesh } from '../engine/Renderer.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ────────────────────────────────────────────────────────────────
// 18, down from 22. A wrong tap now costs height rather than a moment, so the
// same number of branches is a materially longer climb: measured, an easy bot
// was still short of 22 when the 40 s ceiling arrived. 18 lands both tiers
// inside the budget with the top still reachable.
const TARGET      = 18;     // branches to the top
// 1 per branch, not 2: at 2 the winner hit the 30 cap every single time, which
// made the payout a flat number instead of a record of how far you got.
const COIN_PER    = 1;      // coins banked per branch
const MAX_PAYOUT  = 30;     // R6b: cap it, matching Loot Catch's ceiling
const MATCH_TIME  = 40;     // s ceiling; tallest climber takes it
const RISE_TIME   = 0.20;   // s of the jump up onto a leaf
const FALL_PER    = 0.16;   // s per branch dropped when you grab the wrong side
const RECOVER_MS  = 170;    // brief hold after landing a fall
const SPACING     = 74;     // px between branches on the drawn stem
const PERCH_DX    = 30;     // px the climber sits off-centre, onto its branch
const HOP_H       = 22;     // px of arc above the line during a jump

// ── Module state ────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;
let _W = 0, _H = 0;
// Per player: height climbed, the side the pending leaf grew on, animation and
// stun clocks, and the scrolling offset that makes the stem slide past.
let _p = null;
let _botDelay = 0;
let _sprites = [null, null];      // the two climbers, pre-rendered from the 3D models
const _cleanups = [];
const _timers   = [];

// ── The climbers are the real board pieces ──────────────────────────────────
//
// Each player's actual 3D character is rendered ONCE into an offscreen canvas at
// the start of the round and then drawn as a sprite. Rendering it live would
// mean holding a second WebGL context open for the whole game alongside the
// board's, for a model that never changes shape — so the context is created,
// used for two frames and released immediately.
//
// If anything here fails the game falls back to the flat emoji climber, because
// a minigame that will not start is far worse than one drawn simply.
function _renderCharSprites() {
    const out = [null, null];
    if (typeof THREE === 'undefined') return out;
    let gl = null;
    try {
        const SIZE = 168;
        gl = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));   // R4
        gl.setSize(SIZE, SIZE, false);
        gl.setClearColor(0x000000, 0);

        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff, 0.9));
        const key = new THREE.DirectionalLight(0xffffff, 1.15);
        key.position.set(2.5, 4, 3.5);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xbcd8ff, 0.5);
        rim.position.set(-3, 2, -2);
        scene.add(rim);
        const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60);

        for (let pid = 0; pid < 2; pid++) {
            const p = state.players[pid];
            const grp = createCharacterMesh(p?.charType || 'slime', p?.color ?? 0xffffff);
            scene.add(grp);
            // Frame whatever the model happens to be — they range from a squat
            // slime to a banker in a top hat. Pulling back a fixed multiple of
            // the model's height cropped the tall ones (the bunny lost its ears,
            // the cabbie half its cap), so the distance is solved from the
            // bounding SPHERE and the field of view, with a margin.
            const box = new THREE.Box3().setFromObject(grp);
            const sph = box.getBoundingSphere(new THREE.Sphere());
            const mid = sph.center;
            const dist = (sph.radius * 1.10) / Math.sin((cam.fov * Math.PI / 180) / 2);
            cam.position.set(mid.x + dist * 0.16, mid.y + dist * 0.11, mid.z + dist);
            cam.lookAt(mid);
            gl.render(scene, cam);

            const cv = document.createElement('canvas');
            cv.width = gl.domElement.width; cv.height = gl.domElement.height;
            cv.getContext('2d').drawImage(gl.domElement, 0, 0);
            out[pid] = cv;

            scene.remove(grp);
            grp.traverse(n => {
                if (n.geometry) n.geometry.dispose();
                if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => m.dispose());
            });
        }
    } catch (e) {
        return [null, null];
    } finally {
        // Hand the context straight back — the board needs it more than we do.
        if (gl) { try { gl.forceContextLoss && gl.forceContextLoss(); } catch (e) {} gl.dispose(); }
    }
    return out;
}

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// The stem is a ladder of branches that PERSISTS. `branches[i]` is the side of
// the i-th branch from the ground, and the invariant is that there is always
// exactly one more branch than you have climbed — `branches[height]` is the leaf
// you are reading right now. Falling doesn't delete the branches above you; you
// climb the same ladder back up, which is why the sides have to be remembered
// rather than recomputed.
function _newClimber() {
    const c = {
        height: 0,          // branches climbed; you stand on branches[height-1]
        best: 0,            // deepest height reached — coins bank off this
        branches: [],       // side of every branch placed, ground upward
        perch: 0,           // side you are standing on (0 = the ground)
        anim: null,         // { kind:'rise'|'fall', from, to, fromX, toX, t, dur }
        holdUntil: 0,       // performance.now() during the recovery after a fall
        shake: 0,
        coins: 0,
        falls: 0,
    };
    c.branches.push(_nextSide(c));
    return c;
}

// Genuinely random, with one restriction: never a third of the same side in a
// row. The old rule read the side you had *just jumped to*, which was always the
// current side by the time it ran — so it flipped every single time and the tree
// was a perfect left-right-left ladder. Runs of two are now common and are what
// make the read worth doing.
function _nextSide(c) {
    let s = Math.random() < 0.5 ? -1 : 1;
    const n = c.branches.length;
    if (n >= 2 && c.branches[n - 1] === c.branches[n - 2] && s === c.branches[n - 1]) s = -s;
    return s;
}

// The leaf currently showing: always the next branch up the ladder.
function _pending(c) { return c.branches[c.height]; }

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _p = [_newClimber(), _newClimber()];
    _last = 0; _elapsed = 0;
    _botDelay = _botReact();
    _sprites = _renderCharSprites();
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
    if (!c || c.anim) return;                           // mid jump or mid fall
    if (performance.now() < c.holdUntil) return;        // still picking yourself up
    if (c.height >= TARGET) return;

    if (side === _pending(c)) {
        // Jump: arc from the branch you're on onto the leaf you just picked.
        c.anim = { kind: 'rise', from: c.height, to: c.height + 1,
                   fromX: c.perch, toX: side, t: 0, dur: RISE_TIME };
        sfx('seq_lit');
        if (pid === 0) haptic([12]);
        return;
    }

    // Wrong side. You jumped at thin air on THAT side, so you drop to the last
    // branch that was actually placed there — searched strictly below the one
    // you're standing on, so a mistake always costs you height. If that side has
    // nothing below you, it is all the way back to the ground.
    let to = 0;
    for (let i = c.height - 2; i >= 0; i--) {
        if (c.branches[i] === side) { to = i + 1; break; }
    }
    c.falls++;
    c.shake = 9;
    c.anim = { kind: 'fall', from: c.height, to,
               fromX: c.perch, toX: to > 0 ? c.branches[to - 1] : 0,
               t: 0, dur: Math.max(0.18, (c.height - to) * FALL_PER) };
    sfx('land_bad');
    if (pid === 0) haptic([26, 40, 26]);
}

// An animation finished — apply it.
function _settle(pid) {
    const c = _p[pid];
    const a = c.anim;
    c.anim = null;
    c.height = a.to;
    c.perch  = a.toX;

    if (a.kind === 'fall') {
        c.holdUntil = performance.now() + RECOVER_MS;
        return;                                        // coins already banked
    }

    // Landed a branch. Coins bank off the DEEPEST height reached, so a later
    // fall never takes money back out of your pocket.
    if (c.height > c.best) {
        c.best = c.height;
        c.coins = Math.min(MAX_PAYOUT, c.best * COIN_PER);
        if (pid === 0) sfx('coin_gain');
    }
    // Keep exactly one leaf showing above the top of the ladder.
    if (c.branches.length <= c.height) c.branches.push(_nextSide(c));
    if (c.height >= TARGET) _finish(pid);
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
    if (!c || c.anim || performance.now() < c.holdUntil || c.height >= TARGET) return;
    _botDelay -= dtMs;
    if (_botDelay > 0) return;
    _botDelay = _botReact();
    const want = _pending(c);
    // 15% easy → 5% hard. It was 23% easy, which was fine when a mistake cost a
    // moment — now that it costs one or two branches the errors compound, and
    // measured, the easy bot failed to reach the top inside the ceiling about
    // half the time. The tiers still separate cleanly on climb rate.
    const wrong = Math.random() < (0.20 - _botSkill * 0.18);
    _tap(1, wrong ? -want : want);
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
        if (c.anim) {
            c.anim.t += dt / c.anim.dur;
            if (c.anim.t >= 1) _settle(i);
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
    const a = c.anim;
    const falling = !!a && a.kind === 'fall';
    const recovering = performance.now() < c.holdUntil;

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

    // Visual height, which runs continuously through a jump or a fall so the
    // stem scrolls with the movement instead of snapping at the end of it.
    // A fall accelerates; a jump eases out at the top of its arc.
    const t = a ? Math.min(1, a.t) : 0;
    const p = a ? (a.kind === 'fall' ? t * t : _ease(t)) : 0;
    const climbed = a ? a.from + (a.to - a.from) * p : c.height;
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

    // ── The ladder ─────────────────────────────────────────────────────────
    // Every branch is drawn from the remembered side, not from a formula, so
    // what you climbed back down to is what you climbed up. Only the leaf you
    // are reading right now is lit; the rest are behind you or above you.
    const lit = _pending(c);
    const litIdx = c.height;
    for (let i = Math.max(0, Math.floor(climbed) - 5); i < c.branches.length; i++) {
        const y = meY + (climbed - (i + 1)) * SPACING;
        if (y > _H + 60) continue;
        if (y < halfTop - 60) break;
        const live = i === litIdx && c.height < TARGET && !falling;
        const pulse = live ? 0.75 + Math.sin(performance.now() / 180) * 0.25 : 1;
        _branch(ctx, cx, y, c.branches[i], live ? 1 : (i < c.height ? 0.5 : 0.34), pulse);
    }

    // ── The climber ────────────────────────────────────────────────────────
    // Sideways travel onto (or down to) the branch, with a hop over the top of
    // a jump. This is the whole reason the jump reads as a jump: the character
    // visibly leaves one branch and arrives on the one you pressed.
    const fromX = a ? a.fromX * PERCH_DX : c.perch * PERCH_DX;
    const toX   = a ? a.toX   * PERCH_DX : c.perch * PERCH_DX;
    const meX   = cx + fromX + (toX - fromX) * (a ? _ease(t) : 0);
    const hop   = a && a.kind === 'rise' ? -Math.sin(t * Math.PI) * HOP_H : 0;
    const tumble = falling ? t * 5.2 : 0;
    const armSide = a && a.kind === 'rise' ? a.toX : 0;
    _climber(ctx, meX, meY + hop, pid, armSide, recovering, tumble);
    ctx.restore();

    // ── HUD at this player's edge ──────────────────────────────────────────
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 34px "Bebas Neue", sans-serif';
    ctx.fillStyle = pid === 0 ? '#ff6b6b' : '#6bb0ff';
    ctx.fillText(`${c.height}/${TARGET}`, _W / 2, _H - 96);
    ctx.font = '800 14px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = '#fcd34d';
    ctx.fillText(`🪙 ${c.coins}`, _W / 2, _H - 70);

    if (falling || recovering) {
        ctx.font = '900 20px "Bebas Neue", sans-serif';
        ctx.fillStyle = '#ef4444';
        ctx.fillText('MISSED — FELL!', _W / 2, _H - 124);
    }

    // Left/right tap hints, lit on the side the leaf is on so the control and
    // the answer are never ambiguous — shape and position, not colour (§4).
    for (const s of [-1, 1]) {
        const bx = _W / 2 + s * (_W * 0.30);
        const live = !a && !recovering && s === lit;
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

// The character each player actually chose, so the climber up the tree is the
// one whose token is on the board. Falls back to a plain face if the type is
// somehow unknown, which keeps the game playable rather than drawing nothing.
function _charIcon(pid) {
    return CHAR_ICONS[state.players[pid]?.charType] || null;
}

function _climber(ctx, cx, y, pid, armSide, dazed, tumble = 0) {
    const body = pid === 0 ? '#ff5a5a' : '#5a9bff';
    const sprite = _sprites[pid];
    const icon = _charIcon(pid);
    ctx.save();
    // A fall tumbles. The rotation is around the body, so the arm and the
    // character go with it and it reads as losing your grip.
    if (tumble) { ctx.translate(cx, y); ctx.rotate(tumble); ctx.translate(-cx, -y); }
    // Reaching arm, so the jump reads as an action rather than a teleport.
    if (armSide) {
        ctx.strokeStyle = body; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx, y - 6); ctx.lineTo(cx + armSide * 40, y - 26); ctx.stroke();
    }
    if (sprite) {
        // The real board piece. It is already built in the player's colour, so
        // it says whose climber it is without needing a disc behind it.
        // Sized and seated so the model's feet land on the branch rather than
        // its bounding box centre — the frame carries a margin all round.
        const h = 84, w = h * (sprite.width / sprite.height);
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
        ctx.drawImage(sprite, cx - w / 2, y - h * 0.70, w, h);
        ctx.restore();
    } else {
        // Fallback if the model could not be rendered: the player's colour as a
        // disc with their character's icon on it. Nine characters are choosable
        // by either player, so the icon alone cannot say whose climber this is
        // (§4 — and never colour alone either).
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.ellipse(cx, y, 17, 19, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; ctx.stroke();
        if (icon) {
            ctx.font = '24px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(icon, cx, y + 1);
        } else {
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(cx - 5, y - 5, 3.2, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cx + 5, y - 5, 3.2, 0, Math.PI * 2); ctx.fill();
        }
    }
    ctx.restore();
    if (dazed) {
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
// Out of time with nobody at the top: the higher climber takes it. Reported as
// what it is — the old copy said "REACHES THE TOP" for this too, which claimed
// something that had plainly not happened.
function _finishOnHeight() {
    const [a, b] = [_p[0].height, _p[1].height];
    _finish(a === b ? -1 : (a > b ? 0 : 1), true);
}

function _finish(winnerId, onHeight = false) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neu = document.getElementById('mg-neutral');
    if (neu) {
        const coins = `🪙 ${_p[0].coins} · ${_p[1].coins}`;
        neu.textContent = winnerId < 0
            ? `DEAD HEAT — ${_p[0].height} EACH`
            : onHeight
                ? `TIME! P${winnerId + 1} CLIMBED HIGHEST — ${coins}`
                : `P${winnerId + 1} REACHES THE TOP! ${coins}`;
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
    _p = null; _sprites = [null, null];
    _last = 0; _elapsed = 0; _W = 0; _H = 0;
}
