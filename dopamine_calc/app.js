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
function sFanfare(rawLevel) {
  const level = Math.min(3, Math.max(1, rawLevel)); // 楽譜は 1..3（UR などレベル4以上は 3 を使う）
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
const MAX_PARTS = 1600;
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
  // ---- N (6) ----
  { id: 'neon',     name: 'ネオン・パルス',     r: 'N',   vars: { '--bg1': '#0a0e1f', '--bg2': '#170b2b', '--ac1': '#00e5ff', '--ac2': '#ff2d95', '--key': '#141a2e', '--keyop': '#232b4a', '--txt': '#eaf6ff' } },
  { id: 'citrus',   name: '電光シトラス',       r: 'N',   vars: { '--bg1': '#101a0a', '--bg2': '#0a2415', '--ac1': '#aaff00', '--ac2': '#ffb300', '--key': '#16240f', '--keyop': '#243c18', '--txt': '#f2ffe0' } },
  { id: 'crt',      name: 'ブラウン管レトロ',   r: 'N',   vars: { '--bg1': '#0d0d0d', '--bg2': '#1a1206', '--ac1': '#33ff66', '--ac2': '#ffcc33', '--key': '#161616', '--keyop': '#242416', '--txt': '#d9ffe6' } },
  { id: 'mono',     name: 'モノクローム',       r: 'N',   vars: { '--bg1': '#0e0e12', '--bg2': '#17171d', '--ac1': '#e8e8f0', '--ac2': '#9aa0b4', '--key': '#1a1a22', '--keyop': '#26262f', '--txt': '#f2f2f7' } },
  { id: 'soda',     name: 'クリームソーダ',     r: 'N',   vars: { '--bg1': '#06231d', '--bg2': '#0b3328', '--ac1': '#7dffc4', '--ac2': '#fff3b0', '--key': '#0c2f26', '--keyop': '#14453a', '--txt': '#eafff5' } },
  { id: 'sunset',   name: 'たそがれ',           r: 'N',   vars: { '--bg1': '#211033', '--bg2': '#3a1226', '--ac1': '#ff9e5e', '--ac2': '#c86bff', '--key': '#2b1638', '--keyop': '#3f2050', '--txt': '#ffeede' } },
  // ---- R (6) ----
  { id: 'sakura',   name: '夜桜',               r: 'R',   vars: { '--bg1': '#1a0b18', '--bg2': '#2b0f24', '--ac1': '#ff8ad8', '--ac2': '#ffd6f2', '--key': '#251223', '--keyop': '#3a1c34', '--txt': '#fff0fa' } },
  { id: 'deepsea',  name: '深海プリズム',       r: 'R',   vars: { '--bg1': '#041225', '--bg2': '#062a3a', '--ac1': '#35d0ff', '--ac2': '#7dffd4', '--key': '#08203a', '--keyop': '#0d3352', '--txt': '#e2f8ff' } },
  { id: 'vapor',    name: 'ヴェイパーウェイヴ', r: 'R',   vars: { '--bg1': '#17092e', '--bg2': '#2b0b3a', '--ac1': '#01cdfe', '--ac2': '#ff71ce', '--key': '#221240', '--keyop': '#341b58', '--txt': '#f4eaff' } },
  { id: 'matcha',   name: '抹茶ラテ',           r: 'R',   vars: { '--bg1': '#17200d', '--bg2': '#25301a', '--ac1': '#b7e26b', '--ac2': '#f5e6c8', '--key': '#202c12', '--keyop': '#2f401c', '--txt': '#f4ffe4' } },
  { id: 'aurora',   name: 'オーロラ',           r: 'R',   vars: { '--bg1': '#04101f', '--bg2': '#0a1f33', '--ac1': '#5effc3', '--ac2': '#7f8cff', '--key': '#08182b', '--keyop': '#0f2540', '--txt': '#e6fbff' } },
  { id: 'candy',    name: 'キャンディポップ',   r: 'R',   vars: { '--bg1': '#240f1e', '--bg2': '#1a1030', '--ac1': '#ff9ad5', '--ac2': '#8ad9ff', '--key': '#2f1530', '--keyop': '#43204a', '--txt': '#ffeefa' } },
  // ---- SR (5) ----
  { id: 'gold',     name: '黄金郷',             r: 'SR',  vars: { '--bg1': '#1a1204', '--bg2': '#000000', '--ac1': '#ffd700', '--ac2': '#ff9500', '--key': '#241a08', '--keyop': '#3a2a0c', '--txt': '#fff6d5' } },
  { id: 'cyber',    name: '電脳歌舞伎町',       r: 'SR',  vars: { '--bg1': '#12001a', '--bg2': '#001a2e', '--ac1': '#f7ff00', '--ac2': '#ff003c', '--key': '#1c0828', '--keyop': '#2c0f3e', '--txt': '#fdfaff' } },
  { id: 'oni',      name: '鬼灯',               r: 'SR',  vars: { '--bg1': '#1a0505', '--bg2': '#2e0b06', '--ac1': '#ff4d2e', '--ac2': '#ffb347', '--key': '#260a08', '--keyop': '#3b120c', '--txt': '#ffe9dd' } },
  { id: 'pixel',    name: '8bitアーケード',     r: 'SR',  vars: { '--bg1': '#000000', '--bg2': '#101010', '--ac1': '#00ff41', '--ac2': '#ff00a8', '--key': '#101a10', '--keyop': '#1c281c', '--txt': '#d8ffd8' } },
  { id: 'ninja',    name: '月夜ノ忍',           r: 'SR',  vars: { '--bg1': '#0b0e1a', '--bg2': '#141a30', '--ac1': '#aab8ff', '--ac2': '#e6e9f5', '--key': '#121627', '--keyop': '#1c2340', '--txt': '#eef1ff' } },
  // ---- SSR (4) ----
  { id: 'galaxy',   name: '銀河の果て',         r: 'SSR', vars: { '--bg1': '#050514', '--bg2': '#120a33', '--ac1': '#8f7bff', '--ac2': '#59f3ff', '--key': '#0d0d26', '--keyop': '#1a1642', '--txt': '#eeeaff' } },
  { id: 'inferno',  name: '獄炎',               r: 'SSR', vars: { '--bg1': '#1c0400', '--bg2': '#330a00', '--ac1': '#ff5a00', '--ac2': '#ffd24d', '--key': '#2a0d04', '--keyop': '#421407', '--txt': '#fff1e0' } },
  { id: 'prism',    name: 'プリズムコア',       r: 'SSR', vars: { '--bg1': '#101018', '--bg2': '#181826', '--ac1': '#7bffea', '--ac2': '#ff7bd5', '--key': '#181828', '--keyop': '#242438', '--txt': '#f4ffff' } },
  { id: 'ryu',      name: '龍脈',               r: 'SSR', vars: { '--bg1': '#041508', '--bg2': '#0a2410', '--ac1': '#4dffa1', '--ac2': '#ffd700', '--key': '#082010', '--keyop': '#0f321c', '--txt': '#e8ffee' } },
  // ---- UR (3) ----
  { id: 'divine',   name: '神域',               r: 'UR',  vars: { '--bg1': '#fff8dc', '--bg2': '#ffe9a8', '--ac1': '#ffb300', '--ac2': '#ff4dd2', '--key': '#fff3c4', '--keyop': '#ffe08a', '--txt': '#4a3000', '--screen': 'rgba(255, 255, 255, 0.55)' } },
  { id: 'zero',     name: '虚無零式',           r: 'UR',  vars: { '--bg1': '#000000', '--bg2': '#0a0a0c', '--ac1': '#ff0033', '--ac2': '#ffffff', '--key': '#0d0d10', '--keyop': '#16161c', '--txt': '#f5f5f7' } },
  { id: 'matsuri',  name: '祭・大勝利',         r: 'UR',  vars: { '--bg1': '#2a0505', '--bg2': '#3d0f00', '--ac1': '#ffd700', '--ac2': '#ff3d3d', '--key': '#331008', '--keyop': '#4a1a0a', '--txt': '#fff3d6' } },
];
const RARITY = {
  N:   { color: '#9aa5b1', dp: 25,   level: 0 },
  R:   { color: '#4da3ff', dp: 50,   level: 1 },
  SR:  { color: '#c366ff', dp: 100,  level: 2 },
  SSR: { color: '#ffd24d', dp: 300,  level: 3 },
  UR:  { color: '#ff4dd2', dp: 1000, level: 4 },
};
const GACHA_COST = 100;
const GACHA_COST_10 = 900;   // 10連は1割引
const GACHA_COST_50 = 4000;  // 50連は2割引

