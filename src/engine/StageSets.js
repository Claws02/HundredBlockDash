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

    // Escape zones: the whole strip across each end. A thief banks the moment
    // they are back in their own. It used to be two corner doors, and the
    // obvious way home — straight back to the middle of your own end — ran into
    // the other vault, so a player could carry gold round the room and never
    // bank it. Each strip is a glowing band with chevrons pointing out and
    // ESCAPE painted on the floor the right way up for the player at that end.
    const escapes = {};
    [-1, 1].forEach(end => {
        const g = new THREE.Group();
        const band = new THREE.Mesh(new THREE.PlaneGeometry(L.w - 0.8, L.exit),
            new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.3, depthWrite: false }));
        band.rotation.x = -Math.PI / 2; band.position.y = 0.015; g.add(band);
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(L.w - 0.8, 0.08),
            new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.9 }));
        edge.rotation.x = -Math.PI / 2; edge.position.set(0, 0.02, -end * L.exit / 2); g.add(edge);
        const chevrons = [];
        [-4, -2, 2, 4].forEach(x => {
            const c = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 3),
                new THREE.MeshBasicMaterial({ color: 0x86efac, transparent: true, opacity: 0.85 }));
            c.rotation.x = end * Math.PI / 2; c.position.set(x, 0.04, 0); g.add(c); chevrons.push(c);
        });
        const word = textPlane('ESCAPE', { w: 2.4, h: 0.8, bg: '#14532d', fg: '#bbf7d0', border: '#22c55e' });
        word.material.transparent = true;
        word.rotation.x = -Math.PI / 2;
        if (end < 0) word.rotation.z = Math.PI;      // the far player reads it from their side
        word.position.y = 0.03; g.add(word);
        g.position.set(0, 0, end * (D - L.exit / 2));
        g.userData = { band, chevrons, word, end };
        scene.add(g);
        escapes[end] = g;
    });

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
    // gets taken and restore it between rounds. From straight overhead in a
    // dark room the first pass was a few gold pixels, so every prize is now
    // oversized, floats and turns over a bright pulsing ring, and carries its
    // value painted beside it for the thief to read.
    const barMat = _mat(0xffd35c, 0.2, 0.85, { emissive: 0xb07a00, emissiveIntensity: 0.9 });
    const sackMat = _mat(0xa07a45, 0.8, 0, { emissive: 0x3a2a10, emissiveIntensity: 0.5 });
    const LOOT_SCALE = 1.6;
    const loot = L.loot.map(l => {
        const g = new THREE.Group();
        const float = new THREE.Group();
        if (l.kind === 'bar') {
            for (let i = 0; i < 3; i++) {
                const bar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.3), barMat);
                bar.position.set((i - 1) * 0.34, 0.11 + (i === 1 ? 0.22 : 0), 0);
                float.add(bar);
            }
        } else if (l.kind === 'box') {
            // A safe-deposit drawer pulled out, gold showing.
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.5), _mat(0xb8c2d2, 0.25, 0.9));
            box.position.y = 0.14; float.add(box);
            const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI), barMat);
            handle.position.set(0, 0.14, 0.26); float.add(handle);
            const glint = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.34), barMat);
            glint.position.y = 0.3; float.add(glint);
        } else {
            const bag = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), sackMat);
            bag.scale.set(1, 1.15, 1); bag.position.y = 0.36; float.add(bag);
            const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.2, 8), sackMat);
            tie.position.y = 0.78; float.add(tie);
            const sign = textPlane('$', { w: 0.38, h: 0.38, bg: '#8a6a3e', fg: '#fff3c4', border: '#8a6a3e' });
            sign.position.set(0, 0.4, 0.33); float.add(sign);
        }
        float.scale.setScalar(LOOT_SCALE);
        float.position.y = 0.35;
        float.traverse(o => { if (o.isMesh) o.castShadow = true; });
        g.add(float);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.25, 28),
            new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.025; g.add(ring);
        const pool = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24),
            new THREE.MeshBasicMaterial({ color: 0xffd35c, transparent: true, opacity: 0.22, depthWrite: false }));
        pool.rotation.x = -Math.PI / 2; pool.position.y = 0.02; g.add(pool);
        const tag = textPlane(`+${l.v}`, { w: 1.2, h: 0.8, bg: '#3b2a05', fg: '#ffd35c', border: '#ffd35c' });
        tag.rotation.x = -Math.PI / 2; tag.position.set(l.x > 0.5 ? -1.55 : 1.55, 0.05, 0); g.add(tag);
        g.position.set(l.x, 0, l.z);
        g.userData = { float, ring, pool, tag, phase: Math.random() * 6 };
        scene.add(g);
        return g;
    });

    return {
        loot, vaults, escapes, place: B.name,
        /** Turn the value labels to face the thief (`end` = +1 for P1's end, -1 for P2's). */
        orientFor(end) {
            loot.forEach(g => {
                g.userData.tag.rotation.z = end > 0 ? 0 : Math.PI;
                // Beside the prize on the side facing the middle of the room,
                // so a prize by a wall never paints its value into the wall.
                g.userData.tag.position.x = g.position.x > 0.5 ? -1.55 : 1.55;
            });
        },
        /** Light the thief's escape strip: dim on the way in, blazing with loot. */
        showEscape(end, carrying) {
            Object.values(escapes).forEach(e => {
                const mine = e.userData.end === end;
                e.visible = mine;
                e.userData.hot = mine && carrying;
            });
        },
        update(dt, t) {
            loot.forEach(g => {
                const u = g.userData, k = t * 3 + u.phase;
                u.float.position.y = 0.35 + Math.sin(k) * 0.12;
                u.float.rotation.y += dt * 1.2;
                u.ring.scale.setScalar(1 + Math.sin(k) * 0.12);
                u.ring.material.opacity = 0.45 + Math.sin(k) * 0.15;
            });
            Object.values(escapes).forEach(e => {
                const u = e.userData, hot = !!u.hot;
                u.band.material.opacity = hot ? 0.42 + Math.sin(t * 6) * 0.14 : 0.14;
                u.word.material.opacity = hot ? 1 : 0.45;
                u.chevrons.forEach((c, i) => {
                    c.material.opacity = hot ? 0.5 + 0.5 * Math.max(0, Math.sin(t * 7 - i)) : 0.25;
                });
            });
        },
    };
}

