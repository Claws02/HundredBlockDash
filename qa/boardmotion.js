// ============================================================
// BOARD MOTION — the token and the follow camera move without surges or lurches.
//
// The software GPU here draws the board at 1-3 fps, which says nothing about
// smoothness. So this stubs out the WebGL draw calls: the real game loop, hop
// animations and camera still run on real requestAnimationFrame frames at the
// display rate, they just don't draw. Every frame it records the active token
// and the camera, then measures over FOLLOW frames while tokens are walking:
//
//   token surge   — the largest one-frame change in the token's ground speed,
//                   as a multiple of its average walking speed. An ease-out hop
//                   jumps from dead stop to 3x average at every hop boundary.
//   camera jerk   — one-frame changes in the camera's velocity (u/s per frame)
//                   and angular velocity (deg/s per frame): p99 and max.
//
// Set-piece transits (a teleport or turn change, >40 units) are excluded: those
// are deliberate moves, not follow smoothing.
//
// usage: node qa/boardmotion.js [city_circuit|hundred_block_dash] [seconds]
// Compare two builds with QA_BASE=http://127.0.0.1:<port>/index.html.
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';

async function run(browser, map, seconds) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
        // No drawing: the GPU work in a software renderer is all in the draw
        // calls. three.js still does its full per-frame JS work.
        for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
            if (!C) continue;
            for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'clear']) C.prototype[f] = function () {};
        }
        try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); localStorage.setItem('hbd_seen_city_briefing', 'true'); } catch (e) {}
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.__QA && !!window.THREE, null, { timeout: 30000 });
    await page.evaluate(() => window.__QA.bind());
    await page.evaluate(() => window.__QA.setMinigameFastResolve && window.__QA.setMinigameFastResolve(true));
    await page.evaluate(m => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: m, rounds: 6, len: 50 }), map);
    // Recorder: one sample per animation frame.
    await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const { state } = await import('/src/core/GameState.js');
        window.__MOT = [];
        const tick = ts => {
            requestAnimationFrame(tick);
            const cam = R.getCamera();
            const p = state.players && state.players[state.activePlayer];
            if (!cam || !p || !p.mesh) return;
            const hop = R.getActiveAnims().some(a => a.isHop);
            window.__MOT.push([ts, state.cameraState, hop ? 1 : 0, state.activePlayer,
                p.mesh.position.x, p.mesh.position.z,
                cam.position.x, cam.position.y, cam.position.z,
                cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w]);
        };
        requestAnimationFrame(tick);
    });
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) {
        await page.evaluate(async () => {
            try { (await import('/src/engine/Renderer.js')).skipFlyover(); } catch (e) {}
            for (const id of ['btn-msg-continue', 'btn-cb-start', 'btn-hbd-story-begin']) { const b = document.getElementById(id); if (b && b.offsetParent) b.click(); }
            try { window.__QA.step(); } catch (e) {}
        }).catch(() => {});
        await page.waitForTimeout(250);
    }
    const S = await page.evaluate(() => window.__MOT);
    await ctx.close();
    return { S, errors };
}

function analyse(S) {
    const frames = [];
    const dts = [];
    for (let i = 2; i < S.length; i++) {
        const [t, cs, hop, ap, tx, tz, cx, cy, cz, qx, qy, qz, qw] = S[i];
        const a = S[i - 1], b = S[i - 2];
        const dt = (t - a[0]) / 1000, dtp = (a[0] - b[0]) / 1000;
        if (dt <= 0 || dtp <= 0 || dt > 0.05 || dtp > 0.05) continue;       // a stalled frame is not a motion sample
        dts.push(dt);
        if (cs !== 'FOLLOW' || a[1] !== 'FOLLOW' || b[1] !== 'FOLLOW') continue;
        if (ap !== a[3] || a[3] !== b[3]) continue;                          // change of turn
        const walking = hop || a[2];
        // Token ground velocity, this frame and last.
        const vt = Math.hypot(tx - a[4], tz - a[5]) / dt, vtp = Math.hypot(a[4] - b[4], a[5] - b[5]) / dtp;
        // Camera velocity vectors.
        const v = [(cx - a[6]) / dt, (cy - a[7]) / dt, (cz - a[8]) / dt];
        const vp = [(a[6] - b[6]) / dtp, (a[7] - b[7]) / dtp, (a[8] - b[8]) / dtp];
        const camStep = Math.hypot(cx - a[6], cz - a[8]);
        if (camStep > 3) continue;                                            // a transit, not follow
        const dv = Math.hypot(v[0] - vp[0], v[1] - vp[1], v[2] - vp[2]);
        const ang = (q1, q2) => 2 * Math.acos(Math.min(1, Math.abs(q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3]))) * 180 / Math.PI;
        const w = ang([qx, qy, qz, qw], a.slice(9)) / dt, wp = ang(a.slice(9), b.slice(9)) / dtp;
        frames.push({ i, walking, vt, vtp, dv, dw: Math.abs(w - wp), camSpeed: Math.hypot(...v), camStep, w, wp });
    }
    const walk = frames.filter(f => f.walking);
    const mean = walk.length ? walk.reduce((s, f) => s + f.vt, 0) / walk.length : 1;
    const q = (arr, k) => { const s = [...arr].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(k * s.length))] : 0; };
    const surge = walk.map(f => Math.abs(f.vt - f.vtp) / (mean || 1));
    if (process.env.SPIKES) {
        frames.filter(f => f.dw > 300 || f.dv > 300 || (f.walking && Math.abs(f.vt - f.vtp) > 60)).slice(0, 12).forEach(f => {
            console.log(`  spike @${f.i} walking=${f.walking} dv=${f.dv.toFixed(0)} dw=${f.dw.toFixed(0)} w=${f.w.toFixed(0)} wp=${f.wp.toFixed(0)} step=${f.camStep.toFixed(2)}`);
            for (let k = f.i - 3; k <= f.i + 1; k++) if (S[k]) console.log('    ', k, S[k][1], S[k][2], S[k].slice(4).map(x => x.toFixed(2)).join(' '), (S[k][0] - S[k - 1][0]).toFixed(1) + 'ms');
        });
    }
    return {
        frames: frames.length, walkingFrames: walk.length,
        meanFrameMs: +(1000 * dts.reduce((s, d) => s + d, 0) / Math.max(1, dts.length)).toFixed(2),
        tokenMeanSpeed: +mean.toFixed(2),
        tokenSurgeP99: +q(surge, 0.99).toFixed(3), tokenSurgeMax: +q(surge, 1).toFixed(3),
        camJerkP99: +q(walk.map(f => f.dv), 0.99).toFixed(2), camJerkMax: +q(frames.map(f => f.dv), 1).toFixed(2),
        camAngJerkP99: +q(walk.map(f => f.dw), 0.99).toFixed(2), camAngJerkMax: +q(frames.map(f => f.dw), 1).toFixed(2),
    };
}

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const maps = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : ['city_circuit', 'hundred_block_dash'];
    const seconds = +(process.argv[3] || 90);
    const out = {};
    for (const map of maps) {
        const { S, errors } = await run(browser, map, seconds);
        out[map] = { ...analyse(S), samples: S.length, errors: errors.slice(0, 3) };
        console.log(map, JSON.stringify(out[map]));
    }
    await browser.close();
    const tag = process.env.TAG || 'current';
    fs.writeFileSync(path.join(__dirname, `boardmotion-${tag}.json`), JSON.stringify(out, null, 1));
})();