// ---------------- persistent state ----------------
const SAVE_KEY = 'dopamine_calc_v1';
let save = { dp: 150, owned: ['neon'], equipped: 'neon', lv: {} };
try {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) save = Object.assign(save, JSON.parse(raw));
} catch (_) {}
if (!save.lv) save.lv = {}; // 旧セーブデータ対応
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {} }

function curTheme() { return THEMES.find((t) => t.id === save.equipped) || THEMES[0]; }
function themeColor(n) { return curTheme().vars[`--ac${n}`]; }
function themeColors() { return [themeColor(1), themeColor(2), '#ffffff']; }
// ---- スキン成長（被り蓄積 Lv）----
// 被り1回で装備スキンとは無関係にそのスキンの Lv が +1。最大 1000（極）。
// 装備中スキンの Lv が高いほど演出が派手になる:
//  - パーティクル量とグローが連続的に成長（Lv1000 で約4倍）
//  - Lv 10/50/100/500/1000 でティア解放（火の粉→脈動→光線→極）
const LV_MAX = 1000;
const FX_TIERS = [10, 50, 100, 500, 1000];
function lvOf(id) { return save.lv[id] || 0; }
function bumpLv(id) { const v = Math.min(LV_MAX, lvOf(id) + 1); save.lv[id] = v; return v; }
function fxTier(L) { let t = 0; for (const th of FX_TIERS) if (L >= th) t++; return t; }
// 装備スキンのパーティクル倍率: Lv0=1倍, Lv10≈2倍, Lv100=3倍, Lv1000=4倍
function fxMult() { return 1 + Math.log10(1 + lvOf(save.equipped)); }

