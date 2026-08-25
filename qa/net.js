// ============================================================
// FOUR PHONES, ONE GAME — the Phase B gate
//
// Opens N pages in one browser, has one host a room and the rest join it, and
// plays a real match. The transport is the loopback strategy (`?net=local`),
// which is a BroadcastChannel between pages of one origin — so this exercises
// the protocol, the session, the snapshot sync, the intent authority and the
// scene mirror end to end, and substitutes only the WebRTC hop.
//
// What it asserts:
//   1. Everybody lands in the same room with distinct, ordered seats.
//   2. The match starts on every page with the same setup and seat count.
//   3. Every page agrees about the game — position, coins, whose turn — at
//      every turn boundary. This is the assertion that catches a desync, and
//      it is the reason this file exists.
//   4. A client's press reaches the host: the seat whose turn it is rolls from
//      ITS OWN page and the whole room sees the result.
//   5. A press from the WRONG page changes nothing. That is the entire
//      security model of the match, so it is tested rather than assumed.
//   6. A shared beat (the result card) shows up on every page; an owner beat
//      (the shop) shows up only on the page it belongs to.
//
// usage: node net.js [seats]        (default 3; 2..4)
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
    page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
            errors.push(`[${label}] CONSOLE: ${m.text()}`);
        }
    });
    await page.addInitScript(() => {
        try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {}
    });
    await page.goto(BASE + '?net=local', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    // Record every mirrored beat this page receives, so a missing modal can be
    // told apart from a missing message.
    await page.evaluate(async () => {
        window.__sceneLog = [];
        const T = await import('/src/net/NetTransport.js');
        T.onMessage(m => { if (m && m.t === 'scene') window.__sceneLog.push(m.k); });
    });
    return page;
}

// The lobby is DOM, so it is driven as a player would: type the name, press the
// button, tap a character, press ready.
async function lobbyEnter(page, name, code) {
    await page.fill('#lobby-name', name);
    if (code) {
        await page.fill('#lobby-code-input', code);
        await page.dispatchEvent('#lobby-code-input', 'input');
        await page.click('#btn-lobby-join');
    } else {
        await page.click('#btn-lobby-host');
    }
    await page.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room',
        null, { timeout: 15000 });
}

async function snap(page) {
    return page.evaluate(async () => {
        const S = (await import('/src/core/GameState.js')).state;
        return {
            gs: S.gameState, ap: S.activePlayer, turns: S.totalTurns, round: S.currentRound,
            seat: S.localSeat, replica: !!S.netReplica, n: S.players.length,
            p: S.players.map(p => ({ pos: p.pos, coins: p.coins, inv: p.inv.length })),
        };
    });
}

