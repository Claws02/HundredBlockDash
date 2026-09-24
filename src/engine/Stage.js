// ============================================================
// MINIGAME STAGE — one 3D scene a minigame can be played in
// ============================================================
//
// Sumo Spheres and Tank Clash each hand-roll a renderer, lights, a camera, a
// resize handler and a teardown, and the teardown is exactly where QA-016 and
// the force-end leaks were found. A game that puts the players' own characters
// into a set wants all of that and more, so it lives here, once:
//
//   · a WebGL renderer sized to the layer, DPR capped at 2 (R4)
//   · the HOLD. `faceoff` fills the portrait layer as every game does. `side`
//     is the landscape hold: two players side by side along one long edge,
//     both reading the same picture the same way up. If the viewport is still
//     portrait (rotation lock, or the phone flat on a table) the whole stage is
//     turned 90° clockwise, the same convention the win screen uses — so the
//     phone's home edge ends up on the players' RIGHT. P1's ready button is on
//     that edge, so P1 sits on the right and P2 on the left.
//   · `toLocal()`, which maps a touch into the stage's own frame whichever way
//     it is turned. Games never see screen coordinates.
//   · a HUD layer inside the turned frame, for text that must read the same
//     way up as the scene
//   · riggable characters for each seat, from the figures players picked
//   · the board paused underneath while the stage is up, resumed on dispose
//   · dispose(): every geometry, material, texture and listener, the renderer,
//     and the WebGL context itself
//
// If WebGL is unavailable the stage still comes back, with `gl: false`, a HUD,
// and no scene. A game that plays through its HUD in that case still starts —
// the rule Tree Climb set: a game drawn simply beats a game that will not run.
// ============================================================

import { state } from '../core/GameState.js';
import { setBoardPaused } from './Renderer.js';
import { buildRiggedCharacter, CharacterAnimator } from './CharacterRig.js';
import { seatFor } from '../minigames/MinigameManager.js';

const DPR_CAP = 2;

/**
 * @param {HTMLElement} host   usually the game's own overlay in #minigame-layer
 * @param {object} opts
 *   hold        'faceoff' | 'side'
 *   background  hex colour behind everything (the sky should cover it)
 *   fov         vertical field of view, degrees
 *   shadows     true for a shadow-casting key light
 */
