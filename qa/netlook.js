// ============================================================
// NETLOOK — a guest's cosmetics reach the host, and the host's library is the
// room's library.
//
// Two pages on ?net=local (the loopback transport). The host opens the room
// first, so its own look is read while it is still plain; the guest then puts
// on the Supporter Crown and joins. Checks:
//   · the host's roster carries the guest's look, cleaned to known ids;
//   · a hostile look (unknown ids, junk types) is cleaned to the defaults;
//   · the host's deal is drawn only from the host's owned games.
//
// usage: QA_BASE=http://127.0.0.1:8129/index.html node qa/netlook.js
// ============================================================
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'];

const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

async function newPage(ctx, errors, label) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
    await page.addInitScript(() => { try { localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE + '?net=local', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.addScriptTag({ content: AGENT });
    await page.evaluate(() => window.__QA.bind());   // owns the bundle → the crown
    return page;
}

(async () => {
    const errors = [];
    const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
    const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: GL });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    try {
        const host = await newPage(ctx, errors, 'host');
        await host.evaluate(() => localStorage.removeItem('hbd_meta_loadout'));
        await host.click('#btn-online');
        await host.click('#btn-lobby-host');
        await host.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room', null, { timeout: 15000 });
        const code = (await host.textContent('#lobby-code')).trim();

        const guest = await newPage(ctx, errors, 'guest');
        const worn = await guest.evaluate(async () => {
            const C = await import('/src/meta/Cosmetics.js');
            C.equip(0, 'hat', 'crown');
            return C.lookFor(0).hat;
        });
        ok('guest wears the crown before joining', worn === 'crown', worn);
        await guest.click('#btn-online');
        await guest.fill('#lobby-code-input', code);
        await guest.dispatchEvent('#lobby-code-input', 'input');
        await guest.click('#btn-lobby-join');
        await guest.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room', null, { timeout: 15000 });
        await host.waitForTimeout(800);

        const seen = await host.evaluate(async () => {
            const S = await import('/src/net/NetSession.js');
            return S.roster().map(r => r.look && r.look.hat);
        });
        ok('host sees its own plain look and the guest\'s crown', seen[0] === 'none' && seen[1] === 'crown', JSON.stringify(seen));

        const echoed = await guest.evaluate(async () => {
            const S = await import('/src/net/NetSession.js');
            return S.roster().map(r => r.look && r.look.hat);
        });
        ok('the guest gets every look back in the lobby broadcast', echoed[1] === 'crown', JSON.stringify(echoed));

        const cleaned = await host.evaluate(async () => {
            const C = await import('/src/meta/Cosmetics.js');
            return C.sanitize({ hat: 'jetpack', dice: 7, finish: '<img onerror=x>', trail: 'flames', __proto__: { emote: 'x' } });
        });
        ok('a hostile look is cleaned to known ids', cleaned.hat === 'none' && cleaned.dice === 'classic' && cleaned.finish === 'glossy' && cleaned.trail === 'flames' && cleaned.emote === 'none', JSON.stringify(cleaned));

        // The host's deal uses the host's library. Lock everything on the host
        // (in memory) and check the online pool shrinks to the free set.
        const pool = await host.evaluate(async () => {
            const U = await import('/src/meta/Unlocks.js');
            const C = await import('/src/meta/Catalog.js');
            const R = await import('/src/config/MinigameRegistry.js');
            U._reset();
            const p = U.ownedMinigames(R.typesForSurface('online'));
            return { n: p.length, allFree: p.every(t => C.FREE_MINIGAMES.includes(t)) };
        });
        ok('a host without packs deals only free games online', pool.allFree && pool.n === 12, JSON.stringify(pool));
    } catch (e) {
        fail.push('HARNESS: ' + e.message);
    }
    ok('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
    await browser.close();
    pass.forEach(p => console.log('  PASS  ' + p));
    fail.forEach(f => console.log('  FAIL  ' + f));
    console.log(`\n${pass.length} passed, ${fail.length} failed`);
    process.exit(fail.length ? 1 : 0);
})();
