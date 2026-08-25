// ============================================================
// WHAT HAPPENS WHEN A DUEL LANDS IN AN ONLINE MATCH
//
// Reported: "errors whenever a duel happens", with a guess that it is because
// the minigames are not networked yet. Worth checking rather than accepting:
// online duels are supposed to be intercepted before any minigame is launched
// (GameController._contest), so if that is working the guess is wrong and the
// error is something else.
//
// Drives a duel deliberately — `resolveSpaceEffect(p, 'duel')` is exported, so
// the beat can be started without waiting for somebody to land on one of the
// three duel tiles — and records every error on BOTH pages through the whole
// sequence: face-off, wager, resolution, back to the board.
//
// usage: node netduel.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];

const pass = [], fail = [], notes = [];
const ok = (n, c, d) => (c ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

async function newPage(ctx, label, errors) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`[${label}] PAGEERROR ${e.message}`));
    page.on('console', m => {
        const t = m.text();
        if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push(`[${label}] ${t}`);
        if (m.type() === 'warning' && /\[net\]|\[fx\]|\[cmd\]|\[renderer\]/.test(t)) errors.push(`[${label}] WARN ${t}`);
    });
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

const snap = page => page.evaluate(async () => {
    const S = (await import('/src/core/GameState.js')).state;
    return {
        gs: S.gameState, ap: S.activePlayer, seat: S.localSeat,
        duelFoe: S.pendingDuelTarget, bet: S.pendingDuelBet,
        coins: S.players.map(p => p.coins),
        modal: [...document.querySelectorAll('.modal-box')]
            .filter(b => getComputedStyle(b).display !== 'none').map(b => b.id),
    };
});

