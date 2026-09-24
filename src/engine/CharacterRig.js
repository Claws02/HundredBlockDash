// ============================================================
// CHARACTER RIG + ANIMATOR — the board's figures, made to move
// ============================================================
//
// `createCharacterMesh()` builds each figure as one flat Group of anonymous
// meshes. That is right for the board, where a token only ever hops as a whole,
// and useless for a minigame where you are supposed to BE the character: nothing
// in it can nod, wave or fall over on its own.
//
// This module re-parents that same figure into a small hierarchy it can animate,
// without changing a line of how the board builds or uses it:
//
//   root            world placement and facing (rotation.y). Owns the shadow.
//    ├ shadow       the contact disc, left on the ground when the body hops
//    ├ hips         bob, hop, squash-stretch, lean and fall
//    │  ├ …body     every part below the neck
//    │  └ neck      nod and tilt
//    │     └ …head  every part above the neck, eyes included
//    └ hands[0..1]  two floating mitts. The figures are armless toys, and a pair
//                   of hovering gloves is how toys like this get hands without
//                   growing arms. A hand can hold a prop.
//
// The animator is procedural: no skeletons, no clips, no loader. Every state is
// a function of time that writes a target pose, and the pose is damped toward
// it, so switching state blends on its own. That keeps it inside a static site
// on three r128 with nothing added to vendor/.
//
// Sizes are in units of the figure's own height, so the same walk reads the
// same on the squat slime and the banker in his top hat.
// ============================================================

import { createCharacterMesh } from './Renderer.js';

// Where the neck is, as a height in the figure's own units. Parts above it are
// the head. `null` means the figure IS its head — the slime, Boxy and the bunny
// have no neck to bend, so their whole body nods instead.
const NECK_Y = {
    slime: null, boxy: null, bunny: null,
    ghost: 1.0, cabbie: 0.98, vendor: 0.98,
    banker: 1.18, bodyguard: 1.32, investor: 1.16,
};

const GLOVE = 0xf6f7fb;

/**
 * Build a figure and rig it. Returns the rig; add `rig.root` to a scene.
 * `dispose()` releases every geometry and material it made.
 */
export function buildRiggedCharacter(type, color) {
    const fig = createCharacterMesh(type, color);
    const root = new THREE.Group();
    const hips = new THREE.Group();
    const neck = new THREE.Group();
    root.add(hips);

    // Measure before re-parenting, with the shadow disc left out of the box.
    const box = new THREE.Box3();
    fig.children.forEach(c => { if (!c.userData.contact) box.expandByObject(c); });
    const H = Math.max(0.6, box.max.y);
    const halfW = Math.max(0.35, Math.max(box.max.x, -box.min.x));
    const front = Math.max(0.3, box.max.z);

    const neckY = NECK_Y[type] ?? null;
    neck.position.y = neckY ?? H * 0.55;
    hips.add(neck);

    let shadow = null;
    const eyes = [];
    // Copy first: re-parenting removes each child from `fig.children`.
    fig.children.slice().forEach(c => {
        if (c.userData.contact) { shadow = c; root.add(c); return; }
        if (c.userData.eye) eyes.push(c);
        if (neckY !== null && c.position.y > neckY) {
            c.position.y -= neckY;
            neck.add(c);
        } else {
            hips.add(c);
        }
    });

    // The mitts. Sized off the figure's width so Boxy's are not the same as
    // the slime's, and clamped so neither looks like a boxing glove.
    const handR = Math.min(0.2, Math.max(0.13, halfW * 0.24));
    const gloveMat = new THREE.MeshStandardMaterial({ color: GLOVE, roughness: 0.45 });
    const cuffMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
    const hands = [-1, 1].map(side => {
        const h = new THREE.Group();
        const mitt = new THREE.Mesh(new THREE.SphereGeometry(handR, 14, 12), gloveMat);
        mitt.scale.set(1, 0.9, 1.1);
        mitt.castShadow = true;
        h.add(mitt);
        const cuff = new THREE.Mesh(new THREE.TorusGeometry(handR * 0.78, handR * 0.26, 8, 16), cuffMat);
        cuff.position.z = -handR * 0.55;
        h.add(cuff);
        const thumb = new THREE.Mesh(new THREE.SphereGeometry(handR * 0.42, 10, 8), gloveMat);
        thumb.position.set(-side * handR * 0.75, handR * 0.35, handR * 0.2);
        h.add(thumb);
        h.userData.side = side;
        root.add(h);
        return h;
    });

    const rig = {
        type, color, root, hips, neck, eyes, hands, shadow,
        H, halfW, front, handR,
        /** Put a prop in a hand. `side` is -1 (left) or 1 (right). */
        hold(side, obj) {
            const h = hands[side < 0 ? 0 : 1];
            h.add(obj);
            return obj;
        },
        dispose() {
            const seen = new Set();
            root.traverse(o => {
                if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
                const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
                mats.forEach(m => { if (!seen.has(m)) { seen.add(m); if (m.map) m.map.dispose(); m.dispose(); } });
            });
            root.parent?.remove(root);
        },
    };
    return rig;
}

