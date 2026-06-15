// ============================================================
// ONBOARDING — How-to-Play carousel, in-game Rules reference, and the
// Settings panel. All three are built here and rendered into the
// pre-existing empty overlay containers in index.html, so this module
// owns its own DOM and wiring.
//
// The Rules reference is generated from live config data (SPACE_META,
// ITEMS, ALLIES) so it can never drift out of sync with the game.
// ============================================================

import { SPACE_META, SPACE_DESCS, ITEMS, ALLIES } from '../config/GameConfig.js';
import * as Settings from '../core/Settings.js';
import * as Storage from '../core/Storage.js';
import * as Stats from '../core/Stats.js';
import { sfx } from '../engine/AudioManager.js';

// ── How-to-Play slides ─────────────────────────────────────────────────────────
const SLIDES = [
    { icon: '🏁', title: 'WELCOME',
      body: 'Hundred Block Dash is a race-and-grab board game for 1–2 players. Roll, move, scoop up coins, and win head-to-head minigames to come out on top.' },
    { icon: '🎲', title: 'ROLL & MOVE',
      body: 'Tap <b>🎲 ROLL</b> or swipe up to throw the die — your token hops that many spaces. At a junction you choose a path: the safe Ring Road, or a riskier district.' },
    { icon: '🟢', title: 'SPACES',
      body: 'Each space does something: 🪙 gain coins, 💸 pay fines, 🎁 grab a mystery item, ⚡ roll again, 🌀 take a shortcut. A 🛡️ Shield blocks the next bad space.' },
    { icon: '🎒', title: 'ITEMS & SHOPS',
      body: 'Stop at a 🏪 shop to buy items with coins. On your turn, open your <b>🎒 bag</b> to use them — rockets, swaps, traps and more. You can carry up to 3.' },
    { icon: '🏙️', title: 'CITY CIRCUIT',
      body: 'Earn coins at 🏛️ District HQs, complete 📋 Contracts, recruit 🤝 Allies with passive powers, and win ⚔️ Duels. Most coins after 20 rounds wins the city!' },
    { icon: '🏆', title: 'MINIGAMES',
      body: 'Every few turns a quick head-to-head minigame decides who grabs bonus coins and rolls first. Hold the phone as the diagram shows, tap READY, and go!' },
];

let _slide = 0;
let _wired = false;

export function init() {
    _buildHowTo();
    _buildRules();
    _buildSettings();
    if (_wired) return;
    _wired = true;

    document.getElementById('htp-prev').addEventListener('click', () => _go(-1));
    document.getElementById('htp-next').addEventListener('click', () => _go(1));
    document.getElementById('htp-close').addEventListener('click', closeHowToPlay);
    document.getElementById('rules-close').addEventListener('click', closeRules);
    document.getElementById('settings-close').addEventListener('click', closeSettings);
}

// ── How-to-Play ────────────────────────────────────────────────────────────────
function _buildHowTo() {
    const ov = document.getElementById('howto-overlay');
    ov.innerHTML = `
        <div class="ob-panel">
            <div class="ob-slide" id="htp-slide"></div>
            <div class="ob-dots" id="htp-dots"></div>
            <div class="ob-nav">
                <button class="ob-btn" id="htp-prev">‹ BACK</button>
                <button class="ob-btn ob-btn-ghost" id="htp-close">SKIP</button>
                <button class="ob-btn ob-btn-primary" id="htp-next">NEXT ›</button>
            </div>
        </div>`;
}

function _renderSlide() {
    const s = SLIDES[_slide];
    document.getElementById('htp-slide').innerHTML =
        `<div class="ob-icon">${s.icon}</div>` +
        `<div class="ob-title bfont">${s.title}</div>` +
        `<div class="ob-body">${s.body}</div>`;
    document.getElementById('htp-dots').innerHTML =
        SLIDES.map((_, i) => `<span class="ob-dot${i === _slide ? ' on' : ''}"></span>`).join('');
    document.getElementById('htp-prev').style.visibility = _slide === 0 ? 'hidden' : 'visible';
    const next = document.getElementById('htp-next');
    const last = _slide === SLIDES.length - 1;
    next.textContent = last ? "LET'S GO ✓" : 'NEXT ›';
    document.getElementById('htp-close').style.visibility = last ? 'hidden' : 'visible';
}

function _go(dir) {
    if (dir > 0 && _slide === SLIDES.length - 1) { closeHowToPlay(); return; }
    _slide = Math.max(0, Math.min(SLIDES.length - 1, _slide + dir));
    sfx('countdown');
    _renderSlide();
}

export function openHowToPlay() {
    _slide = 0;
    _renderSlide();
    document.getElementById('howto-overlay').style.display = 'flex';
}

export function closeHowToPlay() {
    document.getElementById('howto-overlay').style.display = 'none';
    Storage.save('seen_howto', true);
}

// Auto-show once, on the very first launch.
export function maybeShowFirstRun() {
    if (!Storage.load('seen_howto', false)) openHowToPlay();
}

