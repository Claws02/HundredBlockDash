#!/usr/bin/env node
// ============================================================
// APPLY LAYOUT — a saved map-editor layout into the game
//
// Takes a layout as JSON (what the editor saves: { map, items: [...] }),
// checks every field, and writes src/config/layouts/<map>.js, which the
// game loads. Layout data arrives from a web page, so nothing in it is
// trusted: unknown maps and models are refused, numbers must be finite and
// inside the board, and the output is written as a JSON literal, never as
// code taken from the input.
//
// usage: node scripts/apply-layout.js <layout.json>
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAPS = { city_circuit: 138 };            // map → how far from the centre an item may stand

// The model library, loaded from CityKit.js itself so the two cannot
// disagree: three.js from the game's vendor copy stands in for the browser
// global, and the kit is imported from a copy named .mjs so Node reads it as
// the ES module it is.
async function importCopy(rel) {
    const tmp = path.join(require('os').tmpdir(), `layout-${process.pid}-${path.basename(rel, '.js')}.mjs`);
    fs.copyFileSync(path.join(ROOT, rel), tmp);
    try { return await import(require('url').pathToFileURL(tmp).href); }
    finally { fs.rmSync(tmp, { force: true }); }
}
async function loadModels() {
    global.THREE = global.THREE || require(path.join(ROOT, 'vendor/three.min.js'));
    return (await importCopy('src/engine/CityKit.js')).MODELS;
}
// The spaces a layout may move: the map's own nodes, less its junctions.
async function loadSpaces(map) {
    const M = (await importCopy(`src/config/maps/${map}.js`)).default;
    const junctions = M.junctions instanceof Set ? M.junctions : new Set(Object.keys(M.junctions || {}));
    return new Set(Object.keys(M.graph || {}).filter(id => !junctions.has(id)));
}

function fail(msg) { throw new Error('layout rejected: ' + msg); }
const num = (v, what) => { if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} is not a number`); return v; };

function validate(layout, MODELS, SPACES = new Set()) {
    if (!layout || typeof layout !== 'object') fail('not an object');
    const reach = MAPS[layout.map];
    if (!reach) fail(`unknown map "${layout.map}"`);
    if (!Array.isArray(layout.items)) fail('items is not a list');
    if (layout.items.length > 600) fail(`${layout.items.length} items (limit 600)`);
    const items = layout.items.map((it, i) => {
        const at = `item ${i}`;
        if (!it || typeof it !== 'object') fail(`${at} is not an object`);
        if (!Object.prototype.hasOwnProperty.call(MODELS, it.model)) fail(`${at}: unknown model "${it.model}"`);
        const x = num(it.x, `${at}.x`), z = num(it.z, `${at}.z`);
        if (Math.hypot(x, z) > reach) fail(`${at} stands off the board (${x.toFixed(1)}, ${z.toFixed(1)})`);
        let rotY = num(it.rotY ?? 0, `${at}.rotY`);
        rotY = Math.atan2(Math.sin(rotY), Math.cos(rotY));
        const scale = num(it.scale ?? 1, `${at}.scale`);
        if (scale < 0.5 || scale > 2) fail(`${at}.scale ${scale} outside 0.5–2`);
        const seed = num(it.seed ?? 0, `${at}.seed`);
        const seeds = MODELS[it.model].seeds || 100;
        if (!Number.isInteger(seed) || seed < 0 || seed >= seeds) fail(`${at}.seed ${seed} is not 0–${seeds - 1}`);
        const r3 = n => Math.round(n * 1000) / 1000;
        return { model: it.model, seed, hq: it.hq === true, x: r3(x), z: r3(z), rotY: r3(rotY), scale: r3(scale) };
    });
    // Moved spaces: { nodeId: [x, z] }, only for real spaces of this map.
    const spaces = {};
    if (layout.spaces !== undefined) {
        if (!layout.spaces || typeof layout.spaces !== 'object' || Array.isArray(layout.spaces)) fail('spaces is not an object');
        for (const [id, xz] of Object.entries(layout.spaces)) {
            if (!SPACES.has(id)) fail(`spaces: "${id}" is not a space on ${layout.map}`);
            if (!Array.isArray(xz) || xz.length !== 2) fail(`spaces.${id} is not [x, z]`);
            const x = num(xz[0], `spaces.${id}[0]`), z = num(xz[1], `spaces.${id}[1]`);
            if (Math.hypot(x, z) > reach) fail(`spaces.${id} stands off the board`);
            spaces[id] = [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000];
        }
    }
    const note = typeof layout.note === 'string' ? layout.note.slice(0, 300) : '';
    const savedAt = typeof layout.savedAt === 'string' && !isNaN(Date.parse(layout.savedAt)) ? layout.savedAt : new Date().toISOString();
    // Version 2 places the street pieces too (props, spans, lamps, the park);
    // version 1 is buildings and landmarks only, the rest automatic.
    const version = layout.version === 2 ? 2 : 1;
    const out = { map: layout.map, version, savedAt, note, items };
    if (Object.keys(spaces).length) out.spaces = spaces;
    return out;
}

async function writeLayout(layout) {
    if (!MAPS[layout && layout.map]) validate(layout, {});          // refuses the unknown map before anything is loaded
    const clean = validate(layout, await loadModels(), await loadSpaces(layout.map));
    const file = path.join(ROOT, 'src/config/layouts', clean.map + '.js');
    const body = JSON.stringify(clean, null, 1)
        .replace(/\n {2,}/g, ' ').replace(/\{ "model"/g, '\n  { "model"')     // one item per line
        .replace(/, "(\w+)": \[/g, ',\n  "$1": [');                          // one moved space per line
    fs.writeFileSync(file,
        `// GENERATED by scripts/apply-layout.js from a map-editor layout — don't hand-edit.\n` +
        `// ${clean.items.length} items · saved ${clean.savedAt}${clean.note ? ' · ' + clean.note.replace(/[\r\n]+/g, ' ') : ''}\n` +
        `export default ${body};\n`);
    return { file, count: clean.items.length };
}

module.exports = { validate, writeLayout, loadModels, loadSpaces };

if (require.main === module) {
    const src = process.argv[2];
    if (!src) { console.error('usage: node scripts/apply-layout.js <layout.json>'); process.exit(2); }
    writeLayout(JSON.parse(fs.readFileSync(src, 'utf8')))
        .then(r => console.log(`wrote ${path.relative(ROOT, r.file)} (${r.count} items)`))
        .catch(e => { console.error(e.message); process.exit(1); });
}
