/* Starlit Sea — 光の魚をあやつる
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
  const smoothstep = (t) => t * t * (3 - 2 * t);            // 0..1 の出入りをなだらかに
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ============================================================
   * 景色
   * ============================================================ */
  const QS = new URLSearchParams(location.search);   // ?q=1 で自動調整を止める（動作確認用）
  const QFIX = QS.has('q') ? clamp(parseFloat(QS.get('q')) || 1, 0.2, 1.6) : 0;
  const QSHOW = QS.get('show') || '';                // ?show=rasen などで演目を固定（動作確認用）

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
  /* 景色は切り替えではなく混ぜる。S.scene は「いま画面に出ている景色」で、
     切り替えのあいだは 2 つの定義の中間値が入る可変オブジェクト。
     読む側（描画・魚・鳥居）は今までどおり S.scene を見るだけでよい。 */
  const sceneSnap = (d) => ({
    id: d.id, name: d.name, sub: d.sub,
    bg: d.bg.slice(), fade: d.fade,
    colors: d.colors.map((c) => c.slice()), torii: d.torii.slice(),
    fishScale: d.fishScale, density: d.density, swirl: d.swirl,
    glow: d.glow, speed: d.speed,
  });

  const S = {
    scene: sceneSnap(SCENES[0]),
    quality: 1,          // 実測 FPS で自動調整 0.35..1（?q= で固定）
    density: 1,          // スライダー
    swirl: 1,            // スライダー
    burst: 0.8,          // ひらく強さ（スライダー）
    sound: true,
    awake: false,                          // スリープ無効（Screen Wake Lock）
    reflect: true,
    shows: true,          // ひとりでに動く演目
    tilt: false,
    warm: 0,             // 灯色ブルーム 0..1（開いたときの報酬）
    flash: 0,            // 白フラッシュ
    shake: 0,
    dim: 0,              // 溜め中の暗転
    hdim: 0,             // 螺旋のあいだ光を落とす量 0..1（1 秒かけて出入り）
    boost: 0,            // 開いた直後の速度上限ブースト
    wrapM: 60,           // 画面外の折り返しまでの余白
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
  let moonCv = null, moonX = 0, moonY = 0;
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
  /* 螺旋を何周ぶん登ったか。変わった瞬間に裾へ戻す。 */
  const lap_ = new Int32Array(CAP);
  let N = 0;

  /* ============================================================
   * 演目
   *
   * MV の各カットのフレーム間フローをブロックマッチングで取り、
   * アフィン当てはめで 平行移動 / 発散 / 回転 に分解して出した動きの型。
   * （数値は 192x108・8fps で測った値。1フレームあたりの画素）
   *
   *   渦        2s +24.8  23s +21.2  15s -17.4  27s +12.7   ← 指の渦で実装済み
   *   広がる   13s +13.9   8s +13.8  23s +12.9
   *   集まる   11s -19.8   5s -16.7   6s -13.9
   *   昇る     22s 縦-2.1 かつ 回転+7.8            ← 上昇 + 回転 = 螺旋
   *   横へ     32s -3.1   25s +3.0   34s +2.6
   *   凪       36〜38s 動き量 0.9〜1.1（他は 7〜11）
   *
   * 5s 集まる → 7s 昇る → 8s 広がる の並びが、MV の「暗転してから
   * ひらく」そのもの。これを「吸い込み」として 1 本の演目にしてある。
   * ============================================================ */
  const SHOWS = [
    { id: 'suikomi', name: '吸い込み',   dur: 7.5, w: 3 },
    { id: 'hiraku',  name: '天がひらく', dur: 4.2, w: 3 },
    { id: 'rasen',   name: '昇り螺旋',   dur: 19.5, w: 3 },
    { id: 'shio',    name: '潮',        dur: 6.5, w: 2 },
    { id: 'hoshi',   name: '星降り',     dur: 10.0, w: 2 },
    { id: 'nagi',    name: '凪',        dur: 5.0, w: 1 },
  ];
  const SHOW_W = SHOWS.reduce((a, s) => a + s.w, 0);
  const seen = Object.create(null);   // 名前を出したことがあるか
  let show = null;                    // { def, t, x, y, dir, phase }
  let showIdle = QSHOW ? 1.5 : rnd(7, 13);   // 次の演目まで（秒）
  let lastShow = '';
  let sceneIdle = rnd(48, 74);              // 景色がひとりでに変わるまで（秒）
  const SCENE_FADE = 1.5;                   // 景色が混ざりきるまで（秒）
  let sceneFrom = null, sceneTo = null, sceneMix = 1;
  let bakeSprT = 0, bakeToriiT = 0;
  let helixT = 0;                           // 螺旋が始まってからの秒数

  /* 演目が毎フレーム作る値。内側のループを軽くするため先に出しておく。 */
  const SH = { on: 0, x: 0, y: 0, r2: 0, w: 0, pull: 0, rise: 0, lat: 0,
               ringR: 0, ringW: 0, ringF: 0, calm: 0,
               // 昇り螺旋（垂直な軸のまわりを回りながら昇る）
               hr: 0, hx: 0, hk: 0.3, hw: 0, hph: 0,
               hbase: 0, hapex: 0, hlen: 1, hturns: 0, hu: 0, hflow: 0,
               // 螺旋の前段。まず水際の帯に一様に集まる
               gath: 0, gw: 0, gy0: 0, gy1: 0 };

  /* 奥行き。螺旋のとき、手前を回っている魚を少し大きく描くのに使う。
     これが無いと、横から見た螺旋がただの横波にしか見えない。 */
  const dep_ = new Float32Array(CAP).fill(1);

  /* エフェクト */
  const ripples = [];   // {x,y,r,vr,life,max,w,rgb}
  const streaks = [];   // 星降り {x,y,vx,vy,life,len,rgb}
  const drops = [];     // 着水のしぶき {x,y,vx,vy,life,life0,rgb}
  const DROP_MAX = 240;
  let fallT = 0;        // 星降りの残り時間（秒）
  let fallAcc = 0;      // 湧かせる数の端数
  let fallBell = 0;     // 次の一粒が鳴るまで

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
    const tw = Math.min(W * 0.88, H * 0.56) * (2 / 3);
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
    baseFish = clamp(Math.min(W, H) / 46, 8, 18) * 0.8;

    gw = Math.ceil(W / CELL) + 2;
    gh = Math.ceil(H / CELL) + 2;
    gfx = new Float32Array(gw * gh);
    gfy = new Float32Array(gw * gh);

    buildSprites();
    bakeTorii();
    bakeMoon();

    // 手前を締めるビネット（つづきは resize の中）
    const vg = document.createElement('canvas');
    vg.width = WD; vg.height = HD;
    const vc = vg.getContext('2d');
    const rg = vc.createRadialGradient(WD / 2, HD * 0.48, Math.min(WD, HD) * 0.30,
                                       WD / 2, HD * 0.48, Math.max(WD, HD) * 0.78);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(0,0,0,0.72)');
    vc.fillStyle = rg; vc.fillRect(0, 0, WD, HD);
    vignette = vg;

    bakeWater();
    retarget();
  }

  /* 水面の奥行きフェード。背景色を使うので、景色が混ざるあいだも焼き直す。 */
  function bakeWater() {
    const wgc = document.createElement('canvas');
    wgc.width = 1; wgc.height = Math.max(1, HD - Math.round(waterY * DPR));
    const wg = wgc.getContext('2d');
    const lg = wg.createLinearGradient(0, 0, 0, wgc.height);
    const b = S.scene.bg;
    const c = `${b[0]},${b[1]},${b[2]}`;
    lg.addColorStop(0, `rgba(${c},0.06)`);
    lg.addColorStop(0.5, `rgba(${c},0.58)`);
    lg.addColorStop(1, `rgba(${c},0.96)`);
    wg.fillStyle = lg; wg.fillRect(0, 0, 1, wgc.height);
    waterGrad = wgc;
  }

  /* 景色を 1 フレームぶん混ぜる。
     焼き直し（魚のスプライト・鳥居・水面）は毎フレームやると重いので間引く。
     軌跡の層が前の色を持っているので、多少とびとびでも段には見えない。 */
  function stepScene(dt) {
    if (sceneMix >= 1) return;
    sceneMix = Math.min(1, sceneMix + dt / SCENE_FADE);
    const k = smoothstep(sceneMix);
    const a = sceneFrom, b = sceneTo, sc = S.scene;
    const mix = (p, q) => p + (q - p) * k;
    // 色は整数に丸めておく。そのまま rgba() に入る値にしておきたい。
    const mixc = (p, q) => Math.round(p + (q - p) * k);
    for (let i = 0; i < 3; i++) {
      sc.bg[i] = mixc(a.bg[i], b.bg[i]);
      sc.torii[i] = mixc(a.torii[i], b.torii[i]);
    }
    for (let c = 0; c < sc.colors.length; c++)
      for (let i = 0; i < 3; i++) sc.colors[c][i] = mixc(a.colors[c][i], b.colors[c][i]);
    sc.fade = mix(a.fade, b.fade);
    sc.fishScale = mix(a.fishScale, b.fishScale);
    sc.density = mix(a.density, b.density);
    sc.swirl = mix(a.swirl, b.swirl);
    sc.glow = mix(a.glow, b.glow);
    sc.speed = mix(a.speed, b.speed);

    bakeSprT -= dt; bakeToriiT -= dt;
    if (bakeSprT <= 0 || sceneMix >= 1) {
      bakeSprT = 0.1; buildSprites(); bakeWater(); retarget();
    }
    if (bakeToriiT <= 0 || sceneMix >= 1) { bakeToriiT = 0.3; bakeTorii(); }
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
  /* 溜めリングの半径（見た目）と、魚が回る芯の半径。
     魚の輪はリングの内側に収まってほしいので、芯はリングから逆算して決める。
     個体ごとに 0.87〜1.55 倍ばらけるので、いちばん外を回る魚でもリングを
     はみ出さないところに置く。 */
  const ringR = (charge) => 34 + 30 * charge;
  const coreR = (charge) => ringR(charge) * 0.56;

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
    const pxs = [0, 0, 0], pys = [0, 0, 0], pk = [0, 0, 0], pc = [0, 0, 0], pR2 = [0, 0, 0];
    const pw = [0, 0, 0], pin = [0, 0, 0], pbl = [0, 0, 0];
    const reach = Math.min(W, H) * 0.95;
    for (let i = 0; i < np; i++) {
      const p = P[i];
      pxs[i] = p.x; pys[i] = p.y;
      pk[i] = p.charge;
      pc[i] = coreR(p.charge);                       // 目標半径（＝渦の芯）
      pR2[i] = (reach * (0.5 + 0.55 * p.charge)) ** 2;
      pw[i] = (1.8 + 2.6 * p.charge) * swirlK;       // 芯の角速度 rad/s
      pin[i] = 95 + 105 * p.charge;                  // 内へ落ちる速さの上限 px/s
      pbl[i] = clamp((3.5 + 7 * p.charge) * dt, 0, 1); // 速度場へ寄せる速さ
    }

    stepScene(dt);
    stepShow(dt);
    // 螺旋のあいだは魚を暗く・尾を短くする。曲線に全員が乗るので、
    // そのままだと加算で白く飛ぶ。ただし切り替えると、螺旋が始まった
    // 瞬間に画面がガクッと暗くなる。始まって 1 秒おいてから、
    // 1 秒かけて落とす。
    helixT = SH.hr > 1 ? helixT + dt : 0;
    S.hdim = clamp(S.hdim + (helixT > 1 ? dt : -dt * 1.6), 0, 1);
    const shOn = SH.on;
    const shBl = shOn ? clamp(5.5 * dt, 0, 1) : 0;
    const depGrab = Math.min(1, dt * 6), depRelax = Math.min(1, dt * 3);

    const damp = Math.exp(-(1.15 + SH.calm * 7) * dt);
    const vmax = (240 + 520 * S.boost) * speedK * (1 - SH.calm * 0.8) * (SH.hr > 1 ? 1.6 : 1);
    const vmax2 = vmax * vmax;
    const ig = 1 / CELL;
    const ih = 1 / H;
    // 螺旋の裾は画面幅より広い。折り返しの余白もそのぶん広げないと、
    // 画面外へ出た魚が反対側へワープしてしまう。急に戻すとまとめて飛ぶので、
    // 終わったあとは 2 秒ほどかけてゆっくり戻す。
    S.wrapM += ((SH.hr > 1 ? 210 : 60) - S.wrapM) * Math.min(1, dt * 0.5);
    const m = S.wrapM;
    const FIELD = 205;

    for (let i = 0; i < N; i++) {
      let x = px_[i], y = py_[i], vx = vx_[i], vy = vy_[i];
      // 全員が同じ半径を目指すと輪が1本の線に潰れ、加算で白く飛んで色が消える。
      // 個体の大きさをそのまま「どの高さを回るか」に使って帯に厚みを出す。
      const coreF = 0.50 + 0.68 * sz_[i];      // 0.87〜1.55 倍

      // --- 流れ場 ---
      let gx = (x * ig + 1) | 0; if (gx < 0) gx = 0; else if (gx >= gw) gx = gw - 1;
      let gy = (y * ig + 1) | 0; if (gy < 0) gy = 0; else if (gy >= gh) gy = gh - 1;
      const gi = gy * gw + gx;
      const fk = 1 - SH.calm * 0.85;
      vx += (gfx[gi] * FIELD * fk + bx_[i]) * dt;
      vy += (gfy[gi] * FIELD * fk + by_[i]) * dt;

      // --- 演目 ---
      // 奥行きを 1 に戻す枝は演目の外に置く。中に入れると、演目が終わった
      // 瞬間に条件へ入らなくなり、魚の大きさが螺旋のときのまま固定される。
      if (SH.hr < 1 && dep_[i] !== 1) {
        dep_[i] += (1 - dep_[i]) * depRelax;
        if (dep_[i] > 0.999 && dep_[i] < 1.001) dep_[i] = 1;
      }
      if (shOn) {
        // 個体ごとに参加する時刻をずらす。全員が同時に寄ると、一瞬で
        // 1 本の帯になって機械的に見える。参加してからも 2 秒ほどかけて効かせる。
        const join = 0.02 + (i % 89) * (0.18 / 89);
        const jw = SH.hu > join ? Math.min(1, (SH.hu - join) / 0.16) : 0;

        // --- 螺旋の 1 段目：水際の帯へ一様に集まる ---
        // 乱数で配ると粗密ができて「一様」に見えないので、低不一致列
        // （黄金比・可塑数の小数部）で並べる。i だけで決まるので配列も要らない。
        if (SH.gath > 0) {
          const gu = (i * 0.6180339887) % 1;
          const gv = (i * 0.7548776662) % 1;
          const gxT = W * (0.06 + 0.88 * gu) + bx_[i] * 0.20;
          const gyT = SH.gy0 + (SH.gy1 - SH.gy0) * gv;
          let dxT = (gxT - x) * 0.9;
          let dyT = (gyT - y) * 1.1;
          // 集まりながら軸のまわりを回りはじめる。ここで回転を作っておくと
          // 2 段目の螺旋が急に掴んだように見えない。ただし帯へ降りてきた魚
          // だけを回す。遠くの魚まで回すと、下向きの分を横向きに食われて
          // いつまでも降りてこない（実際そうなって帯にならなかった）。
          const arr = clamp(1 - Math.abs(y - (SH.gy0 + SH.gy1) * 0.5) / (H * 0.16), 0, 1);
          const rx = x - SH.hx, ry = y - (SH.gy0 + SH.gy1) * 0.5;
          dxT += -ry * SH.gw * 0.7 * arr;
          dyT +=  rx * SH.gw * 0.7 * SH.hk * arr;
          // 寄る速さはふだんの泳ぎと同じくらいに抑える（吸い寄せに見せない）。
          // 縦と横で別々に頭打ちにする。ひとつの上限にすると、横の分だけで
          // 使い切って縦が伸びない。
          if (dxT >  150) dxT =  150; else if (dxT < -150) dxT = -150;
          if (dyT >  225) dyT =  225; else if (dyT < -225) dyT = -225;
          vx += (dxT - vx) * shBl * SH.gath;
          vy += (dyT - vy) * shBl * SH.gath;
        }

        if (SH.hr > 1 && jw > 0) {
          // ■ 螺旋上のどこに居るかは「その魚の番号」で決める
          // 以前はいまの高さ y から位相を出していた。すると高さが偏った
          // ときに巻きの一部にしか魚が居らず、螺旋が途切れる／片側に
          // かたまって軸がずれて見えた。下 1/4 に集めた直後はさらに悪く、
          // 全員が hRel≈0＝同じ角度になって 1 点に潰れる。
          // 曲線を先に決めて、そこへ番号順に一様に配る。こうすると魚が
          // どこに居ても、螺旋はいつでも端から端まで描かれる。
          const q = (i * 0.5698402910) % 1;
          // 曲線上のどこに居るか。時間とともに裾から頂点へ送られていく。
          const raw = q + SH.hflow;
          const lap = Math.floor(raw);
          const hRel = raw - lap;
          // 絞りはほぼ一次（少しだけ裾側を張らせた二次）。指数を上げすぎると
          // 上端でしか細らず、見えている範囲では幅が一定に見えてしまう。
          const hp = hRel * (0.55 + 0.45 * hRel);
          // 螺旋では径のばらつきを渦（coreF = 0.87〜1.55 倍）より狭くする。
          // 広いと裾が画面の外へ大きくはみ出し、下から中ほどまで一様に
          // 「見切れて画面いっぱい」になって、絞りがまったく読めなくなる。
          const R = SH.hr * (0.86 + 0.28 * sz_[i]) * (1 - 0.84 * hp);
          // 位相は「全体の回り（hph）＋ 高さぶんのひねり（hturns）」だけで
          // 決める。高さごとに角速度を変えて位相を積むと、ひねりが時間とともに
          // 際限なく増えて巻きが潰れる。ひねりの総量は hturns 側で頭打ちに
          // してあるので、ここでは足すだけにする。
          const th = SH.hph + hRel * SH.hturns + by_[i] * 0.004;
          const cs = Math.cos(th), sn = Math.sin(th);

          // 厳密な曲線に乗せると 1 本の細い帯に潰れて白飛びする。かといって
          // 乗せる数を減らすと巻きの形が読めなくなる。全部乗せたうえで、
          // 線ではなく太さのある管のまわりに散らすのがちょうどよかった。
          const spread = 1 - 0.6 * hRel;                    // 頂点ほど絞る
          const tgx = SH.hx + R * cs + by_[i] * 0.46 * spread;
          const tgy = SH.hbase - hRel * SH.hlen + R * SH.hk * sn
                    + (sz_[i] - 1.05) * 30 * spread;

          // 引く強さと上限を落とす。ここが強いと、遠くの魚が一直線に
          // 飛んできて「吸い寄せられた」ように見える。
          // 頂点まで行った魚は、裾まで泳いで戻すのではなく位置ごと移す。
          // 泳がせると、螺旋を逆走する筋がずっと見えてしまう。
          // 大きさを絞ってから戻すので、水際で湧いたように見える。
          if (lap_[i] !== lap) {
            lap_[i] = lap;
            x = tgx; y = tgy;
            vx = 0; vy = 0;
            dep_[i] = 0.12;
            px_[i] = x; py_[i] = y;
          }

          const ddx = tgx - x, ddy = tgy - y;
          let dxT = ddx * 1.3, dyT = ddy * 1.3;
          // 寄せる速さはここで頭打ちにする。強いと一直線に飛んでくる。
          const sp2 = dxT * dxT + dyT * dyT;
          if (sp2 > 70225) { const qq = 265 / Math.sqrt(sp2); dxT *= qq; dyT *= qq; }

          // 目標そのものも回っているので、その速度を引き継がせる。足さないと
          // 目標へ最短距離で滑り込むだけで、曲がって合流してくれない。
          // ただし遠くの魚まで一緒に回すと、速さの上限に張りついて寄ってこなく
          // なる（実際そうなって螺旋が消えた）。近い魚にだけ、上の頭打ちとは
          // 別枠で足す。
          const dd = Math.sqrt(ddx * ddx + ddy * ddy);
          const near = dd < 70 ? 1 : dd < 280 ? (280 - dd) / 210 : 0;
          if (near > 0) {
            const wv = SH.hw * near;
            dxT += -sn * R * wv;
            dyT += cs * R * SH.hk * wv;
          }
          vx += (dxT - vx) * shBl * jw;
          vy += (dyT - vy) * shBl * jw;

          // sin が正 = 画面で中心より下 = 手前。手前を大きく描く
          dep_[i] += (1 + 0.4 * sn - dep_[i]) * depGrab;
        }
        if (SH.lat) vx += SH.lat * dt;
        if (SH.rise) vy -= SH.rise * dt;
        if (SH.pull || SH.w || SH.ringF) {
          const ex = x - SH.x, ey = y - SH.y;
          const e2 = ex * ex + ey * ey;
          const ed = Math.sqrt(e2) + 0.001;
          if (SH.ringF) {
            // 広がる輪。通り過ぎる縁だけを外へ押す
            const off = Math.abs(ed - SH.ringR);
            if (off < SH.ringW) {
              const k = (1 - off / SH.ringW) * SH.ringF;
              vx += (ex / ed) * k * dt;
              vy += (ey / ed) * k * dt;
            }
          }
          if ((SH.pull || SH.w) && e2 < SH.r2) {
            const oxx = ex / ed, oyy = ey / ed;
            const fall = 1 - ed / Math.sqrt(SH.r2);
            if (SH.pull) {
              const vrT = -SH.pull * fall;
              const vr = vx * oxx + vy * oyy;
              vx += oxx * (vrT - vr) * shBl;
              vy += oyy * (vrT - vr) * shBl;
            }
            if (SH.w) {
              const vtT = SH.w * ed * fall;
              const vt = -vx * oyy + vy * oxx;
              vx += -oyy * (vtT - vt) * shBl;
              vy += oxx * (vtT - vt) * shBl;
            }
          }
        }
      }

      // --- 渦 ---
      // 力を足し合わせるのではなく、渦の「速度場」を作ってそこへ寄せる。
      // 力でやると輪の半径が速度上限との釣り合いで決まってしまい、
      // 位置で直接ねじ伏せると半径方向へまっすぐ滑って渦に見えなくなる。
      for (let j = 0; j < np; j++) {
        const ddx = x - pxs[j], ddy = y - pys[j];    // 中心 → 魚
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > pR2[j]) continue;
        const d = Math.sqrt(d2) + 0.001;
        const inv = 1 / d;
        const ox = ddx * inv, oy = ddy * inv;        // 外向き
        const tx = -oy, ty = ox;                     // 接線

        const target = pc[j] * coreF;

        // 接線: 芯の内側は剛体回転（角速度が一定なので、並んだ魚の間隔が
        // 保たれる＝指を動かしても一点に固まらず輪に戻る）。外側は緩やかに
        // 落とす。1/r で落とすと遠くがほとんど回らず、まっすぐ滑り込む。
        const vtT = d <= target ? pw[j] * d
                                : pw[j] * target * Math.pow(target * inv, 0.4);

        // 半径: 目標半径へ向かう「落ち込む速さ」を直接指定する。
        // 1フレームのあいだ接線方向へ直進するので、円運動は毎回 (vt·dt)²/2r
        // だけ外へずれる。その分をあらかじめ引いておくと、フレームレートが
        // 落ちても輪が膨らまない。
        let vrT = (target - d) * 3.0 - vtT * vtT * dt / (2 * d);
        if (vrT < -pin[j]) vrT = -pin[j];
        else if (vrT > pin[j]) vrT = pin[j];

        // いまの速度を半径／接線に分解して、目標へブレンドする
        const vr = vx * ox + vy * oy;
        const vt = vx * tx + vy * ty;
        const dvr = (vrT - vr) * pbl[j], dvt = (vtT - vt) * pbl[j];
        vx += ox * dvr + tx * dvt;
        vy += oy * dvr + ty * dvt;
      }

      // --- 減衰・速度制限 ---
      vx *= damp; vy *= damp;
      const sp2 = vx * vx + vy * vy;
      if (sp2 > vmax2) {
        const s = vmax / Math.sqrt(sp2);
        vx *= s; vy *= s;
      }

      x += vx * dt; y += vy * dt;

      // --- 画面外はラップ ---
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
    stepStarfall(dt);
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      const above = s.y < waterY;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.life -= dt;
      // 水面に届いたら消えて、そこで跳ねる。画面の外での着水は数えない。
      if (above && s.y >= waterY) {
        if (s.x > -40 && s.x < W + 40) splash(s.x, s.rgb, s.vx);
        streaks.splice(i, 1);
        continue;
      }
      if (s.life <= 0 || s.y > H + 80) streaks.splice(i, 1);
    }

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.vy += 900 * dt;                       // 落ちてくる
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.life -= dt;
      if (d.life <= 0) drops.splice(i, 1);
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

  function dropStar() {
    const cols = S.scene.colors;
    // 角度は「真下からの傾き」で持つ。50〜60 度、右上から左下へ。
    const tilt = rnd(0.87, 1.05);
    const sp = rnd(520, 1120);
    const vx = -Math.sin(tilt) * sp;    // 左へ
    const vy = Math.cos(tilt) * sp;

    // これだけ寝かせると、水面へ落ちるまでに画面幅の 2〜3 倍を横切る。
    // 上端からだけ湧かせると、ほとんどが画面の外を通ってしまう。
    // 進む向きから見た「風上の辺」＝上辺と右辺の両方から湧かせ、
    // それぞれを進行方向へ投影した長さで振り分ける。
    const topLen = W * Math.cos(tilt);
    const rightLen = waterY * Math.sin(tilt);
    let x, y;
    if (Math.random() * (topLen + rightLen) < topLen) {
      x = rnd(-W * 0.05, W * 1.4); y = rnd(-H * 0.12, -20);
    } else {
      x = W + rnd(20, W * 0.35); y = rnd(-H * 0.05, waterY * 0.85);
    }
    streaks.push({
      x, y, vx, vy,
      life: rnd(1.9, 3.2), len: rnd(70, 200),   // 寝ているぶん尾は長めに
      rgb: cols[(Math.random() * cols.length) | 0],
    });
  }

  /* 着水。波紋ひとつと、前へ跳ねるしぶき。 */
  function splash(x, rgb, vxIn) {
    // 指の波紋と同じ配列を使うが、大きさと寿命は別に持つ。
    // addRipple の power をいくら小さくしても輪が画面規模に広がってしまう。
    ripples.push({
      x, y: waterY, r: 2, vr: rnd(80, 120), max: rnd(34, 62),
      life: 0.52, life0: 0.52, w: 2.6, rgb,
    });
    if (drops.length > DROP_MAX) return;
    const n = 4 + ((Math.random() * 4) | 0);
    for (let k = 0; k < n; k++) {
      // 上向きを中心に散らし、入ってきた勢いのぶんだけ前へ流す
      const a = -Math.PI / 2 + rnd(-0.95, 0.95);
      const sp = rnd(90, 320);           // 重力 900 に対して、跳ねの高さが 5〜57px
      const life = rnd(0.3, 0.7);
      drops.push({
        x, y: waterY,
        vx: Math.cos(a) * sp + vxIn * 0.12,
        vy: Math.sin(a) * sp,
        life, life0: life, rgb,
      });
    }
  }

  /* 一気に湧かせず、sec 秒かけて降らせ続ける。
     一度に出すと 1.5 秒で終わってしまい、「星が降っている」時間にならない。 */
  function starfall(sec) {
    fallT = Math.max(fallT, sec);
    for (let i = 0; i < 6; i++) dropStar();   // 出だしだけ少し多めに
  }

  function stepStarfall(dt) {
    if (fallT <= 0) return;
    fallT -= dt;
    const ramp = Math.min(1, fallT / 1.8);    // 終わりぎわは自然に減らす
    fallAcc += dt * 15 * ramp;
    while (fallAcc >= 1) { fallAcc -= 1; dropStar(); }
    fallBell -= dt;
    if (fallBell <= 0) { fallBell = rnd(0.34, 0.8); Audio.shimmer(); }
  }

  /* 月。
     元になった映像では、これは月に見えているだけで実際はミラーボールなので、
     兎も海も無い。ただの白い丸にする。
     明るさはかなり控えめ。ここが強いと、空に丸を貼ったように浮いてしまう。
     加算で乗せて、円のふちから外へ長く薄い暈を伸ばすと、背景に馴染む。 */
  function bakeMoon() {
    const R = Math.max(6, Math.round(Math.min(W, H) * 0.038 * DPR));
    const pad = R * 7;                       // 暈のぶんの余白
    const s = Math.ceil(pad * 2);
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const g = c.getContext('2d');
    const cx = s / 2;

    const halo = g.createRadialGradient(cx, cx, R * 0.9, cx, cx, pad);
    halo.addColorStop(0, 'rgba(198,220,255,0.34)');
    halo.addColorStop(0.18, 'rgba(180,205,250,0.13)');
    halo.addColorStop(0.5, 'rgba(150,185,240,0.028)');
    halo.addColorStop(1, 'rgba(140,175,235,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, s, s);

    // ふちだけ 1px ぶんぼかす。硬いままだと切り抜きに見える。
    const disc = g.createRadialGradient(cx, cx, 0, cx, cx, R);
    disc.addColorStop(0, 'rgba(255,255,255,1)');
    disc.addColorStop(0.92, 'rgba(255,255,255,1)');
    disc.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = disc;
    g.beginPath(); g.arc(cx, cx, R, 0, TAU); g.fill();

    moonCv = c;
    // 横向きのときに HUD の下へ潜らないよう、上端からの余白は最低 76px 取る。
    moonX = W * 0.5;
    moonY = Math.max(H * 0.15, 76);
  }

  /* ============================================================
   * 演目の進行
   * ============================================================ */
  function pickShow() {
    if (QSHOW) return SHOWS.find((d) => d.id === QSHOW) || SHOWS[0];
    let r = Math.random() * SHOW_W;
    for (const d of SHOWS) { r -= d.w; if (r <= 0) return d; }
    return SHOWS[0];
  }

  function startShow(force) {
    let d = force || pickShow();
    // 手で選んだときは、続けて同じでも言われたとおりに出す
    if (!force) for (let i = 0; i < 3 && d.id === lastShow; i++) d = pickShow();
    lastShow = d.id;
    show = { def: d, t: 0, x: W * 0.5, y: H * 0.42, dir: Math.random() < 0.5 ? -1 : 1, phase: -1 };

    // 軸は画面の中央に固定する。周回カウンタも揃えておかないと、
    // 前回の残りが効いて初回に全員がいっせいに飛ぶ。
    if (d.id === 'rasen')  { show.x = W * 0.5; SH.hph = 0; SH.hflow = 0; lap_.fill(0); }
    if (d.id === 'hiraku') { show.x = rnd(W * 0.35, W * 0.65); show.y = H * rnd(0.16, 0.26); }
    if (d.id === 'suikomi'){ show.x = W * 0.5; show.y = waterY - (toriiBox ? toriiBox.th * 0.55 : H * 0.2); }
    if (d.id === 'hoshi')  starfall(d.dur);
    if (d.id === 'shio')   Audio.swell(0.5);

    if (!seen[d.id]) { seen[d.id] = 1; showHint(d.name, 2600); }
  }

  function endShow() {
    show = null;
    SH.on = 0;
    SH.hr = 0;
    SH.gath = 0;
  }

  /* 演目の値をつくる。ここで SH を埋めて、魚のループはそれを読むだけにする。 */
  function stepShow(dt) {
    SH.on = 0; SH.pull = 0; SH.rise = 0; SH.lat = 0; SH.w = 0;
    SH.ringF = 0; SH.calm = 0; SH.hr = 0; SH.gath = 0; SH.gw = 0;

    if (pointers.size) {                       // 指が触れたら演目は即やめる
      if (show) endShow();
      showIdle = Math.max(showIdle, rnd(8, 15));
      return;
    }
    // 景色の時計は演目の最中も進める。演目のあいだ止めていたときは、
    // 演目が時間の 4 割ほどを占めるせいで、60 秒のつもりが実時間で 2 分近く
    // かかっていた。数えるのは通しで、切り替えるのは演目の切れ目だけにする。
    sceneIdle -= dt;

    if (!show) {
      if (!S.shows) return;
      if (sceneIdle <= 0) {
        sceneIdle = rnd(48, 74);
        const other = SCENES.filter((sc) => sc.id !== S.scene.id);
        setScene(other[(Math.random() * other.length) | 0], true);
      }
      showIdle -= dt;
      if (showIdle <= 0) startShow();
      return;
    }

    show.t += dt;
    const d = show.def, u = clamp(show.t / d.dur, 0, 1);
    // 出入りをなだらかにする窓（両端で 0）
    const ease = Math.sin(Math.PI * clamp(u, 0, 1)) ** 0.7;

    SH.on = 1; SH.x = show.x; SH.y = show.y;

    if (d.id === 'suikomi') {
      // 5s「集まる」→ 7s「昇る」→ 8s「広がる」。MV の暗転とひらきの並び。
      if (u < 0.52) {                          // 集める
        const k = u / 0.52;
        SH.r2 = (Math.max(W, H) * 1.2) ** 2;
        SH.pull = 210 * k;
        SH.w = 1.5 * k * show.dir;
        S.dim += (0.62 * k - S.dim) * Math.min(1, dt * 4);
      } else if (u < 0.60) {                   // 締める（止めない）
        // ここは以前 calm = 0.75 を 1 秒あて、減衰・速度上限・流れ場を
        // まとめて殺していた。暗転と重なるので「弾ける前に固まる」ように
        // 見えていた。止めるのではなく、締まりながら回りを速くする。
        const k = (u - 0.52) / 0.08;
        SH.r2 = (Math.max(W, H) * 1.2) ** 2;
        SH.pull = 210 + 90 * k;
        SH.w = (1.5 + 2.6 * k) * show.dir;    // 締まるほど速く回る
        SH.calm = 0.12 * k;                   // 手ざわりを残す程度に留める
        S.dim += (0.78 - S.dim) * Math.min(1, dt * 5);
      } else {                                 // ひらく
        if (show.phase < 1) {
          show.phase = 1;
          bloom(show.x, show.y, 0.92, true);   // 演目のひらきは灯に数えない
        }
        S.dim += (0 - S.dim) * Math.min(1, dt * 6);
      }
    } else if (d.id === 'hiraku') {
      // 8s / 13s / 23s の「広がる」。空の一点から光がひろがる。
      if (show.phase < 0) {
        show.phase = 0;
        addRipple(show.x, show.y, 0.75, [255, 240, 210]);
        S.warm = Math.min(1.25, S.warm + 0.7);
        S.flash = 0.3;
        Audio.burst(0.55);
      }
      SH.ringR = u * Math.max(W, H) * 1.15;
      SH.ringW = 60 + u * 130;
      SH.ringF = 900 * (1 - u) ** 1.3;
    } else if (d.id === 'rasen') {
      // 22s の「縦-2.1 かつ 回転+7.8」。垂直な軸のまわりを回りながら昇る。
      //
      // 1 点のまわりを画面全体で回して、その点を上へ動かすのでは駄目だった。
      // それは「回る円盤の平行移動」で、魚 1 匹ずつは螺旋を描かない。
      //
      // このアプリのカメラは水面が見えている＝斜め上から見ている。だから
      // 垂直軸まわりの円は、画面では縦につぶれた楕円に投影される。
      // 正円にすると真上から見た渦になってしまう。hk = 縦/横 の比。
      //
      // ■ 2 段構えにしている理由
      // 魚の位相は「その魚のいる高さ」で決まる。上下にばらけたまま場を掛けると
      // 高さごとの位相がそろわず、巻きが読めない＝螺旋が壊れて見える。
      // また片側に寄ったまま始まると、それがそのまま軸のずれに見える。
      // そこで 1 段目で全員を水際（画面下 1/4）の帯に一様に並べ、
      // 2 段目でそこから昇らせる。
      const GU = 0.30;                             // 1 段目にあてる割合（13s の約 4s）
      SH.hx = show.x;
      SH.hk = 0.30;
      SH.gy0 = H * 0.775; SH.gy1 = H * 0.985;      // 水際の帯（waterY = H*0.76）
      // 集まる強さ。立ち上げてから、螺旋へ渡す手前で抜く（重ねて渡す）
      SH.gath = smoothstep(clamp(u / 0.09, 0, 1)) *
                (1 - smoothstep(clamp((u - (GU - 0.06)) / 0.09, 0, 1)));
      SH.gw = 0.5 * show.dir;                      // 集まりながらゆるく回り始める

      const hu = clamp((u - GU * 0.82) / (1 - GU * 0.82), 0, 1);   // 螺旋の進み
      SH.hu = hu;
      if (hu > 0) {
        // 昇る音は、実際に昇りはじめる 2 段目の頭で鳴らす
        if (show.phase < 0) { show.phase = 0; Audio.rise(); }
        let ramp = smoothstep(clamp(hu / 0.20, 0, 1));
        // 頂点は下から伸び上がる。はじめは水際に平たく広い渦ができて、
        // それが上へ伸びながら細くなっていく。
        const grow = smoothstep(clamp((hu - 0.02) / 0.36, 0, 1));
        SH.hbase = H * (0.94 - 0.10 * hu);         // 裾（水際あたり）
        SH.hapex = H * (0.86 - 0.84 * grow);       // 頂点（下から上へ伸びる）
        SH.hlen = Math.max(60, SH.hbase - SH.hapex);
        SH.hr = W * 0.47 * ramp;                   // 裾がわずかに画面をはみ出す
        // 裾から頂点までの総ひねり。ここを時間で無限に増やすと（以前は
        // 高さごとに角速度を変えて位相を積んでいた）巻き数が際限なく増え、
        // 13 秒の終わりには 6 周を超えて模様が潰れる＝螺旋が壊れる。
        // 総ひねりは 3.5 周で頭打ちにして、形を保ったまま回す。
        SH.hturns = TAU * (0.6 + 2.9 * grow) * show.dir;
        // 魚は螺旋に沿って登る。以前は「終盤に分布を頂点へ寄せる」形にして
        // いたが、それだと裾が空になって円錐が細い帯に潰れ、螺旋の形その
        // ものが終盤に崩れていた。軸も裾も動かさないまま、魚の居場所だけを
        // 曲線に沿って進める。一周ぶん進んだ魚は裾へ戻す。
        // 終わりぎわだけ速くして、弾ける前に駆け上がる感じを出す。
        SH.hflow += dt * 0.075 * (1 + 3.2 * smoothstep(clamp((hu - 0.72) / 0.14, 0, 1)));
        // 締まるにつれて全体の回りも速くなる（渦が細くなると速くなる）
        SH.hw = (0.85 + 1.00 * hu) * show.dir;
        SH.hph += SH.hw * dt;
        show.y = SH.hapex;

        if (hu > 0.86) {                           // 先端で弾ける
          if (show.phase < 1) {
            show.phase = 1;
            bloom(SH.hx, SH.hapex, 0.9, true);
            starfall(10);                          // 先端で弾けたら必ず星が降る
          }
          SH.hr = 0;                               // 以降は掴まず、散らせる
          SH.gath = 0;
        }
      }
    } else if (d.id === 'shio') {
      // 31〜34s の横流れ。画面ぜんぶが片側へ流れる。
      SH.lat = 235 * ease * show.dir;
    } else if (d.id === 'nagi') {
      // 36〜38s。動きが 1/8 まで落ちる。次の演目が効くようになる。
      SH.calm = ease;
    }
    // hoshi は starfall がやる

    if (show.t >= d.dur) { endShow(); showIdle = QSHOW ? 1.2 : rnd(9, 19); }
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
  function bloom(x, y, power, quiet) {
    const p = clamp(power, 0, 1);

    addRipple(x, y, 0.5 + p * 0.9, [255, 236, 200]);

    // 距離だけで速さを決めると、中心の魚がいちばん速く飛び出してまん中に
    // 穴があく。花火に穴が無いのは「同じ場所から色々な速さで飛び散る」ため。
    // 個体ごとに速さをばらし、遅いものを多めにする（q*q）。遅い個体が
    // まん中に残るので穴があかない。
    const R = Math.min(W, H) * (0.5 + p * 0.85);
    for (let i = 0; i < N; i++) {
      const dx = px_[i] - x, dy = py_[i] - y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
      if (d > R) continue;
      const q = Math.random();
      const f = (1 - d / R) ** 0.7 * (320 + 2000 * p) * q * q * S.burst;
      // 向きも少しばらす。きれいな放射は機械的に見える
      const j = (Math.random() - 0.5) * 0.5;
      const cj = 1 - j * j * 0.5, sj = j;          // 小角近似
      const nx = dx / d, ny = dy / d;
      vx_[i] += (nx * cj - ny * sj) * f;
      vy_[i] += (nx * sj + ny * cj) * f;
    }

    S.warm = Math.min(1.25, S.warm + 0.55 + p * 0.75);
    S.flash = Math.min(1, 0.30 + p * 0.62);
    S.shake = (0.35 + p * 0.65) * S.burst;
    S.boost = Math.min(1, 0.5 + p * 0.6);

    if (!quiet) { S.lanterns++; hudLantern(); }

    Audio.burst(p);
    buzz([14, 26, 44][Math.min(2, Math.round(p * 2))]);

    if (!quiet && S.lanterns % 5 === 0) {
      starfall(10);
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
    const f60 = clamp(sc.fade * (1 + S.dim * 2.2) * (1 + 1.1 * S.hdim), 0.02, 0.9);
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

    /* --- 着水のしぶき --- */
    // 軌跡の層に描くので、短い尾を引いて飛沫らしくなる。
    if (drops.length) {
      tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      for (const d of drops) {
        const a = clamp(d.life / d.life0, 0, 1);
        tctx.fillStyle = `rgba(${d.rgb[0]},${d.rgb[1]},${d.rgb[2]},${a * 0.85})`;
        const r = 1.0 + a * 1.8;
        tctx.beginPath();
        tctx.arc(d.x, d.y, r, 0, TAU);
        tctx.fill();
      }
      tctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* --- 魚。速いほど進行方向に伸ばす（＝そのまま流れの筋になる） --- */
    // 加算合成なので、数を増やすほど一匹あたりを暗くしないと
    // 重なったところが白く潰れて色が消える。
    // 加算合成なので、数を増やすほど一匹あたりを暗くしないと
    // 重なったところが白く潰れて色が消える。螺旋は 1 本の帯に集まるので
    // さらに落とす。
    tctx.globalAlpha = clamp(1150 / Math.max(N, 1), 0.40, 1) * (1 - 0.70 * S.hdim);
    const half = spriteS / 2;
    for (let i = 0; i < N; i++) {
      const vx = vx_[i], vy = vy_[i];
      const sp = Math.sqrt(vx * vx + vy * vy);
      let co = 1, si = 0;
      if (sp > 1e-3) { co = vx / sp; si = vy / sp; }
      const ky = sz_[i] * dep_[i] * DPR;
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

    /* --- 月 --- */
    // 鳥居より先に描く。あとに描くと、重なったときに鳥居の上に乗ってしまう。
    // 溜めているあいだは画面全体が沈むので、月もいっしょに引く。
    if (moonCv) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(0.40 * (1 - S.dim * 0.75), 0, 1);
      ctx.drawImage(moonCv, Math.round(moonX * DPR - moonCv.width / 2),
                            Math.round(moonY * DPR - moonCv.height / 2));
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

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

      // 先に水中を沈めておく。ここを暗くしておかないと、水中を泳いでいる
      // 魚の明るさが反射の下から残って、水面が「ただの鏡像」に見える。
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(${sc.bg[0]},${sc.bg[1]},${sc.bg[2]},0.62)`;
      ctx.fillRect(0, wyD, WD, HD - wyD);
      const BANDS = 16;
      const bh = srcH / BANDS;
      // 加算ではなく source-over で重ねる。加算だと鳥居の暗い部分が
      // 「何も足さない」だけになり、水中に描かれている魚を隠せない。
      // ブレンドなら暗い所は暗く沈むので、鳥居の映り込みがちゃんと影になる。
      ctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(1, 0, 0, -1, 0, 2 * wyD);
      for (let b = 0; b < BANDS; b++) {
        const sy = wyD - (b + 1) * bh;
        const amp = (0.8 + b * 0.32) * DPR;
        const off = Math.sin(t * 1.7 + b * 0.7) * amp;
        // 端に隙間ができないよう、ずらした幅ぶんだけ横に食い込ませて描く
        const pad = amp + 1;
        ctx.globalAlpha = 0.50 * (1 - (b / BANDS) * 0.9);
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
        const R = ringR(p.charge);
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
    let ac = null, master = null, tone = null, wet = null, dry = null, comp = null;
    let pad = null, surf = null, chargeVoice = null;
    let noiseBuf = null;

    /* 原曲（月見ヤチヨ「星降る海」）の音を測って合わせている。
     *   ・調は F メジャー（クロマ照合 r=0.88）。旋律帯で多いのは F4 / A4 / C5 / C4。
     *   ・スペクトルの 62% が 400Hz 以下、3.5kHz 以上は 4% しかない。
     *   ・大きな立ち上がりのアタックは 10→90% で中央値 190ms。
     * つまり「低くて、高域がなくて、立ち上がりが遅い」。
     * 以前は A 平調子・アタック 6ms・非整数倍音つきで、どれも逆をやっていた。
     * ここでは F メジャーペンタトニック（F G A C D）を F3〜F5 に取る。
     * 重なっても濁らず、原曲と同じ調に収まる。 */
    const NOTES = [
      174.61, 196.00, 220.00, 261.63, 293.66,   // F3 G3 A3 C4 D4
      349.23, 392.00, 440.00, 523.25, 587.33,   // F4 G4 A4 C5 D5
      698.46,                                   // F5
    ];

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
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
      return b;
    }

    function init() {
      if (ac) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();

      comp = ac.createDynamicsCompressor();
      // 速いアタックで潰すと、せっかくの緩い立ち上がりが締まって尖って聞こえる。
      comp.threshold.value = -18; comp.knee.value = 30; comp.ratio.value = 3.5;
      comp.attack.value = 0.03; comp.release.value = 0.35;
      comp.connect(ac.destination);

      // 出口でまとめて高域を落とす。原曲に 3.5kHz 以上がほとんどないので、
      // ここを 1 つ通すだけで全体の「尖り」が揃って取れる。
      tone = ac.createBiquadFilter();
      tone.type = 'lowpass'; tone.frequency.value = 3000; tone.Q.value = 0.3;
      tone.connect(comp);

      const shelf = ac.createBiquadFilter();
      shelf.type = 'highshelf'; shelf.frequency.value = 1800; shelf.gain.value = -5;
      shelf.connect(tone);

      master = ac.createGain();
      master.gain.value = 0.9;
      master.connect(shelf);

      const conv = ac.createConvolver();
      conv.buffer = impulse(3.2, 2.2);
      wet = ac.createGain(); wet.gain.value = 0.5;
      wet.connect(conv); conv.connect(master);

      dry = ac.createGain(); dry.gain.value = 0.7;
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

    /* 潮騒（帯域を絞ったノイズ）＋ F メジャーのパッド */
    function startAmbient() {
      const src = ac.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 360; bp.Q.value = 0.5;
      const g = ac.createGain(); g.gain.value = 0.0001;
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.071;
      const lfoG = ac.createGain(); lfoG.gain.value = 0.014;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      src.connect(bp); bp.connect(g); g.connect(dry);
      const gw = ac.createGain(); gw.gain.value = 0.5; g.connect(gw); gw.connect(wet);
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.linearRampToValueAtTime(0.020, ac.currentTime + 5);
      src.start(); lfo.start();
      surf = { src, g, lfo };

      // F2 / C3 / A3 = F メジャーの三和音
      const pg = ac.createGain(); pg.gain.value = 0.0001;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.4;
      pg.connect(lp); out(lp, 0.7);
      const oscs = [];
      [87.31, 130.81, 220.00].forEach((f, i) => {
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.detune.value = (i - 1) * 4;
        const og = ac.createGain(); og.gain.value = [0.62, 0.34, 0.16][i];
        o.connect(og); og.connect(pg);
        o.start();
        oscs.push(o);
      });
      pg.gain.setValueAtTime(0.0001, ac.currentTime);
      pg.gain.linearRampToValueAtTime(0.058, ac.currentTime + 7);
      pad = { pg, oscs, lp };
    }

    /* 鈴。整数倍音だけを使う。非整数倍音を混ぜると金属的に鳴って尖る。 */
    function bell(pos, vel, freqOverride) {
      if (!ac || !S.sound) return;
      const t = ac.currentTime;
      const f = freqOverride || NOTES[clamp(Math.round(pos * (NOTES.length - 1)), 0, NOTES.length - 1)];

      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(Math.max(0.002, 0.17 * vel), t + 0.048);  // ゆるい立ち上がり
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4 + vel * 1.9);

      // 減衰しながら丸くなっていく（実際の撥弦・撥音がそう鳴る）
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 0.4;
      lp.frequency.setValueAtTime(Math.min(2600, f * 5.5), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(260, f * 1.5), t + 1.8);
      g.connect(lp); out(lp, 1.0);

      // [倍率, 音量, デチューン(cent)]
      [[1, 1.00, 0], [1, 0.46, 6], [2, 0.18, 0], [3, 0.045, 0]].forEach(([m, a, det]) => {
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * m;
        o.detune.value = det;
        const og = ac.createGain(); og.gain.value = a;
        o.connect(og); og.connect(g);
        o.start(t); o.stop(t + 5);
      });
    }

    /* 溜め。息を吸うようなうねりにする（上がっていく笛にしない） */
    function setCharge(v) {
      if (!ac || !S.sound) return;
      const t = ac.currentTime;
      if (v <= 0.001) { stopCharge(); return; }
      if (!chargeVoice) {
        const g = ac.createGain(); g.gain.value = 0.0001;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170; lp.Q.value = 3;
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 58;
        const o2 = ac.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 87.31; // F2
        const og2 = ac.createGain(); og2.gain.value = 0.3;
        const n = ac.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
        const ng = ac.createGain(); ng.gain.value = 0.06;    // ノイズは香り付け程度
        o.connect(g); o2.connect(og2); og2.connect(g); n.connect(ng); ng.connect(g);
        g.connect(lp); out(lp, 0.55);
        o.start(); o2.start(); n.start();
        chargeVoice = { o, o2, n, g, lp };
      }
      const c = chargeVoice;
      c.g.gain.cancelScheduledValues(t);
      c.g.gain.setTargetAtTime(0.028 + 0.13 * v, t, 0.09);
      c.o.frequency.setTargetAtTime(58 + 74 * v * v, t, 0.12);
      c.lp.frequency.setTargetAtTime(165 + 720 * v * v, t, 0.12);
    }

    function stopCharge() {
      if (!chargeVoice || !ac) return;
      const c = chargeVoice; chargeVoice = null;
      const t = ac.currentTime;
      c.g.gain.cancelScheduledValues(t);
      c.g.gain.setTargetAtTime(0.0001, t, 0.08);
      try { c.o.stop(t + 0.7); c.o2.stop(t + 0.7); c.n.stop(t + 0.7); } catch (_) {}
    }

    /* ひらく。F の和音（F3 C4 F4 A4 C5）を下からゆっくり積む */
    function burst(p) {
      if (!ac || !S.sound) return;
      stopCharge();
      const t = ac.currentTime;
      [0, 3, 5, 7, 8].forEach((idx, i) => {
        setTimeout(() => bell(0, 0.42 + p * 0.5, NOTES[idx]), i * 55);
      });

      // 低いふくらみ。叩くのではなく押し出す
      const sub = ac.createOscillator(); sub.type = 'sine';
      const sg = ac.createGain();
      sub.frequency.setValueAtTime(131, t);
      sub.frequency.exponentialRampToValueAtTime(87.31, t + 0.55);   // F2 に着地
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(0.2 + p * 0.24, t + 0.07);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      sub.connect(sg); sg.connect(dry);
      sub.start(t); sub.stop(t + 1.7);

      // 開く音。以前は 7kHz まで上がるハイパスで、原曲にない帯域だった。
      // 400〜900Hz（原曲でいちばん厚い帯）のバンドパスに変える。
      const n = ac.createBufferSource(); n.buffer = noiseBuf;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
      bp.frequency.setValueAtTime(260, t);
      bp.frequency.exponentialRampToValueAtTime(880, t + 0.75);
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(0.11 + p * 0.1, t + 0.12);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      n.connect(bp); bp.connect(ng); out(ng, 1.1);
      n.start(t); n.stop(t + 1.8);
    }

    /* 昇り螺旋。F のペンタトニックを下から順に積む */
    function rise() {
      if (!ac || !S.sound) return;
      [0, 2, 3, 5, 7, 8, 10].forEach((idx, i) => {
        setTimeout(() => bell(0, 0.16 + i * 0.022, NOTES[idx]), 220 + i * 640);
      });
    }

    /* 潮。低いところが寄せて引く */
    function swell(amt) {
      if (!ac || !S.sound) return;
      const t = ac.currentTime;
      const n = ac.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.6;
      bp.frequency.setValueAtTime(180, t);
      bp.frequency.linearRampToValueAtTime(520, t + 2.6);
      bp.frequency.linearRampToValueAtTime(180, t + 6);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.055 * amt, t + 2.2);
      g.gain.linearRampToValueAtTime(0.0001, t + 6.2);
      n.connect(bp); bp.connect(g); out(g, 0.9);
      n.start(t); n.stop(t + 6.4);
    }

    /* 星降りのあいだ、ときどき鳴る高めの一粒 */
    function shimmer() {
      if (!ac || !S.sound) return;
      bell(rnd(0.55, 1), 0.2);
    }

    function setEnabled(on) {
      if (!ac) return;
      master.gain.setTargetAtTime(on ? 0.9 : 0.0001, ac.currentTime, 0.1);
      if (!on) stopCharge();
    }

    function suspend() { if (ac && ac.state === 'running') ac.suspend(); }
    function resume() { if (ac && ac.state !== 'running') ac.resume(); }

    return { init, bell, setCharge, stopCharge, burst, shimmer, rise, swell, setEnabled, suspend, resume,
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
    b.className = 'chip' + (sc.id === S.scene.id ? ' on' : '');
    b.dataset.id = sc.id;
    b.innerHTML = `${sc.name}<small>${sc.sub}</small>`;
    b.addEventListener('click', () => setScene(sc));
    elScenes.appendChild(b);
  });

  function setScene(def, quiet) {
    if (S.scene.id === def.id && sceneMix >= 1) return;
    // いま出ている中間値を出発点にする。混ざっている途中で切り替えても跳ねない。
    sceneFrom = sceneSnap(S.scene);
    sceneTo = sceneSnap(def);
    sceneMix = 0;
    bakeSprT = 0; bakeToriiT = 0;
    // 名前と印だけは先に変える。1.5 秒待たされると押しても反応が無く見える。
    S.scene.id = def.id; S.scene.name = def.name; S.scene.sub = def.sub;
    elHudScene.textContent = def.name;
    for (const b of elScenes.children) b.classList.toggle('on', b.dataset.id === def.id);
    S.warm = Math.max(S.warm, quiet ? 0.3 : 0.5);
    if (!quiet) S.flash = 0.18;
    Audio.bell(0.72, quiet ? 0.2 : 0.34);
    showHint(`景色：${def.name}`, quiet ? 2000 : 2100);
  }

  /* スライダー */
  const WORDS = [[0.55, 'まばら'], [0.85, 'すこし'], [1.2, 'ふつう'], [1.55, 'たっぷり'], [9, 'あふれる']];
  const WORDS2 = [[0.55, 'ゆるい'], [0.85, 'おだやか'], [1.3, 'ふつう'], [1.75, 'つよい'], [9, '呑まれる']];
  const WORDS3 = [[0.5, 'そっと'], [0.9, 'おだやか'], [1.2, 'つよい'], [9, '弾ける']];
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

  const elBurst = $('burst');
  elBurst.addEventListener('input', () => {
    S.burst = +elBurst.value;
    $('valBurst').textContent = word(WORDS3, S.burst);
  });

  /* トグル */
  function toggle(el, get, set) {
    el.addEventListener('click', () => {
      set(!get());
      el.classList.toggle('is-on', get());
    });
  }
  toggle($('tReflect'), () => S.reflect, (v) => { S.reflect = v; });
  toggle($('tShows'), () => S.shows, (v) => {
    S.shows = v;
    if (!v) endShow(); else showIdle = rnd(3, 8);
  });

  /* 無音。HUD のボタンとシートのトグルは同じ状態を指すので、
     どちらから触っても両方の見た目が変わるように 1 か所で更新する。 */
  const elMute = $('btnMute'), elTSound = $('tSound');
  function setSound(v, quiet) {
    S.sound = v;
    Audio.setEnabled(v);
    elTSound.classList.toggle('is-on', v);
    elMute.classList.toggle('is-on', v);
    elMute.setAttribute('aria-pressed', v ? 'true' : 'false');
    elMute.setAttribute('aria-label', v ? '音を消す' : '音を出す');
    if (!quiet) showHint(v ? '音が出る' : '無音', 1500);
  }
  elMute.addEventListener('click', () => setSound(!S.sound));
  elTSound.addEventListener('click', () => setSound(!S.sound));

  /* スリープ無効。Screen Wake Lock は
     - 画面が隠れると勝手に解放される（戻ったら取り直す）
     - 対応していない端末がある（黙って効かないのがいちばん困るので言う）
     という 2 点があるので、要求と状態表示を分けて持つ。 */
  const elWake = $('btnWake'), elTWake = $('tWake');
  let wakeLock = null;
  const wakeOK = 'wakeLock' in navigator;

  function paintWake() {
    elWake.classList.toggle('is-on', S.awake);
    elTWake.classList.toggle('is-on', S.awake);
    elWake.setAttribute('aria-pressed', S.awake ? 'true' : 'false');
    elWake.setAttribute('aria-label', S.awake ? 'スリープを許可' : 'スリープ無効');
  }

  async function acquireWake() {
    if (!S.awake || wakeLock || document.hidden || !wakeOK) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      // 端末側の都合で外れることがある。持っていないのに持っている顔をしない。
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) {
      wakeLock = null;
      S.awake = false;
      paintWake();
      showHint('スリープを止められなかった', 2200);
    }
  }

  function releaseWake() {
    if (wakeLock) { try { wakeLock.release(); } catch (_) { /* すでに外れている */ } }
    wakeLock = null;
  }

  async function setAwake(v) {
    if (v && !wakeOK) { showHint('この端末はスリープを止められない', 2400); return; }
    S.awake = v;
    paintWake();
    if (v) { await acquireWake(); if (S.awake) showHint('画面を消さない', 1800); }
    else { releaseWake(); showHint('スリープを許可', 1500); }
  }

  elWake.addEventListener('click', () => setAwake(!S.awake));
  elTWake.addEventListener('click', () => setAwake(!S.awake));

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

  /* シート。
     ハンドルはタップで開閉できるだけでなく、掴んで動かせるようにする。
     途中まで開けて中身を覗く、という操作ができないと、下から出てくる板が
     ただのボタンになってしまう。 */
  const elGrip = $('sheetGrip');
  const GRIP_H = 30;                        // 閉じたときに残す高さ（CSS と合わせる）
  const isOpen = () => elSheet.classList.contains('open');
  const setSheet = (open) => elSheet.classList.toggle('open', open);
  $('btnSheet').addEventListener('click', () => setSheet(!isOpen()));

  let drag = null;
  const hiddenH = () => Math.max(1, elSheet.offsetHeight - GRIP_H);   // 閉じたときの下げ幅

  elGrip.addEventListener('pointerdown', (e) => {
    // ここで既定の動作を止めないと、掴んで動かしたときに
    // 背後のページごとスクロール／リロードの引っぱりが起きる端末がある。
    e.preventDefault();
    // 捕捉は「できたら嬉しい」程度のもの。端末によっては 2 本目の指で
    // 例外を投げるので、ここで落ちて掴めなくなるほうが困る。
    try { elGrip.setPointerCapture(e.pointerId); } catch (_) { /* 無くても動く */ }
    const t0 = performance.now();
    drag = { id: e.pointerId, y0: e.clientY, y: e.clientY, max: hiddenH(),
             base: isOpen() ? 0 : hiddenH(), moved: 0, t0,
             hist: [{ t: t0, y: e.clientY }] };
    elSheet.classList.add('dragging');
  });

  elGrip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.moved = Math.max(drag.moved, Math.abs(e.clientY - drag.y0));
    // 速度は直前の 1 点との差では測らない。指を離すのは最後の move の直後
    // なので、その差だと経過時間がほぼ 0 になり、ゆっくり動かしただけでも
    // 巨大な速度が出て逆側へ弾かれる。直近 140ms ぶんを覚えておいて、
    // その幅で測る。
    const now = performance.now();
    drag.y = e.clientY;
    drag.hist.push({ t: now, y: e.clientY });
    while (drag.hist.length > 2 && now - drag.hist[0].t > 140) drag.hist.shift();
    const off = clamp(drag.base + (e.clientY - drag.y0), 0, drag.max);
    elSheet.style.transform = `translateY(${off}px)`;
  });

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    elSheet.classList.remove('dragging');
    elSheet.style.transform = '';

    // ほとんど動いていなければタップ扱い（今までどおり開閉するだけ）
    if (d.moved < 8 && performance.now() - d.t0 < 400) { setSheet(!isOpen()); return; }

    const off = clamp(d.base + (d.y - d.y0), 0, d.max);
    const s0 = d.hist[0];
    const dt = performance.now() - s0.t;
    // 測る幅が短すぎるときは速度を信じない（近いほうへ寄せる）
    const v = dt >= 30 ? (d.y - s0.y) / dt : 0;        // px/ms、下向きが正
    // 勢いがあればその向きへ。無ければ「動かした量」で決める。
    // 真ん中で分けると、開いた板を閉じるのに画面の半分ぶん引く必要があって重い。
    // どちら向きでも travel の 3 割動かしたら乗り換える、という形にする。
    const line = d.base === 0 ? d.max * 0.30 : d.max * 0.70;
    if (v > 0.35) setSheet(false);
    else if (v < -0.35) setSheet(true);
    else setSheet(off < line);
  }
  elGrip.addEventListener('pointerup', endDrag);
  elGrip.addEventListener('pointercancel', endDrag);

  /* 演目を手で出す（折りたたみの中） */
  const elAcc = $('accShows');
  // 開くと下の段が板の外へはみ出して見切れる。開いた側を見せる。
  elAcc.addEventListener('toggle', () => {
    if (elAcc.open) elAcc.scrollIntoView({ block: 'end', behavior: 'smooth' });
  });
  const elShowBtns = $('showBtns');
  SHOWS.forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'show-btn';
    b.textContent = d.name;
    b.addEventListener('click', () => {
      if (!S.started) return;
      if (show) endShow();
      // 指が触れていると stepShow が即やめてしまう
      pointers.clear();
      startShow(d);
      // 板が下半分を覆っているので、出したら引っ込める
      setSheet(false);
    });
    elShowBtns.appendChild(b);
  });

  /* About */
  $('btnAbout').addEventListener('click', () => { elAbout.hidden = false; });
  $('btnAboutClose').addEventListener('click', () => { elAbout.hidden = true; });
  elAbout.addEventListener('click', (e) => { if (e.target === elAbout) elAbout.hidden = true; });

  /* 一枚保存 */
  $('btnShot').addEventListener('click', () => {
    cv.toBlob(async (blob) => {
      if (!blob) { showHint('保存できなかった'); return; }
      const file = new File([blob], `starlit-sea-${Date.now()}.png`, { type: 'image/png' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Starlit Sea' });
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
        starfall(10);
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

  /* 回っているループはいつでも 1 本だけにする。
     以前は frame() の中で requestAnimationFrame を呼びっぱなしにして、
     止めるのは「S.running を見て return する」だけだった。ところが裏へ回った
     時点で予約済みのコールバックが 1 個宙に浮いたまま残り（裏では発火しない）、
     戻ってきたときに新しく 1 個予約するので、往復するたびに 1 本ずつ増える。
     実測で 1 → 2 → 3 → 4 → 5 本／フレーム。step と render がそのぶん
     何度も走るので「復帰するとめちゃ重い」。
     予約は必ず控えておいて、止めるときは取り消す。 */
  let rafId = 0;

  function startLoop() {
    if (rafId) return;                 // すでに回っている
    last = 0;
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  function frame(now) {
    rafId = 0;
    if (!S.running) return;
    rafId = requestAnimationFrame(frame);

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

    // 起動直後に bloom を出していたが、あれは「離したときの報酬」なので、
    // 触ってもいないのに鳴ると誤タップに見える。演目が代わりに間を持たせる。
    showIdle = QSHOW ? 1.5 : rnd(4, 7);
    setTimeout(() => showHint('押さえて溜める → 離す', 3400), 1200);
    setTimeout(() => { if (S.lanterns === 0) showHint('2本の指で押さえると双子の渦', 3200); }, 12000);

    startLoop();
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
      stopLoop();
      Audio.stopCharge();
      Audio.suspend();
      pointers.clear();
    } else if (S.started) {
      S.running = true;
      Audio.resume();
      // Wake Lock は画面が隠れた時点で端末側が勝手に解放する。戻ってきたら
      // 取り直さないと、入れたつもりのまま効かなくなる。
      wakeLock = null;
      acquireWake();
      startLoop();
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
