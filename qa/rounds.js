// ============================================================
// EVERYBODY PLAYS — a round at three and four seats
//
// Every minigame in the roster is built for two, so above two seats the round
// used to pick two players by rotation and the rest watched. This probe drives
// the two formats that replaced that (src/minigames/RoundFormat.js) end to end
// and asserts the thing the formats exist for:
//
//   EVERY SEAT IN THE ROUND ACTUALLY PLAYS, AND THE ROUND PAYS ONCE.
//
// The second half of that sentence is the one worth a probe. A four-player
// bracket is THREE games; if each leg paid MINIGAME_REWARD and each coin game
// paid its own cap, one round would hand out 30 coins and a 90-coin haul, and
// a single minigame would settle a board match.
//
// It also checks the thing the room actually sees — the rail and the cards —
// because a relay is played alone and a bracket is watched from the side, and
// in both a player who cannot see the standings is playing on their own.
//
// usage: node rounds.js
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

async function boot(browser, mode, seats) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text());
    });
    await page.addInitScript(() => {
        try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {}
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(s => window.__QA.startRun({
        mode: s.mode, map: 'city_circuit', players: s.seats, rounds: 6 }), { mode, seats });
    // City opens on a flyover and a briefing; wait for a live board.
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
        await page.evaluate(() => {
            const g = document.getElementById('btn-cb-start');
            const ov = document.getElementById('city-briefing');
            if (g && ov && getComputedStyle(ov).display !== 'none') g.click();
        }).catch(() => {});
        const gs = await page.evaluate(async () => (await import('/src/core/GameState.js')).state.gameState);
        if (gs !== 'INIT') break;
        await page.waitForTimeout(1000);
    }
    return { ctx, page, errors };
}

/**
 * Run one round of `type` with every seat in it, driving the cards and the
 * games exactly as the agent drives a real match, and report what happened.
 */
