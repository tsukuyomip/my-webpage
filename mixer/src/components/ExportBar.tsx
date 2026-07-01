import { useState } from 'react'

interface Props {
  disabled: boolean
  hasVideo: boolean
  onExport: (onProgress: (r: number) => void) => Promise<{ blob: Blob; ext: string }>
}

/** Render the mix and download it as an MP4/WebM file (Phase 6). */
export function ExportBar({ disabled, hasVideo, onExport }: Props) {
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const exporting = progress !== null

  const handleExport = async () => {
    if (exporting) return
    setProgress(0)
    setError(null)
    try {
      const { blob, ext } = await onExport((r) => setProgress(r))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mixer-export.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke on a later tick: revoking immediately after click() can abort the
      // download of a large blob before the browser has finished reading it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      console.error('export failed', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
    }
  }

  return (
    <section className="exportbar">
      <button
        className="exportbar__btn"
        onClick={() => void handleExport()}
        disabled={disabled || exporting}
      >
        {exporting
          ? `書き出し中… ${Math.round((progress ?? 0) * 100)}%`
          : hasVideo
            ? '🎬 動画を書き出す'
            : '🎵 ミックスを書き出す'}
      </button>
      {exporting && (
        <div className="exportbar__bar">
          <div
            className="exportbar__fill"
            style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
          />
        </div>
      )}
      {error && <p className="exportbar__error">書き出しに失敗しました：{error}</p>}
      <p className="exportbar__note">
        ※ フレーム単位で書き出すため、切り替えでも音や映像が途切れません（対応端末では MP4、それ以外は WebM）。
      </p>
    </section>
  )
}