let emberTimer = null;
function updateEmbers(tier) {
  clearInterval(emberTimer);
  emberTimer = null;
  if (tier < 2) return;
  const period = [0, 0, 420, 260, 150, 80][tier]; // ティアが上がるほど火の粉が濃くなる
  emberTimer = setInterval(() => {
    if (document.hidden) return;
    push({ t: 'spark', x: rand(0, W), y: H + 6, vx: rand(-0.4, 0.4), vy: rand(-2.6, -1.2), g: -0.01, life: 1, dec: rand(0.006, 0.012), size: rand(1.2, 2.6), color: pick(themeColors()) });
  }, period);
}
function renderLvBadge() {
  const L = lvOf(save.equipped);
  $('#lvBadge').textContent = L ? `⚡Lv.${L}${L >= LV_MAX ? ' 極' : ''}` : '';
}

const THEME_DEFAULTS = { '--screen': 'rgba(0, 0, 0, 0.35)' };
function applyTheme() {
  // テーマが持たない変数はデフォルトに戻してから上書き（切替時の残留防止）
  for (const [k, v] of Object.entries(THEME_DEFAULTS)) document.documentElement.style.setProperty(k, v);
  for (const [k, v] of Object.entries(curTheme().vars)) document.documentElement.style.setProperty(k, v);
  // 装備スキンの成長を反映
  const L = lvOf(save.equipped), tier = fxTier(L);
  document.documentElement.style.setProperty('--glowpx', `${10 + Math.round(20 * Math.log10(1 + L) / 3)}px`);
  for (let i = 1; i <= 5; i++) document.body.classList.toggle('fx-t' + i, tier >= i);
  updateEmbers(tier);
  renderLvBadge();
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
  sparkBurst(r.left + r.width / 2, r.top + r.height / 2, Math.round(8 * fxMult()), themeColors(), 4);
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
  sparkBurst(cx, cy, Math.round((20 + lv * 25) * fxMult()), colors, 5 + lv * 2);
  ring(cx, cy, colors[0]);
  shake(lv >= 2 ? 'shake-m' : 'shake-s');
  flash(themeColor(1), 0.15 + lv * 0.12, 200);
  sCoin();
  if (lv >= 1) sFanfare(1);
  if (lv >= 2) { confettiRain(Math.round(70 * fxMult()), colors); sFanfare(2); fountain(cx, cy, colors); }
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
  sparkBurst(W / 2, H / 2, Math.round(90 * fxMult()), colors, 11);

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
  confettiRain(Math.round((isUR ? 220 : 140) * fxMult()), colors);
  fireworksBarrage((isUR ? 14 : 6) + Math.round(3 * (fxMult() - 1)), colors, isUR ? 3200 : 1600);
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
const gmulti = $('#gmulti'), gsummary = $('#gsummary');
let gachaBusy = false;

// 演出ステージを初期状態（カプセルのみ）に戻す
function clearStage() {
  gcard.classList.add('hidden');
  gmulti.classList.add('hidden');
  gsummary.classList.add('hidden');
  capsule.classList.remove('hidden');
}
async function capsuleRattle(ms) {
  capsule.classList.add('rattle');
  for (let i = 0; i < Math.floor(ms / 130); i++) noise({ dur: 0.03, vol: 0.12, from: 3000, to: 1200, delay: i * 0.13 });
  await sleep(ms);
  capsule.classList.remove('rattle');
}

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
  $('#grollBtn').disabled = gachaBusy || save.dp < GACHA_COST;
  $('#groll10').disabled = gachaBusy || save.dp < GACHA_COST_10;
  $('#groll50').disabled = gachaBusy || save.dp < GACHA_COST_50;
  const col = $('#gcollection');
  col.innerHTML = '';
  for (const t of THEMES) {
    const owned = save.owned.includes(t.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gitem' + (owned ? '' : ' locked') + (t.id === save.equipped ? ' equipped' : '');
    b.style.setProperty('--gc', RARITY[t.r].color);
    const L = lvOf(t.id);
    b.innerHTML = `<div class="sw" style="background:${owned ? swatchCss(t) : '#333'}"></div>` +
      `<span class="nm">${owned ? t.name : '？？？'}</span><span class="rr">${t.r}</span>` +
      (owned && L ? `<span class="lv">⚡Lv.${L}${L >= LV_MAX ? ' 極' : ''}</span>` : '');
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
  // UR 3% / SSR 12% / SR 25% / R 30% / N 30%
  const rarity = r < 0.03 ? 'UR' : r < 0.15 ? 'SSR' : r < 0.40 ? 'SR' : r < 0.70 ? 'R' : 'N';
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

  try {
    clearStage();

    const theme = rollSkin();
    const lv = RARITY[theme.r].level;
    const isNew = !save.owned.includes(theme.id);

    await capsuleRattle(1200);
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
    sFanfare(lv);
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
    } else {
      const before = lvOf(theme.id);
      const after = bumpLv(theme.id);
      const tierUp = fxTier(after) > fxTier(before);
      $('#gcardNote').textContent =
        `かぶり → 熱量 Lv.${after}${after >= LV_MAX ? '（極）' : ''} に成長！${tierUp ? ' 🔥TIER UP!' : ''}`;
      if (tierUp) { sFanfare(2); confettiRain(80, RAINBOW); flash(RARITY[theme.r].color, 0.3, 250); vibrate([30, 40, 60]); }
    }
    applyTheme(); // 装備スキンの成長/変更をバッジ・オーラに反映
    persist();
    gcard.classList.remove('hidden');
  } finally {
    // 演出中に何が起きてもモーダルが固まらないようにする
    gachaBusy = false;
    renderGacha();
  }
});

