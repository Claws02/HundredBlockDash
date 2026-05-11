// GRID RECALL — fixed version.
// Both players see the same 4×4 pattern during memorize, then tap from memory.
// Scoring: +1 per correct cell, -1 per wrong cell (floor 0). 3 rounds, most pts wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const GRID_SIZE   = 4;
const CELLS       = GRID_SIZE * GRID_SIZE;
const MEMORIZE_MS = 2500;
const RECALL_MS   = 9000;
const MAX_ROUNDS  = 3;

let _done = false, _round = 0, _scores = [0, 0], _onWin = null, _isBot = false;
let _pattern = [], _phase = 'idle', _memTimer = null, _recallTimer = null, _roundSeq = 0;
let _nextRoundTimer = null, _winTimer = null;

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _round = 0; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _pattern = []; _phase = 'idle'; _roundSeq = 0;
    clearTimeout(_memTimer); clearTimeout(_recallTimer);
    clearTimeout(_nextRoundTimer); clearTimeout(_winTimer);

    [1, 2].forEach(pi => {
        const grid = document.getElementById(`grid-recall-${pi}`);
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = `repeat(${GRID_SIZE}, 1fr)`;
        grid.style.gap = '4px';
        const score = document.getElementById(`grid-recall-score-${pi}`);
        score.style.display = 'block'; score.textContent = '0 pts';
    });

    document.getElementById('mg-neutral').textContent = 'MEMORIZE THE PATTERN!';
    _startRound();
}

function _buildCells(phase) {
    [1, 2].forEach(pi => {
        const grid = document.getElementById(`grid-recall-${pi}`);
        grid.innerHTML = '';
        for (let i = 0; i < CELLS; i++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.dataset.idx = i;
            if (phase === 'memorize') {
                if (_pattern.includes(i)) cell.classList.add('highlighted');
                cell.style.pointerEvents = 'none';
            } else if (phase === 'recall') {
                cell.style.pointerEvents = 'auto';
                const mySeq = _roundSeq; // capture for stale-check
                cell.addEventListener('pointerdown', () => {
                    if (_phase !== 'recall' || _done || _roundSeq !== mySeq) return;
                    cell.classList.toggle('player-selected');
                });
            }
            grid.appendChild(cell);
        }
    });
}

function _startRound() {
    if (!state.mgActive || _done || _round >= MAX_ROUNDS) return;
    _round++;
    _roundSeq++;
    _phase = 'memorize';
    clearTimeout(_memTimer); clearTimeout(_recallTimer);

    const numCells = 3 + _round * 2; // 5, 7, 9
    _pattern = [];
    while (_pattern.length < numCells) {
        const idx = Math.floor(Math.random() * CELLS);
        if (!_pattern.includes(idx)) _pattern.push(idx);
    }

    _buildCells('memorize');
    document.getElementById('mg-neutral').textContent =
        `ROUND ${_round}/${MAX_ROUNDS} — MEMORIZE ${numCells} CELLS!  P1:${_scores[0]} P2:${_scores[1]}`;
    sfx('countdown');

    const mySeq = _roundSeq;
    _memTimer = setTimeout(() => {
        if (!state.mgActive || _done || _roundSeq !== mySeq) return;
        _phase = 'recall';
        _buildCells('recall');
        document.getElementById('mg-neutral').textContent =
            `TAP THE CELLS YOU SAW! (${RECALL_MS / 1000}s)`;
        if (_isBot) _botRecall(mySeq);
        _recallTimer = setTimeout(() => {
            if (!state.mgActive || _done || _roundSeq !== mySeq) return;
            _scoreRound(mySeq);
        }, RECALL_MS);
    }, MEMORIZE_MS);
}

function _botRecall(seq) {
    const delay = 600 + Math.random() * 600;
    setTimeout(() => {
        if (!state.mgActive || _done || _phase !== 'recall' || _roundSeq !== seq) return;
        const cells = document.querySelectorAll('#grid-recall-2 .grid-cell');
        // Hit ~82% of correct cells
        _pattern.forEach(idx => { if (Math.random() < 0.82) cells[idx].classList.add('player-selected'); });
        // Occasional wrong tap
        if (Math.random() < 0.28) {
            let w;
            do { w = Math.floor(Math.random() * CELLS); } while (_pattern.includes(w));
            cells[w].classList.add('player-selected');
        }
        // Bot finishes early — trigger scoring once done
        setTimeout(() => {
            if (state.mgActive && !_done && _phase === 'recall' && _roundSeq === seq) _scoreRound(seq);
        }, 400);
    }, delay);
}

function _scoreRound(seq) {
    if (_done || _phase !== 'recall' || _roundSeq !== seq) return;
    clearTimeout(_recallTimer);
    _phase = 'scoring';

    [0, 1].forEach(pid => {
        const cells = document.querySelectorAll(`#grid-recall-${pid + 1} .grid-cell`);
        let pts = 0;
        cells.forEach(c => {
            const idx = parseInt(c.dataset.idx);
            const sel = c.classList.contains('player-selected');
            const inPat = _pattern.includes(idx);
            if (sel && inPat)   { pts++; c.classList.add('gr-correct'); }
            if (sel && !inPat)  { pts--; c.classList.add('gr-wrong'); }
            if (!sel && inPat)  { c.classList.add('gr-missed'); } // show missed cells
        });
        _scores[pid] += Math.max(0, pts);
        document.getElementById(`grid-recall-score-${pid + 1}`).textContent = `${_scores[pid]} pts`;
    });

    document.getElementById('mg-neutral').textContent =
        `ROUND ${_round} DONE  P1:${_scores[0]} P2:${_scores[1]}`;
    sfx('land_good');

    if (_round >= MAX_ROUNDS) {
        _done = true; state.mgActive = false;
        const winner = _scores[0] > _scores[1] ? 0 : _scores[1] > _scores[0] ? 1 : -1;
        const seq = _roundSeq;
        _winTimer = setTimeout(() => { if (_roundSeq === seq) _onWin(winner); }, 1200);
    } else {
        _nextRoundTimer = setTimeout(_startRound, 2200);
    }
}

export function destroy() {
    clearTimeout(_memTimer); clearTimeout(_recallTimer);
    clearTimeout(_nextRoundTimer); clearTimeout(_winTimer);
    _done = true;
}
