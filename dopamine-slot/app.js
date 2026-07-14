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
// スロット定義: number = n面ダイス（出目 1..n） / string[] = 選択肢リスト
// mode: 'auto'(1.5s回転→1s毎に停止→最後1.5s溜め) / 'manual'(リールをタップで停止)
// pchun: プチュン発動率(%)。ゾロ目/天元突破などの大当たりは率に関係なく確定
const conf = { dice: [6, 6, 6], quick: false, mode: 'auto', pchun: 33 };
let busy = false;
let lastRoll = null;   // { d:[...], q:0|1, x:seed } 直前のロール（共有・再演用スナップショット）
let pendingSeed = null;

const MAX_DICE = 8, MIN_FACES = 2, MAX_FACES = 1000;
const MAX_CHOICES = 50, MAX_CHOICE_LEN = 50;
const clampFaces = (v) => Math.min(MAX_FACES, Math.max(MIN_FACES, Math.floor(v) || MIN_FACES));
const isChoice = (s) => Array.isArray(s);
const slotSize = (s) => (isChoice(s) ? s.length : s);           // 選択肢の数
const slotDisp = (s, idx) => (isChoice(s) ? s[idx] : String(idx + 1)); // idx番目の表示
function sanitizeChoices(arr) {
  const out = arr.map((v) => String(v).trim().slice(0, MAX_CHOICE_LEN)).filter(Boolean).slice(0, MAX_CHOICES);
  return out.length >= 2 ? out : null;
}
function normalizeSlot(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= MIN_FACES && v <= MAX_FACES) return v;
  if (Array.isArray(v)) return sanitizeChoices(v);
  return null;
}
function validDice(d) {
  return Array.isArray(d) && d.length >= 1 && d.length <= MAX_DICE &&
    d.every((s) => normalizeSlot(s) !== null);
}
function diceDesc(d = conf.dice) {
  const partsD = [];
  const g = {};
  for (const s of d) {
    if (isChoice(s)) partsD.push(`${s.length}択`);
    else g[s] = (g[s] || 0) + 1;
  }
  return Object.entries(g).map(([f, n]) => `${n}d${f}`).concat(partsD).join(' + ');
}
function newSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

