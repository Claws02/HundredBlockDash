#!/usr/bin/env node
// ============================================================
// BUILD MAP EDITOR — one self-contained page for claude.ai
//
// Fills tools/map-editor/editor.html with what it needs, so the page has no
// files of its own to fetch:
//
//   /*@@CITYKIT@@*/   src/engine/CityKit.js, verbatim: the editor builds the
//                     models with the game's own code, so what you place is
//                     what ships
//   /*@@REF@@*/       tools/map-editor/ref/<map>.json (spaces, roads)
//   @@GROUND@@        tools/map-editor/ref/<map>-ground.jpg as a data URL
//   /*@@LAYOUT@@*/    the layout the game uses now (src/config/layouts)
//   /*@@BUILD@@*/     the commit the models came from
//
// Refresh the reference first if the board itself changed:
//   node qa/exportlayout.js --ref-only
//
// usage: node scripts/build-map-editor.js [out.html]
//        (default tools/map-editor/dist/city-map-editor.html)
// ============================================================
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAP = 'city_circuit';
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function gameLayout() {
    const src = read(`src/config/layouts/${MAP}.js`);
    const at = src.indexOf('export default ');
    const body = src.slice(at + 'export default '.length).trim().replace(/;\s*$/, '');
    const layout = JSON.parse(body);
    if (!layout || !Array.isArray(layout.items)) throw new Error(`src/config/layouts/${MAP}.js has no layout yet: run qa/exportlayout.js`);
    return layout;
}

function build(out) {
    let html = read('tools/map-editor/editor.html');
    const kit = read('src/engine/CityKit.js');
    if (/<\/script/i.test(kit)) throw new Error('CityKit.js contains "</script" and cannot be inlined');
    const ref = JSON.parse(read(`tools/map-editor/ref/${MAP}.json`));
    const ground = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, `tools/map-editor/ref/${MAP}-ground.jpg`)).toString('base64');
    let commit = 'working tree';
    try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch (e) {}
    const info = { commit, date: new Date().toISOString().slice(0, 10) };
    const fill = (marker, text) => {
        if (!html.includes(marker)) throw new Error('editor.html is missing ' + marker);
        html = html.replace(marker, () => text);         // a function, so "$&" in the source stays literal
    };
    fill('/*@@CITYKIT@@*/', kit);
    fill('/*@@REF@@*/null', JSON.stringify(ref));
    fill('/*@@LAYOUT@@*/null', JSON.stringify(gameLayout()));
    fill('/*@@BUILD@@*/null', JSON.stringify(info));
    fill('@@GROUND@@', ground);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
    return { out, bytes: html.length };
}

if (require.main === module) {
    const out = path.resolve(process.argv[2] || path.join(ROOT, 'tools/map-editor/dist/city-map-editor.html'));
    const r = build(out);
    console.log(`wrote ${path.relative(ROOT, r.out) || r.out} (${Math.round(r.bytes / 1024)} KB)`);
}
module.exports = { build };
