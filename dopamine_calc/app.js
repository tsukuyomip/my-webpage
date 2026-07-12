'use strict';
/* ============================================================
   DOPAMINE CALC ⚡ — 無駄にド派手な電卓
   - 全キーで効果音 + パーティクル（コンボで音程上昇）
   - 「=」のたびにレアリティ抽選（N/R/SR/SSR/UR）
   - SSR 以上（+ フェイク）で「プチュン」→ 大爆発演出
   - DP を貯めてスキンガチャ（テーマ収集 / localStorage 永続化）
   ============================================================ */

// ---------------- utils ----------------
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };

const RAINBOW = ['#ff004c', '#ff8000', '#ffee00', '#00ff6a', '#00cfff', '#7b2dff', '#ff4dd2'];

// ---------------- audio (全部 WebAudio 合成 / 素材ファイルなし) ----------------
let AC = null, master = null;
function ac() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 20; comp.ratio.value = 8;
    master = AC.createGain();
    master.gain.value = 0.5;
    master.connect(comp);
    comp.connect(AC.destination);
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone({ freq = 440, end = 0, dur = 0.15, type = 'sine', vol = 0.2, delay = 0, attack = 0.005 }) {
  const c = ac(), t = c.currentTime + delay;
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (end && end !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(end, 1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.05);
}
let noiseBuf = null;
function noise({ dur = 0.3, vol = 0.3, from = 4000, to = 200, delay = 0, q = 0.8 }) {
  const c = ac(), t = c.currentTime + delay;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'lowpass'; f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(to, 20), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.05);
}
// ドレミ…メジャーペンタトニックで気持ちよく上がっていくキー音
const PENTA = [0, 2, 4, 7, 9];
const sKey = (combo) => {
  const idx = Math.min(combo, 29);
  const st = PENTA[idx % 5] + 12 * (Math.floor(idx / 5) % 3);
  const f = 523.25 * Math.pow(2, st / 12);
  tone({ freq: f, dur: 0.09, type: 'triangle', vol: 0.22 });
  tone({ freq: f * 2, dur: 0.05, type: 'sine', vol: 0.08 });
};
const sOp = () => { tone({ freq: 220, end: 110, dur: 0.12, type: 'square', vol: 0.14 }); tone({ freq: 1400, end: 500, dur: 0.07, type: 'sine', vol: 0.1 }); };
const sTick = (i) => tone({ freq: 900 + i * 90, dur: 0.03, type: 'square', vol: 0.09 });
const sDrumroll = (n = 12) => { for (let i = 0; i < n; i++) noise({ dur: 0.04, vol: 0.16, from: 2500, to: 800, delay: i * i * 0.004 + i * 0.028 }); };
const sPchun = () => { tone({ freq: 3200, end: 40, dur: 0.16, type: 'sine', vol: 0.5 }); noise({ dur: 0.05, vol: 0.25, from: 8000, to: 3000 }); };
const sExplosion = () => { noise({ dur: 0.7, vol: 0.55, from: 3500, to: 60 }); tone({ freq: 160, end: 28, dur: 0.6, type: 'sine', vol: 0.5 }); };
const sCoin = (delay = 0) => { tone({ freq: 1174.7, dur: 0.06, type: 'square', vol: 0.1, delay }); tone({ freq: 1568, dur: 0.35, type: 'square', vol: 0.1, delay: delay + 0.06 }); };
const sChime = () => { [0, 4, 7].forEach((st, i) => tone({ freq: 880 * Math.pow(2, st / 12), dur: 0.3, type: 'sine', vol: 0.12, delay: i * 0.03 })); };
const sZen = () => { tone({ freq: 220, dur: 2.0, type: 'sine', vol: 0.2, attack: 0.4 }); tone({ freq: 331, dur: 2.0, type: 'sine', vol: 0.08, attack: 0.5 }); };
const sError = () => { tone({ freq: 190, end: 60, dur: 0.4, type: 'sawtooth', vol: 0.2 }); tone({ freq: 197, end: 55, dur: 0.4, type: 'sawtooth', vol: 0.2 }); };
function sFanfare(level) { // 1..3
  const base = 523.25;
  const seqs = {
    1: [[0, 0], [4, 0.09], [7, 0.18], [12, 0.28]],
    2: [[0, 0], [4, 0.08], [7, 0.16], [12, 0.24], [16, 0.34], [19, 0.42], [24, 0.52]],
    3: [[0, 0], [0, 0.1], [0, 0.2], [4, 0.3], [7, 0.42], [12, 0.54], [16, 0.66], [19, 0.78], [24, 0.9], [28, 1.05], [31, 1.2]],
  };
  for (const [st, d] of seqs[level]) {
    tone({ freq: base * Math.pow(2, st / 12), dur: 0.22, type: 'square', vol: 0.13, delay: d });
    tone({ freq: base * 2 * Math.pow(2, st / 12), dur: 0.22, type: 'triangle', vol: 0.08, delay: d });
  }
  if (level >= 2) [0, 4, 7, 12].forEach((st) => tone({ freq: base * Math.pow(2, st / 12), dur: 0.9, type: 'sawtooth', vol: 0.05, delay: seqs[level].at(-1)[1] + 0.1 }));
  if (level >= 3) for (let i = 0; i < 10; i++) tone({ freq: rand(2000, 4200), dur: 0.15, type: 'sine', vol: 0.05, delay: 1.3 + i * 0.09 });
}

