// ============================================================
// COSMETICS FX — what a look actually does to a figure, a die and a hop.
// ============================================================
//
// Every cosmetic is procedural (no art files), like the rest of the figures.
// The ids are defined in src/meta/Cosmetics.js; an id this file does not know
// draws nothing, so a newer phone's cosmetic on an older phone is harmless.
//
// Hats are placed from the figure's own bounding box, so one hat fits the slime,
// the ghost and the bunny without a per-character table. They are added as
// ordinary children ABOVE the neck height, which is exactly what CharacterRig
// moves into the head group: a hat nods with the head for free.
// ============================================================

const GOLD = 0xfbbf24;

function _m(color, o = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0, ...o });
}

// ---- Finishes ---------------------------------------------------------------

/** Re-surface the body materials. Hue is never changed (seat colour = identity). */
export function applyFinish(id, mats) {
    const { body, shade, pale } = mats;
    const all = [body, shade].filter(Boolean);
    switch (id) {
        case 'matte':
            all.forEach(m => { m.roughness = 1; m.clearcoat = 0; m.metalness = 0; m.color.multiplyScalar(0.82); });
            break;
        case 'metallic':
            // The board has no environment map, so true metal reflects nothing
            // and goes black. Half-metal plus a bright clearcoat reads as
            // anodised paint under the key light.
            all.forEach(m => { m.metalness = 0.45; m.roughness = 0.2; m.clearcoat = 1; m.clearcoatRoughness = 0.08;
                               m.emissive = m.color.clone().multiplyScalar(0.18); });
            break;
        case 'pearl':
            all.forEach(m => {
                m.roughness = 0.14; m.clearcoat = 1; m.clearcoatRoughness = 0.05;
                if (m.sheen !== undefined) { m.sheen = new THREE.Color(0xffffff); }
            });
            if (pale) { pale.roughness = 0.1; pale.metalness = 0.2; }
            break;
        case 'neon':
            all.forEach(m => { m.emissive = m.color.clone(); m.emissiveIntensity = 0.55; m.roughness = 0.3; });
            if (pale) { pale.emissive = pale.color.clone(); pale.emissiveIntensity = 0.4; }
            break;
        case 'gilded':
            // Gold leaf over the seat colour: a warm metallic glow on the body,
            // and the pale accents (bellies, cuffs) turned solid gold.
            if (pale) { pale.color.set(GOLD); pale.metalness = 0.5; pale.roughness = 0.25; pale.emissive = new THREE.Color(0xb45309); pale.emissiveIntensity = 0.45; }
            all.forEach(m => { m.metalness = 0.3; m.roughness = 0.22; m.clearcoat = 1;
                               m.emissive = new THREE.Color(0x8a5a00); m.emissiveIntensity = 0.55; });
            break;
        default: break;   // glossy: the figure as built
    }
    all.forEach(m => { m.needsUpdate = true; });
}

// ---- Hats -------------------------------------------------------------------

/**
 * Build the hat for `id` and add it to `group`. `group` is a figure straight out
 * of createCharacterMesh (contact shadow tagged, eyes tagged).
 */
