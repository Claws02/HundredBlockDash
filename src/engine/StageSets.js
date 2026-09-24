// ============================================================
// STAGE SETS — minigame scenery, built from the board's own pieces
// ============================================================
//
// A minigame set is where the round's story happens, so it has to look like
// the map the round is being played on. Every set here takes its sky, fog,
// light and dust from DISTRICT_BIOMES — the table the board's own districts are
// dressed from — and its buildings from Renderer's PROP_KIT, which are the
// same builders that stand on the board's plots. Perdition's street in High
// Noon is Perdition's street.
//
// A set builder takes a stage and returns HANDLES: the things in the scenery a
// game may animate (a bell, a crow, a tumbleweed), plus an `update(dt, t)` for
// the set's own ambient motion. Everything it builds goes into the stage's
// scene, so the stage's dispose() releases it.
//
// Sets are keyed by district. Only Perdition ('hub') exists yet; the next game
// that needs a set adds its key here, from the same table.
// ============================================================

import { DISTRICT_BIOMES } from '../config/GameConfig.js';
import { PROP_KIT } from './Renderer.js';
import { textPlane } from './Stage.js';

const _hex = c => (typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : c);
const _rand = seed => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const _mat = (color, rough = 0.85, metal = 0, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

/** A sky dome shaded from the horizon colour up to the zenith colour. */
function _skyDome(top, bottom, radius = 190) {
    const geo = new THREE.SphereGeometry(radius, 32, 16);
    const cTop = new THREE.Color(top), cBot = new THREE.Color(bottom), c = new THREE.Color();
    const pos = geo.attributes.position, cols = [];
    for (let i = 0; i < pos.count; i++) {
        const k = Math.max(0, Math.min(1, pos.getY(i) / radius * 1.6 + 0.05));
        c.copy(cBot).lerp(cTop, Math.pow(k, 0.7));
        cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

/** A drifting cloud of dust, lit by nothing, sized in world units. */
function _motes({ color, count, size, spread, rise }) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        p[i * 3] = (_rand(i + 1) - 0.5) * spread * 2;
        p[i * 3 + 1] = _rand(i + 50) * 5;
        p[i * 3 + 2] = (_rand(i + 99) - 0.5) * spread;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        color, size, transparent: true, opacity: 0.55, depthWrite: false }));
    pts.userData.rise = rise;
    pts.userData.spread = spread;
    return pts;
}

// ---- Perdition: the main street at a quarter to four ---------------------
//
// The courthouse clock in the lore is "stuck at ten to four"; the bell tower
// here carries it. The street runs along X — the duel axis — with the
// storefronts behind it facing the camera.
function _clockFace() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#efe4c8'; g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.fill();
    g.lineWidth = 10; g.strokeStyle = '#3b2716'; g.stroke();
    g.fillStyle = '#3b2716';
    for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        g.fillRect(128 + Math.sin(a) * 96 - 5, 128 - Math.cos(a) * 96 - 5, 10, 10);
    }
    // Ten to four, and it has been for years.
    const hand = (a, len, w) => {
        g.save(); g.translate(128, 128); g.rotate(a);
        g.fillRect(-w / 2, -len, w, len); g.restore();
    };
    hand((3 + 50 / 60) / 12 * Math.PI * 2, 58, 12);
    hand(50 / 60 * Math.PI * 2, 88, 7);
    g.beginPath(); g.arc(128, 128, 10, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(cv);
    return new THREE.Mesh(new THREE.CircleGeometry(1.05, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
}

function _bellTower() {
    const g = new THREE.Group();
    const white = _mat(0xe9dcc0, 0.9);
    const trim = _mat(0x6b4a2c, 0.9);
    const base = new THREE.Mesh(new THREE.BoxGeometry(5.2, 7.5, 4.6), white);
    base.position.y = 3.75; g.add(base);
    // Clapboard lines, so the white box reads as timber.
    for (let i = 1; i < 10; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.06, 0.06), _mat(0xcbbd9f, 0.9));
        b.position.set(0, i * 0.75, 2.32); g.add(b);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.8, 0.2), trim);
    door.position.set(0, 1.4, 2.35); g.add(door);
    const clock = _clockFace();
    clock.position.set(0, 5.6, 2.33); g.add(clock);

    // The belfry: four posts, open on every side so the bell is visible.
    const belfryY = 7.5;
    [[-1.9, -1.6], [1.9, -1.6], [-1.9, 1.6], [1.9, 1.6]].forEach(([x, z]) => {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.34, 3.2, 0.34), white);
        p.position.set(x, belfryY + 1.6, z); g.add(p);
    });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.3, 4.4), trim);
    deck.position.y = belfryY + 0.15; g.add(deck);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.36, 4.0), trim);
    lintel.position.y = belfryY + 3.2; g.add(lintel);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 3.0, 4), _mat(0x5a3b24, 0.8));
    roof.position.y = belfryY + 4.9; roof.rotation.y = Math.PI / 4; g.add(roof);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), _mat(0x333333, 0.5, 0.6));
    spire.position.y = belfryY + 7.0; g.add(spire);

    // The bell hangs from a pivot at the lintel so it can swing.
    const pivot = new THREE.Group();
    pivot.position.y = belfryY + 3.0;
    const bronze = _mat(0xb8862b, 0.35, 0.75);
    const prof = [];
    for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        // Waist narrow, lip flared: the silhouette everybody knows as a bell.
        prof.push(new THREE.Vector2(0.28 + Math.pow(t, 2.2) * 0.95 + (t > 0.9 ? (t - 0.9) * 1.4 : 0), -t * 1.7));
    }
    const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), bronze);
    bell.material.side = THREE.DoubleSide;
    bell.position.y = -0.15;
    pivot.add(bell);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), bronze);
    crown.position.y = -0.12; pivot.add(crown);
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), _mat(0x3a3a3a, 0.4, 0.8));
    clapper.position.y = -1.55; pivot.add(clapper);
    g.add(pivot);
    return { group: g, pivot };
}

