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
  mode: 'plan',    // 'plan' | '3d'
  tab: 'room',     // 'room' | 'tour' | 'notes' | 'audit'
  tourIndex: 0,
};

/** 3Dウォークスルー（初めて開いたときだけ読み込む） */
let walkthrough = null;
let walkthroughLoading = false;

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
//  起動
// ---------------------------------------------------------------------------
function init() {
  renderSummary();
  renderFloorTabs();
  renderModeTabs();
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

function renderModeTabs() {
  const nav = $('#mode-tabs');
  nav.innerHTML = `
    <button type="button" role="tab" data-mode="plan">平面図</button>
    <button type="button" role="tab" data-mode="3d">3Dウォークスルー</button>
  `;
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (btn) setMode(btn.dataset.mode);
  });

  $('#three-start').addEventListener('click', () => startWalkthrough());
  // 画面に触れた／クリックした時点で、案内オーバーレイは引っ込める
  $('#three-host').addEventListener('pointerdown', () => {
    $('#three-start').hidden = true;
    if (!isTouchDevice()) walkthrough?.walker.requestLock();
  });
  $('#hud-jump').addEventListener('change', (e) => {
    if (e.target.value) gotoView3d(e.target.value);
  });
}

/** 指で操作する端末か（マウスが無い端末ではポインタロックを使わない） */
function isTouchDevice() {
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

function setMode(mode) {
  state.mode = mode;
  const is3d = mode === '3d';
  $('#plan-host').hidden = is3d;
  $('#legend').hidden = is3d;
  $('#room-list').hidden = is3d;
  $('#three-wrap').hidden = !is3d;
  $('.pane__hint').textContent = is3d
    ? (isTouchDevice()
      ? '画面の左半分をなぞると移動、右半分をなぞると視線が動きます。上の「視点へ移動」で見どころに飛べます。'
      : 'クリックで視点操作を開始。WASD／矢印で移動、Shiftで速歩き、Escで解除。')
    : '平面図の部屋をタップすると詳細が開きます。▲ は視点マーカー（その向きに見た内装写真）です。';

  if (is3d) {
    ensureWalkthrough();
  } else if (walkthrough) {
    walkthrough.stop();
  }
  render();
}

/** three.js とモデルの読み込みは、3Dを開いた時点で初めて行う */
async function ensureWalkthrough() {
  if (walkthrough || walkthroughLoading) { walkthrough?.resize(); return; }
  walkthroughLoading = true;
  $('#three-loading').hidden = false;
  $('#three-start').hidden = true;
  try {
    const { Walkthrough } = await import('./src/three/scene.js');
    // 組み立ては重いので、ローディング表示を1フレーム描かせてから走らせる
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    walkthrough = new Walkthrough($('#three-host'));
    window.__tmmnWalk = walkthrough;   // 動作確認用
    walkthrough.onFrame = updateHud;
    // ポインタロックが解けたら、また案内を出す（マウス操作の端末だけ）
    walkthrough.walker.onLockChange = (locked) => {
      $('#three-start').hidden = locked || isTouchDevice();
    };
    setupHelp();
    fillJumpList();
    walkthrough.resize();
    walkthrough.start();
    if (state.viewId) walkthrough.gotoView(state.viewId);
    else walkthrough.gotoFloor(state.floorId);
  } catch (err) {
    $('#three-loading').textContent = `3Dの読み込みに失敗しました: ${err.message}`;
    return;
  } finally {
    walkthroughLoading = false;
    $('#three-loading').hidden = true;
    // 指で操作する端末では、中央の大きな案内は出さない
    $('#three-start').hidden = isTouchDevice();
  }
  updateHud();
}

function startWalkthrough() {
  if (!walkthrough) { ensureWalkthrough(); return; }
  walkthrough.start();
  $('#three-start').hidden = true;
  if (!isTouchDevice()) walkthrough.walker.requestLock();
}

/**
 * 操作案内。指で操作する端末では、画面中央の大きなボタンは出さず
 * （タップしても解除する相手がいないので出しっぱなしになる）、
 * 上端の一行だけにする。
 */
function setupHelp() {
  const touch = isTouchDevice();
  $('#hud-help').textContent = touch
    ? '左半分をなぞる＝移動／右半分をなぞる＝視線'
    : 'クリックで視点操作 ／ WASD・矢印で移動 ／ Shiftで速歩き ／ Escで解除';
  $('#three-start').hidden = touch;
  $('.three-start__desc').textContent = 'クリックすると視点操作が始まります';
}

function fillJumpList() {
  const opts = ['<option value="">視点へ移動…</option>'];
  for (const floor of floors) {
    const views = allAreas(floor).flatMap((a) => (a.views ?? []).map((v) => ({ a, v })));
    if (!views.length) continue;
    opts.push(`<optgroup label="${escapeHtml(floor.name)}">`);
    for (const { a, v } of views) {
      opts.push(`<option value="${escapeHtml(v.id)}">${escapeHtml(a.name)} — ${escapeHtml(v.label)}</option>`);
    }
    opts.push('</optgroup>');
  }
  $('#hud-jump').innerHTML = opts.join('');
}

let hudFloorCache = null;
function updateHud() {
  if (!walkthrough) return;
  const id = walkthrough.currentFloorId;
  if (id === hudFloorCache) return;
  hudFloorCache = id;
  const floor = floors.find((f) => f.id === id);
  $('#hud-floor').textContent = floor ? `${floor.name} を歩いています` : '';
  // 平面図側の階も合わせておく
  if (floor && state.floorId !== floor.id) {
    state.floorId = floor.id;
    writeHash();
  }
}

/** 詳細パネルの「3Dでこの視点に立つ」から呼ばれる */
export function gotoView3d(viewId) {
  state.viewId = viewId;
  if (state.mode !== '3d') setMode('3d');
  const go = () => walkthrough?.gotoView(viewId);
  if (walkthrough) { go(); walkthrough.start(); } else { ensureWalkthrough().then(go); }
}
window.__tmmnGotoView3d = gotoView3d;

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
  if (state.mode === '3d') walkthrough?.gotoView(viewId);
}

