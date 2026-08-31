import { putShot } from './db'
import { prepare } from './encode'
import { hamming, DUPLICATE_BITS } from './hash'
import { newId } from './ids'
import type { Shot } from './types'

/** すでに保存済みの絵とぶつかった 1 枚。どちらを残すかは呼び出し側が決める。 */
export interface DuplicateFile {
  file: File
  /** ぶつかった、すでに保存済みのスクショの id */
  existingId: string
}

export interface IngestResult {
  added: Shot[]
  duplicates: DuplicateFile[]
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
    /**
     * すでに保存済みのスクショ。重複を見つけるのに使う。
     * どちらを残すかは決めない ── 見つけたことだけを返して、判断は呼び出し側に渡す。
     */
    known: { id: string; dhash: string }[]
    onProgress?: (p: IngestProgress) => void
  },
): Promise<IngestResult> {
  const result: IngestResult = { added: [], duplicates: [], failed: [] }
  const known = [...options.known]

  for (const [i, file] of files.entries()) {
    options.onProgress?.({ done: i, total: files.length, currentName: file.name })
    try {
      const prepared = await prepare(file, options.reencode)

      const clash = known.find((k) => hamming(k.dhash, prepared.dhash) <= DUPLICATE_BITS)
      if (clash) {
        result.duplicates.push({ file, existingId: clash.id })
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
      known.push({ id: shot.id, dhash: shot.dhash })
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