// ---- 多連ガチャ ----
async function multiRoll(n, cost) {
  if (gachaBusy || save.dp < cost) return;
  gachaBusy = true;
  renderGacha();
  addDp(-cost, false);
  renderDp();

  try {
    clearStage();

    // 先に全結果を確定してから開封演出する
    const ownedSet = new Set(save.owned);
    const results = [];
    const counts = { UR: 0, SSR: 0, SR: 0, R: 0, N: 0 };
    let best = null, dupCount = 0, tierUps = 0, newCount = 0;
    for (let i = 0; i < n; i++) {
      const t = rollSkin();
      const isNew = !ownedSet.has(t.id);
      if (isNew) { ownedSet.add(t.id); newCount++; }
      else {
        dupCount++;
        const before = lvOf(t.id);
        if (fxTier(bumpLv(t.id)) > fxTier(before)) tierUps++;
      }
      counts[t.r]++;
      results.push({ t, isNew });
      if (!best || RARITY[t.r].level > RARITY[best.r].level) best = t;
    }
    const maxLv = RARITY[best.r].level;

    await capsuleRattle(n >= 50 ? 1500 : 1200);
    if (maxLv >= 3) await pchunEffect();
    capsule.classList.add('hidden');

    // タイルを並べて1枚ずつ開封
    gmulti.innerHTML = '';
    gmulti.classList.toggle('dense', n > 10);
    gmulti.classList.remove('hidden');
    const tiles = results.map(({ t, isNew }) => {
      const d = document.createElement('div');
      d.className = 'gtile' + (RARITY[t.r].level >= 3 ? ' hi' : '');
      d.style.setProperty('--gc', RARITY[t.r].color);
      d.style.background = `linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)), ${swatchCss(t)}`;
      d.textContent = t.r;
      if (isNew) d.insertAdjacentHTML('beforeend', '<i class="newdot"></i>');
      gmulti.appendChild(d);
      return d;
    });
    const baseDelay = n > 10 ? 70 : 160;
    for (let i = 0; i < n; i++) {
      const { t } = results[i], lv = RARITY[t.r].level, tile = tiles[i];
      if (lv >= 3) await sleep(260); // レア前の溜め
      tile.classList.add('show');
      const rc = tile.getBoundingClientRect();
      const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
      if (lv >= 4) {
        sExplosion(); sFanfare(3); flash('#fff', 0.7, 300); shake('shake-l');
        sparkBurst(cx, cy, 60, RAINBOW, 9); ring(cx, cy, '#ffffff', 260); vibrate([40, 60, 120]);
        await sleep(700);
      } else if (lv === 3) {
        sExplosion(); flash(RARITY.SSR.color, 0.35, 240); shake('shake-m');
        sparkBurst(cx, cy, 36, RAINBOW, 7); ring(cx, cy, RARITY.SSR.color, 180); vibrate(60);
        await sleep(420);
      } else if (lv === 2) {
        sChime(); sparkBurst(cx, cy, 14, themeColors(), 5); vibrate(20);
        await sleep(baseDelay + 90);
      } else {
        sTick(i % 16);
        await sleep(baseDelay);
      }
    }

    // 戦果反映
    save.owned = [...ownedSet];
    const newBest = results.filter((r) => r.isNew).map((r) => r.t)
      .sort((a, b) => RARITY[b.r].level - RARITY[a.r].level)[0];
    if (newBest) save.equipped = newBest.id;
    applyTheme(); // 装備変更/成長を反映
    persist();

    const countStr = ['UR', 'SSR', 'SR', 'R', 'N'].filter((r) => counts[r])
      .map((r) => `<span class="rr" style="color:${RARITY[r].color}">${r}×${counts[r]}</span>`).join('　');
    gsummary.innerHTML =
      `<div class="best">最高レア <span class="rr" style="color:${RARITY[best.r].color}">${best.r}</span>「${best.name}」</div>` +
      `<div>${countStr}</div>` +
      `<div>${newBest ? `✨ NEW ${newCount}件 →「${newBest.name}」を装備` : 'NEWなし…'}` +
      `${dupCount ? ` ／ かぶり${dupCount}件 → 成長 +${dupCount}Lv` : ''}` +
      `${tierUps ? ` <span class="rr" style="color:#ffe45c">🔥TIER UP×${tierUps}</span>` : ''}</div>`;
    gsummary.classList.remove('hidden');
    if (tierUps) { sFanfare(2); vibrate([30, 40, 60]); }

    // 〆の花火
    if (maxLv >= 4) { confettiRain(220, RAINBOW); fireworksBarrage(12, RAINBOW, 2600); sFanfare(3); }
    else if (maxLv === 3) { confettiRain(140, RAINBOW); fireworksBarrage(6, RAINBOW, 1800); sFanfare(2); }
    else { confettiRain(50, themeColors()); sFanfare(1); }
  } finally {
    gachaBusy = false;
    renderGacha();
  }
}
$('#groll10').addEventListener('click', () => multiRoll(10, GACHA_COST_10));
$('#groll50').addEventListener('click', () => multiRoll(50, GACHA_COST_50));

// ---------------- init ----------------
renderScreen();
window.addEventListener('pointerdown', () => ac(), { once: true });
