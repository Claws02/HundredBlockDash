// ============================================================
// WHAT A CLIENT ACTUALLY SEES WHILE THE HOST PLAYS A TURN
//
// Reported from two real devices: the phone hosting showed every animation,
// the computer that joined showed none of them — no dice, no token moving, no
// swap. Only the modal pop-ups arrived.
//
// Modals are mirrored (src/ui/Scenes.js). Animations are not, and this probe
// exists to say exactly which parts of "not" are which, because there are
// three different answers and they need three different fixes:
//
//   • Never sent at all — the dice, the set pieces, the swap cinematic. These
//     run inside the host's own turn flow and nothing tells a client.
//   • Sent, but not drawn — anything the snapshot carries that the client
//     fails to animate from. Token movement is supposed to be in this group:
//     NetSync plays a hop whenever a snapshot changes a player's position.
//   • Drawn, but not looked at — a camera parked somewhere else while the
//     token moves correctly off screen. Indistinguishable from the first two
//     if you are only watching the screen.
//
// So: roll on the host and sample the CLIENT every 100 ms — token positions,
// how many animations are in flight, the camera. Then say which group each
// symptom is in.
//
// usage: node netfx.js
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
    page.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
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

// One sample of everything worth knowing about what is on screen.
//
// A real function, not a string. `page.evaluate` given a string evaluates it as
// an EXPRESSION, so a string holding a function literal comes back as the
// function object — which is not serialisable, so every sample arrived as
// `undefined` and the first read of one threw. Passing the function itself
// removes the ambiguity.
async function probe() {
    const S = (await import('/src/core/GameState.js')).state;
    const R = await import('/src/engine/Renderer.js');
    const cam  = R.getCamera ? R.getCamera() : null;
    const dice = R.getDiceGroup ? R.getDiceGroup() : null;
    const rc   = document.getElementById('roll-callout');
    const tb   = document.getElementById('turn-banner');
    return {
        t: Math.round(performance.now()),
        gs: S.gameState,
        ap: S.activePlayer,
        cameraState: S.cameraState,
        anims: R.getActiveAnims ? R.getActiveAnims().length : -1,
        cam: cam ? [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)] : null,
        dice: dice ? dice.children.length : -1,
        pos: S.players.map(p => p.mesh
            ? [+p.mesh.position.x.toFixed(2), +p.mesh.position.z.toFixed(2)] : null),
        node: S.players.map(p => p.pos),
        rollCallout: rc && getComputedStyle(rc).display !== 'none' ? (rc.textContent || '').trim() : null,
        turnBanner: !!tb && getComputedStyle(tb).display !== 'none',
    };
}

// How many DISTINCT positions a token passed through. One jump from A to B is
// a teleport; a dozen values in between is an animation.
function distinct(samples, seat) {
    const seen = new Set();
    samples.forEach(s => { const p = s && s.pos && s.pos[seat]; if (p) seen.add(p.join(',')); });
    return seen.size;
}

// Guard every read of a sample: a probe that fails should report what it saw,
// not throw on the first undefined and tell you nothing at all.
function lastOf(samples) { return samples.filter(Boolean).pop() || { node: [], pos: [] }; }
function peak(samples, key) {
    const vals = samples.filter(Boolean).map(s => s[key]).filter(v => typeof v === 'number');
    return vals.length ? Math.max(...vals) : -1;
}

