// Renders resources/art.html to the source PNGs Capacitor's asset tool expects:
//   resources/icon.png        1024×1024, no transparency (App Store rejects alpha)
//   resources/splash.png      2732×2732
// usage: node scripts/render-store-art.js   (needs Playwright + a Chromium)
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

(async () => {
    const exe = process.env.CHROMIUM_PATH || undefined;
    const browser = await chromium.launch(exe ? { executablePath: exe } : {});
    const page = await browser.newPage({ viewport: { width: 2732, height: 2732 } });
    await page.goto('file://' + path.join(__dirname, '..', 'resources', 'art.html'));
    await page.evaluate(() => document.fonts.ready);
    const out = f => path.join(__dirname, '..', 'resources', f);
    await page.locator('#icon').screenshot({ path: out('icon.png'), omitBackground: false });
    await page.locator('#splash').screenshot({ path: out('splash.png') });
    await browser.close();
    console.log('wrote resources/icon.png, splash.png');
})();