// ---- Ironwood Railyard: on the roof of the 4:15 -------------------------
//
// The train stands still and the Territory goes past it. Everything outside
// the train is a SCROLLER: it moves +x at its own speed and wraps round, so
// the near things (sleepers, telegraph poles, the yard's clutter) stream by
// and the far ones (buttes, the water tower) crawl — parallax is what sells
// the speed. The train points -x: the locomotive is on the left.
//
// A bridge is a low timber trestle across the track, spawned ahead of the
// train and carried past with the near scenery. The set moves it; the game
// asks where it is.
export function buildRailRun(stage, { speed = 16, roofY = 3.4, roofHalf = 5.6 } = {}) {
    const B = DISTRICT_BIOMES.rail;
    const scene = stage.scene;
    scene.background = new THREE.Color(_hex(B.bgBot));
    scene.fog = new THREE.Fog(_hex(B.fog), 45, 170);
    scene.add(_skyDome(_hex(B.bgTop), _hex(B.bgBot)));
    // Dawn: a low sun from ahead of the train.
    stage.light({ sun: 0xffc98a, sunI: 1.35, sky: 0xbfd0ea, ground: 0x6a4a30, hemiI: 0.6,
                  rim: 0x9fd0ff, rimI: 0.45, dir: [-18, 10, 10], span: 12 });
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(8, 32), new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }));
    sunDisc.position.set(-90, 12, -150); sunDisc.lookAt(0, 12, 0); scene.add(sunDisc);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 400), _mat(0x8a6a4c, 1));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(500, 4.4), _mat(0x6f6358, 1));
    bed.rotation.x = -Math.PI / 2; bed.position.y = 0.02; bed.receiveShadow = true; scene.add(bed);
    const steel = _mat(0x9aa0a8, 0.35, 0.85);
    [-0.75, 0.75].forEach(z => {
        const r = new THREE.Mesh(new THREE.BoxGeometry(500, 0.12, 0.1), steel);
        r.position.set(0, 0.22, z); scene.add(r);
    });

    const scrollers = [];
    const scroll = (obj, rate, span) => { obj.userData.scroll = { rate, span }; scene.add(obj); scrollers.push(obj); return obj; };

    // Sleepers: the one thing close enough to read the speed off.
    const sleeperMat = _mat(0x4a3526, 0.95);
    for (let i = 0; i < 50; i++) {
        const sl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 2.6), sleeperMat);
        sl.position.set(-60 + i * 2.4, 0.1, 0); sl.receiveShadow = true;
        scroll(sl, 1, 120);
    }
    // Telegraph poles along the line, and the yard going by behind them.
    const wood = _mat(0x5a4230, 0.9);
    for (let i = 0; i < 8; i++) {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 7), wood);
        pole.position.y = 3.5; g.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.8), wood);
        arm.position.y = 6.6; g.add(arm);
        g.position.set(-60 + i * 15, 0, -5.5);
        scroll(g, 1, 120);
    }
    for (let i = 0; i < 9; i++) {
        const r = [0.1, 0.65, 0.85, 0.2, 0.7, 0.9, 0.15, 0.68, 0.8][i];
        const p = PROP_KIT.railyard(r, 500 + i);
        p.position.set(-60 + i * 13.5 + _rand(i) * 4, 0, -9 - _rand(i + 3) * 6);
        p.rotation.y = _rand(i + 7) * 3;
        scroll(p, 1, 120);
    }
    for (let i = 0; i < 3; i++) {
        const shed = PROP_KIT.railShed(new THREE.Vector3(0, 0, 0), 600 + i);
        shed.position.set(-70 + i * 50, 0, -22);
        scroll(shed, 0.55, 150);
    }
    // Far away: buttes and the water tower, barely moving.
    [[-80, -90, 1], [-20, -110, 2], [40, -95, 3], [100, -120, 4]].forEach(([x, z, sd]) => {
        const r = PROP_KIT.badlandsRock(new THREE.Vector3(0, 0, 0), 700 + sd);
        r.position.set(x, 0, z); r.scale.setScalar(1.5);
        scroll(r, 0.06, 260);
    });
    const tower = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 4, 16), _mat(0x6b4a2c, 0.85));
    tank.position.y = 10; tower.add(tank);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.8, 16), _mat(0x3f2a1a, 0.8));
    cap.position.y = 12.9; tower.add(cap);
    [[-2, -2], [2, -2], [-2, 2], [2, 2]].forEach(([x, z]) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 0.4), wood);
        leg.position.set(x, 4, z); tower.add(leg);
    });
    tower.position.set(10, 0, -45);
    scroll(tower, 0.25, 200);

    // ---- The train: a carriage under the players, the locomotive ahead ----
    const train = new THREE.Group();
    const red = _mat(0x8a2f22, 0.6), dark = _mat(0x24201c, 0.5, 0.4), brass = _mat(0xc9a24a, 0.3, 0.85);
    const L = roofHalf * 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(L, roofY - 1.1, 2.6), red);
    body.position.y = 0.95 + (roofY - 1.1) / 2; train.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 0.3, 0.2, 2.9), _mat(0x3a2c22, 0.75));
    roof.position.y = roofY - 0.1; train.add(roof);
    for (let i = 0; i < 7; i++) {        // windows, warm inside
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.8), new THREE.MeshBasicMaterial({ color: 0xffd99a }));
        w.position.set(-L / 2 + 1 + i * (L - 2) / 6, 2.4, 1.31); train.add(w);
    }
    const trim = new THREE.Mesh(new THREE.BoxGeometry(L, 0.12, 2.64), brass);
    trim.position.y = 1.4; train.add(trim);
    const wheels = [], spokes = [];
    [-L / 2 + 1.2, -L / 2 + 2.4, L / 2 - 2.4, L / 2 - 1.2].forEach(x => [-1.1, 1.1].forEach(z => {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.18, 16), dark);
        wh.rotation.x = Math.PI / 2; wh.position.set(x, 0.72, z); train.add(wh); wheels.push(wh);
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.08, 0.2), brass);
        spoke.position.copy(wh.position); spoke.position.z += Math.sign(z) * 0.1; train.add(spoke); spokes.push(spoke);
    }));
    // The locomotive, nose to the left.
    const loco = new THREE.Group();
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 5.5, 18), _mat(0x1f2328, 0.4, 0.6));
    boiler.rotation.z = Math.PI / 2; boiler.position.set(-3.2, 2.4, 0); loco.add(boiler);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.18, 0.2, 18), brass);
    band.rotation.z = Math.PI / 2; band.position.set(-2.2, 2.4, 0); loco.add(band);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.2, 2.6), _mat(0x2d3a2e, 0.6));
    cab.position.set(0.6, 2.5, 0); loco.add(cab);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.3, 1.4, 12), dark);
    stack.position.set(-5, 4.2, 0); loco.add(stack);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    lamp.position.set(-6, 3.1, 0); loco.add(lamp);
    const catcher = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.2, 4), _mat(0x6b2a1e, 0.6));
    catcher.rotation.z = Math.PI / 2; catcher.position.set(-6.3, 0.9, 0); loco.add(catcher);
    [-4.6, -3.2, -1.8, 0.2].forEach(x => [-1.1, 1.1].forEach(z => {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.2, 16), dark);
        wh.rotation.x = Math.PI / 2; wh.position.set(x, 0.9, z); loco.add(wh); wheels.push(wh);
    }));
    loco.position.x = -roofHalf - 2.8;
    train.add(loco);
    train.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    scene.add(train);

    // Smoke off the stack, streaming back over the roof.
    const smoke = [];
    const smokeMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c8, transparent: true, opacity: 0.6, roughness: 1 });
    for (let i = 0; i < 9; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), smokeMat.clone());
        m.userData.t = i / 9 * 2.2;
        scene.add(m); smoke.push(m);
    }
    const stackTop = new THREE.Vector3(-roofHalf - 2.8 - 5, 5, 0);

    // ---- Bridges ----
    const bridges = [];
    function makeBridge() {
        const g = new THREE.Group();
        const beamY = roofY + 1.05;
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 8), _mat(0x5a4230, 0.9));
        beam.position.y = beamY + 0.35; g.add(beam);
        const warn = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.18, 8.02), _mat(0xfacc15, 0.5, 0, { emissive: 0x7a5a00, emissiveIntensity: 0.6 }));
        warn.position.y = beamY + 0.05; g.add(warn);
        [-3.8, 3.8].forEach(z => {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, beamY + 0.7, 0.7), _mat(0x4a3526, 0.9));
            post.position.set(0, (beamY + 0.7) / 2, z); g.add(post);
            const brace = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.5, 0.25), _mat(0x4a3526, 0.9));
            brace.position.set(0, beamY - 1.2, z * 0.8); brace.rotation.x = z > 0 ? 0.6 : -0.6; g.add(brace);
        });
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        g.visible = false;
        scene.add(g);
        return g;
    }
    for (let i = 0; i < 2; i++) bridges.push(makeBridge());

    let wheelAng = 0;
    return {
        speed, roofY, roofHalf, train, bridges,
        /** Send a bridge from `x` ahead of the train (negative x). */
        spawnBridge(x) {
            const b = bridges.find(k => !k.visible) || bridges[0];
            b.visible = true; b.position.set(x, 0, 0);
            return b;
        },
        update(dt, t) {
            const d = speed * dt;
            scrollers.forEach(o => {
                const s = o.userData.scroll;
                o.position.x += d * s.rate;
                if (o.position.x > s.span / 2) o.position.x -= s.span;
            });
            bridges.forEach(b => { if (b.visible) { b.position.x += d; if (b.position.x > 40) b.visible = false; } });
            wheelAng += d / 0.6;
            wheels.forEach(w => { w.rotation.y = wheelAng; });
            spokes.forEach(sp => { sp.rotation.z = -wheelAng; });
            // A gentle rock on the springs.
            train.position.y = Math.sin(t * 9) * 0.025;
            train.rotation.z = Math.sin(t * 2.3) * 0.004;
            smoke.forEach(m => {
                m.userData.t += dt;
                if (m.userData.t > 2.2) m.userData.t -= 2.2;
                const k = m.userData.t;
                m.position.set(stackTop.x + k * (speed * 0.55), stackTop.y + k * 1.6, Math.sin(k * 3 + m.id) * 0.4);
                m.scale.setScalar(0.4 + k * 0.55);
                m.material.opacity = Math.max(0, 0.5 - k * 0.23);
            });
        },
    };
}

