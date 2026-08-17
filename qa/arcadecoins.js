// ============================================================
// The arcade must not pay out.
//
// Playing minigames from the arcade ran the full match payout onto the real
// players — the flat win reward, coin-game hauls, mgWins, the lot — and those
// totals STACKED across rounds, because nothing reset them until a board match
// started. Ten minutes of testing in the arcade handed somebody a fortune.
//
// The arcade keeps a round tally instead. This plays several rounds back to back
// and asserts that nothing the BOARD reads has moved, and that the tally has.
//
// usage: node arcadecoins.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

// A coin game and an ordinary one: the coin games pay per-player hauls on top of
// the flat reward, so both routes into the wallet have to be closed.
const ROUNDS = ['lootcatch', 'snapstrike', 'treeclimb', 'quickdraw'];

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

    // Enter the arcade the way a player does, so the series resets.
    await page.evaluate(() => {
        const b = document.getElementById('btn-minigames');
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(400);

    const wallet = () => page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return state.players.map(p => ({ coins: p.coins, earned: p.coinsEarned, mgWins: p.mgWins }));
    });
    const before = await wallet();
    ok('setup: the arcade opened with a known wallet', !!before && before.length === 2,
       JSON.stringify(before));

    // Play a handful of rounds, forcing a result each time so the payout path
    // runs in full rather than being cut short.
    let played = 0;
    for (let i = 0; i < ROUNDS.length; i++) {
        await page.evaluate(t => window.__QA.launchArcade(t), ROUNDS[i]);
        // Drive the intro to GO.
        let live = false;
        for (let k = 0; k < 80; k++) {
            live = await page.evaluate(() => { try { window.__QA.step(); } catch (e) {} return window.__QA.snapshot().mgActive; });
            if (live) break;
            await page.waitForTimeout(220);
        }
        if (!live) continue;
        // Force the round to a decided result — alternate the winner so the
        // tally has to track both sides.
        await page.evaluate(async (w) => {
            const MGM = await import('/src/minigames/MinigameManager.js');
            MGM.winMinigame(w);
        }, i % 2);
        played++;
        // The scoreboard arms at 700ms and auto-continues; wait it out.
        await page.waitForTimeout(8200);
    }
    ok('play: several arcade rounds ran to a result', played >= 3, `${played} of ${ROUNDS.length}`);

    const after = await wallet();
    const scores = await page.evaluate(async () => {
        const MGM = await import('/src/minigames/MinigameManager.js');
        return MGM.arcadeScores();
    });

    ok('coins: not one coin moved on either player',
       after.every((p, i) => p.coins === before[i].coins),
       `${JSON.stringify(before.map(p => p.coins))} → ${JSON.stringify(after.map(p => p.coins))}`);
    ok('coins: nor did lifetime earnings, which the win screen reads',
       after.every((p, i) => p.earned === before[i].earned),
       `${JSON.stringify(before.map(p => p.earned))} → ${JSON.stringify(after.map(p => p.earned))}`);
    ok('stats: the match minigame-win count is untouched',
       after.every((p, i) => p.mgWins === before[i].mgWins),
       `${JSON.stringify(before.map(p => p.mgWins))} → ${JSON.stringify(after.map(p => p.mgWins))}`);
    ok('tally: the arcade DOES keep score of the rounds',
       scores.wins[0] + scores.wins[1] + scores.draws === played,
       `${scores.wins[0]}–${scores.wins[1]} (${scores.draws} drawn) over ${played} rounds`);
    ok('tally: both players are credited with the rounds they won',
       scores.wins[0] > 0 && scores.wins[1] > 0, JSON.stringify(scores));

    // Re-entering the arcade starts a fresh series.
    await page.evaluate(() => {
        document.getElementById('btn-minigames').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const reset = await page.evaluate(async () =>
        (await import('/src/minigames/MinigameManager.js')).arcadeScores());
    ok('tally: a fresh visit to the arcade starts a fresh series',
       reset.wins[0] === 0 && reset.wins[1] === 0 && reset.draws === 0, JSON.stringify(reset));

    // And a real match still pays, so the fix did not close the wrong door.
    // Driven through the real launch path rather than by calling winMinigame
    // cold: the manager's `_resolving` guard is cleared when a game actually
    // starts, so a cold call is swallowed and proves nothing.
    const b4 = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const MGM = await import('/src/minigames/MinigameManager.js');
        state.players[0].coins = 40; state.players[1].coins = 40;
        state.players[1].isBot = true;
        window.__matchDone = false;
        MGM.trigger(() => { window.__matchDone = true; });   // a real match minigame
        return state.players.map(p => p.coins);
    });
    let matchLive = false;
    for (let k = 0; k < 90; k++) {
        matchLive = await page.evaluate(() => { try { window.__QA.step(); } catch (e) {} return window.__QA.snapshot().mgActive; });
        if (matchLive) break;
        await page.waitForTimeout(220);
    }
    ok('match: a real match minigame reaches GO', matchLive);
    if (matchLive) await page.evaluate(async () => (await import('/src/minigames/MinigameManager.js')).winMinigame(0));
    await page.waitForTimeout(9000);
    const match = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return { after: state.players.map(p => p.coins), wins: state.players.map(p => p.mgWins) };
    });
    ok('match: a real minigame still pays the winner',
       match.after[0] > b4[0], `${b4} → ${match.after}`);
    ok('match: and still counts the win',
       match.wins[0] === 1, JSON.stringify(match.wins));

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-arcadecoins.json'),
        JSON.stringify({ pass, fail, before, after, scores, match, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
