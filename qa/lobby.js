// ============================================================
// THE LOBBY, AS IT IS NOW USED
//
// Three things changed and each can fail silently:
//
//   1. The front door is HOST or CODE+JOIN, and asks for no name. A seat still
//      has to end up called something, so the host names the ones that arrive.
//   2. The name box lives in the ROOM. Typing in it has to rename that seat on
//      EVERY device — a rename only the typist can see is worse than no rename
//      at all, because the table is then looking at two different rosters.
//   3. The character cards show the real meshes. WebGL is rendered offscreen
//      into a data URL; if that fails the emoji is supposed to stay, so there
//      are two assertions: "there is a face" and "the face is the 3D one".
//
// usage: node lobby.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];

const pass = [], fail = [], notes = [];
const ok = (n, c, d) => (c ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

async function newPage(ctx, label, errors) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`[${label}] PAGEERROR ${e.message}`));
    page.on('console', m => {
        const t = m.text();
        if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push(`[${label}] ${t}`);
    });
    await page.addInitScript(() => {
        try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {}
    });
    await page.goto(BASE + '?net=local', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 20000 });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    return page;
}

// What each device thinks the roster is called, read off the painted rows —
// not off its own copy of the state, which is the thing in question.
const names = page => page.evaluate(() =>
    [...document.querySelectorAll('#lobby-seats .lobby-seat:not(.ls-empty) .ls-name')]
        .map(el => el.childNodes[0].textContent.trim()));

const chars = page => page.evaluate(() =>
    [...document.querySelectorAll('#lobby-chars .lobby-char')].map(b => ({
        type: b.dataset.lobbyChar,
        shot: !!b.querySelector('.lc-shot'),
        emoji: !!b.querySelector('.lc-ic'),
        by: (b.querySelector('.lc-by') || {}).textContent || null,
        taken: b.classList.contains('taken'),
        sel: b.classList.contains('sel'),
    })));

(async () => {
    const errors = [];
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });

    try {
        const host = await newPage(ctx, 'host', errors);
        const client = await newPage(ctx, 'client', errors);

        // ---- the front door -------------------------------------------------
        await host.click('#btn-online');
        const door = await host.evaluate(() => ({
            nameOnDoor: !!document.querySelector('.lobby-pick #lobby-name'),
            nameInRoom: !!document.querySelector('.lobby-room #lobby-name'),
            doors: document.querySelectorAll('.lobby-pick .lobby-door').length,
            joinDisabled: document.getElementById('btn-lobby-join').disabled,
        }));
        ok('the door offers exactly two ways in', door.doors === 2, `found ${door.doors}`);
        ok('the door does not ask for a name', !door.nameOnDoor && door.nameInRoom,
            `on door: ${door.nameOnDoor}, in room: ${door.nameInRoom}`);
        ok('JOIN stays shut until a code is typed', door.joinDisabled);

        // ---- host, then join, both WITHOUT typing a name --------------------
        await host.click('#btn-lobby-host');
        await host.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room', null, { timeout: 15000 });
        const code = (await host.textContent('#lobby-code')).trim();

        await client.click('#btn-online');
        await client.fill('#lobby-code-input', code);
        await client.dispatchEvent('#lobby-code-input', 'input');
        await client.click('#btn-lobby-join');
        await client.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room', null, { timeout: 15000 });
        await host.waitForTimeout(600);

        const seated = await names(host);
        notes.push(`unnamed seats came out as: ${JSON.stringify(seated)}`);
        ok('a seat nobody named still has a name', seated.length === 2 && seated.every(n => n && n.length),
            JSON.stringify(seated));
        ok('two unnamed seats do not get the same name', seated[0] !== seated[1], JSON.stringify(seated));

        const shown = await client.inputValue('#lobby-name');
        ok('the name box shows the name you were given', shown === seated[1],
            `box "${shown}", roster "${seated[1]}"`);

        // ---- renaming, in the room, reaches the other device ----------------
        await client.fill('#lobby-name', 'Mo');
        await client.dispatchEvent('#lobby-name', 'input');
        await client.waitForTimeout(900);
        const onHost = await names(host);
        const onClient = await names(client);
        notes.push(`after the rename — host sees ${JSON.stringify(onHost)}, client sees ${JSON.stringify(onClient)}`);
        ok('renaming yourself in the room reaches the other device', onHost[1] === 'Mo',
            `host sees seat 2 as "${onHost[1]}"`);
        ok('both devices agree on the roster', JSON.stringify(onHost) === JSON.stringify(onClient),
            `${JSON.stringify(onHost)} vs ${JSON.stringify(onClient)}`);

        await host.fill('#lobby-name', 'Ana');
        await host.dispatchEvent('#lobby-name', 'input');
        await host.waitForTimeout(900);
        const seenByClient = await names(client);
        ok('the host can rename itself too', seenByClient[0] === 'Ana',
            `client sees seat 1 as "${seenByClient[0]}"`);

        // ---- the character cards --------------------------------------------
        const cards = await chars(client);
        const withShot = cards.filter(c => c.shot).length;
        const withFace = cards.filter(c => c.shot || c.emoji).length;
        notes.push(`character cards: ${cards.length}, with a 3D shot: ${withShot}`);
        ok('every character has a face', withFace === cards.length && cards.length > 0,
            `${withFace}/${cards.length}`);
        ok('the characters are the real 3D pieces', withShot === cards.length,
            `${withShot}/${cards.length} rendered; the rest fell back to emoji`);

        // ---- taken characters say who took them ------------------------------
        await host.click('[data-lobby-char="slime"]');
        await host.waitForTimeout(600);
        const slime = (await chars(client)).find(c => c.type === 'slime');
        ok('a character taken by somebody else is marked taken', !!slime && slime.taken,
            slime ? `taken=${slime.taken}` : 'no slime card');
        ok('a taken character says who has it', !!slime && slime.by === 'Ana',
            slime ? `says "${slime.by}"` : 'no slime card');

        await client.click('[data-lobby-char="ghost"]');
        await client.waitForTimeout(600);
        const mine = (await chars(client)).find(c => c.type === 'ghost');
        ok('your own pick is marked as yours, not as taken', !!mine && mine.sel && !mine.taken,
            mine ? `sel=${mine.sel} taken=${mine.taken}` : 'no ghost card');

        // ---- and the room still starts a match -------------------------------
        await host.click('#btn-lobby-ready');
        await client.click('#btn-lobby-ready');
        await host.waitForTimeout(700);
        ok('a room of two named, chosen, ready players can start',
            await host.evaluate(() => !document.getElementById('btn-lobby-start').disabled));

        ok('the lobby produces no errors', errors.length === 0, errors.slice(0, 4).join(' | '));

        await host.screenshot({ path: path.join(__dirname, 'shot-lobby-room.png') });
    } catch (e) {
        fail.push('HARNESS: ' + (e && e.message));
    }

    await browser.close();
    console.log('\n=== THE LOBBY ===');
    notes.forEach(n => console.log('  ·     ' + n));
    pass.forEach(p => console.log('  PASS  ' + p));
    fail.forEach(f => console.log('  FAIL  ' + f));
    if (errors.length) { console.log('\n  ERRORS'); errors.slice(0, 8).forEach(e => console.log('    ' + e)); }
    console.log(`\n${pass.length} passed, ${fail.length} failed`);
    process.exit(fail.length ? 1 : 0);
})();