(async () => {
    const errors = [];
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });

    try {
        const host = await newPage(ctx, 'host', errors);
        const client = await newPage(ctx, 'client', errors);
        const pages = [host, client];

        await host.click('#btn-online');
        await host.fill('#lobby-name', 'Host');
        await host.click('#btn-lobby-host');
        await host.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room', null, { timeout: 15000 });
        const code = (await host.textContent('#lobby-code')).trim();

        await client.click('#btn-online');
        await client.fill('#lobby-name', 'Client');
        await client.fill('#lobby-code-input', code);
        await client.dispatchEvent('#lobby-code-input', 'input');
        await client.click('#btn-lobby-join');
        await client.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room', null, { timeout: 15000 });

        await host.click('[data-lobby-char="slime"]');   await host.waitForTimeout(150);
        await host.click('#btn-lobby-ready');            await host.waitForTimeout(150);
        await client.click('[data-lobby-char="ghost"]'); await client.waitForTimeout(150);
        await client.click('#btn-lobby-ready');          await client.waitForTimeout(300);

        await host.waitForFunction(() => !document.getElementById('btn-lobby-start').disabled, null, { timeout: 15000 });
        await host.click('#btn-lobby-start');
        await host.waitForSelector('#map-select', { state: 'visible', timeout: 10000 });
        await host.click('[data-map-id="city_circuit"]');
        await host.click('[data-city-rounds="6"]');
        await host.click('#btn-map-confirm');

        // Through the briefing gate — both seats vote.
        const boot = Date.now() + 240000;
        while (Date.now() < boot) {
            await Promise.all(pages.map(p => p.evaluate(() => {
                const go = document.getElementById('btn-cb-start');
                const ov = document.getElementById('city-briefing');
                if (go && ov && getComputedStyle(ov).display !== 'none' && !go.disabled) go.click();
            }).catch(() => {})));
            const gs = await Promise.all(pages.map(p => p.evaluate(async () =>
                (await import('/src/core/GameState.js')).state.gameState)));
            if (gs.every(g => g !== 'INIT')) break;
            await host.waitForTimeout(1000);
        }
        await host.waitForFunction(async () =>
            (await import('/src/core/GameState.js')).state.gameState === 'PRE_ROLL',
            null, { timeout: 120000 }).catch(() => {});

        const before = await snap(host);
        errors.length = 0;   // only what the DUEL produces counts

        // ---- start a duel on the chosen seat ---------------------------------
        //
        // Whose duel it is decides which device owns the wager card, and those
        // are different code paths: the host's own is a local call, a client's
        // has to be routed to another device as an OWNER scene and its press
        // forwarded back. The first pass of this probe only ever exercised
        // whichever seat the random start happened to pick. Default to the
        // CLIENT so the wire is actually in the loop.
        const LANDER = Number(process.env.QA_DUEL_SEAT ?? 1);
        await host.evaluate(async seat => {
            const GC = await import('/src/core/GameController.js');
            const S = (await import('/src/core/GameState.js')).state;
            S.activePlayer = seat;
            S.gameState = 'ACKNOWLEDGE';
            GC.resolveSpaceEffect(S.players[seat], 'duel', {});
        }, LANDER);
        notes.push(`the duel was landed by seat ${LANDER}`);

        // Watch the whole beat and drive whatever it puts up.
        const seen = new Set();
        const sawWager = new Set();
        const t0 = Date.now();
        while (Date.now() - t0 < 40000) {
            for (let i = 0; i < pages.length; i++) {
                const s = await snap(pages[i]);
                s.modal.forEach(m => seen.add(m));
                if (s.modal.includes('duel-modal')) sawWager.add(i === 0 ? 'host' : 'client');
            }
            // Take the wager on whichever page owns it.
            await Promise.all(pages.map(pg => pg.evaluate(() => {
                const btn = document.querySelector('#duel-modal [data-bet]:not([disabled])');
                const box = document.getElementById('duel-modal');
                if (btn && box && getComputedStyle(box).display !== 'none') btn.click();
                const skip = document.getElementById('btn-duel-skip');
                if (skip && getComputedStyle(skip).display !== 'none') skip.click();
                const cont = document.getElementById('btn-msg-continue');
                const msg = document.getElementById('msg-modal');
                if (cont && msg && getComputedStyle(msg).display !== 'none') cont.click();
            }).catch(() => {})));
            const gs = await host.evaluate(async () =>
                (await import('/src/core/GameState.js')).state.gameState);
            if (gs === 'PRE_ROLL' && Date.now() - t0 > 6000) break;
            await host.waitForTimeout(400);
        }

        const after = await snap(host);
        const afterClient = await snap(client);
        notes.push(`modals seen during the duel: ${[...seen].join(', ') || 'none'}`);
        notes.push(`host  ${before.gs} -> ${after.gs}, coins ${JSON.stringify(before.coins)} -> ${JSON.stringify(after.coins)}`);
        notes.push(`client ${afterClient.gs}, modals ${JSON.stringify(afterClient.modal)}`);

        notes.push(`the wager card was on: ${[...sawWager].join(', ') || 'nobody'}`);
        ok('the wager card reaches the device whose duel it is',
            sawWager.has(LANDER === 0 ? 'host' : 'client'),
            `seat ${LANDER} duelled; card appeared on: ${[...sawWager].join(', ') || 'nobody'}`);
        ok('a duel raises its wager card', seen.has('duel-modal'),
            `modals seen: ${[...seen].join(', ') || 'none'}`);
        ok('the match is playable again afterwards', after.gs === 'PRE_ROLL',
            `left in ${after.gs}`);
        ok('both devices end on the same beat', after.gs === afterClient.gs,
            `host ${after.gs}, client ${afterClient.gs}`);
        ok('nothing is left covering the board', afterClient.modal.length === 0,
            `client modals: ${JSON.stringify(afterClient.modal)}`);
        ok('a duel produces no errors', errors.length === 0, errors.slice(0, 5).join(' | '));

        await host.screenshot({ path: path.join(__dirname, 'shot-netduel-host.png') });
        await client.screenshot({ path: path.join(__dirname, 'shot-netduel-client.png') });
    } catch (e) {
        fail.push('HARNESS: ' + (e && e.message));
    }

    await browser.close();
    console.log('\n=== A DUEL, ONLINE ===');
    notes.forEach(n => console.log('  ·     ' + n));
    pass.forEach(p => console.log('  PASS  ' + p));
    fail.forEach(f => console.log('  FAIL  ' + f));
    if (errors.length) { console.log('\n  ERRORS'); errors.slice(0, 12).forEach(e => console.log('    ' + e)); }
    console.log(`\n${pass.length} passed, ${fail.length} failed`);
    process.exit(fail.length ? 1 : 0);
})();
