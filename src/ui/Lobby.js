// ============================================================
// LOBBY — hosting, joining, and the wait before a match
// ============================================================
// Four screens' worth of behaviour in one small module: HOST vs JOIN, the code
// entry, the roster with character picking, and the START button.
//
// Two rules shape all of it.
//
//   1. THE COUNT IS WHOEVER TURNED UP. There is no "you need four players"
//      gate. Two, three or four all start. The lobby's job is to show who is in
//      the room, not to hold the match until some quorum is met.
//
//   2. THE HOST DECIDES WHEN. Everybody else marks themselves ready; the host
//      presses START. A vote would mean the last person to look at their phone
//      controls the match.
//
// Sharing is the OS share sheet, not a QR code. A QR needs a correct
// Reed-Solomon encoder — a couple of hundred lines that are either right or
// silently produce a square nobody's camera will read — and on a phone
// `navigator.share` is simply better: it hands the join link to WhatsApp,
// Messages or AirDrop, which is how these four people are already in contact.
// Where it is unavailable the link is copied to the clipboard instead, and the
// four-character code is on screen the whole time to be read out loud.

import { state } from '../core/GameState.js';
import * as Session from '../net/NetSession.js';
import * as NetGame from '../net/NetGame.js';
import { normaliseCode, isValidCode, CODE_LENGTH } from '../net/NetTransport.js';
import { ALL_CHAR_TYPES, CHAR_ICONS, CHAR_NAMES, PLAYER_SLOTS, MIN_PLAYERS, MAX_PLAYERS } from '../config/GameConfig.js';

let _controller = null;
let _onStartHostSetup = null;   // host: called when it is time to pick map/length
let _wired = false;

export function init(controller, onHostSetup) {
    _controller = controller;
    _onStartHostSetup = onHostSetup;
    if (_wired) return;
    _wired = true;

    document.getElementById('btn-online')?.addEventListener('click', open);
    document.getElementById('btn-lobby-back')?.addEventListener('click', close);
    document.getElementById('btn-lobby-host')?.addEventListener('click', _host);
    document.getElementById('btn-lobby-join')?.addEventListener('click', _join);
    document.getElementById('btn-lobby-start')?.addEventListener('click', _start);
    document.getElementById('btn-lobby-ready')?.addEventListener('click', _toggleReady);

    const codeInput = document.getElementById('lobby-code-input');
    codeInput?.addEventListener('input', () => {
        codeInput.value = normaliseCode(codeInput.value);
        document.getElementById('btn-lobby-join').disabled = !isValidCode(codeInput.value);
    });

    document.getElementById('lobby-chars')?.addEventListener('click', e => {
        const card = e.target.closest('[data-lobby-char]');
        if (!card || card.classList.contains('taken')) return;
        _pick(card.dataset.lobbyChar);
    });

    Session.on('roster', _paintRoster);
    Session.on('status', _paintStatus);
    Session.on('start',  () => close());
    Session.on('end',    info => _paintStatus({ kind: 'ended', reason: info && info.reason }));
}

export function open() {
    document.getElementById('splash').style.display = 'none';
    document.getElementById('lobby').style.display = 'flex';
    _setPhase('pick');
}

export function close() {
    document.getElementById('lobby').style.display = 'none';
}

// `pick` = host-or-join · `room` = the roster
function _setPhase(phase) {
    document.getElementById('lobby').dataset.phase = phase;
}

function _myName() {
    const v = (document.getElementById('lobby-name') || {}).value;
    return (v || '').trim().slice(0, 14) || 'Player';
}

// ── Host / join ─────────────────────────────────────────────────────────────

async function _host() {
    _busy(true, 'Opening a room…');
    try {
        const code = await Session.host(_myName());
        _setPhase('room');
        _paintCode(code);
        _paintRoster(Session.roster());
    } catch (e) {
        _paintStatus({ kind: 'error', error: e && e.message });
    } finally { _busy(false); }
}

