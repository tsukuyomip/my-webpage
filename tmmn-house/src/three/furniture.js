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

/** 2点を結ぶ円柱。フレーム類はこれで組むと破綻しない */
function tube(group, p0, p1, radius, mat, seg = 8) {
  const a = new THREE.Vector3(...p0);
  const b = new THREE.Vector3(...p1);
  const dir = b.clone().sub(a);
  const len = dir.length();
  if (len < 1e-5) return null;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, seg), mat);
  m.castShadow = true;
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  group.add(m);
  return m;
}

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

/** 観葉植物。pot=false なら鉢なし（庭の下草に使う） */
function plant(group, x, y, z, scale = 1, pot = true) {
  const S = sharedMaterials();
  const g = new THREE.Group();
  if (pot) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.10, 0.26, 20), S.soil);
    p.castShadow = true;
    p.position.y = 0.13;
    g.add(p);
  }
  for (let i = 0; i < (pot ? 9 : 6); i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(rand(0.09, 0.15), 8, 6), S.leaf);
    leaf.scale.set(1, rand(0.35, 0.6), rand(0.5, 0.8));
    leaf.position.set(rand(-0.16, 0.16), pot ? rand(0.34, 0.72) : rand(0.05, 0.22), rand(-0.16, 0.16));
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
  //  扉は東（土間廊下・南寄り）と西（WIC・北寄り）の2か所。
  //  ベッドは北の壁に頭を付けて east 寄せにし、どちらの扉の前も空ける。
  bedroom(b, y, S) {
    const g = new THREE.Group();
    const bedW = 1.4;
    const bedL = 1.95;
    const bedX = b.x1 - 0.28 - bedW / 2;   // 東の壁から少し離す
    const bedZ = b.z0 + 0.08 + bedL / 2;   // 頭は北の壁
    put(g, rbox(bedW, 0.28, bedL, S.walnut, 0.02), bedX, y + 0.14, bedZ);
    put(g, rbox(bedW - 0.1, 0.20, bedL - 0.08, S.fabricPale, 0.05), bedX, y + 0.38, bedZ);
    put(g, rbox(bedW - 0.12, 0.06, 1.1, S.white, 0.03), bedX, y + 0.50, bedZ + 0.32);
    put(g, rbox(bedW - 0.3, 0.12, 0.32, S.white, 0.05), bedX, y + 0.54, bedZ - bedL / 2 + 0.28);
    // ヘッドボード側のR壁と、その裏の間接照明
    const rWall = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 2.2, 24, 1, true, Math.PI * 0.5, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0xd9d2c6, roughness: 0.9, side: THREE.DoubleSide }),
    );
    put(g, rWall, bedX, y + 1.1, b.z0 + 0.38);
    const glow = put(g, rbox(bedW - 0.2, 0.03, 0.05, S.lightWarm, 0.01), bedX, y + 2.16, b.z0 + 0.38);
    glow.castShadow = false;
    // ナイトテーブル（西側の余白に）
    put(g, rbox(0.4, 0.42, 0.36, S.oak, 0.02), b.x0 + 0.32, y + 0.21, b.z0 + 0.35);
    // 造作デスク（南の壁ぎわ。東の扉の前は空ける）
    put(g, rbox(1.25, 0.04, 0.42, S.oak, 0.01), b.x0 + 0.75, y + 0.72, b.z1 - 0.24);
    for (const dx of [-0.55, 0.55]) {
      put(g, rbox(0.04, 0.7, 0.4, S.oak, 0.01), b.x0 + 0.75 + dx, y + 0.36, b.z1 - 0.24);
    }
    put(g, rbox(0.42, 0.05, 0.4, S.oak, 0.02), b.x0 + 0.75, y + 0.44, b.z1 - 0.7);
    put(g, rbox(0.4, 0.46, 0.05, S.oak, 0.02), b.x0 + 0.75, y + 0.69, b.z1 - 0.9);
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
  wic(b, y, S, doors) { return closetLike(b, y, S, 1, doors); },
  closet(b, y, S, doors) { return closetLike(b, y, S, 2, doors); },

  // ── 収納室・パントリー ──────────────────────────────
  storage(b, y, S, doors) { return shelvesLike(b, y, S, false, doors); },
  pantry(b, y, S, doors) { return shelvesLike(b, y, S, true, doors); },

  // ── トイレ ──────────────────────────────────────────
  //  扉の位置を見て、器具を扉から遠い側に寄せる（扉の前を必ず空ける）
  wc(b, y, S, doors = []) {
    const g = new THREE.Group();
    const wide = (b.x1 - b.x0) >= (b.z1 - b.z0);
    const door = doors[0];
    // 長手方向の「奥」がどちらか
    let farAtMax = true;
    if (door) {
      const dm = wide ? (door.from[0] + door.to[0]) / 2 : (door.from[1] + door.to[1]) / 2;
      farAtMax = dm <= (wide ? (b.x0 + b.x1) / 2 : (b.z0 + b.z1) / 2);
    }
    const lo = wide ? b.x0 : b.z0;
    const hi = wide ? b.x1 : b.z1;
    const far = farAtMax ? hi : lo;      // 器具を寄せる側
    const sign = farAtMax ? -1 : 1;      // far から室内へ向かう向き

    // 一枚板のカウンター＋ガラスボウル（奥の壁ぎわ）
    const counterAt = far + sign * 0.26;
    const cx = wide ? counterAt : b.x0 + 0.26;
    const cz = wide ? b.z0 + 0.24 : counterAt;
    const cw = wide ? 0.46 : (b.x1 - b.x0) - 0.3;
    const cd = wide ? (b.z1 - b.z0) - 0.3 : 0.46;
    put(g, rbox(cw, 0.055, cd, S.walnut, 0.012), cx, y + 0.80, cz);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.115, 0.11, 24), S.glass);
    put(g, bowl, cx, y + 0.885, cz);
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 10), S.chrome);
    put(g, tap, cx + (wide ? -0.16 : 0), y + 0.95, cz + (wide ? 0 : -0.16));

    // 便器（カウンターの隣、まだ扉から遠い側）
    const wcAt = far + sign * 0.85;
    const bx = wide ? wcAt : b.cx;
    const bz = wide ? b.cz + 0.18 : wcAt;
    put(g, rbox(0.37, 0.32, 0.55, S.porcelain, 0.09), bx, y + 0.42, bz);
    put(g, rbox(0.36, 0.06, 0.44, S.white, 0.03), bx, y + 0.60, bz + 0.03);

    // バックライトのミラー（カウンターの上）
    const mir = rbox(wide ? 0.42 : 0.02, 0.58, wide ? 0.02 : 0.42, S.chrome, 0.01);
    put(g, mir, wide ? cx : b.x0 + 0.06, y + 1.45, wide ? b.z0 + 0.06 : cz);
    const halo = rbox(wide ? 0.48 : 0.012, 0.64, wide ? 0.012 : 0.48, S.lightWarm, 0.01);
    put(g, halo, wide ? cx : b.x0 + 0.072, y + 1.45, wide ? b.z0 + 0.072 : cz);
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
    const shelfSpan = b.z1 - b.z0 - 0.5;
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
    plant(g, b.x0 + 0.42, y, b.z1 - 0.35, 0.85);
    return g;
  },

  // ── ヌック／猫スペース ──────────────────────────────
  nook(b, y, S) {
    const g = new THREE.Group();
    // 造作ベンチ（座面高400・奥行400）。北の壁に寄せ、
    // 中庭側に 0.6m の通り道を残す（土間廊下 → 洗面 の抜け道を兼ねるため）
    const benchD = 0.52;
    const benchZ = b.z0 + benchD / 2;
    // 西端（土間からのアーチ）と東端（洗面への扉）の前は空け、中央だけベンチにする
    const bx0 = b.x0 + 0.85;
    const bx1 = b.x1 - 0.7;
    put(g, rbox(bx1 - bx0, 0.4, benchD, S.oak, 0.015), (bx0 + bx1) / 2, y + 0.2, benchZ);
    for (let i = 0; i < 3; i++) {
      put(g, rbox(0.34, 0.1, 0.3, i % 2 ? S.fabricDark : S.fabricPale, 0.05),
        bx0 + 0.35 + i * 0.66, y + 0.45, benchZ);
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
    cat.position.set(b.x0 + 1.75, y + 0.5, benchZ);
    cat.rotation.y = -0.5;
    g.add(cat);
    return g;
  },

  // ── 洗面脱衣＋ランドリー ────────────────────────────
  //  ヌックからの扉（南西）と浴室への扉（南）の前を空けるため、
  //  カウンターは北半分にまとめる。
  washroom(b, y, S) {
    const g = new THREE.Group();
    const cx = b.x0 + 0.32;
    const cz0 = b.z0 + 0.18;
    const cz1 = b.z1 - 1.25;          // 南 1.25m は動線として空ける
    const cLen = cz1 - cz0;
    const cCz = (cz0 + cz1) / 2;
    put(g, rbox(0.58, 0.05, cLen, S.stoneTop, 0.01), cx, y + 0.85, cCz);
    put(g, rbox(0.56, 0.8, cLen, S.white, 0.01), cx, y + 0.42, cCz);
    // 洗面ボウル
    const basin = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.13, 0.36), S.porcelain);
    put(g, basin, cx, y + 0.93, cz0 + 0.42);
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.22, 10), S.chrome);
    put(g, tap, cx - 0.2, y + 1.0, cz0 + 0.42);
    // 洗濯機（カウンター下、南端）
    put(g, rbox(0.5, 0.62, 0.55, S.white, 0.03), cx, y + 0.31, cz1 - 0.34);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 24), S.chrome);
    drum.rotation.z = Math.PI / 2;
    put(g, drum, cx - 0.27, y + 0.33, cz1 - 0.34);
    // 三面鏡
    put(g, rbox(0.14, 0.8, 1.0, S.white, 0.01), b.x0 + 0.1, y + 1.55, cz0 + 0.55);
    const mir = put(g, rbox(0.012, 0.74, 0.94, S.chrome, 0.005), b.x0 + 0.18, y + 1.55, cz0 + 0.55);
    mir.castShadow = false;
    // 物干しバー（頭上なので動線には当たらない）
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 10), S.steelPale);
    bar.rotation.x = Math.PI / 2;
    put(g, bar, b.x1 - 0.5, y + 2.05, cCz);
    return g;
  },

  // ── 浴室 ────────────────────────────────────────────
  bath(b, y, S) {
    const g = new THREE.Group();
    // 扉は北（洗面から）。浴槽は南に寄せて、入ってすぐの床を空ける
    put(g, rbox(1.7, 0.58, 0.76, S.porcelain, 0.06), b.cx, y + 0.29, b.z1 - 0.48);
    // 湯（水面）
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(1.54, 0.02, 0.6),
      new THREE.MeshPhysicalMaterial({ color: 0xbfe0e6, roughness: 0.06, transmission: 0.85, transparent: true, opacity: 0.6, thickness: 0.3 }),
    );
    put(g, water, b.cx, y + 0.5, b.z1 - 0.48);
    // 洗い場のカラン＋シャワー
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.1, 10), S.chrome);
    put(g, pole, b.x1 - 0.16, y + 1.15, b.z0 + 0.62);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), S.chrome);
    put(g, head, b.x1 - 0.24, y + 1.62, b.z0 + 0.62);
    // 風呂椅子
    put(g, rbox(0.34, 0.05, 0.26, S.white, 0.02), b.x0 + 0.42, y + 0.29, b.z0 + 1.0);
    for (const [dx, dz] of [[-0.13, -0.09], [0.13, -0.09], [-0.13, 0.09], [0.13, 0.09]]) {
      put(g, rbox(0.03, 0.26, 0.03, S.white, 0.005), b.x0 + 0.42 + dx, y + 0.13, b.z0 + 1.0 + dz);
    }
    return g;
  },

  // ── 玄関土間 ────────────────────────────────────────
  doma(b, y, S) {
    const g = new THREE.Group();
    // 上がり框（土間 → 廊下の段差の見切り）
    put(g, rbox(1.0, 0.16, 0.16, S.walnut, 0.01), 3.9, y + 0.08, 7.55);
    // 玄関ベンチ（玄関ドア x5.4–6.4 の西どなり）
    put(g, rbox(0.9, 0.08, 0.36, S.walnut, 0.015), 4.78, y + 0.42, 9.78);
    for (const dx of [-0.38, 0.38]) put(g, rbox(0.06, 0.42, 0.32, S.steel, 0.01), 4.78 + dx, y + 0.21, 9.78);
    // 自転車
    g.add(buildBicycle(5.05, y, 8.35, S));
    // 縦格子（ジムの入口わきの見切り）。玄関からの見通しは塞がない位置に置く
    for (let i = 0; i < 5; i++) {
      put(g, rbox(0.045, 2.2, 0.045, S.walnut, 0.008), 6.5, y + 1.1, 7.68 + i * 0.12);
    }
    // 大きな花器と枝もの
    const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.06, 0.42, 18), S.glass);
    put(g, vase, 4.65, y + 0.21, 9.3);
    for (let i = 0; i < 5; i++) {
      const br = put(g, rbox(0.012, rand(0.5, 0.9), 0.012, S.bark, 0.004), 4.65 + rand(-0.05, 0.05), y + 0.7, 9.3 + rand(-0.05, 0.05));
      br.rotation.z = rand(-0.35, 0.35);
      br.rotation.x = rand(-0.35, 0.35);
    }
    // 植栽は廊下（幅1.0m）の中に置かない。広がった階段ホールの東端と、玄関脇に
    plant(g, 7.0, y, 7.25, 1.0);
    plant(g, 4.6, y, 9.35, 0.85);
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
    // 背面の壁付け収納。廊下からのアーチ（南寄り）の前は空ける
    const tallZ0 = b.z0 + 0.1;
    const tallZ1 = b.z0 + 1.5;
    put(g, rbox(0.62, 2.1, tallZ1 - tallZ0, S.white, 0.015), b.x1 - 0.35, y + 1.05, (tallZ0 + tallZ1) / 2);
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
    // 北の扉（廊下から）と南の扉（FCへ）の前を空けるため、棚は中央だけにする
    const shelfZ0 = b.z0 + 0.75;
    const shelfZ1 = b.z1 - 0.75;
    const span = shelfZ1 - shelfZ0;
    const shelfCz = (shelfZ0 + shelfZ1) / 2;
    put(g, rbox(0.03, 2.2, span, S.white, 0.004), b.x1 - 0.02, y + 1.1, shelfCz);   // 背板
    for (const dz of [-span / 2, span / 2]) {
      put(g, rbox(0.32, 2.2, 0.03, S.oak, 0.004), shelfX, y + 1.1, shelfCz + dz);   // 側板
    }
    for (let i = 0; i < 6; i++) {
      const sy = y + 0.3 + i * 0.36;
      put(g, rbox(0.32, 0.026, span, S.oak, 0.004), shelfX, sy, shelfCz);
      books(g, { axis: 'z', from: shelfZ0 + 0.06, to: shelfZ1 - 0.06, fixed: shelfX, y: sy + 0.013, depth: 0.24 });
    }
    // 吹抜に face するデスク
    put(g, rbox(0.56, 0.045, 1.6, S.oak, 0.01), b.x0 + 0.35, y + 0.72, b.cz - 0.4);
    for (const dz of [-0.7, 0.7]) put(g, rbox(0.05, 0.68, 0.05, S.steel, 0.008), b.x0 + 0.35, y + 0.36, b.cz - 0.4 + dz);
    put(g, rbox(0.44, 0.05, 0.42, S.leather, 0.04), b.x0 + 0.75, y + 0.45, b.cz - 0.4);
    put(g, rbox(0.06, 0.46, 0.4, S.leather, 0.03), b.x0 + 0.96, y + 0.7, b.cz - 0.4);
    plant(g, b.x0 + 0.32, y, b.z0 + 0.45, 0.9);
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
    // 下草（鉢なし。地面から直接生える）
    for (let i = 0; i < 22; i++) {
      plant(g, b.x0 + rand(0.3, b.x1 - b.x0 - 0.3), y, b.z0 + rand(0.3, b.z1 - b.z0 - 0.3), rand(0.5, 0.9), false);
    }
    return g;
  },
};

