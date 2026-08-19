// ============================================================
// SET PIECES — the moments the camera stops following and watches.
//
// Everything in here is a short scripted animation played on the live board.
// They live outside Renderer.js because they are content, not engine: each one
// is a storyboard for one space, and adding another should not mean touching
// the render loop.
//
// The contract, from docs/TURN_FLOW.md §6:
//
//   1. take the camera by parking state.cameraState on a mode the render loop
//      does NOT drive, so the set piece owns it outright;
//   2. block input by keeping state.gameState out of PRE_ROLL;
//   3. on completion put the board back into a consistent state WHATEVER
//      happened, hand the camera back, and only then let a card be raised;
//   4. expose a teardown any interruption can call.
//
// `clearSetPieces()` is (4) for everything below.
//
// Frequency sets the budget. A tile you land on once a match can afford six
// seconds; one you land on every third turn cannot afford one:
//
//   once/twice a match  (Gate, HQ first visit)   up to 6 s
//   a few times a match (Duel, Mystery, Magnet)  1.2 – 2 s
//   constantly          (Coin, Fine, Truce)      under 0.6 s, never gates a turn
// ============================================================

import { state } from '../core/GameState.js';
import { getScene, getCamera, getActiveAnims, getPos } from './Renderer.js';
import { sfx } from './AudioManager.js';

// Everything this module adds to the scene, so an interruption can clear it.
const _props = new Set();

function _add(obj) { const s = getScene(); if (s) { s.add(obj); _props.add(obj); } return obj; }

function _drop(obj) {
    if (!obj) return;
    const s = getScene();
    if (s) s.remove(obj);
    obj.traverse && obj.traverse(n => {
        if (n.geometry && n.geometry.dispose) n.geometry.dispose();
        const ms = Array.isArray(n.material) ? n.material : (n.material ? [n.material] : []);
        ms.forEach(m => m.dispose && m.dispose());
    });
    _props.delete(obj);
}

// Push an animation onto the renderer's own list, so it is stepped with the
// same dt cap as everything else and cancelled by the same reset.
function _anim(obj, from, to, dur, onUpdate, onComplete) {
    getActiveAnims().push({ obj, start: from, to, dur, onUpdate, onComplete });
}

// A plain timeline step with no object to interpolate.
function _beat(dur, onUpdate, onComplete) {
    _anim({ v: 0 }, { v: 0 }, { v: 1 }, dur, onUpdate, onComplete);
}

// Restore the board from a half-finished set piece. Safe to call any time.
export function clearSetPieces() {
    [..._props].forEach(_drop);
    _props.clear();
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const _coinGeo = () => new THREE.CylinderGeometry(0.34, 0.34, 0.09, 14);
const _coinMat = () => new THREE.MeshStandardMaterial({
    color: 0xfbbf24, emissive: 0xb45309, emissiveIntensity: 0.65,
    metalness: 0.6, roughness: 0.3,
});

// A spray of coins out of `from`, arcing to `to`. `to` null means "up and gone",
// which is what a plain coin tile does. Returns the group so a caller can drop it.
function _coinArc(from, to, count, dur, onDone) {
    const grp = _add(new THREE.Group());
    const geo = _coinGeo(), mat = _coinMat();
    const coins = [];
    for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = Math.PI / 2;
        grp.add(m);
        const spread = (Math.random() - 0.5) * 3.2;
        const spread2 = (Math.random() - 0.5) * 3.2;
        coins.push({
            m,
            a: from.clone(),
            b: to ? to.clone() : from.clone().add(new THREE.Vector3(spread, 9, spread2)),
            lift: 3 + Math.random() * 3,
            delay: i * 0.045,
            spin: 6 + Math.random() * 8,
        });
    }
    _beat(dur, (pr) => {
        coins.forEach(c => {
            const t = Math.max(0, Math.min(1, (pr - c.delay) / Math.max(0.05, 1 - c.delay)));
            c.m.visible = t > 0;
            c.m.position.lerpVectors(c.a, c.b, t);
            c.m.position.y += Math.sin(t * Math.PI) * c.lift;
            c.m.rotation.z += c.spin * 0.02;
            c.m.material.opacity = 1;
        });
    }, () => { _drop(grp); if (onDone) onDone(); });
    return grp;
}

