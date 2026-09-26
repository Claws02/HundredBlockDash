// Block Party — a call-and-response dance-off on the Shopping Promenade.
//
// A stage game, side-on. The street's shut for the party: a light-up floor,
// the DJ on the decks behind it, the whole promenade watching. Each phrase the
// DJ dances a few moves, one per beat — then it is your turn, both of you at
// once, the same moves on the next beats.
//
//   SWIPE UP      raise the roof        SWIPE LEFT / RIGHT   point that way
//   SWIPE DOWN    drop                  TAP                  clap
//
// On the beat is PERFECT, near it is GOOD, anything else — or the wrong move —
// is a MISS. A whole phrase without a miss is a FULL COMBO. The phrases get
// longer and faster, and the last two are danced from memory: the cue cards
// go dark once the DJ is done. Most points after the last phrase wins.
//
// THE HOLD
//   SIDE-ON, like High Noon: P1 is the right-hand dancer and the right half
//   of the screen, P2 the left.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, sideHud, touch, effects } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const PHRASES = [
    { n: 4, bpm: 96,  pool: 4 },
    { n: 4, bpm: 104, pool: 4 },
    { n: 5, bpm: 110, pool: 5 },
    { n: 6, bpm: 116, pool: 5 },
    { n: 6, bpm: 120, pool: 5, hide: true },
    { n: 7, bpm: 126, pool: 5, hide: true },
];
const LEAD_IN   = 2;            // beats before the DJ starts
const TALLY     = 1;            // beats after the last response
const PERFECT   = 0.075, GOOD = 0.16;     // s either side of the beat
const PTS       = { perfect: 3, good: 2, miss: 0 };
const COMBO_PTS = 2;
const TAP_PX    = 16;
const FIG_SCALE = 1.05;
const X         = [1.9, -1.9];  // P1 on the right

