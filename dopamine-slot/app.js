'use strict';
/* ============================================================
   DOPAMINE SLOT 🎲 — ドーパミンドバドバのスロット/サイコロ
   - リール数(1〜8)・各面数(2〜1000)を自由設定
   - シード付き乱数で「結果も演出分岐も」決定論化
     → URL 共有で同じ演出を完全再現できる
   - 共有パラメータは XOR + チェックサムで難読化。
     書き換えるとチェックサム不一致で読み込み拒否
   - クイックモード = 演出オフの普通のサイコロ
   ============================================================ */

// ---------------- utils ----------------
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };
const RAINBOW = ['#ff004c', '#ff8000', '#ffee00', '#00ff6a', '#00cfff', '#7b2dff', '#ff4dd2'];
const THEME = ['#ffd24d', '#ff2d95', '#59f3ff', '#ffffff'];

// 決定論用 PRNG（シードが同じなら列も同じ）
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// ---------------- 共有コーデック（難読化 + 改ざん検知） ----------------
// JSON → [FNV-1aチェックサム4B + 本文] → XORストリーム → base64url。
// 暗号ではなく難読化: 手で書き換えるとチェックサムが合わず decode が null を返す。
const XOR_SEED = fnv1a(new TextEncoder().encode('dopamine-slot/v1'));
function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unb64u(s) {
  s = s.replaceAll('-', '+').replaceAll('_', '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function encodeShare(obj) {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const h = fnv1a(data);
  const out = new Uint8Array(4 + data.length);
  out[0] = h & 255; out[1] = (h >>> 8) & 255; out[2] = (h >>> 16) & 255; out[3] = (h >>> 24) & 255;
  out.set(data, 4);
  const ks = mulberry32(XOR_SEED);
  for (let i = 0; i < out.length; i++) out[i] ^= Math.floor(ks() * 256);
  return b64u(out);
}
function decodeShare(s) {
  try {
    const out = unb64u(s);
    if (out.length < 5) return null;
    const ks = mulberry32(XOR_SEED);
    for (let i = 0; i < out.length; i++) out[i] ^= Math.floor(ks() * 256);
    const h = (out[0] | (out[1] << 8) | (out[2] << 16) | (out[3] << 24)) >>> 0;
    const data = out.slice(4);
    if (fnv1a(data) !== h) return null; // 改ざん or 破損
    return JSON.parse(new TextDecoder().decode(data));
  } catch (_) { return null; }
}

// ---------------- audio (WebAudio 合成) ----------------
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
const sLever = () => { tone({ freq: 150, end: 55, dur: 0.16, type: 'square', vol: 0.25 }); noise({ dur: 0.1, vol: 0.2, from: 1600, to: 300 }); };
const sSpinTick = () => tone({ freq: 950, dur: 0.02, type: 'square', vol: 0.045 });
const sThunk = () => { noise({ dur: 0.12, vol: 0.3, from: 900, to: 150 }); tone({ freq: 130, end: 55, dur: 0.14, type: 'sine', vol: 0.4 }); };
const sHeart = () => { tone({ freq: 62, dur: 0.1, type: 'sine', vol: 0.55 }); tone({ freq: 55, dur: 0.12, type: 'sine', vol: 0.45, delay: 0.18 }); };
const sReachIn = () => { tone({ freq: 700, end: 1500, dur: 0.3, type: 'sawtooth', vol: 0.12 }); tone({ freq: 700, end: 1500, dur: 0.3, type: 'sawtooth', vol: 0.12, delay: 0.35 }); };
const sNudge = () => { tone({ freq: 500, end: 900, dur: 0.14, type: 'square', vol: 0.16 }); };
const sZuko = () => {
  [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'sawtooth', vol: 0.16, delay: i * 0.17 }));
  noise({ dur: 0.25, vol: 0.2, from: 500, to: 80, delay: 0.55 });
};
const sPchun = () => { tone({ freq: 3200, end: 40, dur: 0.16, type: 'sine', vol: 0.5 }); noise({ dur: 0.05, vol: 0.25, from: 8000, to: 3000 }); };
const sExplosion = () => { noise({ dur: 0.7, vol: 0.55, from: 3500, to: 60 }); tone({ freq: 160, end: 28, dur: 0.6, type: 'sine', vol: 0.5 }); };
const sCoin = (delay = 0) => { tone({ freq: 1174.7, dur: 0.06, type: 'square', vol: 0.1, delay }); tone({ freq: 1568, dur: 0.35, type: 'square', vol: 0.1, delay: delay + 0.06 }); };
const sChime = () => { [0, 4, 7].forEach((st, i) => tone({ freq: 880 * Math.pow(2, st / 12), dur: 0.3, type: 'sine', vol: 0.12, delay: i * 0.03 })); };
function sFanfare(rawLevel) {
  const level = Math.min(3, Math.max(1, rawLevel));
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
function goldRain(n) {
  for (let i = 0; i < n; i++) {
    push({ t: 'conf', x: rand(0, W), y: rand(-H * 0.5, -10), vx: rand(-0.8, 0.8), vy: rand(3, 7), g: 0.08, life: 1, dec: rand(0.003, 0.006), size: rand(6, 11), color: pick(['#ffd24d', '#ffb300', '#fff3b0']), rot: rand(0, 6.28), vr: rand(-0.3, 0.3), ph: rand(0, 6.28) });
  }
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

// カーソル軌跡キラキラ
let lastTrail = 0;
window.addEventListener('pointermove', (e) => {
  const now = performance.now();
  if (now - lastTrail < 40) return;
  lastTrail = now;
  push({ t: 'spark', x: e.clientX, y: e.clientY, vx: rand(-0.6, 0.6), vy: rand(-0.6, 0.6), g: 0.02, life: 0.7, dec: 0.04, size: rand(1, 2.4), color: pick(THEME) });
});

// ---------------- flash / shake / toast ----------------
const flashEl = $('#flash');
function flash(color = '#fff', peak = 0.9, dur = 220) {
  flashEl.style.background = color;
  flashEl.animate([{ opacity: peak }, { opacity: 0 }], { duration: dur, easing: 'ease-out' });
}
function shake(cls) {
  const el = $('#app');
  el.classList.remove('shake-s', 'shake-m', 'shake-l');
  void el.offsetWidth;
  el.classList.add(cls);
}
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// ---------------- プチュン ----------------
async function pchunEffect() {
  const el = $('#pchun'), beam = $('#pchunBeam');
  beam.getAnimations().forEach((a) => a.cancel());
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
  await sleep(750);
  el.classList.add('hidden');
}

// ---------------- banner ----------------
function dismissable(ms, el) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; el.removeEventListener('pointerdown', finish); resolve(); } };
    el.addEventListener('pointerdown', finish);
    setTimeout(finish, ms);
  });
}
async function showBanner({ title, num, sub, cls = '', dur = 4000, rainbowTitle = false }) {
  const banner = $('#banner');
  banner.className = cls; // hidden も外れる
  $('#bTitle').textContent = title;
  $('#bTitle').classList.toggle('rainbow', rainbowTitle);
  $('#bSub').textContent = sub || 'TAP TO CONTINUE';
  const numEl = $('#bNum');
  numEl.innerHTML = '';
  [...num].forEach((c, i) => {
    const s = document.createElement('span');
    s.className = 'slam';
    s.textContent = c;
    s.style.animationDelay = `${0.25 + i * 0.09}s`;
    numEl.appendChild(s);
    if (c !== ' ') setTimeout(() => {
      noise({ dur: 0.12, vol: 0.22, from: 1800, to: 200 });
      shake('shake-m');
      sparkBurst(rand(W * 0.3, W * 0.7), rand(H * 0.3, H * 0.6), 14, RAINBOW, 6);
    }, 250 + i * 90);
  });
  await dismissable(dur, banner);
  banner.className = 'hidden';
}