// ============================================================
// THE ANIMATOR
// ============================================================

// A pose is a flat record of numbers. Every state writes all of them, so a
// state never inherits a stray value from the last one.
function _rest(rig) {
    return {
        y: 0,            // hop height, units of H
        squash: 1,       // hips scale.y; x/z get the inverse square root
        leanX: 0,        // forward (+) / back (-), radians
        rollZ: 0,        // side to side, radians
        fallX: 0,        // whole-body topple backwards, radians
        spinY: 0,        // added to the facing, radians
        nod: 0, tilt: 0, // neck
        eyeOpen: 1,      // 0 shut … 1 open … 1.3 startled
        hand: [
            { x: -(rig.halfW + rig.handR * 1.3), y: rig.H * 0.38, z: 0.08, rx: 0 },
            { x:  (rig.halfW + rig.handR * 1.3), y: rig.H * 0.38, z: 0.08, rx: 0 },
        ],
    };
}

// How quickly the pose chases its target, per second. Fast enough that a
// draw snaps, slow enough that a state change is a movement and not a cut.
const DAMP = 16;
const _damp = (a, b, k) => a + (b - a) * k;

/**
 * Drives one rig. Call `play(state)` to change what it is doing and `update(dt)`
 * once a frame. `fire()` and `flinch()` are one-shot accents layered on top of
 * whatever state is running.
 */
export class CharacterAnimator {
    constructor(rig) {
        this.rig = rig;
        this.state = 'idle';
        this.t = 0;                 // time in the current state
        this.clock = Math.random() * 10;
        this.facing = 0;            // radians, root.rotation.y target
        this.turnRate = 10;         // rad/s toward `facing`
        this.rate = 2;              // walk cadence, steps per second
        this.pose = _rest(rig);
        this.target = _rest(rig);
        this._blinkAt = 1 + Math.random() * 3;
        this._kick = 0;             // recoil accent, decays
        this._jolt = 0;             // flinch accent, decays
        this.onStep = null;         // (stepIndex) => void, fired on each footfall
        this._lastStep = -1;
    }

    play(state, opts = {}) {
        if (state === this.state && !opts.restart) return;
        this.state = state;
        this.t = 0;
        this._lastStep = -1;
        if (opts.rate) this.rate = opts.rate;
    }

    face(angle, instant = false) {
        this.facing = angle;
        if (instant) this.rig.root.rotation.y = angle;
    }

    /** Recoil from a shot. */
    fire() { this._kick = 1; }
    /** A startled jump, on top of whatever is running. */
    flinch() { this._jolt = 1; }