// ---------------- particles (canvas) ----------------
const cv = $('#fx'), ctx = cv.getContext('2d');
let W = 0, H = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const parts = [];
const MAX_PARTS = 900;
function push(p) { if (parts.length < MAX_PARTS) parts.push(p); }

function sparkBurst(x, y, n, colors, speed = 6) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), v = rand(speed * 0.3, speed);
    push({ t: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.12, life: 1, dec: rand(0.02, 0.045), size: rand(1.5, 3.5), color: pick(colors) });
  }
}
function confettiRain(n, colors) {
  for (let i = 0; i < n; i++) {
    push({ t: 'conf', x: rand(0, W), y: rand(-H * 0.4, -10), vx: rand(-1.5, 1.5), vy: rand(2, 5), g: 0.06, life: 1, dec: rand(0.003, 0.007), size: rand(5, 10), color: pick(colors), rot: rand(0, 6.28), vr: rand(-0.25, 0.25), ph: rand(0, 6.28) });
  }
}
function ring(x, y, color, maxR = 180) {
  push({ t: 'ring', x, y, r: 6, vr2: 9, life: 1, dec: 0.035, maxR, color });
}
function rocket(x, color) {
  push({ t: 'rocket', x, y: H + 10, vx: rand(-1.2, 1.2), vy: rand(-15, -11.5), g: 0.18, life: 1, dec: 0.004, size: 3, color, fuse: rand(28, 46) });
}
function fountain(x, y, colors, n = 26) {
  for (let i = 0; i < n; i++) {
    push({ t: 'spark', x, y, vx: rand(-2.5, 2.5), vy: rand(-11, -6), g: 0.28, life: 1, dec: rand(0.008, 0.016), size: rand(2, 4), color: pick(colors) });
  }
}
function fireworksBarrage(count, colors, span = 1800) {
  for (let i = 0; i < count; i++) setTimeout(() => rocket(rand(W * 0.1, W * 0.9), pick(colors)), rand(0, span));
}

function frame() {
  ctx.clearRect(0, 0, W, H);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= p.dec;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    switch (p.t) {
      case 'spark':
        p.vy += p.g; p.x += p.vx; p.y += p.vy;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, 6.28); ctx.fill();
        break;
      case 'conf':
        p.vy += p.g; p.vy *= 0.99; p.ph += 0.1;
        p.x += p.vx + Math.sin(p.ph) * 1.2; p.y += p.vy; p.rot += p.vr;
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = Math.min(1, p.life * 2);
        ctx.fillStyle = p.color;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
        break;
      case 'ring':
        p.r += p.vr2; p.vr2 *= 0.94;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = p.life * 0.8;
        ctx.strokeStyle = p.color; ctx.lineWidth = 3 * p.life;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.stroke();
        break;
      case 'rocket':
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.fuse--;
        push({ t: 'spark', x: p.x, y: p.y, vx: rand(-0.4, 0.4), vy: rand(0, 1), g: 0.02, life: 0.5, dec: 0.05, size: 1.6, color: p.color });
        if (p.fuse <= 0 || p.vy > -1.5) {
          parts.splice(i, 1);
          sparkBurst(p.x, p.y, 46, [p.color, '#ffffff'], 7);
          ring(p.x, p.y, p.color);
          noise({ dur: 0.35, vol: 0.2, from: 2500, to: 100 });
          continue;
        }
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.28); ctx.fill();
        break;
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// カーソル / タッチの軌跡にキラキラ
let lastTrail = 0;
window.addEventListener('pointermove', (e) => {
  const now = performance.now();
  if (now - lastTrail < 40) return;
  lastTrail = now;
  push({ t: 'spark', x: e.clientX, y: e.clientY, vx: rand(-0.6, 0.6), vy: rand(-0.6, 0.6), g: 0.02, life: 0.7, dec: 0.04, size: rand(1, 2.4), color: pick([themeColor(1), themeColor(2), '#ffffff']) });
});