(async () => {
    const errors = [];
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });

    try {
        const host = await newPage(ctx, 'host', errors);
        const client = await newPage(ctx, 'client', errors);

        await host.click('#btn-online');
        await host.fill('#lobby-name', 'Host');
        await host.click('#btn-lobby-host');
        await host.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room', null, { timeout: 15000 });
        const code = (await host.textContent('#lobby-code')).trim();

        await client.click('#btn-online');
        await client.fill('#lobby-name', 'Client');
        await client.fill('#lobby-code-input', code);
        await client.dispatchEvent('#lobby-code-input', 'input');
        await client.click('#btn-lobby-join');
        await client.waitForFunction(() => document.getElementById('lobby').dataset.phase === 'room', null, { timeout: 15000 });

        await host.click('[data-lobby-char="slime"]');   await host.waitForTimeout(150);
        await host.click('#btn-lobby-ready');            await host.waitForTimeout(150);
        await client.click('[data-lobby-char="ghost"]'); await client.waitForTimeout(150);
        await client.click('#btn-lobby-ready');          await client.waitForTimeout(300);

        await host.waitForFunction(() => !document.getElementById('btn-lobby-start').disabled, null, { timeout: 15000 });
        await host.click('#btn-lobby-start');
        await host.waitForSelector('#map-select', { state: 'visible', timeout: 10000 });
        await host.click('[data-map-id="city_circuit"]');
        await host.click('[data-city-rounds="6"]');
        await host.click('#btn-map-confirm');

        const pages = [host, client];
        const deadline = Date.now() + 240000;
        while (Date.now() < deadline) {
            await Promise.all(pages.map(p => p.evaluate(() => {
                const ov = document.getElementById('city-briefing');
                const go = document.getElementById('btn-cb-start');
                if (go && ov && getComputedStyle(ov).display !== 'none') go.click();
            }).catch(() => {})));
            const gs = await Promise.all(pages.map(p => p.evaluate(async () =>
                (await import('/src/core/GameState.js')).state.gameState)));
            if (gs.every(g => g !== 'INIT')) break;
            await host.waitForTimeout(1000);
        }
        await host.waitForFunction(async () =>
            (await import('/src/core/GameState.js')).state.gameState === 'PRE_ROLL',
            null, { timeout: 120000 });

        // Whose turn is it? Roll from whichever page owns it, so this measures a
        // real networked turn rather than a host-only one.
        const active = await host.evaluate(async () =>
            (await import('/src/core/GameState.js')).state.activePlayer);
        const driver = pages[active];
        notes.push(`turn belongs to seat ${active} (${active === 0 ? 'host' : 'client'})`);

        const before = { host: await host.evaluate(probe), client: await client.evaluate(probe) };

        await driver.evaluate(async () => {
            const C = await import('/src/core/Commands.js');
            C.run('roll', 1.4);
        });

        // Sample both pages through the whole beat: dice, callout, walk, landing.
        const trace = { host: [], client: [] };
        const t0 = Date.now();
        while (Date.now() - t0 < 14000) {
            trace.host.push(await host.evaluate(probe));
            trace.client.push(await client.evaluate(probe));
            await host.waitForTimeout(100);
        }

        const seat = active;
        const hostSteps = distinct(trace.host, seat);
        const cliSteps  = distinct(trace.client, seat);
        const hostDice  = peak(trace.host, 'dice');
        const cliDice   = peak(trace.client, 'dice');
        const hostAnims = peak(trace.host, 'anims');
        const cliAnims  = peak(trace.client, 'anims');
        const hostCallout = trace.host.some(s => s && s.rollCallout);
        const cliCallout  = trace.client.some(s => s && s.rollCallout);
        const cliBanner   = trace.client.some(s => s && s.turnBanner);
        const cliCam    = new Set(trace.client.filter(Boolean).map(s => (s.cam || []).join(','))).size;
        const cliCamState = [...new Set(trace.client.filter(Boolean).map(s => s.cameraState))].join('/');
        const cliLast   = lastOf(trace.client);
        const movedNode = cliLast.node[seat] !== before.client.node[seat];

        notes.push(`host : ${hostSteps} distinct token positions, ${hostDice} dice, ${hostAnims} anims peak, callout ${hostCallout}`);
        notes.push(`client: ${cliSteps} distinct token positions, ${cliDice} dice, ${cliAnims} anims peak, callout ${cliCallout}`);
        notes.push(`client camera: ${cliCam} distinct positions, state ${cliCamState}`);
        notes.push(`client token node ${before.client.node[seat]} -> ${cliLast.node[seat]}`);
        notes.push(`client turn banner seen: ${cliBanner}`);

        // The three groups.
        ok('client learns the move happened at all', movedNode,
            'the snapshot never changed its position');
        ok('client ANIMATES the token rather than teleporting it', cliSteps >= 6,
            `${cliSteps} distinct positions (host drew ${hostSteps}); 2 means it jumped`);
        ok('client camera follows the action', cliCam >= 5,
            `${cliCam} distinct camera positions, state ${cliCamState}`);
        ok('client shows the dice', cliDice > 0, `host spawned ${hostDice}, client ${cliDice}`);
        ok('client shows the roll callout', cliCallout, `host ${hostCallout}, client ${cliCallout}`);

        ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
        await client.screenshot({ path: path.join(__dirname, 'shot-netfx-client.png') });
        await host.screenshot({ path: path.join(__dirname, 'shot-netfx-host.png') });
        fs.writeFileSync(path.join(__dirname, 'result-netfx.json'), JSON.stringify(trace, null, 1));
    } catch (e) {
        fail.push('HARNESS: ' + (e && e.message));
    }

    await browser.close();
    console.log('\n=== WHAT THE CLIENT SEES ===');
    notes.forEach(n => console.log('  ·     ' + n));
    pass.forEach(p => console.log('  PASS  ' + p));
    fail.forEach(f => console.log('  FAIL  ' + f));
    console.log(`\n${pass.length} passed, ${fail.length} failed`);
    process.exit(fail.length ? 1 : 0);
})();