async function _join() {
    const code = normaliseCode((document.getElementById('lobby-code-input') || {}).value);
    if (!isValidCode(code)) return;
    _busy(true, 'Looking for the room…');
    try {
        await Session.join(code, _myName());
        _setPhase('room');
        _paintCode(code);
        _paintRoster(Session.roster());
    } catch (e) {
        _paintStatus({ kind: 'error', error: e && e.message });
    } finally { _busy(false); }
}

function _pick(char) {
    const seat = Session.mySeat();
    if (seat === null) return;
    if (Session.isHost()) {
        const r = Session.roster();
        if (r.some((row, i) => i !== seat && row.char === char)) return;
        _hostSetOwn({ char });
    } else {
        Session.sendPick(char);
    }
}

function _toggleReady() {
    const seat = Session.mySeat();
    if (seat === null) return;
    const me = Session.roster()[seat];
    if (!me || !me.char) return;      // nothing to be ready with
    if (Session.isHost()) _hostSetOwn({ ready: !me.ready });
    else Session.sendReady(!me.ready);
}

// The host is a player too, and its own choices do not travel over the wire.
// NetSession owns the roster, so this asks it to change seat 0 and re-broadcast
// — rather than the lobby keeping a second copy that could disagree.
function _hostSetOwn(patch) {
    Session.hostUpdateSeat(0, patch);
}

async function _start() {
    if (!Session.canStart()) return;
    close();
    // Map and length are the host's to choose, on the screens that already
    // exist for it. When those are confirmed, NetGame tells everybody.
    if (_onStartHostSetup) _onStartHostSetup();
}

// ── Painting ────────────────────────────────────────────────────────────────

function _joinUrl(code) {
    return `${location.origin}${location.pathname}#join=${code}`;
}

function _paintCode(code) {
    const el = document.getElementById('lobby-code');
    if (el) el.textContent = code;
    const share = document.getElementById('lobby-share-note');
    if (share) {
        share.textContent = Session.isHost()
            ? 'Read the code out, or send the link.'
            : `You are in room ${code}.`;
    }
    const btn = document.getElementById('btn-lobby-share');
    if (btn) {
        btn.style.display = Session.isHost() ? '' : 'none';
        btn.onclick = () => _share(code);
    }
}

async function _share(code) {
    const url = _joinUrl(code);
    const btn = document.getElementById('btn-lobby-share');
    const say = txt => { if (btn) { btn.textContent = txt; setTimeout(() => { btn.textContent = '🔗 SEND THE LINK'; }, 1800); } };
    try {
        if (navigator.share) { await navigator.share({ title: 'Hundred Block Dash', text: `Join room ${code}`, url }); return; }
        await navigator.clipboard.writeText(url);
        say('✓ LINK COPIED');
    } catch (e) {
        // A cancelled share sheet lands here too, which is not a failure worth
        // reporting — only say something if the link never got anywhere.
        if (e && e.name === 'AbortError') return;
        say('COPY FAILED — READ THE CODE OUT');
    }
}

