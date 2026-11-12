// Hostile-peer probe: a third page joins a loopback room and sends forged
// traffic straight through the transport. Lobby-phase only, so it runs in
// seconds. Asserts that the guest's roster, snapshot events and DOM are
// unaffected by a non-host peer, and that markup sent BY the host is defanged.
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);
const EVIL = '<img src=x onerror="window.__pwned=1">';

async function newPage(ctx, label, errors) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`[${label}] PAGEERROR ${e.message}`));
    await page.addInitScript(() => {
        try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {}
    });
    await page.goto(BASE + '?net=local', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.getElementById('btn-online'), null, { timeout: 30000 });
    return page;
}

(async () => {
    const errors = [];
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    // bypassCSP so the probe proves the GUARD works, not just the policy.
    const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 412, height: 892 }, hasTouch: true });
    try {
        const host = await newPage(ctx, 'host', errors);
        const guest = await newPage(ctx, 'guest', errors);
        const evil = await newPage(ctx, 'attacker', errors);

        await host.click('#btn-online');
        await host.click('#btn-lobby-host');
        await host.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room', null, { timeout: 15000 });
        const code = (await host.textContent('#lobby-code')).trim();
        await guest.click('#btn-online');
        await guest.fill('#lobby-code-input', code);
        await guest.dispatchEvent('#lobby-code-input', 'input');
        await guest.click('#btn-lobby-join');
        await guest.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room', null, { timeout: 15000 });
        await guest.waitForTimeout(600);

        // Record every snapshot the guest's session accepts.
        await guest.evaluate(async () => {
            const N = await import('/src/net/NetSession.js');
            window.__snaps = [];
            N.on('snap', s => window.__snaps.push(s));
        });
        const rosterOf = p => p.evaluate(async () =>
            JSON.stringify((await import('/src/net/NetSession.js')).roster()));
        const before = await rosterOf(guest);
        const domBefore = await guest.evaluate(() => document.getElementById('lobby').innerHTML);

        // The attacker is a bare transport peer: no HELLO, no seat.
        await evil.evaluate(async code => {
            const T = await import('/src/claw-core/net/NetTransport.js');
            await T.connect(code);
            window.__T = T;
        }, code);
        await evil.waitForTimeout(800);

        const forgedSeat = (n, extra = {}) => ({ peerId: 'lb-attacker', name: n, char: null, ready: true, connected: true, bot: false, ...extra });
        await evil.evaluate(({ EVIL }) => {
            const T = window.__T;
            T.send({ t: 'lobby', v: 1, code: 'XXXX', seats: [{ peerId: 'lb-attacker', name: EVIL, char: null, ready: true, connected: true, bot: false }] });
            T.send({ t: 'snap', v: 1, s: { gs: 'PRE_ROLL', ap: 0, p: [{ id: 0, name: EVIL, inv: [EVIL], allies: [] }] } });
        }, { EVIL });
        await guest.waitForTimeout(1500);

        ok('a LOBBY from a non-host peer leaves the guest roster unchanged',
            (await rosterOf(guest)) === before);
        ok('a SNAP from a non-host peer is never accepted',
            (await guest.evaluate(() => window.__snaps.length)) === 0);
        ok('the lobby DOM did not change for the non-host messages',
            (await guest.evaluate(() => document.getElementById('lobby').innerHTML)) === domBefore);

        // Now the HOST turns hostile: send straight through its own transport.
        await host.evaluate(async ({ EVIL }) => {
            const T = await import('/src/claw-core/net/NetTransport.js');
            const N = await import('/src/net/NetSession.js');
            const me = N.roster()[0];
            T.send({ t: 'lobby', v: 1, code: T.roomCode(), seats: [
                { peerId: me.peerId, name: EVIL, char: null, ready: false, connected: true, bot: false } ] });
            T.send({ t: 'snap', v: 1, s: { gs: 'PRE_ROLL', ap: 0, board: {}, p: [
                { id: 0, name: EVIL, char: 'slime', inv: [EVIL, 'coin'], allies: [], districts: {} } ] } });
        }, { EVIL });
        await guest.waitForTimeout(1500);

        const res = await guest.evaluate(() => ({
            img: !!document.querySelector('img[src="x"]'),
            pwned: window.__pwned === 1,
            html: document.body.innerHTML.includes('onerror'),
            names: JSON.stringify(window.__snaps.map(s => s.p.map(p => p.name))),
            inv: JSON.stringify(window.__snaps.map(s => s.p.map(p => p.inv))),
            snaps: window.__snaps.length,
        }));
        ok('a hostile host snapshot yields no <img> element', !res.img);
        ok('no handler from hostile text ever ran', !res.pwned);
        ok('no "onerror" markup reached the DOM', !res.html);
        ok('snapshot names carry no angle brackets', !/[<>]/.test(res.names), res.names);
        ok('snapshot inventory holds only known items', !/img/.test(res.inv), res.inv);
        ok('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
    } catch (e) { fail.push('HARNESS: ' + (e && e.message)); }
    await browser.close();
    console.log('\n=== HOSTILE PEER ===');
    pass.forEach(p => console.log('  PASS  ' + p));
    fail.forEach(f => console.log('  FAIL  ' + f));
    console.log(`\n${pass.length} passed, ${fail.length} failed`);
    process.exit(fail.length ? 1 : 0);
})();