async function playRound(page, type, budgetMs = 150000) {
    await page.evaluate(() => window.__QA.setMinigameFastResolve(2500));
    const before = await page.evaluate(async () => {
        const S = (await import('/src/core/GameState.js')).state;
        return { coins: S.players.map(p => p.coins), wins: S.players.map(p => p.mgWins) };
    });
    // Watch for the rail and for each seat taking a turn, while it runs.
    await page.evaluate(() => {
        window.__seen = { rail: 0, railChips: 0, cards: 0 };
        window.__watch = setInterval(async () => {
            const rail = document.getElementById('round-rail');
            if (rail && getComputedStyle(rail).display !== 'none') {
                window.__seen.rail++;
                window.__seen.railChips = Math.max(window.__seen.railChips,
                    rail.querySelectorAll('.rr-chip').length);
            }
            const layer = document.getElementById('round-layer');
            if (layer && getComputedStyle(layer).display !== 'none') window.__seen.cards++;
        }, 120);
    });
    // Kick the round off WITHOUT waiting for it. The round is driven by the
    // agent's step loop tapping cards and playing games, and the agent cannot
    // run while an evaluate is parked on a promise — awaiting the result here
    // deadlocks the thing it is waiting for.
    await page.evaluate(async t => {
        window.__roundDone = null;
        const RF = await import('/src/minigames/RoundFormat.js');
        const S = (await import('/src/core/GameState.js')).state;
        const seats = S.players.map((_, i) => i);
        window.__plan = { relay: RF.canRelay(t, seats), legs: RF.planFor(t, seats) };
        RF.run(t, seats, winner => {
            // RoundFormat keeps the record of what the round did — who played,
            // what they scored, which legs ran — because "one seat won" is not
            // enough to say everybody took part.
            window.__roundDone = { winner, ...(RF.lastRound() || {}) };
        }, { award: true });
    }, type);

    const deadline = Date.now() + budgetMs;
    let settled = null;
    // The agent's own step loop drives everything: the round cards, the ready
    // gates, the games themselves.
    while (Date.now() < deadline) {
        const st = await page.evaluate(() => {
            try { return window.__QA.step(); } catch (e) { return 'ERR:' + e.message; }
        });
        settled = await page.evaluate(() => window.__roundDone || null);
        if (settled) break;
        await page.waitForTimeout(180);
        if (/^ERR:/.test(st)) return { error: st };
    }
    await page.evaluate(() => { clearInterval(window.__watch); });
    const after = await page.evaluate(async () => {
        const S = (await import('/src/core/GameState.js')).state;
        return {
            coins: S.players.map(p => p.coins), wins: S.players.map(p => p.mgWins),
            gs: S.gameState, uiLayer: getComputedStyle(document.getElementById('ui-layer')).display,
            seen: { ...window.__seen },
            plan: window.__plan, done: window.__roundDone,
        };
    });
    return { before, after };
}

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const allErrors = [];

    // ---- the plans, before anything is played -------------------------------
    {
        const { ctx, page, errors } = await boot(browser, 'pass', 4);
        const p = await page.evaluate(async () => {
            const RF = await import('/src/minigames/RoundFormat.js');
            const S = (await import('/src/core/GameState.js')).state;
            const seats = S.players.map((_, i) => i);
            return {
                relay:   { on: RF.canRelay('meteordodge', seats), legs: RF.planFor('meteordodge', seats) },
                bracket: { on: RF.canRelay('puck', seats),        legs: RF.planFor('puck', seats) },
            };
        });
        ok('a solitaire at an all-human table is a relay — one leg per player',
            p.relay.on && p.relay.legs.length === 4 && p.relay.legs.every(l => l.solo !== undefined),
            JSON.stringify(p.relay.legs));
        ok('a 1v1 game is a bracket — two semi-finals and a final',
            !p.bracket.on && p.bracket.legs.length === 3 &&
            p.bracket.legs[2].from.join() === '0,1',
            JSON.stringify(p.bracket.legs.map(l => l.name)));
        ok('...and every seat is in the draw',
            new Set(p.bracket.legs.slice(0, 2).flatMap(l => l.pair)).size === 4,
            JSON.stringify(p.bracket.legs.slice(0, 2).map(l => l.pair)));
        allErrors.push(...errors);
        await ctx.close();
    }

    // ---- three seats ---------------------------------------------------------
    {
        const { ctx, page, errors } = await boot(browser, 'pass', 3);
        const p = await page.evaluate(async () => {
            const RF = await import('/src/minigames/RoundFormat.js');
            const S = (await import('/src/core/GameState.js')).state;
            const seats = S.players.map((_, i) => i);
            return { relay: RF.planFor('treeclimb', seats), ladder: RF.planFor('puck', seats) };
        });
        ok('three seats relay in three legs', p.relay.length === 3, JSON.stringify(p.relay));
        ok('three seats play a 1v1 game as a challenger ladder — everybody plays',
            p.ladder.length === 2 && p.ladder[1].from.join() === '0',
            JSON.stringify(p.ladder.map(l => l.name)));
        allErrors.push(...errors);
        await ctx.close();
    }

    // ---- a bot at the table cannot relay -------------------------------------
    {
        const { ctx, page, errors } = await boot(browser, '1p', 4);
        const p = await page.evaluate(async () => {
            const RF = await import('/src/minigames/RoundFormat.js');
            const S = (await import('/src/core/GameState.js')).state;
            const seats = S.players.map((_, i) => i);
            return { relay: RF.canRelay('meteordodge', seats), legs: RF.planFor('meteordodge', seats) };
        });
        // A bot cannot play a solitaire, and inventing a score for it would be
        // inventing the result of the round. It plays a real 1v1 game instead.
        ok('a table with a bot in it plays a bracket, not a relay',
            !p.relay && p.legs.length === 3, JSON.stringify(p.legs.map(l => l.name)));
        allErrors.push(...errors);
        await ctx.close();
    }

    // ---- a whole relay, driven ----------------------------------------------
    {
        const { ctx, page, errors } = await boot(browser, 'pass', 4);
        const r = await playRound(page, 'meteordodge');
        if (r.error) ok('a four-player relay runs', false, r.error);
        else {
            const { before, after } = r;
            ok('a four-player relay reaches a winner',
                typeof after.done?.winner === 'number', JSON.stringify(after.done));
            ok('...with a score banked for every seat',
                after.done && Object.keys(after.done.scores || {}).length === 4,
                JSON.stringify(after.done?.scores));
            ok('...the standings rail was on screen while people played',
                after.seen.rail > 0 && after.seen.railChips === 4,
                `${after.seen.rail} samples, ${after.seen.railChips} chips`);
            ok('...a card came up between the legs',
                after.seen.cards > 0, `${after.seen.cards} samples`);
            const gained = after.coins.map((c, i) => c - before.coins[i]);
            const winners = after.wins.map((w, i) => w - before.wins[i]);
            ok('...exactly one player is credited with the round',
                winners.filter(x => x === 1).length === 1 && winners.every(x => x <= 1),
                JSON.stringify(winners));
            ok('...and nobody is paid more than one round can pay',
                gained.every(g => g >= 0 && g <= 40), JSON.stringify(gained));
            ok('...the board comes back afterwards',
                after.uiLayer !== 'none' && after.gs === 'MINIGAME_ACK',
                `ui-layer ${after.uiLayer}, state ${after.gs}`);
        }
        allErrors.push(...errors);
        await ctx.close();
    }

    // ---- a whole bracket, driven ---------------------------------------------
    {
        const { ctx, page, errors } = await boot(browser, 'pass', 4);
        const r = await playRound(page, 'quickdraw');
        if (r.error) ok('a four-player bracket runs', false, r.error);
        else {
            const { before, after } = r;
            ok('a four-player bracket reaches a winner',
                typeof after.done?.winner === 'number', JSON.stringify(after.done));
            ok('...every seat played a leg',
                new Set((after.done?.results || []).flatMap(x => x.pair || [])).size === 4,
                JSON.stringify((after.done?.results || []).map(x => x.pair)));
            ok('...three legs were played, not one',
                (after.done?.results || []).length === 3,
                `${(after.done?.results || []).length} legs`);
            const gained = after.coins.map((c, i) => c - before.coins[i]);
            const winners = after.wins.map((w, i) => w - before.wins[i]);
            ok('...only the round winner takes a win, not every leg winner',
                winners.filter(x => x === 1).length === 1 && winners.every(x => x <= 1),
                JSON.stringify(winners));
            ok('...THE ROUND PAYS ONCE — three legs do not pay three rewards',
                gained.filter(g => g > 0).length <= 1 && gained.every(g => g <= 30),
                JSON.stringify(gained));
            ok('...the board comes back afterwards',
                after.uiLayer !== 'none' && after.gs === 'MINIGAME_ACK',
                `ui-layer ${after.uiLayer}, state ${after.gs}`);
        }
        allErrors.push(...errors);
        await ctx.close();
    }

    ok('no page or console errors', allErrors.length === 0,
        [...new Set(allErrors)].slice(0, 4).join(' | '));

    console.log('=== EVERYBODY PLAYS: ROUNDS AT 3 AND 4 SEATS ===');
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
