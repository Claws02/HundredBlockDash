// ============================================================
// AUDIO MANAGER — Web Audio API synth sounds + haptics
// All tuning lives here; no game logic, no DOM.
// ============================================================

let _ctx = null;

// ---- User-controllable audio/haptics state (driven by Settings.js) ----
let _master  = null;   // master gain node — single volume/mute choke point
let _muted   = false;
let _volume  = 0.8;
let _haptics = true;

function _applyGain() {
    if (_master) _master.gain.value = _muted ? 0 : _volume;
}

export function setMuted(m)          { _muted   = !!m; _applyGain(); }
export function setVolume(v)         { _volume  = Math.max(0, Math.min(1, +v || 0)); _applyGain(); }
export function setHapticsEnabled(h) { _haptics = !!h; }
export function isMuted()            { return _muted; }

function getCtx() {
    if (!_ctx) {
        _ctx = new (window.AudioContext || window.webkitAudioContext)();
        _master = _ctx.createGain();
        _master.connect(_ctx.destination);
        _applyGain();
    }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
}

function _out() { return _master || _ctx.destination; }

function _beep(freq, type, vol, start, dur, ctx) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(_out());
    o.type = type; o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    o.start(start); o.stop(start + dur + 0.05);
}

function _noise(vol, start, dur, ctx) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 800;
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(_out());
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.start(start); src.stop(start + dur + 0.05);
}

