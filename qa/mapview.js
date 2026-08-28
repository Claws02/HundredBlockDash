// ============================================================
// THE MAP IS A LOCAL VIEW — is it?
//
// Commands.js says scouting the board is deliberately NOT on the wire: "one
// player's map scroll everybody's is not multiplayer, it is remote control."
// But UIManager.openMap() writes state.gameState = 'MAP' and
// state.cameraState = 'MAP', and both of those ARE on the wire.
//
// So this probe asks two questions a person would otherwise have to sit two
// phones side by side to answer:
//
//   1. CLIENT. Can a client scout at all, or does the next snapshot (20 Hz)
//      overwrite gameState/cameraState back to the host's and take the map
//      away from under them?
//   2. HOST. While the host has the map open, gameState is 'MAP' for the whole
//      match — and NetSync.authorised() gates `roll` on ONLY_IN.roll = PRE_ROLL.
//      Does the host scouting the board refuse another seat's roll?
//
// usage: node mapview.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];

const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);
const CHARS = ['slime', 'ghost', 'boxy', 'bunny'];

async function newPage(ctx, errors, label) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`[${label}] PAGEERROR: ${e.message}`));
    await page.addInitScript(() => {
        try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {}
    });
    await page.goto(BASE + '?net=local', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    return page;
}

async function lobbyEnter(page, name, code) {
    if (code) {
        await page.fill('#lobby-code-input', code);
        await page.dispatchEvent('#lobby-code-input', 'input');
        await page.click('#btn-lobby-join');
    } else {
        await page.click('#btn-lobby-host');
    }
    await page.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room',
        null, { timeout: 15000 });
    await page.fill('#lobby-name', name);
    await page.dispatchEvent('#lobby-name', 'input');
    await page.waitForTimeout(400);
}

const view = page => page.evaluate(async () => {
    const S = (await import('/src/core/GameState.js')).state;
    const disp = id => { const e = document.getElementById(id); return e ? getComputedStyle(e).display : 'gone'; };
    return { gs: S.gameState, cam: S.cameraState, mapUi: disp('map-ui'), uiLayer: disp('ui-layer') };
});