// ---------------------------------------------------------------------------
// 🪙 COIN / 💰 BIG COIN — coins pop out of the tile          ~0.55 s, non-blocking
// ---------------------------------------------------------------------------
export function coinPop(worldPos, big) {
    _coinArc(worldPos.clone().setY(1.1), null, big ? 8 : 4, 0.55);
}

// ---------------------------------------------------------------------------
// 💸 FINE — a red seal stamps the tile and coins sink through it   ~0.6 s
// ---------------------------------------------------------------------------
export function finePop(worldPos, big, lostCoins = true) {
    const seal = _add(new THREE.Mesh(
        new THREE.CircleGeometry(1.5, 22),
        new THREE.MeshBasicMaterial({ color: big ? 0xdc2626 : 0xef4444, transparent: true,
                                      opacity: 0, side: THREE.DoubleSide, depthWrite: false })));
    seal.rotation.x = -Math.PI / 2;
    seal.position.copy(worldPos).setY(0.09);
    _beat(0.6, (pr) => {
        // Slams down, then fades.
        const s = pr < 0.25 ? 2.4 - pr * 5.6 : 1;
        seal.scale.setScalar(Math.max(0.4, s));
        seal.material.opacity = pr < 0.25 ? pr * 2.6 : 0.65 * (1 - (pr - 0.25) / 0.75);
    }, () => _drop(seal));

    // Coins falling THROUGH the ground rather than up: money leaving. A shield
    // that absorbed the hit still gets the seal — but nothing falls out of it,
    // because nothing was actually taken.
    if (!lostCoins) return;
    const grp = _add(new THREE.Group());
    const geo = _coinGeo(), mat = _coinMat();
    const coins = [];
    for (let i = 0; i < (big ? 6 : 3); i++) {
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = Math.PI / 2;
        grp.add(m);
        coins.push({ m, x: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 2, d: i * 0.06 });
    }
    _beat(0.6, (pr) => {
        coins.forEach(c => {
            const t = Math.max(0, Math.min(1, (pr - c.d) / 0.7));
            c.m.position.set(worldPos.x + c.x, 1.6 - t * 3.4, worldPos.z + c.z);
            c.m.rotation.z += 0.3;
            c.m.visible = t > 0 && t < 1;
        });
    }, () => _drop(grp));
}

// ---------------------------------------------------------------------------
// 🕊️ TRUCE — a dove crosses between the two tokens                 ~1.0 s
// ---------------------------------------------------------------------------
export function trucePop(aPos, bPos) {
    const dove = _add(new THREE.Group());
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9ec6ff, emissiveIntensity: 0.5 }));
    body.scale.set(1.4, 0.85, 0.9);
    dove.add(body);
    const wingGeo = new THREE.PlaneGeometry(1.5, 0.7);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide,
                                                     emissive: 0xbcd8ff, emissiveIntensity: 0.4 });
    const wings = [-1, 1].map(sgn => {
        const w = new THREE.Mesh(wingGeo, wingMat);
        w.position.set(0, 0.15, sgn * 0.5);
        dove.add(w);
        return { w, sgn };
    });
    const a = aPos.clone().setY(2.6), b = bPos.clone().setY(2.6);
    _beat(1.0, (pr) => {
        dove.position.lerpVectors(a, b, pr);
        dove.position.y = 2.6 + Math.sin(pr * Math.PI) * 3.2;
        dove.lookAt(b.x, dove.position.y, b.z);
        const flap = Math.sin(pr * Math.PI * 12) * 0.7;
        wings.forEach(({ w, sgn }) => { w.rotation.x = sgn * flap; });
    }, () => _drop(dove));
}

// ---------------------------------------------------------------------------
// 🏪 SHOP — the shopfront lights up before the modal                ~0.5 s
// ---------------------------------------------------------------------------
export function shopGlow(worldPos) {
    const glow = _add(new THREE.Mesh(
        new THREE.CylinderGeometry(1.7, 1.7, 6, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0,
                                      side: THREE.DoubleSide, depthWrite: false,
                                      blending: THREE.AdditiveBlending })));
    glow.position.copy(worldPos).setY(3);
    _beat(0.5, (pr) => {
        glow.material.opacity = Math.sin(pr * Math.PI) * 0.35;
        glow.scale.setScalar(1 + pr * 0.3);
    }, () => _drop(glow));
}

