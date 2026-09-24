// ============================================================
// STAGE KIT — the pieces every 3D game was writing for itself
// ============================================================
//
// Six stage games in, the same four things had been written six times: whose
// name and colour a seat has, a HUD that reads right for both players, touch
// input that knows a tap from a drag from a hold, and a handful of particle
// effects. They live here now. None of it knows what game it is in.
//
//   seat(slot)                 name, colour (hex and css), bot flag
//   faceoffHud(stage)          a strip at each end, the far one turned; a big
//                              message drawn twice, back to back
//   sideHud(stage)             a score bar across the top, a pad per player at
//                              the bottom of their own half, one big message
//   touch(stage, opts)         per-seat pointer state on that seat's half:
//                              drag vector, hold time, and tap / release
//                              callbacks. Screen space, in the stage frame.
//   effects(stage)             bursts, puffs and debris that clean themselves up
//   overheadCam(stage, w, d)   the near-overhead, tilted-across-the-long-axis
//                              framing of the face-off 3D games (Vault Heist)
// ============================================================

import { state } from '../core/GameState.js';
import { isBotSlot, seatFor } from '../minigames/MinigameManager.js';

export function seat(slot) {
    const p = state.players[seatFor(slot)] || {};
    const color = p.color ?? (slot === 0 ? 0xff3b3b : 0x3b8eff);
    return {
        name: (p.name || `P${slot + 1}`).toUpperCase(),
        color, css: '#' + color.toString(16).padStart(6, '0'),
        bot: isBotSlot(slot),
    };
}

const TXT = 'color:#fff8ee;text-shadow:0 2px 0 rgba(0,0,0,.6),0 0 12px rgba(0,0,0,.55);letter-spacing:2px;';

function _pop(el, on) {
    el.style.animation = 'none'; void el.offsetWidth;
    el.style.animation = on ? 'countPop .35s ease' : 'none';
}

/** A strip at each player's end and a message drawn for both. */
export function faceoffHud(stage, { bg = 'rgba(12,10,20,.72)' } = {}) {
    const root = stage.hud;
    root.classList.add('bfont');
    const halves = [0, 1].map(slot => {
        const s = seat(slot);
        const half = document.createElement('div');
        half.style.cssText = 'position:absolute;left:0;right:0;height:50%;pointer-events:none;' +
            (slot === 0 ? 'bottom:0;' : 'top:0;transform:rotate(180deg);');
        // Inset past the manager's status pill at the outer edge (R1b).
        const strip = document.createElement('div');
        strip.style.cssText = 'position:absolute;left:50%;bottom:52px;transform:translateX(-50%);padding:3px 12px;' +
            `border-radius:14px;background:${bg};border:2px solid ${s.css};white-space:nowrap;text-align:center;` + TXT;
        const line = document.createElement('div'); line.style.fontSize = '15px';
        const hint = document.createElement('div'); hint.style.cssText = 'font-size:12px;opacity:.9;';
        strip.append(line, hint);
        const box = document.createElement('div');
        box.style.cssText = 'position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);text-align:center;' +
            'opacity:0;transition:opacity .2s;white-space:nowrap;' + TXT;
        const big = document.createElement('div'); big.style.cssText = 'font-size:44px;display:inline-block;';
        const sub = document.createElement('div'); sub.style.fontSize = '15px';
        box.append(big, sub);
        half.append(strip, box);
        root.appendChild(half);
        return { line, hint, box, big, sub };
    });
    let clearAt = 0;
    return {
        line(slot, text) { halves[slot].line.textContent = text; },
        hint(slot, text) { halves[slot].hint.textContent = text; halves[slot].hint.style.display = text ? '' : 'none'; },
        say(msg, sub = '', ms = 0, now = 0, color = '') {
            halves.forEach(h => {
                h.big.textContent = msg; h.sub.textContent = sub; h.big.style.color = color;
                h.box.style.opacity = msg ? '1' : '0';
                _pop(h.big, !!msg);
            });
            clearAt = ms ? now + ms / 1000 : 0;
        },
        tick(now) { if (clearAt && now > clearAt) { clearAt = 0; this.say(''); } },
    };
}