function _paintRoster(rows) {
    const list = document.getElementById('lobby-seats');
    if (!list) return;
    const mySeat = Session.mySeat();
    list.innerHTML = rows.map((r, i) => {
        const slot = PLAYER_SLOTS[i];
        const mine = i === mySeat;
        const tags = [];
        if (i === 0) tags.push('<span class="ls-tag">HOST</span>');
        if (mine)    tags.push('<span class="ls-tag ls-you">YOU</span>');
        if (r.bot)   tags.push('<span class="ls-tag ls-bot">BOT</span>');
        if (!r.connected && !r.bot) tags.push('<span class="ls-tag ls-gone">GONE</span>');
        const chosen = r.char
            ? `<span class="ls-char">${CHAR_ICONS[r.char] || '❔'} ${CHAR_NAMES[r.char] || r.char}</span>`
            : '<span class="ls-char ls-none">choosing…</span>';
        return `<div class="lobby-seat${mine ? ' ls-mine' : ''}${r.ready ? ' ls-ready' : ''}" style="--ls:${slot.hex}">` +
               `<span class="ls-num">${i + 1}</span>` +
               `<span class="ls-name">${_esc(r.name)}${tags.join('')}</span>` +
               chosen +
               `<span class="ls-state">${r.ready ? '✓ READY' : '…'}</span></div>`;
    }).join('');

    // Empty seats, so a room of two reads as "there is space" rather than as
    // "this is the whole game".
    const empties = MAX_PLAYERS - rows.length;
    if (empties > 0) {
        list.innerHTML += Array.from({ length: empties }, (_, k) =>
            `<div class="lobby-seat ls-empty"><span class="ls-num">${rows.length + k + 1}</span>` +
            `<span class="ls-name">waiting for a player…</span></div>`).join('');
    }

    _paintCharGrid(rows);

    const startBtn = document.getElementById('btn-lobby-start');
    if (startBtn) {
        startBtn.style.display = Session.isHost() ? '' : 'none';
        startBtn.disabled = !Session.canStart();
        startBtn.textContent = rows.length < MIN_PLAYERS
            ? `WAITING FOR ${MIN_PLAYERS - rows.length} MORE`
            : Session.canStart() ? `START · ${rows.length} PLAYERS`
            : 'WAITING FOR EVERYONE';
    }
    const readyBtn = document.getElementById('btn-lobby-ready');
    if (readyBtn) {
        const me = mySeat === null ? null : rows[mySeat];
        readyBtn.disabled = !me || !me.char;
        readyBtn.textContent = me && me.ready ? '✓ READY — TAP TO UNDO' : 'I AM READY';
        readyBtn.classList.toggle('is-ready', !!(me && me.ready));
    }
}

function _paintCharGrid(rows) {
    const grid = document.getElementById('lobby-chars');
    if (!grid) return;
    const mySeat = Session.mySeat();
    const mine = mySeat === null ? null : rows[mySeat];
    const takenBy = {};
    rows.forEach((r, i) => { if (r.char) takenBy[r.char] = i; });
    grid.innerHTML = ALL_CHAR_TYPES.map(t => {
        const owner = takenBy[t];
        const isMine = owner === mySeat && owner !== undefined;
        const taken  = owner !== undefined && !isMine;
        return `<button class="lobby-char${isMine ? ' sel' : ''}${taken ? ' taken' : ''}" data-lobby-char="${t}"` +
               `${taken ? ' disabled' : ''}><span class="lc-ic">${CHAR_ICONS[t] || '❔'}</span>` +
               `<span class="lc-nm">${CHAR_NAMES[t] || t}</span></button>`;
    }).join('');
    const hint = document.getElementById('lobby-char-hint');
    if (hint) hint.textContent = mine && mine.char ? 'Tap another to change, then mark yourself ready.'
                                                   : 'Pick who you are playing.';
}

function _paintStatus(info) {
    const el = document.getElementById('lobby-status');
    if (!el) return;
    const msg = {
        hosting:  () => `Room open — waiting for players. (${info.strategy})`,
        joining:  () => `Connected — finding the room… (${info.strategy})`,
        error:    () => `⚠️ ${info.error || 'Could not connect.'} Check the signal and try again.`,
        kicked:   () => info.reason === 'full'    ? 'That room is full.'
                      : info.reason === 'started' ? 'That match has already started.'
                      : 'That room is running a different version of the game.',
        'seat-dropped': () => `${info.name} dropped — the bot is playing their seat.`,
        'peer-left':    () => 'A player disconnected.',
        ended:    () => 'The host left. The match is over.',
        left:     () => '',
    }[info.kind];
    el.textContent = msg ? msg() : '';
    el.classList.toggle('is-error', info.kind === 'error' || info.kind === 'kicked');
}

function _busy(on, label) {
    const el = document.getElementById('lobby-status');
    if (el && on) el.textContent = label || 'Working…';
    ['btn-lobby-host', 'btn-lobby-join'].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.disabled = !!on;
    });
}

function _esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// A link with #join=CODE in it should drop straight into that room.
export function codeFromUrl() {
    const m = /[#&?]join=([A-Za-z0-9]+)/.exec(location.href);
    return m ? normaliseCode(m[1]) : null;
}
