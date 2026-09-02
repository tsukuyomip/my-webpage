import { saveBlob } from './download'

/**
 * 出来上がりを端末へ渡す。
 *
 * iOS では写真アプリへ保存する口が共有シートしかない。PC では共有シートが無いので、
 * そのときは素直にダウンロードする。「保存できません」で行き止まりにしない。
 */
export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) return false
  try {
    return navigator.canShare({ files })
  } catch {
    return false
  }
}

export async function deliver(blob: Blob, name: string): Promise<'shared' | 'saved'> {
  const file = new File([blob], name, { type: blob.type })
  if (canShareFiles([file])) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (e) {
      // ユーザが共有シートを閉じただけなら、勝手にダウンロードし直さない。
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared'
    }
  }
  saveBlob(blob, name)
  return 'saved'
}
