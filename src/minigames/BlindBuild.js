// P1 and P2 alternate roles each round: memorizer sees the template, drawer replicates it.
// Score = memorizer gets 30pts participation, drawer gets IoU accuracy score.
// Best of 3 rounds (most total points wins).
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const MEMORIZE_MS  = 3000;
const DRAW_MS      = 6000;
const GRID_RES     = 16;
const MAX_ROUNDS   = 3;

const TEMPLATES = [
    (ctx, w, h) => { // Triangle
        ctx.beginPath(); ctx.moveTo(w/2,h*0.12); ctx.lineTo(w*0.88,h*0.85); ctx.lineTo(w*0.12,h*0.85); ctx.closePath(); ctx.stroke();
    },
    (ctx, w, h) => { // House
        ctx.beginPath(); ctx.moveTo(w/2,h*0.12); ctx.lineTo(w*0.85,h*0.45); ctx.lineTo(w*0.15,h*0.45); ctx.closePath(); ctx.stroke();
        ctx.strokeRect(w*0.22,h*0.45, w*0.56,h*0.43);
    },
    (ctx, w, h) => { // Circle
        ctx.beginPath(); ctx.arc(w/2,h/2,w*0.35,0,Math.PI*2); ctx.stroke();
    },
    (ctx, w, h) => { // Arrow right
        ctx.beginPath(); ctx.moveTo(w*0.1,h*0.38); ctx.lineTo(w*0.62,h*0.38); ctx.lineTo(w*0.62,h*0.18); ctx.lineTo(w*0.9,h*0.5); ctx.lineTo(w*0.62,h*0.82); ctx.lineTo(w*0.62,h*0.62); ctx.lineTo(w*0.1,h*0.62); ctx.closePath(); ctx.stroke();
    },
    (ctx, w, h) => { // Cross (+)
        ctx.beginPath(); ctx.moveTo(w/2,h*0.1); ctx.lineTo(w/2,h*0.9); ctx.moveTo(w*0.1,h/2); ctx.lineTo(w*0.9,h/2); ctx.stroke();
    },
    (ctx, w, h) => { // Diamond
        ctx.beginPath(); ctx.moveTo(w/2,h*0.1); ctx.lineTo(w*0.88,h/2); ctx.lineTo(w/2,h*0.9); ctx.lineTo(w*0.12,h/2); ctx.closePath(); ctx.stroke();
    },
    (ctx, w, h) => { // Star (simplified 4-point)
        ctx.beginPath();
        const cx=w/2,cy=h/2,r1=w*0.38,r2=w*0.16;
        for(let i=0;i<8;i++){const a=i*Math.PI/4-Math.PI/8,r=i%2===0?r1:r2;i===0?ctx.moveTo(cx+r*Math.cos(a),cy+r*Math.sin(a)):ctx.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a));}
        ctx.closePath(); ctx.stroke();
    },
    (ctx, w, h) => { // Zigzag
        ctx.beginPath(); ctx.moveTo(w*0.08,h*0.5);
        [0.22,0.08,0.36,0.22,0.5,0.08,0.64,0.22,0.78,0.08,0.92,0.22].reduce((a,v,i) => { if(i%2===0)return v; ctx.lineTo(w*a,h*v); return a; }, 0);
        ctx.stroke();
    },
];

const TEMPLATE_NAMES = ['TRIANGLE','HOUSE','CIRCLE','ARROW','CROSS','DIAMOND','STAR','ZIGZAG'];

let _done = false, _round = 0, _scores = [0, 0], _onWin = null;
let _ctxs = [null, null], _templateData = null;
let _drawing = [false, false], _phase = 'memorize', _timer = null;
let _isBot = false, _tIdx = 0, _role = 0;
const _canvasCleanups = [];
const _timers = [];

function _after(fn, ms) {
    const id = setTimeout(() => {
        const i = _timers.indexOf(id);
        if (i >= 0) _timers.splice(i, 1);
        fn();
    }, ms);
    _timers.push(id);
    return id;
}

