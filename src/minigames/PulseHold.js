// Reworked: the pulse circle changes speed mid-round.
// Release when it hits the PEAK (scale ≥ 0.90). Score = scale × 100.
// Green glow signals the target zone. Missing the zone scores 0.
// Best of 5 — first to 3 wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const MAX_ROUNDS  = 5;
const MAX_WINS    = 3;
const PEAK_THRESH = 0.88; // scale threshold for "in the zone"
const ROUND_MS    = 6000;

let _done = false, _round = 0, _wins = [0, 0], _onWin = null, _isBot = false;
let _holding = [false, false], _releaseScores = [null, null], _animFrame = null;
const _cleanups = [];

// Per-player multi-phase speed schedule
let _phases = [[], []], _phaseIdx = [0, 0], _phaseElapsed = [0, 0], _prevTime = [0, 0];

function _makeSpeeds(round) {
    const count = 3 + Math.floor(Math.random() * 2); // 3–4 phases
    return Array.from({ length: count }, () => ({
        speed: (1.8 + Math.random() * 2.8) * (1 + round * 0.18),
        dur:   0.7 + Math.random() * 1.1,
    }));
}

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _round = 0; _wins = [0, 0]; _onWin = onWin; _isBot = isBot;
    _holding = [false, false]; _releaseScores = [null, null]; _animFrame = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;

    [1, 2].forEach(pi => {
        const pid    = pi - 1;
        const circle = document.getElementById(`pulse-circle-${pi}`);
        const score  = document.getElementById(`pulse-score-${pi}`);
        const zone   = document.getElementById(`pulse-zone-${pi}`);
        circle.style.display = 'block'; circle.style.transform = 'scale(0.2)';
        circle.style.borderColor = '#ffffff'; circle.style.boxShadow = 'none';
        score.style.display = 'block'; score.textContent = '0W'; score.style.color = '#fff';
        zone.style.display = 'flex';

        const down = e => { e.preventDefault(); if (_done || _releaseScores[pid] !== null) return; _holding[pid] = true; circle.style.opacity = '0.7'; };
        const up   = e => { e.preventDefault(); if (!_holding[pid] || _releaseScores[pid] !== null) return; _holding[pid] = false; circle.style.opacity = '1'; _scoreRelease(pid); };
        zone.addEventListener('pointerdown', down);
        zone.addEventListener('pointerup',   up);
        zone.addEventListener('pointerleave', up);
        _cleanups.push(() => { zone.removeEventListener('pointerdown', down); zone.removeEventListener('pointerup', up); zone.removeEventListener('pointerleave', up); });
    });

    document.getElementById('mg-neutral').textContent = 'HOLD & RELEASE AT PEAK GLOW!';
    _startRound();
}

function _startRound() {
    if (!state.mgActive || _done || _round >= MAX_ROUNDS) return;
    _round++;
    _releaseScores = [null, null]; _holding = [false, false];
    _phaseIdx = [0, 0]; _phaseElapsed = [0, 0];

    [0, 1].forEach(pid => {
        _phases[pid] = _makeSpeeds(_round - 1);
        const scoreEl = document.getElementById(`pulse-score-${pid + 1}`);
        scoreEl.textContent = `${_wins[pid]}W`; scoreEl.style.color = '#fff';
        const circle = document.getElementById(`pulse-circle-${pid + 1}`);
        circle.style.transform = 'scale(0.2)';
        circle.style.borderColor = '#ffffff'; circle.style.boxShadow = 'none';
    });
    document.getElementById('mg-neutral').textContent =
        `ROUND ${_round}/${MAX_ROUNDS}  ·  P1:${_wins[0]} P2:${_wins[1]}  ·  GREEN = PEAK!`;
    sfx('countdown');

    const timeoutId = setTimeout(() => {
        [0, 1].forEach(pid => { if (_releaseScores[pid] === null) _scoreRelease(pid, true); });
    }, ROUND_MS);

    let last = performance.now();
    const tick = now => {
        if (_done || (_releaseScores[0] !== null && _releaseScores[1] !== null)) {
            clearTimeout(timeoutId); _finishRound(); return;
        }
        const dt = Math.min((now - last) / 1000, 0.05); last = now;

        [0, 1].forEach(pid => {
            if (_releaseScores[pid] !== null) return;
            // Advance phase timer
            _phaseElapsed[pid] += dt;
            while (_phaseIdx[pid] < _phases[pid].length - 1 &&
                   _phaseElapsed[pid] > _phases[pid][_phaseIdx[pid]].dur) {
                _phaseElapsed[pid] -= _phases[pid][_phaseIdx[pid]].dur;
                _phaseIdx[pid]++;
            }
            const { speed } = _phases[pid][_phaseIdx[pid]];
            const t = _phaseElapsed[pid];
            const scale = 0.2 + 0.8 * Math.abs(Math.sin(t * speed * Math.PI));
            const circle = document.getElementById(`pulse-circle-${pid + 1}`);
            circle.style.transform = `scale(${scale.toFixed(3)})`;
            const atPeak = scale >= PEAK_THRESH;
            circle.style.borderColor = atPeak ? '#4ade80' : scale > 0.65 ? '#fbbf24' : '#ffffff';
            circle.style.boxShadow   = atPeak ? '0 0 22px rgba(74,222,128,0.75)' : 'none';

            // Bot: hold when scale rises, release near peak
            if (_isBot && pid === 1 && !_holding[1]) {
                if (scale > 0.82 + Math.random() * 0.08) {
                    _holding[1] = true;
                    circle.style.opacity = '0.7';
                    setTimeout(() => {
                        if (state.mgActive && !_done && _releaseScores[1] === null) {
                            _holding[1] = false; circle.style.opacity = '1';
                            _scoreRelease(1);
                        }
                    }, 30 + Math.random() * 70);
                }
            }
        });
        _animFrame = requestAnimationFrame(tick);
    };
    _animFrame = requestAnimationFrame(tick);
}

