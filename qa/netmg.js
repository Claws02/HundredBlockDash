// ============================================================
// A MINIGAME, PLAYED ON TWO PHONES AT ONCE
//
// Networked rounds used to announce a draw and move on. They now run a real
// game: every device plays the same challenge from the same seed, alone, and
// the scores are compared. The things that can go wrong are specific:
//
//   • the announcement reaches one device and not the other, so one phone is
//     playing a game the other has never heard of;
//   • a score is reported but never counted, so the host waits out the grace
//     period every single round;
//   • the scoreboard goes up and nothing takes it down, which is the exact
//     failure shape that has stranded a client four times already;
//   • the round ends but the board never resumes.
//
// This drives a real round to completion on both pages and checks all four.
//
// usage: node netmg.js
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
        if (m.type() === 'warning' && /\[solo\]|\[net\]/.test(t)) errors.push(`[${label}] WARN ${t}`);
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

const look = page => page.evaluate(() => {
    const vis = id => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
    // The card and the board live inside the layer, and getComputedStyle does
    // not account for a hidden ancestor — reading them on their own reported a
    // card that was up when the whole layer was down, which is how the first
    // run of this probe sampled a title before it had been written.
    const layer = vis('solo-layer');
    return {
        layer,
        card:  layer && vis('solo-card'),
        board: layer && vis('solo-board'),
        title: (document.getElementById('solo-title') || {}).textContent || '',
        rows:  [...document.querySelectorAll('#solo-rows .solo-row')].map(r => ({
            name: (r.querySelector('.sr-name') || {}).textContent || '',
            score: (r.querySelector('.sr-score') || {}).textContent || '',
            win: r.classList.contains('is-win'),
        })),
        goVisible: (() => { const b = document.getElementById('btn-solo-go');
                            return !!b && getComputedStyle(b).display !== 'none' && !b.disabled; })(),
    };
});

