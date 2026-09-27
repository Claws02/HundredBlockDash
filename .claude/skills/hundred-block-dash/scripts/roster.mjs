// The live minigame roster, read from the code (never stale):
// key · title · hold · net · watchdog · file · probe · _debug hooks.
// usage: node roster.mjs [filter]      (filter matches key or title, case-insensitive)
import { readFileSync, existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { pathToFileURL } from 'url';
const root = execSync('git rev-parse --show-toplevel', { cwd: new URL('.', import.meta.url).pathname }).toString().trim();
const R = await import(pathToFileURL(`${root}/src/config/MinigameRegistry.js`).href);
const files = readdirSync(`${root}/src/minigames`).filter(f => f.endsWith('.js'));
// Map key → file by the loader's import table (MinigameManager), falling back to a name match.
const mgr = readFileSync(`${root}/src/minigames/MinigameManager.js`, 'utf8');
const fileFor = key => {
  const m = mgr.match(new RegExp(`['"]?${key}['"]?\\s*:\\s*\\(\\)\\s*=>\\s*import\\(['"]\\./([\\w]+\\.js)`));
  if (m) return m[1];
  return files.find(f => f.toLowerCase().replace('.js', '') === key) || '?';
};
const probeFor = (key, title) => {
  const cands = [key, key.replace(/s$/, ''), (title || '').toLowerCase().split(/\W+/)[0]];
  return cands.find(c => c && existsSync(`${root}/qa/${c}.js`)) || '';
};
const flt = (process.argv[2] || '').toLowerCase();
const rows = R.MG_TYPES.map(key => {
  const info = R.MG_INFO[key] || {}, file = fileFor(key);
  let hooks = [];
  if (file !== '?' && existsSync(`${root}/src/minigames/${file}`)) {
    hooks = [...readFileSync(`${root}/src/minigames/${file}`, 'utf8').matchAll(/export function (_debug\w+)/g)].map(m => m[1].replace('_debug', ''));
  }
  return { key, title: info.title || '', hold: R.MG_ORIENTATION_MAP?.[key] || '', net: R.MG_NET?.[key] || '',
           wd: R.MG_WATCHDOG_MS?.[key] ? `${R.MG_WATCHDOG_MS[key] / 1000}s` : '90s', file, probe: probeFor(key, info.title), hooks };
}).filter(r => !flt || r.key.includes(flt) || r.title.toLowerCase().includes(flt));
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(pad('key', 14) + pad('title', 24) + pad('hold', 9) + pad('net', 9) + pad('wd', 6) + pad('file', 26) + pad('probe', 14) + 'debug hooks');
rows.forEach(r => console.log(pad(r.key, 14) + pad(r.title, 24) + pad(r.hold, 9) + pad(r.net, 9) + pad(r.wd, 6) + pad(r.file, 26) + pad(r.probe || '—', 14) + r.hooks.join(' ')));
console.log(`\n${rows.length} of ${R.MG_TYPES.length} games`);
