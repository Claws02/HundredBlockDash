// ============================================================
// WHAT THE HOST PAYS, AND WHAT THE BOARD DRAWS WHILE NOBODY IS LOOKING
//
// Two measurements that do not depend on the GL backend, so they mean the same
// thing here as on a phone:
//
//   1. NetSync's host loop runs snapshot() + signature() 20 times a second.
//      snapshot() calls getComputedStyle() on seven elements, which forces a
//      style resolution — 140 of them per second. This times one full
//      sample so the per-second cost is a number rather than an opinion.
//
//   2. The board's requestAnimationFrame loop has no pause. A full-screen
//      minigame runs its own canvas and its own rAF on top of a 3D board that
//      is still being drawn underneath it. This counts renderer draw calls
//      while a minigame is up: zero would mean the board stands down, anything
//      else is two renderers on one phone.
//
// usage: node hostcost.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR:', e.message));
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto','true'); } catch(e){} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    // Boot a plain 1P City match so there is a real board and real players.
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', rounds: 6 }));
    await page.waitForFunction(async () =>
        (await import('/src/core/GameState.js')).state.gameStarted, null, { timeout: 240000 });
    await page.waitForTimeout(4000);

    // ---- 1. the price of one host tick -------------------------------------
    const cost = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const P = await import('/src/net/NetProtocol.js');
        const N = 300;
        // warm
        for (let i = 0; i < 20; i++) P.signature(P.snapshot(state));
        const t0 = performance.now();
        for (let i = 0; i < N; i++) { const s = P.snapshot(state); P.signature(s); }
        const t1 = performance.now();
        const snap = P.snapshot(state);
        return {
            perTickMs: (t1 - t0) / N,
            snapshotBytes: JSON.stringify(snap).length,
            boardEntries: Object.keys(snap.board).length,
            totalBoardNodes: Object.keys(state.board).length,
        };
    });
    console.log('host tick        :', cost.perTickMs.toFixed(3), 'ms');
    console.log('at 20 Hz         :', (cost.perTickMs * 20).toFixed(1), 'ms of CPU per second');
    console.log('snapshot size    :', cost.snapshotBytes, 'bytes');
    console.log('board rows sent  :', cost.boardEntries, 'of', cost.totalBoardNodes, 'nodes on the board');

    // ---- 2. is the board's render loop aware of anything on top of it? -----
    //
    // Renderer._loop() has no early return and calls renderer.render() every
    // frame. This does not try to drive a real minigame — it asks the narrower
    // question the code implies: does putting a full-screen layer over the
    // board change how often the board is drawn? The layer is raised directly,
    // so the only thing under test is the loop.
    const drawn = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const scene = R.getScene();
        let frames = 0;
        scene.onAfterRender = () => { frames++; };
        const count = async ms => { const a = frames; await new Promise(r => setTimeout(r, ms)); return frames - a; };

        await count(500);                       // settle
        const clear = await count(3000);

        const layer = document.getElementById('minigame-layer');
        const prev = layer.style.display;
        layer.style.display = 'flex';           // a full-screen layer, exactly as a minigame raises it
        const covered = await count(3000);
        layer.style.display = prev;

        scene.onAfterRender = null;
        return { clear, covered };
    });
    console.log('board frames / 3s, nothing over it :', drawn.clear);
    console.log('board frames / 3s, fully covered   :', drawn.covered);
    console.log('the loop stands down when covered  :', drawn.covered === 0);

    await browser.close();
})();