    update(dt) {
        this.t += dt;
        this.clock += dt;
        const r = this.rig, H = r.H, T = this.target, t = this.t;
        const base = _rest(r);
        Object.assign(T, base);
        T.hand = base.hand;

        // Breath under everything, so no state is ever perfectly still.
        const breath = Math.sin(this.clock * 2.3);
        T.squash = 1 + breath * 0.018;

        switch (this.state) {
        case 'idle':
            T.y = 0;
            T.hand[0].y += breath * 0.02 * H;
            T.hand[1].y -= breath * 0.02 * H;
            break;

        case 'walk': {
            // A toy's walk is a waddle: a small hop per step, rolling onto
            // each side, the hands swinging opposite the lean.
            const ph = t * this.rate * Math.PI;
            const s = Math.sin(ph);
            T.y = Math.abs(s) * 0.07;
            T.rollZ = s * 0.12;
            T.leanX = 0.08;
            T.squash = 1 + (Math.abs(s) - 0.5) * 0.08;
            T.hand[0].z += s * 0.28 * H;
            T.hand[1].z -= s * 0.28 * H;
            T.hand[0].y += Math.abs(s) * 0.04 * H;
            T.hand[1].y += Math.abs(s) * 0.04 * H;
            const step = Math.floor(t * this.rate);
            if (step !== this._lastStep) { this._lastStep = step; this.onStep?.(step); }
            break;
        }

        case 'ready': {
            // Hand hovering over the holster. Weight forward, eyes narrowed,
            // the gun hand trembling very slightly.
            T.leanX = 0.1;
            T.squash = 0.97 + breath * 0.01;
            T.eyeOpen = 0.55;
            const shake = Math.sin(this.clock * 31) * 0.012 * H;
            T.hand[1].y = H * 0.3 + shake;
            T.hand[1].x += 0.06 * H;
            T.hand[1].z = 0.02;
            T.hand[0].y = H * 0.44;
            T.hand[0].x -= 0.08 * H;
            break;
        }

        case 'aim':
            // Arm out, pointing down the facing axis.
            T.leanX = -0.04;
            T.eyeOpen = 0.6;
            T.hand[1].x = r.halfW * 0.55;
            T.hand[1].y = H * 0.58;
            T.hand[1].z = r.front + H * 0.55;
            T.hand[1].rx = 0;
            T.hand[0].y = H * 0.36;
            break;

        case 'hit': {
            // Knocked back: a hop backwards and a wobble, then down.
            const k = Math.min(1, t / 0.22);
            T.leanX = -0.5 * k;
            T.y = Math.sin(Math.min(1, t / 0.4) * Math.PI) * 0.25;
            T.spinY = Math.sin(t * 22) * 0.2 * Math.max(0, 1 - t * 2);
            T.eyeOpen = 1.35;
            T.hand[0].y = H * 0.85; T.hand[1].y = H * 0.85;
            T.hand[0].z = -0.1; T.hand[1].z = -0.1;
            if (t > 0.35) this.play('fall');
            break;
        }

        case 'fall': {
            // Flat on its back, one bounce, and the hands flop.
            const k = Math.min(1, t / 0.32);
            const ease = 1 - Math.pow(1 - k, 3);
            T.fallX = -1.45 * ease + Math.sin(Math.min(1, t / 0.6) * Math.PI) * 0.1 * (t > 0.32 ? 1 : 0);
            T.eyeOpen = 0.12;
            T.squash = 0.96;
            T.hand[0].y = H * 0.25; T.hand[1].y = H * 0.25;
            T.hand[0].x -= 0.2 * H; T.hand[1].x += 0.2 * H;
            break;
        }

        case 'victory': {
            // Bounce on the spot, gun hand up, the other hand waving.
            const ph = t * 5.5;
            T.y = Math.abs(Math.sin(ph)) * 0.22;
            T.squash = 1 + Math.sin(ph * 2) * 0.07;
            T.eyeOpen = 1.1;
            T.hand[1].y = H * 1.05;
            T.hand[1].z = 0.15;
            T.hand[0].y = H * 0.95 + Math.sin(t * 14) * 0.08 * H;
            T.hand[0].x -= 0.12 * H + Math.sin(t * 14) * 0.1 * H;
            T.tilt = Math.sin(t * 5.5) * 0.12;
            break;
        }

        case 'duck':
            // Flat to the roof, hands over the head: low enough for a bridge
            // to go over, braced against a shove.
            T.squash = 0.55;
            T.leanX = 0.22;
            T.nod = 0.25;
            T.eyeOpen = 0.35;
            T.hand[0].y = H * 0.62; T.hand[1].y = H * 0.62;
            T.hand[0].x = -r.halfW * 0.45; T.hand[1].x = r.halfW * 0.45;
            T.hand[0].z = 0.18; T.hand[1].z = 0.18;
            break;

        case 'shove':
            // Both hands out in front, weight thrown behind them.
            T.leanX = 0.38;
            T.squash = 0.94;
            T.eyeOpen = 1.15;
            T.hand[0].x = -r.halfW * 0.5; T.hand[1].x = r.halfW * 0.5;
            T.hand[0].y = H * 0.5; T.hand[1].y = H * 0.5;
            T.hand[0].z = r.front + H * 0.45; T.hand[1].z = r.front + H * 0.45;
            break;

        case 'run': {
            // Flat out: leaning into it, the hands pumping high and hard.
            const ph = t * this.rate * Math.PI;
            const s = Math.sin(ph);
            T.y = Math.abs(s) * 0.1;
            T.rollZ = s * 0.06;
            T.leanX = 0.32;
            T.squash = 1 + (Math.abs(s) - 0.5) * 0.1;
            T.eyeOpen = 0.8;
            T.hand[0].z += s * 0.42 * H; T.hand[1].z -= s * 0.42 * H;
            T.hand[0].y += (0.12 + Math.max(0, s) * 0.14) * H;
            T.hand[1].y += (0.12 + Math.max(0, -s) * 0.14) * H;
            const step = Math.floor(t * this.rate);
            if (step !== this._lastStep) { this._lastStep = step; this.onStep?.(step); }
            break;
        }

        case 'jump': {
            // Stretched on the way up, tucked at the top, hands flung high.
            const k = Math.min(1, t / 0.18);
            T.squash = 1.1 - 0.16 * k;
            T.leanX = 0.18;
            T.eyeOpen = 1.2;
            T.hand[0].y = H * (0.7 + 0.25 * k); T.hand[1].y = H * (0.7 + 0.25 * k);
            T.hand[0].x -= 0.12 * H; T.hand[1].x += 0.12 * H;
            T.hand[0].z = 0.1; T.hand[1].z = 0.1;
            break;
        }

        case 'slide':
            // Feet first, leaning right back, one hand out for balance.
            T.squash = 0.6;
            T.leanX = -0.55;
            T.eyeOpen = 1.1;
            T.hand[0].y = H * 0.18; T.hand[0].z = -0.15 * H; T.hand[0].x -= 0.2 * H;
            T.hand[1].y = H * 0.7; T.hand[1].z = r.front + H * 0.3;
            break;

        case 'defeat':
            // Shoulders down, head down.
            T.leanX = 0.28;
            T.squash = 0.92;
            T.nod = 0.35;
            T.eyeOpen = 0.4;
            T.hand[0].y = H * 0.18; T.hand[1].y = H * 0.18;
            T.hand[0].x += 0.06 * H; T.hand[1].x -= 0.06 * H;
            break;
        }

        // Accents.
        if (this._kick > 0) {
            T.hand[1].rx -= 0.9 * this._kick;
            T.hand[1].y += 0.18 * H * this._kick;
            T.hand[1].z -= 0.12 * H * this._kick;
            T.leanX -= 0.12 * this._kick;
            this._kick = Math.max(0, this._kick - dt * 5);
        }
        if (this._jolt > 0) {
            T.y += 0.18 * Math.sin(this._jolt * Math.PI);
            T.eyeOpen = 1.35;
            T.hand[0].y += 0.3 * H * this._jolt; T.hand[1].y += 0.3 * H * this._jolt;
            this._jolt = Math.max(0, this._jolt - dt * 3.2);
        }

        // Blink, unless the state has the eyes shut already.
        this._blinkAt -= dt;
        if (this._blinkAt < 0) {
            if (this._blinkAt < -0.12) this._blinkAt = 2 + Math.random() * 3;
            else T.eyeOpen = Math.min(T.eyeOpen, 0.08);
        }

        this.applyPose(dt);
    }

