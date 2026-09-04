// ============================================================
// LIVE GAMES AT THREE AND FOUR SEATS
//
// The bracket is gone: a round is one game and everybody in the match plays it
// at the same time. That only works if the games themselves are written against
// slotCount() rather than against the number 2, and MG_PROFILE.live is the flag
// that says a game has been. This probe takes that flag at its word and checks
// it, game by game, at three seats and at four:
//
//   1. The ready gate has a button for EVERY slot, not two — the round could
//      not be started by the people in it before _buildReadyButtons existed.
//   2. The countdown fires only once every one of them has been pressed.
//   3. The game runs, takes input across the whole surface, and resolves to a
//      real seat (or a tie) inside its own clock — no watchdog, no force-end.
//   4. Nobody outside the roster comes out of it with a win.
//   5. The score screen has a row per slot.
//   6. No page errors, and no orphaned overlay left for the next round.
//
// A game marked live that cannot do this is worse than one that is not marked
// at all: the draw bag will hand it to four people and two of them will have
// nothing on screen.
//
// usage: node livegames.js [seats...]        (default: 3 and 4)
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

async function boot(browser, seats, roomy) {
    // A `roomy` game is only ever dealt on a tablet at 3-4 seats, so that is the
    // screen it has to be tested on. Testing it on a phone would be testing a
    // arrangement the bag never produces.
    const viewport = roomy ? { width: 820, height: 1180 } : { width: 412, height: 892 };
    const ctx = await browser.newContext({ viewport, hasTouch: true });
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
    await page.evaluate(() => window.__QA.bind());

    // QA_SLOW=1 seats the players by playing the real setup screens — mode,
    // seat count, a character each, map, rounds — so the ready buttons carry
    // the names the table actually chose.
    //
    // The default does not, and the reason is worth stating: booting a City
    // Circuit match costs 15 s on an idle box and far more on a busy one, and
    // NONE of it is what this probe is testing. Every check below is about the
    // minigame — its zones, its ready gate, its resolution — and a minigame
    // needs seats, not a board. setPlayerCount gives it seats in a few
    // milliseconds. The full-match path is covered at three and four seats by
    // qa/fourlocal.js, which is the probe that exists to test the board.
    if (process.env.QA_SLOW) {
        await page.evaluate(s => window.__QA.startRun({
            mode: 'pass', map: 'city_circuit', players: s, rounds: 6,
        }), seats);
    } else {
        await page.evaluate(async s => {
            const G = await import('/src/core/GameState.js');
            G.setPlayerCount(s);
            const sp = document.getElementById('splash');
            if (sp) sp.style.display = 'none';
        }, seats);
        return { ctx, page, errors };
    }
    // The boot budget follows the viewport. A tablet is 2.6x the pixels of a
    // phone and this container renders WebGL in software, so a City Circuit
    // boot that takes 15 s on an idle box takes far longer with another browser
    // on it. A flat 60 s reported four "failures" that were the budget rather
    // than the game — a budget that manufactures failures is worse than no
    // probe at all.
    await page.waitForFunction(() => {
        const S = window.__QA.snapshot();
        return S.gameState && S.gameState !== 'INIT' && S.gameState !== 'MENU';
    }, null, { timeout: roomy ? 180000 : 90000 });
    return { ctx, page, errors };
}