// ---------------------------------------------------------------------------
//  共通パーツ
// ---------------------------------------------------------------------------

function closetLike(b, y, S, rods, doors = []) {
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
      const cx = long ? bx : b.x0 + 0.15 + t;
      const cz = long ? b.z0 + 0.15 + t : bz;
      if (nearDoor(doors, cx, cz)) continue;      // 建具の前には掛けない
      const ch = rand(0.7, 1.05);
      const cloth = rbox(long ? 0.32 : 0.05, ch, long ? 0.05 : 0.32, mat, 0.01);
      put(g, cloth, cx, y + 1.72 - ch / 2, cz);
    }
    // 棚板
    put(g, rbox(long ? 0.4 : span, 0.03, long ? span : 0.4, S.oak, 0.006), bx, y + 1.95, bz);
  }
  return g;
}

/**
 * [lo, hi] から、建具の前（margin ぶん）を除いた「いちばん長い区間」を返す。
 * 棚がドアの前をふさがないようにするため。
 */
function clearSpan(lo, hi, doors, axis, across, margin = 0.75, pad = 0.25) {
  let segs = [[lo, hi]];
  for (const o of doors) {
    const vertical = Math.abs(o.from[0] - o.to[0]) < 1e-6;
    const doorAxis = vertical ? 'z' : 'x';
    const pos = vertical ? o.from[0] : o.from[1];
    if (Math.abs(pos - across) > margin) continue;      // その壁の建具ではない
    if (doorAxis !== axis) continue;
    const s0 = Math.min(o.from[vertical ? 1 : 0], o.to[vertical ? 1 : 0]) - pad;
    const s1 = Math.max(o.from[vertical ? 1 : 0], o.to[vertical ? 1 : 0]) + pad;
    segs = segs.flatMap(([a, c]) => {
      if (s1 <= a || s0 >= c) return [[a, c]];
      const out = [];
      if (s0 > a) out.push([a, s0]);
      if (s1 < c) out.push([s1, c]);
      return out;
    });
  }
  return segs.reduce((best, seg) => (seg[1] - seg[0] > best[1] - best[0] ? seg : best), [0, 0]);
}

