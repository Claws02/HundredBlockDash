// ============================================================
// STAGE DIRECTOR — the opening shot and the winner's moment
// ============================================================
//
// The rulebook's arc is setup, contest, verdict, and "the verdict has to be a
// moment". High Noon built both ends by hand: a camera sweep in over the
// rooftops with the premise on screen, and a push in on the winner doing a
// victory bounce while the loser slumps. Every 3D game wants exactly that, so
// it lives here and a game asks for it in one call at each end:
//
//   const dir = createDirector(stage);
//   dir.open({ place, title, sub, from, to, onDone });     // beat 6 opens
//   ...the game...
//   dir.close({ winner, figs, title, sub, onDone });       // beat 6 closes
//
// and calls `dir.update(dt)` every frame. While the director is running a shot
// it owns the camera (update returns true) and the game should leave the
// camera alone; the rest of the game — its own effects, a gun being twirled —
// keeps running underneath.
//
// Both ends are cinematic on purpose: letterbox bars slide in, the HUD gives
// way to a title card, and they slide out again when play begins. That is what
// tells a player "this is a scene", and it costs two divs.
//
// HOLDS. In the side hold everybody reads one card. In the face-off hold the
// card is drawn twice, back to back, so the far player reads theirs the right
// way up — the same rule the manager's status pills follow. The winner's
// close-up is shot from the winner's own side, so the moment reads the right
// way up for the person it belongs to.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx } from './AudioManager.js';
import { seatFor } from '../minigames/MinigameManager.js';

const OPEN_DUR = 2.1;
const CLOSE_DUR = 2.6;
const BAR = 0.11;          // letterbox bar height, fraction of the frame

const _ease = k => k * k * (3 - 2 * k);

function _name(slot) {
    const p = state.players[seatFor(slot)];
    return (p && p.name ? p.name : `P${slot + 1}`).toUpperCase();
}
function _color(slot) {
    return state.players[seatFor(slot)]?.color ?? (slot === 0 ? 0xff3b3b : 0x3b8eff);
}

