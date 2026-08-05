// ============================================================
// The four classic games, driven by a scripted opponent rather than by random
// taps. The generic arcade sweep can't tell "the bot never attacks" from "the
// harness parked a mallet in its own goal mouth", so each game here gets a
// player that actually plays it.
//
//   PUCK        — P1's mallet is parked off to one side; the bot must score.
//   FOUR IN A ROW — P1 plays a random legal column; the bot must win most games.
//   LIGHT CYCLES — P1 does nothing; the round must still end, quickly.
//   PENALTY     — P1 shoots and keeps at random; the match must resolve.
//
// usage: node newgames.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

// Boot one game straight into #minigame-layer, bypassing the intro.
async function launch(page, type, skill) {
    await page.evaluate(async ({ type, skill }) => {
        const { state } = await import('/src/core/GameState.js');
        const MM = await import('/src/minigames/MinigameManager.js');
        window.__RESULT = undefined;
        state.mgActive = true;
        state.mgType = type;
        state.players[1].isBot = true;
        document.getElementById('minigame-layer').style.display = 'flex';
        document.getElementById('splash').style.display = 'none';
        const mod = await import(`/src/minigames/${
            { puck: 'Puck', penalty: 'Penalty', lightcycles: 'LightCycles', fourinarow: 'FourInARow' }[type]
        }.js`);
        window.__T0 = performance.now();
        mod.start(true, w => { window.__RESULT = { winner: w, ms: performance.now() - window.__T0 }; }, skill);
    }, { type, skill });
}

const result = page => page.evaluate(() => window.__RESULT || null);

async function waitResult(page, budgetMs, tickFn) {
    const t0 = Date.now();
    while (Date.now() - t0 < budgetMs) {
        const r = await result(page);
        if (r) return r;
        if (tickFn) await tickFn();
        await page.waitForTimeout(120);
    }
    return null;
}

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    // ══════════════ PUCK — can the bot actually attack? ══════════════
    // The generic sweep leaves P1's mallet at its start position, which is dead
    // centre in front of P1's own goal — a perfect permanent goalkeeper. Park it
    // in a corner instead and the bot has to be capable of scoring.
    {
        await launch(page, 'puck', 0.85);
        await page.waitForTimeout(400);
        // Steer P1's mallet into a bottom corner and hold it there. Real mouse
        // events, not synthesised ones: #minigame-layer's first div child is the
        // static #mg-p2 zone, not the game overlay, so a dispatched event lands
        // on the wrong element and the game never sees it.
        await page.mouse.move(28, 800);
        await page.mouse.down();
        await page.mouse.move(28, 800);
        const r = await waitResult(page, 60000, null);
        ok('puck: resolves on its own', !!r, r ? `${(r.ms / 1000).toFixed(0)}s` : 'timed out');
        ok('puck: a hard bot scores against an open goal',
           !!r && r.winner === 1, r ? `winner=${r.winner}` : 'no result');
        ok('puck: lands inside the arcade time budget',
           !!r && r.ms / 1000 <= 45 && r.ms / 1000 >= 8,
           r ? `${(r.ms / 1000).toFixed(1)}s` : '—');
        await page.mouse.up();
    }

    // ══════════════ FOUR IN A ROW — does the bot beat random play? ══════════════
    // A connect-4 bot that never loses to a random opponent is the minimum bar.
    // Anything less means the win/block detection is broken.
    {
        let botWins = 0, draws = 0, p1Wins = 0, longest = 0;
        for (let g = 0; g < 3; g++) {
            await launch(page, 'fourinarow', 0.85);
            const r = await waitResult(page, 90000, async () => {
                // Play a random legal column whenever it is P1's move.
                await page.evaluate(() => {
                    const lay = document.getElementById('minigame-layer');
                    const cv = lay && lay.querySelector('canvas');
                    if (!cv) return;
                    // Tap somewhere in P1's half at a random x — the game maps x
                    // to a column itself.
                    const x = 30 + Math.random() * (window.innerWidth - 60);
                    const y = window.innerHeight * 0.9;
                    cv.parentElement.dispatchEvent(new PointerEvent('pointerdown',
                        { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7 }));
                });
            });
            if (!r) break;
            longest = Math.max(longest, r.ms / 1000);
            if (r.winner === 1) botWins++; else if (r.winner < 0) draws++; else p1Wins++;
            await page.waitForTimeout(300);
        }
        ok('fourinarow: a hard bot beats random play at least twice in three',
           botWins >= 2, `bot ${botWins} · draw ${draws} · P1 ${p1Wins}`);
        ok('fourinarow: games land inside the arcade time budget',
           longest > 0 && longest <= 55, `longest ${longest.toFixed(1)}s`);
    }

    // ══════════════ LIGHT CYCLES — resolves with a passive opponent ══════════════
    {
        await launch(page, 'lightcycles', 0.85);
        const r = await waitResult(page, 60000, null);
        ok('lightcycles: resolves with a passive opponent', !!r,
           r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
        ok('lightcycles: lands inside the arcade time budget',
           !!r && r.ms / 1000 <= 45, r ? `${(r.ms / 1000).toFixed(1)}s` : '—');
    }

    // ══════════════ PENALTY — resolves, and the shooter can score ══════════════
    {
        await launch(page, 'penalty', 0.55);
        const r = await waitResult(page, 80000, async () => {
            // P1: drag an aim somewhere in its half and release, which is both
            // "take the shot" and "pick a dive" depending on the kick.
            const x = 60 + Math.random() * 292;
            const y = 892 * (0.62 + Math.random() * 0.28);
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x, y);
            await page.mouse.up();
        });
        ok('penalty: resolves on its own', !!r,
           r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
        ok('penalty: lands inside the arcade time budget',
           !!r && r.ms / 1000 <= 65, r ? `${(r.ms / 1000).toFixed(1)}s` : '—');
    }

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-newgames.json'),
        JSON.stringify({ pass, fail, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
