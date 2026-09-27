// ============================================================
// EXPORT LAYOUT — the board as it stands, for the map editor
//
// Boots City Circuit with automatic placement (?nolayout) and writes:
//
//   src/config/layouts/city_circuit.js    every plot building, tree and
//       landmark the automatic placement puts down, as a layout. Loading
//       it rebuilds the same city.
//   tools/map-editor/ref/city_circuit.json   what the editor draws as fixed
//       reference: every space (id, position, district, type), the roads
//       as centre lines, the space radius, and the bounds of...
//       (image top is -z, right is +x; it spans -half..half on both axes)
//   tools/map-editor/ref/city_circuit-ground.jpg   ...a straight-down render
//       of the ground, roads and spaces with everything tall left out.
//
// usage: node qa/exportlayout.js [--ref-only]
//   --ref-only   refresh the editor's reference but keep the current layout
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const ROOT = path.join(__dirname, '..');
const HALF = 138;      // world units either side of the centre in the ground image
const PX = 1400;       // ground image size

(async () => {
    const refOnly = process.argv.includes('--ref-only');
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const ctx = await browser.newContext({ viewport: { width: PX, height: PX }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {} });
    await page.goto(BASE + '?nolayout', { waitUntil: 'domcontentloaded' });
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
    await page.waitForTimeout(2000);
    await page.evaluate(async () => { (await import('/src/engine/Renderer.js')).setBoardPaused(true); });

    const out = await page.evaluate(async ({ HALF }) => {
        const R = await import('/src/engine/Renderer.js');
        const AM = await import('/src/config/ActiveMap.js');
        const { state } = await import('/src/core/GameState.js');
        const sc = R.getScene();
        sc.updateMatrixWorld(true);
        const r3 = n => Math.round(n * 1000) / 1000;

        // 1. The layout: every kit-built model the automatic placement put down.
        const items = [];
        const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
        sc.traverse(o => {
            const k = o.userData && o.userData.kit;
            if (!k) return;
            o.matrixWorld.decompose(p, q, s);
            e.setFromQuaternion(q, 'YXZ');
            items.push({ model: k.model, seed: k.seed, hq: k.hq, x: r3(p.x), z: r3(p.z), rotY: r3(e.y), scale: r3(s.x) });
        });

        // 2. The fixed reference: spaces and roads.
        const g = AM.graph();
        const spaces = AM.ordered().filter(id => !AM.isJunction(id)).map(id => {
            const v = R.getPos(id);
            return { id, x: r3(v.x), z: r3(v.z), district: g[id]?.district || 'ring', type: state.board[id]?.type || '' };
        });
        const roads = AM.roads().map(rd => ({ district: rd.district,
            pts: rd.nodes.map(id => { const v = R.getPos(id); return [r3(v.x), r3(v.z)]; }) }));
        let tileR = 0;
        const box = new THREE.Box3(), size = new THREE.Vector3();
        R.getTileMeshes().slice(0, 12).forEach(m => { box.setFromObject(m).getSize(size); tileR = Math.max(tileR, Math.max(size.x, size.z) / 2); });

        // 3. The ground, straight down, with anything tall left out.
        const tokens = new Set(state.players.map(pl => pl.mesh).filter(Boolean));
        const dice = R.getDiceGroup();
        const tall = new THREE.Box3();
        const ground = R.qaRenderTopDown(HALF, o => {
            if (o.userData?.kit || tokens.has(o) || o === dice) return true;
            // Only the city's own pieces are judged by height: the containers
            // (the city group, the board's tile group) are tall only because
            // of what they hold.
            if (o.parent && o.parent.name === 'cityEnv' && (o.isMesh || o.isGroup)) {
                tall.setFromObject(o);
                return tall.max.y > 7;
            }
            return false;
        });
        return { items, ref: { map: 'city_circuit', half: HALF, spaceR: r3(tileR), spaces, roads }, ground };
    }, { HALF });

    const refDir = path.join(ROOT, 'tools/map-editor/ref');
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(refDir, 'city_circuit.json'), JSON.stringify(out.ref, null, 1));
    fs.writeFileSync(path.join(refDir, 'city_circuit-ground.jpg'), Buffer.from(out.ground.split(',')[1], 'base64'));
    console.log(`reference: ${out.ref.spaces.length} spaces, ${out.ref.roads.length} roads, space radius ${out.ref.spaceR}`);

    if (!refOnly) {
        const layout = { map: 'city_circuit', version: 1, savedAt: new Date().toISOString(),
                         note: 'Exported from the automatic plot placement', items: out.items };
        const { writeLayout } = require(path.join(ROOT, 'scripts/apply-layout.js'));
        writeLayout(layout);
        const counts = {};
        out.items.forEach(it => { counts[it.model] = (counts[it.model] || 0) + 1; });
        console.log(`layout: ${out.items.length} items`, JSON.stringify(counts));
    }
    console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
    await browser.close();
})();
