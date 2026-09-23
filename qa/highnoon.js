// ============================================================
// HIGH NOON — the first game on the shared 3D stage.
//
// Drives the real game in a real browser with real mouse input, in a portrait
// viewport, which is the case that makes the stage turn itself sideways:
//
//   1. It builds a 3D scene with both players' own figures in it, turned 90°.
//   2. The board's render loop is paused while it runs and resumed after.
//   3. A thumb on the RIGHT half of the turned picture is P1's holster —
//      checked by pressing where the turned right half actually is on the
//      portrait glass.
//   4. Letting go before the bell is a flinch and hands the round over.
//   5. Letting go on the bell beats an easy bot.
//   6. Left alone, the match still ends (forfeits), inside the budget.
//   7. Nothing leaks: no overlay, no canvas, no page errors.
//
// Screenshots land in qa/shot-highnoon-*.png.
//
// usage: node highnoon.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';

const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

async function launch(page, skill) {
    await page.evaluate(async skill => {
        const { state } = await import('/src/core/GameState.js');
        const MM = await import('/src/minigames/MinigameManager.js');
        window.__RESULT = undefined;
        state.mgActive = true;
        state.mgType = 'highnoon';
        state.players[1].isBot = true;
        document.getElementById('minigame-layer').style.display = 'flex';
        document.getElementById('splash').style.display = 'none';
        const mod = await MM.loadMinigame('highnoon');
        window.__HN = mod;
        window.__T0 = performance.now();
        mod.start(true, w => { window.__RESULT = { winner: w, ms: performance.now() - window.__T0 }; }, skill);
    }, skill);
}
const dbg = page => page.evaluate(() => window.__HN && window.__HN._debugState());
const result = page => page.evaluate(() => window.__RESULT || null);