export function haptic(pattern) {
    if (!_haptics) return;
    try {
        // In the app, the native plugin: iOS WebViews do not implement
        // navigator.vibrate at all, so every haptic was silent on iPhone
        // (RELEASE_AUDIT VA-02). A longer pattern is a heavier tap.
        const H = window.Capacitor?.Plugins?.Haptics;
        if (H && H.impact) {
            const total = (Array.isArray(pattern) ? pattern : [pattern]).reduce((a, b) => a + (+b || 0), 0);
            H.impact({ style: total >= 60 ? 'HEAVY' : total >= 25 ? 'MEDIUM' : 'LIGHT' }).catch?.(() => {});
            return;
        }
        if (navigator.vibrate && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
    } catch (e) {}
}

export function sfx(name) {
    try {
        const ctx = getCtx(); const t = ctx.currentTime;
        _duck(t);
        switch (name) {
            case 'dice_throw':  _noise(0.3, t, 0.18, ctx); haptic([30]); break;
            case 'dice_land':   _beep(180, 'sine', 0.4, t, 0.08, ctx); haptic([10]); break;
            case 'coin_gain':   [523, 659, 784].forEach((f, i) => _beep(f, 'sine', 0.3, t + i * .07, 0.12, ctx)); break;
            case 'coin_loss':   [392, 330, 262].forEach((f, i) => _beep(f, 'triangle', 0.3, t + i * .08, 0.15, ctx)); break;
            case 'shield':      _beep(880, 'sine', 0.3, t, 0.06, ctx); _beep(1046, 'sine', 0.25, t + 0.07, 0.1, ctx); break;
            case 'swap':        [523, 784, 523].forEach((f, i) => _beep(f, 'sine', 0.3, t + i * .08, 0.1, ctx)); break;
            case 'shop_open':   [392, 494, 587].forEach((f, i) => _beep(f, 'sine', 0.2, t + i * .05, 0.15, ctx)); break;
            case 'buy':         _beep(784, 'sine', 0.4, t, 0.07, ctx); _beep(1046, 'sine', 0.35, t + 0.08, 0.12, ctx); haptic([15, 30, 15]); break;
            case 'mg_start':    [523, 659, 784, 1046].forEach((f, i) => _beep(f, 'square', 0.25, t + i * .1, 0.12, ctx)); haptic([50, 30, 50]); break;
            case 'mg_win':      [523, 659, 784, 659, 1046].forEach((f, i) => _beep(f, 'sine', 0.35, t + i * .1, 0.15, ctx)); haptic([50, 30, 50, 30, 100]); break;
            case 'mg_lose':     [392, 330, 262].forEach((f, i) => _beep(f, 'sine', 0.3, t + i * .12, 0.18, ctx)); haptic([80, 40, 80]); break;
            case 'gate_roll':   _noise(0.2, t, 0.4, ctx); _beep(80, 'sine', 0.4, t, 0.4, ctx); break;
            case 'gate_open':   [262, 330, 392, 523, 659, 784].forEach((f, i) => _beep(f, 'sine', 0.3, t + i * .08, 0.2, ctx)); haptic([100, 50, 100]); break;
            case 'win':         [523, 659, 784, 659, 784, 880, 784, 1046].forEach((f, i) => _beep(f, 'sine', 0.4, t + i * .12, 0.18, ctx)); haptic([100, 50, 100, 50, 200]); break;
            case 'react_go':    _beep(1046, 'sine', 0.5, t, 0.15, ctx); haptic([60]); break;
            case 'seq_lit':     _beep(440, 'sine', 0.3, t, 0.1, ctx); break;
            case 'countdown':   _beep(880, 'sine', 0.4, t, 0.08, ctx); haptic([20]); break;
            case 'go':          _beep(1046, 'sine', 0.5, t, 0.15, ctx); haptic([60]); break;
            case 'boost':       _beep(784, 'square', 0.3, t, 0.06, ctx); _beep(1046, 'square', 0.25, t + 0.07, 0.1, ctx); break;
            case 'land_good':   _beep(660, 'sine', 0.25, t, 0.1, ctx); break;
            case 'land_bad':    _beep(220, 'triangle', 0.3, t, 0.15, ctx); break;
            // The Star leaving for its new Office. A rising run plus a breath of
            // noise, because the comet crosses the whole board and needs to be
            // heard by whoever is not looking at the screen at that moment.
            case 'star_fly':    [523, 698, 880, 1175].forEach((f, i) => _beep(f, 'sine', 0.3, t + i * .09, 0.16, ctx));
                                _noise(0.12, t, 0.5, ctx); haptic([20, 40, 20]); break;
            // High Noon. The bell is the signal, so it has to be unmistakable
            // against the three decoys: two inharmonic partials with a long
            // tail, where the decoys are all short.
            case 'bell':        [[523, 0.45], [1319, 0.18], [784, 0.14]].forEach(([f, v]) => _beep(f, 'sine', v, t, 1.6, ctx));
                                haptic([40]); break;
            case 'gunshot':     _noise(0.7, t, 0.22, ctx); _beep(90, 'sine', 0.6, t, 0.25, ctx); haptic([70]); break;
            case 'caw':         _beep(620, 'sawtooth', 0.14, t, 0.12, ctx); _beep(540, 'sawtooth', 0.14, t + 0.16, 0.14, ctx); break;
            // Boot Hill Barrage: a shell landing. Longer and lower than the
            // gunshot, so a hit is heard as a hit and not as another shot.
            case 'boom':        _noise(0.8, t, 0.45, ctx); _beep(55, 'sine', 0.7, t, 0.5, ctx); haptic([90]); break;
            // The 4:15: the steam whistle that says a bridge is coming. Two
            // detuned tones held long, so it cannot be mistaken for a hit.
            case 'whistle':     [[587, 0.22], [698, 0.18]].forEach(([f, v]) => _beep(f, 'sawtooth', v * 0.5, t, 0.9, ctx));
                                _noise(0.08, t, 0.9, ctx); break;
            case 'slam':        _noise(0.45, t, 0.09, ctx); _beep(70, 'sine', 0.5, t, 0.12, ctx); break;
            // Block Party: the beat. A kick on the one, a hat on the rest —
            // short enough to sit under the call tones and the judgments.
            case 'kick':        _beep(62, 'sine', 0.55, t, 0.13, ctx); _beep(110, 'sine', 0.25, t, 0.04, ctx); break;
            case 'hat':         _noise(0.14, t, 0.03, ctx); break;
        }
    } catch (e) {}
}

// ============================================================
// MUSIC (RELEASE_AUDIT VA-01)
// ============================================================
// The game had no music and no ambience: every sound was a feedback beep. This
// is a small procedural score in the same synth voice as the effects, so it
// needs no licence and no download: a menu theme and a board loop, each a
// four-chord progression with a pad, a bass, an arpeggio and soft hats.
//
// It runs on its own bus with its own level (Settings → Music), under the
// master mute; it ducks under every effect so the feedback still reads; it
// goes silent while a minigame plays (those have their own sound) and whenever
// the app is hidden. Notes are scheduled a little ahead on the audio clock, so
// a janky frame never makes the music stumble.

let _musicBus = null, _duckGain = null, _cutGain = null;
let _mgForce = false, _mgPrevMood = 'off';   // a minigame that IS about the music (mgMusic)
let _musicLevel = 0.5;
let _mood = 'off';               // 'menu' | 'board' | 'off'
let _moodGate = () => true;      // false = hold the music (a minigame is on)
let _sched = null, _nextT = 0, _step = 0;

const _N = n => 440 * Math.pow(2, (n - 69) / 12);          // MIDI → Hz
// Chords as MIDI roots and qualities; the board loop is brighter and quicker.
const THEMES = {
    menu:  { bpm: 84, chords: [[53, 'maj'], [48, 'maj'], [50, 'min'], [46, 'maj']] },   // F C Dm B♭
    // Musical Chairs: the board loop's chords, quicker and with more swing.
    chairs: { bpm: 128, chords: [[48, 'maj'], [53, 'maj'], [45, 'min'], [55, 'maj']] },
    board: { bpm: 100, chords: [[48, 'maj'], [45, 'min'], [53, 'maj'], [55, 'maj'],     // C Am F G
                                [48, 'maj'], [52, 'min'], [53, 'maj'], [55, 'sus']] },  // C Em F Gsus
};
const QUAL = { maj: [0, 4, 7], min: [0, 3, 7], sus: [0, 5, 7] };

function _musicOut() {
    const ctx = getCtx();
    if (!_musicBus) {
        _musicBus = ctx.createGain();
        _duckGain = ctx.createGain();
        _cutGain = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 3200;
        _musicBus.connect(_duckGain); _duckGain.connect(_cutGain); _cutGain.connect(lp); lp.connect(ctx.destination);
        _applyMusicGain();
    }
    return _musicBus;
}
function _applyMusicGain() {
    if (!_musicBus || !_ctx) return;
    const v = _muted ? 0 : _musicLevel * 0.32;
    _musicBus.gain.setTargetAtTime(v, _ctx.currentTime, 0.08);
}
function _duck(t) {
    if (!_duckGain) return;
    const g = _duckGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.4, t + 0.03);
    g.linearRampToValueAtTime(1, t + 0.55);
}

