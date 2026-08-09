// ============================================================================
//  躯体の生成 — house.js のポリゴンと開口から、壁・床・天井・階段を組み立てる
// ============================================================================
//
//  平面図（plan.js）とまったく同じデータから立体を起こすので、
//  「図面では壁があるのに3Dでは無い」といった食い違いが起きません。
//
//  壁の求め方：
//    建物外形を10cm刻みの格子に切り、各セルがどの室に属するかを求める。
//    隣り合うセルの所属が違うところが「壁」。同じ組み合わせが続く区間を
//    1本の壁にまとめてから、開口（建具・窓）の区間を引き算する。
//    → L字の室でも、室をまたぐ長い壁でも、破綻せずに1回で出る。
//
//  座標系： data(x, y) → world(x, ↑, y)。つまり world.z が data.y（北→南）。
// ============================================================================

import * as THREE from 'three';
import { RoundedBoxGeometry } from '../../vendor/addons/RoundedBoxGeometry.js';
import { build3d, openingSpecs } from '../../data/house.js';
import { pointInPolygon } from '../geometry.js';
import { finishMaterial, sharedMaterials, box, scaleBoxUVs } from './materials.js';

export const GRID = 0.1;          // 格子の刻み（m）
export const CELLS = 100;         // 10.0m / 0.1m

const OUTSIDE = -1;

// ---------------------------------------------------------------------------
//  1. 格子の所属マップ
// ---------------------------------------------------------------------------

/** areas[] の何番目に属するか。属さないセルは OUTSIDE */
function ownershipGrid(areas) {
  const owner = new Int16Array(CELLS * CELLS).fill(OUTSIDE);
  for (let j = 0; j < CELLS; j++) {
    const y = (j + 0.5) * GRID;
    for (let i = 0; i < CELLS; i++) {
      const x = (i + 0.5) * GRID;
      for (let a = 0; a < areas.length; a++) {
        if (pointInPolygon([x, y], areas[a].polygon)) { owner[j * CELLS + i] = a; break; }
      }
    }
  }
  return owner;
}

const at = (owner, i, j) =>
  (i < 0 || j < 0 || i >= CELLS || j >= CELLS) ? OUTSIDE : owner[j * CELLS + i];

/**
 * 壁の走り（run）を取り出す。
 * @returns {{axis:'x'|'y', pos:number, from:number, to:number, a:number, b:number}[]}
 *    axis 'x' … x = pos の縦壁（from..to は y）
 *    axis 'y' … y = pos の横壁（from..to は x）
 *    a, b     … 両側の areas インデックス（OUTSIDE を含む）
 */
function wallRuns(owner) {
  const runs = [];

  const sweep = (axis) => {
    for (let p = 0; p <= CELLS; p++) {
      let start = null; let key = null;
      for (let q = 0; q <= CELLS; q++) {
        let a = OUTSIDE; let b = OUTSIDE;
        if (q < CELLS) {
          a = axis === 'x' ? at(owner, p - 1, q) : at(owner, q, p - 1);
          b = axis === 'x' ? at(owner, p, q) : at(owner, q, p);
        }
        // a = 座標の小さい側、b = 大きい側。左右で仕上げを貼り分けるため順序を保つ
        const k = (q < CELLS && a !== b) ? `${a}|${b}` : null;
        if (k !== key) {
          if (key !== null && start !== null) {
            const [ka, kb] = key.split('|').map(Number);
            runs.push({ axis, pos: p * GRID, from: start * GRID, to: q * GRID, a: ka, b: kb });
          }
          key = k; start = k === null ? null : q;
        }
      }
    }
  };
  sweep('x');
  sweep('y');
  return runs;
}

// ---------------------------------------------------------------------------
//  2. 開口の割り当て
// ---------------------------------------------------------------------------