function shelvesLike(b, y, S, food = false, doors = []) {
  const g = new THREE.Group();
  const long = (b.z1 - b.z0) >= (b.x1 - b.x0);
  const depth = 0.36;
  const wallOff = (long ? b.x1 - b.x0 : b.z1 - b.z0) / 2 - depth / 2 - 0.02;
  for (const side of [-1, 1]) {
    const bx = long ? b.cx + side * wallOff : b.cx;
    const bz = long ? b.cz : b.cz + side * wallOff;
    // 建具の前を避けた区間にだけ棚を作る
    const axis = long ? 'z' : 'x';
    const [lo, hi] = clearSpan(
      (long ? b.z0 : b.x0) + 0.12, (long ? b.z1 : b.x1) - 0.12,
      doors, axis, long ? bx : bz,
    );
    const span = hi - lo;
    if (span < 0.45) continue;              // 置ける長さが残っていない
    const cAlong = (lo + hi) / 2;
    const sx = long ? bx : cAlong;
    const sz = long ? cAlong : bz;
    for (let i = 0; i < 5; i++) {
      const sy = y + 0.35 + i * 0.4;
      if (sy > y + 2.1) break;
      put(g, rbox(long ? depth : span, 0.028, long ? span : depth, S.oak, 0.005), sx, sy, sz);
      // 箱もの／食品
      const n = Math.floor(span / 0.3);
      for (let k = 0; k < n; k++) {
        const t = lo + 0.15 + k * 0.3 + rand(0, 0.06);
        const col = food
          ? ['#c9b48a', '#8f9c7a', '#b98f6a'][k % 3]
          : ['#9a9287', '#7d7469', '#b3ab9e'][k % 3];
        const mat = paletteMaterial([col], 0.9);
        const ix = long ? bx : t;
        const iz = long ? t : bz;
        const ih = rand(0.14, 0.3);
        const item = rbox(long ? 0.26 : 0.2, ih, long ? 0.2 : 0.26, mat, 0.01);
        put(g, item, ix, sy + ih / 2 + 0.015, iz);
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
  const lower = new THREE.Mesh(new RoundedBoxGeometry(W, 0.66, L, 4, 0.09), S.carBody);
  lower.position.y = 0.60;
  lower.castShadow = true;
  g.add(lower);
  // ボンネット／トランク
  const hood = new THREE.Mesh(new RoundedBoxGeometry(W - 0.1, 0.22, 1.45, 4, 0.07), S.carBody);
  hood.position.set(0, 0.96, -1.55);
  hood.castShadow = true;
  g.add(hood);
  const trunk = new THREE.Mesh(new RoundedBoxGeometry(W - 0.1, 0.26, 1.15, 4, 0.07), S.carBody);
  trunk.position.set(0, 0.98, 1.7);
  trunk.castShadow = true;
  g.add(trunk);
  // キャビン
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(W - 0.2, 0.56, 2.15, 4, 0.1), S.carGlass);
  cabin.position.set(0, 1.24, 0.1);
  cabin.castShadow = true;
  g.add(cabin);
  const roof = new THREE.Mesh(new RoundedBoxGeometry(W - 0.34, 0.1, 1.55, 4, 0.05), S.carBody);
  roof.position.set(0, 1.5, 0.18);
  roof.castShadow = true;
  // ピラー（キャビンの角を締める）
  for (const [dx, dz] of [[-0.78, -1.02], [0.78, -1.02], [-0.78, 1.02], [0.78, 1.02]]) {
    const pillar = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.56, 0.09, 3, 0.02), S.carBody);
    pillar.position.set(dx, 1.24, dz);
    g.add(pillar);
  }
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

/**
 * 自転車。前輪が -z を向く向きで組み、最後に全体を回して置く。
 * 車輪は YZ平面（進行方向×鉛直）に立てる必要があるので、
 * TorusGeometry（既定は XY平面）を Y軸まわりに90°回してから使う。
 */
function buildBicycle(x, y, z, S) {
  const g = new THREE.Group();
  const R = 0.33;                 // 車輪の半径
  const rearHub = [0, R, 0.52];
  const frontHub = [0, R, -0.52];
  const bb = [0, 0.27, 0.17];     // ボトムブラケット（クランク軸）
  const seatTop = [0, 0.94, 0.30];
  const headTop = [0, 0.96, -0.28];
  const headLow = [0, 0.56, -0.40];

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x8f9498, roughness: 0.3, metalness: 0.75 });

  // 車輪（タイヤ＋リム＋スポーク）
  for (const hub of [rearHub, frontHub]) {
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(R, 0.021, 8, 32), S.tyre);
    tyre.rotation.y = Math.PI / 2;          // リングを YZ平面に立てる
    tyre.position.set(...hub);
    tyre.castShadow = true;
    g.add(tyre);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.028, 0.009, 6, 32), S.steelPale);
    rim.rotation.y = Math.PI / 2;
    rim.position.set(...hub);
    g.add(rim);

    // スポークは車輪と同じ面内に置く（YZ平面で回す＝X軸まわりの回転）
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, (R - 0.03) * 2, 4), S.steelPale);
      sp.position.set(...hub);
      sp.rotation.x = a;
      g.add(sp);
    }
    const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.09, 10), S.steelPale);
    hubMesh.rotation.z = Math.PI / 2;
    hubMesh.position.set(...hub);
    g.add(hubMesh);
  }

  // フレーム
  tube(g, bb, seatTop, 0.016, frameMat);        // シートチューブ
  tube(g, bb, headLow, 0.017, frameMat);        // ダウンチューブ
  tube(g, seatTop, headTop, 0.015, frameMat);   // トップチューブ
  tube(g, headLow, headTop, 0.016, frameMat);   // ヘッドチューブ
  for (const dx of [-0.045, 0.045]) {
    tube(g, [bb[0] + dx, bb[1], bb[2]], [rearHub[0] + dx, rearHub[1], rearHub[2]], 0.010, frameMat);   // チェーンステー
    tube(g, [seatTop[0] + dx, seatTop[1] - 0.06, seatTop[2]], [rearHub[0] + dx, rearHub[1], rearHub[2]], 0.009, frameMat); // シートステー
    tube(g, [headLow[0] + dx, headLow[1], headLow[2]], [frontHub[0] + dx, frontHub[1], frontHub[2]], 0.011, frameMat);     // フォーク
  }

  // サドル・ハンドル・クランク
  const saddle = new THREE.Mesh(new RoundedBoxGeometry(0.085, 0.045, 0.24, 3, 0.02), S.leather);
  saddle.position.set(0, seatTop[1] + 0.03, seatTop[2] + 0.02);
  saddle.castShadow = true;
  g.add(saddle);

  const barMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2d, roughness: 0.5 });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.44, 10), barMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, headTop[1] + 0.04, headTop[2] - 0.02);
  g.add(bar);
  for (const dx of [-0.19, 0.19]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 8), S.leather);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(dx, headTop[1] + 0.04, headTop[2] - 0.02);
    g.add(grip);
  }

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.006, 6, 20), S.steelPale);
  ring.rotation.y = Math.PI / 2;
  ring.position.set(0.05, bb[1], bb[2]);
  g.add(ring);
  for (const [dx, dz] of [[0.09, 0.09], [-0.09, -0.09]]) {
    const crank = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.02, 0.17), frameMat);
    crank.position.set(dx, bb[1] + dz * 0.4, bb[2] + dz * 0.5);
    crank.rotation.x = dz > 0 ? 0.5 : -0.5;
    g.add(crank);
  }

  // かご
  const basket = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.18, 0.2, 2, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x6f6a60, roughness: 0.85 }));
  basket.position.set(0, 0.72, headTop[2] - 0.12);
  basket.castShadow = true;
  g.add(basket);

  g.position.set(x, y, z);
  g.rotation.y = 0.35;
  return g;
}