function _scoreRelease(pid, isTimeout = false) {
    if (_done || _releaseScores[pid] !== null) return;
    cancelAnimationFrame(_animFrame);
    const t = document.getElementById(`pulse-circle-${pid + 1}`).style.transform;
    const scale = parseFloat(t.replace('scale(', '').replace(')', '')) || 0.2;
    const score = isTimeout ? 0 : Math.round(scale * 100);
    _releaseScores[pid] = score;
    const scoreEl = document.getElementById(`pulse-score-${pid + 1}`);
    const label = isTimeout      ? 'TIMEOUT ❌' :
                  scale >= 0.96  ? 'PERFECT! 🎯' :
                  scale >= PEAK_THRESH ? 'IN THE ZONE! 🟢' :
                  scale >= 0.65  ? 'OK 🟡' : 'MISSED ❌';
    scoreEl.textContent = `${score}% ${label}`;
    scoreEl.style.color = scale >= PEAK_THRESH ? '#4ade80' : scale >= 0.65 ? '#fbbf24' : '#ef4444';
    sfx(scale >= PEAK_THRESH ? 'land_good' : 'land_bad');
    // If both have now released, finish the round immediately
    if (_releaseScores[0] !== null && _releaseScores[1] !== null) {
        _finishRound();
        return;
    }
    // Keep animating the other player if they haven't released yet
    _animFrame = requestAnimationFrame(function cont(now) {
        if (_done || (_releaseScores[0] !== null && _releaseScores[1] !== null)) { _finishRound(); return; }
        // Only update the still-active player
        [0, 1].forEach(p2 => {
            if (_releaseScores[p2] !== null) return;
            const ph = _phases[p2][_phaseIdx[p2]];
            _phaseElapsed[p2] += 0.016;
            if (_phaseElapsed[p2] > ph.dur && _phaseIdx[p2] < _phases[p2].length - 1) { _phaseElapsed[p2] = 0; _phaseIdx[p2]++; }
            const scale2 = 0.2 + 0.8 * Math.abs(Math.sin(_phaseElapsed[p2] * ph.speed * Math.PI));
            const c2 = document.getElementById(`pulse-circle-${p2 + 1}`);
            c2.style.transform = `scale(${scale2.toFixed(3)})`;
            const atPeak2 = scale2 >= PEAK_THRESH;
            c2.style.borderColor = atPeak2 ? '#4ade80' : scale2 > 0.65 ? '#fbbf24' : '#ffffff';
            c2.style.boxShadow   = atPeak2 ? '0 0 22px rgba(74,222,128,0.75)' : 'none';
        });
        _animFrame = requestAnimationFrame(cont);
    });
}

export function destroy() {
    cancelAnimationFrame(_animFrame); _animFrame = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    _done = true;
}

function _finishRound() {
    if (_done) return;
    cancelAnimationFrame(_animFrame); _animFrame = null;
    const s0 = _releaseScores[0] ?? 0, s1 = _releaseScores[1] ?? 0;
    if (s0 > s1) _wins[0]++;
    else if (s1 > s0) _wins[1]++;
    document.getElementById('mg-neutral').textContent =
        `ROUND DONE  P1:${_wins[0]} P2:${_wins[1]}`;
    const need = MAX_WINS;
    if (_wins[0] >= need || _wins[1] >= need || _round >= MAX_ROUNDS) {
        _done = true; state.mgActive = false;
        _cleanups.forEach(f => f()); _cleanups.length = 0;
        document.getElementById('minigame-layer').style.background = '';
        const winner = _wins[0] > _wins[1] ? 0 : _wins[1] > _wins[0] ? 1 : -1;
        setTimeout(() => _onWin(winner), 1000);
    } else {
        setTimeout(_startRound, 1800);
    }
}