const MOVES = ['raise', 'drop', 'pointL', 'pointR', 'clap'];
const GLYPH = { raise: '⬆', drop: '⬇', pointL: '⬅', pointR: '➡', clap: '👏' };
const JUDGE_CSS = { perfect: '#ffd12d', good: '#34f5a0', miss: '#ff4f6a' };

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _figs = [], _dj = null, _bot = [];
let _plan = [], _ph = -1, _S = 0;              // phrase index and its start beat
let _beat = 0, _bpm = 96, _lastBeat = -1;
let _score = [0, 0], _resp = [[], []], _clean = [true, true], _danced = [0, 0];
let _phase = 'intro', _t = 0, _stageOf = '';
let _dirOwns = false, _cards = null, _lastIn = null, _hold = false, _pops = [], _rings = [];

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _hold = false;
    _score = [0, 0]; _phase = 'intro'; _t = 0; _beat = 0; _bpm = PHRASES[0].bpm; _lastBeat = -1; _ph = -1; _stageOf = '';
    _bot = [0, 1].map(() => ({ queue: [] }));
    _plan = PHRASES.map(p => {
        const moves = [];
        for (let i = 0; i < p.n; i++) {
            let m;
            do m = MOVES[Math.floor(Math.random() * p.pool)]; while (i > 0 && m === moves[i - 1] && Math.random() < 0.7);
            moves.push(m);
        }
        return { ...p, moves };
    });
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#6a3fa0;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'side', fov: 34, background: 0x6a3fa0 });
    _hud = sideHud(_stage, { padWidth: 250 });
    _in = touch(_stage, { split: 'x', floating: false, stick: 40, tapPx: TAP_PX, tapMs: 260,
                          onDown: slot => { _in.seat(slot).downBeat = _beat; _in.seat(slot).swiped = false; },
                          onTap: slot => _input(slot, 'clap', _in.seat(slot).downBeat ?? _beat),
                          // A flick can start and end between two frames: catch it here.
                          onRelease: (slot, r) => { const s = _in.seat(slot); if (r.moved && !s.swiped) { s.swiped = true; _swiped(slot, r.dx, r.dy, s.downBeat); } } });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _set = STAGE_SETS.shop(_stage);
        _dj = _stage.figure('bunny', 0xa855f7);
        _dj.rig.root.scale.setScalar(1.15);
        _dj.rig.root.position.set(0, 1.0, -4.35);
        _dj.anim.play('groove', { rate: _bpm / 60 });
        const phones = new THREE.Mesh(new THREE.TorusGeometry(0.42 * _dj.rig.H, 0.05, 6, 18, Math.PI), new THREE.MeshStandardMaterial({ color: 0x121018, roughness: 0.4 }));
        phones.position.y = _dj.rig.H * 0.95;
        _dj.rig.root.add(phones);
    }
    _figs = [0, 1].map(slot => {
        const f = { slot };
        if (_stage.gl) {
            const c = _stage.character(slot);
            c.rig.root.scale.setScalar(FIG_SCALE);
            c.rig.root.position.set(X[slot], 0.17, 0.5);
            c.anim.face(0, true);
            c.anim.play('groove', { rate: _bpm / 60 });
            Object.assign(f, { rig: c.rig, anim: c.anim });
        }
        return f;
    });
    // A ring on the floor under each dancer: flashes green on a hit, red on a miss.
    _rings = [0, 1].map(slot => {
        if (!_stage.gl) return null;
        const m = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.92, 36),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        m.rotation.x = -Math.PI / 2; m.position.set(X[slot], 0.2, 0.5);
        _stage.add(m);
        return m;
    });
    _buildCards();
    _buildPops();
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'SWIPE ⬆⬇⬅➡ · TAP 👏'));

    _dir.open({
        place: 'SHOPPING PROMENADE · GOLDEN HOUR', title: 'BLOCK PARTY',
        sub: 'COPY THE DJ',
        from: { pos: [9, 7, 16], look: [0, 1.5, -3] },
        to: _playCam(),
        onDone: () => { if (!_done) { _phase = 'dance'; _nextPhrase(); } },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _dj = null; _set = null; _dir = null; _hud = null; _in = null; _fx = null; _cards = null; _pops = []; _rings = [];
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

function _playCam() { return { pos: [0, 3.2, 9.4], look: [0, 1.6, -1.2] }; }

// ── Phrases ──────────────────────────────────────────────────────────────────
function _nextPhrase() {
    _ph++;
    if (_ph >= _plan.length) { _end(); return; }
    const p = _plan[_ph];
    _S = _ph === 0 ? _beat : _S + LEAD_IN + _plan[_ph - 1].n * 2 + TALLY;
    _bpm = p.bpm;
    _resp = [0, 1].map(() => p.moves.map(() => null));
    _clean = [true, true]; _danced = [0, 0];
    _bot.forEach(b => { b.queue = []; });
    _layCards(p);
    _hud.say(p.hide ? 'FROM MEMORY!' : `PHRASE ${_ph + 1}`, p.hide ? 'THE CARDS GO DARK' : 'WATCH THE DJ', LEAD_IN * 60 / _bpm * 1000, _t, p.hide ? '#ff4fa3' : '#ffd12d');
    _figs.forEach(f => f.anim?.play('groove', { rate: _bpm / 60 }));
    _dj?.anim.play('groove', { rate: _bpm / 60 });
}

// Where the music is inside the current phrase.
function _where() {
    const p = _plan[_ph];
    const local = _beat - _S;
    if (local < LEAD_IN) return { part: 'lead', i: Math.floor(local) };
    if (local < LEAD_IN + p.n) return { part: 'call', i: Math.floor(local - LEAD_IN) };
    if (local < LEAD_IN + p.n * 2) return { part: 'resp', i: Math.floor(local - LEAD_IN - p.n) };
    if (local < LEAD_IN + p.n * 2 + TALLY) return { part: 'tally', i: 0 };
    return { part: 'next', i: 0 };
}
const _respBeat = i => _S + LEAD_IN + _plan[_ph].n + i;

// A move from a seat at music position `at` (beats).
function _input(slot, move, at) {
    if (_phase !== 'dance' || _ph < 0) return;
    const f = _figs[slot];
    f.anim?.play(move, { restart: true });
    f.poseUntil = _beat + 0.45;
    const p = _plan[_ph];
    const i = Math.round(at - _respBeat(0));
    _lastIn = { at: +at.toFixed(2), i, b0: +_respBeat(0).toFixed(2), part: _where().part };
    if (i < 0 || i >= p.n || _resp[slot][i]) return;
    const off = Math.abs(at - _respBeat(i)) * 60 / _bpm;
    _danced[slot]++;
    const j = move !== p.moves[i] ? 'miss' : off <= PERFECT ? 'perfect' : off <= GOOD ? 'good' : 'miss';
    const why = move !== p.moves[i] ? 'WRONG MOVE' : j === 'miss' ? (at < _respBeat(i) ? 'TOO EARLY' : 'TOO LATE') : '';
    _judge(slot, i, j, why);
}

function _judge(slot, i, j, why = '') {
    _resp[slot][i] = j;
    _score[slot] += PTS[j];
    if (j === 'miss') _clean[slot] = false;
    const f = _figs[slot];
    _hud.hint(slot, `${j.toUpperCase()}!${why ? ' · ' + why : ''}`);
    _flash(slot, j);
    const want = _plan[_ph]?.moves[i];
    _pop(slot, j, why, why === 'WRONG MOVE' || why === 'NO MOVE' ? `IT WAS ${GLYPH[want] ?? ''}` : '');
    if (j === 'miss') { sfx('land_bad'); f.anim?.flinch(); }
    else {
        sfx('land_good'); haptic([j === 'perfect' ? 18 : 8]);
        if (_stage?.gl && j === 'perfect') _fx.confetti(new THREE.Vector3(X[slot], 1.8, 0.5), [seat(slot).color, 0xffd12d, 0xffffff], 8, 2);
    }
    _paintDots();
}

function _swiped(slot, dx, dy, at) {
    const move = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'pointL' : 'pointR') : (dy < 0 ? 'raise' : 'drop');
    _input(slot, move, at ?? _beat);
}

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// Queues the phrase back as soon as the DJ is done: each move right with a
// chance that rises with skill (and drops when the cards are dark), each one
// a little off the beat, by less the better it is.
function _botQueue(slot) {
    const p = _plan[_ph], b = _bot[slot];
    const right = 0.55 + _botSkill * 0.43 - (p.hide ? 0.08 : 0);
    const sd = (0.02 + (1 - _botSkill) * 0.11) * _bpm / 60;          // in beats
    b.queue = p.moves.map((m, i) => {
        const g = (Math.random() + Math.random() + Math.random() - 1.5) * 1.4;   // ≈ N(0, 0.7)
        const mv = Math.random() < right ? m : MOVES.filter(x => x !== m)[Math.floor(Math.random() * 4)];
        return { at: _respBeat(i) + g * sd, move: mv };
    });
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt;
    _hud.tick(_t);
    if (!_hold) _beat += dt * _bpm / 60;

    if (_phase === 'dance' && _ph >= 0) {
        const p = _plan[_ph], w = _where();
        const b = Math.floor(_beat - _S + 1e-6);
        if (b !== _lastBeat) {
            _lastBeat = b;
            // The beat, every beat.
            sfx(b % 2 === 0 ? 'kick' : 'hat');
            if (w.part === 'lead') sfx('countdown');
            if (w.part === 'call') {
                const m = p.moves[w.i];
                _dj?.anim.play(m, { restart: true });
                if (_dj) _dj.poseUntil = _beat + 0.55;
                sfx('seq_lit');
                _revealCard(w.i);
            }
            if (w.part === 'resp' && w.i === 0) {
                if (p.hide) _darkCards();
                [0, 1].forEach(s => { if (isBotSlot(s)) _botQueue(s); });
            }
            if (w.part === 'tally') _tally();
            if (w.part === 'next') {
                // The new phrase's first beat is this one: count it in now, once.
                _nextPhrase();
                _lastBeat = 0;
                if (_phase === 'dance') sfx('countdown');
            }
        }
        if (_phase === 'dance') {
            _highlight(w.part === 'resp' ? w.i : -1);
            _label(w.part);
            // Every card the DJ has danced is up, whatever the frame timing:
            // a missed beat tick must never leave a move off the top.
            if (w.part === 'call') for (let j = 0; j <= w.i; j++) _revealCard(j, false);
            else if (w.part === 'resp' && !p.hide) for (let j = 0; j < p.n; j++) _revealCard(j, false);
            // Swipes, read as soon as they are past the tap threshold.
            [0, 1].forEach(slot => {
                if (isBotSlot(slot)) return;
                const s = _in.seat(slot);
                if (!s.down || !s.moved || s.swiped) return;
                s.swiped = true;
                _swiped(slot, s.dx, s.dy, s.downBeat);
            });
            // Bots.
            _bot.forEach((bt, slot) => {
                while (bt.queue.length && bt.queue[0].at <= _beat) { const q = bt.queue.shift(); _input(slot, q.move, q.at); }
            });
            // Anything not danced by half a beat after its beat is a miss.
            if (_ph < _plan.length) {
                const pp = _plan[_ph];
                for (let i = 0; i < pp.n; i++) {
                    if (_beat < _respBeat(i) + 0.5) break;
                    [0, 1].forEach(slot => { if (!_resp[slot][i]) _judge(slot, i, 'miss', 'NO MOVE'); });
                }
            }
        }
    }

    // Back to the groove once a pose has been held.
    [..._figs, _dj].forEach(f => {
        if (!f?.anim) return;
        if (f.poseUntil && _beat > f.poseUntil && f.anim.state !== 'groove' && _phase !== 'over') { f.poseUntil = 0; f.anim.play('groove', { rate: _bpm / 60 }); }
    });

    // The judgement pops and the floor rings fade.
    _pops.forEach(e => { if (e.until && _t > e.until) { e.until = 0; e.box.style.opacity = '0'; e.box.style.transform = 'translate(-50%,-50%) scale(.8)'; } });
    _rings.forEach(r => { if (r) r.material.opacity = Math.max(0, r.material.opacity - dt * 1.8); });
    _set?.update(dt, _t, _beat);
    _fx?.update(dt);
    _dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!_dirOwns && _stage?.gl && _phase !== 'over') {
        const c = _playCam();
        // A nudge in on the one.
        const push = Math.exp(-((_beat % 1) * 6)) * 0.12;
        _stage.camera.position.set(c.pos[0], c.pos[1], c.pos[2] - push);
        _stage.camera.lookAt(...c.look);
        _stage.camera.userData.look = c.look;
    }
    _renderHud();
}

