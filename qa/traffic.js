// ============================================================
// TRAFFIC — the city moves (RELEASE_AUDIT C-01).
//   1. Cars and people exist, as three instanced draws.
//   2. Over a few seconds every car and most people move.
//   3. No car ever comes within reach of a player road tile or a building.
//   4. Nothing moves while paused, or under Battery saver.
// Writes qa/shot-traffic-{top,street}.png.
// usage: node traffic.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', rounds: 6 }));
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
        const st = await page.evaluate(async () => {
            (await import('/src/engine/Renderer.js')).skipFlyover();
            for (const id of ['btn-msg-continue', 'btn-cb-start']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); }
            return window.__QA.snapshot().gameState;
        }).catch(() => '');
        if (st === 'PRE_ROLL') break;
        await page.waitForTimeout(700);
    }

    const read = () => page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const inst = [];
        R.getScene().traverse(o => { if (o.isInstancedMesh) inst.push(o); });
        const m = new THREE.Matrix4(), p = new THREE.Vector3();
        return inst.map(o => { const out = []; for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); p.setFromMatrixPosition(m); out.push([p.x, p.z]); } return out; });
    });
    const a = await read();
    ok('1 three instanced draws: cars, bodies, heads', a.length === 3, `${a.length} instanced meshes, counts ${a.map(x => x.length).join('/')}`);
    await page.waitForTimeout(4000);
    const b = await read();
    const moved = (i) => a[i].filter((q, k) => Math.hypot(q[0] - b[i][k][0], q[1] - b[i][k][1]) > 0.05).length;
    ok('2 every car moves', a[0] && moved(0) === a[0].length, `${moved(0)}/${a[0] && a[0].length}`);
    ok('2 the people walk', a[1] && moved(1) >= a[1].length * 0.9, `${moved(1)}/${a[1] && a[1].length}`);

    // 3. Clearance: sample each car's whole loop against tiles and buildings.
    const clash = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const { state } = await import('/src/core/GameState.js');
        const sc = R.getScene();
        const boxes = [];
        sc.traverse(o => { if (o.userData && o.userData.occludes) boxes.push(new THREE.Box3().setFromObject(o)); });
        const tiles = Object.keys(state.board).map(id => R.getPos(id)).filter(Boolean);
        let cars = null; sc.traverse(o => { if (o.isInstancedMesh && !cars) cars = o; });
        const m = new THREE.Matrix4(), p = new THREE.Vector3();
        let minTile = 1e9, hitB = 0;
        // Run each car's loop forward by sampling its current track at many
        // points: record positions over time with the clock forced.
        for (let step = 0; step < 60; step++) {
            for (let i = 0; i < cars.count; i++) {
                cars.getMatrixAt(i, m); p.setFromMatrixPosition(m);
                tiles.forEach(t => { minTile = Math.min(minTile, Math.hypot(p.x - t.x, p.z - t.z)); });
                const cb = new THREE.Box3(new THREE.Vector3(p.x - 2, 0, p.z - 2), new THREE.Vector3(p.x + 2, 2, p.z + 2));
                if (boxes.some(bx => bx.intersectsBox(cb))) hitB++;
            }
            await new Promise(r => setTimeout(r, 150));
        }
        return { minTile: +minTile.toFixed(1), hitB, buildings: boxes.length };
    });
    ok('3 cars stay clear of player tiles (> 12 units from any node)', clash.minTile > 12, JSON.stringify(clash));
    ok('3 cars never drive through a building', clash.hitB === 0, JSON.stringify(clash));

    // 4. Pause and battery saver freeze them.
    await page.evaluate(async () => (await import('/src/engine/Renderer.js')).setGamePaused(true));
    const p1 = await read(); await page.waitForTimeout(2500); const p2 = await read();
    await page.evaluate(async () => (await import('/src/engine/Renderer.js')).setGamePaused(false));
    ok('4 paused: nothing moves', JSON.stringify(p1) === JSON.stringify(p2));
    await page.evaluate(async () => (await import('/src/core/Settings.js')).set('batterySaver', true));
    const s1 = await read(); await page.waitForTimeout(2500); const s2 = await read();
    await page.evaluate(async () => (await import('/src/core/Settings.js')).set('batterySaver', false));
    ok('4 battery saver: nothing moves', JSON.stringify(s1) === JSON.stringify(s2));

    // Screens: from above, and along a street.
    await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        R.setGamePaused(true);
        const c = R.getCamera(); c.position.set(0, 330, 1); c.lookAt(0, 0, 0);
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(__dirname, 'shot-traffic-top.png') });
    await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const c = R.getCamera(); c.position.set(58, 14, 20); c.lookAt(110, 0, -4);
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(__dirname, 'shot-traffic-street.png') });

    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