function _mesa(w, h, d, color) {
    const g = new THREE.Group();
    const m = _mat(color, 0.95);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.55, h, 7), m);
    body.scale.z = d / w;
    body.position.y = h / 2; g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.44, w * 0.42, h * 0.08, 7), _mat(color + 0x0a0806, 0.95));
    cap.scale.z = d / w;
    cap.position.y = h; g.add(cap);
    return g;
}

function _cactus(seed) {
    const g = new THREE.Group();
    const m = _mat(0x4d7a3a, 0.8);
    const h = 2.4 + _rand(seed) * 1.6;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, h, 10), m);
    trunk.position.y = h / 2; g.add(trunk);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), m);
    top.position.y = h; g.add(top);
    [-1, 1].forEach((s, i) => {
        if (_rand(seed + i * 7) < 0.25) return;
        const y = h * (0.35 + _rand(seed + i) * 0.25);
        const out = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 8), m);
        out.rotation.z = Math.PI / 2; out.position.set(s * 0.6, y, 0); g.add(out);
        const up = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.1, 8), m);
        up.position.set(s * 0.95, y + 0.5, 0); g.add(up);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), m);
        cap.position.set(s * 0.95, y + 1.05, 0); g.add(cap);
    });
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
}

function _tumbleweed() {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0x9c7a4a, roughness: 1, wireframe: true });
    const a = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), m);
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 1), m);
    b.rotation.set(0.6, 0.4, 0.2);
    g.add(a); g.add(b);
    g.visible = false;
    return g;
}

function _crow() {
    const g = new THREE.Group();
    const black = _mat(0x16161a, 0.6);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), black);
    body.scale.set(0.8, 0.75, 1.3); g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), black);
    head.position.set(0, 0.2, 0.3); g.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 6), _mat(0x3a3a3a, 0.4));
    beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.18, 0.5); g.add(beak);
    const wings = [-1, 1].map(s => {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.16, 0.08, 0);
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.34), black);
        w.position.x = s * 0.27;
        pivot.add(w);
        g.add(pivot);
        return pivot;
    });
    g.userData.wings = wings;
    return g;
}

const SIGNS = ['SALOON', 'BANK', 'JAIL', 'HOTEL', 'GENERAL STORE', 'ASSAY OFFICE', 'BARBER', 'TELEGRAPH'];

