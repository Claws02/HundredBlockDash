// ============================================================
// WHAT THE BOARD ACTUALLY LOOKS LIKE
//
// Boots a map and takes a top-down overview plus a couple of oblique angles,
// so the shape of the board can be judged by looking at it rather than by
// reading the layout table. Writes qa/shot-map-<id>-<view>.png.
//
// usage: node mapshot.js [mapId]
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];

// Camera poses worth having: straight down reads the topology, the low angles
// read as what a player actually sees.
const VIEWS = [
    { name: 'top',    pos: [0, 235, 0.1],  look: [0, 0, 0] },
    { name: 'raised', pos: [0, 120, 130],  look: [0, 0, 0] },
    { name: 'street', pos: [50, 16, 78],   look: [8, 0, 20] },
];

(async () => {
    const mapId = process.argv[2] || 'city_circuit';
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
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
    await page.evaluate(m => window.__QA.startRun({ mode: 'pass', map: m, rounds: 6 }), mapId);

    // Let the board build and the opening flyover finish.
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

    // Hide the HUD so the board is the only thing in frame.
    await page.evaluate(() => {
        ['ui-layer', 'turn-banner', 'net-waiting', 'toast-box', 'roll-callout']
            .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    });

    for (const v of VIEWS) {
        await page.evaluate(async view => {
            const R = await import('/src/engine/Renderer.js');
            const S = (await import('/src/core/GameState.js')).state;
            // Park the camera off the follow rig so it stays where it is put.
            S.cameraState = 'MINIGAME';
            const cam = R.getCamera();
            cam.position.set(view.pos[0], view.pos[1], view.pos[2]);
            cam.lookAt(view.look[0], view.look[1], view.look[2]);
        }, v);
        await page.waitForTimeout(1200);
        const out = path.join(__dirname, `shot-map-${mapId}-${v.name}.png`);
        await page.screenshot({ path: out });
        console.log('wrote', path.basename(out));
    }

    // The topology, as numbers, for reading alongside the pictures.
    const geo = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const A = await import('/src/config/ActiveMap.js');
        const pos = R.buildLayout();
        const out = {};
        pos.forEach((v, id) => { out[id] = [+v.x.toFixed(1), +v.z.toFixed(1)]; });
        return { nodes: out, ordered: A.ordered().length };
    });
    fs.writeFileSync(path.join(__dirname, `result-map-${mapId}.json`), JSON.stringify(geo, null, 1));
    console.log('nodes:', Object.keys(geo.nodes).length, 'ordered:', geo.ordered);
    console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');

    await browser.close();
})();