// ---------------------------------------------------------------------------
// 🧲 MAGNET — coins visibly leave THEIR counter and fly to yours    ~1.6 s
// ---------------------------------------------------------------------------
export function magnetPull(thief, victim, coins, onDone) {
    const done = () => { clearSetPieces(); if (onDone) onDone(); };
    if (!thief?.mesh || !victim?.mesh || coins <= 0) { done(); return; }

    const from = victim.mesh.position.clone().setY(1.2);
    const to   = thief.mesh.position.clone().setY(1.2);

    // A field between them, so it reads as a pull rather than coins deciding to
    // move on their own.
    const field = _add(new THREE.Mesh(
        new THREE.TorusGeometry(1.4, 0.16, 8, 20),
        new THREE.MeshStandardMaterial({ color: 0x06b6d4, emissive: 0x06b6d4,
                                         emissiveIntensity: 1.6, transparent: true, opacity: 0.9 })));
    field.position.copy(to);
    field.rotation.x = Math.PI / 2;

    _takeCamera(_midShot(from, to), 1.6);
    sfx('swap');
    _beat(1.6, (pr) => {
        field.scale.setScalar(1 + Math.sin(pr * Math.PI * 3) * 0.35);
        field.material.opacity = 0.9 * (1 - pr * 0.4);
    }, () => _drop(field));
    _coinArc(from, to, Math.min(8, Math.max(3, coins)), 1.6, done);
}

// ---------------------------------------------------------------------------
// 🏛️ DISTRICT HQ — the biggest coin event in the game               ~1.9 s
// ---------------------------------------------------------------------------
export function hqPayout(player, amount, onDone) {
    const done = () => { clearSetPieces(); if (onDone) onDone(); };
    if (!player?.mesh) { done(); return; }
    const at = player.mesh.position.clone().setY(0);

    // A shaft of light up out of the HQ, and coins spiralling down out of it.
    const shaft = _add(new THREE.Mesh(
        new THREE.CylinderGeometry(2.2, 1.2, 16, 22, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0,
                                      side: THREE.DoubleSide, depthWrite: false,
                                      blending: THREE.AdditiveBlending })));
    shaft.position.copy(at).setY(8);

    // Crane up: the HQ is a building, and you should see it as one.
    const cam = getCamera();
    const startPose = { pos: cam.position.clone(), look: at.clone().setY(2) };
    const endPose   = { pos: at.clone().add(new THREE.Vector3(0, 20, 24)), look: at.clone().setY(6) };
    _takeCameraPath(startPose, endPose, 1.9);

    sfx('coin_gain');
    _beat(1.9, (pr) => {
        shaft.material.opacity = Math.sin(Math.min(1, pr * 1.4) * Math.PI) * 0.32;
        shaft.rotation.y = pr * 3;
    }, () => _drop(shaft));

    const top = at.clone().setY(15);
    _coinArc(top, at.clone().setY(1.2), Math.min(10, Math.max(5, Math.round(amount / 2))), 1.9, done);
}

// ---------------------------------------------------------------------------
// 🎁 MYSTERY — a crate lands and cracks open                        ~1.5 s
// ---------------------------------------------------------------------------
export function mysteryUnbox(worldPos, onDone) {
    const done = () => { clearSetPieces(); if (onDone) onDone(); };
    const at = worldPos.clone().setY(0);

    const crate = _add(new THREE.Group());
    const mat = new THREE.MeshStandardMaterial({ color: 0xa855f7, metalness: 0.2, roughness: 0.6,
                                                 emissive: 0x3b0764, emissiveIntensity: 0.5 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 2), mat);
    box.position.y = 0.75;
    crate.add(box);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 2.2), mat);
    lid.position.y = 1.65;
    crate.add(lid);
    // A ribbon, so it reads as a present rather than a packing case.
    const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.8 });
    [[2.15, 0.28, 0.4], [0.4, 0.28, 2.15]].forEach(d => {
        const r = new THREE.Mesh(new THREE.BoxGeometry(d[0], d[1], d[2]), ribbonMat);
        r.position.y = 1.66;
        crate.add(r);
    });
    crate.position.copy(at);

    const burst = _add(new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xe9d5ff, transparent: true, opacity: 0,
                                      depthWrite: false, blending: THREE.AdditiveBlending })));
    burst.position.copy(at).setY(1.8);

    _takeCamera({ pos: at.clone().add(new THREE.Vector3(0, 7, 13)), look: at.clone().setY(1.6) }, 1.5);

    _beat(1.5, (pr) => {
        if (pr < 0.35) {
            // Drops in.
            crate.position.y = (1 - pr / 0.35) * 16;
            crate.rotation.y = pr * 5;
        } else {
            crate.position.y = 0;
            // Lid pops and the box shakes apart.
            const t = (pr - 0.35) / 0.65;
            lid.position.y = 1.65 + t * 5;
            lid.rotation.z = t * 2.2;
            lid.rotation.x = t * 1.4;
            box.scale.setScalar(Math.max(0.01, 1 - t * 0.9));
            burst.material.opacity = Math.sin(t * Math.PI) * 0.85;
            burst.scale.setScalar(0.6 + t * 3.4);
        }
    }, () => { sfx('land_good'); _drop(crate); _drop(burst); done(); });
    // The thud, when it lands.
    _beat(0.36, null, () => sfx('dice_land'));
}

