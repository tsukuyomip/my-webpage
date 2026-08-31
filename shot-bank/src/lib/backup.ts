import { getImage, getThumb, putShot } from './db'
import { extensionFor } from './encode'
import { stampNow } from './format'
import type { BackupManifest, Shot } from './types'
import { makeZip, readZip, type ZipEntry } from './zip'

const MANIFEST = 'manifest.json'

function mimeForExtension(ext: string): string {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}

export function backupFileName(): string {
  return `shot-bank-${stampNow()}.zip`
}

/**
 * 全件を 1 つの ZIP に書き出す。
 * ブラウザの保存領域は消えるものなので、これが唯一の持ち出し手段になる。
 */
export async function exportBackup(
  shots: Shot[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const manifest: BackupManifest = { version: 1, exportedAt: Date.now(), shots }
  const entries: ZipEntry[] = [
    {
      path: MANIFEST,
      blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
    },
  ]

  for (const [i, shot] of shots.entries()) {
    const image = await getImage(shot.id)
    if (image) entries.push({ path: `images/${shot.id}.${extensionFor(shot.mime)}`, blob: image })
    // サムネも入れておく。1 枚 10KB 程度なので、戻したときに作り直す時間を買える。
    const thumb = await getThumb(shot.id)
    if (thumb) entries.push({ path: `thumbs/${shot.id}.${extensionFor(thumb.type)}`, blob: thumb })
    onProgress?.(i + 1, shots.length)
  }

  return makeZip(entries)
}

export interface RestoreResult {
  added: number
  /** 既に同じ ID があったので触らなかった件数 */
  skipped: number
  /** 目録にあるのに画像が入っていなかった件数 */
  missing: number
}

/**
 * バックアップを読み戻す。
 * 既にある ID は上書きしない（手で直した内容を、古いバックアップで潰さないため）。
 */
export async function importBackup(
  file: Blob,
  existingIds: Set<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<RestoreResult> {
  const files = await readZip(file)
  const manifestBlob = files.get(MANIFEST)
  if (!manifestBlob) throw new Error('バックアップの目録 (manifest.json) が見つかりません')

  const manifest = JSON.parse(await manifestBlob.text()) as BackupManifest
  if (manifest.version !== 1) {
    throw new Error(`未知のバックアップ形式です (version ${manifest.version})`)
  }

  const byPrefix = (prefix: string, id: string): { blob: Blob; ext: string } | undefined => {
    for (const [path, blob] of files) {
      if (path.startsWith(`${prefix}/${id}.`)) {
        return { blob, ext: path.slice(path.lastIndexOf('.') + 1) }
      }
    }
    return undefined
  }

  const result: RestoreResult = { added: 0, skipped: 0, missing: 0 }
  for (const [i, shot] of manifest.shots.entries()) {
    onProgress?.(i + 1, manifest.shots.length)
    if (existingIds.has(shot.id)) {
      result.skipped++
      continue
    }
    const image = byPrefix('images', shot.id)
    const thumb = byPrefix('thumbs', shot.id)
    if (!image || !thumb) {
      result.missing++
      continue
    }
    // ZIP を通ると MIME が落ちるので、目録と拡張子から付け直す。
    await putShot(
      shot,
      new Blob([image.blob], { type: shot.mime }),
      new Blob([thumb.blob], { type: mimeForExtension(thumb.ext) }),
    )
    result.added++
  }
  return result
}
