// ============================================================================
//  TMMN HOUSE — エントリポイント
//    状態は state ひとつ。URLハッシュ #/<階>/<室>[/<視点>] と同期します。
// ============================================================================

import { meta, floors, zones } from './data/house.js';
import {
  polygonArea, floorArea, voidArea, footprintArea, totalFloorArea,
  fmtM2, fmtTsubo, findRoom, findView, allAreas,
} from './src/geometry.js';
import { renderPlan } from './src/plan.js';
import { renderDetail, renderDesignNotes } from './src/detail.js';
import { auditAll } from './src/audit.js';
import { renderTour, resolveStop, tourLength, wrap as wrapIndex } from './src/tour.js';
import { escapeHtml } from './src/gallery.js';

// ---------------------------------------------------------------------------
//  状態
// ---------------------------------------------------------------------------
const state = {
  floorId: '1f',
  roomId: 'doma',
  viewId: null,
  tab: 'room',     // 'room' | 'tour' | 'notes' | 'audit'
  tourIndex: 0,
};

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
//  起動
// ---------------------------------------------------------------------------
function init() {
  renderSummary();
  renderFloorTabs();
  renderTabs();
  renderLegend();
  applyHash();
  window.addEventListener('hashchange', () => { applyHash(); render(); });
  render();
}

