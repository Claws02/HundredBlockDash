// ============================================================
// TABLETOP CHARACTER SELECT — Player 2 picks from the far side of the phone.
//
//   1. Tabletop: Player 1's step reads the right way up for Player 1.
//   2. Player 2's step is turned a half turn to face Player 2.
//   3. A real tap on the turned screen picks the card under the finger, and
//      CONFIRM (under Player 2's thumb) confirms it for Player 2.
//   4. The map screen after it is not left turned.
//   5. Pass & play hands the phone over, so its Player 2 step is NOT turned.
//
// usage: node tabletopselect.js     (screenshots: qa/shot-tabletopselect-*.png)
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

async function boot(browser) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    return { ctx, page, errors };
}
const flipped = page => page.evaluate(() => {
    const el = document.getElementById('char-select');
    return { cls: el.classList.contains('cs-flipped'), tf: getComputedStyle(el).transform };
});
const step = page => page.evaluate(async () => (await import('/src/core/GameState.js')).state.charSelectStep);

(async () => {
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
    const errs = [];

    // ── Tabletop ──
    let { ctx, page, errors } = await boot(browser);
    await page.click('[data-mode="tabletop"]');
    await page.click('#btn-next');
    await page.waitForTimeout(400);
    let f = await flipped(page);
    await page.screenshot({ path: path.join(__dirname, 'shot-tabletopselect-p1.png') });
    ok('tabletop: Player 1\'s step reads the right way up', (await step(page)) === 1 && !f.cls && f.tf === 'none', JSON.stringify(f));
    await page.click('[data-char="slime"]');
    await page.click('#btn-char-confirm');
    await page.waitForTimeout(400);
    f = await flipped(page);
    const title = (await page.textContent('#cs-title')).trim();
    await page.screenshot({ path: path.join(__dirname, 'shot-tabletopselect-p2.png') });
    ok('tabletop: Player 2\'s step is turned a half turn to face them', (await step(page)) === 2 && f.cls && /matrix\(-1, .*-1, 0, 0\)/.test(f.tf) && /PLAYER 2/.test(title), `${title} ${JSON.stringify(f)}`);
    // A real tap where the "ghost" card now sits on the glass (the screen is turned).
    const box = await page.locator('[data-char="ghost"]').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);
    const pick = await page.evaluate(async () => (await import('/src/core/GameState.js')).state.charSelections[1]);
    const cb = await page.locator('#btn-char-confirm').boundingBox();
    await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.waitForTimeout(400);
    const after = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        return { p2: state.players[1].charType, map: getComputedStyle(document.getElementById('map-select')).display !== 'none',
                 cs: document.getElementById('char-select').classList.contains('cs-flipped') };
    });
    ok('tabletop: a real tap on the turned screen picks that card, and CONFIRM confirms it for Player 2', pick === 'ghost' && after.p2 === 'ghost', `picked ${pick}, P2 is ${after.p2}`);
    ok('tabletop: the map screen after it is not left turned', after.map && !after.cs, JSON.stringify(after));
    errs.push(...errors);
    await ctx.close();

    // ── Pass & play ──
    ({ ctx, page, errors } = await boot(browser));
    await page.click('[data-mode="pass"]');
    await page.click('#btn-next');
    await page.waitForTimeout(400);
    await page.click('[data-char="slime"]');
    await page.click('#btn-char-confirm');
    await page.waitForTimeout(400);
    f = await flipped(page);
    ok('pass & play: Player 2\'s step is not turned (the phone is handed over)', (await step(page)) === 2 && !f.cls && f.tf === 'none', JSON.stringify(f));
    errs.push(...errors);
    await ctx.close();

    ok('no console/page errors', errs.length === 0, [...new Set(errs)].slice(0, 4).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
