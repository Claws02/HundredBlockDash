// ============================================================
// THE FRONT DOOR — can four players actually get into a match?
//
// The engine has taken 2–4 seats since Phase A, and `fourlocal.js` proves a
// four-seat match plays. What neither of them looked at is the three screens a
// person passes through to ASK for one, and that is where it was broken:
//
//   · The seat picker was offered by PASS & PLAY alone, so "1 PLAYER vs BOT"
//     meant two seats forever. There was no way to play a four-player game
//     unless you could find three other people.
//   · `goToCharSelect` marked exactly one bot — `players[1].isBot` — so even
//     with four seats there was nothing to put in the other two.
//   · `confirmCharSelect` had a 1P fast path that assigned seat 1 a character
//     and went straight to the map, skipping seats 2 and 3 entirely.
//
// And one that was never about seat count at all: a minigame is handed a single
// `isBot` flag describing SLOT 1, so a bot drawn into slot 0 has nothing driving
// it. `_startDuel` passes [whoever landed on the tile, their target], so in an
// ordinary 1P match every duel the BOT started ran that way round.
//
// This probe drives the real screens as a person would — tap the mode, tap the
// count, walk every character step — and reads the table that comes out.
//
// usage: node seats.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];
const CHARS = ['slime', 'ghost', 'boxy', 'bunny'];

const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);
const uniq = a => new Set(a).size === a.length;

async function boot(browser) {
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
    return { ctx, page, errors };
}

/**
 * Walk the setup screens the way a person does, and stop on the map screen.
 *
 * `botClaims` is how many of the human steps get handed to the computer with
 * the "let a bot play this seat" button — which is the only way to build a
 * table that is neither all-human nor one-human.
 */
async function setup(page, mode, seats, botClaims = 0) {
    await page.click(`[data-mode="${mode}"]`);
    const pickerShown = await page.evaluate(() =>
        getComputedStyle(document.getElementById('players-select')).display !== 'none');
    if (seats > 2) await page.click(`[data-players="${seats}"]`);
    await page.click('#btn-next');
    await page.waitForTimeout(400);

    let steps = 0, claimed = 0;
    const titles = [];
    while (steps < 6) {
        const showing = await page.evaluate(() =>
            getComputedStyle(document.getElementById('char-select')).display !== 'none');
        if (!showing) break;
        titles.push((await page.textContent('#cs-title')).trim());
        const idx = await page.evaluate(async () =>
            (await import('/src/core/GameState.js')).state.charSelectStep - 1);
        const botOffered = await page.evaluate(() =>
            getComputedStyle(document.getElementById('btn-seat-bot')).display !== 'none');
        if (botOffered && claimed < botClaims) { await page.click('#btn-seat-bot'); claimed++; }
        else {
            await page.click(`[data-char="${CHARS[idx] || 'cabbie'}"]`).catch(() => {});
            await page.click('#btn-char-confirm');
        }
        await page.waitForTimeout(300);
        steps++;
    }
    return { pickerShown, steps, titles };
}

const table = page => page.evaluate(async () => {
    const S = (await import('/src/core/GameState.js')).state;
    return {
        n: S.players.length, bots: S.players.map(p => !!p.isBot),
        names: S.players.map(p => p.name), chars: S.players.map(p => p.charType),
        cursed: S.cursedTarget.length, ready: S.mgReady.length,
    };
});

