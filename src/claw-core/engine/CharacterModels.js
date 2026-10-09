// ============================================================
// CHARACTER MODELS — the toy figures every player sees, on the board and on
// every 3D minigame stage. Moved out of HundredBlockDash's Renderer.js into
// claw-core so CLAWGames gets the same cast. THREE is the vendored global.
// ============================================================

// ---- Character meshes ----
//
// These are the only things on screen a player looks at for a whole match, and
// they were nine primitives with two black dots on the front: a squashed sphere,
// a cylinder-plus-sphere, a plain cube. Every one of them also carried a white
// 0.1×0.1×0.6 box floating at ankle height as a "which way am I facing" marker,
// which read as a rendering fault rather than as part of the character.
//
// The rebuild keeps the silhouettes recognisable — the slime is still a blob,
// Boxy is still a cube — and puts a real toy figure inside each one:
//
//   · a shared BODY KIT, so the nine read as one cast rather than nine sketches
//   · rounded geometry instead of hard primitives (see _roundedBox)
//   · clearcoat physical material, for moulded vinyl instead of matte clay
//   · eyes with a white, a pupil and a catchlight — the single biggest change,
//     because two flat black spheres cannot look at anything
//   · a contact shadow under every figure, which is what stops them reading as
//     hovering above the tile
//   · the facing cue built INTO the character (a nose, a brim, a visor, a tie)
//     instead of bolted on as a white plank
//
// Budget: a character is 12–22 small meshes. Seven exist at once in the worst
// case (2 players + 4 attached buddies + 1 board buddy), which is well inside
// what the board already draws for tiles.

// Cheap darker/lighter relatives of the player colour, so every figure gets
// shading that belongs to it rather than a shared grey.
export function _tint(hex, f) {
    const c = new THREE.Color(hex);
    if (f < 1) c.multiplyScalar(f);
    else c.lerp(new THREE.Color(0xffffff), Math.min(1, (f - 1) / 1.2));
    return c.getHex();
}

// A box whose corners are actually round. three r128 has no RoundedBoxGeometry,
// so this spherifies the shell of a segmented box: every vertex is pushed out to
// radius r from its clamped position on the inner box. Hard edges are what made
// Boxy and the Bodyguard look unfinished next to everything else on the board.
export function _roundedBox(w, h, d, r, seg = 4) {
    const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    const pos = g.attributes.position;
    const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
    const v = new THREE.Vector3(), c = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        c.set(Math.max(-ix, Math.min(ix, v.x)),
              Math.max(-iy, Math.min(iy, v.y)),
              Math.max(-iz, Math.min(iz, v.z)));
        o.copy(v).sub(c);
        if (o.lengthSq() > 1e-9) { o.setLength(r); v.copy(c).add(o); pos.setXYZ(i, v.x, v.y, v.z); }
    }
    g.computeVertexNormals();
    return g;
}

// Eyes that can look at something: a white, a pupil set forward inside it, and
// a small offset catchlight. Returned as a group so a character can tilt them.
export function _eyeball(x, y, z, r, look = 0) {
    const g = new THREE.Group();
    const white = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 14),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }));
    g.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.56, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.15 }));
    pupil.position.set(look * r * 0.34, 0, r * 0.62);
    g.add(pupil);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
    glint.position.set(look * r * 0.34 + r * 0.22, r * 0.26, r * 0.86);
    g.add(glint);
    g.position.set(x, y, z);
    return g;
}