// ---------------- flash & shake ----------------
const flashEl = $('#flash');
function flash(color = '#fff', peak = 0.9, dur = 220) {
  flashEl.style.background = color;
  flashEl.animate([{ opacity: peak }, { opacity: 0 }], { duration: dur, easing: 'ease-out' });
}
function shake(cls) {
  const el = $('#app');
  el.classList.remove('shake-s', 'shake-m', 'shake-l');
  void el.offsetWidth; // reflow で再発火
  el.classList.add(cls);
}

// ---------------- themes / gacha data ----------------
const THEMES = [
  { id: 'neon',     name: 'ネオン・パルス',     r: 'N',   vars: { '--bg1': '#0a0e1f', '--bg2': '#170b2b', '--ac1': '#00e5ff', '--ac2': '#ff2d95', '--key': '#141a2e', '--keyop': '#232b4a', '--txt': '#eaf6ff' } },
  { id: 'citrus',   name: '電光シトラス',       r: 'N',   vars: { '--bg1': '#101a0a', '--bg2': '#0a2415', '--ac1': '#aaff00', '--ac2': '#ffb300', '--key': '#16240f', '--keyop': '#243c18', '--txt': '#f2ffe0' } },
  { id: 'crt',      name: 'ブラウン管レトロ',   r: 'N',   vars: { '--bg1': '#0d0d0d', '--bg2': '#1a1206', '--ac1': '#33ff66', '--ac2': '#ffcc33', '--key': '#161616', '--keyop': '#242416', '--txt': '#d9ffe6' } },
  { id: 'sakura',   name: '夜桜',               r: 'R',   vars: { '--bg1': '#1a0b18', '--bg2': '#2b0f24', '--ac1': '#ff8ad8', '--ac2': '#ffd6f2', '--key': '#251223', '--keyop': '#3a1c34', '--txt': '#fff0fa' } },
  { id: 'deepsea',  name: '深海プリズム',       r: 'R',   vars: { '--bg1': '#041225', '--bg2': '#062a3a', '--ac1': '#35d0ff', '--ac2': '#7dffd4', '--key': '#08203a', '--keyop': '#0d3352', '--txt': '#e2f8ff' } },
  { id: 'vapor',    name: 'ヴェイパーウェイヴ', r: 'R',   vars: { '--bg1': '#17092e', '--bg2': '#2b0b3a', '--ac1': '#01cdfe', '--ac2': '#ff71ce', '--key': '#221240', '--keyop': '#341b58', '--txt': '#f4eaff' } },
  { id: 'gold',     name: '黄金郷',             r: 'SR',  vars: { '--bg1': '#1a1204', '--bg2': '#000000', '--ac1': '#ffd700', '--ac2': '#ff9500', '--key': '#241a08', '--keyop': '#3a2a0c', '--txt': '#fff6d5' } },
  { id: 'cyber',    name: '電脳歌舞伎町',       r: 'SR',  vars: { '--bg1': '#12001a', '--bg2': '#001a2e', '--ac1': '#f7ff00', '--ac2': '#ff003c', '--key': '#1c0828', '--keyop': '#2c0f3e', '--txt': '#fdfaff' } },
  { id: 'galaxy',   name: '銀河の果て',         r: 'SSR', vars: { '--bg1': '#050514', '--bg2': '#120a33', '--ac1': '#8f7bff', '--ac2': '#59f3ff', '--key': '#0d0d26', '--keyop': '#1a1642', '--txt': '#eeeaff' } },
  { id: 'inferno',  name: '獄炎',               r: 'SSR', vars: { '--bg1': '#1c0400', '--bg2': '#330a00', '--ac1': '#ff5a00', '--ac2': '#ffd24d', '--key': '#2a0d04', '--keyop': '#421407', '--txt': '#fff1e0' } },
  { id: 'divine',   name: '神域',               r: 'UR',  vars: { '--bg1': '#fff8dc', '--bg2': '#ffe9a8', '--ac1': '#ffb300', '--ac2': '#ff4dd2', '--key': '#fff3c4', '--keyop': '#ffe08a', '--txt': '#4a3000', '--screen': 'rgba(255, 255, 255, 0.55)' } },
];
const RARITY = {
  N:   { color: '#9aa5b1', dp: 25,   level: 0 },
  R:   { color: '#4da3ff', dp: 50,   level: 1 },
  SR:  { color: '#c366ff', dp: 100,  level: 2 },
  SSR: { color: '#ffd24d', dp: 300,  level: 3 },
  UR:  { color: '#ff4dd2', dp: 1000, level: 4 },
};
const GACHA_COST = 100;