// ---------------- reels ----------------
const reelsEl = $('#reels');
let reelEls = [];
function slotMaxLen(s) {
  return isChoice(s) ? Math.max(...s.map((v) => v.length)) : String(s).length;
}
function buildReels() {
  reelsEl.innerHTML = '';
  reelEls = conf.dice.map((s, i) => {
    const reel = document.createElement('div');
    reel.className = 'reel';
    reel.innerHTML =
      '<div class="window"><div class="strip">' +
      '<div class="cell side">-</div><div class="cell cur">-</div><div class="cell side">-</div>' +
      '</div></div>' +
      `<div class="dlab">${isChoice(s) ? `${s.length}択` : `d${s}`}</div>`;
    // 長い選択肢はリール窓を広げる
    const len = slotMaxLen(s);
    if (len > 3) reel.querySelector('.window').style.width = `${Math.min(170, 64 + len * 10)}px`;
    reelsEl.appendChild(reel);
    return reel;
  });
  const hasNum = conf.dice.some((s) => !isChoice(s));
  $('.tlabel').textContent = hasNum ? 'TOTAL' : 'RESULT';
  $('#total').textContent = '--';
  $('#total').classList.remove('rainbow', 'str');
  $('#detail').innerHTML = '&nbsp;';
}
function fontFor(text) {
  const L = String(text).length;
  return L <= 2 ? '38px' : L <= 3 ? '26px' : L <= 5 ? '19px' : L <= 8 ? '15px' : '12px';
}
function setReel(i, slot, idx) {
  const m = slotSize(slot);
  const cells = reelEls[i].querySelectorAll('.cell');
  const prev = slotDisp(slot, (idx - 1 + m) % m);
  const next = slotDisp(slot, (idx + 1) % m);
  const cur = slotDisp(slot, idx);
  cells[0].textContent = prev;
  cells[1].textContent = cur;
  cells[2].textContent = next;
  cells[1].style.fontSize = fontFor(cur);
}
function reelCenter(i) {
  const r = reelEls[i].querySelector('.window').getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

// ---------------- spin engine ----------------
let spinTimers = [];
let tickTimer = null;
function startReelVisual(i, slot, visRng, tickMs = 55) {
  reelEls[i].classList.add('spinning');
  reelEls[i].classList.remove('landed', 'hitglow', 'reachfocus');
  const m = slotSize(slot);
  const timer = setInterval(() => setReel(i, slot, Math.floor(visRng() * m)), tickMs);
  spinTimers[i] = timer;
  return timer;
}
function landReel(i, slot, idx, { strong = true } = {}) {
  clearInterval(spinTimers[i]);
  reelEls[i].classList.remove('spinning');
  setReel(i, slot, idx);
  reelEls[i].classList.remove('landed');
  void reelEls[i].offsetWidth;
  reelEls[i].classList.add('landed');
  if (strong) {
    sThunk();
    sCoin(0.04);
    shake('shake-s');
    vibrate(15);
    const [cx, cy] = reelCenter(i);
    sparkBurst(cx, cy, 26, THEME, 6);
    ring(cx, cy, THEME[i % 3], 110);
    flash(THEME[i % 3], 0.1, 130);
  }
}

// チカチカ用: 色を替えながら連続フラッシュ
function strobe(colors, times = 4, interval = 90, peak = 0.3) {
  for (let i = 0; i < times; i++) {
    setTimeout(() => flash(colors[i % colors.length], peak, interval * 0.9), i * interval);
  }
}

let manualStopNext = null; // 手動モード中: SPINボタン/スペースで次のリールを止める

async function spin(seed, { forceAuto = false } = {}) {
  if (busy) return;
  busy = true;
  ac();
  $('#shareResult').disabled = true;
  $('#replayBtn').disabled = true;

  const dice = [...conf.dice];
  const quick = conf.quick;
  const manual = conf.mode === 'manual' && !quick && !forceAuto; // 再生は常に自動で再現
  const n = dice.length;

  // ---- 結果と演出分岐をシードから決定論的に導出 ----
  // 各スロットは 0..(選択肢数-1) のインデックスで抽選し、表示文字列で揃い判定する
  // （数字ダイスも文字列スロットも同じ土俵: '4'='4' も 'うどん'='うどん' もゾロ目）
  const rng = mulberry32(seed >>> 0);
  const idxs = dice.map((s) => Math.floor(rng() * slotSize(s)));
  const vals = dice.map((s, i) => slotDisp(s, idxs[i]));
  const rngFx = mulberry32((seed ^ 0x9e3779b9) >>> 0); // 演出バリエーション用
  const pchunRand = rngFx() < conf.pchun / 100;        // プチュン抽選（率は設定から）
  const allNum = dice.every((s) => !isChoice(s));
  const zoro = n >= 2 && vals.every((v) => v === vals[0]);
  const allMax = allNum && idxs.every((x, i) => x === slotSize(dice[i]) - 1);
  const allOne = allNum && n >= 2 && idxs.every((x) => x === 0);
  const crit = n === 1 && !isChoice(dice[0]) && idxs[0] === dice[0] - 1;
  const autoLastReach = (() => { // 自動モード: 最後(n-1)のリールでのリーチ判定
    if (quick || n < 2) return false;
    const lastSlot = dice[n - 1];
    const canMatch = isChoice(lastSlot)
      ? lastSlot.includes(vals[0])
      : (/^\d+$/.test(vals[0]) && +vals[0] >= 1 && +vals[0] <= lastSlot);
    return vals.slice(0, -1).every((v) => v === vals[0]) && canMatch &&
      (n >= 3 || zoro || rngFx() < 0.35);
  })();
  const nudgeBack = zoro && slotSize(dice[n - 1]) >= 3 && rngFx() < 0.5; // 通り過ぎて戻る演出
  // プチュン発動: 抽選ヒット or 大当たり確定（ゾロ目/全最大/単騎クリティカル）
  const pchunFinal = !quick && (pchunRand || zoro || allMax || (crit && dice[0] >= 10));

  // 残り1リールになった時点でのリーチ判定（手動モード用・停止順は任意）
  function reachNow(remaining, lastIdx) {
    if (quick || n < 2) return false;
    const others = vals.filter((_, j) => j !== lastIdx);
    if (!others.every((v) => v === others[0])) return false;
    const s = dice[lastIdx];
    return isChoice(s) ? s.includes(others[0])
      : (/^\d+$/.test(others[0]) && +others[0] >= 1 && +others[0] <= s);
  }

  // リーチ突入/解除
  let hbTimer = null;
  let reachHappened = false;
  function enterReachFx(i) {
    reachHappened = true;
    sReachIn();
    document.body.classList.add('reach');
    reelEls[i].classList.add('reachfocus');
    clearInterval(hbTimer);
    hbTimer = setInterval(() => { sHeart(); vibrate(25); }, 600);
  }
  function exitReachFx(i) {
    clearInterval(hbTimer);
    document.body.classList.remove('reach');
    reelEls[i].classList.remove('reachfocus');
  }

  // 最後の1リールの停止（プチュン → 超豪華リベール込み）
  async function finishLastReel(i) {
    if (pchunFinal) {
      clearInterval(tickTimer);
      await pchunEffect();
      flash('#fff', 1, 320);
      sExplosion();
      if (nudgeBack) {
        // 暗転明け、1つ先で止まったフリ → 戻ってジャスト
        landReel(i, dice[i], (idxs[i] + 1) % slotSize(dice[i]));
        await sleep(450);
        sNudge();
        landReel(i, dice[i], idxs[i]);
      } else {
        landReel(i, dice[i], idxs[i]);
      }
      reelEls[i].classList.add('hitglow');
      strobe(['#ffffff', '#ffd24d', '#ff2d95', '#59f3ff'], 5, 100, 0.4);
      shake('shake-l');
      vibrate([50, 70, 120]);
      const [rx, ry] = reelCenter(i);
      sparkBurst(rx, ry, 90, RAINBOW, 10);
      ring(rx, ry, '#ffffff', 300);
      ring(W / 2, H / 2, '#ffd24d', 420);
      await sleep(400);
    } else {
      landReel(i, dice[i], idxs[i]);
    }
  }

  try {
    $('#total').textContent = '--';
    $('#total').classList.remove('rainbow');
    $('#detail').innerHTML = '&nbsp;';

    // 全リール回転開始
    sLever();
    vibrate(20);
    spinTimers = [];
    dice.forEach((s, i) => startReelVisual(i, s, mulberry32((seed + i * 7919 + 1) >>> 0)));
    tickTimer = setInterval(sSpinTick, 75);
    document.body.classList.add('spinmode');

    if (manual) {
      // ---- 手動モード: リールをタップして止める（SPINボタン=左から順に停止） ----
      $('#spinBtn').disabled = false;
      $('#spinBtn').querySelector('span').textContent = '🛑 STOP';
      reelEls.forEach((r) => r.classList.add('stoppable'));
      await new Promise((resolve) => {
        const remaining = new Set(dice.map((_, i) => i));
        let stopping = false; // 最後のリールの async 処理中の多重タップ防止
        const cleanupFns = [];
        async function stopReelAt(i) {
          if (stopping || !remaining.has(i)) return;
          reelEls[i].classList.remove('stoppable');
          remaining.delete(i);
          if (remaining.size === 0) {
            stopping = true;
            cleanupFns.forEach((f) => f());
            const wasReach = document.body.classList.contains('reach');
            await finishLastReel(i);
            if (wasReach) exitReachFx(i);
            resolve();
            return;
          }
          landReel(i, dice[i], idxs[i]);
          if (remaining.size === 1) {
            const lastIdx = [...remaining][0];
            if (reachNow(remaining, lastIdx)) enterReachFx(lastIdx);
          }
        }
        reelEls.forEach((r, i) => {
          const h = () => stopReelAt(i);
          r.addEventListener('pointerdown', h);
          cleanupFns.push(() => r.removeEventListener('pointerdown', h));
        });
        manualStopNext = () => {
          const next = dice.findIndex((_, i) => remaining.has(i));
          if (next >= 0) stopReelAt(next);
        };
      });
      manualStopNext = null;
      $('#spinBtn').disabled = true;
      $('#spinBtn').querySelector('span').textContent = '🎰 SPIN';
    } else {
      // ---- 自動モード: 1.5秒回転 → 1秒ごとに停止 → 最後の1個は1.5秒待つ ----
      $('#spinBtn').disabled = true;
      const spinUp = quick ? 250 : 1500;
      const gap = quick ? 130 : 1000;
      const lastWait = quick ? 130 : 1500;
      for (let i = 0; i < n; i++) {
        const isLast = i === n - 1;
        await sleep(i === 0 ? spinUp : isLast ? lastWait : gap);
        if (isLast) {
          if (autoLastReach) {
            enterReachFx(i);
            await sleep(2400);
            await finishLastReel(i);
            exitReachFx(i);
          } else {
            await finishLastReel(i);
          }
        } else {
          landReel(i, dice[i], idxs[i]);
        }
      }
    }
    clearInterval(tickTimer);
    document.body.classList.remove('spinmode');

    await celebrate({ dice, idxs, vals, n, quick, zoro, allMax, allOne, crit, reach: reachHappened, pchunDone: pchunFinal });

    lastRoll = { d: dice, q: quick ? 1 : 0, x: seed >>> 0, p: conf.pchun, md: conf.mode === 'manual' ? 'm' : 'a' };
  } finally {
    clearInterval(tickTimer);
    clearInterval(hbTimer);
    spinTimers.forEach(clearInterval);
    manualStopNext = null;
    document.body.classList.remove('reach', 'spinmode');
    reelEls.forEach((r) => r.classList.remove('stoppable', 'reachfocus'));
    busy = false;
    $('#spinBtn').disabled = false;
    $('#spinBtn').querySelector('span').textContent = '🎰 SPIN';
    $('#shareResult').disabled = !lastRoll;
    $('#replayBtn').disabled = !lastRoll;
  }
}

// ---------------- celebrations ----------------
function showTotal(dice, idxs, vals) {
  // 数字スロットの合計。数字がなければ RESULT（単独なら選ばれた文字列）を大きく出す
  const nums = [];
  dice.forEach((s, i) => { if (!isChoice(s)) nums.push(idxs[i] + 1); });
  const el = $('#total');
  el.classList.remove('str');
  let total = null;
  if (nums.length) {
    total = nums.reduce((a, b) => a + b, 0);
    el.textContent = total.toLocaleString();
  } else if (vals.length === 1) {
    el.textContent = vals[0];
    el.classList.add('str');
  } else {
    el.textContent = '—';
  }
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
  const detail = $('#detail');
  if (vals.length === 1) detail.innerHTML = isChoice(dice[0]) ? '&nbsp;' : `出目: ${vals[0]}`;
  else if (nums.length === vals.length) detail.textContent = vals.join(' + ') + ` = ${total}`;
  else detail.textContent = vals.join(' ／ ');
  return total;
}

async function celebrate({ dice, idxs, vals, n, quick, zoro, allMax, allOne, crit, reach, pchunDone }) {
  const total = showTotal(dice, idxs, vals);
  const results = vals; // 表示文字列ベース
  const box = $('.slotbox').getBoundingClientRect();
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  // プチュンは最後のリール停止時に済んでいる（pchunDone）。ここでは鳴らさない

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
    await showBanner({ title: 'JACKPOT!!', num: results.join(' '), sub: total !== null ? `TOTAL ${total} ── ゾロ目` : '全スロット一致!!', cls: 'mega', dur: 5000 });
    document.body.classList.remove('jackpot-mode');
  } else if (crit) {
    // ---- クリティカル（単騎で最大値） ----
    flash('#fff', 0.8, 300);
    sExplosion(); sFanfare(2);
    shake('shake-l'); vibrate([40, 60, 100]);
    sparkBurst(cx, cy, 80, RAINBOW, 10);
    confettiRain(120, RAINBOW);
    fireworksBarrage(6, RAINBOW, 1600);
    $('#total').classList.add('rainbow');
    await showBanner({ title: 'CRITICAL!!', num: String(results[0]), sub: `d${dice[0]} 最大値`, cls: 'mega', dur: 4200 });
  } else if (n === 1 && !isChoice(dice[0]) && idxs[0] === 0) {
    // ---- ファンブル ----
    sZuko();
    flash('#7b2dff', 0.3, 260);
    shake('shake-s');
    await showBanner({ title: 'ファンブル…', num: '1', sub: 'どんまい', cls: 'doom', dur: 2600 });
  } else if (pchunDone) {
    // ---- FEVER!!（プチュン当選・結果は通常）: 超豪華演出 ----
    sFanfare(3);
    strobe(['#ffd24d', '#ff2d95', '#59f3ff', '#ffffff'], 6, 110, 0.3);
    sparkBurst(W / 2, H / 2, 110, RAINBOW, 11);
    confettiRain(200, RAINBOW);
    goldRain(90);
    fireworksBarrage(9, RAINBOW, 2200);
    for (let i = 0; i < 7; i++) sCoin(0.4 + i * 0.13);
    shake('shake-l'); vibrate([40, 60, 40, 60, 100]);
    document.body.classList.add('jackpot-mode');
    $('#total').classList.add('rainbow');
    await showBanner({
      title: 'FEVER!!',
      num: total !== null && vals.length > 1 ? String(total) : results.join(' '),
      sub: vals.length > 1 ? results.join(' ／ ') : 'プチュン降臨',
      cls: 'mega', dur: 4200,
    });
    document.body.classList.remove('jackpot-mode');
  } else if (reach) {
    // ---- リーチ外れ: ズコー ----
    sZuko();
    strobe(['#7b2dff', '#ff004c'], 3, 130, 0.2);
    shake('shake-s');
    toast('惜しい！！ あと1つだった…');
    sparkBurst(cx, cy, 30, THEME, 5);
    confettiRain(20, ['#7b2dff', '#556']);
  } else {
    // ---- 通常でも派手派手チカチカ ----
    const numFaces = dice.filter((s) => !isChoice(s));
    const maxTotal = numFaces.reduce((a, b) => a + b, 0);
    const ratio = total !== null && maxTotal ? total / maxTotal : 0.5;
    sFanfare(1);
    sCoin(); sCoin(0.15); sCoin(0.3);
    strobe([THEME[0], THEME[1], THEME[2]], 3, 110, 0.2);
    sparkBurst(cx, cy, Math.round(50 + 90 * ratio), RAINBOW, 6 + 5 * ratio);
    ring(cx, cy, THEME[0]);
    setTimeout(() => ring(cx, cy, THEME[1], 220), 130);
    confettiRain(Math.round(40 + 80 * ratio), RAINBOW);
    fountain(W * 0.22, H, THEME, 18);
    fountain(W * 0.78, H, THEME, 18);
    shake('shake-m');
    vibrate(35);
    $('#total').classList.add('rainbow');
    setTimeout(() => $('#total').classList.remove('rainbow'), 1600);
  }
}

