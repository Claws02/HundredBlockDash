// A 3x3 grid of cells is highlighted on the observer's half.
// The actor must tap the correct HORIZONTALLY MIRRORED version from 3 options.
// Roles swap each round. Best of 3.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const COLS      = 3;
const ROWS      = 3;
const CELLS     = COLS * ROWS;
const ROUND_MS  = 4000;
const MAX_ROUNDS = 4;

let _done = false, _round = 0, _wins = [0, 0], _onWin = null;
let _actor = 0, _source = [], _correct = [];
let _roundTimer = null, _isBot = false;

// Mirror a flat 3x3 index horizontally
function _mirrorIdx(idx) {
    const row = Math.floor(idx / COLS);
    const col = idx % COLS;
    return row * COLS + (COLS - 1 - col);
}

function _mirrorPattern(pat) { return pat.map(_mirrorIdx).sort((a, b) => a - b); }

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _round = 0; _wins = [0, 0]; _onWin = onWin; _isBot = isBot;
    _actor = 0; clearTimeout(_roundTimer);

    [1, 2].forEach(pi => {
        document.getElementById(`mm-source-${pi}`).style.display  = 'none';
        document.getElementById(`mm-options-${pi}`).style.display = 'none';
        document.getElementById(`mm-score-${pi}`).style.display   = 'block';
        document.getElementById(`mm-score-${pi}`).textContent     = '0 wins';
    });

    document.getElementById('mg-neutral').textContent = 'TAP THE MIRROR IMAGE!';
    _startRound();
}

function _makeGrid(container, highlighted, clickable, onTap) {
    container.innerHTML = '';
    for (let i = 0; i < CELLS; i++) {
        const cell = document.createElement('div');
        cell.className = 'mm-cell' + (highlighted.includes(i) ? ' mm-lit' : '');
        if (clickable) cell.addEventListener('pointerdown', () => onTap(i));
        container.appendChild(cell);
    }
}

function _startRound() {
    if (!state.mgActive || _done || _round >= MAX_ROUNDS) return;
    _round++;

    const observer = 1 - _actor;

    // Generate source pattern (3 + round cells)
    const numLit = 2 + _round;
    _source = [];
    while (_source.length < numLit) {
        const idx = Math.floor(Math.random() * CELLS);
        if (!_source.includes(idx)) _source.push(idx);
    }
    _source.sort((a, b) => a - b);
    _correct = _mirrorPattern(_source);

    // Build distractor options: shuffle individual cell positions slightly
    function makeDistractor() {
        let d;
        let tries = 0;
        do {
            d = _source.map(idx => {
                const candidates = Array.from({length: CELLS}, (_, i) => i).filter(i => !_source.includes(i) || Math.random() < 0.4);
                return candidates[Math.floor(Math.random() * candidates.length)] ?? idx;
            }).sort((a, b) => a - b);
            // Ensure unique per attempt
            tries++;
        } while (tries < 20 && d.join() === _correct.join());
        return d;
    }
    const opts = [_correct, makeDistractor(), makeDistractor()].sort(() => Math.random() - 0.5);
    const correctOptIdx = opts.findIndex(o => o.join() === _correct.join());

    // Show source to observer
    const srcEl = document.getElementById(`mm-source-${observer + 1}`);
    srcEl.style.display = 'grid';
    _makeGrid(srcEl, _source, false, null);

    // Show options to actor
    const optEl = document.getElementById(`mm-options-${_actor + 1}`);
    optEl.style.display = 'flex';
    optEl.innerHTML = '';
    opts.forEach((pattern, oi) => {
        const btn = document.createElement('div');
        btn.className = 'mm-opt-grid';
        for (let i = 0; i < CELLS; i++) {
            const cell = document.createElement('div');
            cell.className = 'mm-cell' + (pattern.includes(i) ? ' mm-lit' : '');
            btn.appendChild(cell);
        }
        btn.addEventListener('pointerdown', () => _tap(oi === correctOptIdx));
        optEl.appendChild(btn);
    });

    document.getElementById('mg-neutral').textContent = `ROUND ${_round} — P${_actor + 1}: FIND THE MIRROR!`;

    clearTimeout(_roundTimer);
    _roundTimer = setTimeout(() => { if (state.mgActive && !_done) _tap(false); }, ROUND_MS);

    if (_isBot && _actor === 1) {
        setTimeout(() => { if (state.mgActive && !_done) _tap(Math.random() < 0.7); }, 900 + Math.random() * 1200);
    }
}

function _tap(correct) {
    if (_done) return;
    clearTimeout(_roundTimer);

    if (correct) {
        sfx('coin_gain');
        _wins[_actor]++;
        document.getElementById(`mm-score-${_actor + 1}`).textContent = `${_wins[_actor]} wins`;
        document.getElementById('mg-neutral').textContent = `✓ P${_actor + 1} CORRECT!`;
    } else {
        sfx('land_bad');
        document.getElementById('mg-neutral').textContent = `✗ P${_actor + 1} WRONG / TIMEOUT!`;
    }

    // Swap actor
    _actor = 1 - _actor;
    [1, 2].forEach(pi => {
        document.getElementById(`mm-source-${pi}`).style.display  = 'none';
        document.getElementById(`mm-options-${pi}`).style.display = 'none';
    });

    if (_round >= MAX_ROUNDS) {
        _done = true; state.mgActive = false;
        const winner = _wins[0] > _wins[1] ? 0 : _wins[1] > _wins[0] ? 1 : -1;
        setTimeout(() => _onWin(winner), 800);
    } else {
        setTimeout(_startRound, 1200);
    }
}
