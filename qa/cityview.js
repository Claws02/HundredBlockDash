// ============================================================
// NOTHING STANDS BETWEEN THE CAMERA AND YOUR PIECE
// ============================================================
// The owner's report was that City Circuit's scenery gets in the way of the
// view and the path. qa/mapshot.js could not have caught it: it parks the
// camera off the follow rig at a fixed pose to photograph the scenery, so the
// one camera that matters — the one actually pointed at your token while you
// play — was never in a screenshot.
//
// This probe uses that camera. It plays far enough into a real match to have a
// token on the board, then asks the renderer the question directly: is there
// anything solid on the line between the lens and the piece? A building fading
// to a ghost is fine and is the design; a building at full opacity across the
// shot is the bug.
//
// It also checks the two things the fade must NOT do: leave the whole city
// permanently ghosted (which would be a different kind of broken), and flicker
// the backdrop by fading things that are merely behind the token.
//
// usage: node cityview.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];

const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

(async () => {
    const browser = await chromium.launch({ args: GL });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text());
    });

    await page.addInitScript(() => {
        try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {}
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.startRun({
        mode: 'pass', map: 'city_circuit', players: 4, rounds: 6,
    }));
    await page.waitForFunction(() => {
        const S = window.__QA.snapshot();
        return S.gameState === 'PRE_ROLL';
    }, null, { timeout: 120000 }).catch(() => {});

    // Minigames resolve fast so the board keeps moving; the samples below are
    // only taken on the board itself.
    await page.evaluate(() => window.__QA.setMinigameFastResolve(1200));

    // Walk a few turns so the token travels and the camera swings through a
    // range of angles — one pose proves very little about a camera that moves.
    //
    // ONLY SAMPLE WHEN THE FOLLOW CAMERA IS ACTUALLY ON THE BOARD. The first
    // version of this did not check, stepped straight into a minigame, and
    // sampled with the camera parked on a minigame layer and the token
    // nowhere near it. Every sample came back "nothing in the way" — a clean
    // pass that meant only that it had not been looking at the city. A probe
    // that cannot tell the city from a minigame cannot report on either.
    const samples = [];
    const deadline = Date.now() + 300000;
    while (samples.length < 7 && Date.now() < deadline) {
        await page.evaluate(() => window.__QA.step());
        await page.waitForTimeout(120);
        const onBoard = await page.evaluate(() => {
            const S = window.__QA.snapshot();
            return (S.gameState === 'PRE_ROLL' || S.gameState === 'MOVING')
                && (S.cameraState === 'FOLLOW' || S.cameraState === 'MOVING');
        });
        if (!onBoard) continue;
        // Let the fade settle: it is a lerp, and sampling mid-transition would
        // report a building that is on its way out as though it were solid.
        await page.waitForTimeout(650);
        const stillOn = await page.evaluate(() => {
            const S = window.__QA.snapshot();
            return (S.gameState === 'PRE_ROLL' || S.gameState === 'MOVING');
        });
        if (!stillOn) continue;
        const s = await page.evaluate(async () => {
            const R = await import('/src/engine/Renderer.js');
            const S = (await import('/src/core/GameState.js')).state;
            const cam = R.getCamera ? R.getCamera() : null;
            const scene = R.getScene ? R.getScene() : null;
            if (!cam || !scene) return null;
            const p = S.players[S.activePlayer];
            if (!p || !p.mesh) return null;
            const env = scene.getObjectByName('cityEnv');
            if (!env) return null;

            const A = cam.position, B = p.mesh.position;
            const span = A.distanceTo(B);
            const seg = (m) => {
                const ab = { x: B.x - A.x, y: B.y - A.y, z: B.z - A.z };
                const lenSq = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
                if (lenSq < 1e-6) return Infinity;
                const ap = { x: m.x - A.x, y: m.y - A.y, z: m.z - A.z };
                let t = (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / lenSq;
                t = Math.max(0, Math.min(1, t));
                const c = { x: A.x + ab.x * t, y: A.y + ab.y * t, z: A.z + ab.z * t };
                return Math.hypot(m.x - c.x, m.y - c.y, m.z - c.z);
            };

            let blocking = 0, ghosted = 0, occluders = 0, dimBehind = 0;
            env.children.forEach(m => {
                if (!m.userData || !m.userData.occludes) return;
                occluders++;
                const opacity = m.userData.occNow === undefined ? 1 : m.userData.occNow;
                if (opacity < 0.9) ghosted++;
                const dCam = m.position.distanceTo(A);
                const dTok = m.position.distanceTo(B);
                const between = dCam < span && dTok < span;
                const near = seg(m.position) < 4.2 + (m.userData.occR || 0);
                // Solid AND in the way is the bug.
                if (between && near && opacity > 0.9) blocking++;
                // Faded but NOT in the way is the other bug: a backdrop that
                // flickers as the camera moves.
                if (!between && opacity < 0.9) dimBehind++;
            });
            return { blocking, ghosted, occluders, dimBehind, span: Math.round(span) };
        });
        if (s) samples.push(s);
    }

    ok('sampled the board, not a minigame, enough times to mean something',
       samples.length >= 5, `${samples.length} board samples`);
    if (samples.length) {
        const worst = Math.max(...samples.map(s => s.blocking));
        ok('nothing solid stands between the camera and the active piece',
           worst === 0, `worst sample had ${worst} blocking; ${JSON.stringify(samples.map(s => s.blocking))}`);
        ok('the city is marked as fadeable at all',
           samples[0].occluders > 0, `${samples[0].occluders} occluders`);
        // The fade must be selective. Everything ghosted at once means the test
        // is matching the whole city, which would look like fog rather than a
        // building stepping aside.
        const most = Math.max(...samples.map(s => s.ghosted / Math.max(1, s.occluders)));
        ok('the fade is selective, not the whole city',
           most < 0.35, `at worst ${(most * 100).toFixed(0)}% ghosted`);
        const behind = Math.max(...samples.map(s => s.dimBehind));
        ok('the backdrop behind the piece is left alone',
           behind === 0, `${behind} props faded while behind the token`);
    }

    // ---- and prove the fade FIRES ------------------------------------------
    //
    // Everything above shows the corridor is clear. That is the outcome we
    // want, but on its own it cannot tell "the fade is working" apart from
    // "the fade is dead code and the setback alone is carrying it" — in seven
    // samples nothing was ever ghosted, so the mechanism was never exercised.
    // So: put the camera deliberately on the far side of a building from the
    // token, and watch that building get out of the way.
    const fade = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const S = (await import('/src/core/GameState.js')).state;
        const cam = R.getCamera(), scene = R.getScene();
        const p = S.players[S.activePlayer];
        if (!cam || !scene || !p || !p.mesh) return null;
        const env = scene.getObjectByName('cityEnv');
        const props = env.children.filter(m => m.userData && m.userData.occludes);
        if (!props.length) return null;
        // Pick the prop nearest the token and stand the camera right behind it,
        // so it is unambiguously in the way.
        let victim = props[0], best = Infinity;
        props.forEach(m => {
            const d = m.position.distanceTo(p.mesh.position);
            if (d < best) { best = d; victim = m; }
        });
        const away = victim.position.clone().sub(p.mesh.position).normalize();
        cam.position.copy(victim.position).addScaledVector(away, 14);
        cam.position.y = 8;
        cam.lookAt(p.mesh.position);
        const before = victim.userData.occNow === undefined ? 1 : victim.userData.occNow;
        return { id: victim.uuid, before, gap: Math.round(best) };
    });
    if (fade) {
        // The lerp needs a moment of real frames to run.
        await page.waitForTimeout(1400);
        const after = await page.evaluate(async (id) => {
            const R = await import('/src/engine/Renderer.js');
            const env = R.getScene().getObjectByName('cityEnv');
            const m = env.children.find(c => c.uuid === id);
            if (!m) return null;
            const mat = Array.isArray(m.material) ? m.material[0] : m.material;
            return { occNow: m.userData.occNow, opacity: mat ? mat.opacity : null,
                     transparent: mat ? mat.transparent : null };
        }, fade.id);
        ok('a building put in the way actually fades',
           !!after && after.occNow < 0.6,
           `was ${fade.before.toFixed(2)}, now ${after ? after.occNow.toFixed(2) : 'n/a'}`);
        ok('...and the material is told to draw it that way',
           !!after && after.transparent === true && after.opacity < 0.6,
           after ? `opacity ${after.opacity.toFixed(2)}, transparent ${after.transparent}` : 'n/a');
    } else {
        ok('a building put in the way actually fades', false, 'could not stage the test');
    }

    const real = errors.filter(e => !/ResizeObserver|AudioContext|play\(\) failed/.test(e));
    ok('no page errors', real.length === 0, real.slice(0, 2).join(' | '));

    await page.screenshot({ path: path.join(__dirname, 'shot-cityview-follow.png') });
    await browser.close();

    console.log('=== CITY, FROM THE CAMERA THAT MATTERS ===');
    console.log('PASS:'); pass.forEach(p => console.log('  ✓ ' + p));
    console.log('FAIL:'); fail.length ? fail.forEach(f => console.log('  ✗ ' + f)) : console.log('  (none)');
    console.log(`\n${pass.length}/${pass.length + fail.length}`);
    process.exit(fail.length ? 1 : 0);
})();
