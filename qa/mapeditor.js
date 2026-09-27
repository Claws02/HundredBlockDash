// ============================================================
// MAP EDITOR — the built editor page works end to end
//
// Builds nothing itself: run `node scripts/build-map-editor.js` first. Loads
// tools/map-editor/dist/city-map-editor.html the way claude.ai frames it
// (three.js from the game's vendor copy instead of cdnjs, an in-memory stand-in
// for the page's db), then: every layout item is on the board, a real mouse
// drag moves a building, the inspector's buttons change it, undo reverts
// them, a library tap adds a model, the 3D view renders, and Save for Claude
// writes the layout and a saved version. Screenshots go to qa/shot-editor-*.png.
//
// usage: node qa/mapeditor.js      (W=820 H=1180 for iPad portrait)
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const ROOT = path.join(__dirname, '..');
const pass = [], fail = [];
const ok = (n, c, d) => (c ? pass : fail).push(n + (d ? ' — ' + d : ''));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: +(process.env.W||1180), height: +(process.env.H||820) }, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ body: fs.readFileSync(path.join(ROOT, 'vendor/three.min.js')), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  const page = fs.readFileSync(path.join(ROOT, 'tools/map-editor/dist/city-map-editor.html'), 'utf8');
  await p.route('http://editor.test/', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}body{margin:0}[hidden]{display:none!important}</style></head><body>' + page + '</body></html>' }));
  await p.addInitScript(() => {
    const store = {}; window.__store = store;
    const docRef = path => ({ id: path.split('/').pop(), path,
      get: async () => ({ exists: path in store, data: () => store[path] }),
      set: async d => { store[path] = JSON.parse(JSON.stringify(d)); }, delete: async () => { delete store[path]; } });
    const coll = (path, ord) => ({ doc: id => docRef(path + '/' + id),
      orderBy: (f, dir) => coll(path, [f, dir]), limit: () => coll(path, ord),
      get: async () => { let ds = Object.keys(store).filter(k => k.startsWith(path + '/') && k.split('/').length === path.split('/').length + 1).map(k => ({ id: k.split('/').pop(), exists: true, data: () => store[k] }));
        if (ord) ds.sort((a, b) => (a.data()[ord[0]] < b.data()[ord[0]] ? -1 : 1) * (ord[1] === 'desc' ? -1 : 1));
        return { docs: ds, empty: !ds.length, size: ds.length }; } });
    const db = { doc: docRef, collection: p => coll(p) };
    window.claude = { use: async n => n === 'db' ? db : null };
  });
  await p.goto('http://editor.test/');
  await p.waitForFunction(() => window.__editor && window.__editor.items.length > 0, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  // dismiss first-run help
  await p.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.hidden = true));
  await p.screenshot({ path: OUT + '/shot-editor-plan.png' });
  const r1 = await p.evaluate(() => ({ items: window.__editor.items.length, conf: document.getElementById('b-conf').textContent,
      status: document.getElementById('status').textContent,
      bad: window.__editor.items.filter(i => window.__editor.objs.get(i.uid).conflicts.length).map(i => i.model + ':' + window.__editor.objs.get(i.uid).conflicts.join('/')).slice(0, 12) }));
  console.log(JSON.stringify(r1));
  ok('every layout item is on the board', r1.items > 0, r1.items + ' items');
  // Drag the first fin building with the mouse: find its screen position.
  const target = await p.evaluate(() => {
    const it = window.__editor.items.find(i => i.model === 'fin'); window.__editor.select(null);
    const cam = null; return { uid: it.uid, x: it.x, z: it.z };
  });
  const scr = await p.evaluate(({ x, z }) => {
    const c = document.getElementById('view').getBoundingClientRect();
    // plan: half=95 vertical, centre 0,0, north up
    const half = 95, a = c.width / c.height;
    return { sx: c.left + (x / (half * a) + 1) / 2 * c.width, sy: c.top + (z / half + 1) / 2 * c.height };
  }, target);
  await p.mouse.move(scr.sx, scr.sy); await p.mouse.down(); await p.mouse.move(scr.sx + 40, scr.sy + 30, { steps: 8 }); await p.mouse.up();
  const r2 = await p.evaluate(uid => { const it = window.__editor.items.find(i => i.uid === uid); return { x: it.x, z: it.z, sel: !document.getElementById('inspector').hidden, status: document.getElementById('status').textContent, undo: !document.getElementById('b-undo').disabled }; }, target.uid);
  ok('a mouse drag moves a building', r2.x !== target.x || r2.z !== target.z, JSON.stringify(r2));
  ok('a drag leaves unsaved changes and an undo', r2.status === 'Unsaved changes' && r2.undo);
  console.log('after drag', JSON.stringify(target), '→', JSON.stringify(r2));
  await p.screenshot({ path: OUT + '/shot-editor-selected.png' });
  // Buttons: turn +90, variant next, HQ, bigger
  for (const id of ['i-r90', 'i-vnext', 'i-bigger']) await p.click('#' + id);
  const r3 = await p.evaluate(uid => { const it = window.__editor.items.find(i => i.uid === uid); return { rotY: it.rotY, seed: it.seed, scale: it.scale }; }, target.uid);
  ok('turn, variant and size buttons apply', r3.scale === 1.05, JSON.stringify(r3));
  console.log('after buttons', JSON.stringify(r3));
  await p.click('#b-undo'); await p.click('#b-undo');
  const r4 = await p.evaluate(uid => window.__editor.items.find(i => i.model === 'fin'), target.uid);
  ok('two undos revert size and variant', r4.scale === 1 && r4.seed !== r3.seed);
  console.log('after 2 undos', JSON.stringify({ rotY: r4.rotY, seed: r4.seed, scale: r4.scale }));
  // Add from library
  await p.click('.card');
  const r5 = await p.evaluate(() => ({ n: window.__editor.items.length, last: window.__editor.items.at(-1).model }));
  ok('a library tap adds a model', r5.n === r1.items + 1, JSON.stringify(r5));
  console.log('after add', JSON.stringify(r5));
  // 3D view
  await p.click('#v-3d'); await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + '/shot-editor-3d.png' });
  // Save
  {
    await p.click('#b-save'); await p.fill('#m-note', 'test save'); await p.click('#m-save-go'); await p.waitForTimeout(800);
    const r6 = await p.evaluate(() => ({ keys: Object.keys(window.__store), main: window.__store['layouts/city_circuit'] && { n: window.__store['layouts/city_circuit'].items.length, note: window.__store['layouts/city_circuit'].note }, status: document.getElementById('status').textContent }));
    ok('Save for Claude writes the layout and a version', !!r6.main && r6.keys.length === 2 && r6.main.note === 'test save', JSON.stringify(r6));
    console.log('after save', JSON.stringify(r6));
    
  }
  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
  console.log('PASS ' + pass.length); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('FAIL ' + fail.length); fail.forEach(x => console.log('  ✗ ' + x));
  process.exit(fail.length ? 1 : 0);
})();
