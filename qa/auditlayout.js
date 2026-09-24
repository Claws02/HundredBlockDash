// ============================================================
// RELEASE AUDIT — the board's screens across device sizes.
//
// For each viewport: the splash and settings, then a City match (1P vs bot)
// taken to the first PRE_ROLL on the human's turn, where the HUD, the rules
// sheet and the map view are photographed. Every screen is also checked for
//   · anything wider than the viewport (horizontal overflow)
//   · buttons that are cut off by an edge
//   · text under 12 px and touch targets under 44 × 44
//
// usage: node auditlayout.js [WxH,WxH,...]
// Writes qa/audit-layout.json and qa/shot-layout-<WxH>-*.png
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const SIZES = (process.argv[2] || '375x667,360x780,430x932,768x1024,1024x1366,844x390').split(',');

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const all = {};
    for (const size of SIZES) {
        const [W, H] = size.split('x').map(Number);
        const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: W < 700 || H < 500 });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: AGENT });
        await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 30000 });
        await page.evaluate(() => window.__QA.bind());
        const res = { errors, screens: {} };
        const check = async name => {
            await page.screenshot({ path: path.join(__dirname, `shot-layout-${size}-${name}.png`) });
            res.screens[name] = await page.evaluate(() => {
                const W = innerWidth, H = innerHeight, o = { overflowX: document.documentElement.scrollWidth > W + 1, cut: [], small: 0, smallEx: [], targets: 0, targetsEx: [] };
                document.querySelectorAll('button, [role=button], .sbtn, input').forEach(b => {
                    if (!b.offsetParent && getComputedStyle(b).position !== 'fixed') return;
                    const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
                    if (r.width < 2 || cs.visibility === 'hidden' || +cs.opacity < 0.2) return;
                    if (r.left < -1 || r.right > W + 1 || r.bottom > H + 1 || r.top < -1) o.cut.push(`${(b.id || b.className || b.tagName).toString().slice(0, 30)} "${(b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 20)}" [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]`);
                    if (r.width < 44 || r.height < 44) { o.targets++; if (o.targetsEx.length < 12) o.targetsEx.push(`${Math.round(r.width)}x${Math.round(r.height)} ${(b.id || b.className || '').toString().slice(0, 26)} "${(b.innerText || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 16)}"`); }
                });
                document.querySelectorAll('body *').forEach(el => {
                    if (!el.offsetParent) return;
                    const t = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
                    if (!t) return;
                    const r = el.getBoundingClientRect();
                    if (r.bottom < 0 || r.top > H || r.width < 1) return;
                    const fs = parseFloat(getComputedStyle(el).fontSize);
                    if (fs < 12) { o.small++; if (o.smallEx.length < 12) o.smallEx.push(`${fs}px "${t.slice(0, 28)}"`); }
                });
                return o;
            });
        };
        await check('splash');
        await page.mouse.click(...await center(page, '#btn-settings'));
        await page.waitForTimeout(400);
        await check('settings');
        await page.evaluate(() => document.getElementById('settings-close')?.click());
        await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'medium', map: 'city_circuit', rounds: 6 }));
        // To the human's first PRE_ROLL.
        const t0 = Date.now();
        await page.waitForFunction(() => { const s = window.__QA.snapshot(); return s.gameState === 'PRE_ROLL' && s.activePlayer === 0; }, null, { timeout: 400000, polling: 500 })
            .catch(() => { res.timeout = true; });
        res.toPreRollS = Math.round((Date.now() - t0) / 1000);
        await page.waitForTimeout(2500);
        await check('hud');
        const btn = async re => page.evaluate(src => {
            const re = new RegExp(src, 'i');
            const b = [...document.querySelectorAll('#p1-actions button, #ui-layer button')].filter(x => x.offsetParent && re.test(x.innerText));
            if (!b[0]) return null; const r = b[0].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];
        }, re.source);
        const rulesAt = await center(page, '#btn-rules');
        if (rulesAt) { await page.mouse.click(...rulesAt); await page.waitForTimeout(500); await check('rules'); await page.evaluate(() => document.getElementById('rules-close')?.click()); }
        const mapAt = await btn(/map/);
        if (mapAt) { await page.mouse.click(...mapAt); await page.waitForTimeout(1500); await check('map'); await page.evaluate(() => document.getElementById('btn-close-map')?.click()); await page.waitForTimeout(800); }
        const itemsAt = await btn(/items|bag/);
        if (itemsAt) { await page.mouse.click(...itemsAt); await page.waitForTimeout(600); await check('items'); await page.evaluate(() => document.getElementById('btn-cancel-use')?.click()); }
        const bAt = await btn(/bount/);
        if (bAt) { await page.mouse.click(...bAt); await page.waitForTimeout(600); await check('bounties'); await page.evaluate(() => document.getElementById('btn-close-bounties')?.click()); }
        all[size] = res;
        console.log(size, JSON.stringify({ toPreRoll: res.toPreRollS, timeout: !!res.timeout, errors: errors.length,
            screens: Object.fromEntries(Object.entries(res.screens).map(([k, v]) => [k, { ox: v.overflowX, cut: v.cut.length, small: v.small, targets: v.targets }])) }));
        await ctx.close();
    }
    fs.writeFileSync(path.join(__dirname, 'audit-layout.json'), JSON.stringify(all, null, 1));
    await browser.close();
})();

async function center(page, sel) {
    return page.evaluate(sel => {
        const el = document.querySelector(sel);
        if (!el || (!el.offsetParent && getComputedStyle(el).position !== 'fixed')) return null;
        const r = el.getBoundingClientRect();
        return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null;
    }, sel);
}
