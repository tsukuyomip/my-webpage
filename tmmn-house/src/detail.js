// ============================================================================
//  部屋の詳細パネル
// ============================================================================

import { materials, designNotes } from '../data/house.js';
import { polygonArea, fmtM2, fmtTsubo, fmtJyo, boundingBox } from './geometry.js';
import { renderView, escapeHtml } from './gallery.js';

/**
 * 選択中の室の詳細を組み立てる。
 * @param {object} room            室（rooms または voids の要素）
 * @param {object} floor
 * @param {string|null} selectedViewId
 */
export function renderDetail(room, floor, selectedViewId = null) {
  const wrap = document.createElement('div');
  wrap.className = 'detail';

  const m2 = polygonArea(room.polygon);
  const { min, max } = boundingBox(room.polygon);
  const isVoid = (floor.voids ?? []).some((v) => v.id === room.id);

  // ── 見出し ──────────────────────────────────────────────
  const head = document.createElement('header');
  head.className = 'detail__head';
  head.innerHTML = `
    <p class="detail__floor">${escapeHtml(floor.name)}</p>
    <h2 class="detail__name">${escapeHtml(room.name)}</h2>
    <dl class="detail__figures">
      <div><dt>面積</dt><dd>${fmtM2(m2)}</dd></div>
      <div><dt>坪</dt><dd>${fmtTsubo(m2)}</dd></div>
      <div><dt>畳</dt><dd>${fmtJyo(m2)}</dd></div>
      <div><dt>外接寸法</dt><dd>${(max[0] - min[0]).toFixed(1)} × ${(max[1] - min[1]).toFixed(1)}m</dd></div>
    </dl>
    ${isVoid ? '<p class="detail__badge">床面積には算入しない区画（中庭・吹抜）</p>' : ''}
  `;
  wrap.append(head);

  // ── 仕上げ ──────────────────────────────────────────────
  if (room.finishes) {
    wrap.append(section('仕上げ', finishesTable(room.finishes)));
  }

  // ── 照明 ────────────────────────────────────────────────
  if (room.lighting) {
    const p = document.createElement('p');
    p.className = 'detail__text';
    p.textContent = room.lighting;
    wrap.append(section('照明', p));
  }

  // ── 特記事項 ────────────────────────────────────────────
  if (room.features?.length) {
    const ul = document.createElement('ul');
    ul.className = 'detail__list';
    for (const f of room.features) {
      const li = document.createElement('li');
      li.textContent = f;
      ul.append(li);
    }
    wrap.append(section('特記', ul));
  }

  // ── 内装ビジュアル ──────────────────────────────────────
  if (room.views?.length) {
    const gallery = document.createElement('div');
    gallery.className = 'detail__gallery';
    for (const view of room.views) {
      const fig = renderView(view, room);
      if (view.id === selectedViewId) fig.classList.add('is-selected');
      gallery.append(fig);
    }
    wrap.append(section(`内装（${room.views.length}カット）`, gallery));
  } else {
    const p = document.createElement('p');
    p.className = 'detail__text detail__text--muted';
    p.textContent = 'この室には参考写真の割り当てがありません。';
    wrap.append(section('内装', p));
  }

  return wrap;
}

function finishesTable(finishes) {
  const table = document.createElement('table');
  table.className = 'finishes';
  const rows = [
    ['床', finishes.floor],
    ['壁', finishes.wall],
    ['天井', finishes.ceiling],
  ];
  table.innerHTML = rows.map(([label, key]) => {
    const m = materials[key];
    if (!m) return '';
    return `<tr>
      <th>${label}</th>
      <td>
        <span class="swatch" style="--swatch:${m.color}"></span>
        <span class="finish-name">${escapeHtml(m.name)}</span>
        <span class="finish-tone finish-tone--${m.tone}">${toneLabel(m.tone)}</span>
      </td>
    </tr>`;
  }).join('');
  return table;
}

const toneLabel = (tone) => ({ base: '基調', accent: 'ダークアクセント', wet: '水回り' }[tone] ?? tone);

function section(title, content) {
  const s = document.createElement('section');
  s.className = 'detail__section';
  const h = document.createElement('h3');
  h.textContent = title;
  s.append(h, content);
  return s;
}

// ---------------------------------------------------------------------------
//  設計メモ（トーンの決め方と、参考写真との矛盾をどう解いたか）
// ---------------------------------------------------------------------------

export function renderDesignNotes() {
  const wrap = document.createElement('div');
  wrap.className = 'notes';

  wrap.innerHTML = `
    <section class="detail__section">
      <h3>${escapeHtml(designNotes.tone.title)}</h3>
      ${designNotes.tone.body.map((t) => `<p class="detail__text">${escapeHtml(t)}</p>`).join('')}
    </section>

    <section class="detail__section">
      <h3>参考写真との矛盾と、その解き方</h3>
      <ol class="resolved">
        ${designNotes.resolved.map((r) => `
          <li class="resolved__item">
            <p class="resolved__issue"><span class="resolved__tag">矛盾</span>${escapeHtml(r.issue)}</p>
            <p class="resolved__fix"><span class="resolved__tag resolved__tag--fix">解決</span>${escapeHtml(r.fix)}</p>
          </li>`).join('')}
      </ol>
    </section>

    <section class="detail__section">
      <h3>設計の前提</h3>
      <ul class="detail__list">
        ${designNotes.assumptions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
      </ul>
    </section>
  `;
  return wrap;
}