export function buildPerditionStreet(stage) {
    const B = DISTRICT_BIOMES.hub;
    const scene = stage.scene;
    const fog = _hex(B.fog);
    scene.background = new THREE.Color(_hex(B.bgBot));
    scene.fog = new THREE.Fog(fog, 34, 150);
    scene.add(_skyDome(_hex(B.bgTop), _hex(B.bgBot)));

    // Low sun, off to one side, so the street is raked with long light.
    stage.light({
        sun: 0xffd9a0, sunI: 1.35, sky: 0xffe2b8, ground: 0x7a4f2a, hemiI: 0.55,
        rim: 0xffb070, rimI: 0.35, dir: [-14, 13, 12], span: 16,
    });
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(7, 32),
        new THREE.MeshBasicMaterial({ color: 0xffe6b0, fog: false }));
    sunDisc.position.set(-60, 16, -150);
    sunDisc.lookAt(0, 16, 0);
    scene.add(sunDisc);

    // Ground: the wide dirt plain, and a darker rutted street on it.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), _mat(0xb88758, 1));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);
    const street = new THREE.Mesh(new THREE.PlaneGeometry(120, 9), _mat(0x9e7147, 1));
    street.rotation.x = -Math.PI / 2; street.position.set(0, 0.01, -0.5); street.receiveShadow = true;
    scene.add(street);
    [-1.3, 1.3].forEach(z => {
        const rut = new THREE.Mesh(new THREE.PlaneGeometry(120, 0.28), _mat(0x7d5634, 1));
        rut.rotation.x = -Math.PI / 2; rut.position.set(0, 0.02, z - 0.5); rut.receiveShadow = true;
        scene.add(rut);
    });

    // Storefronts behind the street, facing the camera. The tower stands in
    // the gap in the middle, between where the two duellists stand back to back.
    const fronts = [];
    let sign = 0;
    [-37, -28, -19, -10, 10, 19, 28, 37].forEach((x, i) => {
        const f = PROP_KIT.falseFront(new THREE.Vector3(x, 0, -14), 700 + i * 3);
        scene.add(f);
        const box = new THREE.Box3().setFromObject(f);
        const s = textPlane(SIGNS[sign++ % SIGNS.length], { w: 4.6, h: 1.0 });
        s.position.set(x, box.max.y - 1.4, -14 + 3.33);
        scene.add(s);
        fronts.push(f);
    });

    const tower = _bellTower();
    tower.group.position.set(0, 0, -17);
    scene.add(tower.group);

    // Lanterns along the boardwalk, and township clutter in front of it.
    [-23.5, -14.5, 14.5, 23.5].forEach(x => scene.add(PROP_KIT.lanternPost(new THREE.Vector3(x, 0, -8.4))));
    [[-15, -7.2, 0.1], [13, -7.4, 0.5], [-27, -7.1, 0.3], [30, -7.3, 0.7], [-11.5, 5.5, 0.62], [12, 5.8, 0.1]]
        .forEach(([x, z, r], i) => {
            const p = PROP_KIT.township(r, 900 + i);
            p.position.set(x, 0, z);
            p.rotation.y = (_rand(i + 3) - 0.5) * 0.6;
            scene.add(p);
        });

    // The desert beyond the town.
    [[-70, -95, 30, 16, 18, 0xb4643a], [-20, -120, 44, 22, 20, 0xa85a34], [45, -100, 34, 13, 16, 0xbb6c40],
     [95, -130, 50, 25, 22, 0xa4563a], [-120, -140, 60, 20, 22, 0xae5e38]]
        .forEach(([x, z, w, h, d, c]) => { const m = _mesa(w, h, d, c); m.position.set(x, 0, z); scene.add(m); });
    [[-22, -4, 1], [24, -3, 2], [-34, 3, 3], [36, 2, 4]].forEach(([x, z, s]) => {
        const c = _cactus(s * 13); c.position.set(x, 0, z); scene.add(c);
    });

    const weed = _tumbleweed();
    scene.add(weed);

    // The crow sits on the saloon's parapet until something startles it.
    const crow = _crow();
    const perchFront = fronts[3];
    const pb = new THREE.Box3().setFromObject(perchFront);
    const perch = new THREE.Vector3(-8.4, pb.max.y + 0.22, -10.9);
    crow.position.copy(perch);
    crow.rotation.y = 0.5;
    scene.add(crow);

    const dust = B.motes ? _motes(B.motes) : null;
    if (dust) scene.add(dust);

    // Buildings are big and far from the camera; letting them cast into the
    // tight shadow frustum only costs fill rate. The figures cast, the ground
    // and street receive.
    scene.traverse(o => { if (o.isMesh && o !== ground && o !== street) o.receiveShadow = false; });

    const H = {
        bellPivot: tower.pivot,
        crow, crowPerch: perch.clone(),
        tumbleweed: weed,
        _bellSwing: 0,
        _crowT: -1,
        _weedT: -1, _weedDir: 1,
        ringBell() { this._bellSwing = 1; },
        startleCrow() { this._crowT = 0; },
        rollTumbleweed(dir = 1) { this._weedT = 0; this._weedDir = dir; weed.visible = true; },
        update(dt, t) {
            // Bell: a damped swing.
            if (this._bellSwing > 0.001) {
                this._bellSwing *= Math.exp(-1.1 * dt);
                this.bellPivot.rotation.z = Math.sin(t * 9) * 0.55 * this._bellSwing;
            } else this.bellPivot.rotation.z = 0;
            // Crow: up, out and away, then back on its perch a few seconds later.
            const wings = crow.userData.wings;
            if (this._crowT >= 0) {
                this._crowT += dt;
                const k = this._crowT;
                crow.position.set(this.crowPerch.x + k * 7, this.crowPerch.y + k * 5.5 + Math.sin(k * 6) * 0.2, this.crowPerch.z + k * 2);
                wings[0].rotation.z = Math.sin(k * 30) * 0.9;
                wings[1].rotation.z = -Math.sin(k * 30) * 0.9;
                if (k > 5) { this._crowT = -1; crow.position.copy(this.crowPerch); }
            } else {
                wings[0].rotation.z = 0.15; wings[1].rotation.z = -0.15;
                crow.rotation.y = 0.5 + Math.sin(t * 0.7) * 0.4;
            }
            // Tumbleweed: across the foreground, bouncing.
            if (this._weedT >= 0) {
                this._weedT += dt;
                const k = this._weedT, x = -this._weedDir * 16 + this._weedDir * k * 7.5;
                weed.position.set(x, 0.75 + Math.abs(Math.sin(k * 5)) * 0.6, 3.2);
                weed.rotation.z -= this._weedDir * dt * 6;
                if (k > 4.3) { this._weedT = -1; weed.visible = false; }
            }
            if (dust) {
                const p = dust.geometry.attributes.position, a = p.array;
                for (let i = 0; i < a.length; i += 3) {
                    a[i] += dt * 0.9;
                    a[i + 1] += dt * dust.userData.rise * 0.4;
                    if (a[i] > dust.userData.spread) a[i] -= dust.userData.spread * 2;
                    if (a[i + 1] > 5) a[i + 1] = 0;
                }
                p.needsUpdate = true;
            }
        },
    };
    return H;
}