export function createDirector(stage) {
    const hud = stage.hud;
    const txt = 'color:#fff8e6;text-shadow:0 2px 0 rgba(0,0,0,.55),0 0 18px rgba(0,0,0,.6);letter-spacing:3px;';

    // While a shot runs, the game's own HUD (scores, pads, prompts) steps back
    // so the scene and the card are all there is. Director elements carry
    // data-dir and are exempt.
    const style = document.createElement('style');
    style.textContent = '.stage-cine > :not([data-dir]) { opacity: 0 !important; transition: opacity .3s; }';
    style.dataset.dir = '1';
    hud.appendChild(style);
    const cine = on => hud.classList.toggle('stage-cine', on);

    // Letterbox bars.
    const bars = ['top', 'bottom'].map(edge => {
        const b = document.createElement('div');
        b.style.cssText = `position:absolute;left:0;right:0;${edge}:0;height:${BAR * 100}%;background:#07050a;` +
            `transform:translateY(${edge === 'top' ? '-100%' : '100%'});transition:transform .45s cubic-bezier(.2,.8,.2,1);z-index:30;pointer-events:none;`;
        b.dataset.edge = edge;
        b.dataset.dir = '1';
        hud.appendChild(b);
        return b;
    });

    // One title card, or two back to back in the face-off hold.
    const cards = (stage.hold === 'faceoff' ? [0, 180] : [0]).map(rot => {
        const c = document.createElement('div');
        const half = stage.hold === 'faceoff';
        c.style.cssText = 'position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center;' +
            'justify-content:center;gap:4px;z-index:31;pointer-events:none;opacity:0;transition:opacity .3s;' +
            (half ? (rot ? 'top:0;height:50%;transform:rotate(180deg);' : 'bottom:0;height:50%;') : 'top:0;bottom:0;');
        // A face-off half is a portrait 412 px across: smaller type, and lines
        // that wrap inside a margin instead of running off both edges.
        const wrap = 'max-width:92%;text-align:center;';
        c.innerHTML =
            `<div data-k="place" style="font-size:${half ? 13 : 15}px;opacity:.85;${wrap}${txt}"></div>` +
            `<div data-k="title" style="font-size:${half ? 42 : 66}px;line-height:1;${wrap}${txt}"></div>` +
            `<div data-k="sub" style="font-size:${half ? 15 : 20}px;${wrap}${txt}"></div>`;
        c.classList.add('bfont');
        c.dataset.dir = '1';
        hud.appendChild(c);
        return c;
    });

    const d = {
        active: null,          // 'open' | 'close' | null
        t: 0,
        _shot: null,
        _confetti: [],
    };

    function setCard({ place = '', title = '', sub = '', color = null, top = false }) {
        cards.forEach(c => {
            // The winner's card rides high, clear of the close-up on their face.
            c.style.justifyContent = top ? 'flex-start' : 'center';
            c.style.paddingTop = top ? `calc(${BAR * 100}% + 10px)` : '0';
            c.querySelector('[data-k="place"]').textContent = place;
            const t = c.querySelector('[data-k="title"]');
            t.textContent = title;
            t.style.color = color || '#fff8e6';
            c.querySelector('[data-k="sub"]').textContent = sub;
            c.style.opacity = title ? '1' : '0';
            // Pop the title in, the manager's own countPop.
            t.style.animation = 'none'; void t.offsetWidth;
            t.style.animation = title ? 'countPop .45s ease' : 'none';
        });
    }
    function letterbox(on) {
        bars.forEach(b => {
            b.style.transform = on ? 'translateY(0)' : `translateY(${b.dataset.edge === 'top' ? '-100%' : '100%'})`;
        });
    }

    /**
     * Beat 6 opens: a camera move from `from` to `to` ({ pos:[x,y,z], look:[x,y,z] })
     * with the place, title and premise on a card. `onDone` fires as the bars
     * leave, which is when the game should start taking input.
     */
    d.open = ({ place = '', title = '', sub = '', from, to, dur = OPEN_DUR, onDone } = {}) => {
        d.active = 'open'; d.t = 0;
        d._shot = { from, to, dur, onDone };
        setCard({ place, title, sub });
        letterbox(true);
        cine(true);
        sfx('mg_start');
    };

    /**
     * Beat 6 closes: the winner's moment. `winner` is a slot or -1. `figs` are
     * the stage characters ({ slot, rig, anim }). The winner turns to camera and
     * celebrates, everybody else slumps (a figure already flat on its back stays
     * there — that is the joke), confetti in the winner's colour, and the camera
     * pushes in from `closeUp(winnerFig)` if the game gives one, else from in
     * front. `onDone` fires after `dur` — the game hands its result over there.
     */
    d.close = ({ winner = -1, figs = [], title, sub = '', dur = CLOSE_DUR, closeUp = null, onDone } = {}) => {
        d.active = 'close'; d.t = 0;
        const w = figs.find(f => f.slot === winner && f.rig);
        figs.forEach(f => {
            if (!f.anim) return;
            if (winner < 0) f.anim.play('idle');
            else if (f === w) f.anim.play('victory');
            else if (!['fall', 'hit'].includes(f.anim.state)) f.anim.play('defeat');
        });
        let shot = null;
        if (stage.gl && stage.camera) {
            const from = { pos: stage.camera.position.toArray(), look: _lookOf(stage.camera) };
            if (w) {
                const p = w.rig.root.getWorldPosition(new THREE.Vector3());
                const H = w.rig.H;
                const cu = closeUp ? closeUp(w, p) : null;
                const to = cu || { pos: [p.x * 0.8, p.y + 1.2 + H * 0.45, p.z + 4.4 + H * 1.4], look: [p.x, p.y + H * 0.45, p.z] };
                // Face the lens, wherever it ended up.
                const cam = new THREE.Vector3(...to.pos);
                w.anim.face(Math.atan2(cam.x - p.x, cam.z - p.z));
                shot = { from, to, dur: 1.1 };
            }
            if (w) _burstConfetti(w.rig.root.getWorldPosition(new THREE.Vector3()), _color(winner), w.rig.H);
        }
        d._shot = { ...(shot || {}), dur: dur, move: shot ? shot.dur : 0, onDone };
        setCard({
            title: title ?? (winner < 0 ? 'DEAD EVEN' : `${_name(winner)} WINS`),
            sub,
            color: winner < 0 ? null : '#' + _color(winner).toString(16).padStart(6, '0'),
            top: !!w,
        });
        cine(true);
        // Close-up and card go up top and bottom, clear of the figure.
        letterbox(true);
        sfx(winner < 0 ? 'land_bad' : 'mg_win');
    };

    /** Advance the shot. Returns true while the director owns the camera. */
    d.update = dt => {
        _stepConfetti(dt);
        if (!d.active) return false;
        d.t += dt;
        const s = d._shot || {};
        const moveDur = d.active === 'open' ? s.dur : (s.move || 0);
        if (stage.gl && stage.camera && s.from && s.to && moveDur > 0) {
            const k = _ease(Math.min(1, d.t / moveDur));
            const P = new THREE.Vector3().fromArray(s.from.pos).lerp(new THREE.Vector3().fromArray(s.to.pos), k);
            const L = new THREE.Vector3().fromArray(s.from.look).lerp(new THREE.Vector3().fromArray(s.to.look), k);
            stage.camera.position.copy(P);
            stage.camera.lookAt(L);
            stage.camera.userData.look = L.toArray();
        }
        if (d.t >= s.dur) {
            const done = s.onDone;
            if (d.active === 'open') { setCard({}); letterbox(false); cine(false); }
            d.active = null; d._shot = null;
            done?.();
            return false;
        }
        return true;
    };

    // The look target is not stored on a three camera, so remember the last one
    // we set and fall back to "straight ahead".
    function _lookOf(cam) {
        if (cam.userData.look) return cam.userData.look;
        const dir = new THREE.Vector3();
        cam.getWorldDirection(dir);
        return cam.position.clone().addScaledVector(dir, 10).toArray();
    }

    function _burstConfetti(at, color, H) {
        if (!stage.gl) return;
        const cols = [color, 0xffd34d, 0xffffff];
        for (let i = 0; i < 40; i++) {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.2),
                new THREE.MeshBasicMaterial({ color: cols[i % 3], side: THREE.DoubleSide, transparent: true }));
            m.position.set(at.x, at.y + H * 1.2, at.z);
            const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 2.5;
            m.userData.v = new THREE.Vector3(Math.cos(a) * sp, 3 + Math.random() * 3, Math.sin(a) * sp);
            m.userData.spin = new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
            m.userData.t = 0;
            stage.add(m);
            d._confetti.push(m);
        }
    }
    function _stepConfetti(dt) {
        for (let i = d._confetti.length - 1; i >= 0; i--) {
            const m = d._confetti[i], v = m.userData.v;
            m.userData.t += dt;
            v.y -= 6 * dt; v.multiplyScalar(1 - 1.2 * dt);
            m.position.addScaledVector(v, dt);
            m.rotation.x += m.userData.spin.x * dt; m.rotation.y += m.userData.spin.y * dt;
            m.material.opacity = Math.max(0, 1 - Math.max(0, m.userData.t - 1.6));
            if (m.userData.t > 2.6 || !stage.scene) {
                stage.scene?.remove(m);
                m.geometry.dispose(); m.material.dispose();
                d._confetti.splice(i, 1);
            }
        }
    }

    return d;
}