/** その壁の走りにかかる開口を、区間 [s,e] に正規化して返す */
function openingsOnRun(run, openings) {
  const found = [];
  for (const o of openings) {
    const spec = openingSpecs[o.type];
    if (!spec) continue;
    const constAxis = run.axis === 'x' ? 0 : 1;
    const spanAxis = run.axis === 'x' ? 1 : 0;
    if (Math.abs(o.from[constAxis] - run.pos) > 1e-6) continue;
    if (Math.abs(o.to[constAxis] - run.pos) > 1e-6) continue;
    const s = Math.max(run.from, Math.min(o.from[spanAxis], o.to[spanAxis]));
    const e = Math.min(run.to, Math.max(o.from[spanAxis], o.to[spanAxis]));
    if (e - s > 1e-6) found.push({ s, e, spec, type: o.type, label: o.label });
  }
  return found.sort((p, q) => p.s - q.s);
}

// ---------------------------------------------------------------------------
//  3. フロアの組み立て
// ---------------------------------------------------------------------------

/**
 * 1フロア分の躯体を作る。
 * @returns {{ group: THREE.Group, blocked: Uint8Array, walkable: Uint8Array }}
 */
export function buildFloorShell(floor, opt = {}) {
  const { isTop, holesAbove = [] } = opt;
  const S = sharedMaterials();
  const group = new THREE.Group();
  group.name = `shell-${floor.id}`;

  const rooms = floor.rooms;
  const voids = floor.voids ?? [];
  const areas = [...rooms, ...voids];
  const owner = ownershipGrid(areas);
  const level = floor.level;
  const H = floor.ceiling;

  // 歩けるところ／壁で塞がれているところ
  const walkable = new Uint8Array(CELLS * CELLS);
  const blocked = new Uint8Array(CELLS * CELLS);
  const holes = floor.slabHoles ?? [];   // この階の床に開ける穴（階段室）

  for (let k = 0; k < owner.length; k++) {
    const a = owner[k];
    if (a === OUTSIDE) { blocked[k] = 1; continue; }
    const area = areas[a];
    const isVoid = voids.includes(area);
    // 吹抜（床がない）は歩けない。1Fの中庭は地面があるので歩ける
    if (isVoid && area.kind === 'void') { blocked[k] = 1; continue; }
    // 階段室の抜きは床がないので歩けない（階段の上だけは walk.js が例外にする）
    const i = k % CELLS; const j = (k / CELLS) | 0;
    const pt = [(i + 0.5) * GRID, (j + 0.5) * GRID];
    if (holes.some((h) => pointInPolygon(pt, h))) { blocked[k] = 1; continue; }
    walkable[k] = 1;
  }

  // ── 床スラブ ──────────────────────────────────────────
  for (const area of areas) {
    const isVoid = voids.includes(area);
    if (isVoid && area.kind === 'void') continue;      // 2Fの吹抜は床なし
    const sunken = area.kind === 'outdoor' ? 0.12 : 0;  // 中庭は土間より一段下げる
    const mesh = slab(area.polygon, finishMaterial(area.finishes.floor), level - sunken, 'up', holes);
    mesh.receiveShadow = true;
    group.add(mesh);
    // 床の下地（見上げたときの厚み）
    group.add(slab(area.polygon, S.white, level - sunken - build3d.slab, 'down', holes));
  }

  // ── 天井 ──────────────────────────────────────────────
  for (const area of areas) {
    if (area.sky) continue;                            // 中庭は空に開く
    const isVoid = voids.includes(area);
    if (isVoid && !isTop) continue;                    // 下階の吹抜は天井を張らない
    // 上階の階段室の抜きは、この階の天井にも同じ穴を開ける
    const mesh = slab(area.polygon, finishMaterial(area.finishes.ceiling), level + H, 'down', holesAbove);
    group.add(mesh);
  }

  // ── 壁 ────────────────────────────────────────────────
  const runs = wallRuns(owner);
  for (const run of runs) {
    const areaA = run.a === OUTSIDE ? null : areas[run.a];
    const areaB = run.b === OUTSIDE ? null : areas[run.b];
    const isExterior = run.a === OUTSIDE || run.b === OUTSIDE;

    // 吹抜どうしの境（中庭上部と玄関上部の間）には壁を立てない
    const bothVoid = areaA && areaB && voids.includes(areaA) && voids.includes(areaB);
    if (bothVoid) continue;

    const t = isExterior ? build3d.wall.exterior : build3d.wall.interior;
    // 壁の高さ：空に開く中庭に面する外周だけ、パラペットまで立ち上げる
    const skySide = (areaA?.sky || areaB?.sky);
    const top = skySide && isTop ? H + build3d.parapet : H;

    const mat = wallMaterials(areaA, areaB, run.axis);
    buildWallRun(group, run, {
      level, height: top, thickness: t, material: mat,
      openings: openingsOnRun(run, floor.openings ?? []),
      shared: S, blocked, isExterior,
    });
  }

  // ── 吹抜まわりの手すり ────────────────────────────────
  for (const o of floor.openings ?? []) {
    if (o.type !== 'railing') continue;
    group.add(railing(o.from, o.to, level));
  }

  // ── 階段 ──────────────────────────────────────────────
  for (const st of floor.stairs ?? []) {
    if (st.dir !== 'up') continue;   // 上り側の階でだけ実体を作る
    // 上り切りが上階の床とぴったり合うように、階高そのものを渡す
    group.add(skeletonStair(st, level, opt.riseToNext ?? (floor.ceiling + build3d.slab)));
  }

  return { group, blocked, walkable, owner, areas };
}

