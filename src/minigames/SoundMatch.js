// Listen to a High/Low tone sequence, then tap the matching pattern. Best of 5.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const SEQ_LEN   = 4;
const MAX_ROUNDS = 5;
const TONES     = { H: 880, L: 330 };

let _done = false, _round = 0, _wins = [0, 0], _onWin = null;
let _sequence = [], _roundActive = false, _isBot = false;
let _audioCtx = null, _roundTimer = null;

function _ctx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
}

function _playTone(freq, start, dur) {
    const ctx = _ctx();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.35, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.start(start); osc.stop(start + dur + 0.05);
}

function _playSequence(seq, onDone) {
    const ctx = _ctx();
    const t0  = ctx.currentTime + 0.15;
    seq.forEach((note, i) => _playTone(TONES[note], t0 + i * 0.52, 0.38));
    setTimeout(onDone, seq.length * 520 + 350);
}

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _round = 0; _wins = [0, 0]; _onWin = onWin; _isBot = isBot;
    _sequence = []; _roundActive = false;

    [1, 2].forEach(pi => {
        document.getElementById(`sm-options-${pi}`).style.display = 'grid';
        document.getElementById(`sm-score-${pi}`).style.display   = 'block';
        document.getElementById(`sm-score-${pi}`).textContent     = '0 wins';
    });

    document.getElementById('mg-neutral').textContent = 'LISTEN, THEN TAP THE PATTERN!';
    _nextRound();
}

function _nextRound() {
    if (!state.mgActive || _done) return;
    _round++;
    _roundActive = false;

    _sequence = Array.from({ length: SEQ_LEN }, () => Math.random() < 0.5 ? 'H' : 'L');

    // Build 4 options (1 correct, 3 wrong with unique patterns)
    const opts = [_sequence];
    while (opts.length < 4) {
        const w = Array.from({ length: SEQ_LEN }, () => Math.random() < 0.5 ? 'H' : 'L');
        if (!opts.some(o => o.join('') === w.join(''))) opts.push(w);
    }
    opts.sort(() => Math.random() - 0.5);
    const correctIdx = opts.findIndex(o => o.join('') === _sequence.join(''));

    [1, 2].forEach(pi => {
        const box = document.getElementById(`sm-options-${pi}`);
        box.innerHTML = '';
        opts.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'sm-opt-btn';
            btn.innerHTML = opt.map(n => `<span class="sm-note sm-note-${n.toLowerCase()}">${n}</span>`).join('');
            btn.addEventListener('pointerdown', () => _tap(pi - 1, i === correctIdx));
            box.appendChild(btn);
        });
    });

    document.getElementById('mg-neutral').textContent = `ROUND ${_round} — LISTEN…`;

    _playSequence(_sequence, () => {
        if (!state.mgActive || _done) return;
        _roundActive = true;
        document.getElementById('mg-neutral').textContent = 'WHICH PATTERN?';
        clearTimeout(_roundTimer);
        _roundTimer = setTimeout(() => {
            if (state.mgActive && !_done && _roundActive) {
                _roundActive = false;
                document.getElementById('mg-neutral').textContent = 'TIME\'S UP!';
                setTimeout(_nextRound, 800);
            }
        }, 5000);
        if (_isBot) {
            setTimeout(() => {
                if (state.mgActive && !_done && _roundActive) _tap(1, Math.random() < 0.65);
            }, 700 + Math.random() * 1400);
        }
    });
}

function _tap(pid, correct) {
    if (_done || !_roundActive) return;
    _roundActive = false;
    clearTimeout(_roundTimer);

    if (correct) {
        sfx('coin_gain');
        _wins[pid]++;
        document.getElementById(`sm-score-${pid + 1}`).textContent = `${_wins[pid]} wins`;
        document.getElementById('mg-neutral').textContent = `✓ P${pid + 1} WINS ROUND!`;
    } else {
        sfx('land_bad');
        document.getElementById('mg-neutral').textContent = `✗ P${pid + 1} WRONG!`;
    }

    const winsNeeded = Math.ceil(MAX_ROUNDS / 2);
    if (_wins[0] >= winsNeeded || _wins[1] >= winsNeeded || _round >= MAX_ROUNDS) {
        _done = true; state.mgActive = false;
        const winner = _wins[0] > _wins[1] ? 0 : _wins[1] > _wins[0] ? 1 : -1;
        setTimeout(() => _onWin(winner), 800);
    } else {
        setTimeout(_nextRound, 1400);
    }
}

export function destroy() {
    clearTimeout(_roundTimer); _roundTimer = null;
    _done = true;
    if (_audioCtx) { _audioCtx.close().catch(() => {}); _audioCtx = null; }
}
