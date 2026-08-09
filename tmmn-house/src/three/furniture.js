// ============================================================================
//  家具・什器 — 室ごとに、その部屋を「その部屋らしく」見せるものを置く
// ============================================================================
//
//  data/house.js の各室の `furnish` キーで、下の BUILDERS のどれを使うかが決まります。
//  角の立った素の箱にならないよう、基本は RoundedBoxGeometry（面取り付き）で作り、
//  面取りのハイライトで陰影が出るようにしています。
// ============================================================================

import * as THREE from 'three';
import { RoundedBoxGeometry } from '../../vendor/addons/RoundedBoxGeometry.js';
import { sharedMaterials } from './materials.js';
import { buildTree } from './tree.js';

/** 面取りした箱 */
function rbox(w, h, d, mat, radius = 0.02) {
  const r = Math.min(radius, w / 2.2, h / 2.2, d / 2.2);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function put(group, mesh, x, y, z, ry = 0) {
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  group.add(mesh);
  return mesh;
}

function bounds(polygon) {
  const xs = polygon.map((p) => p[0]);
  const zs = polygon.map((p) => p[1]);
  return {
    x0: Math.min(...xs), x1: Math.max(...xs),
    z0: Math.min(...zs), z1: Math.max(...zs),
    get cx() { return (this.x0 + this.x1) / 2; },
    get cz() { return (this.z0 + this.z1) / 2; },
  };
}

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * 色違いのマテリアルは、色ごとに1つだけ作って使い回す。
 * （本1冊ごとにマテリアルを作ると、描画コールが数百に膨らんで一気に重くなる）
 */
const palettes = new Map();
function paletteMaterial(colors, roughness = 0.9) {
  const key = colors.join('|') + roughness;
  if (!palettes.has(key)) {
    palettes.set(key, colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness })));
  }
  const list = palettes.get(key);
  return list[(Math.random() * list.length) | 0];
}

const BOOK_COLORS = ['#8a4a3a', '#3d4f63', '#6b6a52', '#2f3a34', '#9a7b4f', '#7b5169', '#404449', '#a8875c'];
const CLOTH_COLORS = ['#3c4450', '#6b6156', '#8d8579', '#2f3338', '#a89c8a', '#4a5750'];

/**
 * 本を棚に並べる。色が散るので、それだけで空間が締まる。
 * @param axi  's' 'x' … 本が x 方向に並ぶ（棚は z=fixed の壁付け）
 *             'z' … 本が z 方向に並ぶ（棚は x=fixed の壁付け）
 */
function books(group, { axis, from, to, fixed, y, depth = 0.22 }) {
  let t = from + 0.02;
  while (t < to - 0.05) {
    const w = rand(0.018, 0.045);
    const h = rand(0.17, 0.28);
    if (t + w > to - 0.02) break;
    const mat = paletteMaterial(BOOK_COLORS, 0.85);
    const d = depth * rand(0.8, 1);
    const b = axis === 'x' ? rbox(w, h, d, mat, 0.004) : rbox(d, h, w, mat, 0.004);
    const m = axis === 'x'
      ? put(group, b, t + w / 2, y + h / 2, fixed)
      : put(group, b, fixed, y + h / 2, t + w / 2);
    if (Math.random() < 0.08) m.rotation[axis === 'x' ? 'z' : 'x'] = rand(-0.18, 0.18);
    t += w + rand(0.001, 0.006);
    if (Math.random() < 0.06) t += rand(0.03, 0.09); // ときどき隙間
  }
}

/** 観葉植物 */
function plant(group, x, y, z, scale = 1) {
  const S = sharedMaterials();
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.10, 0.26, 20), S.soil);
  pot.castShadow = true;
  g.add(pot);
  pot.position.y = 0.13;
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(rand(0.09, 0.15), 8, 6), S.leaf);
    leaf.scale.set(1, rand(0.35, 0.6), rand(0.5, 0.8));
    leaf.position.set(rand(-0.16, 0.16), rand(0.34, 0.72), rand(-0.16, 0.16));
    leaf.rotation.set(rand(-0.6, 0.6), rand(0, 6.3), rand(-0.6, 0.6));
    leaf.castShadow = true;
    g.add(leaf);
  }
  g.scale.setScalar(scale);
  g.position.set(x, y, z);
  group.add(g);
  return g;
}

// ---------------------------------------------------------------------------
//  室ごとのビルダー
//    (b: 室の外接ボックス, y: 床の高さ, S: 共通マテリアル) => THREE.Group
// ---------------------------------------------------------------------------

