/**
 * Blob をファイルとして落とす。
 *
 * 同じ手順が 3 箇所（バックアップ、選んだ枚の ZIP、1 枚の書き出し）にあった。
 * URL を片付ける間合いを外すと保存ダイアログが空を掴むので、ここに 1 つ置く。
 */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // 保存ダイアログが URL を掴む余地を残してから片付ける。
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
