// ============================================================
// STRUCTURE CLOSE-UPS: gate, shop stall, HQ pavilion and a token
//
// Boots a map and takes a top-down overview plus a couple of oblique angles,
// so the shape of the board can be judged by looking at it rather than by
// reading the layout table. Writes qa/shot-map-<id>-<view>.png.
//
// usage: node structshots.js  -> qa/shot-struct-<name>.png
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];


(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 900, height: 700 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
        try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {}
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.startRun({ mode: 'pass', map: 'city_circuit', rounds: 6 }));
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
        await page.evaluate(() => {
            const go = document.getElementById('btn-cb-start');
            const ov = document.getElementById('city-briefing');
            if (go && ov && getComputedStyle(ov).display !== 'none' && !go.disabled) go.click();
        }).catch(() => {});
        const gs = await page.evaluate(() => window.__QA.snapshot().gameState);
        if (gs && gs !== 'INIT') break;
        await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
        ['ui-layer', 'turn-banner', 'net-waiting', 'toast-box', 'roll-callout']
            .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    });
    const targets = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const out = [];
        for (const t of ['_gate', '_shop', '_hq']) {
            const g = R.getTileMeshes().find(m => m.userData && m.userData.type === t);
            if (!g) { out.push({ name: t, missing: true }); continue; }
            const b = new THREE.Box3().setFromObject(g), c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
            out.push({ name: t, c: [c.x, c.y, c.z], r: Math.max(sz.x, sz.z, sz.y) });
        }
        return out;
    });
    console.log(JSON.stringify(targets));
    for (const t of targets) {
        if (t.missing) continue;
        for (const [vn, dx, dy, dz] of [['a', 1, .7, 1.4], ['b', -1.4, .5, -.8]]) {
            await page.evaluate(async ({ t, dx, dy, dz }) => {
                const R = await import('/src/engine/Renderer.js');
                const S = (await import('/src/core/GameState.js')).state;
                S.cameraState = 'MINIGAME';
                const k = Math.max(t.r * 1.6, 6), cam = R.getCamera();
                cam.position.set(t.c[0] + dx * k, t.c[1] + dy * k + 2, t.c[2] + dz * k);
                cam.lookAt(t.c[0], t.c[1], t.c[2]);
            }, { t, dx, dy, dz });
            await page.waitForTimeout(900);
            await page.screenshot({ path: path.join(__dirname, `shot-struct-${t.name.slice(1)}-${vn}.png`) });
        }
    }
    // A token with its base and turn ring.
    const tok = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const S = (await import('/src/core/GameState.js')).state;
        const v = R.getPos(S.players[S.activePlayer].pos);
        return v ? [v.x, v.y, v.z] : null;
    });
    if (tok) {
        await page.evaluate(async c => {
            const R = await import('/src/engine/Renderer.js');
            const S = (await import('/src/core/GameState.js')).state;
            S.cameraState = 'MINIGAME';
            const cam = R.getCamera();
            cam.position.set(c[0] + 5, c[1] + 4, c[2] + 6); cam.lookAt(c[0], c[1] + 1, c[2]);
        }, tok);
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(__dirname, 'shot-struct-token.png') });
    }
    console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
    await browser.close();
})();
