// ============================================================================
//  マテリアル — 仕上げ材のテクスチャを canvas で手続き的に生成する
// ============================================================================
//
//  画像ファイルを一切持たずに、木目・タイル目地・左官のムラ・コンクリートの
//  肌を描き起こしています。data/house.js の materials（色とトーン）を
//  そのまま下地の色として使うので、データ側で色を変えれば3Dの見えも変わります。
//
//  テクスチャは「1UV = 1m」で貼ります。BoxGeometry は面ごとに UV が 0..1 なので、
//  scaleBoxUVs() で実寸に合わせて引き伸ばしてから使ってください。
// ============================================================================

import * as THREE from 'three';
import { materials as palette } from '../../data/house.js';

const TEX = 512;

// ---------------------------------------------------------------------------
//  小さな描画ヘルパー
// ---------------------------------------------------------------------------

function canvas2d(size = TEX) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d') };
}

/** 値ノイズ。左官やコンクリートのムラに使う */
function noiseFill(g, size, { scale = 8, alpha = 0.06, octaves = 4 } = {}) {
  for (let o = 0; o < octaves; o++) {
    const cells = scale * 2 ** o;
    const step = size / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const v = Math.random();
        g.fillStyle = `rgba(${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${alpha / (o + 1)})`;
        g.fillRect(x * step, y * step, step + 1, step + 1);
      }
    }
  }
}

function toTexture(c, { repeat = 1, aniso = 8, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
//  各仕上げのテクスチャ
//  いずれも「1テクスチャ = 1m四方」を想定して描く
// ---------------------------------------------------------------------------

/** 木のフローリング／羽目板。板の継ぎ目＋木目の縞 */
function woodTexture(base, { plank = 0.16, dark = 0.10 } = {}) {
  const { c, g } = canvas2d();
  const px = TEX;
  g.fillStyle = base;
  g.fillRect(0, 0, px, px);

  const rows = Math.max(2, Math.round(1 / plank));
  const rowH = px / rows;

  for (let r = 0; r < rows; r++) {
    // 板ごとに色をわずかに振る
    const shift = (Math.random() - 0.5) * dark;
    g.fillStyle = tint(base, shift);
    g.fillRect(0, r * rowH, px, rowH);

    // 木目の縞
    const grains = 26;
    for (let i = 0; i < grains; i++) {
      const y = r * rowH + Math.random() * rowH;
      g.strokeStyle = tint(base, (Math.random() - 0.5) * 0.14, 0.35);
      g.lineWidth = 0.6 + Math.random() * 1.4;
      g.beginPath();
      g.moveTo(0, y);
      const cp = 8 + Math.random() * 20;
      g.bezierCurveTo(px * 0.3, y + cp, px * 0.6, y - cp, px, y + (Math.random() - 0.5) * 6);
      g.stroke();
    }
    // 板の継ぎ目
    g.strokeStyle = tint(base, -0.35, 0.5);
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(0, r * rowH);
    g.lineTo(px, r * rowH);
    g.stroke();
  }
  // 板の小口（横方向の目地）をランダムに
  for (let i = 0; i < rows; i++) {
    const x = Math.random() * px;
    g.strokeStyle = tint(base, -0.3, 0.45);
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x, i * rowH);
    g.lineTo(x, (i + 1) * rowH);
    g.stroke();
  }
  return c;
}

/** タイル。目地幅と割付を指定 */
function tileTexture(base, { tile = 0.6, grout = 0.012, groutColor = null } = {}) {
  const { c, g } = canvas2d();
  const px = TEX;
  const n = Math.max(1, Math.round(1 / tile));
  const cell = px / n;
  const gw = Math.max(1.2, grout * px);

  g.fillStyle = groutColor ?? tint(base, -0.22);
  g.fillRect(0, 0, px, px);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      g.fillStyle = tint(base, (Math.random() - 0.5) * 0.05);
      g.fillRect(x * cell + gw / 2, y * cell + gw / 2, cell - gw, cell - gw);
    }
  }
  noiseFill(g, px, { scale: 16, alpha: 0.03, octaves: 2 });
  return c;
}