// ---------------------------------------------------------------------------
//  エントリポイント
// ---------------------------------------------------------------------------

/**
 * その室の家具グループを作る。furnish が無い／未対応なら null。
 * @param openings その階の開口。建具の前を空けるために使う
 */
export function furnishRoom(area, level, openings = []) {
  const key = area.furnish;
  if (!key || !BUILDERS[key]) return null;
  const S = sharedMaterials();
  const b = bounds(area.polygon);
  const sunken = area.kind === 'outdoor' ? 0.12 : 0;
  // この室の外周にかかる、人が通る開口だけを拾う
  const doors = openings.filter((o) => DOOR_TYPES.has(o.type) && touchesRoom(o, b));
  const g = BUILDERS[key](b, level - sunken, S, doors);
  g.name = `furniture-${area.id}`;
  return g;
}

const DOOR_TYPES = new Set(['door', 'archway', 'entrance', 'glass-door']);

function touchesRoom(o, b) {
  const pad = 0.05;
  const x = [Math.min(o.from[0], o.to[0]), Math.max(o.from[0], o.to[0])];
  const z = [Math.min(o.from[1], o.to[1]), Math.max(o.from[1], o.to[1])];
  return x[1] >= b.x0 - pad && x[0] <= b.x1 + pad && z[1] >= b.z0 - pad && z[0] <= b.z1 + pad;
}

/**
 * (x, z) が、どれかの建具の前の「空けておくべき帯」に入っているか。
 * 棚やクローゼットは、ここを避けて置く。
 */
function nearDoor(doors, x, z, margin = 0.75, side = 0.15) {
  for (const o of doors) {
    const vertical = Math.abs(o.from[0] - o.to[0]) < 1e-6;
    const s = Math.min(o.from[vertical ? 1 : 0], o.to[vertical ? 1 : 0]) - side;
    const e = Math.max(o.from[vertical ? 1 : 0], o.to[vertical ? 1 : 0]) + side;
    const pos = vertical ? o.from[0] : o.from[1];
    const along = vertical ? z : x;
    const across = vertical ? x : z;
    if (along >= s && along <= e && Math.abs(across - pos) <= margin) return true;
  }
  return false;
}
