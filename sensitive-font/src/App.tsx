import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgeGate } from './components/AgeGate'
import { ExportBar } from './components/ExportBar'
import { FontPicker } from './components/FontPicker'
import { PreviewCanvas } from './components/PreviewCanvas'
import { FillPanel, ShadowPanel, StrokePanel, TransformPanel, TypePanel } from './components/StylePanel'
import { Section, Slider } from './components/controls'
import { TextEditor } from './components/TextEditor'
import { renderText, type RenderResult } from './render/draw'
import { loadConfig, saveConfig, shareUrl } from './state/share'
import { defaultConfig, defaultOf, SECTION_KEYS, type Config } from './state/types'
import {
  ensureFontReady,
  EXPORT_TIMEOUT_MS,
  findFont,
  isFontReady,
  PREVIEW_TIMEOUT_MS,
} from './text/fonts'
import { coverageNote, describeCoverage, missingChars } from './text/coverage'
import { STYLE_PRESETS } from './text/presets'

/**
 * 全設定の初期化ボタン。作りかけが消える操作なので、押し間違いで飛ばないよう
 * 2 段階にしている（ブラウザの confirm はスマホで扱いにくいため自前）。
 */
function ResetAllButton({ onReset }: { onReset: () => void }) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 5000)
    return () => clearTimeout(t)
  }, [armed])

  if (!armed) {
    return (
      <button type="button" className="ghost-sm" onClick={() => setArmed(true)}>
        すべて初期値に戻す
      </button>
    )
  }
  return (
    <span className="confirm">
      <button
        type="button"
        className="danger"
        onClick={() => {
          onReset()
          setArmed(false)
        }}
      >
        本当に戻す
      </button>
      <button type="button" className="ghost-sm" onClick={() => setArmed(false)}>
        やめる
      </button>
    </span>
  )
}

/** プレビューの解像度倍率。大きすぎる版は端末が死ぬので上限を掛ける。 */
function previewScaleFor(cfg: Config): number {
  const lines = cfg.text.split('\n')
  const longest = Math.max(1, ...lines.map((l) => Array.from(l).length))
  const estW = cfg.vertical ? lines.length * cfg.fontSize * cfg.lineHeight : longest * cfg.fontSize
  const estH = cfg.vertical ? longest * cfg.fontSize : lines.length * cfg.fontSize * cfg.lineHeight
  return Math.max(0.25, Math.min(2, 2600 / Math.max(estW, estH, 1)))
}