// ---------------- state ----------------
const conf = { dice: [6, 6, 6], quick: false };
let busy = false;
let lastRoll = null;   // { d:[...], q:0|1, x:seed } 直前のロール（共有・再演用スナップショット）
let pendingSeed = null;

const MAX_DICE = 8, MIN_FACES = 2, MAX_FACES = 1000;
const clampFaces = (v) => Math.min(MAX_FACES, Math.max(MIN_FACES, Math.floor(v) || MIN_FACES));
function validDice(d) {
  return Array.isArray(d) && d.length >= 1 && d.length <= MAX_DICE &&
    d.every((f) => Number.isInteger(f) && f >= MIN_FACES && f <= MAX_FACES);
}
function diceDesc(d = conf.dice) {
  const g = {};
  for (const f of d) g[f] = (g[f] || 0) + 1;
  return Object.entries(g).map(([f, n]) => `${n}d${f}`).join(' + ');
}
function newSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

// ---------------- reels ----------------
const reelsEl = $('#reels');
let reelEls = [];
function buildReels() {
  reelsEl.innerHTML = '';
  reelEls = conf.dice.map((f, i) => {
    const reel = document.createElement('div');
    reel.className = 'reel';
    reel.innerHTML =
      '<div class="window"><div class="strip">' +
      '<div class="cell side">-</div><div class="cell cur">-</div><div class="cell side">-</div>' +
      '</div></div>' +
      `<div class="dlab">d${f}</div>`;
    reelsEl.appendChild(reel);
    return reel;
  });
  $('#total').textContent = '--';
  $('#total').classList.remove('rainbow');
  $('#detail').innerHTML = '&nbsp;';
}
function setReel(i, val, faces) {
  const cells = reelEls[i].querySelectorAll('.cell');
  const prev = val - 1 < 1 ? faces : val - 1;
  const next = val + 1 > faces ? 1 : val + 1;
  cells[0].textContent = prev;
  cells[1].textContent = val;
  cells[2].textContent = next;
  cells[1].style.fontSize = String(val).length >= 3 ? '26px' : '38px';
}
function reelCenter(i) {
  const r = reelEls[i].querySelector('.window').getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

// ---------------- spin engine ----------------
let spinTimers = [];
let tickTimer = null;
function startReelVisual(i, faces, visRng, tickMs = 55) {
  reelEls[i].classList.add('spinning');
  reelEls[i].classList.remove('landed', 'hitglow', 'reachfocus');
  const timer = setInterval(() => setReel(i, 1 + Math.floor(visRng() * faces), faces), tickMs);
  spinTimers[i] = timer;
  return timer;
}
function landReel(i, val, faces, { strong = true } = {}) {
  clearInterval(spinTimers[i]);
  reelEls[i].classList.remove('spinning');
  setReel(i, val, faces);
  reelEls[i].classList.remove('landed');
  void reelEls[i].offsetWidth;
  reelEls[i].classList.add('landed');
  if (strong) {
    sThunk();
    shake('shake-s');
    vibrate(15);
    const [cx, cy] = reelCenter(i);
    sparkBurst(cx, cy, 14, THEME, 5);
  }
}

async function spin(seed) {
  if (busy) return;
  busy = true;
  ac();
  $('#spinBtn').disabled = true;
  $('#shareResult').disabled = true;
  $('#replayBtn').disabled = true;

  const dice = [...conf.dice];
  const quick = conf.quick;
  const n = dice.length;

  // ---- 結果と演出分岐をシードから決定論的に導出 ----
  const rng = mulberry32(seed >>> 0);
  const results = dice.map((f) => 1 + Math.floor(rng() * f));
  const rngFx = mulberry32((seed ^ 0x9e3779b9) >>> 0); // 演出バリエーション用
  const zoro = n >= 2 && results.every((v) => v === results[0]);
  const allMax = results.every((v, i) => v === dice[i]);
  const allOne = n >= 2 && results.every((v) => v === 1);
  const canMatchLast = results[0] <= dice[n - 1];
  const reach = !quick && n >= 2 &&
    results.slice(0, -1).every((v) => v === results[0]) && canMatchLast &&
    (n >= 3 || zoro || rngFx() < 0.35);
  const nudgeBack = zoro && dice[n - 1] >= 3 && rngFx() < 0.5; // 通り過ぎて戻る演出

  try {
    $('#total').textContent = '--';
    $('#total').classList.remove('rainbow');
    $('#detail').innerHTML = '&nbsp;';

    // 全リール回転開始
    sLever();
    vibrate(20);
    spinTimers = [];
    dice.forEach((f, i) => startReelVisual(i, f, mulberry32((seed + i * 7919 + 1) >>> 0)));
    tickTimer = setInterval(sSpinTick, 75);

    const stopBase = quick ? 250 : 900;
    const stopGap = quick ? 130 : 650;

    for (let i = 0; i < n; i++) {
      if (reach && i === n - 1) {
        // ---- リーチ演出 ----
        await sleep(500);
        sReachIn();
        document.body.classList.add('reach');
        reelEls[i].classList.add('reachfocus');
        const hb = setInterval(() => { sHeart(); vibrate(25); }, 600);
        await sleep(2400);
        clearInterval(hb);
        if (nudgeBack) {
          // 当たりの1つ先で止まったフリ → 戻ってジャスト
          landReel(i, results[i] % dice[i] + 1, dice[i]);
          await sleep(550);
          sNudge();
          landReel(i, results[i], dice[i]);
        } else {
          landReel(i, results[i], dice[i]);
        }
        document.body.classList.remove('reach');
        reelEls[i].classList.remove('reachfocus');
      } else {
        await sleep(i === 0 ? stopBase : stopGap);
        landReel(i, results[i], dice[i]);
      }
    }
    clearInterval(tickTimer);

    await celebrate({ dice, results, n, quick, zoro, allMax, allOne, reach });

    lastRoll = { d: dice, q: quick ? 1 : 0, x: seed >>> 0 };
  } finally {
    clearInterval(tickTimer);
    spinTimers.forEach(clearInterval);
    document.body.classList.remove('reach');
    busy = false;
    $('#spinBtn').disabled = false;
    $('#shareResult').disabled = !lastRoll;
    $('#replayBtn').disabled = !lastRoll;
  }
}

// ---------------- celebrations ----------------
function showTotal(results) {
  const total = results.reduce((a, b) => a + b, 0);
  const el = $('#total');
  el.textContent = total.toLocaleString();
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
  $('#detail').textContent = results.length > 1 ? results.join(' + ') + ` = ${total}` : `出目: ${results[0]}`;
  return total;
}

async function celebrate({ dice, results, n, quick, zoro, allMax, allOne, reach }) {
  const total = showTotal(results);
  const box = $('.slotbox').getBoundingClientRect();
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;

  if (quick) { // 普通のサイコロモード: 小さめの気持ちよさだけ
    sCoin();
    sparkBurst(cx, cy, 24, THEME, 6);
    return;
  }

  // 注意: オール1はゾロ目でもあるので、JACKPOT より先に「大凶」判定する
  if (allOne) {
    // ---- 大凶（オール1） ----
    sZuko();
    flash('#7b2dff', 0.4, 300);
    shake('shake-m'); vibrate([80, 40, 80]);
    await showBanner({ title: '大凶…', num: results.join(' '), sub: `TOTAL ${total} ── 出直そう`, cls: 'doom', dur: 3200 });
  } else if (allMax && n >= 2) {
    // ---- 天元突破（全リール最大値） ----
    await pchunEffect();
    flash('#fff', 1, 350);
    sExplosion(); sFanfare(3);
    shake('shake-l'); vibrate([50, 60, 50, 60, 150]);
    ring(W / 2, H / 2, '#ffffff', 420);
    sparkBurst(W / 2, H / 2, 130, RAINBOW, 12);
    confettiRain(260, RAINBOW);
    goldRain(120);
    fireworksBarrage(16, RAINBOW, 3400);
    for (let i = 0; i < 12; i++) sCoin(0.5 + i * 0.11);
    document.body.classList.add('jackpot-mode');
    $('#total').classList.add('rainbow');
    await showBanner({ title: '天元突破', num: results.join(' '), sub: `TOTAL ${total} ── 全スロット最大値`, cls: 'mega', dur: 6000 });
    document.body.classList.remove('jackpot-mode');
  } else if (zoro && n >= 2) {
    // ---- JACKPOT（ゾロ目） ----
    await pchunEffect();
    flash('#fff', 0.95, 320);
    sExplosion(); sFanfare(3);
    shake('shake-l'); vibrate([40, 60, 40, 60, 120]);
    ring(W / 2, H / 2, '#ffd24d', 380);
    sparkBurst(W / 2, H / 2, 100, RAINBOW, 11);
    confettiRain(180, RAINBOW);
    goldRain(80);
    fireworksBarrage(10, RAINBOW, 2400);
    for (let i = 0; i < 8; i++) sCoin(0.5 + i * 0.12);
    reelEls.forEach((r) => r.classList.add('hitglow'));
    document.body.classList.add('jackpot-mode');
    $('#total').classList.add('rainbow');
    await showBanner({ title: 'JACKPOT!!', num: results.join(' '), sub: `TOTAL ${total} ── ゾロ目`, cls: 'mega', dur: 5000 });
    document.body.classList.remove('jackpot-mode');
  } else if (n === 1 && results[0] === dice[0]) {
    // ---- クリティカル（単騎で最大値） ----
    if (dice[0] >= 10) await pchunEffect();
    flash('#fff', 0.8, 300);
    sExplosion(); sFanfare(2);
    shake('shake-l'); vibrate([40, 60, 100]);
    sparkBurst(cx, cy, 80, RAINBOW, 10);
    confettiRain(120, RAINBOW);
    fireworksBarrage(6, RAINBOW, 1600);
    $('#total').classList.add('rainbow');
    await showBanner({ title: 'CRITICAL!!', num: String(results[0]), sub: `d${dice[0]} 最大値`, cls: 'mega', dur: 4200 });
  } else if (n === 1 && results[0] === 1) {
    // ---- ファンブル ----
    sZuko();
    flash('#7b2dff', 0.3, 260);
    shake('shake-s');
    await showBanner({ title: 'ファンブル…', num: '1', sub: 'どんまい', cls: 'doom', dur: 2600 });
  } else if (reach) {
    // ---- リーチ外れ: ズコー ----
    sZuko();
    shake('shake-s');
    toast('惜しい！！ あと1つだった…');
    sparkBurst(cx, cy, 20, THEME, 5);
  } else {
    // ---- 通常: 合計の高さに応じたバースト ----
    const maxTotal = dice.reduce((a, b) => a + b, 0);
    const ratio = total / maxTotal;
    sCoin();
    if (ratio > 0.8) { sFanfare(1); confettiRain(50, THEME); }
    sparkBurst(cx, cy, Math.round(20 + 60 * ratio), THEME, 5 + 4 * ratio);
    ring(cx, cy, THEME[0]);
    vibrate(20);
  }
}

// ---------------- controls ----------------
$('#spinBtn').addEventListener('click', () => spin(newSeed()));
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    if (!$('#confModal').classList.contains('hidden')) return;
    if (!$('#replayGate').classList.contains('hidden')) return;
    e.preventDefault();
    spin(newSeed());
  }
});
$('#replayBtn').addEventListener('click', () => {
  if (busy || !lastRoll) return;
  conf.dice = [...lastRoll.d];
  conf.quick = !!lastRoll.q;
  buildReels();
  spin(lastRoll.x);
});

