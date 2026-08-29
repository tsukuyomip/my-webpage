/* 宵の海 — 光の魚をあやつる
 *
 * 全部このファイル内で生成する。外部アセットも通信もない。
 *
 * 絵の作り:
 *   毎フレーム背景色で薄く塗りつぶし（＝軌跡が尾を引く）→ 加算合成で魚を描く。
 *   これだけでネオンの発光になる。魚はスプライトを1色1枚だけ焼いておき、
 *   速度ベクトルをそのまま回転行列に使う（atan2 も cos/sin も要らない）。
 *
 * 動きの作り:
 *   ・流れ場: 粗いグリッドに毎フレーム角度を焼き、魚はセルを引くだけ。
 *   ・渦: 指の位置から距離 core を保とうとするバネ + 接線力。
 *         core より内側は押し返すので中心に穴があく（MVの俯瞰の渦）。
 *   ・溜め: 押している間 charge が育ち、渦が強く・画面が暗く・音が上がる。
 *           離すと一気に開く。気持ちよさの本体はこの「間」。
 */
'use strict';
(() => {

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ============================================================
   * 景色
   * ============================================================ */
  const QS = new URLSearchParams(location.search);   // ?q=1 で自動調整を止める（動作確認用）
  const QFIX = QS.has('q') ? clamp(parseFloat(QS.get('q')) || 1, 0.2, 1.6) : 0;

  const SCENES = [
    {
      id: 'yoi', name: '宵', sub: 'よい',
      bg: [6, 10, 22], fade: 0.26,
      colors: [[120,255,240],[255,120,220],[190,255,130],[255,225,120],[130,190,255],[255,150,175]],
      torii: [255,146,74],
      fishScale: 1.0, density: 1.0, swirl: 1.0, glow: 1.0, speed: 1.0,
    },
    {
      id: 'tomoshibi', name: '灯', sub: 'ともしび',
      bg: [24, 13, 7], fade: 0.30,
      colors: [[255,214,124],[255,166,104],[255,232,178],[186,250,196],[255,138,176],[255,196,120]],
      torii: [255,186,96],
      fishScale: 1.08, density: 0.92, swirl: 0.85, glow: 1.35, speed: 0.9,
    },
    {
      id: 'oki', name: '沖', sub: 'おき',
      bg: [4, 12, 30], fade: 0.20,
      colors: [[152,255,255],[122,200,255],[206,238,255],[162,255,212],[236,250,255],[124,162,255]],
      torii: [122,220,255],
      fishScale: 0.9, density: 1.18, swirl: 0.72, glow: 0.85, speed: 1.15,
    },
    {
      id: 'ginga', name: '銀', sub: 'ぎんが',
      bg: [2, 4, 12], fade: 0.20,
      colors: [[255,255,246],[192,255,242],[255,202,240],[255,246,192],[202,226,255],[255,182,202]],
      torii: [255,192,112],
      fishScale: 0.68, density: 1.4, swirl: 1.35, glow: 0.8, speed: 1.15,
    },
  ];

  /* ============================================================
   * 状態
   * ============================================================ */
  const S = {
    scene: SCENES[0],
    quality: 1,          // 実測 FPS で自動調整 0.35..1（?q= で固定）
    density: 1,          // スライダー
    swirl: 1,            // スライダー
    sound: true,
    reflect: true,
    tilt: false,
    warm: 0,             // 灯色ブルーム 0..1（開いたときの報酬）
    flash: 0,            // 白フラッシュ
    shake: 0,
    dim: 0,              // 溜め中の暗転
    boost: 0,            // 開いた直後の速度上限ブースト
    lanterns: 0,
    tiltX: 0, tiltY: 0,
    running: false,
    started: false,
  };

  /* ============================================================
   * キャンバス
   * ============================================================ */
  const cv = document.getElementById('stage');
  const ctx = cv.getContext('2d', { alpha: false });

  let W = 0, H = 0, DPR = 1, WD = 0, HD = 0;
  let waterY = 0, toriiBox = null, sprites = [], spriteS = 0, baseFish = 12;
  let vignette = null, waterGrad = null;
  /* 尾を引かせる層。ここだけ消し残しを溜め、鳥居やブルームなどの
     オーバーレイは毎フレーム描き直す表の層に出す。混ぜると加算が
     際限なく溜まって画面が白く飽和する。 */
  let trailCv = null, tctx = null;

  /* 流れ場グリッド */
  const CELL = 48;
  let gw = 0, gh = 0, gfx = null, gfy = null;

  /* 魚（Structure of Arrays） */
  const CAP = 3400;
  const px_ = new Float32Array(CAP), py_ = new Float32Array(CAP);
  const vx_ = new Float32Array(CAP), vy_ = new Float32Array(CAP);
  const sz_ = new Float32Array(CAP), ci_ = new Uint8Array(CAP);
  /* 個体ごとの癖。全員が同じ流れ場に従うと一本の帯に潰れてしまうので、
     一匹ずつ違う定常加速を足して散らす。 */
  const bx_ = new Float32Array(CAP), by_ = new Float32Array(CAP);
  let N = 0;

  /* エフェクト */
  const ripples = [];   // {x,y,r,vr,life,max,w,rgb}
  const streaks = [];   // 星降り {x,y,vx,vy,life,max,len,rgb}

  /* ============================================================
   * スプライト（魚1色ぶん）
   * ============================================================ */
  function makeSprite(rgb, px) {
    const [r, g, b] = rgb;
    const size = Math.max(12, Math.ceil(px * 4));
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const cx = size / 2, cy = size / 2;

    // ぼんやりした光暈
    const grd = x.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    grd.addColorStop(0.00, `rgba(${r},${g},${b},0.30)`);
    grd.addColorStop(0.22, `rgba(${r},${g},${b},0.105)`);
    grd.addColorStop(0.55, `rgba(${r},${g},${b},0.022)`);
    grd.addColorStop(1.00, `rgba(${r},${g},${b},0)`);
    x.fillStyle = grd;
    x.fillRect(0, 0, size, size);

    x.globalCompositeOperation = 'lighter';

    const bl = px * 1.25;   // 体長
    const bw = px * 0.42;   // 体幅

    // 尾（後方 = -x）
    x.beginPath();
    x.moveTo(cx - bl * 0.30, cy);
    x.lineTo(cx - bl * 0.98, cy - bw * 1.25);
    x.quadraticCurveTo(cx - bl * 0.62, cy, cx - bl * 0.98, cy + bw * 1.25);
    x.closePath();
    x.fillStyle = `rgba(${r},${g},${b},0.42)`;
    x.fill();

    // 胴
    x.beginPath();
    x.ellipse(cx + px * 0.10, cy, bl * 0.52, bw, 0, 0, TAU);
    x.fillStyle = `rgba(${r},${g},${b},0.74)`;
    x.fill();

    // 芯（白く飛ばす）
    x.beginPath();
    x.ellipse(cx + px * 0.22, cy, bl * 0.26, bw * 0.52, 0, 0, TAU);
    x.fillStyle = `rgba(255,255,255,${0.26 + 0.16 * ((r + g + b) / 765)})`;
    x.fill();

    return c;
  }

  function buildSprites() {
    const px = baseFish * S.scene.fishScale;
    sprites = S.scene.colors.map((c) => makeSprite(c, px));
    spriteS = sprites[0].width;
  }

  /* ============================================================
   * 鳥居（1回だけ焼いて、あとは drawImage）
   * ============================================================ */
  /* 明神鳥居。u = 幅方向 0..1、v = 高さ方向 0..1（0 = 笠木の上端、1 = 根元）。
     笠木を別パスにしているのは、そこだけ黒いまま残して島木から下を灯らせるため
     （厳島の鳥居の見え方。上が黒く、下ほど白熱する）。 */
  const PILLAR_U = [0.245, 0.755];      // 柱の中心
  const P_TOP = 0.098, P_BOT = 0.118;   // 柱の太さ（上／下。下がわずかに太い）

  function toriiPaths(x0, w, h, y0) {
    const X = (u) => x0 + u * w;
    const Y = (v) => y0 + v * h;

    /* ---- 笠木。両端が反り上がる ---- */
    const kasagi = new Path2D();
    kasagi.moveTo(X(0.000), Y(-0.026));
    kasagi.quadraticCurveTo(X(0.5), Y(0.074), X(1.000), Y(-0.026));
    kasagi.lineTo(X(1.000), Y(0.042));
    kasagi.quadraticCurveTo(X(0.5), Y(0.142), X(0.000), Y(0.042));
    kasagi.closePath();

    const body = new Path2D();

    /* ---- 島木。笠木と同じ反りで、少し厚い ---- */
    body.moveTo(X(0.021), Y(0.038));
    body.quadraticCurveTo(X(0.5), Y(0.138), X(0.979), Y(0.038));
    body.lineTo(X(0.979), Y(0.130));
    body.quadraticCurveTo(X(0.5), Y(0.230), X(0.021), Y(0.130));
    body.closePath();

    /* ---- 台輪。柱の頭にはまる輪 ---- */
    for (const cu of PILLAR_U) {
      const dw = P_TOP * 1.28;
      body.rect(X(cu - dw / 2), Y(0.188), w * dw, h * 0.046);
    }

    /* ---- 額束と額 ---- */
    body.rect(X(0.482), Y(0.190), w * 0.036, h * 0.215);
    body.rect(X(0.446), Y(0.208), w * 0.108, h * 0.125);

    /* ---- 貫。柱の外へ大きく出る ---- */
    body.rect(X(0.098), Y(0.374), w * 0.804, h * 0.078);

    /* ---- 柱 ---- */
    for (const cu of PILLAR_U) {
      body.moveTo(X(cu - P_TOP / 2), Y(0.100));
      body.lineTo(X(cu + P_TOP / 2), Y(0.100));
      body.lineTo(X(cu + P_BOT / 2), Y(1.0));
      body.lineTo(X(cu - P_BOT / 2), Y(1.0));
      body.closePath();
    }

    return { kasagi, body };
  }

  function bakeTorii() {
    // 実物は縦より横に広い。以前は縦長にしていたので鳥居に見えていなかった。
    const tw = Math.min(W * 0.88, H * 0.56);
    const th = tw * 0.80;
    const topY = waterY - th;
    const x0 = (W - tw) / 2;
    const pad = Math.max(46, tw * 0.20);

    const bx = x0 - pad, by = topY - pad;
    const bw = tw + pad * 2, bh = th + pad * 2;

    const mk = () => {
      const c = document.createElement('canvas');
      c.width = Math.ceil(bw * DPR); c.height = Math.ceil(bh * DPR);
      const g = c.getContext('2d');
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.translate(-bx, -by);
      return { c, g };
    };

    const { kasagi, body } = toriiPaths(x0, tw, th, topY);

    /* --- 影絵。灯っていないときはこれだけが見える --- */
    const sil = mk();
    const sgrd = sil.g.createLinearGradient(0, topY, 0, waterY);
    sgrd.addColorStop(0, 'rgba(5,7,16,1)');
    sgrd.addColorStop(1, 'rgba(11,8,13,1)');
    sil.g.fillStyle = sgrd;
    sil.g.fill(body);
    sil.g.fillStyle = 'rgba(4,6,14,1)';       // 笠木はいちばん黒い
    sil.g.fill(kasagi);
    // 縁取りは輪郭を拾うためだけ。濃くすると、台輪や額束が他の部材と
    // 重なっている所で「内側の矩形」が白い枠になって浮いてしまう。
    sil.g.strokeStyle = 'rgba(120,150,200,0.10)';
    sil.g.lineWidth = 1;
    sil.g.stroke(body);
    sil.g.stroke(kasagi);

    /* --- 灯。島木から下だけが下から照らされる --- */
    const lit = mk();
    const [r, g0, b] = S.scene.torii;
    const grd = lit.g.createLinearGradient(0, topY, 0, waterY);
    grd.addColorStop(0.00, `rgba(${r},${Math.round(g0 * 0.62)},${Math.round(b * 0.62)},0.16)`);
    grd.addColorStop(0.34, `rgba(${r},${g0},${b},0.52)`);
    grd.addColorStop(0.76, `rgba(${r},${Math.min(255, g0 + 34)},${Math.min(255, b + 48)},0.88)`);
    grd.addColorStop(1.00, `rgba(255,${Math.min(255, g0 + 66)},${Math.min(255, b + 104)},1)`);

    // まわりへにじむ光。これがないと板を貼ったように見える
    lit.g.shadowColor = `rgba(${r},${g0},${b},0.95)`;
    lit.g.shadowBlur = Math.max(24, tw * 0.13);
    lit.g.fillStyle = `rgba(${r},${g0},${b},0.5)`;
    lit.g.fill(body);
    lit.g.shadowBlur = Math.max(10, tw * 0.045);
    lit.g.fill(body);
    lit.g.shadowBlur = 0;

    lit.g.fillStyle = grd;
    lit.g.fill(body);

    // 同上。ここも薄く。部材の継ぎ目として見える程度に留める。
    lit.g.strokeStyle = `rgba(255,${Math.min(255, g0 + 84)},${Math.min(255, b + 126)},0.16)`;
    lit.g.lineWidth = Math.max(1, tw * 0.003);
    lit.g.stroke(body);

    // 笠木は塗らない（加算なので塗らなければ影絵の黒がそのまま残る）。
    // 縁だけ拾わせて、下からの照り返しを受けているように見せる。
    lit.g.strokeStyle = `rgba(${r},${Math.round(g0 * 0.8)},${Math.round(b * 0.8)},0.34)`;
    lit.g.lineWidth = Math.max(1, tw * 0.0035);
    lit.g.stroke(kasagi);

    toriiBox = { sil: sil.c, lit: lit.c, x: bx, y: by, w: bw, h: bh, tw, th, topY };
  }

  /* ============================================================
   * リサイズ
   * ============================================================ */
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    WD = Math.round(W * DPR); HD = Math.round(H * DPR);
    cv.width = WD; cv.height = HD;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';

    if (!trailCv) { trailCv = document.createElement('canvas'); tctx = trailCv.getContext('2d', { alpha: false }); }
    trailCv.width = WD; trailCv.height = HD;
    tctx.fillStyle = '#000'; tctx.fillRect(0, 0, WD, HD);

    waterY = Math.round(H * 0.76);
    baseFish = clamp(Math.min(W, H) / 46, 8, 18);

    gw = Math.ceil(W / CELL) + 2;
    gh = Math.ceil(H / CELL) + 2;
    gfx = new Float32Array(gw * gh);
    gfy = new Float32Array(gw * gh);

    buildSprites();
    bakeTorii();

    // 手前を締めるビネット
    const vg = document.createElement('canvas');
    vg.width = WD; vg.height = HD;
    const vc = vg.getContext('2d');
    const rg = vc.createRadialGradient(WD / 2, HD * 0.48, Math.min(WD, HD) * 0.30,
                                       WD / 2, HD * 0.48, Math.max(WD, HD) * 0.78);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(0,0,0,0.72)');
    vc.fillStyle = rg; vc.fillRect(0, 0, WD, HD);
    vignette = vg;

    // 水面の奥行きフェード
    const wgc = document.createElement('canvas');
    wgc.width = 1; wgc.height = Math.max(1, HD - Math.round(waterY * DPR));
    const wg = wgc.getContext('2d');
    const lg = wg.createLinearGradient(0, 0, 0, wgc.height);
    const bgc = S.scene.bg;
    lg.addColorStop(0, `rgba(${bgc[0]},${bgc[1]},${bgc[2]},0.12)`);
    lg.addColorStop(0.45, `rgba(${bgc[0]},${bgc[1]},${bgc[2]},0.66)`);
    lg.addColorStop(1, `rgba(${bgc[0]},${bgc[1]},${bgc[2]},0.97)`);
    wg.fillStyle = lg; wg.fillRect(0, 0, 1, wgc.height);
    waterGrad = wgc;

    retarget();
  }

  /* 群れの数を決める（画面サイズ × 景色 × スライダー × 実測性能） */
  function retarget() {
    if (QFIX) S.quality = QFIX;
    const area = W * H;
    const base = clamp(area / 280, 600, 2300);
    const want = base * S.scene.density * S.density * S.quality;
    setCount(Math.round(clamp(want, 180, CAP)));
  }

  function setCount(n) {
    n = clamp(n | 0, 0, CAP);
    for (let i = N; i < n; i++) spawn(i, true);
    N = n;
  }

  function spawn(i, anywhere) {
    px_[i] = anywhere ? rnd(0, W) : rnd(-40, W + 40);
    py_[i] = anywhere ? rnd(0, H) : rnd(-40, H + 40);
    const a = rnd(0, TAU), sp = rnd(30, 90);
    vx_[i] = Math.cos(a) * sp; vy_[i] = Math.sin(a) * sp;
    sz_[i] = rnd(0.55, 1.55);
    ci_[i] = (Math.random() * sprites.length) | 0;
    bx_[i] = rnd(-118, 118); by_[i] = rnd(-92, 92);
  }

  /* ============================================================
   * 指（ポインタ）
   * ============================================================ */
  const MAXP = 3;
  const pointers = new Map(); // id -> P
  let lastTapT = 0, lastTapX = 0, lastTapY = 0;

  function makeP(id, x, y) {
    return { id, x, y, ox: x, oy: y, vx: 0, vy: 0, t0: performance.now(), charge: 0, moved: 0 };
  }

  /* ============================================================
   * 流れ場
   * ============================================================ */
  function updateField(t) {
    const dx = S.tiltX, dy = S.tiltY;
    let k = 0;
    for (let gy = 0; gy < gh; gy++) {
      const y = gy * CELL;
      for (let gx = 0; gx < gw; gx++, k++) {
        const x = gx * CELL;
        const a = (Math.sin(x * 0.0026 + t * 0.31) +
                   Math.cos(y * 0.0031 - t * 0.23) +
                   Math.sin((x + y) * 0.0013 + t * 0.17)) * 1.9;
        gfx[k] = Math.cos(a) + dx;
        gfy[k] = Math.sin(a) * 0.72 + dy - 0.10; // ほんの少し上へ（浮遊感）
      }
    }
  }

  /* ============================================================
   * 更新
   * ============================================================ */
  function step(dt, t) {
    updateField(t);

    const sc = S.scene;
    const swirlK = sc.swirl * S.swirl;
    const speedK = sc.speed;

    // 有効な指をフラットな配列に（内側ループを軽くする）
    const P = [];
    for (const p of pointers.values()) {
      if (P.length >= MAXP) break;
      P.push(p);
    }
    const np = P.length;
    const pxs = [0, 0, 0], pys = [0, 0, 0], pk = [0, 0, 0], pc = [0, 0, 0], pR2 = [0, 0, 0], pvx = [0, 0, 0], pvy = [0, 0, 0];
    const reach = Math.min(W, H) * 0.92;
    for (let i = 0; i < np; i++) {
      const p = P[i];
      pxs[i] = p.x; pys[i] = p.y;
      pk[i] = p.charge;
      pc[i] = 54 + 78 * p.charge;                 // 渦の芯の半径（＝中心の穴）
      pR2[i] = (reach * (0.55 + 0.5 * p.charge)) ** 2;
      pvx[i] = p.vx; pvy[i] = p.vy;
    }

    const damp = Math.exp(-1.15 * dt);
    const vmax = (240 + 520 * S.boost) * speedK;
    const vmax2 = vmax * vmax;
    const ig = 1 / CELL;
    const ih = 1 / H;
    const FIELD = 205;

    for (let i = 0; i < N; i++) {
      let x = px_[i], y = py_[i], vx = vx_[i], vy = vy_[i];

      // --- 流れ場 ---
      let gx = (x * ig + 1) | 0; if (gx < 0) gx = 0; else if (gx >= gw) gx = gw - 1;
      let gy = (y * ig + 1) | 0; if (gy < 0) gy = 0; else if (gy >= gh) gy = gh - 1;
      const gi = gy * gw + gx;
      vx += (gfx[gi] * FIELD + bx_[i]) * dt;
      vy += (gfy[gi] * FIELD + by_[i]) * dt;

      // --- 渦 ---
      for (let j = 0; j < np; j++) {
        const ddx = pxs[j] - x, ddy = pys[j] - y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > pR2[j]) continue;
        const d = Math.sqrt(d2) + 0.001;
        const inv = 1 / d;
        const nx = ddx * inv, ny = ddy * inv;

        // 芯より外なら引き寄せ、内なら押し返す → 中心に穴があいたまま回り続ける
        const spring = (d - pc[j]) * (1.9 + 5.2 * pk[j]);
        vx += nx * spring * dt;
        vy += ny * spring * dt;

        // 接線（回す）
        const fall = 1 - d / Math.sqrt(pR2[j]);
        const tang = (620 + 1500 * pk[j]) * swirlK * fall * fall;
        vx += -ny * tang * dt;
        vy += nx * tang * dt;

        // 指を速く動かしたときの引きずり
        if (fall > 0.45) {
          vx += pvx[j] * 1.5 * dt;
          vy += pvy[j] * 1.5 * dt;
        }
      }

      // --- 水面より下は押し戻す。魚は宙を泳ぎ、水面には映るだけにする ---
      // 下にいくほど弱く浮き上がる。境界で押し返すと魚が水面際に
      // 一列に貼りついてしまうので、段差ではなく勾配にする。
      vy -= y * ih * 135 * dt;

      // --- 減衰・速度制限 ---
      vx *= damp; vy *= damp;
      const sp2 = vx * vx + vy * vy;
      if (sp2 > vmax2) {
        const s = vmax / Math.sqrt(sp2);
        vx *= s; vy *= s;
      }

      x += vx * dt; y += vy * dt;

      // --- 画面外はラップ ---
      const m = 60;
      if (x < -m) x += W + m * 2; else if (x > W + m) x -= W + m * 2;
      if (y < -m) y += H + m * 2; else if (y > H + m) y -= H + m * 2;

      px_[i] = x; py_[i] = y; vx_[i] = vx; vy_[i] = vy;
    }

    // --- 波紋 ---
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.r += r.vr * dt;
      r.vr *= Math.exp(-1.6 * dt);
      r.life -= dt;
      if (r.life <= 0 || r.r > r.max) ripples.splice(i, 1);
    }

    // --- 星降り ---
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.life -= dt;
      if (s.life <= 0 || s.y > H + 80) streaks.splice(i, 1);
    }

    // --- 減衰する全体パラメータ ---
    S.warm  = Math.max(0, S.warm  - dt * 0.42);
    S.flash = Math.max(0, S.flash - dt * 3.4);
    S.shake = Math.max(0, S.shake - dt * 4.2);
    S.boost = Math.max(0, S.boost - dt * 1.5);

    // 溜め中は画面が沈む（MV の、光が消えて一点だけ残るカット）
    let maxCharge = 0;
    for (let i = 0; i < np; i++) maxCharge = Math.max(maxCharge, pk[i]);
    S.dim += (maxCharge * 0.72 - S.dim) * Math.min(1, dt * 5.5);
  }

  /* ============================================================
   * 出来事
   * ============================================================ */
  function addRipple(x, y, power, rgb) {
    ripples.push({
      x, y, r: 8, vr: 340 + 420 * power, max: Math.max(W, H) * (0.5 + power * 0.9),
      life: 0.75 + power * 0.9, life0: 0.75 + power * 0.9,
      w: 1.6 + power * 5, rgb: rgb || S.scene.colors[(Math.random() * S.scene.colors.length) | 0],
    });
  }

  function starfall(n) {
    const cols = S.scene.colors;
    for (let i = 0; i < n; i++) {
      const a = rnd(1.02, 1.42); // ほぼ真下、少し斜め
      const sp = rnd(560, 1180);
      streaks.push({
        x: rnd(-W * 0.25, W * 1.15), y: rnd(-H * 0.4, -20),
        vx: Math.cos(a) * sp * 0.55, vy: Math.sin(a) * sp,
        life: rnd(0.7, 1.5), len: rnd(40, 150),
        rgb: cols[(Math.random() * cols.length) | 0],
      });
    }
  }

  function tap(x, y) {
    addRipple(x, y, 0.18);
    // 波紋の縁の魚をすこし外へ
    for (let i = 0; i < N; i++) {
      const dx = px_[i] - x, dy = py_[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 260 * 260) {
        const d = Math.sqrt(d2) + 0.001;
        const f = (1 - d / 260) * 260;
        vx_[i] += (dx / d) * f; vy_[i] += (dy / d) * f;
      }
    }
    Audio.bell(rnd(0, 1), 0.5);
    buzz(8);
  }

  /* ひらく — このアプリの報酬 */
  function bloom(x, y, power) {
    const p = clamp(power, 0, 1);

    addRipple(x, y, 0.5 + p * 0.9, [255, 236, 200]);

    const R = Math.min(W, H) * (0.5 + p * 0.85);
    for (let i = 0; i < N; i++) {
      const dx = px_[i] - x, dy = py_[i] - y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
      if (d > R) continue;
      const f = (1 - d / R) ** 1.4 * (900 + 1500 * p);
      vx_[i] += (dx / d) * f;
      vy_[i] += (dy / d) * f;
    }

    S.warm = Math.min(1.25, S.warm + 0.55 + p * 0.75);
    S.flash = Math.min(1, 0.30 + p * 0.62);
    S.shake = 0.35 + p * 0.65;
    S.boost = Math.min(1, 0.5 + p * 0.6);

    S.lanterns++;
    hudLantern();

    Audio.burst(p);
    buzz([14, 26, 44][Math.min(2, Math.round(p * 2))]);

    if (S.lanterns % 5 === 0) {
      starfall(26 + Math.round(p * 26));
      Audio.shimmer();
      showHint('星が降る');
    }
  }

  function buzz(ms) {
    if (!S.sound) return;
    try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {}
  }

  /* ============================================================
   * 灯のブルーム（開いたときに画面へ満ちる飴色）
   * ============================================================ */
  let bloomCv = null, bloomKey = '';
  function bakeBloom() {
    const key = `${S.scene.id}|${WD}x${HD}|${waterY}`;
    if (bloomCv && bloomKey === key) return;
    const c = document.createElement('canvas');
    c.width = WD; c.height = HD;
    const g = c.getContext('2d');
    const [r, gg, b] = S.scene.torii;
    const cx = WD / 2, cy = Math.round(waterY * DPR) - Math.round((toriiBox ? toriiBox.th : H * 0.3) * DPR * 0.45);
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(WD, HD) * 0.95);
    rg.addColorStop(0.00, `rgba(${r},${gg},${b},0.95)`);
    rg.addColorStop(0.22, `rgba(${Math.min(255, r)},${Math.min(255, gg + 20)},${Math.min(255, b + 30)},0.42)`);
    rg.addColorStop(0.55, `rgba(${r},${gg},${b},0.13)`);
    rg.addColorStop(1.00, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = rg; g.fillRect(0, 0, WD, HD);
    bloomCv = c; bloomKey = key;
  }

  /* ============================================================
   * 描画
   * ============================================================ */
  function render(t, dtNow) {
    const sc = S.scene;
    bakeBloom();

    /* ============ 裏の層：軌跡（魚と星） ============ */
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = 'source-over';
    tctx.globalAlpha = 1;
    // 60fps 基準の残り具合を dt に合わせて換算する。
    // これをやらないと重い端末ほど尾が伸びて別物になる。
    const f60 = clamp(sc.fade * (1 + S.dim * 2.2), 0.02, 0.9);
    const fa = clamp(1 - Math.pow(1 - f60, dtNow * 60), 0.02, 1);
    tctx.fillStyle = `rgba(${sc.bg[0]},${sc.bg[1]},${sc.bg[2]},${fa})`;
    tctx.fillRect(0, 0, WD, HD);

    tctx.globalCompositeOperation = 'lighter';

    /* --- 星降り --- */
    if (streaks.length) {
      tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      tctx.lineCap = 'round';
      for (const s of streaks) {
        const sp = Math.hypot(s.vx, s.vy) + 1e-3;
        const ux = s.vx / sp, uy = s.vy / sp;
        const a = clamp(s.life, 0, 1) * 0.9;
        const g = tctx.createLinearGradient(s.x, s.y, s.x - ux * s.len, s.y - uy * s.len);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(0.3, `rgba(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]},${a * 0.7})`);
        g.addColorStop(1, `rgba(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]},0)`);
        tctx.strokeStyle = g;
        tctx.lineWidth = 2.2;
        tctx.beginPath();
        tctx.moveTo(s.x, s.y);
        tctx.lineTo(s.x - ux * s.len, s.y - uy * s.len);
        tctx.stroke();
      }
      tctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* --- 魚。速いほど進行方向に伸ばす（＝そのまま流れの筋になる） --- */
    // 加算合成なので、数を増やすほど一匹あたりを暗くしないと
    // 重なったところが白く潰れて色が消える。
    tctx.globalAlpha = clamp(1150 / Math.max(N, 1), 0.40, 1);
    const half = spriteS / 2;
    for (let i = 0; i < N; i++) {
      const vx = vx_[i], vy = vy_[i];
      const sp = Math.sqrt(vx * vx + vy * vy);
      let co = 1, si = 0;
      if (sp > 1e-3) { co = vx / sp; si = vy / sp; }
      const ky = sz_[i] * DPR;
      const kx = ky * (1 + (sp > 130 ? Math.min(1.7, (sp - 130) / 300) : 0));
      tctx.setTransform(co * kx, si * kx, -si * ky, co * ky, px_[i] * DPR, py_[i] * DPR);
      tctx.drawImage(sprites[ci_[i]], -half, -half);
    }

    tctx.globalAlpha = 1;

    /* ============ 表の層：ここから毎フレーム描き直す ============ */
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(trailCv, 0, 0);

    /* --- 鳥居 --- */
    if (toriiBox) {
      const bx = toriiBox.x * DPR, by = toriiBox.y * DPR;
      const bw = toriiBox.w * DPR, bh = toriiBox.h * DPR;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = clamp(1 - S.dim * 0.18, 0, 1);
      ctx.drawImage(toriiBox.sil, bx, by, bw, bh);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(sc.glow * (0.15 + 0.82 * Math.min(1.1, S.warm)) * (1 - S.dim * 0.82), 0, 1);
      ctx.drawImage(toriiBox.lit, bx, by, bw, bh);
      ctx.globalAlpha = 1;
    }

    /* --- 5. 波紋 --- */
    if (ripples.length) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      for (const r of ripples) {
        const a = clamp(r.life / r.life0, 0, 1) ** 1.5;
        ctx.strokeStyle = `rgba(${r.rgb[0]},${r.rgb[1]},${r.rgb[2]},${a * 0.34})`;
        ctx.lineWidth = r.w * a + 0.5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, TAU);
        ctx.stroke();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* --- 6. 水鏡 --- */
    const wyD = Math.round(waterY * DPR);
    if (S.reflect && wyD > 8 && HD > wyD + 4) {
      const srcTop = Math.max(0, 2 * wyD - HD);
      const srcH = wyD - srcTop;
      const BANDS = 16;
      const bh = srcH / BANDS;
      ctx.globalCompositeOperation = 'lighter';
      ctx.setTransform(1, 0, 0, -1, 0, 2 * wyD);
      for (let b = 0; b < BANDS; b++) {
        const sy = wyD - (b + 1) * bh;
        const amp = (0.8 + b * 0.32) * DPR;
        const off = Math.sin(t * 1.7 + b * 0.7) * amp;
        // 端に隙間ができないよう、ずらした幅ぶんだけ横に食い込ませて描く
        const pad = amp + 1;
        ctx.globalAlpha = 0.15 * (1 - (b / BANDS) * 0.85);
        ctx.drawImage(cv, 0, sy, WD, bh, off - pad, sy, WD + pad * 2, bh);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;

      // 奥ほど水に沈める
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(waterGrad, 0, 0, 1, waterGrad.height, 0, wyD, WD, HD - wyD);

      // 水際の光の帯
      ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createLinearGradient(0, wyD - 3 * DPR, 0, wyD + 5 * DPR);
      const tc = sc.torii;
      lg.addColorStop(0, 'rgba(0,0,0,0)');
      lg.addColorStop(0.5, `rgba(${tc[0]},${tc[1]},${tc[2]},${0.10 + 0.30 * Math.min(1, S.warm)})`);
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(0, wyD - 3 * DPR, WD, 8 * DPR);
    }

    /* --- 7. 灯のブルーム --- */
    if (S.warm > 0.002) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(S.warm * 0.19, 0, 0.24);
      ctx.drawImage(bloomCv, 0, 0);
      ctx.globalAlpha = 1;
    }

    /* --- 8. ビネット（溜め中はきつく締める） --- */
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = clamp(0.55 + S.dim * 0.45, 0, 1);
    ctx.drawImage(vignette, 0, 0);
    ctx.globalAlpha = 1;

    /* --- 9. 溜めのリング --- */
    if (pointers.size) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      for (const p of pointers.values()) {
        if (p.charge < 0.015) continue;
        const R = 34 + p.charge * 26;
        ctx.strokeStyle = `rgba(255,232,190,${0.16 + p.charge * 0.30})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.stroke();

        ctx.strokeStyle = `rgba(255,214,140,${0.42 + p.charge * 0.42})`;
        ctx.lineWidth = 1.8 + p.charge * 1.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(p.charge, 0, 1));
        ctx.stroke();

        if (p.charge > 0.98) {
          ctx.fillStyle = `rgba(255,244,214,${0.10 + 0.10 * Math.sin(t * 22)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, R * 0.8, 0, TAU); ctx.fill();
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* --- 10. フラッシュ --- */
    if (S.flash > 0.002) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,246,226,${clamp(S.flash * 0.36, 0, 0.5)})`;
      ctx.fillRect(0, 0, WD, HD);
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    /* --- 11. 揺れ（CSS 側でやる。描画座標をずらさないため） --- */
    if (S.shake > 0.003) {
      const a = S.shake * S.shake;
      const dx = (Math.random() - 0.5) * 14 * a;
      const dy = (Math.random() - 0.5) * 14 * a;
      cv.style.transform = `scale(${1 + 0.035 * a}) translate(${dx}px, ${dy}px)`;
    } else if (cv.style.transform) {
      cv.style.transform = '';
    }
  }

  /* ============================================================
   * 音（すべて合成。音源ファイルは持たない）
   *   平調子（A B C E F）の鈴 + 潮騒のパッド。
   * ============================================================ */
  const Audio = (() => {
    let ac = null, master = null, wet = null, dry = null, comp = null;
    let pad = null, surf = null, chargeVoice = null;
    let noiseBuf = null;
    const SCALE = [0, 2, 3, 7, 8];          // 平調子
    const NOTES = [];
    for (let o = 0; o < 4; o++) for (const s of SCALE) NOTES.push(220 * Math.pow(2, (s + o * 12) / 12));

    function noise(sec) {
      const n = Math.floor(ac.sampleRate * sec);
      const b = ac.createBuffer(1, n, ac.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }

    function impulse(sec, decay) {
      const n = Math.floor(ac.sampleRate * sec);
      const b = ac.createBuffer(2, n, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < n; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
        }
      }
      return b;
    }

    function init() {
      if (ac) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();

      comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 26; comp.ratio.value = 7;
      comp.attack.value = 0.004; comp.release.value = 0.28;
      comp.connect(ac.destination);

      master = ac.createGain();
      master.gain.value = 0.9;
      master.connect(comp);

      const conv = ac.createConvolver();
      conv.buffer = impulse(2.6, 2.4);
      wet = ac.createGain(); wet.gain.value = 0.44;
      wet.connect(conv); conv.connect(master);

      dry = ac.createGain(); dry.gain.value = 0.72;
      dry.connect(master);

      noiseBuf = noise(2.2);
      startAmbient();
      return true;
    }

    function out(node, wetAmt) {
      node.connect(dry);
      const w = ac.createGain(); w.gain.value = wetAmt == null ? 1 : wetAmt;
      node.connect(w); w.connect(wet);
    }

    /* 潮騒（フィルタしたノイズ）＋ 低い持続音 */
    function startAmbient() {
      // 潮騒
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 480; bp.Q.value = 0.55;
      const g = ac.createGain(); g.gain.value = 0.0;
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.077;
      const lfoG = ac.createGain(); lfoG.gain.value = 0.016;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      src.connect(bp); bp.connect(g); g.connect(dry);
      const gw = ac.createGain(); gw.gain.value = 0.5; g.connect(gw); gw.connect(wet);
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.linearRampToValueAtTime(0.022, ac.currentTime + 4);
      src.start(); lfo.start();
      surf = { src, g, lfo };

      // パッド（A2 / E3 / A3）
      const pg = ac.createGain(); pg.gain.value = 0.0001;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620; lp.Q.value = 0.4;
      pg.connect(lp); out(lp, 0.8);
      const oscs = [];
      [110, 164.81, 220].forEach((f, i) => {
        const o = ac.createOscillator();
        o.type = i === 2 ? 'triangle' : 'sine';
        o.frequency.value = f;
        o.detune.value = (i - 1) * 5;
        const og = ac.createGain(); og.gain.value = [0.5, 0.32, 0.2][i];
        o.connect(og); og.connect(pg);
        o.start();
        oscs.push(o);
      });
      pg.gain.setValueAtTime(0.0001, ac.currentTime);
      pg.gain.linearRampToValueAtTime(0.05, ac.currentTime + 6);
      pad = { pg, oscs, lp };
    }

    /* 鈴 */
    function bell(pos, vel, freqOverride) {
      if (!ac || !S.sound) return;
      const t = ac.currentTime;
      const f = freqOverride || NOTES[clamp(Math.round(pos * (NOTES.length - 1)), 0, NOTES.length - 1)];
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.20 * vel), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 + vel * 1.4);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.6;
      g.connect(lp); out(lp, 1.1);

      [[1, 1], [2.01, 0.34], [2.98, 0.14], [4.21, 0.06]].forEach(([m, a]) => {
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * m;
        const og = ac.createGain(); og.gain.value = a;
        o.connect(og); og.connect(g);
        o.start(t); o.stop(t + 3.4);
      });
    }

    /* 溜め */
    function setCharge(v) {
      if (!ac || !S.sound) return;
      const t = ac.currentTime;
      if (v <= 0.001) { stopCharge(); return; }
      if (!chargeVoice) {
        const g = ac.createGain(); g.gain.value = 0.0001;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 6;
        const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = 70;
        const n = ac.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
        const ng = ac.createGain(); ng.gain.value = 0.22;
        o.connect(g); n.connect(ng); ng.connect(g);
        g.connect(lp); out(lp, 0.7);
        o.start(); n.start();
        chargeVoice = { o, n, g, lp };
      }
      const c = chargeVoice;
      c.g.gain.cancelScheduledValues(t);
      c.g.gain.setTargetAtTime(0.03 + 0.14 * v, t, 0.05);
      c.o.frequency.setTargetAtTime(70 + 210 * v * v, t, 0.06);
      c.lp.frequency.setTargetAtTime(280 + 2600 * v * v, t, 0.06);
    }

    function stopCharge() {
      if (!chargeVoice || !ac) return;
      const c = chargeVoice; chargeVoice = null;
      const t = ac.currentTime;
      c.g.gain.cancelScheduledValues(t);
      c.g.gain.setTargetAtTime(0.0001, t, 0.05);
      try { c.o.stop(t + 0.5); c.n.stop(t + 0.5); } catch (_) {}
    }

    /* ひらく */
    function burst(p) {
      if (!ac || !S.sound) return;
      stopCharge();
      const t = ac.currentTime;
      const root = 4 + Math.round(p * 5);
      [0, 2, 4, 7, 9].forEach((d, i) => {
        const idx = clamp(root + d, 0, NOTES.length - 1);
        setTimeout(() => bell(0, 0.45 + p * 0.55, NOTES[idx]), i * 26);
      });

      // 低い衝撃
      const sub = ac.createOscillator(); sub.type = 'sine';
      const sg = ac.createGain();
      sub.frequency.setValueAtTime(150, t);
      sub.frequency.exponentialRampToValueAtTime(38, t + 0.42);
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.exponentialRampToValueAtTime(0.22 + p * 0.3, t + 0.012);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
      sub.connect(sg); sg.connect(dry);
      sub.start(t); sub.stop(t + 0.9);

      // 開く音（ノイズのスウェル）
      const n = ac.createBufferSource(); n.buffer = noiseBuf;
      const hp = ac.createBiquadFilter(); hp.type = 'highpass';
      hp.frequency.setValueAtTime(400, t);
      hp.frequency.exponentialRampToValueAtTime(7000, t + 0.7);
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.13 + p * 0.14, t + 0.05);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      n.connect(hp); hp.connect(ng); out(ng, 1.2);
      n.start(t); n.stop(t + 1.3);
    }

    /* 星降り */
    function shimmer() {
      if (!ac || !S.sound) return;
      for (let i = 0; i < 9; i++) {
        setTimeout(() => bell(rnd(0.55, 1), 0.28), i * 95 + Math.random() * 60);
      }
    }

    function setEnabled(on) {
      if (!ac) return;
      master.gain.setTargetAtTime(on ? 0.9 : 0.0001, ac.currentTime, 0.08);
      if (!on) stopCharge();
    }

    function suspend() { if (ac && ac.state === 'running') ac.suspend(); }
    function resume() { if (ac && ac.state !== 'running') ac.resume(); }

    return { init, bell, setCharge, stopCharge, burst, shimmer, setEnabled, suspend, resume,
             get ready() { return !!ac; } };
  })();

  /* ============================================================
   * UI
   * ============================================================ */
  const $ = (id) => document.getElementById(id);
  const elHud = $('hud'), elSheet = $('sheet'), elHint = $('hint'), elSplash = $('splash');
  const elLantern = $('lantern'), elLanternN = $('lanternN'), elHudScene = $('hudScene');
  const elFps = $('fps'), elAbout = $('about');

  let hintTimer = 0;
  function showHint(text, ms) {
    elHint.hidden = false;
    elHint.textContent = text;
    elHint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => elHint.classList.remove('show'), ms || 2100);
  }

  function hudLantern() {
    elLanternN.textContent = S.lanterns;
    elLantern.classList.remove('pop');
    void elLantern.offsetWidth;
    elLantern.classList.add('pop');
    setTimeout(() => elLantern.classList.remove('pop'), 200);
  }

  /* 景色チップ */
  const elScenes = $('scenes');
  SCENES.forEach((sc) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (sc === S.scene ? ' on' : '');
    b.dataset.id = sc.id;
    b.innerHTML = `${sc.name}<small>${sc.sub}</small>`;
    b.addEventListener('click', () => setScene(sc));
    elScenes.appendChild(b);
  });

  function setScene(sc) {
    if (S.scene === sc) return;
    S.scene = sc;
    elHudScene.textContent = sc.name;
    for (const b of elScenes.children) b.classList.toggle('on', b.dataset.id === sc.id);
    resize();                       // スプライト・鳥居・水面をすべて焼き直す
    S.warm = Math.max(S.warm, 0.5);
    S.flash = 0.18;
    Audio.bell(0.72, 0.34);
    showHint(`景色：${sc.name}`);
  }

  /* スライダー */
  const WORDS = [[0.55, 'まばら'], [0.85, 'すこし'], [1.2, 'ふつう'], [1.55, 'たっぷり'], [9, 'あふれる']];
  const WORDS2 = [[0.55, 'ゆるい'], [0.85, 'おだやか'], [1.3, 'ふつう'], [1.75, 'つよい'], [9, '呑まれる']];
  const word = (tbl, v) => (tbl.find(([k]) => v <= k) || tbl[tbl.length - 1])[1];

  const elDensity = $('density'), elSwirl = $('swirl');
  elDensity.addEventListener('input', () => {
    S.density = +elDensity.value;
    $('valDensity').textContent = word(WORDS, S.density);
    retarget();
  });
  elSwirl.addEventListener('input', () => {
    S.swirl = +elSwirl.value;
    $('valSwirl').textContent = word(WORDS2, S.swirl);
  });

  /* トグル */
  function toggle(el, get, set) {
    el.addEventListener('click', () => {
      set(!get());
      el.classList.toggle('is-on', get());
    });
  }
  toggle($('tSound'), () => S.sound, (v) => { S.sound = v; Audio.setEnabled(v); });
  toggle($('tReflect'), () => S.reflect, (v) => { S.reflect = v; });

  const elTilt = $('tTilt');
  elTilt.addEventListener('click', async () => {
    if (S.tilt) { S.tilt = false; S.tiltX = S.tiltY = 0; elTilt.classList.remove('is-on'); return; }
    try {
      const DOE = window.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === 'function') {
        const r = await DOE.requestPermission();
        if (r !== 'granted') { showHint('傾きの許可が取れなかった'); return; }
      }
      if (!DOE) { showHint('この端末は傾きを取れない'); return; }
      window.addEventListener('deviceorientation', onTilt);
      S.tilt = true;
      elTilt.classList.add('is-on');
      showHint('端末を傾けると潮が流れる');
    } catch (_) { showHint('傾きが使えなかった'); }
  });

  function onTilt(e) {
    if (!S.tilt) return;
    const g = clamp((e.gamma || 0) / 40, -1, 1);
    const b = clamp(((e.beta || 0) - 40) / 40, -1, 1);
    S.tiltX += (g * 0.85 - S.tiltX) * 0.08;
    S.tiltY += (b * 0.55 - S.tiltY) * 0.08;
  }

  /* シート */
  const elGrip = $('sheetGrip');
  const setSheet = (open) => elSheet.classList.toggle('open', open);
  elGrip.addEventListener('click', () => setSheet(!elSheet.classList.contains('open')));
  $('btnSheet').addEventListener('click', () => setSheet(!elSheet.classList.contains('open')));

  /* About */
  $('btnAbout').addEventListener('click', () => { elAbout.hidden = false; });
  $('btnAboutClose').addEventListener('click', () => { elAbout.hidden = true; });
  elAbout.addEventListener('click', (e) => { if (e.target === elAbout) elAbout.hidden = true; });

  /* 一枚保存 */
  $('btnShot').addEventListener('click', () => {
    cv.toBlob(async (blob) => {
      if (!blob) { showHint('保存できなかった'); return; }
      const file = new File([blob], `yoi-no-umi-${Date.now()}.png`, { type: 'image/png' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: '宵の海' });
          return;
        }
      } catch (_) { /* キャンセルされただけかもしれないので落とさない */ }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showHint('この一枚を保存した');
    }, 'image/png');
  });

  /* ============================================================
   * 入力
   * ============================================================ */
  const HOLD_DELAY = 0.17;   // ここまでは「タップ」
  const HOLD_FULL = 1.25;    // 溜め切るまで

  cv.addEventListener('pointerdown', (e) => {
    if (!S.started) return;
    if (pointers.size >= MAXP) return;
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, makeP(e.pointerId, e.clientX, e.clientY));
    if (pointers.size === 2) showHint('双子の渦');
  }, { passive: true });

  cv.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.moved += Math.abs(dx) + Math.abs(dy);
    p.vx = p.vx * 0.6 + dx * 24;
    p.vy = p.vy * 0.6 + dy * 24;
    p.x = e.clientX; p.y = e.clientY;
  }, { passive: true });

  function endPointer(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    const held = (performance.now() - p.t0) / 1000;

    if (held < 0.24 && p.moved < 16) {
      const now = performance.now();
      if (now - lastTapT < 330 && Math.abs(p.x - lastTapX) < 48 && Math.abs(p.y - lastTapY) < 48) {
        starfall(30);
        Audio.shimmer();
        addRipple(p.x, p.y, 0.35, [255, 245, 220]);
        showHint('星が降る');
        lastTapT = 0;
      } else {
        tap(p.x, p.y);
        lastTapT = now; lastTapX = p.x; lastTapY = p.y;
      }
    } else if (p.charge > 0.05) {
      bloom(p.x, p.y, p.charge);
    } else {
      addRipple(p.x, p.y, 0.22);
      Audio.bell(rnd(0.2, 0.7), 0.3);
    }
    if (!pointers.size) Audio.stopCharge();
  }
  cv.addEventListener('pointerup', endPointer, { passive: true });
  cv.addEventListener('pointercancel', endPointer, { passive: true });

  // ブラウザ側のジェスチャを黙らせる
  ['gesturestart', 'gesturechange', 'contextmenu'].forEach((n) =>
    document.addEventListener(n, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', (e) => {
    if (e.target === cv) e.preventDefault();
  }, { passive: false });

  /* ============================================================
   * ループ
   * ============================================================ */
  let last = 0, frames = 0, slow = 0, fast = 0;

  function frame(now) {
    if (!S.running) return;
    requestAnimationFrame(frame);

    const t = now / 1000;
    let dt = last ? (now - last) / 1000 : 0.016;
    last = now;
    if (dt > 0.05) dt = 0.05;

    // 溜め
    let maxC = 0;
    for (const p of pointers.values()) {
      const held = (now - p.t0) / 1000;
      p.charge = clamp((held - HOLD_DELAY) / HOLD_FULL, 0, 1);
      p.vx *= 0.82; p.vy *= 0.82;
      if (p.charge > maxC) maxC = p.charge;
      if (p.charge > 0.999 && !p._full) { p._full = true; buzz(20); }
    }
    Audio.setCharge(maxC);

    step(dt, t);
    render(t, dt);

    /* 性能に合わせて群れの数を落とす／戻す */
    frames++;
    const ms = dt * 1000;
    if (ms > 21) { slow++; fast = 0; } else if (ms < 13.5) { fast++; slow = 0; } else { slow = 0; fast = 0; }
    if (QFIX) { /* 固定 */ }
    else if (slow > 55 && S.quality > 0.36) { S.quality = Math.max(0.35, S.quality - 0.12); retarget(); slow = 0; }
    else if (fast > 200 && S.quality < 1) { S.quality = Math.min(1, S.quality + 0.1); retarget(); fast = 0; }

    if (frames % 30 === 0 && elSheet.classList.contains('open')) {
      elFps.textContent = `${Math.round(1 / Math.max(dt, 0.001))} fps ・ 魚 ${N}`;
    }
  }

  /* ============================================================
   * 立ち上げ
   * ============================================================ */
  function start() {
    if (S.started) return;
    S.started = true;
    S.running = true;

    Audio.init();
    Audio.resume();

    elSplash.classList.add('hide');
    setTimeout(() => { elSplash.style.display = 'none'; }, 750);
    elHud.hidden = false;
    elSheet.hidden = false;

    // 最初の一発は勝手にひらいてみせる
    setTimeout(() => {
      bloom(W / 2, H * 0.46, 0.55);
      S.lanterns = 0; hudLantern();
    }, 420);
    setTimeout(() => showHint('押さえて溜める → 離す', 3400), 1500);
    setTimeout(() => { if (S.lanterns === 0) showHint('2本の指で押さえると双子の渦', 3200); }, 12000);

    last = 0;
    requestAnimationFrame(frame);
  }

  $('btnStart').addEventListener('click', start);
  elSplash.addEventListener('click', (e) => { if (e.target === elSplash) start(); });

  /* ============================================================
   * ライフサイクル
   * ============================================================ */
  let rzTimer = 0;
  const onResize = () => {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => { resize(); bloomCv = null; }, 120);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      S.running = false;
      Audio.stopCharge();
      Audio.suspend();
      pointers.clear();
    } else if (S.started) {
      S.running = true;
      Audio.resume();
      last = 0;
      requestAnimationFrame(frame);
    }
  });

  resize();

  // スプラッシュの裏でも少しだけ動かして、開いた瞬間に絵が出来ているようにする
  (function warmup() {
    if (S.started) return;
    step(1 / 30, performance.now() / 1000);
    render(performance.now() / 1000, 1 / 30);
    requestAnimationFrame(warmup);
  })();

})();
