// ============================================================================
//  内装ビジュアル — 写真があれば写真、なければトーンに沿ったプレースホルダ
// ============================================================================
//
//  画像の置き方は images/README.md を参照。
//  ファイル名は視点ID（view.id）と同じにするだけで、自動的に差し替わります。
//      images/<view.id>.jpg   例) images/doma-stair.jpg
//  読み込みに失敗したら（＝まだ置いていなければ）プレースホルダに戻ります。
// ============================================================================

import { materials } from '../data/house.js';

/** 画像を探す場所と拡張子。上から順に試す */
const IMAGE_DIR = './images';
const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

/**
 * 1つの視点のビジュアルを作る。
 * @param {object} view  room.views[n]
 * @param {object} room  その視点を持つ室
 */
export function renderView(view, room) {
  const figure = document.createElement('figure');
  figure.className = 'view';
  figure.dataset.view = view.id;

  const frame = document.createElement('div');
  frame.className = 'view-frame';
  frame.append(createPlaceholder(view, room));
  figure.append(frame);

  // 画像があれば差し替える（拡張子を順に試す）
  loadFirstAvailable(view.id).then((img) => {
    if (!img) return;
    img.alt = `${room.name} — ${view.label}`;
    img.className = 'view-photo';
    img.loading = 'lazy';
    frame.replaceChildren(img);
    figure.classList.add('has-photo');
  });

  const caption = document.createElement('figcaption');
  caption.className = 'view-caption';
  caption.innerHTML = `
    <span class="view-caption__label">${escapeHtml(view.label)}</span>
    <span class="view-caption__meta">${escapeHtml(room.name)} ／ 視線 ${dirName(view.dir)}${view.ref ? ` ／ 参考写真 ${view.ref}枚目` : ''}</span>
  `;
  // 同じ立ち位置・同じ向きで3Dに立つ
  const to3d = document.createElement('button');
  to3d.type = 'button';
  to3d.className = 'view-3d';
  to3d.textContent = '3Dでこの視点に立つ';
  to3d.addEventListener('click', () => window.__tmmnGotoView3d?.(view.id));
  caption.append(to3d);
  figure.append(caption);

  return figure;
}

/**
 * プレースホルダ。その部屋の仕上げ材の色から作るので、
 * 写真がなくてもトーンの見当がつく。
 */
function createPlaceholder(view, room) {
  const box = document.createElement('div');
  box.className = 'view-placeholder';

  const f = room.finishes ?? {};
  const ceiling = materials[f.ceiling]?.color ?? '#ded5c8';
  const wall = materials[f.wall]?.color ?? '#bdb5aa';
  const floorColor = materials[f.floor]?.color ?? '#b4aea6';

  // 天井 → 壁 → 床 の帯で、部屋の色調をそのまま出す
  box.style.background = `linear-gradient(
      to bottom,
      ${ceiling} 0%,
      ${wall} 42%,
      ${wall} 62%,
      ${floorColor} 100%)`;

  box.innerHTML = `
    <div class="view-placeholder__inner">
      <span class="view-placeholder__room">${escapeHtml(room.name)}</span>
      <span class="view-placeholder__label">${escapeHtml(view.label)}</span>
      <span class="view-placeholder__hint">画像未設定 — <code>images/${escapeHtml(view.id)}.jpg</code></span>
    </div>
  `;
  return box;
}

/** 拡張子を順に試して、最初に読めた画像を返す（なければ null） */
function loadFirstAvailable(id) {
  return EXTENSIONS.reduce(
    (chain, ext) => chain.then((found) => found ?? tryLoad(`${IMAGE_DIR}/${id}.${ext}`)),
    Promise.resolve(null),
  );
}

function tryLoad(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 0=北 90=東 … を日本語に */
export function dirName(deg) {
  const names = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東',
    '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return names[i];
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