const BUILDERS = {

  // ── 主寝室 ───────────────────────────────────────────
  bedroom(b, y, S) {
    const g = new THREE.Group();
    // ベッド（1.6 × 2.0）。南寄せ
    const bedX = b.cx + 0.15;
    const bedZ = b.z1 - 1.25;
    put(g, rbox(1.62, 0.28, 2.02, S.walnut, 0.02), bedX, y + 0.14, bedZ);          // ベッドベース
    put(g, rbox(1.52, 0.20, 1.94, S.fabricPale, 0.05), bedX, y + 0.38, bedZ);      // マットレス
    put(g, rbox(1.50, 0.06, 1.20, S.white, 0.03), bedX, y + 0.50, bedZ + 0.32);    // 掛け布団
    for (const dx of [-0.34, 0.34]) {
      put(g, rbox(0.52, 0.12, 0.32, S.white, 0.05), bedX + dx, y + 0.54, bedZ - 0.78);
    }
    // ヘッドボード側のR壁（曲面）＋その裏の間接照明
    const rWall = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 2.2, 24, 1, true, Math.PI * 0.5, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0xd9d2c6, roughness: 0.9, side: THREE.DoubleSide }),
    );
    put(g, rWall, bedX, y + 1.1, b.z0 + 0.62);
    const glow = put(g, rbox(1.3, 0.03, 0.05, S.lightWarm, 0.01), bedX, y + 2.16, b.z0 + 0.62);
    glow.castShadow = false;
    // 造作デスク（北の地窓の前）
    put(g, rbox(1.5, 0.04, 0.45, S.oak, 0.01), b.x0 + 0.95, y + 0.72, b.z0 + 0.26);
    put(g, rbox(0.42, 0.44, 0.42, S.oak, 0.02), b.x0 + 0.55, y + 0.22, b.z0 + 0.28);
    // 椅子
    put(g, rbox(0.44, 0.05, 0.42, S.oak, 0.02), b.x0 + 1.5, y + 0.44, b.z0 + 0.72);
    put(g, rbox(0.42, 0.5, 0.05, S.oak, 0.02), b.x0 + 1.5, y + 0.7, b.z0 + 0.92);
    for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
      put(g, rbox(0.03, 0.44, 0.03, S.oak, 0.005), b.x0 + 1.5 + dx, y + 0.22, b.z0 + 0.72 + dz);
    }
    return g;
  },

  // ── 2F 洋室 ─────────────────────────────────────────
  bedroom2(b, y, S) {
    const g = new THREE.Group();
    const bedX = b.x0 + 1.0;
    const bedZ = b.cz;
    put(g, rbox(1.0, 0.26, 2.0, S.oak, 0.02), bedX, y + 0.13, bedZ);
    put(g, rbox(0.98, 0.18, 1.94, S.fabricPale, 0.05), bedX, y + 0.35, bedZ);
    put(g, rbox(0.94, 0.05, 1.1, S.white, 0.03), bedX, y + 0.46, bedZ + 0.38);
    put(g, rbox(0.5, 0.11, 0.3, S.white, 0.05), bedX, y + 0.5, bedZ - 0.78);
    // デスク＋棚
    put(g, rbox(1.1, 0.04, 0.5, S.oak, 0.01), b.x1 - 0.75, y + 0.72, b.z0 + 0.32);
    for (const dx of [-0.5, 0.5]) put(g, rbox(0.04, 0.7, 0.46, S.oak, 0.01), b.x1 - 0.75 + dx, y + 0.36, b.z0 + 0.32);
    const shelf = put(g, rbox(1.1, 0.035, 0.24, S.oak, 0.01), b.x1 - 0.75, y + 1.32, b.z0 + 0.18);
    books(g, { axis: 'x', from: b.x1 - 1.26, to: b.x1 - 0.3, fixed: b.z0 + 0.18, y: y + 1.34, depth: 0.2 });
    plant(g, b.x1 - 0.35, y, b.z1 - 0.4, 0.9);
    return g;
  },

  // ── WIC / ファミリークローゼット ────────────────────
  wic(b, y, S) { return closetLike(b, y, S, 1); },
  closet(b, y, S) { return closetLike(b, y, S, 2); },

  // ── 収納室・パントリー ──────────────────────────────
  storage(b, y, S) { return shelvesLike(b, y, S); },
  pantry(b, y, S) { return shelvesLike(b, y, S, true); },

  // ── トイレ ──────────────────────────────────────────
  wc(b, y, S) {
    const g = new THREE.Group();
    const wide = (b.x1 - b.x0) >= (b.z1 - b.z0);
    // 一枚板のカウンター＋ガラスボウル
    const cw = wide ? (b.x1 - b.x0) - 0.3 : 0.42;
    const cd = wide ? 0.42 : (b.z1 - b.z0) - 0.3;
    const cx = wide ? b.cx : b.x0 + 0.28;
    const cz = wide ? b.z0 + 0.28 : b.cz;
    put(g, rbox(cw, 0.055, cd, S.walnut, 0.012), cx, y + 0.80, cz);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.11, 24), S.glass);
    put(g, bowl, cx - (wide ? cw * 0.24 : 0), y + 0.885, cz + (wide ? 0 : cd * 0.24));
    // 水栓
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 10), S.chrome);
    put(g, tap, cx - (wide ? cw * 0.24 : 0), y + 0.95, cz - (wide ? 0.16 : 0));
    // 便器（壁掛け）
    const bx = wide ? b.x1 - 0.42 : b.cx;
    const bz = wide ? b.cz + 0.25 : b.z1 - 0.42;
    put(g, rbox(0.37, 0.32, 0.55, S.porcelain, 0.09), bx, y + 0.42, bz);
    put(g, rbox(0.36, 0.06, 0.44, S.white, 0.03), bx, y + 0.60, bz + 0.03);
    // バックライトのミラー
    const mir = put(g, rbox(0.44, 0.6, 0.02, S.chrome, 0.01), cx, y + 1.45, cz - (wide ? 0.19 : 0));
    if (!wide) { mir.rotation.y = Math.PI / 2; mir.position.set(b.x0 + 0.09, y + 1.45, cz); }
    const halo = put(g, rbox(0.5, 0.66, 0.012, S.lightWarm, 0.01), mir.position.x, y + 1.45, mir.position.z + (wide ? 0.012 : 0));
    halo.rotation.copy(mir.rotation);
    halo.castShadow = false;
    return g;
  },

  // ── ガレージ ────────────────────────────────────────
  garage(b, y, S) {
    const g = new THREE.Group();
    g.add(buildCar(b.cx - 0.05, y, b.cz + 0.2, S));
    // 壁面の工具ラック
    put(g, rbox(0.06, 1.2, 2.0, S.steel, 0.01), b.x0 + 0.09, y + 1.5, b.z0 + 1.6);
    // 天井のライン照明
    for (const dz of [-1.4, 0, 1.4]) {
      const l = put(g, rbox(0.05, 0.03, 2.2, S.lightCool, 0.01), b.cx, y + 2.42, b.cz + dz);
      l.castShadow = false;
    }
    return g;
  },

  // ── 書斎 ────────────────────────────────────────────
  study(b, y, S) {
    const g = new THREE.Group();
    // 壁一面の造作本棚（東側）。背板＋棚板の抜けた箱にして、中の本が見えるようにする
    const shelfX = b.x1 - 0.18;          // 棚の中心
    const shelfSpan = b.z1 - b.z0 - 0.3;
    put(g, rbox(0.03, 2.1, shelfSpan, S.walnut, 0.004), b.x1 - 0.02, y + 1.05, b.cz);   // 背板
    for (const dz of [-shelfSpan / 2, shelfSpan / 2]) {                                  // 側板
      put(g, rbox(0.34, 2.1, 0.03, S.walnut, 0.004), shelfX, y + 1.05, b.cz + dz);
    }
    for (let i = 0; i < 5; i++) {
      const sy = y + 0.42 + i * 0.38;
      put(g, rbox(0.34, 0.028, shelfSpan, S.walnut, 0.004), shelfX, sy, b.cz);
      books(g, { axis: 'z', from: b.z0 + 0.18, to: b.z1 - 0.18, fixed: shelfX, y: sy + 0.014, depth: 0.26 });
    }
    // L字デスク
    put(g, rbox(1.7, 0.05, 0.62, S.walnut, 0.012), b.x0 + 1.5, y + 0.72, b.z1 - 0.45);
    put(g, rbox(0.62, 0.05, 0.9, S.walnut, 0.012), b.x0 + 0.95, y + 0.72, b.z1 - 1.1);
    put(g, rbox(0.5, 0.66, 0.5, S.walnut, 0.02), b.x0 + 2.0, y + 0.34, b.z1 - 0.45);
    // ワークチェア
    put(g, rbox(0.48, 0.08, 0.46, S.leather, 0.04), b.x0 + 1.4, y + 0.46, b.z1 - 0.95);
    put(g, rbox(0.44, 0.52, 0.07, S.leather, 0.04), b.x0 + 1.4, y + 0.76, b.z1 - 1.2);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 10), S.steelPale);
    put(g, stem, b.x0 + 1.4, y + 0.23, b.z1 - 0.95);
    // 北の窓辺の小上がり（座面高400）
    put(g, rbox(2.5, 0.4, 0.6, S.walnut, 0.015), b.x0 + 1.6, y + 0.2, b.z0 + 0.3);
    put(g, rbox(0.5, 0.14, 0.5, S.fabricPale, 0.06), b.x0 + 0.9, y + 0.47, b.z0 + 0.32);
    put(g, rbox(0.5, 0.14, 0.5, S.fabricDark, 0.06), b.x0 + 1.55, y + 0.47, b.z0 + 0.32);
    // デスクライト
    const arm = put(g, rbox(0.02, 0.44, 0.02, S.steel, 0.005), b.x0 + 2.15, y + 0.97, b.z1 - 0.6);
    arm.rotation.z = 0.3;
    plant(g, b.x1 - 0.55, y, b.z0 + 0.35, 0.85);
    return g;
  },

  // ── ヌック／猫スペース ──────────────────────────────
  nook(b, y, S) {
    const g = new THREE.Group();
    // 造作ベンチ（座面高400）
    put(g, rbox(b.x1 - b.x0 - 0.3, 0.4, 0.62, S.oak, 0.015), b.cx, y + 0.2, b.z0 + 0.36);
    // クッション
    for (let i = 0; i < 3; i++) {
      put(g, rbox(0.42, 0.12, 0.42, i % 2 ? S.fabricDark : S.fabricPale, 0.06),
        b.x0 + 0.75 + i * 1.0, y + 0.46, b.z0 + 0.35);
    }
    // 猫（丸まっている）
    const cat = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), S.fabricDark);
    body.scale.set(1.25, 0.8, 1);
    body.castShadow = true;
    cat.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 12), S.fabricDark);
    head.position.set(0.13, 0.05, 0.02);
    head.castShadow = true;
    cat.add(head);
    for (const dz of [-0.045, 0.045]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.055, 4), S.fabricDark);
      ear.position.set(0.14, 0.12, dz);
      cat.add(ear);
    }
    cat.position.set(b.x0 + 1.9, y + 0.52, b.z0 + 0.35);
    cat.rotation.y = -0.5;
    g.add(cat);
    plant(g, b.x1 - 0.4, y, b.z0 + 0.3, 0.8);
    return g;
  },

  // ── 洗面脱衣＋ランドリー ────────────────────────────
  washroom(b, y, S) {
    const g = new THREE.Group();
    const cx = b.x0 + 0.32;
    // カウンター一体（洗濯機を下に納める）
    put(g, rbox(0.58, 0.05, b.z1 - b.z0 - 0.3, S.stoneTop, 0.01), cx, y + 0.85, b.cz);
    put(g, rbox(0.56, 0.8, b.z1 - b.z0 - 0.3, S.white, 0.01), cx, y + 0.42, b.cz);
    // 洗面ボウル
    const basin = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.13, 0.36), S.porcelain);
    put(g, basin, cx, y + 0.93, b.z0 + 0.6);
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.22, 10), S.chrome);
    put(g, tap, cx - 0.2, y + 1.0, b.z0 + 0.6);
    // 洗濯機（ドラム式）
    put(g, rbox(0.5, 0.62, 0.55, S.white, 0.03), cx, y + 0.31, b.z1 - 0.55);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 24), S.chrome);
    drum.rotation.z = Math.PI / 2;
    put(g, drum, cx - 0.27, y + 0.33, b.z1 - 0.55);
    // 三面鏡
    put(g, rbox(0.14, 0.8, 1.1, S.white, 0.01), b.x0 + 0.1, y + 1.55, b.z0 + 0.75);
    const mir = put(g, rbox(0.012, 0.74, 1.04, S.chrome, 0.005), b.x0 + 0.18, y + 1.55, b.z0 + 0.75);
    mir.castShadow = false;
    // 物干しバー
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.4, 10), S.steelPale);
    bar.rotation.x = Math.PI / 2;
    put(g, bar, b.x1 - 0.6, y + 2.05, b.cz);
    return g;
  },

  // ── 浴室 ────────────────────────────────────────────
  bath(b, y, S) {
    const g = new THREE.Group();
    put(g, rbox(1.6, 0.58, 0.78, S.porcelain, 0.06), b.cx - 0.1, y + 0.29, b.z0 + 0.5);
    // 湯（水面）
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(1.44, 0.02, 0.62),
      new THREE.MeshPhysicalMaterial({ color: 0xbfe0e6, roughness: 0.06, transmission: 0.85, transparent: true, opacity: 0.6, thickness: 0.3 }),
    );
    put(g, water, b.cx - 0.1, y + 0.5, b.z0 + 0.5);
    // 洗い場のカラン＋シャワー
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.1, 10), S.chrome);
    put(g, pole, b.x1 - 0.16, y + 1.15, b.z1 - 0.5);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), S.chrome);
    put(g, head, b.x1 - 0.24, y + 1.62, b.z1 - 0.5);
    // 風呂椅子
    put(g, rbox(0.34, 0.05, 0.26, S.white, 0.02), b.x0 + 0.5, y + 0.29, b.z1 - 0.45);
    for (const [dx, dz] of [[-0.13, -0.09], [0.13, -0.09], [-0.13, 0.09], [0.13, 0.09]]) {
      put(g, rbox(0.03, 0.26, 0.03, S.white, 0.005), b.x0 + 0.5 + dx, y + 0.13, b.z1 - 0.45 + dz);
    }
    return g;
  },

  // ── 玄関土間 ────────────────────────────────────────
  doma(b, y, S) {
    const g = new THREE.Group();
    // 上がり框（土間 → 廊下の段差の見切り）
    put(g, rbox(1.0, 0.16, 0.16, S.walnut, 0.01), 3.9, y + 0.08, 7.55);
    // ベンチ
    put(g, rbox(1.1, 0.08, 0.36, S.walnut, 0.015), 5.2, y + 0.42, 9.78);
    for (const dx of [-0.48, 0.48]) put(g, rbox(0.06, 0.42, 0.32, S.steel, 0.01), 5.2 + dx, y + 0.21, 9.78);
    // 自転車（写真の土間の雰囲気）
    g.add(buildBicycle(4.9, y, 8.3, S));
    // 縦格子（玄関とジムの間の見切り）
    for (let i = 0; i < 7; i++) {
      put(g, rbox(0.045, 2.2, 0.045, S.walnut, 0.008), 6.52, y + 1.1, 8.15 + i * 0.12);
    }
    // 大きな花器と枝もの
    const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.06, 0.42, 18), S.glass);
    put(g, vase, 4.65, y + 0.21, 9.3);
    for (let i = 0; i < 5; i++) {
      const br = put(g, rbox(0.012, rand(0.5, 0.9), 0.012, S.bark, 0.004), 4.65 + rand(-0.05, 0.05), y + 0.7, 9.3 + rand(-0.05, 0.05));
      br.rotation.z = rand(-0.35, 0.35);
      br.rotation.x = rand(-0.35, 0.35);
    }
    plant(g, 3.9, y, 1.1, 1.05);
    plant(g, 3.9, y, 5.9, 0.9);
    return g;
  },

  // ── ジム ────────────────────────────────────────────
  gym(b, y, S) {
    const g = new THREE.Group();
    // トレッドミル
    const t = new THREE.Group();
    const deck = rbox(0.85, 0.16, 1.5, S.steel, 0.03);
    deck.position.set(0, 0.08, 0);
    t.add(deck);
    const belt = rbox(0.62, 0.04, 1.3, new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.95 }), 0.01);
    belt.position.set(0, 0.18, 0.05);
    t.add(belt);
    for (const dx of [-0.36, 0.36]) {
      const arm = rbox(0.05, 1.1, 0.05, S.steel, 0.012);
      arm.position.set(dx, 0.62, -0.6);
      arm.rotation.x = -0.18;
      t.add(arm);
    }
    const panel = rbox(0.72, 0.34, 0.06, S.tv, 0.02);
    panel.position.set(0, 1.2, -0.68);
    panel.rotation.x = 0.3;
    t.add(panel);
    t.position.set(b.x0 + 0.85, y, b.cz + 0.25);
    t.rotation.y = Math.PI;
    g.add(t);
    // ダンベルラック
    put(g, rbox(0.9, 0.08, 0.34, S.steel, 0.012), b.x1 - 0.65, y + 0.55, b.z0 + 0.3);
    put(g, rbox(0.9, 0.08, 0.34, S.steel, 0.012), b.x1 - 0.65, y + 0.22, b.z0 + 0.3);
    for (let i = 0; i < 4; i++) {
      const w = 0.055 + i * 0.012;
      for (const dy of [0.66, 0.33]) {
        const d1 = new THREE.Mesh(new THREE.CylinderGeometry(w, w, 0.06, 14), S.tyre);
        d1.rotation.z = Math.PI / 2;
        put(g, d1, b.x1 - 1.0 + i * 0.23, y + dy, b.z0 + 0.3);
      }
    }
    // ヨガマット
    const mat = rbox(0.62, 0.02, 1.7, new THREE.MeshStandardMaterial({ color: 0x5b6b63, roughness: 0.98 }), 0.01);
    put(g, mat, b.x0 + 0.5, y + 0.01, b.z1 - 1.0);
    // 天井のライン照明
    for (const dz of [-0.6, 0.6]) {
      const l = put(g, rbox(2.6, 0.025, 0.05, S.lightCool, 0.01), b.cx, y + 2.4, b.cz + dz);
      l.castShadow = false;
    }
    return g;
  },

  // ── キッチン ────────────────────────────────────────
  kitchen(b, y, S) {
    const g = new THREE.Group();
    // 背面の壁付け収納
    put(g, rbox(0.62, 2.1, b.z1 - b.z0 - 0.4, S.white, 0.015), b.x1 - 0.35, y + 1.05, b.cz);
    // アイランド
    const ix = b.x0 + 1.0;
    put(g, rbox(0.9, 0.88, 2.2, S.white, 0.015), ix, y + 0.44, b.cz);
    put(g, rbox(0.98, 0.055, 2.28, S.stoneTop, 0.012), ix, y + 0.91, b.cz);
    // シンク
    const sink = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.42), S.steelPale);
    put(g, sink, ix, y + 0.86, b.cz - 0.55);
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 10), S.chrome);
    put(g, tap, ix - 0.3, y + 1.06, b.cz - 0.55);
    // コンロ
    put(g, rbox(0.56, 0.012, 0.44, S.tv, 0.006), ix, y + 0.945, b.cz + 0.5);
    // ペンダント2灯
    for (const dz of [-0.5, 0.5]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.9, 6), S.steel);
      put(g, cord, ix, y + 2.15, b.cz + dz);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.18, 20, 1, true), S.steelPale);
      put(g, shade, ix, y + 1.66, b.cz + dz);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), S.lightWarm);
      put(g, bulb, ix, y + 1.6, b.cz + dz);
      bulb.castShadow = false;
    }
    return g;
  },

  // ── ダイニング ──────────────────────────────────────
  dining(b, y, S) {
    const g = new THREE.Group();
    const tx = b.cx;
    const tz = b.cz;
    put(g, rbox(1.05, 0.055, 1.95, S.oak, 0.012), tx, y + 0.72, tz);
    for (const [dx, dz] of [[-0.42, -0.82], [0.42, -0.82], [-0.42, 0.82], [0.42, 0.82]]) {
      put(g, rbox(0.055, 0.7, 0.055, S.oak, 0.008), tx + dx, y + 0.35, tz + dz);
    }
    // 椅子（左右3脚ずつ）
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const cxp = tx + side * 0.78;
        const czp = tz - 0.62 + i * 0.62;
        put(g, rbox(0.44, 0.05, 0.42, S.walnut, 0.02), cxp, y + 0.44, czp);
        const back = put(g, rbox(0.05, 0.46, 0.4, S.walnut, 0.02), cxp + side * 0.19, y + 0.68, czp);
        back.rotation.z = -side * 0.08;
        for (const [ddx, ddz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) {
          put(g, rbox(0.03, 0.42, 0.03, S.walnut, 0.005), cxp + ddx, y + 0.22, czp + ddz);
        }
      }
    }
    // ペンダント
    for (const dz of [-0.5, 0.5]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.0, 6), S.steel);
      put(g, cord, tx, y + 2.2, tz + dz);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.16, 22, 1, true), S.white);
      put(g, shade, tx, y + 1.7, tz + dz);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), S.lightWarm);
      put(g, bulb, tx, y + 1.66, tz + dz);
      bulb.castShadow = false;
    }
    // テーブルの上の小物
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), S.stoneTop);
    bowl.rotation.x = Math.PI;
    put(g, bowl, tx, y + 0.79, tz);
    return g;
  },

  // ── リビング（AVコーナー） ──────────────────────────
  living(b, y, S) {
    const g = new THREE.Group();
    // ラグ
    put(g, rbox(2.3, 0.014, 2.5, S.rug, 0.004), b.cx + 0.2, y + 0.007, b.cz + 0.1);
    // ソファ（L字）
    const sx = b.x1 - 0.95;
    put(g, rbox(1.0, 0.34, 2.3, S.fabricPale, 0.05), sx, y + 0.17, b.cz);
    put(g, rbox(0.9, 0.2, 2.2, S.fabricPale, 0.07), sx, y + 0.44, b.cz);
    put(g, rbox(0.26, 0.5, 2.3, S.fabricPale, 0.07), sx + 0.4, y + 0.58, b.cz);
    for (const dz of [-0.7, 0.7]) put(g, rbox(0.5, 0.12, 0.5, S.fabricDark, 0.06), sx - 0.1, y + 0.58, b.cz + dz);
    // ローテーブル
    put(g, rbox(0.62, 0.04, 1.1, S.oak, 0.01), b.cx - 0.05, y + 0.36, b.cz);
    for (const [dx, dz] of [[-0.24, -0.44], [0.24, -0.44], [-0.24, 0.44], [0.24, 0.44]]) {
      put(g, rbox(0.03, 0.34, 0.03, S.steel, 0.006), b.cx - 0.05 + dx, y + 0.17, b.cz + dz);
    }
    // AVコーナー：ローボード＋壁掛けTV＋トールスピーカー
    const wx = b.x0 + 0.28;
    put(g, rbox(0.42, 0.05, 2.1, S.oak, 0.012), wx, y + 0.36, b.cz);
    put(g, rbox(0.4, 0.05, 2.0, S.oak, 0.012), wx, y + 0.14, b.cz);
    for (const dz of [-0.9, 0.9]) put(g, rbox(0.05, 0.36, 0.05, S.steel, 0.008), wx, y + 0.18, b.cz + dz);
    const tv = put(g, rbox(0.05, 0.72, 1.28, S.tv, 0.01), b.x0 + 0.14, y + 1.28, b.cz);
    tv.castShadow = false;
    for (const dz of [-1.05, 1.05]) {
      put(g, rbox(0.2, 1.02, 0.24, S.tv, 0.015), wx - 0.03, y + 0.51, b.cz + dz);
    }
    // AV機器
    for (let i = 0; i < 3; i++) {
      put(g, rbox(0.3, 0.06, 0.42, S.frameDark, 0.008), wx, y + 0.2, b.cz - 0.6 + i * 0.6);
    }
    plant(g, b.x1 - 0.42, y, b.z1 - 0.5, 1.1);
    return g;
  },

  // ── 書庫／ワークスペース ────────────────────────────
  library(b, y, S) {
    const g = new THREE.Group();
    const shelfX = b.x1 - 0.17;
    const span = b.z1 - b.z0 - 0.3;
    put(g, rbox(0.03, 2.2, span, S.white, 0.004), b.x1 - 0.02, y + 1.1, b.cz);      // 背板
    for (const dz of [-span / 2, span / 2]) {
      put(g, rbox(0.32, 2.2, 0.03, S.oak, 0.004), shelfX, y + 1.1, b.cz + dz);      // 側板
    }
    for (let i = 0; i < 6; i++) {
      const sy = y + 0.3 + i * 0.36;
      put(g, rbox(0.32, 0.026, span, S.oak, 0.004), shelfX, sy, b.cz);
      books(g, { axis: 'z', from: b.z0 + 0.18, to: b.z1 - 0.18, fixed: shelfX, y: sy + 0.013, depth: 0.24 });
    }
    // 吹抜に face するデスク
    put(g, rbox(0.56, 0.045, 1.6, S.oak, 0.01), b.x0 + 0.35, y + 0.72, b.cz - 0.4);
    for (const dz of [-0.7, 0.7]) put(g, rbox(0.05, 0.68, 0.05, S.steel, 0.008), b.x0 + 0.35, y + 0.36, b.cz - 0.4 + dz);
    put(g, rbox(0.44, 0.05, 0.42, S.leather, 0.04), b.x0 + 0.75, y + 0.45, b.cz - 0.4);
    put(g, rbox(0.06, 0.46, 0.4, S.leather, 0.03), b.x0 + 0.96, y + 0.7, b.cz - 0.4);
    plant(g, b.x0 + 0.4, y, b.z1 - 0.45, 0.95);
    return g;
  },

  // ── 中庭 ────────────────────────────────────────────
  courtyard(b, y, S) {
    const g = new THREE.Group();
    g.add(buildTree(b.cx + 0.15, y, b.cz - 0.1));
    // 飛び石
    for (let i = 0; i < 4; i++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.06, 12), S.stoneTop);
      st.receiveShadow = true;
      put(g, st, b.x0 + 0.7 + i * 0.55, y + 0.03, b.z1 - 0.55 - i * 0.22);
    }
    // 株元のアッパーライト
    for (const [dx, dz] of [[-0.6, 0.3], [0.55, 0.35], [0.05, -0.6]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 12), S.steel);
      put(g, l, b.cx + 0.15 + dx, y + 0.05, b.cz - 0.1 + dz);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.038, 12), S.lightWarm);
      lens.rotation.x = -Math.PI / 2;
      put(g, lens, b.cx + 0.15 + dx, y + 0.101, b.cz - 0.1 + dz);
      lens.castShadow = false;
    }
    // 下草
    for (let i = 0; i < 14; i++) {
      plant(g, b.x0 + rand(0.35, 3.2), y, b.z0 + rand(0.35, 3.1), rand(0.3, 0.5));
    }
    return g;
  },
};

