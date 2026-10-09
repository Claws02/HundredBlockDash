// Ring drifts outward from center. Hold your thumb down, release when ring hits the target zone.
// Score = distance from target. Miss if ring exits zone before you release.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const MAX_ROUNDS  = 5;
const ROUND_MS    = 4500;

let _done = false, _round = 0, _wins = [0, 0], _onWin = null;
// Per-player ring state: pct = 0..100 position along zone width
let _ring    = [{ pct: 5, speed: 0, target: 0 }, { pct: 5, speed: 0, target: 0 }];
let _scored  = [false, false];
let _score   = [null, null];   // null = not yet, number = distance (lower=better), Infinity = miss
let _held    = [false, false];
let _animId  = null, _roundTimer = null;
let _isBot   = false;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _round = 0; _wins = [0, 0]; _onWin = onWin; _isBot = isBot;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_animId); _animId = null;
    clearTimeout(_roundTimer);

    [1, 2].forEach(pi => {
        const pid  = pi - 1;
        const zone = document.getElementById(`tt-zone-${pi}`);
        const ring = document.getElementById(`tt-ring-${pi}`);
        const tgt  = document.getElementById(`tt-target-${pi}`);
        const sc   = document.getElementById(`tt-score-${pi}`);
        zone.style.display = 'flex'; ring.style.display = 'block';
        tgt.style.display  = 'block'; sc.style.display    = 'block';
        sc.textContent     = '0 wins';

        const down = (e) => { e.preventDefault(); if (_done || _scored[pid]) return; _held[pid] = true; ring.classList.add('tt-held'); };
        const up   = (e) => { e.preventDefault(); if (!_held[pid] || _scored[pid]) return; _held[pid] = false; ring.classList.remove('tt-held'); _release(pid); };
        zone.addEventListener('pointerdown', down);
        zone.addEventListener('pointerup',   up);
        zone.addEventListener('pointerleave', up);
        _cleanups.push(() => { zone.removeEventListener('pointerdown', down); zone.removeEventListener('pointerup', up); zone.removeEventListener('pointerleave', up); });
    });

    document.getElementById('mg-neutral').textContent = 'HOLD, THEN RELEASE AT THE LINE!';
    _startRound();
}

function _startRound() {
    if (!state.mgActive || _done || _round >= MAX_ROUNDS) return;
    _round++;
    _scored = [false, false]; _score = [null, null]; _held = [false, false];

    [0, 1].forEach(pid => {
        const baseSpeed = 6 + _round * 2.5;
        _ring[pid] = { pct: 5, speed: baseSpeed + Math.random() * 4, target: 62 + Math.random() * 20 };
        const tgt = document.getElementById(`tt-target-${pid + 1}`);
        tgt.style.left = `${_ring[pid].target}%`;
        const ring = document.getElementById(`tt-ring-${pid + 1}`);
        ring.style.left = '5%'; ring.className = 'tt-ring';
    });

    document.getElementById('mg-neutral').textContent = `ROUND ${_round}/${MAX_ROUNDS}`;
    sfx('countdown');

    const frameStart = performance.now();
    _roundTimer = setTimeout(() => {
        // Force-score any player who hasn't released yet (ring exits zone → miss)
        [0, 1].forEach(pid => { if (!_scored[pid]) { _ring[pid].pct = 105; _release(pid); } });
    }, ROUND_MS);

    const tick = (now) => {
        if (_done || (_scored[0] && _scored[1])) return;
        const dt = Math.min((now - (tick._last || now)) / 1000, 0.05);
        tick._last = now;

        [0, 1].forEach(pid => {
            if (_scored[pid]) return;
            // Ring accelerates over time
            const elapsed = (now - frameStart) / 1000;
            _ring[pid].pct += _ring[pid].speed * (1 + elapsed * 0.5) * dt;
            const ringEl = document.getElementById(`tt-ring-${pid + 1}`);
            ringEl.style.left = `${Math.min(_ring[pid].pct, 95)}%`;
            // Auto-miss if ring exits zone
            if (_ring[pid].pct > 100) { _release(pid); }
        });

        // Bot: release within ±4% of target, with some noise
        if (_isBot && !_scored[1] && !_held[1]) {
            const nearTarget = _ring[1].pct >= _ring[1].target - (3 + Math.random() * 5);
            if (nearTarget) { _held[1] = true; setTimeout(() => { if (state.mgActive && !_scored[1]) { _held[1] = false; _release(1); } }, 30 + Math.random() * 80); }
        }

        if (!_scored[0] || !_scored[1]) _animId = requestAnimationFrame(tick);
    };
    _animId = requestAnimationFrame(tick);
}

function _release(pid) {
    if (_scored[pid]) return;
    _scored[pid] = true;
    _held[pid]   = false;

    const pct    = _ring[pid].pct;
    const tgt    = _ring[pid].target;
    const dist   = pct - tgt;
    const missed = pct > tgt + 18 || pct < tgt - 40;
    _score[pid]  = missed ? Infinity : Math.abs(dist);

    const sc = document.getElementById(`tt-score-${pid + 1}`);
    if (missed)        { sc.textContent = 'MISS 💀'; sc.style.color = '#ef4444'; sfx('land_bad'); }
    else if (_score[pid] < 4) { sc.textContent = 'PERFECT! 🎯'; sc.style.color = '#4ade80'; sfx('land_good'); }
    else if (_score[pid] < 10) { sc.textContent = 'CLOSE! 👌'; sc.style.color = '#fbbf24'; sfx('land_good'); }
    else               { sc.textContent = 'OK 👍'; sc.style.color = '#60a5fa'; sfx('land_good'); }

    document.getElementById(`tt-ring-${pid + 1}`).classList.remove('tt-held');
    if (missed) document.getElementById(`tt-ring-${pid + 1}`).classList.add('tt-missed');

    if (_scored[0] && _scored[1]) _finishRound();
}

function _finishRound() {
    clearTimeout(_roundTimer);
    cancelAnimationFrame(_animId); _animId = null;

    const s0 = _score[0] ?? Infinity, s1 = _score[1] ?? Infinity;
    if (s0 < s1) _wins[0]++;
    else if (s1 < s0) _wins[1]++;

    [0, 1].forEach(pid => {
        document.getElementById(`tt-score-${pid + 1}`).textContent = `${_wins[pid]}W`;
    });

    const need = Math.ceil(MAX_ROUNDS / 2);
    if (_wins[0] >= need || _wins[1] >= need || _round >= MAX_ROUNDS) {
        _done = true; state.mgActive = false;
        _cleanups.forEach(f => f()); _cleanups.length = 0;
        const winner = _wins[0] > _wins[1] ? 0 : _wins[1] > _wins[0] ? 1 : -1;
        setTimeout(() => _onWin(winner), 900);
    } else {
        setTimeout(_startRound, 1600);
    }
}