// ---------------- persistent state ----------------
const SAVE_KEY = 'dopamine_calc_v1';
let save = { dp: 150, owned: ['neon'], equipped: 'neon' };
try {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) save = Object.assign(save, JSON.parse(raw));
} catch (_) {}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {} }

function curTheme() { return THEMES.find((t) => t.id === save.equipped) || THEMES[0]; }
function themeColor(n) { return curTheme().vars[`--ac${n}`]; }
function themeColors() { return [themeColor(1), themeColor(2), '#ffffff']; }
const THEME_DEFAULTS = { '--screen': 'rgba(0, 0, 0, 0.35)' };
function applyTheme() {
  // テーマが持たない変数はデフォルトに戻してから上書き（切替時の残留防止）
  for (const [k, v] of Object.entries(THEME_DEFAULTS)) document.documentElement.style.setProperty(k, v);
  for (const [k, v] of Object.entries(curTheme().vars)) document.documentElement.style.setProperty(k, v);
}
applyTheme();

// ---------------- DP ----------------
const dpEl = $('#dp'), walletEl = $('#wallet');
function renderDp() { dpEl.textContent = save.dp.toLocaleString(); const g = $('#gdp'); if (g) g.textContent = save.dp.toLocaleString(); }
function addDp(n, fx = true) {
  save.dp = Math.max(0, save.dp + n);
  renderDp(); persist();
  if (fx && n > 0) {
    walletEl.classList.remove('pop'); void walletEl.offsetWidth; walletEl.classList.add('pop');
    const r = walletEl.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'dpfloat';
    f.textContent = `+${n} DP`;
    f.style.left = `${r.left + rand(-10, 10)}px`;
    f.style.top = `${r.bottom + 4}px`;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }
}
renderDp();

// ---------------- calculator engine ----------------
const exprEl = $('#expr'), resultEl = $('#result');
let tokens = [];       // 数値文字列と演算子の列
let entry = '0';       // 入力中の数値
let justEvaluated = false;
let busy = false;      // 演出中は入力を止める

const OPCHAR = { '+': '＋', '-': '−', '*': '×', '/': '÷' };

function fmt(v) {
  if (!isFinite(v) || isNaN(v)) return '∞';
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  return String(parseFloat(v.toPrecision(12)));
}
function evaluate(tk) {
  const p1 = [];
  for (let i = 0; i < tk.length; i++) {
    if (tk[i] === '*' || tk[i] === '/') {
      const a = parseFloat(p1.pop()), b = parseFloat(tk[++i]);
      p1.push(tk[i - 1] === '*' ? a * b : a / b);
    } else p1.push(tk[i]);
  }
  let acc = parseFloat(p1[0]);
  for (let i = 1; i < p1.length; i += 2) {
    const b = parseFloat(p1[i + 1]);
    acc = p1[i] === '+' ? acc + b : acc - b;
  }
  return acc;
}
function setExpr(html) {
  exprEl.innerHTML = html || '&nbsp;';
  exprEl.scrollLeft = exprEl.scrollWidth; // 常に右端（最新）を見せる
}
function renderScreen() {
  setExpr(tokens.map((t) => OPCHAR[t] || t).join(' '));
  setResultText(entry);
}
function setResultText(s) {
  resultEl.textContent = s;
  resultEl.style.fontSize = s.length > 9 ? `${Math.max(20, 46 - (s.length - 9) * 3)}px` : '46px';
}

