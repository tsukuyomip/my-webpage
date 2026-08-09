// ============================================================================
//  中庭のシンボルツリー（株立ち）
// ============================================================================
//
//  この家の要は「2層吹抜の中庭に立つ1本の木」なので、ここだけは少し丁寧に作ります。
//  幹を再帰的に枝分かれさせ、枝先に葉のかたまりを付けます。
//  樹高は約5.5m。樹冠が3.2〜5.2m に来るので、2Fの開口の高さでちょうど緑が見えます。
// ============================================================================

import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);

// 葉のマテリアルは色ごとに1つだけ作って使い回す（数が多いので描画コール対策）
let LEAF_MATS = null;
function leafMaterials() {
  if (!LEAF_MATS) {
    LEAF_MATS = [0x6b8f47, 0x7a9c52, 0x5c7f3c, 0x87a95d, 0x4e6f34, 0x93b169].map((color) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.92, flatShading: true }));
  }
  return LEAF_MATS;
}

/** 葉のかたまり。少しずつ色を振って、のっぺりさせない */
function foliage(parent, position, radius, half) {
  const mats = leafMaterials();
  const cluster = new THREE.Group();
  const n = 5 + ((Math.random() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const r = radius * rand(0.55, 1.0);
    const geo = new THREE.IcosahedronGeometry(r, 1);
    // 頂点を少し散らして、球っぽさを消す
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      pos.setXYZ(v,
        pos.getX(v) * rand(0.82, 1.18),
        pos.getY(v) * rand(0.62, 0.95),
        pos.getZ(v) * rand(0.82, 1.18));
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mats[(Math.random() * mats.length) | 0]);
    m.castShadow = true;
    m.receiveShadow = true;
    // 中庭の内側からはみ出さないよう、葉の位置を枠に収める。
    // 球の半径ぶんも引いておかないと、玉の縁が壁を突き抜ける
    m.position.set(
      clamp(position.x + rand(-radius, radius) * 0.7, Math.max(0, half.x - r)),
      position.y + rand(-radius, radius) * 0.45,
      clamp(position.z + rand(-radius, radius) * 0.7, Math.max(0, half.z - r)),
    );
    cluster.add(m);
  }
  parent.add(cluster);
}

const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v));

/**
 * 幹・枝を再帰的に伸ばす。
 * half は中庭の内側の枠（半径）。枝先がここを越えたら押し戻すので、
 * 樹冠が壁を突き破らない。
 */
function branch(parent, barkMat, start, dir, length, radius, depth, half) {
  const end = start.clone().addScaledVector(dir, length);
  // 枠からはみ出す枝は、内側に折り返す
  end.x = clamp(end.x, half.x);
  end.z = clamp(end.z, half.z);
  const seg = end.clone().sub(start);
  const segLen = seg.length();
  if (segLen < 0.05) return;
  const segDir = seg.clone().normalize();

  const geo = new THREE.CylinderGeometry(radius * 0.66, radius, segLen, 7, 1);
  geo.translate(0, segLen / 2, 0);
  const mesh = new THREE.Mesh(geo, barkMat);
  mesh.castShadow = true;
  mesh.position.copy(start);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), segDir);
  parent.add(mesh);

  if (depth === 0 || radius < 0.014) {
    foliage(parent, end, rand(0.22, 0.36), half);
    return;
  }

  const children = Math.random() < 0.6 ? 2 : 3;
  for (let i = 0; i < children; i++) {
    const axis = new THREE.Vector3(rand(-1, 1), rand(-0.15, 0.25), rand(-1, 1)).normalize();
    const next = segDir.clone().applyAxisAngle(axis, rand(0.22, 0.5)).normalize();
    // 上に伸びる性質を残す。枠に近い枝は内側へ向ける
    next.y = Math.max(next.y, 0.45);
    if (Math.abs(end.x) > half.x * 0.8) next.x -= Math.sign(end.x) * 0.5;
    if (Math.abs(end.z) > half.z * 0.8) next.z -= Math.sign(end.z) * 0.5;
    next.normalize();
    branch(parent, barkMat, end, next, segLen * rand(0.58, 0.72), radius * rand(0.6, 0.72), depth - 1, half);
  }
}

/**
 * 中庭のシンボルツリーを作る。
 * @param {number} x
 * @param {number} y  地面の高さ
 * @param {number} z
 */
export function buildTree(x, y, z, half = { x: 1.1, z: 1.4 }) {
  const g = new THREE.Group();
  g.name = 'symbol-tree';

  const bark = new THREE.MeshStandardMaterial({ color: 0x6a5f52, roughness: 0.95 });

  // 株立ち：根元から3〜4本の幹が立ち上がる。
  // 中庭に収めるため、横に広げず縦に伸ばす（雑木の株立ちらしい姿でもある）
  const stems = 3 + ((Math.random() * 2) | 0);
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + rand(-0.4, 0.4);
    const spread = rand(0.05, 0.16);
    const start = new THREE.Vector3(Math.cos(a) * spread, 0, Math.sin(a) * spread);
    const dir = new THREE.Vector3(Math.cos(a) * rand(0.08, 0.16), 1, Math.sin(a) * rand(0.08, 0.16)).normalize();
    branch(g, bark, start, dir, rand(2.1, 2.6), rand(0.05, 0.07), 3, half);
  }

  // 根鉢まわりの下草リング
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.68, 0.09, 24),
    new THREE.MeshStandardMaterial({ color: 0x4d5c3a, roughness: 1 }),
  );
  ring.position.y = 0.045;
  ring.receiveShadow = true;
  g.add(ring);

  g.position.set(x, y, z);
  return g;
}

/** 敷地の外に置く、背景としての木（軽くする） */
export function buildBackgroundTree(x, y, z, scale = 1) {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: 0x6b6154, roughness: 0.95 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 2.4, 6), bark);
  trunk.position.y = 1.2;
  g.add(trunk);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x6f9250, roughness: 0.95, flatShading: true });
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.75, 1.15), 1), canopyMat);
    c.position.set(rand(-0.5, 0.5), rand(2.4, 3.5), rand(-0.5, 0.5));
    c.scale.y = 0.8;
    g.add(c);
  }
  g.position.set(x, y, z);
  g.scale.setScalar(scale);
  return g;
}