function _tally() {
    const p = _plan[_ph];
    // From-memory phrases: now show what the moves were.
    if (p.hide) _cards?.list.forEach((k, i) => { k.g.textContent = GLYPH[p.moves[i]]; k.g.style.opacity = '1'; });
    const msgs = [0, 1].map(slot => {
        if (_clean[slot]) { _score[slot] += COMBO_PTS; return 'FULL COMBO'; }
        return '';
    });
    const both = msgs[0] && msgs[1];
    if (msgs[0] || msgs[1]) {
        _hud.say(both ? 'DOUBLE FULL COMBO!' : `${seat(msgs[0] ? 0 : 1).name}: FULL COMBO!`, `+${COMBO_PTS}`, 60 / p.bpm * 1000 * TALLY, _t, '#ffd12d');
        sfx('coin_gain');
        [0, 1].forEach(s => { if (msgs[s]) { _figs[s].anim?.play('victory', { restart: true }); _figs[s].poseUntil = _beat + 0.9; } });
    }
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function _buildCards() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:50%;top:52px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;';
    const label = document.createElement('div');
    label.style.cssText = 'font-size:17px;letter-spacing:1px;padding:1px 12px;border-radius:10px;background:rgba(20,12,24,.62);color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.4);';
    wrap.append(row, label);
    _stage.hud.appendChild(wrap);
    _cards = { row: wrap, cardRow: row, label, list: [], part: '' };
}
function _label(part) {
    if (!_cards || _cards.part === part) return;
    _cards.part = part;
    const t = { lead: ['WATCH THE DJ…', '#ffd12d'], call: ['WATCH THE DJ…', '#ffd12d'], resp: ['YOUR TURN!', '#34f5a0'], tally: ['', ''] }[part] || ['', ''];
    _cards.label.textContent = t[0]; _cards.label.style.color = t[1];
    _cards.label.style.display = t[0] ? '' : 'none';
}
function _layCards(p) {
    if (!_cards) return;
    _cards.cardRow.innerHTML = '';
    _cards.part = '';
    _cards.list = p.moves.map(m => {
        const c = document.createElement('div');
        c.style.cssText = 'width:54px;height:72px;border-radius:10px;background:rgba(20,12,24,.78);border:3px solid rgba(255,255,255,.25);' +
            'display:flex;flex-direction:column;align-items:center;justify-content:center;transition:transform .08s,opacity .15s;opacity:.4;';
        const g = document.createElement('div');
        g.style.cssText = 'font-size:30px;line-height:34px;color:#fff;visibility:hidden;';
        g.textContent = GLYPH[m];
        // One result badge per player, in screen order: P2 (left half) then P1.
        const marks = document.createElement('div');
        marks.style.cssText = 'display:flex;gap:5px;margin-top:3px;';
        const d = [1, 0].map(slot => {
            const e = document.createElement('div');
            e.style.cssText = `width:19px;height:19px;border-radius:6px;border:2px solid ${seat(slot).css};font-size:13px;line-height:15px;` +
                'text-align:center;color:#fff;font-weight:bold;';
            marks.appendChild(e);
            return e;
        });
        c.append(g, marks);
        _cards.cardRow.appendChild(c);
        return { c, g, dot: [d[1], d[0]], shown: false };     // dot[slot]
    });
}
function _revealCard(i, pop = true) {
    const k = _cards?.list[i];
    if (!k || k.shown) return;
    k.shown = true;
    k.g.style.visibility = 'visible'; k.c.style.opacity = '1';
    if (!pop) return;
    k.c.style.transform = 'scale(1.18)';
    setTimeout(() => { if (k.c) k.c.style.transform = ''; }, 110);
}
function _darkCards() { _cards?.list.forEach(k => { k.shown = true; k.g.textContent = '?'; k.g.style.visibility = 'visible'; k.g.style.opacity = '.5'; }); }
function _highlight(i) {
    _cards?.list.forEach((k, j) => { k.c.style.borderColor = j === i ? '#34f5a0' : 'rgba(255,255,255,.25)'; });
}
const MARK = { perfect: ['★', '#eab308'], good: ['✓', '#16a34a'], miss: ['✗', '#dc2626'] };
function _paintDots() {
    _cards?.list.forEach((k, i) => [0, 1].forEach(slot => {
        const j = _resp[slot][i], e = k.dot[slot];
        e.textContent = j ? MARK[j][0] : '';
        e.style.background = j ? MARK[j][1] : 'transparent';
    }));
}
function _flash(slot, j) {
    _hud.lit(slot, true, j === 'miss' ? 'rgba(255,79,106,.35)' : j === 'perfect' ? 'rgba(255,209,45,.4)' : 'rgba(52,245,160,.3)');
    const at = _t;
    setTimeout(() => { if (_hud && !_done && _t >= at) _hud.lit(slot, false); }, 260);
    const r = _rings[slot];
    if (r) { r.material.color.setHex(j === 'miss' ? 0xff3b5c : j === 'perfect' ? 0xffd12d : 0x34f5a0); r.material.opacity = 0.95; }
}
// A big verdict over each player's own half, for every move: right or wrong at a glance.
function _buildPops() {
    _pops = [0, 1].map(slot => {
        const box = document.createElement('div');
        box.style.cssText = `position:absolute;left:${slot === 0 ? 75 : 25}%;top:44%;transform:translate(-50%,-50%) scale(.8);text-align:center;` +
            'white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .12s,transform .12s;text-shadow:0 3px 0 rgba(0,0,0,.45),0 0 14px rgba(0,0,0,.35);';
        const big = document.createElement('div'); big.style.cssText = 'font-size:40px;line-height:44px;';
        const sub = document.createElement('div'); sub.style.cssText = 'font-size:18px;color:#fff;';
        box.append(big, sub);
        _stage.hud.appendChild(box);
        return { box, big, sub, until: 0, text: '' };
    });
}
function _pop(slot, j, why, sub) {
    const e = _pops[slot];
    if (!e) return;
    e.text = j === 'miss' ? `✗ ${why || 'MISS'}` : j === 'perfect' ? '★ PERFECT!' : '✓ GOOD';
    e.big.textContent = e.text;
    e.big.style.color = j === 'miss' ? '#ff4f6a' : j === 'perfect' ? '#ffd12d' : '#34f5a0';
    e.sub.textContent = sub || '';
    e.box.style.opacity = '1';
    e.box.style.transform = 'translate(-50%,-50%) scale(1.08)';
    setTimeout(() => { if (e.until) e.box.style.transform = 'translate(-50%,-50%) scale(1)'; }, 90);
    e.until = _t + 0.75;
}