// ---------------- combo ----------------
let combo = 0, comboTimer = null;
const comboFill = $('#comboFill'), comboLabel = $('#comboLabel');
function comboMult() { return combo >= 40 ? 8 : combo >= 25 ? 5 : combo >= 15 ? 3 : combo >= 8 ? 2 : 1; }
function bumpCombo() {
  const prev = comboMult();
  combo++;
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => { combo = 0; renderCombo(); }, 3000);
  renderCombo();
  if (comboMult() > prev) {
    sChime();
    flash(themeColor(2), 0.25, 180);
    sparkBurst(W / 2, H * 0.3, 40, themeColors(), 8);
    vibrate(30);
  }
}
function renderCombo() {
  comboFill.style.width = `${Math.min(combo / 40, 1) * 100}%`;
  const m = comboMult();
  comboLabel.textContent = combo >= 3 ? `${combo} COMBO ×${m}${m >= 5 ? '🔥' : ''}` : '';
}

// ---------------- key input ----------------
function keyFxAt(btn) {
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  sparkBurst(r.left + r.width / 2, r.top + r.height / 2, 8, themeColors(), 4);
}
function onKey(k, btn) {
  if (busy) return;
  bumpCombo();
  addDp(1 * comboMult(), false);
  renderDp();
  vibrate(8);
  keyFxAt(btn);

  if (k >= '0' && k <= '9') {
    sKey(combo);
    if (justEvaluated) { tokens = []; entry = '0'; justEvaluated = false; }
    if (entry.replace('-', '').replace('.', '').length >= 12) return;
    entry = entry === '0' ? k : entry === '-0' ? '-' + k : entry + k;
  } else if (k === '.') {
    sKey(combo);
    if (justEvaluated) { tokens = []; entry = '0'; justEvaluated = false; }
    if (!entry.includes('.')) entry += '.';
  } else if (k === '+' || k === '-' || k === '*' || k === '/') {
    sOp();
    shake('shake-s');
    justEvaluated = false;
    if (tokens.length && OPCHAR[tokens.at(-1)] && entry === '0') {
      tokens[tokens.length - 1] = k; // 演算子を差し替え
    } else {
      tokens.push(fmt(parseFloat(entry)), k);
      entry = '0';
    }
  } else if (k === '%') {
    sOp();
    entry = fmt(parseFloat(entry) / 100);
  } else if (k === '+/-') {
    sOp();
    entry = entry.startsWith('-') ? entry.slice(1) : '-' + entry;
  } else if (k === 'BS') {
    tone({ freq: 300, end: 150, dur: 0.08, type: 'triangle', vol: 0.14 });
    entry = entry.length > 1 && entry !== '-0' ? entry.slice(0, -1) : '0';
    if (entry === '-') entry = '0';
  } else if (k === 'C') {
    tone({ freq: 600, end: 80, dur: 0.25, type: 'sawtooth', vol: 0.14 });
    tokens = []; entry = '0'; justEvaluated = false;
    ring(W / 2, H / 2, themeColor(1), 120);
  } else if (k === '=') {
    onEquals();
    return;
  }
  renderScreen();
}

$('#keys').addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.key');
  if (!btn) return;
  btn.classList.remove('pressed'); void btn.offsetWidth; btn.classList.add('pressed');
  onKey(btn.dataset.k, btn);
});
window.addEventListener('keydown', (e) => {
  if (!$('#gachaModal').classList.contains('hidden')) return;
  const map = { Enter: '=', '=': '=', Backspace: 'BS', Escape: 'C', Delete: 'C' };
  let k = map[e.key] ?? (('0123456789.+-*/%'.includes(e.key) && e.key !== '') ? e.key : null);
  if (!k) return;
  e.preventDefault();
  const btn = document.querySelector(`.key[data-k="${CSS.escape(k)}"]`);
  if (btn) { btn.classList.remove('pressed'); void btn.offsetWidth; btn.classList.add('pressed'); }
  onKey(k, btn);
});

// ---------------- result gacha (= 演出) ----------------
function rollResultRarity() {
  const r = Math.random();
  if (r < 0.03) return 'UR';
  if (r < 0.15) return 'SSR';
  if (r < 0.40) return 'SR';
  if (r < 0.75) return 'R';
  return 'N';
}