/** A top bar, a pad per player at the bottom of their half, one big message. */
export function sideHud(stage, { padWidth = 260 } = {}) {
    const root = stage.hud;
    root.classList.add('bfont');
    const el = (css, parent = root) => { const e = document.createElement('div'); e.style.cssText = css; parent.appendChild(e); return e; };
    const bar = el('position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:14px;align-items:center;' +
        'padding:5px 16px;border-radius:14px;background:rgba(20,12,24,.62);font-size:19px;white-space:nowrap;' + TXT);
    const pads = [0, 1].map(slot => {
        const s = seat(slot);
        const pad = el(`position:absolute;bottom:10px;width:${padWidth}px;padding:3px 8px;border-radius:14px;text-align:center;` +
            `white-space:nowrap;background:rgba(20,12,24,.55);border:2px solid ${s.css};transition:background .12s;` + TXT);
        const name = el('font-size:15px;', pad); name.textContent = s.name + (s.bot ? ' · BOT' : '');
        const hint = el('font-size:11px;opacity:.9;', pad);
        return { pad, hint };
    });
    const box = el('position:absolute;left:50%;top:32%;transform:translate(-50%,-50%);text-align:center;white-space:nowrap;' +
        'opacity:0;transition:opacity .15s;' + TXT);
    const big = el('font-size:54px;display:inline-block;', box);
    const sub = el('font-size:18px;', box);
    const layout = () => {
        const W = stage.width;
        pads[0].pad.style.left = (W * 0.75 - padWidth / 2) + 'px';
        pads[1].pad.style.left = (W * 0.25 - padWidth / 2) + 'px';
    };
    stage.onResize(layout);
    let clearAt = 0;
    return {
        bar(html) { bar.innerHTML = html; },
        hint(slot, text) { pads[slot].hint.textContent = text; pads[slot].hint.style.display = text ? '' : 'none'; },
        lit(slot, on, color = 'rgba(250,204,21,.35)') { pads[slot].pad.style.background = on ? color : 'rgba(20,12,24,.55)'; },
        say(msg, subText = '', ms = 0, now = 0, color = '') {
            big.textContent = msg; sub.textContent = subText; big.style.color = color;
            box.style.opacity = msg ? '1' : '0';
            _pop(big, !!msg);
            clearAt = ms ? now + ms / 1000 : 0;
        },
        tick(now) { if (clearAt && now > clearAt) { clearAt = 0; this.say(''); } },
    };
}

/**
 * Per-seat touch on that seat's half. `split` is 'y' for the face-off hold
 * (P1 the bottom half) or 'x' for the side hold (P1 the right half).
 *
 * Each seat's state: `down` (a finger is on), `dx, dy` (drag from where it went
 * down, in stage px, clamped to `stick` and normalised to -1..1), `held` (s),
 * `moved` (past the tap threshold). Callbacks: onDown(slot), onTap(slot),
 * onRelease(slot, { dx, dy, held, moved }). Bot seats are ignored.
 */
export function touch(stage, { split = 'y', stick = 55, tapPx = 12, tapMs = 220, floating = true,
                               onDown, onTap, onRelease } = {}) {
    const seats = [0, 1].map(() => ({ pid: null, ax: 0, ay: 0, t0: 0, dx: 0, dy: 0, moved: false, down: false, held: 0 }));
    const slotAt = p => (split === 'y' ? (p.y >= stage.height / 2 ? 0 : 1) : (p.x >= stage.width / 2 ? 0 : 1));
    stage.listen('pointerdown', e => {
        e.preventDefault();
        const p = stage.toLocal(e.clientX, e.clientY);
        const slot = slotAt(p);
        const s = seats[slot];
        if (isBotSlot(slot) || s.pid !== null) return;
        Object.assign(s, { pid: e.pointerId, ax: p.x, ay: p.y, t0: performance.now(), dx: 0, dy: 0, moved: false, down: true });
        onDown?.(slot);
    });
    stage.listen('pointermove', e => {
        const s = seats.find(x => x.pid === e.pointerId);
        if (!s) return;
        const p = stage.toLocal(e.clientX, e.clientY);
        let dx = p.x - s.ax, dy = p.y - s.ay;
        const len = Math.hypot(dx, dy);
        if (len > tapPx) s.moved = true;
        if (floating && len > stick) { s.ax = p.x - dx / len * stick; s.ay = p.y - dy / len * stick; dx = dx / len * stick; dy = dy / len * stick; }
        s.dx = Math.max(-1, Math.min(1, dx / stick));
        s.dy = Math.max(-1, Math.min(1, dy / stick));
    });
    const up = e => {
        const s = seats.find(x => x.pid === e.pointerId);
        if (!s) return;
        const slot = seats.indexOf(s);
        const held = (performance.now() - s.t0) / 1000;
        const info = { dx: s.dx, dy: s.dy, held, moved: s.moved };
        Object.assign(s, { pid: null, down: false, dx: 0, dy: 0, moved: false });
        if (!info.moved && held * 1000 < tapMs) onTap?.(slot);
        onRelease?.(slot, info);
    };
    stage.listen('pointerup', up);
    stage.listen('pointercancel', up);
    return {
        seat: slot => {
            const s = seats[slot];
            s.held = s.down ? (performance.now() - s.t0) / 1000 : 0;
            return s;
        },
    };
}

