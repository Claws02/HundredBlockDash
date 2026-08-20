// ============================================================
// CHARACTER SHEET — render all nine figures and look at them.
//
// The models are the only thing on screen for a whole match. This boots the
// game far enough to have a WebGL context, renders every character with the
// real portrait path, and writes one contact sheet plus a board screenshot so
// the figures can be judged at the size they are actually played at.
//
// It also asserts the things that are cheap to get wrong in geometry code and
// invisible in a screenshot: that every type builds something, that nothing
// sinks below the tile, and that the silhouettes are not all the same height.
//
// usage: node charshots.js
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

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text());
    });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    // --- The character picker itself, with the real portraits painted in ---
    await page.evaluate(() => {
        document.getElementById('splash').style.display = 'none';
        const cs = document.getElementById('char-select');
        cs.style.display = 'flex';
    });
    await page.evaluate(async () => {
        const GC = await import('/src/core/GameController.js');
        // goToCharSelect() refuses without a mode — without this the picker
        // silently keeps its emoji and the portrait assertion below reads the
        // static markup instead of anything the game rendered.
        GC.selectMode('pass');
        // Blank the markup names so the assertion can only pass if the painter
        // actually wrote them; the HTML ships the same strings.
        document.querySelectorAll('#char-select .char-name').forEach(n => { n.textContent = '—'; });
        GC.goToCharSelect();
    });
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(__dirname, 'shot-charsheet-picker.png') });

    const picker = await page.evaluate(async () => {
        const { CHAR_NAMES } = await import('/src/config/GameConfig.js');
        const cards = [...document.querySelectorAll('#char-select [data-char]')];
        return {
            cards: cards.length,
            withShot: cards.filter(c => c.querySelector('.char-shot')?.src?.startsWith('data:image')).length,
            names: cards.map(c => c.querySelector('.char-name')?.textContent),
            expected: cards.map(c => CHAR_NAMES[c.dataset.char]),
        };
    });
    ok('picker: every character card carries a rendered 3D portrait',
        picker.cards === 9 && picker.withShot === 9, `${picker.withShot}/${picker.cards}`);
    ok('picker: every card is named from CHAR_NAMES',
        JSON.stringify(picker.names) === JSON.stringify(picker.expected), picker.names.join(', '));

    // --- Measure each figure: does it build, does it stand on the ground? ---
    const geo = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const { ALL_CHAR_TYPES } = await import('/src/config/GameConfig.js');
        const out = {};
        ALL_CHAR_TYPES.forEach(t => {
            const g = R.createCharacterMesh(t, 0x3b82f6);
            let meshes = 0, tris = 0;
            g.traverse(o => {
                if (!o.isMesh) return;
                meshes++;
                const idx = o.geometry.index;
                tris += idx ? idx.count / 3 : o.geometry.attributes.position.count / 3;
            });
            const box = new THREE.Box3().setFromObject(g);
            out[t] = {
                meshes, tris: Math.round(tris),
                minY: +box.min.y.toFixed(3),
                height: +(box.max.y - box.min.y).toFixed(2),
                width: +(box.max.x - box.min.x).toFixed(2),
            };
        });
        return out;
    });
    const types = Object.keys(geo);
    ok('models: all nine build something',
        types.length === 9 && types.every(t => geo[t].meshes >= 6),
        types.map(t => `${t}:${geo[t].meshes}`).join(' '));
    // The contact shadow sits at y=0.03, so nothing should dip below zero.
    const sunk = types.filter(t => geo[t].minY < -0.02);
    ok('models: nobody sinks through the tile they stand on',
        sunk.length === 0, sunk.map(t => `${t} minY=${geo[t].minY}`).join(', ') || 'all above ground');
    const heights = types.map(t => geo[t].height);
    ok('models: they are a cast, not clones — heights vary but stay in one range',
        Math.max(...heights) <= 2.9 && Math.min(...heights) >= 1.2
        && new Set(heights.map(h => Math.round(h * 4))).size >= 5,
        types.map(t => `${t} ${geo[t].height}h`).join(' · '));
    const heavy = types.filter(t => geo[t].tris > 9000);
    ok('models: nothing is a triangle bomb — seven can be on screen at once',
        heavy.length === 0, heavy.map(t => `${t}:${geo[t].tris}`).join(', ')
            || `max ${Math.max(...types.map(t => geo[t].tris))} tris`);

    // --- Contact sheet: all nine, side by side, in one image ---
    const sheet = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const { ALL_CHAR_TYPES, CHAR_NAMES } = await import('/src/config/GameConfig.js');
        const shots = R.renderCharacterPortraits(ALL_CHAR_TYPES, 0x3b82f6, 240);
        const cell = 240, cols = 3, rows = 3, label = 34;
        const cv = document.createElement('canvas');
        cv.width = cell * cols; cv.height = (cell + label) * rows;
        const g = cv.getContext('2d');
        g.fillStyle = '#12141c'; g.fillRect(0, 0, cv.width, cv.height);
        await Promise.all(ALL_CHAR_TYPES.map((t, i) => new Promise(res => {
            const im = new Image();
            im.onload = () => {
                const x = (i % cols) * cell, y = Math.floor(i / cols) * (cell + label);
                g.drawImage(im, x, y, cell, cell);
                g.fillStyle = '#e5e7eb'; g.font = '700 20px sans-serif'; g.textAlign = 'center';
                g.fillText(CHAR_NAMES[t] || t, x + cell / 2, y + cell + 24);
                res();
            };
            im.onerror = res;
            im.src = shots[t];
        })));
        return cv.toDataURL('image/png');
    });
    fs.writeFileSync(path.join(__dirname, 'shot-charsheet.png'),
        Buffer.from(sheet.split(',')[1], 'base64'));

    // --- And on the board, at the size they are actually played at ---
    await page.evaluate(() => window.__QA.startRun({ mode: 'pass', map: 'city_circuit' }));
    let ready = false;
    for (let i = 0; i < 400 && !ready; i++) {
        ready = await page.evaluate(() => window.__QA.snapshot().gameState === 'PRE_ROLL');
        if (ready) break;
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(140);
    }
    ok('board: a City match reaches the roll with the new meshes', ready);
    await page.evaluate(async () => {
        // Put both players and a board buddy in one shot.
        const { state } = await import('/src/core/GameState.js');
        const GC = await import('/src/core/GameController.js');
        const R  = await import('/src/engine/Renderer.js');
        state.players[0].pos = 'r3'; state.players[0].mesh.position.copy(R.getPos('r3'));
        state.players[1].pos = 'r4'; state.players[1].mesh.position.copy(R.getPos('r4'));
        state.allyOnMap = null; R.removeAllyMarker();
        GC.spawnAlly();
        R.snapCameraToActive();
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(__dirname, 'shot-charsheet-board.png') });

    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));

    await browser.close();
    console.log('\nPASS:'); pass.forEach(p => console.log('  ✓ ' + p));
    console.log('\nFAIL:'); fail.length ? fail.forEach(f => console.log('  ✗ ' + f)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