export function createStage(host, opts = {}) {
    const hold = opts.hold || 'faceoff';
    const frame = document.createElement('div');
    frame.style.position = 'absolute';
    frame.style.overflow = 'hidden';
    frame.style.touchAction = 'none';
    frame.style.userSelect = 'none';
    frame.style.webkitUserSelect = 'none';
    host.appendChild(frame);

    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;';
    frame.appendChild(hud);

    const stage = {
        hold, frame, hud,
        gl: false, renderer: null, scene: null, camera: null,
        width: 0, height: 0, turned: false,
        _loop: null, _af: null, _last: 0, _elapsed: 0,
        _resize: [], _owned: [], _rigs: [], _disposed: false,
    };

    // ---- the frame, turned or not ----------------------------------------
    function layout() {
        const vw = host.clientWidth || window.innerWidth;
        const vh = host.clientHeight || window.innerHeight;
        stage.turned = hold === 'side' && vh > vw;
        const w = stage.turned ? vh : vw;
        const h = stage.turned ? vw : vh;
        stage.width = w; stage.height = h;
        frame.style.width = w + 'px';
        frame.style.height = h + 'px';
        frame.style.left = '50%';
        frame.style.top = '50%';
        frame.style.transform = `translate(-50%, -50%)${stage.turned ? ' rotate(90deg)' : ''}`;
        if (stage.renderer) {
            stage.renderer.setSize(w, h, false);
            const cs = stage.renderer.domElement.style;
            cs.width = w + 'px'; cs.height = h + 'px';
        }
        if (stage.camera) {
            stage.camera.aspect = w / h;
            stage.camera.updateProjectionMatrix();
        }
        stage._resize.forEach(fn => { try { fn(w, h); } catch (e) { console.error(e); } });
    }

    // ---- WebGL -----------------------------------------------------------
    if (typeof THREE !== 'undefined') {
        try {
            const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
            r.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));
            if (opts.shadows !== false) {
                r.shadowMap.enabled = true;
                r.shadowMap.type = THREE.PCFShadowMap;   // soft PCF costs 4x the taps for a toy set
            }
            // Linear output and no tone mapping — the board's settings. The
            // characters' colours were tuned under those, and a stage that
            // rendered them differently would hand players a stranger.
            // Positional styles only: cssText would wipe what setSize writes (R4).
            const cs = r.domElement.style;
            cs.position = 'absolute'; cs.left = '0'; cs.top = '0'; cs.zIndex = '1';
            cs.pointerEvents = 'none';
            frame.insertBefore(r.domElement, hud);

            stage.renderer = r;
            stage.scene = new THREE.Scene();
            stage.scene.background = new THREE.Color(opts.background ?? 0x1a1a2e);
            stage.camera = new THREE.PerspectiveCamera(opts.fov ?? 40, 1, 0.1, 400);
            stage.gl = true;
        } catch (e) {
            console.warn('[Stage] WebGL unavailable, HUD only:', e);
            stage.renderer = null; stage.scene = null; stage.camera = null; stage.gl = false;
        }
    }
    layout();
    const onResize = () => { if (!stage._disposed) layout(); };
    window.addEventListener('resize', onResize);
    stage._owned.push(() => window.removeEventListener('resize', onResize));

    // Nothing to see under a full-screen stage; stop drawing it.
    try { setBoardPaused(true); } catch (e) {}

    // The side hold turns the manager's chrome too (css: .is-sideon). The
    // manager sets it when it launches a side-on game; setting it here as well
    // means a game started any other way — the arcade, a probe — still gets it.
    const layer = document.getElementById('minigame-layer');
    if (hold === 'side' && layer) {
        layer.classList.add('is-sideon');
        stage._owned.push(() => layer.classList.remove('is-sideon'));
    }

    // ---- API -------------------------------------------------------------

    /** Screen point → stage frame, in CSS px, x right and y down. */
    stage.toLocal = (clientX, clientY) => {
        const rect = host.getBoundingClientRect();
        const cx = clientX - (rect.left + rect.width / 2);
        const cy = clientY - (rect.top + rect.height / 2);
        // Turned 90° clockwise: screen (sx, sy) came from local (sy, -sx).
        return stage.turned
            ? { x: cy + stage.width / 2, y: -cx + stage.height / 2 }
            : { x: cx + stage.width / 2, y: cy + stage.height / 2 };
    };

    stage.onResize = fn => { stage._resize.push(fn); fn(stage.width, stage.height); };

    /** Register a teardown to run on dispose (listeners, timers). */
    stage.own = fn => { stage._owned.push(fn); return fn; };

    /** Listen on the frame; removed on dispose. */
    stage.listen = (type, fn, o) => {
        frame.addEventListener(type, fn, o);
        stage._owned.push(() => frame.removeEventListener(type, fn, o));
    };

    stage.add = obj => { if (stage.scene) stage.scene.add(obj); return obj; };

    /**
     * The figure a slot's player chose, rigged and animated. Falls back to the
     * slime if the seat has no character, so the stage never refuses a round.
     */
    stage.character = slot => {
        if (!stage.gl) return null;
        const p = state.players[seatFor(slot)] || state.players[slot] || {};
        const rig = buildRiggedCharacter(p.charType || 'slime', p.color ?? 0xffffff);
        const anim = new CharacterAnimator(rig);
        stage.scene.add(rig.root);
        const c = { slot, rig, anim, player: p };
        stage._rigs.push(c);
        return c;
    };

    /** A figure that is nobody's seat — a DJ, a referee — animated like the rest. */
    stage.figure = (type, color) => {
        if (!stage.gl) return null;
        const rig = buildRiggedCharacter(type, color);
        const anim = new CharacterAnimator(rig);
        stage.scene.add(rig.root);
        const c = { slot: -1, rig, anim };
        stage._rigs.push(c);
        return c;
    };

    /**
     * Lights. `sun` is the key and casts shadows over `span` units around the
     * origin; `sky`/`ground` make the hemisphere fill. Colours are the set's to
     * choose, so a stage at dusk is lit like one.
     */
    // Defaults are the board's own levels (Renderer: sun 1.55, fill ~0.75), so
    // a figure looks the same here as it does on its tile.
    stage.light = ({ sun = 0xfff1d6, sunI = 1.5, sky = 0xdfe6f0, ground = 0x8a6a48, hemiI = 0.8,
                     rim = 0x88bbff, rimI = 0.45, dir = [-8, 14, 10], span = 18 } = {}) => {
        if (!stage.gl) return null;
        const hemi = new THREE.HemisphereLight(sky, ground, hemiI);
        stage.scene.add(hemi);
        const key = new THREE.DirectionalLight(sun, sunI);
        key.position.set(dir[0], dir[1], dir[2]);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        const sc = key.shadow.camera;
        sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
        sc.near = 1; sc.far = 80;
        key.shadow.bias = -0.0008;
        stage.scene.add(key);
        // A cool rim from behind, which is what separates a figure from the
        // set it is standing in.
        const back = new THREE.DirectionalLight(rim, rimI);
        back.position.set(-dir[0] * 0.5, dir[1] * 0.6, -Math.abs(dir[2]));
        stage.scene.add(back);
        return { hemi, key, back };
    };

    /**
     * Run `frame(dt, elapsed)` every animation frame, then draw. dt is capped
     * at 0.1 s (R1) and every rig is animated before the callback runs.
     */
    // ADAPTIVE RESOLUTION. A full lit set with shadows at DPR 2 is the most
    // expensive thing this game draws, and a phone that cannot hold it does not
    // just stutter: dt is capped at 0.1 s (R1), so below 10 fps the GAME CLOCK
    // slows down with it and a 30 s round takes 90. When frames run long for a
    // second and a half the stage steps its pixel ratio down, and keeps
    // stepping until it holds or reaches the floor. It never steps back up —
    // resolution flickering between two values reads worse than either.
    const STEPS = [2, 1.5, 1, 0.75];
    stage.quality = { ratio: Math.min(window.devicePixelRatio || 1, DPR_CAP), ema: 1 / 60, since: 0, drops: 0 };
    function adapt(rawDt) {
        const q = stage.quality;
        q.ema += (rawDt - q.ema) * 0.08;
        q.since += rawDt;
        if (!stage.renderer || q.since < 1.5 || q.ema < 1 / 30) return;
        const next = STEPS.find(v => v < q.ratio - 0.01);
        if (next === undefined) return;
        q.ratio = next; q.since = 0; q.drops++;
        stage.renderer.setPixelRatio(next);
        stage.renderer.setSize(stage.width, stage.height, false);
    }

    // SPLIT SCREEN. `stage.views` is null (the one full-frame stage.camera) or
    // a list of { camera, rect: [x, y, w, h] } in fractions of the frame, y up
    // from the bottom as GL counts it. Each view is drawn into its own
    // rectangle through its own camera; aspect is kept to the rectangle. The
    // director's shots use stage.camera, so a game clears views for them.
    stage.views = null;
    function draw() {
        const r = stage.renderer;
        if (!stage.views) { r.render(stage.scene, stage.camera); return; }
        const W = stage.width, H = stage.height;
        r.setScissorTest(true);
        stage.views.forEach(v => {
            const x = Math.round(v.rect[0] * W), y = Math.round(v.rect[1] * H);
            const w = Math.round((v.rect[0] + v.rect[2]) * W) - x, h = Math.round((v.rect[1] + v.rect[3]) * H) - y;
            r.setViewport(x, y, w, h);
            r.setScissor(x, y, w, h);
            const a = w / Math.max(1, h);
            if (Math.abs(v.camera.aspect - a) > 1e-3) { v.camera.aspect = a; v.camera.updateProjectionMatrix(); }
            r.render(stage.scene, v.camera);
        });
        r.setScissorTest(false);
        r.setViewport(0, 0, W, H);
    }

    stage.start = fn => {
        stage._loop = fn;
        stage._last = 0;
        const tick = () => {
            if (stage._disposed) return;
            stage._af = requestAnimationFrame(tick);
            const now = performance.now();
            const raw = stage._last === 0 ? 1 / 60 : (now - stage._last) / 1000;
            const dt = Math.min(raw, 0.1);
            stage._last = now;
            adapt(Math.min(raw, 0.5));
            stage._elapsed += dt;
            stage._rigs.forEach(c => c.anim.update(dt));
            try { stage._loop?.(dt, stage._elapsed); } catch (e) { console.error('[Stage] frame', e); }
            // The frame callback may have ended the game and disposed us.
            if (!stage._disposed && stage.gl) draw();
        };
        stage._af = requestAnimationFrame(tick);
    };

    stage.stop = () => { if (stage._af) cancelAnimationFrame(stage._af); stage._af = null; };

    /** Everything, once. Safe to call twice. */
    stage.dispose = () => {
        if (stage._disposed) return;
        stage._disposed = true;
        stage.stop();
        stage._owned.forEach(fn => { try { fn(); } catch (e) {} });
        stage._owned = []; stage._resize = [];
        stage._rigs.forEach(c => c.rig.dispose());
        stage._rigs = [];
        if (stage.scene) {
            const seen = new Set();
            stage.scene.traverse(o => {
                if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
                const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
                mats.forEach(m => {
                    if (seen.has(m)) return;
                    seen.add(m);
                    ['map', 'emissiveMap', 'alphaMap'].forEach(k => m[k]?.dispose?.());
                    m.dispose();
                });
            });
            if (stage.scene.background?.isTexture) stage.scene.background.dispose();
        }
        if (stage.renderer) {
            stage.renderer.dispose();
            try { stage.renderer.forceContextLoss(); } catch (e) {}
        }
        stage.scene = null; stage.camera = null; stage.renderer = null;
        frame.remove();
        try { setBoardPaused(false); } catch (e) {}
    };

    return stage;
}

/**
 * A text sprite: a canvas texture on a plane, for signs painted into a set.
 * Returns a Mesh; the stage disposes its texture with everything else.
 */
export function textPlane(text, { w = 4, h = 1, bg = '#3b2716', fg = '#f3dca8', font = 'Bebas Neue, Impact, sans-serif', border = '#1f140b' } = {}) {
    const cv = document.createElement('canvas');
    const PX = 128;
    cv.width = Math.round(w * PX); cv.height = Math.round(h * PX);
    const g = cv.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = border; g.lineWidth = PX * 0.08;
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, cv.width - g.lineWidth, cv.height - g.lineWidth);
    g.fillStyle = fg;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = cv.height * 0.72;
    g.font = `${size}px ${font}`;
    while (g.measureText(text).width > cv.width * 0.86 && size > 10) { size -= 4; g.font = `${size}px ${font}`; }
    g.fillText(text, cv.width / 2, cv.height / 2 + size * 0.04);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
}