async function onEquals() {
  if (busy) return;
  if (tokens.length === 0 && entry === '0') { tone({ freq: 180, dur: 0.1, type: 'sine', vol: 0.1 }); return; }
  busy = true;
  bumpCombo();
  vibrate([15, 30, 15]);

  const finalTokens = [...tokens, fmt(parseFloat(entry))];
  setExpr(finalTokens.map((t) => OPCHAR[t] || t).join(' ') + ' ＝');

  const value = evaluate(finalTokens);
  const isZeroDiv = !isFinite(value) || isNaN(value);
  const valueStr = fmt(value);

  // ---- レアリティ決定（特殊数字は昇格）----
  let rarity = rollResultRarity();
  const digits = valueStr.replace('-', '').replace('.', '');
  const repdigit = digits.length >= 3 && [...digits].every((c) => c === digits[0]);
  if (valueStr === '777') rarity = 'UR';
  else if (repdigit && RARITY[rarity].level < RARITY.SSR.level) rarity = 'SSR';

  // プチュン: SSR/UR は確定、たまに R でもフェイクで鳴る
  const pchunHit = !isZeroDiv && (RARITY[rarity].level >= 3 || (rarity === 'R' && Math.random() < 0.1));

  try {
    if (isZeroDiv) {
      await celebrateZeroDiv();
    } else if (value === 0 && finalTokens.length > 1) {
      await celebrateZen();
    } else {
      // 期待感: ドラムロール + '?' スピン
      sDrumroll();
      const spin = setInterval(() => setResultText('？'.repeat(Math.min(valueStr.length, 8))), 60);
      await sleep(520);
      clearInterval(spin);

      if (pchunHit) await pchunEffect();

      if (RARITY[rarity].level >= 3) await celebrateBig(rarity, valueStr);
      else await celebrateSmall(rarity, valueStr, pchunHit);
    }
  } finally {
    tokens = [];
    entry = valueStr === '∞' ? '0' : valueStr;
    justEvaluated = true;
    busy = false;
    renderScreen();
    setExpr(finalTokens.map((t) => OPCHAR[t] || t).join(' ') + ' ＝');
    if (!isZeroDiv) addDp(RARITY[rarity].dp * comboMult());
  }
}

// プチュン: 画面が一瞬白く潰れて暗転 → 静寂
async function pchunEffect() {
  const el = $('#pchun'), beam = $('#pchunBeam');
  beam.getAnimations().forEach((a) => a.cancel()); // 前回の fill:forwards をリセット
  el.classList.remove('hidden');
  sPchun();
  vibrate(60);
  await beam.animate(
    [{ transform: 'scaleY(1)', opacity: 1 }, { transform: 'scaleY(0.004)', opacity: 1 }],
    { duration: 130, easing: 'ease-in', fill: 'forwards' }
  ).finished;
  await beam.animate(
    [{ transform: 'scaleY(0.004) scaleX(1)' }, { transform: 'scaleY(0.004) scaleX(0.001)', opacity: 0 }],
    { duration: 90, easing: 'ease-out', fill: 'forwards' }
  ).finished;
  await sleep(750); // 暗黒の静寂 …
  el.classList.add('hidden');
}

// N/R/SR: 数字ロール → 着地バースト
async function celebrateSmall(rarity, valueStr, wasFake) {
  const lv = RARITY[rarity].level;
  const dur = 300 + lv * 220;
  const steps = Math.floor(dur / 45);
  for (let i = 0; i < steps; i++) {
    setResultText(randomDigits(valueStr));
    sTick(i);
    await sleep(45);
  }
  setResultText(valueStr);
  const r = resultEl.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const colors = lv >= 2 ? RAINBOW : themeColors();

  if (wasFake) { // フェイクプチュンで R … ズコー
    sError();
    flash('#406', 0.3, 260);
    setResultText(valueStr);
    shake('shake-s');
    return;
  }
  sparkBurst(cx, cy, 20 + lv * 25, colors, 5 + lv * 2);
  ring(cx, cy, colors[0]);
  shake(lv >= 2 ? 'shake-m' : 'shake-s');
  flash(themeColor(1), 0.15 + lv * 0.12, 200);
  sCoin();
  if (lv >= 1) sFanfare(1);
  if (lv >= 2) { confettiRain(70, colors); sFanfare(2); fountain(cx, cy, colors); }
  vibrate(20 + lv * 20);
}
function randomDigits(model) {
  return [...model].map((c) => (c >= '0' && c <= '9' ? String(Math.floor(Math.random() * 10)) : c)).join('');
}

