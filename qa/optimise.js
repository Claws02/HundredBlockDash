// ============================================================
// OPTIMISE — the static-scenery merge pays for itself and breaks nothing
// (RELEASE_AUDIT T-01), and Battery saver does what it says.
//
//   1. With the merge (default) the city draws in fewer calls than without it
//      (?noopt), with the same triangles give or take the merged-away seams.
//   2. The animated city still animates: steam, neon, tickers and motes are
//      separate objects, and a building in front of the token still fades.
//   3. Battery saver turns the shadow map off and draws fewer calls again.
//
// Writes qa/shot-optimise-{on,off}.png for a side-by-side look.
// usage: node optimise.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

async function measure(browser, query, shot) {
    query = query + (process.env.OPTCELL ? (query ? '&' : '?') + 'optcell=' + process.env.OPTCELL : '');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {} });
    await page.goto(BASE + query, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', rounds: 6 }));
    // Get past the flyover and briefing to the first roll.
    const t0 = Date.now();
    while (Date.now() - t0 < 600000) {
        const st = await page.evaluate(async () => {
            (await import('/src/engine/Renderer.js')).skipFlyover();
            for (const id of ['btn-msg-continue', 'btn-cb-start']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); }
            const m = document.querySelector('#modal-overlay button'); if (m && m.offsetParent) m.click();
            return window.__QA.snapshot().gameState;
        }).catch(() => '');
        if (st === 'PRE_ROLL') break;
        await page.waitForTimeout(700);
    }
    await page.waitForTimeout(4000);
    const r = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const sc = R.getScene();
        let meshes = 0, casters = 0, visible = 0;
        sc.traverse(o => { if (o.isMesh) { meshes++; if (o.castShadow) casters++; if (o.visible) visible++; } });
        const info1 = R.getRenderInfo();
        // Fixed viewpoints: street level at the start, a raised three-quarter
        // view, and the whole circuit from above.
        const { state } = await import('/src/core/GameState.js');
        const t = state.players[0].mesh.position;
        const views = {
            street: R.qaRenderFrom([t.x, 14, t.z + 40], [t.x, 0, t.z]),
            raised: R.qaRenderFrom([t.x + 60, 70, t.z + 120], [t.x, 0, t.z]),
            overview: R.qaRenderFrom([t.x, 520, t.z + 1], [t.x, 0, t.z]),
        };
        await new Promise(r => setTimeout(r, 1500));
        return { stats: R.getOptimiseStats(), views, info: R.getRenderInfo(), info1, meshes, casters, visible, q: R.getQuality() };
    });
    await page.screenshot({ path: path.join(__dirname, shot) });
    return { page, ctx, r, errors };
}

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const off = await measure(browser, '?noopt', 'shot-optimise-off.png');
    await off.ctx.close();
    const on = await measure(browser, '', 'shot-optimise-on.png');
    console.log('off', JSON.stringify(off.r));
    console.log('on ', JSON.stringify(on.r));

    const s = on.r.stats;
    ok('1 the merge ran and reports what it did', !!s && s.mergedGroups > 0, s && `meshes ${s.meshesBefore}→${s.meshesAfter}, materials ${s.materialsBefore}→${s.materialsAfter}, ${s.mergedGroups} merged groups`);
    ok('1 scene mesh count falls', on.r.meshes < off.r.meshes, `${off.r.meshes} → ${on.r.meshes}`);
    for (const v of ['street', 'raised', 'overview']) {
        const a = off.r.views[v], b = on.r.views[v];
        ok(`1 ${v} view: draw calls do not rise`, b.calls <= a.calls, `${a.calls} → ${b.calls} calls, ${a.triangles} → ${b.triangles} tris`);
    }
    ok('1 overview: draw calls fall by a third or more', on.r.views.overview.calls <= off.r.views.overview.calls * 0.67,
       `${off.r.views.overview.calls} → ${on.r.views.overview.calls}`);

    // 2. The living bits still move and fade.
    const live = await on.page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const sc = R.getScene();
        // Sample everything that moves between two frames.
        const pos = new Map();
        sc.traverse(o => { if (o.isMesh && !o.userData.merged) pos.set(o, o.position.clone()); });
        await new Promise(r => setTimeout(r, 2500));
        let moved = 0;
        pos.forEach((p, o) => { if (o.position.distanceTo(p) > 1e-4) moved++; });
        // An occluder: does it still own separate materials it can fade?
        let occ = 0, occMats = 0;
        sc.traverse(o => { if (o.userData && o.userData.occludes) { occ++; occMats += (o.userData.occMats || []).length; } });
        return { moved, occ, occMats };
    });
    ok('2 animated scenery still moves', live.moved > 5, `${live.moved} meshes moved in 2.5 s`);
    ok('2 occluders survive with their own fade materials', live.occ > 0 && live.occMats > 0, JSON.stringify(live));

    // 3. Battery saver.
    const bat = await on.page.evaluate(async () => {
        const S = await import('/src/core/Settings.js');
        const R = await import('/src/engine/Renderer.js');
        // three r128 resets its counters after the shadow pass, so `calls`
        // never includes it: read the switch itself.
        const before = R.getRenderInfo().shadows;
        S.set('batterySaver', true);
        await new Promise(r => setTimeout(r, 2500));
        const on = R.getRenderInfo();
        S.set('batterySaver', false);
        await new Promise(r => setTimeout(r, 1500));
        return { before, after: on.shadows, ratio: on.pixelRatio, back: R.getRenderInfo().shadows };
    });
    ok('3 battery saver drops the shadow pass and holds 1×', bat.before === true && bat.after === false && bat.ratio === 1, JSON.stringify(bat));
    ok('3 turning it off brings the shadows back', bat.back === true, JSON.stringify(bat));

    ok('no page errors', !off.errors.length && !on.errors.length, [...off.errors, ...on.errors].slice(0, 3).join(' | '));
    console.log('PASS:'); pass.forEach(p => console.log('  ✓', p));
    console.log('FAIL:'); fail.length ? fail.forEach(p => console.log('  ✗', p)) : console.log('  (none)');
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})();
