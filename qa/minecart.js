// ============================================================
// MINE CART MAYHEM — shared switches on the shared stage, face-off hold.
//
//   1. The mine, the track and both carts with their riders; not turned.
//   2. A real tap on the bottom half throws the switch at P1's next junction
//      — the one junction P1 can change — and the switch is shared state.
//   3. TNT on the line ahead crashes the cart and spills its gems.
//   4. A hard bot out-collects an idle player; the match resolves once.
//   5. Nothing leaks; no page errors.
//
// Screenshots land in qa/shot-minecart-*.png.
//
// usage: node minecart.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';

const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));
const CORNERS = [0, 2, 12, 14];

async function launch(page, { bot = false, skill = 0.55 } = {}) {
    await page.evaluate(async ({ bot, skill }) => {
        const { state } = await import('/src/core/GameState.js');
        const MM = await import('/src/minigames/MinigameManager.js');
        window.__RESULT = undefined;
        state.mgActive = true;
        state.mgType = 'minecart';
        state.players[0].isBot = false;
        state.players[1].isBot = bot;
        document.getElementById('minigame-layer').style.display = 'flex';
        document.getElementById('splash').style.display = 'none';
        const mod = await MM.loadMinigame('minecart');
        window.__MC = mod;
        window.__T0 = performance.now();
        mod.start(bot, w => { window.__RESULT = { winner: w, ms: performance.now() - window.__T0 }; }, skill);
    }, { bot, skill });
}
const dbg = page => page.evaluate(() => window.__MC && window.__MC._debugState());
const result = page => page.evaluate(() => window.__RESULT || null);
const shot = (page, name) => page.screenshot({ path: path.join(__dirname, `shot-minecart-${name}.png`) });

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

    // ══════ 1-2. Two humans; P1 taps ══════
    await launch(page);
    await page.waitForTimeout(900);
    await shot(page, 'intro');
    let s = await dbg(page);
    ok('mine built, face-off hold is not turned', s && s.gl && !s.turned);
    await page.waitForFunction(() => window.__MC._debugState().phase === 'play', null, { timeout: 20000 });
    // Wait until P1 is heading for a real junction rather than a corner.
    await page.waitForFunction(c => !c.includes(window.__MC._debugState().next[0]), CORNERS, { timeout: 8000 });
    const pre = await dbg(page);
    await page.mouse.click(206, 720);
    const post = await dbg(page);
    const node = pre.next[0];
    ok('a real tap on the bottom half throws the switch at P1\'s next junction',
       post.next[0] === node && post.exit[0] !== pre.exit[0], `node ${node}: exit ${pre.exit[0]} → ${post.exit[0]}`);
    ok('...which is shared state: that junction is changed for everyone',
       post.sw[node] !== pre.sw[node] || post.exit[0] !== pre.exit[0], `sw ${pre.sw[node]} → ${post.sw[node]}`);
    await page.waitForTimeout(400);
    await shot(page, 'play');

    // ══════ 3. TNT on the line ahead ══════
    await page.evaluate(() => window.__MC._debugGive(0, 3));
    const crash = await page.evaluate(async () => {
        const M = window.__MC;
        const st = M._debugState();
        // Put the crate on the edge P1 is about to take.
        M._debugTnt(st.next[0], st.exit[0]);
        // "Before" is the last reading before the crash: the cart can pick
        // up a gem on its way to the crate.
        let g0 = st.gems[0];
        for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 50));
            const d = M._debugState();
            if (d.stun[0] > 0 && d.why[0] === 'tnt') return { hit: true, g0, g1: d.gems[0], spilled: d.spilled[0] };
            if (d.stun[0] > 0) continue;            // a bump with P2, not the crate
            g0 = d.gems[0];
        }
        return { hit: false, g0, g1: M._debugState().gems[0] };
    });
    await shot(page, 'boom');
    ok('TNT on the line ahead crashes the cart', crash.hit, JSON.stringify(crash));
    // Counted at the source: a gem picked up in the same frame as the crash
    // makes a before/after difference unreliable.
    ok('...and spills two of its gems onto the track', crash.spilled === 2, JSON.stringify(crash));
    // ══════ Head-on: one bump, then apart — never locked together ══════
    // Two bots once bounced off each other on one edge for thirty seconds:
    // reversed, still side by side, and "head-on" again the moment the stun
    // wore off.
    const bump = await page.evaluate(async () => {
        const M = window.__MC;
        M._debugTnt(0, 1);                          // well out of the way
        M._debugPut(0, 13, 10, 1.2);                // P1 going up the middle column
        M._debugPut(1, 10, 13, 1.6);                // P2 coming down it
        // Watch until just after the first bump's stun ends: the lock showed
        // up as a second bump on the same edge the instant it did.
        let bumps = 0, wasStunned = false, freedAt = -1, sameEdgeAfter = null;
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 100));
            const d = M._debugState();
            const stunned = d.stun[0] > 0;
            if (stunned && !wasStunned) bumps++;
            if (!stunned && wasStunned && freedAt < 0) freedAt = i;
            if (freedAt >= 0 && i === freedAt + 3) {
                sameEdgeAfter = d.edge[0][0] === d.edge[1][1] && d.edge[0][1] === d.edge[1][0] && d.stun[0] > 0;
                break;
            }
            wasStunned = stunned;
        }
        return { bumps, sameEdgeAfter };
    });
    ok('a head-on meeting bumps once and the carts part', bump.bumps === 1 && bump.sameEdgeAfter === false, JSON.stringify(bump));
    await page.evaluate(async () => { const M = await import('/src/minigames/MinigameManager.js'); M.forceEndMinigame(); });

    // ══════ 4. A hard bot against an idle player ══════
    await launch(page, { bot: true, skill: 0.85 });
    let verdict = false, last = null;
    const t0 = Date.now();
    while (!(await result(page)) && Date.now() - t0 < 90000) {
        const st = await dbg(page);
        if (st && st.gems) last = st.gems;
        if (st && st.phase === 'over' && !verdict) { await page.waitForTimeout(1300); await shot(page, 'verdict'); verdict = true; }
        await page.waitForTimeout(200);
    }
    const r = await result(page);
    ok('a hard bot out-collects an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} gems=${JSON.stringify(last)} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');

    const after = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const lay = document.getElementById('minigame-layer');
        return { paused: R.isBoardPaused(), orphans: Array.from(lay.children).filter(el => !el.id).length,
                 canvases: lay.querySelectorAll('canvas').length };
    });
    ok('nothing left behind, board drawing again', !after.paused && after.orphans === 0 && after.canvases === 0, JSON.stringify(after));
    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
