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
// map → how far from the centre an item may stand, and whose models it uses
// (CityKit's MODELS entries carry `map: 'hbd'` for Hundred Block Dash's).
const MAPS = { city_circuit: { reach: 138, kit: 'city' }, hundred_block_dash: { reach: 500, kit: 'hbd' } };
// Hundred Block Dash keeps scenery per run length (GameConfig's HBD_LENGTHS):
// the realms split the path by length, so one set cannot suit every run.
const HBD_RUNS = ['50', '75', '100'];
const LOOK_KEYS = { city_circuit: ['fin', 'ba', 'shop', 'ind', 'ring'] };   // districts a layout may restyle
// What a district look may set, and how: a colour, or a number in a range.
const LOOK_FIELDS = {
    bgTop: 'colour', bgBot: 'colour', fog: 'colour', pave: 'colour', slab: 'colour', seam: 'colour',
    light: { color: 'colour', intensity: [0, 4], bounce: 'colour', bounceI: [0, 4] },
    motes: { color: 'colour', count: [0, 120, true], rise: [-4, 4], size: [0.03, 0.6] },
};

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
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const spec = own(MAPS, layout.map) ? MAPS[layout.map] : null;
    if (!spec) fail(`unknown map "${layout.map}"`);
    const { reach, kit } = spec;
    const r3 = n => Math.round(n * 1000) / 1000;
    const checkItems = (list, where) => {
        if (!Array.isArray(list)) fail(`${where} is not a list`);
        if (list.length > 600) fail(`${list.length} ${where} (limit 600)`);
        return list.map((it, i) => checkItem(it, where === 'items' ? `item ${i}` : `${where}[${i}]`));
    };
    const checkItem = (it, at) => {
        if (!it || typeof it !== 'object') fail(`${at} is not an object`);
        if (!own(MODELS, it.model)) fail(`${at}: unknown model "${it.model}"`);
        if ((MODELS[it.model].map || 'city') !== kit) fail(`${at}: "${it.model}" is not a ${layout.map} model`);
        const x = num(it.x, `${at}.x`), z = num(it.z, `${at}.z`);
        if (Math.hypot(x, z) > reach) fail(`${at} stands off the board (${x.toFixed(1)}, ${z.toFixed(1)})`);
        let rotY = num(it.rotY ?? 0, `${at}.rotY`);
        rotY = Math.atan2(Math.sin(rotY), Math.cos(rotY));
        const scale = num(it.scale ?? 1, `${at}.scale`);
        if (scale < 0.5 || scale > 2) fail(`${at}.scale ${scale} outside 0.5–2`);
        const seed = num(it.seed ?? 0, `${at}.seed`);
        const seeds = MODELS[it.model].seeds || 100;
        if (!Number.isInteger(seed) || seed < 0 || seed >= seeds) fail(`${at}.seed ${seed} is not 0–${seeds - 1}`);
        return { model: it.model, seed, hq: it.hq === true, x: r3(x), z: r3(z), rotY: r3(rotY), scale: r3(scale) };
    };
    if (kit === 'hbd') return validateHBD(layout, checkItems, reach, r3);
    const items = checkItems(layout.items, 'items');
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
    // District looks: { district: { bgTop: '#rrggbb', light: { intensity: 1.2 }, ... } }.
    const looks = {};
    if (layout.looks !== undefined) {
        const plain = (v, what) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${what} is not an object`); return v; };
        const check = (spec, val, what) => {
            if (spec === 'colour') {
                if (typeof val !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(val)) fail(`${what} is not a colour like #1a2b3c`);
                return val.toLowerCase();
            }
            const [lo, hi, whole] = spec;
            num(val, what);
            if (val < lo || val > hi || (whole && !Number.isInteger(val))) fail(`${what} ${val} is outside ${lo}–${hi}`);
            return Math.round(val * 1000) / 1000;
        };
        for (const [key, look] of Object.entries(plain(layout.looks, 'looks'))) {
            if (!(LOOK_KEYS[layout.map] || []).includes(key)) fail(`looks: "${key}" is not a district of ${layout.map}`);
            const out = {};
            for (const [field, v] of Object.entries(plain(look, `looks.${key}`))) {
                const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
                const spec = own(LOOK_FIELDS, field) ? LOOK_FIELDS[field] : null;
                if (!spec) fail(`looks.${key}.${field} is not something a look can set`);
                if (typeof spec === 'string') { out[field] = check(spec, v, `looks.${key}.${field}`); continue; }
                const sub = {};
                for (const [f, vv] of Object.entries(plain(v, `looks.${key}.${field}`))) {
                    if (!own(spec, f)) fail(`looks.${key}.${field}.${f} is not something a look can set`);
                    sub[f] = check(spec[f], vv, `looks.${key}.${field}.${f}`);
                }
                if (Object.keys(sub).length) out[field] = sub;
            }
            if (Object.keys(out).length) looks[key] = out;
        }
    }
    const note = typeof layout.note === 'string' ? layout.note.slice(0, 300) : '';
    const savedAt = typeof layout.savedAt === 'string' && !isNaN(Date.parse(layout.savedAt)) ? layout.savedAt : new Date().toISOString();
    // Version 2 places the street pieces too (props, spans, lamps, the park);
    // version 1 is buildings and landmarks only, the rest automatic.
    const version = layout.version === 2 ? 2 : 1;
    const out = { map: layout.map, version, savedAt, note, items };
    if (Object.keys(spaces).length) out.spaces = spaces;
    if (Object.keys(looks).length) out.looks = looks;
    return out;
}