// ---------------- controls ----------------
$('#spinBtn').addEventListener('click', () => {
  if (manualStopNext) { manualStopNext(); return; } // 手動モード中は STOP として働く
  spin(newSeed());
});
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    if (!$('#confModal').classList.contains('hidden')) return;
    if (!$('#replayGate').classList.contains('hidden')) return;
    e.preventDefault();
    if (manualStopNext) { manualStopNext(); return; }
    spin(newSeed());
  }
});
$('#replayBtn').addEventListener('click', () => {
  if (busy || !lastRoll) return;
  conf.dice = [...lastRoll.d];
  conf.quick = !!lastRoll.q;
  conf.pchun = lastRoll.p ?? conf.pchun;
  buildReels();
  spin(lastRoll.x, { forceAuto: true }); // 再演は自動進行で完全再現
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

// 入力文字列 → スロット定義。"6" は d6、「、」/カンマ/改行区切りは選択肢リスト
function parseSlotInput(str) {
  const items = String(str).split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return null;
  if (items.length === 1) {
    return /^\d+$/.test(items[0]) ? clampFaces(+items[0]) : null;
  }
  return sanitizeChoices(items);
}
const slotInputValue = (s) => (isChoice(s) ? s.join('、') : String(s));

function renderConf() {
  $('#diceCount').textContent = conf.dice.length;
  $('#quickChk').checked = conf.quick;
  $('#modeAuto').classList.toggle('on', conf.mode !== 'manual');
  $('#modeManual').classList.toggle('on', conf.mode === 'manual');
  $('#pchunRange').value = conf.pchun;
  $('#pchunVal').textContent = conf.pchun;
  const list = $('#faceList');
  list.innerHTML = '';
  conf.dice.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'fitem';
    d.innerHTML = `<label>スロット${i + 1}</label><input type="text" value="" placeholder="6 ／ うどん、そば、食べない">`;
    const input = d.querySelector('input');
    input.value = slotInputValue(s);
    input.addEventListener('change', () => {
      const parsed = parseSlotInput(input.value);
      if (parsed === null) {
        toast('数字1つ（面数）か、「、」区切りで2つ以上の選択肢を入れてください');
        input.value = slotInputValue(conf.dice[i]);
        return;
      }
      conf.dice[i] = parsed;
      input.value = slotInputValue(parsed);
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
  const last = conf.dice.at(-1);
  conf.dice.push(isChoice(last) ? [...last] : last);
  tone({ freq: 500, end: 700, dur: 0.08, type: 'triangle', vol: 0.15 });
  buildReels(); renderConf();
});
$('#presets').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-p]');
  if (!btn) return;
  try {
    const d = JSON.parse(btn.dataset.p).map(normalizeSlot);
    if (d.length && d.every((s) => s !== null)) {
      conf.dice = d;
      sChime();
      buildReels(); renderConf();
    }
  } catch (_) {}
});
$('#quickChk').addEventListener('change', (e) => { conf.quick = e.target.checked; });
$('#modeAuto').addEventListener('click', () => { conf.mode = 'auto'; renderConf(); });
$('#modeManual').addEventListener('click', () => { conf.mode = 'manual'; renderConf(); });
$('#pchunRange').addEventListener('input', (e) => {
  conf.pchun = Math.min(100, Math.max(0, Math.round(+e.target.value)));
  $('#pchunVal').textContent = conf.pchun;
});

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
  copyUrl(shareUrl({ v: 1, m: 's', d: conf.dice, q: conf.quick ? 1 : 0, p: conf.pchun, md: conf.mode === 'manual' ? 'm' : 'a' }), '設定の');
});
$('#shareResult').addEventListener('click', () => {
  if (!lastRoll) return;
  // p はプチュン抽選の再現に必須。md は設定復元用（再生自体は常に自動進行）
  copyUrl(shareUrl({ v: 1, m: 'r', d: lastRoll.d, q: lastRoll.q, x: lastRoll.x, p: lastRoll.p, md: lastRoll.md }), '結果の');
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
  conf.dice = st.d.map(normalizeSlot);
  conf.quick = !!st.q;
  if (Number.isInteger(st.p) && st.p >= 0 && st.p <= 100) conf.pchun = st.p;
  if (st.md === 'm') conf.mode = 'manual';
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
  if (pendingSeed !== null) spin(pendingSeed, { forceAuto: true }); // 共有結果は自動進行で完全再現
});
$('#replaySkip').addEventListener('click', () => {
  $('#replayGate').classList.add('hidden');
  toast(`⚙ 設定だけ読み込みました: ${diceDesc(conf.dice)}`);
});

// ---------------- init ----------------
buildReels();
window.addEventListener('pointerdown', () => ac(), { once: true });