    applyPose(dt) {
        const r = this.rig, P = this.pose, T = this.target, H = r.H;
        const k = 1 - Math.exp(-DAMP * dt);
        for (const key of ['y', 'squash', 'leanX', 'rollZ', 'fallX', 'spinY', 'nod', 'tilt']) {
            P[key] = _damp(P[key], T[key], k);
        }
        // Eyes shut faster than anything else moves, or a blink is a squint.
        P.eyeOpen = _damp(P.eyeOpen, T.eyeOpen, 1 - Math.exp(-40 * dt));
        for (let i = 0; i < 2; i++) {
            const a = P.hand[i], b = T.hand[i];
            a.x = _damp(a.x, b.x, k); a.y = _damp(a.y, b.y, k);
            a.z = _damp(a.z, b.z, k); a.rx = _damp(a.rx, b.rx, k);
        }

        // Facing: shortest way round.
        let d = this.facing - r.root.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const step = this.turnRate * dt;
        r.root.rotation.y += Math.abs(d) <= step ? d : Math.sign(d) * step;

        const hips = r.hips;
        hips.position.y = P.y * H;
        const sq = P.squash, inv = 1 / Math.sqrt(Math.max(0.5, sq));
        hips.scale.set(inv, sq, inv);
        hips.rotation.set(P.leanX + P.fallX, P.spinY, P.rollZ);
        r.neck.rotation.set(P.nod, 0, P.tilt);
        r.eyes.forEach(e => { e.scale.y = Math.max(0.05, P.eyeOpen); });

        // Hands follow the hips' topple so a fallen figure's hands are on the
        // ground beside it rather than floating where it used to stand.
        r.hands.forEach((h, i) => {
            const a = P.hand[i];
            const fall = P.fallX;
            const cy = Math.cos(fall), sy = Math.sin(fall);
            const y = a.y * cy - a.z * sy;
            const z = a.y * sy + a.z * cy;
            h.position.set(a.x, y + P.y * H, z);
            h.rotation.x = a.rx + fall;
        });

        // The shadow shrinks as the body leaves the ground.
        if (r.shadow) {
            const s = 1 / (1 + P.y * 2.2);
            r.shadow.scale.set(s, s, s);
        }
    }
}
