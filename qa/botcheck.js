// ============================================================
// Bot-path check.
//
// The arcade runs every game with isBot = false, so the AI branch is never
// exercised there. This drives each game's `start(true, onWin, skill)` directly
// at all three difficulty tiers, lets it run unattended (no human input at all),
// and reports whether the bot plays, whether the game resolves on its own, and
// who won. A bot that never scores — or a game that never ends without a human —
// shows up here and nowhere else.
//
// usage: node botcheck.js [seconds-per-run]
//        QA_ONLY=towerstack,parryduel node botcheck.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const BUDGET = parseInt(process.argv[2] || '70', 10);
const TIERS = [['easy', 0.25], ['hard', 0.85]];

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
    let types = await page.evaluate(() => window.__QA.bind());
    if (process.env.QA_ONLY) {
        const want = process.env.QA_ONLY.split(',').map(x => x.trim());
        types = types.filter(t => want.includes(t));
    }

    const rows = [];
    for (const type of types) {
        for (const [tier, skill] of TIERS) {
            current = `${type}/${tier}`;
            const started = await page.evaluate(async ({ t, s }) => {
                const { state } = await import('/src/core/GameState.js');
                const MGM = await import('/src/minigames/MinigameManager.js');
                // Reset the layer the way the manager would before GO.
                const layer = document.getElementById('minigame-layer');
                [...layer.children].filter(el => !el.id).forEach(el => el.remove());
                layer.style.display = 'flex';
                document.getElementById('mg-select-overlay').style.display = 'none';
                [1, 2].forEach(i => { document.getElementById(`mg-ready-${i}`).style.display = 'none'; });

                window.__botResult = undefined;
                state.gameState = 'MINIGAME';
                state.mgActive  = true;
                state.mgType    = t;
                state.players[1].isBot = true;

                // Resolved through the manager's own table, so adding a game
                // never leaves this probe pointing at undefined.js.
                const mod = await MGM.loadMinigame(t);
                mod.start(true, (winner, payouts) => {
                    window.__botResult  = winner;
                    window.__botPayouts = payouts || null;
                }, s);
                return true;
            }, { t: type, s: skill });

            // No human input at all — the bot must carry the game to a result.
            const t0 = Date.now();
            let result;
            while ((Date.now() - t0) / 1000 < BUDGET) {
                result = await page.evaluate(() => window.__botResult);
                if (result !== undefined) break;
                await page.waitForTimeout(200);
            }
            const secs = Math.round((Date.now() - t0) / 1000);
            const neutral = await page.evaluate(() => (document.getElementById('mg-neutral') || {}).textContent);
            const e = errs[current] || [];
            rows.push({ type, tier, resolved: result !== undefined, winner: result, seconds: secs, neutral, errors: [...new Set(e)] });
            console.log(`${result !== undefined ? 'OK  ' : 'HUNG'} ${type.padEnd(13)} ${tier.padEnd(5)} ${String(secs).padStart(3)}s ` +
                        `winner=${result === undefined ? '—' : result} errs=${e.length} | ${(neutral || '').slice(0, 44)}`);

            // Tear down before the next run.
            await page.evaluate(async () => {
                const { state } = await import('/src/core/GameState.js');
                const MGM = await import('/src/minigames/MinigameManager.js');
                state.mgActive = false;
                try { MGM.endMinigame(-1); } catch (e) {}
                const layer = document.getElementById('minigame-layer');
                [...layer.children].filter(el => !el.id).forEach(el => el.remove());
                layer.style.display = 'none';
            });
            await page.waitForTimeout(400);
        }
    }

    fs.writeFileSync(path.join(__dirname, 'result-botcheck.json'), JSON.stringify(rows, null, 2));
    const hung = rows.filter(r => !r.resolved);
    const withErrs = rows.filter(r => r.errors.length);
    // A bot that loses every single run at hard is a tuning smell worth surfacing.
    const botNeverWins = [...new Set(rows.map(r => r.type))].filter(t => {
        const hard = rows.filter(r => r.type === t && r.tier === 'hard' && r.resolved);
        return hard.length > 0 && hard.every(r => r.winner === 0);
    });
    console.log('\n--- SUMMARY ---');
    console.log('never resolved without a human:', hung.length ? hung.map(r => `${r.type}/${r.tier}`).join(', ') : 'none');
    console.log('errors:', withErrs.length ? withErrs.map(r => `${r.type}/${r.tier}(${r.errors.length})`).join(', ') : 'none');
    console.log('bot lost every hard run (check tuning):', botNeverWins.length ? botNeverWins.join(', ') : 'none');
    await browser.close();
    process.exit(hung.length || withErrs.length ? 1 : 0);
})();
