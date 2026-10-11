// ============================================================
// FOUR ON A STAGE — the 3D face-off games converted to 3-4 seats.
//
// qa/livegames.js already proves a live game runs at 3 and 4 and resolves to a
// real seat. What it cannot see is whether each PERSON is playing their own
// figure: its agent taps all over the surface, and a game that sent every
// touch to seat 0 would still resolve. This probe seats four humans, drags in
// each corner zone in turn, and checks that the figure that reacts is the one
// in that seat, and only that one. It also checks every seat has its own strip
// and takes a screenshot of the table at four.
//
// Each game says what "reacted" means for it (ADAPT below).
//
// usage: node qa/fourstage.js [game ...]    (default: every adapted game)
//        QA_SEATS=3 to seat three instead.
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];
const SEATS = +(process.env.QA_SEATS || 4);

const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

// module: the game's file. ready(st): the moment a drag means something.
// reacted(before, after, slot): did that slot's figure respond to the drag?
const ADAPT = {
    musicalchairs: {
        module: 'MusicalChairs.js',
        // While the band plays, running is a false start: that walker freezes.
        ready: st => st.phase === 'play' && st.sub === 'walk',
        reacted: (a, b, slot) => b.walkers[slot].frozen > 0,
        // The band plays on through the four drags (a stop mid-way would turn
        // a false start into a legal run), then stops so the round can end.
        prep: () => window.__G._debugHoldMusic(),
        extra: async page => { await page.evaluate(() => window.__G._debugStop()); },
    },
    bumpercars: {
        module: 'BumperCars.js',
        ready: st => st.phase === 'play',
        reacted: (a, b, slot) => b.cars[slot].v > a.cars[slot].v + 0.3,
        // Every car parked and still before each drag, so a car zapped by the
        // last one is not mid-stun for this one.
        prep: () => [[-2, 4], [2, 4], [-2, -4], [2, -4]].forEach(([x, z], i) => window.__G._debugPlace(i, x, z)),
        // The blame rule: a car shoved into the rail scores for the shover; a
        // car that drives in on its own scores for nobody.
        extra: async (page, tag) => {
            const r = await page.evaluate(async () => {
                const G = window.__G, wait = ms => new Promise(f => setTimeout(f, ms));
                const s0 = G._debugState().score.slice();
                // Open floor at z = 3: the rubber posts sit on z = 0.
                G._debugPlace(0, 2.4, 3); G._debugPlace(2, 0.4, 3, 9, 0);
                for (let k = 0; k < 40 && G._debugState().score[2] === s0[2]; k++) await wait(50);
                const s1 = G._debugState().score.slice();
                G._debugPlace(3, 1, -4, 0, 0); G._debugPlace(3, 2.5, -4, 9, 0);
                await wait(900);
                const s2 = G._debugState().score.slice();
                return { s0, s1, s2 };
            });
            ok(`${tag}: a shove into the rail scores for the shover`, r.s1[2] === r.s0[2] + 1, JSON.stringify(r));
            ok(`${tag}: driving in on your own scores for nobody`, r.s2.reduce((a, b) => a + b, 0) === r.s1.reduce((a, b) => a + b, 0), JSON.stringify(r));
        },
    },
    tag: {
        module: 'TagYoureIt.js',
        ready: st => st.phase === 'play',
        reacted: (a, b, slot) => Math.hypot(b.figs[slot].x - a.figs[slot].x, b.figs[slot].z - a.figs[slot].z) > 0.25,
        // Everybody spread out on open ground and nobody frozen, before each drag.
        prep: () => { const G = window.__G; G._debugIt(0); [[-3, 6.5], [3, 6.5], [-3, -6.5], [3, -6.5]].forEach(([x, z], i) => G._debugPlace(i, x, z)); },
        // IT can tag any of the others, not just one rival.
        extra: async (page, tag) => {
            const r = await page.evaluate(async () => {
                const G = window.__G, wait = ms => new Promise(f => setTimeout(f, ms));
                const last = G._debugState().n - 1;
                G._debugIt(last);
                [[-3, 6.5], [3, 6.5], [-3, -6.5], [3, -6.5]].forEach(([x, z], i) => G._debugPlace(i, x, z));
                G._debugPlace(last, 3, -6.5);
                G._debugPlace(1, 3, -5.9);                    // right beside IT (the last seat)
                for (let k = 0; k < 30 && G._debugState().it === last; k++) await wait(50);
                return G._debugState().it;
            });
            ok(`${tag}: IT tags whichever runner it reaches`, r === 1, `it = ${r}`);
        },
    },
    turfwar: {
        module: 'TurfWar.js',
        ready: st => st.phase === 'play',
        reacted: (a, b, slot) => Math.hypot(b.pos[slot][0] - a.pos[slot][0], b.pos[slot][1] - a.pos[slot][1]) > 0.25,
        prep: () => [[-2.5, 7.5], [2.5, 7.5], [-2.5, -7.5], [2.5, -7.5]].forEach(([x, z], i) => window.__G._debugPlace(i, x, z)),
        // Anybody else's paint counts as theirs: a seat standing on a third
        // seat's colour is on wet paint, and rolling over it takes it.
        extra: async (page, tag) => {
            const r = await page.evaluate(async () => {
                const G = window.__G, wait = ms => new Promise(f => setTimeout(f, ms));
                G._debugPaint(3, -1, -1, 1, 1);
                G._debugPlace(1, 0, 0);
                await wait(1200);
                return G._debugState();
            });
            ok(`${tag}: a seat parked on a third colour paints over it`, r.under[1] === 1, `under = ${JSON.stringify(r.under)}`);
            ok(`${tag}: the yard is counted for all four colours`, r.count.length === 4, JSON.stringify(r.count));
        },
    },
    lilypad: {
        module: 'LilyPad.js',
        ready: st => st.phase === 'play',
        // A drag aims: that seat's aim ring lights on a pad.
        reacted: (a, b, slot) => b.aim[slot] >= 0,
        // Everybody dry on their home pad, every pad healthy, before each drag.
        prep: () => { const G = window.__G; G._debugRefill(); (G._debugState().n === 3 ? [37, 1, 3] : [37, 39, 1, 3]).forEach((p, i) => G._debugPad(i, p)); },
        // Landing on a pad two others share stomps both of them off it.
        extra: async (page, tag) => {
            const r = await page.evaluate(async () => {
                const G = window.__G, wait = ms => new Promise(f => setTimeout(f, ms));
                G._debugRefill();
                G._debugPad(1, 22); G._debugPad(2, 22); G._debugPad(0, 21); if (G._debugState().n > 3) G._debugPad(3, 3);
                const before = G._debugState().pad;
                G._debugHop(0, 22);
                // Wait for the stomper to land (a busy box drops frames), then
                // look: a knocked figure is in the air, on another pad, or in.
                for (let k = 0; k < 60 && (G._debugState().pad[0] !== 22 || G._debugState().hopping[0]); k++) await wait(50);
                const st = G._debugState();
                return { before, after: st.pad, out: st.out, hopping: st.hopping };
            });
            const off = [1, 2].every(s => r.after[s] !== 22 || r.out[s] || r.hopping[s]);
            ok(`${tag}: one landing stomps everybody on the pad`, r.before[1] === 22 && r.before[2] === 22 && off && r.after[0] === 22, JSON.stringify(r));
        },
    },
    redlight: {
        module: 'RedLightGreenLight.js',
        ready: st => st.phase === 'play',
        // Held on green for the drags: a hold runs, and nothing else should.
        prep: () => window.__G._debugLight('green', 99),
        reacted: (a, b, slot) => b.runners[slot].v > a.runners[slot].v + 0.1,
        // Two lanes at each end, one per seat, nobody sharing a lane.
        extra: async (page, tag) => {
            const r = await page.evaluate(async () => {
                const K = await import('/src/claw-core/engine/StageKit.js');
                const st = window.__G._debugState();
                return { runners: st.runners, edges: st.runners.map((_, i) => K.seatEdge(i)) };
            });
            const xs = r.runners.map(q => q.x), ends = r.runners.map(q => Math.sign(q.z));
            const atOwnEnd = ends.every((e, i) => (e > 0) === (r.edges[i] === 'bottom'));
            ok(`${tag}: a lane each, at each runner's own end`, new Set(xs.map((x, i) => `${x},${ends[i]}`)).size === SEATS && atOwnEnd, JSON.stringify({ xs, ends }));
        },
    },
};