const gs = page => page.evaluate(async () => (await import('/src/core/GameState.js')).state.gameState);

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
        await host.click('#btn-lobby-host');
        await host.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room', null, { timeout: 15000 });
        const code = (await host.textContent('#lobby-code')).trim();

        await client.click('#btn-online');
        await client.fill('#lobby-code-input', code);
        await client.dispatchEvent('#lobby-code-input', 'input');
        await client.click('#btn-lobby-join');
        await client.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room', null, { timeout: 15000 });

        await host.click('[data-lobby-char="slime"]');   await host.waitForTimeout(200);
        await host.click('#btn-lobby-ready');            await host.waitForTimeout(200);
        await client.click('[data-lobby-char="ghost"]'); await client.waitForTimeout(200);
        await client.click('#btn-lobby-ready');          await client.waitForTimeout(400);

        await host.waitForFunction(() => !document.getElementById('btn-lobby-start').disabled, null, { timeout: 15000 });
        await host.click('#btn-lobby-start');
        await host.waitForSelector('#map-select', { state: 'visible', timeout: 10000 });
        await host.click('[data-map-id="city_circuit"]');
        await host.click('[data-city-rounds="6"]');
        await host.click('#btn-map-confirm');

        const boot = Date.now() + 240000;
        while (Date.now() < boot) {
            await Promise.all(pages.map(p => p.evaluate(() => {
                const go = document.getElementById('btn-cb-start');
                const ov = document.getElementById('city-briefing');
                if (go && ov && getComputedStyle(ov).display !== 'none' && !go.disabled) go.click();
            }).catch(() => {})));
            const g = await Promise.all(pages.map(gs));
            if (g.every(x => x && x !== 'INIT')) break;
            await host.waitForTimeout(1000);
        }
        errors.length = 0;   // only what the ROUND produces counts

        // ---- start a round deliberately -------------------------------------
        // Waiting for one to come round naturally means playing six rounds of
        // board; the round is the thing under test, so it is started directly.
        const started = await host.evaluate(async () => {
            const N = await import('/src/net/NetMinigame.js');
            const S = (await import('/src/core/GameState.js')).state;
            const type = N.pickGame(3);
            if (!type) return null;
            window.__mgWinner = undefined;
            N.hostRun(type, [0, 1], w => { window.__mgWinner = w; });
            return { type, seats: [0, 1], seat: S.localSeat };
        });
        ok('there is a game that can be played across phones', !!started,
            'the registry has no parallel-tagged game');
        notes.push(`the round was ${started && started.type}`);

        // ---- the card reaches BOTH devices ----------------------------------
        // Wait for it rather than sampling at a guessed moment: the client
        // reaches this through a mirrored scene and a dynamic import.
        await Promise.all(pages.map(p => p.waitForFunction(() => {
            const l = document.getElementById('solo-layer');
            return !!l && getComputedStyle(l).display !== 'none';
        }, null, { timeout: 20000 }).catch(() => {})));
        const cards = await Promise.all(pages.map(look));
        notes.push(`cards — host ${JSON.stringify({ card: cards[0].card, title: cards[0].title })}, ` +
                   `client ${JSON.stringify({ card: cards[1].card, title: cards[1].title })}`);
        ok('the round is announced on both devices', cards.every(c => c.card),
            `host ${cards[0].card}, client ${cards[1].card}`);
        ok('both devices name the same game', cards[0].title === cards[1].title && !!cards[0].title,
            `"${cards[0].title}" vs "${cards[1].title}"`);
        ok('both players are offered a START', cards.every(c => c.goVisible),
            `host ${cards[0].goVisible}, client ${cards[1].goVisible}`);

        // ---- NOBODY STARTS UNTIL EVERYBODY IS READY --------------------------
        //
        // The bug this guards: each player's press used to take their own card
        // down and start their own clock, so four phones ran four different
        // thirty-second rounds offset by however long people took to tap. A
        // round scored by comparing what each player managed in the same time
        // cannot be settled that way. Pressing ONE ready must start nothing.
        await pages[0].click('#btn-solo-go');
        await pages[0].waitForTimeout(1500);
        const early = await Promise.all(pages.map(p => p.evaluate(() => ({
            playfield: !!document.querySelector('#minigame-layer canvas'),
            cardUp: (() => {
                const l = document.getElementById('solo-layer');
                return !!l && getComputedStyle(l).display !== 'none';
            })(),
        }))));
        ok('one player pressing READY starts nothing',
            !early[0].playfield && !early[1].playfield,
            `host playfield ${early[0].playfield}, client ${early[1].playfield}`);
        ok('the player who pressed is told what the round is waiting for',
            early[0].cardUp, `host card still up: ${early[0].cardUp}`);

        // ---- the last press opens the gate, and both start together ----------
        await pages[1].click('#btn-solo-go');
        // The game is a dynamic import on each device; under swiftshader the
        // first one is not instant. Wait for it rather than sampling once.
        await Promise.all(pages.map(p => p.waitForFunction(
            () => !!document.querySelector('#minigame-layer canvas'),
            null, { timeout: 20000 }).catch(() => {})));
        const playing = await Promise.all(pages.map(p => p.evaluate(() => {
            const c = document.querySelector('#minigame-layer canvas');
            const l = document.getElementById('minigame-layer');
            return !!c && !!l && getComputedStyle(l).display !== 'none';
        })));
        ok('the game itself is on screen, and VISIBLE, on both devices', playing.every(Boolean),
            `host ${playing[0]}, client ${playing[1]}`);

        // Play it: drag around so the score is not zero on either side.
        const t0 = Date.now();
        while (Date.now() - t0 < 30000) {
            const done = await host.evaluate(() => window.__mgWinner !== undefined);
            if (done) break;
            await Promise.all(pages.map(async (p, i) => {
                const x = 206 + Math.sin((Date.now() / 400) + i) * 90;
                const y = 446 + Math.cos((Date.now() / 400) + i) * 160;
                await p.mouse.move(x, y).catch(() => {});
                await p.mouse.down().catch(() => {});
            }));
            await host.waitForTimeout(120);
        }

        // ---- the scoreboard, on both -----------------------------------------
        await host.waitForFunction(() => window.__mgWinner !== undefined, null, { timeout: 40000 })
            .catch(() => {});
        const winner = await host.evaluate(() => window.__mgWinner);
        ok('the round produces a winner', typeof winner === 'number', `got ${JSON.stringify(winner)}`);

        const boards = await Promise.all(pages.map(look));
        notes.push(`host rows: ${JSON.stringify(boards[0].rows)}`);
        notes.push(`client rows: ${JSON.stringify(boards[1].rows)}`);
        ok('both devices see a scoreboard with a row per player',
            boards.every(b => b.rows.length === 2),
            `host ${boards[0].rows.length}, client ${boards[1].rows.length}`);
        ok('both devices agree who won',
            boards[0].rows.length === 2 && boards[1].rows.length === 2 &&
            JSON.stringify(boards[0].rows.map(r => r.win)) === JSON.stringify(boards[1].rows.map(r => r.win)),
            `host ${JSON.stringify(boards[0].rows.map(r => r.win))}, client ${JSON.stringify(boards[1].rows.map(r => r.win))}`);
        ok('somebody actually scored', boards[0].rows.some(r => r.score && r.score !== '0'),
            `scores: ${JSON.stringify(boards[0].rows.map(r => r.score))}`);

        await host.screenshot({ path: path.join(__dirname, 'shot-netmg-board.png') });

        // ---- and the round LETS GO ------------------------------------------
        await host.waitForTimeout(6000);
        const after = await Promise.all(pages.map(look));
        ok('the scoreboard comes down on both devices', after.every(a => !a.layer),
            `host ${after[0].layer}, client ${after[1].layer}`);

        ok('a networked round produces no errors', errors.length === 0, errors.slice(0, 5).join(' | '));
    } catch (e) {
        fail.push('HARNESS: ' + (e && e.message));
    }

    await browser.close();
    console.log('\n=== A MINIGAME, ON TWO PHONES ===');
    notes.forEach(n => console.log('  ·     ' + n));
    pass.forEach(p => console.log('  PASS  ' + p));
    fail.forEach(f => console.log('  FAIL  ' + f));
    if (errors.length) { console.log('\n  ERRORS'); errors.slice(0, 10).forEach(e => console.log('    ' + e)); }
    console.log(`\n${pass.length} passed, ${fail.length} failed`);
    process.exit(fail.length ? 1 : 0);
})();
