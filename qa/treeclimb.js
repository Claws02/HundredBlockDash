// ============================================================
// Tree Climb: are the leaves actually random, and does a miss drop you?
//
// The sides used to strictly alternate — left, right, left, right — because the
// anti-repeat guard compared the new side against the side just jumped to, which
// was the same value by the time it ran. It read as random in the code and was a
// metronome on the screen. This reads the lit leaf straight off the canvas over
// a long climb and checks the sequence for the properties randomness has.
//
// It also checks the fall: grab the wrong side and you drop to the last branch
// placed on THAT side, then climb the same ladder back. The pending leaf after a
// fall is therefore predictable from the ladder you climbed, which makes the
// rule checkable without exporting anything.
//
// usage: node treeclimb.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

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

    // Two humans, so nothing is driving P2 while we watch P1's stem.
    await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const MM = await import('/src/minigames/MinigameManager.js');
        const layer = document.getElementById('minigame-layer');
        [...layer.children].filter(el => !el.id).forEach(el => el.remove());
        layer.style.display = 'flex';
        document.getElementById('splash').style.display = 'none';
        [1, 2].forEach(i => { document.getElementById(`mg-ready-${i}`).style.display = 'none'; });
        state.mgActive = true; state.gameState = 'MINIGAME';
        state.mgType = 'treeclimb'; state.players[1].isBot = false;
        window.__RESULT = undefined;
        const mod = await MM.loadMinigame('treeclimb');
        mod.start(false, w => { window.__RESULT = w; }, 0.55);
    });
    await page.waitForTimeout(700);

    // The lit leaf is the only bright green on the stem — climbed branches are
    // drawn dark and the ones above are dimmer still. Its x tells us the side.
    const leafSide = () => page.evaluate(() => {
        const cv = [...document.querySelectorAll('#minigame-layer canvas')].pop();
        if (!cv) return null;
        const g = cv.getContext('2d');
        const dpr = cv.width / cv.clientWidth;
        const H = cv.clientHeight;
        const meY = H - 168, SPACING = 74;
        const y0 = Math.round((meY - SPACING - 34) * dpr);
        const h  = Math.round(68 * dpr);
        const band = g.getImageData(0, y0, cv.width, h).data;
        let sum = 0, n = 0;
        for (let i = 0; i < band.length; i += 4) {
            const r = band[i], gg = band[i + 1], b = band[i + 2];
            if (gg > 185 && r < 165 && b < 165) { sum += ((i / 4) % cv.width); n++; }
        }
        if (n < 8) return null;
        const stemX = cv.clientWidth * 0.37;
        return (sum / n / dpr) > stemX ? 1 : -1;
    });

    const tap = (side) => page.evaluate(s => {
        const ov = [...document.getElementById('minigame-layer').children].find(e => !e.id);
        const x = s > 0 ? window.innerWidth * 0.80 : window.innerWidth * 0.20;
        const y = window.innerHeight * 0.80;          // P1's half
        ov.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, side);

    // ── Climb, recording every side as it comes ────────────────────────────
    const ladder = [];
    for (let i = 0; i < 16; i++) {
        const s = await leafSide();
        if (s === null) break;
        ladder.push(s);
        await tap(s);
        await page.waitForTimeout(300);               // jump + settle
    }
    ok('climb: the probe could read and climb the stem', ladder.length >= 14,
       `${ladder.length} branches read`);

    // Randomness, checked the way you check a coin: both sides come up, and the
    // sequence is not a perfect alternation.
    const lefts = ladder.filter(s => s === -1).length;
    let alternations = 0, repeats = 0;
    for (let i = 1; i < ladder.length; i++) {
        if (ladder[i] === ladder[i - 1]) repeats++; else alternations++;
    }
    ok('random: both sides appear', lefts > 0 && lefts < ladder.length,
       `${lefts} left of ${ladder.length}`);
    ok('random: the sides do NOT strictly alternate',
       repeats > 0, `${repeats} repeat(s), ${alternations} alternation(s) in ${ladder.length}`);
    ok('random: nor do they get stuck on one side',
       alternations > 0, `${alternations} alternation(s)`);

    // Never three of the same side running — the one restriction on the draw.
    let worst = 1, run = 1;
    for (let i = 1; i < ladder.length; i++) {
        run = ladder[i] === ladder[i - 1] ? run + 1 : 1;
        worst = Math.max(worst, run);
    }
    ok('random: never three of the same side in a row', worst <= 2, `longest run ${worst}`);

    // ── The fall ───────────────────────────────────────────────────────────
    // Standing on branch `height-1`, grabbing the wrong side drops us to the
    // last branch below that carries it. The leaf showing afterwards is then the
    // one above wherever we landed — which the ladder we recorded predicts.
    const height = ladder.length;
    const pending = await leafSide();
    ok('fall: a leaf is showing before the miss', pending !== null, String(pending));
    const wrong = -pending;
    let to = 0;
    for (let i = height - 2; i >= 0; i--) if (ladder[i] === wrong) { to = i + 1; break; }

    await tap(wrong);
    await page.waitForTimeout(900);                   // fall + recovery
    const after = await leafSide();
    ok('fall: grabbing the wrong side drops you to the last branch on that side',
       after !== null && after === ladder[to],
       `fell to height ${to}, expected leaf ${ladder[to]}, saw ${after}`);
    ok('fall: it costs real height, never zero', to < height, `${height} → ${to}`);
    await page.screenshot({ path: path.join(__dirname, 'shot-treeclimb.png') });

    // And the ladder above is unchanged — you re-climb what you fell down.
    const reclimb = [];
    for (let i = 0; i < Math.min(3, height - to); i++) {
        const s = await leafSide();
        if (s === null) break;
        reclimb.push(s);
        await tap(s);
        await page.waitForTimeout(300);
    }
    ok('fall: the branches above survive, so you climb the same ladder back',
       reclimb.length > 0 && reclimb.every((s, i) => s === ladder[to + i]),
       `saw [${reclimb}] expected [${ladder.slice(to, to + reclimb.length)}]`);

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(__dirname, 'result-treeclimb.json'),
        JSON.stringify({ pass, fail, ladder, height, pending, to, errors: [...new Set(errors)] }, null, 2));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