// ---------------------------------------------------------------------------
// ⚓ ANCHOR — the trap springs and drags you back                    ~1.4 s
//     Runs BEFORE the move, so the player sees why they are about to travel
//     backwards. The move itself still happens through the normal path.
// ---------------------------------------------------------------------------
export function anchorSpring(worldPos, onDone) {
    const done = () => { clearSetPieces(); if (onDone) onDone(); };
    const at = worldPos.clone().setY(0);

    const anchor = _add(new THREE.Group());
    const mat = new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.75, roughness: 0.35,
                                                 emissive: 0x431407, emissiveIntensity: 0.6 });
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3.2, 10), mat);
    shank.position.y = 1.8;
    anchor.add(shank);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.28, 0.28), mat);
    stock.position.y = 3.0;
    anchor.add(stock);
    const fluke = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.22, 8, 16, Math.PI), mat);
    fluke.position.y = 0.5;
    fluke.rotation.x = Math.PI / 2;
    fluke.rotation.z = Math.PI;
    anchor.add(fluke);
    anchor.position.copy(at);

    const dust = _add(new THREE.Mesh(
        new THREE.RingGeometry(0.4, 2.6, 24),
        new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0,
                                      side: THREE.DoubleSide, depthWrite: false })));
    dust.rotation.x = -Math.PI / 2;
    dust.position.copy(at).setY(0.1);

    _takeCamera({ pos: at.clone().add(new THREE.Vector3(0, 6, 14)), look: at.clone().setY(2) }, 1.4);

    let thudded = false;
    _beat(1.4, (pr) => {
        if (pr < 0.32) {
            anchor.position.y = (1 - pr / 0.32) * 26;   // falls out of the sky
        } else {
            anchor.position.y = 0;
            if (!thudded) { thudded = true; sfx('land_bad'); }
            const t = (pr - 0.32) / 0.68;
            dust.material.opacity = Math.sin(t * Math.PI) * 0.7;
            dust.scale.setScalar(1 + t * 2.2);
            anchor.position.y = -t * 1.2;                // digs in and drags
        }
    }, () => { _drop(anchor); _drop(dust); done(); });
}

// ---------------------------------------------------------------------------
// ⚔️ DUEL — the face-off, before the bet                            ~1.4 s
// ---------------------------------------------------------------------------
export function duelFaceoff(a, b, onDone) {
    const done = () => { clearSetPieces(); if (onDone) onDone(); };
    if (!a?.mesh || !b?.mesh) { done(); return; }
    const pa = a.mesh.position.clone().setY(0);
    const pb = b.mesh.position.clone().setY(0);
    const mid = pa.clone().add(pb).multiplyScalar(0.5);

    // Crossed sparks over the midpoint: the stake, before there is one.
    const clash = _add(new THREE.Group());
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xff6b35, transparent: true, opacity: 0,
                                                   depthWrite: false, blending: THREE.AdditiveBlending });
    [0, 1].forEach(i => {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.5), sparkMat);
        s.rotation.z = i ? 0.7 : -0.7;
        clash.add(s);
    });
    clash.position.copy(mid).setY(3);

    _takeCamera({ pos: mid.clone().add(new THREE.Vector3(0, 4.5, 17)), look: mid.clone().setY(2) }, 1.4);
    sfx('land_bad');
    _beat(1.4, (pr) => {
        clash.children.forEach(c => { c.material.opacity = Math.sin(pr * Math.PI) * 0.9; });
        clash.scale.setScalar(0.4 + pr * 1.3);
        clash.lookAt(getCamera().position);
    }, () => { _drop(clash); done(); });
}

