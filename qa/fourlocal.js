// ============================================================
// THREE AND FOUR SEATS, LOCALLY — the Phase A gate
//
// Nothing in the networking work is worth starting until the BOARD itself can
// be played by more than two people, so this probe is deliberately offline. It
// plays real 3- and 4-player hot-seat matches through to the win screen and
// asserts the things that only break above two seats:
//
//   1. The table is the size that was asked for, and every per-seat array is
//      that size too — a short `cursedTarget` or `investorUsedThisRound` reads
//      `undefined` and poisons a comparison silently.
//   2. The turn passes to every seat, in order, and comes back round.
//   3. The HUD switches to the solo layout: one full bar for whoever is up, a
//      rival chip for everyone else, and — the bug that soft-locked the first
//      four-player run — NO stale `data-roll` on the hidden second row.
//   4. Four tokens on one tile do not stand in the same place.
//   5. A minigame is a duel between two of them, and nobody outside the pair
//      comes out of it with a win to their name.
//   6. The match reaches a win screen, ranked, with a card for every seat.
//
// usage: node fourlocal.js [seats]      (default: runs 3 and 4)
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

async function runSeats(browser, seats, budgetSec) {
    const tag = `${seats}P`;
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
    // Minigames are Phase C work; here they only need to resolve so the board
    // can carry on. Six full minigames per match would put this probe past
    // twenty minutes and tell us nothing about the board.
    await page.evaluate(() => window.__QA.setMinigameFastResolve(1500));
    await page.evaluate(s => window.__QA.startRun({
        mode: 'pass', map: 'city_circuit', players: s, rounds: 6,
    }), seats);

    // ---- 1. the table is the right size ------------------------------------
    // The HUD assertions below read what is ON SCREEN, so they are only
    // meaningful once the match is actually at a live turn. This wait used to
    // swallow its own timeout, and a slow boot then reported itself as two
    // unrelated HUD failures — the strip and the roll button are both hidden
    // while City is still on its opening flyover. Say which it was.
    let live = true;
    await page.waitForFunction(() => window.__QA.snapshot().gameState === 'PRE_ROLL', null, { timeout: 180000 })
        .catch(() => { live = false; });
    ok(`${tag} · reaches a live turn before the HUD is read`, live,
        live ? '' : 'still not at PRE_ROLL after 180s — the HUD checks below mean nothing');
    const sizes = await page.evaluate(async () => {
        const S = (await import('/src/core/GameState.js')).state;
        return {
            players: S.players.length,
            ids:     S.players.map(p => p.id),
            cursed:  (S.cursedTarget || []).length,
            invest:  (S.investorUsedThisRound || []).length,
            chars:   S.players.map(p => p.charType),
        };
    });
    ok(`${tag} · seats`, sizes.players === seats, `${sizes.players} players`);
    ok(`${tag} · seat ids are 0..n-1`,
        sizes.ids.every((id, i) => id === i), JSON.stringify(sizes.ids));
    ok(`${tag} · per-seat arrays sized to the table`,
        sizes.cursed === seats && sizes.invest === seats,
        `cursedTarget ${sizes.cursed}, investorUsedThisRound ${sizes.invest}`);
    ok(`${tag} · every seat has its own character`,
        new Set(sizes.chars).size === seats, sizes.chars.join(','));

    // ---- 3. the HUD is in solo layout, with no stale controls ---------------
    const hud = await page.evaluate(() => {
        const active = window.__QA.snapshot().activePlayer;
        const rollEls = [...document.querySelectorAll('[data-roll]')];
        const liveRoll = document.querySelector(`[data-roll="${active}"]`);
        const vis = el => {
            if (!el) return false;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        return {
            mode:       document.body.dataset.hudMode,
            chips:      document.querySelectorAll('#hud-rivals .rival-chip').length,
            stripShown: vis(document.getElementById('hud-rivals')),
            topBarShown: vis(document.getElementById('hud-p2')),
            rollCount:  rollEls.length,
            liveRollVisible: vis(liveRoll),
            active,
        };
    });
    ok(`${tag} · HUD is in solo layout`, hud.mode === 'solo', `data-hud-mode=${hud.mode}`);
    ok(`${tag} · one rival chip per rival`, hud.chips === seats - 1, `${hud.chips} chips`);
    ok(`${tag} · rival strip on screen`, hud.stripShown === true);
    ok(`${tag} · the second full bar is stood down`, hud.topBarShown === false);
    ok(`${tag} · exactly one roll control exists`, hud.rollCount === 1, `${hud.rollCount} found`);
    ok(`${tag} · the active seat's roll control is the visible one`,
        hud.liveRollVisible === true, `active seat ${hud.active}`);

    // ---- 4. tokens do not stack ---------------------------------------------
    const spread = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const S = (await import('/src/core/GameState.js')).state;
        // Everybody is on the start square at the top of the match, which is
        // exactly the case that used to draw them all inside each other.
        const pts = S.players.map(p => p.mesh && p.mesh.position
            ? { x: +p.mesh.position.x.toFixed(3), z: +p.mesh.position.z.toFixed(3) } : null);
        let minSep = Infinity;
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
            if (!pts[i] || !pts[j]) continue;
            if (S.players[i].pos !== S.players[j].pos) continue;   // only same-tile pairs
            minSep = Math.min(minSep, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
        }
        return { pts, minSep, offsets: S.players.map(p => R.seatOffset(p.id, 1.2)) };
    });
    ok(`${tag} · co-located tokens are separated`,
        spread.minSep === Infinity || spread.minSep > 0.9,
        `closest same-tile pair ${spread.minSep === Infinity ? 'n/a' : spread.minSep.toFixed(2)} units`);
    ok(`${tag} · every seat gets a distinct offset`,
        new Set(spread.offsets.map(o => `${o.lat.toFixed(3)},${o.fwd.toFixed(3)}`)).size === seats);

    // ---- 2 + 5 + 6. play it out ---------------------------------------------
    const seen = new Set();
    let mgChecks = [];
    let winSeen = false;
    const t0 = Date.now();
    let lastMgWins = null;

    while ((Date.now() - t0) / 1000 < budgetSec) {
        const res = await page.evaluate(() => {
            const r = window.__QA.step();
            const s = window.__QA.snapshot();
            return { r, s, win: getComputedStyle(document.getElementById('win-screen')).display !== 'none' };
        });
        seen.add(res.s.activePlayer);
        if (res.win) { winSeen = true; break; }

        // 5. A minigame in a >2 seat match is a ROUND THE WHOLE TABLE PLAYS.
        //    It used to be a duel between two of them with the rest watching,
        //    and this probe asserted exactly that — that a bystander's win
        //    count never moved. There are no bystanders now: RoundFormat plays
        //    the round as a relay or a bracket and every seat is in it. What
        //    replaces the old rule is the one that has to hold whatever shape
        //    the round took: ONE seat gains a win, and it is one of the seats
        //    that were in the round.
        if (res.s.gameState === 'MINIGAME_INTRO' && !lastMgWins) {
            lastMgWins = await page.evaluate(async () => {
                const S = (await import('/src/core/GameState.js')).state;
                return { coins: S.players.map(p => p.coins), wins: S.players.map(p => p.mgWins) };
            });
        }
        if (lastMgWins && res.s.gameState !== 'MINIGAME_INTRO' && res.s.gameState !== 'MINIGAME'
            && res.s.gameState !== 'MINIGAME_ACK' && !res.s.mgActive) {
            const after = await page.evaluate(async () => {
                const S = (await import('/src/core/GameState.js')).state;
                const RF = await import('/src/minigames/RoundFormat.js');
                const last = RF.lastRound();
                return { coins: S.players.map(p => p.coins), wins: S.players.map(p => p.mgWins),
                         seats: last ? last.seats : null, relay: last ? last.relay : null,
                         legs: last ? (last.results || []).length : 0 };
            });
            const before = lastMgWins;
            // `mgWins` is the precise signal and coins are not: the window
            // between the intro card and the board settling also contains the
            // rest of the turn — a Truce pays everybody, a Magnet takes from
            // whoever is richest — so coins moving in here is often correct.
            const moved = after.wins.map((w, i) => w - before.wins[i]);
            mgChecks.push({
                moved, gained: moved.filter(x => x > 0).length,
                lost: moved.filter(x => x < 0).length,
                seats: after.seats, relay: after.relay, legs: after.legs,
            });
            lastMgWins = null;
        }
        await page.waitForTimeout(90);
    }

    ok(`${tag} · every seat took a turn`, seen.size === seats,
        `seats seen: ${[...seen].sort().join(',')}`);
    if (mgChecks.length) {
        ok(`${tag} · every round is played by the whole table`,
            mgChecks.every(c => c.seats && c.seats.length === seats),
            `${mgChecks.length} round(s); seats in each: ${JSON.stringify(mgChecks.map(c => c.seats && c.seats.length))}`);
        // A relay is one leg per player and a bracket is two or three legs; a
        // round that reports one leg at four seats is a duel that slipped
        // through, which is the thing this whole format exists to stop.
        ok(`${tag} · a round is played in legs, not as one duel`,
            mgChecks.every(c => c.legs >= (seats === 3 ? 2 : 3)),
            JSON.stringify(mgChecks.map(c => ({ relay: c.relay, legs: c.legs }))));
        ok(`${tag} · one win per round, however many legs it took`,
            mgChecks.every(c => c.gained === 1 && c.lost === 0),
            JSON.stringify(mgChecks.map(c => c.moved)));
    } else {
        ok(`${tag} · at least one minigame ran`, false, 'none observed inside the budget');
    }

    ok(`${tag} · reaches the win screen`, winSeen, winSeen ? '' : `still playing after ${budgetSec}s`);
    if (winSeen) {
        const win = await page.evaluate(async () => {
            const S = (await import('/src/core/GameState.js')).state;
            const cards = [...document.querySelectorAll('#win-cards .win-card')];
            return {
                cards: cards.length,
                scores: cards.map(c => parseInt((c.querySelector('.win-card-score') || {}).textContent || '0', 10)),
                names:  cards.map(c => (c.querySelector('.win-card-name') || {}).textContent.trim()),
                headline: (document.getElementById('win-name') || {}).textContent,
                many: document.getElementById('win-cards').classList.contains('win-cards-many'),
                legend: document.querySelectorAll('.win-chart-legend .wc-swatch').length,
                players: S.players.length,
            };
        });
        ok(`${tag} · a result card for every seat`, win.cards === seats, `${win.cards} cards`);
        ok(`${tag} · cards are ranked, best first`,
            win.scores.every((v, i) => i === 0 || win.scores[i - 1] >= v), JSON.stringify(win.scores));
        ok(`${tag} · the headline names somebody`, !!win.headline && win.headline.trim().length > 0, win.headline);
        ok(`${tag} · the many-card layout is on`, win.many === true);
        ok(`${tag} · the race chart has a line per seat`, win.legend >= seats, `${win.legend} swatches`);
    }

    ok(`${tag} · no page or console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.screenshot({ path: path.join(__dirname, `shot-fourlocal-${seats}p.png`) });
    await ctx.close();
}

(async () => {
    const only = parseInt(process.argv[2] || '0', 10);
    const budget = parseInt(process.env.QA_BUDGET || '1500', 10);
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    try {
        for (const n of (only ? [only] : [3, 4])) await runSeats(browser, n, budget);
    } catch (e) {
        fail.push('HARNESS: ' + e.message);
    }
    await browser.close();

    console.log('\n=== 3/4-PLAYER LOCAL ===');
    pass.forEach(p => console.log('  PASS  ' + p));
    fail.forEach(f => console.log('  FAIL  ' + f));
    console.log(`\n${pass.length} passed, ${fail.length} failed`);
    process.exit(fail.length ? 1 : 0);
})();
