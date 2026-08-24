// ============================================================
// The 2026-08 presentation pass.
//
//   1. TURN BANNER — every hand-over says whose turn it is, in both modes; it
//      does NOT re-announce the same player on a BOOST re-roll; and it never
//      covers the roll button (a banner that eats a tap is worse than none).
//   2. CITY END CHART — City plots COINS at each round boundary, not board
//      position. Position on a lap map says nothing about who is winning.
//   3. WIN CARDS — the stat block fits, scrolls, and never displaces the
//      REMATCH button off the edge of the rotated screen.
//   4. ALLY MODELS — the ally waiting on the board is its own character mesh,
//      and spawning/despawning it repeatedly leaks nothing.
//   5. CHARACTER PICKER — every card carries a rendered 3D portrait, and the
//      WebGL contexts used to make them are released.
//
// usage: node polish.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];

const boot = async (page) => {
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());
};
const toPreRoll = async (page, budget = 400) => {
    for (let i = 0; i < budget; i++) {
        const gs = await page.evaluate(() => window.__QA.snapshot().gameState);
        if (gs === 'PRE_ROLL') return true;
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(140);
    }
    return false;
};

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL,
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text());
    });

    await boot(page);

    // ---------------------------------------------------------------
    // 5. Character picker portraits — before anything else, because char
    //    select is the first screen and the renderer does not exist yet.
    // ---------------------------------------------------------------
    await page.evaluate(async () => {
        const GC = await import('/src/core/GameController.js');
        const { state } = await import('/src/core/GameState.js');
        state.playStyle = 'pass';
        GC.goToCharSelect();
    });
    await page.waitForTimeout(900);
    const picker = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('#char-select [data-char]')];
        return {
            n: cards.length,
            withShot: cards.filter(c => {
                const im = c.querySelector('.char-shot');
                return im && /^data:image\/png/.test(im.src) && im.src.length > 2000;
            }).length,
            // Distinct images: nine cards all showing the same render would pass
            // a "has a portrait" check and be useless.
            distinct: new Set(cards.map(c => (c.querySelector('.char-shot') || {}).src || '').filter(Boolean)).size,
            emojiHidden: cards.filter(c => c.classList.contains('has-shot')).length,
        };
    });
    await page.screenshot({ path: path.join(__dirname, 'shot-charselect.png') });
    ok('picker: every character card carries a 3D portrait',
        picker.n === 9 && picker.withShot === 9, JSON.stringify(picker));
    ok('picker: the nine portraits are nine different renders',
        picker.distinct === 9, `${picker.distinct} distinct of ${picker.n}`);
    ok('picker: the emoji fallback steps aside when a render lands',
        picker.emojiHidden === picker.withShot, JSON.stringify(picker));

    // The portraits must not hold a WebGL context open — browsers cap them
    // hard, and the board renderer has not even been created yet.
    const ctxAlive = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        // 20 more batches: if a context leaked per batch we would run out and
        // renderCharacterPortraits would start returning nothing.
        let lastCount = 0;
        for (let i = 0; i < 20; i++) {
            const out = R.renderCharacterPortraits(['slime', 'bunny'], 0xff0000, 64);
            lastCount = Object.keys(out).length;
        }
        return lastCount;
    });
    ok('picker: portrait rendering releases its WebGL context',
        ctxAlive === 2, `after 20 more batches the renderer returned ${ctxAlive}/2`);

    // ---------------------------------------------------------------
    // Start a tabletop City match for the rest.
    // ---------------------------------------------------------------
    await page.evaluate(() => { document.getElementById('char-select').style.display = 'none'; });
    await page.evaluate(() => window.__QA.startRun({ mode: 'tabletop', map: 'city_circuit' }));
    const running = await toPreRoll(page);
    ok('boot: City match at the roll', running);

    // ---------------------------------------------------------------
    // 1. Turn banner.
    // ---------------------------------------------------------------
    const banner = await page.evaluate(async () => {
        const U = await import('/src/ui/UIManager.js');
        const { state } = await import('/src/core/GameState.js');
        U.resetTurnAnnouncer();
        const first  = U.announceTurnIfChanged(0);
        const repeat = U.announceTurnIfChanged(0);   // same player — must be silent
        const swap   = U.announceTurnIfChanged(1);
        const el = document.getElementById('turn-banner');
        const cards = [...el.querySelectorAll('.tb-card')];
        return {
            first, repeat, swap,
            shown: getComputedStyle(el).display !== 'none',
            copies: cards.filter(c => getComputedStyle(c).display !== 'none').length,
            active: cards.filter(c => c.classList.contains('tb-active')).map(c => c.dataset.tb),
            names:  cards.map(c => (c.querySelector('.tb-name') || {}).textContent || ''),
            events: getComputedStyle(el).pointerEvents,
        };
    });
    ok('turn banner: announces the first turn', banner.first && banner.shown);
    ok('turn banner: does NOT re-announce the same player',
        banner.repeat === false, 'a BOOST re-roll must not say PLAYER 1 twice');
    ok('turn banner: announces when the turn changes hands', banner.swap === true);
    ok('turn banner: tabletop draws a copy on each edge',
        banner.copies === 2, `${banner.copies} copies`);
    ok('turn banner: only the player whose turn it is is marked active',
        banner.active.length === 1 && banner.active[0] === '1', JSON.stringify(banner.active));
    ok('turn banner: both copies name the same player',
        banner.names.length === 2 && banner.names[0] === banner.names[1], JSON.stringify(banner.names));
    ok('turn banner: never takes pointer events',
        banner.events === 'none', banner.events);
    await page.screenshot({ path: path.join(__dirname, 'shot-turnbanner.png') });

    // It must not sit on top of the roll button — a banner that eats the tap
    // it is announcing is worse than no banner at all.
    const overlap = await page.evaluate(() => {
        const roll = document.querySelector('#p2-actions [data-roll]') || document.querySelector('#p1-actions [data-roll]');
        if (!roll) return { none: true };
        const r = roll.getBoundingClientRect();
        const hits = [...document.querySelectorAll('#turn-banner .tb-card')]
            .filter(c => getComputedStyle(c).display !== 'none')
            .map(c => c.getBoundingClientRect())
            .filter(b => b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom);
        return { n: hits.length, roll: { x: Math.round(r.x), y: Math.round(r.y) } };
    });
    ok('turn banner: does not overlap the roll button',
        overlap.none || overlap.n === 0, JSON.stringify(overlap));

    await page.evaluate(async () => (await import('/src/ui/UIManager.js')).hideTurnBanner());

    // ---------------------------------------------------------------
    // 4. Ally board models.
    // ---------------------------------------------------------------
    const ally = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const R = await import('/src/engine/Renderer.js');
        const CG = (await import('/src/config/ActiveMap.js')).graph();
        const node = CG[state.players[0].pos].next[0];

        // Count from the SCENE, not by walking up from the camera: the camera is
        // not a child of the scene in this renderer, so that walk finds only the
        // camera and counts zero meshes. Every census in this harness did it the
        // old way and had been silently measuring nothing.
        const scene = R.getScene();
        const count = () => { let n = 0; scene.traverse(o => { if (o.isMesh) n++; }); return n; };

        // Start from a clean slate so the before/after are comparable.
        R.removeAllyMarker();
        const base   = count();
        const icons0 = R.getFloatingIconCount();

        R.placeAllyMarker(node, 'bodyguard');
        const withMarker = count();

        // Spawn and despawn repeatedly. Both the scene graph AND the render
        // loop's floating-icon list must come back to where they started —
        // removeAllyMarker used to delete its map entry before looking the mesh
        // up to unregister it, so every spawn leaked one animated row pointing
        // at a mesh that was no longer in the scene.
        for (let i = 0; i < 12; i++) { R.placeAllyMarker(node, 'cabbie'); R.removeAllyMarker(); }
        const after  = count();
        const icons1 = R.getFloatingIconCount();

        R.placeAllyMarker(node, 'bodyguard');
        return { base, withMarker, after, icons0, icons1, delta: withMarker - base };
    });
    ok('ally marker: is a real character model, not a single blob',
        ally.delta >= 5, `${ally.delta} meshes added (a lone octahedron would be 1)`);
    ok('ally marker: 12 spawn/despawn cycles leave the scene graph where it started',
        ally.after === ally.base, `${ally.base} → ${ally.after} meshes`);
    ok('ally marker: and leave the animation list where it started',
        ally.icons0 === -1 || ally.icons1 === ally.icons0,
        `floating icons ${ally.icons0} → ${ally.icons1}`);

    // Followers beside their owner.
    const followers = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const R = await import('/src/engine/Renderer.js');
        state.players[0].allies = [];
        ['banker', 'vendor'].forEach((t, i) => {
            const m = R.attachAllyMesh(state.players[0], i, t);
            state.players[0].allies.push({ type: t, turnsRemaining: 6, shieldCharges: 0, mesh: m });
        });
        R.updateAllyPositions(state.players[0]);
        const p = state.players[0].mesh.position;
        return state.players[0].allies.map(a => ({
            has: !!a.mesh,
            kids: a.mesh ? a.mesh.children.length : 0,
            d: a.mesh ? Math.hypot(a.mesh.position.x - p.x, a.mesh.position.z - p.z) : -1,
        }));
    });
    ok('ally followers: each carries its own character model',
        followers.length === 2 && followers.every(f => f.has && f.kids >= 3), JSON.stringify(followers));
    ok('ally followers: they stand beside their owner, not on top of them',
        followers.every(f => f.d > 0.5 && f.d < 6), JSON.stringify(followers.map(f => +f.d.toFixed(2))));

    await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        R.snapCameraToActive();
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(__dirname, 'shot-ally-board.png') });

    // ---------------------------------------------------------------
    // 2 + 3. The end-of-match screen.
    // ---------------------------------------------------------------
    const win = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const WS = await import('/src/core/WinScreen.js');
        // Six rounds of four turns, with the coin totals moving inside each.
        state.history = [];
        let c1 = 10, c2 = 10;
        for (let t = 1; t <= 24; t++) {
            c1 += Math.round(Math.random() * 9 - 2);
            c2 += Math.round(Math.random() * 9 - 2);
            state.history.push({ turn: t, round: Math.ceil(t / 4),
                prog: [t * 0.04, t * 0.035], coins: [Math.max(0, c1), Math.max(0, c2)] });
        }
        state.players[0].coins = c1; state.players[1].coins = c2;
        state.players[0].coinsEarned = c1 + 20; state.players[1].coinsEarned = c2 + 15;
        state.players[0].mgWins = 3; state.players[1].mgWins = 2;
        state.players[0].fullCircuitsCompleted = 2; state.players[1].fullCircuitsCompleted = 1;
        state.players[0].contractsClaimed = 4; state.players[1].contractsClaimed = 3;
        state.players[0].duelsWon = 2; state.players[1].duelsWon = 1;
        state.players[0].districtsVisited = { fin: 2, ba: 1, shop: 3, ind: 1 };
        state.players[1].districtsVisited = { fin: 1, ba: 2, shop: 1, ind: 2 };
        WS.calculateWinner();
        return true;
    });
    // The buttons enter on a 1.2s-delayed fadeSlideUp, so they are legitimately
    // mid-flight for the first ~1.7s and measuring before that reads the
    // animation's starting transform as an off-screen button. Wait for rest.
    await page.waitForTimeout(2600);

    const chart = await page.evaluate(() => {
        const title = (document.querySelector('.win-chart-title') || {}).textContent || '';
        const legend = (document.getElementById('win-chart-legend') || {}).textContent || '';
        const svg = document.querySelector('#win-chart svg');
        return {
            title, legend,
            // One dot per round per player: six rounds × two players = 12.
            dots: svg ? svg.querySelectorAll('circle').length : 0,
            lines: svg ? svg.querySelectorAll('polyline').length : 0,
            aria: svg ? svg.getAttribute('aria-label') : '',
        };
    });
    ok('city chart: plots coins, round by round',
        /COINS.*ROUND/i.test(chart.title), `"${chart.title}"`);
    ok('city chart: the axis counts rounds, not turns',
        /rounds:/i.test(chart.legend), chart.legend.trim().slice(0, 70));
    ok('city chart: one marked sample per round per player',
        chart.dots === 12, `${chart.dots} dots (expected 6 rounds × 2 players)`);
    ok('city chart: still draws a line for each player', chart.lines === 2);
    ok('city chart: says what it is showing',
        /coin/i.test(chart.aria), chart.aria);

    const cards = await page.evaluate(() => {
        const inner = document.getElementById('win-inner');
        const stats = [...document.querySelectorAll('.win-card-stats')];
        const btns = ['btn-rematch', 'btn-main-menu'].map(id => {
            const r = document.getElementById(id).getBoundingClientRect();
            return { id, on: r.x >= -1 && r.y >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
                     x: Math.round(r.x), y: Math.round(r.y) };
        });
        return {
            tiles: document.querySelectorAll('.ws-tile').length,
            chips: document.querySelectorAll('.ws-chip').length,
            scrollable: stats.every(s => getComputedStyle(s).overflowY === 'auto'),
            innerScrolls: getComputedStyle(inner).overflowY === 'auto',
            btns,
            // No stat block may run past the card that holds it.
            spill: [...document.querySelectorAll('.win-card')].filter(c => {
                const cr = c.getBoundingClientRect();
                const sr = c.querySelector('.win-card-stats').getBoundingClientRect();
                return sr.bottom > cr.bottom + 2 || sr.right > cr.right + 2;
            }).length,
        };
    });
    await page.screenshot({ path: path.join(__dirname, 'shot-winscreen.png') });
    ok('win cards: stats are a tile grid (6 per player)',
        cards.tiles === 12, `${cards.tiles} tiles`);
    ok('win cards: districts are one chip strip, not four full rows',
        cards.chips === 8, `${cards.chips} chips (4 per player)`);
    ok('win cards: the stat block scrolls inside its card',
        cards.scrollable, 'overflow-y must be auto');
    ok('win cards: nothing spills out of its card',
        cards.spill === 0, `${cards.spill} cards overflowing`);
    ok('win screen: BOTH buttons are on screen',
        cards.btns.every(b => b.on), JSON.stringify(cards.btns));
    ok('win screen: the panel can scroll if a future stat makes it taller',
        cards.innerScrolls);

    // ---------------------------------------------------------------
    // HBD must keep its position chart.
    // ---------------------------------------------------------------
    const hbdChart = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const WS = await import('/src/core/WinScreen.js');
        state.selectedMap = 'hundred_block_dash';
        state.hbd = { finish: 49 };
        state.players[0].pos = 40; state.players[1].pos = 49;
        WS.calculateWinner();
        const title = (document.querySelector('.win-chart-title') || {}).textContent || '';
        const svg = document.querySelector('#win-chart svg');
        return { title, aria: svg ? svg.getAttribute('aria-label') : '', crown: /CROWN/.test(svg ? svg.innerHTML : '') };
    });
    ok('HBD chart: still the race by position, with the finish line on it',
        /RACE/i.test(hbdChart.title) && hbdChart.crown, `"${hbdChart.title}" crown=${hbdChart.crown}`);

    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));

    await browser.close();
    console.log('\nPASS:'); pass.forEach(p => console.log('  ✓ ' + p));
    console.log('\nFAIL:'); fail.length ? fail.forEach(f => console.log('  ✗ ' + f)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