// ---- Boot Hill Badlands: two forts across a dry wash ------------------
//
// High noon on the hardpan — "blown out, almost colourless, the harshest
// light on the board". The graves the district is named for stand on a low
// hill behind the wash, between the two forts, so every shot in a siege is
// fired over Boot Hill. The forts themselves are the game's (they are physics
// bodies); the set is the ground they stand on and everything around it.
export function buildBootHill(stage) {
    const B = DISTRICT_BIOMES.bad;
    const scene = stage.scene;
    scene.background = new THREE.Color(_hex(B.bgBot));
    scene.fog = new THREE.Fog(_hex(B.fog), 40, 170);
    scene.add(_skyDome(_hex(B.bgTop), _hex(B.bgBot)));

    // Noon: the sun nearly overhead, short hard shadows.
    stage.light({
        sun: 0xfff6e0, sunI: 1.2, sky: 0xcfe3f5, ground: 0x8a6a42, hemiI: 0.55,
        rim: 0xffe2b0, rimI: 0.3, dir: [5, 22, 9], span: 17,
    });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), _mat(0xb59c70, 1));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);
    // The wash: a pale, dried streambed running away from the camera between
    // the forts, with a few cracks across it.
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(7, 140), _mat(0xcbb78e, 1));
    wash.rotation.x = -Math.PI / 2; wash.position.set(0, 0.01, -40); wash.receiveShadow = true;
    scene.add(wash);
    for (let i = 0; i < 26; i++) {
        const c = new THREE.Mesh(new THREE.PlaneGeometry(0.06 + _rand(i) * 0.05, 1.2 + _rand(i + 9) * 2.6), _mat(0x9c8660, 1));
        c.rotation.x = -Math.PI / 2;
        c.rotation.z = _rand(i + 3) * Math.PI;
        c.position.set((_rand(i + 5) - 0.5) * 34, 0.02, (_rand(i + 7) - 0.5) * 14 - 2);
        c.receiveShadow = true;
        scene.add(c);
    }

    // Boot Hill: a low mound behind the wash with its leaning markers.
    const hill = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 12), _mat(0xbfa77c, 1));
    hill.scale.set(1.3, 0.28, 0.7); hill.position.set(0, -0.6, -24);
    scene.add(hill);
    [[-6, -21], [-2.5, -19.8], [1.5, -20.4], [5.5, -21.6], [-9, -23.5], [9.5, -23], [3.5, -24.5], [-4, -24.8]]
        .forEach(([x, z], i) => {
            const g = PROP_KIT.badlands(0.9, 40 + i);
            g.position.set(x, 2.3 - Math.abs(x) * 0.12, z);
            g.rotation.y = (_rand(i + 21) - 0.5) * 0.8;
            scene.add(g);
        });

    // Buttes on the horizon, saguaros and a skull nearer in.
    [[-58, -80, 1], [-18, -95, 2], [30, -85, 3], [72, -100, 4], [-95, -110, 5]].forEach(([x, z, sd]) => {
        const r = PROP_KIT.badlandsRock(new THREE.Vector3(x, 0, z), 300 + sd);
        r.scale.setScalar(1.6);
        scene.add(r);
    });
    [[-21, -6, 0.1], [22, -8, 0.15], [-27, 2, 0.2], [17, -14, 0.05], [-15, -12, 0.12]].forEach(([x, z, r], i) => {
        const c = PROP_KIT.badlands(r, 60 + i); c.position.set(x, 0, z); scene.add(c);
    });
    [[-5.5, 4.5, 0.35], [6.5, -3, 0.5], [-16, 5, 0.55]].forEach(([x, z, r], i) => {
        const c = PROP_KIT.badlands(r, 80 + i); c.position.set(x, 0, z); scene.add(c);
    });

    const dust = B.motes ? _motes(B.motes) : null;
    if (dust) scene.add(dust);
    scene.traverse(o => { if (o.isMesh && o !== ground && o !== wash) o.receiveShadow = false; });

    return {
        update(dt) {
            if (!dust) return;
            const p = dust.geometry.attributes.position, a = p.array;
            for (let i = 0; i < a.length; i += 3) {
                a[i] += dt * 1.6;
                a[i + 1] += dt * dust.userData.rise * 0.3;
                if (a[i] > dust.userData.spread) a[i] -= dust.userData.spread * 2;
                if (a[i + 1] > 5) a[i + 1] = 0;
            }
            p.needsUpdate = true;
        },
    };
}

