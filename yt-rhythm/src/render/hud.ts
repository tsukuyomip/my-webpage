import type { StageRect } from '../core/geometry.ts'
import type { ScoreSnapshot } from '../core/judge.ts'

/** スコア・コンボ・進捗をキャンバスに直接描く（ステージと同じ座標系で崩れない）。 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  rect: StageRect,
  snap: ScoreSnapshot,
  progress: number,
): void {
  const pad = Math.round(rect.width * 0.022)
  const base = Math.max(11, rect.width * 0.028)

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowBlur = 6

  // スコア（右上）
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${Math.round(base * 1.5)}px system-ui, sans-serif`
  ctx.fillText(snap.score.toLocaleString('en-US'), rect.width - pad, pad)
  ctx.font = `500 ${Math.round(base)}px system-ui, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.fillText(
    `${(snap.accuracy * 100).toFixed(2)}%  ${snap.judged}/${snap.total}`,
    rect.width - pad,
    pad + Math.round(base * 1.8),
  )

  // コンボ（中央上）
  if (snap.combo >= 2) {
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffd54a'
    ctx.font = `800 ${Math.round(base * 2.2)}px system-ui, sans-serif`
    ctx.fillText(String(snap.combo), rect.width / 2, pad)
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = `700 ${Math.round(base * 0.85)}px system-ui, sans-serif`
    ctx.fillText('COMBO', rect.width / 2, pad + Math.round(base * 2.5))
  }
  ctx.restore()

  // 進捗バー（下端）
  const barH = Math.max(3, rect.height * 0.008)
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.2)'
  ctx.fillRect(0, rect.height - barH, rect.width, barH)
  ctx.fillStyle = '#5cc8ff'
  ctx.fillRect(0, rect.height - barH, rect.width * Math.min(1, Math.max(0, progress)), barH)
  ctx.restore()
}

/** 判定時刻からのズレを示すバー（早い/遅いの傾向が分かる）。 */
export function drawTimingBar(
  ctx: CanvasRenderingContext2D,
  rect: StageRect,
  deltas: number[],
  window: number,
): void {
  if (deltas.length === 0) return
  const w = rect.width * 0.34
  const x0 = (rect.width - w) / 2
  const y = rect.height * 0.955
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fillRect(x0, y - 2, w, 4)
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillRect(rect.width / 2 - 1, y - 6, 2, 12)
  for (let i = 0; i < deltas.length; i += 1) {
    const age = (deltas.length - i) / deltas.length
    ctx.globalAlpha = age * 0.9
    const d = Math.max(-window, Math.min(window, deltas[i]))
    ctx.fillStyle = d < 0 ? '#5cc8ff' : '#ff9f43'
    ctx.fillRect(rect.width / 2 + (d / window) * (w / 2) - 1, y - 5, 2, 10)
  }
  ctx.restore()
}
