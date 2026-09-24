// ============================================================
// COACH — a fresh install's first match coaches itself (RELEASE_AUDIT UX-03).
//   1. First launch no longer opens the seven-slide How to Play wall.
//   2. The first human turn shows the ROLL bubble with a ring on ROLL.
//   3. The fork and the result card each get their line when they come up.
//   4. The bubble never blocks a tap (pointer-events none).
//   5. Coaching finishes and does not return on the next launch.
// Writes qa/shot-coach-{roll,junction,result}.png.
// usage: node coach.js
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
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('b')) { localStorage.clear(); sessionStorage.setItem('b', '1'); } } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    const wall = await page.evaluate(() => getComputedStyle(document.getElementById('howto-overlay')).display);
    ok('1 first launch: no How to Play wall', wall === 'none', `howto-overlay display ${wall}`);

    await page.addScriptTag({ content: AGENT });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', rounds: 6 }));

    const seen = {};
    const t0 = Date.now();
    while (Date.now() - t0 < 900000) {
        const s = await page.evaluate(() => {
            const c = document.getElementById('coach');
            const st = window.__QA.snapshot();
            return { step: c && c.style.display !== 'none' ? c.dataset.step : null, pe: c ? getComputedStyle(c).pointerEvents : null,
                     ringPe: (document.getElementById('coach-ring') || {}).style ? getComputedStyle(document.getElementById('coach-ring') || document.body).pointerEvents : null,
                     text: c ? c.innerText : '', gs: st.gameState, ap: st.activePlayer, mg: st.mgActive,
                     finished: localStorage.getItem('hbd_coached') };
        }).catch(() => null);
        if (!s) { await page.waitForTimeout(500); continue; }
        if (s.step && !seen[s.step]) {
            seen[s.step] = s;
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(__dirname, `shot-coach-${s.step}.png`) });
        }
        if (s.finished === 'true') break;
        // Play: human taps what a human would; bots and minigames move along.
        await page.evaluate(async () => {
            (await import('/src/engine/Renderer.js')).skipFlyover();
            const st = window.__QA.snapshot();
            // A reader takes in each new screen before acting on it, and the
            // coach (a 250 ms watcher) needs that beat to show its line.
            const vis = id => { const b = document.getElementById(id); return b && b.offsetParent ? id : ''; };
            const key = [st.gameState, st.activePlayer, vis('btn-msg-continue'), vis('btn-cb-start'),
                         document.querySelector('#junction-arrows button') && document.querySelector('#junction-arrows button').offsetParent ? 'j' : ''].join('|');
            if (key !== window.__lk) { window.__lk = key; window.__lkAt = performance.now(); return; }
            if (performance.now() - window.__lkAt < 2000) return;
            for (const id of ['btn-cb-start', 'btn-msg-continue', 'btn-shop-offer-skip', 'btn-close-shop', 'btn-duel-skip', 'btn-ally-pass', 'btn-cancel-drop', 'btn-resolve-pass', 'btn-mg-intro-next', 'btn-mg-launch', 'gate-roll-btn', 'gate-continue-btn']) {
                const b = document.getElementById(id); if (b && b.offsetParent) { if (id === 'btn-mg-intro-next') b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true })); else b.click(); return; }
            }
            const j = document.querySelector('#junction-arrows button'); if (j && j.offsetParent) { j.click(); return; }
            const bet = document.querySelector('#duel-bet-options button'); if (bet && bet.offsetParent) { bet.click(); return; }
            if (st.mgActive) { (await import('/src/minigames/MinigameManager.js')).endMinigame(0); return; }
            if (st.gameState === 'PRE_ROLL' && st.activePlayer === 0) {
                const r = [...document.querySelectorAll('#p1-actions button')].find(x => /roll/i.test(x.innerText));
                // Tap THROUGH the coach: a real pointer click at the button's centre.
                if (r) { const q = r.getBoundingClientRect(); window.__tapAt = [q.left + q.width / 2, q.top + q.height / 2]; }
            }
        }).catch(() => {});
        const at = await page.evaluate(() => { const a = window.__tapAt; window.__tapAt = null; return a; }).catch(() => null);
        if (at) await page.mouse.click(at[0], at[1]);
        await page.waitForTimeout(seen.roll && !seen.result ? 900 : 600);
    }
    ok('2 the ROLL bubble shows on the first human turn', !!seen.roll, seen.roll && seen.roll.text);
    ok('3 the fork gets its line', !!seen.junction, seen.junction ? seen.junction.text : 'no junction reached');
    ok('3 the result card gets its line', !!seen.result, seen.result && seen.result.text);
    ok('4 never blocks a tap', Object.values(seen).every(s => s.pe === 'none'), Object.values(seen).map(s => s.pe).join(','));
    const fin = await page.evaluate(() => localStorage.getItem('hbd_coached'));
    ok('5 coaching finishes', fin === 'true', fin);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    const again = await page.evaluate(() => !!document.getElementById('coach'));
    ok('5 …and does not come back on the next launch', !again);

    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
