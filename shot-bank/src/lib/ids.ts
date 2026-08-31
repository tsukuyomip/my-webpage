/**
 * 時系列に並ぶ ID。先頭が時刻なので、ID の昇順＝取り込み順になる。
 * ULID そのものではないが、必要な性質（単調・衝突しない・短い）は満たす。
 */
export function newId(): string {
  const t = Date.now().toString(36).padStart(9, '0')
  const r = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
  return `${t}${r}`
}