// ---------------- settings ----------------
const confModal = $('#confModal');
$('#confBtn').addEventListener('click', () => {
  if (busy) return;
  ac(); sChime();
  renderConf();
  confModal.classList.remove('hidden');
});
$('#confClose').addEventListener('click', () => confModal.classList.add('hidden'));
confModal.addEventListener('pointerdown', (e) => { if (e.target === confModal) confModal.classList.add('hidden'); });

function renderConf() {
  $('#diceCount').textContent = conf.dice.length;
  $('#quickChk').checked = conf.quick;
  const list = $('#faceList');
  list.innerHTML = '';
  conf.dice.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'fitem';
    d.innerHTML = `<label>スロット${i + 1}</label><input type="number" min="2" max="1000" value="${f}" inputmode="numeric">`;
    d.querySelector('input').addEventListener('change', (e) => {
      conf.dice[i] = clampFaces(+e.target.value);
      e.target.value = conf.dice[i];
      buildReels();
    });
    list.appendChild(d);
  });
}
$('#diceMinus').addEventListener('click', () => {
  if (conf.dice.length <= 1) return;
  conf.dice.pop();
  tone({ freq: 300, end: 200, dur: 0.08, type: 'triangle', vol: 0.15 });
  buildReels(); renderConf();
});
$('#dicePlus').addEventListener('click', () => {
  if (conf.dice.length >= MAX_DICE) return;
  conf.dice.push(conf.dice.at(-1));
  tone({ freq: 500, end: 700, dur: 0.08, type: 'triangle', vol: 0.15 });
  buildReels(); renderConf();
});
$('#presets').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-p]');
  if (!btn) return;
  conf.dice = btn.dataset.p.split(',').map((v) => clampFaces(+v));
  sChime();
  buildReels(); renderConf();
});
$('#quickChk').addEventListener('change', (e) => { conf.quick = e.target.checked; });