// Walk the intro (rules card → ready gate) and start the game. Returns what the
// ready gate looked like, which is half of what this probe is here to check.
async function throughIntro(page, seats) {
    // GOT IT on the rules card. The reel spins for ~1.5 s first.
    await page.waitForFunction(() => {
        const b = document.getElementById('btn-mg-intro-next');
        return b && b.offsetParent !== null &&
               document.getElementById('mg-page-info').style.display !== 'none' &&
               document.getElementById('mg-intro-title').textContent !== 'SELECTING...';
    }, null, { timeout: 20000 });
    await page.evaluate(() => {
        const b = document.getElementById('btn-mg-intro-next');
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() =>
        document.getElementById('mg-page-hold').style.display !== 'none', null, { timeout: 10000 });
    await page.evaluate(() => {
        const b = document.getElementById('btn-mg-launch');
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    // The ready gate. Count the buttons BEFORE pressing any of them.
    await page.waitForFunction(() =>
        document.getElementById('mg-ready-1') &&
        document.getElementById('mg-ready-1').style.display !== 'none', null, { timeout: 10000 });
    const gate = await page.evaluate(() => {
        const vis = el => !!el && getComputedStyle(el).display !== 'none' &&
                          el.getBoundingClientRect().width > 0;
        const base = [1, 2].map(i => document.getElementById(`mg-ready-${i}`)).filter(vis);
        const extra = [...document.querySelectorAll('.mg-ready-extra')].filter(vis);
        return {
            buttons: base.length + extra.length,
            slots: extra.map(b => +b.dataset.slot).sort((a, b) => a - b),
            rects: [...base, ...extra].map(b => {
                const r = b.getBoundingClientRect();
                return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
            }),
        };
    });
    // Press them one at a time and watch for an early countdown.
    const early = [];
    for (let slot = 0; slot < seats; slot++) {
        const started = await page.evaluate(s => {
            window.__QA_setReady(s);
            const cd = document.getElementById('mg-countdown');
            return !!cd && getComputedStyle(cd).display !== 'none';
        }, slot);
        if (started && slot < seats - 1) early.push(slot);
    }
    return { gate, early };
}

// A fresh browser per game, and a wall-clock cap on each.
//
// The first version reused one browser for all ten runs and had no cap. A
// context that failed to close left the browser with no renderer, every
// subsequent call hung rather than throwing, and the run sat there for eighty
// minutes having tested two games. A probe that can hang is a probe whose
// silence means nothing, so: one browser per game, closed in `finally`, and a
// hard deadline that turns a hang into a reported failure.
// Has to clear the boot budget above plus the 75 s of play, or the deadline
// fires on a run that was working.
const GAME_BUDGET_MS = t => (t ? 400000 : 300000);

async function playOne(type, seats, shotFor, roomy) {
    const tag = `${type}@${seats}P${roomy ? ' (tablet)' : ''}`;
    const browser = await chromium.launch({ args: GL });
    let page, errors;
    try {
        ({ page, errors } = await boot(browser, seats, roomy));
        // setReady is a module export; expose it so the gate can be pressed
        // slot by slot rather than by hunting the DOM for each button.
        await page.evaluate(async () => {
            const M = await import('/src/minigames/MinigameManager.js');
            window.__QA_setReady = s => M.setReady(s);
            window.__QA_roster = () => M.roster();
            window.__QA_slots = () => M.slotCount();
        });
        const done = await page.evaluate(([t, n]) => {
            window.__MG_RESULT = 'pending';
            window.__QA.launchLive(t, Array.from({ length: n }, (_, i) => i))
                .then(w => { window.__MG_RESULT = w; });
            return true;
        }, [type, seats]);

        const { gate, early } = await throughIntro(page, seats);
        ok(`${tag}: a ready button for every seat`, gate.buttons === seats, `${gate.buttons} buttons`);
        ok(`${tag}: no two ready buttons in the same place`,
           new Set(gate.rects.map(r => `${r.x},${r.y}`)).size === gate.buttons);
        ok(`${tag}: the countdown waits for the last seat`, early.length === 0,
           early.length ? `started after slot ${early[0]}` : '');

        // Countdown is 3 → 2 → 1 → GO at 900 ms.
        await page.waitForFunction(() => window.__QA.snapshot().mgActive === true,
                                   null, { timeout: 15000 }).catch(() => {});
        const roster = await page.evaluate(() => window.__QA_slots());
        ok(`${tag}: the game was handed ${seats} slots`, roster === seats, `slotCount() = ${roster}`);

        // Let it settle a beat, then look at it. Looking is a test.
        await page.waitForTimeout(1400);
        // The game has to have put something on screen. Sort Rush passed
        // "resolves on its own clock" while throwing inside _build, because the
        // manager caught it and resolved the round as a tie — a green tick over
        // a game nobody could see.
        const painted = await page.evaluate(() => {
            const layer = document.getElementById('minigame-layer');
            return [...layer.children].filter(el => !el.id &&
                   el.getBoundingClientRect().width > 0).length;
        });
        ok(`${tag}: the game actually drew itself`, painted > 0, `${painted} overlays`);
        if (shotFor) await page.screenshot({ path: path.join(__dirname, shotFor) });

        // Drive real input across the whole surface until it resolves on its own.
        // The play budget comes from the game, not from a round number. Grand
        // Prix runs to a 70 s ceiling and four games declare their own watchdog
        // in MG_WATCHDOG_MS because they end on a result rather than a clock; a
        // flat 75 s reported the longest of them as "still running", which is a
        // budget manufacturing a failure again.
        const watchdog = await page.evaluate(async t => {
            const R = await import('/src/config/MinigameRegistry.js');
            return (R.MG_WATCHDOG_MS || {})[t] || 0;
        }, type);
        const deadline = Date.now() + Math.max(105000, watchdog + 20000);
        let resolved = null, board = -1;
        while (Date.now() < deadline) {
            const seen = await page.evaluate(() => {
                const scr = document.querySelector('.mg-score-screen');
                return {
                    r: window.__MG_RESULT,
                    names: scr ? scr.querySelectorAll('.mg-sc-name').length : -1,
                };
            });
            // The scoreboard is shown BEFORE the round resolves and the agent
            // taps it away, so it has to be caught on the way past rather than
            // looked for afterwards.
            if (seen.names > board) board = seen.names;
            resolved = seen.r;
            if (resolved !== 'pending') break;
            await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__QA.step(); });
            await page.waitForTimeout(180);
        }
        ok(`${tag}: resolves on its own clock`, resolved !== null && resolved !== 'pending',
           resolved === 'pending' ? 'still running after 75 s' : '');

        const inRange = resolved === -1 || resolved === null ||
                        (typeof resolved === 'number' && resolved >= 0 && resolved < seats);
        ok(`${tag}: the winner is a seat that was playing`, inRange, `winner = ${resolved}`);

        ok(`${tag}: the score screen names every seat`, board >= seats, `${board} names`);

        const real = errors.filter(e => !/ResizeObserver|AudioContext|play\(\) failed/.test(e));
        ok(`${tag}: no page errors`, real.length === 0, real.slice(0, 2).join(' | '));
    } finally {
        await browser.close().catch(() => {});
    }
}

/** `p`, or a rejection once `ms` have passed — so a hang is a failure, not a wait. */
function withDeadline(p, ms, what) {
    let t;
    const bell = new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error(`${what}: no answer in ${Math.round(ms / 1000)}s`)), ms);
    });
    return Promise.race([p, bell]).finally(() => clearTimeout(t));
}

