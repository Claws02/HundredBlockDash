// Best of 5 rounds. Each round the sequence grows by 1 (starts at 3).
// First player to correctly repeat their sequence wins the round.
// If a color appears twice in a row, the light pulses with a "double" ring.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const SEQ_COLORS = [
    { name: 'RED',    hex: '#ef4444', symbol: 'I' },
    { name: 'BLUE',   hex: '#3b82f6', symbol: 'II' },
    { name: 'GREEN',  hex: '#4ade80', symbol: 'III' },
    { name: 'YELLOW', hex: '#fbbf24', symbol: 'IV' },
];
const MAX_ROUNDS = 5;
const MAX_WINS   = 3; // best of 5

let _pattern = [], _done = false, _roundDone = false, _input = [[], []];
let _onWin = null, _isBot = false, _wins = [0, 0], _round = 0;

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _onWin = onWin; _isBot = isBot;
    _done = false; _wins = [0, 0]; _round = 0;

    [1, 2].forEach(pi => {
        const d = document.getElementById(`seq-display-${pi}`);
        d.style.display = 'flex'; d.innerHTML = '';
        const b = document.getElementById(`seq-btns-${pi}`);
        b.style.display = 'flex'; b.innerHTML = '';
        SEQ_COLORS.forEach((c, ci) => {
            const light = document.createElement('div');
            light.className = 'seq-light';
            light.style.cssText = `background:${c.hex}33;border:2px solid ${c.hex};`;
            d.appendChild(light);
            const btn = document.createElement('button');
            btn.className = 'seq-btn bfont';
            btn.style.cssText = `background:${c.hex};border-color:${c.hex};color:#000;`;
            btn.textContent = c.name[0]; // R B G Y initial letter
            btn.dataset.symbol = c.symbol;
            btn.title = c.name;
            btn.setAttribute('aria-label', c.name);
            btn.addEventListener('pointerdown', e => { e.preventDefault(); _tap(pi - 1, ci); });
            b.appendChild(btn);
        });
    });

    _startRound();
}

function _startRound() {
    if (!state.mgActive || _done) return;
    _round++; _roundDone = false; _input = [[], []];
    const seqLen = 2 + _round; // 3, 4, 5, 6, 7

    // Fresh pattern each round
    _pattern = Array.from({ length: seqLen }, () => Math.floor(Math.random() * 4));

    document.getElementById('mg-neutral').textContent =
        `ROUND ${_round}/${MAX_ROUNDS} — WATCH!  P1:${_wins[0]} P2:${_wins[1]}`;
    sfx('countdown');

    let i = 0;
    const showIv = setInterval(() => {
        [1, 2].forEach(pi => {
            const lights = [...document.getElementById(`seq-display-${pi}`).children];
            lights.forEach(l => l.classList.remove('lit', 'seq-double'));
            if (i < _pattern.length) {
                const l = lights[_pattern[i]];
                l.classList.add('lit');
                // Same color as previous step — add double-pulse indicator
                if (i > 0 && _pattern[i] === _pattern[i - 1]) l.classList.add('seq-double');
            }
        });
        if (i < _pattern.length) sfx('seq_lit');
        i++;
        if (i > _pattern.length) {
            clearInterval(showIv);
            setTimeout(() => {
                [1, 2].forEach(pi =>
                    [...document.getElementById(`seq-display-${pi}`).children]
                        .forEach(l => l.classList.remove('lit', 'seq-double'))
                );
                document.getElementById('mg-neutral').textContent =
                    `REPEAT THE ${seqLen}-STEP SEQUENCE!`;
            }, 500);
        }
    }, 750);

    if (_isBot) {
        const botDelay = seqLen * 750 + 1000;
        setTimeout(() => {
            _pattern.forEach((c, idx) => {
                setTimeout(() => { if (state.mgActive && !_done && !_roundDone) _tap(1, c); }, idx * 460);
            });
        }, botDelay);
    }
}

function _tap(pid, colorIdx) {
    if (!state.mgActive || _done || _roundDone) return;
    if (_input[pid].length >= _pattern.length) return;

    // Flash the pressed button
    const btns = [...document.querySelectorAll(`#seq-btns-${pid + 1} .seq-btn`)];
    if (btns[colorIdx]) {
        btns[colorIdx].classList.add('seq-pressed');
        setTimeout(() => btns[colorIdx].classList.remove('seq-pressed'), 180);
    }

    _input[pid].push(colorIdx);
    const step = _input[pid].length - 1;

    if (colorIdx !== _pattern[step]) {
        _roundDone = true;
        const roundWinner = pid === 0 ? 1 : 0;
        _wins[roundWinner]++;
        document.getElementById('mg-neutral').textContent =
            `P${pid + 1} WRONG STEP!  P1:${_wins[0]} P2:${_wins[1]}`;
        sfx('land_bad');
        _checkEnd(roundWinner);
        return;
    }

    if (_input[pid].length === _pattern.length) {
        _roundDone = true;
        _wins[pid]++;
        document.getElementById('mg-neutral').textContent =
            `P${pid + 1} CORRECT!  P1:${_wins[0]} P2:${_wins[1]}`;
        sfx('coin_gain');
        _checkEnd(pid);
    }
}

function _checkEnd(lastWinner) {
    if (_wins[lastWinner] >= MAX_WINS) {
        _done = true; state.mgActive = false;
        setTimeout(() => _onWin(lastWinner), 900);
    } else if (_round >= MAX_ROUNDS) {
        _done = true; state.mgActive = false;
        const winner = _wins[0] > _wins[1] ? 0 : _wins[1] > _wins[0] ? 1 : -1;
        setTimeout(() => _onWin(winner), 900);
    } else {
        setTimeout(_startRound, 1600);
    }
}