export function setMusicLevel(v) { _musicLevel = Math.max(0, Math.min(1, +v || 0)); _applyMusicGain(); _syncScheduler(); }
// setMuted already exists; music follows it through _applyMusicGain.
const _setMutedFx = setMuted;
export function setMutedAll(m) { _setMutedFx(m); _applyMusicGain(); _syncScheduler(); }

/** 'menu', 'board' or 'off'. Safe to call before any user gesture: the music
 *  starts on the first sound the browser allows. */
export function setMusicMood(mood) {
    if (mood === _mood) return;
    _mood = mood;
    _step = 0;
    _syncScheduler();
}
/** A test the scheduler asks before each bar: false holds the music. */
export function setMusicGate(fn) { _moodGate = typeof fn === 'function' ? fn : () => true; }
export function musicState() { return { mood: _mood, level: _musicLevel, playing: !!_sched, step: _step, forced: _mgForce, cut: _cutGain ? +_cutGain.gain.value.toFixed(2) : 1 }; }

function _syncScheduler() {
    const want = _mood !== 'off' && !_muted && _musicLevel > 0 && !document.hidden;
    if (want && !_sched && _ctx) {
        _nextT = _ctx.currentTime + 0.1;
        _sched = setInterval(_schedule, 50);
    } else if (!want && _sched) {
        clearInterval(_sched); _sched = null;
    }
}

function _voice(freq, type, vol, t, attack, dur, dest, detune = 0) {
    const ctx = _ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
}
function _hat(t, vol, dest) {
    const ctx = _ctx, len = Math.floor(ctx.sampleRate * 0.04);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass'; f.frequency.value = 7000;
    src.buffer = buf; g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t);
}