(async () => {
    const seats = 2;
    const errors = [];
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const pages = [];
    try {
        for (let i = 0; i < seats; i++) pages.push(await newPage(ctx, errors, `p${i}`));

        await pages[0].click('#btn-online');
        await lobbyEnter(pages[0], 'Host', null);
        const code = (await pages[0].textContent('#lobby-code')).trim();
        for (let i = 1; i < seats; i++) {
            await pages[i].click('#btn-online');
            await lobbyEnter(pages[i], `P${i + 1}`, code);
        }
        for (let i = 0; i < seats; i++) {
            await pages[i].click(`[data-lobby-char="${CHARS[i]}"]`);
            await pages[i].waitForTimeout(150);
            await pages[i].click('#btn-lobby-ready');
            await pages[i].waitForTimeout(150);
        }
        await pages[0].waitForFunction(() => !document.getElementById('btn-lobby-start').disabled,
            null, { timeout: 15000 });
        await pages[0].click('#btn-lobby-start');
        await pages[0].waitForSelector('#map-select', { state: 'visible', timeout: 10000 });
        await pages[0].click('[data-map-id="city_circuit"]');
        await pages[0].click('[data-city-rounds="6"]');
        await pages[0].click('#btn-map-confirm');

        const dismiss = () => Promise.all(pages.map(p => p.evaluate(() => {
            const ov = document.getElementById('city-briefing');
            const go = document.getElementById('btn-cb-start');
            if (go && ov && getComputedStyle(ov).display !== 'none') go.click();
        }).catch(() => {})));

        const deadline = Date.now() + 240000;
        let booted = false;
        while (Date.now() < deadline) {
            await dismiss();
            const gs = await Promise.all(pages.map(p => p.evaluate(async () =>
                (await import('/src/core/GameState.js')).state.gameState)));
            if (gs.every(g => g !== 'INIT')) { booted = true; break; }
            await pages[0].waitForTimeout(1000);
        }
        ok('every page reaches a live turn', booted);
        if (!booted) throw new Error('never booted');

        // ---- 1. a CLIENT scouts the board -----------------------------------
        const host = pages[0];
        const client = pages[1];
        await client.evaluate(async () => (await import('/src/ui/UIManager.js')).openMap());
        const immediately = await view(client);
        await client.waitForTimeout(1200);          // ≥ 20 snapshots
        const after = await view(client);
        console.log('client at open   :', JSON.stringify(immediately));
        console.log('client 1.2s later:', JSON.stringify(after));
        ok('a client\'s map opens', immediately.gs === 'MAP' && immediately.mapUi !== 'none');
        ok('a client\'s map SURVIVES the next snapshot (gameState still MAP)',
            after.gs === 'MAP', `gameState became ${after.gs}`);
        ok('a client\'s map camera survives the next snapshot',
            after.cam === 'MAP', `cameraState became ${after.cam}`);
        ok('the board HUD stays out from under a client\'s map',
            after.uiLayer === 'none', `ui-layer display is ${after.uiLayer}`);

        // ...but only while the host is idle. A snapshot is only pushed when the
        // host's signature MOVES, so the question is not whether the map holds
        // for a second, it is whether it holds when the game does something.
        await host.evaluate(async () => {
            const C = await import('/src/core/Commands.js');
            C.runLocal('roll', 1.2);
        }).catch(() => {});
        await client.waitForTimeout(2500);
        const during = await view(client);
        console.log('client while the host rolls:', JSON.stringify(during));
        ok('a client\'s map survives the host actually PLAYING',
            during.gs === 'MAP' && during.cam === 'MAP' && during.uiLayer === 'none',
            `gs ${during.gs} / cam ${during.cam} / ui-layer ${during.uiLayer}`);

        await client.evaluate(async () => (await import('/src/ui/UIManager.js')).closeMap());
        await client.waitForTimeout(2500);

        // ---- 2. the HOST scouts the board while a client wants to roll -------
        // Baseline taken with the host idle and NOT scouting, so the only thing
        // that can move this camera afterwards is the host opening its own map.
        await client.waitForTimeout(1500);
        const camBefore = await client.evaluate(async () =>
            (await import('/src/engine/Renderer.js')).getCamera().position.toArray());
        await host.evaluate(async () => (await import('/src/ui/UIManager.js')).openMap());
        await host.waitForTimeout(1500);
        const hostView = await view(host);
        console.log('host with map open:', JSON.stringify(hostView));

        const verdicts = await host.evaluate(async () => {
            const Sync = await import('/src/net/NetSync.js');
            const S = (await import('/src/core/GameState.js')).state;
            return { gs: S.gameState, ap: S.activePlayer,
                     rollOk: Sync.authorised(S.activePlayer, 'roll', [1.2]) };
        });
        console.log('authority while the host is scouting:', JSON.stringify(verdicts));
        ok('the active seat may still roll while the HOST has the map open',
            verdicts.rollOk === true,
            `authorised(seat ${verdicts.ap}, "roll") === ${verdicts.rollOk} with gameState ${verdicts.gs}`);

        // What every OTHER device now believes the game is doing.
        const spread = await Promise.all(pages.map(view));
        console.log('every page while the host scouts:', JSON.stringify(spread.map(v => v.gs)));
        ok('the host scouting does not push MAP onto the other devices',
            spread.slice(1).every(v => v.gs !== 'MAP'),
            JSON.stringify(spread.map(v => v.gs)));

        // The camera is the part a player would actually notice: cameraState is
        // on the wire too, so the host opening its map points every other phone
        // at that phone's own map target.
        const camNow = await client.evaluate(async () =>
            (await import('/src/engine/Renderer.js')).getCamera().position.toArray());
        const moved = camBefore && camNow &&
            Math.hypot(camNow[0] - camBefore[0], camNow[1] - camBefore[1], camNow[2] - camBefore[2]);
        console.log('client camera moved by', moved, 'while the host scouted');
        ok('the host scouting does not move the camera on other phones',
            !(moved > 5), `client camera travelled ${Math.round(moved)} world units`);
    } catch (e) {
        fail.push(`THREW — ${e.message}`);
    } finally {
        await browser.close();
    }

    console.log('\n--- pass ---'); pass.forEach(p => console.log('  OK  ' + p));
    console.log('--- fail ---'); fail.forEach(f => console.log('  XX  ' + f));
    if (errors.length) { console.log('--- page errors ---'); errors.forEach(e => console.log('  !!  ' + e)); }
    process.exit(fail.length ? 1 : 0);
})();
