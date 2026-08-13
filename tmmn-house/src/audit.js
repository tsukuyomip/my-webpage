// ============================================================================
//  検算 — データが自己矛盾していないことを毎回、実測で確かめる
// ============================================================================
//
//  ここが通っていれば、
//    ・図面と面積表がズレている
//    ・部屋どうしが重なっている／すき間が空いている
//    ・合計が建築面積と合わない
//  のいずれも起きていないと言えます。
//  ポリゴンを編集したら、画面の【検算】パネルが全部OKか見てください。
// ============================================================================

import { meta } from '../data/house.js';
import {
  polygonArea, pointInPolygon, floorArea, voidArea, footprintArea,
} from './geometry.js';

/** 被覆・重複を実測するときの格子の刻み（m）。細かいほど厳密だが重くなる */
const SAMPLE_STEP = 0.1;
/** 面積の一致とみなす許容差（㎡）。浮動小数の丸め対策 */
const TOLERANCE = 0.005;

/**
 * 1フロア分の検査。
 * @returns {{checks: Array, ok: boolean}}
 */
export function auditFloor(floor) {
  const checks = [];

  const rooms = floor.rooms;
  const voids = floor.voids ?? [];
  const areas = [...rooms, ...voids];

  const roomSum = floorArea(floor);
  const voidSum = voidArea(floor);
  const footprint = footprintArea();

  // (1) 室 + 吹抜 = 建築面積
  checks.push({
    label: '室の合計 ＋ 吹抜・中庭 ＝ 建築面積',
    detail: `${roomSum.toFixed(2)} ＋ ${voidSum.toFixed(2)} ＝ ${(roomSum + voidSum).toFixed(2)}㎡ / 建築面積 ${footprint.toFixed(2)}㎡`,
    ok: Math.abs(roomSum + voidSum - footprint) <= TOLERANCE,
  });

  // (2) すべてのポリゴンが建物外形の中に納まっているか
  const outOfBounds = areas.filter((a) =>
    a.polygon.some(([x, y]) =>
      x < -TOLERANCE || y < -TOLERANCE
      || x > meta.footprint.w + TOLERANCE || y > meta.footprint.d + TOLERANCE));
  checks.push({
    label: '全ポリゴンが建物外形の内側',
    detail: outOfBounds.length === 0
      ? `${areas.length}区画すべて 0〜${meta.footprint.w}m の範囲内`
      : `はみ出し: ${outOfBounds.map((a) => a.name).join(' / ')}`,
    ok: outOfBounds.length === 0,
  });

  // (3) 格子サンプリングによる被覆率と重複の実測
  const coverage = measureCoverage(areas);
  checks.push({
    label: '重なりがない',
    detail: coverage.overlap === 0
      ? '重複サンプル 0点'
      : `重複 ${coverage.overlap}点（約${(coverage.overlap * SAMPLE_STEP ** 2).toFixed(2)}㎡）: ${coverage.overlapNames.join(' / ')}`,
    ok: coverage.overlap === 0,
  });
  checks.push({
    label: 'すき間がない（被覆率100%）',
    detail: coverage.gap === 0
      ? `被覆率 ${(coverage.rate * 100).toFixed(2)}%`
      : `未被覆 ${coverage.gap}点（約${(coverage.gap * SAMPLE_STEP ** 2).toFixed(2)}㎡） / 被覆率 ${(coverage.rate * 100).toFixed(2)}%`,
    ok: coverage.gap === 0,
  });

  // (4) IDの重複
  const ids = areas.map((a) => a.id);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  checks.push({
    label: 'IDが重複していない',
    detail: dupIds.length === 0 ? `${ids.length}件すべて一意` : `重複: ${[...new Set(dupIds)].join(', ')}`,
    ok: dupIds.length === 0,
  });

  // (5) 視点マーカーが、その部屋の内側に置かれているか
  const strayViews = [];
  for (const area of areas) {
    for (const view of area.views ?? []) {
      if (!pointInPolygon(view.at, area.polygon)) {
        strayViews.push(`${area.name} / ${view.id}`);
      }
    }
  }
  checks.push({
    label: '視点マーカーが室内にある',
    detail: strayViews.length === 0 ? 'すべて室内' : `室外: ${strayViews.join(' / ')}`,
    ok: strayViews.length === 0,
  });

  return { checks, ok: checks.every((c) => c.ok), roomSum, voidSum, footprint };
}

/**
 * 建物外形を格子で刻み、各点が何区画に覆われているかを数える。
 * 0 → すき間 / 2以上 → 重なり
 */
function measureCoverage(areas) {
  let covered = 0;
  let gap = 0;
  let overlap = 0;
  let total = 0;
  const overlapNames = new Set();

  const half = SAMPLE_STEP / 2;
  for (let x = half; x < meta.footprint.w; x += SAMPLE_STEP) {
    for (let y = half; y < meta.footprint.d; y += SAMPLE_STEP) {
      total++;
      const hits = areas.filter((a) => pointInPolygon([x, y], a.polygon));
      if (hits.length === 0) gap++;
      else {
        covered++;
        if (hits.length > 1) {
          overlap++;
          if (overlapNames.size < 6) overlapNames.add(hits.map((h) => h.name).join('×'));
        }
      }
    }
  }
  return { covered, gap, overlap, total, rate: total ? covered / total : 0, overlapNames: [...overlapNames] };
}

/**
 * 階をまたぐ検査。
 * 上階の吹抜は、その真下が「ひとつの空間」でなければなりません。
 * （複数の室にまたがっていると、下に対応する部屋がない“浮いた吹抜”になる）
 * この矛盾は各階だけを見ていても見つからないので、ここで別に見ます。
 */
export function auditCrossFloor(floors) {
  const checks = [];

  for (let n = 1; n < floors.length; n++) {
    const upper = floors[n];
    const lower = floors[n - 1];
    const lowerAreas = [...lower.rooms, ...(lower.voids ?? [])];

    for (const v of upper.voids ?? []) {
      const below = new Set();
      const half = SAMPLE_STEP / 2;
      const { min, max } = polygonBounds(v.polygon);
      for (let x = min[0] + half; x < max[0]; x += SAMPLE_STEP) {
        for (let y = min[1] + half; y < max[1]; y += SAMPLE_STEP) {
          if (!pointInPolygon([x, y], v.polygon)) continue;
          const hit = lowerAreas.find((a) => pointInPolygon([x, y], a.polygon));
          below.add(hit ? hit.name : '（建物の外）');
        }
      }
      const names = [...below];
      checks.push({
        label: `${upper.name} ${v.name} の真下`,
        detail: names.length === 1
          ? `${lower.name} の「${names[0]}」だけに対応`
          : `${names.length}つの空間にまたがっている: ${names.join(' / ')}`,
        ok: names.length === 1,
      });
    }
  }

  return { checks, ok: checks.every((c) => c.ok) };
}

function polygonBounds(polygon) {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

/** 全階分の検査＋階またぎ＋延床の整合 */
export function auditAll(floors) {
  const perFloor = floors.map((f) => ({ floor: f, result: auditFloor(f) }));
  const cross = auditCrossFloor(floors);
  const total = perFloor.reduce((sum, p) => sum + p.result.roomSum, 0);
  return {
    perFloor,
    cross,
    total,
    ok: perFloor.every((p) => p.result.ok) && cross.ok,
  };
}
