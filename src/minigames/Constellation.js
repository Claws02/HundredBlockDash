// Best of 3. Both players race to tap their randomized star map in order 1→5.
// First to finish the constellation wins the round; loser's round ends immediately.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';
import { getBotTraceIntervalRef } from './MinigameManager.js';

const NODE_COUNT = 5;
const MAX_WINS   = 2; // best of 3
const MIN_DIST   = 22; // % minimum distance between stars

let _traceState = [], _onWin = null, _isBot = false;
let _wins = [0, 0], _done = false, _positions = [], _botInt = null;

function _randomPositions() {
    const pts = [];
    let tries = 0;
    while (pts.length < NODE_COUNT && tries < 600) {
        tries++;
        const x = 14 + Math.random() * 72;
        const y = 14 + Math.random() * 72;
        if (!pts.some(([px, py]) => Math.hypot(px - x, py - y) < MIN_DIST)) pts.push([x, y]);
    }
    return pts;
}

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _onWin = onWin; _isBot = isBot;
    _wins = [0, 0]; _done = false;
    _startRound();
}

function _startRound() {
    if (!state.mgActive || _done) return;
    _traceState = [{ next: 0, done: false }, { next: 0, done: false }];
    _positions = _randomPositions();
    _render();
    document.getElementById('mg-neutral').textContent =
        `P1 ${_wins[0]} — P2 ${_wins[1]}  ·  TAP STARS IN ORDER!`;
    sfx('countdown');

    if (_isBot) {
        let n = 0;
        clearInterval(_botInt);
        _botInt = setInterval(() => {
            if (!state.mgActive || _done || _traceState[1].done) { clearInterval(_botInt); _botInt = null; return; }
            _tap(1, n++);
            if (n >= NODE_COUNT) { clearInterval(_botInt); _botInt = null; }
        }, 480 + Math.random() * 160);
        getBotTraceIntervalRef().set(_botInt);
    }
}

function _render() {
    [1, 2].forEach(pi => {
        const c = document.getElementById(`trace-c-${pi}`);
        c.style.display = 'block'; c.innerHTML = '';

        // SVG guide lines between consecutive nodes
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
        for (let i = 1; i < NODE_COUNT; i++) {
            const [x1, y1] = _positions[i - 1], [x2, y2] = _positions[i];
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', `${x1}%`); line.setAttribute('y1', `${y1}%`);
            line.setAttribute('x2', `${x2}%`); line.setAttribute('y2', `${y2}%`);
            line.setAttribute('stroke', 'rgba(255,255,255,0.12)');
            line.setAttribute('stroke-width', '1.5');
            line.setAttribute('stroke-dasharray', '5 4');
            svg.appendChild(line);
        }
        c.appendChild(svg);

        // Star nodes
        _positions.forEach((pos, i) => {
            const node = document.createElement('div');
            node.className = 'trace-node' + (i === 0 ? ' next' : '');
            node.style.cssText = `left:${pos[0]}%;top:${pos[1]}%;transform:translate(-50%,-50%);`;
            node.textContent = i + 1;
            node.dataset.idx = i;
            node.addEventListener('pointerdown', e => { e.stopPropagation(); _tap(pi - 1, i); });
            c.appendChild(node);
        });
    });
}

function _tap(pid, idx) {
    if (!state.mgActive || _done || _traceState[pid].done) return;
    if (idx !== _traceState[pid].next) return; // wrong order — ignore
    _traceState[pid].next++;

    const c = document.getElementById(`trace-c-${pid + 1}`);
    const nodes = [...c.querySelectorAll('.trace-node')];
    nodes[idx].classList.remove('next'); nodes[idx].classList.add('done');

    if (_traceState[pid].next < NODE_COUNT) {
        nodes[_traceState[pid].next].classList.add('next');
    } else {
        // This player finished — they win the round
        _traceState[pid].done = true;
        _traceState[1 - pid].done = true; // close out the other player too
        clearInterval(_botInt); _botInt = null;
        _wins[pid]++;
        document.getElementById('mg-neutral').textContent =
            `P${pid + 1} FINISHES!  ${_wins[0]}–${_wins[1]}`;
        sfx('coin_gain');
        if (_wins[pid] >= MAX_WINS) {
            _done = true; state.mgActive = false;
            setTimeout(() => _onWin(pid), 900);
        } else {
            setTimeout(_startRound, 1600);
        }
    }
}

export function destroy() {
    clearInterval(_botInt); _botInt = null;
    _done = true;
}
