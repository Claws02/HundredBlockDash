// ============================================================
// Light Cycles: does pushing the stick send the cycle where you pushed?
//
// The arena is ONE grid, drawn once and unrotated, with both cycles on it.
// P2's input used to be inverted on both axes on the reasoning that their half
// is upside-down — but there are no halves here, and the inversion meant P2
// pushing away from themselves drove straight back into their own trail.
//
// This drives a real joystick drag in each half and checks the cycle's actual
// heading afterwards, in grid terms. It is deliberately blunt: push down, expect
// down, for BOTH players.
//
// usage: node steering.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

// Directions as the module indexes them: 0 up, 1 right, 2 down, 3 left.
const NAME = ['up', 'right', 'down', 'left'];

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

    // Two humans, so neither half is driven by the AI.
    async function launch() {
        await page.evaluate(async () => {
            const { state } = await import('/src/core/GameState.js');
            const MM = await import('/src/minigames/MinigameManager.js');
            const layer = document.getElementById('minigame-layer');
            [...layer.children].filter(el => !el.id).forEach(el => el.remove());
            layer.style.display = 'flex';
            document.getElementById('splash').style.display = 'none';
            [1, 2].forEach(i => { document.getElementById(`mg-ready-${i}`).style.display = 'none'; });
            state.mgActive = true; state.gameState = 'MINIGAME';
            state.mgType = 'lightcycles'; state.players[1].isBot = false;
            window.__RESULT = undefined;
            const mod = await MM.loadMinigame('lightcycles');
            mod.start(false, w => { window.__RESULT = w; }, 0.55);
        });
        // Let both cycles run free for a moment first. They start two cells off
        // their own wall heading into the arena, so testing a turn immediately
        // after launch can steer a cycle straight into the wall behind it — the
        // round then ends mid-sample and the reading is of the NEXT round's
        // layout. 1.6 s puts roughly eight cells of clearance behind each.
        await page.waitForTimeout(1600);
    }

    // Where is each cycle heading? Inferred from two position samples, which
    // needs nothing exported from the module.
    const heads = () => page.evaluate(() => {
        const cv = [...document.querySelectorAll('#minigame-layer canvas')].pop();
        if (!cv) return null;
        const g = cv.getContext('2d');
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        const dpr = cv.width / cv.clientWidth;
        // The heads are drawn brighter than the trails: #ff8080 and #80bcff.
        const acc = [{ sx: 0, sy: 0, n: 0 }, { sx: 0, sy: 0, n: 0 }];
        for (let y = 0; y < cv.height; y += 2) {
            for (let x = 0; x < cv.width; x += 2) {
                const i = (y * cv.width + x) * 4;
                const r = d[i], gg = d[i + 1], b = d[i + 2];
                if (r > 230 && gg > 110 && gg < 165 && b > 110 && b < 165) { acc[0].sx += x; acc[0].sy += y; acc[0].n++; }
                else if (b > 230 && gg > 165 && gg < 215 && r > 100 && r < 160) { acc[1].sx += x; acc[1].sy += y; acc[1].n++; }
            }
        }
        return acc.map(a => a.n > 3 ? { x: a.sx / a.n / dpr, y: a.sy / a.n / dpr } : null);
    });

    // Push the stick in a screen direction and report where the cycle then goes.
    //
    // Every case is approached from a PERPENDICULAR heading first. A cycle
    // refuses to reverse into its own neck — correctly, that rule is what stops
    // an instant self-crash — so asking a cycle that starts heading up to go
    // down is a legitimate no-op and would test the guard rather than the
    // mapping. P1 starts heading up and P2 heading down, so without this the
    // "down" case for P1 and the "up" case for P2 are both meaningless.
    async function push(pid, dx, dy) {
        // Anchor inside that player's half: P1 owns the bottom, P2 the top.
        const ax = 206, ay = pid === 0 ? 700 : 190;
        await page.mouse.move(ax, ay);
        await page.mouse.down();

        // Step 1: turn side-on, so the target is never a reversal.
        const perpX = Math.abs(dx) > Math.abs(dy) ? 0 : 90;
        const perpY = Math.abs(dx) > Math.abs(dy) ? 90 : 0;
        await page.mouse.move(ax + perpX, ay + perpY, { steps: 3 });
        await page.waitForTimeout(260);

        // Step 2: the push under test.
        await page.mouse.move(ax, ay, { steps: 2 });          // back through the dead zone
        await page.mouse.move(ax + dx, ay + dy, { steps: 4 });
        await page.waitForTimeout(110);
        const a = await heads();
        await page.waitForTimeout(400);
        const b = await heads();
        await page.mouse.up();
        if (!a || !b || !a[pid] || !b[pid]) return null;
        const mx = b[pid].x - a[pid].x, my = b[pid].y - a[pid].y;
        if (Math.hypot(mx, my) < 6) return null;
        return Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 1 : 3) : (my > 0 ? 2 : 0);
    }

    // Each case: push this way on screen, expect the cycle to travel that way.
    // Same expectation for both players — that is the whole point.
    const CASES = [
        { d: [0, 90],  want: 2, label: 'down' },
        { d: [90, 0],  want: 1, label: 'right' },
        { d: [0, -90], want: 0, label: 'up' },
        { d: [-90, 0], want: 3, label: 'left' },
    ];

    for (const pid of [0, 1]) {
        for (const c of CASES) {
            await launch();
            const got = await push(pid, c.d[0], c.d[1]);
            ok(`P${pid + 1}: pushing ${c.label} drives ${c.label}`,
               got === c.want,
               got === null ? 'could not read the cycle' : `went ${NAME[got]}`);
        }
    }

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-steering.json'),
        JSON.stringify({ pass, fail, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