(async () => {
    const seats = Math.max(2, Math.min(4, parseInt(process.argv[2] || '3', 10)));
    const errors = [];
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    // ONE context: BroadcastChannel is scoped to an origin within a browsing
    // context group, so the pages have to share one.
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const pages = [];

    try {
        for (let i = 0; i < seats; i++) pages.push(await newPage(ctx, errors, `p${i}`));

        // ---- 1. one room, ordered seats -------------------------------------
        await pages[0].click('#btn-online');
        await lobbyEnter(pages[0], 'Host', null);
        const code = await pages[0].textContent('#lobby-code');
        ok('room code is four characters', /^[A-Z0-9]{4}$/.test((code || '').trim()), code);

        for (let i = 1; i < seats; i++) {
            await pages[i].click('#btn-online');
            await lobbyEnter(pages[i], `P${i + 1}`, code.trim());
        }
        // Give the roster a moment to propagate to everybody.
        await pages[0].waitForFunction(n => document.querySelectorAll('#lobby-seats .lobby-seat:not(.ls-empty)').length === n,
            seats, { timeout: 15000 }).catch(() => {});

        const rosters = [];
        for (const p of pages) {
            rosters.push(await p.evaluate(async () => {
                const S = await import('/src/net/NetSession.js');
                return { seat: S.mySeat(), role: S.role(), names: S.roster().map(r => r.name) };
            }));
        }
        ok('every page got a seat', rosters.every(r => typeof r.seat === 'number'),
            JSON.stringify(rosters.map(r => r.seat)));
        ok('seats are distinct and ordered',
            rosters.map(r => r.seat).join(',') === rosters.map((_, i) => i).join(','),
            JSON.stringify(rosters.map(r => r.seat)));
        ok('exactly one host', rosters.filter(r => r.role === 'host').length === 1,
            JSON.stringify(rosters.map(r => r.role)));
        ok('everybody sees the same roster',
            rosters.every(r => r.names.join('|') === rosters[0].names.join('|')),
            JSON.stringify(rosters.map(r => r.names)));

        // ---- pick characters and ready up ------------------------------------
        for (let i = 0; i < seats; i++) {
            await pages[i].click(`[data-lobby-char="${CHARS[i]}"]`);
            await pages[i].waitForTimeout(150);
            await pages[i].click('#btn-lobby-ready');
            await pages[i].waitForTimeout(150);
        }
        await pages[0].waitForFunction(() => !document.getElementById('btn-lobby-start').disabled,
            null, { timeout: 15000 });
        ok('the host can start once everybody is ready', true);

        // ---- 2. the match starts everywhere ----------------------------------
        await pages[0].click('#btn-lobby-start');
        await pages[0].waitForSelector('#map-select', { state: 'visible', timeout: 10000 });
        await pages[0].click('[data-map-id="city_circuit"]');
        await pages[0].click('[data-city-rounds="6"]');
        await pages[0].click('#btn-map-confirm');

        // City's opening flyover is a fixed-duration animation driven by frame
        // deltas, so on software GL its wall-clock length is measured in tens
        // of seconds — and here THREE pages are rendering it at once. Waiting a
        // couple of seconds and hoping meant every later assertion ran against
        // a game still on its title shot. Wait for the real thing, and keep
        // pressing the briefing away until it goes.
        const dismiss = () => Promise.all(pages.map(p => p.evaluate(() => {
            const ov = document.getElementById('city-briefing');
            const go = document.getElementById('btn-cb-start');
            if (go && ov && getComputedStyle(ov).display !== 'none') go.click();
        }).catch(() => {})));

        const bootDeadline = Date.now() + 240000;
        let booted = false;
        while (Date.now() < bootDeadline) {
            await dismiss();
            const gs = await Promise.all(pages.map(p => p.evaluate(async () =>
                (await import('/src/core/GameState.js')).state.gameState)));
            if (gs.every(g => g !== 'INIT')) { booted = true; break; }
            await pages[0].waitForTimeout(1000);
        }
        ok('every page reaches a live turn', booted,
            booted ? '' : 'still on the opening flyover after 240s');

        const starts = [];
        for (const p of pages) starts.push(await snap(p));
        ok('the match started on every page', starts.every(s => s.n === seats),
            JSON.stringify(starts.map(s => s.n)));
        ok('each page knows which seat it is',
            starts.every((s, i) => s.seat === i), JSON.stringify(starts.map(s => s.seat)));
        ok('one host and n-1 replicas',
            starts.filter(s => s.replica).length === seats - 1,
            JSON.stringify(starts.map(s => s.replica)));

        // ---- 5. a press from the wrong page does nothing ----------------------
        {
            // Only meaningful once somebody's turn is actually open — before
            // that a refusal proves nothing.
            await pages[0].waitForFunction(async () =>
                (await import('/src/core/GameState.js')).state.gameState === 'PRE_ROLL',
                null, { timeout: 120000 }).catch(() => {});
            const before = await snap(pages[0]);
            const impostor = (before.ap + 1) % seats;
            await pages[impostor].evaluate(async () => {
                const C = await import('/src/core/Commands.js');
                C.run('roll', 1.2);
            });
            await pages[0].waitForTimeout(1200);
            const after = await snap(pages[0]);
            ok('a roll from the wrong page is refused',
                after.gs === before.gs && after.turns === before.turns,
                `state ${before.gs}→${after.gs}, turns ${before.turns}→${after.turns}`);
        }

        // ---- 3 + 4. play, and check everybody agrees --------------------------
        const disagreements = [];
        let rollsFromClients = 0;
        let lastCheckedTurn = -1;
        // Budget for four turns with headroom. Measured pace once the stall
        // described below was fixed is the number to check this against.
        const loopStart = Date.now();
        const deadline = loopStart + parseInt(process.env.QA_BUDGET || '700', 10) * 1000;

        while (Date.now() < deadline) {
            const host = await snap(pages[0]);
            if (host.turns >= 8) break;

            // Drive from the page that owns the turn — that is the whole point.
            const driver = pages[host.ap];
            const acted = await driver.evaluate(() => window.__QA.step());
            if (host.ap !== 0 && acted === 'ROLL') rollsFromClients++;

            // Compare every page against the host AT REST.
            //
            // Sampling the host and then each client is three separate round
            // trips into three busy pages, and the host can legitimately move
            // between them — so a naive comparison flags the host being ahead,
            // which is not a desync, it is latency. The property that actually
            // matters is CONVERGENCE: once the host has stopped, everybody
            // arrives at the same game. So: confirm the host is still where it
            // was, then read the clients, then confirm the host has STILL not
            // moved. Only a mismatch inside a window where the host was
            // provably idle counts.
            // Once per TURN, not once per poll. The settle-and-compare below
            // costs a second and four cross-page round trips, and running it on
            // every iteration ate the whole budget for two turns of play.
            if (host.gs === 'PRE_ROLL' && host.turns !== lastCheckedTurn) {
                lastCheckedTurn = host.turns;
                await pages[0].waitForTimeout(500);
                const settled = await snap(pages[0]);
                if (settled.gs === 'PRE_ROLL' && settled.turns === host.turns
                    && settled.ap === host.ap) {
                    const clients = [];
                    for (let i = 1; i < seats; i++) clients.push(await snap(pages[i]));
                    const after = await snap(pages[0]);
                    const hostHeld = after.turns === settled.turns && after.ap === settled.ap
                        && after.p.every((q, k) => q.pos === settled.p[k].pos && q.coins === settled.p[k].coins);
                    if (hostHeld) {
                        clients.forEach((c, idx) => {
                            const same = c.ap === settled.ap && c.turns === settled.turns
                                && c.p.every((q, k) => q.pos === settled.p[k].pos && q.coins === settled.p[k].coins);
                            if (!same) disagreements.push({ page: idx + 1, host: settled, client: c });
                        });
                    }
                }
            }
            await page0Wait(pages[0]);
        }

        ok('every page agrees with the host at every turn boundary',
            disagreements.length === 0,
            disagreements.length ? JSON.stringify(disagreements[0]).slice(0, 300) : '');
        ok('a client seat rolled its own dice', rollsFromClients > 0,
            `${rollsFromClients} client-driven rolls`);

        // How far it got, and how fast.
        //
        // FOUR turns, so the rotation is exercised rather than sampled: at three
        // seats that is every player taking one and the turn coming back round.
        //
        // This assertion earned its keep. I once read a low count here as this
        // container being slow and relaxed the bar accordingly — and the low
        // count was a real stall. Owner-tier scenes are routed to one phone by
        // the `seat` on their payload, the result card was emitted without one,
        // and so the most common beat in the game was dropped instead of
        // delivered. A client's turn reached "here is what happened to you" and
        // stopped there with nothing to press. The host's own turns completed
        // normally, which is exactly why the count was low rather than zero,
        // and why it looked like slowness.
        //
        // So: a shortfall here is a stall until proven otherwise. The pace is
        // printed to make that judgement from evidence rather than from a
        // guess about the hardware.
        const played = await snap(pages[0]);
        const secs = Math.round((Date.now() - loopStart) / 1000);
        const pace = played.turns ? Math.round(secs / played.turns) : Infinity;
        ok('the match advances through networked turns', played.turns >= 4,
            `${played.turns} turns in ${secs}s (${pace === Infinity ? 'no' : pace + 's per'} turn)`);

        // ---- 6. shared beats travel; owner beats do not -----------------------
        {
            const seen = [];
            for (const p of pages) {
                seen.push(await p.evaluate(async () => {
                    const M = await import('/src/ui/ModalManager.js');
                    const S = (await import('/src/core/GameState.js')).state;
                    // Raise a SHARED beat from the host only; the mirror should
                    // put it on the others.
                    return { seat: S.localSeat, hasModalApi: typeof M.showMessage === 'function' };
                }));
            }
            await pages[0].evaluate(async () => {
                const M = await import('/src/ui/ModalManager.js');
                M.showMessage('MIRROR TEST', 'shared beat', '🔁', { tier: 'shared' });
            });
            // Three pages doing software GL are slow; the mirrored beat has an
            // async import to get through before it can paint.
            await pages[0].waitForTimeout(2500);
            const titles = [], received = [];
            for (const p of pages) {
                titles.push(await p.evaluate(() => (document.getElementById('msg-title') || {}).textContent || ''));
                // If a page did not paint it, say whether the message even
                // arrived — a transport problem and a replay problem need
                // different fixes and look identical from the DOM.
                received.push(await p.evaluate(() => (window.__sceneLog || []).slice(-4)));
            }
            ok('a shared beat reaches every page',
                titles.every(t => t === 'MIRROR TEST'),
                titles.every(t => t === 'MIRROR TEST') ? '' :
                `titles ${JSON.stringify(titles)} · scenes seen ${JSON.stringify(received)}`);

            // An OWNER beat aimed at seat 1 must not appear on seat 2.
            if (seats >= 3) {
                await pages[0].evaluate(async () => {
                    const M = await import('/src/ui/ModalManager.js');
                    M.closeAllModals();
                });
                await pages[0].waitForTimeout(500);
                const shopVisible = [];
                await pages[0].evaluate(async () => {
                    const Scenes = await import('/src/ui/Scenes.js');
                    Scenes.emit('shop', { district: 'ring', discount: 1, seat: 1 });
                });
                await pages[0].waitForTimeout(2500);
                for (const p of pages) {
                    shopVisible.push(await p.evaluate(() => {
                        const el = document.getElementById('shop-modal');
                        return !!el && getComputedStyle(el).display !== 'none';
                    }));
                }
                ok('an owner beat reaches only its own page',
                    shopVisible[1] === true && shopVisible[2] === false,
                    JSON.stringify(shopVisible));
            }
        }

        ok('no page or console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
        for (let i = 0; i < seats; i++) {
            await pages[i].screenshot({ path: path.join(__dirname, `shot-net-${seats}p-seat${i}.png`) });
        }
    } catch (e) {
        fail.push('HARNESS: ' + (e && e.message));
    }

    await browser.close();
    console.log(`\n=== NETWORKED BOARD (${seats} seats, loopback transport) ===`);
    pass.forEach(p => console.log('  PASS  ' + p));
    fail.forEach(f => console.log('  FAIL  ' + f));
    console.log(`\n${pass.length} passed, ${fail.length} failed`);
    process.exit(fail.length ? 1 : 0);
})();

function page0Wait(p) { return p.waitForTimeout(160); }
