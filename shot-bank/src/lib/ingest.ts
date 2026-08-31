import { putShot } from './db'
import { prepare } from './encode'
import { hamming, DUPLICATE_BITS } from './hash'
import { newId } from './ids'
import type { Shot } from './types'

export interface IngestResult {
  added: Shot[]
  duplicates: number
  failed: { name: string; reason: string }[]
}

export interface IngestProgress {
  done: number
  total: number
  currentName: string
}

/**
 * 取り込みの本体。1 枚ずつ順に処理する。
 * デコードとエンコードはメインスレッドを掴むので、並列にしても速くならず UI が固まるだけ。
 * await を挟むことでフレームを返し、進捗を出しながら進める。
 */
export async function ingestFiles(
  files: File[],
  options: {
    reencode: boolean
    /** 既に保存済みのハッシュ。重複を弾くのに使う */
    knownHashes: string[]
    onProgress?: (p: IngestProgress) => void
  },
): Promise<IngestResult> {
  const result: IngestResult = { added: [], duplicates: 0, failed: [] }
  const hashes = [...options.knownHashes]

  for (const [i, file] of files.entries()) {
    options.onProgress?.({ done: i, total: files.length, currentName: file.name })
    try {
      const prepared = await prepare(file, options.reencode)

      if (hashes.some((h) => hamming(h, prepared.dhash) <= DUPLICATE_BITS)) {
        result.duplicates++
        continue
      }

      const shot: Shot = {
        id: newId(),
        createdAt: Date.now(),
        shotAt: file.lastModified || undefined,
        fileName: file.name || 'screenshot',
        mime: prepared.mime,
        size: prepared.blob.size,
        width: prepared.width,
        height: prepared.height,
        dhash: prepared.dhash,
      }
      await putShot(shot, prepared.blob, prepared.thumb)
      hashes.push(prepared.dhash)
      result.added.push(shot)
    } catch (e) {
      result.failed.push({ name: file.name || '(名前なし)', reason: String(e) })
    }
  }

  options.onProgress?.({ done: files.length, total: files.length, currentName: '' })
  return result
}

/** DataTransfer / クリップボードから画像ファイルだけ取り出す。 */
export function imageFilesFrom(list: FileList | File[] | null | undefined): File[] {
  if (!list) return []
  return Array.from(list).filter((f) => f.type.startsWith('image/'))
}
