// P1 sees a template shape drawn on their canvas for 3 seconds.
// Template hides; P2 must redraw it from memory on their canvas.
// Score = pixel overlap (IoU on 16x16 grid). Best of 3 rounds.
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
let _isBot = false, _tIdx = 0;

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
    _drawing = [false, false]; _phase = 'memorize'; clearTimeout(_timer);

    [1, 2].forEach(pi => {
        const canvas = _getOrCreateCanvas(pi);
        if (!canvas) return;
        canvas.style.display = 'block';
        _ctxs[pi - 1] = canvas.getContext('2d');
        _ctxs[pi - 1].lineWidth = 4; _ctxs[pi - 1].lineCap = 'round'; _ctxs[pi - 1].strokeStyle = '#ffffff';
        _clearCanvas(_ctxs[pi - 1]);

        const pid = pi - 1;
        const onDown = (e) => { if (_done || _drawing[pid] === false && _phase !== 'draw' + pid && _phase !== 'draw') return;
            e.preventDefault(); const r=canvas.getBoundingClientRect();
            _ctxs[pid].beginPath(); _ctxs[pid].moveTo(e.clientX-r.left,e.clientY-r.top); _drawing[pid]=true; };
        const onMove = (e) => { if (!_drawing[pid]||_done) return; e.preventDefault();
            const r=canvas.getBoundingClientRect(); _ctxs[pid].lineTo(e.clientX-r.left,e.clientY-r.top); _ctxs[pid].stroke(); };
        const onUp   = () => { _drawing[pid] = false; };
        canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointerleave', onUp);
    });

    document.getElementById('mg-neutral').textContent = 'MEMORIZE — THEN REDRAW!';
    _startRound();
}

function _startRound() {
    if (!state.mgActive || _done || _round >= MAX_ROUNDS) return;
    _round++;
    _phase = 'memorize';
    _tIdx  = Math.floor(Math.random() * TEMPLATES.length);

    [0, 1].forEach(pid => { if (_ctxs[pid]) _clearCanvas(_ctxs[pid]); });
    document.getElementById('bb-prompt-1').style.display = 'block';
    document.getElementById('bb-prompt-1').textContent   = `MEMORIZE: ${TEMPLATE_NAMES[_tIdx]}`;
    document.getElementById('bb-prompt-2').style.display = 'none';
    document.getElementById('bb-score-1').textContent    = `${_scores[0]} pts`;
    document.getElementById('bb-score-2').textContent    = `${_scores[1]} pts`;

    // Draw template on P1's canvas only
    const c1 = _ctxs[0];
    if (c1) {
        c1.strokeStyle = '#fbbf24'; c1.lineWidth = 5;
        TEMPLATES[_tIdx](c1, c1.canvas.width, c1.canvas.height);
        c1.strokeStyle = '#ffffff'; c1.lineWidth = 4;
    }
    // Store template as downsampled grid
    _templateData = _downsample(_ctxs[0]);

    document.getElementById('mg-neutral').textContent = `ROUND ${_round} — P1 MEMORIZE!`;
    sfx('countdown');

    _timer = setTimeout(() => {
        if (!state.mgActive || _done) return;
        _phase = 'draw';
        // Hide P1 canvas, enable P2 drawing
        _clearCanvas(_ctxs[0]);
        document.getElementById('bb-prompt-1').style.display = 'none';
        document.getElementById('bb-prompt-2').style.display = 'block';
        document.getElementById('bb-prompt-2').textContent   = `ROUND ${_round} — REDRAW IT!`;
        document.getElementById('mg-neutral').textContent    = 'P2: REDRAW FROM MEMORY!';
        _ctxs[1].strokeStyle = '#ffffff'; _ctxs[1].lineWidth = 4;

        if (_isBot) setTimeout(() => { if (state.mgActive && !_done && _phase === 'draw') _botDraw(); }, 400);

        _timer = setTimeout(() => { if (state.mgActive && !_done && _phase === 'draw') _scoreRound(); }, DRAW_MS);
    }, MEMORIZE_MS);
}

function _botDraw() {
    const c = _ctxs[1];
    if (!c) return;
    c.strokeStyle = '#ffffff'; c.lineWidth = 4;
    // Bot draws a rough version of the same template with slight noise
    const noiseFn = (v, scale) => v + (Math.random() - 0.5) * scale;
    const origFn  = TEMPLATES[_tIdx];
    const noiseCtx = new Proxy(c, {
        get(t, p) {
            const val = t[p];
            if (typeof val === 'function') return val.bind(t);
            return val;
        }
    });
    // Draw template at slight offset (bot imperfection)
    c.save();
    c.translate((Math.random()-0.5)*14, (Math.random()-0.5)*14);
    origFn(c, c.canvas.width, c.canvas.height);
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
                    // Pixel is "ink" if significantly brighter than background
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
    clearTimeout(_timer);
    _phase = 'scoring';

    const p2Grid   = _downsample(_ctxs[1]);
    const accuracy = _iou(_templateData || [], p2Grid);

    // P1 gets fixed 50 points (was the template setter), P2 gets accuracy score
    _scores[0] += 50;
    _scores[1] += accuracy;

    document.getElementById('mm-neutral')?.textContent; // no-op guard
    document.getElementById('mg-neutral').textContent = `P2 ACCURACY: ${accuracy}%`;
    document.getElementById('bb-score-1').textContent = `${_scores[0]} pts`;
    document.getElementById('bb-score-2').textContent = `${_scores[1]} pts`;
    sfx(accuracy > 60 ? 'coin_gain' : 'land_bad');

    if (_round >= MAX_ROUNDS) {
        _done = true; state.mgActive = false;
        const winner = _scores[0] > _scores[1] ? 0 : _scores[1] > _scores[0] ? 1 : -1;
        setTimeout(() => _onWin(winner), 1000);
    } else {
        setTimeout(_startRound, 2000);
    }
}
