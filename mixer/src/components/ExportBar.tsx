import { useState } from 'react'

interface Props {
  disabled: boolean
  hasVideo: boolean
  onExport: (onProgress: (r: number) => void) => Promise<Blob>
}

/** Record the mix in real time and download it as a WebM file (Phase 6). */
export function ExportBar({ disabled, hasVideo, onExport }: Props) {
  const [progress, setProgress] = useState<number | null>(null)
  const exporting = progress !== null

  const handleExport = async () => {
    if (exporting) return
    setProgress(0)
    try {
      const blob = await onExport((r) => setProgress(r))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'mixer-export.webm'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('export failed', err)
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
            ? '🎬 動画を書き出す (WebM)'
            : '🎵 ミックスを書き出す (WebM)'}
      </button>
      {exporting && (
        <div className="exportbar__bar">
          <div
            className="exportbar__fill"
            style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
          />
        </div>
      )}
      <p className="exportbar__note">
        ※ タイムラインを最後まで実時間で再生して録画します。
      </p>
    </section>
  )
}
