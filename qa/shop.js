// ============================================================
// SHOP — the meta economy end to end (docs/LAUNCH_PLAN.md §3).
//
//   1. Catalog: every minigame is free or in exactly one pack; product ids are
//      unique; the nine 3–4-seat games are free.
//   2. A fresh device: 0 Tickets, City Circuit locked (confirm disabled),
//      31 arcade games locked, and every surface still has a dealable pool
//      made only of owned games.
//   3. Tickets: the match reward, the first-of-day bonus paid once.
//   4. The shop (simulated store, ?devstore): two-tap Ticket spend, a
//      real-money purchase, a rewarded ad, Restore, equipping a look.
//   5. A match wearing a hat, a dice skin and a trail reaches its first roll
//      with the hat on the token and no page errors.
//
// Screenshots of the three tabs land in qa/shot-shop-*.png.
//
// usage: QA_BASE=http://127.0.0.1:8129/index.html node qa/shop.js
// ============================================================
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8129/index.html') + '?devstore';

(async () => {
    const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
    const browser = await chromium.launch({
        ...(exe ? { executablePath: exe } : {}),
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.addInitScript(() => {
        try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {}
        window.__QA_LOCKED = true;
    });
    const fail = [], ok = [];
    const check = (cond, msg) => (cond ? ok : fail).push(msg);

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 60000 });

    // ---- 1. catalog -------------------------------------------------------
    const cat = await page.evaluate(async () => {
        const C = await import('/src/meta/Catalog.js');
        const R = await import('/src/config/MinigameRegistry.js');
        const counts = {};
        for (const t of R.MG_TYPES) counts[t] = (C.FREE_MINIGAMES.includes(t) ? 1 : 0) + Object.values(C.MINIGAME_PACKS).filter(p => p.games.includes(t)).length;
        const unknown = [...C.FREE_MINIGAMES, ...Object.values(C.MINIGAME_PACKS).flatMap(p => p.games)].filter(t => !R.MG_TYPES.includes(t));
        const many = R.MG_TYPES.filter(t => R.surfacesOf(t).sharedMany);
        const ids = C.PRODUCTS.map(p => p.id);
        return {
            bad: Object.entries(counts).filter(([, n]) => n !== 1).map(([t, n]) => `${t}×${n}`),
            unknown,
            manyNotFree: many.filter(t => !C.FREE_MINIGAMES.includes(t)),
            dupIds: ids.filter((id, i) => ids.indexOf(id) !== i),
            free: C.FREE_MINIGAMES.length,
        };
    });
    check(!cat.bad.length, `every minigame in exactly one of free/packs ${cat.bad.join(' ')}`);
    check(!cat.unknown.length, `no pack lists an unknown game ${cat.unknown.join(' ')}`);
    check(!cat.manyNotFree.length, `all 3–4-seat games are free ${cat.manyNotFree.join(' ')}`);
    check(!cat.dupIds.length, 'product ids unique');
    check(cat.free === 12, `12 free minigames (got ${cat.free})`);

    // ---- 2. a fresh device --------------------------------------------------
    await page.addScriptTag({ content: AGENT });
    await page.evaluate(() => window.__QA.bind());
    const fresh = await page.evaluate(async () => {
        const U = await import('/src/meta/Unlocks.js');
        const R = await import('/src/config/MinigameRegistry.js');
        const pools = {};
        for (const s of ['two', 'many', 'online']) {
            const p = U.ownedMinigames(R.typesForSurface(s));
            pools[s] = { n: p.length, allOwned: p.every(U.minigameOwned) };
        }
        return {
            tix: document.getElementById('splash-tickets').textContent,
            city: U.mapOwned('city_circuit'), hbd: U.mapOwned('hundred_block_dash'),
            locked: R.MG_TYPES.filter(t => !U.minigameOwned(t)).length,
            pools,
        };
    });
    check(/^0\b/.test(fresh.tix), `splash shows 0 Tickets (${fresh.tix})`);
    check(fresh.hbd && !fresh.city, 'HBD free, City Circuit locked');
    check(fresh.locked === 31, `31 minigames locked (got ${fresh.locked})`);
    for (const [s, p] of Object.entries(fresh.pools)) check(p.n > 0 && p.allOwned, `${s} pool dealable from owned games (${p.n})`);

    // Map select: City Circuit selectable, but confirm disabled and an unlock offered.
    const mapUi = await page.evaluate(async () => {
        const GC = await import('/src/core/GameController.js');
        GC.goToMapSelect();
        GC.selectMap('city_circuit');
        const r = {
            confirmDisabled: document.getElementById('btn-map-confirm').disabled,
            offer: !!document.querySelector('#map-preview-panel [data-unlock-key="map:city_circuit"]'),
            preselectHbd: false,
        };
        GC.goToMapSelect();
        const { state } = await import('/src/core/GameState.js');
        r.preselectHbd = state.selectedMap === 'hundred_block_dash';
        document.getElementById('map-select').style.display = 'none';
        document.getElementById('splash').style.display = '';
        return r;
    });
    check(mapUi.confirmDisabled && mapUi.offer, 'locked board: confirm disabled, unlock offered');
    check(mapUi.preselectHbd, 'map select pre-selects the owned board');

    // ---- 3. tickets -----------------------------------------------------------
    const reward = await page.evaluate(async () => {
        const W = await import('/src/meta/Wallet.js');
        const a = W.rewardMatch(3), b = W.rewardMatch(0);
        return { a: a.total, b: b.total, bal: W.balance() };
    });
    check(reward.a === 25 + 30 + 50 && reward.b === 25, `match reward with first-of-day once (${reward.a}, ${reward.b})`);

    // ---- 4. the shop ------------------------------------------------------------
    await page.evaluate(async () => (await import('/src/meta/Wallet.js')).earn(5000));
    await page.click('#btn-shop');
    await page.waitForSelector('#shop-overlay .shop-card');
    await page.screenshot({ path: path.join(__dirname, 'shot-shop-games.png') });
    const before = await page.evaluate(async () => (await import('/src/meta/Wallet.js')).balance());
    await page.click('[data-item="pack:frontier"] [data-tix]');
    const afterOne = await page.evaluate(async () => (await import('/src/meta/Unlocks.js')).has('pack:frontier'));
    check(!afterOne, 'first tap on a Ticket price does not spend');
    await page.click('[data-item="pack:frontier"] [data-tix]');
    const afterTwo = await page.evaluate(async () => ({
        owned: (await import('/src/meta/Unlocks.js')).has('pack:frontier'),
        bal: (await import('/src/meta/Wallet.js')).balance(),
    }));
    check(afterTwo.owned && afterTwo.bal === before - 800, `second tap buys the pack for 800 (${before} → ${afterTwo.bal})`);

    await page.click('[data-item="map:city_circuit"] [data-buy]');
    await page.waitForFunction(async () => (await import('/src/meta/Unlocks.js')).has('map:city_circuit'), null, { timeout: 5000 }).catch(() => {});
    check(await page.evaluate(async () => (await import('/src/meta/Unlocks.js')).has('map:city_circuit')), 'simulated store purchase unlocks City Circuit');

    await page.click('[data-tab="tickets"]');
    await page.screenshot({ path: path.join(__dirname, 'shot-shop-tickets.png') });
    const b0 = await page.evaluate(async () => (await import('/src/meta/Wallet.js')).balance());
    await page.click('[data-ad]');
    await page.waitForTimeout(2800);   // the simulated ad runs 2 s
    const b1 = await page.evaluate(async () => (await import('/src/meta/Wallet.js')).balance());
    check(b1 === b0 + 50, `rewarded ad pays 50 (${b0} → ${b1})`);
    await page.click('[data-restore]');
    await page.waitForTimeout(300);

    await page.click('[data-tab="looks"]');
    await page.click('[data-item="cos:hat.tophat"] [data-tix]');
    await page.click('[data-item="cos:hat.tophat"] [data-tix]');
    await page.click('[data-item="cos:dice.ruby"] [data-tix]');
    await page.click('[data-item="cos:dice.ruby"] [data-tix]');
    await page.click('[data-item="cos:trail.sparkle"] [data-tix]');
    await page.click('[data-item="cos:trail.sparkle"] [data-tix]');
    await page.evaluate(() => { document.getElementById('shop-body').scrollTop = 0; });
    await page.waitForTimeout(3000);   // let the toast clear and the preview render
    await page.screenshot({ path: path.join(__dirname, 'shot-shop-looks.png') });
    const look = await page.evaluate(async () => (await import('/src/meta/Cosmetics.js')).lookFor(0));
    check(look.hat === 'tophat' && look.dice === 'ruby' && look.trail === 'sparkle', `bought looks are worn by P1 (${JSON.stringify(look)})`);
    const preview = await page.evaluate(() => !!document.querySelector('#shop-preview img'));
    check(preview, 'looks preview renders');
    await page.click('#btn-shop-back');

    // Arcade reflects the new pack.
    const arcade = await page.evaluate(async () => {
        document.getElementById('btn-minigames').click();
        const n = document.querySelectorAll('.mg-sel-card.unowned').length;
        document.getElementById('btn-mg-select-back').click();
        return n;
    });
    check(arcade === 31 - 7, `arcade shows 24 locked after Frontier (got ${arcade})`);

    // ---- 5. a match in costume ------------------------------------------------------
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'hundred_block_dash', len: 50 }));
    const t0 = Date.now();
    let reached = false;
    while (Date.now() - t0 < 300000) {
        const st = await page.evaluate(async () => {
            (await import('/src/engine/Renderer.js')).skipFlyover();
            for (const id of ['btn-msg-continue', 'btn-cb-start', 'btn-hbd-story-begin']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); }
            return window.__QA.snapshot().gameState;
        }).catch(() => '');
        if (st === 'PRE_ROLL') { reached = true; break; }
        await page.waitForTimeout(700);
    }
    check(reached, 'costumed match reaches the first roll');
    const dressed = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const p0 = state.players[0], p1 = state.players[1];
        let hat = false;
        p0.mesh?.traverse(o => { if (o.userData?.cosmetic === 'hat') hat = true; });
        return { look: p0.look, botLook: p1.look, hat };
    });
    check(dressed.hat && dressed.look?.hat === 'tophat', 'P1 token wears the top hat');
    check(dressed.botLook == null, 'the bot wears nothing');

    check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
    await browser.close();
    console.log(ok.map(s => '  ✓ ' + s).join('\n'));
    if (fail.length) { console.log('SHOP FAIL\n' + fail.map(s => '  ✗ ' + s).join('\n')); process.exit(1); }
    console.log(`SHOP PASS — ${ok.length} checks`);
})();
