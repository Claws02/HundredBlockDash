// ============================================================
// BRAINROT TOWER — THE CAST
//
// Twenty-four plush mash-ups for the claw machine. Every one is ours: absurd
// object + animal (or object + job) pairings with made-up fake-Italian names,
// in the "brainrot" style but not copied from it. Each concept was checked
// against the well-known brainrot characters, and anything that shared a
// pairing with one (a shark in sneakers, a log with a bat, a coffee-cup
// ballerina or assassin, a fridge-animal, a tyre-animal, a watermelon-animal,
// a monkey-banana, an elephant-cactus) was redesigned. That is a good-faith
// check, not legal advice.
//
// A critter is:
//   key, name    id and the name on the turn banner
//   mass         kg-ish; heavier ones shove the tower more
//   shapes       the physics: { box: [hx, hy, hz] } or { sphere: r }, with an
//                optional off: [x, y, z] and roll (radians about z). The game
//                plays in the x/y plane, so z only needs to be deep enough to
//                look right.
//   look()       a THREE.Group of primitives, centred on the body's origin
//
// Shapes are deliberately varied: flat ones are easy to build on, round ones
// roll, L-shapes and V-shapes catch and tip, top-heavy ones topple.
// ============================================================

// ── Look helpers ─────────────────────────────────────────────────────────────
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
function P(g, geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; }
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sph = (r, a = 12, b = 10, ...arc) => new THREE.SphereGeometry(r, a, b, ...arc);
const cyl = (rt, rb, h, s = 14) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
const tor = (r, t, a = 8, b = 16) => new THREE.TorusGeometry(r, t, a, b);
function eyes(g, x, y, z, r = 0.07, gap = 0.1) {
    const white = M(0xffffff, { roughness: 0.3 }), black = M(0x111111, { roughness: 0.3 });
    [-1, 1].forEach(s => {
        P(g, sph(r, 10, 8), white, x + s * gap, y, z);
        P(g, sph(r * 0.5, 8, 6), black, x + s * gap + r * 0.15, y - r * 0.15, z + r * 0.7);
    });
}
const grin = (g, x, y, z, w = 0.14, col = 0x3a1010) => P(g, box(w, 0.03, 0.02), M(col), x, y, z);