(async () => {
    const want = process.argv.slice(2).map(Number).filter(n => n >= 2 && n <= 4);
    const counts = want.length ? want : [3, 4];
    const lister = await chromium.launch({ args: GL });
    // Which games claim they can do this.
    const page0 = await (await lister.newContext()).newPage();
    await page0.goto(BASE, { waitUntil: 'domcontentloaded' });
    const live = await page0.evaluate(async () => {
        const R = await import('/src/config/MinigameRegistry.js');
        return R.MG_TYPES.filter(t => R.surfacesOf(t).sharedMany)
                .map(t => ({ type: t, roomy: R.surfacesOf(t).manyDevice === 'tablet' }));
    });
    await lister.close();
    // QA_ONLY=a,b limits the sweep to named games, the same convention
    // qa/arcade.js uses — re-running one slow game should not cost the roster.
    const only = process.env.QA_ONLY
        ? process.env.QA_ONLY.split(',').map(x => x.trim()).filter(Boolean) : null;
    const runs = only ? live.filter(g => only.includes(g.type)) : live;
    console.log(`=== LIVE GAMES: ${live.map(g => g.type + (g.roomy ? ' (tablet)' : '')).join(', ')} ===`);
    if (only) console.log(`    (QA_ONLY: ${runs.map(g => g.type).join(', ') || 'nothing matched'})`);
    ok('at least one game is playable by more than two', live.length > 0);

    for (const n of counts) {
        for (const g of runs) {
            const shot = `shot-live-${n}p-${g.type}.png`;
            try {
                await withDeadline(playOne(g.type, n, shot, g.roomy),
                                   GAME_BUDGET_MS(g.roomy), `${g.type}@${n}P`);
            } catch (e) {
                ok(`${g.type}@${n}P: ran`, false, String(e.message || e).slice(0, 160));
            }
            // Say it as it happens. Everything used to print at the end, so a
            // run that hung printed nothing at all about the games it HAD done.
            const done = pass.length + fail.length;
            console.log(`  … ${g.type}@${n}P (${done} checks so far)`);
        }
    }

    console.log('PASS:'); pass.forEach(p => console.log('  ✓ ' + p));
    console.log('FAIL:'); fail.length ? fail.forEach(f => console.log('  ✗ ' + f)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
