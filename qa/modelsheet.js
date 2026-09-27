// ============================================================
// MODEL SHEET — every plot building on its own, and each district in play
//
// For reviewing model upgrades side by side. Boots a City Circuit match, then:
//
//   1. hides everything but the lights and renders each plot building alone
//      on a plain floor: three seeded variants and the HQ, from a three-
//      quarter view, plus a low side view and a high view of the first variant
//   2. renders each district from a street-level camera with the whole city
//      showing, the way a player sees it
//
// It records each model's mesh count, material count and triangles, and the
// draw calls for each district view. Images go to qa/sheet/<TAG>/ as JPEGs,
// with a manifest.json beside them. Run it against two builds (QA_BASE) and
// compare the two folders.
//
// usage: TAG=new node qa/modelsheet.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const TAG = process.env.TAG || 'current';
const OUT = path.join(__dirname, 'sheet', TAG);

// Plot positions chosen so each variant is a different seed of its builder
// (the builders derive height, width and options from the position).
const TYPES = [
    { key: 'fin',  name: 'Financial tower',     xs: [8, 3, 1] },
    { key: 'ba',   name: 'Back Alley walk-up',  xs: [1, 2, 3] },
    { key: 'shop', name: 'Promenade shopfront', xs: [1, 2, 3] },
    { key: 'ind',  name: 'Industrial works',    xs: [1, 2, 3] },
    { key: 'ring', name: 'Ring Road civic hall', xs: [1, 3, 5], noHQ: true },
];

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const ctx = await browser.newContext({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', rounds: 6 }));
    const t0 = Date.now();
    while (Date.now() - t0 < 600000) {
        const st = await page.evaluate(async () => {
            (await import('/src/engine/Renderer.js')).skipFlyover();
            for (const id of ['btn-msg-continue', 'btn-cb-start']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); }
            const m = document.querySelector('#modal-overlay button'); if (m && m.offsetParent) m.click();
            return window.__QA.snapshot().gameState;
        }).catch(() => '');
        if (st === 'PRE_ROLL') break;
        await page.waitForTimeout(700);
    }
    await page.waitForTimeout(3000);
    // Stop the board loop drawing over our renders.
    await page.evaluate(async () => { (await import('/src/engine/Renderer.js')).setBoardPaused(true); });

    const save = (name, dataUrl) => fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
    const manifest = { tag: TAG, types: [], districts: [], errors };

    // ---- 1. Districts in play (whole city visible) ----
    for (const key of ['fin', 'ba', 'shop', 'ind', 'ring']) {
        const r = await page.evaluate(async key => {
            const R = await import('/src/engine/Renderer.js');
            const AM = await import('/src/config/ActiveMap.js');
            const ids = AM.ordered().filter(id => AM.graph()[id]?.district === key);
            const id = ids[Math.floor(ids.length / 2)];
            const p = R.getPos(id);
            const out = new THREE.Vector3(p.x, 0, p.z).normalize();
            const side = new THREE.Vector3(-out.z, 0, out.x);
            // Street level, down the road, facing the plots: outward for the
            // districts, inward (towards the park) for the ring.
            const face = key === 'ring' ? out.clone().negate() : out;
            const cam = new THREE.Vector3(p.x, 0, p.z).addScaledVector(face, -14).addScaledVector(side, 16).setY(11);
            const look = new THREE.Vector3(p.x, 0, p.z).addScaledVector(face, 9).addScaledVector(side, -6).setY(4);
            // The in-game sky is a CSS gradient behind a transparent canvas;
            // paint the district's own gradient in so the capture matches.
            const { DISTRICT_BIOMES } = await import('/src/config/GameConfig.js');
            const B = DISTRICT_BIOMES[key];
            const sc = R.getScene(), prevBg = sc.background;
            const cv = document.createElement('canvas'); cv.width = 2; cv.height = 256;
            const g2 = cv.getContext('2d'), gr = g2.createLinearGradient(0, 0, 0, 256);
            gr.addColorStop(0, B.bgTop); gr.addColorStop(0.58, B.bgBot); gr.addColorStop(1, B.fog);
            g2.fillStyle = gr; g2.fillRect(0, 0, 2, 256);
            sc.background = new THREE.CanvasTexture(cv);
            const info = R.qaRenderFrom([cam.x, cam.y, cam.z], [look.x, look.y, look.z]);
            sc.background = prevBg;
            const url = document.querySelector('#game-container canvas').toDataURL('image/jpeg', 0.86);
            return { info, url };
        }, key);
        save(`district-${key}.jpg`, r.url);
        manifest.districts.push({ key, calls: r.info.calls, triangles: r.info.triangles, img: `district-${key}.jpg` });
    }

    // ---- 2. Each model alone ----
    await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const sc = R.getScene();
        window.__SHEET = { hidden: [] };
        sc.children.forEach(o => { if (!o.isLight && o.visible) { o.visible = false; window.__SHEET.hidden.push(o); } });
        window.__SHEET.fog = sc.fog; sc.fog = null;
        window.__SHEET.bg = sc.background; sc.background = new THREE.Color(0xc9d6e3);
        const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.95 }));
        floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.receiveShadow = true;
        sc.add(floor);
        window.__SHEET.floor = floor;
    });
    for (const T of TYPES) {
        const entry = { key: T.key, name: T.name, variants: [] };
        const variants = T.xs.map(x => ({ x, hq: false })).concat(T.noHQ ? [] : [{ x: 2, hq: true }]);
        for (let vi = 0; vi < variants.length; vi++) {
            const v = variants[vi];
            const views = vi === 0 ? ['three', 'side', 'high'] : ['three'];
            const r = await page.evaluate(async ({ key, v, views }) => {
                const R = await import('/src/engine/Renderer.js');
                const sc = R.getScene();
                const b = R.qaPlotBuilding(key, v.hq, v.x, 0);
                if (!b) return null;
                b.position.set(0, 0, 0);
                sc.add(b); sc.updateMatrixWorld(true);
                let meshes = 0, tris = 0; const mats = new Set();
                b.traverse(o => {
                    if (!o.isMesh) return; meshes++;
                    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m));
                    const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
                });
                const box = new THREE.Box3().setFromObject(b), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
                const rad = Math.max(size.x, size.y, size.z) * 0.5;
                const pose = {
                    three: [ 0.62, 0.30, 0.78],
                    side:  [-0.95, 0.10, 0.45],
                    high:  [ 0.35, 0.95, 0.60],
                };
                const shots = {};
                for (const name of views) {
                    const d = new THREE.Vector3(...pose[name]).normalize().multiplyScalar(rad * 3.1);
                    R.qaRenderFrom([c.x + d.x, c.y + d.y, c.z + d.z], [c.x, c.y, c.z]);
                    shots[name] = document.querySelector('#game-container canvas').toDataURL('image/jpeg', 0.86);
                }
                sc.remove(b);
                return { meshes, materials: mats.size, tris: Math.round(tris), size: [size.x, size.y, size.z].map(n => +n.toFixed(1)), shots };
            }, { key: T.key, v, views });
            if (!r) continue;
            const imgs = {};
            for (const [name, url] of Object.entries(r.shots)) {
                const f = `${T.key}-${v.hq ? 'hq' : 'v' + vi}-${name}.jpg`;
                save(f, url); imgs[name] = f;
            }
            entry.variants.push({ hq: v.hq, x: v.x, meshes: r.meshes, materials: r.materials, tris: r.tris, size: r.size, imgs });
        }
        manifest.types.push(entry);
        console.log(T.key, entry.variants.map(v => `${v.hq ? 'HQ' : 'v'} ${v.meshes}m/${v.materials}mat/${v.tris}t`).join('  '));
    }
    manifest.districts.forEach(d => console.log('district', d.key, 'calls', d.calls, 'tris', d.triangles));
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
    console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
    await browser.close();
})();
