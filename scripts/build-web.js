// Copies the shipped game into www/, the folder Capacitor packages.
// The repo root is also the web build (a static site with no bundler), so this
// is a copy with the dev-only folders left behind: qa/, docs/, resources/,
// scripts/, the archived minigames and anything dot-named.
// usage: node scripts/build-web.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');
const SHIP = ['index.html', 'privacy.html', 'css', 'src', 'vendor', 'assets'];
const SKIP = [/\/archived(\/|$)/, /\/\./, /\.md$/];

fs.rmSync(OUT, { recursive: true, force: true });
let files = 0, bytes = 0;
function copy(rel) {
    const src = path.join(ROOT, rel);
    if (SKIP.some(r => r.test('/' + rel))) return;
    const st = fs.statSync(src);
    if (st.isDirectory()) { fs.readdirSync(src).forEach(f => copy(path.join(rel, f))); return; }
    const dst = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    files++; bytes += st.size;
}
SHIP.forEach(copy);

// Nothing in the shipped game may import from what was left behind.
const bad = [];
(function scan(dir) {
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) { scan(p); continue; }
        if (!p.endsWith('.js')) continue;
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/(?:import\s[^'"]*|import\()\s*['"](\.[^'"]+)['"]/g)) {
            const target = path.resolve(path.dirname(p), m[1]);
            if (!fs.existsSync(target)) bad.push(`${path.relative(OUT, p)} → ${m[1]}`);
        }
    }
})(path.join(OUT, 'src'));
if (bad.length) {
    console.error('Imports that point outside the build:\n  ' + bad.join('\n  '));
    process.exit(1);
}
console.log(`www/: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