async function run(type) {
    const A = ADAPT[type];
    const tag = `${type}@${SEATS}P`;
    const browser = await chromium.launch({ args: GL });
    try {
        const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
        await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!document.getElementById('minigame-layer'), null, { timeout: 20000 });
        await page.evaluate(async ([type, mod, n, readySrc]) => {
            const G = await import('/src/core/GameState.js');
            G.setPlayerCount(n);
            G.state.players.forEach(p => { p.isBot = false; });
            const sp = document.getElementById('splash'); if (sp) sp.style.display = 'none';
            window.__M = await import('/src/claw-core/minigames/MinigameManager.js');
            window.__G = await import('/src/claw-core/minigames/' + mod);
            window.__READY = eval(readySrc);
            window.__RES = 'pending';
            window.__M.triggerStandalone(type, false, n, {
                bots: new Array(n).fill(false), onComplete: w => { window.__RES = w; },
            });
        }, [type, A.module, SEATS, A.ready.toString()]);

        // Rules card → hold card → ready gate, every seat pressed.
        const press = id => page.evaluate(i => {
            const b = document.getElementById(i);
            if (b && b.offsetParent) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            return !!(b && b.offsetParent);
        }, id);
        for (const id of ['btn-mg-intro-next', 'btn-mg-launch']) {
            await page.waitForFunction(i => { const b = document.getElementById(i); return b && b.offsetParent; }, id, { timeout: 20000 }).catch(() => {});
            await page.waitForTimeout(400);
            await press(id);
        }
        await page.waitForTimeout(600);
        await page.evaluate(n => { for (let s = 0; s < n; s++) window.__M.setReady(s); }, SEATS);
        await page.waitForFunction(() => {
            try { return window.__G._debugState().phase === 'play'; } catch (e) { return false; }
        }, null, { timeout: 30000 });

        const slots = await page.evaluate(() => window.__M.slotCount());
        ok(`${tag}: the game was handed ${SEATS} slots`, slots === SEATS, `slotCount() = ${slots}`);

        // Where each seat's zone is, from the same layout the game uses.
        const zones = await page.evaluate(async n => {
            const L = await import('/src/claw-core/config/MinigameLayout.js');
            const ov = [...document.getElementById('minigame-layer').children].find(el => !el.id && el.getBoundingClientRect().width > 0);
            const r = ov.getBoundingClientRect();
            return L.zonesFor(n, r.width, r.height).map(z => ({ x: r.left + z.rect.x + z.rect.w / 2, y: r.top + z.rect.y + z.rect.h / 2 }));
        }, SEATS);

        // One strip per seat, each in its own seat's colour.
        const strips = await page.evaluate(() => [...document.querySelectorAll('#minigame-layer div')]
            .filter(d => /border: 2px solid/.test(d.getAttribute('style') || '') && d.getBoundingClientRect().width > 0 &&
                         getComputedStyle(d).whiteSpace === 'nowrap').length);
        ok(`${tag}: a strip for every seat`, strips >= SEATS, `${strips} strips`);
        await page.screenshot({ path: path.join(__dirname, `shot-4p-${type}.png`) });

        // Drag in each zone in turn; only that seat's figure should respond.
        for (let slot = 0; slot < SEATS; slot++) {
            await page.waitForFunction(() => {
                try { return window.__READY(window.__G._debugState()); } catch (e) { return false; }
            }, null, { timeout: 20000 }).catch(() => {});
            if (A.prep) await page.evaluate(src => eval(src)(), A.prep.toString());
            const before = await page.evaluate(() => window.__G._debugState());
            const z = zones[slot];
            await page.mouse.move(z.x, z.y);
            await page.mouse.down();
            // Toward the middle of the screen: a direction that means something
            // from every seat (a corner pad has nothing further out to aim at).
            const vw = 412, vh = 892, dx = vw / 2 - z.x, dy = vh / 2 - z.y, dl = Math.hypot(dx, dy) || 1;
            await page.mouse.move(z.x + dx / dl * 60, z.y + dy / dl * 60, { steps: 4 });
            await page.waitForTimeout(250);
            const after = await page.evaluate(() => window.__G._debugState());
            await page.mouse.up();
            const others = [...Array(SEATS).keys()].filter(s => s !== slot && !A.reacted(before, before, s) && A.reacted(before, after, s));
            ok(`${tag}: a drag in seat ${slot + 1}'s zone moves seat ${slot + 1}`, A.reacted(before, after, slot));
            ok(`${tag}: ...and nobody else`, others.length === 0, others.length ? `also seat ${others.map(s => s + 1).join(',')}` : '');
        }

        if (A.extra) await A.extra(page, tag);

        // Let it run out on its own (idle humans), so the round still resolves.
        const deadline = Date.now() + 120000;
        let res = 'pending';
        while (Date.now() < deadline) {
            res = await page.evaluate(() => {
                document.querySelectorAll('.mg-sc-btn').forEach(b => b.offsetParent && b.click());
                return window.__RES;
            });
            if (res !== 'pending') break;
            await page.waitForTimeout(300);
        }
        ok(`${tag}: resolves with four idle humans`, res !== 'pending', `winner = ${res}`);
        ok(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    } finally {
        await browser.close().catch(() => {});
    }
}

(async () => {
    const want = process.argv.slice(2).filter(t => ADAPT[t]);
    for (const t of (want.length ? want : Object.keys(ADAPT))) {
        try { await run(t); } catch (e) { ok(`${t}: ran to the end`, false, e.message.split('\n')[0]); }
    }
    pass.forEach(p => console.log('  ✓ ' + p));
    fail.forEach(f => console.log('  ✗ ' + f));
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