/**
 * 壁は1枚の箱だが、面ごとにマテリアルを割り当てられるので、
 * 「その面が向いている室の仕上げ」をそれぞれ貼る。
 * これで、たとえば書斎側は白塗装・洗面側はモザイクタイル、という当たり前のことができる。
 *
 * BoxGeometry の面の順番: [+x, -x, +y, -y, +z, -z]
 *   axis 'x'（x = pos の縦壁）… -x 面が a（座標の小さい側）、+x 面が b
 *   axis 'y'（y = pos の横壁）… -z 面が a、+z 面が b
 */
function wallMaterials(a, b, axis) {
  const pick = (r) => finishMaterial(r?.finishes?.wall ?? 'w-concrete');
  const matA = pick(a);         // 座標の小さい側の室から見た面
  const matB = pick(b);         // 大きい側の室から見た面
  const edge = a ? matA : matB; // 小口（開口の脇や上下）
  return axis === 'x'
    ? [matB, matA, edge, edge, edge, edge]
    : [edge, edge, edge, edge, matB, matA];
}

// ---------------------------------------------------------------------------
//  壁1本を、開口を抜きながら組む
// ---------------------------------------------------------------------------

function buildWallRun(group, run, opt) {
  const { level, height, thickness, material, openings, shared, blocked, isExterior } = opt;

  const place = (from, to, y0, y1, mat, thick = thickness) => {
    const len = to - from;
    const h = y1 - y0;
    if (len <= 1e-4 || h <= 1e-4) return null;
    const m = run.axis === 'x'
      ? box(thick, h, len, mat)
      : box(len, h, thick, mat);
    m.position.set(
      run.axis === 'x' ? run.pos : (from + to) / 2,
      level + (y0 + y1) / 2,
      run.axis === 'x' ? (from + to) / 2 : run.pos,
    );
    group.add(m);
    return m;
  };

  // 開口のない部分を塞ぐ
  let cursor = run.from;
  for (const o of openings) {
    if (o.s > cursor) place(cursor, o.s, 0, height, material);
    // 開口の下（腰壁）と上（垂れ壁）
    if (o.spec.sill > 0.001) place(o.s, o.e, 0, o.spec.sill, material);
    if (o.spec.head < height - 0.001) place(o.s, o.e, o.spec.head, height, material);
    addOpeningParts(group, run, o, level, thickness, shared);
    cursor = Math.max(cursor, o.e);
  }
  if (cursor < run.to) place(cursor, run.to, 0, height, material);

  // 当たり判定：壁の芯から thickness/2 ＋ 余裕 の帯を塞ぐ。
  // ただし人が通れる開口（扉・アーチ）の区間は空けておく。
  markWall(blocked, run, thickness, openings, isExterior);
}

