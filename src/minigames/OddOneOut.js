// Race game: both players see 4 items; tap the odd one out first.
// First to 2 correct wins. First tap (right or wrong) ends the round.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const OOO_SETS = [
    // Animals / nature
    { items: ['Dog', 'Cat', 'Bird', 'Hammer'],           odd: 'Hammer',    cat: 'Animals' },
    { items: ['Shark', 'Whale', 'Eagle', 'Dolphin'],     odd: 'Eagle',     cat: 'Sea creatures' },
    { items: ['Oak', 'Pine', 'Rose', 'Maple'],           odd: 'Rose',      cat: 'Trees' },
    { items: ['Lion', 'Tiger', 'Cobra', 'Leopard'],      odd: 'Cobra',     cat: 'Big cats' },
    { items: ['Salmon', 'Trout', 'Tuna', 'Frog'],        odd: 'Frog',      cat: 'Fish' },
    // Food & drink
    { items: ['Apple', 'Mango', 'Pizza', 'Banana'],      odd: 'Pizza',     cat: 'Fruits' },
    { items: ['Milk', 'Juice', 'Bread', 'Water'],        odd: 'Bread',     cat: 'Drinks' },
    { items: ['Salt', 'Pepper', 'Sugar', 'Lemon'],       odd: 'Lemon',     cat: 'Dry seasonings' },
    { items: ['Egg', 'Bacon', 'Toast', 'Soup'],          odd: 'Soup',      cat: 'Breakfast foods' },
    // Math & numbers
    { items: ['2', '4', '7', '8'],                       odd: '7',         cat: 'Even numbers' },
    { items: ['3', '6', '9', '10'],                      odd: '10',        cat: 'Multiples of 3' },
    { items: ['4', '9', '16', '18'],                     odd: '18',        cat: 'Perfect squares' },
    { items: ['5', '11', '13', '15'],                    odd: '15',        cat: 'Prime numbers' },
    { items: ['100', '64', '49', '30'],                  odd: '30',        cat: 'Perfect squares' },
    // Language / words
    { items: ['Run', 'Jump', 'Sleep', 'Swim'],           odd: 'Sleep',     cat: 'Exercise' },
    { items: ['Happy', 'Sad', 'Angry', 'Fast'],          odd: 'Fast',      cat: 'Emotions' },
    { items: ['Whisper', 'Shout', 'Chair', 'Sing'],      odd: 'Chair',     cat: 'Things you do with your voice' },
    // Geography
    { items: ['Paris', 'Rome', 'London', 'River'],       odd: 'River',     cat: 'Capital cities' },
    { items: ['France', 'Japan', 'Pizza', 'Brazil'],     odd: 'Pizza',     cat: 'Countries' },
    { items: ['Atlantic', 'Pacific', 'Amazon', 'Indian'],odd: 'Amazon',    cat: 'Oceans' },
    { items: ['Tokyo', 'Cairo', 'Everest', 'Sydney'],    odd: 'Everest',   cat: 'Cities' },
    // Science
    { items: ['Oxygen', 'Gold', 'Silver', 'Rain'],       odd: 'Rain',      cat: 'Chemical elements' },
    { items: ['Venus', 'Mars', 'Moon', 'Saturn'],        odd: 'Moon',      cat: 'Planets' },
    { items: ['Volcano', 'Earthquake', 'Hurricane', 'Compass'], odd: 'Compass', cat: 'Natural disasters' },
    // Pop culture / misc
    { items: ['Guitar', 'Piano', 'Trumpet', 'Brush'],    odd: 'Brush',     cat: 'Instruments' },
    { items: ['Tesla', 'Ford', 'Ferrari', 'Apple'],      odd: 'Apple',     cat: 'Car brands' },
    { items: ['Soccer', 'Tennis', 'Chess', 'Basketball'],odd: 'Chess',     cat: 'Ball sports' },
    { items: ['Python', 'Java', 'Cobra', 'Swift'],       odd: 'Cobra',     cat: 'Programming languages' },
    { items: ['Circle', 'Square', 'Triangle', 'Red'],    odd: 'Red',       cat: 'Shapes' },
    { items: ['Nitrogen', 'Carbon', 'Helium', 'Bread'],  odd: 'Bread',     cat: 'Gases' },
];

const MAX_WINS = 2; // best of 3

let _done = false, _roundDone = false, _wins = [0, 0], _currentOdd = '', _onWin = null, _isBot = false;
let _usedSets = new Set();

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _onWin = onWin; _isBot = isBot;
    _done = false; _wins = [0, 0]; _usedSets.clear();
    [1, 2].forEach(i => {
        document.getElementById(`ooo-label-${i}`).style.display = 'block';
        document.getElementById(`ooo-grid-${i}`).style.display = 'grid';
    });
    _nextRound();
}

function _pickSet() {
    if (_usedSets.size >= OOO_SETS.length) _usedSets.clear();
    let idx;
    do { idx = Math.floor(Math.random() * OOO_SETS.length); } while (_usedSets.has(idx));
    _usedSets.add(idx);
    return OOO_SETS[idx];
}

function _nextRound() {
    if (!state.mgActive || _done) return;
    _roundDone = false;
    const set = _pickSet();
    _currentOdd = set.odd;
    document.getElementById('mg-neutral').textContent =
        `P1 ${_wins[0]} — P2 ${_wins[1]}  ·  FIND THE ODD ONE OUT!`;
    [1, 2].forEach(pi => {
        document.getElementById(`ooo-label-${pi}`).textContent = `NOT A ${set.cat.toUpperCase()}?`;
        const g = document.getElementById(`ooo-grid-${pi}`); g.innerHTML = '';
        [...set.items].sort(() => Math.random() - 0.5).forEach(item => {
            const btn = document.createElement('button'); btn.className = 'ooo-btn'; btn.textContent = item;
            btn.addEventListener('pointerdown', () => _tap(pi - 1, item));
            g.appendChild(btn);
        });
    });
    if (_isBot) setTimeout(() => { if (state.mgActive && !_done && !_roundDone) _tap(1, _currentOdd); }, 1000 + Math.random() * 2000);
}

function _tap(pid, item) {
    if (!state.mgActive || _done || _roundDone) return;
    _roundDone = true;
    const correct = item === _currentOdd;
    const roundWinner = correct ? pid : (pid === 0 ? 1 : 0);
    _wins[roundWinner]++;

    // Highlight correct answer in tapper's grid
    [...document.querySelectorAll(`#ooo-grid-${pid + 1} .ooo-btn`)].forEach(b => {
        if (b.textContent === _currentOdd) b.classList.add('ooo-correct');
        else if (b.textContent === item && !correct) b.classList.add('ooo-wrong');
    });
    document.getElementById('mg-neutral').textContent =
        correct
            ? `✓ P${pid + 1} CORRECT!  ${_wins[0]}–${_wins[1]}`
            : `✗ P${pid + 1} WRONG!  ${_wins[0]}–${_wins[1]}`;
    sfx(correct ? 'coin_gain' : 'land_bad');

    if (_wins[roundWinner] >= MAX_WINS) {
        _done = true; state.mgActive = false;
        setTimeout(() => _onWin(roundWinner), 1000);
    } else {
        setTimeout(_nextRound, 1400);
    }
}
