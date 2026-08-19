// ============================================================
// Verification suite for the QA fixes.
//   1. Renderer: repeated updateSingleTile() must not grow the scene graph.
//   2. Contracts: every type in the pool must be claimable by its real emitter.
//   3. Physics: the settle watchdog must always produce a roll result.
//   4. Pacing: measured seconds per board turn (feeds the session-length finding).
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const out = { pass: [], fail: [], info: {} };
const ok = (n, cond, detail) => (cond ? out.pass : out.fail).push(n + (detail ? ' — ' + detail : ''));

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    // ---------- 2. Contract claimability (pure logic, before a board exists) ----------
    const contractResult = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const C = await import('/src/core/Contracts.js');
        const { CONTRACT_POOL, COUNTED_TYPES } = await import('/src/config/ContractPool.js');

        state.selectedMap = 'city_circuit';
        state.investorUsedThisRound = [false, false];
        const p = state.players[0];

        // The emitter call each contract type is driven by in the real game.
        const emit = {
            visit_hq:         c => C.checkContract(p, 'visit_hq', c.param),
            enter_district:   c => C.checkContract(p, 'enter_district', c.param),
            land_type:        c => C.checkContract(p, 'land_type', c.param),
            use_item:         c => C.checkContract(p, 'use_item', c.param),
            block_space:      () => C.checkContract(p, 'block_space'),
            complete_circuit: () => C.checkContract(p, 'complete_circuit'),
            duel_win:         () => C.checkContract(p, 'duel_win'),
            claim_ally:       () => C.checkContract(p, 'claim_ally'),
            open_gate:        () => C.checkContract(p, 'open_gate'),
            win_minigame:     () => C.checkContract(p, 'win_minigame'),
            steal_ally:       () => C.checkContract(p, 'steal_ally'),
            // counted
            land_coin:        c => { for (let i = 0; i < c.param; i++) C.checkContract(p, 'land_coin'); },
            land_coin_big:    c => { for (let i = 0; i < c.param; i++) C.checkContract(p, 'land_coin_big'); },
            visit_shops:      c => { for (let i = 1; i <= c.param; i++) C.checkContract(p, 'visit_shops', null, i); },
            earn_coins_round: c => C.checkContract(p, 'earn_coins_round', null, c.param),
            win_minigames:    c => { for (let i = 1; i <= c.param; i++) C.checkContract(p, 'win_minigames', null, i); },
            buy_item:         c => { for (let i = 1; i <= c.param; i++) C.checkContract(p, 'buy_item', null, i); },
            visit_hq_any:     c => { for (let i = 1; i <= c.param; i++) C.checkContract(p, 'visit_hq_any', null, i); },
        };

        const rows = [];
        for (const card of CONTRACT_POOL) {
            // Isolate: this card is the only active contract, pool empty so nothing refills.
            state.activeContracts = [{ ...card, _prog: [0, 0] }];
            state.contractPool = [];
            p.allies = [];
            const before = p.coins;
            const fn = emit[card.type];
            if (!fn) { rows.push({ id: card.id, type: card.type, claimed: false, why: 'NO EMITTER MAPPED' }); continue; }
            try { fn(card); } catch (e) { rows.push({ id: card.id, type: card.type, claimed: false, why: 'THREW ' + e.message }); continue; }
            const claimed = state.activeContracts.length === 0;
            rows.push({ id: card.id, type: card.type, desc: card.desc, claimed,
                        gained: p.coins - before, counted: COUNTED_TYPES.has(card.type) });
        }

        // Under-count must NOT claim early (regression guard for land_coin_big).
        const big = CONTRACT_POOL.find(c => c.id === 'c06');
        state.activeContracts = [{ ...big, _prog: [0, 0] }];
        state.contractPool = [];
        C.checkContract(p, 'land_coin_big');           // 1 of 2
        const earlyClaim = state.activeContracts.length === 0;

        // Progress must be per player, not shared.
        const coin = CONTRACT_POOL.find(c => c.id === 'c05');   // land on 3 coin spaces
        state.activeContracts = [{ ...coin, _prog: [0, 0] }];
        C.checkContract(state.players[0], 'land_coin');
        C.checkContract(state.players[1], 'land_coin');
        C.checkContract(state.players[1], 'land_coin');
        const crossTalk = state.activeContracts.length === 0;   // must be false

        return { rows, earlyClaim, crossTalk };
    });

    const unclaimable = contractResult.rows.filter(r => !r.claimed);
    const poolN = contractResult.rows.length;
    ok(`bounties: all ${poolN} pool entries claimable`, unclaimable.length === 0,
       unclaimable.length ? unclaimable.map(r => `${r.id}/${r.type}${r.why ? '(' + r.why + ')' : ''}`).join(', ') : `${poolN}/${poolN}`);
    ok('bounties: counted card does not claim early', contractResult.earlyClaim === false);
    ok('bounties: progress is per player (no cross-talk)', contractResult.crossTalk === false);
    out.info.contracts = contractResult.rows;

    // ---------- Start a City Circuit game for the renderer / physics checks ----------
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit' }));
    // 30s was too tight. This context renders at deviceScaleFactor 2 on software
    // GL, and the City flyover is a fixed-duration animation driven by frame
    // deltas capped at 0.1s — so on a slow enough renderer it takes far longer
    // in wall clock than the ~9s it runs on a real device. Measured at ~24s here.
    await page.waitForFunction(() => {
        return window.__QA.snapshot().gameState !== 'INIT';
    }, null, { timeout: 75000 });
    await page.waitForTimeout(3000);

    // ---------- 1. Renderer leak ----------
    const leak = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const census = () => {
            const cam = R.getCamera();
            let root = cam; while (root && root.parent) root = root.parent;
            let meshes = 0; const geos = new Set(), mats = new Set();
            if (root) root.traverse(n => {
                if (n.isMesh || n.isPoints || n.isLine) {
                    meshes++;
                    if (n.geometry) geos.add(n.geometry.uuid);
                    (Array.isArray(n.material) ? n.material : n.material ? [n.material] : []).forEach(m => mats.add(m.uuid));
                }
            });
            return { meshes, geos: geos.size, mats: mats.size, bobbing: R.getActiveAnims().length };
        };
        const before = census();
        for (let i = 0; i < 12; i++) R.updateSingleTile();
        const after = census();
        return { before, after };
    });
    ok('renderer: 12 tile redraws do not grow the scene graph',
       leak.after.meshes === leak.before.meshes && leak.after.mats <= leak.before.mats,
       `meshes ${leak.before.meshes}→${leak.after.meshes}, materials ${leak.before.mats}→${leak.after.mats}`);
    out.info.leak = leak;

    // ---------- 3. Physics settle watchdog ----------
    const watchdog = await page.evaluate(async () => {
        const P = await import('/src/engine/Physics.js');
        const R = await import('/src/engine/Renderer.js');
        P.clearDice(R.getDiceGroup());
        const d = P.spawnDie(R.getDiceGroup());
        // Pin the die in permanent motion so the sleep test can never pass.
        const spin = () => { d.body.velocity.set(0, 0, 0); d.body.angularVelocity.set(40, 40, 40); };
        const iv = setInterval(spin, 16); spin();
        const t0 = performance.now();
        const result = await new Promise(res => {
            P.onSettle('normal', v => res(v));
            setTimeout(() => res('NEVER_FIRED'), 12000);
        });
        clearInterval(iv);
        P.clearDice(R.getDiceGroup());
        return { result, ms: Math.round(performance.now() - t0) };
    });
    ok('physics: settle watchdog always yields a roll result',
       watchdog.result !== 'NEVER_FIRED' && watchdog.result >= 1 && watchdog.result <= 6,
       `result=${watchdog.result} after ${watchdog.ms}ms`);
    out.info.watchdog = watchdog;

    // ---------- 4. Pacing: seconds per board turn (minigames force-resolved fast) ----------
    await page.evaluate(() => window.__QA.setMinigameFastResolve(2500));
    const t0 = Date.now();
    const startTurns = (await page.evaluate(() => window.__QA.snapshot())).totalTurns;
    let mgCount = 0, lastMg = '';
    while ((Date.now() - t0) / 1000 < 180) {
        const r = await page.evaluate(() => ({ r: window.__QA.step(), s: window.__QA.snapshot() }));
        if (String(r.r).startsWith('MG_FORCED')) mgCount++;
        if (r.r === 'WIN_SCREEN') break;
        await page.waitForTimeout(120);
    }
    const snap = await page.evaluate(() => window.__QA.snapshot());
    const turns = snap.totalTurns - startTurns;
    const secs = (Date.now() - t0) / 1000;
    out.info.pacing = {
        windowSeconds: Math.round(secs), boardTurns: turns,
        secondsPerTurn: turns ? +(secs / turns).toFixed(1) : null,
        minigamesForceResolved: mgCount, roundReached: snap.round,
    };
    ok('pacing: measured a turn rate', turns > 0, `${turns} turns in ${Math.round(secs)}s`);

    out.info.errors = [...new Set(errors)];
    ok('no console/page errors during verification', out.info.errors.length === 0,
       out.info.errors.slice(0, 5).join(' | '));

    fs.writeFileSync(path.join(__dirname, 'result-verify.json'), JSON.stringify(out, null, 2));
    console.log('PASS:'); out.pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); out.fail.length ? out.fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    console.log('\npacing:', JSON.stringify(out.info.pacing));
    console.log('leak:', JSON.stringify(out.info.leak));
    await browser.close();
    process.exit(out.fail.length ? 1 : 0);
})();
