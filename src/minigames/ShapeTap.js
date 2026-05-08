// Race game: a target shape is announced, both players must find it in their 6-cell grid.
// First to tap the correct shape wins the round. First to 2 wins.
// Uses large Unicode symbols so every shape always renders.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const SHAPES = [
    { key: 'circle',   icon: '⬤',  label: 'CIRCLE'   },
    { key: 'square',   icon: '■',   label: 'SQUARE'   },
    { key: 'triangle', icon: '▲',   label: 'TRIANGLE' },
    { key: 'diamond',  icon: '◆',   label: 'DIAMOND'  },
    { key: 'star',     icon: '★',   label: 'STAR'     },
    { key: 'cross',    icon: '✚',   label: 'CROSS'    },
    { key: 'heart',    icon: '♥',   label: 'HEART'    },
    { key: 'lightning',icon: '⚡',  label: 'LIGHTNING'},
];

const GRID_SIZE = 6;
const MAX_WINS  = 2; // best of 3

const SHAPE_COLORS = ['#ef4444','#3b82f6','#4ade80','#f59e0b','#a855f7','#ec4899','#06b6d4','#f97316'];

let _done = false, _roundActive = false, _wins = [0, 0], _target = null, _onWin = null, _isBot = false;

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _onWin = onWin; _isBot = isBot;
    _done = false; _wins = [0, 0];
    [1, 2].forEach(i => {
        document.getElementById(`shape-label-${i}`).style.display = 'block';
        document.getElementById(`shape-grid-${i}`).style.display = 'grid';
    });
    _nextRound();
}

function _nextRound() {
    if (!state.mgActive || _done) return;
    _roundActive = true;

    // Pick 6 distinct shapes; target is one of them
    const pool = [...SHAPES].sort(() => Math.random() - 0.5).slice(0, GRID_SIZE);
    _target = pool[Math.floor(Math.random() * GRID_SIZE)];

    document.getElementById('mg-neutral').textContent =
        `P1 ${_wins[0]} — P2 ${_wins[1]}  ·  FIND: ${_target.label} ${_target.icon}`;

    [1, 2].forEach(pi => {
        document.getElementById(`shape-label-${pi}`).textContent =
            `FIND: ${_target.label}`;
        const g = document.getElementById(`shape-grid-${pi}`);
        g.innerHTML = '';
        // Shuffle the pool for each player independently
        [...pool].sort(() => Math.random() - 0.5).forEach((shape, si) => {
            const col = SHAPE_COLORS[SHAPES.indexOf(shape) % SHAPE_COLORS.length];
            const cell = document.createElement('div');
            cell.className = 'shape-cell';
            const icon = document.createElement('span');
            icon.className = 'shape-icon';
            icon.textContent = shape.icon;
            icon.style.color = col;
            cell.appendChild(icon);
            cell.addEventListener('pointerdown', () => _tap(pi - 1, shape.key, cell));
            g.appendChild(cell);
        });
    });

    if (_isBot) {
        setTimeout(() => {
            if (state.mgActive && !_done && _roundActive) _tap(1, _target.key, null);
        }, 500 + Math.random() * 900);
    }
}

function _tap(pid, shapeKey, tapCell) {
    if (!state.mgActive || _done || !_roundActive) return;
    _roundActive = false;
    const correct = shapeKey === _target.key;
    const roundWinner = correct ? pid : (pid === 0 ? 1 : 0);
    _wins[roundWinner]++;

    // Highlight correct cell in tapper's grid
    [...document.getElementById(`shape-grid-${pid + 1}`).children].forEach(cell => {
        const icon = cell.querySelector('.shape-icon');
        if (icon && icon.textContent === _target.icon) {
            cell.classList.add('correct-shape');
        } else if (cell === tapCell && !correct) {
            cell.classList.add('wrong-shape');
        }
    });

    document.getElementById('mg-neutral').textContent =
        correct
            ? `✓ P${pid + 1} CORRECT!  ${_wins[0]}–${_wins[1]}`
            : `✗ P${pid + 1} WRONG!  ${_wins[0]}–${_wins[1]}`;
    sfx(correct ? 'coin_gain' : 'land_bad');

    if (_wins[roundWinner] >= MAX_WINS) {
        _done = true; state.mgActive = false;
        setTimeout(() => _onWin(roundWinner), 900);
    } else {
        setTimeout(_nextRound, 1300);
    }
}