// ── Rules reference (data-driven) ───────────────────────────────────────────────
function _buildRules() {
    const spaceKeys = Object.keys(SPACE_DESCS).filter(k => SPACE_META[k]);
    const spaceRows = spaceKeys.map(k => _row(SPACE_META[k].ic, SPACE_META[k].n, SPACE_DESCS[k])).join('');
    const itemRows  = Object.values(ITEMS).map(it => _row(it.icon, it.name, it.desc)).join('');
    const allyRows  = Object.values(ALLIES).map(a => _row(a.icon, a.name, a.desc)).join('');

    document.getElementById('rules-overlay').innerHTML = `
        <div class="ob-panel ob-panel-wide">
            <div class="ob-head">
                <div class="ob-head-title bfont">📖 RULES & REFERENCE</div>
                <button class="ob-x" id="rules-close">✕</button>
            </div>
            <div class="ob-scroll">
                <div class="ob-section bfont">🟦 SPACES</div>${spaceRows}
                <div class="ob-section bfont">🎒 ITEMS</div>${itemRows}
                <div class="ob-section bfont">🤝 ALLIES</div>${allyRows}
            </div>
        </div>`;
}

function _row(icon, name, desc) {
    return `<div class="ob-ref-row"><span class="ob-ref-icon">${icon}</span>` +
           `<span class="ob-ref-text"><b>${name}</b><small>${desc}</small></span></div>`;
}

export function openRules()  { document.getElementById('rules-overlay').style.display = 'flex'; }
export function closeRules() { document.getElementById('rules-overlay').style.display = 'none'; }

// ── Settings panel ──────────────────────────────────────────────────────────────
function _buildSettings() {
    document.getElementById('settings-overlay').innerHTML = `
        <div class="ob-panel">
            <div class="ob-head">
                <div class="ob-head-title bfont">⚙️ SETTINGS</div>
                <button class="ob-x" id="settings-close">✕</button>
            </div>
            <div class="ob-scroll">
                <label class="set-row">
                    <span>🔊 Sound</span>
                    <input type="checkbox" class="set-toggle" id="set-sound">
                </label>
                <label class="set-row">
                    <span>🎚️ Volume</span>
                    <input type="range" min="0" max="100" class="set-range" id="set-volume">
                </label>
                <label class="set-row">
                    <span>📳 Vibration</span>
                    <input type="checkbox" class="set-toggle" id="set-haptics">
                </label>
                <label class="set-row">
                    <span>🌀 Reduce motion</span>
                    <input type="checkbox" class="set-toggle" id="set-motion">
                </label>
                <button class="ob-btn ob-btn-ghost set-wide" id="set-howto">❓ How to play</button>
                <button class="ob-btn ob-btn-ghost set-wide" id="set-reset">🗑️ Reset stats</button>
            </div>
        </div>`;

    const sound   = document.getElementById('set-sound');
    const volume  = document.getElementById('set-volume');
    const haptics = document.getElementById('set-haptics');
    const motion  = document.getElementById('set-motion');

    sound.addEventListener('change',   () => { Settings.set('muted', !sound.checked); sfx('buy'); });
    volume.addEventListener('input',    () => Settings.set('volume', volume.value / 100));
    volume.addEventListener('change',   () => sfx('coin_gain'));
    haptics.addEventListener('change',  () => { Settings.set('haptics', haptics.checked); if (haptics.checked) sfx('countdown'); });
    motion.addEventListener('change',   () => Settings.set('reduceMotion', motion.checked));
    document.getElementById('set-howto').addEventListener('click', () => { closeSettings(); openHowToPlay(); });
    document.getElementById('set-reset').addEventListener('click', e => {
        Stats.reset();
        e.target.textContent = '✓ Stats cleared';
        refreshSplashStats();
        setTimeout(() => { e.target.textContent = '🗑️ Reset stats'; }, 1400);
    });
}

function _syncSettingsUI() {
    const s = Settings.all();
    document.getElementById('set-sound').checked   = !s.muted;
    document.getElementById('set-volume').value    = Math.round(s.volume * 100);
    document.getElementById('set-haptics').checked = s.haptics;
    document.getElementById('set-motion').checked  = s.reduceMotion;
}

export function openSettings()  { _syncSettingsUI(); document.getElementById('settings-overlay').style.display = 'flex'; }
export function closeSettings() { document.getElementById('settings-overlay').style.display = 'none'; }

// ── Splash "your record" line ───────────────────────────────────────────────────
export function refreshSplashStats() {
    const el = document.getElementById('splash-stats');
    if (!el) return;
    const s = Stats.get();
    if (s.games === 0) { el.style.display = 'none'; return; }
    const streak = s.streak > 1 ? ` · 🔥 ${s.streak} streak` : '';
    el.innerHTML = `vs Bot: <b>${s.wins}W</b>–<b>${s.losses}L</b>${s.ties ? `–${s.ties}T` : ''}${streak}`;
    el.style.display = 'block';
}