// ---------------------------------------------------------------------------
//  共通パーツ
// ---------------------------------------------------------------------------

function closetLike(b, y, S, rods) {
  const g = new THREE.Group();
  const long = (b.z1 - b.z0) >= (b.x1 - b.x0);
  const span = (long ? b.z1 - b.z0 : b.x1 - b.x0) - 0.3;
  for (let r = 0; r < rods; r++) {
    const off = rods === 1 ? 0 : (r === 0 ? -1 : 1) * ((long ? b.x1 - b.x0 : b.z1 - b.z0) / 2 - 0.32);
    const bx = long ? b.cx + off : b.cx;
    const bz = long ? b.cz : b.cz + off;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, span, 10), S.steelPale);
    bar.rotation[long ? 'x' : 'z'] = Math.PI / 2;
    put(g, bar, bx, y + 1.75, bz);
    // 服
    const n = Math.floor(span / 0.055);
    for (let i = 0; i < n; i++) {
      const t = 0.15 + (i / n) * (span - 0.3);
      const mat = paletteMaterial(CLOTH_COLORS, 0.95);
      const ch = rand(0.7, 1.05);
      const cloth = rbox(long ? 0.32 : 0.05, ch, long ? 0.05 : 0.32, mat, 0.01);
      put(g, cloth, long ? bx : b.x0 + 0.15 + t, y + 1.72 - ch / 2, long ? b.z0 + 0.15 + t : bz);
    }
    // 棚板
    put(g, rbox(long ? 0.4 : span, 0.03, long ? span : 0.4, S.oak, 0.006), bx, y + 1.95, bz);
  }
  return g;
}

