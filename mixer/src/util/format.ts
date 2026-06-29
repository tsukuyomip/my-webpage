/** Format seconds as m:ss.t (e.g. 73.4 -> "1:13.4"). */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const tenths = Math.floor((seconds * 10) % 10)
  return `${m}:${s.toString().padStart(2, '0')}.${tenths}`
}