// ---- Financial District: the bank floor at ten past two in the morning ---
//
// An interior, seen from above, so the set takes the game's LAYOUT (walls,
// pillars, counter, vault, loot spots — the same numbers the game collides
// against) and dresses it: dark marble, white columns with gold capitals, a
// teller counter with a brass grille, the vault door standing open, and green
// banker's lamps. Night blue from the tall windows is the only fill; the
// guard's torch is the only real light, and that belongs to the game.
export function buildBankFloor(stage, L) {
    const B = DISTRICT_BIOMES.fin;
    const scene = stage.scene;
    scene.background = new THREE.Color(0x05070d);
    scene.fog = null;
    // Moonlight through the windows: cool, dim, no shadows. The torch has them.
    scene.add(new THREE.HemisphereLight(0x5a7ac0, 0x1a2030, 0.95));
    const moon = new THREE.DirectionalLight(0x9fbcff, 0.6);
    moon.position.set(8, 20, 4);
    scene.add(moon);

    const W = L.w / 2, D = L.d / 2;
    // Marble floor, a checker of two near-blacks with a gold inlay border.
    const tiles = new THREE.Group();
    const dark = _mat(0x1c212c, 0.35, 0.1), darker = _mat(0x141821, 0.35, 0.1);
    const T = 2;
    for (let x = -W; x < W - 0.01; x += T) for (let z = -D; z < D - 0.01; z += T) {
        const t = new THREE.Mesh(new THREE.PlaneGeometry(T, T), ((x + z) / T) % 2 === 0 ? dark : darker);
        t.rotation.x = -Math.PI / 2; t.position.set(x + T / 2, 0, z + T / 2); t.receiveShadow = true;
        tiles.add(t);
    }
    scene.add(tiles);
    const gold = _mat(0xd4a93a, 0.3, 0.8, { emissive: 0x4a3200, emissiveIntensity: 0.3 });
    [[0, -D + 0.6, L.w - 1.2, 0.08], [0, D - 0.6, L.w - 1.2, 0.08], [-W + 0.6, 0, 0.08, L.d - 1.2], [W - 0.6, 0, 0.08, L.d - 1.2]]
        .forEach(([x, z, w, d]) => {
            const b = new THREE.Mesh(new THREE.PlaneGeometry(w, d), gold);
            b.rotation.x = -Math.PI / 2; b.position.set(x, 0.01, z); scene.add(b);
        });

    // Walls: low, so the room reads from above, with window slots glowing blue.
    const wall = _mat(0x2a3040, 0.7);
    const glow = new THREE.MeshBasicMaterial({ color: 0x3b5b99 });
    [[0, -D - 0.3, L.w + 1.2, 0.6], [0, D + 0.3, L.w + 1.2, 0.6], [-W - 0.3, 0, 0.6, L.d], [W + 0.3, 0, 0.6, L.d]]
        .forEach(([x, z, w, d]) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, d), wall);
            m.position.set(x, 1.1, z); scene.add(m);
        });
    for (let z = -D + 3; z < D - 2; z += 4) [-W - 0.3, W + 0.3].forEach(x => {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.1, 1.6), glow);
        win.position.set(x, 2.22, z); scene.add(win);
        // A pale shaft of window light across the floor.
        const shaft = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4),
            new THREE.MeshBasicMaterial({ color: 0x6f8fd6, transparent: true, opacity: 0.08, depthWrite: false }));
        shaft.rotation.x = -Math.PI / 2; shaft.position.set(x - Math.sign(x) * 1.5, 0.02, z); scene.add(shaft);
    });

    // Doors: the thieves' way in and out, the two corners at each end, marked
    // on the floor with an arrow out.
    [-1, 1].forEach(end => [-1, 1].forEach(side => {
        const mat = new THREE.MeshBasicMaterial({ color: 0x3a6fd0, transparent: true, opacity: 0.45 });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(L.doorHalf * 2, L.exit), mat);
        m.rotation.x = -Math.PI / 2; m.position.set(side * L.doorX, 0.015, end * (D - L.exit / 2)); scene.add(m);
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 3),
            new THREE.MeshBasicMaterial({ color: 0x9cc0ff, transparent: true, opacity: 0.7 }));
        arrow.rotation.x = end * Math.PI / 2; arrow.position.set(side * L.doorX, 0.03, end * (D - L.exit / 2)); scene.add(arrow);
    }));

    // Columns.
    const marble = _mat(0xe7e3da, 0.4);
    L.pillars.forEach(p => {
        const g = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.85, p.r * 0.9, 3.2, 18), marble);
        shaft.position.y = 1.6; g.add(shaft);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 1.05, 0.3, 18), marble);
        base.position.y = 0.15; g.add(base);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.1, p.r * 0.85, 0.35, 18), gold);
        cap.position.y = 3.3; g.add(cap);
        g.position.set(p.x, 0, p.z);
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        scene.add(g);
    });

    // The teller counter, with a brass grille and a green lamp at each end.
    L.boxes.forEach(b => {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, 1.1, b.d), _mat(0x4a2c18, 0.6));
        body.position.y = 0.55; g.add(body);
        const top = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.1, 0.08, b.d + 0.1), _mat(0x1d1a17, 0.3, 0.2));
        top.position.y = 1.14; g.add(top);
        const brass = _mat(0xc9a24a, 0.3, 0.85);
        for (let i = 0; i <= Math.floor(b.w / 0.45); i++) {
            const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), brass);
            bar.position.set(-b.w / 2 + i * 0.45, 1.6, 0); g.add(bar);
        }
        const rail = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.06, 0.06), brass);
        rail.position.y = 2.05; g.add(rail);
        [-1, 1].forEach(s => {
            const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.28, 0.2, 12, 1, true),
                new THREE.MeshStandardMaterial({ color: 0x1f7a3a, emissive: 0x1f7a3a, emissiveIntensity: 0.8, side: THREE.DoubleSide }));
            shade.position.set(s * (b.w / 2 - 0.4), 1.5, 0); g.add(shade);
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
            bulb.position.set(s * (b.w / 2 - 0.4), 1.42, 0); g.add(bulb);
            const pool = new THREE.Mesh(new THREE.CircleGeometry(1.3, 20),
                new THREE.MeshBasicMaterial({ color: 0x4fbf6a, transparent: true, opacity: 0.1, depthWrite: false }));
            pool.rotation.x = -Math.PI / 2; pool.position.set(s * (b.w / 2 - 0.4), 1.19, 0); g.add(pool);
        });
        g.position.set(b.x, 0, b.z);
        g.traverse(o => { if (o.isMesh && o.geometry.type !== 'CircleGeometry') o.castShadow = true; });
        scene.add(g);
    });

    // The vaults, one at each end: a steel frame and a round door swung open.
    const steel = _mat(0x7c8594, 0.35, 0.85);
    const vaults = L.vaults.map(v => {
        const g = new THREE.Group();
        const back = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.4, 0.4), _mat(0x3a4150, 0.5, 0.5));
        back.position.set(0, 1.2, -v.face * 1.4); g.add(back);
        [-1, 1].forEach(s => {
            const side = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.4, 2.8), _mat(0x3a4150, 0.5, 0.5));
            side.position.set(s * 2.0, 1.2, 0); g.add(side);
        });
        const door = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.35, 28), steel);
        door.rotation.z = Math.PI / 2;
        door.rotation.y = 0.9;
        door.position.set(2.6, 1.3, v.face * 1.5); g.add(door);
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 16), _mat(0xc9a24a, 0.3, 0.85));
        wheel.position.set(2.75, 1.3, v.face * 1.5 + 0.25); wheel.rotation.y = 0.9 + Math.PI / 2; g.add(wheel);
        g.position.set(v.x, 0, v.z);
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        scene.add(g);
        return g;
    });

    // Loot, placed at the game's spots, handed back so the game can hide what
    // gets taken and restore it between rounds.
    const barMat = _mat(0xf2c14e, 0.25, 0.9, { emissive: 0x6a4a00, emissiveIntensity: 0.55 });
    const sackMat = _mat(0x8a6a3e, 0.9);
    const loot = L.loot.map(l => {
        const g = new THREE.Group();
        if (l.kind === 'bar') {
            for (let i = 0; i < 3; i++) {
                const bar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.3), barMat);
                bar.position.set((i - 1) * 0.34, 0.11 + (i === 1 ? 0.22 : 0), 0);
                g.add(bar);
            }
        } else if (l.kind === 'box') {
            // A safe-deposit drawer pulled out onto a pedestal.
            const ped = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.7), _mat(0x3a4150, 0.5, 0.5));
            ped.position.y = 0.3; g.add(ped);
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.5), _mat(0x9aa3b2, 0.3, 0.85));
            box.position.y = 0.74; g.add(box);
            const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI), barMat);
            handle.position.set(0, 0.74, 0.26); g.add(handle);
            const glint = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), barMat);
            glint.position.y = 0.9; g.add(glint);
        } else {
            const bag = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), sackMat);
            bag.scale.set(1, 1.15, 1); bag.position.y = 0.36; g.add(bag);
            const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.2, 8), sackMat);
            tie.position.y = 0.78; g.add(tie);
            const sign = textPlane('$', { w: 0.38, h: 0.38, bg: '#8a6a3e', fg: '#f3dca8', border: '#8a6a3e' });
            sign.position.set(0, 0.4, 0.33); g.add(sign);
        }
        // A warm pool on the floor under every prize, so loot reads from
        // straight above in a dark room.
        const pool = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20),
            new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.28, depthWrite: false }));
        pool.rotation.x = -Math.PI / 2; pool.position.y = 0.02; g.add(pool);
        g.position.set(l.x, 0, l.z);
        g.traverse(o => { if (o.isMesh && o !== pool) o.castShadow = true; });
        scene.add(g);
        return g;
    });

    return {
        loot, vaults, place: B.name,
        update(dt, t) { loot.forEach((g, i) => { g.children[g.children.length - 1].material.opacity = 0.22 + Math.sin(t * 3 + i) * 0.08; }); },
    };
}

/** Sets by district key. A game asks for the one its story is set in. */
export const STAGE_SETS = {
    hub: buildPerditionStreet,
    bad: buildBootHill,
    fin: buildBankFloor,
};
