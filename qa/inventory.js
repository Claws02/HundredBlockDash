// ============================================================
// Two guarantees:
//
//   1. BAG FULL. Picking up a mystery item or buying one with three items
//      already held puts all FOUR on screen — the three you carry and the one
//      you just got. Tapping only selects; a DISCARD press commits. Choosing
//      the incoming item keeps your bag and, on a purchase, costs nothing.
//
//   2. MINIGAME ROTATION. Inside one match a minigame cannot come up twice
//      until every other one has been played.
//
// usage: node inventory.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

async function boot(page) {
    await page.evaluate(c => window.__QA.startRun(c), {
        mode: '1p', difficulty: 'medium', map: 'hundred_block_dash', len: 50,
    });
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

// Read the picker as a player sees it.
const readPicker = page => page.evaluate(() => {
    const box = document.getElementById('drop-modal');
    const cards = [...document.querySelectorAll('#drop-inv-row .drop-card')].map(c => ({
        idx: parseInt(c.dataset.dropIdx),
        name: (c.querySelector('.dc-name') || {}).textContent || '',
        desc: (c.querySelector('.dc-desc') || {}).textContent || '',
        incoming: c.classList.contains('incoming'),
        selected: c.classList.contains('sel'),
        onScreen: (() => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })(),
    }));
    const btn = document.getElementById('btn-confirm-drop');
    const br = btn.getBoundingClientRect();
    return {
        shown: getComputedStyle(box).display !== 'none',
        desc: document.getElementById('drop-desc').textContent,
        cards,
        btnText: btn.textContent, btnDisabled: btn.disabled,
        btnOnScreen: br.top >= 0 && br.bottom <= window.innerHeight,
    };
});

// The picker arrives on a Director beat, whose floor is not a fixed number of
// milliseconds — a flat sleep read the modal before it opened once in three
// runs. Wait for the thing itself.
const awaitPicker = page => page.waitForFunction(
    () => getComputedStyle(document.getElementById('drop-modal')).display !== 'none',
    null, { timeout: 15000 });

