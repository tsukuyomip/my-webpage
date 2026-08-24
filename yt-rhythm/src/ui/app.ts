import { createEmptyChart, parseChart } from '../core/chart.ts'
import { clearDraft, loadDraft } from '../core/draft.ts'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../core/settings.ts'
import type { Chart } from '../core/types.ts'
import { EditScreen } from '../modes/edit.ts'
import { PlayScreen } from '../modes/play.ts'
import { extractVideoId } from '../yt/player.ts'
import { button, clear, h, pickFile, toast } from './dom.ts'

declare const __BUILD_INFO__: string

interface Screen {
  root: HTMLElement
  destroy(): void
}

export class App {
  private settings: Settings
  private current: Screen | null = null

  constructor(private readonly host: HTMLElement) {
    this.settings = loadSettings()
  }

  start(): void {
    this.showHome()
  }

  private mount(screen: Screen): void {
    this.current?.destroy()
    this.current = screen
    clear(this.host)
    this.host.appendChild(screen.root)
  }

  private mountStatic(root: HTMLElement): void {
    this.mount({ root, destroy: () => root.remove() })
  }

  // ---------- ホーム ----------

  private showHome(): void {
    const draft = loadDraft()
    const page = h('div', { class: 'screen screen-menu' }, [
      h('div', { class: 'menu-inner' }, [
        h('h1', { class: 'app-title', text: '🎯 YT Rhythm' }),
        h('p', {
          class: 'muted',
          text: 'YouTube の動画の上に置いたノーツをタップして遊ぶ音ゲー。譜面は自分で作れて、JSON で持ち運べます。',
        }),
        h('div', { class: 'menu-buttons' }, [
          button('▶ プレイモード', () => this.showPlaySetup(), 'btn btn-primary btn-big'),
          button('✎ クリエイトモード', () => this.showEditSetup(), 'btn btn-big'),
        ]),
        draft
          ? h('p', { class: 'muted small' }, [
              `編集中の譜面「${draft.chart.meta.title}」が保存されています。`,
            ])
          : null,
        this.buildSettingsPanel(),
        h('p', { class: 'muted small', text: `build ${__BUILD_INFO__}` }),
      ]),
    ])
    this.mountStatic(page)
  }

  private buildSettingsPanel(): HTMLElement {
    const rows: HTMLElement[] = []

    const addSlider = (
      label: string,
      value: number,
      min: number,
      max: number,
      step: number,
      format: (v: number) => string,
      apply: (v: number) => void,
    ) => {
      const readout = h('span', { class: 'slider-value', text: format(value) })
      const input = h('input', {
        class: 'slider',
        attrs: { type: 'range', min: String(min), max: String(max), step: String(step) },
        on: {
          input: () => {
            const v = Number(input.value)
            readout.textContent = format(v)
            apply(v)
            saveSettings(this.settings)
          },
        },
      })
      input.value = String(value)
      rows.push(h('div', { class: 'settings-row' }, [h('span', { text: label }), input, readout]))
    }

    addSlider(
      '判定オフセット',
      this.settings.offsetMs,
      -300,
      300,
      5,
      (v) => `${v > 0 ? '+' : ''}${v} ms`,
      (v) => {
        this.settings.offsetMs = v
      },
    )
    addSlider(
      'ノーツ速度',
      this.settings.approachMs,
      400,
      2400,
      50,
      (v) => `${v} ms`,
      (v) => {
        this.settings.approachMs = v
      },
    )
    addSlider(
      'ノーツの大きさ',
      this.settings.noteScale,
      0.6,
      1.8,
      0.05,
      (v) => `${v.toFixed(2)}x`,
      (v) => {
        this.settings.noteScale = v
      },
    )

    return h('details', { class: 'settings' }, [
      h('summary', { text: '⚙ 設定' }),
      ...rows,
      h('p', {
        class: 'muted small',
        text: '「遅い」と判定されがちなら判定オフセットを + に、「早い」なら − にします。端末ごとに一度合わせれば以降は共通で使われます。',
      }),
      button(
        '設定を初期値に戻す',
        () => {
          this.settings = { ...DEFAULT_SETTINGS }
          saveSettings(this.settings)
          this.showHome()
        },
        'btn btn-small btn-ghost',
      ),
    ])
  }

  // ---------- プレイ ----------

