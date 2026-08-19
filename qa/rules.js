// ============================================================
// Economy and rule checks.
//
//   · District HQ pays for PASSING it, not only for landing on it
//   · FINE is −3 and BIG FINE is −8, everywhere (effect, blurb, realm flavour)
//   · The Gate needs 20 on Hundred Block Dash and 15 on City Circuit
//   · The shop carries the narrowed roster and nothing else
//
// usage: node rules.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

const KEEP = ['shield', 'anchor', 'cursed_die', 'custom_dice', 'rocket', 'steal', 'swap'];
const CUT  = ['warp_drive', 'double_die', 'overcharge', 'tollbooth', 'mirror'];

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

    // ── Config-level facts ──────────────────────────────────────────────────
    const cfg = await page.evaluate(async () => {
        const G = await import('/src/config/GameConfig.js');
        return {
            fine: G.FINE_AMOUNT, bigFine: G.BIG_FINE_AMOUNT,
            gateHBD: G.gateThreshold('hundred_block_dash'),
            gateCity: G.gateThreshold('city_circuit'),
            items: Object.keys(G.ITEMS),
            descLose: G.SPACE_DESCS.lose, descBig: G.SPACE_DESCS.lose_big,
            // Every realm's flavour text must carry the same numbers.
            flavour: G.HBD_BIOMES.map(b => [b.flavor?.lose?.d, b.flavor?.lose_big?.d]),
            shops: G.DISTRICT_SHOPS,
        };
    });
    ok('fine: FINE is 3 and BIG FINE is 8', cfg.fine === 3 && cfg.bigFine === 8,
       `${cfg.fine} / ${cfg.bigFine}`);
    ok('fine: the blurbs quote the same numbers as the effect',
       /−3 coins/.test(cfg.descLose) && /−8 coins/.test(cfg.descBig),
       `"${cfg.descLose}" · "${cfg.descBig}"`);
    ok('fine: every realm\'s flavour text quotes them too',
       cfg.flavour.every(([a, b]) => /−3 coins/.test(a || '') && /−8 coins/.test(b || '')),
       JSON.stringify(cfg.flavour[0]));
    ok('gate: HBD needs 20, City needs 15',
       cfg.gateHBD === 20 && cfg.gateCity === 15, `${cfg.gateHBD} / ${cfg.gateCity}`);
    ok('shop: carries exactly the seven kept items',
       KEEP.every(k => cfg.items.includes(k)) && cfg.items.length === KEEP.length,
       cfg.items.join(', '));
    ok('shop: the five cut items are gone entirely',
       CUT.every(k => !cfg.items.includes(k)), cfg.items.join(', '));
    ok('shop: no district lists an item that no longer exists',
       Object.values(cfg.shops).every(list => !list || list.every(k => cfg.items.includes(k))),
       JSON.stringify(cfg.shops));

    // ── Fines actually take the right amount ────────────────────────────────
    ok('boot: HBD match at the roll', await boot(page, 'hundred_block_dash'));
    const fines = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const p = state.players[0];
        state.activePlayer = 0;
        p._shielded = false;
        const out = {};
        p.coins = 50; GC.resolveSpaceEffect(p, 'lose', {});      out.lose = 50 - p.coins;
        p.coins = 50; GC.resolveSpaceEffect(p, 'lose_big', {});  out.loseBig = 50 - p.coins;
        p.coins = 50; GC.resolveSpaceEffect(p, 'trap', {});      out.trap = 50 - p.coins;
        return out;
    });
    ok('fine: landing on FINE costs exactly 3', fines.lose === 3, `cost ${fines.lose}`);
    ok('fine: landing on BIG FINE costs exactly 8', fines.loseBig === 8, `cost ${fines.loseBig}`);
    ok('fine: TRAP is unchanged at 5', fines.trap === 5, `cost ${fines.trap}`);

    // The HBD gate threshold has to reach the player, not just the config.
    const gateText = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        GC.triggerGateChallenge(state.players[0]);
        const t = document.getElementById('gate-sub').textContent;
        document.getElementById('gate-overlay').style.display = 'none';
        state.gameState = 'PRE_ROLL';
        return t;
    });
    ok('gate: the HBD prompt asks for 20', /20\+/.test(gateText), `"${gateText}"`);

    // ── District HQ pays on pass-through ────────────────────────────────────
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());
    ok('boot: City match at the roll', await boot(page, 'city_circuit'));

    const hq = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const { CITY_GRAPH, ALL_NODES_ORDERED } = await import('/src/config/BoardGraph.js');
        // Every HQ sits at the end of a district spur, one step before a
        // junction back to the ring, so there is no junction-free path that
        // passes one. Park directly on an HQ's PREDECESSOR instead and move
        // three: the HQ is then step 1 of 3 and is unambiguously passed.
        const hqId = ALL_NODES_ORDERED.find(id => state.board[id]?.type === 'hq');
        if (!hqId) return { err: 'no HQ on the board' };
        const startId = ALL_NODES_ORDERED.find(id => (CITY_GRAPH[id]?.next || []).includes(hqId));
        if (!startId) return { err: 'no predecessor for ' + hqId };
        return { hqId, startId, district: CITY_GRAPH[hqId]?.district };
    });
    ok('setup: found an HQ to walk over', !hq.err, JSON.stringify(hq));

    const walked = await page.evaluate(async (hq) => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const R = await import('/src/engine/Renderer.js');
        state.activePlayer = 0;
        const p = state.players[0];
        p.pos = hq.startId; p.prevPos = hq.startId;
        if (p.mesh) p.mesh.position.copy(R.getPos(p.pos));
        p.coins = 50;
        p.districtsVisited[hq.district] = 0;
        // Neutralise everything on the walk except the HQ itself. This claim is
        // about the pass-through payment, and the tile the walk happens to END
        // on is whatever the district pool put there — when the pools changed,
        // this landed on a TRAP and the assertion read 50→60 instead of 50→65.
        // 'start' is the one type that prints a line and touches nothing.
        {
            const CG = (await import('/src/config/BoardGraph.js')).CITY_GRAPH;
            const J  = (await import('/src/config/BoardGraph.js')).JUNCTION_IDS;
            let cur = hq.startId;
            for (let i = 0; i < 5; i++) {
                let nxt = CG[cur]?.next?.[0];
                if (nxt && J.has(nxt)) nxt = CG[nxt]?.next?.[0];
                if (!nxt) break;
                if (nxt !== hq.hqId && state.board[nxt]) state.board[nxt] = { type: 'start' };
                cur = nxt;
            }
        }
        const before = p.coins;
        // Branch prompts are a human-only overlay; flag the mover as a bot so it
        // picks a route itself and the move actually completes.
        const wasBot = p.isBot; p.isBot = true;
        state.gameState = 'MOVING';
        GC.moveThroughGraph(p, 3);          // the HQ is step 1 of 3
        return new Promise(res => setTimeout(() => {
            p.isBot = wasBot;
            res({
                before, after: p.coins, pos: p.pos, hqId: hq.hqId,
                visited: p.districtsVisited[hq.district],
            });
        }, 8000));
    }, hq);
    ok('HQ: walking past one pays the first-visit bonus without landing on it',
       walked.after - walked.before >= 15 && walked.pos !== walked.hqId,
       `${walked.before} → ${walked.after} coins, ended on ${walked.pos} (HQ was ${walked.hqId})`);
    ok('HQ: the visit is recorded, so a revisit pays the smaller bonus',
       walked.visited >= 1, `districtsVisited = ${walked.visited}`);

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-rules.json'),
        JSON.stringify({ pass, fail, cfg, fines, gateText, hq, walked, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
