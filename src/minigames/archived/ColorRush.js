// Stroop-effect race: a word appears with a mismatched ink color.
// Tap your zone ONLY when the word text matches its ink color.
// First player to 5 correct taps wins the round. Best of 3 rounds.
// Wrong tap = -1 point (floor 0). Tie after 25 words = whoever has more points wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const COLORS = [
    { name: 'RED',    hex: '#ef4444' },
    { name: 'BLUE',   hex: '#3b82f6' },
    { name: 'GREEN',  hex: '#4ade80' },
    { name: 'YELLOW', hex: '#fbbf24' },
    { name: 'PURPLE', hex: '#a855f7' },
];
const WIN_PTS  = 5;   // correct taps to win a round
const MAX_WINS = 2;   // best of 3
const WORD_MS  = 950;
const MAX_WORDS = 25; // tiebreaker: after 25 words whoever leads wins the round

let _done = false, _roundDone = false, _onWin = null, _isBot = false;
let _wins = [0, 0], _pts = [0, 0];
let _seq = 0, _wordSeq = 0, _wordIsMatch = false, _tapped = [false, false];
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _wins = [0, 0];
    _cleanups.forEach(f => f()); _cleanups.length = 0;

    [1, 2].forEach(pi => {
        const pid = pi - 1;
        document.getElementById(`cr-word-${pi}`).style.display = 'block';
        document.getElementById(`cr-word-${pi}`).textContent  = '';
        document.getElementById(`cr-score-${pi}`).style.display = 'block';
        const tap = document.getElementById(`cr-tap-${pi}`);
        tap.style.display = 'flex';
        tap.className = 'cr-tap-zone';
        const handler = () => _onTap(pid);
        tap.addEventListener('pointerdown', handler);
        _cleanups.push(() => tap.removeEventListener('pointerdown', handler));
    });

    _startRound();
}

function _startRound() {
    if (!state.mgActive || _done) return;
    _roundDone = false;
    _pts = [0, 0];
    _seq++;
    _wordSeq = 0;
    _tapped[0] = false; _tapped[1] = false;

    [1, 2].forEach(pi => {
        document.getElementById(`cr-score-${pi}`).textContent = '0';
        document.getElementById(`cr-tap-${pi}`).className = 'cr-tap-zone';
    });

    document.getElementById('mg-neutral').textContent =
        `P1 ${_wins[0]} — P2 ${_wins[1]}  ·  FIRST TO ${WIN_PTS} CORRECT TAPS!`;

    _nextWord();
}

function _nextWord() {
    if (_done || _roundDone) return;
    const mySeq = _seq;
    _tapped[0] = false; _tapped[1] = false;
    _wordSeq++;

    const wordColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    const isMatch   = Math.random() < 0.4;
    const ink       = isMatch
        ? wordColor
        : COLORS.filter(c => c.name !== wordColor.name)[Math.floor(Math.random() * (COLORS.length - 1))];
    _wordIsMatch = isMatch;

    [1, 2].forEach(pi => {
        const el = document.getElementById(`cr-word-${pi}`);
        el.textContent = wordColor.name;
        el.style.color = ink.hex;
        document.getElementById(`cr-tap-${pi}`).className = 'cr-tap-zone';
    });

    if (_isBot && isMatch) {
        setTimeout(() => {
            if (state.mgActive && !_done && !_roundDone && _seq === mySeq) _onTap(1);
        }, 160 + Math.random() * 320);
    }

    setTimeout(() => {
        if (!_done && !_roundDone && _seq === mySeq) {
            if (_wordSeq >= MAX_WORDS) {
                _endRound();
            } else {
                _nextWord();
            }
        }
    }, WORD_MS);
}

function _onTap(pid) {
    if (_done || _roundDone || _tapped[pid]) return;
    _tapped[pid] = true;

    if (_wordIsMatch) {
        _pts[pid]++;
        sfx('land_good');
        document.getElementById(`cr-tap-${pid + 1}`).classList.add('cr-correct');
    } else {
        _pts[pid] = Math.max(0, _pts[pid] - 1);
        sfx('land_bad');
        document.getElementById(`cr-tap-${pid + 1}`).classList.add('cr-wrong');
    }
    document.getElementById(`cr-score-${pid + 1}`).textContent = `${_pts[pid]}`;

    // Check if this player just hit the win threshold
    if (_pts[pid] >= WIN_PTS) _endRound();
}

function _endRound() {
    if (_roundDone || _done) return;
    _roundDone = true;

    const roundWinner = _pts[0] > _pts[1] ? 0 : _pts[1] > _pts[0] ? 1 : -1;
    if (roundWinner >= 0) _wins[roundWinner]++;

    document.getElementById('mg-neutral').textContent =
        roundWinner >= 0
            ? `P${roundWinner + 1} WINS THE ROUND!  ${_wins[0]}–${_wins[1]}`
            : `ROUND TIE!  ${_wins[0]}–${_wins[1]}`;
    sfx(roundWinner >= 0 ? 'coin_gain' : 'land_good');

    const need = MAX_WINS;
    if (_wins[0] >= need || _wins[1] >= need) {
        _done = true; state.mgActive = false;
        _cleanups.forEach(f => f()); _cleanups.length = 0;
        const winner = _wins[0] > _wins[1] ? 0 : _wins[1] > _wins[0] ? 1 : -1;
        setTimeout(() => _onWin(winner), 1000);
    } else {
        setTimeout(_startRound, 1800);
    }
}

