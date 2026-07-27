// ============================================================
// Renderer leak test (QA-002).
//
// Reaches the real scene via getTileMeshes()[0].parent (boardGrp) → scene, since
// the camera is not parented into the scene graph. Counts meshes, unique
// geometries, unique materials and the ambient animation list before and after
// repeated updateSingleTile() calls.
//
// usage: node leak.js [city_circuit|hundred_block_dash] [redraws]
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const MAP = process.argv[2] || 'city_circuit';
const REDRAWS = parseInt(process.argv[3] || '15', 10);

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    const cfg = MAP === 'city_circuit'
        ? { mode: '1p', difficulty: 'medium', map: 'city_circuit' }
        : { mode: '1p', difficulty: 'medium', map: 'hundred_block_dash', len: 100 };
    await page.evaluate(c => window.__QA.startRun(c), cfg);

    // Wait until tiles actually exist in the scene.
    await page.waitForFunction(async () => {
        const R = await import('/src/engine/Renderer.js');
        const t = R.getTileMeshes();
        return t.length > 0 && !!t[0].parent;
    }, null, { timeout: 40000 });
    await page.waitForTimeout(2000);

    const measure = await page.evaluate(async (n) => {
        const R = await import('/src/engine/Renderer.js');
        function root() {
            let o = R.getTileMeshes()[0];
            while (o.parent) o = o.parent;      // boardGrp → scene
            return o;
        }
        function census(label) {
            const r = root();
            let meshes = 0;
            const geos = new Set(), mats = new Set();
            r.traverse(n2 => {
                if (n2.isMesh || n2.isPoints || n2.isLine) {
                    meshes++;
                    if (n2.geometry) geos.add(n2.geometry.uuid);
                    (Array.isArray(n2.material) ? n2.material : n2.material ? [n2.material] : []).forEach(m => mats.add(m.uuid));
                }
            });
            return { label, rootType: r.type, meshes, geos: geos.size, mats: mats.size,
                     bobbing: R.getActiveAnims === undefined ? -1 : undefined,
                     tiles: R.getTileMeshes().length };
        }
        const series = [census('baseline')];
        for (let i = 1; i <= n; i++) {
            R.updateSingleTile();
            if (i === 1 || i === Math.ceil(n / 2) || i === n) series.push(census('after ' + i + ' redraws'));
        }
        return series;
    }, REDRAWS);

    // Ambient scenery must still be animating after redraws (the old bug froze it).
    const bobbing = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        return R.getActiveAnims().length;
    });

    const base = measure[0], last = measure[measure.length - 1];
    const grewMeshes = last.meshes - base.meshes;
    const grewMats = last.mats - base.mats;
    const out = { map: MAP, redraws: REDRAWS, series: measure, activeAnimsAfter: bobbing,
                  errors: [...new Set(errors)], grewMeshes, grewMats };
    fs.writeFileSync(path.join(__dirname, `result-leak-${MAP}.json`), JSON.stringify(out, null, 2));

    console.log(`map=${MAP}  scene root=${base.rootType}  redraws=${REDRAWS}`);
    measure.forEach(m => console.log(`  ${m.label.padEnd(20)} meshes=${String(m.meshes).padStart(4)} geos=${String(m.geos).padStart(4)} materials=${String(m.mats).padStart(4)} tileMeshes=${m.tiles}`));
    console.log(`  activeAnims after redraws: ${bobbing}`);
    console.log(grewMeshes === 0 && grewMats <= 0
        ? `\nPASS — scene graph flat across ${REDRAWS} redraws`
        : `\nFAIL — leaked ${grewMeshes} meshes and ${grewMats} materials over ${REDRAWS} redraws`);
    if (out.errors.length) console.log('errors:', out.errors.slice(0, 4));
    await browser.close();
    process.exit(grewMeshes === 0 && grewMats <= 0 ? 0 : 1);
})();