const tapCard = (page, idx) => page.evaluate(i => {
    document.querySelector(`#drop-inv-row .drop-card[data-drop-idx="${i}"]`).click();
}, idx);

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
    ok('boot: HBD match at the roll', await boot(page));

    // ══════════════ 1. MYSTERY WITH A FULL BAG ══════════════
    // Park on a mystery space with three items held and land on it for real, so
    // this exercises the same beat order the game uses.
    await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const R = await import('/src/engine/Renderer.js');
        state.activePlayer = 0;
        const p = state.players[0];
        p.inv = ['shield', 'anchor', 'steal'];
        p.coins = 60;
        p.pos = 12; p.prevPos = 12;
        if (p.mesh) p.mesh.position.copy(R.getPos(12));
        state.board[12] = { type: 'mystery' };
    });
    await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        state.gameState = 'ACKNOWLEDGE';
        GC.resolveSpace(state.players[0]);
    });
    const opened = await awaitPicker(page).then(() => true, () => false);
    ok('mystery: the picker opens on its own beat', opened);

    const picker = await readPicker(page);
    ok('mystery: a full bag opens the picker instead of the usual card',
       picker.shown, `shown=${picker.shown}`);
    ok('mystery: all four items are on screen — three held plus the new one',
       picker.cards.length === 4 && picker.cards.filter(c => c.incoming).length === 1,
       `${picker.cards.length} cards, ${picker.cards.filter(c => c.incoming).length} marked new`);
    ok('mystery: every card is fully on screen',
       picker.cards.every(c => c.onScreen) && picker.btnOnScreen,
       picker.cards.map(c => c.onScreen).join(','));
    ok('mystery: each card says what the item does',
       picker.cards.every(c => c.name && c.desc.length > 8),
       picker.cards.map(c => `${c.name}:${c.desc.length}`).join(' '));
    ok('mystery: the incoming item is named in the prompt',
       /you found/i.test(picker.desc), `"${picker.desc}"`);
    ok('mystery: nothing is selected yet, so DISCARD is disabled',
       picker.btnDisabled && !picker.cards.some(c => c.selected), picker.btnText);

    // Tapping selects, and only selects.
    await tapCard(page, 1);
    const afterTap = await readPicker(page);
    const invAfterTap = await page.evaluate(async () =>
        (await import('/src/core/GameState.js')).state.players[0].inv.join(','));
    ok('mystery: tapping a card selects it without discarding anything',
       afterTap.cards.filter(c => c.selected).length === 1
       && afterTap.cards.find(c => c.selected).idx === 1
       && invAfterTap === 'shield,anchor,steal',
       `selected idx=${(afterTap.cards.find(c => c.selected) || {}).idx}, inv=${invAfterTap}`);
    ok('mystery: the button names the item it is about to throw away',
       /DISCARD/.test(afterTap.btnText) && /ANCHOR/i.test(afterTap.btnText) && !afterTap.btnDisabled,
       `"${afterTap.btnText}"`);

    // Re-tapping moves the selection rather than stacking it.
    await tapCard(page, 2);
    const moved = await readPicker(page);
    ok('mystery: selecting another card moves the selection',
       moved.cards.filter(c => c.selected).length === 1 && moved.cards.find(c => c.selected).idx === 2,
       moved.cards.filter(c => c.selected).map(c => c.idx).join(','));
    await page.screenshot({ path: path.join(__dirname, 'shot-drop-picker.png') });

    // Commit.
    const newItem = picker.cards.find(c => c.incoming).name;
    await page.evaluate(() => document.getElementById('btn-confirm-drop').click());
    await page.waitForTimeout(600);
    const afterDrop = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return { inv: state.players[0].inv.slice(), coins: state.players[0].coins,
                 shown: getComputedStyle(document.getElementById('drop-modal')).display !== 'none' };
    });
    ok('mystery: DISCARD swaps the chosen item for the new one',
       afterDrop.inv.length === 3 && !afterDrop.inv.includes('steal') && !afterDrop.shown,
       `inv=[${afterDrop.inv}] (dropped Steal, gained ${newItem})`);

    // ══════════════ 2. BUYING WITH A FULL BAG ══════════════
    const buy = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        // Confirming the drop ended the turn, so the bot is the active player
        // now. buyItem() acts on whoever is active — put P1 back on the clock.
        state.activePlayer = 0;
        const p = state.players[0];
        p.inv = ['shield', 'anchor', 'steal'];
        p.coins = 60;
        state.pendingShopDistrict = 'ring'; state.pendingShopDiscount = 1.0;
        state.gameState = 'SHOP';
        const before = p.coins;
        GC.buyItem('rocket', 20);
        return { before };
    });
    await awaitPicker(page);
    const shopPicker = await readPicker(page);
    ok('shop: buying with a full bag opens the same picker',
       shopPicker.shown && shopPicker.cards.length === 4, `${shopPicker.cards.length} cards`);
    ok('shop: the prompt says it was bought and that backing out cancels it',
       /you bought/i.test(shopPicker.desc) && /cancels the purchase/i.test(shopPicker.desc),
       `"${shopPicker.desc}"`);

    // Choose to keep what you have: the purchase must not be charged.
    await tapCard(page, -1);
    const keepSel = await readPicker(page);
    ok('shop: the incoming item is itself a legal choice',
       !keepSel.btnDisabled && /ROCKET/i.test(keepSel.btnText), `"${keepSel.btnText}"`);
    await page.evaluate(() => document.getElementById('btn-confirm-drop').click());
    await page.waitForTimeout(600);
    const afterKeep = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return { inv: state.players[0].inv.slice(), coins: state.players[0].coins };
    });
    ok('shop: throwing away the new item leaves your three untouched',
       afterKeep.inv.join(',') === 'shield,anchor,steal', `inv=[${afterKeep.inv}]`);
    ok('shop: and costs nothing — you are not charged for what you binned',
       afterKeep.coins === buy.before, `${buy.before} → ${afterKeep.coins} coins`);

    // Now actually take it, and check the coins DO come out.
    await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        state.activePlayer = 0;
        state.pendingShopDistrict = 'ring'; state.pendingShopDiscount = 1.0;
        state.gameState = 'SHOP';
        GC.buyItem('rocket', 20);
    });
    await awaitPicker(page);
    await tapCard(page, 0);
    await page.evaluate(() => document.getElementById('btn-confirm-drop').click());
    await page.waitForTimeout(600);
    const afterBuy = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return { inv: state.players[0].inv.slice(), coins: state.players[0].coins };
    });
    ok('shop: taking the new item charges the price exactly once',
       afterBuy.coins === buy.before - 20 && afterBuy.inv.includes('rocket'),
       `${buy.before} → ${afterBuy.coins} coins, inv=[${afterBuy.inv}]`);

    // ══════════════ 2b. PASS-THROUGH SHOP ══════════════
    // A shop entered mid-move must still be mid-move after the picker. The
    // return state used to be overwritten with plain 'shop', so closing the
    // shop ended the turn and the rest of the hop was silently dropped.
    const passThrough = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        state.activePlayer = 0;
        const p = state.players[0];
        p.inv = ['shield', 'anchor', 'steal'];
        p.coins = 60;
        state.pendingShopDistrict = 'ring'; state.pendingShopDiscount = 1.0;
        state.gameState = 'SHOP';
        state.pendingReturnState = 'pass_through_done';   // as shopOfferEnter sets it
        GC.buyItem('rocket', 20);
        return { ret: state.pendingReturnState };
    });
    await awaitPicker(page);
    ok('pass-through: entering the picker keeps the mid-move return state',
       passThrough.ret === 'pass_through_done', passThrough.ret);
    await tapCard(page, 0);
    await page.evaluate(() => document.getElementById('btn-confirm-drop').click());
    await page.waitForTimeout(600);
    const ptAfter = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return { ret: state.pendingReturnState, coins: state.players[0].coins,
                 inv: state.players[0].inv.slice(),
                 shopUp: getComputedStyle(document.getElementById('shop-modal')).display !== 'none' };
    });
    ok('pass-through: it survives the discard, so the rest of the move is not lost',
       ptAfter.ret === 'pass_through_done', `ret=${ptAfter.ret}`);
    ok('pass-through: the swap happened and was charged',
       ptAfter.inv.includes('rocket') && ptAfter.coins === 40 && ptAfter.shopUp,
       `inv=[${ptAfter.inv}] coins=${ptAfter.coins} shop=${ptAfter.shopUp}`);

    // ══════════════ 3. MINIGAME ROTATION ══════════════
    const rot = await page.evaluate(async () => {
        const MGM = await import('/src/minigames/MinigameManager.js');
        const { MG_TYPES } = await import('/src/config/MinigameRegistry.js');
        const { state } = await import('/src/core/GameState.js');
        state.mgBag = []; state.mgLastType = '';
        const draws = [];
        for (let i = 0; i < MG_TYPES.length * 3; i++) draws.push(MGM.nextMgType());
        return { draws, roster: MG_TYPES.slice() };
    });
    const N = rot.roster.length;
    const cycles = [rot.draws.slice(0, N), rot.draws.slice(N, 2 * N), rot.draws.slice(2 * N)];
    ok('rotation: the first pass plays every game exactly once, none twice',
       new Set(cycles[0]).size === N, `${new Set(cycles[0]).size} distinct of ${N}`);
    ok('rotation: so does the second pass, and the third',
       new Set(cycles[1]).size === N && new Set(cycles[2]).size === N,
       `${new Set(cycles[1]).size} / ${new Set(cycles[2]).size} of ${N}`);
    ok('rotation: the whole roster is covered, not a subset',
       rot.roster.every(t => cycles[0].includes(t)), `missing: ${rot.roster.filter(t => !cycles[0].includes(t))}`);
    let adjacent = 0;
    for (let i = 1; i < rot.draws.length; i++) if (rot.draws[i] === rot.draws[i - 1]) adjacent++;
    ok('rotation: no game ever follows itself, including across a refill',
       adjacent === 0, `${adjacent} back-to-back repeat(s)`);
    ok('rotation: the order is shuffled, not the registry order',
       cycles[0].join(',') !== rot.roster.join(',') || cycles[1].join(',') !== rot.roster.join(','),
       cycles[0].slice(0, 5).join(','));

    // A new match must deal a new bag rather than continue the old one.
    const fresh = await page.evaluate(async () => {
        const { state, resetPlayers } = await import('/src/core/GameState.js');
        resetPlayers();
        return { bag: state.mgBag.length, last: state.mgLastType };
    });
    ok('rotation: a new match starts from a fresh bag',
       fresh.bag === 0 && fresh.last === '', JSON.stringify(fresh));

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-inventory.json'),
        JSON.stringify({ pass, fail, picker, afterDrop, afterKeep, afterBuy,
                         draws: rot.draws, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