/** 開口の建具・ガラス・枠 */
function addOpeningParts(group, run, o, level, thickness, S) {
  const { s, e, spec } = o;
  const w = e - s;
  const h = spec.head - spec.sill;
  const cx = run.axis === 'x' ? run.pos : (s + e) / 2;
  const cz = run.axis === 'x' ? (s + e) / 2 : run.pos;
  const cy = level + (spec.sill + spec.head) / 2;

  const put = (mesh) => { mesh.position.set(cx, cy, cz); group.add(mesh); return mesh; };
  const sized = (thick, mat, ww = w, hh = h) =>
    (run.axis === 'x' ? box(thick, hh, ww, mat) : box(ww, hh, thick, mat));

  if (spec.glass) {
    const g = put(sized(0.014, S.glass));
    g.castShadow = false;
    // サッシの枠
    frameRect(group, run, s, e, level + spec.sill, level + spec.head, thickness, S.frameDark);
  }

  if (spec.kind === 'door' && !spec.glass) {
    const leaf = put(sized(thickness * 0.55, S.doorWood, w - 0.06, h - 0.04));
    leaf.castShadow = true;
    // ハンドル
    const knob = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.11, 4, 8), S.steelPale);
    knob.rotation.z = Math.PI / 2;
    const side = run.axis === 'x' ? [0.06, 0] : [0, 0.06];
    knob.position.set(cx + side[0], level + 1.02, cz + side[1] + (run.axis === 'x' ? w / 2 - 0.09 : 0));
    if (run.axis === 'y') knob.position.x = cx + w / 2 - 0.09;
    group.add(knob);
    frameRect(group, run, s, e, level, level + spec.head, thickness, S.frameWood);
  }

  if (spec.kind === 'open') {
    frameRect(group, run, s, e, level, level + spec.head, thickness, S.frameWood);
  }

  if (spec.kind === 'shutter') {
    const shut = put(sized(0.05, S.steel));
    shut.castShadow = true;
    // 水平のリブ
    for (let y = 0.15; y < h; y += 0.22) {
      const rib = run.axis === 'x' ? box(0.062, 0.02, w, S.steelPale) : box(w, 0.02, 0.062, S.steelPale);
      rib.position.set(cx, level + spec.sill + y, cz);
      group.add(rib);
    }
  }
}

/** 開口まわりの見切り枠 */
function frameRect(group, run, s, e, y0, y1, thickness, mat) {
  const f = 0.045;
  const t = thickness + 0.012;
  const add = (w, h, d, x, y, z) => {
    const m = box(w, h, d, mat);
    m.position.set(x, y, z);
    group.add(m);
  };
  if (run.axis === 'x') {
    add(t, f, e - s, run.pos, y0 - f / 2, (s + e) / 2);
    add(t, f, e - s, run.pos, y1 + f / 2, (s + e) / 2);
    add(t, y1 - y0 + f * 2, f, run.pos, (y0 + y1) / 2, s - f / 2);
    add(t, y1 - y0 + f * 2, f, run.pos, (y0 + y1) / 2, e + f / 2);
  } else {
    add(e - s, f, t, (s + e) / 2, y0 - f / 2, run.pos);
    add(e - s, f, t, (s + e) / 2, y1 + f / 2, run.pos);
    add(f, y1 - y0 + f * 2, t, s - f / 2, (y0 + y1) / 2, run.pos);
    add(f, y1 - y0 + f * 2, t, e + f / 2, (y0 + y1) / 2, run.pos);
  }
}

/** 当たり判定の帯を立てる */
function markWall(blocked, run, thickness, openings, isExterior) {
  const half = thickness / 2;
  const pass = openings.filter((o) => o.spec.pass);
  const cells = Math.max(1, Math.ceil(half / GRID));

  const spanFrom = Math.floor(run.from / GRID);
  const spanTo = Math.ceil(run.to / GRID);
  const p = Math.round(run.pos / GRID);

  for (let q = spanFrom; q < spanTo; q++) {
    const coord = (q + 0.5) * GRID;
    const open = pass.some((o) => coord > o.s + 0.02 && coord < o.e - 0.02);
    if (open && !isExterior) continue;
    if (open && isExterior) continue;   // 玄関ドアも通り抜けられるようにする
    for (let d = -cells; d < cells; d++) {
      const i = run.axis === 'x' ? p + d : q;
      const j = run.axis === 'x' ? q : p + d;
      if (i < 0 || j < 0 || i >= CELLS || j >= CELLS) continue;
      blocked[j * CELLS + i] = 1;
    }
  }
}