// ── The looks ────────────────────────────────────────────────────────────────
function sardine() {                     // a sardine with piano keys down its side and a bow tie
    const g = new THREE.Group();
    P(g, sph(0.4, 16, 12), M(0xb8c6d9, { metalness: 0.4, roughness: 0.4 }), 0, 0, 0).scale.set(1.5, 0.5, 0.55);
    P(g, box(0.7, 0.1, 0.02), M(0xffffff), 0, -0.02, 0.22);
    for (let i = 0; i < 5; i++) P(g, box(0.05, 0.06, 0.02), M(0x111111), -0.24 + i * 0.12, 0.01, 0.235);
    const tail = P(g, cone(0.16, 0.3, 4), M(0x8fa3bf), -0.64, 0, 0); tail.rotation.z = Math.PI / 2;
    [-1, 1].forEach(s => { const t = P(g, cone(0.06, 0.12, 4), M(0xe0482f), 0.38 + s * 0.07, -0.12, 0.18); t.rotation.z = s * Math.PI / 2; });
    eyes(g, 0.42, 0.07, 0.16, 0.06, 0.07);
    return g;
}
function baguette() {                    // a baguette in a samurai headband with a chopstick sword
    const g = new THREE.Group();
    P(g, cyl(0.18, 0.18, 1.1, 14), M(0xd9a35b), 0, 0, 0).rotation.z = Math.PI / 2;
    [-1, 1].forEach(s => P(g, sph(0.18, 12, 10), M(0xd9a35b), s * 0.55, 0, 0));
    for (let i = 0; i < 4; i++) { const c = P(g, box(0.05, 0.02, 0.2), M(0xf5deb3), -0.35 + i * 0.2, 0.17, 0); c.rotation.y = 0.6; }
    P(g, cyl(0.19, 0.19, 0.08, 14), M(0xe0482f), 0.3, 0, 0).rotation.z = Math.PI / 2;
    const sword = P(g, cyl(0.02, 0.02, 0.7, 6), M(0xe8d9b0), -0.05, 0.2, 0.2); sword.rotation.z = 1.2;
    eyes(g, 0.4, 0.05, 0.17, 0.055, 0.075);
    return g;
}
function teapot() {                      // a teapot opera tenor in a bow tie, mid-note
    const g = new THREE.Group();
    P(g, sph(0.3, 16, 12), M(0x6fc3df, { roughness: 0.4 }), 0, -0.02, 0).scale.set(1, 0.85, 0.85);
    P(g, cyl(0.12, 0.16, 0.08), M(0x6fc3df), 0, 0.24, 0);
    P(g, sph(0.05, 8, 6), M(0xffde59), 0, 0.3, 0);
    const spout = P(g, cyl(0.04, 0.07, 0.3, 8), M(0x6fc3df), 0.32, 0.02, 0); spout.rotation.z = -0.9;
    P(g, tor(0.1, 0.03, 6, 12), M(0x6fc3df), -0.3, 0.0, 0);
    [-1, 1].forEach(s => { const t = P(g, cone(0.06, 0.12, 4), M(0x111111), s * 0.07, -0.18, 0.24); t.rotation.z = s * Math.PI / 2; });
    P(g, sph(0.05, 10, 8), M(0x6b1a1a), 0, -0.07, 0.25).scale.set(1, 1.3, 0.6);   // the open mouth
    eyes(g, 0, 0.08, 0.24, 0.055, 0.09);
    return g;
}
function wardrobe() {                    // a wardrobe with an owl's face and ear tufts
    const g = new THREE.Group();
    P(g, box(0.6, 1.0, 0.52), M(0x9b6b3d, { roughness: 0.6 }));
    P(g, box(0.02, 0.8, 0.53), M(0x5a3d1a), 0, -0.05, 0);
    [-1, 1].forEach(s => P(g, sph(0.035, 8, 6), M(0xffde59, { metalness: 0.6 }), s * 0.06, -0.05, 0.27));
    [-1, 1].forEach(s => { const t = P(g, cone(0.08, 0.2, 4), M(0x9b6b3d), s * 0.22, 0.56, 0); t.rotation.z = -s * 0.3; });
    [-1, 1].forEach(s => P(g, tor(0.1, 0.025, 6, 14), M(0xf5deb3), s * 0.15, 0.32, 0.27));
    eyes(g, 0, 0.32, 0.27, 0.08, 0.15);
    P(g, cone(0.05, 0.1, 4), M(0xffa53d), 0, 0.2, 0.28).rotation.x = Math.PI;
    return g;
}
function banana() {                      // a bent banana in a bandit's mask
    const g = new THREE.Group();
    const yel = M(0xffe14d);
    [-1, 1].forEach(s => { const h = P(g, cyl(0.09, 0.12, 0.62, 10), yel, s * 0.25, 0.04, 0); h.rotation.z = Math.PI / 2 + s * 0.42; });
    [-1, 1].forEach(s => P(g, sph(0.06, 8, 6), M(0x5a3d1a), s * 0.53, 0.29, 0));
    P(g, box(0.3, 0.07, 0.25), M(0x111111), 0, 0.06, 0.02);
    eyes(g, 0, 0.065, 0.13, 0.04, 0.07);
    return g;
}
function pizza() {                       // a slab of pizza with a hippo's snout
    const g = new THREE.Group();
    P(g, box(1.1, 0.2, 0.78), M(0xf2b45a));
    P(g, box(1.06, 0.03, 0.74), M(0xe0482f), 0, 0.11, 0);
    [[-0.3, 0.1], [0.15, -0.2], [0.35, 0.18], [-0.1, -0.15]].forEach(([x, z]) => P(g, cyl(0.07, 0.07, 0.02, 10), M(0xa3201a), x, 0.13, z));
    // Side-on is how it's seen, so the front edge carries the toppings: sauce, melted cheese, pepperoni.
    P(g, box(1.06, 0.07, 0.02), M(0xe0482f), 0, 0.06, 0.4);
    [-0.4, -0.15, 0.1, 0.3].forEach((x, i) => P(g, box(0.07, 0.08 + (i % 2) * 0.05, 0.02), M(0xffe9a8), x, 0.0, 0.405));
    [-0.3, 0.0, 0.22].forEach(x => P(g, cyl(0.06, 0.06, 0.02, 10), M(0xa3201a), x, 0.04, 0.41).rotation.x = Math.PI / 2);
    P(g, sph(0.2, 12, 10), M(0xb68cff), 0.52, 0.06, 0.18).scale.set(0.8, 0.7, 1);
    [-1, 1].forEach(s => P(g, sph(0.06, 8, 6), M(0xb68cff), 0.4, 0.2, 0.18 + s * 0.12));
    eyes(g, 0.4, 0.2, 0.3, 0.055, 0.1);
    return g;
}
function meatball() {                    // a meatball in a chef's hat
    const g = new THREE.Group();
    P(g, sph(0.3, 16, 12), M(0x8a3b1e, { roughness: 1 }));
    P(g, cyl(0.15, 0.13, 0.22, 12), M(0xffffff), 0, 0.36, 0);
    P(g, sph(0.17, 12, 8), M(0xffffff), 0, 0.5, 0).scale.set(1, 0.6, 1);
    P(g, tor(0.12, 0.025, 6, 12), M(0xe0482f), 0, -0.04, 0.26);
    eyes(g, 0, 0.1, 0.25, 0.065, 0.1);
    return g;
}
function toast() {                       // a slice of toast in a space helmet
    const g = new THREE.Group();
    P(g, box(0.72, 0.62, 0.24), M(0xe6a85c), 0, -0.07, 0);
    [-1, 1].forEach(s => P(g, sph(0.3, 14, 10), M(0xe6a85c), s * 0.14, 0.2, 0).scale.set(1, 0.6, 0.4));
    const visor = P(g, sph(0.28, 14, 10), M(0x9ad7ff, { transparent: true, opacity: 0.45, roughness: 0.1 }), 0, 0.02, 0.1);
    visor.scale.set(1.15, 1, 0.45); visor.castShadow = false;
    eyes(g, 0, 0.02, 0.14, 0.06, 0.1);
    return g;
}
function cactus() {                      // a cactus playing the saxophone, flower on top
    const g = new THREE.Group();
    const grn = M(0x3fa63a);
    P(g, cyl(0.17, 0.18, 0.95, 12), grn, 0, 0, 0);
    P(g, sph(0.17, 12, 8), grn, 0, 0.47, 0);
    const arm = P(g, cyl(0.08, 0.08, 0.3, 8), grn, 0.24, 0.1, 0); arm.rotation.z = Math.PI / 2;
    P(g, sph(0.08, 8, 6), grn, 0.38, 0.1, 0);
    const sax = P(g, cyl(0.03, 0.07, 0.4, 8), M(0xffd166, { metalness: 0.7, roughness: 0.3 }), 0.1, -0.1, 0.2); sax.rotation.z = 0.5;
    P(g, cone(0.09, 0.1, 8), M(0xffd166, { metalness: 0.7 }), 0.0, -0.28, 0.2).rotation.z = Math.PI;
    for (let i = 0; i < 5; i++) { const pt = P(g, cone(0.06, 0.08, 5), M(0xff7ab8), Math.cos(i * 1.26) * 0.07, 0.62, Math.sin(i * 1.26) * 0.07); pt.rotation.x = 0.4; }
    eyes(g, 0, 0.28, 0.16, 0.05, 0.07);
    return g;
}
function donut() {                       // a frosted donut with an elephant's trunk and ears
    const g = new THREE.Group();
    // Lying flat, but tipped a little toward the camera so it reads as a donut side-on.
    const d = P(g, tor(0.3, 0.14, 12, 24), M(0xe0b07a), 0, 0, 0); d.rotation.x = Math.PI / 2 - 0.45;
    const ice = P(g, tor(0.3, 0.12, 10, 24), M(0xff9ad5), 0, 0.04, 0.02); ice.rotation.x = Math.PI / 2 - 0.45; ice.scale.set(1, 1, 0.7);
    for (let i = 0; i < 10; i++) { const a = i * 0.63; const sp = P(g, box(0.07, 0.02, 0.02), M([0x5ef2ff, 0xffde59, 0x7cff6b][i % 3]), Math.cos(a) * 0.3, 0.13, Math.sin(a) * 0.3); sp.rotation.y = a; }
    const trunk = P(g, cyl(0.04, 0.07, 0.35, 8), M(0xa3a3b8), 0.35, -0.02, 0.22); trunk.rotation.z = -1.0;
    [-1, 1].forEach(s => P(g, sph(0.13, 10, 8), M(0xa3a3b8), 0.12 + s * 0.26, 0.1, 0.28).scale.set(1, 1, 0.25));
    eyes(g, 0.12, 0.13, 0.33, 0.05, 0.08);
    return g;
}
function cheese() {                      // a cheese wheel with a mouse's ears and whiskers; it rolls
    const g = new THREE.Group();
    P(g, cyl(0.36, 0.36, 0.3, 20), M(0xffd34d), 0, 0, 0).rotation.x = Math.PI / 2;
    [[0.15, 0.12], [-0.18, -0.08], [0.05, -0.2]].forEach(([x, y]) => P(g, cyl(0.05, 0.05, 0.02, 10), M(0xe0a92a), x, y, 0.16).rotation.x = Math.PI / 2);
    [-1, 1].forEach(s => P(g, sph(0.12, 10, 8), M(0xb0a8b8), s * 0.2, 0.36, 0).scale.set(1, 1, 0.3));
    [-1, 1].forEach(s => { const w = P(g, box(0.25, 0.01, 0.01), M(0x333333), s * 0.13, -0.05, 0.17); w.rotation.z = s * 0.2; });
    P(g, sph(0.04, 8, 6), M(0xff7ab8), 0, -0.02, 0.18);
    eyes(g, 0, 0.1, 0.16, 0.055, 0.09);
    return g;
}
function burger() {                      // a burger in boxing gloves
    const g = new THREE.Group();
    P(g, sph(0.4, 16, 10), M(0xd98b3a), 0, 0.1, 0).scale.set(1, 0.42, 0.9);
    P(g, cyl(0.4, 0.4, 0.1, 18), M(0x5a2d14), 0, -0.04, 0);
    P(g, cyl(0.42, 0.42, 0.03, 18), M(0x7cff6b), 0, 0.02, 0);
    P(g, box(0.62, 0.03, 0.62), M(0xffd34d), 0, 0.04, 0).rotation.y = 0.78;
    P(g, cyl(0.38, 0.38, 0.1, 18), M(0xd98b3a), 0, -0.16, 0);
    [-1, 1].forEach(s => P(g, sph(0.13, 10, 8), M(0xe0482f), s * 0.46, 0.0, 0.1));
    eyes(g, 0, 0.17, 0.3, 0.055, 0.1);
    return g;
}
function phone() {                       // a phone that is also a penguin
    const g = new THREE.Group();
    P(g, box(0.52, 0.88, 0.14), M(0x1c1c24, { roughness: 0.3 }));
    P(g, box(0.4, 0.62, 0.02), M(0xffffff), 0, -0.04, 0.075);
    P(g, cone(0.06, 0.12, 4), M(0xffa53d), 0, 0.2, 0.1).rotation.x = Math.PI / 2;
    [-1, 1].forEach(s => { const f = P(g, box(0.06, 0.3, 0.06), M(0x1c1c24), s * 0.3, -0.05, 0); f.rotation.z = s * 0.25; });
    [-1, 1].forEach(s => P(g, sph(0.08, 8, 6), M(0xffa53d), s * 0.12, -0.45, 0.04).scale.set(1.2, 0.4, 1));
    eyes(g, 0, 0.3, 0.09, 0.05, 0.08);
    return g;
}
function sock() {                        // a striped sock that is a dragon, spikes down its back
    const g = new THREE.Group();
    const cols = [0x5ef2ff, 0xff4fa3];
    for (let i = 0; i < 4; i++) P(g, box(0.26, 0.15, 0.28), M(cols[i % 2]), -0.12, 0.33 - i * 0.15, 0);
    P(g, box(0.5, 0.2, 0.28), M(0x5ef2ff), 0.0, -0.2, 0);
    P(g, sph(0.12, 10, 8), M(0xff4fa3), 0.25, -0.2, 0);
    for (let i = 0; i < 3; i++) P(g, cone(0.05, 0.12, 4), M(0xffde59), -0.26, 0.3 - i * 0.18, 0).rotation.z = Math.PI / 2;
    eyes(g, -0.12, 0.3, 0.15, 0.05, 0.07);
    P(g, cone(0.05, 0.14, 4), M(0xff8a4c), 0.36, -0.2, 0).rotation.z = -Math.PI / 2;   // a little flame
    return g;
}
function gelato() {                      // a gelato cone with a giraffe's spots and horns
    const g = new THREE.Group();
    P(g, cone(0.14, 0.5, 12), M(0xd9a35b), 0, -0.17, 0).rotation.x = Math.PI;
    P(g, sph(0.26, 14, 12), M(0xffe14d), 0, 0.2, 0);
    [[0.12, 0.3], [-0.14, 0.18], [0.05, 0.08], [-0.05, 0.36]].forEach(([x, y]) => P(g, sph(0.05, 8, 6), M(0x9b5b2a), x, y, 0.22).scale.set(1, 1, 0.4));
    [-1, 1].forEach(s => { P(g, cyl(0.02, 0.02, 0.14, 6), M(0x9b5b2a), s * 0.09, 0.5, 0); P(g, sph(0.035, 8, 6), M(0x9b5b2a), s * 0.09, 0.58, 0); });
    eyes(g, 0, 0.24, 0.22, 0.05, 0.08);
    return g;
}
function brick() {                       // a brick with a grand moustache and a tiny crown
    const g = new THREE.Group();
    P(g, box(0.92, 0.34, 0.44), M(0xb5452f));
    [-1, 1].forEach(s => { const m = P(g, sph(0.09, 10, 8), M(0x2b1a10), s * 0.09, -0.04, 0.23); m.scale.set(1.4, 0.45, 0.4); m.rotation.z = s * 0.3; });
    for (let i = 0; i < 3; i++) P(g, cone(0.04, 0.1, 4), M(0xffd166, { metalness: 0.7 }), -0.06 + i * 0.06, 0.22, 0);
    eyes(g, 0, 0.07, 0.23, 0.05, 0.1);
    return g;
}
function egg() {                         // an egg in a knight's helmet; wobbly
    const g = new THREE.Group();
    P(g, sph(0.28, 16, 12), M(0xfff6e0), 0, -0.06, 0).scale.set(1, 1.15, 1);
    P(g, sph(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(0xa3a8b8, { metalness: 0.7, roughness: 0.3 }), 0, 0.14, 0);
    P(g, box(0.3, 0.04, 0.05), M(0x555a66, { metalness: 0.6 }), 0, 0.14, 0.2);
    P(g, cone(0.04, 0.16, 6), M(0xe0482f), 0, 0.42, 0);
    eyes(g, 0, 0.02, 0.25, 0.05, 0.08);
    return g;
}
function telly() {                       // an old telly with a turkey's tail fanned out behind it
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) { const f = P(g, box(0.12, 0.5, 0.03), M([0xb5452f, 0xffa53d, 0x9b6b3d][i % 3]), 0, 0.15, -0.2); f.rotation.z = -0.8 + i * 0.4; f.position.x = Math.sin(-0.8 + i * 0.4) * -0.25; }
    P(g, box(0.8, 0.6, 0.5), M(0x4b3b5a), 0, 0, 0);
    P(g, box(0.56, 0.42, 0.02), M(0x5ef2ff, { emissive: 0x2a8a99, emissiveIntensity: 0.4 }), -0.06, 0.02, 0.26);
    P(g, cyl(0.04, 0.04, 0.02, 8), M(0xffde59), 0.3, 0.12, 0.26).rotation.x = Math.PI / 2;
    [-1, 1].forEach(s => P(g, cyl(0.025, 0.025, 0.16, 6), M(0xffa53d), s * 0.2, -0.36, 0));
    eyes(g, -0.06, 0.06, 0.28, 0.06, 0.12);
    return g;
}
function panettone() {                   // a panettone with a pirate's eyepatch and a paper hat
    const g = new THREE.Group();
    P(g, cyl(0.34, 0.32, 0.5, 18), M(0xc98b3c), 0, -0.04, 0);
    P(g, sph(0.34, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(0x7a4a1e), 0, 0.2, 0);
    P(g, cyl(0.35, 0.35, 0.2, 18), M(0xff4fa3), 0, -0.2, 0);
    P(g, cone(0.2, 0.22, 3), M(0xffffff), 0, 0.42, 0).rotation.y = Math.PI / 6;
    [[0.12, 0.0], [-0.14, -0.08], [0.18, -0.06]].forEach(([x, y]) => P(g, sph(0.03, 6, 5), M(0x3a1a3a), x, y, 0.32));
    eyes(g, 0, 0.08, 0.31, 0.055, 0.09);
    P(g, box(0.13, 0.11, 0.03), M(0x111111), -0.09, 0.08, 0.36);
    return g;
}
function boot() {                        // a hiking boot with googly eyes on the shaft
    const g = new THREE.Group();
    P(g, box(0.34, 0.64, 0.32), M(0x8a5a2b), -0.12, 0.1, 0);
    P(g, box(0.6, 0.24, 0.32), M(0x8a5a2b), 0.05, -0.22, 0);
    P(g, box(0.62, 0.05, 0.34), M(0x2b1a10), 0.05, -0.33, 0);
    for (let i = 0; i < 4; i++) P(g, box(0.18, 0.02, 0.02), M(0xffde59), -0.12, 0.25 - i * 0.12, 0.17);
    eyes(g, -0.12, 0.33, 0.17, 0.055, 0.08);
    return g;
}
function cloud() {                       // a grumpy storm cloud with a lightning bolt
    const g = new THREE.Group();
    [-0.28, 0, 0.28].forEach((x, i) => P(g, sph(i === 1 ? 0.24 : 0.2, 14, 10), M(0xdfe6f0, { roughness: 1 }), x, i === 1 ? 0.04 : 0, 0));
    const bolt = P(g, box(0.05, 0.22, 0.03), M(0xffde59, { emissive: 0xffde59, emissiveIntensity: 0.5 }), 0.1, -0.25, 0.1); bolt.rotation.z = 0.4;
    [-1, 1].forEach(s => { const b = P(g, box(0.1, 0.025, 0.02), M(0x333333), s * 0.08, 0.15, 0.24); b.rotation.z = s * -0.35; });
    eyes(g, 0, 0.08, 0.22, 0.05, 0.08);
    grin(g, 0, -0.04, 0.24, 0.1);
    return g;
}
function barrel() {                      // a party barrel in a cone hat
    const g = new THREE.Group();
    P(g, cyl(0.3, 0.3, 0.76, 16), M(0xa8723c), 0, 0, 0);
    P(g, sph(0.31, 16, 8), M(0xa8723c), 0, 0, 0).scale.set(1, 0.6, 1);
    [-0.25, 0.25].forEach(y => P(g, cyl(0.32, 0.32, 0.05, 16), M(0x555a66, { metalness: 0.6 }), 0, y, 0));
    P(g, cone(0.12, 0.26, 10), M(0x5ef2ff), 0.0, 0.5, 0).rotation.z = 0.2;
    P(g, sph(0.04, 6, 5), M(0xffde59), -0.04, 0.63, 0);
    eyes(g, 0, 0.08, 0.3, 0.06, 0.1);
    grin(g, 0, -0.08, 0.31);
    return g;
}
function taco() {                        // a taco that is a little dinosaur; it opens upward and catches
    const g = new THREE.Group();
    [-1, 1].forEach(s => { const h = P(g, box(0.5, 0.06, 0.3), M(0xffd166), s * 0.2, 0.05, 0); h.rotation.z = s * 0.6; });
    P(g, sph(0.12, 10, 8), M(0x7cff6b), -0.02, -0.04, 0).scale.set(2.2, 0.8, 1.2);
    P(g, sph(0.08, 8, 6), M(0xe0482f), 0.08, 0.02, 0.1);
    P(g, sph(0.13, 12, 10), M(0x6fdc6f), 0.45, 0.32, 0);
    for (let i = 0; i < 3; i++) P(g, cone(0.04, 0.1, 4), M(0x3fa63a), -0.38 + i * 0.12, 0.24 + i * -0.02, 0);
    eyes(g, 0.48, 0.38, 0.1, 0.04, 0.06);
    return g;
}
function chair() {                       // a dining chair in a sweatband, ready to go
    const g = new THREE.Group();
    const wood = M(0xc98b3c);
    P(g, box(0.6, 0.1, 0.5), wood, 0, 0, 0);
    P(g, box(0.1, 0.56, 0.5), wood, -0.27, 0.3, 0);
    [-1, 1].forEach(s => [-1, 1].forEach(z => P(g, box(0.07, 0.36, 0.07), wood, s * 0.25, -0.22, z * 0.2)));
    P(g, box(0.12, 0.08, 0.52), M(0xff4fa3), -0.27, 0.46, 0);
    eyes(g, -0.27, 0.32, 0.27, 0.05, 0.1);
    return g;
}

// ── The cast ─────────────────────────────────────────────────────────────────
export const CAST = [
    { key: 'sardine',   name: 'SARDINO PIANINO',      mass: 0.45, shapes: [{ box: [0.6, 0.2, 0.22] }], look: sardine },
    { key: 'baguette',  name: 'BAGUETTO SAMURAI',     mass: 0.4,  shapes: [{ box: [0.72, 0.18, 0.18] }], look: baguette },
    { key: 'teapot',    name: 'TEIERA TENORONE',      mass: 0.35, shapes: [{ box: [0.32, 0.26, 0.26] }], look: teapot },
    { key: 'wardrobe',  name: 'ARMADIO GUFONE',       mass: 0.6,  shapes: [{ box: [0.3, 0.5, 0.26] }], look: wardrobe },
    { key: 'banana',    name: 'BANANITO BANDITO',     mass: 0.3,
      shapes: [{ box: [0.3, 0.09, 0.12], off: [-0.25, 0.04, 0], roll: -0.42 }, { box: [0.3, 0.09, 0.12], off: [0.25, 0.04, 0], roll: 0.42 }], look: banana },
    { key: 'pizza',     name: 'PIZZAPOTAMO',          mass: 0.4,  shapes: [{ box: [0.56, 0.11, 0.4] }], look: pizza },
    { key: 'meatball',  name: 'POLPETTO RUMBLINI',    mass: 0.35, shapes: [{ sphere: 0.3 }], look: meatball },
    { key: 'toast',     name: 'TOASTRONAUTO',         mass: 0.3,  shapes: [{ box: [0.36, 0.38, 0.12] }], look: toast },
    { key: 'cactus',    name: 'CACTUSSO SAXOFONO',    mass: 0.35,
      shapes: [{ box: [0.17, 0.5, 0.17] }, { box: [0.15, 0.08, 0.08], off: [0.28, 0.1, 0] }], look: cactus },
    { key: 'donut',     name: 'CIAMBELLONE PROBOSCIDONE', mass: 0.35, shapes: [{ box: [0.44, 0.14, 0.44] }], look: donut },
    { key: 'cheese',    name: 'FORMAGGIO TOPOLONE',   mass: 0.4,  shapes: [{ sphere: 0.36 }], look: cheese },
    { key: 'burger',    name: 'BURGERONE BOXEUR',     mass: 0.45, shapes: [{ box: [0.4, 0.24, 0.36] }], look: burger },
    { key: 'phone',     name: 'TELEFONINO PINGUINO',  mass: 0.3,  shapes: [{ box: [0.26, 0.44, 0.08] }], look: phone },
    { key: 'sock',      name: 'CALZINO DRAGONINO',    mass: 0.3,
      shapes: [{ box: [0.13, 0.27, 0.14], off: [-0.12, 0.18, 0] }, { box: [0.25, 0.1, 0.14], off: [0.0, -0.2, 0] }], look: sock },
    { key: 'gelato',    name: 'GELATO GIRAFFONE',     mass: 0.3,
      shapes: [{ box: [0.09, 0.24, 0.09], off: [0, -0.2, 0] }, { sphere: 0.26, off: [0, 0.2, 0] }], look: gelato },
    { key: 'brick',     name: 'MATTONE MAGNIFICO',    mass: 0.7,  shapes: [{ box: [0.46, 0.17, 0.22] }], look: brick },
    { key: 'egg',       name: 'UOVO CAVALIERE',       mass: 0.3,
      shapes: [{ sphere: 0.28, off: [0, -0.06, 0] }, { sphere: 0.2, off: [0, 0.16, 0] }], look: egg },
    { key: 'telly',     name: 'TELEVISORE TACCHINO',  mass: 0.55, shapes: [{ box: [0.4, 0.3, 0.25] }, { box: [0.22, 0.08, 0.1], off: [0, -0.36, 0] }], look: telly },
    { key: 'panettone', name: 'PANETTONE PIRATONE',   mass: 0.45, shapes: [{ box: [0.34, 0.33, 0.32], off: [0, 0.05, 0] }], look: panettone },
    { key: 'boot',      name: 'STIVALONE STUPENDO',   mass: 0.45,
      shapes: [{ box: [0.17, 0.32, 0.16], off: [-0.12, 0.1, 0] }, { box: [0.3, 0.12, 0.16], off: [0.05, -0.22, 0] }], look: boot },
    { key: 'cloud',     name: 'NUVOLETTA TUONETTA',   mass: 0.2,
      shapes: [{ sphere: 0.2, off: [-0.28, 0, 0] }, { sphere: 0.24, off: [0, 0.04, 0] }, { sphere: 0.2, off: [0.28, 0, 0] }], look: cloud },
    { key: 'barrel',    name: 'BARILOTTO BOMBASTICO', mass: 0.5,  shapes: [{ box: [0.3, 0.38, 0.3] }], look: barrel },
    { key: 'taco',      name: 'TACOSAURO',            mass: 0.3,
      shapes: [{ box: [0.25, 0.03, 0.15], off: [-0.2, 0.05, 0], roll: -0.6 }, { box: [0.25, 0.03, 0.15], off: [0.2, 0.05, 0], roll: 0.6 }], look: taco },
    { key: 'chair',     name: 'SEDIOLINA SALTARINA',  mass: 0.4,
      shapes: [{ box: [0.3, 0.05, 0.25] }, { box: [0.05, 0.28, 0.25], off: [-0.27, 0.3, 0] },
               { box: [0.035, 0.18, 0.1], off: [-0.25, -0.22, 0] }, { box: [0.035, 0.18, 0.1], off: [0.25, -0.22, 0] }], look: chair },
];
