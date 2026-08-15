// ============================================================
// Memory Match with no clock on it: does nothing move on its own, and can the
// board still be finished?
//
// Removing the per-move clock cost this game its "resolves with nobody playing"
// guarantee, so botcheck can no longer carry it and the arcade sweep taps at
// random, which is hopeless against twelve pairs. Two things are worth asserting
// and they are different questions:
//
//   1. NOTHING MOVES ON ITS OWN. Left alone, the board must sit exactly as it
//      is — no card turns itself over, no turn passes. This is the change that
//      was asked for, and it is checkable by simply not touching it.
//
//   2. IT STILL FINISHES. The real bot plays P2 with its own memory; this
//      drives P1 by turning any two face-down cards. That is a weak player, but
//      a weak player and a competent one still empty a board.
//
// usage: node memorymatch.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));
const COLS = 5, ROWS = 5;

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

    async function launch(withBot) {
        await page.evaluate(async (bot) => {
            const { state } = await import('/src/core/GameState.js');
            const MM = await import('/src/minigames/MinigameManager.js');
            const layer = document.getElementById('minigame-layer');
            [...layer.children].filter(el => !el.id).forEach(el => el.remove());
            layer.style.display = 'flex';
            document.getElementById('splash').style.display = 'none';
            [1, 2].forEach(i => { document.getElementById(`mg-ready-${i}`).style.display = 'none'; });
            state.mgActive = true; state.gameState = 'MINIGAME';
            state.mgType = 'memorymatch'; state.players[1].isBot = bot;
            window.__RESULT = undefined; window.__PAY = null;
            const mod = await MM.loadMinigame('memorymatch');
            mod.start(bot, (w, p) => { window.__RESULT = w; window.__PAY = p || null; }, 0.85);
        }, withBot);
        await page.waitForTimeout(800);
    }

    // A picture of the grid: which cells are still face down, and where they are.
    // A face-down card is dark blue with a lit border; an emptied slot is a flat
    // wash of the background with no border, so the PEAK brightness separates
    // them where the mean does not.
    const grid = () => page.evaluate(({ COLS, ROWS }) => {
        const cv = [...document.querySelectorAll('#minigame-layer canvas')].pop();
        if (!cv) return null;
        const g = cv.getContext('2d');
        const dpr = cv.width / cv.clientWidth;
        const W = cv.clientWidth, H = cv.clientHeight;
        const padY = Math.min(148, H * 0.18);
        const cell = Math.floor(Math.min(W * 0.95 / COLS, (H - padY * 2) / ROWS));
        const x0 = Math.round((W - cell * COLS) / 2), y0 = Math.round((H - cell * ROWS) / 2);
        const out = [];
        for (let i = 0; i < COLS * ROWS; i++) {
            const cxi = i % COLS, cyi = Math.floor(i / COLS);
            const px = Math.round((x0 + cxi * cell + cell * 0.18) * dpr);
            const py = Math.round((y0 + cyi * cell + cell * 0.18) * dpr);
            const s  = Math.round(cell * 0.64 * dpr);
            const d = g.getImageData(px, py, s, s).data;
            let peak = 0, blue = 0, n = 0;
            const step = Math.max(1, Math.floor(s / 9));
            for (let y = 0; y < s; y += step) {
                for (let x = 0; x < s; x += step) {
                    const k = (y * s + x) * 4;
                    const r = d[k], gg = d[k + 1], b = d[k + 2];
                    peak = Math.max(peak, (r + gg + b) / 3);
                    if (b > r + 20 && b > 60) blue++;
                    n++;
                }
            }
            out.push({
                i, x: x0 + cxi * cell + cell / 2, y: y0 + cyi * cell + cell / 2,
                down: peak >= 62 && blue / n > 0.55, peak: Math.round(peak),
            });
        }
        return out;
    }, { COLS, ROWS });

    const tapCell = c => page.evaluate(({ x, y }) => {
        const ov = [...document.getElementById('minigame-layer').children].find(e => !e.id);
        ov.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, { x: c.x, y: c.y });

    // ══════════ 1. Nothing moves on its own ══════════
    await launch(false);
    const start = await grid();
    ok('board: 25 cells, all face down at the off',
       !!start && start.length === 25 && start.filter(c => c.down).length === 25,
       start ? `${start.filter(c => c.down).length} down` : 'no board');
    const startTurn = await page.evaluate(() => (document.getElementById('mg-neutral') || {}).textContent);

    await page.waitForTimeout(14000);           // longer than any clock ever was
    const idle = await grid();
    const idleTurn = await page.evaluate(() => (document.getElementById('mg-neutral') || {}).textContent);
    ok('no clock: left alone for 14 s, not one card turns itself over',
       !!idle && idle.filter(c => c.down).length === 25,
       idle ? `${idle.filter(c => c.down).length} still down` : 'no board');
    ok('no clock: and the turn does not pass on its own',
       idleTurn === startTurn, `"${startTurn}" → "${idleTurn}"`);
    ok('no clock: no countdown is drawn on the player',
       !/\d+s/.test(idleTurn || ''), `"${idleTurn}"`);

    // ══════════ 2. It still finishes when it is played ══════════
    await launch(true);                          // the real bot takes P2
    const t0 = Date.now();
    let turns = 0;
    while (Date.now() - t0 < 200000) {
        if (await page.evaluate(() => window.__RESULT !== undefined)) break;
        const b = await grid();
        if (!b) break;
        const down = b.filter(c => c.down);
        if (down.length < 2) { await page.waitForTimeout(400); continue; }
        // Turn any two. A memoryless player is a weak one, which is the point:
        // if the board still empties against a weak player, it always empties.
        const a = down[Math.floor(Math.random() * down.length)];
        let z = down[Math.floor(Math.random() * down.length)];
        if (z.i === a.i) z = down.find(c => c.i !== a.i);
        await tapCell(a); await page.waitForTimeout(200);
        await tapCell(z); await page.waitForTimeout(1100);
        turns++;
    }
    const done = await page.evaluate(() => ({ r: window.__RESULT, pay: window.__PAY }));
    const secs = (Date.now() - t0) / 1000;
    ok('play: the board empties and the game resolves',
       done.r !== undefined, `${turns} turns, ${secs.toFixed(0)}s, winner ${done.r}`);
    ok('pay: both players bank what they turned',
       Array.isArray(done.pay) && done.pay[0] + done.pay[1] > 0, JSON.stringify(done.pay));
    ok('pay: neither side exceeds the 30 cap',
       Array.isArray(done.pay) && done.pay.every(v => v <= 30), JSON.stringify(done.pay));

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-memorymatch.json'),
        JSON.stringify({ pass, fail, turns, secs, done, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