/** 左官（モルタル）。コテむらのある面 */
function mortarTexture(base) {
  const { c, g } = canvas2d();
  const px = TEX;
  g.fillStyle = base;
  g.fillRect(0, 0, px, px);
  // コテのストローク。近くで見たときに質感が出る程度に、うっすらと
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * px;
    const y = Math.random() * px;
    const w = 40 + Math.random() * 150;
    const h = 12 + Math.random() * 36;
    g.save();
    g.translate(x, y);
    g.rotate((Math.random() - 0.5) * 1.2);
    g.fillStyle = tint(base, (Math.random() - 0.5) * 0.055, 0.13);
    g.beginPath();
    g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  noiseFill(g, px, { scale: 14, alpha: 0.022, octaves: 3 });
  return c;
}

/** 打放しコンクリート。パネル割＋Pコン跡 */
function concreteTexture(base) {
  const { c, g } = canvas2d();
  const px = TEX;
  g.fillStyle = base;
  g.fillRect(0, 0, px, px);
  noiseFill(g, px, { scale: 12, alpha: 0.05, octaves: 4 });

  // 型枠のパネル割（1テクスチャ＝1mなので、割付は控えめに）
  g.strokeStyle = tint(base, -0.18, 0.5);
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(0, 1); g.lineTo(px, 1);
  g.moveTo(1, 0); g.lineTo(1, px);
  g.stroke();

  // Pコン跡
  for (const [x, y] of [[px * 0.25, px * 0.25], [px * 0.75, px * 0.25], [px * 0.25, px * 0.75], [px * 0.75, px * 0.75]]) {
    const r = px * 0.014;
    const grad = g.createRadialGradient(x, y, 0, x, y, r * 2);
    grad.addColorStop(0, tint(base, -0.2, 0.8));
    grad.addColorStop(1, tint(base, 0, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r * 2, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** 塗装。ほぼ無地だが、のっぺりしないよう微細なムラを入れる */
function paintTexture(base) {
  const { c, g } = canvas2d(256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  noiseFill(g, 256, { scale: 24, alpha: 0.022, octaves: 2 });
  return c;
}

/** 芝 */
function lawnTexture(base) {
  const { c, g } = canvas2d();
  const px = TEX;
  g.fillStyle = base;
  g.fillRect(0, 0, px, px);
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * px;
    const y = Math.random() * px;
    g.strokeStyle = tint(base, (Math.random() - 0.45) * 0.5, 0.5);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 4, y - 3 - Math.random() * 5);
    g.stroke();
  }
  return c;
}

/** ゴムタイル（ジム床）。細かい斑点 */
function rubberTexture(base) {
  const { c, g } = canvas2d();
  const px = TEX;
  g.fillStyle = base;
  g.fillRect(0, 0, px, px);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = tint(base, (Math.random() - 0.3) * 0.5, 0.5);
    g.beginPath();
    g.arc(Math.random() * px, Math.random() * px, 0.6 + Math.random() * 1.6, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** ルーバー天井（ダーク）。等間隔の桟 */
function slatTexture(base) {
  const { c, g } = canvas2d();
  const px = TEX;
  g.fillStyle = tint(base, -0.5);
  g.fillRect(0, 0, px, px);
  const n = 12;
  const cell = px / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = tint(base, (Math.random() - 0.5) * 0.06);
    g.fillRect(i * cell + cell * 0.16, 0, cell * 0.68, px);
  }
  return c;
}

/** ウォールナットの造作棚／縦格子。縦のリズム */
function shelfTexture(base) {
  const { c, g } = canvas2d();
  const px = TEX;
  const wood = woodTexture(base, { plank: 0.34, dark: 0.12 });
  g.drawImage(wood, 0, 0);
  // 棚板のライン
  g.strokeStyle = tint(base, -0.45, 0.6);
  g.lineWidth = 2.4;
  for (const t of [0.34, 0.68]) {
    g.beginPath();
    g.moveTo(0, px * t);
    g.lineTo(px, px * t);
    g.stroke();
  }
  return c;
}

// ---------------------------------------------------------------------------
//  色ユーティリティ
// ---------------------------------------------------------------------------

/** base を amount(-1..1) だけ明暗させる。alpha を渡すと rgba を返す */
function tint(base, amount, alpha = 1) {
  const col = new THREE.Color(base);
  if (amount >= 0) col.lerp(new THREE.Color('#ffffff'), amount);
  else col.lerp(new THREE.Color('#000000'), -amount);
  const r = Math.round(col.r * 255);
  const g = Math.round(col.g * 255);
  const b = Math.round(col.b * 255);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
//  仕上げID → マテリアル
// ---------------------------------------------------------------------------

/** 各仕上げの作り方。texture は canvas を返す関数 */
const RECIPES = {
  'f-tile-beige':   { tex: (c) => tileTexture(c, { tile: 0.6 }),                rough: 0.55, metal: 0.02 },
  'f-oak-pale':     { tex: (c) => woodTexture(c, { plank: 0.16 }),              rough: 0.62, metal: 0.0 },
  'f-mortar':       { tex: (c) => mortarTexture(c),                             rough: 0.78, metal: 0.0 },
  'f-concrete':     { tex: (c) => concreteTexture(c),                           rough: 0.86, metal: 0.0 },
  'f-rubber-dark':  { tex: (c) => rubberTexture(c),                             rough: 0.94, metal: 0.0 },
  'f-walnut':       { tex: (c) => woodTexture(c, { plank: 0.18, dark: 0.14 }),  rough: 0.5,  metal: 0.0 },
  'f-tile-white':   { tex: (c) => tileTexture(c, { tile: 0.3, grout: 0.02 }),   rough: 0.35, metal: 0.03 },
  'f-lawn':         { tex: (c) => lawnTexture(c),                               rough: 0.95, metal: 0.0 },

  'w-mortar':       { tex: (c) => mortarTexture(c),                             rough: 0.82, metal: 0.0 },
  'w-white':        { tex: (c) => paintTexture(c),                              rough: 0.9,  metal: 0.0 },
  'w-mirror':       { tex: null,                                                rough: 0.04, metal: 1.0 },
  'w-walnut-slat':  { tex: (c) => shelfTexture(c),                              rough: 0.5,  metal: 0.0 },
  'w-walnut-shelf': { tex: (c) => shelfTexture(c),                              rough: 0.5,  metal: 0.0 },
  'w-tile-mosaic':  { tex: (c) => tileTexture(c, { tile: 0.05, grout: 0.006 }), rough: 0.3,  metal: 0.04 },
  'w-concrete':     { tex: (c) => concreteTexture(c),                           rough: 0.88, metal: 0.0 },

  'c-wood-pale':    { tex: (c) => woodTexture(c, { plank: 0.13 }),              rough: 0.66, metal: 0.0 },
  'c-white':        { tex: (c) => paintTexture(c),                              rough: 0.95, metal: 0.0 },
  'c-dark-slat':    { tex: (c) => slatTexture(c),                               rough: 0.8,  metal: 0.0 },
  'c-open':         { tex: null,                                                rough: 1.0,  metal: 0.0 },
};

const cache = new Map();

/** 仕上げID（data/house.js の materials のキー）から MeshStandardMaterial を得る */
export function finishMaterial(id) {
  if (cache.has(id)) return cache.get(id);

  const def = palette[id];
  const recipe = RECIPES[id] ?? { tex: (c) => paintTexture(c), rough: 0.9, metal: 0 };
  const base = def?.color ?? '#cccccc';

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: recipe.rough,
    metalness: recipe.metal,
  });
  if (recipe.tex) {
    mat.map = toTexture(recipe.tex(base));
  } else {
    mat.color = new THREE.Color(base);
  }
  cache.set(id, mat);
  return mat;
}

// ---------------------------------------------------------------------------
//  共通マテリアル（建具・家具・ガラスなど）
// ---------------------------------------------------------------------------

let shared = null;

export function sharedMaterials() {
  if (shared) return shared;

  // 透過は transmission ではなく素直な半透明で。軽いうえに、
  // どの環境でも「向こう側が見える」ことが保証される。
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xe8f2f4,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.14,
    reflectivity: 0.5,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  shared = {
    glass,
    // 建具・サッシの框
    frameDark: new THREE.MeshStandardMaterial({ color: 0x2c2823, roughness: 0.45, metalness: 0.35 }),
    frameWood: new THREE.MeshStandardMaterial({ map: toTexture(woodTexture('#6b4b33', { plank: 0.5 })), roughness: 0.5 }),
    doorWood:  new THREE.MeshStandardMaterial({ map: toTexture(woodTexture('#7d5a3d', { plank: 0.9, dark: 0.05 })), roughness: 0.52 }),
    steel:     new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 0.32, metalness: 0.85 }),
    steelPale: new THREE.MeshStandardMaterial({ color: 0x9aa0a2, roughness: 0.28, metalness: 0.9 }),
    chrome:    new THREE.MeshStandardMaterial({ color: 0xdfe3e5, roughness: 0.08, metalness: 1.0 }),
    white:     new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.5 }),
    porcelain: new THREE.MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.15, metalness: 0.02 }),
    fabricPale:new THREE.MeshStandardMaterial({ color: 0xd8d1c4, roughness: 0.95 }),
    fabricDark:new THREE.MeshStandardMaterial({ color: 0x4a423a, roughness: 0.92 }),
    leather:   new THREE.MeshStandardMaterial({ color: 0x3a3229, roughness: 0.55 }),
    rug:       new THREE.MeshStandardMaterial({ color: 0xc9bfae, roughness: 1.0 }),
    oak:       new THREE.MeshStandardMaterial({ map: toTexture(woodTexture('#dcc199', { plank: 0.5 })), roughness: 0.6 }),
    walnut:    new THREE.MeshStandardMaterial({ map: toTexture(woodTexture('#6b4b33', { plank: 0.5 })), roughness: 0.5 }),
    stoneTop:  new THREE.MeshStandardMaterial({ color: 0xe8e5df, roughness: 0.22, metalness: 0.05 }),
    tv:        new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.18, metalness: 0.4 }),
    carBody:   new THREE.MeshPhysicalMaterial({ color: 0xf2f2f0, roughness: 0.18, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.06 }),
    carGlass:  new THREE.MeshPhysicalMaterial({ color: 0x1a2226, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.72 }),
    tyre:      new THREE.MeshStandardMaterial({ color: 0x141415, roughness: 0.95 }),
    soil:      new THREE.MeshStandardMaterial({ color: 0x4a3f33, roughness: 1.0 }),
    bark:      new THREE.MeshStandardMaterial({ color: 0x6d6154, roughness: 0.92 }),
    leaf:      new THREE.MeshStandardMaterial({ color: 0x7fa254, roughness: 0.85, side: THREE.DoubleSide }),
    // 間接照明の光る面
    lightWarm: new THREE.MeshStandardMaterial({
      color: 0xffe9c8, emissive: 0xffd6a0, emissiveIntensity: 2.4, roughness: 1,
    }),
    lightCool: new THREE.MeshStandardMaterial({
      color: 0xf4f8ff, emissive: 0xdfe9ff, emissiveIntensity: 1.6, roughness: 1,
    }),
  };
  return shared;
}

// ---------------------------------------------------------------------------
//  UVを実寸（1UV = 1m）に直すヘルパー
// ---------------------------------------------------------------------------

/**
 * BoxGeometry のUVを実寸に合わせて引き伸ばす。
 * これで、大きさの違う壁や床を1つのマテリアルで、同じ目地ピッチのまま貼れる。
 */
export function scaleBoxUVs(geometry, w, h, d) {
  const uv = geometry.attributes.uv;
  // BoxGeometry の面の順番: +x, -x, +y, -y, +z, -z（各4頂点）
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = spans[face];
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

/** 実寸UV付きの箱を作る */
export function box(w, h, d, material) {
  const g = new THREE.BoxGeometry(w, h, d);
  scaleBoxUVs(g, w, h, d);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
