import { createEmptyChart, parseChart } from '../core/chart.ts'
import { clearDraft, loadDraft } from '../core/draft.ts'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../core/settings.ts'
import { SFX_KITS, sfx } from '../core/sfx.ts'
import { APPROACH_RANGE, DIM_RANGE, type Chart } from '../core/types.ts'
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
        this.buildBraveNotice(),
        this.buildSettingsPanel(),
        this.buildAccountPanel(),
        h('p', { class: 'muted small', text: `build ${__BUILD_INFO__}` }),
      ]),
    ])
    this.mountStatic(page)
  }

  private buildSettingsPanel(): HTMLElement {
    const rows: HTMLElement[] = []

    interface SliderSpec {
      label: string
      value: number
      min: number
      max: number
      step: number
      format: (v: number) => string
      apply: (v: number) => void
      /** スライダーから指を離したときに一度だけ走らせる（試聴など）。 */
      preview?: () => void
      /** 譜面の既定値を使うか、このスライダーで上書きするかを切り替える。 */
      chartDefault?: { isOverridden: () => boolean; setOverridden: (on: boolean) => void }
    }

    const addSlider = (spec: SliderSpec) => {
      const readout = h('span', { class: 'slider-value', text: spec.format(spec.value) })
      const input = h('input', {
        class: 'slider',
        attrs: {
          type: 'range',
          min: String(spec.min),
          max: String(spec.max),
          step: String(spec.step),
        },
        on: {
          input: () => {
            const v = Number(input.value)
            readout.textContent = spec.format(v)
            spec.apply(v)
            saveSettings(this.settings)
          },
          change: () => spec.preview?.(),
        },
      })
      input.value = String(spec.value)
      rows.push(
        h('div', { class: 'settings-row' }, [h('span', { text: spec.label }), input, readout]),
      )

      if (!spec.chartDefault) return
      const { isOverridden, setOverridden } = spec.chartDefault
      const check = h('input', { attrs: { type: 'checkbox' } })
      check.checked = !isOverridden()
      const sync = () => {
        input.disabled = check.checked
        readout.style.opacity = check.checked ? '0.45' : '1'
      }
      check.addEventListener('change', () => {
        setOverridden(!check.checked)
        saveSettings(this.settings)
        sync()
      })
      sync()
      rows.push(
        h('label', { class: 'settings-note' }, [
          check,
          h('span', { class: 'small', text: '譜面の値を使う（外すと上の値で上書き）' }),
        ]),
      )
    }

    addSlider({
      label: '判定オフセット',
      value: this.settings.offsetMs,
      min: -300,
      max: 300,
      step: 5,
      format: (v) => `${v > 0 ? '+' : ''}${v} ms`,
      apply: (v) => {
        this.settings.offsetMs = v
      },
    })
    addSlider({
      label: 'ノーツ速度',
      value: this.settings.approachMs,
      min: APPROACH_RANGE.min,
      max: APPROACH_RANGE.max,
      step: 50,
      format: (v) => `${v} ms`,
      apply: (v) => {
        this.settings.approachMs = v
      },
      chartDefault: {
        isOverridden: () => this.settings.overrideApproach,
        setOverridden: (on) => {
          this.settings.overrideApproach = on
        },
      },
    })
    addSlider({
      label: '画面の暗さ',
      value: this.settings.dimOpacity,
      min: DIM_RANGE.min,
      max: DIM_RANGE.max,
      step: 0.05,
      format: (v) => (v <= 0 ? 'なし' : `${Math.round(v * 100)}%`),
      apply: (v) => {
        this.settings.dimOpacity = v
      },
      chartDefault: {
        isOverridden: () => this.settings.overrideDim,
        setOverridden: (on) => {
          this.settings.overrideDim = on
        },
      },
    })
    addSlider({
      label: 'ノーツの大きさ',
      value: this.settings.noteScale,
      min: 0.6,
      max: 1.8,
      step: 0.05,
      format: (v) => `${v.toFixed(2)}x`,
      apply: (v) => {
        this.settings.noteScale = v
      },
    })
    addSlider({
      label: '画面の揺れ',
      value: this.settings.screenShake,
      min: 0,
      max: 1,
      step: 0.1,
      format: (v) => (v <= 0 ? 'なし' : `${Math.round(v * 100)}%`),
      apply: (v) => {
        this.settings.screenShake = v
      },
    })

    addSlider({
      label: '効果音の音量',
      value: this.settings.sfxVolume,
      min: 0,
      max: 1,
      step: 0.05,
      format: (v) => (v <= 0 ? 'OFF' : `${Math.round(v * 100)}%`),
      apply: (v) => {
        this.settings.sfxVolume = v
        sfx.setVolume(v)
      },
      preview: () => {
        // 動かしたその場で音を確かめられるようにする。
        sfx.ensure()
        sfx.setVolume(this.settings.sfxVolume)
        sfx.play('perfect')
      },
    })

    // 判定音のセット。既定は譜面が持つ値を使い、外したときだけ上書きする。
    const kitSelect = h('select', {
      class: 'select',
      on: {
        change: () => {
          this.settings.sfxKit = kitSelect.value as Settings['sfxKit']
          saveSettings(this.settings)
          sfx.ensure()
          sfx.setKit(this.settings.sfxKit)
          sfx.setVolume(this.settings.sfxVolume)
          sfx.play('perfect')
        },
      },
    })
    for (const kit of SFX_KITS) {
      const option = h('option', { text: kit.label, attrs: { value: kit.id } })
      if (kit.id === this.settings.sfxKit) option.selected = true
      kitSelect.appendChild(option)
    }
    rows.push(h('div', { class: 'settings-row' }, [h('span', { text: '判定音' }), kitSelect]))

    const kitCheck = h('input', { attrs: { type: 'checkbox' } })
    kitCheck.checked = !this.settings.overrideSfxKit
    const syncKit = () => {
      kitSelect.disabled = kitCheck.checked
      kitSelect.style.opacity = kitCheck.checked ? '0.45' : '1'
    }
    kitCheck.addEventListener('change', () => {
      this.settings.overrideSfxKit = !kitCheck.checked
      saveSettings(this.settings)
      syncKit()
    })
    syncKit()
    rows.push(
      h('label', { class: 'settings-note' }, [
        kitCheck,
        h('span', { class: 'small', text: '譜面の値を使う（外すと上の値で上書き）' }),
      ]),
    )

    return h('details', { class: 'settings' }, [
      h('summary', { text: '⚙ 設定' }),
      ...rows,
      h('p', {
        class: 'muted small',
        text: '「遅い」と判定されがちなら判定オフセットを + に、「早い」なら − にします。端末ごとに一度合わせれば以降は共通で使われます。',
      }),
      h('p', {
        class: 'muted small',
        text: 'ノーツ速度と画面の暗さは譜面が持つ値が既定です。合わないときだけチェックを外して上書きしてください。',
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

  /**
   * 広告と YouTube アカウントの案内。
   * 埋め込みプレイヤーにログイン機能はなく、ログイン状態を読むこともできないので、
   * できるのは「YouTube を開いてログインしてもらう」ところまで。
   */
  /**
   * 広告への対処の案内。折りたたみの中だと読まれないので、
   * ホームと譜面選びの両方に、開いたまま目に入る形で出す。
   */
  private buildBraveNotice(): HTMLElement {
    return h('div', { class: 'notice notice-brave' }, [
      h('strong', { text: '⚡ 広告を出したくないなら Brave ブラウザを推奨' }),
      h('p', {
        class: 'small',
        text: 'このアプリは YouTube の埋め込みプレイヤーを使うので、広告はアプリ側からは消せません。Brave なら既定で広告なしで再生でき、いちばん快適に遊べます。YouTube Premium にログイン済みのブラウザでも広告は出ません。',
      }),
      h('div', { class: 'panel-row' }, [
        button(
          'Brave を入手',
          () => window.open('https://brave.com/download/', '_blank', 'noopener'),
          'btn btn-small btn-primary',
        ),
      ]),
      h('p', {
        class: 'small muted',
        text: 'どちらも使わない場合も遊べます。広告のあいだはゲームを止めて待ち、終わったら自動で再開します。',
      }),
    ])
  }

  private buildAccountPanel(): HTMLElement {
    return h('details', { class: 'settings' }, [
      h('summary', { text: '📺 広告と YouTube アカウント' }),
      h('p', {
        class: 'muted small',
        text: 'このアプリは YouTube の埋め込みプレイヤーで再生します。同じブラウザで YouTube にログインしていれば、その状態は埋め込みにも引き継がれます。YouTube Premium なら広告なしで再生されます。',
      }),
      button(
        'YouTube を開いてログイン',
        () => window.open('https://www.youtube.com/', '_blank', 'noopener'),
        'btn btn-small',
      ),
      h('p', {
        class: 'muted small',
        text: 'ログインしたらこのページに戻って開き直してください。アプリ側からログインさせたり、ログイン済みかを判定したりはできません。',
      }),
      h('p', {
        class: 'muted small',
        text: 'サードパーティ Cookie をブロックしている場合（iOS の Safari などは既定でブロック）は、ログイン状態が埋め込みに伝わらず広告が出ることがあります。その場合は設定で許可するか、広告が終わるのを待つ作りのままお使いください。',
      }),
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
        this.buildBraveNotice(),
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