async function waitPhase(page, phase, ms = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const s = await dbg(page);
        if (s && s.phase === phase) return s;
        if (s && s.phase === 'finale') return null;     // the match is over
        if (await result(page)) return null;
        await page.waitForTimeout(15);
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

    // Where P1's and P2's halves are on the portrait glass. The stage turns
    // 90° clockwise, so its right half is the BOTTOM of the portrait screen.
    const P1 = { x: 206, y: 740 }, P2 = { x: 206, y: 150 };

    // ══════ 1-3. The stage, the figures, the turn, the pause, the holster ══════
    await launch(page, 0.25);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(__dirname, 'shot-highnoon-intro.png') });
    let s = await dbg(page);
    ok('stage built a WebGL scene', !!s && s.gl, JSON.stringify(s));
    ok('portrait viewport → stage turned sideways', !!s && s.turned);
    const paused = await page.evaluate(async () => (await import('/src/engine/Renderer.js')).isBoardPaused());
    ok('the board stops drawing under the stage', paused === true);

    s = await waitPhase(page, 'holster');
    await page.mouse.move(P1.x, P1.y);
    await page.mouse.down();
    await page.waitForTimeout(120);
    s = await dbg(page);
    ok('a thumb on the turned right half is P1\'s holster', !!s && s.held[0] === 1 && s.held[1] === 0, JSON.stringify(s && s.held));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(__dirname, 'shot-highnoon-holster.png') });

    // ══════ 4. Let go mid-walk: a flinch ══════
    // The bell can come as early as the third pace (1.5 s), so let go well
    // inside that and photograph afterwards — a SwiftShader screenshot can take
    // longer than a pace.
    s = await waitPhase(page, 'walk');
    ok('both holding starts the walk', !!s);
    await page.waitForTimeout(250);
    const pre = await dbg(page);
    await page.mouse.up();
    await page.waitForTimeout(150);
    s = await dbg(page);
    if (pre.phase === 'walk') {
        ok('letting go before the bell hands the round over',
           s.last && s.last.kind === 'flinch' && s.last.loser === 0 && s.score[1] === pre.score[1] + 1,
           `${JSON.stringify(pre.score)} → ${JSON.stringify(s.score)} ${JSON.stringify(s.last)}`);
    } else {
        ok('letting go before the bell hands the round over', false, `phase was ${pre.phase} ${JSON.stringify(pre.last)}`);
    }
    await page.screenshot({ path: path.join(__dirname, 'shot-highnoon-flinch.png') });

    // ══════ 5. Play it properly: hold, and let go on the bell ══════
    let won = 0, lost = 0, drawShot = false; const log = [];
    for (let round = 0; round < 6; round++) {
        s = await waitPhase(page, 'holster', 12000);
        if (!s) { log.push('no holster: ' + JSON.stringify(await dbg(page))); break; }
        await page.mouse.move(P1.x, P1.y);
        await page.mouse.down();
        if (round === 0 && await waitPhase(page, 'walk', 12000)) {
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(__dirname, 'shot-highnoon-walk.png') });
        }
        s = await waitPhase(page, 'draw', 12000);
        if (!s) { log.push('no draw: ' + JSON.stringify(await dbg(page))); await page.mouse.up(); break; }
        if (!drawShot) {
            await page.waitForTimeout(40);
            await page.screenshot({ path: path.join(__dirname, 'shot-highnoon-draw.png') });
            drawShot = true;
        }
        const pre = s.score.slice();
        await page.mouse.up();
        await page.waitForTimeout(250);
        const st = await dbg(page), post = st.score;
        if (post[0] > pre[0]) won++; else if (post[1] > pre[1]) lost++;
        log.push(JSON.stringify(st.last));
        if (round === 0) {
            await page.waitForTimeout(350);
            await page.screenshot({ path: path.join(__dirname, 'shot-highnoon-shot.png') });
        }
    }
    ok('letting go on the bell beats an easy bot', won >= 2 && won > lost, `won ${won} · lost ${lost} · ${log.join(' ')}`);
    // Whatever is left of the match, played by letting go on the bell, until
    // the finale; then photograph the winner's moment.
    const t0 = Date.now();
    while (!(await result(page)) && Date.now() - t0 < 40000) {
        const st = await dbg(page);
        if (!st) break;
        if (st.phase === 'finale') {
            await page.waitForTimeout(900);
            await page.screenshot({ path: path.join(__dirname, 'shot-highnoon-finale.png') });
            break;
        }
        if (st.phase === 'holster') { await page.mouse.move(P1.x, P1.y); await page.mouse.down(); }
        if (st.phase === 'draw') await page.mouse.up();
        await page.waitForTimeout(20);
    }
    await page.mouse.up();
    let r = null;
    for (let i = 0; i < 100 && !r; i++) { r = await result(page); if (!r) await page.waitForTimeout(100); }
    ok('the match resolves once', !!r, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'no result');

    // ══════ 7. Cleanup ══════
    const after = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const lay = document.getElementById('minigame-layer');
        return {
            paused: R.isBoardPaused(),
            orphans: Array.from(lay.children).filter(el => !el.id).length,
            canvases: lay.querySelectorAll('canvas').length,
        };
    });
    ok('the board draws again afterwards', after.paused === false);
    ok('no overlay or canvas left behind', after.orphans === 0 && after.canvases === 0, JSON.stringify(after));

    // ══════ 6. Nobody touches it: it still ends ══════
    await launch(page, 0.85);
    const t1 = Date.now();
    while (!(await result(page)) && Date.now() - t1 < 80000) await page.waitForTimeout(250);
    r = await result(page);
    ok('left alone, the match still ends', !!r, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    ok('...inside the 15-40 s target', !!r && r.ms / 1000 >= 15 && r.ms / 1000 <= 40, r ? `${(r.ms / 1000).toFixed(1)}s` : '—');

    // A force-end (the 90 s watchdog path) must release everything too.
    await launch(page, 0.55);
    await page.waitForTimeout(1500);
    const forced = await page.evaluate(async () => {
        const MM = await import('/src/minigames/MinigameManager.js');
        const R = await import('/src/engine/Renderer.js');
        MM.forceEndMinigame();
        const lay = document.getElementById('minigame-layer');
        return { paused: R.isBoardPaused(), canvases: lay.querySelectorAll('canvas').length };
    });
    ok('a force-end releases the stage and resumes the board', !forced.paused && forced.canvases === 0, JSON.stringify(forced));

    // ══════ 8. Through the manager: the hold card, the turned chrome ══════
    // Everything above boots the module directly. This goes through the
    // arcade's own entry point, so the SIDE-ON hold card, the ready buttons and
    // the countdown are the real ones.
    await page.evaluate(() => window.__QA.launchArcade('highnoon'));
    let holdShot = false, cdShot = false, sideOn = null, pillsHidden = null;
    const t2 = Date.now();
    while (Date.now() - t2 < 20000 && !(cdShot && holdShot)) {
        const vis = await page.evaluate(() => {
            const v = id => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
            const lay = document.getElementById('minigame-layer');
            return { hold: v('mg-page-hold'), cd: v('mg-countdown'), orient: (document.getElementById('orient-name') || {}).textContent,
                     side: lay.classList.contains('is-sideon'),
                     pill: getComputedStyle(document.getElementById('mg-neutral')).visibility };
        });
        if (vis.hold && !holdShot) {
            ok('the hold card is SIDE-ON', vis.orient === 'SIDE-ON', vis.orient);
            await page.screenshot({ path: path.join(__dirname, 'shot-highnoon-hold.png') });
            holdShot = true;
        }
        if (vis.cd && !cdShot) {
            sideOn = vis.side; pillsHidden = vis.pill === 'hidden';
            await page.screenshot({ path: path.join(__dirname, 'shot-highnoon-countdown.png') });
            cdShot = true;
        }
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(60);
    }
    ok('the manager saw the hold card and the countdown', holdShot && cdShot, `hold=${holdShot} countdown=${cdShot}`);
    ok('the layer is side-on for the countdown, with the edge pills hidden', sideOn === true && pillsHidden === true,
       `side=${sideOn} pillsHidden=${pillsHidden}`);
    await page.evaluate(async () => { const M = await import('/src/minigames/MinigameManager.js'); M.forceEndMinigame(); });

    ok('no console/page errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