// ---------------- share ----------------
function shareUrl(obj) {
  return `${location.origin}${location.pathname}?s=${encodeShare(obj)}`;
}
async function copyUrl(url, label) {
  try {
    await navigator.clipboard.writeText(url);
    toast(`📋 ${label}リンクをコピーしました`);
  } catch (_) {
    window.prompt(`${label}リンク（手動でコピーしてください）`, url);
  }
  sCoin();
}
$('#shareSetup').addEventListener('click', () => {
  copyUrl(shareUrl({ v: 1, m: 's', d: conf.dice, q: conf.quick ? 1 : 0 }), '設定の');
});
$('#shareResult').addEventListener('click', () => {
  if (!lastRoll) return;
  copyUrl(shareUrl({ v: 1, m: 'r', d: lastRoll.d, q: lastRoll.q, x: lastRoll.x }), '結果の');
});

// ---------------- init from URL ----------------
(function initFromUrl() {
  const s = new URLSearchParams(location.search).get('s');
  if (!s) return;
  const st = decodeShare(s);
  if (!st || st.v !== 1 || !validDice(st.d)) {
    toast('⚠ 共有リンクが壊れているか、改ざんされています', 4000);
    return;
  }
  conf.dice = st.d.map(clampFaces);
  conf.quick = !!st.q;
  if (st.m === 'r' && Number.isInteger(st.x)) {
    pendingSeed = st.x >>> 0;
    $('#replayDesc').textContent = `${diceDesc(conf.dice)}${conf.quick ? '（クイック）' : ''} ── 演出ごと完全再現します`;
    $('#replayGate').classList.remove('hidden');
  } else {
    toast(`⚙ 共有された設定を読み込みました: ${diceDesc(conf.dice)}`);
  }
})();
$('#replayPlay').addEventListener('click', () => {
  $('#replayGate').classList.add('hidden');
  ac();
  if (pendingSeed !== null) spin(pendingSeed);
});
$('#replaySkip').addEventListener('click', () => {
  $('#replayGate').classList.add('hidden');
  toast(`⚙ 設定だけ読み込みました: ${diceDesc(conf.dice)}`);
});

// ---------------- init ----------------
buildReels();
window.addEventListener('pointerdown', () => ac(), { once: true });
