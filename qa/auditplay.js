// ============================================================
// RELEASE AUDIT — a human-shaped playthrough of City Circuit, instrumented.
//
// Plays seat 1 the way a person does: real pointer taps on whatever the screen
// is offering (ROLL, junction arrows, modals, shops), against a bot in seat 2.
// Minigames are out of scope for this audit, so each one is resolved as soon as
// it starts playing. Everything else runs at the game's own pace.
//
// While it plays, a per-frame sampler in the page records:
//   frames   dt of every frame; long frames (> 50 ms, > 100 ms)
//   camera   per-frame position step and rotation step, snaps, cameraState
//            changes; how often the active token is off screen or hidden
//            behind scenery while the camera is meant to be following it
//   tokens   per-frame step of every player's figure; teleports
//   beats    every gameState change with its time, so dead time per turn can
//            be read off
//   copy     every toast / message / banner text that appeared
// and it screenshots the first few times each state is seen.
//
// usage: node auditplay.js [tag] [maxSeconds] [WxH] [fresh] [rounds]
//   fresh = 1 clears storage so first-run onboarding shows.
// Writes qa/audit-<tag>.json and qa/shot-audit-<tag>-*.png
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const [tag = 'main', maxSecS = '900', size = '390x844', freshS = '0', roundsS = '6'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const MAX = +maxSecS, FRESH = freshS === '1';

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
               '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
    });
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: +(process.env.DPR || 1), hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });
    const failed = [];
    page.on('requestfailed', r => failed.push(r.url()));

    await page.addInitScript(fresh => {
        try { localStorage.clear(); if (!fresh) localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {}
    }, FRESH);
    const tBoot = Date.now();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
    const bootMs = Date.now() - tBoot;
    await page.evaluate(() => window.__QA.bind());

    const shots = {};
    const shot = async name => { await page.screenshot({ path: path.join(__dirname, `shot-audit-${tag}-${name}.png`) }); if (typeof scanA11y === 'function') await scanA11y(name); };


    // ---------- accessibility scan of whatever is on screen ----------
    const a11y = {};
    const scanA11y = async name => {
        a11y[name] = await page.evaluate(() => {
            const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return { L: 0.2126 * r + 0.7152 * g + 0.0722 * b, a: m[3] === undefined ? 1 : +m[3] }; };
            const bgOf = el => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; const c = lum(cs.backgroundColor); if (c && c.a > 0.85) return c.L; } return 0.02; };
            const out = { small: [], lowContrast: [], smallTargets: [], serif: [] };
            const seen = new Set();
            document.querySelectorAll('body *').forEach(el => {
                if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
                const r = el.getBoundingClientRect();
                if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
                const cs = getComputedStyle(el);
                if (cs.visibility === 'hidden' || +cs.opacity < 0.2) return;
                const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
                const tag = (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''));
                if (own) {
                    const fs = parseFloat(cs.fontSize);
                    if (fs < 12 && !seen.has('s' + own)) { seen.add('s' + own); out.small.push(`${fs}px ${tag} "${own.slice(0, 40)}"`); }
                    if (/^(Times|serif|"Times New Roman")/i.test(cs.fontFamily) || (!/sans|system|Bebas|Nunito|Impact|monospace|emoji/i.test(cs.fontFamily))) { if (!seen.has('f' + tag)) { seen.add('f' + tag); out.serif.push(`${tag} font-family: ${cs.fontFamily.slice(0, 50)}`); } }
                    const fg = lum(cs.color), bg = bgOf(el);
                    if (fg && bg !== null) {
                        const ratio = (Math.max(fg.L, bg) + 0.05) / (Math.min(fg.L, bg) + 0.05) * (fg.a < 1 ? fg.a : 1);
                        const need = fs >= 18.66 || (fs >= 14 && +cs.fontWeight >= 700) ? 3 : 4.5;
                        if (ratio < need && !seen.has('c' + own)) { seen.add('c' + own); out.lowContrast.push(`${ratio.toFixed(1)}:1 ${tag} "${own.slice(0, 30)}"`); }
                    }
                }
                const interactive = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || cs.cursor === 'pointer' || el.onclick;
                if (interactive && (r.width < 44 || r.height < 44)) {
                    const k = tag + (el.innerText || '').slice(0, 20);
                    if (!seen.has('t' + k)) { seen.add('t' + k); out.smallTargets.push(`${Math.round(r.width)}x${Math.round(r.height)} ${tag} "${(el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 24)}"`); }
                }
            });
            out.noLabel = [...document.querySelectorAll('button')].filter(b => b.offsetParent && !(b.innerText || '').trim() && !b.getAttribute('aria-label')).map(b => b.id || b.className).slice(0, 20);
            return out;
        });
    };

    await shot('00-splash');

    // ---------- the in-page sampler ----------
    await page.evaluate(() => {
        window.__AUD = { frames: [], cam: [], tok: [], beats: [], copy: [], camStates: [], occl: { follow: 0, hidden: 0, off: 0 } };
        const A = window.__AUD;
        (async () => {
            const R = await import('/src/engine/Renderer.js');
            const { state: S } = await import('/src/core/GameState.js');
            const ray = new THREE.Raycaster();
            let last = performance.now(), lastState = '', lastCam = '', prevCam = null, prevTok = [], n = 0;
            const seenCopy = new Set();
            const copyIds = ['msg-title', 'msg-desc', 'toast-box', 'turn-banner', 'junction-banner', 'junction-primer', 'realm-banner', 'final-round', 'gate-title', 'gate-sub', 'roll-callout'];
            const tick = () => {
                const now = performance.now(), dt = now - last; last = now; n++;
                A.frames.push(Math.round(dt));
                if (S.gameState !== lastState) { A.beats.push([Math.round(now), S.gameState, S.activePlayer, S.currentRound]); lastState = S.gameState; }
                if (S.cameraState !== lastCam) { A.camStates.push([Math.round(now), S.cameraState, S.gameState]); lastCam = S.cameraState; }
                const cam = R.getCamera();
                if (cam) {
                    const p = cam.position, q = cam.quaternion;
                    if (prevCam) {
                        const dp = Math.hypot(p.x - prevCam[0], p.y - prevCam[1], p.z - prevCam[2]);
                        const dot = Math.min(1, Math.abs(q.x * prevCam[3] + q.y * prevCam[4] + q.z * prevCam[5] + q.w * prevCam[6]));
                        const dr = 2 * Math.acos(dot) * 180 / Math.PI;
                        A.cam.push([Math.round(now), +dp.toFixed(3), +dr.toFixed(2), S.cameraState, S.gameState, Math.round(dt), cam.fov]);
                    }
                    prevCam = [p.x, p.y, p.z, q.x, q.y, q.z, q.w];
                    // Is the active figure visible while the camera follows it?
                    if (n % 6 === 0 && S.cameraState === 'FOLLOW' && S.players && S.players[S.activePlayer]?.mesh && !S.mgActive) {
                        const m = S.players[S.activePlayer].mesh;
                        const wp = m.getWorldPosition(new THREE.Vector3()); wp.y += 0.8;
                        const ndc = wp.clone().project(cam);
                        A.occl.follow++;
                        if (Math.abs(ndc.x) > 0.95 || ndc.y < -0.95 || ndc.y > 0.95 || ndc.z > 1) A.occl.off++;
                        else {
                            const dir = wp.clone().sub(cam.position); const dist = dir.length(); dir.normalize();
                            ray.set(cam.position, dir); ray.far = dist - 0.9;
                            const hits = ray.intersectObjects(R.getScene().children, true)
                                .filter(h => h.object.visible && h.object.material && !h.object.material.transparent && h.distance < dist - 0.9);
                            // Only count real occluders: skip the figure itself and anything tiny.
                            const real = hits.filter(h => { let o = h.object; while (o) { if (o === m) return false; o = o.parent; } return true; });
                            if (real.length) { A.occl.hidden++; if (A.occl.samples === undefined) A.occl.samples = []; if (A.occl.samples.length < 30) A.occl.samples.push([S.players[S.activePlayer].pos, real[0].object.name || real[0].object.geometry?.type, +real[0].distance.toFixed(1), +dist.toFixed(1)]); }
                        }
                    }
                }
                if (S.players) {
                    S.players.forEach((pl, i) => {
                        if (!pl.mesh) return;
                        const p = pl.mesh.position;
                        const pr = prevTok[i];
                        if (pr) {
                            const d = Math.hypot(p.x - pr[0], p.z - pr[2]);
                            if (d > 0.001) A.tok.push([Math.round(now), i, +d.toFixed(3), +(p.y).toFixed(2), Math.round(dt), S.gameState]);
                        }
                        prevTok[i] = [p.x, p.y, p.z];
                    });
                }
                if (n % 10 === 0) copyIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    const cs = getComputedStyle(el);
                    const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
                    if (t && (el.offsetParent || cs.position === 'fixed') && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && el.getBoundingClientRect().height > 0) {
                        const k = id + ':' + t;
                        if (!seenCopy.has(k)) { seenCopy.add(k); A.copy.push([Math.round(now), id, t.slice(0, 200)]); }
                    }
                });
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        })();
    });

    // ---------- the menus, by real taps ----------
    const vis = sel => page.evaluate(sel => {
        const el = document.querySelector(sel);
        if (!el) return null;
        // A person scrolls to a button they can see the sheet has; so do we.
        { const r0 = el.getBoundingClientRect(); if (r0.width > 1 && (r0.bottom > innerHeight || r0.top < 0)) { el.scrollIntoView({ block: 'center' }); window.__scrolledFor = (window.__scrolledFor || []).concat(sel); } }
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1 || r.width < 2 || r.height < 2) return null;
        // Anything on top of it?
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const top = document.elementFromPoint(cx, cy);
        const covered = top && top !== el && !el.contains(top);
        return { x: cx, y: cy, w: r.width, h: r.height, covered, text: (el.innerText || '').trim().slice(0, 40) };
    }, sel);
    const tapSel = async (sel, note) => {
        const v = await vis(sel);
        if (!v) return false;
        await page.mouse.click(v.x, v.y);
        taps.push([Date.now() - t0, sel, note || v.text, v.covered ? 'COVERED' : '', Math.round(v.w) + 'x' + Math.round(v.h)]);
        return true;
    };
    const taps = [];
    let t0 = Date.now();

    if (FRESH) {
        // First-run: whatever onboarding shows, photograph it and go through it.
        for (let i = 0; i < 12; i++) {
            await page.waitForTimeout(700);
            const how = await vis('#howto-overlay');
            if (!how) break;
            await shot(`01-howto-${i}`);
            const next = await page.evaluate(() => {
                const o = document.getElementById('howto-overlay');
                const b = [...o.querySelectorAll('button')].filter(b => b.offsetParent !== null);
                const pick = b.find(x => /next|got it|start|play|let|done|continue/i.test(x.innerText)) || b[b.length - 1];
                if (!pick) return null;
                const r = pick.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: pick.innerText };
            });
            if (!next) break;
            await page.mouse.click(next.x, next.y);
            taps.push([Date.now() - t0, '#howto button', next.t]);
        }
    }
    await shot('02-menu');
    await tapSel('[data-mode="1p"]');
    await page.waitForTimeout(300);
    await tapSel('[data-diff="medium"]');
    await shot('03-mode');
    await tapSel('#btn-next');
    await page.waitForTimeout(600);
    await shot('04-chars');
    await tapSel('[data-char="slime"]');
    await tapSel('#btn-char-confirm');
    await page.waitForTimeout(600);
    await shot('05-maps');
    await tapSel('[data-map-id="city_circuit"]');
    await page.waitForTimeout(300);
    await tapSel(`[data-city-rounds="${roundsS}"]`);
    await shot('06-map-picked');
    await tapSel('#btn-map-confirm');
    t0 = Date.now();

    // ---------- the match ----------
    const seen = {};
    let lastGs = '', result = 'TIMEOUT', mgSince = 0, stuckSince = Date.now(), lastSig = '';
    const snap = () => page.evaluate(() => {
        const s = window.__QA.snapshot();
        return { gs: s.gameState, ap: s.activePlayer, round: s.round, mg: s.mgActive, p: s.p.map(x => x.pos + ':' + x.coins) };
    });
    while ((Date.now() - t0) / 1000 < MAX) {
        const s = await snap();
        const sig = JSON.stringify(s);
        if (sig !== lastSig) { lastSig = sig; stuckSince = Date.now(); }
        if (s.gs !== lastGs) {
            seen[s.gs] = (seen[s.gs] || 0) + 1;
            if (seen[s.gs] <= 3) await shot(`g-${s.gs}-${seen[s.gs]}`);
            lastGs = s.gs;
        }
        if (await vis('#win-screen')) { await page.waitForTimeout(1500); await shot('z-win'); result = 'WIN_SCREEN'; break; }
        if (Date.now() - stuckSince > 150000) { result = 'STUCK'; await shot('z-stuck'); break; }

        // Minigames: out of scope. Walk through the intro, then resolve.
        if (s.mg || await vis('#minigame-layer')) {
            if (!mgSince) mgSince = Date.now();
            await tapSel('#mg-ready-1');
            if (Date.now() - mgSince > 2500) {
                await page.evaluate(async () => {
                    const M = await import('/src/minigames/MinigameManager.js');
                    const { state } = await import('/src/core/GameState.js');
                    if (state.mgActive) M.endMinigame(Math.random() < 0.5 ? 0 : 1);
                });
                mgSince = 0;
            }
            await page.waitForTimeout(250);
            continue;
        }
        mgSince = 0;
        // Priority order: whatever modal owns the screen first.
        const order = [
            '#btn-cb-start', '#btn-ally-arrival', '#btn-mg-intro-next', '#btn-mg-launch', '#btn-solo-go',
            '#btn-resolve-pass', '#btn-msg-continue', '#gate-roll-btn', '#gate-continue-btn',
            '#btn-star-buy', '#btn-shop-offer-skip', '#btn-close-shop', '#btn-ally-claim',
            '#btn-ally-steal-cancel', '#btn-cancel-drop', '#btn-cancel-use', '#btn-duel-skip', '#btn-cancel-custom-dice',
        ];
        let acted = false;
        for (const sel of order) {
            if (await tapSel(sel)) { acted = true; break; }
        }
        if (!acted) {
            // Junction: pick an arrow, any arrow — district more often than ring.
            const arrows = await page.evaluate(() => [...document.querySelectorAll('#junction-arrows button, #junction-arrows .jn-arrow, #branch-cards button, #branch-cards .branch-card')]
                .filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: b.innerText.trim().slice(0, 30), w: r.width, h: r.height }; }));
            if (arrows.length) {
                if (!seen.__junction) { seen.__junction = 1; await shot('j-junction'); }
                const a = arrows[Math.random() < 0.65 ? arrows.length - 1 : 0];
                await page.mouse.click(a.x, a.y);
                taps.push([Date.now() - t0, 'junction', a.t, '', Math.round(a.w) + 'x' + Math.round(a.h)]);
                acted = true;
            }
        }
        if (!acted && s.gs === 'PRE_ROLL' && s.ap === 0) {
            const roll = await page.evaluate(() => {
                const b = [...document.querySelectorAll('#p1-actions button, #p1-actions [role=button]')].filter(x => x.offsetParent !== null);
                const r = b.find(x => /roll/i.test(x.innerText)) || b[0];
                if (!r) return null;
                const q = r.getBoundingClientRect();
                return { x: q.left + q.width / 2, y: q.top + q.height / 2, t: r.innerText, all: b.map(x => x.innerText.replace(/\s+/g, ' ').trim() + '@' + Math.round(x.getBoundingClientRect().width) + 'x' + Math.round(x.getBoundingClientRect().height)) };
            });
            if (roll) {
                if (!seen.__actions) { seen.__actions = roll.all; await shot('p-preroll'); }
                await page.mouse.click(roll.x, roll.y);
                taps.push([Date.now() - t0, 'ROLL', roll.t]);
                acted = true;
            }
        }
        await page.waitForTimeout(acted ? 400 : 250);
    }
    const elapsed = Math.round((Date.now() - t0) / 1000);

    const aud = await page.evaluate(() => window.__AUD);
    const fr = aud.frames.slice(60);
    const pct = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
    const camFollow = aud.cam.filter(c => c[3] === 'FOLLOW' && c[5] < 40);
    const snaps = aud.cam.filter(c => c[1] > 4 || c[2] > 12).map(c => ({ t: c[0], dp: c[1], dr: c[2], cs: c[3], gs: c[4] }));
    const tele = aud.tok.filter(t => t[2] > 1.2 && t[4] < 40);
    const out = {
        tag, size, fresh: FRESH, result, elapsed, bootMs, errors: [...new Set(errors)], failed: [...new Set(failed)].slice(0, 20),
        frames: { n: fr.length, p50: pct(fr, 0.5), p95: pct(fr, 0.95), p99: pct(fr, 0.99), over50: fr.filter(x => x > 50).length, over100: fr.filter(x => x > 100).length },
        camera: {
            followFrames: camFollow.length,
            followStepP95: pct(camFollow.map(c => c[1]), 0.95), followRotP95: pct(camFollow.map(c => c[2]), 0.95),
            followRotMax: Math.max(0, ...camFollow.map(c => c[2])),
            snaps: snaps.slice(0, 60), snapCount: snaps.length,
            states: aud.camStates, occlusion: aud.occl, fovs: [...new Set(aud.cam.map(c => c[6]))],
        },
        tokens: { teleports: tele.slice(0, 40), teleportCount: tele.length },
        beats: aud.beats, copy: aud.copy, taps, a11y,
    };
    fs.writeFileSync(path.join(__dirname, `audit-${tag}.json`), JSON.stringify(out, null, 1));
    console.log(JSON.stringify({ tag, result, elapsed, bootMs, errors: out.errors.length, frames: out.frames,
        cam: { p95: out.camera.followStepP95, rotP95: out.camera.followRotP95, rotMax: out.camera.followRotMax, snaps: out.camera.snapCount, occl: out.camera.occlusion },
        teleports: out.tokens.teleportCount, beats: out.beats.length, copy: out.copy.length, taps: taps.length }, null, 1));
    await browser.close();
})();
