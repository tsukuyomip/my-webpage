import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgeGate } from './components/AgeGate'
import { ExportBar } from './components/ExportBar'
import { FontPicker } from './components/FontPicker'
import { PreviewCanvas } from './components/PreviewCanvas'
import { FillPanel, ShadowPanel, StrokePanel, TransformPanel, TypePanel } from './components/StylePanel'
import { Section } from './components/controls'
import { TextEditor } from './components/TextEditor'
import { renderText, type RenderResult } from './render/draw'
import { loadConfig, saveConfig, shareUrl } from './state/share'
import { DEFAULT_CONFIG, type Config } from './state/types'
import {
  ensureFontReady,
  EXPORT_TIMEOUT_MS,
  findFont,
  isFontReady,
  PREVIEW_TIMEOUT_MS,
} from './text/fonts'
import { STYLE_PRESETS } from './text/presets'

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
        ...DEFAULT_CONFIG,
        ...p,
        text: c.text,
        fontSize: c.fontSize,
        padding: c.padding,
      })),
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
        setFontMissing(!isFontReady(font, cfg.fontWeight, cfg.text))
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
          <h1>✨ 透過文字ジェネレータ</h1>
          <p>
            文字を透過 PNG にして書き出すツール。処理はすべてブラウザ内で完結し、
            入力も画像もどこにも送信されません。
          </p>
        </header>

        <div className="layout">
          <div className="left">
            <PreviewCanvas canvas={preview} previewScale={previewScale} busy={busy} />
            {fontMissing && (
              <p className="warn">
                「{font.label}」を読み込めていないため、代替書体で表示しています。
                回線が復帰すれば自動で描き直します。手持ちのフォントを読み込んで使うこともできます。
              </p>
            )}
            <Section title="書き出し">
              <ExportBar
                text={cfg.text}
                baseSize={baseSize}
                renderAt={renderAt}
                shareHref={shareUrl(cfg)}
              />
            </Section>
          </div>

          <div className="right">
            <Section
              title="スタイル"
              right={
                <button type="button" className="ghost-sm" onClick={() => setCfg(DEFAULT_CONFIG)}>
                  リセット
                </button>
              }
            >
              <div className="btn-row">
                {STYLE_PRESETS.map((p) => (
                  <button key={p.name} type="button" className="chip" onClick={() => applyPreset(p.patch)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="文字">
              <TextEditor text={cfg.text} onChange={(text) => patch({ text })} />
            </Section>

            <Section title="フォント">
              <FontPicker
                fontId={cfg.fontId}
                fontWeight={cfg.fontWeight}
                onChange={(p) => patch(p)}
              />
            </Section>

            <Section title="文字組み">
              <TypePanel cfg={cfg} patch={patch} />
            </Section>

            <Section title="塗り">
              <FillPanel cfg={cfg} patch={patch} />
            </Section>

            <Section title="縁取り">
              <StrokePanel cfg={cfg} patch={patch} />
            </Section>

            <Section title="影">
              <ShadowPanel cfg={cfg} patch={patch} />
            </Section>

            <Section title="変形・ゆらぎ">
              <TransformPanel cfg={cfg} patch={patch} />
            </Section>

            <Section title="余白">
              <label className="slider">
                <span className="slider-label">
                  書き出し時の余白<b>{cfg.padding}px</b>
                </span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={cfg.padding}
                  onChange={(e) => patch({ padding: Number(e.target.value) })}
                />
              </label>
              <p className="hint">
                文字の周囲は自動でトリムされます。ここで指定したぶんだけ余白を残します。
              </p>
            </Section>
          </div>
        </div>

        <footer className="app-footer">
          <p>
            フォントは Google Fonts（SIL Open Font License）を使用。手持ちフォントで作った
            画像の配布可否は、そのフォントのライセンスに従ってください。
          </p>
          <p className="build">build {__BUILD_INFO__}</p>
        </footer>
      </div>
    </>
  )
}