// One eighth note at a time, 0.25 s ahead of the audio clock.
function _schedule() {
    if (!_ctx || _ctx.state !== 'running') return;
    const th = THEMES[_mood];
    if (!th) return;
    const dest = _musicOut();
    const eighth = 60 / th.bpm / 2;
    if (_nextT < _ctx.currentTime) _nextT = _ctx.currentTime + 0.05;   // after a stall, rejoin rather than burst
    while (_nextT < _ctx.currentTime + 0.25) {
        const t = _nextT, s = _step;
        const bar = Math.floor(s / 8), e8 = s % 8;
        if (_mgForce || _moodGate()) {
            const [root, q] = th.chords[bar % th.chords.length];
            const tones = QUAL[q].map(x => root + x);
            const section = Math.floor(bar / 4) % 4;              // 16-bar form: A A' B break
            if (e8 === 0) {
                // Pad: the chord, two detuned voices, held for the bar.
                const barLen = eighth * 8;
                tones.forEach(n => {
                    _voice(_N(n + 12), 'triangle', 0.05, t, 0.35, barLen * 0.98, dest, -6);
                    _voice(_N(n + 12), 'triangle', 0.05, t, 0.35, barLen * 0.98, dest, 6);
                });
            }
            // Bass on 1 and the "and" of 2, a fifth on 3.
            if (e8 === 0 || e8 === 3) _voice(_N(root - 12), 'sine', 0.22, t, 0.01, eighth * 2.4, dest);
            if (e8 === 4) _voice(_N(root - 5), 'sine', 0.16, t, 0.01, eighth * 1.8, dest);
            // Arpeggio up through the chord; it rests in the break.
            if (section !== 3 && (_mood === 'board' || e8 % 2 === 0)) {
                const pat = section === 1 ? [0, 2, 1, 2, 0, 2, 1, 2] : [0, 1, 2, 1, 0, 1, 2, 1];
                const n = tones[pat[e8]] + 24;
                _voice(_N(n), 'triangle', section === 2 ? 0.05 : 0.07, t, 0.005, eighth * 0.9, dest);
            }
            if ((_mood === 'board' || _mood === 'chairs') && e8 % 2 === 1) _hat(t, section === 3 ? 0.03 : 0.05, dest);
        }
        _nextT += eighth;
        _step++;
    }
}

/**
 * For a minigame whose rule IS the music (Musical Chairs). Plays through the
 * minigame gate, on the 'chairs' theme.
 *   'play'  start, or come back in after a stop or a dip
 *   'dip'   a fake-out: drop to a whisper for a moment, then carry on
 *   'stop'  cut dead, now — not after the notes already scheduled
 *   'off'   hand the music back to the board
 */
export function mgMusic(mode) {
    try {
        const ctx = getCtx(); _musicOut();
        const g = _cutGain.gain, t = ctx.currentTime;
        g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
        if (mode === 'play') {
            if (!_mgForce) { _mgForce = true; _mgPrevMood = _mood; _mood = 'chairs'; _step = 0; }
            g.linearRampToValueAtTime(1, t + 0.04);
        } else if (mode === 'dip') {
            g.linearRampToValueAtTime(0.18, t + 0.05);
            g.setValueAtTime(0.18, t + 0.45);
            g.linearRampToValueAtTime(1, t + 0.55);
        } else if (mode === 'stop') {
            g.linearRampToValueAtTime(0, t + 0.03);
        } else if (mode === 'off') {
            g.linearRampToValueAtTime(1, t + 0.1);
            if (_mgForce) { _mgForce = false; _mood = _mgPrevMood; _step = 0; }
        }
        _syncScheduler();
    } catch (e) {}
}

// Hidden app: no music in somebody's pocket.
try {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && _ctx && _ctx.state === 'running') _ctx.suspend().catch(() => {});
        else if (!document.hidden && _ctx && _ctx.state === 'suspended') _ctx.resume().catch(() => {});
        _syncScheduler();
    });
    // Browsers only allow audio after a gesture: the first tap starts it.
    const kick = () => { try { getCtx(); _musicOut(); _syncScheduler(); } catch (e) {} };
    window.addEventListener('pointerdown', kick, { passive: true });
    window.addEventListener('keydown', kick);
} catch (e) {}