function shelvesLike(b, y, S, food = false) {
  const g = new THREE.Group();
  const long = (b.z1 - b.z0) >= (b.x1 - b.x0);
  const span = (long ? b.z1 - b.z0 : b.x1 - b.x0) - 0.24;
  const depth = 0.36;
  const wallOff = (long ? b.x1 - b.x0 : b.z1 - b.z0) / 2 - depth / 2 - 0.02;
  for (const side of [-1, 1]) {
    const bx = long ? b.cx + side * wallOff : b.cx;
    const bz = long ? b.cz : b.cz + side * wallOff;
    for (let i = 0; i < 5; i++) {
      const sy = y + 0.35 + i * 0.4;
      if (sy > y + 2.1) break;
      put(g, rbox(long ? depth : span, 0.028, long ? span : depth, S.oak, 0.005), bx, sy, bz);
      // 箱もの／食品
      const n = Math.floor(span / 0.3);
      for (let k = 0; k < n; k++) {
        const t = 0.15 + k * 0.3 + rand(0, 0.06);
        const col = food
          ? ['#c9b48a', '#8f9c7a', '#b98f6a'][k % 3]
          : ['#9a9287', '#7d7469', '#b3ab9e'][k % 3];
        const mat = paletteMaterial([col], 0.9);
        const ih = rand(0.14, 0.3);
        const item = rbox(long ? 0.26 : 0.2, ih, long ? 0.2 : 0.26, mat, 0.01);
        put(g, item, long ? bx : b.x0 + 0.12 + t, sy + ih / 2 + 0.015, long ? b.z0 + 0.12 + t : bz);
      }
    }
  }
  return g;
}

