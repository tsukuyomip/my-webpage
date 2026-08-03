import { useState } from 'react'
import type { RenderResult } from '../render/draw'
import { copyPngToClipboard, downloadPng, makeFilename } from '../render/export'

export function ExportBar({
  text,
  baseSize,
  renderAt,
  shareHref,
}: {
  text: string
  /** 等倍での出力サイズ（表示用） */
  baseSize: { w: number; h: number } | null
  renderAt: (scale: number) => Promise<RenderResult>
  shareHref: string
}) {
  const [scale, setScale] = useState(1)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: (r: RenderResult) => Promise<void>, done: string) => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await renderAt(scale)
      await fn(result)
      setStatus(
        result.clamped
          ? `${done}（Canvas の上限に当たったため ${result.scale.toFixed(2)}倍で出力しました）`
          : done,
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="export-bar">
      <div className="row">
        <span className="slider-label">倍率</span>
        <div className="segmented">
          {[1, 2, 4].map((s) => (
            <button key={s} type="button" className={s === scale ? 'on' : ''} onClick={() => setScale(s)}>
              {s}x
            </button>
          ))}
        </div>
        {baseSize && (
          <span className="hint">
            {Math.round(baseSize.w * scale)} × {Math.round(baseSize.h * scale)} px
          </span>
        )}
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => run((r) => downloadPng(r.canvas, makeFilename(text)), 'ダウンロードしました')}
        >
          ⬇ 透過PNGを保存
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run((r) => copyPngToClipboard(r.canvas), 'クリップボードにコピーしました')}
        >
          📋 コピー
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            // クリップボードが使えない環境でも拾えるよう、まずアドレスバーに反映する。
            history.replaceState(null, '', shareHref)
            try {
              await navigator.clipboard.writeText(shareHref)
              setStatus('設定を復元できる URL をコピーしました')
            } catch {
              setStatus('アドレスバーに設定つきの URL を入れました。ここからコピーしてください')
            }
          }}
        >
          🔗 設定URL
        </button>
      </div>

      {status && <p className="status">{status}</p>}
    </div>
  )
}