export function addHat(group, id) {
    if (!id || id === 'none') return null;
    const box = new THREE.Box3();
    const eyes = [];
    const parts = [];
    group.children.forEach(c => {
        if (c.userData.contact) return;
        if (c.userData.eye) eyes.push(c);
        const b = new THREE.Box3().expandByObject(c);
        parts.push(b);
        box.union(b);
    });
    if (box.isEmpty()) return null;
    const figW = box.max.x - box.min.x;
    // The crown of the HEAD, not of the figure: ears, antennae and a slime's
    // tip are narrow, and a hat perched on a bunny's ear tips floats. Only
    // parts at least a third of the figure's width count toward "top".
    let top = 0;
    parts.forEach(b => { if (b.max.x - b.min.x >= figW * 0.34) top = Math.max(top, b.max.y); });
    if (!top) top = box.max.y;
    const w = Math.min(1.35, Math.max(0.62, figW * 0.86));   // head-ish width
    const hat = new THREE.Group();
    hat.userData.cosmetic = 'hat';
    const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
        m.castShadow = true;
        hat.add(m);
        return m;
    };
    const r = w / 2;

    switch (id) {
        case 'party': {
            add(new THREE.ConeGeometry(r * 0.55, r * 1.5, 18), _m(0xec4899), 0, r * 0.7);
            add(new THREE.TorusGeometry(r * 0.5, r * 0.07, 6, 18), _m(0xfde047), 0, r * 0.05, 0, Math.PI / 2);
            add(new THREE.SphereGeometry(r * 0.14, 10, 8), _m(0xfde047), 0, r * 1.48);
            break;
        }
        case 'beanie': {
            add(new THREE.SphereGeometry(r * 0.82, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), _m(0x0ea5e9, { roughness: 0.95 }), 0, 0);
            add(new THREE.CylinderGeometry(r * 0.84, r * 0.84, r * 0.22, 20), _m(0x0369a1, { roughness: 0.95 }), 0, r * 0.05);
            add(new THREE.SphereGeometry(r * 0.2, 10, 8), _m(0xffffff, { roughness: 1 }), 0, r * 0.86);
            break;
        }
        case 'cowboy': {
            const leather = _m(0x92400e, { roughness: 0.7 });
            add(new THREE.CylinderGeometry(r * 1.25, r * 1.25, r * 0.08, 24), leather, 0, r * 0.04);
            add(new THREE.CylinderGeometry(r * 0.55, r * 0.66, r * 0.6, 18), leather, 0, r * 0.34);
            add(new THREE.CylinderGeometry(r * 0.67, r * 0.67, r * 0.1, 18), _m(0x1c1917), 0, r * 0.12);
            break;
        }
        case 'chef': {
            const white = _m(0xffffff, { roughness: 0.8 });
            add(new THREE.CylinderGeometry(r * 0.6, r * 0.6, r * 0.5, 18), white, 0, r * 0.25);
            const puff = add(new THREE.SphereGeometry(r * 0.78, 16, 12), white, 0, r * 0.75);
            puff.scale.set(1, 0.7, 1);
            break;
        }
        case 'tophat': {
            const black = _m(0x111827, { roughness: 0.35 });
            add(new THREE.CylinderGeometry(r * 1.0, r * 1.0, r * 0.07, 24), black, 0, r * 0.03);
            add(new THREE.CylinderGeometry(r * 0.6, r * 0.62, r * 1.1, 20), black, 0, r * 0.6);
            add(new THREE.CylinderGeometry(r * 0.63, r * 0.63, r * 0.18, 20), _m(0xdc2626), 0, r * 0.18);
            break;
        }
        case 'viking': {
            const steel = _m(0x9ca3af, { metalness: 0.7, roughness: 0.3 });
            const horn = _m(0xfef3c7, { roughness: 0.5 });
            add(new THREE.SphereGeometry(r * 0.82, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel, 0, 0);
            add(new THREE.ConeGeometry(r * 0.16, r * 0.8, 12), horn, r * 0.85, r * 0.45, 0, 0, 0, -0.9);
            add(new THREE.ConeGeometry(r * 0.16, r * 0.8, 12), horn, -r * 0.85, r * 0.45, 0, 0, 0, 0.9);
            break;
        }
        case 'propeller': {
            add(new THREE.SphereGeometry(r * 0.8, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), _m(0xef4444), 0, 0);
            add(new THREE.CylinderGeometry(r * 0.05, r * 0.05, r * 0.3, 8), _m(0x374151), 0, r * 0.92);
            const blades = new THREE.Group();
            blades.position.y = r * 1.08;
            [0, Math.PI].forEach(a => {
                const b = new THREE.Mesh(new THREE.BoxGeometry(r * 0.9, r * 0.04, r * 0.2), _m(0x3b82f6));
                b.position.x = Math.cos(a) * r * 0.45; b.rotation.y = a;
                blades.add(b);
            });
            // Spins while it is drawn: costs nothing when off screen.
            blades.children[0].onBeforeRender = () => { blades.rotation.y += 0.25; };
            hat.add(blades);
            break;
        }
        case 'halo': {
            const ring = add(new THREE.TorusGeometry(r * 0.6, r * 0.07, 8, 28),
                _m(GOLD, { emissive: 0xf59e0b, emissiveIntensity: 0.9, metalness: 0.4, roughness: 0.3 }), 0, r * 0.55, 0, Math.PI / 2);
            ring.castShadow = false;
            break;
        }
        case 'crown': {
            const gold = _m(GOLD, { emissive: 0xb45309, emissiveIntensity: 0.4, metalness: 0.8, roughness: 0.25 });
            add(new THREE.CylinderGeometry(r * 0.62, r * 0.66, r * 0.34, 20, 1, true), gold, 0, r * 0.17);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                add(new THREE.ConeGeometry(r * 0.12, r * 0.32, 8), gold, Math.cos(a) * r * 0.62, r * 0.48, Math.sin(a) * r * 0.62);
            }
            add(new THREE.SphereGeometry(r * 0.1, 10, 8), _m(0xdc2626, { roughness: 0.15 }), 0, r * 0.18, r * 0.66);
            break;
        }
        case 'shades': {
            // Over the eyes rather than on top: the one accessory placed by the face.
            // A figure with a printed face (no eyeball meshes) gets them across
            // the front at eye height.
            const c = new THREE.Vector3();
            if (eyes.length) { eyes.forEach(e => c.add(e.position)); c.divideScalar(eyes.length); }
            else c.set(0, top * 0.62, box.max.z);
            const spread = eyes.length > 1 ? Math.abs(eyes[0].position.x - eyes[1].position.x) : r * 0.6;
            const lens = _m(0x0f172a, { roughness: 0.05, metalness: 0.6 });
            const lw = Math.max(0.14, spread * 0.62);
            [-1, 1].forEach(s => add(new THREE.BoxGeometry(lw, lw * 0.62, 0.05), lens, s * spread / 2, 0, 0));
            add(new THREE.BoxGeometry(spread, 0.035, 0.04), lens, 0, lw * 0.15, 0);
            hat.position.set(c.x, c.y, c.z + 0.09);
            hat.userData.cosmetic = 'shades';
            group.add(hat);
            return hat;
        }
        default:
            return null;
    }
    // Sink the brim a touch so it sits ON the head rather than hovering over it.
    hat.position.set(0, top - r * 0.12, 0);
    group.add(hat);
    return hat;
}