// ---------------------------------------------------------------------------
// 🔒 THE GATE — the breach                                          ~2.2 s
//     The only permanent change to the board in a match. It gets to be seen.
// ---------------------------------------------------------------------------
export function gateBreach(worldPos, onDone) {
    const done = () => { clearSetPieces(); if (onDone) onDone(); };
    const at = worldPos.clone().setY(0);

    const shards = _add(new THREE.Group());
    const mat = new THREE.MeshStandardMaterial({ color: 0xb45309, metalness: 0.6, roughness: 0.4,
                                                 emissive: 0x7c2d12, emissiveIntensity: 0.7 });
    const bits = [];
    for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.5 + Math.random() * 0.8, 0.5 + Math.random(), 0.3), mat);
        shards.add(m);
        bits.push({
            m,
            from: new THREE.Vector3((Math.random() - 0.5) * 3, 0.6 + Math.random() * 4, (Math.random() - 0.5) * 1.2),
            vel:  new THREE.Vector3((Math.random() - 0.5) * 14, 5 + Math.random() * 9, (Math.random() - 0.5) * 14),
            spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
        });
    }
    shards.position.copy(at);

    const flash = _add(new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0,
                                      depthWrite: false, blending: THREE.AdditiveBlending })));
    flash.position.copy(at).setY(2.5);

    // Push in on the gate, then pass through it.
    const near = at.clone().add(new THREE.Vector3(0, 5, 15));
    const thru = at.clone().add(new THREE.Vector3(0, 4, -8));
    _takeCameraPath({ pos: near, look: at.clone().setY(3) },
                    { pos: thru, look: at.clone().setY(2) }, 2.2);
    sfx('gate_open');

    _beat(2.2, (pr) => {
        const t = Math.max(0, (pr - 0.18) / 0.82);
        flash.material.opacity = pr < 0.3 ? Math.sin((pr / 0.3) * Math.PI) * 0.9 : 0;
        flash.scale.setScalar(1 + pr * 7);
        bits.forEach(bt => {
            bt.m.position.set(
                bt.from.x + bt.vel.x * t,
                Math.max(0.1, bt.from.y + bt.vel.y * t - 16 * t * t),
                bt.from.z + bt.vel.z * t);
            bt.m.rotation.set(bt.spin.x * t, bt.spin.y * t, bt.spin.z * t);
            bt.m.material.opacity = 1;
            bt.m.visible = t < 0.95;
        });
    }, () => { _drop(shards); _drop(flash); done(); });
}

// ---------------------------------------------------------------------------
// Camera helpers
// ---------------------------------------------------------------------------
//
// A set piece owns the camera for its duration. 'CINEMATIC' is deliberately a
// mode the render loop does not drive, so nothing fights these for control; the
// caller is responsible for handing it back (see restoreCamera).

function _midShot(a, b) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    return { pos: mid.clone().add(new THREE.Vector3(0, 12, 20)), look: mid.clone().setY(1) };
}

function _takeCamera(pose, dur) {
    const cam = getCamera();
    if (!cam) return;
    state.cameraState = 'CINEMATIC';
    const from = cam.position.clone();
    _beat(dur, (pr) => {
        const e = 1 - Math.pow(1 - pr, 3);
        cam.position.lerpVectors(from, pose.pos, e);
        cam.lookAt(pose.look);
    });
}

function _takeCameraPath(a, b, dur) {
    const cam = getCamera();
    if (!cam) return;
    state.cameraState = 'CINEMATIC';
    const look = a.look.clone();
    _beat(dur, (pr) => {
        const e = 1 - Math.pow(1 - pr, 3);
        cam.position.lerpVectors(a.pos, b.pos, e);
        look.lerpVectors(a.look, b.look, e);
        cam.lookAt(look);
    });
}