export function createCharacterMesh(type, colorCode) {
    const group = new THREE.Group();

    // Moulded-vinyl body. Clearcoat is what separates a toy figure from a lump
    // of clay under the board's single key light.
    const mat = new THREE.MeshPhysicalMaterial({
        color: colorCode, roughness: 0.34, metalness: 0.02,
        clearcoat: 0.7, clearcoatRoughness: 0.3,
    });
    const shade = new THREE.MeshPhysicalMaterial({
        color: _tint(colorCode, 0.62), roughness: 0.45, metalness: 0.02, clearcoat: 0.4,
    });
    const pale = new THREE.MeshStandardMaterial({ color: _tint(colorCode, 1.7), roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b2130, roughness: 0.45, metalness: 0.15 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f7fb, roughness: 0.4 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xb45309, emissiveIntensity: 0.45, metalness: 0.5, roughness: 0.3 });

    const add = (geo, m, x, y, z, rx, ry, rz) => {
        const msh = new THREE.Mesh(geo, m);
        msh.position.set(x || 0, y || 0, z || 0);
        if (rx || ry || rz) msh.rotation.set(rx || 0, ry || 0, rz || 0);
        group.add(msh);
        return msh;
    };
    // Tagged so a minigame rig can find them and make them blink and look.
    // The board never reads the tag.
    const eyes = (y, z, r, spread) => {
        [[spread, -1], [-spread, 1]].forEach(([x, look]) => {
            const e = _eyeball(x, y, z, r, look);
            e.userData.eye = true;
            group.add(e);
        });
    };
    // A small dark mouth line reads as a face far more cheaply than geometry.
    const smile = (y, z, w) => {
        const m = add(new THREE.TorusGeometry(w, w * 0.16, 6, 12, Math.PI), dark, 0, y, z, 0, 0, Math.PI);
        return m;
    };

    if (type === 'slime') {
        // A droplet, not a squashed ball: wide wobbly base, tapered peak.
        const body = add(new THREE.SphereGeometry(0.72, 22, 18), mat, 0, 0.66);
        body.scale.set(1.06, 0.9, 1.0);
        add(new THREE.ConeGeometry(0.3, 0.55, 16), mat, 0, 1.38);
        add(new THREE.SphereGeometry(0.12, 10, 10), mat, 0, 1.68);
        // Lighter belly so the front face is not one flat colour.
        const belly = add(new THREE.SphereGeometry(0.55, 18, 14), pale, 0, 0.52, 0.3);
        belly.scale.set(0.92, 0.72, 0.5);
        eyes(0.84, 0.6, 0.15, 0.26);
        smile(0.56, 0.66, 0.15);
    } else if (type === 'ghost') {
        // A lathe profile in three explicit parts: scalloped hem, straight
        // sheet, round dome. Two earlier attempts drove the radius from a single
        // curve in `t` while y stayed linear, which cannot produce a circle —
        // both came out as a tent. The dome is now swept in its own angle, so it
        // is an actual quarter-circle of radius R sitting on the shoulder.
        const R = 0.62, HEM = 0.14, SHOULDER = 0.98;
        const pts = [];
        for (let i = 0; i <= 5; i++) {           // hem: waves along the bottom
            const t = i / 5;
            pts.push(new THREE.Vector2(R + Math.sin(t * Math.PI * 2.4) * 0.08, t * HEM));
        }
        for (let i = 1; i <= 3; i++) {           // sheet: straight sides
            pts.push(new THREE.Vector2(R, HEM + (SHOULDER - HEM) * (i / 3)));
        }
        for (let i = 1; i <= 10; i++) {          // dome: a real quarter-circle
            const a = (i / 10) * (Math.PI / 2);
            pts.push(new THREE.Vector2(Math.max(0.02, R * Math.cos(a)), SHOULDER + R * Math.sin(a)));
        }
        const sheet = new THREE.MeshPhysicalMaterial({
            color: colorCode, roughness: 0.28, metalness: 0, clearcoat: 0.55,
            transparent: true, opacity: 0.9, side: THREE.DoubleSide,
        });
        add(new THREE.LatheGeometry(pts, 26), sheet, 0, 0.03);
        // Nub arms out to the sides of the SHEET, not the dome.
        [-1, 1].forEach(s => {
            const arm = add(new THREE.SphereGeometry(0.19, 12, 10), sheet, s * 0.6, 0.72, 0.06);
            arm.scale.set(1.15, 0.85, 0.9);
        });
        eyes(1.22, 0.5, 0.15, 0.22);
        // An open "oooo" mouth is the one ghost expression everybody reads.
        const mouth = add(new THREE.SphereGeometry(0.12, 12, 10), dark, 0, 1.0, 0.58);
        mouth.scale.set(0.85, 1.15, 0.5);
    } else if (type === 'boxy') {
        // Still a cube — but a moulded one, with a screen for a face.
        add(_roundedBox(1.24, 1.2, 1.16, 0.2, 5), mat, 0, 0.72);
        // A screen INSET in the front face, sized so the eyes read as eyes
        // rather than merging with the mouth bar into one bright slab.
        add(_roundedBox(0.86, 0.56, 0.08, 0.11, 3), dark, 0, 0.82, 0.58);
        const px = new THREE.MeshBasicMaterial({ color: 0x8ef2ff });
        add(_roundedBox(0.12, 0.24, 0.05, 0.04, 2), px, 0.2, 0.9, 0.63);
        add(_roundedBox(0.12, 0.24, 0.05, 0.04, 2), px, -0.2, 0.9, 0.63);
        add(_roundedBox(0.26, 0.05, 0.05, 0.02, 2), px, 0, 0.7, 0.63);
        // Feet and a top vent, so it is a character and not a crate.
        add(_roundedBox(0.34, 0.18, 0.42, 0.07, 2), shade, 0.36, 0.11, 0.02);
        add(_roundedBox(0.34, 0.18, 0.42, 0.07, 2), shade, -0.36, 0.11, 0.02);
        add(_roundedBox(0.66, 0.1, 0.48, 0.05, 2), shade, 0, 1.36, 0);
        add(new THREE.SphereGeometry(0.07, 10, 10), gold, 0, 1.5, 0);
    } else if (type === 'bunny') {
        const body = add(new THREE.SphereGeometry(0.6, 20, 16), mat, 0, 0.7);
        body.scale.set(1, 1.05, 0.95);
        // Ears with a pink inner panel — the detail that makes them ears.
        [-1, 1].forEach(s => {
            const ear = add(new THREE.SphereGeometry(0.17, 12, 12), mat, s * 0.27, 1.54, -0.02, 0, 0, -s * 0.16);
            ear.scale.set(1, 2.6, 0.62);
            const inner = add(new THREE.SphereGeometry(0.11, 10, 10),
                new THREE.MeshStandardMaterial({ color: 0xf9a8d4, roughness: 0.5 }),
                s * 0.3, 1.54, 0.07, 0, 0, -s * 0.16);
            inner.scale.set(1, 2.4, 0.35);
        });
        // Muzzle + nose, so the face has a front.
        const muz = add(new THREE.SphereGeometry(0.22, 14, 12), pale, 0, 0.64, 0.48);
        muz.scale.set(1.25, 0.85, 0.8);
        add(new THREE.SphereGeometry(0.075, 10, 10),
            new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.4 }), 0, 0.72, 0.64);
        add(new THREE.SphereGeometry(0.24, 12, 12), pale, 0, 0.54, -0.62);  // tail puff
        add(new THREE.SphereGeometry(0.17, 10, 10), mat, 0.26, 0.18, 0.16);  // feet
        add(new THREE.SphereGeometry(0.17, 10, 10), mat, -0.26, 0.18, 0.16);
        eyes(0.9, 0.44, 0.13, 0.24);
    } else if (type === 'cabbie') {
        add(new THREE.SphereGeometry(0.62, 20, 16), mat, 0, 0.62);
        add(new THREE.SphereGeometry(0.46, 18, 14), mat, 0, 1.3);
        // A peaked cap that sits ON the head instead of over the eyes.
        add(new THREE.SphereGeometry(0.47, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark, 0, 1.48);
        const brim = add(new THREE.CylinderGeometry(0.46, 0.46, 0.055, 16, 1, false, -0.9, 1.8), dark, 0, 1.47, 0.2);
        brim.scale.set(1, 1, 1.3);
        add(new THREE.TorusGeometry(0.465, 0.05, 8, 20), gold, 0, 1.5, 0, Math.PI / 2);
        // Fare badge on the CHEST, well clear of the mouth it used to sit on.
        add(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 12), gold, 0, 0.62, 0.58, Math.PI / 2);
        eyes(1.33, 0.4, 0.13, 0.21);
        smile(1.16, 0.42, 0.11);
    } else if (type === 'vendor') {
        const body = add(new THREE.SphereGeometry(0.68, 20, 16), mat, 0, 0.66);
        body.scale.set(1.1, 0.95, 1);
        add(new THREE.SphereGeometry(0.42, 18, 14), mat, 0, 1.3);
        // Apron as a curved front panel that hugs the belly. The sphere-segment
        // version wrapped the wrong way and read as a white lump on his side.
        // phi 0 is -X and phi pi/2 is +Z, so a panel centred on the FRONT starts
        // at pi/2 minus half its sweep. The first version started at 0.72pi and
        // wrapped his right side instead.
        const apron = add(new THREE.SphereGeometry(0.72, 20, 16, Math.PI * 0.30, Math.PI * 0.40, Math.PI * 0.30, Math.PI * 0.38), white, 0, 0.66);
        apron.scale.set(1.02, 0.98, 1.02);
        add(_roundedBox(0.22, 0.15, 0.06, 0.05, 2), _mkMat(0xd1d5db), 0, 0.48, 0.72);
        // Toque, seated on the head with the band overlapping the skull so
        // there is no gap between hat and character.
        add(new THREE.CylinderGeometry(0.4, 0.4, 0.18, 16), white, 0, 1.6);
        const puff = add(new THREE.SphereGeometry(0.4, 16, 12), white, 0, 1.82);
        puff.scale.set(1, 0.8, 1);
        add(new THREE.SphereGeometry(0.21, 12, 10), white, 0.21, 1.9);
        add(new THREE.SphereGeometry(0.21, 12, 10), white, -0.21, 1.9);
        eyes(1.34, 0.36, 0.12, 0.19);
        smile(1.17, 0.38, 0.11);
    } else if (type === 'banker') {
        // Tall and narrow: the one figure with a real posture.
        add(_roundedBox(0.74, 1.02, 0.58, 0.22, 4), mat, 0, 0.62);
        add(new THREE.SphereGeometry(0.4, 18, 14), mat, 0, 1.44);
        // Lapels + bow tie, all in the darker relative of the player colour.
        add(_roundedBox(0.46, 0.62, 0.1, 0.06, 3), shade, 0, 0.74, 0.31);
        add(new THREE.SphereGeometry(0.085, 10, 10), dark, 0.085, 1.1, 0.33);
        add(new THREE.SphereGeometry(0.085, 10, 10), dark, -0.085, 1.1, 0.33);
        // Top hat, seated on the crown rather than hovering over it.
        add(new THREE.CylinderGeometry(0.54, 0.54, 0.06, 20), dark, 0, 1.72);
        add(new THREE.CylinderGeometry(0.34, 0.36, 0.6, 20), dark, 0, 2.03);
        add(new THREE.TorusGeometry(0.355, 0.035, 8, 20), gold, 0, 1.8, 0, Math.PI / 2);
        // Briefcase at his side, held, not embedded in his chest.
        add(_roundedBox(0.42, 0.32, 0.14, 0.05, 3), _mkMat(0x7c4a21), 0.56, 0.42, 0.05);
        add(new THREE.TorusGeometry(0.08, 0.022, 6, 12, Math.PI), _mkMat(0x3f2410), 0.56, 0.58, 0.05);
        eyes(1.5, 0.32, 0.12, 0.18);
        smile(1.34, 0.34, 0.1);
    } else if (type === 'bodyguard') {
        // Broad, low, heavy. The only figure wider than it is tall at the chest.
        add(_roundedBox(1.3, 1.02, 0.86, 0.24, 5), mat, 0, 0.76);
        // High-vis vest as two FRONT panels, so the player colour still shows at
        // the sides. The first version was a slab wider than the body itself,
        // which turned the whole figure yellow whoever was playing it.
        const hiviz = _mkMat(0xfacc15, 0.35);
        add(_roundedBox(0.34, 0.8, 0.12, 0.06, 3), hiviz, 0.32, 0.78, 0.42);
        add(_roundedBox(0.34, 0.8, 0.12, 0.06, 3), hiviz, -0.32, 0.78, 0.42);
        // Bands across the FRONT only. Wrapping them right round the figure
        // turned him into a striped barrel and hid the player colour entirely.
        const band = _mkMat(0xe5e7eb, 0.2, 0.6);
        add(_roundedBox(0.92, 0.08, 0.1, 0.03, 2), band, 0, 0.98, 0.44);
        add(_roundedBox(0.92, 0.08, 0.1, 0.03, 2), band, 0, 0.6, 0.44);
        // Shoulder pads, a squared head and a live visor across the FRONT face.
        add(new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), shade, 0.68, 1.2, 0);
        add(new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), shade, -0.68, 1.2, 0);
        add(_roundedBox(0.9, 0.78, 0.8, 0.24, 4), dark, 0, 1.72);
        add(_roundedBox(0.66, 0.19, 0.1, 0.07, 3),
            new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff4d00, emissiveIntensity: 1.1 }),
            0, 1.74, 0.41);
        // Earpiece — the small detail that sells the job.
        add(new THREE.SphereGeometry(0.07, 8, 8), _mkMat(0x111827), 0.45, 1.7, 0.02);
        add(new THREE.CylinderGeometry(0.018, 0.018, 0.4, 6), _mkMat(0x111827), 0.45, 1.44, 0.02, 0, 0, 0.18);
    } else if (type === 'investor') {
        add(_roundedBox(0.78, 1.0, 0.6, 0.24, 4), mat, 0, 0.62);
        add(new THREE.SphereGeometry(0.4, 18, 14), mat, 0, 1.4);
        // Collar + tie: the forward cue, and it says "suit" in two meshes.
        add(_roundedBox(0.44, 0.16, 0.1, 0.05, 2), white, 0, 1.04, 0.3);
        const tie = add(new THREE.ConeGeometry(0.11, 0.5, 4), _mkMat(0xdc2626), 0, 0.76, 0.33, Math.PI, 0, 0);
        tie.rotation.y = Math.PI / 4;
        // The rising chart, as three steps and an arrow rather than a lollipop.
        const green = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x15803d, emissiveIntensity: 0.7 });
        [0, 1, 2].forEach(i => add(_roundedBox(0.14, 0.14 + i * 0.16, 0.14, 0.04, 2), green,
            -0.24 + i * 0.24, 1.9 + i * 0.08, 0));
        add(new THREE.ConeGeometry(0.16, 0.3, 4), green, 0.36, 2.28, 0, 0, Math.PI / 4, -0.5);
        eyes(1.45, 0.32, 0.12, 0.18);
        smile(1.3, 0.34, 0.1);
    }

    // Contact shadow. Without it every figure looks like it is hovering a few
    // centimetres above the tile — the receiveShadow pass alone is too soft at
    // this camera distance to plant them.
    const contact = new THREE.Mesh(
        new THREE.CircleGeometry(0.62, 20),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false }));
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.03;
    contact.renderOrder = -1;
    group.add(contact);

    contact.userData.contact = true;

    group.traverse(o => {
        if (!o.isMesh || o === contact) return;
        o.castShadow = true; o.receiveShadow = true;
    });
    // What CharacterRig needs to re-parent the parts into something it can
    // animate. The board ignores this.
    group.userData.charType = type;
    return group;
}

// Small material factory used by the figures above for their non-body parts.
export function _mkMat(color, rough = 0.42, metal = 0) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}
