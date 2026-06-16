// ============================================================
// SETTINGS — user preferences (audio, haptics, motion), persisted.
// On change, applies side-effects: audio gain (AudioManager), haptics
// gating, and a `reduce-motion` body class consumed by the CSS.
// ============================================================

import * as Storage from './Storage.js';
import { setMuted, setVolume, setHapticsEnabled } from '../engine/AudioManager.js';

const DEFAULTS = { muted: false, volume: 0.8, reduceMotion: false, haptics: true };

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
}

export function get(key) { return _settings[key]; }
export function all()    { return { ..._settings }; }

export function set(key, value) {
    if (!(key in DEFAULTS)) return;
    _settings[key] = value;
    Storage.save('settings', _settings);
    apply();
}

function apply() {
    setMuted(_settings.muted);
    setVolume(_settings.volume);
    setHapticsEnabled(_settings.haptics);
    document.body.classList.toggle('reduce-motion', !!_settings.reduceMotion);
}