// ---- Dice -------------------------------------------------------------------

const DICE_SKINS = {
    classic:  { face: '#ffffff', pip: '#000000' },
    midnight: { face: '#111827', pip: '#f9fafb', mat: { roughness: 0.25, metalness: 0.3 } },
    ruby:     { face: '#b91c1c', pip: '#ffffff', mat: { roughness: 0.15, metalness: 0.1 } },
    ocean:    { face: '#0369a1', pip: '#e0f2fe', mat: { roughness: 0.2 } },
    wood:     { face: '#a16207', pip: '#422006', mat: { roughness: 0.85 }, grain: '#854d0e' },
    neon:     { face: '#052e16', pip: '#4ade80', mat: { emissive: 0x16a34a, emissiveIntensity: 0.35 }, glowPips: true },
    gold:     { face: '#f5c842', pip: '#7c2d12', mat: { metalness: 0.85, roughness: 0.22 } },
};

const _faceCache = {};
const PIPS = [
    [], [[28, 28]], [[12, 12], [44, 44]], [[12, 12], [28, 28], [44, 44]],
    [[12, 12], [44, 12], [12, 44], [44, 44]],
    [[12, 12], [44, 12], [28, 28], [12, 44], [44, 44]],
    [[12, 8], [44, 8], [12, 28], [44, 28], [12, 48], [44, 48]],
];

