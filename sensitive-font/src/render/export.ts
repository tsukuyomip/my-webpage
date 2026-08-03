/** PNG の書き出し。 */

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG の生成に失敗しました'))), 'image/png')
  })
}

export async function downloadPng(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const blob = await canvasToBlob(canvas)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // revoke が早すぎると保存されない環境があるので少し待つ。
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function copyPngToClipboard(canvas: HTMLCanvasElement): Promise<void> {
  const blob = await canvasToBlob(canvas)
  const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
  if (!Item || !navigator.clipboard?.write) {
    throw new Error('この環境ではクリップボードコピーに対応していません')
  }
  await navigator.clipboard.write([new Item({ 'image/png': blob })])
}

/**
 * 入力テキストからファイル名を作る。
 *
 * 非 ASCII のファイル名は環境によっては `download`（拡張子なし）に丸ごと
 * 差し替えられてしまうため、ASCII に落とせないときは日時を使う。
 */
export function makeFilename(text: string): string {
  const ascii = text
    .replace(/\s+/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\/:*?"<>|.]/g, '')
    .slice(0, 24)
  if (ascii) return `${ascii}.png`
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `moji-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`
}