/** 車（セダン）。角を落としたボリュームを重ねて形を作る */
function buildCar(x, y, z, S) {
  const g = new THREE.Group();
  const L = 4.75; const W = 1.8;
  // 下まわり
  const lower = new THREE.Mesh(new RoundedBoxGeometry(W, 0.62, L, 6, 0.24), S.carBody);
  lower.position.y = 0.62;
  lower.castShadow = true;
  g.add(lower);
  // ボンネット／トランク
  const hood = new THREE.Mesh(new RoundedBoxGeometry(W - 0.08, 0.26, 1.5, 5, 0.16), S.carBody);
  hood.position.set(0, 0.98, -1.5);
  hood.castShadow = true;
  g.add(hood);
  const trunk = new THREE.Mesh(new RoundedBoxGeometry(W - 0.08, 0.3, 1.2, 5, 0.16), S.carBody);
  trunk.position.set(0, 1.0, 1.65);
  trunk.castShadow = true;
  g.add(trunk);
  // キャビン
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(W - 0.22, 0.62, 2.3, 6, 0.26), S.carGlass);
  cabin.position.set(0, 1.28, 0.15);
  cabin.castShadow = true;
  g.add(cabin);
  const roof = new THREE.Mesh(new RoundedBoxGeometry(W - 0.34, 0.16, 1.7, 5, 0.12), S.carBody);
  roof.position.set(0, 1.56, 0.2);
  g.add(roof);
  // タイヤ
  for (const [dx, dz] of [[-0.86, -1.45], [0.86, -1.45], [-0.86, 1.45], [0.86, 1.45]]) {
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 24), S.tyre);
    tyre.rotation.z = Math.PI / 2;
    tyre.position.set(dx, 0.34, dz);
    tyre.castShadow = true;
    g.add(tyre);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 20), S.steelPale);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(dx, 0.34, dz);
    g.add(rim);
  }
  // ライト
  for (const [dx, dz, mat] of [[-0.62, -2.32, S.lightCool], [0.62, -2.32, S.lightCool],
    [-0.66, 2.28, S.frameDark], [0.66, 2.28, S.frameDark]]) {
    const l = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.14, 0.1, 3, 0.04), mat);
    l.position.set(dx, dz < 0 ? 0.86 : 0.94, dz);
    g.add(l);
  }
  g.position.set(x, y, z);
  return g;
}