// SSR/UR: 全画面バナー + 花火 + 紙吹雪 + ファンファーレ
async function celebrateBig(rarity, valueStr) {
  const isUR = rarity === 'UR';
  const banner = $('#banner');
  const colors = RAINBOW;

  flash('#fff', 1, 350);
  sExplosion();
  shake('shake-l');
  vibrate([40, 60, 40, 60, 120]);
  ring(W / 2, H / 2, '#ffffff', 400);
  sparkBurst(W / 2, H / 2, 90, colors, 11);

  $('#bRarity').textContent = isUR && valueStr === '777' ? '🎰 JACKPOT' : rarity + '!!';
  $('#bRarity').classList.toggle('rainbow', isUR);
  $('#bSub').textContent = 'TAP TO CONTINUE';
  banner.classList.toggle('ur', isUR);
  banner.classList.remove('glitch');

  // 数字を一桁ずつ叩き込む
  const num = $('#bNum');
  num.innerHTML = '';
  const chars = [...valueStr];
  chars.forEach((c, i) => {
    const s = document.createElement('span');
    s.className = 'slam';
    s.textContent = c;
    s.style.animationDelay = `${0.25 + i * 0.09}s`;
    num.appendChild(s);
    setTimeout(() => {
      noise({ dur: 0.12, vol: 0.22, from: 1800, to: 200 });
      shake('shake-m');
      sparkBurst(rand(W * 0.3, W * 0.7), rand(H * 0.3, H * 0.6), 14, colors, 6);
    }, 250 + i * 90);
  });

  banner.classList.remove('hidden');
  if (isUR) document.body.classList.add('ur-mode');

  sFanfare(isUR ? 3 : 2);
  confettiRain(isUR ? 220 : 140, colors);
  fireworksBarrage(isUR ? 14 : 6, colors, isUR ? 3200 : 1600);
  for (let i = 0; i < (isUR ? 10 : 5); i++) sCoin(0.5 + i * 0.12);
  fountain(W * 0.2, H, colors, 30);
  fountain(W * 0.8, H, colors, 30);

  await dismissable(isUR ? 5500 : 4000, banner);
  banner.classList.add('hidden');
  document.body.classList.remove('ur-mode');
  resultEl.classList.add('rainbow');
  setTimeout(() => resultEl.classList.remove('rainbow'), 4000);
}

// ゼロ除算: グリッチ ∞
async function celebrateZeroDiv() {
  sError();
  flash('#f0f', 0.5, 300);
  shake('shake-l');
  vibrate([80, 40, 80]);
  const banner = $('#banner');
  $('#bRarity').textContent = 'ZERO DIVIDE';
  $('#bRarity').classList.remove('rainbow');
  $('#bNum').innerHTML = '<span class="slam" style="animation-delay:.1s">∞</span>';
  $('#bSub').textContent = '宇宙が壊れた';
  banner.classList.remove('ur');
  banner.classList.add('glitch');
  banner.classList.remove('hidden');
  const glitchTimer = setInterval(() => { sTick(Math.floor(rand(0, 8))); flash('#0ff', 0.08, 60); }, 180);
  await dismissable(2600, banner);
  clearInterval(glitchTimer);
  banner.classList.add('hidden');
  banner.classList.remove('glitch');
}

// 結果 0: 「無」
async function celebrateZen() {
  sZen();
  setResultText('0');
  const banner = $('#banner');
  $('#bRarity').textContent = '無';
  $('#bRarity').classList.remove('rainbow');
  $('#bNum').innerHTML = '<span class="slam" style="animation-delay:.3s">0</span>';
  $('#bSub').textContent = 'すべては無に帰す';
  banner.classList.remove('ur', 'glitch');
  banner.classList.remove('hidden');
  await dismissable(2200, banner);
  banner.classList.add('hidden');
}

function dismissable(ms, el) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; el.removeEventListener('pointerdown', finish); resolve(); } };
    el.addEventListener('pointerdown', finish);
    setTimeout(finish, ms);
  });
}

// ---------------- skin gacha ----------------
const modal = $('#gachaModal'), capsule = $('#capsule'), gcard = $('#gcard');
let gachaBusy = false;

$('#gachaBtn').addEventListener('click', () => {
  if (busy) return;
  ac();
  sChime();
  renderGacha();
  modal.classList.remove('hidden');
});
$('#gachaClose').addEventListener('click', () => { if (!gachaBusy) modal.classList.add('hidden'); });
modal.addEventListener('pointerdown', (e) => { if (e.target === modal && !gachaBusy) modal.classList.add('hidden'); });