// ---- Cinder Mine: the cart floor ----------------------------------------
//
// Underground, "lit by lantern and furnace, not by any sky". The game hands
// over its track GRAPH (nodes and edges, the numbers the carts ride on) and
// the set lays rails and sleepers along every edge, a turntable plate and a
// switch arrow at every junction, and dresses the dark around it: wet rock,
// ember cracks glowing up through the floor, timber shoring, the ore carts
// and spoil heaps of the mine's own prop set.
export function buildMineFloor(stage, G) {
    const B = DISTRICT_BIOMES.mine;
    const scene = stage.scene;
    scene.background = new THREE.Color(0x0c0806);
    scene.fog = null;
    scene.add(new THREE.HemisphereLight(0x8a5a3a, 0x120a06, 0.85));
    const key = new THREE.DirectionalLight(0xffc48a, 0.55);
    key.position.set(6, 20, 4); scene.add(key);
    // Two furnace glows, fixed, so the floor is warm at the ends.
    [[-7, -11], [7, 11]].forEach(([x, z]) => {
        const l = new THREE.PointLight(0xff7a2a, 1.4, 22, 1.6);
        l.position.set(x, 3, z); scene.add(l);
    });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), _mat(0x2a1d16, 0.95));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    // Ember cracks: thin glowing lines across the rock, pulsing.
    const ember = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.55 });
    const cracks = [];
    for (let i = 0; i < 22; i++) {
        const c = new THREE.Mesh(new THREE.PlaneGeometry(0.08 + _rand(i) * 0.08, 1 + _rand(i + 4) * 3), ember.clone());
        c.rotation.x = -Math.PI / 2; c.rotation.z = _rand(i + 9) * Math.PI;
        c.position.set((_rand(i + 1) - 0.5) * 14, 0.012, (_rand(i + 2) - 0.5) * 24);
        scene.add(c); cracks.push(c);
    }
    // The rock walls round the floor: boulders and timber shoring.
    const rock = [0x3a2a20, 0x4a3426, 0x2e221a];
    for (let i = 0; i < 26; i++) {
        const side = i % 2 ? 1 : -1;
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + _rand(i) * 1.4), _mat(rock[i % 3], 0.95));
        const along = (i / 26 - 0.5) * 26;
        b.position.set(side * (G.w / 2 + 1.6 + _rand(i + 3) * 1.4), 0.4, along);
        b.rotation.set(_rand(i) * 3, _rand(i + 1) * 3, 0);
        scene.add(b);
    }
    const timber = _mat(0x5a3d26, 0.9);
    for (let z = -G.d / 2; z <= G.d / 2 + 0.01; z += G.d / 3) {
        [-1, 1].forEach(side => {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.2, 0.4), timber);
            post.position.set(side * (G.w / 2 + 0.9), 1.6, z); scene.add(post);
        });
        // Posts only. The overhead beams crossed between the camera and the
        // track and hid a row of junctions from above.
    }
    [[-G.w / 2 - 2.4, -G.d / 2 + 1, 0.1], [G.w / 2 + 2.4, G.d / 2 - 1, 0.35], [-G.w / 2 - 2.6, 3, 0.9], [G.w / 2 + 2.5, -4, 0.7]]
        .forEach(([x, z, r], i) => { const p = PROP_KIT.mine(r, 800 + i); p.position.set(x, 0, z); scene.add(p); });

    // Track: rails and sleepers along every edge.
    const steel = _mat(0x8f949b, 0.35, 0.85), sleeper = _mat(0x4a3322, 0.95);
    G.edges.forEach(([a, b]) => {
        const A = G.nodes[a], Bn = G.nodes[b];
        const dx = Bn.x - A.x, dz = Bn.z - A.z, len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
        const g = new THREE.Group();
        g.position.set((A.x + Bn.x) / 2, 0, (A.z + Bn.z) / 2);
        g.rotation.y = ang;
        for (let t = -len / 2 + 0.35; t < len / 2 - 0.3; t += 0.5) {
            const sl = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.2), sleeper);
            sl.position.set(0, 0.04, t); sl.receiveShadow = true; g.add(sl);
        }
        [-0.28, 0.28].forEach(x => {
            const r = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, len), steel);
            r.position.set(x, 0.12, 0); g.add(r);
        });
        scene.add(g);
    });
    // Junctions: a plate and a switch arrow the game turns.
    const arrows = G.nodes.map(n => {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 20), _mat(0x6b5a48, 0.5, 0.6));
        plate.position.set(n.x, 0.05, n.z); scene.add(plate);
        const arrow = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.6), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
        shaft.position.z = 0.05; arrow.add(shaft);
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 3), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
        head.rotation.x = Math.PI / 2; head.position.z = 0.5; arrow.add(head);
        arrow.position.set(n.x, 0.12, n.z);
        arrow.visible = n.exits > 2;           // a corner has no choice to show
        scene.add(arrow);
        return arrow;
    });

    const dust = B.motes ? _motes({ ...B.motes, spread: 14 }) : null;
    if (dust) scene.add(dust);

    return {
        arrows,
        update(dt, t) {
            cracks.forEach((c, i) => { c.material.opacity = 0.35 + Math.sin(t * 2 + i) * 0.2; });
            if (dust) {
                const p = dust.geometry.attributes.position, a = p.array;
                for (let i = 0; i < a.length; i += 3) {
                    a[i + 1] += dt * dust.userData.rise * 0.5;
                    if (a[i + 1] > 5) a[i + 1] = 0;
                }
                p.needsUpdate = true;
            }
        },
    };
}

/** Sets by district key. A game asks for the one its story is set in. */
export const STAGE_SETS = {
    hub: buildPerditionStreet,
    bad: buildBootHill,
    fin: buildBankFloor,
    rail: buildRailRun,
    mine: buildMineFloor,
};
