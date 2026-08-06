// ============================================================
// SPACE AUDIT — what is actually on the board.
//
// Generates many real boards through the real generator and reports the true
// distribution per map, per length and per realm, plus the effect of every space
// type as the code actually implements it. The output is the source for
// docs/SPACE_REFERENCE.md — the point is that the table is measured, not
// transcribed from the weight constants, because the weights are drawn from a
// bag with replacement and the red budget is capped independently of them.
//
// usage: node spaceaudit.js [samples]
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const SAMPLES = parseInt(process.argv[2] || '200', 10);

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });

    const report = await page.evaluate(async (SAMPLES) => {
        const BS   = await import('/src/core/BoardSetup.js');
        const GCfg = await import('/src/config/GameConfig.js');
        const { state } = await import('/src/core/GameState.js');
        const { CITY_GRAPH } = await import('/src/config/BoardGraph.js');

        const out = { hbd: {}, city: null, meta: {} };

        // Every type the generator can emit, with its metadata and blurb.
        for (const [k, m] of Object.entries(GCfg.SPACE_META)) {
            out.meta[k] = { icon: m.ic, name: m.n, desc: GCfg.SPACE_DESCS[k] || '' };
        }

        // ── Hundred Block Dash, per length ─────────────────────────────────
        for (const len of [50, 75, 100]) {
            const total = {}, perRealm = {};
            let redRuns = [];              // gaps between consecutive coin-losing spaces
            for (let s = 0; s < SAMPLES; s++) {
                state.selectedMap = 'hundred_block_dash';
                state.hbdLength = len;
                state.hbd = GCfg.buildHbdConfig(len);
                GCfg.setHbdRealmCount(state.hbd.realmCount);
                BS.generateBoard();
                let lastRed = -1;
                for (let i = 0; i < len; i++) {
                    const t = state.board[i] && state.board[i].type;
                    if (!t) continue;
                    total[t] = (total[t] || 0) + 1;
                    const realm = GCfg.getRealmForSpace(i);
                    const key = realm ? realm.key : '?';
                    (perRealm[key] ||= {});
                    perRealm[key][t] = (perRealm[key][t] || 0) + 1;
                    if (t === 'lose' || t === 'lose_big' || t === 'trap') {
                        if (lastRed >= 0) redRuns.push(i - lastRed);
                        lastRed = i;
                    }
                }
            }
            redRuns.sort((a, b) => a - b);
            out.hbd[len] = {
                samples: SAMPLES,
                perBoard: Object.fromEntries(Object.entries(total)
                    .map(([k, v]) => [k, +(v / SAMPLES).toFixed(2)])
                    .sort((a, b) => b[1] - a[1])),
                redGap: {
                    min: redRuns[0] ?? null,
                    median: redRuns[Math.floor(redRuns.length / 2)] ?? null,
                    mean: redRuns.length ? +(redRuns.reduce((a, b) => a + b, 0) / redRuns.length).toFixed(2) : null,
                },
                realms: Object.fromEntries(Object.entries(perRealm).map(([r, m]) => [
                    r, Object.fromEntries(Object.entries(m)
                        .map(([k, v]) => [k, +(v / SAMPLES).toFixed(2)])
                        .sort((a, b) => b[1] - a[1])),
                ])),
            };
        }

        // ── City Circuit: the pools are fixed, so one board is the answer ──
        {
            const total = {}, perDistrict = {};
            for (let s = 0; s < 40; s++) {
                state.selectedMap = 'city_circuit';
                BS.initCityBoard();
                for (const [id, sp] of Object.entries(state.board)) {
                    const t = sp.type;
                    total[t] = (total[t] || 0) + 1;
                    const d = (CITY_GRAPH[id] && CITY_GRAPH[id].district) || '?';
                    (perDistrict[d] ||= {});
                    perDistrict[d][t] = (perDistrict[d][t] || 0) + 1;
                }
            }
            out.city = {
                samples: 40,
                nodes: Object.keys(state.board).length,
                perBoard: Object.fromEntries(Object.entries(total)
                    .map(([k, v]) => [k, +(v / 40).toFixed(2)])
                    .sort((a, b) => b[1] - a[1])),
                districts: Object.fromEntries(Object.entries(perDistrict).map(([d, m]) => [
                    d, Object.fromEntries(Object.entries(m)
                        .map(([k, v]) => [k, +(v / 40).toFixed(2)])
                        .sort((a, b) => b[1] - a[1])),
                ])),
            };
        }
        return out;
    }, SAMPLES);

    fs.writeFileSync(path.join(__dirname, 'result-spaceaudit.json'), JSON.stringify(report, null, 2));

    const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`;
    console.log(`\n=== SPACE AUDIT (${SAMPLES} generated boards per length) ===\n`);
    for (const len of [50, 75, 100]) {
        const d = report.hbd[len];
        const sum = Object.values(d.perBoard).reduce((a, b) => a + b, 0);
        console.log(`── HBD ${len} blocks — ${sum.toFixed(0)} placed spaces per board`);
        for (const [k, v] of Object.entries(d.perBoard)) {
            console.log(`   ${(report.meta[k]?.name || k).padEnd(14)} ${String(v).padStart(6)}  ${pct(v, sum).padStart(6)}`);
        }
        console.log(`   red gap: min ${d.redGap.min} · median ${d.redGap.median} · mean ${d.redGap.mean}\n`);
    }
    const c = report.city;
    const csum = Object.values(c.perBoard).reduce((a, b) => a + b, 0);
    console.log(`── City Circuit — ${c.nodes} nodes`);
    for (const [k, v] of Object.entries(c.perBoard)) {
        console.log(`   ${(report.meta[k]?.name || k).padEnd(14)} ${String(v).padStart(6)}  ${pct(v, csum).padStart(6)}`);
    }
    console.log(`\nerrors: ${errors.length ? errors.join(' | ') : 'none'}`);
    console.log(`full JSON → qa/result-spaceaudit.json`);
    await browser.close();
    process.exit(errors.length ? 1 : 0);
})();
