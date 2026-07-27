// ============================================================
// Early-input stress test.
//
// Every minigame attaches its input listeners synchronously in _build(), then
// initialises game state inside a double requestAnimationFrame. A player who
// taps the instant "GO!" appears lands in that gap. This launches all 15 games
// and hammers both halves from frame 0, then reports any uncaught error.
//
// This is how QA-016 (TankClash TypeError on tank.rotation) was found.
// usage: node earlytap.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();

    let current = 'boot';
    const errs = {};
    page.on('pageerror', e => { (errs[current] ||= []).push('PAGEERROR: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]); });
    page.on('console', m => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/Failed to load resource/.test(t)) return;
        (errs[current] ||= []).push('CONSOLE: ' + t);
    });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    const types = await page.evaluate(() => window.__QA.bind());

    // Spam every corner of both halves for the first N frames after GO.
    const burst = async () => page.evaluate(() => new Promise(res => {
        const layer = document.getElementById('minigame-layer');
        const r = layer.getBoundingClientRect();
        const pts = [];
        [0.15, 0.5, 0.85].forEach(fx => [0.12, 0.3, 0.7, 0.9].forEach(fy => {
            pts.push([r.left + r.width * fx, r.top + r.height * fy]);
        }));
        let frame = 0;
        const mk = (type, x, y) => new PointerEvent(type, {
            bubbles: true, cancelable: true, clientX: x, clientY: y,
            pointerId: 1 + (frame % 3), pointerType: 'touch', isPrimary: true, button: 0, buttons: 1,
        });
        (function tick() {
            for (const [x, y] of pts) {
                const el = document.elementFromPoint(Math.round(x), Math.round(y));
                if (!el) continue;
                el.dispatchEvent(mk('pointerdown', x, y));
                el.dispatchEvent(mk('pointermove', x + 12, y + 8));
                el.dispatchEvent(mk('pointerup', x, y));
            }
            if (++frame < 10) requestAnimationFrame(tick); else res(frame);
        })();
    }));

    const rows = [];
    for (const type of types) {
        current = type;
        await page.evaluate(t => window.__QA.launchArcade(t), type);
        // Walk the intro to GO, then start hammering the instant mgActive flips.
        for (let i = 0; i < 200; i++) {
            const s = await page.evaluate(() => {
                const snap = window.__QA.snapshot();
                if (snap.mgActive) return { active: true };
                window.__QA.step();
                return { active: false };
            });
            if (s.active) break;
            await page.waitForTimeout(80);
        }
        await burst();                      // frames 0-10
        await page.waitForTimeout(1200);
        await burst();                      // and again once running
        await page.waitForTimeout(600);

        rows.push({ type, errors: [...new Set(errs[type] || [])] });
        const e = errs[type] || [];
        console.log(`${e.length ? 'FAIL' : 'OK  '} ${type.padEnd(12)} ${e.length ? e[0].slice(0, 110) : 'no errors on early input'}`);

        // Reset to a clean arcade state for the next game.
        await page.evaluate(async () => {
            const M = await import('/src/minigames/MinigameManager.js');
            try { M.endMinigame(-1); } catch (e) {}
            document.getElementById('mg-select-overlay').style.display = 'flex';
            document.getElementById('minigame-layer').style.display = 'none';
        });
        await page.waitForTimeout(500);
    }

    fs.writeFileSync(path.join(__dirname, 'result-earlytap.json'), JSON.stringify(rows, null, 2));
    const bad = rows.filter(r => r.errors.length);
    console.log('\n--- SUMMARY ---');
    console.log(bad.length ? 'games throwing on early input: ' + bad.map(r => r.type).join(', ')
                           : 'all 15 games survive early input');
    await browser.close();
    process.exit(bad.length ? 1 : 0);
})();