// Hundred Block Dash: the path's waypoints, and the scenery for each run
// length. A length the layout leaves out keeps automatic scenery.
function validateHBD(layout, checkItems, reach, r3) {
    for (const k of ['spaces', 'looks']) if (layout[k] !== undefined) fail(`${k} is not something a ${layout.map} layout has`);
    if (Array.isArray(layout.items) && layout.items.length) fail(`items: ${layout.map} keeps its scenery per run length, in runs`);
    const out = { map: layout.map, version: 2, savedAt: '', note: '' };
    if (layout.path !== undefined) {
        const p = layout.path;
        if (!Array.isArray(p) || p.length < 4 || p.length > 40) fail('path is not a list of 4–40 waypoints');
        out.path = p.map((xz, i) => {
            if (!Array.isArray(xz) || xz.length !== 2) fail(`path[${i}] is not [x, z]`);
            const x = num(xz[0], `path[${i}][0]`), z = num(xz[1], `path[${i}][1]`);
            if (Math.hypot(x, z) > reach) fail(`path[${i}] stands off the board`);
            return [r3(x), r3(z)];
        });
        for (let i = 1; i < out.path.length; i++)
            if (Math.hypot(out.path[i][0] - out.path[i - 1][0], out.path[i][1] - out.path[i - 1][1]) < 4) fail(`path[${i}] is on top of path[${i - 1}]`);
    }
    if (layout.runs !== undefined) {
        if (!layout.runs || typeof layout.runs !== 'object' || Array.isArray(layout.runs)) fail('runs is not an object');
        out.runs = {};
        for (const [len, list] of Object.entries(layout.runs)) {
            if (!HBD_RUNS.includes(len)) fail(`runs: "${len}" is not a run length (${HBD_RUNS.join(', ')})`);
            out.runs[len] = checkItems(list, `runs.${len}`);
        }
    }
    if (!out.path && !out.runs) fail('neither path nor runs');
    out.note = typeof layout.note === 'string' ? layout.note.slice(0, 300) : '';
    out.savedAt = typeof layout.savedAt === 'string' && !isNaN(Date.parse(layout.savedAt)) ? layout.savedAt : new Date().toISOString();
    return out;
}

const countItems = l => l.items ? l.items.length : Object.values(l.runs || {}).reduce((n, r) => n + r.length, 0);

async function writeLayout(layout) {
    if (!MAPS[layout && layout.map]) validate(layout, {});          // refuses the unknown map before anything is loaded
    const kit = MAPS[layout.map].kit;
    const clean = validate(layout, await loadModels(), kit === 'city' ? await loadSpaces(layout.map) : new Set());
    const file = path.join(ROOT, 'src/config/layouts', clean.map + '.js');
    const body = JSON.stringify(clean, null, 1)
        .replace(/\n {2,}/g, ' ').replace(/\{ "model"/g, '\n  { "model"')     // one item per line
        .replace(/, "(\w+)": \[/g, ',\n  "$1": [')                           // one moved space per line
        .replace(/ +\n/g, '\n');
    fs.writeFileSync(file,
        `// GENERATED by scripts/apply-layout.js from a map-editor layout — don't hand-edit.\n` +
        `// ${countItems(clean)} items · saved ${clean.savedAt}${clean.note ? ' · ' + clean.note.replace(/[\r\n]+/g, ' ') : ''}\n` +
        `export default ${body};\n`);
    return { file, count: countItems(clean) };
}

module.exports = { validate, writeLayout, loadModels, loadSpaces };

if (require.main === module) {
    const src = process.argv[2];
    if (!src) { console.error('usage: node scripts/apply-layout.js <layout.json>'); process.exit(2); }
    writeLayout(JSON.parse(fs.readFileSync(src, 'utf8')))
        .then(r => console.log(`wrote ${path.relative(ROOT, r.file)} (${r.count} items)`))
        .catch(e => { console.error(e.message); process.exit(1); });
}
