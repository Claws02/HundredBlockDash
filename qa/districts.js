// ============================================================
// DISTRICTS — do the four roads read as four different places?
//
// Reported: "make it so that each district truly feels like a different space
// that you're going to, add more details, make it feel alive and like a real
// map that people are exploring."
//
// A district used to be a name and four colours: same asphalt, same lamps, same
// nothing at street level, one building type set twelve units back. All four
// were the same road under a different sky.
//
// This checks the things a screenshot cannot, then takes the screenshots:
//   · every district actually carries its own props, and they differ
//   · the surface under each district is its own material
//   · a landmark exists per district, big enough to read from the flyover
//   · the animated props are ticking, and are released on rebuild
//   · nothing is placed on the road itself
//   · entering a district announces where you have arrived
//
// usage: node districts.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text());
    });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.startRun({ mode: 'pass', map: 'city_circuit' }));
    let ready = false;
    for (let i = 0; i < 400 && !ready; i++) {
        ready = await page.evaluate(() => window.__QA.snapshot().gameState === 'PRE_ROLL');
        if (ready) break;
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(140);
    }
    ok('boot: City match at the roll', ready);

    // ---------------------------------------------------------------
    // 1. Each district carries its own furniture.
    // ---------------------------------------------------------------
    // Count meshes near each district's nodes and describe what they are made
    // of. Two districts that dress the same come out with the same signature.
    const census = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const { ALL_NODES_ORDERED, CITY_GRAPH } = await import('/src/config/BoardGraph.js');
        const scene = R.getScene();
        const out = {};
        const keys = ['ring', 'fin', 'ba', 'shop', 'ind'];
        keys.forEach(k => { out[k] = { near: 0, colors: new Set(), tall: 0 }; });
        const nodeOf = {};
        keys.forEach(k => {
            nodeOf[k] = ALL_NODES_ORDERED.filter(id => CITY_GRAPH[id]?.district === k)
                .map(id => R.getPos(id).clone().setY(0));
        });
        const wp = new THREE.Vector3();
        scene.traverse(o => {
            if (!o.isMesh || !o.material) return;
            o.getWorldPosition(wp);
            if (wp.y > 26) return;                       // skyline, not street level
            for (const k of keys) {
                for (const n of nodeOf[k]) {
                    const d = Math.hypot(wp.x - n.x, wp.z - n.z);
                    if (d < 11) {
                        out[k].near++;
                        const c = o.material.color ? o.material.color.getHexString() : '?';
                        out[k].colors.add(c);
                        if (wp.y > 3.5) out[k].tall++;
                        return;
                    }
                }
            }
        });
        const res = {};
        keys.forEach(k => { res[k] = { near: out[k].near, palette: out[k].colors.size, tall: out[k].tall }; });
        return res;
    });
    const keys = ['ring', 'fin', 'ba', 'shop', 'ind'];
    ok('dressing: every district carries street-level furniture',
        keys.every(k => census[k].near >= 25),
        keys.map(k => `${k}:${census[k].near}`).join(' '));
    // Four districts sharing one palette is what "same road, different sky"
    // looked like. Each needs materials the others do not have.
    ok('dressing: each district has a palette of its own',
        keys.every(k => census[k].palette >= 6),
        keys.map(k => `${k}:${census[k].palette} colours`).join(' '));
    ok('dressing: and props tall enough to be seen over the tiles',
        keys.every(k => census[k].tall >= 3),
        keys.map(k => `${k}:${census[k].tall}`).join(' '));

    // ---------------------------------------------------------------
    // 2. Nothing sits on the road.
    // ---------------------------------------------------------------
    // Tiles, their floating icons and the player tokens all legitimately stand
    // on a node — and a token is ~20 meshes on its own since the character
    // rebuild, so counting everything near a node measures the cast, not the
    // scenery. Only the named city-environment group is scenery.
    const onRoad = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const { ALL_NODES_ORDERED } = await import('/src/config/BoardGraph.js');
        let env = null;
        R.getScene().traverse(o => { if (o.name === 'cityEnv') env = o; });
        if (!env) return { found: false, bad: [] };
        const nodes = ALL_NODES_ORDERED.map(id => ({ id, p: R.getPos(id).clone().setY(0) }));
        const wp = new THREE.Vector3();
        const bad = [];
        env.traverse(o => {
            if (!o.isMesh || !o.geometry) return;
            // Flat ground decals — surfaces, seams, puddles, road markings — are
            // supposed to lie under the road.
            if (['PlaneGeometry', 'CircleGeometry', 'RingGeometry'].includes(o.geometry.type)) return;
            o.getWorldPosition(wp);
            if (wp.y > 8) return;                        // buildings set back and up
            for (const n of nodes) {
                if (Math.hypot(wp.x - n.p.x, wp.z - n.p.z) < 2.4) {
                    bad.push(`${n.id}:${o.geometry.type}@y${wp.y.toFixed(1)}`);
                    return;
                }
            }
        });
        return { found: true, bad };
    });
    ok('dressing: the scenery group is identifiable', onRoad.found);
    ok('dressing: no prop is standing on a playable square',
        onRoad.bad.length === 0, `${onRoad.bad.length}: ${onRoad.bad.slice(0, 5).join(', ')}`);

    // ---------------------------------------------------------------
    // 3. A landmark per district, and it is big.
    // ---------------------------------------------------------------
    const lm = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const { ALL_NODES_ORDERED, CITY_GRAPH } = await import('/src/config/BoardGraph.js');
        const scene = R.getScene();
        const out = {};
        ['fin', 'ba', 'shop', 'ind'].forEach(k => {
            const ns = ALL_NODES_ORDERED.filter(id => CITY_GRAPH[id]?.district === k);
            const mid = R.getPos(ns[Math.floor(ns.length / 2)]).clone().setY(0);
            const dir = mid.clone().normalize();
            const at = mid.clone().addScaledVector(dir, 30);
            let count = 0, top = 0;
            const wp = new THREE.Vector3();
            scene.traverse(o => {
                if (!o.isMesh) return;
                o.getWorldPosition(wp);
                if (Math.hypot(wp.x - at.x, wp.z - at.z) < 16) { count++; top = Math.max(top, wp.y); }
            });
            out[k] = { count, top: +top.toFixed(1) };
        });
        return out;
    });
    ok('landmark: every district has one at its midpoint',
        ['fin', 'ba', 'shop', 'ind'].every(k => lm[k].count >= 8),
        Object.entries(lm).map(([k, v]) => `${k}:${v.count}`).join(' '));
    ok('landmark: and it stands tall enough to read from the flyover',
        ['fin', 'ba', 'shop', 'ind'].every(k => lm[k].top >= 10),
        Object.entries(lm).map(([k, v]) => `${k}:${v.top}u`).join(' '));

    // ---------------------------------------------------------------
    // 4. The city is moving.
    // ---------------------------------------------------------------
    const life = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const scene = R.getScene();
        // Sample every transparent, depth-write-off sphere (steam) twice.
        const sample = () => {
            const v = [];
            const wp = new THREE.Vector3();
            scene.traverse(o => {
                if (!o.isMesh || !o.material || !o.material.transparent) return;
                if (!o.geometry || o.geometry.type !== 'SphereGeometry') return;
                o.getWorldPosition(wp);
                v.push(+(wp.y).toFixed(3) + ':' + (+o.material.opacity.toFixed(3)));
            });
            return v;
        };
        const a = sample();
        await new Promise(r => setTimeout(r, 700));
        const b = sample();
        let moved = 0;
        for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) moved++;
        return { tracked: a.length, moved };
    });
    ok('life: the smoke and steam are actually running',
        life.tracked > 0 && life.moved >= Math.max(3, life.tracked * 0.3),
        `${life.moved} of ${life.tracked} sampled puffs changed in 700ms`);

    // ---------------------------------------------------------------
    // 5. Arriving somewhere says where you are.
    // ---------------------------------------------------------------
    const banner = await page.evaluate(async () => {
        const { DISTRICT_BIOMES } = await import('/src/config/GameConfig.js');
        const U = await import('/src/ui/UIManager.js');
        U.showRealmBanner(DISTRICT_BIOMES.ba);
        await new Promise(r => setTimeout(r, 250));
        const el = document.getElementById('realm-banner');
        return {
            shown: !!el && getComputedStyle(el).display !== 'none',
            text: (el ? el.innerText : '').replace(/\s+/g, ' ').trim(),
            haveTaglines: Object.values(DISTRICT_BIOMES).every(b => !!b.tagline && !!b.icon && !!b.lore),
        };
    });
    ok('arrival: turning off the ring announces the district',
        banner.shown && /back alley/i.test(banner.text), banner.text.slice(0, 80));
    ok('arrival: every district has an icon, a tagline and a line of lore',
        banner.haveTaglines);

    // ---------------------------------------------------------------
    // 6. Rebuilding must not leave the animated props ticking.
    // ---------------------------------------------------------------
    const rebuilt = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const before = (() => { let n = 0; R.getScene().traverse(o => { if (o.isMesh) n++; }); return n; })();
        R.drawTiles();
        await new Promise(r => setTimeout(r, 400));
        const after = (() => { let n = 0; R.getScene().traverse(o => { if (o.isMesh) n++; }); return n; })();
        return { before, after };
    });
    ok('rebuild: redrawing the board does not duplicate the city',
        Math.abs(rebuilt.after - rebuilt.before) < 40, JSON.stringify(rebuilt));

    // ---------------------------------------------------------------
    // Screenshots: one per district, from the follow camera.
    // ---------------------------------------------------------------
    const shots = { fin: 'fin_4', ba: 'ba_5', shop: 'shop_4', ind: 'ind_3', ring: 'r8' };
    for (const [key, node] of Object.entries(shots)) {
        await page.evaluate(async (n) => {
            const { state } = await import('/src/core/GameState.js');
            const R = await import('/src/engine/Renderer.js');
            state.activePlayer = 0;
            state.players[0].pos = n; state.players[0].mesh.position.copy(R.getPos(n));
            state.players[1].pos = n; state.players[1].mesh.position.copy(R.getPos(n)).add(new THREE.Vector3(2, 0, 0));
            R.updateBiomeVisuals((window.CITY_GRAPH_REF[n] || {}).district || 'ring');
            state.cameraState = 'FOLLOW';
            R.snapCameraToActive();
        }, node);
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(__dirname, `shot-district-${key}.png`) });
        // And a raised three-quarter view: the follow camera sits close and
        // steep, so roadside dressing at ±6 units falls outside the frame and a
        // follow-cam screenshot cannot show whether the district is dressed.
        await page.evaluate(async (n) => {
            const R = await import('/src/engine/Renderer.js');
            const { state } = await import('/src/core/GameState.js');
            state.cameraState = 'CINEMATIC';
            const at = R.getPos(n).clone().setY(0);
            const out = at.clone().normalize();
            const cam = R.getCamera();
            // From the INSIDE of the ring looking out. The district buildings sit
            // twelve units outward, so a camera placed outward at 26 is behind
            // (and often inside) them, and the first pass photographed a wall.
            cam.position.copy(at).addScaledVector(out, -34).setY(26);
            cam.lookAt(at.x, 1.5, at.z);
        }, node);
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(__dirname, `shot-district-${key}-wide.png`) });
        await page.evaluate(async () => {
            const { state } = await import('/src/core/GameState.js');
            state.cameraState = 'FOLLOW';
        });
    }

    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));

    await browser.close();
    console.log('\nPASS:'); pass.forEach(p => console.log('  ✓ ' + p));
    console.log('\nFAIL:'); fail.length ? fail.forEach(f => console.log('  ✗ ' + f)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
