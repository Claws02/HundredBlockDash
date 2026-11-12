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

// The minigames are a git submodule; an un-initialised one is an empty folder
// and would ship a game whose every minigame 404s.
if (!fs.existsSync(path.join(ROOT, 'src/claw-core/minigames/MinigameManager.js'))) {
    console.error('src/claw-core is empty: run `git submodule update --init` first.');
    process.exit(1);
}

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
// MINIFY. Each file is minified in place and stays its own module: same paths,
// same imports, same exports, so the build is the dev tree made smaller and
// every QA probe can be pointed at www/ unchanged. (A single bundle would be
// smaller still, but the probes import modules by path.) `--no-minify` keeps
// the copy readable for debugging a device build.
const MINIFY = !process.argv.includes('--no-minify');
let after = bytes;
if (MINIFY) {
    let esbuild;
    try { esbuild = require('esbuild'); }
    catch (e) { console.error('esbuild is not installed: run `npm install` (or build with --no-minify).'); process.exit(1); }
    after = 0;
    (function walk(dir) {
        for (const f of fs.readdirSync(dir)) {
            const p = path.join(dir, f);
            const st = fs.statSync(p);
            if (st.isDirectory()) { walk(p); continue; }
            const ext = path.extname(p);
            const vendored = /\.min\.js$/.test(p);
            if ((ext === '.js' && !vendored) || ext === '.css') {
                const src = fs.readFileSync(p, 'utf8');
                const out = esbuild.transformSync(src, {
                    loader: ext === '.css' ? 'css' : 'js',
                    minify: true, legalComments: 'none', target: ['safari15', 'chrome100'],
                    // Stay in UTF-8: the game's text is full of emoji, and
                    // escaping each one would grow the files instead.
                    charset: 'utf8',
                }).code;
                fs.writeFileSync(p, out);
                after += Buffer.byteLength(out);
            } else {
                after += st.size;
            }
        }
    })(OUT);
}
console.log(`www/: ${files} files, ${(bytes / 1048576).toFixed(1)} MB` + (MINIFY ? ` → ${(after / 1048576).toFixed(1)} MB minified` : ''));
