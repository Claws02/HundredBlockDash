// ============================================================
// VAULT HEIST — the asymmetric sneak on the shared stage, face-off hold.
//
//   1. It builds the bank, both figures, the torch, and is NOT turned (the
//      face-off hold is portrait).
//   2. P1's stick is the bottom half of the glass: a real drag there moves
//      P1's figure the same way across the floor, and P2's does not move.
//   3. Walking the thief onto loot picks it up, and carrying it out of your
//      own door banks it and ends the round.
//   4. Standing in the guard's beam fills the spotted meter and catches you;
//      a column between you and the torch blocks it.
//   5. Roles swap for round 2, and two bots resolve a whole match.
//   6. Nothing leaks, on finish or force-end; no page errors.
//
// Screenshots land in qa/shot-vaultheist-*.png.
//
// usage: node vaultheist.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';

const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

async function launch(page, { p1bot = false, p2bot = false, skill = 0.55 } = {}) {
    await page.evaluate(async ({ p1bot, p2bot, skill }) => {
        const { state } = await import('/src/core/GameState.js');
        const MM = await import('/src/minigames/MinigameManager.js');
        window.__RESULT = undefined;
        state.mgActive = true;
        state.mgType = 'vaultheist';
        state.players[0].isBot = p1bot;
        state.players[1].isBot = p2bot;
        document.getElementById('minigame-layer').style.display = 'flex';
        document.getElementById('splash').style.display = 'none';
        const mod = await MM.loadMinigame('vaultheist');
        window.__VH = mod;
        window.__T0 = performance.now();
        mod.start(p2bot, w => { window.__RESULT = { winner: w, ms: performance.now() - window.__T0 }; }, skill);
    }, { p1bot, p2bot, skill });
}
const dbg = page => page.evaluate(() => window.__VH && window.__VH._debugState());
const result = page => page.evaluate(() => window.__RESULT || null);
const shot = (page, name) => page.screenshot({ path: path.join(__dirname, `shot-vaultheist-${name}.png`) });
const forceEnd = page => page.evaluate(async () => { const M = await import('/src/minigames/MinigameManager.js'); M.forceEndMinigame(); });

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    // ══════ 1-2. Two humans; P1 steals first ══════
    await launch(page);
    await page.waitForTimeout(900);
    await shot(page, 'intro');
    let s = await dbg(page);
    ok('bank built, face-off hold is not turned', s && s.gl && !s.turned, JSON.stringify({ gl: s.gl, turned: s.turned }));
    await page.waitForFunction(() => window.__VH._debugState().phase === 'play', null, { timeout: 15000 });
    const start = await dbg(page);
    ok('round 1: P1 is the thief', start.thief === 0);
    // Drag up the glass on the bottom half: P1 walks toward -z (the far end).
    await page.mouse.move(206, 740);
    await page.mouse.down();
    await page.mouse.move(206, 690, { steps: 4 });
    await page.waitForTimeout(700);
    s = await dbg(page);
    ok('a drag up the bottom half walks P1 up the floor', s.pos[0][1] < start.pos[0][1] - 1.5,
       `${start.pos[0][1]} → ${s.pos[0][1]}`);
    ok('...and leaves P2 where they were', Math.abs(s.pos[1][1] - start.pos[1][1]) < 0.05 && Math.abs(s.pos[1][0] - start.pos[1][0]) < 0.05);
    await shot(page, 'walk');
    await page.mouse.up();

    // ══════ 3-4. Loot, escape, the beam, a column ══════
    // These are rules checks, so drive the figures directly through the debug
    // hook rather than steering them round the floor by hand.
    const rules = await page.evaluate(async () => {
        const M = window.__VH;
        const out = {};
        // Put the guard (P2) far away facing the far wall, so nothing is lit.
        M._debugPlace(1, -5, -10.5, 0);
        // A bag on the desk: walk onto it.
        M._debugPlace(0, 4.7, 1.7, Math.PI);
        await new Promise(r => setTimeout(r, 200));
        out.carry = M._debugState().carry;
        // Out through P1's corner door.
        M._debugPlace(0, 4.1, 11.3, 0);
        await new Promise(r => setTimeout(r, 250));
        out.afterDoor = M._debugState();
        return out;
    });
    ok('walking onto a cash bag picks it up', rules.carry === 1, `carry=${rules.carry}`);
    ok('carrying it out of your own door banks it and ends the round',
       rules.afterDoor.banked[0] === 1 && rules.afterDoor.result && rules.afterDoor.result.kind === 'escaped',
       JSON.stringify({ banked: rules.afterDoor.banked, result: rules.afterDoor.result }));
    await page.waitForTimeout(300);
    await shot(page, 'escaped');

    // Round 2: P2 steals. Light them up, then hide them behind a column.
    await page.waitForFunction(() => window.__VH._debugState().round === 2 && window.__VH._debugState().phase === 'play', null, { timeout: 15000 });
    const beam = await page.evaluate(async () => {
        const M = window.__VH;
        const out = { thief: M._debugState().thief };
        // Guard P1 facing -z; thief P2 first straight behind the column at
        // (3.6, 4.6), then out in the open.
        M._debugPlace(0, 3.6, 7.5, Math.PI);           // guard, torch pointing -z
        M._debugPlace(1, 3.6, 2.0, 0);                 // thief, 5.5 ahead, but the column is between
        await new Promise(r => setTimeout(r, 900));
        out.blocked = M._debugState().suspicion;
        M._debugPlace(1, 2.2, 3.2, 0);                 // now in the open, 4.5 ahead, 18° off the axis
        await new Promise(r => setTimeout(r, 400));
        out.lit = M._debugState().suspicion;
        await new Promise(r => setTimeout(r, 1200));
        out.after = M._debugState();
        return out;
    });
    ok('round 2: the roles have swapped', beam.thief === 1);
    ok('a column between the torch and the thief blocks the light', beam.blocked < 0.05, `suspicion=${beam.blocked}`);
    ok('in the open, in the cone, the meter fills', beam.lit > 0.2, `suspicion=${beam.lit}`);
    ok('...and a full meter is a catch', beam.after.result && beam.after.result.kind === 'caught', JSON.stringify(beam.after.result));
    await shot(page, 'caught');
    // Let the match finish on its own now: round 2 is over, so the verdict runs.
    let r = null;
    let verdictShot = false;
    for (let i = 0; i < 80 && !r; i++) {
        const st = await dbg(page);
        if (st && st.phase === 'over' && !verdictShot) {
            await page.waitForTimeout(1300); await shot(page, 'verdict'); verdictShot = true;
        }
        r = await result(page); if (!r) await page.waitForTimeout(150);
    }
    ok('two rounds and the match resolves on gold: P1 banked 1, P2 0', !!r && r.winner === 0, r ? `winner=${r.winner}` : 'no result');

    // ══════ 5. Two bots play a whole match ══════
    await launch(page, { p1bot: true, p2bot: true, skill: 0.55 });
    let playShot = false;
    const t0 = Date.now();
    while (!(await result(page)) && Date.now() - t0 < 90000) {
        const st = await dbg(page);
        if (st && st.phase === 'play' && st.clock > 4 && !playShot) { await shot(page, 'play'); playShot = true; }
        await page.waitForTimeout(200);
    }
    r = await result(page);
    ok('two bots finish a match inside the budget', !!r && r.ms / 1000 < 70, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');

    // ══════ 6. Cleanup ══════
    await launch(page);
    await page.waitForTimeout(1500);
    await forceEnd(page);
    const after = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const lay = document.getElementById('minigame-layer');
        return { paused: R.isBoardPaused(), orphans: Array.from(lay.children).filter(el => !el.id).length,
                 canvases: lay.querySelectorAll('canvas').length };
    });
    ok('a force-end leaves nothing behind and the board draws again', !after.paused && after.orphans === 0 && after.canvases === 0, JSON.stringify(after));

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
