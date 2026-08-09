// ============================================================================
//  幾何計算 — 面積はすべてここで求める（データ側に面積を書く欄はない）
// ============================================================================

import { meta } from '../data/house.js';

/** 多角形の面積（シューレース公式）。頂点の周り方は問わない */
export function polygonArea(polygon) {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** 多角形の重心。凹型で重心が外に出る場合の対策は labelPoint() 側で行う */
export function polygonCentroid(polygon) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return boundingBox(polygon).center;
  return [cx / (6 * a), cy / (6 * a)];
}

/** 点が多角形の内側にあるか（レイキャスティング） */
export function pointInPolygon(point, polygon) {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = (yi > py) !== (yj > py)
      && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function boundingBox(polygon) {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const min = [Math.min(...xs), Math.min(...ys)];
  const max = [Math.max(...xs), Math.max(...ys)];
  return { min, max, center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2] };
}

/**
 * ラベルを置くのに安全な点。
 * 重心が多角形の外に出る（L字など）場合は、内部の格子点から
 * いちばん「奥まった」点を選び直す。
 */
export function labelPoint(room) {
  if (room.labelAt) return room.labelAt;
  const centroid = polygonCentroid(room.polygon);
  if (pointInPolygon(centroid, room.polygon)) return centroid;

  const { min, max } = boundingBox(room.polygon);
  let best = centroid;
  let bestDist = -1;
  const step = 0.1;
  for (let x = min[0] + step; x < max[0]; x += step) {
    for (let y = min[1] + step; y < max[1]; y += step) {
      if (!pointInPolygon([x, y], room.polygon)) continue;
      const d = distanceToEdges([x, y], room.polygon);
      if (d > bestDist) { bestDist = d; best = [x, y]; }
    }
  }
  return best;
}

/** 点から多角形の各辺までの最短距離 */
function distanceToEdges(point, polygon) {
  let min = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    min = Math.min(min, distanceToSegment(point, a, b));
  }
  return min;
}

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// ---------------------------------------------------------------------------
//  単位換算・表示
// ---------------------------------------------------------------------------

export const toTsubo = (m2) => m2 * meta.tsuboPerM2;
export const toJyo = (m2) => m2 * meta.jyoPerM2;

/** 12.6 → "12.60㎡" */
export const fmtM2 = (m2, digits = 2) => `${m2.toFixed(digits)}㎡`;
/** 12.6 → "3.81坪" */
export const fmtTsubo = (m2, digits = 2) => `${toTsubo(m2).toFixed(digits)}坪`;
/** 12.6 → "7.8畳" */
export const fmtJyo = (m2, digits = 1) => `${toJyo(m2).toFixed(digits)}畳`;

// ---------------------------------------------------------------------------
//  階の集計
// ---------------------------------------------------------------------------

/** その階の床面積（＝室の合計。吹抜・中庭は含まない） */
export function floorArea(floor) {
  return floor.rooms.reduce((sum, r) => sum + polygonArea(r.polygon), 0);
}

/** その階の吹抜・中庭の合計 */
export function voidArea(floor) {
  return (floor.voids ?? []).reduce((sum, v) => sum + polygonArea(v.polygon), 0);
}

/** 建築面積（外形） */
export function footprintArea() {
  return meta.footprint.w * meta.footprint.d;
}

/** 延床面積 */
export function totalFloorArea(floors) {
  return floors.reduce((sum, f) => sum + floorArea(f), 0);
}

/** 室・吹抜をまとめて引く（idで検索するとき用） */
export function allAreas(floor) {
  return [...floor.rooms, ...(floor.voids ?? [])];
}

export function findRoom(floors, floorId, roomId) {
  const floor = floors.find((f) => f.id === floorId);
  if (!floor) return null;
  return allAreas(floor).find((r) => r.id === roomId) ?? null;
}

export function findView(floors, viewId) {
  for (const floor of floors) {
    for (const room of allAreas(floor)) {
      const view = (room.views ?? []).find((v) => v.id === viewId);
      if (view) return { floor, room, view };
    }
  }
  return null;
}
