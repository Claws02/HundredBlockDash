// ============================================================
// AUDIO MANAGER — Web Audio API synth sounds + haptics
// All tuning lives here; no game logic, no DOM.
// ============================================================

let _ctx = null;

function getCtx() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
}

function _beep(freq, type, vol, start, dur, ctx) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
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
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.start(start); src.stop(start + dur + 0.05);
}

export function haptic(pattern) {
    try {
        if (navigator.vibrate && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
    } catch (e) {}
}

export function sfx(name) {
    try {
        const ctx = getCtx(); const t = ctx.currentTime;
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
        }
    } catch (e) {}
}