function goTour(index) {
  const stop = resolveStop(index);
  if (!stop) return;
  if (state.mode === '3d') walkthrough?.gotoView(stop.view.id);
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

  for (const btn of document.querySelectorAll('#mode-tabs [data-mode]')) {
    const on = btn.dataset.mode === state.mode;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', String(on));
  }

  // 平面図（3Dモードのときは組み直さない）
  const planHost = $('#plan-host');
  if (state.mode === '3d') { renderRoomList(floor); renderPanel(floor, room); return; }
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

  renderPanel(floor, room);
  renderRoomList(floor);
}

function renderPanel(floor, room) {
  const panel = $('#panel');
  if (state.tab === 'room') panel.replaceChildren(renderDetail(room, floor, state.viewId));
  else if (state.tab === 'tour') panel.replaceChildren(renderTour(state.tourIndex, goTour));
  else if (state.tab === 'notes') panel.replaceChildren(renderDesignNotes());
  else panel.replaceChildren(renderAudit());
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

  // 階またぎの検査
  if (result.cross?.checks?.length) {
    const cs = document.createElement('section');
    cs.className = 'detail__section';
    cs.innerHTML = `
      <h3>階またぎ
        <span class="audit__pill ${result.cross.ok ? 'is-ok' : 'is-ng'}">${result.cross.ok ? 'OK' : 'NG'}</span>
      </h3>
      <table class="audit__table">
        <tbody>
          ${result.cross.checks.map((c) => `
            <tr class="${c.ok ? 'is-ok' : 'is-ng'}">
              <td class="audit__mark">${c.ok ? '✓' : '×'}</td>
              <td class="audit__label">${escapeHtml(c.label)}</td>
              <td class="audit__detail">${escapeHtml(c.detail)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
    wrapEl.append(cs);
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