export default function App() {
  const [cfg, setCfg] = useState<Config>(loadConfig)
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null)
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [fontMissing, setFontMissing] = useState(false)
  const [missing, setMissing] = useState<string[]>([])
  const [coverageHint, setCoverageHint] = useState<string | null>(null)
  // フォントが遅れて届いたときに描き直すためのカウンタ。
  const [fontEpoch, setFontEpoch] = useState(0)
  const renderToken = useRef(0)

  useEffect(() => {
    const onDone = () => setFontEpoch((n) => n + 1)
    document.fonts.addEventListener('loadingdone', onDone)
    return () => document.fonts.removeEventListener('loadingdone', onDone)
  }, [])

  const patch = useCallback((p: Partial<Config>) => setCfg((c) => ({ ...c, ...p })), [])

  // プリセットは「見た目一式」の置き換え。差分適用にすると前のプリセットの
  // 傾きやゆらぎが residue として残るので、既定値まで戻してから被せる。
  // ただし文字・サイズ・余白はユーザーが決めたものなので引き継ぐ。
  const applyPreset = useCallback(
    (p: Partial<Config>) =>
      setCfg((c) => ({
        ...defaultConfig(),
        ...JSON.parse(JSON.stringify(p)),
        text: c.text,
        fontSize: c.fontSize,
        padding: c.padding,
      })),
    [],
  )

  /** セクション単位の初期化。そのセクションが持つ項目だけ既定値に戻す。 */
  const resetKeys = useCallback(
    (keys: readonly (keyof Config)[]) =>
      setCfg((c) => {
        const next = { ...c }
        for (const k of keys) Object.assign(next, { [k]: defaultOf(k) })
        return next
      }),
    [],
  )
  const font = useMemo(() => findFont(cfg.fontId), [cfg.fontId])
  const previewScale = previewScaleFor(cfg)

  // 設定が変わるたびに描き直す。入力のたびに走ると重いので少しだけ遅らせる。
  useEffect(() => {
    const token = ++renderToken.current
    setBusy(true)
    const timer = setTimeout(async () => {
      // Canvas は未ロードのフォントを黙って代替書体で描くので、必ず待つ。
      await ensureFontReady(font, cfg.fontWeight, cfg.text, PREVIEW_TIMEOUT_MS)
      if (renderToken.current !== token) return
      try {
        const r = renderText(cfg, font, cfg.fontWeight, previewScale)
        if (renderToken.current !== token) return
        setPreview(r.canvas)
        setBaseSize({ w: r.canvas.width / r.scale, h: r.canvas.height / r.scale })
        const ready = isFontReady(font, cfg.fontWeight, cfg.text)
        setFontMissing(!ready)
        // 書体が効いているときだけ「その書体に無い文字」を見る
        // （そもそも読めていないなら全文字が無いことになって意味がない）。
        const lacking = ready ? missingChars(font.family, cfg.fontWeight, cfg.text) : []
        setMissing(lacking)
        setCoverageHint(
          lacking.length ? coverageNote(describeCoverage(font.family, cfg.fontWeight)) : null,
        )
      } finally {
        if (renderToken.current === token) setBusy(false)
      }
    }, 140)
    return () => clearTimeout(timer)
  }, [cfg, font, previewScale, fontEpoch])

  useEffect(() => {
    const timer = setTimeout(() => saveConfig(cfg), 400)
    return () => clearTimeout(timer)
  }, [cfg])

  const renderAt = useCallback(
    async (scale: number): Promise<RenderResult> => {
      // 書き出しは代替書体で出てしまうと台無しなので、プレビューより長く待つ。
      await ensureFontReady(font, cfg.fontWeight, cfg.text, EXPORT_TIMEOUT_MS)
      return renderText(cfg, font, cfg.fontWeight, scale)
    },
    [cfg, font],
  )

  return (
    <>
      <AgeGate />
      <div className="app">
        <header className="app-header">
          <div className="app-title">
            <h1>✨ 透過文字ジェネレータ</h1>
            <ResetAllButton onReset={() => setCfg(defaultConfig())} />
          </div>
          <p>
            文字を透過 PNG にして書き出すツール。処理はすべてブラウザ内で完結し、
            入力も画像もどこにも送信されません。
          </p>
        </header>

        <div className="layout">
          {/* プレビューは常に見えるように固定表示。スマホでは画面上部に貼り付く。 */}
          <div className="left">
            <PreviewCanvas canvas={preview} previewScale={previewScale} busy={busy} />
            {fontMissing && (
              <p className="warn">
                「{font.label}」を読み込めていないため、代替書体で表示しています。
                回線が復帰すれば自動で描き直します。手持ちのフォントを読み込んで使うこともできます。
              </p>
            )}
            {!fontMissing && missing.length > 0 && (
              <p className="warn">
                「{font.label}」に入っていない文字があります（<b>{missing.join(' ')}</b>
                ）。この文字だけ別の書体で描かれています。
                {coverageHint}
              </p>
            )}
            {font.credit && (
              <p className="credit">
                「{font.label}」は{' '}
                <a href={font.credit.url} target="_blank" rel="noreferrer noopener">
                  {font.credit.name}
                </a>{' '}
                の配布フォントです。
              </p>
            )}
          </div>

          {/* 操作の頻度が高い順: 文字 → フォント → スタイル → 細かい調整 → 書き出し */}
          <div className="right">
            <Section title="文字" onReset={() => resetKeys(SECTION_KEYS.文字)}>
              <TextEditor text={cfg.text} onChange={(text) => patch({ text })} />
            </Section>

            <Section title="フォント" onReset={() => resetKeys(SECTION_KEYS.フォント)}>
              <FontPicker
                fontId={cfg.fontId}
                fontWeight={cfg.fontWeight}
                onChange={(p) => patch(p)}
              />
            </Section>

            <Section title="スタイル" onReset={() => resetKeys(SECTION_KEYS.スタイル)}>
              <div className="btn-row">
                {STYLE_PRESETS.map((p) => (
                  <button key={p.name} type="button" className="chip" onClick={() => applyPreset(p.patch)}>
                    {p.name}
                  </button>
                ))}
              </div>
              <p className="hint">
                プリセットは見た目一式を置き換えます（文字・サイズ・余白はそのまま）。
                「初期化」で塗り・縁取り・影・変形をまとめて既定に戻せます。
              </p>
            </Section>

            <Section title="文字組み" onReset={() => resetKeys(SECTION_KEYS.文字組み)}>
              <TypePanel cfg={cfg} patch={patch} />
            </Section>

            <Section title="塗り" onReset={() => resetKeys(SECTION_KEYS.塗り)}>
              <FillPanel cfg={cfg} patch={patch} />
            </Section>

            <Section title="縁取り" onReset={() => resetKeys(SECTION_KEYS.縁取り)}>
              <StrokePanel cfg={cfg} patch={patch} />
            </Section>

            <Section title="影" defaultOpen={false} onReset={() => resetKeys(SECTION_KEYS.影)}>
              <ShadowPanel cfg={cfg} patch={patch} />
            </Section>

            <Section
              title="変形・ゆらぎ"
              defaultOpen={false}
              onReset={() => resetKeys(SECTION_KEYS.変形)}
            >
              <TransformPanel cfg={cfg} patch={patch} />
            </Section>

            <Section title="書き出し" onReset={() => resetKeys(SECTION_KEYS.書き出し)}>
              <Slider
                label="周囲の余白"
                value={cfg.padding}
                min={0}
                max={200}
                unit="px"
                onChange={(padding) => patch({ padding })}
              />
              <p className="hint">
                文字の周囲は自動でトリムされます。ここで指定したぶんだけ余白を残します。
              </p>
              <ExportBar
                text={cfg.text}
                baseSize={baseSize}
                renderAt={renderAt}
                shareHref={shareUrl(cfg)}
              />
            </Section>
          </div>
        </div>

        <footer className="app-footer">
          <p>
            フォントは Google Fonts（SIL Open Font License）を使用。手持ちフォントで作った
            画像の配布可否は、そのフォントのライセンスに従ってください。
          </p>
          <p>
            同梱フォント:{' '}
            <a href="https://booth.pm/ja/items/4004751" target="_blank" rel="noreferrer noopener">
              エチオン（ガク藝会）
            </a>
            {' / '}
            <a href="https://booth.pm/ja/items/2439013" target="_blank" rel="noreferrer noopener">
              あんばたフォント
            </a>
            。いずれも配布元の利用規約に従ってご利用ください（フォントデータの再配布・改変・販売は禁止されています）。
          </p>
          <p className="build">build {__BUILD_INFO__}</p>
        </footer>
      </div>
    </>
  )
}