function _getOrCreateCanvas(pi) {
    const el = document.getElementById(`bb-canvas-${pi}`);
    if (!el) return null;
    if (el.width !== el.offsetWidth || el.height !== el.offsetHeight) {
        el.width  = Math.max(el.offsetWidth,  120);
        el.height = Math.max(el.offsetHeight, 120);
    }
    return el;
}

function _clearCanvas(ctx) {
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _round = 0; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _drawing = [false, false]; _phase = 'memorize';
    clearTimeout(_timer);
    _timers.forEach(clearTimeout); _timers.length = 0;
    _canvasCleanups.forEach(f => f()); _canvasCleanups.length = 0;
    _role = 0;

    [1, 2].forEach(pi => {
        const canvas = _getOrCreateCanvas(pi);
        if (!canvas) return;
        canvas.style.display = 'block';
        _ctxs[pi - 1] = canvas.getContext('2d');
        _ctxs[pi - 1].lineWidth = 4; _ctxs[pi - 1].lineCap = 'round'; _ctxs[pi - 1].strokeStyle = '#ffffff';
        _clearCanvas(_ctxs[pi - 1]);

        const pid = pi - 1;
        const onDown = (e) => {
            if (_done || _phase !== 'draw' || pid === _role) return; // only drawer can draw
            e.preventDefault(); const r=canvas.getBoundingClientRect();
            _ctxs[pid].beginPath(); _ctxs[pid].moveTo(e.clientX-r.left,e.clientY-r.top); _drawing[pid]=true;
        };
        const onMove = (e) => { if (!_drawing[pid]||_done) return; e.preventDefault();
            const r=canvas.getBoundingClientRect(); _ctxs[pid].lineTo(e.clientX-r.left,e.clientY-r.top); _ctxs[pid].stroke(); };
        const onUp   = () => { _drawing[pid] = false; };
        canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointerleave', onUp);
        _canvasCleanups.push(() => {
            canvas.removeEventListener('pointerdown', onDown);
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerup', onUp);
            canvas.removeEventListener('pointerleave', onUp);
        });
    });

    document.getElementById('mg-neutral').textContent = 'MEMORIZE — THEN REDRAW!';
    _startRound();
}

function _startRound() {
    if (!state.mgActive || _done || _round >= MAX_ROUNDS) return;
    _round++;
    _phase = 'memorize';
    _tIdx  = Math.floor(Math.random() * TEMPLATES.length);
    // Alternate roles: round 1 → P1 memorizes, round 2 → P2 memorizes, etc.
    _role  = (_round - 1) % 2;
    const drawer = 1 - _role;

    [0, 1].forEach(pid => { if (_ctxs[pid]) _clearCanvas(_ctxs[pid]); });
    document.getElementById(`bb-prompt-${_role + 1}`).style.display = 'block';
    document.getElementById(`bb-prompt-${_role + 1}`).textContent   = `MEMORIZE: ${TEMPLATE_NAMES[_tIdx]}`;
    document.getElementById(`bb-prompt-${drawer + 1}`).style.display = 'none';
    document.getElementById('bb-score-1').textContent = `${_scores[0]} pts`;
    document.getElementById('bb-score-2').textContent = `${_scores[1]} pts`;

    // Draw template on memorizer's canvas only
    const cMem = _ctxs[_role];
    if (cMem) {
        cMem.strokeStyle = '#fbbf24'; cMem.lineWidth = 5;
        TEMPLATES[_tIdx](cMem, cMem.canvas.width, cMem.canvas.height);
        cMem.strokeStyle = '#ffffff'; cMem.lineWidth = 4;
    }
    // Store template as downsampled grid
    _templateData = _downsample(_ctxs[_role]);

    document.getElementById('mg-neutral').textContent = `ROUND ${_round} — P${_role + 1} MEMORIZE!`;
    sfx('countdown');

    _timer = _after(() => {
        if (!state.mgActive || _done) return;
        _phase = 'draw';
        // Hide memorizer's canvas content, enable drawer
        _clearCanvas(_ctxs[_role]);
        document.getElementById(`bb-prompt-${_role + 1}`).style.display = 'none';
        document.getElementById(`bb-prompt-${drawer + 1}`).style.display = 'block';
        document.getElementById(`bb-prompt-${drawer + 1}`).textContent   = `ROUND ${_round} — REDRAW IT!`;
        document.getElementById('mg-neutral').textContent = `P${drawer + 1}: REDRAW FROM MEMORY!`;
        _ctxs[drawer].strokeStyle = '#ffffff'; _ctxs[drawer].lineWidth = 4;

        // Bot draws if bot is the drawer (bot = pid 1)
        if (_isBot && drawer === 1) _after(() => { if (state.mgActive && !_done && _phase === 'draw') _botDraw(); }, 400);

        _after(() => { if (state.mgActive && !_done && _phase === 'draw') _scoreRound(); }, DRAW_MS);
    }, MEMORIZE_MS);
}