// ---------------------------------------------------------------------------
//  床・天井のスラブ（任意多角形）
// ---------------------------------------------------------------------------

function slab(polygon, material, y, facing, holes = []) {
  const toShapePoint = ([x, z]) => [x, facing === 'up' ? -z : z];
  const shape = new THREE.Shape();
  polygon.forEach((p, i) => {
    const [x, py] = toShapePoint(p);
    if (i === 0) shape.moveTo(x, py); else shape.lineTo(x, py);
  });
  shape.closePath();

  // 階段室などの抜き。多角形が重なっている分だけ穴を開ける
  for (const hole of holes) {
    if (!polygonsOverlap(polygon, hole)) continue;
    const path = new THREE.Path();
    hole.forEach((p, i) => {
      const [x, py] = toShapePoint(p);
      if (i === 0) path.moveTo(x, py); else path.lineTo(x, py);
    });
    path.closePath();
    shape.holes.push(path);
  }

  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(facing === 'up' ? -Math.PI / 2 : Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
//  吹抜まわりの手すり（スチールのフラットバー＋細い縦桟）
// ---------------------------------------------------------------------------

function railing(from, to, level) {
  const S = sharedMaterials();
  const g = new THREE.Group();
  const [x0, z0] = from;
  const [x1, z1] = to;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const horizontal = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const h = build3d.railHeight;

  const rail = horizontal ? box(len, 0.05, 0.035, S.steel) : box(0.035, 0.05, len, S.steel);
  rail.position.set((x0 + x1) / 2, level + h, (z0 + z1) / 2);
  g.add(rail);

  const n = Math.max(2, Math.round(len / 0.11));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, h, 6), S.steel);
    post.position.set(x0 + (x1 - x0) * t, level + h / 2, z0 + (z1 - z0) * t);
    post.castShadow = true;
    g.add(post);
  }
  // 巾木がわりの見切り
  const base = horizontal ? box(len, 0.06, 0.05, S.steel) : box(0.05, 0.06, len, S.steel);
  base.position.set((x0 + x1) / 2, level + 0.03, (z0 + z1) / 2);
  g.add(base);
  return g;
}

// ---------------------------------------------------------------------------
//  スケルトン階段（中央のスチール梁に木の踏板が片持ちで刺さる）
// ---------------------------------------------------------------------------

function skeletonStair(st, level, rise) {
  const S = sharedMaterials();
  const g = new THREE.Group();
  g.name = 'stair';

  const geo = stairGeometry(st, level, rise);
  const { vertical, cross, width, run, steps, riser, going, dir, startAlong, angle } = geo;

  // 踏面の先端（段鼻）を結んだ線 = 下端の床から上端の床まで
  const nosingCenter = {
    along: startAlong + dir * run / 2,
    y: level + rise / 2,
  };
  const flightLen = Math.hypot(run, rise);

  const place = (mesh, along, y, offCross = 0) => {
    mesh.position.set(
      vertical ? cross + offCross : along,
      y,
      vertical ? along : cross + offCross,
    );
    g.add(mesh);
    return mesh;
  };

  // ── 中央のスチール芯梁（踏面のすぐ下を通す） ──
  const spine = vertical
    ? box(0.1, 0.22, flightLen, S.steel)
    : box(flightLen, 0.22, 0.1, S.steel);
  place(spine, nosingCenter.along, nosingCenter.y - 0.17);
  if (vertical) spine.rotation.x = angle; else spine.rotation.z = angle;

  // ── 踏板（段鼻が芯梁から片持ちで出る） ──
  const depth = going + 0.04;
  for (let i = 1; i <= steps; i++) {
    const yTop = level + riser * i;
    const nosing = startAlong + dir * going * i;
    const tread = new THREE.Mesh(
      new RoundedBoxGeometry(vertical ? width : depth, 0.05, vertical ? depth : width, 2, 0.012),
      S.oak,
    );
    tread.castShadow = true;
    tread.receiveShadow = true;
    place(tread, nosing - dir * (depth / 2 - 0.03), yTop - 0.025);

    // 踏板の裏のライン照明（浮いて見せる）
    const strip = vertical
      ? box(width * 0.72, 0.01, 0.018, S.lightWarm)
      : box(0.018, 0.01, width * 0.72, S.lightWarm);
    strip.castShadow = false;
    place(strip, nosing - dir * (depth - 0.05), yTop - 0.056);
  }

  // ── 手すり（西側。踏面の外に出す） ──
  const railOff = -(width / 2 + 0.04);
  for (let i = 0; i <= steps; i += 3) {
    const along = startAlong + dir * going * i;
    const y = level + riser * i;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 6), S.steel);
    post.castShadow = true;
    place(post, along, y + 0.45, railOff);
  }
  const hand = vertical
    ? box(0.035, 0.035, flightLen, S.steel)
    : box(flightLen, 0.035, 0.035, S.steel);
  place(hand, nosingCenter.along, nosingCenter.y + 0.9, railOff);
  if (vertical) hand.rotation.x = angle; else hand.rotation.z = angle;

  return g;
}