function _renderHud() {
    if (!_hud) return;
    const n = Math.max(0, _ph + 1);
    _hud.bar(`<span style="color:${seat(1).css}">${seat(1).name}</span><span>${_score[1]}</span>` +
        `<span style="opacity:.7;font-size:14px">PHRASE ${Math.min(n, _plan.length)}/${_plan.length} · ${_bpm} BPM</span>` +
        `<span>${_score[0]}</span><span style="color:${seat(0).css}">${seat(0).name}</span>`);
}

function _end() {
    _phase = 'over';
    _hud.say('');
    if (_cards) _cards.row.style.display = 'none';
    const w = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;
    _dj?.anim.play('clap', { restart: true });
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? 'THE FLOOR CALLS IT EVEN' : 'OWNS THE FLOOR',
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// For probes.
export function _debugState() {
    const p = _plan[_ph];
    return {
        phase: _phase, phrase: _ph, beat: +_beat.toFixed(3), bpm: _bpm, score: _score.slice(),
        part: _ph >= 0 && _ph < _plan.length && _phase === 'dance' ? _where().part : '',
        idx: _ph >= 0 && _ph < _plan.length && _phase === 'dance' ? _where().i : -1, hide: !!p?.hide,
        moves: p ? p.moves.slice() : [], resp: _resp.map(r => r.slice()), danced: _danced.slice(), lastIn: _lastIn,
        respBeat0: p ? +_respBeat(0).toFixed(3) : 0,
        pose: _figs.map(f => f.anim?.state ?? ''), dj: _dj?.anim.state ?? '',
        shown: _cards ? _cards.list.map(k => k.shown) : [], label: _cards?.label.textContent ?? '',
        pops: _pops.map(e => (e.until ? e.text : '')),
        gl: !!_stage?.gl, turned: !!_stage?.turned,
    };
}
/** Probes: stop the music clock where it is (a slow renderer cannot swipe in time). */
export function _debugHold(on) { _hold = !!on; }
/** Probes: dance a move for a seat now (or at beat `at`). */
export function _debugMove(slot, move, at) { _input(slot, move, at ?? _beat); }