function _face(skinId, v) {
    const k = `${skinId}:${v}`;
    if (_faceCache[k]) return _faceCache[k];
    const s = DICE_SKINS[skinId] || DICE_SKINS.classic;
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = s.face; x.fillRect(0, 0, 64, 64);
    if (s.grain) {
        x.strokeStyle = s.grain; x.lineWidth = 2;
        for (let i = 6; i < 64; i += 9) { x.beginPath(); x.moveTo(0, i); x.bezierCurveTo(20, i + 4, 40, i - 4, 64, i + 2); x.stroke(); }
    }
    x.fillStyle = s.pip;
    if (s.glowPips) { x.shadowColor = s.pip; x.shadowBlur = 8; }
    (PIPS[v] || []).forEach(([dx, dy]) => { x.beginPath(); x.arc(dx + 4, dy + 4, 4.5, 0, Math.PI * 2); x.fill(); });
    const tex = new THREE.CanvasTexture(c);
    _faceCache[k] = tex;
    return tex;
}

/**
 * The six face materials for a die in `skinId`, in BoxGeometry face order.
 * `classic` keeps the shipped look (square pips) by returning null, so the
 * default die is byte-for-byte what it was.
 */
export function diceMaterials(skinId, order) {
    if (!skinId || skinId === 'classic' || !DICE_SKINS[skinId]) return null;
    const s = DICE_SKINS[skinId];
    return order.map(v => new THREE.MeshStandardMaterial({ color: 0xffffff, map: _face(skinId, v), ...(s.mat || {}) }));
}

// ---- Trails -----------------------------------------------------------------

const TRAIL_GLYPHS = {
    sparkle:  ['✨', '⭐'],
    hearts:   ['💖', '💕'],
    bubbles:  ['🫧', '○'],
    confetti: ['🎊', '🟡', '🔷'],
    flames:   ['🔥'],
};
const _spriteTex = {};
function _glyphTex(g) {
    if (_spriteTex[g]) return _spriteTex[g];
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.font = '48px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#fff'; x.fillText(g, 32, 36);
    return (_spriteTex[g] = new THREE.CanvasTexture(c));
}

/**
 * A short puff of the trail's glyphs where a token lands. Self-animating and
 * self-cleaning: nothing for the render loop to know about.
 */
export function landingPuff(scene, pos, trailId) {
    const glyphs = TRAIL_GLYPHS[trailId];
    if (!scene || !glyphs || !pos) return;
    const sprites = [];
    const N = 5;
    for (let i = 0; i < N; i++) {
        const mat = new THREE.SpriteMaterial({ map: _glyphTex(glyphs[i % glyphs.length]), transparent: true, depthWrite: false });
        const sp = new THREE.Sprite(mat);
        const a = (i / N) * Math.PI * 2 + Math.random();
        sp.position.set(pos.x + Math.cos(a) * 0.5, (pos.y || 0) + 0.3, pos.z + Math.sin(a) * 0.5);
        sp.scale.setScalar(0.55);
        sp.userData.v = new THREE.Vector3(Math.cos(a) * 0.9, 1.6 + Math.random(), Math.sin(a) * 0.9);
        scene.add(sp);
        sprites.push(sp);
    }
    const t0 = performance.now(), DUR = 750;
    let last = t0;
    const step = now => {
        const k = (now - t0) / DUR, dt = (now - last) / 1000; last = now;
        if (k >= 1) { sprites.forEach(s => { scene.remove(s); s.material.dispose(); }); return; }
        sprites.forEach(s => {
            s.position.addScaledVector(s.userData.v, dt);
            s.material.opacity = 1 - k * k;
        });
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}
