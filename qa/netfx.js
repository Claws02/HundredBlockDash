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
    // The roll callout is up for ~1.5 s and each sample costs two cross-page
    // round trips, so polling for it catches it perhaps three times in four —
    // it has now failed once on the client and once on the HOST, which is what
    // finally showed the flap was in the measurement. Record it at the source
    // instead: an observer on the class that shows it cannot miss it.
    await page.evaluate(() => {
        window.__calloutSeen = false;
        const el = document.getElementById('roll-callout');
        if (!el) return;
        const note = () => { if (el.classList.contains('up')) window.__calloutSeen = true; };
        note();
        new MutationObserver(note).observe(el, { attributes: true, attributeFilter: ['class'] });
    });
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

        // ---- the briefing is a READY GATE ------------------------------------
        // One press no longer moves one device on: every seat votes and the
        // card lifts on all of them at once. Check the waiting state exists
        // before voting the second time, or the assertion proves nothing.
        await host.waitForFunction(() =>
            getComputedStyle(document.getElementById('city-briefing')).display !== 'none',
            null, { timeout: 240000 }).catch(() => {});
        await client.waitForFunction(() =>
            getComputedStyle(document.getElementById('city-briefing')).display !== 'none',
            null, { timeout: 240000 }).catch(() => {});

        await host.click('#btn-cb-start');
        await host.waitForTimeout(900);
        const gateMid = {
            host: await host.evaluate(() => {
                const b = document.getElementById('btn-cb-start');
                const ov = document.getElementById('city-briefing');
                return { txt: b ? b.textContent.trim() : null, disabled: b ? b.disabled : null,
                         up: !!ov && getComputedStyle(ov).display !== 'none' };
            }),
            client: await client.evaluate(() => {
                const ov = document.getElementById('city-briefing');
                return { up: !!ov && getComputedStyle(ov).display !== 'none' };
            }),
        };
        // Both halves matter, and the first is worthless alone: "still up after
        // one press" is equally true of a gate that works and of a press that
        // was refused and did nothing. It is only meaningful next to the
        // assertion below that the press REGISTERED.
        ok('one press does not start the match',
            gateMid.host.up === true && gateMid.client.up === true,
            `host card up ${gateMid.host.up}, client card up ${gateMid.client.up}`);
        ok('the presser is told the table is still gathering',
            gateMid.host.disabled === true && /READY/i.test(gateMid.host.txt || ''),
            `button: ${JSON.stringify(gateMid.host.txt)} disabled=${gateMid.host.disabled}`);

        // The other player's button must still be LIVE — they are the one the
        // table is waiting for. Asserted rather than assumed, because the first
        // version of the shared count disabled it here and the harness could
        // not cast the second vote at all.
        const clientBtn = await client.evaluate(() => {
            const b = document.getElementById('btn-cb-start');
            return b ? { txt: b.textContent.trim(), disabled: b.disabled } : null;
        });
        ok('the player still to vote keeps a live button',
            !!clientBtn && clientBtn.disabled === false,
            `button: ${JSON.stringify(clientBtn)}`);
        ok('and is told how many are already in',
            /\d\s*\/\s*\d/.test((clientBtn && clientBtn.txt) || ''),
            `button: ${JSON.stringify(clientBtn && clientBtn.txt)}`);

        await client.click('#btn-cb-start');
        await host.waitForTimeout(1200);
        const gateEnd = await Promise.all(pages.map(p => p.evaluate(() => {
            const ov = document.getElementById('city-briefing');
            return !!ov && getComputedStyle(ov).display !== 'none';
        })));
        ok('the last press lifts the card on every device',
            gateEnd.every(up => up === false), `still up: ${JSON.stringify(gateEnd)}`);

        const deadline = Date.now() + 240000;
        while (Date.now() < deadline) {
            await Promise.all(pages.map(p => p.evaluate(() => {
                const ov = document.getElementById('city-briefing');
                const go = document.getElementById('btn-cb-start');
                if (go && ov && getComputedStyle(ov).display !== 'none' && !go.disabled) go.click();
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
        const hostCallout = await host.evaluate(() => !!window.__calloutSeen);
        const cliCallout  = await client.evaluate(() => !!window.__calloutSeen);
        const cliBanner   = trace.client.some(s => s && s.turnBanner);
        const cliCam    = new Set(trace.client.filter(Boolean).map(s => (s.cam || []).join(','))).size;
        const hostCam   = new Set(trace.host.filter(Boolean).map(s => (s.cam || []).join(','))).size;
        const cliCamState = [...new Set(trace.client.filter(Boolean).map(s => s.cameraState))].join('/');
        const cliLast   = lastOf(trace.client);
        const movedNode = cliLast.node[seat] !== before.client.node[seat];

        notes.push(`host : ${hostSteps} distinct token positions, ${hostDice} dice, ${hostAnims} anims peak, callout ${hostCallout}`);
        notes.push(`client: ${cliSteps} distinct token positions, ${cliDice} dice, ${cliAnims} anims peak, callout ${cliCallout}`);
        notes.push(`client camera: ${cliCam} distinct positions (host ${hostCam}), state ${cliCamState}`);
        notes.push(`client token node ${before.client.node[seat]} -> ${cliLast.node[seat]}`);
        notes.push(`client turn banner seen: ${cliBanner}`);

        // The three groups.
        //
        // Motion is judged AGAINST THE HOST, not against a number I picked.
        // The first version of this asserted `>= 6 distinct positions` and
        // failed the client at 3 — while the host, animating perfectly and
        // visibly, also drew 3. Each sample costs two cross-page round trips,
        // so the real interval is nearer 400 ms than the requested 100, and a
        // ~0.7 s walk simply cannot produce six samples. The threshold was
        // wrong, not the client. What matters is that the client draws as much
        // motion as the host does.
        ok('client learns the move happened at all', movedNode,
            movedNode ? '' : 'the snapshot never changed its position');
        ok('client animates the token as much as the host does',
            hostSteps <= 1 || cliSteps >= Math.max(2, Math.floor(hostSteps * 0.7)),
            `client ${cliSteps} distinct positions vs host ${hostSteps}`);
        ok('client camera tracks as much as the host does',
            hostCam <= 1 || cliCam >= Math.max(2, Math.floor(hostCam * 0.7)),
            `client ${cliCam} vs host ${hostCam} camera positions, state ${cliCamState}`);
        ok('client shows the roll callout', cliCallout, `host ${hostCallout}, client ${cliCallout}`);
        // Physical dice are deliberately NOT mirrored: cannon.js is not
        // deterministic across devices, so a client cannot reproduce the throw
        // and faking one would be a lie about a number that has already been
        // decided. The client gets the callout — the number at size — and a
        // waiting line while the host's dice settle.
        // The client throws its OWN dice while the host is rolling — not the
        // host's throw (cannon.js is not deterministic and a client cannot
        // reproduce it), just the seven seconds of not knowing. Nothing is ever
        // read off them: they are cleared the moment the real number arrives,
        // and a die is only readable at rest.
        ok('the client sees dice while the host is rolling', cliDice > 0,
            `client spawned ${cliDice}, host ${hostDice}`);
        const diceGone = (lastOf(trace.client).dice ?? 0) === 0;
        ok('the client\'s dice are gone once the number lands', diceGone,
            `${lastOf(trace.client).dice} still in the scene`);

        // ---- the hand-over announcement -------------------------------------
        // Sampled above only by luck: the banner fires at the START of a turn,
        // which is before this probe's window opens. So raise one deliberately
        // and check it lands on the other device — it is a SHARED scene and
        // was host-only until this session, which is exactly the kind of thing
        // that goes unnoticed because the host always looks correct.
        await host.evaluate(async () => {
            const UI = await import('/src/ui/UIManager.js');
            UI.showTurnBanner(1, { sub: 'mirror check' });
        });
        await host.waitForTimeout(1200);
        const banner = [];
        for (const [who, pg] of [['host', host], ['client', client]]) {
            banner.push([who, await pg.evaluate(() => {
                const el = document.getElementById('turn-banner');
                if (!el || getComputedStyle(el).display === 'none') return null;
                const card = el.querySelector('.tb-card.tb-active') || el.querySelector('.tb-card');
                return card ? (card.textContent || '').replace(/\s+/g, ' ').trim() : null;
            })]);
        }
        notes.push(`turn banner: ${banner.map(([w, v]) => `${w}=${JSON.stringify(v)}`).join(' ')}`);
        ok('the turn announcement reaches the other device',
            !!banner[1][1], `host ${JSON.stringify(banner[0][1])}, client ${JSON.stringify(banner[1][1])}`);
        // The client is seat 1, so the banner it was just shown is about IT.
        ok('the announcement says YOU on the device it is about',
            /YOU/i.test(banner[1][1] || ''), banner[1][1] || '(nothing)');

        // ---- a set piece must not strand the client's camera ---------------
        // The reported failure: a buddy arrived, and the joined player's camera
        // stayed looking at it for the rest of the match. Every camera-taking
        // set piece hands the camera back through a continuation that belongs
        // to the host, and a client replaying one had no such continuation.
        await host.evaluate(async () => {
            const Fx = await import('/src/engine/Fx.js');
            const S = (await import('/src/core/GameState.js')).state;
            Fx.play('allyArrival', { node: S.players[0].pos }, () => {});
        });
        await host.waitForTimeout(600);
        const camDuring = await client.evaluate(async () =>
            (await import('/src/core/GameState.js')).state.cameraState);
        // Long enough for the set piece to finish AND for a snapshot to have
        // re-asserted the host's camera mode if the continuation failed.
        await host.waitForTimeout(4000);
        const camAfter = await client.evaluate(async () =>
            (await import('/src/core/GameState.js')).state.cameraState);
        notes.push(`client camera through a set piece: ${camDuring} -> ${camAfter}`);
        ok('the client plays the set piece', camDuring === 'CINEMATIC',
            `camera was ${camDuring} while it ran`);
        ok('the client gets its camera back afterwards', camAfter === 'FOLLOW',
            `camera left on ${camAfter}`);

        // ---- the buddy report must be dismissable from the joined device ----
        // Reported: the host could press GOT IT, the client could not, and the
        // client's card then sat there forever. Two separate things had to be
        // true and neither was: the press has to REACH the host, and the host
        // moving on has to take the client's card down with it.
        await host.evaluate(async () => {
            const UI = await import('/src/ui/UIManager.js');
            UI.showBuddyReport({ onMap: null, held: [], round: 1 }, false, () => {});
        });
        await host.waitForTimeout(1400);
        const cardUp = await Promise.all(pages.map(p => p.evaluate(() => {
            const el = document.getElementById('ally-arrival');
            return !!el && getComputedStyle(el).display !== 'none';
        })));
        ok('the buddy report reaches the joined device', cardUp[1] === true,
            `host ${cardUp[0]}, client ${cardUp[1]}`);

        // Press it from the CLIENT — the case that was stuck.
        await client.evaluate(async () => {
            const C = await import('/src/core/Commands.js');
            C.run('buddyReportAck');
        });
        await host.waitForTimeout(2000);
        const cardAfter = await Promise.all(pages.map(p => p.evaluate(() => {
            const el = document.getElementById('ally-arrival');
            return !!el && getComputedStyle(el).display !== 'none';
        })));
        ok('the joined player can dismiss it, and it clears everywhere',
            cardAfter.every(up => up === false), `still up: ${JSON.stringify(cardAfter)}`);

        // ---- swipe-to-roll has to be armed on the joined device -------------
        // `showSwipeZone()` lives inside the turn engine, which a client never
        // enters, so the zone was never armed and the swipe did nothing.
        // Wait for the moment the swipe is ACTUALLY due, on the device that
        // owns it. Waiting for the host to reach PRE_ROLL and then sleeping
        // measured the client mid-shop — where an unarmed swipe is correct —
        // and read that as the feature being broken.
        let turnOwner = 0, swipeWindow = null;
        const swipeDeadline = Date.now() + 180000;
        while (Date.now() < swipeDeadline) {
            turnOwner = await host.evaluate(async () =>
                (await import('/src/core/GameState.js')).state.activePlayer);
            swipeWindow = await pages[turnOwner].evaluate(async () => {
                const S = (await import('/src/core/GameState.js')).state;
                return {
                    ready: S.gameState === 'PRE_ROLL'
                        && S.localSeat === S.activePlayer
                        && !document.body.classList.contains('modal-open'),
                    gs: S.gameState,
                };
            });
            if (swipeWindow.ready) break;
            // DRIVE it, do not just watch it. By this point the probe has run a
            // roll, a banner check, a set piece and a buddy report, and the
            // game is parked on a result card waiting for a press nobody is
            // making — so PRE_ROLL never arrives and the loop times out on a
            // board that was never going to move. The agent presses through
            // exactly the cards a player would.
            await Promise.all(pages.map(pg =>
                pg.evaluate(() => window.__QA.step()).catch(() => {})));
            await host.waitForTimeout(400);
        }
        notes.push(`swipe checked at gs=${swipeWindow && swipeWindow.gs} on seat ${turnOwner}`);

        const swipe = await pages[turnOwner].evaluate(async () => {
            const S = (await import('/src/core/GameState.js')).state;
            const z = document.getElementById('swipe-zone');
            const p = S.players[S.activePlayer];
            // Report the CONDITIONS, not just the outcome. "armed=false" alone
            // says nothing about which of the four reasons it is.
            return {
                armed: !!z && z.classList.contains('act'),
                visible: !!z && getComputedStyle(z).display !== 'none',
                why: {
                    online:   S.playStyle === 'online',
                    mySeat:   S.localSeat === S.activePlayer,
                    localSeat: S.localSeat, active: S.activePlayer,
                    gs:       S.gameState,
                    notBot:   !!p && !p.isBot,
                    modalUp:  document.body.classList.contains('modal-open'),
                },
            };
        });
        notes.push(`swipe zone on seat ${turnOwner} (${turnOwner ? 'client' : 'host'}): armed=${swipe.armed} why=${JSON.stringify(swipe.why)}`);
        ok('the seat whose turn it is can swipe to roll', swipe.armed === true,
            `seat ${turnOwner}: ${JSON.stringify(swipe)}`);
        // And nobody else's is armed — a live swipe on the wrong phone is a
        // control that looks usable and is refused.
        const otherSeat = turnOwner === 0 ? 1 : 0;
        const otherSwipe = await pages[otherSeat].evaluate(() =>
            !!document.getElementById('swipe-zone')?.classList.contains('act'));
        ok('and the player waiting has no live swipe', otherSwipe === false,
            `seat ${otherSeat} armed=${otherSwipe}`);

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