/**
 * 階段の寸法を1か所で求める。3Dの実体（skeletonStair）と
 * 歩行時の高さ（stairProfile）が、必ず同じ数字を使うようにするため。
 */
function stairGeometry(st, level, rise) {
  const x0 = Math.min(st.from[0], st.to[0]);
  const x1 = Math.max(st.from[0], st.to[0]);
  const z0 = Math.min(st.from[1], st.to[1]);
  const z1 = Math.max(st.from[1], st.to[1]);
  const vertical = (z1 - z0) >= (x1 - x0);

  const width = vertical ? x1 - x0 : z1 - z0;
  const run = vertical ? z1 - z0 : x1 - x0;
  const cross = vertical ? (x0 + x1) / 2 : (z0 + z1) / 2;
  const startAlong = vertical ? st.from[1] : st.from[0];
  const endAlong = vertical ? st.to[1] : st.to[0];
  const dir = Math.sign(endAlong - startAlong);
  const steps = st.steps;                 // 蹴上げの数
  const riser = rise / steps;             // 蹴上げ
  const going = run / steps;              // 踏面の出

  // 段鼻を結んだ線の傾き。箱の長辺をこの向きに合わせる回転角。
  //   vertical（長辺 = +z）… X軸まわりの回転で +z は (0, -sinθ, cosθ) に写るので符号が反転する
  //   horizontal（長辺 = +x）… Z軸まわりの回転で +x は (cosφ, sinφ, 0) に写る
  const delta = endAlong - startAlong;
  const angle = vertical ? -Math.atan2(rise, delta) : Math.atan2(rise, delta);

  return { x0, x1, z0, z1, vertical, width, run, cross, startAlong, endAlong, dir, steps, riser, going, angle };
}

/** 階段の踏面をたどって高さを返す（歩行時に使う） */
export function stairProfile(floor, nextLevel) {
  const st = (floor.stairs ?? []).find((s) => s.dir === 'up');
  if (!st) return null;
  const rise = nextLevel - floor.level;
  const geo = stairGeometry(st, floor.level, rise);
  return {
    ...geo,
    base: floor.level,
    top: nextLevel,
    /** 階段として扱う範囲。左右は踏面のすぐ外、前後は上り口・下り口の踏み込み分 */
    contains(x, z) {
      const along = this.vertical ? z : x;
      const cross = this.vertical ? x : z;
      const lo = Math.min(this.startAlong, this.endAlong);
      const hi = Math.max(this.startAlong, this.endAlong);
      return cross >= (this.vertical ? this.x0 : this.z0) - 0.05
          && cross <= (this.vertical ? this.x1 : this.z1) + 0.05
          && along >= lo - 0.25 && along <= hi + 0.45;
    },
    /** その位置の踏面の高さ。実体の踏板と同じ計算にしてある */
    heightAt(x, z) {
      const along = this.vertical ? z : x;
      const t = (along - this.startAlong) / (this.endAlong - this.startAlong);
      const step = Math.round(Math.max(0, Math.min(1, t)) * this.steps);
      return this.base + step * this.riser;
    },
  };
}