function _botDraw() {
    const c = _ctxs[1];
    if (!c) return;
    c.strokeStyle = '#ffffff'; c.lineWidth = 4;
    c.save();
    c.translate((Math.random()-0.5)*14, (Math.random()-0.5)*14);
    TEMPLATES[_tIdx](c, c.canvas.width, c.canvas.height);
    c.restore();
}

function _downsample(ctx) {
    if (!ctx) return new Array(GRID_RES * GRID_RES).fill(0);
    const { width: w, height: h } = ctx.canvas;
    const raw = ctx.getImageData(0, 0, w, h).data;
    const grid = new Array(GRID_RES * GRID_RES).fill(0);
    const cw = w / GRID_RES, ch = h / GRID_RES;
    for (let gy = 0; gy < GRID_RES; gy++) {
        for (let gx = 0; gx < GRID_RES; gx++) {
            let ink = 0, total = 0;
            for (let py = Math.floor(gy*ch); py < Math.floor((gy+1)*ch); py++) {
                for (let px = Math.floor(gx*cw); px < Math.floor((gx+1)*cw); px++) {
                    const i = (py * w + px) * 4;
                    if (raw[i] > 40 || raw[i+1] > 40 || raw[i+2] > 40) ink++;
                    total++;
                }
            }
            grid[gy * GRID_RES + gx] = ink / total > 0.1 ? 1 : 0;
        }
    }
    return grid;
}

function _iou(g1, g2) {
    let inter = 0, union = 0;
    for (let i = 0; i < g1.length; i++) {
        if (g1[i] || g2[i]) union++;
        if (g1[i] && g2[i]) inter++;
    }
    return union === 0 ? 0 : Math.round((inter / union) * 100);
}

function _scoreRound() {
    if (_done) return;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _phase = 'scoring';

    const drawer = 1 - _role;
    const drawerGrid = _downsample(_ctxs[drawer]);
    const accuracy   = _iou(_templateData || [], drawerGrid);

    // Memorizer gets 30pts participation, drawer gets accuracy
    _scores[_role]  += 30;
    _scores[drawer] += accuracy;

    document.getElementById('mg-neutral').textContent = `P${drawer + 1} ACCURACY: ${accuracy}%`;
    document.getElementById('bb-score-1').textContent = `${_scores[0]} pts`;
    document.getElementById('bb-score-2').textContent = `${_scores[1]} pts`;
    sfx(accuracy > 60 ? 'coin_gain' : 'land_bad');

    if (_round >= MAX_ROUNDS) {
        _done = true; state.mgActive = false;
        const winner = _scores[0] > _scores[1] ? 0 : _scores[1] > _scores[0] ? 1 : -1;
        _after(() => _onWin(winner), 1000);
    } else {
        _after(_startRound, 2000);
    }
}

export function destroy() {
    _timers.forEach(clearTimeout); _timers.length = 0;
    _canvasCleanups.forEach(f => f()); _canvasCleanups.length = 0;
    _done = true;
}
