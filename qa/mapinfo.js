// ============================================================
// Map view: does scouting a space tell you anything useful?
//
// The tooltip used to give a name and a block number. It must now also say what
// the space DOES and how far away it is — on both boards, with the City count
// following the lap order rather than the raw index.
//
// usage: node mapinfo.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

async function boot(page, map) {
    const cfg = map === 'city_circuit'
        ? { mode: '1p', difficulty: 'medium', map: 'city_circuit' }
        : { mode: '1p', difficulty: 'medium', map: 'hundred_block_dash', len: 50 };
    await page.evaluate(c => window.__QA.startRun(c), cfg);
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
        const r = await page.evaluate(async () => {
            const { state } = await import('/src/core/GameState.js');
            return state.gameState === 'PRE_ROLL' && !state.players[state.activePlayer].isBot;
        });
        if (r) return true;
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(250);
    }
    return false;
}

// Open the map and read the tooltip for one board address, by calling the same
// code path the tap handler uses.
async function scout(page, addr) {
    // Frame the tile first. The map camera stays on the player, so a block a
    // dozen spaces away simply isn't on screen and the raycast hits nothing —
    // which is exactly what a player does with the slider before tapping.
    await page.evaluate(async (addr) => {
        const U = await import('/src/ui/UIManager.js');
        const slider = document.getElementById('map-slider');
        const ALL_NODES_ORDERED = (await import('/src/config/ActiveMap.js')).ordered();
        const idx = typeof addr === 'number' ? addr : ALL_NODES_ORDERED.indexOf(addr);
        slider.value = idx;
        U.updateMapSlider();
    }, addr);
    await page.waitForTimeout(900);
    return page.evaluate(async (addr) => {
        const U = await import('/src/ui/UIManager.js');
        const { state } = await import('/src/core/GameState.js');
        const R = await import('/src/engine/Renderer.js');
        // Find the tile mesh for this address and synthesise a tap on it.
        const meshes = R.getTileMeshes();
        const target = meshes.find(m => {
            const d = m.userData || {};
            return (d.nodeId !== undefined ? d.nodeId : d.idx) === addr;
        });
        if (!target) return { err: 'no tile mesh for ' + addr };
        // Project the tile to screen space and dispatch a real tap there.
        const cam = R.getCamera();
        const v = target.position.clone().project(cam);
        const x = (v.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
        // Dispatch on an Element so the handler sees a real event target; the
        // listener lives on window and the event bubbles there anyway.
        const host = document.getElementById('game-container') || document.body;
        host.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
        host.dispatchEvent(new PointerEvent('pointerup',   { clientX: x, clientY: y, bubbles: true }));
        const tt = document.getElementById('map-tooltip');
        return {
            shown: getComputedStyle(tt).display !== 'none',
            text: tt.innerText.replace(/\n/g, ' | '),
            effect: (tt.querySelector('.map-effect') || {}).innerText || '',
            range: (tt.querySelector('.map-range') || {}).innerText || '',
            you: state.players[state.activePlayer].pos,
        };
    }, addr);
}

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    // ══════════════ HBD ══════════════
    ok('boot: HBD match at the roll', await boot(page, 'hundred_block_dash'));
    // Park the player somewhere known so the distances are predictable.
    await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const R = await import('/src/engine/Renderer.js');
        state.activePlayer = 0;
        const p = state.players[0];
        p.pos = 10; p.prevPos = 10;
        if (p.mesh) p.mesh.position.copy(R.getPos(10));
        // Known space types to scout.
        state.board[14] = { type: 'lose' };
        state.board[22] = { type: 'swap_space' };
        state.board[4]  = { type: 'coin_big' };
    });
    await page.evaluate(async () => (await import('/src/ui/UIManager.js')).openMap());
    await page.waitForTimeout(900);

    const ahead4 = await scout(page, 14);
    ok('HBD: the tooltip says what the space does',
       !!ahead4.effect && ahead4.effect.length > 6, `"${ahead4.effect}"`);
    ok('HBD: the tooltip says how far ahead it is',
       /4 spaces ahead/.test(ahead4.range), `"${ahead4.range}"`);
    ok('HBD: a space inside one roll is flagged as reachable',
       /reachable with a 4/.test(ahead4.range), `"${ahead4.range}"`);
    await page.screenshot({ path: path.join(__dirname, 'shot-map-hbd.png') });

    const far = await scout(page, 22);
    ok('HBD: a space beyond one roll is not flagged reachable',
       /12 spaces ahead/.test(far.range) && !/reachable/.test(far.range), `"${far.range}"`);
    ok('HBD: swap zone explains itself', /swap|position/i.test(far.effect), `"${far.effect}"`);

    const behind = await scout(page, 4);
    ok('HBD: a space behind you reads as behind',
       /6 spaces behind/.test(behind.range), `"${behind.range}"`);

    const here = await scout(page, 10);
    ok('HBD: your own space says so', /standing here/i.test(here.range), `"${here.range}"`);

    // The Crown must now be named, not reported as a second START.
    const crown = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const fin = state.hbd.finish;
        return { type: state.board[fin].type, fin };
    });
    ok('board: the finish is its own space type, not a second START',
       crown.type === 'finish', `board[${crown.fin}].type = ${crown.type}`);

    // ══════════════ City Circuit ══════════════
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());
    ok('boot: City match at the roll', await boot(page, 'city_circuit'));

    const city = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const ALL_NODES_ORDERED = (await import('/src/config/ActiveMap.js')).ordered();
        const R = await import('/src/engine/Renderer.js');
        state.activePlayer = 0;
        const p = state.players[0];
        p.pos = ALL_NODES_ORDERED[20]; p.prevPos = p.pos;
        if (p.mesh) p.mesh.position.copy(R.getPos(p.pos));
        return { at: ALL_NODES_ORDERED[20], ahead: ALL_NODES_ORDERED[25], behind: ALL_NODES_ORDERED[10],
                 total: ALL_NODES_ORDERED.length };
    });
    await page.evaluate(async () => (await import('/src/ui/UIManager.js')).openMap());
    await page.waitForTimeout(900);

    const cAhead = await scout(page, city.ahead);
    ok('City: distance counts along the lap', /5 spaces ahead/.test(cAhead.range), `"${cAhead.range}"`);
    ok('City: the tooltip says what the space does', !!cAhead.effect, `"${cAhead.effect}"`);

    // A node 10 behind on a 60-node ring is 50 ahead — that's the number that
    // matters, because it's how far you actually have to travel.
    const cBehind = await scout(page, city.behind);
    ok('City: a node behind you is reported as the distance you must travel',
       new RegExp(`${city.total - 10} spaces ahead`).test(cBehind.range), `"${cBehind.range}"`);
    await page.screenshot({ path: path.join(__dirname, 'shot-map-city.png') });

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-mapinfo.json'),
        JSON.stringify({ pass, fail, ahead4, far, behind, here, cAhead, cBehind, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
