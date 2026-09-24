// ============================================================
// JUNCTION — the fork's choice dock and the road markers.
//   1. At every City fork the dock opens in the bottom half with a card per
//      road, clear of the top HUD; the action column steps back.
//   2. Cards run left to right as their roads leave the fork on screen, and
//      each card's arrow points the way its road goes.
//   3. Each road carries a marker on the board, in the card's colour.
//   4. A real tap on a card takes that road; a real tap on a road's marker on
//      the board takes that road too; the HUD comes back after.
//   5. Scouting the map and coming back keeps the choice open.
// Writes qa/shot-junction-*.png.
// usage: node junction.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

(async () => {
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', rounds: 6 }));
    for (let i = 0; i < 300; i++) {
        const st = await page.evaluate(async () => { (await import('/src/engine/Renderer.js')).skipFlyover(); for (const id of ['btn-msg-continue', 'btn-cb-start']) { const x = document.getElementById(id); if (x && x.offsetParent) x.click(); } return window.__QA.snapshot(); });
        if (st.gameState === 'PRE_ROLL' && st.activePlayer === 0) break;
        await page.waitForTimeout(600);
    }
    // Open a fork with the match held still (a running turn engine would end
    // the round and put a minigame intro over everything): P1 stands on the
    // space before it, and the fork is offered exactly as the turn offers it.
    const openFork = (j, from) => page.evaluate(async ([j, from]) => {
        const { state } = await import('/src/core/GameState.js');
        const R = await import('/src/engine/Renderer.js');
        const U = await import('/src/ui/UIManager.js');
        const A = await import('/src/config/ActiveMap.js');
        (await import('/src/core/Director.js')).pause();
        state.activePlayer = 0;
        const p = state.players[0]; p.isBot = false; p.pos = from; p.mesh.position.copy(R.getPos(from));
        U.hideJunctionArrows();
        U.showJunctionArrows(j, from, A.branches()[j], 3);
        await new Promise(r => setTimeout(r, 2500));      // the camera settles
        const rect = id => { const e = document.getElementById(id); if (!e || e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return null; const r = e.getBoundingClientRect(); return r.width ? { top: r.top | 0, bottom: r.bottom | 0 } : null; };
        const jp = R.worldToScreen(R.getPos(j));
        return {
            open: getComputedStyle(document.getElementById('junction-layer')).display !== 'none',
            dock: rect('junction-dock'), strip: rect('contracts-strip'), round: rect('round-counter'),
            actionsHidden: getComputedStyle(document.getElementById('p1-actions')).visibility === 'hidden',
            cards: [...document.querySelectorAll('#junction-arrows .j-arrow')].map(b => {
                const r = b.getBoundingClientRect();
                const m = /rotate\(([-\d.]+)deg\)/.exec(b.querySelector('.j-head i').style.transform);
                return { node: b.dataset.node, x: (r.left + r.right) / 2 | 0, y: (r.top + r.bottom) / 2 | 0, ang: m ? +m[1] : null, col: getComputedStyle(b).getPropertyValue('--jc').trim() };
            }),
            markers: R.junctionMarkerScreens(), j: jp, H: innerHeight,
        };
    }, [j, from]);

    const forks = [['bp_a', 'r20'], ['bp_b', 'r5'], ['bp_c', 'r10'], ['bp_d', 'r15']];
    let tapCardDone = false, tapBoardDone = false;
    for (const [j, from] of forks) {
        const f = await openFork(j, from);
        if (!f.open) { ok(`${j}: the fork opens`, false, 'did not open'); continue; }
        await page.screenshot({ path: path.join(__dirname, `shot-junction-${j}.png`) });
        ok(`${j}: dock in the bottom half, clear of the top HUD`, f.dock && f.dock.top > f.H / 2, JSON.stringify(f.dock));
        ok(`${j}: the action column steps back`, f.actionsHidden);
        // Order and arrows: a card left of another points further left.
        const [a, b] = f.cards;
        const dirX = ang => Math.cos(ang * Math.PI / 180);
        ok(`${j}: cards run left to right as the roads do, arrows agreeing`,
            f.cards.length === 2 && a.x < b.x && dirX(a.ang) < dirX(b.ang), JSON.stringify(f.cards.map(c => [c.node, c.ang])));
        // Markers: one per road, the left card's road marked left of the right one's.
        const mk = n => f.markers.find(m => m.nodeId === n);
        ok(`${j}: each road carries a marker, placed the same way round`,
            f.markers.length === 2 && mk(a.node) && mk(b.node) && mk(a.node).x < mk(b.node).x, JSON.stringify(f.markers));
        if (!tapCardDone) {
            // A real tap on the right-hand card.
            await page.mouse.click(b.x, b.y);
            await page.waitForTimeout(400);
            const after = await page.evaluate(async () => ({ open: getComputedStyle(document.getElementById('junction-layer')).display !== 'none',
                cam: (await import('/src/core/GameState.js')).state.cameraState }));
            ok(`${j}: a real tap on a card takes that road`, !after.open, JSON.stringify(after));
            tapCardDone = true;
        } else if (!tapBoardDone) {
            // A real tap on the LEFT road's marker, on the board itself.
            const m = mk(a.node);
            await page.mouse.click(m.x, m.y);
            await page.waitForTimeout(400);
            const after = await page.evaluate(async () => ({ open: getComputedStyle(document.getElementById('junction-layer')).display !== 'none',
                cam: (await import('/src/core/GameState.js')).state.cameraState }));
            ok(`${j}: a real tap on a road's marker on the board takes that road`, !after.open, JSON.stringify(after));
            tapBoardDone = true;
        } else {
            // Scout the map, come back: still choosing.
            await page.evaluate(() => document.getElementById('btn-junction-map').click());
            await page.waitForTimeout(500);
            await page.evaluate(() => document.getElementById('btn-close-map').click());
            await page.waitForTimeout(700);
            const back = await page.evaluate(() => ({ open: getComputedStyle(document.getElementById('junction-layer')).display !== 'none',
                cards: document.querySelectorAll('#junction-arrows .j-arrow').length }));
            ok(`${j}: scouting the map and coming back keeps the choice open`, back.open && back.cards === 2, JSON.stringify(back));
            await page.evaluate(() => document.querySelector('#junction-arrows .j-arrow').click());
            await page.waitForTimeout(300);
        }
        const hudBack = await page.evaluate(() => !document.body.classList.contains('junction-open'));
        ok(`${j}: the HUD comes back once the road is chosen`, hudBack);
    }
    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