// ---------------------------------------------------------------------------
//  ヘッダーの数値（すべてポリゴンから計算した値）
// ---------------------------------------------------------------------------
function renderSummary() {
  $('#title').textContent = meta.title;
  $('#subtitle').textContent = meta.subtitle;

  const footprint = footprintArea();
  const total = totalFloorArea(floors);
  const items = [
    ['建築面積', footprint],
    ...floors.map((f) => [`${f.name}床面積`, floorArea(f)]),
    ['延床面積', total],
  ];

  $('#summary').innerHTML = items.map(([label, m2]) => `
    <div class="summary__item">
      <dt>${escapeHtml(label)}</dt>
      <dd><strong>${fmtM2(m2)}</strong><span>${fmtTsubo(m2)}</span></dd>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
//  階の切り替え
// ---------------------------------------------------------------------------
function renderFloorTabs() {
  const nav = $('#floor-tabs');
  nav.innerHTML = floors.map((f) => `
    <button type="button" role="tab" data-floor="${f.id}">${escapeHtml(f.name)}</button>
  `).join('');
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-floor]');
    if (!btn) return;
    const floor = floors.find((f) => f.id === btn.dataset.floor);
    // 階を変えたら、その階の最初の室を選んでおく
    selectRoom(floor.id, floor.rooms[0].id, null);
  });
}

function renderTabs() {
  const nav = $('#panel-tabs');
  const tabs = [['room', '部屋'], ['tour', '動線ツアー'], ['notes', '設計メモ'], ['audit', '検算']];
  nav.innerHTML = tabs.map(([id, label]) => `
    <button type="button" role="tab" data-tab="${id}">${escapeHtml(label)}</button>
  `).join('');
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    render();
  });
}

function renderLegend() {
  $('#legend').innerHTML = Object.entries(zones).map(([id, z]) => `
    <li class="legend__item"><span class="legend__chip legend__chip--${id}"></span>${escapeHtml(z.name)}</li>
  `).join('');
}

// ---------------------------------------------------------------------------
//  選択
// ---------------------------------------------------------------------------
function selectRoom(floorId, roomId, viewId = null) {
  state.floorId = floorId;
  state.roomId = roomId;
  state.viewId = viewId;
  state.tab = 'room';
  writeHash();
  render();
}

function selectView(viewId, roomId) {
  state.roomId = roomId;
  state.viewId = viewId;
  state.tab = 'room';
  writeHash();
  render();
}

function goTour(index) {
  const stop = resolveStop(index);
  if (!stop) return;
  state.tourIndex = wrapIndex(index);
  state.floorId = stop.floor.id;
  state.roomId = stop.room.id;
  state.viewId = stop.view.id;
  state.tab = 'tour';
  writeHash();
  render();
}

// ---------------------------------------------------------------------------
//  URLハッシュ  #/1f/doma/doma-stair
// ---------------------------------------------------------------------------
function writeHash() {
  const parts = ['', state.floorId, state.roomId];
  if (state.viewId) parts.push(state.viewId);
  const next = `#${parts.join('/')}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

function applyHash() {
  const [, floorId, roomId, viewId] = location.hash.replace(/^#/, '').split('/');
  const floor = floors.find((f) => f.id === floorId);
  if (!floor) return;
  state.floorId = floor.id;
  if (roomId && findRoom(floors, floor.id, roomId)) state.roomId = roomId;
  state.viewId = viewId && findView(floors, viewId) ? viewId : null;
}

// ---------------------------------------------------------------------------
//  描画
// ---------------------------------------------------------------------------
function render() {
  const floor = floors.find((f) => f.id === state.floorId) ?? floors[0];
  let room = findRoom(floors, floor.id, state.roomId);
  if (!room) {
    room = floor.rooms[0];
    state.roomId = room.id;
  }

  // 平面図
  const planHost = $('#plan-host');
  planHost.replaceChildren(renderPlan(floor, {
    selectedRoomId: state.roomId,
    selectedViewId: state.viewId,
    onSelectRoom: (id) => selectRoom(floor.id, id, null),
    onSelectView: (viewId, roomId) => selectView(viewId, roomId),
  }));

  // 階タブ・パネルタブの状態
  for (const btn of document.querySelectorAll('#floor-tabs [data-floor]')) {
    const on = btn.dataset.floor === floor.id;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', String(on));
  }
  for (const btn of document.querySelectorAll('#panel-tabs [data-tab]')) {
    const on = btn.dataset.tab === state.tab;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', String(on));
  }

  // パネル
  const panel = $('#panel');
  if (state.tab === 'room') panel.replaceChildren(renderDetail(room, floor, state.viewId));
  else if (state.tab === 'tour') panel.replaceChildren(renderTour(state.tourIndex, goTour));
  else if (state.tab === 'notes') panel.replaceChildren(renderDesignNotes());
  else panel.replaceChildren(renderAudit());

  // 室の一覧
  renderRoomList(floor);
}

function renderRoomList(floor) {
  const host = $('#room-list');
  const areas = allAreas(floor)
    .map((a) => ({ area: a, m2: polygonArea(a.polygon) }))
    .sort((a, b) => b.m2 - a.m2);

  host.innerHTML = areas.map(({ area, m2 }) => `
    <li>
      <button type="button" data-room="${escapeHtml(area.id)}"
              class="room-chip room-chip--${escapeHtml(area.zone)}${area.id === state.roomId ? ' is-active' : ''}">
        <span class="room-chip__name">${escapeHtml(area.name)}</span>
        <span class="room-chip__area">${fmtM2(m2)}</span>
      </button>
    </li>
  `).join('');

  host.onclick = (e) => {
    const btn = e.target.closest('[data-room]');
    if (btn) selectRoom(floor.id, btn.dataset.room, null);
  };
}

// ---------------------------------------------------------------------------
//  検算パネル
// ---------------------------------------------------------------------------
function renderAudit() {
  const wrapEl = document.createElement('div');
  wrapEl.className = 'audit';

  const result = auditAll(floors);

  const banner = document.createElement('p');
  banner.className = `audit__banner ${result.ok ? 'is-ok' : 'is-ng'}`;
  banner.textContent = result.ok
    ? 'すべての検査を通過しています。図面・面積表・合計に矛盾はありません。'
    : '矛盾が見つかりました。下の NG 項目を確認してください。';
  wrapEl.append(banner);

  const intro = document.createElement('p');
  intro.className = 'detail__text detail__text--muted';
  intro.textContent = 'data/house.js のポリゴンを編集したら、ここが全部 OK になっていることを確認してください。'
    + '被覆率と重複は、建物外形を10cm刻みの格子で実測しています。';
  wrapEl.append(intro);

  for (const { floor, result: r } of result.perFloor) {
    const sec = document.createElement('section');
    sec.className = 'detail__section';
    sec.innerHTML = `
      <h3>${escapeHtml(floor.name)}
        <span class="audit__pill ${r.ok ? 'is-ok' : 'is-ng'}">${r.ok ? 'OK' : 'NG'}</span>
      </h3>
      <table class="audit__table">
        <tbody>
          ${r.checks.map((c) => `
            <tr class="${c.ok ? 'is-ok' : 'is-ng'}">
              <td class="audit__mark">${c.ok ? '✓' : '×'}</td>
              <td class="audit__label">${escapeHtml(c.label)}</td>
              <td class="audit__detail">${escapeHtml(c.detail)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
    wrapEl.append(sec);
  }

  // 全体の集計
  const sec = document.createElement('section');
  sec.className = 'detail__section';
  const rows = [
    ['建築面積（外形 ' + meta.footprint.w.toFixed(1) + 'm × ' + meta.footprint.d.toFixed(1) + 'm）', footprintArea()],
    ...floors.map((f) => [`${f.name} 床面積（吹抜・中庭を除く）`, floorArea(f)]),
    ...floors.map((f) => [`${f.name} 吹抜・中庭`, voidArea(f)]),
    ['延床面積', totalFloorArea(floors)],
  ];
  sec.innerHTML = `
    <h3>集計</h3>
    <table class="audit__table audit__table--totals">
      <tbody>
        ${rows.map(([label, m2]) => `
          <tr><td>${escapeHtml(label)}</td><td class="num">${fmtM2(m2)}</td><td class="num">${fmtTsubo(m2)}</td></tr>
        `).join('')}
      </tbody>
    </table>
  `;
  wrapEl.append(sec);

  return wrapEl;
}

// ---------------------------------------------------------------------------
//  キーボード：← → でツアーを送る
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (state.tab !== 'tour') return;
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'ArrowLeft') goTour(state.tourIndex - 1);
  if (e.key === 'ArrowRight') goTour(state.tourIndex + 1);
});

init();

// ツアーのカウンタはUIからも参照するので公開しておく（デバッグ用）
window.__tmmn = { state, floors, tourLength };