  private showPlaySetup(): void {
    const info = h('div', { class: 'chart-info muted', text: 'まだ譜面が読み込まれていません。' })
    let chart: Chart | null = null
    const startBtn = button('▶ この譜面で遊ぶ', () => {
      if (chart) this.startPlay(chart)
    }, 'btn btn-primary btn-big')
    startBtn.disabled = true

    const setChart = (next: Chart, warnings: string[]) => {
      chart = next
      startBtn.disabled = false
      info.classList.remove('muted')
      info.replaceChildren(
        h('strong', { text: next.meta.title }),
        h('div', {
          class: 'small',
          text: `${next.notes.length} ノーツ${next.meta.difficulty ? ` ・ ${next.meta.difficulty}` : ''}${
            next.meta.author ? ` ・ 作: ${next.meta.author}` : ''
          }`,
        }),
        h('div', { class: 'small muted', text: `video: ${next.meta.videoId}` }),
      )
      warnings.forEach((w) => toast(w, 'error'))
    }

    const readFile = async (file: File) => {
      try {
        const { chart: parsed, warnings } = parseChart(await file.text())
        setChart(parsed, warnings)
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
      }
    }

    const drop = h('div', { class: 'dropzone' }, [
      h('p', { text: '譜面 JSON をここにドロップ' }),
      button('ファイルを選ぶ', async () => {
        const file = await pickFile('.json,application/json')
        if (file) await readFile(file)
      }, 'btn'),
    ])
    drop.addEventListener('dragover', (e) => {
      e.preventDefault()
      drop.classList.add('dragover')
    })
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'))
    drop.addEventListener('drop', (e) => {
      e.preventDefault()
      drop.classList.remove('dragover')
      const file = e.dataTransfer?.files?.[0]
      if (file) void readFile(file)
    })

    const draft = loadDraft()
    const page = h('div', { class: 'screen screen-menu' }, [
      h('div', { class: 'menu-inner' }, [
        h('div', { class: 'menu-head' }, [
          button('◀', () => this.showHome(), 'icon-btn'),
          h('h2', { text: 'プレイする譜面を選ぶ' }),
        ]),
        drop,
        draft
          ? button(
              `編集中の譜面で遊ぶ（${draft.chart.meta.title}）`,
              () => setChart(draft.chart, []),
              'btn btn-ghost',
            )
          : null,
        info,
        startBtn,
      ]),
    ])
    this.mountStatic(page)
  }

  private startPlay(chart: Chart, backTo?: () => void): void {
    const screen = new PlayScreen({
      chart,
      settings: this.settings,
      backToEditLabel: backTo ? '編集に戻る' : undefined,
      onExit: () => (backTo ? backTo() : this.showPlaySetup()),
    })
    this.mount(screen)
    void screen.start()
  }

  // ---------- クリエイト ----------

  private showEditSetup(): void {
    const urlInput = h('input', {
      class: 'text-input wide',
      attrs: {
        type: 'text',
        placeholder: 'https://www.youtube.com/watch?v=...',
        inputmode: 'url',
        autocapitalize: 'off',
        autocomplete: 'off',
        spellcheck: false,
      },
    })

    const createNew = () => {
      const videoId = extractVideoId(urlInput.value)
      if (!videoId) {
        toast('YouTube の URL または動画 ID を入れてください。', 'error')
        return
      }
      this.startEdit(createEmptyChart(videoId))
    }

    const openFile = async () => {
      const file = await pickFile('.json,application/json')
      if (!file) return
      try {
        const { chart, warnings } = parseChart(await file.text())
        warnings.forEach((w) => toast(w, 'error'))
        this.startEdit(chart)
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
      }
    }

    const draft = loadDraft()
    const page = h('div', { class: 'screen screen-menu' }, [
      h('div', { class: 'menu-inner' }, [
        h('div', { class: 'menu-head' }, [
          button('◀', () => this.showHome(), 'icon-btn'),
          h('h2', { text: 'クリエイトモード' }),
        ]),
        h('p', { class: 'muted small', text: '動画を指定して新しく作るか、既存の譜面を読み込んで続きから編集します。' }),
        h('div', { class: 'field' }, [
          h('label', { class: 'small', text: 'YouTube URL / 動画 ID' }),
          urlInput,
          button('＋ 新しく作る', createNew, 'btn btn-primary'),
        ]),
        button('⬆ 譜面ファイルを開く', () => void openFile(), 'btn'),
        draft
          ? h('div', { class: 'field' }, [
              button(
                `前回の続きから（${draft.chart.meta.title} / ${draft.chart.notes.length} ノーツ）`,
                () => this.startEdit(draft.chart),
                'btn btn-ghost',
              ),
              button(
                '保存された編集内容を消す',
                () => {
                  clearDraft()
                  toast('保存された編集内容を消しました。')
                  this.showEditSetup()
                },
                'btn btn-small btn-ghost',
              ),
            ])
          : null,
      ]),
    ])
    this.mountStatic(page)
  }

  private startEdit(chart: Chart): void {
    const screen = new EditScreen({
      chart,
      settings: this.settings,
      onExit: () => this.showHome(),
      onPlaytest: (current) => {
        // 試遊から戻ったら、そのままの内容で編集を続けられるようにする。
        this.startPlay({ ...current, notes: [...current.notes] }, () => this.startEdit(current))
      },
    })
    this.mount(screen)
    void screen.start()
  }
}