// ---------------------------------------------------------------------------
//  家具を当たり判定に取り込む＋建具まわりの空きを検査する
// ---------------------------------------------------------------------------

/**
 * 家具のうち「人がぶつかる高さ」にあるものを、当たり判定の格子に焼き込む。
 * これで、ベッドや棚をすり抜けて歩けなくなる。
 */
export function registerFurniture(group, level, blocked) {
  const bbox = new THREE.Box3();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh) return;
    bbox.setFromObject(o);
    // 足元すれすれ（ラグ）や頭上（照明・棚の上段）は通れるので除く
    if (bbox.max.y < level + 0.12 || bbox.min.y > level + 1.35) return;
    const i0 = Math.floor(bbox.min.x / GRID);
    const i1 = Math.ceil(bbox.max.x / GRID);
    const j0 = Math.floor(bbox.min.z / GRID);
    const j1 = Math.ceil(bbox.max.z / GRID);
    for (let j = Math.max(0, j0); j < Math.min(CELLS, j1); j++) {
      for (let i = Math.max(0, i0); i < Math.min(CELLS, i1); i++) blocked[j * CELLS + i] = 1;
    }
  });
}

/**
 * 建具の前後に人が立てる空きがあるかを実測する。
 * 家具を置いた結果、扉が開かない／通れない、という事故をここで捕まえる。
 * @returns {{label:string, ok:boolean, detail:string}[]}
 */
export function checkDoorClearance(floor, blocked) {
  const results = [];
  const DEPTH = 0.45;   // 扉の前後にこれだけの奥行きが要る
  for (const o of floor.openings ?? []) {
    const spec = openingSpecs[o.type];
    if (!spec?.pass) continue;
    // 'open' は壁のない一体空間の境界なので、幅いっぱいの空きは要らない
    if (o.type === 'open') continue;
    const vertical = Math.abs(o.from[0] - o.to[0]) < 1e-6;   // x一定＝縦壁の開口
    const s = Math.min(o.from[vertical ? 1 : 0], o.to[vertical ? 1 : 0]);
    const e = Math.max(o.from[vertical ? 1 : 0], o.to[vertical ? 1 : 0]);
    const pos = vertical ? o.from[0] : o.from[1];

    const blockedSides = [];
    for (const side of [-1, 1]) {
      let hit = 0; let total = 0;
      for (let t = s + 0.1; t < e - 0.1; t += 0.1) {
        for (let d = 0.12; d <= DEPTH; d += 0.1) {
          const x = vertical ? pos + side * d : t;
          const z = vertical ? t : pos + side * d;
          const i = Math.floor(x / GRID);
          const j = Math.floor(z / GRID);
          // 建物の外は検査しない（玄関ドアやガレージの外側）
          if (i < 0 || j < 0 || i >= CELLS || j >= CELLS) continue;
          total++;
          if (blocked[j * CELLS + i]) hit++;
        }
      }
      if (total >= 6 && hit / total > 0.34) blockedSides.push(side < 0 ? '手前' : '奥');
    }
    results.push({
      label: o.label ?? o.type,
      ok: blockedSides.length === 0,
      detail: blockedSides.length === 0 ? '前後とも空いている' : `${blockedSides.join('・')}側がふさがっている`,
    });
  }
  return results;
}

export { RoundedBoxGeometry, scaleBoxUVs };

/** 2つの多角形が（おおよそ）重なっているか。穴あけの要否判定に使う */
function polygonsOverlap(a, b) {
  const step = 0.1;
  const xs = b.map((p) => p[0]);
  const ys = b.map((p) => p[1]);
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
    for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
      if (pointInPolygon([x, y], b) && pointInPolygon([x, y], a)) return true;
    }
  }
  return false;
}
