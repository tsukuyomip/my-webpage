// 画面上の UI: モード切り替え・列車追加・undo/clear・追尾・トースト
import type { Mode } from './controls'
import type { TrainKind } from './trains'

export interface UICallbacks {
  onMode(m: Mode): void
  onUndo(): void
  onClear(): void
  onAddTrain(kind: TrainKind): void
  onFollow(): void
}

export interface UI {
  setMode(m: Mode): void
  setFollowLabel(text: string): void
  toast(msg: string): void
  hideIntro(): void
  showIntro(): void
}

export function createUI(root: HTMLElement, cb: UICallbacks): UI {
  const el = document.createElement('div')
  el.id = 'ui'
  el.innerHTML = `
    <div id="hint"></div>
    <div id="intro">
      <div class="intro-card">
        <div class="intro-emoji">🚄</div>
        <h1>おえかきトレイン</h1>
        <p>指で線路を描くと、電車が走り出すよ。<br>線を交差させるとポイント（分岐）になる！</p>
      </div>
    </div>
    <div id="toast"></div>
    <div id="toolbar">
      <button id="btn-undo" title="ひとつ戻す">↩️</button>
      <button id="btn-clear" title="全部消す">🗑️</button>
      <button id="btn-mode" class="primary"></button>
      <button id="btn-shinkansen" title="新幹線を追加">🚄</button>
      <button id="btn-commuter" title="電車を追加">🚃</button>
      <button id="btn-steam" title="SLを追加">🚂</button>
      <button id="btn-follow" title="電車を追いかける">🎥</button>
    </div>
    <div id="build">build ${__BUILD_INFO__}</div>
  `
  root.appendChild(el)

  const $ = (id: string) => el.querySelector<HTMLElement>(`#${id}`)!
  const hint = $('hint')
  const intro = $('intro')
  const toastEl = $('toast')
  const modeBtn = $('btn-mode')
  const followBtn = $('btn-follow')

  let mode: Mode = 'draw'
  let toastTimer = 0

  const applyMode = () => {
    modeBtn.textContent = mode === 'draw' ? '✏️ 描く' : '🎥 見る'
    document.body.dataset.mode = mode
    hint.textContent =
      mode === 'draw'
        ? '1本指でなぞって線路を描こう（2本指で移動・ズーム）'
        : 'ドラッグでぐるっと回転・ピンチでズーム'
    followBtn.style.display = mode === 'view' ? '' : 'none'
  }
  applyMode()

  modeBtn.addEventListener('click', () => {
    mode = mode === 'draw' ? 'view' : 'draw'
    applyMode()
    cb.onMode(mode)
  })
  $('btn-undo').addEventListener('click', () => cb.onUndo())
  $('btn-clear').addEventListener('click', () => cb.onClear())
  $('btn-shinkansen').addEventListener('click', () => cb.onAddTrain('shinkansen'))
  $('btn-commuter').addEventListener('click', () => cb.onAddTrain('commuter'))
  $('btn-steam').addEventListener('click', () => cb.onAddTrain('steam'))
  followBtn.addEventListener('click', () => cb.onFollow())

  return {
    setMode(m) {
      mode = m
      applyMode()
    },
    setFollowLabel(text) {
      followBtn.textContent = text || '🎥'
      followBtn.classList.toggle('active', !!text)
    },
    toast(msg) {
      toastEl.textContent = msg
      toastEl.classList.add('show')
      clearTimeout(toastTimer)
      toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2200)
    },
    hideIntro() {
      intro.classList.add('hidden')
    },
    showIntro() {
      intro.classList.remove('hidden')
    },
  }
}