/** 自転車（土間に置くミニベロ） */
function buildBicycle(x, y, z, S) {
  const g = new THREE.Group();
  const wheel = (dz) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.022, 8, 28), S.tyre);
    t.position.set(0, 0.26, dz);
    t.castShadow = true;
    g.add(t);
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5, 4), S.steelPale);
      sp.position.set(0, 0.26, dz);
      sp.rotation.x = Math.PI / 2;
      sp.rotation.y = (i / 10) * Math.PI;
      g.add(sp);
    }
  };
  wheel(-0.52); wheel(0.52);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xb8b3a6, roughness: 0.35, metalness: 0.6 });
  for (const [p, r, len] of [[[0, 0.5, 0.0], [0, 0, 0.5], 0.95], [[0, 0.32, -0.25], [0.9, 0, 0], 0.6], [[0, 0.55, 0.3], [0.5, 0, 0], 0.55]]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 8), frameMat);
    bar.position.set(p[0], p[1], p[2]);
    bar.rotation.set(r[0] + Math.PI / 2, r[1], r[2]);
    bar.castShadow = true;
    g.add(bar);
  }
  const saddle = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.05, 0.24, 3, 0.02), S.leather);
  saddle.position.set(0, 0.82, 0.16);
  g.add(saddle);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 8), frameMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 0.86, -0.44);
  g.add(bar);
  g.position.set(x, y, z);
  g.rotation.y = 0.35;
  return g;
}

// ---------------------------------------------------------------------------
//  エントリポイント
// ---------------------------------------------------------------------------

/** その室の家具グループを作る。furnish が無い／未対応なら null */
export function furnishRoom(area, level) {
  const key = area.furnish;
  if (!key || !BUILDERS[key]) return null;
  const S = sharedMaterials();
  const b = bounds(area.polygon);
  const sunken = area.kind === 'outdoor' ? 0.12 : 0;
  const g = BUILDERS[key](b, level - sunken, S);
  g.name = `furniture-${area.id}`;
  return g;
}
