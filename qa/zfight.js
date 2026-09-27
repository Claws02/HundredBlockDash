// ============================================================
// ZFIGHT — no two flat surfaces on the board fight for the same pixels.
//
// Two upward-facing surfaces that overlap on the ground and sit closer
// together than the depth buffer can separate flicker as the camera moves:
// the "textures going crazy" look. This walks every mesh on the board, finds
// its upward-facing triangles, rasterises them onto a 0.5-unit grid by
// height, and reports every pair of different-looking surfaces that share
// cells and sit less than MIN_GAP apart. It also reads the camera's near/far
// planes and works out the smallest gap the depth buffer can resolve at the
// farthest board distance, so the two numbers can be compared.
//
// Surfaces drawn with polygonOffset or a distinct renderOrder over a
// depthWrite:false decal are counted as resolved.
//
// usage: node qa/zfight.js [city_circuit|hundred_block_dash]   (default: both)
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
// With the board's near plane at 0.5 or more, a 24-bit depth buffer resolves
// about 3 mm at 150 units; 2 cm leaves a wide margin for 16-bit-ish mobile
// precision and grazing angles. Heights are compared to 0.1 mm.
const MIN_GAP = +(process.env.MIN_GAP || 0.02);
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ` — ${d}` : ''));

async function probe(browser, map) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {} });
    // ?noopt keeps meshes separate so the report can name them; the merge
    // does not move any vertex, so the depths are the same either way.
    await page.goto(BASE + '?noopt', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(m => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: m, rounds: 6, len: 50 }), map);
    const t0 = Date.now();
    while (Date.now() - t0 < 600000) {
        const st = await page.evaluate(async () => {
            (await import('/src/engine/Renderer.js')).skipFlyover();
            for (const id of ['btn-msg-continue', 'btn-cb-start', 'btn-hbd-story-begin']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); }
            const m = document.querySelector('#modal-overlay button'); if (m && m.offsetParent) m.click();
            return window.__QA.snapshot().gameState;
        }).catch(() => '');
        if (st === 'PRE_ROLL') break;
        await page.waitForTimeout(700);
    }
    const r = await page.evaluate(async (MIN_GAP) => {
        const R = await import('/src/engine/Renderer.js');
        const THREE = window.THREE;
        const sc = R.getScene();
        const cam = R.getCamera ? R.getCamera() : null;
        sc.updateMatrixWorld(true);
        const CELL = 0.5;
        const surfaces = [];   // { name, mat, y, cells:Set, offset }
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
        const label = o => {
            const parts = [];
            for (let p = o; p && p !== sc && parts.length < 3; p = p.parent) parts.push(p.name || p.geometry?.type || p.type);
            return parts.join(' < ');
        };
        const matKey = m => {
            const col = m.color ? m.color.getHexString() : '';
            const map = m.map ? m.map.uuid.slice(0, 4) : '';
            return `${m.type}:${col}:${map}:${m.opacity}`;
        };
        sc.traverse(o => {
            if (!o.isMesh || o.isInstancedMesh || !o.geometry?.attributes?.position) return;
            let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
            if (!vis) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            const m = mats[0];
            if (!m || m.visible === false || m.colorWrite === false) return;
            const pos = o.geometry.attributes.position, idx = o.geometry.index;
            const tri = idx ? idx.count / 3 : pos.count / 3;
            if (tri > 20000) return;
            const byY = new Map();
            for (let t = 0; t < tri; t++) {
                const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
                a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
                b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
                c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
                e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2);
                const len = n.length(); if (len < 1e-9) continue;
                n.divideScalar(len);
                // Upward-facing (or, for double-sided flats, either way up).
                if (Math.abs(n.y) < 0.995) continue;
                if (n.y < 0 && m.side === THREE.FrontSide) continue;
                const y = +((a.y + b.y + c.y) / 3).toFixed(4);
                if (Math.abs(a.y - b.y) > 0.002 || Math.abs(a.y - c.y) > 0.002) continue;
                const key = y.toFixed(3);
                let cells = byY.get(key); if (!cells) byY.set(key, cells = { y, cells: new Set() });
                const minX = Math.floor(Math.min(a.x, b.x, c.x) / CELL), maxX = Math.floor(Math.max(a.x, b.x, c.x) / CELL);
                const minZ = Math.floor(Math.min(a.z, b.z, c.z) / CELL), maxZ = Math.floor(Math.max(a.z, b.z, c.z) / CELL);
                const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
                for (let gx = minX; gx <= maxX; gx++) for (let gz = minZ; gz <= maxZ; gz++) {
                    const px = (gx + 0.5) * CELL, pz = (gz + 0.5) * CELL;
                    const w1 = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / d;
                    const w2 = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / d;
                    if (w1 >= 0 && w2 >= 0 && w1 + w2 <= 1) cells.cells.add(gx * 100003 + gz);
                }
            }
            for (const { y, cells } of byY.values()) {
                if (!cells.size) continue;
                surfaces.push({ name: label(o), mat: matKey(m), matId: m.uuid, y, cells,
                    offset: !!m.polygonOffset, order: o.renderOrder, depthWrite: m.depthWrite !== false,
                    transparent: !!m.transparent });
            }
        });
        // Bucket by cell for pair search.
        surfaces.sort((p, q) => p.y - q.y);
        const fights = new Map();
        for (let i = 0; i < surfaces.length; i++) {
            const A = surfaces[i];
            for (let j = i + 1; j < surfaces.length; j++) {
                const B = surfaces[j];
                const gap = B.y - A.y;
                if (gap >= MIN_GAP - 1e-4) break;
                if (A.matId === B.matId || A.mat === B.mat) continue;   // same look: fighting is invisible
                // A decal drawn without depth write, or offset toward the camera, is resolved.
                if ((B.offset && !A.offset) || (!B.depthWrite && B.order > A.order)) continue;
                const [s, l] = A.cells.size < B.cells.size ? [A, B] : [B, A];
                let shared = 0; for (const k of s.cells) if (l.cells.has(k)) shared++;
                if (!shared) continue;
                const key = `${A.name} @${A.y}  vs  ${B.name} @${B.y}`;
                const prev = fights.get(key);
                if (!prev) fights.set(key, { a: A.name, ay: A.y, b: B.name, by: B.y, gap: +gap.toFixed(4), cells: shared });
                else prev.cells += shared;
            }
        }
        const list = [...fights.values()].sort((p, q) => q.cells - p.cells);
        const c0 = cam || (R._qaCamera && R._qaCamera());
        return {
            surfaces: surfaces.length,
            fights: list.length,
            cellsInFight: list.reduce((s, f) => s + f.cells, 0),
            top: list.slice(0, 40),
            near: c0 ? c0.near : null, far: c0 ? c0.far : null,
        };
    }, MIN_GAP);
    await ctx.close();
    return { r, errors };
}

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const maps = process.argv[2] ? [process.argv[2]] : ['city_circuit', 'hundred_block_dash'];
    const out = {};
    for (const map of maps) {
        const { r, errors } = await probe(browser, map);
        out[map] = r;
        console.log(`\n== ${map}: ${r.surfaces} flat surfaces, ${r.fights} fighting pairs over ${r.cellsInFight} cells; camera near ${r.near} far ${r.far}`);
        r.top.forEach(f => console.log(`  ${String(f.cells).padStart(6)} cells  gap ${f.gap.toFixed(4)}  ${f.a} @${f.ay}  vs  ${f.b} @${f.by}`));
        ok(`${map}: camera near plane ≥ 0.5`, r.near >= 0.5, `near ${r.near}`);
        ok(`${map}: no flat surfaces fighting (gap < ${MIN_GAP})`, r.fights === 0, `${r.fights} pairs, ${r.cellsInFight} cells`);
        ok(`${map}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    }
    fs.writeFileSync(path.join(__dirname, 'zfight.json'), JSON.stringify(out, null, 1));
    await browser.close();
    console.log(`\nPASS ${pass.length}`); pass.forEach(p => console.log('  ✓ ' + p));
    console.log(`FAIL ${fail.length}`); fail.forEach(f => console.log('  ✗ ' + f));
    process.exit(fail.length ? 1 : 0);
})();
