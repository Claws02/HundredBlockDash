// ============================================================
// The map, from Player 2's end of the table.
//
// In tabletop mode on P2's turn the board canvas is turned a half turn by CSS so
// P2 reads it the right way up. The canvas pixels move; the pointer coordinates
// do not — so anything converting a touch into a position ON the board has to
// undo that rotation first. It did not, which meant P2's drag pushed the board
// the wrong way and tapping a tile hit the one diagonally opposite, or nothing.
//
// `qa/mapinfo.js` never caught it because it only ever plays P1.
//
// This taps a KNOWN tile from both ends and checks the tooltip names the tile
// that was actually touched.
//
// usage: node mapp2.js
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
    await page.evaluate(() => window.__QA.startRun({ mode: 'tabletop', map: 'hundred_block_dash', len: 50 }));
    for (let i = 0; i < 260; i++) {
        const r = await page.evaluate(async () => {
            const { state } = await import('/src/core/GameState.js');
            return state.gameState === 'PRE_ROLL';
        });
        if (r) break;
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(200);
    }

    // Put a known space on the board and park the player next to it.
    await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        state.board[16] = { type: 'lose_big' };
        state.board[12] = { type: 'coin_big' };
    });

    // Frame one block, then touch a point OFF the centre of the screen and see
    // which block the tooltip names.
    //
    // The invariant this tests needs no knowledge of where any tile is: framing
    // centres the camera, and P2's view is that same picture turned a half turn,
    // so the block P1 sees at (cx+dx, cy+dy) is the block P2 sees at
    // (cx-dx, cy-dy). Touch those two points and both must name the SAME block.
    //
    // Tapping the framed block itself proves nothing, which is how the first cut
    // of this probe passed against the bug: a half turn about the screen centre
    // leaves the centre exactly where it was.
    async function frame(pid, addr) {
        await page.evaluate(async ({ pid }) => {
            const { state } = await import('/src/core/GameState.js');
            const R = await import('/src/engine/Renderer.js');
            const U = await import('/src/ui/UIManager.js');
            state.activePlayer = pid;
            state.players[pid].isBot = false;
            const p = state.players[pid];
            p.pos = 10; p.prevPos = 10;
            if (p.mesh) p.mesh.position.copy(R.getPos(10));
            document.body.classList.toggle('tabletop-p2-turn', pid === 1);
            state.gameState = 'PRE_ROLL';
            U.updateUI();
            U.openMap();
        }, { pid });
        await page.waitForTimeout(600);
        await page.evaluate(async (a) => {
            const U = await import('/src/ui/UIManager.js');
            document.getElementById('map-slider').value = a;
            U.updateMapSlider();
        }, addr);
        // The map camera eases toward its target, so a touch taken while it is
        // still moving lands on where the board WAS.
        let prev = null;
        for (let i = 0; i < 40; i++) {
            const c = await page.evaluate(async () => {
                const q = (await import('/src/engine/Renderer.js')).getCamera().position;
                return [q.x, q.y, q.z];
            });
            if (prev && Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2]) < 0.02) break;
            prev = c;
            await page.waitForTimeout(120);
        }
    }

    async function touch(x, y) {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(320);
        return page.evaluate(() => {
            const tt = document.getElementById('map-tooltip');
            const st = getComputedStyle(tt);
            const txt = tt.innerText.replace(/\n/g, ' | ');
            const m = txt.match(/Block (\d+)/);
            // The tooltip keeps its text when hidden, so a missed touch would
            // otherwise report the block from the PREVIOUS one. Only a visible
            // tooltip has anything to say.
            const shown = st.display !== 'none';
            return { shown, block: shown && m ? parseInt(m[1]) : null,
                     text: shown ? txt : '', transform: st.transform };
        });
    }

    // At the map's zoom the framed block fills much of the view and little else
    // is on screen, so the realistic touch is ON that block but not dead centre —
    // which is exactly what a finger does. That offset is what makes the test
    // meaningful: a half turn leaves the centre alone but throws a 45px offset
    // 90px the other way, off the block entirely. It is also almost certainly
    // what the bug felt like in the hand — "I cannot select the board spaces".
    await frame(0, 16);
    const centre = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const m = R.getTileMeshes().find(t => {
            const d = t.userData || {};
            return (d.nodeId !== undefined ? d.nodeId : d.idx) === 16;
        });
        if (!m) return null;
        const v = m.position.clone().project(R.getCamera());
        return { x: (v.x * 0.5 + 0.5) * window.innerWidth,
                 y: (-v.y * 0.5 + 0.5) * window.innerHeight };
    });
    ok('setup: block 16 is on screen for P1', !!centre,
       centre ? `${centre.x.toFixed(0)},${centre.y.toFixed(0)}` : 'not found');

    // The biggest offset from the block's centre that still lands on it.
    let best = null, a = { shown: false, block: null };
    for (const d of [60, 45, 30, 18]) {
        if (!centre) break;
        const r = await touch(centre.x, centre.y + d);
        if (r.shown && r.block === 16) { best = d; a = r; break; }
    }
    ok('P1: touching the block off its centre still selects it',
       a.shown && a.block === 16, `offset ${best}px → block ${a.block}`);

    // ── P2: the mirrored point must select the same block ───────────────────
    await page.evaluate(async () => (await import('/src/ui/UIManager.js')).closeMap());
    await page.waitForTimeout(300);
    await frame(1, 16);
    const b = best
        ? await touch(412 - centre.x, 892 - (centre.y + best))
        : { shown: false, block: null, text: '', transform: '' };
    ok('P2: the mirrored point selects a block at all', b.shown && b.block !== null,
       `block ${b.block}`);
    ok('P2: and it is the SAME block, not one thrown across the board',
       b.block === 16, `P1 saw block ${a.block}, P2 saw block ${b.block}`);
    ok('P2: the tooltip is turned to face them AND keeps its offset',
       /matrix\(-1/.test(b.transform || '') && !/matrix\(-1, 0, 0, -1, 0, 0\)$/.test(b.transform || ''),
       b.transform);
    await page.screenshot({ path: path.join(__dirname, 'shot-map-p2.png') });

    // ── Dragging the board must follow the finger from either end ───────────
    async function dragDelta(pid) {
        await page.evaluate(async ({ pid }) => {
            const { state } = await import('/src/core/GameState.js');
            const U = await import('/src/ui/UIManager.js');
            state.activePlayer = pid;
            document.body.classList.toggle('tabletop-p2-turn', pid === 1);
            state.gameState = 'PRE_ROLL';
            U.openMap();
        }, { pid });
        await page.waitForTimeout(700);
        const before = await page.evaluate(async () =>
            (await import('/src/engine/Renderer.js')).getCamera().position.z);
        // Drag "up the board" as this player sees it: screen-up for P1,
        // screen-down for P2, since their view is turned around.
        const dir = pid === 0 ? -1 : 1;
        await page.mouse.move(206, 446);
        await page.mouse.down();
        await page.mouse.move(206, 446 + dir * 120, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(900);
        const after = await page.evaluate(async () =>
            (await import('/src/engine/Renderer.js')).getCamera().position.z);
        return after - before;
    }
    await page.evaluate(async () => (await import('/src/ui/UIManager.js')).closeMap());
    await page.waitForTimeout(300);
    const d1 = await dragDelta(0);
    await page.evaluate(async () => (await import('/src/ui/UIManager.js')).closeMap());
    await page.waitForTimeout(300);
    const d2 = await dragDelta(1);
    ok('drag: both players push the board the same way relative to themselves',
       Math.abs(d1) > 1 && Math.abs(d2) > 1 && Math.sign(d1) === Math.sign(d2),
       `P1 ${d1.toFixed(1)} · P2 ${d2.toFixed(1)}`);

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-mapp2.json'),
        JSON.stringify({ pass, fail, centre, best, a, b, d1, d2, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