/** Short-lived effects in the stage's scene. Call update(dt) every frame. */
export function effects(stage) {
    const live = [];
    const add = (obj, life, fn) => { if (!stage.gl) return; stage.add(obj); live.push({ obj, t: 0, life, fn }); };
    return {
        burst(at, color = 0xffd27a, size = 0.5, life = 0.25) {
            const m = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 10), new THREE.MeshBasicMaterial({ color, transparent: true }));
            m.position.copy(at);
            add(m, life, (o, t) => { o.scale.setScalar(1 + t / life * 5); o.material.opacity = 1 - t / life; });
        },
        puff(at, color = 0xeeeeee, n = 6, spread = 0.6, rise = 1.2) {
            for (let i = 0; i < n; i++) {
                const m = new THREE.Mesh(new THREE.SphereGeometry(0.16 + Math.random() * 0.12, 8, 6),
                    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.8, roughness: 1 }));
                m.position.copy(at);
                const v = new THREE.Vector3((Math.random() - 0.5) * spread * 2, Math.random() * rise + 0.2, (Math.random() - 0.5) * spread * 2);
                add(m, 1.1 + Math.random() * 0.5, (o, t, dt) => {
                    o.position.addScaledVector(v, dt); o.scale.setScalar(1 + t * 2.2);
                    o.material.opacity = Math.max(0, 0.8 * (1 - t / 1.5));
                });
            }
        },
        confetti(at, colors, n = 18, speed = 3) {
            for (let i = 0; i < n; i++) {
                const m = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.2),
                    new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true }));
                m.position.copy(at);
                const a = Math.random() * Math.PI * 2;
                const v = new THREE.Vector3(Math.cos(a) * speed * Math.random(), 2 + Math.random() * speed, Math.sin(a) * speed * Math.random());
                add(m, 1.4, (o, t, dt) => {
                    v.y -= 7 * dt; o.position.addScaledVector(v, dt);
                    o.rotation.x += dt * 9; o.rotation.y += dt * 7; o.material.opacity = Math.max(0, 1 - Math.max(0, t - 0.9) * 2);
                });
            }
        },
        add,
        update(dt) {
            for (let i = live.length - 1; i >= 0; i--) {
                const f = live[i];
                f.t += dt; f.fn?.(f.obj, f.t, dt);
                if (f.t >= f.life) {
                    stage.scene?.remove(f.obj);
                    f.obj.traverse?.(n => { n.geometry?.dispose(); n.material?.dispose(); });
                    live.splice(i, 1);
                }
            }
        },
    };
}

/**
 * The face-off overhead shot: looking almost straight down, leaning in from
 * the +x long side so neither end is favoured, framing a w × d floor with
 * `margin` spare along its length for each end's HUD strip. Set camera.up to
 * (0, 0, -1) once; see MINIGAME_STANDARD §10.
 */
export function overheadCam(stage, w, d, margin = 8, tilt = 0.3) {
    const fov = (stage?.camera?.fov ?? 38) * Math.PI / 180;
    const aspect = (stage?.width || 412) / Math.max(1, stage?.height || 892);
    const t = Math.tan(fov / 2);
    const h = Math.max((d + margin) / (2 * t), (w + 2.4) / (2 * t * aspect));
    return { pos: [h * Math.sin(tilt), h * Math.cos(tilt), 0], look: [0, 0, 0] };
}
