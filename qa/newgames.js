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
        // Through the manager's table, so adding a game never leaves a second
        // stale copy of the game-to-file mapping in a probe.
        const mod = await MM.loadMinigame(type);
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

    // ══════ FOUR IN A ROW — no clock on the move, and the bot still wins ══════
    {
        // The shot clock is gone, so nothing may play a move for the player.
        // Left alone on P1's turn the board must sit exactly where it is.
        await launch(page, 'fourinarow', 0.85);
        // Wait out any bot move first, so we are certainly on P1's turn.
        await page.waitForTimeout(3000);
        const before = await page.evaluate(() => (document.getElementById('mg-neutral') || {}).textContent);
        await page.waitForTimeout(13000);       // twice the old 5 s clock, and then some
        const after = await page.evaluate(() => (document.getElementById('mg-neutral') || {}).textContent);
        const res = await result(page);
        ok('fourinarow: no shot clock — a move is never played for you',
           before === after && !res, `"${before}" → "${after}"`);
        ok('fourinarow: and no countdown is drawn on the player',
           !/\d+s/.test(after || ''), `"${after}"`);
    }

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

    // ══════════ PENALTY — no shot clock, and the keeper keeps diving ══════════
    {
        // 1. The shot must never be taken for you. Left completely alone, the
        //    game should still be sitting on kick 1 waiting for the taker.
        await launch(page, 'penalty', 0.55);
        await page.waitForTimeout(9000);
        const idle = await page.evaluate(() => ({
            neutral: (document.getElementById('mg-neutral') || {}).textContent || '',
            result: window.__RESULT || null,
        }));
        ok('penalty: no shot clock — the kick is not taken for you',
           /KICK 1/.test(idle.neutral) && !idle.result, `"${idle.neutral}"`);

        // 2. The keeper must still be moving after the ball is struck. Read the
        //    keeper's drawn position straight off the canvas at the start and
        //    end of the flight while dragging the finger to the far post: with
        //    the old "commit at the strike" rule it could not move at all.
        const moved = await (async () => {
            // Find the keeper's x by scanning the canvas for its block colour.
            // Read the keeper's block straight off the canvas. Which goal and
            // which colour depends on who is shooting, so take that from the
            // status line rather than assuming — the keeper swaps ends every
            // kick, and scanning the wrong end finds static HUD pixels and
            // reports a keeper that never moves.
            const scan = () => page.evaluate(() => {
                const cv = [...document.querySelectorAll('#minigame-layer canvas')].pop();
                if (!cv) return null;
                const txt = (document.getElementById('mg-neutral') || {}).textContent || '';
                const m = txt.match(/P(\d) SHOOTS/);
                if (!m) return null;
                const shooter = parseInt(m[1]) - 1;
                const g = cv.getContext('2d');
                const dpr = cv.width / cv.clientWidth;
                const H = cv.clientHeight, PAD_Y = 48;
                const gh = H * 0.5 * 0.20;
                const keeperTop = shooter === 0;
                const gy = keeperTop ? PAD_Y + 10 : H - PAD_Y - 10 - gh;
                const y = Math.round((gy + gh / 2) * dpr);
                const row = g.getImageData(0, y, cv.width, 1).data;
                let sum = 0, n = 0;
                for (let x = 0; x < cv.width; x++) {
                    const r = row[x * 4], gg = row[x * 4 + 1], b = row[x * 4 + 2];
                    // The keeper is drawn in the KEEPER's colour: blue when P1
                    // shoots (P2 keeps), red when P2 shoots (P1 keeps).
                    const hit = keeperTop ? (b > 140 && b - r > 55) : (r > 140 && r - b > 55);
                    if (hit) { sum += x; n++; }
                }
                return n > 4 ? { x: sum / n / dpr, n, shooter } : null;
            });
            // Get to a kick where P1 is the KEEPER — the bot then shoots on its
            // own timer and P1's finger is free to chase the ball.
            const shooterNow = async () => {
                const t = await page.evaluate(() => (document.getElementById('mg-neutral') || {}).textContent || '');
                const m = t.match(/P(\d) SHOOTS/);
                return m ? parseInt(m[1]) - 1 : -1;
            };
            for (let attempt = 0; attempt < 8 && await shooterNow() === 0; attempt++) {
                await page.mouse.move(206, 700);
                await page.mouse.down();
                await page.mouse.move(300, 660);
                await page.mouse.up();
                await page.waitForTimeout(2200);      // flight + settle
            }
            if (await shooterNow() !== 1) return null;

            // Sweep the finger from post to post across P1's half and watch the
            // keeper block travel with it. Frozen-at-the-strike would show ~0.
            const samples = [];
            for (let i = 0; i < 80; i++) {
                await page.mouse.move(30 + (i % 2) * 350, 820);
                const s = await scan();
                if (s && s.shooter === 1) samples.push(s.x);
                await page.waitForTimeout(50);
            }
            if (samples.length < 4) return null;
            return Math.max(...samples) - Math.min(...samples);
        })();
        ok('penalty: the keeper is still able to move once the ball is struck',
           moved !== null && moved > 20, moved === null ? 'could not read the keeper' : `travelled ${moved.toFixed(0)}px`);

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
