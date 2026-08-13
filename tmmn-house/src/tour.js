// ============================================================================
//  動線ツアー — 玄関から順に「見せ場」を巡る
// ============================================================================

import { floors, tour } from '../data/house.js';
import { findRoom } from './geometry.js';
import { renderView, escapeHtml } from './gallery.js';

/** ツアーの停留点を解決して { stop, floor, room, view } にする */
export function resolveStop(index) {
  const stop = tour[wrap(index)];
  if (!stop) return null;
  const floor = floors.find((f) => f.id === stop.floor);
  const room = findRoom(floors, stop.floor, stop.room);
  const view = (room?.views ?? []).find((v) => v.id === stop.view);
  return room && view ? { stop, floor, room, view, index: wrap(index) } : null;
}

export const tourLength = () => tour.length;
export const wrap = (i) => ((i % tour.length) + tour.length) % tour.length;

/**
 * ツアー画面。
 * @param {number} index
 * @param {(next:number)=>void} onGo  停留点を移動したいときに呼ぶ
 */
export function renderTour(index, onGo) {
  const wrapEl = document.createElement('div');
  wrapEl.className = 'tour';

  const current = resolveStop(index);
  if (!current) {
    wrapEl.textContent = 'ツアーの停留点が解決できませんでした。data/house.js の tour を確認してください。';
    return wrapEl;
  }

  const nav = document.createElement('div');
  nav.className = 'tour__nav';
  nav.innerHTML = `
    <button type="button" class="tour__btn" data-go="prev" aria-label="前へ">←</button>
    <span class="tour__counter">${current.index + 1} / ${tourLength()}</span>
    <button type="button" class="tour__btn" data-go="next" aria-label="次へ">→</button>
  `;
  nav.querySelector('[data-go="prev"]').addEventListener('click', () => onGo(wrap(index - 1)));
  nav.querySelector('[data-go="next"]').addEventListener('click', () => onGo(wrap(index + 1)));
  wrapEl.append(nav);

  const head = document.createElement('p');
  head.className = 'tour__where';
  head.innerHTML = `<strong>${escapeHtml(current.floor.name)}</strong> ／ ${escapeHtml(current.room.name)}`;
  wrapEl.append(head);

  wrapEl.append(renderView(current.view, current.room));

  // 順路の一覧（現在地をハイライト）
  const list = document.createElement('ol');
  list.className = 'tour__list';
  tour.forEach((stop, i) => {
    const resolved = resolveStop(i);
    if (!resolved) return;
    const li = document.createElement('li');
    li.className = `tour__stop${i === current.index ? ' is-current' : ''}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<span class="tour__stop-floor">${escapeHtml(resolved.floor.name)}</span>${escapeHtml(resolved.view.label)}`;
    btn.addEventListener('click', () => onGo(i));
    li.append(btn);
    list.append(li);
  });
  wrapEl.append(list);

  return wrapEl;
}
