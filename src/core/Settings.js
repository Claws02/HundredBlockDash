// ============================================================
// SETTINGS — user preferences (audio, haptics, motion), persisted.
// On change, applies side-effects: audio gain (AudioManager), haptics
// gating, and a `reduce-motion` body class consumed by the CSS.
// ============================================================

import * as Storage from './Storage.js';
import { setMutedAll, setVolume, setHapticsEnabled, setMusicLevel } from '../engine/AudioManager.js';

// textScale multiplies every stylesheet font size (--ts); batterySaver turns
// shadows off and caps the board's resolution; music is the music bus's own
// level, separate from sound effects (RELEASE_AUDIT A-03, RA-03, VA-01).
const DEFAULTS = { muted: false, volume: 0.8, reduceMotion: false, haptics: true,
                   textScale: 1, batterySaver: false, music: 0.5 };
const _listeners = [];
/** Call fn(settings) after every change, and once now. */
export function onChange(fn) { _listeners.push(fn); try { fn({ ..._settings }); } catch (e) {} }

let _settings = { ...DEFAULTS };

export function init() {
    const saved = Storage.load('settings', null);
    if (saved) {
        _settings = { ...DEFAULTS, ...saved };
    } else {
        // First run: honour the OS-level reduced-motion preference.
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                _settings.reduceMotion = true;
            }
        } catch (e) {}
    }
    apply();
    // Rotating an iPad across the 700 px line (or a split-screen resize) changes
    // whether it counts as a tablet.
    window.addEventListener('resize', () => { clearTimeout(_rz); _rz = setTimeout(apply, 150); });
}
let _rz = null;

export function get(key) { return _settings[key]; }
export function all()    { return { ..._settings }; }

export function set(key, value) {
    if (!(key in DEFAULTS)) return;
    _settings[key] = value;
    Storage.save('settings', _settings);
    apply();
}

function apply() {
    setMutedAll(_settings.muted);
    setMusicLevel(_settings.music);
    setVolume(_settings.volume);
    setHapticsEnabled(_settings.haptics);
    document.body.classList.toggle('reduce-motion', !!_settings.reduceMotion);
    // A tablet reads from further away and has the room: text 1.25× on top of
    // the player's own choice (RELEASE_AUDIT UX-10).
    const tablet = Math.min(window.innerWidth || 0, window.innerHeight || 0) >= 700;
    document.documentElement.classList.toggle('is-tablet', tablet);
    document.documentElement.style.setProperty('--ts', String((+_settings.textScale || 1) * (tablet ? 1.25 : 1)));
    _listeners.forEach(fn => { try { fn({ ..._settings }); } catch (e) {} });
}