function swatchCss(t) {
  return `linear-gradient(90deg, ${t.vars['--ac1']}, ${t.vars['--ac2']})`;
}
function renderGacha() {
  renderDp();
  $('#grollBtn').disabled = save.dp < GACHA_COST;
  const col = $('#gcollection');
  col.innerHTML = '';
  for (const t of THEMES) {
    const owned = save.owned.includes(t.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gitem' + (owned ? '' : ' locked') + (t.id === save.equipped ? ' equipped' : '');
    b.style.setProperty('--gc', RARITY[t.r].color);
    b.innerHTML = `<div class="sw" style="background:${owned ? swatchCss(t) : '#333'}"></div>` +
      `<span class="nm">${owned ? t.name : '？？？'}</span><span class="rr">${t.r}</span>`;
    if (owned) b.addEventListener('click', () => {
      save.equipped = t.id; persist(); applyTheme(); renderGacha();
      sChime();
      sparkBurst(W / 2, H / 2, 40, themeColors(), 8);
      flash(t.vars['--ac1'], 0.25, 250);
    });
    col.appendChild(b);
  }
}

function rollSkin() {
  const r = Math.random();
  const rarity = r < 0.03 ? 'UR' : r < 0.15 ? 'SSR' : r < 0.40 ? 'SR' : 'R';
  // その希少度のプールから抽選（空なら1段下げる）
  const order = ['UR', 'SSR', 'SR', 'R', 'N'];
  let i = order.indexOf(rarity);
  let pool = [];
  while (i < order.length && !(pool = THEMES.filter((t) => t.r === order[i])).length) i++;
  return pick(pool);
}

$('#grollBtn').addEventListener('click', async () => {
  if (gachaBusy || save.dp < GACHA_COST) return;
  gachaBusy = true;
  $('#grollBtn').disabled = true;
  addDp(-GACHA_COST, false);
  renderDp();

  gcard.classList.add('hidden');
  capsule.classList.remove('hidden');

  const theme = rollSkin();
  const lv = RARITY[theme.r].level;
  const isNew = !save.owned.includes(theme.id);

  // カプセルがガタガタ震える
  capsule.classList.add('rattle');
  for (let i = 0; i < 9; i++) { noise({ dur: 0.03, vol: 0.12, from: 3000, to: 1200, delay: i * 0.13 }); }
  await sleep(1200);
  capsule.classList.remove('rattle');

  if (lv >= 3) await pchunEffect();

  // 開封!!
  capsule.classList.add('hidden');
  const rc = $('#gstage').getBoundingClientRect();
  const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
  const colors = lv >= 3 ? RAINBOW : themeColors();
  sparkBurst(cx, cy, 40 + lv * 30, colors, 7 + lv * 2);
  ring(cx, cy, RARITY[theme.r].color);
  flash(lv >= 3 ? '#fff' : RARITY[theme.r].color, 0.3 + lv * 0.18, 300);
  shake(lv >= 3 ? 'shake-l' : 'shake-m');
  vibrate(lv >= 3 ? [40, 60, 40, 120] : 40);
  sFanfare(Math.max(1, lv));
  if (lv >= 3) { confettiRain(150, RAINBOW); fireworksBarrage(lv >= 4 ? 8 : 4, RAINBOW); sExplosion(); }

  gcard.style.setProperty('--gc', RARITY[theme.r].color);
  $('#gcardRarity').textContent = theme.r;
  $('#gcardRarity').classList.toggle('rainbow', theme.r === 'UR');
  $('#gcardSwatch').style.background = swatchCss(theme);
  $('#gcardName').textContent = theme.name;

  if (isNew) {
    save.owned.push(theme.id);
    save.equipped = theme.id;
    $('#gcardNote').textContent = '✨ NEW! 装備しました';
    applyTheme();
  } else {
    const refund = Math.floor(GACHA_COST / 2);
    addDp(refund);
    $('#gcardNote').textContent = `かぶった… +${refund} DP 返却`;
  }
  persist();
  gcard.classList.remove('hidden');
  renderGacha();
  gachaBusy = false;
});

// ---------------- init ----------------
renderScreen();
window.addEventListener('pointerdown', () => ac(), { once: true });