// Every pairing the rotation would produce over one full cycle.
const rotation = (page, rounds) => page.evaluate(async r => {
    const S = (await import('/src/core/GameState.js')).state;
    const MM = await import('/src/minigames/MinigameManager.js');
    const was = S.currentRound, out = [];
    for (let i = 0; i < r; i++) { S.currentRound = i; out.push(MM.chooseParticipants()); }
    S.currentRound = was;
    return out;
}, rounds);

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const allErrors = [];

    // ---- 1. one human, three bots ------------------------------------------
    {
        const { ctx, page, errors } = await boot(browser);
        const { pickerShown, steps } = await setup(page, '1p', 4);
        ok('1P offers a seat count', pickerShown);
        const t = await table(page);
        ok('1P seats four', t.n === 4, `${t.n} seats`);
        ok('...with one human at seat 0 and a bot in every other seat',
            t.bots.join() === 'false,true,true,true', JSON.stringify(t.bots));
        ok('...each bot named for itself', uniq(t.names), JSON.stringify(t.names));
        ok('...and no two players wearing the same character',
            uniq(t.chars), JSON.stringify(t.chars));
        ok('...asking the one person present exactly one question',
            steps === 1, `${steps} character steps`);
        ok('...with every per-seat array sized to match',
            t.cursed === 4 && t.ready === 4, `cursed ${t.cursed}, ready ${t.ready}`);

        // The rotation is the other half of it: a round two bots play is forty
        // seconds of nobody playing, and at the manager's two slots it is not
        // even playable.
        const pairs = await rotation(page, 6);
        const isBot = i => t.bots[i];
        ok('no round is two bots playing each other while the human watches',
            pairs.every(p => p.some(i => !isBot(i))), JSON.stringify(pairs));
        ok('...and the human is in every round of a 1-v-3 match',
            pairs.every(p => p.includes(0)), JSON.stringify(pairs));
        allErrors.push(...errors);
        await ctx.close();
    }

    // ---- 2. four humans, unchanged -----------------------------------------
    {
        const { ctx, page, errors } = await boot(browser);
        const { pickerShown, steps, titles } = await setup(page, 'pass', 4);
        ok('pass-and-play still offers a seat count', pickerShown);
        const t = await table(page);
        ok('four humans seat four humans', t.n === 4 && t.bots.every(b => !b),
            JSON.stringify(t.bots));
        ok('...one character step each', steps === 4, `${steps} steps`);
        ok('...and each step says which seat of how many',
            titles.every(x => /OF 4/.test(x)), JSON.stringify(titles));
        const pairs = await rotation(page, 6);
        ok('an all-human table keeps the full fair rotation',
            new Set(pairs.map(p => p.join())).size === 6, JSON.stringify(pairs));
        allErrors.push(...errors);
        await ctx.close();
    }

    // ---- 3. a mixed table: three people and a bot ---------------------------
    {
        const { ctx, page, errors } = await boot(browser);
        const { steps } = await setup(page, 'pass', 4, 1);
        const t = await table(page);
        ok('a seat can be handed to the computer mid-setup',
            t.n === 4 && t.bots.filter(Boolean).length === 1, JSON.stringify(t.bots));
        ok('...seat 0 is never the one handed over', t.bots[0] === false);
        ok('...the bot still gets its own character',
            uniq(t.chars), JSON.stringify(t.chars));
        ok('...and the screen still asks a question per seat, not per human',
            steps === 4, `${steps} steps`);
        allErrors.push(...errors);
        await ctx.close();
    }

    // ---- 4. tabletop is two, and says so ------------------------------------
    {
        const { ctx, page, errors } = await boot(browser);
        const { pickerShown } = await setup(page, 'tabletop', 2);
        const t = await table(page);
        // Not an oversight: two people hold opposite edges of one screen and
        // there is no third edge. docs/MINIGAME_RULEBOOK.md §3.1.
        ok('tabletop offers no seat count, and stays at two',
            !pickerShown && t.n === 2, `picker ${pickerShown}, ${t.n} seats`);
        allErrors.push(...errors);
        await ctx.close();
    }

    // ---- 5. a lone bot takes slot 1, whatever order it arrived in -----------
    {
        const { ctx, page, errors } = await boot(browser);
        await setup(page, '1p', 2);
        // The duel's pair is [whoever landed on the tile, their target], so the
        // bot landing on it hands the manager [1, 0] — a bot in slot 0, with a
        // single `isBot` flag that can only describe slot 1.
        const r = await page.evaluate(async () => {
            const MM = await import('/src/minigames/MinigameManager.js');
            MM.trigger(() => {}, [1, 0]);
            const seats = MM.roster();
            MM.forceEndMinigame();
            return seats;
        });
        ok('a bot handed slot 0 is moved to the slot the isBot flag describes',
            r.join() === '0,1', `roster [${r}]`);
        allErrors.push(...errors);
        await ctx.close();
    }

    // ---- 6. a rematch comes back with the same table ------------------------
    {
        const { ctx, page, errors } = await boot(browser);
        await setup(page, '1p', 4);
        const restored = await page.evaluate(async () => {
            const GC = await import('/src/core/GameController.js');
            const S  = (await import('/src/core/GameState.js')).state;
            // What REMATCH stores and reads back. A blob without `bots` is the
            // old two-player shape and must still land on its feet.
            const prefs = { mode: '1p', players: 4, map: 'city_circuit', cityRounds: 6,
                            chars: S.players.map(p => p.charType),
                            bots: S.players.map(p => !!p.isBot) };
            GC.quickStart(prefs);
            const after = { n: S.players.length, bots: S.players.map(p => !!p.isBot) };
            GC.quickStart({ mode: '1p', players: 2, map: 'city_circuit',
                            chars: ['slime', 'boxy'] });
            after.legacy = S.players.map(p => !!p.isBot);
            return after;
        });
        ok('a rematch of one-human-three-bots comes back as one human and three bots',
            restored.n === 4 && restored.bots.join() === 'false,true,true,true',
            JSON.stringify(restored.bots));
        ok('...and a setup saved before seats could be mixed still reads right',
            restored.legacy.join() === 'false,true', JSON.stringify(restored.legacy));
        allErrors.push(...errors);
        await ctx.close();
    }

    ok('no page or console errors', allErrors.length === 0,
        [...new Set(allErrors)].slice(0, 4).join(' | '));

    console.log('=== THE FRONT DOOR: 2, 3 AND 4 SEATS ===');
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
